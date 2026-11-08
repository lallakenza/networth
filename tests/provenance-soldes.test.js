#!/usr/bin/env node
// ============================================================================
// Provenance des soldes (v599) : chaque compte a sa date d'observation, sa source et son statut
// (observé, reconstitué, anticipé). La date de mise à jour du site n'est pas celle des comptes.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-prov-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}
let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const FX = { ...D.FX_STATIC };
  const cv = E.compute(D.PORTFOLIO, FX, 'static').cashView;
  const reg = D.PORTFOLIO.provenanceSoldes;
  console.log('\n── Provenance des soldes ──');

  t('chaque compte affiché a une entrée de provenance (id stable)', () => {
    const manquants = cv.accounts.filter((a) => Math.abs(a.native || 0) >= 0.005 && !(a.provenance.id && reg[a.provenance.id]));
    assert.equal(manquants.length, 0, manquants.map((a) => a.label).join(', '));
  });

  t('statuts autorisés uniquement, dates au format AAAA-MM-JJ', () => {
    for (const [id, r] of Object.entries(reg)) {
      assert.ok(['observé', 'reconstitué', 'anticipé'].includes(r.statut), id + ' : ' + r.statut);
      assert.ok(r.le === null || /^\d{4}-\d{2}-\d{2}$/.test(r.le), id + ' : ' + r.le);
      assert.ok(r.source, id + ' sans source');
    }
  });

  t('iBanq reconstitué et IBKR EUR anticipé : statut forcé par les données, date observée gardée', () => {
    const ib = cv.accounts.find((a) => a.label === 'iBanq (Bairok)');
    if (ib.reconstruit) { assert.equal(ib.provenance.statut, 'reconstitué'); assert.equal(ib.provenance.le, ib.soldeObserveLe); }
    const eur = cv.accounts.find((a) => a.label === 'IBKR Cash EUR');
    if (eur.anticipe) { assert.equal(eur.provenance.statut, 'anticipé'); assert.equal(eur.provenance.le, D.PORTFOLIO.amine.ibkr.cashObserveLe); }
  });

  t('couverture : plage min → max des dates observées, plus anciens nommés', () => {
    const c = cv.couverture;
    const dates = cv.accounts.filter((a) => Math.abs(a.native || 0) >= 0.005).map((a) => a.provenance.le).filter(Boolean).sort();
    assert.equal(c.du, dates[0]);
    assert.equal(c.au, dates[dates.length - 1]);
    assert.ok(c.plusAnciens.length > 0);
    assert.notEqual(c.du, c.au, 'les comptes n\'ont pas tous la même date : une date unique serait fausse');
  });

  console.log(ko ? '\n✗ ' + ko + ' échec(s)' : '\n✓ provenance des soldes');
  process.exit(ko ? 1 : 0);
})();
