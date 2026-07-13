#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Détecteur de desyncs d'affichage (v359, BUG-064)
//
// Vérifie que les MÊMES valeurs conceptuelles affichées à plusieurs endroits
// concordent — c.-à-d. attrape le cas « NW en haut de page ≠ NW en bas » causé
// par un compte ajouté au NW mais oublié dans une des vues (piège « 9+ emplacements »).
//
// Usage :  node scripts/detect_desyncs.mjs
// Exit 0 si tout concorde, 1 sinon (utilisable en pré-push / CI).
//
// Auto-suffisant : lit js/data.js + js/engine.js, retire les suffixes de
// cache-busting `?v=N` (invalides pour un import Node), importe et exécute compute().
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'nw-desync-'));
for (const file of ['data.js', 'engine.js']) {
  const src = readFileSync(join(repoRoot, 'js', file), 'utf8').replace(/\?v=\d+/g, '');
  writeFileSync(join(tmp, file), src);
}
const { PORTFOLIO, FX_STATIC } = await import(pathToFileURL(join(tmp, 'data.js')).href);
const { compute } = await import(pathToFileURL(join(tmp, 'engine.js')).href);

const s = compute(PORTFOLIO, { ...FX_STATIC }, 'static');
const f = (x) => Math.round(x).toLocaleString('fr-FR');
const TOL = 2;
const findings = [];
const warns = [];
const chk = (name, a, b) => { if (Math.abs(a - b) > TOL) findings.push({ name, gap: a - b, a, b }); };
const sumCat = (arr) => (arr || []).reduce((acc, c) => acc + (c ? c.total : 0), 0);

// 1. NW par vue = Σ de ses catégories (le bug reporté : haut vs bas de page)
chk('amine.nw = Σ amineCategories', s.amine.nw, sumCat(s.amineCategories));
chk('nezha.nw = Σ nezhaCategories', s.nezha.nw, sumCat(s.nezhaCategories));
chk('couple.nw = Σ coupleCategories', s.couple.nw, sumCat(s.coupleCategories));
// 2. Invariant treemap par vue
for (const v of ['couple', 'amine', 'nezha']) {
  const w = s.views[v];
  chk(`views.${v} stocks+cash+immo+other = nwRef`, w.stocks.val + w.cash.val + w.immo.val + w.other.val, w.nwRef);
}
// 3. Additivité couple = amine + nezha
chk('couple.nw = amine.nw + nezha.nw', s.couple.nw, s.amine.nw + s.nezha.nw);
chk('couple.other = amine.other + nezha.other', s.views.couple.other.val, s.views.amine.other.val + s.views.nezha.other.val);
// 4. Pools (simulateur) : actions+cash = liquide Amine (stocks+cash de la vue)
if (s.pools) chk('pools.actions+cash = views.amine (stocks+cash)', s.pools.actions + s.pools.cash, s.views.amine.stocks.val + s.views.amine.cash.val);
// 5. Chaque catégorie : total = Σ sous-items (piège : sous-item hors total, ou l'inverse)
for (const [nm, arr] of [['couple', s.coupleCategories], ['amine', s.amineCategories], ['nezha', s.nezhaCategories]]) {
  (arr || []).forEach((c) => {
    if (!c || !c.sub || !c.sub.length) return;
    const ss = c.sub.reduce((a, x) => a + (x.val || 0), 0);
    if (Math.abs(c.total - ss) > TOL) warns.push({ nm, label: c.label, total: c.total, ss });
  });
}

console.log('══════ DÉTECTION DE DESYNCS D\'AFFICHAGE ══════\n');
if (!findings.length) console.log('✅ Aucun desync (agrégats cohérents, tol €' + TOL + ')');
else { console.log('❌ ' + findings.length + ' DESYNC(S) :'); findings.forEach((x) => console.log('  ✗ ' + x.name + ' → écart ' + f(x.gap) + '€ [' + f(x.a) + ' vs ' + f(x.b) + ']')); }
if (warns.length) { console.log('\n⚠ ' + warns.length + ' catégorie(s) total ≠ Σsous-items :'); warns.forEach((x) => console.log('  · [' + x.nm + '] ' + x.label + ' : total ' + f(x.total) + ' vs Σsub ' + f(x.ss))); }
process.exit(findings.length || warns.length ? 1 : 0);
