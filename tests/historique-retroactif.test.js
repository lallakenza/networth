#!/usr/bin/env node
// ============================================================================
// Historique rétroactif — corriger un compte après coup sans réécrire les snapshots (v555).
//
// Les snapshots quotidiens sont en ajout seul. Quand on apprend tard le vrai solde d'un compte
// (dette de carte Wio Credit découverte le 07/10/2026), SOLDES_RETROACTIFS le déclare et
// appliquerSoldesRetroactifs() corrige À LA LECTURE. Ce test protège quatre propriétés :
//   1. le brut n'est jamais modifié ;
//   2. l'écart est reporté partout où il doit l'être (compte, cash, patrimoine du titulaire,
//      couple) et nulle part ailleurs (l'autre titulaire) ;
//   3. la fonction est idempotente (on la rappelle après le déverrouillage) ;
//   4. un snapshot qui porte déjà le bon solde n'est pas corrigé une seconde fois.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-retro-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}

let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };

// Un snapshot réel minimal, au format de buildDailySnapshot.
const snap = (date, extra = {}) => ({
  date, quality: 'live', appVersion: 'v553',
  data: {
    total: { couple: 780000, amine: 620000, nezha: 160000 },
    views: {
      couple: { stocks: 300000, cash: 320000, immo: 100000, other: 60000, nwRef: 780000 },
      amine: { stocks: 280000, cash: 250000, immo: 30000, other: 60000, nwRef: 620000 },
      nezha: { stocks: 20000, cash: 70000, immo: 70000, other: 0, nwRef: 160000 },
    },
    cash: { total: 320000, amine: 250000, nezha: 70000, accounts: { wio_savings: { eur: 118000, native: 498000, ccy: 'AED', owner: 'A' } } },
    meta: { fx: { AED: 4.2 }, appVersion: 'v553' },
    ...extra,
  },
});

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const { NOMS_SENSIBLES } = await import('file://' + path.join(RACINE, 'scripts', '_blocs_sensibles.mjs'));
  const SOLDES = {
    wio_credit: [{ du: '2026-09-09', au: '2026-10-06', natif: -69998.89, devise: 'AED', proprietaire: 'A', statut: 'provisoire' }],
  };
  const delta = -69998.89 / 4.2;

  console.log('\n── Historique rétroactif : soldes connus après coup ──');

  t('le registre suit la dette de carte Wio relevé par relevé, sans trou ni chevauchement', () => {
    const p = D.SOLDES_RETROACTIFS.wio_credit;
    assert.ok(Array.isArray(p) && p.length >= 8, 'un solde par cycle de relevé, de février à octobre 2026');
    assert.equal(p[0].du, '2026-02-08', 'la dette commence au relevé de février (premier non soldé)');
    for (let i = 1; i < p.length; i++) {
      const veille = new Date(new Date(p[i].du + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
      assert.equal(p[i - 1].au, veille, 'trou ou chevauchement entre ' + p[i - 1].au + ' et ' + p[i].du);
    }
    for (const x of p) {
      assert.ok(x.natif < 0, 'une dette de carte est négative');
      assert.equal(x.proprietaire, 'A');
      assert.equal(x.statut, 'établi', 'les soldes viennent des relevés');
      assert.ok(x.source);
    }
    const max = Math.min(...p.map((x) => x.natif));
    assert.equal(max, -75640.89, 'point haut du 08/08/2026');
    const dernier = p[p.length - 1];
    assert.equal(dernier.natif, -62857.96, 'relevé clos le 08/09/2026');
    assert.equal(dernier.captureAvant, '2026-10-07T08:46:19Z', 'la dette cesse au remboursement du 07/10');
  });

  t('un snapshot de la période voit le compte, le cash et le patrimoine d’Amine corrigés', () => {
    const [r] = E.appliquerSoldesRetroactifs([snap('2026-09-20')], SOLDES, D.FX_STATIC);
    const d = r.data;
    assert.equal(d.cash.accounts.wio_credit.native, -69998.89);
    assert.equal(d.cash.accounts.wio_credit.corrige, true);
    assert.equal(d.total.couple, Math.round(780000 + delta));
    assert.equal(d.total.amine, Math.round(620000 + delta));
    assert.equal(d.total.nezha, 160000, 'la carte est à Amine : Nezha ne bouge pas');
    assert.equal(d.cash.total, Math.round(320000 + delta));
    assert.equal(d.cash.amine, Math.round(250000 + delta));
    assert.equal(d.views.couple.nwRef, Math.round(780000 + delta));
    assert.equal(d.views.amine.cash, Math.round(250000 + delta));
    assert.equal(d.views.nezha.nwRef, 160000);
    assert.equal(d.views.couple.stocks, 300000, 'une correction de cash ne touche pas les actions');
    assert.deepEqual(r.corrections.map((c) => c.compte), ['wio_credit']);
    assert.equal(r.corrections[0].statut, 'provisoire');
  });

  t('le brut reste intact, et un snapshot hors période n’est pas touché', () => {
    const avant = snap('2026-09-20');
    const brut = JSON.stringify(avant.data);
    const hors = snap('2026-10-10');
    E.appliquerSoldesRetroactifs([avant, hors], SOLDES, D.FX_STATIC);
    assert.equal(JSON.stringify(avant._dataBrute), brut, 'la donnée brute ne doit jamais être modifiée');
    assert.equal(hors.data.total.couple, 780000);
    assert.equal(hors.corrections, null);
  });

  t('rappeler la fonction ne corrige pas deux fois (idempotence)', () => {
    const rows = [snap('2026-10-01')];
    E.appliquerSoldesRetroactifs(rows, SOLDES, D.FX_STATIC);
    const une = rows[0].data.total.couple;
    E.appliquerSoldesRetroactifs(rows, SOLDES, D.FX_STATIC);
    E.appliquerSoldesRetroactifs(rows, SOLDES, D.FX_STATIC);
    assert.equal(rows[0].data.total.couple, une);
  });

  t('un registre vide (données encore chiffrées) laisse le brut, puis la correction s’applique', () => {
    const rows = [snap('2026-10-01')];
    E.appliquerSoldesRetroactifs(rows, {}, D.FX_STATIC);
    assert.equal(rows[0].data.total.couple, 780000);
    E.appliquerSoldesRetroactifs(rows, SOLDES, D.FX_STATIC);
    assert.equal(rows[0].data.total.couple, Math.round(780000 + delta));
  });

  t('un snapshot qui enregistrait déjà le bon solde n’est pas corrigé', () => {
    const r = snap('2026-10-02');
    r.data.cash.accounts.wio_credit = { eur: Math.round(delta), native: -69998.89, ccy: 'AED', owner: 'A' };
    E.appliquerSoldesRetroactifs([r], SOLDES, D.FX_STATIC);
    assert.equal(r.data.total.couple, 780000);
    assert.equal(r.corrections, null);
  });

  t('le jour charnière : corrigé avant le remboursement, pas après', () => {
    const S = { wio_credit: [{ du: '2026-09-09', au: '2026-10-07', captureAvant: '2026-10-07T08:46:19Z', natif: -69998.89, devise: 'AED', proprietaire: 'A' }] };
    const avant = { ...snap('2026-10-07'), capturedAt: '2026-10-06T21:00:05Z' };
    const apres = { ...snap('2026-10-07'), capturedAt: '2026-10-07T21:00:05Z' };
    E.appliquerSoldesRetroactifs([avant, apres], S, D.FX_STATIC);
    assert.ok(avant.corrections, 'capturé avant le remboursement : la dette existait');
    assert.equal(apres.corrections, null, 'capturé après : déjà au bon solde, aucune correction');
    assert.ok(D.SOLDES_RETROACTIFS.wio_credit.some((p) => p.captureAvant === '2026-10-07T08:46:19Z'));
  });

  t('deux périodes qui se touchent un jour charnière ne s’appliquent jamais ensemble', () => {
    const S = { wio_savings: [
      { du: '2026-10-05', au: '2026-10-07', captureAvant: '2026-10-07T08:46:19Z', natif: 463000, devise: 'AED', proprietaire: 'A' },
      { du: '2026-10-07', au: '2026-10-09', captureApres: '2026-10-07T08:46:19Z', natif: 393000, devise: 'AED', proprietaire: 'A' },
    ] };
    const tot = { ...snap('2026-10-07'), capturedAt: '2026-10-07T00:34:10Z' };
    const tard = { ...snap('2026-10-07'), capturedAt: '2026-10-07T20:00:00Z' };
    const sansHeure = snap('2026-10-07');
    E.appliquerSoldesRetroactifs([tot, tard, sansHeure], S, D.FX_STATIC);
    assert.equal(tot.data.cash.accounts.wio_savings.native, 463000, 'avant 08:46 : 463 000');
    assert.equal(tard.data.cash.accounts.wio_savings.native, 393000, 'après 08:46 : 393 000');
    assert.equal(tot.corrections.length, 1, 'une seule période sur le jour charnière');
    assert.equal(sansHeure.corrections, null, 'sans heure de capture, on ne devine pas de quel côté on est');
  });

  t('la conversion AED → USDT du 04/10 ne crée ni ne détruit de patrimoine', () => {
    const R = D.SOLDES_RETROACTIFS;
    const le = (compte, date) => R[compte].find((p) => date >= p.du && date <= p.au && !p.captureApres);
    // Les trois jambes de l'échange : la sortie Wio (mouvement daté), la sortie Mashreq (veille et
    // lendemain tirés du relevé) et l'entrée Binance (USDT au coût).
    const sortieWio = D.PORTFOLIO.amine.uae.wioSavingsJournal.find((m) => m.date === '2026-10-04').montant;
    const dMashreq = le('mashreq', '2026-10-05').natif - le('mashreq', '2026-10-04').natif;
    const dBinance = le('binance', '2026-10-05').natif - 3717;
    assert.equal(sortieWio, -35000);
    assert.ok(Math.abs(dMashreq + 6027) < 0.01);
    const sommeUSD = (sortieWio + dMashreq) / 3.6725 + dBinance;
    assert.ok(Math.abs(sommeUSD) < 1, 'un échange au coût doit être neutre ; écart ' + sommeUSD.toFixed(2) + ' USD');
    assert.equal(le('binance', '2026-10-05').statut, 'provisoire', 'le nombre réel d’USDT reste à confirmer');
  });

  t('un snapshot sans patrimoine (rétroactif « actions seulement ») est laissé tel quel', () => {
    const r = { date: '2026-09-20', data: { stocks: { positions: {} } } };
    E.appliquerSoldesRetroactifs([r], SOLDES, D.FX_STATIC);
    assert.equal(r.corrections, null);
    assert.equal(r.data.cash, undefined);
  });

  t('sans taux de change dans le snapshot, le taux statique est utilisé', () => {
    const r = snap('2026-09-20');
    delete r.data.meta.fx;
    E.appliquerSoldesRetroactifs([r], SOLDES, { AED: 4 });
    assert.equal(r.data.total.couple, Math.round(780000 - 69998.89 / 4));
  });

  t('le registre est chiffré avec les autres blocs sensibles', () => {
    for (const n of ['SOLDES_RETROACTIFS', 'FONDS_DE_TIERS', 'ECARTS_DE_REGLEMENT']) {
      assert.ok(NOMS_SENSIBLES.includes(n), n + ' doit être chiffré');
    }
  });

  console.log(ko === 0 ? '\n✅ Historique rétroactif : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
