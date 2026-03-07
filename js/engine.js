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
  const m = portfolio.market;

  // IBKR cash in EUR
  const ibkrCashEUR = ibkr.cashEUR;
  const ibkrCashUSD = ibkr.cashUSD;
  const ibkrCashJPY = ibkr.cashJPY;
  const ibkrCashTotal = ibkrCashEUR + toEUR(ibkrCashUSD, 'USD', fx) + toEUR(ibkrCashJPY, 'JPY', fx);

  // Total positions value (excl cash)
  const totalPositionsVal = ibkrPositions.reduce((s, p) => s + p.valEUR, 0);
  const totalCostBasis = ibkrPositions.reduce((s, p) => s + p.costEUR, 0);
  const totalUnrealizedPL = totalPositionsVal - totalCostBasis;

  // Total all stocks (IBKR positions + cash + ESPP + SGTM)
  const totalStocks = ibkrNAV + amineEspp + amineSgtm + nezhaSgtm;

  // Geo allocation from positions
  const geoAllocation = {};
  ibkrPositions.forEach(p => {
    const geo = p.geo || 'other';
    geoAllocation[geo] = (geoAllocation[geo] || 0) + p.valEUR;
  });
  // Add ESPP to US, SGTM to morocco
  geoAllocation.us = (geoAllocation.us || 0) + amineEspp;
  geoAllocation.morocco = (geoAllocation.morocco || 0) + amineSgtm + nezhaSgtm;

  // Sector allocation from positions
  const sectorAllocation = {};
  ibkrPositions.forEach(p => {
    const sec = p.sector || 'other';
    sectorAllocation[sec] = (sectorAllocation[sec] || 0) + p.valEUR;
  });

  const meta = ibkr.meta || {};

  return {
    ibkrPositions,
    ibkrNAV,
    ibkrCashEUR, ibkrCashUSD, ibkrCashJPY, ibkrCashTotal,
    totalPositionsVal, totalCostBasis, totalUnrealizedPL,
    esppVal: amineEspp,
    esppShares: portfolio.amine.espp.shares,
    esppPrice: m.acnPriceUSD,
    sgtmAmineVal: amineSgtm,
    sgtmNezhaVal: nezhaSgtm,
    sgtmTotal: amineSgtm + nezhaSgtm,
    totalStocks,
    twr: meta.twr || 0,
    realizedPL: meta.realizedPL || 0,
    dividends: meta.dividends || 0,
    commissions: meta.commissions || 0,
    closedPositions: meta.closedPositions || [],
    deposits: meta.deposits || 0,
    geoAllocation,
    sectorAllocation,
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
    { label: 'BMCE/BOA', native: p.amine.maroc.bmce, currency: 'MAD', yield: CASH_YIELDS.bmce, owner: 'Amine' },
    { label: 'IBKR Cash EUR', native: p.amine.ibkr.cashEUR, currency: 'EUR', yield: CASH_YIELDS.ibkrCashEUR, owner: 'Amine' },
    { label: 'IBKR Cash USD', native: p.amine.ibkr.cashUSD, currency: 'USD', yield: CASH_YIELDS.ibkrCashUSD, owner: 'Amine' },
    { label: 'ESPP Cash', native: p.amine.espp.cashEUR, currency: 'EUR', yield: CASH_YIELDS.esppCash, owner: 'Amine' },
    { label: 'Cash France', native: p.nezha.cashFrance, currency: 'EUR', yield: CASH_YIELDS.nezhaCashFrance, owner: 'Nezha' },
    { label: 'Cash Maroc', native: p.nezha.cashMaroc, currency: 'MAD', yield: CASH_YIELDS.nezhaCashMaroc, owner: 'Nezha' },
  ];

  // Note: JPY short is NOT cash, it's a forex liability — exclude from cash view
  // but mention it as a note

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
    const monthlyInflationCost = !c.guaranteed ? (amountEUR * INFLATION_RATE / 12) : 0;
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
    const monthlyInflationCost = !c.guaranteed ? (amountEUR * INFLATION_RATE / 12) : 0;
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
  const amineMoroccoMAD = p.amine.maroc.attijari + p.amine.maroc.bmce;
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
