// ============================================================
// RENDER LAYER — DOM write-only. Takes STATE, outputs to DOM.
// ============================================================
// No computation here. Only formatting and DOM manipulation.

import { CURRENCY_CONFIG } from './data.js?v=3';
import { getGrandTotal } from './engine.js?v=3';

// ---- Formatting helpers ----

let _fx = { EUR: 1 };
let _currency = 'EUR';

function fmt(eurVal, compact) {
  const val = eurVal * (_fx[_currency] || 1);
  const sym = CURRENCY_CONFIG.symbols[_currency] || _currency;
  const after = CURRENCY_CONFIG.symbolAfter[_currency];
  let num;
  if (compact && Math.abs(val) >= 1000000) {
    num = (val / 1000000).toFixed(2) + 'M';
  } else if (compact && Math.abs(val) >= 10000) {
    num = (val / 1000).toFixed(0) + 'K';
  } else {
    num = Math.round(val).toLocaleString('fr-FR');
  }
  return after ? num + ' ' + sym : sym + ' ' + num;
}

export function fmtAxis(v) {
  const cv = v * (_fx[_currency] || 1);
  const sym = CURRENCY_CONFIG.symbols[_currency] || _currency;
  const after = CURRENCY_CONFIG.symbolAfter[_currency];
  const num = Math.abs(cv) >= 1e6 ? (cv/1e6).toFixed(1)+'M' : (cv/1e3).toFixed(0)+'K';
  return after ? num + ' ' + sym : sym + ' ' + num;
}

// Export fmt for use by charts and simulators
export { fmt };

// ---- Main render function ----

export function render(state, view, currency) {
  _fx = state.fx;
  _currency = currency;

  renderHeader(state, view);
  renderKPIs(state, view);

  if (PERSON_VIEWS.includes(view)) {
    renderCategoryCards(state, view);
    renderCategoryPcts(state, view);
    renderExpandSubs(state);
    renderCoupleTable(state);
    renderAmineTable(state);
    renderNezhaTable(state);
    renderIBKRPositionsSimple(state);
    renderImmoKPIs(state);
    renderImmoPcts(state);
  }

  // Asset-type views
  if (view === 'actions') { renderActionsView(state); renderWHTAnalysis(state); }
  if (view === 'cash') renderCashView(state);
  if (view === 'immobilier') renderImmoView(state);
  if (view === 'creances') renderCreancesView(state);

  renderBadges(state);
  updateAllDataEur();
}

// ---- Individual render functions ----

const ASSET_VIEWS = ['actions', 'cash', 'immobilier', 'creances'];
const PERSON_VIEWS = ['couple', 'amine', 'nezha'];

function renderHeader(state, view) {
  const v = state.views[view];
  const titleEl = document.getElementById('headerTitle');
  const subEl = document.getElementById('headerSub');
  if (v) {
    if (titleEl) titleEl.textContent = v.title;
    if (subEl) subEl.textContent = v.subtitle;
  } else {
    // Asset views
    const titles = { actions: 'Cockpit Actions & Crypto', cash: 'Tr\u00e9sorerie & Cash', immobilier: 'Portefeuille Immobilier', creances: 'Cr\u00e9ances & Recouvrements' };
    const subs = { actions: 'Toutes les positions actions, crypto, ETFs — IBKR + ESPP + SGTM', cash: 'Vue consolid\u00e9e de tous les comptes cash — Amine & Nezha', immobilier: '3 biens immobiliers — Vitry, Rueil, Villejuif', creances: 'Cr\u00e9ances actives — analyse de recouvrement et co\u00fbt d\'opportunit\u00e9' };
    if (titleEl) titleEl.textContent = titles[view] || '';
    if (subEl) subEl.textContent = subs[view] || '';
  }
}

function renderKPIs(state, view) {
  const s = state;
  const isAssetView = ASSET_VIEWS.includes(view);

  // Show/hide KPI strips (person views)
  ['couple', 'amine', 'nezha'].forEach(v => {
    const el = document.getElementById('kpi-' + v);
    if (el) el.classList.toggle('hidden', v !== view);
  });

  // Show/hide data-view sections (exclude nav buttons)
  document.querySelectorAll('[data-view]:not(.view-btn)').forEach(el => {
    const views = el.dataset.view.split(' ');
    el.classList.toggle('hidden', !views.includes(view));
  });

  // Hide cat-grid and expand sections for asset views
  const catNav = document.getElementById('catNav');
  if (catNav) catNav.classList.toggle('hidden', isAssetView);

  // Set KPI values
  setEur('kpiCoupleNW', s.couple.nw);
  setEur('kpiCoupleAmNW', s.amine.nw);
  setEur('kpiCoupleNzNW', s.nezha.nwWithVillejuif);
  setEur('kpiCoupleImmo', s.couple.immoEquity);

  setEur('kpiAmNW', s.amine.nw);
  setEur('kpiAmPortfolio', s.amine.ibkr + s.amine.espp);
  setEur('kpiAmVitry', s.amine.vitryEquity);

  setEur('kpiNzNW', s.nezha.nw);
  setEur('kpiNzRueil', s.nezha.rueilEquity);
  setEur('kpiNzVillejuif', s.nezha.villejuifEquity);
  setEur('kpiNzCash', s.nezha.cash + s.nezha.recvOmar);

  // Amine detail KPIs
  setEur('kpiAmIBKR', s.amine.ibkr);
  setEur('kpiAmESPP', s.amine.espp);
  setEur('kpiAmSGTM', s.amine.sgtm);

  // IBKR NAV label
  setText('ibkrNAVLabel', fmt(s.amine.ibkr));

  // PCT displays
  document.querySelectorAll('[data-type="pct"]').forEach(el => {
    const pctVal = el.dataset.eurPct;
    if (pctVal) el.textContent = '+' + pctVal + '%';
  });
}

function renderCategoryCards(state, view) {
  const v = state.views[view];
  const catCards = document.querySelectorAll('.cat-card');
  if (catCards.length < 4) return;

  const cards = {
    stocks: catCards[0],
    cash: catCards[1],
    immo: catCards[2],
    other: catCards[3],
  };

  // Show/hide
  ['stocks', 'cash', 'immo', 'other'].forEach(key => {
    cards[key].classList.remove('hidden');
  });

  // Update values
  ['stocks', 'cash', 'immo', 'other'].forEach(key => {
    const cardData = v[key];
    cards[key].querySelector('.cat-amount').dataset.eur = cardData.val;
    cards[key].querySelector('.cat-sub').textContent = cardData.sub;
    if (cardData.title) cards[key].querySelector('.cat-title').textContent = cardData.title;
    else if (key === 'other' && !cardData.title) {
      // Reset title when switching back to couple view
      cards[key].querySelector('.cat-title').textContent = 'Autres Actifs';
    }
  });

  // Grid columns
  const visCats = document.querySelectorAll('.cat-card:not(.hidden)').length;
  const grid = document.getElementById('catGrid');
  if (grid) grid.style.gridTemplateColumns = 'repeat(' + Math.min(visCats, 4) + ', 1fr)';
}

function renderCategoryPcts(state, view) {
  const v = state.views[view];
  const catCards = document.querySelectorAll('.cat-card');
  if (catCards.length < 4) return;

  const nwRef = v.nwRef;
  ['stocks', 'cash', 'immo', 'other'].forEach((key, i) => {
    const card = catCards[i];
    if (card.classList.contains('hidden')) return;
    const amt = v[key].val;
    const pctEl = card.querySelector('.cat-pct');
    if (pctEl && nwRef > 0) pctEl.textContent = (amt / nwRef * 100).toFixed(0) + '%';
  });
}

function renderExpandSubs(state) {
  const s = state;
  // Sub expand card values
  setEur('subIBKR', s.amine.ibkr);
  setEur('subESPP', s.amine.espp);
  setEur('subSGTM', s.amine.sgtm);
  setEur('subUAE', s.amine.uae);
  setEur('subMarocCash', s.amine.moroccoCash);
  setEur('subVitryEq', s.amine.vitryEquity);
  setEur('subRueilEq', s.nezha.rueilEquity);
  setEur('subVillejuifEq', s.nezha.villejuifEquity);
  setEur('subCreances', s.amine.recvPro + s.amine.recvPersonal);

  // ESPP detail label
  const p = state.portfolio;
  const srcLabel = state.stockSource === 'live' ? ' (live)' : ' (statique)';
  setHTML('subESPPDetail', p.amine.espp.shares + ' actions ACN @ $' + p.market.acnPriceUSD.toFixed(0) + srcLabel + '<br>+ cash ~' + p.amine.espp.cashEUR.toLocaleString('fr-FR') + ' EUR');
  setHTML('subSGTMDetail', p.amine.sgtm.shares + ' actions @ ' + p.market.sgtmPriceMAD + ' DH (statique)<br>Bourse de Casablanca');

  // Maroc FX note
  setText('subMarocFXNote', 'Total MAD ' + s.amine.moroccoMAD.toLocaleString('fr-FR') + ' / ' + s.fx.MAD.toFixed(4));
}

function renderCoupleTable(state) {
  const s = state;
  const p = state.portfolio;
  const rows = [
    ['Actions & ETFs (IBKR + ' + p.amine.espp.shares + ' ACN + ' + (p.amine.sgtm.shares * 2) + ' SGTM)', s.amine.ibkr + s.amine.espp + s.amine.sgtm + s.nezha.sgtm],
    ['Cash EUR (Nezha France 85K)', s.nezha.cashFrance],
    ['Cash MAD (Nezha 100K + Amine 189K MAD)', s.nezha.cashMaroc + s.amine.moroccoCash],
    ['Cash AED/USD (Amine UAE)', s.amine.uae],
    ['Equity Immo \u2014 Vitry (Amine)', s.amine.vitryEquity],
    ['Equity Immo \u2014 Rueil (Nezha)', s.nezha.rueilEquity],
    ['Equity Immo \u2014 Villejuif VEFA (Nezha) [conditionnel]', s.nezha.villejuifEquity],
    ['Vehicules (Porsche Cayenne + Mercedes A)', s.amine.vehicles],
    ['Creances SAP & Tax (garanti, 45j)', s.amine.recvPro],
    ['Creances personnelles Amine (recouvrement incertain)', s.amine.recvPersonal],
    ['Creance Omar \u2014 Nezha (40K MAD)', s.nezha.recvOmar],
    ['TVA a payer (Amine)', s.amine.tva],
  ];
  buildDetailTable('#coupleDetailTable tbody', rows, 'Net Worth Couple');
}

function renderAmineTable(state) {
  const s = state;
  const p = state.portfolio;
  const acnPrice = '$' + p.market.acnPriceUSD.toFixed(0);
  const sgtmPrice = p.market.sgtmPriceMAD.toFixed(0) + ' DH';
  const rows = [
    ['Portefeuille IBKR (actions + ETFs + cash)', s.amine.ibkr],
    ['ESPP Accenture (' + p.amine.espp.shares + ' ACN @ ' + acnPrice + ')', s.amine.espp],
    ['SGTM (' + p.amine.sgtm.shares + ' actions @ ' + sgtmPrice + ')', s.amine.sgtm],
    ['Cash UAE (' + Math.round(s.amine.uaeAED).toLocaleString('fr-FR') + ' AED + ' + p.amine.uae.revolutEUR.toLocaleString('fr-FR') + ' EUR)', s.amine.uae],
    ['Cash Maroc (' + Math.round(s.amine.moroccoMAD).toLocaleString('fr-FR') + ' MAD)', s.amine.moroccoCash],
    ['Immobilier Vitry (equity \u2014 val. appreciee 2%/an)', s.amine.vitryEquity],
    ['Vehicules (Porsche Cayenne + Mercedes A)', s.amine.vehicles],
    ['Creances SAP & Tax (TJM 910 x 20j, garanti 45j)', s.amine.recvPro],
    ['Creances personnelles (recouvrement incertain)', s.amine.recvPersonal],
    ['TVA a payer', s.amine.tva],
  ];
  buildDetailTable('#amineDetailTable tbody', rows, 'Net Worth Amine');
}

function renderNezhaTable(state) {
  const s = state;
  const p = state.portfolio;
  const sgtmLabel = p.nezha.sgtm.shares + ' actions SGTM @ ' + p.market.sgtmPriceMAD + ' DH';
  const rows = [
    ['Equity Rueil-Malmaison', s.nezha.rueilEquity],
    ['Cash France', s.nezha.cashFrance],
    ['Cash Maroc (' + Math.round(s.nezha.cashMarocMAD).toLocaleString('fr-FR') + ' MAD)', s.nezha.cashMaroc],
    ['Creance Omar (' + Math.round(s.nezha.recvOmarMAD).toLocaleString('fr-FR') + ' MAD)', s.nezha.recvOmar],
    ['SGTM (' + sgtmLabel + ')', s.nezha.sgtm],
  ];
  const tbody = document.querySelector('#nezhaDetailTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  let total = 0;
  rows.forEach(([label, val]) => {
    total += val;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + label + '</td><td class="num">' + fmt(val) + '</td>';
    tbody.appendChild(tr);
  });
  // NW actuel
  let tr = document.createElement('tr');
  tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
  tr.innerHTML = '<td><strong>Net Worth Nezha (actuel)</strong></td><td class="num"><strong>' + fmt(total) + '</strong></td>';
  tbody.appendChild(tr);
  // Villejuif conditionnel
  tr = document.createElement('tr');
  tr.innerHTML = '<td colspan="2" style="padding-top:12px"><strong>Villejuif VEFA <span style="background:#fef3c7;padding:1px 6px;border-radius:4px;font-size:11px;color:#92400e">CONDITIONNEL \u2014 acte non signe</span></strong></td>';
  tbody.appendChild(tr);
  tr = document.createElement('tr');
  tr.innerHTML = '<td>Equity Villejuif VEFA (estimee)</td><td class="num">' + fmt(s.nezha.villejuifEquity) + '</td>';
  tbody.appendChild(tr);
  tr = document.createElement('tr');
  tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
  tr.innerHTML = '<td><strong>Net Worth avec Villejuif</strong></td><td class="num"><strong>' + fmt(total + s.nezha.villejuifEquity) + '</strong></td>';
  tbody.appendChild(tr);
}

function renderIBKRPositionsSimple(state) {
  const tbody = document.getElementById('ibkrPositionsTbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const positions = state.ibkrPositions;

  // Show top 6
  positions.slice(0, 6).forEach(pos => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + pos.label + ' <span style="color:var(--gray);font-size:11px">@ ' + pos.priceLabel + '</span></td>'
      + '<td class="num">' + pos.shares + '</td>'
      + '<td class="num">' + fmt(pos.valEUR) + '</td>';
    tbody.appendChild(tr);
  });
  // Cash
  const cashEUR = state.portfolio.amine.ibkr.cashEUR;
  if (cashEUR > 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td style="color:var(--gray)">Cash IBKR</td><td class="num">\u2014</td><td class="num">' + fmt(cashEUR) + '</td>';
    tbody.appendChild(tr);
  }
  // Total
  const totalRow = document.createElement('tr');
  totalRow.style.fontWeight = '700'; totalRow.style.background = '#edf2f7';
  totalRow.innerHTML = '<td><strong>NAV Total</strong></td><td></td><td class="num"><strong>' + fmt(state.amine.ibkr) + '</strong></td>';
  tbody.appendChild(totalRow);
}

function renderImmoKPIs(state) {
  setEur('kpiImmoEq', state.couple.immoEquity);
  setEur('kpiImmoVal', state.couple.immoValue);
  setEur('kpiImmoCRD', state.couple.immoCRD);
}

function renderBadges(state) {
  // FX badge is updated by app.js directly
  // Stock badge is updated by app.js directly
  // FX footer display
  const fxDisp = document.getElementById('fxDisplay');
  if (fxDisp) {
    fxDisp.textContent = state.fx.AED.toFixed(4) + ' AED | ' + state.fx.MAD.toFixed(4) + ' MAD | ' + state.fx.USD.toFixed(4) + ' USD | ' + state.fx.JPY.toFixed(2) + ' JPY';
  }
}

function renderImmoPcts(state) {
  const s = state;
  const cplPct = (s.couple.immoEquity / s.couple.nw * 100).toFixed(1);
  setText('cplImmoPct', cplPct);
  setText('cplImmoVal', fmt(s.couple.immoEquity));

  const amPct = (s.amine.vitryEquity / s.amine.nw * 100).toFixed(1);
  setText('amImmoPct', amPct);
  setText('amImmoVal', fmt(s.amine.vitryEquity));
}

function updateAllDataEur() {
  // Update all elements with data-eur (not handled by specific renderers)
  document.querySelectorAll('[data-eur]').forEach(el => {
    if (el.dataset.type === 'pct') return; // handled separately
    const eurVal = parseFloat(el.dataset.eur);
    if (isNaN(eurVal)) return;
    const sign = el.dataset.sign || '';
    el.textContent = sign + fmt(eurVal);
  });
}

// ---- Helpers ----

function setEur(id, val) {
  const el = document.getElementById(id);
  if (el) el.dataset.eur = val;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

// ---- SORTABLE IBKR POSITIONS ----

let _ibkrSortKey = null;
let _ibkrSortDir = 'desc';

function renderIBKRPositions(positions, sortKey, sortDir) {
  const sorted = [...positions];
  if (sortKey) {
    sorted.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'label') {
        va = (va || '').toLowerCase();
        vb = (vb || '').toLowerCase();
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      if (sortKey === 'price') {
        va = a.price || 0;
        vb = b.price || 0;
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }
  const tbody = document.getElementById('actionsPositionsTbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  let totalVal = 0, totalCost = 0;
  sorted.forEach(pos => {
    totalVal += pos.valEUR;
    totalCost += pos.costEUR;
    const plC = pos.unrealizedPL >= 0 ? 'pl-pos' : 'pl-neg';
    const plS = pos.unrealizedPL >= 0 ? '+' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + pos.label + '</td>'
      + '<td class="num">' + pos.shares + '</td>'
      + '<td class="num">' + pos.priceLabel + '</td>'
      + '<td class="num">' + fmt(pos.costEUR) + '</td>'
      + '<td class="num">' + fmt(pos.valEUR) + '</td>'
      + '<td class="num ' + plC + '">' + plS + fmt(pos.unrealizedPL) + '</td>'
      + '<td class="num ' + plC + '">' + plS + pos.pctPL.toFixed(1) + '%</td>'
      + '<td class="num">' + pos.weight.toFixed(1) + '%</td>';
    tbody.appendChild(tr);
  });
  const totalPL = totalVal - totalCost;
  const totalPctPL = totalCost > 0 ? (totalPL / totalCost * 100) : 0;
  const tPlC = totalPL >= 0 ? 'pl-pos' : 'pl-neg';
  const tPlS = totalPL >= 0 ? '+' : '';
  const tr = document.createElement('tr');
  tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
  tr.innerHTML = '<td><strong>Total Positions</strong></td><td></td><td></td>'
    + '<td class="num"><strong>' + fmt(totalCost) + '</strong></td>'
    + '<td class="num"><strong>' + fmt(totalVal) + '</strong></td>'
    + '<td class="num ' + tPlC + '"><strong>' + tPlS + fmt(totalPL) + '</strong></td>'
    + '<td class="num ' + tPlC + '"><strong>' + tPlS + totalPctPL.toFixed(1) + '%</strong></td>'
    + '<td class="num">100%</td>';
  tbody.appendChild(tr);

  // Update arrow indicators
  const table = document.getElementById('ibkrPositionsTable');
  if (table) {
    table.querySelectorAll('.sort-arrow').forEach(a => { a.className = 'sort-arrow'; });
    if (sortKey) {
      const active = table.querySelector('th[data-sort="' + sortKey + '"] .sort-arrow');
      if (active) active.className = 'sort-arrow ' + sortDir;
    }
  }
}

function setupPositionsSort(positions) {
  const table = document.getElementById('ibkrPositionsTable');
  if (!table) return;
  // Remove old listeners by replacing thead
  const thead = table.querySelector('thead');
  const newThead = thead.cloneNode(true);
  thead.parentNode.replaceChild(newThead, thead);
  newThead.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (_ibkrSortKey === key) {
        _ibkrSortDir = _ibkrSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        _ibkrSortKey = key;
        _ibkrSortDir = key === 'label' ? 'asc' : 'desc';
      }
      renderIBKRPositions(positions, _ibkrSortKey, _ibkrSortDir);
    });
  });
}

// ---- ASSET VIEW RENDERERS ----

function renderActionsView(state) {
  const av = state.actionsView;
  // KPIs — cross-platform
  setEur('kpiActionsTotal', av.totalStocks);
  const plCls = av.combinedUnrealizedPL >= 0 ? 'pl-pos' : 'pl-neg';
  const plSign = av.combinedUnrealizedPL >= 0 ? '+' : '';
  setText('kpiActionsUnrealizedPL', plSign + fmt(av.combinedUnrealizedPL));
  document.getElementById('kpiActionsUnrealizedPL')?.classList.add(plCls);
  const rplCls = av.combinedRealizedPL >= 0 ? 'pl-pos' : 'pl-neg';
  const rplSign = av.combinedRealizedPL >= 0 ? '+' : '';
  setText('kpiActionsRealizedPL', rplSign + fmt(av.combinedRealizedPL));
  document.getElementById('kpiActionsRealizedPL')?.classList.add(rplCls);
  setText('kpiActionsTotalDeposits', fmt(av.totalDeposits));
  setText('kpiActionsDividends', fmt(av.dividends) + ' | TWR +' + av.twr.toFixed(1) + '%');

  // Positions table — sortable
  renderIBKRPositions(av.ibkrPositions, null, null);
  setupPositionsSort(av.ibkrPositions);

  // Closed positions
  const closedTbody = document.getElementById('actionsClosedTbody');
  if (closedTbody) {
    closedTbody.innerHTML = '';
    let totalClosed = 0;
    av.closedPositions.forEach(cp => {
      totalClosed += cp.pl;
      const cls = cp.pl >= 0 ? 'pl-pos' : 'pl-neg';
      const s = cp.pl >= 0 ? '+' : '';
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + cp.label + ' (' + cp.ticker + ')</td><td class="num ' + cls + '">' + s + fmt(cp.pl) + '</td>';
      closedTbody.appendChild(tr);
    });
    const tr = document.createElement('tr');
    tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
    const cls = totalClosed >= 0 ? 'pl-pos' : 'pl-neg';
    tr.innerHTML = '<td><strong>Total</strong></td><td class="num ' + cls + '"><strong>+' + fmt(totalClosed) + '</strong></td>';
    closedTbody.appendChild(tr);
  }

  // Other actions (ESPP + SGTM) with cost basis & P/L
  const otherTbody = document.getElementById('actionsOtherTbody');
  if (otherTbody) {
    otherTbody.innerHTML = '';
    const esppPL = av.esppUnrealizedPL;
    const esppPLcls = esppPL >= 0 ? 'pl-pos' : 'pl-neg';
    const esppPLs = esppPL >= 0 ? '+' : '';
    const rows = [
      { label: 'ESPP Accenture (' + av.esppShares + ' ACN @ $' + av.esppPrice.toFixed(2) + ')', cost: av.esppCostBasisEUR, val: av.esppCurrentVal, pl: esppPL, plCls: esppPLcls, plS: esppPLs },
      { label: 'ESPP Cash r\u00e9siduel', cost: av.esppCashEUR, val: av.esppCashEUR, pl: 0, plCls: '', plS: '' },
      { label: 'SGTM Amine (32 actions)', cost: null, val: av.sgtmAmineVal, pl: null, plCls: '', plS: '' },
      { label: 'SGTM Nezha (32 actions)', cost: null, val: av.sgtmNezhaVal, pl: null, plCls: '', plS: '' },
    ];
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + r.label + '</td>'
        + '<td class="num">' + (r.cost !== null ? fmt(r.cost) : '—') + '</td>'
        + '<td class="num">' + fmt(r.val) + '</td>'
        + '<td class="num ' + r.plCls + '">' + (r.pl !== null ? r.plS + fmt(r.pl) : '—') + '</td>';
      otherTbody.appendChild(tr);
    });
  }

  // IBKR cash table
  const cashTbody = document.getElementById('actionsCashTbody');
  if (cashTbody) {
    cashTbody.innerHTML = '';
    const fx = state.fx;
    [
      ['EUR', av.ibkrCashEUR.toLocaleString('fr-FR'), fmt(av.ibkrCashEUR)],
      ['USD', '$' + av.ibkrCashUSD.toLocaleString('en-US'), fmt(av.ibkrCashUSD / fx.USD)],
      ['JPY', '\u00a5' + av.ibkrCashJPY.toLocaleString('ja-JP'), fmt(av.ibkrCashJPY / fx.JPY)],
    ].forEach(([cur, native, eur]) => {
      const tr = document.createElement('tr');
      const cls = cur === 'JPY' ? 'pl-neg' : '';
      tr.innerHTML = '<td>' + cur + '</td><td class="num ' + cls + '">' + native + '</td><td class="num ' + cls + '">' + eur + '</td>';
      cashTbody.appendChild(tr);
    });
    const tr = document.createElement('tr');
    tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
    tr.innerHTML = '<td><strong>Total Cash IBKR</strong></td><td></td><td class="num"><strong>' + fmt(av.ibkrCashTotal) + '</strong></td>';
    cashTbody.appendChild(tr);
  }

  // Degiro closed positions
  const degiroTbody = document.getElementById('degiroClosedTbody');
  if (degiroTbody) {
    degiroTbody.innerHTML = '';
    let totalCost = 0, totalProceeds = 0, totalDegiro = 0;
    av.degiroClosedPositions.forEach(cp => {
      totalCost += (cp.costEUR || 0);
      totalProceeds += (cp.proceedsEUR || 0);
      totalDegiro += cp.pl;
      const cls = cp.pl >= 0 ? 'pl-pos' : 'pl-neg';
      const s = cp.pl >= 0 ? '+' : '';
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + cp.label + '</td><td class="num">' + fmt(cp.costEUR || 0) + '</td><td class="num">' + fmt(cp.proceedsEUR || 0) + '</td><td class="num ' + cls + '">' + s + fmt(cp.pl) + '</td>';
      degiroTbody.appendChild(tr);
    });
    const tr = document.createElement('tr');
    tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
    const cls = totalDegiro >= 0 ? 'pl-pos' : 'pl-neg';
    tr.innerHTML = '<td><strong>Total Degiro</strong></td><td class="num"><strong>' + fmt(totalCost) + '</strong></td><td class="num"><strong>' + fmt(totalProceeds) + '</strong></td><td class="num ' + cls + '"><strong>+' + fmt(totalDegiro) + '</strong></td>';
    degiroTbody.appendChild(tr);
  }

  // Combined realized P/L
  setText('actionsCombinedPL', '+' + fmt(av.combinedRealizedPL));
  const combinedEl = document.getElementById('actionsCombinedPL');
  if (combinedEl) combinedEl.classList.add('pl-pos');

  // Metrics
  setText('actionsCommissions', fmt(av.commissions));
  setText('actionsDeposits', fmt(av.deposits));
  setText('actionsNAV', fmt(av.ibkrNAV));
  setText('actionsTWR', '+' + av.twr.toFixed(1) + '%');

  // Insights
  const insightsContainer = document.getElementById('actionsInsights');
  if (insightsContainer && av.insights) {
    insightsContainer.innerHTML = '';
    av.insights.forEach(ins => {
      const card = document.createElement('div');
      card.style.cssText = 'background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;';
      let html = '<h4 style="margin:0 0 10px 0;font-size:14px;color:var(--accent);">' + ins.title + '</h4>';

      if (ins.type === 'track-record') {
        const winColor = ins.winRate >= 60 ? 'var(--green)' : ins.winRate >= 50 ? '#dd6b20' : '#e53e3e';
        html += '<div style="font-size:28px;font-weight:700;color:' + winColor + ';">' + ins.winRate.toFixed(0) + '% win rate</div>';
        html += '<div style="font-size:12px;color:#718096;margin-bottom:8px;">' + ins.winners + ' gagnantes / ' + ins.losers + ' perdantes sur ' + ins.totalTrades + ' trades</div>';
        html += '<div style="font-size:13px;">Gains : <strong class="pl-pos">+' + fmt(ins.totalWins) + '</strong> | Pertes : <strong class="pl-neg">-' + fmt(ins.totalLosses) + '</strong></div>';
        html += '<div style="font-size:13px;">Profit factor : <strong>' + (ins.profitFactor === Infinity ? '\u221e' : ins.profitFactor.toFixed(1)) + 'x</strong></div>';
        if (ins.topWin) html += '<div style="font-size:12px;margin-top:6px;color:#718096;">Meilleur trade : ' + ins.topWin.label + ' (+' + fmt(ins.topWin.pl) + ')</div>';
        if (ins.topLoss) html += '<div style="font-size:12px;color:#718096;">Pire trade : ' + ins.topLoss.label + ' (' + fmt(ins.topLoss.pl) + ')</div>';
      }

      else if (ins.type === 'concentration') {
        html += '<div style="font-size:13px;margin-bottom:8px;">Top 3 = <strong>' + ins.top3Pct.toFixed(0) + '%</strong> du portefeuille (' + ins.totalPositions + ' positions)</div>';
        ins.top3.forEach(p => {
          html += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid #edf2f7;">'
            + '<span>' + p.label + '</span><strong>' + p.pct.toFixed(1) + '%</strong></div>';
        });
        if (ins.top3Pct > 40) {
          html += '<div style="font-size:12px;color:#dd6b20;margin-top:8px;">\u26A0 Concentration \u00e9lev\u00e9e. Envisager de r\u00e9\u00e9quilibrer vers des ETFs.</div>';
        }
      }

      else if (ins.type === 'underperformers') {
        html += '<div style="font-size:13px;margin-bottom:8px;">Perte latente totale : <strong class="pl-neg">' + fmt(ins.totalLossEUR) + '</strong></div>';
        ins.positions.forEach(p => {
          html += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid #edf2f7;">'
            + '<span>' + p.label + '</span><span class="pl-neg">' + p.pctPL.toFixed(1) + '% (' + fmt(p.unrealizedPL) + ')</span></div>';
        });
        html += '<div style="font-size:12px;color:#718096;margin-top:8px;">\u2192 \u00c9valuer : couper les pertes ou moyenner \u00e0 la baisse ?</div>';
      }

      else if (ins.type === 'geo') {
        html += '<div style="font-size:13px;">';
        html += 'France : <strong>' + ins.francePct.toFixed(0) + '%</strong> | ';
        html += 'US : <strong>' + ins.usPct.toFixed(0) + '%</strong> | ';
        html += 'Crypto : <strong>' + ins.cryptoPct.toFixed(0) + '%</strong> | ';
        html += 'Autres : <strong>' + ins.emergingPct.toFixed(0) + '%</strong></div>';
        if (ins.francePct > 60) {
          html += '<div style="font-size:12px;color:#dd6b20;margin-top:8px;">\u26A0 Biais domestique important (' + ins.francePct.toFixed(0) + '% France). Le CAC 40 ne repr\u00e9sente que ~3% de la capitalisation mondiale. Diversifier via un ETF World (IWDA/VWCE).</div>';
        }
      }

      else if (ins.type === 'costs') {
        html += '<div style="font-size:13px;">Commissions YTD : <strong>' + fmt(ins.commissions) + '</strong> (' + ins.commPct.toFixed(2) + '% du portefeuille)</div>';
        html += '<div style="font-size:13px;">Dividendes YTD : <strong class="pl-pos">' + fmt(ins.dividends) + '</strong> (rendement ' + ins.divYield.toFixed(2) + '%)</div>';
        if (ins.commPct > 0.3) {
          html += '<div style="font-size:12px;color:#dd6b20;margin-top:8px;">Les commissions sont \u00e9lev\u00e9es. Le passage aux ETFs r\u00e9duirait drastiquement les frais de transaction.</div>';
        }
      }

      else if (ins.type === 'recommendation') {
        html += '<div style="font-size:13px;line-height:1.6;">';
        html += '<div style="margin-bottom:6px;"><strong>\u2705 Points positifs :</strong></div>';
        html += '<div style="margin-left:8px;margin-bottom:8px;">';
        html += '- P/L r\u00e9alis\u00e9 cumul\u00e9 +' + fmt(ins.combinedRealizedPL) + ' montre un historique rentable<br>';
        if (ins.twr > 10) html += '- TWR de +' + ins.twr.toFixed(1) + '% (correct mais comparer au MSCI World)<br>';
        if (ins.winRate > 60) html += '- Win rate de ' + ins.winRate.toFixed(0) + '% montre un bon flair de s\u00e9lection<br>';
        html += '</div>';
        html += '<div style="margin-bottom:6px;"><strong>\u26A0 Axes d\'am\u00e9lioration :</strong></div>';
        html += '<div style="margin-left:8px;">';
        if (ins.francePct > 50) html += '- <strong>R\u00e9duire le biais France</strong> : allouer 50-70% en ETF World (IWDA) pour capturer la croissance US/Asie<br>';
        html += '- <strong>Moins de stock picking</strong> : les 14 lignes g\u00e9n\u00e8rent du stress et des commissions. Un c\u0153ur ETF (80%) + satellites stock picking (20%) serait plus efficace<br>';
        html += '- <strong>Strat\u00e9gie DCA</strong> : automatiser des versements mensuels sur 2-3 ETFs plut\u00f4t que du timing de march\u00e9<br>';
        if (ins.currentLosersCount > 2) html += '- <strong>Couper les positions mortes</strong> : ' + ins.currentLosersCount + ' positions \u00e0 -10%+. \u00c9valuer si la th\u00e8se d\'investissement tient toujours<br>';
        html += '- <strong>Pas de tech US directe</strong> : manque d\'exposition aux GAFAM/Magnificent 7 (seulement via ESPP Accenture)<br>';
        html += '</div></div>';
      }

      card.innerHTML = html;
      insightsContainer.appendChild(card);
    });
  }
}

function renderCashView(state) {
  const cv = state.cashView;
  // KPIs
  setEur('kpiCashTotal', cv.totalCash);
  setText('kpiCashAvgYield', (cv.weightedAvgYield * 100).toFixed(1) + '%');
  setText('kpiCashInflation', '-' + fmt(cv.monthlyInflationCost));
  document.getElementById('kpiCashInflation')?.classList.add('pl-neg');
  setText('kpiCashProductive', fmt(cv.totalYielding));

  // Accounts table — grouped by owner with subtotals
  const tbody = document.getElementById('cashAccountsTbody');
  if (tbody) {
    tbody.innerHTML = '';
    const REF_YIELD = 0.06; // 6% benchmark
    const owners = ['Amine', 'Nezha'];
    let grandTotalYieldAnn = 0, grandTotalMissed = 0;
    owners.forEach(owner => {
      const ownerAccounts = cv.accounts.filter(a => a.owner === owner);
      if (ownerAccounts.length === 0) return;
      const ownerPositive = ownerAccounts.filter(a => !a.isDebt);
      const ownerTotal = ownerPositive.reduce((s, a) => s + a.valEUR, 0);
      const ownerColor = owner === 'Amine' ? '#ebf5fb' : '#fef9e7';
      const borderColor = owner === 'Amine' ? 'var(--accent)' : 'var(--gold)';
      // Owner header row
      const hdr = document.createElement('tr');
      hdr.style.cssText = 'background:' + ownerColor + ';border-left:3px solid ' + borderColor + ';';
      hdr.innerHTML = '<td colspan="5" style="font-weight:700;font-size:13px;padding:8px 12px;">' + owner + ' \u2014 ' + fmt(ownerTotal) + '</td><td colspan="3" style="font-size:12px;color:var(--gray);text-align:right;padding-right:12px;">' + ((ownerTotal / cv.totalCash) * 100).toFixed(0) + '% du total</td>';
      tbody.appendChild(hdr);
      // Account rows
      let ownerYieldAnn = 0, ownerMissed = 0;
      ownerAccounts.forEach(a => {
        const isDebt = a.isDebt;
        const isNeg = a.valEUR < 0;
        const cls = isNeg ? ' class="pl-neg"' : '';
        const nativeStr = Math.round(a.native).toLocaleString('fr-FR');
        // Yield display
        let yieldStr, yieldAnn;
        if (isDebt) {
          // Debt: show borrowing cost as negative yield
          const costRate = Math.abs(a.yield || 0);
          const costAnn = Math.abs(a.valEUR) * costRate;
          yieldStr = '<span class="pl-neg">-' + (costRate * 100).toFixed(1) + '%</span>';
          yieldAnn = '<span class="pl-neg">-' + fmt(costAnn) + '</span>';
          ownerYieldAnn -= costAnn; // subtract interest cost from owner total
        } else {
          yieldStr = a.yield > 0 ? (a.yield * 100).toFixed(1) + '%' : '0%';
          yieldAnn = a.yield > 0 ? fmt(a.valEUR * a.yield) : '-';
          ownerYieldAnn += a.valEUR * (a.yield || 0);
        }
        // Manque à gagner: (6% - actual yield) * valEUR for positive; interest cost for debt
        let missed, missedStr;
        if (isDebt) {
          const costAnn = Math.abs(a.valEUR) * Math.abs(a.yield || 0);
          missed = costAnn; // interest paid = opportunity cost
          missedStr = '<span class="pl-neg">-' + fmt(missed) + '</span>';
          ownerMissed += missed;
        } else if (a.valEUR > 0) {
          missed = a.valEUR * (REF_YIELD - (a.yield || 0));
          missedStr = missed > 10 ? '<span class="pl-neg">-' + fmt(missed) + '</span>' : '-';
          if (missed > 0) ownerMissed += missed;
        } else {
          missed = 0;
          missedStr = '-';
        }
        const tr = document.createElement('tr');
        tr.style.borderLeft = '3px solid ' + borderColor;
        if (isNeg) tr.style.background = '#fff5f5';
        tr.innerHTML = '<td style="padding-left:20px;">' + a.label + (isDebt ? ' <span style="font-size:10px;color:#e53e3e;">(emprunt)</span>' : '') + '</td>'
          + '<td>' + a.owner + '</td>'
          + '<td>' + a.currency + '</td>'
          + '<td class="num"' + cls + '>' + nativeStr + '</td>'
          + '<td class="num"' + cls + '>' + fmt(a.valEUR) + '</td>'
          + '<td class="num">' + yieldStr + '</td>'
          + '<td class="num">' + yieldAnn + '</td>'
          + '<td class="num">' + missedStr + '</td>';
        tbody.appendChild(tr);
      });
      grandTotalYieldAnn += ownerYieldAnn;
      grandTotalMissed += ownerMissed;
      // Owner subtotal row
      const ownerAvgYield = ownerTotal > 0 ? (ownerYieldAnn / ownerTotal * 100).toFixed(1) : '0.0';
      const sub = document.createElement('tr');
      sub.style.cssText = 'font-weight:600;background:' + ownerColor + ';border-left:3px solid ' + borderColor + ';border-top:2px solid ' + borderColor + ';';
      sub.innerHTML = '<td style="padding-left:20px;" colspan="4">Total ' + owner + '</td>'
        + '<td class="num">' + fmt(ownerTotal) + '</td>'
        + '<td class="num">' + ownerAvgYield + '%</td>'
        + '<td class="num">' + fmt(ownerYieldAnn) + '</td>'
        + '<td class="num pl-neg">-' + fmt(ownerMissed) + '</td>';
      tbody.appendChild(sub);
    });
    // Grand total
    const grandAvgYield = cv.totalCash > 0 ? (grandTotalYieldAnn / cv.totalCash * 100).toFixed(1) : '0.0';
    const tr = document.createElement('tr');
    tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
    tr.innerHTML = '<td colspan="4"><strong>Total Couple</strong></td>'
      + '<td class="num"><strong>' + fmt(cv.totalCash) + '</strong></td>'
      + '<td class="num"><strong>' + grandAvgYield + '%</strong></td>'
      + '<td class="num"><strong>' + fmt(grandTotalYieldAnn) + '</strong></td>'
      + '<td class="num pl-neg"><strong>-' + fmt(grandTotalMissed) + '</strong></td>';
    tbody.appendChild(tr);
  }

  // Yield bar
  const bar = document.getElementById('cashYieldBar');
  if (bar && cv.totalCash > 0) {
    const pctProd = (cv.totalYielding / cv.totalCash * 100).toFixed(0);
    const pctDorm = (100 - pctProd).toFixed(0);
    bar.innerHTML = '<div class="mb-seg" style="width:' + pctProd + '%;background:var(--green)">' + pctProd + '% (' + fmt(cv.totalYielding, true) + ')</div>'
      + '<div class="mb-seg" style="width:' + pctDorm + '%;background:var(--red)">' + pctDorm + '% (' + fmt(cv.totalNonYielding, true) + ')</div>';
  }

  // JPY note
  const jpyNote = document.getElementById('cashJPYNote');
  if (jpyNote) {
    jpyNote.innerHTML = '<strong>Note — Position JPY Short (IBKR) :</strong> ' + fmt(cv.jpyShortEUR)
      + ' (emprunt \u00a5' + Math.abs(state.portfolio.amine.ibkr.cashJPY).toLocaleString('ja-JP') + '). '
      + 'Ce n\'est pas du cash mais un levier devise. Non inclus dans le total cash ci-dessus. '
      + 'Un renforcement du yen de 10% co\u00fbterait ~' + fmt(Math.abs(cv.jpyShortEUR) * 0.1) + '.';
  }

  // ── Diagnostics stratégiques ──
  const diagContainer = document.getElementById('cashDiagnostics');
  if (diagContainer && cv.diagnostics) {
    diagContainer.innerHTML = '';
    const severityConfig = {
      urgent: { border: '#e53e3e', bg: '#fff5f5', label: 'PRIORIT\u00c9', labelBg: '#e53e3e' },
      warning: { border: '#dd6b20', bg: '#fffaf0', label: 'ATTENTION', labelBg: '#dd6b20' },
      info: { border: '#3182ce', bg: '#ebf8ff', label: 'CONSEIL', labelBg: '#3182ce' },
    };

    cv.diagnostics.forEach(d => {
      const cfg = severityConfig[d.severity] || severityConfig.info;
      const badge = '<span style="background:' + cfg.labelBg + ';color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">' + cfg.label + '</span>';

      let title = '', detail = '', actionsHtml = '';

      // ── Résumé stratégique ──
      if (d.category === 'summary') {
        title = '\uD83D\uDCCA Bilan : ' + d.dormantPct.toFixed(0) + '% du cash est dormant \u2014 manque \u00e0 gagner ' + fmt(d.totalMissedAnn) + '/an';
        detail = 'Rendement moyen actuel : ' + (d.avgYield * 100).toFixed(1) + '% vs ' + (d.targetYield * 100).toFixed(0) + '% atteignable. '
          + fmt(d.dormantEUR) + ' de cash rapporte moins de 3%. '
          + 'Co\u00fbt emprunt JPY : ' + fmt(d.jpyCostAnn) + '/an en plus.';
      }

      // ── Cash Nezha ──
      else if (d.category === 'nezha_cash') {
        title = '\uD83D\uDD25 Cash Nezha : ' + fmt(d.amountEUR) + ' \u00e0 0% \u2014 perd ' + fmt(d.gainPotentiel) + '/an';
        detail = 'Cash France : ' + fmt(d.cashFranceEUR) + ' | Cash Maroc : ' + fmt(d.cashMarocEUR) + '. '
          + 'C\'est le plus gros gisement de gains. Chaque mois qui passe co\u00fbte ~' + fmt(d.gainPotentiel / 12) + '.';
        actionsHtml = d.actions.map(a => '<div style="padding:3px 0;">\u2192 ' + a + '</div>').join('');
      }

      // ── IBKR EUR ──
      else if (d.category === 'ibkr_eur') {
        title = '\uD83D\uDCB0 IBKR EUR : ' + fmt(d.amountEUR) + ' \u00e0 ' + (d.effectiveYield * 100).toFixed(1) + '% effectif \u2014 manque ' + fmt(d.missedAnn) + '/an';
        detail = 'Premiers 10K\u20ac \u00e0 0% chez IBKR, le reste \u00e0 1.53%. Rendement effectif trop faible. '
          + 'Exc\u00e9dent de ~' + fmt(d.excessEUR) + ' pourrait rapporter ' + fmt(d.gainTransfert) + '/an plac\u00e9 \u00e0 6%.';
        actionsHtml = d.actions.map(a => '<div style="padding:3px 0;">\u2192 ' + a + '</div>').join('');
      }

      // ── Cash Maroc Amine ──
      else if (d.category === 'maroc_cash') {
        title = '\uD83C\uDDF2\uD83C\uDDE6 Cash Maroc Amine : ' + fmt(d.amountEUR) + ' \u00e0 0% \u2014 potentiel +' + fmt(d.gainPotentiel) + '/an';
        detail = 'Attijariwafa : ' + Math.round(d.attijariMAD).toLocaleString('fr-FR') + ' MAD | Nabd : ' + Math.round(d.nabdMAD).toLocaleString('fr-FR') + ' MAD. '
          + 'Des options existent pour faire travailler ce cash au Maroc.';
        actionsHtml = d.actions.map(a => '<div style="padding:3px 0;">\u2192 ' + a + '</div>').join('');
      }

      // ── JPY Levier ──
      else if (d.category === 'jpy_leverage') {
        title = '\uD83D\uDCB1 Levier JPY : \u00a5' + Math.round(d.jpyNative).toLocaleString('ja-JP') + ' emprunt\u00e9s \u2014 co\u00fbt ' + fmt(d.costAnn) + '/an';
        detail = 'Taux blend\u00e9 ' + (d.blendedRate * 100).toFixed(1) + '% (par tranche IBKR Pro). '
          + 'Risque de change : un yen \u00e0 +10% = perte de ~' + fmt(d.riskYen10pct) + ' suppl\u00e9mentaire.';
        actionsHtml = d.actions.map(a => '<div style="padding:3px 0;">\u2192 ' + a + '</div>').join('');
      }

      // ── IBKR USD ──
      else if (d.category === 'ibkr_usd') {
        title = '\uD83D\uDCB5 IBKR USD : ' + fmt(d.amountEUR) + ' \u00e0 ' + (d.effectiveYield * 100).toFixed(1) + '% effectif';
        detail = 'Premiers 10K$ \u00e0 0% r\u00e9duisent fortement le rendement. '
          + 'Manque \u00e0 gagner : ' + fmt(d.missedAnn) + '/an vs benchmark 6%.';
        actionsHtml = d.actions.map(a => '<div style="padding:3px 0;">\u2192 ' + a + '</div>').join('');
      }

      // ── Petits comptes ──
      else if (d.category === 'small_accounts') {
        title = '\uD83D\uDCE6 ' + d.count + ' petits comptes dormants : ' + fmt(d.amountEUR) + ' total';
        detail = d.labels;
        actionsHtml = d.actions.map(a => '<div style="padding:3px 0;">\u2192 ' + a + '</div>').join('');
      }

      // ── Plan d'action ──
      else if (d.category === 'action_plan') {
        title = '\uD83D\uDCCB Plan d\'action \u2014 r\u00e9cup\u00e9rer ' + fmt(d.totalMissedAnn) + '/an';
        detail = '';
        actionsHtml = d.steps.map(s => '<div style="padding:4px 0;font-size:13px;">' + s + '</div>').join('');
      }

      if (!title) return; // skip unknown categories

      const card = document.createElement('div');
      card.style.cssText = 'border-left:4px solid ' + cfg.border + ';background:' + cfg.bg + ';padding:14px 18px;border-radius:6px;';
      let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
        + badge + ' <strong style="font-size:14px;">' + title + '</strong></div>';
      if (detail) {
        html += '<div style="font-size:13px;color:#4a5568;margin-bottom:8px;">' + detail + '</div>';
      }
      if (actionsHtml) {
        html += '<div style="font-size:13px;background:#fff;border:1px solid #e2e8f0;padding:10px 14px;border-radius:4px;">'
          + '<strong style="color:' + cfg.border + ';">\u27A1 Actions :</strong>' + actionsHtml + '</div>';
      }
      card.innerHTML = html;
      diagContainer.appendChild(card);
    });
  }
}

function renderImmoView(state) {
  const iv = state.immoView;
  // KPIs
  setEur('kpiImmoViewEq', iv.totalEquity);
  setEur('kpiImmoViewVal', iv.totalValue);
  setEur('kpiImmoViewCRD', iv.totalCRD);
  setText('kpiImmoViewWealth', '+' + fmt(iv.totalWealthCreation) + '/mois');
  const cfCls = iv.totalCF >= 0 ? 'pl-pos' : 'pl-neg';
  const cfSign = iv.totalCF >= 0 ? '+' : '';
  setText('kpiImmoViewCF', cfSign + iv.totalCF + '/mois');
  document.getElementById('kpiImmoViewCF')?.classList.add(cfCls);

  // Property cards with fiscal data
  const grid = document.getElementById('propGrid');
  if (grid) {
    grid.innerHTML = '';
    iv.properties.forEach(prop => {
      const card = document.createElement('div');
      card.className = 'prop-card' + (prop.conditional ? ' conditional' : '');
      const cfClass = prop.cf >= 0 ? 'pl-pos' : 'pl-neg';
      const cfSign = prop.cf >= 0 ? '+' : '';
      const f = prop.fiscalite;
      const fiscLine = f ? '<div class="prop-kpi"><div class="pk-val pl-neg">' + f.monthlyImpot + '</div><div class="pk-label">Impot /mois</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + (prop.yieldNetFiscal || 0).toFixed(1) + '%</div><div class="pk-label">Yield net fiscal</div></div>'
        : '';
      const regimeBadge = f ? '<span style="background:#ebf8ff;padding:1px 6px;border-radius:4px;font-size:10px;color:#2b6cb0;margin-left:4px">' + (f.type === 'lmnp' ? 'LMNP' : 'NU') + ' ' + f.regime + '</span>' : '';
      card.innerHTML = '<h3>' + prop.name + regimeBadge + (prop.conditional ? ' <span style="background:#fef3c7;padding:1px 5px;border-radius:4px;font-size:10px;color:#92400e;">CONDITIONNEL</span>' : '') + '</h3>'
        + '<div class="prop-owner">' + prop.owner + '</div>'
        + '<div class="prop-kpis">'
        + '<div class="prop-kpi"><div class="pk-val pl-pos">' + fmt(prop.equity) + '</div><div class="pk-label">Equity</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + fmt(prop.value) + '</div><div class="pk-label">Valeur</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + fmt(prop.crd) + '</div><div class="pk-label">CRD</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + prop.ltv.toFixed(0) + '%</div><div class="pk-label">LTV</div></div>'
        + '<div class="prop-kpi"><div class="pk-val ' + cfClass + '">' + cfSign + prop.cf + '</div><div class="pk-label">CF /mois</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + prop.loyer + '</div><div class="pk-label">Loyer</div></div>'
        + fiscLine
        + '</div>';
      grid.appendChild(card);
    });
  }

  // Loans table
  const loansTbody = document.getElementById('immoLoansTbody');
  if (loansTbody) {
    loansTbody.innerHTML = '';
    iv.properties.forEach(prop => {
      const tr = document.createElement('tr');
      if (prop.conditional) tr.style.color = '#92400e';
      tr.innerHTML = '<td>' + prop.name + '</td>'
        + '<td class="num">' + prop.monthlyPayment + '/mois</td>'
        + '<td class="num">' + (prop.monthlyPayment - (prop.charges - prop.monthlyPayment > 0 ? 0 : 0)) + '</td>'
        + '<td class="num">' + prop.ltv.toFixed(1) + '%</td>'
        + '<td class="num">' + prop.endYear + '</td>'
        + '<td class="num">' + prop.yieldGross.toFixed(1) + '%</td>'
        + '<td class="num ' + (prop.yieldNet >= 0 ? 'pl-pos' : 'pl-neg') + '">' + prop.yieldNet.toFixed(1) + '%</td>';
      loansTbody.appendChild(tr);
    });
  }

  // Amortization KPIs
  setEur('kpiAmortInterestPaid', iv.totalInterestPaid);
  setEur('kpiAmortInterestRemaining', iv.totalInterestRemaining);

  // Milestones
  const schedules = iv.amortSchedules || {};
  const crossovers = Object.entries(schedules).filter(([,a]) => a.milestones.crossoverDate).map(([k,a]) => a.milestones.crossoverDate);
  setText('kpiAmortMilestone1', crossovers.length > 0 ? crossovers.sort()[Math.floor(crossovers.length/2)] : '-');
  const halfCRDs = Object.entries(schedules).filter(([,a]) => a.milestones.halfCRDDate).map(([k,a]) => a.milestones.halfCRDDate);
  setText('kpiAmortMilestone2', halfCRDs.length > 0 ? halfCRDs.sort()[0] : '-');

  // Amortization summary table
  const amortTbody = document.getElementById('amortSummaryTbody');
  if (amortTbody) {
    amortTbody.innerHTML = '';
    const loanNames = { vitry: 'Vitry', rueil: 'Rueil', villejuif: 'Villejuif' };
    for (const [key, amort] of Object.entries(schedules)) {
      const loan = state.portfolio ? null : null; // loan data is in the schedule
      const first = amort.schedule[0];
      const current = amort.schedule[amort.currentIdx] || amort.schedule[amort.schedule.length - 1];
      const principal = amort.schedule.length > 0 ? Math.round(amort.schedule.reduce((s,r) => s + r.principal, 0) + amort.schedule[0].remainingCRD + amort.schedule[0].interest - amort.schedule[0].payment) : 0;
      const totalPrincipal = Math.round(amort.totalInterest + amort.schedule[amort.schedule.length-1].remainingCRD + amort.schedule.reduce((s,r)=>s+r.principal,0) - amort.schedule.reduce((s,r)=>s+r.principal,0));
      const rate = amort.schedule.length > 1 ? (first.interest / (first.remainingCRD + first.principal) * 12 * 100).toFixed(2) : '-';
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (loanNames[key] || key) + '</td>'
        + '<td class="num">' + fmt(amort.schedule[0].remainingCRD + amort.schedule[0].principal) + '</td>'
        + '<td class="num">' + rate + '%</td>'
        + '<td class="num">' + Math.round(amort.schedule.length / 12) + ' ans</td>'
        + '<td class="num">' + first.payment + '/mois</td>'
        + '<td class="num">' + fmt(current.remainingCRD) + '</td>'
        + '<td class="num">' + fmt(amort.interestPaid) + '</td>'
        + '<td class="num">' + fmt(amort.interestRemaining) + '</td>';
      amortTbody.appendChild(tr);
    }
  }

  // Fiscal table
  const fiscTbody = document.getElementById('fiscalTbody');
  if (fiscTbody) {
    fiscTbody.innerHTML = '';
    let totalImpot = 0;
    iv.properties.forEach(prop => {
      const f = prop.fiscalite;
      if (!f) return;
      totalImpot += f.totalImpot;
      const tr = document.createElement('tr');
      if (prop.conditional) tr.style.color = '#92400e';
      const regimeLabel = f.type === 'lmnp' ? 'LMNP ' + f.regime : f.regime;
      tr.innerHTML = '<td>' + prop.name + '</td>'
        + '<td>' + regimeLabel + '</td>'
        + '<td class="num">' + f.loyerDeclare.toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + f.abattement.toLocaleString('fr-FR') + ' (' + f.abattementPct + '%)</td>'
        + '<td class="num">' + f.revenuImposable.toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + f.ir.toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + f.ps.toLocaleString('fr-FR') + '</td>'
        + '<td class="num pl-neg">' + f.totalImpot.toLocaleString('fr-FR') + '</td>'
        + '<td class="num ' + (prop.yieldNetFiscal >= 0 ? 'pl-pos' : 'pl-neg') + '">' + (prop.yieldNetFiscal || 0).toFixed(1) + '%</td>';
      fiscTbody.appendChild(tr);
    });
    // Total row
    const tr = document.createElement('tr');
    tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
    tr.innerHTML = '<td colspan="7"><strong>Total</strong></td>'
      + '<td class="num pl-neg"><strong>' + totalImpot.toLocaleString('fr-FR') + '/an</strong></td>'
      + '<td></td>';
    fiscTbody.appendChild(tr);
  }

  // Fiscal summary
  const fiscSummary = document.getElementById('fiscalSummary');
  if (fiscSummary) {
    const loyerAn = iv.totalLoyerAnnuel;
    const impotAn = iv.totalImpotAnnuel;
    const cashNonDeclare = iv.properties.reduce((s, p) => s + (p.fiscalite && p.fiscalite.loyerCash ? p.fiscalite.loyerCash : 0), 0);
    fiscSummary.innerHTML = '<strong>Synthese fiscale :</strong> '
      + 'Loyers declares ' + Math.round(loyerAn - cashNonDeclare).toLocaleString('fr-FR') + '/an'
      + (cashNonDeclare > 0 ? ' (+ ' + Math.round(cashNonDeclare).toLocaleString('fr-FR') + ' non declare)' : '')
      + ' | Impot total ' + impotAn.toLocaleString('fr-FR') + '/an (' + Math.round(impotAn / 12) + '/mois)'
      + ' | CF net fiscal total : <strong class="' + (iv.totalCFNetFiscal >= 0 ? 'pl-pos' : 'pl-neg') + '">' + (iv.totalCFNetFiscal >= 0 ? '+' : '') + iv.totalCFNetFiscal + '/mois</strong>';
  }
}

function renderCreancesView(state) {
  const crv = state.creancesView;
  // KPIs
  setEur('kpiCreancesNominal', crv.totalNominal);
  setEur('kpiCreancesExpected', crv.totalExpected);
  setEur('kpiCreancesGuaranteed', crv.totalGuaranteed);
  setEur('kpiCreancesUncertain', crv.totalUncertain);
  setText('kpiCreancesInflation', '-' + fmt(crv.monthlyInflationCost) + '/mois');

  // Detail table with recouvrement
  const tbody = document.getElementById('creancesDetailTbody');
  if (tbody) {
    tbody.innerHTML = '';
    crv.items.forEach(item => {
      const tr = document.createElement('tr');
      const probStyle = item.guaranteed ? 'color:var(--green);font-weight:600' : (item.probability >= 0.7 ? 'color:#d69e2e' : 'color:var(--red)');

      // Status badge
      const statusColors = { en_cours: '#3182ce', relancé: '#d69e2e', en_retard: '#c53030', recouvré: '#276749', litige: '#9f7aea' };
      const statusLabels = { en_cours: 'EN COURS', relancé: 'RELANCÉ', en_retard: 'EN RETARD', recouvré: 'RECOUVRÉ', litige: 'LITIGE' };
      const st = item.status || 'en_cours';
      const statusBadge = '<span style="background:' + (statusColors[st] || '#718096') + ';color:white;padding:1px 6px;border-radius:4px;font-size:10px">' + (statusLabels[st] || st.toUpperCase()) + '</span>';
      const followUpIcon = item.needsFollowUp ? ' <span title="Relancer ! Dernier contact il y a ' + item.daysSinceContact + 'j" style="color:var(--red);font-weight:700;cursor:help">⚠</span>' : '';
      const overdueTxt = item.daysOverdue > 0 ? ' <span style="color:var(--red);font-size:11px">(' + item.daysOverdue + 'j retard)</span>' : '';

      // Recovery progress bar
      const recovPct = Math.min(100, item.recoveryPct);
      const recovBar = item.paymentsTotal > 0
        ? '<div style="background:#e2e8f0;border-radius:4px;height:6px;margin-top:4px"><div style="background:var(--green);height:100%;border-radius:4px;width:' + recovPct + '%"></div></div>'
        : '';

      tr.innerHTML = '<td>' + item.label + ' ' + statusBadge + followUpIcon + overdueTxt + recovBar + '</td>'
        + '<td>' + item.owner + '</td>'
        + '<td>' + item.currency + '</td>'
        + '<td class="num">' + Math.round(item.amount).toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + fmt(item.amountEUR) + '</td>'
        + '<td class="num" style="' + probStyle + '">' + (item.probability * 100).toFixed(0) + '%</td>'
        + '<td class="num">' + fmt(item.expectedValue) + '</td>'
        + '<td class="num ' + (item.monthlyInflationCost > 0 ? 'pl-neg' : '') + '">' + (item.monthlyInflationCost > 0 ? '-' + fmt(item.monthlyInflationCost) : '-') + '</td>';
      tbody.appendChild(tr);
    });
    // Totals
    const tr = document.createElement('tr');
    tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
    tr.innerHTML = '<td colspan="4"><strong>Total</strong></td>'
      + '<td class="num"><strong>' + fmt(crv.totalNominal) + '</strong></td>'
      + '<td></td>'
      + '<td class="num"><strong>' + fmt(crv.totalExpected) + '</strong></td>'
      + '<td class="num pl-neg"><strong>-' + fmt(crv.monthlyInflationCost) + '</strong></td>';
    tbody.appendChild(tr);
  }

  // Garanti vs Incertain bar
  const bar = document.getElementById('creancesBar');
  if (bar && crv.totalNominal > 0) {
    const pctG = (crv.totalGuaranteed / crv.totalNominal * 100).toFixed(0);
    const pctU = (100 - pctG).toFixed(0);
    bar.innerHTML = '<div class="mb-seg" style="width:' + pctG + '%;background:var(--green)">' + pctG + '% (' + fmt(crv.totalGuaranteed, true) + ')</div>'
      + '<div class="mb-seg" style="width:' + pctU + '%;background:var(--red)">' + pctU + '% (' + fmt(crv.totalUncertain, true) + ')</div>';
  }

  // Follow-up alert
  if (crv.needsFollowUpCount > 0) {
    const alertEl = document.getElementById('creancesAlert');
    if (alertEl) {
      alertEl.innerHTML = '<strong style="color:var(--red)">⚠ ' + crv.needsFollowUpCount + ' creance(s) a relancer</strong> — Dernier contact > 30 jours';
      alertEl.style.display = '';
    }
  }
}

// ---- WHT / Dividend render ----
function renderWHTAnalysis(state) {
  const div = state.dividendAnalysis;
  if (!div) return;

  setText('kpiWhtTotalDiv', fmt(div.totalAnnualDiv) + '/an');
  setText('kpiWhtTotal', '-' + fmt(div.totalWHT) + '/an');
  document.getElementById('kpiWhtTotal')?.classList.add('pl-neg');
  setText('kpiWhtSavings', '+' + fmt(div.savingsIfEliminated) + '/an');
  const switchCount = div.positions.filter(p => p.recommendation === 'switch').length;
  setText('kpiWhtPositions', switchCount + ' position' + (switchCount > 1 ? 's' : ''));

  const tbody = document.getElementById('whtTbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  div.positions.forEach(p => {
    if (p.divYield === 0 && p.whtAmount === 0) return; // skip zero-div positions
    const tr = document.createElement('tr');
    const recBg = p.recommendation === 'switch' ? 'background:#fff5f5;' : '';
    const recBadge = p.recommendation === 'switch'
      ? '<span style="background:#fed7d7;color:#c53030;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600">SWITCHER</span>'
      : '<span style="background:#c6f6d5;padding:1px 6px;border-radius:4px;font-size:10px;color:#276749">GARDER</span>';
    tr.style.cssText = recBg;
    tr.innerHTML = '<td>' + p.label + '</td>'
      + '<td class="num">' + fmt(p.valEUR) + '</td>'
      + '<td class="num">' + (p.divYield * 100).toFixed(1) + '%</td>'
      + '<td class="num">' + fmt(p.annualDivGross) + '</td>'
      + '<td class="num">' + (p.whtRate * 100).toFixed(1) + '%</td>'
      + '<td class="num pl-neg">' + (p.whtAmount > 0 ? '-' + fmt(p.whtAmount) : '-') + '</td>'
      + '<td>' + recBadge + '</td>'
      + '<td style="font-size:11px;color:var(--gray)">' + (p.alternativeETF || '-') + '</td>';
    tbody.appendChild(tr);
  });
}

function buildDetailTable(selector, rows, totalLabel) {
  const tbody = document.querySelector(selector);
  if (!tbody) return;
  tbody.innerHTML = '';
  let total = 0;
  rows.forEach(([label, val]) => {
    total += val;
    const tr = document.createElement('tr');
    const cls = val < 0 ? 'neg' : '';
    const cond = label.includes('conditionnel') ? ' style="color:#92400e;font-style:italic"' : '';
    tr.innerHTML = '<td' + cond + '>' + label + '</td><td class="num ' + cls + '">' + fmt(val) + '</td>';
    tbody.appendChild(tr);
  });
  const totalRow = document.createElement('tr');
  totalRow.style.fontWeight = '700';
  totalRow.style.background = '#edf2f7';
  totalRow.innerHTML = '<td><strong>' + totalLabel + '</strong></td><td class="num"><strong>' + fmt(total) + '</strong></td>';
  tbody.appendChild(totalRow);
}
