#!/usr/bin/env node
// Bump complet et cohérent de la version (item 6). Un seul geste plutôt que cinq sed à la main.
//   node scripts/bump_version.mjs            # vN → vN+1 (déduit de APP_VERSION)
//   node scripts/bump_version.mjs 545        # force la cible
// Touche : les ?v= de js/*.js et index.html (dont l'import du blob dans unlock.js), APP_VERSION
// (data.js) et VERSION (sw.js). N'ajoute pas de commit.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
const data = readFileSync(join(RACINE, 'js', 'data.js'), 'utf-8');
const cur = parseInt((data.match(/APP_VERSION = 'v(\d+)'/) || [])[1], 10);
if (!cur) { console.error('✗ APP_VERSION introuvable dans js/data.js'); process.exit(1); }
const cible = process.argv[2] ? parseInt(process.argv[2], 10) : cur + 1;
if (!(cible > cur)) { console.error(`✗ cible v${cible} ≤ courant v${cur}`); process.exit(1); }

const remplaceFichier = (rel, subs) => {
  const p = join(RACINE, rel); let s = readFileSync(p, 'utf-8'); let n = 0;
  for (const [re, to] of subs) s = s.replace(re, (m) => { n++; return to; });
  writeFileSync(p, s); return n;
};
const reV = new RegExp('\\?v=' + cur + '\\b', 'g');
let total = 0;
for (const f of readdirSync(join(RACINE, 'js')).filter((f) => f.endsWith('.js'))) {
  total += remplaceFichier(join('js', f), [[reV, '?v=' + cible]]);
}
total += remplaceFichier('index.html', [[reV, '?v=' + cible]]);
remplaceFichier('js/data.js', [[/APP_VERSION = 'v\d+'/, "APP_VERSION = 'v" + cible + "'"]]);
remplaceFichier('sw.js', [[/const VERSION = 'v\d+'/, "const VERSION = 'v" + cible + "'"]]);
console.log(`✓ v${cur} → v${cible} (${total} suffixes ?v= mis à jour + APP_VERSION + sw VERSION)`);
