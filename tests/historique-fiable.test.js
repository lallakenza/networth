#!/usr/bin/env node
// ============================================================================
// Historique fiable (v563) — chaque jour porte ce que l'on SAIT de lui.
//
//  1. Code périmé : une ligne écrite par une version déjà remplacée depuis 30 min est écartée ; un
//     jour qui n'a que de telles lignes prend le snapshot reconstitué, ou disparaît.
//  2. Relevés : le solde Mashreq / Wio de chaque snapshot est celui du relevé à l'instant de capture.
//  3. Les pièces disent la même chose que les lectures d'app connues.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-fiable-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js', 'deploiements.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}

let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };

const ligne = (jour, capture, version, couple, extra = {}) => ({
  snap_date: jour, captured_at: capture, quality: 'live',
  data: { total: { couple, amine: couple - 100000, nezha: 100000 }, meta: { appVersion: version }, ...extra },
});

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const { DEPLOIEMENTS } = await import('file://' + path.join(TMP, 'deploiements.js'));
  const { NOMS_SENSIBLES } = await import('file://' + path.join(RACINE, 'scripts', '_blocs_sensibles.mjs'));

  console.log('\n── Historique fiable ──');

  t('le journal des mises en ligne couvre l’historique et suit la version courante', () => {
    const v = Number(D.APP_VERSION.slice(1));
    assert.ok(DEPLOIEMENTS[433] && DEPLOIEMENTS[545], 'versions de l’été absentes');
    assert.ok(DEPLOIEMENTS[v], 'la version courante ' + D.APP_VERSION + ' doit être journalisée par le bump');
    const vs = Object.keys(DEPLOIEMENTS).map(Number).sort((a, b) => a - b);
    for (let i = 1; i < vs.length; i++) assert.ok(DEPLOIEMENTS[vs[i]] >= DEPLOIEMENTS[vs[i - 1]], 'ordre chronologique cassé à v' + vs[i]);
  });

  t('un onglet resté en v433 ne l’emporte plus sur le cron du même jour', () => {
    const rows = [ligne('2026-09-16', '2026-09-16T00:20:00Z', 'cron', 784085), ligne('2026-09-16', '2026-09-16T13:00:00Z', 'v433', 734849)];
    const [r] = E.selectionnerSnapshots(rows, DEPLOIEMENTS);
    assert.equal(r.data.total.couple, 784085);
    assert.ok(!r.perime);
  });

  t('une version à jour au moment de sa capture reste préférée au cron', () => {
    const rows = [ligne('2026-09-19', '2026-09-19T00:20:00Z', 'cron', 780000), ligne('2026-09-19', '2026-09-19T12:00:00Z', 'v550', 787000)];
    assert.equal(E.selectionnerSnapshots(rows, DEPLOIEMENTS)[0].data.total.couple, 787000);
  });

  t('un jour écrit seulement par du code périmé prend le snapshot reconstitué', () => {
    const rows = [ligne('2026-09-07', '2026-09-07T10:00:00Z', 'v433', 737610)];
    const sel = E.selectionnerSnapshots(rows, DEPLOIEMENTS);
    assert.equal(sel.length, 1);
    assert.ok(sel[0].perime);
    const lignes = sel.map((r) => ({ date: r.snap_date, capturedAt: r.captured_at, data: r.data, perime: r.perime }));
    E.appliquerSoldesRetroactifs(lignes, {}, D.FX_STATIC, { reconstruits: D.SNAPSHOTS_RECONSTRUITS });
    assert.ok(lignes[0].reconstruit);
    // La base est la reconstitution (la restatement Villejuif de la v564 ne touche que l'immobilier).
    assert.equal(lignes[0].data.views.couple.stocks, D.SNAPSHOTS_RECONSTRUITS['2026-09-07'].views.couple.stocks);
    assert.equal(lignes[0]._dataBrute.total.couple, 737610, 'la ligne brute reste celle de la base');
  });

  t('sans reconstitution, le jour périmé est neutralisé plutôt qu’affiché faux', () => {
    const lignes = [{ date: '2026-06-01', capturedAt: '2026-06-01T10:00:00Z', data: { total: { couple: 1 } }, perime: true }];
    E.appliquerSoldesRetroactifs(lignes, {}, D.FX_STATIC, { reconstruits: {} });
    assert.equal(lignes[0].data.total, undefined);
  });

  t('les huit jours sans ligne valide de septembre sont reconstitués, avec le moteur de l’époque', () => {
    const jours = Object.keys(D.SNAPSHOTS_RECONSTRUITS).sort();
    assert.deepEqual(jours, ['2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-14']);
    for (const j of jours) {
      const r = D.SNAPSHOTS_RECONSTRUITS[j];
      assert.match(r.meta.appVersion, /^reconstruit-v(502|542)$/, j);
      const c = r.views.couple;
      assert.ok(Math.abs(c.stocks + c.cash + c.immo + c.other - c.nwRef) <= 2, j + ' : catégories ≠ total');
    }
  });

  t('relevés : le solde vient du jour de la capture, heure de Dubaï', () => {
    const rel = D.RELEVES_QUOTIDIENS.mashreq;
    // Cron du 09/10 à 01:09 UTC (05:09 à Dubaï) : avant le salaire du jour → fin de journée du 08/10.
    assert.equal(E.soldeReleveA(rel, '2026-10-09T01:09:00Z'), 496262.52);
    // Capture du soir (20:00 à Dubaï) : le salaire de 50 000 est arrivé.
    assert.equal(E.soldeReleveA(rel, '2026-10-09T16:00:00Z'), 546262.52);
    assert.equal(E.soldeReleveA(rel, '2026-06-01T10:00:00Z'), null, 'hors période couverte');
  });

  t('relevés et lectures d’app concordent (07/10 et 19/09)', () => {
    const R = D.RELEVES_QUOTIDIENS;
    const fin = (c, d) => { const s = R[c].soldes; return Object.keys(s).sort().filter((x) => x <= d).map((x) => s[x]).pop(); };
    assert.equal(fin('wio_savings', '2026-10-07') + fin('wio_nezha', '2026-10-07'), 554140, 'épargne Wio totale lue dans l’app');
    assert.equal(fin('wio_savings', '2026-10-09'), D.PORTFOLIO.amine.uae.wioSavings);
    assert.equal(fin('wio_nezha', '2026-10-09'), D.PORTFOLIO.nezha.cash.wioAED);
    assert.equal(fin('wio_current', '2026-10-09'), D.PORTFOLIO.amine.uae.wioCurrent);
    assert.ok(Math.abs(fin('mashreq', '2026-10-09') - D.PORTFOLIO.amine.uae.mashreq) < 0.01);
    assert.equal(fin('wio_savings', '2026-09-19'), 498000, 'ventilation lue le 19/09');
  });

  t('un snapshot reçoit le solde du relevé et l’écart part au cash du bon titulaire', () => {
    const r = {
      date: '2026-09-02', capturedAt: '2026-09-02T00:30:00Z',
      data: {
        total: { couple: 800000, amine: 640000, nezha: 160000 },
        views: { couple: { cash: 330000, nwRef: 800000 }, amine: { cash: 260000, nwRef: 640000 }, nezha: { cash: 70000, nwRef: 160000 } },
        cash: { total: 330000, amine: 260000, nezha: 70000, accounts: { wio_current: { eur: 4, native: 18, ccy: 'AED', owner: 'A' } } },
        meta: { fx: { AED: 4.25 } },
      },
    };
    E.appliquerSoldesRetroactifs([r], {}, D.FX_STATIC, { releves: { wio_current: D.RELEVES_QUOTIDIENS.wio_current } });
    // 02/09 à 04:30 à Dubaï → fin de journée du 01/09 : 11 932,37 AED (les AED retirés de l'IBKR).
    assert.equal(r.data.cash.accounts.wio_current.native, 11932.37);
    const delta = (11932.37 - 18) / 4.25;
    assert.equal(r.data.total.amine, Math.round(640000 + delta));
    assert.equal(r.data.total.nezha, 160000);
  });

  // v564 — Villejuif au coût engagé dans tout l'historique.
  const snapVJ = (date, valorisation) => ({
    date, capturedAt: date + 'T00:30:00Z',
    data: {
      total: { couple: 800000, amine: 620000, nezha: 180000 },
      views: { couple: { immo: 116000, nwRef: 800000 }, amine: { immo: 11000, nwRef: 620000 }, nezha: { immo: 105000, nwRef: 180000 } },
      immo: { value: 677873, crd: 550862, equityNet: 116019, equityGross: 127011,
        properties: { villejuif: { value: 141159, crd: 96569, equityNet: 44590, equityGross: 44590, conditional: true, ...(valorisation ? { valorisation } : {}) } } },
    },
  });

  t('Villejuif d’avant la v543 est recalculé au coût engagé, sur le seul patrimoine de Nezha', () => {
    const r = snapVJ('2026-09-06');
    E.appliquerSoldesRetroactifs([r], {}, D.FX_STATIC, {});
    const A = D.VILLEJUIF_ACTE;
    const crd = E.villejuifCrdADate('2026-09-06').crd;
    const attendu = Math.round(A.appelsPayes.montant - crd);
    const vj = r.data.immo.properties.villejuif;
    assert.equal(vj.value, Math.round(A.appelsPayes.montant));
    assert.equal(vj.equityNet, attendu);
    assert.equal(vj.valorisation, 'cout-engage');
    const delta = attendu - 44590;
    assert.ok(delta < -20000, 'la plus-value latente (≈ 27 k€) sort de l’historique : ' + delta);
    assert.equal(r.data.total.nezha, 180000 + delta);
    assert.equal(r.data.total.amine, 620000, 'Villejuif est à Nezha');
    assert.equal(r.data.views.couple.immo, 116000 + delta);
    assert.equal(r.data.views.amine.immo, 11000);
    assert.equal(r.data.immo.equityNet, 116019 + delta);
    assert.ok(r.corrections.some((c) => /Villejuif/.test(c.compte)));
  });

  t('une ligne déjà au coût engagé n’est pas recalculée', () => {
    const r = snapVJ('2026-09-20', 'cout-engage');
    E.appliquerSoldesRetroactifs([r], {}, D.FX_STATIC, {});
    assert.equal(r.corrections, null);
    assert.equal(r.data.immo.properties.villejuif.value, 141159);
  });

  t('restaté, l’historique rejoint le calcul du jour : même valeur portée qu’aujourd’hui', () => {
    const s = E.compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
    const vjJour = s.immoView.properties.find((p) => p.loanKey === 'villejuif');
    assert.ok(Math.abs(vjJour.value - D.VILLEJUIF_ACTE.appelsPayes.montant) < 1, 'le calcul du jour porte les appels payés');
  });

  t('les nouveaux registres sont chiffrés avec les autres blocs sensibles', () => {
    for (const n of ['RELEVES_QUOTIDIENS', 'SNAPSHOTS_RECONSTRUITS']) assert.ok(NOMS_SENSIBLES.includes(n), n);
  });

  console.log(ko === 0 ? '\n✅ Historique fiable : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
