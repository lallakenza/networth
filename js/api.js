// ============================================================
// API LAYER — Fetch live FX rates and stock prices
// ============================================================
// Returns data only, never touches the DOM.
// Uses localStorage as daily cache to avoid redundant API calls.

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

/** Remove cache entries from previous days */
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

// Run once on module load
purgeOldCache();

/**
 * Fetch live FX rates from ExchangeRate-API
 * Returns { rates: {AED, MAD, USD, JPY}, source: string } or null on failure
 */
export async function fetchFXRates(forceRefresh) {
  // Check cache first
  if (!forceRefresh) {
    const cache = loadCache();
    if (cache.fx) {
      console.log('[cache] FX rates loaded from cache');
      return {
        rates: cache.fx.rates,
        source: 'live (' + new Date().toLocaleDateString('fr-FR') + ')',
      };
    }
  }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/EUR');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.result === 'success' && data.rates) {
      const rates = {
        EUR: 1,
        AED: data.rates.AED,
        MAD: data.rates.MAD,
        USD: data.rates.USD,
        JPY: data.rates.JPY,
      };
      // Save to cache
      const cache = loadCache();
      cache.fx = { rates };
      saveCache(cache);

      return {
        rates,
        source: 'live (' + new Date().toLocaleDateString('fr-FR') + ')',
      };
    }
  } catch (e) {
    console.warn('FX API indisponible:', e.message);
  }
  return null;
}

/**
 * Fetch a single stock price from Yahoo Finance
 */
async function fetchStockPrice(symbol) {
  // Fetch only current price + previousClose (range=1d = very light, ~1 data point)
  // Historical ref prices (ytdOpen, mtdOpen, oneMonthAgo) are stored in data.js — not re-fetched
  function extractFromYahoo(d) {
    const result = d?.chart?.result?.[0];
    const meta = result?.meta;
    const p = meta?.regularMarketPrice;
    if (!p || p <= 0) return null;
    return { price: p, previousClose: meta?.previousClose || null };
  }
  const yahooUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?range=1d&interval=1d';

  // Try proxies sequentially (reduces total requests to avoid Yahoo rate-limiting)
  // Order: most reliable first
  const proxies = [
    yahooUrl, // direct (works in some browsers without CORS)
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(yahooUrl),
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(yahooUrl),
    'https://corsproxy.io/?' + encodeURIComponent(yahooUrl),
  ];

  // Race first 2 proxies, then fallback to remaining if both fail
  const tryBatch = (urls) => urls.map(url =>
    fetch(url, { signal: AbortSignal.timeout(8000) })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => { const result = extractFromYahoo(d); if (!result) throw new Error('no data'); return result; })
  );

  try {
    return await Promise.any(tryBatch(proxies.slice(0, 2)));
  } catch(e1) {
    try {
      return await Promise.any(tryBatch(proxies.slice(2)));
    } catch(e2) {
      return null; // all sources failed
    }
  }
}

/**
 * Fetch SGTM price from Casablanca Bourse (multiple fallbacks)
 * Returns price in MAD or null
 */
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

  // Race all sources in parallel
  const attempts = [
    fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(gUrl), { signal: AbortSignal.timeout(8000) })
      .then(r => { if (!r.ok) throw new Error(); return r.text(); }).then(extractGooglePrice),
    fetch('https://corsproxy.io/?' + encodeURIComponent(gUrl), { signal: AbortSignal.timeout(8000) })
      .then(r => { if (!r.ok) throw new Error(); return r.text(); }).then(extractGooglePrice),
    fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(lUrl), { signal: AbortSignal.timeout(8000) })
      .then(r => { if (!r.ok) throw new Error(); return r.text(); }).then(extractBoursierPrice),
  ];

  try {
    return await Promise.any(attempts);
  } catch(e) {
    return null;
  }
}

/**
 * Fetch all stock prices (IBKR positions + ACN + SGTM)
 * Mutates portfolio.amine.ibkr.positions[].price, portfolio.market.acnPriceUSD, portfolio.market.sgtmPriceMAD
 * @param {object} portfolio
 * @param {function} onProgress - optional callback(loaded, total, ticker) called as each ticker completes
 * @param {boolean} forceRefresh - if true, bypass cache and re-fetch all tickers
 * Returns { updated: boolean, liveCount: number, totalTickers: number, sgtmLive: boolean }
 */
export async function fetchStockPrices(portfolio, onProgress, forceRefresh) {
  const allTickers = portfolio.amine.ibkr.positions.map(p => p.ticker).concat(['ACN']);
  const totalTickers = allTickers.length + 1; // +1 for SGTM
  let loaded = 0;
  const prices = {};

  // ---- Load from cache first ----
  const cache = loadCache();
  let tickersToFetch = [];
  let cachedSGTM = null;

  if (!forceRefresh) {
    // Restore cached stock prices
    for (const ticker of allTickers) {
      if (cache.stocks[ticker]) {
        prices[ticker] = cache.stocks[ticker];
        loaded++;
        if (onProgress) onProgress(loaded, totalTickers, ticker + ' (cache)');
      } else {
        tickersToFetch.push(ticker);
      }
    }
    // Restore cached SGTM
    if (cache.sgtm) {
      cachedSGTM = cache.sgtm.price;
      loaded++;
      if (onProgress) onProgress(loaded, totalTickers, 'SGTM (cache)');
    }
    if (tickersToFetch.length === 0 && cachedSGTM !== null) {
      console.log('[cache] All ' + totalTickers + ' tickers loaded from cache — 0 API calls');
    } else {
      console.log('[cache] ' + (allTickers.length - tickersToFetch.length) + '/' + allTickers.length + ' tickers from cache, ' + tickersToFetch.length + ' to fetch' + (cachedSGTM !== null ? ', SGTM from cache' : ', SGTM to fetch'));
    }
  } else {
    tickersToFetch = [...allTickers];
    console.log('[cache] Force refresh — fetching all ' + totalTickers + ' tickers');
  }

  // ---- Fetch remaining tickers from API ----
  const BATCH_SIZE = 4;
  const BATCH_DELAY = 600; // ms between batches
  let cacheUpdated = false;

  if (tickersToFetch.length > 0) {
    async function fetchBatched() {
      for (let i = 0; i < tickersToFetch.length; i += BATCH_SIZE) {
        const batch = tickersToFetch.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (ticker) => {
          const result = await fetchStockPrice(ticker);
          if (result) {
            prices[ticker] = result;
            // Save to cache immediately
            cache.stocks[ticker] = result;
            cacheUpdated = true;
          }
          loaded++;
          if (onProgress) onProgress(loaded, totalTickers, ticker);
        }));
        // Small delay between batches (except after last batch)
        if (i + BATCH_SIZE < tickersToFetch.length) {
          await new Promise(r => setTimeout(r, BATCH_DELAY));
        }
      }
    }

    // Fetch SGTM in parallel with Yahoo tickers (only if not cached)
    const sgtmPromise = (cachedSGTM === null)
      ? fetchSGTMPrice().then(r => { loaded++; if (onProgress) onProgress(loaded, totalTickers, 'SGTM'); return r; })
      : Promise.resolve(null); // already cached, skip

    const [, sgtmPrice] = await Promise.all([fetchBatched(), sgtmPromise]);

    // Store SGTM in cache if fetched
    if (cachedSGTM === null && sgtmPrice) {
      cachedSGTM = sgtmPrice;
      cache.sgtm = { price: sgtmPrice };
      cacheUpdated = true;
    }

    // Retry pass for failed tickers (after a short delay)
    const failedTickers = tickersToFetch.filter(t => !prices[t]);
    if (failedTickers.length > 0) {
      await new Promise(r => setTimeout(r, 2000));
      await Promise.all(failedTickers.map(async (ticker) => {
        const result = await fetchStockPrice(ticker);
        if (result) {
          prices[ticker] = result;
          cache.stocks[ticker] = result;
          cacheUpdated = true;
        }
      }));
    }

    // Persist cache if anything changed
    if (cacheUpdated) saveCache(cache);
  }

  let updated = false;

  // Update IBKR positions — only price + previousClose from API
  // ytdOpen/mtdOpen/oneMonthAgo come from data.js (stored once)
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

  // Update ACN (ESPP) — only price + previousClose
  if (prices['ACN']) {
    const d = prices['ACN'];
    portfolio.market.acnPriceUSD = d.price;
    portfolio.market.acnPreviousClose = d.previousClose;
    portfolio.market._acnLive = true;
    updated = true;
  } else {
    portfolio.market._acnLive = false;
  }

  // Update SGTM
  let sgtmLive = false;
  if (cachedSGTM) {
    portfolio.market.sgtmPriceMAD = cachedSGTM;
    portfolio.market._sgtmLive = true;
    sgtmLive = true;
    updated = true;
  } else {
    portfolio.market._sgtmLive = false;
  }

  return {
    updated,
    liveCount: Object.keys(prices).length + (sgtmLive ? 1 : 0),
    totalTickers: allTickers.length + 1,
    sgtmLive,
  };
}
