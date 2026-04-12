# Dashboard Patrimonial — Networth

## Project overview
Static GitHub Pages app (zero backend) that computes and displays the net worth of couple Amine & Nezha.
- **URL**: https://lallakenza.github.io/networth/
- **Repo**: `lallakenza/networth` on GitHub Pages (main branch auto-deploys)
- **Current version**: v288 (12 avril 2026)

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
