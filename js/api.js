// ============================================================
// API LAYER — Fetch live FX rates and stock prices
// ============================================================
// See ARCHITECTURE.md for full documentation (CORS proxy
// strategy, cache TTL, fallback to static prices).
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
// Aucune API "propre" n'existe : Yahoo Finance ne couvre pas la Bourse de
// Casablanca (404 sur SGTM.CA/BV/MA), TradingView utilise un WebSocket
// authentifié, et le SPA de casablanca-bourse.com nécessite une session.
//
// Stratégie en 2 temps (v330+) :
//   1. Source primaire : `data/sgtm_live.json` — scraped horairement via
//      GitHub Action (.github/workflows/sgtm-scrape.yml) qui utilise
//      Playwright côté CI pour passer Cloudflare + hydrater idbourse.com.
//      Fetch same-origin → zéro CORS, zéro proxy tiers.
//   2. Fallback runtime : scraping direct depuis le navigateur via proxies
//      CORS (Google Finance + leboursier.ma + investing.com) — conservé pour
//      le cas où le JSON devient obsolète (> 24h) et qu'une séance a eu lieu
//      depuis le dernier commit du CI.

const SGTM_LIVE_JSON_URL = './data/sgtm_live.json';
const SGTM_LIVE_MAX_AGE_MS = 24 * 3600 * 1000; // au-delà de 24h, le JSON est "stale" mais reste utilisable en dernier recours

/**
 * Tente de lire `data/sgtm_live.json` écrit par le GitHub Action.
 * Retourne TOUJOURS le snapshot s'il est lisible (même > 24h), avec un flag `stale`.
 * Ainsi, même si le CI n'a pas tourné depuis un week-end prolongé, on garde le
 * "dernier relevé connu" comme fallback ultime avant de retomber sur data.js.
 */
async function fetchSGTMFromRepo() {
  try {
    const bust = Math.floor(Date.now() / 3600000); // cache-bust horaire (1 req/h max)
    const res = await fetchWithTimeout(`${SGTM_LIVE_JSON_URL}?h=${bust}`, 5000);
    if (!res.ok) return null;
    const snap = await res.json();
    if (!snap || typeof snap.priceMAD !== 'number' || snap.priceMAD <= 0) return null;
    const ts = Date.parse(snap.lastUpdate);
    if (!isFinite(ts)) return null;
    const ageMs = Date.now() - ts;
    const stale = ageMs > SGTM_LIVE_MAX_AGE_MS;
    const sourcePrefix = stale ? 'repo-stale:' : 'repo:';
    console.log('[api] SGTM sgtm_live.json: ' + snap.priceMAD + ' MAD (source: ' + snap.source
      + ', age: ' + Math.round(ageMs / 60000) + 'min' + (stale ? ', STALE' : '') + ')');
    return {
      price: snap.priceMAD,
      source: sourcePrefix + (snap.source || 'unknown'),
      lastUpdate: snap.lastUpdate, // ISO string (UTC) exposée à render.js pour badge tooltip
      ageMs,
      stale,
    };
  } catch (e) {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PRIX D'UNE ACTION MAROCAINE À UNE DATE DONNÉE (v369)
// ════════════════════════════════════════════════════════════════════════════
// Yahoo ne couvre AUCUNE action de la Bourse de Casablanca. La source de vérité est
// l'historique quotidien auto-alimenté du repo : `data/<ticker>_history.json` (closes de
// facto, maintenu par scripts/scrape_<ticker>.py — upsert quotidien + `--backfill` git log).
// Pendant du script Python scripts/moroccan_price_at.py, mêmes règles.
//
// Convention « prix à la date D » = dernier close CONNU <= D (forward-fill) : si D tombe un
// week-end / férié BVC / jour sans relevé, on renvoie le close du dernier jour de bourse <= D.
// C'est la convention standard pour un prix de référence (mtdOpen, oneMonthAgo…) et ça évite
// d'inventer un prix un jour non coté.

const _moroccanHistoryCache = {}; // ticker(lower) -> { series, _ts }

/**
 * Cœur PUR (sync) : sélectionne le prix à une date dans une série déjà chargée.
 * @param {Array<{date:string, priceMAD:number, source?:string}>} series  triée ou non
 * @param {string} date  'YYYY-MM-DD'
 * @param {{exact?:boolean}} [opts]  exact=true → uniquement un close ce jour précis, sinon forward-fill
 * @returns {{priceMAD:number, dateUsed:string, source:string, forwardFilled:boolean}|null}
 */
export function pickMoroccanPriceAt(series, date, opts = {}) {
  if (!Array.isArray(series) || series.length === 0) return null;
  const clean = series
    .filter(e => e && e.date && typeof e.priceMAD === 'number')
    .sort((a, b) => a.date.localeCompare(b.date));
  if (clean.length === 0) return null;

  if (opts.exact) {
    const hit = clean.find(e => e.date === date);
    return hit ? { priceMAD: hit.priceMAD, dateUsed: hit.date, source: hit.source || '', forwardFilled: false } : null;
  }
  // forward-fill : dernière entrée dont la date <= date cible
  let chosen = null;
  for (const e of clean) {
    if (e.date <= date) chosen = e; else break;
  }
  if (!chosen) return null; // date antérieure à tout l'historique — on ne fabrique rien
  return { priceMAD: chosen.priceMAD, dateUsed: chosen.date, source: chosen.source || '', forwardFilled: chosen.date !== date };
}

// ── Accumulation d'historique en localStorage (v370, « 0 infra ») ────────────────────────────
// Sans GitHub Actions, plus personne ne committe le close quotidien. À la place, à chaque visite
// on enregistre le close du jour (relevé TradingView) dans le localStorage du navigateur, puis on
// FUSIONNE avec la base committée data/<ticker>_history.json. Le dernier relevé du jour écrase les
// précédents → close de facto (comme le scraper). Par-navigateur (best-effort), non partagé.
const MOROCCAN_HISTORY_LS_PREFIX = 'nw_moroccan_history_';
const MOROCCAN_HISTORY_MAX = 800; // ~3 ans de jours ouvrés — borne anti-gonflement du localStorage

/** Lit la série accumulée en localStorage pour `ticker` (array {date, priceMAD, source}). */
export function getLocalMoroccanHistory(ticker) {
  try {
    const raw = localStorage.getItem(MOROCCAN_HISTORY_LS_PREFIX + String(ticker).toLowerCase());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/** Upsert du close du jour dans le localStorage (remplace l'entrée du jour si déjà présente). */
export function recordMoroccanDailyClose(ticker, priceMAD, source) {
  try {
    const px = Number(priceMAD);
    if (!(px > 0) || typeof localStorage === 'undefined') return;
    const key = MOROCCAN_HISTORY_LS_PREFIX + String(ticker).toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const arr = getLocalMoroccanHistory(ticker);
    const entry = { date: today, priceMAD: Math.round(px * 100) / 100, source: source || 'tradingview' };
    const i = arr.findIndex(e => e && e.date === today);
    if (i >= 0) arr[i] = entry; else arr.push(entry);
    arr.sort((a, b) => a.date.localeCompare(b.date));
    if (arr.length > MOROCCAN_HISTORY_MAX) arr.splice(0, arr.length - MOROCCAN_HISTORY_MAX);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    // localStorage plein / désactivé (navigation privée) → non-bloquant
  }
}

/** Fusionne série committée (fichier) + accumulation localStorage. Le localStorage gagne à date égale. */
export function mergeMoroccanHistory(fileSeries, localSeries) {
  const byDate = {};
  for (const e of (fileSeries || [])) if (e && e.date && typeof e.priceMAD === 'number') byDate[e.date] = e;
  for (const e of (localSeries || [])) if (e && e.date && typeof e.priceMAD === 'number') byDate[e.date] = e;
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Prix d'une action marocaine `ticker` à la date `date` (historique committé ∪ localStorage).
 * @param {string} ticker  ex. 'SGTM' (générique : lit data/<ticker>_history.json)
 * @param {string} date    'YYYY-MM-DD'
 * @param {{exact?:boolean}} [opts]
 * @returns {Promise<{ticker:string, dateRequested:string, dateUsed:string, priceMAD:number, currency:string, source:string, forwardFilled:boolean}|null>}
 */
export async function getMoroccanPriceAt(ticker, date, opts = {}) {
  // v372 — passe par le même chargement fusionné (fichier ∪ localStorage) que le provider Casablanca.
  const { series, currency } = await loadMergedMoroccanSeries(ticker);
  const hit = pickMoroccanPriceAt(series, date, opts);
  if (!hit) return null;
  return {
    ticker: String(ticker).toUpperCase(),
    dateRequested: date,
    dateUsed: hit.dateUsed,
    priceMAD: hit.priceMAD,
    currency: currency || 'MAD',
    source: hit.source,
    forwardFilled: hit.forwardFilled,
  };
}

// ── TradingView scanner : API JSON DIRECTE pour la Bourse de Casablanca (v370) ──────────────
// GET scanner.tradingview.com/symbol?symbol=CSEMA:<ticker>&fields=... → JSON plat
// { close, currency, open, change, volume }. CORS renvoie l'origine appelante (donc appelable
// DIRECTEMENT depuis le navigateur), aucune auth, aucun Cloudflare, cours différés 15 min
// (standard BVC). Couvre TOUTE la cote (76 valeurs) via le préfixe CSEMA:.
// → Permet de se passer de GitHub Actions pour le prix LIVE : le navigateur fetch en direct.
// Trouvé en balayant 20+ sites (investing/marketscreener = Cloudflare 403 ; Yahoo ne couvre
// pas la BVC ; idbourse/BVC = clé/endpoints server-side) — seule API BVC propre + CORS-friendly.
const TV_SYMBOL_URL = 'https://scanner.tradingview.com/symbol';

/**
 * Prix live d'une action de la Bourse de Casablanca via TradingView (direct, CORS, sans proxy).
 * @param {string} bvcTicker  code BVC (ex 'GTM' pour SGTM, 'ATW', 'IAM', 'BCP'…)
 * @returns {Promise<{price:number, currency:string, open:?number, change:?number, source:'tradingview'}|null>}
 */
async function fetchMoroccanStockFromTradingView(bvcTicker) {
  try {
    const sym = encodeURIComponent('CSEMA:' + bvcTicker);
    const url = `${TV_SYMBOL_URL}?symbol=${sym}&fields=close,currency,open,change,volume`;
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) return null;
    const d = await res.json();
    const price = d && Number(d.close);
    if (!isFinite(price) || price <= 0) return null;
    return {
      price,
      currency: d.currency || 'MAD',
      open: (d.open != null ? Number(d.open) : null),
      change: (d.change != null ? Number(d.change) : null),
      source: 'tradingview',
    };
  } catch (e) {
    return null;
  }
}

// Retourne { price, source, ageMs? } ou null. Ordre de priorité :
//   1. 'tradingview'     — API JSON directe (CORS), aucun GitHub Actions requis → badge "live ✓"
//   2. 'repo:...'        — JSON frais < 24h (CI a tourné récemment) → badge "live ✓"
//   3. 'google'/'leboursier'/'investing' — scraping runtime via proxy CORS → "live (scraping)"
//   4. 'repo-stale:...'  — JSON > 24h (week-end prolongé, CI down) → "dernier relevé (Xh)"
//   (fallback final = valeur hardcodée data.js, géré côté appelant avec source=null → "statique")
async function fetchSGTMPrice() {
  // On lance la lecture du JSON repo en parallèle dès le départ pour l'utiliser en fallback
  // si TradingView est indisponible (bloqué réseau, endpoint modifié…).
  const repoPromise = fetchSGTMFromRepo();

  // Tentative 1 (v370) : TradingView en DIRECT — SGTM (broker) = 'GTM' côté BVC/TradingView.
  const fromTV = await fetchMoroccanStockFromTradingView('GTM');
  if (fromTV) {
    console.log('[api] SGTM TradingView (direct, CORS): ' + fromTV.price + ' MAD');
    // Accumulation « 0 infra » : on enregistre le close du jour en localStorage (fusionné avec
    // la base committée pour le graphique + getMoroccanPriceAt). Remplace le rôle du GitHub Action.
    recordMoroccanDailyClose('sgtm', fromTV.price, 'tradingview');
    return { price: fromTV.price, source: 'tradingview' };
  }

  // Tentative 2 : JSON frais < 24h (GitHub Action — fallback si TradingView KO)
  const fromRepo = await repoPromise;
  if (fromRepo && !fromRepo.stale) {
    return { price: fromRepo.price, source: fromRepo.source, lastUpdate: fromRepo.lastUpdate, ageMs: fromRepo.ageMs };
  }

  // Tentative 2 : scraping runtime via proxies CORS
  const gUrl = 'https://www.google.com/finance/quote/GTM:CAS';
  const lUrl = 'https://www.leboursier.ma/cours/SGTM';
  const iUrl = 'https://fr.investing.com/equities/ste-generale-des-travaux-du-maroc';

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

  // investing.com — page HTML FR (ex: "Le cours de l'action ... aujourd'hui est de 826,00")
  // Plusieurs sélecteurs possibles : data-test="instrument-price-last" (SPA live) et
  // le snippet texte "aujourd'hui est de X,XX" (rendu SSR, plus robuste au changement
  // du front-end). La règle MIN_PRICE/MAX_PRICE évite les faux positifs (logos, IDs).
  function extractInvestingPrice(html) {
    const MIN_PRICE = 300, MAX_PRICE = 2000; // fourchette SGTM historique (461–989 sur 52s)
    // Priorité 1 : attribut data-test (SPA)
    let m = html.match(/data-test="instrument-price-last"[^>]*>([^<]+)</i);
    if (m) {
      const p = parseFloat(m[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
      if (p >= MIN_PRICE && p <= MAX_PRICE) return p;
    }
    // Priorité 2 : snippet FR "aujourd'hui est de 826,00"
    m = html.match(/aujourd['\u2019]hui est de[\s]*([\d\s.,]+)/i);
    if (m) {
      const p = parseFloat(m[1].trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
      if (p >= MIN_PRICE && p <= MAX_PRICE) return p;
    }
    throw new Error('no price');
  }

  // Try all proxies for all three sources — tag chaque promesse avec sa source
  const attempts = [];
  for (const proxy of PROXIES.slice(1)) { // skip direct (HTML pages always need proxy)
    attempts.push(
      fetchWithTimeout(proxy(gUrl), 10000)
        .then(r => { if (!r.ok) throw new Error(); return r.text(); })
        .then(extractGooglePrice)
        .then(price => ({ price, source: 'google' }))
    );
    attempts.push(
      fetchWithTimeout(proxy(lUrl), 10000)
        .then(r => { if (!r.ok) throw new Error(); return r.text(); })
        .then(extractBoursierPrice)
        .then(price => ({ price, source: 'leboursier' }))
    );
    attempts.push(
      fetchWithTimeout(proxy(iUrl), 10000)
        .then(r => { if (!r.ok) throw new Error(); return r.text(); })
        .then(extractInvestingPrice)
        .then(price => ({ price, source: 'investing' }))
    );
  }

  try {
    return await Promise.any(attempts);
  } catch (e) {
    // Tentative 3 : fallback ultime = JSON stale (> 24h) s'il existe
    // Mieux vaut afficher "dernier relevé connu (il y a Xh)" que retomber sur la
    // valeur hardcodée de data.js qui n'a plus aucune garantie d'être à jour.
    if (fromRepo && fromRepo.stale) {
      console.log('[api] SGTM : scraping échoué, fallback sur dernier relevé stale ('
        + Math.round(fromRepo.ageMs / 3600000) + 'h)');
      return { price: fromRepo.price, source: fromRepo.source, lastUpdate: fromRepo.lastUpdate, ageMs: fromRepo.ageMs };
    }
    return null;
  }
}

// ============================================================
// MAIN — Fetch all stock prices with cache + aggressive retry
// ============================================================

// ══════════════════════════════════════════════════════════════════════════════════════════
// COUCHE DE DONNÉES HARMONISÉE (v372) — une seule porte d'entrée par action, dispatch par marché
// ══════════════════════════════════════════════════════════════════════════════════════════
// getStockQuote(stock) / getStockHistory(stock, range) sont les SEULES primitives de récupération
// par action du site. Elles résolvent le MARCHÉ à partir des métadonnées de l'action puis délèguent
// au provider approprié. Les fonctions source-spécifiques (fetchStockPrice=Yahoo,
// fetchTickerHistory=Yahoo, fetchSGTMPrice/fetchMoroccanStockFromTradingView=Casablanca) deviennent
// des IMPLÉMENTATIONS DE PROVIDER — appelées uniquement d'ici, jamais en direct ailleurs.
//
// Un « stock » = un objet {ticker, currency?, geo?, broker?, market?} (une position data.js convient)
// ou une simple chaîne ticker. Le marché est déduit ; on peut le forcer via un champ `market`.

// Mapping ticker broker → code BVC/TradingView quand ils diffèrent (SGTM broker = GTM à la BVC).
const BVC_CODE = { SGTM: 'GTM' };
const SGTM_STOCK = { ticker: 'SGTM', broker: 'Attijari', geo: 'morocco', currency: 'MAD' };

/** Déduit le marché/provider d'une action. Signaux : market explicite > broker Attijari / geo Maroc > ticker SGTM. */
export function resolveMarket(stock) {
  const s = typeof stock === 'string' ? { ticker: stock } : (stock || {});
  if (s.market) return s.market;
  if (s.broker === 'Attijari' || s.geo === 'morocco' || s.geo === 'maroc' || s.geo === 'casablanca') return 'casablanca';
  if (s.ticker === 'SGTM') return 'casablanca';
  return 'yahoo';
}

// ── Provider Casablanca (Bourse de Casablanca — TradingView) ────────────────────────────────
// Quote : pour SGTM on garde la chaîne complète (TradingView → repo JSON → scraping → stale) ;
// pour tout autre ticker BVC, TradingView scanner uniquement. Historique : fichier committé
// data/<ticker>_history.json ∪ accumulation localStorage (fusion via mergeMoroccanHistory).
async function loadMergedMoroccanSeries(ticker) {
  const key = String(ticker).toLowerCase();
  let cached = _moroccanHistoryCache[key];
  if (!cached || (Date.now() - cached._ts) > 3600 * 1000) {
    try {
      const bust = Math.floor(Date.now() / 3600000);
      const res = await fetchWithTimeout(`./data/${key}_history.json?h=${bust}`, 5000);
      const doc = res.ok ? await res.json() : {};
      cached = { series: Array.isArray(doc.series) ? doc.series : [], currency: doc.currency || 'MAD', _ts: Date.now() };
    } catch (e) {
      cached = { series: [], currency: 'MAD', _ts: Date.now() };
    }
    _moroccanHistoryCache[key] = cached;
  }
  return { series: mergeMoroccanHistory(cached.series, getLocalMoroccanHistory(key)), currency: cached.currency || 'MAD' };
}

const CasablancaProvider = {
  async quote(stock) {
    const r = (stock.ticker === 'SGTM')
      ? await fetchSGTMPrice()                                              // chaîne complète (fallbacks SGTM)
      : await fetchMoroccanStockFromTradingView(BVC_CODE[stock.ticker] || stock.ticker); // autres BVC : TradingView seul
    if (!r || !(r.price > 0)) return null;
    return { price: r.price, previousClose: null, currency: 'MAD', source: r.source, market: 'casablanca', lastUpdate: r.lastUpdate || null };
  },
  async history(stock) {
    const { series } = await loadMergedMoroccanSeries(stock.ticker);
    return { market: 'casablanca', dates: series.map(e => e.date), closes: series.map(e => e.priceMAD), series };
  },
};

// ── Provider Yahoo (US / Europe / Japon — Yahoo Finance) ────────────────────────────────────
const YahooProvider = {
  async quote(stock) {
    const r = await fetchStockPrice(stock.ticker);                          // v8/v6 Yahoo, race proxies
    if (!r) return null;
    return { price: r.price, previousClose: r.previousClose, currency: stock.currency || null, source: 'yahoo', market: 'yahoo' };
  },
  async history(stock, range) {
    const r = await fetchTickerHistory(stock.ticker, range || 'ytd');       // {dates,closes} | null
    if (!r) return null;
    return { market: 'yahoo', dates: r.dates, closes: r.closes, series: r.dates.map((d, i) => ({ date: d, priceMAD: r.closes[i], close: r.closes[i] })) };
  },
};

const PROVIDERS = { yahoo: YahooProvider, casablanca: CasablancaProvider };

/**
 * Quote unifiée d'une action, quel que soit le marché.
 * @returns {Promise<{price:number, previousClose:number|null, currency:string|null, source:string, market:string, lastUpdate?:string}|null>}
 */
export async function getStockQuote(stock) {
  const s = typeof stock === 'string' ? { ticker: stock } : (stock || {});
  return PROVIDERS[resolveMarket(s)].quote(s);
}

/**
 * Historique unifié d'une action (séries quotidiennes), quel que soit le marché.
 * @returns {Promise<{market:string, dates:string[], closes:number[], series:Array}|null>}
 */
export async function getStockHistory(stock, range) {
  const s = typeof stock === 'string' ? { ticker: stock } : (stock || {});
  return PROVIDERS[resolveMarket(s)].history(s, range);
}

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
  let sgtmStale = false; // v347 — force le re-fetch SGTM si le cache dépasse le TTL
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
      portfolio.market._sgtmSource = cache.sgtm.source || 'cache';
      portfolio.market._sgtmLastUpdate = cache.sgtm.lastUpdate || null;
      loaded++;
      if (onProgress) onProgress(loaded, totalTickers, 'SGTM ✓');
      // v347 — Re-fetch SGTM si le cache dépasse le TTL (le scraper GitHub commit chaque heure).
      // Avant : le commentaire « re-fetch if stale » n'était suivi d'aucun code → prix du matin
      // figé toute la journée avec badge « live ✓ ». On applique le cache pour l'affichage instantané
      // puis on déclenche un re-fetch en tâche de fond si périmé.
      sgtmStale = !cache.sgtm._ts || (now - cache.sgtm._ts) > CACHE_TTL_MS;
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
  if (!cachedSGTM) { portfolio.market._sgtmLive = false; portfolio.market._sgtmSource = null; portfolio.market._sgtmLastUpdate = null; }

  // ---- Fetch all missing tickers in parallel (no batching!) ----
  // Each ticker applies immediately and triggers a progressive UI refresh
  let cacheUpdated = false;

  if (tickersToFetch.length > 0 || cachedSGTM === null || sgtmStale) { // v347 — sgtmStale déclenche le re-fetch même si un autre ticker n'est pas à re-fetch
    const tickerPromises = tickersToFetch.map(async (ticker) => {
      const result = await getStockQuote({ ticker });
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

    // SGTM in parallel — v347 : re-fetch aussi si le cache est périmé (sgtmStale), pas seulement si absent
    const sgtmPromise = (cachedSGTM === null || sgtmStale)
      ? getStockQuote(SGTM_STOCK).then(r => {
          if (cachedSGTM === null) loaded++; // ne pas double-compter si déjà compté depuis le cache stale
          if (onProgress) onProgress(loaded, totalTickers, 'SGTM' + (r ? ' ✓' : ' ✗'));
          if (r && r.price) {
            cachedSGTM = r.price;
            portfolio.market.sgtmPriceMAD = r.price;
            portfolio.market._sgtmLive = true;
            portfolio.market._sgtmSource = r.source || 'unknown';
            portfolio.market._sgtmLastUpdate = r.lastUpdate || null; // ISO UTC, null si scraping runtime (source=google/leboursier/investing)
            cache.sgtm = { price: r.price, source: r.source, lastUpdate: r.lastUpdate || null, _ts: Date.now() };
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
    sgtmSource: portfolio.market._sgtmSource || null,
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
    const result = await getStockQuote({ ticker });
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
      const result = await getStockQuote({ ticker });
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

// ============================================================
// HISTORICAL PRICES — YTD daily OHLC for portfolio evolution chart
// ============================================================
// Fetches Yahoo Finance chart data (range=ytd, interval=1d) for
// each ticker. Returns a map: { ticker: { dates: [...], closes: [...] } }
// Also fetches FX historical rates (EURUSD=X, EURJPY=X) for conversion.
//
// IMPORTANT: Call this ONLY after current stock prices are loaded,
// so we don't overload the API with too many parallel requests.
//
// Cache key: separate from daily price cache, stored as 'nw_hist_YYYY-MM-DD'
// TTL: 1 hour (historical data doesn't change during the day)

const HIST_CACHE_PREFIX = 'nw_hist_';
const HIST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function histCacheKey() {
  const d = new Date();
  return HIST_CACHE_PREFIX + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function loadHistCache() {
  try {
    const raw = localStorage.getItem(histCacheKey());
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (cache._ts && (Date.now() - cache._ts) < HIST_CACHE_TTL_MS) return cache;
    return null;
  } catch (e) { return null; }
}

function saveHistCache(data) {
  try {
    data._ts = Date.now();
    localStorage.setItem(histCacheKey(), JSON.stringify(data));
    const today = histCacheKey();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(HIST_CACHE_PREFIX) && key !== today) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) { /* quota exceeded */ }
}

// ════════════════════════════════════════════════════════════════════
//  v376 — Store historique PERSISTANT & AUTO-ACCUMULANT (localStorage)
//  localStorage EST notre "base de données" (dashboard perso mono-utilisateur,
//  aucun enjeu de sécurité). On y garde l'historique COMPLET fusionné = snapshot
//  statique bundlé + TOUS les deltas API déjà récupérés. Bénéfices :
//   1. Le graphe se rend INSTANTANÉMENT depuis le store (zéro attente réseau).
//   2. L'API n'est sollicitée que pour le delta « depuis la dernière visite ».
//   3. Ce delta est re-persisté à chaque visite → le store grandit ; la 1re passe
//      lente ne se paie qu'UNE fois par navigateur, puis c'est instantané.
//  Différence avec le cache nw_hist_* (delta seul, TTL 1h, purgé quotidiennement) :
//  ce store n'expire jamais et accumule.
// ════════════════════════════════════════════════════════════════════
const HIST_STORE_KEY = 'nw_hist_store_v1';
// v382 — plage du backfill initial (1re visite / nouvelle position). 5Y couvre la vie complète
// de toutes nos positions (la plus ancienne = ESPP Accenture 2023) avec marge. Ensuite : gap-only.
const HIST_BACKFILL_RANGE = '5y';

function _todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Lit le store persistant. Retourne {tickers, fx, sgtmHistory?, _updated, _lastDate} ou null. */
export function loadHistStore() {
  try {
    const raw = localStorage.getItem(HIST_STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.v !== 1 || !s.tickers || !s.fx || !Object.keys(s.tickers).length) return null;
    return s;
  } catch (e) { return null; }
}

// v382 — borne dure de la taille du store (garde les N derniers jours par série).
// 1800 jours ≈ 7 ans > le backfill 5Y → aucune perte en pratique, mais empêche le blob
// localStorage de grossir sans limite (quota ~5 Mo).
const MAX_STORE_DAYS = 1800;
function _trimSeries(d) {
  if (!d || !d.dates || d.dates.length <= MAX_STORE_DAYS) return d;
  return { dates: d.dates.slice(-MAX_STORE_DAYS), closes: d.closes.slice(-MAX_STORE_DAYS) };
}

/** Persiste le store accumulé (best-effort ; silencieux si quota dépassé). */
export function saveHistStore(data) {
  try {
    if (!data || !data.tickers) return;
    const tickers = {}, fx = {};
    for (const [t, d] of Object.entries(data.tickers)) tickers[t] = _trimSeries(d);
    for (const [k, d] of Object.entries(data.fx || {})) fx[k] = _trimSeries(d);
    const s = {
      v: 1,
      tickers,
      fx,
      _updated: _todayISO(),
      _lastDate: getLastDate(data),
      _backfilled: !!data._backfilled, // v382 — historique complet déjà chargé ⇒ delta-only ensuite
    };
    if (data.sgtmHistory && data.sgtmHistory.length) s.sgtmHistory = data.sgtmHistory;
    localStorage.setItem(HIST_STORE_KEY, JSON.stringify(s));
  } catch (e) { /* quota — best effort, on retombera sur le snapshot */ }
}

/**
 * Base instantanée pour le graphe : clone du store accumulé si présent,
 * sinon clone du snapshot statique bundlé (1re visite du navigateur).
 * `_fromStore` indique la provenance ; `_storeUpdated` la fraîcheur du store.
 */
export function getHistoricalBase(snapshot) {
  const store = loadHistStore();
  const src = store || snapshot || { tickers: {}, fx: {} };
  const base = { tickers: {}, fx: {} };
  for (const [t, d] of Object.entries(src.tickers || {})) base.tickers[t] = { dates: [...d.dates], closes: [...d.closes] };
  for (const [k, d] of Object.entries(src.fx || {})) base.fx[k] = { dates: [...d.dates], closes: [...d.closes] };
  base._snapshotDate = store ? (store._lastDate || '1900-01-01') : ((snapshot && snapshot._snapshotDate) || '1900-01-01');
  base._fromStore = !!store;
  base._storeUpdated = store ? store._updated : null;
  base._backfilled = store ? !!store._backfilled : false; // v382 — historique complet déjà chargé ?
  if (store && store.sgtmHistory) base.sgtmHistory = store.sgtmHistory.map(x => ({ ...x }));
  return base;
}

// v382 — union de deux séries {dates,closes} par date (triée, dédupliquée ; le delta
// GAGNE sur les dates en conflit → un jour re-fetché voit sa clôture provisoire remplacée
// par la définitive). Gère indifféremment le préfixe (backfill), l'ajout (gap) et le remplacement.
function unionSeries(base, delta) {
  const map = new Map();
  if (base && base.dates) for (let i = 0; i < base.dates.length; i++) map.set(base.dates[i], base.closes[i]);
  if (delta && delta.dates) for (let i = 0; i < delta.dates.length; i++) map.set(delta.dates[i], delta.closes[i]);
  const dates = [...map.keys()].sort();
  return { dates, closes: dates.map(d => map.get(d)) };
}

// ════════════════════════════════════════════════════════════════════
//  v383 — L2 : STORE SERVEUR PARTAGÉ (Supabase) — synchronise l'historique ENTRE MACHINES
//  L1 (localStorage) = cache local instantané ; L2 (Supabase) = source partagée. Une nouvelle
//  machine lit tout l'historique depuis L2 en 1 requête (au lieu de re-backfiller 5Y depuis
//  Yahoo) ; seul le delta manquant est chargé de Yahoo/TradingView, rendu, puis ré-uploadé
//  vers L2 en arrière-plan. Donnée = prix d'actions PUBLICS (non sensible) → clé anon dans le
//  client = pratique standard Supabase, RLS permissive suffit.
//  ⚠ url + anonKey VIDES ⇒ L2 no-op (comportement L1-only v382 strictement inchangé).
//  À remplir après provisioning (voir docs/SERVER_STORE_SETUP.md).
// ════════════════════════════════════════════════════════════════════
const SERVER_STORE = { url: '', anonKey: '', table: 'price_history', row: 'singleton' };
function _serverConfigured() { return !!(SERVER_STORE.url && SERVER_STORE.anonKey); }

/** Lit le blob d'historique depuis Supabase (L2). Retourne {tickers,fx,sgtmHistory?,_lastDate,_backfilled} ou null. */
export async function loadServerHistory() {
  if (!_serverConfigured()) return null;
  try {
    const u = SERVER_STORE.url.replace(/\/$/, '') + '/rest/v1/' + SERVER_STORE.table
      + '?id=eq.' + SERVER_STORE.row + '&select=data';
    const r = await fetch(u, {
      headers: { apikey: SERVER_STORE.anonKey, Authorization: 'Bearer ' + SERVER_STORE.anonKey },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return (rows && rows[0] && rows[0].data) || null;
  } catch (e) { console.warn('[hist] L2 read failed (non-bloquant):', e && e.message); return null; }
}

/** Upsert le blob d'historique vers Supabase (L2). Fire-and-forget (best-effort). */
export async function saveServerHistory(data) {
  if (!_serverConfigured() || !data || !data.tickers) return;
  try {
    const tickers = {}, fx = {};
    for (const [t, d] of Object.entries(data.tickers)) tickers[t] = _trimSeries(d);
    for (const [k, d] of Object.entries(data.fx || {})) fx[k] = _trimSeries(d);
    const blob = { tickers, fx, _lastDate: getLastDate(data), _backfilled: !!data._backfilled };
    if (data.sgtmHistory && data.sgtmHistory.length) blob.sgtmHistory = data.sgtmHistory;
    const u = SERVER_STORE.url.replace(/\/$/, '') + '/rest/v1/' + SERVER_STORE.table;
    await fetch(u, {
      method: 'POST',
      headers: {
        apikey: SERVER_STORE.anonKey, Authorization: 'Bearer ' + SERVER_STORE.anonKey,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ id: SERVER_STORE.row, data: blob }),
      signal: AbortSignal.timeout(15000),
    });
    console.log('[hist] L2 Supabase upload OK → coverage ' + blob._lastDate);
  } catch (e) { console.warn('[hist] L2 upload failed (non-bloquant):', e && e.message); }
}

/**
 * Fetch daily close prices for a single ticker via Yahoo Finance chart API.
 * @param {string} symbol - Yahoo Finance ticker (e.g., 'AIR.PA', 'IBIT', '4911.T')
 * @param {string} [range='ytd'] - Range: 'ytd' or '1y'
 * @returns {{ dates: string[], closes: number[] } | null}
 */
async function fetchTickerHistory(symbol, rangeOrOpts) {
  // v382 — accepte soit une plage nommée ('ytd','5y',…), soit une fenêtre précise
  // { period1, period2 } (timestamps unix) pour ne récupérer QUE le delta depuis la
  // dernière visite (« l'API n'est appelée que pour les données futures »).
  let qs;
  if (rangeOrOpts && typeof rangeOrOpts === 'object' && rangeOrOpts.period1) {
    const p2 = rangeOrOpts.period2 || Math.floor(Date.now() / 1000);
    qs = 'period1=' + Math.floor(rangeOrOpts.period1) + '&period2=' + Math.floor(p2) + '&interval=1d';
  } else {
    qs = 'range=' + (rangeOrOpts || 'ytd') + '&interval=1d';
  }
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?' + qs;
  const attempts = [];

  for (const proxy of PROXIES) {
    attempts.push(
      fetchWithTimeout(proxy(url), 12000)
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(d => {
          const result = d?.chart?.result?.[0];
          if (!result) throw new Error('no data');
          const timestamps = result.timestamp;
          const closes = result.indicators?.quote?.[0]?.close;
          if (!timestamps || !closes || timestamps.length === 0) throw new Error('no OHLC');

          const dates = timestamps.map(ts => {
            const dt = new Date(ts * 1000);
            return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
          });

          // Forward-fill null closes
          const filledCloses = [];
          let lastValid = null;
          for (let i = 0; i < closes.length; i++) {
            if (closes[i] != null && closes[i] > 0) { lastValid = closes[i]; }
            filledCloses.push(lastValid);
          }

          // Deduplicate dates: Yahoo API can return two entries for the
          // current trading day (previous close + live intraday).
          // Keep the LAST value for each date (= most recent / live price).
          const dedupDates = [];
          const dedupCloses = [];
          for (let i = 0; i < dates.length; i++) {
            if (i < dates.length - 1 && dates[i] === dates[i + 1]) continue; // skip first dupe
            dedupDates.push(dates[i]);
            dedupCloses.push(filledCloses[i]);
          }

          return { dates: dedupDates, closes: dedupCloses };
        })
    );
  }

  try {
    return await Promise.any(attempts);
  } catch (e) {
    console.warn('[hist] Failed to fetch history for ' + symbol);
    return null;
  }
}

/**
 * Fetch historical prices using snapshot + delta strategy.
 *
 * Architecture (v259):
 *   1. Start from PRICE_SNAPSHOT (static file, 1Y+ of daily data)
 *   2. Check delta cache in localStorage (today's delta)
 *   3. If stale/missing, fetch only YTD range from Yahoo (covers snapshot→today gap)
 *   4. Merge: snapshot base + delta extension (dates after snapshot end)
 *   5. Result: complete dataset usable for ALL periods (MTD→MAX)
 *
 * This replaces the former fetchHistoricalPricesYTD + fetchHistoricalPrices1Y
 * dual-fetch approach. One fetch, one dataset, all periods.
 *
 * @param {string[]} tickers - Yahoo Finance tickers to fetch
 * @param {object} snapshot - PRICE_SNAPSHOT from price_snapshot.js
 * @param {function} [onProgress] - callback(loaded, total, ticker)
 * @returns {object} { tickers: { [t]: {dates,closes} }, fx: { usd, jpy, mad } }
 */
export async function fetchHistoricalPrices(tickers, snapshot, onProgress) {
  // ── Step 1: Base = store persistant accumulé (v376) OU snapshot statique (1re visite) ──
  const result = getHistoricalBase(snapshot);
  const snapshotDate = result._snapshotDate || '1900-01-01';
  console.log('[hist] Base loaded (' + (result._fromStore ? 'store localStorage' : 'snapshot statique') + '): '
    + Object.keys(result.tickers).length + ' tickers + ' + Object.keys(result.fx).length + ' FX, up to ' + snapshotDate);

  // ── Step 1b (v376): skip réseau si le store a déjà été rafraîchi AUJOURD'HUI ──
  // L'historique daily ne bouge pas en intraday ; le prix « aujourd'hui » vient des
  // quotes live (unifyPrices côté app.js), pas d'ici. Évite 16+ requêtes redondantes
  // sur les visites répétées du même jour → chargement instantané.
  // v382 — on ne skip que si le store est frais ET déjà entièrement backfillé (sinon on doit
  // d'abord charger l'historique complet, même si le store a été touché aujourd'hui).
  if (result._fromStore && result._storeUpdated === _todayISO() && result._backfilled) {
    console.log('[hist] Store à jour + complet (maj ' + result._storeUpdated + ') → skip réseau, coverage → ' + getLastDate(result));
    return result;
  }

  // ── v383 : L2 — fusionner le store serveur Supabase AVANT de décider le delta ──
  // Une autre machine (ou session) a pu enrichir la base partagée depuis la dernière visite
  // locale. On lit L2, on l'unit à L1, puis le calcul du gap se fait sur L1∪L2 → on ne
  // redemande à Yahoo/TradingView QUE ce qui manque encore dans nos serveurs. Sur une machine
  // neuve (L1 vide), L2 fournit tout l'historique en 1 requête → pas de backfill 5Y depuis Yahoo.
  const server = await loadServerHistory();
  if (server && server.tickers) {
    for (const [t, d] of Object.entries(server.tickers)) result.tickers[t] = unionSeries(result.tickers[t], d);
    for (const [k, d] of Object.entries(server.fx || {})) result.fx[k] = unionSeries(result.fx[k], d);
    if (server.sgtmHistory && (!result.sgtmHistory || server.sgtmHistory.length > result.sgtmHistory.length)) result.sgtmHistory = server.sgtmHistory;
    if (server._backfilled) result._backfilled = true;
    console.log('[hist] L2 Supabase fusionné → coverage ' + getFirstDate(result) + ' → ' + getLastDate(result));
  }

  // ── Step 2 (v382): fetch CIBLÉ par série ──
  // • BACKFILL 5Y — 1re visite du navigateur (store jamais complété) OU nouvelle position
  //   absente du store → on charge l'historique complet une seule fois.
  // • GAP seul — sinon, on ne récupère QUE [dernière date connue → aujourd'hui]. On ne
  //   re-télécharge jamais une donnée déjà en base ⇒ « l'API n'est appelée que pour le futur ».
  const fxPairs = [
    { symbol: 'EURUSD=X', key: 'usd' },
    { symbol: 'EURJPY=X', key: 'jpy' },
    { symbol: 'EURMAD=X', key: 'mad' },
  ];
  const total = tickers.length + fxPairs.length;
  let loaded = 0, backfills = 0, gaps = 0;
  const delta = { tickers: {}, fx: {} };
  const allPromises = [];
  const nowUnix = Math.floor(Date.now() / 1000);

  function _fetchArgs(existing) {
    const hasData = existing && existing.dates && existing.dates.length > 0;
    if (!result._backfilled || !hasData) return { mode: 'backfill', arg: HIST_BACKFILL_RANGE };
    // Gap : depuis (dernière date − 7 j de marge, pour recaler d'éventuelles clôtures
    // provisoires) jusqu'à maintenant. L'union dédoublonne ; le delta gagne sur les conflits.
    const last = existing.dates[existing.dates.length - 1];
    const p1 = Math.floor(new Date(last + 'T00:00:00Z').getTime() / 1000) - 7 * 86400;
    return { mode: 'gap', arg: { period1: p1, period2: nowUnix } };
  }

  for (const ticker of tickers) {
    const fa = _fetchArgs(result.tickers[ticker]);
    fa.mode === 'backfill' ? backfills++ : gaps++;
    allPromises.push(
      getStockHistory({ ticker }, fa.arg).then(data => {
        loaded++;
        if (data) delta.tickers[ticker] = { dates: data.dates, closes: data.closes };
        if (onProgress) onProgress(loaded, total, ticker + (data ? ' ✓' : ' ✗'));
      })
    );
  }

  for (const { symbol, key } of fxPairs) {
    const fa = _fetchArgs(result.fx[key]);
    fa.mode === 'backfill' ? backfills++ : gaps++;
    allPromises.push(
      getStockHistory({ ticker: symbol }, fa.arg).then(data => {
        loaded++;
        if (data) delta.fx[key] = { dates: data.dates, closes: data.closes };
        if (onProgress) onProgress(loaded, total, symbol + (data ? ' ✓' : ' ✗'));
      })
    );
  }

  await Promise.all(allPromises);

  // ── Step 3 (v382): fusion par UNION de dates (backfill = préfixe, gap = ajout) + persistance ──
  for (const [t, d] of Object.entries(delta.tickers)) result.tickers[t] = unionSeries(result.tickers[t], d);
  for (const [k, d] of Object.entries(delta.fx)) result.fx[k] = unionSeries(result.fx[k], d);
  result._backfilled = true; // le store est désormais complet → visites suivantes = gap-only
  saveHistStore(result);         // L1 (localStorage, cache local instantané)
  saveServerHistory(result);     // L2 (Supabase, upload en background — fire-and-forget)

  const loadedCount = Object.keys(delta.tickers).length;
  const fxStatus = Object.keys(delta.fx).map(k => k.toUpperCase() + ': ' + (delta.fx[k] ? '✓' : '✗')).join(', ');
  console.log('[hist] v382 : ' + backfills + ' backfill(' + HIST_BACKFILL_RANGE + ') + ' + gaps + ' gap → '
    + loadedCount + '/' + tickers.length + ' tickers + FX (' + fxStatus + ')');
  console.log('[hist] Store fusionné → coverage ' + getFirstDate(result) + ' → ' + getLastDate(result)
    + ' (' + ((result.tickers[tickers[0]] && result.tickers[tickers[0]].dates.length) || 0) + ' j sur ' + tickers[0] + ')');

  return result;
}

/** Merge delta data into base, adding only dates after snapshotDate */
function mergeInto(base, delta, snapshotDate) {
  // Merge tickers
  for (const [ticker, d] of Object.entries(delta.tickers || {})) {
    if (!base.tickers[ticker]) {
      // Ticker not in snapshot (new position or sold ticker) — use full delta
      base.tickers[ticker] = { dates: [...d.dates], closes: [...d.closes] };
    } else {
      // Extend with dates after snapshot
      const lastBase = base.tickers[ticker].dates[base.tickers[ticker].dates.length - 1];
      for (let i = 0; i < d.dates.length; i++) {
        if (d.dates[i] > lastBase) {
          base.tickers[ticker].dates.push(d.dates[i]);
          base.tickers[ticker].closes.push(d.closes[i]);
        }
      }
    }
  }
  // Merge FX
  for (const [key, d] of Object.entries(delta.fx || {})) {
    if (!base.fx[key]) {
      base.fx[key] = { dates: [...d.dates], closes: [...d.closes] };
    } else {
      const lastBase = base.fx[key].dates[base.fx[key].dates.length - 1];
      for (let i = 0; i < d.dates.length; i++) {
        if (d.dates[i] > lastBase) {
          base.fx[key].dates.push(d.dates[i]);
          base.fx[key].closes.push(d.closes[i]);
        }
      }
    }
  }
}

function getLastDate(data) {
  let max = '';
  for (const d of Object.values(data.tickers)) { const l = d.dates[d.dates.length - 1]; if (l > max) max = l; }
  for (const d of Object.values(data.fx)) { const l = d.dates[d.dates.length - 1]; if (l > max) max = l; }
  return max;
}

function getFirstDate(data) {
  let min = '9999';
  for (const d of Object.values(data.tickers)) { if (d.dates[0] < min) min = d.dates[0]; }
  for (const d of Object.values(data.fx)) { if (d.dates[0] < min) min = d.dates[0]; }
  return min;
}

// ── Legacy aliases (backward compat during transition) ──
export const fetchHistoricalPricesYTD = fetchHistoricalPrices;
export const fetchHistoricalPrices1Y = fetchHistoricalPrices;
