// ============================================================
// APP — Entry point. Orchestrates DATA → ENGINE → RENDER
// ============================================================

import { PORTFOLIO, FX_STATIC } from './data.js?v=79';
import { compute } from './engine.js?v=79';
import { render } from './render.js?v=79';
import { fetchFXRates, fetchStockPrices } from './api.js?v=79';
import { rebuildAllCharts, buildCFProjection, coupleChartZoomOut } from './charts.js?v=79';
import { initSimulators, bindSimulatorEvents } from './simulators.js?v=79';

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

    refresh();
  });
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

(async function() {
  // Stock prices
  const result = await fetchStockPrices(PORTFOLIO);
  if (result.updated) {
    stockSource = 'live';
    refresh();
  }
  const sBadge = document.getElementById('stockBadge');
  if (sBadge) {
    const statusLabel = result.liveCount > 0 ? result.liveCount + '/' + result.totalTickers + ' live' : 'statique';
    const sgtmLabel = result.sgtmLive ? PORTFOLIO.market.sgtmPriceMAD + ' DH (live)' : PORTFOLIO.market.sgtmPriceMAD + ' DH (statique)';
    sBadge.textContent = 'Actions: ' + statusLabel + ' | SGTM: ' + sgtmLabel;
    if (result.liveCount > 0) sBadge.style.color = 'var(--green)';
  }
})();
