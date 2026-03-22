// ============================================================
// CHARTS — All Chart.js chart creation and management
// ============================================================
// Each function receives STATE, never reads DOM for data.

import { fmt, fmtAxis } from './render.js?v=204';
import { getGrandTotal, computeExitCostsAtYear } from './engine.js?v=204';
import { IMMO_CONSTANTS } from './data.js?v=204';

let charts = {};
let coupleSelectedCat = null;
let _state = null;

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
      datasets: [{ label: 'Equity', data: [state.amine.vitryEquity, state.nezha.rueilEquity, state.nezha.villejuifEquity], backgroundColor: ['#4a5568','#2b6cb0','#2c7a7b'] }]
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
  const loanColors = { vitry: '#4a5568', rueil: '#2b6cb0', villejuif: '#2c7a7b' };
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
        { label: 'Equilibre (0)', data: zeroLine, borderColor: '#e53e3e', borderWidth: 1, borderDash: [4,4], pointRadius: 0, pointHoverRadius: 0, fill: false },
        { label: 'Vitry', data: vitryData, borderColor: '#4a5568', fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3 },
        { label: 'Rueil', data: rueilData, borderColor: '#2b6cb0', fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3 },
        ...(includeVillejuif ? [{ label: 'Villejuif', data: villejuifData, borderColor: '#2c7a7b', fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3 }] : []),
        { label: includeVillejuif ? 'Total 3 biens' : 'Total 2 biens', data: totalData, borderColor: '#48bb78', backgroundColor: 'rgba(72,187,120,0.12)', fill: true, tension: 0.3, borderWidth: 3, pointRadius: 3 },
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
      datasets: [{ label: 'Equity', data: props.map(p => p.equity), backgroundColor: ['#4a5568','#2b6cb0','#2c7a7b'] }]
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
  const loanColors = { vitry: '#4a5568', rueil: '#2b6cb0', villejuif: '#2c7a7b' };
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
  const loanColors = { vitry: '#4a5568', rueil: '#2b6cb0', villejuif: '#2c7a7b' };
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
  const propColors = { vitry: '#3182ce', rueil: '#2f855a', villejuif: '#ed8936' };
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
        backgroundColor: '#3182ce',
        stack: 'wealth',
        order: 4,
      },
      {
        label: 'Appréciation',
        data: apprecData,
        backgroundColor: '#2f855a',
        stack: 'wealth',
        order: 3,
      },
      {
        label: 'Variation frais sortie',
        data: exitSavData,
        backgroundColor: exitSavData.map(v => v >= 0 ? '#38b2ac' : '#fc8181'),
        stack: 'wealth',
        order: 2,
      },
      {
        label: 'Cash flow',
        data: cfData,
        backgroundColor: cfData.map(v => v >= 0 ? '#68d391' : '#fc8181'),
        stack: 'wealth',
        order: 1,
      },
      {
        label: 'Total',
        data: totalData,
        type: 'line',
        borderColor: '#2d3748',
        backgroundColor: 'transparent',
        borderWidth: 2,
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

/**
 * Build the YTD portfolio evolution line chart.
 *
 * @param {object} portfolio - PORTFOLIO from data.js
 * @param {object} historicalData - from fetchHistoricalPricesYTD()
 * @param {object} fxStatic - FX_STATIC fallback rates
 * @param {object} [options] - { startingNAV: number }
 */
export function buildPortfolioYTDChart(portfolio, historicalData, fxStatic, options) {
  const el = document.getElementById('portfolioYTDChart');
  if (!el) return;
  if (charts.portfolioYTD) { charts.portfolioYTD.destroy(); delete charts.portfolioYTD; }

  // ── Determine simulation mode (YTD or 1Y) ──
  const mode = (options && options.mode) || 'ytd';
  // 1Y: dynamically compute 1 year ago from today (covers full 365 days)
  let START_DATE;
  if (mode === '1y') {
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

  // For 1Y mode: start from scratch (NAV = 0, all cash = 0)
  if (mode === '1y') {
    STARTING_NAV = 0;
    IBKR_JPY_START = 0;
    IBKR_USD_START = 0;
    IBKR_EUR_START_OVERRIDE = null; // no override for 1Y
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
  // For 1Y: startHoldings remains empty (no account before Apr 1, 2025)

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

  // Setup ESPP data
  const ESPP_SHARES = (portfolio.amine.espp?.shares || 0) + (portfolio.nezha?.espp?.shares || 0);
  const ESPP_CASH_EUR = portfolio.amine.espp?.cashEUR || 0;
  const ESPP_CASH_USD = portfolio.nezha?.espp?.cashUSD || 0;

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
    let esppValue = 0;
    if (ESPP_SHARES > 0) {
      const acnPrice = getClose('ACN', date);
      if (acnPrice != null) {
        esppValue = ESPP_SHARES * acnPrice / getFxRate('USD', date) + ESPP_CASH_EUR + ESPP_CASH_USD / getFxRate('USD', date);
      }
    }
    chartValuesESPP.push(Math.round(esppValue));

    // ── Compute SGTM value (always, regardless of scope — needed for Tous & Maroc views) ──
    let sgtmValue = 0;
    if (SGTM_SHARES > 0) {
      const sgtmPrice = getSgtmPrice(date);
      sgtmValue = SGTM_SHARES * sgtmPrice / EURMAD;
    }
    chartValuesSGTM.push(Math.round(sgtmValue));

    // ── Total NAV (IBKR + ESPP + SGTM combined) ──
    const navTotal = Math.round(nav + esppValue + sgtmValue);
    chartValuesTotal.push(navTotal);
  }

  if (chartLabels.length === 0) return;

  // ── Weekly sampling for 1Y mode (reduce ~250 points → ~52) ──
  // Keeps simulation daily for accuracy, but thins out chart data
  if (mode === '1y' && chartLabels.length > 60) {
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
  // ESPP lots are "deposits" into the ESPP account — their cost basis must be
  // subtracted from NAV change to get true P&L, just like IBKR bank transfers.
  // costBasis is in USD/share → convert to EUR at the FX rate on acquisition date.
  const allTotalDepositsEUR = { ...allDepositsEUR }; // starts with IBKR deposits
  const esppLots = [
    ...(portfolio.amine.espp?.lots || []),
    ...(portfolio.nezha?.espp?.lots || []),
  ];
  esppLots
    .filter(lot => lot.date > START_DATE && lot.date <= todayStr)
    .forEach(lot => {
      // Cost in USD = shares × costBasis (USD/share)
      // Convert to EUR using FX rate at acquisition date (approximate with
      // the closest available FX rate from the historical data)
      const costUSD = lot.shares * lot.costBasis;
      const fxAtDate = getFxRate('USD', lot.date) || fxStatic.USD || 1.08;
      const costEUR = costUSD / fxAtDate;
      allTotalDepositsEUR[lot.date] = (allTotalDepositsEUR[lot.date] || 0) + costEUR;
    });

  // ── 2b. Degiro deposits/withdrawals (for Total P&L) ──
  // ⚠ Montants estimés — à remplacer avec les vrais relevés Boursorama
  (portfolio.amine.degiro?.deposits || [])
    .filter(d => d.date > START_DATE && d.date <= todayStr)
    .forEach(d => {
      const amtEUR = (d.currency && d.currency !== 'EUR')
        ? d.amount / (d.fxRateAtDate || 1)
        : d.amount;
      allTotalDepositsEUR[d.date] = (allTotalDepositsEUR[d.date] || 0) + amtEUR;
    });

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

  // P&L IBKR = NAV(t) - NAV(start) - cumDeposits_IBKR(t)
  const startNAVRef = chartValues[0];
  const plValuesIBKR = chartValues.map((nav, i) => Math.round(nav - startNAVRef - cumDepositsAtPoint[i]));
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
          items.push({
            label: tickerLabelMap[ticker] || ticker,
            ticker: ticker,
            pl: Math.round(m2m),
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

    // Compute breakdowns for all periods
    const chartBreakdown = {};
    if (mode === 'ytd') {
      chartBreakdown.daily = computePeriodBreakdown(prevTradingDay, lastDate, 'daily');
      chartBreakdown.mtd = computePeriodBreakdown(mtdStartDate, lastDate, 'mtd');
      chartBreakdown.oneMonth = computePeriodBreakdown(oneMStartDate, lastDate, 'oneMonth');
      chartBreakdown.ytd = computePeriodBreakdown(ytdStartDate, lastDate, 'ytd');
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
      console.log('[breakdown] 1Y chart breakdown computed:', {
        oneYear: chartBreakdown.oneYear?.total,
        items: chartBreakdown.oneYear?.breakdown?.length,
      });
    }

    // Store on window for render.js detail generators
    if (!window._chartBreakdown) window._chartBreakdown = {};
    Object.assign(window._chartBreakdown, chartBreakdown);
  }

  // ── Chart rendering — scope-aware display ──
  // Select the correct data series based on scope:
  //   'ibkr'   → IBKR-only NAV
  //   'espp'   → ESPP-only valuation (ACN shares + cash)
  //   'maroc'  → SGTM/Maroc-only valuation
  //   'degiro' → no active positions (empty array → show IBKR as fallback)
  //   'all'    → IBKR + ESPP + SGTM combined total
  const showAll = includeESPP || includeSGTM;
  // scope: 'ibkr' | 'espp' | 'maroc' | 'degiro' | 'all'
  const scope = (options && options.scope) || (showAll ? 'all' : 'ibkr');
  let mainData, mainLabel, scopeLabel;
  switch (scope) {
    case 'espp':
      mainData = chartValuesESPP;
      mainLabel = 'NAV ESPP (EUR)';
      scopeLabel = 'ESPP';
      break;
    case 'maroc':
      mainData = chartValuesSGTM;
      mainLabel = 'NAV Maroc (EUR)';
      scopeLabel = 'Maroc';
      break;
    case 'degiro':
      // Degiro has no active positions — fall back to IBKR view
      mainData = chartValues;
      mainLabel = 'NAV Degiro (EUR)';
      scopeLabel = 'Degiro';
      break;
    case 'all':
      mainData = chartValuesTotal.length > 0 ? chartValuesTotal : chartValues;
      mainLabel = 'NAV Total (EUR)';
      scopeLabel = 'Tous';
      break;
    case 'ibkr':
    default:
      mainData = chartValues;
      mainLabel = 'NAV IBKR (EUR)';
      scopeLabel = 'IBKR';
      break;
  }

  const startValue = mainData[0];
  const endValue = mainData[mainData.length - 1];
  const plEUR = endValue - startValue;
  const plPct = startValue !== 0 ? ((endValue / startValue - 1) * 100).toFixed(2) : '0.00';
  const isPositive = plEUR >= 0;

  const MONTH_NAMES_SHORT = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
  const displayLabels = chartLabels.map(d => {
    const p = d.split('-');
    if (mode === '1y') {
      return p[2] + '/' + p[1];
    }
    return p[2] + '/' + p[1];
  });

  const ctx = el.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, el.height || 400);
  gradient.addColorStop(0, isPositive ? 'rgba(72,187,120,0.3)' : 'rgba(229,62,62,0.3)');
  gradient.addColorStop(1, isPositive ? 'rgba(72,187,120,0.01)' : 'rgba(229,62,62,0.01)');

  // Update title and KPIs
  const titleEl = document.getElementById('ytdChartTitle');
  const periodLabel = mode === '1y' ? '1Y' : 'YTD';
  if (titleEl) {
    const color = isPositive ? 'var(--green)' : 'var(--red)';
    titleEl.innerHTML = '<span class="section-icon" style="background:var(--accent)">&#x1F4C8;</span>' +
      'Evolution ' + scopeLabel + ' ' + periodLabel + ' — <span style="color:' + color + '">' +
      (isPositive ? '+' : '') + fmt(plEUR) + ' (' + (isPositive ? '+' : '') + plPct + '%)</span>';
  }
  const ytdStartEl = document.getElementById('ytdStartValue');
  const ytdEndEl = document.getElementById('ytdEndValue');
  const ytdStartLabel = document.getElementById('ytdStartLabel');
  if (ytdStartEl) ytdStartEl.textContent = fmt(startValue);
  if (ytdEndEl) ytdEndEl.textContent = fmt(endValue);
  if (ytdStartLabel) {
    if (mode === '1y') {
      const startParts = START_DATE.split('-');
      const MONTH_FR = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
      ytdStartLabel.innerHTML = 'NAV ' + parseInt(startParts[2]) + ' ' + MONTH_FR[parseInt(startParts[1])-1] + ' ' + startParts[0];
    } else {
      ytdStartLabel.innerHTML = 'NAV 1<sup>er</sup> jan';
    }
  }

  // Build datasets: single line for the active scope
  const datasets = [
    {
      label: mainLabel,
      data: mainData,
      borderColor: isPositive ? '#48bb78' : '#e53e3e',
      backgroundColor: gradient,
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 5,
      pointBackgroundColor: isPositive ? '#48bb78' : '#e53e3e',
      pointHoverBackgroundColor: isPositive ? '#48bb78' : '#e53e3e',
      fill: true,
      tension: 0,
    },
  ];

  // Add reference line for starting value
  datasets.push({
    label: (mode === '1y' ? 'NAV début 1Y' : 'NAV 1er jan') + ' (' + fmt(startValue) + ')',
    data: chartLabels.map(() => startValue),
    borderColor: '#a0aec0',
    borderWidth: 1,
    borderDash: [6, 4],
    pointRadius: 0,
    fill: false,
  });

  charts.portfolioYTD = new Chart(el, {
    type: 'line',
    data: {
      labels: displayLabels,
      datasets: datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
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
          backgroundColor: 'rgba(45,55,72,0.95)',
          titleFont: { size: 12 }, bodyFont: { size: 12 }, padding: 10,
          callbacks: {
            title: items => {
              if (!items.length) return '';
              const p = chartLabels[items[0].dataIndex].split('-');
              return p[2] + '/' + p[1] + '/' + p[0];
            },
            label: item => {
              // Reference line is always the last dataset
              if (item.datasetIndex === datasets.length - 1) {
                return (mode === '1y' ? 'Ref. début 1Y' : 'Ref. 1er jan') + ': ' + fmt(startValue);
              }
              const idx = item.dataIndex;
              const val = item.parsed.y;
              const diff = val - startValue;
              const pct = ((val / startValue - 1) * 100).toFixed(2);
              const tooltipLabel = 'NAV ' + scopeLabel;
              const pl = showAll ? (plValuesTotal[idx] || 0) : (plValuesIBKR[idx] || 0);
              return [
                tooltipLabel + ': ' + fmt(val) + ' (' + (diff >= 0 ? '+' : '') + fmt(diff) + ', ' + (diff >= 0 ? '+' : '') + pct + '%)',
                'P&L (hors dépôts): ' + (pl >= 0 ? '+' : '') + fmt(pl),
              ];
            },
          },
        },
      },
    },
  });

  console.log('[ytd-chart] Built: ' + chartLabels.length + ' points, Start=' + startValue + ', End=' + endValue + ', P/L=' + plEUR);

  // Store full data for period filtering and mode switching
  window._ytdChartFullData = {
    labels: chartLabels,
    ibkrValues: chartValues,
    totalValues: chartValuesTotal,
    esppValues: chartValuesESPP,
    sgtmValues: chartValuesSGTM,
    plValuesIBKR,
    plValuesTotal,
    cumDepositsAtPoint,
    cumDepositsAtPointTotal,
    showAll,
    includeESPP,
    includeSGTM,
    scope,
    startValue,
    mode,
  };

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
  // Degiro deposits/withdrawals (⚠ estimés — à confirmer)
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
  if (!data || !data.labels.length) return;

  const el = document.getElementById('portfolioYTDChart');
  if (!el) return;

  // Compute cutoff date based on period
  const today = new Date();
  let cutoffDate;
  if (period === 'MTD') {
    cutoffDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  } else if (period === '1M') {
    const d = new Date(today);
    d.setMonth(d.getMonth() - 1);
    cutoffDate = d.toISOString().slice(0, 10);
  } else if (period === '3M') {
    const d = new Date(today);
    d.setMonth(d.getMonth() - 3);
    cutoffDate = d.toISOString().slice(0, 10);
  } else if (period === '1Y') {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - 1);
    cutoffDate = d.toISOString().slice(0, 10);
  } else {
    // YTD — show all
    cutoffDate = '2025-12-31';
  }

  // Find start index in the labels array
  let startIdx = 0;
  for (let i = 0; i < data.labels.length; i++) {
    if (data.labels[i] >= cutoffDate) { startIdx = i; break; }
  }

  const slicedLabels = data.labels.slice(startIdx);
  const slicedIBKR = data.ibkrValues.slice(startIdx);
  const slicedTotal = data.totalValues.slice(startIdx);
  const slicedESPP = (data.esppValues || []).slice(startIdx);
  const slicedSGTM = (data.sgtmValues || []).slice(startIdx);

  if (slicedLabels.length === 0) return;

  // ── Scope-aware data selection (same logic as buildPortfolioYTDChart) ──
  const scope = data.scope || 'all';
  let mainData, mainLabel, scopeLabel;
  switch (scope) {
    case 'espp':
      mainData = slicedESPP.length > 0 ? slicedESPP : slicedIBKR;
      mainLabel = 'NAV ESPP (EUR)';
      scopeLabel = 'ESPP';
      break;
    case 'maroc':
      mainData = slicedSGTM.length > 0 ? slicedSGTM : slicedIBKR;
      mainLabel = 'NAV Maroc (EUR)';
      scopeLabel = 'Maroc';
      break;
    case 'degiro':
      mainData = slicedIBKR;
      mainLabel = 'NAV Degiro (EUR)';
      scopeLabel = 'Degiro';
      break;
    case 'all':
      mainData = slicedTotal.length > 0 ? slicedTotal : slicedIBKR;
      mainLabel = 'NAV Total (EUR)';
      scopeLabel = 'Tous';
      break;
    case 'ibkr':
    default:
      mainData = slicedIBKR;
      mainLabel = 'NAV IBKR (EUR)';
      scopeLabel = 'IBKR';
      break;
  }

  const periodStart = mainData[0];
  const periodEnd = mainData[mainData.length - 1];
  const plEUR = periodEnd - periodStart;
  const plPct = periodStart !== 0 ? ((periodEnd / periodStart - 1) * 100).toFixed(2) : '0.00';
  const isPositive = plEUR >= 0;

  // Destroy existing chart
  if (charts.portfolioYTD) { charts.portfolioYTD.destroy(); delete charts.portfolioYTD; }

  const displayLabels = slicedLabels.map(d => {
    const p = d.split('-');
    return p[2] + '/' + p[1];
  });

  const ctx = el.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, el.height || 400);
  gradient.addColorStop(0, isPositive ? 'rgba(72,187,120,0.3)' : 'rgba(229,62,62,0.3)');
  gradient.addColorStop(1, isPositive ? 'rgba(72,187,120,0.01)' : 'rgba(229,62,62,0.01)');

  // Update title
  const titleEl = document.getElementById('ytdChartTitle');
  if (titleEl) {
    const color = isPositive ? 'var(--green)' : 'var(--red)';
    const periodLabel = period === 'YTD' ? 'YTD' : period;
    titleEl.innerHTML = '<span class="section-icon" style="background:var(--accent)">&#x1F4C8;</span>' +
      'Evolution ' + scopeLabel + ' ' + periodLabel + ' — <span style="color:' + color + '">' +
      (isPositive ? '+' : '') + fmt(plEUR) + ' (' + (isPositive ? '+' : '') + plPct + '%)</span>';
  }
  const ytdStartEl = document.getElementById('ytdStartValue');
  const ytdEndEl = document.getElementById('ytdEndValue');
  const ytdStartLabel = document.getElementById('ytdStartLabel');
  if (ytdStartEl) ytdStartEl.textContent = fmt(periodStart);
  if (ytdEndEl) ytdEndEl.textContent = fmt(periodEnd);
  if (ytdStartLabel) {
    const startDate = slicedLabels[0].split('-');
    ytdStartLabel.textContent = 'NAV ' + startDate[2] + '/' + startDate[1];
  }
  const datasets = [
    {
      label: mainLabel,
      data: mainData,
      borderColor: isPositive ? '#48bb78' : '#e53e3e',
      backgroundColor: gradient,
      borderWidth: 2,
      pointRadius: mainData.length > 60 ? 1 : 2,
      pointHoverRadius: 5,
      pointBackgroundColor: isPositive ? '#48bb78' : '#e53e3e',
      pointHoverBackgroundColor: isPositive ? '#48bb78' : '#e53e3e',
      fill: true,
      tension: 0,
    },
    {
      label: 'NAV début période (' + fmt(periodStart) + ')',
      data: mainData.map(() => periodStart),
      borderColor: '#a0aec0',
      borderWidth: 1,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
    },
  ];

  charts.portfolioYTD = new Chart(el, {
    type: 'line',
    data: { labels: displayLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
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
          backgroundColor: 'rgba(45,55,72,0.95)',
          titleFont: { size: 12 }, bodyFont: { size: 12 }, padding: 10,
          callbacks: {
            title: items => {
              if (!items.length) return '';
              const p = slicedLabels[items[0].dataIndex].split('-');
              return p[2] + '/' + p[1] + '/' + p[0];
            },
            label: item => {
              if (item.datasetIndex === 1) return 'Ref. début: ' + fmt(periodStart);
              const val = item.parsed.y;
              const diff = val - periodStart;
              const pct = ((val / periodStart - 1) * 100).toFixed(2);
              return 'NAV ' + scopeLabel + ': ' + fmt(val) + ' (' + (diff >= 0 ? '+' : '') + fmt(diff) + ', ' + (diff >= 0 ? '+' : '') + pct + '%)';
            },
          },
        },
      },
    },
  });

  console.log('[ytd-chart] Period ' + period + ' scope=' + scope + ': ' + slicedLabels.length + ' points, Start=' + periodStart + ', End=' + periodEnd);
}

// ── Switch between Valeur (NAV) and P&L display modes ──
export function switchChartMode(displayMode) {
  // displayMode: 'value' or 'pl'
  const data = window._ytdChartFullData;
  if (!data || !data.labels.length) return;

  const el = document.getElementById('portfolioYTDChart');
  if (!el) return;

  window._ytdDisplayMode = displayMode;

  const showAll = data.showAll;
  const scope = data.scope || 'all';
  const isPLMode = displayMode === 'pl';

  // ── Scope-aware label ──
  let scopeLabel;
  switch (scope) {
    case 'espp': scopeLabel = 'ESPP'; break;
    case 'maroc': scopeLabel = 'Maroc'; break;
    case 'degiro': scopeLabel = 'Degiro'; break;
    case 'all': scopeLabel = 'Tous'; break;
    case 'ibkr': default: scopeLabel = 'IBKR'; break;
  }

  // ── Select the right data series based on scope and display mode ──
  let mainData, refValue, mainLabel;
  if (isPLMode) {
    // For P&L mode: IBKR and Total P&L series exist; for ESPP/Maroc standalone, fall back to Total
    // (P&L for individual platforms would need separate deposit tracking — future improvement)
    mainData = showAll ? data.plValuesTotal : data.plValuesIBKR;
    refValue = 0;
    mainLabel = 'P&L ' + scopeLabel + ' (EUR)';
  } else {
    // Value mode: pick the right NAV series
    switch (scope) {
      case 'espp':
        mainData = data.esppValues && data.esppValues.length > 0 ? data.esppValues : data.ibkrValues;
        break;
      case 'maroc':
        mainData = data.sgtmValues && data.sgtmValues.length > 0 ? data.sgtmValues : data.ibkrValues;
        break;
      case 'all':
        mainData = data.totalValues.length > 0 ? data.totalValues : data.ibkrValues;
        break;
      case 'degiro':
      case 'ibkr':
      default:
        mainData = data.ibkrValues;
        break;
    }
    refValue = mainData[0];
    mainLabel = 'NAV ' + scopeLabel + ' (EUR)';
  }

  if (!mainData || mainData.length === 0) return;

  const endValue = mainData[mainData.length - 1];
  const startVal = mainData[0];
  const plEUR = isPLMode ? endValue : (endValue - refValue);
  const plPct = isPLMode
    ? (data.startValue > 0 ? ((endValue / data.startValue) * 100).toFixed(2) : '0.00')
    : (refValue !== 0 ? ((endValue / refValue - 1) * 100).toFixed(2) : '0.00');
  const isPositive = isPLMode ? endValue >= 0 : plEUR >= 0;

  // Update title
  const titleEl = document.getElementById('ytdChartTitle');
  const modeStr = data.mode === '1y' ? '1Y' : 'YTD';
  if (titleEl) {
    const color = isPositive ? 'var(--green)' : 'var(--red)';
    if (isPLMode) {
      titleEl.innerHTML = '<span class="section-icon" style="background:var(--accent)">&#x1F4C8;</span>' +
        'P&L ' + scopeLabel + ' ' + modeStr + ' — <span style="color:' + color + '">' +
        (endValue >= 0 ? '+' : '') + fmt(endValue) + '</span>';
    } else {
      titleEl.innerHTML = '<span class="section-icon" style="background:var(--accent)">&#x1F4C8;</span>' +
        'Evolution ' + scopeLabel + ' ' + modeStr + ' — <span style="color:' + color + '">' +
        (plEUR >= 0 ? '+' : '') + fmt(plEUR) + ' (' + (plEUR >= 0 ? '+' : '') + plPct + '%)</span>';
    }
  }

  // Update start/end labels
  const ytdStartEl = document.getElementById('ytdStartValue');
  const ytdEndEl = document.getElementById('ytdEndValue');
  const ytdStartLabel = document.getElementById('ytdStartLabel');
  if (isPLMode) {
    if (ytdStartEl) ytdStartEl.textContent = fmt(0);
    if (ytdEndEl) ytdEndEl.textContent = (endValue >= 0 ? '+' : '') + fmt(endValue);
    if (ytdStartLabel) ytdStartLabel.textContent = 'P&L départ';
  } else {
    if (ytdStartEl) ytdStartEl.textContent = fmt(refValue);
    if (ytdEndEl) ytdEndEl.textContent = fmt(endValue);
    if (ytdStartLabel) {
      if (data.mode === '1y') {
        const startD = data.labels[0];
        const sp = startD.split('-');
        const MF = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
        ytdStartLabel.innerHTML = 'NAV ' + parseInt(sp[2]) + ' ' + MF[parseInt(sp[1])-1] + ' ' + sp[0];
      } else {
        ytdStartLabel.innerHTML = 'NAV 1<sup>er</sup> jan';
      }
    }
  }

  // Destroy existing chart
  if (charts.portfolioYTD) { charts.portfolioYTD.destroy(); delete charts.portfolioYTD; }

  const displayLabels = data.labels.map(d => {
    const p = d.split('-');
    return p[2] + '/' + p[1];
  });

  const ctx = el.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, el.height || 400);
  gradient.addColorStop(0, isPositive ? 'rgba(72,187,120,0.3)' : 'rgba(229,62,62,0.3)');
  gradient.addColorStop(1, isPositive ? 'rgba(72,187,120,0.01)' : 'rgba(229,62,62,0.01)');

  const datasets = [
    {
      label: mainLabel,
      data: mainData,
      borderColor: isPositive ? '#48bb78' : '#e53e3e',
      backgroundColor: gradient,
      borderWidth: 2,
      pointRadius: mainData.length > 60 ? 1 : 2,
      pointHoverRadius: 5,
      pointBackgroundColor: isPositive ? '#48bb78' : '#e53e3e',
      pointHoverBackgroundColor: isPositive ? '#48bb78' : '#e53e3e',
      fill: true,
      tension: 0,
    },
    {
      label: isPLMode ? 'Zéro' : ((data.mode === '1y' ? 'NAV début 1Y' : 'NAV 1er jan') + ' (' + fmt(refValue) + ')'),
      data: mainData.map(() => refValue),
      borderColor: '#a0aec0',
      borderWidth: 1,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
    },
  ];

  // Tooltip references for P&L display
  const chartLabelsRef = data.labels;
  const plIBKR = data.plValuesIBKR;
  const plTotal = data.plValuesTotal;
  const navIBKR = data.ibkrValues;
  const navTotal = data.totalValues;
  const cumDepsIBKR = data.cumDepositsAtPoint;
  const cumDepsTotal = data.cumDepositsAtPointTotal || data.cumDepositsAtPoint;
  const cumDeps = showAll ? cumDepsTotal : cumDepsIBKR;
  const startValueRef = data.startValue;

  charts.portfolioYTD = new Chart(el, {
    type: 'line',
    data: { labels: displayLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
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
          backgroundColor: 'rgba(45,55,72,0.95)',
          titleFont: { size: 12 }, bodyFont: { size: 12 }, padding: 10,
          callbacks: {
            title: items => {
              if (!items.length) return '';
              const p = chartLabelsRef[items[0].dataIndex].split('-');
              return p[2] + '/' + p[1] + '/' + p[0];
            },
            label: item => {
              if (item.datasetIndex === 1) {
                return isPLMode ? 'Zéro (breakeven)' : 'Ref: ' + fmt(refValue);
              }
              const idx = item.dataIndex;
              const val = item.parsed.y;
              if (isPLMode) {
                // P&L mode: show P&L + NAV + cumul deposits
                const nav = showAll ? (navTotal[idx] || navIBKR[idx]) : navIBKR[idx];
                const dep = cumDeps[idx] || 0;
                const lines = [];
                lines.push('P&L: ' + (val >= 0 ? '+' : '') + fmt(val));
                lines.push('NAV: ' + fmt(nav) + ' | Déposé: ' + fmt(dep));
                return lines;
              } else {
                // Value mode: show NAV + P&L since start
                const pl = showAll ? (plTotal[idx] || 0) : (plIBKR[idx] || 0);
                const diff = val - startValueRef;
                const pct = startValueRef !== 0 ? ((val / startValueRef - 1) * 100).toFixed(2) : '0.00';
                return [
                  'NAV ' + scopeLabel + ': ' + fmt(val) + ' (' + (diff >= 0 ? '+' : '') + fmt(diff) + ', ' + (diff >= 0 ? '+' : '') + pct + '%)',
                  'P&L (hors dépôts): ' + (pl >= 0 ? '+' : '') + fmt(pl),
                ];
              }
            },
          },
        },
      },
    },
  });

  console.log('[ytd-chart] Switched to mode: ' + displayMode);
}
