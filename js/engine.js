// ============================================================
// ENGINE — Pure computation. No DOM access, no side effects.
// ============================================================
// compute(portfolio, fx, stockSource) → STATE object

import { CASH_YIELDS, INFLATION_RATE, IMMO_CONSTANTS, WHT_RATES, DIV_YIELDS, DIV_CALENDAR, IBKR_CONFIG, BUDGET_EXPENSES, EXIT_COSTS, VITRY_CONSTRAINTS, VILLEJUIF_REGIMES, FX_STATIC, DEGIRO_STATIC_PRICES, NW_HISTORY } from './data.js?v=149';

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

  const positions = ibkr.positions.map(pos => {
    const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
    const costEUR = toEUR(pos.shares * pos.costBasis, pos.currency, fx);
    const unrealizedPL = valEUR - costEUR;
    const pctPL = costEUR > 0 ? (unrealizedPL / costEUR * 100) : 0;
    let priceLabel = '';
    if (pos.currency === 'EUR') priceLabel = '\u20ac ' + pos.price.toFixed(2);
    else if (pos.currency === 'USD') priceLabel = '$' + pos.price.toFixed(2);
    else if (pos.currency === 'JPY') priceLabel = '\u00a5' + Math.round(pos.price);

    const prevFxRate = FX_STATIC[pos.currency] || fx[pos.currency];
    const curFxRate = fx[pos.currency] || 1;
    const trades = tradesByTicker[pos.ticker] || [];

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
    function periodPL(refPrice, usePrevFx, periodStartDate) {
      if (!refPrice || refPrice <= 0) return null;
      const fxRate = usePrevFx ? prevFxRate : curFxRate;

      if (periodStartDate && trades.length > 0) {
        const { sharesAtStart, netCashInvestedEUR } = tradesDuringPeriod(periodStartDate);
        // Start value = shares held at period start × reference price (in EUR)
        const startVal = sharesAtStart > 0 ? (sharesAtStart * refPrice / fxRate) : 0;
        // Period P&L = end value - start value - net cash invested during period
        return valEUR - startVal - netCashInvestedEUR;
      }

      // Fallback if no trades data: assume all shares held since period start
      const refVal = pos.shares * refPrice / fxRate;
      return valEUR - refVal;
    }

    // previousClose comes from live API only (changes daily).
    // ytdOpen/mtdOpen/oneMonthAgo are stored in data.js (stable reference prices).
    const dailyPL = periodPL(pos.previousClose, true, todayStr);
    const mtdPL = periodPL(pos.mtdOpen, false, mtdStartStr);
    const ytdPL = periodPL(pos.ytdOpen, false, ytdStartStr);
    const oneMonthPL = periodPL(pos.oneMonthAgo, false, oneMonthStr);
    return { ...pos, valEUR, costEUR, unrealizedPL, pctPL, priceLabel, dailyPL, mtdPL, ytdPL, oneMonthPL };
  }).sort((a, b) => b.valEUR - a.valEUR);

  // Compute weights
  const totalVal = positions.reduce((s, p) => s + p.valEUR, 0);
  positions.forEach(p => { p.weight = totalVal > 0 ? (p.valEUR / totalVal * 100) : 0; });
  return positions;
}

/**
 * Compute actions view data (stocks cockpit)
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

  // IBKR positions P/L
  const totalPositionsVal = ibkrPositions.reduce((s, p) => s + p.valEUR, 0);
  const totalCostBasis = ibkrPositions.reduce((s, p) => s + p.costEUR, 0);
  const totalUnrealizedPL = totalPositionsVal - totalCostBasis;

  // ESPP cost basis & P/L
  const esppCostBasisUSD = espp.totalCostBasisUSD || 0;
  const esppCostBasisEUR = toEUR(esppCostBasisUSD, 'USD', fx);
  const esppCurrentVal = toEUR(espp.shares * m.acnPriceUSD, 'USD', fx);
  const esppUnrealizedPL = esppCurrentVal - esppCostBasisEUR;

  // Nezha ESPP
  const nezhaEsppData = portfolio.nezha.espp || {};
  const nezhaEsppShares = nezhaEsppData.shares || 0;
  const nezhaEsppCurrentVal = toEUR(nezhaEsppShares * m.acnPriceUSD, 'USD', fx);
  const nezhaEsppCostBasisEUR = toEUR(nezhaEsppData.totalCostBasisUSD || 0, 'USD', fx);
  const nezhaEsppUnrealizedPL = nezhaEsppCurrentVal - nezhaEsppCostBasisEUR;

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
  const degiroRealizedPL = degiro.totalRealizedPL || 0;

  // Combined realized P/L (IBKR + Degiro)
  const ibkrRealizedPL = meta.realizedPL || 0;
  const combinedRealizedPL = ibkrRealizedPL + degiroRealizedPL;

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

  // 2. ESPP lots (Amine) — contribution from French salary in EUR
  // The ESPP buys ACN in USD, but the employee contributes from EUR salary
  // So the deposit is recorded in EUR (what was actually deducted from pay)
  (espp.lots || []).forEach(lot => {
    const costUSD = lot.shares * lot.costBasis;
    const fxRate = lot.fxRateAtDate || 1.15; // EUR/USD at purchase date
    const costEUR = costUSD / fxRate;
    addDeposit(lot.date, 'ESPP ' + lot.shares + ' ACN @ $' + lot.costBasis.toFixed(0), 'Amine', 'ESPP (UBS)',
      Math.round(costEUR), 'EUR', 1);
  });

  // 2b. ESPP Nezha — same logic (French salary → EUR)
  (nezhaEsppData.lots || []).forEach(lot => {
    const costUSD = lot.shares * lot.costBasis;
    const fxRate = lot.fxRateAtDate || 1.10; // EUR/USD at purchase date (2023-2025)
    const costEUR = costUSD / fxRate;
    addDeposit(lot.date, 'ESPP ' + lot.shares + ' ACN @ $' + lot.costBasis.toFixed(0), 'Nezha', 'ESPP (UBS)',
      Math.round(costEUR), 'EUR', 1);
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

  const ibkrDepositsTotal = depositHistory.filter(d => d.platform === 'IBKR').reduce((s, d) => s + d.amountEUR, 0);
  const esppDeposits = esppCostBasisEUR + nezhaEsppCostBasisEUR;
  const sgtmDepositsEUR = depositHistory.filter(d => d.platform === 'Attijari (SGTM)').reduce((s, d) => s + d.amountEUR, 0);
  const totalDeposits = ibkrDepositsTotal + esppDeposits + sgtmDepositsEUR;

  // Cross-platform combined unrealized P/L
  const combinedUnrealizedPL = totalUnrealizedPL + esppUnrealizedPL + nezhaEsppUnrealizedPL;

  // Cross-platform total current value (excl SGTM which is not a brokerage)
  const totalCurrentValue = ibkrNAV + amineEspp + nezhaEspp;

  // ── Compute P&L of CLOSED positions per period ──
  // Date strings for period boundaries (same as computeIBKRPositions)
  const _now = new Date();
  const _pad2 = n => String(n).padStart(2, '0');
  const ytdStartStr = _now.getFullYear() + '-01-01';
  const mtdStartStr = _now.getFullYear() + '-' + _pad2(_now.getMonth() + 1) + '-01';
  const todayStr = _now.getFullYear() + '-' + _pad2(_now.getMonth() + 1) + '-' + _pad2(_now.getDate());
  const _oneMonthAgo = new Date(_now.getFullYear(), _now.getMonth() - 1, _now.getDate());
  const oneMonthStr = _oneMonthAgo.getFullYear() + '-' + _pad2(_oneMonthAgo.getMonth() + 1) + '-' + _pad2(_oneMonthAgo.getDate());
  // Positions fully sold during the year still contribute to period P&L.
  // For each sell trade in the period: P&L = proceeds - (shares × refPrice at period start)
  // If bought during the period (no refPrice): P&L = realizedPL (proceeds - cost)
  const ibkrSellTrades = (ibkr.trades || []).filter(t => t.type === 'sell' && t.source === 'ibkr');

  function closedPeriodPL(periodStartDate, getRefPrice) {
    let total = 0;
    // Only count sells of tickers that are NOT in current positions (fully closed)
    const openTickers = new Set(ibkr.positions.map(p => p.ticker));
    ibkrSellTrades.forEach(t => {
      if (t.date >= periodStartDate && !openTickers.has(t.ticker)) {
        // This sell was during the period AND the position is now fully closed
        const refPrice = getRefPrice(t.ticker);
        if (refPrice && refPrice > 0) {
          // P&L = proceeds - (shares × refPrice at period start), in EUR
          const refVal = toEUR(t.qty * refPrice, t.currency, fx);
          const proceedsEUR = toEUR(t.proceeds, t.currency, fx);
          total += proceedsEUR - refVal;
        } else if (typeof t.realizedPL === 'number') {
          // Bought and sold within the period — use realized P/L
          total += toEUR(t.realizedPL, t.currency, fx);
        }
      }
    });
    return total;
  }

  // Build ytdOpen price lookup from positions data
  const ytdOpenPrices = {};
  ibkr.positions.forEach(p => { ytdOpenPrices[p.ticker] = p.ytdOpen; });
  // Also add ytdOpen for closed positions from static data (if available)
  // GLE, WLN, EDEN, NXI had ytdOpen prices stored before they were sold
  // These should ideally be in data.js, but we can estimate from trade history

  // For now: if a ticker was sold and has no ytdOpen, use costBasis as fallback
  // (meaning full realized P/L counts for the period)
  ibkrSellTrades.forEach(t => {
    if (!ytdOpenPrices[t.ticker]) {
      ytdOpenPrices[t.ticker] = t.costBasis || 0; // fallback: use cost
    }
  });

  const closedYtdPL = closedPeriodPL(ytdStartStr, ticker => ytdOpenPrices[ticker]);
  const closedMtdPL = closedPeriodPL(mtdStartStr, ticker => {
    const pos = ibkr.positions.find(p => p.ticker === ticker);
    return pos ? pos.mtdOpen : (ytdOpenPrices[ticker] || 0); // fallback
  });
  const closedOneMonthPL = closedPeriodPL(oneMonthStr, ticker => {
    const pos = ibkr.positions.find(p => p.ticker === ticker);
    return pos ? pos.oneMonthAgo : (ytdOpenPrices[ticker] || 0);
  });
  const closedDailyPL = closedPeriodPL(todayStr, ticker => {
    const pos = ibkr.positions.find(p => p.ticker === ticker);
    return pos ? pos.previousClose : 0;
  });

  // Pre-compute YTD P&L for benchmark comparison
  // IBKR only — now includes closed positions P&L
  const ibkrYtdPL = ibkrPositions.reduce((s, p) => s + (p.ytdPL || 0), 0) + closedYtdPL;
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
    byTickerSource[key].pl += (t.realizedPL || 0);
    byTickerSource[key].costEUR += (t.cost || 0);
    byTickerSource[key].proceedsEUR += (t.proceeds || 0);
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
    // Accumulate cost from buy trades (sell trades have cost:'')
    cp.costEUR = allForTicker.filter(t => t.type === 'buy').reduce((s, t) => s + (t.cost || 0), 0);
    // Compute P/L:
    // - If ALL sells have report PL → use summed report PL (accurate, EUR, includes FX+commissions)
    // - If PARTIAL or NO report + cost data available → use proceeds-cost (native currency approx)
    // - Otherwise → keep pl=0 (no data)
    const allSellsCoveredByReport = cp._hasReportPL && cp._reportPLCount === cp.sells;
    if (allSellsCoveredByReport) {
      // cp.pl already correct from summing realizedPL during aggregation
    } else if (cp.costEUR > 0) {
      cp.pl = cp.proceedsEUR - cp.costEUR; // native currency approximation
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

  // 6. Strategic recommendation
  insights.push({
    type: 'recommendation',
    title: 'Recommandations Strat\u00e9giques',
    twr: meta.twr || 0,
    combinedRealizedPL: combinedRealizedPL,
    totalDeposits: totalDeposits,
    francePct: francePct,
    currentLosersCount: currentLosers.length,
    winRate: winRate,
  });

  // 7. Benchmark comparison (YTD 2026 — updated 10 mars 2026)
  // Sources : Yahoo Finance, tradingeconomics.com, APMEX, investing.com
  const benchmarks = {
    date: '10 mars 2026',
    ibkr: { twr: meta.twr || 0, ytdPct: ibkrYtdPct, label: 'Portefeuille IBKR' },
    total: { ytdPct: totalYtdPct, label: 'Portefeuille Total' },
    items: [
      { label: 'Or (XAU/USD)',       ytd: 21.0, note: '$5 070 — record historique, haven demand (Iran conflict)' },
      { label: 'S&P 500',            ytd: 12.5, note: '6 796 pts — AI + tech rally, vol \u00e9lev\u00e9e' },
      { label: 'MSCI World (EUR)',    ytd: 6.0,  note: 'Europe drag\u00e9e par \u00e9nergie, dollar fort' },
      { label: 'Bitcoin (BTC)',       ytd: -25.0, note: '~$67K — correction depuis $93K fin 2025' },
      { label: 'CAC 40',             ytd: 5.0,   note: 'Biais d\u00e9fensif, sous-perf vs US' },
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
  // JPY carry trade risk
  const jpyDebtEUR = Math.abs(toEUR(ibkr.cashJPY, 'JPY', fx));
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
    totalPositionsVal, totalCostBasis, totalUnrealizedPL,
    // ESPP detail
    esppVal: amineEspp,
    esppShares: espp.shares,
    esppPrice: m.acnPriceUSD,
    esppCostBasisUSD, esppCostBasisEUR, esppCurrentVal, esppUnrealizedPL,
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
    sgtmCostBasisEUR: m.sgtmCostBasisMAD
      ? toEUR((portfolio.amine.sgtm.shares + portfolio.nezha.sgtm.shares) * m.sgtmCostBasisMAD, 'MAD', fx)
      : null,
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
    // IBKR metrics
    twr: meta.twr || 0,
    realizedPL: ibkrRealizedPL,
    dividends: meta.dividends || 0,
    commissions: meta.commissions || 0,
    closedPositions: ibkrOnlyClosed,
    allClosedPositions: allClosed,
    trades: allTradesUnified,
    depositHistory: depositHistory,
    // Degiro — aggregated by ticker (pre-split + post-split merged)
    degiroClosedPositions: degiroOnlyClosed.map(t => {
      const cost = t.costEUR || 0;
      const proceeds = t.proceedsEUR || 0;
      const pl = t.pl || (cost > 0 ? (proceeds - cost) : 0);
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
    // Multi-period P&L (price + FX combined) with per-position breakdowns
    periodPL: (() => {
      function sumField(field) { return ibkrPositions.reduce((s, p) => s + (p[field] || 0), 0); }
      function hasField(field) { return ibkrPositions.some(p => p[field] !== null && p[field] !== undefined); }
      // ESPP period P&L (Amine + Nezha)
      function esppPeriod(refPrice) {
        if (!refPrice || refPrice <= 0) return 0;
        return esppCurrentVal - (espp.shares * refPrice / (fx.USD || 1));
      }
      function nezhaEsppPeriod(refPrice) {
        if (!refPrice || refPrice <= 0 || nezhaEsppShares <= 0) return 0;
        return nezhaEsppCurrentVal - (nezhaEsppShares * refPrice / (fx.USD || 1));
      }
      // Per-position breakdown for a given field
      function breakdown(field, esppRefPrice) {
        const items = [];
        ibkrPositions.forEach(p => {
          if (p[field] != null) items.push({ label: p.label, ticker: p.ticker, pl: p[field], valEUR: p.valEUR });
        });
        const esppPL = esppPeriod(esppRefPrice);
        const nezhaEsppPL = nezhaEsppPeriod(esppRefPrice);
        const acnTotalPL = esppPL + nezhaEsppPL;
        if (acnTotalPL !== 0) items.push({ label: 'Accenture (ACN)', ticker: 'ACN', pl: acnTotalPL, valEUR: esppCurrentVal + nezhaEsppCurrentVal });
        items.sort((a, b) => a.pl - b.pl); // worst first
        return items;
      }
      // IBKR cash FX P&L (daily only — uses FX_STATIC as prev)
      const jpyPrevFx = FX_STATIC.JPY || fx.JPY;
      const usdPrevFx = FX_STATIC.USD || fx.USD;
      const cashFxPL = (toEUR(ibkr.cashJPY, 'JPY', fx) - ibkr.cashJPY / jpyPrevFx)
                      + (toEUR(ibkr.cashUSD, 'USD', fx) - ibkr.cashUSD / usdPrevFx);
      return {
        // closedXxxPL adds P&L from positions FULLY SOLD during the period
        daily:    { total: sumField('dailyPL') + esppPeriod(m.acnPreviousClose) + nezhaEsppPeriod(m.acnPreviousClose) + cashFxPL + closedDailyPL, hasData: hasField('dailyPL'), breakdown: breakdown('dailyPL', m.acnPreviousClose), cashFxPL },
        mtd:      { total: sumField('mtdPL') + esppPeriod(m.acnMtdOpen) + nezhaEsppPeriod(m.acnMtdOpen) + closedMtdPL, hasData: hasField('mtdPL'), breakdown: breakdown('mtdPL', m.acnMtdOpen), cashFxPL: 0 },
        ytd:      { total: sumField('ytdPL') + esppPeriod(m.acnYtdOpen) + nezhaEsppPeriod(m.acnYtdOpen) + closedYtdPL, hasData: hasField('ytdPL'), breakdown: breakdown('ytdPL', m.acnYtdOpen), cashFxPL: 0 },
        oneMonth: { total: sumField('oneMonthPL') + esppPeriod(m.acnOneMonthAgo) + nezhaEsppPeriod(m.acnOneMonthAgo) + closedOneMonthPL, hasData: hasField('oneMonthPL'), breakdown: breakdown('oneMonthPL', m.acnOneMonthAgo), cashFxPL: 0 },
      };
    })(),
  };
}

/**
 * Compute cash view data
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
  // IBKR Pro — Benchmark (BM) JPY = 0.704% (mars 2026)
  //
  // ⚠️  POUR METTRE À JOUR : modifier les taux ci-dessous
  //     Tier 1: 0 → ¥11M    = BM + 1.5%  (actuellement 2.204%)
  //     Tier 2: ¥11M → ¥114M = BM + 1.0%  (actuellement 1.704%)
  //     Tier 3: > ¥114M      = BM + 0.75% (actuellement 1.454%)
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
    { label: 'ESPP Cash', native: p.amine.espp.cashEUR, currency: 'EUR', yield: CASH_YIELDS.esppCash, owner: 'Amine' },
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
 * Compute amortization schedule for a single loan
 * Returns: { schedule: [{month, date, payment, interest, principal, remainingCRD}], ...aggregates }
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
 * Compute amortization schedule for a single sub-loan (with optional periods)
 * Handles: constant payment, interest-only phases, deferred payment phases
 * Returns: [{month, date, payment, interest, principal, remainingCRD}]
 */
function computeSubLoanSchedule(loan) {
  const schedule = [];
  let crd = loan.principal;
  const monthlyRate = loan.rate / 12;
  const [startY, startM] = loan.startDate.split('-').map(Number);

  if (loan.periods && loan.periods.length > 0) {
    // Multi-period loan (PTZ with différé, BP with varying payments)
    let monthIdx = 0;
    for (const period of loan.periods) {
      for (let j = 0; j < period.months && crd > 0.01; j++) {
        const interest = crd * monthlyRate;
        let payment = period.payment;
        let principalPart;
        if (payment === 0) {
          // Deferred period — no payment
          // If rate > 0, interest capitalizes (CRD increases)
          // If rate = 0 (PTZ), CRD stays constant
          principalPart = 0;
          if (interest > 0) {
            crd += interest; // interest capitalization
          }
        } else {
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
    // Simple constant-payment loan (Action Logement)
    const totalMonths = loan.durationMonths;
    for (let i = 0; i < totalMonths && crd > 0.01; i++) {
      const interest = crd * monthlyRate;
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
 * Compute combined amortization schedule for multiple sub-loans
 * Merges individual schedules by calendar date, sums CRDs and payments
 * Returns same format as computeAmortizationSchedule() for compatibility
 */
function computeMultiLoanSchedule(subLoans, insuranceMonthly) {
  // Compute each sub-loan's schedule
  const subSchedules = subLoans.map(loan => ({
    loan,
    schedule: computeSubLoanSchedule(loan),
  }));

  // Build date-indexed maps for each sub-loan
  const dateMaps = subSchedules.map(s => {
    const map = {};
    for (const row of s.schedule) {
      map[row.date] = row;
    }
    return { loan: s.loan, map, principal: s.loan.principal };
  });

  // Collect all unique dates
  const allDates = new Set();
  for (const s of subSchedules) {
    for (const row of s.schedule) allDates.add(row.date);
  }
  const sortedDates = [...allDates].sort();

  // Build combined schedule
  const schedule = [];
  // Track last known CRD per sub-loan for dates where a loan hasn't started yet or has ended
  const lastCRD = dateMaps.map(d => d.principal); // start at full principal

  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    let totalPayment = 0, totalInterest = 0, totalPrincipal = 0, totalCRD = 0;

    for (let k = 0; k < dateMaps.length; k++) {
      const row = dateMaps[k].map[date];
      if (row) {
        totalPayment += row.payment;
        totalInterest += row.interest;
        totalPrincipal += row.principal;
        totalCRD += row.remainingCRD;
        lastCRD[k] = row.remainingCRD;
      } else {
        // Loan hasn't started yet → use full principal, or has ended → use 0
        const loanDates = Object.keys(dateMaps[k].map).sort();
        if (loanDates.length === 0 || date < loanDates[0]) {
          totalCRD += dateMaps[k].principal;
        } else {
          totalCRD += 0; // loan ended
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

  // Find current month index
  const now = new Date();
  const nowKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  let currentIdx = schedule.findIndex(r => r.date >= nowKey);
  if (currentIdx < 0) currentIdx = schedule.length - 1;

  const interestPaid = schedule.slice(0, currentIdx + 1).reduce((s, r) => s + r.interest, 0);
  const interestRemaining = schedule.slice(currentIdx + 1).reduce((s, r) => s + r.interest, 0);
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  const ins = insuranceMonthly || 0;
  const totalCost = totalInterest + ins * schedule.length;

  // Combined principal
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
 * Compute exit costs for a property at a given sale price and holding duration
 * Returns breakdown: PV tax (IR + PS + surtaxe), agency fees, mainlevée, TVA clawback, total
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
    result.abattementIR = Math.min(1, totalAbattIR);

    // Calcul abattement PS
    let totalAbattPS = 0;
    for (const bracket of EC.psAbattement) {
      for (let y = bracket.fromYear; y <= bracket.toYear && y <= years; y++) {
        totalAbattPS += bracket.ratePerYear;
      }
    }
    if (years >= 30) totalAbattPS = 1;  // Exonéré PS après 30 ans
    result.abattementPS = Math.min(1, totalAbattPS);

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
        const lname = (loan.name || '').toLowerCase();
        const isExempt = exemptTypes.some(t => lname.includes(t));
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
      const yearsRemaining = tva.dureeEngagement - Math.max(0, Math.floor(yearsSinceLivraison));
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
  const holdingYears = (targetYear - pY) + (6 - pM) / 12; // approx mid-year
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
 * Compute immo view data
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
    // ── Dynamic property valuation ──
    // Value evolves from valueDate using appreciation rate (compound monthly)
    const propMeta0 = IC.properties[loanKey] || {};
    const appreciationRate0 = propMeta0.appreciation || 0;
    let currentValue = propData.value;
    const valueDateStr = propData.valueDate || null;
    if (valueDateStr && appreciationRate0 > 0) {
      const [vy, vm] = valueDateStr.split('-').map(Number);
      const now0 = new Date();
      const monthsSinceRef = (now0.getFullYear() - vy) * 12 + (now0.getMonth() + 1 - vm);
      if (monthsSinceRef > 0) {
        // Use phase-specific rates if available
        const phases = propMeta0.appreciationPhases || [];
        let val = propData.value;
        let refYear = vy;
        let refMonth = vm;
        for (let m = 0; m < monthsSinceRef; m++) {
          const yr = refYear + Math.floor((refMonth + m - 1) / 12);
          let rate = appreciationRate0;
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

    const charges = chargesConfig.pret + chargesConfig.assurance + chargesConfig.pno + chargesConfig.tf + chargesConfig.copro;
    // loyerHC: rent portion (excluding tenant charges provision)
    const loyerHC = propData.loyerHC !== undefined ? propData.loyerHC : (propData.loyer || 0);
    const parking = propData.parking || 0;
    const chargesLoc = propData.chargesLocataire || 0;
    const loyer = loyerHC + parking;        // HC display value
    const totalRevenue = loyer + chargesLoc; // full revenue (charges provision offsets copro)
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
    const computedCRD = amort
      ? amort.schedule[amort.currentIdx]?.remainingCRD ?? propData.crd
      : propData.crd;

    // Loan details for detail panel
    const subLoansKey = loanKey + 'Loans';
    let loanDetails = [];
    if (IC.loans && IC.loans[subLoansKey]) {
      loanDetails = IC.loans[subLoansKey].map(l => ({
        name: l.name, principal: l.principal, rate: l.rate,
        durationMonths: l.durationMonths, monthlyPayment: l.monthlyPayment || (l.periods ? l.periods.find(p => p.payment > 0)?.payment : 0),
        insuranceMonthly: l.insuranceMonthly || 0,
      }));
    } else if (IC.loans && IC.loans[loanKey]) {
      const l = IC.loans[loanKey];
      loanDetails = [{ name: 'Prêt principal', principal: l.principal, rate: l.rate,
        durationMonths: l.durationMonths, monthlyPayment: l.monthlyPayment,
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

    // ── Wealth creation breakdown (computed dynamically) ──
    const currentAmortRow = amort ? amort.schedule[amort.currentIdx] : null;
    const capitalAmortiMois = currentAmortRow ? currentAmortRow.principal : 0;
    const appreciationRate = (IC.properties[loanKey] || {}).appreciation || 0;
    const appreciationMois = _val * appreciationRate / 12;
    // For conditional properties (not signed / not delivered): no CF, no capital — only appreciation
    const wealthCF = conditional ? 0 : cf;
    const wealthCapital = conditional ? 0 : capitalAmortiMois;
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
      prop.fiscalSimConfig = {
        loyerTotalCC: vitryProp.loyerTotalCC || propMeta.loyerObjectif || 1200,
        loyerDeclareCC: vitryProp.loyerDeclareCC || 600,
        contractStartMonth: 4,    // Location effective starts April 2026
        tfExemptionEndYear: 2027, // TF exonerated for new construction
        startYear: 2026,
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
        deliveryDate: propMeta.deliveryDate || '2029-06',
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

  const totalNominal = allItems.reduce((s, i) => s + i.amountEUR, 0);
  const totalExpected = allItems.reduce((s, i) => s + i.expectedValue, 0);
  const totalGuaranteed = allItems.filter(i => i.guaranteed).reduce((s, i) => s + i.amountEUR, 0);
  const totalUncertain = allItems.filter(i => !i.guaranteed).reduce((s, i) => s + i.amountEUR, 0);
  const monthlyInflationCost = allItems.reduce((s, i) => s + i.monthlyInflationCost, 0);
  const totalRecovered = allItems.reduce((s, i) => s + i.paymentsTotal, 0);
  const totalOverdue = allItems.filter(i => i.daysOverdue > 0).reduce((s, i) => s + i.remainingEUR, 0);
  const needsFollowUpCount = allItems.filter(i => i.needsFollowUp).length;

  return {
    items: allItems,
    totalNominal,
    totalExpected,
    totalGuaranteed,
    totalUncertain,
    monthlyInflationCost,
    totalRecovered,
    totalOverdue,
    needsFollowUpCount,
  };
}

/**
 * Compute budget view — monthly expenses breakdown
 * Separates personal expenses from investment (immo) expenses
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
  // Villejuif: charges décalées — début ~3 ans après premier déblocage (avril 2025 → avril 2028)
  const chargeLabels = { pret: 'Prêt', assurance: 'Assurance crédit', pno: 'PNO', tf: 'Taxe foncière', copro: 'Copropriété' };
  const propNames = { vitry: 'Vitry', rueil: 'Rueil', villejuif: 'Villejuif' };
  // Villejuif : promesse de vente, prêt pas débloqué. Seule l'assurance prêt est payée (51€/mois).
  // Les autres charges (prêt, PNO, TF, copro) démarreront après livraison (~2029).
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
 * Master compute function — returns complete STATE
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
  const amineUaeAED = p.amine.uae.mashreq + p.amine.uae.wioSavings + p.amine.uae.wioCurrent;
  const amineUae = toEUR(amineUaeAED, 'AED', fx);  // UAE = AED accounts only
  const amineRevolutEUR = p.amine.uae.revolutEUR;   // Revolut = French account (EUR)
  // Weighted average yield for Cash UAE bucket (AED accounts only)
  const amineUaeYield = amineUae > 0
    ? (toEUR(p.amine.uae.mashreq, 'AED', fx) * CASH_YIELDS.mashreq
      + toEUR(p.amine.uae.wioSavings, 'AED', fx) * CASH_YIELDS.wioSavings
      + toEUR(p.amine.uae.wioCurrent, 'AED', fx) * CASH_YIELDS.wioCurrent) / amineUae
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
  const amineEspp = toEUR(p.amine.espp.shares * m.acnPriceUSD, 'USD', fx); // Cash ESPP côté cashView, pas ici
  const amineVitryCRD = immoCRDs.vitry ?? p.amine.immo.vitry.crd;
  const amineVitryEquityBrute = p.amine.immo.vitry.value - amineVitryCRD;
  // Net equity = after exit costs, floored at 0 (if negative → not mature enough to sell)
  const vitryExitCosts = immoView.properties.find(pr => pr.loanKey === 'vitry')?.exitCosts;
  const amineVitryEquity = Math.max(0, vitryExitCosts ? vitryExitCosts.netEquityAfterExit : amineVitryEquityBrute);
  const amineVehicles = p.amine.vehicles.cayenne + p.amine.vehicles.mercedes;

  // Creances — split by type: pro (factures clients) vs perso (prêts famille/amis)
  let amineRecvPro = 0, amineRecvPersonal = 0;
  if (p.amine.creances.items) {
    p.amine.creances.items.forEach(c => {
      const val = toEUR(c.amount, c.currency, fx);
      if (c.type === 'pro') amineRecvPro += val;
      else amineRecvPersonal += val;
    });
  }

  const amineTva = p.amine.tva;
  const amineCashTotal = amineUae + amineRevolutEUR + amineMoroccoCash;
  const amineTotalAssets = amineIbkr + amineEspp + amineCashTotal + amineSgtm
    + amineVitryEquity + amineVehicles + amineRecvPro + amineRecvPersonal;
  const amineNW = amineTotalAssets + amineTva;

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
    ibkr: amineIbkr,
    espp: amineEspp,
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
    totalAssets: amineTotalAssets,
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
  const nezhaEspp = toEUR(nezhaEsppShares * m.acnPriceUSD, 'USD', fx);
  const nezhaEsppCostBasisUSD = nezhaEsppData.totalCostBasisUSD || 0;
  const nezhaEsppCostBasisEUR = toEUR(nezhaEsppCostBasisUSD, 'USD', fx);
  const nezhaEsppUnrealizedPL = nezhaEspp - nezhaEsppCostBasisEUR;
  // Caution Rueil — dette envers locataire
  const nezhaCautionRueil = p.nezha.cautionRueil || 0;
  const nezhaRecvOmar = p.nezha.creances && p.nezha.creances.items
    ? toEUR(p.nezha.creances.items[0].amount, p.nezha.creances.items[0].currency, fx)
    : 0;
  const nezhaCash = nezhaCashFranceEUR + nezhaCashMarocEUR + nezhaCashUAE_EUR;
  const nezhaNW = nezhaRueilEquity + nezhaCash + nezhaSgtm + nezhaEspp + nezhaRecvOmar + nezhaVillejuifReservation - nezhaCautionRueil;

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
    espp: nezhaEspp,
    esppShares: nezhaEsppShares,
    esppCostBasisEUR: nezhaEsppCostBasisEUR,
    esppUnrealizedPL: nezhaEsppUnrealizedPL,
    cautionRueil: nezhaCautionRueil,
    recvOmar: nezhaRecvOmar,
    recvOmarMAD: p.nezha.creances && p.nezha.creances.items ? p.nezha.creances.items[0].amount : 40000,
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
        const ibkrCash = toEUR(p.amine.ibkr.cashEUR, 'EUR', fx) + toEUR(p.amine.ibkr.cashUSD, 'USD', fx) + toEUR(p.amine.ibkr.cashJPY, 'JPY', fx);
        return ibkrNonCryptoVal + ibkrCash + amineEspp + nezhaEspp + amineSgtm + nezhaSgtm;
      })(),
      sub: [
        ...p.amine.ibkr.positions.filter(pos => pos.sector !== 'crypto').map((pos, i) => {
          const colors = ['#1e3a5f','#2563eb','#3b82f6','#0284c7','#0369a1','#1d4ed8','#4338ca','#6366f1','#7c3aed','#0891b2'];
          const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
          // Short label = company name without ticker
          const short = pos.label.replace(/\s*\(.*\)/, '');
          return { label: short, val: valEUR, color: colors[i % colors.length], owner: 'Amine — IBKR', ticker: pos.ticker };
        }),
        { label: 'Cash IBKR', val: toEUR(p.amine.ibkr.cashEUR, 'EUR', fx) + toEUR(p.amine.ibkr.cashUSD, 'USD', fx) + toEUR(p.amine.ibkr.cashJPY, 'JPY', fx), color: '#1e40af', owner: 'Amine — IBKR' },
        { label: 'ESPP Accenture', val: amineEspp + nezhaEspp, color: '#6366f1', owner: 'Amine + Nezha — ESPP' },
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
      total: (p.amine.uae.wioCurrent > 0 ? toEUR(p.amine.uae.wioCurrent, 'AED', fx) : 0) + amineRevolutEUR + amineMoroccoCash
        + nc.revolutEUR + nc.creditMutuelCC + nc.lclLivretA + nc.lclCompteDepots + nezhaCashMarocEUR + nezhaCashUAE_EUR,
      sub: [
        ...(nc.revolutEUR > 0 ? [{ label: 'Revolut (Nezha)', val: nc.revolutEUR, color: '#ef4444', owner: 'Nezha — 0%' }] : []),
        ...(nc.creditMutuelCC > 0 ? [{ label: 'Crédit Mutuel', val: nc.creditMutuelCC, color: '#dc2626', owner: 'Nezha — 0%' }] : []),
        ...(nc.lclLivretA > 0 ? [{ label: 'Livret A (LCL)', val: nc.lclLivretA, color: '#f87171', owner: 'Nezha — 1.5%' }] : []),
        ...(nc.lclCompteDepots > 0 ? [{ label: 'LCL Dépôts', val: nc.lclCompteDepots, color: '#b91c1c', owner: 'Nezha — 0%' }] : []),
        ...(nezhaCashMarocEUR > 0 ? [{ label: 'Attijariwafa (Nezha)', val: nezhaCashMarocEUR, color: '#991b1b', owner: 'Nezha — 0%' }] : []),
        ...(nezhaCashUAE_EUR > 0 ? [{ label: 'Wio UAE (Nezha)', val: nezhaCashUAE_EUR, color: '#7f1d1d', owner: 'Nezha — 0%' }] : []),
        ...(amineMoroccoCash > 0 ? [{ label: 'Cash Maroc (Amine)', val: amineMoroccoCash, color: '#f87171', owner: 'Amine — 0%' }] : []),
        ...(p.amine.uae.wioCurrent > 0 ? [{ label: 'Wio Current', val: toEUR(p.amine.uae.wioCurrent, 'AED', fx), color: '#fca5a5', owner: 'Amine — 0%' }] : []),
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
      label: 'Creances', color: '#ec4899',
      total: amineRecvPro + amineRecvPersonal + nezhaRecvOmar + nezhaVillejuifReservation,
      sub: [
        { label: 'Créances pro', val: amineRecvPro, color: '#ec4899', owner: 'Amine — SAP, Malt, Loyers' },
        { label: 'Créances perso', val: amineRecvPersonal, color: '#db2777', owner: 'Amine — Kenza, Mehdi, etc.' },
        { label: 'Creance Omar', val: nezhaRecvOmar, color: '#be185d', owner: 'Nezha' },
        ...(!villejuifSigned && nezhaVillejuifReservation > 0 ? [{ label: 'Reservation Villejuif', val: nezhaVillejuifReservation, color: '#f472b6', owner: 'Nezha — remboursable' }] : []),
      ]
    },
  ];

  // ---- VIEW-SPECIFIC CATEGORY CARDS ----
  const views = {
    couple: {
      title: 'Dashboard Patrimonial',
      subtitle: 'Amine (33 ans) & Nezha (34 ans) Koraibi \u2014 Vue consolidee',
      stocks:    { val: amineIbkr + amineEspp + nezhaEspp + amineSgtm + nezhaSgtm, sub: 'IBKR + ESPP x2 + SGTM x2' },
      cash:      { val: amineCashTotal + nezhaCash, sub: 'UAE + France + Maroc' },
      immo:      { val: coupleImmoEquity, sub: nbBiens + ' biens \u2014 Equity nette' },
      other:     { val: amineVehicles + amineRecvPro + amineRecvPersonal + amineTva + nezhaRecvOmar + nezhaVillejuifReservation, sub: 'Vehicules + Creances - TVA', title: 'Autres Actifs' },
      nwRef: coupleNW,
      showStocks: true, showCash: true, showOther: true,
    },
    amine: {
      title: 'Dashboard \u2014 Amine Koraibi',
      subtitle: 'Amine Koraibi, 33 ans \u2014 Actions, Crypto, Immobilier, Cash',
      stocks:    { val: amineIbkr + amineEspp + amineSgtm, sub: 'IBKR + ESPP + SGTM' },
      cash:      { val: amineCashTotal, sub: 'UAE + Revolut + Maroc' },
      immo:      { val: amineVitryEquity, sub: '1 bien \u2014 Vitry' },
      other:     { val: amineVehicles + amineRecvPro + amineRecvPersonal + amineTva, sub: 'Vehicules + Creances - TVA', title: 'Autres Actifs' },
      nwRef: amineNW,
      showStocks: true, showCash: true, showOther: true,
    },
    nezha: {
      title: 'Dashboard \u2014 Nezha Kabbaj',
      subtitle: 'Nezha Kabbaj, 34 ans \u2014 Immobilier',
      stocks:    { val: nezhaSgtm + nezhaEspp, sub: 'ESPP (' + nezhaEsppShares + ' ACN) + SGTM' },
      cash:      { val: nezhaCash, sub: Math.round(nezhaCashFranceEUR/1000) + 'K France + ' + Math.round(nezhaCashMarocEUR/1000) + 'K Maroc + ' + Math.round(nezhaCashUAE_EUR/1000) + 'K UAE' },
      immo:      { val: nezhaRueilEquity + nezhaVillejuifEquity, sub: villejuifSigned ? '2 biens \u2014 Rueil + Villejuif' : '1 bien \u2014 Rueil' },
      other:     { val: nezhaRecvOmar + nezhaVillejuifReservation, sub: villejuifSigned ? 'Creance Omar (40K MAD)' : 'Creances + Reservation Villejuif', title: 'Creances' },
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
  }).filter(s => s.val > 100);
  const ibkrCashVal = toEUR(p.amine.ibkr.cashEUR, 'EUR', fx) + toEUR(p.amine.ibkr.cashUSD, 'USD', fx) + toEUR(p.amine.ibkr.cashJPY, 'JPY', fx);
  const cryptoSubs = p.amine.ibkr.positions.filter(pos => pos.sector === 'crypto').map((pos, i) => {
    const colors = ['#f59e0b','#d97706'];
    const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
    const short = pos.label.replace(/\s*\(.*\)/, '');
    return { label: short, val: valEUR, color: colors[i % colors.length], owner: 'IBKR' };
  });

  const amineCategories = [
    {
      label: 'Actions IBKR', color: '#2b6cb0',
      total: ibkrNonCryptoSubs.reduce((s, p) => s + p.val, 0) + ibkrCashVal,
      sub: [...ibkrNonCryptoSubs, ...(ibkrCashVal > 100 ? [{ label: 'Cash IBKR', val: ibkrCashVal, color: '#1e40af', owner: 'IBKR' }] : [])]
    },
    {
      label: 'Crypto', color: '#f59e0b',
      total: cryptoSubs.reduce((s, p) => s + p.val, 0),
      sub: cryptoSubs
    },
    {
      label: 'Autres Actions', color: '#6366f1',
      total: amineEspp + amineSgtm,
      sub: [
        { label: 'ESPP Accenture', val: amineEspp, color: '#6366f1', owner: 'ESPP' },
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
      total: (p.amine.uae.wioCurrent > 0 ? toEUR(p.amine.uae.wioCurrent, 'AED', fx) : 0) + amineRevolutEUR + amineMoroccoCash,
      sub: [
        ...(amineMoroccoCash > 0 ? [{ label: 'Cash Maroc', val: amineMoroccoCash, color: '#ef4444', owner: '0%' }] : []),
        ...(p.amine.uae.wioCurrent > 0 ? [{ label: 'Wio Current', val: toEUR(p.amine.uae.wioCurrent, 'AED', fx), color: '#dc2626', owner: '0%' }] : []),
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
      label: 'Creances', color: '#ec4899',
      total: amineRecvPro + amineRecvPersonal,
      sub: [
        { label: 'Créances pro', val: amineRecvPro, color: '#ec4899', owner: 'SAP, Malt, Loyers' },
        { label: 'Créances perso', val: amineRecvPersonal, color: '#db2777', owner: 'Kenza, Mehdi, etc.' },
      ].filter(s => s.val > 100)
    },
  ].filter(c => c.total > 0);

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
      total: nezhaSgtm + nezhaEspp,
      sub: [
        ...(nezhaEspp > 100 ? [{ label: 'ESPP Accenture', val: nezhaEspp, color: '#6366f1', owner: 'UBS' }] : []),
        { label: 'SGTM', val: nezhaSgtm, color: '#818cf8', owner: 'Maroc' },
      ]
    },
    {
      label: 'Creances', color: '#ec4899',
      total: nezhaRecvOmar + nezhaVillejuifReservation,
      sub: [
        { label: 'Creance Omar', val: nezhaRecvOmar, color: '#be185d', owner: '40K MAD' },
        ...(!villejuifSigned && nezhaVillejuifReservation > 0 ? [{ label: 'Reservation Villejuif', val: nezhaVillejuifReservation, color: '#f472b6', owner: 'Remboursable' }] : []),
      ]
    },
  ].filter(c => c.total > 0);

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
  // Add IBKR Cash
  if (ibkrCashVal > 100) {
    if (!geoGroups['cash']) geoGroups['cash'] = [];
    // We'll put cash in its own category
  }
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
  };
}

/**
 * Compute the grand total from couple categories
 */
export function getGrandTotal(state) {
  return state.coupleCategories.reduce((s, c) => s + c.total, 0);
}
