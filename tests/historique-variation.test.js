#!/usr/bin/env node
// ============================================================================
// Historique — explication des variations entre deux snapshots (v599), sur données synthétiques.
// Protège : un virement interne (compte → compte, cash → titres, vente) n'est jamais une performance ;
// le change et les cours sont isolés ; la somme des lignes égale la variation du patrimoine.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');
const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-hist-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}
let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };
const proche = (a, b, m) => assert.ok(Math.abs(a - b) < 0.01, (m || '') + ' ' + a + ' ≠ ' + b);

// Snapshot minimal : cash (comptes natifs + change), positions (eur, pl), catégories du couple.
function snap({ comptes = {}, positions = {}, realise = 0, immo = 100000, autres = 0, fx = { AED: 4 } }) {
  const accounts = {}; let cash = 0;
  for (const [id, [native, ccy]] of Object.entries(comptes)) {
    const eur = ccy === 'EUR' ? native : native / fx[ccy];
    accounts[id] = { native, ccy, eur }; cash += eur;
  }
  const stocks = Object.values(positions).reduce((x, p) => x + p.eur, 0);
  return { schema: 1, meta: { fx },
    views: { couple: { stocks, cash, immo, other: autres, nwRef: stocks + cash + immo + autres } },
    cash: { accounts }, stocks: { positions, realizedPL: realise } };
}

(async () => {
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  console.log('\n── Historique : explication des variations ──');

  t('virement interne entre comptes : aucune variation, aucune performance', () => {
    const v = E.expliquerVariation(snap({ comptes: { a: [5000, 'EUR'], b: [0, 'EUR'] } }), snap({ comptes: { a: [0, 'EUR'], b: [5000, 'EUR'] } }));
    proche(v.total, 0); proche(v.marche, 0); proche(v.soldes, 0);
  });

  t('achat de titres avec du cash : neutre', () => {
    const v = E.expliquerVariation(snap({ comptes: { a: [5000, 'EUR'] } }),
      snap({ comptes: { a: [4000, 'EUR'] }, positions: { X: { eur: 1000, pl: 0 } } }));
    proche(v.total, 0); proche(v.marche, 0); proche(v.soldes, 0);
  });

  t('hausse des cours : en « marchés »', () => {
    const v = E.expliquerVariation(snap({ positions: { X: { eur: 1000, pl: 0 } } }), snap({ positions: { X: { eur: 1500, pl: 500 } } }));
    proche(v.marche, 500); proche(v.soldes, 0);
  });

  t('vente avec plus-value : le gain reste en « marchés », l\'encaissement est neutre', () => {
    const v = E.expliquerVariation(snap({ comptes: { a: [0, 'EUR'] }, positions: { X: { eur: 1300, pl: 300 } } }),
      snap({ comptes: { a: [1300, 'EUR'] }, realise: 300 }));
    proche(v.total, 0); proche(v.marche, 0); proche(v.soldes, 0);
  });

  t('change : un compte en AED réévalué, isolé en « change »', () => {
    const v = E.expliquerVariation(snap({ comptes: { w: [4000, 'AED'] }, fx: { AED: 4 } }), snap({ comptes: { w: [4000, 'AED'] }, fx: { AED: 5 } }));
    proche(v.change, -200); proche(v.total, -200); proche(v.soldes, 0);
  });

  t('dépense réelle et correction de saisie : dans « soldes », jamais en marchés', () => {
    const v = E.expliquerVariation(snap({ comptes: { a: [10000, 'EUR'] } }), snap({ comptes: { a: [7000, 'EUR'] } }));
    proche(v.soldes, -3000); proche(v.marche, 0);
  });

  t('les lignes s\'additionnent toujours à la variation totale', () => {
    const a = snap({ comptes: { a: [10000, 'EUR'], w: [8000, 'AED'] }, positions: { X: { eur: 2000, pl: 100 } }, immo: 90000, autres: 500 });
    const b = snap({ comptes: { a: [6000, 'EUR'], w: [9000, 'AED'] }, positions: { X: { eur: 2600, pl: 400 }, Y: { eur: 3000, pl: -50 } }, realise: 20, immo: 90800, autres: 300, fx: { AED: 4.2 } });
    const v = E.expliquerVariation(a, b);
    proche(v.marche + v.change + v.immo + v.soldes, v.total);
  });

  console.log(ko ? '\n✗ ' + ko + ' échec(s)' : '\n✓ historique : variations');
  process.exit(ko ? 1 : 0);
})();
