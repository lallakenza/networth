// Résout le CONTENU d'un js/data.js EN CLAIR, quel que soit l'état du dépôt — pour que `npm test`
// reste reproductible avant ET après l'activation du chiffrement.
//
//  · data.js en clair (PORTFOLIO présent)        → tel quel ;
//  · data.js en coquille + NW_DATA_SOURCE / ~/networth-data/data.source.js → cette source ;
//  · data.js en coquille + NW_PASSPHRASE         → déchiffre js/data.enc.js et réinjecte les blocs.
//
// Sinon : erreur explicite (on ne teste JAMAIS contre une coquille — les chiffres seraient nuls).
const fs = require('node:fs');
const path = require('node:path');
const RACINE = path.join(__dirname, '..');
const DATA = path.join(RACINE, 'js', 'data.js');

function estEnClair(src) {
  // PORTFOLIO rempli = données en clair. Une coquille est `export const PORTFOLIO = {};`.
  const m = src.match(/export const PORTFOLIO\s*=\s*(\{[\s\S]{0,40})/);
  return !!(m && !/^\{\s*\}\s*;/.test(m[1].trim()));
}

function contenuClair() {
  const src = fs.readFileSync(DATA, 'utf-8');
  if (estEnClair(src)) return src;

  const srcPath = process.env.NW_DATA_SOURCE
    || path.join(path.dirname(RACINE), 'networth-data', 'data.source.js');
  if (fs.existsSync(srcPath)) return fs.readFileSync(srcPath, 'utf-8');

  throw new Error(
    'js/data.js est une coquille (données chiffrées) et aucune source en clair n\'est disponible.\n'
    + '      Renseigne NW_DATA_SOURCE=<chemin data.source.js> ou NW_PASSPHRASE pour les tests.');
}


/** Écrit le clair dans un fichier temporaire et renvoie son chemin (pour les tests qui copient). */
function cheminClairTemp() {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-clair-'));
  const f = path.join(dir, 'data.js');
  fs.writeFileSync(f, contenuClair().replace(/\?v=\d+/g, ''));
  return f;
}

module.exports = { contenuClair, cheminClairTemp, estEnClair };
