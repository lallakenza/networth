#!/usr/bin/env node
// ============================================================
// Generate price_snapshot.js — Fetches 1Y+ historical prices
// from Yahoo Finance for all portfolio tickers + FX pairs.
// Run: node generate_snapshot.mjs
// Output: js/price_snapshot.js
// ============================================================

import { writeFileSync } from 'fs';

const TICKERS = [
  // Current IBKR positions (EUR)
  'AIR.PA', 'BN.PA', 'DG.PA', 'FGR.PA', 'MC.PA', 'OR.PA',
  'P911.DE', 'RMS.PA', 'SAN.PA', 'SAP.DE',
  // IBKR (JPY)
  '4911.T',
  // IBKR (USD)
  'IBIT', 'ETHA',
  // ESPP
  'ACN',
  // Sold 2026 (needed for YTD P&L)
  'QQQM', 'GLE.PA', 'WLN.PA', 'EDEN.PA', 'NXI.PA',
];

const FX_PAIRS = [
  { symbol: 'EURUSD=X', key: 'usd' },
  { symbol: 'EURJPY=X', key: 'jpy' },
  { symbol: 'EURMAD=X', key: 'mad' },
];

const PROXIES = [
  url => url,
  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
  url => 'https://corsproxy.io/?' + encodeURIComponent(url),
  url => 'https://api.cors.lol/?url=' + encodeURIComponent(url),
];

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function fetchTickerHistory(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`;

  const attempts = PROXIES.map(proxy =>
    fetchWithTimeout(proxy(url), 15000)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => {
        const result = d?.chart?.result?.[0];
        if (!result) throw new Error('no data');
        const timestamps = result.timestamp;
        const closes = result.indicators?.quote?.[0]?.close;
        if (!timestamps || !closes) throw new Error('no OHLC');

        const dates = timestamps.map(ts => {
          const dt = new Date(ts * 1000);
          return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        });

        // Forward-fill nulls
        const filled = [];
        let last = null;
        for (let i = 0; i < closes.length; i++) {
          if (closes[i] != null && closes[i] > 0) last = closes[i];
          filled.push(last);
        }

        // Deduplicate dates (keep last value)
        const dedupDates = [], dedupCloses = [];
        for (let i = 0; i < dates.length; i++) {
          if (i < dates.length - 1 && dates[i] === dates[i + 1]) continue;
          dedupDates.push(dates[i]);
          dedupCloses.push(filled[i] != null ? Math.round(filled[i] * 10000) / 10000 : null);
        }

        return { dates: dedupDates, closes: dedupCloses };
      })
  );

  try {
    return await Promise.any(attempts);
  } catch (e) {
    console.error(`  FAILED: ${symbol} — ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('Generating price snapshot...');
  console.log(`Tickers: ${TICKERS.length}, FX: ${FX_PAIRS.length}`);

  const snapshot = { tickers: {}, fx: {}, _snapshotDate: null };

  // Fetch all tickers (1Y range)
  console.log('\n--- Fetching ticker histories (1Y) ---');
  for (const ticker of TICKERS) {
    process.stdout.write(`  ${ticker}...`);
    const data = await fetchTickerHistory(ticker, '1y');
    if (data) {
      snapshot.tickers[ticker] = data;
      console.log(` ✓ ${data.dates[0]} → ${data.dates[data.dates.length - 1]} (${data.dates.length} days)`);
    } else {
      console.log(' ✗');
    }
  }

  // Now extend with YTD data (for dates after 1Y end)
  console.log('\n--- Extending with YTD data ---');
  for (const ticker of TICKERS) {
    process.stdout.write(`  ${ticker}...`);
    const ytd = await fetchTickerHistory(ticker, 'ytd');
    if (ytd && snapshot.tickers[ticker]) {
      const base = snapshot.tickers[ticker];
      const lastDate = base.dates[base.dates.length - 1];
      let added = 0;
      for (let i = 0; i < ytd.dates.length; i++) {
        if (ytd.dates[i] > lastDate) {
          base.dates.push(ytd.dates[i]);
          base.closes.push(ytd.closes[i]);
          added++;
        }
      }
      console.log(` +${added} days → ${base.dates[base.dates.length - 1]}`);
    } else if (ytd && !snapshot.tickers[ticker]) {
      snapshot.tickers[ticker] = ytd;
      console.log(` ✓ (YTD only) ${ytd.dates.length} days`);
    } else {
      console.log(' skip');
    }
  }

  // Fetch FX pairs
  console.log('\n--- Fetching FX histories (1Y + YTD) ---');
  for (const { symbol, key } of FX_PAIRS) {
    process.stdout.write(`  ${symbol}...`);
    const data1y = await fetchTickerHistory(symbol, '1y');
    if (data1y) {
      snapshot.fx[key] = data1y;
      console.log(` ✓ ${data1y.dates[0]} → ${data1y.dates[data1y.dates.length - 1]} (${data1y.dates.length} days)`);

      // Extend with YTD
      const ytd = await fetchTickerHistory(symbol, 'ytd');
      if (ytd) {
        const lastDate = snapshot.fx[key].dates[snapshot.fx[key].dates.length - 1];
        let added = 0;
        for (let i = 0; i < ytd.dates.length; i++) {
          if (ytd.dates[i] > lastDate) {
            snapshot.fx[key].dates.push(ytd.dates[i]);
            snapshot.fx[key].closes.push(ytd.closes[i]);
            added++;
          }
        }
        process.stdout.write(`  +${added} YTD days\n`);
      }
    } else {
      console.log(' ✗');
    }
  }

  // Set snapshot date
  let maxDate = '1900-01-01';
  for (const d of Object.values(snapshot.tickers)) {
    const last = d.dates[d.dates.length - 1];
    if (last > maxDate) maxDate = last;
  }
  snapshot._snapshotDate = maxDate;

  // Stats
  const totalPoints = Object.values(snapshot.tickers).reduce((s, d) => s + d.dates.length, 0)
    + Object.values(snapshot.fx).reduce((s, d) => s + d.dates.length, 0);
  console.log(`\n=== Snapshot: ${Object.keys(snapshot.tickers).length} tickers + ${Object.keys(snapshot.fx).length} FX, ${totalPoints} data points ===`);
  console.log(`Snapshot date: ${snapshot._snapshotDate}`);

  // Write file
  const js = `// ============================================================
// PRICE SNAPSHOT — Static historical prices (auto-generated)
// ============================================================
// Generated: ${new Date().toISOString().slice(0, 10)}
// Contains: 1Y+ daily prices for all portfolio tickers + FX rates
// Purpose: Avoids re-fetching immutable historical data from Yahoo Finance
// Update: Re-run \`node generate_snapshot.mjs\` to refresh
// Only the delta (snapshotDate → today) is fetched from the API at runtime

export const PRICE_SNAPSHOT = ${JSON.stringify(snapshot)};
`;

  writeFileSync('js/price_snapshot.js', js, 'utf-8');
  console.log(`\nWritten: js/price_snapshot.js (${(js.length / 1024).toFixed(1)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
