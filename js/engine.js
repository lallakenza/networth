// ============================================================
// ENGINE — Pure computation. No DOM access, no side effects.
// ============================================================
// compute(portfolio, fx, stockSource) → STATE object

import { CASH_YIELDS, INFLATION_RATE, IMMO_CONSTANTS, NW_HISTORY, WHT_RATES, DIV_YIELDS, DIV_CALENDAR, IBKR_CONFIG } from './data.js?v=20';

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
    sgtmAmineShares: portfolio.amine.sgtm.shares,
    sgtmNezhaShares: portfolio.nezha.sgtm.shares,
    sgtmPriceMAD: m.sgtmPriceMAD,
    sgtmCostBasisEUR: m.sgtmCostBasisMAD
      ? toEUR((portfolio.amine.sgtm.shares + portfolio.nezha.sgtm.shares) * m.sgtmCostBasisMAD, 'MAD', fx)
      : null,
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
    { label: 'Cash France', native: p.nezha.cashFrance, currency: 'EUR', yield: CASH_YIELDS.nezhaCashFrance, owner: 'Nezha' },
    { label: 'Cash Maroc', native: p.nezha.cashMaroc, currency: 'MAD', yield: CASH_YIELDS.nezhaCashMaroc, owner: 'Nezha' },
  ];

  let totalCash = 0, totalYielding = 0, totalNonYielding = 0;
  let weightedYieldSum = 0;
  const byCurrency = {};

  accounts.forEach(a => {
    a.valEUR = toEUR(a.native, a.currency, fx);
    if (a.isDebt) return; // exclude debt (JPY short) from cash totals
    totalCash += a.valEUR;
    const PRODUCTIVE_THRESHOLD = 0.03; // ≥3% = productif, <3% = dormant
    if (a.yield >= PRODUCTIVE_THRESHOLD) {
      totalYielding += a.valEUR;
    } else {
      totalNonYielding += a.valEUR;
    }
    weightedYieldSum += a.valEUR * (a.yield || 0);
    byCurrency[a.currency] = (byCurrency[a.currency] || 0) + a.valEUR;
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
  // 2. PRIORITÉ #1 — Cash Nezha (85K€ + 9K€ à 0%)
  //    Plus gros gisement de gains. Impact : ~5 600€/an
  // ═══════════════════════════════════════════════════════
  const nezhaCashFR = accounts.find(a => a.label === 'Cash France');
  const nezhaCashMA = accounts.find(a => a.label === 'Cash Maroc');
  if (nezhaCashFR && nezhaCashFR.valEUR > 0) {
    const nezhaTotalDormant = nezhaCashFR.valEUR + (nezhaCashMA ? nezhaCashMA.valEUR : 0);
    const nezhaGainPotentiel = nezhaTotalDormant * REF_YIELD;
    diagnostics.push({
      severity: 'urgent',
      category: 'nezha_cash',
      amountEUR: nezhaTotalDormant,
      cashFranceEUR: nezhaCashFR.valEUR,
      cashMarocEUR: nezhaCashMA ? nezhaCashMA.valEUR : 0,
      gainPotentiel: nezhaGainPotentiel,
      actions: [
        'Option A : Ouvrir un compte AED (Wio/Mashreq) au nom de Nezha → 6%/an soit +' + Math.round(nezhaGainPotentiel) + '€/an',
        'Option B : Assurance-vie fonds euros en France → ~2.5-3%/an',
        'Option C : Livret A (22 950€ max) + LDDS (12 000€ max) → ~3%/an défiscalisé',
        'Option D : OPCVM monétaire Maroc pour le cash MAD → ~3-4%/an',
      ],
    });
  }

  // ═══════════════════════════════════════════════════════
  // 3. PRIORITÉ #2 — IBKR EUR (66K€ à 1.3% effectif)
  //    Rendement faible à cause du seuil 10K€ à 0%
  //    Impact : ~3 100€/an de manque à gagner
  // ═══════════════════════════════════════════════════════
  const ibkrEUR = accounts.find(a => a.label === 'IBKR Cash EUR');
  if (ibkrEUR && ibkrEUR.valEUR > 20000) {
    const ibkrMissed = ibkrEUR.valEUR * (REF_YIELD - ibkrEUR.yield);
    // Montant optimal à garder chez IBKR (marge + opportunité d'investissement)
    const optimalIBKR = IBKR_CONFIG.optimalCashEUR; // solde optimal (data.js)
    const excessIBKR = ibkrEUR.valEUR - optimalIBKR;
    const gainTransfert = excessIBKR * REF_YIELD;
    diagnostics.push({
      severity: 'urgent',
      category: 'ibkr_eur',
      amountEUR: ibkrEUR.valEUR,
      effectiveYield: ibkrEUR.yield,
      missedAnn: ibkrMissed,
      excessEUR: excessIBKR,
      gainTransfert: gainTransfert,
      actions: [
        'Transférer ~' + Math.round(excessIBKR/1000) + 'K€ excédentaire vers Mashreq/Wio (6%) → +' + Math.round(gainTransfert) + '€/an',
        'Garder ~20K€ chez IBKR comme marge de sécurité + opportunité d\'investissement',
        'Alternative : investir l\'excédent en ETF obligataire court terme (2-4%)',
      ],
    });
  }

  // ═══════════════════════════════════════════════════════
  // 4. PRIORITÉ #3 — Cash Maroc Amine (17.5K€ à 0%)
  //    Impact : ~1 050€/an de manque à gagner
  // ═══════════════════════════════════════════════════════
  const attijari = accounts.find(a => a.label === 'Attijariwafa');
  const nabd = accounts.find(a => a.label.includes('Nabd'));
  if (attijari && attijari.valEUR > 5000) {
    const marocTotal = attijari.valEUR + (nabd ? nabd.valEUR : 0);
    diagnostics.push({
      severity: 'warning',
      category: 'maroc_cash',
      amountEUR: marocTotal,
      attijariMAD: attijari.native,
      nabdMAD: nabd ? nabd.native : 0,
      gainPotentiel: marocTotal * 0.04, // 4% réaliste au Maroc
      actions: [
        'DAT 6 mois chez Attijariwafa → ~3.5-4%/an sur ' + Math.round(attijari.native/1000) + 'K MAD',
        'OPCVM monétaire (ex: CDG Capital Money Market) → ~3-3.5%/an, liquidité J+1',
        'Garder un minimum opérationnel (~30K MAD) et placer le reste',
      ],
    });
  }

  // ═══════════════════════════════════════════════════════
  // 5. LEVIER JPY — Coût et risque de l'emprunt
  //    Coût annuel : ~2 600€ + risque de change
  // ═══════════════════════════════════════════════════════
  if (jpyAccount && Math.abs(jpyAccount.valEUR) > 5000) {
    const riskYen10pct = Math.abs(jpyAccount.valEUR) * 0.10;
    diagnostics.push({
      severity: 'warning',
      category: 'jpy_leverage',
      amountEUR: Math.abs(jpyAccount.valEUR),
      costAnn: jpyCostAnn,
      riskYen10pct: riskYen10pct,
      jpyNative: Math.abs(portfolio.amine.ibkr.cashJPY),
      blendedRate: Math.abs(jpyAccount.yield),
      actions: [
        'Coût réel : ~' + Math.round(jpyCostAnn) + '€/an d\'intérêts (taux blended ' + (Math.abs(jpyAccount.yield)*100).toFixed(1) + '%)',
        'Risque : si le yen monte de 10%, perte supplémentaire de ~' + Math.round(riskYen10pct) + '€',
        'Le short JPY est rentable SI Shiseido + gains de change > coût d\'emprunt',
        'Définir un stop-loss JPY/EUR pour limiter les pertes en cas de retournement',
      ],
    });
  }

  // ═══════════════════════════════════════════════════════
  // 6. IBKR USD — Rendement effectif faible (1.0%)
  //    Impact modéré : ~660€/an
  // ═══════════════════════════════════════════════════════
  const ibkrUSD = accounts.find(a => a.label === 'IBKR Cash USD');
  if (ibkrUSD && ibkrUSD.valEUR > 5000) {
    const usdMissed = ibkrUSD.valEUR * (REF_YIELD - ibkrUSD.yield);
    diagnostics.push({
      severity: 'info',
      category: 'ibkr_usd',
      amountEUR: ibkrUSD.valEUR,
      effectiveYield: ibkrUSD.yield,
      missedAnn: usdMissed,
      actions: [
        'Premiers 10K$ à 0% → rendement effectif seulement ' + (ibkrUSD.yield*100).toFixed(1) + '%',
        'Investir en ETF monétaire USD (ex: BIL, SGOV) → 4-5%/an sans sortir d\'IBKR',
        'Ou convertir en EUR et transférer vers compte rémunéré AED',
      ],
    });
  }

  // ═══════════════════════════════════════════════════════
  // 7. PETITS COMPTES — Revolut + ESPP + Wio Current
  //    Impact faible individuellement, mais à regrouper
  // ═══════════════════════════════════════════════════════
  // Exclure les comptes déjà couverts par les diagnostics ci-dessus
  const alreadyCovered = ['Cash France', 'Cash Maroc', 'Attijariwafa', 'Nabd (ex-SOGE)', 'IBKR Cash EUR', 'IBKR Cash USD'];
  const smallAccounts = accounts.filter(a =>
    !a.isDebt && (a.yield || 0) < 0.03 && a.valEUR > 0 && a.valEUR < 10000
    && !alreadyCovered.includes(a.label)
  );
  if (smallAccounts.length > 0) {
    const smallTotal = smallAccounts.reduce((s, a) => s + a.valEUR, 0);
    const smallLabels = smallAccounts.map(a => a.label + ' (' + Math.round(a.valEUR) + '€)').join(', ');
    diagnostics.push({
      severity: 'info',
      category: 'small_accounts',
      amountEUR: smallTotal,
      count: smallAccounts.length,
      labels: smallLabels,
      actions: [
        'Regrouper ou investir : ' + smallLabels,
        'Total : ' + Math.round(smallTotal) + '€ à 0% → manque à gagner ~' + Math.round(smallTotal * REF_YIELD) + '€/an',
        'Revolut : activer le coffre flexible (~2.5%) ou transférer vers Wio',
        'ESPP Cash : réinvestir en actions Accenture ou transférer',
      ],
    });
  }

  // ═══════════════════════════════════════════════════════
  // 8. STRATÉGIE GLOBALE — Plan d'action séquencé
  // ═══════════════════════════════════════════════════════
  diagnostics.push({
    severity: 'info',
    category: 'action_plan',
    totalMissedAnn: totalMissedAnn,
    steps: [
      '1. Court terme (cette semaine) : Transférer l\'excédent IBKR EUR (~46K€) vers Mashreq/Wio',
      '2. Court terme (ce mois) : Ouvrir un DAT chez Attijariwafa pour le cash MAD',
      '3. Moyen terme : Ouvrir un compte rémunéré pour Nezha (Livret A + fonds euro ou AED)',
      '4. Continu : Surveiller le JPY/EUR et le coût d\'emprunt IBKR',
    ],
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
 * Compute fiscalité for a property
 * Handles: micro-foncier (nu), micro-BIC (LMNP), réel foncier, réel BIC
 * Non-résident UAE : taux minimum 20% + PS 17.2%
 */
function computeFiscalite(loyerAnnuel, charges, fiscConfig, loanInterestAnnuel) {
  const f = fiscConfig;

  // Si une partie est reçue en cash non déclaré, on réduit la base
  const cashPct = f.cashNonDeclare || 0;
  const loyerDeclare = loyerAnnuel * (1 - cashPct);
  const loyerCash = loyerAnnuel * cashPct;

  if (f.regime === 'micro-foncier') {
    // Location NUE — abattement forfaitaire 30%
    const revenuImposable = loyerDeclare * 0.70;
    const ir = revenuImposable * f.tmi;
    const ps = revenuImposable * f.ps;
    const totalImpot = ir + ps;
    return {
      regime: 'micro-foncier', type: f.type || 'nu',
      loyerAnnuel, loyerDeclare: Math.round(loyerDeclare), loyerCash: Math.round(loyerCash),
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
      loyerAnnuel, loyerDeclare: Math.round(loyerDeclare), loyerCash: 0,
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
      loyerAnnuel, loyerDeclare: Math.round(loyerDeclare), loyerCash: 0,
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
    loyerAnnuel, loyerDeclare: Math.round(loyerDeclare), loyerCash: Math.round(loyerCash),
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
 * Compute immo view data
 */
function computeImmoView(portfolio, fx) {
  const IC = IMMO_CONSTANTS;
  const properties = [];
  const loanKeys = ['vitry', 'rueil', 'villejuif'];

  // Compute amortization schedules
  const amortSchedules = {};
  for (const key of loanKeys) {
    if (IC.loans && IC.loans[key]) {
      amortSchedules[key] = computeAmortizationSchedule(IC.loans[key]);
    }
  }

  // Helper to build property with fiscal data
  function buildProperty(name, owner, propData, chargesConfig, loanKey, conditional) {
    const charges = chargesConfig.pret + chargesConfig.assurance + chargesConfig.pno + chargesConfig.tf + chargesConfig.copro;
    const loyer = propData.loyer + (propData.parking || 0);
    const cf = loyer - charges;
    const loyerAnnuel = loyer * 12;
    const amort = amortSchedules[loanKey];

    // Fiscal calculation
    const loanInterestAnnuel = amort
      ? amort.schedule.slice(amort.currentIdx, amort.currentIdx + 12).reduce((s, r) => s + r.interest, 0)
      : 0;
    // Charges déductibles : PNO + TF + copro + assurance emprunteur (pour régime réel)
    const deductibleCharges = chargesConfig.pno + chargesConfig.tf + chargesConfig.copro + chargesConfig.assurance;
    const fisc = IC.fiscalite && IC.fiscalite[loanKey]
      ? computeFiscalite(loyerAnnuel, deductibleCharges, IC.fiscalite[loanKey], loanInterestAnnuel)
      : null;

    const cfNetFiscal = fisc ? cf - fisc.monthlyImpot : cf;

    return {
      name, owner, conditional: conditional || false,
      value: propData.value, crd: propData.crd, equity: propData.value - propData.crd,
      ltv: (propData.crd / propData.value * 100),
      monthlyPayment: chargesConfig.pret + chargesConfig.assurance,
      loyer, cf,
      yieldGross: (loyer * 12 / propData.value * 100),
      yieldNet: (cf * 12 / propData.value * 100),
      yieldNetFiscal: fisc ? (cfNetFiscal * 12 / propData.value * 100) : null,
      wealthCreation: IC.growth[loanKey],
      endYear: IC.prets[loanKey + 'End'],
      charges,
      loanKey,
      fiscalite: fisc,
      cfNetFiscal,
    };
  }

  properties.push(buildProperty('Vitry-sur-Seine', 'Amine', portfolio.amine.immo.vitry, IC.charges.vitry, 'vitry'));
  properties.push(buildProperty('Rueil-Malmaison', 'Nezha', portfolio.nezha.immo.rueil, IC.charges.rueil, 'rueil'));
  properties.push(buildProperty('Villejuif (VEFA)', 'Nezha', portfolio.nezha.immo.villejuif, IC.charges.villejuif, 'villejuif', true));

  const totalEquity = properties.reduce((s, p) => s + p.equity, 0);
  const totalValue = properties.reduce((s, p) => s + p.value, 0);
  const totalCRD = properties.reduce((s, p) => s + p.crd, 0);
  const totalCF = properties.reduce((s, p) => s + p.cf, 0);
  const totalWealthCreation = properties.reduce((s, p) => s + p.wealthCreation, 0);
  const avgLTV = totalValue > 0 ? (totalCRD / totalValue * 100) : 0;

  // Fiscal totals
  const totalImpotAnnuel = properties.reduce((s, p) => s + (p.fiscalite ? p.fiscalite.totalImpot : 0), 0);
  const totalLoyerAnnuel = properties.reduce((s, p) => s + p.loyer * 12, 0);
  const totalCFNetFiscal = properties.reduce((s, p) => s + (p.cfNetFiscal || p.cf), 0);

  // Amortization totals
  const totalInterestPaid = Object.values(amortSchedules).reduce((s, a) => s + a.interestPaid, 0);
  const totalInterestRemaining = Object.values(amortSchedules).reduce((s, a) => s + a.interestRemaining, 0);

  return {
    properties,
    totalEquity, totalValue, totalCRD,
    totalCF, totalWealthCreation,
    avgLTV,
    amortSchedules,
    totalInterestPaid,
    totalInterestRemaining,
    totalImpotAnnuel,
    totalLoyerAnnuel,
    totalCFNetFiscal,
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

/**
 * Compute NW history with live current values
 */
function computeNWHistory(coupleNW, amineNW, nezhaNW) {
  const history = NW_HISTORY.map(h => {
    if (h.coupleNW === null) {
      return { ...h, coupleNW: coupleNW, amineNW: amineNW, nezhaNW: nezhaNW };
    }
    return { ...h };
  });
  return history;
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
        { label: 'Vitry', val: amineVitryEquity, color: '#b7791f', owner: 'Amine' },
        { label: 'Rueil', val: nezhaRueilEquity, color: '#e6a817', owner: 'Nezha' },
        { label: 'Villejuif VEFA', val: nezhaVillejuifEquity, color: '#805a10', owner: 'Nezha' },
      ]
    },
    {
      label: 'Actions', color: '#2b6cb0',
      total: (() => {
        const nonCrypto = p.amine.ibkr.positions.filter(pos => pos.sector !== 'crypto');
        const ibkrNonCryptoVal = nonCrypto.reduce((s, pos) => s + toEUR(pos.shares * pos.price, pos.currency, fx), 0);
        const ibkrCash = toEUR(p.amine.ibkr.cashEUR, 'EUR', fx) + toEUR(p.amine.ibkr.cashUSD, 'USD', fx) + toEUR(p.amine.ibkr.cashJPY, 'JPY', fx);
        return ibkrNonCryptoVal + ibkrCash + amineEspp + amineSgtm + nezhaSgtm;
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
        { label: 'ESPP Accenture', val: amineEspp, color: '#6366f1', owner: 'Amine — ESPP' },
        { label: 'SGTM Amine', val: amineSgtm, color: '#4f46e5', owner: 'Amine — Maroc' },
        { label: 'SGTM Nezha', val: nezhaSgtm, color: '#818cf8', owner: 'Nezha — Maroc' },
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
      label: 'Cash', color: '#48bb78',
      total: p.nezha.cashFrance + nezhaCashMaroc + amineUae + amineMoroccoCash,
      sub: [
        { label: 'Cash UAE', val: amineUae, color: '#22c55e', owner: 'Amine' },
        { label: 'Cash France', val: p.nezha.cashFrance, color: '#16a34a', owner: 'Nezha' },
        { label: 'Cash Maroc', val: amineMoroccoCash, color: '#15803d', owner: 'Amine' },
        { label: 'Cash Maroc', val: nezhaCashMaroc, color: '#166534', owner: 'Nezha' },
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
      total: amineRecvPro + amineRecvPersonal + nezhaRecvOmar,
      sub: [
        { label: 'SAP & Tax', val: amineRecvPro, color: '#ec4899', owner: 'Amine — garanti' },
        { label: 'Creances perso', val: amineRecvPersonal, color: '#db2777', owner: 'Amine' },
        { label: 'Creance Omar', val: nezhaRecvOmar, color: '#be185d', owner: 'Nezha' },
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
      label: 'Cash', color: '#48bb78',
      total: amineUae + amineMoroccoCash,
      sub: [
        { label: 'Cash UAE', val: amineUae, color: '#22c55e', owner: 'AED' },
        { label: 'Cash Maroc', val: amineMoroccoCash, color: '#15803d', owner: 'MAD' },
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
        { label: 'SAP & Tax', val: amineRecvPro, color: '#ec4899', owner: 'Garanti' },
        { label: 'Creances perso', val: amineRecvPersonal, color: '#db2777', owner: '' },
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
        { label: 'Villejuif VEFA', val: nezhaVillejuifEquity, color: '#805a10', owner: 'Conditionnel' },
      ]
    },
    {
      label: 'Cash', color: '#48bb78',
      total: p.nezha.cashFrance + nezhaCashMaroc,
      sub: [
        { label: 'Cash France', val: p.nezha.cashFrance, color: '#16a34a', owner: 'EUR' },
        { label: 'Cash Maroc', val: nezhaCashMaroc, color: '#166534', owner: 'MAD' },
      ]
    },
    {
      label: 'Actions', color: '#2b6cb0',
      total: nezhaSgtm,
      sub: [{ label: 'SGTM', val: nezhaSgtm, color: '#818cf8', owner: 'Maroc' }]
    },
    {
      label: 'Creances', color: '#ec4899',
      total: nezhaRecvOmar,
      sub: [{ label: 'Creance Omar', val: nezhaRecvOmar, color: '#be185d', owner: '40K MAD' }]
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
  // Add ESPP to US
  if (!geoGroups['us']) geoGroups['us'] = [];
  geoGroups['us'].push({ label: 'ESPP Accenture', val: amineEspp, color: '#10b981', owner: 'ESPP' });
  // Add SGTM to Morocco
  if (!geoGroups['morocco']) geoGroups['morocco'] = [];
  geoGroups['morocco'].push({ label: 'SGTM Amine', val: amineSgtm, color: '#ca8a04', owner: 'Maroc' });
  geoGroups['morocco'].push({ label: 'SGTM Nezha', val: nezhaSgtm, color: '#eab308', owner: 'Maroc' });
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
  const actionsView = computeActionsView(p, fx, stockSource, amineIbkr, ibkrPositions, amineSgtm, nezhaSgtm, amineEspp);
  const cashView = computeCashView(p, fx);
  const immoView = computeImmoView(p, fx);
  const creancesView = computeCreancesView(p, fx);

  // ---- DIVIDEND / WHT ANALYSIS ----
  const dividendAnalysis = computeDividendAnalysis(ibkrPositions, fx);

  // ---- NW HISTORY (live current point) ----
  const nwHistory = computeNWHistory(coupleNW, amineNW, nezhaNW + nezhaVillejuifEquity);

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
    dividendAnalysis,
    nwHistory,
  };
}

/**
 * Compute the grand total from couple categories
 */
export function getGrandTotal(state) {
  return state.coupleCategories.reduce((s, c) => s + c.total, 0);
}
