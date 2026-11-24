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

  t('IBKR au connecteur du 24/11/2026 : 110 AIR, 170 VWCE, 40 GOOGL, 120 NVDA, 500 ANAU, 167 ACN, cash EUR/USD/JPY/AED', () => {
    const pos = (tk) => P.amine.ibkr.positions.find((p) => p.ticker === tk);
    assert.equal(pos('AIR.PA').shares, 110, '50 Airbus vendues le 09/11, 40 le 10/11');
    assert.equal(pos('VWCE.DE').shares, 170);
    assert.equal(pos('GOOGL').shares, 40);
    assert.equal(pos('NVDA').shares, 120, '120 NVIDIA achetées le 18/11');
    assert.equal(pos('ANAU.PA').shares, 500, '500 ANAU achetées le 20/11');
    assert.equal(P.amine.espp.shares, 167, 'les 167 ACN venues d\'UBS, chez IBKR depuis le 09/10');
    // v601 — +6 000 € virés depuis Revolut le 07/11, reçus le 07/11 (e-mail IBKR du 09/11) : un seul dépôt.
    const depot = P.amine.ibkr.deposits.filter((d) => d.date === '2026-11-07' && d.currency === 'EUR').reduce((s, d) => s + d.amount, 0);
    assert.equal(depot, 6000);
    assert.equal((P.amine.ibkr.creditsAnticipes || []).length, 0, 'crédit rapproché : plus rien d\'anticipé');
    assert.ok(Math.abs(P.amine.ibkr.cashEUR - P.amine.ibkr.cashEURObserve) < 0.005, 'solde utilisé = solde observé');
    assert.equal(P.amine.ibkr.cashUSD, 0);
    assert.equal(P.amine.ibkr.cashAED, 0, '30 000 AED repartis vers Wio le 12/11');
    assert.equal(P.amine.ibkr.cashJPY, -1608111.36);
    // Les soldes se reconstituent au centime à partir des mouvements depuis le 09/10.
    const vente = P.amine.ibkr.trades.find((t) => t.date === '2026-11-09' && t.ticker === 'AIR.PA' && t.type === 'sell');
    assert.ok(vente && vente.qty === 50 && vente.proceeds === 10135, 'vente AIR du 09/11');
    const vente2 = P.amine.ibkr.trades.find((t) => t.date === '2026-11-10' && t.ticker === 'AIR.PA' && t.type === 'sell');
    assert.ok(vente2 && vente2.qty === 40 && vente2.proceeds === 8378, 'vente AIR du 10/11');
    // v613 — 18 au 24/11 : change EUR→USD, 500 ANAU, deux virements Wio (25 000 + 20 000), retrait vers la BP.
    const tr = P.amine.ibkr.trades;
    const fx = tr.find((t) => t.date === '2026-11-18' && t.ticker === 'EUR.USD');
    const anau = tr.find((t) => t.date === '2026-11-20' && t.ticker === 'ANAU.PA');
    const nvda = tr.find((t) => t.date === '2026-11-18' && t.ticker === 'NVDA');
    const mouvEUR = P.amine.ibkr.deposits.filter((d) => d.currency === 'EUR' && d.date >= '2026-11-12').reduce((s, d) => s + d.amount, 0);
    assert.ok(fx && anau && nvda, 'trades du 18 et du 20/11');
    assert.ok(Math.abs(-2517.19 - 3402.8 - 3 - 16422 - 8.21 - 8.65 + depot + vente.proceeds + vente.commission + vente2.proceeds + vente2.commission
      - fx.qty + fx.commission - anau.cost + anau.commission + mouvEUR - P.amine.ibkr.cashEUR) < 0.01,
      'EUR = solde du 09/10 − VWCE − intérêts d\'octobre + 6 000 + ventes AIR − change − ANAU + virements − retrait');
    for (const tk of ['AIR.PA', 'NVDA', 'ANAU.PA']) {
      const n = tr.filter((t) => t.ticker === tk).reduce((x, t) => x + (t.type === 'buy' ? t.qty : t.type === 'sell' ? -t.qty : 0), 0);
      assert.equal(n, pos(tk).shares, 'journal ' + tk + ' = position');
    }
    // USD : cash UBS via Wise − 40 GOOGL + change − 120 NVDA ; IBKR affiche 0 pour −0,25 (écart documenté).
    assert.ok(Math.abs(2729.33 - 11240 - 1 + fx.targetAmount - nvda.cost + nvda.commission - P.amine.ibkr.cashUSD) < 0.3, 'USD reconstitué');
  });

  console.log(ko === 0 ? '\n✅ Courtiers : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
