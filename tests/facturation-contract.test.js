/**
 * Passerelle 2048 → networth : le contrat versionné prime, le format hérité replie.
 *
 * Ce test valide le CONTRAT que le dashboard accepte, sans rien exiger du dépôt 2048 :
 * la fixture ci-dessous est conforme au schéma publié, et c'est elle qui fait foi. Le jour
 * où 2048 publie ce format, la passerelle bascule sans coordination ; tant qu'il ne le
 * publie pas, le repli hérité reste le chemin actif — les deux sont couverts ici.
 */
import assert from 'node:assert/strict';
import { validerContratFacturation, lireContratFacturation, fraicheurContrat, SCHEMA_FACTURATION }
  from '../js/facturation_contract.js';

const magasin = (valeur) => ({ getItem: (k) => (k === 'facturation_contract_v1' ? valeur : null) });
const aujourdhui = new Date().toISOString().slice(0, 10);

const CONTRAT_VALIDE = {
  schema: SCHEMA_FACTURATION,
  producer: { name: 'facturation (lallakenza/2048)', version: '3.2.0' },
  dataAsOf: aujourdhui,
  positions: {
    augustin: { label: 'Créance sur Augustin (Azarkan)', amount: 181609, currency: 'MAD' },
    benoit:   { label: 'Dette envers Benoit (Badre)',    amount: -196915, currency: 'MAD' },
  },
};

let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };

console.log('\n── contrat de facturation ──');

t('une fixture conforme est acceptée', () => {
  assert.equal(validerContratFacturation(CONTRAT_VALIDE).ok, true);
  const lu = lireContratFacturation(magasin(JSON.stringify(CONTRAT_VALIDE)));
  assert.equal(lu.valide, true);
  assert.equal(lu.contrat.producer.version, '3.2.0');
});

t('un schéma inconnu est refusé, avec le motif', () => {
  const v = validerContratFacturation({ ...CONTRAT_VALIDE, schema: 'facturation/v2' });
  assert.equal(v.ok, false);
  assert.match(v.raison, /schéma/);
});

t('un producteur non déclaré est refusé', () => {
  const c = { ...CONTRAT_VALIDE }; delete c.producer;
  assert.equal(validerContratFacturation(c).ok, false);
});

t('une date de production absente est refusée', () => {
  const c = { ...CONTRAT_VALIDE }; delete c.dataAsOf;
  assert.equal(validerContratFacturation(c).ok, false);
});

t('un montant non numérique est refusé (et ne devient pas NaN dans le NW)', () => {
  const c = { ...CONTRAT_VALIDE, positions: { x: { amount: '181609', currency: 'MAD' } } };
  assert.equal(validerContratFacturation(c).ok, false);
});

t('une devise invalide est refusée', () => {
  const c = { ...CONTRAT_VALIDE, positions: { x: { amount: 1, currency: 'DIRHAM' } } };
  assert.equal(validerContratFacturation(c).ok, false);
});

t('un JSON illisible replie au lieu de lever', () => {
  const lu = lireContratFacturation(magasin('{ pas du json'));
  assert.equal(lu.valide, false);
  assert.equal(lu.contrat, null);
});

t('un contrat absent replie, avec le motif « contrat absent »', () => {
  const lu = lireContratFacturation(magasin(null));
  assert.equal(lu.valide, false);
  assert.equal(lu.raison, 'contrat absent');
});

t('la fraîcheur est qualifiée par paliers', () => {
  assert.equal(fraicheurContrat(0), 'à jour');
  assert.equal(fraicheurContrat(7), 'à jour');
  assert.equal(fraicheurContrat(8), 'à rafraîchir');
  assert.equal(fraicheurContrat(31), 'à rafraîchir');
  assert.equal(fraicheurContrat(32), 'périmé');
  assert.equal(fraicheurContrat(null), 'inconnue');
});

t('la somme des positions du contrat est le net attendu', () => {
  const net = Object.values(CONTRAT_VALIDE.positions).reduce((s, p) => s + p.amount, 0);
  assert.equal(net, -15306);   // 181 609 − 196 915, en MAD natif
});

console.log(ko === 0 ? '\n✅ contrat de facturation : tout passe\n' : '\n❌ ' + ko + ' échec(s)\n');
process.exit(ko === 0 ? 0 : 1);
