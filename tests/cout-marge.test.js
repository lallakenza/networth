#!/usr/bin/env node
// ============================================================================
// Coût de la marge IBKR (v573) — taux par tranche, convention de jours, comparaison Wio.
//
// Les taux sont ceux de la page IBKR Pro relevée le 31/10/2026 ; ce test les recoupe avec
// les intérêts réellement inscrits sur les relevés quotidiens du compte (Interest Accruals),
// pour qu'une saisie fausse dans IBKR_CONFIG.marge se voie tout de suite.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-marge-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}
let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} au lieu de ${b} (±${tol})`);

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const fx = { EUR: 1, USD: 1.116, JPY: 175.8, AED: 4.099, MAD: 10.6 };
  const conf = D.IBKR_CONFIG.marge;
  const parJour = (solde, dev) => solde * E.tauxMargeIBKR(solde, dev) / conf[dev].base;

  t('accruals EUR des relevés : 1,12 € (26/10, 4 jours) et 1,23 € (29/10)', () => {
    proche(4 * parJour(2520.19, 'EUR'), 1.12, 0.015, '26/10');
    proche(2 * parJour(2520.19, 'EUR') + parJour(5922.99, 'EUR'), 1.23, 0.01, '29/10');
  });

  t('accruals JPY des relevés : 351 ¥ sur 3 jours, ~117 ¥/jour', () => {
    proche(3 * parJour(1604546.36, 'JPY'), 351, 1, '26/10');
  });

  t('MARGIN_RATES = tranche 1 de IBKR_CONFIG.marge (source unique)', () => {
    for (const dev of ['EUR', 'USD', 'JPY']) assert.equal(D.MARGIN_RATES[dev], conf[dev].tiers[0].rate, dev);
    assert.equal(D.IBKR_CONFIG.jpyTiers, conf.JPY.tiers);
  });

  t('taux pondéré par tranches au-delà du premier palier', () => {
    const t1 = conf.EUR.tiers[0], t2 = conf.EUR.tiers[1];
    const attendu = (t1.limit * t1.rate + 10000 * t2.rate) / (t1.limit + 10000);
    proche(E.tauxMargeIBKR(t1.limit + 10000, 'EUR'), attendu, 1e-12, 'EUR 100 k€');
  });

  t('solde créditeur ⇒ pas de coût', () => {
    assert.equal(E.coutMargeIBKR(2728, 'USD', fx, 0.06), null);
    assert.equal(E.coutMargeIBKR(0, 'EUR', fx, 0.06), null);
  });

  t('coût annuel/mensuel en ACT/360 et verdict face à Wio 6 %', () => {
    const c = E.coutMargeIBKR(-5922.99, 'EUR', fx, 0.06);
    proche(c.tauxEffectif, 0.04049 * 365 / 360, 1e-12, 'taux effectif');
    proche(c.coutAnnuelEUR, 5922.99 * 0.04049 * 365 / 360, 1e-6, 'coût annuel');
    proche(c.coutMensuelEUR * 12, c.coutAnnuelEUR, 1e-9, 'mensuel × 12');
    proche(c.renoncementWioEUR, 5922.99 * 0.06, 1e-6, 'intérêts Wio perdus');
    assert.equal(c.rapatrier, false, 'à 4,1 % la marge reste moins chère que 6 %');
    assert.equal(c.moisAmortissement, null);
  });

  t('si la marge dépasse le taux Wio : rapatrier, avec amortissement des frais', () => {
    const c = E.coutMargeIBKR(-10000, 'USD', fx, 0.03);
    assert.equal(c.rapatrier, true);
    proche(c.moisAmortissement, c.fraisEUR / (c.ecartAnnuelEUR / 12), 1e-9, 'mois');
  });

  t('emprunter 10 000 (devise d\'affichage) : même taux quelle que soit l\'unité, tranche 1', () => {
    const enUSD = E.coutEmpruntAnnuel(10000 / fx.USD, 'EUR', fx);   // 10 000 $ empruntés en euros
    proche(enUSD.montantNatif, 10000 / fx.USD, 1e-9, 'montant en €');
    proche(enUSD.coutEUR * fx.USD, 10000 * 0.04049 * 365 / 360, 1e-6, 'coût exprimé en $');
    const jpy = E.coutEmpruntAnnuel(10000, 'JPY', fx);              // 10 000 € empruntés en yens
    proche(jpy.montantNatif, 10000 * fx.JPY, 1e-6, 'montant en ¥');
    proche(jpy.coutEUR, 10000 * 0.02663, 1e-6, 'JPY en ACT/365');
    assert.equal(E.coutEmpruntAnnuel(0, 'USD', fx), null);
  });

  t('la vue Actions expose un coût pour chaque devise débitrice', () => {
    const s = E.compute(D.PORTFOLIO, fx, 'statique');
    const a = s.actionsView || s.actions;
    assert.ok(a && a.ibkrCoutsMarge, 'ibkrCoutsMarge absent');
    for (const dev of ['EUR', 'USD', 'JPY']) {
      const solde = a['ibkrCash' + dev];
      assert.equal(a.ibkrCoutsMarge[dev] === null, !(solde < 0), dev);
    }
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(ko === 0 ? 0 : 1);
})();
