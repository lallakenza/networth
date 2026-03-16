// ============================================================
// API LAYER — Fetch live FX rates and stock prices
// ============================================================
// Returns data only, never touches the DOM.
// Uses localStorage as daily cache to avoid redundant API calls.
//
// STRATEGY: Maximize success rate by using multiple CORS proxies,
// multiple Yahoo endpoints, all in parallel. Then retry failed
// tickers in a loop until all are loaded or max retries reached.

// ---- Cache helpers ----
const CACHE_PREFIX = 'nw_cache_';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — re-fetch live after this

function todayKey() {
  const d = new Date();
  return CACHE_PREFIX + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function loadCache() {
  try {
    const raw = localStorage.getItem(todayKey());
    return raw ? JSON.parse(raw) : { stocks: {}, fx: null, sgtm: null };
  } catch (e) { return { stocks: {}, fx: null, sgtm: null }; }
}

function saveCache(cache) {
  try { localStorage.setItem(todayKey(), JSON.stringify(cache)); } catch (e) { /* quota exceeded — ignore */ }
}

function purgeOldCache() {
  try {
    const today = todayKey();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX) && key !== today) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) { /* ignore */ }
}

purgeOldCache();

/** Clear all stock & FX entries from today's cache (used by hard refresh) */
export function clearCache() {
  try {
    const key = todayKey();
    localStorage.removeItem(key);
    console.log('[cache] Cache cleared for hard refresh');
  } catch (e) { /* ignore */ }
}

// ---- CORS Proxy list ----
// Each proxy wraps a target URL to bypass CORS.
// Order matters: most reliable first. We race them ALL in parallel.
const PROXIES = [
  url => url, // direct (works without CORS in some browsers)
  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
  url => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url),
  url => 'https://corsproxy.io/?' + encodeURIComponent(url),
  url => 'https://api.cors.lol/?url=' + encodeURIComponent(url),
  url => 'https://thingproxy.freeboard.io/fetch/' + url,
];

// ---- Helper: fetch with timeout ----
function fetchWithTimeout(url, timeoutMs) {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

// ============================================================
// FX RATES
// ============================================================
const FX_TTL_MS = 5 * 60 * 1000; // 5 minutes — re-fetch FX after this

export async function fetchFXRates(forceRefresh) {
  const cache = loadCache();
  const now = Date.now();
  const timeLabel = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  if (!forceRefresh && cache.fx && cache.fx.rates) {
    const fresh = cache.fx._ts && (now - cache.fx._ts) < FX_TTL_MS;
    if (fresh) {
      console.log('[cache] FX rates loaded from cache (fresh, age ' + Math.round((now - cache.fx._ts) / 1000) + 's)');
      return { rates: cache.fx.rates, source: 'live (' + timeLabel + ')' };
    }
    // Stale cache — return it immediately but also trigger background re-fetch
    console.log('[cache] FX rates from stale cache, will re-fetch in background');
    // Return stale data now, caller should also call fetchFXRates(true) in background
    return { rates: cache.fx.rates, source: 'live (' + timeLabel + ')', stale: true };
  }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/EUR');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.result === 'success' && data.rates) {
      const rates = { EUR: 1, AED: data.rates.AED, MAD: data.rates.MAD, USD: data.rates.USD, JPY: data.rates.JPY };
      const c = loadCache();
      c.fx = { rates, _ts: Date.now() };
      saveCache(c);
      console.log('[api] FX rates fetched live:', JSON.stringify(rates));
      return { rates, source: 'live (' + timeLabel + ')' };
    }
  } catch (e) {
    console.warn('[api] FX API indisponible:', e.message);
  }
  return null;
}

// ============================================================
// STOCK PRICES — Single ticker fetch (race ALL proxies + endpoints)
// ============================================================

/**
 * Extract price + previousClose from Yahoo v8 chart endpoint (range=5d).
 * Uses historical OHLC data: current price from meta, previousClose from
 * the second-to-last trading day's close in the time series.
 */
function extractFromChart(d) {
  const result = d?.chart?.result?.[0];
  const meta = result?.meta;
  const p = meta?.regularMarketPrice;
  if (!p || p <= 0) return null;

  // Try meta.previousClose first
  let prevClose = meta?.previousClose || null;

  // If missing, derive from historical closes (range=5d gives ~5 trading days)
  if (!prevClose || prevClose <= 0) {
    const closes = result?.indicators?.quote?.[0]?.close;
    if (closes && closes.length >= 2) {
      // Walk backwards to find the second-to-last valid close
      for (let i = closes.length - 2; i >= 0; i--) {
        if (closes[i] && closes[i] > 0) { prevClose = closes[i]; break; }
      }
    }
  }

  return { price: p, previousClose: prevClose };
}

/** Extract price from Yahoo v6 quote endpoint */
function extractFromQuote(d) {
  const q = d?.quoteResponse?.result?.[0];
  if (!q) return null;
  const p = q.regularMarketPrice;
  if (!p || p <= 0) return null;
  return { price: p, previousClose: q.regularMarketPreviousClose || null };
}

/**
 * Fetch a single ticker — tries ALL proxies × 2 Yahoo endpoints in parallel.
 * Returns { price, previousClose } or null.
 *
 * Simple & fast: Promise.any picks the first successful result.
 * Uses range=5d so extractFromChart can derive previousClose from OHLC history.
 * 12 parallel requests per ticker (6 proxies × 2 endpoints).
 */
async function fetchStockPrice(symbol) {
  const chartUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?range=5d&interval=1d';
  const quoteUrl = 'https://query1.finance.yahoo.com/v6/finance/quote?symbols=' + symbol;

  const attempts = [];

  for (const proxy of PROXIES) {
    attempts.push(
      fetchWithTimeout(proxy(chartUrl), 10000)
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(d => { const result = extractFromChart(d); if (!result) throw new Error('no data'); return result; })
    );
    attempts.push(
      fetchWithTimeout(proxy(quoteUrl), 10000)
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(d => { const result = extractFromQuote(d); if (!result) throw new Error('no data'); return result; })
    );
  }

  try {
    return await Promise.any(attempts);
  } catch (e) {
    return null;
  }
}

// ============================================================
// SGTM — Casablanca Bourse (multiple sources)
// ============================================================
async function fetchSGTMPrice() {
  const gUrl = 'https://www.google.com/finance/quote/GTM:CAS';
  const lUrl = 'https://www.leboursier.ma/cours/SGTM';

  function extractGooglePrice(html) {
    const m = html.match(/data-last-price="([\d.]+)"/);
    if (m && parseFloat(m[1]) > 0) return parseFloat(m[1]);
    throw new Error('no price');
  }

  function extractBoursierPrice(html) {
    const m = html.match(/cours[^>]*>[\s]*([\d\s]+[.,]\d{2})/i) ||
              html.match(/"price"[:\s]*([\d.]+)/) ||
              html.match(/"lastPrice"[:\s]*([\d.]+)/);
    if (m) {
      const price = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
      if (price > 0) return price;
    }
    throw new Error('no price');
  }

  // Try all proxies for both Google Finance and leboursier
  const attempts = [];
  for (const proxy of PROXIES.slice(1)) { // skip direct (HTML pages always need proxy)
    attempts.push(
      fetchWithTimeout(proxy(gUrl), 10000)
        .then(r => { if (!r.ok) throw new Error(); return r.text(); })
        .then(extractGooglePrice)
    );
    attempts.push(
      fetchWithTimeout(proxy(lUrl), 10000)
        .then(r => { if (!r.ok) throw new Error(); return r.text(); })
        .then(extractBoursierPrice)
    );
  }

  try {
    return await Promise.any(attempts);
  } catch (e) {
    return null;
  }
}

// ============================================================
// MAIN — Fetch all stock prices with cache + aggressive retry
// ============================================================

/**
 * Apply a single ticker price to the portfolio (mutates portfolio in place)
 * @param {string} ticker
 * @param {object} priceData - { price, previousClose }
 * @param {object} portfolio
 */
function applyTickerToPortfolio(ticker, priceData, portfolio) {
  if (ticker === 'ACN') {
    portfolio.market.acnPriceUSD = priceData.price;
    portfolio.market.acnPreviousClose = priceData.previousClose;
    portfolio.market._acnLive = true;
    return;
  }
  const pos = portfolio.amine.ibkr.positions.find(p => p.ticker === ticker);
  if (pos) {
    pos.price = priceData.price;
    pos.previousClose = priceData.previousClose;
    pos._live = true;
  }
}

/**
 * Fetch all stock prices (IBKR positions + ACN + SGTM)
 * Progressive: applies each price to portfolio as soon as it loads and calls onTickerLoaded.
 * @param {object} portfolio
 * @param {function} onProgress - callback(loaded, total, ticker) for progress bar
 * @param {boolean} forceRefresh - bypass cache
 * @param {function} [onTickerLoaded] - callback() fired each time a new ticker is applied to portfolio.
 *                                      Use this to trigger a UI refresh progressively.
 * Returns { updated, liveCount, totalTickers, sgtmLive, failedTickers }
 */
export async function fetchStockPrices(portfolio, onProgress, forceRefresh, onTickerLoaded) {
  const allTickers = portfolio.amine.ibkr.positions.map(p => p.ticker).concat(['ACN']);
  const totalTickers = allTickers.length + 1; // +1 for SGTM
  let loaded = 0;
  const prices = {};

  // ---- Load from cache (apply immediately) ----
  const cache = loadCache();
  let tickersToFetch = [];
  let cachedSGTM = null;
  let cacheHadUpdates = false;

  const now = Date.now();
  const staleTickers = new Set(); // tickers already counted from cache but need re-fetch
  if (!forceRefresh) {
    for (const ticker of allTickers) {
      const cached = cache.stocks[ticker];
      if (cached && cached.price > 0) {
        // Apply cached price immediately for fast first render
        prices[ticker] = cached;
        applyTickerToPortfolio(ticker, cached, portfolio);
        cacheHadUpdates = true;
        loaded++;
        if (onProgress) onProgress(loaded, totalTickers, ticker + ' ✓');
        // If cache is stale (>TTL), also schedule a re-fetch
        if (!cached._ts || (now - cached._ts) > CACHE_TTL_MS) {
          tickersToFetch.push(ticker);
          staleTickers.add(ticker); // already counted, don't re-count
        }
      } else {
        tickersToFetch.push(ticker);
      }
    }
    if (cache.sgtm && cache.sgtm.price) {
      cachedSGTM = cache.sgtm.price;
      portfolio.market.sgtmPriceMAD = cachedSGTM;
      portfolio.market._sgtmLive = true;
      loaded++;
      if (onProgress) onProgress(loaded, totalTickers, 'SGTM ✓');
      // Also re-fetch SGTM if stale
    }
    // Refresh once after applying all cached prices
    if (cacheHadUpdates && onTickerLoaded) onTickerLoaded();
    const freshCount = allTickers.length - tickersToFetch.length;
    const staleCount = tickersToFetch.length - allTickers.filter(t => !cache.stocks[t] || !cache.stocks[t].price).length;
    console.log('[api] ' + freshCount + '/' + allTickers.length + ' fresh cache'
      + (staleCount > 0 ? ', ' + staleCount + ' stale (re-fetching)' : '')
      + ', ' + (tickersToFetch.length - staleCount) + ' no cache'
      + (cachedSGTM !== null ? ', SGTM cached' : ''));
  } else {
    tickersToFetch = [...allTickers];
    console.log('[api] Hard refresh — fetching all ' + totalTickers);
  }

  // Mark non-loaded positions as static
  portfolio.amine.ibkr.positions.forEach(pos => {
    if (!prices[pos.ticker]) pos._live = false;
  });
  if (!prices['ACN']) portfolio.market._acnLive = false;
  if (!cachedSGTM) portfolio.market._sgtmLive = false;

  // ---- Fetch all missing tickers in parallel (no batching!) ----
  // Each ticker applies immediately and triggers a progressive UI refresh
  let cacheUpdated = false;

  if (tickersToFetch.length > 0 || cachedSGTM === null) {
    const tickerPromises = tickersToFetch.map(async (ticker) => {
      const result = await fetchStockPrice(ticker);
      if (result) {
        result._ts = Date.now(); // cache timestamp for TTL
        prices[ticker] = result;
        cache.stocks[ticker] = result;
        cacheUpdated = true;
        // Apply immediately to portfolio
        applyTickerToPortfolio(ticker, result, portfolio);
        if (onTickerLoaded) onTickerLoaded();
      }
      // Don't double-count tickers already counted from stale cache
      if (!staleTickers.has(ticker)) {
        loaded++;
        if (onProgress) onProgress(loaded, totalTickers, ticker + (result ? ' ✓' : ' ✗'));
      }
    });

    // SGTM in parallel
    const sgtmPromise = (cachedSGTM === null)
      ? fetchSGTMPrice().then(r => {
          loaded++;
          if (onProgress) onProgress(loaded, totalTickers, 'SGTM' + (r ? ' ✓' : ' ✗'));
          if (r) {
            cachedSGTM = r;
            portfolio.market.sgtmPriceMAD = r;
            portfolio.market._sgtmLive = true;
            cache.sgtm = { price: r, _ts: Date.now() };
            cacheUpdated = true;
            if (onTickerLoaded) onTickerLoaded();
          }
          return r;
        })
      : Promise.resolve(null);

    await Promise.all([Promise.all(tickerPromises), sgtmPromise]);

    if (cacheUpdated) saveCache(cache);
  }

  // Build result
  const sgtmLive = !!cachedSGTM;
  const failedTickers = allTickers.filter(t => !prices[t]);
  if (failedTickers.length > 0) {
    console.log('[api] Failed tickers after first pass: ' + failedTickers.join(', '));
  } else {
    console.log('[api] All held tickers loaded successfully!');
  }

  return {
    updated: Object.keys(prices).length > 0 || sgtmLive,
    liveCount: Object.keys(prices).length + (sgtmLive ? 1 : 0),
    totalTickers: allTickers.length + 1,
    sgtmLive,
    failedTickers,
  };
}

/**
 * Fetch prices for sold stocks (closed positions not in current portfolio).
 * Only call this AFTER all held stocks loaded successfully (0 failures).
 * Applies prices to portfolio._soldPrices for "Si gardé auj." calculations.
 * @param {string[]} soldTickers - tickers to fetch (Yahoo format)
 * @param {object} portfolio - mutated: portfolio._soldPrices[ticker] = { price, previousClose }
 * @param {function} [onTickerLoaded] - callback after each sold ticker loads
 * Returns { loaded, failed }
 */
export async function fetchSoldStockPrices(soldTickers, portfolio, onTickerLoaded) {
  if (!soldTickers || soldTickers.length === 0) return { loaded: 0, failed: 0 };

  const cache = loadCache();
  if (!portfolio._soldPrices) portfolio._soldPrices = {};
  let loadedCount = 0;
  let failedCount = 0;

  console.log('[api] Fetching ' + soldTickers.length + ' sold stock prices in background...');

  const promises = soldTickers.map(async (ticker) => {
    // Check cache first
    const cached = cache.stocks[ticker];
    if (cached && cached.price > 0) {
      portfolio._soldPrices[ticker] = cached;
      loadedCount++;
      console.log('[api] Sold ' + ticker + ' from cache: ' + cached.price);
      if (onTickerLoaded) onTickerLoaded();
      return;
    }
    // Fetch live
    const result = await fetchStockPrice(ticker);
    if (result) {
      result._ts = Date.now();
      portfolio._soldPrices[ticker] = result;
      cache.stocks[ticker] = result;
      loadedCount++;
      console.log('[api] Sold ' + ticker + ' live: ' + result.price);
      if (onTickerLoaded) onTickerLoaded();
    } else {
      failedCount++;
      console.log('[api] Sold ' + ticker + ' FAILED');
    }
  });

  await Promise.all(promises);
  saveCache(cache);
  console.log('[api] Sold stocks done: ' + loadedCount + ' loaded, ' + failedCount + ' failed');
  return { loaded: loadedCount, failed: failedCount };
}

/**
 * Retry loop: keep fetching failed tickers until all loaded or maxRetries
 * @param {string[]} failedTickers - tickers that failed on first pass
 * @param {object} portfolio - mutated with new prices
 * @param {function} onRetryUpdate - callback(liveCount, totalTickers, retryNum) after each retry round
 * @param {number} maxRetries - max retry rounds (default 5)
 * @param {number} delayMs - delay between retry rounds (default 5000)
 * Returns final { liveCount, totalTickers }
 */
export async function retryFailedTickers(failedTickers, portfolio, onRetryUpdate, maxRetries, delayMs) {
  maxRetries = maxRetries || 5;
  delayMs = delayMs || 5000;
  let remaining = [...failedTickers];
  const cache = loadCache();
  const allTickers = portfolio.amine.ibkr.positions.map(p => p.ticker).concat(['ACN']);

  for (let retry = 1; retry <= maxRetries && remaining.length > 0; retry++) {
    console.log('[retry] Round ' + retry + '/' + maxRetries + ': ' + remaining.length + ' tickers (' + remaining.join(', ') + ')');
    await new Promise(r => setTimeout(r, delayMs));

    // Fetch all remaining in parallel
    const results = await Promise.all(remaining.map(async (ticker) => {
      const result = await fetchStockPrice(ticker);
      return { ticker, result };
    }));

    let anySuccess = false;
    for (const { ticker, result } of results) {
      if (result) {
        // Update portfolio
        const pos = portfolio.amine.ibkr.positions.find(p => p.ticker === ticker);
        if (pos) {
          pos.price = result.price;
          pos.previousClose = result.previousClose;
          pos._live = true;
        }
        if (ticker === 'ACN') {
          portfolio.market.acnPriceUSD = result.price;
          portfolio.market.acnPreviousClose = result.previousClose;
          portfolio.market._acnLive = true;
        }
        // Update cache
        result._ts = Date.now();
        cache.stocks[ticker] = result;
        anySuccess = true;
      }
    }

    if (anySuccess) saveCache(cache);

    remaining = remaining.filter(t => {
      const pos = portfolio.amine.ibkr.positions.find(p => p.ticker === t);
      if (pos) return !pos._live;
      if (t === 'ACN') return !portfolio.market._acnLive;
      return true;
    });

    // Count live
    const liveCount = allTickers.filter(t => {
      const pos = portfolio.amine.ibkr.positions.find(p => p.ticker === t);
      if (pos) return pos._live === true;
      if (t === 'ACN') return portfolio.market._acnLive === true;
      return false;
    }).length + (portfolio.market._sgtmLive ? 1 : 0);

    if (onRetryUpdate) onRetryUpdate(liveCount, allTickers.length + 1, retry);

    if (remaining.length === 0) {
      console.log('[retry] All tickers loaded after retry round ' + retry + '!');
      break;
    }
  }

  if (remaining.length > 0) {
    console.log('[retry] Still missing after ' + maxRetries + ' retries: ' + remaining.join(', '));
  }

  return { remaining };
}
