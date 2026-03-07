// ============================================================
// ENGINE — Pure computation. No DOM access, no side effects.
// ============================================================
// compute(portfolio, fx, stockSource) → STATE object

import { CASH_YIELDS, INFLATION_RATE, IMMO_CONSTANTS } from './data.js';

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
 */
function computeIBKRPositions(portfolio, fx) {
  const ibkr = portfolio.amine.ibkr;
  const positions = ibkr.positions.map(pos => {
    const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
    const costEUR = toEUR(pos.shares * pos.costBasis, pos.currency, fx);
    const unrealizedPL = valEUR - costEUR;
    const pctPL = costEUR > 0 ? (unrealizedPL / costEUR * 100) : 0;
    let priceLabel = '';
    if (pos.currency === 'EUR') priceLabel = pos.price.toFixed(2) + ' EUR';
    else if (pos.currency === 'USD') priceLabel = '$' + pos.price.toFixed(2);
    else if (pos.currency === 'JPY') priceLabel = '\u00a5' + Math.round(pos.price);
    return { ...pos, valEUR, costEUR, unrealizedPL, pctPL, priceLabel };
  }).sort((a, b) => b.valEUR - a.valEUR);

  // Compute weights
  const totalVal = positions.reduce((s, p) => s + p.valEUR, 0);
  positions.forEach(p => { p.weight = totalVal > 0 ? (p.valEUR / totalVal * 100) : 0; });
  return positions;
}

/**
 * Compute actions view data (stocks cockpit)
 */
function computeActionsView(portfolio, fx, stockSource, ibkrNAV, ibkrPositions, amineSgtm, nezhaSgtm, amineEspp) {
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

  // Total all stocks (IBKR + ESPP + SGTM)
  const totalStocks = ibkrNAV + amineEspp + amineSgtm + nezhaSgtm;

  // Geo allocation from IBKR positions
  const geoAllocation = {};
  ibkrPositions.forEach(p => {
    const geo = p.geo || 'other';
    geoAllocation[geo] = (geoAllocation[geo] || 0) + p.valEUR;
  });
  geoAllocation.us = (geoAllocation.us || 0) + amineEspp;
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
  const degiroClosedPositions = degiro.closedPositions || [];
  const degiroRealizedPL = degiro.totalRealizedPL || 0;

  // Combined realized P/L (IBKR + Degiro)
  const ibkrRealizedPL = meta.realizedPL || 0;
  const combinedRealizedPL = ibkrRealizedPL + degiroRealizedPL;

  // Cross-platform deposits
  const ibkrDeposits = meta.deposits || 0;
  const esppDeposits = esppCostBasisEUR; // employee paid this amount
  const totalDeposits = ibkrDeposits + esppDeposits;

  // Cross-platform combined unrealized P/L
  const combinedUnrealizedPL = totalUnrealizedPL + esppUnrealizedPL;

  // Cross-platform total current value (excl SGTM which is not a brokerage)
  const totalCurrentValue = ibkrNAV + amineEspp;

  // --- Investment Insights ---
  const insights = [];

  // 1. Stock picking track record
  const allClosed = [...(meta.closedPositions || []), ...degiroClosedPositions];
  const winners = allClosed.filter(p => p.pl > 0);
  const losers = allClosed.filter(p => p.pl < 0);
  const winRate = allClosed.length > 0 ? (winners.length / allClosed.length * 100) : 0;
  const totalWins = winners.reduce((s, p) => s + p.pl, 0);
  const totalLosses = Math.abs(losers.reduce((s, p) => s + p.pl, 0));
  insights.push({
    type: 'track-record',
    title: 'Track Record Stock Picking',
    winRate: winRate,
    winners: winners.length,
    losers: losers.length,
    totalTrades: allClosed.length,
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
    // SGTM
    sgtmAmineVal: amineSgtm,
    sgtmNezhaVal: nezhaSgtm,
    sgtmTotal: amineSgtm + nezhaSgtm,
    // Totals
    totalStocks,
    totalCurrentValue,
    // IBKR metrics
    twr: meta.twr || 0,
    realizedPL: ibkrRealizedPL,
    dividends: meta.dividends || 0,
    commissions: meta.commissions || 0,
    closedPositions: meta.closedPositions || [],
    deposits: ibkrDeposits,
    // Degiro
    degiroClosedPositions,
    degiroRealizedPL,
    // Cross-platform
    combinedRealizedPL,
    combinedUnrealizedPL,
    totalDeposits,
    geoAllocation,
    sectorAllocation,
    insights,
  };
}

/**
 * Compute cash view data
 */
function computeCashView(portfolio, fx) {
  const p = portfolio;
  const accounts = [
    { label: 'Mashreq NEO+', native: p.amine.uae.mashreq, currency: 'AED', yield: CASH_YIELDS.mashreq, owner: 'Amine' },
    { label: 'Wio Savings', native: p.amine.uae.wioSavings, currency: 'AED', yield: CASH_YIELDS.wioSavings, owner: 'Amine' },
    { label: 'Wio Current', native: p.amine.uae.wioCurrent, currency: 'AED', yield: CASH_YIELDS.wioCurrent, owner: 'Amine' },
    { label: 'Revolut EUR', native: p.amine.uae.revolutEUR, currency: 'EUR', yield: CASH_YIELDS.revolutEUR, owner: 'Amine' },
    { label: 'Attijariwafa', native: p.amine.maroc.attijari, currency: 'MAD', yield: CASH_YIELDS.attijari, owner: 'Amine' },
    { label: 'Nabd (ex-SOGE)', native: p.amine.maroc.nabd, currency: 'MAD', yield: CASH_YIELDS.nabd, owner: 'Amine' },
    { label: 'IBKR Cash EUR', native: p.amine.ibkr.cashEUR, currency: 'EUR', yield: CASH_YIELDS.ibkrCashEUR, owner: 'Amine' },
    { label: 'IBKR Cash USD', native: p.amine.ibkr.cashUSD, currency: 'USD', yield: CASH_YIELDS.ibkrCashUSD, owner: 'Amine' },
    { label: 'IBKR Cash JPY', native: p.amine.ibkr.cashJPY, currency: 'JPY', yield: 0, owner: 'Amine', isDebt: true },
    { label: 'ESPP Cash', native: p.amine.espp.cashEUR, currency: 'EUR', yield: CASH_YIELDS.esppCash, owner: 'Amine' },
    { label: 'Cash France', native: p.nezha.cashFrance, currency: 'EUR', yield: CASH_YIELDS.nezhaCashFrance, owner: 'Nezha' },
    { label: 'Cash Maroc', native: p.nezha.cashMaroc, currency: 'MAD', yield: CASH_YIELDS.nezhaCashMaroc, owner: 'Nezha' },
  ];

  let totalCash = 0, totalYielding = 0, totalNonYielding = 0;
  let weightedYieldSum = 0;
  const byCurrency = {};

  accounts.forEach(a => {
    a.valEUR = toEUR(a.native, a.currency, fx);
    totalCash += a.valEUR;
    if (a.yield > 0) {
      totalYielding += a.valEUR;
      weightedYieldSum += a.valEUR * a.yield;
    } else {
      totalNonYielding += a.valEUR;
    }
    byCurrency[a.currency] = (byCurrency[a.currency] || 0) + a.valEUR;
  });

  const weightedAvgYield = totalCash > 0 ? (weightedYieldSum / totalCash) : 0;
  const monthlyInflationCost = totalNonYielding * INFLATION_RATE / 12;
  const annualInflationCost = totalNonYielding * INFLATION_RATE;
  const jpyShortEUR = toEUR(portfolio.amine.ibkr.cashJPY, 'JPY', fx);

  // --- Cash Diagnostic: urgent actions (raw data, formatted in render.js) ---
  const diagnostics = [];

  // 1. Dormant cash losing to inflation
  const dormantAccounts = accounts.filter(a => a.yield === 0 && a.valEUR > 1000);
  dormantAccounts.forEach(a => {
    const erosion = a.valEUR * INFLATION_RATE;
    diagnostics.push({
      severity: a.valEUR > 10000 ? 'urgent' : 'warning',
      category: 'inflation',
      account: a.label,
      owner: a.owner,
      amountEUR: a.valEUR,
      annualLoss: erosion,
      currency: a.currency,
      inflationPct: INFLATION_RATE * 100,
      action: a.currency === 'AED' ? 'Transférer vers Wio Savings (6%) ou Mashreq NEO+ (6.25%)'
        : a.currency === 'MAD' ? 'Ouvrir un DAT ou OPCVM monétaire au Maroc (3-4%)'
        : a.currency === 'EUR' && a.label.includes('Revolut') ? 'Activer le coffre Revolut ou transférer vers un livret (2-3%)'
        : a.currency === 'EUR' && a.label.includes('ESPP') ? 'Transférer vers compte rémunéré ou investir'
        : a.currency === 'EUR' ? 'Placer sur livret, fonds euro, ou OPCVM monétaire'
        : 'Chercher un placement rémunéré dans cette devise',
    });
  });

  // 2. Concentration risk by currency
  const currencyEntries = Object.entries(byCurrency).map(([cur, val]) => ({ cur, val, pct: val / totalCash * 100 }));
  currencyEntries.filter(c => c.pct > 50).forEach(c => {
    diagnostics.push({
      severity: 'warning',
      category: 'concentration',
      amountEUR: c.val,
      totalCashEUR: totalCash,
      concentrationPct: c.pct,
      concentrationCur: c.cur,
      action: 'Diversifier progressivement vers EUR ou USD pour réduire le risque devise.',
    });
  });

  // 3. JPY short risk
  if (jpyShortEUR < -5000) {
    const riskAmount = Math.abs(jpyShortEUR) * 0.10;
    diagnostics.push({
      severity: 'warning',
      category: 'forex',
      amountEUR: Math.abs(jpyShortEUR),
      jpyShortEUR: jpyShortEUR,
      riskAmount: riskAmount,
      action: 'Surveiller le JPY/EUR. Définir un stop-loss ou couvrir partiellement si le yen se renforce.',
    });
  }

  // 4. Total inflation cost summary
  if (annualInflationCost > 2000) {
    diagnostics.push({
      severity: 'urgent',
      category: 'erosion',
      amountEUR: totalNonYielding,
      annualLoss: annualInflationCost,
      monthlyLoss: monthlyInflationCost,
      potentialGain: totalNonYielding * 0.04,
      action: 'Priorité #1 : placer le cash dormant pour stopper l\'érosion.',
    });
  }

  // Sort: urgent first, then by amount
  diagnostics.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'urgent' ? -1 : 1;
    return (b.amountEUR || 0) - (a.amountEUR || 0);
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
  };
}

/**
 * Compute immo view data
 */
function computeImmoView(portfolio, fx) {
  const IC = IMMO_CONSTANTS;
  const properties = [];

  // Vitry
  const v = portfolio.amine.immo.vitry;
  const vitryCharges = IC.charges.vitry.pret + IC.charges.vitry.assurance + IC.charges.vitry.pno + IC.charges.vitry.tf + IC.charges.vitry.copro;
  const vitryLoyer = v.loyer + (v.parking || 0);
  const vitryCF = vitryLoyer - vitryCharges;
  properties.push({
    name: 'Vitry-sur-Seine', owner: 'Amine',
    value: v.value, crd: v.crd, equity: v.value - v.crd,
    ltv: (v.crd / v.value * 100),
    monthlyPayment: IC.charges.vitry.pret + IC.charges.vitry.assurance,
    loyer: vitryLoyer, cf: vitryCF,
    yieldGross: (vitryLoyer * 12 / v.value * 100),
    yieldNet: (vitryCF * 12 / v.value * 100),
    wealthCreation: IC.growth.vitry,
    endYear: IC.prets.vitryEnd,
    charges: vitryCharges,
  });

  // Rueil
  const r = portfolio.nezha.immo.rueil;
  const rueilCharges = IC.charges.rueil.pret + IC.charges.rueil.assurance + IC.charges.rueil.pno + IC.charges.rueil.tf + IC.charges.rueil.copro;
  const rueilLoyer = r.loyer;
  const rueilCF = rueilLoyer - rueilCharges;
  properties.push({
    name: 'Rueil-Malmaison', owner: 'Nezha',
    value: r.value, crd: r.crd, equity: r.value - r.crd,
    ltv: (r.crd / r.value * 100),
    monthlyPayment: IC.charges.rueil.pret + IC.charges.rueil.assurance,
    loyer: rueilLoyer, cf: rueilCF,
    yieldGross: (rueilLoyer * 12 / r.value * 100),
    yieldNet: (rueilCF * 12 / r.value * 100),
    wealthCreation: IC.growth.rueil,
    endYear: IC.prets.rueilEnd,
    charges: rueilCharges,
  });

  // Villejuif
  const vj = portfolio.nezha.immo.villejuif;
  const vjCharges = IC.charges.villejuif.pret + IC.charges.villejuif.assurance + IC.charges.villejuif.pno + IC.charges.villejuif.tf + IC.charges.villejuif.copro;
  const vjLoyer = vj.loyer;
  const vjCF = vjLoyer - vjCharges;
  properties.push({
    name: 'Villejuif (VEFA)', owner: 'Nezha', conditional: true,
    value: vj.value, crd: vj.crd, equity: vj.value - vj.crd,
    ltv: (vj.crd / vj.value * 100),
    monthlyPayment: IC.charges.villejuif.pret + IC.charges.villejuif.assurance,
    loyer: vjLoyer, cf: vjCF,
    yieldGross: (vjLoyer * 12 / vj.value * 100),
    yieldNet: (vjCF * 12 / vj.value * 100),
    wealthCreation: IC.growth.villejuif,
    endYear: IC.prets.villejuifEnd,
    charges: vjCharges,
  });

  const totalEquity = properties.reduce((s, p) => s + p.equity, 0);
  const totalValue = properties.reduce((s, p) => s + p.value, 0);
  const totalCRD = properties.reduce((s, p) => s + p.crd, 0);
  const totalCF = properties.reduce((s, p) => s + p.cf, 0);
  const totalWealthCreation = properties.reduce((s, p) => s + p.wealthCreation, 0);
  const avgLTV = totalValue > 0 ? (totalCRD / totalValue * 100) : 0;

  return {
    properties,
    totalEquity, totalValue, totalCRD,
    totalCF, totalWealthCreation,
    avgLTV,
  };
}

/**
 * Compute creances view data
 */
function computeCreancesView(portfolio, fx) {
  const allItems = [];

  // Amine creances
  (portfolio.amine.creances.items || []).forEach(c => {
    const amountEUR = toEUR(c.amount, c.currency, fx);
    const expectedValue = amountEUR * (c.probability || 1);
    // Inflation impacts all créances EXCEPT SAP & Tax (short payment term, not controllable)
    const monthlyInflationCost = !c.delayDays ? (amountEUR * INFLATION_RATE / 12) : 0;
    allItems.push({
      ...c,
      amountEUR,
      expectedValue,
      monthlyInflationCost,
      owner: 'Amine',
    });
  });

  // Nezha creances
  (portfolio.nezha.creances ? portfolio.nezha.creances.items : []).forEach(c => {
    const amountEUR = toEUR(c.amount, c.currency, fx);
    const expectedValue = amountEUR * (c.probability || 1);
    const monthlyInflationCost = !c.delayDays ? (amountEUR * INFLATION_RATE / 12) : 0;
    allItems.push({
      ...c,
      amountEUR,
      expectedValue,
      monthlyInflationCost,
      owner: 'Nezha',
    });
  });

  const totalNominal = allItems.reduce((s, i) => s + i.amountEUR, 0);
  const totalExpected = allItems.reduce((s, i) => s + i.expectedValue, 0);
  const totalGuaranteed = allItems.filter(i => i.guaranteed).reduce((s, i) => s + i.amountEUR, 0);
  const totalUncertain = allItems.filter(i => !i.guaranteed).reduce((s, i) => s + i.amountEUR, 0);
  const monthlyInflationCost = allItems.reduce((s, i) => s + i.monthlyInflationCost, 0);

  return {
    items: allItems,
    totalNominal,
    totalExpected,
    totalGuaranteed,
    totalUncertain,
    monthlyInflationCost,
  };
}

/**
 * Master compute function — returns complete STATE
 */
export function compute(portfolio, fx, stockSource = 'statique') {
  const p = portfolio;
  const m = p.market;

  // ---- AMINE ----
  const amineUaeAED = p.amine.uae.mashreq + p.amine.uae.wioSavings + p.amine.uae.wioCurrent;
  const amineUae = toEUR(amineUaeAED, 'AED', fx) + p.amine.uae.revolutEUR;
  const amineMoroccoMAD = p.amine.maroc.attijari + p.amine.maroc.nabd;
  const amineMoroccoCash = toEUR(amineMoroccoMAD, 'MAD', fx);
  const amineSgtm = toEUR(p.amine.sgtm.shares * m.sgtmPriceMAD, 'MAD', fx);
  const amineIbkr = computeIBKR(p, fx, stockSource);
  const amineEspp = toEUR(p.amine.espp.shares * m.acnPriceUSD, 'USD', fx) + p.amine.espp.cashEUR;
  const amineVitryEquity = p.amine.immo.vitry.value - p.amine.immo.vitry.crd;
  const amineVehicles = p.amine.vehicles.cayenne + p.amine.vehicles.mercedes;

  // Creances — backwards compatible aggregation
  let amineRecvPro = 0, amineRecvPersonal = 0;
  if (p.amine.creances.items) {
    p.amine.creances.items.forEach(c => {
      const val = toEUR(c.amount, c.currency, fx);
      if (c.guaranteed) amineRecvPro += val;
      else amineRecvPersonal += val;
    });
  }

  const amineTva = p.amine.tva;
  const amineTotalAssets = amineIbkr + amineEspp + amineUae + amineMoroccoCash + amineSgtm
    + amineVitryEquity + amineVehicles + amineRecvPro + amineRecvPersonal;
  const amineNW = amineTotalAssets + amineTva;

  const amine = {
    nw: amineNW,
    ibkr: amineIbkr,
    espp: amineEspp,
    sgtm: amineSgtm,
    uae: amineUae,
    uaeAED: amineUaeAED,
    moroccoCash: amineMoroccoCash,
    moroccoMAD: amineMoroccoMAD,
    morocco: amineMoroccoCash + amineSgtm,
    vitryValue: p.amine.immo.vitry.value,
    vitryCRD: p.amine.immo.vitry.crd,
    vitryEquity: amineVitryEquity,
    vehicles: amineVehicles,
    recvPro: amineRecvPro,
    recvPersonal: amineRecvPersonal,
    tva: amineTva,
    totalAssets: amineTotalAssets,
  };

  // ---- NEZHA ----
  const nezhaRueilEquity = p.nezha.immo.rueil.value - p.nezha.immo.rueil.crd;
  const nezhaVillejuifEquity = p.nezha.immo.villejuif.value - p.nezha.immo.villejuif.crd;
  const nezhaCashMaroc = toEUR(p.nezha.cashMaroc, 'MAD', fx);
  const nezhaSgtm = toEUR(p.nezha.sgtm.shares * m.sgtmPriceMAD, 'MAD', fx);
  const nezhaRecvOmar = p.nezha.creances && p.nezha.creances.items
    ? toEUR(p.nezha.creances.items[0].amount, p.nezha.creances.items[0].currency, fx)
    : 0;
  const nezhaCash = p.nezha.cashFrance + nezhaCashMaroc;
  const nezhaNW = nezhaRueilEquity + nezhaCash + nezhaSgtm + nezhaRecvOmar;

  const nezha = {
    nw: nezhaNW,
    nwWithVillejuif: nezhaNW + nezhaVillejuifEquity,
    rueilValue: p.nezha.immo.rueil.value,
    rueilCRD: p.nezha.immo.rueil.crd,
    rueilEquity: nezhaRueilEquity,
    villejuifValue: p.nezha.immo.villejuif.value,
    villejuifCRD: p.nezha.immo.villejuif.crd,
    villejuifEquity: nezhaVillejuifEquity,
    cashFrance: p.nezha.cashFrance,
    cashMaroc: nezhaCashMaroc,
    cashMarocMAD: p.nezha.cashMaroc,
    sgtm: nezhaSgtm,
    recvOmar: nezhaRecvOmar,
    recvOmarMAD: p.nezha.creances && p.nezha.creances.items ? p.nezha.creances.items[0].amount : 40000,
    cash: nezhaCash,
  };

  // ---- COUPLE ----
  const coupleImmoEquity = amineVitryEquity + nezhaRueilEquity + nezhaVillejuifEquity;
  const coupleImmoValue = amine.vitryValue + nezha.rueilValue + nezha.villejuifValue;
  const coupleImmoCRD = amine.vitryCRD + nezha.rueilCRD + nezha.villejuifCRD;
  const coupleNW = amineNW + nezhaNW + nezhaVillejuifEquity;

  const couple = {
    nw: coupleNW,
    immoEquity: coupleImmoEquity,
    immoValue: coupleImmoValue,
    immoCRD: coupleImmoCRD,
  };

  // ---- POOLS (for simulators) ----
  const actionsPool = amineIbkr + amineEspp + amineSgtm;
  const cashPool = amineUae + amineMoroccoCash;
  const totalLiquid = actionsPool + cashPool;
  const pctActions = totalLiquid > 0 ? Math.round(actionsPool / totalLiquid * 100) : 0;

  // ---- COUPLE CATEGORIES (for drill-down donut) ----
  const coupleCategories = [
    {
      label: 'Immobilier', color: '#b7791f',
      total: coupleImmoEquity,
      sub: [
        { label: 'Vitry (Amine)', val: amineVitryEquity, color: '#b7791f' },
        { label: 'Rueil (Nezha)', val: nezhaRueilEquity, color: '#e6a817' },
        { label: 'Villejuif VEFA (Nezha)', val: nezhaVillejuifEquity, color: '#805a10' },
      ]
    },
    {
      label: 'Actions & ETFs', color: '#2b6cb0',
      total: amineIbkr + amineEspp + amineSgtm + nezhaSgtm,
      sub: [
        { label: 'IBKR Portfolio', val: amineIbkr, color: '#2b6cb0' },
        { label: 'ESPP Accenture', val: amineEspp, color: '#63b3ed' },
        { label: 'SGTM Amine (32 actions)', val: amineSgtm, color: '#ed8936' },
        { label: 'SGTM Nezha (32 actions)', val: nezhaSgtm, color: '#d69e2e' },
      ]
    },
    {
      label: 'Cash', color: '#48bb78',
      total: p.nezha.cashFrance + nezhaCashMaroc + amineUae + amineMoroccoCash,
      sub: [
        { label: 'Amine \u2014 UAE (AED)', val: amineUae, color: '#38a169' },
        { label: 'Nezha \u2014 France (EUR)', val: p.nezha.cashFrance, color: '#e53e3e' },
        { label: 'Amine \u2014 Maroc (MAD)', val: amineMoroccoCash, color: '#d69e2e' },
        { label: 'Nezha \u2014 Maroc (MAD)', val: nezhaCashMaroc, color: '#9f7aea' },
      ]
    },
    {
      label: 'Vehicules', color: '#4a5568',
      total: amineVehicles,
      sub: [
        { label: 'Porsche Cayenne', val: 40000, color: '#4a5568' },
        { label: 'Mercedes A', val: 15000, color: '#a0aec0' },
      ]
    },
    {
      label: 'Creances', color: '#cbd5e0',
      total: amineRecvPro + amineRecvPersonal + nezhaRecvOmar,
      sub: [
        { label: 'SAP & Tax (garanti)', val: amineRecvPro, color: '#38a169' },
        { label: 'Creances perso Amine', val: amineRecvPersonal, color: '#e2e8f0' },
        { label: 'Omar \u2014 Nezha', val: nezhaRecvOmar, color: '#9f7aea' },
      ]
    },
  ];

  // ---- VIEW-SPECIFIC CATEGORY CARDS ----
  const views = {
    couple: {
      title: 'Dashboard Patrimonial',
      subtitle: 'Amine (33 ans) & Nezha (34 ans) Koraibi \u2014 Vue consolidee',
      stocks:    { val: amineIbkr + amineEspp + amineSgtm + nezhaSgtm, sub: 'IBKR + ESPP + SGTM x2' },
      cash:      { val: amineUae + amineMoroccoCash + p.nezha.cashFrance + nezhaCashMaroc, sub: 'UAE + France + Maroc' },
      immo:      { val: coupleImmoEquity, sub: '3 biens \u2014 Equity nette' },
      other:     { val: amineVehicles + amineRecvPro + amineRecvPersonal + amineTva + nezhaRecvOmar, sub: 'Vehicules + Creances - TVA', title: 'Autres Actifs' },
      nwRef: coupleNW,
      showStocks: true, showCash: true, showOther: true,
    },
    amine: {
      title: 'Dashboard \u2014 Amine Koraibi',
      subtitle: 'Amine Koraibi, 33 ans \u2014 Actions, Crypto, Immobilier, Cash',
      stocks:    { val: amineIbkr + amineEspp + amineSgtm, sub: 'IBKR + ESPP + SGTM' },
      cash:      { val: amineUae + amineMoroccoCash, sub: 'UAE + Maroc' },
      immo:      { val: amineVitryEquity, sub: '1 bien \u2014 Vitry' },
      other:     { val: amineVehicles + amineRecvPro + amineRecvPersonal + amineTva, sub: 'Vehicules + Creances - TVA', title: 'Autres Actifs' },
      nwRef: amineNW,
      showStocks: true, showCash: true, showOther: true,
    },
    nezha: {
      title: 'Dashboard \u2014 Nezha Kabbaj',
      subtitle: 'Nezha Kabbaj, 34 ans \u2014 Immobilier',
      stocks:    { val: nezhaSgtm, sub: 'SGTM (32 actions)' },
      cash:      { val: p.nezha.cashFrance + nezhaCashMaroc, sub: '85K France + 9K Maroc' },
      immo:      { val: nezhaRueilEquity + nezhaVillejuifEquity, sub: '2 biens \u2014 Rueil + Villejuif' },
      other:     { val: nezhaRecvOmar, sub: 'Creance Omar (40K MAD)', title: 'Creances' },
      nwRef: nezhaNW + nezhaVillejuifEquity,
      showStocks: true, showCash: true, showOther: true,
    },
  };

  // ---- IBKR Positions sorted by value ----
  const ibkrPositions = computeIBKRPositions(p, fx);

  // ---- NEW ASSET-TYPE VIEWS ----
  const actionsView = computeActionsView(p, fx, stockSource, amineIbkr, ibkrPositions, amineSgtm, nezhaSgtm, amineEspp);
  const cashView = computeCashView(p, fx);
  const immoView = computeImmoView(p, fx);
  const creancesView = computeCreancesView(p, fx);

  return {
    fx,
    stockSource,
    portfolio: p,
    amine,
    nezha,
    couple,
    pools: { actions: actionsPool, cash: cashPool, totalLiquid, pctActions },
    coupleCategories,
    views,
    ibkrPositions,
    actionsView,
    cashView,
    immoView,
    creancesView,
  };
}

/**
 * Compute the grand total from couple categories
 */
export function getGrandTotal(state) {
  return state.coupleCategories.reduce((s, c) => s + c.total, 0);
}
