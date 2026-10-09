#!/usr/bin/env node
/**
 * reconstruire_snapshot.mjs — reconstitue le snapshot qu'aurait écrit le code EN LIGNE un jour donné
 * (v563).
 *
 * Usage : node scripts/reconstruire_snapshot.mjs --commit <sha> --date AAAA-MM-JJ [--data <data.js en clair>]
 * Sortie : JSON sur stdout ({ date, data }) ; rien n'est écrit en base.
 *
 * Pourquoi : certains jours n'ont été écrits que par un onglet resté sur une version périmée (v433 en
 * septembre 2026), avec le périmètre et les soldes d'août. Ces lignes sont fausses, et aucune autre
 * ne les remplace. On recalcule donc ce que le cron aurait écrit ce jour-là :
 *   · moteur ET données du commit en ligne à cette date (ou `--data` si les données de ce commit
 *     étaient chiffrées dans git) ;
 *   · cours : clôture de la dernière séance AVANT la date (le cron capture vers 00:30 UTC) ;
 *   · cours ramenés aux unités de l'époque : Yahoo réajuste l'historique après une division ou un
 *     regroupement (REGROUPEMENTS_TITRES du HEAD) ;
 *   · change : clôture de la veille ; SGTM : data/sgtm_history.json du HEAD.
 */
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const COMMIT = arg('--commit'), DATE = arg('--date'), DATA = arg('--data');
if (!COMMIT || !/^\d{4}-\d\d-\d\d$/.test(DATE || '')) {
  console.error('usage : --commit <sha> --date AAAA-MM-JJ [--data fichier]'); process.exit(2);
}
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
// stdout ne porte que le JSON : les journaux du moteur passent sur stderr.
console.log = (...a) => console.error(...a);
// Horloge figée à l'heure du cron ce jour-là : le moteur date l'amortissement des prêts, les
// échéances des créances et les bornes de période avec `new Date()`.
const FIGE = Date.parse(DATE + 'T00:30:00Z');
const DateReelle = Date;
globalThis.Date = class extends DateReelle {
  constructor(...a) { super(...(a.length ? a : [FIGE])); }
  static now() { return FIGE; }
};

// ── 1. Moteur et données du commit ──
const tmp = await mkdtemp(join(tmpdir(), 'nw-reconstruit-'));
const fichiers = execFileSync('git', ['ls-tree', '--name-only', COMMIT, 'js/'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => f.endsWith('.js'));
for (const f of fichiers) {
  let src = execFileSync('git', ['show', COMMIT + ':' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (f === 'js/data.js' && DATA) src = await readFile(DATA, 'utf8');
  await writeFile(join(tmp, f.slice(3)), src.replace(/\?v=\d+/g, ''));
}
// Version du CODE (message du commit « vN: ») — les données fournies par --data peuvent être plus anciennes.
const sujet = execFileSync('git', ['log', '-1', '--format=%s', COMMIT], { cwd: ROOT, encoding: 'utf8' });
const VERSION_CODE = (sujet.match(/^(v\d+):/) || [])[1] || COMMIT;
const D = await import(pathToFileURL(join(tmp, 'data.js')).href);
const E = await import(pathToFileURL(join(tmp, 'engine.js')).href);
if (!D.PORTFOLIO || !D.PORTFOLIO.amine || !Object.keys(D.PORTFOLIO.amine).length) {
  console.error('✗ données vides (chiffrées dans ce commit ?) — passer --data'); process.exit(1);
}
const { REGROUPEMENTS_TITRES = [] } = await import(pathToFileURL(join(ROOT, 'js', 'data.js')).href);

// ── 2. Clôture de la dernière séance avant DATE ──
const t0 = Math.floor(Date.parse(DATE + 'T00:00:00Z') / 1000);
async function clotureAvant(sym) {
  for (const host of ['query1', 'query2']) {
    try {
      const u = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${t0 - 12 * 86400}&period2=${t0}&interval=1d`;
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const res = (await r.json())?.chart?.result?.[0];
      const ts = res?.timestamp || [], cl = res?.indicators?.quote?.[0]?.close || [];
      for (let i = ts.length - 1; i >= 0; i--) {
        const jour = new Date(ts[i] * 1000).toISOString().slice(0, 10);
        if (jour < DATE && cl[i] > 0) return { jour, cours: cl[i] };
      }
    } catch (e) { /* hôte suivant */ }
  }
  return null;
}
// Yahoo exprime tout l'historique dans les unités d'aujourd'hui : avant un regroupement, le cours
// de l'époque = cours ajusté × facteur.
const unitesEpoque = (ticker, jour, cours) => REGROUPEMENTS_TITRES
  .filter((ev) => ev.ticker === ticker && jour < ev.date)
  .reduce((c, ev) => c * ev.facteur, cours);

const fx = { ...D.FX_STATIC };
for (const [pair, k] of [['EURUSD=X', 'USD'], ['EURJPY=X', 'JPY'], ['EURAED=X', 'AED'], ['EURMAD=X', 'MAD']]) {
  const c = await clotureAvant(pair);
  if (!c) { console.error('✗ change ' + pair + ' introuvable'); process.exit(1); }
  fx[k] = c.cours;
}
const positions = (D.PORTFOLIO.amine.ibkr.positions || [])
  .concat((D.PORTFOLIO.nezha && D.PORTFOLIO.nezha.ibkr && D.PORTFOLIO.nezha.ibkr.positions) || []);
const cours = {};
for (const t of [...new Set(positions.map((p) => p.ticker)), 'ACN']) {
  const c = await clotureAvant(t);
  if (!c) { console.error('✗ cours ' + t + ' introuvable'); process.exit(1); }
  cours[t] = { jour: c.jour, cours: unitesEpoque(t, c.jour, c.cours) };
}
for (const p of positions) { p.price = cours[p.ticker].cours; p._live = true; }
D.PORTFOLIO.market.acnPriceUSD = cours.ACN.cours; D.PORTFOLIO.market._acnLive = true;
const sgtm = JSON.parse(await readFile(join(ROOT, 'data', 'sgtm_history.json'), 'utf8')).series
  .filter((p) => p.date < DATE && p.priceMAD > 0).pop();
if (sgtm) { D.PORTFOLIO.market.sgtmPriceMAD = sgtm.priceMAD; D.PORTFOLIO.market._sgtmLive = true; }

// ── 3. Calcul ──
const state = E.compute(D.PORTFOLIO, fx, 'live');
const data = E.buildDailySnapshot(state);
data.meta = {
  ...(data.meta || {}),
  appVersion: 'reconstruit-' + VERSION_CODE,
  reconstruit: { commit: COMMIT, donnees: DATA ? 'source en clair fournie (' + (D.APP_VERSION || '?') + ')' : 'commit', cours: 'clôtures avant ' + DATE, sgtm: sgtm ? sgtm.date : null },
};
process.stdout.write(JSON.stringify({ date: DATE, data }));
