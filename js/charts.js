// ============================================================
// CHARTS — All Chart.js chart creation and management
// ============================================================
// See ARCHITECTURE.md §9-10 for chart breakdown system, scope
// architecture, and palette documentation.
// Each function receives STATE, never reads DOM for data.

import { fmt, fmtAxis } from './render.js?v=255';
import { getGrandTotal, computeExitCostsAtYear } from './engine.js?v=255';
import { IMMO_CONSTANTS, EQUITY_HISTORY, PORTFOLIO, FX_STATIC } from './data.js?v=255';

let charts = {};
let coupleSelectedCat = null;
let _state = null;

/**
 * Destroys all cached Chart.js chart instances
 *
 * Called before rebuildAllCharts to avoid chart duplication.
 * Preserves portfolioYTD chart (built separately by loadStockPrices) and restores it after clearing.
 *
 * Side Effects:
 *   - Clears all entries from global charts object
 *   - Calls .destroy() on each chart instance (required by Chart.js)
 */
export function destroyAllCharts() {
  const ytdChart = charts.portfolioYTD; // preserve — built separately by loadStockPrices
  Object.entries(charts).forEach(([k, c]) => {
    if (k === 'portfolioYTD') return; // don't destroy YTD chart
    try { c.destroy(); } catch(e) {}
  });
  charts = {};
  if (ytdChart) charts.portfolioYTD = ytdChart; // restore
}

const PERSON_VIEWS = ['couple', 'amine', 'nezha'];

// ============ MAIN ENTRY ============
/**
 * Main entry point for all chart rebuilding — view-specific chart orchestration
 *
 * Called by app.refresh() after compute() generates new state. Destroys old charts,
 * then builds all charts relevant to the requested view. Chart data is derived
 * entirely from state (no DOM reads except for canvas elements).
 *
 * @param {Object} state - Computed application state from engine.compute()
 * @param {string} view - Current view: 'couple'|'amine'|'nezha'|'actions'|'cash'|'immobilier'|'budget'
 *
 * Charts built per view:
 *   - All person views: coupleAlloc (drill-down donut), amineDonut, nezhaDonut, geoChart, immoEquityBar, immoProjection, nwHistoryChart, coupleTreemap
 *   - amine: amineTreemap
 *   - nezha: nezhaTreemap
 *   - actions: actionsGeoDonut, actionsSectorDonut, actionsTreemap
 *   - cash: cashYieldPotential
 *   - immobilier: immoViewEquityBar, immoViewProjection, amortChart
 *   - budget: budgetZoneDonut, budgetTypeDonut
 *
 * Side Effects:
 *   - Updates global _state variable
 *   - Calls destroyAllCharts() first
 *   - Each buildXxx function creates Chart.js instance and stores in charts object
 */
export function rebuildAllCharts(state, view) {
  _state = state;
  destroyAllCharts();
  view = view || 'couple';

  if (PERSON_VIEWS.includes(view)) {
    buildCoupleDrillDown(state);
    buildAmineDonut(state);
    buildNezhaDonut(state);
    buildGeoChart(state);
    buildImmoEquityBar(state);
    buildImmoProjection(state);
  }

  if (view === 'amine') {
    buildAmineTreemap(state);
  }
  if (view === 'nezha') {
    buildNezhaTreemap(state);
  }

  if (view === 'actions') {
    buildActionsGeoDonut(state);
    buildActionsSectorDonut(state);
    buildActionsTreemap(state);
  }
  if (view === 'cash') {
    buildCashYieldPotential(state);
  }
  if (view === 'immobilier') {
    buildImmoViewEquityBar(state);
    buildImmoViewProjection(state);
    buildAmortChart(state);
  }
  if (view === 'budget') {
    buildBudgetZoneDonut(state);
    buildBudgetTypeDonut(state);
  }

  if (PERSON_VIEWS.includes(view)) {
    buildNWHistoryChart(state);
    buildCoupleTreemap(state);
  }
}

// ============ COUPLE DRILL-DOWN DONUT ============
/**
 * Creates interactive drill-down donut chart for couple asset allocation
 *
 * Main couple view chart showing asset categories (Actions, Immobilier, Cash, Créances, etc.)
 * with the ability to click a slice to drill down and show sub-categories.
 *
 * Interactive Features:
 *   - Click a slice to drill down (show sub-items within that category)
 *   - Click same slice again to zoom out (toggle behavior)
 *   - Back button to zoom out (updates title and chart)
 *   - Title and hint text update based on selection state
 *
 * @param {Object} state - Computed state with coupleCategories array
 * @param {number} [clickedIdx] - Index of clicked slice (for drill-down). Omit or null to show parent level
 *
 * DOM Updates:
 *   - Renders into #coupleAllocChart canvas
 *   - Updates #coupleChartTitle with category name + amount + %
 *   - Shows/hides #coupleChartBack button
 *   - Updates #coupleChartHint visibility
 *
 * Side Effects:
 *   - Stores chart in charts.coupleAlloc for later destruction
 *   - Updates global coupleSelectedCat to remember selected category
 */
export function buildCoupleDrillDown(state, clickedIdx) {
  _state = state || _state;
  const s = _state;
  const el = document.getElementById('coupleAllocChart');
  if (!el) return;
  if (charts.coupleAlloc) { charts.coupleAlloc.destroy(); delete charts.coupleAlloc; }

  const CATS = s.coupleCategories;
  const grandTotal = getGrandTotal(s);
  const titleEl = document.getElementById('coupleChartTitle');
  const backBtn = document.getElementById('coupleChartBack');
  const hintEl = document.getElementById('coupleChartHint');

  // Toggle: click same slice = deselect
  if (clickedIdx !== undefined && clickedIdx !== null && clickedIdx === coupleSelectedCat) clickedIdx = null;
  coupleSelectedCat = (clickedIdx !== undefined && clickedIdx !== null) ? clickedIdx : null;

  const hasSel = coupleSelectedCat !== null;
  const selCat = hasSel ? CATS[coupleSelectedCat] : null;

  if (hasSel) {
    titleEl.textContent = selCat.label + ' \u2014 ' + fmt(selCat.total) + ' (' + (selCat.total / grandTotal * 100).toFixed(1) + '%)';
    backBtn.style.display = 'inline';
    hintEl.style.display = 'none';
  } else {
    titleEl.textContent = 'Repartition par categorie';
    backBtn.style.display = 'none';
    hintEl.style.display = '';
  }

  // Inner ring: categories
  const innerData = CATS.map(c => c.total);
  const innerColors = CATS.map((c, i) => {
    if (!hasSel) return c.color;
    return i === coupleSelectedCat ? c.color : c.color + '30';
  });

  // Outer ring: sub-items of selected category
  let outerLabels = [], outerData = [], outerColors = [], outerBorderW = [], outerBorderC = [];
  if (hasSel && selCat.sub.length > 1) {
    CATS.forEach((cat, i) => {
      if (i === coupleSelectedCat) {
        cat.sub.forEach(sub => {
          outerLabels.push(sub.label);
          outerData.push(sub.val);
          outerColors.push(sub.color);
          outerBorderW.push(2);
          outerBorderC.push('#fff');
        });
      } else {
        outerLabels.push('');
        outerData.push(cat.total);
        outerColors.push('transparent');
        outerBorderW.push(0);
        outerBorderC.push('transparent');
      }
    });
  }

  const datasets = [];
  datasets.push({
    label: 'Categories',
    data: innerData,
    backgroundColor: innerColors,
    borderWidth: 2,
    borderColor: '#fff',
    hoverBorderWidth: 3,
    weight: 1.2
  });

  if (outerData.length > 0) {
    datasets.push({
      label: 'Detail',
      data: outerData,
      backgroundColor: outerColors,
      borderWidth: outerBorderW,
      borderColor: outerBorderC,
      hoverBorderWidth: 2,
      weight: 2.5
    });
  }

  charts.coupleAlloc = new Chart(el, {
    type: 'doughnut',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '45%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { size: 11 }, padding: 8, usePointStyle: true, pointStyle: 'circle',
            generateLabels: function() {
              if (hasSel && selCat.sub.length > 1) {
                return selCat.sub.map((sub, si) => ({
                  text: sub.label + '  ' + fmt(sub.val) + ' (' + (sub.val / grandTotal * 100).toFixed(1) + '%)',
                  fillStyle: sub.color,
                  strokeStyle: '#fff',
                  lineWidth: 1,
                  hidden: false,
                  index: si
                }));
              }
              return CATS.map((c, i) => ({
                text: c.label + '  ' + fmt(c.total) + ' (' + (c.total / grandTotal * 100).toFixed(1) + '%)',
                fillStyle: c.color,
                strokeStyle: '#fff',
                lineWidth: 1,
                hidden: false,
                index: i
              }));
            }
          },
          onClick: function(evt, item) {
            if (!hasSel && item.index >= 0 && item.index < CATS.length) {
              buildCoupleDrillDown(_state, item.index);
            }
          }
        },
        tooltip: {
          filter: item => item.datasetIndex === 1 ? outerColors[item.dataIndex] !== 'transparent' : true,
          callbacks: {
            label: c => {
              const val = c.parsed;
              let lbl = c.datasetIndex === 0 ? CATS[c.dataIndex].label : (outerLabels[c.dataIndex] || '');
              return lbl + ': ' + fmt(val) + ' (' + (val / grandTotal * 100).toFixed(1) + '%)';
            }
          }
        }
      },
      onClick: function(evt, elements) {
        if (elements.length > 0 && elements[0].datasetIndex === 0) {
          buildCoupleDrillDown(_state, elements[0].index);
        } else if (elements.length === 0 && hasSel) {
          buildCoupleDrillDown(_state, null);
        }
      },
      onHover: function(evt, elements) {
        const clickable = elements.length > 0 && elements[0].datasetIndex === 0;
        evt.native.target.style.cursor = clickable ? 'pointer' : 'default';
      },
      animation: { animateRotate: true, animateScale: false, duration: 400 }
    }
  });
}

export function coupleChartZoomOut() {
  buildCoupleDrillDown(_state, null);
}

// ============ AMINE DONUT ============
function buildAmineDonut(state) {
  const s = state.amine;
  const p = state.portfolio;
  const items = [
    { label: 'IBKR (' + fmt(s.ibkr, true) + ')', val: s.ibkr, color: '#2b6cb0' },
    { label: 'ESPP (' + p.amine.espp.shares + ' ACN)', val: s.espp, color: '#3182ce' },
    { label: 'SGTM (' + p.amine.sgtm.shares + ' actions)', val: s.sgtm, color: '#ed8936' },
    { label: 'Cash UAE', val: s.uae, color: '#48bb78' },
    { label: 'Cash Maroc', val: s.moroccoCash, color: '#9ae6b4' },
    { label: 'Immo Vitry', val: s.vitryEquity, color: '#b7791f' },
    { label: 'Vehicules', val: s.vehicles, color: '#4a5568' },
    { label: 'Creances', val: s.recvPro + s.recvPersonal, color: '#cbd5e0' },
  ];
  charts.amineAlloc = new Chart(document.getElementById('amineAllocChart'), {
    type: 'doughnut',
    data: {
      labels: items.map(i => i.label),
      datasets: [{ data: items.map(i => i.val), backgroundColor: items.map(i => i.color), borderWidth: 1 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10, boxWidth: 12 } },
        tooltip: { callbacks: { label: c => c.label + ': ' + fmt(c.parsed) } } } }
  });
}

// ============ NEZHA DONUT ============
function buildNezhaDonut(state) {
  const n = state.nezha;
  charts.nezhaAlloc = new Chart(document.getElementById('nezhaAllocChart'), {
    type: 'doughnut',
    data: {
      labels: ['Equity Rueil','Equity Villejuif','Cash France','Cash Maroc (100K MAD)','SGTM (actions)','Creance Omar (40K MAD)'],
      datasets: [{ data: [n.rueilEquity, n.villejuifEquity, n.cashFrance, n.cashMaroc, n.sgtm, n.recvOmar], backgroundColor: ['#2b6cb0','#2c7a7b','#48bb78','#9ae6b4','#ed8936','#cbd5e0'], borderWidth: 1 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10, boxWidth: 12 } },
        tooltip: { callbacks: { label: c => c.label + ': ' + fmt(c.parsed) } } } }
  });
}

// ============ GEO CHART ============
function buildGeoChart(state) {
  const s = state;
  const geoIBKR = s.amine.ibkr;
  charts.geo = new Chart(document.getElementById('geoChart'), {
    type: 'doughnut',
    data: {
      labels: ['France','Crypto','Irlande/US (ACN)','Allemagne','Japon','Maroc (SGTM)'],
      datasets: [{ data: [Math.round(geoIBKR*0.53), Math.round(geoIBKR*0.21), Math.round(s.amine.espp+s.nezha.espp), Math.round(geoIBKR*0.10), Math.round(geoIBKR*0.03), Math.round(s.amine.sgtm+s.nezha.sgtm)], backgroundColor: ['#2b6cb0','#9f7aea','#48bb78','#ed8936','#e53e3e','#d69e2e'], borderWidth: 1 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10, boxWidth: 12 } },
        tooltip: { callbacks: { label: c => { const t = c.dataset.data.reduce((a,b)=>a+b,0); return c.label + ': ' + fmt(c.parsed) + ' (' + (c.parsed/t*100).toFixed(1) + '%)'; } } } } }
  });
}

// ============ IMMO EQUITY BAR ============
function buildImmoEquityBar(state) {
  const el = document.getElementById('immoEquityChart');
  if (!el) return;
  charts.immoEq = new Chart(el, {
    type: 'bar',
    data: {
      labels: ['Vitry (Amine)','Rueil (Nezha)','Villejuif (Nezha)'],
      datasets: [{ label: 'Equity', data: [state.amine.vitryEquity, state.nezha.rueilEquity, state.nezha.villejuifEquity], backgroundColor: ['#4c6ef5','#12b886','#f59f00'], borderRadius: 4 }]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, title: { display: true, text: 'Equity par bien', font: { size: 14 } },
        tooltip: { callbacks: { label: c => fmt(c.parsed.x) } } },
      scales: { x: { ticks: { callback: v => fmtAxis(v) } } } }
  });
}

// ============ IMMO PROJECTION ============
function buildImmoProjection(state) {
  const el = document.getElementById('immoProjectionChart');
  if (!el) return;
  if (charts.immoProj) { charts.immoProj.destroy(); delete charts.immoProj; }

  // Dynamic projection from current property values + appreciation rates
  const iv = state.immoView;
  if (!iv || !iv.amortSchedules) return;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const projYears = [];
  for (let y = currentYear + 1; y <= currentYear + 7; y++) projYears.push(y);

  const includeVillejuif = typeof window._immoIncludeVillejuif === 'function' ? window._immoIncludeVillejuif() : true;
  const loanKeys = includeVillejuif ? ['vitry', 'rueil', 'villejuif'] : ['vitry', 'rueil'];
  const loanColors = { vitry: '#4c6ef5', rueil: '#12b886', villejuif: '#f59f00' };
  const loanNames = { vitry: 'Vitry', rueil: 'Rueil', villejuif: 'Villejuif' };

  const datasets = loanKeys.map(key => {
    const amort = iv.amortSchedules[key];
    if (!amort) return null;
    const prop = iv.properties.find(p => p.loanKey === key);
    if (!prop) return null;

    const sched = amort.schedule;
    const [startY, startM] = sched[0].date.split('-').map(Number);
    const propMeta = IMMO_CONSTANTS.properties[key] || {};
    const phases = propMeta.appreciationPhases || [];
    const defaultRate = propMeta.appreciation || 0.01;

    // Get appreciation rate for a given year using phases
    function getRate(year) {
      for (let i = 0; i < phases.length; i++) {
        if (year >= phases[i].start && year <= phases[i].end) return phases[i].rate;
      }
      return defaultRate;
    }

    const data = projYears.map(year => {
      const monthsFromStart = (year - startY) * 12 + (1 - startM);
      if (monthsFromStart < 0) return 0;
      const schedIdx = Math.min(monthsFromStart, sched.length - 1);
      const crd = schedIdx >= sched.length ? 0 : sched[schedIdx].remainingCRD;

      // Compound appreciation year-by-year using phased rates
      let projValue = prop.value;
      for (let y = currentYear; y < year; y++) {
        projValue *= (1 + getRate(y));
      }

      return Math.max(0, Math.round(projValue - crd));
    });

    return {
      label: loanNames[key], data,
      borderColor: loanColors[key], backgroundColor: loanColors[key] + '1a',
      fill: true, tension: 0.3,
    };
  }).filter(Boolean);

  charts.immoProj = new Chart(el, {
    type: 'line',
    data: { labels: projYears.map(String), datasets },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'Projection equity (appréc. par phases)', font: { size: 14 } },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmt(c.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtAxis(v) } } } }
  });
}

// ============ CF PROJECTION 10 ANS ============
/**
 * Creates 10-year cash flow projection chart for real estate properties
 *
 * Displays stacked line chart of monthly net cash flow (loyers - charges) projected over 10 years.
 * Accounts for rent growth, loan amortization, and property-specific schedules (e.g., Villejuif start 2028).
 *
 * Projection Features:
 *   - Base rent 2026: Vitry 1200€, Rueil 1300€, Villejuif 1700€
 *   - Annual rent growth: 1.5% after year 1
 *   - Loan payment phases: principal + interest deduction (LMNP)
 *   - Per-property breakdown (Vitry, Rueil, Villejuif) + total
 *   - Conditional Villejuif (respects user toggle: window._immoIncludeVillejuif())
 *
 * @param {Object} state - Computed state (used to determine Villejuif activation status)
 *
 * DOM Updates:
 *   - Renders into #cfProjChart canvas
 *   - Shows per-property monthly CF in line chart with color coding
 *   - Tooltip shows formatted currency values
 *   - Y-axis shows compact currency (fmtAxis)
 *
 * Side Effects:
 *   - Destroys previous charts.cfProj instance
 *   - Stores new chart in charts.cfProj
 *   - Uses window._immoIncludeVillejuif() to determine if Villejuif is included
 */
export function buildCFProjection(state) {
  if (charts.cfProj) { charts.cfProj.destroy(); delete charts.cfProj; }
  const includeVillejuif = typeof window._immoIncludeVillejuif === 'function' ? window._immoIncludeVillejuif() : true;

  const YEARS = 10;
  const START_YEAR = 2026;
  const RENT_GROWTH = 0.015;
  const IC = IMMO_CONSTANTS;

  const labels = [];
  const vitryData = [], rueilData = [], villejuifData = [], totalData = [];

  let vitryLoyer = 1200, vitryParking = 70;
  let rueilLoyer = 1300;
  let villejuifLoyer = 1700;

  for (let i = 0; i < YEARS; i++) {
    const year = START_YEAR + i;
    labels.push(String(year));

    if (year === 2027) vitryLoyer = 1400;
    if (year > 2027) vitryLoyer *= (1 + RENT_GROWTH);
    if (year > 2026) rueilLoyer *= (1 + RENT_GROWTH);
    if (year > 2030) villejuifLoyer *= (1 + RENT_GROWTH);

    // Vitry CF
    const vitryRev = vitryLoyer + vitryParking;
    let vitryCharges = IC.charges.vitry.pno + IC.charges.vitry.tf + IC.charges.vitry.copro;
    if (year < IC.prets.vitryEnd) vitryCharges += IC.charges.vitry.pret + IC.charges.vitry.assurance;
    const vitryCF = Math.round(vitryRev - vitryCharges);

    // Rueil CF
    const rueilRev = rueilLoyer;
    let rueilCharges = IC.charges.rueil.pno + IC.charges.rueil.tf + IC.charges.rueil.copro;
    if (year < IC.prets.rueilEnd) rueilCharges += IC.charges.rueil.pret + IC.charges.rueil.assurance;
    const rueilCF = Math.round(rueilRev - rueilCharges);

    // Villejuif CF
    let villejuifCF = 0;
    if (year >= 2030) {
      const vjRev = villejuifLoyer;
      let vjCharges = IC.charges.villejuif.pno + IC.charges.villejuif.tf + IC.charges.villejuif.copro;
      if (year < IC.prets.villejuifEnd) vjCharges += IC.charges.villejuif.pret + IC.charges.villejuif.assurance;
      villejuifCF = Math.round(vjRev - vjCharges);
    }

    vitryData.push(vitryCF);
    rueilData.push(rueilCF);
    villejuifData.push(includeVillejuif ? villejuifCF : 0);
    totalData.push(vitryCF + rueilCF + (includeVillejuif ? villejuifCF : 0));
  }

  // Build chart
  const ctx = document.getElementById('cfProjectionChart');
  if (!ctx) return;
  const zeroLine = new Array(YEARS).fill(0);

  charts.cfProj = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Equilibre (0)', data: zeroLine, borderColor: '#dee2e6', borderWidth: 1, borderDash: [4,4], pointRadius: 0, pointHoverRadius: 0, fill: false },
        { label: 'Vitry', data: vitryData, borderColor: '#4c6ef5', fill: false, tension: 0.3, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#4c6ef5' },
        { label: 'Rueil', data: rueilData, borderColor: '#12b886', fill: false, tension: 0.3, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#12b886' },
        ...(includeVillejuif ? [{ label: 'Villejuif', data: villejuifData, borderColor: '#f59f00', fill: false, tension: 0.3, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#f59f00' }] : []),
        { label: includeVillejuif ? 'Total 3 biens' : 'Total 2 biens', data: totalData, borderColor: '#1a1a2e', backgroundColor: 'rgba(76, 110, 245, 0.08)', fill: true, tension: 0.3, borderWidth: 3, pointRadius: 3, pointBackgroundColor: '#1a1a2e' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Projection Cash Flow mensuel \u2014 10 ans', font: { size: 14 } },
        legend: { labels: { filter: item => item.text !== 'Equilibre (0)', font: { size: 11 } } },
        tooltip: {
          filter: item => item.dataset.label !== 'Equilibre (0)',
          callbacks: { label: c => c.dataset.label + ': ' + (c.parsed.y >= 0 ? '+' : '') + c.parsed.y + '/mois' }
        }
      },
      scales: {
        y: {
          title: { display: true, text: 'CF mensuel (EUR)', font: { size: 11 } },
          ticks: { callback: v => (v >= 0 ? '+' : '') + v }
        }
      }
    }
  });

  // Build table
  const tbody = document.getElementById('cfProjectionBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (let i = 0; i < YEARS; i++) {
    const year = START_YEAR + i;
    const tr = document.createElement('tr');
    const isKey = year === 2027 || year === 2030;
    if (isKey) tr.style.background = '#fffbeb';
    let note = year === 2027 ? ' *' : year === 2030 ? ' **' : '';
    const cfClass = v => v >= 0 ? 'num pos' : 'num neg';
    const cfFmt = v => (v >= 0 ? '+' : '') + v.toLocaleString('fr-FR');
    tr.innerHTML = '<td><strong>' + year + '</strong>' + note + '</td>'
      + '<td class="' + cfClass(vitryData[i]) + '">' + cfFmt(vitryData[i]) + '</td>'
      + '<td class="' + cfClass(rueilData[i]) + '">' + cfFmt(rueilData[i]) + '</td>'
      + '<td class="' + cfClass(villejuifData[i]) + '">' + (year < 2030 ? '<span style="color:var(--gray)">\u2014</span>' : cfFmt(villejuifData[i])) + '</td>'
      + '<td class="' + cfClass(totalData[i]) + '" style="font-weight:700;background:#f0fff4">' + cfFmt(totalData[i]) + '</td>';
    tbody.appendChild(tr);
  }
  const fn = document.createElement('tr');
  fn.innerHTML = '<td colspan="5" style="font-size:10px;color:var(--gray);padding-top:8px">* Augmentation loyer Vitry a 1,400. ** Debut remboursement + loyer Villejuif (loyers pre-2030 absorbent les travaux).</td>';
  tbody.appendChild(fn);
}

// ============ ACTIONS GEO DONUT ============
function buildActionsGeoDonut(state) {
  const el = document.getElementById('actionsGeoChart');
  if (!el) return;
  const geo = state.actionsView.geoAllocation;
  const labels = { france: 'France', crypto: 'Crypto', us: 'US/Irlande', germany: 'Allemagne', japan: 'Japon', morocco: 'Maroc' };
  const colors = { france: '#2b6cb0', crypto: '#9f7aea', us: '#48bb78', germany: '#ed8936', japan: '#e53e3e', morocco: '#d69e2e' };
  const entries = Object.entries(geo).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]);
  const total = entries.reduce((s,[,v]) => s + v, 0);

  charts.actionsGeo = new Chart(el, {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => labels[k] || k),
      datasets: [{ data: entries.map(([,v]) => v), backgroundColor: entries.map(([k]) => colors[k] || '#a0aec0'), borderWidth: 1 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 6 } },
        tooltip: { callbacks: { label: c => c.label + ': ' + fmt(c.parsed) + ' (' + (c.parsed/total*100).toFixed(1) + '%)' } } } }
  });
}

// ============ ACTIONS SECTOR DONUT ============
function buildActionsSectorDonut(state) {
  const el = document.getElementById('actionsSectorChart');
  if (!el) return;
  const sec = state.actionsView.sectorAllocation;
  const labels = { luxury: 'Luxe', industrials: 'Industrie', tech: 'Tech', crypto: 'Crypto', consumer: 'Conso', healthcare: 'Sant\u00e9', automotive: 'Auto' };
  const colors = { luxury: '#9f7aea', industrials: '#2b6cb0', tech: '#48bb78', crypto: '#ed8936', consumer: '#e53e3e', healthcare: '#38a169', automotive: '#4a5568' };
  const entries = Object.entries(sec).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]);
  const total = entries.reduce((s,[,v]) => s + v, 0);

  charts.actionsSector = new Chart(el, {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => labels[k] || k),
      datasets: [{ data: entries.map(([,v]) => v), backgroundColor: entries.map(([k]) => colors[k] || '#a0aec0'), borderWidth: 1 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 6 } },
        tooltip: { callbacks: { label: c => c.label + ': ' + fmt(c.parsed) + ' (' + (c.parsed/total*100).toFixed(1) + '%)' } } } }
  });
}

// ============ CASH YIELD GAP — MANQUE A GAGNER ============
function buildCashYieldPotential(state) {
  const el = document.getElementById('cashCurrencyChart');
  if (!el) return;
  el.style.display = 'none';
  const parent = el.parentElement;
  const prev = parent.querySelector('.yield-potential');
  if (prev) prev.remove();

  const TARGET = 0.06;
  const cv = state.cashView;
  if (!cv || !cv.accounts) return;

  // For each person, find accounts below 6% and compute the gap
  function computeGap(ownerFilter) {
    const accts = cv.accounts.filter(ownerFilter);
    let subOptimalCash = 0, currentYieldOnSubOptimal = 0;
    accts.forEach(a => {
      const y = a.yield || 0;
      const bal = a.valEUR || 0;
      if (y < TARGET && bal > 0) {
        subOptimalCash += bal;
        currentYieldOnSubOptimal += bal * y;
      }
    });
    const potentialYield = subOptimalCash * TARGET;
    const gap = potentialYield - currentYieldOnSubOptimal;
    return { subOptimalCash, currentYieldOnSubOptimal, potentialYield, gap };
  }

  const rows = [
    { name: 'Couple', ...computeGap(() => true), color: '#2b6cb0' },
    { name: 'Amine', ...computeGap(a => a.owner === 'Amine'), color: '#48bb78' },
    { name: 'Nezha', ...computeGap(a => a.owner === 'Nezha'), color: '#ed8936' },
  ];

  let html = '<div class="yield-potential" style="padding:4px 0;">';
  // Filter to only rows with gap > 0
  const activeRows = rows.filter(r => r.gap > 0);

  if (activeRows.length === 0) {
    // No gaps, don't show anything
    return;
  }

  html += '<div style="font-size:13px;font-weight:600;color:#92400e;margin-bottom:6px;">Manque à gagner (cash &lt;6%)</div>';
  html += '<div style="display:flex;gap:12px;font-size:12px;">';

  activeRows.forEach(r => {
    const daily = r.gap / 365;
    const annual = r.gap;
    html += '<div style="flex:1;text-align:center;padding:8px;background:#fffbeb;border-radius:6px;">';
    html += '<div style="font-size:11px;color:#78716c;">' + r.name + '</div>';
    html += '<div style="font-size:16px;font-weight:700;color:#92400e;">-' + fmt(Math.round(daily)) + '/jour</div>';
    html += '<div style="font-size:10px;color:#a0aec0;">' + fmt(Math.round(r.subOptimalCash), true) + ' sous 6% | -' + fmt(Math.round(annual)) + '/an</div>';
    html += '</div>';
  });

  html += '</div>';
  html += '</div>';
  parent.insertAdjacentHTML('beforeend', html);
}

// ============ IMMO VIEW EQUITY BAR ============
function buildImmoViewEquityBar(state) {
  const el = document.getElementById('immoViewEquityChart');
  if (!el) return;
  if (charts.immoViewEq) { charts.immoViewEq.destroy(); delete charts.immoViewEq; }
  const includeVillejuif = typeof window._immoIncludeVillejuif === 'function' ? window._immoIncludeVillejuif() : true;
  const props = includeVillejuif ? state.immoView.properties : state.immoView.properties.filter(p => p.loanKey !== 'villejuif');
  charts.immoViewEq = new Chart(el, {
    type: 'bar',
    data: {
      labels: props.map(p => p.name + ' (' + p.owner + ')'),
      datasets: [{ label: 'Equity', data: props.map(p => p.equity), backgroundColor: ['#4c6ef5','#12b886','#f59f00'], borderRadius: 4 }]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, title: { display: true, text: 'Equity par bien', font: { size: 14 } },
        tooltip: { callbacks: { label: c => fmt(c.parsed.x) } } },
      scales: { x: { ticks: { callback: v => fmtAxis(v) } } } }
  });
}

// ============ NW HISTORY LINE CHART ============
function buildNWHistoryChart(state) {
  const el = document.getElementById('nwHistoryChart');
  if (!el) return;
  if (charts.nwHistory) { charts.nwHistory.destroy(); delete charts.nwHistory; }

  const history = state.nwHistory;
  if (!history || history.length === 0) return;

  const labels = history.map(h => {
    const [y, m] = h.date.split('-');
    const months = ['Jan','Fev','Mar','Avr','Mai','Jun','Jul','Aou','Sep','Oct','Nov','Dec'];
    return months[parseInt(m) - 1] + ' ' + y;
  });

  const annotations = history.filter(h => h.note).map(h => {
    const idx = history.indexOf(h);
    return { idx, note: h.note };
  });

  charts.nwHistory = new Chart(el, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Couple', data: history.map(h => h.coupleNW), borderColor: '#48bb78', backgroundColor: 'rgba(72,187,120,0.1)', fill: true, tension: 0.3, borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#48bb78' },
        { label: 'Amine', data: history.map(h => h.amineNW), borderColor: '#2b6cb0', fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3, borderDash: [5, 3] },
        { label: 'Nezha', data: history.map(h => h.nezhaNW), borderColor: '#d69e2e', fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3, borderDash: [5, 3] },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Evolution du Net Worth', font: { size: 14 } },
        legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 8 } },
        tooltip: {
          callbacks: {
            label: c => {
              const val = c.parsed.y;
              const prev = c.dataIndex > 0 ? c.dataset.data[c.dataIndex - 1] : null;
              let pctChange = '';
              if (prev && prev > 0) {
                const pct = ((val - prev) / prev * 100).toFixed(1);
                pctChange = ' (' + (val > prev ? '+' : '') + pct + '%)';
              }
              return c.dataset.label + ': ' + fmt(val) + pctChange;
            },
            afterBody: (items) => {
              const idx = items[0]?.dataIndex;
              const h = history[idx];
              return h && h.note ? [h.note] : [];
            }
          }
        }
      },
      scales: {
        y: { ticks: { callback: v => fmtAxis(v) } }
      }
    }
  });
}

// ============ GENERIC TREEMAP BUILDER ============
function buildGenericTreemap(canvasId, chartKey, CATS, grandTotal, tooltipLabel) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  if (charts[chartKey]) { charts[chartKey].destroy(); delete charts[chartKey]; }
  if (!CATS || CATS.length === 0) return;

  const catTotals = {};
  CATS.forEach(cat => { catTotals[cat.label] = cat.total; });

  const treeData = [];
  CATS.forEach(cat => {
    cat.sub.forEach(sub => {
      if (sub.val > 0) {
        treeData.push({
          label: sub.label, category: cat.label,
          value: sub.val, color: sub.color,
          catTotal: cat.total, owner: sub.owner || '',
        });
      }
    });
  });

  const colorMap = {};
  treeData.forEach(d => { colorMap[d.label] = d.color; });

  const isCategoryHeader = (d) => d && d.path && !d.path.includes('.');
  const pctLabel = tooltipLabel || 'du patrimoine';

  charts[chartKey] = new Chart(el, {
    type: 'treemap',
    data: {
      datasets: [{
        tree: treeData, key: 'value',
        groups: ['category', 'label'],
        borderWidth: 2, borderColor: '#ffffff', spacing: 1,
        backgroundColor: function(ctx) {
          if (ctx.type !== 'data') return 'transparent';
          if (!ctx.raw || !ctx.raw._data) return '#e2e8f0';
          const d = ctx.raw._data;
          if (isCategoryHeader(d)) {
            const cat = CATS.find(c => c.label === d.label);
            return (cat ? cat.color : '#6b7280') + '18';
          }
          const leafColor = (d.children && d.children[0]?.color) || colorMap[d.label] || d.color;
          return leafColor || '#94a3b8';
        },
        labels: {
          display: true, align: 'center', position: 'middle',
          overflow: 'hidden', padding: 3,
          color: function(ctx) {
            if (!ctx.raw || !ctx.raw._data) return '#333';
            const d = ctx.raw._data;
            if (isCategoryHeader(d)) return '#1a202c';
            return '#ffffff';
          },
          font: function(ctx) {
            const w = ctx.raw?.w || 100; const h = ctx.raw?.h || 50;
            const area = w * h; const d = ctx.raw?._data;
            if (isCategoryHeader(d)) return [{ size: Math.min(15, Math.max(10, w / 8)), weight: 'bold' }];
            if (area > 6000) return [{ size: 14, weight: 'bold' }, { size: 11, weight: 'normal' }];
            if (area > 3000) return [{ size: 12, weight: 'bold' }, { size: 10, weight: 'normal' }];
            if (area > 1500) return [{ size: 10, weight: 'bold' }];
            return [{ size: 8, weight: 'bold' }];
          },
          formatter: function(ctx) {
            if (!ctx || !ctx.raw) return '';
            const v = ctx.raw.v || 0;
            if (v < 200) return '';
            const d = ctx.raw._data || {};
            const label = d.label || ctx.raw.g || '';
            const w = ctx.raw.w || 0; const h = ctx.raw.h || 0;
            const area = w * h;
            if (isCategoryHeader(d)) return label;
            if (area < 1200) return ''; // Hide all labels on segments < 1200px²
            if (area < 1500) return label.length > 6 ? label.substring(0, 5) + '.' : label;
            if (area < 3000) {
              if (w < 80 && label.length > 8) return label.substring(0, 7) + '.';
              return label;
            }
            const valK = v >= 1000 ? '\u20ac' + (v / 1000).toFixed(0) + 'K' : '\u20ac' + Math.round(v);
            let displayLabel = label;
            if (w < 100 && label.length > 12) displayLabel = label.substring(0, 10) + '..';
            return [displayLabel, valK];
          }
        }
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        title: { display: false }, legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.95)',
          titleFont: { size: 14, weight: 'bold' },
          bodyFont: { size: 13 }, padding: 14,
          cornerRadius: 8, displayColors: false,
          callbacks: {
            title: items => {
              const leaf = items.find(i => i.raw?._data?.path?.includes('.'));
              if (leaf) return leaf.raw._data.label || '';
              const d = items[0]?.raw?._data;
              return d?.label || '';
            },
            beforeBody: items => {
              const leaf = items.find(i => i.raw?._data?.path?.includes('.'));
              if (!leaf) {
                const v = items[0]?.raw?.v || 0;
                const pctNW = (v / grandTotal * 100).toFixed(1);
                return [fmt(v) + ' \u2014 ' + pctNW + '% ' + pctLabel];
              }
              const v = leaf.raw.v || 0;
              const d = leaf.raw._data;
              const child = d.children && d.children[0];
              const owner = (child && child.owner) || '';
              const category = (child && child.category) || '';
              const catTot = (child && child.catTotal) || catTotals[category] || 0;
              const pctNW = (v / grandTotal * 100).toFixed(1);
              const lines = [];
              if (owner) { lines.push(owner + ' \u2014 ' + fmt(v)); }
              else { lines.push(fmt(v)); }
              lines.push(pctNW + '% ' + pctLabel);
              if (catTot > 0) {
                const pctCat = (v / catTot * 100).toFixed(1);
                lines.push(pctCat + '% de \u00ab ' + category + ' \u00bb');
              }
              return lines;
            },
            label: () => null
          }
        }
      }
    }
  });
}

// ============ TREEMAP WRAPPERS ============
function buildCoupleTreemap(state) {
  buildGenericTreemap('coupleTreemap', 'coupleTreemap', state.coupleCategories, getGrandTotal(state), 'du patrimoine');
}
function buildAmineTreemap(state) {
  // Use totalAssets (positive only) for percentage base
  const total = state.amineCategories.reduce((s, c) => s + c.total, 0);
  buildGenericTreemap('amineTreemap', 'amineTreemap', state.amineCategories, total, 'du NW Amine');
}
function buildNezhaTreemap(state) {
  const total = state.nezhaCategories.reduce((s, c) => s + c.total, 0);
  buildGenericTreemap('nezhaTreemap', 'nezhaTreemap', state.nezhaCategories, total, 'du NW Nezha');
}
function buildActionsTreemap(state) {
  const total = state.actionsCategories.reduce((s, c) => s + c.total, 0);
  buildGenericTreemap('actionsTreemap', 'actionsTreemap', state.actionsCategories, total, 'du portefeuille');
}

// ============ AMORTIZATION CHART ============
function buildAmortChart(state) {
  const el = document.getElementById('amortChart');
  if (!el) return;
  if (charts.amortChart) { charts.amortChart.destroy(); delete charts.amortChart; }

  const iv = state.immoView;
  if (!iv || !iv.amortSchedules) return;

  // Build line chart: show CRD evolution over time for each loan, aligned by calendar date
  const schedules = iv.amortSchedules;
  const loanColors = { vitry: '#4c6ef5', rueil: '#12b886', villejuif: '#f59f00' };
  const loanNames = { vitry: 'Vitry', rueil: 'Rueil', villejuif: 'Villejuif' };

  // Filter loan keys based on Villejuif toggle
  const includeVillejuif = typeof window._immoIncludeVillejuif === 'function' ? window._immoIncludeVillejuif() : true;
  const loanKeys = includeVillejuif ? ['vitry', 'rueil', 'villejuif'] : ['vitry', 'rueil'];

  // Build date-indexed lookup for each loan
  const dateMaps = {};
  const allDates = new Set();
  for (const key of loanKeys) {
    const amort = schedules[key];
    if (!amort) continue;
    dateMaps[key] = {};
    // Add initial CRD at start date (month 0 = full principal)
    const s0 = amort.schedule[0];
    if (s0) {
      const [sy, sm] = s0.date.split('-').map(Number);
      const prevM = sm === 1 ? 12 : sm - 1;
      const prevY = sm === 1 ? sy - 1 : sy;
      const startKey = prevY + '-' + String(prevM).padStart(2, '0');
      dateMaps[key][startKey] = amort.schedule[0].remainingCRD + amort.schedule[0].principal;
    }
    for (const row of amort.schedule) {
      dateMaps[key][row.date] = row.remainingCRD;
      allDates.add(row.date);
    }
  }

  // Sort all dates chronologically and sample yearly
  const sortedDates = [...allDates].sort();
  const labels = [];
  const datasets = {};
  for (const key of loanKeys) { datasets[key] = []; }

  // Sample every 12 entries for readability
  const step = 12;
  for (let i = 0; i < sortedDates.length; i += step) {
    const d = sortedDates[i];
    labels.push(d);
    for (const key of loanKeys) {
      const dmap = dateMaps[key];
      if (!dmap) continue;
      if (dmap[d] !== undefined) {
        datasets[key].push(Math.round(dmap[d]));
      } else {
        // Before loan starts → null (no line), after loan ends → 0
        const loanDates = Object.keys(dmap).sort();
        if (d < loanDates[0]) {
          datasets[key].push(null);
        } else {
          datasets[key].push(0);
        }
      }
    }
  }

  const chartDatasets = loanKeys.map(key => ({
    label: loanNames[key] || key,
    data: datasets[key],
    borderColor: loanColors[key] || '#a0aec0',
    backgroundColor: (loanColors[key] || '#a0aec0') + '20',
    fill: true,
    tension: 0.3,
    borderWidth: 2,
    pointRadius: 2,
    spanGaps: false,
  }));

  charts.amortChart = new Chart(el, {
    type: 'line',
    data: { labels, datasets: chartDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Evolution CRD par pret', font: { size: 14 } },
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: c => c.dataset.label + ': ' + fmt(c.parsed.y)
          }
        }
      },
      scales: {
        y: {
          stacked: false,
          ticks: { callback: v => fmtAxis(v) },
          title: { display: true, text: 'CRD (EUR)', font: { size: 11 } }
        }
      }
    }
  });
}

// ============ IMMO VIEW PROJECTION ============
function buildImmoViewProjection(state) {
  const el = document.getElementById('immoViewProjectionChart');
  if (!el) return;
  if (charts.immoViewProj) { charts.immoViewProj.destroy(); delete charts.immoViewProj; }

  const iv = state.immoView;
  if (!iv || !iv.amortSchedules) return;

  // Dynamic projection: compute equity for each property from 2027-2032
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-based
  const projYears = [2027, 2028, 2029, 2030, 2031, 2032];
  const includeVillejuif = typeof window._immoIncludeVillejuif === 'function' ? window._immoIncludeVillejuif() : true;
  const loanKeys = includeVillejuif ? ['vitry', 'rueil', 'villejuif'] : ['vitry', 'rueil'];
  const loanColors = { vitry: '#4c6ef5', rueil: '#12b886', villejuif: '#f59f00' };
  const loanNames = { vitry: 'Vitry', rueil: 'Rueil', villejuif: 'Villejuif' };

  const datasets = loanKeys.map(key => {
    const amort = iv.amortSchedules[key];
    if (!amort) return null;
    const prop = iv.properties.find(p => p.loanKey === key);
    if (!prop) return null;

    const sched = amort.schedule;
    const [startY, startM] = sched[0].date.split('-').map(Number);
    const propMeta = IMMO_CONSTANTS.properties[key] || {};
    const phases = propMeta.appreciationPhases || [];
    const defaultRate = propMeta.appreciation || 0.01;

    // Get appreciation rate for a given year using phases
    function getRate(year) {
      for (let i = 0; i < phases.length; i++) {
        if (year >= phases[i].start && year <= phases[i].end) return phases[i].rate;
      }
      return defaultRate;
    }

    const purchasePrice = propMeta.purchasePrice || prop.purchasePrice || 0;
    // Estimate total amortissements at each year (LMNP: ~2% of 80% of value per year)
    const amortPerYear = (purchasePrice * 0.80 * 0.02);

    const dataBrute = projYears.map(year => {
      const monthsFromStart = (year - startY) * 12 + (1 - startM);
      if (monthsFromStart < 0) return 0;
      const schedIdx = Math.min(monthsFromStart, sched.length - 1);
      const crd = schedIdx >= sched.length ? 0 : sched[schedIdx].remainingCRD;

      // Compound appreciation year-by-year using phased rates
      let projValue = prop.value;
      for (let y = currentYear; y < year; y++) {
        projValue *= (1 + getRate(y));
      }

      const equity = projValue - crd;
      return { equity: Math.max(0, Math.round(equity)), projValue, crd };
    });

    const dataNet = projYears.map((year, i) => {
      const { projValue, crd } = dataBrute[i];
      const pDate = propMeta.purchaseDate || '2023-01';
      const [pY2] = pDate.split('-').map(Number);
      const yearsHeld = year - pY2;
      const totalAmort = amortPerYear * yearsHeld;
      try {
        const exitCosts = computeExitCostsAtYear(key, year, projValue, purchasePrice, crd, totalAmort);
        return Math.max(0, Math.round(exitCosts.netEquityAfterExit));
      } catch (e) {
        return dataBrute[i].equity;
      }
    });

    return {
      label: loanNames[key] + ' (net)',
      data: dataNet,
      borderColor: loanColors[key],
      backgroundColor: loanColors[key] + '1a',
      fill: true,
      tension: 0.3,
    };
  }).filter(Boolean);

  charts.immoViewProj = new Chart(el, {
    type: 'line',
    data: { labels: projYears.map(String), datasets },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'Projection equity nette (après frais de sortie)', font: { size: 14 } },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmt(c.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtAxis(v) } } } }
  });
}

// ============ PROPERTY DETAIL CHARTS ============
export function buildPropertyDetailCharts(state, prop) {
  const iv = state.immoView;
  if (!iv || !iv.amortSchedules) return;

  // Destroy previous detail charts
  if (charts.propDetailEquity) { charts.propDetailEquity.destroy(); delete charts.propDetailEquity; }
  if (charts.propDetailAmort) { charts.propDetailAmort.destroy(); delete charts.propDetailAmort; }

  const amort = iv.amortSchedules[prop.loanKey];
  if (!amort) return;
  const sched = amort.schedule;

  // ── Chart 1: Equity Projection ──
  const eqEl = document.getElementById('propDetailEquityChart');
  if (eqEl) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const propMeta = prop.propertyMeta || {};
    const phases = propMeta.appreciationPhases || [];
    const defaultRate = propMeta.appreciation || 0.01;
    const [startY, startM] = sched[0].date.split('-').map(Number);

    function getRate(year) {
      for (let i = 0; i < phases.length; i++) {
        if (year >= phases[i].start && year <= phases[i].end) return phases[i].rate;
      }
      return defaultRate;
    }

    const projYears = [];
    for (let y = currentYear; y <= currentYear + 8; y++) projYears.push(y);

    const purchasePrice = propMeta.purchasePrice || prop.purchasePrice || 0;
    const amortPerYear = (purchasePrice * 0.80 * 0.02);

    const rawData = projYears.map(year => {
      const monthsFromStart = (year - startY) * 12 + (1 - startM);
      const schedIdx = monthsFromStart < 0 ? -1 : Math.min(monthsFromStart, sched.length - 1);
      const crd = schedIdx < 0 || schedIdx >= sched.length ? 0 : sched[schedIdx].remainingCRD;
      let projValue = prop.value;
      for (let y = currentYear; y < year; y++) projValue *= (1 + getRate(y));
      return { projValue, crd, equityBrute: Math.max(0, Math.round(projValue - crd)) };
    });

    const equityBruteData = rawData.map(d => d.equityBrute);

    const equityNetData = projYears.map((year, i) => {
      const { projValue, crd } = rawData[i];
      const pDate = propMeta.purchaseDate || '2023-01';
      const [pY2] = pDate.split('-').map(Number);
      const yearsHeld = year - pY2;
      const totalAmort = amortPerYear * yearsHeld;
      try {
        const exitCosts = computeExitCostsAtYear(prop.loanKey, year, projValue, purchasePrice, crd, totalAmort);
        return Math.max(0, Math.round(exitCosts.netEquityAfterExit));
      } catch (e) {
        return rawData[i].equityBrute;
      }
    });

    const valueData = rawData.map(d => Math.round(d.projValue));
    const crdData = rawData.map(d => Math.round(d.crd));

    charts.propDetailEquity = new Chart(eqEl, {
      type: 'line',
      data: {
        labels: projYears.map(String),
        datasets: [
          { label: 'Equity nette', data: equityNetData, borderColor: '#276749', backgroundColor: '#276749' + '1a', fill: true, tension: 0.3, borderWidth: 2 },
          { label: 'Equity brute', data: equityBruteData, borderColor: '#276749', borderDash: [5, 5], tension: 0.3, pointRadius: 2, borderWidth: 1 },
          { label: 'Valeur', data: valueData, borderColor: '#2b6cb0', borderDash: [5, 5], tension: 0.3, pointRadius: 2 },
          { label: 'CRD', data: crdData, borderColor: '#c53030', borderDash: [3, 3], tension: 0.3, pointRadius: 2 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { title: { display: true, text: 'Projection equity (nette après frais de sortie) — ' + prop.name, font: { size: 13 } },
          tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmt(c.parsed.y) } } },
        scales: { y: { ticks: { callback: v => fmtAxis(v) } } }
      }
    });
  }

  // ── Chart 2: Amortization breakdown (capital vs interest per year) ──
  const amEl = document.getElementById('propDetailAmortChart');
  if (amEl) {
    // Aggregate capital and interest by year
    const yearlyData = {};
    for (const row of sched) {
      const year = row.date.split('-')[0];
      if (!yearlyData[year]) yearlyData[year] = { capital: 0, interest: 0 };
      yearlyData[year].capital += row.principal;
      yearlyData[year].interest += row.interest;
    }
    const years = Object.keys(yearlyData).sort();
    // Show a reasonable range (skip past years if many)
    const now = new Date().getFullYear();
    const displayYears = years.filter(y => parseInt(y) >= now - 1);
    const limitedYears = displayYears.slice(0, 12);

    charts.propDetailAmort = new Chart(amEl, {
      type: 'bar',
      data: {
        labels: limitedYears,
        datasets: [
          { label: 'Capital', data: limitedYears.map(y => Math.round(yearlyData[y].capital)), backgroundColor: '#276749' },
          { label: 'Intérêts', data: limitedYears.map(y => Math.round(yearlyData[y].interest)), backgroundColor: '#e53e3e' },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { title: { display: true, text: 'Amortissement — Capital vs Intérêts', font: { size: 13 } },
          tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmt(c.parsed.y) } } },
        scales: {
          x: { stacked: true },
          y: { stacked: true, ticks: { callback: v => fmtAxis(v) } }
        }
      }
    });
  }
}
// ============ EXIT PROJECTION CHART (per apartment) ============
export function buildExitProjectionChart(state, prop, canvasId) {
  const targetId = canvasId || 'exitProjectionChart';
  const el = document.getElementById(targetId);
  if (!el) return;
  if (charts.exitProjection) { charts.exitProjection.destroy(); delete charts.exitProjection; }

  const iv = state.immoView;
  if (!iv || !iv.amortSchedules) return;
  const amort = iv.amortSchedules[prop.loanKey];
  if (!amort) return;

  const IC = IMMO_CONSTANTS;
  const propMeta = prop.propertyMeta || {};
  const purchasePrice = prop.purchasePrice || propMeta.purchasePrice || propMeta.totalOperation || prop.value;
  const phases = propMeta.appreciationPhases || [];
  const defaultRate = propMeta.appreciation || 0.01;
  const sched = amort.schedule;
  const [startY, startM] = sched[0].date.split('-').map(Number);
  const now = new Date();
  const currentYear = now.getFullYear();
  const fiscConfig = IC.fiscalite && IC.fiscalite[prop.loanKey];
  const fiscType = fiscConfig ? fiscConfig.type : 'nu';
  const amortPerYear = purchasePrice * 0.80 * 0.02;
  const subLoansKey = prop.loanKey + 'Loans';
  const subLoansConfig = IC.loans && IC.loans[subLoansKey] ? IC.loans[subLoansKey] : null;

  function getRate(year) {
    for (let i = 0; i < phases.length; i++) {
      if (year >= phases[i].start && year <= phases[i].end) return phases[i].rate;
    }
    return defaultRate;
  }

  // Build year range: current year + 1 to current year + 15
  const projYears = [];
  for (let y = currentYear + 1; y <= currentYear + 15; y++) projYears.push(y);

  const dataNet = [], dataTaxes = [], dataCosts = [], dataCRD = [];
  const dataTVA = [], dataIRA = [];

  for (const year of projYears) {
    // Projected value with appreciation
    let projValue = prop.value;
    for (let y = currentYear; y < year; y++) projValue *= (1 + getRate(y));

    // CRD at target year
    const monthsFromStart = (year - startY) * 12 + (6 - startM); // ~June
    const schedIdx = Math.min(Math.max(0, monthsFromStart), sched.length - 1);
    const crd = schedIdx >= sched.length ? 0 : sched[schedIdx].remainingCRD;

    // Total amortissements
    const pDate = propMeta.purchaseDate || '2023-01';
    const [pY2] = pDate.split('-').map(Number);
    const yearsHeld = year - pY2;
    const totalAmort = fiscType === 'lmnp' ? Math.round(amortPerYear * yearsHeld) : 0;

    // Build per-loan CRDs for IRA
    let loanCRDs = null;
    if (amort.subSchedules && subLoansConfig) {
      loanCRDs = amort.subSchedules.map((sub, i) => {
        const subIdx = Math.min(Math.max(0, monthsFromStart), sub.schedule.length - 1);
        const row = sub.schedule[subIdx];
        return {
          name: sub.name,
          crd: row ? row.remainingCRD : 0,
          rate: subLoansConfig[i] ? subLoansConfig[i].rate : 0,
        };
      });
    } else if (IC.loans && IC.loans[prop.loanKey]) {
      loanCRDs = [{ name: 'Prêt principal', crd: crd, rate: IC.loans[prop.loanKey].rate || 0 }];
    }

    try {
      const ec = computeExitCostsAtYear(prop.loanKey, year, projValue, purchasePrice, crd, totalAmort, loanCRDs);
      const netProceeds = Math.max(0, Math.round(ec.netEquityAfterExit));
      const taxes = ec.totalTaxPV;
      const tvaC = ec.tvaClawback || 0;
      const ira = ec.ira || 0;
      const otherCosts = ec.diagnostics + ec.mainlevee;

      dataNet.push(netProceeds);
      dataTaxes.push(taxes);
      dataTVA.push(tvaC);
      dataIRA.push(ira);
      dataCosts.push(otherCosts);
      dataCRD.push(Math.round(crd));
    } catch (e) {
      dataNet.push(0); dataTaxes.push(0); dataTVA.push(0); dataIRA.push(0); dataCosts.push(0); dataCRD.push(0);
    }
  }

  charts.exitProjection = new Chart(el, {
    type: 'bar',
    data: {
      labels: projYears.map(String),
      datasets: [
        { label: 'Net (ce que tu gardes)', data: dataNet, backgroundColor: '#276749', stack: 'breakdown' },
        { label: 'Impôts PV', data: dataTaxes, backgroundColor: '#c53030', stack: 'breakdown' },
        // TVA clawback only relevant for Vitry — hide if all zeros
        ...(dataTVA.some(v => v > 0) ? [{ label: 'TVA clawback', data: dataTVA, backgroundColor: '#dd6b20', stack: 'breakdown' }] : []),
        { label: 'IRA + frais', data: dataIRA.map((v, i) => v + dataCosts[i]), backgroundColor: '#d69e2e', stack: 'breakdown' },
        { label: 'CRD restant', data: dataCRD, backgroundColor: '#a0aec0', stack: 'breakdown' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Projection sortie — Si tu vends en année X', font: { size: 14 } },
        tooltip: {
          mode: 'index',
          callbacks: {
            label: c => c.dataset.label + ': ' + fmt(c.parsed.y),
            afterBody: function(items) {
              if (!items.length) return '';
              const idx = items[0].dataIndex;
              const total = dataNet[idx] + dataTaxes[idx] + dataTVA[idx] + dataIRA[idx] + dataCosts[idx] + dataCRD[idx];
              return '\nPrix de vente estimé: ' + fmt(Math.round(total))
                + '\nTu récupères: ' + fmt(dataNet[idx]);
            }
          }
        },
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { callback: v => fmtAxis(v) } }
      }
    }
  });
}

// ============ WEALTH CREATION PROJECTION CHART ============
export function buildWealthProjectionChart(state, mode, group) {
  const el = document.getElementById('wealthProjectionChart');
  if (!el) return;
  if (charts.wealthProjection) { charts.wealthProjection.destroy(); delete charts.wealthProjection; }

  const iv = state.immoView;
  if (!iv || !iv.wealthProjection) return;
  const proj = iv.wealthProjection;

  const isAnnual = mode === 'an';
  const isByAppart = group === 'appart';

  // Property names and colors for "par appart" mode
  const propNames = { vitry: 'Vitry-sur-Seine', rueil: 'Rueil-Malmaison', villejuif: 'Villejuif' };
  const propColors = { vitry: '#4c6ef5', rueil: '#12b886', villejuif: '#f59f00' };
  const includeVillejuif = typeof window._immoIncludeVillejuif === 'function' ? window._immoIncludeVillejuif() : true;
  const propKeys = Object.keys(proj[0]?.perProp || {}).filter(k => includeVillejuif || k !== 'villejuif');

  // Group by year first (used for both modes)
  const byYear = {};
  proj.forEach(row => {
    const y = row.date.split('-')[0];
    if (!byYear[y]) {
      byYear[y] = { capital: 0, appreciation: 0, cashflow: 0, exitSavings: 0, total: 0, count: 0 };
      propKeys.forEach(k => { byYear[y][k] = 0; });
    }
    // Sum only from filtered properties (respects Villejuif toggle)
    let rowCapital = 0, rowApprec = 0, rowCF = 0, rowExit = 0, rowTotal = 0;
    propKeys.forEach(k => {
      const pp = row.perProp[k];
      if (pp) {
        rowCapital += pp.capital || 0;
        rowApprec += pp.appreciation || 0;
        rowCF += pp.cashflow || 0;
        rowExit += pp.exitSavings || 0;
        rowTotal += pp.total || 0;
        byYear[y][k] += pp.total;
      }
    });
    byYear[y].capital += rowCapital;
    byYear[y].appreciation += rowApprec;
    byYear[y].cashflow += rowCF;
    byYear[y].exitSavings += rowExit;
    byYear[y].total += rowTotal;
    byYear[y].count++;
  });
  const years = Object.keys(byYear).sort();
  // Exclude last year if partial (< 12 months)
  if (years.length > 0 && byYear[years[years.length - 1]].count < 12) {
    years.pop();
  }

  let labels = [], datasets = [], totalData = [];

  if (isByAppart) {
    // ── Par appart: stacked by property ──
    const propData = {};
    propKeys.forEach(k => { propData[k] = []; });

    years.forEach(y => {
      const d = byYear[y];
      const n = isAnnual ? 1 : d.count;
      labels.push(y);
      propKeys.forEach(k => {
        propData[k].push(Math.round(d[k] / n));
      });
      totalData.push(Math.round(d.total / n));
    });

    propKeys.forEach(k => {
      datasets.push({
        label: propNames[k] || k,
        data: propData[k],
        backgroundColor: propColors[k] || '#718096',
        stack: 'wealth',
        order: 3,
      });
    });
    datasets.push({
      label: 'Total',
      data: totalData,
      type: 'line',
      borderColor: '#2d3748',
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      order: 0,
    });
  } else {
    // ── Par type: stacked by component (capital, appréciation, exit savings, CF) ──
    let capitalData = [], apprecData = [], cfData = [], exitSavData = [];

    years.forEach(y => {
      const d = byYear[y];
      const n = isAnnual ? 1 : d.count;
      labels.push(y);
      capitalData.push(Math.round(d.capital / n));
      apprecData.push(Math.round(d.appreciation / n));
      cfData.push(Math.round(d.cashflow / n));
      exitSavData.push(Math.round(d.exitSavings / n));
      totalData.push(Math.round(d.total / n));
    });

    datasets = [
      {
        label: 'Capital amorti',
        data: capitalData,
        backgroundColor: '#4c6ef5',
        borderColor: '#3b5bdb',
        borderWidth: 0.5,
        borderRadius: 2,
        stack: 'wealth',
        order: 4,
      },
      {
        label: 'Appréciation',
        data: apprecData,
        backgroundColor: '#12b886',
        borderColor: '#0ca678',
        borderWidth: 0.5,
        borderRadius: 2,
        stack: 'wealth',
        order: 3,
      },
      {
        label: 'Variation frais sortie',
        data: exitSavData,
        backgroundColor: exitSavData.map(v => v >= 0 ? '#20c997' : '#ff6b6b'),
        borderWidth: 0.5,
        borderRadius: 2,
        stack: 'wealth',
        order: 2,
      },
      {
        label: 'Cash flow',
        data: cfData,
        backgroundColor: cfData.map(v => v >= 0 ? '#a9e34b' : '#ff6b6b'),
        borderWidth: 0.5,
        borderRadius: 2,
        stack: 'wealth',
        order: 1,
      },
      {
        label: 'Total',
        data: totalData,
        type: 'line',
        borderColor: '#1a1a2e',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.3,
        order: 0,
      },
    ];
  }

  const suffix = isAnnual ? '/an' : '/mois';
  const titleGroup = isByAppart ? 'par appartement' : (isAnnual ? 'par an' : 'moyenne par mois');
  const titleText = 'Création de richesse ' + titleGroup + ' (2026–2046)';

  const ctx = el.getContext('2d');
  charts.wealthProjection = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              const v = ctx.parsed.y;
              const sign = v >= 0 ? '+' : '';
              return ctx.dataset.label + ': ' + sign + '€' + Math.round(v).toLocaleString('fr-FR') + suffix;
            }
          }
        },
        title: {
          display: true,
          text: titleText,
          font: { size: 14, weight: '600' },
          padding: { bottom: 12 },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
        y: {
          stacked: true,
          ticks: {
            callback: function(v) { return fmtAxis(v); },
            font: { size: 10 },
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
      },
    },
  });
}

// ============ PV ABATTEMENT CHART (TAX BREAKDOWN BY HOLDING PERIOD) ============
function buildPVAbattementChart(propData, canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  if (charts[canvasId]) { charts[canvasId].destroy(); delete charts[canvasId]; }

  const schedule = propData.pvAbattementSchedule || [];
  if (!schedule || schedule.length === 0) return;

  // Filter to show years: 1, 5, 6, 10, 15, 20, 22, 25, 30
  const displayYears = [1, 5, 6, 10, 15, 20, 22, 25, 30];
  const filtered = schedule.filter(s => displayYears.includes(s.year));

  // Prepare data
  const labels = filtered.map(s => s.year + ' ans');
  const netData = filtered.map(s => s.net_pct);
  const irData = filtered.map(s => s.taxIR_pct);
  const psData = filtered.map(s => s.taxPS_pct);

  // Current holding period (floor: between purchase date and today)
  const IC = IMMO_CONSTANTS;
  const propMeta = IC.properties[propData.loanKey] || {};
  const purchaseDate = propMeta.purchaseDate || '2023-01';
  const [pY, pM] = purchaseDate.split('-').map(Number);
  const now = new Date();
  const holdingYears = (now.getFullYear() - pY) + (now.getMonth() + 1 - pM) / 12;
  const currentYear = Math.floor(holdingYears);

  const ctx = el.getContext('2d');
  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Net (ce que vous gardez)',
          data: netData,
          backgroundColor: '#48bb78',
          borderColor: '#38a169',
          borderWidth: 1,
        },
        {
          label: 'IR (impôt sur le revenu)',
          data: irData,
          backgroundColor: '#f56565',
          borderColor: '#c53030',
          borderWidth: 1,
        },
        {
          label: 'PS (prélèvements sociaux)',
          data: psData,
          backgroundColor: '#ed8936',
          borderColor: '#c05621',
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: undefined,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            boxWidth: 14,
            padding: 12,
            font: { size: 11 },
            generateLabels: function(chart) {
              const datasets = chart.data.datasets;
              return datasets.map((ds, i) => ({
                text: ds.label,
                fillStyle: ds.backgroundColor,
                hidden: false,
                index: i,
              }));
            },
          },
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + '%';
            },
            afterLabel: function(ctx) {
              // Show abattement info on hover
              const yearIdx = ctx.dataIndex;
              const data = filtered[yearIdx];
              if (data) {
                const abattIRLabel = 'Abatt. IR: ' + data.abattIR + '%';
                const abattPSLabel = 'Abatt. PS: ' + data.abattPS + '%';
                if (ctx.dataset.label.includes('IR')) return abattIRLabel;
                if (ctx.dataset.label.includes('PS')) return abattPSLabel;
              }
              return '';
            },
          },
        },
        title: {
          display: true,
          text: 'Imposition de la plus-value en fonction de la durée de détention',
          font: { size: 13, weight: '600' },
          padding: { bottom: 12 },
        },
        annotation: {
          drawTime: 'afterDatasetsDraw',
          annotations: {},
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { font: { size: 10 } },
          grid: { display: false },
        },
        y: {
          stacked: true,
          min: 0,
          max: 40,
          ticks: {
            callback: function(v) { return v.toFixed(0) + '%'; },
            font: { size: 10 },
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
      },
    },
    plugins: [
      {
        id: 'currentYearLine',
        afterDatasetsDraw(chart) {
          // Draw vertical line at current holding period if within range
          if (currentYear >= 1 && currentYear <= 30) {
            const foundIdx = filtered.findIndex(s => s.year === currentYear);
            if (foundIdx >= 0) {
              const xScale = chart.scales.x;
              const yScale = chart.scales.y;
              const xPos = xScale.getPixelForValue(foundIdx);
              const yStart = yScale.getPixelForValue(yScale.max);
              const yEnd = yScale.getPixelForValue(yScale.min);

              const ctx = chart.ctx;
              ctx.save();
              ctx.strokeStyle = '#2d3748';
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 5]);
              ctx.beginPath();
              ctx.moveTo(xPos, yStart);
              ctx.lineTo(xPos, yEnd);
              ctx.stroke();
              ctx.restore();

              // Add label "Période actuelle"
              ctx.save();
              ctx.font = 'bold 11px sans-serif';
              ctx.fillStyle = '#2d3748';
              ctx.textAlign = 'center';
              ctx.fillText('Période actuelle (' + currentYear + ' ans)', xPos, yStart - 8);
              ctx.restore();
            }
          }
        },
      },
    ],
  });
}

// Make available globally for render.js
window.buildPropertyDetailCharts = buildPropertyDetailCharts;
window.buildExitProjectionChart = buildExitProjectionChart;
window.buildWealthProjectionChart = buildWealthProjectionChart;
window.buildPVAbattementChart = buildPVAbattementChart;

// ============ BUDGET DONUTS ============
function buildBudgetZoneDonut(state) {
  const el = document.getElementById('budgetZoneChart');
  if (!el) return;
  if (charts.budgetZone) { charts.budgetZone.destroy(); delete charts.budgetZone; }
  const bv = state.budgetView;
  if (!bv) return;

  const zoneColors = { Dubai: '#d69e2e', France: '#2b6cb0', Digital: '#805ad5' };
  const entries = Object.entries(bv.personalByZone || {}).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => Math.round(e[1]));
  const colors = labels.map(l => zoneColors[l] || '#94a3b8');
  const total = bv.personalTotal || 1;

  charts.budgetZone = new Chart(el, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, boxWidth: 14, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => c.label + ': ' + fmt(c.parsed) + '/mois (' + (c.parsed / total * 100).toFixed(0) + '%)' } }
      }
    }
  });
}

function buildBudgetTypeDonut(state) {
  const el = document.getElementById('budgetTypeChart');
  if (!el) return;
  if (charts.budgetType) { charts.budgetType.destroy(); delete charts.budgetType; }
  const bv = state.budgetView;
  if (!bv) return;

  const typeColors = { Logement: '#e53e3e', Utilities: '#38a169', Abonnements: '#805ad5', Assurance: '#d69e2e' };
  const entries = Object.entries(bv.personalByType || {}).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => Math.round(e[1]));
  const colors = labels.map(l => typeColors[l] || '#94a3b8');
  const total = bv.personalTotal || 1;

  charts.budgetType = new Chart(el, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, boxWidth: 14, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => c.label + ': ' + fmt(c.parsed) + '/mois (' + (c.parsed / total * 100).toFixed(0) + '%)' } }
      }
    }
  });
}

// ============================================================
// PORTFOLIO YTD EVOLUTION CHART
// ============================================================
// Displays the daily evolution of the IBKR account NAV (in EUR)
// since January 1st, 2026.
//
// ── Methodology ──
// We use a "calibrated forward simulation" approach:
// 1. Known starting NAV from IBKR (current NAV + abs(YTD loss))
// 2. Compute positions value at day 1 from Yahoo historical data
// 3. Derive starting cash = starting NAV - positions value
// 4. Simulate forward day by day:
//    - Apply trades (buy/sell change positions AND cash)
//    - Apply FX trades (shift between EUR/USD/JPY cash)
//    - Apply deposits (increase EUR cash)
//    - NAV(d) = positions_value(d) + cash_EUR + cash_USD/EURUSD + cash_JPY/EURJPY
//
// ── Ticker mapping ──
// Trades use short tickers (GLE, EDEN, WLN, NXI) while Yahoo needs
// the exchange suffix (.PA for Euronext Paris). We map EUR-currency
// trade tickers without a dot to .PA suffix.
//
// ── Cash tracking ──
// Cash is tracked per currency (EUR, USD, JPY) to properly account
// for FX rate movements. JPY carry trade positions significantly
// affect NAV when EUR/JPY moves.
//
// ── Known starting balances ──
// JPY at YTD start ≈ -1,090,000 (from Shiseido buy Nov 2025)
// USD at YTD start ≈ -4,356 (EUR→USD - QQQM - IBIT Dec buys)
// EUR at YTD start = derived so that total NAV = IBKR starting NAV
// ============================================================

// ── Compute ABSOLUTE lifetime deposits & P&L for tooltip consistency ──
// Ensures P&L = NAV − Déposé(net) at every point, regardless of chart period.
// Called by both buildPortfolioYTDChart and buildEquityHistoryChart.
function computeAbsoluteTooltipArrays(chartLabels, navIBKR, navESPP, navSGTM, navDegiro, navTotal) {
  // ── 1) DEGIRO: back-compute from annual reports ──
  const dg = PORTFOLIO.amine.degiro || {};
  const dgAnnual = dg.annualSummary || {};
  const dgDiv = dg.dividends || {};
  const dgFX = dg.fxCosts || {};
  const dgFlatex = dg.flatexCashFlows || {};

  let dgTotalPL = 0;
  for (const y of [2020, 2021, 2022, 2023, 2024, 2025]) {
    const as = dgAnnual[y] || {};
    const div = dgDiv[y] || {};
    const fx = dgFX[y] || {};
    const fl = dgFlatex[y] || {};
    dgTotalPL += (as.netPL || 0) + (div.net || 0)
      + (fx.autoFX || 0) + (fx.manualFX || 0) - (fl.interestPaid || 0);
  }
  dgTotalPL += 20; // promo bonus 2020

  let dgTotalWithdrawals = 0;
  for (const y of [2020, 2021, 2022, 2023, 2024, 2025]) {
    dgTotalWithdrawals += (dgFlatex[y] || {}).retraits || 0;
  }
  const dgTotalDeposits = dgTotalWithdrawals - dgTotalPL;

  const dgWithdrawalEvents = [];
  for (const y of [2020, 2021, 2022, 2023, 2024, 2025]) {
    const ret = (dgFlatex[y] || {}).retraits || 0;
    if (ret > 0) {
      dgWithdrawalEvents.push({ date: y === 2025 ? '2025-04-14' : y + '-12-31', amount: ret });
    }
  }
  const dgDepositDates = ['2020-01-14', '2020-02-20', '2020-03-09'];
  const dgPerDeposit = dgTotalDeposits / dgDepositDates.length;

  // ── 2) ESPP: all lots contribEUR ──
  const esppDepositEvents = [];
  const esppLotsAmine = PORTFOLIO.amine.espp?.lots || [];
  for (const lot of esppLotsAmine) {
    if (lot.contribEUR) {
      esppDepositEvents.push({ date: lot.date, amountEUR: lot.contribEUR });
    } else {
      esppDepositEvents.push({ date: lot.date, amountEUR: (lot.shares * lot.costBasis) / (lot.fxRateAtDate || 1.15) });
    }
  }
  const esppCash = PORTFOLIO.amine.espp?.cashEUR || 0;
  if (esppCash > 0) {
    const earliest = esppLotsAmine.length > 0
      ? esppLotsAmine.reduce((a, b) => a.date < b.date ? a : b).date : '2018-01-01';
    esppDepositEvents.push({ date: earliest, amountEUR: esppCash });
  }
  // Nezha ESPP
  const nezhaLots = PORTFOLIO.nezha?.espp?.lots || [];
  for (const lot of nezhaLots) {
    if (lot.contribEUR) {
      esppDepositEvents.push({ date: lot.date, amountEUR: lot.contribEUR });
    } else {
      esppDepositEvents.push({ date: lot.date, amountEUR: (lot.shares * lot.costBasis) / (lot.fxRateAtDate || 1.10) });
    }
  }
  const nezhaCashUSD = PORTFOLIO.nezha?.espp?.cashUSD || 0;
  if (nezhaCashUSD > 0) {
    esppDepositEvents.push({ date: '2018-01-01', amountEUR: nezhaCashUSD / (FX_STATIC?.USD || 1.15) });
  }
  esppDepositEvents.sort((a, b) => a.date.localeCompare(b.date));

  // ── 3) IBKR: all deposits from records ──
  const ibkrDepositEvents = [];
  for (const d of (PORTFOLIO.amine.ibkr?.deposits || [])) {
    const eur = d.currency === 'EUR' ? d.amount : d.amount / d.fxRateAtDate;
    ibkrDepositEvents.push({ date: d.date, amountEUR: eur });
  }
  ibkrDepositEvents.sort((a, b) => a.date.localeCompare(b.date));

  // ── 4) SGTM: IPO cost basis ──
  const sgtmTotalShares = (PORTFOLIO.amine.sgtm?.shares || 0) + (PORTFOLIO.nezha?.sgtm?.shares || 0);
  const sgtmCostMAD = PORTFOLIO.amine.sgtm?.costPerShareMAD || 0;
  const sgtmDepositEvents = [];
  if (sgtmTotalShares > 0 && sgtmCostMAD > 0) {
    const fxMAD = FX_STATIC?.MAD || 10.85;
    sgtmDepositEvents.push({ date: '2025-12-15', amountEUR: sgtmTotalShares * sgtmCostMAD / fxMAD });
  }

  // ── Build cumulative arrays ──
  const absDepsIBKR = [], absDepsESPP = [], absDepsSGTM = [], absDepsDegiro = [], absDepsTotal = [];
  let cumIBKR = 0, cumESPP = 0, cumSGTM = 0;
  let esppI = 0, ibkrI = 0, sgtmI = 0;

  for (let i = 0; i < chartLabels.length; i++) {
    const snapDate = chartLabels[i];

    // Degiro
    const depsIn = dgDepositDates.filter(d => d <= snapDate).length;
    const cumDgDep = depsIn * dgPerDeposit;
    let cumDgRet = 0;
    for (const w of dgWithdrawalEvents) { if (w.date <= snapDate) cumDgRet += w.amount; }
    absDepsDegiro.push(cumDgDep - cumDgRet);

    // ESPP
    while (esppI < esppDepositEvents.length && esppDepositEvents[esppI].date <= snapDate) {
      cumESPP += esppDepositEvents[esppI].amountEUR; esppI++;
    }
    absDepsESPP.push(cumESPP);

    // IBKR
    while (ibkrI < ibkrDepositEvents.length && ibkrDepositEvents[ibkrI].date <= snapDate) {
      cumIBKR += ibkrDepositEvents[ibkrI].amountEUR; ibkrI++;
    }
    absDepsIBKR.push(cumIBKR);

    // SGTM
    while (sgtmI < sgtmDepositEvents.length && sgtmDepositEvents[sgtmI].date <= snapDate) {
      cumSGTM += sgtmDepositEvents[sgtmI].amountEUR; sgtmI++;
    }
    absDepsSGTM.push(cumSGTM);

    // Total
    absDepsTotal.push(absDepsDegiro[i] + cumESPP + cumIBKR + cumSGTM);
  }

  // P&L = NAV - absolute deposits
  const absPLDegiro = navDegiro.map((v, i) => Math.round((v || 0) - absDepsDegiro[i]));
  const absPLESPP = navESPP.map((v, i) => Math.round((v || 0) - absDepsESPP[i]));
  const absPLIBKR = navIBKR.map((v, i) => Math.round((v || 0) - absDepsIBKR[i]));
  const absPLSGTM = navSGTM.map((v, i) => Math.round((v || 0) - absDepsSGTM[i]));
  const absPLTotal = navTotal.map((v, i) => Math.round((v || 0) - absDepsTotal[i]));

  return {
    absDepsIBKR, absDepsESPP, absDepsSGTM, absDepsDegiro, absDepsTotal,
    absPLIBKR, absPLESPP, absPLSGTM, absPLDegiro, absPLTotal,
  };
}

// ── Unified chart rendering function ──
function renderPortfolioChart(overrides = {}) {
  const el = document.getElementById('portfolioYTDChart');
  if (!el) return;

  const data = window._ytdChartFullData;
  if (!data || !data.labels.length) return;

  // Merge overrides with stored state
  const scope = overrides.scope || data.scope || 'ibkr';
  const displayMode = overrides.displayMode || window._ytdDisplayMode || 'value';
  const period = overrides.period || data.currentPeriod || 'YTD';

  // ── Slice data by period ──
  let startIdx = 0;
  if (period && period !== 'YTD' && period !== '1Y' && period !== '5Y' && period !== 'MAX') {
    const today = new Date();
    let cutoff;
    if (period === 'MTD') {
      cutoff = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    } else if (period === '1M') {
      const d = new Date(today);
      d.setMonth(d.getMonth() - 1);
      cutoff = d.toISOString().slice(0, 10);
    } else if (period === '3M') {
      const d = new Date(today);
      d.setMonth(d.getMonth() - 3);
      cutoff = d.toISOString().slice(0, 10);
    } else if (period === '1Y') {
      const d = new Date(today);
      d.setFullYear(d.getFullYear() - 1);
      cutoff = d.toISOString().slice(0, 10);
    } else {
      cutoff = '2025-12-31';
    }
    for (let i = 0; i < data.labels.length; i++) {
      if (data.labels[i] >= cutoff) { startIdx = i; break; }
    }
  }

  const slicedLabels = data.labels.slice(startIdx);
  const slicedIBKR = data.ibkrValues.slice(startIdx);
  const slicedTotal = data.totalValues.slice(startIdx);
  const slicedESPP = (data.esppValues || []).slice(startIdx);
  const slicedSGTM = (data.sgtmValues || []).slice(startIdx);
  const slicedDegiro = (data.degiroValues || []).slice(startIdx);
  const slicedPLIBKR = (data.plValuesIBKR || []).slice(startIdx);
  const slicedPLTotal = (data.plValuesTotal || []).slice(startIdx);
  const slicedPLESPP = (data.plValuesESPP || []).slice(startIdx);
  const slicedPLSGTM = (data.plValuesSGTM || []).slice(startIdx);
  const slicedPLDegiro = (data.plValuesDegiro || []).slice(startIdx);

  if (slicedLabels.length === 0) return;

  // ── Select data based on scope and mode ──
  let mainData, refValue, mainLabel, scopeLabel;
  if (displayMode === 'pl') {
    // P&L mode: select scope-specific P&L series (NO fallback to IBKR)
    switch (scope) {
      case 'espp':
        mainData = slicedPLESPP;
        scopeLabel = 'ESPP';
        break;
      case 'maroc':
        mainData = slicedPLSGTM;
        scopeLabel = 'Maroc';
        break;
      case 'degiro':
        mainData = slicedPLDegiro;
        scopeLabel = 'Degiro';
        break;
      case 'all':
        mainData = slicedPLTotal;
        scopeLabel = 'Tous';
        break;
      case 'ibkr':
      default:
        mainData = slicedPLIBKR;
        scopeLabel = 'IBKR';
        break;
    }
    refValue = 0;
    mainLabel = 'P&L ' + scopeLabel + ' (EUR)';
  } else {
    // Value mode: select scope-specific NAV series (NO fallback to IBKR)
    switch (scope) {
      case 'espp':
        mainData = slicedESPP;
        scopeLabel = 'ESPP';
        break;
      case 'maroc':
        mainData = slicedSGTM;
        scopeLabel = 'Maroc';
        break;
      case 'degiro':
        mainData = slicedDegiro;
        scopeLabel = 'Degiro';
        break;
      case 'all':
        mainData = slicedTotal;
        scopeLabel = 'Tous';
        break;
      case 'ibkr':
      default:
        mainData = slicedIBKR;
        scopeLabel = 'IBKR';
        break;
    }
    refValue = mainData[0];
    mainLabel = 'NAV ' + scopeLabel + ' (EUR)';
  }

  if (!mainData || mainData.length === 0) return;

  const startVal = refValue;
  const endVal = mainData[mainData.length - 1];
  const plStartVal = mainData[0]; // P&L at start of displayed period
  const plChange = endVal - plStartVal; // P&L change during displayed period

  // ── In value mode, compute true P&L from the PL series (not NAV change) ──
  // This ensures the title P&L matches the KPI cards exactly.
  // NAV change includes deposits; P&L subtracts them.
  let plForTitle;
  if (displayMode === 'pl') {
    plForTitle = plChange;
  } else {
    // Look up the matching PL series for the current scope
    let plSeries;
    switch (scope) {
      case 'espp': plSeries = slicedPLESPP; break;
      case 'maroc': plSeries = slicedPLSGTM; break;
      case 'degiro': plSeries = slicedPLDegiro; break;
      case 'all': plSeries = slicedPLTotal; break;
      case 'ibkr': default: plSeries = slicedPLIBKR; break;
    }
    if (plSeries && plSeries.length > 0) {
      plForTitle = plSeries[plSeries.length - 1] - plSeries[0];
    } else {
      plForTitle = endVal - refValue; // fallback to NAV change
    }
  }
  const plEUR = plForTitle;
  // Compute % relative to start NAV + cumulative deposits (= capital deployed)
  const slicedCumDep = displayMode !== 'pl' ? (() => {
    let depSeries;
    switch (scope) {
      case 'espp': depSeries = (data.cumDepositsESPP || []).slice(startIdx); break;
      case 'maroc': depSeries = (data.cumDepositsSGTM || []).slice(startIdx); break;
      case 'degiro': depSeries = (data.cumDepositsDegiro || []).slice(startIdx); break;
      case 'all': depSeries = (data.cumDepositsAtPointTotal || []).slice(startIdx); break;
      case 'ibkr': default: depSeries = (data.cumDepositsAtPoint || []).slice(startIdx); break;
    }
    return depSeries;
  })() : null;
  const depositsInPeriod = slicedCumDep && slicedCumDep.length > 0
    ? (slicedCumDep[slicedCumDep.length - 1] || 0) - (slicedCumDep[0] || 0) : 0;
  const capitalDeployed = (refValue || 0) + depositsInPeriod;
  const plPct = capitalDeployed > 0 ? (plEUR / capitalDeployed * 100).toFixed(2) : '0.00';
  const isPositive = plEUR >= 0;

  // ── Update UI elements ──
  const titleEl = document.getElementById('ytdChartTitle');
  // Period label: use actual period if sub-filtered, otherwise mode (YTD/1Y)
  const periodLabel = (period === 'YTD' || !period) ? (data.mode === '1y' ? '1Y' : 'YTD') : period;
  if (titleEl) {
    const color = isPositive ? 'var(--green)' : 'var(--red)';
    if (scope === 'degiro') {
      const degiroColor = '#a0aec0';
      if (displayMode === 'pl') {
        titleEl.innerHTML = '<span class="section-icon" style="background:var(--accent)">📈</span>' +
          'P&L Degiro ' + periodLabel + ' — <span style="color:' + degiroColor + '">' +
          (endVal >= 0 ? '+' : '') + fmt(endVal) + '</span>' +
          ' <small style="color:#a0aec0;font-weight:normal">(compte clôturé — P/L réalisé)</small>';
      } else {
        titleEl.innerHTML = '<span class="section-icon" style="background:var(--accent)">📈</span>' +
          'Evolution Degiro ' + periodLabel + ' — <span style="color:' + degiroColor + '">' +
          fmt(endVal) + '</span>' +
          ' <small style="color:#a0aec0;font-weight:normal">(compte clôturé)</small>';
      }
    } else if (displayMode === 'pl') {
      titleEl.innerHTML = '<span class="section-icon" style="background:var(--accent)">📈</span>' +
        'P&L ' + scopeLabel + ' ' + periodLabel + ' — <span style="color:' + color + '">' +
        (plChange >= 0 ? '+' : '') + fmt(plChange) + '</span>';
    } else {
      titleEl.innerHTML = '<span class="section-icon" style="background:var(--accent)">📈</span>' +
        'Evolution ' + scopeLabel + ' ' + periodLabel + ' — <span style="color:' + color + '">' +
        (plEUR >= 0 ? '+' : '') + fmt(plEUR) + ' (' + (plEUR >= 0 ? '+' : '') + plPct + '%)</span>';
    }
  }

  const ytdStartEl = document.getElementById('ytdStartValue');
  const ytdEndEl = document.getElementById('ytdEndValue');
  const ytdStartLabel = document.getElementById('ytdStartLabel');
  if (displayMode === 'pl') {
    if (ytdStartEl) ytdStartEl.textContent = fmt(plStartVal);
    if (ytdEndEl) ytdEndEl.textContent = (plChange >= 0 ? '+' : '') + fmt(plChange);
    if (ytdStartLabel) ytdStartLabel.textContent = 'P&L départ';
  } else {
    if (ytdStartEl) ytdStartEl.textContent = fmt(refValue);
    if (ytdEndEl) ytdEndEl.textContent = fmt(endVal);
    if (ytdStartLabel) {
      const MFL = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
      if (data.mode === '5y' || data.mode === 'max') {
        const startD = data.labels[0];
        const sp = startD.split('-');
        ytdStartLabel.innerHTML = 'NAV ' + MFL[parseInt(sp[1])-1] + ' ' + sp[0];
      } else if (data.mode === '1y') {
        const startD = data.labels[0];
        const sp = startD.split('-');
        ytdStartLabel.innerHTML = 'NAV ' + parseInt(sp[2]) + ' ' + MFL[parseInt(sp[1])-1] + ' ' + sp[0];
      } else {
        ytdStartLabel.innerHTML = 'NAV 1<sup>er</sup> jan';
      }
    }
  }

  // ── Build chart ──
  if (charts.portfolioYTD) { charts.portfolioYTD.destroy(); delete charts.portfolioYTD; }
  // Hide external tooltip on chart destroy
  const _tt = document.getElementById('chartTooltip');
  if (_tt) _tt.style.opacity = '0';

  const isLongTerm = data._isEquityHistory;
  const MF = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
  const displayLabels = slicedLabels.map(d => {
    const p = d.split('-');
    if (isLongTerm) {
      // Monthly data: "jan 20", "fév 20", etc.
      return MF[parseInt(p[1]) - 1] + ' ' + p[0].slice(2);
    }
    return p[2] + '/' + p[1];
  });

  const ctx = el.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, el.height || 400);
  const isDegiro = scope === 'degiro';

  if (isDegiro) {
    gradient.addColorStop(0, 'rgba(160,174,192,0.12)');
    gradient.addColorStop(1, 'rgba(160,174,192,0.02)');
  } else {
    gradient.addColorStop(0, isPositive ? 'rgba(72,187,120,0.3)' : 'rgba(229,62,62,0.3)');
    gradient.addColorStop(1, isPositive ? 'rgba(72,187,120,0.01)' : 'rgba(229,62,62,0.01)');
  }

  const lineColor = isDegiro ? '#a0aec0' : (isPositive ? '#48bb78' : '#e53e3e');

  const datasets = [
    {
      label: mainLabel,
      data: mainData,
      borderColor: lineColor,
      backgroundColor: gradient,
      borderWidth: isDegiro ? 1.5 : 2,
      borderDash: isDegiro ? [4, 4] : [],
      pointRadius: isDegiro ? 0 : (mainData.length > 60 ? 1 : 2),
      pointHoverRadius: isDegiro ? 3 : 5,
      pointBackgroundColor: lineColor,
      pointHoverBackgroundColor: lineColor,
      fill: true,
      tension: 0,
    },
    {
      label: displayMode === 'pl' ? 'Zéro' : ((data.mode === '1y' ? 'NAV début 1Y' : 'NAV 1er jan') + ' (' + fmt(refValue) + ')'),
      data: mainData.map(() => refValue),
      borderColor: '#a0aec0',
      borderWidth: 1,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
    },
  ];

  // ── Period-relative references (for hover tooltip — must match chart line) ──
  const chartLabelsRef = data.labels;
  const plIBKR = data.plValuesIBKR;
  const plTotal = data.plValuesTotal;
  const plESPP = data.plValuesESPP;
  const plSGTM = data.plValuesSGTM;
  const navIBKR = data.ibkrValues;
  const navTotal = data.totalValues;
  const navESPP = data.esppValues;
  const navSGTM = data.sgtmValues;
  const cumDepsIBKR = data.cumDepositsAtPoint;
  const cumDepsTotal = data.cumDepositsAtPointTotal || data.cumDepositsAtPoint;
  const cumDepsESPP = data.cumDepositsESPP;
  const cumDepsSGTM = data.cumDepositsSGTM;
  const plDegiro = data.plValuesDegiro;
  const navDegiro = data.degiroValues;
  const cumDepsDegiro = data.cumDepositsDegiro;
  const startValueRef = data.startValue;

  // ── ABSOLUTE lifetime references (for click detail panel — P&L = NAV − Déposé) ──
  const abs = data._absoluteTooltip || {};
  const absPlIBKR = abs.absPLIBKR || plIBKR;
  const absPlTotal = abs.absPLTotal || plTotal;
  const absPlESPP = abs.absPLESPP || plESPP;
  const absPlSGTM = abs.absPLSGTM || plSGTM;
  const absPlDegiro = abs.absPLDegiro || plDegiro;
  const absCumDepsIBKR = abs.absDepsIBKR || cumDepsIBKR;
  const absCumDepsTotal = abs.absDepsTotal || cumDepsTotal;
  const absCumDepsESPP = abs.absDepsESPP || cumDepsESPP;
  const absCumDepsSGTM = abs.absDepsSGTM || cumDepsSGTM;
  const absCumDepsDegiro = abs.absDepsDegiro || cumDepsDegiro;

  // ── Click handler: show detailed breakdown panel ──
  const onChartClick = (evt, elements) => {
    const detailEl = document.getElementById('ytdPointDetail');
    if (!detailEl) return;
    if (!elements || elements.length === 0) {
      detailEl.style.display = 'none';
      return;
    }
    const di = elements[0].index;
    const idx = startIdx + di;
    if (idx < 0 || idx >= chartLabelsRef.length) return;
    const dateStr = chartLabelsRef[idx];
    const dp = dateStr.split('-');
    const dateLabel = dp[2] + '/' + dp[1] + '/' + dp[0];

    // Use ABSOLUTE lifetime data for the click detail panel
    const nav = { degiro: navDegiro[idx] || 0, espp: navESPP[idx] || 0, ibkr: navIBKR[idx] || 0, sgtm: navSGTM[idx] || 0, total: navTotal[idx] || 0 };
    const pl = { degiro: absPlDegiro[idx] || 0, espp: absPlESPP[idx] || 0, ibkr: absPlIBKR[idx] || 0, sgtm: absPlSGTM[idx] || 0, total: absPlTotal[idx] || 0 };
    const dep = { degiro: absCumDepsDegiro[idx] || 0, espp: absCumDepsESPP[idx] || 0, ibkr: absCumDepsIBKR[idx] || 0, sgtm: absCumDepsSGTM[idx] || 0, total: absCumDepsTotal[idx] || 0 };

    const fmtPL = v => (v >= 0 ? '+' : '') + fmt(v);
    const color = v => v >= 0 ? 'var(--green)' : 'var(--red)';
    const eqEntries = data._equityEntries;
    const note = eqEntries && eqEntries[idx] && eqEntries[idx].note ? ' <small style="color:#a0aec0">(' + eqEntries[idx].note + ')</small>' : '';

    let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<strong style="font-size:14px">' + dateLabel + note + '</strong>' +
      '<span style="cursor:pointer;font-size:16px;color:#a0aec0" onclick="this.parentElement.parentElement.style.display=\'none\'">&times;</span></div>';

    html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    html += '<tr style="border-bottom:1px solid var(--border);font-weight:600"><td></td><td style="text-align:right;padding:3px 8px">NAV</td><td style="text-align:right;padding:3px 8px">Déposé (net)</td><td style="text-align:right;padding:3px 8px">P&L</td><td style="text-align:right;padding:3px 8px">Rendement</td></tr>';

    const row = (label, n, d, p) => {
      const pct = d !== 0 ? ((p / Math.abs(d)) * 100).toFixed(1) + '%' : '—';
      return '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:3px 8px;font-weight:500">' + label + '</td>' +
        '<td style="text-align:right;padding:3px 8px">' + fmt(n) + '</td>' +
        '<td style="text-align:right;padding:3px 8px">' + fmt(d) + '</td>' +
        '<td style="text-align:right;padding:3px 8px;color:' + color(p) + '">' + fmtPL(p) + '</td>' +
        '<td style="text-align:right;padding:3px 8px;color:' + color(p) + '">' + pct + '</td></tr>';
    };

    if (nav.degiro > 0 || pl.degiro !== 0) html += row('Degiro', nav.degiro, dep.degiro, pl.degiro);
    if (nav.espp > 0 || pl.espp !== 0) html += row('ESPP', nav.espp, dep.espp, pl.espp);
    if (nav.ibkr > 0 || pl.ibkr !== 0) html += row('IBKR', nav.ibkr, dep.ibkr, pl.ibkr);
    if (nav.sgtm > 0 || pl.sgtm !== 0) html += row('SGTM', nav.sgtm, dep.sgtm, pl.sgtm);
    html += row('<strong>Total</strong>', nav.total, dep.total, pl.total);

    html += '</table>';
    detailEl.innerHTML = html;
    detailEl.style.display = 'block';
  };

  // ── External HTML tooltip (v244) — replaces unreliable Canvas tooltip ──
  // Uses a positioned div overlay instead of Chart.js's built-in canvas tooltip.
  // This is more reliable across chart rebuilds, mode switches, and zoom levels.
  const getOrCreateTooltipEl = () => {
    let tooltipEl = document.getElementById('chartTooltip');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'chartTooltip';
      tooltipEl.style.cssText = 'position:absolute;pointer-events:none;background:rgba(45,55,72,0.95);' +
        'color:#fff;border-radius:6px;padding:8px 12px;font-size:12px;line-height:1.5;' +
        'transition:opacity 0.15s ease;z-index:9999;max-width:320px;white-space:nowrap;';
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  };

  const externalTooltipHandler = (context) => {
    const { chart: c, tooltip: tip } = context;
    const tooltipEl = getOrCreateTooltipEl();

    if (tip.opacity === 0 || !tip.dataPoints || tip.dataPoints.length === 0) {
      tooltipEl.style.opacity = '0';
      return;
    }

    try {
      const di = tip.dataPoints[0].dataIndex;
      const idx = startIdx + di;
      if (idx < 0 || idx >= chartLabelsRef.length) { tooltipEl.style.opacity = '0'; return; }

      // Format date
      const dp = chartLabelsRef[idx].split('-');
      const dateLabel = dp[2] + '/' + dp[1] + '/' + dp[0];

      // Get scope-specific values (period-relative for chart line, absolute for context)
      let nav, pl, absPl, absDep;
      switch (scope) {
        case 'espp':  nav = navESPP[idx] || 0;  pl = plESPP[idx] || 0;  absPl = absPlESPP[idx] || 0;  absDep = absCumDepsESPP[idx] || 0;  break;
        case 'maroc': nav = navSGTM[idx] || 0;  pl = plSGTM[idx] || 0;  absPl = absPlSGTM[idx] || 0;  absDep = absCumDepsSGTM[idx] || 0;  break;
        case 'degiro': nav = navDegiro[idx] || 0; pl = plDegiro[idx] || 0; absPl = absPlDegiro[idx] || 0; absDep = absCumDepsDegiro[idx] || 0; break;
        case 'all':   nav = navTotal[idx] || 0;  pl = plTotal[idx] || 0;  absPl = absPlTotal[idx] || 0;  absDep = absCumDepsTotal[idx] || 0;  break;
        default:      nav = navIBKR[idx] || 0;   pl = plIBKR[idx] || 0;   absPl = absPlIBKR[idx] || 0;  absDep = absCumDepsIBKR[idx] || 0;
      }

      const fmtPL = v => (v >= 0 ? '+' : '') + fmt(v);
      const plColor = absPl >= 0 ? '#48bb78' : '#fc8181';

      let html = '<div style="font-weight:600;margin-bottom:4px;font-size:13px">' + dateLabel + '</div>';

      if (displayMode === 'pl') {
        // Chart line shows period-relative P&L; supplementary shows absolute
        const relColor = pl >= 0 ? '#48bb78' : '#fc8181';
        html += '<div style="color:' + relColor + ';font-weight:600">P&L période: ' + fmtPL(pl) + '</div>';
        html += '<div style="color:#cbd5e0;font-size:11px">NAV: ' + fmt(nav) + ' | Déposé: ' + fmt(absDep) + ' | P&L total: ' + fmtPL(absPl) + '</div>';
      } else {
        const startV = startValueRef || nav; // fallback to prevent NaN
        const diff = nav - startV;
        const pct = startV && startV !== 0 ? ((nav / startV - 1) * 100).toFixed(2) : '0.00';
        const diffColor = diff >= 0 ? '#48bb78' : '#fc8181';
        html += '<div>NAV ' + scopeLabel + ': <b>' + fmt(nav) + '</b></div>';
        html += '<div style="color:' + diffColor + '">' + fmtPL(diff) + ' (' + (diff >= 0 ? '+' : '') + pct + '%)</div>';
        html += '<div style="color:#cbd5e0;font-size:11px">P&L: ' + fmtPL(absPl) + ' | Déposé: ' + fmt(absDep) + '</div>';
      }

      tooltipEl.innerHTML = html;
    } catch (e) {
      tooltipEl.innerHTML = '<div style="color:#fc8181">Erreur tooltip</div>';
      console.warn('[tooltip] Error in external tooltip:', e);
    }

    // Position tooltip near cursor
    const pos = c.canvas.getBoundingClientRect();
    const caretX = tip.caretX;
    const caretY = tip.caretY;
    tooltipEl.style.opacity = '1';
    tooltipEl.style.left = (pos.left + window.scrollX + caretX) + 'px';
    tooltipEl.style.top = (pos.top + window.scrollY + caretY - tooltipEl.offsetHeight - 12) + 'px';
  };

  charts.portfolioYTD = new Chart(el, {
    type: 'line',
    data: { labels: displayLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick: onChartClick,
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, maxTicksLimit: 15, maxRotation: 0 },
        },
        y: {
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { font: { size: 10 }, callback: v => fmtAxis(v) },
        },
      },
      plugins: {
        legend: {
          display: true, position: 'top',
          labels: { font: { size: 11 }, usePointStyle: true, pointStyle: 'line', padding: 12 },
        },
        tooltip: {
          enabled: false,
          external: externalTooltipHandler,
        },
      },
    },
    plugins: isDegiro ? [{
      id: 'degiroOverlay',
      afterDraw(chart) {
        const { ctx: c, chartArea: { left, right, top, bottom } } = chart;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        c.save();
        c.font = '600 14px Inter, system-ui, sans-serif';
        c.fillStyle = '#a0aec0';
        c.textAlign = 'center';
        c.fillText('Compte clôturé — P/L réalisé : +' + fmt(data.degiroRealizedPL || 0), cx, cy);
        c.restore();
      },
    }] : [],
  });

  console.log('[ytd-chart] Rendered: scope=' + scope + ', mode=' + displayMode + ', period=' + period + ', points=' + slicedLabels.length);
}

/**
 * Build the YTD portfolio evolution line chart.
 *
 * @param {object} portfolio - PORTFOLIO from data.js
 * @param {object} historicalData - from fetchHistoricalPricesYTD()
 * @param {object} fxStatic - FX_STATIC fallback rates
 * @param {object} [options] - { startingNAV: number }
 */
export function buildPortfolioYTDChart(portfolio, historicalData, fxStatic, options) {
  const mode = (options && options.mode) || 'ytd';

  // 'alltime' mode: silent simulation for 5Y chart splice — no chart rendering needed
  if (mode !== 'alltime') {
    const el = document.getElementById('portfolioYTDChart');
    if (!el) return;
    if (charts.portfolioYTD) { charts.portfolioYTD.destroy(); delete charts.portfolioYTD; }
    const _tt = document.getElementById('chartTooltip');
    if (_tt) _tt.style.opacity = '0';
  }

  // ── Determine simulation start date based on mode ──
  let START_DATE;
  if (mode === 'alltime') {
    // Start 1 day before the first IBKR deposit — ensures ALL deposits are included
    // by the `d.date > START_DATE` filter used in P&L cumDeposit computation.
    const firstDeposit = (portfolio.amine.ibkr.deposits || [])
      .filter(d => d.amount > 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const fd = new Date(firstDeposit?.date || '2025-04-08');
    fd.setDate(fd.getDate() - 1);
    START_DATE = fd.toISOString().slice(0, 10);
  } else if (mode === '1y') {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    START_DATE = d.toISOString().slice(0, 10);
  } else {
    START_DATE = '2026-01-01';
  }
  const todayStr = new Date().toISOString().slice(0, 10);

  // ── ESPP + SGTM scope options ──
  const includeESPP = options && options.includeESPP;
  const includeSGTM = options && options.includeSGTM;

  // ── IBKR starting NAV and cash (Jan 2, 2026) ──
  // STARTING_NAV: IBKR-reported NAV at YTD start
  // Cash values: traced from IBKR Activity Statement CSV (U18138426)
  //   EUR: computed by replaying all EUR-affecting transactions from account opening
  //        to Jan 2, 2026 (deposits, stock trades, FX trades, interest, fees, dividends)
  //   JPY/USD: IBKR cash balances at Jan 2 (before big Shiseido buys in Jan/Feb)
  // Note: EUR cash was previously derived as residual (NAV - positions - USD - JPY),
  //       but this accumulated ~1,534€ error due to Yahoo FX rates differing from IBKR's.
  //       Using the traced value eliminates this calibration drift.
  let STARTING_NAV = (options && options.startingNAV) || 209495;
  let IBKR_JPY_START = -1090000;
  let IBKR_USD_START = -4356;
  let IBKR_EUR_START_OVERRIDE = -17534;  // Traced from IBKR CSV — do NOT derive as residual

  // For 1Y/alltime mode: start from scratch (NAV = 0, all cash = 0)
  if (mode === '1y' || mode === 'alltime') {
    STARTING_NAV = 0;
    IBKR_JPY_START = 0;
    IBKR_USD_START = 0;
    IBKR_EUR_START_OVERRIDE = null; // no override — build from deposits/trades
  }

  // ── Ticker mapping: trade tickers → Yahoo Finance tickers ──
  // For 1Y: include all trades (sold positions too). For YTD: current positions only.
  const reverseMap = {}; // tradeTicker → yahooTicker
  portfolio.amine.ibkr.positions.forEach(p => { reverseMap[p.ticker] = p.ticker; });

  const tradesForMapping = mode === '1y'
    ? (portfolio.amine.ibkr.trades || [])
    : (portfolio.amine.ibkr.trades || []);

  tradesForMapping.forEach(t => {
    if (t.type === 'fx' || reverseMap[t.ticker]) return;
    if (t.currency === 'EUR' && !t.ticker.includes('.')) {
      reverseMap[t.ticker] = t.ticker + '.PA';
    } else {
      reverseMap[t.ticker] = t.ticker;
    }
  });

  // ── Build start-date holdings ──
  // For YTD: reverse 2026 trades to find Jan 1 positions
  // For 1Y: start with empty holdings (account didn't exist before Apr 1, 2025)
  const tradesStock = (portfolio.amine.ibkr.trades || [])
    .filter(t => t.type !== 'fx' && t.date >= START_DATE && t.date <= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  const startHoldings = {};
  if (mode === 'ytd') {
    // For YTD: start with current positions, reverse trades to find Jan 1 state
    portfolio.amine.ibkr.positions.forEach(p => {
      startHoldings[p.ticker] = { shares: p.shares, currency: p.currency };
    });
    [...tradesStock].reverse().forEach(t => {
      const yahoo = reverseMap[t.ticker] || t.ticker;
      if (!startHoldings[yahoo]) startHoldings[yahoo] = { shares: 0, currency: t.currency };
      if (t.type === 'buy') startHoldings[yahoo].shares -= t.qty;
      else if (t.type === 'sell') startHoldings[yahoo].shares += t.qty;
    });
    Object.keys(startHoldings).forEach(k => {
      if (startHoldings[k].shares <= 0) delete startHoldings[k];
    });
  }
  // For 1Y/alltime: startHoldings remains empty (account opens during the simulation)

  console.log('[ytd-chart] Start holdings (' + mode.toUpperCase() + '):', Object.entries(startHoldings).map(
    ([t, d]) => t + ':' + d.shares
  ).join(', '));

  // ── Collect trading dates from historical data ──
  let refDates = [];
  Object.values(historicalData.tickers).forEach(td => {
    if (td.dates.length > refDates.length) refDates = td.dates;
  });
  refDates = refDates.filter(d => d >= START_DATE && d <= todayStr);
  if (refDates.length === 0) { console.warn('[ytd-chart] No dates'); return; }

  // ── Price lookup helpers ──
  function getClose(ticker, date, allowForward) {
    const td = historicalData.tickers[ticker];
    if (!td) return null;
    const idx = td.dates.indexOf(date);
    if (idx >= 0) return td.closes[idx];
    // Search backwards for most recent date ≤ target
    for (let i = td.dates.length - 1; i >= 0; i--) {
      if (td.dates[i] <= date) return td.closes[i];
    }
    // If allowForward: use first available price (for markets closed on Jan 2, e.g. TSE)
    if (allowForward && td.closes.length > 0) {
      return td.closes[0];
    }
    return null;
  }

  function getFxRate(currency, date) {
    if (currency === 'EUR') return 1;
    const fxData = currency === 'USD' ? historicalData.fx.usd : historicalData.fx.jpy;
    if (!fxData) return currency === 'USD' ? (fxStatic.USD || 1.04) : (fxStatic.JPY || 161);
    const idx = fxData.dates.indexOf(date);
    if (idx >= 0 && fxData.closes[idx]) return fxData.closes[idx];
    for (let i = fxData.dates.length - 1; i >= 0; i--) {
      if (fxData.dates[i] <= date && fxData.closes[i]) return fxData.closes[i];
    }
    return currency === 'USD' ? (fxStatic.USD || 1.04) : (fxStatic.JPY || 161);
  }

  // ── SGTM key prices (MAD) - IPO Dec 2025, Casablanca Bourse ──
  // Sources: TradingView CSEMA:GTM, bmcecapitalbourse.com
  const SGTM_PRICES = [
    ['2025-12-16', 462], ['2025-12-20', 750], ['2025-12-26', 989],
    ['2025-12-31', 550], ['2026-01-02', 462], ['2026-01-15', 500],
    ['2026-02-01', 550], ['2026-02-15', 650], ['2026-03-01', 700],
    ['2026-03-13', 690], ['2026-03-16', 696], ['2026-03-18', 730],
    ['2026-03-19', 720],
  ];
  const SGTM_SHARES = (portfolio.amine.sgtm?.shares || 0) + (portfolio.nezha?.sgtm?.shares || 0);
  const EURMAD = fxStatic.MAD || 10.85;

  function getSgtmPrice(date) {
    // Find the key price entry for this date
    for (let i = 0; i < SGTM_PRICES.length; i++) {
      if (SGTM_PRICES[i][0] === date) return SGTM_PRICES[i][1];
    }
    // Linear interpolation between key prices
    for (let i = 0; i < SGTM_PRICES.length - 1; i++) {
      const [date1, price1] = SGTM_PRICES[i];
      const [date2, price2] = SGTM_PRICES[i + 1];
      if (date >= date1 && date <= date2) {
        const d1 = new Date(date1).getTime();
        const d2 = new Date(date2).getTime();
        const dCurrent = new Date(date).getTime();
        const ratio = (dCurrent - d1) / (d2 - d1);
        return price1 + (price2 - price1) * ratio;
      }
    }
    // If date is before the first SGTM price entry (pre-IPO), return 0
    if (date < SGTM_PRICES[0][0]) return 0;
    // Fallback to last known price if date is beyond range
    return SGTM_PRICES[SGTM_PRICES.length - 1][1];
  }

  // ── Compute day 1 positions value and calibrate starting EUR cash ──
  let day1PosValue = 0;
  let IBKR_EUR_START = 0;

  if (mode === 'ytd') {
    // For YTD: Prefer IBKR ytdOpen prices (exact Jan 2 close from IBKR) over Yahoo prices
    const ibkrYtdOpenMap = {};
    portfolio.amine.ibkr.positions.forEach(p => {
      if (p.ytdOpen) ibkrYtdOpenMap[p.ticker] = { price: p.ytdOpen, currency: p.currency };
    });

    const day1Prices = {};
    const day1Missing = [];
    Object.entries(startHoldings).forEach(([ticker, data]) => {
      // Prefer IBKR ytdOpen, fallback to Yahoo (with forward-fill for holidays)
      let price = ibkrYtdOpenMap[ticker]?.price;
      let source = 'ibkr';
      if (price == null) {
        price = getClose(ticker, refDates[0], true);
        source = 'yahoo';
      }
      if (price != null) {
        day1PosValue += data.shares * price / getFxRate(data.currency, refDates[0]);
        day1Prices[ticker] = { price, source };
      } else {
        day1Missing.push(ticker);
      }
    });
    if (day1Missing.length > 0) {
      console.warn('[ytd-chart] Day 1 calibration: still missing prices for', day1Missing.join(', '));
    }
    console.log('[ytd-chart] Day 1 price sources:', Object.entries(day1Prices).map(
      ([t, d]) => t + ':' + d.price + '(' + d.source + ')'
    ).join(', '));

    const day1FxUSD = getFxRate('USD', refDates[0]);
    const day1FxJPY = getFxRate('JPY', refDates[0]);
    const cashJPY_EUR_day1 = IBKR_JPY_START / day1FxJPY;
    const cashUSD_EUR_day1 = IBKR_USD_START / day1FxUSD;

    // ── EUR cash calibration ──
    // Use IBKR-traced EUR cash if available (more accurate than residual derivation).
    // The residual method (NAV - pos - USD - JPY) accumulates ~1,500€ error because
    // Yahoo FX rates differ from IBKR's rates for non-EUR position valuation.
    if (IBKR_EUR_START_OVERRIDE != null) {
      IBKR_EUR_START = IBKR_EUR_START_OVERRIDE;
      // Recompute STARTING_NAV to match (ensures simulation NAV is consistent)
      STARTING_NAV = day1PosValue + IBKR_EUR_START + cashUSD_EUR_day1 + cashJPY_EUR_day1;
      console.log('[ytd-chart] Day 1 calibration (IBKR-traced EUR cash):',
        'NAV=' + Math.round(STARTING_NAV) + ' (recomputed)',
        'Pos=' + Math.round(day1PosValue),
        'EUR_cash=' + Math.round(IBKR_EUR_START) + ' (from IBKR CSV)',
        'USD_cash=' + Math.round(cashUSD_EUR_day1),
        'JPY_cash=' + Math.round(cashJPY_EUR_day1));
    } else {
      // Fallback: derive EUR cash as residual from IBKR NAV
      IBKR_EUR_START = STARTING_NAV - day1PosValue - cashUSD_EUR_day1 - cashJPY_EUR_day1;
      console.log('[ytd-chart] Day 1 calibration (residual EUR cash):',
        'NAV=' + STARTING_NAV,
        'Pos=' + Math.round(day1PosValue),
        'EUR_cash=' + Math.round(IBKR_EUR_START),
        'USD_cash=' + Math.round(cashUSD_EUR_day1),
        'JPY_cash=' + Math.round(cashJPY_EUR_day1));
    }
  } else {
    // For 1Y: start from scratch, IBKR_EUR_START = 0
    console.log('[ytd-chart] 1Y mode: starting from 0, all cash = 0');
  }

  // ── Build all events (stock trades + FX trades + deposits) sorted by date ──
  const allEvents = [];

  tradesStock.forEach(t => {
    const yahoo = reverseMap[t.ticker] || t.ticker;
    allEvents.push({
      date: t.date, eventType: t.type, ticker: yahoo, currency: t.currency,
      qty: t.qty, cost: t.cost, proceeds: t.proceeds,
      price: t.price, commission: t.commission || 0,
    });
  });

  (portfolio.amine.ibkr.trades || [])
    .filter(t => t.type === 'fx' && t.date >= START_DATE && t.date <= todayStr)
    .forEach(t => {
      allEvents.push({
        date: t.date, eventType: 'fx', ticker: t.ticker,
        qty: t.qty, price: t.price, currency: t.currency,
        jpyAmount: t.jpyAmount,
        targetAmount: t.targetAmount,
        commission: t.commission || 0,
      });
    });

  (portfolio.amine.ibkr.deposits || [])
    .filter(d => d.date >= START_DATE && d.date <= todayStr)
    .forEach(d => {
      allEvents.push({
        date: d.date,
        eventType: 'deposit',
        amount: d.amount,
        currency: d.currency || 'EUR',
        fxRateAtDate: d.fxRateAtDate || 1,
      });
    });

  // ── IBKR costs from data.js (interest, dividends) + dynamic FTT ──
  const ibkrCostsFromData = (portfolio.amine.ibkr.costs || []).filter(c => c.date >= START_DATE);
  ibkrCostsFromData.forEach(c => {
    allEvents.push({
      date: c.date, eventType: 'cost',
      eurAmount: c.eurAmount || 0,
      usdAmount: c.usdAmount || 0,
      jpyAmount: c.jpyAmount || 0,
      label: c.label,
    });
  });
  // Dynamic FTT: compute from buy trades (0.4% on FTT-eligible French large-cap stocks)
  // Rate: 0.4% (not 0.3%) — IBKR charges 0.4% including their collection fee
  // Source: verified vs IBKR Activity Statement "Transaction Fees" section
  const FTT_ELIGIBLE_CHART = new Set(['MC.PA','DG.PA','FGR.PA','GLE','SAN.PA','EDEN','RMS.PA','OR.PA','BN.PA','WLN','AIR.PA']);
  tradesStock.forEach(t => {
    if (t.type === 'buy' && FTT_ELIGIBLE_CHART.has(reverseMap[t.ticker] || t.ticker)) {
      const ftt = (t.cost || 0) * 0.004;  // 0.4% — matches engine.js FTT_RATE
      allEvents.push({
        date: t.date, eventType: 'cost',
        eurAmount: -ftt, usdAmount: 0, jpyAmount: 0,
        label: 'FTT ' + (t.label || t.ticker),
      });
    }
  });
  // Keep reference for KPI costs (backward compat with app.js)
  const ibkrCostsYTD = [...ibkrCostsFromData.map(c => ({
    ...c, eventType: 'cost',
  }))];
  // Add computed FTT items for the costItems export
  tradesStock.forEach(t => {
    if (t.type === 'buy' && FTT_ELIGIBLE_CHART.has(reverseMap[t.ticker] || t.ticker)) {
      ibkrCostsYTD.push({
        date: t.date, type: 'ftt', eventType: 'cost',
        eurAmount: -(t.cost || 0) * 0.004, usdAmount: 0, jpyAmount: 0,
        label: 'FTT ' + (t.label || t.ticker),
      });
    }
  });

  allEvents.sort((a, b) => a.date.localeCompare(b.date));

  // ── Forward simulation ──
  const holdings = {};
  Object.entries(startHoldings).forEach(([t, d]) => {
    holdings[t] = { shares: d.shares, currency: d.currency };
  });

  let cashEUR = IBKR_EUR_START;
  let cashUSD = IBKR_USD_START;
  let cashJPY = IBKR_JPY_START;
  let eventIdx = 0;

  const chartLabels = [];
  const chartValues = [];       // IBKR-only NAV per day
  const chartValuesTotal = [];  // IBKR + ESPP + SGTM combined
  const chartValuesESPP = [];   // ESPP-only valuation per day
  const chartValuesSGTM = [];   // SGTM/Maroc-only valuation per day

  // Setup ESPP data — shares evolve dynamically with lot acquisition dates
  const allESPPLots = [
    ...(portfolio.amine.espp?.lots || []),
    ...(portfolio.nezha?.espp?.lots || []),
  ].sort((a, b) => a.date.localeCompare(b.date)); // chronological
  const ESPP_CASH_EUR = portfolio.amine.espp?.cashEUR || 0;
  const ESPP_CASH_USD = portfolio.nezha?.espp?.cashUSD || 0;

  // Function: compute ESPP shares held at a given date
  function esppSharesAtDate(date) {
    return allESPPLots
      .filter(lot => lot.date <= date)
      .reduce((sum, lot) => sum + lot.shares, 0);
  }

  // ── Snapshot storage for per-period breakdown computation ──
  const _simSnapshots = {};

  for (const date of refDates) {
    // Apply events up to and including this date
    while (eventIdx < allEvents.length && allEvents[eventIdx].date <= date) {
      const e = allEvents[eventIdx];

      if (e.eventType === 'buy') {
        // Position increases, cash decreases
        if (!holdings[e.ticker]) holdings[e.ticker] = { shares: 0, currency: e.currency };
        holdings[e.ticker].shares += e.qty;
        const totalCost = e.cost || (e.qty * e.price);
        const comm = e.commission || 0; // negative number
        if (e.currency === 'EUR') { cashEUR -= totalCost; cashEUR += comm; }
        else if (e.currency === 'USD') { cashUSD -= totalCost; cashUSD += comm; }
        else if (e.currency === 'JPY') { cashJPY -= totalCost; cashJPY += comm; }

      } else if (e.eventType === 'sell') {
        // Position decreases, cash increases
        if (holdings[e.ticker]) {
          holdings[e.ticker].shares -= e.qty;
          if (holdings[e.ticker].shares <= 0) delete holdings[e.ticker];
        }
        const totalProceeds = e.proceeds || (e.qty * e.price);
        const comm = e.commission || 0;
        if (e.currency === 'EUR') { cashEUR += totalProceeds; cashEUR += comm; }
        else if (e.currency === 'USD') { cashUSD += totalProceeds; cashUSD += comm; }

      } else if (e.eventType === 'fx') {
        // ── FX trade direction depends on jpyAmount sign ──
        // jpyAmount < 0 → opening short JPY: borrow JPY, RECEIVE source currency (EUR/USD)
        //   cashEUR/USD INCREASES by qty, cashJPY DECREASES by |jpyAmount|
        // jpyAmount > 0 → closing short (deleverage): SPEND source currency, buy back JPY
        //   cashEUR/USD DECREASES by qty, cashJPY INCREASES by jpyAmount
        const comm = e.commission || 0;
        if (e.ticker.startsWith('EUR.JPY') || (e.ticker.startsWith('EUR') && e.jpyAmount !== undefined)) {
          if (e.jpyAmount < 0) {
            cashEUR += e.qty;   // receive EUR from JPY short
          } else {
            cashEUR -= e.qty;   // spend EUR to buy back JPY
          }
          cashJPY += e.jpyAmount;
          cashEUR += comm;      // IBKR commissions in base currency (EUR)
        } else if (e.ticker.startsWith('USD.JPY') || (e.ticker.startsWith('USD') && e.jpyAmount !== undefined)) {
          if (e.jpyAmount < 0) {
            cashUSD += e.qty;   // receive USD from JPY short
          } else {
            cashUSD -= e.qty;   // spend USD to buy back JPY
          }
          cashJPY += e.jpyAmount;
          cashEUR += comm;      // IBKR commissions always in base currency (EUR)
        } else if (e.ticker === 'EUR.USD') {
          // EUR→USD conversion: sell EUR, get USD
          cashEUR -= e.qty;
          cashUSD += (e.targetAmount || e.qty * e.price);
          cashEUR += comm;
        } else if (e.ticker === 'EUR.AED') {
          // AED→EUR conversion: user deposits AED then buys EUR
          // IBKR statement shows positive qty = EUR bought (paying AED)
          // So this ADDS to cashEUR (buying EUR with AED)
          // AED cash is not tracked in the chart (goes to 0 after conversion)
          cashEUR += e.qty;
          cashEUR += comm;
        }

      } else if (e.eventType === 'deposit') {
        if (e.currency && e.currency !== 'EUR') {
          // Non-EUR deposits (e.g. AED): don't add to cashEUR directly.
          // The corresponding FX conversion trade (EUR.AED) handles the EUR credit.
          // This avoids double-counting.
        } else {
          cashEUR += e.amount;
        }

      } else if (e.eventType === 'cost') {
        // Interest, FTT, dividends — affect cash in respective currencies
        cashEUR += (e.eurAmount || 0);
        cashUSD += (e.usdAmount || 0);
        cashJPY += (e.jpyAmount || 0);
      }

      eventIdx++;
    }

    // ── Compute NAV for this day ──
    // Positions value
    let posValue = 0;
    let missingTickers = [];
    const posBreakdown = {}; // for diagnostics + breakdown snapshots
    Object.entries(holdings).forEach(([ticker, data]) => {
      if (data.shares <= 0) return;
      const price = getClose(ticker, date, true); // allowForward for early dates (TSE closed Jan 2-3)
      if (price == null) { missingTickers.push(ticker); return; }
      const fxRate = getFxRate(data.currency, date);
      const valEUR = data.shares * price / fxRate;
      posValue += valEUR;
      posBreakdown[ticker] = { shares: data.shares, price, currency: data.currency, fxRate, valEUR: Math.round(valEUR) };
    });

    // Cash value in EUR
    const fxUSD = getFxRate('USD', date);
    const fxJPY = getFxRate('JPY', date);
    const cashValue = cashEUR + cashUSD / fxUSD + cashJPY / fxJPY;

    const nav = Math.round(posValue + cashValue);
    chartLabels.push(date);
    chartValues.push(nav);

    // ── Store snapshot for breakdown computation ──
    // We store per-date snapshots: position values + cash state
    // These are used after the loop to compute per-period M2M breakdowns
    _simSnapshots[date] = {
      posBreakdown: { ...posBreakdown }, // shallow copy per-ticker objects
      cashEUR, cashUSD, cashJPY,
      fxUSD, fxJPY,
      cashValueEUR: Math.round(cashValue),
      posValueEUR: Math.round(posValue),
      nav,
    };

    // ── Detailed diagnostics for specific dates ──
    if (date === '2026-03-19' || date === '2026-03-18' || date === '2026-01-02') {
      console.log('[ytd-diag] === ' + date + ' ===');
      console.log('[ytd-diag] Positions (ticker: shares × price / fx = EUR):');
      Object.entries(posBreakdown).sort((a,b) => b[1].valEUR - a[1].valEUR).forEach(([t, d]) => {
        console.log('  ' + t + ': ' + d.shares + ' × ' + d.price.toFixed(2) + ' ' + d.currency + ' / ' + d.fxRate.toFixed(4) + ' = ' + d.valEUR + ' EUR');
      });
      console.log('[ytd-diag] Pos total: ' + Math.round(posValue) + ' EUR');
      console.log('[ytd-diag] Cash: EUR=' + Math.round(cashEUR) + ', USD=' + Math.round(cashUSD) + ' (/' + fxUSD.toFixed(4) + '=' + Math.round(cashUSD/fxUSD) + '), JPY=' + Math.round(cashJPY) + ' (/' + fxJPY.toFixed(4) + '=' + Math.round(cashJPY/fxJPY) + ')');
      console.log('[ytd-diag] Cash total: ' + Math.round(cashValue) + ' EUR');
      console.log('[ytd-diag] NAV: ' + nav + ' EUR');
      if (missingTickers.length) console.log('[ytd-diag] Missing: ' + missingTickers.join(', '));
    }

    // ── Compute ESPP value (always, regardless of scope — needed for Tous & ESPP views) ──
    // Shares evolve dynamically: only count lots acquired by this date
    let esppValue = 0;
    const esppSharesNow = esppSharesAtDate(date);
    if (esppSharesNow > 0) {
      const acnPrice = getClose('ACN', date);
      if (acnPrice != null) {
        esppValue = esppSharesNow * acnPrice / getFxRate('USD', date) + ESPP_CASH_EUR + ESPP_CASH_USD / getFxRate('USD', date);
      }
    }
    chartValuesESPP.push(Math.round(esppValue));

    // ── Compute SGTM value (always, regardless of scope — needed for Tous & Maroc views) ──
    // SGTM shares only exist after IPO date (2025-12-15)
    let sgtmValue = 0;
    const SGTM_IPO_DATE = '2025-12-15';
    if (SGTM_SHARES > 0 && date >= SGTM_IPO_DATE) {
      const sgtmPrice = getSgtmPrice(date);
      sgtmValue = SGTM_SHARES * sgtmPrice / EURMAD;
    }
    chartValuesSGTM.push(Math.round(sgtmValue));

    // ── Total NAV (IBKR + ESPP + SGTM combined) ──
    const navTotal = Math.round(nav + esppValue + sgtmValue);
    chartValuesTotal.push(navTotal);
  }

  if (chartLabels.length === 0) return;

  // ── Weekly sampling for 1Y/alltime mode (reduce ~250 points → ~52) ──
  // Keeps simulation daily for accuracy, but thins out chart data
  if ((mode === '1y' || mode === 'alltime') && chartLabels.length > 60) {
    const weeklyLabels = [chartLabels[0]];
    const weeklyValues = [chartValues[0]];
    const weeklyTotals = [chartValuesTotal[0]];
    const weeklyESPP = [chartValuesESPP[0]];
    const weeklySGTM = [chartValuesSGTM[0]];
    for (let i = 7; i < chartLabels.length - 1; i += 7) {
      weeklyLabels.push(chartLabels[i]);
      weeklyValues.push(chartValues[i]);
      weeklyTotals.push(chartValuesTotal[i]);
      weeklyESPP.push(chartValuesESPP[i]);
      weeklySGTM.push(chartValuesSGTM[i]);
    }
    // Always include the last point
    const last = chartLabels.length - 1;
    weeklyLabels.push(chartLabels[last]);
    weeklyValues.push(chartValues[last]);
    weeklyTotals.push(chartValuesTotal[last]);
    weeklyESPP.push(chartValuesESPP[last]);
    weeklySGTM.push(chartValuesSGTM[last]);
    chartLabels.length = 0; chartLabels.push(...weeklyLabels);
    chartValues.length = 0; chartValues.push(...weeklyValues);
    chartValuesTotal.length = 0; chartValuesTotal.push(...weeklyTotals);
    chartValuesESPP.length = 0; chartValuesESPP.push(...weeklyESPP);
    chartValuesSGTM.length = 0; chartValuesSGTM.push(...weeklySGTM);
  }

  // ── Compute P&L series: P&L(t) = NAV(t) - startNAV - cumDeposits_after_start(t) ──
  // Only count deposits STRICTLY AFTER START_DATE — deposits on or before
  // START_DATE are already reflected in startNAV, so including them would
  // double-count and make P&L(0) = -deposit instead of 0.

  // ── 1. IBKR deposits (for IBKR-only P&L) ──
  const allDepositsEUR = {};
  (portfolio.amine.ibkr.deposits || [])
    .filter(d => d.date > START_DATE && d.date <= todayStr)
    .forEach(d => {
      const amtEUR = (d.currency && d.currency !== 'EUR')
        ? d.amount / (d.fxRateAtDate || 1)
        : d.amount;
      allDepositsEUR[d.date] = (allDepositsEUR[d.date] || 0) + amtEUR;
    });

  // ── 2. ESPP acquisition costs (for Total P&L) ──
  // v246: use contribEUR (actual EUR salary deductions) where available
  // This matches engine.js deposit computation — ensures chart P&L = card P&L
  // For lots without contribEUR (Nezha, FRAC), fallback to costBasis/fxRate
  const allTotalDepositsEUR = { ...allDepositsEUR }; // starts with IBKR deposits
  allESPPLots
    .filter(lot => lot.date > START_DATE && lot.date <= todayStr)
    .forEach(lot => {
      let costEUR;
      if (lot.contribEUR !== undefined) {
        costEUR = lot.contribEUR; // Exact EUR from salary (Amine lots)
      } else {
        // Fallback: costBasis × shares / fxRate (Nezha lots, FRAC)
        const isNezha = (portfolio.nezha?.espp?.lots || []).includes(lot);
        const defaultFx = isNezha ? 1.10 : 1.15;
        costEUR = (lot.shares * lot.costBasis) / (lot.fxRateAtDate || defaultFx);
      }
      allTotalDepositsEUR[lot.date] = (allTotalDepositsEUR[lot.date] || 0) + costEUR;
    });

  // ── 2b. Degiro deposits/withdrawals ──
  // NOT included in allTotalDepositsEUR because:
  //   - chartValuesTotal tracks IBKR+ESPP+SGTM NAV only (no Degiro NAV)
  //   - Degiro P&L is handled separately as a constant (+51,079 realized)
  //   - Including Degiro deposits here would break the P&L formula:
  //     plValuesTotal = NAV_change - cumDeposits (NAV has no Degiro, but deposits would)
  //   - The Degiro withdrawal (-101,079 on 2025-04-14) was incorrectly inflating
  //     Tous 1Y P&L by +101K (subtracted as negative deposit → added to P&L)

  // ── 3. SGTM acquisition costs (for Total P&L) ──
  // SGTM IPO Dec 2025 — all shares acquired at sgtmCostBasisMAD
  const sgtmCostMAD = portfolio.market?.sgtmCostBasisMAD || 0;
  const sgtmTotalShares = (portfolio.amine.sgtm?.shares || 0) + (portfolio.nezha?.sgtm?.shares || 0);
  if (sgtmCostMAD > 0 && sgtmTotalShares > 0) {
    // IPO date approximation — Dec 2025
    const sgtmIPODate = '2025-12-15';
    if (sgtmIPODate > START_DATE && sgtmIPODate <= todayStr) {
      const sgtmCostEUR = sgtmTotalShares * sgtmCostMAD / (fxStatic.MAD || 10.85);
      allTotalDepositsEUR[sgtmIPODate] = (allTotalDepositsEUR[sgtmIPODate] || 0) + sgtmCostEUR;
    }
  }

  // ── Compute cumulative deposits at each chart point ──
  // Two series: IBKR-only and Total (IBKR + ESPP + SGTM)
  let cumDep = 0;
  let cumDepTotal = 0;
  const cumDepositsAtPoint = [];
  const cumDepositsAtPointTotal = [];
  for (let i = 0; i < chartLabels.length; i++) {
    const prevDate = i === 0 ? START_DATE : chartLabels[i - 1];
    const curDate = chartLabels[i];
    for (const [dDate, dAmt] of Object.entries(allDepositsEUR)) {
      if (dDate > prevDate && dDate <= curDate) {
        cumDep += dAmt;
      }
    }
    for (const [dDate, dAmt] of Object.entries(allTotalDepositsEUR)) {
      if (dDate > prevDate && dDate <= curDate) {
        cumDepTotal += dAmt;
      }
    }
    cumDepositsAtPoint.push(cumDep);
    cumDepositsAtPointTotal.push(cumDepTotal);
  }

  // ── Track ESPP deposits separately ──
  // v246: same contribEUR logic as above for consistency
  const allDepositsESPP = {};
  allESPPLots
    .filter(lot => lot.date > START_DATE && lot.date <= todayStr)
    .forEach(lot => {
      let costEUR;
      if (lot.contribEUR !== undefined) {
        costEUR = lot.contribEUR;
      } else {
        const isNezha = (portfolio.nezha?.espp?.lots || []).includes(lot);
        const defaultFx = isNezha ? 1.10 : 1.15;
        costEUR = (lot.shares * lot.costBasis) / (lot.fxRateAtDate || defaultFx);
      }
      allDepositsESPP[lot.date] = (allDepositsESPP[lot.date] || 0) + costEUR;
    });

  // ── Track SGTM deposits separately ──
  const allDepositsSGTM = {};
  if (sgtmCostMAD > 0 && sgtmTotalShares > 0) {
    const sgtmIPODate = '2025-12-15';
    if (sgtmIPODate > START_DATE && sgtmIPODate <= todayStr) {
      const sgtmCostEUR = sgtmTotalShares * sgtmCostMAD / (fxStatic.MAD || 10.85);
      allDepositsSGTM[sgtmIPODate] = (allDepositsSGTM[sgtmIPODate] || 0) + sgtmCostEUR;
    }
  }

  // ── Compute cumulative ESPP deposits at each chart point ──
  let cumDepESPP = 0;
  const cumDepositsESPP = [];
  for (let i = 0; i < chartLabels.length; i++) {
    const prevDate = i === 0 ? START_DATE : chartLabels[i - 1];
    const curDate = chartLabels[i];
    for (const [dDate, dAmt] of Object.entries(allDepositsESPP)) {
      if (dDate > prevDate && dDate <= curDate) {
        cumDepESPP += dAmt;
      }
    }
    cumDepositsESPP.push(cumDepESPP);
  }

  // ── Compute cumulative SGTM deposits at each chart point ──
  let cumDepSGTM = 0;
  const cumDepositsSGTM = [];
  for (let i = 0; i < chartLabels.length; i++) {
    const prevDate = i === 0 ? START_DATE : chartLabels[i - 1];
    const curDate = chartLabels[i];
    for (const [dDate, dAmt] of Object.entries(allDepositsSGTM)) {
      if (dDate > prevDate && dDate <= curDate) {
        cumDepSGTM += dAmt;
      }
    }
    cumDepositsSGTM.push(cumDepSGTM);
  }

  // P&L IBKR = NAV(t) - NAV(start) - cumDeposits_IBKR(t)
  const startNAVRef = chartValues[0];
  const plValuesIBKR = chartValues.map((nav, i) => Math.round(nav - startNAVRef - cumDepositsAtPoint[i]));

  // P&L ESPP = NAV(t) - NAV(start) - cumDeposits_ESPP(t)
  const startNAVRefESPP = chartValuesESPP[0];
  const plValuesESPP = chartValuesESPP.map((nav, i) => Math.round(nav - startNAVRefESPP - cumDepositsESPP[i]));

  // P&L SGTM = NAV(t) - NAV(start) - cumDeposits_SGTM(t)
  const startNAVRefSGTM = chartValuesSGTM[0];
  const plValuesSGTM = chartValuesSGTM.map((nav, i) => Math.round(nav - startNAVRefSGTM - cumDepositsSGTM[i]));

  // P&L Total = NAV_total(t) - NAV_total(start) - cumDeposits_Total(t)
  // Uses cumDepositsAtPointTotal which includes ESPP lots + SGTM IPO cost
  const startNAVRefTotal = chartValuesTotal.length > 0 ? chartValuesTotal[0] : chartValues[0];
  const plValuesTotal = chartValuesTotal.length > 0
    ? chartValuesTotal.map((nav, i) => Math.round(nav - startNAVRefTotal - cumDepositsAtPointTotal[i]))
    : plValuesIBKR;

  // ── Compute per-period breakdown from simulation snapshots ──
  // This provides position-level M2M that exactly reconciles with chart P&L
  // (same Yahoo prices, same FX rates as the NAV simulation)
  {
    const lastDate = chartLabels[chartLabels.length - 1];
    const firstDate = chartLabels[0];
    // IMPORTANT: use lastDate (last chart label) as reference, NOT today
    // This matches updateKPIsFromChart in app.js which uses lastDateObj
    const lastDateObj = new Date(lastDate);

    // Build ticker → label map from data.js positions
    const tickerLabelMap = {};
    portfolio.amine.ibkr.positions.forEach(p => {
      tickerLabelMap[p.ticker] = p.label || p.ticker;
    });
    // Also map traded tickers that might not be in current positions
    (portfolio.amine.ibkr.trades || []).forEach(t => {
      if (t.type === 'fx') return;
      const yahoo = reverseMap[t.ticker] || t.ticker;
      if (!tickerLabelMap[yahoo]) tickerLabelMap[yahoo] = t.label || t.ticker;
    });

    // Period boundary dates (use closest available chart date)
    function closestDate(target, direction) {
      // direction: 'before' = last date <= target, 'after' = first date >= target
      if (direction === 'before') {
        let best = firstDate;
        for (const d of chartLabels) {
          if (d <= target) best = d; else break;
        }
        return best;
      } else {
        for (const d of chartLabels) {
          if (d >= target) return d;
        }
        return lastDate;
      }
    }

    // Previous trading day
    const lastIdx = chartLabels.length - 1;
    const prevTradingDay = lastIdx >= 1 ? chartLabels[lastIdx - 1] : firstDate;

    // MTD start: use lastDate's month start (matching app.js which uses lastDate.slice(0,8)+'01')
    const mtdStartStr2 = lastDate.slice(0, 8) + '01';
    const mtdRefDate = mtdStartStr2 < firstDate ? firstDate : mtdStartStr2;
    const mtdStartActual = chartLabels.find(d => d >= mtdRefDate) || firstDate;
    const mtdStartDate = chartLabels[Math.max(0, chartLabels.indexOf(mtdStartActual) - 1)] || firstDate;

    // 1M start: use lastDate as reference (matching app.js: new Date(lastDateObj).setMonth(-1))
    const oneMAgo = new Date(lastDateObj);
    oneMAgo.setMonth(oneMAgo.getMonth() - 1);
    const oneMStartStr = oneMAgo.toISOString().slice(0, 10);
    // Match app.js: find first label >= oneMonthStr, then go back 1
    const oneMFirstGE = chartLabels.find(d => d >= oneMStartStr) || firstDate;
    const oneMStartDate = chartLabels[Math.max(0, chartLabels.indexOf(oneMFirstGE) - 1)] || firstDate;

    // YTD start: first chart date (Jan 2)
    const ytdStartDate = firstDate;

    // 1Y start: same as first chart date for 1y mode, or compute
    const oneYAgo = new Date(lastDateObj);
    oneYAgo.setFullYear(oneYAgo.getFullYear() - 1);
    const oneYStartStr = oneYAgo.toISOString().slice(0, 10);
    const oneYStartDate = closestDate(oneYStartStr, 'after');

    // Deposits in date range (exclusive start, inclusive end)
    function depositsInRange(startD, endD) {
      let total = 0;
      for (const [dDate, dAmt] of Object.entries(allDepositsEUR)) {
        if (dDate > startD && dDate <= endD) total += dAmt;
      }
      return total;
    }

    // Compute breakdown for a period [startDateSnap, endDateSnap]
    function computePeriodBreakdown(startDateSnap, endDateSnap, periodKey) {
      const snapStart = _simSnapshots[startDateSnap];
      const snapEnd = _simSnapshots[endDateSnap];
      if (!snapStart || !snapEnd) {
        console.warn('[breakdown] Missing snapshot for', periodKey, ':', startDateSnap, '->', endDateSnap);
        return null;
      }

      // Collect all tickers that appear at start or end
      const allTickers = new Set([
        ...Object.keys(snapStart.posBreakdown),
        ...Object.keys(snapEnd.posBreakdown),
      ]);

      // ── Compute net trade flows per ticker during the period ──
      // This is the net capital invested: buys add, sells subtract.
      // We need this to compute true P&L = (endVal - startVal) - netInvestment
      // Without this correction, positions bought during the period show their
      // full market value as "gain" (because startVal=0), which is wrong.
      const tradeFlows = {}; // ticker -> net EUR invested (positive = capital in)
      allEvents.forEach(e => {
        if (e.date > startDateSnap && e.date <= endDateSnap) {
          if (e.eventType === 'buy') {
            const cost = e.cost || (e.qty * e.price);
            const snap = _simSnapshots[e.date];
            let costEUR;
            if (e.currency === 'EUR') costEUR = cost;
            else if (e.currency === 'USD') costEUR = cost / (snap?.fxUSD || 1.1);
            else if (e.currency === 'JPY') costEUR = cost / (snap?.fxJPY || 160);
            else costEUR = cost;
            tradeFlows[e.ticker] = (tradeFlows[e.ticker] || 0) + costEUR;
          } else if (e.eventType === 'sell') {
            const proceeds = e.proceeds || (e.qty * e.price);
            const snap = _simSnapshots[e.date];
            let procEUR;
            if (e.currency === 'EUR') procEUR = proceeds;
            else if (e.currency === 'USD') procEUR = proceeds / (snap?.fxUSD || 1.1);
            else if (e.currency === 'JPY') procEUR = proceeds / (snap?.fxJPY || 160);
            else procEUR = proceeds;
            tradeFlows[e.ticker] = (tradeFlows[e.ticker] || 0) - procEUR;
          }
        }
      });

      const items = [];
      let totalPosM2M = 0;

      allTickers.forEach(ticker => {
        const startVal = snapStart.posBreakdown[ticker]?.valEUR || 0;
        const endVal = snapEnd.posBreakdown[ticker]?.valEUR || 0;
        const netFlow = tradeFlows[ticker] || 0;
        // True P&L = value change minus capital invested/withdrawn
        // e.g. bought IBIT for €46K, now worth €41K → P&L = 41K - 0 - 46K = -5K
        const m2m = endVal - startVal - netFlow;
        if (Math.abs(m2m) >= 0.5) {
          // Capital deployed = startVal + net capital injected during period
          const capitalDeployed = startVal + netFlow;
          const pct = capitalDeployed > 0 ? (m2m / capitalDeployed * 100) : null;
          items.push({
            label: tickerLabelMap[ticker] || ticker,
            ticker: ticker,
            pl: Math.round(m2m),
            pct: pct !== null ? Math.round(pct * 10) / 10 : null,
            startVal: Math.round(startVal),
            endVal: Math.round(endVal),
            valEUR: endVal,
          });
          totalPosM2M += m2m;
        }
      });

      // Cash M2M = change in total cash value in EUR
      const cashM2MStart = snapStart.cashValueEUR;
      const cashM2MEnd = snapEnd.cashValueEUR;
      const deposits = depositsInRange(startDateSnap, endDateSnap);
      // Cash change due to market (FX) = cashEnd - cashStart - deposits + cost-of-trades
      // But trades move value between cash and positions, so they cancel out in total NAV
      // The FX effect on cash = (cashEnd - cashStart) - deposits - (net trade flows)
      // However, trade flows are already captured in position M2M, so:
      // FX on cash = chartPL - posM2M (residual approach, always exact)

      const chartPL = snapEnd.nav - snapStart.nav - deposits;
      const fxOnCash = chartPL - Math.round(totalPosM2M);

      // Costs are already embedded in position M2M and cash flows
      // (commissions reduce cash, which reduces NAV → captured in the residual)
      // We extract cost items separately for display

      // Aggregate costs in the period
      const periodCosts = { interest: 0, ftt: 0, dividends: 0, commissions: 0,
        interestItems: [], fttItems: [], divItems: [], commItems: [] };
      ibkrCostsYTD.forEach(c => {
        if (c.date > startDateSnap && c.date <= endDateSnap) {
          if (c.label && c.label.startsWith('Interest')) {
            const amt = (c.eurAmount || 0) + (c.usdAmount || 0) / (snapEnd.fxUSD || 1.1) + (c.jpyAmount || 0) / (snapEnd.fxJPY || 160);
            periodCosts.interest += amt;
            periodCosts.interestItems.push({ date: c.date, label: c.label, amount: Math.round(amt) });
          } else if (c.label && c.label.startsWith('FTT')) {
            periodCosts.ftt += c.eurAmount || 0;
            periodCosts.fttItems.push({ date: c.date, label: c.label, amount: Math.round(c.eurAmount || 0) });
          } else if (c.label && c.label.startsWith('Div')) {
            periodCosts.dividends += c.eurAmount || 0;
            periodCosts.divItems.push({ date: c.date, label: c.label, amount: Math.round(c.eurAmount || 0) });
          }
        }
      });
      // Commissions from trades
      (portfolio.amine.ibkr.trades || []).forEach(t => {
        if (t.date > startDateSnap && t.date <= endDateSnap && t.commission) {
          periodCosts.commissions += t.commission; // negative number
          periodCosts.commItems.push({
            date: t.date,
            label: (t.label || t.ticker) + ' (' + t.type + ')',
            amount: Math.round(t.commission),
          });
        }
      });

      // Add cost items to breakdown (as _isCost items, like engine.js does)
      if (Math.abs(periodCosts.interest) >= 1) {
        items.push({ label: 'Intérêts marge', ticker: '_INTEREST', pl: Math.round(periodCosts.interest), _isCost: true, _detail: periodCosts.interestItems });
      }
      if (Math.abs(periodCosts.ftt) >= 1) {
        items.push({ label: 'Taxe transactions (FTT)', ticker: '_FTT', pl: Math.round(periodCosts.ftt), _isCost: true, _detail: periodCosts.fttItems });
      }
      if (Math.abs(periodCosts.commissions) >= 1) {
        items.push({ label: 'Commissions IBKR', ticker: '_COMM', pl: Math.round(periodCosts.commissions), _isCost: true, _detail: periodCosts.commItems });
      }
      if (Math.abs(periodCosts.dividends) >= 1) {
        items.push({ label: 'Dividendes nets', ticker: '_DIV', pl: Math.round(periodCosts.dividends), _isCost: true, _detail: periodCosts.divItems });
      }

      // Add FX/Cash residual as a line item (captures JPY carry FX, USD FX, EUR interest effect)
      // Only show if non-trivial
      if (Math.abs(fxOnCash) >= 1) {
        // ── Decompose JPY/USD into "pure FX effect" vs "cash flow effect" ──
        // Pure FX = same cash balance, different exchange rate
        // Cash flow = additional borrowing/repayment valued at new FX rate
        // This avoids misleading display: e.g. -19K JPY "effect" is mostly
        // increased JPY borrowing to buy Shiseido, not currency movement.
        const jpyTotal = Math.round(snapEnd.cashJPY / snapEnd.fxJPY - snapStart.cashJPY / snapStart.fxJPY);
        const usdTotal = Math.round(snapEnd.cashUSD / snapEnd.fxUSD - snapStart.cashUSD / snapStart.fxUSD);

        // Decompose JPY: iterate through snapshots for accurate day-by-day attribution
        let jpyFxEffect = 0, jpyFlowEffect = 0;
        let usdFxEffect = 0, usdFlowEffect = 0;
        const periodDates = chartLabels.filter(d => d >= startDateSnap && d <= endDateSnap);
        let prevSnap = _simSnapshots[startDateSnap];
        for (let i = 1; i < periodDates.length; i++) {
          const curSnap = _simSnapshots[periodDates[i]];
          if (!curSnap || !prevSnap) { prevSnap = curSnap; continue; }
          // FX effect: same cash, new rate
          jpyFxEffect += prevSnap.cashJPY / curSnap.fxJPY - prevSnap.cashJPY / prevSnap.fxJPY;
          // Flow effect: new cash at new rate
          jpyFlowEffect += (curSnap.cashJPY - prevSnap.cashJPY) / curSnap.fxJPY;
          // Same for USD
          usdFxEffect += prevSnap.cashUSD / curSnap.fxUSD - prevSnap.cashUSD / prevSnap.fxUSD;
          usdFlowEffect += (curSnap.cashUSD - prevSnap.cashUSD) / curSnap.fxUSD;
          prevSnap = curSnap;
        }

        // Build detail items with sub-decomposition for JPY if borrowing changed significantly
        const jpyDetail = [];
        const jpyBorrowingChanged = Math.abs(snapEnd.cashJPY - snapStart.cashJPY) > 100000;
        if (jpyBorrowingChanged) {
          // Show JPY sub-breakdown: FX movement vs borrowing change
          jpyDetail.push({
            label: 'JPY — effet change (¥ ' + Math.round(snapStart.cashJPY).toLocaleString('fr-FR') + ' à taux variable)',
            amount: Math.round(jpyFxEffect),
          });
          jpyDetail.push({
            label: 'JPY — variation emprunt (' + Math.round(snapStart.cashJPY).toLocaleString('fr-FR') + ' → ' + Math.round(snapEnd.cashJPY).toLocaleString('fr-FR') + ' ¥)',
            amount: Math.round(jpyFlowEffect),
          });
        } else {
          jpyDetail.push({
            label: 'JPY cash (' + Math.round(snapEnd.cashJPY).toLocaleString('fr-FR') + ' ¥)',
            amount: jpyTotal,
          });
        }

        const usdBorrowingChanged = Math.abs(snapEnd.cashUSD - snapStart.cashUSD) > 1000;
        let usdDetail;
        if (usdBorrowingChanged) {
          usdDetail = [
            { label: 'USD — effet change', amount: Math.round(usdFxEffect) },
            { label: 'USD — variation solde (' + Math.round(snapStart.cashUSD).toLocaleString('fr-FR') + ' → ' + Math.round(snapEnd.cashUSD).toLocaleString('fr-FR') + ' $)', amount: Math.round(usdFlowEffect) },
          ];
        } else {
          usdDetail = [
            { label: 'USD cash (' + Math.round(snapEnd.cashUSD).toLocaleString('fr-FR') + ' $)', amount: usdTotal },
          ];
        }

        const detailItems = [
          ...jpyDetail,
          ...usdDetail,
          { label: 'EUR cash (solde)', amount: Math.round(snapEnd.cashEUR - snapStart.cashEUR + deposits) },
        ].filter(d => Math.abs(d.amount) >= 1);

        items.push({
          label: 'Effet FX / Cash',
          ticker: '_FX_CASH',
          pl: fxOnCash,
          _isCost: true,
          _detail: detailItems,
        });
      }

      // Sort: worst first (like engine.js)
      items.sort((a, b) => a.pl - b.pl);

      const total = chartPL; // exact match with KPI card value
      return { total: Math.round(total), breakdown: items, hasData: true };
    }

    // ── Helper: get ESPP/SGTM value at a given date from chartLabels/chartValues arrays ──
    // Returns the value at or just before the target date (like navAtDate but for arrays)
    function arrayValAtDate(arr, targetDate) {
      for (let i = chartLabels.length - 1; i >= 0; i--) {
        if (chartLabels[i] <= targetDate) return arr[i] || 0;
      }
      return arr[0] || 0;
    }

    // ── Inject ESPP/SGTM items into a breakdown when scope includes them ──
    // This ensures the breakdown total matches the KPI card total (which uses totalValues)
    function injectExternalItems(bd, startDate, endDate) {
      if (!bd || !bd.hasData) return;
      if (!includeESPP && !includeSGTM) return; // IBKR-only scope, nothing to add

      // ESPP P&L for this period
      if (includeESPP) {
        const esppStart = arrayValAtDate(chartValuesESPP, startDate);
        const esppEnd = arrayValAtDate(chartValuesESPP, endDate);
        // ESPP deposits in this period (from cumDepositsESPP)
        const cumESPPStart = arrayValAtDate(cumDepositsESPP, startDate);
        const cumESPPEnd = arrayValAtDate(cumDepositsESPP, endDate);
        const esppDeposits = cumESPPEnd - cumESPPStart;
        const esppPL = Math.round(esppEnd - esppStart - esppDeposits);
        if (Math.abs(esppPL) >= 1) {
          const esppCapital = esppStart + esppDeposits;
          const esppPct = esppCapital > 0 ? Math.round((esppPL / esppCapital) * 1000) / 10 : null;
          bd.breakdown.push({
            label: 'Accenture ESPP (ACN)',
            ticker: 'ACN',
            pl: esppPL,
            pct: esppPct,
            startVal: Math.round(esppStart),
            endVal: Math.round(esppEnd),
            valEUR: esppEnd,
            _isExternal: true,
          });
          bd.total += esppPL;
        }
      }

      // SGTM P&L for this period
      if (includeSGTM) {
        const sgtmStart = arrayValAtDate(chartValuesSGTM, startDate);
        const sgtmEnd = arrayValAtDate(chartValuesSGTM, endDate);
        const cumSGTMStart = arrayValAtDate(cumDepositsSGTM, startDate);
        const cumSGTMEnd = arrayValAtDate(cumDepositsSGTM, endDate);
        const sgtmDeposits = cumSGTMEnd - cumSGTMStart;
        const sgtmPL = Math.round(sgtmEnd - sgtmStart - sgtmDeposits);
        if (Math.abs(sgtmPL) >= 1) {
          const sgtmCapital = sgtmStart + sgtmDeposits;
          const sgtmPct = sgtmCapital > 0 ? Math.round((sgtmPL / sgtmCapital) * 1000) / 10 : null;
          bd.breakdown.push({
            label: 'SGTM (Maroc)',
            ticker: 'SGTM',
            pl: sgtmPL,
            pct: sgtmPct,
            startVal: Math.round(sgtmStart),
            endVal: Math.round(sgtmEnd),
            valEUR: sgtmEnd,
            _isExternal: true,
          });
          bd.total += sgtmPL;
        }
      }

      // Re-sort after injection: worst first
      bd.breakdown.sort((a, b) => a.pl - b.pl);
    }

    // Compute breakdowns for all periods
    const chartBreakdown = {};
    if (mode === 'ytd') {
      chartBreakdown.daily = computePeriodBreakdown(prevTradingDay, lastDate, 'daily');
      chartBreakdown.mtd = computePeriodBreakdown(mtdStartDate, lastDate, 'mtd');
      chartBreakdown.oneMonth = computePeriodBreakdown(oneMStartDate, lastDate, 'oneMonth');
      chartBreakdown.ytd = computePeriodBreakdown(ytdStartDate, lastDate, 'ytd');

      // Inject ESPP/SGTM into each period's breakdown (scope=all)
      injectExternalItems(chartBreakdown.daily, prevTradingDay, lastDate);
      injectExternalItems(chartBreakdown.mtd, mtdStartDate, lastDate);
      injectExternalItems(chartBreakdown.oneMonth, oneMStartDate, lastDate);
      injectExternalItems(chartBreakdown.ytd, ytdStartDate, lastDate);

      console.log('[breakdown] YTD chart breakdown computed:', {
        daily: chartBreakdown.daily?.total,
        mtd: chartBreakdown.mtd?.total,
        oneMonth: chartBreakdown.oneMonth?.total,
        ytd: chartBreakdown.ytd?.total,
        ytdItems: chartBreakdown.ytd?.breakdown?.length,
        dates: { prevTradingDay, mtdStartDate, oneMStartDate, ytdStartDate, lastDate },
        snapNavs: {
          oneMStart: _simSnapshots[oneMStartDate]?.nav,
          last: _simSnapshots[lastDate]?.nav,
          first: _simSnapshots[firstDate]?.nav,
        },
      });
      // Expose snapshots for debugging
      window._simSnapshots = _simSnapshots;
    } else if (mode === '1y') {
      chartBreakdown.oneYear = computePeriodBreakdown(oneYStartDate, lastDate, 'oneYear');
      injectExternalItems(chartBreakdown.oneYear, oneYStartDate, lastDate);
      console.log('[breakdown] 1Y chart breakdown computed:', {
        oneYear: chartBreakdown.oneYear?.total,
        items: chartBreakdown.oneYear?.breakdown?.length,
      });
    }

    // Store on window for render.js detail generators
    if (!window._chartBreakdown) window._chartBreakdown = {};
    Object.assign(window._chartBreakdown, chartBreakdown);
  }

  // ── Degiro data series (closed account, constant realized P&L) ──
  // Utilise totalPLAllComponents (rapports annuels complets) pour cohérence
  // avec buildEquityHistoryChart qui calcule aussi depuis les rapports annuels.
  // totalRealizedPL (50186.81) = trading uniquement, utilisé dans engine.js pour les KPIs
  // totalPLAllComponents (50664.55) = trading + dividendes + FX + intérêts + promo
  const degiroPLTrading = portfolio.amine.degiro?.totalRealizedPL || 0;
  const degiroRealizedPL = portfolio.amine.degiro?.totalPLAllComponents || degiroPLTrading;
  const chartValuesDegiro = chartLabels.map(() => 0); // NAV = 0 (closed)
  const plValuesDegiro = chartLabels.map(() => degiroRealizedPL); // flat realized P&L
  const cumDepositsDegiro = chartLabels.map(() => 0); // no deposits

  // ── Chart setup — scope-aware display ──
  // Select the correct data series based on scope:
  //   'ibkr'   → IBKR-only NAV
  //   'espp'   → ESPP-only valuation (ACN shares + cash)
  //   'maroc'  → SGTM/Maroc-only valuation
  //   'degiro' → NAV=0, P&L=realized P&L (flat)
  //   'all'    → IBKR + ESPP + SGTM + Degiro combined total
  const showAll = includeESPP || includeSGTM;
  // scope: 'ibkr' | 'espp' | 'maroc' | 'degiro' | 'all'
  const scope = (options && options.scope) || (showAll ? 'all' : 'ibkr');

  // ── Include Degiro in Total P&L ──
  // Compute as sum of individual P&L arrays to GUARANTEE additivity:
  //   Tous P&L = IBKR P&L + ESPP P&L + SGTM P&L + Degiro P&L
  // This avoids any mismatch between NAV and deposit scopes.
  const plValuesTotalWithDegiro = plValuesIBKR.map((v, i) =>
    v + (plValuesESPP[i] || 0) + (plValuesSGTM[i] || 0) + degiroRealizedPL
  );

  // ── 'alltime' mode: cache and return early (no chart rendering) ──
  if (mode === 'alltime') {
    window._simulationAllTimeCache = {
      labels: chartLabels.slice(),
      ibkrValues: chartValues.slice(),
      totalValues: chartValuesTotal.slice(),
      esppValues: chartValuesESPP.slice(),
      sgtmValues: chartValuesSGTM.slice(),
      degiroValues: chartValuesDegiro.slice(),
    };
    console.log('[sim-alltime] Cached all-time simulation: ' + chartLabels.length + ' pts, ' + chartLabels[0] + ' → ' + chartLabels[chartLabels.length - 1]);
    console.log('[sim-alltime] IBKR NAV first: €' + chartValues[0] + ', last: €' + chartValues[chartValues.length - 1]);
    return { labels: chartLabels, ibkrValues: chartValues, totalValues: chartValuesTotal };
  }

  // ── Compute absolute tooltip data (lifetime deposits & P&L) ──
  const absTooltip = computeAbsoluteTooltipArrays(
    chartLabels, chartValues, chartValuesESPP, chartValuesSGTM, chartValuesDegiro, chartValuesTotal
  );

  // Store full data for period filtering and mode switching
  const startValue = scope === 'espp' ? chartValuesESPP[0] : (scope === 'maroc' ? chartValuesSGTM[0] : chartValues[0]);
  window._ytdChartFullData = {
    labels: chartLabels,
    ibkrValues: chartValues,
    totalValues: chartValuesTotal,
    esppValues: chartValuesESPP,
    sgtmValues: chartValuesSGTM,
    degiroValues: chartValuesDegiro,
    _absoluteTooltip: absTooltip,
    plValuesIBKR,
    plValuesESPP,
    plValuesSGTM,
    plValuesDegiro,
    plValuesTotal: plValuesTotalWithDegiro,
    cumDepositsAtPoint,
    cumDepositsESPP,
    cumDepositsSGTM,
    cumDepositsDegiro,
    cumDepositsAtPointTotal,
    showAll,
    includeESPP,
    includeSGTM,
    scope,
    startValue,
    degiroRealizedPL,
    mode,
    currentPeriod: 'YTD',
  };

  // Render the chart
  renderPortfolioChart();

  console.log('[ytd-chart] Built: ' + chartLabels.length + ' points, scope=' + scope + ', mode=' + mode);

  // ── Track deposits by date for TWR / KPI computation ──
  // Convert all deposits to EUR for TWR calculation
  const depositsByDate = {};
  // IBKR deposits
  (portfolio.amine.ibkr.deposits || [])
    .filter(d => d.date >= START_DATE && d.date <= todayStr)
    .forEach(d => {
      const amountEUR = (d.currency && d.currency !== 'EUR')
        ? d.amount / (d.fxRateAtDate || 1)  // convert AED/USD to EUR
        : d.amount;
      depositsByDate[d.date] = (depositsByDate[d.date] || 0) + amountEUR;
    });
  // Degiro deposits/withdrawals (✅ back-calculés des rapports annuels)
  (portfolio.amine.degiro?.deposits || [])
    .filter(d => d.date >= START_DATE && d.date <= todayStr)
    .forEach(d => {
      const amountEUR = (d.currency && d.currency !== 'EUR')
        ? d.amount / (d.fxRateAtDate || 1)
        : d.amount;
      depositsByDate[d.date] = (depositsByDate[d.date] || 0) + amountEUR;
    });

  // Return NAV series so KPIs can be computed from chart data
  return {
    labels: chartLabels,          // ['2026-01-02', '2026-01-03', ...]
    ibkrValues: chartValues,      // IBKR-only NAV per day
    totalValues: chartValuesTotal, // IBKR+ESPP+SGTM NAV per day
    depositsByDate: depositsByDate,  // { '2026-01-09': 3000 }
    startingNAV: STARTING_NAV,
    scope: showAll ? 'all' : 'ibkr',
    costItems: ibkrCostsYTD,  // interest, FTT, dividends for KPI breakdowns
  };
}

// ── Period filter: re-draw the YTD chart for a sub-period ──
export function redrawChartForPeriod(period) {
  const data = window._ytdChartFullData;
  if (!data) return;
  data.currentPeriod = period;
  renderPortfolioChart({ period });
}

// ── Switch between Valeur (NAV) and P&L display modes ──
export function switchChartMode(displayMode) {
  window._ytdDisplayMode = displayMode;
  const data = window._ytdChartFullData;
  renderPortfolioChart({ displayMode, period: data?.currentPeriod });
}

// ============================================================
// EQUITY HISTORY CHART — 5Y / MAX
// Uses EQUITY_HISTORY from data.js (monthly snapshots)
// Maps to the same _ytdChartFullData format so renderPortfolioChart
// can render it seamlessly.
// ============================================================
export function buildEquityHistoryChart(period, options) {
  const el = document.getElementById('portfolioYTDChart');
  if (!el || !EQUITY_HISTORY || EQUITY_HISTORY.length === 0) return;

  // Filter by period
  let cutoffDate = '1900-01-01';
  if (period === '5Y') {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 5);
    cutoffDate = d.toISOString().slice(0, 10);
  }
  // MAX: use all data (cutoff stays at 1900)

  const filtered = EQUITY_HISTORY.filter(h => h.date >= cutoffDate);
  if (filtered.length === 0) return;

  // ══════════════════════════════════════════════════════════════
  // SPLICE: Replace inaccurate EQUITY_HISTORY estimates with
  // all-time simulation data (absolute NAV from account opening).
  //
  // Architecture:
  //   - buildPortfolioYTDChart(mode='alltime') produces accurate NAV
  //     from the first deposit date, replaying all trades/deposits.
  //   - For dates BEFORE the simulation: keep EQUITY_HISTORY (Degiro era)
  //   - For dates IN the simulation range: use simulation NAV values
  //   - P&L is recomputed uniformly by this function's deposit tracking
  // ══════════════════════════════════════════════════════════════
  const sim = window._simulationAllTimeCache;
  let dataPoints;

  if (sim && sim.labels && sim.labels.length > 0) {
    const simStart = sim.labels[0];

    // Keep EQUITY_HISTORY entries strictly before the simulation start
    const ehBefore = filtered.filter(h => h.date < simStart);

    dataPoints = [];
    for (const h of ehBefore) {
      dataPoints.push({
        date: h.date, degiro: h.degiro, espp: h.espp,
        ibkr: h.ibkr || 0, sgtm: 0, note: h.note,
      });
    }
    // ── Carry forward last known Degiro NAV for dates before closure ──
    // The simulation sets degiro=0 for all dates, but Degiro was still active
    // until its closure (April 14, 2025). Use the last EQUITY_HISTORY Degiro
    // value for simulation dates before the closure to avoid a false -100% P&L.
    const DEGIRO_CLOSURE_DATE = '2025-04-14';
    const lastEHDegiro = ehBefore.length > 0
      ? ehBefore[ehBefore.length - 1].degiro || 0
      : 0;

    // Append all simulation points (absolute NAV — no warm-up needed)
    for (let i = 0; i < sim.labels.length; i++) {
      // Before Degiro closure: carry forward last known EH value
      const degiroNAV = sim.labels[i] < DEGIRO_CLOSURE_DATE ? lastEHDegiro : 0;
      dataPoints.push({
        date: sim.labels[i],
        degiro: degiroNAV,
        espp: sim.esppValues[i],
        ibkr: sim.ibkrValues[i],
        sgtm: sim.sgtmValues[i] || 0,
      });
    }
    // Recompute total from components for consistency
    for (const dp of dataPoints) {
      dp.total = (dp.degiro || 0) + (dp.espp || 0) + (dp.ibkr || 0) + (dp.sgtm || 0);
    }

    console.log('[equity-history] SPLICE: ' + ehBefore.length + ' EH + ' +
      sim.labels.length + ' alltime sim (from ' + simStart + ')');
  } else {
    // No simulation data cached — fall back to EQUITY_HISTORY only
    dataPoints = filtered.map(h => ({
      date: h.date, degiro: h.degiro, espp: h.espp,
      ibkr: h.ibkr || 0, sgtm: 0, total: h.total, note: h.note,
    }));
    console.log('[equity-history] No alltime cache — using EQUITY_HISTORY only (' + dataPoints.length + ' points)');
  }

  if (dataPoints.length === 0) return;

  // Build arrays from (possibly spliced) data points
  const labels = dataPoints.map(d => d.date);
  const totalValues = dataPoints.map(d => d.total);
  const degiroValues = dataPoints.map(d => d.degiro);
  const esppValues = dataPoints.map(d => d.espp);
  const ibkrValues = dataPoints.map(d => d.ibkr);
  const sgtmValues = dataPoints.map(d => d.sgtm || 0);

  // ══════════════════════════════════════════════════════════════
  // P&L COMPUTATION — 3 sources, 3 approches différentes
  // ══════════════════════════════════════════════════════════════

  // ── 1) DEGIRO P&L: basé sur les rapports annuels (pas de dépôts estimés) ──
  // Méthode: totalPL = Σ(gains + dividendes + FX + intérêts) par année
  //          totalDépôts = totalRetraits - totalPL (identité compte clôturé)
  //          PL(mois) = NAV(mois) - totalDépôts + cumRetraits(mois)
  const dg = PORTFOLIO.amine.degiro || {};
  const dgAnnual = dg.annualSummary || {};
  const dgDiv = dg.dividends || {};
  const dgFX = dg.fxCosts || {};
  const dgFlatex = dg.flatexCashFlows || {};

  // Compute total realized P&L from all annual report components
  let dgTotalPL = 0;
  for (const y of [2020, 2021, 2022, 2023, 2024, 2025]) {
    const as = dgAnnual[y] || {};
    const div = dgDiv[y] || {};
    const fx = dgFX[y] || {};
    const fl = dgFlatex[y] || {};
    dgTotalPL += (as.netPL || 0)
      + (div.net || 0)
      + (fx.autoFX || 0) + (fx.manualFX || 0)
      - (fl.interestPaid || 0);
  }
  dgTotalPL += 20; // bonus promo DEGIRO 2020

  // Compute total withdrawals from annual reports
  let dgTotalWithdrawals = 0;
  for (const y of [2020, 2021, 2022, 2023, 2024, 2025]) {
    dgTotalWithdrawals += (dgFlatex[y] || {}).retraits || 0;
  }

  // Back-compute exact deposits: deposits = withdrawals - totalPL
  const dgTotalDeposits = dgTotalWithdrawals - dgTotalPL;

  // Build withdrawal events (dates from flatexCashFlows, only years with retraits > 0)
  const dgWithdrawalEvents = [];
  for (const y of [2020, 2021, 2022, 2023, 2024, 2025]) {
    const ret = (dgFlatex[y] || {}).retraits || 0;
    if (ret > 0) {
      // Withdrawals happen at year-end (or account close for 2025)
      const date = y === 2025 ? '2025-04-14' : y + '-12-31';
      dgWithdrawalEvents.push({ date, amount: ret });
    }
  }

  // Deposit schedule: 3 deposits confirmed by email, all in early 2020
  // Dates are facts from emails; amounts = totalDeposits / 3 (back-computed)
  const dgDepositDates = ['2020-01-14', '2020-02-20', '2020-03-09'];
  const dgPerDeposit = dgTotalDeposits / dgDepositDates.length;

  // Compute Degiro P&L at each snapshot
  const plValuesDegiro = [];
  const cumDepositsDegiro = [];
  for (let i = 0; i < labels.length; i++) {
    const snapDate = labels[i];
    // Cumulative deposits up to this date
    const depositsIn = dgDepositDates.filter(d => d <= snapDate).length;
    const cumDep = depositsIn * dgPerDeposit;
    // Cumulative withdrawals up to this date
    let cumRet = 0;
    for (const w of dgWithdrawalEvents) {
      if (w.date <= snapDate) cumRet += w.amount;
    }
    const pl = degiroValues[i] - cumDep + cumRet;
    plValuesDegiro.push(pl);
    cumDepositsDegiro.push(cumDep - cumRet); // net deposits for tooltip
  }

  console.log('[equity-history] Degiro P&L (rapports annuels):',
    'totalPL=' + Math.round(dgTotalPL),
    '| totalDépôts=' + Math.round(dgTotalDeposits),
    '| totalRetraits=' + Math.round(dgTotalWithdrawals),
    '| P&L fin=' + Math.round(plValuesDegiro[plValuesDegiro.length - 1]));

  // ── 2) ESPP P&L: NAV - contribEUR (contributions salariales exactes) ──
  const esppDepositEvents = [];
  const esppLots = PORTFOLIO.amine.espp.lots || [];
  for (const lot of esppLots) {
    if (lot.contribEUR) {
      esppDepositEvents.push({ date: lot.date, amountEUR: lot.contribEUR });
    }
  }
  const esppCash = PORTFOLIO.amine.espp.cashEUR || 0;
  if (esppCash > 0) {
    const earliestESPP = esppLots.length > 0
      ? esppLots.reduce((a, b) => a.date < b.date ? a : b).date
      : '2018-01-01';
    esppDepositEvents.push({ date: earliestESPP, amountEUR: esppCash });
  }
  esppDepositEvents.sort((a, b) => a.date.localeCompare(b.date));

  // ── 3) IBKR P&L: NAV - deposits (dépôts exacts du relevé IBKR) ──
  const ibkrDepositEvents = [];
  const ibkrDeposits = PORTFOLIO.amine.ibkr.deposits || [];
  for (const d of ibkrDeposits) {
    const eur = d.currency === 'EUR' ? d.amount : d.amount / d.fxRateAtDate;
    ibkrDepositEvents.push({ date: d.date, amountEUR: eur });
  }
  ibkrDepositEvents.sort((a, b) => a.date.localeCompare(b.date));

  // ── 4) SGTM P&L: NAV - cost basis (IPO cost in EUR) ──
  const sgtmTotalShares = (PORTFOLIO.amine.sgtm?.shares || 0) + (PORTFOLIO.nezha?.sgtm?.shares || 0);
  const sgtmCostMAD = PORTFOLIO.amine.sgtm?.costPerShareMAD || 0;
  const sgtmDepositEvents = [];
  if (sgtmTotalShares > 0 && sgtmCostMAD > 0) {
    const fxMAD = FX_STATIC?.MAD || 10.85;
    const sgtmCostEUR = sgtmTotalShares * sgtmCostMAD / fxMAD;
    sgtmDepositEvents.push({ date: '2025-12-15', amountEUR: sgtmCostEUR });
  }

  // Nezha ESPP deposits (lots without contribEUR)
  const nezhaESPPLots = PORTFOLIO.nezha?.espp?.lots || [];
  for (const lot of nezhaESPPLots) {
    if (lot.contribEUR) {
      esppDepositEvents.push({ date: lot.date, amountEUR: lot.contribEUR });
    } else {
      const defaultFx = 1.10;
      esppDepositEvents.push({ date: lot.date, amountEUR: (lot.shares * lot.costBasis) / (lot.fxRateAtDate || defaultFx) });
    }
  }
  // Nezha cash
  const nezhaCashUSD = PORTFOLIO.nezha?.espp?.cashUSD || 0;
  if (nezhaCashUSD > 0) {
    const fxUSD = FX_STATIC?.USD || 1.15;
    esppDepositEvents.push({ date: '2018-01-01', amountEUR: nezhaCashUSD / fxUSD });
  }
  esppDepositEvents.sort((a, b) => a.date.localeCompare(b.date));

  // ── Compute cumulative ESPP + IBKR + SGTM deposits at each snapshot ──
  let esppIdx = 0, ibkrIdx = 0, sgtmIdx = 0;
  let cumESPP = 0, cumIBKR = 0, cumSGTM = 0;
  const cumDepositsESPP = [];
  const cumDepositsIBKR = [];
  const cumDepositsSGTM = [];
  const cumDepositsTotal = [];

  for (let i = 0; i < labels.length; i++) {
    const snapDate = labels[i];
    while (esppIdx < esppDepositEvents.length && esppDepositEvents[esppIdx].date <= snapDate) {
      cumESPP += esppDepositEvents[esppIdx].amountEUR;
      esppIdx++;
    }
    while (ibkrIdx < ibkrDepositEvents.length && ibkrDepositEvents[ibkrIdx].date <= snapDate) {
      cumIBKR += ibkrDepositEvents[ibkrIdx].amountEUR;
      ibkrIdx++;
    }
    while (sgtmIdx < sgtmDepositEvents.length && sgtmDepositEvents[sgtmIdx].date <= snapDate) {
      cumSGTM += sgtmDepositEvents[sgtmIdx].amountEUR;
      sgtmIdx++;
    }
    cumDepositsESPP.push(cumESPP);
    cumDepositsIBKR.push(cumIBKR);
    cumDepositsSGTM.push(cumSGTM);
    cumDepositsTotal.push(cumDepositsDegiro[i] + cumESPP + cumIBKR + cumSGTM);
  }

  const plValuesESPP = esppValues.map((v, i) => v - cumDepositsESPP[i]);
  const plValuesIBKR = ibkrValues.map((v, i) => v - cumDepositsIBKR[i]);
  const plValuesSGTM = sgtmValues.map((v, i) => v - cumDepositsSGTM[i]);
  const plValuesTotal = totalValues.map((v, i) => v - cumDepositsTotal[i]);

  console.log('[equity-history] P&L summary:',
    '| Degiro=' + Math.round(plValuesDegiro[plValuesDegiro.length - 1]),
    '| ESPP=' + Math.round(plValuesESPP[plValuesESPP.length - 1]),
    '| IBKR=' + Math.round(plValuesIBKR[plValuesIBKR.length - 1]),
    '| SGTM=' + Math.round(plValuesSGTM[plValuesSGTM.length - 1]),
    '| Total=' + Math.round(plValuesTotal[plValuesTotal.length - 1]));

  // Store as _ytdChartFullData so renderPortfolioChart can use it
  // startValue = first total NAV in the filtered range (for value mode tooltip %)
  const startValue = totalValues[0] || 0;

  window._ytdChartFullData = {
    labels,
    ibkrValues,
    totalValues,
    esppValues,
    sgtmValues,
    degiroValues,
    plValuesIBKR,
    plValuesTotal,
    plValuesESPP,
    plValuesSGTM,
    plValuesDegiro,
    // Cumulative deposits for tooltip display
    cumDepositsAtPoint: cumDepositsIBKR,
    cumDepositsAtPointTotal: cumDepositsTotal,
    cumDepositsESPP,
    cumDepositsSGTM,
    cumDepositsDegiro,
    // Absolute tooltip data (equity history is already absolute)
    _absoluteTooltip: {
      absDepsIBKR: cumDepositsIBKR, absDepsESPP: cumDepositsESPP,
      absDepsSGTM: cumDepositsSGTM, absDepsDegiro: cumDepositsDegiro,
      absDepsTotal: cumDepositsTotal,
      absPLIBKR: plValuesIBKR, absPLESPP: plValuesESPP,
      absPLSGTM: plValuesSGTM, absPLDegiro: plValuesDegiro,
      absPLTotal: plValuesTotal,
    },
    startValue,  // v244: needed for value mode tooltip (diff from start)
    mode: period === '5Y' ? '5y' : 'max',
    scope: (options && options.scope) || 'all',
    currentPeriod: period,
    degiroRealizedPL: Math.round(dgTotalPL),
    _isEquityHistory: true,
    _equityEntries: dataPoints.filter(d => d.note),  // for click-detail notes (EH entries with notes)
  };

  // Render
  renderPortfolioChart({ period, scope: (options && options.scope) || 'all' });
  console.log('[equity-history] Built ' + period + ' chart with ' + filtered.length + ' monthly points');
}
