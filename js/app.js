// ============================================================
// APP — Entry point. Orchestrates DATA → ENGINE → RENDER
// ============================================================

import { PORTFOLIO, FX_STATIC, DATA_LAST_UPDATE } from './data.js?v=99';
import { compute } from './engine.js?v=99';
import { render } from './render.js?v=99';
import { fetchFXRates, fetchStockPrices } from './api.js?v=99';
import { rebuildAllCharts, buildCFProjection, coupleChartZoomOut } from './charts.js?v=99';
import { initSimulators, bindSimulatorEvents } from './simulators.js?v=99';

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
const ALL_VIEWS = ['couple', 'amine', 'nezha', 'actions', 'cash', 'immobilier', 'creances', 'budget'];
const IMMO_SUB_VIEWS = ['apt_vitry', 'apt_rueil', 'apt_villejuif'];

// ---- URL hash routing ----
function updateHash() {
  const view = currentSubView || currentView;
  const hash = view === 'couple' ? '' : '#' + view;
  if (location.hash !== hash && ('#' + '' !== hash || location.hash !== '')) {
    history.replaceState(null, '', hash || location.pathname + location.search);
  }
}

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
}

// ---- Central refresh ----
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

    updateHash();
    refresh();
  });
});

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
})();

// ---- INIT ----
restoreFromHash();
syncNavUI();
refresh();

// ---- Fetch live data ----
(async function() {
  // FX rates
  const fxResult = await fetchFXRates();
  if (fxResult) {
    Object.assign(currentFX, fxResult.rates);
    fxSource = fxResult.source;
    const badge = document.getElementById('fxBadge');
    if (badge) { badge.textContent = 'Taux FX ' + fxSource; badge.style.color = 'var(--green)'; }
    refresh();
  } else {
    const badge = document.getElementById('fxBadge');
    if (badge) badge.textContent = 'Taux FX ' + fxSource;
  }
})();

// ---- Stock price loading with progress ----
let stockRefreshInProgress = false;

async function loadStockPrices() {
  if (stockRefreshInProgress) return;
  stockRefreshInProgress = true;

  const sBadge = document.getElementById('stockBadge');
  const progressBar = document.getElementById('stockProgressBar');
  const progressFill = document.getElementById('stockProgressFill');
  const progressLabel = document.getElementById('stockProgressLabel');
  const refreshBtn = document.getElementById('refreshStocksBtn');

  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.style.opacity = '0.4'; }
  if (sBadge) sBadge.textContent = 'Actions : chargement live...';
  if (progressBar) progressBar.style.display = 'block';
  if (progressFill) progressFill.style.width = '0%';

  function onProgress(loaded, total, ticker) {
    const pct = Math.round(loaded / total * 100);
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressLabel) progressLabel.textContent = loaded + '/' + total + ' — ' + ticker + (loaded === total ? ' ✓' : '...');
  }

  try {
    const result = await fetchStockPrices(PORTFOLIO, onProgress);
    if (result.updated) {
      stockSource = 'live';
      refresh();
    }
    if (sBadge) {
      const statusLabel = result.liveCount > 0
        ? result.liveCount + '/' + result.totalTickers + ' live'
        : 'statique (données du ' + DATA_LAST_UPDATE + ')';
      const sgtmLabel = result.sgtmLive
        ? PORTFOLIO.market.sgtmPriceMAD + ' DH (live)'
        : PORTFOLIO.market.sgtmPriceMAD + ' DH (statique)';
      sBadge.textContent = 'Actions: ' + statusLabel + ' | SGTM: ' + sgtmLabel;
      if (result.liveCount > 0) sBadge.style.color = 'var(--green)';
    }
  } catch (e) {
    console.warn('Stock fetch error:', e);
    if (sBadge) sBadge.textContent = 'Actions : erreur — données du ' + DATA_LAST_UPDATE;
  }

  // Hide progress bar after a short delay
  setTimeout(() => { if (progressBar) progressBar.style.display = 'none'; }, 2000);
  if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.style.opacity = '1'; }
  stockRefreshInProgress = false;
}

// Initial load
loadStockPrices();

// Refresh button
document.getElementById('refreshStocksBtn')?.addEventListener('click', () => loadStockPrices());

// Auto-refresh every 10 minutes
setInterval(() => loadStockPrices(), 10 * 60 * 1000);
