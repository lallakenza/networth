#!/usr/bin/env node
// ============================================================================
// Courtiers et plan ESPP (v569) — ESPP est un mode d'ACQUISITION, pas un courtier.
//
// Les 167 ACN d'Amine sont chez IBKR depuis le 09/10/2026 ; les 40 de Nezha encore chez UBS. Le site
// range chaque ligne chez le courtier qui la détient, sur tout l'historique. Ce test protège :
//   1. la garde déclarée (courtier, date, ancien dépositaire) et le défaut UBS ;
//   2. un regroupement d'AFFICHAGE : mêmes totaux, rien ne se perd ni ne se compte deux fois ;
//   3. le compte IBKR au connecteur (achats d'octobre, cash, dépôt Wise).
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-courtiers-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}
let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const P = D.PORTFOLIO;
  console.log('\n── Courtiers et plan ESPP ──');

  t('garde : ACN d’Amine chez IBKR depuis le 09/10/2026 (ex-UBS), celle de Nezha chez UBS', () => {
    assert.equal(E.courtierACN(P, 'amine'), 'IBKR');
    assert.equal(P.amine.espp.garde.depuis, '2026-10-09');
    assert.equal(P.amine.espp.garde.avant, 'UBS');
    assert.equal(E.courtierACN(P, 'nezha'), 'UBS');
    assert.equal(E.courtierACN({ amine: { espp: {} } }, 'amine'), 'UBS', 'sans garde : UBS, dépositaire historique du plan');
  });

  t('regroupement par courtier : mêmes totaux, rien de compté deux fois', () => {
    const s = E.compute(P, { ...D.FX_STATIC }, 'static');
    for (const qui of ['amine', 'nezha']) {
      const x = s[qui];
      const avant = (x.ibkrForActions || 0) + (x.esppForActions || 0);
      const apres = (x.ibkrAvecACN || 0) + (x.ubsForActions || 0);
      assert.ok(Math.abs(avant - apres) < 0.01, qui + ' : ' + avant + ' ≠ ' + apres);
    }
    assert.ok(Math.abs(s.amine.ibkrAvecACN - (s.amine.ibkrForActions + s.amine.esppForActions)) < 0.01, 'ACN d’Amine dans IBKR');
    assert.equal(s.amine.ubsForActions, 0);
    assert.equal(s.nezha.ubsForActions, s.nezha.esppForActions, 'ACN de Nezha chez UBS');
    const av = s.actionsView;
    assert.ok(Math.abs(av.esppDepositsAmine + av.esppDepositsNezha - av.esppDeposits) < 0.01, 'contributions ventilées sans perte');
  });

  t('le cash UBS d’Amine est parti chez IBKR (Wise, 18/10/2026)', () => {
    assert.equal(P.amine.espp.cashEUR, 0);
    const dep = P.amine.ibkr.deposits.find((d) => d.date === '2026-10-18');
    assert.ok(dep && dep.currency === 'USD' && Math.abs(dep.amount - 2729.33) < 0.01);
  });

  t('IBKR au connecteur du 07/11/2026 : 170 VWCE, 40 GOOGL, 167 ACN, cash EUR/USD/JPY', () => {
    const pos = (tk) => P.amine.ibkr.positions.find((p) => p.ticker === tk);
    assert.equal(pos('VWCE.DE').shares, 170);
    assert.equal(pos('GOOGL').shares, 40);
    assert.equal(P.amine.espp.shares, 167, 'les 167 ACN venues d\'UBS, chez IBKR depuis le 09/10');
    // v595 — +6 000 € virés depuis Revolut le 07/11, en transit : le connecteur lit encore −22 361,85.
    const transit = P.amine.ibkr.deposits.filter((d) => d.date === '2026-11-07' && d.currency === 'EUR').reduce((s, d) => s + d.amount, 0);
    assert.equal(transit, 6000);
    assert.ok(Math.abs(P.amine.ibkr.cashEUR - transit - (-22361.85)) < 0.01, 'cash EUR = connecteur + virement en transit');
    assert.equal(P.amine.ibkr.cashUSD, -8511.67);
    assert.equal(P.amine.ibkr.cashJPY, -1608111.36);
    // Les soldes se reconstituent au centime à partir des mouvements depuis le 09/10.
    assert.ok(Math.abs(-2517.19 - 3402.8 - 3 - 16422 - 8.21 - 8.65 + transit - P.amine.ibkr.cashEUR) < 0.01, 'EUR = solde du 09/10 − 20 et 100 VWCE − intérêts d\'octobre');
    assert.ok(Math.abs(2729.33 - 11240 - 1 - P.amine.ibkr.cashUSD) < 0.01, 'USD = cash UBS via Wise − 40 GOOGL');
  });

  console.log(ko === 0 ? '\n✅ Courtiers : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
