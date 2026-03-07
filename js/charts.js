// ============================================================
// CHARTS — All Chart.js chart creation and management
// ============================================================
// Each function receives STATE, never reads DOM for data.

import { fmt, fmtAxis } from './render.js';
import { getGrandTotal } from './engine.js';
import { IMMO_CONSTANTS } from './data.js';

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

  if (view === 'actions') {
    buildActionsGeoDonut(state);
    buildActionsSectorDonut(state);
  }
  if (view === 'cash') {
    buildCashCurrencyDonut(state);
  }
  if (view === 'immobilier') {
    buildImmoViewEquityBar(state);
    buildImmoViewProjection(state);
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
      plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, padding: 6 } },
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
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 8 } },
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
      datasets: [{ data: [Math.round(geoIBKR*0.53), Math.round(geoIBKR*0.21), Math.round(s.amine.espp), Math.round(geoIBKR*0.10), Math.round(geoIBKR*0.03), Math.round(s.amine.sgtm+s.nezha.sgtm)], backgroundColor: ['#2b6cb0','#9f7aea','#48bb78','#ed8936','#e53e3e','#d69e2e'], borderWidth: 1 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 6 } },
        tooltip: { callbacks: { label: c => { const t = c.dataset.data.reduce((a,b)=>a+b,0); return c.label + ': ' + fmt(c.parsed) + ' (' + (c.parsed/t*100).toFixed(1) + '%)'; } } } } }
  });
}

// ============ IMMO EQUITY BAR ============
function buildImmoEquityBar(state) {
  charts.immoEq = new Chart(document.getElementById('immoEquityChart'), {
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
  charts.immoProj = new Chart(document.getElementById('immoProjectionChart'), {
    type: 'line',
    data: {
      labels: ['2027','2028','2029','2030','2031','2032'],
      datasets: [
        { label: 'Vitry', data: [36301,48505,60709,72913,85117,97321], borderColor: '#4a5568', backgroundColor: 'rgba(74,85,104,0.1)', fill: true, tension: 0.3 },
        { label: 'Rueil', data: [85543,97707,110020,122468,135060,147799], borderColor: '#2b6cb0', backgroundColor: 'rgba(43,108,176,0.1)', fill: true, tension: 0.3 },
        { label: 'Villejuif', data: [0,0,11039,29706,48808,68307], borderColor: '#2c7a7b', backgroundColor: 'rgba(44,122,123,0.1)', fill: true, tension: 0.3 },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'Projection equity', font: { size: 14 } },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmt(c.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtAxis(v) } } } }
  });
}

// ============ CF PROJECTION 10 ANS ============
export function buildCFProjection(state) {
  if (charts.cfProj) { charts.cfProj.destroy(); delete charts.cfProj; }

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
    villejuifData.push(villejuifCF);
    totalData.push(vitryCF + rueilCF + villejuifCF);
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
        { label: 'Villejuif', data: villejuifData, borderColor: '#2c7a7b', fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3 },
        { label: 'Total 3 biens', data: totalData, borderColor: '#48bb78', backgroundColor: 'rgba(72,187,120,0.12)', fill: true, tension: 0.3, borderWidth: 3, pointRadius: 3 },
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

// ============ CASH CURRENCY DONUT ============
function buildCashCurrencyDonut(state) {
  const el = document.getElementById('cashCurrencyChart');
  if (!el) return;
  const byCur = state.cashView.byCurrency;
  const colors = { EUR: '#2b6cb0', AED: '#48bb78', MAD: '#ed8936', USD: '#9f7aea' };
  const entries = Object.entries(byCur).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]);
  const total = entries.reduce((s,[,v]) => s + v, 0);

  charts.cashCurrency = new Chart(el, {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([,v]) => v), backgroundColor: entries.map(([k]) => colors[k] || '#a0aec0'), borderWidth: 1 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 6 } },
        tooltip: { callbacks: { label: c => c.label + ': ' + fmt(c.parsed) + ' (' + (c.parsed/total*100).toFixed(1) + '%)' } } } }
  });
}

// ============ IMMO VIEW EQUITY BAR ============
function buildImmoViewEquityBar(state) {
  const el = document.getElementById('immoViewEquityChart');
  if (!el) return;
  const props = state.immoView.properties;
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

// ============ IMMO VIEW PROJECTION ============
function buildImmoViewProjection(state) {
  const el = document.getElementById('immoViewProjectionChart');
  if (!el) return;
  charts.immoViewProj = new Chart(el, {
    type: 'line',
    data: {
      labels: ['2027','2028','2029','2030','2031','2032'],
      datasets: [
        { label: 'Vitry', data: [36301,48505,60709,72913,85117,97321], borderColor: '#4a5568', backgroundColor: 'rgba(74,85,104,0.1)', fill: true, tension: 0.3 },
        { label: 'Rueil', data: [85543,97707,110020,122468,135060,147799], borderColor: '#2b6cb0', backgroundColor: 'rgba(43,108,176,0.1)', fill: true, tension: 0.3 },
        { label: 'Villejuif', data: [0,0,11039,29706,48808,68307], borderColor: '#2c7a7b', backgroundColor: 'rgba(44,122,123,0.1)', fill: true, tension: 0.3 },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'Projection equity', font: { size: 14 } },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmt(c.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtAxis(v) } } } }
  });
}
