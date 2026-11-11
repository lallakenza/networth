#!/usr/bin/env node
// ============================================================================
// Référentiel immo Neon (applyImmoRef) et équités signées — audit v586, points 4, 5 et 6.
//
//  4. La surcouche ne doit pas perdre les métadonnées documentaires des prêts (`tableauReel`, les
//     tableaux définitifs LCL) ni diverger du repli hors ligne (assurance Villejuif 51,29 €/mois).
//  5. Une équité immobilière négative reste un passif : elle n'est jamais ramenée à 0.
//  6. Un référentiel rejeté laisse l'état strictement intact (pas de mutation partielle).
//
// Le référentiel de test est construit à partir de data.js, sous la forme que renvoie la base : appliqué,
// il doit redonner exactement le calcul hors ligne.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-immoref-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js', 'api.js', 'deploiements.js', 'price_snapshot.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) || null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };
const clone = (x) => JSON.parse(JSON.stringify(x));

(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const E = await import('file://' + path.join(TMP, 'engine.js'));
  const A = await import('file://' + path.join(TMP, 'api.js'));
  const P = D.PORTFOLIO, IC = D.IMMO_CONSTANTS;
  const etat = () => clone({ p: P, ic: IC });
  const restaurer = (s) => { for (const k of Object.keys(P)) delete P[k]; Object.assign(P, s.p); for (const k of Object.keys(IC)) delete IC[k]; Object.assign(IC, s.ic); };
  const initial = etat();

  const loan = (id, l) => ({ id, name: l.name, principal: l.principal, annual_rate: l.rate, start_date: l.startDate, duration_months: l.durationMonths,
    monthly_payment: l.monthlyPayment != null ? l.monthlyPayment : null, periods: l.periods || null, insurance_monthly: l.insuranceMonthly != null ? l.insuranceMonthly : null,
    ira_exempt: !!l.iraExempt, taeg: l.taeg != null ? l.taeg : null, total_interest_ref: l.totalInterestRef != null ? l.totalInterestRef : null,
    deferred_interest_ref: l.deferredInterestRef != null ? l.deferredInterestRef : null });
  const refLocal = () => {
    const v = P.amine.immo.vitry, r = P.nezha.immo.rueil, j = P.nezha.immo.villejuif, L = IC.loans;
    return { source: 'test', properties: [
      { id: 'vitry', value: v.value, value_date: v.valueDate, crd_snapshot: v.crd, charges: IC.charges.vitry,
        rent: { loyerHC: v.loyerHC, loyerDeclare: v.loyerDeclare, chargesLocataire: v.chargesLocataire,
          loyerTotalCC: v.loyerHC + v.chargesLocataire, loyerDeclareCC: v.loyerDeclare + v.chargesLocataire },   // la base les porte, data.js les dérive
        insurance_global: { aprilMensuel: L.vitryInsurance, ...(L.vitryInsuranceAPRIL || {}) },
        immo_loans: [loan('vitry_al', L.vitryLoans[0]), loan('vitry_ptz', L.vitryLoans[1]), loan('vitry_bp', L.vitryLoans[2])] },
      { id: 'rueil', value: r.value, value_date: r.valueDate, crd_snapshot: r.crd, charges: IC.charges.rueil,
        rent: { loyerHC: r.loyerHC, chargesLocataire: r.chargesLocataire, cautionRecue: P.nezha.cautionRueil },
        immo_loans: [{ ...loan('rueil_cm', L.rueil), insurance_monthly: L.rueil.insurance }] },
      { id: 'villejuif', value: j.value, value_date: j.valueDate, crd_snapshot: j.crd, charges: IC.charges.villejuif, signed: !!j.signed,
        rent: { loyerHC: j.loyerHC }, vefa: { reservationFees: j.reservationFees, underConstruction: !!j.underConstruction },
        immo_loans: [loan('villejuif_lcl1', L.villejuifLoans[0]), loan('villejuif_lcl2', L.villejuifLoans[1])] },
    ] };
  };
  const vue = () => {
    const s = E.compute(clone(P), { ...D.FX_STATIC }, 'static');
    const b = s.budgetView;
    return { nw: Math.round(s.couple.nw), invest: Math.round(b.investTotal * 100) / 100, cf: Math.round(b.investCFTotal * 100) / 100,
      props: s.immoView.properties.map((p) => [p.loanKey, Math.round(p.crd), Math.round(p.cf * 100) / 100]) };
  };

  t('connecté = hors ligne : tableaux définitifs LCL, assurance 51,29 €, budget, cash-flow, échéances', () => {
    restaurer(initial);
    const hors = vue();
    const tr = IC.loans.villejuifLoans.map((l) => clone(l.tableauReel));
    assert.ok(tr[0] && tr[1], 'tableaux définitifs présents dans data.js');
    assert.equal(A.applyImmoRef(refLocal()), true);
    assert.deepEqual(P.amine.immo.vitry.encaissements, initial.p.amine.immo.vitry.encaissements, 'encaissements propriétaire conservés après Neon');
    assert.deepEqual(IC.loans.villejuifLoans.map((l) => l.tableauReel), tr, 'tableauReel conservé par identifiant de prêt');
    assert.equal(IC.charges.villejuif.assurance, 51.29);
    assert.equal(IC.loans.villejuifInsurance, 51.29);
    assert.deepEqual(vue(), hors);
    restaurer(initial);
  });

  t('Villejuif : 4 970,01 € d\'intérêts documentés sur les tirages, connectés comme hors ligne', () => {
    const exact = () => { const [a, b] = IC.loans.villejuifLoans; return (a.tableauReel.crdFinFranchise - a.tableauReel.tirageActe) + (b.tableauReel.crdFinFranchise - b.tableauReel.tirage); };
    restaurer(initial);
    const avant = exact();
    assert.ok(Math.abs(avant - 4970.01) < 0.01, 'hors ligne : ' + avant);
    A.applyImmoRef(refLocal());
    assert.ok(Math.abs(exact() - avant) < 0.001, 'connecté : ' + exact());
    restaurer(initial);
  });

  t('un ancien taux Neon ne remplace ni le taux légal meublé ni le plan ELM', () => {
    restaurer(initial);
    const ref = refLocal(); ref.properties[1].fiscal = { ...IC.fiscalite.rueil, ps: 0.172 };
    assert.equal(A.applyImmoRef(ref), true);
    assert.equal(IC.fiscalite.rueil.ps, 0.186);
    assert.deepEqual(IC.lmnp, initial.ic.lmnp);
    restaurer(initial);
  });

  t('rejet atomique : Vitry 123 456 puis Rueil non numérique → false et état strictement intact', () => {
    restaurer(initial);
    const ref = refLocal();
    ref.properties[0].value = 123456;
    ref.properties[1].value = 'NON_NUMERIQUE';
    const avant = JSON.stringify(etat());
    assert.equal(A.applyImmoRef(ref), false);
    assert.equal(JSON.stringify(etat()), avant, 'aucune mutation après rejet');
    assert.equal(P.amine.immo.vitry.value, 280000);
    restaurer(initial);
  });

  t('absent ≠ zéro ≠ invalide', () => {
    restaurer(initial);
    let ref = refLocal();
    ref.properties[2].immo_loans[0].insurance_monthly = null;      // absent → valeur locale
    assert.equal(A.applyImmoRef(ref), true);
    assert.equal(IC.loans.villejuifLoans[0].insuranceMonthly, 46.10);
    restaurer(initial);
    ref = refLocal();
    ref.properties[2].immo_loans[0].insurance_monthly = 0;         // zéro explicite → 0
    assert.equal(A.applyImmoRef(ref), true);
    assert.equal(IC.loans.villejuifLoans[0].insuranceMonthly, 0);
    restaurer(initial);
    ref = refLocal();
    ref.properties[2].immo_loans[0].insurance_monthly = 'abc';     // invalide → rejet
    const avant = JSON.stringify(etat());
    assert.equal(A.applyImmoRef(ref), false);
    assert.equal(JSON.stringify(etat()), avant);
    restaurer(initial);
  });

  t('équité négative conservée : Vitry à 200 000 € réduit le patrimoine de sa dette résiduelle', () => {
    restaurer(initial);
    const p2 = clone(P); p2.amine.immo.vitry.value = 200000;
    const s = E.compute(p2, { ...D.FX_STATIC }, 'static');
    const vit = s.immoView.properties.find((p) => p.loanKey === 'vitry');
    assert.ok(vit.exitCosts.netEquityAfterExit < -60000, 'équité après sortie : ' + vit.exitCosts.netEquityAfterExit);
    assert.equal(Math.round(s.amine.vitryEquity), Math.round(vit.exitCosts.netEquityAfterExit), 'comptée signée au patrimoine');
    const s0 = E.compute(clone(P), { ...D.FX_STATIC }, 'static');
    assert.equal(Math.round(s0.couple.nw - s.couple.nw), Math.round(s0.amine.vitryEquity - s.amine.vitryEquity), 'la baisse du patrimoine = la baisse de l\'équité');
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(ko === 0 ? '\n✅ Référentiel immo : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
