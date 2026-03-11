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

## Conventions

- Montants en devise native dans data.js, conversion en EUR dans engine.js via `toEUR()`
- `fmt(val)` pour afficher un montant EUR formaté
- `fmtAxis(val)` pour axes de graphiques (notation K)
- Les insights dans render.js doivent utiliser `state.*` et `state.cashView.*`, jamais de constantes
- Les textes de conseil/recommandation sont OK s'ils sont génériques ("optimiser le placement") mais jamais avec des montants hardcodés
