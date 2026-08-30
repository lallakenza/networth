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
//
// DEPUIS LE CHIFFREMENT (v496) : `js/data.js` ne contient plus les blocs personnels — ils sont
// dans `js/data.enc.js`, illisible sans la phrase. Le détecteur lit donc la SOURCE en clair
// gardée hors du dépôt. Sans elle, il ne peut rien vérifier et le dit au lieu de planter sur
// un `PORTFOLIO` vide (ce qui se lisait comme une panne du détecteur, pas comme une absence
// de données). Voir docs/CHIFFREMENT_DONNEES.md.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_CLAIR = process.env.NW_DATA_SOURCE
  || join(dirname(repoRoot), 'networth-data', 'data.source.js');

const tmp = mkdtempSync(join(tmpdir(), 'nw-desync-'));
for (const file of ['data.js', 'engine.js']) {
  // data.js est un fichier coquille depuis le chiffrement : on lui substitue la source en clair.
  const origine = (file === 'data.js' && existsSync(SOURCE_CLAIR))
    ? SOURCE_CLAIR
    : join(repoRoot, 'js', file);
  const src = readFileSync(origine, 'utf8').replace(/\?v=\d+/g, '');
  writeFileSync(join(tmp, file), src);
}
const { PORTFOLIO, FX_STATIC } = await import(pathToFileURL(join(tmp, 'data.js')).href);
const { compute } = await import(pathToFileURL(join(tmp, 'engine.js')).href);

// Garde-fou : sans données, tous les écarts valent 0 et le détecteur annoncerait « tout
// concorde » — un faux négatif silencieux, exactement ce qu'il est censé empêcher.
if (!PORTFOLIO || !PORTFOLIO.amine || !PORTFOLIO.amine.ibkr) {
  console.error('✗ Données absentes : js/data.js est chiffré et la source en clair est introuvable.');
  console.error(`  Attendue ici : ${SOURCE_CLAIR}`);
  console.error('  Renseigne NW_DATA_SOURCE, ou lance ce script depuis une machine qui a la source.');
  process.exit(2);
}

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

// 6. v458 — Critères d'acceptation VITRY (bail réel 26/08/2026)
//    AC-2 : revenus déclarés 2026 = 425,81 + 600 + 600 = 1 625,81 € (prorata dès le 10/10)
//    AC-8 : impôt 2027 calculé par le moteur dans [350 ; 480] €
const fcV = s.immoView && s.immoView.vitryImpotForecast;
if (!fcV) findings.push({ name: 'AC — vitryImpotForecast absent', a: 0, b: 1, gap: 1 });
else {
  const l26 = fcV.lignes.find((l) => l.annee === 2026);
  const l27 = fcV.lignes.find((l) => l.annee === 2027);
  if (!l26 || Math.abs(l26.revenus - 1625.81) > 0.02)
    findings.push({ name: 'AC-2 — revenus déclarés vitry 2026 != 1625.81', a: l26 ? l26.revenus : 0, b: 1625.81, gap: l26 ? l26.revenus - 1625.81 : 1625.81 });
  if (!l27 || l27.impot < 350 || l27.impot > 480)
    findings.push({ name: 'AC-8 — impot vitry 2027 hors [350;480]', a: l27 ? l27.impot : 0, b: 415, gap: l27 ? l27.impot - 415 : 415 });
}
// AC-5 (structure) : vitry pre-bail = 0 revenu ; post-bail = 700 CC (+ part especes suivie)
const pV = s.immoView && s.immoView.properties && s.immoView.properties.find((p) => p.loanKey === 'vitry');
if (pV && pV.bail && pV.bail.debut) {
  const attendu = (new Date().toISOString().slice(0, 10) >= pV.bail.debut) ? (600 + 100 + 500 + (pV.parking || 0)) : (1200 + (pV.parking || 0));   // v465 — pré-bail : 1 200 espèces + parking
  chk('AC-5 — totalRevenue vitry conforme au bail', pV.totalRevenue, attendu);
}

// ── Identité du module de données (v501) ──────────────────────────────────────
// Les modules ES sont indexés par URL RÉSOLUE : './data.js' et './data.js?v=501' sont deux
// modules distincts, donc deux objets PORTFOLIO distincts. unlock.js importait la première
// forme et remplissait un orphelin : le déverrouillage réussissait et le tableau de bord
// restait vide, sans la moindre erreur (v496 → v500). Rien dans la chaîne de vérification ne
// pouvait l'attraper — les tests headless copient les fichiers en retirant les `?v=N`, ce qui
// fait justement disparaître le défaut. D'où ce contrôle purement textuel.
{
  const { readdirSync } = await import('node:fs');
  const dossierJs = join(repoRoot, 'js');
  const specificateurs = new Map();
  for (const f of readdirSync(dossierJs).filter((x) => x.endsWith('.js'))) {
    // Les commentaires sont retirés d'abord : l'en-tête de unlock.js cite littéralement
    // `from './data.js'` en prose pour expliquer le mécanisme, ce qui déclencherait l'alerte
    // sur un fichier pourtant correct.
    const src = readFileSync(join(dossierJs, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    for (const m of src.matchAll(/(?:from|import\()\s*['"](\.\/data(?:\.enc)?\.js[^'"]*)['"]/g)) {
      if (!specificateurs.has(m[1])) specificateurs.set(m[1], []);
      specificateurs.get(m[1]).push(f);
    }
  }
  const versDataJs = [...specificateurs.entries()].filter(([s]) => !s.includes('.enc.'));
  if (versDataJs.length > 1) {
    console.error('✗ IDENTITÉ DU MODULE DE DONNÉES ROMPUE — plusieurs URL pour js/data.js :');
    for (const [spec, fichiers] of versDataJs) console.error(`    ${spec}  ←  ${fichiers.join(', ')}`);
    console.error('  Ces modules recevront des objets PORTFOLIO DIFFÉRENTS. Le déchiffrement');
    console.error('  remplira l\'un et les vues liront l\'autre : tableau de bord vide, sans erreur.');
    console.error('  Corriger : un seul et même suffixe ?v=N partout.');
    process.exit(1);
  }
  const sansVersion = [...specificateurs.keys()].filter((s) => !/\?v=\d+/.test(s));
  if (sansVersion.length) {
    console.error('✗ Import de données sans suffixe ?v=N :', sansVersion.join(', '));
    console.error('  Le cache (service worker inclus) ne sera jamais invalidé pour ce fichier.');
    process.exit(1);
  }
  console.log('[check] Module de données unique ✓ (' + [...specificateurs.keys()].join(' + ') + ')');
}

console.log('══════ DÉTECTION DE DESYNCS D\'AFFICHAGE ══════\n');
if (!findings.length) console.log('✅ Aucun desync (agrégats cohérents, tol €' + TOL + ')');
else { console.log('❌ ' + findings.length + ' DESYNC(S) :'); findings.forEach((x) => console.log('  ✗ ' + x.name + ' → écart ' + f(x.gap) + '€ [' + f(x.a) + ' vs ' + f(x.b) + ']')); }
if (warns.length) { console.log('\n⚠ ' + warns.length + ' catégorie(s) total ≠ Σsous-items :'); warns.forEach((x) => console.log('  · [' + x.nm + '] ' + x.label + ' : total ' + f(x.total) + ' vs Σsub ' + f(x.ss))); }
process.exit(findings.length || warns.length ? 1 : 0);
