// ============================================================
// ENGINE — Pure computation. No DOM access, no side effects.
// ============================================================
// See ARCHITECTURE.md for full documentation (NW formulas,
// Villejuif logic, exit costs, IRA, fiscal config, audit fixes).
// Version: v231
//
// Purpose: Computation engine for the patrimonial dashboard
//
// Architecture:
//   - Input: portfolio data from data.js (loans, properties, assets, FX rates)
//   - Processing: Pure functions compute amortization, fiscal impact, wealth creation
//   - Output: STATE object with computed views (immo, cash, actions, budget, creances)
//
// Key functions:
//   - compute(portfolio, fx, stockSource)        → main entry point, returns full STATE
//   - computeImmoView(portfolio, fx)             → property valuations, revenues, wealth
//   - computeMultiLoanSchedule(subLoans, ins)    → combined amortization for multi-loan
//   - computeAmortizationSchedule(loan)          → single-loan amortization table
//   - computeFiscalite(loyer, charges, config)   → tax calculation (micro/réel)
//   - computeExitCosts(loanKey, ...)             → capital gains tax and exit scenarios
//   - computeCashView(portfolio, fx)             → cash holdings, yields, inflation
//   - computeActionsView(portfolio, fx, source)  → stocks, dividends, P&L by position
//   - computeBudgetView(portfolio, fx)           → budget tracking, monthly expenses
//
// compute(portfolio, fx, stockSource) → STATE object

import { CASH_YIELDS, INFLATION_RATE, IMMO_CONSTANTS, WHT_RATES, DIV_YIELDS, DIV_CALENDAR, IBKR_CONFIG, BUDGET_EXPENSES, EXIT_COSTS, VITRY_CONSTRAINTS, VILLEJUIF_REGIMES, FX_STATIC, DEGIRO_STATIC_PRICES, NW_HISTORY, EQUITY_HISTORY } from './data.js?v=259';

/**
 * Convert a foreign amount to EUR using FX rates
 */
function toEUR(amount, currency, fx) {
  if (currency === 'EUR') return amount;
  return amount / (fx[currency] || 1);
}

/**
 * Compute IBKR NAV from individual positions + multi-currency cash
 */
function computeIBKR(portfolio, fx, stockSource) {
  const ibkr = portfolio.amine.ibkr;
  if (stockSource !== 'live') return ibkr.staticNAV;
  // Sum position values
  let posTotal = 0;
  ibkr.positions.forEach(pos => {
    posTotal += toEUR(pos.shares * pos.price, pos.currency, fx);
  });
  // Multi-currency cash
  const cashTotal = ibkr.cashEUR
    + toEUR(ibkr.cashUSD, 'USD', fx)
    + toEUR(ibkr.cashJPY, 'JPY', fx);
  return posTotal + cashTotal;
}

/**
 * Compute individual IBKR position values with P/L (for table display)
 *
 * Period P&L formula (accounts for trades during the period):
 *   periodPL = endValue - startValue - netCashInvested
 *   where:
 *     endValue      = currentShares × currentPrice (in EUR)
 *     startValue    = sharesAtStart × refPrice (in EUR)
 *     netCashInvested = cost of buys during period − proceeds of sells during period (in EUR)
 *     sharesAtStart = currentShares − (buys during period) + (sells during period)
 */
function computeIBKRPositions(portfolio, fx) {
  const ibkr = portfolio.amine.ibkr;

  // Group IBKR stock trades by ticker (exclude FX trades)
  const allTrades = (ibkr.trades || []).filter(t => t.type === 'buy' || t.type === 'sell');
  const tradesByTicker = {};
  allTrades.forEach(t => {
    if (!tradesByTicker[t.ticker]) tradesByTicker[t.ticker] = [];
    tradesByTicker[t.ticker].push(t);
  });

  // Compute period start date strings (ISO format for comparison)
  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const todayStr = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  const ytdStartStr = now.getFullYear() + '-01-01';
  const mtdStartStr = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-01';
  // 1M = same day last month (calendar month, not 30 days)
  const oneMonthAgoDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const oneMonthStr = oneMonthAgoDate.getFullYear() + '-' + pad2(oneMonthAgoDate.getMonth() + 1) + '-' + pad2(oneMonthAgoDate.getDate());
    // 1Y = same day last year
    const oneYearAgoDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const oneYearStr = oneYearAgoDate.getFullYear() + '-' + pad2(oneYearAgoDate.getMonth() + 1) + '-' + pad2(oneYearAgoDate.getDate());

  const positions = ibkr.positions.map(pos => {
    const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
    const costEUR = toEUR(pos.shares * pos.costBasis, pos.currency, fx);
    let priceLabel = '';
    if (pos.currency === 'EUR') priceLabel = '\u20ac ' + pos.price.toFixed(2);
    else if (pos.currency === 'USD') priceLabel = '$' + pos.price.toFixed(2);
    else if (pos.currency === 'JPY') priceLabel = '\u00a5' + Math.round(pos.price);

    const prevFxRate = FX_STATIC[pos.currency] || fx[pos.currency];
    const curFxRate = fx[pos.currency] || 1;
    const trades = tradesByTicker[pos.ticker] || [];

    // ── FX P&L decomposition ──
    // For non-EUR positions, decompose total P&L into stock P&L + FX P&L
    // using historical FX rates stored on each trade (fxRate field).
    // Formula:
    //   totalPL   = valEUR - costEUR_hist        (true gain/loss in EUR since purchase)
    //   stockPL   = shares*(price - costBasis) / histFX   (price movement at constant FX)
    //   fxPL      = totalPL - stockPL            (FX impact on current value)
    let costEUR_hist = costEUR;  // default: same as current FX (EUR positions)
    let fxPL = 0;
    let stockPL = valEUR - costEUR;
    if (pos.currency !== 'EUR' && trades.length > 0) {
      // Compute weighted average historical FX from buy trades
      let totalBuyCostNative = 0, totalBuyCostEUR_hist = 0;
      trades.forEach(t => {
        if (t.type === 'buy' && t.fxRate) {
          const tCost = t.cost || t.qty * t.price;
          totalBuyCostNative += tCost;
          totalBuyCostEUR_hist += tCost / t.fxRate;
        }
      });
      if (totalBuyCostNative > 0 && totalBuyCostEUR_hist > 0) {
        const weightedHistFx = totalBuyCostNative / totalBuyCostEUR_hist;
        costEUR_hist = pos.shares * pos.costBasis / weightedHistFx;
        stockPL = pos.shares * (pos.price - pos.costBasis) / weightedHistFx;
        fxPL = (valEUR - costEUR_hist) - stockPL;
      }
    }
    const unrealizedPL = valEUR - costEUR_hist;  // true total P&L (incl. FX)
    const pctPL = costEUR_hist > 0 ? (unrealizedPL / costEUR_hist * 100) : 0;

    // Compute shares held at period start + net cash invested during period
    function tradesDuringPeriod(periodStartDate) {
      let buyShares = 0, sellShares = 0;
      let buyCostNative = 0, sellProceedsNative = 0;
      trades.forEach(t => {
        if (t.date >= periodStartDate) {
          if (t.type === 'buy') {
            buyShares += t.qty;
            buyCostNative += (t.cost || t.qty * t.price);
          } else if (t.type === 'sell') {
            sellShares += t.qty;
            sellProceedsNative += (t.proceeds || t.qty * t.price);
          }
        }
      });
      return {
        sharesAtStart: pos.shares - buyShares + sellShares,
        netCashInvestedEUR: toEUR(buyCostNative, pos.currency, fx) - toEUR(sellProceedsNative, pos.currency, fx),
      };
    }

    // Period P&L: correct formula accounting for intra-period trades
    // refPrice = null is allowed when periodStartDate is set — covers positions
    // bought entirely within the period (sharesAtStart=0, so refPrice is irrelevant)
    function periodPL(refPrice, usePrevFx, periodStartDate) {
      const fxRate = usePrevFx ? prevFxRate : curFxRate;

      if (periodStartDate && trades.length > 0) {
        const { sharesAtStart, netCashInvestedEUR } = tradesDuringPeriod(periodStartDate);
        if (sharesAtStart === 0) {
          // Position fully bought during the period — no ref price needed
          // P&L = current value - total cost invested during the period
          return valEUR - netCashInvestedEUR;
        }
        // Position existed before the period — need ref price
        if (!refPrice || refPrice <= 0) return null;
        const startVal = sharesAtStart * refPrice / fxRate;
        return valEUR - startVal - netCashInvestedEUR;
      }

      // No periodStartDate or no trades: need ref price
      if (!refPrice || refPrice <= 0) return null;
      const refVal = pos.shares * refPrice / fxRate;
      return valEUR - refVal;
    }

    // previousClose comes from live API only (changes daily).
    // ytdOpen/mtdOpen/oneMonthAgo are stored in data.js (stable reference prices).
    const dailyPL = periodPL(pos.previousClose, true, todayStr);
    const mtdPL = periodPL(pos.mtdOpen, false, mtdStartStr);
    const ytdPL = periodPL(pos.ytdOpen, false, ytdStartStr);
    const oneMonthPL = periodPL(pos.oneMonthAgo, false, oneMonthStr);
    // 1Y P&L: uses oneYearAgo price from data.js (stored historical prices)
    // For positions bought entirely within 1Y (sharesAtStart=0), refPrice is
    // irrelevant — periodPL() handles this case: P&L = valEUR - netCashInvestedEUR
    const oneYearAgoPrice = portfolio.market?.oneYearAgoPrices?.[pos.ticker] || null;
    const oneYearPL = periodPL(oneYearAgoPrice, false, oneYearStr);
    return { ...pos, valEUR, costEUR, costEUR_hist, unrealizedPL, pctPL, fxPL, stockPL, priceLabel, dailyPL, mtdPL, ytdPL, oneMonthPL, oneYearPL };
  }).sort((a, b) => b.valEUR - a.valEUR);

  // Compute weights
  const totalVal = positions.reduce((s, p) => s + p.valEUR, 0);
  positions.forEach(p => { p.weight = totalVal > 0 ? (p.valEUR / totalVal * 100) : 0; });
  return positions;
}

/**
 * Compute actions view (stocks cockpit): positions, P&L, dividends, allocation
 *
 * Aggregates equity holdings across multiple accounts:
 *   - IBKR (Interactive Brokers): individual stock positions + cash + FX P&L
 *   - SGTM (Sicar): Moroccan equity investment company
 *   - ESPP (Accenture): employee stock purchase plan
 *   - Degiro (alternative broker): legacy positions
 *
 * For each position computes:
 *   - Current value (in EUR using FX rates)
 *   - Cost basis (acquisition cost)
 *   - Unrealized P&L (current - cost)
 *   - Period P&L: account for buys/sells during period (YTD, MTD, 1M, 1Y)
 *
 * Dividend analysis:
 *   - By ticker: historical yields, declaration dates, ex-dates, payment dates
 *   - Calendar projection: expected dividends next 12 months
 *   - Cash flow impact: scheduled dividend payments
 *
 * Allocation:
 *   - By region/currency: EUR, USD, JPY, other
 *   - By sector: tech, financial, energy, etc.
 *   - Concentration: top 5 holdings as % of total
 *
 * @param {Object} portfolio - Portfolio data
 * @param {Object} fx - FX rates
 * @param {string} stockSource - 'live' (compute from current prices) or 'statique' (use static NAV)
 * @param {number} ibkrNAV - IBKR total nav
 * @param {Array} ibkrPositions - Detailed IBKR positions with P&L
 * @param {number} amineSgtm - SGTM value in EUR
 * @param {number} nezhaSgtm - Nezha SGTM value in EUR
 * @param {number} amineEspp - ESPP value in EUR
 * @param {number} nezhaEspp - Nezha ESPP value in EUR
 * @returns {Object} { ibkrNav, esppNav, sgtmNav, totalNav, positions: {...}, dividends, allocation, ... }
 */
function computeActionsView(portfolio, fx, stockSource, ibkrNAV, ibkrPositions, amineSgtm, nezhaSgtm, amineEspp, nezhaEspp) {
  const ibkr = portfolio.amine.ibkr;
  const espp = portfolio.amine.espp;
  const m = portfolio.market;

  // IBKR cash in EUR
  const ibkrCashEUR = ibkr.cashEUR;
  const ibkrCashUSD = ibkr.cashUSD;
  const ibkrCashJPY = ibkr.cashJPY;
  const ibkrCashTotal = ibkrCashEUR + toEUR(ibkrCashUSD, 'USD', fx) + toEUR(ibkrCashJPY, 'JPY', fx);

  // IBKR positions P/L (using historical FX for cost basis)
  const totalPositionsVal = ibkrPositions.reduce((s, p) => s + p.valEUR, 0);
  const totalCostBasis = ibkrPositions.reduce((s, p) => s + p.costEUR_hist, 0);
  const totalUnrealizedPL = totalPositionsVal - totalCostBasis;
  const totalFxPL = ibkrPositions.reduce((s, p) => s + (p.fxPL || 0), 0);
  const totalStockPL = ibkrPositions.reduce((s, p) => s + (p.stockPL || 0), 0);

  // ESPP cost basis & P/L — v246: use contribEUR (actual salary deductions in EUR)
  // NOT totalCostBasisUSD/currentFX, which fluctuates with EUR/USD and diverges from chart deposits
  // contribEUR = exact EUR deducted from salary each ESPP period (source: EsppPurchaseReport.pdf)
  // For lots without contribEUR (e.g. FRAC dividends), use 0 (they were free shares)
  // For Nezha: fallback to costBasis × shares / fxRate (same as depositHistory)
  function esppLotCostEUR(lot, defaultFx) {
    if (lot.contribEUR !== undefined) return lot.contribEUR; // Amine lots have exact EUR contributions
    return (lot.shares * lot.costBasis) / (lot.fxRateAtDate || defaultFx);
  }
  const esppCostBasisEUR = (espp.lots || []).reduce((s, l) => s + esppLotCostEUR(l, 1.15), 0);
  const esppCurrentVal = toEUR(espp.shares * m.acnPriceUSD, 'USD', fx);
  // v246: include ESPP cash in P&L (it's part of the ESPP account NAV in EQUITY_HISTORY)
  const esppCashEUR = (espp.cashEUR || 0) + toEUR(espp.cashUSD || 0, 'USD', fx);
  const esppUnrealizedPL = (esppCurrentVal + esppCashEUR) - esppCostBasisEUR;

  // Nezha ESPP — uses same helper (no contribEUR → fallback costBasis/fxRate)
  const nezhaEsppData = portfolio.nezha.espp || {};
  const nezhaEsppShares = nezhaEsppData.shares || 0;
  const nezhaEsppCurrentVal = toEUR(nezhaEsppShares * m.acnPriceUSD, 'USD', fx);
  const nezhaCashEUR = toEUR(nezhaEsppData.cashUSD || 0, 'USD', fx);
  const nezhaEsppCostBasisEUR = (nezhaEsppData.lots || []).reduce((s, l) => s + esppLotCostEUR(l, 1.10), 0);
  const nezhaEsppUnrealizedPL = (nezhaEsppCurrentVal + nezhaCashEUR) - nezhaEsppCostBasisEUR;

  // Total all stocks (IBKR + ESPP Amine + ESPP Nezha + SGTM)
  const totalStocks = ibkrNAV + amineEspp + nezhaEspp + amineSgtm + nezhaSgtm;

  // Geo allocation from IBKR positions
  const geoAllocation = {};
  ibkrPositions.forEach(p => {
    const geo = p.geo || 'other';
    geoAllocation[geo] = (geoAllocation[geo] || 0) + p.valEUR;
  });
  geoAllocation.us = (geoAllocation.us || 0) + amineEspp + nezhaEspp;
  geoAllocation.morocco = (geoAllocation.morocco || 0) + amineSgtm + nezhaSgtm;

  // Sector allocation from IBKR positions
  const sectorAllocation = {};
  ibkrPositions.forEach(p => {
    const sec = p.sector || 'other';
    sectorAllocation[sec] = (sectorAllocation[sec] || 0) + p.valEUR;
  });
  sectorAllocation.tech = (sectorAllocation.tech || 0) + amineEspp; // ACN = tech/consulting

  const meta = ibkr.meta || {};

  // Degiro (closed account)
  const degiro = portfolio.amine.degiro || {};
  // v246: use totalPLAllComponents (includes dividends, FX, interest) for consistency with chart
  // Previously used totalRealizedPL (trading gains only), causing a ~€478 gap
  const degiroRealizedPL = degiro.totalPLAllComponents || degiro.totalRealizedPL || 0;

  // Combined realized P/L (IBKR + Degiro)
  // Compute IBKR realized P/L dynamically from trade data (not hardcoded meta)
  // Each trade's realizedPL is in its native currency → convert to EUR
  let ibkrRealizedPL = 0;
  (ibkr.trades || []).filter(t => t.type === 'sell' && t.source === 'ibkr').forEach(t => {
    if (typeof t.realizedPL === 'number') {
      ibkrRealizedPL += toEUR(t.realizedPL, t.currency, fx);
    }
  });
  let combinedRealizedPL = ibkrRealizedPL + degiroRealizedPL;
  // v246: adjusted below (after costs computed) to include IBKR dividends and subtract costs

  // ── Authoritative Degiro P/L per ticker from annual reports ──
  // Degiro is a closed account — this mapping is fixed.
  // Maps perInstrumentPL instrument names → trade tickers used in allTrades.
  const DEGIRO_INSTRUMENT_TO_TICKER = {
    'ACCOR': 'AC', 'ADP': 'ADP', 'AIRBUS': 'AIR', 'AIR FRANCE': 'AF',
    'BNP PARIBAS': 'BNP', 'BOEING': 'BA', 'BOUYGUES': 'EN',
    'CANADA GOOSE': 'GOOS', 'CANOPY GROWTH': 'CGC', 'CAP GEMINI': 'CAP',
    'CARNIVAL': 'CCL', 'COFACE': 'COFA', 'CREDIT AGRICOLE': 'ACA',
    'DELTA AIR LINES': 'DAL', 'EDENRED': 'EDEN', 'FEDEX': 'FDX',
    'HERTZ': 'HTZ', 'INFOSYS': 'INFY', 'KLEPIERRE': 'LI',
    'KORIAN': 'KORI', 'LVMH': 'MC', 'MS LIQUIDITY': 'MSLIQ',
    'NIKE': 'NKE', 'NVIDIA': 'NVDA', 'PEUGEOT': 'UG',
    'PHILIP MORRIS': 'PM', 'RENAULT': 'RNO', 'SANOFI': 'SAN',
    'SAP': 'SAP', 'SODEXO': 'SW', 'SOPRA STERIA': 'SOP',
    'TESLA': 'TSLA', 'UNDER ARMOUR': 'UA', 'UTD AIRLINES': 'UAL',
    'VISA': 'V', 'ATOS': 'ATO', 'EUROPCAR': 'EUCAR',
    'FITBIT': 'FIT', 'GAMESTOP': 'GME', 'IBM': 'IBM',
    'JUVENTUS': 'JUVE', 'TORTOISE ACQUISITION (SNPR→VLTA)': 'VLTA',
    'WALT DISNEY': 'DIS', 'VOLTA (ex-SNPR)': 'VLTA',
    'SPOTIFY': 'SPOT', 'DISNEY': 'DIS',
  };
  // Build ticker → total P/L by summing perInstrumentPL across all years
  const degiroPerTickerPL = {};
  const perInstrumentPL = degiro.perInstrumentPL || {};
  Object.values(perInstrumentPL).forEach(yearData => {
    Object.entries(yearData).forEach(([name, pl]) => {
      const ticker = DEGIRO_INSTRUMENT_TO_TICKER[name];
      if (ticker) {
        degiroPerTickerPL[ticker] = (degiroPerTickerPL[ticker] || 0) + pl;
      } else {
        console.warn('[engine] perInstrumentPL instrument not mapped:', name);
      }
    });
  });

  // Cross-platform deposits — detailed history with FX comparison
  const depositHistory = [];

  // Helper: push a deposit entry
  function addDeposit(date, label, owner, platform, amountNative, currency, fxAtDate) {
    const amountEUR = currency === 'EUR' ? amountNative : amountNative / fxAtDate;
    const currentEUR = currency === 'EUR' ? amountNative : toEUR(amountNative, currency, fx);
    depositHistory.push({
      date, label, owner, platform,
      amountNative, currency, fxAtDate,
      amountEUR,
      currentEUR,
      fxGainEUR: currentEUR - amountEUR,
    });
  }

  // 1. IBKR deposits (Amine)
  (ibkr.deposits || []).forEach(d => {
    addDeposit(d.date, d.label || 'Dépôt IBKR', 'Amine', 'IBKR', d.amount, d.currency, d.fxRateAtDate || 1);
  });

  // 1b. Degiro deposits & retraits (Amine) — compte clôturé avril 2025
  // ✅ Montants exacts — back-calculés des rapports annuels DEGIRO (v243)
  (degiro.deposits || []).forEach(d => {
    addDeposit(d.date, d.label || 'Dépôt Degiro', 'Amine', 'Degiro', d.amount, d.currency, d.fxRateAtDate || 1);
  });

  // 2. ESPP lots (Amine) — v246: use esppLotCostEUR (same as unrealized P&L)
  // Ensures deposits in depositHistory = cost basis used for unrealized P&L card
  (espp.lots || []).forEach(lot => {
    const costEUR = Math.round(esppLotCostEUR(lot, 1.15));
    addDeposit(lot.date, 'ESPP ' + lot.shares + ' ACN @ $' + lot.costBasis.toFixed(0), 'Amine', 'ESPP (UBS)',
      costEUR, 'EUR', 1);
  });

  // 2b. ESPP Nezha — same helper, same consistency
  (nezhaEsppData.lots || []).forEach(lot => {
    const costEUR = Math.round(esppLotCostEUR(lot, 1.10));
    addDeposit(lot.date, 'ESPP ' + lot.shares + ' ACN @ $' + lot.costBasis.toFixed(0), 'Nezha', 'ESPP (UBS)',
      costEUR, 'EUR', 1);
  });

  // 3. SGTM IPO — Amine + Nezha
  const sgtmCost = portfolio.market.sgtmCostBasisMAD || 420;
  [{ owner: 'Amine', shares: portfolio.amine.sgtm?.shares || 0 },
   { owner: 'Nezha', shares: portfolio.nezha.sgtm?.shares || 0 }].forEach(s => {
    if (s.shares <= 0) return;
    const costMAD = s.shares * sgtmCost;
    addDeposit('2025-12-15', 'IPO SGTM (' + s.shares + ' actions @ ' + sgtmCost + ' DH)', s.owner, 'Attijari (SGTM)',
      costMAD, 'MAD', 10.8);
  });

  depositHistory.sort((a, b) => a.date.localeCompare(b.date));

  // ═══════════════════════════════════════════════════════════════════
  // v280 (BUG-014 fix): Net Capital Deployed — source unique de vérité
  // ═══════════════════════════════════════════════════════════════════
  // "Net Déployé" par plateforme = Σ(dépôts) − Σ(retraits), sans floor.
  // Pour un compte clôturé à profit (ex: Degiro), cette valeur est NÉGATIVE
  // (l'utilisateur a extrait plus de cash qu'il n'en a versé — le delta est
  // le P&L réalisé déjà sorti du compte). Un cap Math.max(0,…) rompt
  // l'invariant comptable NAV − Net Déployé = P&L Réalisé + P&L Non Réalisé,
  // car le gain réalisé reste dans combinedRealizedPL mais disparaît du total
  // déposé. Voir BUG_TRACKER.md §BUG-014.
  //
  // Avant v280 : chaque plateforme avait son propre filter+reduce inline, et
  // Degiro avait en plus un cap défensif Math.max(0,…) introduit en v271 pour
  // patcher BUG-002 — mais ce patch a créé BUG-014. Centraliser via ce helper
  // élimine la duplication et empêche une asymétrie future.
  const netDeposits = (platform) =>
    depositHistory
      .filter(d => d.platform === platform)
      .reduce((s, d) => s + d.amountEUR, 0);

  const ibkrDepositsTotal = netDeposits('IBKR');
  const esppDeposits      = netDeposits('ESPP (UBS)');
  const sgtmDepositsEUR   = netDeposits('Attijari (SGTM)');
  const degiroDepositsNet = netDeposits('Degiro'); // négatif attendu (compte clôturé à profit)
  const degiroDepositsTotal = degiroDepositsNet;   // alias rétro-compatible pour la suite du fichier

  // Pour diagnostics / tooltip détaillé
  const degiroDepositsGross = depositHistory
    .filter(d => d.platform === 'Degiro' && d.amountEUR > 0)
    .reduce((s, d) => s + d.amountEUR, 0);
  const degiroWithdrawals = depositHistory
    .filter(d => d.platform === 'Degiro' && d.amountEUR < 0)
    .reduce((s, d) => s + d.amountEUR, 0);

  const totalDeposits = ibkrDepositsTotal + degiroDepositsTotal + esppDeposits + sgtmDepositsEUR;

  // Cross-platform combined unrealized P/L (includes SGTM)
  // SGTM: use historical FX at IPO date (10.8 MAD/EUR) for cost basis
  const sgtmTotalShares = (portfolio.amine.sgtm.shares || 0) + (portfolio.nezha.sgtm?.shares || 0);
  const sgtmCostMAD = sgtmTotalShares * (m.sgtmCostBasisMAD || 420);
  const sgtmHistFx = 10.8;  // EUR/MAD at IPO (Dec 2025)
  const sgtmCostEUR_hist = sgtmCostMAD / sgtmHistFx;
  const sgtmCostEUR = toEUR(sgtmCostMAD, 'MAD', fx);  // current FX (for reference)
  const sgtmUnrealizedPL = (amineSgtm + nezhaSgtm) - sgtmCostEUR_hist;
  const sgtmFxPL = sgtmCostEUR - sgtmCostEUR_hist;  // FX impact on SGTM
  const sgtmStockPL = sgtmUnrealizedPL - sgtmFxPL;
  const combinedUnrealizedPL = totalUnrealizedPL + esppUnrealizedPL + nezhaEsppUnrealizedPL + sgtmUnrealizedPL;

  // Cross-platform total current value (IBKR + ESPP + SGTM)
  const totalCurrentValue = ibkrNAV + amineEspp + nezhaEspp + amineSgtm + nezhaSgtm;

  // ── Compute P&L of CLOSED positions per period ──
  // Date strings for period boundaries (same as computeIBKRPositions)
  const _now = new Date();
  const _pad2 = n => String(n).padStart(2, '0');
  const ytdStartStr = _now.getFullYear() + '-01-01';
  const mtdStartStr = _now.getFullYear() + '-' + _pad2(_now.getMonth() + 1) + '-01';
  const todayStr = _now.getFullYear() + '-' + _pad2(_now.getMonth() + 1) + '-' + _pad2(_now.getDate());
  const _oneMonthAgo = new Date(_now.getFullYear(), _now.getMonth() - 1, _now.getDate());
  const oneMonthStr = _oneMonthAgo.getFullYear() + '-' + _pad2(_oneMonthAgo.getMonth() + 1) + '-' + _pad2(_oneMonthAgo.getDate());
  // 1Y = same day last year
  const _oneYearAgo = new Date(_now.getFullYear() - 1, _now.getMonth(), _now.getDate());
  const oneYearStr = _oneYearAgo.getFullYear() + '-' + _pad2(_oneYearAgo.getMonth() + 1) + '-' + _pad2(_oneYearAgo.getDate());
  // ═══════════════════════════════════════════════════════════════════
  // UNIFIED PERIOD P&L ENGINE
  // Même algorithme pour les 5 KPIs (Daily, MTD, 1M, YTD, 1Y)
  // Toutes les métriques sont calculées DYNAMIQUEMENT depuis les trades
  // ═══════════════════════════════════════════════════════════════════
  const ibkrSellTrades = (ibkr.trades || []).filter(t => t.type === 'sell' && t.source === 'ibkr');
  const _allIbkrTrades = ibkr.trades || [];
  const openTickers = new Set(ibkr.positions.map(p => p.ticker));
  const oneYearAgoPrices = m.oneYearAgoPrices || {};
  const fxOneYearAgo = m.fxOneYearAgo || {};

  // Check if a position existed (had buys) BEFORE a given date
  function _tickerExistedBefore(ticker, periodStart) {
    return _allIbkrTrades.some(t => t.ticker === ticker && t.type === 'buy' && t.date < periodStart);
  }

  // ── Unified closedPeriodPL ──
  // For positions FULLY SOLD during the period:
  //   - If position existed BEFORE period start → P&L = proceeds - refVal
  //   - If position bought WITHIN period → P&L = realizedPL (proceeds - cost)
  function closedPeriodPL(periodStartDate, getRefPrice) {
    let total = 0;
    const items = [];
    ibkrSellTrades.forEach(t => {
      if (t.date >= periodStartDate && !openTickers.has(t.ticker)) {
        const existed = _tickerExistedBefore(t.ticker, periodStartDate);
        const refPrice = existed ? getRefPrice(t.ticker) : 0;
        let pl = 0;
        if (refPrice && refPrice > 0) {
          const refVal = toEUR(t.qty * refPrice, t.currency, fx);
          const proceedsEUR = toEUR(t.proceeds, t.currency, fx);
          pl = proceedsEUR - refVal;
        } else if (typeof t.realizedPL === 'number') {
          pl = toEUR(t.realizedPL, t.currency, fx);
        }
        if (pl !== 0) {
          total += pl;
          items.push({ ticker: t.ticker, label: t.label || t.ticker, date: t.date, pl, qty: t.qty, proceeds: t.proceeds, currency: t.currency });
        }
      }
    });
    return { total, items };
  }

  // ═══════════════════════════════════════════════════════════════════
  // DYNAMIC COST COMPUTATIONS — aucune valeur hardcodée
  // ═══════════════════════════════════════════════════════════════════

  // ── FTT (Taxe sur les Transactions Financières) ──
  // 0.4% sur les achats de stocks français large-cap (AMF TTF list)
  // Source: relevé IBKR "Transaction Fees" — vérifié vs statement U18138426
  // Inclut: MC, DG, FGR, GLE, SAN, EDEN, RMS, OR, BN, WLN, AIR (Airbus HQ NL mais coté Euronext Paris)
  const FTT_ELIGIBLE = new Set(['MC.PA','DG.PA','FGR.PA','GLE','SAN.PA','EDEN','RMS.PA','OR.PA','BN.PA','WLN','AIR.PA']);
  const FTT_RATE = 0.004; // 0.4% — taux facturé par IBKR (vérifié sur statement)
  function computeFTT(startDate) {
    let total = 0;
    const items = [];
    _allIbkrTrades.forEach(t => {
      if (t.type === 'buy' && t.date >= startDate && FTT_ELIGIBLE.has(t.ticker)) {
        const ftt = (t.cost || 0) * FTT_RATE;
        total += ftt;
        items.push({ ticker: t.ticker, label: 'FTT ' + (t.label || t.ticker), date: t.date, cost: t.cost, ftt });
      }
    });
    return { total: -total, items }; // negative = cost
  }

  // ── Commissions dynamiques ──
  // Calculées depuis t.commission sur chaque trade (frais courtier uniquement, PAS FTT)
  // IMPORTANT: t.commission est en devise native du trade (EUR, USD, JPY)
  // → conversion en EUR nécessaire pour éviter de sommer des devises différentes
  // Bug corrigé: ¥871.60 (Shiseido) était compté comme €871.60 → faussait le total
  function computeCommissions(startDate) {
    let total = 0;
    const items = [];
    _allIbkrTrades.forEach(t => {
      if (t.date >= startDate && t.commission) {
        const eurComm = toEUR(t.commission, t.currency || 'EUR', fx);
        total += eurComm;
        items.push({ ticker: t.ticker, label: (t.type === 'buy' ? 'Achat' : 'Vente') + ' ' + (t.label || t.ticker), date: t.date, amount: eurComm });
      }
    });
    return { total, items };
  }

  // ── Intérêts marge dynamiques ──
  // Source : ibkr.costs[] (type: 'interest') dans data.js
  const ibkrCosts = ibkr.costs || [];
  function computeInterest(startDate) {
    let eurTotal = 0;
    const items = [];
    ibkrCosts.filter(c => c.type === 'interest' && c.date >= startDate).forEach(c => {
      const eur = (c.eurAmount || 0);
      const usd = toEUR(c.usdAmount || 0, 'USD', fx);
      const jpy = toEUR(c.jpyAmount || 0, 'JPY', fx);
      const amount = eur + usd + jpy;
      eurTotal += amount;
      items.push({ label: c.label, date: c.date, amount, eurAmount: c.eurAmount, usdAmount: c.usdAmount, jpyAmount: c.jpyAmount });
    });
    return { total: eurTotal, items };
  }

  // ── Dividendes IBKR dynamiques ──
  // Source : ibkr.costs[] (type: 'dividend') dans data.js
  function computeIBKRDividends(startDate) {
    let total = 0;
    const items = [];
    ibkrCosts.filter(c => c.type === 'dividend' && c.date >= startDate).forEach(c => {
      const amount = c.eurAmount || 0;
      total += amount;
      items.push({ ticker: c.ticker, label: c.label, date: c.date, amount });
    });
    return { total, items };
  }

  // ── Dividendes ACN/ESPP dynamiques ──
  // Calcul: perShareUSD × nb_actions_détenues_à_exDate × (1 - 15% WHT)
  // Le nombre d'actions dépend des lots ESPP acquis avant la exDate
  const acnDividends = ibkr.acnDividends || [];
  const amineEsppLots = (espp.lots || []).map(l => ({ ...l })).sort((a, b) => a.date.localeCompare(b.date));
  const nezhaEsppLots = (nezhaEsppData.lots || []).map(l => ({ ...l })).sort((a, b) => a.date.localeCompare(b.date));
  function sharesAtDate(lots, date) {
    return lots.filter(l => l.date <= date).reduce((s, l) => s + l.shares, 0);
  }
  function computeACNDividends(startDate) {
    let total = 0;
    const items = [];
    const WHT_RATE = 0.15; // 15% withholding tax US→FR (W-8BEN treaty rate)
    acnDividends.filter(d => d.payDate >= startDate).forEach(d => {
      const amineShares = sharesAtDate(amineEsppLots, d.exDate);
      const nezhaShares = sharesAtDate(nezhaEsppLots, d.exDate);
      const totalShares = amineShares + nezhaShares;
      if (totalShares > 0) {
        const grossUSD = d.perShareUSD * totalShares;
        const netUSD = grossUSD * (1 - WHT_RATE);
        // Use historical FX rate at pay date if available, otherwise current rate
        // This avoids showing identical EUR amounts for different quarters
        const fxForConversion = d.fxEURUSD ? { ...fx, USD: d.fxEURUSD } : fx;
        const netEUR = toEUR(netUSD, 'USD', fxForConversion);
        total += netEUR;
        items.push({ date: d.payDate, label: 'Div ACN (' + totalShares + ' sh)', grossUSD, netUSD, netEUR, wht: grossUSD * WHT_RATE });
      }
    });
    return { total, items };
  }

  // ── Degiro historical dividends (from annual reports) ──
  function computeDegiroDividends(startDate) {
    const degiroDivs = (portfolio.amine.degiro || {}).dividends || {};
    let total = 0;
    const items = [];
    Object.entries(degiroDivs).forEach(([year, yearData]) => {
      if (!yearData || !yearData.net) return;
      // Use Dec 31 of each year as proxy date (dividends paid throughout year)
      const proxyDate = year + '-12-31';
      if (proxyDate < startDate) return;
      total += yearData.net;
      items.push({ date: proxyDate, label: 'Div Degiro ' + year + ' (net)', netEUR: yearData.net, grossEUR: yearData.gross, wht: yearData.withholding });
    });
    return { total, items };
  }

  // ── Aggregate all costs per period ──
  function computeAllCosts(startDate) {
    const ftt = computeFTT(startDate);
    const comm = computeCommissions(startDate);
    const interest = computeInterest(startDate);
    const ibkrDiv = computeIBKRDividends(startDate);
    const acnDiv = computeACNDividends(startDate);
    const degiroDiv = computeDegiroDividends(startDate);
    const totalDividends = ibkrDiv.total + acnDiv.total + degiroDiv.total;
    return {
      fttEUR: ftt.total,
      fttItems: ftt.items,
      commissionsEUR: comm.total,
      commissionsItems: comm.items,
      interestEUR: interest.total,
      interestItems: interest.items,
      dividendsEUR: totalDividends,
      ibkrDivItems: ibkrDiv.items,
      acnDivItems: acnDiv.items,
      degiroDivItems: degiroDiv.items,
    };
  }

  // ── Degiro P&L per period (only relevant for 1Y — Degiro closed April 2025) ──
  const _allTradesUnified = portfolio.amine.allTrades || [];
  function degiroPeriodPL(periodStartDate) {
    const sells = _allTradesUnified.filter(t =>
      t.source === 'degiro' && t.type === 'sell' && t.date >= periodStartDate
    );
    let total = 0;
    const items = [];
    sells.forEach(t => {
      const refPrice = oneYearAgoPrices[t.ticker];
      if (refPrice && refPrice > 0) {
        const fxOld = fxOneYearAgo[t.currency] || fx[t.currency] || 1;
        const startValEUR = t.qty * refPrice / fxOld;
        const proceedsEUR = toEUR(t.proceeds, t.currency, fx);
        const pl = proceedsEUR - startValEUR;
        total += pl;
        items.push({ label: t.label + ' (Degiro)', ticker: t.ticker, pl, valEUR: proceedsEUR, _isDegiro: true });
      }
    });
    return { total, items };
  }

  // ── Ref price lookup builders ──
  const ytdOpenPrices = {};
  ibkr.positions.forEach(p => { ytdOpenPrices[p.ticker] = p.ytdOpen; });
  ibkrSellTrades.forEach(t => {
    if (!ytdOpenPrices[t.ticker]) ytdOpenPrices[t.ticker] = t.costBasis || 0;
  });

  function getRefPrice(ticker, periodKey) {
    const pos = ibkr.positions.find(p => p.ticker === ticker);
    switch (periodKey) {
      case 'daily':    return pos ? pos.previousClose : 0;
      case 'mtd':      return pos ? pos.mtdOpen : (ytdOpenPrices[ticker] || 0);
      case 'oneMonth': return pos ? pos.oneMonthAgo : (ytdOpenPrices[ticker] || 0);
      case 'ytd':      return ytdOpenPrices[ticker] || 0;
      case 'oneYear':  return oneYearAgoPrices[ticker] || 0;
      default:         return 0;
    }
  }

  // ── Pre-compute closed P&L for each period ──
  const closedDaily    = closedPeriodPL(todayStr,     t => getRefPrice(t, 'daily'));
  const closedMtd      = closedPeriodPL(mtdStartStr,  t => getRefPrice(t, 'mtd'));
  const closedOneMonth = closedPeriodPL(oneMonthStr,  t => getRefPrice(t, 'oneMonth'));
  const closedYtd      = closedPeriodPL(ytdStartStr,  t => getRefPrice(t, 'ytd'));
  const closedOneYear  = closedPeriodPL(oneYearStr,   t => getRefPrice(t, 'oneYear'));

  // ── Pre-compute costs for each period ──
  const costsDaily    = computeAllCosts(todayStr);
  const costsMtd      = computeAllCosts(mtdStartStr);
  const costsOneMonth = computeAllCosts(oneMonthStr);
  const costsYtd      = computeAllCosts(ytdStartStr);
  const costsOneYear  = computeAllCosts(oneYearStr);
  const costsAllTime  = computeAllCosts('2000-01-01');

  // v246: Adjust combinedRealizedPL to include IBKR dividends and costs
  // so that (unrealized + realized) ≈ chart P&L (NAV - deposits)
  // Note: Degiro dividends/costs are already in degiroRealizedPL (via totalPLAllComponents)
  // Only add IBKR+ACN dividends and subtract IBKR costs (commissions, FTT, interest)
  const ibkrDividendsAllTime = costsAllTime.ibkrDivItems.reduce((s, d) => s + d.amount, 0);
  const acnDividendsAllTime  = costsAllTime.acnDivItems.reduce((s, d) => s + d.netEUR, 0);
  combinedRealizedPL += ibkrDividendsAllTime + acnDividendsAllTime
                      + costsAllTime.commissionsEUR   // negative = cost
                      + costsAllTime.fttEUR            // negative = cost
                      + costsAllTime.interestEUR;      // negative = cost

  // v280 (BUG-014): Invariant comptable
  //   NAV − Net Déployé ≈ Realized P&L + Unrealized P&L
  // Tolérance ±€10K pour absorber résiduels attendus :
  //   - FX drift multi-année (dépôts convertis au taux historique vs. NAV
  //     live au taux du jour, accumulé sur 6+ ans IBKR et Degiro)
  //   - Résidus dividendes/commissions pré-refactor
  //   - Arrondis historiques sur lots ESPP fallback (Nezha sans contribEUR)
  // Si ça diverge au-delà, un Math.max(0,…), un oubli de plateforme ou une
  // asymétrie de comptabilisation vient d'être introduit — même philosophie
  // que le `plDelta` check ligne ~772. Seuil à resserrer quand la couverture
  // FX historique aura été nettoyée.
  {
    const lhs = totalCurrentValue - totalDeposits;
    const rhs = combinedRealizedPL + combinedUnrealizedPL;
    const balanceDelta = lhs - rhs;
    const BALANCE_TOLERANCE = 10000;
    if (Math.abs(balanceDelta) > BALANCE_TOLERANCE) {
      console.warn(
        '[engine] ⚠ Accounting imbalance Δ =', balanceDelta.toFixed(2),
        '| NAV−Déposé:', lhs.toFixed(2),
        '| Realized+Unrealized:', rhs.toFixed(2),
        '| totalDeposits:', totalDeposits.toFixed(2),
        '(IBKR:', ibkrDepositsTotal.toFixed(0),
        '| ESPP:', esppDeposits.toFixed(0),
        '| SGTM:', sgtmDepositsEUR.toFixed(0),
        '| Degiro:', degiroDepositsNet.toFixed(0), ')'
      );
    } else {
      console.log(
        '[engine] Accounting balanced ✓ Δ =', balanceDelta.toFixed(2),
        '(NAV−Déposé:', lhs.toFixed(0),
        '≈ Realized+Unrealized:', rhs.toFixed(0), ')'
      );
    }
  }

  // ── Degiro 1Y (only period with Degiro activity) ──
  const degiro1Y = degiroPeriodPL(oneYearStr);

  // Pre-compute YTD P&L for benchmark comparison
  // IBKR only — now includes closed positions P&L
  const ibkrYtdPL = ibkrPositions.reduce((s, p) => s + (p.ytdPL || 0), 0) + closedYtd.total;
  const ibkrStartOfYear = totalPositionsVal - ibkrYtdPL;
  const ibkrYtdPct = ibkrStartOfYear > 0 ? (ibkrYtdPL / ibkrStartOfYear * 100) : 0;
  // Total portfolio (IBKR + ESPP Amine + ESPP Nezha + SGTM)
  const _acnYtdOpen = m.acnYtdOpen || 0;
  const _esppYtdPL = _acnYtdOpen > 0 ? esppCurrentVal - (espp.shares * _acnYtdOpen / (fx.USD || 1)) : 0;
  const _nezhaEsppYtdPL = (_acnYtdOpen > 0 && nezhaEsppShares > 0) ? nezhaEsppCurrentVal - (nezhaEsppShares * _acnYtdOpen / (fx.USD || 1)) : 0;
  const totalYtdPL = ibkrYtdPL + _esppYtdPL + _nezhaEsppYtdPL; // SGTM has no YTD ref price
  const totalStartOfYear = totalStocks - totalYtdPL;
  const totalYtdPct = totalStartOfYear > 0 ? (totalYtdPL / totalStartOfYear * 100) : 0;

  // --- Investment Insights ---
  const insights = [];

  // 1. Stock picking track record
  // Combine all trades from unified allTrades[] + ibkr.trades[] into one list
  const ibkrTrades = ibkr.trades || [];
  const allTradesUnified = [...ibkrTrades, ...(portfolio.amine.allTrades || [])];
  // Aggregate sells by ticker+source for total P/L per closed position
  const byTickerSource = {};
  allTradesUnified.filter(t => t.type === 'sell').forEach(t => {
    const key = (t.source || 'ibkr') + ':' + t.ticker;
    if (!byTickerSource[key]) byTickerSource[key] = { ticker: t.ticker, label: t.label, pl: 0, costEUR: 0, proceedsEUR: 0, currency: t.currency, sells: 0, source: t.source || 'ibkr', _trades: [], _hasReportPL: false, _reportPLCount: 0 };
    if (typeof t.realizedPL === 'number') { byTickerSource[key]._hasReportPL = true; byTickerSource[key]._reportPLCount++; }
    // Convert realizedPL/cost/proceeds to EUR (QQQM etc. are in USD)
    byTickerSource[key].pl += toEUR(t.realizedPL || 0, t.currency, fx);
    byTickerSource[key].costEUR += toEUR(t.cost || 0, t.currency, fx);
    byTickerSource[key].proceedsEUR += toEUR(t.proceeds || 0, t.currency, fx);
    byTickerSource[key].sells++;
    byTickerSource[key].lastDate = t.date;
    byTickerSource[key]._trades.push(t);
    // Keep most recent label (post-split label wins over pre-split)
    if (!byTickerSource[key].lastDate || t.date >= byTickerSource[key].lastDate) byTickerSource[key].label = t.label;
  });
  // Enrich with buy trades + "what if I held" current value
  Object.values(byTickerSource).forEach(cp => {
    // Gather all trades (buy + sell) for this ticker+source
    const allForTicker = allTradesUnified.filter(t => t.ticker === cp.ticker && (t.source || 'ibkr') === cp.source);
    cp._allTrades = allForTicker.sort((a, b) => a.date.localeCompare(b.date));
    // Accumulate cost from buy trades (sell trades have cost:''), converted to EUR
    cp.costEUR = allForTicker.filter(t => t.type === 'buy').reduce((s, t) => s + toEUR(t.cost || 0, t.currency, fx), 0);
    // Fallback cost when no buy entries exist:
    // 1) Use cost field from sell entries (filled from proceeds-PL for EUR, or matched buys for USD)
    // 2) Derive from proceedsEUR - pl (when report P/L is available and proceeds known)
    if (cp.costEUR === 0) {
      const sellCost = allForTicker.filter(t => t.type === 'sell').reduce((s, t) => s + toEUR(t.cost || 0, t.currency, fx), 0);
      if (sellCost > 0) {
        cp.costEUR = sellCost;
      } else if (cp._hasReportPL && cp.proceedsEUR > 0) {
        cp.costEUR = cp.proceedsEUR - cp.pl;
      }
    }
    // Compute P/L:
    // For Degiro: use authoritative perInstrumentPL data (from verified annual reports)
    // For IBKR: use summed report PL if all sells covered, else proceeds-cost fallback
    if (cp.source === 'degiro' && degiroPerTickerPL[cp.ticker] !== undefined) {
      // Authoritative P/L from Degiro annual reports — verified against PDFs
      cp.pl = degiroPerTickerPL[cp.ticker];
      cp._hasReportPL = true;
      // Derive cost if missing: cost = proceeds - P/L
      if (cp.costEUR === 0 && cp.proceedsEUR > 0) {
        cp.costEUR = cp.proceedsEUR - cp.pl;
      }
    } else {
      const allSellsCoveredByReport = cp._hasReportPL && cp._reportPLCount === cp.sells;
      if (allSellsCoveredByReport) {
        // cp.pl already correct from summing EUR-converted realizedPL during aggregation
      } else if (cp.costEUR > 0) {
        cp.pl = cp.proceedsEUR - cp.costEUR; // both already in EUR
      }
    }
    // Total qty sold (adjusted for stock splits: qty * splitFactor for pre-split trades)
    const totalQtySoldAdj = allForTicker.filter(t => t.type === 'sell').reduce((s, t) => s + (t.qty || 0) * (t.splitFactor || 1), 0);
    // "What if I held": look up current live price for this ticker
    // Priority: 1) live position in IBKR (exact or with .PA suffix), 2) sold stock prices from background fetch
    const livePos = ibkrPositions.find(p => p.ticker === cp.ticker)
      || ibkrPositions.find(p => p.ticker === cp.ticker + '.PA');
    const soldPrices = portfolio._soldPrices || {};
    if (livePos && totalQtySoldAdj > 0) {
      cp._ifHeldPriceEUR = livePos.valEUR / livePos.shares; // EUR per share (post-split price)
      cp._ifHeldValueEUR = totalQtySoldAdj * cp._ifHeldPriceEUR;
      cp._ifHeldPL = cp._ifHeldValueEUR - cp.costEUR;
    } else if (soldPrices[cp.ticker] && totalQtySoldAdj > 0) {
      // Use background-fetched sold stock price (post-split price from Yahoo)
      const sp = soldPrices[cp.ticker];
      const cur = cp._allTrades.length > 0 ? cp._allTrades[0].currency : 'EUR';
      const priceEUR = cur === 'USD' ? sp.price / fx.USD : cur === 'JPY' ? sp.price / fx.JPY : sp.price;
      cp._ifHeldPriceEUR = priceEUR;
      cp._ifHeldValueEUR = totalQtySoldAdj * priceEUR;
      cp._ifHeldPL = cp._ifHeldValueEUR - cp.costEUR;
    } else if (DEGIRO_STATIC_PRICES[cp.ticker] && totalQtySoldAdj > 0) {
      // Fallback: static prices from data.js (before API fetch completes)
      const sp = DEGIRO_STATIC_PRICES[cp.ticker];
      const priceEUR = sp.currency === 'USD' ? sp.price / fx.USD : sp.currency === 'JPY' ? sp.price / fx.JPY : sp.price;
      cp._ifHeldPriceEUR = priceEUR;
      cp._ifHeldValueEUR = totalQtySoldAdj * priceEUR;
      cp._ifHeldPL = cp._ifHeldValueEUR - cp.costEUR;
      cp._staticPrice = true; // flag for render to show "static" indicator
    }
  });
  const allClosed = Object.values(byTickerSource);
  const ibkrOnlyClosed = allClosed.filter(p => p.source === 'ibkr');
  const degiroOnlyClosed = allClosed.filter(p => p.source === 'degiro');
  // Sanity check: table P/L should match card combinedRealizedPL
  const tableTotalPL = allClosed.reduce((s, p) => s + (p.pl || 0), 0);
  const plDelta = Math.abs(tableTotalPL - combinedRealizedPL);
  if (plDelta > 1) {
    console.warn('[engine] P/L alignment delta:', plDelta.toFixed(2), '| table:', tableTotalPL.toFixed(2), '| card:', combinedRealizedPL.toFixed(2));
  } else {
    console.log('[engine] P/L aligned ✓ table:', tableTotalPL.toFixed(2), '≈ card:', combinedRealizedPL.toFixed(2));
  }
  // For Track Record: only count trades with known P/L
  // Include if: (a) has report-based realizedPL, OR (b) has both buy cost and sell proceeds (can compute P/L)
  // Exclude: sell-only trades from 2020/2025 with no report data and no buy cost
  const withKnownPL = allClosed.filter(p => p._hasReportPL || (p.costEUR > 0 && p.proceedsEUR > 0));
  const winners = withKnownPL.filter(p => p.pl > 0);
  const losers = withKnownPL.filter(p => p.pl < 0);
  const winRate = withKnownPL.length > 0 ? (winners.length / withKnownPL.length * 100) : 0;
  const totalWins = winners.reduce((s, p) => s + p.pl, 0);
  const totalLosses = Math.abs(losers.reduce((s, p) => s + p.pl, 0));
  insights.push({
    type: 'track-record',
    title: 'Track Record Stock Picking',
    winRate: winRate,
    winners: winners.length,
    losers: losers.length,
    totalTrades: withKnownPL.length,
    totalWins: totalWins,
    totalLosses: totalLosses,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : Infinity,
    topWin: winners.length > 0 ? winners.sort((a, b) => b.pl - a.pl)[0] : null,
    topLoss: losers.length > 0 ? losers.sort((a, b) => a.pl - b.pl)[0] : null,
  });

  // 2. Concentration risk — top 3 positions weight
  const sortedByWeight = [...ibkrPositions].sort((a, b) => b.valEUR - a.valEUR);
  const top3Val = sortedByWeight.slice(0, 3).reduce((s, p) => s + p.valEUR, 0);
  const top3Pct = totalPositionsVal > 0 ? top3Val / totalPositionsVal * 100 : 0;
  insights.push({
    type: 'concentration',
    title: 'Concentration du Portefeuille',
    top3: sortedByWeight.slice(0, 3).map(p => ({ label: p.label, pct: (p.valEUR / totalPositionsVal * 100) })),
    top3Pct: top3Pct,
    totalPositions: ibkrPositions.length,
  });

  // 3. Losers currently in portfolio
  const currentLosers = ibkrPositions.filter(p => p.pctPL < -10).sort((a, b) => a.pctPL - b.pctPL);
  if (currentLosers.length > 0) {
    insights.push({
      type: 'underperformers',
      title: 'Positions en Souffrance (> -10%)',
      positions: currentLosers.map(p => ({ label: p.label, pctPL: p.pctPL, unrealizedPL: p.unrealizedPL, valEUR: p.valEUR })),
      totalLossEUR: currentLosers.reduce((s, p) => s + p.unrealizedPL, 0),
    });
  }

  // 4. Geo diversification assessment
  const totalGeo = Object.values(geoAllocation).reduce((s, v) => s + v, 0);
  const francePct = totalGeo > 0 ? ((geoAllocation.france || 0) / totalGeo * 100) : 0;
  insights.push({
    type: 'geo',
    title: 'Diversification G\u00e9ographique',
    francePct: francePct,
    usPct: totalGeo > 0 ? ((geoAllocation.us || 0) / totalGeo * 100) : 0,
    cryptoPct: totalGeo > 0 ? ((geoAllocation.crypto || 0) / totalGeo * 100) : 0,
    emergingPct: totalGeo > 0 ? (((geoAllocation.morocco || 0) + (geoAllocation.japan || 0)) / totalGeo * 100) : 0,
  });

  // 5. Cost efficiency
  const commissions = Math.abs(meta.commissions || 0);
  const commPct = totalPositionsVal > 0 ? commissions / totalPositionsVal * 100 : 0;
  insights.push({
    type: 'costs',
    title: 'Co\u00fbts & Efficience',
    commissions: commissions,
    commPct: commPct,
    dividends: meta.dividends || 0,
    divYield: totalPositionsVal > 0 ? ((meta.dividends || 0) / totalPositionsVal * 100) : 0,
  });

  // Pre-compute JPY debt for use in recommendations + macro risks
  const jpyDebtEUR = Math.abs(toEUR(ibkr.cashJPY, 'JPY', fx));

  // 6. Strategic recommendation — 100% dynamique
  // Toutes les recommandations sont générées à partir des données réelles du portefeuille
  const recs = [];
  const recTWR = meta.twr || 0; // overridden by window._chartKPIData?.twr in render.js

  // --- Points positifs (dynamiques) ---
  const positives = [];
  if (combinedRealizedPL > 0) positives.push('P/L réalisé cumulé ' + (combinedRealizedPL >= 0 ? '+' : '') + '€' + Math.round(Math.abs(combinedRealizedPL)).toLocaleString('fr-FR') + ' — historique rentable');
  if (winRate > 55) positives.push('Win rate de ' + winRate.toFixed(0) + '% — bon flair de sélection');
  if (totalWins > 0 && totalLosses > 0) {
    const pf = totalWins / totalLosses;
    if (pf > 2) positives.push('Profit factor ' + pf.toFixed(1) + 'x — les gains dominent largement les pertes');
  }
  const divYield = totalPositionsVal > 0 ? ((meta.dividends || 0) / totalPositionsVal * 100) : 0;
  if (divYield > 1.5) positives.push('Rendement dividendes ' + divYield.toFixed(1) + '% — flux de revenus récurrent');
  if (combinedUnrealizedPL > 0) positives.push('Plus-value latente +€' + Math.round(combinedUnrealizedPL).toLocaleString('fr-FR') + ' — portefeuille en territoire positif');

  // --- Alertes performance (dynamiques) ---
  const alerts = [];
  // Identify biggest detractors dynamically
  const bigLosers = ibkrPositions.filter(p => p.unrealizedPL < -500).sort((a, b) => a.unrealizedPL - b.unrealizedPL);
  const bigLoserNames = bigLosers.slice(0, 3).map(p => p.label + ' (' + Math.round(p.unrealizedPL).toLocaleString('fr-FR') + '€)');
  if (bigLosers.length > 0) {
    alerts.push('Principaux détracteurs : ' + bigLoserNames.join(', '));
  }

  // --- Axes d'amélioration (100% data-driven) ---

  // a) Geo concentration
  const usPct = totalGeo > 0 ? ((geoAllocation.us || 0) / totalGeo * 100) : 0;
  const europePct = totalGeo > 0 ? (((geoAllocation.france || 0) + (geoAllocation.europe || 0)) / totalGeo * 100) : 0;
  if (francePct > 40) {
    recs.push({ priority: 1, icon: '🌍', title: 'Réduire le biais France (' + francePct.toFixed(0) + '%)',
      detail: 'Allouer davantage en ETF World (IWDA/VWCE) pour capturer la croissance US/Asie. Cible : France < 30%.' });
  } else if (europePct > 60) {
    recs.push({ priority: 1, icon: '🌍', title: 'Diversifier hors Europe (' + europePct.toFixed(0) + '% Europe)',
      detail: 'Exposition Europe élevée. Renforcer l\'exposition US/Asie via ETFs internationaux.' });
  }

  // b) Number of positions vs portfolio size
  const nbPositions = ibkrPositions.length;
  if (nbPositions > 12) {
    const costTotal = Math.abs(costsAllTime.commissionsEUR) + costsAllTime.fttEUR;
    recs.push({ priority: 2, icon: '🎯', title: 'Trop de lignes (' + nbPositions + ' positions)',
      detail: nbPositions + ' positions génèrent des frais (€' + Math.round(costTotal).toLocaleString('fr-FR') + ' cumulés) et du stress. Un cœur ETF (80%) + satellites stock picking (20%) serait plus efficace.' });
  }

  // c) DCA opportunity
  const avgTradesPerMonth = withKnownPL.length > 0 ? (withKnownPL.length / ((new Date().getFullYear() - 2020 + 1) * 12)) : 0;
  if (avgTradesPerMonth < 1) {
    recs.push({ priority: 3, icon: '📅', title: 'Stratégie DCA',
      detail: 'Automatiser des versements mensuels sur 2-3 ETFs plutôt que du timing de marché. Régularité > timing.' });
  }

  // d) Dead positions
  if (currentLosers.length > 2) {
    const deadVal = currentLosers.reduce((s, p) => s + Math.abs(p.unrealizedPL), 0);
    recs.push({ priority: 2, icon: '✂️', title: 'Couper les positions mortes (' + currentLosers.length + ' à -10%+)',
      detail: '€' + Math.round(deadVal).toLocaleString('fr-FR') + ' de perte latente sur ces positions. Évaluer si la thèse d\'investissement tient toujours pour chacune.' });
  }

  // e) Gold exposure check
  const hasGold = ibkrPositions.some(p => ['GLD', 'SGOL', 'IAU', 'GOLD', 'PHAU'].includes(p.ticker));
  if (!hasGold) {
    recs.push({ priority: 3, icon: '🥇', title: 'Zéro exposition Or',
      detail: 'Aucune couverture or dans le portefeuille. Considérer GLD/SGOL (5-10%) comme hedge géopolitique et inflation.' });
  }

  // f) Tech US exposure check
  const techUSTickers = ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'QQQ', 'VGT'];
  const hasTechUS = ibkrPositions.some(p => techUSTickers.includes(p.ticker));
  const techUSPct = totalGeo > 0 ? (ibkrPositions.filter(p => techUSTickers.includes(p.ticker)).reduce((s, p) => s + p.valEUR, 0) / totalGeo * 100) : 0;
  if (!hasTechUS || techUSPct < 5) {
    recs.push({ priority: 3, icon: '💻', title: 'Peu/pas de tech US directe' + (techUSPct > 0 ? ' (' + techUSPct.toFixed(0) + '%)' : ''),
      detail: 'Manque d\'exposition aux Magnificent 7 / GAFAM. Considérer un ETF Nasdaq (QQQ/EQQQ) ou S&P 500 Tech.' });
  }

  // g) Cash drag — too much cash vs portfolio
  const cashPct = ibkrCashTotal > 0 && ibkrNAV > 0 ? (ibkrCashTotal / ibkrNAV * 100) : 0;
  if (cashPct > 15) {
    recs.push({ priority: 1, icon: '💰', title: 'Cash élevé (' + cashPct.toFixed(0) + '% du portefeuille)',
      detail: '€' + Math.round(ibkrCashTotal).toLocaleString('fr-FR') + ' non investis. Ce cash ne travaille pas — déployer progressivement en DCA.' });
  }

  // h) Currency risk — JPY debt
  if (jpyDebtEUR > 5000) {
    recs.push({ priority: 2, icon: '💴', title: 'Risque carry trade JPY (€' + Math.round(jpyDebtEUR).toLocaleString('fr-FR') + ')',
      detail: 'Si le yen se renforce (flight-to-safety), la dette en EUR augmente. Surveiller la BoJ.' });
  }

  // i) Crypto allocation check
  const cryptoVal = ibkrPositions.filter(p => (p.sector === 'crypto' || p.ticker === 'IBIT' || p.ticker === 'ETHA')).reduce((s, p) => s + p.valEUR, 0);
  const cryptoPctPortfolio = totalPositionsVal > 0 ? (cryptoVal / totalPositionsVal * 100) : 0;
  if (cryptoPctPortfolio > 15) {
    recs.push({ priority: 1, icon: '⚡', title: 'Crypto > 15% du portefeuille (' + cryptoPctPortfolio.toFixed(0) + '%)',
      detail: 'Volatilité extrême. Considérer un rééquilibrage pour limiter le risque crypto à 5-10%.' });
  }

  // j) Sector concentration
  const sectorEntries = Object.entries(sectorAllocation).sort((a, b) => b[1] - a[1]);
  const totalSectorVal = sectorEntries.reduce((s, [, v]) => s + v, 0);
  if (sectorEntries.length > 0 && totalSectorVal > 0) {
    const topSector = sectorEntries[0];
    const topSectorPct = topSector[1] / totalSectorVal * 100;
    if (topSectorPct > 35) {
      recs.push({ priority: 2, icon: '📊', title: 'Concentration sectorielle : ' + topSector[0] + ' (' + topSectorPct.toFixed(0) + '%)',
        detail: 'Plus d\'un tiers du portefeuille est dans un seul secteur. Diversifier pour réduire le risque spécifique.' });
    }
  }

  // Sort by priority
  recs.sort((a, b) => a.priority - b.priority);

  insights.push({
    type: 'recommendation',
    title: 'Recommandations Stratégiques',
    twr: recTWR,
    combinedRealizedPL: combinedRealizedPL,
    combinedUnrealizedPL: combinedUnrealizedPL,
    totalDeposits: totalDeposits,
    francePct: francePct,
    usPct: usPct,
    europePct: europePct,
    currentLosersCount: currentLosers.length,
    winRate: winRate,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : Infinity,
    nbPositions: nbPositions,
    cashPct: cashPct,
    cryptoPct: cryptoPctPortfolio,
    divYield: divYield,
    positives: positives,
    alerts: alerts,
    recommendations: recs,
  });

  // 7. Benchmark comparison (YTD 2026 — updated 21 mars 2026)
  // Sources : Yahoo Finance (clôture 20/03/2026)
  // Rendements USD convertis en EUR (EUR/USD passé de ~1.08 à 1.1575 = +7.2% appréciation EUR)
  const benchmarks = {
    date: '21 mars 2026',
    ibkr: { twr: meta.twr || 0, ytdPct: ibkrYtdPct, label: 'Portefeuille IBKR' }, // NOTE: twr overridden by window._chartKPIData?.twr in render.js
    total: { ytdPct: totalYtdPct, label: 'Portefeuille Total' },
    items: [
      { label: 'Or (XAU/USD)',       ytd: 61.0, note: '$4 575/oz — record, haven demand (Iran, tensions g\u00e9opolitiques)' },
      { label: 'MSCI World (EUR)',    ytd: 7.5,  note: 'URTH +14.7% USD, -7.2% FX = +7.5% en EUR' },
      { label: 'S&P 500',            ytd: -5.4, note: '6 506 pts — correction tech, vol \u00e9lev\u00e9e' },
      { label: 'CAC 40',             ytd: -10.7, note: '7 666 pts — stress g\u00e9opolitique, industrials sous pression' },
      { label: 'Bitcoin (BTC)',       ytd: -10.2, note: '~$70K — correction depuis $93K fin 2025' },
      { label: 'Immobilier mondial',  ytd: 2.0,   note: 'REIT stable, taux en d\u00e9tente partielle' },
      { label: 'Inflation (FR)',      ytd: 1.0,   note: 'IPC f\u00e9vrier 2026 = 1%/an' },
    ],
  };
  insights.push({
    type: 'benchmark',
    title: 'Performance vs Benchmarks (YTD 2026)',
    benchmarks: benchmarks,
  });

  // 8. Macro risk assessment
  const macroRisks = [];
  // Middle East conflict / energy
  macroRisks.push({
    severity: 'high',
    label: 'Conflit Iran / \u00c9nergie',
    detail: 'Frappes US/Isra\u00ebl sur l\u2019Iran, p\u00e9trole en hausse. Risque direct sur industrials (Airbus, Vinci, Eiffage = 40%+ du portefeuille). L\u2019or surperforme \u2014 aucune exposition or dans le portefeuille.',
  });
  // EUR/USD volatility impact on USD assets
  macroRisks.push({
    severity: 'medium',
    label: 'Volatilit\u00e9 EUR/USD',
    detail: 'EUR \u00e0 1.16 (+7% depuis d\u00e9but 2025). Les actifs USD (IBIT, ETHA, IBKR cash USD, ESPP) perdent en valeur EUR quand l\u2019euro se renforce. Exposition USD = ~30% du portefeuille actions.',
  });
  // Crypto drawdown
  if (ibkrPositions.some(p => p.ticker === 'IBIT' || p.ticker === 'ETHA')) {
    const cryptoLoss = ibkrPositions.filter(p => p.ticker === 'IBIT' || p.ticker === 'ETHA').reduce((s, p) => s + p.unrealizedPL, 0);
    macroRisks.push({
      severity: cryptoLoss < -5000 ? 'high' : 'medium',
      label: 'Drawdown Crypto',
      detail: 'BTC -25% YTD, ETH -33% YTD. Perte latente crypto : \u20ac' + Math.abs(Math.round(cryptoLoss)).toLocaleString('fr-FR') + '. Th\u00e8se long-terme intacte mais volatilit\u00e9 extr\u00eame.',
    });
  }
  // JPY carry trade risk (jpyDebtEUR pre-computed above)
  macroRisks.push({
    severity: jpyDebtEUR > 100000 ? 'high' : 'medium',
    label: 'Carry Trade JPY (\u00a5' + Math.round(Math.abs(ibkr.cashJPY)/1000000) + 'M)',
    detail: 'Emprunt JPY = \u20ac' + Math.round(jpyDebtEUR).toLocaleString('fr-FR') + '. Si le yen se renforce (flight-to-safety), la dette en EUR augmente. BoJ hawkish = risque de squeeze.',
  });
  // No gold exposure
  macroRisks.push({
    severity: 'low',
    label: 'Z\u00e9ro exposition Or',
    detail: 'L\u2019or a gagn\u00e9 +21% YTD 2026 (record $5 602). Aucune exposition directe. Consid\u00e9rer GLD ou SGOL (5-10% du portefeuille) comme hedge g\u00e9opolitique.',
  });
  insights.push({
    type: 'macro-risks',
    title: 'Risques Macro\u00e9conomiques',
    risks: macroRisks,
  });

  // 9. Dividend WHT deadlines (upcoming ex-dates for sell-before strategy)
  const today = new Date();
  const upcoming = [];
  ibkrPositions.forEach(pos => {
    const cal = DIV_CALENDAR[pos.ticker];
    if (!cal || !cal.exDates || cal.exDates.length === 0 || cal.dps === 0) return;
    cal.exDates.forEach(d => {
      const exDate = new Date(d);
      const daysUntil = Math.round((exDate - today) / 86400000);
      if (daysUntil > 0 && daysUntil <= 90) {
        const whtRate = WHT_RATES[pos.geo] || 0.30;
        const grossDiv = pos.shares * cal.dps;
        const grossDivEUR = toEUR(grossDiv, pos.currency, fx);
        const whtCost = grossDivEUR * whtRate;
        upcoming.push({
          ticker: pos.ticker,
          label: pos.label,
          exDate: d,
          daysUntil: daysUntil,
          dps: cal.dps,
          grossDivEUR: grossDivEUR,
          whtRate: whtRate,
          whtCost: whtCost,
          currency: pos.currency,
        });
      }
    });
  });
  upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
  if (upcoming.length > 0) {
    insights.push({
      type: 'dividend-wht',
      title: 'Calendrier Dividendes — WHT \u00e0 \u00e9viter',
      upcoming: upcoming,
      totalWHTAtRisk: upcoming.reduce((s, d) => s + d.whtCost, 0),
    });
  }

  return {
    ibkrPositions,
    ibkrNAV,
    ibkrCashEUR, ibkrCashUSD, ibkrCashJPY, ibkrCashTotal,
    totalPositionsVal, totalCostBasis, totalUnrealizedPL, totalFxPL, totalStockPL,
    // ESPP detail
    esppVal: amineEspp,
    esppShares: espp.shares,
    esppPrice: m.acnPriceUSD,
    esppCostBasisEUR, esppCurrentVal, esppUnrealizedPL,
    esppCashEUR: espp.cashEUR,
    // Nezha ESPP
    nezhaEsppVal: nezhaEsppCurrentVal,
    nezhaEsppShares: nezhaEsppShares,
    nezhaEsppCostBasisEUR: nezhaEsppCostBasisEUR,
    nezhaEsppCurrentVal: nezhaEsppCurrentVal,
    nezhaEsppUnrealizedPL: nezhaEsppUnrealizedPL,
    // SGTM
    sgtmAmineVal: amineSgtm,
    sgtmNezhaVal: nezhaSgtm,
    sgtmTotal: amineSgtm + nezhaSgtm,
    sgtmAmineShares: portfolio.amine.sgtm.shares,
    sgtmNezhaShares: portfolio.nezha.sgtm.shares,
    sgtmPriceMAD: m.sgtmPriceMAD,
    sgtmCostBasisEUR: m.sgtmCostBasisMAD ? sgtmCostEUR_hist : null,
    sgtmFxPL,
    // ACN reference prices for period change columns
    acnPreviousClose: m.acnPreviousClose || null,
    acnMtdOpen: m.acnMtdOpen || null,
    acnYtdOpen: m.acnYtdOpen || null,
    acnOneMonthAgo: m.acnOneMonthAgo || null,
    // Live flags for UI indicators
    _acnLive: !!m._acnLive,
    _sgtmLive: !!m._sgtmLive,
    // Totals
    totalStocks,
    totalCurrentValue,
    // IBKR metrics — twr is static fallback, overridden by chart data at render time
    twr: meta.twr || 0, // NOTE: overridden by window._chartKPIData?.twr in render.js
    realizedPL: ibkrRealizedPL,
    // ALL costs computed dynamically from trade/cost data — ZERO hardcoded values
    dividends: costsAllTime.dividendsEUR,
    dividendsYTD: costsYtd.dividendsEUR,
    commissions: costsAllTime.commissionsEUR,
    commissionsYTD: costsYtd.commissionsEUR,
    fttAllTime: costsAllTime.fttEUR,
    fttYTD: costsYtd.fttEUR,
    interestAllTime: costsAllTime.interestEUR,
    interestYTD: costsYtd.interestEUR,
    ibkrDepositsTotal: ibkrDepositsTotal,
    esppDeposits: esppDeposits,
    sgtmDepositsEUR: sgtmDepositsEUR,
    // v280 (BUG-014): Degiro net déployé (peut être négatif si compte clôturé à profit)
    degiroDepositsNet: degiroDepositsNet,
    degiroDepositsGross: degiroDepositsGross,
    degiroWithdrawals: degiroWithdrawals,
    sgtmUnrealizedPL: sgtmUnrealizedPL,
    closedPositions: ibkrOnlyClosed,
    allClosedPositions: allClosed,
    trades: allTradesUnified,
    depositHistory: depositHistory,
    // Degiro — aggregated by ticker (pre-split + post-split merged)
    degiroClosedPositions: degiroOnlyClosed.map(t => {
      const cost = t.costEUR || 0;
      const proceeds = t.proceedsEUR || 0;
      // Use t.pl directly (already set from degiroPerTickerPL in byTickerSource enrichment)
      // Use !== undefined to preserve pl=0 (some positions like INFY 2020 have zero P/L)
      const pl = (typeof t.pl === 'number') ? t.pl : (cost > 0 ? (proceeds - cost) : 0);
      // hasCost: true if we have buy cost data OR report-based P/L (can show meaningful numbers)
      const hasCost = cost > 0 || t._hasReportPL;
      return {
        ticker: t.ticker, label: t.label, pl, hasCost, _hasReportPL: t._hasReportPL,
        costEUR: cost, proceedsEUR: proceeds,
        _allTrades: t._allTrades || [], _ifHeldPriceEUR: t._ifHeldPriceEUR, _ifHeldValueEUR: t._ifHeldValueEUR, _ifHeldPL: t._ifHeldPL, _staticPrice: t._staticPrice,
      };
    }),
    degiroRealizedPL,
    // Cross-platform
    combinedRealizedPL,
    combinedUnrealizedPL,
    totalDeposits,
    geoAllocation,
    sectorAllocation,
    insights,
    // ═══════════════════════════════════════════════════════════════════
    // UNIFIED PERIOD P&L — même fonction pour les 5 KPIs
    // fullPeriodPL(field, acnRef, closedPL, costs, opts) produit {total, breakdown, costs}
    // SGTM : inclus dans le total SEULEMENT pour 1Y (période contient IPO déc 2025)
    //         Pour YTD/MTD/1M, SGTM est affiché dans le breakdown mais PAS dans le total
    //         car on n'a pas de prix de référence SGTM pour ces périodes
    // ═══════════════════════════════════════════════════════════════════
    periodPL: (() => {
      function sumField(field) { return ibkrPositions.reduce((s, p) => s + (p[field] || 0), 0); }
      function hasField(field) { return ibkrPositions.some(p => p[field] !== null && p[field] !== undefined); }

      // ESPP period P&L (ACN price change × shares)
      function esppPeriodPL(refPrice) {
        if (!refPrice || refPrice <= 0) return 0;
        return esppCurrentVal - (espp.shares * refPrice / (fx.USD || 1));
      }
      function nezhaEsppPeriodPL(refPrice) {
        if (!refPrice || refPrice <= 0 || nezhaEsppShares <= 0) return 0;
        return nezhaEsppCurrentVal - (nezhaEsppShares * refPrice / (fx.USD || 1));
      }

      const sgtmShares = (portfolio.amine.sgtm?.shares || 0) + (portfolio.nezha.sgtm?.shares || 0);

      // IBKR cash FX P&L (daily only — uses FX_STATIC as prev)
      const jpyPrevFx = FX_STATIC.JPY || fx.JPY;
      const usdPrevFx = FX_STATIC.USD || fx.USD;
      const cashFxPL = (toEUR(ibkr.cashJPY, 'JPY', fx) - ibkr.cashJPY / jpyPrevFx)
                      + (toEUR(ibkr.cashUSD, 'USD', fx) - ibkr.cashUSD / usdPrevFx);

      // ── Unified fullPeriodPL ──
      // opts.sgtmInTotal: true to add SGTM to the P&L total (only when we have a ref price)
      // opts.sgtmInBreakdown: true to show SGTM in breakdown (always for periods > daily)
      function fullPeriodPL(field, acnRefPrice, closedData, periodCosts, opts) {
        opts = opts || {};
        const closedPL = closedData.total;
        const closedItems = closedData.items;
        // 1. IBKR open positions
        const ibkrPL = sumField(field);
        // 2. ESPP (Amine + Nezha)
        const esppPL = esppPeriodPL(acnRefPrice) + nezhaEsppPeriodPL(acnRefPrice);
        // 3. SGTM — only in total when we have a period ref price
        const sgtmPL = opts.sgtmInTotal ? sgtmUnrealizedPL : 0;
        // 4. Degiro
        const degPL = opts.degiroPL || 0;
        // 5. Cash FX effect (daily only)
        const cfxPL = opts.cashFxPL || 0;

        const total = ibkrPL + esppPL + sgtmPL + closedPL + degPL + cfxPL;

        // ── Build breakdown items ──
        const items = [];
        ibkrPositions.forEach(p => {
          if (p[field] != null) items.push({ label: p.label, ticker: p.ticker, pl: p[field], valEUR: p.valEUR });
        });
        if (esppPL !== 0) items.push({ label: 'Accenture (ACN)', ticker: 'ACN', pl: esppPL, valEUR: esppCurrentVal + nezhaEsppCurrentVal });
        // SGTM in breakdown (greyed out if not in total)
        if (opts.sgtmInBreakdown && sgtmUnrealizedPL !== 0) {
          items.push({
            label: 'SGTM (x' + sgtmShares + ')' + (opts.sgtmInTotal ? '' : ' *'),
            ticker: 'SGTM', pl: sgtmUnrealizedPL, valEUR: amineSgtm + nezhaSgtm,
            _notInTotal: !opts.sgtmInTotal,
          });
        }
        if (closedPL !== 0) {
          items.push({ label: 'P/L Réalisé (fermées)', ticker: '_CLOSED_IBKR', pl: closedPL, _isCost: true, _detail: closedItems });
        }
        if (opts.degiroItems) opts.degiroItems.forEach(i => items.push(i));

        // ── Cost items (FTT, commissions, interest, dividends) ──
        // Included in breakdown for display, NOT in total (costs are separate from position P&L)
        // Each item carries _detail array for expandable per-trade/per-month detail
        if (periodCosts) {
          if (periodCosts.interestEUR && Math.abs(periodCosts.interestEUR) >= 1) {
            items.push({ label: 'Intérêts marge', ticker: '_INTEREST', pl: periodCosts.interestEUR, _isCost: true, _detail: periodCosts.interestItems });
          }
          if (periodCosts.fttEUR && Math.abs(periodCosts.fttEUR) >= 1) {
            items.push({ label: 'Taxe transactions (FTT)', ticker: '_FTT', pl: periodCosts.fttEUR, _isCost: true, _detail: periodCosts.fttItems });
          }
          if (periodCosts.commissionsEUR && Math.abs(periodCosts.commissionsEUR) >= 1) {
            items.push({ label: 'Commissions IBKR', ticker: '_COMM', pl: periodCosts.commissionsEUR, _isCost: true, _detail: periodCosts.commissionsItems });
          }
          if (periodCosts.dividendsEUR && Math.abs(periodCosts.dividendsEUR) >= 1) {
            const divDetail = [...(periodCosts.ibkrDivItems || []), ...(periodCosts.acnDivItems || []), ...(periodCosts.degiroDivItems || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            items.push({ label: 'Dividendes nets', ticker: '_DIV', pl: periodCosts.dividendsEUR, _isCost: true, _detail: divDetail });
          }
        }

        items.sort((a, b) => a.pl - b.pl);
        return { total, hasData: hasField(field), breakdown: items, cashFxPL: cfxPL, costs: periodCosts };
      }

      // ── Apply unified function to all 5 periods ──
      // SGTM logic:
      //   - Daily: no SGTM (too short, no Casablanca intraday data)
      //   - MTD/1M/YTD: SGTM in breakdown ONLY (no period-start ref price available)
      //   - 1Y: SGTM in total + breakdown (IPO was Dec 2025, within 1Y window)
      return {
        daily:    fullPeriodPL('dailyPL',    m.acnPreviousClose, closedDaily,    costsDaily,    { cashFxPL: cashFxPL }),
        mtd:      fullPeriodPL('mtdPL',      m.acnMtdOpen,       closedMtd,      costsMtd,      { sgtmInBreakdown: true }),
        ytd:      fullPeriodPL('ytdPL',      m.acnYtdOpen,       closedYtd,      costsYtd,      { sgtmInBreakdown: true }),
        oneMonth: fullPeriodPL('oneMonthPL',  m.acnOneMonthAgo,   closedOneMonth, costsOneMonth, { sgtmInBreakdown: true }),
        oneYear:  fullPeriodPL('oneYearPL',  m.acnOneYearAgo,    closedOneYear,  costsOneYear,  {
          sgtmInTotal: true,
          sgtmInBreakdown: true,
          degiroPL: degiro1Y.total,
          degiroItems: degiro1Y.items,
        }),
      };
    })(),
  };
}

/**
 * Compute cash view: cash holdings, yields, and inflation impact
 *
 * Aggregates multi-currency cash positions with their effective yields:
 *   - IBKR (EUR, USD, JPY): multi-tier yield structure, JPY margin interest, FX gains
 *   - UAE cash (Mashreq, WIO): AED accounts with LIBOR-linked yields
 *   - Revolut EUR: fixed yield
 *   - Morocco cash (Attijari, NABD): MAD accounts with fixed yields
 *
 * Computes:
 *   - Total cash (consolidated in EUR)
 *   - Monthly interest accrued (by cash account)
 *   - Annual interest forecast
 *   - Inflation impact: monthly purchasing power loss (inflation_rate / 12)
 *   - Real yield: cash yield - inflation rate
 *   - FX daily variance (for multi-currency positions)
 *
 * Special handling:
 *   - IBKR: effective yield accounts for 10K EUR/USD threshold (no interest below)
 *   - IBKR JPY: negative balance (margin loan) incurs borrowing cost (tiered rates)
 *   - Inflation: monthly rate = annual_rate / 12, compounded
 *
 * @param {Object} portfolio - Portfolio data with cash holdings
 * @param {Object} fx - Current FX rates
 * @returns {Object} { cashTotal, accounts: [...], monthlyInterest, annualInterest,
 *                     inflationMonthly, realYield, fxDailyDetail, ... }
 */
function computeCashView(portfolio, fx) {
  const p = portfolio;

  // ── IBKR Rendement effectif ──────────────────────────────
  // EUR/USD : IBKR ne paie 0% sur les premiers 10K€/10K$
  // → on calcule le yield effectif = nominal × (solde-10K)/solde
  // Source : interactivebrokers.com/en/accounts/fees/pricing-interest-rates.php
  function ibkrEffectiveYield(native, nominalRate, threshold) {
    if (native <= threshold) return 0;
    return nominalRate * (native - threshold) / native;
  }

  // ── IBKR JPY Emprunt (margin) — taux par tranche ──────
  // Source : interactivebrokers.com/en/trading/margin-rates.php
  // IBKR Pro — Benchmark (BM) JPY = 0.75% (BOJ Unsecured Overnight Call Rate, 31 mars 2026)
  //
  // ⚠️  POUR METTRE À JOUR : modifier les taux ci-dessous
  //     Tier 1: 0 → ¥11M    = BM + 1.5%  (actuellement 2.25%)
  //     Tier 2: ¥11M → ¥114M = BM + 1.0%  (actuellement 1.75%)
  //     Tier 3: > ¥114M      = BM + 0.75% (actuellement 1.50%)
  function ibkrJPYBorrowCost(absJPY) {
    const tiers = IBKR_CONFIG.jpyTiers;
    let remaining = absJPY, totalCost = 0, prev = 0;
    for (const t of tiers) {
      const slice = Math.min(remaining, t.limit - prev);
      if (slice <= 0) break;
      totalCost += slice * t.rate;
      remaining -= slice;
      prev = t.limit;
    }
    // Return effective blended rate (negative = cost)
    return absJPY > 0 ? -(totalCost / absJPY) : 0;
  }

  const accounts = [
    { label: 'Mashreq NEO+', native: p.amine.uae.mashreq, currency: 'AED', yield: CASH_YIELDS.mashreq, owner: 'Amine' },
    { label: 'Wio Savings', native: p.amine.uae.wioSavings, currency: 'AED', yield: CASH_YIELDS.wioSavings, owner: 'Amine' },
    { label: 'Wio Current', native: p.amine.uae.wioCurrent, currency: 'AED', yield: CASH_YIELDS.wioCurrent, owner: 'Amine' },
    { label: 'Wio Business (Bairok)', native: p.amine.uae.wioBusiness || 0, currency: 'AED', yield: 0, owner: 'Amine' },
    { label: 'Revolut EUR', native: p.amine.uae.revolutEUR, currency: 'EUR', yield: CASH_YIELDS.revolutEUR, owner: 'Amine' },
    { label: 'Attijariwafa', native: p.amine.maroc.attijari, currency: 'MAD', yield: CASH_YIELDS.attijari, owner: 'Amine' },
    { label: 'Nabd (ex-SOGE)', native: p.amine.maroc.nabd, currency: 'MAD', yield: CASH_YIELDS.nabd, owner: 'Amine' },
    // IBKR: premiers 10K€/10K$ à 0%, le reste au taux IBKR Pro
    { label: 'IBKR Cash EUR', native: p.amine.ibkr.cashEUR, currency: 'EUR',
      yield: ibkrEffectiveYield(p.amine.ibkr.cashEUR, CASH_YIELDS.ibkrCashEUR, IBKR_CONFIG.cashThreshold),
      owner: 'Amine' },
    { label: 'IBKR Cash USD', native: p.amine.ibkr.cashUSD, currency: 'USD',
      yield: ibkrEffectiveYield(p.amine.ibkr.cashUSD, CASH_YIELDS.ibkrCashUSD, IBKR_CONFIG.cashThreshold),
      owner: 'Amine' },
    // IBKR JPY short: taux par tranche (tiered margin rate)
    { label: 'IBKR Cash JPY', native: p.amine.ibkr.cashJPY, currency: 'JPY',
      yield: ibkrJPYBorrowCost(Math.abs(p.amine.ibkr.cashJPY)),
      owner: 'Amine', isDebt: true },
    { label: 'ESPP Cash (Amine)', native: p.amine.espp.cashEUR, currency: 'EUR', yield: CASH_YIELDS.esppCash, owner: 'Amine' },
    { label: 'ESPP Cash (Nezha)', native: (p.nezha.espp && p.nezha.espp.cashUSD) || 0, currency: 'USD', yield: CASH_YIELDS.esppCash, owner: 'Nezha' },
    // Nezha — comptes détaillés
    { label: 'Revolut EUR (Nezha)', native: p.nezha.cash.revolutEUR, currency: 'EUR', yield: CASH_YIELDS.nezhaRevolutEUR, owner: 'Nezha' },
    { label: 'Crédit Mutuel', native: p.nezha.cash.creditMutuelCC, currency: 'EUR', yield: CASH_YIELDS.nezhaCreditMutuel, owner: 'Nezha' },
    { label: 'Livret A (LCL)', native: p.nezha.cash.lclLivretA, currency: 'EUR', yield: CASH_YIELDS.nezhaLivretA, owner: 'Nezha' },
    { label: 'LCL Dépôts', native: p.nezha.cash.lclCompteDepots, currency: 'EUR', yield: CASH_YIELDS.nezhaLclDepots, owner: 'Nezha' },
    { label: 'Attijariwafa (Nezha)', native: p.nezha.cash.attijariwafarMAD, currency: 'MAD', yield: CASH_YIELDS.nezhaAttijariMAD, owner: 'Nezha' },
    { label: 'Wio UAE (Nezha)', native: p.nezha.cash.wioAED, currency: 'AED', yield: CASH_YIELDS.nezhaWioAED, owner: 'Nezha' },
  ];

  let totalCash = 0, totalYielding = 0, totalNonYielding = 0;
  let weightedYieldSum = 0;
  const byCurrency = {};
  const PRODUCTIVE_THRESHOLD = 0.03; // ≥3% = productif, <3% = dormant

  // Per-owner breakdown
  const byOwner = {
    Amine:  { total: 0, yielding: 0, nonYielding: 0, weightedYieldSum: 0, accounts: [] },
    Nezha:  { total: 0, yielding: 0, nonYielding: 0, weightedYieldSum: 0, accounts: [] },
  };

  accounts.forEach(a => {
    a.valEUR = toEUR(a.native, a.currency, fx);
    if (a.isDebt) return; // exclude debt (JPY short) from cash totals
    totalCash += a.valEUR;
    if (a.yield >= PRODUCTIVE_THRESHOLD) {
      totalYielding += a.valEUR;
    } else {
      totalNonYielding += a.valEUR;
    }
    weightedYieldSum += a.valEUR * (a.yield || 0);
    byCurrency[a.currency] = (byCurrency[a.currency] || 0) + a.valEUR;
    // Per-owner
    const ow = byOwner[a.owner];
    if (ow) {
      ow.total += a.valEUR;
      const isProductive = a.yield >= PRODUCTIVE_THRESHOLD;
      if (isProductive) { ow.yielding += a.valEUR; }
      else { ow.nonYielding += a.valEUR; }
      ow.weightedYieldSum += a.valEUR * (a.yield || 0);
      ow.accounts.push({ label: a.label, valEUR: a.valEUR, yield: a.yield || 0, productive: isProductive });
    }
  });

  // Per-owner computed fields
  ['Amine', 'Nezha'].forEach(name => {
    const ow = byOwner[name];
    ow.avgYield = ow.total > 0 ? (ow.weightedYieldSum / ow.total) : 0;
    ow.netVsInflation = ow.weightedYieldSum - (ow.total * INFLATION_RATE); // gain - erosion
  });

  const weightedAvgYield = totalCash > 0 ? (weightedYieldSum / totalCash) : 0;
  const monthlyInflationCost = totalNonYielding * INFLATION_RATE / 12;
  const annualInflationCost = totalNonYielding * INFLATION_RATE;
  const jpyShortEUR = toEUR(portfolio.amine.ibkr.cashJPY, 'JPY', fx);

  // ── DIAGNOSTICS STRATÉGIQUES ─────────────────────────────
  // Conseils priorisés par impact (manque à gagner annuel)
  // Catégories : strategy, action, optimize, risk
  const diagnostics = [];
  const REF_YIELD = IBKR_CONFIG.refYield; // Benchmark rendement cible (data.js)

  // --- Calcul du JPY ---
  const jpyAccount = accounts.find(a => a.isDebt);
  const jpyCostAnn = jpyAccount ? Math.abs(jpyAccount.valEUR * jpyAccount.yield) : 0;

  // --- Manque à gagner total ---
  const totalMissedAnn = accounts
    .filter(a => !a.isDebt && a.valEUR > 0)
    .reduce((s, a) => s + a.valEUR * (REF_YIELD - (a.yield || 0)), 0);

  // ═══════════════════════════════════════════════════════
  // 1. VUE D'ENSEMBLE — Résumé stratégique
  // ═══════════════════════════════════════════════════════
  diagnostics.push({
    severity: 'urgent',
    category: 'summary',
    dormantPct: (totalNonYielding / totalCash * 100),
    dormantEUR: totalNonYielding,
    totalMissedAnn: totalMissedAnn,
    jpyCostAnn: jpyCostAnn,
    avgYield: weightedAvgYield,
    targetYield: REF_YIELD,
    potentialGainAnn: totalMissedAnn,
  });

  // ═══════════════════════════════════════════════════════
  // 2. COMPTES DORMANTS PAR PROPRIÉTAIRE
  //    Détecte automatiquement tout compte < seuil rendement
  // ═══════════════════════════════════════════════════════
  ['Nezha', 'Amine'].forEach(owner => {
    const dormant = accounts.filter(a => !a.isDebt && a.owner === owner && a.valEUR > 50 && (a.yield || 0) < PRODUCTIVE_THRESHOLD);
    if (dormant.length === 0) return;
    const totalDormant = dormant.reduce((s, a) => s + a.valEUR, 0);
    const gainPotentiel = totalDormant * REF_YIELD;
    diagnostics.push({
      severity: totalDormant > 20000 ? 'urgent' : 'warning',
      category: 'dormant_' + owner.toLowerCase(),
      owner,
      amountEUR: totalDormant,
      accounts: dormant.map(a => ({ label: a.label, valEUR: a.valEUR, yield: a.yield || 0 })),
      gainPotentiel,
    });
  });

  // ═══════════════════════════════════════════════════════
  // 3. COMPTES SOUS-OPTIMAUX (rendement > 0 mais < ref)
  //    Ex: IBKR cash avec seuil 10K à 0%
  // ═══════════════════════════════════════════════════════
  const subOptimal = accounts.filter(a =>
    !a.isDebt && a.valEUR > 5000 && (a.yield || 0) > 0 && (a.yield || 0) < REF_YIELD * 0.5
  );
  subOptimal.forEach(a => {
    const missed = a.valEUR * (REF_YIELD - a.yield);
    diagnostics.push({
      severity: missed > 2000 ? 'warning' : 'info',
      category: 'sub_optimal',
      label: a.label,
      owner: a.owner,
      amountEUR: a.valEUR,
      effectiveYield: a.yield,
      missedAnn: missed,
    });
  });

  // ═══════════════════════════════════════════════════════
  // 4. LEVIER JPY — Coût et risque de l'emprunt
  // ═══════════════════════════════════════════════════════
  if (jpyAccount && Math.abs(jpyAccount.valEUR) > 5000) {
    const riskYen10pct = Math.abs(jpyAccount.valEUR) * 0.10;
    diagnostics.push({
      severity: 'warning',
      category: 'jpy_leverage',
      amountEUR: Math.abs(jpyAccount.valEUR),
      costAnn: jpyCostAnn,
      riskYen10pct,
      jpyNative: Math.abs(portfolio.amine.ibkr.cashJPY),
      blendedRate: Math.abs(jpyAccount.yield),
    });
  }

  // ═══════════════════════════════════════════════════════
  // 5. STRATÉGIE GLOBALE — Plan d'action dynamique
  //    Génère les étapes automatiquement à partir des diagnostics
  // ═══════════════════════════════════════════════════════
  const actionSteps = [];
  const K = v => Math.round(v / 1000) + 'K€'; // local formatter for action steps
  // Build steps from dormant accounts detected above
  diagnostics.filter(d => d.category.startsWith('dormant_')).forEach(d => {
    const biggest = d.accounts.sort((a, b) => b.valEUR - a.valEUR)[0];
    if (biggest) {
      actionSteps.push({
        priority: d.severity === 'urgent' ? 1 : 2,
        text: 'Placer le cash dormant ' + d.owner + ' (' + K(d.amountEUR) + ') \u2014 plus gros poste : ' + biggest.label + ' (' + K(biggest.valEUR) + ')',
      });
    }
  });
  // Sub-optimal accounts
  diagnostics.filter(d => d.category === 'sub_optimal').forEach(d => {
    actionSteps.push({
      priority: 2,
      text: 'Optimiser ' + d.label + ' (' + K(d.amountEUR) + ' \u00e0 ' + (d.effectiveYield * 100).toFixed(1) + '%) \u2014 manque \u00e0 gagner ' + K(d.missedAnn) + '/an',
    });
  });
  // JPY leverage
  const jpyDiag = diagnostics.find(d => d.category === 'jpy_leverage');
  if (jpyDiag) {
    actionSteps.push({
      priority: 3,
      text: 'Surveiller le JPY/EUR \u2014 co\u00fbt emprunt ' + K(jpyDiag.costAnn) + '/an, risque \u00a5+10% = ' + K(jpyDiag.riskYen10pct),
    });
  }
  // Sort by priority
  actionSteps.sort((a, b) => a.priority - b.priority);
  if (actionSteps.length > 0) {
    diagnostics.push({
      severity: 'info',
      category: 'action_plan',
      totalMissedAnn,
      steps: actionSteps.map((s, i) => (i + 1) + '. ' + s.text),
    });
  }

  // ── FX Daily P&L: compare live FX vs FX_STATIC (previous close) ──
  let fxDailyPL = 0;
  const fxDailyDetail = {};
  accounts.forEach(a => {
    if (a.currency === 'EUR' || !a.native || a.native === 0) return;
    const prevRate = FX_STATIC[a.currency];
    const liveRate = fx[a.currency];
    if (!prevRate || !liveRate) return;
    // Value in EUR at previous close vs now
    const valPrev = a.native / prevRate;
    const valNow = a.native / liveRate;
    const delta = valNow - valPrev;
    fxDailyPL += delta;
    fxDailyDetail[a.currency] = (fxDailyDetail[a.currency] || 0) + delta;
  });

  return {
    accounts,
    totalCash,
    totalYielding,
    totalNonYielding,
    weightedAvgYield,
    monthlyInflationCost,
    annualInflationCost,
    byCurrency,
    jpyShortEUR,
    diagnostics,
    byOwner,
    fxDailyPL,
    fxDailyDetail,
  };
}

/**
 * Compute amortization schedule for a single constant-payment loan
 *
 * Builds a month-by-month breakdown of payments:
 *   - month: sequential month number (1, 2, 3, ...)
 *   - date: calendar date in YYYY-MM format
 *   - payment: monthly payment amount (constant)
 *   - interest: interest portion of payment for this month
 *   - principal: principal portion of payment (amortization)
 *   - remainingCRD: Capital Restant Dû (remaining loan balance after payment)
 *
 * Algorithm (constant payment):
 *   Each month: interest = CRD × (annual_rate / 12)
 *              principal = payment - interest (cannot exceed CRD)
 *              CRD = CRD - principal
 *
 * The schedule runs until CRD ≈ 0 or durationMonths elapsed, whichever comes first.
 *
 * Aggregates computed:
 *   - currentIdx: current month in schedule (based on today's date)
 *   - interestPaid: cumulative interest through current month
 *   - interestRemaining: cumulative interest from current month onward
 *   - totalInterest: sum of all interest payments
 *   - totalCost: totalInterest + insurance × durationMonths
 *   - halfCRDDate: date when CRD reaches 50% of original principal
 *   - crossoverDate: date when principal payment exceeds interest payment
 *
 * @param {Object} loan - Loan object: {principal, rate (annual %), monthlyPayment, durationMonths, startDate (YYYY-MM), insurance}
 * @returns {Object} { schedule, currentIdx, interestPaid, interestRemaining, totalInterest, totalCost,
 *                     milestones: {halfCRDDate, crossoverDate}, isMultiLoan: false }
 */
function computeAmortizationSchedule(loan) {
  const schedule = [];
  let crd = loan.principal;
  const monthlyRate = loan.rate / 12;
  const [startY, startM] = loan.startDate.split('-').map(Number);

  for (let i = 0; i < loan.durationMonths && crd > 0.01; i++) {
    const interest = crd * monthlyRate;
    const principalPart = Math.min(loan.monthlyPayment - interest, crd);
    crd -= principalPart;
    const y = startY + Math.floor((startM - 1 + i) / 12);
    const m = ((startM - 1 + i) % 12) + 1;
    schedule.push({
      month: i + 1,
      date: y + '-' + String(m).padStart(2, '0'),
      payment: loan.monthlyPayment,
      interest: Math.round(interest * 100) / 100,
      principal: Math.round(principalPart * 100) / 100,
      remainingCRD: Math.max(0, Math.round(crd * 100) / 100),
    });
  }

  // Find current month index (how many months elapsed since start)
  const now = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1;
  const monthsElapsed = (nowY - startY) * 12 + (nowM - startM);
  const currentIdx = Math.max(0, Math.min(monthsElapsed, schedule.length - 1));

  const interestPaid = schedule.slice(0, currentIdx + 1).reduce((s, r) => s + r.interest, 0);
  const interestRemaining = schedule.slice(currentIdx + 1).reduce((s, r) => s + r.interest, 0);
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  const totalCost = totalInterest + loan.insurance * loan.durationMonths;

  // Milestones
  const halfCRD = loan.principal / 2;
  const halfCRDMonth = schedule.find(r => r.remainingCRD <= halfCRD);
  const crossoverMonth = schedule.find(r => r.principal >= r.interest);

  return {
    schedule,
    currentIdx,
    interestPaid: Math.round(interestPaid),
    interestRemaining: Math.round(interestRemaining),
    totalInterest: Math.round(totalInterest),
    totalCost: Math.round(totalCost),
    milestones: {
      halfCRDDate: halfCRDMonth ? halfCRDMonth.date : null,
      crossoverDate: crossoverMonth ? crossoverMonth.date : null,
    },
  };
}

/**
 * Compute amortization schedule for a single sub-loan with optional multi-period structure
 *
 * Handles three loan types:
 *   1. Standard constant-payment loans (simple monthly payment)
 *   2. Multi-period loans with varying payments (e.g., PTZ with différé, BP with increasing payments)
 *   3. Deferred payment phases: interest-only or no-payment periods where CRD may increase
 *
 * Multi-period example (PTZ 25 years):
 *   Period 1: months 0-59, payment=0 (différé — deferred, CRD frozen if rate=0, else interest capitalizes)
 *   Period 2: months 60-299, payment=€500/month (amortization at full rate)
 *
 * Deferred phase mechanics:
 *   - If payment = 0 and rate = 0 (PTZ): CRD unchanged (no interest accrual)
 *   - If payment = 0 and rate > 0 (rare): interest capitalizes, CRD increases
 *   - Otherwise: principal = payment - interest, CRD decreases normally
 *
 * @param {Object} loan - Loan object:
 *   {
 *     principal: number,
 *     rate: annual percentage (e.g., 0.01 for 1%),
 *     startDate: YYYY-MM,
 *     durationMonths: total months,
 *     monthlyPayment: number (for simple loans without periods),
 *     periods: [{months: N, payment: €}] (optional, for multi-period)
 *   }
 * @returns {Array<Object>} Schedule rows: [{month, date, payment, interest, principal, remainingCRD}]
 *   month: 1-indexed sequential month number
 *   date: calendar date YYYY-MM
 *   payment: actual payment this month (0 for deferred phases)
 *   interest: interest accrued this month
 *   principal: principal reduction (0 for deferred phases with 0 rate)
 *   remainingCRD: CRD after this month's payment
 */
function computeSubLoanSchedule(loan) {
  const schedule = [];
  let crd = loan.principal;
  const monthlyRate = loan.rate / 12;
  const [startY, startM] = loan.startDate.split('-').map(Number);

  if (loan.periods && loan.periods.length > 0) {
    // ── Multi-period loan computation (PTZ with différé, BP with varying payments) ──
    // Iterate through each period, then through months within that period
    let monthIdx = 0;
    for (const period of loan.periods) {
      for (let j = 0; j < period.months && crd > 0.01; j++) {
        const interest = crd * monthlyRate;
        let payment = period.payment;
        let principalPart;
        if (payment === 0) {
          // Deferred period — no payment, but interest may capitalize
          // PTZ (rate=0): CRD unchanged (frozen)
          // Other 0-payment loans (rate>0): interest capitalizes, CRD increases
          principalPart = 0;
          if (interest > 0) {
            crd += interest; // Interest capitalization (rare case, e.g., deferred @ 1%)
          }
        } else {
          // Normal period: subtract interest from payment to get principal reduction
          principalPart = Math.min(payment - interest, crd);
          crd = Math.max(0, crd - principalPart);
        }
        const y = startY + Math.floor((startM - 1 + monthIdx) / 12);
        const m = ((startM - 1 + monthIdx) % 12) + 1;
        schedule.push({
          month: monthIdx + 1,
          date: y + '-' + String(m).padStart(2, '0'),
          payment: Math.round(payment * 100) / 100,
          interest: Math.round(interest * 100) / 100,
          principal: Math.round(principalPart * 100) / 100,
          remainingCRD: Math.round(crd * 100) / 100,
        });
        monthIdx++;
      }
    }
  } else {
    // ── Simple constant-payment loan (no periods: Action Logement, standard mortgage) ──
    const totalMonths = loan.durationMonths;
    for (let i = 0; i < totalMonths && crd > 0.01; i++) {
      const interest = crd * monthlyRate;
      // Principal = payment - interest (cannot exceed remaining CRD)
      const principalPart = Math.min(loan.monthlyPayment - interest, crd);
      crd = Math.max(0, crd - principalPart);
      const y = startY + Math.floor((startM - 1 + i) / 12);
      const m = ((startM - 1 + i) % 12) + 1;
      schedule.push({
        month: i + 1,
        date: y + '-' + String(m).padStart(2, '0'),
        payment: loan.monthlyPayment,
        interest: Math.round(interest * 100) / 100,
        principal: Math.round(principalPart * 100) / 100,
        remainingCRD: Math.round(crd * 100) / 100,
      });
    }
  }
  return schedule;
}

/**
 * Compute combined amortization schedule for multiple sub-loans (multi-period loan resolution)
 *
 * Algorithm (CRD merging/"lissage"):
 *   1. Compute individual sub-loan schedules using computeSubLoanSchedule()
 *   2. Build date-indexed maps for fast lookup: map[date] → {payment, interest, principal, remainingCRD}
 *   3. Collect all unique dates across all sub-loans and sort
 *   4. For each date, aggregate: sum all payments, interest, principal, CRDs
 *   5. For loans not yet started or already ended: use full principal or 0
 *
 * Handles partial overlaps: when loans have different start/end dates, the combined CRD
 * reflects only the sub-loans active in that period.
 *
 * @param {Array<Object>} subLoans - Array of loan objects with {principal, rate, startDate, durationMonths}
 * @param {number} insuranceMonthly - Monthly insurance cost (added to total cost, not payment)
 * @returns {Object} Combined amortization schedule with format compatible with computeAmortizationSchedule():
 *   {
 *     schedule: [{month, date, payment, interest, principal, remainingCRD}, ...],
 *     currentIdx: number,
 *     interestPaid: cumulative interest to date,
 *     interestRemaining: cumulative interest remaining,
 *     totalInterest: total interest for all loans,
 *     totalCost: totalInterest + (insuranceMonthly * loan duration),
 *     milestones: {halfCRDDate, crossoverDate},
 *     isMultiLoan: true,
 *     combinedPrincipal: sum of all principals,
 *     weightedRate: weighted average interest rate,
 *     nbLoans: number of sub-loans
 *   }
 */
function computeMultiLoanSchedule(subLoans, insuranceMonthly) {
  // Compute each sub-loan's schedule
  const subSchedules = subLoans.map(loan => ({
    loan,
    schedule: computeSubLoanSchedule(loan),
  }));

  // Build date-indexed maps for each sub-loan (fast CRD lookup by date)
  const dateMaps = subSchedules.map(s => {
    const map = {};
    for (const row of s.schedule) {
      map[row.date] = row;
    }
    return { loan: s.loan, map, principal: s.loan.principal };
  });

  // Collect all unique dates across all sub-loans
  const allDates = new Set();
  for (const s of subSchedules) {
    for (const row of s.schedule) allDates.add(row.date);
  }
  const sortedDates = [...allDates].sort();

  // ── Build combined schedule with CRD "lissage" ──
  // For overlapping periods, sum payments/interest; for non-overlapping periods,
  // track each sub-loan's CRD independently (before start or after end).
  const schedule = [];
  const lastCRD = dateMaps.map(d => d.principal); // Initialize: start at full principal

  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    let totalPayment = 0, totalInterest = 0, totalPrincipal = 0, totalCRD = 0;

    for (let k = 0; k < dateMaps.length; k++) {
      const row = dateMaps[k].map[date];
      if (row) {
        // Sub-loan is active on this date: aggregate from its schedule
        totalPayment += row.payment;
        totalInterest += row.interest;
        totalPrincipal += row.principal;
        totalCRD += row.remainingCRD;
        lastCRD[k] = row.remainingCRD;
      } else {
        // Sub-loan inactive: either hasn't started yet or already ended
        const loanDates = Object.keys(dateMaps[k].map).sort();
        if (loanDates.length === 0 || date < loanDates[0]) {
          // Before start: use full principal (not yet activated)
          totalCRD += dateMaps[k].principal;
        } else {
          // After end: use 0 (fully amortized)
          totalCRD += 0;
        }
      }
    }

    schedule.push({
      month: i + 1,
      date,
      payment: Math.round(totalPayment * 100) / 100,
      interest: Math.round(totalInterest * 100) / 100,
      principal: Math.round(totalPrincipal * 100) / 100,
      remainingCRD: Math.round(totalCRD * 100) / 100,
    });
  }

  // ── Aggregates & milestones computation ──
  // Find current month index (today's date vs schedule)
  const now = new Date();
  const nowKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  let currentIdx = schedule.findIndex(r => r.date >= nowKey);
  if (currentIdx < 0) currentIdx = schedule.length - 1;

  // Interest aggregates: paid to date, remaining, total
  const interestPaid = schedule.slice(0, currentIdx + 1).reduce((s, r) => s + r.interest, 0);
  const interestRemaining = schedule.slice(currentIdx + 1).reduce((s, r) => s + r.interest, 0);
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  const ins = insuranceMonthly || 0;
  const totalCost = totalInterest + ins * schedule.length;  // Total cost = interest + insurance

  // Milestones: key dates for dashboard visualization
  // 1. halfCRDDate: when remaining CRD drops to 50% of original principal (mid-point)
  // 2. crossoverDate: when principal payment > interest payment (shift to equity-building)
  const combinedPrincipal = subLoans.reduce((s, l) => s + l.principal, 0);
  const halfCRD = combinedPrincipal / 2;
  const halfCRDMonth = schedule.find(r => r.remainingCRD <= halfCRD);
  const crossoverMonth = schedule.find(r => r.principal >= r.interest);

  // Summary metadata for display
  const currentRow = schedule[currentIdx] || schedule[schedule.length - 1];
  const weightedRate = combinedPrincipal > 0
    ? subLoans.reduce((s, l) => s + l.principal * l.rate, 0) / combinedPrincipal
    : 0;

  return {
    schedule,
    currentIdx,
    interestPaid: Math.round(interestPaid),
    interestRemaining: Math.round(interestRemaining),
    totalInterest: Math.round(totalInterest),
    totalCost: Math.round(totalCost),
    milestones: {
      halfCRDDate: halfCRDMonth ? halfCRDMonth.date : null,
      crossoverDate: crossoverMonth ? crossoverMonth.date : null,
    },
    subSchedules: subSchedules.map(s => ({ name: s.loan.name, schedule: s.schedule })),
    // Multi-loan summary for display
    isMultiLoan: true,
    combinedPrincipal: Math.round(combinedPrincipal),
    weightedRate,
    currentMonthlyPayment: currentRow ? currentRow.payment : 0,
    nbLoans: subLoans.length,
  };
}

/**
 * Compute fiscalité for a property
 * Handles: micro-foncier (nu), micro-BIC (LMNP), réel foncier, réel BIC
 * Non-résident UAE : taux minimum 20% + PS 17.2%
 */
function computeFiscalite(loyerDeclareAnnuel, loyerTotalAnnuel, charges, fiscConfig, loanInterestAnnuel) {
  const f = fiscConfig;

  // loyerDeclareAnnuel = revenu déclaré (bail officiel)
  // loyerTotalAnnuel = revenu total (HC + parking + charges locataire)
  const loyerDeclare = loyerDeclareAnnuel;
  const loyerCash = loyerTotalAnnuel - loyerDeclareAnnuel;

  if (f.regime === 'micro-foncier') {
    // Location NUE — abattement forfaitaire 30%
    const revenuImposable = loyerDeclare * 0.70;
    const ir = revenuImposable * f.tmi;
    const ps = revenuImposable * f.ps;
    const totalImpot = ir + ps;
    return {
      regime: 'micro-foncier', type: f.type || 'nu',
      loyerAnnuel: loyerTotalAnnuel, loyerDeclare: Math.round(loyerDeclare), loyerCash: Math.round(loyerCash),
      abattement: Math.round(loyerDeclare * 0.30),
      abattementPct: 30,
      revenuImposable: Math.round(revenuImposable),
      ir: Math.round(ir), ps: Math.round(ps),
      totalImpot: Math.round(totalImpot),
      monthlyImpot: Math.round(totalImpot / 12),
      tauxEffectif: loyerDeclare > 0 ? (totalImpot / loyerDeclare * 100) : 0,
    };
  }

  if (f.regime === 'micro-bic') {
    // LMNP micro-BIC — abattement forfaitaire 50%
    const revenuImposable = loyerDeclare * 0.50;
    const ir = revenuImposable * f.tmi;
    const ps = revenuImposable * f.ps;
    const totalImpot = ir + ps;
    return {
      regime: 'micro-bic', type: 'lmnp',
      loyerAnnuel: loyerTotalAnnuel, loyerDeclare: Math.round(loyerDeclare), loyerCash: 0,
      abattement: Math.round(loyerDeclare * 0.50),
      abattementPct: 50,
      revenuImposable: Math.round(revenuImposable),
      ir: Math.round(ir), ps: Math.round(ps),
      totalImpot: Math.round(totalImpot),
      monthlyImpot: Math.round(totalImpot / 12),
      tauxEffectif: loyerDeclare > 0 ? (totalImpot / loyerDeclare * 100) : 0,
    };
  }

  if (f.regime === 'lmnp-amort') {
    // LMNP réel avec amortissement du bien
    // L'amortissement couvre largement le revenu net → impôt = 0
    return {
      regime: 'lmnp-amort', type: 'lmnp',
      loyerAnnuel: loyerTotalAnnuel, loyerDeclare: Math.round(loyerDeclare), loyerCash: 0,
      abattement: 0, abattementPct: 0,
      revenuImposable: 0,
      ir: 0, ps: 0,
      totalImpot: 0,
      monthlyImpot: 0,
      tauxEffectif: 0,
      note: 'Amortissement du bien > revenu net',
    };
  }

  // Régime réel (foncier ou BIC)
  const deductions = (charges * 12) + loanInterestAnnuel;
  const revenuImposable = Math.max(0, loyerDeclare - deductions);
  const deficit = loyerDeclare - deductions < 0 ? Math.abs(loyerDeclare - deductions) : 0;
  const deficitImputable = Math.min(deficit, 10700);
  const ir = revenuImposable * f.tmi;
  const ps = revenuImposable * f.ps;
  const totalImpot = ir + ps;
  return {
    regime: f.regime, type: f.type || 'nu',
    loyerAnnuel: loyerTotalAnnuel, loyerDeclare: Math.round(loyerDeclare), loyerCash: Math.round(loyerCash),
    deductions: Math.round(deductions),
    revenuImposable: Math.round(revenuImposable),
    deficit: Math.round(deficit),
    deficitImputable: Math.round(deficitImputable),
    ir: Math.round(ir), ps: Math.round(ps),
    totalImpot: Math.round(totalImpot),
    monthlyImpot: Math.round(totalImpot / 12),
    tauxEffectif: loyerDeclare > 0 ? (totalImpot / loyerDeclare * 100) : 0,
  };
}

/**
 * Compute exit costs (capital gains tax and fees) for a property at a given sale price
 *
 * Calculates the full cost of selling a property today (or at targetDate), including:
 *   - Capital gains tax (IR + PS + sur-taxation)
 *   - Agency fees (typically 5-8%)
 *   - Mainlevée costs (loan payoff fees)
 *   - TVA clawback (for LMNP with depreciation clawback on gains)
 *   - Net equity after all exit costs
 *
 * Tax computation depends on:
 *   - Holding duration (exemption after 5 years for some regimes)
 *   - Amortissements (LMNP réel): TVA at 20% applies to depreciation recapture
 *   - Regime type (micro vs réel LMNP vs foncier)
 *   - Personal tax rate (TMI) and social contribution rate (PS)
 *
 * For multi-loan properties (loanCRDs):
 *   - Distributes penalties/fees proportionally across sub-loans
 *   - IRA (Indemnité Remboursement Anticipé) calculated per sub-loan
 *
 * @param {string} loanKey - Property key (vitry, rueil, villejuif)
 * @param {number} salePrice - Assumed sale price today
 * @param {number} purchasePrice - Original purchase price
 * @param {number} holdingYears - Holding duration (affects tax rates)
 * @param {number} crdAtExit - Capital Restant Dû (total remaining loan balance)
 * @param {number} totalAmortissements - Cumulative depreciation (LMNP réel)
 * @param {string|null} targetDate - Optional target date (for scenario analysis); defaults to today
 * @param {Array|null} loanCRDs - For multi-loan: array of {name, crd, rate} for IRA per sub-loan
 * @returns {Object} { salePrice, purchasePrice, capitalGain, pvTaxBeforeAbattement, pvTax,
 *                      agencyFees, totalCosts, netEquityAfterExit, iraTotalEUR, details: {...} }
 */
function computeExitCosts(loanKey, salePrice, purchasePrice, holdingYears, crdAtExit, totalAmortissements, targetDate = null, loanCRDs = null) {
  const EC = EXIT_COSTS;
  const result = {
    salePrice,
    purchasePrice,
    holdingYears: Math.floor(holdingYears),

    // Plus-value brute
    pvBrute: 0,
    // Abattements
    abattementIR: 0,
    abattementPS: 0,
    pvNetteIR: 0,
    pvNettePS: 0,
    // Impôts
    ir: 0,
    ps: 0,
    surtaxe: 0,
    totalTaxPV: 0,

    // Autres frais
    agencyFee: 0,
    diagnostics: EC.diagnosticsCost,
    mainlevee: 0,
    ira: 0, // indemnités remboursement anticipé
    tvaClawback: 0,

    // Total
    totalExitCosts: 0,
    netProceeds: 0,
    netEquityAfterExit: 0,
  };

  // Frais de notaire forfaitaires à l'achat (déjà payés) — on les ajoute au prix d'acquisition
  // pour réduire la PV (majoration forfaitaire 7.5% si on ne peut pas justifier les frais réels)
  const fraisAcquisition = purchasePrice * 0.075;  // forfait 7.5%

  // Si LMNP réel : les amortissements déduits sont réintégrés (loi finances 2025)
  const amortReintegration = (EC[loanKey] && EC[loanKey].lmnpAmortReintegration && totalAmortissements > 0)
    ? totalAmortissements : 0;

  // Plus-value brute = prix vente - (prix achat + frais + travaux) + réintégration amortissements
  result.pvBrute = salePrice - (purchasePrice + fraisAcquisition) + amortReintegration;

  if (result.pvBrute > 0) {
    const years = Math.floor(holdingYears);

    // Calcul abattement IR
    let totalAbattIR = 0;
    for (const bracket of EC.irAbattement) {
      for (let y = bracket.fromYear; y <= bracket.toYear && y <= years; y++) {
        totalAbattIR += bracket.ratePerYear;
      }
    }
    if (years >= 22) totalAbattIR = 1;  // Exonéré IR après 22 ans
    // AUD-014: safety clamp to ensure totalAbattIR never exceeds 1
    totalAbattIR = Math.min(1, totalAbattIR);
    result.abattementIR = totalAbattIR;

    // Calcul abattement PS
    let totalAbattPS = 0;
    for (const bracket of EC.psAbattement) {
      for (let y = bracket.fromYear; y <= bracket.toYear && y <= years; y++) {
        totalAbattPS += bracket.ratePerYear;
      }
    }
    if (years >= 30) totalAbattPS = 1;  // Exonéré PS après 30 ans
    // AUD-014: safety clamp to ensure totalAbattPS never exceeds 1
    totalAbattPS = Math.min(1, totalAbattPS);
    result.abattementPS = totalAbattPS;

    // PV nettes après abattement
    result.pvNetteIR = result.pvBrute * (1 - result.abattementIR);
    result.pvNettePS = result.pvBrute * (1 - result.abattementPS);

    // IR sur PV
    result.ir = Math.round(result.pvNetteIR * EC.irRate);

    // PS sur PV
    result.ps = Math.round(result.pvNettePS * EC.psRate);

    // Surtaxe (sur PV nette IR — si > 50K)
    if (result.pvNetteIR > 50000) {
      for (const bracket of EC.surtaxe) {
        if (result.pvNetteIR >= bracket.from) {
          result.surtaxe = Math.round(result.pvNetteIR * bracket.rate);
        }
      }
    }

    result.totalTaxPV = result.ir + result.ps + result.surtaxe;
  }

  // Frais d'agence — désactivé (vente en direct sans agence)
  // result.agencyFee = Math.round(salePrice * EC.agencyFeePct);
  result.agencyFee = 0;

  // Frais de mainlevée si CRD > 0
  if (crdAtExit > 0) {
    // Mainlevée calculée sur le capital initial (approximation : on utilise le purchase price)
    result.mainlevee = Math.round(EC.mainleveeFixe + purchasePrice * EC.mainleveePct);
  }

  // IRA — Indemnités de remboursement anticipé
  // min(6 mois d'intérêts, 3% du CRD) par prêt — PTZ et Action Logement exemptés
  if (crdAtExit > 0 && EC.iraMonthsInterest) {
    const exemptTypes = EC.iraExemptTypes || [];
    if (loanCRDs && loanCRDs.length > 0) {
      // Per-loan IRA calculation
      let totalIRA = 0;
      for (const loan of loanCRDs) {
        /**
         * IRA exemption detection: explicit field takes precedence over string matching.
         * 1. Check loan.iraExempt boolean field first (explicit declaration)
         * 2. Fall back to string matching against exemptTypes if field not present
         * This allows data.js to declare exemptions declaratively while maintaining
         * backward compatibility with loans identified by name pattern matching.
         */
        const isExempt = loan.iraExempt !== undefined
          ? !!loan.iraExempt
          : exemptTypes.some(t => (loan.name || '').toLowerCase().includes(t));
        if (isExempt || loan.crd <= 0) continue;
        const sixMonthsInterest = loan.crd * (loan.rate || 0) / 12 * EC.iraMonthsInterest;
        const threePctCRD = loan.crd * EC.iraPctCRD;
        totalIRA += Math.min(sixMonthsInterest, threePctCRD);
      }
      result.ira = Math.round(totalIRA);
    } else {
      // Fallback: estimate on total CRD with average rate
      const IC = IMMO_CONSTANTS;
      const loanConfig = IC.loans && IC.loans[loanKey];
      const rate = loanConfig ? (loanConfig.rate || 0.02) : 0.02;
      const sixMonthsInterest = crdAtExit * rate / 12 * EC.iraMonthsInterest;
      const threePctCRD = crdAtExit * EC.iraPctCRD;
      result.ira = Math.round(Math.min(sixMonthsInterest, threePctCRD));
    }
  }

  // TVA clawback (Vitry uniquement) — obligation 10 ans depuis LIVRAISON (pas acte)
  if (loanKey === 'vitry' && EC.vitry && EC.vitry.tvaReduite) {
    const tva = EC.vitry.tvaReduite;
    // L'obligation TVA 5.5% court depuis la livraison VEFA, pas depuis l'acte
    const livraisonStr = tva.dateLivraison || '2025-07';
    const [livY, livM] = livraisonStr.split('-').map(Number);
    const now = targetDate || new Date();
    const yearsSinceLivraison = (now.getFullYear() - livY) + (now.getMonth() + 1 - livM) / 12;
    if (yearsSinceLivraison < tva.dureeEngagement) {
      // AUD-008: use Math.ceil instead of Math.floor to avoid aggressive rounding down
      const yearsRemaining = Math.ceil(tva.dureeEngagement - yearsSinceLivraison);
      const diffTVA = tva.prixHTApprox * (tva.tauxNormal - tva.tauxReduit);
      result.tvaClawback = Math.round(diffTVA * yearsRemaining / tva.dureeEngagement);
    }
  }

  // Total frais de sortie
  result.totalExitCosts = result.totalTaxPV + result.agencyFee + result.diagnostics + result.mainlevee + result.ira + result.tvaClawback;

  // Produit net = prix de vente - frais de sortie - CRD restant
  result.netProceeds = salePrice - result.totalExitCosts;
  result.netEquityAfterExit = result.netProceeds - crdAtExit;

  return result;
}

/**
 * Compute exit costs at a specific future year (exported for charts/projections)
 * Returns { totalExitCosts, netEquityAfterExit, tvaClawback, totalTaxPV, ... }
 */
export function computeExitCostsAtYear(loanKey, targetYear, projectedValue, purchasePrice, crdAtDate, totalAmortissements, loanCRDs = null) {
  const propMeta = IMMO_CONSTANTS.properties[loanKey] || {};
  const purchaseDate = propMeta.purchaseDate || '2023-01';
  const [pY, pM] = purchaseDate.split('-').map(Number);
  // AUD-003: floor negative holding years to prevent negative exit cost
  const holdingYears = Math.max(0, (targetYear - pY) + (6 - pM) / 12); // approx mid-year
  const targetDate = new Date(targetYear, 5, 1); // June 1 of target year
  return computeExitCosts(loanKey, projectedValue, purchasePrice, holdingYears, crdAtDate, totalAmortissements, targetDate, loanCRDs);
}

/**
 * Compute PV abattement schedule for years 1-30 (for tax visualization chart)
 * Returns array of {year, abattIR, abattPS, taxIR_pct, taxPS_pct, net_pct}
 */
export function computePVAbattementSchedule() {
  const EC = EXIT_COSTS;
  const schedule = [];

  for (let year = 1; year <= 30; year++) {
    // Compute abattement IR (cumulative % from brackets)
    let totalAbattIR = 0;
    for (const bracket of EC.irAbattement) {
      for (let y = bracket.fromYear; y <= bracket.toYear && y <= year; y++) {
        totalAbattIR += bracket.ratePerYear;
      }
    }
    if (year >= 22) totalAbattIR = 1; // Fully exempt after 22 years
    const abattIR = Math.min(1, totalAbattIR);

    // Compute abattement PS (cumulative % from brackets)
    let totalAbattPS = 0;
    for (const bracket of EC.psAbattement) {
      for (let y = bracket.fromYear; y <= bracket.toYear && y <= year; y++) {
        totalAbattPS += bracket.ratePerYear;
      }
    }
    if (year >= 30) totalAbattPS = 1; // Fully exempt after 30 years
    const abattPS = Math.min(1, totalAbattPS);

    // Tax percentages (on 100€ gross gain, what % goes to taxes)
    const taxIR_pct = (1 - abattIR) * EC.irRate * 100;
    const taxPS_pct = (1 - abattPS) * EC.psRate * 100;
    const totalTax_pct = taxIR_pct + taxPS_pct;
    const net_pct = 100 - totalTax_pct;

    schedule.push({
      year,
      abattIR: Math.round(abattIR * 100),
      abattPS: Math.round(abattPS * 100),
      taxIR_pct: Math.round(taxIR_pct * 100) / 100,
      taxPS_pct: Math.round(taxPS_pct * 100) / 100,
      net_pct: Math.round(net_pct * 100) / 100,
    });
  }

  return schedule;
}

/**
 * Compute JEANBRUN vs LMNP comparison for Villejuif over N years
 */
function computeVillejuifRegimeComparison() {
  const VR = VILLEJUIF_REGIMES;
  const sim = VR.simulation;
  const base = VR.base;
  const years = sim.duree;
  const h = sim.hypotheses;

  const results = { jeanbrun: [], lmnp: [] };
  let jCumGain = 0, lCumGain = 0;
  let jCumTax = 0, lCumTax = 0;

  // JEANBRUN: 9 ans d'engagement (best middle-ground)
  const jbEngagement = 9;
  const jbReduction = VR.jeanbrun.reductionImpot;
  const prixPlafonneJB = Math.min(base.totalOperation, jbReduction.plafondPrix, base.surface * jbReduction.plafondM2);
  const reductionTotale = prixPlafonneJB * jbReduction.taux9ans;
  const reductionAnnuelle = reductionTotale / jbEngagement;

  // LMNP: amortissement du bien
  const valeurAmortissable = base.totalOperation * (1 - h.partTerrain);
  const amortBienAnnuel = valeurAmortissable * h.tauxAmortissement;
  const amortMobilierAnnuel = base.coutMobilier * 0.10; // amorti sur 10 ans

  for (let y = 1; y <= years; y++) {
    const inflationFactor = Math.pow(1 + h.inflationLoyer, y - 1);

    // ── JEANBRUN ──
    const jLoyer = Math.min(
      Math.round(base.loyerNuHC * inflationFactor),
      VR.jeanbrun.plafondLoyer.loyerMaxMensuel
    );
    const jRevenuAnnuel = jLoyer * 12;
    const jChargesAnnuel = (base.chargesProprietaire + base.mensualitePret + base.assurancePret) * 12;
    const jCFBrut = jRevenuAnnuel - jChargesAnnuel;
    // Fiscalité : revenus fonciers imposés au réel
    const jRevenuImposable = Math.max(0, jRevenuAnnuel - (base.chargesProprietaire * 12)); // simplified
    const jImpot = Math.round(jRevenuImposable * (h.tauxIR + h.tauxPS));
    // Réduction d'impôt JEANBRUN
    const jReduction = y <= jbEngagement ? Math.round(reductionAnnuelle) : 0;
    const jImpotNet = Math.max(0, jImpot - jReduction);
    const jCFNet = jCFBrut - jImpotNet;
    jCumGain += jCFNet;
    jCumTax += jImpotNet;

    results.jeanbrun.push({
      year: y, loyer: jLoyer, revenuAnnuel: jRevenuAnnuel,
      cfBrut: jCFBrut, impot: jImpot, reduction: jReduction,
      impotNet: jImpotNet, cfNet: jCFNet, cumGain: jCumGain,
    });

    // ── LMNP ──
    const lLoyer = Math.round(base.loyerMeubleHC * inflationFactor);
    const lRevenuAnnuel = lLoyer * 12;
    const lFraisComptable = VR.lmnp.fiscalite.fraisComptable;
    const lCFE = VR.lmnp.fiscalite.cfe;
    const lChargesAnnuel = jChargesAnnuel + lFraisComptable + lCFE + base.renouvellementMobilier;
    const lCFBrut = lRevenuAnnuel - lChargesAnnuel;
    // Amortissement couvre le revenu → impôt = 0 tant que amort > revenu net
    const lRevenuNetComptable = lRevenuAnnuel - (base.chargesProprietaire * 12) - lFraisComptable - lCFE;
    const lAmortTotal = amortBienAnnuel + amortMobilierAnnuel;
    const lRevenuImposable = Math.max(0, lRevenuNetComptable - lAmortTotal);
    const lImpot = Math.round(lRevenuImposable * (h.tauxIR + h.tauxPS));
    const lCFNet = lCFBrut - lImpot;
    lCumGain += lCFNet;
    lCumTax += lImpot;

    // Déduire coût mobilier initial la première année
    const lCFNetAdj = y === 1 ? lCFNet - base.coutMobilier : lCFNet;
    if (y === 1) lCumGain -= base.coutMobilier;

    results.lmnp.push({
      year: y, loyer: lLoyer, revenuAnnuel: lRevenuAnnuel,
      cfBrut: lCFBrut, amortissement: Math.round(lAmortTotal),
      impot: lImpot, cfNet: lCFNetAdj, cumGain: lCumGain,
    });
  }

  // Summary
  const delta = lCumGain - jCumGain;
  results.summary = {
    jbTotal: jCumGain,
    lmnpTotal: lCumGain,
    delta,
    winner: delta > 0 ? 'LMNP' : 'JEANBRUN',
    jbReductionTotale: Math.round(reductionTotale),
    jbReductionAnnuelle: Math.round(reductionAnnuelle),
    jbLoyerPlafond: VR.jeanbrun.plafondLoyer.loyerMaxMensuel,
    lmnpAmortAnnuel: Math.round(amortBienAnnuel + amortMobilierAnnuel),
    lmpRisque: (base.loyerMeubleHC * 12) > VILLEJUIF_REGIMES.lmp.seuils.recettesMin,
    lmpRecettesTotales: (base.loyerMeubleHC + 1300) * 12, // Villejuif + Rueil
  };

  return results;
}

/**
 * Compute immo (real estate) view: property valuations, cash flows, wealth creation, and fiscal impact
 *
 * This is the core wealth computation for real estate assets. For each property (Vitry, Rueil, Villejuif),
 * it computes:
 *   1. Current property value (with appreciation curve from valueDate)
 *   2. Monthly revenues: loyer (rent) + parking + charges locataire (tenant charges)
 *   3. Monthly charges: loan payment + insurance + property taxes (PNO) + transfer tax (TF) + copro
 *   4. Monthly cash flow: totalRevenue - charges
 *   5. Fiscal impact: tax on rental income (regime micro-foncier, micro-BIC, or réel)
 *   6. Wealth creation breakdown:
 *      - Capital amortization: from loan schedule (principal paid down this month)
 *      - Appreciation: property value × appreciation rate / 12
 *      - Cash flow: monthly surplus (or deficit if "effort épargne")
 *   7. Exit costs: capital gains tax, notary fees, agency fees if sold today
 *   8. Loan details: for multi-loan properties, tracks sub-loan schedules and current periods
 *
 * Multi-loan support (v227+):
 *   - Properties can have vitryLoans (array of sub-loans) instead of vitry (single loan)
 *   - Uses computeMultiLoanSchedule() to merge CRDs and compute combined amortization
 *
 * Conditional properties (not signed / not delivered):
 *   - If conditional: no cash flow, no capital amortization → only appreciation counts
 *
 * @param {Object} portfolio - Portfolio data from data.js
 * @param {Object} fx - Current FX rates (for multi-currency handling)
 * @returns {Object} { properties: [...], totalProperties, totalWealthCreation, totalYieldNet, etc. }
 */
function computeImmoView(portfolio, fx) {
  const IC = IMMO_CONSTANTS;
  const properties = [];
  const loanKeys = ['vitry', 'rueil', 'villejuif'];

  // Compute amortization schedules
  const amortSchedules = {};
  for (const key of loanKeys) {
    // Multi-loan: use vitryLoans / villejuifLoans if available
    const subLoansKey = key + 'Loans';
    if (IC.loans && IC.loans[subLoansKey]) {
      const insuranceKey = key + 'Insurance';
      const ins = IC.loans[insuranceKey] || 0;
      amortSchedules[key] = computeMultiLoanSchedule(IC.loans[subLoansKey], ins);
    } else if (IC.loans && IC.loans[key]) {
      amortSchedules[key] = computeAmortizationSchedule(IC.loans[key]);
    }
  }

  // Helper to build property with fiscal data
  function buildProperty(name, owner, propData, chargesConfig, loanKey, conditional) {
    // ── Dynamic property valuation with phase-specific appreciation ──
    // Property value evolves from valueDate using appreciation rate (compound monthly)
    // Supports both constant appreciation and phase-specific rates (e.g., different rates for years 1-5 vs 5+)
    //
    // Algorithm:
    //   1. If no valueDate or appreciation rate: use static propData.value
    //   2. Otherwise, iterate month-by-month from valueDate to today
    //   3. For each month, check if we're in a specific appreciation phase
    //   4. Apply phase-specific rate (if available) or default appreciation rate
    //   5. Compound: val = val × (1 + rate/12) each month
    //
    // This allows modeling: acquisition at 500k (Jan 2024), appreciates 2% Year 1, then 1% Year 2+
    const propMeta0 = IC.properties[loanKey] || {};
    const appreciationRate0 = propMeta0.appreciation || 0;
    let currentValue = propData.value;
    const valueDateStr = propData.valueDate || null;
    if (valueDateStr && appreciationRate0 > 0) {
      const [vy, vm] = valueDateStr.split('-').map(Number);
      const now0 = new Date();
      const monthsSinceRef = (now0.getFullYear() - vy) * 12 + (now0.getMonth() + 1 - vm);
      if (monthsSinceRef > 0) {
        // Use phase-specific rates if available (e.g., different appreciation by year)
        const phases = propMeta0.appreciationPhases || [];
        let val = propData.value;
        let refYear = vy;
        let refMonth = vm;
        for (let m = 0; m < monthsSinceRef; m++) {
          const yr = refYear + Math.floor((refMonth + m - 1) / 12);
          let rate = appreciationRate0;
          // Check if current month falls into a phase with custom rate
          for (const ph of phases) { if (yr >= ph.start && yr <= ph.end) { rate = ph.rate; break; } }
          val *= (1 + rate / 12);
        }
        currentValue = Math.round(val);
      }
    }
    // Replace propData.value with currentValue everywhere below
    const _val = currentValue;
    const _refValue = propData.value;
    const _refDate = valueDateStr;

    // ── Monthly charges computation ──
    // Total charges: loan payment (principal + interest) + insurance + property taxes + transfer tax + copro
    const charges = chargesConfig.pret + chargesConfig.assurance + chargesConfig.pno + chargesConfig.tf + chargesConfig.copro;

    // ── Monthly revenue computation ──
    // loyerHC: base rent (excluding tenant charges provision, e.g., "€1200 HC")
    const loyerHC = propData.loyerHC !== undefined ? propData.loyerHC : (propData.loyer || 0);
    const parking = propData.parking || 0;           // Parking revenue (if applicable)
    const chargesLoc = propData.chargesLocataire || 0;  // Tenant charges provision (e.g., "€200 charges")
    const loyer = loyerHC + parking;                 // Total rent for display (HC+parking)
    const totalRevenue = loyer + chargesLoc;         // Full revenue including charges provision

    // Monthly cash flow: totalRevenue - charges (can be negative if effort épargne)
    const cf = totalRevenue - charges;
    const amort = amortSchedules[loanKey];

    // Fiscal: use explicit declared amount if available, else all rent is declared
    const loyerDeclareAnnuel = propData.loyerDeclare
      ? propData.loyerDeclare * 12
      : loyerHC * 12;
    const loyerTotalAnnuel = totalRevenue * 12;

    // Fiscal calculation
    const loanInterestAnnuel = amort
      ? amort.schedule.slice(amort.currentIdx, amort.currentIdx + 12).reduce((s, r) => s + r.interest, 0)
      : 0;
    // Charges déductibles : PNO + TF + copro + assurance emprunteur (pour régime réel)
    const deductibleCharges = chargesConfig.pno + chargesConfig.tf + chargesConfig.copro + chargesConfig.assurance;
    const fisc = IC.fiscalite && IC.fiscalite[loanKey]
      ? computeFiscalite(loyerDeclareAnnuel, loyerTotalAnnuel, deductibleCharges, IC.fiscalite[loanKey], loanInterestAnnuel)
      : null;

    const cfNetFiscal = fisc ? cf - fisc.monthlyImpot : cf;

    // Use computed CRD from amort schedule if available (more accurate than static snapshot)
    // Daily proration: interpolate CRD between monthly schedule entries so equity
    // changes smoothly day-by-day instead of jumping on the 1st of each month.
    let computedCRD;
    if (amort && amort.schedule.length > 0) {
      const idx = amort.currentIdx;
      const currentRow = amort.schedule[idx];
      if (currentRow) {
        // CRD at start of current month (before this month's payment)
        const crdBefore = idx > 0
          ? amort.schedule[idx - 1].remainingCRD
          : currentRow.remainingCRD + currentRow.principal; // reconstruct initial CRD
        // CRD at end of current month (after payment)
        const crdAfter = currentRow.remainingCRD;
        // Interpolate: day 1 → crdBefore, last day → ~crdAfter
        const now = new Date();
        const dom = now.getDate();
        const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        computedCRD = crdBefore - (crdBefore - crdAfter) * ((dom - 1) / dim);
      } else {
        computedCRD = propData.crd;
      }
    } else {
      computedCRD = propData.crd;
    }

    // Loan details for detail panel
    /**
     * Get current period payment for multi-period loans (variable rate/amortization)
     *
     * Multi-period loans have different payment amounts across periods, e.g.:
     *   Period 1 (months 0-60): 300 EUR/month (interest-only or partial amortization)
     *   Period 2 (months 60-300): 400 EUR/month (full amortization)
     *
     * Algorithm:
     *   1. If loan has monthlyPayment, it's a standard constant-payment loan → return it
     *   2. Parse loan.startDate to get start year/month
     *   3. Calculate months elapsed from start date to today
     *   4. Iterate through loan.periods, accumulating months until we exceed elapsed months
     *   5. Return the payment amount for the current period
     *   6. If past all periods, return the last period's payment
     *
     * @param {Object} loan - Loan object with optional periods array: [{months, payment}, ...]
     * @returns {number} Current monthly payment amount
     */
    function getCurrentPeriodPayment(loan) {
      if (loan.monthlyPayment) return loan.monthlyPayment;
      if (!loan.periods || !loan.startDate) return 0;
      const [sy, sm] = loan.startDate.split('-').map(Number);
      const now = new Date();
      const monthsElapsed = (now.getFullYear() - sy) * 12 + (now.getMonth() + 1 - sm);
      let cumMonths = 0;
      for (const p of loan.periods) {
        cumMonths += p.months;
        if (monthsElapsed < cumMonths) return p.payment;
      }
      // Past all periods → return last period payment
      return loan.periods[loan.periods.length - 1].payment;
    }

    /**
     * Find current period index in multi-period loan (0-based)
     *
     * Returns the index (0, 1, 2, ...) of which period the loan is currently in.
     * Used for UI highlighting and period-specific analytics.
     *
     * @param {Object} loan - Loan object with periods array
     * @returns {number} Current period index (0-based), or -1 if no periods or not started
     */
    function getCurrentPeriodIndex(loan) {
      if (!loan.periods || !loan.startDate) return -1;
      const [sy, sm] = loan.startDate.split('-').map(Number);
      const now = new Date();
      const monthsElapsed = (now.getFullYear() - sy) * 12 + (now.getMonth() + 1 - sm);
      let cumMonths = 0;
      for (let i = 0; i < loan.periods.length; i++) {
        cumMonths += loan.periods[i].months;
        if (monthsElapsed < cumMonths) return i;
      }
      return loan.periods.length - 1;
    }

    const subLoansKey = loanKey + 'Loans';
    let loanDetails = [];
    if (IC.loans && IC.loans[subLoansKey]) {
      loanDetails = IC.loans[subLoansKey].map(l => ({
        name: l.name, principal: l.principal, rate: l.rate,
        durationMonths: l.durationMonths,
        monthlyPayment: getCurrentPeriodPayment(l),
        periods: l.periods || null,           // pass full schedule for render
        currentPeriodIndex: getCurrentPeriodIndex(l),  // which period we're in now
        startDate: l.startDate || null,
        insuranceMonthly: l.insuranceMonthly || 0,
      }));
    } else if (IC.loans && IC.loans[loanKey]) {
      const l = IC.loans[loanKey];
      loanDetails = [{ name: 'Prêt principal', principal: l.principal, rate: l.rate,
        durationMonths: l.durationMonths, monthlyPayment: l.monthlyPayment,
        periods: null, currentPeriodIndex: -1, startDate: l.startDate || null,
        insuranceMonthly: l.insurance || 0 }];
    }

    // ── Exit costs at current date ──
    const propMeta = IC.properties[loanKey] || {};
    const purchasePrice = propMeta.purchasePrice || propMeta.totalOperation || propData.value;
    const purchaseDateStr = propMeta.purchaseDate || '2023-01';
    const [py, pm] = purchaseDateStr.split('-').map(Number);
    const now = new Date();
    const holdingYears = (now.getFullYear() - py) + (now.getMonth() + 1 - pm) / 12;
    // Estimate total amortissements (LMNP réel) — from lmnpStartDate, not purchaseDate
    const fiscConfig2 = IC.fiscalite && IC.fiscalite[loanKey];
    const fiscType = fiscConfig2 ? fiscConfig2.type : 'nu';
    let lmnpYears = holdingYears;
    if (fiscType === 'lmnp' && fiscConfig2 && fiscConfig2.lmnpStartDate) {
      const [ly, lm] = fiscConfig2.lmnpStartDate.split('-').map(Number);
      lmnpYears = Math.max(0, (now.getFullYear() - ly) + (now.getMonth() + 1 - lm) / 12);
    }
    const totalAmort = fiscType === 'lmnp' ? Math.round((purchasePrice * 0.80) * 0.02 * Math.max(0, lmnpYears)) : 0;
    // Build per-loan CRDs for IRA computation
    let loanCRDs = null;
    if (amort && amort.subSchedules) {
      const subLoansConfig = IC.loans[loanKey + 'Loans'] || [];
      loanCRDs = amort.subSchedules.map((sub, i) => {
        const lastRow = sub.schedule[sub.schedule.length - 1];
        // Find current month row
        const nowStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        const currentRow = sub.schedule.find(r => r.date === nowStr) || sub.schedule.find(r => r.date >= nowStr) || lastRow;
        return {
          name: sub.name,
          crd: currentRow ? currentRow.remainingCRD : 0,
          rate: subLoansConfig[i] ? subLoansConfig[i].rate : 0,
        };
      });
    } else if (IC.loans && IC.loans[loanKey]) {
      loanCRDs = [{ name: 'Prêt principal', crd: computedCRD, rate: IC.loans[loanKey].rate || 0 }];
    }
    const exitCosts = computeExitCosts(loanKey, _val, purchasePrice, holdingYears, computedCRD, totalAmort, null, loanCRDs);

    // ── PV Abattement schedule (for chart visualization) ──
    const pvAbattementSchedule = computePVAbattementSchedule();

    // ── Wealth creation breakdown (three components) ──
    // 1. Capital amortization: monthly principal repayment (reduces CRD, increases equity)
    const currentAmortRow = amort ? amort.schedule[amort.currentIdx] : null;
    const capitalAmortiMois = currentAmortRow ? currentAmortRow.principal : 0;

    // 2. Appreciation: property value growth from market appreciation rate
    const appreciationRate = (IC.properties[loanKey] || {}).appreciation || 0;
    const appreciationMois = _val * appreciationRate / 12;

    // 3. Cash flow: monthly surplus (negative if "effort épargne" — self-funded repairs/costs)
    // For conditional properties (not yet signed / not delivered): no CF, no capital amortization
    // Only appreciation counts for properties not yet generating revenue
    const wealthCF = conditional ? 0 : cf;
    const wealthCapital = conditional ? 0 : capitalAmortiMois;

    // Total wealth creation = capital amortization + appreciation + cashflow
    const wealthCreationComputed = wealthCapital + appreciationMois + wealthCF;

    return {
      name, owner, conditional: conditional || false,
      value: _val, referenceValue: _refValue, valueDate: _refDate,
      crd: computedCRD, equity: _val - computedCRD,
      ltv: (computedCRD / _val * 100),
      monthlyPayment: chargesConfig.pret + chargesConfig.assurance,
      monthlyPret: chargesConfig.pret,
      monthlyAssurance: chargesConfig.assurance,
      loyer, loyerHC, chargesLoc, parking, totalRevenue, cf,
      yieldGross: (totalRevenue * 12 / _val * 100),
      yieldNet: (cf * 12 / _val * 100),
      yieldNetFiscal: fisc ? (cfNetFiscal * 12 / _val * 100) : null,
      wealthCreation: Math.round(wealthCreationComputed),
      wealthBreakdown: {
        capitalAmorti: Math.round(capitalAmortiMois),
        appreciation: Math.round(appreciationMois),
        cashflow: Math.round(wealthCF),
        effortEpargne: wealthCF < 0 ? Math.round(Math.abs(wealthCF)) : 0,
      },
      endYear: IC.prets[loanKey + 'End'],
      charges,
      chargesDetail: { ...chargesConfig },
      loanKey,
      loanDetails,
      fiscalite: fisc,
      cfNetFiscal,
      purchasePrice,
      propertyMeta: IC.properties[loanKey] || {},
      loanInterestAnnuel,
      deductibleChargesAnnuel: deductibleCharges * 12,
      loyerDeclareAnnuel,
      exitCosts,
      pvAbattementSchedule,
    };
  }

  properties.push(buildProperty('Vitry-sur-Seine', 'Amine', portfolio.amine.immo.vitry, IC.charges.vitry, 'vitry'));
  properties.push(buildProperty('Rueil-Malmaison', 'Nezha', portfolio.nezha.immo.rueil, IC.charges.rueil, 'rueil'));
  properties.push(buildProperty('Villejuif (VEFA)', 'Nezha', portfolio.nezha.immo.villejuif, IC.charges.villejuif, 'villejuif', true));

  // ── Yearly interest schedule per loan (for fiscal simulation) ──
  function yearlyInterestFromSchedule(amortObj) {
    const yearly = {};
    if (!amortObj || !amortObj.schedule) return yearly;
    // Use the combined schedule directly — each row has a date field "YYYY-MM"
    for (let i = 0; i < amortObj.schedule.length; i++) {
      const row = amortObj.schedule[i];
      const y = parseInt(row.date.split('-')[0]);
      yearly[y] = (yearly[y] || 0) + row.interest;
    }
    return yearly;
  }

  const yearlyInterest = {};
  for (const key of loanKeys) {
    yearlyInterest[key] = yearlyInterestFromSchedule(amortSchedules[key]);
  }

  // Attach yearlyInterest and fiscal sim config to properties
  properties.forEach(prop => {
    prop.yearlyInterest = yearlyInterest[prop.loanKey] || {};
    // Vitry-specific fiscal simulation config
    if (prop.loanKey === 'vitry') {
      const propMeta = IC.properties.vitry || {};
      const april = IC.loans.vitryInsuranceAPRIL || {};
      const alInsurance = (IC.loans.vitryLoans && IC.loans.vitryLoans[0]) ? IC.loans.vitryLoans[0].insuranceMonthly * 12 : 0;
      const vitryProp = portfolio.amine.immo.vitry;

      /**
       * Vitry fiscal config derivation logic:
       *
       * contractStartMonth: Derived from property delivery date + rental start offset
       *   - deliveryDate in propMeta: '2025-07' (July 2025)
       *   - Rental contract starts ~9 months later in April 2026 (month 4)
       *   - General formula: (deliveryMonth + offsetMonths - 1) % 12 + 1
       *   - For Vitry: (7 + 9 - 1) % 12 + 1 = 4 (April) ✓
       *
       * tfExemptionEndYear: New construction property tax exemption lasts 2 years from delivery
       *   - deliveryDate year: 2025
       *   - TF exemption window: 2025-2026 (delivery year + 2)
       *   - Exemption ends start of year 2027 → tfExemptionEndYear = 2027
       *
       * startYear: Use delivery year as baseline (or current calendar year if later)
       *   - Reflects when the property acquisition/fiscal event begins
       */
      let contractStartMonth = 4;    // Default: April 2026
      let tfExemptionEndYear = 2027; // Default: 2 years from 2025 delivery
      let startYear = 2026;          // Default: use current/operational year

      if (propMeta.deliveryDate) {
        const [deliveryYear, deliveryMonth] = propMeta.deliveryDate.split('-').map(Number);
        // contractStartMonth: derive from delivery + 9 month offset (delivery in July → rental in April next year)
        const rentalOffsetMonths = 9;
        contractStartMonth = ((deliveryMonth + rentalOffsetMonths - 1) % 12) + 1;
        // tfExemptionEndYear: TF exemption for new construction = 2 years from delivery
        tfExemptionEndYear = deliveryYear + 2;
        // startYear: use delivery year
        startYear = deliveryYear;
      }

      prop.fiscalSimConfig = {
        loyerTotalCC: vitryProp.loyerTotalCC || propMeta.loyerObjectif || 1200,
        loyerDeclareCC: vitryProp.loyerDeclareCC || 600,
        contractStartMonth: contractStartMonth,
        tfExemptionEndYear: tfExemptionEndYear,
        startYear: startYear,
        nYears: 10,
        totalRate: (IC.fiscalite.vitry.tmi + IC.fiscalite.vitry.ps),
        tmi: IC.fiscalite.vitry.tmi,
        ps: IC.fiscalite.vitry.ps,
        totalAssuranceAnnuel: (april.annualTTC || 0) + alInsurance,
        pnoAnnuel: IC.charges.vitry.pno * 12,
        tfAnnuel: IC.charges.vitry.tf * 12,
        coproMensuel: IC.charges.vitry.copro,
      };
    }
    // Villejuif VEFA timeline
    if (prop.loanKey === 'villejuif') {
      const franchise = IC.loans.villejuifFranchise || {};
      const propMeta = IC.properties.villejuif || {};
      prop.vefaConfig = {
        franchiseMonths: franchise.months || 36,
        franchiseStart: franchise.startDate || null,
        loanDisbursed: franchise.loanDisbursed !== undefined ? franchise.loanDisbursed : true,
        deliveryDate: propMeta.deliveryDate || '2028-03',
        totalOperation: propMeta.totalOperation || 0,
        fraisDossier: franchise.fraisDossier || 0,
      };
    }
  });

  const totalEquity = properties.reduce((s, p) => s + p.equity, 0);
  const totalValue = properties.reduce((s, p) => s + p.value, 0);
  const totalCRD = properties.reduce((s, p) => s + p.crd, 0);
  const totalCF = properties.reduce((s, p) => s + p.cf, 0);
  const totalWealthCreation = properties.reduce((s, p) => s + p.wealthCreation, 0);
  const totalWealthBreakdown = {
    capitalAmorti: properties.reduce((s, p) => s + (p.wealthBreakdown ? p.wealthBreakdown.capitalAmorti : 0), 0),
    appreciation: properties.reduce((s, p) => s + (p.wealthBreakdown ? p.wealthBreakdown.appreciation : 0), 0),
    cashflow: properties.reduce((s, p) => s + (p.wealthBreakdown ? p.wealthBreakdown.cashflow : 0), 0),
  };
  const avgLTV = totalValue > 0 ? (totalCRD / totalValue * 100) : 0;

  // Fiscal totals
  const totalImpotAnnuel = properties.reduce((s, p) => s + (p.fiscalite ? p.fiscalite.totalImpot : 0), 0);
  const totalLoyerAnnuel = properties.reduce((s, p) => s + (p.totalRevenue || p.loyer) * 12, 0);
  const totalCFNetFiscal = properties.reduce((s, p) => s + (p.cfNetFiscal || p.cf), 0);

  // Amortization totals
  const totalInterestPaid = Object.values(amortSchedules).reduce((s, a) => s + a.interestPaid, 0);
  const totalInterestRemaining = Object.values(amortSchedules).reduce((s, a) => s + a.interestRemaining, 0);

  // Exit costs totals
  const totalExitCosts = properties.reduce((s, p) => s + (p.exitCosts ? p.exitCosts.totalExitCosts : 0), 0);
  const totalNetEquityAfterExit = properties.reduce((s, p) => s + (p.exitCosts ? p.exitCosts.netEquityAfterExit : 0), 0);

  // Villejuif regime comparison
  let villejuifRegimeComparison = null;
  try {
    villejuifRegimeComparison = computeVillejuifRegimeComparison();
  } catch (e) {
    console.warn('Villejuif regime comparison failed:', e);
  }

  // ── Wealth creation projection (through end of 2046) ──
  const projNow = new Date();
  const projStartY = projNow.getFullYear();
  const projStartM = projNow.getMonth(); // 0-based
  // Calculate months to reach Dec 2046 (inclusive)
  const projEndY = projStartY + 20; // 2046
  const projectionMonths = (projEndY - projStartY) * 12 + (12 - projStartM); // through Dec 2046

  // Pre-compute per-property charge breakdown for projection:
  // - Fixed charges: prêt + assurance (stop when loan ends)
  // - Variable charges: TF + copro + PNO (grow with inflation)
  const chargesInflation = 0.02; // 2%/an inflation on TF, copro, PNO
  const irlRate = 0.015;         // 1.5%/an IRL indexation on rent

  const propChargeBreakdown = {};
  properties.forEach(prop => {
    const cd = prop.chargesDetail || IC.charges[prop.loanKey] || {};
    propChargeBreakdown[prop.loanKey] = {
      fixedMonthly: (cd.pret || 0) + (cd.assurance || 0),  // stops when loan ends
      variableMonthly: (cd.pno || 0) + (cd.tf || 0) + (cd.copro || 0),  // grows with inflation
    };
  });

  // ── Pre-compute exit costs per year for the projection (total + per property) ──
  // Exit costs decrease over time (PV abattements, TVA clawback, IRA) → the reduction = wealth created
  const exitCostsByYear = {};      // { year: totalExitCosts }
  const exitCostsByYearProp = {};  // { year: { loanKey: exitCosts } }
  const projLoanKeys = properties.map(p => p.loanKey);
  for (let yr = projStartY; yr <= projEndY; yr++) {
    let totalEC = 0;
    const perPropEC = {};
    projLoanKeys.forEach(lk => {
      const prop = properties.find(p => p.loanKey === lk);
      const amort = amortSchedules[lk];
      const propMeta = IC.properties[lk] || {};
      const appreciationRate = propMeta.appreciation || 0;
      const purchasePrice = propMeta.purchasePrice || propMeta.totalOperation || prop.value;
      const purchaseDateStr = propMeta.purchaseDate || '2023-01';
      const [pY2] = purchaseDateStr.split('-').map(Number);
      // Projected value with compound appreciation
      const phases = propMeta.appreciationPhases || [];
      let projValue = prop.value;
      for (let yy = projStartY; yy < yr; yy++) {
        let rate = appreciationRate;
        for (const ph of phases) { if (yy >= ph.start && yy <= ph.end) { rate = ph.rate; break; } }
        projValue *= (1 + rate);
      }
      // CRD at that year (from amort schedule, ~June)
      const sched = amort ? amort.schedule : null;
      let crd = 0;
      if (sched) {
        const dateJune = yr + '-06';
        const row = sched.find(r => r.date === dateJune) || sched.find(r => r.date >= dateJune);
        crd = row ? row.remainingCRD : 0;
      }
      // LMNP amortissements — from lmnpStartDate, not purchaseDate
      const fiscConfig = IC.fiscalite && IC.fiscalite[lk];
      const fiscType = fiscConfig ? fiscConfig.type : 'nu';
      let lmnpYearsProj = yr - pY2; // default: years since purchase
      if (fiscType === 'lmnp' && fiscConfig && fiscConfig.lmnpStartDate) {
        const [ly] = fiscConfig.lmnpStartDate.split('-').map(Number);
        lmnpYearsProj = Math.max(0, yr - ly);
      }
      const totalAmort = fiscType === 'lmnp' ? Math.round((purchasePrice * 0.80) * 0.02 * Math.max(0, lmnpYearsProj)) : 0;
      // Per-loan CRDs for IRA
      let loanCRDs = null;
      if (amort && amort.subSchedules) {
        const subLoansConfig = IC.loans[lk + 'Loans'] || [];
        loanCRDs = amort.subSchedules.map((sub, i) => {
          const subRow = sub.schedule.find(r => r.date === yr + '-06') || sub.schedule.find(r => r.date >= yr + '-06');
          return { name: sub.name, crd: subRow ? subRow.remainingCRD : 0, rate: subLoansConfig[i] ? subLoansConfig[i].rate : 0 };
        });
      } else if (IC.loans && IC.loans[lk]) {
        loanCRDs = [{ name: 'Prêt principal', crd: crd, rate: IC.loans[lk].rate || 0 }];
      }
      try {
        const ec = computeExitCostsAtYear(lk, yr, projValue, purchasePrice, crd, totalAmort, loanCRDs);
        totalEC += ec.totalExitCosts;
        perPropEC[lk] = ec.totalExitCosts;
      } catch(e) { perPropEC[lk] = 0; }
    });
    exitCostsByYear[yr] = totalEC;
    exitCostsByYearProp[yr] = perPropEC;
  }

  // For each property: extract month-by-month capital repayment from amort schedule
  // and compute appreciation + CF for each future month
  const wealthProjection = [];
  for (let m = 0; m < projectionMonths; m++) {
    const y = projStartY + Math.floor((projStartM + m) / 12);
    const mo = ((projStartM + m) % 12) + 1;
    const dateStr = y + '-' + String(mo).padStart(2, '0');

    let totalCapital = 0, totalApprec = 0, totalCashflow = 0;
    const perProp = {};

    properties.forEach(prop => {
      const lk = prop.loanKey;
      const amort = amortSchedules[lk];
      const propMeta = IC.properties[lk] || {};
      const defaultRate = propMeta.appreciation || 0;
      const phases = propMeta.appreciationPhases || [];

      // Is this property operational at month m?
      const isVillejuif = lk === 'villejuif';
      const vilStartMonth = IC.villejuifStartMonth || 40;
      const isOperationalAtM = isVillejuif ? (m >= vilStartMonth) : !prop.conditional;

      // Capital from amort schedule (look up the schedule row for this date)
      let capitalM = 0;
      let loanActive = false;
      if (amort && amort.schedule) {
        const row = amort.schedule.find(r => r.date === dateStr);
        if (row) {
          capitalM = row.principal;
          loanActive = true; // still within loan period
        }
      }

      // Appreciation: compound year by year using phased rates
      const yearsFromNow = m / 12;
      let compoundedValue = prop.value;
      let currentRate = defaultRate;
      for (let yr = projStartY; yr < y; yr++) {
        let rate = defaultRate;
        for (const ph of phases) { if (yr >= ph.start && yr <= ph.end) { rate = ph.rate; break; } }
        compoundedValue *= (1 + rate);
        currentRate = rate;
      }
      // Partial year for current year
      const partialMonths = mo - 1; // months elapsed in current year
      if (partialMonths > 0) {
        let rate = defaultRate;
        for (const ph of phases) { if (y >= ph.start && y <= ph.end) { rate = ph.rate; break; } }
        compoundedValue *= Math.pow(1 + rate, partialMonths / 12);
        currentRate = rate;
      }
      const appreciationM = compoundedValue * currentRate / 12;

      // Cash flow: when operational, with IRL rent growth + charge inflation + loan end detection
      let cfM = 0;
      if (isOperationalAtM) {
        const yearsOperational = isVillejuif ? (m - vilStartMonth) / 12 : yearsFromNow;

        // Revenue grows with IRL
        const revenueGrowthFactor = Math.pow(1 + irlRate, Math.max(0, yearsOperational));
        const grownRevenue = prop.totalRevenue * revenueGrowthFactor;

        // Charges: fixed (prêt) only if loan still active, variable grow with inflation
        const cbd = propChargeBreakdown[lk];
        const fixedCharges = loanActive ? cbd.fixedMonthly : 0; // prêt+assurance stop when loan ends
        const variableCharges = cbd.variableMonthly * Math.pow(1 + chargesInflation, yearsFromNow);

        cfM = grownRevenue - fixedCharges - variableCharges;
      }

      // For conditional but not yet operational: only appreciation counts
      const effCapital = isOperationalAtM ? capitalM : 0;
      const effCF = isOperationalAtM ? cfM : 0;

      // Per-property exit cost savings (same fallback logic as total: first year → 0 savings)
      const thisPropEC = (exitCostsByYearProp[y] || {})[lk] || 0;
      const prevPropEC = exitCostsByYearProp[y - 1] !== undefined
        ? (exitCostsByYearProp[y - 1][lk] || 0)
        : thisPropEC; // first year: no previous → use current → savings = 0
      const propExitSaving = (prevPropEC - thisPropEC) / 12; // positive = savings, negative = cost increase

      perProp[lk] = {
        capital: Math.round(effCapital),
        appreciation: Math.round(appreciationM),
        cashflow: Math.round(effCF),
        exitSavings: Math.round(propExitSaving),
        total: Math.round(effCapital + appreciationM + effCF + propExitSaving),
      };

      totalCapital += effCapital;
      totalApprec += appreciationM;
      totalCashflow += effCF;
    });

    // Exit cost savings: monthly share of the year-over-year reduction (total)
    const prevYearEC = exitCostsByYear[y - 1] !== undefined ? exitCostsByYear[y - 1] : exitCostsByYear[y];
    const thisYearEC = exitCostsByYear[y] !== undefined ? exitCostsByYear[y] : 0;
    const annualExitSaving = prevYearEC - thisYearEC; // positive = savings, negative = cost increase
    const monthlyExitSaving = annualExitSaving / 12;

    wealthProjection.push({
      date: dateStr,
      month: m,
      capital: Math.round(totalCapital),
      appreciation: Math.round(totalApprec),
      cashflow: Math.round(totalCashflow),
      exitSavings: Math.round(monthlyExitSaving),
      total: Math.round(totalCapital + totalApprec + totalCashflow + monthlyExitSaving),
      perProp,
    });
  }

  return {
    properties,
    totalEquity, totalValue, totalCRD,
    totalCF, totalWealthCreation, totalWealthBreakdown,
    avgLTV,
    amortSchedules,
    totalInterestPaid,
    totalInterestRemaining,
    totalImpotAnnuel,
    totalLoyerAnnuel,
    totalCFNetFiscal,
    totalExitCosts,
    totalNetEquityAfterExit,
    villejuifRegimeComparison,
    vitryConstraints: VITRY_CONSTRAINTS,
    exitCostsConfig: EXIT_COSTS,
    exitCostsByYear,
    exitCostsByYearProp,
    wealthProjection,
  };
}

/**
 * Compute creances view data
 */
function computeCreancesView(portfolio, fx) {
  const allItems = [];
  const today = new Date();

  function processCreance(c, owner) {
    const amountEUR = toEUR(c.amount, c.currency, fx);
    const paymentsTotal = (c.payments || []).reduce((s, p) => s + toEUR(p.amount, c.currency, fx), 0);
    const remainingEUR = amountEUR - paymentsTotal;
    const expectedValue = remainingEUR * (c.probability || 1);
    const monthlyInflationCost = !c.delayDays ? (remainingEUR * INFLATION_RATE / 12) : 0;

    // Recouvrement tracking
    let daysOverdue = 0;
    if (c.dueDate) {
      const due = new Date(c.dueDate);
      if (today > due) daysOverdue = Math.floor((today - due) / 86400000);
    }
    let daysSinceContact = 0;
    if (c.lastContact) {
      daysSinceContact = Math.floor((today - new Date(c.lastContact)) / 86400000);
    }
    const needsFollowUp = daysSinceContact > 30 && c.status !== 'recouvré';
    const recoveryPct = amountEUR > 0 ? (paymentsTotal / amountEUR * 100) : 0;

    return {
      ...c,
      amountEUR,
      paymentsTotal,
      remainingEUR,
      expectedValue,
      monthlyInflationCost,
      daysOverdue,
      daysSinceContact,
      needsFollowUp,
      recoveryPct,
      owner,
    };
  }

  // Amine creances
  (portfolio.amine.creances.items || []).forEach(c => allItems.push(processCreance(c, 'Amine')));

  // Nezha creances
  (portfolio.nezha.creances ? portfolio.nezha.creances.items : []).forEach(c => allItems.push(processCreance(c, 'Nezha')));

  // Split active vs recouvré
  const activeItems = allItems.filter(i => i.status !== 'recouvré');
  const recoveredItems = allItems.filter(i => i.status === 'recouvré');

  // ── Facturation positions → créances (positive) or dettes (negative) ──
  const factuCreances = [];  // receivables from facturation (positive amounts = they owe Amine)
  const dettes = [];
  // TVA
  if (portfolio.amine.tva && portfolio.amine.tva < 0) {
    dettes.push({ label: 'TVA à payer', amount: Math.abs(portfolio.amine.tva), currency: 'EUR', amountEUR: Math.abs(portfolio.amine.tva), owner: 'Amine', type: 'pro' });
  }
  // Facturation: localStorage bridge or data.js fallback
  let _factuPositions = null;
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem('facturation_positions');
    if (raw) _factuPositions = JSON.parse(raw);
  } catch(e) {}

  if (_factuPositions) {
    const augustinMAD = _factuPositions.augustin && _factuPositions.augustin.mad != null ? _factuPositions.augustin.mad : 0;
    const benoitDH = _factuPositions.benoit && _factuPositions.benoit.dh != null ? _factuPositions.benoit.dh : 0;
    // Positive = they owe Amine → créance
    if (augustinMAD > 0) {
      const amountEUR = toEUR(augustinMAD, 'MAD', fx);
      factuCreances.push({
        label: 'Facturation — Augustin (Azarkan) me doit', amount: augustinMAD, currency: 'MAD',
        amountEUR, paymentsTotal: 0, remainingEUR: amountEUR, expectedValue: amountEUR,
        monthlyInflationCost: 0, daysOverdue: 0, daysSinceContact: 0, needsFollowUp: false,
        recoveryPct: 0, owner: 'Amine', type: 'pro', guaranteed: true, probability: 1.0,
        status: 'en_cours', payments: [], notes: 'Position facturation inter-personnes (localStorage)',
      });
    } else if (augustinMAD < 0) {
      dettes.push({ label: 'Augustin (Azarkan)', amount: Math.abs(augustinMAD), currency: 'MAD', amountEUR: toEUR(Math.abs(augustinMAD), 'MAD', fx), owner: 'Amine', type: 'pro' });
    }
    // Negative = Amine owes → dette
    if (benoitDH < 0) {
      dettes.push({ label: 'Benoit (Badre)', amount: Math.abs(benoitDH), currency: 'MAD', amountEUR: toEUR(Math.abs(benoitDH), 'MAD', fx), owner: 'Amine', type: 'pro' });
    } else if (benoitDH > 0) {
      const amountEUR = toEUR(benoitDH, 'MAD', fx);
      factuCreances.push({
        label: 'Facturation — Benoit (Badre) me doit', amount: benoitDH, currency: 'MAD',
        amountEUR, paymentsTotal: 0, remainingEUR: amountEUR, expectedValue: amountEUR,
        monthlyInflationCost: 0, daysOverdue: 0, daysSinceContact: 0, needsFollowUp: false,
        recoveryPct: 0, owner: 'Amine', type: 'pro', guaranteed: true, probability: 1.0,
        status: 'en_cours', payments: [], notes: 'Position facturation inter-personnes (localStorage)',
      });
    }
  } else if (portfolio.amine.facturation) {
    // Fallback to data.js hardcoded values
    Object.entries(portfolio.amine.facturation).forEach(([key, pos]) => {
      const amountEUR = toEUR(Math.abs(pos.amount), pos.currency, fx);
      if (pos.amount > 0) {
        // Receivable
        factuCreances.push({
          label: pos.label || key, amount: pos.amount, currency: pos.currency,
          amountEUR, paymentsTotal: 0, remainingEUR: amountEUR, expectedValue: amountEUR,
          monthlyInflationCost: 0, daysOverdue: 0, daysSinceContact: 0, needsFollowUp: false,
          recoveryPct: 0, owner: 'Amine', type: 'pro', guaranteed: true, probability: 1.0,
          status: 'en_cours', payments: [], notes: pos.notes || 'Position facturation (data.js)',
        });
      } else if (pos.amount < 0) {
        // Debt
        dettes.push({ label: pos.label || key, amount: Math.abs(pos.amount), currency: pos.currency, amountEUR, owner: 'Amine', type: 'pro' });
      }
    });
  }

  // Inject facturation receivables into active items
  activeItems.push(...factuCreances);

  // ── KPIs (computed AFTER facturation injection so totals include Augustin etc.) ──
  const totalNominal = activeItems.reduce((s, i) => s + i.amountEUR, 0);
  const totalExpected = activeItems.reduce((s, i) => s + i.expectedValue, 0);
  const totalGuaranteed = activeItems.filter(i => i.guaranteed).reduce((s, i) => s + i.amountEUR, 0);
  const totalUncertain = activeItems.filter(i => !i.guaranteed).reduce((s, i) => s + i.amountEUR, 0);
  const monthlyInflationCost = activeItems.reduce((s, i) => s + i.monthlyInflationCost, 0);
  const totalRecovered = recoveredItems.reduce((s, i) => s + i.paymentsTotal, 0);
  const totalOverdue = activeItems.filter(i => i.daysOverdue > 0).reduce((s, i) => s + i.remainingEUR, 0);
  const needsFollowUpCount = activeItems.filter(i => i.needsFollowUp).length;

  const totalDettes = dettes.reduce((s, d) => s + d.amountEUR, 0);

  return {
    items: allItems,
    activeItems,
    recoveredItems,
    totalNominal,
    totalExpected,
    totalGuaranteed,
    totalUncertain,
    monthlyInflationCost,
    totalRecovered,
    totalOverdue,
    needsFollowUpCount,
    dettes,
    totalDettes,
  };
}

/**
 * Compute budget view: monthly expense tracking and forecasting
 *
 * Separates personal living expenses from investment (real estate) expenses.
 * Supports multiple frequencies (monthly, quarterly, yearly) and currencies (EUR, USD, MAD, AED).
 *
 * Personal expenses (from BUDGET_EXPENSES constant):
 *   - Living: housing, utilities, food, transport, healthcare
 *   - Subscriptions: streaming, memberships, insurance
 *   - Discretionary: travel, hobbies, dining
 *   - By zone: FR, UAE, MOROCCO
 *   - By type: housing, transport, health, discretionary, etc.
 *
 * Investment expenses (from IMMO_CONSTANTS.charges):
 *   - Loan payments (principal + interest)
 *   - Property insurance (assurance emprunteur)
 *   - Property taxes (taxe foncière)
 *   - Property management (copropriété)
 *   - Maintenance costs (per property)
 *
 * Aggregates:
 *   - Personal monthly total
 *   - Investment monthly total (by property)
 *   - Combined total
 *   - Breakdown by zone, type, currency
 *
 * @param {Object} portfolio - Portfolio data
 * @param {Object} fx - FX rates for currency conversion
 * @returns {Object} { personal, personalTotal, personalByZone, personalByType,
 *                     investment, investmentTotal, investmentByProperty,
 *                     combined, combinedTotal, ... }
 */
function computeBudgetView(portfolio, fx) {
  const IC = IMMO_CONSTANTS;
  const p = portfolio;

  // Frequency → monthly divisor
  const freqDiv = { monthly: 1, quarterly: 3, yearly: 12 };

  // Helper to build an item
  function makeItem(e) {
    const div = freqDiv[e.freq] || 1;
    const monthlyNative = e.amount / div;
    const monthlyEUR = e.currency === 'EUR' ? monthlyNative : monthlyNative / (fx[e.currency] || 1);
    return { label: e.label, amountNative: e.amount, currency: e.currency, freq: e.freq, monthlyNative, monthlyEUR, zone: e.zone, type: e.type };
  }

  // ── PERSONAL EXPENSES (from BUDGET_EXPENSES) ──
  const personal = BUDGET_EXPENSES.map(makeItem);
  personal.sort((a, b) => b.monthlyEUR - a.monthlyEUR);

  const personalTotal = personal.reduce((s, i) => s + i.monthlyEUR, 0);
  const personalByZone = {};
  const personalByType = {};
  personal.forEach(i => {
    personalByZone[i.zone] = (personalByZone[i.zone] || 0) + i.monthlyEUR;
    personalByType[i.type] = (personalByType[i.type] || 0) + i.monthlyEUR;
  });

  // ── INVESTMENT EXPENSES (from IMMO_CONSTANTS.charges) ──
  // Each property: prêt, assurance crédit, PNO, taxe foncière, copropriété
  // Villejuif: charges décalées — début après livraison Q1 2028 (franchise 36 mois depuis août 2025)
  const chargeLabels = { pret: 'Prêt', assurance: 'Assurance crédit', pno: 'PNO', tf: 'Taxe foncière', copro: 'Copropriété' };
  const propNames = { vitry: 'Vitry', rueil: 'Rueil', villejuif: 'Villejuif' };
  // Villejuif : promesse de vente, prêt pas débloqué. Seule l'assurance prêt est payée (51€/mois).
  // Les autres charges (prêt, PNO, TF, copro) démarreront après livraison (~Q1 2028).
  const villejuifActiveCharges = ['assurance']; // seules charges payées actuellement

  const investProperties = [];
  Object.entries(IC.charges).forEach(([prop, ch]) => {
    const isVillejuif = prop === 'villejuif';

    const items = [];
    let totalCharges = 0;
    let currentCharges = 0;
    Object.entries(ch).forEach(([key, val]) => {
      if (val > 0) {
        const isActive = isVillejuif ? villejuifActiveCharges.includes(key) : true;
        items.push({ label: chargeLabels[key] || key, monthlyEUR: val, active: isActive });
        totalCharges += val;
        if (isActive) currentCharges += val;
      }
    });

    // Get loyer from portfolio data (total revenue including charges provision)
    let loyer = 0;
    if (prop === 'vitry' && p.amine && p.amine.immo && p.amine.immo.vitry) {
      const v = p.amine.immo.vitry;
      loyer = (v.loyerHC || v.loyer || 0) + (v.parking || 0) + (v.chargesLocataire || 0);
    } else if (p.nezha && p.nezha.immo && p.nezha.immo[prop]) {
      const nz = p.nezha.immo[prop];
      loyer = (nz.loyerHC || nz.loyer || 0) + (nz.parking || 0) + (nz.chargesLocataire || 0);
    }

    // Villejuif: no loyer yet (not delivered)
    const currentLoyer = isVillejuif ? 0 : loyer;
    const cf = currentLoyer - currentCharges;
    const active = !isVillejuif; // fully active = all charges running

    investProperties.push({
      name: propNames[prop] || prop,
      prop,
      charges: items,
      totalCharges,        // Full future charges
      currentCharges,      // Currently paid (Villejuif: only assurance 51€)
      loyer: currentLoyer,
      futureLoyer: loyer,  // Expected loyer when delivered
      cf,
      active,              // false for Villejuif (partial)
    });
  });

  const investTotal = investProperties.reduce((s, p) => s + p.currentCharges, 0);
  const investLoyerTotal = investProperties.reduce((s, p) => s + p.loyer, 0);
  const investCFTotal = investLoyerTotal - investTotal;

  // ── GRAND TOTAL (personal only — investment is separate) ──
  const totalMonthly = personalTotal;
  const totalYearly = personalTotal * 12;

  return {
    personal, personalTotal, personalByZone, personalByType,
    investProperties, investTotal, investLoyerTotal, investCFTotal,
    totalMonthly, totalYearly,
  };
}

/**
 * Compute dividend/WHT analysis for actions view
 */
function computeDividendAnalysis(ibkrPositions, fx) {
  const today = new Date();
  const oneYearLater = new Date(today);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

  const positions = ibkrPositions.map(pos => {
    const divYield = DIV_YIELDS[pos.ticker] || 0;
    const whtRate = WHT_RATES[pos.geo] || WHT_RATES[pos.geo === 'crypto' ? 'crypto' : 'france'] || 0;
    const annualDivGross = pos.valEUR * divYield;
    const whtAmount = annualDivGross * whtRate;
    const netDiv = annualDivGross - whtAmount;

    // Calendar-based projection: DPS × shares → exact EUR amount
    const cal = DIV_CALENDAR[pos.ticker];
    let projectedDivEUR = 0;
    let projectedWHT = 0;
    let nextExDate = null;
    let daysUntilEx = null;
    let upcomingPayments = [];

    let dpsNative = 0;
    let dpsCurrency = pos.currency;

    if (cal && cal.dps > 0) {
      dpsNative = cal.dps;
      // Compute projected dividend in EUR from DPS × shares
      const totalDivNative = cal.dps * pos.shares;
      projectedDivEUR = toEUR(totalDivNative, pos.currency, fx);
      projectedWHT = projectedDivEUR * whtRate;

      // Find next upcoming ex-date
      const futureExDates = (cal.exDates || [])
        .map(d => new Date(d + 'T00:00:00'))
        .filter(d => d > today)
        .sort((a, b) => a - b);

      if (futureExDates.length > 0) {
        nextExDate = futureExDates[0];
        daysUntilEx = Math.ceil((nextExDate - today) / (1000 * 60 * 60 * 24));
      }

      // Build upcoming payments list
      upcomingPayments = futureExDates.map(d => ({
        exDate: d,
        daysUntil: Math.ceil((d - today) / (1000 * 60 * 60 * 24)),
      }));
    }

    let recommendation = 'keep';
    let reason = '';
    let alternativeETF = '';

    if (divYield > 0.02 && whtRate > 0.15) {
      recommendation = 'switch';
      reason = 'Div yield élevé + WHT élevée → switch vers ETF capitalisant';
      if (pos.geo === 'france') alternativeETF = 'Amundi CAC 40 UCITS ETF Acc (C40)';
      else if (pos.geo === 'germany') alternativeETF = 'iShares Core DAX UCITS ETF Acc';
      else alternativeETF = 'ETF capitalisant équivalent';
    } else if (divYield > 0 && divYield <= 0.02 && whtRate > 0) {
      recommendation = 'keep';
      reason = 'Div yield faible — impact WHT limité';
    } else if (divYield === 0) {
      recommendation = 'keep';
      reason = 'Pas de dividendes — aucune WHT';
    }

    return {
      ticker: pos.ticker,
      label: pos.label,
      valEUR: pos.valEUR,
      shares: pos.shares,
      currency: pos.currency,
      dpsNative,
      dpsCurrency,
      divYield,
      annualDivGross,
      whtRate,
      whtAmount,
      netDiv,
      projectedDivEUR,
      projectedWHT,
      nextExDate,
      daysUntilEx,
      upcomingPayments,
      recommendation,
      reason,
      alternativeETF,
    };
  }).sort((a, b) => {
    // Sort by urgency: nearest ex-date first among SWITCHER, then by WHT impact
    if (a.recommendation === 'switch' && b.recommendation !== 'switch') return -1;
    if (a.recommendation !== 'switch' && b.recommendation === 'switch') return 1;
    if (a.recommendation === 'switch' && b.recommendation === 'switch') {
      // Both switch: sort by nearest deadline
      if (a.daysUntilEx !== null && b.daysUntilEx !== null) return a.daysUntilEx - b.daysUntilEx;
      if (a.daysUntilEx !== null) return -1;
      if (b.daysUntilEx !== null) return 1;
    }
    return b.whtAmount - a.whtAmount;
  });

  const totalAnnualDiv = positions.reduce((s, p) => s + p.annualDivGross, 0);
  const totalWHT = positions.reduce((s, p) => s + p.whtAmount, 0);
  const totalProjectedDiv = positions.reduce((s, p) => s + p.projectedDivEUR, 0);
  const totalProjectedWHT = positions.reduce((s, p) => s + p.projectedWHT, 0);
  const savingsIfEliminated = totalProjectedWHT;

  return {
    positions,
    totalAnnualDiv,
    totalWHT,
    totalProjectedDiv,
    totalProjectedWHT,
    savingsIfEliminated,
  };
}

// NW history chart removed v86 — no real historical data available

/**
 * Master compute function — returns complete STATE object for dashboard rendering
 *
 * Main entry point for all computations. Orchestrates six major views:
 *   1. immoView: Real estate assets, revenues, charges, wealth creation, fiscal impact
 *   2. cashView: Cash holdings, yields, inflation, FX impact
 *   3. actionsView: Equity positions (IBKR, SGTM, ESPP, Degiro), P&L, dividends
 *   4. budgetView: Personal and investment expense tracking
 *   5. creancesView: Receivables (invoices, family loans)
 *   6. dividendAnalysis: Dividend calendar, WHT optimization
 *
 * Key computation order:
 *   1. immoView computed FIRST (to extract CRDs for net wealth calculations)
 *   2. Amine & Nezha asset aggregation (using computed CRDs)
 *   3. Net worth calculation (assets - debts)
 *   4. Per-person statement (Amine, Nezha, Combined)
 *   5. Historical comparison (vs data.NW_HISTORY)
 *   6. Projection views (wealth creation forecast, exit cost scenarios)
 *
 * Handles:
 *   - Multi-currency consolidation (EUR, USD, AED, MAD, JPY)
 *   - FX rate conversion and daily variance tracking
 *   - Tax regimes (micro-foncier, micro-BIC, réal, regimes)
 *   - Multi-loan properties with sub-loan tracking
 *   - Conditional properties (not yet signed/delivered)
 *   - Dividend withholding tax optimization
 *   - Exit cost forecasting (PV tax, IRA, agency fees, TVA clawback)
 *
 * Performance: Pure computation, no I/O, ~100ms on modern hardware
 *
 * @param {Object} portfolio - Complete portfolio data from data.js
 * @param {Object} fx - Current FX rates {EUR: 1, USD: rate, AED: rate, ...}
 * @param {string} stockSource - 'live' (use current market prices) or 'statique' (use static NAV)
 * @returns {Object} STATE object:
 *   {
 *     immoView: {...},
 *     cashView: {...},
 *     actionsView: {...},
 *     budgetView: {...},
 *     creancesView: {...},
 *     dividendAnalysis: {...},
 *     amine: {...}, nezha: {...}, combined: {...},
 *     netWorthHistory: [{date, nw, change}, ...],
 *     forecastChart: {projections: [...], exitCosts: {...}, ...},
 *     fxDaily: {variance: {...}, rates: {...}},
 *     ... (additional metadata)
 *   }
 */
export function compute(portfolio, fx, stockSource = 'statique') {
  const p = portfolio;
  const m = p.market;

  // ---- IMMO VIEW (computed early so CRDs are available for NW) ----
  const immoView = computeImmoView(p, fx);
  // Extract computed CRDs from amort schedules (more accurate than static snapshots)
  const immoCRDs = {};
  immoView.properties.forEach(prop => { immoCRDs[prop.loanKey] = prop.crd; });

  // ---- AMINE ----
  const amineWioBusiness = p.amine.uae.wioBusiness || 0;
  const amineUaeAED = p.amine.uae.mashreq + p.amine.uae.wioSavings + p.amine.uae.wioCurrent + amineWioBusiness;
  const amineUae = toEUR(amineUaeAED, 'AED', fx);  // UAE = AED accounts only
  const amineRevolutEUR = p.amine.uae.revolutEUR;   // Revolut = French account (EUR)
  // Weighted average yield for Cash UAE bucket (AED accounts only)
  const amineUaeYield = amineUae > 0
    ? (toEUR(p.amine.uae.mashreq, 'AED', fx) * CASH_YIELDS.mashreq
      + toEUR(p.amine.uae.wioSavings, 'AED', fx) * CASH_YIELDS.wioSavings
      + toEUR(p.amine.uae.wioCurrent, 'AED', fx) * CASH_YIELDS.wioCurrent
      + toEUR(amineWioBusiness, 'AED', fx) * 0) / amineUae  // Wio Business: 0% yield
    : 0;
  const amineRevolutYield = CASH_YIELDS.revolutEUR;
  const amineMoroccoMAD = p.amine.maroc.attijari + p.amine.maroc.nabd;
  const amineMoroccoCash = toEUR(amineMoroccoMAD, 'MAD', fx);
  const amineMoroccoYield = amineMoroccoCash > 0
    ? (toEUR(p.amine.maroc.attijari, 'MAD', fx) * CASH_YIELDS.attijari
      + toEUR(p.amine.maroc.nabd, 'MAD', fx) * CASH_YIELDS.nabd) / amineMoroccoCash
    : 0;
  const amineSgtm = toEUR(p.amine.sgtm.shares * m.sgtmPriceMAD, 'MAD', fx);
  const amineIbkr = computeIBKR(p, fx, stockSource);
  // Separate IBKR broker cash (EUR+USD) for reclassification to Cash category
  // JPY margin (carry trade) stays with IBKR as investment position
  const amineIbkrCashForCash = p.amine.ibkr.cashEUR + toEUR(p.amine.ibkr.cashUSD || 0, 'USD', fx);
  const amineIbkrForActions = amineIbkr - amineIbkrCashForCash; // positions + JPY carry
  const amineEsppShares = toEUR(p.amine.espp.shares * m.acnPriceUSD, 'USD', fx);
  const amineEsppCash = p.amine.espp.cashEUR || 0; // BUG-020: include ESPP account cash in NW
  const amineEspp = amineEsppShares + amineEsppCash;
  const amineVitryCRD = immoCRDs.vitry ?? p.amine.immo.vitry.crd;
  const amineVitryEquityBrute = p.amine.immo.vitry.value - amineVitryCRD;
  // Net equity = after exit costs, floored at 0 (if negative → not mature enough to sell)
  const vitryExitCosts = immoView.properties.find(pr => pr.loanKey === 'vitry')?.exitCosts;
  const amineVitryEquity = Math.max(0, vitryExitCosts ? vitryExitCosts.netEquityAfterExit : amineVitryEquityBrute);
  const amineVehicles = p.amine.vehicles.cayenne + p.amine.vehicles.mercedes;

  // Creances — split by type: pro (factures clients) vs perso (prêts famille/amis)
  // Exclude recouvré (fully paid) items to avoid double-counting with cash already in bank.
  // For partially paid items, use remaining = amount - payments.
  let amineRecvPro = 0, amineRecvPersonal = 0;
  if (p.amine.creances.items) {
    p.amine.creances.items.forEach(c => {
      if (c.status === 'recouvré') return; // already in cash — skip to avoid double-count
      const paymentsTotal = (c.payments || []).reduce((s, pay) => s + pay.amount, 0);
      const remaining = c.amount - paymentsTotal;
      const val = toEUR(remaining * (c.probability !== undefined ? c.probability : 1), c.currency, fx);
      if (c.type === 'pro') amineRecvPro += val;
      else amineRecvPersonal += val;
    });
  }

  const amineTva = p.amine.tva;

  // Facturation positions (inter-personnes: Augustin/Azarkan, Benoit/Badre)
  // Source: https://lallakenza.github.io/facturation/ via shared localStorage
  // (same origin: lallakenza.github.io). Falls back to data.js hardcoded values.
  //
  // localStorage key: 'facturation_positions' (written by facturation/render-amine.js)
  // Schema: { augustin: { mad }, benoit: { dh }, combined: { mad }, updatedAt }
  let amineFacturationNet = 0;
  let _factuSrc = 'data.js';
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem('facturation_positions');
    if (raw) {
      const fp = JSON.parse(raw);
      // Use MAD positions (consistent with user's choice "considère en MAD")
      const augustinMAD = fp.augustin && fp.augustin.mad != null ? fp.augustin.mad : 0;
      const benoitDH   = fp.benoit && fp.benoit.dh != null ? fp.benoit.dh : 0;
      amineFacturationNet = toEUR(augustinMAD, 'MAD', fx) + toEUR(benoitDH, 'MAD', fx);
      _factuSrc = 'localStorage (' + (fp.updatedAt || '?') + ')';
    }
  } catch(e) { /* localStorage unavailable or parse error */ }
  // Fallback: use hardcoded values from data.js if localStorage was empty
  if (_factuSrc === 'data.js' && p.amine.facturation) {
    Object.values(p.amine.facturation).forEach(pos => {
      amineFacturationNet += toEUR(pos.amount, pos.currency, fx);
    });
    _factuSrc = 'data.js (fallback)';
  }
  console.log('[engine] Facturation net:', Math.round(amineFacturationNet), 'EUR — source:', _factuSrc);

  // Cash includes brokerage cash (EUR+USD from IBKR + ESPP) for consistency with cash view
  // Excludes IBKR JPY carry trade (stays with Actions as investment position)
  const amineBrokerCash = amineIbkrCashForCash + amineEsppCash;
  const amineCashTotal = amineUae + amineRevolutEUR + amineMoroccoCash + amineBrokerCash;
  // Actions = positions-only (broker cash reclassified to Cash above)
  // Math: ibkrForActions + esppShares + cashTotal_new = ibkr + espp + cashTotal_old (identical NW)
  const amineTotalAssets = amineIbkrForActions + amineEsppShares + amineCashTotal + amineSgtm
    + amineVitryEquity + amineVehicles + amineRecvPro + amineRecvPersonal;
  const amineNW = amineTotalAssets + amineTva + amineFacturationNet;

  // Calculate delta from previous NW in history + compute timeframe label
  // NW_HISTORY is empty (v150), so deltas are always null
  const _prevEntry = NW_HISTORY && NW_HISTORY.length > 1 ? NW_HISTORY[NW_HISTORY.length - 2] : null;
  const previousAmineNW = _prevEntry?.amineNW || null;
  const amineNWDelta = previousAmineNW ? amineNW - previousAmineNW : null;
  const amineNWDeltaPct = previousAmineNW ? ((amineNW - previousAmineNW) / previousAmineNW * 100) : null;
  // Compute timeframe label from NW_HISTORY dates
  let nwDeltaTimeframe = 'vs dernier point';
  if (_prevEntry?.date) {
    const [py, pm] = _prevEntry.date.split('-').map(Number);
    const now = new Date();
    const months = (now.getFullYear() - py) * 12 + (now.getMonth() + 1 - pm);
    nwDeltaTimeframe = months <= 1 ? 'ce mois' : months < 12 ? 'sur ' + months + ' mois' : 'sur ' + Math.round(months/12) + ' an' + (months >= 24 ? 's' : '');
  }

  const amine = {
    nw: amineNW,
    nwDelta: amineNWDelta,
    nwDeltaPct: amineNWDeltaPct,
    nwDeltaTimeframe: nwDeltaTimeframe,
    ibkr: amineIbkr,           // full IBKR NAV (positions + all cash incl. JPY carry)
    ibkrForActions: amineIbkrForActions, // positions + JPY carry (excl. EUR/USD cash → moved to Cash)
    espp: amineEspp,           // full ESPP value (shares + cash)
    esppForActions: amineEsppShares,     // shares only (cash → moved to Cash)
    brokerCash: amineBrokerCash,         // IBKR EUR/USD + ESPP cash (in Cash category)
    sgtm: amineSgtm,
    uae: amineUae,
    uaeAED: amineUaeAED,
    revolutEUR: amineRevolutEUR,
    moroccoCash: amineMoroccoCash,
    moroccoMAD: amineMoroccoMAD,
    morocco: amineMoroccoCash + amineSgtm,
    vitryValue: p.amine.immo.vitry.value,
    vitryCRD: amineVitryCRD,
    vitryEquity: amineVitryEquity, // net (after exit costs, floored at 0)
    vitryEquityBrute: amineVitryEquityBrute,
    vehicles: amineVehicles,
    recvPro: amineRecvPro,
    recvPersonal: amineRecvPersonal,
    tva: amineTva,
    facturationNet: amineFacturationNet, // net position from facturation site (Augustin - Benoit)
    totalAssets: amineTotalAssets,
    cashTotal: amineCashTotal,
  };

  // ---- NEZHA ----
  const nezhaRueilCRD = immoCRDs.rueil ?? p.nezha.immo.rueil.crd;
  const nezhaRueilEquityBrute = p.nezha.immo.rueil.value - nezhaRueilCRD;
  // Net equity = after exit costs, floored at 0
  const rueilExitCosts = immoView.properties.find(pr => pr.loanKey === 'rueil')?.exitCosts;
  const nezhaRueilEquity = Math.max(0, rueilExitCosts ? rueilExitCosts.netEquityAfterExit : nezhaRueilEquityBrute);
  const villejuifSigned = !!p.nezha.immo.villejuif.signed;
  const nezhaVillejuifCRD = immoCRDs.villejuif ?? p.nezha.immo.villejuif.crd;
  // Si pas signé : on ne compte que les frais de réservation (récupérables)
  const villejuifExitCosts = immoView.properties.find(pr => pr.loanKey === 'villejuif')?.exitCosts;
  const nezhaVillejuifEquityBrute = p.nezha.immo.villejuif.value - nezhaVillejuifCRD;
  const nezhaVillejuifEquity = villejuifSigned
    ? Math.max(0, villejuifExitCosts ? villejuifExitCosts.netEquityAfterExit : nezhaVillejuifEquityBrute)
    : 0;
  const nezhaVillejuifFutureEquity = Math.max(0, villejuifExitCosts ? villejuifExitCosts.netEquityAfterExit : nezhaVillejuifEquityBrute);
  const nezhaVillejuifReservation = !villejuifSigned ? (p.nezha.immo.villejuif.reservationFees || 0) : 0;
  // Nezha cash — detailed accounts
  const nc = p.nezha.cash;
  const nezhaCashFranceEUR = nc.revolutEUR + nc.creditMutuelCC + nc.lclLivretA + nc.lclCompteDepots;
  const nezhaCashMarocEUR = toEUR(nc.attijariwafarMAD, 'MAD', fx);
  const nezhaCashUAE_EUR = toEUR(nc.wioAED, 'AED', fx);
  const nezhaSgtm = toEUR(p.nezha.sgtm.shares * m.sgtmPriceMAD, 'MAD', fx);
  // Nezha ESPP (Accenture via UBS)
  const nezhaEsppData = p.nezha.espp || {};
  const nezhaEsppShares = nezhaEsppData.shares || 0;
  const nezhaEsppSharesVal = toEUR(nezhaEsppShares * m.acnPriceUSD, 'USD', fx);
  const nezhaEsppCash = toEUR(nezhaEsppData.cashUSD || 0, 'USD', fx); // BUG-020: include ESPP account cash in NW
  const nezhaEspp = nezhaEsppSharesVal + nezhaEsppCash;
  const nezhaEsppCostBasisUSD = nezhaEsppData.totalCostBasisUSD || 0;
  const nezhaEsppCostBasisEUR = toEUR(nezhaEsppCostBasisUSD, 'USD', fx);
  const nezhaEsppUnrealizedPL = nezhaEspp - nezhaEsppCostBasisEUR;
  // Caution Rueil — dette envers locataire
  const nezhaCautionRueil = p.nezha.cautionRueil || 0;
  // BUG-033: iterate all Nezha créances (not just items[0])
  let nezhaRecvOmar = 0;
  if (p.nezha.creances && p.nezha.creances.items) {
    p.nezha.creances.items.forEach(c => {
      if (c.status === 'recouvré') return; // same rule as Amine: skip recouvré
      const paymentsTotal = (c.payments || []).reduce((s, pay) => s + pay.amount, 0);
      const remaining = c.amount - paymentsTotal;
      nezhaRecvOmar += toEUR(remaining * (c.probability !== undefined ? c.probability : 1), c.currency, fx);
    });
  }
  // Cash includes ESPP broker cash for consistency with cash view
  const nezhaBrokerCash = nezhaEsppCash;
  const nezhaCash = nezhaCashFranceEUR + nezhaCashMarocEUR + nezhaCashUAE_EUR + nezhaBrokerCash;
  const nezhaEsppForActions = nezhaEsppSharesVal; // shares only (cash reclassified above)
  // NW math unchanged: (cash+brokerCash) + esppShares = cash + (esppShares+esppCash) = cash + espp
  const nezhaNW = nezhaRueilEquity + nezhaCash + nezhaSgtm + nezhaEsppForActions + nezhaRecvOmar + nezhaVillejuifReservation - nezhaCautionRueil;

  // Calculate delta from previous NW in history
  // NW_HISTORY is empty (v150), so deltas are always null
  const previousNezhaNW = NW_HISTORY && NW_HISTORY.length > 1 ? NW_HISTORY[NW_HISTORY.length - 2]?.nezhaNW : null;
  const nezhaNWDelta = previousNezhaNW ? nezhaNW - previousNezhaNW : null;
  const nezhaNWDeltaPct = previousNezhaNW ? ((nezhaNW - previousNezhaNW) / previousNezhaNW * 100) : null;

  const nezha = {
    nw: nezhaNW,
    nwDelta: nezhaNWDelta,
    nwDeltaPct: nezhaNWDeltaPct,
    nwDeltaTimeframe: nwDeltaTimeframe,
    nwWithVillejuif: nezhaNW + nezhaVillejuifFutureEquity,
    rueilValue: p.nezha.immo.rueil.value,
    rueilCRD: nezhaRueilCRD,
    rueilEquity: nezhaRueilEquity, // net (after exit costs, floored at 0)
    rueilEquityBrute: nezhaRueilEquityBrute,
    villejuifValue: p.nezha.immo.villejuif.value,
    villejuifCRD: nezhaVillejuifCRD,
    villejuifEquity: nezhaVillejuifEquity, // net (after exit costs, floored at 0)
    villejuifEquityBrute: nezhaVillejuifEquityBrute,
    villejuifFutureEquity: nezhaVillejuifFutureEquity,
    villejuifSigned: villejuifSigned,
    villejuifReservation: nezhaVillejuifReservation,
    // Detailed cash
    cashFrance: nezhaCashFranceEUR,
    cashMaroc: nezhaCashMarocEUR,
    cashMarocMAD: nc.attijariwafarMAD,
    cashUAE: nezhaCashUAE_EUR,
    cashUAE_AED: nc.wioAED,
    revolutEUR: nc.revolutEUR,
    creditMutuel: nc.creditMutuelCC,
    livretA: nc.lclLivretA,
    lclDepots: nc.lclCompteDepots,
    sgtm: nezhaSgtm,
    espp: nezhaEspp,             // full ESPP (shares + cash)
    esppForActions: nezhaEsppForActions, // shares only (cash → moved to Cash)
    brokerCash: nezhaBrokerCash,
    esppShares: nezhaEsppShares,
    esppCostBasisEUR: nezhaEsppCostBasisEUR,
    esppUnrealizedPL: nezhaEsppUnrealizedPL,
    cautionRueil: nezhaCautionRueil,
    recvOmar: nezhaRecvOmar,
    // BUG-033: sum all active Nezha creances in MAD for display
    recvOmarMAD: p.nezha.creances && p.nezha.creances.items
      ? p.nezha.creances.items.filter(c => c.status !== 'recouvré').reduce((s, c) => {
          const remaining = c.amount - (c.payments || []).reduce((ps, pay) => ps + pay.amount, 0);
          const prob = c.probability !== undefined ? c.probability : 1;
          return s + (remaining * prob * (c.currency === 'MAD' ? 1 : 0));
        }, 0) || 28000
      : 28000,
    cash: nezhaCash,
  };

  // ---- COUPLE ----
  // Net equity (post exit costs, floored at 0 per property)
  const coupleImmoEquity = amineVitryEquity + nezhaRueilEquity + nezhaVillejuifEquity;
  const coupleImmoEquityBrute = amineVitryEquityBrute + nezhaRueilEquityBrute + (villejuifSigned ? nezhaVillejuifEquityBrute : 0);
  const coupleImmoValue = amine.vitryValue + nezha.rueilValue + (villejuifSigned ? nezha.villejuifValue : 0);
  const coupleImmoCRD = amine.vitryCRD + nezha.rueilCRD + (villejuifSigned ? nezha.villejuifCRD : 0);
  const coupleNW = amineNW + nezhaNW + nezhaVillejuifEquity;
  const nbBiens = villejuifSigned ? 3 : 2;

  // Calculate couple delta as SUM of individual deltas (ensures consistency: couple delta = amine delta + nezha delta)
  // Using individual deltas instead of coupleNW history because NW_HISTORY.coupleNW may not equal amineNW+nezhaNW
  // NW_HISTORY is empty (v150), so deltas are always null
  const nwDelta = (amineNWDelta !== null && nezhaNWDelta !== null) ? amineNWDelta + nezhaNWDelta : null;
  const previousCoupleNW = nwDelta !== null ? coupleNW - nwDelta : null;
  const nwDeltaPct = previousCoupleNW ? (nwDelta / previousCoupleNW * 100) : null;

  const couple = {
    nw: coupleNW,
    nwDelta: nwDelta,
    nwDeltaPct: nwDeltaPct,
    nwDeltaTimeframe: nwDeltaTimeframe,
    immoEquity: coupleImmoEquity, // net (after exit costs)
    immoEquityBrute: coupleImmoEquityBrute,
    immoValue: coupleImmoValue,
    immoCRD: coupleImmoCRD,
    nbBiens: nbBiens,
    cashTotal: amineCashTotal + nezhaCash, // includes broker cash (IBKR EUR/USD + ESPP)
    actionsTotal: amineIbkrForActions + amineEsppShares + amineSgtm + nezhaEsppForActions + nezhaSgtm,
    autreTotal: amineVehicles + amineRecvPro + amineRecvPersonal + amineTva + amineFacturationNet + nezhaRecvOmar + nezhaVillejuifReservation - nezhaCautionRueil,
    autreVehicles: amineVehicles,
    autreCreancesPro: amineRecvPro,
    autreCreancesPerso: amineRecvPersonal + nezhaRecvOmar,
    autreFacturation: amineFacturationNet,
    autreTva: amineTva,
    autreVillejuifReservation: nezhaVillejuifReservation,
    autreCautionRueil: -nezhaCautionRueil,
  };

  // ---- POOLS (for simulators) ----
  const actionsPool = amineIbkr + amineEspp + amineSgtm;
  const cashPool = amineUae + amineRevolutEUR + amineMoroccoCash;
  const totalLiquid = actionsPool + cashPool;
  const pctActions = totalLiquid > 0 ? Math.round(actionsPool / totalLiquid * 100) : 0;

  // Cash color helper: green if yield >= 4%, red if < 4%
  const cashColor = (yld) => yld >= 0.04 ? '#22c55e' : '#ef4444';
  const nezhaCashFranceYield = CASH_YIELDS.nezhaCashFrance;
  const nezhaCashMarocYield = CASH_YIELDS.nezhaCashMaroc;

  // ---- COUPLE CATEGORIES (for drill-down donut) ----
  const coupleCategories = [
    {
      label: 'Immobilier', color: '#b7791f',
      total: coupleImmoEquity,
      sub: [
        { label: 'Vitry', val: amineVitryEquity, color: '#b7791f', owner: 'Amine' },
        { label: 'Rueil', val: nezhaRueilEquity, color: '#e6a817', owner: 'Nezha' },
        ...(villejuifSigned ? [{ label: 'Villejuif VEFA', val: nezhaVillejuifEquity, color: '#805a10', owner: 'Nezha' }] : []),
      ]
    },
    {
      label: 'Actions', color: '#2b6cb0',
      total: (() => {
        const nonCrypto = p.amine.ibkr.positions.filter(pos => pos.sector !== 'crypto');
        const ibkrNonCryptoVal = nonCrypto.reduce((s, pos) => s + toEUR(pos.shares * pos.price, pos.currency, fx), 0);
        // JPY carry trade stays with Actions (investment position), EUR/USD cash → Cash category
        const ibkrJPY = toEUR(p.amine.ibkr.cashJPY, 'JPY', fx);
        return ibkrNonCryptoVal + ibkrJPY + amineEsppShares + nezhaEsppForActions + amineSgtm + nezhaSgtm;
      })(),
      sub: [
        ...p.amine.ibkr.positions.filter(pos => pos.sector !== 'crypto').map((pos, i) => {
          const colors = ['#1e3a5f','#2563eb','#3b82f6','#0284c7','#0369a1','#1d4ed8','#4338ca','#6366f1','#7c3aed','#0891b2'];
          const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
          // Short label = company name without ticker
          const short = pos.label.replace(/\s*\(.*\)/, '');
          return { label: short, val: valEUR, color: colors[i % colors.length], owner: 'Amine — IBKR', ticker: pos.ticker };
        }),
        { label: 'ESPP Accenture', val: amineEsppShares + nezhaEsppForActions, color: '#6366f1', owner: 'Amine + Nezha — ESPP' },
        { label: 'SGTM', val: amineSgtm + nezhaSgtm, color: '#4f46e5', owner: 'Amine + Nezha — Maroc' },
      ].filter(s => s.val > 100)
    },
    {
      label: 'Crypto', color: '#f59e0b',
      total: (() => {
        return p.amine.ibkr.positions.filter(pos => pos.sector === 'crypto')
          .reduce((s, pos) => s + toEUR(pos.shares * pos.price, pos.currency, fx), 0);
      })(),
      sub: p.amine.ibkr.positions.filter(pos => pos.sector === 'crypto').map((pos, i) => {
        const colors = ['#f59e0b','#d97706'];
        const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
        const short = pos.label.replace(/\s*\(.*\)/, '');
        return { label: short, val: valEUR, color: colors[i % colors.length], owner: 'Amine — IBKR' };
      })
    },
    {
      label: 'Cash Productif', color: '#22c55e',
      total: toEUR(p.amine.uae.mashreq, 'AED', fx) + toEUR(p.amine.uae.wioSavings, 'AED', fx),
      sub: [
        { label: 'Mashreq NEO+', val: toEUR(p.amine.uae.mashreq, 'AED', fx), color: '#22c55e', owner: 'Amine — 6.25%' },
        { label: 'Wio Savings', val: toEUR(p.amine.uae.wioSavings, 'AED', fx), color: '#16a34a', owner: 'Amine — 6%' },
      ]
    },
    {
      label: 'Cash Dormant', color: '#ef4444',
      total: (p.amine.uae.wioCurrent > 0 ? toEUR(p.amine.uae.wioCurrent, 'AED', fx) : 0) + toEUR(amineWioBusiness, 'AED', fx) + amineRevolutEUR + amineMoroccoCash
        + amineBrokerCash + nezhaBrokerCash
        + nc.revolutEUR + nc.creditMutuelCC + nc.lclLivretA + nc.lclCompteDepots + nezhaCashMarocEUR + nezhaCashUAE_EUR,
      sub: [
        ...(amineBrokerCash !== 0 ? [{ label: 'Cash Courtiers (IBKR+ESPP)', val: amineBrokerCash, color: '#a855f7', owner: 'Amine — 0%' }] : []),
        ...(nezhaBrokerCash > 0 ? [{ label: 'Cash ESPP (Nezha)', val: nezhaBrokerCash, color: '#8b5cf6', owner: 'Nezha — 0%' }] : []),
        ...(nc.revolutEUR > 0 ? [{ label: 'Revolut (Nezha)', val: nc.revolutEUR, color: '#ef4444', owner: 'Nezha — 0%' }] : []),
        ...(nc.creditMutuelCC > 0 ? [{ label: 'Crédit Mutuel', val: nc.creditMutuelCC, color: '#dc2626', owner: 'Nezha — 0%' }] : []),
        ...(nc.lclLivretA > 0 ? [{ label: 'Livret A (LCL)', val: nc.lclLivretA, color: '#f87171', owner: 'Nezha — 1.5%' }] : []),
        ...(nc.lclCompteDepots > 0 ? [{ label: 'LCL Dépôts', val: nc.lclCompteDepots, color: '#b91c1c', owner: 'Nezha — 0%' }] : []),
        ...(nezhaCashMarocEUR > 0 ? [{ label: 'Attijariwafa (Nezha)', val: nezhaCashMarocEUR, color: '#991b1b', owner: 'Nezha — 0%' }] : []),
        ...(nezhaCashUAE_EUR > 0 ? [{ label: 'Wio UAE (Nezha)', val: nezhaCashUAE_EUR, color: '#7f1d1d', owner: 'Nezha — 0%' }] : []),
        ...(amineMoroccoCash > 0 ? [{ label: 'Cash Maroc (Amine)', val: amineMoroccoCash, color: '#f87171', owner: 'Amine — 0%' }] : []),
        ...(p.amine.uae.wioCurrent > 0 ? [{ label: 'Wio Current', val: toEUR(p.amine.uae.wioCurrent, 'AED', fx), color: '#fca5a5', owner: 'Amine — 0%' }] : []),
        ...(amineWioBusiness > 0 ? [{ label: 'Wio Business (Bairok)', val: toEUR(amineWioBusiness, 'AED', fx), color: '#c026d3', owner: 'Amine — 0%' }] : []),
        ...(amineRevolutEUR > 0 ? [{ label: 'Revolut EUR (Amine)', val: amineRevolutEUR, color: '#fecaca', owner: 'Amine — 0%' }] : []),
      ]
    },
    {
      label: 'Vehicules', color: '#64748b',
      total: amineVehicles,
      sub: [
        { label: 'Cayenne', val: p.amine.vehicles.cayenne, color: '#64748b', owner: 'Amine' },
        { label: 'Mercedes A', val: p.amine.vehicles.mercedes, color: '#475569', owner: 'Amine' },
      ]
    },
    {
      label: 'Creances & Facturation', color: '#ec4899',
      total: amineRecvPro + amineRecvPersonal + amineFacturationNet + nezhaRecvOmar + nezhaVillejuifReservation,
      sub: [
        { label: 'Créances pro', val: amineRecvPro, color: '#ec4899', owner: 'Amine — SAP, Malt, Loyers' },
        { label: 'Créances perso', val: amineRecvPersonal, color: '#db2777', owner: 'Amine — Kenza, Mehdi, etc.' },
        { label: 'Facturation (net)', val: amineFacturationNet, color: '#f43f5e', owner: 'Amine — Augustin/Benoit' },
        { label: 'Creance Omar', val: nezhaRecvOmar, color: '#be185d', owner: 'Nezha' },
        ...(!villejuifSigned && nezhaVillejuifReservation > 0 ? [{ label: 'Reservation Villejuif', val: nezhaVillejuifReservation, color: '#f472b6', owner: 'Nezha — remboursable' }] : []),
      ]
    },
    {
      label: 'Dettes & Obligations', color: '#ef4444',
      total: amineTva - nezhaCautionRueil,
      sub: [
        { label: 'TVA à payer', val: amineTva, color: '#ef4444', owner: 'Amine — dette' },
        ...(nezhaCautionRueil > 0 ? [{ label: 'Caution Rueil', val: -nezhaCautionRueil, color: '#dc2626', owner: 'Nezha — dette' }] : []),
      ]
    },
  ];

  // ---- VIEW-SPECIFIC CATEGORY CARDS ----
  const views = {
    couple: {
      title: 'Dashboard Patrimonial',
      subtitle: 'Amine (33 ans) & Nezha (34 ans) Koraibi \u2014 Vue consolidee',
      stocks:    { val: amineIbkrForActions + amineEsppShares + nezhaEsppForActions + amineSgtm + nezhaSgtm, sub: 'IBKR + ESPP x2 + SGTM x2' },
      cash:      { val: amineCashTotal + nezhaCash, sub: 'UAE + France + Maroc + Courtiers' },
      immo:      { val: coupleImmoEquity, sub: nbBiens + ' biens \u2014 Equity nette' },
      other:     { val: amineVehicles + amineRecvPro + amineRecvPersonal + amineTva + amineFacturationNet + nezhaRecvOmar + nezhaVillejuifReservation - nezhaCautionRueil, sub: 'Vehicules + Creances + Facturation - TVA - Caution', title: 'Autres Actifs' },
      nwRef: coupleNW,
      showStocks: true, showCash: true, showOther: true,
    },
    amine: {
      title: 'Dashboard \u2014 Amine Koraibi',
      subtitle: 'Amine Koraibi, 33 ans \u2014 Actions, Crypto, Immobilier, Cash',
      stocks:    { val: amineIbkrForActions + amineEsppShares + amineSgtm, sub: 'IBKR + ESPP + SGTM' },
      cash:      { val: amineCashTotal, sub: 'UAE + Revolut + Maroc + Courtiers' },
      immo:      { val: amineVitryEquity, sub: '1 bien \u2014 Vitry' },
      other:     { val: amineVehicles + amineRecvPro + amineRecvPersonal + amineTva + amineFacturationNet, sub: 'Vehicules + Creances + Facturation - TVA', title: 'Autres Actifs' },
      nwRef: amineNW,
      showStocks: true, showCash: true, showOther: true,
    },
    nezha: {
      title: 'Dashboard \u2014 Nezha Kabbaj',
      subtitle: 'Nezha Kabbaj, 34 ans \u2014 Immobilier',
      stocks:    { val: nezhaSgtm + nezhaEsppForActions, sub: 'ESPP (' + nezhaEsppShares + ' ACN) + SGTM' },
      cash:      { val: nezhaCash, sub: Math.round(nezhaCashFranceEUR/1000) + 'K France + ' + Math.round(nezhaCashMarocEUR/1000) + 'K Maroc + ' + Math.round(nezhaCashUAE_EUR/1000) + 'K UAE' },
      immo:      { val: nezhaRueilEquity + nezhaVillejuifEquity, sub: villejuifSigned ? '2 biens \u2014 Rueil + Villejuif' : '1 bien \u2014 Rueil' },
      other:     { val: nezhaRecvOmar + nezhaVillejuifReservation - nezhaCautionRueil, sub: villejuifSigned ? 'Creance Omar - Caution' : 'Creances + Reservation - Caution', title: 'Creances' },
      nwRef: nezhaNW + nezhaVillejuifEquity,
      showStocks: true, showCash: true, showOther: true,
    },
  };

  // ---- AMINE TREEMAP CATEGORIES ----
  const ibkrNonCryptoSubs = p.amine.ibkr.positions.filter(pos => pos.sector !== 'crypto').map((pos, i) => {
    const colors = ['#1e3a5f','#2563eb','#3b82f6','#0284c7','#0369a1','#1d4ed8','#4338ca','#6366f1','#7c3aed','#0891b2'];
    const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
    const short = pos.label.replace(/\s*\(.*\)/, '');
    return { label: short, val: valEUR, color: colors[i % colors.length], owner: 'IBKR' };
  });
  const ibkrJPYVal = toEUR(p.amine.ibkr.cashJPY, 'JPY', fx); // JPY carry stays with Actions
  const cryptoSubs = p.amine.ibkr.positions.filter(pos => pos.sector === 'crypto').map((pos, i) => {
    const colors = ['#f59e0b','#d97706'];
    const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
    const short = pos.label.replace(/\s*\(.*\)/, '');
    return { label: short, val: valEUR, color: colors[i % colors.length], owner: 'IBKR' };
  });

  const amineCategories = [
    {
      label: 'Actions IBKR', color: '#2b6cb0',
      total: ibkrNonCryptoSubs.reduce((s, p) => s + p.val, 0) + ibkrJPYVal,
      sub: ibkrNonCryptoSubs
    },
    {
      label: 'Crypto', color: '#f59e0b',
      total: cryptoSubs.reduce((s, p) => s + p.val, 0),
      sub: cryptoSubs
    },
    {
      label: 'Autres Actions', color: '#6366f1',
      total: amineEsppShares + amineSgtm,
      sub: [
        { label: 'ESPP Accenture', val: amineEsppShares, color: '#6366f1', owner: 'ESPP' },
        { label: 'SGTM', val: amineSgtm, color: '#4f46e5', owner: 'Maroc' },
      ].filter(s => s.val > 100)
    },
    {
      label: 'Immobilier', color: '#b7791f',
      total: amineVitryEquity,
      sub: [{ label: 'Vitry', val: amineVitryEquity, color: '#b7791f', owner: 'Equity nette' }]
    },
    {
      label: 'Cash Productif', color: '#22c55e',
      total: toEUR(p.amine.uae.mashreq, 'AED', fx) + toEUR(p.amine.uae.wioSavings, 'AED', fx),
      sub: [
        { label: 'Mashreq NEO+', val: toEUR(p.amine.uae.mashreq, 'AED', fx), color: '#22c55e', owner: '6.25%' },
        { label: 'Wio Savings', val: toEUR(p.amine.uae.wioSavings, 'AED', fx), color: '#16a34a', owner: '6%' },
      ]
    },
    {
      label: 'Cash Dormant', color: '#ef4444',
      total: (p.amine.uae.wioCurrent > 0 ? toEUR(p.amine.uae.wioCurrent, 'AED', fx) : 0) + toEUR(amineWioBusiness, 'AED', fx) + amineRevolutEUR + amineMoroccoCash + amineBrokerCash,
      sub: [
        ...(amineBrokerCash !== 0 ? [{ label: 'Cash Courtiers (IBKR+ESPP)', val: amineBrokerCash, color: '#a855f7', owner: '0%' }] : []),
        ...(amineMoroccoCash > 0 ? [{ label: 'Cash Maroc', val: amineMoroccoCash, color: '#ef4444', owner: '0%' }] : []),
        ...(p.amine.uae.wioCurrent > 0 ? [{ label: 'Wio Current', val: toEUR(p.amine.uae.wioCurrent, 'AED', fx), color: '#dc2626', owner: '0%' }] : []),
        ...(amineWioBusiness > 0 ? [{ label: 'Wio Business (Bairok)', val: toEUR(amineWioBusiness, 'AED', fx), color: '#c026d3', owner: '0%' }] : []),
        ...(amineRevolutEUR > 0 ? [{ label: 'Revolut EUR', val: amineRevolutEUR, color: '#f87171', owner: '0%' }] : []),
      ]
    },
    {
      label: 'Vehicules', color: '#64748b',
      total: amineVehicles,
      sub: [
        { label: 'Cayenne', val: p.amine.vehicles.cayenne, color: '#64748b', owner: '' },
        { label: 'Mercedes A', val: p.amine.vehicles.mercedes, color: '#475569', owner: '' },
      ]
    },
    {
      label: 'Creances & Facturation', color: '#ec4899',
      total: amineRecvPro + amineRecvPersonal + amineFacturationNet,
      sub: [
        { label: 'Créances pro', val: amineRecvPro, color: '#ec4899', owner: 'SAP, Malt, Loyers' },
        { label: 'Créances perso', val: amineRecvPersonal, color: '#db2777', owner: 'Kenza, Mehdi, etc.' },
        { label: 'Facturation (net)', val: amineFacturationNet, color: '#f43f5e', owner: 'Augustin/Benoit' },
      ].filter(s => Math.abs(s.val) > 100)
    },
    {
      label: 'TVA à payer', color: '#ef4444',
      total: amineTva,
      sub: [{ label: 'TVA', val: amineTva, color: '#ef4444', owner: 'Dette' }]
    },
  ].filter(c => Math.abs(c.total) > 0);

  // ---- NEZHA TREEMAP CATEGORIES ----
  const nezhaCategories = [
    {
      label: 'Immobilier', color: '#b7791f',
      total: nezhaRueilEquity + nezhaVillejuifEquity,
      sub: [
        { label: 'Rueil', val: nezhaRueilEquity, color: '#e6a817', owner: 'Equity nette' },
        ...(villejuifSigned ? [{ label: 'Villejuif VEFA', val: nezhaVillejuifEquity, color: '#805a10', owner: 'Conditionnel' }] : []),
      ]
    },
    {
      label: 'Cash', color: '#ef4444',
      total: nezhaCash,
      sub: [
        ...(nc.revolutEUR > 0 ? [{ label: 'Revolut EUR', val: nc.revolutEUR, color: '#ef4444', owner: '0%' }] : []),
        ...(nc.creditMutuelCC > 0 ? [{ label: 'Crédit Mutuel', val: nc.creditMutuelCC, color: '#dc2626', owner: '0%' }] : []),
        ...(nc.lclLivretA > 0 ? [{ label: 'Livret A (LCL)', val: nc.lclLivretA, color: '#f87171', owner: '1.5%' }] : []),
        ...(nc.lclCompteDepots > 0 ? [{ label: 'LCL Dépôts', val: nc.lclCompteDepots, color: '#b91c1c', owner: '0%' }] : []),
        ...(nezhaCashMarocEUR > 0 ? [{ label: 'Attijariwafa', val: nezhaCashMarocEUR, color: '#991b1b', owner: Math.round(nc.attijariwafarMAD).toLocaleString("fr-FR") + ' MAD' }] : []),
        ...(nezhaCashUAE_EUR > 0 ? [{ label: 'Wio UAE', val: nezhaCashUAE_EUR, color: '#7f1d1d', owner: Math.round(nc.wioAED).toLocaleString("fr-FR") + ' AED' }] : []),
      ]
    },
    {
      label: 'Actions', color: '#2b6cb0',
      total: nezhaSgtm + nezhaEsppForActions,
      sub: [
        ...(nezhaEsppForActions > 100 ? [{ label: 'ESPP Accenture', val: nezhaEsppForActions, color: '#6366f1', owner: 'UBS' }] : []),
        { label: 'SGTM', val: nezhaSgtm, color: '#818cf8', owner: 'Maroc' },
      ]
    },
    {
      label: 'Creances & Autres', color: '#ec4899',
      total: nezhaRecvOmar + nezhaVillejuifReservation - nezhaCautionRueil,
      sub: [
        { label: 'Creance Omar', val: nezhaRecvOmar, color: '#be185d', owner: '40K MAD' },
        ...(!villejuifSigned && nezhaVillejuifReservation > 0 ? [{ label: 'Reservation Villejuif', val: nezhaVillejuifReservation, color: '#f472b6', owner: 'Remboursable' }] : []),
        ...(nezhaCautionRueil > 0 ? [{ label: 'Caution Rueil', val: -nezhaCautionRueil, color: '#ef4444', owner: 'Dette locataire' }] : []),
      ]
    },
  ].filter(c => Math.abs(c.total) > 0);

  // ---- ACTIONS TREEMAP CATEGORIES (by geo) ----
  const geoLabels = { france: 'France', crypto: 'Crypto', us: 'US / Irlande', germany: 'Allemagne', japan: 'Japon', morocco: 'Maroc' };
  const geoColors = { france: '#2b6cb0', crypto: '#9f7aea', us: '#48bb78', germany: '#ed8936', japan: '#e53e3e', morocco: '#d69e2e' };
  const geoColorSubs = {
    france: ['#1e3a5f','#2563eb','#3b82f6','#0284c7','#0369a1','#1d4ed8','#4338ca','#60a5fa'],
    crypto: ['#7c3aed','#a78bfa'],
    us: ['#059669','#10b981'],
    germany: ['#ea580c','#f97316'],
    japan: ['#dc2626','#ef4444'],
    morocco: ['#ca8a04','#eab308'],
  };
  const geoGroups = {};
  p.amine.ibkr.positions.forEach((pos, i) => {
    const geo = pos.geo || 'france';
    if (!geoGroups[geo]) geoGroups[geo] = [];
    const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
    const short = pos.label.replace(/\s*\(.*\)/, '');
    const palIdx = geoGroups[geo].length;
    const pal = geoColorSubs[geo] || ['#94a3b8'];
    geoGroups[geo].push({ label: short, val: valEUR, color: pal[palIdx % pal.length], owner: 'IBKR', ticker: pos.ticker });
  });
  // Add ESPP (merged Amine + Nezha) to US
  if (!geoGroups['us']) geoGroups['us'] = [];
  geoGroups['us'].push({ label: 'ESPP Accenture', val: amineEspp + nezhaEspp, color: '#10b981', owner: 'ESPP' });
  // Add SGTM (merged Amine + Nezha) to Morocco
  if (!geoGroups['morocco']) geoGroups['morocco'] = [];
  geoGroups['morocco'].push({ label: 'SGTM', val: amineSgtm + nezhaSgtm, color: '#ca8a04', owner: 'Maroc' });
  // IBKR cash (EUR/USD) reclassified to Cash category in v292 — no longer in Actions geo treemap
  const actionsCategories = Object.entries(geoGroups)
    .map(([geo, subs]) => ({
      label: geoLabels[geo] || geo,
      color: geoColors[geo] || '#94a3b8',
      total: subs.reduce((s, p) => s + p.val, 0),
      sub: subs.filter(s => s.val > 100),
    }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // ---- IBKR Positions sorted by value ----
  const ibkrPositions = computeIBKRPositions(p, fx);

  // ---- NEW ASSET-TYPE VIEWS ----
  const actionsView = computeActionsView(p, fx, stockSource, amineIbkr, ibkrPositions, amineSgtm, nezhaSgtm, amineEspp, nezhaEspp);
  const cashView = computeCashView(p, fx);
  // immoView already computed at top of function (needed for CRDs in NW calculations)
  const creancesView = computeCreancesView(p, fx);
  const budgetView = computeBudgetView(p, fx);

  // ---- DIVIDEND / WHT ANALYSIS ----
  const dividendAnalysis = computeDividendAnalysis(ibkrPositions, fx);

  // NW history removed v86

  return {
    fx,
    stockSource,
    portfolio: p,
    amine,
    nezha,
    couple,
    pools: { actions: actionsPool, cash: cashPool, totalLiquid, pctActions },
    coupleCategories,
    amineCategories,
    nezhaCategories,
    actionsCategories,
    views,
    ibkrPositions,
    actionsView,
    cashView,
    immoView,
    creancesView,
    budgetView,
    dividendAnalysis,
    nwHistory: NW_HISTORY,
    equityHistory: EQUITY_HISTORY,
  };
}

/**
 * Compute the grand total from couple categories
 */
export function getGrandTotal(state) {
  return state.coupleCategories.reduce((s, c) => s + c.total, 0);
}

