#!/usr/bin/env node
// ============================================================================
// Périmètre du patrimoine — ce qui ne doit ni entrer deux fois, ni entrer du tout (v551).
//
// Quatre règles confirmées par Amine, chacune protégée ici :
//   1. un virement déjà placé dans un espace d'épargne ne s'ajoute pas au solde ;
//   2. l'argent d'un tiers qui transite n'est ni un revenu, ni du patrimoine — et s'il dort dans
//      un solde suivi, il porte une contrepartie du même montant ;
//   3. un écart de règlement dont la nature est connue (des frais) n'est pas une créance ;
//   4. Villejuif : l'apport est consommé en premier, et les frais de notaire comme la quote-part
//      du règlement de copropriété restent distincts du prix, du capital restant dû et de l'apport.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-per-'));
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
  const P = D.PORTFOLIO;
  const s = E.compute(P, { ...D.FX_STATIC }, 'static');

  console.log('\n── Périmètre : double comptage, fonds de tiers, frais ──');

  // ── 1. Les 57 000 AED sont DANS l'épargne Wio, pas en plus ──
  t('les espaces d’épargne Wio, plus les mouvements datés, somment exactement au solde porté', () => {
    const espaces = P.amine.uae.wioSavingsSpaces;
    const mouvements = P.amine.uae.wioSavingsMouvements || [];
    const somme = espaces.reduce((x, e) => x + e.montant, 0) + mouvements.reduce((x, m) => x + m.montant, 0);
    centimes(somme, P.amine.uae.wioSavings, 'Σ espaces + Σ mouvements Wio vs wioSavings');
    for (const m of mouvements) {
      assert.match(m.date, /^\d{4}-\d{2}-\d{2}$/, 'un mouvement doit être daté');
      assert.ok(m.motif && m.source, 'un mouvement doit dire pourquoi et d’où vient l’information');
    }
  });

  // ── 1 bis. La carte Wio Credit est une dette, comptée dès l'achat ──
  t('le remboursement de la carte est financé par l’épargne, pas compté deux fois', () => {
    const c = P.amine.uae.wioCredit;
    assert.ok(c, 'la carte Wio Credit doit être déclarée');
    assert.equal(c.soldeDuAED, 0, 'remboursée en totalité le 07/10/2026');
    centimes(c.dernierRemboursement.montantAED, 69998.89, 'montant remboursé');
    const retrait = (P.amine.uae.wioSavingsJournal || []).find((m) => m.date === c.dernierRemboursement.date && m.montant < 0);
    assert.ok(retrait, 'le retrait d’épargne qui finance le remboursement doit être tracé');
    assert.ok(-retrait.montant >= c.dernierRemboursement.montantAED, 'le retrait couvre le remboursement');
  });

  t('un solde dû sur la carte réduit le patrimoine et le cash du même montant', () => {
    const DU = 10000; // AED — solde hypothétique pour éprouver le branchement
    const clone = JSON.parse(JSON.stringify(P));
    clone.amine.uae.wioCredit.soldeDuAED = DU;
    const avecDette = E.compute(clone, { ...D.FX_STATIC }, 'static');
    const attendu = DU / D.FX_STATIC.AED;
    for (const v of ['couple', 'amine']) {
      const ecart = s.views[v].nwRef - avecDette.views[v].nwRef;
      assert.ok(Math.abs(ecart - attendu) < 1, v + ' : le patrimoine doit baisser de ' + attendu.toFixed(0) + ' €, il baisse de ' + ecart.toFixed(0));
    }
    assert.equal(Math.round(avecDette.views.nezha.nwRef), Math.round(s.views.nezha.nwRef), 'la carte est à Amine, pas à Nezha');
    const ligne = avecDette.cashView.accounts.find((a) => a.label === 'Wio Credit (carte)');
    assert.ok(ligne, 'la carte apparaît dans la vue Cash');
    assert.ok(Math.abs(ligne.native + DU) < 0.01, 'solde de la ligne = −dû');
    // Le solde de carte se règle sur la trésorerie : il baisse le TOTAL cash, pas seulement le NW.
    const baisseCash = s.cashView.totalCash - avecDette.cashView.totalCash;
    assert.ok(Math.abs(baisseCash - attendu) < 1, 'le total cash doit baisser de ' + attendu.toFixed(0) + ' €, il baisse de ' + baisseCash.toFixed(0));
    // Un solde négatif (trop-perçu) n'est pas modélisé : il ne doit pas créer de patrimoine.
    clone.amine.uae.wioCredit.soldeDuAED = -500;
    const tropPercu = E.compute(clone, { ...D.FX_STATIC }, 'static');
    assert.equal(Math.round(tropPercu.views.couple.nwRef), Math.round(s.views.couple.nwRef));
  });

  t('l’épargne Wio portée au site égale le total lu dans l’app : aucun virement ne s’y ajoute', () => {
    // Capture du 09/10/2026 : « Your total savings » 554 140 AED = part d'Amine + part de Nezha. Les
    // 57 000 AED virés le 19/09 sont dedans, comme tout virement passé : le solde est LU, pas reconstitué.
    const total = P.amine.uae.wioSavings + P.nezha.cash.wioAED;
    centimes(total, 554140, 'épargne Wio du couple vs total affiché dans l’app');
    assert.deepEqual(P.amine.uae.wioSavingsMouvements, [], 'aucun mouvement en attente après une capture complète');
  });

  // ── 2. L'argent d'Azarkan n'est ni un revenu ni du patrimoine ──
  t('les 28 900 € RTL sont déclarés comme fonds appartenant à Azarkan', () => {
    const rtl = D.FONDS_DE_TIERS.find((f) => f.id === 'RTL-AZARKAN');
    assert.ok(rtl, 'la ligne RTL-AZARKAN doit exister');
    assert.equal(rtl.montant, 28900);
    assert.equal(rtl.devise, 'EUR');
    assert.equal(rtl.jamaisEnRevenu, true);
    assert.match(rtl.proprietaire, /Azarkan/);
  });

  t('tout fonds de tiers logé dans un solde suivi porte une contrepartie du même montant', () => {
    for (const f of D.FONDS_DE_TIERS) {
      if (f.dansUnSoldeSuivi) {
        centimes(f.contrepartieEUR, -f.montant, 'contrepartie manquante pour ' + f.id);
      } else {
        assert.equal(f.contrepartieEUR, 0, f.id + ' : pas encaissé, donc rien à neutraliser');
      }
    }
  });

  t('les 28 900 € n’apparaissent nulle part en créance, en facturation ni en revenu', () => {
    const creances = [...(P.amine.creances?.items || []), ...(P.nezha.creances?.items || [])];
    for (const c of creances) {
      assert.notEqual(Math.abs(c.amount), 28900, 'créance de 28 900 trouvée : ' + c.label);
      assert.equal(/RTL|Azarkan/i.test(c.label || ''), false, 'créance RTL/Azarkan : ' + c.label);
    }
    const revenus = D.MONTHLY_INCOMES || [];
    for (const r of revenus) assert.notEqual(Math.round(r.amount || 0), 28900, 'revenu de 28 900 trouvé : ' + r.label);
    // Le pont de facturation ne transporte que des positions entre personnes, en MAD ; une
    // créance client n'a rien à y faire.
    assert.notEqual(Math.round(s.amine.facturationNet || 0), 28900);
  });

  // ── 3. Les 25 € Igal sont des frais, pas une créance ──
  t('les écarts de 25 € sont classés en frais de paiement, jamais en créance ni en écart inexpliqué', () => {
    const igal = D.ECARTS_DE_REGLEMENT.find((e) => e.id === 'IGAL-FRAIS-PAIEMENT');
    assert.ok(igal, 'la ligne IGAL-FRAIS-PAIEMENT doit exister');
    assert.equal(igal.montant, 25);
    assert.match(igal.classification, /frais/i);
    assert.equal(igal.estUneCreance, false);
    assert.equal(igal.estUnRevenu, false);
    assert.equal(igal.estUnEcartInexplique, false);
    const creances = [...(P.amine.creances?.items || []), ...(P.nezha.creances?.items || [])];
    for (const c of creances) {
      assert.equal(c.currency === 'EUR' && Math.abs(c.amount) === 25, false, 'créance de 25 € trouvée : ' + c.label);
    }
  });

  // ── 4. Villejuif : apport d'abord, frais à part ──
  t('l’apport est consommé avant tout autre financement', () => {
    const A = D.VILLEJUIF_ACTE, cap = E.villejuifCapitalInvesti();
    // Fonds propres réellement versés sur le prix = appels payés − ce que la banque a débloqué.
    centimes(cap.cashPrix, A.appelsPayes.montant - A.deblocageActe.total, 'fonds propres sur le prix');
    assert.ok(cap.cashPrix >= A.apport.nominalContractuel,
      'l’apport contractuel (' + A.apport.nominalContractuel + ') doit être entièrement consommé');
    centimes(cap.ecartApport, cap.cashPrix - A.apport.nominalContractuel, 'écart apport');
    assert.equal(cap.ecartStatut, 'non réconcilié', 'l’écart de 323 € reste un écart, il ne se comble pas tout seul');
    // À ce stade, il ne reste donc aucun apport disponible : tout est versé.
    const apportRestant = Math.max(0, A.apport.nominalContractuel - cap.cashPrix);
    assert.equal(apportRestant, 0, 'aucun apport ne doit rester « disponible » après la signature');
  });

  t('frais de notaire et règlement de copropriété comptent à part du prix, du CRD et de l’apport', () => {
    const A = D.VILLEJUIF_ACTE, cap = E.villejuifCapitalInvesti();
    centimes(cap.provision, A.decompteNotarial.provisionFraisAchat, 'provision notariale');
    centimes(cap.quotePartEDD, A.chargeAugmentative.montant, 'quote-part EDD / règlement de copropriété');
    assert.notEqual(cap.provision, 0);
    assert.notEqual(cap.quotePartEDD, 0);
    // Ni l'un ni l'autre n'est dans le prix du bien…
    assert.ok(cap.provision + cap.quotePartEDD < A.prix.ttc * 0.05);
    assert.notEqual(A.prix.ttc, A.prix.ttc + cap.provision);
    // …ni dans l'actif porté au patrimoine (qui vaut les appels payés), ni dans le CRD.
    const vj = s.immoView.properties.find((p) => p.loanKey === 'villejuif');
    centimes(vj.value, A.appelsPayes.montant, 'actif porté = appels payés, frais exclus');
    assert.ok(vj.crd > 0 && Math.abs(vj.crd - A.deblocageActe.total) < 6000, 'CRD = capital tiré, frais exclus');
    assert.equal(A.fraisAcquisitionReels, null, 'le solde définitif du notaire n’est toujours pas retrouvé');
  });

  t('les contraintes du prix minoré sont celles de l’acte, sans en inventer', () => {
    const c = D.VILLEJUIF_CONSTRAINTS.constraints[0];
    assert.match(c.reference, /05\/06\/2026/);
    assert.match(c.beneficiaire, /SADEV 94/);
    assert.equal(c.dateDebut, null, 'la fenêtre part de l’achèvement RÉEL, inconnu : aucune date en dur');
    assert.equal(c.fenetre, 'date réelle d\'achèvement + 5 ans');
    const d = c.details.join(' | ');
    assert.match(d, /a pu être minoré/, 'la formulation de l’acte sur la minoration doit être citée');
    assert.match(d, /Aucune obligation de résidence principale/, 'l’absence de contrainte doit être écrite comme telle');
    assert.equal(D.VILLEJUIF_CONSTRAINTS.preemption, null, 'droit de préemption vérifié et écarté (p.42)');
  });

  console.log(ko === 0 ? '\n✅ Périmètre : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
