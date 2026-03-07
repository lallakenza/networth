// ============================================================
// APP — Entry point. Orchestrates DATA → ENGINE → RENDER
// ============================================================

import { PORTFOLIO, FX_STATIC } from './data.js?v=8';
import { compute } from './engine.js?v=8';
import { render } from './render.js?v=8';
import { fetchFXRates, fetchStockPrices } from './api.js?v=8';
import { rebuildAllCharts, buildCFProjection, coupleChartZoomOut } from './charts.js?v=8';
import { initSimulators, bindSimulatorEvents } from './simulators.js?v=8';

// ---- App state ----
let currentFX = { ...FX_STATIC };
let currentView = 'couple';
let currentCurrency = 'EUR';
let fxSource = 'statique (27 fev 2026)';
let stockSource = 'statique';
let currentState = null;
let simulatorsBound = false;

const PERSON_VIEWS = ['couple', 'amine', 'nezha'];

// ---- Central refresh ----
function refresh() {
  currentState = compute(PORTFOLIO, currentFX, stockSource);
  render(currentState, currentView, currentCurrency);
  rebuildAllCharts(currentState, currentView);

  // CF projection only for person views and immobilier
  if (PERSON_VIEWS.includes(currentView)) {
    buildCFProjection(currentState);
    initSimulators(currentState);

    // Bind simulator slider events (only once, but with latest state ref)
    if (!simulatorsBound) {
      bindSimulatorEvents(currentState, refresh);
      simulatorsBound = true;
    }
  }
}

// ---- Event handlers ----

// View switching
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    currentView = btn.dataset.view;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Close any open expand
    document.querySelectorAll('.cat-expand').forEach(e => e.classList.remove('open'));
    document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active-cat'));
    openCat = null;
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
    sBadge.textContent = 'Actions: ' + statusLabel + ' | SGTM: ' + PORTFOLIO.market.sgtmPriceMAD + ' DH (statique)';
    if (result.liveCount > 0) sBadge.style.color = 'var(--green)';
  }
})();
