#!/usr/bin/env node
// ============================================================================
// Positions clôturées — « si gardé aujourd'hui » dans les unités d'aujourd'hui (v572).
//
// Le cours actuel d'un titre vendu vient de Yahoo, déjà ajusté des divisions et regroupements
// postérieurs. Le nombre de titres vendus doit donc être converti (splitFactor), et le cours lu dans
// SA devise de cotation. Ce test fige les événements connus (vérifiés sur les événements de split
// Yahoo et les communiqués des sociétés) et la conversion de devise.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-clot-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}
let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };

// Événements postérieurs aux ventes : facteur = titres d'aujourd'hui par titre de l'époque.
const EVENEMENTS = {
  WLN:  { facteur: 1 / 40, source: 'regroupement 1:40 du 15/06/2026' },
  UG:   { facteur: 1.742, source: 'fusion PSA → Stellantis, 16/01/2021' },
  AF:   { facteur: 0.1, source: 'regroupement 1:10, 31/08/2023' },
  ATO:  { facteur: 0.0001, source: 'regroupement 1:10 000, 24/04/2025' },
  CGC:  { facteur: 0.1, source: 'regroupement 1:10, 20/12/2023' },
  JUVE: { facteur: 0.1, source: 'regroupement 1:10, 22/01/2024' },
  GME:  { facteur: 4, source: 'division 4:1, 22/07/2022' },
  TSLA: { facteur: 15, source: 'divisions 5:1 (2020) et 3:1 (2022)' },
  IBM:  { facteur: 1.046, source: 'scission Kyndryl, 04/11/2021' },
  FDX:  { facteur: 1.241, source: 'scission FedEx Freight, 01/06/2026' },
};

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const P = D.PORTFOLIO;
  const tous = (P.amine.allTrades || []).concat(P.amine.ibkr.trades || []);
  console.log('\n── Positions clôturées : divisions, regroupements, devise ──');

  t('chaque vente d’un titre touché par un événement postérieur porte le bon facteur', () => {
    for (const [tk, ev] of Object.entries(EVENEMENTS)) {
      const ventes = tous.filter((x) => x.ticker === tk && x.type === 'sell' && !x.corporateAction);
      assert.ok(ventes.length, tk + ' : aucune vente');
      for (const v of ventes) assert.ok(Math.abs((v.splitFactor || 1) - ev.facteur) < 1e-9, tk + ' ' + v.date + ' : ' + v.splitFactor + ' au lieu de ' + ev.facteur + ' (' + ev.source + ')');
    }
  });

  t('devise de cotation : symbole Yahoo, pas devise du trade (UAL acheté en EUR, coté en USD)', () => {
    assert.equal(E.deviseCotation(tous.filter((x) => x.ticker === 'UAL')), 'USD');
    assert.equal(E.deviseCotation(tous.filter((x) => x.ticker === 'WLN')), 'EUR');
    assert.equal(E.deviseCotation(tous.filter((x) => x.ticker === 'JUVE')), 'EUR');
    assert.equal(E.deviseCotation([{ ticker: '4911.T', currency: 'JPY' }]), 'JPY');
  });

  t('« si gardé » : Worldline = 75 actions au cours d’aujourd’hui, UAL converti en euros', () => {
    const fx = { ...D.FX_STATIC };
    const pf = { ...P, _soldPrices: { WLN: { price: 9.848 }, UAL: { price: 60 } } };
    const s = E.compute(pf, fx, 'static');
    const clot = s.actionsView.allClosedPositions;
    const wln = clot.find((c) => c.ticker === 'WLN');
    assert.ok(Math.abs(wln._ifHeldValueEUR - 75 * 9.848) < 0.01, 'WLN si gardé : ' + wln._ifHeldValueEUR);
    const ual = clot.find((c) => c.ticker === 'UAL');
    assert.ok(Math.abs(ual._ifHeldPriceEUR - 60 / fx.USD) < 1e-6, 'UAL : cours USD non converti (' + ual._ifHeldPriceEUR + ')');
  });

  console.log(ko === 0 ? '\n✅ Positions clôturées : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
