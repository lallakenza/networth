#!/usr/bin/env node
// ============================================================================
// Registre des factures SAP & Tax — présence, unicité, échéances, double comptage.
//
// Le registre présentait INVSNT006 comme la SEULE créance pro en cours alors que deux
// factures postérieures avaient été émises : 33 215 EUR manquaient. Ce test échoue si
// une facture disparaît, apparaît deux fois, perd son échéance, ou si un encaissement
// vient doubler un montant déjà compté dans le cash.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os');
const { contenuClair } = require('./_clair.cjs');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-sap-'));
for (const f of ['engine.js', 'data.js', 'facturation_contract.js']) {
  const brut = f === 'data.js' ? contenuClair() : fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8');
  fs.writeFileSync(path.join(TMP, f), brut.replace(/\?v=\d+/g, ''));
}

const ATTENDUES = {
  INVSNT006: { montant: 19124.79, echeance: '2026-07-01' },
  INVSNT007: { montant: 18655,    echeance: '2026-09-01' },
  INVSNT008: { montant: 14560,    echeance: '2026-10-01' },
  INVSNT009: { montant: 19110,    echeance: '2026-11-01' },
  INVSNT010: { montant: 11830,    echeance: '2026-12-01' },
};
// v589 : INVSNT009 soldée le 03/11 (19 085 crédités sur iBanq + 25 € de frais) ; INVSNT010 (octobre)
// remplace la provision ACCSNT10. Plus aucun encaissement présumé : le total ne dépend plus du jour.
const TOTAL_PRO_ATTENDU = 11830;

(async () => {
  const echecs = [];
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const { compute, computeAlerts } = await import('file://' + path.join(TMP, 'engine.js'));
  const s = compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
  const items = D.PORTFOLIO.amine.creances.items;

  for (const [id, att] of Object.entries(ATTENDUES)) {
    const trouvees = items.filter(i => i.id === id);
    if (trouvees.length === 0) { echecs.push(`${id} absente du registre`); continue; }
    if (trouvees.length > 1) { echecs.push(`${id} apparaît ${trouvees.length} fois — double comptage`); continue; }
    const f = trouvees[0];
    if (Math.abs(f.amount - att.montant) > 0.01) {
      echecs.push(`${id} : montant ${f.amount} au lieu de ${att.montant}`);
    }
    if (f.dueDate !== att.echeance) {
      echecs.push(`${id} : échéance « ${f.dueDate} » au lieu de « ${att.echeance} » — l'alerte de retard en dépend`);
    }
    // Une facture en cours ne doit porter AUCUN encaissement : sinon le montant serait
    // compté deux fois (une fois en créance, une fois dans le cash).
    if (f.status === 'en_cours' && (f.payments || []).length) {
      echecs.push(`${id} est « en cours » mais porte ${f.payments.length} encaissement(s) — risque de double comptage avec le cash`);
    }
  }

  // v589 — le temps ne fabrique ni paiement ni recouvrement : aucun paiement présumé, et compute()
  // ne modifie pas les créances, même appelé plusieurs fois et longtemps après l'échéance.
  {
    const E = await import('file://' + path.join(TMP, 'engine.js'));
    if ('applyCreancesAutoSettle' in E) echecs.push('applyCreancesAutoSettle existe encore');
    if (items.some(c => (c.payments || []).some(pay => pay.presumed))) echecs.push('paiement présumé dans le registre');
    const avant = JSON.stringify(items);
    compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static'); compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
    if (JSON.stringify(items) !== avant) echecs.push('compute() modifie les créances');
    // Facture fictive échue depuis longtemps, sans paiement : reste entière dans le patrimoine.
    const P2 = JSON.parse(JSON.stringify(D.PORTFOLIO));
    P2.amine.creances.items.push({ id: 'INVSNT099', amount: 1000, currency: 'EUR', type: 'pro', probability: 1, status: 'en_cours', dueDate: '2020-01-01', payments: [] });
    const s2 = compute(P2, { ...D.FX_STATIC }, 'static');
    if (Math.abs(s2.amine.recvPro - s.amine.recvPro - 1000) > 0.01) echecs.push('facture échue retirée du patrimoine sans paiement');
    // v599 — la sévérité doit être l'une de celles que le rendu affiche : 'orange' était filtrée en silence.
    const alertes2 = computeAlerts(s2);
    if (!alertes2.some(a => (a.title || '').includes('INVSNT099') && a.severity === 'yellow')) echecs.push('pas d\'alerte « encaissement attendu non constaté » (jaune) après la date attendue');
    const { SEVERITES_ALERTE } = await import('file://' + path.join(TMP, 'engine.js'));
    const invisibles = alertes2.filter(a => !SEVERITES_ALERTE.includes(a.severity));
    if (invisibles.length) echecs.push('alertes au rendu impossible : ' + invisibles.map(a => a.severity + ' « ' + a.title + ' »').join(', '));
    // Paiement partiel : seul le reste dû est compté.
    const P3 = JSON.parse(JSON.stringify(P2));
    P3.amine.creances.items.at(-1).payments = [{ amount: 400, date: '2020-02-01', currency: 'EUR' }];
    const s3 = compute(P3, { ...D.FX_STATIC }, 'static');
    if (Math.abs(s3.amine.recvPro - s.amine.recvPro - 600) > 0.01) echecs.push('paiement partiel : le reste dû n\'est pas 600');
    // Paiement complet net de frais : la facture est soldée, il ne reste pas de faux impayé.
    const P4 = JSON.parse(JSON.stringify(P2));
    Object.assign(P4.amine.creances.items.at(-1), { status: 'recouvré', payments: [{ amount: 975, frais: 25, date: '2020-02-01', currency: 'EUR' }] });
    const s4 = compute(P4, { ...D.FX_STATIC }, 'static');
    if (Math.abs(s4.amine.recvPro - s.amine.recvPro) > 0.01) echecs.push('paiement net de frais : faux impayé de 25 €');
  }

  // v589 — INVSNT009 : facture 19 110 = crédit 19 085 + frais 25, crédit porté sur iBanq (reconstruit).
  {
    const f9 = items.find(i => i.id === 'INVSNT009');
    const E = await import('file://' + path.join(TMP, 'engine.js'));
    if (f9.status !== 'recouvré') echecs.push('INVSNT009 non soldée');
    if (Math.abs(E.montantRegle(f9) - 19110) > 0.01) echecs.push('INVSNT009 : crédit + frais ≠ 19 110');
    if (Math.abs(E.fraisReglement(f9) - 25) > 0.01) echecs.push('INVSNT009 : frais ≠ 25');
    const ib = E.soldeIbanqBairok(D.PORTFOLIO);
    if (Math.abs(ib.observe - 12765.55) > 0.01 || Math.abs(ib.montant - 31850.55) > 0.01 || !ib.reconstruit) {
      echecs.push('iBanq : attendu observé 12 765,55 au 31/10 + 19 085 = 31 850,55 reconstruit (' + JSON.stringify(ib) + ')');
    }
    // Un relevé postérieur au crédit l'absorbe : plus de crédit ajouté, pas de double comptage.
    const P5 = JSON.parse(JSON.stringify(D.PORTFOLIO));
    P5.amine.uae.ibanqBairokObserveLe = '2026-11-05'; P5.amine.uae.ibanqBairok = 31850.55;
    const ib5 = E.soldeIbanqBairok(P5);
    if (Math.abs(ib5.montant - 31850.55) > 0.01 || ib5.reconstruit) echecs.push('rapprochement ultérieur : le crédit est compté deux fois');
    const cv = s.creancesView.recoveredItems.find(i => i.id === 'INVSNT009');
    if (!cv || Math.abs(cv.paymentsTotal - 19085) > 0.01 || Math.abs(cv.fraisTotal - 25) > 0.01 || Math.abs(cv.remainingEUR) > 0.01) {
      echecs.push('vue créances : INVSNT009 doit montrer 19 085 crédités, 25 de frais, 0 restant');
    }
  }

  // L'accrual de septembre et la facture qui le remplace ne doivent jamais coexister.
  if (items.some(i => i.id === 'ACCSNT09')) echecs.push('ACCSNT09 (accrual septembre) coexiste avec INVSNT009 — septembre compté deux fois');
  if (items.some(i => i.id === 'ACCSNT10')) echecs.push('ACCSNT10 (accrual octobre) coexiste avec INVSNT010 — octobre compté deux fois');

  // Total des créances pro
  const totalPro = Math.round(s.amine.recvPro * 100) / 100;
  if (Math.abs(totalPro - TOTAL_PRO_ATTENDU) > 0.01) {
    echecs.push(`total des créances pro : ${totalPro} au lieu de ${TOTAL_PRO_ATTENDU}`);
  }

  // Aucun montant de facture en cours ne doit apparaître comme encaissement ailleurs.
  const encaissements = items.flatMap(i => (i.payments || []).map(p => p.amount));
  for (const [id, att] of Object.entries(ATTENDUES)) {
    const f = items.find(i => i.id === id);
    if (f && f.status === 'en_cours' && encaissements.some(m => Math.abs(m - att.montant) < 0.01)) {
      echecs.push(`le montant de ${id} (${att.montant}) apparaît comme encaissement d'une autre ligne — double comptage`);
    }
  }

  // Alertes (v550) : SAP & Tax paie selon le contrat (~échéance + quelques jours) — ce n'est PAS
  // une créance douteuse. Aucune facture SAP ne doit produire d'alerte de retard ni de relance.
  const alertes = computeAlerts(s);
  for (const id of Object.keys(ATTENDUES)) {
    if (alertes.some(a => (a.title || '').includes(id) && a.severity === 'red')) {
      echecs.push(`${id} déclenche une alerte de retard alors que le client paie selon le contrat`);
    }
  }
  for (const it of s.creancesView.allItems || s.creancesView.items || []) {
    if (!/^(INVSNT|ACCSNT)/.test(it.id || '')) continue;
    if (it.daysOverdue > 0 || it.needsFollowUp) echecs.push(`${it.id} affiché en retard / à relancer`);
  }

  if (echecs.length) {
    console.error('✗ ' + echecs.length + ' contrôle(s) en échec :');
    for (const e of echecs) console.error('   - ' + e);
    process.exit(1);
  }
  console.log('✓ registre SAP & Tax : factures uniques, aucun paiement présumé, INVSNT009 rapprochée (19 085 + 25), total pro '
    + TOTAL_PRO_ATTENDU + ' EUR, aucun double comptage, aucune alerte de retard (paiement contractuel)');
})();
