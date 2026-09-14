# Store serveur Supabase — clés, tables et RLS

Projet `mjbmtubkhlspwfqhqgvq`, **partagé avec Lalla Kenza**. Les tables Net Worth s'y distinguent
par leur nom ; aucune règle ne doit reposer sur « tout utilisateur authentifié ».

## Clés

Le projet a **désactivé les anciennes clés JWT** `anon` et `service_role` (format `eyJ…`). Ne jamais
en générer, en coller ni en recommander.

| Clé | Usage | Emplacement | Envoi |
|---|---|---|---|
| `sb_publishable_…` | navigateur | `js/api.js` → `SERVER_STORE.anonKey` (nom historique du champ) | `apikey` ; l'identité vient du JWT de session en `Authorization: Bearer` |
| `sb_secret_…` | cron serveur uniquement | secret GitHub Actions `NW_SUPABASE_SECRET_KEY` | **`apikey` seul** : ce n'est pas un JWT, jamais en `Authorization: Bearer` |

- La clé publishable est publique par design : elle ne donne accès qu'à ce que la RLS autorise au
  rôle anonyme — pour les tables patrimoniales, **rien** après la RLS v545.
- Une clé `sb_secret_…` contourne la RLS. Elle ne vit que dans le secret GitHub Actions, n'est jamais
  dans `js/`, dans un fichier suivi, dans une commande tapée ni dans un log. Le cron vérifie son
  format (`scripts/_snapshot_auth.mjs`) et refuse toute autre forme.
- Créer une clé serveur : *Project Settings* → *API Keys* → *Secret keys*, une clé nommée par usage
  (ex. `github-actions-daily-snapshot`) pour pouvoir la révoquer seule. Procédure d'installation sans
  affichage : `docs/BASCULE_V545.md`, étape 2.

## Politique d'accès cible (RLS v545)

| Table | Contenu | Lecture | Écriture |
|---|---|---|---|
| `price_history` | prix d'actions publics, aucune donnée personnelle | publique | publique (cache de prix) |
| `nw_snapshots` | patrimoine quotidien | **compte Net Worth seul** | INSERT : compte Net Worth (navigateur) ou clé serveur (cron). Aucun UPDATE/DELETE |
| `immo_properties`, `immo_loans`, `immo_crd_obs` | référentiel immobilier | **compte Net Worth seul** | administration uniquement (SQL Editor / Management API) |
| `nw_secrets` | clé des données | compte Net Worth seul | administration uniquement |

Le script qui pose cette RLS est **hors dépôt** :
`/Users/amine/networth-data/activation-kit/supabase_v545.sql` — un seul bloc atomique qui active la
RLS, retire toutes les policies existantes des quatre tables patrimoniales, crée les policies du seul
UID autorisé et vérifie les invariants avant de valider. Ordre d'exécution et contrôles :
`docs/BASCULE_V545.md`, étapes 1 à 6.

> **État tant que ce script n'est pas exécuté** : les quatre tables patrimoniales portent encore des
> policies anonymes héritées. Elles sont à retirer, jamais à recréer.

---

## `price_history` — cache L2 des prix

Le site met l'historique des prix en cache sur deux niveaux :

- **L1 = localStorage** (par navigateur) : rendu immédiat du graphe.
- **L2 = Supabase** (partagé) : une nouvelle machine lit tout l'historique en une requête au lieu de
  re-backfiller cinq ans depuis Yahoo ; seul le delta manquant est rechargé puis ré-uploadé.

Donnée stockée : dates et clôtures par ticker. Ni montant, ni position, ni donnée personnelle — c'est
la seule table où un accès anonyme est acceptable.

```sql
create table if not exists public.price_history (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz default now()
);
alter table public.price_history enable row level security;

-- Prix publics uniquement : lecture et écriture ouvertes au rôle anonyme.
create policy "price_read"   on public.price_history for select to anon, authenticated using (true);
create policy "price_insert" on public.price_history for insert to anon, authenticated with check (true);
create policy "price_update" on public.price_history for update to anon, authenticated using (true) with check (true);

-- updated_at = vraie date de dernière écriture (le DEFAULT ne joue qu'à l'INSERT ; un upsert fait
-- un UPDATE).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_price_history_updated_at on public.price_history;
create trigger trg_price_history_updated_at
  before insert or update on public.price_history
  for each row execute function public.set_updated_at();
```

Pire cas assumé : quelqu'un écrase le cache de prix ; le site le reconstruit depuis Yahoo.

### Configuration du client

```js
const SERVER_STORE = {
  url: 'https://mjbmtubkhlspwfqhqgvq.supabase.co',
  anonKey: 'sb_publishable_…',   // clé PUBLISHABLE uniquement — jamais une clé sb_secret_… ni eyJ…
  table: 'price_history',
  row: 'singleton',
};
```

URL et clé vides ⇒ L2 inactif, le site fonctionne en L1 seul. Toute modification : bump `?v=N`,
commit, push.

### Vérifier

- Premier chargement (L1 et L2 vides) : backfill depuis Yahoo puis `[hist] L2 Supabase upload OK`.
- Autre machine (L1 vide) : `[hist] L2 Supabase fusionné …` puis `0 backfill + N gap`.
- Écritures concurrentes : les gaps Yahoo sont déterministes, les blobs convergent. Blob borné à
  ~1 800 jours par série (`_trimSeries`).

---

## `nw_snapshots` — patrimoine quotidien (append-only)

Historique Net Worth : chaque capture fige l'arbre complet (totaux par personne, cartes KPI, chaque
compte, bien, position, créance, métadonnées de qualité) — `buildDailySnapshot(state)` dans
`js/engine.js`, ~5 Ko par jour, ids stables snake_case (`CASH_ACCOUNT_IDS`).

```sql
create table public.nw_snapshots (
  snap_date   date not null,
  captured_at timestamptz not null default now(),
  quality     text not null default 'static' check (quality in ('live','partial','static')),
  data        jsonb not null check (pg_column_size(data) < 200000),
  primary key (snap_date, captured_at)
);
alter table public.nw_snapshots enable row level security;
-- Policies : posées par supabase_v545.sql (SELECT et INSERT du seul UID autorisé).
-- AUCUNE policy UPDATE ni DELETE : un snapshot passé est irremplaçable.
-- Corrections : administration uniquement.
```

### Qui écrit

| Écrivain | Authentification | Quand |
|---|---|---|
| Cron GitHub Actions (`scripts/daily_snapshot.mjs`, ~22 h Paris) | clé `sb_secret_…` en `apikey` seul | chaque soir |
| Navigateur (`maybeSaveDailySnapshot`, `js/api.js`) | JWT de session du compte Net Worth | visite avec prix live ; sans session, s'abstient |

Pendant la transition, le cron accepte encore la clé publishable **en v544 et sans secret valide
seulement** ; en v545 il refuse d'écrire sans clé serveur. Détail et tests : `scripts/_snapshot_auth.mjs`,
`tests/snapshot-auth.test.js`.

### Sémantique

- Plusieurs lignes possibles par jour ; la meilleure est choisie **à la lecture** : qualité
  `live > partial > static`, puis `captured_at` le plus récent (`loadSnapshots`).
- Le navigateur n'insère que si c'est la première ligne du jour, une amélioration de qualité, ou un
  raffinement après plus de 4 h. **Jamais de capture en prix statiques.**
- Date du jour = calendrier **Europe/Paris** (`parisDateISO`), pas UTC.
- Jours sans capture = trous assumés (forward-fill à l'affichage). Jamais de reconstitution depuis
  `EQUITY_HISTORY`, affiché comme série séparée.

### Consommation

Vue **Analyse → Historique** : courbes Net Worth (couple / Amine / Nezha), aires par catégorie,
explorateur de séries, profondeur mensuelle actions. Deltas « vs hier » sur les cartes
(`applySnapshotDeltas`, `js/render.js`). Lecture avec le JWT de session : sans connexion, la vue
est vide.

---

## Référentiel immobilier — `immo_properties` / `immo_loans` / `immo_crd_obs`

Source de vérité éditable des données appartements, lue au chargement (`loadImmoRef()` →
`applyImmoRef()`), avec le JWT de session. Sans session ou en cas d'échec : cache local puis
`data.js` intégral.

Lecture : compte Net Worth seul (RLS v545). Écriture : administration uniquement, dans le SQL Editor.

### Éditer une valeur (exemples)

```sql
-- Valeur de marché Vitry (nouvelle estimation)
update public.immo_properties set value = 305000, value_date = '2026-09', updated_at = now()
where id = 'vitry';

-- CRD après réception d'un tableau d'amortissement
update public.immo_properties set crd_snapshot = 266000, crd_snapshot_date = '2026-09-30', updated_at = now()
where id = 'vitry';
insert into public.immo_crd_obs (property_id, loan_id, obs_date, crd, source)
values ('vitry', 'vitry_bp', '2026-09-30', 170500, 'tableau BP sept 2026');

-- Avancement VEFA Villejuif (nouvel appel de fonds)
update public.immo_properties
set vefa = vefa || '{"appelsPayes":165000,"drawnToDate":150000}', updated_at = now()
where id = 'villejuif';
```

### Règles

1. **Garder `data.js` en phase** : c'est le repli sans session ou hors ligne ET la base du test
   d'équivalence. Toute édition Supabase se réplique dans `data.js`.
2. **`vitryLoans[0]` = Action Logement** : l'ordre AL, PTZ, BP est significatif (l'engine lit `[0]`).
   Idem Villejuif : LCL1 puis LCL2.
3. **Jamais en base** : adresses, lots, noms de personnes, numéros de dossier ou de compte, revenus
   hors bail.
4. **Vérifier après édition** : se connecter, hard-refresh, console `[immo-ref] Supabase OK` avec les
   nouvelles valeurs ; les invariants engine restent verts (`[engine] Catégories cohérentes ✓`).
