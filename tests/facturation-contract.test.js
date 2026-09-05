/**
 * Passerelle 2048 → networth : le contrat distant, ses replis et ses refus.
 *
 * Le montant de facturation vient d'un autre dépôt. Ces tests fixent ce que le dashboard
 * accepte de lire, ce qu'il refuse, et ce qu'il fait quand il ne peut rien lire — les quatre
 * états que l'écran doit savoir nommer.
 */
import assert from 'node:assert/strict';
import {
  validerContrat, lireContratEnCache, chargerContratDistant, etatFraicheur, normaliser,
  mettreEnCache, CLE_CACHE, CONVENTION_SIGNE, SCHEMA_MAJEUR, URL_CONTRAT,
} from '../js/facturation_contract.js';

const jour = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

/** Fixture conforme au contrat réellement publié par 2048 (schéma 1.0.0, producteur v7.36). */
const contratValide = (patch) => Object.assign({
  schemaVersion: '1.0.0',
  producerVersion: 'v7.36',
  generatedAt: '2026-09-05T20:42:11.904Z',
  dataAsOf: jour(1),
  currency: 'MAD',
  signConvention: CONVENTION_SIGNE,
  positionsGross: { augustin: 66239, benoit: 17566, bob: -92376 },
  netPositionMad: -8571,
  nettingApplied: false,
}, patch || {});

const magasin = () => {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; }, _brut: m };
};

let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };
const ta = async (nom, fn) => { try { await fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };

console.log('\n── contrat de facturation 2048 ──');

// ── Source HTTP valide ──────────────────────────────────────────────────────────────────
await ta('source HTTP valide : contrat retenu, normalisé et mis en cache', async () => {
  const m = magasin();
  const faux = async (url) => {
    assert.equal(url, URL_CONTRAT, 'ce n’est pas l’URL du contrat');
    return { ok: true, status: 200, json: async () => contratValide() };
  };
  const r = await chargerContratDistant(faux, m);
  assert.equal(r.code, 'ok', r.raison || '');
  assert.equal(r.contrat.canal, 'http');
  assert.equal(r.contrat.schemaVersion, '1.0.0');
  assert.equal(r.contrat.producerVersion, 'v7.36');
  assert.equal(r.contrat.netMAD, -8571);
  assert.equal(r.contrat.fraicheur, 'frais');
  assert.ok(m.getItem(CLE_CACHE), 'le contrat n’a pas été mis en cache');
});

await ta('HTTP en échec : indisponible, jamais une valeur inventée', async () => {
  const r1 = await chargerContratDistant(async () => ({ ok: false, status: 503 }), magasin());
  assert.equal(r1.code, 'indisponible');
  assert.equal(r1.contrat, null);
  const r2 = await chargerContratDistant(async () => { throw new Error('offline'); }, magasin());
  assert.equal(r2.code, 'indisponible');
  assert.match(r2.raison, /offline/);
});

// ── Repli sur le cache local ────────────────────────────────────────────────────────────
t('repli : le dernier contrat valide est relu depuis le cache', () => {
  const m = magasin();
  mettreEnCache(contratValide(), m);
  const r = lireContratEnCache(m);
  assert.equal(r.code, 'ok');
  assert.equal(r.contrat.netMAD, -8571);
});

t('aucun contrat en cache : indisponible, avec le motif', () => {
  const r = lireContratEnCache(magasin());
  assert.equal(r.code, 'indisponible');
  assert.equal(r.raison, 'aucun contrat reçu');
});

// ── Données périmées ────────────────────────────────────────────────────────────────────
t('données périmées : contrat retenu mais signalé', () => {
  assert.equal(etatFraicheur(jour(1)), 'frais');
  assert.equal(etatFraicheur(jour(31)), 'frais');
  assert.equal(etatFraicheur(jour(32)), 'périmé');
  assert.equal(etatFraicheur(null), 'indisponible');
  const vieux = normaliser(contratValide({ dataAsOf: jour(120) }), 'http');
  assert.equal(vieux.fraicheur, 'périmé');
  assert.equal(vieux.netMAD, -8571, 'un contrat périmé reste la dernière position connue');
});

// ── Schéma incompatible ─────────────────────────────────────────────────────────────────
t('schéma majeur différent : refusé, code « schema-incompatible »', () => {
  const v = validerContrat(contratValide({ schemaVersion: String(SCHEMA_MAJEUR + 1) + '.0.0' }));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'schema-incompatible');
});

t('même majeure, mineure supérieure : accepté (compatibilité ascendante)', () => {
  assert.equal(validerContrat(contratValide({ schemaVersion: '1.4.2' })).ok, true);
});

t('convention de signe modifiée : refusée plutôt qu’interprétée', () => {
  const v = validerContrat(contratValide({ signConvention: 'positif = Amine doit au tiers' }));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'schema-incompatible');
});

// ── Refus de la compensation entre tiers ────────────────────────────────────────────────
t('nettingApplied=true : refusé — pas de compensation Augustin/Bob', () => {
  const v = validerContrat(contratValide({ nettingApplied: true }));
  assert.equal(v.ok, false);
  assert.match(v.raison, /compensation/);
});

t('net ≠ Σ positions brutes : refusé', () => {
  const v = validerContrat(contratValide({ netPositionMad: -5000 }));
  assert.equal(v.ok, false);
  assert.match(v.raison, /Σ positions brutes/);
});

t('le net publié est bien la somme arithmétique des positions', () => {
  const c = contratValide();
  assert.equal(Object.values(c.positionsGross).reduce((s, v) => s + v, 0), c.netPositionMad);
});

// ── Champs manquants ou malformés ───────────────────────────────────────────────────────
t('producteur, date, devise et montants sont exigés', () => {
  const sans = (k) => { const c = contratValide(); delete c[k]; return validerContrat(c).ok; };
  assert.equal(sans('producerVersion'), false);
  assert.equal(sans('dataAsOf'), false);
  assert.equal(sans('positionsGross'), false);
  assert.equal(validerContrat(contratValide({ currency: 'EUR' })).ok, false);
  assert.equal(validerContrat(contratValide({ positionsGross: { x: '66239' }, netPositionMad: 66239 })).ok, false);
});

t('JSON illisible en cache : replie, ne lève pas', () => {
  const m = magasin();
  m.setItem(CLE_CACHE, '{ pas du json');
  const r = lireContratEnCache(m);
  assert.equal(r.contrat, null);
  assert.equal(r.code, 'invalide');
});

// ── Sens des positions ──────────────────────────────────────────────────────────────────
t('le sens de chaque position suit la convention déclarée', () => {
  const n = normaliser(contratValide(), 'http');
  const par = Object.fromEntries(n.positions.map((p) => [p.cle, p.sens]));
  assert.equal(par.augustin, 'tiers-doit-a-amine');
  assert.equal(par.benoit, 'tiers-doit-a-amine');
  assert.equal(par.bob, 'amine-doit-au-tiers');
});

console.log(ko === 0 ? '\n✅ contrat 2048 : tout passe\n' : '\n❌ ' + ko + ' échec(s)\n');
process.exit(ko === 0 ? 0 : 1);
