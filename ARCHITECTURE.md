# Architecture — Dashboard Patrimonial

> Dernière mise à jour : 12 avril 2026 (v289)
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
| `PORTFOLIO.amine.creances` | Créances avec statut (en_cours/en_retard/recouvré), paiements, probabilité. Items recouvrés exclus du NW (déjà en cash) |
| `PORTFOLIO.amine.facturation` | Positions inter-personnes Augustin/Benoit en MAD. Fallback si localStorage vide (bridge avec site facturation) |
| `PORTFOLIO.amine.tva` | TVA à payer (négatif = dette) |
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
| v271 | Avril 2026 | **Fix Total Déposé** : dépôts nets Degiro (soustraction retraits), 263K→238K |
| v272-v274 | Avril 2026 | **Fix chart blank** + barre progression : re-render explicite après refresh, progression 2 phases (live 0-50%, historique 50-100%) |
| v275 | Avril 2026 | **Fix 1Y button** : `chartResultYTD2` → `chartResultYTD` (ReferenceError empêchant tous les handlers). Fix 5Y/MAX stale data. Fix owner tooltip |
| v276 | 8 Avril 2026 | **Refactoring owner ESPP per-owner** : remplacement du ratio proportionnel ESPP par un calcul lot-par-lot. `esppSharesAtDateAmine/Nezha()`, séries NAV/P&L/dépôts per-owner dans `buildPortfolioYTDChart` + `buildEquityHistoryChart`. `renderPortfolioChart` utilise les arrays per-owner directement. Tooltips et click detail panel mis à jour. **Fix critique** : `renderPortfolioChart` exporté de charts.js (était privé → `ReferenceError` silencieux cassant tout l'init). Voir `BUG_TRACKER.md` BUG-005, BUG-013 |
| v277 | 8 Avril 2026 | **Animation login data-dependent** : l'animation grille du login est maintenant liée au chargement réel des données. Phase 1 : remplissage lent (~80% valeur statique) pendant le chargement. Phase 2 : remplissage rapide vers la vraie valeur marché après chargement complet (live + historique). La valeur affichée est le `getGrandTotal()` réel, plus la valeur statique codée en dur. Signal via `window._gridAnimationComplete(realTotal)` appelé dans `app.js` après `renderPortfolioChart()`. |
| v278 | 11 Avril 2026 | **Mountain silhouette + liquid fill animation** : remplace la grille 40×25 du login par un SVG mountain (clipPath + linear gradient water). Ratio en hauteur (`waterY = BASE_Y − ratio × HEIGHT_RANGE`), surface ondulée sinusoïdale. Animation 2 phases (slow Phase 1 pendant load, fast Phase 2 sur data ready). Ajout d'un display `#gridEta` à la fin : "🎯 1M€ en mars 2029 · 2 ans 11 mois" calculé via `computeMonthsTo1M(nw, 8k€/mois, 8% r)`. **BUG-014 identifié** : asymétrie Degiro Total Déposé vs P&L Réalisé documentée dans `BUG_TRACKER.md`. |
| v279 | 11 Avril 2026 | **BUG-014 fix — Net Capital Deployed** (Option 3) : (1) Helper centralisé `netDeposits(platform)` dans `engine.js` remplace les 4 calculs ad-hoc, sans `Math.max(0,…)` défensif. (2) Invariant comptable `NAV − Net Déployé ≈ Realized + Unrealized` vérifié runtime après ajustement de `combinedRealizedPL` avec log console (`[engine] Accounting balanced ✓`) ou warn si Δ > €5K. (3) KPI renommé "Total Déposé" → **"Capital Net Déployé"** avec tooltip explicatif + sub-line breakdown par plateforme (ex: "IBKR 137K · ESPP 65K · SGTM 36K · Degiro −51K"). (4) Scope Degiro affiche maintenant Net = −€50,664 (pas 0), rendant l'invariant vérifiable visuellement. (5) `degiroDepositsNet/Gross/Withdrawals` exposés dans l'objet `compute()`. (6) Fix adjacent : `render.js:2131` utilisait `av.totalDeposits` sous un label "Dépôts IBKR" → remplacé par `av.ibkrDepositsTotal`. Impact : `totalDeposits` 238K → 187K, Actions − Déposé repasse positif (+42K ≈ Realized+Unrealized). Voir `BUG_TRACKER.md` BUG-014. |
| v282-283 | 12 Avril 2026 | **Mountain login polish** : strip atmospheric background (sky, stars, moon, fog), shrink counter (34px/6.4vw), mountain container (360px/80vw/aspect 1.2). Rhythm pills evolved: "À INVESTIR/RICHESSE CRÉÉE" → "RYTHME CIBLE/RYTHME ACTUEL" → removed RYTHME CIBLE (redundant with ETA). Fix compound formula: annuity `P = (FV - PV·(1+r)^n) / (((1+r)^n - 1)/r)` replaces linear. Créances updates: INVSNT001 paid, INVSNT002+003 added, rents paid, Mehdi advance. Facturation integration: Augustin +181,609 MAD / Benoit -196,915 MAD from data.js + localStorage bridge with facturation site (same origin). Fix recouvré double-counting in NW calc. |
| v284 | 12 Avril 2026 | **Créances view split** : sépare le tableau créances en 3 sections — (1) Créances en cours (actives), (2) Dettes & Obligations (TVA, Badre via facturation), (3) Créances recouvrées (historique). KPIs basés uniquement sur actives. Barre Garanti/Incertain exclut les recouvrés. `computeCreancesView()` retourne `activeItems`, `recoveredItems`, `dettes[]`, `totalDettes`. Voir BUG-015, BUG-016. |
| v285 | 12 Avril 2026 | **Audit KPI consistency** : fix 9 endroits désynchronisés après l'ajout de `facturationNet`. Ajout de `facturationNet` dans `couple.autreTotal`, `renderCoupleTable`, `renderAmineTable`, insights. Ajout de `- nezhaCautionRueil` dans `views.couple.other`, `views.nezha.other`. Nouvelles catégories treemap : "Dettes & Obligations" (couple), "TVA à payer" (amine), "Caution Rueil" (nezha). Invariant : `stocks + cash + immo + other = nwRef` pour les 3 vues. MAJ soldes : Mashreq 484K AED, Wio Savings 195.5K, NEW Wio Business (Bairok) 47K AED, Revolut 190€, Attijari 6.8K MAD. Voir BUG-017. |
| v286 | 12 Avril 2026 | **Fix tooltip per-owner delta** : le tooltip hover du chart en mode Valeur utilisait `data.startValue` (NAV couple ~54K) pour calculer le delta, jamais filtré par owner. Résultat : owner Nezha (NAV ~8K) affichait -45K de delta au lieu de +2K. Fix : recalcul de `startV` à partir des arrays NAV per-owner au `startIdx` quand `owner !== 'both'`. Le header titre et les labels étaient déjà corrects (utilisent les PL series filtrées). Voir BUG-018. |
| v287 | 12 Avril 2026 | **Fix Augustin manquant dans vue créances** : `computeCreancesView()` n'injectait pas les positions facturation positives (receivables) dans `activeItems`. Refactoring : création de `factuCreances[]` (positives = Augustin me doit) et `dettes[]` (négatives = je dois à Benoit). `activeItems.push(...factuCreances)` avant le calcul des KPIs. Support localStorage + fallback data.js. Audit NW confirmé : aucun double-comptage (créances view est display-only, NW utilise `amineFacturationNet` séparément). Voir BUG-019. |
| v289 | 12 Avril 2026 | **FX P&L decomposition + version badge + audit v2 (BUG-036→BUG-038)**. (1) P&L par action inclut désormais l'impact FX : ajout `fxRate` (taux ECB historique) sur chaque trade non-EUR dans `data.js`, calcul du FX moyen pondéré d'acquisition dans `engine.js`, décomposition `totalPL = stockPL + fxPL`, nouvelle colonne "FX P/L" dans le tableau des positions. SGTM utilise le FX IPO historique (10.8) au lieu du FX courant. (2) Badge version (`APP_VERSION`) affiché dans le header pour vérifier le déploiement. (3) Fix imports `simulators.js` stale (v=259→v=289). |
| v288 | 12 Avril 2026 | **Audit complet codebase — 16 bugs corrigés (BUG-020→BUG-035)**. HIGH: (1) ESPP cash (~2,100€) ajouté au NW calc — `amineEspp` inclut `cashEUR`, `nezhaEspp` inclut `cashUSD`. (2) Event listeners dupliqués fixés avec guard `_chartTogglesBound`. (3) Table Nezha inclut `villejuifReservation`. MEDIUM: (4) Sub-card créances filtre recouvré. (5) WHT_RATES corrigés (FR 25%, US 30%). (6) `startValue` scope fallthrough fixé pour 'all'/'degiro'. (7) DG.PA retiré de DIV_CALENDAR/DIV_YIELDS (vendu). (8) DATA_LAST_UPDATE→12/04. (9) Action Logement EXIT_COSTS taux 0.01→0.005. (10) Geo chart dynamique depuis positions IBKR. LOW: (11) Insights tooltips dynamiques. (12) Period % "—%"→"0.0%". (13) Commentaires stale mis à jour. (14) Nezha créances dynamiques (plus de items[0] hardcodé). (15) refreshFX wrappé en .catch(). (16) _equityEntries index alignment fixé (full array, consumers check .note). |
| v281 | 11 Avril 2026 | **Hotfix v280 — `amountToArcRatio` manquant**. Le refactor v280 référait la fonction `amountToArcRatio()` dans `placeHiker()` et `onAnimationComplete()` mais la définition n'avait jamais été insérée dans `index.html`. Résultat : `ReferenceError: amountToArcRatio is not defined` sur la toute première frame de `renderLoop`, ce qui crashait la boucle d'animation → compteur bloqué à "€ 0", marcheur immobile au pied du sentier. Fix : ajout explicite de la fonction (piecewise linéaire sur les ancres `[0, 500K, 750K, 1M]` → `[0, 0.414, 0.590, 1.0]`) juste avant `placeHiker`. Aucune autre régression. Déclenché par test visuel production (user report : "je ne vois pas l'animation"). |
| v280 | 11 Avril 2026 | **Mountain login redesign — 3-peak chain + trail + hiker** (suite audit UX). Remplace la silhouette mono-pic + liquid fill (v278) par une chaîne de 3 sommets (jalons €500K / €750K / €1M) avec un sentier en zigzag (switchback) dessiné en pointillé. Le marcheur (cercle vert) est positionné par **arc-length** le long du sentier via `getPointAtLength()` — plus de remplissage par hauteur. Mapping **piecewise linéaire** par jalon : à €500K, €750K ou €1M pile, le marcheur atterrit exactement sur le jalon correspondant (invariant garanti, pas de dérive visuelle). Typographie : suppression du `%` trompeur (remplacé par `€X à gravir`), ajout de 3 lignes de vélocité sous la pastille objectif (`🎯 1M€ en …`, `⚡ Rythme requis : ~€X/mois`, `📈 rythme réel 6m → ETA`). **Calcul de vélocité** dans `app.js` : delta 6 mois glissant sur `EQUITY_HISTORY.total` avec bornes de sanité (500-50K€/mois) et fallback sur 8K€/mois simulateur si hors bornes ou historique absent. Code couleur sur la ligne ETA projetée : vert si `-1 mois`, ambre si `+4+ mois`, rouge si jamais atteint. Invariant runtime `[mountain] ✓ Animation parity ok` + log `Hiker arc-ratio`. **Auth cookie** : `365j → 2j` — re-prompt tous les 2 jours si inactif. Motivation : voir audit UX (triangle mono-pic visuellement à 90% d'aire pour 68% de progress → impression trompeuse de "presque fini"). |

---

## 9. YTD Chart — Forward Simulation Pipeline (v264-v287)

### Vue d'ensemble

Le graphique YTD dans l'onglet Actions est une **simulation forward day-by-day** qui reconstitue la NAV du portefeuille boursier (IBKR + ESPP + SGTM) pour chaque jour calendaire depuis le 1er janvier.

**Important** : Ce graphique simule uniquement le portefeuille boursier. Les soldes bancaires (Mashreq, Wio, Attijari, Revolut) n'y apparaissent PAS — ils sont reflétés dans les KPI cards NW de la page patrimoine.

### Pipeline de données

```
api.js (fetchHistoricalPrices)
  → PRICE_SNAPSHOT + Yahoo Finance delta
  → { tickers: {ticker: {dates[], closes[]}}, fx: {usd/jpy/mad: {dates[], closes[]}} }

charts.js (buildPortfolioYTDChart)
  1. Reverse trades 2026 → startHoldings au 1er janvier
  2. Collect all events (trades, FX, deposits, costs) sorted by date
  3. For each calendar day:
     a. Apply events up to this date (buy/sell/FX/deposit/cost)
     b. Price all holdings via getClose(ticker, date)
     c. Compute cash value (EUR + USD/fxUSD + JPY/fxJPY)
     d. NAV = positionValue + cashValue
     e. Compute ESPP value (per-owner lots × ACN price)
     f. Compute SGTM value (shares × interpolated price)
     g. Total = IBKR NAV + ESPP + SGTM
  4. Store _simSnapshots per date for breakdown computation
```

### Gestion des achats/ventes mid-year

Le chart utilise deux mécanismes selon le mode :

- **Mode YTD** : part des positions actuelles, reverse les trades 2026 chronologiquement pour trouver l'état au 1er janvier. Si tu avais vendu 100 actions en mars, elles sont rajoutées au 1er janvier.
- **Mode 1Y/alltime** : part de zéro (startHoldings vide), replay tous les trades depuis le début.

Pour chaque jour de la simulation, les transactions sont appliquées dans l'ordre chronologique :
- **Buy** : `holdings[ticker].shares += qty`, `cash -= cost`
- **Sell** : `holdings[ticker].shares -= qty`, `cash += proceeds`
- **FX** : gère EUR↔JPY, USD↔JPY, EUR↔USD, EUR↔AED avec convention de signe jpyAmount
- **Deposit** : `cashEUR += amount` (sauf dépôts non-EUR, gérés par le trade FX correspondant)
- **Cost** : intérêts, dividendes, commissions, FTT → ajoutés aux balances cash respectives

### ESPP per-owner (v276+)

Les lots ESPP sont filtrés par date d'acquisition pour chaque owner :
- `esppSharesAtDateAmine(date)` : lots Amine acquis ≤ date
- `esppSharesAtDateNezha(date)` : lots Nezha acquis ≤ date (à partir de nov 2023)

Cela produit des courbes genuinely différentes pour Amine vs Nezha (contrairement à l'ancien ratio proportionnel).

### Scopes et séries

| Scope | Séries incluses |
|---|---|
| IBKR | NAV IBKR seul (positions + cash broker) |
| ESPP | Valeur ESPP (ACN × shares + cash UBS) |
| Maroc (SGTM) | Valeur SGTM (shares × prix interpolé / MAD) |
| Degiro | NAV Degiro (compte clôturé, NAV=0, 100% Amine) |
| Tous | IBKR + ESPP + SGTM + Degiro combinés |

### Audit v287 (16 avril 2026)

Audit complet du graphique YTD après mise à jour des soldes bancaires (v285). Résultat : **aucun bug détecté**. Le chart est indépendant des soldes bancaires (Mashreq, Wio, Attijari, Revolut) — il simule uniquement le portefeuille boursier. La simulation forward, les trades mid-year, le pricing ESPP per-owner, et le SGTM interpolé fonctionnent correctement.

---

## 10. Chart Breakdown System (v188-v193)

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

### Calcul dans engine.js (v279+)

Depuis v279, un helper unique calcule le **Net Capital Deployed** par plateforme :

```javascript
// v279 (BUG-014 fix): source unique de vérité, sans floor défensif
const netDeposits = (platform) =>
  depositHistory
    .filter(d => d.platform === platform)
    .reduce((s, d) => s + d.amountEUR, 0);

const ibkrDepositsTotal = netDeposits('IBKR');
const esppDeposits      = netDeposits('ESPP (UBS)');
const sgtmDepositsEUR   = netDeposits('Attijari (SGTM)');
const degiroDepositsNet = netDeposits('Degiro'); // NÉGATIF attendu pour Degiro clôturé à profit

const totalDeposits = ibkrDepositsTotal + esppDeposits + sgtmDepositsEUR + degiroDepositsNet;
```

**Pourquoi un net négatif est valide** : pour un compte clôturé à profit (Degiro), l'utilisateur a retiré plus de cash (€76,237) qu'il n'en a versé (€25,573). Le delta (−€50,664) représente le P&L réalisé *déjà sorti* du compte. Si on cappe à 0 (comme en v271 avec `Math.max(0, …)`), on rompt l'équation `NAV − Déposé = P&L Réalisé + P&L Non Réalisé` car le gain reste comptabilisé dans `combinedRealizedPL` mais disparaît du total déposé. Voir BUG-014 pour l'analyse complète.

### Invariant comptable (v279+)

Après l'ajustement final de `combinedRealizedPL` (dividendes, commissions, FTT, intérêts), `engine.js` vérifie runtime que :

```
NAV − Net Déployé ≈ Realized P&L + Unrealized P&L   (±€5K)
```

L'écart autorisé (€5K) absorbe les résiduels FX/arrondis historiques (dépôts convertis au taux du jour du dépôt vs. positions valorisées au taux du jour). Toute divergence plus grande déclenche un `console.warn` avec le breakdown par plateforme, aidant à diagnostiquer immédiatement l'asymétrie.

```javascript
const lhs = totalCurrentValue - totalDeposits;
const rhs = combinedRealizedPL + combinedUnrealizedPL;
const balanceDelta = lhs - rhs;
if (Math.abs(balanceDelta) > 5000) {
  console.warn('[engine] ⚠ Accounting imbalance Δ =', balanceDelta.toFixed(2), ...);
} else {
  console.log('[engine] Accounting balanced ✓ Δ =', balanceDelta.toFixed(2), ...);
}
```

**Règle de code** : jamais de `Math.max(0, x)` ou `Math.abs(x)` sur un total comptable. Les valeurs négatives encodent de l'information (retraits, pertes) qu'il ne faut pas écraser. Ajouter une assertion d'invariant dès qu'on introduit un nouveau total agrégé.

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

## §47 — v263 : Fix "Autres (arrondis)" residual ~€14,729 in 1Y breakdown (8 avril 2026)

### Contexte
Après les correctifs v260 (§46), la ligne "Autres (arrondis)" dans le détail
"Effet de change" affichait +€14,729 en période 1Y — un résidu bien trop élevé
pour être du simple arrondi. L'audit a montré que cette valeur représentait en
réalité le P&L réalisé de positions clôturées, non capturé par `totalPosM2M`.

### Cause racine : positions clôturées absentes de `allTickers`

Le set `allTickers` était construit à partir des snapshots de début et de fin
de période UNIQUEMENT :
```javascript
// AVANT (v260-v262) — BUG
const allTickers = new Set([
  ...Object.keys(snapStart.posBreakdown),
  ...Object.keys(snapEnd.posBreakdown),
]);
```

En mode 1Y (simulation from scratch), `snapStart` a un `posBreakdown` vide
(pas de positions au départ) et `snapEnd` ne contient que les positions
**actuellement détenues**. Les positions ouvertes ET fermées pendant la période
(GLE, WLN, NXI, EDEN, QQQM) n'apparaissent dans **aucun** des deux snapshots.

Conséquence : ces tickers avaient des `tradeFlows` (achats/ventes) mais leur
M2M n'était jamais calculé. Pour une position clôturée :
```
m2m = endVal(0) - startVal(0) - tradeFlow = -tradeFlow = P&L réalisé
```
Ce P&L réalisé, non capturé par `totalPosM2M`, se retrouvait intégralement
dans le résidu `pureFxOnCash = chartPL - totalPosM2M - displayedCosts`.

### Positions affectées et P&L manquant

| Ticker | Opérations | P&L manquant (€) |
|--------|-----------|-------------------|
| QQQM | buy avr 2025 (exclu du 1Y), sell fév 2026 | +12 318 |
| GLE | buy août 2025, sell fév 2026 | +4 820 |
| WLN | buy août/oct 2025, sell fév 2026 | -3 193 |
| EDEN | buy sept 2025, sell oct 2025/fév 2026 | +615 |
| NXI | buy août/oct 2025, sell fév 2026 | +420 |
| **Total** | | **~14 980** |

Note : QQQM est un cas particulier — l'achat (avr 2025-04-03) est 5 jours
avant `START_DATE` ('2025-04-08') et donc exclu du 1Y. Le sell crédite
$14 528 en cashUSD sans achat correspondant dans la simulation.

### Fix (v263)

Inclure les clés de `tradeFlows` dans `allTickers` :
```javascript
// APRÈS (v263) — CORRIGÉ
const allTickers = new Set([
  ...Object.keys(snapStart.posBreakdown),
  ...Object.keys(snapEnd.posBreakdown),
  ...Object.keys(tradeFlows),  // positions clôturées
]);
```

Le calcul de `tradeFlows` a été déplacé AVANT la construction de `allTickers`
(il était déjà juste après dans le code, mais l'ordre est désormais explicite).

### Résultat

| Période | "Autres (arrondis)" avant | après |
|---------|---------------------------|-------|
| Daily | 0 | 0 |
| MTD | 0 | 1 |
| 1M | ~120 | ~120 |
| YTD | ~12 500 | -216 |
| 1Y | **+14 729** | **-251** |

Le résidu restant (~250€) est un arrondi légitime dû à :
- `nav` arrondi à l'entier dans chaque snapshot (`Math.round`)
- Précision discrète du décomposition FX jour-par-jour (cashJPY/USD de la veille)
- Différence entre taux FX snapshot et taux FX réels des trades intra-journaliers

### Fichiers modifiés
- `charts.js` : `computePeriodBreakdown()` — allTickers inclut tradeFlows keys
- `app.js` : version bump imports → v263
- `index.html` : version bump → v263

---

## §48 — v264 : Fix NAV divergence ~€10K between 1Y and YTD at same date (8 avril 2026)

### Contexte
Après le fix v263, un second problème est apparu : le NAV affiché au 16 mars 2026
différait de ~€10K entre la vue 1Y (€249,361) et la vue 1M/YTD (€239,534).

### Cause racine : QQQM buy exclu du 1Y simulation

Le mode 1Y calcule `START_DATE` comme `today - 1 an` = 2025-04-08. Mais l'achat
de QQQM a eu lieu le 2025-04-03, soit 5 jours AVANT `START_DATE`. La simulation
1Y incluait donc la vente de QQQM ($14,528 en proceeds) sans l'achat correspondant
($10,776 en cost), créant un gain fantôme de ~€10K.

### Fix (v264) : étendre START_DATE pour inclure le premier trade

Pour les modes `1y` et `alltime`, on étend `START_DATE` pour inclure le trade le
plus ancien (tous les tickers, pas seulement QQQM) :

```javascript
// Mode 1Y — v264
const d = new Date();
d.setFullYear(d.getFullYear() - 1);
START_DATE = d.toISOString().slice(0, 10);

// v264 fix: extend START_DATE to include trades before the 1Y mark
const earliestTradeDate = (portfolio.amine.ibkr.trades || [])
  .filter(t => t.type !== 'fx')
  .reduce((min, t) => t.date < min ? t.date : min, START_DATE);
if (earliestTradeDate < START_DATE) {
  const et = new Date(earliestTradeDate);
  et.setDate(et.getDate() - 1);
  START_DATE = et.toISOString().slice(0, 10);
}
```

Même logique pour le mode `alltime` (premier dépôt OU premier trade).

### Résultat

| Métrique | Avant v264 | Après v264 |
|----------|-----------|------------|
| 1Y total P&L | -9,399 | -17,909 |
| QQQM P&L dans breakdown | +12,318 (fantôme) | +3,210 (correct) |
| NAV gap 1Y vs YTD (Mar 16) | ~€10,000 | **€403** |
| "Autres (arrondis)" 1Y | -251 | -251 (inchangé) |

Le gap résiduel de €403 est un offset de calibration constant entre les deux modes :
- YTD démarre avec des valeurs de cash calibrées (relevé IBKR au 31/12/2025)
- 1Y reconstruit le cash en rejouant tous les dépôts/trades depuis zéro
- La différence vient d'arrondis cumulés dans les conversions FX des transactions

### Fichiers modifiés
- `charts.js` : extension de START_DATE en modes 1y et alltime
- `app.js` : version bump imports → v264
- `index.html` : version bump → v264

---

## §49 — v265 : Infrastructure de vérification cross-mode (8 avril 2026)

### Objectif
Ajouter des globals de débogage pour préserver les données de chaque mode de
simulation, car le build sequence (YTD → 1Y → alltime → YTD) écrase
`_simSnapshots` et `_ytdChartFullData` à chaque passage.

### Globals ajoutés
- `window._1ySimSnapshots` : snapshots jour-par-jour du mode 1Y
- `window._1yChartFullData` : données complètes du chart 1Y
- `window._alltimeChartFullData` : données complètes du chart alltime

Ces globals permettent de comparer programmatiquement les NAV entre modes à
n'importe quelle date de chevauchement, sans avoir à modifier le build sequence.

### Vérification effectuée (v265)

Comparaison NAV IBKR entre 1Y et YTD à 6 dates :

| Date | YTD NAV | 1Y NAV | Diff |
|------|---------|--------|------|
| 2026-01-02 | 210,944 | 211,347 | +403 |
| 2026-02-02 | 202,293 | 202,696 | +403 |
| 2026-03-02 | 201,566 | 201,969 | +403 |
| 2026-03-16 | 197,101 | 197,504 | +403 |
| 2026-04-07 | 186,677 | 187,080 | +403 |
| 2026-04-08 | 195,044 | 195,446 | +402 |

L'offset est **constant à €403** — calibration drift acceptable entre les deux
approches de simulation.

### Fichiers modifiés
- `charts.js` : ajout globals `_1ySimSnapshots`, `_1yChartFullData`, `_alltimeChartFullData`
- `app.js` : version bump imports → v265
- `index.html` : version bump → v265

---

## §50 — v266 : Carte KPI "Autre" sur la vue COUPLE (8 avril 2026)

### Problème
Les 3 cartes visibles (Actions, Cash, Immo) ne totalisaient que ~€582K vs
NW Combiné ~€675K. L'écart de ~€93K correspondait à des composantes incluses
dans `amineNW`/`nezhaNW` mais sans carte dédiée : véhicules, créances, TVA.

### Solution
Ajout d'une 7ᵉ carte KPI "Autre (Véhicules, Créances)" sur la vue COUPLE.

**engine.js** — nouveaux champs dans `couple` :
```javascript
autreTotal: amineVehicles + amineRecvPro + amineRecvPersonal + amineTva
  + nezhaRecvOmar + nezhaVillejuifReservation - nezhaCautionRueil,
autreVehicles, autreCreancesPro, autreCreancesPerso, autreTva,
autreVillejuifReservation, autreCautionRueil,
```

**index.html** — grille passée de `repeat(6, 1fr)` à `repeat(7, 1fr)` +
nouvelle carte `kpiCoupleAutre`.

**render.js** — `setEur('kpiCoupleAutre', s.couple.autreTotal)` + insight
détaillant chaque composante. Insights `kpiCoupleNW` et `kpiCoupleAmNW`
corrigés pour inclure la catégorie "Autre".

### Vérification
Immo + Cash + Actions + Autre = NW Combiné ± €1 (arrondi).

### Fichiers modifiés
- `engine.js` : ajout `autreTotal` et sous-composantes dans `couple`
- `render.js` : rendu carte + insights mis à jour
- `index.html` : 7ᵉ carte + grille 7 colonnes, version bump → v266

---

## §51 — v267 : Trades 8 avril 2026 — DG.PA vendu + EUR.JPY deleverage (8 avril 2026)

### Trades ajoutés
1. **DG.PA (Vinci)** — sell 100 @ 136.65€. Position entièrement fermée.
   P&L réalisé : +€1,419 (costBasis 122.46). Commission : -€6.83.
2. **EUR.JPY** — sell 11,679 EUR @ 185.060 → +¥2,161,316 (rachat JPY short).
   Commission : -€319.17. Deleverage du short JPY (carry trade).

### Données mises à jour
- `positions[]` : DG.PA retiré (0 actions restantes, commentaire "position fermée")
- `trades[]` : 2 nouvelles entrées datées 2026-04-08
- `cashEUR` : -1 → -341 (approx, hors intérêts mars/avr)
- `cashJPY` : -4,590,694 → -2,429,378 (short JPY réduit de 47%)
- Compteur actions : 14/14 → 13/13

### Impact portefeuille
- DG.PA contribuait ~€13,7K au portefeuille → converti en cash EUR
- Short JPY passé de ¥-4,6M à ¥-2,4M → exposition FX réduite
- NW Amine passe de ~€480K à ~€477K (variation prix intraday)

### Fichiers modifiés
- `data.js` : positions, trades, cash IBKR
- `app.js` : version bump imports → v267
- `index.html` : version bump → v267

## §52 — v268 : Fix P&L 1Y/alltime — double-comptage des dépôts (8 avril 2026)

### Problème

Le graphique P&L en mode 1Y affichait des valeurs aberrantes (P&L ≈ -55 000€ au premier point, -55 939€ au dernier). Le P&L total affiché était ~-17 102€ alors qu'il aurait dû être positif (grâce au Degiro réalisé).

### Cause racine

La formule P&L est : `P&L(t) = NAV(t) − startNAVRef − cumDeposits(t)`.

En mode 1Y, la simulation démarre à NAV=0 et reconstruit tout depuis zéro. Le premier point de NAV (~€54 234) est **entièrement financé par les dépôts** (~€55 000). L'ancien code utilisait `startNAVRef = chartValues[0]` (≈54 234) comme base, ce qui revenait à :

```
P&L = NAV(t) − 54234 − cumDeposits(t)
```

Cela **double-comptait** les dépôts : une fois via `startNAVRef` (qui inclut les dépôts du jour 1) et une fois via `cumDeposits`. En mode YTD, `chartValues[0]` représente le NAV calibré IBKR (STARTING_NAV ≈ €209 495) qui est un vrai point de départ indépendant des dépôts simulés, donc la formule fonctionnait correctement.

### Solution

Introduire `startNAVRef` conditionnel selon le mode :

```javascript
const startNAVRef = (mode === '1y' || mode === 'alltime') ? 0 : chartValues[0];
```

Appliqué aux 4 séries P&L : IBKR, ESPP, SGTM, Total. Le `startValue` utilisé dans le tooltip VALUE est **inchangé** (`chartValues[0]`) car il sert au calcul de variation % et non au P&L.

### Vérification

| Point   | NAV     | cumDeposits | P&L attendu | P&L avant fix | P&L après fix |
|---------|---------|-------------|-------------|----------------|---------------|
| Premier | 54 234  | 55 000      | −766        | −55 000        | −766          |
| Dernier | 196 223 | 197 928     | −1 705      | −55 939        | −1 705        |

P&L Total (avec Degiro +€50 665) : premier = €101 239, dernier = €84 137. Cohérent.

### Note — Degiro réalisé dans le 1Y

Le P&L Total inclut `degiroRealizedPL = +€50 664.55` comme constante ajoutée à chaque point. Ce gain Degiro date d'avant la période 1Y (compte clôturé avril 2025). Pour une vue 1Y pure, il faudrait conditionner l'ajout de ce terme. Non corrigé ici — signalé pour décision future.

### Fichiers modifiés

- `charts.js` : lignes ~3200-3218 — `startNAVRef` conditionnel pour les 4 séries P&L
- `app.js` : version bump imports → v268
- `index.html` : version bump → v268

---

## §54 — v283 : Mountain auth — Senior designer pass + per-person 75/25 target split (11 avril 2026)

### Trigger
Deux demandes utilisateur consécutives :
1. Sur la login montagne, le compteur `€ 683,385` (font `min(44px, 8vw)`, positionné en `absolute` au-dessus de la SVG) chevauchait visuellement le sommet et le label « 🎯 1M€ ».
2. Sur le banner motivation du simulateur couple, afficher combien chacun doit ajouter pour atteindre son target personnel (Amine 75%, Nezha 25% des contributions mensuelles).
3. Demande complémentaire : « act as senior Designer et améliore le rendu de la montagne ».

### Changements — index.html

**1) Compteur sorti du layer absolu** (fix du chevauchement)
- `#gridOverlay` (absolute par-dessus la SVG) remplacé par un nouveau bloc `#gridHeader` en flow normal placé *avant* `#mountainContainer`
- Compteur + label « sur € 1 000 000 » + ligne « à gravir » empilés au-dessus, pas par-dessus
- Résultat : séparation visuelle propre, sommet + 1M€ toujours lisibles même à 6-7 chiffres

**2) Senior designer pass — profondeur atmosphérique**
Nouveaux gradients dans `<defs>` :
- `skyGrad` : ciel nocturne (deep blue → twilight horizon)
- `farMtnGrad` / `midMtnGrad` : silhouettes de fond en brume bleutée
- `stoneGrad` : 4 stops pour plus de profondeur
- `stoneLitGrad` : overlay lumière lunaire (brighter à droite, shadow à gauche)
- `snowGrad` : calotte blanche → grisé
- `fogGrad` : brume de sol semi-transparente
- `moonGlow` : radial glow de la lune
- `goldPillGrad` : pill doré pour le label 1M€
- `softBlur` filter : flou gaussien `stdDeviation=3`

Nouveaux éléments de fond (rendus *avant* la montagne principale) :
- **Sky rect** plein viewBox avec `skyGrad`
- **Starfield** : 24 petites étoiles (r 0.6-1.1), animation `starTwinkle` staggered via `nth-child(3n/3n+1/3n+2)` sur 3.8-5.1s
- **Moon** : groupe `#moon` à (418, 72), glow r=28 + disque r=12 `#fdf6d3` + 3 craters subtils, `moonPulse` 8s
- **Far + mid silhouettes** : deux couches de montagnes éloignées, la plus lointaine floutée

**3) Calotte neigeuse + éclairage latéral**
Dans le groupe clippé :
- `snowCap` : `<rect x=0 y=60 w=480 h=75>` `snowGrad` opacity=0.92
- Snow-line drip `y=125 h=18 opacity=0.35` pour adoucir transition neige→roche
- `stoneLitGrad` overlay entre stone et snow (face est claire, face ouest sombre)
- Ridge stroke 1.8 → 2.2, gradient plus contrasté (white 92% → 15%)

**4) Base fog mist**
`<rect y=400 h=50>` `fogGrad` + `softBlur` devant le pied de la montagne, derrière les randonneurs.

**5) Milestones pills**
Avant : `circle` + `text` flottant. Après :
- Anchor point (`circle r=4` blanc) sur la crête
- Ligne pointillée vers la pill (`stroke-dasharray 1.5 1.5`)
- Pill semi-transparente dark `rgba(15,31,51,0.82)` bord blanc fin, label `.ms-pill` en DM Sans 700
- 1M€ : **pill doré** `goldPillGrad` avec shadow floutée copie en dessous, label `.ms-pill-gold` (noir sur or), anchor doré en haut du sommet

**6) CSS ajouté**
```css
.star { animation: starTwinkle 4.2s ease-in-out infinite; }
@keyframes starTwinkle { 0%,100% { opacity:.35 } 50% { opacity:1 } }
.star:nth-child(3n)   { animation-delay:-1.3s; animation-duration:5.1s; }
.star:nth-child(3n+1) { animation-delay:-2.6s; animation-duration:3.8s; }
.star:nth-child(3n+2) { animation-delay:-0.4s; animation-duration:4.5s; }
#moon { animation: moonPulse 8s ease-in-out infinite; }
.ms-pill      { font:700 8.5px 'DM Sans'; fill:#fff; paint-order:stroke; stroke:rgba(10,18,32,.7); stroke-width:1.8; }
.ms-pill-gold { font:800 9.5px 'DM Sans'; fill:#1a1206; }
```

### Changements — js/simulators.js (banner motivation)

**1) `runSimulatorGeneric` accepte un nouveau param `ownerSplit`**
```js
ownerSplit: { amineNW, nezhaNW, amineShare, nezhaShare }
```
Quand présent, le banner motivation ajoute :
- Titre « 📊 Répartition 75/25 (part des contributions mensuelles) »
- Ligne Amine : `[current] / [target = 1M × amineShare] (%)` + reste OU ✅ atteint
- Barre de progression verte (`#16a34a → #22c55e`) h=4px
- Ligne Nezha identique, barre rose (`#db2777 → #ec4899`)
- Note italique : « Cible Amine = 75% × 1M — Cible Nezha = 25% × 1M »

**2) `runCoupleSimulator` passe les valeurs réelles**
```js
const amineNWStart = s.amine?.nw || 0;
const nezhaNWStart = (s.nezha?.villejuifSigned)
  ? (s.nezha.nwWithVillejuif || s.nezha.nw)
  : (s.nezha?.nw || 0);

runSimulatorGeneric({ ..., ownerSplit: {
  amineNW: amineNWStart, nezhaNW: nezhaNWStart,
  amineShare: 0.75, nezhaShare: 0.25
}});
```
Pour Nezha on utilise `nwWithVillejuif` si signé, sinon `nw` brut (cohérent avec `render.js:372`).

### Rationale
- **Compteur hors overlay** : le compteur + label sont maintenant un bloc autonome au-dessus de la montagne → sommet + 1M€ + drapeau toujours lisibles quel que soit le nombre de chiffres
- **Profondeur atmosphérique** : star + moon + far/mid silhouettes + ridge + snow cap + fog → hiérarchie far/mid/main, paysage « lu » immédiatement
- **Moonlight overlay** : `stoneLitGrad` donne du volume au rocher (gris uniforme → face éclairée / face ombrée)
- **Snow cap** : l'œil associe immédiatement la calotte blanche à « sommet » / « altitude »
- **Milestones pills** : plus pro que des cercles + texte flottant, guide l'œil via la ligne pointillée
- **75/25 split** : objectif individuel tangible — Amine voit « +X€ sur mon 750K », Nezha « +Y€ sur mon 250K »

### Fichiers modifiés
- `index.html` : restructure compteur, réécriture `<defs>` (9 gradients + filter), ajout starfield/moon/far/mid/snowcap/fog/pills, CSS, version bumps v282→v283
- `js/simulators.js` : param `ownerSplit`, HTML banner étendu, `runCoupleSimulator` passe les NW
- `ARCHITECTURE.md` : entrée §54 v283
- `js/app.js`, `js/charts.js` : query string v282 → v283

---

## §53 — v282 : Mountain auth — Couple Amine+Nezha + végétation alignée altitude (11 avril 2026)

### Contexte

v280 avait introduit la narrative "montagne à 3 pics + marcheur qui suit une arête". v281 corrigeait un `ReferenceError` (fonction `amountToArcRatio` manquante). v282 est une refonte visuelle complète demandée par l'utilisateur :

1. Le marcheur unique n'était pas assez engageant. Il faut un **couple** (Amine + Nezha) qui grimpe ensemble.
2. La montagne démarre grise et doit **verdir au fur et à mesure** qu'ils grimpent. Le niveau de verdure doit être **aligné sur l'altitude du couple** (même hauteur que le leader), pas juste sur la progression en euros.
3. Le tracé doit passer par la **crête réelle** de la montagne, pas dans le ciel.
4. Le sommet 1M doit être **central** (deux petits pics décoratifs latéraux).
5. Les milestones atteints doivent être **illuminés** (pulse + halo + drapeau au sommet).

### Géométrie v282

La silhouette est un `<path>` fermé pour le `<clipPath id="mtnClip">`, avec les milestones :

| Milestone | (x,y) sur l'arête | Signification         |
|-----------|-------------------|-----------------------|
| 500K€     | (125, 310)        | Petit pic à gauche    |
| 750K€     | (225, 215)        | Épaule centrale       |
| **1M€**   | **(270, 75)**     | **Sommet central**    |
| (décor)   | (388, 292)        | Petit pic à droite    |

Le `climbTrail` est un path ouvert qui suit la ligne du sommet depuis (20, 440) jusqu'à (270, 75) — c'est littéralement la crête de la montagne.

Le viewBox du SVG passe de `0 0 480 420` à `0 0 480 480`, et le conteneur `aspect-ratio` passe de 1.15 à 1.0 pour que la scène carrée respecte ses proportions.

### Mécanique végétation

Le mont est dessiné en deux couches clipées à la silhouette :

1. Un `<rect>` plein qui couvre tout en `url(#stoneGrad)` (gris/pierre).
2. Un `<rect id="vegFill">` en `url(#vegGrad)` (dégradé vert) qui part de `y=440` (caché sous la base) et monte à mesure que le couple grimpe.

Le niveau est piloté par `updateVegetationFromHikerY(leaderY)` qui **maintient un monotonic max** :

```javascript
let highestYReached = GROUND_Y; // lower y = higher altitude
function updateVegetationFromHikerY(leaderY) {
  if (leaderY < highestYReached) highestYReached = leaderY;
  vegFill.setAttribute('y', highestYReached);
  vegFill.setAttribute('height', 480 - highestYReached);
}
```

Cette logique garantit que la verdure **n'aie jamais à redescendre** quand le couple traverse un col. Si on liait directement `vegFill.y = leaderY`, la végétation reculerait dans chaque creux de l'arête — c'est ce qu'on veut éviter.

### Couple (Amine + Nezha)

Deux groupes SVG distincts sous `#coupleMarker` :

- **`#amineMarker`** : figure en tête (veste menthe `#6ee7a0`, cheveux courts foncés, casquette verte). Un petit `<path class="heart">` rose flotte au-dessus de sa tête et bat à 1.3s.
- **`#nezhaMarker`** : figure juste derrière (veste corail `#f472b6`, longs cheveux `#3a1f14`, bandeau jaune). La classe `.nezha` décale ses animations de marche de `-0.45s` pour éviter le mouvement robotique synchrone.

Chaque figure porte un label `<text class="name-label">` avec son prénom en `paint-order: stroke` pour lisibilité sur fond clair ou sombre.

Les deux sont placés sur la même arête via `getPointAtLength()`, Nezha à `sAmine − NEZHA_TRAIL_OFFSET` (11 unités d'arc) pour qu'elle suive naturellement la forme du terrain à la bonne distance.

### Anchors arc-ratio calculés à l'exécution

v281 avait des anchors hardcodés (`ARC_500K = 0.414`, `ARC_750K = 0.590`) mesurés manuellement sur l'ancienne géométrie. v282 les calcule au runtime via `findArcRatioForPoint(tx, ty)` qui scanne le path par pas de 0.5 unités pour trouver le point le plus proche de la cible :

```javascript
function findArcRatioForPoint(tx, ty) {
  let best = Infinity, bestS = 0;
  for (let s = 0; s <= TRAIL_LENGTH; s += 0.5) {
    const pt = trailEl.getPointAtLength(s);
    const d = (pt.x - tx) ** 2 + (pt.y - ty) ** 2;
    if (d < best) { best = d; bestS = s; }
  }
  return bestS / TRAIL_LENGTH;
}
const ARC_500K = findArcRatioForPoint(125, 310);
const ARC_750K = findArcRatioForPoint(225, 215);
```

Avantage : si la géométrie évolue, les anchors se recalibrent automatiquement. Plus besoin de re-mesurer à la main.

### Milestones illuminés

Chaque milestone est un `<g id="msXXX">` contenant `<circle>` + `<text>`. Les classes CSS `.ms-reached` (vert) et `.ms-summit-lit` (doré) ajoutent une animation `filter: drop-shadow()` qui pulse. Au 1M, un `<circle id="summitHalo">` avec `fill="url(#summitHaloGrad)"` passe de `r=0` à `r=60` via `transition: r 1.2s`, et un `<g id="summitFlag">` (mât + drapeau ondulant via `.flag-wave`) apparaît via `opacity` transition.

### Fichiers modifiés

- `index.html` :
  - Bloc CSS `<style>` : +60 lignes pour `.hiker-figure`, `@keyframes hikerBob / legSwing / armSwing / heartBeat / msPulseGreen / msPulseGold / flagWave`, `.name-label`, `#summitFlag`.
  - Conteneur `#mountainContainer` : `aspect-ratio` 1.15 → 1.
  - SVG `#mountainSvg` : viewBox 480×420 → 480×480, entièrement réécrit (defs, clipPath, stone/vegetation/outline layers, climbTrail, trailLit, milestones, summit halo/flag, coupleMarker).
  - IIFE d'animation : refs DOM renommées (`hikerEl` → `coupleEl`/`amineEl`/`nezhaEl`, ajout de `vegFill`/`trailLit`/`summitHalo`/`summitFlag`/`ms500El`/`ms750El`/`ms1MEl`), ajout de `findArcRatioForPoint` + anchors runtime, `placeHiker` retourne `ptA.y`, ajout de `updateVegetationFromHikerY` + `resetVegetation`, `updateMilestones` rewrite avec classes pulse, `renderLoop` appelle `updateVegetationFromHikerY(leaderY)`.
  - Version bump `v=281` → `v=282`.
- `js/app.js`, `js/charts.js` : imports `v=281` → `v=282`.
- `ARCHITECTURE.md` : cette section.

### Test

- Syntaxe JS validée via `new Function(scriptBlock)` — OK.
- IDs requis présents (`coupleMarker`, `amineMarker`, `nezhaMarker`, `vegFill`, `climbTrail`, `trailLit`, `summitHalo`, `summitFlag`, `ms500`, `ms750`, `ms1M`) — OK.
- Vérification live sur GitHub Pages après déploiement.

---

### Audit métier complet + 4 correctifs (BUG-039 à BUG-042)

v295 fix cash page Nezha ESPP manquant, v296 fix créances sub-card (montants + groupement) + immo CRD prorata journalier + immo sub-card CRD détail visible.

**BUG-039 (v295)** — Cash page manquait Nezha ESPP cash (94€). `computeCashView()` avait Amine ESPP mais pas Nezha ESPP. Fix: ajout entrée Nezha ESPP USD dans la liste des comptes.

**BUG-040 (v296)** — Créances sub-card utilisait montants nominaux (`c.amount`) au lieu de `(amount - payments) × probability`. Groupement par `guaranteed` au lieu de `type` → Kenza (perso, guaranteed) classée pro. Fix: même formule que engine.js + groupement par `c.type`.

**BUG-041 (v296)** — `updateAllDataEur()` écrasait le HTML détaillé des sub-cards immo (CRD invisible). Fix: `data-type="html"` sur les éléments + skip dans la boucle bulk.

**BUG-042 (v296)** — CRD immobilier sautait au 1er du mois. Fix: interpolation linéaire journalière `crdBefore - (crdBefore - crdAfter) × (day-1)/daysInMonth` dans `computeImmoView()`.

### Fichiers modifiés

- `js/engine.js` :
  - `computeCashView()` ~L1458: +1 ligne Nezha ESPP cash
  - `computeImmoView()` ~L2570: remplacement lecture CRD directe par interpolation journalière (15 lignes)
- `js/render.js` :
  - `renderExpandSubs()` ~L485-530: créances items avec `(amount-payments)×probability` + groupement par `type`
  - `updateAllDataEur()` L1148: skip `data-type="html"` éléments
- `index.html` :
  - 3 spans immo sub-cards: ajout `data-type="html"`
- `js/data.js` : version `v295` → `v296`
- `js/app.js`, `js/charts.js`, `js/simulators.js` : imports `v=295` → `v=296`
- `index.html` : script tag `v=295` → `v=296`
- `BUG_TRACKER.md` : BUG-039 à BUG-042
- `ARCHITECTURE.md` : cette section.

### Test

- Cash page total = couple cash card (delta = 0) — OK
- Créances sub-card total = contribution NW (71 919€, delta = 0) — OK
- Kenza sous "Créances personnelles" (pas "pro") — OK
- Sub-cards immo affichent valeur + CRD (ex: "€ 302 257 (2%/an)\nCRD € 267 213") — OK
- Vitry CRD < statique 268 061€ (prorata avril) — OK
- couple = amine + nezha: delta = 0 — OK
- catSum = coupleNW: delta = 0 — OK

---

### Audit métier approfondi v297 — 8 correctifs (BUG-043 à BUG-050)

v297 corrige 8 défauts trouvés par un audit "encore plus poussé" après v296. Ils se répartissent en quatre domaines : cohérence de données (ESPP, Villejuif signed), affichage (insights cash, chart label, chart owner-filter, Cash Dormant négatif), et calcul (simulateurs geometric compounding, Action Logement amortissement).

**Pourquoi ces 8 bugs étaient difficiles à détecter** — aucun ne cassait d'invariant courant :
- BUG-043/044 : formules alternatives qui divergeaient seulement dans des scénarios (FX live éloigné, villejuifSigned=true) rarement atteints.
- BUG-045 : divergence numérique entre insights et treemap (cashCouple tronqué), mais l'affichage "Cash" du treemap restait correct.
- BUG-046 : owner-filter incomplet. Le chart YTD+IBKR+Nezha n'est presque jamais consulté en pratique.
- BUG-047 : latent — ne casse qu'en cas de découvert `wioCurrent < 0`.
- BUG-048 : purement cosmétique (label).
- BUG-049 : biais composé, invisible sur une itération mais +47bp/an effectif sur 20 ans.
- BUG-050 : écart de ~1000€ cumulé sur 25 ans AL, invisible mensuellement.

#### BUG-043 — ESPP cost basis unifié via `esppLotCostEUR`

`engine.compute()` utilisait `toEUR(nezhaEsppData.totalCostBasisUSD, 'USD', fx)` (current FX), pendant que `computeActionsView` utilisait `reduce(esppLotCostEUR)` (per-lot historical FX). Deux vérités pour le même KPI.

**Fix** : hoisting de `esppLotCostEUR(lot, defaultFx)` au niveau module (L33-52), utilisé par les deux consommateurs (L253-255 et L3729-3732). JSDoc détaillée sur la fonction.

#### BUG-044 — `nezhaNW` exclut `villejuifEquity` quand signé (latent)

Historique : `nezhaVillejuifEquity` était ajouté à `coupleNW` et à `views.nezha.nwRef` mais pas à `nezhaNW`. Tant que `villejuifSigned=false`, le delta était 0. Dès signature, `s.nezha.nw` sous-estimait de ~44K€ et tous les consommateurs aval (insights, breakdowns) affichaient un NW Nezha faux.

**Fix** : `nezhaNW` inclut maintenant `+ nezhaVillejuifEquity` (L3762). `coupleNW = amineNW + nezhaNW` propre (L3823). `nwWithVillejuif` recalculée pour éviter double comptage (L3775). `views.nezha.nwRef = nezhaNW` (L3999).

#### BUG-045 — Insights `cashCouple` tronqué

`renderDynamicInsights` utilisait `uae + revolut + maroc + france + marocNz` mais ignorait `brokerCash` (Amine IBKR+ESPP, Nezha ESPP) et Nezha UAE. Insights positifs sous-comptaient le cash, bloc risque sur-estimait `aedPct`.

**Fix** : render.js L761-765 et L782-787 — inclusion de tous les buckets cash avec guards `|| 0`. Commentaires inline qui pointent vers le treemap comme source de vérité.

#### BUG-046 — Chart header %change faux pour owner≠Couple + scope=IBKR/Degiro/SGTM

Le filtrage owner des séries `depSeries` était câblé uniquement pour `scope=espp|all`. Pour IBKR (100% Amine), Degiro (100% Amine), SGTM (50/50), `depSeries` restait couple-level → `plPct = (refValue filtré - depositsCouple)` absurde.

**Fix** : charts.js L2299-2318 — après sélection de `depSeries`, application d'un `ownerRatio` (1/0 pour IBKR/Degiro, shares-ratio pour SGTM lu depuis `PORTFOLIO.*.sgtm.shares` pour rester dynamique).

#### BUG-047 — Cash Dormant guard `wioCurrent>0` casse l'invariant en cas de découvert

`amineCashTotal` sommait `wioCurrent` sans guard (L3655), mais la catégorie "Cash Dormant" le zérait si négatif (L3910 et L4068). Si `wioCurrent<0`, l'invariant `stocks+cash+immo+other = nwRef` cassait.

**Fix** : suppression du guard dans les totaux (non conditionnel), remplacement `>0` par `!==0` dans les sub-arrays (zéro reste masqué, négatif est affiché avec signe).

#### BUG-048 — Label de la ligne de référence hardcodé "NAV 1er jan"

Le label ignorait `period` (MTD/1M/3M) et tombait toujours sur "NAV 1er jan" ou "NAV début 1Y". La valeur était correcte (slicing de `refValue`) mais l'affichage trompeur.

**Fix** : charts.js L2434-2444 — switch sur `period` d'abord (MTD→"NAV début mois", 1M→"NAV il y a 1M", etc.), fallback sur `data.mode` pour 1Y/5Y/MAX.

#### BUG-049 — Simulators monthly rate = `r/12` au lieu de `(1+r)^(1/12)-1`

Approximation APR/12 qui compose à un taux annuel effectif supérieur au taux affiché. 10%/an input → 10.47% effectif/an (+47bp) → sur 20 ans un portefeuille actions grossit ~60K€ de trop.

**Fix** : `simulators.js` L57-61 et L679-681 — `Math.pow(1+r, 1/12) - 1`. Nouvelle variable `monthlySgtmReturn` au lieu de `0.07/12` hard-codé.

#### BUG-050 — Action Logement : assurance intégrée amortit le principal

L'échéance AL de 145.20€ inclut 3.33€ d'assurance intégrée. Le code prenait les 145.20€ comme P&I pur, donc amortissait 3.33€/mois de trop → ~1000€ sur 25 ans, CRD atteignait 0 plusieurs mois avant la fin.

**Fix** : `engine.js` L1836-1854 (branche simple de `computeSubLoanSchedule`) :
- `effectivePayment = monthlyPayment - insuranceMonthly` pour l'amortissement
- `schedule[i].payment` garde l'échéance user-facing (affichage fidèle)
- Aucun impact sur les prêts où `insuranceMonthly=0` (PTZ, BP APRIL)

### Guide pour les prochains audits

**Principes à garder en tête pour ne pas reproduire ces bugs :**

1. **Dé-duplication des calculs** : dès qu'un même KPI est calculé à deux endroits, un des deux peut diverger silencieusement. Toujours hoister la fonction partagée (→ BUG-043). Pattern : cherche les réductions `lots.reduce(...)` ou les conversions `toEUR(...totalCostBasisUSD)` dupliquées.

2. **Flags latents** : un champ comme `villejuifSigned=false` masque un bug tant qu'il n'est pas `true`. Quand tu ajoutes un extra (`+ villejuifEquity`) à une somme mais pas à une autre, tu crées un piège (→ BUG-044). Toujours tester le code path "activé" avant de merger.

3. **Cohérence entre vues** : treemap, insights, breakdowns, risques — tous tapent sur les mêmes inputs mais avec des formules parfois différentes. Source de vérité = treemap/engine.compute. Le reste (render) doit agréger les champs officiels de `s` (→ BUG-045).

4. **Owner filtering complet** : chaque scope a une règle de répartition owner. Ne jamais câbler qu'une partie (→ BUG-046). Pattern : `if (owner !== 'both')` doit couvrir tous les scopes visibles dans la UI. Les ratios owner sont dans `PORTFOLIO.*.sgtm.shares`, `portfolio.*.espp.lots`, etc.

5. **Guards cachés** : un `> 0 ? x : 0` est souvent correct pour un sub-array cosmétique (masquer zéros), mais faux pour un total (perd les négatifs légitimes). Toujours séparer total et display (→ BUG-047).

6. **Labels figés** : `data.mode === '1y' ? 'NAV 1Y' : 'NAV 1er jan'` ignore les sous-modes (period MTD/1M/3M). Quand tu ajoutes une dimension (ex: MTD), inventorie les endroits qui switchent sur une dimension plus grossière (→ BUG-048).

7. **Compounding mensuel** : r/12 est OK pour <1 an et taux <2%, sinon `(1+r)^(1/12) - 1` (→ BUG-049). Le simulateur 20 ans est le cas le pire.

8. **Assurance intégrée vs externe** : pour un prêt, le champ `insuranceMonthly` peut être (a) ajouté à l'échéance (externe, APRIL) ou (b) déjà inclus dans l'échéance (intégrée, AL). Sans précision, la mensualité et l'amortissement divergent (→ BUG-050). Règle v297 : `insuranceMonthly` > 0 signifie "intégrée dans `monthlyPayment`, à soustraire pour obtenir le P&I".

**Commentaires inline** : toutes les fixes v297 portent un commentaire `BUG-XXX (v297): …` dans le code au-dessus de la ligne corrigée, décrivant la cause ET le symptôme. Pour un futur auditeur, `grep "BUG-04" js/` donne une vue complète des corrections.

### Fichiers modifiés

- `js/engine.js` :
  - L33-52 : hoisting `esppLotCostEUR` au niveau module + JSDoc (BUG-043)
  - L253-255 : commentaire pointant vers le hoisting (BUG-043)
  - L1836-1854 : `effectivePayment = monthlyPayment - insuranceMonthly` dans `computeSubLoanSchedule` (BUG-050)
  - L3729-3732 : `nezhaEsppCostBasisEUR` via `esppLotCostEUR` (BUG-043)
  - L3762 : `nezhaNW` inclut `nezhaVillejuifEquity` (BUG-044)
  - L3775 : `nwWithVillejuif` recalculée (BUG-044)
  - L3823 : `coupleNW = amineNW + nezhaNW` (BUG-044)
  - L3908-3923, L4062-4076 : Cash Dormant `wioCurrent` sans guard `>0` (BUG-047)
  - L3999 : `views.nezha.nwRef = nezhaNW` (BUG-044)
- `js/render.js` :
  - L761-767 : `cashCouple` dans `renderDynamicInsights` inclut brokerCash + cashUAE (BUG-045)
  - L782-787 : même fix pour le bloc risque (BUG-045)
- `js/charts.js` :
  - L2299-2318 : owner ratio appliqué à `depSeries` pour IBKR/Degiro/SGTM (BUG-046)
  - L2434-2444 : label de la ligne de référence switch sur `period` (BUG-048)
- `js/simulators.js` :
  - L57-61 : `monthlyReturnActions/Cash = Math.pow(1+r, 1/12) - 1` (BUG-049)
  - L679-681 : même fix pour le simulateur Nezha seul (BUG-049)
- `js/data.js` : `APP_VERSION = 'v297'`
- `js/app.js`, `js/charts.js`, `js/simulators.js` : imports `v=296` → `v=297`
- `index.html` : script tag `v=296` → `v=297`
- `BUG_TRACKER.md` : entrées BUG-043 à BUG-050
- `ARCHITECTURE.md` : cette section.

### Tests runtime (preview server, live FX)

- `coupleNW - amineNW - nezhaNW = 0` — OK
- `views.couple.stocks + cash + immo + other - nwRef ≈ 1.16e-10` (floating point) — OK
- `views.amine.sum - nwRef = 0` — OK
- `views.nezha.sum - nwRef ≈ 2.91e-11` — OK
- Live FX : coupleNW = 700 505€ (match avec l'affichage statique) — OK
- Chart owner-filter (Scope=Maroc, Owner=Nezha, Period=YTD) : +48.39% cohérent avec `depSeries × 0.5` — OK
- Chart label (Period=MTD) : "NAV début mois (€ 226 053)" — OK
- Simulateur 20 ans : croissance composée cohérente avec `(1+annual)^20` pour taux constant — OK
- AL amortissement : CRD(300) ≈ 0, cumul principal = 30 000€ — OK
- Action Logement avec `insuranceMonthly=0` (test régression) : amortissement identique à avant v297 — OK

---

### Refonte animation montagne v298 (BUG-051)

v298 corrige le feedback utilisateur sur l'animation de montée (screenshot : « ça avance lentement puis s'arrête à 532K puis boom avance encore plus vite à la position finale »).

#### Ancien design (v280 → v297) — pourquoi ça marchait mal

Deux phases séquentielles :
- **Phase 1** (18s, ease-out quad) : 0 → `STATIC_EUR × 0.80 = 532 776€`
- **Phase 2** (1.8s, ease-out cubic) : 532K → `realValue`

Défauts :
1. **Overshoot garanti** pour les vues où `realValue < 532K` (ex : Amine seul ≈ 412K). Le couple montait jusqu'à 532K puis redescendait — défie la métaphore d'ascension.
2. **Discontinuité** de vitesse entre les deux phases : Phase 1 décélère vers 532K (ease-out), Phase 2 ré-accélère immédiatement (nouveau cycle ease-out). Perception de « stop-and-go ».
3. `PHASE1_TARGET_EUR` figé dans le code → obsolescence à chaque évolution du NW.
4. Pas de robustesse à la latence : si l'API met 2s, on reste bloqué à ~10% pendant 16s supplémentaires avant le saut final.

#### Nouveau design v298 — state machine à 4 états

```
                    ┌─────────┐   data ready   ┌──────────┐
                    │ waiting │ ──────────────> │animating │
                    └────┬────┘                  └────┬─────┘
                         │                            │
           1.2s sans data│                            │ anim.duration
                         ▼                            ▼
                    ┌─────────┐   data ready     ┌──────┐
                    │ ambient │ ────────────────>│ done │
                    └────┬────┘                  └──────┘
                         │
                    5s timeout
                         │
                         ▼
                (fallback STATIC_EUR)
```

Principes :
- **Une seule animation finale** : `startFinalAnim(targetEur)` est le seul point d'entrée pour la montée "réelle".
- **Continuité** : `anim.startRatio = currentRatio` capture la position au moment du trigger → pas de saut depuis `waiting` (ratio 0) ou `ambient` (ratio ∈ [0, 0.08]).
- **Durée adaptative** : `duration = 1800 + distance × (2800 − 1800) = 1800..2800ms`. Petits déplacements courts, grands déplacements généreux.
- **Easing ease-in-out cubic** : démarre doux (pas de saccade à l'entrée), accélère au milieu (sensation de progression), décélère à l'arrivée (atterrissage doux).
- **Safety net** : le timeout 5s fallback sur `STATIC_EUR` assure qu'on voit toujours une animation, même en cas d'échec API.

#### Paramètres exposés (index.html L1434-1443)

| Constante | Valeur | Rôle |
|---|---|---|
| `AMBIENT_START_DELAY_MS` | 1200 | Délai avant d'activer la phase ambient si pas de data |
| `AMBIENT_TAU_MS` | 2800 | Constante de temps de l'asymptote `1 − e^(-t/τ)` |
| `AMBIENT_CAP_RATIO` | 0.08 | Plafond (8% du 1M€ = 80K€) — safe < tout NW réaliste |
| `ANIM_DURATION_MIN_MS` | 1800 | Durée min de l'animation finale |
| `ANIM_DURATION_MAX_MS` | 2800 | Durée max (à 100% de distance) |
| `DATA_TIMEOUT_MS` | 5000 | Fallback STATIC_EUR si aucune donnée |

#### Invariants & tests runtime

- **Monotonie** : le compteur est strictement non-décroissant (vérifié par `nonMonotonicSamples == 0` lors du test de sampling)
- **Parité finale** : `|currentRatio − realValue/TARGET| < 0.005` (log `Animation parity ok`)
- **Un seul `Final animation start`** dans les logs (plus de `Phase 1 done` / `Phase 2 start`)
- **Fallback vérifié** : avec auth désactivé (data non chargée), animation complète vers STATIC_EUR après 5s

#### Fichiers modifiés

- `index.html` :
  - L1389-1403 : en-tête docs mis à jour (v298 flow décrit)
  - L1406-1443 : constantes de config — suppression `PHASE1_*`/`PHASE2_*`, ajout `AMBIENT_*`/`ANIM_*`/`DATA_TIMEOUT_MS`
  - L1455-1467 : state machine (`phase: 'waiting' | 'ambient' | 'animating' | 'done'`)
  - L1623-1712 : easing helpers (`easeInOutCubic`, `easeOutAsymptote`) + renderLoop state-driven + `startAmbient()` + `startFinalAnim()`
  - L1755-1766 : `_gridAnimationComplete` délègue directement à `startFinalAnim`
  - L1833-1857 : boot avec setTimeouts pour ambient + fallback
  - L1152-1162 (`<style>`) : `@keyframes counterPulse` pour la phase waiting
- `js/data.js` : `APP_VERSION = 'v298'`
- `js/app.js`, `js/charts.js`, `js/simulators.js` : imports `v=297` → `v=298`
- `index.html` script tag : `v=297` → `v=298`
- `BUG_TRACKER.md` : BUG-051
- `ARCHITECTURE.md` : cette section

#### Commentaires inline

Chaque section (state, renderLoop branches, startAmbient, startFinalAnim, boot) porte des commentaires explicites en français décrivant le rôle de la phase, les cas de bord, et les garanties (continuité, safety). Pattern `grep "v298"` dans `index.html` donne une vue complète de la refonte.
- Aucune erreur console — OK

---

## §51 — v298 : Vérification graphique YTD Actions + fix faux positif P/L alignment

### Contexte

Audit demandé après mise à jour des soldes en v285 (Mashreq, Wio, Revolut, Attijari).

### Résultat de la vérification du graphique YTD

Le graphique YTD de l'onglet Actions est **entièrement fonctionnel**. Points vérifiés :

| Vérification | Résultat |
|---|---|
| Rendu sans erreur JS | ✅ 73 points Jan 2 → Avr 16, 2026 |
| Reconstruction des positions au 1er jan par reverse-trade | ✅ EDEN.PA 1100sh, DG.PA 200sh, QQQM 58sh, NXI.PA 2000sh, etc. |
| Achats mid-year (BN.PA, SAP.DE, IBIT+ETHA Jan-Fév) | ✅ entrés dans la simulation à leur date |
| Ventes mid-year (QQQM 24/02, EDEN 26/02, DG.PA 17/03+08/04) | ✅ sortis à leur date |
| Calcul P&L YTD | ✅ -28 115€ = ΔNav (-27 114) − dépôts après 1/1 (1 000) |
| Aucune erreur console | ✅ |

Les changements de soldes v285 (Mashreq, Wio, Revolut, Attijari) sont des comptes bancaires, pas des comptes broker — ils n'affectent pas le graphique YTD qui ne suit que IBKR + ESPP + SGTM.

### Correctif v298

**Faux positif `[engine] P/L alignment delta`** (pré-existant depuis v246) :

Le check de cohérence (`tableTotalPL` vs `combinedRealizedPL`) comparait la somme des P/L par trade avec `combinedRealizedPL` **après** ajout des dividendes et coûts (v246). Le delta de ~2 784€ était structurel (= dividendes IBKR + commissions + FTT + intérêts) et non un bug.

**Fix** (`engine.js` l.718) : sauvegarder `tradeOnlyRealizedPL = combinedRealizedPL` avant l'ajout v246, et utiliser ce snapshot dans le sanity check. Le delta est désormais ~0.

### Fichiers modifiés

- `js/engine.js` : `tradeOnlyRealizedPL` snapshot avant ajout dividendes/coûts + update sanity check
- `js/app.js`, `index.html`, `js/data.js` : imports `v=297` → `v=298`

### Tests runtime

- Graphique YTD : 73 points, scope=all, P&L = -28 115€ (-10.70%) — OK
- Aucun warning `P/L alignment delta` en console — OK
- Aucune erreur console — OK

---

## §52 — v301 : Variante slot-machine + sélecteur aléatoire (BUG-052)

v301 introduit une **deuxième variante** d'animation pour le gate (machine à sous casino) et un sélecteur aléatoire entre les deux.

### Objectifs
1. Offrir un moment de surprise à chaque chargement (deux looks très différents).
2. Garder v298 (mountain) intacte — le refactor ne casse rien.
3. Documenter un contrat explicite pour ajouter d'autres variantes à l'avenir.

### Architecture

```
(outer IIFE — isolation de scope)
  │
  ├─ AnimKit (namespace partagé)
  │     ├─ TARGET_EUR, TARGET_DATE, STATIC_EUR, DATA_TIMEOUT_MS
  │     ├─ formatEur, formatEurShort
  │     └─ renderVelocityLines (écrit le bloc ETA + pace)
  │
  ├─ window._mountainAnim = { init, trigger, hide }    (v298 refonte en module)
  ├─ window._slotAnim     = { init, trigger, hide }    (v301 NEW)
  │
  └─ Selector IIFE
        ├─ pickVariant() : URL override → random 50/50
        ├─ modOther.hide()
        ├─ modChosen.init()
        └─ window._gridAnimationComplete = (v, i) => modChosen.trigger(v, i)
```

Contrat commun à toutes les variantes :
- `init()` : démarre la phase « en attente » (spin pour slot, pulse + ambient pour mountain). Idempotent (hasInit guard).
- `trigger(realValueEUR, velocityInfo?)` : lance la transition vers la vraie valeur. Appelé par `_gridAnimationComplete` depuis app.js.
- `hide()` : cache le container DOM. Utilisé par le sélecteur pour la variante non-retenue.

### Design slot-machine

Reel physics
- 8 reels (digits 0-9, strip de 11 spans = 0..9+0 pour wrap sans trou visuel)
- Spin continu à `0.90 px/ms` (≈18 digits/sec, flou façon slot)
- Lock cascade gauche→droite avec `LOCK_STAGGER_MS=150` et `LOCK_DURATION_MS=750`
- Rotations adaptatives `EXTRA_ROT_MIN + idx * EXTRA_ROT_PER_IDX = 0.8..2.9` : reel gauche (lock en 1er) fait peu de tours pour minimiser le jerk ; reel droit (lock en dernier = reveal units digit) fait beaucoup de tours pour bâtir l'anticipation
- `easeOutQuart` pour la décélération
- `dt` clampé à 100ms pour éviter un snap après réveil d'onglet

Visual
- Cabinet dark-blue (`#162338 → #050913`) + bordure gold 2px + inset-shadows (plus de halo externe après audit)
- 3 LEDs gold wave-pulse (1.8s), figées au `done`
- Base-glow warm-white pendant spin, vert (`rgba(110,231,160)`) au `done` (liaison sémantique avec `#gridEta` pill vert)
- `.reveal-flash` class ajoutée brièvement au `done` : brightness 1.35 pendant 0.6s
- `.just-locked` class par reel à la fin de sa lock : inner-glow gold brief

Accessibilité
- `role="img"` + `aria-labelledby` sur le container
- `#slotSrLive` aria-live polite créé dynamiquement : annonce la valeur FINALE uniquement (pas le spin continu qui serait du bruit)
- `prefers-reduced-motion` : JS short-circuit, reels figés à `00 000 000` jusqu'à l'arrivée des données. CSS désactive LED/glow.
- Contraste gold `#fde68a` sur dark `#030711` ≈ 16.3:1 (WCAG AAA).

### Timeout fallback 5s → 12s

Pourquoi : le pipeline app.js (fetch FX + prix Yahoo + chart build) peut prendre 7-10s sur cold cache. Avec timeout 5s, le fallback `STATIC_EUR` se déclenchait avant l'arrivée des vraies données, et la slot n'avait aucun moyen de rattraper (cascade single-shot). À 12s, le fallback n'est plus qu'un "API vraiment mort" last resort.

Corollaire : `beginLockCascade` a maintenant un **mode re-lock** : si `phase === 'done'` ET la nouvelle cible diffère de l'affichage courant, les reels sont déverrouillés et une nouvelle cascade est lancée depuis leurs positions actuelles. Un log `[slot] Re-locking from stale ...` apparaît dans ce cas. Coût : une cascade supplémentaire de ~1.8s. Gain : on n'affiche jamais une valeur stale définitivement.

### URL override pour tests

`?anim=mountain` et `?anim=slot` forcent la variante. Utile pour screenshots, audit UX reproductible, debugging d'une variante particulière.

### Audit triple-parallèle avant commit

3 sub-agents Claude passés en parallèle :
1. **Physics** (timing, rotation formula, velocity jerk, edge cases values)
2. **Visual / UX** (cabinet aesthetics, digit spacing, LED count, aspect-ratio dead-space, reveal moment)
3. **Code quality** (rAF leak, reduced-motion, double-trigger, scope collision, aria-live, measurement race, color contrast)

13 findings appliqués avant deploy. Voir BUG_TRACKER.md BUG-052 pour la liste complète.

### Fichiers modifiés

- `index.html`
  - CSS `v299 — Casino slot-machine variant` : ~200 lignes (cabinet, lights, display, reels, strip, seps, base-glow, reveal-flash, reduced-motion guard)
  - HTML `<div id="slotContainer">` : 8 reels + séparateurs à bonne place pour le grouping `XX XXX XXX`
  - Mountain container : `display:none` par défaut (le sélecteur révèle la bonne variante)
  - Script bloc refactoré : outer IIFE + AnimKit + `_mountainAnim` en module + `_slotAnim` + sélecteur
- `js/data.js` : `APP_VERSION = 'v301'`
- `js/app.js`, `js/charts.js`, `js/simulators.js`, `index.html` script-tag : bump `?v=300 → ?v=301` partout (7+1 points d'import)
- `BUG_TRACKER.md` : entrée BUG-052 + ligne dans la matrice de couverture
- `ARCHITECTURE.md` : cette section

### Commentaires inline

Chaque bloc (CSS, HTML, JS modules, selector) porte des en-têtes explicites en français. Les décisions issues de l'audit sont marquées `v299 audit:` dans les commentaires pour retrouver rapidement les motivations (ex: `v299 audit: rotation formula INVERTED`, `v299 audit: removed outer-halo box-shadow layer`, `v299 audit: stop scheduling next frame once we're done`). Les tags v299 dans le code restent corrects — la fonctionnalité a été renommée v301 uniquement pour le tag de version à cause d'un conflit amont avec un autre v299. Pattern `grep "v299\| v301"` dans `index.html` donne une vue complète.

---

## §53 — v304 : BUG-055 fix 1Y first-point + Data Model Reference complète

### BUG-055 (v304) — Premier point du chart 1Y sous-estimait le P&L de ~€60K

Capture utilisateur : en mode 1Y P&L, le premier point (2025-04-08) affichait +€10 374. En 5Y à la même date, ~€70 000. Écart visible : saut soudain €10K → €65K à la 2e semaine (quand Degiro est "officiellement" clôturé le 14/04/2025).

**Cause racine** : dans `buildPortfolioYTDChart` (modes 1y/alltime), `chartValuesDegiro = chartLabels.map(() => 0)` force la NAV Degiro à 0 pour TOUTES les dates, y compris celles avant la clôture. Or à 2025-04-08, le compte avait encore ~€55 000 de valeur (€4K deposits nets + €50K P&L réalisé bankés en cash). La formule canonique `absPL = navTotal − absDeposits` donnait donc un P&L artificiellement bas pré-clôture, puis sautait brusquement de +€55K au 14/04 quand `absDepsDegiro` bascule en négatif suite au retrait de clôture.

Le chart 5Y/MAX (`buildEquityHistoryChart`) ne souffrait pas du bug car il splice `EQUITY_HISTORY` monthly qui contient la vraie NAV Degiro pré-clôture.

**Fix** : dans `buildPortfolioYTDChart` juste après `computeAbsoluteTooltipArrays`, reconstruire `chartValuesDegiro[i]` pour chaque `labels[i] < '2025-04-14'` :

```js
chartValuesDegiro[i] = absTooltip.absDepsDegiro[i] + degiroRealizedPL;
```

Cela donne `absPLDegiro = realizedPL` constant pré-clôture — aligné avec le `plValuesDegiro` flat déjà utilisé ailleurs. Post-clôture, `chartValuesDegiro = 0` (inchangé) et la formule `nav − deps` donne naturellement `+realizedPL` via `absDeps` négatif.

Après ajustement : recalcul de `chartValuesTotal` et des champs `absPLDegiro`/`absPLTotal` dans `absTooltip` → tous les consommateurs (plValues unifiés, tooltip, header) voient les valeurs corrigées.

**Vérification runtime v304** :

| Mode | plTotal[0] (first) | plTotal[last] | Source |
|---|---|---|---|
| YTD (Jan 2) | +€73 068 | +€53 094 | démarre post-clôture Degiro, OK pré-fix |
| 1Y (2025-04-08) | +€65 188 (v304) | +€53 497 | était +€10 374 avant fix |
| alltime | +€65 188 (v304) | +€53 497 | identique à 1Y ✓ |

Les invariants v303 (I1/I2/I3) continuent de passer dans les 3 modes.

### §11 — Data Model Reference (v304 — modèle de mise à jour compréhensible)

Cette section décrit **toutes les sources de données manuelles** du dashboard. L'objectif : permettre à Amine (ou un futur dev, ou un agent IA) de mettre à jour les données sans casser les invariants.

#### Principe central

```
js/data.js  →  js/engine.js  →  js/render.js  →  DOM
  (faits)       (calculs)        (affichage)
```

- **data.js** contient UNIQUEMENT des faits bruts (soldes, positions, trades, dates, contributions ESPP exactes).
- Aucune valeur calculée n'est stockée dans data.js (pas de P&L, pas de NAV totale, pas de %).
- L'engine dérive TOUT (NAV, P&L, taxes, treemap, prévisions) à partir des faits.
- Modifier data.js → recharger la page → tous les affichages s'adaptent automatiquement.

#### Matrice des objets de données

| Clé `data.js` | Contenu | Cadence | Impact |
|---|---|---|---|
| `PORTFOLIO.amine.ibkr.positions` | Array de positions IBKR courantes (ticker, shares) | À chaque achat/vente | NW stocks, treemap, chart |
| `PORTFOLIO.amine.ibkr.trades` | Historique complet des ordres (achat/vente/FX) | À chaque trade | chart breakdown, P&L réalisé, FX P/L |
| `PORTFOLIO.amine.ibkr.deposits` | Versements sur le compte IBKR (date, montant, devise, fxRate) | À chaque virement | cumDeposits chart, P&L calculation |
| `PORTFOLIO.amine.espp` | Lots ESPP Microsoft/Accenture (shares, costBasis, contribEUR, fxRate) | +1 lot/an (avril, novembre) | NW stocks, P&L, per-owner ESPP chart |
| `PORTFOLIO.amine.degiro` | Historique compte Degiro (clos) : `annualSummary`, `dividends`, `fxCosts`, `flatexCashFlows`, `totalRealizedPL`, `totalPLAllComponents` | Figé (compte clôturé) | P&L historique, 5Y chart |
| `PORTFOLIO.amine.sgtm` | Actions SGTM Maroc (shares, MAD pricing) | Quand IPO/cours MAD bouge | NW Maroc, treemap |
| `PORTFOLIO.amine.uae` | Soldes Mashreq/Wio Savings/Current/Business (AED) | Mensuelle | cash view, NW cash |
| `PORTFOLIO.amine.eur` | Soldes Revolut (EUR) | Mensuelle | cash view |
| `PORTFOLIO.amine.morocco` | Solde Attijari (MAD) | Mensuelle | cash view |
| `PORTFOLIO.amine.vehicles` | Cayenne + Mercedes (valeurs) | Annuelle (dépréciation) | NW other |
| `PORTFOLIO.amine.creances.items` | Prêts émis (SAP, Malt, Sanae, etc.) | À chaque émission/remboursement | créances view, NW (si status≠recouvré) |
| `PORTFOLIO.amine.creances.dettes` | Obligations (TVA à payer, etc.) | À chaque déclaration | créances view |
| `PORTFOLIO.amine.facturation` | Fallback statique pour Augustin/Benoit | Sync via localStorage bridge `lallakenza/facturation`, fallback manuel | `amineFacturationNet` → NW Amine |
| `PORTFOLIO.amine.tva` | TVA à payer (négatif) | Annuelle (déclaration) | NW Amine |
| `PORTFOLIO.nezha.*` | Mêmes sous-clés pour Nezha (IBKR copart, ESPP, villejuif, rueil, créances, etc.) | Idem Amine | views.nezha |
| `DIV_CALENDAR` | Calendrier dividendes prévisionnels + flag `confirmed` (v303+) | Trimestrielle à l'annonce AGM | tableau WHT, projections |
| `DIV_YIELDS` | Yields statiques pour ETF/fonds sans dividendes tracés | Rare (IPO crypto ETF) | dividendes projection |
| `WHT_RATES` | Taux retenue à la source par juridiction | Rarement (réforme fiscale) | projections WHT |
| `EQUITY_HISTORY` | Snapshots NAV mensuels (degiro, espp, ibkr, total) | Mensuelle (30 ou 31 du mois) | 5Y/MAX chart, spliced YTD |
| `NW_HISTORY` | Snapshots NW globaux (optionnel) | Mensuelle (si utilisé) | historical NW chart |
| `IMMO_CONSTANTS` | Biens immobiliers (valeurs, charges, prêts, taux) | À chaque modif crédit / travaux | immo view, budget, NW |
| `VITRY_CONSTRAINTS`, `VILLEJUIF_REGIMES` | Règles fiscales par location | À chaque réforme locale | immo calculator |
| `EXIT_COSTS` | Coûts de sortie (frais notaire/agence) | Rarement | immo exit simulator |
| `IBKR_CONFIG` | Paramètres IBKR (commissions, FTT, interest rate margin) | Rarement | P&L calculations |
| `CASH_YIELDS` | Taux d'intérêt des comptes bancaires | Semi-annuelle | cash view, budget |
| `INFLATION_RATE` | Taux d'inflation pour dépréciation | Annuelle | simulators |
| `BUDGET_EXPENSES` | Dépenses mensuelles fixes (abonnements, loyer Dubaï) | À chaque modif | budget view |
| `FX_STATIC` | Taux FX de fallback si Yahoo API down | Mensuelle (sync ECB) | toEUR conversion si API fail |
| `DEGIRO_STATIC_PRICES` | Prix de clôture Degiro (compte clos) | Figé | chart 5Y/MAX |
| `PRICE_SNAPSHOT` (price_snapshot.js) | Prix statiques des positions courantes, fallback API | Mensuelle | fallback display |

#### Schémas détaillés par objet

##### Position stock (`PORTFOLIO.amine.ibkr.positions[i]`)
```js
{
  ticker: 'AIR.PA',         // Yahoo ticker (suffixes: .PA=Paris, .DE=Frankfurt, .T=Tokyo)
  shares: 200,              // Integer, aucune fraction (rachetées en cash)
  currency: 'EUR',          // EUR | USD | JPY | GBP
  geo: 'france',            // france | usa | germany | japan | etherland — détermine WHT rate
  label: 'Airbus (AIR)',    // UI display
}
```
**Règle** : la valeur EUR est calculée dynamiquement via prix Yahoo × shares ÷ fxRate. N'AJOUTE JAMAIS `valEUR` ou `currentPrice` dans la position — ça serait stale.

##### Trade (`PORTFOLIO.amine.ibkr.trades[i]`)
```js
{
  date: '2026-03-15',       // YYYY-MM-DD
  type: 'buy',              // buy | sell | fx
  ticker: 'AIR.PA',
  shares: 50,
  priceLocal: 170.50,       // prix d'exécution en devise native
  commissionEUR: 2,         // commission IBKR convertie EUR (fixe, pas un %)
  fttEUR: 0.68,             // Financial Transaction Tax (0.4% FR, 0.0% autres, computed à l'exécution)
  currency: 'EUR',          // devise de priceLocal
  // Pour trades non-EUR :
  fxRate: 1.1464,           // Taux EURUSD (ou EURJPY, etc.) à la date d'exécution (pour FX P/L)
}
```
**Pièges** :
- `commissionEUR` est déjà en EUR (pas à reconvertir). Un trade USD avec commission $1 à fxRate 1.15 donne `commissionEUR: 0.87`.
- `fttEUR` FR = 0.4% × priceLocal × shares (v190+). DE/US = 0.
- `fxRate` obligatoire pour tous les trades non-EUR (utilisé dans engine.js pour `fxPL` separation — BUG-037).

##### Lot ESPP Amine (`PORTFOLIO.amine.espp.lots[i]`)
```js
// Cas normal : contribution salariale connue (EUR prélevé sur salaire)
{ date: '2023-05-01', source: 'ESPP', shares: 17, costBasis: 236.88, contribEUR: 3845.99 }

// Cas FRAC (dividendes réinvestis) : PAS un dépôt, cost basis 0
{ date: '2022-08-15', source: 'FRAC', shares: 3, costBasis: 272.36, contribEUR: 0 }
```
**Règles** :
- `contribEUR` = montant exact prélevé sur salaire → utilisé pour P&L calcul.
- `contribEUR: 0` signifie "zéro explicite" (pas de contribution — dividende réinvesti). Utilisé par `_esppLotDeposit` helper (BUG-053 v302).
- `contribEUR: undefined` (Nezha) → fallback `shares × costBasis / fxRate`.
- `source: 'FRAC'` skippe systématiquement dans les séries de dépôts.
- `totalCostBasisUSD` en regard de `lots` = `Σ (shares × costBasis)` — invariant à maintenir.

##### Dividende prévisionnel (`DIV_CALENDAR['TICKER']`)
```js
// Dividende confirmé (AGM voté / press release publié)
'AIR.PA': {
  dps: 2.00,
  exDates: ['2026-04-22'],
  frequency: 'annual',
  confirmed: true,
  source: 'Airbus AGM 15 avril 2026',
}

// Dividende projeté (extrapolation de l'an passé, pas encore annoncé officiellement)
'XXX.PA': {
  dps: 1.80,
  exDates: ['2026-05-15'],
  frequency: 'annual',
  // `confirmed` omis → projeté par défaut (badge gris "⏳ projeté")
}

// Semi-annuel avec statut per-date (solde confirmé, acompte projeté)
'MC.PA': {
  dps: 13.00,
  exDates: [
    { date: '2026-04-28', confirmed: true, dps: 7.50 },
    { date: '2026-12-10', confirmed: false, dps: 5.50 },
  ],
  frequency: 'semi-annual',
}
```
**Cadence MAJ** : dès qu'une AGM a voté (fin avril pour CAC40 typiquement) → passer `confirmed: false → true` + remplir `source`.

##### EQUITY_HISTORY (1 entry/mois)
```js
{
  date: '2026-03-31',   // dernier jour du mois
  degiro: 0,            // NAV Degiro EUR (0 après clôture Apr 2025)
  espp: 36250,
  ibkr: 195063,
  total: 231313,        // doit == degiro + espp + ibkr (invariant, audit en v288)
}
```
**Cadence** : 1er ou 2 du mois suivant, copier les NAV de fin de mois depuis Degiro/IBKR/UBS.

##### Créance (`PORTFOLIO.amine.creances.items[i]`)
```js
{
  id: 'INVSNT005',                   // identifiant unique
  counterparty: 'Malt',              // nom du débiteur
  amount: 3500,                      // montant en devise native
  currency: 'EUR',                   // EUR | USD | MAD
  status: 'en_cours',                // en_cours | recouvré | perdu
  dueDate: '2026-05-15',
  probability: 0.9,                  // 0.0-1.0 — utilisée pour pondération KPI
  type: 'pro',                       // pro | personal — route vers amineRecvPro ou Personal
  note: 'Facture F-2026-042',        // contexte (optionnel)
}
```
**Règle NW** : seules les créances avec `status !== 'recouvré'` rentrent dans le NW (les recouvrées sont déjà dans cash, BUG-015).

##### Solde bancaire (`PORTFOLIO.amine.uae.mashreq`, etc.)
```js
{ balance: 484000, currency: 'AED' }
// OU format scalar (legacy) :
// balance: 484000   // si structure déjà typée
```
Conversion EUR via `toEUR(balance, currency, fx)` dans engine.

##### Immo (`IMMO_CONSTANTS.properties[ID]`)
```js
'vitry': {
  purchasePrice: 280000,
  currentValue: 300000,
  purchaseDate: '2019-12-15',
  loan: {
    initialAmount: 240000,
    monthlyPayment: 1050,
    insuranceMonthly: 30,              // INTÉGRÉE (soustraire du P&I avant amortissement, BUG-050)
    rate: 0.0150,
    startDate: '2020-02-01',
    duration: 20,                      // années
  },
  rent: { monthly: 1050, parking: 70, charges: 80 },
  location: { city: 'Vitry-sur-Seine', ... },
  ownership: { amine: 1.0, nezha: 0 }, // split pour views per-owner
}
```
**Invariant** : `loan.insuranceMonthly > 0` signifie "incluse dans monthlyPayment" ; `= 0` signifie "payée séparément".

#### Workflow type : mettre à jour les soldes bancaires en fin de mois

1. Ouvrir `js/data.js`
2. Scroll jusqu'à `PORTFOLIO.amine.uae` (~L49) — modifier `mashreq.balance`, `wioSavings.balance`, etc.
3. `PORTFOLIO.amine.eur.revolut.balance` (~L67)
4. `PORTFOLIO.amine.morocco.attijari.balance` (~L70)
5. Mettre à jour `DATA_LAST_UPDATE = 'DD/MM/YYYY'` (~L1142)
6. Bumper `APP_VERSION = 'vN+1'` (~L1143)
7. Ajouter 1 ligne dans `EQUITY_HISTORY` si c'est le 1er/2 du mois suivant
8. Bumper `?v=N → ?v=N+1` partout (cf. "Deployment checklist" dans CLAUDE.md)
9. `git commit -m "vN+1: update bank balances end-of-month"` + push
10. Vérifier en production après ~60s : badge version dans footer doit afficher `vN+1`

#### Workflow type : confirmer un dividende après AGM

1. L'entreprise publie son press release / tient son AGM → dividende voté
2. Ouvrir `js/data.js`, scroll jusqu'à `DIV_CALENDAR` (~L2356)
3. Sur la ligne du ticker, ajouter `confirmed: true, source: 'COMPANY AGM DD month YYYY'`
4. Si le `dps` diffère de la projection, mettre à jour
5. Bump version (`APP_VERSION`, cache-bust `?v=N`)
6. Vérifier : le badge du ticker passe de "⏳ projeté" (gris) à "✓ confirmé" (vert) avec tooltip source

#### Workflow type : ajouter un trade IBKR

1. Exécuter le trade chez IBKR → récupérer le statement CSV
2. Ouvrir `js/data.js`, `PORTFOLIO.amine.ibkr.trades` (array)
3. Ajouter l'entrée avec toutes les clés obligatoires (`date`, `type`, `ticker`, `shares`, `priceLocal`, `currency`, `commissionEUR`, `fttEUR`, `fxRate` si non-EUR)
4. Si c'est un BUY d'un nouveau ticker : ajouter une entrée dans `PORTFOLIO.amine.ibkr.positions` OU incrémenter `shares` existantes
5. Si c'est un SELL et que `shares` tombe à 0 : supprimer la position
6. Ajouter une entrée dans `DIV_CALENDAR` si le ticker verse des dividendes
7. Bump version + deploy
8. Vérifier : chart breakdown doit montrer la trade, P&L Réalisé/Non Réalisé doit être cohérent

#### Workflow type : émettre ou recouvrer une créance

1. Ouvrir `js/data.js`, `PORTFOLIO.amine.creances.items` (~L900+)
2. **Émission** : `{ id, counterparty, amount, currency, status: 'en_cours', dueDate, probability, type }`. Le `id` est local ; préférer `INVSNTnnn`.
3. **Remboursement** : passer `status: 'recouvré'` + ajouter `receivedDate` + retirer du NW automatiquement (engine exclut les recouvrés)
4. Bump version + deploy
5. Vérifier créances view : la ligne apparaît dans "Créances recouvrées" (tableau séparé)

#### Anti-patterns connus

| Anti-pattern | Pourquoi c'est faux | Correction |
|---|---|---|
| Hardcoder une NAV dans data.js | Stale à chaque changement de prix | Calculer dynamiquement dans engine |
| Valeur EUR pour un compte AED | Biaise le calcul multi-devises | Garder AED natif, laisser toEUR convertir |
| Dupliquer `esppLotCostEUR` | Diverge entre engine et charts (BUG-043) | Importer depuis engine.js |
| `if (lot.contribEUR)` (truthy check) | Confond `0` et `undefined` (BUG-053) | Utiliser `!= null` |
| Oublier `fttEUR` sur trade FR | Sous-estime le coût réel | Toujours inclure (même si 0) |
| Oublier `fxRate` sur trade USD/JPY | Perd la décomposition FX P&L (BUG-037) | Taux ECB à la date |
| Modifier `EQUITY_HISTORY` rétroactivement | Casse l'invariant de monotonicité | Ajouter seulement de nouvelles lignes en bout |
| `confirmed: true` sans `source` | Perd la traçabilité | Toujours documenter la source |
| Lire `prop.cashFlow.netMonthly` (inexistant) | Loyers muets (BUG-056, BUG-057) | Utiliser `prop.cf` (mensuel net), `prop.loyerDeclareAnnuel`, `prop.loanInterestAnnuel` |
| Filtre `pos.platform === 'IBKR'` | Le champ n'existe pas — filtre exclut tout (BUG-058) | `state.actionsView.ibkrPositions` est déjà IBKR uniquement |
| Appliquer IR France en taux flat | Sur-estime 30-45% si > 28K€ (BUG-059) | Barème progressif 20%/30% par tranches marginales |

---

## §54 — v305 : KPI "Patrimoine Financier Mobilisable" (17 avril 2026)

**Objectif** : répondre aux questionnaires de solvabilité (banques, notaires, compagnies aériennes premium) qui demandent systématiquement "quel est votre patrimoine financier mobilisable ?". Synonyme : cash + liquide rapidement sans décote majeure.

**Définition utilisée** (engine.js `compute()`) :
```
financialMobilisable = IBKR (stocks+cash) + ESPP + SGTM + cash bancaire (UAE+EUR+Morocco)
```
Exclut explicitement : immobilier (illiquide), véhicules, créances (probabilité), facturation en cours (pas encaissé).

**Vues** : exposé sur les 3 axes (`state.couple`, `state.amine`, `state.nezha`).

**Rendu** : card KPI "Patrimoine mobilisable" dans la vue Couple + section insight avec breakdown Amine/Nezha.

**Lecture en aval** : consommé par le module Financement immobilier (v306+) pour pré-remplir le champ patrimoine, et par `computeObjectifs` (v312) pour le basis `mobilisable-amine`.

---

## §55 — v306 : Module "Financement immobilier — Comparateur de scénarios" (17 avril 2026)

**Objectif** : décider entre 4 façons de financer un achat immo (cash, prêt banque, margin IBKR, double leverage) pour un couple MRE avec patrimoine financier solide.

**Scénarios** :
| Scénario | Description | Sortie initiale | Dette générée |
|---|---|---|---|
| **A** Cash intégral | Paye tout cash + frais | prix + 6.7% frais | 0 |
| **B** Prêt banque | Apport 20% + frais + hypothèque + dossier | apport + ~7% frais totaux | principal = 80% × prix amorti sur 25 ans |
| **C** Cash + margin IBKR | Paye cash, collatéralise le portefeuille restant | A_sortie | `portefeuilleRestant × LTV_target` (non-amortie, intérêts seuls) |
| **D** Prêt + margin (double) | Combine B et C | apport B | principal B + margin D |

**Formules pures** (engine.js §"REAL ESTATE FINANCING MATH") :
- `mensualiteAmortissement(P, r, n)` — annuité constante
- `valeurFuture(capital, apport, r, n)` — VF intérêts composés mensuels
- `fraisHypothequeMaroc(principal)` — barème ANCFCC progressif
- `crdAfterMonths(P, r, n, k)` — CRD restant après k mois

**Inputs** (render.js `renderImmoFinancingView`) lus depuis 15 champs DOM + presets optionnels (Maroc/UAE). La `fxEURMAD` pilote la conversion des épargnes EUR → MAD.

**Outputs** :
- `scenarios.{A,B,C,D}.patrimoineFinal` pour horizons 10/15/25 ans
- `.liquidite` pour T+12/24/36 mois (pour projet Casa)
- `.cashProjection` (pas de 3 mois, v307)
- `.recommendation.best` selon règle : Casa tendu < 24m → B, sinon → C

**Invariant** : patrimoineFinal[i] n'inclut PAS le prix de l'appart (c'est une donation aux parents, pas un actif Amine). On compare "quelle richesse financière reste-t-il" en fin d'horizon.

**Hypothèses explicites** : rendement 6 %, margin 3.1 % EUR / 4.8 % USD / 1.5 % JPY (MARGIN_RATES data.js, à actualiser semestriellement), assurance DI 0.35 %, coeff CRD moyen 0.55 (v314 A7).

---

## §56 — v307 : Auto-feed patrimoine + presets + timeline cash (17 avril 2026)

**3 améliorations du module v306** :

1. **Auto-feed** : au premier render, le champ patrimoine se remplit automatiquement depuis `state.amine.financialMobilisable` × fxEURMAD. Flag `_immoFinPatrimoineAutoFed` évite l'écrasement si l'utilisateur a déjà tapé une valeur.

2. **Presets** : `IMMO_PRESETS` dans data.js (Marrakech 2.5 M MAD, Casa 2 M MAD, UAE 800 K USD) avec conversion devise native → MAD automatique. v313 (A6) : chaque preset porte explicitement son `apportRatio` (20 % Maroc, 50 % UAE expat) au lieu d'une règle hardcodée.

3. **cashProjection** : pour chaque scénario, série `{month, cash}` tous les 3 mois sur l'horizon max. Cash = `portefeuilleProjeté × (1 + LTV_target)` = capacité totale (collatéralisable). Consommée par `buildImmoFinCashProjectionChart` pour répondre "à partir de quel mois puis-je faire un 2e projet de X MAD ?".

---

## §57 — v308 : Cash-flow consolidé + Alertes proactives + Fix Amine-only (17 avril 2026)

**Cash-flow consolidé** (engine.js `computeCashFlow`) :
- Agrège : `MONTHLY_INCOMES` (Bairok 85K AED/mois) + loyers nets (`prop.cf`, v313 BUG-056) + dividendes projetés / 12
- Dépenses : `BUDGET_EXPENSES` (fixes, SaaS, utilities)
- KPIs : `incomeMonthly`, `expensesMonthly`, `netSavings`, `savingsRate`, `emergencyFundRatio` (dormant/expenses), `runwayMonths` (liquid/expenses)
- Consommé par Budget view (strip KPI) + `computeAlerts` (règles #3, #4)

**Alertes proactives** (engine.js `computeAlerts`) — 5 règles :
1. **Red** — Créances en retard (dueDate < today, status ≠ recouvré) ; v314 (A8) warn console si dueDate absente
2. **Yellow** — Ex-dividende ≤ 15 j + WHT > 30 € + recommendation='switch'
3. **Green** — Cash dormant > 12 mois de dépenses (opportunité yield 5 %)
4. **Red** — Emergency fund < 3 mois
5. **Green** — Position IBKR +30 % et > 5 K€ (rebalancing) ; v313 (BUG-058) 3 champs corrigés

**Fix Amine-only** : le module Financement est purement Amine (pas Nezha). `syncPatrimoineFromState` lit `state.amine.financialMobilisable` au lieu de `state.couple.*`.

---

## §58 — v310 : Multi-projets pipeline + chart modes absolu/zoom/delta

**Multi-projets** : jusqu'à 3 projets configurables (`besoinCasa` par défaut + Proj2 + Proj3). Chaque projet : label, amountMAD, monthsTarget. `projetsCompat[scenario][projet]` = `{liquideAtTarget, feasible, tight, ratio}` avec seuils 95 % (feasible) et 75 % (tight).

**Chart modes** (v310) — 3 modes d'affichage du chart Patrimoine :
- **absolu** — échelle 0-max, différences absolues
- **zoom** — échelle ajustée au range min-max (pour discriminer scénarios proches)
- **delta** — différence vs scénario le plus bas (lisible quand les 4 convergent)

Toggle géré par `_immoFinChartMode` (module-level state). v314 (A5) : sync visuel des boutons au premier rendu (avant, état neutre tant qu'on cliquait pas).

Plugin `afterDatasetsDraw` ajoute les labels "MDH (X %)" sur les barres stress-test.

---

## §59 — v311 : Fiscalité MRE consolidée (17 avril 2026)

Module `computeFiscaliteMRE` (engine.js §"PLAN LONG-TERME + FISCALITÉ MRE") expose 4 blocs :

1. **IR Loyer Vitry** (v313 BUG-057 + BUG-059 corrigés) :
   - Lit `vitry.loyerDeclareAnnuel`, `deductibleChargesAnnuel`, `loanInterestAnnuel`
   - Régime micro-foncier si loyer < 15 K€ (abattement 30 %), sinon réel (charges + intérêts)
   - IR en **barème progressif** 20 % < 28 797 € marginal, 30 % au-delà
   - PS 17.2 % (UAE hors EEE, pas d'exonération)
   - Expose `tauxIR` effectif (= IR/revenuImposable) pour affichage

2. **PV immo Vitry** (si vente aujourd'hui) :
   - Abattement IR : 6 %/an de 6→21 ans, 4 % à 22 ans, exo à 22 ans
   - Abattement PS : 1.65 %/an de 6→21 ans, 1.6 % à 22 ans, 9 %/an de 23→30 ans
   - IR taux fixe 19 % + PS 17.2 % après abattements
   - `propertyMeta.purchaseDate` (v313) pour éviter fallback hardcodé

3. **Calendrier déclaratif** : FR 2042+2044 (mai-juin), MA si rapatriement, UAE license Bairok, TRC annuel

4. **Coût rapatriement** : 0.5 % spread Wise/Revolut + 10 € wire (à nuancer pour > 250 K€)

---

## §60 — v312 : Plan long-terme + Sensibilité (17 avril 2026)

**`computeObjectifs`** — liste des objectifs avec statut dynamique :
- Basis : `couple-NW`, `amine-NW`, `mobilisable-amine`, `custom`
- Formule : `projected = current × (1+r)^n + savings × ((1+r)^n−1)/r`
- Status : on-track (≥1.0), at-risk (≥0.85), behind (<0.85)
- `requiredAdditionalMonthly` = épargne supplémentaire nécessaire si en retard

**`computeSensibilite`** — matrice 3 × 3 :
- Rows : rendement {4 %, 6 %, 8 %}
- Cols : savings {6 400, 8 000, 9 600 €/mois}
- Cells : projected, ratio/target, delta

**4 objectifs par défaut** (DEFAULT_OBJECTIFS) : 1 M€ couple 2028, appart parents 250 K€ 2027, studio Casa 400 K€ 2029, retraite 3 M€ 2055.

---

## §61 — v313 : Audit v305-v312 — 4 bugs critiques (18 avril 2026)

**Fixes déployés** — voir BUG_TRACKER.md BUG-056 à BUG-059 :
- **BUG-056** — `computeCashFlow` lisait `prop.cashFlow.netMonthly` (inexistant) → loyers muets. Fix `prop.cf`.
- **BUG-057** — `computeFiscaliteMRE` lisait `vitry.cashFlow.loyerMensuel/...` → table IR vide. Fix champs réels.
- **BUG-058** — `computeAlerts` règle P&L IBKR : 3 noms de champs incorrects → alerte muette. Fix `ibkrPositions` + drop `platform` + `costEUR_hist`.
- **BUG-059** — IR France calculé en **flat** 30 % au-dessus 28 K€ → sur-estimation 30-45 %. Fix barème **marginal** 20 %/30 %.

**Évolution A6** : `IMMO_PRESETS[i].apportRatio` explicite (data-driven) au lieu de hardcodé `preset.country === 'AE' ? 0.50 : 0.20` dans render.

---

## §62 — v314 : Qualité — visual sync + coeff CRD moyen + warn créances + docs (18 avril 2026)

**3 quality fixes** (suite audit) :
- **A5** — `renderImmoFinancingView` re-synchronise visuellement les boutons chart mode au premier rendu (avant : tous neutres tant qu'on n'avait pas cliqué).
- **A7** — Coeff CRD moyen 0.5 → **0.55** sur calcul assurance DI (prêt à annuité constante, CRD moyen temporel ≈ 0.55 × principal pour taux 3-6% / 20-25 ans, pas 0.5 qui suppose un amortissement linéaire).
- **A8** — Créance sans `dueDate` : warn console `[alerts]` pour que le propriétaire aille compléter data.js (avant : silencieux → échappait à la règle "en retard").

**Documentation** :
- ARCHITECTURE.md §54-§62 ajoutées (v305 → v314 complet)
- CLAUDE.md Data Update Cheatsheet enrichi (MONTHLY_INCOMES, MARGIN_RATES, IMMO_PRESETS, IMMO_MAROC_FEES)
- Anti-patterns ajoutés : `prop.cashFlow.*`, `pos.platform` filter, IR flat

---

## §63 — v315 : Robustesse — auto-feed épargne + multi-projets + coeff sécurité + €STR actualisé (18 avril 2026)

**4 upgrades de robustesse** suite à l'audit A1/A2/A3/A9 :

### A1 — Auto-feed épargne depuis cash-flow consolidé
**Avant** : champ "Épargne mensuelle" de Financement Immo saisi à la main (7 000 € hardcodés au montage du DOM). Incohérence possible avec `computeCashFlow(state).netSavings` calculé ailleurs.

**Après** : au **premier rendu** de `renderImmoFinancingView`, le champ est auto-alimenté depuis `computeCashFlow(state, state.portfolio, fx).netSavings` (arrondi, plancher 0).
- Fonction `syncEpargneFromCashFlow(state)` dans render.js (~6524).
- Guard `_immoFinEpargneAutoFed` (module-level) : **une seule fois** par session, pour ne pas écraser une saisie manuelle volontaire.
- Affichage sous l'input : breakdown "Source : revenus nets − charges (X k€/mois − Y k€/mois)".

### A2 — Reco multi-projets courts
**Avant** : `computeImmoFinancing` ne regardait que `besoinCasa` + `horizonCasa` pour déclencher le scénario B (conservation liquidité). Les inputs `proj2Amount/Month` et `proj3Amount/Month` saisis dans l'UI étaient ignorés dans la reco.

**Après** : construction d'une liste `projetsTendus = [...]` en filtrant tous les projets ≤ 24 mois (Casa + Proj2 + Proj3). Si **au moins un** projet tendu existe :
- Reco → scénario **B** (100 % épargne, préservation liquidité)
- Justification listée dans `reasons[]` avec cumul (ex : "2 projets tendus ≤ 24 mois (0.8 MDH cumulés) → préserver la liquidité").
- `hTendu` prend le **projet le plus proche** (Casa si présent, sinon le premier défini).

### A3 — Coeff sécurité collatéral 0.75
**Avant** : `liquiditeAtMonth(months, scenario) = VF(months) × (1 + ltvTarget)` supposait qu'on pouvait tirer 100 % de la capacité margin IBKR en cash pour un projet. Irréaliste — IBKR applique un haircut variable selon la volatilité du collateral, et un margin call peut forcer une liquidation forcée en bas de cycle.

**Après** :
```js
const SAFETY_COEFF = 0.75;  // buffer 25 % pour haircut + margin call
const liquiditeMult = 1 + ltvTarget * SAFETY_COEFF;
const liquiditeAtMonth = (months, scenario) => VF(months) * liquiditeMult;
```
- À LTV 0.30 : `1 + 0.30 × 0.75 = 1.225` (contre 1.30 auparavant) → −5.75 % de capacité projet affichée.
- Reflète le comportement réel : on ne doit JAMAIS utiliser le dernier euro de capacité margin, sous peine de forced liquidation si marchés baissent de 10-15 %.
- Rend le comparateur plus conservateur (prudence en tête, pas en bas).

### A9 — MARGIN_RATES.EUR 3.1 % → 4.3 %
**Avant** : `MARGIN_RATES.EUR = 0.031` (supposait €STR ~1.6 % niveau 2024 + spread 1.5 %).

**Après** : `MARGIN_RATES.EUR = 0.043` (€STR ~3.0 % en 2025-2026 + spread 1.3 %).
- Impacte le calcul du coût margin dans le scénario D (100 % margin) et la simulation hybride scénario C.
- Note data.js : "À vérifier semestriellement contre la courbe €STR BCE".
- Idéalement : fetch temps réel via API ECB — mais hors scope static GitHub Pages (nécessiterait proxy CORS).

**Bump cache** : `?v=314` → `?v=315` sur 13 imports (app.js×7, charts.js×4, simulators.js×2, index.html×1) + `APP_VERSION` dans data.js.

**Tests non-régression** :
- [ ] Au montage du module Financement Immo : "Épargne mensuelle" pré-rempli depuis cash-flow (pas 7 000 hardcodé)
- [ ] Input sous le champ affiche "Source : revenus nets − charges (X k€ − Y k€)"
- [ ] Modifier manuellement le champ ne le fait pas regénérer automatiquement au refresh (sticky après override)
- [ ] Avec Casa 500 K MAD à T+12 → reco B avec raison "Casa à T+12 mois"
- [ ] Avec Casa + Proj2 300 K à T+18 → reco B avec raison "2 projets tendus ≤ 24 mois (0.8 MDH cumulés)"
- [ ] Avec seulement Proj2 à T+36 (> 24) → reco retombe sur A (100 % margin)
- [ ] Capacité projet scénario A LTV 0.30 : affichée ≈ NAV × 1.225 (pas × 1.30)
- [ ] Coût margin scénario D affiche taux EUR 4.3 % (pas 3.1 %)

