# Architecture — Dashboard Patrimonial

> Dernière mise à jour : 8 avril 2026 (v259)
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

### `data.js` (~2 344 lignes)

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

### `render.js` (~5 572 lignes)

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

### `charts.js` (~3 311 lignes)

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

### Données Degiro — Audit v233

Les données Degiro sont vérifiées depuis les rapports annuels PDF (2019-2025) :
- **50K € dépôts** : 3 virements (jan/fév/mar 2020) — montants individuels estimés (~16.7K chacun), total confirmé
- **76 237.57 € retraits** : 15 669 (2021) + 5 755 (2023) + 54 813.57 (2025) — vérifié rapports annuels
- **P&L Degiro** : 50 186.81 € (vérifié somme per-instrument des 7 rapports annuels)
- **Dividendes nets** : 865.47 € sur 6 ans (2020-2025) — 12 instruments, 3 pays

Voir §34 pour le détail complet de l'audit.

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

---

## 24. UX Immobilier — Améliorations visuelles (v222→v224)

### Vue d'ensemble

6 améliorations UX appliquées à la section Immobilier + correction d'un bug de duplication DOM.

### 24.1 Jauges LTV colorées sur property cards

**Fichier** : `render.js` — fonction `renderPropertyCard()` (~ ligne 3451)

Chaque property card affiche une barre de progression horizontale sous le pourcentage LTV :

```javascript
const ltvPct = Math.min(prop.ltv, 100);
const ltvColor = ltvPct >= 85 ? '#e53e3e'   // rouge
               : ltvPct >= 70 ? '#d69e2e'   // orange
               : '#38a169';                   // vert
```

Rendu : barre `height:6px` avec `background:#e2e8f0` (gris) et inner div proportionnel à `ltvPct%`.

### 24.2 Bordures colorées par propriétaire

**Fichier** : `render.js` — fonction `renderPropertyCard()` (~ ligne 3451)

Chaque property card a une `border-left:3px solid` et un badge arrondi coloré selon le propriétaire :

| Owner | Bordure | Badge bg | Badge text |
|-------|---------|----------|------------|
| Amine | `#3182ce` (bleu) | `#ebf8ff` | `#3182ce` |
| Nezha | `#319795` (teal) | `#e6fffa` | `#319795` |

### 24.3 Mini barre richesse sous KPI "Création Richesse"

**Fichier** : `render.js` — dans `renderImmoView()` (~ ligne 3300)

Après le `setText('kpiImmoViewWealth', ...)`, une barre tricolore 5px est ajoutée dynamiquement au parent du KPI :

```
[████████ Capital █████ Appréc. ██ CF]
```

- Bleu `#3182ce` = capital amorti (% du total)
- Vert `#38a169` = appréciation (% du total)
- Jaune `#d69e2e` ou rouge `#e53e3e` = cashflow (selon signe)

Mini légende (9px) avec dots colorés en dessous.

**Bug fix v224** : Les barres utilisent les classes CSS `.wealth-mini-bar` et `.wealth-mini-leg`, et un cleanup `querySelectorAll('.wealth-mini-bar, .wealth-mini-leg').forEach(el => el.remove())` est fait **avant** chaque re-render pour éviter l'accumulation DOM lors du toggle Villejuif.

### 24.4 CF Summary Ribbon

**Fichier** : `render.js` — dans `renderImmoView()` (~ ligne 3326)
**HTML** : `index.html` — `<div id="cfSummaryRibbon">` (ligne ~1840)

Bandeau horizontal entre les KPIs et le Breakdown Création de Richesse :

```
[Revenus ████████████████ € 4 420/mois] [Charges ████████████████████ € 4 668/mois]  [€ -248 CF net /mois]
```

- Barre verte (`linear-gradient(90deg,#9ae6b4,#38a169)`) pour les revenus
- Barre rouge (`linear-gradient(90deg,#feb2b2,#e53e3e)`) pour les charges
- Encadré résultat CF net (couleur selon signe)
- Le div démarre `display:none`, rendu visible quand `cfRibbon` est trouvé et les données existent
- Les totaux sont calculés en sommant `fp.reduce()` sur `totalRevenue` et `chargesDetail.*`

### 24.5 Barres visuelles CF sur pages détail (onglets Vitry/Rueil/Villejuif)

**Fichier** : `render.js` — dans la fonction de rendu des onglets apartment (~ ligne 4745)

Remplace l'ancien `display:grid` texte par des barres horizontales proportionnelles :

```javascript
function cfBarRowApt(label, amount, color, maxRef) {
  const pct = maxRef > 0 ? Math.round(amount / maxRef * 100) : 0;
  // → label (110px) | barre 14px proportionnelle | montant (55px)
}
```

Le `maxCFBarApt` est le max entre `totalRevenue` et `charges`, utilisé comme référence 100% pour la largeur des barres.

Couleurs :
- Revenus : dégradé vert (`#9ae6b4→#38a169`) pour loyer, `#48bb78` pour parking, turquoise pour charges locataire
- Charges : dégradé rouge (`#feb2b2→#e53e3e`) pour prêt, rose pour assurance, orange (`#fbd38d→#d69e2e`) pour PNO/TF/Copro

**Note** : Il existe deux chemins de rendu pour les propriétés :
1. `renderPropertyDetail()` (cible `#propDetailCF`) — utilisé par le panneau détail modal
2. Fonction inline dans le rendu des onglets apartment (cible `aptVitryContent`, `aptRueilContent`, `aptVillejuifContent`) — affichage principal des sous-onglets

Les barres visuelles sont appliquées aux **deux** chemins de rendu.

### 24.6 Palette couleurs charts immobilier

**Fichier** : `charts.js` — 6 définitions de charts mises à jour

Ancienne palette (gris/bleu/orange foncé) remplacée par une palette cohérente :

| Propriété | Ancienne couleur | Nouvelle couleur |
|-----------|------------------|------------------|
| Vitry | `#4a5568` / `#3182ce` | `#4c6ef5` (indigo) |
| Rueil | `#2b6cb0` / `#2f855a` | `#12b886` (émeraude) |
| Villejuif | `#2c7a7b` / `#ed8936` | `#f59f00` (ambre) |

Charts impactés :
- `loanColors` (3 occurrences dans charts.js) — barres amortissement CRD
- `propColors` — barres equity par bien
- Equity bar chart : ajout `borderRadius: 4`
- CF projection chart : nouvelles couleurs lignes, `pointBackgroundColor`, zero line `#dee2e6`, total line `#1a1a2e`
- Wealth projection bar chart : `borderRadius: 2`, `borderWidth: 0.5`, couleurs Capital=`#4c6ef5`, Appréciation=`#12b886`, Exit savings=`#20c997`/`#ff6b6b`, CF=`#a9e34b`/`#ff6b6b`, Total line=`#1a1a2e` (2.5px)

---

## 25. Changelog v222→v224

| Version | Commit | Description |
|---------|--------|-------------|
| v222 | `bc5e103` | 5 UX improvements (LTV gauge, owner borders, wealth bar, CF ribbon, CF visual bars) + chart color refresh |
| v222b | `718f90d` | Fix: apply visual CF bars to apartment tab pages (rendering path was different from `renderPropertyDetail`) |
| v223 | `796c399` | Cache-bust bump v222→v223 |
| v224 | `bbb4d18` | Fix: prevent wealth mini-bar DOM duplication on Villejuif checkbox toggle (class markers + cleanup before render) |

Ce mécanisme est nécessaire car les données 1Y proviennent d'un dataset Yahoo différent (range=1y) avec un historique plus long mais une résolution inférieure.

---

## 26. Changelog v225→v232

| Version | Date | Commit | Description |
|---------|------|--------|-------------|
| v225 | 26 Mars 2026 | `af0958d` | **Total capital dans les tableaux prêts** + 12 améliorations Couple/Amine/Nezha (KPIs enrichis, détails créances) |
| v225b | 26 Mars 2026 | `f4fe9d6` | Fix KPI strip grid : 6 colonnes Couple, 5 colonnes Amine/Nezha pour les nouveaux KPIs |
| v226 | 27 Mars 2026 | `7c18228` | **Corrections Villejuif** depuis le contrat de réservation PDF (prix, surfaces, frais notaire, livraison) |
| v226b | 27 Mars 2026 | `40dcfae` | Fix montant réservation 3 600 → 3 363 EUR dans le bandeau Villejuif |
| v226c | 27 Mars 2026 | `47ad714` | Fix `totalOperation` et surface dans la section comparaison JEANBRUN/LMNP |
| v227 | 28 Mars 2026 | `3c48ae6` | **Fix affichage prêts multi-période** + documentation complète du système de prêts (franchise, paliers, IRA) |
| v228 | 29 Mars 2026 | `0fcb5d3` | **Rich hover tooltips** sur toutes les barres visuelles (LTV, wealth, CF) + documentation complète |
| v229 | 30 Mars 2026 | `a5802c5` | **Mobile responsive CSS** pour iPhone (390px/375px) — 2 blocs `@media (max-width: 480px)` (~240 lignes) avec class-based et inline-style overrides |
| v230 | 31 Mars 2026 | `2f887a8` | **Audit métier : 12 bugs corrigés** + documentation JSDoc complète — voir §27 ci-dessous |
| v230b | 31 Mars 2026 | `6ed9e82` | Fix double-comptage ESPP/SGTM Nezha dans le tableau détail Couple |
| v231 | 31 Mars 2026 | `cb699d4` | Bump cache busters v230→v231 pour forcer le CDN GitHub Pages à servir les fichiers corrigés |
| v232 | 31 Mars 2026 | `644ef2f` | **Audit 360° : 13 findings corrigés** — probabilité créances, TVA clawback, abattement IR, division/0, race conditions, tooltips, FX — voir §33 |
| v233 | 1 Avr 2026 | — | **Audit Degiro complet** : totalRealizedPL corrigé (51079→50186.81), dividendes 6 ans (865.47 net), 16 trades 2020 manquants, SAP/2025 P/L, SNPR corporate action — voir §34 |
| v234 | 1 Avr 2026 | — | **Dividendes Degiro dans KPIs** : `computeDegiroDividends()` ajouté dans engine.js. Correction data.js?v=176 stale import. Cache bump v234 |
| v235 | 1 Avr 2026 | — | **Historique actions 5Y/MAX** : `EQUITY_HISTORY` (75 points mensuels 2020-2026), boutons 5Y/MAX, `buildEquityHistoryChart()`. P&L visible depuis 2020 — voir §35 |
| v242 | 7 Avr 2026 | — | **P&L basé dépôts** : `contribEUR` ESPP, P&L = NAV − cumDépôts, prix delisted stocks (EUCAR/HTZ/VLTA) |
| v243 | 7 Avr 2026 | — | **P&L Degiro rapports annuels** : dépôts back-calculés (25 573 EUR), fix EQUITY_HISTORY 2020, click-detail chart — voir §36 |

---

## 27. Audit métier v230 — Bugs corrigés

Un audit approfondi de l'ensemble du dashboard a identifié 13 findings. 12 ont été corrigés (1 faux positif — BUG-011 loyers Vitry non payés, confirmé payés par l'utilisateur).

### 27.1 Bugs critiques (sévérité haute)

| ID | Fichier | Description | Fix |
|----|---------|-------------|-----|
| BUG-001+013 | `render.js` | Écart NW Couple KPI vs tableau détail — lignes ESPP Nezha et SGTM Nezha comptées 2× (déjà incluses dans la ligne "Actions & ETFs") | Suppression des lignes dupliquées dans `renderCoupleTable()` |
| BUG-002 | `render.js` + `index.html` | Colonne "EQUITY" dans Résumé Immobilier affichait l'equity **brute** (valeur - CRD) au lieu de l'equity **nette** (après frais de sortie) | Remplacement par `exitCosts.netEquityAfterExit`, header renommé "EQ. NETTE" |
| BUG-003 | `render.js` | P&L % pouvait être `Infinity` ou `NaN` si `periodStartNAV === 0` | Guard `periodStartNAV > 0 ? ... : null` |
| BUG-004 | `render.js` | `toEUR()` propageait `NaN` si le taux FX était absent | Ajout `if (!fx[cur]) { console.warn(...); return amt; }` |

### 27.2 Bugs moyens

| ID | Fichier | Description | Fix |
|----|---------|-------------|-----|
| BUG-005 | `render.js` | NW Nezha n'affichait pas l'equity Villejuif quand `signed=true` | Ajout `nwWithVillejuif` dans le rendu Nezha (affiché uniquement quand signé) |
| BUG-006 | `engine.js` | Config fiscale Villejuif (startYear, TF exemption, début contrat) hardcodée au lieu d'être dérivée de `deliveryDate` | `contractStartMonth = deliveryDate + 9 mois`, `tfExemptionEndYear = deliveryYear + 2` |
| BUG-008 | `engine.js` + `data.js` | PTZ et Action Logement détectés IRA par nom alors qu'ils sont exonérés | Ajout champ `iraExempt: true` explicite + priorité sur la détection par nom |
| BUG-009 | `render.js` | Aucune alerte quand des créances sont en retard de paiement | Ajout calcul jours de retard + alerte rouge "ALERTE : Créances en retard" dans la section Insights |
| BUG-010 | `render.js` | Dépôts Degiro estimés sans avertissement visible | Ajout warning "⚠ Dépôts estimés" sous le KPI Total Déposé quand scope=Degiro |

### 27.3 Bugs mineurs

| ID | Fichier | Description | Fix |
|----|---------|-------------|-----|
| BUG-007 | `data.js` | Taux JPY benchmark IBKR obsolète (0.704% → 0.75% suite décision BOJ mars 2026) | Mise à jour valeur + date de vérification |

### 27.4 Faux positifs (non corrigés)

| ID | Raison |
|----|--------|
| BUG-011 | Loyers Vitry signalés impayés → confirmés payés par l'utilisateur |
| BUG-012 | Viewport meta tag signalé manquant → déjà présent ligne 5 de `index.html` |

### 27.5 Documentation ajoutée (v230)

JSDoc complet ajouté aux fonctions clés :

- **`render.js`** : `fmt()`, `fmtAxis()`, `render()`, `buildDetailTableWithPct()`, `buildDetailTable()`, `makeTableSortable()`
- **`charts.js`** : `rebuildAllCharts()`, `buildCFProjection()`, `buildPortfolioYTDChart()`
- **`app.js`** : `refresh()`, `init()`

---

## 28. Mobile responsive (v229)

### Architecture CSS-only

Le responsive est implémenté **exclusivement en CSS** via deux blocs `@media (max-width: 480px)` dans `index.html`. Aucun JavaScript n'est modifié.

**Bloc 1 — Class-based overrides** (~130 lignes) :

| Cible | Adaptation |
|-------|------------|
| `body` | `overflow-x: hidden` pour empêcher le scroll horizontal |
| `.view-switcher` | `flex-wrap: nowrap`, `overflow-x: auto` — scroll horizontal des onglets |
| `.kpi-strip` | `grid-template-columns: 1fr 1fr` — grille 2 colonnes au lieu de 5-6 |
| Tables (`.num`, `th`, `td`) | `font-size: 0.7rem`, `padding: 4px 6px` — compactes |
| Treemap, Charts | `height: 250px` — hauteur réduite |
| `.insight-card` | `flex-direction: column` — empilement vertical |

**Bloc 2 — Inline-style overrides** (~60 lignes) :

Pour les styles inline générés par JavaScript (qui ne peuvent pas être overridés par des classes seules), utilise des sélecteurs CSS d'attribut avec `!important` :

```css
div[style*="grid-template-columns:1fr 1fr"] {
  grid-template-columns: 1fr !important;
}
#cfSummaryRibbon > div {
  flex-direction: column !important;
}
```

### Contrainte : pas de régression desktop

Tous les overrides sont encapsulés dans `@media (max-width: 480px)` — aucun impact sur la version desktop (> 480px).

---

## 29. Net Worth — Calcul détaillé Couple

### Formule de base

```
nezhaNW = rueilEquity + cashFrance + cashMaroc + cashUAE + espp + sgtm
         + recvOmar + villejuifReservation - cautionRueil
         // ⚠ N'inclut PAS villejuifEquity

coupleNW = amineNW + nezhaNW + villejuifEquity
         // villejuifEquity ajouté uniquement au niveau couple
```

### Pourquoi Villejuif est exclu de nezhaNW

Villejuif VEFA est un bien **conditionnel** (dépend de la signature de l'acte authentique). Pour éviter de gonfler artificiellement le NW de Nezha, l'equity Villejuif :

1. N'est **pas** comptée dans `nezhaNW` (calculé dans `engine.js` l.3204)
2. Est ajoutée **une seule fois** dans `coupleNW` (l.3256)
3. Le champ `nwWithVillejuif` existe pour afficher le NW Nezha incluant Villejuif quand `signed=true`

### Tableau détail Couple (`renderCoupleTable`)

La fonction `buildDetailTableWithPct()` **somme** toutes les valeurs des lignes et affiche le total. Chaque composante du NW doit apparaître **exactement une fois** :

```
Actions & ETFs (IBKR + ACN + SGTM)   ← inclut Amine + Nezha
Cash EUR / MAD / AED                   ← toujours des sommes Amine + Nezha
Equity Immo Vitry / Rueil / Villejuif
Villejuif Reservation Fees             ← conditionnel (non-signé uniquement)
Caution Rueil                          ← négatif (dette locataire)
Véhicules / Créances / TVA
= Net Worth Couple                     ← doit matcher le KPI
```

### Net Equity Immobilier

L'equity **nette** (affichée dans "EQ. NETTE") prend en compte les frais de sortie :

```
netEquity = max(0, equity - agencyFees - capitalGainsTax - IRA)
```

Si les frais de sortie dépassent l'equity brute, la valeur est floorée à 0 (pas d'equity négative).
Vitry affiche €0 car les pénalités de remboursement anticipé et les frais de sortie absorbent toute l'equity brute.

---

## 30. Tooltip System (v228)

Deux patterns de tooltips coexistent dans le dashboard :

### Pattern 1 — Inline absolute-positioned

Utilisé par les barres visuelles (LTV, wealth, CF) dans les cartes immobilier. Le tooltip est un `<div>` enfant positionné en `position: absolute` par rapport au parent `position: relative`.

```html
<div style="position: relative;">
  <div class="bar" onmouseenter="..." onmouseleave="..."></div>
  <div class="tooltip" style="position: absolute; top: -40px; ...">Contenu</div>
</div>
```

### Pattern 2 — Body-appended

Utilisé par les charts Chart.js et certains éléments complexes. Le tooltip est appendé à `<body>` avec `position: fixed` et positionné via les coordonnées du mouse event.

```javascript
const tip = document.createElement('div');
tip.style.position = 'fixed';
document.body.appendChild(tip);
// ... removed on mouseleave
```

**Règle** : les tooltips du Pattern 2 **doivent** être nettoyés au changement de vue (via `cleanup()` dans render).

---

## 31. Vues détaillées

### COUPLE (vue par défaut)

- **KPI strip** : NW Combiné, NW Amine, NW Nezha, Equity Nette Immo, Cash Total, Actions Total
- **Treemap Patrimonial** : visualisation D3 treemap des actifs par catégorie (Actions, Cash Productif, Cash Dormant, Immobilier, Véhicules, Crypto, Créances)
- **Patrimoine par Catégorie** : 4 cartes synthétiques (Actions & Crypto, Cash & Épargne, Immobilier, Autres Actifs)
- **Tableau détail consolidé** : `renderCoupleTable()` → `buildDetailTableWithPct()` — chaque composante du NW avec montant et % du total
- **Donut Répartition** : Chart.js doughnut par catégorie
- **Résumé Immobilier** : 4 KPIs (Equity Nette, Valeur, CRD, CF/mois) + tableau des 3 biens
- **Vue d'ensemble & Insights** : Points forts + Risques du couple (dynamiques depuis le STATE)
- **Simulateur NW Couple** : projection 20 ans avec épargne mensuelle configurable

### AMINE / NEZHA

- **KPI strip** : NW, Cash Total, Actions Total, Immo Equity, Créances Nettes
- **Tableau détail** : `renderAmineTable()` / `renderNezhaTable()` — mêmes principes que couple
- **Charts patrimoine** : donut + bar chart d'allocation

### ACTIONS

- **Scope switcher** : IBKR | ESPP | Degiro | Maroc | Tous
- **Chart NAV évolution** : YTD par défaut, switchable (MTD, 1M, 3M, YTD, 1Y)
- **Mode Valeur / P&L** : toggle entre NAV absolue et P&L cumulé
- **KPI strip** : Total Actions, P/L Non Réalisé, P/L Réalisé, Total Déposé, TWR, Dividendes bruts
- **P&L strip** : Daily, MTD, 1 Mois, YTD, 1 An
- **Tableau positions** : triable par colonne, filtrable par scope, avec P&L coloré

### CASH

- **Répartition par devise** : EUR, AED, MAD, USD, JPY
- **Tableau comptes** : rendement annuel, type (productif/dormant), solde
- **Optimisation** : suggestions de placement pour le cash dormant

### IMMOBILIER

- **Sous-onglets** : Vue d'ensemble | Vitry | Rueil | Villejuif
- **Vue d'ensemble** : KPIs agrégés, tableau comparatif, projection richesse
- **Chaque bien** : 6 cartes KPI, tableau amortissement prêts, tableau fiscal, chart CF projection, chart equity, toggle Villejuif signé/non-signé

### CRÉANCES

- **Tableau créances** : montant nominal, montant attendu, probabilité recouvrement, statut, jours de retard
- **Alerte retard** : badge rouge pour les créances échues non payées

### BUDGET

- **Dépenses mensuelles** : par zone (Dubai, France, Maroc) et par type (logement, transport, alimentation, etc.)
- **Total mensuel EUR** : converti depuis devises natives

---

## 32. Cache-busting — Procédure de mise à jour

Après toute modification de fichier JS :

1. Incrémenter `N` dans **tous** les imports `?v=N` des fichiers impactés
2. Les fichiers à vérifier :
   - `index.html` : `<script src="js/app.js?v=N">`
   - `app.js` : imports de data, engine, render, api, charts, simulators
   - `charts.js` : imports de render, engine, data
   - `render.js` : imports de data, engine
   - `simulators.js` : imports de render, data
3. **Critique** : si un même `?v=N` a déjà été déployé sur GitHub Pages, le CDN peut servir la version cachée. Il faut alors bumper à `N+1` (cf. incident v230→v231).
4. Après push, vérifier le déploiement avec un hard refresh (`Cmd+Shift+R`) sur le site live.

---

## 33. Audit 360° v232 — Findings corrigés

Un audit complet (données, calculs, rendu, qualité code) a identifié 15 findings. 13 corrigés, 1 exclu par l'utilisateur (AUD-002 véhicules), 1 différé (AUD-013 console.log).

### 33.1 Données & Calculs

| ID | Sévérité | Fichier | Description | Fix |
|----|----------|---------|-------------|-----|
| AUD-001 | HAUTE | `engine.js` | Créances comptées à 100% nominal sans pondération par probabilité de recouvrement → NW surestimé | `c.amount * (c.probability \|\| 1)` appliqué pour Amine et Nezha |
| AUD-002 | MOY | — | Dépréciation véhicules non appliquée (valeur résiduelle fixe) | **Exclu** : l'utilisateur considère son assessment déjà conservateur |
| AUD-003 | HAUTE | `engine.js` | `holdingYears` pouvait devenir négatif si `targetYear < purchaseYear` | `Math.max(0, ...)` guard ajouté |
| AUD-008 | HAUTE | `engine.js` | TVA clawback prorata inversé — `Math.floor(yearsSinceLivraison)` au lieu de `Math.ceil(dureeEngagement - yearsSinceLivraison)` | Formule corrigée pour calculer les années restantes |
| AUD-009 | MOY | `data.js` | FX_STATIC obsolète (USD 1.1575, JPY 184.25) — fallback trop éloigné des taux live | Mis à jour : USD 1.0850, JPY 162.50 |
| AUD-014 | HAUTE | `engine.js` | Abattement IR/PS pouvait dépasser 100% pour très longues détentions | `Math.min(1, totalAbatt)` safety clamp |
| AUD-015 | BASSE | `data.js` | Créance "Loyers impayés" statut `relancé` au lieu de `en_retard` | Statut corrigé → affichage badge EN RETARD |

### 33.2 Rendu & UI

| ID | Sévérité | Fichier | Description | Fix |
|----|----------|---------|-------------|-----|
| AUD-004 | MOY | `render.js` | Division par zéro `aedPct` quand `cashTotal === 0` | Guard `cashTotal > 0 ? ... : 0` |
| AUD-005 | MOY | `render.js` | Division par zéro dans le pourcentage Cash view | Guard `cv.totalCash > 0 ? ... : '0'` |
| AUD-007 | MOY | `render.js` | Tooltips body-appended créés à chaque hover sans cleanup → fuite DOM | Réutilisation par ID (`_barTip`, `_wbMiniTip`) |

### 33.3 Code qualité & Performance

| ID | Sévérité | Fichier | Description | Fix |
|----|----------|---------|-------------|-----|
| AUD-006 | MOY | `app.js` | `setInterval` FX/stocks créé sans cleanup → intervalles dupliqués après refresh | Variables `_fxIntervalId` / `_stockIntervalId` + `clearInterval` avant recréation |
| AUD-011 | MOY | `app.js` | Race condition : `refreshStocks()` peut être appelé en parallèle | Guard `_stockRefreshInProgress` boolean |
| AUD-012 | MOY | `simulators.js` | Event listeners dupliqués à chaque appel `initSimulators()` | Guard `window._simulatorsInitialized` |
| AUD-013 | BASSE | tous | `console.log` de debug en production | **Différé** — nettoyage prévu dans une passe ultérieure |

### 33.4 Impact mesuré

- **NW Couple** : -€3 819 (créances pondérées par probabilité : 4 créances à 70%)
- **Total Nominal créances** : €57 150 → **Valeur Attendue** : €53 331
- **Garanti (100%)** : €44 421 (78%) | **Incertain (<100%)** : €12 729 (22%)

---

## 34. Audit Degiro v233 — Rapports annuels 2019-2025

Audit complet des données Degiro en croisant 7 rapports annuels PDF, emails Gmail, et les données du site.

### 34.1 Corrections data.js

| Champ | Avant | Après | Source |
|-------|-------|-------|--------|
| `totalRealizedPL` | 51 079 | 50 186.81 | Somme rapports annuels (±0.02 arrondi) |
| `totalDividendsNet` | 377.44 | 865.47 | 6 années complètes (2020-2025) |
| `dividends` | 2 années | 6 années avec détail par instrument | Rapports annuels |
| `dividends.2023.withholding` | 0 | 30.21 | Rapport 2023 |
| Deposits | 2 × 25K | 3 × 16.7K (montants estimés) | 3 emails Gmail virement |
| SAP 2023 `realizedPL` | 0 | 471.19 | Rapport 2023 |
| 2025 trades `realizedPL` | vides | DIS -82.56, SPOT 940.57, NVDA 41354.50, INFY 1234.46 | Rapport 2025 |

### 34.2 Structures ajoutées

- `annualSummary` : portfolioStart/End, gains, losses par année (2019-2025)
- `flatexCashFlows` : soldes et flux cash Flatex par année
- `fxCosts` : coûts de change AutoFX/ManualFX par année
- `perInstrumentPL` : P/L par instrument pour 2020, 2021, 2023, 2025
- `dividends[year].detail[]` : dividendes par instrument avec WHT et pays
- 16 trades 2020 reconstitués (P/L depuis PDF, sans détail qty/prix)
- Corporate action SNPR→VLTA 2021 (-851.09 EUR)

### 34.3 Correction engine.js (v234)

Nouvelle fonction `computeDegiroDividends(startDate)` qui agrège les dividendes nets Degiro depuis `degiro.dividends`. Intégrée dans `computeAllCosts()` pour que les KPIs affichent IBKR + ACN + Degiro.

---

## 35. Historique actions 5Y/MAX v235

### 35.1 Données : `EQUITY_HISTORY`

Nouveau tableau exporté depuis `data.js` — 75 points mensuels de jan 2020 à mars 2026.

Format : `{ date: 'YYYY-MM-DD', degiro, espp, ibkr, total, note? }`

- `degiro` = portefeuille Degiro + cash Flatex (EUR)
- `espp` = 167 actions ACN × prix historique approximatif (EUR)
- `ibkr` = NAV IBKR estimée (EUR), 0 avant avril 2025
- `total` = degiro + espp + ibkr

**Points vérifiés (rapports annuels)** : déc 2020, déc 2021, déc 2022, déc 2023, déc 2024. Points intermédiaires interpolés linéairement.

### 35.2 Chart : `buildEquityHistoryChart(period, options)`

Nouvelle fonction dans `charts.js` qui :
1. Filtre `EQUITY_HISTORY` par période (5Y = 5 ans glissants, MAX = tout)
2. Construit les séries dans le format `_ytdChartFullData`
3. Appelle `renderPortfolioChart()` pour le rendu

Le renderer existant a été adapté :
- Labels mensuels : "jan 20", "fév 21" (au lieu de "DD/MM")
- Start label : "NAV jan 2020" (au lieu de "NAV 1er jan")
- Flag `_isEquityHistory` pour distinguer les modes

### 35.3 Boutons période

Ajout de `5Y` et `MAX` dans `#ytdPeriodToggle` (index.html).
Wiring dans app.js : appelle `buildEquityHistoryChart()` au lieu de `buildPortfolioYTDChart()`.
Retour vers MTD/1M/3M/YTD : détecte le mode `5y`/`max` et rebuild le chart YTD.

---

## 36. Changelog v242→v243 — P&L Degiro basé rapports annuels

| Version | Date | Description |
|---------|------|-------------|
| v242 | 7 Avr 2026 | Ajout `contribEUR` ESPP, P&L chart basé dépôts cumulatifs, prix delisted (EUCAR/HTZ/VLTA) |
| v243 | 7 Avr 2026 | **Fix P&L Degiro** : calcul basé rapports annuels (pas d'estimations), click-detail chart, fix EQUITY_HISTORY |

### 36.1 Problème identifié (v242)

Le P&L mode 5Y/MAX affichait +€41K au lieu de ~+€51K. Causes :
1. **Dépôts Degiro estimés à 50 000 EUR** (3 × 16 667) alors que le montant réel était **25 573.02 EUR** (3 × 8 524.34)
2. **EQUITY_HISTORY début 2020** : valeurs degiro basées sur l'estimation 50K (16667/33334/40000) au lieu de ~8500/17000/22000
3. Formule P&L = NAV − cumDépôts dépendait d'estimations de dépôts peu fiables

### 36.2 Solution — P&L Degiro basé rapports annuels

**Principe** : ne jamais dépendre de dépôts estimés. Dériver le montant exact des dépôts à partir des rapports annuels DEGIRO.

**Identité utilisée** (compte clôturé) :
```
totalDépôts = totalRetraits − totalPL
```
Où :
- `totalRetraits` = somme des retraits Flatex (rapports annuels) = 15 669 + 5 755 + 54 813.57 = **76 237.57 EUR**
- `totalPL` = somme de tous les composants P&L (rapports annuels) :
  - Gains/pertes réalisés : 7.06 + 9 253.27 + 0 + (−2 520.48) + 0 + 43 446.96 = **50 186.81**
  - Dividendes nets : 194.23 + 194.19 + 158.93 + 153.04 + 159.90 + 5.18 = **865.47**
  - Coûts FX : −79.86 − 28.54 − 7.18 − 281.81 = **−397.39**
  - Intérêts Flatex : −3.92 − 6.24 − 0.18 = **−10.34**
  - Bonus promo : **+20.00**
  - **Total P&L = 50 664.55 EUR**
- Donc `totalDépôts = 76 237.57 − 50 664.55 = **25 573.02 EUR**` (÷3 = 8 524.34 par virement)

**Implémentation** (`charts.js`, `buildEquityHistoryChart`) :
1. Calcul de `dgTotalPL` à partir de `annualSummary`, `dividends`, `fxCosts`, `flatexCashFlows`
2. Calcul de `dgTotalWithdrawals` à partir de `flatexCashFlows.retraits`
3. Back-calcul de `dgTotalDeposits = dgTotalWithdrawals − dgTotalPL`
4. P&L mensuel = NAV(mois) − cumDépôts + cumRetraits (basé sur les dates des rapports annuels)
5. ESPP et IBKR : inchangés (dépôts exacts disponibles)

### 36.3 Corrections EQUITY_HISTORY début 2020

| Mois | Ancien degiro | Nouveau degiro | Ancien total | Nouveau total | Raison |
|------|--------------|---------------|-------------|--------------|--------|
| 2020-01 | 16 667 | 8 500 | 31 107 | 22 940 | 1er dépôt 8 524 (pas 16 667) |
| 2020-02 | 33 334 | 17 000 | 47 166 | 30 832 | 2ème dépôt cumulé ~17K |
| 2020-03 | 40 000 | 22 000 | 50 875 | 32 875 | COVID crash sur 25.6K déposés |
| 2020-04→11 | 38K→31.5K ↓ | 23.5K→30.5K ↑ | 50K→52.7K | 35.7K→51.8K | Trajectoire corrigée vers 32 058 |

### 36.4 Validation P&L aux points d'ancrage annuels

| Date | NAV (rapport) | cumRetraits | P&L calculé | Commentaire |
|------|--------------|-------------|-------------|-------------|
| 2020-12-31 | 32 057.83 | 0 | +6 484.81 | Recovery COVID, gains unrealized |
| 2021-12-31 | 29 954.48 | 15 669 | +20 050.46 | LVMH/EUCAR gains + retrait 15.7K |
| 2022-12-31 | 16 510.28 | 15 669 | +6 606.26 | Bear market |
| 2023-12-31 | 30 041.90 | 21 424 | +25 892.88 | NVDA recovery |
| 2024-12-31 | 78 019.69 | 21 424 | +73 870.67 | NVDA explosion |
| 2025 (clôture) | 0 | 76 237.57 | +50 664.55 | ✓ = totalPL |

### 36.5 Click-detail chart

Ajout d'un panneau de détail (HTML `#ytdPointDetail`) qui s'affiche au clic sur un point du graphique d'évolution (5Y/MAX/YTD/1Y).

**Contenu affiché** :
- Date + note EQUITY_HISTORY si disponible
- Tableau avec une ligne par source (Degiro, ESPP, IBKR) + Total
- Colonnes : NAV, Déposé (net), P&L, Rendement (%)
- Bouton fermer (×)
- Curseur pointer au survol des points

**Fichiers modifiés** :
- `index.html` : ajout `<div id="ytdPointDetail">` sous le canvas
- `charts.js` : ajout `onClick` handler + `onHover` cursor dans `renderPortfolioChart()`

---

## 37. Audit v243 — Equity/Actions (7 avril 2026)

Audit approfondi du site et de la partie actions après les modifications v242→v243. 4 axes audités en parallèle : données, code P&L, engine+render, cohérence site.

### 37.1 Résultat global

| Axe | Résultat | Findings |
|-----|----------|----------|
| Données (data.js) | ✅ PASS | 0 critique, 0 warning |
| Code P&L (charts.js) | ⚠️ 4 fixes | 1 critique, 3 warnings → corrigés |
| Engine + Render | ⚠️ 1 fix | 1 warning → corrigé |
| Cohérence site | ✅ PASS | Tous imports v=243, HTML OK, pas de dead code |

### 37.2 Données vérifiées (data.js)

| Vérification | Résultat | Détail |
|-------------|----------|--------|
| EQUITY_HISTORY `total = degiro + espp + ibkr` | ✅ 60/60 | 0 écarts |
| Ancres year-end vs rapports annuels | ✅ 5/5 | Écarts max ±0.52 EUR (arrondi) |
| Degiro deposits 3×8524.34 | ✅ | Net = 25573.02 − 76237.57 = −50664.55 ✓ |
| Dividendes nets total | ✅ | 865.47 EUR (6 ans vérifiés) |
| FX costs total | ✅ | −397.39 EUR |
| allTrades count | ✅ | 132 trades Degiro |
| ESPP contribEUR total | ✅ | 28098.62 EUR (11 lots) |
| IBKR deposits | ✅ | ~207K EUR (18 entrées) |
| Progression 2020 corrigée | ✅ | 8500→17000→22000→...→32058 (plausible) |

### 37.3 Bugs corrigés (audit)

**BUG-A01 — CRITIQUE : Fallback hardcodé 51079 dans overlay Degiro**
- Fichier : `charts.js`, ligne 2252
- Avant : `data.degiroRealizedPL || 51079` (valeur obsolète, devrait être 50665)
- Après : `data.degiroRealizedPL || 0` (fallback sûr, valeur toujours définie en pratique)

**BUG-A02 — WARNING : Absence de bounds check dans le click handler**
- Fichier : `charts.js`, ligne 2091
- Risque : `startIdx + dataIndex` pouvait dépasser la taille de `chartLabelsRef`
- Fix : Ajout `if (idx < 0 || idx >= chartLabelsRef.length) return;`

**BUG-A03 — WARNING : Null guard manquant pour PORTFOLIO.amine.degiro**
- Fichier : `charts.js`, ligne 3501
- Risque : Crash si `PORTFOLIO.amine.degiro` est undefined
- Fix : `const dg = PORTFOLIO.amine.degiro || {};`

**BUG-A04 — WARNING : Warning "⚠ dep. est." obsolète**
- Fichier : `render.js`, lignes 2131-2141
- Problème : Affichait "⚠ dep. est." alors que les dépôts sont maintenant exacts
- Fix : Code supprimé, remplacé par un commentaire expliquant que les dépôts sont back-calculés

### 37.4 Vérifications de cohérence

| Check | Résultat |
|-------|----------|
| Tous fichiers JS importent v=243 | ✅ (app.js×6, engine.js×1, charts.js×3, render.js×2) |
| `#ytdPointDetail` dans index.html | ✅ Ligne 1892 |
| Tous IDs référencés existent dans HTML | ✅ (7/7 IDs vérifiés) |
| Scope/Period toggles câblés dans app.js | ✅ |
| DEGIRO_STATIC_PRICES importé et utilisé | ✅ (engine.js:28, 729, 731) |
| PORTFOLIO importé dans charts.js | ✅ (ligne 10) |
| Pas de valeurs 50000/16667 résiduelles | ✅ Aucune trouvée |
| Pas de dead code dans sections modifiées | ✅ Toutes variables utilisées |
| ARCHITECTURE.md §36 bien formé | ✅ Markdown valide |

### 37.5 Architecture P&L — Vue consolidée

Après v243, le calcul P&L utilise **3 approches distinctes** selon la source :

```
┌─────────┬──────────────────────────────────────────────────────────┐
│ Source   │ Méthode P&L                                            │
├─────────┼──────────────────────────────────────────────────────────┤
│ DEGIRO  │ Rapports annuels : totalPL = Σ(gains+div+FX-intérêts)  │
│         │ totalDépôts = totalRetraits - totalPL (back-calculé)    │
│         │ PL(mois) = NAV - cumDépôts + cumRetraits                │
│         │ → Aucune estimation, 100% dérivé des rapports annuels   │
├─────────┼──────────────────────────────────────────────────────────┤
│ ESPP    │ PL = NAV - Σ(contribEUR) - cashEUR                     │
│         │ → Contributions salariales exactes par lot              │
├─────────┼──────────────────────────────────────────────────────────┤
│ IBKR    │ PL = NAV - Σ(deposits en EUR, AED→EUR via fxRateAtDate)│
│         │ → Dépôts exacts du relevé d'activité IBKR              │
├─────────┼──────────────────────────────────────────────────────────┤
│ TOTAL   │ PL = Σ(PL_degiro + PL_espp + PL_ibkr)                  │
│         │ cumDépôts_total = cumDépôts_degiro + cumESPP + cumIBKR  │
└─────────┴──────────────────────────────────────────────────────────┘
```

### 37.6 Flux de données — Click-detail chart

```
buildEquityHistoryChart() ──→ _ytdChartFullData ──→ renderPortfolioChart()
  ├─ labels, *Values, pl*Values              │         ├─ slicedLabels / startIdx
  ├─ cumDeposits* (IBKR/ESPP/Degiro/Total)   │         ├─ onChartClick (onClick handler)
  ├─ _equityEntries (EQUITY_HISTORY filtered) │         │   ├─ idx = startIdx + dataIndex
  └─ degiroRealizedPL                         │         │   ├─ bounds check (idx < length)
                                              │         │   ├─ nav/pl/dep per source
buildPortfolioYTDChart() ─────→ (même format) │         │   └─ #ytdPointDetail innerHTML
  ├─ cumDepositsDegiro = [0, 0, ...]          │         └─ tooltip callbacks
  └─ (pas de _equityEntries → notes=undefined)│
```

### 37.7 Audit approfondi — Bugs supplémentaires (v243 deep audit)

**BUG-A05 — CRITICAL : degiroRealizedPL incohérent entre modes chart**
- Fichiers : `charts.js` (buildPortfolioYTDChart vs buildEquityHistoryChart)
- Problème : `buildEquityHistoryChart` calculait le P&L Degiro à partir de tous les composants
  des rapports annuels (trading + dividendes + FX + intérêts + promo = **50 664,55 EUR**),
  tandis que `buildPortfolioYTDChart` utilisait `totalRealizedPL` (trading seul = **50 186,81 EUR**).
  Écart de **477,74 EUR** entre les deux modes de graphique.
- Cause : Deux champs différents dans `data.js` — `totalRealizedPL` (KPIs) vs calcul complet (charts).
- Fix :
  1. Ajout de `totalPLAllComponents: 50664.55` dans `data.js` section degiro
  2. `buildPortfolioYTDChart` utilise désormais `totalPLAllComponents` au lieu de `totalRealizedPL`
- Validation : Les deux builders produisent maintenant dgTotalPL = 50 664,55 EUR ✅

**BUG-A06 — CRITICAL : Total Déposé KPI incluait les retraits Degiro**
- Fichier : `engine.js`, lignes 367-376
- Problème : `degiroDepositsTotal` était calculé comme la somme nette de tous les mouvements
  Degiro (dépôts + retraits), donnant **-50 664,55 EUR** au lieu de **+25 573,02 EUR**.
  Le KPI "Total Déposé" affichait ~196K EUR au lieu de ~272K EUR.
- Cause : `depositHistory.filter(d => d.platform === 'Degiro').reduce(...)` ne séparait pas
  les dépôts positifs des retraits négatifs.
- Fix : Séparation en deux filtres distincts :
  ```javascript
  const degiroDepositsGross = depositHistory
    .filter(d => d.platform === 'Degiro' && d.amountEUR > 0)
    .reduce((s, d) => s + d.amountEUR, 0);  // = 25573.02
  const degiroWithdrawals = depositHistory
    .filter(d => d.platform === 'Degiro' && d.amountEUR < 0)
    .reduce((s, d) => s + d.amountEUR, 0);  // = -76237.57
  const degiroDepositsTotal = degiroDepositsGross;  // Gross pour KPI/ROI
  ```
- Validation : Total Déposé ≈ 272K EUR (IBKR ~207K + ESPP ~28K + Degiro ~25.6K + Crypto ~11K) ✅

**BUG-A07 — INFO : Commentaire obsolète "⚠ Montants estimés" dans engine.js**
- Fichier : `engine.js`, ligne 329-330
- Problème : Le commentaire indiquait toujours "⚠ Montants estimés" pour les dépôts Degiro
  alors que les montants sont désormais exacts (back-calculés depuis les rapports annuels).
- Fix : Commentaire mis à jour → "✅ Montants exacts — back-calculés depuis rapports annuels"

### 37.8 Résumé audit v243 — Bilan complet

| Bug ID | Sévérité | Fichier | Description | Statut |
|--------|----------|---------|-------------|--------|
| A01 | CRITICAL | charts.js | Fallback hardcodé 51079 dans overlay Degiro | ✅ Corrigé |
| A02 | HIGH | charts.js | Pas de bounds check dans click handler | ✅ Corrigé |
| A03 | WARNING | charts.js | Null guard manquant PORTFOLIO.amine.degiro | ✅ Corrigé |
| A04 | WARNING | render.js | Warning "⚠ dep. est." obsolète | ✅ Corrigé |
| A05 | CRITICAL | charts.js | P&L Degiro incohérent entre modes (477€ d'écart) | ✅ Corrigé |
| A06 | CRITICAL | engine.js | Total Déposé KPI incluait retraits (-76K au lieu de +25K) | ✅ Corrigé |
| A07 | INFO | engine.js | Commentaire obsolète "⚠ Montants estimés" | ✅ Corrigé |

**Vérifications finales deep audit :**

| Check | Résultat |
|-------|----------|
| dgTotalPL cohérent entre builders | ✅ 50 664,55 dans les deux |
| degiroDepositsGross = 25 573,02 | ✅ |
| Total Déposé KPI ≈ 272K | ✅ |
| totalPLAllComponents dans data.js | ✅ Ligne ~593 |
| Tous fichiers JS syntax check | ✅ 5/5 passent |
| Pas de variables non définies dans scopes modifiés | ✅ |

---

## §38 — Changelog v243 → v244 : Tooltip harmonisé + corrections

### 38.1 Contexte

Le tooltip natif Canvas de Chart.js (rendu directement sur le `<canvas>`) ne s'affichait pas
en mode 5Y/MAX malgré une configuration correcte (callbacks fonctionnels, interaction mode
'index', pas d'erreur JS). Le diagnostic a révélé que `tooltip.opacity` restait à 0 même
après activation programmatique et hover réel. La cause probable : une interaction entre les
reconstructions rapides du chart (destroy + recreate) lors des changements de mode/période
et le système d'animation interne de Chart.js 4.4.1.

### 38.2 Changements v244

**BUG-A08 — CRITICAL : Tooltip invisible sur graphique 5Y/MAX**
- Fichiers : `charts.js` (renderPortfolioChart)
- Problème : Le tooltip Canvas de Chart.js ne s'affichait jamais en mode 5Y et MAX.
  Le contenu était correctement calculé par les callbacks mais `opacity` restait à 0.
- Solution : Remplacement complet du tooltip Canvas par un **tooltip HTML externe** :
  ```javascript
  tooltip: {
    enabled: false,           // Désactive le tooltip Canvas natif
    external: externalTooltipHandler,  // Fonction custom → div HTML
  }
  ```
  Le tooltip HTML (`#chartTooltip`) est :
  - Un `<div>` positionné en `position: absolute` sur le `<body>`
  - Rendu via le callback `external` de Chart.js (appelé à chaque interaction)
  - Avec gestion d'erreur try/catch pour ne jamais crasher silencieusement
  - Nettoyé automatiquement à chaque `chart.destroy()`
- Résultat : Tooltip visible et fonctionnel sur **tous** les modes (YTD, 1Y, 5Y, MAX)

**BUG-A09 — WARNING : `startValue` manquant dans buildEquityHistoryChart**
- Fichier : `charts.js` (buildEquityHistoryChart → `_ytdChartFullData`)
- Problème : Le champ `startValue` n'était pas défini dans les données du graphique
  5Y/MAX. En mode "Valeur", le tooltip affichait "€ NaN, NaN%" car
  `startValueRef` était `undefined` (utilisé pour calculer diff et %).
- Fix : Ajout de `startValue: totalValues[0] || 0` dans `_ytdChartFullData`
- Résultat : Mode "Valeur" affiche correctement le % de variation depuis le début

**BUG-A10 — WARNING : `onHover` placé au mauvais niveau dans la config Chart.js**
- Fichier : `charts.js` (renderPortfolioChart)
- Problème : `onHover` était au niveau racine de la config Chart.js (à côté de `options`),
  au lieu d'être DANS `options`. Chart.js 4.x ignore silencieusement les propriétés
  inconnues au niveau racine → le curseur ne changeait pas en 'pointer' au survol.
- Fix : Déplacé `onHover` dans `options` :
  ```javascript
  options: {
    onHover: (evt, elements) => { ... },  // Correct: dans options
    ...
  }
  ```

### 38.3 Tooltip externe — Architecture

```
Mouse hover sur canvas
  ↓
Chart.js interaction mode: 'index', intersect: false
  ↓
Tooltip callback (enabled: false, external: fn)
  ↓
externalTooltipHandler(context)
  ├── context.tooltip.opacity === 0 → masque #chartTooltip
  └── opacity > 0 → calcule contenu HTML
      ├── P&L mode : P&L coloré + NAV + Déposé
      └── Value mode : NAV + diff% + P&L
      → positionne #chartTooltip via caretX/caretY
```

### 38.4 Vérifications v244

| Check | Résultat |
|-------|----------|
| Tous fichiers JS syntax check (v=244) | ✅ 5/5 passent |
| `startValue` dans buildEquityHistoryChart | ✅ |
| `onHover` dans options (pas racine) | ✅ |
| tooltip.enabled = false + external handler | ✅ |
| #chartTooltip nettoyé au destroy | ✅ (2 emplacements) |
| Version bumped v243→v244 dans 5 fichiers JS | ✅ |

## §39 — Changelog v244 → v245 : Correction données IBKR + ESPP

### 39.1 Contexte

L'utilisateur a signalé que les valeurs P&L affichées étaient incorrectes :
- **IBKR NAV** : affiché 175 000 € vs valeur réelle 187 700 € (185 700 + 2 000 retrait)
- **ESPP (ACN)** : les valeurs EQUITY_HISTORY pour 2026 n'avaient pas été mises à jour
  après la chute d'ACN de ~$330 à $197.55 (Q1 2026)

### 39.2 Corrections v245

**BUG-A11 — CRITICAL : IBKR NAV sous-estimé de 12 700 €**
- Fichier : `data.js` (EQUITY_HISTORY)
- Problème : L'entrée 2026-03-31 avait `ibkr: 175000` mais la valeur réelle est 187 700 €
  (portefeuille actuel 185 700 € + retrait récent de 2 000 €)
- Fix : `ibkr: 175000` → `ibkr: 187700`, total mis à jour
- Impact : P&L IBKR affiché -24 928 € au lieu de ~-10 186 €

**BUG-A12 — WARNING : Retrait 2 000 € manquant dans deposits IBKR**
- Fichier : `data.js` (ibkr.deposits[])
- Problème : L'utilisateur a retiré 2 000 € de son compte IBKR (mars 2026), mais
  ce retrait n'était pas dans le tableau deposits
- Fix : Ajout `{ date: '2026-03-31', amount: -2000, currency: 'EUR' }`
- Impact : Total dépôts net passe de 199 886 € à 197 886 €

**BUG-A13 — CRITICAL : ESPP surévalué de ~21 500 € dans EQUITY_HISTORY 2026**
- Fichier : `data.js` (EQUITY_HISTORY, 3 entrées 2026)
- Problème : Les valeurs `espp` pour 2026 n'avaient pas été mises à jour après la chute
  d'ACN de ~$330 à $197.55. L'entrée mars affichait 59 285 € au lieu de ~37 757 €.
  Formule correcte : (167 + 40 shares) × ACN_USD / fx_EURUSD + cash
- Fix :
  - Jan : 56 780 → 53 855 (ACN~$260, fx~1.04)
  - Fév : 57 615 → 43 700 (ACN~$209, fx~1.04)
  - Mar : 59 285 → 37 757 (ACN=$197.55, fx=1.1467)
- Impact : Total portfolio 2026-03-31 passe de 234 285 € à 225 457 €

### 39.3 Note sur les ESPP historiques (2025 et avant)

Les valeurs `espp` dans EQUITY_HISTORY pour 2025 et avant sont des **approximations
interpolées** (cf. commentaire "Points intermédiaires = interpolation linéaire").
Elles peuvent être décalées de 5-20% par rapport à la réalité, notamment :
- Jun-Dec 2025 : probablement sous-estimées (ACN était à $330-370)
- Les entrées ne distinguent pas clairement Amine (167 sh) vs Nezha (40 sh)
Pour une correction complète, il faudrait les cours ACN mensuels exacts + fx historiques.

### 39.4 Vérifications v245

| Check | Résultat |
|-------|----------|
| IBKR NAV 2026-03-31 = 187700 | ✅ |
| Retrait -2000 dans deposits[] | ✅ |
| Total dépôts net = 197 886 € | ✅ |
| ESPP Jan/Fév/Mar 2026 recalculés | ✅ |
| Total 2026-03-31 = 225 457 | ✅ |
| Version bumped v244→v245 | ✅ |

## §40 — Changelog v245 → v247 : Harmonisation P&L + Splice 5Y/simulation

### 40.1 Contexte

Deux problèmes critiques identifiés :

1. **P&L Cards vs P&L Graphique** : Les KPI cards (P/L Non Réalisé + P/L Réalisé) ne
   correspondaient pas au P&L affiché sur le graphique. Écart de ~11 774 €.
2. **5Y vs 1Y contradiction** : Le graphique 5Y (basé sur EQUITY_HISTORY) affichait
   ~130K € de P&L à août 2025, tandis que le 1Y (simulation) affichait ~40K € à la
   même date. Cause : les valeurs IBKR dans EQUITY_HISTORY pour 2025 étaient des
   estimations manuelles grossièrement fausses (ex: May=20K, Jul=50K avec seulement
   ~10K déposés à ce moment-là).

### 40.2 Corrections v246 — Harmonisation P&L

**BUG-A14 — ESPP cost basis utilisait totalCostBasisUSD/currentFX au lieu de contribEUR**
- Fichier : `engine.js`
- Impact : ~10K € d'écart sur le P&L non réalisé ESPP
- Fix : Nouvelle fonction `esppLotCostEUR(lot, defaultFx)` qui utilise `contribEUR`
  (contributions salariales exactes) comme base canonique, avec fallback sur
  `costBasis/fxRateAtDate` pour les lots Nezha

**BUG-A15 — Degiro realized P&L excluait dividendes/FX/intérêts**
- Fichier : `engine.js`
- Fix : `degiroRealizedPL = totalPLAllComponents` (50 664,55 € vs 50 186,81 €)

**BUG-A16 — IBKR dividendes et coûts absents du realized P&L**
- Fichier : `engine.js`
- Fix : `combinedRealizedPL += ibkrDividendsAllTime + acnDividendsAllTime + commissions + FTT + interest`

**BUG-A17 — ESPP cash non inclus dans unrealized P&L**
- Fichier : `engine.js`
- Fix : `esppCashEUR = cashEUR + toEUR(cashUSD, 'USD', fx)` ajouté au calcul

### 40.3 Correction v247 — Splice simulation dans 5Y chart

**BUG-A18 — CRITICAL : EQUITY_HISTORY 2025 IBKR = estimations fausses**
- Fichier : `charts.js` (buildEquityHistoryChart)
- Problème : Les valeurs IBKR dans EQUITY_HISTORY pour Apr-Dec 2025 étaient des
  estimations manuelles interpolées qui ne correspondaient pas à la réalité.
  Exemple : May=20K€, Jul=50K€ avec seulement ~10K€ de dépôts cumulés.
  Le graphique 5Y affichait donc un P&L artificiellement gonflé.
- Solution : **Splice simulation ↔ EQUITY_HISTORY**
  1. `buildPortfolioYTDChart` (mode 1Y) cache ses NAV journaliers dans
     `window._simulation1YCache` (labels, ibkrValues, esppValues, sgtmValues, etc.)
  2. `buildEquityHistoryChart` détecte ce cache et découpe les données :
     - **Avant la date de début simulation** : utilise EQUITY_HISTORY (ère Degiro, 2020-2024)
     - **Après** : utilise les NAV quotidiens/hebdomadaires de la simulation 1Y
  3. Le P&L est recalculé uniformément sur les données combinées, avec le même
     système de dépôts cumulatifs (Degiro rapports annuels + ESPP contribEUR + IBKR deposits)
- Impact : Le 5Y chart affiche maintenant des données cohérentes avec le 1Y chart

**FIX-A19 — SGTM P&L ajouté au 5Y chart**
- Fichier : `charts.js` (buildEquityHistoryChart)
- Problème : Le 5Y chart n'incluait pas SGTM (zéros partout). Or la simulation
  inclut les actions SGTM (Maroc Telecom IPO Dec 2025).
- Fix : Ajout du tracking des dépôts SGTM (cost basis IPO en EUR) et calcul
  du P&L SGTM dans le 5Y chart.

**FIX-A20 — Nezha ESPP deposits manquants dans 5Y chart**
- Fichier : `charts.js` (buildEquityHistoryChart)
- Problème : Les dépôts ESPP du 5Y chart ne comptaient que les lots d'Amine.
  Les 4 lots de Nezha (40 shares) n'étaient pas inclus dans le tracking.
- Fix : Ajout des lots Nezha (avec fallback costBasis/fxRate) + cashUSD Nezha
  dans esppDepositEvents.

**FIX-A21 — Import FX_STATIC dans charts.js**
- Fichier : `charts.js` (imports)
- Fix : Ajout de `FX_STATIC` à l'import depuis `data.js` pour la conversion
  SGTM (MAD→EUR) et Nezha cash (USD→EUR) dans le 5Y chart.

### 40.4 Architecture du splice

```
buildPortfolioYTDChart(mode='1y')
  → Simule NAV quotidien depuis 1 an (replays trades + deposits)
  → Downsample hebdomadaire (>60 points)
  → Cache dans window._simulation1YCache
  → { labels[], ibkrValues[], esppValues[], sgtmValues[], degiroValues[], totalValues[] }

buildEquityHistoryChart(period='5Y')
  → Filtre EQUITY_HISTORY par période
  → SI _simulation1YCache existe :
      → Garde EH avant date début simulation (ère Degiro)
      → Remplace par NAV simulation après (ère IBKR)
      → Recalcule total = degiro + espp + ibkr + sgtm
  → Calcule P&L avec dépôts cumulatifs complets (all-time)
  → Stocke dans _ytdChartFullData → renderPortfolioChart()
```

### 40.5 Vérifications v247

| Check | Résultat |
|-------|----------|
| 1Y cache stocké après buildPortfolioYTDChart(1y) | ✅ |
| 5Y chart splice EH + simulation | ✅ |
| P&L 5Y cohérent avec P&L 1Y pour dates communes | ✅ |
| SGTM P&L inclus dans 5Y chart | ✅ |
| Nezha ESPP deposits comptés dans 5Y | ✅ |
| FX_STATIC importé dans charts.js | ✅ |
| Version bump v245→v247 (all files) | ✅ |

## §41 — Changelog v248 → v252 : Mode alltime + Unification P&L

### 41.1 Problème résolu

Le graphe 5Y utilisait un hack de "30 jours de warmup" pour éviter les artefacts au point de splice entre EQUITY_HISTORY (mensuel) et la simulation 1Y (quotidienne). Ce hack perdait ~30 jours de données et causait des P&L Degiro incorrects. De plus, le titre du graphe affichait le changement de NAV (incluant les dépôts) tandis que les cards P&L affichaient le vrai P&L (NAV - dépôts), créant une incohérence visible.

### 41.2 Solution : mode 'alltime' (v250)

Ajout d'un 3ème mode de simulation dans `buildPortfolioYTDChart` :

| Mode | START_DATE | STARTING_NAV | Usage |
|------|-----------|-------------|-------|
| `ytd` | 1er jan 2026 | 209495 (IBKR NAV) | Graphe YTD visible + KPIs Daily/MTD/1M/YTD |
| `1y` | 1 an avant aujourd'hui | 0 | KPI P&L 1Y (silencieux) |
| `alltime` | 1 jour avant 1er dépôt IBKR | 0 | Cache pour splice 5Y (silencieux) |

Le mode `alltime` :
- Démarre le 07/04/2025 (veille du 1er dépôt IBKR)
- NAV initiale = 0, toutes les devises à 0
- Rejoue TOUS les dépôts et trades depuis le début
- Ne rend aucun graphe — stocke le résultat dans `window._simulationAllTimeCache`
- Retourne immédiatement après le cache (pas de Chart.js)

`buildEquityHistoryChart` utilise ce cache pour le splice :
- Dates **avant** le début de la simulation → EQUITY_HISTORY (mensuel)
- Dates **dans** la simulation → données alltime (hebdomadaire)
- Plus de warmup nécessaire, plus de perte de données

### 41.3 Unification P&L (v251)

**Source unique de vérité** : les arrays `plValues` de la simulation.

Avant v251, deux méthodes coexistaient :
- Cards P&L : `NAV_end - NAV_start - deposits_period` (recomputation indépendante)
- Titre graphe : `NAV_end - NAV_start` (changement NAV, dépôts inclus)

Après v251, tout utilise `plValues[end] - plValues[start]` :
- `plValues[i] = NAV[i] - cumDeposits[i]` (calculé dans la simulation)
- Cards : `updateKPIsFromChart()` lit directement `plSeries` depuis `_ytdChartFullData`
- Titre graphe : `renderPortfolioChart()` lit le PL correspondant au scope/période
- % calculé sur capital déployé : `startNAV + deposits_period` (cohérent partout)

### 41.4 Fix Degiro au splice (v252)

La simulation alltime met `degiro=0` pour toutes ses dates (Degiro n'est pas simulé). Mais Degiro était encore actif jusqu'au 14/04/2025. Au point de splice (07/04/2025), cela causait un P&L Degiro de -€4,149 (-100%).

Fix : reporter la dernière valeur Degiro connue de EQUITY_HISTORY pour les dates de simulation avant `DEGIRO_CLOSURE_DATE = '2025-04-14'`.

### 41.5 Note explicative P&L (v252)

Ajout d'une note dans `index.html` entre les KPI (Réalisé/Non Réalisé) et les cards P&L périodiques, expliquant la différence :
- **P/L Réalisé + Non Réalisé** = somme position par position
- **P&L périodique** = NAV − dépôts (inclut intérêts marge, FX cash, commissions, FTT)

### 41.6 Init flow (app.js)

```
1. buildPortfolioYTDChart(mode='ytd')     → graphe visible + KPIs Daily/MTD/1M/YTD
2. buildPortfolioYTDChart(mode='1y')      → silencieux, KPI P&L 1Y
3. buildPortfolioYTDChart(mode='alltime') → silencieux, cache _simulationAllTimeCache
4. buildPortfolioYTDChart(mode='ytd')     → rebuild (1Y a écrasé le canvas)
5. buildEquityHistoryChart('5Y')          → quand user clique 5Y, utilise alltime cache
```

### 41.7 Checklist v248→v252

| Changement | Status |
|---|---|
| Mode alltime dans buildPortfolioYTDChart | ✅ |
| _simulationAllTimeCache dans charts.js | ✅ |
| Appel alltime dans app.js init flow | ✅ |
| Splice simplifié (plus de warmup 30j) | ✅ |
| Cards P&L via plSeries (source unique) | ✅ |
| Titre graphe via plSeries | ✅ |
| % via capital déployé (startNAV + dépôts) | ✅ |
| Fix Degiro NAV au splice (carry forward EH) | ✅ |
| Note explicative P&L dans index.html | ✅ |
| ARCHITECTURE.md mis à jour | ✅ |
| Version bump v247→v252 (all files) | ✅ |

---

## §42 — Changelog v253 → v257 : Tooltip absolu + SGTM + UX fixes

### 42.1 Contexte

Après l'unification P&L (v252), le tooltip de détail (panneau au clic) et le hover tooltip montraient des données incohérentes selon la période sélectionnée. En mode YTD/1Y, les dépôts affichés étaient relatifs à la période (uniquement les nouveaux dépôts dans la fenêtre), pas les dépôts cumulés à vie. Résultat : P&L ≠ NAV − Déposé dans le tooltip.

Exemple concret : en 1Y au 23/03/2026, le tooltip Degiro montrait NAV=0, Déposé=0, P&L=+50 665€ (incohérent).

### 42.2 v253 — Note méthodologique P&L + SGTM tooltip (5Y)

- Ajout note explicative entre les KPI strips : différence entre P&L position par position et P&L simulation (NAV−dépôts)
- Ajout ligne SGTM dans le tableau de détail au clic du graphe 5Y (buildEquityHistoryChart)
- Condition : `if (nav.sgtm > 0 || pl.sgtm !== 0) html += row('SGTM', ...)`

### 42.3 v255 — Tooltip absolu : computeAbsoluteTooltipArrays()

Nouvelle fonction helper `computeAbsoluteTooltipArrays(chartLabels, navIBKR, navESPP, navSGTM, navDegiro, navTotal)` qui calcule les dépôts cumulés à vie et le P&L absolu pour chaque courtier à chaque date.

Sources de données par courtier :

| Courtier | Méthode dépôts |
|----------|----------------|
| Degiro | Back-calcul rapports annuels : `dépôts = retraits − totalPL`, 3 versements en 2020, retraits annuels |
| ESPP | `contribEUR` de chaque lot (Amine + Nezha) + cash EUR/USD |
| IBKR | Tous les dépôts du relevé (`deposits[]`), convertis en EUR via `fxRateAtDate` |
| SGTM | Coût IPO : `totalShares × market.sgtmCostBasisMAD / FX_STATIC.MAD`, date: 2025-12-15 |

Stockage : `_ytdChartFullData._absoluteTooltip = { absDepsIBKR, absPLIBKR, ... }`

Séparation des références :
- **Hover tooltip** : P&L période-relative (matche la ligne du graphe) + P&L/Déposé absolus en contexte
- **Click detail panel** : toujours données absolues → garantit P&L = NAV − Déposé(net)

### 42.4 v256 — Fix source coût SGTM

Bug : `PORTFOLIO.amine.sgtm?.costPerShareMAD` n'existe pas dans data.js.
Fix : utiliser `PORTFOLIO.market?.sgtmCostBasisMAD` (= 420 MAD/action).
Corrigé dans :
1. `computeAbsoluteTooltipArrays()` (helper)
2. `buildEquityHistoryChart()` section SGTM P&L

### 42.5 v257 — Tooltip flip gauche + hover enrichi

- Le hover tooltip bascule automatiquement à gauche du curseur quand il dépasse le bord droit du viewport
- Format hover tooltip enrichi :
  - Mode P&L : "P&L période: +X" (première ligne) + "NAV | Déposé | P&L total" (ligne contexte)
  - Mode Valeur : "NAV Tous: X" + "diff start" + "P&L: +X | Déposé: Y" (ligne contexte)

### 42.6 Vérification

Testé sur toutes les combinaisons période × mode :

| Période | Mode | P&L = NAV − Deps |
|---------|------|-------------------|
| MTD | Value/P&L | ✅ |
| 1M | Value/P&L | ✅ |
| 3M | Value/P&L | ✅ |
| YTD | Value/P&L | ✅ |
| 1Y | Value/P&L | ✅ |
| 5Y | Value/P&L | ✅ |
| MAX | Value/P&L | ✅ |

### 42.7 Checklist v253→v257

| Changement | Status |
|---|---|
| SGTM ajouté au tooltip 5Y breakdown | ✅ v253 |
| Note méthodologique P&L dans index.html | ✅ v253 |
| computeAbsoluteTooltipArrays() dans charts.js | ✅ v255 |
| Click detail panel → données absolues | ✅ v255 |
| Hover tooltip → P&L abs en contexte | ✅ v255 |
| Fix SGTM costPerShareMAD → market.sgtmCostBasisMAD | ✅ v256 |
| Hover tooltip flip gauche (bord droit) | ✅ v257 |
| Version bump v252→v257 (all files) | ✅ |

---

## §43 — Audit UX v257 (7 avril 2026)

### 43.1 Résumé

Audit UX complet sur les 8 onglets (Couple, Amine, Nezha, Actions, Cash, Immobilier, Créances, Budget) au viewport 1440px.

### 43.2 Points positifs

- Pas de scroll horizontal → layout bien contenu
- Navigation par onglets en `<button>` avec cursor:pointer
- Bon contraste texte blanc sur fond bleu foncé
- 27 charts/visualisations bien intégrés
- Formatage des nombres cohérent via `fmt()` (espaces milliers, symbole €)

### 43.3 Issues identifiées

| # | Sévérité | Issue | Recommandation |
|---|----------|-------|----------------|
| ACC-001 | Critique | 15 `<input type="range">` sans `aria-label` | Ajouter `aria-label` décrivant chaque slider |
| UI-001 | Moyen | Padding boutons inconsistant (5+ valeurs) | Standardiser 2-3 tailles de boutons |
| UI-002 | Moyen | Hiérarchie headings cassée (h2→h4 sans h3) | Respecter h1>h2>h3>h4 strict |
| UI-003 | Moyen | `margin-top: 0` sur h2/h3 (sections collées) | Ajouter margin-top: 32px/24px |
| UI-004 | Moyen | Pas de responsive mobile | Media queries pour 768px et 425px |
| UI-005 | Faible | Active tab = bold uniquement | Ajouter border-bottom sur onglet actif |
| UI-006 | Faible | Pas de hover states sur boutons | Ajouter opacity/shadow au hover |

### 43.4 Roadmap recommandée

Phase 1 (rapide, haut impact) : aria-labels sliders, margin headings
Phase 2 (moyen effort) : responsive design, heading hierarchy
Phase 3 (polish) : boutons hover, active tab styling

---

## §44 — v258 : Implémentation audit UX (7 avril 2026)

### 44.1 Changements appliqués

**ACC-001 (Critique) — Aria-labels sur tous les sliders**
- 15 `<input type="range">` ont reçu un `aria-label` descriptif unique
- Ajout de `for="id"` sur chaque `<label>` associé pour lien explicite label↔input
- Concerne : simulateurs Couple (5), Amine (5), Nezha (3), Coût d'opportunité (2)

**UI-003 (Moyen) — Espacement headings amélioré**
- `.card h2` : ajout `margin-top: 8px` (+ `:first-child { margin-top: 0 }` pour éviter padding en haut de carte)
- `.card h3` : margin-top augmenté de 18px → 24px (+ `:first-child` idem)
- Résultat : sections visuellement mieux séparées sans casser le layout existant

**UI-005 + UI-006 (Faible) — Hover/active/focus states sur boutons**
- `.view-btn` : ajout `background: rgba(255,255,255,0.08)` au hover, 0.12 au active, 0.1 sur `.active`
- `.immo-sub-btn` : idem avec valeurs légèrement inférieures
- `focus-visible` ajouté sur `.cur-btn`, `.view-btn`, `.immo-sub-btn` pour navigation clavier
- `input[type="range"]` : ajout `cursor: pointer` + `focus-visible` outline

**Mobile — Touch target amélioré**
- `input[type="range"]` dans `@media (max-width: 480px)` : `height: 32px` pour zone tactile plus large

**Note** : UI-004 (responsive mobile) était déjà implémenté depuis v229 avec 3 breakpoints (900px, 600px, 480px). L'audit §43 l'avait signalé par erreur.

### 44.2 Checklist v258

| Changement | Status |
|---|---|
| aria-label sur 15 range inputs | ✅ |
| label[for] lié aux inputs | ✅ |
| margin-top headings h2/h3 | ✅ |
| Hover/active states boutons nav | ✅ |
| focus-visible boutons + sliders | ✅ |
| Touch target sliders mobile | ✅ |
| Version bump v257→v258 (all files) | ✅ |

---

## §45 — v259 : Architecture snapshot+delta + EUR/MAD historique (8 avril 2026)

### 45.1 Problème

Le dashboard faisait 2 requêtes massives séparées à Yahoo Finance (YTD + 1Y) à chaque chargement, puis reconstruisait le chart 4 fois (YTD → 1Y silencieux → alltime silencieux → YTD visible). Le taux EUR/MAD pour la valorisation SGTM utilisait un taux fixe (`FX_STATIC.MAD`), ignorant l'évolution de ~7% sur l'année.

### 45.2 Solution : Snapshot + Delta

**Nouveau fichier : `js/price_snapshot.js`** (~110 KB)
- Contient 1Y+ de prix quotidiens pour 19 tickers + 3 paires FX (USD, JPY, MAD)
- Généré par `node generate_snapshot.mjs` (nouveau script utilitaire)
- Les données historiques ne changent pas → stockage statique optimal
- Mis en cache navigateur naturellement (fichier JS statique)

**Nouveau flow de chargement :**
```
1. Charger PRICE_SNAPSHOT (statique, instantané)
2. fetchHistoricalPrices() : fetch YTD delta depuis Yahoo API
3. Merger snapshot + delta (dates après le snapshot uniquement)
4. Résultat : un seul dataset couvrant 1Y+ → utilisé pour TOUS les périodes
```

**Avant (v258) :**
- 2 fetches séparées (YTD + 1Y) = ~40 requêtes API
- 4 passes de build chart (YTD → 1Y → alltime → YTD)
- Deux chemins de données différents (YTD/1Y vs 5Y/MAX)

**Après (v259) :**
- 1 fetch unique (delta YTD) = ~22 requêtes API (-45%)
- Données snapshot pré-chargées instantanément
- Un seul dataset pour toutes les périodes

### 45.3 EUR/MAD historique

- `EURMAD=X` ajouté au fetch (api.js) et au snapshot
- `getFxRate()` dans charts.js supporte maintenant USD, JPY et MAD
- SGTM valorisé avec le taux EUR/MAD du jour (au lieu du taux fixe)
- Coût de base SGTM (IPO) converti au taux du 15/12/2025 via `_lookupFx()`
- `unifyPrices()` injecte le taux MAD live comme pour USD/JPY
- Variation observée EUR/MAD sur 1 an : 10.11 → 10.85 (~7%)

### 45.4 Fichiers modifiés

| Fichier | Changement |
|---|---|
| `js/price_snapshot.js` | **Nouveau** — snapshot statique 19 tickers + 3 FX |
| `generate_snapshot.mjs` | **Nouveau** — script Node.js pour régénérer le snapshot |
| `js/api.js` | `fetchHistoricalPrices()` remplace YTD+1Y, ajoute EUR/MAD, merge snapshot+delta |
| `js/charts.js` | `getFxRate()` supporte MAD, `_lookupFx()` helper, `EURMAD` constant éliminée |
| `js/app.js` | Import PRICE_SNAPSHOT, un seul fetch, unification FX MAD |
| `index.html` | Version bump v259 |

### 45.5 Maintenance du snapshot

Pour mettre à jour le snapshot (recommandé mensuellement ou après ajout de nouveaux tickers) :
```bash
node generate_snapshot.mjs
git add js/price_snapshot.js
git commit -m "Refresh price snapshot"
```
Le delta runtime couvre automatiquement la période snapshot→aujourd'hui.

## §46 — v260 : Audit P&L breakdown — commission FX, double-comptage, pureté FX (8 avril 2026)

### Contexte
Audit de la "Répartition P&L par position" (breakdown YTD) — 3 bugs identifiés
dans `computePeriodBreakdown()` (charts.js).

### Bug 1 : Commission en devise native non convertie
- **Symptôme** : Shiseido (buy) affiché €-872 au lieu de ~€-5
- **Cause** : `periodCosts.commissions += t.commission` ajoutait ¥871.60 comme €871.60
- **Fix** : Conversion via `t.commission / snapEnd.fxJPY` (ou fxUSD selon devise)
- **Note** : engine.js faisait déjà la conversion correcte via `toEUR()`

### Bug 2 : Double-comptage des frais
- **Symptôme** : Somme des items = chartPL + 503€ (les frais comptés 2 fois)
- **Cause** : `fxOnCash = chartPL - posM2M` est un résidu qui INCLUT déjà les
  frais (intérêts, commissions, FTT, dividendes) car ils réduisent le cash → NAV.
  Mais ces frais étaient aussi affichés comme lignes séparées.
- **Fix** : `pureFxOnCash = fxOnCash - displayedCosts` retire les frais du résidu
  avant affichage. Résultat : items somment à chartPL (±1€ arrondi).

### Bug 3 : Mouvements de capital dans le P&L
- **Symptôme** : Le détail "Effet FX / Cash" contenait :
  - "JPY variation emprunt" (-18 448€) — nouvel emprunt JPY, PAS du P&L
  - "USD variation solde" (+4 077€) — remboursement marge USD, PAS du P&L
  - "EUR cash (solde)" (+16 263€) — dépôts + flux trades, PAS du P&L
- **Principe** : Seuls les effets de change purs et les frais/intérêts sont du P&L.
  Les dépôts, emprunts, et flux de trades sont des mouvements de capital.
- **Fix** : La ligne "Effet de change" (anciennement "Effet FX / Cash") ne montre
  plus que les effets de change purs par devise :
  - `EUR/JPY` : effet FX jour par jour sur le solde JPY existant
  - `EUR/USD` : idem sur le solde USD
  - `Autres (arrondis)` : résidu d'équilibrage
  Le calcul itère jour par jour : `prevSnap.cashJPY / curSnap.fxJPY - prevSnap.cashJPY / prevSnap.fxJPY`
  (= "si le solde JPY n'avait pas bougé, combien le taux a-t-il coûté/rapporté ?")

### Vérification exhaustive des autres fonctions
Aucun autre endroit ne mélange capital et P&L :
- `engine.js` `periodPL()` — P&L = valeur fin - valeur début (via refPrice), exclut dépôts ✓
- `engine.js` `computeCommissions()` — convertit en EUR via `toEUR()` ✓
- `charts.js` `buildEquityHistoryChart()` — P&L = NAV - cumDeposits ✓
- `charts.js` `computeAbsoluteTooltipArrays()` — arrays tooltip, pas de mélange ✓
- `render.js` `detailPL*()` — délèguent aux breakdowns charts.js ou engine.js ✓
- `app.js` `updateKPIsFromChart()` — utilise les P&L du chart (dépôts soustraits) ✓

### Fichiers modifiés
- `charts.js` : `computePeriodBreakdown()` — 3 corrections (commission FX, pureFxOnCash, détail FX pur)
- `app.js` : version bump imports → v260
- `index.html` : version bump → v260
