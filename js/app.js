// ============================================================
// APP — Entry point. Orchestrates DATA → ENGINE → RENDER
// ============================================================

import { PORTFOLIO, FX_STATIC, DATA_LAST_UPDATE } from './data.js?v=204';
import { compute } from './engine.js?v=204';
import { render } from './render.js?v=204';
import { fetchFXRates, fetchStockPrices, retryFailedTickers, fetchSoldStockPrices, clearCache, fetchHistoricalPricesYTD, fetchHistoricalPrices1Y } from './api.js?v=204';
import { rebuildAllCharts, buildCFProjection, coupleChartZoomOut, buildPortfolioYTDChart, redrawChartForPeriod, switchChartMode } from './charts.js?v=204';
import { initSimulators, bindSimulatorEvents } from './simulators.js?v=204';

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

// ---- Scope-aware KPI card updater ----
// Updates the static (non-period) KPI cards when toggling scope
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
    setT('kpiActionsDepositsLabel', 'Total Déposé (' + label + ')');
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
      setKPI(0, 0, av.degiroRealizedPL || 0, 0, 0, 'Degiro');
      break;
    case 'maroc':
      setKPI(av.sgtmTotal || 0, av.sgtmUnrealizedPL || 0, 0, av.sgtmDepositsEUR || 0, 0, 'Maroc');
      break;
  }
}

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

// ---- KPI computation from chart NAV series ----
// Uses the accurate forward-simulation data from buildPortfolioYTDChart
// instead of the per-position P&L approach (which misses cash/FX/deposits)
function updateKPIsFromChart(chartData) {
  const { labels, ibkrValues, totalValues, depositsByDate, startingNAV, scope } = chartData;
  if (!labels || labels.length < 2) return;

  // Use total values if scope=all, else IBKR-only
  const values = scope === 'all' && totalValues.length > 0 ? totalValues : ibkrValues;
  const n = values.length;
  const lastNAV = values[n - 1];
  const prevNAV = values[n - 2];

  // Helper: find NAV at or just before a target date
  function navAtDate(targetDate) {
    for (let i = labels.length - 1; i >= 0; i--) {
      if (labels[i] <= targetDate) return values[i];
    }
    return values[0]; // fallback to first
  }

  // Helper: sum deposits between two dates (exclusive start, inclusive end)
  function depositsInRange(startDate, endDate) {
    let total = 0;
    for (const [date, amount] of Object.entries(depositsByDate)) {
      if (date > startDate && date <= endDate) total += amount;
    }
    return total;
  }

  const lastDate = labels[n - 1];
  const prevDate = labels[n - 2];
  const firstDate = labels[0];

  // Compute period boundaries
  const lastDateObj = new Date(lastDate);
  // MTD: first day of current month
  const mtdStart = lastDate.slice(0, 8) + '01';
  // 1 Month ago
  const oneMonthAgo = new Date(lastDateObj);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const oneMonthStr = oneMonthAgo.toISOString().slice(0, 10);

  // P&L = NAV change minus deposits in the period
  // P&L Daily
  const depositsDaily = depositsInRange(prevDate, lastDate);
  const plDaily = lastNAV - prevNAV - depositsDaily;

  // P&L MTD
  const mtdRefDate = mtdStart < firstDate ? firstDate : mtdStart;
  const navMTDStart = navAtDate(mtdRefDate);
  // We need deposits after mtdRefDate up to lastDate
  const mtdStartActual = labels.find(d => d >= mtdRefDate) || firstDate;
  const prevMtdDate = labels[Math.max(0, labels.indexOf(mtdStartActual) - 1)] || firstDate;
  const navBeforeMTD = navAtDate(prevMtdDate);
  const depositsMTD = depositsInRange(prevMtdDate, lastDate);
  const plMTD = lastNAV - navBeforeMTD - depositsMTD;

  // P&L 1 Month
  const nav1MAgo = navAtDate(oneMonthStr);
  const date1MAgo = labels.find(d => d >= oneMonthStr) || firstDate;
  const prevDate1M = labels[Math.max(0, labels.indexOf(date1MAgo) - 1)] || firstDate;
  const navBefore1M = navAtDate(prevDate1M);
  const deposits1M = depositsInRange(prevDate1M, lastDate);
  const pl1M = lastNAV - navBefore1M - deposits1M;

  // P&L YTD
  const depositsYTD = depositsInRange('2025-12-31', lastDate);
  // For scope=ibkr: startingNAV is 209495. For scope=all, use the first total value.
  const ytdStartNAV = scope === 'all' ? values[0] : startingNAV;
  const plYTD = lastNAV - ytdStartNAV - depositsYTD;

  // TWR (Time-Weighted Return) using Modified Dietz / daily chaining
  // TWR = product of (1 + daily_return) - 1, where daily_return adjusts for deposits
  let twr = 1;
  for (let i = 1; i < n; i++) {
    const prevVal = values[i - 1];
    const dep = depositsByDate[labels[i]] || 0;
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
    if (pct != null) {
      const existing = el.parentElement?.querySelector('.kpi-sub-pct');
      if (existing) existing.remove();
      const span = document.createElement('span');
      span.className = 'kpi-sub-pct';
      const pSign = pct >= 0 ? '+' : '';
      span.textContent = pSign + pct.toFixed(1) + '%';
      span.style.cssText = 'display:block;font-size:12px;font-weight:600;margin-top:2px;color:' + (pct >= 0 ? '#276749' : '#c53030') + ';';
      el.insertAdjacentElement('afterend', span);
    }
  }

  updateKPI('kpiPLDaily', plDaily, prevNAV);
  updateKPI('kpiPLMTD', plMTD, navBeforeMTD);
  updateKPI('kpiPL1M', pl1M, navBefore1M);
  updateKPI('kpiPLYTD', plYTD, ytdStartNAV);

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
  window._chartKPIData = {
    daily: { pl: plDaily, pct: prevNAV > 0 ? (plDaily / prevNAV * 100) : 0, costs: aggregateCosts(prevDate, lastDate) },
    mtd: { pl: plMTD, pct: navBeforeMTD > 0 ? (plMTD / navBeforeMTD * 100) : 0, costs: aggregateCosts(prevMtdDate, lastDate) },
    oneMonth: { pl: pl1M, pct: navBefore1M > 0 ? (pl1M / navBefore1M * 100) : 0, costs: aggregateCosts(prevDate1M, lastDate) },
    ytd: { pl: plYTD, pct: ytdStartNAV > 0 ? (plYTD / ytdStartNAV * 100) : 0, costs: aggregateCosts('2025-12-31', lastDate) },
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
  const data = window._ytdChartFullData;
  if (!data || !data.labels || data.labels.length < 2) return;

  // Use the chart's own P&L computation (accounts for deposits correctly)
  const plValues = data.showAll ? data.plValuesTotal : data.plValuesIBKR;
  if (!plValues || plValues.length === 0) return;

  const pl1Y = plValues[plValues.length - 1];

  // Compute % relative to capital deployed (startValue + cumDeposits)
  const cumDep = data.showAll
    ? (data.cumDepositsAtPointTotal?.[data.cumDepositsAtPointTotal.length - 1] || 0)
    : (data.cumDepositsAtPoint?.[data.cumDepositsAtPoint.length - 1] || 0);
  const capitalDeployed = (data.startValue || 0) + cumDep;
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

  console.log('[kpi-1y] Updated 1Y KPI from chart: P&L=' + Math.round(pl1Y) + ', pct=' + pct1Y.toFixed(1) + '%, capitalDeployed=' + Math.round(capitalDeployed));
}

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

        // Show progress on YTD chart area
        const ytdProgress = document.getElementById('ytdChartProgress');
        const ytdFill = document.getElementById('ytdProgressFill');
        const ytdLabel = document.getElementById('ytdProgressLabel');
        if (ytdProgress) ytdProgress.style.display = 'block';

        // Fetch both YTD and 1Y data
        const historicalDataYTD = await fetchHistoricalPricesYTD(ytdTickers, (loaded, total, ticker) => {
          const pct = Math.round(loaded / total * 100);
          if (ytdFill) ytdFill.style.width = pct + '%';
          if (ytdLabel) ytdLabel.textContent = loaded + '/' + total + ' — YTD: ' + ticker + (loaded === total ? ' ✓' : '...');
        });

        const historicalData1Y = await fetchHistoricalPrices1Y(ytdTickers, (loaded, total, ticker) => {
          const pct = Math.round(loaded / total * 100);
          if (ytdFill) ytdFill.style.width = pct + '%';
          if (ytdLabel) ytdLabel.textContent = loaded + '/' + total + ' — 1Y: ' + ticker + (loaded === total ? ' ✓' : '...');
        });

        if (ytdProgress) ytdProgress.style.display = 'none';

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

        // Track current state for toggles
        let currentScope = 'all';
        let currentPeriod = 'YTD';
        let historicalDataToUse = historicalDataYTD;

        // Bind scope toggle buttons
        document.querySelectorAll('#ytdScopeToggle button').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('#ytdScopeToggle button').forEach(b => {
              b.style.background = '#fff'; b.style.color = '#4a5568';
            });
            btn.style.background = '#2d3748'; btn.style.color = '#fff';
            currentScope = btn.dataset.scope;
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
            // When NOT in 1Y mode, silently rebuild 1Y chart to update P&L 1Y KPI
            if (scopeMode !== '1y') {
              buildPortfolioYTDChart(PORTFOLIO, historicalData1Y, FX_STATIC, {
                mode: '1y',
                includeESPP: true,
                includeSGTM: true,
                scope: currentScope,
              });
              update1YKPIFromChart();
              // Rebuild visible chart (1Y build overwrote the canvas)
              buildPortfolioYTDChart(PORTFOLIO, historicalDataToUse, FX_STATIC, {
                mode: scopeMode,
                startingNAV: 209495,
                includeESPP: true,
                includeSGTM: true,
                scope: currentScope,
              });
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
            if (currentPeriod === '1Y') {
              historicalDataToUse = historicalData1Y;
              const result1Y = buildPortfolioYTDChart(PORTFOLIO, historicalData1Y, FX_STATIC, {
                mode: '1y',
                includeESPP: true,
                includeSGTM: true,
                scope: currentScope,
              });
              // Only update the 1Y KPI card (not Daily/MTD/YTD which need YTD chart data)
              if (result1Y) update1YKPIFromChart();
            } else if (currentPeriod === 'YTD') {
              historicalDataToUse = historicalDataYTD;
              // Rebuild full YTD chart
              const scopeResult = buildPortfolioYTDChart(PORTFOLIO, historicalDataYTD, FX_STATIC, {
                mode: 'ytd',
                startingNAV: 209495,
                includeESPP: true,
                includeSGTM: true,
                scope: currentScope,
              });
              if (scopeResult) updateKPIsFromChart(scopeResult);
            } else {
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
      } catch (e) {
        console.warn('[app] YTD chart error:', e);
        const ytdProgress = document.getElementById('ytdChartProgress');
        if (ytdProgress) ytdProgress.style.display = 'none';
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
