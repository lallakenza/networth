---
name: update-dashboard
description: "Update the networth dashboard data (data.js) for Amine & Nezha Koraibi's patrimonial dashboard hosted on GitHub Pages. Use this skill whenever the user wants to update balances, stock positions, IBKR data, real estate values, cash balances, exchange rates, or any financial data in the dashboard. Triggers include: 'update dashboard', 'update networth', 'update data', 'mise à jour données', 'update balances', 'new IBKR CSV', 'update positions', 'update cash', or any mention of updating the patrimonial/financial dashboard. Also use when the user pastes CSV data, bank balances, or screenshots of financial accounts."
---

# Update Dashboard Data

This skill helps update the `data.js` file for the patrimonial dashboard at `https://lallakenza.github.io/networth/`.

## Repository

- **Repo**: `lallakenza/networth` on GitHub
- **Branch**: `main`
- **Key file**: `js/data.js` — the ONLY file that needs editing for data updates
- **Live URL**: https://lallakenza.github.io/networth/

## Step-by-Step Process

### 1. Clone the repo (if not already local)

```bash
cd /sessions/intelligent-loving-rubin
git clone https://github.com/lallakenza/networth.git dashboard-update
cd dashboard-update
```

### 2. Read current data.js

Always read `js/data.js` first to understand the current state before making changes.

### 3. Identify what the user wants to update

The user may provide one or more of:

#### A. IBKR Positions (from CSV export)
When the user pastes an IBKR CSV or gives new position data:
- Update `PORTFOLIO.amine.ibkr.positions[]` — ticker, shares, price, costBasis
- Update `PORTFOLIO.amine.ibkr.staticNAV` with the CSV's reported NAV
- Update `PORTFOLIO.amine.ibkr.cashEUR`, `cashUSD`, `cashJPY`
- Update `PORTFOLIO.amine.ibkr.meta` — twr, realizedPL, dividends, commissions, deposits, closedPositions

#### B. Cash Balances (from banking apps)
The user may provide balances from various banking apps:
- **Mashreq NEO+** → `PORTFOLIO.amine.uae.mashreq` (AED)
- **Wio Savings** → `PORTFOLIO.amine.uae.wioSavings` (AED)
- **Wio Current** → `PORTFOLIO.amine.uae.wioCurrent` (AED)
- **Revolut EUR** → `PORTFOLIO.amine.uae.revolutEUR` (EUR, not AED!)
- **Attijariwafa** → `PORTFOLIO.amine.maroc.attijari` (MAD)
- **Nabd (ex-SOGE)** → `PORTFOLIO.amine.maroc.nabd` (MAD)
- **Nezha France** → `PORTFOLIO.nezha.cashFrance` (EUR)
- **Nezha Maroc** → `PORTFOLIO.nezha.cashMaroc` (MAD)

#### C. ESPP Accenture (from Fidelity NetBenefits)
- Update `PORTFOLIO.amine.espp.shares` (number of ACN shares)
- Update `PORTFOLIO.amine.espp.cashEUR` (cash residual in EUR)
- Update `PORTFOLIO.market.acnPriceUSD` (current ACN stock price)
- If new lots purchased, add to `PORTFOLIO.amine.espp.lots[]`

#### D. Real Estate (from mortgage statements)
- **Vitry** → `PORTFOLIO.amine.immo.vitry` — value, crd, loyer, parking
- **Rueil** → `PORTFOLIO.nezha.immo.rueil` — value, crd, loyer
- **Villejuif** → `PORTFOLIO.nezha.immo.villejuif` — value, crd, loyer

#### E. Créances (debts owed to us)
- Update `PORTFOLIO.amine.creances.items[]` — add/remove/modify
- Update `PORTFOLIO.nezha.creances.items[]` — add/remove/modify

#### F. Market Prices
- **SGTM** → `PORTFOLIO.market.sgtmPriceMAD`
- **Accenture** → `PORTFOLIO.market.acnPriceUSD`

#### G. FX Rates (only if API is broken)
- Update `FX_STATIC` — EUR/AED, EUR/MAD, EUR/USD, EUR/JPY

#### H. Interest Rates
- Update `CASH_YIELDS` — if bank rates change
- Update IBKR tiered rates in `engine.js` → `ibkrJPYBorrowCost()` function

### 4. Make the edits

Use the Edit tool to modify `js/data.js`. Rules:
- **Keep comments** — the file is heavily commented for future reference
- **Keep the date comment** updated (e.g., `// mis à jour 8 Mar 2026`)
- **Never change engine.js, render.js, charts.js, or app.js** unless explicitly asked
- **Currencies must stay native** — AED amounts in AED, MAD in MAD, etc.

### 5. Validate with Node.js

After editing, run this validation:

```bash
node --experimental-vm-modules -e "
import { PORTFOLIO, FX_STATIC } from './js/data.js';
import { compute } from './js/engine.js';
const state = compute(PORTFOLIO, FX_STATIC, 'statique');
console.log('Couple NW:', Math.round(state.couple.nw));
console.log('Amine NW:', Math.round(state.amine.nw));
console.log('Nezha NW:', Math.round(state.nezha.nw));
console.log('IBKR NAV:', Math.round(state.amine.ibkr));
console.log('Cash total:', Math.round(state.cashView.totalCash));
console.log('Immo equity:', Math.round(state.immoView.totalEquity));
console.log('Creances nominal:', Math.round(state.creancesView.totalNominal));
console.log('Positions:', state.actionsView.ibkrPositions.length);
// Check no NaN
const vals = [state.couple.nw, state.amine.nw, state.nezha.nw];
if (vals.some(v => isNaN(v))) { console.error('ERROR: NaN detected!'); process.exit(1); }
console.log('✓ All OK');
"
```

### 6. Commit and push

```bash
git add js/data.js
git commit -m "Update data — [brief description of what changed]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin main
```

### 7. Confirm deployment

Tell the user: "Data updated and pushed. The site will refresh in ~1 minute at https://lallakenza.github.io/networth/"

## Common Update Scenarios

### "Here's my new IBKR CSV"
1. Parse the CSV to extract: positions (ticker, shares, price, cost basis), cash balances (EUR, USD, JPY), NAV, TWR, realized P/L, dividends, commissions
2. Map tickers to existing format (e.g., `AIR FP` → `AIR.PA`)
3. Identify new positions to add and closed positions to move to `meta.closedPositions`
4. Update all IBKR fields in data.js

### "Update my bank balances: Mashreq 350K, Wio 220K..."
1. Update the specific fields the user mentions
2. Keep all other balances unchanged

### "Kenza paid back her loan" / "Add new créance"
1. Remove or add items in the créances arrays
2. Keep the format consistent with existing entries

### "IBKR interest rates changed"
1. This requires editing `engine.js` (the `ibkrJPYBorrowCost` function or the yield calculations)
2. Also update `CASH_YIELDS` in `data.js` if the EUR/USD rates changed

## Data Format Reference

### Position format
```js
{ ticker: 'AIR.PA', shares: 200, price: 175.88, costBasis: 190.25, currency: 'EUR', label: 'Airbus (AIR)', sector: 'industrials', geo: 'france' }
```

Sectors: `luxury`, `industrials`, `tech`, `crypto`, `consumer`, `healthcare`, `automotive`
Geo: `france`, `germany`, `japan`, `crypto`, `us`, `morocco`

### Créance format
```js
{ label: 'Kenza', amount: 200000, currency: 'MAD', guaranteed: true, probability: 1.0 }
```

### Cash yields format
```js
CASH_YIELDS = {
  mashreq: 0.0625,    // 6.25% annual
  wioSavings: 0.06,   // 6.00% annual
  // ...
}
```
