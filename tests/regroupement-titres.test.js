#!/usr/bin/env node
// ============================================================================
// Divisions et regroupements des titres détenus (v561).
//
// ETHA a fait un regroupement 1:3 le 06/10/2026. Le site a continué à compter 1 100 parts au cours
// d'après (≈ 58 USD au lieu de ≈ 19) : les snapshots des 07 au 09/10 portaient la ligne ×3
// (+39 600 € fictifs). Ce test protège :
//   1. la position et le journal dans les mêmes unités (Σ parts achetées × splitFactor = parts) ;
//   2. l'historique des prix ramené aux nouvelles unités, quel que soit son état de fusion ;
//   3. la correction des snapshots écrits pendant l'intervalle, et d'eux seuls.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-regroup-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}

let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };

// Série fictive : clôtures ≈ 20 en anciennes unités, ≈ 60 en nouvelles.
const jours = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'];
const nouv = [60.45, 60.84, 60.36, 61.11, 60.33, 61.29, 60.89, 58.10];
const anc = nouv.map((c) => c / 3);

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const ev = D.REGROUPEMENTS_TITRES.find((r) => r.ticker === 'ETHA');
  const serie = (closes, n = closes.length) => ({ tickers: { ETHA: { dates: jours.slice(0, n), closes: closes.slice(0, n) } } });
  const egal = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

  console.log('\n── Regroupements et divisions ──');

  t('le regroupement ETHA du 06/10/2026 est déclaré (facteur 1/3, témoin en anciennes unités)', () => {
    assert.ok(ev, 'REGROUPEMENTS_TITRES.ETHA absent');
    assert.equal(ev.date, '2026-10-06');
    assert.ok(Math.abs(ev.facteur - 1 / 3) < 1e-12);
    assert.ok(ev.temoin.cours > 15 && ev.temoin.cours < 30, 'le témoin est un cours d’AVANT (≈ 20 USD)');
  });

  t('chaque regroupement : trades antérieurs marqués, position = Σ achats × splitFactor', () => {
    for (const r of D.REGROUPEMENTS_TITRES) {
      const trades = D.PORTFOLIO.amine.ibkr.trades.filter((x) => x.ticker === r.ticker && (x.type === 'buy' || x.type === 'sell'));
      for (const x of trades) {
        const attendu = x.date < r.date ? r.facteur : 1;
        assert.ok(Math.abs((x.splitFactor || 1) - attendu) < 1e-12, r.ticker + ' ' + x.date + ' : splitFactor ' + x.splitFactor + ' au lieu de ' + attendu);
      }
      const net = trades.reduce((s, x) => s + (x.type === 'buy' ? 1 : -1) * x.qty * (x.splitFactor || 1), 0);
      const pos = D.PORTFOLIO.amine.ibkr.positions.find((p) => p.ticker === r.ticker);
      assert.ok(pos, r.ticker + ' : position absente');
      assert.ok(Math.abs(pos.shares - net) < 0.001, r.ticker + ' : ' + pos.shares + ' parts en position, ' + net + ' au journal');
    }
  });

  t('ETHA vaut ≈ 366,67 × cours, et son coût reste celui payé (≈ 20 377 USD)', () => {
    const s = E.compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
    const p = s.actionsView.ibkrPositions.find((x) => x.ticker === 'ETHA');
    const pos = D.PORTFOLIO.amine.ibkr.positions.find((x) => x.ticker === 'ETHA');
    assert.ok(Math.abs(p.valEUR - pos.shares * pos.price / D.FX_STATIC.USD) < 1, 'valeur ≠ parts × cours');
    const coutUSD = pos.shares * pos.costBasis;
    assert.ok(Math.abs(coutUSD - 20377) < 25, 'coût ' + coutUSD.toFixed(0) + ' USD');
    // Tout a été acheté en 2026 : le P&L YTD est la valeur moins l'investi, sans prix d'ouverture.
    const investi = 20377 / D.FX_STATIC.USD;
    assert.ok(Math.abs(p.ytdPL - (p.valEUR - investi)) < 30, 'YTD ' + p.ytdPL + ' — les parts de départ ne sont pas nulles');
  });

  t('historique fusionné (anciennes unités puis nouvelles) : ramené aux nouvelles, sans saut', () => {
    const h = serie(anc.slice(0, 4).concat(nouv.slice(4)));
    const c = E.normaliserRegroupements(h, D.REGROUPEMENTS_TITRES);
    assert.equal(c.length, 1);
    assert.ok(egal(h.tickers.ETHA.closes, nouv), JSON.stringify(h.tickers.ETHA.closes));
  });

  t('idempotente : une série déjà ajustée n’est pas touchée, même rappelée', () => {
    const h = serie(nouv.slice());
    assert.equal(E.normaliserRegroupements(h, D.REGROUPEMENTS_TITRES).length, 0);
    const m = serie(anc.slice(0, 4).concat(nouv.slice(4)));
    E.normaliserRegroupements(m, D.REGROUPEMENTS_TITRES);
    E.normaliserRegroupements(m, D.REGROUPEMENTS_TITRES);
    assert.ok(egal(m.tickers.ETHA.closes, nouv));
  });

  t('série arrêtée avant l’événement : reconnue par le témoin (anciennes ou nouvelles unités)', () => {
    const vieille = serie(anc.slice(), 5);   // arrêtée au 02/10, anciennes unités
    E.normaliserRegroupements(vieille, D.REGROUPEMENTS_TITRES);
    assert.ok(egal(vieille.tickers.ETHA.closes, nouv.slice(0, 5)));
    const neuve = serie(nouv.slice(), 5);    // arrêtée au 02/10, déjà ajustée (backfill récent)
    assert.equal(E.normaliserRegroupements(neuve, D.REGROUPEMENTS_TITRES).length, 0);
  });

  t('fusion alternée (nouvelles, anciennes, nouvelles) : chaque segment ramené une seule fois', () => {
    const h = serie(nouv.slice(0, 2).concat(anc.slice(2, 4), nouv.slice(4)));
    E.normaliserRegroupements(h, D.REGROUPEMENTS_TITRES);
    assert.ok(egal(h.tickers.ETHA.closes, nouv), JSON.stringify(h.tickers.ETHA.closes));
  });

  // Snapshot réel minimal : ETHA à 59 526 € (×3) le 07/10.
  const snap = (date, capturedAt, eur = 59526) => ({
    date, capturedAt, data: {
      total: { couple: 801489, amine: 640000, nezha: 161489 },
      views: { couple: { stocks: 300614, nwRef: 801489 }, amine: { stocks: 280000, nwRef: 640000 }, nezha: { stocks: 20614, nwRef: 161489 } },
      stocks: { total: 310884, ibkrNAV: 253084, unrealizedPL: 40000, positions: { ETHA: { eur, pl: 42000 }, IBIT: { eur: 51713, pl: 4000 } } },
      kpis: { liquid: 600000 }, meta: { fx: { USD: 1.13 } },
    },
  });

  t('les snapshots écrits entre le regroupement et la correction perdent les deux tiers d’ETHA', () => {
    const p = D.SOLDES_RETROACTIFS.etha && D.SOLDES_RETROACTIFS.etha[0];
    assert.ok(p && p.titre === 'ETHA' && Math.abs(p.facteurValeur - 1 / 3) < 1e-12, 'période ETHA absente du registre');
    assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(p.captureAvant) && p.avantVersion === 'v561', 'bornes de la correction');
    const r = snap('2026-10-07', '2026-10-07T00:34:10Z');
    E.appliquerSoldesRetroactifs([r], { etha: D.SOLDES_RETROACTIFS.etha }, D.FX_STATIC);
    const delta = Math.round(59526 / 3) - 59526;
    assert.equal(r.data.stocks.positions.ETHA.eur, 59526 + delta);
    assert.equal(r.data.stocks.positions.IBIT.eur, 51713, 'les autres lignes ne bougent pas');
    assert.equal(r.data.stocks.total, 310884 + delta);
    assert.equal(r.data.total.couple, 801489 + delta);
    assert.equal(r.data.total.amine, 640000 + delta);
    assert.equal(r.data.total.nezha, 161489, 'ETHA est sur le compte d’Amine');
    assert.equal(r.data.views.couple.stocks, 300614 + delta);
    assert.equal(r.data.views.amine.nwRef, 640000 + delta);
    assert.equal(r._dataBrute.stocks.positions.ETHA.eur, 59526, 'le brut reste intact');
    assert.ok(r.corrections.some((c) => /ETHA/.test(c.compte)));
  });

  t('avant le regroupement (06/10 à 01:42) et après la correction : rien n’est touché', () => {
    const p = D.SOLDES_RETROACTIFS.etha[0];
    const avant = snap('2026-10-06', '2026-10-06T01:42:00Z', 20015);
    const apres = snap(p.au, new Date(Date.parse(p.captureAvant) + 60000).toISOString(), 19000);
    // Un snapshot du navigateur en v561, pris avant la borne horaire, porte déjà le correctif.
    const corrige = { ...snap('2026-10-09', '2026-10-09T17:00:00Z', 19000), appVersion: 'v561' };
    const ancien = { ...snap('2026-10-09', '2026-10-09T15:30:00Z'), appVersion: 'v560' };
    E.appliquerSoldesRetroactifs([avant, apres, corrige, ancien], { etha: D.SOLDES_RETROACTIFS.etha }, D.FX_STATIC);
    assert.equal(avant.corrections, null);
    assert.equal(apres.corrections, null);
    assert.equal(corrige.corrections, null, 'un snapshot v561 ne doit pas être corrigé deux fois');
    assert.ok(ancien.corrections, 'un snapshot v560 du 09/10 reste à corriger');
    assert.equal(avant.data.stocks.positions.ETHA.eur, 20015);
  });

  console.log(ko === 0 ? '\n✅ Regroupements : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
