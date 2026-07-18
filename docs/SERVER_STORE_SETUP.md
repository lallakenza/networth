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
```

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
