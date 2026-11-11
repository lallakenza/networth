// Comptabilité ELM 2025, durée des composants, fiscalité et scénarios distincts des faits.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-lmnp-'));
for (const f of ['data.js', 'engine.js', 'facturation_contract.js']) {
  const src = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  fs.writeFileSync(path.join(tmp, f), src.replace(/\?v=\d+/g, ''));
}
let erreurs = 0;
const t = (nom, fn) => { try { fn(); console.log('✓', nom); } catch (e) { erreurs++; console.error('✗', nom, e.message); } };
const proche = (a, b, tol = .01) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
(async () => {
  const D = await import('file://' + path.join(tmp, 'data.js'));
  const E = await import('file://' + path.join(tmp, 'engine.js'));
  const plan = D.IMMO_CONSTANTS.lmnp.rueil;
  const s = E.compute(structuredClone(D.PORTFOLIO), { ...D.FX_STATIC }, 'static');
  const projection = s.immoView.lmnpRueil;
  const y = a => projection.indexe.find(l => l.annee === a);
  t('terrain et mobilier séparés ; dotation 2025 conforme à la liasse', () => {
    proche(plan.confirme.terrain + plan.confirme.construction, 290000);
    proche(plan.confirme.composantes.filter(c => c.type === 'immobilier').reduce((n, c) => n + c.base, 0), 246500);
    proche(E.dotationsLmnp(plan, 2025).reduce((n, c) => n + c.dotation, 0), 2417, .5);
    proche(projection.annuitePleine, 9888.6666667);
    assert.equal(plan.confirme.deficit2025, 289); assert.equal(plan.confirme.report39C2025, 266);
  });
  t('chaque composant s’épuise une seule fois, sans amortir le terrain', () => {
    proche(Array.from({ length: 77 }, (_, i) => E.dotationsLmnp(plan, 2025 + i)
      .reduce((n, c) => n + c.dotation, 0)).reduce((a, b) => a + b, 0), 252685);
    assert.equal(y(2031).dotMobilier, 0);
    assert.equal(E.dotationsLmnp(plan, 2038).find(c => c.id === 'interieur').dotation, 0);
    assert.ok(y(2030).dotMobilier > 0 && y(2030).dotMobilier < 1237);
  });
  t('le zéro impôt n’est plus permanent ; le résultat dépend des annuités et reports', () => {
    assert.ok(y(2031).impot > 0);
    assert.ok(y(2038).impot > y(2035).impot);
    for (const l of projection.indexe) {
      assert.ok(l.imposable >= 0 && l.stock39C >= -1e-8 && l.stockDeficits >= -1e-8);
      proche(l.recettes - l.sorties - l.impot, l.cfApresImpot);
    }
  });
  t('le remboursement du capital réduit le cash mais pas le résultat fiscal', () => {
    const amort = structuredClone(s.immoView.amortSchedules.rueil);
    const ligne = amort.schedule.find(l => l.date === '2026-06'); ligne.principal += 100;
    const autre = E.computeProjectionLmnpRueil(D.PORTFOLIO, amort).indexe[0];
    proche(autre.imposable, y(2026).imposable);
    proche(autre.cfAvantImpot, y(2026).cfAvantImpot - 100);
  });
  t('39 C ne crée pas de déficit ; le déficit 2025 expire après dix ans', () => {
    const p = structuredClone(D.PORTFOLIO); p.nezha.immo.rueil.loyerHC = 1000 / 12; p.nezha.immo.rueil.chargesLocataire = 0;
    const z = E.computeProjectionLmnpRueil(p, { schedule: [] }, { cfeAnnuelle: 0,
      comptabiliteAnnuelle: 0, taxeFonciereAnnuelle: 0, pnoAnnuelle: 0, coproAnnuelle: 0, indexationLoyer: 0 });
    assert.ok(z.indexe[0].stock39C > 266);
    assert.equal(z.indexe.find(l => l.annee === 2035).stockDeficits, 289);
    assert.equal(z.indexe.find(l => l.annee === 2036).stockDeficits, 0);
    assert.ok(z.indexe.every(l => l.imposable === 0));
  });
  t('loyer actuel inchangé, IRL futur simulé seulement à l’anniversaire', () => {
    assert.equal(y(2026).loyerHC, 15600); assert.equal(y(2026).provisions, 1800);
    proche(y(2027).loyerHC, 1300 * 9.1 + (1300 * 1.015) * 2.9);
    assert.ok(projection.stable.every(l => Math.abs(l.loyerHC - 15600) < .001));
    assert.equal(projection.hypotheses.cfeAnnuelle, 300);
    assert.equal(projection.plan.hypotheses.dpeDuLotConfirme, false);
  });
  t('le seuil de 23 000 n’est pas à lui seul une bascule LMP', () => {
    assert.match(E.statutLocationMeublee(37800, null, 23000), /À vérifier/);
    assert.match(E.statutLocationMeublee(37800, 50000, 23000), /^LMNP/);
    assert.match(E.statutLocationMeublee(37800, 0, 23000), /^LMP /);
    assert.match(y(2028).statut, /À vérifier/);
    assert.equal(y(2028).scenarioLmnpIsole, true);
  });
  t('18,6 % concerne les revenus meublés ; le nu et la plus-value gardent leurs taux', () => {
    assert.equal(E.normaliserFiscaliteImmo({ type: 'lmnp', ps: .172 }, 2026).ps, .186);
    assert.equal(E.normaliserFiscaliteImmo({ type: 'lmnp', ps: .172 }, 2024).ps, .172);
    assert.equal(E.normaliserFiscaliteImmo({ type: 'nu', ps: .172 }, 2026).ps, .172);
    assert.equal(D.EXIT_COSTS.psRate, .172);
    proche(y(2031).ps, y(2031).imposable * .186);
  });
  t('Villejuif sans plan comptable reste non déterminé, pas zéro', () => {
    const vj = s.immoView.properties.find(p => p.loanKey === 'villejuif');
    assert.equal(vj.fiscalite.totalImpot, null); assert.equal(vj.cfNetFiscal, null);
    assert.equal(vj.yieldNetFiscal, null);
  });
  t('la valeur d’entrée comptable ne remplace pas la valeur de marché du patrimoine', () => {
    const old = plan.confirme.valeurEntree; plan.confirme.valeurEntree = 900000;
    try { proche(E.compute(structuredClone(D.PORTFOLIO), { ...D.FX_STATIC }, 'static').couple.nw, s.couple.nw); }
    finally { plan.confirme.valeurEntree = old; }
  });
  t('la sortie actuelle réintègre seulement l’immobilier déduit documenté', () => {
    const r = s.immoView.properties.find(p => p.loanKey === 'rueil');
    assert.equal(r.exitCosts.amortReintegration, 1882);
    assert.ok(y(2031).cumulImmo > r.exitCosts.amortReintegration);
    assert.ok(y(2031).cumulImmo < 1882 + projection.indexe.filter(l => l.annee <= 2031).reduce((n,l) => n+l.amortDeduit,0));
  });
  t('le graphique de budget complet utilise le même Rueil que la projection LMNP', () => {
    const l = s.immoView.cfProjection.find(l => l.annee === 2031);
    proche(l.parBien.rueil, y(2031).cfAvantImpot / 12);
    proche(l.total, Object.values(l.parBien).reduce((a,b) => a+b,0));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = erreurs ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
