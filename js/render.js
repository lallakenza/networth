// ============================================================
// RENDER LAYER — DOM write-only. Takes STATE, outputs to DOM.
// ============================================================
// No computation here. Only formatting and DOM manipulation.

import { CURRENCY_CONFIG } from './data.js?v=60';
import { getGrandTotal } from './engine.js?v=60';

// ---- Generic table sort utility ----
// makeTableSortable(tableEl, data, renderRowsFn)
//   tableEl: the <table> element (must have <thead> with <th> headers)
//   data: array of row objects
//   renderRowsFn(sortedData): function that repopulates the tbody
// Headers with data-sort="key" become clickable sort triggers.
// data-sort-type="string" for text sort, default is numeric.
function makeTableSortable(tableEl, data, renderRowsFn) {
  if (!tableEl) return;
  let sortKey = null, sortDir = 'desc';
  const headers = tableEl.querySelectorAll('th[data-sort]');
  headers.forEach(th => {
    th.classList.add('sortable');
    // Add arrow indicator if not present
    if (!th.querySelector('.sort-arrow')) {
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      th.appendChild(arrow);
    }
    // Clone to remove old listeners
    const newTh = th.cloneNode(true);
    th.parentNode.replaceChild(newTh, th);
    newTh.addEventListener('click', () => {
      const key = newTh.getAttribute('data-sort');
      const isStr = newTh.getAttribute('data-sort-type') === 'string';
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = isStr ? 'asc' : 'desc';
      }
      const sorted = [...data].sort((a, b) => {
        let va = a[key], vb = b[key];
        if (isStr || typeof va === 'string') {
          va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase();
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        va = va || 0; vb = vb || 0;
        return sortDir === 'asc' ? va - vb : vb - va;
      });
      renderRowsFn(sorted);
      // Update arrows
      tableEl.querySelectorAll('.sort-arrow').forEach(a => { a.className = 'sort-arrow'; });
      const active = tableEl.querySelector('th[data-sort="' + key + '"] .sort-arrow');
      if (active) active.className = 'sort-arrow ' + sortDir;
    });
  });
}

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
    renderExpandSubs(state, view);
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
  if (view === 'budget') renderBudgetView(state);

  renderBadges(state);
  updateAllDataEur();
}

// ---- Individual render functions ----

const ASSET_VIEWS = ['actions', 'cash', 'immobilier', 'creances', 'budget'];
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
    const titles = { actions: 'Cockpit Actions & Crypto', cash: 'Tr\u00e9sorerie & Cash', immobilier: 'Portefeuille Immobilier', creances: 'Cr\u00e9ances & Recouvrements', budget: 'Budget Mensuel' };
    const subs = { actions: 'Toutes les positions actions, crypto, ETFs — IBKR + ESPP + SGTM', cash: 'Vue consolid\u00e9e de tous les comptes cash — Amine & Nezha', immobilier: '3 biens immobiliers — Vitry, Rueil, Villejuif', creances: 'Cr\u00e9ances actives — analyse de recouvrement et co\u00fbt d\'opportunit\u00e9', budget: 'D\u00e9penses fixes — Dubai, France, Digital' };
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
  setEur('kpiCoupleNzNW', s.nezha.nw);
  setEur('kpiCoupleImmo', s.couple.immoEquity);

  setEur('kpiAmNW', s.amine.nw);
  setEur('kpiAmPortfolio', s.amine.ibkr + s.amine.espp);
  setEur('kpiAmVitry', s.amine.vitryEquity);
  // TWR dynamic from state (was hardcoded)
  if (s.actionsView) {
    setText('kpiAmTWR', '+' + s.actionsView.twr.toFixed(1) + '%');
  }

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

  // Attach hover insights
  attachKPIInsights(state, view);
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

function renderExpandSubs(state, view) {
  const s = state;
  // Sub expand card values
  setEur('subIBKR', s.amine.ibkr);
  setEur('subESPP', s.amine.espp);
  setEur('subSGTM', s.amine.sgtm + s.nezha.sgtm);
  setEur('subUAE', s.amine.uae + s.amine.revolutEUR);
  setEur('subMarocCash', s.amine.moroccoCash);
  setEur('subVitryEq', s.amine.vitryEquity);
  setEur('subRueilEq', s.nezha.rueilEquity);
  setEur('subVillejuifEq', s.nezha.villejuifEquity);

  // ── Dynamic créances breakdown by view ──
  const p = state.portfolio;
  const fx = state.fx;
  const toEUR = (amt, cur) => cur === 'EUR' ? amt : amt / fx[cur];

  let creanceItems = [];
  if (view === 'amine') {
    creanceItems = (p.amine.creances.items || []).map(c => ({
      label: c.label, eur: toEUR(c.amount, c.currency), guaranteed: c.guaranteed
    }));
  } else if (view === 'nezha') {
    creanceItems = (p.nezha.creances && p.nezha.creances.items || []).map(c => ({
      label: c.label, eur: toEUR(c.amount, c.currency), guaranteed: c.guaranteed
    }));
  } else {
    // couple: show all
    (p.amine.creances.items || []).forEach(c => {
      creanceItems.push({ label: c.label, eur: toEUR(c.amount, c.currency), guaranteed: c.guaranteed, owner: 'Amine' });
    });
    (p.nezha.creances && p.nezha.creances.items || []).forEach(c => {
      creanceItems.push({ label: c.label, eur: toEUR(c.amount, c.currency), guaranteed: c.guaranteed, owner: 'Nezha' });
    });
  }

  const totalCreances = creanceItems.reduce((sum, c) => sum + c.eur, 0);
  setEur('subCreances', totalCreances);

  // Build breakdown HTML
  const bdEl = document.getElementById('subCreancesBreakdown');
  if (bdEl) {
    const guaranteed = creanceItems.filter(c => c.guaranteed);
    const personal = creanceItems.filter(c => !c.guaranteed);
    let html = '<ul class="breakdown-list">';
    if (guaranteed.length) {
      const gTotal = guaranteed.reduce((s, c) => s + c.eur, 0);
      html += '<li style="font-weight:600"><span class="bl-label">Cr\u00e9ances pro</span><span class="bl-val">' + fmt(gTotal) + '</span></li>';
      guaranteed.forEach(c => {
        const ownerTag = view === 'couple' && c.owner ? ' <span style="color:var(--gray);font-size:10px">(' + c.owner + ')</span>' : '';
        html += '<li><span class="bl-label">&nbsp;&nbsp;' + c.label + ownerTag + '</span><span class="bl-val">' + fmt(c.eur) + '</span></li>';
      });
    }
    if (personal.length) {
      const pTotal = personal.reduce((s, c) => s + c.eur, 0);
      html += '<li style="padding-top:4px;border-top:1px solid #cbd5e0;font-weight:600"><span class="bl-label">Cr\u00e9ances personnelles</span><span class="bl-val">' + fmt(pTotal) + '</span></li>';
      personal.forEach(c => {
        const ownerTag = view === 'couple' && c.owner ? ' <span style="color:var(--gray);font-size:10px">(' + c.owner + ')</span>' : '';
        html += '<li><span class="bl-label">&nbsp;&nbsp;' + c.label + ownerTag + '</span><span class="bl-val">' + fmt(c.eur) + '</span></li>';
      });
    }
    if (!creanceItems.length) {
      html += '<li><span class="bl-label" style="color:var(--gray)">Aucune cr\u00e9ance</span></li>';
    }
    html += '</ul>';
    bdEl.innerHTML = html;
  }

  // ESPP detail label
  const srcLabel = state.stockSource === 'live' ? ' (live)' : ' (statique)';
  setHTML('subESPPDetail', p.amine.espp.shares + ' actions ACN @ $' + p.market.acnPriceUSD.toFixed(0) + srcLabel + '<br>+ cash ~' + p.amine.espp.cashEUR.toLocaleString('fr-FR') + ' EUR');
  setHTML('subSGTMDetail', (p.amine.sgtm.shares + p.nezha.sgtm.shares) + ' actions @ ' + p.market.sgtmPriceMAD + ' DH (Amine + Nezha)<br>Bourse de Casablanca');

  // SGTM performance badge (vs IPO cost basis)
  const sgtmPerf = p.market.sgtmCostBasisMAD
    ? ((p.market.sgtmPriceMAD - p.market.sgtmCostBasisMAD) / p.market.sgtmCostBasisMAD * 100)
    : null;
  const sgtmBadgeEl = document.getElementById('subSGTMBadge');
  if (sgtmBadgeEl && sgtmPerf !== null) {
    const sign = sgtmPerf >= 0 ? '+' : '';
    sgtmBadgeEl.textContent = 'IPO ' + sign + sgtmPerf.toFixed(1) + '%';
    sgtmBadgeEl.style.background = sgtmPerf >= 0 ? '#c6f6d5' : '#fed7d7';
    sgtmBadgeEl.style.color = sgtmPerf >= 0 ? '#276749' : '#c53030';
  }

  // Maroc FX note
  setText('subMarocFXNote', 'Total MAD ' + s.amine.moroccoMAD.toLocaleString('fr-FR') + ' / ' + s.fx.MAD.toFixed(4));

  // ── Dynamic immo sub-cards (CRD + CF badges) ──
  const iv = state.immoView;
  if (iv && iv.properties) {
    const propMap = {};
    iv.properties.forEach(p => { propMap[p.loanKey] = p; });

    // Sub-card CRD details
    const vitryP = propMap.vitry;
    if (vitryP) {
      setHTML('subVitryCrdDetail', fmt(vitryP.value) + ' (2%/an)<br>CRD ' + fmt(vitryP.crd));
      const vBadge = document.getElementById('subVitryCFBadge');
      if (vBadge) {
        const sign = vitryP.cf >= 0 ? '+' : '';
        vBadge.textContent = 'CF ' + sign + fmt(vitryP.cf) + '/mois';
        vBadge.style.background = vitryP.cf >= 0 ? '#c6f6d5' : '#fed7d7';
        vBadge.style.color = vitryP.cf >= 0 ? '#276749' : '#c53030';
      }
    }
    const rueilP = propMap.rueil;
    if (rueilP) {
      setHTML('subRueilCrdDetail', fmt(rueilP.value) + '<br>CRD ' + fmt(rueilP.crd));
      const rBadge = document.getElementById('subRueilCFBadge');
      if (rBadge) {
        const sign = rueilP.cf >= 0 ? '+' : '';
        rBadge.textContent = 'CF ' + sign + fmt(rueilP.cf) + '/mois';
        rBadge.style.background = rueilP.cf >= 0 ? '#c6f6d5' : '#fed7d7';
        rBadge.style.color = rueilP.cf >= 0 ? '#276749' : '#c53030';
      }
    }
    const villejuifP = propMap.villejuif;
    if (villejuifP) {
      setHTML('subVillejuifCrdDetail', fmt(villejuifP.value) + '<br>CRD ' + fmt(villejuifP.crd) + '<br><span style="font-size:11px;color:#92400e">Acte notarie non signe \u2014 reservation 3K payee</span>');
    }

    // ── Dynamic Résumé Immobilier table ──
    const immoTbody = document.getElementById('immoSummaryTbody');
    if (immoTbody) {
      let html = '';
      const propMeta = {
        vitry: { desc: '67 m2 \u2014 loyer 1,050 HC + 150 charges + 70 parking', owner: 'Amine', status: 'Loue', statusBg: '#c6f6d5', statusColor: '#276749' },
        rueil: { desc: '56 m2 \u2014 loyer 1,300 HC + 150 charges (bail oct 2025)', owner: 'Nezha', status: 'Loue', statusBg: '#c6f6d5', statusColor: '#276749', rowBg: 'background:#f0f5ff' },
        villejuif: { desc: 'Conditionnel \u2014 acte non signe', owner: 'Nezha', status: 'Conditionnel', statusBg: '#fef3c7', statusColor: '#92400e', descColor: '#92400e' },
      };
      iv.properties.forEach(prop => {
        const meta = propMeta[prop.loanKey] || {};
        const rowStyle = meta.rowBg ? ' style="' + meta.rowBg + '"' : '';
        const descStyle = meta.descColor ? 'color:' + meta.descColor : 'color:var(--gray)';
        const cfClass = prop.conditional ? '' : (prop.cf >= 0 ? 'pos' : 'neg');
        const cfText = prop.conditional ? '--' : ((prop.cf >= 0 ? '+' : '') + Math.round(prop.cf));
        const cfStyle = prop.conditional ? 'color:var(--gray)' : '';
        html += '<tr' + rowStyle + '>'
          + '<td><strong>' + prop.name + '</strong><br><span style="font-size:12px;' + descStyle + '">' + (meta.desc || '') + '</span></td>'
          + '<td>' + (meta.owner || prop.owner) + '</td>'
          + '<td class="num" data-eur="' + Math.round(prop.value) + '">--</td>'
          + '<td class="num" data-eur="' + Math.round(prop.crd) + '">--</td>'
          + '<td class="num pos" data-eur="' + Math.round(prop.equity) + '">--</td>'
          + '<td class="num ' + cfClass + '"' + (cfStyle ? ' style="' + cfStyle + '"' : '') + '>' + cfText + '</td>'
          + '<td><span style="background:' + (meta.statusBg || '#e2e8f0') + ';padding:2px 8px;border-radius:10px;font-size:12px;color:' + (meta.statusColor || '#2d3748') + '">' + (meta.status || '') + '</span></td>'
          + '</tr>';
      });
      immoTbody.innerHTML = html;
    }

    // ── Dynamic insight texts ──
    if (vitryP) {
      setText('insightVitryCF', (vitryP.cf >= 0 ? '+' : '') + Math.round(vitryP.cf));
      setText('insightVitryCharges', Math.round(vitryP.charges).toLocaleString('fr-FR'));
    }
    if (rueilP) {
      const rueilCFText = '+' + Math.round(rueilP.cf);
      setText('insightRueilCF', rueilCFText);
      setText('insightRueilCF2', rueilCFText);
    }
  }
}

function renderCoupleTable(state) {
  const s = state;
  const p = state.portfolio;
  const rows = [
    ['Actions & ETFs (IBKR + ' + p.amine.espp.shares + ' ACN + ' + (p.amine.sgtm.shares * 2) + ' SGTM)', s.amine.ibkr + s.amine.espp + s.amine.sgtm + s.nezha.sgtm],
    ['Cash EUR (Nezha France + Revolut Amine)', s.nezha.cashFrance + s.amine.revolutEUR],
    ['Cash MAD (Nezha ' + Math.round(s.nezha.cashMarocMAD).toLocaleString('fr-FR') + ' + Amine ' + Math.round(s.amine.moroccoMAD).toLocaleString('fr-FR') + ' MAD)', s.nezha.cashMaroc + s.amine.moroccoCash],
    ['Cash AED (Amine UAE + Nezha Wio ' + Math.round(s.nezha.cashUAE_AED).toLocaleString('fr-FR') + ' AED)', s.amine.uae + s.nezha.cashUAE],
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
    ['Cash UAE (' + Math.round(s.amine.uaeAED).toLocaleString('fr-FR') + ' AED)', s.amine.uae],
    ['Revolut EUR', s.amine.revolutEUR],
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
    ['Revolut EUR', s.nezha.revolutEUR],
    ['Crédit Mutuel (CC)', s.nezha.creditMutuel],
    ['Livret A — LCL (1.5%)', s.nezha.livretA],
    ['LCL Compte de dépôts', s.nezha.lclDepots],
    ['Attijariwafa Maroc (' + Math.round(s.nezha.cashMarocMAD).toLocaleString('fr-FR') + ' MAD)', s.nezha.cashMaroc],
    ['Wio UAE (' + Math.round(s.nezha.cashUAE_AED).toLocaleString('fr-FR') + ' AED)', s.nezha.cashUAE],
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
  const ibkrTable = document.getElementById('ibkrSimpleTable');
  if (!tbody) return;
  const positions = state.ibkrPositions;
  const cashEUR = state.portfolio.amine.ibkr.cashEUR;

  // Build data including cash as a virtual row
  const ibkrData = positions.slice(0, 6).map(pos => ({
    label: pos.label,
    priceLabel: pos.priceLabel,
    shares: pos.shares,
    valEUR: pos.valEUR,
  }));
  if (cashEUR > 0) {
    ibkrData.push({ label: 'Cash IBKR', priceLabel: '', shares: 0, valEUR: cashEUR, isCash: true });
  }

  function renderIBKRRows(items) {
    tbody.innerHTML = '';
    items.forEach(pos => {
      const tr = document.createElement('tr');
      if (pos.isCash) {
        tr.innerHTML = '<td style="color:var(--gray)">' + pos.label + '</td><td class="num">\u2014</td><td class="num">' + fmt(pos.valEUR) + '</td>';
      } else {
        tr.innerHTML = '<td>' + pos.label + ' <span style="color:var(--gray);font-size:11px">@ ' + pos.priceLabel + '</span></td>'
          + '<td class="num">' + pos.shares + '</td>'
          + '<td class="num">' + fmt(pos.valEUR) + '</td>';
      }
      tbody.appendChild(tr);
    });
    const totalRow = document.createElement('tr');
    totalRow.style.fontWeight = '700'; totalRow.style.background = '#edf2f7';
    totalRow.innerHTML = '<td><strong>NAV Total</strong></td><td></td><td class="num"><strong>' + fmt(state.amine.ibkr) + '</strong></td>';
    tbody.appendChild(totalRow);
  }

  renderIBKRRows(ibkrData);
  makeTableSortable(ibkrTable, ibkrData, renderIBKRRows);
}

function renderImmoKPIs(state) {
  setEur('kpiImmoEq', state.couple.immoEquity);
  setEur('kpiImmoVal', state.couple.immoValue);
  setEur('kpiImmoCRD', state.couple.immoCRD);
  // Dynamic label with nb biens
  const nb = state.couple.nbBiens || 3;
  setText('kpiCoupleImmoLabel', 'Equity Immo (' + nb + ' biens) *');
  setText('kpiImmoEqLabel', 'Equity Totale (' + nb + ' biens)');
  // Wealth creation from immoView
  if (state.immoView) {
    const wc = state.immoView.totalWealthCreation;
    setText('immoWealthVal', '+' + fmt(wc) + '/mois');
  }
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

// ---- SORTABLE UNIFIED POSITIONS TABLE ----

let _allSortKey = null;
let _allSortDir = 'desc';

const SECTOR_LABELS = { industrials: 'Industriel', consumer: 'Conso', luxury: 'Luxe', tech: 'Tech', healthcare: 'Santé', automotive: 'Auto', crypto: 'Crypto', finance: 'Finance', materials: 'Matériaux' };
const GEO_LABELS = { france: 'France', germany: 'Allemagne', us: 'US', japan: 'Japon', crypto: 'Crypto', morocco: 'Maroc' };

function renderAllPositions(allPositions, sortKey, sortDir) {
  const sorted = [...allPositions];
  if (sortKey) {
    sorted.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') {
        va = (va || '').toLowerCase();
        vb = (vb || '').toLowerCase();
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      va = va || 0; vb = vb || 0;
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }
  const tbody = document.getElementById('allPositionsTbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  let totalVal = 0, totalCost = 0;
  sorted.forEach(pos => {
    totalVal += pos.valEUR;
    totalCost += (pos.costEUR || 0);
    const hasPL = pos.costEUR != null && pos.costEUR > 0;
    const pl = hasPL ? pos.unrealizedPL : null;
    const plC = pl !== null ? (pl >= 0 ? 'pl-pos' : 'pl-neg') : '';
    const plS = pl !== null ? (pl >= 0 ? '+' : '') : '';
    const pctPL = hasPL ? pos.pctPL : null;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + pos.label + '</td>'
      + '<td>' + (pos.broker || '') + '</td>'
      + '<td class="num">' + pos.shares + '</td>'
      + '<td class="num">' + (pos.priceLabel || '—') + '</td>'
      + '<td class="num">' + (hasPL ? fmt(pos.costEUR) : '—') + '</td>'
      + '<td class="num">' + fmt(pos.valEUR) + '</td>'
      + '<td class="num ' + plC + '">' + (pl !== null ? plS + fmt(pl) : '—') + '</td>'
      + '<td class="num ' + plC + '">' + (pctPL !== null ? plS + pctPL.toFixed(1) + '%' : '—') + '</td>'
      + '<td class="num">' + pos.weight.toFixed(1) + '%</td>'
      + '<td>' + (SECTOR_LABELS[pos.sector] || pos.sector || '—') + '</td>'
      + '<td>' + (GEO_LABELS[pos.geo] || pos.geo || '—') + '</td>';
    tbody.appendChild(tr);
  });
  const totalPL = totalVal - totalCost;
  const totalPctPL = totalCost > 0 ? (totalPL / totalCost * 100) : 0;
  const tPlC = totalPL >= 0 ? 'pl-pos' : 'pl-neg';
  const tPlS = totalPL >= 0 ? '+' : '';
  const tr = document.createElement('tr');
  tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
  tr.innerHTML = '<td><strong>Total (' + sorted.length + ' positions)</strong></td><td></td><td></td><td></td>'
    + '<td class="num"><strong>' + fmt(totalCost) + '</strong></td>'
    + '<td class="num"><strong>' + fmt(totalVal) + '</strong></td>'
    + '<td class="num ' + tPlC + '"><strong>' + tPlS + fmt(totalPL) + '</strong></td>'
    + '<td class="num ' + tPlC + '"><strong>' + tPlS + totalPctPL.toFixed(1) + '%</strong></td>'
    + '<td class="num">100%</td><td></td><td></td>';
  tbody.appendChild(tr);

  // Update arrow indicators
  const table = document.getElementById('allPositionsTable');
  if (table) {
    table.querySelectorAll('.sort-arrow').forEach(a => { a.className = 'sort-arrow'; });
    if (sortKey) {
      const active = table.querySelector('th[data-sort="' + sortKey + '"] .sort-arrow');
      if (active) active.className = 'sort-arrow ' + sortDir;
    }
  }
}

function setupAllPositionsSort(allPositions) {
  const table = document.getElementById('allPositionsTable');
  if (!table) return;
  const thead = table.querySelector('thead');
  const newThead = thead.cloneNode(true);
  thead.parentNode.replaceChild(newThead, thead);
  newThead.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (_allSortKey === key) {
        _allSortDir = _allSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        _allSortKey = key;
        _allSortDir = (key === 'label' || key === 'broker' || key === 'sector' || key === 'geo') ? 'asc' : 'desc';
      }
      renderAllPositions(allPositions, _allSortKey, _allSortDir);
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
  setText('kpiActionsDividends', fmt(av.dividends));
  setText('kpiActionsTWR', 'TWR +' + av.twr.toFixed(1) + '%');

  // Build unified positions array (IBKR + ESPP + SGTM)
  const totalAllVal = av.totalStocks;
  const allPositions = av.ibkrPositions.map(p => ({
    ...p,
    broker: 'IBKR',
    weight: totalAllVal > 0 ? (p.valEUR / totalAllVal * 100) : 0,
  }));

  // ESPP Accenture
  const esppPL = av.esppUnrealizedPL;
  allPositions.push({
    label: 'Accenture (ACN)',
    broker: 'UBS (ESPP)',
    ticker: 'ACN',
    shares: av.esppShares,
    price: av.esppPrice,
    priceLabel: '$' + av.esppPrice.toFixed(2),
    costEUR: av.esppCostBasisEUR,
    valEUR: av.esppCurrentVal,
    unrealizedPL: esppPL,
    pctPL: av.esppCostBasisEUR > 0 ? (esppPL / av.esppCostBasisEUR * 100) : 0,
    weight: totalAllVal > 0 ? (av.esppCurrentVal / totalAllVal * 100) : 0,
    sector: 'tech',
    geo: 'us',
  });

  // ESPP Cash
  if (av.esppCashEUR > 0) {
    allPositions.push({
      label: 'ESPP Cash résiduel',
      broker: 'UBS (ESPP)',
      ticker: '',
      shares: '',
      price: null,
      priceLabel: '—',
      costEUR: av.esppCashEUR,
      valEUR: av.esppCashEUR,
      unrealizedPL: 0,
      pctPL: 0,
      weight: totalAllVal > 0 ? (av.esppCashEUR / totalAllVal * 100) : 0,
      sector: 'cash',
      geo: 'us',
    });
  }

  // SGTM Amine + Nezha
  const sgtmShares = av.sgtmAmineShares + av.sgtmNezhaShares;
  const sgtmTotalVal = av.sgtmAmineVal + av.sgtmNezhaVal;
  const sgtmCostBasis = av.sgtmCostBasisEUR || null;
  const sgtmPL = sgtmCostBasis ? sgtmTotalVal - sgtmCostBasis : null;
  allPositions.push({
    label: 'SGTM (' + sgtmShares + ' actions)',
    broker: 'Attijari',
    ticker: 'SGTM',
    shares: sgtmShares,
    price: av.sgtmPriceMAD,
    priceLabel: av.sgtmPriceMAD + ' DH',
    costEUR: sgtmCostBasis,
    valEUR: sgtmTotalVal,
    unrealizedPL: sgtmPL,
    pctPL: sgtmCostBasis > 0 ? (sgtmPL / sgtmCostBasis * 100) : null,
    weight: totalAllVal > 0 ? (sgtmTotalVal / totalAllVal * 100) : 0,
    sector: 'materials',
    geo: 'morocco',
  });

  // Render unified table
  renderAllPositions(allPositions, null, null);
  setupAllPositionsSort(allPositions);

  // Closed positions
  const closedTbody = document.getElementById('actionsClosedTbody');
  const closedTable = document.getElementById('actionsClosedTable');
  if (closedTbody) {
    const closedData = av.closedPositions.map(cp => ({ ...cp, label: cp.label + ' (' + cp.ticker + ')' }));
    function renderClosedRows(items) {
      closedTbody.innerHTML = '';
      let totalClosed = 0;
      items.forEach(cp => {
        totalClosed += cp.pl;
        const cls = cp.pl >= 0 ? 'pl-pos' : 'pl-neg';
        const s = cp.pl >= 0 ? '+' : '';
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + cp.label + '</td><td class="num ' + cls + '">' + s + fmt(cp.pl) + '</td>';
        closedTbody.appendChild(tr);
      });
      const tr = document.createElement('tr');
      tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
      const cls = totalClosed >= 0 ? 'pl-pos' : 'pl-neg';
      const ts = totalClosed >= 0 ? '+' : '';
      tr.innerHTML = '<td><strong>Total</strong></td><td class="num ' + cls + '"><strong>' + ts + fmt(totalClosed) + '</strong></td>';
      closedTbody.appendChild(tr);
    }
    renderClosedRows(closedData);
    makeTableSortable(closedTable, closedData, renderClosedRows);
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
  const degiroTable = document.getElementById('degiroClosedTable');
  if (degiroTbody) {
    function renderDegiroRows(items) {
      degiroTbody.innerHTML = '';
      let totalCost = 0, totalProceeds = 0, totalDegiro = 0;
      items.forEach(cp => {
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
      const ds = totalDegiro >= 0 ? '+' : '';
      tr.innerHTML = '<td><strong>Total Degiro</strong></td><td class="num"><strong>' + fmt(totalCost) + '</strong></td><td class="num"><strong>' + fmt(totalProceeds) + '</strong></td><td class="num ' + cls + '"><strong>' + ds + fmt(totalDegiro) + '</strong></td>';
      degiroTbody.appendChild(tr);
    }
    renderDegiroRows(av.degiroClosedPositions);
    makeTableSortable(degiroTable, av.degiroClosedPositions, renderDegiroRows);
  }

  // Combined realized P/L
  const cSign = av.combinedRealizedPL >= 0 ? '+' : '';
  setText('actionsCombinedPL', cSign + fmt(av.combinedRealizedPL));
  const combinedEl = document.getElementById('actionsCombinedPL');
  if (combinedEl) combinedEl.classList.add(av.combinedRealizedPL >= 0 ? 'pl-pos' : 'pl-neg');

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
        html += '- <strong>Ajouter de l\'or</strong> : 0% d\'exposition, or +21% YTD. Un hedge g\u00e9opolitique (5-10% via GLD/SGOL) am\u00e9liorerait le profil risque<br>';
        html += '- <strong>Pas de tech US directe</strong> : manque d\'exposition aux GAFAM/Magnificent 7 (seulement via ESPP Accenture)<br>';
        html += '</div></div>';
      }

      else if (ins.type === 'benchmark') {
        const b = ins.benchmarks;
        const twr = b.portfolio.twr;
        html += '<div style="font-size:12px;color:#718096;margin-bottom:8px;">Donn\u00e9es au ' + b.date + '</div>';
        // Portfolio bar first
        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:2px solid var(--accent);">';
        html += '<span style="flex:1;font-size:13px;font-weight:700;">' + b.portfolio.label + '</span>';
        html += '<span style="font-size:16px;font-weight:700;color:' + (twr >= 0 ? 'var(--green)' : '#e53e3e') + ';">' + (twr >= 0 ? '+' : '') + twr.toFixed(1) + '%</span></div>';
        // Benchmark bars
        b.items.forEach(function(item) {
          var barColor = item.ytd >= 0 ? '#22c55e' : '#ef4444';
          var barWidth = Math.min(Math.abs(item.ytd) * 2.5, 100);
          var beat = twr > item.ytd;
          html += '<div style="padding:5px 0;border-bottom:1px solid #edf2f7;">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">';
          html += '<span>' + item.label + (beat ? ' \u2714' : '') + '</span>';
          html += '<span style="font-weight:600;color:' + barColor + ';">' + (item.ytd >= 0 ? '+' : '') + item.ytd.toFixed(1) + '%</span></div>';
          html += '<div style="background:#edf2f7;border-radius:3px;height:6px;margin-top:3px;">';
          html += '<div style="width:' + barWidth + '%;height:100%;background:' + barColor + ';border-radius:3px;"></div></div>';
          html += '<div style="font-size:10px;color:#a0aec0;margin-top:2px;">' + item.note + '</div>';
          html += '</div>';
        });
        // Summary
        var beaten = b.items.filter(function(i) { return twr > i.ytd; }).length;
        html += '<div style="margin-top:10px;padding:8px;background:' + (beaten >= 4 ? '#f0fff4' : '#fffff0') + ';border-radius:6px;font-size:12px;">';
        html += (beaten >= 4 ? '\uD83C\uDFC6' : '\uD83D\uDCCA') + ' Portefeuille bat <strong>' + beaten + '/' + b.items.length + '</strong> benchmarks. ';
        if (twr < b.items[1].ytd) html += 'Sous-performe le S&P 500 \u2014 consid\u00e9rer plus d\'exposition US via ETF (VOO/CSPX).';
        else html += 'Surperforme le S&P 500 \u2014 stock picking cr\u00e9ateur de valeur cette ann\u00e9e.';
        html += '</div>';
      }

      else if (ins.type === 'macro-risks') {
        ins.risks.forEach(function(risk) {
          var sColor = risk.severity === 'high' ? '#e53e3e' : risk.severity === 'medium' ? '#dd6b20' : '#718096';
          var sIcon = risk.severity === 'high' ? '\uD83D\uDD34' : risk.severity === 'medium' ? '\uD83D\uDFE0' : '\u26AA';
          html += '<div style="padding:8px 0;border-bottom:1px solid #edf2f7;">';
          html += '<div style="font-size:13px;font-weight:600;color:' + sColor + ';">' + sIcon + ' ' + risk.label + '</div>';
          html += '<div style="font-size:12px;color:#4a5568;margin-top:3px;">' + risk.detail + '</div>';
          html += '</div>';
        });
      }

      else if (ins.type === 'dividend-wht') {
        html += '<div style="font-size:13px;margin-bottom:10px;">WHT total \u00e0 risque : <strong class="pl-neg">\u20ac' + Math.round(ins.totalWHTAtRisk).toLocaleString('fr-FR') + '</strong></div>';
        html += '<div style="font-size:11px;color:#718096;margin-bottom:8px;">\uD83D\uDCA1 En tant que r\u00e9sident fiscal UAE, vendre AVANT l\'ex-date \u00e9vite la WHT (0% sur plus-values)</div>';
        ins.upcoming.forEach(function(d) {
          var urgColor = d.daysUntil <= 30 ? '#e53e3e' : d.daysUntil <= 60 ? '#dd6b20' : '#718096';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #edf2f7;font-size:12px;">';
          html += '<div><strong>' + d.label + '</strong><br><span style="color:' + urgColor + ';">Ex-date : ' + d.exDate + ' (J-' + d.daysUntil + ')</span></div>';
          html += '<div style="text-align:right;"><span class="pl-neg">WHT \u20ac' + Math.round(d.whtCost) + '</span><br><span style="color:#a0aec0;">' + (d.whtRate * 100).toFixed(0) + '% sur \u20ac' + Math.round(d.grossDivEUR) + '</span></div>';
          html += '</div>';
        });
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
  const cashTable = document.getElementById('cashTable');
  if (tbody) {
    const REF_YIELD = 0.06; // 6% benchmark

    // Build enriched flat data for sorting
    const cashData = cv.accounts.map(a => {
      const isDebt = a.isDebt;
      let yieldAnnVal, missed;
      if (isDebt) {
        const costAnn = Math.abs(a.valEUR) * Math.abs(a.yield || 0);
        yieldAnnVal = -costAnn;
        missed = costAnn;
      } else {
        yieldAnnVal = a.valEUR * (a.yield || 0);
        missed = a.valEUR > 0 ? Math.max(0, a.valEUR * (REF_YIELD - (a.yield || 0))) : 0;
      }
      return { ...a, yieldAnn: yieldAnnVal, missed };
    });

    function renderCashRowsGrouped(items) {
      tbody.innerHTML = '';
      const owners = ['Amine', 'Nezha'];
      let grandTotalYieldAnn = 0, grandTotalMissed = 0;
      owners.forEach(owner => {
        const ownerAccounts = items.filter(a => a.owner === owner);
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
        let ownerYieldAnn = 0, ownerMissed = 0;
        ownerAccounts.forEach(a => {
          const isDebt = a.isDebt;
          const isNeg = a.valEUR < 0;
          const cls = isNeg ? ' class="pl-neg"' : '';
          const nativeStr = Math.round(a.native).toLocaleString('fr-FR');
          let yieldStr, yieldAnnStr;
          if (isDebt) {
            const costRate = Math.abs(a.yield || 0);
            const costAnn = Math.abs(a.valEUR) * costRate;
            yieldStr = '<span class="pl-neg">-' + (costRate * 100).toFixed(1) + '%</span>';
            yieldAnnStr = '<span class="pl-neg">-' + fmt(costAnn) + '</span>';
            ownerYieldAnn -= costAnn;
          } else {
            yieldStr = a.yield > 0 ? (a.yield * 100).toFixed(1) + '%' : '0%';
            yieldAnnStr = a.yield > 0 ? fmt(a.valEUR * a.yield) : '-';
            ownerYieldAnn += a.valEUR * (a.yield || 0);
          }
          const missedStr = a.missed > 10 ? '<span class="pl-neg">-' + fmt(a.missed) + '</span>' : (isDebt ? '<span class="pl-neg">-' + fmt(a.missed) + '</span>' : '-');
          ownerMissed += a.missed;
          const tr = document.createElement('tr');
          tr.style.borderLeft = '3px solid ' + borderColor;
          if (isNeg) tr.style.background = '#fff5f5';
          tr.innerHTML = '<td style="padding-left:20px;">' + a.label + (isDebt ? ' <span style="font-size:10px;color:#e53e3e;">(emprunt)</span>' : '') + '</td>'
            + '<td>' + a.owner + '</td>'
            + '<td>' + a.currency + '</td>'
            + '<td class="num"' + cls + '>' + nativeStr + '</td>'
            + '<td class="num"' + cls + '>' + fmt(a.valEUR) + '</td>'
            + '<td class="num">' + yieldStr + '</td>'
            + '<td class="num">' + yieldAnnStr + '</td>'
            + '<td class="num">' + missedStr + '</td>';
          tbody.appendChild(tr);
        });
        grandTotalYieldAnn += ownerYieldAnn;
        grandTotalMissed += ownerMissed;
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

    function renderCashRowsFlat(items) {
      tbody.innerHTML = '';
      let grandTotalYieldAnn = 0, grandTotalMissed = 0;
      items.forEach(a => {
        const isDebt = a.isDebt;
        const isNeg = a.valEUR < 0;
        const cls = isNeg ? ' class="pl-neg"' : '';
        const nativeStr = Math.round(a.native).toLocaleString('fr-FR');
        const ownerColor = a.owner === 'Amine' ? 'var(--accent)' : 'var(--gold)';
        let yieldStr, yieldAnnStr;
        if (isDebt) {
          const costRate = Math.abs(a.yield || 0);
          yieldStr = '<span class="pl-neg">-' + (costRate * 100).toFixed(1) + '%</span>';
          yieldAnnStr = '<span class="pl-neg">-' + fmt(Math.abs(a.yieldAnn)) + '</span>';
        } else {
          yieldStr = a.yield > 0 ? (a.yield * 100).toFixed(1) + '%' : '0%';
          yieldAnnStr = a.yield > 0 ? fmt(a.yieldAnn) : '-';
        }
        const missedStr = a.missed > 10 ? '<span class="pl-neg">-' + fmt(a.missed) + '</span>' : (isDebt ? '<span class="pl-neg">-' + fmt(a.missed) + '</span>' : '-');
        grandTotalYieldAnn += a.yieldAnn;
        grandTotalMissed += a.missed;
        const tr = document.createElement('tr');
        tr.style.borderLeft = '3px solid ' + ownerColor;
        if (isNeg) tr.style.background = '#fff5f5';
        tr.innerHTML = '<td style="padding-left:20px;">' + a.label + (isDebt ? ' <span style="font-size:10px;color:#e53e3e;">(emprunt)</span>' : '') + '</td>'
          + '<td>' + a.owner + '</td>'
          + '<td>' + a.currency + '</td>'
          + '<td class="num"' + cls + '>' + nativeStr + '</td>'
          + '<td class="num"' + cls + '>' + fmt(a.valEUR) + '</td>'
          + '<td class="num">' + yieldStr + '</td>'
          + '<td class="num">' + yieldAnnStr + '</td>'
          + '<td class="num">' + missedStr + '</td>';
        tbody.appendChild(tr);
      });
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

    renderCashRowsGrouped(cashData);
    makeTableSortable(cashTable, cashData, renderCashRowsFlat);
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

  // Property cards with fiscal data — clickable for detail panel
  const grid = document.getElementById('propGrid');
  if (grid) {
    grid.innerHTML = '';
    iv.properties.forEach((prop, idx) => {
      const card = document.createElement('div');
      card.className = 'prop-card' + (prop.conditional ? ' conditional' : '');
      card.dataset.loanKey = prop.loanKey;
      const cfClass = prop.cf >= 0 ? 'pl-pos' : 'pl-neg';
      const cfSign = prop.cf >= 0 ? '+' : '';
      const f = prop.fiscalite;
      const fiscLine = f ? '<div class="prop-kpi"><div class="pk-val pl-neg">' + f.monthlyImpot + '</div><div class="pk-label">Impot /mois</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + (prop.yieldNetFiscal || 0).toFixed(1) + '%</div><div class="pk-label">Yield net fiscal</div></div>'
        : '';
      const regimeDisplay = f ? (f.regime === 'lmnp-amort' ? 'LMNP réel (amort.)' : f.type === 'lmnp' ? 'LMNP ' + f.regime : 'NU ' + f.regime) : '';
      const regimeBadge = f ? '<span style="background:#ebf8ff;padding:1px 6px;border-radius:4px;font-size:10px;color:#2b6cb0;margin-left:4px">' + regimeDisplay + '</span>' : '';
      card.innerHTML = '<h3>' + prop.name + regimeBadge + (prop.conditional ? ' <span style="background:#fef3c7;padding:1px 5px;border-radius:4px;font-size:10px;color:#92400e;">CONDITIONNEL</span>' : '') + '</h3>'
        + '<div class="prop-owner">' + prop.owner + ' <span style="font-size:10px;color:var(--accent);margin-left:4px;">&#x25BC; cliquer pour details</span></div>'
        + '<div class="prop-kpis">'
        + '<div class="prop-kpi"><div class="pk-val pl-pos">' + fmt(prop.equity) + '</div><div class="pk-label">Equity</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + fmt(prop.value) + '</div><div class="pk-label">Valeur</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + fmt(prop.crd) + '</div><div class="pk-label">CRD</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + prop.ltv.toFixed(0) + '%</div><div class="pk-label">LTV</div></div>'
        + '<div class="prop-kpi"><div class="pk-val ' + cfClass + '">' + cfSign + prop.cf + '</div><div class="pk-label">CF /mois</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + prop.loyer + '</div><div class="pk-label">Loyer HC</div></div>'
        + fiscLine
        + '</div>';
      card.addEventListener('click', () => {
        // Toggle detail panel
        const panel = document.getElementById('propDetailPanel');
        const allCards = grid.querySelectorAll('.prop-card');
        if (panel.style.display !== 'none' && panel.dataset.activeKey === prop.loanKey) {
          panel.style.display = 'none';
          allCards.forEach(c => c.classList.remove('active-prop'));
          return;
        }
        allCards.forEach(c => c.classList.remove('active-prop'));
        card.classList.add('active-prop');
        panel.dataset.activeKey = prop.loanKey;
        renderPropertyDetail(state, prop);
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      grid.appendChild(card);
    });
    // Close button
    document.getElementById('propDetailClose')?.addEventListener('click', () => {
      document.getElementById('propDetailPanel').style.display = 'none';
      grid.querySelectorAll('.prop-card').forEach(c => c.classList.remove('active-prop'));
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
        + '<td class="num">' + fmt(prop.monthlyPret) + '/mois</td>'
        + '<td class="num">' + fmt(prop.monthlyAssurance) + '</td>'
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
      const first = amort.schedule[0];
      const current = amort.schedule[amort.currentIdx] || amort.schedule[amort.schedule.length - 1];

      // Multi-loan: use summary fields; single-loan: derive from schedule
      let capitalEmprunte, rate, mensualite;
      if (amort.isMultiLoan) {
        capitalEmprunte = amort.combinedPrincipal;
        rate = (amort.weightedRate * 100).toFixed(2);
        mensualite = fmt(Math.round(amort.currentMonthlyPayment));
      } else {
        capitalEmprunte = Math.round(first.remainingCRD + first.principal);
        rate = first.interest > 0 ? (first.interest / (first.remainingCRD + first.principal) * 12 * 100).toFixed(2) : '0.00';
        mensualite = first.payment.toLocaleString('fr-FR');
      }

      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (loanNames[key] || key) + (amort.isMultiLoan ? ' <small>(' + amort.nbLoans + ' prêts)</small>' : '') + '</td>'
        + '<td class="num">' + fmt(capitalEmprunte) + '</td>'
        + '<td class="num">' + rate + '%</td>'
        + '<td class="num">' + Math.ceil(amort.schedule.length / 12) + ' ans</td>'
        + '<td class="num">' + mensualite + '/mois</td>'
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
      const regimeLabel = f.regime === 'lmnp-amort' ? 'LMNP réel (amort.)' : f.type === 'lmnp' ? 'LMNP ' + f.regime : 'NU ' + f.regime;
      const deductionCol = f.deductions != null
        ? f.deductions.toLocaleString('fr-FR') + ' (réel)'
        : f.abattement.toLocaleString('fr-FR') + ' (' + f.abattementPct + '%)';
      tr.innerHTML = '<td>' + prop.name + '</td>'
        + '<td>' + regimeLabel + '</td>'
        + '<td class="num">' + f.loyerDeclare.toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + deductionCol + '</td>'
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

  // ── Methodology & Sources panel ──
  const methPanel = document.getElementById('immoMethodologyContent');
  if (methPanel) {
    let html = '';
    iv.properties.forEach(prop => {
      const m = prop.propertyMeta || {};
      const phases = m.appreciationPhases || [];
      const l15 = m.ligne15 || {};
      html += '<div style="margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #e2e8f0;">';
      html += '<strong style="color:var(--accent);">' + prop.name + '</strong>';
      if (m.surface) html += ' — ' + m.surface + ' m\u00b2';
      html += '<br>';
      // Type & context
      if (m.type) html += '<span style="background:#ebf8ff;padding:1px 6px;border-radius:4px;font-size:10px;color:#2b6cb0;">' + m.type + '</span> ';
      if (l15.station) html += '<span style="background:#f0fff4;padding:1px 6px;border-radius:4px;font-size:10px;color:#276749;">L15 : ' + l15.station + ' (' + l15.distance + ', ouverture ' + l15.opening + ')</span> ';
      html += '<br>';
      // Valuation
      html += '<div style="margin-top:6px;">';
      html += '\u2022 <strong>Valeur actuelle : ' + fmt(prop.value) + '</strong> (' + (m.surface ? Math.round(prop.value / m.surface).toLocaleString('fr-FR') : '?') + ' \u20ac/m\u00b2)<br>';
      html += '\u2022 Taux d\'appr\u00e9ciation moyen : <strong>' + ((m.appreciation || 0.01) * 100).toFixed(1) + '%/an</strong><br>';
      // Phases
      if (phases.length > 0) {
        html += '\u2022 Projection par phase :<br>';
        phases.forEach(function(ph) {
          html += '&nbsp;&nbsp;&nbsp;\u2192 ' + ph.start + '-' + ph.end + ' : <strong>' + (ph.rate * 100).toFixed(1) + '%/an</strong> \u2014 ' + ph.note + '<br>';
        });
      }
      html += '</div></div>';
    });
    // Sources
    html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #cbd5e0;">';
    html += '<strong>Sources (mars 2026) :</strong><br>';
    html += '\u2022 MeilleursAgents.com \u2014 prix/m\u00b2 par rue et quartier (f\u00e9vrier 2026)<br>';
    html += '\u2022 efficity.com \u2014 prix/m\u00b2 par adresse (janvier-f\u00e9vrier 2026)<br>';
    html += '\u2022 SeLoger.com \u2014 estimations immobili\u00e8res par ville<br>';
    html += '\u2022 Capaxis / LyBox / ImAvenir \u2014 \u00e9tudes impact Ligne 15 (+8-15% dans rayon 500m)<br>';
    html += '\u2022 Soci\u00e9t\u00e9 des Grands Projets \u2014 calendrier GPE (L15 Sud fin 2026, L15 Ouest 2030-2032)<br>';
    html += '</div>';
    html += '<div style="margin-top:8px;font-size:11px;color:#a0aec0;">';
    html += '<strong>Hypoth\u00e8ses cl\u00e9s :</strong> VEFA neuf en quartier \u00e9tabli = prime +12-15% vs ancien. VEFA neuf en quartier en chantier (Vitry) = prime limit\u00e9e +5-8% (offre abondante, commerces manquants). R\u00e9novation = prime +10%. ';
    html += 'Vitry : TVA 5.5% sur achat (valeur march\u00e9 sup\u00e9rieure au prix pay\u00e9, mais quartier encore en d\u00e9veloppement). ';
    html += 'Villejuif : remise r\u00e9sident VEFA, quartier d\u00e9j\u00e0 \u00e9tabli (L14 + L15 + p\u00f4le sant\u00e9). ';
    html += 'Rueil : 15K\u20ac travaux r\u00e9valorisant l\'appartement (cuisine + SDB). Quartier sous-performe la ville (-37% vs moyenne Rueil).';
    html += '</div>';
    methPanel.innerHTML = html;
  }
}

// ============ PROPERTY DETAIL PANEL ============
function renderPropertyDetail(state, prop) {
  const meta = prop.propertyMeta || {};
  const cd = prop.chargesDetail || {};
  const iv = state.immoView;

  // Title
  const titleEl = document.getElementById('propDetailTitle');
  if (titleEl) titleEl.textContent = prop.name + (meta.address ? ' — ' + meta.address : '');

  // ── Section 1: Fiche ──
  const ficheEl = document.getElementById('propDetailFiche');
  if (ficheEl) {
    const surface = meta.surface ? meta.surface + ' m²' : '—';
    const price = meta.purchasePrice ? meta.purchasePrice.toLocaleString('fr-FR') + ' €' : (meta.totalOperation ? meta.totalOperation.toLocaleString('fr-FR') + ' €' : '—');
    const date = meta.purchaseDate || '—';
    const type = meta.type || '—';
    const appreciation = meta.appreciation ? (meta.appreciation * 100).toFixed(0) + '%/an' : '—';
    ficheEl.innerHTML = '<h4 style="margin:0 0 8px;font-size:14px;color:#4a5568;">Fiche propriété</h4>'
      + '<div class="detail-grid">'
      + '<div class="detail-metric"><div style="font-size:18px;font-weight:700;">' + surface + '</div><div style="font-size:11px;color:#718096;">Surface</div></div>'
      + '<div class="detail-metric"><div style="font-size:18px;font-weight:700;">' + price + '</div><div style="font-size:11px;color:#718096;">Prix d\'achat</div></div>'
      + '<div class="detail-metric"><div style="font-size:18px;font-weight:700;">' + fmt(prop.value) + '</div><div style="font-size:11px;color:#718096;">Valeur actuelle</div></div>'
      + '<div class="detail-metric"><div style="font-size:18px;font-weight:700;color:var(--green);">' + fmt(prop.equity) + '</div><div style="font-size:11px;color:#718096;">Equity</div></div>'
      + '<div class="detail-metric"><div style="font-size:15px;font-weight:600;">' + type + '</div><div style="font-size:11px;color:#718096;">Type</div></div>'
      + '<div class="detail-metric"><div style="font-size:15px;font-weight:600;">' + date + '</div><div style="font-size:11px;color:#718096;">Date achat</div></div>'
      + '<div class="detail-metric"><div style="font-size:15px;font-weight:600;">' + appreciation + '</div><div style="font-size:11px;color:#718096;">Appréciation</div></div>'
      + '<div class="detail-metric"><div style="font-size:15px;font-weight:600;">' + prop.ltv.toFixed(1) + '%</div><div style="font-size:11px;color:#718096;">LTV</div></div>'
      + '</div>';
  }

  // ── Section 2: Prêts ──
  const loansEl = document.getElementById('propDetailLoans');
  if (loansEl) {
    let html = '<h4 style="margin:0 0 8px;font-size:14px;color:#4a5568;">Détail des prêts</h4>';
    if (prop.loanDetails && prop.loanDetails.length > 0) {
      html += '<div style="overflow-x:auto;"><table style="font-size:0.82rem;width:100%;">'
        + '<thead><tr><th>Prêt</th><th class="num">Capital</th><th class="num">Taux</th><th class="num">Durée</th><th class="num">Mensualité</th><th class="num">Assurance</th></tr></thead><tbody>';
      let totalMens = 0, totalAss = 0;
      prop.loanDetails.forEach(l => {
        totalMens += l.monthlyPayment || 0;
        totalAss += l.insuranceMonthly || 0;
        const dur = l.durationMonths ? Math.round(l.durationMonths / 12) + ' ans' : '—';
        html += '<tr>'
          + '<td>' + l.name + '</td>'
          + '<td class="num">' + (l.principal || 0).toLocaleString('fr-FR') + ' €</td>'
          + '<td class="num">' + ((l.rate || 0) * 100).toFixed(2) + '%</td>'
          + '<td class="num">' + dur + '</td>'
          + '<td class="num">' + Math.round(l.monthlyPayment || 0).toLocaleString('fr-FR') + ' €</td>'
          + '<td class="num">' + Math.round(l.insuranceMonthly || 0).toLocaleString('fr-FR') + ' €</td>'
          + '</tr>';
      });
      html += '<tr style="font-weight:700;border-top:2px solid #cbd5e0;background:#edf2f7;">'
        + '<td>Total</td><td></td><td></td><td></td>'
        + '<td class="num">' + Math.round(totalMens).toLocaleString('fr-FR') + ' €</td>'
        + '<td class="num">' + Math.round(totalAss).toLocaleString('fr-FR') + ' €</td></tr>';
      html += '</tbody></table></div>';
      html += '<div style="margin-top:6px;font-size:12px;color:#718096;">CRD actuel : <strong>' + fmt(prop.crd) + '</strong> | Fin prêt : <strong>' + (prop.endYear || '—') + '</strong></div>';
    } else {
      html += '<p style="color:#718096;font-size:13px;">Aucun détail de prêt disponible</p>';
    }
    loansEl.innerHTML = html;
  }

  // ── Section 3: Cash Flow ──
  const cfEl = document.getElementById('propDetailCF');
  if (cfEl) {
    const cfSign = prop.cf >= 0 ? '+' : '';
    const cfClass = prop.cf >= 0 ? 'pl-pos' : 'pl-neg';
    const cfNetSign = prop.cfNetFiscal >= 0 ? '+' : '';
    const cfNetClass = prop.cfNetFiscal >= 0 ? 'pl-pos' : 'pl-neg';
    let html = '<h4 style="margin:0 0 8px;font-size:14px;color:#4a5568;">Cash Flow mensuel</h4>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">'
      // Revenus
      + '<div style="background:#f0fff4;border-radius:8px;padding:12px;">'
      + '<div style="font-weight:700;color:#276749;margin-bottom:6px;">Revenus</div>'
      + '<div style="display:grid;grid-template-columns:1fr auto;gap:4px 12px;font-size:13px;">'
      + '<span>Loyer HC</span><span class="num">' + prop.loyerHC + ' €</span>'
      + (prop.parking > 0 ? '<span>Parking</span><span class="num">' + prop.parking + ' €</span>' : '')
      + (prop.chargesLoc > 0 ? '<span>Charges locataire</span><span class="num">' + prop.chargesLoc + ' €</span>' : '')
      + '<span style="font-weight:700;border-top:1px solid #c6f6d5;padding-top:4px;">Total revenus</span><span class="num" style="font-weight:700;border-top:1px solid #c6f6d5;padding-top:4px;">' + prop.totalRevenue + ' €</span>'
      + '</div></div>'
      // Charges
      + '<div style="background:#fff5f5;border-radius:8px;padding:12px;">'
      + '<div style="font-weight:700;color:#c53030;margin-bottom:6px;">Charges</div>'
      + '<div style="display:grid;grid-template-columns:1fr auto;gap:4px 12px;font-size:13px;">'
      + '<span>Prêt</span><span class="num">' + Math.round(cd.pret || 0) + ' €</span>'
      + '<span>Assurance empr.</span><span class="num">' + Math.round(cd.assurance || 0) + ' €</span>'
      + '<span>PNO</span><span class="num">' + Math.round(cd.pno || 0) + ' €</span>'
      + '<span>Taxe foncière</span><span class="num">' + Math.round(cd.tf || 0) + ' €</span>'
      + '<span>Copro</span><span class="num">' + Math.round(cd.copro || 0) + ' €</span>'
      + '<span style="font-weight:700;border-top:1px solid #fed7d7;padding-top:4px;">Total charges</span><span class="num" style="font-weight:700;border-top:1px solid #fed7d7;padding-top:4px;">' + Math.round(prop.charges) + ' €</span>'
      + '</div></div></div>';
    // CF KPIs
    html += '<div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap;">'
      + '<div class="detail-metric" style="flex:1;min-width:120px;"><div style="font-size:20px;font-weight:700;" class="' + cfClass + '">' + cfSign + prop.cf + ' €</div><div style="font-size:11px;color:#718096;">CF brut /mois</div></div>'
      + '<div class="detail-metric" style="flex:1;min-width:120px;"><div style="font-size:20px;font-weight:700;" class="' + cfNetClass + '">' + cfNetSign + Math.round(prop.cfNetFiscal) + ' €</div><div style="font-size:11px;color:#718096;">CF net fiscal /mois</div></div>'
      + '<div class="detail-metric" style="flex:1;min-width:120px;"><div style="font-size:18px;font-weight:700;">' + prop.yieldGross.toFixed(1) + '%</div><div style="font-size:11px;color:#718096;">Rendement brut</div></div>'
      + '<div class="detail-metric" style="flex:1;min-width:120px;"><div style="font-size:18px;font-weight:700;">' + prop.yieldNet.toFixed(1) + '%</div><div style="font-size:11px;color:#718096;">Rendement net</div></div>'
      + '<div class="detail-metric" style="flex:1;min-width:120px;"><div style="font-size:18px;font-weight:700;">' + fmt(prop.wealthCreation) + '</div><div style="font-size:11px;color:#718096;">Création richesse /an</div></div>'
      + '</div>';
    cfEl.innerHTML = html;
  }

  // ── Section 5: Fiscal Simulator (Vitry only) ──
  const fiscalEl = document.getElementById('propDetailFiscal');
  if (fiscalEl) {
    if (prop.loanKey === 'vitry' && prop.fiscalSimConfig) {
      fiscalEl.style.display = 'block';
      renderFiscalSimulator(fiscalEl, prop);
    } else {
      fiscalEl.style.display = 'none';
    }
  }

  // ── Section 6: VEFA Timeline (Villejuif only) ──
  const vefaEl = document.getElementById('propDetailVefa');
  if (vefaEl) {
    if (prop.loanKey === 'villejuif' && prop.vefaConfig) {
      vefaEl.style.display = 'block';
      renderVEFATimeline(vefaEl, prop);
    } else {
      vefaEl.style.display = 'none';
    }
  }

  // ── Charts (after DOM update) ──
  setTimeout(() => {
    if (typeof window.buildPropertyDetailCharts === 'function') {
      window.buildPropertyDetailCharts(state, prop);
    }
  }, 50);
}

// ── Fiscal Simulator (Vitry) ──
function renderFiscalSimulator(container, prop) {
  const cfg = prop.fiscalSimConfig;
  const yearlyInt = prop.yearlyInterest || {};
  const defaultLoyer = cfg.loyerTotalMensuel;

  let html = '<h4 style="margin:0 0 12px;font-size:14px;color:#4a5568;">Simulation fiscale — Micro-Foncier vs Réel</h4>';
  // Slider
  html += '<div style="margin-bottom:16px;padding:12px;background:#f7fafc;border-radius:8px;">'
    + '<label style="font-size:13px;font-weight:600;">Loyer déclaré : <span id="pdFiscalSliderVal">' + defaultLoyer + '</span> €/mois</label>'
    + '<input type="range" id="pdFiscalSlider" min="0" max="' + (defaultLoyer + 200) + '" value="' + defaultLoyer + '" step="50" style="width:100%;margin-top:6px;">'
    + '<div style="font-size:11px;color:#718096;">Modifiez pour simuler une partie en cash (non déclaré)</div>'
    + '</div>';
  // Tables
  html += '<div id="pdFiscalTable"></div>';
  html += '<div id="pdFiscalVerdict" style="margin-top:12px;padding:12px;background:#f0fff4;border-radius:8px;"></div>';

  container.innerHTML = html;

  const slider = document.getElementById('pdFiscalSlider');
  const valEl = document.getElementById('pdFiscalSliderVal');

  function updateFiscalSim() {
    const loyerDeclare = parseInt(slider.value);
    valEl.textContent = loyerDeclare;
    const loyerCashMensuel = cfg.loyerTotalMensuel - loyerDeclare;

    let microTotal = 0, reelTotal = 0;
    const rows = [];

    for (let y = 0; y < cfg.nYears; y++) {
      const year = cfg.startYear + y;
      const moisLoyer = year === cfg.startYear ? (12 - cfg.contractStartMonth + 1) : 12;
      const loyerDeclareAn = loyerDeclare * moisLoyer;
      const prorata = moisLoyer / 12;

      // Micro-foncier
      const microAbattement = Math.round(loyerDeclareAn * 0.30);
      const microRevImp = loyerDeclareAn - microAbattement;
      const microImpot = Math.round(microRevImp * cfg.totalRate);

      // Réel foncier
      const tfAnnee = year <= cfg.tfExemptionEndYear ? 0 : cfg.tfAnnuel;
      const totalInterets = yearlyInt[year] || 0;
      const assuranceAnnee = cfg.totalAssuranceAnnuel * prorata;
      const pnoAnnee = cfg.pnoAnnuel * prorata;
      const reelDeductions = totalInterets + assuranceAnnee + pnoAnnee + tfAnnee;
      const reelRevImp = Math.max(0, loyerDeclareAn - reelDeductions);
      const reelDeficit = loyerDeclareAn < reelDeductions ? Math.round(reelDeductions - loyerDeclareAn) : 0;
      const reelImpot = Math.round(reelRevImp * cfg.totalRate);

      const delta = microImpot - reelImpot;
      microTotal += microImpot;
      reelTotal += reelImpot;

      const moisNote = moisLoyer < 12 ? ' <small style="color:#718096;">(' + moisLoyer + 'm)</small>' : '';
      const bgStyle = year <= cfg.tfExemptionEndYear ? 'background:#f0fff4;' : '';

      rows.push('<tr style="' + bgStyle + '">'
        + '<td><strong>' + year + '</strong>' + moisNote + '</td>'
        + '<td class="num">' + loyerDeclareAn.toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="color:#718096;">' + microAbattement.toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + microRevImp.toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="color:#c53030;">' + microImpot.toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="color:#718096;">' + Math.round(reelDeductions).toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + Math.round(reelRevImp).toLocaleString('fr-FR')
          + (reelDeficit > 0 ? ' <small style="color:#276749;">(déf. ' + reelDeficit.toLocaleString('fr-FR') + ')</small>' : '') + '</td>'
        + '<td class="num" style="color:' + (reelImpot > 0 ? '#c53030' : '#276749') + ';">' + reelImpot.toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="font-weight:700;color:' + (delta > 0 ? '#276749' : '#c53030') + ';">' + (delta > 0 ? '+' : '') + delta.toLocaleString('fr-FR') + '</td>'
        + '</tr>');
    }

    const totalDelta = microTotal - reelTotal;
    rows.push('<tr style="font-weight:700;border-top:3px solid #2d3748;background:#edf2f7;">'
      + '<td>TOTAL 10 ans</td><td></td><td></td><td></td>'
      + '<td class="num" style="color:#c53030;">' + microTotal.toLocaleString('fr-FR') + ' €</td>'
      + '<td></td><td></td>'
      + '<td class="num" style="color:' + (reelTotal > 0 ? '#c53030' : '#276749') + ';">' + reelTotal.toLocaleString('fr-FR') + ' €</td>'
      + '<td class="num" style="font-weight:700;color:#276749;">' + (totalDelta > 0 ? '+' : '') + totalDelta.toLocaleString('fr-FR') + ' €</td>'
      + '</tr>');

    document.getElementById('pdFiscalTable').innerHTML = '<div style="overflow-x:auto;"><table style="font-size:0.8rem;width:100%;">'
      + '<thead><tr><th>Année</th><th class="num">Loyer décl.</th>'
      + '<th class="num" style="background:#fff5eb;">Abatt. 30%</th><th class="num" style="background:#fff5eb;">Rev. imp.</th><th class="num" style="background:#fff5eb;">Impôt micro</th>'
      + '<th class="num" style="background:#ebf8ff;">Déductions</th><th class="num" style="background:#ebf8ff;">Rev. imp.</th><th class="num" style="background:#ebf8ff;">Impôt réel</th>'
      + '<th class="num" style="background:#f0fff4;">Δ Économie</th></tr></thead>'
      + '<tbody>' + rows.join('') + '</tbody></table></div>';

    const winner = totalDelta > 0 ? 'Réel Foncier' : (totalDelta < 0 ? 'Micro-Foncier' : 'Identique');
    const verdictColor = totalDelta > 0 ? 'var(--green)' : 'var(--red)';
    document.getElementById('pdFiscalVerdict').innerHTML =
      '<strong style="font-size:1.05rem;color:' + verdictColor + ';">Régime recommandé : ' + winner + '</strong>'
      + ' | Économie sur 10 ans : <strong style="color:' + verdictColor + ';">' + Math.abs(totalDelta).toLocaleString('fr-FR') + ' €</strong>'
      + ' (~' + Math.round(Math.abs(totalDelta) / 10 / 12) + ' €/mois en moy.)'
      + (loyerCashMensuel > 0 ? '<br><small style="color:#718096;">Loyer total ' + cfg.loyerTotalMensuel + '€ dont ' + loyerCashMensuel + '€ cash non déclaré</small>' : '');
  }

  slider.addEventListener('input', updateFiscalSim);
  updateFiscalSim();
}

// ── VEFA Timeline (Villejuif) ──
function renderVEFATimeline(container, prop) {
  const cfg = prop.vefaConfig;
  const [startY, startM] = cfg.franchiseStart.split('-').map(Number);
  const [delY, delM] = cfg.deliveryDate.split('-').map(Number);
  const franchiseEnd = new Date(startY, startM - 1 + cfg.franchiseMonths);
  const franchiseEndLabel = franchiseEnd.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const deliveryLabel = new Date(delY, delM - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  let html = '<h4 style="margin:0 0 12px;font-size:14px;color:#4a5568;">Timeline VEFA — Villejuif</h4>';

  // Timeline visual
  const now = new Date();
  const totalMonths = (delY - startY) * 12 + (delM - startM);
  const elapsedMonths = (now.getFullYear() - startY) * 12 + (now.getMonth() + 1 - startM);
  const pctElapsed = Math.min(100, Math.max(0, elapsedMonths / totalMonths * 100));
  const pctFranchise = cfg.franchiseMonths / totalMonths * 100;

  html += '<div style="position:relative;height:50px;background:#e2e8f0;border-radius:8px;margin-bottom:16px;overflow:hidden;">'
    + '<div style="position:absolute;left:0;top:0;height:100%;width:' + pctFranchise + '%;background:#bee3f8;border-right:2px dashed #2b6cb0;"></div>'
    + '<div style="position:absolute;left:0;top:0;height:100%;width:' + pctElapsed + '%;background:var(--accent);opacity:0.3;"></div>'
    + '<div style="position:absolute;left:' + pctElapsed + '%;top:0;width:3px;height:100%;background:var(--accent);"></div>'
    + '<div style="position:absolute;left:4px;top:4px;font-size:10px;font-weight:600;color:#2b6cb0;">Franchise</div>'
    + '<div style="position:absolute;right:4px;top:4px;font-size:10px;font-weight:600;color:#4a5568;">Livraison</div>'
    + '<div style="position:absolute;left:' + pctElapsed + '%;bottom:4px;transform:translateX(-50%);font-size:10px;font-weight:700;color:var(--accent);">Auj.</div>'
    + '</div>';

  // Key dates
  html += '<div class="detail-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;">'
    + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;">' + cfg.franchiseStart + '</div><div style="font-size:11px;color:#718096;">Début franchise</div></div>'
    + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;">' + franchiseEndLabel + '</div><div style="font-size:11px;color:#718096;">Fin franchise</div></div>'
    + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;">' + deliveryLabel + '</div><div style="font-size:11px;color:#718096;">Livraison prévue</div></div>'
    + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;">' + cfg.franchiseMonths + ' mois</div><div style="font-size:11px;color:#718096;">Durée franchise</div></div>'
    + '</div>';

  // Financial summary
  if (cfg.totalOperation) {
    html += '<div style="margin-top:12px;padding:12px;background:#f7fafc;border-radius:8px;font-size:13px;">'
      + '<strong>Montant opération :</strong> ' + cfg.totalOperation.toLocaleString('fr-FR') + ' € '
      + (cfg.fraisDossier > 0 ? '| <strong>Frais dossier :</strong> ' + cfg.fraisDossier.toLocaleString('fr-FR') + ' €' : '')
      + '<br><small style="color:#718096;">Pendant la franchise, seuls les intérêts intercalaires sont payés. Les mensualités complètes commencent après livraison.</small>'
      + '</div>';
  }

  container.innerHTML = html;
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
  const creancesTable = document.getElementById('creancesTable');
  if (tbody) {
    const statusColors = { en_cours: '#3182ce', relancé: '#d69e2e', en_retard: '#c53030', recouvré: '#276749', litige: '#9f7aea' };
    const statusLabels = { en_cours: 'EN COURS', relancé: 'RELANCÉ', en_retard: 'EN RETARD', recouvré: 'RECOUVRÉ', litige: 'LITIGE' };

    function renderCreancesRows(items) {
      tbody.innerHTML = '';
      items.forEach(item => {
        const tr = document.createElement('tr');
        const probStyle = item.guaranteed ? 'color:var(--green);font-weight:600' : (item.probability >= 0.7 ? 'color:#d69e2e' : 'color:var(--red)');
        const st = item.status || 'en_cours';
        const statusBadge = '<span style="background:' + (statusColors[st] || '#718096') + ';color:white;padding:1px 6px;border-radius:4px;font-size:10px">' + (statusLabels[st] || st.toUpperCase()) + '</span>';
        const followUpIcon = item.needsFollowUp ? ' <span title="Relancer ! Dernier contact il y a ' + item.daysSinceContact + 'j" style="color:var(--red);font-weight:700;cursor:help">\u26a0</span>' : '';
        const overdueTxt = item.daysOverdue > 0 ? ' <span style="color:var(--red);font-size:11px">(' + item.daysOverdue + 'j retard)</span>' : '';
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
      const tr = document.createElement('tr');
      tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
      tr.innerHTML = '<td colspan="4"><strong>Total</strong></td>'
        + '<td class="num"><strong>' + fmt(crv.totalNominal) + '</strong></td>'
        + '<td></td>'
        + '<td class="num"><strong>' + fmt(crv.totalExpected) + '</strong></td>'
        + '<td class="num pl-neg"><strong>-' + fmt(crv.monthlyInflationCost) + '</strong></td>';
      tbody.appendChild(tr);
    }

    renderCreancesRows(crv.items);
    makeTableSortable(creancesTable, crv.items, renderCreancesRows);
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

// ---- BUDGET VIEW ----
function renderBudgetView(state) {
  const bv = state.budgetView;
  if (!bv) return;

  // ── KPIs PERSONAL ──
  setEur('kpiBudgetTotal', bv.personalTotal);
  setEur('kpiBudgetYearly', bv.totalYearly);
  setEur('kpiBudgetDubai', bv.personalByZone['Dubai'] || 0);
  setEur('kpiBudgetDigital', (bv.personalByZone['Digital'] || 0) + (bv.personalByZone['France'] || 0));

  // ── KPIs INVEST ──
  setEur('kpiBudgetInvestTotal', bv.investTotal);
  setEur('kpiBudgetInvestLoyer', bv.investLoyerTotal);
  const cfSign = bv.investCFTotal >= 0 ? '+' : '';
  setText('kpiBudgetInvestCF', cfSign + fmt(bv.investCFTotal) + '/mois');
  const cfEl = document.getElementById('kpiBudgetInvestCF');
  if (cfEl) cfEl.style.color = bv.investCFTotal >= 0 ? 'var(--green)' : 'var(--red)';
  // Grand total = personal + net CF from investments (if negative, adds to expenses)
  const grandTotal = bv.personalTotal + Math.max(0, -bv.investCFTotal);
  setEur('kpiBudgetGrandTotal', grandTotal);

  // ── PERSONAL TABLE ──
  const tbody = document.getElementById('budgetDetailTbody');
  const budgetTable = document.getElementById('budgetTable');
  if (tbody) {
    const zoneColors = { Dubai: '#d69e2e', France: '#2b6cb0', Digital: '#805ad5' };
    const typeColors = { Logement: '#e53e3e', 'Crédits': '#2b6cb0', Utilities: '#38a169', Abonnements: '#805ad5', Assurance: '#d69e2e' };
    const freqLabels = { monthly: '/mois', quarterly: '/trim.', yearly: '/an' };

    // Enrich items with pct for sorting
    const budgetData = bv.personal.map(item => ({
      ...item,
      pct: bv.personalTotal > 0 ? (item.monthlyEUR / bv.personalTotal * 100) : 0,
    }));

    function renderBudgetRows(items) {
      tbody.innerHTML = '';
      items.forEach(item => {
        const tr = document.createElement('tr');
        const nativeStr = Math.round(item.amountNative).toLocaleString('fr-FR');
        const sym = { EUR: '\u20ac', AED: '\u062f.\u0625', MAD: 'DH', USD: '$' }[item.currency] || item.currency;
        const nativeDisplay = item.currency === 'EUR' ? sym + ' ' + nativeStr : nativeStr + ' ' + sym;

        const zoneBg = zoneColors[item.zone] || '#718096';
        const typeBg = typeColors[item.type] || '#718096';
        const zoneBadge = '<span style="background:' + zoneBg + ';color:white;padding:1px 8px;border-radius:4px;font-size:10px;font-weight:600">' + item.zone + '</span>';
        const typeBadge = '<span style="background:' + typeBg + ';color:white;padding:1px 8px;border-radius:4px;font-size:10px;font-weight:600">' + item.type + '</span>';

        tr.innerHTML = '<td style="font-weight:600">' + item.label + '</td>'
          + '<td>' + zoneBadge + '</td>'
          + '<td>' + typeBadge + '</td>'
          + '<td class="num">' + nativeDisplay + '</td>'
          + '<td>' + (freqLabels[item.freq] || item.freq) + '</td>'
          + '<td class="num" style="font-weight:700;">' + fmt(item.monthlyEUR) + '</td>'
          + '<td class="num">' + item.pct.toFixed(1) + '%</td>';
        tbody.appendChild(tr);
      });

      // Total row
      const tr = document.createElement('tr');
      tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
      tr.innerHTML = '<td colspan="5"><strong>Total Personnel</strong></td>'
        + '<td class="num"><strong>' + fmt(bv.personalTotal) + '</strong></td>'
        + '<td class="num"><strong>100%</strong></td>';
      tbody.appendChild(tr);
    }

    renderBudgetRows(budgetData);
    makeTableSortable(budgetTable, budgetData, renderBudgetRows);
  }

  // ── INVEST DETAIL (per property cards) ──
  const investDiv = document.getElementById('budgetInvestDetail');
  if (investDiv) {
    let html = '';
    bv.investProperties.forEach(prop => {
      const inactive = !prop.active;
      const borderColor = inactive ? '#cbd5e0' : '#2b6cb0';
      const opacity = inactive ? 'opacity:0.6' : '';
      html += '<div style="background:#f7fafc;border-radius:10px;padding:16px 20px;margin-bottom:12px;border-left:4px solid ' + borderColor + ';' + opacity + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
      html += '<strong style="font-size:15px;color:var(--primary)">' + prop.name;
      if (inactive) html += ' <span style="background:#fef3c7;padding:1px 8px;border-radius:4px;font-size:10px;color:#92400e;font-weight:600">\u00c0 VENIR</span>';
      html += '</strong>';
      html += '<div style="display:flex;gap:16px;align-items:center">';
      if (inactive) {
        html += '<span style="font-size:13px;color:var(--gray)"><em>VEFA \u2014 seule assurance pr\u00eat (' + fmt(prop.currentCharges) + ')</em></span>';
      } else {
        if (prop.loyer > 0) {
          html += '<span style="font-size:13px;color:var(--gray)">Loyer HC : <strong style="color:var(--green)">' + fmt(prop.loyer) + '</strong></span>';
        } else {
          html += '<span style="font-size:13px;color:var(--gray)">Loyer : <em>pas encore lou\u00e9</em></span>';
        }
        const cfClass = prop.cf >= 0 ? 'pos' : 'neg';
        const cfSign2 = prop.cf >= 0 ? '+' : '';
        html += '<span style="font-size:13px;font-weight:700" class="' + cfClass + '">CF : ' + cfSign2 + fmt(prop.cf) + '/mois</span>';
      }
      html += '</div></div>';

      // Charges table — active charges bold, inactive (future) in gray italic
      html += '<table style="margin:0;font-size:12px"><tbody>';
      prop.charges.forEach(ch => {
        const chActive = ch.active !== false;
        const style = chActive ? '' : 'color:var(--gray);font-style:italic';
        const suffix = chActive ? '' : ' <span style="font-size:10px">(futur)</span>';
        html += '<tr style="' + style + '"><td style="padding:4px 12px">' + ch.label + suffix + '</td>'
          + '<td class="num" style="padding:4px 12px">' + fmt(ch.monthlyEUR) + '</td></tr>';
      });
      // Current vs future total
      if (prop.currentCharges !== prop.totalCharges) {
        html += '<tr style="font-weight:700;border-top:2px solid #cbd5e0"><td style="padding:4px 12px">Pay\u00e9 actuellement</td>'
          + '<td class="num" style="padding:4px 12px">' + fmt(prop.currentCharges) + '</td></tr>';
        html += '<tr style="color:var(--gray)"><td style="padding:4px 12px"><em>Total futur (apr\u00e8s livraison)</em></td>'
          + '<td class="num" style="padding:4px 12px"><em>' + fmt(prop.totalCharges) + '</em></td></tr>';
      } else {
        html += '<tr style="font-weight:700;border-top:2px solid #cbd5e0"><td style="padding:4px 12px">Total charges</td>'
          + '<td class="num" style="padding:4px 12px">' + fmt(prop.totalCharges) + '</td></tr>';
      }
      if (inactive && prop.futureLoyer > 0) {
        html += '<tr style="color:var(--green)"><td style="padding:4px 12px">Loyer pr\u00e9vu</td>'
          + '<td class="num" style="padding:4px 12px">' + fmt(prop.futureLoyer) + '</td></tr>';
      }
      html += '</tbody></table></div>';
    });

    // Summary bar
    const barPctLoyer = bv.investTotal > 0 ? Math.min(100, bv.investLoyerTotal / bv.investTotal * 100) : 0;
    html += '<div style="margin-top:12px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:4px">';
    html += '<span>Charges totales : ' + fmt(bv.investTotal) + '/mois</span>';
    html += '<span>Loyers totaux : ' + fmt(bv.investLoyerTotal) + '/mois</span>';
    html += '</div>';
    html += '<div class="meter-bar" style="height:28px">';
    html += '<div class="mb-seg" style="width:' + Math.min(barPctLoyer, 100).toFixed(0) + '%;background:var(--green)">' + fmt(bv.investLoyerTotal) + '</div>';
    if (barPctLoyer < 100) {
      html += '<div class="mb-seg" style="width:' + (100 - barPctLoyer).toFixed(0) + '%;background:var(--red)">' + fmt(bv.investTotal - bv.investLoyerTotal) + '</div>';
    }
    html += '</div>';
    html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray);margin-top:4px">';
    html += '<span>\ud83d\udfe2 Couvert par les loyers</span>';
    html += '<span>\ud83d\udd34 Effort d\u2019\u00e9pargne</span>';
    html += '</div></div>';

    investDiv.innerHTML = html;
  }
}

// ---- WHT / Dividend render ----
// ---- WHT SORT STATE ----
let whtSortCol = null;
let whtSortAsc = true;
let whtPositionsCache = null;

function renderWHTAnalysis(state) {
  const div = state.dividendAnalysis;
  if (!div) return;

  setText('kpiWhtTotalDiv', fmt(div.totalProjectedDiv) + '/an');
  setText('kpiWhtTotal', '-' + fmt(div.totalProjectedWHT) + '/an');
  document.getElementById('kpiWhtTotal')?.classList.add('pl-neg');
  setText('kpiWhtSavings', '+' + fmt(div.savingsIfEliminated) + '/an');
  const switchCount = div.positions.filter(p => p.recommendation === 'switch').length;
  setText('kpiWhtPositions', switchCount + ' position' + (switchCount > 1 ? 's' : ''));

  // Cache positions for sorting
  whtPositionsCache = div.positions.filter(p => p.divYield !== 0 || p.projectedWHT !== 0);

  // Setup sortable headers (once)
  setupWHTSortHeaders();

  // Render rows
  renderWHTRows();
}

function setupWHTSortHeaders() {
  const thead = document.querySelector('#whtTbody')?.closest('table')?.querySelector('thead');
  if (!thead || thead.dataset.sortBound) return;
  thead.dataset.sortBound = 'true';

  const cols = [
    { key: 'label', idx: 0 },
    { key: 'valEUR', idx: 1 },
    { key: 'dpsNative', idx: 2 },
    { key: 'projectedDivEUR', idx: 3 },
    { key: 'whtRate', idx: 4 },
    { key: 'projectedWHT', idx: 5 },
    { key: 'daysUntilEx', idx: 6 },
    { key: 'recommendation', idx: 7 },
    { key: 'alternativeETF', idx: 8 },
  ];

  const ths = thead.querySelectorAll('th');
  cols.forEach(col => {
    const th = ths[col.idx];
    if (!th) return;
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    th.style.position = 'relative';
    const origText = th.textContent;
    th.addEventListener('click', () => {
      if (whtSortCol === col.key) {
        whtSortAsc = !whtSortAsc;
      } else {
        whtSortCol = col.key;
        whtSortAsc = true;
      }
      // Update header indicators
      ths.forEach(t => {
        const base = t.textContent.replace(/ [▲▼]$/, '');
        t.textContent = base;
      });
      const arrow = whtSortAsc ? ' ▲' : ' ▼';
      th.textContent = origText.replace(/ [▲▼]$/, '') + arrow;

      renderWHTRows();
    });
  });
}

function renderWHTRows() {
  const tbody = document.getElementById('whtTbody');
  if (!tbody || !whtPositionsCache) return;

  // Sort
  let sorted = [...whtPositionsCache];
  if (whtSortCol) {
    sorted.sort((a, b) => {
      let va = a[whtSortCol], vb = b[whtSortCol];
      // Handle dates (daysUntilEx: lower = sooner deadline = first)
      if (whtSortCol === 'daysUntilEx') {
        va = va ?? 9999; vb = vb ?? 9999;
      }
      // Handle strings
      if (typeof va === 'string') return whtSortAsc ? va.localeCompare(vb || '') : (vb || '').localeCompare(va);
      // Handle numbers / null
      va = va ?? -Infinity; vb = vb ?? -Infinity;
      return whtSortAsc ? va - vb : vb - va;
    });
  }

  tbody.innerHTML = '';
  sorted.forEach(p => {
    const tr = document.createElement('tr');
    const recBg = p.recommendation === 'switch' ? 'background:#fff5f5;' : '';
    const recBadge = p.recommendation === 'switch'
      ? '<span style="background:#fed7d7;color:#c53030;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600">SWITCHER</span>'
      : '<span style="background:#c6f6d5;padding:1px 6px;border-radius:4px;font-size:10px;color:#276749">GARDER</span>';

    const currSymbols = { EUR: '€', USD: '$', JPY: '¥', MAD: 'DH' };
    const currSym = currSymbols[p.dpsCurrency] || p.dpsCurrency;
    const dpsText = p.dpsNative > 0
      ? (p.dpsCurrency === 'JPY' ? currSym + Math.round(p.dpsNative) : currSym + p.dpsNative.toFixed(2))
      : '-';

    let deadlineHtml = '-';
    if (p.nextExDate) {
      const d = p.nextExDate;
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
      const dateStr = day + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
      const urgency = p.daysUntilEx <= 30 ? 'color:#c53030;font-weight:700;' : p.daysUntilEx <= 60 ? 'color:#c05621;font-weight:600;' : 'color:var(--gray);';
      deadlineHtml = '<span style="' + urgency + '">' + dateStr + '</span><br><span style="font-size:10px;color:var(--gray)">J-' + p.daysUntilEx + '</span>';
    }

    tr.style.cssText = recBg;
    tr.innerHTML = '<td><strong>' + p.label + '</strong><br><span style="font-size:10px;color:var(--gray)">' + p.shares + ' × ' + (p.divYield * 100).toFixed(1) + '% yield</span></td>'
      + '<td class="num">' + fmt(p.valEUR) + '</td>'
      + '<td class="num" style="font-size:11px">' + dpsText + '</td>'
      + '<td class="num">' + (p.projectedDivEUR > 0 ? fmt(p.projectedDivEUR) : '-') + '</td>'
      + '<td class="num">' + (p.whtRate * 100).toFixed(1) + '%</td>'
      + '<td class="num pl-neg">' + (p.projectedWHT > 0 ? '-' + fmt(p.projectedWHT) : '-') + '</td>'
      + '<td class="num">' + deadlineHtml + '</td>'
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

// ============================================================
// KPI HOVER INSIGHTS — contextual tooltips on KPI cards
// ============================================================
let _insightsAttached = false;

function attachKPIInsights(state, view) {
  const s = state;
  const gt = getGrandTotal(s);
  const f = v => Math.round(v).toLocaleString('fr-FR');
  const pct = (v, t) => t > 0 ? Math.round(v / t * 100) : 0;

  // Build insights map from state
  const insights = {};

  // ── Couple view ──
  const immoEq = s.couple.immoEquity;
  const stocksTotal = s.amine.ibkr + s.amine.espp + s.amine.sgtm + s.nezha.sgtm;
  const cashTotal = s.amine.uae + s.amine.revolutEUR + s.amine.moroccoCash + s.nezha.cash;
  insights['kpiCoupleNW'] = 'Actions \u20ac' + f(stocksTotal) + ' (' + pct(stocksTotal, gt) + '%) + Immo \u20ac' + f(immoEq) + ' (' + pct(immoEq, gt) + '%) + Cash \u20ac' + f(cashTotal) + ' (' + pct(cashTotal, gt) + '%). Contexte : conflit Iran, or +21% YTD, BTC -25% YTD.';
  insights['kpiCoupleAmNW'] = 'Amine : Actions \u20ac' + f(s.amine.ibkr + s.amine.espp + s.amine.sgtm) + ' + Cash \u20ac' + f(s.amine.uae + s.amine.revolutEUR + s.amine.moroccoCash) + ' + Immo \u20ac' + f(s.amine.vitryEquity) + '. Portefeuille diversifi\u00e9 sur 4 classes d\'actifs.';
  insights['kpiCoupleNzNW'] = 'Nezha : Immo \u20ac' + f(s.nezha.rueilEquity) + ' (Rueil) + Cash \u20ac' + f(s.nezha.cash) + ' (FR+MA+UAE). Patrimoine diversifi\u00e9 3 devises.' + (s.nezha.villejuifSigned ? '' : ' Villejuif non compt\u00e9 (bail non sign\u00e9).');
  insights['kpiCoupleImmo'] = 'Vitry \u20ac' + f(s.amine.vitryEquity) + ' + Rueil \u20ac' + f(s.nezha.rueilEquity) + ' + Villejuif \u20ac' + f(s.nezha.villejuifEquity) + '. Levier immo : \u20ac' + f(s.couple.immoValue) + ' de valeur pour \u20ac' + f(immoEq) + ' d\'equity.';

  // ── Amine view ──
  insights['kpiAmNW'] = 'Top poste : Actions (' + pct(s.amine.ibkr + s.amine.espp + s.amine.sgtm, s.amine.nw) + '% du NW). Cash UAE repr\u00e9sente ' + pct(s.amine.uae, s.amine.nw) + '% \u2014 Mashreq/Wio rendent 6%/an.';
  insights['kpiAmPortfolio'] = 'IBKR \u20ac' + f(s.amine.ibkr) + ' + ESPP \u20ac' + f(s.amine.espp) + '. Concentration top 3 = 43% du portefeuille. Diversifier vers des ETFs.';
  insights['kpiAmTWR'] = 'Time-Weighted Return : mesure la performance ind\u00e9pendamment des d\u00e9p\u00f4ts/retraits. Comparable au benchmark (CAC 40, S&P 500).';
  insights['kpiAmVitry'] = 'Equity Vitry = valeur estim\u00e9e - CRD. Appr\u00e9ciation +2%/an (GPE Ligne 15). Cr\u00e9ation de richesse +\u20ac1,017/mois.';

  // ── Nezha view ──
  const rueilProp = s.immoView && s.immoView.properties ? s.immoView.properties.find(p => p.loanKey === 'rueil') : null;
  insights['kpiNzNW'] = 'Patrimoine actuel hors Villejuif VEFA. Domin\u00e9 par l\'immobilier (Rueil auto-financ\u00e9, CF +\u20ac' + (rueilProp ? Math.round(rueilProp.cf) : '?') + '/mois).';
  insights['kpiNzRueil'] = 'Equity Rueil = \u20ac' + f(s.nezha.rueilEquity) + '. Cr\u00e9dit Mutuel 1.20%. Auto-financ\u00e9 : loyer couvre 100% des charges. +\u20ac838/mois de richesse.';
  insights['kpiNzVillejuif'] = 'VEFA en construction. Livraison \u00e9t\u00e9 2029. Franchise 3 ans (int\u00e9r\u00eats capitalis\u00e9s). Equity estimative bas\u00e9e sur l\'apport + appr\u00e9ciation.';
  insights['kpiNzCash'] = 'Cash total \u20ac' + f(s.nezha.cash) + ' dont Livret A \u20ac' + f(s.nezha.livretA) + ' (1.5%) + \u20ac' + f(s.nezha.cashFrance - s.nezha.livretA) + ' dormant (0%). Optimiser : assurance-vie ou SCPI.';

  // ── Actions view ──
  if (s.actionsView) {
    const av = s.actionsView;
    insights['kpiActionsTotal'] = av.ibkrPositions.length + ' positions IBKR + ESPP + SGTM x2. Benchmark : S&P 500 +12.5% YTD, Or +21% YTD, BTC -25% YTD.';
    const losers = av.ibkrPositions.filter(p => p.unrealizedPL < 0);
    const winners = av.ibkrPositions.filter(p => p.unrealizedPL >= 0);
    insights['kpiActionsUnrealizedPL'] = winners.length + ' positions en gain, ' + losers.length + ' en perte. Perte latente totale : \u20ac' + f(losers.reduce((s,p) => s + p.unrealizedPL, 0)) + '. Crypto = gros contributeur n\u00e9gatif (BTC -25%, ETH -33% YTD).';
    insights['kpiActionsRealizedPL'] = '+\u20ac' + f(av.combinedRealizedPL) + ' r\u00e9alis\u00e9 (IBKR + Degiro). Meilleur trade : NVIDIA (+\u20ac41K). Attention : 0% d\'exposition or (meilleur actif 2025-2026).';
    insights['kpiActionsTotalDeposits'] = 'Total inject\u00e9 dans les march\u00e9s. P/L total = ' + (av.combinedUnrealizedPL + av.combinedRealizedPL >= 0 ? '+' : '') + '\u20ac' + f(av.combinedUnrealizedPL + av.combinedRealizedPL) + ' (' + ((av.combinedUnrealizedPL + av.combinedRealizedPL) / av.totalDeposits * 100).toFixed(1) + '% du capital).';
    insights['kpiActionsDividends'] = '\u20ac' + f(av.dividends) + ' de dividendes bruts re\u00e7us. WHT pr\u00e9lev\u00e9e \u00e0 la source (30% France, 15% US/JP). \u26A0 Prochain ex-date : DG.PA le 21 avr. Vendre avant pour \u00e9viter WHT.';
  }

  // ── Cash view ──
  if (s.cashView) {
    const cv = s.cashView;
    insights['kpiCashTotal'] = '\u20ac' + f(cv.totalCash) + ' en cash. Rendement moyen : ' + (cv.weightedAvgYield * 100).toFixed(1) + '%. Cash productif : \u20ac' + f(cv.totalYielding) + ' (' + pct(cv.totalYielding, cv.totalCash) + '%).';
    insights['kpiCashAvgYield'] = 'Rendement pond\u00e9r\u00e9 de tous les comptes. UAE : 6% (Wio/Mashreq). IBKR EUR : 1.5%. France/Maroc : 0%. Objectif : maximiser le cash \u00e0 6%.';
    insights['kpiCashInflation'] = '-\u20ac' + f(cv.monthlyInflationCost) + '/mois d\'\u00e9rosion (3% inflation). En 1 an = -\u20ac' + f(cv.monthlyInflationCost * 12) + ' de pouvoir d\'achat perdu.';
    insights['kpiCashProductive'] = 'Cash plac\u00e9 \u00e0 rendement > 0%. Le reste est dormant et perd de la valeur chaque mois. Objectif : 100% productif.';
  }

  // ── Immo view ──
  if (s.immoView) {
    const iv = s.immoView;
    insights['kpiImmoViewEq'] = 'Equity nette sur 3 biens. Rueil \u20ac' + f(s.nezha.rueilEquity) + ' (ancien r\u00e9nov\u00e9) + Villejuif \u20ac' + f(s.nezha.villejuifEquity) + ' (VEFA neuf) + Vitry \u20ac' + f(s.amine.vitryEquity) + ' (VEFA neuf RE2020).';
    insights['kpiImmoViewVal'] = 'Valeur march\u00e9 bas\u00e9e sur donn\u00e9es MeilleursAgents/efficity (mars 2026) + prime neuf (+12-15%). Vitry 2.5%/an (L15 Les Ardoines), Villejuif 2%/an (L15 Louis Aragon), Rueil 1%/an (L15 lointaine).';
    insights['kpiImmoViewCRD'] = 'Capital Restant D\u00fb total. Se r\u00e9duit chaque mois. Fin : 2044 (Rueil), 2048 (Vitry), 2053 (Villejuif). Plus de d\u00e9tails dans la section Sources ci-dessous.';
    insights['kpiImmoViewWealth'] = '+\u20ac' + f(iv.totalWealthCreation) + '/mois = capital rembours\u00e9 + appr\u00e9ciation. ~\u20ac' + f(iv.totalWealthCreation * 12) + '/an de richesse nette cr\u00e9\u00e9e. Vitry et Villejuif b\u00e9n\u00e9ficient de l\'effet GPE Ligne 15.';
    const cfSign = iv.totalCF >= 0 ? '+' : '';
    insights['kpiImmoViewCF'] = 'CF net = loyers - charges. Rueil +\u20ac209/mois | Vitry -\u20ac317/mois | Villejuif \u00e0 venir (livraison 2029). Total : ' + cfSign + '\u20ac' + f(iv.totalCF) + '/mois.';
  }

  // ── Cr\u00e9ances view ──
  if (s.creancesView) {
    const crv = s.creancesView;
    insights['kpiCreancesNominal'] = crv.items.length + ' cr\u00e9ances actives. ' + crv.items.filter(c => c.currency === 'EUR').length + ' en EUR, ' + crv.items.filter(c => c.currency === 'MAD').length + ' en MAD. Valeur nominale totale avant probabilit\u00e9.';
    insights['kpiCreancesExpected'] = 'Valeur ajust\u00e9e par probabilit\u00e9 de recouvrement. Garanti (100%) + Incertain (70%) = valeur attendue r\u00e9aliste.';
    insights['kpiCreancesGuaranteed'] = '100% probabilit\u00e9. SAP sous 45j, Malt sous 30j. Cr\u00e9ances long terme : Kenza + Mehdi (MAD).';
    insights['kpiCreancesUncertain'] = 'Probabilit\u00e9 ~70%. Abdelkader 55K MAD + Omar 40K MAD + Akram 1.5K EUR. Relances en cours.';
    insights['kpiCreancesInflation'] = 'Co\u00fbt d\'opportunit\u00e9 : argent bloqu\u00e9 dans les cr\u00e9ances au lieu d\'\u00eatre investi. Plus le recouvrement tarde, plus la perte est grande.';
  }

  // Bind events on all .kpi cards
  document.querySelectorAll('.kpi-strip').forEach(strip => {
    const barId = 'insight-' + (strip.id || '').replace('kpi-', '');
    const bar = document.getElementById(barId);
    if (!bar) return;

    strip.querySelectorAll('.kpi').forEach(kpi => {
      const valueEl = kpi.querySelector('[id]');
      if (!valueEl) return;
      const id = valueEl.id;
      const text = insights[id];
      if (!text) return;

      // Remove old listeners (by replacing node — simple approach)
      kpi.onmouseenter = () => {
        bar.textContent = text;
        bar.classList.add('visible');
      };
      kpi.onmouseleave = () => {
        bar.classList.remove('visible');
      };
    });
  });
}
