# Architecture — Dashboard Patrimonial

> Dernière mise à jour : 21 mars 2026 (v193)
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
       ├─ js/charts.js   ← Chart.js (évolution NAV, allocations, CF projection)
       └─ js/api.js      ← Yahoo Finance API (FX live, prix actions, historique)
```

### Principes architecturaux

- **Séparation stricte** : `data` → `engine` → `render`. Aucun module ne remonte la chaîne.
- **Zéro valeur hardcodée** : Tous les coûts (commissions, FTT, intérêts, dividendes) sont calculés dynamiquement depuis les données brutes dans `data.js`.
- **Multi-devises natif** : Chaque montant est stocké dans sa devise native (EUR, USD, JPY, AED, MAD). La conversion en EUR se fait dans `engine.js` via `toEUR()`.
- **Cache-busting** : Chaque import utilise `?v=N` pour forcer le navigateur à charger la dernière version après un déploiement.
- **Fallback statique** : Si l'API Yahoo est indisponible, les prix statiques dans `data.js` sont utilisés.

---

## 2. Fichiers — Responsabilités détaillées

### `data.js` (~1 700 lignes)

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
| `PORTFOLIO.amine.degiro` | Compte Degiro fermé (P/L réalisé historique) |
| `PORTFOLIO.amine.allTrades` | Historique unifié Degiro 2020-2025 |
| `PORTFOLIO.nezha.*` | Patrimoine Nezha (banques, ESPP, SGTM) |
| `CASH_YIELDS` | Rendements par compte bancaire |
| `IBKR_CONFIG` | Taux IBKR par tranche (JPY margin tiers) |
| `FX_STATIC` | Taux de change fallback |
| `WHT_RATES` | Retenues à la source par pays |
| `DIV_YIELDS` / `DIV_CALENDAR` | Rendements dividendes et calendrier ex-dates |
| `BUDGET_EXPENSES` | Dépenses mensuelles fixes |
| `IMMO_CONSTANTS` | Prêts immo (Vitry, Rueil, Villejuif) + régimes fiscaux |

#### Conventions data.js

- **Devises natives** : Jamais de conversion dans data.js. Un montant AED reste en AED.
- **Commissions** : Le champ `t.commission` est en devise native du trade (EUR, USD, JPY). `engine.js` convertit via `toEUR()`.
- **FTT** : **PAS** incluse dans `t.commission`. Calculée séparément par `engine.js` (`FTT_RATE × cost`).
- **Dépôts** : Chaque virement a sa date, montant, devise et `fxRateAtDate`. Les retraits ont un montant négatif.

### `engine.js` (~3 200 lignes)

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
| `computeImmoView()` | Simulations immobilières (amortissement, CF, plus-value) |
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

### `render.js` (~5 300 lignes)

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

### `charts.js` (~3 170 lignes)

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
| `fetchHistoricalPricesYTD()` | Yahoo `range=ytd` pour chart |
| `fetchHistoricalPrices1Y()` | Yahoo `range=1y` pour chart 1Y |
| `fetchSoldStockPrices()` | Prix pour "Si gardé aujourd'hui" (positions fermées) |

Cache localStorage 10 min pour éviter les appels redondants.

### `app.js` (~750 lignes)

Orchestrateur. Gère :
- Initialisation et imports
- Event handlers (tabs, toggles, refresh)
- Flux async : `loadStockPrices()` (chart YTD) en parallèle de `refreshFX()` (taux live)
- Race condition fix : `destroyAllCharts()` préserve `charts.portfolioYTD` (v175)

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

> **Version actuelle : v193** (mars 2026)

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
  └─ loadStockPrices()                             // async — prix Yahoo
       ├─ compute(PORTFOLIO, liveFX, 'live')       // re-render avec prix live
       ├─ fetchHistoricalPricesYTD()               // données chart
       └─ buildPortfolioYTDChart()                 // construit le chart
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
