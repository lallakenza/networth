#!/usr/bin/env node
/**
 * daily_snapshot.mjs — Snapshot quotidien du patrimoine SANS visite du site (v390).
 *
 * Tourne en GitHub Action (~22h Paris, après clôture US) :
 *   1. Prix live Yahoo (direct, pas de CORS en Node) pour chaque position + FX.
 *   2. SGTM : data/sgtm_live.json du checkout (rafraîchi par le cron horaire existant).
 *   3. compute() headless (même moteur que le site, imports ?v= strippés → .tmp/).
 *   4. buildDailySnapshot() → INSERT Supabase nw_snapshots (append-only). Clé serveur sb_secret_…
 *      (NW_SUPABASE_SECRET_KEY) en `apikey` seul dès qu'elle est valide ; sans elle, repli
 *      publishable en v544 uniquement, refus en v545 (scripts/_snapshot_auth.mjs).
 *
 * Limites connues (flaguées dans meta) : pas de localStorage en headless → facturation
 * = fallback data.js ; fxSource='live (cron)'. La ligne du cron étant la plus récente à
 * qualité égale, elle devient la valeur EOD du jour à la lecture (loadSnapshots).
 * Usage local : node scripts/daily_snapshot.mjs [--dry-run]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { dechiffreBlobs, remplirEnPlace } from './_dechiffre.mjs';
import { resolveSnapshotWriteAuth } from './_snapshot_auth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };

// ── 1. Moteur headless (strip ?v= comme scripts/detect_desyncs.mjs) ──
const tmp = join(ROOT, '.tmp_snapshot');
await mkdir(tmp, { recursive: true });
// engine.js importe data.js ET facturation_contract.js : les trois doivent être copiés dans .tmp,
// sinon l'import échoue (ERR_MODULE_NOT_FOUND). Même liste que scripts/detect_desyncs.mjs.
for (const f of ['data.js', 'engine.js', 'facturation_contract.js']) {
  const src = await readFile(join(ROOT, 'js', f), 'utf8');
  await writeFile(join(tmp, f), src.replace(/\?v=\d+/g, ''));
}
const { PORTFOLIO, FX_STATIC, APP_VERSION } = await import(pathToFileURL(join(tmp, 'data.js')).href);
const { compute, buildDailySnapshot } = await import(pathToFileURL(join(tmp, 'engine.js')).href);

// ── 1bis. GARDE-FOU CHIFFREMENT (v495) ────────────────────────────────────────────
// Depuis le chiffrement des données, `js/data.js` ne contient plus que des coquilles vides :
// les blocs réels vivent dans `js/data.enc.js`, déverrouillés par une phrase que le navigateur
// demande à l'ouverture. En headless, sans cette phrase, PORTFOLIO est VIDE.
//
// Le danger n'est pas l'échec : c'est le SUCCÈS SILENCIEUX. `compute({})` ne lève pas
// forcément — il produirait un patrimoine proche de zéro, que ce script écrirait dans une table
// APPEND-ONLY. L'historique patrimonial serait corrompu de façon irréversible, une ligne par nuit.
//
// On refuse donc d'écrire tant que les données ne sont pas là. Pour rétablir le cron :
//   1. ajouter le secret NW_PASSPHRASE dans les paramètres du dépôt,
//   2. l'exposer au job dans .github/workflows/daily-snapshot.yml (env: NW_PASSPHRASE),
//   et ce script déchiffrera le blob de lui-même.
async function garantirDonnees() {
  const vide = !PORTFOLIO || !PORTFOLIO.amine || Object.keys(PORTFOLIO.amine || {}).length === 0;
  if (!vide) return;

  const phrase = process.env.NW_PASSPHRASE;
  if (!phrase) {
    console.error('[cron-snap] ✗ données chiffrées et NW_PASSPHRASE absent — AUCUNE écriture.');
    console.error('             Un snapshot calculé sur des données vides corromprait');
    console.error('             définitivement l\'historique (table append-only).');
    console.error('             Ajouter le secret NW_PASSPHRASE au workflow pour rétablir le cron.');
    process.exit(1);
  }
  const encSrc = await readFile(join(ROOT, 'js', 'data.enc.js'), 'utf8');
  let blocs;
  try {
    blocs = await dechiffreBlobs(encSrc, phrase);
  } catch (e) {
    console.error('[cron-snap] ✗ déchiffrement impossible (phrase erronée ?) — AUCUNE écriture.');
    process.exit(1);
  }
  // Remplissage EN PLACE, comme js/unlock.js côté navigateur : les objets importés par le moteur
  // (PORTFOLIO, FX_STATIC, et les 11 autres blocs) sont les mêmes références.
  const mod = await import(pathToFileURL(join(tmp, 'data.js')).href);
  remplirEnPlace(mod, blocs);
  console.log('[cron-snap] ✓ données déchiffrées (' + Object.keys(blocs).length + ' blocs)');
}
await garantirDonnees();

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

// ── 6. INSERT append-only — authentification de transition (scripts/_snapshot_auth.mjs) ──
// Secret serveur `sb_secret_…` valide (NW_SUPABASE_SECRET_KEY) → utilisé immédiatement, même en
//   v544, dans l'en-tête `apikey` SEUL (ce n'est pas un JWT, jamais de Bearer). C'est ce qui permet
//   de fermer la RLS avant le déploiement v545 sans interrompre le cron.
// Pas de secret valide : v544 → repli temporaire sur la clé publishable (chemin historique) ;
//   v545+ → échec FERMÉ, aucune écriture.
// Le secret arrive par l'environnement GitHub Actions, JAMAIS dans js/ ni dans un fichier suivi, et
// n'est jamais imprimé.
const SUPA = 'https://mjbmtubkhlspwfqhqgvq.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_V_Xa4lXSCnobfUT940sktA_EU7I2PQO';   // publique par design
const snapDate = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
if (DRY) { console.log('[cron-snap] DRY RUN — insert sauté. Blob:', JSON.stringify(snap).length, 'octets, date', snapDate); process.exit(0); }
let auth;
try {
  auth = resolveSnapshotWriteAuth({
    appVersion: APP_VERSION,
    secretKey: process.env.NW_SUPABASE_SECRET_KEY,
    publishableKey: PUBLISHABLE_KEY,
  });
} catch (e) {
  console.error('[cron-snap] ✗ ' + (e && e.message) + ' — AUCUNE écriture (échec fermé).');
  console.error('             Créer le secret dépôt NW_SUPABASE_SECRET_KEY (clé serveur sb_secret_…) et l\'exposer au job.');
  process.exit(1);
}
if (auth.warning) console.warn('[cron-snap] ⚠ ' + auth.warning);
console.log('[cron-snap] écriture en mode « ' + auth.mode + ' » (version ' + APP_VERSION + ')');
const res = await fetch(SUPA + '/rest/v1/nw_snapshots', {
  method: 'POST',
  headers: auth.headers,
  body: JSON.stringify({ snap_date: snapDate, quality, data: snap }),
  signal: AbortSignal.timeout(15000),
});
if (!res.ok) { console.error('[cron-snap] insert HTTP', res.status, await res.text()); process.exit(1); }
console.log('[cron-snap] ✅ snapshot', snapDate, '(' + quality + ') inséré — NW', snap.total.couple, '€');
