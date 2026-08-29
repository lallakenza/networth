#!/usr/bin/env node
/**
 * split_data_for_encryption.mjs — prépare le passage au chiffrement.
 *
 * Transforme `js/data.js` : les 11 blocs sensibles y deviennent des COQUILLES VIDES, remplies au
 * chargement par `js/unlock.js` après saisie de la phrase. Les barèmes publics, taux de change et
 * tokens de design restent en clair — ils ne disent rien de personnel et permettent au site de
 * s'afficher avant déverrouillage.
 *
 * À exécuter UNE FOIS, après avoir mis la source en clair à l'abri (hors du dépôt).
 *   node scripts/split_data_for_encryption.mjs --dry-run   # montre ce qui changerait
 *   node scripts/split_data_for_encryption.mjs             # applique
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
const CIBLE = join(RACINE, 'js', 'data.js');

// nom → coquille vide de même TYPE (un tableau ne se remplit pas comme un objet)
const COQUILLES = {
  PORTFOLIO: '{}', IMMO_CONSTANTS: '{}', VITRY_CONSTRAINTS: '{}', VILLEJUIF_CONSTRAINTS: '{}',
  IMMO_PASSIFS_DOCUMENTES: '[]', NW_HISTORY: '[]', EQUITY_HISTORY: '[]', MONTHLY_INCOMES: '[]',
  BUDGET_EXPENSES: '[]', DEGIRO_STATIC_PRICES: '{}', PRICE_REFS_AS_OF: '{}',
};

function bornesBloc(src, nom) {
  const ancre = `export const ${nom}`;
  const i = src.indexOf(ancre);
  if (i < 0) return null;
  const eq = src.indexOf('=', i + ancre.length);
  let prof = 0, txt = null, echap = false;
  for (let k = eq + 1; k < src.length; k++) {
    const c = src[k];
    if (txt) {
      if (echap) { echap = false; continue; }
      if (c === '\\') { echap = true; continue; }
      if (c === txt) txt = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { txt = c; continue; }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k < 0) break; continue; }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k) + 1; continue; }
    if ('{[('.includes(c)) { prof++; continue; }
    if ('}])'.includes(c)) { prof--; if (prof === 0) return { i, fin: src.indexOf(';', k) + 1 }; }
  }
  return null;
}

const sec = process.argv.includes('--dry-run');
let src = readFileSync(CIBLE, 'utf-8');
const avant = src.length;
const faits = [];
for (const [nom, vide] of Object.entries(COQUILLES)) {
  const b = bornesBloc(src, nom);
  if (!b) { console.error(`✗ bloc introuvable : ${nom}`); process.exit(1); }
  const remplacement = `// ${nom} — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js\n`
    + `// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.\n`
    + `export const ${nom} = ${vide};`;
  faits.push(`${nom} (${(b.fin - b.i)} car. → ${remplacement.length})`);
  src = src.slice(0, b.i) + remplacement + src.slice(b.fin);
}
console.log(faits.map((f) => '  · ' + f).join('\n'));
console.log(`  ${avant} → ${src.length} caractères (${Math.round((1 - src.length / avant) * 100)} % retirés du fichier public)`);
if (sec) { console.log('\n(--dry-run : rien n\'a été écrit)'); process.exit(0); }
if (!existsSync(CIBLE + '.avant-chiffrement')) copyFileSync(CIBLE, CIBLE + '.avant-chiffrement');
writeFileSync(CIBLE, src, 'utf-8');
console.log(`\n✓ ${CIBLE} transformé (copie de sécurité : data.js.avant-chiffrement, à supprimer une fois validé)`);
