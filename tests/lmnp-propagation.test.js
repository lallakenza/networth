// Exerce les vrais producteurs de séries : un supplément d'impôt doit traverser chaque vue.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-lmnp-vues-'));
for (const f of ['data.js', 'engine.js', 'facturation_contract.js', 'render.js', 'simulators.js',
  'charts.js', 'api.js', 'price_snapshot.js', 'deploiements.js']) {
  const src = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  fs.writeFileSync(path.join(tmp, f), src.replace(/\?v=\d+/g, ''));
}
const nodes = new Map(), charts = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, { id, value: '0', style: {}, textContent: '', innerHTML: '',
    getContext: () => ({ id }), appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } });
  return nodes.get(id);
};
globalThis.document = { getElementById: node, querySelectorAll: () => [], createElement: () => ({ style: {} }) };
globalThis.window = {};
globalThis.Chart = class {
  constructor(ctx, config) { this.data = config.data; this.options = config.options; charts.set(ctx.id, this); }
  destroy() {}
};
let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('✓', nom); } catch (e) { ko++; console.error('✗', nom, e.stack); } };
const proche = (a, b, tol = 2) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const copy = x => JSON.parse(JSON.stringify(x));
(async () => {
  const D = await import('file://' + path.join(tmp, 'data.js'));
  const E = await import('file://' + path.join(tmp, 'engine.js'));
  const S = await import('file://' + path.join(tmp, 'simulators.js'));
  const C = await import('file://' + path.join(tmp, 'charts.js'));
  const s = E.compute(structuredClone(D.PORTFOLIO), { ...D.FX_STATIC }, 'static');
  const iv = s.immoView, r = iv.properties.find(p => p.loanKey === 'rueil');
  const l = iv.lmnpRueil.indexe.find(l => l.annee === new Date().getFullYear());
  const cf = E.computeCashFlow(s, D.PORTFOLIO, D.FX_STATIC);
  t('fiche, rendement fiscal, synthèse fiscale et budget complet lisent le même Rueil', () => {
    proche(r.cfNetFiscal, l.cfApresImpot / 12, 1e-8);
    proche(r.yieldNetFiscal, r.cfNetFiscal * 12 / r.value * 100, 1e-8);
    proche(iv.totalCFNetFiscal, iv.properties.reduce((n,p) => n + (p.conditional ? p.cfReel : p.cfNetFiscal), 0), 1e-8);
    proche(cf.ajustementLmnp, r.cfNetFiscal - r.cf, 1e-8);
    proche(s.budgetView.ajustementLmnp, cf.ajustementLmnp, 1e-8);
    proche(s.budgetView.investCFScenarioLmnp, s.budgetView.investCFTotal + cf.ajustementLmnp, 1e-8);
    proche(cf.surplusScenarioLmnp, cf.netSavings + cf.ajustementLmnp, 1e-8);
    assert.equal(cf.epargneDeclaree, D.DECLARED_MONTHLY_SAVINGS_EUR);
  });
  const mois = 144;
  const choc = copy(s);
  for (const l of choc.immoView.lmnpRueil.indexe) { l.impot += 1200; l.cfApresImpot -= 1200; }
  t('graphe NW et objectifs : +1 200 €/an d’impôt enlève exactement 100 €/mois à Nezha et au Couple', () => {
    const p = E.projectNW(s, { horizonMois: mois }), q = E.projectNW(choc, { horizonMois: mois });
    proche(p.nezha.p50[0], s.nezha.nw, .51);
    for (const i of [1, 12, 60, mois]) {
      proche(p.nezha.p50[i] - q.nezha.p50[i], i * 100, 1);
      proche(p.couple.p50[i] - q.couple.p50[i], i * 100, 1);
      assert.equal(p.amine.p50[i], q.amine.p50[i]);
    }
  });
  t('deux biens de Nezha s’additionnent, indépendamment de leur ordre dans le portefeuille', () => {
    const inverse = copy(s); inverse.immoView.properties.reverse();
    const p = E.projectNW(s, {horizonMois:mois}), q = E.projectNW(inverse, {horizonMois:mois});
    assert.deepEqual(p.nezha.p50, q.nezha.p50);
    assert.deepEqual(p.couple.p50, q.couple.p50);
  });
  Object.entries({ cplSimSavings: 0, cplSimPctActions: 0, cplSimReturnActions: 0,
    cplSimHorizon: 12, cplSimStopYear: 0, nzSimAppreciation: 0, nzSimCashReturn: 0, nzSimHorizon: 12 })
    .forEach(([id,v]) => { node(id).value = String(v); });
  t('simulateur Couple : impôts futurs transmis au cash, avec son rendement cash explicite de 6 %', () => {
    S.runCoupleSimulator(s); const p = copy(charts.get('cplSimChart').data);
    S.runCoupleSimulator(choc); const q = charts.get('cplSimChart').data;
    const last = d => d.datasets.find(d => d.label === 'Net Worth Total').data[mois];
    const taux = Math.pow(1.06, 1/12) - 1;
    proche(last(p) - last(q), 100 * (Math.pow(1 + taux, mois) - 1) / taux);
    proche(p.datasets.find(d => d.label === 'Net Worth Total').data[0], s.couple.nw, 1);
  });
  t('simulateur Nezha : loyers et impôt futurs transmis au cash sans mois supplémentaire', () => {
    S.runNezhaSimulator(s); const p = copy(charts.get('nzSimChart').data);
    S.runNezhaSimulator(choc); const q = charts.get('nzSimChart').data;
    const serie = d => d.datasets.find(d => d.label === 'NW Total Nezha').data;
    proche(serie(p)[0], s.nezha.nw, 1);
    for (const i of [1, 12, 60, mois]) proche(serie(p)[i] - serie(q)[i], i * 100, 1);
    const cash0 = p.datasets.find(d => d.label === 'Cash + SGTM')._actual;
    assert.notEqual(cash0[1], cash0[0], 'les loyers nets ne doivent plus être omis');
  });
  t('douze mois = douze contributions dans les montants et dans la courbe', () => {
    node('cplSimSavings').value = '1000'; node('cplSimPctActions').value = '100'; node('cplSimHorizon').value = '1';
    S.runCoupleSimulator(s);
    const capital = charts.get('cplSimChart').data.datasets.find(d => d.label === 'Capital Investi')._actual;
    assert.equal(capital.length, 13); assert.equal(capital[12] - capital[0], 12000);
    assert.match(node('cplSimContrib').textContent, /12/);
  });
  t('revente : mêmes montants dans les trois graphiques et dans la source du tableau', () => {
    C.buildExitProjectionChart(s, r, 'exit');
    C.buildPropertyDetailCharts(s, r);
    C.buildImmoViewProjection(s);
    const sortie = charts.get('exit').data, detail = charts.get('propDetailEquityChart').data;
    const vue = charts.get('immoViewProjectionChart').data;
    for (const annee of [2028, 2030, 2032]) {
      const canon = E.projectionSortieRueil(iv, annee);
      proche(sortie.datasets.find(d => d.label === 'Net (ce que tu gardes)').data[sortie.labels.indexOf(String(annee))], canon.netEquity, .51);
      proche(detail.datasets.find(d => d.label === 'Equity nette').data[detail.labels.indexOf(String(annee))], canon.netEquity, .51);
      proche(vue.datasets.find(d => d.label === 'Rueil (net)').data[vue.labels.indexOf(String(annee))], canon.netEquity, .51);
      proche(iv.exitCostsByYearProp[annee].rueil, canon.exitCosts.totalExitCosts, 1e-8);
      const m = (annee - new Date().getFullYear()) * 12 + 5 - new Date().getMonth();
      proche(S.makeComputePropertyEquity(iv, 'rueil', r.value)(m), canon.netEquity, 1e-8);
    }
  });
  t('une vente aujourd’hui conserve le net et la seule déduction immobilière documentée', () => {
    const r0 = E.projectionSortieRueil(iv, new Date().getFullYear());
    assert.equal(r0.totalAmort, 1882);
    assert.equal(r0.netEquity, r.exitCosts.netEquityAfterExit);
  });
  t('une vente future mensuelle prorate les déductions immobilières de l’exercice, hors mobilier', () => {
    const a = E.projectionSortieRueil(iv, 2031, {date:'2031-06'});
    const b = E.projectionSortieRueil(iv, 2031, {date:'2031-12'});
    const l = iv.lmnpRueil.indexe.find(l => l.annee === 2031);
    proche(b.totalAmort - a.totalAmort, l.amortImmobilierDeduit / 2, 1e-8);
  });
  fs.rmSync(tmp, {recursive:true,force:true});
  process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
