#!/usr/bin/env node
/**
 * daily_snapshot.mjs — Snapshot quotidien du patrimoine SANS visite du site (v390).
 *
 * Tourne en GitHub Action (~22h Paris, après clôture US) :
 *   1. Prix live Yahoo (direct, pas de CORS en Node) pour chaque position + FX.
 *   2. SGTM : data/sgtm_live.json du checkout (rafraîchi par le cron horaire existant).
 *   3. compute() headless (même moteur que le site, imports ?v= strippés → .tmp/).
 *   4. buildDailySnapshot() → INSERT Supabase nw_snapshots (append-only, clé publishable).
 *
 * Limites connues (flaguées dans meta) : pas de localStorage en headless → facturation
 * = fallback data.js ; fxSource='live (cron)'. La ligne du cron étant la plus récente à
 * qualité égale, elle devient la valeur EOD du jour à la lecture (loadSnapshots).
 * Usage local : node scripts/daily_snapshot.mjs [--dry-run]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };

// ── 1. Moteur headless (strip ?v= comme scripts/detect_desyncs.mjs) ──
const tmp = join(ROOT, '.tmp_snapshot');
await mkdir(tmp, { recursive: true });
for (const f of ['data.js', 'engine.js']) {
  const src = await readFile(join(ROOT, 'js', f), 'utf8');
  await writeFile(join(tmp, f), src.replace(/\?v=\d+/g, ''));
}
const { PORTFOLIO, FX_STATIC } = await import(pathToFileURL(join(tmp, 'data.js')).href);
const { compute, buildDailySnapshot } = await import(pathToFileURL(join(tmp, 'engine.js')).href);

// ── 2. FX live (Yahoo, EUR base) ──
async function yahooChart(sym) {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`,
        { headers: UA, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const price = res?.meta?.regularMarketPrice;
      if (price > 0) return price;
    } catch (e) { /* try next host */ }
  }
  return null;
}

const fx = { ...FX_STATIC };
let fxLive = 0;
for (const [pair, key] of [['EURUSD=X', 'USD'], ['EURJPY=X', 'JPY'], ['EURAED=X', 'AED'], ['EURMAD=X', 'MAD']]) {
  const v = await yahooChart(pair);
  if (v > 0) { fx[key] = v; fxLive++; }
}
console.log(`[cron-snap] FX live ${fxLive}/4 →`, JSON.stringify(fx));

// ── 3. Prix live par position (+ ACN pour l'ESPP) ──
const positions = PORTFOLIO.amine.ibkr.positions || [];
let live = 0, total = 0;
for (const pos of positions) {
  total++;
  const p = await yahooChart(pos.ticker);
  if (p > 0) { pos.price = p; pos._live = true; live++; }
  else console.warn('[cron-snap] ✗ ' + pos.ticker + ' (prix statique conservé)');
}
total++; // ACN (ESPP)
const acn = await yahooChart('ACN');
if (acn > 0) { PORTFOLIO.market.acnPriceUSD = acn; PORTFOLIO.market._acnLive = true; live++; }

// ── 4. SGTM depuis le fichier repo (cron horaire scrape_sgtm) ──
let sgtmSource = 'static-bootstrap';
try {
  const sgtm = JSON.parse(await readFile(join(ROOT, 'data', 'sgtm_live.json'), 'utf8'));
  if (sgtm && sgtm.priceMAD > 0) {
    PORTFOLIO.market.sgtmPriceMAD = sgtm.priceMAD;
    PORTFOLIO.market._sgtmLive = true;
    const ageH = (Date.now() - new Date(sgtm.lastUpdate || 0).getTime()) / 3.6e6;
    sgtmSource = 'repo:' + (sgtm.source || '?') + (ageH > 24 ? '-stale' : '');
    total++; live++;
  }
} catch (e) { console.warn('[cron-snap] sgtm_live.json illisible:', e.message); }
console.log(`[cron-snap] prix live ${live}/${total} | SGTM ${sgtmSource}`);

// ── 5. Compute + snapshot ──
const state = compute(PORTFOLIO, fx, live > 0 ? 'live' : 'statique');
const snap = buildDailySnapshot(state);
snap.meta.fxSource = fxLive === 4 ? 'live (cron)' : 'partiel (cron ' + fxLive + '/4)';
snap.meta.liveTickers = live + '/' + total;
snap.meta.appVersion = 'cron';
snap.meta.sgtmSource = sgtmSource;
const quality = (live >= total && fxLive === 4) ? 'live' : (live > 0 ? 'partial' : 'static');
console.log('[cron-snap] NW couple', snap.total.couple, '€ | qualité', quality, '| guards', snap.meta.guardsOk);

if (quality === 'static') { console.error('[cron-snap] tout statique → pas d\'insert (on ne fige pas un jour dégradé)'); process.exit(1); }
if (!snap.meta.guardsOk) { console.error('[cron-snap] invariants KO → pas d\'insert'); process.exit(1); }

// ── 6. INSERT append-only (clé publishable — publique par design, cf. docs) ──
const SUPA = 'https://mjbmtubkhlspwfqhqgvq.supabase.co';
const KEY = 'sb_publishable_V_Xa4lXSCnobfUT940sktA_EU7I2PQO';
const snapDate = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
if (DRY) { console.log('[cron-snap] DRY RUN — insert sauté. Blob:', JSON.stringify(snap).length, 'octets, date', snapDate); process.exit(0); }
const res = await fetch(SUPA + '/rest/v1/nw_snapshots', {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify({ snap_date: snapDate, quality, data: snap }),
  signal: AbortSignal.timeout(15000),
});
if (!res.ok) { console.error('[cron-snap] insert HTTP', res.status, await res.text()); process.exit(1); }
console.log('[cron-snap] ✅ snapshot', snapDate, '(' + quality + ') inséré — NW', snap.total.couple, '€');
