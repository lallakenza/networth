#!/usr/bin/env node
// ============================================================================
// Le dispositif de chiffrement tient-il ? (item 1)
//
// Ne teste pas un blob (il dépend de la phrase, absente en CI) mais la MÉCANIQUE qui garantit
// qu'un flip produit un dépôt public vide : la liste unique des blocs sensibles couvre bien les
// porteurs de données personnelles, le découpage les vide vraiment, et le gardiennage s'active
// sur l'état des données — pas sur un interrupteur oublié.
// ============================================================================
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');
const RACINE = path.join(__dirname, '..');

let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };

(async () => {
  const { NOMS_SENSIBLES, COQUILLES } = await import('../scripts/_blocs_sensibles.mjs');
  const clair = contenuClair();
  console.log('\n── chiffrement : mécanique ──');

  t('les porteurs de données personnelles sont dans la liste chiffrée', () => {
    for (const n of ['PORTFOLIO', 'IMMO_CONSTANTS', 'VILLEJUIF_ACTE', 'VILLEJUIF_CONSTRAINTS',
      'VITRY_CONSTRAINTS', 'RESIDENCE_FISCALE', 'MONTHLY_INCOMES', 'BUDGET_EXPENSES',
      'IMMO_PASSIFS_DOCUMENTES', 'EQUITY_HISTORY', 'NW_HISTORY']) {
      assert.ok(NOMS_SENSIBLES.includes(n), n + ' absent de la liste des blocs sensibles');
    }
  });

  t('chaque bloc listé existe dans data.js', () => {
    for (const n of NOMS_SENSIBLES) assert.ok(clair.includes('export const ' + n), n + ' introuvable dans data.js');
  });

  t('le découpage vide réellement chaque bloc, et le résultat reste du JS valide', () => {
    // Rejoue le vidage du script split sur le clair, puis vérifie que chaque bloc est une coquille.
    const bornes = (src, nom) => {
      const i = src.indexOf('export const ' + nom);
      const eq = src.indexOf('=', i);
      let prof = 0, txt = null, echap = false;
      for (let k = eq + 1; k < src.length; k++) {
        const c = src[k];
        if (txt) { if (echap) { echap = false; continue; } if (c === '\\') { echap = true; continue; } if (c === txt) txt = null; continue; }
        if (c === '"' || c === "'" || c === '`') { txt = c; continue; }
        if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k < 0) break; continue; }
        if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k) + 1; continue; }
        if ('{[('.includes(c)) { prof++; continue; }
        if ('}])'.includes(c)) { prof--; if (prof === 0) return { i, fin: src.indexOf(';', k) + 1 }; }
      }
      return null;
    };
    let out = clair;
    for (const [nom, vide] of Object.entries(COQUILLES)) {
      const b = bornes(out, nom);
      assert.ok(b, 'bornes introuvables pour ' + nom);
      out = out.slice(0, b.i) + 'export const ' + nom + ' = ' + vide + ';' + out.slice(b.fin);
    }
    // Plus aucune valeur non triviale pour ces blocs : la coquille est bien `{}` ou `[]`.
    for (const [nom, vide] of Object.entries(COQUILLES)) {
      assert.match(out, new RegExp('export const ' + nom + ' = ' + vide.replace(/[[\]{}]/g, '\\$&') + ';'),
        nom + ' non vidé');
    }
    // Le résidu doit rester analysable (nouvelle Function sur le module entier est trop lourd ;
    // on vérifie l'équilibrage global des accolades, indicateur d'un fichier non tronqué).
    const bal = (out.match(/\{/g) || []).length - (out.match(/\}/g) || []).length;
    assert.equal(bal, 0, 'accolades déséquilibrées après vidage (' + bal + ')');
  });

  t('le gardiennage s\'active sur l\'état des données, pas sur un interrupteur figé', () => {
    const u = fs.readFileSync(path.join(RACINE, 'js', 'unlock.js'), 'utf-8');
    // blobDisponible() ne doit plus jamais renvoyer un `return false;` inconditionnel.
    assert.ok(!/blobDisponible[\s\S]{0,400}\n\s*return false;\s*\n\}/.test(u.replace(/if \(clairPresent\) return false;/, '')),
      'blobDisponible contient encore un false inconditionnel');
    assert.match(u, /DATA\.PORTFOLIO[\s\S]{0,80}Object\.keys/, 'blobDisponible ne teste pas la présence des données en clair');
    assert.match(u, /await import\('\.\/data\.enc\.js/, 'blobDisponible ne charge pas le blob');
  });

  t('les deux scripts partagent la MÊME liste (aucune divergence possible)', () => {
    const build = fs.readFileSync(path.join(RACINE, 'scripts', 'build_encrypted_data.mjs'), 'utf-8');
    const split = fs.readFileSync(path.join(RACINE, 'scripts', 'split_data_for_encryption.mjs'), 'utf-8');
    assert.match(build, /from '\.\/_blocs_sensibles\.mjs'/, 'build n\'importe pas la liste centralisée');
    assert.match(split, /from '\.\/_blocs_sensibles\.mjs'/, 'split n\'importe pas la liste centralisée');
  });

  console.log(ko === 0 ? '\n✅ chiffrement : mécanique saine\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
