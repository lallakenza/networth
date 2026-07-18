#!/usr/bin/env node
/**
 * backfill_positions.mjs — Renseigne RÉTROACTIVEMENT l'historique de chaque position (v391).
 *
 * Reconstruction HONNÊTE (rien d'inventé) : parts(J) du grand livre des trades/lots ×
 * clôture(J) du price store L2 (backfill 5Y v382, y compris tickers vendus) × FX(J).
 * Écrit des snapshots PARTIELS (stocks uniquement, quality='partial', meta.backfill=true)
 * dans nw_snapshots — le NW total reste vide sur ces dates (pas de données inventées).
 *
 * Granularité : hebdo (lundis) avant 2026-01-01, quotidien ensuite. Les dates ayant déjà
 * un snapshot réel sont SAUTÉES. Degiro exclu (compte clos ; mensuel via EQUITY_HISTORY).
 *
 * Validations avant insert :
 *  V1 Σ parts lots ESPP == parts actuelles data.js
 *  V2 valeurs 2026-01-02 vs refs ytdOpen de data.js (par position, tolérance 3 %)
 *  V3 tickers vendus : valeur au jour de vente ≈ produit de cession (tolérance 8 % — détecte les splits)
 *  V4 SGTM à l'IPO = 64 × 461,95 MAD
 * Un ticker qui échoue V2/V3 est EXCLU (couverture partielle honnête, jamais fausse).
 *
 * Usage : node scripts/backfill_positions.mjs [--dry-run]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const SUPA = 'https://mjbmtubkhlspwfqhqgvq.supabase.co';
const KEY = 'sb_publishable_V_Xa4lXSCnobfUT940sktA_EU7I2PQO';
const HDRS = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };

// Trades (tickers nus) → ids du price store (Yahoo). Id de série snapshot = id du store.
const TICKER_MAP = { WLN: 'WLN.PA', GLE: 'GLE.PA', NXI: 'NXI.PA', EDEN: 'EDEN.PA' };
// Devise par ticker vendu (les positions actuelles portent la leur).
const SOLD_CCY = { 'QQQM': 'USD', 'WLN.PA': 'EUR', 'GLE.PA': 'EUR', 'NXI.PA': 'EUR', 'EDEN.PA': 'EUR', 'DG.PA': 'EUR' };

// ── Données locales (headless) ──
const tmp = join(ROOT, '.tmp_snapshot'); await mkdir(tmp, { recursive: true });
await writeFile(join(tmp, 'data.js'), (await readFile(join(ROOT, 'js/data.js'), 'utf8')).replace(/\?v=\d+/g, ''));
const { PORTFOLIO } = await import(pathToFileURL(join(tmp, 'data.js')).href);

// ── Price store L2 ──
const blob = (await (await fetch(SUPA + '/rest/v1/price_history?id=eq.singleton&select=data', { headers: HDRS })).json())[0].data;
const PX = {}; // ticker → Map(date→close)
for (const [t, s] of Object.entries(blob.tickers)) PX[t] = { dates: s.dates, closes: s.closes };
const FX = {}; for (const [k, s] of Object.entries(blob.fx)) FX[k] = { dates: s.dates, closes: s.closes };
const SGTM = (blob.sgtmHistory || []).map(e => ({ date: e.date, px: e.priceMAD || e.close }));

// ── Extension ACN + EURUSD jusqu'à 2018 (lots ESPP dès 2018-05) — 1 fetch Yahoo chacun ──
async function yahooHist(sym, range) {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const res = (await r.json())?.chart?.result?.[0];
      const ts = res?.timestamp, cl = res?.indicators?.quote?.[0]?.close;
      if (!ts || !cl) continue;
      const dates = [], closes = []; let last = null;
      for (let i = 0; i < ts.length; i++) {
        const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
        if (cl[i] != null && cl[i] > 0) last = cl[i];
        if (last != null && (dates.length === 0 || dates[dates.length - 1] !== d)) { dates.push(d); closes.push(last); }
        else if (last != null) closes[closes.length - 1] = last;
      }
      return { dates, closes };
    } catch (e) { /* next host */ }
  }
  return null;
}
function prependSeries(target, ext) {
  if (!ext) return;
  const firstKnown = target.dates[0];
  const addD = [], addC = [];
  for (let i = 0; i < ext.dates.length; i++) if (ext.dates[i] < firstKnown) { addD.push(ext.dates[i]); addC.push(ext.closes[i]); }
  target.dates = [...addD, ...target.dates]; target.closes = [...addC, ...target.closes];
}
console.log('[backfill] extension ACN + EURUSD → 2018 (Yahoo range=10y)…');
prependSeries(PX.ACN, await yahooHist('ACN', '10y'));
prependSeries(FX.usd, await yahooHist('EURUSD=X', '10y'));
console.log('[backfill] ACN dès', PX.ACN.dates[0], '| EURUSD dès', FX.usd.dates[0]);

// ── Accès forward-fill (dernière clôture ≤ J) ──
function atDate(series, d) {
  const { dates, closes } = series;
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? closes[ans] : null;
}
const fxAt = (ccy, d) => ccy === 'EUR' ? 1
  : ccy === 'USD' ? atDate(FX.usd, d)
  : ccy === 'JPY' ? atDate(FX.jpy, d)
  : ccy === 'MAD' ? atDate(FX.mad, d)
  : ccy === 'AED' ? (atDate(FX.usd, d) || 0) * 3.6725 // peg AED/USD depuis 1997
  : null;
const sgtmAt = (d) => { let v = null; for (const e of SGTM) { if (e.date <= d) v = e.px; else break; } return v; };

// ── Parts à la date J ──
const trades = (PORTFOLIO.amine.ibkr.trades || []).filter(t => t.type === 'buy' || t.type === 'sell');
// Devise par ticker : source primaire = le trade lui-même (t.currency), fallback positions/SOLD_CCY
const CCY = {}; (PORTFOLIO.amine.ibkr.positions || []).forEach(p => { CCY[p.ticker] = p.currency; });
Object.assign(CCY, SOLD_CCY);
trades.forEach(t => { const id = TICKER_MAP[t.ticker] || t.ticker; if (t.currency && !CCY[id]) CCY[id] = t.currency; });
function sharesAt(storeId, d) {
  let n = 0;
  for (const t of trades) {
    if ((TICKER_MAP[t.ticker] || t.ticker) !== storeId || t.date > d) continue;
    n += (t.type === 'buy' ? 1 : -1) * (t.qty || 0); // champ réel = qty (pas shares)
  }
  return Math.max(0, Math.round(n * 10000) / 10000);
}
const lotsA = (PORTFOLIO.amine.espp.lots || []), lotsN = ((PORTFOLIO.nezha.espp || {}).lots || []);
const esppSharesAt = (lots, d) => lots.filter(l => l.date <= d).reduce((s, l) => s + (l.shares || 0), 0);

// ── CASH depuis l'HISTORIQUE GIT de data.js (v392) ──
// Chaque commit modifiant un solde = une observation datée réelle (« le solde valait X
// ce jour-là »). Fonction en escalier entre observations (un solde bancaire persiste).
// Ids stables = ceux des snapshots live (CASH_ACCOUNT_IDS engine). Parsing par section
// (amine avant « nezha: { », nezha après) car revolutEUR existe des deux côtés.
import { execSync } from 'node:child_process';
const CASH_SPEC = {
  mashreq:          { s: 'amine', keys: ['mashreq'], ccy: 'AED', owner: 'A' },
  wio_savings:      { s: 'amine', keys: ['wioSavings'], ccy: 'AED', owner: 'A' },
  wio_current:      { s: 'amine', keys: ['wioCurrent'], ccy: 'AED', owner: 'A' },
  wio_business:     { s: 'amine', keys: ['wioBusiness'], ccy: 'AED', owner: 'A' },
  revolut_amine:    { s: 'amine', keys: ['revolutEUR', 'revolut'], ccy: 'EUR', owner: 'A' },
  banque_populaire: { s: 'amine', keys: ['banquePopulaire'], ccy: 'EUR', owner: 'A' },
  binance:          { s: 'amine', keys: ['binanceUSDT'], ccy: 'USD', owner: 'A' },
  attijari_amine:   { s: 'amine', keys: ['attijari'], ccy: 'MAD', owner: 'A' },
  nabd:             { s: 'amine', keys: ['nabd', 'soge'], ccy: 'MAD', owner: 'A' },
  cih:              { s: 'amine', keys: ['cih'], ccy: 'MAD', owner: 'A' },
  revolut_nezha:    { s: 'nezha', keys: ['revolutEUR'], ccy: 'EUR', owner: 'N' },
  credit_mutuel:    { s: 'nezha', keys: ['creditMutuelCC', 'creditMutuel'], ccy: 'EUR', owner: 'N' },
  livret_a:         { s: 'nezha', keys: ['lclLivretA', 'livretA'], ccy: 'EUR', owner: 'N' },
  lcl_compte:       { s: 'nezha', keys: ['lclCompteDepots', 'lclDepots'], ccy: 'EUR', owner: 'N' },
  ibkr_nezha:       { s: 'nezha', keys: ['ibkrEUR'], ccy: 'EUR', owner: 'N' },
  attijari_nezha:   { s: 'nezha', keys: ['attijariwafarMAD', 'attijariwafar'], ccy: 'MAD', owner: 'N' },
  wio_nezha:        { s: 'nezha', keys: ['wioAED'], ccy: 'AED', owner: 'N' },
};
function gitCashObservations() {
  const sh = (cmd) => execSync(cmd, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
  const commits = sh("git log --follow --reverse --format='%H %ad' --date=short -- js/data.js")
    .trim().split('\n').map(l => { const [sha, date] = l.split(' '); return { sha, date }; });
  const lastByDay = {};
  for (const { sha, date } of commits) {
    let text; try { text = sh('git show ' + sha + ':js/data.js'); } catch (e) { continue; }
    const idx = text.search(/\bnezha\s*:\s*\{/);
    const parts = { amine: idx > 0 ? text.slice(0, idx) : text, nezha: idx > 0 ? text.slice(idx) : '' };
    for (const [id, spec] of Object.entries(CASH_SPEC)) {
      for (const key of spec.keys) {
        const m = parts[spec.s].match(new RegExp('\\b' + key + '\\s*:\\s*(-?[0-9][0-9_ .]*)'));
        if (m) { const v = parseFloat(m[1].replace(/[_ ]/g, '')); if (isFinite(v)) { (lastByDay[id] = lastByDay[id] || {})[date] = v; } break; }
      }
    }
  }
  const series = {};
  for (const [id, byDay] of Object.entries(lastByDay)) {
    const obs = [];
    for (const d of Object.keys(byDay).sort()) {
      if (obs.length === 0 || obs[obs.length - 1].native !== byDay[d]) obs.push({ date: d, native: byDay[d] });
    }
    series[id] = obs;
  }
  return series;
}
const CASH_OBS = gitCashObservations();
console.log('[cash-git]', Object.keys(CASH_OBS).length, 'comptes,',
  Object.values(CASH_OBS).reduce((s, o) => s + o.length, 0), 'observations (commits data.js)');
const cashAt = (id, d) => { let v = null; for (const o of CASH_OBS[id] || []) { if (o.date <= d) v = o.native; else break; } return v; };
// V5 : la dernière observation de chaque compte doit égaler la valeur HEAD de data.js
const HEAD_CHECK = { mashreq: PORTFOLIO.amine.uae.mashreq, wio_savings: PORTFOLIO.amine.uae.wioSavings, attijari_amine: PORTFOLIO.amine.maroc.attijari };
for (const [id, expect] of Object.entries(HEAD_CHECK)) {
  const obs = CASH_OBS[id] || [];
  const lastV = obs.length ? obs[obs.length - 1].native : null;
  console.log('[V5]', id, 'dernière obs', lastV, 'vs data.js HEAD', expect, lastV === expect ? '✓' : '✗');
  if (lastV !== expect) { console.error('[V5] ÉCHEC'); process.exit(1); }
}

// V1 : Σ lots == parts actuelles
const totA = esppSharesAt(lotsA, '2099-01-01'), totN = esppSharesAt(lotsN, '2099-01-01');
console.log('[V1] ESPP Amine Σlots', totA, 'vs data.js', PORTFOLIO.amine.espp.shares, '| Nezha Σlots', totN, 'vs', (PORTFOLIO.nezha.espp || {}).shares);
if (Math.abs(totA - PORTFOLIO.amine.espp.shares) > 0.01 || Math.abs(totN - ((PORTFOLIO.nezha.espp || {}).shares || 0)) > 0.01) {
  console.error('[V1] ÉCHEC — lots ≠ parts actuelles'); process.exit(1);
}

// Tous les ids de série (store ids) touchés par les trades
const allIds = [...new Set(trades.map(t => TICKER_MAP[t.ticker] || t.ticker))];

// V2 : 2026-01-02 vs refs ytdOpen (positions actuelles)
const excluded = new Set();
console.log('[V2] refs ytdOpen (2026-01-02, tolérance 3 %) :');
for (const p of (PORTFOLIO.amine.ibkr.positions || [])) {
  if (!(p.ytdOpen > 0) || !PX[p.ticker]) continue;
  const close = atDate(PX[p.ticker], '2026-01-02');
  if (!(close > 0)) continue;
  const dev = Math.abs(close - p.ytdOpen) / p.ytdOpen * 100;
  const flag = dev > 3 ? ' ⚠ EXCLU' : ' ✓';
  if (dev > 3) excluded.add(p.ticker);
  console.log('   ', p.ticker.padEnd(9), 'store', close.toFixed(2), 'vs ytdOpen', p.ytdOpen, '→', dev.toFixed(1) + '%' + flag);
}

// V3 : vendus — valeur à la vente ≈ produit de cession (détecte les splits)
console.log('[V3] cessions (tolérance 8 %) :');
for (const id of allIds) {
  const sells = trades.filter(t => (TICKER_MAP[t.ticker] || t.ticker) === id && t.type === 'sell' && t.proceeds > 0 && t.qty > 0);
  for (const s of sells.slice(0, 2)) {
    if (!PX[id]) { excluded.add(id); console.log('   ', id.padEnd(9), '⚠ pas de série de prix → EXCLU'); break; }
    const close = atDate(PX[id], s.date);
    if (!(close > 0)) continue;
    const perShare = s.proceeds / s.qty; // natif
    const dev = Math.abs(close - perShare) / perShare * 100;
    const flag = dev > 8 ? ' ⚠ EXCLU (split ?)' : ' ✓';
    if (dev > 8) excluded.add(id);
    console.log('   ', id.padEnd(9), s.date, 'store', close.toFixed(2), 'vs cession/part', perShare.toFixed(2), '→', dev.toFixed(1) + '%' + flag);
  }
}

// V4 : SGTM IPO
const sgtmIpo = sgtmAt('2025-12-16');
console.log('[V4] SGTM 2025-12-16 :', sgtmIpo, 'MAD (attendu 461.95)', Math.abs(sgtmIpo - 461.95) < 1 ? '✓' : '✗');
if (Math.abs(sgtmIpo - 461.95) >= 1) process.exit(1);
if (excluded.size) console.warn('[backfill] tickers exclus (honnêteté > couverture) :', [...excluded].join(', '));

// ── Dates cibles : hebdo (lundis) < 2026, quotidien ≥ 2026 ; bornes = 1er lot ESPP → hier ──
// Dates déjà couvertes par un snapshot RÉEL (les lignes backfill sont régénérées, pas sautées)
const existingRows = await (await fetch(SUPA + '/rest/v1/nw_snapshots?select=snap_date,quality,bf:data->meta->>backfill', { headers: HDRS })).json();
const existing = new Set(existingRows.filter(r => r.bf !== 'true').map(r => r.snap_date));
const startISO = [...lotsA.map(l => l.date)].sort()[0];
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const targets = [];
for (let d = new Date(startISO + 'T00:00:00Z'); ; d.setUTCDate(d.getUTCDate() + 1)) {
  const iso = d.toISOString().slice(0, 10);
  if (iso > yesterday) break;
  const daily = iso >= '2026-01-01';
  if ((daily || d.getUTCDay() === 1) && !existing.has(iso)) targets.push(iso);
}
console.log('[backfill]', targets.length, 'dates cibles (' + targets[0], '→', targets[targets.length - 1] + '), granularité hebdo<2026 puis quotidienne');

// ── Construction des snapshots partiels ──
const rows = [];
for (const d of targets) {
  const positions = {};
  for (const id of allIds) {
    if (excluded.has(id) || !PX[id]) continue;
    const n = sharesAt(id, d);
    if (n <= 0) continue;
    const close = atDate(PX[id], d);
    const fx = fxAt(CCY[id] || 'EUR', d);
    if (!(close > 0) || !(fx > 0)) continue;
    positions[id] = { eur: Math.round(n * close / fx) };
  }
  const stocks = { positions };
  const esA = esppSharesAt(lotsA, d), esN = esppSharesAt(lotsN, d);
  const acn = atDate(PX.ACN, d), usd = fxAt('USD', d);
  if (esA > 0 && acn > 0 && usd > 0) { stocks.esppAmine = Math.round(esA * acn / usd); positions['ACN.ESPP.A'] = { eur: stocks.esppAmine }; }
  if (esN > 0 && acn > 0 && usd > 0) { stocks.esppNezha = Math.round(esN * acn / usd); positions['ACN.ESPP.N'] = { eur: stocks.esppNezha }; }
  if (d >= '2025-12-16') {
    const spx = sgtmAt(d), mad = fxAt('MAD', d);
    if (spx > 0 && mad > 0) {
      stocks.sgtmAmine = Math.round(32 * spx / mad); stocks.sgtmNezha = Math.round(32 * spx / mad);
      positions['SGTM.A'] = { eur: stocks.sgtmAmine }; positions['SGTM.N'] = { eur: stocks.sgtmNezha };
    }
  }
  // Cash observé via l'historique git (escalier entre observations, converti au FX du jour)
  const accounts = {};
  for (const [id, spec] of Object.entries(CASH_SPEC)) {
    const native = cashAt(id, d);
    if (native == null) continue;
    const fxv = fxAt(spec.ccy, d);
    if (!(fxv > 0)) continue;
    accounts[id] = { eur: Math.round(native / fxv), native, ccy: spec.ccy, owner: spec.owner, est: true };
  }
  const data = { schema: 1, stocks, meta: { backfill: true, method: 'parts(J,trades/lots) × clôture(J,store) × FX(J) ; cash = observations git data.js (escalier)', appVersion: 'backfill-v392' } };
  if (Object.keys(accounts).length > 0) data.cash = { accounts };
  if (Object.keys(positions).length === 0 && Object.keys(accounts).length === 0) continue;
  rows.push({ snap_date: d, quality: 'partial', data });
}
console.log('[backfill]', rows.length, 'snapshots partiels construits |', Math.round(JSON.stringify(rows).length / 1024), 'Ko total');

// Aperçu de contrôle : 3 dates clés
for (const probe of ['2023-05-01', '2025-12-16', yesterday]) {
  const r = rows.find(x => x.snap_date >= probe);
  if (r) console.log('   aperçu', r.snap_date, ':', Object.entries(r.data.stocks.positions).slice(0, 5).map(([k, v]) => k + '=' + v.eur + '€').join(' '));
}

if (DRY) { console.log('[backfill] DRY RUN — aucun insert.'); process.exit(0); }

// ── Insert ADMIN (Management API) : la policy RLS anon n'autorise que ≥ 2020-01-01,
//    le backfill remonte à 2018 — le passé se corrige en admin, par design (cf. runbook).
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('[backfill] SUPABASE_ACCESS_TOKEN requis pour l\'insert admin'); process.exit(1); }
async function adminSQL(query) {
  const res = await fetch('https://api.supabase.com/v1/projects/mjbmtubkhlspwfqhqgvq/database/query', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
}
// Régénération : les lignes backfill (admin-managed) sont supprimées puis ré-insérées
// enrichies — l'append-only protège l'historique RÉEL (quality live/partial du site),
// pas les reconstructions admin, régénérables par ce script de façon idempotente.
await adminSQL(`delete from public.nw_snapshots where quality = 'partial' and data->'meta'->>'backfill' = 'true';`);
console.log('[backfill] anciennes lignes backfill purgées (régénération)');
let inserted = 0;
for (let i = 0; i < rows.length; i += 40) {
  const batch = rows.slice(i, i + 40);
  const values = batch.map(r => `(date '${r.snap_date}', '${r.quality}', $j$${JSON.stringify(r.data)}$j$::jsonb)`).join(',\n');
  await adminSQL(`insert into public.nw_snapshots (snap_date, quality, data) values\n${values}\non conflict do nothing;`);
  inserted += batch.length;
  process.stdout.write('\r[backfill] insérés ' + inserted + '/' + rows.length);
}
console.log('\n[backfill] ✅ terminé —', inserted, 'snapshots rétroactifs (quality=partial, meta.backfill=true, insert admin)');
