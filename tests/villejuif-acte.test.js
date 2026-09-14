#!/usr/bin/env node
// ============================================================================
// Villejuif — les chiffres du tableau de bord contre les pièces (v543).
//
// Chaque assertion renvoie à une source : acte authentique du 05/06/2026 (pages citées),
// tableaux d'amortissement LCL édités le 03/07/2026, décompte notarial du 27/05/2026. Le test
// échoue si le moteur s'en écarte — et il protège aussi les faits NON établis (écart de 323 €,
// frais définitifs, achèvement réel) contre toute « résolution » silencieuse.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-vj-'));
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
  const A = D.VILLEJUIF_ACTE;
  const s = E.compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
  const iv = s.immoView;
  const vj = iv.properties.find((p) => p.loanKey === 'villejuif');
  const cap = E.villejuifCapitalInvesti();
  console.log('\n── Villejuif : acte, tableaux LCL, décompte ──');

  // ── 1. Le dépôt de réservation est DANS l'apport, jamais en plus ──
  t('les 3 363 € de dépôt sont compris dans les 114 352,20 € payés à l’acte (p.9)', () => {
    assert.equal(A.appelsPayes.dontDepotReservation, 3363);
    centimes(A.appelsPayes.montant, 114352.20, 'appels payés');
    centimes(cap.cashPrix, 18183.05, 'part du prix payée hors banque');
    assert.equal(cap.depotReservationInclus, 3363);
    // Le décompte le confirme : total des dépenses − acompte = versement à la signature.
    const dn = A.decompteNotarial;
    centimes(A.appelsPayes.montant + dn.provisionFraisAchat + dn.quotePart - dn.acompteDeduit, dn.versementSignature, 'décompte notarial');
  });
  t('une fois l’acte signé, le dépôt n’est pas ajouté une seconde fois au patrimoine', () => {
    assert.equal(s.nezha.villejuifSigned, true);
    assert.equal(s.nezha.villejuifReservation, 0);
  });
  t('le déblocage LCL constaté à l’acte vaut 96 169,15 € (P1 64 369,15 + P2 31 800)', () => {
    centimes(A.deblocageActe.p1 + A.deblocageActe.p2, A.deblocageActe.total, 'somme des tirages');
    centimes(A.deblocageActe.total, 96169.15, 'déblocage');
    centimes(A.pretsLCL.total, 318469.95, 'prêts LCL (p.12)');
  });

  // ── 2. Équité cash ──
  t('au 05/08/2026 : CRD 96 568,62 € et équité cash 17 783,58 €', () => {
    const c = E.villejuifCrdADate('2026-08-15');
    assert.equal(c.date, '2026-08-05');
    centimes(c.crd, 96568.62, 'CRD tableaux');
    centimes(A.appelsPayes.montant - c.crd, 17783.58, 'équité cash');
  });
  t('le patrimoine porte exactement l’équité au coût engagé du jour', () => {
    const c = E.villejuifCrdADate(new Date().toISOString());
    centimes(vj.value, A.appelsPayes.montant, 'actif porté');
    centimes(vj.crd, c.crd, 'CRD porté');
    assert.equal(vj.crdDate, c.date);
    centimes(s.nezha.villejuifEquity, vj.value - vj.crd, 'équité Nezha');
    centimes(vj.exitCosts.netEquityAfterExit, vj.value - vj.crd, 'équité nette après sortie');
  });

  // ── 3. Horizons de valorisation séparés ──
  t('quatre horizons, un seul dans le patrimoine', () => {
    const h = vj.horizons;
    assert.ok(h && h.coutEngage && h.hybride && h.marcheLivraison && h.realisable);
    assert.equal(h.coutEngage.dansNW, true);
    for (const k of ['hybride', 'marcheLivraison', 'realisable']) assert.equal(h[k].dansNW, false, k + ' ne doit pas entrer au NW');
    assert.ok(vj.valeurHybride > vj.value, 'la valorisation hybride doit rester distincte du coût engagé');
    assert.equal(h.realisable.actif, null, 'la valeur réalisable avant livraison n’est pas établie');
  });
  t('la plus-value latente hybride n’entre pas dans l’équité nette totale', () => {
    const somme = s.amine.vitryEquity + s.nezha.rueilEquity + s.nezha.villejuifEquity;
    centimes(s.couple.immoEquity, somme, 'équité nette immo couple');
    assert.ok(s.nezha.villejuifEquity < vj.valeurHybride - vj.crd, 'le NW contient encore la plus-value hybride');
  });
  t('les frais ne sont jamais ajoutés à la valeur du bien', () => {
    centimes(vj.value, A.appelsPayes.montant, 'actif (sans frais)');
    assert.ok(cap.scenarioEstimatif > cap.reelDocumente, 'le scénario estimatif doit dépasser le réel documenté');
  });

  // ── 4. Frais réels de la clause ≠ forfait fiscal ──
  t('SADEV déduit les frais acquittés (provision 6 950 + 520), pas le forfait de 7,5 %', () => {
    const ec = E.computeExitCostsAtYear('villejuif', 2031, 430000, 336330, 250000, 0);
    assert.ok(ec.clauseSADEVActive, 'clause attendue active en 2031');
    centimes(ec.sadevDetail.fraisAcquisition, 7470, 'frais de la clause');
    assert.equal(ec.fraisAcquisitionFiscal, Math.round(336330 * 0.075));
    assert.notEqual(ec.sadevDetail.fraisAcquisition, ec.fraisAcquisitionFiscal);
    assert.match(ec.sadevDetail.fraisStatut, /non définitive/);
    assert.match(ec.sadevDetail.travauxStatut, /non renseigné/);
  });
  t('la quote-part de 520 € est comptée une seule fois', () => {
    // Réel/documenté = fonds propres (18 183,05) + EDD (520). La provision, les garanties et le
    // dossier sont dans des tiers SÉPARÉS, jamais fondus dans le réel.
    centimes(cap.reelDocumente, cap.cashPrix + 520, 'réel documenté');
    centimes(cap.reelDocumente, 18703.05, 'réel documenté (établi)');
    centimes(cap.provision, 6950, 'provision notariale, tier distinct');
    centimes(cap.estimePropose, 4170.05, 'garanties proposées, tier distinct');
    assert.equal(cap.nonJustifie, 1200, 'dossier non justifié, tier distinct');
    centimes(cap.scenarioEstimatif, 31023.10, 'scénario estimatif (borne haute)');
    // La quote-part EDD est comptée une fois : dans le réel ET dans l'assiette de la clause,
    // deux consommateurs distincts, jamais additionnés.
    centimes(cap.fraisAcquisitionPourClause, 6950 + 520, 'frais de la clause = provision + EDD');
  });

  // ── 5. Fenêtre = achèvement réel + 5 ans ; ICC réel ──
  t('sans achèvement constaté, la fenêtre est PROVISOIRE et part de la date contractuelle', () => {
    const f = E.sadevFenetre();
    assert.deepEqual([f.debut, f.fin, f.statut], ['2028-06-30', '2033-06-30', 'provisoire']);
  });
  t('un achèvement réel constaté déplace la fenêtre et la rend établie', () => {
    const f = E.sadevFenetre({ ...A, livraison: { ...A.livraison, achevementReel: '2028-10-15' } });
    assert.deepEqual([f.fin, f.statut], ['2033-10-15', 'établie']);
  });
  t('une vente le 01/06/2033 est dans la fenêtre, une vente en 2034 n’y est plus', () => {
    assert.equal(E.computeExitCostsAtYear('villejuif', 2033, 480000, 336330, 200000, 0).clauseSADEVActive, true);
    assert.equal(E.computeExitCostsAtYear('villejuif', 2034, 480000, 336330, 200000, 0).clauseSADEVActive, false);
  });
  t('aucune date de fin de clause écrite en dur', () => {
    const src = contenuClair();
    assert.ok(!/dateFin: '2033-06'/.test(src), 'dateFin 2033-06 subsiste');
    assert.equal(D.VILLEJUIF_CONSTRAINTS.constraints[0].dateFin, null);
    assert.equal(D.VILLEJUIF_CONSTRAINTS.iccAnnuelHypothese, undefined, 'l’ICC forfaitaire est encore une donnée');
  });
  t('ICC : indice de base = dernier connu à la signature (T4 2025 = 2 058), scénario au-delà', () => {
    assert.equal(A.sadev.icc.base.valeur, 2058);
    assert.equal(E.iccADate('2026-06-05').valeur, 2058);
    assert.equal(E.iccADate('2026-09-01').valeur, 2084);
    const f = E.iccADate('2031-01-01');
    assert.match(f.statut, /^scénario/);
    assert.ok(f.valeur > 2084);
  });

  // ── 6. Échéanciers des prêts ──
  t('P2 : amortissement dès le 05/11/2028 à 124,25 € ; dernière échéance 05/01/2053', () => {
    assert.equal(A.prets.p2.premierAmortissement, '2028-11-05');
    centimes(A.prets.p2.echeanceSurTire, 124.25, 'échéance P2');
    assert.equal(A.prets.p2.derniereEcheance, '2053-01-05');
  });
  t('P1 : intérêts dès le 05/11/2028, amortissement dès le 05/02/2029 à 345,70 € ; fin 05/01/2053', () => {
    assert.equal(A.prets.p1.premieresEcheancesInterets, '2028-11-05');
    assert.equal(A.prets.p1.premierAmortissement, '2029-02-05');
    centimes(A.prets.p1.echeanceSurTire, 345.70, 'échéance P1');
    assert.equal(A.prets.p1.derniereEcheance, '2053-01-05');
    assert.ok(A.prets.p1.premierAmortissement > A.prets.p1.premieresEcheancesInterets);
  });
  t('le CRD suit le tableau : la ligne du 05/11/2028 intègre la baisse des intérêts différés', () => {
    centimes(E.villejuifCrdADate('2028-11-05').crd, 101613.55, 'CRD 05/11/2028');
    assert.ok(E.villejuifCrdADate('2028-11-05').crd < E.villejuifCrdADate('2028-10-05').crd);
  });
  t('plus aucune mention d’août 2028 ni de livraison Q3 dans le code', () => {
    for (const f of ['data.js', 'engine.js', 'render.js', 'simulators.js']) {
      const src = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
      assert.ok(!/août 2028|Q3 2028/.test(src), f + ' mentionne encore août 2028 ou Q3 2028');
    }
  });

  // ── 7. Réconciliation des totaux ──
  t('valeur, CRD et équité immo = sommes des biens', () => {
    const P = iv.properties;
    centimes(iv.totalValue, P.reduce((a, p) => a + p.value, 0), 'valeur totale');
    centimes(iv.totalCRD, P.reduce((a, p) => a + p.crd, 0), 'CRD total');
    centimes(s.couple.immoValue, iv.totalValue, 'valeur couple');
  });
  t('l’écart de 323 € reste NON réconcilié, et chiffré', () => {
    assert.equal(A.apport.ecartNonReconcilie, 323);
    centimes(cap.ecartApport, 323, 'écart recalculé');
    assert.equal(cap.ecartStatut, 'non réconcilié');
    centimes(A.prix.ttc - A.pretsLCL.total, A.apport.nominalContractuel, 'apport nominal');
  });
  t('prix : 280 275 € HT + 56 055 € de TVA = 336 330 € TTC (p.8-9)', () => {
    assert.equal(A.prix.ht + A.prix.tva, A.prix.ttc);
    centimes(A.prix.ht * A.prix.tauxTVA, A.prix.tva, 'TVA 20 %');
  });

  console.log(ko === 0 ? '\n✅ Villejuif : tout passe\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
