# Store serveur partagé (L2 Supabase) — provisioning

Le site utilise un cache à 2 niveaux pour l'historique des prix :

- **L1 = localStorage** (par navigateur) : cache local instantané, rendu immédiat du graphe.
- **L2 = Supabase** (partagé) : source de vérité cross-machine. Une nouvelle machine lit tout
  l'historique depuis L2 en 1 requête au lieu de re-backfiller 5 ans depuis Yahoo. Seul le delta
  manquant est chargé de Yahoo/TradingView, restitué à l'utilisateur, puis ré-uploadé vers L2 en
  arrière-plan.

Donnée stockée = **prix d'actions publics** (dates + clôtures par ticker). **Pas** de montants,
pas de positions, pas de données perso → clé anon dans le client = pratique standard Supabase.

Tant que `SERVER_STORE.url` / `anonKey` sont vides dans `js/api.js`, L2 est **inactif** (le site
fonctionne en L1-only, comportement inchangé). Pour l'activer :

## 1. Créer la table (SQL editor Supabase)

Projet Supabase existant OU nouveau projet gratuit dédié à networth (recommandé pour l'isolation).
Dans **SQL Editor**, exécuter :

```sql
create table if not exists price_history (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz default now()
);

alter table price_history enable row level security;

-- Donnée non sensible (prix publics) + app perso mono-utilisateur → accès anon permissif.
create policy "anon read"   on price_history for select using (true);
create policy "anon insert" on price_history for insert with check (true);
create policy "anon update" on price_history for update using (true) with check (true);

-- updated_at = vraie date de dernière écriture (le DEFAULT ne se déclenche qu'à l'INSERT ;
-- un upsert fait un UPDATE et laisserait updated_at figé sans ce trigger).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_price_history_updated_at on public.price_history;
create trigger trg_price_history_updated_at
  before insert or update on public.price_history
  for each row execute function public.set_updated_at();
```

> Note : ce projet a désactivé les clés legacy (anon/service_role) → utiliser la clé
> **publishable** (`sb_publishable_…`, récupérable via
> `GET https://api.supabase.com/v1/projects/<ref>/api-keys?reveal=true`) comme valeur
> `anonKey` dans `SERVER_STORE`. Table déjà provisionnée sur le projet `mjbmtubkhlspwfqhqgvq`.

---

# Snapshots quotidiens du patrimoine (table `nw_snapshots`, v386+)

Historique NW type Finary : chaque visite avec **prix live** fige l'arbre complet du
patrimoine (total/personne, cartes KPI par vue, chaque compte cash, chaque appartement
brute+nette, chaque position, créances, meta qualité) — `buildDailySnapshot(state)` dans
`js/engine.js`, ~5 Ko/jour, ids **stables snake_case** (`CASH_ACCOUNT_IDS`).

## Table (APPEND-ONLY — différent de price_history !)

```sql
create table public.nw_snapshots (
  snap_date  date not null,
  captured_at timestamptz not null default now(),
  quality    text not null default 'static' check (quality in ('live','partial','static')),
  data       jsonb not null check (pg_column_size(data) < 200000),
  primary key (snap_date, captured_at)
);
alter table public.nw_snapshots enable row level security;
create policy "nw_snap_read"   on public.nw_snapshots for select to anon using (true);
create policy "nw_snap_insert" on public.nw_snapshots for insert to anon
  with check (snap_date between date '2020-01-01' and current_date + 1);
-- PAS de policy UPDATE ni DELETE : un snapshot d'hier est IRREMPLAÇABLE (on ne peut pas
-- recalculer le NW passé). Même avec la clé publique, l'historique est infalsifiable.
-- Corrections admin uniquement via la Management API.
```

## Sémantique

- Plusieurs lignes possibles par jour (append) ; la « meilleure » est choisie **à la
  lecture** : qualité `live > partial > static`, puis `captured_at` max (`loadSnapshots`).
- Écriture : `maybeSaveDailySnapshot` (api.js) — insert seulement si 1ʳᵉ du jour, upgrade
  de qualité, ou raffinement > 4 h. **Jamais de capture en prix statiques** (une fausse
  chute deviendrait permanente).
- Date du jour = calendrier **Europe/Paris** (`parisDateISO`), pas UTC.
- Jours sans visite = trous assumés (forward-fill à l'affichage). Pas de seed depuis
  EQUITY_HISTORY dans la courbe NW (actions-only → serait des données inventées, purgées
  v86/v150) ; elle est rendue comme série séparée dans la vue Historique.

## Consommation

Vue **Analyse → 📈 Historique** : courbes NW (couple/amine/nezha), aires par catégorie,
explorateur de séries (~73 séries : chaque compte, bien, position, créance), profondeur
mensuelle actions. Deltas « vs hier » sur les cartes NW (`applySnapshotDeltas`, render.js).
Cache session `window._nwSnapCache`, préchargé à l'init (app.js).

## 2. Récupérer l'URL + la clé anon

**Project Settings → API** :
- **Project URL** : `https://xxxxxxxx.supabase.co`
- **anon public** key : `eyJ...` (la clé PUBLIQUE — surtout PAS la `service_role`)

## 3. Renseigner la config

Dans `js/api.js`, remplir la constante `SERVER_STORE` :

```js
const SERVER_STORE = {
  url: 'https://xxxxxxxx.supabase.co',
  anonKey: 'eyJ...',           // clé anon PUBLIQUE uniquement
  table: 'price_history',
  row: 'singleton',
};
```

Puis bump `?v=N` + commit + push (déploiement GitHub Pages ~60 s).

## 4. Vérifier

- 1er chargement (L1 + L2 vides) : backfill 5Y depuis Yahoo → upload vers L2 (console
  `[hist] L2 Supabase upload OK`).
- Chargement depuis une autre machine (L1 vide) : `[hist] L2 Supabase fusionné …` puis
  `0 backfill + N gap` → l'historique vient de L2, Yahoo n'est appelé que pour le delta.

## Notes

- Écritures concurrentes (2 machines) : chacune lit L2 puis y ajoute son gap ; les gaps Yahoo
  étant déterministes, les blobs convergent (last-write-wins acceptable en mono-utilisateur).
- Blob borné à ~1800 j/série (`_trimSeries`) → quelques centaines de Ko, très en dessous du
  free tier Supabase (500 Mo).
