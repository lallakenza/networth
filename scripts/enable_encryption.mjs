#!/usr/bin/env node
/**
 * enable_encryption.mjs — ACTIVE le chiffrement des données patrimoniales en un seul geste (item 1).
 *
 *   NW_PASSPHRASE='votre phrase' node scripts/enable_encryption.mjs
 *   node scripts/enable_encryption.mjs --keychain      # relit la phrase du trousseau macOS
 *
 * La phrase (= le secret rangé dans Supabase `nw_secrets.data_key`) n'est JAMAIS écrite ni
 * journalisée : elle transite par l'environnement, sert au chiffrement, et rien d'autre. Ce script
 * ne TOURNE aucune clé — il réutilise la phrase existante.
 *
 * Enchaîne, en s'arrêtant à la première anomalie :
 *   1. sauvegarde le js/data.js EN CLAIR hors dépôt (~/networth-data/data.source.js) ;
 *   2. génère js/data.enc.js à partir de ce clair (AES-256-GCM, PBKDF2) et vérifie qu'il se déchiffre ;
 *   3. vide les 13 blocs sensibles de js/data.js (coquilles) ;
 *   4. contrôle qu'aucune donnée patrimoniale ne subsiste dans les fichiers publics.
 * Reste à faire À LA MAIN ensuite : bump de version, commit (js/data.js + js/data.enc.js), push,
 * puis `node scripts/verify_no_leak.mjs --prod`.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(RACINE, 'js', 'data.js');
const SRC_DIR = join(dirname(RACINE), 'networth-data');
const SRC = join(SRC_DIR, 'data.source.js');
const keychain = process.argv.includes('--keychain');

function phraseTrousseau() {
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'networth-data-passphrase', '-a', 'networth', '-w'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\n$/, '');
  } catch (e) { return null; }
}

// 0. Pré-conditions
const clair = readFileSync(DATA, 'utf-8');
if (/export const PORTFOLIO\s*=\s*\{\s*\}\s*;/.test(clair)) {
  console.error('⚠ js/data.js est déjà une coquille — le chiffrement semble actif.');
  console.error('  Pour METTRE À JOUR les données : édite ~/networth-data/data.source.js puis');
  console.error('  NW_DATA_SOURCE=~/networth-data/data.source.js node scripts/build_encrypted_data.mjs');
  process.exit(1);
}
const phrase = process.env.NW_PASSPHRASE || (keychain ? phraseTrousseau() : null);
if (!phrase) {
  console.error('✗ Aucune phrase. Fournis-la sans la journaliser :');
  console.error("    NW_PASSPHRASE='…' node scripts/enable_encryption.mjs");
  console.error('  (ou --keychain si elle est déjà dans le trousseau macOS).');
  console.error('  C\'est la phrase existante = le secret Supabase nw_secrets.data_key. Ce script ne la change pas.');
  process.exit(2);
}

const run = (args) => execFileSync(process.execPath, args, {
  cwd: RACINE, stdio: 'inherit',
  env: { ...process.env, NW_PASSPHRASE: phrase },
});

// 1. Sauvegarde du clair hors dépôt
if (!existsSync(SRC_DIR)) mkdirSync(SRC_DIR, { recursive: true });
copyFileSync(DATA, SRC);
console.log('✓ 1/4 clair sauvegardé hors dépôt : ' + SRC);

// 2. Génération + vérification du blob (à partir du clair sauvegardé)
console.log('· 2/4 génération du blob chiffré…');
run(['scripts/build_encrypted_data.mjs', '--verify', ...(keychain ? ['--keychain'] : [])]);

// 3. Vidage des blocs de js/data.js
console.log('· 3/4 vidage des blocs sensibles de js/data.js…');
run(['scripts/split_data_for_encryption.mjs']);

// 4. Contrôle de non-fuite (fichiers locaux)
console.log('· 4/4 contrôle de non-fuite…');
run(['scripts/verify_no_leak.mjs']);

console.log('\n✅ Chiffrement activé localement. Reste à publier :');
console.log('   1. bump de version  (sed -i \'\' \'s/?v=N/?v=N+1/g\' js/*.js index.html ; APP_VERSION ; sw.js VERSION ;');
console.log('      et l\'import du blob dans js/unlock.js : data.enc.js?v=N+1)');
console.log('   2. git add js/data.js js/data.enc.js  (JAMAIS data.js.avant-chiffrement ni la source)');
console.log('   3. git commit && git push, attendre le déploiement');
console.log('   4. node scripts/verify_no_leak.mjs --prod');
console.log('   La copie ~/networth-data/data.source.js est désormais LE clair à éditer pour toute mise à jour.');
