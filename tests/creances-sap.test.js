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

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-sap-'));
for (const f of ['engine.js', 'data.js']) {
  fs.writeFileSync(path.join(TMP, f),
    fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8').replace(/\?v=\d+/g, ''));
}

const ATTENDUES = {
  INVSNT006: { montant: 19124.79, echeance: '2026-07-01' },
  INVSNT007: { montant: 18655,    echeance: '2026-09-01' },
  INVSNT008: { montant: 14560,    echeance: '2026-10-01' },
};
const TOTAL_PRO_ATTENDU = 52339.79;

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

  // Alertes : une facture échue doit alerter, une facture à échoir non.
  const auj = new Date();
  const alertes = computeAlerts(s);
  for (const [id, att] of Object.entries(ATTENDUES)) {
    const f = items.find(i => i.id === id);
    if (!f || f.status !== 'en_cours') continue;
    const echue = new Date(att.echeance + 'T00:00:00') < auj;
    const aUneAlerte = alertes.some(a => (a.title || '').includes(id) && a.severity === 'red');
    if (echue && !aUneAlerte) echecs.push(`${id} est échue depuis le ${att.echeance} mais ne déclenche aucune alerte de retard`);
    if (!echue && aUneAlerte) echecs.push(`${id} n'est pas encore échue (${att.echeance}) mais déclenche une alerte de retard`);
  }

  if (echecs.length) {
    console.error('✗ ' + echecs.length + ' contrôle(s) en échec :');
    for (const e of echecs) console.error('   - ' + e);
    process.exit(1);
  }
  console.log('✓ registre SAP & Tax : 3 factures uniques, échéances correctes, total pro '
    + TOTAL_PRO_ATTENDU + ' EUR, aucun double comptage, alertes conformes à la date du jour');
})();
