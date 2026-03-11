# Architecture — Patrimonial Dashboard

> Guide pour IA / développeur qui doit modifier le site.
> Version courante : **v91** | Déployé sur GitHub Pages : `lallakenza.github.io/networth/`

## Principe fondamental

**Zéro hardcode.** Toute valeur affichée doit provenir de `data.js` (données brutes) ou être calculée dynamiquement par `engine.js`. Ne jamais écrire de montants, noms de comptes, ou textes de conseil en dur dans render.js ou index.html.

## Pipeline de données

```
data.js  →  engine.js  →  render.js  →  DOM (index.html)
  (raw)      (compute)     (display)      (structure)
                ↓
            charts.js (Chart.js visualisations)
            simulators.js (projections interactives)
```

## Fichiers

| Fichier | Rôle | Quand modifier |
|---------|------|----------------|
| `js/data.js` | Données brutes en devise native (AED, MAD, EUR, USD, JPY). Constantes immo, taux, créances. | Mise à jour bimensuelle des soldes, ajout de compte/bien |
| `js/engine.js` | Calculs purs : `compute(PORTFOLIO, fx)` → state object. Pas de DOM. | Ajout de logique de calcul (nouveau type d'actif, diagnostic) |
| `js/render.js` | Lecture du state → mise à jour du DOM. Exports : `render(state)`, `fmt()` | Ajout d'affichage, modification de layout |
| `js/charts.js` | Chart.js : création/destruction de graphiques. Lit state, pas le DOM. | Ajout de graphique |
| `js/simulators.js` | 3 simulateurs de projection (couple, Amine, Nezha) | Modification des projections |
| `js/api.js` | Fetch FX (frankfurter.dev) + stock prices (Yahoo Finance chart API) | Ajout de source de prix |
| `index.html` | Structure HTML + CSS. Pas de logique. | Ajout de sections UI |

## Comment ajouter un nouveau bien immobilier

1. **data.js** : ajouter dans `PORTFOLIO.{owner}.immo` un objet avec `value`, `appreciation`, `purchaseDate`, `purchasePrice`, `surface`
2. **data.js** : ajouter les prêts dans `IMMO_CONSTANTS.loans.{key}Loans[]`
3. **data.js** : ajouter les charges dans `IMMO_CONSTANTS.charges.{key}`
4. **data.js** : ajouter le loyer dans `IMMO_CONSTANTS.properties.{key}`
5. **engine.js** : `buildProperty()` le détecte automatiquement via `IMMO_CONSTANTS`
6. **render.js** : les property cards se génèrent dynamiquement

## Comment ajouter un nouveau compte cash

1. **data.js** : ajouter le montant dans `PORTFOLIO.{owner}.{zone}`
2. **data.js** : ajouter le taux dans `CASH_YIELDS.{key}`
3. **engine.js** : ajouter dans `computeCashView()` → section "Build accounts list"
4. Le diagnostic dormant se détecte automatiquement (rendement < 3%)

## Comment ajouter une nouvelle position IBKR

1. **data.js** : ajouter dans `PORTFOLIO.amine.ibkr.positions[]` : `{ ticker, shares, avgCost, currency }`
2. **api.js** : `fetchStockPrices()` le récupère automatiquement via Yahoo Finance
3. **engine.js** : `computeIBKRPositions()` le traite automatiquement

## Cache busting

Chaque module importe les autres avec `?v=XX`. À chaque commit, incrémenter le numéro dans **tous les fichiers** :
- `app.js`, `engine.js`, `render.js`, `charts.js`, `simulators.js`, `index.html`
- Les fichiers `apt_*.html` ne sont plus liés mais gardent leur version

## Diagnostics (engine.js → cashView.diagnostics)

Système générique — ne jamais hardcoder de noms de comptes :
- `summary` : bilan global (% dormant, manque à gagner)
- `dormant_{owner}` : comptes < 3% par propriétaire (détection auto)
- `sub_optimal` : comptes > 0% mais < 1.5% avec > 5K€
- `jpy_leverage` : info sur l'emprunt JPY si > 5K€
- `action_plan` : étapes générées dynamiquement à partir des diagnostics ci-dessus

## Vues (tabs)

| Tab | ID | State key |
|-----|----|-----------|
| Couple | `couple` | `state.couple.*` |
| Amine | `amine` | `state.amine.*` |
| Nezha | `nezha` | `state.nezha.*` |
| Cash | `cash` | `state.cashView` |
| Actions | `actions` | `state.actionsView` |
| Immobilier | `immobilier` | `state.immoView` |
| Budget | `budget` | `state.budgetView` |

## Mise à jour des données — Checklist

À chaque session de mise à jour, l'IA doit vérifier l'ancienneté des données et mettre à jour ce qui est périmé.

### Données temps-réel (récupérées automatiquement par api.js)
- **Taux FX** : récupérés live via frankfurter.dev → pas besoin de toucher `FX_STATIC` sauf si l'API plante
- **Cours actions IBKR** : récupérés live via Yahoo Finance chart API → les `price` dans `positions[]` servent de fallback

### Données à mettre à jour manuellement dans data.js

| Donnée | Fréquence | Source | Comment vérifier l'ancienneté |
|--------|-----------|--------|-------------------------------|
| Soldes bancaires (cash UAE, Maroc, Revolut, IBKR cash) | Chaque session | Apps bancaires, IBKR | Commentaires `mis à jour` dans data.js |
| Positions IBKR (shares, costBasis) | Si nouveau trade | CSV IBKR ou fichier utilisateur | Comparer `trades[]` dernière date vs aujourd'hui |
| Cours SGTM (`market.sgtmPriceMAD`) | Si > 1 semaine | casablanca-bourse.com | Commentaire date dans data.js |
| Cours ACN (`market.acnPriceUSD`) | Si > 1 semaine | Fidelity / Yahoo Finance | Commentaire date dans data.js |
| CRD immobilier | Mensuel | Tableau d'amortissement | Comparer au schedule calculé par engine |
| Créances | Quand payées/ajoutées | Factures | Vérifier items[] dans creances |
| Véhicules | Trimestriel | Argus / La Centrale | Commentaire date |
| `FX_STATIC` | Si > 2 semaines | xe.com | Commentaire date dans data.js |
| `CASH_YIELDS` | Si taux changent | Sites banques | Commentaire date |
| `staticNAV` (IBKR) | Chaque mise à jour IBKR | Rapport CSV IBKR | Doit correspondre à NAV du CSV |

### Règle d'ancienneté automatique

Au début de chaque session, l'IA doit :
1. Lire les dates dans les commentaires de `data.js`
2. Si les cours stocks (SGTM, ACN) ont **> 7 jours** → les mettre à jour (web search ou fichier utilisateur)
3. Si les soldes bancaires ont **> 14 jours** → demander à l'utilisateur les soldes actuels
4. Si `FX_STATIC` a **> 14 jours** → mettre à jour depuis xe.com
5. Toujours bumper le numéro de version `?v=XX` dans tous les imports après modification

## Comment traiter un fichier CSV / relevé IBKR

L'utilisateur fournit régulièrement un export IBKR (CSV ou PDF). Voici comment l'interpréter :

### 1. Identifier les nouvelles opérations

Comparer les trades du fichier avec `PORTFOLIO.amine.ibkr.trades[]` dans data.js.
Tout trade dont la date + ticker + qty n'existe pas encore doit être ajouté.

### 2. Format des trades dans data.js

```javascript
// Achat
{ date: 'YYYY-MM-DD', ticker: 'AIR.PA', label: 'Airbus', type: 'buy',
  qty: 100, price: 196.50, currency: 'EUR', cost: 19650,
  commission: -9.83, costBasis: 192.58, source: 'ibkr' }

// Vente
{ date: 'YYYY-MM-DD', ticker: 'GLE', label: 'Société Générale', type: 'sell',
  qty: 200, price: 75.34, currency: 'EUR', proceeds: 15068,
  realizedPL: 4807.34, commission: -7.53, costBasis: 76.24, source: 'ibkr' }

// FX trade
{ date: 'YYYY-MM-DD', ticker: 'EUR.JPY', label: 'EUR→JPY (short)', type: 'fx',
  qty: 65926, price: 183.595, currency: 'EUR', jpyAmount: 12103684,
  commission: -1.72, note: 'Rachat JPY short', source: 'ibkr' }
```

### 3. Mettre à jour les positions après un trade

Après ajout d'un trade, mettre à jour la section `positions[]` :

| Opération | Action sur positions[] |
|-----------|----------------------|
| **Achat d'une action existante** | Mettre à jour `shares` (nouveau total) et `costBasis` (nouveau PRU moyen du CSV) |
| **Achat d'une nouvelle action** | Ajouter une nouvelle entrée dans `positions[]` avec ticker, shares, price, costBasis, currency, label, sector, geo |
| **Vente partielle** | Réduire `shares`. Le `costBasis` reste le même (PRU moyen). Ajouter le realizedPL dans meta.realizedPL |
| **Vente totale (clôture)** | Supprimer l'entrée de `positions[]`. Ajouter le realizedPL dans meta.realizedPL |
| **Trade FX** | Mettre à jour `cashEUR`, `cashUSD`, `cashJPY` selon les montants convertis |

### 4. Mettre à jour les agrégats IBKR

Après tout changement :
- `staticNAV` : NAV totale du rapport CSV (ligne "Net Asset Value")
- `meta.deposits` : si dépôt/retrait détecté
- `meta.realizedPL` : somme de tous les realizedPL des sells
- `meta.dividends` : si dividendes reçus
- `meta.commissions` : cumul commissions

### 5. Mettre à jour le cash IBKR

Le CSV IBKR donne les soldes cash par devise :
- `cashEUR` : solde EUR (attention au seuil IBKR 10K à 0%)
- `cashUSD` : solde USD
- `cashJPY` : solde JPY (négatif = emprunt short JPY)

## Mise à jour des insights (render.js)

Les insights dans `renderDynamicInsights()` sont 100% dynamiques — ils lisent `state.*` et `state.cashView.*`. **Ils ne doivent jamais contenir de montants, noms de comptes, ou conseils spécifiques en dur.**

### Règles pour les insights
- Utiliser `state.cashView.accounts` pour lister les comptes dynamiquement
- Utiliser `state.immoView.properties` pour les données immo
- Utiliser `state.actionsView` pour les données actions
- Les textes de conseil doivent être génériques : "Optimiser le placement" au lieu de "Transférer vers Wio"
- Les montants doivent toujours être calculés : `K(cashTotal)` au lieu de `"85K€"`
- Les projections doivent utiliser les données réelles (CF immo, rendement actuel) et jamais des constantes

### Si on ajoute un nouvel insight
1. Calculer les valeurs depuis `state.*` dans `renderDynamicInsights()`
2. Utiliser `fmt()` / `K()` / `N()` pour le formatage
3. Ne jamais mentionner un compte par son nom en dur — utiliser `accounts.find()` ou `accounts.filter()`

## Conventions

- Montants en devise native dans data.js, conversion en EUR dans engine.js via `toEUR()`
- `fmt(val)` pour afficher un montant EUR formaté
- `fmtAxis(val)` pour axes de graphiques (notation K)
- Les insights dans render.js doivent utiliser `state.*` et `state.cashView.*`, jamais de constantes
- Les textes de conseil/recommandation sont OK s'ils sont génériques ("optimiser le placement") mais jamais avec des montants hardcodés
