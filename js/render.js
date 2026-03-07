// ============================================================
// RENDER LAYER — DOM write-only. Takes STATE, outputs to DOM.
// ============================================================
// No computation here. Only formatting and DOM manipulation.

import { CURRENCY_CONFIG } from './data.js';
import { getGrandTotal } from './engine.js';

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
  renderCategoryCards(state, view);
  renderCategoryPcts(state, view);
  renderExpandSubs(state);
  renderCoupleTable(state);
  renderAmineTable(state);
  renderNezhaTable(state);
  renderIBKRPositions(state);
  renderImmoKPIs(state);
  renderBadges(state);
  renderImmoPcts(state);
  updateAllDataEur();
}

// ---- Individual render functions ----

function renderHeader(state, view) {
  const v = state.views[view];
  const titleEl = document.getElementById('headerTitle');
  const subEl = document.getElementById('headerSub');
  if (titleEl) titleEl.textContent = v.title;
  if (subEl) subEl.textContent = v.subtitle;
}

function renderKPIs(state, view) {
  const s = state;

  // Show/hide KPI strips
  ['couple', 'amine', 'nezha'].forEach(v => {
    const el = document.getElementById('kpi-' + v);
    if (el) el.classList.toggle('hidden', v !== view);
  });

  // Show/hide data-view sections (exclude nav buttons)
  document.querySelectorAll('[data-view]:not(.view-btn)').forEach(el => {
    const views = el.dataset.view.split(' ');
    el.classList.toggle('hidden', !views.includes(view));
  });

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
    ['Creances personnelles (' + Math.round(p.amine.creances.persoMAD).toLocaleString('fr-FR') + ' MAD + ' + p.amine.creances.persoEUR.toLocaleString('fr-FR') + ' EUR)', s.amine.recvPersonal],
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
    ['Cash Maroc (' + Math.round(p.nezha.cashMaroc).toLocaleString('fr-FR') + ' MAD)', s.nezha.cashMaroc],
    ['Creance Omar (' + Math.round(p.nezha.recvOmar).toLocaleString('fr-FR') + ' MAD)', s.nezha.recvOmar],
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

function renderIBKRPositions(state) {
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
