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
export async function fetchFXRates(forceRefresh) {
  if (!forceRefresh) {
    const cache = loadCache();
    if (cache.fx) {
      console.log('[cache] FX rates loaded from cache');
      return { rates: cache.fx.rates, source: 'live (' + new Date().toLocaleDateString('fr-FR') + ')' };
    }
  }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/EUR');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.result === 'success' && data.rates) {
      const rates = { EUR: 1, AED: data.rates.AED, MAD: data.rates.MAD, USD: data.rates.USD, JPY: data.rates.JPY };
      const cache = loadCache();
      cache.fx = { rates };
      saveCache(cache);
      return { rates, source: 'live (' + new Date().toLocaleDateString('fr-FR') + ')' };
    }
  } catch (e) {
    console.warn('FX API indisponible:', e.message);
  }
  return null;
}

// ============================================================
// STOCK PRICES — Single ticker fetch (race ALL proxies + endpoints)
// ============================================================

/** Extract price from Yahoo v8 chart endpoint */
function extractFromChart(d) {
  const result = d?.chart?.result?.[0];
  const meta = result?.meta;
  const p = meta?.regularMarketPrice;
  if (!p || p <= 0) return null;
  return { price: p, previousClose: meta?.previousClose || null };
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
 * Hybrid strategy (two-phase Promise.any):
 *   Phase 1: Race all attempts, but REJECT results missing previousClose.
 *            → First COMPLETE result wins (fast like Promise.any, quality like Promise.all).
 *   Phase 2: If phase 1 fails (no complete result), accept any result with a price.
 *            → Fallback ensures we at least get a price even without previousClose.
 */
async function fetchStockPrice(symbol) {
  const chartUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?range=1d&interval=1d';
  const quoteUrl = 'https://query1.finance.yahoo.com/v6/finance/quote?symbols=' + symbol;

  // Build promise factories — each returns { price, previousClose } or throws
  const makeAttempt = (proxy, url, extractor) =>
    fetchWithTimeout(proxy(url), 10000)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => { const result = extractor(d); if (!result) throw new Error('no data'); return result; });

  // Launch ALL attempts at once (12 total: 6 proxies × 2 endpoints)
  const rawPromises = [];
  for (const proxy of PROXIES) {
    rawPromises.push(makeAttempt(proxy, chartUrl, extractFromChart));
    rawPromises.push(makeAttempt(proxy, quoteUrl, extractFromQuote));
  }

  // Settle all into {status, value} so we can inspect results
  const settled = Promise.allSettled(rawPromises);

  // Phase 1: Promise.any — only accept results WITH previousClose
  const completePromises = rawPromises.map(p =>
    p.then(r => {
      if (!r.previousClose || r.previousClose <= 0) throw new Error('no previousClose');
      return r;
    })
  );

  try {
    return await Promise.any(completePromises);
  } catch (e) {
    // Phase 1 failed — no complete result available
  }

  // Phase 2: wait for all to settle, pick any valid result (price only)
  const results = await settled;
  const valid = results
    .filter(r => r.status === 'fulfilled' && r.value && r.value.price > 0)
    .map(r => r.value);

  if (valid.length === 0) return null;

  // Still prefer results with previousClose if any arrived
  const withPrevClose = valid.filter(r => r.previousClose && r.previousClose > 0);
  return withPrevClose.length > 0 ? withPrevClose[0] : valid[0];
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
 * Fetch all stock prices (IBKR positions + ACN + SGTM)
 * @param {object} portfolio
 * @param {function} onProgress - callback(loaded, total, ticker)
 * @param {boolean} forceRefresh - bypass cache
 * Returns { updated, liveCount, totalTickers, sgtmLive, failedTickers }
 */
export async function fetchStockPrices(portfolio, onProgress, forceRefresh) {
  const allTickers = portfolio.amine.ibkr.positions.map(p => p.ticker).concat(['ACN']);
  const totalTickers = allTickers.length + 1; // +1 for SGTM
  let loaded = 0;
  const prices = {};

  // ---- Load from cache ----
  const cache = loadCache();
  let tickersToFetch = [];
  let cachedSGTM = null;

  if (!forceRefresh) {
    for (const ticker of allTickers) {
      const cached = cache.stocks[ticker];
      // Only consider fully cached if we have BOTH price AND previousClose
      if (cached && cached.price > 0 && cached.previousClose && cached.previousClose > 0) {
        prices[ticker] = cached;
        loaded++;
        if (onProgress) onProgress(loaded, totalTickers, ticker + ' ✓');
      } else {
        tickersToFetch.push(ticker);
        // If we had a partial cache (price but no previousClose), keep it as fallback
        if (cached && cached.price > 0) prices[ticker] = cached;
      }
    }
    if (cache.sgtm) {
      cachedSGTM = cache.sgtm.price;
      loaded++;
      if (onProgress) onProgress(loaded, totalTickers, 'SGTM ✓');
    }
    console.log('[api] ' + (allTickers.length - tickersToFetch.length) + '/' + allTickers.length + ' from cache, ' + tickersToFetch.length + ' to fetch' + (cachedSGTM !== null ? ', SGTM cached' : ''));
  } else {
    tickersToFetch = [...allTickers];
    console.log('[api] Hard refresh — fetching all ' + totalTickers);
  }

  // ---- Fetch all missing tickers in parallel (no batching!) ----
  let cacheUpdated = false;

  if (tickersToFetch.length > 0 || cachedSGTM === null) {
    // Launch ALL tickers at once — the proxies handle rate limiting internally
    const tickerPromises = tickersToFetch.map(async (ticker) => {
      const result = await fetchStockPrice(ticker);
      if (result) {
        prices[ticker] = result;
        cache.stocks[ticker] = result;
        cacheUpdated = true;
      }
      loaded++;
      if (onProgress) onProgress(loaded, totalTickers, ticker + (result ? ' ✓' : ' ✗'));
    });

    // SGTM in parallel
    const sgtmPromise = (cachedSGTM === null)
      ? fetchSGTMPrice().then(r => {
          loaded++;
          if (onProgress) onProgress(loaded, totalTickers, 'SGTM' + (r ? ' ✓' : ' ✗'));
          return r;
        })
      : Promise.resolve(null);

    const [, sgtmPrice] = await Promise.all([Promise.all(tickerPromises), sgtmPromise]);

    if (cachedSGTM === null && sgtmPrice) {
      cachedSGTM = sgtmPrice;
      cache.sgtm = { price: sgtmPrice };
      cacheUpdated = true;
    }

    if (cacheUpdated) saveCache(cache);
  }

  // ---- Apply prices to portfolio ----
  let updated = false;

  portfolio.amine.ibkr.positions.forEach(pos => {
    if (prices[pos.ticker]) {
      const d = prices[pos.ticker];
      pos.price = d.price;
      pos.previousClose = d.previousClose;
      pos._live = true;
      updated = true;
    } else {
      pos._live = false;
    }
  });

  if (prices['ACN']) {
    const d = prices['ACN'];
    portfolio.market.acnPriceUSD = d.price;
    portfolio.market.acnPreviousClose = d.previousClose;
    portfolio.market._acnLive = true;
    updated = true;
  } else {
    portfolio.market._acnLive = false;
  }

  let sgtmLive = false;
  if (cachedSGTM) {
    portfolio.market.sgtmPriceMAD = cachedSGTM;
    portfolio.market._sgtmLive = true;
    sgtmLive = true;
    updated = true;
  } else {
    portfolio.market._sgtmLive = false;
  }

  // List failed tickers for retry
  const failedTickers = allTickers.filter(t => !prices[t]);
  if (failedTickers.length > 0) {
    console.log('[api] Failed tickers after first pass: ' + failedTickers.join(', '));
  } else {
    console.log('[api] All tickers loaded successfully!');
  }

  return {
    updated,
    liveCount: Object.keys(prices).length + (sgtmLive ? 1 : 0),
    totalTickers: allTickers.length + 1,
    sgtmLive,
    failedTickers,
  };
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
