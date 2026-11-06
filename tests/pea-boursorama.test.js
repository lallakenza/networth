#!/usr/bin/env node
// ============================================================================
// PEA Boursorama — le tableau de bord confronté à l'archive RGPD BoursoBank du 6 novembre 2026.
//
// L'archive contient 54 avis d'opéré du PEA (22/07/2021 → 11/03/2025) et l'IFU 2025, qui porte la
// clôture du plan : valeur liquidative 69 052 €, versements cumulés 66 000 €, gain 3 052 €. Le
// compte étant clos et vidé, l'identité « retraits − versements = P&L total » est exacte et sert
// d'ancre. Les DATES des versements sont estimées ; leur total, lui, ne l'est pas.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-pea-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}

let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };
const centimes = (a, b, quoi) => assert.ok(Math.abs(a - b) < 0.005, quoi + ' : ' + a + ' ≠ ' + b);

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const pea = D.PORTFOLIO.amine.pea;
  const trades = D.PORTFOLIO.amine.allTrades.filter((x) => x.source === 'pea');
  const s = E.compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
  const av = s.actionsView;
  const somme = (l, f) => l.reduce((x, y) => x + f(y), 0);

  t('54 avis d\'opéré, du 22/07/2021 au 11/03/2025, montants nets des avis', () => {
    assert.equal(trades.length, 54);
    assert.equal(trades.map((x) => x.date).sort()[0], '2021-07-22');
    assert.equal(trades.map((x) => x.date).sort().pop(), '2025-03-11');
    centimes(somme(trades.filter((x) => x.type === 'buy'), (x) => x.cost), 81263.88, 'achats nets');
    centimes(somme(trades.filter((x) => x.type === 'sell'), (x) => x.proceeds), 81969.53, 'ventes nettes');
  });

  t('toutes les lignes sont soldées à la clôture', () => {
    const q = {};
    for (const x of trades) q[x.ticker] = (q[x.ticker] || 0) + (x.type === 'buy' ? x.qty : -x.qty);
    for (const [k, v] of Object.entries(q)) assert.ok(Math.abs(v) < 1e-9, k + ' : ' + v);
  });

  t('IFU 2025 : versements 66 000 €, retrait 69 052 €, P&L = retraits − versements', () => {
    const vers = somme(pea.deposits.filter((d) => d.amount > 0), (d) => d.amount);
    const ret = somme(pea.deposits.filter((d) => d.amount < 0), (d) => d.amount);
    centimes(vers, pea.cloture.versementsCumules, 'versements');
    centimes(-ret, pea.cloture.valeurLiquidative, 'retrait de clôture');
    centimes(pea.totalPLAllComponents, -ret - vers, 'identité du compte clos');
    centimes(pea.totalPLAllComponents, pea.cloture.gain, 'gain de l\'IFU');
    assert.ok(pea.deposits.filter((d) => d.amount > 0).every((d) => d.estime === true), 'les dates de versement sont marquées estimées');
  });

  t('décomposition : titres + dividendes estimés + écart non détaillé = P&L total', () => {
    centimes(pea.resultatTitres, somme(trades, (x) => x.type === 'sell' ? x.proceeds : -x.cost), 'résultat des titres');
    centimes(somme(pea.dividendesEstimesDetail, (d) => d.montant), pea.dividendesEstimes, 'dividendes estimés');
    centimes(pea.resultatTitres + pea.dividendesEstimes + pea.ecartNonDetaille, pea.totalPLAllComponents, 'décomposition');
  });

  t('trésorerie reconstituée jamais négative avec les versements estimés', () => {
    const ev = [
      ...pea.deposits.map((d) => [d.date, 0, d.amount]),
      ...trades.map((x) => [x.date, 1, x.type === 'buy' ? -x.cost : x.proceeds]),
      ...pea.dividendesEstimesDetail.map((d) => [d.date, 0, d.montant]),
    ].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
    let cash = 0;
    for (const [d, , m] of ev) { cash += m; assert.ok(cash > -0.01 || d === '2025-03-17', 'trésorerie négative le ' + d + ' : ' + cash.toFixed(2)); }
  });

  t('le moteur expose le PEA : P&L réalisé, net déployé, 14 positions clôturées', () => {
    centimes(av.peaRealizedPL, 3052, 'P&L réalisé');
    centimes(av.peaDepositsNet, -3052, 'net déployé');
    assert.equal(av.peaClosedPositions.length, 14);
    centimes(somme(av.peaClosedPositions, (p) => p.pl), 705.65, 'P/L du tableau');
    centimes(av.comptesClosRealizedPL, av.degiroRealizedPL + av.peaRealizedPL, 'comptes clos');
  });

  t('EQUITY_HISTORY : colonne pea de juillet 2021 à mars 2025, total = somme des colonnes', () => {
    const lignes = D.EQUITY_HISTORY.filter((h) => typeof h.pea === 'number');
    assert.equal(lignes[0].date, '2021-07-31');
    assert.equal(lignes[lignes.length - 1].date, '2025-03-31');
    assert.equal(lignes.length, 45);
    assert.equal(lignes[lignes.length - 1].pea, 0, 'plan clos et vidé au 31/03/2025');
    for (const h of D.EQUITY_HISTORY) {
      const s2 = (h.degiro || 0) + (h.espp || 0) + (h.ibkr || 0) + (h.pea || 0) + (h.sgtm || 0);
      assert.ok(Math.abs(s2 - h.total) <= 1, h.date + ' : total ' + h.total + ' ≠ ' + s2);
    }
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(ko === 0 ? '\n✅ PEA Boursorama : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
