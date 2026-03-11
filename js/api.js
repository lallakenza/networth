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
  // Try Yahoo Finance chart API directly
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?range=1d&interval=1d');
    if (r.ok) {
      const d = await r.json();
      const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (p && p > 0) return p;
    }
  } catch(e) {}
  // Fallback: CORS proxy
  try {
    const url = encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?range=1d&interval=1d');
    const r = await fetch('https://api.allorigins.win/raw?url=' + url);
    if (r.ok) {
      const d = await r.json();
      const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (p && p > 0) return p;
    }
  } catch(e) {}
  return null;
}

/**
 * Fetch SGTM price from Casablanca Bourse (multiple fallbacks)
 * Returns price in MAD or null
 */
async function fetchSGTMPrice() {
  // Attempt 1: Google Finance page via CORS proxy (scrape data-last-price)
  try {
    const gUrl = encodeURIComponent('https://www.google.com/finance/quote/GTM:CAS');
    const r = await fetch('https://api.allorigins.win/raw?url=' + gUrl);
    if (r.ok) {
      const html = await r.text();
      const m = html.match(/data-last-price="([\d.]+)"/);
      if (m && parseFloat(m[1]) > 0) return parseFloat(m[1]);
    }
  } catch(e) {}

  // Attempt 2: leboursier.ma page scraping via CORS proxy
  try {
    const lUrl = encodeURIComponent('https://www.leboursier.ma/cours/SGTM');
    const r = await fetch('https://api.allorigins.win/raw?url=' + lUrl);
    if (r.ok) {
      const html = await r.text();
      // Look for price patterns like "700,00" or "cours" fields
      const m = html.match(/cours[^>]*>[\s]*([\d\s]+[.,]\d{2})/i) ||
                html.match(/"price"[:\s]*([\d.]+)/) ||
                html.match(/"lastPrice"[:\s]*([\d.]+)/);
      if (m) {
        const price = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
        if (price > 0) return price;
      }
    }
  } catch(e) {}

  // Attempt 3: corsproxy.io as alternative CORS proxy
  try {
    const r = await fetch('https://corsproxy.io/?' + encodeURIComponent('https://www.google.com/finance/quote/GTM:CAS'));
    if (r.ok) {
      const html = await r.text();
      const m = html.match(/data-last-price="([\d.]+)"/);
      if (m && parseFloat(m[1]) > 0) return parseFloat(m[1]);
    }
  } catch(e) {}

  return null;
}

/**
 * Fetch all stock prices (IBKR positions + ACN + SGTM)
 * Mutates portfolio.amine.ibkr.positions[].price, portfolio.market.acnPriceUSD, portfolio.market.sgtmPriceMAD
 * Returns { updated: boolean, liveCount: number, totalTickers: number, sgtmLive: boolean }
 */
export async function fetchStockPrices(portfolio) {
  const tickers = portfolio.amine.ibkr.positions.map(p => p.ticker).concat(['ACN']);
  const prices = {};

  // Fetch IBKR + ACN in parallel with SGTM
  const [, sgtmPrice] = await Promise.all([
    Promise.all(tickers.map(async (ticker) => {
      const price = await fetchStockPrice(ticker);
      if (price) prices[ticker] = price;
    })),
    fetchSGTMPrice(),
  ]);

  let updated = false;

  // Update IBKR positions
  portfolio.amine.ibkr.positions.forEach(pos => {
    if (prices[pos.ticker]) {
      pos.price = prices[pos.ticker];
      updated = true;
    }
  });

  // Update ACN (ESPP)
  if (prices['ACN']) {
    portfolio.market.acnPriceUSD = prices['ACN'];
    updated = true;
  }

  // Update SGTM
  let sgtmLive = false;
  if (sgtmPrice) {
    portfolio.market.sgtmPriceMAD = sgtmPrice;
    sgtmLive = true;
    updated = true;
  }

  return {
    updated,
    liveCount: Object.keys(prices).length + (sgtmLive ? 1 : 0),
    totalTickers: tickers.length + 1,
    sgtmLive,
  };
}
