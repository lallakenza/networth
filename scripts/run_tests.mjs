#!/usr/bin/env node
// Exécute TOUS les tests de tests/*.test.js et agrège le résultat. Le flag --disable-warning tait
// l'avertissement de performance « module type non spécifié » (le dépôt mêle ESM et CJS) — ce
// n'est pas un défaut, seulement du bruit qui masquerait un vrai échec.
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(RACINE, 'tests');
const fichiers = readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
let echecs = 0;
for (const f of fichiers) {
  const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(dir, f)],
    { encoding: 'utf-8' });
  const ok = r.status === 0;
  process.stdout.write((ok ? '✓ ' : '✗ ') + f + '\n');
  if (!ok) { echecs++; process.stdout.write((r.stdout || '') + (r.stderr || '')); }
}
console.log('\n' + (echecs === 0 ? '✅ ' + fichiers.length + ' fichiers, tout passe' : '❌ ' + echecs + ' fichier(s) en échec'));
process.exit(echecs === 0 ? 0 : 1);
