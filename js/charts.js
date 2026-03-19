// ============================================================
// CHARTS — All Chart.js chart creation and management
// ============================================================
// Each function receives STATE, never reads DOM for data.

import { fmt, fmtAxis } from './render.js?v=149';
import { getGrandTotal, computeExitCostsAtYear } from './engine.js?v=149';
import { IMMO_CONSTANTS } from './data.js?v=149';

let charts = {};
let coupleSelectedCat = null;
let _state = null;

export function destroyAllCharts() {
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e) {} });
  charts = {};
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
