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
 * Fetch all stock prices (IBKR positions + ACN)
 * Mutates portfolio.amine.ibkr.positions[].price and portfolio.market.acnPriceUSD
 * Returns { updated: boolean, liveCount: number, totalTickers: number }
 */
export async function fetchStockPrices(portfolio) {
  const tickers = portfolio.amine.ibkr.positions.map(p => p.ticker).concat(['ACN']);
  const prices = {};

  await Promise.all(tickers.map(async (ticker) => {
    const price = await fetchStockPrice(ticker);
    if (price) prices[ticker] = price;
  }));

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

  return {
    updated,
    liveCount: Object.keys(prices).length,
    totalTickers: tickers.length,
  };
}
