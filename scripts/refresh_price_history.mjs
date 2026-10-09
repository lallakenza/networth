#!/usr/bin/env node
/**
 * refresh_price_history.mjs — met à jour chaque soir l'historique de cours partagé (Supabase
 * `price_history`, la « L2 » de api.js) avec le seul DELTA depuis la dernière clôture connue (v567).
 *
 * Pourquoi côté serveur : le navigateur n'atteint Yahoo qu'à travers des proxys CORS gratuits, de moins
 * en moins fiables. En octobre 2026, EUR/USD était figé au 15/09 et EUR/JPY au 19/09 dans la L2. Ici,
 * Node appelle Yahoo directement : chaque visite du site trouve un historique déjà à jour et n'a plus
 * rien (ou presque) à télécharger.
 *
 * Usage : node scripts/refresh_price_history.mjs [--dry-run]
 * Écrit avec la clé publishable, comme le navigateur (RLS de price_history : ligne unique, prix publics).
 */
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };

// Même configuration L2 que js/api.js (SERVER_STORE), lue dans le source pour ne pas la dupliquer.
const api = await readFile(join(ROOT, 'js', 'api.js'), 'utf8');
const champ = (k) => (api.match(new RegExp(k + ":\\s*'([^']+)'")) || [])[1];
const URL_L2 = champ('url'), CLE = champ('anonKey'), TABLE = champ('table'), LIGNE = champ('row');
if (!URL_L2 || !CLE || !TABLE || !LIGNE) { console.error('✗ configuration L2 introuvable dans js/api.js'); process.exit(1); }
const ENTETES = { apikey: CLE, Authorization: 'Bearer ' + CLE };

// Registres du dépôt : positions (tickers à suivre) et regroupements (unités des séries).
const tmp = await mkdtemp(join(tmpdir(), 'nw-hist-'));
for (const f of ['data.js', 'engine.js', 'facturation_contract.js']) {
  await writeFile(join(tmp, f), (await readFile(join(ROOT, 'js', f), 'utf8')).replace(/\?v=\d+/g, ''));
}
const D = await import(pathToFileURL(join(tmp, 'data.js')).href);
const E = await import(pathToFileURL(join(tmp, 'engine.js')).href);

// ── 1. Historique partagé actuel ──
const lu = await fetch(`${URL_L2}/rest/v1/${TABLE}?id=eq.${LIGNE}&select=data`, { headers: ENTETES, signal: AbortSignal.timeout(20000) });
if (!lu.ok) { console.error('✗ lecture L2 HTTP ' + lu.status); process.exit(1); }
const blob = ((await lu.json())[0] || {}).data || { tickers: {}, fx: {} };
blob.tickers = blob.tickers || {}; blob.fx = blob.fx || {};

// ── 2. Delta Yahoo par série, daté dans le fuseau de la place (comme le navigateur à Paris ou Dubaï) ──
const dateLocale = (ts, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(new Date(ts * 1000));
async function historique(sym, depuis) {
  const p1 = depuis ? Math.floor(Date.parse(depuis + 'T00:00:00Z') / 1000) - 7 * 86400 : null;
  const qs = p1 ? `period1=${p1}&period2=${Math.floor(Date.now() / 1000)}&interval=1d` : 'range=5y&interval=1d';
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${qs}`, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const res = (await r.json())?.chart?.result?.[0];
      const ts = res?.timestamp || [], cl = res?.indicators?.quote?.[0]?.close || [];
      const tz = res?.meta?.exchangeTimezoneName;
      const parJour = new Map();
      for (let i = 0; i < ts.length; i++) if (cl[i] > 0) parJour.set(dateLocale(ts[i], tz), cl[i]); // la dernière barre du jour gagne
      if (parJour.size) return parJour;
    } catch (e) { /* hôte suivant */ }
  }
  return null;
}
function fusionner(serie, delta) {
  const m = new Map();
  if (serie && serie.dates) serie.dates.forEach((d, i) => m.set(d, serie.closes[i]));
  for (const [d, c] of delta) m.set(d, c);                       // le delta gagne (clôture définitive)
  const dates = [...m.keys()].sort();
  return { dates, closes: dates.map((d) => m.get(d)) };
}

const positions = (D.PORTFOLIO.amine.ibkr.positions || []).concat((D.PORTFOLIO.nezha.ibkr && D.PORTFOLIO.nezha.ibkr.positions) || []);
const tickers = [...new Set([...Object.keys(blob.tickers), ...positions.map((p) => p.ticker), 'ACN'])];
const PAIRES = { usd: 'EURUSD=X', jpy: 'EURJPY=X', mad: 'EURMAD=X' };
const bilan = { ok: [], ko: [] };
for (const t of tickers) {
  const s = blob.tickers[t];
  const delta = await historique(t, s && s.dates && s.dates.length ? s.dates[s.dates.length - 1] : null);
  if (!delta) { bilan.ko.push(t); continue; }
  blob.tickers[t] = fusionner(s, delta); bilan.ok.push(t);
}
for (const [k, sym] of Object.entries(PAIRES)) {
  const s = blob.fx[k];
  const delta = await historique(sym, s && s.dates && s.dates.length ? s.dates[s.dates.length - 1] : null);
  if (!delta) { bilan.ko.push(sym); continue; }
  blob.fx[k] = fusionner(s, delta); bilan.ok.push(sym);
}

// ── 3. Unités d'aujourd'hui (divisions, regroupements) puis écriture ──
const reg = E.normaliserRegroupements(blob, D.REGROUPEMENTS_TITRES);
if (reg.length) console.log('[hist-cron] regroupements appliqués :', reg.map((x) => x.ticker + ' ' + x.jours + ' j').join(', '));
let derniere = '';
for (const s of [...Object.values(blob.tickers), ...Object.values(blob.fx)]) { const l = s.dates[s.dates.length - 1]; if (l > derniere) derniere = l; }
blob._lastDate = derniere; blob._backfilled = true;
const retard = Object.entries({ ...blob.tickers, ...Object.fromEntries(Object.entries(blob.fx).map(([k, v]) => ['fx:' + k, v])) })
  .filter(([, s]) => (Date.parse(derniere) - Date.parse(s.dates[s.dates.length - 1])) > 4 * 86400000).map(([k]) => k);
console.log(`[hist-cron] ${bilan.ok.length} séries à jour, échecs : ${bilan.ko.join(', ') || 'aucun'} ; couverture → ${derniere}`
  + (retard.length ? ' ; en retard de plus de 4 j : ' + retard.join(', ') : ''));

if (DRY) { console.log('[hist-cron] --dry-run : aucune écriture'); process.exit(0); }
const ecrit = await fetch(`${URL_L2}/rest/v1/${TABLE}`, {
  method: 'POST',
  headers: { ...ENTETES, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({ id: LIGNE, data: blob }),
  signal: AbortSignal.timeout(30000),
});
if (!ecrit.ok) { console.error('✗ écriture L2 HTTP ' + ecrit.status + ' : ' + (await ecrit.text()).slice(0, 200)); process.exit(1); }
console.log('[hist-cron] ✓ historique partagé mis à jour');
// Une série en échec n'empêche pas l'écriture des autres, mais le job doit le signaler.
if (bilan.ko.length) process.exit(1);
