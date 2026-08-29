#!/usr/bin/env node
/**
 * build_encrypted_data.mjs — chiffre les données patrimoniales pour publication publique.
 *
 * POURQUOI : le site est servi par GitHub Pages depuis un dépôt public. Tout fichier du dépôt
 * est téléchargeable par qui connaît son adresse — la grille de code de l'accueil ne masque que
 * l'interface. Avant ce script, `js/data.js` exposait en clair les soldes bancaires, les créances
 * nominatives, la TVA, l'identifiant fiscal du bien de Vitry et les champs de loyer en espèces.
 *
 * PRINCIPE : les blocs sensibles quittent le dépôt. Ils vivent dans un fichier source gardé HORS
 * du dépôt (voir SOURCE_PATH), et ce script en produit un blob chiffré (AES-256-GCM, clé dérivée
 * par PBKDF2-SHA256) que le navigateur déchiffre avec la phrase saisie à l'ouverture du site.
 *
 * LA PHRASE SECRÈTE N'EST JAMAIS ÉCRITE NI STOCKÉE. Elle est demandée à l'exécution (saisie
 * masquée) ou lue dans la variable d'environnement NW_PASSPHRASE. Elle n'apparaît ni dans le
 * dépôt, ni dans l'historique git, ni dans les journaux.
 *
 * USAGE
 *   node scripts/build_encrypted_data.mjs            # saisie interactive de la phrase
 *   NW_PASSPHRASE='…' node scripts/build_encrypted_data.mjs   # non interactif (CI)
 *   node scripts/build_encrypted_data.mjs --verify   # vérifie que le blob se déchiffre
 *
 * SOLIDITÉ DE LA PHRASE — À LIRE
 *   Le blob étant public, sa seule protection est la phrase. Un code à 4 chiffres (10 000
 *   combinaisons) tombe en quelques minutes malgré les 250 000 itérations PBKDF2. Le script
 *   REFUSE toute phrase de moins de 12 caractères. Vise une phrase de 4-5 mots sans lien avec
 *   toi (les prénoms, dates et adresses du dossier sont les premiers essais d'un attaquant).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));

// Le fichier en clair vit HORS du dépôt : c'est ce qui garantit qu'il n'atterrit ni sur
// GitHub ni sur Pages. À sauvegarder par tes soins (iCloud, Drive, disque chiffré) — sa perte
// serait irréversible, le blob chiffré ne se remonte pas en source lisible sans la phrase.
const SOURCE_PATH = process.env.NW_DATA_SOURCE || join(dirname(RACINE), 'networth-data', 'data.source.js');
const SORTIE = join(RACINE, 'js', 'data.enc.js');

// Blocs à chiffrer. Le reste de data.js (barèmes fiscaux publics, taux de change, tokens de
// design, calendrier de dividendes) reste en clair : rien de personnel, et le site doit pouvoir
// s'afficher avant déverrouillage.
const BLOCS_SENSIBLES = [
  'PORTFOLIO', 'IMMO_CONSTANTS', 'VITRY_CONSTRAINTS', 'VILLEJUIF_CONSTRAINTS',
  'IMMO_PASSIFS_DOCUMENTES', 'NW_HISTORY', 'EQUITY_HISTORY', 'MONTHLY_INCOMES',
  'BUDGET_EXPENSES', 'DEGIRO_STATIC_PRICES', 'PRICE_REFS_AS_OF',
];

const ITERATIONS = 250000;
const LONGUEUR_MIN = 12;

function demanderPhrase() {
  if (process.env.NW_PASSPHRASE) return Promise.resolve(process.env.NW_PASSPHRASE);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write('Phrase secrète (invisible à la saisie) : ');
    const onData = (c) => { if (c[0] === 13 || c[0] === 10) process.stdin.removeListener('data', onData); };
    process.stdin.on('data', onData);
    rl.question('', (rep) => { rl.close(); process.stdout.write('\n'); resolve(rep); });
    // masquage de la frappe
    rl._writeToOutput = () => {};
  });
}

async function deriverCle(phrase, sel) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(phrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sel, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** Extrait la valeur littérale d'un `export const NOM = …;` par équilibrage de délimiteurs. */
function extraireBloc(src, nom) {
  const ancre = `export const ${nom}`;
  const i = src.indexOf(ancre);
  if (i < 0) return null;
  const eq = src.indexOf('=', i + ancre.length);
  if (eq < 0) return null;
  let prof = 0, dansTexte = null, echap = false, debut = -1;
  for (let k = eq + 1; k < src.length; k++) {
    const c = src[k];
    if (dansTexte) {
      if (echap) { echap = false; continue; }
      if (c === '\\') { echap = true; continue; }
      if (c === dansTexte) dansTexte = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { dansTexte = c; continue; }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k < 0) break; continue; }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k) + 1; continue; }
    if ('{[('.includes(c)) { if (prof === 0) debut = k; prof++; continue; }
    if ('}])'.includes(c)) {
      prof--;
      if (prof === 0) return { texte: src.slice(debut, k + 1), primitive: false };
    }
    if (prof === 0 && c === ';' ) {
      // valeur primitive (nombre, chaîne) sur une seule expression
      return { texte: src.slice(eq + 1, k).trim(), primitive: true };
    }
  }
  return null;
}

async function principal() {
  const verifier = process.argv.includes('--verify');

  if (!existsSync(SOURCE_PATH)) {
    console.error(`✗ Source introuvable : ${SOURCE_PATH}`);
    console.error('  Crée ce fichier (copie de js/data.js AVANT chiffrement) et garde-le hors du dépôt.');
    console.error('  Ou pointe NW_DATA_SOURCE vers son emplacement.');
    process.exit(1);
  }

  const phrase = (await demanderPhrase()).trim();
  if (phrase.length < LONGUEUR_MIN) {
    console.error(`✗ Phrase trop courte (${phrase.length} caractères, minimum ${LONGUEUR_MIN}).`);
    console.error('  Le blob est PUBLIC : une phrase courte se casse par force brute en quelques minutes.');
    process.exit(1);
  }

  const src = readFileSync(SOURCE_PATH, 'utf-8');
  const donnees = {};
  const manquants = [];
  for (const nom of BLOCS_SENSIBLES) {
    const bloc = extraireBloc(src, nom);
    if (!bloc) { manquants.push(nom); continue; }
    // On évalue le littéral pour produire du JSON — la source reste du JS, la sortie du JSON.
    donnees[nom] = new Function(`return (${bloc.texte});`)();
  }
  if (manquants.length) {
    console.error('✗ Blocs introuvables dans la source :', manquants.join(', '));
    process.exit(1);
  }

  const clair = new TextEncoder().encode(JSON.stringify(donnees));
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cle = await deriverCle(phrase, sel);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, clair));

  const b64 = (u8) => Buffer.from(u8).toString('base64');
  const blob = { v: 1, kdf: 'PBKDF2-SHA256', it: ITERATIONS, sel: b64(sel), iv: b64(iv), data: b64(chiffre) };

  if (verifier) {
    const cle2 = await deriverCle(phrase, sel);
    const dechiffre = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cle2, chiffre);
    const relu = JSON.parse(new TextDecoder().decode(dechiffre));
    const ok = BLOCS_SENSIBLES.every((n) => relu[n] !== undefined);
    console.log(ok ? '✓ Vérification : le blob se déchiffre et contient les 11 blocs.' : '✗ Vérification échouée.');
    if (!ok) process.exit(1);
  }

  writeFileSync(SORTIE, `// GÉNÉRÉ PAR scripts/build_encrypted_data.mjs — NE PAS ÉDITER À LA MAIN.
// Données patrimoniales chiffrées (AES-256-GCM, clé PBKDF2-SHA256 ${ITERATIONS} itérations).
// La source en clair vit hors du dépôt ; ce fichier est le seul publié.
export const DATA_ENC = ${JSON.stringify(blob, null, 2)};
`, 'utf-8');

  const ko = (n) => (n / 1024).toFixed(0);
  console.log(`✓ ${SORTIE}`);
  console.log(`  ${BLOCS_SENSIBLES.length} blocs · ${ko(clair.length)} Ko en clair → ${ko(chiffre.length)} Ko chiffrés`);
  console.log('  La phrase n\'a été ni écrite ni journalisée.');
}

principal().catch((e) => { console.error('✗', e.message); process.exit(1); });
