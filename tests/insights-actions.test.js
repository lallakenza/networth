#!/usr/bin/env node
// ============================================================================
// Insights de la page Actions (v596).
//
// Protège :
//   1. les insights SUIVENT LE PÉRIMÈTRE : la vue Nezha voit son compte IBKR et une carte géo
//      complète ; la vue Amine n'inclut pas les lignes de Nezha ; la vue Couple, les deux ;
//   2. la projection des dates de détachement (colonne « Vendre avant » et insight WHT) :
//      jamais vide une fois les dates de l'année passées, montant par date (acompte ≠ solde) ;
//   3. les valeurs radiées n'utilisent jamais un cours live pour « si gardé » ;
//   4. la carte benchmark : relevé en ligne quand il existe, sinon relevé manuel non classé.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-insights-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}
let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const calcul = (P) => E.compute(P, { ...D.FX_STATIC }, 'static').actionsView;
  const av = calcul(D.PORTFOLIO);
  const de = (liste, type) => liste.find((i) => i.type === type);
  console.log('\n── Insights Actions ──');

  t('vue Nezha : son compte IBKR est listé, la carte géo a ses parts (100 %)', () => {
    const nz = av.insightsOwner.nezha;
    const h = de(nz, 'holdings');
    for (const p of D.PORTFOLIO.nezha.ibkr.positions) {
      assert.ok(h.positions.some((x) => x.label === p.label), p.ticker + ' absent du portefeuille de Nezha');
    }
    const g = de(nz, 'geo');
    assert.ok(Array.isArray(g.parts) && g.parts.length > 0, 'parts absentes : la carte s\'affichait vide');
    assert.ok(Math.abs(g.totalPct - 100) < 0.01);
    assert.equal(de(nz, 'track-record'), undefined, 'Nezha n\'a aucune vente : pas de track record');
  });

  t('vue Amine : aucune ligne de Nezha ; vue Couple : les deux comptes', () => {
    // Lignes PROPRES à Nezha : un titre détenu par les deux (VWCE) porte le même libellé des deux côtés.
    const tickersAmine = new Set(D.PORTFOLIO.amine.ibkr.positions.map((p) => p.ticker));
    const nomsNezha = D.PORTFOLIO.nezha.ibkr.positions.filter((p) => !tickersAmine.has(p.ticker)).map((p) => p.label);
    const am = de(av.insightsOwner.amine, 'concentration');
    const cp = de(av.insights, 'concentration');
    assert.ok(am.totalPositions < cp.totalPositions);
    const geoA = de(av.insightsOwner.amine, 'geo').parts.reduce((s, p) => s + p.valEUR, 0);
    const geoC = de(av.insights, 'geo').parts.reduce((s, p) => s + p.valEUR, 0);
    const geoN = de(av.insightsOwner.nezha, 'geo').parts.reduce((s, p) => s + p.valEUR, 0);
    assert.ok(Math.abs(geoA + geoN - geoC) < 1, 'Amine + Nezha = Couple (géo)');
    assert.ok(!am.top3.some((x) => nomsNezha.includes(x.label)));
  });

  t('prochainesExDates : une date passée est projetée d\'un an et marquée estimée', () => {
    const auj = new Date('2026-11-07T12:00:00');
    const r = E.prochainesExDates({ dps: 2, exDates: ['2026-05-20'], frequency: 'annual', confirmed: true }, auj);
    assert.equal(r.length, 1);
    assert.equal(r[0].iso, '2027-05-20');
    assert.equal(r[0].estimee, true);
    assert.equal(r[0].confirmed, false, 'une projection n\'est jamais « confirmée »');
    assert.equal(r[0].dps, 2);
  });

  t('prochainesExDates : montant par date, saisie future prioritaire sur la projection', () => {
    const auj = new Date('2026-11-07T12:00:00');
    const cal = { dps: 13, frequency: 'semi-annual', confirmed: true, exDates: [
      { date: '2026-04-28', dps: 7.5 }, { date: '2026-12-02', dps: 5.5, estimee: true, confirmed: false },
    ] };
    const r = E.prochainesExDates(cal, auj);
    assert.deepEqual(r.map((x) => [x.iso, x.dps]), [['2026-12-02', 5.5], ['2027-04-28', 7.5]]);
    assert.equal(r[0].estimee, true);
    // Une saisie future à moins de 45 jours de la projection l'emporte.
    const r2 = E.prochainesExDates({ dps: 1, exDates: ['2025-12-01', '2026-12-10'], confirmed: true }, auj);
    assert.deepEqual(r2.map((x) => x.iso), ['2026-12-10']);
    assert.equal(r2[0].estimee, false);
  });

  t('tableau dividendes : chaque ligne qui verse un dividende a une prochaine ex-date', () => {
    const s = E.compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
    const lignes = s.dividendAnalysis.positions;
    assert.ok(lignes.some((p) => p.dpsNative > 0));
    for (const p of lignes) if (p.dpsNative > 0) assert.ok(p.nextExDate, p.ticker + ' sans ex-date');
  });

  t('valeur radiée : « si gardé » au prix de radiation, jamais au cours live', () => {
    const P = structuredClone(D.PORTFOLIO);
    P._soldPrices = { VLTA: { price: 999, currency: 'USD' }, HTZ: { price: 999, currency: 'USD' } };
    const a = calcul(P);
    const vlta = a.degiroClosedPositions.find((c) => c.ticker === 'VLTA');
    const htz = a.degiroClosedPositions.find((c) => c.ticker === 'HTZ');
    assert.ok(vlta._radiee && htz._radiee);
    assert.ok(vlta._ifHeldPriceEUR < 1, 'VLTA au prix de rachat (0,86 $), pas au cours injecté');
    assert.equal(htz._ifHeldValueEUR, undefined, 'prix de radiation nul : pas de comparaison');
  });

  t('benchmarks : relevé en ligne classable ; repli manuel non classé', () => {
    const b0 = de(av.insights, 'benchmark').benchmarks;
    assert.equal(b0.live, false);
    assert.equal(b0.comparable, false, 'le relevé du 21/03 ne peut pas classer un portefeuille du jour');
    const P = structuredClone(D.PORTFOLIO);
    const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    P.market.benchmarks = { asOf: hier, items: [{ cle: 'sp500', label: 'S&P 500 (EUR)', ytd: 12.3, note: '' }] };
    const b1 = de(calcul(P).insights, 'benchmark').benchmarks;
    assert.equal(b1.live, true);
    assert.equal(b1.comparable, true);
    assert.equal(b1.items[0].cle, 'sp500');
  });

  console.log(ko ? '\n✗ ' + ko + ' échec(s)' : '\n✓ insights Actions');
  process.exit(ko ? 1 : 0);
})();
