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
 * Avec --prod, contrôle aussi la base Neon EN SESSION ANONYME (v591) :
 *   4. snapshots nw_snapshots lisibles en clair (patrimoine daté) ;
 *   5. référentiel immo : champs de revenus hors bail et valeurs de biens lisibles.
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
  // Cinq groupes de quatre chiffres au minimum : un IBAN français fait 27 caractères, alors qu'un
  // code ISIN français (FR0000121014, référence de marché publique) n'en a que 12.
  ['IBAN',                new RegExp('\\bFR\\d{2}(?: ?\\d{4}){5,}')],
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

// 4-6. Base Neon, lue comme n'importe quel visiteur (jeton anonyme, sans compte)
if (PROD) {
  const NEON = 'https://ep-green-mountain-b91jna2h.apirest.c-7.eu-central-1.aws.neon.tech/neondb/rest/v1';
  const AUTH = 'https://ep-green-mountain-b91jna2h.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth';
  try {
    const j = await fetch(AUTH + '/token/anonymous', { signal: AbortSignal.timeout(20000) });
    if (!j.ok) throw new Error('jeton anonyme HTTP ' + j.status);
    const H = { Authorization: 'Bearer ' + (await j.json()).token };
    const get = async (q) => { const r = await fetch(NEON + q, { headers: H, signal: AbortSignal.timeout(20000) }); return r.ok ? r.json() : []; };
    const snaps = await get('/nw_snapshots?select=snap_date,data&order=snap_date.desc&limit=1');
    const clair = snaps.length && snaps[0].data && typeof snaps[0].data === 'object' && !snaps[0].data.chiffre
      && /"(nw|couple|total|cash)"/.test(JSON.stringify(snaps[0].data));
    if (clair) echec('Neon nw_snapshots : patrimoine daté lisible en clair par le rôle anonyme (dernier : ' + snaps[0].snap_date + ')');
    else ok('Neon nw_snapshots : aucun patrimoine lisible en clair par le rôle anonyme');
    const immo = await get('/immo_properties?select=id,rent');
    const horsBail = immo.filter((p) => p.rent && MOTIFS[0][1].test(Object.keys(p.rent).join(' ')));
    if (horsBail.length) echec('Neon immo_properties.rent : champs hors bail lisibles (' + horsBail.map((p) => p.id).join(', ') + ')');
    else ok('Neon immo_properties.rent : aucun champ hors bail lisible');
    const valeurs = immo.length && (await get('/immo_properties?select=value&limit=1'));
    if (valeurs && valeurs.length && valeurs[0].value != null) echec('Neon immo_properties : valeurs de biens lisibles par le rôle anonyme');
  } catch (e) { echec('contrôle Neon impossible (' + e.message + ') — confidentialité NON démontrée'); }
}

console.log('');
if (ko === 0) { console.log('✅ Aucune fuite : les données patrimoniales ne sont pas exposées sans authentification.'); process.exit(0); }
console.log('❌ ' + ko + ' fuite(s). Données patrimoniales accessibles sans authentification — chantier NON terminé.');
console.log('   Activer le chiffrement : node scripts/enable_encryption.mjs  (voir docs/CHIFFREMENT_DONNEES.md)');
process.exit(1);
