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
// ── FAITS BRUTS (v393) : immo, créances, TVA, facturation, véhicules, montres ──
// « Chiffres de base » de chaque version — JAMAIS les NW calculés (bugs passés).
// Bloc à accolades équilibrées (les blocs immo/créances contiennent des sous-objets).
function _block(text, startRe) {
  const m = text.match(startRe);
  if (!m) return null;
  let i = text.indexOf('{', m.index); if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < text.length && j < i + 20000; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') { depth--; if (depth === 0) return text.slice(i, j + 1); }
  }
  return null;
}
const _num = (blk, key) => { const m = (blk || '').match(new RegExp('\\b' + key + '\\s*:\\s*(-?[0-9][0-9_ .]*)')); if (!m) return null; const v = parseFloat(m[1].replace(/[_ ]/g, '')); return isFinite(v) ? v : null; };
const _sumNums = (blk) => { let s = 0, any = false; for (const m of (blk || '').matchAll(/\b[a-zA-Z_]+\s*:\s*(-?[0-9][0-9_ .]*)/g)) { const v = parseFloat(m[1].replace(/[_ ]/g, '')); if (isFinite(v)) { s += v; any = true; } } return any ? s : null; };

function extractFacts(text, parts) {
  const f = {};
  const vitry = _block(parts.amine, /\bvitry\s*:\s*\{/);
  if (vitry) { f['vitry.value'] = _num(vitry, 'value'); f['vitry.crd'] = _num(vitry, 'crd'); }
  const rueil = _block(parts.nezha, /\brueil\s*:\s*\{/);
  if (rueil) { f['rueil.value'] = _num(rueil, 'value'); f['rueil.crd'] = _num(rueil, 'crd'); }
  const vj = _block(parts.nezha, /\bvillejuif\s*:\s*\{/);
  if (vj) {
    f['villejuif.value'] = _num(vj, 'value'); f['villejuif.crd'] = _num(vj, 'crd');
    f['villejuif.reservation'] = _num(vj, 'reservationFees');
    const sg = vj.match(/\bsigned\s*:\s*(true|false)/); if (sg) f['villejuif.signed'] = sg[1] === 'true' ? 1 : 0;
  }
  f['tva'] = _num(parts.amine, 'tva');
  f['cautionRueil'] = _num(parts.nezha, 'cautionRueil');
  f['vehicles'] = _sumNums(_block(parts.amine, /\bvehicles\s*:\s*\{/));
  f['watches'] = _sumNums(_block(parts.nezha, /\bwatches\s*:\s*\{/));
  const aug = _block(text, /\baugustin\s*:\s*\{/), ben = _block(text, /\bbenoit\s*:\s*\{/);
  if (aug) f['factu.augustin'] = _num(aug, 'amount');
  if (ben) f['factu.benoit'] = _num(ben, 'amount');
  // Créances : items[] = objets AVEC tableaux imbriqués (payments) et SANS champ id.
  // Identité = code INVSNT du label si présent, sinon slug du label (avant '('), préfixé
  // par la section (a_/n_) — l'anonymisation pour la table publique se fait à l'injection.
  let searchFrom = 0;
  while (true) {
    const ci = text.slice(searchFrom).search(/\bcreances\s*:\s*\{/);
    if (ci < 0) break;
    const absIdx = searchFrom + ci;
    const creBlock = _block(text.slice(absIdx), /\bcreances\s*:\s*\{/);
    searchFrom = absIdx + 10;
    if (!creBlock) continue;
    const owner = absIdx >= (parts.amine.length) ? 'n' : 'a';
    const ai = creBlock.search(/\bitems\s*:\s*\[/);
    if (ai < 0) continue;
    // Découpe les objets top-level du tableau items par accolades équilibrées
    let depth = 0, start = -1;
    const bracket = creBlock.indexOf('[', ai);
    for (let j = bracket; j < creBlock.length; j++) {
      const ch = creBlock[j];
      if (ch === '{') { if (depth === 0) start = j; depth++; }
      else if (ch === '}') { depth--; if (depth === 0 && start >= 0) {
        const it = creBlock.slice(start, j + 1);
        const lm = it.match(/\blabel\s*:\s*'([^']+)'/);
        if (lm) {
          const label = lm[1];
          const idm = it.match(/\bid\s*:\s*'([^']+)'/); // versions récentes : id stable explicite
          const inv = label.match(/INVSNT\d+/i);
          const key = owner + '_' + (idm ? idm[1].toLowerCase()
            : inv ? inv[0].toLowerCase()
            : label.split('(')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24));
          const amount = _num(it, 'amount');
          if (amount != null) {
            // remaining = amount − Σ payments (même devise supposée)
            let paid = 0;
            const payTxt = (it.match(/\bpayments\s*:\s*\[([\s\S]*?)\]/) || [])[1] || '';
            for (const pm of payTxt.matchAll(/\bamount\s*:\s*(-?[0-9][0-9_ .]*)/g)) { const v = parseFloat(pm[1].replace(/[_ ]/g, '')); if (isFinite(v)) paid += v; }
            const st = it.match(/\bstatus\s*:\s*'([^']+)'/);
            const cc = it.match(/\bcurrency\s*:\s*'([^']+)'/);
            const ty = it.match(/\btype\s*:\s*'([^']+)'/);
            f['cre.' + key + '.amount'] = Math.max(0, amount - paid);
            f['cre.' + key + '.recovered'] = st && /recouvr|rembours/i.test(st[1]) ? 1 : 0;
            f['cre.' + key + '.prob'] = _num(it, 'probability');
            if (cc) f['cre.' + key + '.ccy'] = cc[1];
            if (ty) f['cre.' + key + '.type'] = ty[1];
          }
        }
        start = -1;
      } }
      else if (ch === ']' && depth === 0) break;
    }
  }
  return f;
}

function gitObservations() {
  gitObservations._allCre = new Set();
  const sh = (cmd) => execSync(cmd, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
  const commits = sh("git log --follow --reverse --format='%H %ad' --date=short -- js/data.js")
    .trim().split('\n').map(l => { const [sha, date] = l.split(' '); return { sha, date }; });
  const cashByDay = {}, factByDay = {};
  for (const { sha, date } of commits) {
    let text; try { text = sh('git show ' + sha + ':js/data.js'); } catch (e) { continue; }
    const idx = text.search(/\bnezha\s*:\s*\{/);
    const parts = { amine: idx > 0 ? text.slice(0, idx) : text, nezha: idx > 0 ? text.slice(idx) : '' };
    for (const [id, spec] of Object.entries(CASH_SPEC)) {
      for (const key of spec.keys) {
        const m = parts[spec.s].match(new RegExp('\\b' + key + '\\s*:\\s*(-?[0-9][0-9_ .]*)'));
        if (m) { const v = parseFloat(m[1].replace(/[_ ]/g, '')); if (isFinite(v)) { (cashByDay[id] = cashByDay[id] || {})[date] = v; } break; }
      }
    }
    const facts = extractFacts(text, parts);
    for (const [path, v] of Object.entries(facts)) {
      if (v == null) continue;
      (factByDay[path] = factByDay[path] || {})[date] = v;
    }
    // Présence des créances : une clé déjà vue mais ABSENTE de ce commit = créance retirée
    // (restructurée/supprimée) → sa série doit S'ARRÊTER, pas être forward-fillée à jamais.
    const seenNow = new Set(Object.keys(facts).filter(k => k.startsWith('cre.') && k.endsWith('.amount')).map(k => k.split('.')[1]));
    for (const k of seenNow) gitObservations._allCre.add(k);
    for (const k of gitObservations._allCre) {
      (factByDay['cre.' + k + '.present'] = factByDay['cre.' + k + '.present'] || {})[date] = seenNow.has(k) ? 1 : 0;
    }
  }
  const mkSeries = (byDay) => {
    const series = {};
    for (const [id, days] of Object.entries(byDay)) {
      const obs = [];
      for (const d of Object.keys(days).sort()) {
        if (obs.length === 0 || obs[obs.length - 1].native !== days[d]) obs.push({ date: d, native: days[d] });
      }
      series[id] = obs;
    }
    return series;
  };
  return { cash: mkSeries(cashByDay), facts: mkSeries(factByDay) };
}
const _OBS = gitObservations();
const CASH_OBS = _OBS.cash, FACT_OBS = _OBS.facts;

// ── v395 — SÉRIES BANCAIRES EXACTES (extraites de l'e-banking, committées dans data/) ──
// Priorité sur l'escalier git : la banque donne le solde comptable QUOTIDIEN officiel.
// data/awb_balance_YYYYMMDD.json = extrait brut Attijarinet (graphe « Evolution of the balance »).
const BANK_EXACT = {}; // accountId → [{date, native}]
try {
  const { readdirSync } = await import('node:fs');
  for (const fn of readdirSync(join(ROOT, 'data'))) {
    if (!/^[a-z0-9]+_balance_\d+\.json$/.test(fn)) continue;
    const j = JSON.parse(await readFile(join(ROOT, 'data', fn), 'utf8'));
    const obs = j.series.split(',').map(s => { const [d, v] = s.split(':'); return { date: d, native: parseFloat(v) }; });
    const id = j.account;
    BANK_EXACT[id] = [...(BANK_EXACT[id] || []), ...obs].sort((a, b) => a.date.localeCompare(b.date));
    console.log('[bank-exact]', fn, '→', id, ':', obs.length, 'soldes quotidiens officiels (' + obs[0].date + ' → ' + obs[obs.length - 1].date + ')');
  }
} catch (e) { console.warn('[bank-exact] lecture échouée:', e.message); }
const bankExactAt = (id, d) => {
  const obs = BANK_EXACT[id];
  if (!obs || !obs.length || d < obs[0].date || d > obs[obs.length - 1].date) return null; // hors fenêtre → escalier git
  let v = null; for (const o of obs) { if (o.date <= d) v = o.native; else break; }
  return v;
};
const factAt = (path, d) => { let v = null; for (const o of FACT_OBS[path] || []) { if (o.date <= d) v = o.native; else break; } return v; };
console.log('[facts-git]', Object.keys(FACT_OBS).length, 'séries de faits bruts (immo/créances/tva/factu/véhicules/montres)');
const _creKeys = [...new Set(Object.keys(FACT_OBS).filter(k => k.startsWith('cre.')).map(k => k.split('.')[1]))];
console.log('[facts-git] clés créances découvertes :', _creKeys.join(', '));

// Clés d'extraction (slugs historiques avec prénoms) → ids publics ANONYMES (= ids data.js,
// normalisés lowercase comme dans buildDailySnapshot). Clé inconnue ⇒ sautée + warn (aucune
// fuite de prénom dans la table publique).
const CRE_ALIAS = {
  a_invsnt001: 'invsnt001', a_invsnt002: 'invsnt002', a_invsnt003: 'invsnt003',
  a_invsnt004: 'invsnt004', a_invsnt005: 'invsnt005', a_invsnt006: 'invsnt006',
  a_malt_frais_deplacement_nz: 'creb01', a_malt_frais_deplacement: 'creb01', a_malt: 'creb01',
  a_loyers_impayes: 'creb02', a_loyers_impayes_janv_fev: 'creb02',
  a_kenza: 'crep01', a_abdelkader: 'crep02', a_mehdi: 'crep03', a_mehdi_avance: 'crep04',
  a_akram: 'crep05', a_anas: 'crep06',
  a_sap_tax: 'creb00',                                     // agrégat SAP & Tax pré-numérotation INVSNT
  a_loyer_impay_u00e9: 'creb02', a_loyers_impay_u00e9s: 'creb02', // vieux labels avec échappements \u00e9
  a_malt_frais_deplacement_n: 'creb01',                    // slug tronqué à 24 chars
  n_omar: 'cren01',
  a_creb01: 'creb01', a_creb02: 'creb02', a_crep01: 'crep01', a_crep02: 'crep02',
  a_crep03: 'crep03', a_crep04: 'crep04', a_crep05: 'crep05', n_cren01: 'cren01',
};
const _unaliased = _creKeys.filter(k => !CRE_ALIAS[k] && !/invsnt/.test(k));
if (_unaliased.length) console.warn('[facts-git] ⚠ clés créances SANS alias (sautées, à mapper) :', _unaliased.join(', '));
const _pubOf = (k) => CRE_ALIAS[k] || (/invsnt/.test(k) ? k.replace(/^[an]_/, '') : null);
const CRE_PUB_IDS = [...new Set(_creKeys.map(_pubOf).filter(Boolean))];
const CRE_KEYS_BY_PUB = {}; _creKeys.forEach(k => { const pid = _pubOf(k); if (pid) (CRE_KEYS_BY_PUB[pid] = CRE_KEYS_BY_PUB[pid] || []).push(k); });
function crePresentAt(pubId, d) {
  let bestDate = ''; const atBest = [];
  for (const k of CRE_KEYS_BY_PUB[pubId] || []) {
    for (const o of FACT_OBS['cre.' + k + '.present'] || []) {
      if (o.date > d) break;
      if (o.date > bestDate) { bestDate = o.date; atBest.length = 0; }
      if (o.date === bestDate) atBest.push(o.native);
    }
  }
  return atBest.length === 0 ? null : (atBest.some(v => v === 1) ? 1 : 0);
}
function creFactAt(pubId, field, d) {
  let best = null, bestDate = '';
  for (const k of CRE_KEYS_BY_PUB[pubId] || []) {
    for (const o of FACT_OBS['cre.' + k + '.' + field] || []) {
      if (o.date <= d && o.date >= bestDate) { best = o.native; bestDate = o.date; }
      if (o.date > d) break;
    }
  }
  return best;
}
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
// V6 : dernières observations des FAITS == data.js HEAD
const _lastFact = (p) => { const o = FACT_OBS[p] || []; return o.length ? o[o.length - 1].native : null; };
const FACT_CHECK = [
  ['vitry.value', PORTFOLIO.amine.immo.vitry.value], ['vitry.crd', PORTFOLIO.amine.immo.vitry.crd],
  ['rueil.value', PORTFOLIO.nezha.immo.rueil.value], ['rueil.crd', PORTFOLIO.nezha.immo.rueil.crd],
  ['villejuif.signed', PORTFOLIO.nezha.immo.villejuif.signed ? 1 : 0],
  ['tva', PORTFOLIO.amine.tva],
  ['vehicles', Object.values(PORTFOLIO.amine.vehicles).reduce((s, v) => s + v, 0)],
  ['factu.augustin', PORTFOLIO.amine.facturation.augustin.amount],
];
for (const [p, expect] of FACT_CHECK) {
  const lastV = _lastFact(p);
  console.log('[V6]', p.padEnd(18), 'dernière obs', lastV, 'vs HEAD', expect, lastV === expect ? '✓' : '✗');
  if (lastV !== expect) { console.error('[V6] ÉCHEC — mapping à corriger'); process.exit(1); }
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
    const exact = bankExactAt(id, d);
    const native = exact != null ? exact : cashAt(id, d);
    if (native == null) continue;
    const fxv = fxAt(spec.ccy, d);
    if (!(fxv > 0)) continue;
    accounts[id] = { eur: Math.round(native / fxv), native, ccy: spec.ccy, owner: spec.owner, ...(exact != null ? { exact: true } : { est: true }) };
  }
  // Faits bruts observés via git (v393) : immo, autres actifs, créances — escalier
  const properties = {};
  for (const pid of ['vitry', 'rueil', 'villejuif']) {
    const value = factAt(pid + '.value', d), crd = factAt(pid + '.crd', d);
    if (value == null && crd == null) continue;
    const p = { est: true };
    if (value != null) p.value = Math.round(value);
    if (crd != null) p.crd = Math.round(crd);
    if (pid === 'villejuif') {
      const signed = factAt('villejuif.signed', d) === 1;
      p.signed = signed;
      const resv = factAt('villejuif.reservation', d);
      if (!signed && resv != null) p.reservation = Math.round(resv);
      if (signed && value != null && crd != null) p.equityGross = Math.round(value - crd);
    } else if (value != null && crd != null) {
      p.equityGross = Math.round(value - crd); // arithmétique sur faits bruts, pas le NW calculé
    }
    properties[pid] = p;
  }
  const autres = {};
  const veh = factAt('vehicles', d); if (veh != null) autres.vehicles = Math.round(veh);
  const wat = factAt('watches', d); if (wat != null) autres.watches = Math.round(wat);
  const tva = factAt('tva', d); if (tva != null) autres.tva = Math.round(tva);
  const caution = factAt('cautionRueil', d); if (caution != null) autres.cautionRueil = -Math.round(caution); // négatif (dette), convention live
  const aug = factAt('factu.augustin', d), ben = factAt('factu.benoit', d);
  const madFx = fxAt('MAD', d);
  if (aug != null && ben != null && madFx > 0) autres.facturation = Math.round((aug + ben) / madFx);
  // Créances actives (statut ≠ recouvré) : série qui naît à l'apparition, meurt au recouvrement
  const creanceItems = {}; let crePro = 0, crePerso = 0, hasCre = false;
  for (const pubId of CRE_PUB_IDS) {
    const amount = creFactAt(pubId, 'amount', d);
    if (amount == null || creFactAt(pubId, 'recovered', d) === 1) continue;
    if (crePresentAt(pubId, d) === 0) continue; // créance retirée de data.js → série terminée
    const ccy = creFactAt(pubId, 'ccy', d) || 'EUR';
    const cfx = fxAt(typeof ccy === 'string' ? ccy : 'EUR', d);
    if (!(cfx > 0)) continue;
    const eur = Math.round(amount / cfx);
    const prob = creFactAt(pubId, 'prob', d);
    creanceItems[pubId] = { eur, est: true, ...(prob != null ? { prob, expected: Math.round(eur * prob) } : {}) };
    hasCre = true;
    const weighted = prob != null ? eur * prob : eur;
    if (creFactAt(pubId, 'type', d) === 'perso') crePerso += weighted; else crePro += weighted;
  }
  if (hasCre) { autres.creancesPro = Math.round(crePro); autres.creancesPerso = Math.round(crePerso); }

  const data = { schema: 1, stocks, meta: { backfill: true, method: 'parts(J,trades/lots) × clôture(J,store) × FX(J) ; cash+immo+créances+autres = observations git data.js (escalier)', appVersion: 'backfill-v393' } };
  if (Object.keys(accounts).length > 0) data.cash = { accounts };
  if (Object.keys(properties).length > 0) data.immo = { properties };
  if (Object.keys(autres).length > 0) data.autres = autres;
  if (hasCre) data.creances = { items: creanceItems };
  if (Object.keys(positions).length === 0 && Object.keys(accounts).length === 0 && Object.keys(properties).length === 0) continue;
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
