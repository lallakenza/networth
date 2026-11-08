#!/usr/bin/env node
// ============================================================================
// Vue Cash — coûts des soldes débiteurs IBKR et calcul unique du potentiel (v599).
//
// Protège :
//   1. un solde EUR/USD négatif chez IBKR porte un coût de financement (barème de marge), au lieu
//      d'un « 0 % » muet ; le coût vient de coutMargeIBKR(), le même calcul que la vue Actions ;
//   2. le manque à gagner est UN seul chiffre (barres = diagnostic = tableau) et ne dépend pas des
//      soldes débiteurs : un débit n'est pas une somme à placer ;
//   3. le financement est publié à part et ne touche ni le patrimoine ni le cash non productif.
// Données synthétiques : on part de PORTFOLIO et on fixe les soldes IBKR.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cashfin-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}
let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };
const proche = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, (m || '') + ' ' + a + ' ≠ ' + b);

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const FX = { ...D.FX_STATIC };
  const avec = (eur, usd) => {
    const P = structuredClone(D.PORTFOLIO);
    P.amine.ibkr.cashEUR = eur; P.amine.ibkr.cashUSD = usd;
    return E.compute(P, FX, 'static');
  };
  console.log('\n── Vue Cash : financement IBKR et potentiel unique ──');

  const s = avec(-10000, -5000);
  const cv = s.cashView;
  const eur = cv.accounts.find((a) => a.label === 'IBKR Cash EUR');
  const usd = cv.accounts.find((a) => a.label === 'IBKR Cash USD');

  t('solde EUR/USD débiteur : coût de marge au barème (ACT/360), pas 0 %', () => {
    assert.ok(eur.financement && usd.financement, 'financement absent');
    const tauxEUR = D.IBKR_CONFIG.marge.EUR.tiers[0].rate * 365 / 360;
    proche(eur.financement.coutAnnuelEUR, 10000 * tauxEUR, 0.01, 'EUR');
    const attenduUSD = E.coutMargeIBKR(-5000, 'USD', FX, D.CASH_YIELDS.wioSavings).coutAnnuelEUR;
    proche(usd.financement.coutAnnuelEUR, attenduUSD, 0.01, 'USD');
  });

  t('le financement total = EUR + USD + JPY, publié à part (estimation annualisée)', () => {
    const jpy = cv.accounts.find((a) => a.label === 'IBKR Cash JPY');
    const attendu = eur.financement.coutAnnuelEUR + usd.financement.coutAnnuelEUR + (jpy.financement ? jpy.financement.coutAnnuelEUR : 0);
    proche(cv.financement.coutAnnuelEUR, attendu, 0.01);
    assert.equal(cv.financement.estimation, true);
    proche(cv.resultatCash.netEUR, cv.coupleFrame.grossInterest - attendu, 0.01, 'net = intérêts − financement');
  });

  t('manque à gagner unique : barres = diagnostic', () => {
    const resume = cv.diagnostics.find((d) => d.category === 'summary');
    proche(resume.totalMissedAnn, cv.coupleFrame.gapToPotential, 0.001);
  });

  t('les soldes débiteurs ne réduisent pas le manque à gagner', () => {
    const neutre = avec(0, 0).cashView;
    proche(cv.coupleFrame.gapToPotential, neutre.coupleFrame.gapToPotential, 0.001);
    proche(cv.byOwner.Amine.gapToPotential, neutre.byOwner.Amine.gapToPotential, 0.001, 'Amine');
  });

  t('le tableau (Σ manque par compte positif) donne le même chiffre', () => {
    const somme = cv.accounts.filter((a) => !a.isDebt && a.valEUR > 0)
      .reduce((x, a) => x + Math.max(0, a.valEUR * (cv.refYield - (a.yield || 0))), 0);
    proche(somme, cv.coupleFrame.gapToPotential, 0.01);
  });

  t('la dette reste comptée une seule fois : le NW ne bouge que du solde, pas du coût', () => {
    const neutre = avec(0, 0);
    const deltaSolde = -10000 + (-5000 / FX.USD);
    proche(s.couple.nw - neutre.couple.nw, deltaSolde, 1, 'NW');
    // Cash non productif : le débit est déjà dans le bancaire (net) ; le coût n'y est jamais ajouté.
    proche(s.cashView.nonProductif.bancaire, s.cashView.totalNonYielding, 0.001);
  });

  t('un solde positif ne porte aucun financement', () => {
    const pos = avec(25000, 0).cashView.accounts.find((a) => a.label === 'IBKR Cash EUR');
    assert.equal(pos.financement, null);
  });

  // ── Crédit IBKR anticipé (virement du week-end) ──
  const ib = D.PORTFOLIO.amine.ibkr;
  t('crédit anticipé : solde utilisé = solde observé + crédits anticipés (données)', () => {
    const anticipes = (ib.creditsAnticipes || []).filter((c) => c.devise === 'EUR' && c.statut === 'anticipé');
    proche(ib.cashEUR, ib.cashEURObserve + anticipes.reduce((x, c) => x + c.montant, 0), 0.005);
  });
  t('crédit anticipé : la ligne IBKR EUR le dit, avec le solde observé', () => {
    const l = E.compute(D.PORTFOLIO, FX, 'static').cashView.accounts.find((a) => a.label === 'IBKR Cash EUR');
    if (!(ib.creditsAnticipes || []).some((c) => c.statut === 'anticipé')) return;
    assert.equal(l.anticipe, true);
    assert.equal(l.soldeObserve, ib.cashEURObserve);
    assert.ok(l.creditsAnticipes[0].envoyeLe && l.creditsAnticipes[0].montant > 0);
  });
  t('crédit anticipé : un seul dépôt pour chaque virement', () => {
    for (const c of ib.creditsAnticipes || []) {
      const n = ib.deposits.filter((d) => d.date === c.depot && d.amount === c.montant && d.currency === c.devise).length;
      assert.equal(n, 1, c.id + ' : ' + n + ' dépôt(s)');
    }
  });
  t('rapprochement : à réception, le patrimoine ne bouge pas', () => {
    if (!(ib.creditsAnticipes || []).length) return;
    const avant = E.compute(D.PORTFOLIO, FX, 'static');
    const P = structuredClone(D.PORTFOLIO);
    P.amine.ibkr.cashEURObserve = P.amine.ibkr.cashEUR;   // le relevé montre enfin le crédit
    P.amine.ibkr.creditsAnticipes = [];
    const apres = E.compute(P, FX, 'static');
    proche(apres.couple.nw, avant.couple.nw, 0.001, 'NW');
    assert.equal(apres.cashView.accounts.find((a) => a.label === 'IBKR Cash EUR').anticipe, undefined);
  });

  console.log(ko ? '\n✗ ' + ko + ' échec(s)' : '\n✓ vue Cash : financement IBKR');
  process.exit(ko ? 1 : 0);
})();
