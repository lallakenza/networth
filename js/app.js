// ============================================================
// APP — Entry point. Orchestrates DATA → ENGINE → RENDER
// ============================================================

import { PORTFOLIO, FX_STATIC, DATA_LAST_UPDATE } from './data.js?v=149';
import { compute } from './engine.js?v=149';
import { render } from './render.js?v=149';
import { fetchFXRates, fetchStockPrices, retryFailedTickers, fetchSoldStockPrices, clearCache } from './api.js?v=149';
import { rebuildAllCharts, buildCFProjection, coupleChartZoomOut } from './charts.js?v=149';
import { initSimulators, bindSimulatorEvents } from './simulators.js?v=149';

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
refreshFX(false);

// Auto-refresh FX every 5 minutes
setInterval(() => refreshFX(true), 5 * 60 * 1000);

// ---- Stock price loading with progress ----
let stockRefreshInProgress = false;

/**
 * @param {boolean} forceRefresh - true = hard refresh (ignore cache, re-fetch all)
 *                                 false = smart refresh (only fetch tickers missing from today's cache)
 */
async function loadStockPrices(forceRefresh) {
  // Allow hard refresh to interrupt a smart refresh in progress
  if (stockRefreshInProgress && !forceRefresh) return;
  stockRefreshInProgress = true;

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

  function onProgress(loaded, total, ticker) {
    const pct = Math.round(loaded / total * 100);
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressLabel) progressLabel.textContent = loaded + '/' + total + ' — ' + ticker + (loaded === total ? ' ✓' : '...');
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

  function updateBadge(result) {
    if (!sBadge) return;
    const yahooLive = result.liveCount - (result.sgtmLive ? 1 : 0);
    const yahooTotal = result.totalTickers - 1;
    const allYahooLive = yahooLive >= yahooTotal;

    const statusLabel = yahooLive > 0
      ? yahooLive + '/' + yahooTotal + ' live'
      : 'statique (données du ' + DATA_LAST_UPDATE + ')';
    const sgtmLabel = result.sgtmLive
      ? PORTFOLIO.market.sgtmPriceMAD + ' DH (live)'
      : PORTFOLIO.market.sgtmPriceMAD + ' DH (statique)';
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
          const sgtmLabel = PORTFOLIO.market._sgtmLive
            ? PORTFOLIO.market.sgtmPriceMAD + ' DH (live)'
            : PORTFOLIO.market.sgtmPriceMAD + ' DH (statique)';
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
  } catch (e) {
    console.warn('Stock fetch error:', e);
    if (sBadge) { sBadge.textContent = 'Actions : erreur — données du ' + DATA_LAST_UPDATE; sBadge.style.color = 'var(--red)'; }
  }

  setTimeout(() => { if (progressBar) progressBar.style.display = 'none'; }, 2000);
  if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.style.opacity = '1'; }
  if (hardRefreshBtn) { hardRefreshBtn.disabled = false; hardRefreshBtn.style.opacity = '1'; }
  stockRefreshInProgress = false;
}

// Initial load — smart refresh (uses cache)
loadStockPrices(false);

// Refresh button — smart refresh (only missing tickers)
document.getElementById('refreshStocksBtn')?.addEventListener('click', () => loadStockPrices(false));

// Hard Refresh button — force re-fetch all tickers
document.getElementById('hardRefreshBtn')?.addEventListener('click', () => loadStockPrices(true));

// Auto-refresh every 10 minutes (smart, uses cache)
setInterval(() => loadStockPrices(false), 10 * 60 * 1000);
