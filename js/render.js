// ============================================================
// RENDER LAYER — DOM write-only. Takes STATE, outputs to DOM.
// ============================================================
// No computation here. Only formatting and DOM manipulation.

import { CURRENCY_CONFIG, CASH_YIELDS, IMMO_CONSTANTS, EXIT_COSTS, VITRY_CONSTRAINTS, VILLEJUIF_REGIMES } from './data.js?v=149';
import { getGrandTotal } from './engine.js?v=149';

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
        if (isStr || typeof va === 'string' || typeof vb === 'string') {
          va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase();
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        const aNull = (va == null), bNull = (vb == null);
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
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
    renderDynamicInsights(state, view);
    renderCoupleTable(state);
    renderAmineTable(state);
    renderNezhaTable(state, view);
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

  // Per-apartment views
  if (view === 'apt_vitry') renderAptView(state, 'vitry');
  if (view === 'apt_rueil') renderAptView(state, 'rueil');
  if (view === 'apt_villejuif') renderAptView(state, 'villejuif');

  renderBadges(state);
  updateAllDataEur();

  // Hide Villejuif warning on views where it's irrelevant
  const vjNote = document.getElementById('villejuifNote');
  if (vjNote) {
    const showVjViews = ['couple', 'nezha', 'immobilier', 'apt_vitry', 'apt_rueil', 'apt_villejuif'];
    vjNote.style.display = showVjViews.includes(view) ? '' : 'none';
  }

  // Hide NW History chart container if NW_HISTORY is empty
  const nwHistCanvas = document.getElementById('nwHistoryChart');
  if (nwHistCanvas) {
    const container = nwHistCanvas.closest('.card');
    if (container && (!state.nwHistory || state.nwHistory.length < 2 || !state.nwHistory.some(h => h.coupleNW))) {
      container.style.display = 'none';
    } else if (container) {
      container.style.display = '';
    }
  }
}

// ---- Individual render functions ----

const ASSET_VIEWS = ['actions', 'cash', 'immobilier', 'creances', 'budget', 'apt_vitry', 'apt_rueil', 'apt_villejuif'];
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
    const titles = { actions: 'Cockpit Actions & Crypto', cash: 'Tr\u00e9sorerie & Cash', immobilier: 'Portefeuille Immobilier', creances: 'Cr\u00e9ances & Recouvrements', budget: 'Budget Mensuel', apt_vitry: 'Vitry-sur-Seine', apt_rueil: 'Rueil-Malmaison', apt_villejuif: 'Villejuif (VEFA)' };
    const subs = { actions: 'Toutes les positions actions, crypto, ETFs — IBKR + ESPP + SGTM', cash: 'Vue consolid\u00e9e de tous les comptes cash — Amine & Nezha', immobilier: '3 biens immobiliers — Vitry, Rueil, Villejuif', creances: 'Cr\u00e9ances actives — analyse de recouvrement et co\u00fbt d\'opportunit\u00e9', budget: 'D\u00e9penses fixes — Dubai, France, Digital', apt_vitry: '19 Rue Nathalie Lemel — T3 Location nue', apt_rueil: '21 All\u00e9e des Glycines — T3 meubl\u00e9 LMNP', apt_villejuif: '167 Bd Maxime Gorki — T3 VEFA' };
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
  // Add delta indicator for couple NW
  if (s.couple.nwDelta !== null && s.couple.nwDeltaPct !== null) {
    setDelta('kpiCoupleNW', s.couple.nwDelta, s.couple.nwDeltaPct, s.couple.nwDeltaTimeframe);
  }

  setEur('kpiCoupleAmNW', s.amine.nw);
  if (s.amine.nwDelta !== null && s.amine.nwDeltaPct !== null) {
    setDelta('kpiCoupleAmNW', s.amine.nwDelta, s.amine.nwDeltaPct, s.amine.nwDeltaTimeframe);
  }
  setEur('kpiCoupleNzNW', s.nezha.nw);
  if (s.nezha.nwDelta !== null && s.nezha.nwDeltaPct !== null) {
    setDelta('kpiCoupleNzNW', s.nezha.nwDelta, s.nezha.nwDeltaPct, s.nezha.nwDeltaTimeframe);
  }
  setEur('kpiCoupleImmo', s.couple.immoEquity);

  setEur('kpiAmNW', s.amine.nw);
  // Add delta indicator for amine NW
  if (s.amine.nwDelta !== null && s.amine.nwDeltaPct !== null) {
    setDelta('kpiAmNW', s.amine.nwDelta, s.amine.nwDeltaPct, s.amine.nwDeltaTimeframe);
  }
  setEur('kpiAmPortfolio', s.amine.ibkr + s.amine.espp);
  setEur('kpiAmVitry', s.amine.vitryEquity);
  // TWR dynamic from state (was hardcoded)
  if (s.actionsView) {
    setText('kpiAmTWR', '+' + s.actionsView.twr.toFixed(1) + '%');
  }

  setEur('kpiNzNW', s.nezha.nw);
  // Add delta indicator for nezha NW
  if (s.nezha.nwDelta !== null && s.nezha.nwDeltaPct !== null) {
    setDelta('kpiNzNW', s.nezha.nwDelta, s.nezha.nwDeltaPct, s.nezha.nwDeltaTimeframe);
  }
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
  setEur('subESPP', s.amine.espp + s.nezha.espp);
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
  setHTML('subESPPDetail', (p.amine.espp.shares + (p.nezha.espp ? p.nezha.espp.shares : 0)) + ' actions ACN @ $' + p.market.acnPriceUSD.toFixed(0) + srcLabel + ' (Amine ' + p.amine.espp.shares + ' + Nezha ' + (p.nezha.espp ? p.nezha.espp.shares : 0) + ')');
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

  // ── Dynamic cash breakdowns ──
  const p0 = state.portfolio;
  const fxR = state.fx;
  const uaeBD = document.getElementById('subUAEBreakdown');
  if (uaeBD) {
    const mashreq = p0.amine.uae.mashreq;
    const wioS = p0.amine.uae.wioSavings;
    const revEUR = p0.amine.uae.revolutEUR;
    const wioC = p0.amine.uae.wioCurrent;
    const fmtAED = v => 'AED ' + Math.round(v).toLocaleString('fr-FR');
    const fmtEURsm = v => '<span style="color:var(--gray);font-size:11px">(' + Math.round(v / fxR.AED).toLocaleString('fr-FR') + ')</span>';
    const totalUAE = (mashreq + wioS + wioC) / fxR.AED + revEUR;
    uaeBD.innerHTML =
      '<li><span class="bl-label">Mashreq NEO PLUS</span><span class="bl-val">' + fmtAED(mashreq) + ' ' + fmtEURsm(mashreq) + '</span></li>' +
      '<li><span class="bl-label">Wio Savings</span><span class="bl-val">' + fmtAED(wioS) + ' ' + fmtEURsm(wioS) + '</span></li>' +
      '<li><span class="bl-label">Revolut (EUR)</span><span class="bl-val">' + Math.round(revEUR).toLocaleString('fr-FR') + '</span></li>' +
      '<li><span class="bl-label">Wio Current</span><span class="bl-val">' + fmtAED(wioC) + ' ' + fmtEURsm(wioC) + '</span></li>' +
      '<li style="border-top:1px solid #cbd5e0;padding-top:4px"><span class="bl-label" style="font-style:italic">Sous-total EUR</span><span class="bl-val">' + Math.round(totalUAE).toLocaleString('fr-FR') + '</span></li>';
  }
  const uaeBadge = document.getElementById('subUAEBadge');
  if (uaeBadge) {
    const bestRate = Math.max(CASH_YIELDS.mashreq, CASH_YIELDS.wioSavings) * 100;
    uaeBadge.textContent = '~' + bestRate.toFixed(0) + '% rendement epargne';
  }

  const marocBD = document.getElementById('subMarocBreakdown');
  if (marocBD) {
    const att = p0.amine.maroc.attijari;
    const nabd = p0.amine.maroc.nabd;
    marocBD.innerHTML =
      '<li><span class="bl-label">Attijariwafa Courant</span><span class="bl-val">MAD ' + Math.round(att).toLocaleString('fr-FR') + '</span></li>' +
      '<li><span class="bl-label">BMCE/BOA Cheque</span><span class="bl-val">MAD ' + Math.round(nabd).toLocaleString('fr-FR') + '</span></li>';
  }

  // ── Dynamic vehicles & TVA ──
  const veh = p0.amine.vehicles;
  if (veh) {
    const totalVeh = (veh.cayenne || 0) + (veh.mercedes || 0);
    setHTML('subVehiclesDetail', 'Porsche Cayenne ' + Math.round((veh.cayenne || 0) / 1000) + 'K<br>Mercedes Class A ' + Math.round((veh.mercedes || 0) / 1000) + 'K');
    setEur('subVehicles', totalVeh);
  }
  const tvaVal = Math.abs(p0.amine.tva || 0);
  setHTML('subTVADetail', 'Passif fiscal<br>Provision estimee');
  const tvaEl = document.getElementById('subTVA');
  if (tvaEl) { tvaEl.setAttribute('data-eur', Math.round(tvaVal)); tvaEl.setAttribute('data-sign', '-'); }

  // ── Dynamic FX footer ──
  const fxDisp = document.getElementById('fxDisplay');
  if (fxDisp) fxDisp.textContent = fxR.AED.toFixed(4) + ' AED | ' + fxR.MAD.toFixed(4) + ' MAD | ' + fxR.USD.toFixed(4) + ' USD';

  // ── IBKR badge ──
  const ibkrBadge = document.getElementById('subIBKRBadge');
  if (ibkrBadge && p0.amine.ibkr.meta.twr) {
    ibkrBadge.textContent = 'TWR +' + p0.amine.ibkr.meta.twr.toFixed(2) + '%';
  }

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
      // Only show "non signe" warning in immobilier and property-specific views
      const relevantViews = ['immobilier', 'villejuif', 'apt_villejuif', 'nezha'];
      const showWarning = relevantViews.includes(view);
      setHTML('subVillejuifCrdDetail', fmt(villejuifP.value) + '<br>CRD ' + fmt(villejuifP.crd) + (showWarning ? '<br><span style="font-size:11px;color:#92400e">Acte notarie non signe \u2014 reservation 3K payee</span>' : ''));
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

// ============================================================
// DYNAMIC INSIGHTS — replaces all hardcoded text in HTML
// ============================================================
function renderDynamicInsights(state, view) {
  const s = state;
  const p = state.portfolio;
  const iv = state.immoView;
  const fx = state.fx;
  const K = v => Math.round(v / 1000) + 'K';
  const N = v => Math.round(v).toLocaleString('fr-FR');

  // ── Cash insights (expand-cash) ──
  const cashIns = document.getElementById('cashInsightsExpand');
  if (cashIns && state.cashView) {
    const cv = state.cashView;
    const totalCash = cv.totalCash;
    const dormantPct = totalCash > 0 ? Math.round(cv.totalNonYielding / totalCash * 100) : 0;
    const yieldingPct = 100 - dormantPct;
    const avgYld = cv.weightedAvgYield ? (cv.weightedAvgYield * 100).toFixed(1) : '0';
    // Find highest-yield and lowest-yield accounts dynamically
    const posAccounts = cv.accounts.filter(a => !a.isDebt && a.valEUR > 50);
    const bestAcct = posAccounts.reduce((best, a) => (a.yield || 0) > (best.yield || 0) ? a : best, { yield: 0 });
    const worstBig = posAccounts.filter(a => a.valEUR > 1000).reduce((w, a) => (a.yield || 0) < (w.yield || Infinity) ? a : w, { yield: Infinity });
    cashIns.innerHTML =
      '<strong>Insights Cash :</strong><br>' +
      '- <span style="color:var(--green)">' + K(totalCash) + ' de cash total, rendement moyen pond\u00e9r\u00e9 ' + avgYld + '%.</span><br>' +
      '- ' + yieldingPct + '% productif vs ' + dormantPct + '% dormant. Manque \u00e0 gagner annuel : ' + fmt(cv.totalNonYielding * 0.05) + '.<br>' +
      (bestAcct.label ? '- Meilleur rendement : ' + bestAcct.label + ' (' + ((bestAcct.yield || 0) * 100).toFixed(1) + '%).<br>' : '') +
      (worstBig.label && worstBig.valEUR > 1000 ? '- <span style="color:var(--red)">Plus gros poste dormant :</span> ' + worstBig.label + ' (' + fmt(worstBig.valEUR) + ' \u00e0 ' + ((worstBig.yield || 0) * 100).toFixed(1) + '%).' : '');
  }

  // ── Other insights (expand-other) ──
  const otherIns = document.getElementById('otherInsightsExpand');
  if (otherIns) {
    const allCreances = (p.amine.creances.items || []).concat(p.nezha.creances.items || []);
    const totalCreances = allCreances.reduce((s2, c) => s2 + (c.currency === 'EUR' ? c.amount : c.amount / fx[c.currency]), 0);
    const guarCreances = allCreances.filter(c => c.guaranteed).reduce((s2, c) => s2 + (c.currency === 'EUR' ? c.amount : c.amount / fx[c.currency]), 0);
    const persoCreances = totalCreances - guarCreances;
    const totalVeh = (p.amine.vehicles.cayenne || 0) + (p.amine.vehicles.mercedes || 0);
    const tvaAbs = Math.abs(p.amine.tva || 0);
    otherIns.innerHTML =
      '<strong>Insights Autres :</strong><br>' +
      '- <span style="color:var(--green)">' + N(totalCreances) + ' de creances dont ' + K(guarCreances) + ' garanties (delai 45j).</span> Les creances perso (~' + K(persoCreances) + ') sont a prioriser par montant.<br>' +
      '- Vehicules (' + K(totalVeh) + ') sont des actifs depreciants. La Porsche Cayenne perd ~5-7K/an. Considerer la revente dans 2-3 ans pour reinvestir.<br>' +
      '- TVA (-' + K(tvaAbs) + ') est un passif a court terme. Prevoir le paiement dans les prochains mois.<br>' +
      '- <span style="color:var(--red)">Risque :</span> Les creances personnelles (~' + K(persoCreances) + ') sont difficilement recouvrables a court terme. Ne pas les compter dans la tresorerie operationnelle. Les ' + K(guarCreances) + ' garantis sont assimilables a du cash.';
  }

  // ── Couple insights ──
  const cplPos = document.getElementById('coupleInsightsPositive');
  if (cplPos && iv) {
    const nw = s.couple.nw;
    const cashCouple = s.amine.uae + s.amine.revolutEUR + s.amine.moroccoCash + s.nezha.cashFrance + s.nezha.cashMaroc;
    const cashAmine = s.amine.uae + s.amine.revolutEUR + s.amine.moroccoCash;
    const cashNezha = s.nezha.cashFrance + s.nezha.cashMaroc;
    const totalDebt = iv.properties.reduce((sum, pr) => sum + pr.crd, 0);
    const totalImmoVal = iv.properties.reduce((sum, pr) => sum + pr.value, 0);
    cplPos.innerHTML =
      '<strong>Points forts du couple :</strong><br>' +
      '- NW combine de ' + K(nw) + ' a 33 et 34 ans \u2014 excellent rythme de constitution patrimoniale pour un couple.<br>' +
      '- Revenus diversifies : salaire Amine (Dubai) + patrimoine locatif Nezha (France). Deux pays, deux sources de revenus.<br>' +
      '- Cash couple total ~' + K(cashCouple) + ' (Amine ' + K(cashAmine) + ' + Nezha ' + K(cashNezha) + ') reparti sur 2 devises et plusieurs banques. Bonne resilience en cas de blocage bancaire.<br>' +
      '- Zero dette consommation. Les ' + K(totalDebt) + ' de dette sont 100% adosses a des actifs immo productifs (' + K(totalImmoVal) + ' de valeur).';
  }

  const cplRisks = document.getElementById('coupleInsightsRisks');
  if (cplRisks && iv) {
    const totalImmoVal = iv.properties.reduce((sum, pr) => sum + pr.value, 0);
    const totalDebt = iv.properties.reduce((sum, pr) => sum + pr.crd, 0);
    const totalEquity = iv.properties.reduce((sum, pr) => sum + pr.equity, 0);
    const cashAmine = s.amine.uae + s.amine.revolutEUR + s.amine.moroccoCash;
    const cashNezha = s.nezha.cashFrance + s.nezha.cashMaroc;
    const cashTotal = cashAmine + cashNezha;
    const aedPct = Math.round((s.amine.uae / cashTotal) * 100);
    const jpyShort = Math.abs(p.amine.ibkr.cashJPY || 0);
    const jpyEUR = Math.round(jpyShort / fx.JPY);
    const totalCreances = (p.amine.creances.items || []).reduce((s2, c) => s2 + (c.currency === 'EUR' ? c.amount : c.amount / fx[c.currency]), 0);
    const guarCreances = (p.amine.creances.items || []).filter(c => c.guaranteed).reduce((s2, c) => s2 + (c.currency === 'EUR' ? c.amount : c.amount / fx[c.currency]), 0);
    const persoCreances = totalCreances - guarCreances;
    cplRisks.innerHTML =
      '<strong>Risques & points d\'attention couple :</strong><br>' +
      '- <strong>Concentration immo IDF :</strong> ' + iv.properties.length + ' biens, ' + K(totalImmoVal) + ' de valeur, 100% en Ile-de-France. Zero diversification geo. Un retournement IDF de -10% = -' + K(totalImmoVal * 0.1) + ' d\'equity couple.<br>' +
      '- <strong>Exposition devise :</strong> Le couple est multi-devise \u2014 ~' + K(cashAmine) + ' en AED/USD (Amine) + ~' + K(cashNezha) + ' en EUR/MAD (Nezha). Le risque USD/EUR est reel (~' + aedPct + '% du cash total en AED).<br>' +
      '- <strong>Creances (' + K(totalCreances) + ') :</strong> ' + K(guarCreances) + ' garanti (delai de paiement 45 jours \u2014 quasi-cash) + creances perso ' + K(persoCreances) + ' (recouvrement incertain). Ne compter que les ' + K(guarCreances) + ' dans la planification.<br>' +
      '- <strong>Levier JPY (Amine) :</strong> Emprunt -' + (jpyShort / 1000000).toFixed(1) + 'M JPY (~' + K(jpyEUR) + ' EUR) sur IBKR. Une appreciation du yen de 10% couterait ~' + K(jpyEUR * 0.1) + '.';
  }

  // ── Amine immo insight ──
  const amImmo = document.getElementById('amineImmoInsight');
  if (amImmo && iv) {
    const vitryP = iv.properties.find(pr => pr.loanKey === 'vitry');
    if (vitryP) {
      const wealthMonth = vitryP.wealthCreation || 0;
      amImmo.innerHTML =
        '<strong>Immobilier Amine :</strong><br>' +
        '- <span style="color:var(--green)">Vitry genere +' + N(wealthMonth) + '/mois de creation de richesse</span>. Excellent levier malgre le CF negatif.<br>' +
        '- <strong>CF = ' + (vitryP.cf >= 0 ? '+' : '') + Math.round(vitryP.cf) + '/mois</strong> (revenus ' + N(vitryP.totalRevenue || vitryP.revenue || 0) + ' CC vs charges ' + N(vitryP.charges) + ').<br>' +
        '- Explorer le passage en LMNP reel \u2014 les charges deductibles pourraient reduire l\'imposition a zero.';
    }
  }

  // ── IBKR summary box ──
  const ibkrBox = document.getElementById('ibkrSummaryBox');
  if (ibkrBox) {
    ibkrBox.innerHTML = '<strong>IBKR :</strong> NAV ' + fmt(s.amine.ibkr) + ', depots ' + N(p.amine.ibkr.meta.deposits) + '. TWR ' + (p.amine.ibkr.meta.twr || 0).toFixed(2) + '% depuis ouverture.';
  }

  // ── Amine actions insight ──
  const amAct = document.getElementById('amineActionsInsight');
  if (amAct) {
    const jpyShort = Math.abs(p.amine.ibkr.cashJPY || 0);
    const jpyEUR = Math.round(jpyShort / fx.JPY);
    // Dynamic insights — compute portfolio projections from actual state
    const ibkrNAV = s.amine.ibkr;
    const twr = (p.amine.ibkr.meta.twr || 0);
    const deposits = p.amine.ibkr.meta.deposits || 0;
    const plTotal = ibkrNAV - deposits;
    const plPct = deposits > 0 ? (plTotal / deposits * 100).toFixed(1) : '0';
    // Simple projection: current NAV growing at estimated annual return
    const annualReturn = deposits > 0 && ibkrNAV > 0 ? (ibkrNAV / deposits - 1) : 0;
    const proj3y = Math.round(ibkrNAV * Math.pow(1 + Math.min(annualReturn, 0.10), 3));

    amAct.innerHTML =
      '<strong>Insights Actions :</strong><br>' +
      '- TWR de ' + twr.toFixed(1) + '% (P/L total: ' + (plTotal >= 0 ? '+' : '') + N(Math.round(plTotal)) + ', soit ' + (plTotal >= 0 ? '+' : '') + plPct + '% sur depots).<br>' +
      '- <span style="color:var(--green)">Projection 3 ans (au rythme actuel) :</span> NAV ~' + K(proj3y) + ' (sans apport supplementaire).<br>' +
      '- <span style="color:var(--green)">Deleverage JPY :</span> Short JPY reduit a -' + (jpyShort / 1000000).toFixed(1) + 'M JPY (~' + K(jpyEUR) + ' EUR).';
  }

  // ── Nezha insights ──
  const nzBox = document.getElementById('nezhaInsightsBox');
  if (nzBox && iv) {
    const rueilP = iv.properties.find(pr => pr.loanKey === 'rueil');
    const villejuifP = iv.properties.find(pr => pr.loanKey === 'villejuif');
    const nzNW = s.nezha.nw;
    const cashFR = s.nezha.cashFrance;
    const cashMA = s.nezha.cashMaroc;
    const rueilCF = rueilP ? (rueilP.cf >= 0 ? '+' : '') + Math.round(rueilP.cf) : '--';
    const rueilWealth = rueilP ? (rueilP.wealthCreation || 0) : 0;
    const rueilMens = rueilP ? Math.round(rueilP.charges) : 0;
    const vilMens = villejuifP ? Math.round(villejuifP.charges) : 0;
    const totalMens = rueilMens + vilMens;
    nzBox.innerHTML =
      '<strong>Profil :</strong> Patrimoine 100% immobilier + cash. ' + K(cashFR) + ' en France (dont une partie pour apport Villejuif). Credit debloque fin 2026, franchise totale 3 ans, livraison ete 2029.<br><br>' +
      '<strong>Insights Nezha :</strong><br>' +
      '- <span style="color:var(--green)">NW de ' + K(nzNW) + ' dont ' + K(rueilP ? rueilP.equity : 0) + ' en equity immo Rueil = patrimoine solide et croissant en automatique.</span><br>' +
      '- <span style="color:var(--green)">Rueil : auto-finance (' + rueilCF + '/mois de CF positif)</span>. ' + N(rueilWealth) + '/mois de creation de richesse, zero effort financier.<br>' +
      '- Cash total ~' + K(cashFR + cashMA) + ' (' + K(cashFR) + ' France + ' + K(cashMA) + ' Maroc).<br>' +
      '- <span style="color:var(--red)">Risque post-livraison :</span> Nezha portera ~' + N(totalMens) + '/mois de mensualites (Rueil ' + N(rueilMens) + ' + Villejuif ~' + N(vilMens) + ').<br>' +
      '- <span style="color:var(--green)">Apres livraison :</span> 2 biens de creation de richesse.';
  }

  // ── Nezha projection table ──
  const nzProj = document.getElementById('nezhaProjectionTable');
  if (nzProj && iv) {
    // Simple projection based on current amortization schedules
    const rueilP = iv.properties.find(pr => pr.loanKey === 'rueil');
    const villejuifP = iv.properties.find(pr => pr.loanKey === 'villejuif');
    const nzCash = s.nezha.cashFrance + s.nezha.cashMaroc;
    // Project 6 years from now
    const years = [2027, 2028, 2029, 2030, 2031, 2032];
    const now = new Date();
    const monthsFromNow = y => (y - now.getFullYear()) * 12 + (1 - now.getMonth());
    let html = '<table><thead><tr><th></th>';
    years.forEach(y => { html += '<th class="num">Jan ' + y + '</th>'; });
    html += '</tr></thead><tbody>';
    const rueilGrowth = rueilP ? (rueilP.wealthCreation || 0) : 0;
    const vilGrowth = villejuifP ? (villejuifP.wealthCreation || 0) : 0;
    // Equity Rueil row
    html += '<tr><td>Equity Rueil</td>';
    years.forEach(y => {
      const m = monthsFromNow(y);
      const eq = rueilP ? rueilP.equity + rueilGrowth * m : 0;
      html += '<td class="num">' + N(Math.max(0, eq)) + '</td>';
    });
    html += '</tr>';
    // Equity Villejuif row (0 before 2029, then growing)
    html += '<tr><td>Equity Villejuif</td>';
    years.forEach(y => {
      if (y < 2029) { html += '<td class="num">0</td>'; }
      else {
        const mSince = (y - 2029) * 12;
        const eq = vilGrowth * mSince;
        html += '<td class="num">' + N(Math.max(0, eq)) + '</td>';
      }
    });
    html += '</tr>';
    // Cash row — compute net CF from immo charges dynamically
    const nzMonthlyCF = (rueilP ? rueilP.cf : 0) + (villejuifP ? villejuifP.cf : 0);
    // If CF negative, cash declines; if positive, cash grows
    const nzCashDrift = nzMonthlyCF; // monthly net cash change from immo
    html += '<tr><td>Cash</td>';
    years.forEach(y => {
      const m = monthsFromNow(y);
      const cash = nzCash + nzCashDrift * m;
      html += '<td class="num">' + N(Math.max(0, cash)) + '</td>';
    });
    html += '</tr>';
    // Total row
    html += '<tr style="font-weight:700;background:#edf2f7"><td><strong>Total Nezha</strong></td>';
    years.forEach(y => {
      const m = monthsFromNow(y);
      const eqR = rueilP ? rueilP.equity + rueilGrowth * m : 0;
      let eqV = 0;
      if (y >= 2029) { eqV = vilGrowth * (y - 2029) * 12; }
      const cash = Math.max(0, nzCash + nzCashDrift * m);
      html += '<td class="num"><strong>' + N(eqR + eqV + cash) + '</strong></td>';
    });
    html += '</tr></tbody></table>';
    nzProj.innerHTML = html;
  }

  // ── Immo loan footnote ──
  const lnFoot = document.getElementById('immoLoanFootnote');
  if (lnFoot && iv) {
    const vilLoansF = IMMO_CONSTANTS.loans.villejuifLoans || [];
    const vitConsts = IMMO_CONSTANTS.properties.vitry;
    const fM = vilLoansF[0] && vilLoansF[0].periods ? vilLoansF[0].periods[0].months : 36;
    let footText = 'Villejuif : Prets LCL \u2014 ';
    if (vilLoansF.length >= 2) {
      footText += 'P1 ' + N(vilLoansF[0].principal) + ' @ ' + (vilLoansF[0].rate * 100).toFixed(2) + '% + P2 ' + N(vilLoansF[1].principal) + ' @ ' + (vilLoansF[1].rate * 100).toFixed(2) + '%. ';
    }
    footText += 'Franchise totale ' + fM + ' mois, capitalisation annuelle. ';
    footText += 'Vitry : valeur appreciee ' + ((vitConsts && vitConsts.appreciation ? vitConsts.appreciation : 0.02) * 100).toFixed(0) + '%/an depuis achat. ';
    footText += 'Rueil : bail meuble oct 2025.';
    lnFoot.textContent = footText;
  }
}

function renderCoupleTable(state) {
  const s = state;
  const p = state.portfolio;
  const rows = [
    ['Actions & ETFs (IBKR + ' + (p.amine.espp.shares + (p.nezha.espp ? p.nezha.espp.shares : 0)) + ' ACN + ' + (p.amine.sgtm.shares + p.nezha.sgtm.shares) + ' SGTM)', s.amine.ibkr + s.amine.espp + s.nezha.espp + s.amine.sgtm + s.nezha.sgtm],
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

function renderNezhaTable(state, view) {
  const s = state;
  const p = state.portfolio;
  const sgtmLabel = p.nezha.sgtm.shares + ' actions SGTM @ ' + p.market.sgtmPriceMAD + ' DH';
  const esppLabel = (p.nezha.espp ? p.nezha.espp.shares : 0) + ' actions ACN @ $' + p.market.acnPriceUSD.toFixed(0);
  const rows = [
    ['Equity Rueil-Malmaison', s.nezha.rueilEquity],
    ['ESPP Accenture (' + esppLabel + ')', s.nezha.espp],
    ['Revolut EUR', s.nezha.revolutEUR],
    ['Crédit Mutuel (CC)', s.nezha.creditMutuel],
    ['Livret A — LCL (1.5%)', s.nezha.livretA],
    ['LCL Compte de dépôts', s.nezha.lclDepots],
    ['Attijariwafa Maroc (' + Math.round(s.nezha.cashMarocMAD).toLocaleString('fr-FR') + ' MAD)', s.nezha.cashMaroc],
    ['Wio UAE (' + Math.round(s.nezha.cashUAE_AED).toLocaleString('fr-FR') + ' AED)', s.nezha.cashUAE],
    ['Creance Omar (' + Math.round(s.nezha.recvOmarMAD).toLocaleString('fr-FR') + ' MAD)', s.nezha.recvOmar],
    ['SGTM (' + sgtmLabel + ')', s.nezha.sgtm],
    ...(s.nezha.cautionRueil > 0 ? [['Caution Rueil (dette locataire)', -s.nezha.cautionRueil]] : []),
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

  // Only show Villejuif section in immobilier and property-specific views
  const relevantViews = ['immobilier', 'villejuif', 'apt_villejuif', 'nezha'];
  if (relevantViews.includes(view)) {
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
  setText('kpiCoupleImmoLabel', 'Equity Nette Immo (' + nb + ' biens) *');
  setText('kpiImmoEqLabel', 'Equity Nette (' + nb + ' biens)');
  // Wealth creation from immoView — with breakdown
  if (state.immoView) {
    const wc = state.immoView.totalWealthCreation;
    setText('immoWealthVal', '+' + fmt(wc) + '/mois');
    // Show mini breakdown in projection area
    const tb = state.immoView.totalWealthBreakdown;
    const projEl = document.getElementById('immoWealthProj');
    if (projEl && tb) {
      projEl.innerHTML = '<span style="color:#2b6cb0">\u25A0</span> Capital ' + fmt(tb.capitalAmorti)
        + ' + <span style="color:#276749">\u25A0</span> Appre. ' + fmt(tb.appreciation)
        + (tb.cashflow >= 0
          ? ' + <span style="color:#48bb78">\u25A0</span> CF +' + fmt(tb.cashflow)
          : ' - <span style="color:#e53e3e">\u25A0</span> Effort ' + fmt(Math.abs(tb.cashflow)));
    }
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
  if (!el) return;
  el.dataset.eur = val;
  // Update visible text immediately (for toggles like Villejuif)
  if (el.dataset.type !== 'pct') {
    const sign = el.dataset.sign || '';
    el.textContent = sign + fmt(val);
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// Add a subtle percentage badge below a KPI value
function setSubPct(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  // Remove existing sub-pct if any
  const existing = el.parentElement?.querySelector('.kpi-sub-pct');
  if (existing) existing.remove();
  // Create sub-pct element
  const span = document.createElement('span');
  span.className = 'kpi-sub-pct';
  const sign = pct >= 0 ? '+' : '';
  span.textContent = sign + pct.toFixed(1) + '%';
  span.style.cssText = 'display:block;font-size:12px;font-weight:600;margin-top:2px;color:' + (pct >= 0 ? '#276749' : '#c53030') + ';';
  el.insertAdjacentElement('afterend', span);
}

// Add delta indicator showing change since last data point
function setDelta(id, deltaVal, deltaPct, timeframe) {
  const el = document.getElementById(id);
  if (!el) return;
  // Remove existing delta if any
  const existing = el.parentElement?.querySelector('.kpi-delta');
  if (existing) existing.remove();
  // Create delta element
  const span = document.createElement('span');
  span.className = 'kpi-delta';
  const sign = deltaVal >= 0 ? '+' : '';
  const color = deltaVal >= 0 ? '#16a34a' : '#dc2626';
  span.textContent = sign + fmt(deltaVal) + ' (' + sign + deltaPct.toFixed(1) + '%) ' + timeframe;
  span.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-top:2px;color:' + color + ';';
  el.insertAdjacentElement('afterend', span);
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

let _immoIncludeVillejuif = true; // toggle for Villejuif (achat futur)
window._immoIncludeVillejuif = () => _immoIncludeVillejuif; // expose for charts
let _posViewMode = 'total'; // 'total' or 'unitaire'
let _posPeriod = 'all'; // 'all', 'daily', 'mtd', 'oneMonth', 'ytd'
let _expandedTicker = null; // currently expanded row
// Column visibility config: { key: { label, on, modeOnly? } }
const _colConfig = {
  broker:  { label: 'Broker',   on: false },
  shares:  { label: 'Qté',      on: true },
  prix:    { label: 'Prix',     on: false },
  valeur:  { label: 'Valeur',   on: true },
  pru:     { label: 'PRU',      on: false },
  cout:    { label: 'Coût',     on: true },
  pl:      { label: 'P/L',      on: true },
  pctPL:   { label: '% P/L',    on: true },
  evo:     { label: 'Évolution', on: true },
  weight:  { label: 'Poids',    on: true },
  sector:  { label: 'Secteur',  on: true },
  geo:     { label: 'Géo',      on: true },
};
let _colOrder = Object.keys(_colConfig);

function _isColVisible(key) {
  const c = _colConfig[key];
  return c && c.on;
}

function renderAllPositions(allPositions, sortKey, sortDir) {
  // Enrich positions with period-specific sort fields
  const _periodMap = { daily: 'dailyPL', mtd: 'mtdPL', oneMonth: 'oneMonthPL', ytd: 'ytdPL' };
  const _pField = _periodMap[_posPeriod];
  allPositions.forEach(pos => {
    pos.pl_periode = _pField ? (pos[_pField] || 0) : pos.unrealizedPL;
    // valeur_debut = current value - period P&L (since start = end - change)
    pos.valeur_debut = pos.valEUR - (pos.pl_periode || 0);
    pos.pctPL_periode = pos.valeur_debut > 0 ? (pos.pl_periode / pos.valeur_debut * 100) : 0;
  });
  const sorted = [...allPositions];
  if (sortKey) {
    sorted.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string' || typeof vb === 'string') {
        va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase();
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      // Push null/undefined to the bottom regardless of sort direction
      const aNull = (va == null), bNull = (vb == null);
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }
  const table = document.getElementById('allPositionsTable');
  const tbody = document.getElementById('allPositionsTbody');
  if (!tbody || !table) return;
  tbody.innerHTML = '';
  const periodLabels = { all: 'All', daily: 'Daily', mtd: 'MTD', oneMonth: '1M', ytd: 'YTD' };
  const vis = (k) => _isColVisible(k);

  // Column header definitions - vary based on period
  const _hdefs = _posPeriod === 'all' ? {
    broker:  { sort: 'broker', label: 'Broker', cls: 'sortable' },
    shares:  { sort: 'shares', label: 'Qte', cls: 'num sortable' },
    prix:    { sort: 'price', label: 'Prix', cls: 'num sortable' },
    valeur:  { sort: 'valEUR', label: 'Valeur', cls: 'num sortable' },
    pru:     { sort: 'pruEUR', label: 'PRU', cls: 'num sortable' },
    cout:    { sort: 'costEUR', label: 'Co\u00fbt', cls: 'num sortable' },
    pl:      { sort: 'unrealizedPL', label: 'P/L', cls: 'num sortable' },
    pctPL:   { sort: 'pctPL', label: '%', cls: 'num sortable' },
    weight:  { sort: 'weight', label: 'Poids', cls: 'num sortable' },
    sector:  { sort: 'sector', label: 'Secteur', cls: 'sortable' },
    geo:     { sort: 'geo', label: 'G\u00e9o', cls: 'sortable' },
  } : {
    broker:  { sort: 'broker', label: 'Broker', cls: 'sortable' },
    shares:  { sort: 'shares', label: 'Qte', cls: 'num sortable' },
    prix:    { sort: 'price', label: 'Prix', cls: 'num sortable' },
    valeur_debut: { sort: 'valeur_debut', label: 'Valeur d\u00e9but', cls: 'num sortable' },
    valeur_actuelle: { sort: 'valEUR', label: 'Valeur actuelle', cls: 'num sortable' },
    pru:     { sort: 'pruEUR', label: 'PRU', cls: 'num sortable' },
    pl_periode: { sort: 'pl_periode', label: 'P/L p\u00e9riode', cls: 'num sortable' },
    pctPL_periode: { sort: 'pctPL_periode', label: '% p\u00e9riode', cls: 'num sortable' },
    weight:  { sort: 'weight', label: 'Poids', cls: 'num sortable' },
    sector:  { sort: 'sector', label: 'Secteur', cls: 'sortable' },
    geo:     { sort: 'geo', label: 'G\u00e9o', cls: 'sortable' },
  };

  // Adjust column order based on period
  let colOrder = _posPeriod === 'all' ?
    ['shares', 'valeur', 'cout', 'pl', 'pctPL', 'weight', 'sector', 'geo'] :
    ['shares', 'valeur_debut', 'valeur_actuelle', 'pl_periode', 'pctPL_periode', 'weight', 'sector', 'geo'];

  // Rebuild thead dynamically based on colOrder
  const thead = table.querySelector('thead');
  if (thead) {
    let hdr = '<tr><th class="sortable" data-sort="label">Position <span class="sort-arrow"></span></th>';
    colOrder.forEach(k => { const d = _hdefs[k]; if (!d) return; hdr += '<th class="' + d.cls + '" data-sort="' + d.sort + '">' + d.label + ' <span class="sort-arrow"></span></th>'; });
    thead.innerHTML = hdr + '</tr>';
  }

  let totalVal = 0, totalCost = 0, totalEvoPL = 0;
  let hasStatic = false, staticVal = 0, liveVal = 0;

  // First pass: detect if there are any static positions
  sorted.forEach(pos => {
    const isStatic = pos._live !== true;
    const noAPI = pos.ticker === 'SGTM';
    if (isStatic && !noAPI) { hasStatic = true; staticVal += pos.valEUR; } else { liveVal += pos.valEUR; }
  });

  sorted.forEach(pos => {
    totalVal += pos.valEUR;
    totalCost += (pos.costEUR || 0);
    const periodField = { daily: 'dailyPL', mtd: 'mtdPL', oneMonth: 'oneMonthPL', ytd: 'ytdPL' }[_posPeriod];
    totalEvoPL += (pos[periodField] || 0);
    const hasPL = pos.costEUR != null && pos.costEUR > 0;
    const pl = hasPL ? pos.unrealizedPL : null;
    const plC = pl !== null ? (pl >= 0 ? 'pl-pos' : 'pl-neg') : '';
    const plS = pl !== null ? (pl >= 0 ? '+' : '') : '';
    const pctPL = hasPL ? pos.pctPL : null;
    const isStatic = pos._live !== true;
    const noAPI = pos.ticker === 'SGTM';
    const liveBadge = isStatic
      ? (noAPI
        ? ' <span style="display:inline-block;background:#e2e8f0;color:#718096;font-size:8px;font-weight:600;padding:1px 5px;border-radius:8px;vertical-align:middle;margin-left:4px">STATIC</span>'
        : ' <span style="display:inline-block;background:#fed7d7;color:#c53030;font-size:8px;font-weight:600;padding:1px 5px;border-radius:8px;vertical-align:middle;margin-left:4px">STATIC</span>')
      : (hasStatic ? ' <span style="display:inline-block;background:#bee3f8;color:#2b6cb0;font-size:8px;font-weight:600;padding:1px 5px;border-radius:8px;vertical-align:middle;margin-left:4px">LIVE</span>' : '');

    const periodMap = { daily: 'dailyPL', mtd: 'mtdPL', oneMonth: 'oneMonthPL', ytd: 'ytdPL' };
    const periodPctMap = { daily: 'dailyPct', mtd: 'mtdPct', oneMonth: 'oneMonthPct', ytd: 'ytdPct' };
    const ePL = pos[periodMap[_posPeriod]] || null;
    const ePct = pos[periodPctMap[_posPeriod]] || null;
    const evoC = ePL != null ? (ePL >= 0 ? 'pl-pos' : 'pl-neg') : '';
    const evoTxt = ePL != null ? (ePL >= 0 ? '+' : '') + fmt(Math.round(ePL)) : '\u2014';

    // Cell renderers per column key
    const refPriceMap = { daily: pos.price, mtd: pos.mtdOpen, oneMonth: pos.oneMonthOpen, ytd: pos.ytdOpen };
    const refPrice = _posPeriod === 'all' ? null : (refPriceMap[_posPeriod] || pos.price);
    const valeurDebut = refPrice && pos.shares ? Math.round(refPrice * pos.shares) : null;
    const plPeriode = pos[periodMap[_posPeriod]] || null;
    const pctPeriode = pos[periodPctMap[_posPeriod]] || null;
    const plPeriodeC = plPeriode != null ? (plPeriode >= 0 ? 'pl-pos' : 'pl-neg') : '';
    const plPeriodeS = plPeriode != null ? (plPeriode >= 0 ? '+' : '') : '';

    const _cells = {
      broker:  () => '<td>' + (pos.broker || '') + '</td>',
      shares:  () => '<td class="num">' + pos.shares + '</td>',
      prix:    () => '<td class="num">' + (pos.priceLabel || '\u2014') + '</td>',
      valeur:  () => '<td class="num">' + fmt(pos.valEUR) + '</td>',
      valeur_debut: () => '<td class="num">' + (valeurDebut !== null ? fmt(valeurDebut) : '\u2014') + '</td>',
      valeur_actuelle: () => '<td class="num">' + fmt(pos.valEUR) + '</td>',
      pru:     () => '<td class="num">' + (hasPL && pos.shares > 0 ? '\u20ac ' + (pos.costEUR / pos.shares).toFixed(2) : '\u2014') + '</td>',
      cout:    () => '<td class="num">' + (hasPL ? fmt(pos.costEUR) : '\u2014') + '</td>',
      pl:      () => '<td class="num ' + plC + '">' + (pl !== null ? plS + fmt(pl) : '\u2014') + '</td>',
      pl_periode: () => '<td class="num ' + plPeriodeC + '">' + (plPeriode !== null ? plPeriodeS + fmt(Math.round(plPeriode)) : '\u2014') + '</td>',
      pctPL:   () => '<td class="num ' + plC + '">' + (pctPL !== null ? plS + pctPL.toFixed(1) + '%' : '\u2014') + '</td>',
      pctPL_periode: () => '<td class="num ' + plPeriodeC + '">' + (pctPeriode !== null ? plPeriodeS + pctPeriode.toFixed(1) + '%' : '\u2014') + '</td>',
      evo:     () => '<td class="num ' + evoC + '">' + evoTxt + '</td>',
      weight:  () => '<td class="num">' + pos.weight.toFixed(1) + '%</td>',
      sector:  () => '<td>' + (SECTOR_LABELS[pos.sector] || pos.sector || '\u2014') + '</td>',
      geo:     () => '<td>' + (GEO_LABELS[pos.geo] || pos.geo || '\u2014') + '</td>',
    };
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    if (isStatic && !noAPI) tr.style.color = '#718096';
    let rowHtml = '<td>' + pos.label + liveBadge + '</td>';
    colOrder.forEach(k => { const cellFn = _cells[k]; if (cellFn) rowHtml += cellFn(); });
    tr.innerHTML = rowHtml;
    tbody.appendChild(tr);

    // Click handler → expand/collapse trade history
    tr.addEventListener('click', () => {
      const existingDetail = tr.nextElementSibling;
      if (existingDetail && existingDetail.classList.contains('trade-detail-row')) {
        existingDetail.remove();
        _expandedTicker = null;
        tr.style.background = '';
        return;
      }
      // Collapse any other expanded row
      tbody.querySelectorAll('.trade-detail-row').forEach(r => r.remove());
      tbody.querySelectorAll('tr').forEach(r => { if (r.style.fontWeight !== '700') r.style.background = ''; });
      _expandedTicker = pos.ticker;
      tr.style.background = '#f7fafc';

      const trades = (pos._trades || []).filter(t => t.type === 'buy' || t.type === 'sell');
      const colSpan = 1 + _colOrder.filter(k => vis(k)).length;
      const detailTr = document.createElement('tr');
      detailTr.className = 'trade-detail-row';
      detailTr.style.background = '#f7fafc';
      if (trades.length === 0) {
        detailTr.innerHTML = '<td colspan="' + colSpan + '" style="padding:8px 16px;font-size:12px;color:#a0aec0;font-style:italic">Aucun historique d\'achat disponible</td>';
      } else {
        // Compute per-trade P/L using position-level EUR price per share
        const eurPerShare = pos.shares > 0 ? pos.valEUR / pos.shares : 0;
        let _tradeSortKey = 'date', _tradeSortDir = 'asc';
        const enriched = trades.map(t => {
          const valEUR = t.qty * eurPerShare;
          // Cost in EUR: approximate using current FX for non-EUR
          let costEUR = t.cost || 0;
          if (t.currency === 'USD' && _fx.USD) costEUR = t.cost / _fx.USD;
          else if (t.currency === 'MAD' && _fx.MAD) costEUR = t.cost / _fx.MAD;
          else if (t.currency === 'JPY' && _fx.JPY) costEUR = t.cost / _fx.JPY;
          const plEUR = valEUR - costEUR;
          const plPct = costEUR > 0 ? ((valEUR / costEUR - 1) * 100) : null;
          return { ...t, valEUR, costEUR, plEUR, plPct, owner: t.owner || 'Amine' };
        });
        const hasMultiOwner = new Set(enriched.map(t => t.owner)).size > 1;

        // Current unit price label for this position
        const _curPriceLabel = pos.priceLabel || '';

        function renderTradeTable(items) {
          const hPad = 'padding:3px 10px';
          const hPad0 = 'padding:3px 10px 3px 0';
          const sty = 'cursor:pointer;user-select:none';
          let h = '<table style="width:auto;margin:0;font-size:12px;border-collapse:collapse">'
            + '<thead><tr style="color:#718096;font-weight:600">'
            + '<td style="' + hPad0 + ';' + sty + '" data-tsort="date">Date ▾</td>'
            + (hasMultiOwner ? '<td style="' + hPad + ';' + sty + '" data-tsort="owner">Qui</td>' : '')
            + '<td class="num" style="' + hPad + ';' + sty + '" data-tsort="qty">Qté</td>'
            + '<td style="' + hPad + ';' + sty + '" data-tsort="label">Type</td>'
            + '<td class="num" style="' + hPad + ';' + sty + '" data-tsort="costBasis">PRU</td>'
            + '<td class="num" style="' + hPad + '">Prix actuel</td>'
            + '<td class="num" style="' + hPad + ';' + sty + '" data-tsort="valEUR">Valeur</td>'
            + '<td class="num" style="' + hPad + ';' + sty + '" data-tsort="plEUR">P/L</td>'
            + '<td class="num" style="' + hPad + ';' + sty + '" data-tsort="plPct">P/L %</td>'
            + '</tr></thead><tbody>';
          items.forEach(t => {
            const tC = t.type === 'sell' ? 'color:#c53030' : '';
            const typeLabel = t.label || (t.type === 'buy' ? 'Achat' : 'Vente');
            const currSym = t.currency === 'USD' ? '$' : t.currency === 'JPY' ? '\u00a5' : t.currency === 'MAD' ? '' : '\u20ac ';
            const currSuffix = t.currency === 'MAD' ? ' DH' : '';
            const priceTxt = t.costBasis ? currSym + Number(t.costBasis).toFixed(2) + currSuffix : '\u2014';
            const plC = t.plEUR >= 0 ? 'color:#38a169' : 'color:#c53030';
            const plS = t.plEUR >= 0 ? '+' : '';
            h += '<tr style="' + tC + '">'
              + '<td style="' + hPad0 + '">' + t.date + '</td>'
              + (hasMultiOwner ? '<td style="' + hPad + '">' + t.owner + '</td>' : '')
              + '<td class="num" style="' + hPad + '">' + t.qty + '</td>'
              + '<td style="' + hPad + '">' + typeLabel + '</td>'
              + '<td class="num" style="' + hPad + '">' + priceTxt + '</td>'
              + '<td class="num" style="' + hPad + ';color:var(--accent)">' + _curPriceLabel + '</td>'
              + '<td class="num" style="' + hPad + '">' + fmt(Math.round(t.valEUR)) + '</td>'
              + '<td class="num" style="' + hPad + ';' + plC + '">' + plS + fmt(Math.round(t.plEUR)) + '</td>'
              + '<td class="num" style="' + hPad + ';' + plC + '">' + (t.plPct !== null ? plS + t.plPct.toFixed(1) + '%' : '\u2014') + '</td>'
              + '</tr>';
          });
          h += '</tbody></table>';
          return h;
        }

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'padding:8px 16px;font-size:12px';
        wrapper.innerHTML = renderTradeTable(enriched);
        // Make trade table headers sortable
        wrapper.querySelectorAll('[data-tsort]').forEach(th => {
          th.addEventListener('click', () => {
            const sk = th.getAttribute('data-tsort');
            if (_tradeSortKey === sk) _tradeSortDir = _tradeSortDir === 'asc' ? 'desc' : 'asc';
            else { _tradeSortKey = sk; _tradeSortDir = (sk === 'date' || sk === 'owner' || sk === 'label') ? 'asc' : 'desc'; }
            const sorted2 = [...enriched].sort((a, b) => {
              let va = a[sk], vb = b[sk];
              if (typeof va === 'string') { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); return _tradeSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va); }
              va = va || 0; vb = vb || 0;
              return _tradeSortDir === 'asc' ? va - vb : vb - va;
            });
            wrapper.innerHTML = renderTradeTable(sorted2);
            // Re-bind sort on new headers
            wrapper.querySelectorAll('[data-tsort]').forEach(th2 => th2.dispatchEvent || null);
            // Recursive re-bind — simpler: just re-run the click handler setup
            _bindTradeSort(wrapper, enriched);
          });
        });
        function _bindTradeSort(el, data) {
          el.querySelectorAll('[data-tsort]').forEach(th2 => {
            th2.style.cursor = 'pointer';
            th2.addEventListener('click', () => {
              const sk2 = th2.getAttribute('data-tsort');
              if (_tradeSortKey === sk2) _tradeSortDir = _tradeSortDir === 'asc' ? 'desc' : 'asc';
              else { _tradeSortKey = sk2; _tradeSortDir = (sk2 === 'date' || sk2 === 'owner' || sk2 === 'label') ? 'asc' : 'desc'; }
              const s2 = [...data].sort((a, b) => {
                let va = a[sk2], vb = b[sk2];
                if (typeof va === 'string') { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); return _tradeSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va); }
                va = va || 0; vb = vb || 0;
                return _tradeSortDir === 'asc' ? va - vb : vb - va;
              });
              el.innerHTML = renderTradeTable(s2);
              _bindTradeSort(el, data);
            });
          });
        }

        detailTr.innerHTML = '<td colspan="' + colSpan + '" style="padding:0"></td>';
        detailTr.firstChild.appendChild(wrapper);
      }
      tr.after(detailTr);
    });
  });

  // Total row
  const totalPL = totalVal - totalCost;
  const totalPctPL = totalCost > 0 ? (totalPL / totalCost * 100) : 0;
  const tPlC = totalPL >= 0 ? 'pl-pos' : 'pl-neg';
  const tPlS = totalPL >= 0 ? '+' : '';
  let totalEvoTxt = '', totalEvoC = '';
  if (totalEvoPL !== 0) {
    totalEvoC = totalEvoPL >= 0 ? 'pl-pos' : 'pl-neg';
    totalEvoTxt = (totalEvoPL >= 0 ? '+' : '') + fmt(Math.round(totalEvoPL));
  }
  const visCount = 1 + colOrder.length;
  const _totCells = {
    broker:  () => '<td></td>',
    shares:  () => '<td></td>',
    prix:    () => '<td></td>',
    valeur:  () => '<td class="num"><strong>' + fmt(totalVal) + '</strong></td>',
    valeur_debut: () => '<td class="num"><strong>' + fmt(totalVal - totalEvoPL) + '</strong></td>',
    valeur_actuelle: () => '<td class="num"><strong>' + fmt(totalVal) + '</strong></td>',
    pru:     () => '<td></td>',
    cout:    () => '<td class="num"><strong>' + fmt(totalCost) + '</strong></td>',
    pl:      () => '<td class="num ' + tPlC + '"><strong>' + tPlS + fmt(totalPL) + '</strong></td>',
    pl_periode: () => '<td class="num ' + totalEvoC + '"><strong>' + (totalEvoTxt || '\u2014') + '</strong></td>',
    pctPL:   () => '<td class="num ' + tPlC + '"><strong>' + tPlS + totalPctPL.toFixed(1) + '%</strong></td>',
    pctPL_periode: () => '<td class="num ' + totalEvoC + '"><strong>' + (totalEvoPL && totalVal ? (totalEvoPL >= 0 ? '+' : '') + (totalEvoPL / (totalVal - totalEvoPL) * 100).toFixed(1) : '\u2014') + '%</strong></td>',
    evo:     () => '<td class="num ' + totalEvoC + '"><strong>' + (totalEvoTxt || '\u2014') + '</strong></td>',
    weight:  () => '<td class="num">100%</td>',
    sector:  () => '<td></td>',
    geo:     () => '<td></td>',
  };
  const ttr = document.createElement('tr');
  ttr.style.fontWeight = '700'; ttr.style.background = '#edf2f7';
  let totalHtml = '<td><strong>Total (' + sorted.length + ' positions)</strong></td>';
  colOrder.forEach(k => { const cellFn = _totCells[k]; if (cellFn) totalHtml += cellFn(); });
  ttr.innerHTML = totalHtml;
  tbody.appendChild(ttr);

  // Render column chips
  _renderColumnChips(allPositions);

  // Footnote for static prices
  const footnote = document.getElementById('actionsStaticFootnote');
  if (footnote) {
    if (hasStatic) {
      const staticPct = totalVal > 0 ? (staticVal / totalVal * 100).toFixed(0) : 0;
      footnote.textContent = '* Cours statique \u2014 API indisponible, prix de la derni\u00e8re mise \u00e0 jour data.js (' + staticPct + '% du portefeuille soit ' + fmt(staticVal) + ')';
    } else {
      footnote.textContent = '';
    }
  }

  // Asterisk on KPIs when some positions use static prices
  const kpiAsterisk = document.getElementById('kpiStaticWarning');
  if (kpiAsterisk) {
    if (hasStatic) {
      const staticPct = totalVal > 0 ? (staticVal / totalVal * 100).toFixed(0) : 0;
      kpiAsterisk.innerHTML = '* ' + staticPct + '% bas\u00e9 sur donn\u00e9es statiques (' + fmt(staticVal) + ')';
      kpiAsterisk.style.display = '';
    } else {
      kpiAsterisk.style.display = 'none';
    }
  }

  // Update arrow indicators on current table
  if (table) {
    table.querySelectorAll('.sort-arrow').forEach(a => { a.className = 'sort-arrow'; });
    if (sortKey) {
      const active = table.querySelector('th[data-sort="' + sortKey + '"] .sort-arrow');
      if (active) active.className = 'sort-arrow ' + sortDir;
    }
  }

  // Re-bind sort on dynamically rebuilt thead
  if (thead) {
    thead.querySelectorAll('.sortable').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (_allSortKey === key) _allSortDir = _allSortDir === 'asc' ? 'desc' : 'asc';
        else { _allSortKey = key; _allSortDir = (key === 'label' || key === 'broker' || key === 'sector' || key === 'geo') ? 'asc' : 'desc'; }
        renderAllPositions(allPositions, _allSortKey, _allSortDir);
      });
    });
  }
}

/** Render column toggle chips below the table — draggable for reorder */
function _renderColumnChips(allPositions) {
  let container = document.getElementById('colChipsContainer');
  if (!container) {
    const tbl = document.getElementById('allPositionsTable');
    if (!tbl) return;
    container = document.createElement('div');
    container.id = 'colChipsContainer';
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center';
    tbl.parentNode.insertBefore(container, tbl.nextSibling);
  }
  container.innerHTML = '<span style="font-size:10px;color:#a0aec0;margin-right:6px;opacity:0.75">Colonnes :</span>';
  let _dragKey = null;
  _colOrder.forEach(key => {
    const cfg = _colConfig[key];
    const active = _isColVisible(key);
    const chip = document.createElement('button');
    chip.setAttribute('data-col', key);
    chip.draggable = true;
    chip.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #e7e5e4;cursor:grab;transition:all .15s;opacity:0.8;'
      + (active ? 'background:#2d3748;color:#fff;border-color:#2d3748;opacity:1' : 'background:#fff;color:#78716c');
    chip.textContent = cfg.label;

    // Click: toggle visibility
    chip.addEventListener('click', () => {
      _colConfig[key].on = !_colConfig[key].on;
      renderAllPositions(allPositions, _allSortKey, _allSortDir);
    });

    // Drag & drop for reorder
    chip.addEventListener('dragstart', (e) => {
      _dragKey = key;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
      chip.style.opacity = '0.4';
    });
    chip.addEventListener('dragend', () => { chip.style.opacity = '1'; _dragKey = null; });
    chip.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; chip.style.borderColor = '#4299e1'; chip.style.boxShadow = '0 0 0 2px rgba(66,153,225,0.4)'; });
    chip.addEventListener('dragleave', () => { chip.style.borderColor = active ? '#2d3748' : '#cbd5e0'; chip.style.boxShadow = 'none'; });
    chip.addEventListener('drop', (e) => {
      e.preventDefault();
      chip.style.borderColor = active ? '#2d3748' : '#cbd5e0';
      chip.style.boxShadow = 'none';
      const draggedKey = e.dataTransfer.getData('text/plain');
      if (!draggedKey || draggedKey === key) return;
      const fromIdx = _colOrder.indexOf(draggedKey);
      const toIdx = _colOrder.indexOf(key);
      if (fromIdx < 0 || toIdx < 0) return;
      _colOrder.splice(fromIdx, 1);
      _colOrder.splice(toIdx, 0, draggedKey);
      renderAllPositions(allPositions, _allSortKey, _allSortDir);
    });

    container.appendChild(chip);
  });
}

function setupAllPositionsSort(allPositions) {
  // Toggle Unitaire / Total + Period
  function setupToggle(id, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        setter(btn);
        el.querySelectorAll('button').forEach(b => {
          if (b === btn) { b.style.background = '#2d3748'; b.style.color = '#fff'; }
          else { b.style.background = '#fff'; b.style.color = '#4a5568'; }
        });
        renderAllPositions(allPositions, _allSortKey, _allSortDir);
      });
    });
  }
  setupToggle('posViewToggle', btn => {
    const m = btn.getAttribute('data-mode');
    _posViewMode = m;
    if (m === 'total') {
      _colConfig.valeur.on = true;  _colConfig.prix.on = false;
      _colConfig.cout.on = true;    _colConfig.pru.on = false;
      _colConfig.pl.on = true;      _colConfig.pctPL.on = true;
    } else {
      _colConfig.valeur.on = false; _colConfig.prix.on = true;
      _colConfig.cout.on = false;   _colConfig.pru.on = true;
      _colConfig.pl.on = false;     _colConfig.pctPL.on = false;
    }
  });
  setupToggle('posPeriodToggle', btn => {
    _posPeriod = btn.getAttribute('data-period');
    // If user was sorting by an evo/period column, update the sort key to match new period
    const periodSortKeys = ['dailyPct', 'mtdPct', 'oneMonthPct', 'ytdPct', 'dailyPL', 'mtdPL', 'oneMonthPL', 'ytdPL'];
    if (_allSortKey && periodSortKeys.includes(_allSortKey)) {
      const isPct = _allSortKey.endsWith('Pct');
      const pctMap = { daily: 'dailyPct', mtd: 'mtdPct', oneMonth: 'oneMonthPct', ytd: 'ytdPct' };
      const plMap = { daily: 'dailyPL', mtd: 'mtdPL', oneMonth: 'oneMonthPL', ytd: 'ytdPL' };
      _allSortKey = isPct ? pctMap[_posPeriod] : plMap[_posPeriod];
    }
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
  // Add % vs deposits for unrealized P/L
  const unrealPct = av.totalDeposits > 0 ? (av.combinedUnrealizedPL / av.totalDeposits * 100) : 0;
  setSubPct('kpiActionsUnrealizedPL', unrealPct);

  const rplCls = av.combinedRealizedPL >= 0 ? 'pl-pos' : 'pl-neg';
  const rplSign = av.combinedRealizedPL >= 0 ? '+' : '';
  setText('kpiActionsRealizedPL', rplSign + fmt(av.combinedRealizedPL));
  document.getElementById('kpiActionsRealizedPL')?.classList.add(rplCls);
  // Add % vs deposits for realized P/L
  const realPct = av.totalDeposits > 0 ? (av.combinedRealizedPL / av.totalDeposits * 100) : 0;
  setSubPct('kpiActionsRealizedPL', realPct);

  setText('kpiActionsTotalDeposits', fmt(av.totalDeposits));
  setText('kpiActionsDividends', fmt(av.dividends));
  setText('kpiActionsTWR', 'TWR +' + av.twr.toFixed(1) + '%');

  // Period P&L KPIs (Daily, MTD, 1M, YTD)
  if (av.periodPL) {
    [
      { id: 'kpiPLDaily', data: av.periodPL.daily },
      { id: 'kpiPLMTD', data: av.periodPL.mtd },
      { id: 'kpiPL1M', data: av.periodPL.oneMonth },
      { id: 'kpiPLYTD', data: av.periodPL.ytd },
    ].forEach(p => {
      const el = document.getElementById(p.id);
      if (!el) return;
      if (!p.data.hasData) { el.textContent = '--'; return; }
      const v = Math.round(p.data.total);
      const sign = v >= 0 ? '+' : '';
      el.textContent = sign + fmt(v);
      el.className = 'value ' + (v >= 0 ? 'pl-pos' : 'pl-neg');
      // Add % vs total portfolio
      const pct = av.totalStocks > 0 ? (p.data.total / av.totalStocks * 100) : 0;
      setSubPct(p.id, pct);
    });
  }

  // Build unified positions array (IBKR + ESPP + SGTM)
  const totalAllVal = av.totalStocks;
  const pctFromRef = (price, ref) => (ref && ref > 0 && price > 0) ? ((price - ref) / ref * 100) : null;
  const allTrades = av.trades || [];
  const allPositions = av.ibkrPositions.map(p => ({
    ...p,
    broker: 'IBKR',
    weight: totalAllVal > 0 ? (p.valEUR / totalAllVal * 100) : 0,
    dailyPct: pctFromRef(p.price, p.previousClose),
    mtdPct: pctFromRef(p.price, p.mtdOpen),
    ytdPct: pctFromRef(p.price, p.ytdOpen),
    oneMonthPct: pctFromRef(p.price, p.oneMonthAgo),
    _trades: allTrades.filter(t => t.ticker === p.ticker).map(t => ({ ...t, owner: 'Amine' })),
  }));

  // ESPP Accenture (Amine + Nezha merged) — build trade history from lots
  const p = state.portfolio;
  const esppLotsAmine = (p.amine.espp.lots || []).map(l => ({
    date: l.date, type: 'buy', ticker: 'ACN', qty: l.shares,
    costBasis: l.costBasis, currency: 'USD', cost: l.shares * l.costBasis,
    label: 'ESPP (' + l.source + ')', owner: 'Amine',
  }));
  const esppLotsNezha = (p.nezha && p.nezha.espp && p.nezha.espp.lots || []).map(l => ({
    date: l.date, type: 'buy', ticker: 'ACN', qty: l.shares,
    costBasis: l.costBasis, currency: 'USD', cost: l.shares * l.costBasis,
    label: 'ESPP (' + l.source + ')', owner: 'Nezha',
  }));
  const esppAllTrades = [...esppLotsAmine, ...esppLotsNezha];

  const esppTotalShares = av.esppShares + (av.nezhaEsppShares || 0);
  const esppTotalVal = av.esppCurrentVal + (av.nezhaEsppCurrentVal || 0);
  const esppTotalCost = av.esppCostBasisEUR + (av.nezhaEsppCostBasisEUR || 0);
  const esppTotalPL = av.esppUnrealizedPL + (av.nezhaEsppUnrealizedPL || 0);
  // Compute ESPP period P&L (approximate from breakdown when available, else from ref prices)
  const esppPeriodPL = (period) => {
    const bd = av.periodPL[period]?.breakdown;
    if (bd) { const acnItems = bd.filter(b => b.ticker === 'ACN'); if (acnItems.length) return acnItems.reduce((s, b) => s + b.pl, 0); }
    return null;
  };
  allPositions.push({
    label: 'Accenture (' + esppTotalShares + ' ACN)',
    broker: 'UBS (ESPP)',
    ticker: 'ACN',
    shares: esppTotalShares,
    price: av.esppPrice,
    previousClose: av.acnPreviousClose,
    priceLabel: '$' + av.esppPrice.toFixed(2),
    costEUR: esppTotalCost,
    valEUR: esppTotalVal,
    unrealizedPL: esppTotalPL,
    pctPL: esppTotalCost > 0 ? (esppTotalPL / esppTotalCost * 100) : 0,
    dailyPL: esppPeriodPL('daily'),
    mtdPL: esppPeriodPL('mtd'),
    ytdPL: esppPeriodPL('ytd'),
    oneMonthPL: esppPeriodPL('oneMonth'),
    dailyPct: pctFromRef(av.esppPrice, av.acnPreviousClose),
    mtdPct: pctFromRef(av.esppPrice, av.acnMtdOpen),
    ytdPct: pctFromRef(av.esppPrice, av.acnYtdOpen),
    oneMonthPct: pctFromRef(av.esppPrice, av.acnOneMonthAgo),
    weight: totalAllVal > 0 ? (esppTotalVal / totalAllVal * 100) : 0,
    sector: 'tech',
    geo: 'us',
    _live: av._acnLive,
    _trades: esppAllTrades,
  });

  // ESPP Cash moved to cashView (v91) — no longer shown in Actions table

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
    previousClose: null,
    priceLabel: av.sgtmPriceMAD + ' DH',
    costEUR: sgtmCostBasis,
    valEUR: sgtmTotalVal,
    unrealizedPL: sgtmPL,
    pctPL: sgtmCostBasis > 0 ? (sgtmPL / sgtmCostBasis * 100) : null,
    dailyPL: null,
    dailyPct: null,
    weight: totalAllVal > 0 ? (sgtmTotalVal / totalAllVal * 100) : 0,
    sector: 'materials',
    geo: 'morocco',
    _live: av._sgtmLive,
    _trades: [
      ...(p.amine.sgtm.shares > 0 ? [{ date: '2025-12-01', type: 'buy', ticker: 'SGTM', qty: p.amine.sgtm.shares, costBasis: p.market.sgtmCostBasisMAD || 420, currency: 'MAD', cost: p.amine.sgtm.shares * (p.market.sgtmCostBasisMAD || 420), label: 'IPO', owner: 'Amine' }] : []),
      ...(p.nezha.sgtm.shares > 0 ? [{ date: '2025-12-01', type: 'buy', ticker: 'SGTM', qty: p.nezha.sgtm.shares, costBasis: p.market.sgtmCostBasisMAD || 420, currency: 'MAD', cost: p.nezha.sgtm.shares * (p.market.sgtmCostBasisMAD || 420), label: 'IPO', owner: 'Nezha' }] : []),
    ],
  });

  // Add pruEUR for sorting
  allPositions.forEach(p => { p.pruEUR = p.costEUR && p.shares > 0 ? p.costEUR / p.shares : 0; });

  // Render unified table
  renderAllPositions(allPositions, null, null);
  setupAllPositionsSort(allPositions);

  // Closed positions
  const closedTbody = document.getElementById('actionsClosedTbody');
  const closedTable = document.getElementById('actionsClosedTable');
  if (closedTbody) {
    const closedData = av.closedPositions.map(cp => ({ ...cp, label: cp.label + ' (' + cp.ticker + ')' }));
    let _expandedClosed = null;
    function renderClosedRows(items) {
      closedTbody.innerHTML = '';
      let totalClosed = 0, totalIfHeld = 0, totalIfHeldDiff = 0, totalProceeds = 0;
      items.forEach(cp => {
        totalClosed += cp.pl;
        totalProceeds += (cp.proceedsEUR || 0);
        // "Si gardé auj." columns for main row
        const ifHeldVal = cp._ifHeldValueEUR || 0;
        const diffVsSale = ifHeldVal - (cp.proceedsEUR || 0);
        const pctVsSale = (cp.proceedsEUR || 0) > 0 ? (diffVsSale / (cp.proceedsEUR || 1) * 100) : 0;
        if (ifHeldVal) { totalIfHeld += ifHeldVal; totalIfHeldDiff += diffVsSale; }
        cp._ifHeldPLvsProceeds = diffVsSale;
        cp._ifHeldPctVsSale = pctVsSale;
        const cls = cp.pl >= 0 ? 'pl-pos' : 'pl-neg';
        const s = cp.pl >= 0 ? '+' : '';
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        let ifHeldCols = '';
        if (ifHeldVal) {
          const dCls = diffVsSale >= 0 ? 'pl-pos' : 'pl-neg';
          const dS = diffVsSale >= 0 ? '+' : '';
          const pS = pctVsSale >= 0 ? '+' : '';
          ifHeldCols = '<td class="num">' + fmt(Math.round(ifHeldVal)) + '</td>'
            + '<td class="num ' + dCls + '">' + dS + fmt(Math.round(diffVsSale)) + '</td>'
            + '<td class="num ' + dCls + '">' + pS + pctVsSale.toFixed(0) + '%</td>';
        } else {
          ifHeldCols = '<td class="num">\u2014</td><td class="num">\u2014</td><td class="num">\u2014</td>';
        }
        tr.innerHTML = '<td>' + cp.label + '</td><td class="num ' + cls + '">' + s + fmt(cp.pl) + '</td>' + ifHeldCols;
        tr.addEventListener('click', () => {
          closedTbody.querySelectorAll('.closed-detail-row').forEach(r => r.remove());
          closedTbody.querySelectorAll('tr').forEach(r => { if (r.style.fontWeight !== '700') r.style.background = ''; });
          if (_expandedClosed === cp.ticker) { _expandedClosed = null; return; }
          _expandedClosed = cp.ticker;
          tr.style.background = '#f7fafc';
          const trades = cp._allTrades || [];
          const detailTr = document.createElement('tr');
          detailTr.className = 'closed-detail-row';
          detailTr.style.background = '#f7fafc';
          if (trades.length === 0) {
            detailTr.innerHTML = '<td colspan="5" style="padding:8px 16px;font-size:12px;color:#a0aec0;font-style:italic">Aucun détail disponible</td>';
          } else {
            const hp = 'padding:3px 10px';
            let h = '<td colspan="5" style="padding:4px 16px"><table style="width:auto;margin:0;font-size:12px;border-collapse:collapse">'
              + '<thead><tr style="color:#718096;font-weight:600">'
              + '<td style="' + hp + '">Date</td><td style="' + hp + '">Type</td>'
              + '<td class="num" style="' + hp + '">Qté</td><td class="num" style="' + hp + '">Prix</td>'
              + '<td class="num" style="' + hp + '">Montant</td>'
              + '<td class="num" style="' + hp + '">Valeur auj.</td>'
              + '<td class="num" style="' + hp + '">+/- value</td>'
              + '<td class="num" style="' + hp + '">%</td>'
              + '</tr></thead><tbody>';
            trades.forEach(t => {
              const isSell = t.type === 'sell';
              const tColor = isSell ? 'color:#c53030' : '';
              const amt = isSell ? (t.proceeds || 0) : (t.cost || 0);
              const amtLabel = fmt(Math.round(amt));
              let ifHeldDetailCols = '<td class="num" style="' + hp + '">\u2014</td><td class="num" style="' + hp + '">\u2014</td><td class="num" style="' + hp + '">\u2014</td>';
              if (isSell && cp._ifHeldPriceEUR && t.qty) {
                const hypothetical = t.qty * (t.splitFactor || 1) * cp._ifHeldPriceEUR;
                const diff = hypothetical - amt;
                const pct = amt > 0 ? (diff / amt * 100) : 0;
                const diffCls = diff >= 0 ? 'color:#38a169' : 'color:#c53030';
                const diffS = diff >= 0 ? '+' : '';
                const pctS = pct >= 0 ? '+' : '';
                ifHeldDetailCols = '<td class="num" style="' + hp + '">' + fmt(Math.round(hypothetical)) + '</td>'
                  + '<td class="num" style="' + hp + ';' + diffCls + '">' + diffS + fmt(Math.round(diff)) + '</td>'
                  + '<td class="num" style="' + hp + ';' + diffCls + '">' + pctS + pct.toFixed(0) + '%</td>';
              }
              let unitPrice = t.price;
              if (!unitPrice && t.qty) {
                unitPrice = isSell ? (t.proceeds || 0) / t.qty : (t.cost || 0) / t.qty;
              }
              const currSym = t.currency === 'USD' ? '$' : t.currency === 'MAD' ? '' : '\u20ac ';
              const currSuffix = t.currency === 'MAD' ? ' DH' : '';
              const priceTxt = unitPrice ? currSym + Number(unitPrice).toFixed(2) + currSuffix : '\u2014';
              h += '<tr style="' + tColor + '">'
                + '<td style="' + hp + '">' + t.date + '</td>'
                + '<td style="' + hp + '">' + (isSell ? 'Vente' : 'Achat') + '</td>'
                + '<td class="num" style="' + hp + '">' + (t.qty || '') + '</td>'
                + '<td class="num" style="' + hp + '">' + priceTxt + '</td>'
                + '<td class="num" style="' + hp + '">' + amtLabel + '</td>'
                + ifHeldDetailCols
                + '</tr>';
            });
            if (cp._ifHeldValueEUR) {
              const diff = cp._ifHeldValueEUR - cp.proceedsEUR;
              const pct = cp.proceedsEUR > 0 ? (diff / cp.proceedsEUR * 100) : 0;
              const diffCls = diff >= 0 ? 'color:#38a169' : 'color:#c53030';
              const diffS = diff >= 0 ? '+' : '';
              const pctS = pct >= 0 ? '+' : '';
              h += '<tr style="font-weight:600;background:#edf2f7"><td colspan="4" style="' + hp + '">Total si gard\u00e9</td>'
                + '<td class="num" style="' + hp + '">' + fmt(Math.round(cp.proceedsEUR)) + '</td>'
                + '<td class="num" style="' + hp + '">' + fmt(Math.round(cp._ifHeldValueEUR)) + '</td>'
                + '<td class="num" style="' + hp + ';' + diffCls + '">' + diffS + fmt(Math.round(diff)) + '</td>'
                + '<td class="num" style="' + hp + ';' + diffCls + '">' + pctS + pct.toFixed(0) + '%</td></tr>';
            }
            h += '</tbody></table></td>';
            detailTr.innerHTML = h;
          }
          tr.after(detailTr);
        });
        closedTbody.appendChild(tr);
      });
      const tr = document.createElement('tr');
      tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
      const cls = totalClosed >= 0 ? 'pl-pos' : 'pl-neg';
      const ts = totalClosed >= 0 ? '+' : '';
      let totalIfHeldCols = '';
      if (totalIfHeld > 0) {
        const tDCls = totalIfHeldDiff >= 0 ? 'pl-pos' : 'pl-neg';
        const tDS = totalIfHeldDiff >= 0 ? '+' : '';
        const tPct = totalProceeds > 0 ? (totalIfHeldDiff / totalProceeds * 100) : 0;
        const tPS = tPct >= 0 ? '+' : '';
        totalIfHeldCols = '<td class="num"><strong>' + fmt(Math.round(totalIfHeld)) + '</strong></td>'
          + '<td class="num ' + tDCls + '"><strong>' + tDS + fmt(Math.round(totalIfHeldDiff)) + '</strong></td>'
          + '<td class="num ' + tDCls + '"><strong>' + tPS + tPct.toFixed(0) + '%</strong></td>';
      } else {
        totalIfHeldCols = '<td class="num">\u2014</td><td class="num">\u2014</td><td class="num">\u2014</td>';
      }
      tr.innerHTML = '<td><strong>Total</strong></td><td class="num ' + cls + '"><strong>' + ts + fmt(totalClosed) + '</strong></td>' + totalIfHeldCols;
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

  // Degiro closed positions (expandable, Top 10 by default)
  const degiroTbody = document.getElementById('degiroClosedTbody');
  const degiroTable = document.getElementById('degiroClosedTable');
  if (degiroTbody) {
    let _expandedDegiroClosed = null;
    let _degiroShowAll = false;
    const DEGIRO_TOP_N = 10;
    function renderDegiroRows(items) {
      degiroTbody.innerHTML = '';
      // Always compute totals on ALL items, but only render visible rows
      let totalCost = 0, totalProceeds = 0, totalDegiro = 0, totalIfHeld = 0, totalIfHeldDiff = 0;
      items.forEach(cp => {
        totalCost += (cp.costEUR || 0);
        totalProceeds += (cp.proceedsEUR || 0);
        totalDegiro += cp.pl;
        const ifHeldVal = cp._ifHeldValueEUR || 0;
        const diffVsSale = ifHeldVal - (cp.proceedsEUR || 0);
        if (ifHeldVal) { totalIfHeld += ifHeldVal; totalIfHeldDiff += diffVsSale; }
      });
      // Determine visible rows
      const visibleItems = _degiroShowAll ? items : items.slice(0, DEGIRO_TOP_N);
      const hiddenCount = items.length - visibleItems.length;
      visibleItems.forEach(cp => {
        // "Si gardé auj." columns
        const ifHeldVal = cp._ifHeldValueEUR || 0;
        const diffVsSale = ifHeldVal - (cp.proceedsEUR || 0);
        const pctVsSale = (cp.proceedsEUR || 0) > 0 ? (diffVsSale / (cp.proceedsEUR || 1) * 100) : 0;
        // Store computed values for sorting
        cp._ifHeldPLvsProceeds = diffVsSale;
        cp._ifHeldPctVsSale = pctVsSale;
        const cls = cp.pl >= 0 ? 'pl-pos' : 'pl-neg';
        const s = cp.pl >= 0 ? '+' : '';
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        // If held columns
        let ifHeldCols = '';
        if (ifHeldVal) {
          const dCls = diffVsSale >= 0 ? 'pl-pos' : 'pl-neg';
          const dS = diffVsSale >= 0 ? '+' : '';
          const pS = pctVsSale >= 0 ? '+' : '';
          ifHeldCols = '<td class="num">' + fmt(Math.round(ifHeldVal)) + '</td>'
            + '<td class="num ' + dCls + '">' + dS + fmt(Math.round(diffVsSale)) + '</td>'
            + '<td class="num ' + dCls + '">' + pS + pctVsSale.toFixed(0) + '%</td>';
        } else {
          ifHeldCols = '<td class="num">\u2014</td><td class="num">\u2014</td><td class="num">\u2014</td>';
        }
        const naCss = 'color:#cbd5e0;font-size:11px';
        const costCell = cp.hasCost ? fmt(cp.costEUR) : '<span style="' + naCss + '">n/a</span>';
        const plCell = cp.hasCost ? (s + fmt(cp.pl)) : '<span style="' + naCss + '">n/a</span>';
        const plCls = cp.hasCost ? cls : '';
        tr.innerHTML = '<td>' + cp.label + '</td><td class="num">' + costCell + '</td><td class="num">' + fmt(cp.proceedsEUR || 0) + '</td><td class="num ' + plCls + '">' + plCell + '</td>' + ifHeldCols;
        tr.addEventListener('click', () => {
          degiroTbody.querySelectorAll('.closed-detail-row').forEach(r => r.remove());
          degiroTbody.querySelectorAll('tr').forEach(r => { if (r.style.fontWeight !== '700') r.style.background = ''; });
          if (_expandedDegiroClosed === cp.ticker) { _expandedDegiroClosed = null; return; }
          _expandedDegiroClosed = cp.ticker;
          tr.style.background = '#f7fafc';
          const trades = cp._allTrades || [];
          const detailTr = document.createElement('tr');
          detailTr.className = 'closed-detail-row';
          detailTr.style.background = '#f7fafc';
          if (trades.length === 0) {
            detailTr.innerHTML = '<td colspan="4" style="padding:8px 16px;font-size:12px;color:#a0aec0;font-style:italic">Aucun d\u00e9tail disponible</td>';
          } else {
            const hp = 'padding:3px 10px';
            let h = '<td colspan="7" style="padding:4px 16px"><table style="width:auto;margin:0;font-size:12px;border-collapse:collapse">'
              + '<thead><tr style="color:#718096;font-weight:600">'
              + '<td style="' + hp + '">Date</td><td style="' + hp + '">Type</td>'
              + '<td class="num" style="' + hp + '">Qt\u00e9</td><td class="num" style="' + hp + '">Prix</td>'
              + '<td class="num" style="' + hp + '">Montant</td>'
              + '<td class="num" style="' + hp + '">Valeur auj.</td>'
              + '<td class="num" style="' + hp + '">+/- value</td>'
              + '<td class="num" style="' + hp + '">%</td>'
              + '</tr></thead><tbody>';
            trades.forEach(t => {
              const isSell = t.type === 'sell';
              const tColor = isSell ? 'color:#c53030' : '';
              const amt = isSell ? (t.proceeds || 0) : (t.cost || 0);
              const amtLabel = fmt(Math.round(amt));
              let ifHeldCols = '<td class="num" style="' + hp + '">\u2014</td><td class="num" style="' + hp + '">\u2014</td><td class="num" style="' + hp + '">\u2014</td>';
              if (isSell && cp._ifHeldPriceEUR && t.qty) {
                const hypothetical = t.qty * (t.splitFactor || 1) * cp._ifHeldPriceEUR;
                const diff = hypothetical - amt;
                const pct = amt > 0 ? (diff / amt * 100) : 0;
                const diffCls = diff >= 0 ? 'color:#38a169' : 'color:#c53030';
                const diffS = diff >= 0 ? '+' : '';
                const pctS = pct >= 0 ? '+' : '';
                ifHeldCols = '<td class="num" style="' + hp + '">' + fmt(Math.round(hypothetical)) + '</td>'
                  + '<td class="num" style="' + hp + ';' + diffCls + '">' + diffS + fmt(Math.round(diff)) + '</td>'
                  + '<td class="num" style="' + hp + ';' + diffCls + '">' + pctS + pct.toFixed(0) + '%</td>';
              }
              // Calculate unit price: use t.price, or derive from amount/qty
              let unitPrice = t.price;
              if (!unitPrice && t.qty) {
                unitPrice = isSell ? (t.proceeds || 0) / t.qty : (t.cost || 0) / t.qty;
              }
              const currSym = t.currency === 'USD' ? '$' : t.currency === 'MAD' ? '' : '\u20ac ';
              const currSuffix = t.currency === 'MAD' ? ' DH' : '';
              const priceTxt = unitPrice ? currSym + Number(unitPrice).toFixed(2) + currSuffix : '\u2014';
              h += '<tr style="' + tColor + '">'
                + '<td style="' + hp + '">' + t.date + '</td>'
                + '<td style="' + hp + '">' + (isSell ? 'Vente' : 'Achat') + '</td>'
                + '<td class="num" style="' + hp + '">' + (t.qty || '') + '</td>'
                + '<td class="num" style="' + hp + '">' + priceTxt + '</td>'
                + '<td class="num" style="' + hp + '">' + amtLabel + '</td>'
                + ifHeldCols
                + '</tr>';
            });
            if (cp._ifHeldValueEUR) {
              const diff = cp._ifHeldValueEUR - (cp.proceedsEUR || 0);
              const pct = (cp.proceedsEUR || 0) > 0 ? (diff / (cp.proceedsEUR || 1) * 100) : 0;
              const diffCls = diff >= 0 ? 'color:#38a169' : 'color:#c53030';
              const diffS = diff >= 0 ? '+' : '';
              const pctS = pct >= 0 ? '+' : '';
              h += '<tr style="font-weight:600;background:#edf2f7"><td colspan="4" style="' + hp + '">Total si gard\u00e9</td>'
                + '<td class="num" style="' + hp + '">' + fmt(Math.round(cp.proceedsEUR || 0)) + '</td>'
                + '<td class="num" style="' + hp + '">' + fmt(Math.round(cp._ifHeldValueEUR)) + '</td>'
                + '<td class="num" style="' + hp + ';' + diffCls + '">' + diffS + fmt(Math.round(diff)) + '</td>'
                + '<td class="num" style="' + hp + ';' + diffCls + '">' + pctS + pct.toFixed(0) + '%</td></tr>';
            }
            h += '</tbody></table></td>';
            detailTr.innerHTML = h;
          }
          tr.after(detailTr);
        });
        degiroTbody.appendChild(tr);
      });
      // "Voir tout" / "Top 10" toggle button
      if (items.length > DEGIRO_TOP_N) {
        const toggleTr = document.createElement('tr');
        toggleTr.style.cursor = 'pointer';
        const btnLabel = _degiroShowAll ? 'Top ' + DEGIRO_TOP_N + ' \u25B2' : 'Voir les ' + items.length + ' positions \u25BC';
        toggleTr.innerHTML = '<td colspan="7" style="text-align:center;padding:10px;color:#4a7cbc;font-size:13px;font-weight:500">' + btnLabel + '</td>';
        toggleTr.addEventListener('click', () => {
          _degiroShowAll = !_degiroShowAll;
          renderDegiroRows(items);
        });
        degiroTbody.appendChild(toggleTr);
      }
      const tr = document.createElement('tr');
      tr.style.fontWeight = '700'; tr.style.background = '#edf2f7';
      const cls = totalDegiro >= 0 ? 'pl-pos' : 'pl-neg';
      const ds = totalDegiro >= 0 ? '+' : '';
      // Total "si gardé" columns
      let totalIfHeldCols = '';
      if (totalIfHeld > 0) {
        const tDCls = totalIfHeldDiff >= 0 ? 'pl-pos' : 'pl-neg';
        const tDS = totalIfHeldDiff >= 0 ? '+' : '';
        const tPct = totalProceeds > 0 ? (totalIfHeldDiff / totalProceeds * 100) : 0;
        const tPS = tPct >= 0 ? '+' : '';
        totalIfHeldCols = '<td class="num"><strong>' + fmt(Math.round(totalIfHeld)) + '</strong></td>'
          + '<td class="num ' + tDCls + '"><strong>' + tDS + fmt(Math.round(totalIfHeldDiff)) + '</strong></td>'
          + '<td class="num ' + tDCls + '"><strong>' + tPS + tPct.toFixed(0) + '%</strong></td>';
      } else {
        totalIfHeldCols = '<td class="num">\u2014</td><td class="num">\u2014</td><td class="num">\u2014</td>';
      }
      tr.innerHTML = '<td><strong>Total Degiro</strong></td><td class="num"><strong>' + fmt(totalCost) + '</strong></td><td class="num"><strong>' + fmt(totalProceeds) + '</strong></td><td class="num ' + cls + '"><strong>' + ds + fmt(totalDegiro) + '</strong></td>' + totalIfHeldCols;
      degiroTbody.appendChild(tr);
    }
    // Default sort: proceeds descending (biggest trades first for Top 10)
    av.degiroClosedPositions.sort((a, b) => (b.proceedsEUR || 0) - (a.proceedsEUR || 0));
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
        const ibkrYtd = b.ibkr.ytdPct;
        const totalYtd = b.total.ytdPct;
        const twr = b.ibkr.twr;
        html += '<div style="font-size:12px;color:#718096;margin-bottom:8px;">Donn\u00e9es au ' + b.date + '</div>';
        // Portfolio Total line
        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:2px solid var(--accent);">';
        html += '<span style="flex:1;font-size:13px;font-weight:700;">' + b.total.label + '</span>';
        html += '<span style="font-size:16px;font-weight:700;color:' + (totalYtd >= 0 ? 'var(--green)' : '#e53e3e') + ';">' + (totalYtd >= 0 ? '+' : '') + totalYtd.toFixed(1) + '%</span></div>';
        // IBKR line
        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:2px solid var(--accent);opacity:0.85;">';
        html += '<span style="flex:1;font-size:12px;font-weight:600;color:#4a5568;">' + b.ibkr.label + ' <span style="font-weight:400;font-size:10px;color:#718096;">(TWR ' + (twr >= 0 ? '+' : '') + twr.toFixed(1) + '%)</span></span>';
        html += '<span style="font-size:14px;font-weight:700;color:' + (ibkrYtd >= 0 ? 'var(--green)' : '#e53e3e') + ';">' + (ibkrYtd >= 0 ? '+' : '') + ibkrYtd.toFixed(1) + '%</span></div>';
        // Benchmark bars
        b.items.forEach(function(item) {
          var barColor = item.ytd >= 0 ? '#22c55e' : '#ef4444';
          var barWidth = Math.min(Math.abs(item.ytd) * 2.5, 100);
          var beat = totalYtd > item.ytd;
          html += '<div style="padding:5px 0;border-bottom:1px solid #edf2f7;">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">';
          html += '<span>' + item.label + (beat ? ' \u2714' : '') + '</span>';
          html += '<span style="font-weight:600;color:' + barColor + ';">' + (item.ytd >= 0 ? '+' : '') + item.ytd.toFixed(1) + '%</span></div>';
          html += '<div style="background:#edf2f7;border-radius:3px;height:6px;margin-top:3px;">';
          html += '<div style="width:' + barWidth + '%;height:100%;background:' + barColor + ';border-radius:3px;"></div></div>';
          html += '<div style="font-size:10px;color:#a0aec0;margin-top:2px;">' + item.note + '</div>';
          html += '</div>';
        });
        // Summary — use total portfolio for comparison
        var beaten = b.items.filter(function(i) { return totalYtd > i.ytd; }).length;
        html += '<div style="margin-top:10px;padding:8px;background:' + (beaten >= 4 ? '#f0fff4' : '#fffff0') + ';border-radius:6px;font-size:12px;">';
        html += (beaten >= 4 ? '\uD83C\uDFC6' : '\uD83D\uDCCA') + ' Portefeuille bat <strong>' + beaten + '/' + b.items.length + '</strong> benchmarks. ';
        if (totalYtd < b.items[1].ytd) html += 'Sous-performe le S&P 500 \u2014 consid\u00e9rer plus d\'exposition US via ETF (VOO/CSPX).';
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

  // ── Clickable KPI detail panels ──────────────────────────
  setupKPIDetailPanels(state);
}

/**
 * Setup clickable KPI detail panels for Actions view
 * Each KPI card expands a panel showing per-ticker breakdown
 */
function setupKPIDetailPanels(state) {
  const av = state.actionsView;
  const panel = document.getElementById('kpiDetailPanel');
  if (!panel) return;
  let activeKPI = null;

  // Build all positions list for unrealized P&L breakdown
  const allPos = av.ibkrPositions.map(p => ({ ...p, broker: 'IBKR' }));
  // Merge ACN Amine + Nezha into single entry
  const acnTotalVal = av.esppCurrentVal + (av.nezhaEsppCurrentVal || 0);
  const acnTotalCost = av.esppCostBasisEUR + (av.nezhaEsppCostBasisEUR || 0);
  const acnTotalPL = av.esppUnrealizedPL + (av.nezhaEsppUnrealizedPL || 0);
  allPos.push({
    label: 'Accenture (ACN)', ticker: 'ACN', broker: 'ESPP',
    valEUR: acnTotalVal, costEUR: acnTotalCost,
    unrealizedPL: acnTotalPL,
    pctPL: acnTotalCost > 0 ? (acnTotalPL / acnTotalCost * 100) : 0,
  });
  if (av.sgtmCostBasisEUR != null) {
    const sgtmPL = av.sgtmTotal - av.sgtmCostBasisEUR;
    allPos.push({
      label: 'SGTM (x' + (av.sgtmAmineShares + av.sgtmNezhaShares) + ')', ticker: 'SGTM', broker: 'Attijari',
      valEUR: av.sgtmTotal, costEUR: av.sgtmCostBasisEUR,
      unrealizedPL: sgtmPL,
      pctPL: av.sgtmCostBasisEUR > 0 ? (sgtmPL / av.sgtmCostBasisEUR * 100) : 0,
    });
  }

  // Helper: render a P&L breakdown in two columns (losers | gainers)
  function renderPLBreakdown(items, total, footer) {
    if (!items || items.length === 0) return '<div style="padding:20px;text-align:center;color:#a0aec0;">Pas de données</div>';
    // Filter out near-zero P&L (e.g. European stocks when market is closed)
    const threshold = 0.5;
    const filtered = items.filter(i => Math.abs(i.pl) >= threshold);
    const skipped = items.length - filtered.length;
    const losers = filtered.filter(i => i.pl < 0).sort((a, b) => a.pl - b.pl); // worst first
    const gainers = filtered.filter(i => i.pl > 0).sort((a, b) => b.pl - a.pl); // best first
    const totalLoss = losers.reduce((s, i) => s + i.pl, 0);
    const totalGain = gainers.reduce((s, i) => s + i.pl, 0);
    const maxAbs = Math.max(...filtered.map(i => Math.abs(i.pl)), 1);

    let html = '<div class="detail-header"><h4>Répartition P&L par position</h4>';
    html += '<div class="detail-summary">' + losers.length + ' en perte, ' + gainers.length + ' en gain';
    if (skipped > 0) html += ' (' + skipped + ' à €0 masqués)';
    html += '</div></div>';
    html += '<div class="detail-body" style="padding:0;">';

    // Two-column layout
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">';

    // Left column: LOSERS
    html += '<div style="border-right:1px solid #e2e8f0;padding:12px 16px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#c53030;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #fed7d7;margin-bottom:6px;">';
    html += '📉 Pertes (' + fmt(Math.round(totalLoss)) + ')</div>';
    if (losers.length === 0) { html += '<div style="color:#a0aec0;padding:10px 0;font-size:12px;">Aucune perte</div>'; }
    losers.forEach(function(i) {
      var barW = Math.round(Math.abs(i.pl) / maxAbs * 100);
      html += '<div style="display:flex;align-items:center;padding:4px 0;border-bottom:1px solid #edf2f7;font-size:12px;">';
      html += '<span style="flex:1;font-weight:500;">' + i.label + '</span>';
      html += '<span style="min-width:75px;text-align:right;font-weight:700;color:#c53030;">' + fmt(Math.round(i.pl)) + '</span>';
      html += '<span style="flex:0 0 60px;margin-left:8px;height:6px;border-radius:3px;background:#edf2f7;overflow:hidden;">';
      html += '<span style="display:block;height:100%;width:' + barW + '%;background:#fc8181;border-radius:3px;"></span></span>';
      html += '</div>';
    });
    html += '</div>';

    // Right column: GAINERS
    html += '<div style="padding:12px 16px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#276749;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #c6f6d5;margin-bottom:6px;">';
    html += '📈 Gains (+' + fmt(Math.round(totalGain)) + ')</div>';
    if (gainers.length === 0) { html += '<div style="color:#a0aec0;padding:10px 0;font-size:12px;">Aucun gain</div>'; }
    gainers.forEach(function(i) {
      var barW = Math.round(Math.abs(i.pl) / maxAbs * 100);
      html += '<div style="display:flex;align-items:center;padding:4px 0;border-bottom:1px solid #edf2f7;font-size:12px;">';
      html += '<span style="flex:1;font-weight:500;">' + i.label + '</span>';
      html += '<span style="min-width:75px;text-align:right;font-weight:700;color:#276749;">+' + fmt(Math.round(i.pl)) + '</span>';
      html += '<span style="flex:0 0 60px;margin-left:8px;height:6px;border-radius:3px;background:#edf2f7;overflow:hidden;">';
      html += '<span style="display:block;height:100%;width:' + barW + '%;background:#48bb78;border-radius:3px;"></span></span>';
      html += '</div>';
    });
    if (losers.length === 0 && gainers.length === 0 && skipped > 0) {
      html += '<div style="color:#a0aec0;padding:10px 0;font-size:12px;">' + skipped + ' positions à €0 (marché fermé ?)</div>';
    }
    html += '</div>';

    html += '</div>'; // end grid
    html += '</div>'; // end detail-body
    if (footer) html += '<div class="detail-footer">' + footer + '</div>';
    return html;
  }

  // Helper: render a value breakdown list (for total, deposits, etc.)
  function renderValueBreakdown(items, title, subtitle) {
    if (!items || items.length === 0) return '';
    const maxVal = Math.max(...items.map(i => Math.abs(i.value)), 1);
    let html = '<div class="detail-header"><h4>' + title + '</h4>';
    if (subtitle) html += '<div class="detail-summary">' + subtitle + '</div>';
    html += '</div><div class="detail-body">';
    items.forEach(i => {
      const barW = Math.round(Math.abs(i.value) / maxVal * 100);
      const cls = i.cls || '';
      html += '<div class="detail-row">';
      html += '<span class="ticker-label">' + i.label + '</span>';
      html += '<span class="ticker-pl ' + cls + '">' + (i.prefix || '') + fmt(Math.round(i.value)) + '</span>';
      html += '<span class="ticker-bar"><span class="ticker-bar-fill" style="width:' + barW + '%;background:' + (i.color || '#63b3ed') + ';"></span></span>';
      html += '</div>';
    });
    html += '</div>';
    if (items._footer) html += '<div class="detail-footer">' + items._footer + '</div>';
    return html;
  }

  // KPI detail generators
  const detailGenerators = {
    // ── Period P&L panels ──
    detailPLDaily: function() {
      const d = av.periodPL?.daily;
      if (!d?.hasData) return '<div style="padding:20px;text-align:center;color:#a0aec0;">Données daily non disponibles</div>';
      let footer = 'Top perte : ' + (d.breakdown[0]?.label || '--') + ' (' + fmt(Math.round(d.breakdown[0]?.pl || 0)) + ')';
      const best = d.breakdown[d.breakdown.length - 1];
      if (best && best.pl > 0) footer += ' | Top gain : ' + best.label + ' (+' + fmt(Math.round(best.pl)) + ')';
      if (d.cashFxPL && Math.abs(d.cashFxPL) > 1) footer += ' | Impact FX cash : ' + (d.cashFxPL >= 0 ? '+' : '') + fmt(Math.round(d.cashFxPL));
      return renderPLBreakdown(d.breakdown, d.total, footer);
    },
    detailPLMTD: function() {
      const d = av.periodPL?.mtd;
      if (!d?.hasData) return '<div style="padding:20px;text-align:center;color:#a0aec0;">Données MTD non disponibles</div>';
      const worst3 = d.breakdown.slice(0, 3).map(i => i.label + ' (' + fmt(Math.round(i.pl)) + ')').join(', ');
      return renderPLBreakdown(d.breakdown, d.total, 'Top 3 pertes MTD : ' + worst3);
    },
    detailPL1M: function() {
      const d = av.periodPL?.oneMonth;
      if (!d?.hasData) return '<div style="padding:20px;text-align:center;color:#a0aec0;">Données 1M non disponibles</div>';
      const worst3 = d.breakdown.slice(0, 3).map(i => i.label + ' (' + fmt(Math.round(i.pl)) + ')').join(', ');
      return renderPLBreakdown(d.breakdown, d.total, 'Top 3 pertes 1 mois : ' + worst3);
    },
    detailPLYTD: function() {
      const d = av.periodPL?.ytd;
      if (!d?.hasData) return '<div style="padding:20px;text-align:center;color:#a0aec0;">Données YTD non disponibles</div>';
      const gainers = d.breakdown.filter(i => i.pl > 0);
      const losers = d.breakdown.filter(i => i.pl < 0);
      const totalLoss = losers.reduce((s, i) => s + i.pl, 0);
      const totalGain = gainers.reduce((s, i) => s + i.pl, 0);
      let footer = 'Total pertes : ' + fmt(Math.round(totalLoss)) + ' | Total gains : +' + fmt(Math.round(totalGain));
      footer += ' | Net : ' + (d.total >= 0 ? '+' : '') + fmt(Math.round(d.total));
      if (losers.length > 0) footer += '<br>⚠ Plus gros contributeur négatif : ' + losers[0].label + ' (' + fmt(Math.round(losers[0].pl)) + ')';
      return renderPLBreakdown(d.breakdown, d.total, footer);
    },
    // ── Top-row KPI panels ──
    detailTotal: function() {
      const items = allPos.sort((a, b) => b.valEUR - a.valEUR).map(p => ({
        label: p.label + ' (' + p.broker + ')',
        value: p.valEUR,
        color: '#4299e1',
      }));
      const top3 = items.slice(0, 3);
      const top3Pct = (top3.reduce((s, i) => s + i.value, 0) / av.totalStocks * 100).toFixed(0);
      items._footer = 'Top 3 = ' + top3Pct + '% du portefeuille : ' + top3.map(i => i.label.split(' (')[0]).join(', ') + '. Diversification ' + (parseFloat(top3Pct) > 50 ? '⚠ concentrée' : '✓ correcte') + '.';
      return renderValueBreakdown(items, 'Répartition par position', allPos.length + ' positions | Total ' + fmt(Math.round(av.totalStocks)));
    },
    detailUnrealized: function() {
      const losers = allPos.filter(p => p.unrealizedPL < 0).sort((a, b) => a.unrealizedPL - b.unrealizedPL);
      const gainers = allPos.filter(p => p.unrealizedPL > 0).sort((a, b) => b.unrealizedPL - a.unrealizedPL);
      const flat = allPos.filter(p => p.unrealizedPL === 0);
      const totalLoss = losers.reduce((s, p) => s + p.unrealizedPL, 0);
      const totalGain = gainers.reduce((s, p) => s + p.unrealizedPL, 0);
      const maxAbs = Math.max(...allPos.map(p => Math.abs(p.unrealizedPL)), 1);

      let html = '<div class="detail-header"><h4>P/L Non Réalisé par position</h4>';
      html += '<div class="detail-summary">' + losers.length + ' en perte, ' + gainers.length + ' en gain</div></div>';
      html += '<div class="detail-body" style="padding:0;">';

      // Two-column layout
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">';

      // Left column: LOSERS
      html += '<div style="border-right:1px solid #e2e8f0;padding:12px 16px;">';
      html += '<div style="font-size:11px;font-weight:700;color:#c53030;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #fed7d7;margin-bottom:6px;">';
      html += '📉 Pertes (' + fmt(Math.round(totalLoss)) + ')</div>';
      if (losers.length === 0) { html += '<div style="color:#a0aec0;padding:10px 0;font-size:12px;">Aucune perte</div>'; }
      losers.forEach(function(p) {
        var barW = Math.round(Math.abs(p.unrealizedPL) / maxAbs * 100);
        html += '<div style="display:flex;align-items:center;padding:4px 0;border-bottom:1px solid #edf2f7;font-size:12px;">';
        html += '<span style="flex:1;font-weight:500;">' + p.label + ' <span style="color:#a0aec0;font-size:10px;">' + p.pctPL.toFixed(1) + '%</span></span>';
        html += '<span style="min-width:75px;text-align:right;font-weight:700;color:#c53030;">' + fmt(Math.round(p.unrealizedPL)) + '</span>';
        html += '<span style="flex:0 0 60px;margin-left:8px;height:6px;border-radius:3px;background:#edf2f7;overflow:hidden;">';
        html += '<span style="display:block;height:100%;width:' + barW + '%;background:#fc8181;border-radius:3px;"></span></span>';
        html += '</div>';
      });
      html += '</div>';

      // Right column: GAINERS
      html += '<div style="padding:12px 16px;">';
      html += '<div style="font-size:11px;font-weight:700;color:#276749;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #c6f6d5;margin-bottom:6px;">';
      html += '📈 Gains (+' + fmt(Math.round(totalGain)) + ')</div>';
      if (gainers.length === 0) { html += '<div style="color:#a0aec0;padding:10px 0;font-size:12px;">Aucun gain</div>'; }
      gainers.forEach(function(p) {
        var barW = Math.round(Math.abs(p.unrealizedPL) / maxAbs * 100);
        html += '<div style="display:flex;align-items:center;padding:4px 0;border-bottom:1px solid #edf2f7;font-size:12px;">';
        html += '<span style="flex:1;font-weight:500;">' + p.label + ' <span style="color:#a0aec0;font-size:10px;">+' + p.pctPL.toFixed(1) + '%</span></span>';
        html += '<span style="min-width:75px;text-align:right;font-weight:700;color:#276749;">+' + fmt(Math.round(p.unrealizedPL)) + '</span>';
        html += '<span style="flex:0 0 60px;margin-left:8px;height:6px;border-radius:3px;background:#edf2f7;overflow:hidden;">';
        html += '<span style="display:block;height:100%;width:' + barW + '%;background:#48bb78;border-radius:3px;"></span></span>';
        html += '</div>';
      });
      html += '</div>';

      html += '</div>'; // end grid
      html += '</div>'; // end detail-body
      const worst = losers[0];
      const best = gainers[0];
      html += '<div class="detail-footer">Pire : ' + (worst?.label || '--') + ' (' + fmt(Math.round(worst?.unrealizedPL || 0)) + ') | Meilleure : ' + (best?.label || '--') + ' (+' + fmt(Math.round(best?.unrealizedPL || 0)) + ')</div>';
      return html;
    },
    detailRealized: function() {
      // IBKR closed + Degiro closed
      const ibkrClosed = av.closedPositions || [];
      const degiroClosed = av.degiroClosedPositions || [];
      const allClosed = ibkrClosed.map(t => ({ label: t.label || t.ticker, pl: t.pl || 0, source: 'IBKR' }))
        .concat(degiroClosed.map(t => ({ label: t.label || t.ticker, pl: t.pl || 0, source: 'Degiro' })));
      allClosed.sort((a, b) => b.pl - a.pl); // best first
      const items = allClosed.map(t => ({
        label: t.label + ' (' + t.source + ')',
        value: Math.abs(t.pl),
        prefix: t.pl >= 0 ? '+' : '-',
        cls: t.pl >= 0 ? 'pl-pos' : 'pl-neg',
        color: t.pl >= 0 ? '#48bb78' : '#fc8181',
      }));
      let html = '<div class="detail-header"><h4>P/L Réalisé — Positions clôturées</h4>';
      html += '<div class="detail-summary">' + allClosed.length + ' trades | Total ' + (av.combinedRealizedPL >= 0 ? '+' : '') + fmt(Math.round(av.combinedRealizedPL)) + '</div></div>';
      html += '<div class="detail-body">';
      const maxVal = Math.max(...allClosed.map(t => Math.abs(t.pl)), 1);
      allClosed.forEach(t => {
        const sign = t.pl >= 0 ? '+' : '';
        const cls = t.pl >= 0 ? 'pl-pos' : 'pl-neg';
        const barW = Math.round(Math.abs(t.pl) / maxVal * 100);
        const barColor = t.pl >= 0 ? '#48bb78' : '#fc8181';
        html += '<div class="detail-row">';
        html += '<span class="ticker-label">' + t.label + ' <span style="color:#a0aec0;font-size:11px;">(' + t.source + ')</span></span>';
        html += '<span class="ticker-pl ' + cls + '">' + sign + fmt(Math.round(t.pl)) + '</span>';
        html += '<span class="ticker-bar"><span class="ticker-bar-fill" style="width:' + barW + '%;background:' + barColor + ';"></span></span>';
        html += '</div>';
      });
      html += '</div>';
      const bestTrade = allClosed[0];
      html += '<div class="detail-footer">🏆 Meilleur trade : ' + (bestTrade?.label || '--') + ' (+' + fmt(Math.round(bestTrade?.pl || 0)) + ')</div>';
      return html;
    },
    detailDeposits: function() {
      const deps = av.depositHistory || [];
      const totalPL = av.combinedUnrealizedPL + av.combinedRealizedPL;
      const roi = av.totalDeposits > 0 ? (totalPL / av.totalDeposits * 100).toFixed(1) : '0.0';
      const totalFxGain = deps.reduce((s, d) => s + (d.fxGainEUR || 0), 0);
      const totalInvested = deps.reduce((s, d) => s + d.amountEUR, 0);
      let html = '<div class="detail-header"><h4>Historique des dépôts</h4>';
      html += '<div class="detail-summary">Total investi : ' + fmt(Math.round(totalInvested)) + ' | ROI : ' + (totalPL >= 0 ? '+' : '') + roi + '%</div></div>';
      html += '<div class="detail-body" style="max-height:500px;">';
      // Column headers
      html += '<div style="display:flex;gap:8px;padding:4px 0 8px;border-bottom:2px solid #e2e8f0;font-size:9px;color:#a0aec0;text-transform:uppercase;letter-spacing:0.5px;">';
      html += '<span style="flex:1;">Date & Description</span>';
      html += '<span style="min-width:85px;text-align:right;">Natif</span>';
      html += '<span style="min-width:75px;text-align:right;">EUR (date)</span>';
      html += '<span style="min-width:75px;text-align:right;">EUR (ajd)</span>';
      html += '<span style="min-width:60px;text-align:right;">Δ FX</span>';
      html += '</div>';
      if (deps.length > 0) {
        // Group by owner then platform
        var owners = ['Amine', 'Nezha'];
        owners.forEach(function(owner) {
          var ownerDeps = deps.filter(function(d) { return d.owner === owner; });
          if (ownerDeps.length === 0) return;
          var ownerTotal = ownerDeps.reduce(function(s, d) { return s + d.amountEUR; }, 0);
          // Owner header
          html += '<div style="padding:10px 0 4px;font-weight:700;font-size:13px;color:#1a202c;border-bottom:2px solid #cbd5e0;">';
          html += '👤 ' + owner + ' — ' + fmt(Math.round(ownerTotal)) + ' investi</div>';
          // Sub-group by platform
          var platforms = [];
          ownerDeps.forEach(function(d) { if (platforms.indexOf(d.platform) === -1) platforms.push(d.platform); });
          // Sort platforms by total deposited (largest first)
          platforms.sort(function(a, b) {
            var totalA = ownerDeps.filter(function(d) { return d.platform === a; }).reduce(function(s, d) { return s + d.amountEUR; }, 0);
            var totalB = ownerDeps.filter(function(d) { return d.platform === b; }).reduce(function(s, d) { return s + d.amountEUR; }, 0);
            return totalB - totalA;
          });
          platforms.forEach(function(platform) {
            var pDeps = ownerDeps.filter(function(d) { return d.platform === platform; });
            var pTotal = pDeps.reduce(function(s, d) { return s + d.amountEUR; }, 0);
            var pCurrentTotal = pDeps.reduce(function(s, d) { return s + d.currentEUR; }, 0);
            var pFxGain = pDeps.reduce(function(s, d) { return s + d.fxGainEUR; }, 0);
            // Platform sub-header
            html += '<div style="display:flex;gap:8px;padding:6px 0 3px;font-weight:600;font-size:11px;color:#4a5568;border-bottom:1px solid #edf2f7;background:#f7fafc;margin:0 -20px;padding-left:20px;padding-right:20px;">';
            html += '<span style="flex:1;">' + platform + ' (' + pDeps.length + ')</span>';
            html += '<span style="min-width:85px;text-align:right;"></span>';
            html += '<span style="min-width:75px;text-align:right;">' + fmt(Math.round(pTotal)) + '</span>';
            html += '<span style="min-width:75px;text-align:right;">' + fmt(Math.round(pCurrentTotal)) + '</span>';
            html += '<span style="min-width:60px;text-align:right;' + (pFxGain >= 0 ? 'color:#276749' : 'color:#c53030') + ';">' + (pFxGain >= 0 ? '+' : '') + fmt(Math.round(pFxGain)) + '</span>';
            html += '</div>';
            pDeps.forEach(function(d) {
              var fxCls = d.fxGainEUR >= 0 ? 'color:#276749' : 'color:#c53030';
              var fxSign = d.fxGainEUR >= 0 ? '+' : '';
              var currSym = d.currency === 'EUR' ? '€' : d.currency === 'USD' ? '$' : d.currency === 'MAD' ? 'DH' : d.currency;
              var nativeFmt = Math.round(d.amountNative).toLocaleString('fr-FR');
              html += '<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #edf2f7;font-size:12px;">';
              html += '<span style="flex:1;">' + d.date + ' <span style="color:#a0aec0;font-size:10px;">' + d.label + '</span></span>';
              html += '<span style="min-width:85px;text-align:right;font-weight:500;">' + currSym + ' ' + nativeFmt + '</span>';
              html += '<span style="min-width:75px;text-align:right;">' + fmt(Math.round(d.amountEUR)) + '</span>';
              html += '<span style="min-width:75px;text-align:right;">' + fmt(Math.round(d.currentEUR)) + '</span>';
              html += '<span style="min-width:60px;text-align:right;' + fxCls + ';">' + (d.currency === 'EUR' ? '—' : fxSign + fmt(Math.round(d.fxGainEUR))) + '</span>';
              html += '</div>';
            });
          });
        });
      } else {
        html += '<div style="text-align:center;color:#a0aec0;padding:10px;">Pas de dépôts enregistrés</div>';
      }
      html += '</div>';
      var footer = 'Capital investi : ' + fmt(Math.round(totalInvested)) + ' → Valeur actuelle : ' + fmt(Math.round(av.totalStocks));
      if (Math.abs(totalFxGain) > 10) footer += ' | Impact FX total : ' + (totalFxGain >= 0 ? '+' : '') + fmt(Math.round(totalFxGain));
      footer += '<br>💡 "EUR (ajd)" = si vous aviez gardé la devise sans investir, sa valeur en EUR aujourd\'hui.';
      html += '<div class="detail-footer">' + footer + '</div>';
      return html;
    },
    detailDividends: function() {
      let html = '<div class="detail-header"><h4>Dividendes & Performance</h4>';
      html += '<div class="detail-summary">TWR ' + (av.twr >= 0 ? '+' : '') + av.twr.toFixed(1) + '% | Dividendes bruts ' + fmt(Math.round(av.dividends)) + '</div></div>';
      html += '<div class="detail-body">';
      html += '<div class="detail-row"><span class="ticker-label">Dividendes bruts reçus</span><span class="ticker-pl pl-pos">+' + fmt(Math.round(av.dividends)) + '</span><span class="ticker-bar"></span></div>';
      html += '<div class="detail-row"><span class="ticker-label">Commissions payées</span><span class="ticker-pl pl-neg">-' + fmt(Math.round(Math.abs(av.commissions || 0))) + '</span><span class="ticker-bar"></span></div>';
      const divYield = av.totalStocks > 0 ? (av.dividends / av.totalStocks * 100).toFixed(2) : '0.00';
      html += '<div class="detail-row"><span class="ticker-label">Yield dividende (brut)</span><span class="ticker-pl">' + divYield + '%</span><span class="ticker-bar"></span></div>';
      html += '<div class="detail-row"><span class="ticker-label">TWR (performance globale)</span><span class="ticker-pl ' + (av.twr >= 0 ? 'pl-pos' : 'pl-neg') + '">' + (av.twr >= 0 ? '+' : '') + av.twr.toFixed(1) + '%</span><span class="ticker-bar"></span></div>';
      html += '</div>';
      html += '<div class="detail-footer">💡 WHT (retenue à la source) déduite automatiquement sur dividendes FR (30%), US (15%), JP (15%). En tant que résident fiscal UAE, vendre avant l\'ex-date évite la WHT.</div>';
      return html;
    },
  };

  // Click handler for all KPI cards
  document.querySelectorAll('.kpi-clickable[data-detail]').forEach(kpi => {
    kpi.addEventListener('click', function() {
      const detailId = this.dataset.detail;
      // Toggle off if already active
      if (activeKPI === detailId) {
        panel.style.display = 'none';
        this.classList.remove('active-kpi');
        activeKPI = null;
        return;
      }
      // Deactivate previous
      document.querySelectorAll('.kpi-clickable.active-kpi').forEach(k => k.classList.remove('active-kpi'));
      this.classList.add('active-kpi');
      activeKPI = detailId;
      // Generate and show detail
      const generator = detailGenerators[detailId];
      if (generator) {
        panel.innerHTML = generator();
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
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

    // Build enriched flat data for sorting — hide tiny accounts (< 50€)
    const MIN_DISPLAY_EUR = 50;
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
    }).filter(a => a.isDebt || Math.abs(a.valEUR) >= MIN_DISPLAY_EUR);

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
        let acctIndex = 0;
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
          if (acctIndex % 2 === 1) tr.style.background = '#fafaf9';
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
          acctIndex++;
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

  // Yield bars — Couple, Amine, Nezha (click to toggle % ↔ montants, hover for breakdown)
  const barsContainer = document.getElementById('cashYieldBars');
  if (barsContainer && cv.totalCash > 0) {
    const inflRate = 0.03;
    // Build per-account lists for each row
    const allAccounts = cv.accounts.filter(a => !a.isDebt).map(a => ({
      label: a.label, valEUR: a.valEUR, yield: a.yield || 0, productive: (a.yield || 0) >= 0.03
    }));
    const amineAccts = cv.byOwner ? cv.byOwner.Amine.accounts : [];
    const nezhaAccts = cv.byOwner ? cv.byOwner.Nezha.accounts : [];

    const rows = [
      { label: 'Couple', yielding: cv.totalYielding, nonYielding: cv.totalNonYielding, total: cv.totalCash,
        yieldSum: cv.weightedAvgYield * cv.totalCash, accounts: allAccounts },
      ...(cv.byOwner ? [
        { label: 'Amine', yielding: cv.byOwner.Amine.yielding, nonYielding: cv.byOwner.Amine.nonYielding,
          total: cv.byOwner.Amine.total, yieldSum: cv.byOwner.Amine.weightedYieldSum, accounts: amineAccts },
        { label: 'Nezha', yielding: cv.byOwner.Nezha.yielding, nonYielding: cv.byOwner.Nezha.nonYielding,
          total: cv.byOwner.Nezha.total, yieldSum: cv.byOwner.Nezha.weightedYieldSum, accounts: nezhaAccts },
      ] : []),
    ];
    barsContainer._rows = rows;
    barsContainer._showAmounts = false;

    const MAX_ACCTS = 5; // max accounts per category in tooltip
    function buildBarTooltip(r) {
      const prodAccts = r.accounts.filter(a => a.productive).sort((a, b) => b.valEUR - a.valEUR);
      const dormAccts = r.accounts.filter(a => !a.productive).sort((a, b) => b.valEUR - a.valEUR);
      const avgYield = r.total > 0 ? (r.yieldSum / r.total * 100).toFixed(1) : '0.0';
      const net = r.yieldSum - r.total * inflRate;
      // % relative to total cash
      const pctOf = v => r.total > 0 ? (v / r.total * 100).toFixed(1) : '0.0';

      let html = '<div style="font-weight:700;margin-bottom:6px;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:4px;">'
        + r.label + ' — ' + fmt(r.total) + ' total · Rdt moy ' + avgYield + '%</div>';

      function renderAcctList(accts, color, catLabel, catTotal) {
        if (accts.length === 0) return '';
        let h = '<div style="color:' + color + ';font-weight:600;font-size:11px;margin:4px 0 2px;">' + catLabel + ' (' + fmt(catTotal) + ' · ' + pctOf(catTotal) + '%)</div>';
        const shown = accts.slice(0, MAX_ACCTS);
        const rest = accts.slice(MAX_ACCTS);
        shown.forEach(a => {
          h += '<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;line-height:1.6;">'
            + '<span>' + a.label + '</span><span>' + fmt(a.valEUR) + ' · ' + pctOf(a.valEUR) + '%</span></div>';
        });
        if (rest.length > 0) {
          const restTotal = rest.reduce((s, a) => s + a.valEUR, 0);
          h += '<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;line-height:1.6;color:#a0aec0;">'
            + '<span>+ ' + rest.length + ' autres</span><span>' + fmt(restTotal) + ' · ' + pctOf(restTotal) + '%</span></div>';
        }
        return h;
      }

      html += renderAcctList(prodAccts, '#68d391', 'PRODUCTIF', r.yielding);
      html += renderAcctList(dormAccts, '#fc8181', 'DORMANT', r.nonYielding);

      html += '<div style="border-top:1px solid rgba(255,255,255,0.2);margin-top:6px;padding-top:4px;font-size:11px;text-align:center;">'
        + 'Net vs inflation : <span style="color:' + (net >= 0 ? '#68d391' : '#fc8181') + ';font-weight:600;">'
        + (net >= 0 ? '+' : '') + fmt(Math.round(net)) + '/an</span></div>';
      return html;
    }

    function renderYieldBars() {
      const showAmt = barsContainer._showAmounts;
      barsContainer.innerHTML = rows.map((r, idx) => {
        if (r.total <= 0) return '';
        const pctProd = Math.round(r.yielding / r.total * 100);
        const pctDorm = 100 - pctProd;
        const net = r.yieldSum - r.total * inflRate;
        const netStr = (net >= 0 ? '+' : '') + fmt(Math.round(net));
        const netColor = net >= 0 ? 'var(--green)' : 'var(--red)';
        let segs = '';
        if (pctProd > 0) {
          const prodLabel = showAmt ? fmt(r.yielding, true) : pctProd + '%';
          segs += '<div class="mb-seg" style="width:' + pctProd + '%;background:var(--green)">' + prodLabel + '</div>';
        }
        if (pctDorm > 0) {
          const dormLabel = showAmt ? fmt(r.nonYielding, true) : pctDorm + '%';
          segs += '<div class="mb-seg" style="width:' + pctDorm + '%;background:var(--red)">' + dormLabel + '</div>';
        }
        return '<div class="yield-bar-row" data-bar-idx="' + idx + '" style="display:flex;align-items:center;gap:10px;position:relative;">'
          + '<span style="min-width:52px;font-weight:600;font-size:13px;">' + r.label + '</span>'
          + '<div class="meter-bar" style="height:28px;flex:1;cursor:pointer;" data-yieldbar="1">' + segs + '</div>'
          + '<span style="min-width:100px;text-align:right;font-size:13px;font-weight:600;color:' + netColor + '">' + netStr + '/an</span>'
          + '</div>';
      }).join('');
    }
    renderYieldBars();

    // Click to toggle % ↔ montants
    barsContainer.onclick = (e) => {
      if (e.target.closest('[data-yieldbar]') || e.target.closest('.mb-seg')) {
        barsContainer._showAmounts = !barsContainer._showAmounts;
        renderYieldBars();
      }
    };

    // Hover tooltip
    let barTip = null;
    barsContainer.addEventListener('mouseenter', (e) => {
      const row = e.target.closest('.yield-bar-row');
      if (!row) return;
      const idx = parseInt(row.getAttribute('data-bar-idx'));
      const r = rows[idx];
      if (!r) return;
      if (!barTip) {
        barTip = document.createElement('div');
        barTip.style.cssText = 'position:absolute;z-index:999;background:#1a202c;color:#fff;padding:10px 14px;border-radius:8px;'
          + 'box-shadow:0 4px 12px rgba(0,0,0,0.25);pointer-events:none;min-width:260px;max-width:360px;';
        document.body.appendChild(barTip);
      }
      barTip.innerHTML = buildBarTooltip(r);
      barTip.style.display = 'block';
      const rect = row.getBoundingClientRect();
      barTip.style.left = (rect.left + rect.width / 2 - 150) + 'px';
      barTip.style.top = (rect.bottom + 8 + window.scrollY) + 'px';
    }, true);
    barsContainer.addEventListener('mouseover', (e) => {
      const row = e.target.closest('.yield-bar-row');
      if (!row || !barTip) return;
      const idx = parseInt(row.getAttribute('data-bar-idx'));
      const r = rows[idx];
      if (!r) return;
      barTip.innerHTML = buildBarTooltip(r);
      const rect = row.getBoundingClientRect();
      barTip.style.left = (rect.left + rect.width / 2 - 150) + 'px';
      barTip.style.top = (rect.bottom + 8 + window.scrollY) + 'px';
      barTip.style.display = 'block';
    });
    barsContainer.addEventListener('mouseleave', () => {
      if (barTip) barTip.style.display = 'none';
    });
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

      // ── Comptes dormants par propriétaire (générique) ──
      else if (d.category.startsWith('dormant_')) {
        const acctList = d.accounts.map(a => a.label + ' (' + fmt(a.valEUR) + ')').join(', ');
        title = '\uD83D\uDD25 Cash dormant ' + d.owner + ' : ' + fmt(d.amountEUR) + ' \u00e0 <3% \u2014 potentiel +' + fmt(d.gainPotentiel) + '/an';
        detail = d.accounts.length + ' compte' + (d.accounts.length > 1 ? 's' : '') + ' concern\u00e9' + (d.accounts.length > 1 ? 's' : '') + ' : ' + acctList + '.';
      }

      // ── Comptes sous-optimaux ──
      else if (d.category === 'sub_optimal') {
        title = '\uD83D\uDCB0 ' + d.label + ' : ' + fmt(d.amountEUR) + ' \u00e0 ' + (d.effectiveYield * 100).toFixed(1) + '% \u2014 manque ' + fmt(d.missedAnn) + '/an';
        detail = 'Rendement inf\u00e9rieur au benchmark. Optimiser le placement pour r\u00e9cup\u00e9rer ' + fmt(d.missedAnn) + '/an.';
      }

      // ── JPY Levier ──
      else if (d.category === 'jpy_leverage') {
        title = '\uD83D\uDCB1 Levier JPY : \u00a5' + Math.round(d.jpyNative).toLocaleString('ja-JP') + ' emprunt\u00e9s \u2014 co\u00fbt ' + fmt(d.costAnn) + '/an';
        detail = 'Taux blend\u00e9 ' + (d.blendedRate * 100).toFixed(1) + '%. '
          + 'Risque de change : yen \u00e0 +10% = perte de ~' + fmt(d.riskYen10pct) + '.';
      }

      // ── Plan d'action (dynamique) ──
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

function renderWealthBreakdown(iv, filteredProps, filteredTotals) {
  const section = document.getElementById('wealthBreakdownSection');
  const content = document.getElementById('wealthBreakdownContent');
  if (!section || !content || !iv.totalWealthBreakdown) return;

  const tb = filteredTotals ? filteredTotals.wealthBreakdown : iv.totalWealthBreakdown;
  const total = filteredTotals ? filteredTotals.wealthCreation : iv.totalWealthCreation;
  const props = filteredProps || iv.properties;

  // Bar width helper (proportional to total)
  const maxComp = Math.max(Math.abs(tb.capitalAmorti), Math.abs(tb.appreciation), Math.abs(tb.cashflow), 1);
  function barW(val) { return Math.max(2, Math.abs(val) / maxComp * 100); }

  // Build per-property rows
  let tableRows = '';
  props.forEach(p => {
    const wb = p.wealthBreakdown || {};
    const t = p.wealthCreation || 0;
    const isConditional = p.conditional && t === 0;
    tableRows += '<tr' + (isConditional ? ' style="color:#a0aec0;font-style:italic"' : '') + '>'
      + '<td style="font-weight:600;white-space:nowrap">' + p.name + '</td>'
      + '<td class="num" style="color:var(--accent)">' + fmt(wb.capitalAmorti || 0) + '</td>'
      + '<td class="num" style="color:var(--green)">' + fmt(wb.appreciation || 0) + '</td>'
      + '<td class="num" style="color:' + (wb.cashflow >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (wb.cashflow >= 0 ? '+' : '') + fmt(wb.cashflow || 0) + '</td>'
      + '<td class="num" style="font-weight:700;color:' + (t >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (t >= 0 ? '+' : '') + fmt(t) + '</td>'
      + '</tr>';
  });

  // Total row
  tableRows += '<tr style="border-top:2px solid var(--primary);font-weight:700">'
    + '<td>TOTAL</td>'
    + '<td class="num" style="color:var(--accent)">' + fmt(tb.capitalAmorti) + '</td>'
    + '<td class="num" style="color:var(--green)">' + fmt(tb.appreciation) + '</td>'
    + '<td class="num" style="color:' + (tb.cashflow >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (tb.cashflow >= 0 ? '+' : '') + fmt(tb.cashflow) + '</td>'
    + '<td class="num" style="font-size:16px;color:var(--green)">+' + fmt(total) + '</td>'
    + '</tr>';

  // Annual projection
  const annuel = total * 12;

  // Visual bar breakdown
  const capPct = total > 0 ? (tb.capitalAmorti / total * 100).toFixed(0) : 0;
  const apPct = total > 0 ? (tb.appreciation / total * 100).toFixed(0) : 0;
  const cfPct = total > 0 ? Math.max(0, tb.cashflow) / total * 100 : 0;
  // Negative CF is an "effort" that reduces the total — show it visually
  const effortPct = tb.cashflow < 0 ? (Math.abs(tb.cashflow) / (tb.capitalAmorti + tb.appreciation) * 100).toFixed(0) : 0;

  content.innerHTML =
    '<p style="margin:0 0 12px;color:var(--gray);font-size:13px;line-height:1.5">'
    + 'Chaque mois, votre patrimoine immobilier augmente de <strong style="color:var(--green)">+' + fmt(total) + '</strong> '
    + '(<strong>' + fmt(annuel) + '/an</strong>). Voici les moteurs :'
    + '</p>'
    // Stacked bar visualization
    + '<div style="display:flex;border-radius:8px;overflow:hidden;height:32px;margin-bottom:16px;font-size:11px;font-weight:600;color:#fff">'
    + '<div style="background:#2b6cb0;width:' + capPct + '%;display:flex;align-items:center;justify-content:center;min-width:' + (capPct > 8 ? '0' : '60') + 'px" title="Capital amorti">' + (capPct > 8 ? capPct + '%' : '') + '</div>'
    + '<div style="background:#276749;width:' + apPct + '%;display:flex;align-items:center;justify-content:center;min-width:' + (apPct > 8 ? '0' : '60') + 'px" title="Appr\u00e9ciation">' + (apPct > 8 ? apPct + '%' : '') + '</div>'
    + (tb.cashflow >= 0
      ? '<div style="background:#48bb78;width:' + cfPct.toFixed(0) + '%;display:flex;align-items:center;justify-content:center" title="Cash flow positif">' + (cfPct > 8 ? cfPct.toFixed(0) + '%' : '') + '</div>'
      : '<div style="background:#e53e3e;width:' + effortPct + '%;display:flex;align-items:center;justify-content:center" title="Effort d\u2019\u00e9pargne">' + (effortPct > 8 ? '-' + effortPct + '%' : '') + '</div>')
    + '</div>'
    // Legend
    + '<div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px;font-size:12px">'
    + '<span><span style="display:inline-block;width:12px;height:12px;background:#2b6cb0;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Capital amorti <strong>' + fmt(tb.capitalAmorti) + '/mois</strong></span>'
    + '<span><span style="display:inline-block;width:12px;height:12px;background:#276749;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Appr\u00e9ciation <strong>' + fmt(tb.appreciation) + '/mois</strong></span>'
    + (tb.cashflow >= 0
      ? '<span><span style="display:inline-block;width:12px;height:12px;background:#48bb78;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Cash flow net <strong>+' + fmt(tb.cashflow) + '/mois</strong></span>'
      : '<span><span style="display:inline-block;width:12px;height:12px;background:#e53e3e;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Effort d\u2019\u00e9pargne <strong>-' + fmt(Math.abs(tb.cashflow)) + '/mois</strong></span>')
    + '</div>'
    // Detail table
    + '<div style="overflow-x:auto">'
    + '<table style="width:100%;border-collapse:collapse;font-size:13px">'
    + '<thead><tr style="background:#f7fafc">'
    + '<th style="text-align:left;padding:8px">Bien</th>'
    + '<th class="num" style="padding:8px">Capital amorti</th>'
    + '<th class="num" style="padding:8px">Appr\u00e9ciation</th>'
    + '<th class="num" style="padding:8px">Cash flow</th>'
    + '<th class="num" style="padding:8px">Total /mois</th>'
    + '</tr></thead><tbody>' + tableRows + '</tbody></table>'
    + '</div>'
    // Explanation
    + '<div style="margin-top:16px;padding:12px 16px;background:#f0fff4;border-radius:8px;border-left:3px solid var(--green);font-size:12px;line-height:1.6;color:#2d3748">'
    + '<strong>Comment lire ce tableau :</strong><br>'
    + '<strong>Capital amorti</strong> = part du pr\u00eat rembours\u00e9e qui augmente votre equity (le locataire paie, la banque rembourse).<br>'
    + '<strong>Appr\u00e9ciation</strong> = hausse de valeur du bien (Vitry 1.5%/an GPE L15, Rueil 1%/an' + (_immoIncludeVillejuif ? ', Villejuif 2%/an L14+L15' : '') + ').<br>'
    + '<strong>Cash flow</strong> = loyers - toutes charges (pr\u00eat + assurance + PNO + TF + copro). N\u00e9gatif = effort d\u2019\u00e9pargne mensuel.'
    + (tb.cashflow < 0 ? '<br><em>M\u00eame avec un effort de ' + fmt(Math.abs(tb.cashflow)) + '/mois, vous cr\u00e9ez ' + fmt(total) + '/mois de richesse nette. Le levier bancaire travaille pour vous.</em>' : '')
    + '</div>';

  section.style.display = 'block';
}

function renderImmoView(state) {
  const iv = state.immoView;

  // ── Villejuif toggle wiring ──
  const vilToggle = document.getElementById('immoVillejuifToggle');
  const vilCheck = document.getElementById('immoVillejuifCheck');
  function updateVilToggleUI() {
    if (vilCheck) {
      vilCheck.style.background = _immoIncludeVillejuif ? 'var(--accent)' : '#fff';
      vilCheck.style.borderColor = _immoIncludeVillejuif ? 'var(--accent)' : '#cbd5e0';
      vilCheck.style.color = _immoIncludeVillejuif ? '#fff' : 'transparent';
    }
  }
  if (vilToggle && !vilToggle._wired) {
    vilToggle._wired = true;
    vilToggle.addEventListener('click', () => {
      _immoIncludeVillejuif = !_immoIncludeVillejuif;
      updateVilToggleUI();
      // Refresh entire page (KPIs + charts + tables + projections)
      if (typeof window._appRefresh === 'function') {
        window._appRefresh();
      } else {
        renderImmoView(state); // fallback
      }
    });
  }
  updateVilToggleUI();

  // ── Filter properties based on toggle ──
  const filteredProps = _immoIncludeVillejuif
    ? iv.properties
    : iv.properties.filter(p => p.loanKey !== 'villejuif');
  const fp = filteredProps; // shorthand
  iv._filteredProperties = fp; // expose filtered list for other renderers

  // Recompute KPIs from filtered set
  const fTotalEquity = fp.reduce((s, p) => s + p.equity, 0);
  const fTotalValue = fp.reduce((s, p) => s + p.value, 0);
  const fTotalCRD = fp.reduce((s, p) => s + p.crd, 0);
  const fTotalCF = fp.reduce((s, p) => s + p.cf, 0);
  const fTotalWealthCreation = fp.reduce((s, p) => s + p.wealthCreation, 0);
  const fTotalWealthBreakdown = {
    capitalAmorti: fp.reduce((s, p) => s + (p.wealthBreakdown ? p.wealthBreakdown.capitalAmorti : 0), 0),
    appreciation: fp.reduce((s, p) => s + (p.wealthBreakdown ? p.wealthBreakdown.appreciation : 0), 0),
    cashflow: fp.reduce((s, p) => s + (p.wealthBreakdown ? p.wealthBreakdown.cashflow : 0), 0),
  };
  const fAvgLTV = fTotalValue > 0 ? (fTotalCRD / fTotalValue * 100) : 0;
  const fTotalExitCosts = fp.reduce((s, p) => s + (p.exitCosts ? p.exitCosts.totalExitCosts : 0), 0);
  // Floor each property's net equity at 0 before summing (can't sell at a loss)
  const fTotalNetEquityAfterExit = fp.reduce((s, p) => s + Math.max(0, p.exitCosts ? p.exitCosts.netEquityAfterExit : p.equity), 0);

  // KPIs
  setEur('kpiImmoViewEq', fTotalEquity);
  // Add delta indicator for immo equity (use couple NW delta as proxy)
  setEur('kpiImmoViewVal', fTotalValue);
  setEur('kpiImmoViewCRD', fTotalCRD);
  setText('kpiImmoViewWealth', '+' + fmt(fTotalWealthCreation) + '/mois');
  setText('kpiImmoViewLTV', fAvgLTV.toFixed(1) + '%');

  // ── Wealth creation breakdown section ──
  renderWealthBreakdown(iv, fp, { wealthBreakdown: fTotalWealthBreakdown, wealthCreation: fTotalWealthCreation });

  // ── Wealth projection chart ──
  const projSection = document.getElementById('wealthProjectionSection');
  if (projSection && iv.wealthProjection) {
    projSection.style.display = 'block';

    // Current toggle states
    let wealthProjMode = 'an';
    let wealthProjGroup = 'type';

    function rebuildWealthChart() {
      if (typeof window.buildWealthProjectionChart === 'function') {
        window.buildWealthProjectionChart(state, wealthProjMode, wealthProjGroup);
      }
    }

    // Build chart (default: annual, par type)
    setTimeout(rebuildWealthChart, 100);

    // Time toggle (Par an / Par mois)
    const toggleBtns = document.querySelectorAll('.wealth-proj-btn');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toggleBtns.forEach(b => { b.style.background = '#fff'; b.style.color = '#4a5568'; b.style.fontWeight = '400'; b.classList.remove('active'); });
        btn.style.background = 'var(--accent)'; btn.style.color = '#fff'; btn.style.fontWeight = '600'; btn.classList.add('active');
        wealthProjMode = btn.dataset.mode;
        rebuildWealthChart();
      });
    });

    // Group toggle (Par type / Par appart)
    const groupBtns = document.querySelectorAll('.wealth-group-btn');
    groupBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        groupBtns.forEach(b => { b.style.background = '#fff'; b.style.color = '#4a5568'; b.style.fontWeight = '400'; b.classList.remove('active'); });
        btn.style.background = 'var(--accent)'; btn.style.color = '#fff'; btn.style.fontWeight = '600'; btn.classList.add('active');
        wealthProjGroup = btn.dataset.group;
        rebuildWealthChart();
      });
    });
  }
  const cfCls = fTotalCF >= 0 ? 'pl-pos' : 'pl-neg';
  const cfSign = fTotalCF >= 0 ? '+' : '';
  setText('kpiImmoViewCF', cfSign + fmt(fTotalCF) + '/mois');
  const cfEl = document.getElementById('kpiImmoViewCF');
  if (cfEl) { cfEl.classList.remove('pl-pos', 'pl-neg'); cfEl.classList.add(cfCls); }

  // Exit costs KPIs (net equity after exit)
  const neaeEl = document.getElementById('kpiImmoViewNetEq');
  if (neaeEl) {
    const neae = fTotalNetEquityAfterExit || 0;
    neaeEl.textContent = fmt(Math.round(neae));
    neaeEl.setAttribute('data-eur', Math.round(neae));
    neaeEl.className = 'value ' + (neae >= 0 ? 'pl-pos' : 'pl-neg');
  }
  const exitEl = document.getElementById('kpiImmoViewExitCosts');
  if (exitEl) {
    exitEl.textContent = fmt(Math.round(fTotalExitCosts || 0));
    exitEl.setAttribute('data-eur', Math.round(fTotalExitCosts || 0));
  }

  // ── Hover tooltips for immobilier KPIs ──
  function _setTip(elId, html, above) {
    const el = document.getElementById(elId);
    if (!el) return;
    const kpiEl = el.closest('.kpi');
    if (!kpiEl) return;
    let tip = kpiEl.querySelector('.kpi-tooltip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'kpi-tooltip'; kpiEl.appendChild(tip); }
    if (above) tip.classList.add('above'); else tip.classList.remove('above');
    tip.innerHTML = html;
  }
  const _fmtK = v => { const a = Math.abs(Math.round(v)); return (v < 0 ? '-' : '') + (a >= 1000 ? (a / 1000).toFixed(0) + 'K' : a + '') + ' \u20ac'; };
  const _vilNote = !_immoIncludeVillejuif ? '<br><span style="color:#fbd38d;font-size:10px">Hors Villejuif (achat futur)</span>' : '';

  // 1. Equity Brute — breakdown per property (above to avoid clipping by row 2)
  _setTip('kpiImmoViewEq', fp.map(p => p.name + ' : <b>' + _fmtK(p.equity) + '</b>').join('<br>') + _vilNote, true);

  // 2. Equity Nette (après sortie) — show deduction
  _setTip('kpiImmoViewNetEq', fp.map(p => {
    const ne = p.exitCosts ? p.exitCosts.netEquityAfterExit : p.equity;
    const ec = p.exitCosts ? p.exitCosts.totalExitCosts : 0;
    return p.name + ' : <b>' + _fmtK(ne) + '</b> <span style="color:#fc8181;">(-' + _fmtK(ec) + ' frais)</span>';
  }).join('<br>') + _vilNote, true);

  // 3. Frais de sortie — per property
  _setTip('kpiImmoViewExitCosts', fp.map(p => {
    const ec = p.exitCosts ? p.exitCosts.totalExitCosts : 0;
    return p.name + ' : <b>' + _fmtK(ec) + '</b>';
  }).join('<br>') + '<br><span style="color:#a0aec0;font-size:11px">IRA + PV immo + frais agence</span>' + _vilNote, true);

  // 4. CF Net /mois — per property with sign
  _setTip('kpiImmoViewCF', fp.map(p => {
    const s = p.cf >= 0 ? '+' : '';
    const c = p.cf >= 0 ? '#68d391' : '#fc8181';
    return p.name + ' : <b style="color:' + c + '">' + s + p.cf + ' \u20ac</b>';
  }).join('<br>') + '<br><span style="color:#a0aec0;font-size:11px">Loyers - charges - pr\u00eat - assurance</span>' + _vilNote, true);

  // 5. Valeur Totale — per property with dynamic ref (above)
  _setTip('kpiImmoViewVal', fp.map(p => {
    const ref = p.referenceValue && p.referenceValue !== p.value
      ? ' <span style="color:#a0aec0">(r\u00e9f ' + _fmtK(p.referenceValue) + ' ' + (p.valueDate || '') + ')</span>' : '';
    return p.name + ' : <b>' + _fmtK(p.value) + '</b>' + ref;
  }).join('<br>') + '<br><span style="color:#a0aec0;font-size:11px">Estimation dynamique (appr\u00e9ciation mensuelle)</span>' + _vilNote, true);

  // 6. CRD Total — per property (bottom row → above)
  _setTip('kpiImmoViewCRD', fp.map(p =>
    p.name + ' : <b>' + _fmtK(p.crd) + '</b> <span style="color:#a0aec0">(fin ' + p.endYear + ')</span>'
  ).join('<br>') + _vilNote, true);

  // 7. Création Richesse /mois — breakdown by type (bottom row → above)
  _setTip('kpiImmoViewWealth',
    'Capital amorti : <b>' + fmt(fTotalWealthBreakdown.capitalAmorti || 0) + '</b><br>'
    + 'Appr\u00e9ciation : <b>' + fmt(fTotalWealthBreakdown.appreciation || 0) + '</b><br>'
    + 'Cash flow : <b>' + fmt(fTotalWealthBreakdown.cashflow || 0) + '</b>'
    + (fTotalWealthBreakdown.cashflow < 0 ? '<br><span style="color:#fc8181">Effort d\'\u00e9pargne : -' + fmt(Math.abs(fTotalWealthBreakdown.cashflow)) + '</span>' : '')
    + '<br><span style="color:#a0aec0;font-size:11px">\u00d7 12 = ' + fmt(fTotalWealthCreation * 12) + '/an</span>'
    + _vilNote
  , true);

  // 8. LTV Moyen — per property (bottom row → above)
  _setTip('kpiImmoViewLTV', fp.map(p =>
    p.name + ' : <b>' + p.ltv.toFixed(0) + '%</b> <span style="color:#a0aec0">(' + _fmtK(p.crd) + ' / ' + _fmtK(p.value) + ')</span>'
  ).join('<br>') + _vilNote, true);

  // Property cards with fiscal data — clickable for detail panel
  const grid = document.getElementById('propGrid');
  if (grid) {
    grid.innerHTML = '';
    iv.properties.forEach((prop, idx) => {
      const card = document.createElement('div');
      const isExcluded = !_immoIncludeVillejuif && prop.loanKey === 'villejuif';
      card.className = 'prop-card' + (prop.conditional ? ' conditional' : '');
      if (isExcluded) card.style.opacity = '0.45';
      card.dataset.loanKey = prop.loanKey;
      const cfClass = prop.cf >= 0 ? 'pl-pos' : 'pl-neg';
      const cfSign = prop.cf >= 0 ? '+' : '';
      const f = prop.fiscalite;
      const fiscLine = f ? '<div class="prop-kpi"><div class="pk-val pl-neg">' + f.monthlyImpot + '</div><div class="pk-label">Impot /mois</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + (prop.yieldNetFiscal || 0).toFixed(1) + '%</div><div class="pk-label">Yield net fiscal</div></div>'
        : '';
      const regimeDisplay = f ? (f.regime === 'lmnp-amort' ? 'LMNP réel (amort.)' : f.type === 'lmnp' ? 'LMNP ' + f.regime : 'NU ' + f.regime) : '';
      const regimeBadge = f ? '<span style="background:#ebf8ff;padding:1px 6px;border-radius:4px;font-size:10px;color:#2b6cb0;margin-left:4px">' + regimeDisplay + '</span>' : '';
      const netEq = prop.exitCosts ? prop.exitCosts.netEquityAfterExit : prop.equity;
      const netEqClass = netEq >= 0 ? 'pl-pos' : 'pl-neg';
      // Dynamic valuation label: show reference → current if different
      const valLabel = prop.referenceValue && prop.referenceValue !== prop.value
        ? '<div class="pk-val">' + fmt(prop.value) + '</div><div class="pk-label">Valeur est. <span style="font-size:9px;color:var(--gray);">(réf ' + fmt(prop.referenceValue) + ' ' + (prop.valueDate || '') + ')</span></div>'
        : '<div class="pk-val">' + fmt(prop.value) + '</div><div class="pk-label">Valeur</div>';
      card.innerHTML = '<h3>' + prop.name + regimeBadge + (prop.conditional ? ' <span style="background:#fef3c7;padding:1px 5px;border-radius:4px;font-size:10px;color:#92400e;">CONDITIONNEL</span>' : '') + '</h3>'
        + '<div class="prop-owner">' + prop.owner + ' <span style="font-size:10px;color:var(--accent);margin-left:4px;">▸ voir détails</span></div>'
        + '<div class="prop-kpis">'
        + '<div class="prop-kpi">' + valLabel + '</div>'
        + '<div class="prop-kpi"><div class="pk-val">' + fmt(prop.crd) + '</div><div class="pk-label">CRD</div></div>'
        + '<div class="prop-kpi"><div class="pk-val pl-pos">' + fmt(prop.equity) + '</div><div class="pk-label">Equity brute</div></div>'
        + '<div class="prop-kpi"><div class="pk-val ' + netEqClass + '">' + fmt(Math.round(netEq)) + '</div><div class="pk-label">Equity nette sortie</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + prop.ltv.toFixed(0) + '%</div><div class="pk-label">LTV</div></div>'
        + '<div class="prop-kpi"><div class="pk-val ' + cfClass + '">' + cfSign + prop.cf + '</div><div class="pk-label">CF /mois</div></div>'
        + '<div class="prop-kpi"><div class="pk-val">' + prop.loyer + '</div><div class="pk-label">Loyer HC</div></div>'
        + fiscLine
        + '</div>';
      card.addEventListener('click', () => {
        // Navigate to apartment sub-view
        const subBtn = document.querySelector('.immo-sub-btn[data-subview="apt_' + prop.loanKey + '"]');
        if (subBtn) subBtn.click();
      });
      grid.appendChild(card);
    });
    // Close button
    document.getElementById('propDetailClose')?.addEventListener('click', () => {
      document.getElementById('propDetailPanel').style.display = 'none';
      grid.querySelectorAll('.prop-card').forEach(c => c.classList.remove('active-prop'));
    });
  }

  // ── LMP Alert Section (Nezha) ──
  const lmpSection = document.getElementById('lmpAlertSection');
  if (lmpSection) {
    const rueilProp = fp.find(p => p.loanKey === 'rueil');
    const villejuifProp = _immoIncludeVillejuif ? iv.properties.find(p => p.loanKey === 'villejuif') : null;

    // Calculate LMP thresholds
    const LMP_THRESHOLD = 23000; // €/an
    const rueilLoyer = rueilProp ? (rueilProp.loyer * 12) : 0; // Annual rent
    // For "after Villejuif" projection: use future loyer even if not yet operational
    const villejuifFutureLoyer = villejuifProp ? ((villejuifProp.loyer || villejuifProp.totalRevenue || 1700) * 12) : 0;
    const totalLoyerAnnuel = rueilLoyer + villejuifFutureLoyer;

    // LMP is triggered when:
    // 1. Recettes meublées > 23,000€/an AND
    // 2. Recettes > revenus d'activité (auto-met for non-resident Nezha)
    const isRueilAloneLMP = rueilLoyer > LMP_THRESHOLD;
    const isCombinedLMP = totalLoyerAnnuel > LMP_THRESHOLD;

    // Show alert if villejuif will be meublé OR already triggered
    if (rueilProp) {
      // ═══ COMPACT BANNER (always visible) ═══
      let html = '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 16px;margin:12px 0;cursor:pointer;"'
        + ' onclick="var d=this.nextElementSibling;d.style.display=d.style.display===\'none\'?\'block\':\'none\';this.querySelector(\'.lmp-arrow\').textContent=d.style.display===\'none\'?\'▸\':\'▾\'">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;">'
        + '<div style="font-size:13px;color:#1e40af;">'
        + '<strong>Seuil LMP</strong> — Rueil seul: <span style="color:' + (isRueilAloneLMP ? '#dc2626' : '#16a34a') + '">' + fmt(Math.round(rueilLoyer)) + '€/an (' + (isRueilAloneLMP ? 'LMP' : 'LMNP') + ')</span> · '
        + 'Après Villejuif: <span style="color:' + (isCombinedLMP ? '#dc2626' : '#16a34a') + '">' + fmt(Math.round(totalLoyerAnnuel)) + '€/an ' + (isCombinedLMP ? '→ LMP auto' : '') + '</span>'
        + '</div>'
        + '<span class="lmp-arrow" style="color:#1e40af;font-size:14px;">▸</span>'
        + '</div>'
        + '</div>'
        + '<div style="display:none;">'
        + '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;margin:12px 0;">'
        + '<h4 style="color:#1e40af;margin:0 0 12px;">Seuil LMP — Détails</h4>'
        + '<p style="font-size:13px;color:#1e3a5f;margin:0 0 12px;">'
        + 'Le statut <strong>LMP (Loueur Meublé Professionnel)</strong> s\'applique quand les recettes meublées dépassent <strong>23 000\u20ac/an</strong> ET les revenus d\'activité du foyer fiscal.'
        + '</p>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'
        + '<div style="background:#dbeafe;border-radius:8px;padding:12px;text-align:center;">'
        + '<div style="font-size:11px;color:#1e40af;">Aujourd\'hui (Rueil seul)</div>'
        + '<div style="font-size:22px;font-weight:800;color:' + (isRueilAloneLMP ? '#dc2626' : '#16a34a') + ';">' + fmt(Math.round(rueilLoyer)) + '</div>'
        + '<div style="font-size:11px;color:' + (isRueilAloneLMP ? '#dc2626' : '#16a34a') + ';">' + (isRueilAloneLMP ? 'Au-dessus du seuil \u2192 LMP' : 'Sous le seuil \u2192 LMNP') + '</div>'
        + '</div>'
        + '<div style="background:#dbeafe;border-radius:8px;padding:12px;text-align:center;">'
        + '<div style="font-size:11px;color:#1e40af;">Apr\u00e8s Villejuif (2029)</div>'
        + '<div style="font-size:22px;font-weight:800;color:' + (isCombinedLMP ? '#dc2626' : '#16a34a') + ';">' + fmt(Math.round(totalLoyerAnnuel)) + '</div>'
        + '<div style="font-size:11px;color:' + (isCombinedLMP ? '#dc2626' : '#16a34a') + ';">' + (isCombinedLMP ? 'Au-dessus du seuil \u2192 LMP' : 'Sous le seuil \u2192 LMNP') + '</div>'
        + '</div>'
        + '</div>'
        + '<div style="font-size:12px;color:#1e3a5f;">'
        + '<strong>Impacts du passage LMP :</strong>'
        + '<ul style="margin:6px 0;padding-left:20px;">'
        + '<li><span style="color:#dc2626;font-weight:600;">Cotisations sociales SSI ~40%</span> sur le b\u00e9n\u00e9fice net (vs 17.2% PS en LMNP)</li>'
        + '<li><span style="color:#dc2626;font-weight:600;">Affiliation SSI obligatoire</span> m\u00eame pour non-r\u00e9sident</li>'
        + '<li><span style="color:#16a34a;font-weight:600;">D\u00e9ficit imputable</span> sur le revenu global (avantage)</li>'
        + '<li><span style="color:#16a34a;font-weight:600;">PV professionnelle</span> : exon\u00e9ration totale si >5 ans ET CA <90K\u20ac</li>'
        + '</ul>'
        + '</div>'
        + '<div style="background:#e0e7ff;border-radius:6px;padding:10px;font-size:11px;color:#312e81;margin-top:8px;">'
        + '<strong>Non-r\u00e9sident :</strong> Nezha n\'a pas de revenus d\'activit\u00e9 en France \u2192 la condition "recettes > revenus d\'activit\u00e9" est automatiquement remplie. D\u00e8s que Villejuif est lou\u00e9 en meubl\u00e9, le statut LMP s\'applique.'
        + '</div>';

      // ═══ FEATURE 2: Tax on Rental Income Breakdown ═══
      html += '<div style="margin-top:16px;background:#fef9c3;border-radius:8px;padding:12px;">'
        + '<h5 style="color:#92400e;margin:0 0 12px;font-size:13px;">📊 Impact fiscal sur 1 000€ de revenu locatif net</h5>';

      if (rueilProp) {
        const monthlyRent = rueilProp.loyer || 1300;
        const monthlyAmortizationLMNP = (240000 * 0.80 * 0.02) / 12; // ~320€
        const taxableIncomeLMNP = Math.max(0, monthlyRent - monthlyAmortizationLMNP);
        const taxableIncomeLMP = Math.max(0, monthlyRent - monthlyAmortizationLMNP);

        const irRate = 0.20;
        const psRateLMNP = 0.172;
        const ssiRateLMP = 0.40;

        const irLMNP = Math.round(taxableIncomeLMNP * irRate);
        const psLMNP = Math.round(taxableIncomeLMNP * psRateLMNP);
        const totalTaxLMNP = irLMNP + psLMNP;
        const netAfterTaxLMNP = monthlyRent - totalTaxLMNP;

        const irLMP = Math.round(taxableIncomeLMP * irRate);
        const ssiLMP = Math.round(taxableIncomeLMP * ssiRateLMP);
        const totalTaxLMP = irLMP + ssiLMP;
        const netAfterTaxLMP = monthlyRent - totalTaxLMP;

        html += '<div style="overflow-x:auto;font-size:12px;">'
          + '<table style="width:100%;border-collapse:collapse;margin-top:8px;">'
          + '<tr style="border-bottom:2px solid #d97706;background:#fef3c7;">'
          + '<td style="padding:6px;text-align:left;font-weight:600;">Revenu</td>'
          + '<td style="padding:6px;text-align:right;font-weight:600;">LMNP réel</td>'
          + '<td style="padding:6px;text-align:right;font-weight:600;">LMP</td>'
          + '</tr>'
          + '<tr style="border-bottom:1px solid #fef3c7;background:#fffbeb;">'
          + '<td style="padding:6px;text-align:left;">Loyer net mensuel</td>'
          + '<td style="padding:6px;text-align:right;font-weight:600;">' + fmt(Math.round(monthlyRent)) + '€</td>'
          + '<td style="padding:6px;text-align:right;font-weight:600;">' + fmt(Math.round(monthlyRent)) + '€</td>'
          + '</tr>'
          + '<tr style="border-bottom:1px solid #fef3c7;background:#fffbeb;">'
          + '<td style="padding:6px;text-align:left;font-size:11px;color:#666;">Amortissement (~' + Math.round(monthlyAmortizationLMNP) + '€)</td>'
          + '<td style="padding:6px;text-align:right;font-size:11px;color:#666;">−' + fmt(Math.round(monthlyAmortizationLMNP)) + '€</td>'
          + '<td style="padding:6px;text-align:right;font-size:11px;color:#666;">−' + fmt(Math.round(monthlyAmortizationLMNP)) + '€</td>'
          + '</tr>'
          + '<tr style="border-bottom:1px solid #fef3c7;background:#fef9c3;">'
          + '<td style="padding:6px;text-align:left;font-weight:600;">Revenu imposable</td>'
          + '<td style="padding:6px;text-align:right;font-weight:600;">' + fmt(Math.round(taxableIncomeLMNP)) + '€</td>'
          + '<td style="padding:6px;text-align:right;font-weight:600;">' + fmt(Math.round(taxableIncomeLMP)) + '€</td>'
          + '</tr>'
          + '<tr style="border-bottom:1px solid #fef3c7;background:#fffbeb;">'
          + '<td style="padding:6px;text-align:left;font-size:11px;color:#666;">IR (20%)</td>'
          + '<td style="padding:6px;text-align:right;font-size:11px;color:#666;">−' + fmt(irLMNP) + '€</td>'
          + '<td style="padding:6px;text-align:right;font-size:11px;color:#666;">−' + fmt(irLMP) + '€</td>'
          + '</tr>'
          + '<tr style="border-bottom:1px solid #fef3c7;background:#fffbeb;">'
          + '<td style="padding:6px;text-align:left;font-size:11px;color:#666;">PS (17.2%) / SSI (~40%)</td>'
          + '<td style="padding:6px;text-align:right;font-size:11px;color:#666;">−' + fmt(psLMNP) + '€</td>'
          + '<td style="padding:6px;text-align:right;font-size:11px;color:#dc2626;font-weight:600;">−' + fmt(ssiLMP) + '€</td>'
          + '</tr>'
          + '<tr style="border-bottom:2px solid #d97706;background:#fef3c7;">'
          + '<td style="padding:6px;text-align:left;font-weight:600;">Total fiscal</td>'
          + '<td style="padding:6px;text-align:right;font-weight:600;">' + fmt(totalTaxLMNP) + '€</td>'
          + '<td style="padding:6px;text-align:right;font-weight:600;color:#dc2626;">' + fmt(totalTaxLMP) + '€</td>'
          + '</tr>'
          + '<tr style="background:#fef9c3;">'
          + '<td style="padding:8px;text-align:left;font-weight:600;">Net après impôt</td>'
          + '<td style="padding:8px;text-align:right;font-weight:600;color:#16a34a;">' + fmt(Math.round(netAfterTaxLMNP)) + '€</td>'
          + '<td style="padding:8px;text-align:right;font-weight:600;color:#dc2626;">' + fmt(Math.round(netAfterTaxLMP)) + '€</td>'
          + '</tr>'
          + '</table>'
          + '</div>';
      }

      html += '</div>';

      // ═══ FEATURE 1: LMNP vs LMP Exit Costs Comparison ═══
      html += '<div style="margin-top:16px;background:#fffbeb;border:1px solid #d97706;border-radius:8px;padding:12px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;cursor:pointer;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === \'none\' ? \'block\' : \'none\';this.querySelector(\'.toggle-arrow\').style.transform = this.nextElementSibling.style.display === \'none\' ? \'rotate(0deg)\' : \'rotate(180deg)\';">'
        + '<h5 style="color:#92400e;margin:0;font-size:13px;">🔍 Voir comparaison LMNP vs LMP (2026-2050)</h5>'
        + '<span class="toggle-arrow" style="display:inline-block;font-size:16px;transition:transform 200ms;">▼</span>'
        + '</div>'
        + '<div id="lmpExitCostsTable" style="display:none;margin-top:8px;overflow-x:auto;font-size:11px;"></div>'
        + '</div>';

      html += '</div>'
        + '</div>'; // Close the hidden container

      lmpSection.innerHTML = html;

      // ═══ Populate Exit Costs Comparison Table ═══
      setTimeout(() => {
        const tableDiv = document.getElementById('lmpExitCostsTable');
        if (tableDiv && rueilProp) {
          const purchasePrice = 240000; // IC.properties.rueil.purchasePrice
          const lmnpStartDate = '2025-10'; // [year, month]
          const [lmnpYear, lmnpMonth] = lmnpStartDate.split('-').map(Number);

          let tableHtml = '<table style="width:100%;border-collapse:collapse;background:white;">'
            + '<thead style="background:#fef3c7;border-bottom:2px solid #d97706;position:sticky;top:0;">'
            + '<tr>'
            + '<th style="padding:6px;text-align:center;font-size:10px;">Année</th>'
            + '<th style="padding:6px;text-align:center;font-size:10px;">Détention</th>'
            + '<th style="padding:6px;text-align:right;font-size:10px;">LMNP: PV Nette</th>'
            + '<th style="padding:6px;text-align:right;font-size:10px;">LMNP: Taxe</th>'
            + '<th style="padding:6px;text-align:right;font-size:10px;">LMP: Exonération</th>'
            + '<th style="padding:6px;text-align:right;font-size:10px;">Différence</th>'
            + '</tr>'
            + '</thead>'
            + '<tbody>';

          // Simulate 2026-2050
          for (let year = 2026; year <= 2050; year++) {
            const holdingYears = year - 2019; // Purchase in 2019
            const lmnpYears = year - lmnpYear; // LMNP starts 2025-10

            // Project value with 1% annual appreciation
            let projectedValue = purchasePrice;
            for (let y = 2019; y < year; y++) {
              projectedValue *= 1.01;
            }

            // LMNP: Calculate amortissements
            const totalAmortLMNP = Math.max(0, purchasePrice * 0.80 * 0.02 * Math.max(0, lmnpYears));

            // LMNP: Plus-value brute = salePrice - (purchasePrice + 7.5%) + amortissements réintégrés
            const fraisAcquisition = purchasePrice * 0.075;
            const pvBruteLMNP = projectedValue - (purchasePrice + fraisAcquisition) + totalAmortLMNP;

            // LMNP: Apply abattements
            let irAbattLMNP = 0, psAbattLMNP = 0;
            if (holdingYears >= 22) {
              irAbattLMNP = 1;
            } else if (holdingYears >= 6) {
              irAbattLMNP = Math.min(1, (holdingYears - 6) * 0.06 + (holdingYears > 22 ? 0.04 : 0));
            }
            if (holdingYears >= 30) {
              psAbattLMNP = 1;
            } else if (holdingYears >= 23) {
              psAbattLMNP = Math.min(1, (holdingYears - 22) * 0.016 + (holdingYears - 23) * 0.09);
            } else if (holdingYears >= 6) {
              psAbattLMNP = Math.min(1, (holdingYears - 6) * 0.0165);
            }

            const pvNetteIRLMNP = pvBruteLMNP * (1 - irAbattLMNP);
            const pvNettePS = pvBruteLMNP * (1 - psAbattLMNP);
            const irLMNP = Math.round(pvNetteIRLMNP * 0.19);
            const psLMNP = Math.round(pvNettePS * 0.172);
            const taxLMNP = irLMNP + psLMNP;

            // LMP: Short-term (amortissements) taxed at 37.2%, Long-term (appreciation) at 30%
            // BUT: Full exemption if > 5 years AND CA < 90K€/an
            let taxLMP = 0;
            const annualCA = rueilProp.loyer * 12; // ~15.6K€
            if (lmnpYears >= 5 && annualCA < 90000) {
              // Exonération totale
              taxLMP = 0;
            } else {
              // Part amortissements (short-term): 37.2%
              const pvAmortissements = totalAmortLMNP;
              const pvAppreciation = pvBruteLMNP - pvAmortissements;
              const taxAmortissements = Math.round(pvAmortissements * 0.372);
              const taxAppreciation = Math.round(pvAppreciation * 0.30);
              taxLMP = taxAmortissements + taxAppreciation;
            }

            const difference = taxLMNP - taxLMP;
            const detentionStr = holdingYears + ' ans';

            tableHtml += '<tr style="border-bottom:1px solid #e5e5e5;background:' + (year % 2 === 0 ? '#fafafa' : '#fff') + ';">'
              + '<td style="padding:4px;text-align:center;font-size:10px;font-weight:600;">' + year + '</td>'
              + '<td style="padding:4px;text-align:center;font-size:10px;">' + detentionStr + '</td>'
              + '<td style="padding:4px;text-align:right;font-size:10px;">' + fmt(Math.round(pvBruteLMNP)) + '€</td>'
              + '<td style="padding:4px;text-align:right;font-size:10px;font-weight:600;color:#dc2626;">' + fmt(taxLMNP) + '€</td>'
              + '<td style="padding:4px;text-align:right;font-size:10px;font-weight:600;color:' + (taxLMP === 0 ? '#16a34a' : '#dc2626') + ';">' + fmt(taxLMP) + '€</td>'
              + '<td style="padding:4px;text-align:right;font-size:10px;font-weight:600;color:' + (difference >= 0 ? '#16a34a' : '#dc2626') + ';">' + fmt(difference) + '€</td>'
              + '</tr>';
          }

          tableHtml += '</tbody></table>';
          tableDiv.innerHTML = tableHtml;
        }
      }, 0);
    } else {
      lmpSection.innerHTML = '';
    }
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
    fp.forEach(prop => {
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

  // ── Dynamic CF Table (was hardcoded in HTML) ──
  const cfTableEl = document.getElementById('immoCFTable');
  if (cfTableEl) {
    let html = '<table style="margin-top:10px;"><thead><tr><th>Bien</th><th class="num">Mensualite pret</th><th class="num">Assurance credit</th><th class="num">PNO</th><th class="num">TF /12</th><th class="num">Copro /12</th><th class="num">Total charges</th><th class="num">Loyer HC</th><th class="num">Revenus totaux</th><th class="num" style="background:#f0fff4;color:var(--green)">Cash Flow</th></tr></thead><tbody>';
    fp.forEach((prop, i) => {
      const cd = prop.chargesDetail || {};
      const rowBg = i === 1 ? ' style="background:#f0f5ff"' : '';
      const cfClass = prop.conditional ? '' : (prop.cf >= 0 ? 'pos' : 'neg');
      const cfText = prop.conditional ? '--' : ((prop.cf >= 0 ? '+' : '') + Math.round(prop.cf));
      const loyerText = prop.conditional ? '<span style="color:var(--gray)">TBD</span>' : Math.round(prop.loyer || 0).toLocaleString('fr-FR');
      const revText = prop.conditional ? '<span style="color:var(--gray)">TBD</span>' : Math.round(prop.totalRevenue || 0).toLocaleString('fr-FR');
      const cfStyle = prop.conditional ? ' style="color:var(--gray)"' : ' style="font-weight:700"';
      const desc = prop.conditional ? '<span style="font-size:11px;color:#92400e">VEFA \u2014 livraison ete 2029</span>'
        : '<span style="font-size:11px;color:var(--gray)">HC ' + (prop.loyer || 0) + '</span>';
      html += '<tr' + rowBg + '>'
        + '<td><strong>' + prop.name + '</strong><br>' + desc + '</td>'
        + '<td class="num">' + Math.round(cd.pret || prop.monthlyPret || 0).toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + Math.round(cd.assurance || prop.monthlyAssurance || 0).toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + Math.round(cd.pno || 0).toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + Math.round(cd.tf || 0).toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + Math.round(cd.copro || 0).toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="font-weight:600">' + Math.round(prop.charges || 0).toLocaleString('fr-FR') + '</td>'
        + '<td class="num">' + loyerText + '</td>'
        + '<td class="num">' + revText + '</td>'
        + '<td class="num ' + cfClass + '"' + cfStyle + '>' + cfText + '</td>'
        + '</tr>';
    });
    html += '</tbody></table>';
    cfTableEl.innerHTML = html;
  }

  // ── CF Analysis ──
  const cfAnalysis = document.getElementById('immoCFAnalysis');
  if (cfAnalysis) {
    const autofinP = fp.filter(p => !p.conditional && p.cf >= 0);
    const deficitP = fp.filter(p => !p.conditional && p.cf < 0);
    let text = '<strong>Analyse :</strong> ';
    autofinP.forEach(p => { text += p.name + ' est autofinance (+' + Math.round(p.cf) + '/mois : revenus ' + Math.round(p.totalRevenue) + ' vs charges ' + Math.round(p.charges) + '). '; });
    deficitP.forEach(p => { text += p.name + ' a un deficit de ' + Math.round(p.cf) + '/mois (revenus ' + Math.round(p.totalRevenue) + ' vs charges ' + Math.round(p.charges) + '). '; });
    cfAnalysis.innerHTML = text;
  }

  // ── Villejuif Simulation table ──
  const vilSim = document.getElementById('villejuifSimulation');
  if (vilSim) {
    const vilLoans = IMMO_CONSTANTS.loans.villejuifLoans || [];
    const totalPrincipal = vilLoans.reduce((s, l) => s + l.principal, 0);
    const franchiseM = vilLoans[0] && vilLoans[0].periods ? vilLoans[0].periods[0].months : 36;
    // Bank scenario: full disbursement at day 1
    const bankInterest = Math.round(totalPrincipal * 0.031 * (franchiseM / 12)); // ~3.1% weighted avg
    const bankCRD = totalPrincipal + bankInterest;
    // Realistic: ~19% less due to progressive disbursement
    const realInterest = Math.round(bankInterest * 0.81);
    const realCRD = totalPrincipal + realInterest;
    const saving = bankInterest - realInterest;
    vilSim.innerHTML =
      '<strong>Villejuif \u2014 Simulation banque vs estimation realiste :</strong><br>' +
      'La banque simule un deblocage integral du credit au jour 1. En realite, les fonds VEFA se debloquent progressivement.<br><br>' +
      '<table style="font-size:12px;margin:8px 0">' +
      '<tr><th></th><th class="num">Simulation banque</th><th class="num">Estimation realiste</th><th class="num">Economie</th></tr>' +
      '<tr><td>Interets capitalises (' + franchiseM + ' mois)</td><td class="num">' + bankInterest.toLocaleString('fr-FR') + '</td><td class="num" style="color:var(--green);font-weight:600">~' + realInterest.toLocaleString('fr-FR') + '</td><td class="num pos">~' + saving.toLocaleString('fr-FR') + ' (-' + Math.round(saving / bankInterest * 100) + '%)</td></tr>' +
      '<tr><td>CRD apres franchise</td><td class="num">' + bankCRD.toLocaleString('fr-FR') + '</td><td class="num" style="color:var(--green);font-weight:600">~' + realCRD.toLocaleString('fr-FR') + '</td><td class="num pos">~' + saving.toLocaleString('fr-FR') + '</td></tr>' +
      '</table>' +
      '<span style="font-size:11px;color:var(--gray)">Hypothese : fondations M0, hors d\'eau M6, hors d\'air M9, achevement M15, livraison M18. Apport utilise en priorite.</span>';
  }

  // ── Immo Strategy ──
  const stratBox = document.getElementById('immoStrategyInsight');
  if (stratBox) {
    const totalVal = iv.totalValue;
    const totalDebt = iv.totalCRD;
    const totalEq = iv.totalEquity;
    const leverage = totalDebt > 0 ? Math.round(totalDebt / totalVal * 100) : 0;
    const cfTotal = iv.totalCF;
    const cfAnnual = cfTotal * 12;
    const wealthTotal = iv.totalWealthCreation;
    stratBox.innerHTML =
      '<strong>Strategie Immo Couple :</strong><br>' +
      '- <strong>Bilan consolide :</strong> ' + Math.round(totalVal / 1000) + 'K de patrimoine immo, ' + Math.round(totalDebt / 1000) + 'K de dette, ' + Math.round(totalEq / 1000) + 'K d\'equity. Taux d\'endettement immo de ~' + leverage + '%.<br>' +
      '- <strong>Cash flow consolide : ' + (cfTotal >= 0 ? '+' : '') + cfTotal + '/mois</strong> aujourd\'hui (' + Math.abs(cfAnnual).toLocaleString('fr-FR') + '/an).<br>' +
      '- <strong>Creation de richesse : +' + Math.round(wealthTotal).toLocaleString('fr-FR') + '/mois</strong> (' + Math.round(wealthTotal * 12 / 1000) + 'K/an) via le remboursement du capital + appreciation.<br>' +
      '- <span style="color:var(--red)">Risque structurel :</span> Concentration 100% IDF, zero diversification geo. Un retournement francilien de -10% couterait ~' + Math.round(totalVal * 0.1 / 1000) + 'K d\'equity.<br>' +
      '- <span style="color:var(--green)">Trajectoire :</span> A 5 ans, equity immo estimee > ' + Math.round((totalEq + wealthTotal * 60) / 1000) + 'K (vs ' + Math.round(totalEq / 1000) + 'K ajd).';
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

// ============ TIMELINE RENDERING HELPER ============
function renderTimelineHTML(timeline) {
  if (!timeline || timeline.length === 0) return '';
  let html = '<h4 style="margin:16px 0 8px;font-size:13px;color:#c05621;">Timeline des échéances</h4>';
  html += '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:12px;">';
  const now = new Date();
  timeline.forEach(t => {
    const [ty, tm] = t.date.split('-').map(Number);
    const tDate = new Date(ty, tm - 1);
    const isPast = tDate < now;
    const style = isPast ? 'color:#a0aec0;' : 'color:#2d3748;font-weight:600;';
    const marker = isPast ? '✓' : '▸';
    html += '<div style="' + style + '">' + marker + ' ' + t.date + '</div><div style="' + style + '">' + t.event + '</div>';
  });
  html += '</div>';
  return html;
}

// ============ PROPERTY INFO CARD (Details) ============
function renderPropertyInfoCard(details) {
  if (!details) return '';

  // Generate unique ID to prevent conflicts when multiple cards exist
  const uniqueId = 'propCard_' + Math.random().toString(36).substr(2, 6);

  // Color mapping for rooms
  const roomColors = {
    'Séjour': '#3b82f6',
    'Séjour/Cuisine': '#3b82f6',
    'Salon': '#3b82f6',
    'Cuisine': '#3b82f6',
    'Entrée': '#94a3b8',
    'Dégagement': '#94a3b8',
    'Loggia': '#d69e2e',
    'Chambre': '#22c55e',
    'Chambre 1': '#22c55e',
    'Chambre 2': '#22c55e',
    'Salle de bain': '#94a3b8',
    'Salle d\'eau': '#94a3b8',
    'Sdb': '#94a3b8',
    'WC': '#94a3b8',
    'Dgt': '#94a3b8',
  };

  const getRoomColor = (name) => {
    for (const key in roomColors) {
      if (name.toLowerCase().includes(key.toLowerCase())) {
        return roomColors[key];
      }
    }
    return '#cbd5e0';
  };

  let html = '<div style="border:1px solid var(--border, #e7e5e4);border-radius:8px;overflow:hidden;margin-bottom:16px;">';

  // === LEVEL 1: BANNER (always visible) ===
  html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--surface, #fff);">';

  // Left: type, lot, floor, building, developer
  html += '<div>';
  html += '<span style="font-weight:700;font-size:15px;">' + (details.type || 'Appartement') + ' n°' + (details.lot || '') + '</span>';
  html += '<span style="color:#78716c;font-size:13px;margin-left:8px;">';
  const bannerParts = [];
  if (details.floor) bannerParts.push(details.floor);
  if (details.building) bannerParts.push(details.building);
  if (details.developer) bannerParts.push(details.developer);
  html += bannerParts.join(' · ');
  html += '</span>';
  html += '</div>';

  // Right: surface
  html += '<div style="text-align:right;">';
  if (details.surfaceHabitable) {
    html += '<span style="font-size:16px;font-weight:700;">' + details.surfaceHabitable.toFixed(1) + ' m²</span>';
  }
  if (details.loggia) {
    html += '<span style="color:#b45309;font-size:12px;margin-left:6px;">+ ' + details.loggia.toFixed(1) + ' m² log</span>';
  }
  html += '</div>';

  html += '</div>'; // end banner

  // === BUTTONS ROW ===
  html += '<div style="display:flex;border-top:1px solid var(--border, #e7e5e4);background:#fafaf9;">';

  // Details button
  html += '<button onclick="var d=document.getElementById(\'' + uniqueId + '_details\');d.style.display=d.style.display===\'none\'?\'block\':\'none\';this.querySelector(\'span\').textContent=d.style.display===\'none\'?\'\u25BC\':\'\u25B2\'" ';
  html += 'style="flex:1;padding:8px;border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:500;color:#78716c;transition:color 0.2s;">';
  html += 'D\u00e9tails <span>\u25BC</span></button>';

  html += '</div>';

  // === LEVEL 2: DETAILS (hidden by default) ===
  html += '<div id="' + uniqueId + '_details" style="display:none;padding:16px;border-top:1px solid var(--border, #e7e5e4);">';

  // Room bar — click to reveal surface
  if (details.rooms && details.rooms.length > 0) {
    const total = details.surfaceTotale || details.rooms.reduce((s, r) => s + (r.surface || 0), 0);
    html += '<div style="display:flex;height:28px;border-radius:6px;overflow:hidden;margin:10px 0;font-size:10px;">';
    details.rooms.forEach((r, i) => {
      if (r.surface && r.surface > 0) {
        const pct = Math.max(3, r.surface / total * 100);
        const color = getRoomColor(r.name);
        html += '<div style="flex:' + pct + ';background:' + color + ';display:flex;align-items:center;justify-content:center;';
        html += 'color:white;cursor:pointer;position:relative;transition:all 0.2s;min-width:0;overflow:hidden;white-space:nowrap;" ';
        html += 'onclick="var s=this.querySelector(\'.rs\');if(s.style.display===\'block\'){s.style.display=\'none\'}else{this.parentElement.querySelectorAll(\'.rs\').forEach(function(e){e.style.display=\'none\'});s.style.display=\'block\'}">';
        html += '<span style="padding:0 4px;font-size:9px;">' + r.name + '</span>';
        html += '<div class="rs" style="display:none;position:absolute;top:-28px;left:50%;transform:translateX(-50%);background:#1a202c;color:white;padding:3px 8px;border-radius:4px;font-size:11px;white-space:nowrap;z-index:5;">';
        html += r.name + ' — ' + (r.surface ? r.surface.toFixed(1) : '?') + ' m²</div>';
        html += '</div>';
      }
    });
    // Add loggia if present
    if (details.loggia) {
      const pct = Math.max(3, details.loggia / total * 100);
      html += '<div style="flex:' + pct + ';background:#d69e2e;display:flex;align-items:center;justify-content:center;color:white;cursor:pointer;position:relative;transition:all 0.2s;" ';
      html += 'onclick="var s=this.querySelector(\'.rs\');if(s.style.display===\'block\'){s.style.display=\'none\'}else{this.parentElement.querySelectorAll(\'.rs\').forEach(function(e){e.style.display=\'none\'});s.style.display=\'block\'}">';
      html += '<span style="padding:0 4px;font-size:9px;">Loggia</span>';
      html += '<div class="rs" style="display:none;position:absolute;top:-28px;left:50%;transform:translateX(-50%);background:#1a202c;color:white;padding:3px 8px;border-radius:4px;font-size:11px;white-space:nowrap;z-index:5;">';
      html += 'Loggia — ' + details.loggia.toFixed(1) + ' m²</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  // Characteristics pills
  let pills = [];
  if (details.exposure) pills.push({ text: '\u263C ' + details.exposure, bg: '#e2e8f0' });
  if (details.dpe) pills.push({ text: 'DPE ' + details.dpe, bg: '#c6f6d5' });
  if (details.norm) pills.push({ text: details.norm, bg: '#bee3f8' });
  if (details.parking !== null && details.parking !== undefined) {
    pills.push({ text: details.parking ? 'Parking' : 'Pas de parking', bg: details.parking ? '#c6f6d5' : '#fed7d7' });
  }
  if (details.cave !== null && details.cave !== undefined) {
    pills.push({ text: details.cave ? 'Cave' : 'Pas de cave', bg: details.cave ? '#c6f6d5' : '#fed7d7' });
  }

  if (pills.length > 0) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">';
    pills.forEach(pill => {
      html += '<span style="background:' + pill.bg + ';border-radius:12px;padding:4px 10px;font-size:11px;display:inline-block;border:1px solid rgba(0,0,0,0.05);">' + pill.text + '</span>';
    });
    html += '</div>';
  }

  // Room dimensions display
  if (details.rooms && details.rooms.length > 0) {
    html += '<div style="margin:10px 0;">';
    html += '<div style="font-size:12px;font-weight:600;color:#4a5568;margin-bottom:8px;">Dimensions des pièces</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px;">';
    details.rooms.forEach(r => {
      html += '<div style="display:flex;justify-content:space-between;padding:4px 8px;background:#f8fafc;border-radius:4px;">';
      html += '<span style="color:#4a5568;">' + r.name + '</span>';
      if (r.surface) {
        html += '<span style="font-weight:600;">' + r.surface.toFixed(2) + ' m²</span>';
      }
      html += '</div>';
    });
    html += '</div>';

    // Total habitable surface
    if (details.surfaceHabitable) {
      html += '<div style="display:flex;justify-content:space-between;padding:6px 8px;margin-top:4px;border-top:1px solid #e2e8f0;font-weight:600;font-size:12px;">';
      html += '<span>Surface habitable</span>';
      html += '<span>' + details.surfaceHabitable.toFixed(2) + ' m²</span>';
      html += '</div>';
    }

    // Loggia if applicable
    if (details.loggia) {
      html += '<div style="display:flex;justify-content:space-between;padding:4px 8px;font-size:11px;color:#d69e2e;">';
      html += '<span>+ Loggia</span>';
      html += '<span>' + details.loggia.toFixed(2) + ' m²</span>';
      html += '</div>';
    }

    html += '</div>';
  }

  // Extra property info section
  let extraInfo = [];
  if (details.yearBuilt) extraInfo.push({ label: 'Année construction', value: details.yearBuilt });
  if (details.developer) extraInfo.push({ label: 'Promoteur', value: details.developer });
  if (details.program) extraInfo.push({ label: 'Programme', value: details.program });
  if (details.tantiemes) extraInfo.push({ label: 'Tantièmes', value: details.tantiemes });
  if (details.caveLots && details.caveLots.length > 0) extraInfo.push({ label: 'Lots caves', value: details.caveLots.join(', ') });
  if (details.norm) extraInfo.push({ label: 'Norme', value: details.norm });

  if (extraInfo.length > 0) {
    html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0;">';
    html += '<div style="font-size:12px;font-weight:600;color:#4a5568;margin-bottom:8px;">Informations supplémentaires</div>';
    extraInfo.forEach(info => {
      html += '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;">';
      html += '<span style="color:#78716c;">' + info.label + '</span>';
      html += '<span style="color:#1c1917;font-weight:500;">' + info.value + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  html += '</div>'; // end details

  html += '</div>'; // end card

  return html;
}

// ============ PROPERTY DETAIL PANEL ============
function renderPropertyDetail(state, prop) {
  const meta = prop.propertyMeta || {};
  const cd = prop.chargesDetail || {};
  const iv = state.immoView;

  // Title
  const titleEl = document.getElementById('propDetailTitle');
  if (titleEl) titleEl.textContent = prop.name + (meta.address ? ' — ' + meta.address : '');

  // ── Section 0: Property Info Card (Details) ──
  const infoCardEl = document.getElementById('propDetailInfo');
  if (infoCardEl) {
    const details = meta.details || null;
    infoCardEl.innerHTML = renderPropertyInfoCard(details);
  }

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
    if (typeof window.buildExitProjectionChart === 'function') {
      window.buildExitProjectionChart(state, prop);
    }
    if (typeof window.buildPVAbattementChart === 'function') {
      window.buildPVAbattementChart(prop, 'pvAbattementChart');
    }
  }, 50);
}

// ── Fiscal Simulator (Vitry) ──
function renderFiscalSimulator(container, prop) {
  const cfg = prop.fiscalSimConfig;
  const yearlyInt = prop.yearlyInterest || {};
  const defaultTotalCC = cfg.loyerTotalCC;
  const defaultDeclareCC = cfg.loyerDeclareCC;
  const maxDeclare = defaultTotalCC;  // can't declare more than total

  let html = '<h4 style="margin:0 0 16px;font-size:15px;color:#2d3748;">Simulateur fiscal — Déclaré vs Cash (régime réel)</h4>';

  // KPI summary cards (updated dynamically)
  html += '<div id="pdFiscalKPIs" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;"></div>';

  // Slider for total rent
  html += '<div style="margin-bottom:10px;padding:14px 16px;background:linear-gradient(135deg,#fff5eb,#fef3c7);border-radius:10px;border:1px solid #f6e05e;">'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">'
    + '<label style="font-size:13px;font-weight:600;color:#744210;">Loyer total CC :</label>'
    + '<span style="font-size:20px;font-weight:700;color:#b7791f;"><span id="pdFiscalTotalVal">' + defaultTotalCC + '</span> €/mois</span>'
    + '</div>'
    + '<input type="range" id="pdFiscalTotalSlider" min="200" max="2500" value="' + defaultTotalCC + '" step="10" '
    + 'style="width:100%;accent-color:#b7791f;height:6px;">'
    + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#718096;margin-top:4px;">'
    + '<span>200 €</span><span>2 500 €</span>'
    + '</div>'
    + '</div>';

  // Slider for declared rent
  html += '<div style="margin-bottom:16px;padding:14px 16px;background:linear-gradient(135deg,#f7fafc,#edf2f7);border-radius:10px;border:1px solid #e2e8f0;">'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">'
    + '<label style="font-size:13px;font-weight:600;color:#2d3748;">Loyer déclaré CC :</label>'
    + '<span style="font-size:20px;font-weight:700;color:var(--accent);"><span id="pdFiscalSliderVal">' + defaultDeclareCC + '</span> €/mois</span>'
    + '</div>'
    + '<input type="range" id="pdFiscalSlider" min="0" max="' + defaultTotalCC + '" value="' + defaultDeclareCC + '" step="10" '
    + 'style="width:100%;accent-color:var(--accent);height:6px;">'
    + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#718096;margin-top:4px;">'
    + '<span>0 €</span>'
    + '<span id="pdFiscalDeclareMax">' + defaultTotalCC + ' €</span>'
    + '</div>'
    + '</div>';

  // Tables
  html += '<div id="pdFiscalTable"></div>';

  container.innerHTML = html;

  const slider = document.getElementById('pdFiscalSlider');
  const valEl = document.getElementById('pdFiscalSliderVal');
  const totalSlider = document.getElementById('pdFiscalTotalSlider');
  const totalValEl = document.getElementById('pdFiscalTotalVal');
  const declareMaxEl = document.getElementById('pdFiscalDeclareMax');

  function updateFiscalSim() {
    const loyerTotalCC = parseInt(totalSlider.value);
    totalValEl.textContent = loyerTotalCC;
    // Cap declared at total
    slider.max = loyerTotalCC;
    declareMaxEl.textContent = loyerTotalCC + ' €';
    if (parseInt(slider.value) > loyerTotalCC) slider.value = loyerTotalCC;
    const loyerDeclareCC = parseInt(slider.value);
    valEl.textContent = loyerDeclareCC;
    const loyerCashMensuel = loyerTotalCC - loyerDeclareCC;

    let impotDeclareTotal = 0, impotToutDeclareTotal = 0;
    let cashCumule = 0;
    const rows = [];

    for (let y = 0; y < cfg.nYears; y++) {
      const year = cfg.startYear + y;
      const moisLoyer = year === cfg.startYear ? (12 - cfg.contractStartMonth + 1) : 12;
      const prorata = moisLoyer / 12;

      // Revenus déclarés (ce que tu déclares)
      const loyerDeclareAn = loyerDeclareCC * moisLoyer;
      // Revenus si tu déclarais tout
      const loyerToutDeclareAn = loyerTotalCC * moisLoyer;
      // Cash non déclaré
      const cashAn = loyerCashMensuel * moisLoyer;
      cashCumule += cashAn;

      // Charges déductibles (régime réel) — identiques dans les 2 cas
      const tfAnnee = year <= cfg.tfExemptionEndYear ? 0 : cfg.tfAnnuel;
      const totalInterets = yearlyInt[year] || 0;
      const assuranceAnnee = cfg.totalAssuranceAnnuel * prorata;
      const pnoAnnee = cfg.pnoAnnuel * prorata;
      const deductions = totalInterets + assuranceAnnee + pnoAnnee + tfAnnee;

      // Impôt si tu déclares le montant choisi
      const revImpDeclare = Math.max(0, loyerDeclareAn - deductions);
      const deficitDeclare = loyerDeclareAn < deductions ? Math.round(deductions - loyerDeclareAn) : 0;
      const impotDeclare = Math.round(revImpDeclare * cfg.totalRate);

      // Impôt si tu déclarais tout (scénario "honnête")
      const revImpTout = Math.max(0, loyerToutDeclareAn - deductions);
      const impotTout = Math.round(revImpTout * cfg.totalRate);

      // Économie = impôt en moins grâce au cash
      const economie = impotTout - impotDeclare;

      impotDeclareTotal += impotDeclare;
      impotToutDeclareTotal += impotTout;

      const moisNote = moisLoyer < 12 ? ' <small style="color:#718096;">(' + moisLoyer + 'm)</small>' : '';

      rows.push('<tr>'
        + '<td><strong>' + year + '</strong>' + moisNote + '</td>'
        + '<td class="num">' + Math.round(loyerDeclareAn).toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="color:#718096;">' + Math.round(deductions).toLocaleString('fr-FR')
          + (deficitDeclare > 0 ? ' <small style="color:#276749;">▲</small>' : '') + '</td>'
        + '<td class="num">' + Math.round(revImpDeclare).toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="color:#c53030;">' + impotDeclare.toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="color:#718096;">' + Math.round(loyerToutDeclareAn).toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="color:#c53030;">' + impotTout.toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="font-weight:700;color:#276749;">' + economie.toLocaleString('fr-FR') + '</td>'
        + '<td class="num" style="color:#2b6cb0;font-weight:600;">' + cashAn.toLocaleString('fr-FR') + '</td>'
        + '</tr>');
    }

    const totalEconomie = impotToutDeclareTotal - impotDeclareTotal;
    rows.push('<tr style="font-weight:700;border-top:3px solid #2d3748;background:#edf2f7;">'
      + '<td>TOTAL ' + cfg.nYears + ' ans</td><td></td><td></td><td></td>'
      + '<td class="num" style="color:#c53030;">' + impotDeclareTotal.toLocaleString('fr-FR') + ' €</td>'
      + '<td></td>'
      + '<td class="num" style="color:#c53030;">' + impotToutDeclareTotal.toLocaleString('fr-FR') + ' €</td>'
      + '<td class="num" style="font-weight:700;color:#276749;">+' + totalEconomie.toLocaleString('fr-FR') + ' €</td>'
      + '<td class="num" style="color:#2b6cb0;font-weight:700;">' + cashCumule.toLocaleString('fr-FR') + ' €</td>'
      + '</tr>');

    document.getElementById('pdFiscalTable').innerHTML = '<div style="overflow-x:auto;"><table style="font-size:0.78rem;width:100%;">'
      + '<thead><tr>'
      + '<th>Année</th>'
      + '<th class="num" style="background:#ebf8ff;" colspan="4">Si tu déclares ' + loyerDeclareCC + '€ CC</th>'
      + '<th class="num" style="background:#fff5eb;" colspan="2">Si tout déclaré (' + loyerTotalCC + '€)</th>'
      + '<th class="num" style="background:#f0fff4;">Économie</th>'
      + '<th class="num" style="background:#ebf4ff;">Cash</th>'
      + '</tr>'
      + '<tr style="font-size:0.7rem;color:#718096;">'
      + '<th></th>'
      + '<th class="num" style="background:#ebf8ff;">Loyer</th>'
      + '<th class="num" style="background:#ebf8ff;">Déductions</th>'
      + '<th class="num" style="background:#ebf8ff;">Rev. imp.</th>'
      + '<th class="num" style="background:#ebf8ff;">Impôt</th>'
      + '<th class="num" style="background:#fff5eb;">Loyer</th>'
      + '<th class="num" style="background:#fff5eb;">Impôt</th>'
      + '<th class="num" style="background:#f0fff4;">Δ impôt</th>'
      + '<th class="num" style="background:#ebf4ff;">Non décl.</th>'
      + '</tr></thead>'
      + '<tbody>' + rows.join('') + '</tbody></table></div>';

    // Update KPI cards
    const kpiEl = document.getElementById('pdFiscalKPIs');
    kpiEl.innerHTML = ''
      + '<div style="padding:12px;background:#f0fff4;border-radius:8px;text-align:center;border:1px solid #c6f6d5;">'
      + '<div style="font-size:18px;font-weight:700;color:#276749;">+' + totalEconomie.toLocaleString('fr-FR') + ' €</div>'
      + '<div style="font-size:11px;color:#276749;">Économie impôts ' + cfg.nYears + ' ans</div></div>'
      + '<div style="padding:12px;background:#ebf4ff;border-radius:8px;text-align:center;border:1px solid #bee3f8;">'
      + '<div style="font-size:18px;font-weight:700;color:#2b6cb0;">' + cashCumule.toLocaleString('fr-FR') + ' €</div>'
      + '<div style="font-size:11px;color:#2b6cb0;">Cash cumulé ' + cfg.nYears + ' ans</div></div>'
      + '<div style="padding:12px;background:#fff5f5;border-radius:8px;text-align:center;border:1px solid #fed7d7;">'
      + '<div style="font-size:18px;font-weight:700;color:#c53030;">' + impotDeclareTotal.toLocaleString('fr-FR') + ' €</div>'
      + '<div style="font-size:11px;color:#c53030;">Impôts payés ' + cfg.nYears + ' ans</div></div>'
      + '<div style="padding:12px;background:#f7fafc;border-radius:8px;text-align:center;border:1px solid #e2e8f0;">'
      + '<div style="font-size:18px;font-weight:700;color:#4a5568;">' + loyerCashMensuel + ' €/mois</div>'
      + '<div style="font-size:11px;color:#718096;">Cash mensuel net</div></div>';
  }

  slider.addEventListener('input', updateFiscalSim);
  totalSlider.addEventListener('input', updateFiscalSim);
  updateFiscalSim();
}

// ── VEFA Timeline (Villejuif) ──
function renderVEFATimeline(container, prop) {
  const cfg = prop.vefaConfig;
  const [delY, delM] = cfg.deliveryDate.split('-').map(Number);
  const deliveryLabel = new Date(delY, delM - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  let html = '<h4 style="margin:0 0 12px;font-size:14px;color:#4a5568;">Timeline VEFA — Villejuif</h4>';

  // Check if loan is disbursed
  if (!cfg.loanDisbursed || !cfg.franchiseStart) {
    // Loan NOT disbursed yet — show waiting state
    html += '<div style="padding:16px;background:#fef3c7;border-radius:8px;border-left:3px solid #d69e2e;margin-bottom:16px;">'
      + '<div style="font-weight:700;color:#92400e;margin-bottom:4px;">En attente de d\u00e9blocage du pr\u00eat</div>'
      + '<div style="font-size:13px;color:#744210;">Le pr\u00eat n\u2019a pas encore \u00e9t\u00e9 d\u00e9bloqu\u00e9. La franchise de ' + cfg.franchiseMonths + ' mois d\u00e9butera \u00e0 la date de premier d\u00e9blocage des fonds.</div>'
      + '</div>';

    html += '<div class="detail-grid" style="grid-template-columns:1fr 1fr 1fr;">'
      + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;color:#d69e2e;">En attente</div><div style="font-size:11px;color:#718096;">D\u00e9but franchise</div></div>'
      + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;">' + deliveryLabel + '</div><div style="font-size:11px;color:#718096;">Livraison pr\u00e9vue</div></div>'
      + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;">' + cfg.franchiseMonths + ' mois</div><div style="font-size:11px;color:#718096;">Dur\u00e9e franchise</div></div>'
      + '</div>';
  } else {
    // Loan disbursed — show full timeline
    const [startY, startM] = cfg.franchiseStart.split('-').map(Number);
    const franchiseEnd = new Date(startY, startM - 1 + cfg.franchiseMonths);
    const franchiseEndLabel = franchiseEnd.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

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

    html += '<div class="detail-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;">'
      + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;">' + cfg.franchiseStart + '</div><div style="font-size:11px;color:#718096;">D\u00e9but franchise</div></div>'
      + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;">' + franchiseEndLabel + '</div><div style="font-size:11px;color:#718096;">Fin franchise</div></div>'
      + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;">' + deliveryLabel + '</div><div style="font-size:11px;color:#718096;">Livraison pr\u00e9vue</div></div>'
      + '<div class="detail-metric"><div style="font-size:14px;font-weight:700;">' + cfg.franchiseMonths + ' mois</div><div style="font-size:11px;color:#718096;">Dur\u00e9e franchise</div></div>'
      + '</div>';
  }

  // Financial summary
  if (cfg.totalOperation) {
    const noteText = cfg.loanDisbursed
      ? 'Pendant la franchise, seuls les int\u00e9r\u00eats intercalaires sont pay\u00e9s. Les mensualit\u00e9s compl\u00e8tes commencent apr\u00e8s livraison.'
      : 'Pr\u00eat non d\u00e9bloqu\u00e9 \u2014 aucun int\u00e9r\u00eat intercalaire n\u2019est encore d\u00fb. Pas d\u2019impact sur le cash flow.';
    html += '<div style="margin-top:12px;padding:12px;background:#f7fafc;border-radius:8px;font-size:13px;">'
      + '<strong>Montant op\u00e9ration :</strong> ' + cfg.totalOperation.toLocaleString('fr-FR') + ' \u20ac '
      + (cfg.fraisDossier > 0 ? '| <strong>Frais dossier :</strong> ' + cfg.fraisDossier.toLocaleString('fr-FR') + ' \u20ac' : '')
      + '<br><small style="color:#718096;">' + noteText + '</small>'
      + '</div>';
  }

  container.innerHTML = html;
}

// ════════════════════════════════════════════════════════════
// PER-APARTMENT VIEW
// ════════════════════════════════════════════════════════════
function renderAptView(state, loanKey) {
  const iv = state.immoView;
  const prop = iv.properties.find(p => p.loanKey === loanKey);
  if (!prop) return;

  const containerId = 'apt' + loanKey.charAt(0).toUpperCase() + loanKey.slice(1) + 'Content';
  const container = document.getElementById(containerId);
  if (!container) return;

  const meta = prop.propertyMeta || {};
  const cd = prop.chargesDetail || {};
  const ec = prop.exitCosts || {};

  let html = '';

  // ── Section 0: Property Info Card (detailed plan info) ──
  const details = meta.details || null;
  if (details) {
    html += renderPropertyInfoCard(details);
  }

  // ── Section 1: Fiche propriété + Exit costs KPIs ──
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">';

  // Left: property info
  const surface = meta.surface ? meta.surface + ' m²' : '—';
  const price = meta.purchasePrice ? meta.purchasePrice.toLocaleString('fr-FR') + ' €' : (meta.totalOperation ? meta.totalOperation.toLocaleString('fr-FR') + ' €' : '—');
  const date = meta.purchaseDate || '—';
  const type = meta.type || '—';
  const appreciation = meta.appreciation ? (meta.appreciation * 100).toFixed(1) + '%/an' : '—';

  html += '<div style="background:#f7fafc;border-radius:12px;padding:16px;">'
    + '<h3 style="margin:0 0 12px;font-size:15px;color:#2d3748;">Fiche propriété</h3>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">'
    + '<div><span style="color:#718096;">Surface</span><br><strong>' + surface + '</strong></div>'
    + '<div><span style="color:#718096;">Prix d\'achat</span><br><strong>' + price + '</strong></div>'
    + '<div><span style="color:#718096;">Valeur actuelle</span><br><strong>' + fmt(prop.value) + '</strong></div>'
    + '<div><span style="color:#718096;">Equity brute</span><br><strong class="pl-pos">' + fmt(prop.equity) + '</strong></div>'
    + '<div><span style="color:#718096;">Type</span><br><strong>' + type + '</strong></div>'
    + '<div><span style="color:#718096;">Date achat</span><br><strong>' + date + '</strong></div>'
    + '<div><span style="color:#718096;">Appréciation</span><br><strong>' + appreciation + '</strong></div>'
    + '<div><span style="color:#718096;">LTV</span><br><strong>' + prop.ltv.toFixed(1) + '%</strong></div>'
    + '</div></div>';

  // Right: Exit costs summary
  html += '<div style="background:#fff5f5;border-radius:12px;padding:16px;">'
    + '<h3 style="margin:0 0 12px;font-size:15px;color:#c53030;">Frais de sortie (si vente aujourd\'hui)</h3>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">';

  if (ec.pvBrute != null) {
    const pvColor = ec.pvBrute > 0 ? '#276749' : '#c53030';
    html += '<div><span style="color:#718096;">Plus-value brute</span><br><strong style="color:' + pvColor + ';">' + (ec.pvBrute > 0 ? '+' : '') + fmt(Math.round(ec.pvBrute)) + '</strong></div>';
    html += '<div><span style="color:#718096;">Détention</span><br><strong>' + ec.holdingYears + ' ans</strong></div>';
    html += '<div><span style="color:#718096;">Abatt. IR (' + Math.round(ec.abattementIR * 100) + '%)</span><br><strong>' + fmt(Math.round(ec.pvBrute * ec.abattementIR)) + '</strong></div>';
    html += '<div><span style="color:#718096;">Abatt. PS (' + Math.round(ec.abattementPS * 100) + '%)</span><br><strong>' + fmt(Math.round(ec.pvBrute * ec.abattementPS)) + '</strong></div>';
    html += '<div><span style="color:#718096;">Taxe PV (IR+PS)</span><br><strong class="pl-neg">' + fmt(ec.totalTaxPV) + '</strong></div>';
    // Frais agence supprimés (vente en direct)
    if (ec.tvaClawback > 0) {
      html += '<div><span style="color:#718096;">Clawback TVA 5.5%</span><br><strong class="pl-neg">' + fmt(ec.tvaClawback) + '</strong></div>';
    }
    if (ec.ira > 0) {
      html += '<div><span style="color:#718096;">IRA (remb. anticipé)</span><br><strong class="pl-neg">' + fmt(ec.ira) + '</strong></div>';
    }
    if (ec.mainlevee > 0) {
      html += '<div><span style="color:#718096;">Mainlevée hypo.</span><br><strong class="pl-neg">' + fmt(ec.mainlevee) + '</strong></div>';
    }
    html += '</div>';
    html += '<div style="margin-top:12px;padding-top:12px;border-top:2px solid #fed7d7;display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
    html += '<div><span style="color:#718096;font-weight:600;">Total frais sortie</span><br><strong class="pl-neg" style="font-size:16px;">' + fmt(ec.totalExitCosts) + '</strong></div>';
    const neColor = ec.netEquityAfterExit >= 0 ? '#276749' : '#c53030';
    html += '<div><span style="color:#718096;font-weight:600;">Equity nette après sortie</span><br><strong style="font-size:16px;color:' + neColor + ';">' + fmt(Math.round(ec.netEquityAfterExit)) + '</strong></div>';
    html += '</div>';
  }
  html += '</div>';
  html += '</div>';

  // ── Section 2: Détail des prêts ──
  html += '<div style="background:#f7fafc;border-radius:12px;padding:16px;margin-bottom:24px;">';
  html += '<h3 style="margin:0 0 12px;font-size:15px;color:#2d3748;">Détail des prêts</h3>';
  if (prop.loanDetails && prop.loanDetails.length > 0) {
    html += '<div style="overflow-x:auto;"><table style="font-size:0.82rem;width:100%;">'
      + '<thead><tr><th>Prêt</th><th class="num">Capital</th><th class="num">Taux</th><th class="num">Durée</th><th class="num">Mensualité</th><th class="num">Assurance</th></tr></thead><tbody>';
    let totalMens = 0, totalAss = 0;
    prop.loanDetails.forEach(l => {
      totalMens += l.monthlyPayment || 0;
      totalAss += l.insuranceMonthly || 0;
      const dur = l.durationMonths ? Math.round(l.durationMonths / 12) + ' ans' : '—';
      html += '<tr><td>' + l.name + '</td>'
        + '<td class="num">' + (l.principal || 0).toLocaleString('fr-FR') + ' €</td>'
        + '<td class="num">' + ((l.rate || 0) * 100).toFixed(2) + '%</td>'
        + '<td class="num">' + dur + '</td>'
        + '<td class="num">' + Math.round(l.monthlyPayment || 0).toLocaleString('fr-FR') + ' €</td>'
        + '<td class="num">' + Math.round(l.insuranceMonthly || 0).toLocaleString('fr-FR') + ' €</td></tr>';
    });
    html += '<tr style="font-weight:700;border-top:2px solid #cbd5e0;background:#edf2f7;">'
      + '<td>Total</td><td></td><td></td><td></td>'
      + '<td class="num">' + Math.round(totalMens).toLocaleString('fr-FR') + ' €</td>'
      + '<td class="num">' + Math.round(totalAss).toLocaleString('fr-FR') + ' €</td></tr>';
    html += '</tbody></table></div>';
    html += '<div style="margin-top:8px;font-size:12px;color:#718096;">CRD actuel : <strong>' + fmt(prop.crd) + '</strong> | Fin prêt : <strong>' + (prop.endYear || '—') + '</strong></div>';
  }
  html += '</div>';

  // ── Section 3: Cash Flow détaillé ──
  const cfSign = prop.cf >= 0 ? '+' : '';
  const cfClass = prop.cf >= 0 ? 'pl-pos' : 'pl-neg';
  const cfNetSign = prop.cfNetFiscal >= 0 ? '+' : '';
  const cfNetClass = prop.cfNetFiscal >= 0 ? 'pl-pos' : 'pl-neg';
  html += '<div style="margin-bottom:24px;">'
    + '<h3 style="margin:0 0 12px;font-size:15px;color:#2d3748;">Cash Flow mensuel</h3>'
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
    + '<div class="detail-metric" style="flex:1;min-width:110px;"><div style="font-size:20px;font-weight:700;" class="' + cfClass + '">' + cfSign + prop.cf + ' €</div><div style="font-size:11px;color:#718096;">CF brut /mois</div></div>'
    + '<div class="detail-metric" style="flex:1;min-width:110px;"><div style="font-size:20px;font-weight:700;" class="' + cfNetClass + '">' + cfNetSign + Math.round(prop.cfNetFiscal) + ' €</div><div style="font-size:11px;color:#718096;">CF net fiscal /mois</div></div>'
    + '<div class="detail-metric" style="flex:1;min-width:110px;"><div style="font-size:18px;font-weight:700;">' + prop.yieldGross.toFixed(1) + '%</div><div style="font-size:11px;color:#718096;">Rend. brut</div></div>'
    + '<div class="detail-metric" style="flex:1;min-width:110px;"><div style="font-size:18px;font-weight:700;">' + prop.yieldNet.toFixed(1) + '%</div><div style="font-size:11px;color:#718096;">Rend. net</div></div>'
    + '<div class="detail-metric" style="flex:1;min-width:110px;"><div style="font-size:18px;font-weight:700;">' + fmt(prop.wealthCreation) + '</div><div style="font-size:11px;color:#718096;">Création richesse /mois</div></div>'
    + '</div></div>';

  // ── Section 4: Vitry-specific — Constraints ──
  if (loanKey === 'vitry') {
    const vc = VITRY_CONSTRAINTS;
    html += '<div style="background:#fffaf0;border:1px solid #fbd38d;border-radius:12px;padding:16px;margin-bottom:24px;">';
    html += '<h3 style="margin:0 0 12px;font-size:15px;color:#c05621;">Contraintes & Obligations</h3>';
    html += '<p style="font-size:12px;color:#744210;margin:0 0 12px;">' + vc.summary + '</p>';

    vc.constraints.forEach(c => {
      const statusColor = c.status === 'actif' ? '#c05621' : '#276749';
      const yearsLeft = c.yearsRemaining != null ? ' <span style="background:#fef3c7;padding:1px 6px;border-radius:4px;font-size:10px;color:#92400e;">' + c.yearsRemaining + ' ans restants</span>' : '';
      html += '<div style="margin-bottom:16px;padding:12px;background:white;border-radius:8px;border-left:3px solid ' + statusColor + ';">';
      html += '<div style="font-weight:700;font-size:13px;color:#2d3748;">' + c.dispositif + yearsLeft + '</div>';
      html += '<div style="font-size:11px;color:#718096;margin:4px 0;">' + c.reference + '</div>';
      html += '<div style="font-size:12px;color:#4a5568;margin:6px 0;"><strong>Obligation :</strong> ' + c.obligation + '</div>';
      if (c.dateDebut && c.dateFin) {
        html += '<div style="font-size:12px;color:#4a5568;"><strong>Période :</strong> ' + c.dateDebut + ' → ' + c.dateFin + '</div>';
      }
      html += '<div style="font-size:12px;color:#c53030;margin:4px 0;"><strong>Pénalité :</strong> ' + c.penalite + '</div>';
      html += '<ul style="margin:6px 0 0;padding-left:16px;font-size:11px;color:#4a5568;">';
      c.details.forEach(d => { html += '<li style="margin-bottom:2px;">' + d + '</li>'; });
      html += '</ul></div>';
    });

    // Timeline
    html += renderTimelineHTML(vc.timeline);
    html += '</div>';

    // Fiscal simulator
    html += '<div id="aptVitryFiscal" style="margin-bottom:24px;"></div>';
  }

  // ── Section 4: Rueil-specific — Timeline ──
  if (loanKey === 'rueil') {
    const ec = EXIT_COSTS.rueil;
    if (ec && ec.timeline) {
      html += '<div style="background:#f7fafc;border:1px solid #cbd5e0;border-radius:12px;padding:16px;margin-bottom:24px;">';
      html += '<h3 style="margin:0 0 12px;font-size:15px;color:#2d3748;">Échéances importantes</h3>';
      html += renderTimelineHTML(ec.timeline);
      html += '</div>';
    }
  }

  // ── Section 4: Villejuif-specific — VEFA Timeline + Regime comparison ──
  if (loanKey === 'villejuif') {
    // Timeline from EXIT_COSTS
    const ec = EXIT_COSTS.villejuif;
    if (ec && ec.timeline) {
      html += '<div style="background:#ebf8ff;border-radius:12px;padding:16px;margin-bottom:24px;">';
      html += '<h3 style="margin:0 0 12px;font-size:15px;color:#0284c7;">Échéances VEFA</h3>';
      html += renderTimelineHTML(ec.timeline);
      html += '</div>';
    }
    // VEFA Timeline
    if (prop.vefaConfig) {
      html += '<div id="aptVillejuifVefa" style="background:#ebf8ff;border-radius:12px;padding:16px;margin-bottom:24px;"></div>';
    }

    // ── JEANBRUN — All content inside collapsible section ──
    const jb = VILLEJUIF_REGIMES.jeanbrun;
    const vBase = VILLEJUIF_REGIMES.base;
    const plafond = jb.plafondLoyer;
    const surface = vBase.surface;
    const loyerMarche = vBase.loyerNuHC;
    const loyerMeuble = vBase.loyerMeubleHC;
    const manqueAGagner = loyerMarche - plafond.loyerMaxMensuel;

    const jbCollapsibleId = 'jeanbrun_' + Math.random().toString(36).substr(2, 6);

    // Warning banner + collapsible toggle
    html += '<div style="background:#fff5f5;border:1px solid #fed7d7;border-radius:12px;padding:12px 16px;margin-bottom:24px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">';
    html += '<div style="font-size:13px;color:#c53030;"><strong>⚠️ Dispositif Jeanbrun non retenu</strong> — loyer plafonné trop bas (1 215€ vs 1 700€ marché)</div>';
    html += '<button onclick="var d=document.getElementById(\'' + jbCollapsibleId + '\');d.style.display=d.style.display===\'none\'?\'block\':\'none\'" style="flex-shrink:0;padding:6px 12px;background:#c53030;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;">';
    html += 'Voir les détails ▼</button>';
    html += '</div>';
    html += '</div>';

    // Hidden detailed section
    html += '<div id="' + jbCollapsibleId + '" style="display:none;background:#fffaf0;border:1px solid #fbd38d;border-radius:12px;padding:16px;margin-bottom:24px;">';
    html += '<h3 style="margin:0 0 12px;font-size:15px;color:#c05621;">Contraintes JEANBRUN — Loyer Plafonné & Obligations</h3>';

    // Loyer plafonné calculation
    html += '<div style="background:white;border-radius:8px;padding:12px;margin-bottom:12px;border-left:3px solid #dd6b20;">';
    html += '<div style="font-weight:700;font-size:13px;color:#2d3748;margin-bottom:8px;">Calcul du Loyer Plafonné</div>';
    html += '<div style="font-size:12px;color:#4a5568;line-height:1.6;">';
    html += 'Zone A (Villejuif) — Plafond 2025 : <strong>' + plafond.zoneA + ' €/m²/mois</strong><br>';
    html += 'Surface habitable : <strong>' + surface + ' m²</strong><br>';
    html += 'Loyer max = ' + surface + ' × ' + plafond.zoneA + ' = <strong style="color:#c05621;">' + plafond.loyerMaxMensuel + ' €/mois</strong><br>';
    html += 'Loyer marché (nu) : <strong>' + loyerMarche + ' €/mois</strong> — Manque à gagner : <strong style="color:#c53030;">' + manqueAGagner + ' €/mois</strong> (' + (manqueAGagner * 12).toLocaleString('fr-FR') + ' €/an)';
    html += '</div></div>';

    // Réduction d'impôt calculation
    const ri = jb.reductionImpot;
    const prixRetenu = Math.min(vBase.totalOperation, ri.plafondPrix, ri.plafondM2 * surface);
    html += '<div style="background:white;border-radius:8px;padding:12px;margin-bottom:12px;border-left:3px solid #38a169;">';
    html += '<div style="font-weight:700;font-size:13px;color:#2d3748;margin-bottom:8px;">Réduction d\'Impôt JEANBRUN</div>';
    html += '<div style="font-size:12px;color:#4a5568;line-height:1.6;">';
    html += 'Prix d\'achat : ' + vBase.totalOperation.toLocaleString('fr-FR') + ' € — Plafond prix : ' + ri.plafondPrix.toLocaleString('fr-FR') + ' € — Plafond m² : ' + ri.plafondM2.toLocaleString('fr-FR') + ' €/m²<br>';
    html += 'Assiette retenue : <strong>' + prixRetenu.toLocaleString('fr-FR') + ' €</strong> (min des 3 plafonds)<br>';
    html += '<div style="display:flex;gap:16px;margin-top:6px;flex-wrap:wrap;">';
    jb.dureeEngagement.forEach(d => {
      const taux = d === 6 ? ri.taux6ans : d === 9 ? ri.taux9ans : ri.taux12ans;
      const reduction = Math.round(prixRetenu * taux);
      const annuel = Math.round(reduction / d);
      html += '<div style="flex:1;min-width:130px;padding:8px;background:#f0fff4;border-radius:6px;text-align:center;">';
      html += '<div style="font-weight:700;font-size:14px;color:#276749;">' + reduction.toLocaleString('fr-FR') + ' €</div>';
      html += '<div style="font-size:11px;color:#718096;">' + d + ' ans (' + (taux * 100) + '%) → ' + annuel.toLocaleString('fr-FR') + '€/an</div>';
      html += '</div>';
    });
    html += '</div></div></div>';

    // Conditions list
    html += '<div style="background:white;border-radius:8px;padding:12px;margin-bottom:12px;border-left:3px solid #3182ce;">';
    html += '<div style="font-weight:700;font-size:13px;color:#2d3748;margin-bottom:8px;">Conditions d\'éligibilité</div>';
    html += '<ul style="margin:0;padding-left:16px;font-size:12px;color:#4a5568;line-height:1.8;">';
    jb.conditions.forEach(c => { html += '<li>' + c + '</li>'; });
    html += '</ul></div>';

    // Avantages / Inconvénients
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
    html += '<div style="flex:1;min-width:200px;background:#f0fff4;border-radius:8px;padding:12px;">';
    html += '<div style="font-weight:700;font-size:12px;color:#276749;margin-bottom:6px;">Avantages</div>';
    html += '<ul style="margin:0;padding-left:14px;font-size:11px;color:#4a5568;line-height:1.7;">';
    jb.avantages.forEach(a => { html += '<li>' + a + '</li>'; });
    html += '</ul></div>';
    html += '<div style="flex:1;min-width:200px;background:#fff5f5;border-radius:8px;padding:12px;">';
    html += '<div style="font-weight:700;font-size:12px;color:#c53030;margin-bottom:6px;">Inconvénients</div>';
    html += '<ul style="margin:0;padding-left:14px;font-size:11px;color:#4a5568;line-height:1.7;">';
    jb.inconvenients.forEach(i => { html += '<li>' + i + '</li>'; });
    html += '</ul></div>';
    html += '</div>';

    // ── JEANBRUN vs LMNP comparison table (inside collapsible) ──
    const cmp = iv.villejuifRegimeComparison;
    if (cmp && cmp.summary) {
      html += '<div style="margin-top:16px;border-top:1px solid #fbd38d;padding-top:16px;">';
      html += '<h4 style="margin:0 0 12px;font-size:14px;color:#276749;">Comparaison JEANBRUN vs LMNP — 10 ans</h4>';
      const delta = cmp.summary.delta;
      const winColor = delta > 0 ? '#276749' : '#c05621';
      html += '<div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
      html += '<div class="detail-metric" style="flex:1;min-width:120px;"><div style="font-size:16px;font-weight:700;color:' + winColor + ';">' + cmp.summary.winner + '</div><div style="font-size:10px;color:#718096;">Recommandé</div></div>';
      html += '<div class="detail-metric" style="flex:1;min-width:120px;"><div style="font-size:14px;font-weight:700;color:' + winColor + ';">' + (delta > 0 ? '+' : '') + fmt(Math.round(delta)) + '</div><div style="font-size:10px;color:#718096;">Avantage 10 ans</div></div>';
      html += '<div class="detail-metric" style="flex:1;min-width:120px;"><div style="font-size:14px;font-weight:700;">' + fmt(cmp.summary.jbReductionTotale) + '</div><div style="font-size:10px;color:#718096;">Réduction JB totale</div></div>';
      html += '</div>';
      html += '<div style="overflow-x:auto;"><table style="font-size:0.75rem;width:100%;">'
        + '<thead><tr><th>Année</th>'
        + '<th class="num" style="background:#ebf8ff;">Loyer JB</th><th class="num" style="background:#ebf8ff;">CF net JB</th><th class="num" style="background:#ebf8ff;">Cum. JB</th>'
        + '<th class="num" style="background:#fff5eb;">Loyer LMNP</th><th class="num" style="background:#fff5eb;">CF net LMNP</th><th class="num" style="background:#fff5eb;">Cum. LMNP</th>'
        + '<th class="num" style="background:#f0fff4;">\u0394 LMNP-JB</th></tr></thead><tbody>';
      for (let y = 0; y < cmp.jeanbrun.length; y++) {
        const jbRow = cmp.jeanbrun[y];
        const lmRow = cmp.lmnp[y];
        const d = lmRow.cumGain - jbRow.cumGain;
        const dColor = d > 0 ? '#276749' : '#c53030';
        html += '<tr><td><strong>' + jbRow.year + '</strong></td>'
          + '<td class="num">' + jbRow.loyer + '</td>'
          + '<td class="num">' + fmt(Math.round(jbRow.cfNet)) + '</td>'
          + '<td class="num">' + fmt(Math.round(jbRow.cumGain)) + '</td>'
          + '<td class="num">' + lmRow.loyer + '</td>'
          + '<td class="num">' + fmt(Math.round(lmRow.cfNet)) + '</td>'
          + '<td class="num">' + fmt(Math.round(lmRow.cumGain)) + '</td>'
          + '<td class="num" style="font-weight:700;color:' + dColor + ';">' + (d > 0 ? '+' : '') + fmt(Math.round(d)) + '</td></tr>';
      }
      html += '</tbody></table></div>';
      html += '</div>';
    }

    html += '</div>'; // close collapsible Jeanbrun section
    html += '</div>'; // close warning banner
  }

  // ── Section 5: Exit projection chart + table ──
  html += '<div style="background:#f7fafc;border-radius:12px;padding:16px;margin-bottom:24px;">';
  html += '<h3 style="margin:0 0 12px;font-size:15px;color:#2d3748;">Projection frais de sortie par année</h3>';
  const exitChartId = 'aptExitProjectionChart_' + loanKey;
  html += '<div class="chart-container" style="height:340px;margin-bottom:16px;"><canvas id="' + exitChartId + '"></canvas></div>';
  html += '<p style="font-size:11px;color:#718096;margin:0 0 12px;">Simulation de la vente au prix actuel (' + fmt(prop.value) + ') à différentes dates. Les abattements PV augmentent avec la durée de détention.</p>';

  const purchasePrice = meta.purchasePrice || meta.totalOperation || prop.value;
  const [py, pm] = (meta.purchaseDate || '2023-01').split('-').map(Number);
  const fiscType = IMMO_CONSTANTS.fiscalite && IMMO_CONSTANTS.fiscalite[loanKey] ? IMMO_CONSTANTS.fiscalite[loanKey].type : 'nu';

  const showTVACol = loanKey === 'vitry'; // TVA clawback only applies to Vitry
  html += '<div style="overflow-x:auto;"><table style="font-size:0.8rem;width:100%;">'
    + '<thead><tr><th>Année</th><th class="num">Détention</th><th class="num">Abatt. IR</th><th class="num">Abatt. PS</th>'
    + '<th class="num">Taxe PV</th>' + (showTVACol ? '<th class="num">TVA claw.</th>' : '') + '<th class="num" style="color:#c53030;">Total frais</th><th class="num" style="color:#276749;">Equity nette</th></tr></thead><tbody>';

  for (let yr = 2026; yr <= 2040; yr += 2) {
    const holdYears = (yr - py) + (6 - pm) / 12;  // approx mid-year
    const totalAmort = fiscType === 'lmnp' ? Math.round((purchasePrice * 0.80) * 0.02 * Math.max(0, holdYears)) : 0;
    // Simple CRD estimation: assume linear principal repayment
    const loanDuration = prop.endYear ? (prop.endYear - py) : 25;
    const crdEstimate = Math.max(0, prop.crd - (prop.crd / (loanDuration * 12) * (holdYears - ((new Date().getFullYear()) - py)) * 12));
    const exitSim = computeExitCostsSim(loanKey, prop.value, purchasePrice, holdYears, Math.round(crdEstimate), totalAmort);
    const neColor = exitSim.netEquityAfterExit >= 0 ? '#276749' : '#c53030';
    html += '<tr>'
      + '<td><strong>' + yr + '</strong></td>'
      + '<td class="num">' + Math.floor(holdYears) + ' ans</td>'
      + '<td class="num">' + Math.round(exitSim.abattementIR * 100) + '%</td>'
      + '<td class="num">' + Math.round(exitSim.abattementPS * 100) + '%</td>'
      + '<td class="num">' + fmt(exitSim.totalTaxPV) + '</td>'
      + (showTVACol ? '<td class="num">' + (exitSim.tvaClawback > 0 ? fmt(exitSim.tvaClawback) : '—') + '</td>' : '')
      + '<td class="num" style="color:#c53030;font-weight:600;">' + fmt(exitSim.totalExitCosts) + '</td>'
      + '<td class="num" style="color:' + neColor + ';font-weight:600;">' + fmt(Math.round(exitSim.netEquityAfterExit)) + '</td>'
      + '</tr>';
  }
  html += '</tbody></table></div>';
  html += '</div>';

  container.innerHTML = html;

  // Render dynamic sub-sections after DOM insertion
  if (loanKey === 'vitry' && prop.fiscalSimConfig) {
    const fiscalEl = document.getElementById('aptVitryFiscal');
    if (fiscalEl) renderFiscalSimulator(fiscalEl, prop);
  }
  if (loanKey === 'villejuif' && prop.vefaConfig) {
    const vefaEl = document.getElementById('aptVillejuifVefa');
    if (vefaEl) renderVEFATimeline(vefaEl, prop);
  }

  // Exit projection chart (after DOM ready)
  const _exitChartId = 'aptExitProjectionChart_' + loanKey;
  setTimeout(() => {
    if (typeof window.buildExitProjectionChart === 'function') {
      window.buildExitProjectionChart(state, prop, _exitChartId);
    }
  }, 50);
}

// Lightweight exit cost computation for simulation table (mirrors engine logic)
function computeExitCostsSim(loanKey, salePrice, purchasePrice, holdingYears, crdAtExit, totalAmort) {
  const EC = EXIT_COSTS;
  const fraisAcq = purchasePrice * 0.075;
  const amortRe = (EC[loanKey] && EC[loanKey].lmnpAmortReintegration && totalAmort > 0) ? totalAmort : 0;
  const pvBrute = salePrice - (purchasePrice + fraisAcq) + amortRe;
  let abattIR = 0, abattPS = 0;
  const years = Math.floor(holdingYears);

  if (pvBrute > 0) {
    for (const b of EC.irAbattement) { for (let y = b.fromYear; y <= b.toYear && y <= years; y++) abattIR += b.ratePerYear; }
    if (years >= 22) abattIR = 1;
    abattIR = Math.min(1, abattIR);
    for (const b of EC.psAbattement) { for (let y = b.fromYear; y <= b.toYear && y <= years; y++) abattPS += b.ratePerYear; }
    if (years >= 30) abattPS = 1;
    abattPS = Math.min(1, abattPS);
  }

  const pvNetIR = pvBrute > 0 ? pvBrute * (1 - abattIR) : 0;
  const pvNetPS = pvBrute > 0 ? pvBrute * (1 - abattPS) : 0;
  const ir = Math.round(pvNetIR * EC.irRate);
  const ps = Math.round(pvNetPS * EC.psRate);
  let surtaxe = 0;
  if (pvNetIR > 50000) { for (const b of EC.surtaxe) { if (pvNetIR >= b.from) surtaxe = Math.round(pvNetIR * b.rate); } }
  const totalTaxPV = ir + ps + surtaxe;
  const agencyFee = 0;  // Vente en direct, pas d'agence
  const diagnostics = EC.diagnosticsCost;
  let mainlevee = 0;
  if (crdAtExit > 0) mainlevee = Math.round(EC.mainleveeFixe + purchasePrice * EC.mainleveePct);
  let tvaClawback = 0;
  if (loanKey === 'vitry' && EC.vitry && EC.vitry.tvaReduite) {
    const tva = EC.vitry.tvaReduite;
    // TVA obligation depuis livraison (07/2025), pas acte (01/2023)
    // holdingYears = years since purchaseDate (2023-01)
    // yearsSinceLivraison = holdingYears - (2025.5 - 2023.0) = holdingYears - 2.5
    const livOffset = 2.5; // offset livraison vs acte en années
    const yearsSinceLivraison = Math.max(0, holdingYears - livOffset);
    if (yearsSinceLivraison < tva.dureeEngagement) {
      const rem = tva.dureeEngagement - Math.max(0, Math.floor(yearsSinceLivraison));
      tvaClawback = Math.round(tva.prixHTApprox * (tva.tauxNormal - tva.tauxReduit) * rem / tva.dureeEngagement);
    }
  }
  const totalExitCosts = totalTaxPV + agencyFee + diagnostics + mainlevee + tvaClawback;
  return {
    pvBrute, abattementIR: abattIR, abattementPS: abattPS, totalTaxPV, agencyFee, tvaClawback, mainlevee,
    totalExitCosts, netEquityAfterExit: salePrice - totalExitCosts - crdAtExit,
  };
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
  const table = tbody.closest('table');
  tbody.innerHTML = '';
  let total = 0;

  // Convert rows to sortable data objects
  const data = rows.map(([label, val]) => {
    total += val;
    return { label, val, cond: label.includes('conditionnel') };
  });

  function renderRows(items) {
    tbody.innerHTML = '';
    items.forEach(d => {
      const tr = document.createElement('tr');
      const cls = d.val < 0 ? 'neg' : '';
      const cond = d.cond ? ' style="color:#92400e;font-style:italic"' : '';
      tr.innerHTML = '<td' + cond + '>' + d.label + '</td><td class="num ' + cls + '">' + fmt(d.val) + '</td>';
      tbody.appendChild(tr);
    });
    // Always append total row at the bottom
    const totalRow = document.createElement('tr');
    totalRow.style.fontWeight = '700';
    totalRow.style.background = '#edf2f7';
    totalRow.innerHTML = '<td><strong>' + totalLabel + '</strong></td><td class="num"><strong>' + fmt(total) + '</strong></td>';
    tbody.appendChild(totalRow);
  }

  renderRows(data);

  // Add sort attributes to headers and make sortable
  if (table) {
    const ths = table.querySelectorAll('thead th');
    if (ths.length >= 2) {
      if (!ths[0].getAttribute('data-sort')) {
        ths[0].setAttribute('data-sort', 'label');
        ths[0].setAttribute('data-sort-type', 'string');
        ths[1].setAttribute('data-sort', 'val');
      }
    }
    makeTableSortable(table, data, renderRows);
  }
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
  const stocksTotal = s.amine.ibkr + s.amine.espp + s.nezha.espp + s.amine.sgtm + s.nezha.sgtm;
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
    insights['kpiImmoViewVal'] = 'Valeur march\u00e9 bas\u00e9e sur donn\u00e9es MeilleursAgents/efficity (mars 2026) + prime neuf (+12-15%). Vitry 1.5%/an (L15 Les Ardoines), Villejuif 2%/an (L15 Louis Aragon), Rueil 1%/an (L15 lointaine).';
    insights['kpiImmoViewCRD'] = 'Capital Restant D\u00fb total. Se r\u00e9duit chaque mois. Fin : 2044 (Rueil), 2048 (Vitry), 2053 (Villejuif). Plus de d\u00e9tails dans la section Sources ci-dessous.';
    const twb = iv.totalWealthBreakdown || {};
    insights['kpiImmoViewWealth'] = '+\u20ac' + f(iv.totalWealthCreation) + '/mois = Capital amorti ' + f(twb.capitalAmorti || 0) + ' + Appr\u00e9ciation ' + f(twb.appreciation || 0) + (twb.cashflow >= 0 ? ' + CF +' + f(twb.cashflow) : ' - Effort ' + f(Math.abs(twb.cashflow || 0))) + '. Soit ~\u20ac' + f(iv.totalWealthCreation * 12) + '/an.';
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
