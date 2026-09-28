#!/usr/bin/env node
// ============================================================================
// DEGIRO — le tableau de bord confronté à l'archive RGPD du 28 septembre 2026.
//
// L'archive contient le relevé de compte et le relevé de transactions du 10/01/2020 au
// 30/06/2025, les rapports annuels 2019-2025 et les relevés de portefeuille. Le compte étant
// clos et vidé, une identité comptable EXACTE est disponible et sert d'ancre à tout le reste :
//
//        retraits − versements = P&L total du compte
//
// Le test protège aussi ce qui distingue les natures de flux : un virement entre le compte
// d'investissement DEGIRO et le compte de liquidités flatex du même titulaire ne crée ni ne
// détruit de patrimoine, et ne doit donc jamais compter comme un versement ou un retrait.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-dg-'));
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
  const dg = D.PORTFOLIO.amine.degiro;
  const s = E.compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
  const av = s.actionsView;

  const versements = dg.deposits.filter((d) => d.amount > 0);
  const retraits = dg.deposits.filter((d) => d.amount < 0);
  const sommeVersements = versements.reduce((x, d) => x + d.amount, 0);
  const sommeRetraits = retraits.reduce((x, d) => x + d.amount, 0);

  console.log('\n── DEGIRO : archive RGPD du 28/09/2026 ──');

  // ── 1. Les flux réels, à leur date ──
  t('les versements valent 25 650,02 € et sont datés du relevé, pas reconstitués', () => {
    centimes(sommeVersements, 25650.02, 'somme des versements');
    centimes(sommeVersements, dg.depositsTotalCheck, 'contrôle interne des versements');
    // La v550 étalait 25 573,02 € sur trois dates supposées, à 8 524,34 € chacune.
    assert.equal(versements.some((d) => Math.abs(d.amount - 8524.34) < 0.01), false,
      'un versement au montant back-calculé de la v550 subsiste');
    assert.equal(versements[0].date, '2020-01-14');
    const gros = versements.filter((d) => d.date === '2020-04-09');
    assert.equal(gros.length, 4, 'les quatre versements du 09/04/2020 doivent rester distincts');
    centimes(gros.reduce((x, d) => x + d.amount, 0), 14000, 'versements du 09/04/2020');
  });

  t('les retraits valent 76 237,57 € et se répartissent comme les annexes flatex', () => {
    centimes(-sommeRetraits, 76237.57, 'somme des retraits');
    centimes(sommeRetraits, dg.withdrawalsTotalCheck, 'contrôle interne des retraits');
    const parAnnee = {};
    for (const r of retraits) parAnnee[r.date.slice(0, 4)] = (parAnnee[r.date.slice(0, 4)] || 0) - r.amount;
    centimes(parAnnee['2021'], 15669, 'retraits 2021');
    centimes(parAnnee['2023'], 5755, 'retraits 2023');
    centimes(parAnnee['2025'], 54813.57, 'retraits 2025');
    for (const an of ['2021', '2023', '2025']) {
      centimes(parAnnee[an], dg.flatexCashFlows[Number(an)].retraits, 'retraits ' + an + ' vs annexe flatex');
    }
  });

  // ── 2. L'identité du compte clos : performance ≠ apports ──
  t('P&L total = retraits − versements (le compte est clos et vidé, l’identité est exacte)', () => {
    centimes(dg.totalPLAllComponents, -sommeRetraits - sommeVersements, 'identité du compte clos');
    centimes(dg.totalPLAllComponents, 50587.55, 'P&L total');
  });

  t('l’écart avec la somme des composants des rapports annuels est nommé, pas absorbé', () => {
    const composants = dg.totalRealizedPL + dg.totalDividendsNet
      + Object.values(dg.fxCosts).reduce((x, f) => x + f.autoFX + f.manualFX, 0)
      - Object.values(dg.flatexCashFlows).reduce((x, f) => x + f.interestPaid, 0)
      + 20; // bonus promotionnel 2020
    centimes(composants - dg.totalPLAllComponents, dg.ecartComposantsRapports, 'écart composants ↔ identité');
    centimes(dg.ecartComposantsRapports, 77.00, 'écart annoncé');
  });

  t('la performance ne se confond pas avec les apports : les trois grandeurs sont distinctes', () => {
    centimes(av.degiroDepositsGross, sommeVersements, 'déposé brut exposé par le moteur');
    centimes(Math.abs(av.degiroWithdrawals), -sommeRetraits, 'retiré exposé par le moteur');
    centimes(av.degiroDepositsNet, sommeVersements + sommeRetraits, 'déposé net');
    assert.ok(av.degiroDepositsNet < 0, 'un compte clôturé à profit a un déposé net négatif (BUG-014)');
    centimes(av.degiroRealizedPL, dg.totalPLAllComponents, 'P&L exposé');
    // Le P&L n'est pas la variation de trésorerie : il s'en déduit, mais les deux restent séparés.
    assert.notEqual(Math.round(av.degiroRealizedPL), Math.round(av.degiroDepositsGross));
  });

  // ── 3. Neutralité des mouvements internes ──
  t('aucun transfert interne DEGIRO ↔ compte de liquidités flatex n’est compté comme un flux', () => {
    const interne = /sweep|liquidit|interne|transfert/i;
    for (const d of dg.deposits) {
      assert.equal(interne.test(d.label), false, 'mouvement interne compté comme flux : ' + d.label);
    }
    // Les transferts internes sont connus et non nuls : s'ils étaient comptés, le total exploserait.
    const sommeInternes = Object.values(dg.flatexCashFlows).reduce((x, f) => x + f.transfersDegiro, 0);
    assert.ok(sommeInternes > 70000, 'les transferts internes existent bien (contrôle du test lui-même)');
    assert.ok(Math.abs(sommeVersements) < sommeInternes, 'les versements ne doivent pas inclure les transferts internes');
  });

  // ── 4. Relevés de portefeuille ──
  t('les relevés de portefeuille recollent aux rapports annuels (titres + liquidités)', () => {
    for (const [d, p] of Object.entries(dg.yearEndPortfolio)) {
      const somme = p.positions.reduce((x, l) => x + l.valueEUR, 0) + p.cashEUR;
      assert.ok(Math.abs(somme - p.total) < 1.5, 'relevé ' + d + ' : ' + somme.toFixed(2) + ' ≠ ' + p.total);
    }
    for (const an of [2020, 2021, 2022, 2023, 2024]) {
      const p = dg.yearEndPortfolio[an + '-12-31'];
      const titres = p.total - p.cashEUR;
      // Tolérance de 5 € : DEGIRO arrondit chaque ligne du relevé de portefeuille à l'euro-cent
      // après conversion, le rapport annuel convertit le total. L'écart 2024 vaut 3,62 €.
      assert.ok(Math.abs(titres - dg.annualSummary[an].portfolioEnd) < 5,
        an + ' : titres ' + titres.toFixed(2) + ' ≠ rapport annuel ' + dg.annualSummary[an].portfolioEnd);
    }
  });

  t('le fichier « Portfolio 31-12-2029.pdf » est lu comme un relevé du 25/09/2026, compte vide', () => {
    const rf = dg.archiveRGPD.releveFinal;
    assert.equal(rf.dateContenu, '2026-09-25');
    assert.equal(rf.nomFichier, 'Portfolio 31-12-2029.pdf');
    assert.equal(rf.positions, 0);
    assert.equal(rf.valeurEUR, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(dg.yearEndPortfolio, '2029-12-31'), false,
      'aucun relevé ne doit être daté de 2029 : ce serait le nom du fichier pris pour argent comptant');
    const dernier = dg.yearEndPortfolio['2026-09-25'];
    assert.deepEqual(dernier.positions, [], 'aucune position ne subsiste');
    assert.equal(dernier.total, 0);
  });

  t('aucune position n’a été transférée vers un autre compte : tout a été vendu puis viré', () => {
    // 06/04 : deux lignes encore détenues. 07/04 : plus que du cash, du même montant que le
    // retrait du 14/04. Un transfert de titres laisserait un trou entre les deux relevés.
    const veille = dg.yearEndPortfolio['2025-04-06'], lendemain = dg.yearEndPortfolio['2025-04-07'];
    assert.equal(veille.positions.length, 2);
    assert.equal(lendemain.positions.length, 0);
    centimes(lendemain.cashEUR, lendemain.total, 'le 07/04, tout est en liquidités');
    const retraitFinal = dg.deposits.find((d) => d.date === '2025-04-14');
    centimes(-retraitFinal.amount, lendemain.total - 0.01, 'le retrait du 14/04 emporte le solde du 07/04');
  });

  // ── 5. Trades de liquidation ──
  t('les ventes du 07/04/2025 portent les prix des avis d’exécution, pas un prix moyen déduit', () => {
    const t7 = D.PORTFOLIO.amine.allTrades.filter((x) => x.source === 'degiro' && x.date === '2025-04-07');
    const nvda = t7.filter((x) => x.ticker === 'NVDA');
    const infy = t7.filter((x) => x.ticker === 'INFY');
    assert.equal(nvda.reduce((x, l) => x + l.qty, 0), 540, 'NVIDIA : 540 titres vendus');
    assert.equal(infy.reduce((x, l) => x + l.qty, 0), 300, 'Infosys : 300 titres vendus');
    assert.equal(nvda.some((l) => Math.abs(l.price - 89.73) < 0.005), false,
      'le prix 89,73 USD de la v550 n’existe dans aucune pièce');
    for (const l of nvda) assert.ok(l.price >= 97.6 && l.price <= 98.4, 'prix hors fourchette des exécutions : ' + l.price);
    // Les P&L annuels restent ceux des rapports, portés chacun par une seule ligne.
    centimes(nvda.reduce((x, l) => x + (l.realizedPL || 0), 0), 41354.50, 'P/L NVIDIA 2025');
    centimes(infy.reduce((x, l) => x + (l.realizedPL || 0), 0), 1234.46, 'P/L Infosys 2025');
  });

  // ── 6. L'historique des transactions est celui de l'archive, pas une reconstitution ──
  t('les 166 exécutions du relevé sont dans l’historique, ISIN compris', () => {
    const tr = D.PORTFOLIO.amine.allTrades.filter((x) => x.source === 'degiro');
    const marche = tr.filter((x) => x.isin);
    assert.equal(marche.length, 166, 'le relevé de transactions compte 166 exécutions');
    // Une seule ligne sans ISIN : le fonds monétaire, qui n'est pas une transaction de marché.
    const horsMarche = tr.filter((x) => !x.isin);
    assert.equal(horsMarche.length, 1);
    assert.equal(horsMarche[0].ticker, 'MSLIQ');
    const parAnnee = {};
    for (const x of marche) parAnnee[x.date.slice(0, 4)] = (parAnnee[x.date.slice(0, 4)] || 0) + 1;
    assert.deepEqual(parAnnee, { 2020: 100, 2021: 51, 2023: 3, 2024: 2, 2025: 10 });
  });

  t('les positions reconstituées depuis les trades égalent CHAQUE relevé de portefeuille', () => {
    // C'est le contrôle qui prouve que l'historique est complet : si une exécution manquait, si
    // une quantité était consolidée de travers ou si une opération sur titres était oubliée, le
    // stock reconstitué s'écarterait du relevé à la première date suivante.
    const tr = D.PORTFOLIO.amine.allTrades.filter((x) => x.source === 'degiro' && x.isin);
    for (const [date, p] of Object.entries(dg.yearEndPortfolio)) {
      const stock = {};
      for (const x of tr) {
        if (x.date <= date) stock[x.isin] = (stock[x.isin] || 0) + (x.type === 'sell' ? -x.qty : x.qty);
      }
      for (const ligne of p.positions) {
        assert.equal(stock[ligne.isin] || 0, ligne.qty,
          date + ' — ' + ligne.ticker + ' : relevé ' + ligne.qty + ', trades ' + (stock[ligne.isin] || 0));
      }
      for (const [isin, q] of Object.entries(stock)) {
        if (Math.abs(q) < 1e-9) continue;
        assert.ok(p.positions.some((l) => l.isin === isin),
          date + ' — les trades laissent ' + q + ' titres ' + isin + ' que le relevé ne montre pas');
      }
    }
  });

  t('les opérations sur titres sont là : division NVIDIA, fusion Tortoise → Volta, rachat Fitbit', () => {
    const tr = D.PORTFOLIO.amine.allTrades.filter((x) => x.source === 'degiro');
    const le = (d, isin) => tr.filter((x) => x.date === d && x.isin === isin);
    // 10/06/2024 : division par 10 de NVIDIA — 54 titres sortent, 540 entrent.
    const split = le('2024-06-10', 'US67066G1040');
    assert.equal(split.length, 2, 'la division NVIDIA de juin 2024 doit figurer');
    assert.equal(split.reduce((x, l) => x + (l.type === 'sell' ? -l.qty : l.qty), 0), 486);
    // 27/08/2021 : la SPAC Tortoise Acquisition II devient Volta — même jour, deux ISIN.
    assert.equal(le('2021-08-27', 'KYG895541020')[0].type, 'sell');
    assert.equal(le('2021-08-27', 'US92873V1026')[0].type, 'buy');
    assert.equal(le('2021-08-27', 'KYG895541020')[0].qty, le('2021-08-27', 'US92873V1026')[0].qty);
    // 18/01/2021 : Fitbit racheté par Google — les titres sortent sans prix de marché.
    const fit = le('2021-01-18', 'US33812L1026');
    assert.equal(fit.length, 1);
    assert.equal(fit[0].qty, 200);
    assert.equal(fit[0].price, 0, 'une opération sur titres n’a pas de cours');
  });

  t('les P/L portés par les trades restent ceux des rapports annuels', () => {
    const tr = D.PORTFOLIO.amine.allTrades.filter((x) => x.source === 'degiro');
    const somme = tr.reduce((x, l) => x + (typeof l.realizedPL === 'number' ? l.realizedPL : 0), 0);
    assert.ok(Math.abs(somme - dg.totalRealizedPL) < 0.05,
      'Σ realizedPL des trades ' + somme.toFixed(2) + ' ≠ totalRealizedPL ' + dg.totalRealizedPL);
    // Aucun P/L inventé sur les lignes intermédiaires : un instrument ne porte qu'UNE valeur par an.
    const parAnneeTicker = {};
    for (const l of tr) {
      if (typeof l.realizedPL !== 'number') continue;
      const k = l.date.slice(0, 4) + '|' + l.ticker;
      parAnneeTicker[k] = (parAnneeTicker[k] || 0) + 1;
      assert.ok(parAnneeTicker[k] <= 1, 'deux P/L portés sur ' + k + ' : le total annuel serait compté deux fois');
    }
    const clos = av.degiroClosedPositions || [];
    assert.ok(Math.abs(clos.reduce((x, c) => x + (c.pl || 0), 0) - dg.totalRealizedPL) < 5,
      'le tableau des positions clôturées doit totaliser le P/L des rapports annuels');
  });

  t('l’historique 2025 du graphe reflète la baisse de NVIDIA du 1er trimestre', () => {
    const h = Object.fromEntries(D.EQUITY_HISTORY.filter((r) => r.date.startsWith('2025-')).map((r) => [r.date, r]));
    assert.ok(h['2025-03-31'].degiro < h['2025-01-31'].degiro - 8000,
      'mars 2025 doit être nettement sous janvier (NVDA 134 → 108 USD)');
    assert.ok(Math.abs(h['2025-03-31'].degiro - 59160) < 1500, 'valeur de mars 2025 hors fourchette attendue');
    assert.equal(h['2025-04-30'].degiro, 0, 'le compte est clos fin avril 2025');
    for (const r of Object.values(h)) {
      assert.equal(r.total, r.degiro + r.espp + r.ibkr, r.date + ' : le total doit rester la somme des colonnes');
    }
  });

  console.log(ko === 0 ? '\n✅ DEGIRO archive : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
