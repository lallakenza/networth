// ============================================================
// ENGINE — Pure computation. No DOM access, no side effects.
// ============================================================
// compute(portfolio, fx, stockSource) → STATE object

/**
 * Convert a foreign amount to EUR using FX rates
 */
function toEUR(amount, currency, fx) {
  if (currency === 'EUR') return amount;
  return amount / (fx[currency] || 1);
}

/**
 * Compute IBKR NAV from individual positions
 */
function computeIBKR(portfolio, fx, stockSource) {
  if (stockSource !== 'live') return portfolio.amine.ibkr.staticNAV;
  let total = portfolio.amine.ibkr.cashEUR;
  portfolio.amine.ibkr.positions.forEach(pos => {
    total += toEUR(pos.shares * pos.price, pos.currency, fx);
  });
  return total;
}

/**
 * Compute individual IBKR position values (for table display)
 */
function computeIBKRPositions(portfolio, fx) {
  return portfolio.amine.ibkr.positions.map(pos => {
    const valEUR = toEUR(pos.shares * pos.price, pos.currency, fx);
    let priceLabel = '';
    if (pos.currency === 'EUR') priceLabel = pos.price.toFixed(2) + ' EUR';
    else if (pos.currency === 'USD') priceLabel = '$' + pos.price.toFixed(2);
    else if (pos.currency === 'JPY') priceLabel = '\u00a5' + Math.round(pos.price);
    return { ...pos, valEUR, priceLabel };
  }).sort((a, b) => b.valEUR - a.valEUR);
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
  const amineRecvPro = p.amine.creances.sapTax;
  const amineRecvPersonal = toEUR(p.amine.creances.persoMAD, 'MAD', fx) + p.amine.creances.persoEUR;
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
  const nezhaRecvOmar = toEUR(p.nezha.recvOmar, 'MAD', fx);
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
    recvOmarMAD: p.nezha.recvOmar,
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
  };
}

/**
 * Compute the grand total from couple categories
 */
export function getGrandTotal(state) {
  return state.coupleCategories.reduce((s, c) => s + c.total, 0);
}
