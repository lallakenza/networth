// ============================================================
// SIMULATORS — 3 projection simulators (couple, amine, nezha)
// ============================================================

import { fmt, fmtAxis } from './render.js?v=148';
import { IMMO_CONSTANTS } from './data.js?v=148';

const IC = IMMO_CONSTANTS;
let simCharts = {};

// ============ GENERIC SIMULATOR ENGINE ============
function runSimulatorGeneric(config) {
  const {
    prefix, monthlySavings, pctActions, returnActions, returnCash,
    horizonYears, stopYears,
    startNW, startImmoEquity, startPoolActions, startPoolCash,
    staticAssets, immoGrowthFn, existingGains,
    immoBreakdown, // optional: [{label, startEquity, growthFn(m)}]
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

  // Per-property immo tracking
  const props = immoBreakdown || [];
  const propCumGrowth = props.map(() => 0);

  const dataLabels = [], dataNW = [], dataImmo = [], dataBase = [], dataGains = [], dataNWNoStop = [];
  const immoBreakdownData = props.map(() => []); // per-property equity arrays
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

    if (true) { // Monthly granularity — every data point
      const date = new Date(2026, 2 + m, 1);
      dataLabels.push(date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }));

      // Compute immo from property sum (ensures consistency with per-property breakdown)
      let immoFromProps = 0;
      props.forEach((p, pi) => {
        let propVal;
        if (p._computedEquity) {
          propVal = Math.round(p.growthFn(m));
        } else {
          propVal = Math.round(p.startEquity + propCumGrowth[pi]);
        }
        immoBreakdownData[pi].push(propVal);
        immoFromProps += propVal;
      });
      // If no breakdown props, fall back to delta-based immo
      const immoVal = props.length > 0 ? immoFromProps : Math.round(immoNow);

      dataNW.push(Math.round(immoVal + liquidNow));
      dataImmo.push(immoVal);
      dataBase.push(Math.round(immoVal + startLiquidBase + cumContributions));
      dataGains.push(Math.round(immoVal + startLiquidBase + cumContributions + gainsNow));
      dataNWNoStop.push(Math.round(immoVal + liquidNS));
      if (stopYears > 0 && stopChartIdx === -1 && m >= stopMonth) stopChartIdx = dataLabels.length - 1;
    }

    if (totalNW >= 1000000 && month1M === -1) month1M = m;

    const immoGrowth = immoGrowthFn(m);
    cumImmoReturns += immoGrowth;
    // Track per-property growth (for non-computed equity properties)
    props.forEach((p, pi) => {
      if (!p._computedEquity) {
        propCumGrowth[pi] += p.growthFn(m);
      }
    });

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

  // Compute exact 1M date
  let m1MDateLabel = '';
  let m1MMotivation = '';
  if (month1M >= 0) {
    const d1mExact = new Date(2026, 2 + month1M, 1);
    m1MDateLabel = d1mExact.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const yearsTo1M = (month1M / 12).toFixed(1);
    m1MMotivation = '<br><div style="margin-top:8px;padding:10px 14px;background:#f0fff4;border-left:3px solid #16a34a;border-radius:6px;font-size:13px;">'
      + '\ud83c\udfaf <strong>1 000 000\u20ac atteint en ' + m1MDateLabel + '</strong> (' + yearsTo1M + ' ans).<br>'
      + '<span style="color:#276749;">'
      + (month1M <= 24 ? 'Vous \u00eates \u00e0 moins de 2 ans du million. Chaque mois investi acc\u00e9l\u00e8re l\'\u00e9cart. Ne l\u00e2chez rien !'
        : month1M <= 60 ? 'Le million est \u00e0 port\u00e9e de main. Les int\u00e9r\u00eats compos\u00e9s font le gros du travail \u2014 la discipline paie.'
        : 'La patience est votre meilleur alli\u00e9. Chaque euro investi aujourd\u2019hui vaut ' + Math.round(Math.pow(1 + (returnActions || 0.10), month1M/12)) + '\u20ac dans ' + yearsTo1M + ' ans.')
      + '</span></div>';
  }

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
      '<span style="color:var(--red)">Cout de l\'arret : ' + fmt(Math.round(costOfStopping)) + '</span>.' +
      m1MMotivation;
  } else {
    insightHtml =
      '<strong>Resume :</strong> NW : <strong>' + fmt(startNW) + '</strong> &rarr; <strong>' + fmt(finalNW) + '</strong> en ' + horizonYears + ' ans (+' + fmt(Math.round(totalGrowth)) + ').<br>' +
      'Croissance : contributions ' + pctContrib + '% (' + fmt(Math.round(cumContributions)) + ') | gains marche ' + pctMarket + '% (' + fmt(Math.round(finalGains)) + ') | immo ' + pctImmo + '% (' + fmt(Math.round(finalImmoGrowth)) + ').<br>' +
      'Part immo dans le NW final : <strong>' + pctImmoFinalNW + '%</strong> (' + fmt(Math.round(finalImmoTotal)) + ').' +
      m1MMotivation;
  }
  document.getElementById(prefix + 'Insight').innerHTML = insightHtml;

  // Build immo breakdown labels + data for chart tooltip
  const immoBreakdownResult = props.length > 0 ? props.map((p, pi) => ({ label: p.label, data: immoBreakdownData[pi] })) : null;

  return { dataLabels, dataNW, dataBase, dataGains, dataImmo, dataNWNoStop, stopChartIdx, stopYears, immoBreakdownResult };
}

function buildSimChart(canvasId, chartKey, result) {
  const { dataLabels, dataNW, dataBase, dataGains, dataImmo, dataNWNoStop, stopChartIdx, stopYears, immoBreakdownResult } = result;

  // Compute actual (non-cumulative) values for each band
  const actualImmo = dataImmo.map(v => v);
  const actualCapital = dataBase.map((v, i) => v - dataImmo[i]);
  const actualGains = dataGains.map((v, i) => v - dataBase[i]);

  // Datasets ordered bottom-to-top for proper stacking with fill: '-1'
  const coreCount = 4; // Immo, Capital, Gains, NW Total (before optional NW sans arret)
  const datasets = [
    { label: 'Immobilier (equity)', data: [...dataImmo], borderColor: '#b7791f', backgroundColor: 'rgba(183,121,31,0.5)', fill: 'origin', tension: 0.3, borderWidth: 1, pointRadius: 0, _actual: actualImmo },
    { label: 'Capital Investi + Contributions', data: [...dataBase], borderColor: '#2b6cb0', backgroundColor: 'rgba(43,108,176,0.35)', fill: '-1', tension: 0.3, borderWidth: 1, pointRadius: 0, _actual: actualCapital },
    { label: 'Gains Marche (cumul)', data: [...dataGains], borderColor: '#276749', backgroundColor: 'rgba(39,103,73,0.35)', fill: '-1', tension: 0.3, borderWidth: 1, pointRadius: 0, _actual: actualGains },
    { label: 'Net Worth Total', data: [...dataNW], borderColor: '#1a202c', backgroundColor: 'transparent', fill: false, tension: 0.3, borderWidth: 2.5, pointRadius: 0, _actual: dataNW },
  ];

  if (stopYears > 0) {
    datasets.push({ label: 'NW sans arret', data: [...dataNWNoStop], borderColor: 'rgba(39,103,73,0.35)', borderDash: [4,6], tension: 0.3, pointRadius: 0, borderWidth: 2, fill: false, _actual: dataNWNoStop, hidden: true });
  }

  // Store originals for reset
  const origData = datasets.map(ds => ({ data: [...ds.data], fill: ds.fill, backgroundColor: ds.backgroundColor, borderWidth: ds.borderWidth }));
  const selected = new Set(); // empty = all visible (stacked)

  if (simCharts[chartKey]) simCharts[chartKey].destroy();
  const ctx = document.getElementById(canvasId).getContext('2d');
  simCharts[chartKey] = new Chart(ctx, {
    type: 'line',
    data: { labels: dataLabels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: {
          mode: 'index', intersect: false,
          filter: function(tooltipItem) {
            // Always hide "NW sans arret" from tooltip
            if (tooltipItem.dataset.label === 'NW sans arret') return false;
            return true;
          },
          itemSort: function(a, b) {
            // Reverse order: NW Total first, then Gains, Capital, Immo last
            return b.datasetIndex - a.datasetIndex;
          },
          callbacks: {
            label: c => {
              const ds = c.dataset;
              const actual = ds._actual ? ds._actual[c.dataIndex] : c.parsed.y;
              return ' ' + ds.label + ': ' + fmt(actual);
            },
            afterBody: function() { return ''; }
          }
        },
        legend: {
          labels: {
            generateLabels: function(chart) {
              const labels = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              labels.forEach((lbl, i) => {
                if (selected.size > 0 && !selected.has(i)) {
                  lbl.fontColor = 'rgba(0,0,0,0.25)';
                }
              });
              return labels;
            }
          },
          onClick: function(e, legendItem, legend) {
            const chart = legend.chart;
            const idx = legendItem.datasetIndex;

            if (selected.has(idx)) {
              selected.delete(idx);
            } else {
              selected.add(idx);
            }

            // Remove any previous immo sub-lines
            while (chart.data.datasets.length > origData.length) {
              chart.data.datasets.pop();
            }

            if (selected.size === 0) {
              // Reset: show all datasets with original stacked data
              chart.data.datasets.forEach((ds, i) => {
                ds.data = [...origData[i].data];
                ds.fill = origData[i].fill;
                ds.backgroundColor = origData[i].backgroundColor;
                ds.borderWidth = origData[i].borderWidth;
                ds.hidden = false;
              });
            } else {
              // Indices 0-2 are stackable bands (Immo, Capital, Gains)
              // Indices 3+ are overlay lines (NW Total, NW sans arret) — never stacked
              const stackable = new Set([...selected].filter(i => i < 3));
              const sortedStack = [...stackable].sort((a, b) => a - b);
              const len = dataLabels.length;
              let cumulative = new Array(len).fill(0);

              chart.data.datasets.forEach((ds, i) => {
                if (stackable.has(i)) {
                  // Stackable band: cumulate actual values
                  const selOrder = sortedStack.indexOf(i);
                  const newData = ds._actual.map((v, j) => cumulative[j] + v);
                  cumulative = [...newData];
                  ds.data = newData;
                  ds.fill = selOrder === 0 ? 'origin' : sortedStack[selOrder - 1];
                  ds.backgroundColor = origData[i].backgroundColor.replace(/[\d.]+\)$/, '0.5)');
                  ds.borderWidth = 1.5;
                  ds.hidden = false;
                } else if (selected.has(i) && i >= 3) {
                  // Overlay line (NW Total, NW sans arret): show as-is, no stacking
                  ds.data = [...ds._actual];
                  ds.fill = false;
                  ds.backgroundColor = 'transparent';
                  ds.borderWidth = origData[i].borderWidth;
                  ds.hidden = false;
                } else {
                  ds.hidden = true;
                }
              });

              // If only Immo selected and breakdown available → add stacked filled bands per apartment
              if (selected.size === 1 && selected.has(0) && immoBreakdownResult) {
                const subBorders = ['#c05621', '#b7791f', '#d69e2e'];
                const subBgs = ['rgba(192,86,33,0.45)', 'rgba(183,121,31,0.35)', 'rgba(214,158,46,0.25)'];
                let cumSub = new Array(len).fill(0);
                const firstSubIdx = chart.data.datasets.length; // index of first sub-dataset
                immoBreakdownResult.forEach((b, bi) => {
                  const stackedData = b.data.map((v, j) => cumSub[j] + v);
                  cumSub = [...stackedData];
                  chart.data.datasets.push({
                    label: '  ' + b.label,
                    data: stackedData,
                    borderColor: subBorders[bi % subBorders.length],
                    backgroundColor: subBgs[bi % subBgs.length],
                    fill: bi === 0 ? 'origin' : firstSubIdx + bi - 1,
                    tension: 0.3,
                    borderWidth: 1,
                    pointRadius: 0,
                    _actual: b.data,
                    _subLabel: b.label,
                  });
                });
                // Hide the main Immo area fill (sub-bands replace it)
                chart.data.datasets[0].backgroundColor = 'transparent';
              }
            }
            chart.update();
          }
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 24, maxRotation: 45, minRotation: 45 } },
        y: { ticks: { callback: v => fmtAxis(v) }, suggestedMin: 0 }
      }
    },
    plugins: [
      // Stop line plugin
      ...(stopChartIdx >= 0 ? [{
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
      }] : []),
      // Band labels for immo breakdown sub-datasets
      {
        id: 'bandLabels',
        afterDraw(chart) {
          // Sub-datasets are added dynamically beyond origData.length
          if (chart.data.datasets.length <= origData.length) return;
          const ctx2 = chart.ctx;
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;
          // Place label at ~60% of the x-axis for readability
          const labelIdx = Math.round(chart.data.labels.length * 0.6);
          ctx2.save();
          ctx2.font = 'bold 12px sans-serif';
          ctx2.textAlign = 'left';
          let prevY = yScale.getPixelForValue(0);
          for (let si = origData.length; si < chart.data.datasets.length; si++) {
            const ds = chart.data.datasets[si];
            if (ds.hidden) continue;
            const val = ds.data[labelIdx];
            const yTop = yScale.getPixelForValue(val);
            const yMid = (prevY + yTop) / 2;
            const x = xScale.getPixelForValue(labelIdx) + 8;
            ctx2.fillStyle = ds.borderColor;
            ctx2.fillText(ds.label.replace(/^\s+/, ''), x, yMid + 4);
            prevY = yTop;
          }
          ctx2.restore();
        }
      }
    ]
  });
}

// ============ GENERIC PROPERTY EQUITY COMPUTER ============
// Computes absolute NET equity (after exit costs) for any property
// based on amort schedule + phased appreciation - projected exit costs
function makeComputePropertyEquity(iv, loanKey, propertyInitialValue) {
  // Pre-extract exit costs by year for this property
  const exitCostsByYearProp = (iv && iv.exitCostsByYearProp) || {};

  return (m) => {
    if (!iv || !iv.amortSchedules || !iv.amortSchedules[loanKey]) return 0;

    const amort = iv.amortSchedules[loanKey];
    const prop = iv.properties.find(p => p.loanKey === loanKey);
    if (!prop) return 0;

    const sched = amort.schedule;
    if (!sched || sched.length === 0) return 0;

    // Convert simulator month to actual date string (YYYY-MM)
    // Simulator m=0 = March 2026, m=1 = April 2026, etc.
    const simBaseDate = new Date(2026, 2, 1); // March 1, 2026
    const targetDate = new Date(simBaseDate);
    targetDate.setMonth(targetDate.getMonth() + m);
    const targetYear = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth() + 1; // 1-indexed
    const dateStr = targetYear + '-' + String(targetMonth).padStart(2, '0');

    // Find the closest schedule entry for this date
    let crd = 0;
    for (let i = 0; i < sched.length; i++) {
      if (sched[i].date === dateStr) {
        crd = sched[i].remainingCRD;
        break;
      }
      // Use the last schedule entry <= this date
      if (sched[i].date < dateStr) {
        crd = sched[i].remainingCRD;
      } else {
        break;
      }
    }
    // If past last schedule entry, loan is paid off
    if (sched.length > 0 && dateStr > sched[sched.length - 1].date) crd = 0;

    // Property appreciation using phases
    const propMeta = IC.properties[loanKey] || {};
    const phases = propMeta.appreciationPhases || [];

    function getRate(year) {
      for (let i = 0; i < phases.length; i++) {
        if (year >= phases[i].start && year <= phases[i].end) return phases[i].rate;
      }
      return propMeta.appreciation || 0.02;
    }

    // Compound appreciation from current year (propertyInitialValue is already current market value)
    let projValue = propertyInitialValue;
    const startYear = new Date().getFullYear(); // 2026
    for (let y = startYear; y < targetYear; y++) {
      projValue *= (1 + getRate(y));
    }

    // Also apply partial-year appreciation for months within current year
    const partialMonths = targetMonth - 1; // months elapsed in target year
    if (partialMonths > 0) {
      projValue *= Math.pow(1 + getRate(targetYear), partialMonths / 12);
    }

    const grossEquity = projValue - crd;

    // Interpolate exit costs between years to avoid staircase effect
    const ecThisYear = (exitCostsByYearProp[targetYear] || {})[loanKey] || 0;
    const ecNextYear = (exitCostsByYearProp[targetYear + 1] || {})[loanKey] || ecThisYear;
    const monthFrac = (targetMonth - 1) / 12; // 0 = Jan, 0.917 = Dec
    const propEC = ecThisYear + (ecNextYear - ecThisYear) * monthFrac;

    return Math.max(0, grossEquity - propEC);
  };
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

  // Create property equity computers for each property
  const iv = s.immoView;
  const computeVitryEquity = makeComputePropertyEquity(iv, 'vitry', iv?.properties?.find(p => p.loanKey === 'vitry')?.value || 0);
  const computeRueilEquity = makeComputePropertyEquity(iv, 'rueil', iv?.properties?.find(p => p.loanKey === 'rueil')?.value || 0);
  const computeVillejuifEquity = makeComputePropertyEquity(iv, 'villejuif', iv?.properties?.find(p => p.loanKey === 'villejuif')?.value || 0);

  // Compute initial equity at m=0 to align startEquity with computePropertyEquity(0)
  const vitryEq0 = computeVitryEquity(0);
  const rueilEq0 = computeRueilEquity(0);
  const computedImmo0 = vitryEq0 + rueilEq0; // Villejuif not operational at m=0

  // Track previous total immo equity for delta calculation
  let prevImmoTotal = computedImmo0;

  const result = runSimulatorGeneric({
    prefix: 'cplSim', monthlySavings, pctActions, returnActions,
    returnCash: 0.06, horizonYears, stopYears,
    startNW: coupleNW - coupleImmo + computedImmo0, startImmoEquity: computedImmo0,
    startPoolActions: couplePoolActions, startPoolCash: couplePoolCash,
    staticAssets: coupleStatic, existingGains: 45000,
    immoGrowthFn: (m) => {
      // Compute total absolute equity at month m
      let totalEquity = computeVitryEquity(m) + computeRueilEquity(m);
      if (m >= IC.villejuifStartMonth) totalEquity += computeVillejuifEquity(m);

      // Return delta from previous month (cumImmoReturns accumulates these)
      const delta = totalEquity - prevImmoTotal;
      prevImmoTotal = totalEquity;
      return delta;
    },
    immoBreakdown: [
      {
        label: 'Vitry',
        startEquity: vitryEq0,
        growthFn: computeVitryEquity,
        _computedEquity: true
      },
      {
        label: 'Rueil',
        startEquity: rueilEq0,
        growthFn: computeRueilEquity,
        _computedEquity: true
      },
      {
        label: 'Villejuif',
        startEquity: 0,
        growthFn: (m) => m >= IC.villejuifStartMonth ? computeVillejuifEquity(m) : 0,
        _computedEquity: true
      },
    ]
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

  // Create property equity computer for Vitry
  const iv = s.immoView;
  const computeVitryEquity = makeComputePropertyEquity(iv, 'vitry', iv?.properties?.find(p => p.loanKey === 'vitry')?.value || 0);

  // Align starting equity with what computeVitryEquity(0) returns
  const vitryEq0 = computeVitryEquity(0);
  let prevImmoTotal = vitryEq0;

  const result = runSimulatorGeneric({
    prefix: 'amSim', monthlySavings, pctActions, returnActions,
    returnCash: 0.06, horizonYears, stopYears,
    startNW: s.amine.nw - s.amine.vitryEquity + vitryEq0, startImmoEquity: vitryEq0,
    startPoolActions: s.pools.actions, startPoolCash: aminePoolCash,
    staticAssets: amineStatic, existingGains: 45000,
    immoGrowthFn: (m) => {
      // Compute total absolute equity at month m
      const totalEquity = computeVitryEquity(m);
      // Return delta from previous month
      const delta = totalEquity - prevImmoTotal;
      prevImmoTotal = totalEquity;
      return delta;
    }
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

  let cashNz = s.nezha.cash;
  let sgtmNz = s.nezha.sgtm;

  const monthlyCashReturn = cashReturn / 12;

  // Create property equity computers for Rueil and Villejuif
  const ivNz = s.immoView;
  const computeRueilEquity = makeComputePropertyEquity(ivNz, 'rueil', ivNz?.properties?.find(p => p.loanKey === 'rueil')?.value || 0);
  const computeVillejuifEquity = makeComputePropertyEquity(ivNz, 'villejuif', ivNz?.properties?.find(p => p.loanKey === 'villejuif')?.value || 0);

  const dataLabels = [], dataRueil = [], dataVillejuif = [], dataCash = [], dataTotal = [];

  for (let m = 0; m <= months; m++) {
    if (true) { // Monthly granularity — every data point
      const date = new Date(2026, 2 + m, 1);
      dataLabels.push(date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }));
      const rueilEq = computeRueilEquity(m);
      const villejuifEq = m >= IC.villejuifStartMonth ? computeVillejuifEquity(m) : 0;
      dataRueil.push(Math.round(rueilEq));
      dataVillejuif.push(Math.round(villejuifEq));
      dataCash.push(Math.round(cashNz + sgtmNz));
      dataTotal.push(Math.round(rueilEq + villejuifEq + cashNz + sgtmNz));
    }
    // Update cash and sgtm for next month
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

  // Build cumulative stacking data (bottom-to-top: Rueil → Villejuif → Cash → Total line)
  const cumRueil = dataRueil.map(v => v);
  const cumRueilVillejuif = dataRueil.map((v, i) => v + dataVillejuif[i]);
  const cumAll = dataRueil.map((v, i) => v + dataVillejuif[i] + dataCash[i]);

  const nzDatasets = [
    { label: 'Equity Rueil', data: [...cumRueil], borderColor: '#2b6cb0', backgroundColor: 'rgba(43,108,176,0.45)', fill: 'origin', tension: 0.3, borderWidth: 1, pointRadius: 0, _actual: dataRueil },
    { label: 'Equity Villejuif', data: [...cumRueilVillejuif], borderColor: '#2c7a7b', backgroundColor: 'rgba(44,122,123,0.35)', fill: '-1', tension: 0.3, borderWidth: 1, pointRadius: 0, _actual: dataVillejuif },
    { label: 'Cash + SGTM', data: [...cumAll], borderColor: '#a0aec0', backgroundColor: 'rgba(160,174,192,0.3)', fill: '-1', tension: 0.3, borderWidth: 1, pointRadius: 0, _actual: dataCash },
    { label: 'NW Total Nezha', data: [...dataTotal], borderColor: '#d69e2e', backgroundColor: 'transparent', fill: false, tension: 0.3, borderWidth: 2.5, pointRadius: 0, _actual: dataTotal },
  ];

  const nzOrigData = nzDatasets.map(ds => ({ data: [...ds.data], fill: ds.fill, backgroundColor: ds.backgroundColor, borderWidth: ds.borderWidth }));
  const nzSelected = new Set();

  // Chart
  if (simCharts.nzSim) simCharts.nzSim.destroy();
  const ctx = document.getElementById('nzSimChart').getContext('2d');
  simCharts.nzSim = new Chart(ctx, {
    type: 'line',
    data: { labels: dataLabels, datasets: nzDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            label: c => {
              const ds = c.dataset;
              const actual = ds._actual ? ds._actual[c.dataIndex] : c.parsed.y;
              return ' ' + ds.label + ': ' + fmt(actual);
            }
          }
        },
        legend: {
          labels: {
            generateLabels: function(chart) {
              const labels = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              labels.forEach((lbl, i) => {
                if (nzSelected.size > 0 && !nzSelected.has(i)) lbl.fontColor = 'rgba(0,0,0,0.25)';
              });
              return labels;
            }
          },
          onClick: function(e, legendItem, legend) {
            const chart = legend.chart;
            const idx = legendItem.datasetIndex;
            if (nzSelected.has(idx)) { nzSelected.delete(idx); } else { nzSelected.add(idx); }
            if (nzSelected.size === 0) {
              chart.data.datasets.forEach((ds, i) => {
                ds.data = [...nzOrigData[i].data]; ds.fill = nzOrigData[i].fill;
                ds.backgroundColor = nzOrigData[i].backgroundColor; ds.borderWidth = nzOrigData[i].borderWidth; ds.hidden = false;
              });
            } else {
              // Indices 0-2 are stackable (Rueil, Villejuif, Cash), index 3 = NW Total (line only)
              const stackable = new Set([...nzSelected].filter(i => i < 3));
              const sortedStack = [...stackable].sort((a, b) => a - b);
              const len = dataLabels.length;
              let cumulative = new Array(len).fill(0);
              chart.data.datasets.forEach((ds, i) => {
                if (stackable.has(i)) {
                  const selOrder = sortedStack.indexOf(i);
                  const newData = ds._actual.map((v, j) => cumulative[j] + v);
                  cumulative = [...newData];
                  ds.data = newData;
                  ds.fill = selOrder === 0 ? 'origin' : sortedStack[selOrder - 1];
                  ds.backgroundColor = nzOrigData[i].backgroundColor.replace(/[\d.]+\)$/, '0.5)');
                  ds.borderWidth = 1.5; ds.hidden = false;
                } else if (nzSelected.has(i) && i >= 3) {
                  ds.data = [...ds._actual]; ds.fill = false;
                  ds.backgroundColor = 'transparent'; ds.borderWidth = nzOrigData[i].borderWidth; ds.hidden = false;
                } else { ds.hidden = true; }
              });
            }
            chart.update();
          }
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 24, maxRotation: 45, minRotation: 45 } },
        y: { ticks: { callback: v => fmtAxis(v) }, suggestedMin: 0 }
      }
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

// ============ OPPORTUNITY COST SIMULATOR ============
function runOpportunityCostSim() {
  const amount = parseFloat(document.getElementById('oppCostAmount')?.value) || 10000;
  const annualReturn = parseFloat(document.getElementById('oppCostReturn')?.value) || 10;
  const horizon = parseInt(document.getElementById('oppCostHorizon')?.value) || 20;

  // Update labels
  const setV = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setV('oppCostReturnVal', annualReturn.toFixed(1) + '%');
  setV('oppCostHorizonVal', horizon + ' ans');

  const r = annualReturn / 100;
  const futureValue = amount * Math.pow(1 + r, horizon);
  const lost = futureValue - amount;
  const multiplier = futureValue / amount;

  setV('oppCostFuture', fmt(Math.round(futureValue)) + ' EUR');
  setV('oppCostLost', '+' + fmt(Math.round(lost)) + ' EUR');
  setV('oppCostMultiplier', 'x' + multiplier.toFixed(1));

  // Build milestone table
  const milestones = [1, 3, 5, 10, 15, 20, 25, 30, 40].filter(y => y <= horizon);
  if (!milestones.includes(horizon)) milestones.push(horizon);
  milestones.sort((a, b) => a - b);

  let tableHTML = '<table><thead><tr><th>Annee</th><th class="num">Valeur future</th><th class="num">Manque a gagner</th><th class="num">Multiplicateur</th></tr></thead><tbody>';
  milestones.forEach(y => {
    const fv = amount * Math.pow(1 + r, y);
    const mg = fv - amount;
    const mult = fv / amount;
    const isFinal = y === horizon;
    const style = isFinal ? ' style="font-weight:700;background:#edf2f7"' : '';
    tableHTML += '<tr' + style + '><td>' + y + ' ans</td>'
      + '<td class="num" style="color:#c53030">' + fmt(Math.round(fv)) + ' EUR</td>'
      + '<td class="num" style="color:#b7791f">+' + fmt(Math.round(mg)) + ' EUR</td>'
      + '<td class="num" style="color:var(--accent)">x' + mult.toFixed(1) + '</td></tr>';
  });
  tableHTML += '</tbody></table>';

  const tableEl = document.getElementById('oppCostTable');
  if (tableEl) tableEl.innerHTML = tableHTML;

  // Insight
  const insight = 'Un achat de <strong>' + fmt(amount) + ' EUR</strong> aujourd\'hui, c\'est <strong style="color:#c53030">'
    + fmt(Math.round(futureValue)) + ' EUR</strong> de manque a gagner dans ' + horizon + ' ans '
    + '(x' + multiplier.toFixed(1) + ') avec un retour de ' + annualReturn.toFixed(1) + '%/an. '
    + 'Chaque euro depense est un euro qui ne compose plus.';
  const insightEl = document.getElementById('oppCostInsight');
  if (insightEl) insightEl.innerHTML = insight;
}

// ============ INIT SIMULATORS ============
export function initSimulators(state) {
  runCoupleSimulator(state);
  runAmineSimulator(state);
  runNezhaSimulator(state);
  runOpportunityCostSim();
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
  // Opportunity cost
  ['oppCostAmount','oppCostReturn','oppCostHorizon'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => runOpportunityCostSim());
  });
  // Vitry fiscal sim (slider already bound in runVitryFiscalSim)
}
