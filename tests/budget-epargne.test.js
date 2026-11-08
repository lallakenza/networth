#!/usr/bin/env node
// ============================================================================
// Budget — épargne déclarée vs surplus, flux immo, logement aux EAU (v599).
//
// Protège :
//   1. deux notions distinctes et toujours des FRACTIONS : taux d'épargne déclaré (épargne déclarée
//      ÷ revenus) et taux de surplus avant dépenses variables (surplus ÷ revenus) ;
//   2. un seul total immobilier : cash-flow consolidé = budget = vue immobilière, assurance d'un
//      bien non livré comprise, sans loyer futur ;
//   3. logement aux EAU : loyer récurrent = loyer du bail ; frais d'agence et dépôt hors du poste
//      récurrent ; le dépôt est la créance CREP11.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-budget-'));
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
  const s = E.compute(D.PORTFOLIO, FX, 'static');
  const cf = E.computeCashFlow(s, D.PORTFOLIO, FX);
  console.log('\n── Budget : épargne, flux immo, logement EAU ──');

  t('taux d\'épargne déclaré = épargne déclarée ÷ revenus (fraction)', () => {
    assert.equal(cf.epargneDeclaree, D.DECLARED_MONTHLY_SAVINGS_EUR);
    proche(cf.tauxEpargneDeclaree, D.DECLARED_MONTHLY_SAVINGS_EUR / cf.incomeMonthly, 1e-12);
    assert.ok(cf.tauxEpargneDeclaree > 0 && cf.tauxEpargneDeclaree < 1, 'fraction attendue');
  });

  t('surplus avant dépenses variables = revenus − charges fixes, distinct de l\'épargne', () => {
    proche(cf.surplusStructurel, cf.incomeMonthly - cf.expensesMonthly, 1e-9);
    proche(cf.tauxSurplusStructurel, cf.surplusStructurel / cf.incomeMonthly, 1e-12);
    assert.ok(cf.tauxSurplusStructurel < 1, 'fraction, jamais un pourcentage déjà multiplié');
  });

  t('un seul total immobilier : cash-flow = budget = vue immobilière', () => {
    const immoCF = cf.incomeSources.filter((x) => x.type === 'Loyer').reduce((a, x) => a + x.monthlyEUR, 0);
    proche(immoCF, s.budgetView.investCFTotal, 0.5, 'cash-flow vs budget');
    proche(immoCF, s.immoView.totalCF, 0.5, 'cash-flow vs immo');
  });

  t('bien non livré : son flux réel (assurance) est repris, jamais son loyer futur', () => {
    const vj = s.immoView.properties.find((p) => p.conditional);
    if (!vj) return;
    const ligne = cf.incomeSources.find((x) => x.label.includes(vj.name || vj.loanKey));
    assert.ok(ligne, 'flux du bien conditionnel absent du cash-flow');
    proche(ligne.monthlyEUR, vj.cfReel, 0.001);
    assert.ok(ligne.monthlyEUR <= 0, 'aucun loyer futur avant livraison');
  });

  t('logement EAU : loyer du bail au budget, frais et dépôt hors du poste récurrent', () => {
    const L = D.PORTFOLIO.amine.logementEAU;
    const loyer = D.BUDGET_EXPENSES.find((e) => e.label === 'Loyer Dubai');
    assert.equal(loyer.amount, L.loyerAnnuelAED);
    assert.equal(loyer.freq, 'yearly');
    proche(L.paiement.montantAED, L.loyerAnnuelAED + L.fraisAgenceAED + L.tvaFraisAgenceAED + L.depotGarantieAED, 0.005, 'paiement = loyer + agence TTC + dépôt');
    proche(L.paiement.montantAED, L.paiement.virements.reduce((x, v) => x + v.montantAED, 0), 0.005, 'paiement = Σ virements');
    assert.ok(!D.BUDGET_EXPENSES.some((e) => /d[ée]p[ôo]t|agence/i.test(e.label)), 'dépôt ou frais d\'agence dans le budget récurrent');
    const crep = D.PORTFOLIO.amine.creances.items.find((c) => c.id === 'CREP11');
    assert.equal(crep.amount, L.depotGarantieAED);
    assert.equal(crep.currency, 'AED');
    assert.equal(L.debutBail, null, 'date de début non documentée : jamais devinée');
  });

  console.log(ko ? '\n✗ ' + ko + ' échec(s)' : '\n✓ budget : épargne, immo, logement');
  process.exit(ko ? 1 : 0);
})();
