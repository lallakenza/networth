// ============================================================
// API LAYER — Fetch live FX rates and stock prices
// ============================================================
// Returns data only, never touches the DOM.

/**
 * Fetch live FX rates from ExchangeRate-API
 * Returns { rates: {AED, MAD, USD, JPY}, source: string } or null on failure
 */
export async function fetchFXRates() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/EUR');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.result === 'success' && data.rates) {
      return {
        rates: {
          EUR: 1,
          AED: data.rates.AED,
          MAD: data.rates.MAD,
          USD: data.rates.USD,
          JPY: data.rates.JPY,
        },
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
  // Fetch YTD daily data from Yahoo Finance — gives us daily/MTD/YTD/1M reference prices
  function extractFromYahoo(d) {
    const result = d?.chart?.result?.[0];
    const meta = result?.meta;
    const p = meta?.regularMarketPrice;
    if (!p || p <= 0) return null;
    // previousClose = actual yesterday's close (for daily P&L)
    // chartPreviousClose = close before chart range start (Dec 31 for range=ytd) — NOT yesterday!
    const dailyPrevClose = meta?.previousClose || null;
    // Extract historical closes for period P&L
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const refPrices = { previousClose: dailyPrevClose };
    if (timestamps.length > 0 && closes.length > 0) {
      const now = new Date();
      const ytdStart = new Date(now.getFullYear(), 0, 1).getTime() / 1000;
      const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
      const oneMonthAgo = now.getTime() / 1000 - 30 * 86400;
      // Find closest valid close for each reference date
      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i];
        if (c === null || c === undefined) continue;
        const t = timestamps[i];
        if (!refPrices.ytdOpen && t >= ytdStart) refPrices.ytdOpen = c;
        if (!refPrices.mtdOpen && t >= mtdStart) refPrices.mtdOpen = c;
        if (!refPrices.oneMonthAgo && t >= oneMonthAgo) refPrices.oneMonthAgo = c;
      }
      // Fallback: if no previousClose from meta, use last close in timeseries
      if (!refPrices.previousClose) {
        for (let i = closes.length - 1; i >= 0; i--) {
          if (closes[i] !== null && closes[i] !== undefined) {
            refPrices.previousClose = closes[i];
            break;
          }
        }
      }
    }
    return { price: p, ...refPrices };
  }
  const yahooUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?range=ytd&interval=1d';

  // Race all sources in parallel — first valid response wins
  const sources = [
    yahooUrl, // direct (may work without CORS in some browsers)
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(yahooUrl),
    'https://corsproxy.io/?' + encodeURIComponent(yahooUrl),
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(yahooUrl),
  ];

  // Each source: fetch → parse → return result or throw
  const attempts = sources.map(url =>
    fetch(url, { signal: AbortSignal.timeout(8000) })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => { const result = extractFromYahoo(d); if (!result) throw new Error('no data'); return result; })
  );

  try {
    return await Promise.any(attempts);
  } catch(e) {
    return null; // all sources failed
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
 * Returns { updated: boolean, liveCount: number, totalTickers: number, sgtmLive: boolean }
 */
export async function fetchStockPrices(portfolio, onProgress) {
  const tickers = portfolio.amine.ibkr.positions.map(p => p.ticker).concat(['ACN']);
  const totalTickers = tickers.length + 1; // +1 for SGTM
  let loaded = 0;
  const prices = {};

  // Fetch IBKR + ACN in parallel with SGTM
  const [, sgtmPrice] = await Promise.all([
    Promise.all(tickers.map(async (ticker) => {
      const result = await fetchStockPrice(ticker);
      if (result) prices[ticker] = result;
      loaded++;
      if (onProgress) onProgress(loaded, totalTickers, ticker);
    })),
    fetchSGTMPrice().then(r => { loaded++; if (onProgress) onProgress(loaded, totalTickers, 'SGTM'); return r; }),
  ]);

  let updated = false;

  // Update IBKR positions — mark live/static
  portfolio.amine.ibkr.positions.forEach(pos => {
    if (prices[pos.ticker]) {
      const d = prices[pos.ticker];
      pos.price = d.price;
      pos.previousClose = d.previousClose;
      pos.ytdOpen = d.ytdOpen;
      pos.mtdOpen = d.mtdOpen;
      pos.oneMonthAgo = d.oneMonthAgo;
      pos._live = true;
      updated = true;
    } else {
      pos._live = false;
    }
  });

  // Update ACN (ESPP)
  if (prices['ACN']) {
    const d = prices['ACN'];
    portfolio.market.acnPriceUSD = d.price;
    portfolio.market.acnPreviousClose = d.previousClose;
    portfolio.market.acnYtdOpen = d.ytdOpen;
    portfolio.market.acnMtdOpen = d.mtdOpen;
    portfolio.market.acnOneMonthAgo = d.oneMonthAgo;
    portfolio.market._acnLive = true;
    updated = true;
  } else {
    portfolio.market._acnLive = false;
  }

  // Update SGTM
  let sgtmLive = false;
  if (sgtmPrice) {
    portfolio.market.sgtmPriceMAD = sgtmPrice;
    portfolio.market._sgtmLive = true;
    sgtmLive = true;
    updated = true;
  } else {
    portfolio.market._sgtmLive = false;
  }

  return {
    updated,
    liveCount: Object.keys(prices).length + (sgtmLive ? 1 : 0),
    totalTickers: tickers.length + 1,
    sgtmLive,
  };
}
