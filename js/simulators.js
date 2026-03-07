// ============================================================
// SIMULATORS — 3 projection simulators (couple, amine, nezha)
// ============================================================

import { fmt, fmtAxis } from './render.js?v=13';
import { IMMO_CONSTANTS } from './data.js?v=13';

const IC = IMMO_CONSTANTS;
let simCharts = {};

// ============ GENERIC SIMULATOR ENGINE ============
function runSimulatorGeneric(config) {
  const {
    prefix, monthlySavings, pctActions, returnActions, returnCash,
    horizonYears, stopYears,
    startNW, startImmoEquity, startPoolActions, startPoolCash,
    staticAssets, immoGrowthFn, existingGains,
  } = config;

  const months = horizonYears * 12;
  const stopMonth = stopYears > 0 ? Math.round(stopYears * 12) : Infinity;
  const eg = existingGains || 0;
  const startLiquidBase = startPoolActions + startPoolCash + staticAssets - eg;

  // Update display values
  const setV = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setV(prefix + 'SavingsVal', fmt(monthlySavings));
  setV(prefix + 'PctActionsVal', Math.round(pctActions * 100) + '%');
  setV(prefix + 'ReturnActionsVal', (returnActions * 100).toFixed(1) + '%');
  setV(prefix + 'HorizonVal', horizonYears + ' ans');

  // Stop year display
  const stopBanner = document.getElementById(prefix + 'StopBanner');
  const stopYearValEl = document.getElementById(prefix + 'StopYearVal');
  if (stopYears > 0) {
    const stopDate = new Date(2026, 2 + Math.round(stopYears * 12), 1);
    const stopLabel = stopDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    if (stopYearValEl) { stopYearValEl.textContent = stopLabel; stopYearValEl.style.color = 'var(--red)'; }
    if (stopBanner) {
      stopBanner.style.display = 'block';
      document.getElementById(prefix + 'StopBannerText').textContent =
        'Contributions de ' + fmt(monthlySavings) + '/mois pendant ' + stopYears + ' an' + (stopYears > 1 ? 's' : '') + ' (jusqu\'a ' + stopLabel + '), puis le portefeuille travaille seul.';
    }
  } else {
    if (stopYearValEl) { stopYearValEl.textContent = 'Jamais'; stopYearValEl.style.color = ''; }
    if (stopBanner) stopBanner.style.display = 'none';
  }

  let poolActions = startPoolActions;
  let poolCash = startPoolCash;
  let poolActionsNS = startPoolActions;
  let poolCashNS = startPoolCash;

  const monthlyReturnActions = returnActions / 12;
  const monthlyReturnCash = returnCash / 12;

  let cumContributions = 0;
  let cumImmoReturns = 0;

  const dataLabels = [], dataNW = [], dataImmo = [], dataBase = [], dataGains = [], dataNWNoStop = [];
  let month1M = -1;
  let stopChartIdx = -1;

  for (let m = 0; m <= months; m++) {
    const immoNow = startImmoEquity + cumImmoReturns;
    const liquidNow = poolActions + poolCash + staticAssets;
    const totalNW = immoNow + liquidNow;
    const liquidNS = poolActionsNS + poolCashNS + staticAssets;
    const totalNWns = immoNow + liquidNS;
    const isContributing = m < stopMonth;
    const gainsNow = liquidNow - startLiquidBase - cumContributions;

    if (m % (months <= 60 ? 1 : 3) === 0 || m === months) {
      const date = new Date(2026, 2 + m, 1);
      dataLabels.push(date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }));
      dataNW.push(Math.round(totalNW));
      dataImmo.push(Math.round(immoNow));
      dataBase.push(Math.round(immoNow + startLiquidBase + cumContributions));
      dataGains.push(Math.round(immoNow + startLiquidBase + cumContributions + gainsNow));
      dataNWNoStop.push(Math.round(totalNWns));
      if (stopYears > 0 && stopChartIdx === -1 && m >= stopMonth) stopChartIdx = dataLabels.length - 1;
    }

    if (totalNW >= 1000000 && month1M === -1) month1M = m;

    const immoGrowth = immoGrowthFn(m);
    cumImmoReturns += immoGrowth;

    poolActions *= (1 + monthlyReturnActions);
    poolCash *= (1 + monthlyReturnCash);
    poolActionsNS *= (1 + monthlyReturnActions);
    poolCashNS *= (1 + monthlyReturnCash);

    if (isContributing) {
      poolActions += monthlySavings * pctActions;
      poolCash += monthlySavings * (1 - pctActions);
      cumContributions += monthlySavings;
    }
    poolActionsNS += monthlySavings * pctActions;
    poolCashNS += monthlySavings * (1 - pctActions);
  }

  const finalNW = dataNW[dataNW.length - 1];
  const finalNWns = dataNWNoStop[dataNWNoStop.length - 1];
  const totalGrowth = finalNW - startNW;
  const finalGains = dataGains[dataGains.length - 1] - dataBase[dataBase.length - 1];
  const finalImmoGrowth = cumImmoReturns;

  setV(prefix + 'NW', fmt(finalNW, true));
  setV(prefix + 'Contrib', '+' + fmt(Math.round(cumContributions), true));
  setV(prefix + 'Market', '+' + fmt(Math.round(finalGains), true));
  setV(prefix + 'Immo', '+' + fmt(Math.round(finalImmoGrowth), true));

  const m1MEl = document.getElementById(prefix + '1M');
  if (m1MEl) {
    if (month1M >= 0) {
      const d1m = new Date(2026, 2 + month1M, 1);
      m1MEl.textContent = d1m.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
      m1MEl.style.color = 'var(--green)';
    } else {
      m1MEl.textContent = '> ' + horizonYears + ' ans';
      m1MEl.style.color = 'var(--red)';
    }
  }

  // Insight
  const pctContrib = totalGrowth > 0 ? Math.round(cumContributions / totalGrowth * 100) : 0;
  const pctMarket = totalGrowth > 0 ? Math.round(finalGains / totalGrowth * 100) : 0;
  const pctImmo = totalGrowth > 0 ? Math.round(finalImmoGrowth / totalGrowth * 100) : 0;
  const finalImmoTotal = startImmoEquity + cumImmoReturns;
  const pctImmoFinalNW = (finalImmoTotal / finalNW * 100).toFixed(1);

  let insightHtml;
  if (stopYears > 0) {
    const stopDate = new Date(2026, 2 + Math.round(stopYears * 12), 1);
    const stopLabel = stopDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const costOfStopping = finalNWns - finalNW;
    insightHtml =
      '<strong>Scenario arret :</strong> Contributions pendant <strong>' + stopYears + ' an' + (stopYears > 1 ? 's' : '') + '</strong> (jusqu\'a ' + stopLabel + ').<br>' +
      'NW : <strong>' + fmt(startNW) + '</strong> &rarr; <strong>' + fmt(finalNW) + '</strong> (+' + fmt(Math.round(totalGrowth)) + '). ' +
      'Croissance : contributions ' + pctContrib + '% | gains marche ' + pctMarket + '% | immo ' + pctImmo + '%.<br>' +
      'Part immo dans le NW final : <strong>' + pctImmoFinalNW + '%</strong> (' + fmt(Math.round(finalImmoTotal)) + ').<br>' +
      '<span style="color:var(--red)">Cout de l\'arret : ' + fmt(Math.round(costOfStopping)) + '</span>. ' +
      (month1M >= 0 ? '<strong>1M atteint en ' + (month1M/12).toFixed(1) + ' ans.</strong>' : '<span style="color:var(--red)">1M non atteint.</span>');
  } else {
    insightHtml =
      '<strong>Resume :</strong> NW : <strong>' + fmt(startNW) + '</strong> &rarr; <strong>' + fmt(finalNW) + '</strong> en ' + horizonYears + ' ans (+' + fmt(Math.round(totalGrowth)) + ').<br>' +
      'Croissance : contributions ' + pctContrib + '% (' + fmt(Math.round(cumContributions)) + ') | gains marche ' + pctMarket + '% (' + fmt(Math.round(finalGains)) + ') | immo ' + pctImmo + '% (' + fmt(Math.round(finalImmoGrowth)) + ').<br>' +
      'Part immo dans le NW final : <strong>' + pctImmoFinalNW + '%</strong> (' + fmt(Math.round(finalImmoTotal)) + '). ' +
      (month1M >= 0 ? '<strong>1M atteint en ' + (month1M/12).toFixed(1) + ' ans.</strong>' : '1M non atteint dans cet horizon.');
  }
  document.getElementById(prefix + 'Insight').innerHTML = insightHtml;

  return { dataLabels, dataNW, dataBase, dataGains, dataImmo, dataNWNoStop, stopChartIdx, stopYears };
}

function buildSimChart(canvasId, chartKey, result) {
  const { dataLabels, dataNW, dataBase, dataGains, dataImmo, dataNWNoStop, stopChartIdx, stopYears } = result;

  const datasets = [
    { label: 'Gains Marche (cumul)', data: dataGains, borderColor: '#276749', backgroundColor: 'rgba(39,103,73,0.25)', fill: true, tension: 0.3, borderWidth: 0, pointRadius: 0, order: 3 },
    { label: 'Capital Investi + Contributions', data: dataBase, borderColor: '#2b6cb0', backgroundColor: 'rgba(43,108,176,0.2)', fill: true, tension: 0.3, borderWidth: 0, pointRadius: 0, order: 2 },
    { label: 'Immobilier (equity)', data: dataImmo, borderColor: '#b7791f', backgroundColor: 'rgba(183,121,31,0.35)', fill: true, tension: 0.3, borderWidth: 0, pointRadius: 0, order: 1 },
    { label: 'Net Worth Total', data: dataNW, borderColor: '#1a202c', backgroundColor: 'transparent', fill: false, tension: 0.3, borderWidth: 2.5, pointRadius: 0, order: 0 },
  ];

  if (stopYears > 0) {
    datasets.push({ label: 'NW sans arret', data: dataNWNoStop, borderColor: 'rgba(39,103,73,0.35)', borderDash: [4,6], tension: 0.3, pointRadius: 0, borderWidth: 2, fill: false, order: 0 });
  }

  if (simCharts[chartKey]) simCharts[chartKey].destroy();
  const ctx = document.getElementById(canvasId).getContext('2d');
  simCharts[chartKey] = new Chart(ctx, {
    type: 'line',
    data: { labels: dataLabels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmt(c.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtAxis(v) }, suggestedMin: 0 } }
    },
    plugins: stopChartIdx >= 0 ? [{
      id: 'stopLine',
      afterDraw(chart) {
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const x = xScale.getPixelForValue(stopChartIdx);
        const ctx2 = chart.ctx;
        ctx2.save();
        ctx2.beginPath(); ctx2.moveTo(x, yScale.top); ctx2.lineTo(x, yScale.bottom);
        ctx2.lineWidth = 2; ctx2.strokeStyle = 'rgba(197, 48, 48, 0.6)'; ctx2.setLineDash([6, 4]); ctx2.stroke();
        ctx2.fillStyle = 'rgba(197, 48, 48, 0.85)'; ctx2.font = 'bold 11px sans-serif'; ctx2.textAlign = 'center';
        ctx2.fillText('Fin contributions', x, yScale.top + 14);
        ctx2.restore();
      }
    }] : []
  });
}

// ============ COUPLE SIMULATOR ============
function runCoupleSimulator(state) {
  const s = state;
  const monthlySavings = parseInt(document.getElementById('cplSimSavings').value);
  const pctActions = parseInt(document.getElementById('cplSimPctActions').value) / 100;
  const returnActions = parseFloat(document.getElementById('cplSimReturnActions').value) / 100;
  const horizonYears = parseInt(document.getElementById('cplSimHorizon').value);
  const stopYears = parseFloat(document.getElementById('cplSimStopYear').value);

  const coupleImmo = s.couple.immoEquity;
  const couplePoolActions = s.pools.actions + s.nezha.sgtm;
  const couplePoolCash = s.pools.cash + s.amine.recvPro + s.amine.recvPersonal + s.nezha.cash;
  const coupleStatic = s.amine.vehicles + s.amine.tva;
  const coupleNW = coupleImmo + couplePoolActions + couplePoolCash + coupleStatic;

  const result = runSimulatorGeneric({
    prefix: 'cplSim', monthlySavings, pctActions, returnActions,
    returnCash: 0.06, horizonYears, stopYears,
    startNW: coupleNW, startImmoEquity: coupleImmo,
    startPoolActions: couplePoolActions, startPoolCash: couplePoolCash,
    staticAssets: coupleStatic, existingGains: 45000,
    immoGrowthFn: (m) => {
      let growth = IC.growth.vitry + IC.growth.rueil;
      if (m >= IC.villejuifStartMonth) growth += IC.growth.villejuif;
      return growth;
    }
  });
  buildSimChart('cplSimChart', 'cplSim', result);
}

// ============ AMINE SIMULATOR ============
function runAmineSimulator(state) {
  const s = state;
  const monthlySavings = parseInt(document.getElementById('amSimSavings').value);
  const pctActions = parseInt(document.getElementById('amSimPctActions').value) / 100;
  const returnActions = parseFloat(document.getElementById('amSimReturnActions').value) / 100;
  const horizonYears = parseInt(document.getElementById('amSimHorizon').value);
  const stopYears = parseFloat(document.getElementById('amSimStopYear').value);

  const aminePoolCash = s.pools.cash + s.amine.recvPro + s.amine.recvPersonal;
  const amineStatic = s.amine.vehicles + s.amine.tva;

  const result = runSimulatorGeneric({
    prefix: 'amSim', monthlySavings, pctActions, returnActions,
    returnCash: 0.06, horizonYears, stopYears,
    startNW: s.amine.nw, startImmoEquity: s.amine.vitryEquity,
    startPoolActions: s.pools.actions, startPoolCash: aminePoolCash,
    staticAssets: amineStatic, existingGains: 45000,
    immoGrowthFn: () => IC.growth.vitry
  });
  buildSimChart('amSimChart', 'amSim', result);
}

// ============ NEZHA SIMULATOR ============
function runNezhaSimulator(state) {
  const s = state;
  const appreciation = parseFloat(document.getElementById('nzSimAppreciation').value) / 100;
  const cashReturn = parseFloat(document.getElementById('nzSimCashReturn').value) / 100;
  const horizonYears = parseInt(document.getElementById('nzSimHorizon').value);
  const months = horizonYears * 12;

  document.getElementById('nzSimAppreciationVal').textContent = (appreciation * 100).toFixed(1) + '%';
  document.getElementById('nzSimCashReturnVal').textContent = (cashReturn * 100).toFixed(1) + '%';
  document.getElementById('nzSimHorizonVal').textContent = horizonYears + ' ans';

  let rueilEq = s.nezha.rueilEquity;
  let villejuifEq = s.nezha.villejuifEquity;
  let cashNz = s.nezha.cash;
  let sgtmNz = s.nezha.sgtm;

  const monthlyApprecRueil = s.nezha.rueilValue * appreciation / 12;
  const monthlyApprecVillejuif = s.nezha.villejuifValue * appreciation / 12;
  const monthlyCashReturn = cashReturn / 12;

  const dataLabels = [], dataRueil = [], dataVillejuif = [], dataCash = [], dataTotal = [];

  for (let m = 0; m <= months; m++) {
    if (m % (months <= 60 ? 1 : 3) === 0 || m === months) {
      const date = new Date(2026, 2 + m, 1);
      dataLabels.push(date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }));
      dataRueil.push(Math.round(rueilEq));
      dataVillejuif.push(Math.round(villejuifEq));
      dataCash.push(Math.round(cashNz + sgtmNz));
      dataTotal.push(Math.round(rueilEq + villejuifEq + cashNz + sgtmNz));
    }
    rueilEq += IC.growth.rueil + monthlyApprecRueil;
    if (m >= IC.villejuifStartMonth) villejuifEq += IC.growth.villejuif + monthlyApprecVillejuif;
    cashNz *= (1 + monthlyCashReturn);
    sgtmNz *= (1 + 0.07 / 12);
  }

  const finalNW = dataTotal[dataTotal.length - 1];
  const finalRueil = dataRueil[dataRueil.length - 1];
  const finalVillejuif = dataVillejuif[dataVillejuif.length - 1];
  const finalCash = dataCash[dataCash.length - 1];

  document.getElementById('nzSimNW').textContent = fmt(finalNW, true);
  document.getElementById('nzSimRueil').textContent = fmt(finalRueil, true);
  document.getElementById('nzSimVillejuif').textContent = fmt(finalVillejuif, true);
  document.getElementById('nzSimCash').textContent = fmt(finalCash, true);

  const totalGrowth = finalNW - s.nezha.nw;
  document.getElementById('nzSimInsight').innerHTML =
    '<strong>Resume :</strong> NW Nezha : <strong>' + fmt(s.nezha.nw) + '</strong> &rarr; <strong>' + fmt(finalNW) + '</strong> en ' + horizonYears + ' ans (+' + fmt(Math.round(totalGrowth)) + ').<br>' +
    'Rueil : ' + fmt(finalRueil) + ' | Villejuif : ' + fmt(finalVillejuif) + ' | Cash : ' + fmt(finalCash) + '.<br>' +
    '<strong>Croissance moyenne : +' + fmt(Math.round(totalGrowth / horizonYears)) + '/an</strong> via remboursement des prets' +
    (appreciation > 0 ? ' + appreciation ' + (appreciation * 100).toFixed(1) + '%/an.' : '.');

  // Chart
  if (simCharts.nzSim) simCharts.nzSim.destroy();
  const ctx = document.getElementById('nzSimChart').getContext('2d');
  simCharts.nzSim = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dataLabels,
      datasets: [
        { label: 'NW Total Nezha', data: dataTotal, borderColor: '#d69e2e', backgroundColor: 'transparent', fill: false, tension: 0.3, borderWidth: 2.5, pointRadius: 0, order: 0 },
        { label: 'Equity Rueil', data: dataRueil, borderColor: '#2b6cb0', backgroundColor: 'rgba(43,108,176,0.15)', fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0, order: 2 },
        { label: 'Equity Villejuif', data: dataVillejuif, borderColor: '#2c7a7b', backgroundColor: 'rgba(44,122,123,0.15)', fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0, order: 1 },
        { label: 'Cash + Creances', data: dataCash, borderColor: '#a0aec0', backgroundColor: 'rgba(160,174,192,0.1)', fill: true, tension: 0.3, borderWidth: 1, pointRadius: 0, borderDash: [4,3], order: 3 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmt(c.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtAxis(v) }, suggestedMin: 0 } }
    },
    plugins: [{
      id: 'villejuifLine',
      afterDraw(chart) {
        const labels = chart.data.labels;
        const d = new Date(2026, 2 + IC.villejuifStartMonth, 1);
        const lbl = d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
        let idx = labels.indexOf(lbl);
        if (idx < 0) return;
        const xScale = chart.scales.x, yScale = chart.scales.y;
        const x = xScale.getPixelForValue(idx);
        const ctx2 = chart.ctx;
        ctx2.save();
        ctx2.beginPath(); ctx2.moveTo(x, yScale.top); ctx2.lineTo(x, yScale.bottom);
        ctx2.lineWidth = 2; ctx2.strokeStyle = 'rgba(183,121,31, 0.5)'; ctx2.setLineDash([6, 4]); ctx2.stroke();
        ctx2.fillStyle = 'rgba(183,121,31, 0.85)'; ctx2.font = 'bold 11px sans-serif'; ctx2.textAlign = 'center';
        ctx2.fillText('Livraison Villejuif', x, yScale.top + 14);
        ctx2.restore();
      }
    }]
  });
}

// ============ VITRY FISCAL SIMULATOR ============

/**
 * Compute amortization for a multi-period loan (like Riv'immo BP)
 * Returns monthly schedule: [{month, interest, principal, crd}]
 */
function computeMultiPeriodAmort(loan) {
  const schedule = [];
  let crd = loan.principal;
  const monthlyRate = loan.rate / 12;
  let monthIdx = 0;

  if (loan.periods) {
    for (const period of loan.periods) {
      for (let i = 0; i < period.months && crd > 0.01; i++) {
        const interest = crd * monthlyRate;
        const payment = Math.min(period.payment, crd + interest);
        const principalPart = Math.max(0, payment - interest);
        crd = Math.max(0, crd - principalPart);
        schedule.push({ month: monthIdx + 1, interest, principal: principalPart, crd, payment });
        monthIdx++;
      }
    }
  } else {
    // Simple fixed-payment loan
    for (let i = 0; i < loan.durationMonths && crd > 0.01; i++) {
      const interest = crd * monthlyRate;
      const principalPart = Math.min(loan.monthlyPayment - interest, crd);
      crd = Math.max(0, crd - principalPart);
      schedule.push({ month: i + 1, interest, principal: principalPart, crd, payment: loan.monthlyPayment });
    }
  }
  return schedule;
}

/**
 * Get yearly interest totals from a monthly schedule
 * startDate: 'YYYY-MM', returns {year: totalInterest}
 */
function yearlyInterest(schedule, startDate) {
  const [sy, sm] = startDate.split('-').map(Number);
  const yearly = {};
  schedule.forEach((row, i) => {
    const y = sy + Math.floor((sm - 1 + i) / 12);
    yearly[y] = (yearly[y] || 0) + row.interest;
  });
  return yearly;
}

/**
 * Build & run the Vitry fiscal simulator
 * Interactive table: loyer déclaré (slider) × 10 years
 */
function runVitryFiscalSim() {
  const container = document.getElementById('vitryFiscalSimBody');
  const sliderEl = document.getElementById('vitrySimLoyer');
  const loyerValEl = document.getElementById('vitrySimLoyerVal');
  if (!container || !sliderEl) return;

  const loans = IC.loans && IC.loans.vitryLoans;
  if (!loans || loans.length === 0) return;

  // Compute amortization for each loan
  const amorts = loans.map(loan => ({
    name: loan.name,
    schedule: computeMultiPeriodAmort(loan),
    startDate: loan.startDate,
    yearlyInt: {},
  }));
  amorts.forEach(a => { a.yearlyInt = yearlyInterest(a.schedule, loans[0].startDate); });

  // Fixed charges (annual estimates)
  const insAPRIL = IC.loans && IC.loans.vitryInsuranceAPRIL;
  const assuranceAPRIL = insAPRIL ? insAPRIL.annualTTC : 210;
  const assuranceAL = loans[0].insuranceMonthly * 12; // 3.33 × 12 = 39.96
  const pnoAnnuel = IC.charges.vitry.pno * 12;        // 15 × 12 = 180
  const tfAnnuel = IC.charges.vitry.tf * 12;           // 75 × 12 = 900
  const totalAssurance = assuranceAPRIL + assuranceAL;

  // Tax rates (non-résident)
  const tmi = IC.fiscalite.vitry.tmi;   // 20%
  const ps = IC.fiscalite.vitry.ps;     // 17.2%
  const totalRate = tmi + ps;           // 37.2%

  const startYear = 2026;
  const nYears = 10;

  function update() {
    const loyerMensuel = parseInt(sliderEl.value);
    if (loyerValEl) loyerValEl.textContent = loyerMensuel + ' €/mois';
    const loyerAnnuel = loyerMensuel * 12;

    let html = '';
    for (let y = 0; y < nYears; y++) {
      const year = startYear + y;

      // Total interest for the year across all loans
      const interetsAL = amorts[0].yearlyInt[year] || 0;
      const interetsPTZ = amorts[1] ? (amorts[1].yearlyInt[year] || 0) : 0;
      const interetsBP = amorts[2] ? (amorts[2].yearlyInt[year] || 0) : 0;
      const totalInterets = interetsAL + interetsPTZ + interetsBP;

      // Total deductions
      const totalDeductions = totalInterets + totalAssurance + pnoAnnuel + tfAnnuel;

      // Taxable income
      const revenuImposable = Math.max(0, loyerAnnuel - totalDeductions);
      const deficit = loyerAnnuel - totalDeductions < 0 ? Math.abs(loyerAnnuel - totalDeductions) : 0;
      const impot = Math.round(revenuImposable * totalRate);
      const impotMois = Math.round(impot / 12);

      const deficitClass = deficit > 0 ? ' class="pl-pos"' : '';
      const impotClass = impot > 0 ? ' class="pl-neg"' : ' class="pl-pos"';

      html += '<tr>'
        + '<td><strong>' + year + '</strong></td>'
        + '<td class="num">' + Math.round(totalInterets).toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + Math.round(totalAssurance).toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + pnoAnnuel.toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + tfAnnuel.toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="font-weight:600">' + Math.round(totalDeductions).toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + loyerAnnuel.toLocaleString('fr-FR') + '</td>'
        + '<td class="num"' + (deficit > 0 ? ' style="color:var(--green)"' : '') + '>'
          + (deficit > 0 ? '<span style="color:var(--green)">Déficit ' + Math.round(deficit).toLocaleString('fr-FR') + '</span>' : revenuImposable.toLocaleString('fr-FR'))
        + '</td>'
        + '<td class="num"' + impotClass + ' style="font-weight:700">' + impot.toLocaleString('fr-FR') + ' <small>(' + impotMois + '/m)</small></td>'
        + '</tr>';
    }
    container.innerHTML = html;

    // Update summary card
    const summaryEl = document.getElementById('vitryFiscalSummary');
    if (summaryEl) {
      const yr1Int = (amorts[0].yearlyInt[startYear] || 0) + (amorts[1] ? amorts[1].yearlyInt[startYear] || 0 : 0) + (amorts[2] ? amorts[2].yearlyInt[startYear] || 0 : 0);
      const yr1Ded = yr1Int + totalAssurance + pnoAnnuel + tfAnnuel;
      const yr1Rev = Math.max(0, loyerAnnuel - yr1Ded);
      const yr1Impot = Math.round(yr1Rev * totalRate);
      summaryEl.innerHTML = '<strong>Résumé ' + startYear + ' :</strong> '
        + 'Loyer déclaré ' + loyerAnnuel.toLocaleString('fr-FR') + '€/an'
        + ' | Déductions ' + Math.round(yr1Ded).toLocaleString('fr-FR') + '€'
        + ' | Revenu imposable ' + yr1Rev.toLocaleString('fr-FR') + '€'
        + ' | <strong' + (yr1Impot > 0 ? ' class="pl-neg"' : ' class="pl-pos"') + '>Impôt ' + yr1Impot.toLocaleString('fr-FR') + '€/an (' + Math.round(yr1Impot / 12) + '€/mois)</strong>';
    }
  }

  sliderEl.addEventListener('input', update);
  update();
}

// ============ INIT SIMULATORS ============
export function initSimulators(state) {
  runCoupleSimulator(state);
  runAmineSimulator(state);
  runNezhaSimulator(state);
  runVitryFiscalSim();
}

export function bindSimulatorEvents(state, refreshFn) {
  // Couple
  ['cplSimSavings','cplSimPctActions','cplSimReturnActions','cplSimStopYear','cplSimHorizon'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => runCoupleSimulator(state));
  });
  // Amine
  ['amSimSavings','amSimPctActions','amSimReturnActions','amSimStopYear','amSimHorizon'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => runAmineSimulator(state));
  });
  // Nezha
  ['nzSimAppreciation','nzSimCashReturn','nzSimHorizon'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => runNezhaSimulator(state));
  });
  // Vitry fiscal sim (slider already bound in runVitryFiscalSim)
}
