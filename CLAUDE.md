# Dashboard Patrimonial — Networth

## Project overview
Static GitHub Pages app (zero backend) that computes and displays the net worth of couple Amine & Nezha.
- **URL**: https://lallakenza.github.io/networth/
- **Repo**: `lallakenza/networth` on GitHub Pages (main branch auto-deploys)
- **Current version**: v322 (18 avril 2026)

## Architecture

```
index.html              ← Structure HTML + CSS (single page, section-based navigation)
  └─ js/app.js          ← Orchestrator (imports, init, event handlers)
       ├─ js/data.js         ← Raw data (positions, trades, deposits, FX, config)
       ├─ js/engine.js       ← Pure computation (NAV, P/L, costs, immo sims, créances, budget)
       ├─ js/render.js       ← DOM write-only (formatting, tables, insights, KPI cards, treemaps)
       ├─ js/charts.js       ← Chart.js (NAV evolution, allocations, CF projection, breakdown)
       ├─ js/simulators.js   ← 20-year wealth projection simulators
       ├─ js/api.js          ← Yahoo Finance API (live FX, stock prices, historical)
       └─ js/price_snapshot.js ← Static price fallback when API is down
```

Read `ARCHITECTURE.md` for full documentation (pipeline, state flow, version history, and audit changelog).
Read `BUG_TRACKER.md` for all known bugs, root causes, fixes, and regression test checklists.

## Key principles

1. **Strict separation**: `data` → `engine` → `render`. No module goes upstream.
2. **Zero hardcoded values**: All costs (commissions, FTT, interest, dividends) computed dynamically from raw data in `data.js`.
3. **Multi-currency native**: EUR, USD, JPY, AED, MAD. Every amount stored in native currency. Conversion via `toEUR(amount, currency, fx)` in `engine.js`.
4. **Cache-busting**: Every import uses `?v=N`. **ALWAYS bump version on ALL imports in `app.js` AND `index.html`** when deploying.
5. **Fallback static**: If Yahoo API is unavailable, static prices in `data.js` / `price_snapshot.js` are used.

## Critical data flows

### Net Worth calculation (engine.js `compute()`)
```
amineNW = amineTotalAssets + amineTva + amineFacturationNet
nezhaNW = nezhaTotalAssets
coupleNW = amineNW + nezhaNW
```
Where:
- `amineTotalAssets` = IBKR + ESPP + cash (UAE + EUR + Morocco) + SGTM + Vitry equity + vehicles + `amineRecvPro` + `amineRecvPersonal`
- `amineRecvPro/Personal` = from `portfolio.amine.creances.items` only (excludes recouvré)
- `amineFacturationNet` = from localStorage bridge OR `portfolio.amine.facturation` fallback. Nets Augustin (+181,609 MAD) and Benoit (-196,915 MAD)
- `amineTva` = negative (tax liability)

### Créances view (engine.js `computeCreancesView()`)
- **DISPLAY-ONLY** — does NOT feed back into NW calculation
- Splits items into: `activeItems` (en cours), `recoveredItems` (recouvré), `dettes` (TVA + facturation negatives)
- Facturation receivables (positive amounts like Augustin) are injected into `activeItems` for display
- KPIs computed AFTER injection so totals include facturation items

### Facturation localStorage bridge
- Same origin: `lallakenza.github.io` → facturation site writes `localStorage.facturation_positions`
- Schema: `{ augustin: { mad }, benoit: { dh }, combined: { mad }, updatedAt }`
- Falls back to `portfolio.amine.facturation` in `data.js` if localStorage is empty

### Views system (3 views: couple, amine, nezha)
- Each view has: `stocks`, `cash`, `immo`, `other` KPI cards
- **Treemap invariant**: `stocks + cash + immo + other = nwRef` for each view
- `views.couple.other` includes: vehicles + créances pro/perso + facturationNet + TVA + nezha receivables + villejuif reservation - cautionRueil
- `views.amine.other` includes: vehicles + créances pro/perso + facturationNet + TVA
- `views.nezha.other` includes: nezha receivables + villejuif reservation - cautionRueil

### Chart system (charts.js)
- 3 levels of data coexist: (1) raw series (couple-level), (2) owner-filtered series (render loop lines ~2143-2154), (3) metadata like `startValue` stays couple-level
- **Every consumer** (tooltip, header, click panel) must apply owner filter consistently
- Tooltip computes per-owner `startV` from filtered NAV arrays at `startIdx`
- Chart breakdown uses `window._simSnapshots` for per-position P&L decomposition

## Common pitfalls (from 19 past bugs)

1. **Owner filtering inconsistency**: Chart series are filtered per-owner, but metadata stays couple-level. Always check that new tooltip/panel code applies owner filter. (BUG-005, BUG-006, BUG-018)
2. **Recouvré double-counting**: Recouvré créances are already in cash. Skip with `if (c.status === 'recouvré') return;` in NW calc. (BUG-015)
3. **views.*.other desync**: When adding a new NW component, it MUST be added to `autreTotal`, both breakdown tables, treemap categories, insights, AND all 3 `views.*.other` cards. Check 9+ locations. (BUG-017)
4. **KPI timing in créances**: KPIs must be computed AFTER injecting facturation items into `activeItems`. (BUG-019)
5. **Cache-busting forgotten**: Always bump `?v=N` on ALL 7 imports in `app.js` + the script tag in `index.html`. Missing one = stale JS in production. (BUG-008)
6. **Degiro closed account**: NAV=0, net deposits negative (-50K). Don't use `Math.max(0, ...)` on deposits. Invariant: `NAV - NetDeployed ≈ Realized + Unrealized`. (BUG-014)
7. **Chart init order**: `refresh()` destroys charts. Always call `renderPortfolioChart()` after `refresh()` in init sequence. (BUG-003)

## File locations for common tasks

| Task | File | Approximate line |
|---|---|---|
| Add/update cash balances | `js/data.js` | ~49-65 (UAE), ~67 (EUR), ~70 (Morocco) |
| Add new stock position | `js/data.js` | ~75+ (positions object) |
| Add new créance | `js/data.js` | ~900+ (creances.items array) |
| Update facturation amounts | `js/data.js` | ~961 (facturation object) |
| NW calculation | `js/engine.js` | ~3535-3585 |
| Créances view computation | `js/engine.js` | ~3057-3199 |
| Breakdown tables (couple/amine) | `js/render.js` | ~947-969 |
| Créances view rendering | `js/render.js` | ~5598+ |
| Treemap categories | `js/engine.js` | ~3800-3870 |
| Chart tooltip handler | `js/charts.js` | ~2500+ |
| Immo simulation | `js/engine.js` | ~2800-3052 |
| Budget view | `js/engine.js` | ~3233+ |
| Financement immo (4 scénarios) | `js/engine.js` | `computeImmoFinancing` ~4449 |
| Cash-flow consolidé | `js/engine.js` | `computeCashFlow` ~4792 |
| Alertes proactives (5 règles) | `js/engine.js` | `computeAlerts` ~4919 |
| Plan long-terme + Sensibilité | `js/engine.js` | `computeObjectifs` ~5048, `computeSensibilite` ~5100 |
| Fiscalité MRE (IR/PV/calendrier) | `js/engine.js` | `computeFiscaliteMRE` ~5138 |
| Presets immo Maroc/UAE | `js/data.js` | `IMMO_PRESETS` ~2452 |
| Module Financement render | `js/render.js` | `renderImmoFinancingView` ~6595 |
| Plan & Fiscalité render | `js/render.js` | `renderPlanFiscalView` ~6908 |

## Data Update Cheatsheet (v304+)

**Tous les "faits" (soldes, positions, trades, dates) vivent dans `js/data.js`.**
Le pipeline est 100% dérivé : modifier data.js → engine recalcule → render affiche.
Aucune valeur calculée ne doit être hardcodée ailleurs. Pour la doc complète avec
schémas détaillés + exemples, voir `ARCHITECTURE.md §11 "Data Model Reference"`.

### Cadence de mise à jour typique

| Fréquence | Quoi mettre à jour | Où (data.js) | Trigger recompute |
|---|---|---|---|
| **Temps réel (auto)** | Prix actions, taux FX | API Yahoo (`js/api.js`) | fetchStockPrices / fetchFXRates |
| **Quotidienne** | — | — | (pas d'action manuelle) |
| **Mensuelle** | Soldes bancaires (Mashreq, Wio, Attijari, Revolut) | `PORTFOLIO.amine.{uae,eur,morocco}` | cash view, NW couple |
| **Mensuelle** | `EQUITY_HISTORY` (1 ligne par mois) | `EQUITY_HISTORY` array | 5Y/MAX chart, YTD spliced pipeline |
| **Au trade** | Achats/ventes actions IBKR | `PORTFOLIO.amine.ibkr.trades` | chart breakdown, P&L, positions table |
| **Au trade** | Soldes de positions IBKR | `PORTFOLIO.amine.ibkr.positions` | NW stocks, treemap, chart |
| **Trimestrielle** | Calendrier dividendes (DPS, exDates, confirmed) | `DIV_CALENDAR` | tableau WHT, `projectedDiv*` |
| **À la réception AGM** | Flag `confirmed: true` + `source` | `DIV_CALENDAR['TICKER'].confirmed` | badge "✓ confirmé" dans tableau |
| **Annuelle (janvier)** | `DATA_LAST_UPDATE` + version badge | `DATA_LAST_UPDATE` | footer, header badge |
| **Événementiel** | Nouvelle créance / remboursement | `PORTFOLIO.amine.creances.items` | créances view, NW (si statut ≠ recouvré) |
| **Événementiel** | Facturation (Augustin/Benoit) | `PORTFOLIO.amine.facturation` OR localStorage | `amineFacturationNet`, créances view |
| **Événementiel** | Nouveau prêt immo / modification CRD | `IMMO_CONSTANTS.charges` | immo view, NW, budget |
| **Événementiel** | Nouveau projet immo (preset) | `IMMO_PRESETS` (prix, devise, feesPct, apportRatio) | Module Financement (v306+) |
| **Mensuelle** | Facturation / salaires (cash-flow) | `MONTHLY_INCOMES` | Budget view, Alertes (v308+) |
| **Semestrielle** | Taux margin IBKR (suivi BCE/Fed) | `MARGIN_RATES` (EUR/USD/JPY) | Module Financement scénarios C/D |
| **Annuelle** | Barèmes notaire/hypothèque Maroc | `IMMO_MAROC_FEES` | Module Financement scénarios B/D |
| **Annuel** | Lots ESPP (+1 lot par an) + `totalCostBasisUSD` | `PORTFOLIO.amine.espp.lots` | stocks view, NW, chart |
| **Jamais sans justif** | TVA à payer, taux d'actualisation | `PORTFOLIO.amine.tva`, `INFLATION_RATE` | NW, simulator |

### Schémas rapides (pour détails → ARCHITECTURE.md §11)

**Position stock** :
```js
{ ticker: 'AIR.PA', shares: 200, currency: 'EUR', geo: 'france', label: 'Airbus (AIR)' }
```

**Trade IBKR** :
```js
{ date: '2026-03-15', type: 'buy', ticker: 'AIR.PA', shares: 50, priceLocal: 170.50,
  commissionEUR: 2, fttEUR: 0.68, currency: 'EUR' }
// Pour non-EUR: ajouter fxRate (taux ECB à la date)
```

**Dividende confirmé** (v303+) :
```js
'AIR.PA': { dps: 2.00, exDates: ['2026-04-22'], frequency: 'annual',
            confirmed: true, source: 'Airbus AGM 15 avril 2026' }
```

**EQUITY_HISTORY (1 ligne par mois)** :
```js
{ date: '2026-03-31', degiro: 0, espp: 36250, ibkr: 195063, total: 231313 }
```

**Créance** :
```js
{ id: 'INVSNT005', counterparty: 'Malt', amount: 3500, currency: 'EUR',
  status: 'en_cours', dueDate: '2026-05-15', probability: 0.9, type: 'pro' }
// status='recouvré' → exclu du NW (déjà dans cash)
```

**Lot ESPP Amine (cost basis exact)** :
```js
{ date: '2023-05-01', source: 'ESPP', shares: 17, costBasis: 236.88, contribEUR: 3845.99 }
// FRAC (dividendes réinvestis): contribEUR = 0 (PAS absent — explicite)
```

### Règles d'or (anti-régression)

1. **Ne JAMAIS dupliquer un calcul** : si tu as besoin d'une valeur dérivée, l'importer depuis engine.js (exemple : `esppLotCostEUR`, `getGrandTotal`).
2. **Toujours bumper `?v=N`** sur TOUS les imports (app.js x7, charts.js x4, simulators.js x2, index.html script tag x1) + `APP_VERSION` dans data.js. Sinon cache = stale JS.
3. **Invariants engine** (vérifiés au runtime, `[engine] Accounting balanced ✓`) :
   - `NAV − Net Déployé ≈ Realized + Unrealized` (tolérance ±€5K)
   - `views.couple.other = views.amine.other + views.nezha.other`
   - `stocks + cash + immo + other = nwRef` par vue (treemap invariant)
4. **Invariants chart** (v303+, `[v303] ✓ plValues*` dans la console) :
   - `plValuesTotal[t] ≈ absPLTotal[t]` (formule canonique : NAV − absDeposits)
   - `plValuesTotal = Σ plValues{IBKR,ESPP,SGTM,Degiro}` (additivité)
   - `plValuesESPP = plValuesESPPAmine + plValuesESPPNezha` (per-owner)
5. **Multi-devises** : TOUS les montants stockés en devise NATIVE. Conversion uniquement via `toEUR(amount, currency, fx)` côté engine. Ne jamais pré-convertir en EUR dans data.js.
6. **Sémantique `0` vs `undefined`** : pour `contribEUR` (lots ESPP) et similaires, `0` signifie "zéro explicite" (ex: FRAC = dividendes réinvestis, pas de coût). `undefined` signifie "fallback sur le calcul par défaut" (ex: Nezha sans contrib tracée). Utiliser `!= null` pas `if (x)` pour distinguer.
7. **Shapes de données inter-modules (v313+ BUG-056/057/058)** : avant de lire une sous-propriété d'un objet `state.xxx`, vérifier le shape réel dans engine.js (les `return {…}`). Anti-pattern : inventer des noms de champs. Exemples :
   - `immoView.properties[i]` expose `cf` (mensuel net), `loyer`, `loyerDeclareAnnuel`, `deductibleChargesAnnuel`, `loanInterestAnnuel`, `purchasePrice`, `propertyMeta` — **PAS** de `cashFlow.netMonthly` / `loyerMensuel` / etc.
   - `actionsView.ibkrPositions[i]` expose `ticker`, `valEUR`, `costEUR_hist`, `unrealizedPL` — **PAS** de `platform` ni `costBasisEUR`.
   - Si un champ calculé est absent, soit l'ajouter à la source (engine), soit dériver à partir des champs existants — **jamais** inventer un chemin.

## Git conventions

```bash
# Always commit with:
git -c user.name="Amine" -c user.email="amine.koraibi@gmail.com" commit -m "vN: Short description"

# Commit message format:
# vN: Short description of what changed
# 
# Detailed explanation if needed.
# Reference BUG-XXX if fixing a tracked bug.
```

- Push to `main` triggers GitHub Pages deploy (~60 seconds)
- Always document new bugs in `BUG_TRACKER.md` with: version, severity, detection, symptom, root cause, fix, regression tests
- Always add version entry in `ARCHITECTURE.md` §8

## Deployment checklist

1. Bump `?v=N` → `?v=N+1` on all 7 imports in `js/app.js`
2. Bump `?v=N` → `?v=N+1` on the `<script>` tag in `index.html`
3. `git add` changed files → commit → `git push origin main`
4. Wait ~60s for GitHub Pages deploy
5. Hard-refresh browser (`Cmd+Shift+R`) or use `?v=N+1` URL to verify

## Currency codes & FX

| Currency | Used for | FX source |
|---|---|---|
| EUR | Base currency, France assets | — |
| USD | IBKR, ESPP stocks | Yahoo Finance EURUSD=X |
| JPY | Rakuten (Japanese stock) | Yahoo Finance EURJPY=X |
| AED | UAE bank accounts (Mashreq, Wio) | Yahoo Finance EURAED=X |
| MAD | Morocco (Attijari, SGTM, facturation) | Yahoo Finance EURMAD=X |

## Account structure

**Amine**:
- IBKR (stocks: GOOGL, META, AMZN, MSFT, etc.)
- ESPP (Microsoft employee stock purchase)
- SGTM (Moroccan fund)
- UAE: Mashreq, Wio Savings, Wio Current, Wio Business (Bairok)
- EUR: Revolut
- Morocco: Attijari
- Immo: Vitry (apartment, loan active)
- Vehicles: Cayenne, Mercedes
- Créances: SAP, Malt, loyers, personal loans
- Facturation: Augustin (Azarkan) owes Amine, Amine owes Benoit (Badre)
- TVA: negative (tax liability)

**Nezha**:
- IBKR (shared account, ownership ratio applied)
- ESPP (shared, from Nov 2023)
- Immo: Villejuif (reservation deposit), Rueil (caution/deposit)
- Créances: Omar
