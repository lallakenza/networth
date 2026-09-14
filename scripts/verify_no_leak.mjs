#!/usr/bin/env node
/**
 * verify_no_leak.mjs — le dépôt/le site public expose-t-il des données patrimoniales sans
 * authentification ? (item 1)
 *
 *   node scripts/verify_no_leak.mjs                 # fichiers LOCAUX du dépôt
 *   node scripts/verify_no_leak.mjs --prod          # fichiers SERVIS par la production
 *   node scripts/verify_no_leak.mjs --prod --url https://…/networth/
 *
 * Contrôle, sur js/data.js et index.html :
 *   1. les 13 blocs sensibles sont des COQUILLES VIDES (chiffrement actif) ;
 *   2. aucun motif de donnée privée (soldes nominatifs, contreparties, adresses, IBAN, n° de compte) ;
 *   3. aucun montant patrimonial codé en dur dans le DOM initial (attributs data-eur non nuls).
 *
 * Le contrôle du DOM rendu et des requêtes réseau EN SESSION ANONYME se fait en complément avec un
 * navigateur (la page ne s'exécute pas ici) — voir la procédure de vérification de version.
 *
 * Sort en échec (code 1) si une fuite subsiste : tant que ce script échoue, le chantier n'est PAS
 * terminé.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOMS_SENSIBLES } from './_blocs_sensibles.mjs';

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
const PROD = process.argv.includes('--prod');
const iUrl = process.argv.indexOf('--url');
const BASE = iUrl > -1 ? process.argv[iUrl + 1].replace(/\/$/, '') : 'https://lallakenza.github.io/networth';

async function lire(rel) {
  if (!PROD) return readFileSync(join(RACINE, rel), 'utf-8');
  const r = await fetch(BASE + '/' + rel + '?cb=' + Date.now());
  if (!r.ok) throw new Error('HTTP ' + r.status + ' sur ' + rel);
  return r.text();
}

const MOTIFS = [
  ['revenu hors bail',    new RegExp('esp' + '[eè]ces|non d' + '[ée]clar|loyer' + 'Cash|parking' + 'CashVoisin', 'i')],
  ['adresse de bien',     new RegExp('Nathalie ' + 'Lemel|Maxime ' + 'Gorki|des ' + 'Glycines|Léon ' + 'Geffroy', 'i')],
  ['IBAN',                new RegExp('\\bFR\\d{2}(?: ?\\d{4}){2,}')],
  ['numéro de compte',    new RegExp('#\\d{9,}')],
];

let ko = 0;
const echec = (m) => { ko++; console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

const data = await lire('js/data.js');
const html = await lire('index.html');
console.log((PROD ? 'PRODUCTION ' + BASE : 'FICHIERS LOCAUX') + '\n');

// 1. Coquilles vides
for (const nom of NOMS_SENSIBLES) {
  const m = data.match(new RegExp('export const ' + nom + '\\s*=\\s*([\\s\\S]{0,30})'));
  const vide = m && /^(\{\s*\}|\[\s*\])\s*;/.test(m[1].trim());
  if (vide) continue;
  echec('bloc « ' + nom + ' » PRÉSENT EN CLAIR dans js/data.js (doit être une coquille vide)');
}
if (ko === 0) ok('les 13 blocs sensibles sont des coquilles vides');

// 2. Motifs privés
for (const [nom, re] of MOTIFS) {
  const hit = data.match(re) || html.match(re);
  if (hit) echec('motif « ' + nom + ' » trouvé : …' + hit[0] + '…');
}

// 3. Montants dans le DOM initial
const durs = [...html.matchAll(/data-eur="([0-9]{3,})"/g)].filter((m) => m[1] !== '0');
if (durs.length) echec(durs.length + ' attribut(s) data-eur non nuls dans le DOM initial : ' + durs.slice(0, 4).map((m) => m[1]).join(', '));
else ok('aucun montant codé en dur dans le DOM initial');

console.log('');
if (ko === 0) { console.log('✅ Aucune fuite : les données patrimoniales ne sont pas exposées sans authentification.'); process.exit(0); }
console.log('❌ ' + ko + ' fuite(s). Données patrimoniales accessibles sans authentification — chantier NON terminé.');
console.log('   Activer le chiffrement : node scripts/enable_encryption.mjs  (voir docs/CHIFFREMENT_DONNEES.md)');
process.exit(1);
