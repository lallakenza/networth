// ============================================================
// APP — Entry point. Orchestrates DATA → ENGINE → RENDER
// ============================================================
// See ARCHITECTURE.md for full documentation (pipeline, state
// flow, cache-busting, version history, and audit changelog).

import { PORTFOLIO, FX_STATIC, DATA_LAST_UPDATE, EQUITY_HISTORY, APP_VERSION } from './data.js?v=338';
import { compute, getGrandTotal } from './engine.js?v=338';
import { render } from './render.js?v=338';
import { fetchFXRates, fetchStockPrices, retryFailedTickers, fetchSoldStockPrices, clearCache, fetchHistoricalPrices } from './api.js?v=338';
import { rebuildAllCharts, buildCFProjection, coupleChartZoomOut, buildPortfolioYTDChart, redrawChartForPeriod, switchChartMode, buildEquityHistoryChart, renderPortfolioChart } from './charts.js?v=338';
import { initSimulators, bindSimulatorEvents } from './simulators.js?v=338';
import { PRICE_SNAPSHOT } from './price_snapshot.js?v=338';

// ---- App state ----
let currentFX = { ...FX_STATIC };
let currentView = 'couple';
let currentSubView = null;  // for immo sub-tabs: null | 'apt_vitry' | 'apt_rueil' | 'apt_villejuif'
let currentCurrency = 'EUR';
let fxSource = 'statique (27 fev 2026)';
let stockSource = 'statique';
let currentState = null;
let simulatorsBound = false;

const PERSON_VIEWS = ['couple', 'amine', 'nezha'];
const IMMO_VIEWS = ['immobilier', 'apt_vitry', 'apt_rueil', 'apt_villejuif'];
const ALL_VIEWS = ['couple', 'amine', 'nezha', 'actions', 'cash', 'immobilier', 'creances', 'budget', 'immo-financing', 'plan-fiscal'];
const IMMO_SUB_VIEWS = ['apt_vitry', 'apt_rueil', 'apt_villejuif'];

// ---- Scope-aware KPI card updater ----
/**
 * Updates static KPI cards in Actions view when toggling portfolio scope
 *
 * Recalculates and re-renders KPI totals (Total, P/L Unrealized, P/L Realized, Deposits, Dividends)
 * when the user switches between portfolio scopes (all, Amine, Nezha, ESPP, etc.).
 *
 * @param {string} scope - Portfolio scope: 'all'|'amine'|'nezha'|'espp'|'sgtm'|'ibkr'
 *
 * Flow:
 *   1. Fetch cached _actionsView (updated by renderActionsView)
 *   2. Look up scope-specific totals and P/L metrics
 *   3. Format values (EUR currency) and update DOM elements
 *   4. Add color coding: green for gains, red for losses
 *   5. Show P/L as percentage of deposits (sub-text)
 *
 * DOM Updates:
 *   - kpiActionsTotal: portfolio value
 *   - kpiActionsUnrealizedPL, kpiActionsRealizedPL: profit/loss with color
 *   - kpiActionsTotalDeposits: total invested
 *   - kpiActionsDividends: dividend income
 */
function updateStaticKPIsForScope(scope) {
  const av = window._actionsView;
  if (!av) return;
  const fmt = n => '€ ' + Math.round(n).toLocaleString('fr-FR');
  const setT = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setEur = (id, val) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = fmt(val); el.dataset.eur = Math.round(val); }
  };
  const setSubPct = (id, pct) => {
    const el = document.getElementById(id);
    if (!el) return;
    let sub = el.parentElement?.querySelector('.kpi-sub-pct');
    if (!sub) {
      sub = document.createElement('span');
      sub.className = 'kpi-sub-pct';
      el.insertAdjacentElement('afterend', sub);
    }
    const sign = pct >= 0 ? '+' : '';
    sub.textContent = sign + pct.toFixed(1) + '%';
    sub.style.cssText = 'display:block;font-size:12px;font-weight:600;margin-top:2px;color:' + (pct >= 0 ? '#276749' : '#c53030') + ';';
  };
  const setKPI = (total, unrealPL, realPL, deposits, dividends, label) => {
    setEur('kpiActionsTotal', total);
    const plSign = unrealPL >= 0 ? '+' : '';
    setT('kpiActionsUnrealizedPL', plSign + fmt(unrealPL));
    const plEl = document.getElementById('kpiActionsUnrealizedPL');
    if (plEl) plEl.className = 'value ' + (unrealPL >= 0 ? 'pl-pos' : 'pl-neg');
    setSubPct('kpiActionsUnrealizedPL', deposits > 0 ? unrealPL / deposits * 100 : 0);

    const rSign = realPL >= 0 ? '+' : '';
    setT('kpiActionsRealizedPL', rSign + fmt(realPL));
    const rEl = document.getElementById('kpiActionsRealizedPL');
    if (rEl) rEl.className = 'value ' + (realPL >= 0 ? 'pl-pos' : 'pl-neg');
    setSubPct('kpiActionsRealizedPL', deposits > 0 ? realPL / deposits * 100 : 0);

    setT('kpiActionsTotalDeposits', fmt(deposits));
    setT('kpiActionsDividends', fmt(dividends));

    setT('kpiActionsTotalLabel', 'Total Actions (' + label + ')');
    setT('kpiActionsUnrealizedLabel', 'P/L Non Réalisé (' + label + ')');
    setT('kpiActionsRealizedLabel', 'P/L Réalisé (' + label + ')');
    setT('kpiActionsDepositsLabel', 'Capital Net Déployé (' + label + ')');
    // v280 (BUG-014): sub-line breakdown per plateforme (brut / retiré / net)
    const subEl = document.getElementById('kpiActionsDepositsSub');
    if (subEl) {
      const fmt0 = n => Math.round(n).toLocaleString('fr-FR') + ' €';
      const parts = [];
      if (scope === 'all') {
        parts.push('IBKR ' + fmt0(av.ibkrDepositsTotal));
        parts.push('ESPP ' + fmt0(av.esppDeposits));
        parts.push('SGTM ' + fmt0(av.sgtmDepositsEUR));
        if (av.degiroDepositsNet !== undefined) {
          const dgNet = av.degiroDepositsNet;
          parts.push('Degiro ' + (dgNet >= 0 ? '' : '−') + fmt0(Math.abs(dgNet)));
        }
      } else if (scope === 'degiro' && av.degiroDepositsGross !== undefined) {
        parts.push('Brut ' + fmt0(av.degiroDepositsGross));
        parts.push('Retiré ' + fmt0(av.degiroWithdrawals));
      }
      subEl.textContent = parts.join(' · ');
    }
  };

  const esppTotal = (av.esppCurrentVal || 0) + (av.nezhaEsppCurrentVal || 0);
  const esppPL = (av.esppUnrealizedPL || 0) + (av.nezhaEsppUnrealizedPL || 0);

  switch (scope) {
    case 'all':
      setKPI(av.totalStocks, av.combinedUnrealizedPL, av.combinedRealizedPL, av.totalDeposits, av.dividends, 'Tous');
      break;
    case 'ibkr':
      setKPI(av.ibkrNAV, av.totalUnrealizedPL, av.realizedPL, av.ibkrDepositsTotal, av.dividends, 'IBKR');
      break;
    case 'espp':
      setKPI(esppTotal, esppPL, 0, av.esppDeposits || 0, 0, 'ESPP');
      break;
    case 'degiro':
      // v280 (BUG-014): Degiro NAV=0 (clôturé), Net Déployé = dépôts − retraits ≈ −50,664 €
      // Invariant : NAV − Net Déployé = 0 − (−50,664) = +50,664 ≈ Realized P&L ✓
      setKPI(0, 0, av.degiroRealizedPL || 0, av.degiroDepositsNet || 0, 0, 'Degiro');
      break;
    case 'maroc':
      setKPI(av.sgtmTotal || 0, av.sgtmUnrealizedPL || 0, 0, av.sgtmDepositsEUR || 0, 0, 'Maroc');
      break;
  }
}

// ---- URL hash routing ----
/**
 * Updates browser hash/URL to match current view
 *
 * Syncs window.location.hash with currentView/currentSubView for browser history support.
 * Uses replaceState (not pushState) to avoid accumulating history entries.
 *
 * Hash Format:
 *   - 'couple' view → no hash
 *   - other views → '#viewName'
 *   - immo sub-views → '#apt_vitry', '#apt_rueil', etc.
 */
function updateHash() {
  const view = currentSubView || currentView;
  const hash = view === 'couple' ? '' : '#' + view;
  if (location.hash !== hash && ('#' + '' !== hash || location.hash !== '')) {
    history.replaceState(null, '', hash || location.pathname + location.search);
  }
}

/**
 * Restores view state from browser URL hash on page load
 *
 * Parses location.hash and sets currentView/currentSubView. Handles both
 * main views (actions, cash, immobilier) and immo sub-views (apt_vitry, apt_rueil).
 * Defaults to 'couple' if no hash or invalid hash.
 *
 * Called once on app initialization.
 */
function restoreFromHash() {
  const hash = location.hash.replace('#', '');
  if (!hash) return; // default to couple
  if (IMMO_SUB_VIEWS.includes(hash)) {
    currentView = 'immobilier';
    currentSubView = hash;
  } else if (ALL_VIEWS.includes(hash)) {
    currentView = hash;
    currentSubView = null;
  }
}

/**
 * Syncs navigation UI buttons to match current view state
 *
 * Updates .active classes on view buttons (.view-btn) and immo sub-buttons (.immo-sub-btn)
 * to highlight the currently selected view. Called after any view change.
 *
 * DOM Updates:
 *   - Adds .active to selected main view button
 *   - Adds .active to selected immo sub-view button (if in immobilier view)
 *   - Removes .active from all other buttons
 */
// v320 — Vues groupées dans le dropdown "Analyse" (barre de nav).
const ANALYSE_VIEWS = ['creances', 'budget', 'immo-financing', 'plan-fiscal'];

function syncNavUI() {
  // Sync main view buttons
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  const mainView = IMMO_VIEWS.includes(currentSubView || currentView) ? 'immobilier' : currentView;
  const activeBtn = document.querySelector('.view-btn[data-view="' + mainView + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  // Sync immo sub-nav
  if (mainView === 'immobilier') {
    document.querySelectorAll('.immo-sub-btn').forEach(b => b.classList.remove('active'));
    const subview = currentSubView || 'immobilier';
    const subBtn = document.querySelector('.immo-sub-btn[data-subview="' + subview + '"]');
    if (subBtn) subBtn.classList.add('active');
  }
  // v320 — Highlight "Analyse" toggle quand une sous-vue du dropdown est active.
  const analyseToggle = document.getElementById('analyseToggle');
  if (analyseToggle) {
    analyseToggle.classList.toggle('parent-active', ANALYSE_VIEWS.includes(currentView));
  }
}

// ---- Central refresh ----
/**
 * Main refresh pipeline: compute state → render → rebuildAllCharts
 *
 * This is the central function called whenever data changes (view switch, FX update, price refresh).
 * Orchestrates the complete DATA → ENGINE → RENDER → CHARTS pipeline.
 *
 * Flow:
 *   1. compute(PORTFOLIO, currentFX, stockSource) → state object
 *   2. render(state, view, currency) → update DOM
 *   3. rebuildAllCharts(state, view) → rebuild all Chart.js charts
 *   4. buildCFProjection(state) → cash flow projection graph (person/immo views)
 *   5. initSimulators(state) → bind simulator event handlers
 *
 * Note: Expensive operations (FX fetch, price fetch) are separate async functions
 */
function refresh() {
  currentState = compute(PORTFOLIO, currentFX, stockSource);

  // Determine the effective view for render
  const effectiveView = currentSubView || currentView;
  render(currentState, effectiveView, currentCurrency);
  rebuildAllCharts(currentState, effectiveView);

  // CF projection for person views and immobilier
  if (PERSON_VIEWS.includes(effectiveView) || effectiveView === 'immobilier') {
    buildCFProjection(currentState);
  }
  if (PERSON_VIEWS.includes(effectiveView)) {
    initSimulators(currentState);

    // Bind simulator slider events (only once, but with latest state ref)
    if (!simulatorsBound) {
      bindSimulatorEvents(currentState, refresh);
      simulatorsBound = true;
    }
  }

  // Show/hide immo sub-nav
  const subNav = document.getElementById('immoSubNav');
  if (subNav) {
    subNav.style.display = IMMO_VIEWS.includes(effectiveView) ? 'flex' : 'none';
  }

  // Add bottom margin to view-switcher only when sub-nav is hidden
  const viewSwitcher = document.querySelector('.view-switcher');
  if (viewSwitcher) {
    viewSwitcher.style.marginBottom = IMMO_VIEWS.includes(effectiveView) ? '0' : '32px';
  }
}

// Expose refresh globally for use by render.js (Villejuif toggle etc.)
window._appRefresh = refresh;

// ---- Event handlers ----

// View switching
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    currentView = btn.dataset.view;
    currentSubView = null;  // reset sub-view when switching main view
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Close any open expand
    document.querySelectorAll('.cat-expand').forEach(e => e.classList.remove('open'));
    document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active-cat'));
    openCat = null;

    // Reset immo sub-nav
    document.querySelectorAll('.immo-sub-btn').forEach(b => b.classList.remove('active'));
    const defaultSubBtn = document.querySelector('.immo-sub-btn[data-subview="immobilier"]');
    if (defaultSubBtn) defaultSubBtn.classList.add('active');

    // v320 — Ferme le dropdown "Analyse" quand un item est cliqué (ou un autre onglet).
    const analyseDropdown = document.getElementById('analyseDropdown');
    if (analyseDropdown) analyseDropdown.classList.remove('open');
    const analyseToggle = document.getElementById('analyseToggle');
    if (analyseToggle) analyseToggle.setAttribute('aria-expanded', 'false');

    updateHash();
    refresh();
  });
});

// v320/v321 — Dropdown "Analyse" : toggle + fermeture sur clic extérieur + Esc.
// v321 — Sur mobile (≤600px), le menu est en `position: fixed` pour éviter le
// clipping par `.view-switcher { overflow-x: auto }` (breakpoint ≤480px). On
// calcule dynamiquement la valeur `top` depuis le bord bas de la view-switcher
// à chaque ouverture pour suivre le layout réel (header peut changer de hauteur,
// orientation, etc.).
(function setupAnalyseDropdown() {
  const dropdown = document.getElementById('analyseDropdown');
  const toggle = document.getElementById('analyseToggle');
  const menu = document.getElementById('analyseMenu');
  if (!dropdown || !toggle || !menu) return;

  const mobileMQ = window.matchMedia('(max-width: 600px)');

  function positionMenuMobile() {
    if (!mobileMQ.matches) {
      menu.style.top = '';
      return;
    }
    const sw = document.querySelector('.view-switcher');
    if (!sw) return;
    const rect = sw.getBoundingClientRect();
    // +1 pour masquer la bordure basse de la view-switcher sous le menu.
    menu.style.top = Math.max(0, Math.round(rect.bottom + 1)) + 'px';
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('open');
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) positionMenuMobile();
  });

  // Recalcul de position sur resize / orientation change si le menu est ouvert.
  window.addEventListener('resize', () => {
    if (dropdown.classList.contains('open')) positionMenuMobile();
  });

  // Clic extérieur : ferme le menu.
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Esc : ferme le menu et remet le focus sur le toggle.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });
})();

// Immo sub-view switching
document.querySelectorAll('.immo-sub-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const subview = btn.dataset.subview;
    document.querySelectorAll('.immo-sub-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (subview === 'immobilier') {
      currentSubView = null;
      currentView = 'immobilier';
    } else {
      currentSubView = subview;
      currentView = 'immobilier'; // keep main view as immobilier for nav highlight
    }

    // Make sure main immobilier button is highlighted
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    const immoBtn = document.querySelector('.view-btn[data-view="immobilier"]');
    if (immoBtn) immoBtn.classList.add('active');

    updateHash();
    refresh();
  });
});

// Browser back/forward navigation
window.addEventListener('hashchange', () => {
  restoreFromHash();
  syncNavUI();
  refresh();
});

// Currency switching
document.querySelectorAll('.cur-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentCurrency = btn.dataset.cur;
    document.querySelectorAll('.cur-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    refresh();
  });
});

// Category expand/collapse
let openCat = null;

function toggleCat(cat) {
  const allExpands = document.querySelectorAll('.cat-expand');
  const allCards = document.querySelectorAll('.cat-card');

  if (openCat === cat) {
    document.getElementById('expand-' + cat)?.classList.remove('open');
    allCards.forEach(c => c.classList.remove('active-cat'));
    openCat = null;
    return;
  }

  allExpands.forEach(e => e.classList.remove('open'));
  allCards.forEach(c => c.classList.remove('active-cat'));

  document.getElementById('expand-' + cat)?.classList.add('open');
  // Highlight the correct card
  const catNames = ['stocks', 'cash', 'immo', 'other'];
  allCards.forEach((card, i) => {
    if (!card.classList.contains('hidden') && catNames[i] === cat) {
      card.classList.add('active-cat');
    }
  });
  openCat = cat;
}

document.querySelectorAll('.cat-card').forEach((card, i) => {
  const catNames = ['stocks', 'cash', 'immo', 'other'];
  card.addEventListener('click', () => toggleCat(catNames[i]));
});

// Couple chart zoom out
window.coupleChartZoomOut = coupleChartZoomOut;

// ---- Dynamic date badge ----
(function() {
  var d = new Date();
  var label = 'Donnees au ' + d.getDate() + ' ' + d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  var badge = document.getElementById('dateBadge');
  if (badge) badge.textContent = label;
  var vBadge = document.getElementById('versionBadge');
  if (vBadge) vBadge.textContent = APP_VERSION;
})();

// ---- INIT ----
restoreFromHash();
syncNavUI();
refresh();

// Hide loading overlay after initial data load
document.getElementById('loadingOverlay')?.classList.add('hidden');

// ---- Fetch live data (FX) ----
function updateFxTimestamp() {
  const el = document.getElementById('fxTimestamp');
  if (el) {
    const now = new Date();
    const day = now.toLocaleDateString('fr-FR', { day: '2-digit' });
    const month = now.toLocaleDateString('fr-FR', { month: 'long' });
    const year = now.getFullYear();
    const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    el.textContent = ' — Dernière MAJ : ' + day + ' ' + month + ' ' + year + ' à ' + time;
  }
}

async function refreshFX(force) {
  const fxResult = await fetchFXRates(force);
  if (fxResult) {
    Object.assign(currentFX, fxResult.rates);
    fxSource = fxResult.source;
    const badge = document.getElementById('fxBadge');
    if (badge) { badge.textContent = 'Taux FX ' + fxSource; badge.style.color = 'var(--green)'; }
    updateFxTimestamp();
    refresh();
    // If stale, immediately re-fetch in background
    if (fxResult.stale) {
      const fresh = await fetchFXRates(true);
      if (fresh) {
        Object.assign(currentFX, fresh.rates);
        fxSource = fresh.source;
        if (badge) { badge.textContent = 'Taux FX ' + fxSource; badge.style.color = 'var(--green)'; }
        updateFxTimestamp();
        refresh();
      }
    }
  } else {
    const badge = document.getElementById('fxBadge');
    if (badge) badge.textContent = 'Taux FX ' + fxSource;
  }
}
// BUG-034: wrap standalone refreshFX calls in catch to prevent unhandled rejections
refreshFX(false).catch(e => console.warn('[app] Initial FX fetch error:', e));

// AUD-006: Module-level interval IDs for cleanup
let _fxIntervalId = null;
let _stockIntervalId = null;

// Auto-refresh FX every 5 minutes
if (_fxIntervalId) clearInterval(_fxIntervalId);
_fxIntervalId = setInterval(() => refreshFX(true).catch(e => console.warn('[app] FX interval error:', e)), 5 * 60 * 1000);

// ---- KPI computation from chart NAV series ----
// Uses the accurate forward-simulation data from buildPortfolioYTDChart
// instead of the per-position P&L approach (which misses cash/FX/deposits)
function updateKPIsFromChart(chartData) {
  const { labels, ibkrValues, totalValues, depositsByDate, startingNAV } = chartData;
  if (!labels || labels.length < 2) return;

  // ── Scope-aware value selection ──
  // Read the current scope from the global state
  const activeScope = window._currentScope || window._ytdChartFullData?.scope || 'ibkr';
  const fullData = window._ytdChartFullData;

  // ── Select the correct NAV, P&L, and cumDeposits series based on scope ──
  // P&L series come from the simulation (plValues) — these are the SAME values
  // used by the chart title and chart P&L mode, guaranteeing consistency.
  let values, plSeries, cumDeposits;
  switch (activeScope) {
    case 'espp':
      values = fullData?.esppValues || ibkrValues;
      plSeries = fullData?.plValuesESPP;
      cumDeposits = fullData?.cumDepositsESPP;
      break;
    case 'maroc':
      values = fullData?.sgtmValues || ibkrValues;
      plSeries = fullData?.plValuesSGTM;
      cumDeposits = fullData?.cumDepositsSGTM;
      break;
    case 'degiro':
      values = fullData?.degiroValues || ibkrValues;
      plSeries = fullData?.plValuesDegiro;
      cumDeposits = fullData?.cumDepositsDegiro;
      break;
    case 'all':
      values = totalValues && totalValues.length > 0 ? totalValues : ibkrValues;
      plSeries = fullData?.plValuesTotal;
      cumDeposits = fullData?.cumDepositsAtPointTotal;
      break;
    case 'ibkr':
    default:
      values = ibkrValues;
      plSeries = fullData?.plValuesIBKR;
      cumDeposits = fullData?.cumDepositsAtPoint;
      break;
  }

  const n = values.length;
  const lastNAV = values[n - 1];
  const prevNAV = values[n - 2];

  // ── Helper: find index at or just before a target date ──
  function idxAtDate(targetDate) {
    for (let i = labels.length - 1; i >= 0; i--) {
      if (labels[i] <= targetDate) return i;
    }
    return 0;
  }

  // Helper: cumDeposits between two indices
  function depositsInIdxRange(startIdx, endIdx) {
    if (!cumDeposits) return 0;
    return (cumDeposits[endIdx] || 0) - (cumDeposits[startIdx] || 0);
  }

  const lastDate = labels[n - 1];
  const prevDate = labels[n - 2];
  const firstDate = labels[0];

  // Compute period boundaries
  const lastDateObj = new Date(lastDate);
  const mtdStart = lastDate.slice(0, 8) + '01';
  const oneMonthAgo = new Date(lastDateObj);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const oneMonthStr = oneMonthAgo.toISOString().slice(0, 10);

  // ── Compute P&L from plSeries (single source of truth) ──
  // P&L for a period = plSeries[end] - plSeries[periodStart]
  // This matches the chart title exactly.
  const lastPL = plSeries ? plSeries[n - 1] : 0;
  const prevPL = plSeries ? plSeries[n - 2] : 0;

  // P&L Daily
  const plDaily = plSeries ? (lastPL - prevPL) : (lastNAV - prevNAV);

  // P&L MTD
  const mtdRefDate = mtdStart < firstDate ? firstDate : mtdStart;
  const mtdStartActual = labels.find(d => d >= mtdRefDate) || firstDate;
  const prevMtdIdx = Math.max(0, labels.indexOf(mtdStartActual) - 1);
  const plMTD = plSeries ? (lastPL - plSeries[prevMtdIdx]) : (lastNAV - values[prevMtdIdx]);

  // P&L 1 Month
  const date1MAgo = labels.find(d => d >= oneMonthStr) || firstDate;
  const prevIdx1M = Math.max(0, labels.indexOf(date1MAgo) - 1);
  const pl1M = plSeries ? (lastPL - plSeries[prevIdx1M]) : (lastNAV - values[prevIdx1M]);

  // P&L YTD = plSeries[last] - plSeries[first]
  const plYTD = plSeries ? (lastPL - plSeries[0]) : (lastNAV - values[0]);

  // Reference NAVs for percentage computation (capital deployed = startNAV + deposits)
  const ytdStartNAV = values[0];
  const navBeforeMTD = values[prevMtdIdx];
  const navBefore1M = values[prevIdx1M];

  // TWR (Time-Weighted Return) using Modified Dietz / daily chaining
  // TWR = product of (1 + daily_return) - 1, where daily_return adjusts for deposits
  let twr = 1;
  for (let i = 1; i < n; i++) {
    const prevVal = values[i - 1];
    // Use cumDeposits diff for this day's deposit
    const dep = cumDeposits
      ? ((cumDeposits[i] || 0) - (cumDeposits[i-1] || 0))
      : (depositsByDate[labels[i]] || 0);
    // Daily return: (endNAV - deposit) / startNAV - 1
    // Deposit is added at start of day, so adjusted start = prevVal + deposit
    const adjustedStart = prevVal + dep;
    if (adjustedStart > 0) {
      twr *= values[i] / adjustedStart;
    }
  }
  const twrPct = (twr - 1) * 100;

  // Format helper
  const fmt = v => {
    const abs = Math.abs(Math.round(v));
    const s = abs.toLocaleString('fr-FR');
    return (v < 0 ? '-' : '') + s;
  };

  // Update DOM
  function updateKPI(id, value, refValue) {
    const el = document.getElementById(id);
    if (!el) return;
    const v = Math.round(value);
    const sign = v >= 0 ? '+' : '';
    el.textContent = sign + fmt(v);
    el.className = 'value ' + (v >= 0 ? 'pl-pos' : 'pl-neg');
    // Save chart-computed value for render.js to reuse on re-render (tab switches)
    const pct = (refValue && refValue > 0) ? (value / refValue * 100) : null;
    if (!window._chartKPIOverrides) window._chartKPIOverrides = {};
    window._chartKPIOverrides[id] = { value: v, pct };
    // Update sub-percentage (class: kpi-sub-pct, set by setSubPct in render.js)
    // Always remove existing pct span first (prevents stale values when switching to scopes with 0 NAV)
    const existing = el.parentElement?.querySelector('.kpi-sub-pct');
    if (existing) existing.remove();
    if (pct != null) {
      const span = document.createElement('span');
      span.className = 'kpi-sub-pct';
      const pSign = pct >= 0 ? '+' : '';
      span.textContent = pSign + pct.toFixed(1) + '%';
      span.style.cssText = 'display:block;font-size:12px;font-weight:600;margin-top:2px;color:' + (pct >= 0 ? '#276749' : '#c53030') + ';';
      el.insertAdjacentElement('afterend', span);
    }
  }

  // Compute capital deployed (startNAV + deposits) for each period's %
  // This matches the chart title percentage formula exactly.
  const depDaily = depositsInIdxRange(n - 2, n - 1);
  const depMTD = depositsInIdxRange(prevMtdIdx, n - 1);
  const dep1M = depositsInIdxRange(prevIdx1M, n - 1);
  const depYTD = depositsInIdxRange(0, n - 1);
  updateKPI('kpiPLDaily', plDaily, prevNAV + depDaily);
  updateKPI('kpiPLMTD', plMTD, navBeforeMTD + depMTD);
  updateKPI('kpiPL1M', pl1M, navBefore1M + dep1M);
  updateKPI('kpiPLYTD', plYTD, ytdStartNAV + depYTD);

  // Update TWR
  const twrEl = document.getElementById('kpiActionsTWR');
  if (twrEl) {
    const twrSign = twrPct >= 0 ? '+' : '';
    twrEl.textContent = 'TWR ' + twrSign + twrPct.toFixed(1) + '%';
    twrEl.className = 'value ' + (twrPct >= 0 ? 'pl-pos' : 'pl-neg');
  }

  // ── Aggregate cost items for breakdown details ──
  const costItems = chartData.costItems || [];
  // Helper: sum costs in a date range and aggregate by category
  function aggregateCosts(startDate, endDate) {
    const cats = { interest: { eur: 0, usd: 0, jpy: 0 }, ftt: 0, dividends: 0 };
    costItems.forEach(c => {
      if (c.date > startDate && c.date <= endDate) {
        if (c.label.startsWith('Interest')) {
          cats.interest.eur += c.eurAmount || 0;
          cats.interest.usd += c.usdAmount || 0;
          cats.interest.jpy += c.jpyAmount || 0;
        } else if (c.label.startsWith('FTT')) {
          cats.ftt += c.eurAmount || 0;
        } else if (c.label.startsWith('Div')) {
          cats.dividends += c.eurAmount || 0;
        }
      }
    });
    // Convert to EUR (approximate using last known FX)
    const fxUSD = FX_STATIC.USD || 1.04;
    const fxJPY = FX_STATIC.JPY || 161;
    const interestEUR = cats.interest.eur + cats.interest.usd / fxUSD + cats.interest.jpy / fxJPY;
    return { interestEUR, fttEUR: cats.ftt, dividendsEUR: cats.dividends };
  }

  // ── 1Y P&L from chart (NAV evolution over 1 year) ──
  // The chart starts from IBKR inception (April 2025), which is within the 1Y window.
  // oneYear start date = 1 year ago from today
  const _now1Y = new Date();
  const oneYearAgoStr = (_now1Y.getFullYear() - 1) + '-' +
    String(_now1Y.getMonth() + 1).padStart(2, '0') + '-' +
    String(_now1Y.getDate()).padStart(2, '0');

  // Store cost breakdowns for each period on window for render.js detail generators
  // Percentages use capital deployed (start NAV + deposits) for consistency with chart
  const prevMtdDate = labels[prevMtdIdx];
  const prevDate1M = labels[prevIdx1M];
  const capDaily = prevNAV + depDaily;
  const capMTD = navBeforeMTD + depMTD;
  const cap1M = navBefore1M + dep1M;
  const capYTD = ytdStartNAV + depYTD;
  window._chartKPIData = {
    daily: { pl: plDaily, pct: capDaily > 0 ? (plDaily / capDaily * 100) : 0, costs: aggregateCosts(prevDate, lastDate) },
    mtd: { pl: plMTD, pct: capMTD > 0 ? (plMTD / capMTD * 100) : 0, costs: aggregateCosts(prevMtdDate, lastDate) },
    oneMonth: { pl: pl1M, pct: cap1M > 0 ? (pl1M / cap1M * 100) : 0, costs: aggregateCosts(prevDate1M, lastDate) },
    ytd: { pl: plYTD, pct: capYTD > 0 ? (plYTD / capYTD * 100) : 0, costs: aggregateCosts('2025-12-31', lastDate) },
    // 1Y costs: aggregate from 1Y ago to last chart date
    // Note: chart data starts April 2025 so all chart cost items are within 1Y window
    oneYear: { costs: aggregateCosts(oneYearAgoStr, lastDate) },
    twr: twrPct,
  };

  console.log('[kpi-chart] Updated KPIs from chart: Daily=' + Math.round(plDaily) +
    ', MTD=' + Math.round(plMTD) + ', 1M=' + Math.round(pl1M) +
    ', YTD=' + Math.round(plYTD) + ', TWR=' + twrPct.toFixed(2) + '%' +
    ', YTD costs: int=' + Math.round(window._chartKPIData.ytd.costs.interestEUR) +
    ', ftt=' + Math.round(window._chartKPIData.ytd.costs.fttEUR) +
    ', div=' + Math.round(window._chartKPIData.ytd.costs.dividendsEUR));
}

// ---- Update 1Y KPI from 1Y chart data ----
// Uses the pre-computed P&L values from _ytdChartFullData (set by buildPortfolioYTDChart)
// Separate from updateKPIsFromChart to avoid corrupting Daily/MTD/YTD
function update1YKPIFromChart() {
  // v269: prefer per-mode store for 1Y data (doesn't get overwritten by YTD builds)
  const data = window._chartDataByMode?.['1y'] || window._ytdChartFullData;
  if (!data || !data.labels || data.labels.length < 2) return;

  // ── Scope-aware: select the correct P&L and deposit series ──
  const activeScope = window._currentScope || data.scope || 'ibkr';

  let plValues, cumDepSeries, navValues;
  switch (activeScope) {
    case 'espp':
      plValues = data.plValuesESPP;
      cumDepSeries = data.cumDepositsESPP;
      navValues = data.esppValues;
      break;
    case 'maroc':
      plValues = data.plValuesSGTM;
      cumDepSeries = data.cumDepositsSGTM;
      navValues = data.sgtmValues;
      break;
    case 'degiro':
      plValues = data.plValuesDegiro;
      cumDepSeries = data.cumDepositsDegiro;
      navValues = data.degiroValues;
      break;
    case 'all':
      plValues = data.plValuesTotal;
      cumDepSeries = data.cumDepositsAtPointTotal;
      navValues = data.totalValues;
      break;
    case 'ibkr':
    default:
      plValues = data.plValuesIBKR;
      cumDepSeries = data.cumDepositsAtPoint;
      navValues = data.ibkrValues;
      break;
  }

  if (!plValues || plValues.length === 0) return;

  const pl1Y = plValues[plValues.length - 1];

  // Compute % relative to capital deployed (startValue + cumDeposits)
  const startVal = navValues ? navValues[0] : (data.startValue || 0);
  const cumDep = cumDepSeries
    ? (cumDepSeries[cumDepSeries.length - 1] || 0)
    : 0;
  const capitalDeployed = startVal + cumDep;
  const pct1Y = capitalDeployed > 0 ? (pl1Y / capitalDeployed * 100) : 0;

  // Update the 1Y KPI card
  const fmt = v => {
    const abs = Math.abs(Math.round(v));
    const s = abs.toLocaleString('fr-FR');
    return (v < 0 ? '-' : '') + s;
  };
  const el = document.getElementById('kpiPL1Y');
  if (el) {
    const v = Math.round(pl1Y);
    const sign = v >= 0 ? '+' : '';
    el.textContent = sign + fmt(v);
    el.className = 'value ' + (v >= 0 ? 'pl-pos' : 'pl-neg');
    // Update sub-percentage
    const existing = el.parentElement?.querySelector('.kpi-sub-pct');
    if (existing) existing.remove();
    const span = document.createElement('span');
    span.className = 'kpi-sub-pct';
    const pSign = pct1Y >= 0 ? '+' : '';
    span.textContent = pSign + pct1Y.toFixed(1) + '%';
    span.style.cssText = 'display:block;font-size:12px;font-weight:600;margin-top:2px;color:' + (pct1Y >= 0 ? '#276749' : '#c53030') + ';';
    el.insertAdjacentElement('afterend', span);
  }

  // Store on _chartKPIData for render.js detail view
  if (window._chartKPIData) {
    window._chartKPIData.oneYear.pl = pl1Y;
    window._chartKPIData.oneYear.pct = pct1Y;
  }
  // Also save to _chartKPIOverrides so render.js re-renders preserve the chart value
  if (!window._chartKPIOverrides) window._chartKPIOverrides = {};
  window._chartKPIOverrides['kpiPL1Y'] = { value: Math.round(pl1Y), pct: pct1Y };

  console.log('[kpi-1y] Updated 1Y KPI from chart: P&L=' + Math.round(pl1Y) + ', pct=' + pct1Y.toFixed(1) + '%, capitalDeployed=' + Math.round(capitalDeployed));
}

// ---- Stock price loading with progress ----
// AUD-011: Race condition guard
let _stockRefreshInProgress = false;

/**
 * @param {boolean} forceRefresh - true = hard refresh (ignore cache, re-fetch all)
 *                                 false = smart refresh (only fetch tickers missing from today's cache)
 */
async function loadStockPrices(forceRefresh) {
  // AUD-011: prevent concurrent stock refresh
  if (_stockRefreshInProgress && !forceRefresh) return;
  _stockRefreshInProgress = true;

  const sBadge = document.getElementById('stockBadge');
  const progressBar = document.getElementById('stockProgressBar');
  const progressFill = document.getElementById('stockProgressFill');
  const progressLabel = document.getElementById('stockProgressLabel');
  const refreshBtn = document.getElementById('refreshStocksBtn');
  const hardRefreshBtn = document.getElementById('hardRefreshBtn');

  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.style.opacity = '0.4'; }
  if (hardRefreshBtn) { hardRefreshBtn.disabled = true; hardRefreshBtn.style.opacity = '0.4'; }
  // Hard refresh: clear entire cache first so we start from scratch
  if (forceRefresh) clearCache();

  if (sBadge) sBadge.textContent = forceRefresh ? 'Actions : hard refresh...' : 'Actions : chargement live...';
  if (progressBar) progressBar.style.display = 'block';
  if (progressFill) progressFill.style.width = '0%';

  // v275: Also update chart area overlay during stock price loading (Phase 1)
  const _chartOverlayFill = document.getElementById('ytdProgressFill');
  const _chartOverlayLabel = document.getElementById('ytdProgressLabel');
  const _chartOverlayTitle = document.getElementById('ytdProgressTitle');

  function onProgress(loaded, total, ticker) {
    const pct = Math.round(loaded / total * 100);
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressLabel) progressLabel.textContent = loaded + '/' + total + ' — ' + ticker + (loaded === total ? ' ✓' : '...');
    // Mirror to chart overlay
    if (_chartOverlayFill) _chartOverlayFill.style.width = Math.round(pct * 0.5) + '%'; // Phase 1 = 0-50%
    if (_chartOverlayLabel) _chartOverlayLabel.textContent = loaded + '/' + total + ' — ' + ticker;
    if (_chartOverlayTitle && loaded === 1) _chartOverlayTitle.textContent = 'Chargement des prix live...';
  }

  // Throttled refresh: max once every 800ms to avoid thrashing
  let _refreshTimer = null;
  let _refreshPending = false;
  function throttledRefresh() {
    if (_refreshTimer) { _refreshPending = true; return; }
    stockSource = 'live';
    refresh();
    _refreshTimer = setTimeout(() => {
      _refreshTimer = null;
      if (_refreshPending) { _refreshPending = false; throttledRefresh(); }
    }, 800);
  }

  // Formate le suffixe SGTM (et futures actions marocaines) pour le badge.
  // Chaîne de fallback — cf. ARCHITECTURE §v330 "Moroccan stocks live pipeline" :
  // - repo:static-bootstrap → "statique"  (JSON initial, CI n'a pas encore tourné)
  // - repo:* (autres)       → "live ✓"    (CI < 24h, prix frais)
  // - google/leboursier/investing → "live (scraping)"  (fallback runtime)
  // - repo-stale:*          → "dernier relevé (Xh)"    (JSON > 24h + scraping KO)
  // - null / isLive=false   → "statique"  (fallback ultime = valeur hardcodée data.js)
  function sgtmSuffix(source, isLive) {
    if (!isLive) return 'statique';
    if (!source) return 'live';
    if (source === 'static-bootstrap' || source === 'repo:static-bootstrap') return 'statique';
    if (source.startsWith('repo-stale:')) return 'dernier relevé';
    if (source.startsWith('repo:')) return 'live ✓';
    return 'live (scraping)';
  }

  function updateBadge(result) {
    if (!sBadge) return;
    const yahooLive = result.liveCount - (result.sgtmLive ? 1 : 0);
    const yahooTotal = result.totalTickers - 1;
    const allYahooLive = yahooLive >= yahooTotal;

    const statusLabel = yahooLive > 0
      ? yahooLive + '/' + yahooTotal + ' live'
      : 'statique (données du ' + DATA_LAST_UPDATE + ')';
    const sgtmLabel = PORTFOLIO.market.sgtmPriceMAD + ' DH ('
      + sgtmSuffix(result.sgtmSource || PORTFOLIO.market._sgtmSource, result.sgtmLive) + ')';
    sBadge.textContent = 'Actions: ' + statusLabel + ' | SGTM: ' + sgtmLabel;
    sBadge.style.color = allYahooLive ? 'var(--green)' : 'var(--red)';
  }

  try {
    // Also re-fetch FX on hard refresh
    if (forceRefresh) {
      const fxResult = await fetchFXRates(true);
      if (fxResult) {
        Object.assign(currentFX, fxResult.rates);
        fxSource = fxResult.source;
        const badge = document.getElementById('fxBadge');
        if (badge) { badge.textContent = 'Taux FX ' + fxSource; badge.style.color = 'var(--green)'; }
        updateFxTimestamp();
      }
    }

    // ---- First pass: fetch all tickers (progressive — refresh UI as each loads) ----
    const result = await fetchStockPrices(PORTFOLIO, onProgress, forceRefresh, throttledRefresh);
    // Final refresh with all data applied
    if (result.updated) { stockSource = 'live'; refresh(); }
    updateBadge(result);

    // ---- Retry loop: keep trying failed tickers until all loaded ----
    if (result.failedTickers && result.failedTickers.length > 0) {
      if (sBadge) sBadge.textContent += ' (retry en cours...)';
      if (progressBar) progressBar.style.display = 'block';

      await retryFailedTickers(
        result.failedTickers,
        PORTFOLIO,
        function onRetryUpdate(liveCount, totalTickers, retryNum) {
          stockSource = 'live';
          refresh();
          const yahooLive = liveCount - (PORTFOLIO.market._sgtmLive ? 1 : 0);
          const yahooTotal = totalTickers - 1;
          const allYahooLive = yahooLive >= yahooTotal;
          const sgtmLabel = PORTFOLIO.market.sgtmPriceMAD + ' DH ('
            + sgtmSuffix(PORTFOLIO.market._sgtmSource, PORTFOLIO.market._sgtmLive) + ')';
          if (sBadge) {
            sBadge.textContent = 'Actions: ' + yahooLive + '/' + yahooTotal + ' live | SGTM: ' + sgtmLabel;
            if (!allYahooLive) sBadge.textContent += ' (retry ' + retryNum + '...)';
            sBadge.style.color = allYahooLive ? 'var(--green)' : 'var(--red)';
          }
          if (progressFill) progressFill.style.width = Math.round(liveCount / totalTickers * 100) + '%';
          if (progressLabel) progressLabel.textContent = 'Retry ' + retryNum + ' — ' + yahooLive + '/' + yahooTotal + ' live';
        },
        5,   // maxRetries
        5000 // 5s between retries
      );

      // Final badge update after retries
      const finalLive = PORTFOLIO.amine.ibkr.positions.filter(p => p._live === true).length + (PORTFOLIO.market._acnLive ? 1 : 0);
      const finalTotal = PORTFOLIO.amine.ibkr.positions.length + 1;
      const finalSgtm = PORTFOLIO.market._sgtmLive;
      updateBadge({ liveCount: finalLive + (finalSgtm ? 1 : 0), totalTickers: finalTotal + 1, sgtmLive: finalSgtm });
      refresh();
    }

    // ---- Background: fetch sold stock prices (always, even if some held tickers failed) ----
    {
      const heldTickers = new Set(PORTFOLIO.amine.ibkr.positions.map(p => p.ticker).concat(['ACN']));
      // Collect unique tickers from closed positions (trades) that are not currently held
      // ibkr.trades has IBKR trades, allTrades has Degiro trades — merge both
      const allTrades = (PORTFOLIO.amine.ibkr.trades || []).concat(PORTFOLIO.amine.allTrades || []);
      const soldTickerSet = new Set();
      const soldTickerMap = {}; // yahooTicker → originalTicker
      allTrades.forEach(t => {
        if (!t.ticker || t.ticker === 'MISC' || t.ticker === 'EUR.JPY' || t.type === 'fx') return;
        // Skip if currently held (live price already available via engine.js)
        if (heldTickers.has(t.ticker)) return;
        // Use explicit yahooTicker if provided, otherwise derive from currency
        let yahooTicker = t.yahooTicker || t.ticker;
        if (!t.yahooTicker && t.currency === 'EUR' && !t.ticker.includes('.')) {
          yahooTicker = t.ticker + '.PA'; // Euronext Paris
        }
        if (!heldTickers.has(yahooTicker) && !soldTickerSet.has(yahooTicker)) {
          soldTickerSet.add(yahooTicker);
          soldTickerMap[yahooTicker] = t.ticker;
        }
      });

      const soldTickers = [...soldTickerSet];
      if (soldTickers.length > 0) {
        console.log('[app] Fetching sold stock prices in background:', soldTickers);
        const soldResult = await fetchSoldStockPrices(soldTickers, PORTFOLIO, throttledRefresh);
        // Map Yahoo tickers back to original tickers for engine.js lookup
        if (soldResult.loaded > 0) {
          const sp = PORTFOLIO._soldPrices || {};
          Object.entries(soldTickerMap).forEach(([yahoo, orig]) => {
            if (sp[yahoo] && !sp[orig]) { sp[orig] = sp[yahoo]; }
          });
          refresh(); // Final refresh with sold prices
        }
      }
    }

    // ════════════════════════════════════════════════════════════
    //  HISTORICAL PRICES — YTD portfolio evolution chart
    //  Fetched AFTER live prices are loaded (dependency: need current
    //  stock prices first, then historical for the YTD chart)
    //  Uses Yahoo Finance chart API with range=ytd, interval=1d
    //  Includes FX rates (EURUSD, EURJPY) for multi-currency NAV
    // ════════════════════════════════════════════════════════════
    if (currentView === 'actions' || true) { // Always pre-fetch for fast tab switch
      try {
        // Collect all tickers needed: current positions + sold 2026 tickers
        const ytdTickerSet = new Set();
        // Current held positions
        PORTFOLIO.amine.ibkr.positions.forEach(p => ytdTickerSet.add(p.ticker));
        // Add ESPP Accenture for YTD chart
        ytdTickerSet.add('ACN');
        // Sold positions from all trades (2025 and 2026)
        (PORTFOLIO.amine.ibkr.trades || []).forEach(t => {
          if (t.type === 'fx') return;
          let yahooTicker = t.ticker;
          // Map EUR tickers without '.' to Euronext Paris (.PA)
          if (t.currency === 'EUR' && !t.ticker.includes('.')) {
            yahooTicker = t.ticker + '.PA';
          }
          ytdTickerSet.add(yahooTicker);
        });

        const ytdTickers = [...ytdTickerSet];
        console.log('[app] Fetching historical prices for charts:', ytdTickers);

        // Show progress on YTD chart area (Phase 2: 50-100%)
        const ytdProgress = document.getElementById('ytdChartProgress');
        const ytdFill = document.getElementById('ytdProgressFill');
        const ytdLabel = document.getElementById('ytdProgressLabel');
        const ytdTitle = document.getElementById('ytdProgressTitle');
        if (ytdProgress) ytdProgress.style.display = 'flex';
        if (ytdTitle) ytdTitle.textContent = 'Chargement des prix historiques...';
        if (ytdFill) ytdFill.style.width = '50%';

        // ── Single fetch: snapshot (static 1Y+) + delta (YTD from API) ──
        // v259: One dataset serves ALL periods (MTD→MAX). No more dual fetch.
        const historicalData = await fetchHistoricalPrices(ytdTickers, PRICE_SNAPSHOT, (loaded, total, ticker) => {
          const pct = Math.round(loaded / total * 100);
          if (ytdFill) ytdFill.style.width = (50 + Math.round(pct * 0.5)) + '%'; // 50-100%
          if (ytdLabel) ytdLabel.textContent = loaded + '/' + total + ' — ' + ticker + (loaded === total ? ' ✓' : '...');
        });

        // v338 — Charge l'historique daily SGTM maintenu par le scraper GitHub Actions.
        // Yahoo ne couvre pas la Bourse de Casablanca, donc on alimente SGTM_PRICES
        // via ce fichier same-origin (fetch sans CORS).
        try {
          const sgtmHistResp = await fetch('./data/sgtm_history.json?h=' + new Date().getHours());
          if (sgtmHistResp.ok) {
            const sgtmHist = await sgtmHistResp.json();
            if (Array.isArray(sgtmHist.series) && sgtmHist.series.length > 0) {
              historicalData.sgtmHistory = sgtmHist.series;
              const first = sgtmHist.series[0].date;
              const last = sgtmHist.series[sgtmHist.series.length - 1].date;
              console.log('[app] SGTM history loaded: ' + sgtmHist.series.length + ' days (' + first + ' → ' + last + ')');
            }
          }
        } catch (e) {
          console.warn('[app] SGTM history fetch failed (non-blocking):', e);
        }

        // Legacy aliases for backward compatibility
        const historicalDataYTD = historicalData;
        const historicalData1Y = historicalData;

        if (ytdProgress) ytdProgress.style.display = 'none';

        // ════════════════════════════════════════════════════════════
        //  PRICE UNIFICATION — Single source of truth
        //  The quote API (fetchStockPrices) returns live prices used by
        //  engine.js for the positions table. The chart API (fetchHistorical*)
        //  returns daily prices used by charts.js for the simulation.
        //  These two APIs can return DIFFERENT prices for "today", causing
        //  inconsistencies (e.g. Airbus daily P&L differs between breakdown
        //  and table). FIX: inject live quote prices into the historical
        //  data's last entry (today), so the chart simulation uses the
        //  EXACT same prices as the positions table.
        // ════════════════════════════════════════════════════════════
        const todayStr = new Date().toISOString().slice(0, 10);
        function unifyPrices(histData) {
          if (!histData?.tickers) return;
          // Inject live stock prices
          Object.entries(histData.tickers).forEach(([ticker, td]) => {
            const lastIdx = td.dates.length - 1;
            if (lastIdx < 0) return;
            if (td.dates[lastIdx] !== todayStr) return; // only override today
            // Find live price: IBKR positions have .price set by applyTickerToPortfolio
            const pos = PORTFOLIO.amine.ibkr.positions.find(p => p.ticker === ticker);
            if (pos && pos._live && pos.price > 0) {
              td.closes[lastIdx] = pos.price;
            }
            // ACN (ESPP)
            if (ticker === 'ACN' && PORTFOLIO.market._acnLive && PORTFOLIO.market.acnPriceUSD > 0) {
              td.closes[lastIdx] = PORTFOLIO.market.acnPriceUSD;
            }
          });
          // Inject live FX rates (USD, JPY, MAD)
          const fxPairs = [
            { key: 'usd', rate: currentFX.USD },
            { key: 'jpy', rate: currentFX.JPY },
            { key: 'mad', rate: currentFX.MAD },
          ];
          for (const { key, rate } of fxPairs) {
            if (histData.fx?.[key] && rate > 0) {
              const lastIdx = histData.fx[key].dates.length - 1;
              if (lastIdx >= 0 && histData.fx[key].dates[lastIdx] === todayStr) {
                histData.fx[key].closes[lastIdx] = rate;
              }
            }
          }
        }
        unifyPrices(historicalData);
        console.log('[app] Price unification: injected live quote prices + FX (USD/JPY/MAD) into historical data for ' + todayStr);

        // Build the YTD portfolio evolution chart — default scope is 'all' (Tous)
        const chartResultYTD = buildPortfolioYTDChart(PORTFOLIO, historicalDataYTD, FX_STATIC, {
          mode: 'ytd',
          startingNAV: 209495,
          includeESPP: true,
          includeSGTM: true,
          scope: 'all',
        });
        if (chartResultYTD) updateKPIsFromChart(chartResultYTD);
        console.log('[app] YTD portfolio chart built successfully (scope: all)');

        // v269: Silently build 1Y chart — skipRender prevents canvas/data overwrite
        buildPortfolioYTDChart(PORTFOLIO, historicalData1Y, FX_STATIC, {
          mode: '1y',
          includeESPP: true,
          includeSGTM: true,
          scope: 'all',
          skipRender: true,  // v269: store in _chartDataByMode['1y'], don't touch canvas
        });
        update1YKPIFromChart();

        // v269: Silently build alltime simulation for 5Y/MAX splice
        buildPortfolioYTDChart(PORTFOLIO, historicalData1Y, FX_STATIC, {
          mode: 'alltime',
          includeESPP: true,
          includeSGTM: true,
          skipRender: true,  // v269: alltime never renders anyway, but be explicit
        });
        console.log('[app] v269: 1Y + alltime stored silently (no YTD rebuild needed)');

        // Re-render positions table now that _chartBreakdown is available.
        // The override in render.js replaces engine.js period P&L with
        // chart-derived values, ensuring breakdown == table for all positions.
        refresh();
        // Re-apply chart KPI overrides (refresh() resets them to engine.js values)
        if (chartResultYTD) updateKPIsFromChart(chartResultYTD);
        update1YKPIFromChart();
        // v274: Force re-render the portfolio chart after refresh().
        // refresh() → rebuildAllCharts() destroys/rebuilds other charts which can
        // sometimes leave the portfolioYTD canvas blank. This ensures it's always visible.
        renderPortfolioChart();

        // v280: Signal grid animation with real grand total + velocity info.
        // Velocity = 6-month rolling delta on EQUITY_HISTORY actions (proxy for
        // monthly savings/accumulation pace). Honest fallback to simulator
        // default (8K€/mois) when historique is missing or volatile.
        if (typeof window._gridAnimationComplete === 'function') {
          const realTotal = getGrandTotal(currentState);

          // ── Velocity calculation — 6-month rolling on EQUITY_HISTORY.total ──
          // Rationale: EQUITY_HISTORY is the only time series we maintain
          // monthly, so it's our best proxy for actual accumulation pace.
          // It excludes cash/real-estate growth but captures the largest
          // driver (stock savings + market returns). Falls back gracefully.
          let velocityInfo = { monthlyPace: 8000, source: 'simulator' };
          try {
            if (Array.isArray(EQUITY_HISTORY) && EQUITY_HISTORY.length >= 7) {
              const latest = EQUITY_HISTORY[EQUITY_HISTORY.length - 1];
              const sixBack = EQUITY_HISTORY[EQUITY_HISTORY.length - 7]; // 6 months back (inclusive)
              if (latest && sixBack && typeof latest.total === 'number' && typeof sixBack.total === 'number') {
                const delta = latest.total - sixBack.total;
                const monthsElapsed = 6;
                const rawPace = delta / monthsElapsed;
                // Sanity bounds: reject clearly absurd rates (market crashes / windfalls).
                // If equity pace is very negative, keep simulator fallback to avoid
                // a "never reached" ETA that would be dominated by a short-term dip.
                if (rawPace >= 500 && rawPace <= 50000) {
                  velocityInfo = { monthlyPace: Math.round(rawPace), source: 'actuals6m' };
                } else {
                  console.log('[app] Velocity: 6m EQUITY pace out of sane bounds ('
                    + Math.round(rawPace) + '€/mois) → falling back to simulator default');
                }
              }
            }
          } catch (e) {
            console.warn('[app] Velocity computation failed:', e);
          }

          console.log('[app] Signaling grid animation:',
            Math.round(realTotal) + '€', 'velocity:', velocityInfo);
          window._gridAnimationComplete(realTotal, velocityInfo);
        }

        // Track current state for toggles (exposed on window for KPI functions)
        let currentScope = 'all';
        window._currentScope = currentScope;
        let currentPeriod = 'YTD';
        let historicalDataToUse = historicalDataYTD;

        // BUG-021: Guard against duplicate event listener binding
        // loadStockPrices() is called on init, manual refresh, and 10-min auto-refresh.
        // Without this guard, each call adds another set of listeners.
        if (window._chartTogglesBound) {
          // Already bound — skip re-binding, just update historicalDataToUse reference
          console.log('[app] Chart toggles already bound, skipping re-bind');
        } else {
        window._chartTogglesBound = true;

        // Bind scope toggle buttons
        document.querySelectorAll('#ytdScopeToggle button').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('#ytdScopeToggle button').forEach(b => {
              b.style.background = '#fff'; b.style.color = '#4a5568';
            });
            btn.style.background = '#2d3748'; btn.style.color = '#fff';
            currentScope = btn.dataset.scope;
            window._currentScope = currentScope;
            // ── Scope → chart display ──
            // Each scope shows ONLY that platform's evolution:
            //   ibkr   → IBKR-only NAV evolution
            //   espp   → ESPP-only valuation (ACN shares + cash)
            //   maroc  → SGTM/Maroc-only valuation
            //   degiro → Degiro (no active positions, shows IBKR as fallback)
            //   all    → Combined IBKR + ESPP + SGTM total
            // Note: includeESPP/includeSGTM are always true so all series are computed;
            //       the 'scope' option tells the chart which series to DISPLAY.
            const scopeMode = currentPeriod === '1Y' ? '1y' : 'ytd';
            const scopeResult = buildPortfolioYTDChart(PORTFOLIO, historicalDataToUse, FX_STATIC, {
              mode: scopeMode,
              startingNAV: 209495,
              includeESPP: true,
              includeSGTM: true,
              scope: currentScope,
            });
            // Only update Daily/MTD/YTD KPIs from YTD data (1Y has startingNAV=0 + weekly sampling)
            if (scopeResult && scopeMode !== '1y') updateKPIsFromChart(scopeResult);
            // But always update 1Y KPI from 1Y chart when in 1Y mode
            if (scopeResult && scopeMode === '1y') update1YKPIFromChart();
            // v269: When NOT in 1Y mode, silently update 1Y data (skipRender prevents canvas overwrite)
            if (scopeMode !== '1y') {
              buildPortfolioYTDChart(PORTFOLIO, historicalData1Y, FX_STATIC, {
                mode: '1y',
                includeESPP: true,
                includeSGTM: true,
                scope: currentScope,
                skipRender: true,  // v269: no canvas overwrite, no triple-rebuild
              });
              update1YKPIFromChart();
              // v269: No need to rebuild visible chart — YTD data was never overwritten
            }
            // Re-apply current period filter
            if (currentPeriod !== 'YTD' && currentPeriod !== '1Y') redrawChartForPeriod(currentPeriod);
            // Re-apply P&L mode if active
            if (window._ytdDisplayMode === 'pl') switchChartMode('pl');
            // ── Update static KPI cards based on scope ──
            updateStaticKPIsForScope(currentScope);
            // Refresh open breakdown panel (scope changed → new _chartBreakdown data)
            if (window._refreshActiveBreakdown) window._refreshActiveBreakdown();
          });
        });

        // Bind period toggle buttons
        document.querySelectorAll('#ytdPeriodToggle button').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('#ytdPeriodToggle button').forEach(b => {
              b.style.background = '#fff'; b.style.color = '#4a5568';
            });
            btn.style.background = '#2d3748'; btn.style.color = '#fff';
            currentPeriod = btn.dataset.period;

            // Select correct historical data based on period
            // All series are always computed; scope controls which one is displayed
            if (currentPeriod === '5Y' || currentPeriod === 'MAX') {
              // Long-term: use EQUITY_HISTORY static monthly data
              buildEquityHistoryChart(currentPeriod, { scope: currentScope });
            } else if (currentPeriod === '1Y') {
              historicalDataToUse = historicalData1Y;
              // v271: use cached 1Y data when available (fixes bug where buildPortfolioYTDChart
              // silently failed to execute). Only rebuild if scope changed.
              const cached1Y = window._chartDataByMode?.['1y'];
              if (cached1Y && cached1Y.scope === currentScope) {
                // Cache hit — just switch mode and re-render
                window._activeChartMode = '1y';
                window._ytdChartFullData = cached1Y;
                redrawChartForPeriod('1Y');
                console.log('[app] 1Y: using cached data (scope=' + currentScope + ')');
              } else {
                // Cache miss or scope changed — rebuild
                console.log('[app] 1Y: rebuilding (cached=' + !!cached1Y + ', scope=' + currentScope + ')');
                try {
                  const result1Y = buildPortfolioYTDChart(PORTFOLIO, historicalData1Y, FX_STATIC, {
                    mode: '1y',
                    includeESPP: true,
                    includeSGTM: true,
                    scope: currentScope,
                  });
                  if (result1Y) console.log('[app] 1Y build succeeded');
                } catch (e) {
                  console.error('[app] 1Y build error:', e);
                }
                window._activeChartMode = '1y';
                window._ytdChartFullData = window._chartDataByMode['1y'];
              }
              // Only update the 1Y KPI card (not Daily/MTD/YTD which need YTD chart data)
              update1YKPIFromChart();
            } else if (currentPeriod === 'YTD') {
              historicalDataToUse = historicalDataYTD;
              // v269: if YTD data exists for current scope, just switch to it
              if (window._chartDataByMode.ytd && window._chartDataByMode.ytd.scope === currentScope) {
                window._activeChartMode = 'ytd';
                window._ytdChartFullData = window._chartDataByMode.ytd;
                redrawChartForPeriod('YTD');
              } else {
                // Rebuild full YTD chart
                const scopeResult = buildPortfolioYTDChart(PORTFOLIO, historicalDataYTD, FX_STATIC, {
                  mode: 'ytd',
                  startingNAV: 209495,
                  includeESPP: true,
                  includeSGTM: true,
                  scope: currentScope,
                });
                if (scopeResult) updateKPIsFromChart(scopeResult);
              }
            } else {
              // v269: Sub-period (MTD, 1M, 3M) — switch to YTD data from per-mode store
              if (window._activeChartMode !== 'ytd') {
                // If YTD data not yet built for this scope, rebuild it
                if (!window._chartDataByMode.ytd || window._chartDataByMode.ytd.scope !== currentScope) {
                  historicalDataToUse = historicalDataYTD;
                  const scopeResult = buildPortfolioYTDChart(PORTFOLIO, historicalDataYTD, FX_STATIC, {
                    mode: 'ytd',
                    startingNAV: 209495,
                    includeESPP: true,
                    includeSGTM: true,
                    scope: currentScope,
                  });
                  if (scopeResult) updateKPIsFromChart(scopeResult);
                } else {
                  // v269: just switch to stored YTD data, no rebuild
                  window._activeChartMode = 'ytd';
                  window._ytdChartFullData = window._chartDataByMode.ytd;
                  historicalDataToUse = historicalDataYTD;
                }
              }
              redrawChartForPeriod(currentPeriod);
            }
            // Preserve current display mode (Valeur or P&L) when changing period
            const currentMode = window._ytdDisplayMode || 'value';
            if (currentMode === 'pl') {
              switchChartMode('pl');
            }
            // Update toggle button styles to reflect current mode
            document.querySelectorAll('#ytdModeToggle button').forEach(b => {
              b.style.background = b.dataset.mode === currentMode ? '#2d3748' : '#fff';
              b.style.color = b.dataset.mode === currentMode ? '#fff' : '#4a5568';
            });
            // Refresh open breakdown panel (period changed → new _chartBreakdown data)
            if (window._refreshActiveBreakdown) window._refreshActiveBreakdown();
          });
        });

        // Bind Valeur/P&L mode toggle
        document.querySelectorAll('#ytdModeToggle button').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('#ytdModeToggle button').forEach(b => {
              b.style.background = '#fff'; b.style.color = '#4a5568';
            });
            btn.style.background = '#2d3748'; btn.style.color = '#fff';
            switchChartMode(btn.dataset.mode);
          });
        });

        // v269: Bind Owner toggle (Amine / Nezha / Both)
        window._activeOwner = 'both';
        document.querySelectorAll('#ytdOwnerToggle button').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('#ytdOwnerToggle button').forEach(b => {
              b.style.background = '#fff'; b.style.color = '#4a5568';
            });
            btn.style.background = '#2d3748'; btn.style.color = '#fff';
            window._activeOwner = btn.dataset.owner;
            // Re-render current chart with owner filter (no rebuild needed)
            const currentMode = window._ytdDisplayMode || 'value';
            const activeData = window._chartDataByMode[window._activeChartMode] || window._ytdChartFullData;
            if (activeData) {
              redrawChartForPeriod(activeData.currentPeriod || currentPeriod);
              if (currentMode === 'pl') switchChartMode('pl');
            }
          });
        });
        } // end BUG-021 guard (_chartTogglesBound)
      } catch (e) {
        console.warn('[app] YTD chart error:', e);
        const ytdProgress = document.getElementById('ytdChartProgress');
        if (ytdProgress) ytdProgress.style.display = 'none';
      }
    }
  } catch (e) {
    console.warn('Stock fetch error:', e);
    if (sBadge) { sBadge.textContent = 'Actions : erreur — données du ' + DATA_LAST_UPDATE; sBadge.style.color = 'var(--red)'; }
    _stockRefreshInProgress = false; // AUD-011: clear flag on error
  }

  setTimeout(() => { if (progressBar) progressBar.style.display = 'none'; }, 2000);
  if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.style.opacity = '1'; }
  if (hardRefreshBtn) { hardRefreshBtn.disabled = false; hardRefreshBtn.style.opacity = '1'; }
  _stockRefreshInProgress = false;
}

// Initial load — smart refresh (uses cache)
loadStockPrices(false);

// Refresh button — smart refresh (only missing tickers)
document.getElementById('refreshStocksBtn')?.addEventListener('click', () => loadStockPrices(false));

// Hard Refresh button — force re-fetch all tickers
document.getElementById('hardRefreshBtn')?.addEventListener('click', () => loadStockPrices(true));

// Auto-refresh every 10 minutes (smart, uses cache)
if (_stockIntervalId) clearInterval(_stockIntervalId);
_stockIntervalId = setInterval(() => loadStockPrices(false), 10 * 60 * 1000);
