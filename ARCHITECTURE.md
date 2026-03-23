# Architecture — Dashboard Patrimonial

> Dernière mise à jour : 24 mars 2026 (v221)
> Repo : `lallakenza/networth` — GitHub Pages
> URL : https://lallakenza.github.io/networth/

---

## 1. Vue d'ensemble

Application statique (zero backend) qui calcule et affiche le patrimoine net du couple Amine & Nezha. Toutes les données sont dans `data.js`, toutes les computations dans `engine.js`, tout le rendu dans `render.js`. Les prix live viennent de Yahoo Finance via CORS proxy.

```
index.html          ← Structure HTML + CSS
  └─ js/app.js      ← Orchestrateur (imports, init, event handlers)
       ├─ js/data.js     ← Données brutes (positions, trades, dépôts, config)
       ├─ js/engine.js   ← Calculs purs (NAV, P/L, coûts, simulations immo)
       ├─ js/render.js   ← DOM write-only (formatage, tables, insights)
       ├─ js/charts.js      ← Chart.js (évolution NAV, allocations, CF projection)
       ├─ js/simulators.js  ← Simulateurs de projection patrimoine (20 ans)
       └─ js/api.js         ← Yahoo Finance API (FX live, prix actions, historique)
```

### Principes architecturaux

- **Séparation stricte** : `data` → `engine` → `render`. Aucun module ne remonte la chaîne.
- **Zéro valeur hardcodée** : Tous les coûts (commissions, FTT, intérêts, dividendes) sont calculés dynamiquement depuis les données brutes dans `data.js`.
- **Multi-devises natif** : Chaque montant est stocké dans sa devise native (EUR, USD, JPY, AED, MAD). La conversion en EUR se fait dans `engine.js` via `toEUR()`.
- **Cache-busting** : Chaque import utilise `?v=N` pour forcer le navigateur à charger la dernière version après un déploiement.
- **Fallback statique** : Si l'API Yahoo est indisponible, les prix statiques dans `data.js` sont utilisés.

---

## 2. Fichiers — Responsabilités détaillées

### `data.js` (~1 716 lignes)

Couche de données brutes. **Aucune computation.** Contient :

| Section | Description |
|---------|-------------|
| `PORTFOLIO.amine.uae` | Soldes bancaires UAE (Mashreq, Wio, Revolut) en AED |
| `PORTFOLIO.amine.maroc` | Soldes bancaires Maroc (Attijari, Nabd) en MAD |
| `PORTFOLIO.amine.espp` | Actions Accenture (lots ESPP avec cost basis USD) |
| `PORTFOLIO.amine.ibkr` | **Positions IBKR** (13 lignes), cash multi-devises, costs[], acnDividends[], deposits[], trades[] |
| `PORTFOLIO.amine.immo` | Immobilier (Vitry — valeur, CRD, loyers) |
| `PORTFOLIO.amine.vehicles` | Véhicules (Cayenne, Mercedes) |
| `PORTFOLIO.amine.creances` | Créances (SAP, Malt, loyers impayés, prêts perso) |
| `PORTFOLIO.amine.degiro` | Compte Degiro fermé (P/L réalisé, deposits[], dividendes) |
| `PORTFOLIO.amine.allTrades` | Historique unifié Degiro 2020-2025 |
| `PORTFOLIO.nezha.*` | Patrimoine Nezha (banques, ESPP, SGTM) |
| `CASH_YIELDS` | Rendements par compte bancaire |
| `IBKR_CONFIG` | Taux IBKR par tranche (JPY margin tiers) |
| `FX_STATIC` | Taux de change fallback |
| `WHT_RATES` | Retenues à la source par pays |
| `DIV_YIELDS` / `DIV_CALENDAR` | Rendements dividendes et calendrier ex-dates |
| `BUDGET_EXPENSES` | Dépenses mensuelles fixes |
| `IMMO_CONSTANTS` | Prêts immo (single + multi-loan), charges mensuelles, métadonnées propriétés, régimes fiscaux, config VEFA — voir §20 |

#### Conventions data.js

- **Devises natives** : Jamais de conversion dans data.js. Un montant AED reste en AED.
- **Commissions** : Le champ `t.commission` est en devise native du trade (EUR, USD, JPY). `engine.js` convertit via `toEUR()`.
- **FTT** : **PAS** incluse dans `t.commission`. Calculée séparément par `engine.js` (`FTT_RATE × cost`).
- **Dépôts** : Chaque virement a sa date, montant, devise et `fxRateAtDate`. Les retraits ont un montant négatif.

### `engine.js` (~3 233 lignes)

Calculs purs. Exporte `compute(portfolio, fx, stockSource) → STATE`.

| Fonction | Rôle |
|----------|------|
| `toEUR(amount, currency, fx)` | Conversion devise → EUR |
| `computeIBKR()` | NAV IBKR (positions + cash multi-devises) |
| `computeIBKRPositions()` | Détail par position avec P/L période (MTD/YTD/1M/3M) |
| `computeFTT(startDate)` | FTT dynamique : 0.4% × coût achats éligibles |
| `computeCommissions(startDate)` | Somme des `t.commission` (converti en EUR) |
| `computeInterest(startDate)` | Intérêts marge depuis `ibkr.costs[]` |
| `computeIBKRDividends(startDate)` | Dividendes IBKR nets |
| `computeACNDividends(startDate)` | Dividendes Accenture (ESPP) avec WHT 15% |
| `computeAllCosts()` | Agrège tous les coûts (YTD + all-time) |
| `computeImmoView()` | Simulations immobilières (amort, CF, plus-value, fiscalité, exit costs) — voir §20 |
| `getGrandTotal()` | Grand total patrimoine (IBKR + ESPP + cash + immo + créances) |

#### FTT — Taxe sur les Transactions Financières

```javascript
const FTT_ELIGIBLE = new Set([
  'MC.PA','DG.PA','FGR.PA','GLE','SAN.PA','EDEN',
  'RMS.PA','OR.PA','BN.PA','WLN','AIR.PA'
]);
const FTT_RATE = 0.004; // 0.4% — vérifié vs statement IBKR
```

- **Source vérité** : Section "Transaction Fees" du CSV IBKR.
- **Taux** : 0.4% (pas 0.3% — le taux AMF officiel est 0.3% mais IBKR facture 0.4% en incluant ses frais de collecte).
- **Éligibilité** : Stocks français large-cap cotés Euronext Paris. Airbus (AIR.PA) est éligible malgré le siège aux Pays-Bas car coté Paris. Nexity (NXI) est exclue (small cap).

### `render.js` (~5 481 lignes)

DOM write-only. Reçoit STATE de engine.js, met à jour le DOM.

| Section | Lignes | Rôle |
|---------|--------|------|
| Formatage (fmt, fmtAxis) | 1-50 | Formateurs numériques (€ 1 234, €12.3K) |
| Table positions | 100-500 | Table IBKR avec tri, colonnes toggleables |
| Insights panel | 1970-2100 | Cards : track record, concentration, coûts, recommandations |
| Degiro historique | 1800-1960 | Table positions fermées Degiro |
| Immo views | 2500+ | Simulations immobilières (Vitry, Rueil, Villejuif) |

#### Panel Coûts (type === 'costs')

Le panel coûts est **expandable** (cliquer sur "▼ Détails") et affiche :
- Commissions courtier (YTD)
- FTT (YTD)
- Intérêts marge (YTD)
- Dividendes nets (YTD)
- Impact net (coûts - dividendes)
- Ligne all-time en bas

### `charts.js` (~3 301 lignes)

Gère tous les graphiques Chart.js.

| Fonction | Rôle |
|----------|------|
| `destroyAllCharts()` | Détruit tous les charts **sauf** `portfolioYTD` (voir bug fix v175) |
| `rebuildAllCharts()` | Reconstruit charts pour la vue active (couple/amine/nezha) |
| `buildPortfolioYTDChart()` | **Chart principal** — Simulation forward NAV (YTD ou 1Y) |
| `redrawChartForPeriod()` | Toggle MTD/1M/3M/YTD/1Y |
| `buildCFProjection()` | Projection cash flow immobilier |

#### Simulation Forward NAV (buildPortfolioYTDChart)

C'est le cœur du chart d'évolution. Algorithme :

1. **Calibration jour 1** : NAV de départ = valeur connue (209 495 € pour YTD, 0 € pour 1Y)
2. **Données historiques** : Prix Yahoo Finance (`range=1y` ou `range=ytd`)
3. **Simulation jour par jour** :
   - Appliquer les trades (buy → augmente positions + diminue cash)
   - Appliquer les FX trades (shift entre EUR/USD/JPY/AED)
   - Appliquer les dépôts (augmente cash EUR, sauf AED → voir ci-dessous)
   - Appliquer les coûts (intérêts, dividendes, FTT)
   - NAV(j) = positions_value(j) + cash_EUR + cash_USD/EURUSD + cash_JPY/EURJPY
4. **Échantillonnage hebdomadaire** (mode 1Y) : ~52 points au lieu de ~250

#### Gestion des dépôts AED dans le chart

Les dépôts AED (ex: Mashreq → IBKR) ne sont **PAS** ajoutés directement au cash EUR. Le flux est :
1. Dépôt AED arrive sur IBKR → va dans un solde AED non tracké par le chart
2. Trade FX EUR.AED convertit l'AED en EUR → **ajoute** au cash EUR (`cashEUR += e.qty`)
3. Le chart ne track que EUR, USD, JPY — l'AED est un transit

```javascript
// Dépôt AED → ignoré (le FX trade gère le crédit EUR)
if (e.currency && e.currency !== 'EUR') { /* skip */ }

// FX EUR.AED → ajoute EUR (l'utilisateur achète EUR avec AED)
cashEUR += e.qty;
```

### `api.js` (~750 lignes)

Fetch live via Yahoo Finance CORS proxies.

| Fonction | Rôle |
|----------|------|
| `fetchFXRates()` | Taux EUR/USD, EUR/JPY, EUR/AED, EUR/MAD |
| `fetchStockPrices()` | Prix live 14 positions |
| `retryFailedTickers()` | Retry loop (max 3 rounds) |
| `fetchTickerHistory()` | Historique par ticker avec déduplication dates (v217) |
| `fetchHistoricalPricesYTD()` | Yahoo `range=ytd` pour chart |
| `fetchHistoricalPrices1Y()` | Yahoo `range=1y` pour chart 1Y |
| `fetchSoldStockPrices()` | Prix pour "Si gardé aujourd'hui" (positions fermées) |

Cache localStorage 10 min pour éviter les appels redondants.

### `app.js` (~1 106 lignes)

Orchestrateur. Gère :
- Initialisation et imports
- Event handlers (tabs, toggles, refresh)
- Flux async : `loadStockPrices()` (chart YTD) en parallèle de `refreshFX()` (taux live)
- Race condition fix : `destroyAllCharts()` préserve `charts.portfolioYTD` (v175)
- `unifyPrices()` : injection des prix Quote API dans les données Chart API (v218)
- Post-chart `refresh()` : re-render positions table avec `_chartBreakdown` (v219)

### `simulators.js` (~836 lignes)

Moteur de simulation de projection patrimoniale sur 20 ans. Exporté via `initSimulators(state)` et `bindSimulatorEvents(state, refreshFn)`.

| Fonction | Rôle |
|----------|------|
| `runSimulatorGeneric(config)` | Moteur générique : projection mensuelle avec épargne, rendements, immobilier, stop year |
| `buildSimChart(canvasId, chartKey, result)` | Construit un Chart.js stacked area (Immo, Capital, Gains, NW Total) avec légende interactive |
| `makeComputePropertyEquity(iv, loanKey, initialValue)` | Fabrique une fonction `(m) → equity nette` pour une propriété (amort + appreciation - exit costs) |
| `runCoupleSimulator(state)` | Simulateur couple : 3 propriétés (Vitry, Rueil, Villejuif), pool actions+cash, contributions mensuelles |
| `runAmineSimulator(state)` | Simulateur Amine : Vitry seul, pool actions+cash personnel |
| `runNezhaSimulator(state)` | Simulateur Nezha : Rueil + Villejuif (livraison décalée), cash + SGTM, pas de contributions mensuelles |
| `runOpportunityCostSim()` | Calculateur coût d'opportunité : valeur future d'une dépense avec intérêts composés |

#### Architecture du moteur générique

`runSimulatorGeneric(config)` reçoit un objet de configuration :

```javascript
{
  prefix,           // ID DOM pour affichage (cplSim, amSim, nzSim)
  monthlySavings,   // Épargne mensuelle
  pctActions,       // % alloué aux actions (reste → cash)
  returnActions,    // Rendement annuel actions (ex: 0.10 = 10%)
  returnCash,       // Rendement annuel cash (ex: 0.06 = 6%)
  horizonYears,     // Horizon de projection (ex: 20)
  stopYears,        // Arrêt des contributions après N années (0 = jamais)
  startNW, startImmoEquity, startPoolActions, startPoolCash,
  staticAssets,     // Véhicules, TVA, etc. (constant)
  existingGains,    // Gains déjà réalisés (déduits de la base)
  immoGrowthFn,     // (m) → delta equity immo pour le mois m
  immoBreakdown,    // [{label, startEquity, growthFn, _computedEquity}] par propriété
}
```

Le moteur itère mois par mois : il compose les rendements sur les pools actions/cash, ajoute les contributions (si < stopMonth), et appelle `immoGrowthFn(m)` pour le delta immobilier. Le résultat contient 6 séries temporelles : `dataNW`, `dataImmo`, `dataBase`, `dataGains`, `dataNWNoStop`, + breakdown par propriété.

#### Equity nette par propriété (makeComputePropertyEquity)

Pour chaque propriété, la fonction calcule :
1. **CRD** : lookup dans le tableau d'amortissement à la date `YYYY-MM` cible
2. **Valeur** : appreciation composée depuis la valeur actuelle, avec phases (taux différent par tranche d'années)
3. **Exit costs** : interpolation linéaire entre années (IRA, frais agence, plus-value) pour éviter les sauts en escalier
4. **Equity nette** = `max(0, valeur - CRD - exitCosts)`

Le Villejuif n'apparaît qu'à partir de `IC.villejuifStartMonth` (livraison VEFA ~été 2029).

#### Chart stacked area interactif

Chaque simulateur produit un Chart.js avec 4 bandes empilées + ligne NW Total. La légende est interactive : cliquer sur une bande l'isole (re-stack uniquement les sélectionnées). Si seul "Immobilier" est sélectionné et qu'un `immoBreakdown` existe, des sous-bandes par propriété apparaissent dynamiquement.

Le chart couple/amine supporte un "stop year" (arrêt des contributions) visualisé par une ligne pointillée rouge verticale + série fantôme "NW sans arrêt" en pointillés.

---

## 3. Déploiement

### GitHub Pages

Le site est servi depuis la branche `main` de `lallakenza/networth`. Déploiement via GitHub Git API (Python) :

```
get ref → create blobs → create tree → create commit → update ref
```

Token : `ghp_***` (voir script de déploiement local)

### Cache-busting

Chaque fichier JS est importé avec `?v=N` :
```javascript
import { compute } from './engine.js?v=178';
```

Après chaque déploiement, **bumper le numéro** dans :
1. `app.js` (imports de data, engine, render, api, charts, simulators)
2. `index.html` (import de app.js)
3. `render.js` (imports de data, engine)
4. `charts.js` (imports de render, engine, data)
5. `simulators.js` (imports de render, data)

> **Version actuelle : v221** (mars 2026)

---

## 4. Réconciliation IBKR

### Source vérité

Le fichier CSV IBKR (Activity Statement U18138426) est la source vérité pour :
- Commissions (section "Commissions" dans "Change in NAV")
- FTT (section "Transaction Fees")
- Intérêts (section "Interest")
- Dividendes (section "Dividends")
- WHT (section "Withholding Tax")
- Dépôts/Retraits (section "Deposits & Withdrawals")

### Chiffres clés au 19/03/2026

| Métrique | IBKR Statement | Dashboard | Statut |
|----------|---------------|-----------|--------|
| Commissions | -€217.31 | -€217 | ✅ OK |
| FTT (Transaction Fees) | -€666.87 | ~-€667 (calculé) | ✅ OK |
| Intérêts | -€512.34 | -€512 | ✅ OK |
| Dividendes | +€648.53 | +€649 | ✅ OK |
| WHT | -€164.41 | Non tracké séparément | ⚠️ À ajouter |
| Dépôts & Retraits | €199,886.10 | ~€199,930 | ✅ OK (~€44 d'écart FX) |
| NAV | €187,864.62 | ~€185,084 (prix live) | ✅ OK (écart = prix live vs clôture 19/03) |
| TWR | +20.76% | -13.7% (YTD 2026 only) | ✅ Scopes différents |

### Bugs corrigés (v176-v178)

| Bug | Avant | Après | Cause racine |
|-----|-------|-------|--------------|
| FTT rate | 0.3% (€477) | 0.4% (€667) | Taux AMF vs taux facturé IBKR |
| FTT eligible | 9 tickers | 11 tickers | WLN et AIR.PA manquaient |
| Commissions | €1,086 | €217 | ¥871 Shiseido compté comme €871 (pas de conversion devise) |
| Dépôts | €202,886 (EUR seul) | €199,886 (EUR + AED) | Dépôts AED manquants, retrait -45K manquant |
| Chart 1Y NAV | €288K (gonflé) | €185K (correct) | AED deposits ajoutés comme EUR + FX EUR.AED dans le mauvais sens |
| Panel coûts | Statique (non cliquable) | Expandable avec breakdown | Manquait l'interactivité |
| Chart 1Y | ~250 points (dense) | ~52 points (hebdomadaire) | Pas d'échantillonnage |
| Chart YTD blank | Canvas vide après refresh | Préservé | Race condition destroyAllCharts vs loadStockPrices |

---

## 5. Guide de mise à jour

### Ajouter un nouveau trade IBKR

1. Ouvrir `data.js` → `PORTFOLIO.amine.ibkr.trades[]`
2. Ajouter l'entrée **en devise native** :
   ```javascript
   { date: 'YYYY-MM-DD', ticker: 'XX.PA', label: 'Nom', type: 'buy',
     qty: 100, price: 50.00, currency: 'EUR', cost: 5000,
     commission: -2.50, costBasis: 50.00, source: 'ibkr' }
   ```
3. **⚠ La commission est en devise native** du trade (EUR, USD, JPY).
4. **⚠ La FTT n'est PAS dans la commission** — elle est calculée automatiquement par `engine.js`.

### Mettre à jour les positions

1. `PORTFOLIO.amine.ibkr.positions[]` : mettre à jour `shares`, `price` (fallback statique)
2. `cashEUR`, `cashUSD`, `cashJPY` : soldes cash IBKR
3. Les prix live écrasent les prix statiques quand l'API Yahoo répond.

### Ajouter un dépôt/retrait

1. `PORTFOLIO.amine.ibkr.deposits[]` :
   ```javascript
   { date: 'YYYY-MM-DD', amount: 10000, currency: 'EUR', fxRateAtDate: 1, label: 'Virement' }
   ```
2. **Retrait** = montant négatif : `amount: -5000`
3. **Dépôt AED** : utiliser `currency: 'AED'` et le taux EUR/AED du jour dans `fxRateAtDate`

### Ajouter des intérêts mensuels

1. `PORTFOLIO.amine.ibkr.costs[]` :
   ```javascript
   { date: 'YYYY-MM-DD', type: 'interest', eurAmount: -50, usdAmount: -10, jpyAmount: -5000, label: 'Interest MMM-YYYY' }
   ```
2. Les montants sont dans leurs devises natives. `engine.js` convertit en EUR.

### Déployer

```bash
python3 deploy_vXXX.py  # script de déploiement
```

Après chaque déploiement, **toujours bumper les `?v=N`** dans tous les fichiers qui importent les modules modifiés.

---

## 6. Flux de données

```
                    ┌──────────────┐
                    │  Yahoo API   │
                    │  (FX + Prix) │
                    └──────┬───────┘
                           │ fetchFXRates() / fetchStockPrices()
                           ▼
┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ data.js  │────▶│  engine.js   │────▶│  render.js   │────▶│     DOM      │
│ (brut)   │     │  (compute)   │     │  (format)    │     │  (visible)   │
└──────────┘     └──────┬───────┘     └──────────────┘     └──────────────┘
                        │
                        ▼
                 ┌──────────────┐
                 │  charts.js   │────▶ Canvas (Chart.js)
                 │  (graphiques)│
                 └──────────────┘
```

### Flux async (app.js)

```
Page load
  ├─ compute(PORTFOLIO, FX_STATIC, 'static')     // rendu initial immédiat
  ├─ refreshFX()                                   // async — MAJ taux live
  │    └─ refresh() → rebuildAllCharts()           // re-render avec taux live
  └─ loadStockPrices()                             // async — prix Yahoo (Quote API)
       ├─ compute(PORTFOLIO, liveFX, 'live')       // re-render avec prix live
       ├─ fetchHistoricalPricesYTD()               // données chart (Chart API)
       ├─ unifyPrices(historicalData)              // injecte prix Quote dans Chart (v218)
       ├─ buildPortfolioYTDChart()                 // construit chart → _chartBreakdown
       └─ refresh()                                // re-render table avec _chartBreakdown (v219)
```

**Race condition** (corrigée v175) : `refreshFX()` appelle `destroyAllCharts()` qui détruisait le chart YTD construit par `loadStockPrices()`. Fix : `destroyAllCharts()` préserve `charts.portfolioYTD`.

---

## 7. Vues disponibles

| Onglet | Contenu |
|--------|---------|
| COUPLE | NW total Amine + Nezha, répartition, historique |
| AMINE | Détail patrimoine Amine (cash, actions, immo, créances) |
| NEZHA | Détail patrimoine Nezha |
| ACTIONS | Cockpit IBKR + ESPP + SGTM : positions, chart NAV, insights |
| CASH | Répartition cash multi-devises, rendements, optimisation |
| IMMOBILIER | Simulations Vitry/Rueil/Villejuif (amortissement, CF, régimes fiscaux) |
| CRÉANCES | Suivi créances (pro + perso) avec probabilités et statuts |
| BUDGET | Dépenses mensuelles par zone et type |

---

## 8. Historique des versions critiques

| Version | Date | Changements |
|---------|------|-------------|
| v173 | Mars 2026 | Ajout de `simulators.js`, refactor engine.js (zéro hardcodé) |
| v174 | Mars 2026 | Ajout bouton 1Y, fix chart labels |
| v175 | Mars 2026 | Fix race condition `destroyAllCharts` (chart YTD blank) |
| v176 | Mars 2026 | **Audit IBKR** : FTT 0.4%, commissions EUR conversion, dépôts corrigés |
| v177 | Mars 2026 | Fix cache busters pour v176 |
| v178 | Mars 2026 | Chart 1Y échantillonnage hebdomadaire, fix AED deposits dans chart |
| v179-v187 | Mars 2026 | P&L breakdown complet dans le chart (positions, FX, cash, coûts) — itérations multiples pour affiner la ventilation |
| v188 | Mars 2026 | Chart breakdown : ventilation détaillée par position avec M2M par ticker, sous-totaux par catégorie (stocks, crypto, FX/cash, coûts) |
| v189 | 21 Mars 2026 | **EUR cash calibration IBKR** + **JPY FX/flow decomposition** — voir §9 ci-dessous |
| v190 | 21 Mars 2026 | **Data fixes** : 6 dividendes IBKR manquants (GLE, DG, MC, QQQM×3), ACN $1.63→$1.48 FY2025, FX historique ACN, FTT 0.3%→0.4% dans charts.js, QQQM retiré FTT, AIR.PA ajouté FTT |
| v191 | 21 Mars 2026 | **KPI flash fix** : placeholder "–" pour KPIs chart-overridden avant chargement chart (élimine flash -44K→-29K) |
| v192 | 21 Mars 2026 | **KPI persistence** : sauvegarde valeurs chart dans `window._chartKPIOverrides`, restauration au re-render (fix "c quoi ce bordel" tab switch) |
| v193 | 21 Mars 2026 | **Breakdown P&L fix** : soustraction flux de capital (achats/ventes) du M2M position → vrai P&L. Fix Effet FX/Cash (-224K→-1.8K). Fix vue P&L qui switch à Valeur au changement de période |
| v194-v199 | 21-22 Mars 2026 | Ajout ESPP + SGTM dans le chart d'évolution (4 séries : IBKR, ESPP, SGTM, Total) |
| v200 | 22 Mars 2026 | **Scope per-platform** : 5 boutons (IBKR, ESPP, Degiro, Maroc, Tous) pour filtrer le chart et les KPIs |
| v201 | 22 Mars 2026 | Refactor scope : toujours calculer les 4 séries, sélectionner l'affichage via `scope` (pas via `includeESPP`/`includeSGTM`) |
| v202 | 22 Mars 2026 | Fix `ReferenceError: Cannot access 'scope' before initialization` (temporal dead zone `const`) |
| v203 | 22 Mars 2026 | **Dépôts Degiro estimés** : 50K dépôts + 101K retrait (capital + P&L). ⚠ Montants fictifs à confirmer |
| v204-v205 | 22 Mars 2026 | Fix imports cross-modules : aligner toutes les versions `?v=` dans charts.js, render.js, app.js pour éviter le chargement double (SyntaxError `Identifier already declared`) |
| v206 | 22 Mars 2026 | **Animation auth page** : grille 1000 carrés (40×25) représentant 1M€, remplissage spiral avec compteur animé |
| v207 | 22 Mars 2026 | Refactor animation : remplissage bottom-up (eau qui monte) au lieu de spiral, dégradé vert profondeur→surface |
| v208 | 22 Mars 2026 | Animation plus lente (BATCH_SIZE 12→5, INTERVAL 10→30ms) + color-shift organique après remplissage (palette vert/teal, sin wave) |
| v209 | 22 Mars 2026 | Pattern Snake : remplissage en serpentin (droite→gauche puis gauche→droite alternant par rangée), BATCH_SIZE=2, INTERVAL=12ms |
| v210 | 22 Mars 2026 | **Degiro chart grey-out** : scope 'degiro' affiche un placeholder grisé avec hachures au lieu de données IBKR incorrectes. Message "Compte clôturé". Appliqué aux 3 fonctions chart |
| v211 | 22 Mars 2026 | **Refactor unifié** : rendu portfolio chart pour toutes les combinaisons scope/mode/period. Dynamic ESPP shares + SGTM pre-IPO pricing |
| v212 | 22 Mars 2026 | Degiro comme vrai scope chart (pas fallback IBKR) + grey styling. KPI cards scope-aware |
| v213-v214 | 22 Mars 2026 | Fix Degiro pct leak, titre P&L qui affiche la période au changement de scope |
| v215 | 23 Mars 2026 | **Fix P&L 1Y KPI** : incohérence entre chargement initial et scope toggle (séquence silent rebuild) |
| v216 | 23 Mars 2026 | **Fix additivité P&L 1Y** : mismatch dépôts/NAV Degiro dans le scope 'Tous' |
| v217 | 23 Mars 2026 | **Fix Daily P&L = 0** : Yahoo Chart API retourne 2 entrées pour le même jour (previous close + live intraday). Ajout déduplication dans `fetchTickerHistory()` — garder la DERNIÈRE valeur (= prix live) |
| v218 | 23 Mars 2026 | **Unification des sources de prix** : (1) injection des prix live Quote API dans les données historiques Chart API via `unifyPrices()`, (2) enrichissement du breakdown avec `startVal`/`pct`, (3) override P&L du tableau positions avec les valeurs chart-derived via `_chartBreakdown` |
| v219 | 23 Mars 2026 | **Fix timing render** : ajout `refresh()` après le build chart pour que `_chartBreakdown` soit disponible lors du override des positions table. Re-apply `updateKPIsFromChart()` après le refresh |
| v220 | 24 Mars 2026 | **Fix breakdown ESPP/SGTM + MTD state** : (1) `injectExternalItems()` ajoute ESPP/SGTM dans le breakdown quand scope=Tous (résout KPI Daily ≠ breakdown), (2) fix MTD corrompu après 1Y→MTD (rebuild YTD si `_ytdChartFullData.mode === '1y'`) |
| v221 | 24 Mars 2026 | **Fix 5 inconsistencies immobilier** : (1) Loyer HC affichait loyer+parking (1120→1050 +70 pkg), (2) surface Villejuif 68.92→68.94 (match somme pièces), (3) data-eur périmés index.html (293K→300K, 272K→280K, 360K→370K), (4) dashboard.html valeurs périmées (loyer 1200→1050, CF, equity), (5) descriptions propriétés dynamiques depuis data.js |

---

## 9. Chart Breakdown System (v188-v193)

### Architecture du breakdown

Le système de breakdown décompose le P&L par position pour chaque période (Daily, MTD, 1M, YTD, 1Y). Il repose sur les **snapshots de simulation** stockés dans `window._simSnapshots`.

Chaque snapshot (1 par jour) contient : `posBreakdown` (valeur EUR par ticker), `cashEUR/USD/JPY`, `fxUSD/JPY`, `nav`.

La fonction `computePeriodBreakdown(startDate, endDate)` dans `charts.js` calcule le P&L par position :

```
positionPL = endVal - startVal - netTradeFlow
```

Où `netTradeFlow` = somme des achats (EUR) − somme des ventes (EUR) pour ce ticker pendant la période. Sans cette correction (avant v193), les positions achetées pendant la période montraient leur valeur de marché complète comme "gain" au lieu du vrai P&L.

Le résidu `Effet FX / Cash` = chartPL − sum(positionPL) capture les effets FX sur le cash multi-devises.

### Décomposition JPY (v189+)

Pour les périodes où l'emprunt JPY change significativement (>100K ¥), le résidu FX/Cash est décomposé :

- **JPY — effet change** : même solde JPY, taux variable → impact FX pur
- **JPY — variation emprunt** : changement de solde JPY (ex: achat Shiseido) → impact capital
- **USD cash** : effet FX sur solde USD
- **EUR cash (solde)** : variation EUR hors trades

### Items de coûts dans le breakdown

Les coûts (commissions, FTT, intérêts, dividendes) sont extraits séparément depuis `ibkrCostsYTD` et les trades, puis ajoutés comme items `_isCost: true` dans le breakdown. Ils apparaissent en italique avec l'icône ⚙.

---

## 10. KPI System (v191-v192)

### Deux méthodes de calcul P&L

Le dashboard utilise deux approches P&L distinctes :

- **Statique (engine.js)** : P&L position-level M2M = prix actuel − PRU. Rapide, immédiat au chargement. Ne prend en compte que les positions ouvertes.
- **Chart (charts.js)** : P&L NAV-based = NAV_fin − NAV_début − dépôts. Plus complet : inclut cash, FX, dividendes, intérêts, positions vendues. Nécessite les prix historiques Yahoo (async).

Gap structurel ~15-20K€ entre les deux méthodes (engine donne -44K YTD vs chart -29K YTD) car le statique ne capture pas les dépôts, le cash, les effets FX.

> **Depuis v218** : les P&L par position dans le tableau sont overridden par les valeurs chart via `_chartBreakdown`. Seuls les KPIs agrégés (total) conservent le gap structurel. Les P&L individuels (Daily, MTD, 1M, YTD) sont désormais **identiques** entre le breakdown et le tableau.

### Placeholder + Persistence (v191-v192)

Pour éviter le "flash" (-44K → -29K) au chargement :

1. **render.js** : les KPIs chart-overridden (Daily, MTD, 1M, YTD) affichent "–" initialement
2. **app.js** : quand le chart charge, `updateKPI()` écrit la valeur ET la sauvegarde dans `window._chartKPIOverrides`
3. **render.js** : lors d'un re-render (tab switch), vérifie `_chartKPIOverrides` avant d'afficher le placeholder ou la valeur statique

```javascript
const chartOverriddenKPIs = new Set(['kpiPLDaily', 'kpiPLMTD', 'kpiPL1M', 'kpiPLYTD']);
// Si valeur chart sauvegardée → l'utiliser
// Sinon → afficher "–" (placeholder)
// Le KPI 1Y n'est PAS overridden (pas de gap structurel significatif pour 1Y)
```

---

## 11. Données Dividendes (v190)

### IBKR Dividendes (costs[])

Chaque dividende reçu via IBKR est un item dans `PORTFOLIO.amine.ibkr.costs[]` avec `type: 'dividend'`. Le montant `eurAmount` est **net après WHT** (retenue à la source prélevée par IBKR).

Source vérité : IBKR Activity Statement, sections "Dividends" + "Withholding Tax".

WHT France = 25% (prélevé par IBKR), WHT US = 30% (QQQM, pas de treaty rate pour ETFs).

### ACN Dividendes (acnDividends[])

Dividendes Accenture ESPP dans `PORTFOLIO.amine.espp.acnDividends[]`. Chaque entrée a :

- `perShareUSD` : montant par action (source: investor.accenture.com)
- `fxEURUSD` : taux EUR/USD historique au pay date (source: Yahoo Finance)

`engine.js` compute le dividende total : `grossUSD = perShareUSD × totalShares`, puis `netUSD = grossUSD × (1 - 15% WHT)`, puis `netEUR = netUSD / fxEURUSD`.

Le taux historique évite le bug "même montant EUR 3 mois de suite" (avant v190, le taux courant était utilisé pour tous les dividendes historiques).

### Réconciliation dividendes IBKR

| Source | Total net (€) | Note |
|--------|--------------|------|
| IBKR CSV | €484.12 | Dividends − WHT |
| data.js costs[] | €485.97 | Somme eurAmount |
| Écart | €1.85 | Arrondi FX (acceptable) |

---

## 12. Scope System — Chart Multi-Plateforme (v200-v202)

### Concept

Le chart d'évolution NAV affiche 5 périmètres sélectionnables via des boutons toggle :

| Scope | Données affichées | Série utilisée | Plage typique |
|-------|-------------------|----------------|---------------|
| `ibkr` | NAV IBKR uniquement | `chartValues` | €185K-€210K |
| `espp` | Valorisation ESPP (ACN × prix × FX) | `chartValuesESPP` | €38K-€48K |
| `maroc` | Valorisation SGTM (actions × prix / EURMAD) | `chartValuesSGTM` | €2.7K-€4.3K |
| `degiro` | Fallback IBKR (pas de positions actives) | `chartValues` | — |
| `all` | IBKR + ESPP + SGTM combinés | `chartValuesTotal` | €227K-€261K |

### Architecture

Le chart **calcule toujours les 4 séries** (IBKR, ESPP, SGTM, Total) indépendamment du scope. Le scope ne contrôle que **quelle série est affichée**.

```javascript
// charts.js — Toujours calculées (pas de guards includeESPP/includeSGTM)
chartValues.push(ibkrNAV);        // IBKR-only
chartValuesESPP.push(esppValue);  // ESPP-only
chartValuesSGTM.push(sgtmValue);  // SGTM-only
chartValuesTotal.push(total);     // Combined
```

Le scope est passé en option à `buildPortfolioYTDChart()` :
```javascript
buildPortfolioYTDChart(PORTFOLIO, historicalData, FX_STATIC, {
  mode: 'ytd', includeESPP: true, includeSGTM: true, scope: 'maroc'
});
```

### Scope et KPIs

Quand on change de scope, les 5 KPI statiques sont aussi mis à jour via `updateStaticKPIsForScope(scope)` dans `app.js` :
- **Total Actions** : NAV du scope sélectionné
- **P/L Non-Réalisé** : P/L du scope sélectionné
- **P/L Réalisé** : P/L réalisé du scope
- **Dépôts** : Dépôts du scope
- **Dividendes** : Dividendes du scope

### Reconstruction silencieuse 1Y

Pour calculer le KPI "P&L 1Y", app.js fait un "silent rebuild" :
1. Build chart 1Y → grab KPI → destroy
2. Re-build chart actif (MTD/YTD) avec le scope correct

```javascript
// app.js — Silent 1Y rebuild pour P&L 1Y KPI
buildPortfolioYTDChart(PORTFOLIO, historicalData1Y, FX_STATIC, {
  mode: '1y', includeESPP: true, includeSGTM: true, scope: currentScope
});
update1YKPIFromChart();
// Puis re-build le chart visible
buildPortfolioYTDChart(PORTFOLIO, historicalDataToUse, FX_STATIC, {
  mode: scopeMode, startingNAV: 209495, includeESPP: true, includeSGTM: true, scope: currentScope
});
```

### Stockage global

Le chart stocke toutes les séries dans `window._ytdChartFullData` pour le toggle période/mode :

```javascript
window._ytdChartFullData = {
  labels, ibkrValues, totalValues, esppValues, sgtmValues,
  plValuesIBKR, plValuesTotal,
  cumDepositsAtPoint, cumDepositsAtPointTotal,
  showAll, includeESPP, includeSGTM, scope,
  startValue, mode
};
```

---

## 13. Dépôts Multi-Plateforme (v203)

### Architecture des dépôts

Les dépôts sont agrégés depuis 4 sources :

| Plateforme | Source dans data.js | Devise | Status |
|------------|---------------------|--------|--------|
| **IBKR** | `PORTFOLIO.amine.ibkr.deposits[]` | EUR + AED | ✅ Vérifié (IBKR CSV) |
| **Degiro** | `PORTFOLIO.amine.degiro.deposits[]` | EUR | ⚠ **Estimé** (50K dépôts, 101K retrait) |
| **ESPP** | `PORTFOLIO.amine.espp.lots[]` (cost basis) | EUR | ✅ Calculé depuis lots |
| **SGTM** | IPO cost (inline dans engine.js) | MAD | ✅ Coût IPO |

### Calcul dans engine.js

```javascript
const totalDeposits = ibkrDepositsTotal + degiroDepositsTotal + esppDeposits + sgtmDepositsEUR;
```

### ⚠ Données Degiro estimées

Les dépôts/retraits Degiro dans `data.js` sont des **estimations provisoires** :
- **50K € dépôts** : 2 × 25K (mars et août 2020) — montants fictifs
- **101K € retrait** : 50K capital + 51K P&L réalisé (avril 2025)
- **P&L Degiro** : 51 079 € (calculé depuis les emails de confirmation Gmail)

Les emails Degiro ne contiennent PAS les montants des virements. À remplacer dès que les relevés bancaires Boursorama seront retrouvés.

### Impact sur les calculs

- **Engine** : `depositHistory[]` inclut les entrées Degiro (platform: 'Degiro')
- **Charts** : `allTotalDepositsEUR` inclut les dépôts Degiro pour le P&L total
- **TWR** : `depositsByDate` inclut les dépôts Degiro pour le Time-Weighted Return

---

## 14. Structure complète du STATE (compute() output)

L'objet STATE retourné par `compute()` contient ~300+ propriétés. Les principales :

```
STATE = {
  couple: { nw, assets, liabilities, cashEUR, immoEquity },
  amine: { nw, portfolio, immoEquity, cashEUR, ... },
  nezha: { nw, ... },
  actionsView: {
    ibkrNAV, ibkrPositions[], totalStocks,
    esppCurrentVal, nezhaEsppCurrentVal,
    geoAllocation, sectorAllocation,
    combinedUnrealizedPL, combinedRealizedPL,
    totalDeposits, dividends,
    fttEUR, commissionsEUR, interestEUR, dividendsEUR,
    degiroRealizedPL, degiroDividendsNet,
    depositHistory[], degiroDepositsTotal
  },
  cashView: { accountsEUR[], totalCash, totalYieldAnnual },
  immoView: [{ key, equity, loanBalance, monthlyPayment, CF, ... }],
  creancesView: { items[], totalNominal, totalExpected },
  budgetView: { expenses[], totalMonthlyEUR, byZone, byType },
  coupleCategories: [{ label, total, color, sub[] }]
}
```

---

## 15. APIs externes et CORS

### Sources de données

| API | Usage | Endpoint | Cache |
|-----|-------|----------|-------|
| Yahoo Finance v8 | Prix live + historique | `query1.finance.yahoo.com/v8/finance/chart/{ticker}` | localStorage 10min |
| Yahoo Finance v6 | Quote (current price) | `query1.finance.yahoo.com/v6/finance/quote` | localStorage 10min |
| Open Exchange Rates | FX live | `open.er-api.com/v6/latest/EUR` | localStorage 10min |
| Google Finance | SGTM (Maroc) | `google.com/finance/quote/GTM:CAS` | Fallback leboursier.ma |

### Stratégie CORS

Yahoo Finance bloque les requêtes CORS directes depuis le navigateur. `api.js` utilise 6 proxies en parallèle (`Promise.any`) :

1. Direct (natif)
2. api.allorigins.win
3. api.codetabs.com
4. corsproxy.io
5. api.cors.lol
6. thingproxy.freeboard.io

Le premier proxy qui répond gagne. Retry automatique (3 rounds) pour les tickers échoués.

---

## 16. Conventions de code

### Imports avec cache-busting

Chaque import a un paramètre `?v=N`. Après modification d'un fichier, bumper le `?v=N` dans :
- `index.html` : `<script src="js/app.js?v=N">`
- `app.js` : tous les imports
- Les fichiers qui importent le module modifié

### Variables globales (window._*)

| Variable | Module | Usage |
|----------|--------|-------|
| `window._appRefresh` | app.js | Callback refresh global |
| `window._state` | app.js | STATE courant |
| `window._actionsView` | app.js | Vue actions pour scope toggle |
| `window._ytdChartFullData` | charts.js | Données complètes du chart (5 séries NAV + 5 P&L + dépôts cumulés + scope + mode) — voir §23 |
| `window._ytdDisplayMode` | charts.js | 'value' ou 'pl' |
| `window._chartKPIData` | charts.js | KPIs calculés depuis le chart |
| `window._chartKPIOverrides` | app.js | Persistance KPIs chart (évite flash au tab switch) |
| `window._simSnapshots` | charts.js | Snapshots jour-par-jour pour breakdown |
| `window._chartBreakdown` | charts.js | P&L par position par période (daily/mtd/oneMonth/ytd/oneYear) — source vérité pour le tableau |
| `window._refreshActiveBreakdown` | render.js | Re-render panel breakdown ouvert |

### Montants

- **Devise native** dans data.js (jamais de conversion)
- **EUR** partout dans engine.js, render.js, charts.js (via `toEUR()`)
- **Arrondis** : `Math.round()` pour les montants affichés
- **Négatif** = retrait ou coût (ex: `amount: -45000` = retrait)

### Trades

```javascript
// Format standard
{ date, ticker, label, type: 'buy'|'sell', qty, price, currency,
  cost|proceeds, realizedPL, commission, costBasis, source: 'ibkr'|'degiro'|'espp',
  yahooTicker?, splitFactor?, note? }
```

- `source` indique la plateforme d'origine
- `commission` est en devise native du trade (pas en EUR)
- FTT n'est PAS dans commission — calculée par engine.js

---

## 17. Animation Auth Page — Grille 1M€ (v206-v209)

La page d'authentification (mot de passe) affiche une animation de 1000 petits carrés représentant 1 000 000 € de net worth cible.

### Structure

- **Grille CSS** : 40 colonnes × 25 rangées = 1 000 carrés, gap 1px
- **Canvas overlay** : compteur EUR animé, label "sur € 1 000 000", pourcentage
- **Valeur portfolio** : `PORTFOLIO_EUR = 665970` → remplit 666 carrés sur 1000 (66.6%)

### Pattern de remplissage (v209 — Snake)

Remplissage en serpentin bottom-up :
- Rangée 24 (bas) : droite → gauche
- Rangée 23 : gauche → droite
- Rangée 22 : droite → gauche, etc.

Paramètres : `BATCH_SIZE = 2`, `INTERVAL = 12ms`

### Dégradé de couleur

Chaque rangée reçoit une couleur basée sur sa "profondeur" (distance depuis la surface de l'eau) :
- Fond (profond) : `#1a5c3a` vert très foncé
- Surface (haut) : `#6ee7a0` vert clair / mousse

### Effets post-remplissage

1. **Surface wave** : oscillation `scaleY` sur les 2 rangées du haut via Web Animations API (infinite, 2400ms)
2. **Color shift** : tous les carrés remplis changent continuellement de couleur via `requestAnimationFrame` — interpolation sin() à travers une palette de 11 teintes vert/teal, avec offset aléatoire par carré pour un effet organique

### Mise à jour de la valeur

La constante `PORTFOLIO_EUR` dans index.html doit être mise à jour manuellement quand le net worth change significativement.

---

## 18. Unification des Sources de Données — Actions (v217-v219)

### Problème

Yahoo Finance expose **deux APIs distinctes** qui retournent des prix légèrement différents pour le même ticker au même moment :

| API | Endpoint | Usage original | Prix AIR.PA (exemple) |
|-----|----------|----------------|----------------------|
| **Quote API** (v7/v8) | `/v7/finance/quote` ou `/v8/finance/chart?range=1d` | `fetchStockPrice()` → prix live pour le tableau positions | 168.58 |
| **Chart API** (v8) | `/v8/finance/chart?range=ytd` | `fetchTickerHistory()` → historique pour la simulation NAV | 169.92 |

Cela créait des incohérences visibles : le breakdown P&L (chart) montrait +€1800 pour Airbus tandis que le tableau (quote) montrait +€1532. Le même problème existait pour les actifs en USD (IBIT) à cause de la double conversion FX.

### Solution en 3 couches

**Couche 1 — Déduplication dates (v217, api.js)**

Yahoo Chart API retourne parfois 2 entrées pour le même jour (previous close + intraday live). La déduplication garde la dernière valeur (= prix le plus récent) :

```javascript
// api.js — fetchTickerHistory()
for (let i = 0; i < dates.length; i++) {
  if (i < dates.length - 1 && dates[i] === dates[i + 1]) continue;
  dedupDates.push(dates[i]);
  dedupCloses.push(filledCloses[i]);
}
```

**Couche 2 — Injection prix live (v218, app.js)**

Après `fetchStockPrices()` (Quote API) et `fetchHistoricalPricesYTD()` (Chart API), la fonction `unifyPrices()` écrase la dernière entrée de l'historique avec le prix Quote API pour la date du jour :

```javascript
// app.js — unifyPrices(histData)
// Pour chaque ticker : si la dernière date = aujourd'hui, remplacer le close
td.closes[lastIdx] = pos.price;  // prix Quote API

// Pour les FX : injecter les taux live
histData.fx.usd.closes[lastIdx] = currentFX.USD;
```

Après cette étape, le moteur de simulation chart utilise **exactement les mêmes prix** que le tableau positions.

**Couche 3 — Override table → chart (v218-v219, render.js + app.js)**

Le tableau positions ne calcule plus son propre P&L période. Il lit les valeurs depuis `window._chartBreakdown` :

```javascript
// render.js — après construction de allPositions
const cb = window._chartBreakdown;
allPositions.forEach(pos => {
  periodKeys.forEach(({ cbKey, plField, pctField }) => {
    const match = tickerMaps[cbKey]?.[pos.ticker];
    if (match) {
      pos[plField] = match.pl;
      pos[pctField] = match.pct;
    }
  });
});
```

Pour que `_chartBreakdown` soit disponible au moment du override, `app.js` appelle `refresh()` **après** le build chart (v219).

### Flux final unifié

```
fetchStockPrices() ─────────────────┐ (Quote API → pos.price, pos.previousClose)
                                    │
fetchHistoricalPricesYTD() ─────┐   │
                                │   │
                    unifyPrices() ◄─┘ (injecte prix Quote dans historique)
                                │
                    buildPortfolioYTDChart() → _chartBreakdown
                                │
                    refresh() → render() → override table avec _chartBreakdown
```

### Variables globales ajoutées

| Variable | Module | Usage |
|----------|--------|-------|
| `window._chartBreakdown` | charts.js | P&L par position par période (daily, mtd, oneMonth, ytd, oneYear) |

Chaque item du breakdown contient : `{ label, ticker, pl, pct, startVal, endVal, valEUR }`.

### Vérification

Toutes les positions IBKR (13 tickers) montrent des valeurs **identiques** entre le widget breakdown et le tableau positions pour les 4 périodes (Daily, MTD, 1M, YTD). Vérifié le 23 mars 2026.

---

## 19. Degiro Chart Grey-Out (v210)

Le compte Degiro est clôturé (avril 2025) et n'a pas de données NAV historiques. Au lieu d'afficher les données IBKR par erreur (ce qui donnait un graphique faux), le scope 'degiro' affiche un placeholder grisé.

### Implémentation

Le grey-out est appliqué dans **3 fonctions** de `charts.js` :

1. `buildPortfolioYTDChart()` — construction initiale du chart (mode YTD ou 1Y)
2. `redrawChartForPeriod()` — changement de période (MTD, 1M, 3M, YTD, 1Y)
3. `switchChartMode()` — switch Valeur ↔ P&L

### Rendu

- **Titre** : "Evolution Degiro — Compte clôturé" (icône grise)
- **NAV** : "—" pour début et fin de période
- **Canvas** : fond `#f5f5f4`, hachures diagonales `#e7e5e4` (espacement 20px)
- **Texte central** : "Compte Degiro clôturé — Pas de données historiques" + "P/L réalisé : +€ 51 079"
- **Chart.js** : le chart existant est détruit (`charts.portfolioYTD.destroy()`) et le canvas est dessiné manuellement via l'API Canvas 2D

### KPIs associés

Les KPIs sous le chart affichent correctement pour le scope Degiro :
- Total Actions : € 0 (compte vide)
- P/L Non Réalisé : +€ 0
- P/L Réalisé : +€ 51 079 (bénéfice Degiro)
- Total Déposé : € 0 (les dépôts estimés nets sont à 0 car 50K déposés - 101K retirés = net négatif)

---

## 20. Immobilier — Modèle de données & Computation (engine.js)

### Données sources (data.js)

Le patrimoine immobilier est défini dans 3 structures complémentaires de `data.js` :

**PORTFOLIO.{owner}.immo.{key}** — Valeur et revenus par propriété :

| Propriété | Owner | value | valueDate | loyerHC | parking | chargesLocataire | loyerDeclare |
|-----------|-------|-------|-----------|---------|---------|------------------|--------------|
| `vitry` | Amine | 300 000 | 2025-09 | 1 050 | 70 | 150 | 600 |
| `rueil` | Nezha | 280 000 | 2025-09 | 1 300 | 0 | 150 | — |
| `villejuif` | Nezha | 370 000 | 2025-09 | 1 700 | 0 | 0 | — |

**IMMO_CONSTANTS.charges.{key}** — Charges mensuelles :

| Propriété | pret | assurance | pno | tf | copro |
|-----------|------|-----------|-----|-----|-------|
| vitry | 1 166 | 17 | 15 | 75 | 150 |
| rueil | 970 | 18 | 12 | 67 | 250 |
| villejuif | 1 669 | 51 | 15 | 83 | 110 |

**IMMO_CONSTANTS.loans.{key}** — Prêts (single ou multi-loan) :
- `vitryLoans[]` : 2 prêts (Action Logement + principal) — utilise `computeMultiLoanSchedule()`
- `rueil` : prêt unique — utilise `computeAmortizationSchedule()`
- `villejuifLoans[]` : 2 prêts + franchise VEFA (`villejuifFranchise`)

**IMMO_CONSTANTS.properties.{key}** — Métadonnées :
- `surface`, `rooms`, `purchasePrice`, `totalOperation`, `purchaseDate`
- `appreciation` : taux annuel de base (ex: 0.015 = 1.5%)
- `appreciationPhases[]` : taux par tranche d'années (ex: `{start: 2024, end: 2026, rate: 0.015}`)
- `deliveryDate` (Villejuif VEFA uniquement)

**IMMO_CONSTANTS.fiscalite.{key}** — Régime fiscal :
- `type` : 'nu' ou 'lmnp'
- `tmi`, `ps` : taux marginal d'imposition et prélèvements sociaux
- `lmnpStartDate` : date début activité LMNP (pour calcul amortissements)
- Vitry : régime micro-foncier avec `loyerDeclare` < `loyerHC` (loyer déclaré partiel)

### computeImmoView() — Architecture

La fonction centrale `computeImmoView(portfolio, fx)` dans `engine.js` (ligne ~1902) construit l'objet immoView complet. Pipeline :

1. **Tableaux d'amortissement** : pour chaque prêt, calcule le schedule complet (mois par mois) avec CRD, intérêts, capital. Multi-loan (`computeMultiLoanSchedule`) combine les sous-prêts en un schedule unifié.

2. **buildProperty()** — pour chaque propriété :
   - **Valeur dynamique** : appreciation composée mensuelle depuis `valueDate`, avec phases spécifiques par année
   - **CRD dynamique** : lookup dans le schedule à la date courante (pas le snapshot statique de data.js)
   - **Revenus** : `loyer = loyerHC + parking`, `totalRevenue = loyer + chargesLocataire`
   - **Cash flow** : `cf = totalRevenue - charges` (charges = pret + assurance + pno + tf + copro)
   - **Fiscalité** : `computeFiscalite()` calcule l'impôt selon le régime (micro-foncier / réel / LMNP)
   - **Exit costs** : `computeExitCosts()` calcule IRA, frais d'agence, plus-value nette, prélèvements sociaux
   - **Wealth creation** : `capitalAmorti + appreciation + cashflow` par mois

3. **Propriété conditionnelle** (Villejuif) : si `signed: false` ou `conditional: true`, les wealth CF et capital sont à 0 (pas de revenus locatifs avant livraison).

4. **Agrégations** : totalEquity, totalCF, totalWealthCreation, avgLTV, totaux fiscaux, intérêts payés/restants, exit costs totaux.

5. **Annexes** : comparison régimes Villejuif (Jeanbrun vs LMNP), config simulation fiscale Vitry, timeline VEFA Villejuif.

### Objet propriété retourné

Chaque propriété dans `immoView.properties[]` contient ~40 champs :

```
{
  name, owner, conditional,
  value, referenceValue, valueDate,    // valeur dynamique + référence
  crd, equity, ltv,                     // CRD dynamique depuis amort schedule
  loyerHC, parking, chargesLoc,        // revenus décomposés
  loyer, totalRevenue, cf,             // agrégés
  yieldGross, yieldNet, yieldNetFiscal,// rendements
  wealthCreation, wealthBreakdown,     // {capitalAmorti, appreciation, cashflow, effortEpargne}
  chargesDetail, loanDetails[],        // détails prêts et charges
  fiscalite, cfNetFiscal,              // régime fiscal
  exitCosts,                           // {ira, agencyFees, pvBrute, pvAbattement, pvNette, totalExitCosts, netEquityAfterExit}
  pvAbattementSchedule,                // tableau d'abattement PV par année de détention
  propertyMeta,                        // surface, rooms, purchaseDate, etc.
}
```

### Exit costs (computeExitCosts)

Calcul des frais de sortie hypothétiques si vente aujourd'hui :

1. **IRA** (Indemnités de Remboursement Anticipé) : `min(3% × CRD, 6 mois d'intérêts)` par prêt, via `loanCRDs[]`
2. **Frais d'agence** : 5% du prix de vente
3. **Plus-value immobilière** : `PV brute = prix vente - prix achat - amortissements LMNP`
4. **Abattement** : selon la durée de détention (régime IR : abattement progressif 6%-100% entre 6 et 22 ans)
5. **Impôt PV** : `(PV nette après abattement) × (TMI + PS)`
6. **Equity nette** = `valeur - CRD - IRA - agence - impôt PV`

---

## 21. Breakdown ESPP/SGTM — Injection externe (v220)

### Problème

Avant v220, le breakdown P&L par position ne contenait que les positions IBKR (13 tickers). En scope "Tous", le KPI Daily total incluait ESPP/SGTM (via `chartValuesTotal`) mais le breakdown ne les listait pas → incohérence : la somme du breakdown ≠ le KPI affiché.

### Solution : injectExternalItems()

La fonction `injectExternalItems(bd, startDate, endDate)` dans `charts.js` (ligne ~3093) est appelée après le calcul du breakdown IBKR pour chaque période. Elle ajoute des items ESPP et SGTM au breakdown :

```
Pour chaque plateforme (ESPP, SGTM) :
  1. Lire la valeur au startDate et endDate dans chartValues{ESPP|SGTM}
  2. Lire les dépôts cumulés au startDate et endDate dans cumDeposits{ESPP|SGTM}
  3. P&L = (endVal - startVal) - (cumDepositsEnd - cumDepositsStart)
  4. Si |P&L| >= 1€ → ajouter un item {label, ticker, pl, pct, _isExternal: true}
  5. bd.total += P&L
```

### arrayValAtDate()

Helper qui lookup une valeur dans un tableau indexé par les dates du chart (`window._ytdChartFullData.labels`). Gère le cas où la date exacte n'existe pas (prend la valeur la plus proche avant).

### Nouvelles données dans _ytdChartFullData

v220 ajoute 2 séries de dépôts cumulés au stockage global :

| Champ | Description |
|-------|-------------|
| `cumDepositsESPP` | Dépôts cumulés ESPP (cost basis des lots achetés) par jour |
| `cumDepositsSGTM` | Dépôts cumulés SGTM (coût IPO en EUR) par jour |

### Fix MTD corrompu après 1Y→MTD

Quand l'utilisateur passait de la période 1Y à MTD/1M/3M, le `_ytdChartFullData` contenait encore les données 1Y (sampled hebdo, ~52 points) au lieu du YTD (daily, ~60 points). Les filtres sub-période donnaient des résultats incorrects.

Fix dans `app.js` : avant d'appliquer un filtre sub-période, vérifier `_ytdChartFullData.mode`. Si c'est `'1y'`, reconstruire d'abord le chart YTD complet (daily resolution) avant d'appliquer le filtre.

```javascript
// app.js — period toggle handler
if (currentChartMode === '1y') {
  // Must rebuild YTD chart (daily) before applying MTD/1M/3M filter
  buildPortfolioYTDChart(PORTFOLIO, historicalDataYTD, FX_STATIC, {
    mode: 'ytd', startingNAV: 209495, ...
  });
}
redrawChartForPeriod(period);
```

---

## 22. Fix 5 inconsistencies Immobilier (v221)

### Bug 1 — Loyer HC affichait loyer + parking

**Problème** : `engine.js` calcule `loyer = loyerHC + parking` (1050 + 70 = 1120). La property card et le CF table affichaient `prop.loyer` (1120) avec le label "Loyer HC" → faux.

**Fix** : `render.js` utilise désormais `prop.loyerHC` (1050) avec annotation parking séparée : `1 050 +70 pkg`.

### Bug 2 — Surface Villejuif 68.92 → 68.94

**Problème** : `data.js` déclarait `surface: 68.92` mais la somme des pièces (3.60+35.09+11.24+11.24+5.45+2.32) = 68.94.

**Fix** : Corrigé dans `data.js` et toutes les occurrences (3 endroits).

### Bug 3 — data-eur périmés dans index.html

**Problème** : Les attributs `data-eur` de fallback dans `index.html` n'avaient pas été mis à jour lors de la revalorisation :
- Vitry : `data-eur="293000"` → `300000`
- Rueil : `data-eur="272000"` → `280000`
- Villejuif : `data-eur="360000"` → `370000`

### Bug 4 — dashboard.html valeurs périmées

**Problème** : `dashboard.html` (page statique) contenait des valeurs obsolètes (loyer 1200 au lieu de 1050, equity et CF anciens).

**Fix** : Mise à jour de toutes les valeurs statiques (loyer, CRD, equity, CF, appréciation) dans dashboard.html.

### Bug 5 — Descriptions propriétés hardcodées

**Problème** : `render.js` utilisait des descriptions hardcodées dans un objet `propDescriptions` au lieu de les générer depuis les données.

**Fix** : Génération dynamique depuis `prop.propertyMeta` : `surface m² — loyer HC — charges — parking`.

---

## 23. Period Toggle System — MTD/1M/3M/YTD/1Y

### Architecture

Le chart d'évolution NAV supporte 5 périodes via les boutons radio dans l'UI. Le système utilise 2 datasets Yahoo Finance distincts :

| Mode | Source | Résolution | Points |
|------|--------|------------|--------|
| `ytd` | `fetchHistoricalPricesYTD()` (range=ytd) | Journalière | ~60 |
| `1y` | `fetchHistoricalPrices1Y()` (range=1y) | Hebdomadaire (sampled) | ~52 |

### Flux de changement de période

```
Bouton période cliqué
  ├─ MTD/1M/3M → filtre sub-période sur les données YTD
  │    └─ Si _ytdChartFullData.mode === '1y' → rebuild YTD d'abord (v220 fix)
  │    └─ redrawChartForPeriod(period)
  ├─ YTD → rebuild complet avec historicalDataYTD
  │    └─ buildPortfolioYTDChart(mode: 'ytd')
  └─ 1Y → rebuild complet avec historicalData1Y
       └─ buildPortfolioYTDChart(mode: '1y')
       └─ update1YKPIFromChart()
       └─ Rebuild YTD visible (le 1Y a écrasé le canvas)
```

### renderPortfolioChart()

Fonction interne de `charts.js` qui lit `_ytdChartFullData` et construit/met à jour le Chart.js. Gère :
- Filtrage par période (découpe les tableaux de données selon startDate/endDate)
- Mode Valeur vs P&L (`_ytdDisplayMode`)
- Scope (quelle série afficher : ibkr, espp, sgtm, degiro, all)
- Grey-out Degiro (scope 'degiro' → placeholder hachures)
- Breakdown P&L par position avec injection ESPP/SGTM (v220)

### _ytdChartFullData — Structure complète

```javascript
window._ytdChartFullData = {
  labels,                    // ['2026-01-02', '2026-01-03', ...]
  ibkrValues,                // NAV IBKR par jour
  totalValues,               // NAV IBKR+ESPP+SGTM par jour
  esppValues,                // Valorisation ESPP par jour
  sgtmValues,                // Valorisation SGTM par jour
  degiroValues,              // Valorisation Degiro par jour
  plValuesIBKR,              // P&L IBKR (NAV - deposits - startNAV)
  plValuesESPP,              // P&L ESPP
  plValuesSGTM,              // P&L SGTM
  plValuesDegiro,            // P&L Degiro
  plValuesTotal,             // P&L combiné
  cumDepositsAtPoint,        // Dépôts cumulés IBKR par jour
  cumDepositsESPP,           // Dépôts cumulés ESPP (v220)
  cumDepositsSGTM,           // Dépôts cumulés SGTM (v220)
  cumDepositsDegiro,         // Dépôts cumulés Degiro
  cumDepositsAtPointTotal,   // Dépôts cumulés total
  showAll, includeESPP, includeSGTM, scope,
  startValue,                // NAV de départ
  degiroRealizedPL,          // P&L réalisé Degiro (constant)
  mode,                      // 'ytd' ou '1y'
  currentPeriod,             // 'YTD', 'MTD', '1M', '3M', '1Y'
};
```

### Silent 1Y rebuild

Pour afficher le KPI "P&L 1Y" sans que l'utilisateur soit sur la période 1Y, `app.js` fait un rebuild silencieux :

1. `buildPortfolioYTDChart(mode: '1y')` → construit le chart 1Y
2. `update1YKPIFromChart()` → extrait la valeur P&L 1Y
3. Re-build le chart YTD visible (le 1Y a écrasé `_ytdChartFullData` et le canvas)

Ce mécanisme est nécessaire car les données 1Y proviennent d'un dataset Yahoo différent (range=1y) avec un historique plus long mais une résolution inférieure.
