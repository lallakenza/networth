/**
 * Lecture du contrat de facturation publié par le site 2048 (dépôt `lallakenza/2048`).
 *
 * POURQUOI UN CONTRAT. La passerelle lisait un objet libre déposé dans le localStorage :
 * aucune version de schéma, aucun producteur, aucune date de production. Le dashboard ne
 * pouvait donc ni détecter un changement de format en amont, ni dire si le chiffre qu'il
 * affichait datait d'hier ou de six mois — il l'affichait, simplement. Un format non
 * versionné entre deux dépôts est une dépendance qui casse en silence.
 *
 * ORDRE DES SOURCES, du plus fiable au moins fiable :
 *   1. `facturation_contract_v1` — payload versionné et validé (source prioritaire) ;
 *   2. `facturation_positions`   — l'ancien objet libre (repli, format hérité) ;
 *   3. `PORTFOLIO.amine.facturation` — les valeurs de `data.js` (repli hors ligne).
 *
 * Ce module ne touche PAS au dépôt 2048 : il décrit ce que le dashboard accepte de lire.
 * Tant que 2048 ne publie pas le contrat, le repli hérité continue de fonctionner à
 * l'identique — la bascule est donc sans risque et sans coordination.
 */
export const SCHEMA_FACTURATION = 'facturation/v1';

/** Âge en jours d'une date ISO ; null si illisible. */
function _ageJours(iso, maintenant) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const t = Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(t)) return null;
  return Math.floor(((maintenant || Date.now()) - t) / 86400000);
}

/**
 * Valide un contrat. Renvoie `{ ok, raison }` — jamais d'exception : un contrat invalide
 * doit faire retomber sur le repli, pas casser le calcul du patrimoine.
 */
export function validerContratFacturation(c) {
  if (!c || typeof c !== 'object') return { ok: false, raison: 'payload absent ou non-objet' };
  if (c.schema !== SCHEMA_FACTURATION) return { ok: false, raison: 'schéma « ' + c.schema + ' » non reconnu' };
  if (!c.producer || !c.producer.name) return { ok: false, raison: 'producteur non déclaré' };
  if (_ageJours(c.dataAsOf) == null) return { ok: false, raison: 'dataAsOf absent ou illisible' };
  const pos = c.positions;
  if (!pos || typeof pos !== 'object' || Object.keys(pos).length === 0) {
    return { ok: false, raison: 'aucune position' };
  }
  for (const [cle, p] of Object.entries(pos)) {
    if (!p || typeof p.amount !== 'number' || !Number.isFinite(p.amount)) {
      return { ok: false, raison: 'montant non numérique pour « ' + cle + ' »' };
    }
    if (typeof p.currency !== 'string' || p.currency.length !== 3) {
      return { ok: false, raison: 'devise invalide pour « ' + cle + ' »' };
    }
  }
  return { ok: true, raison: null };
}

/** Qualifie la fraîcheur d'un contrat à partir de son âge. */
export function fraicheurContrat(ageJours) {
  if (ageJours == null) return 'inconnue';
  if (ageJours <= 7) return 'à jour';
  if (ageJours <= 31) return 'à rafraîchir';
  return 'périmé';
}

/**
 * Lit le contrat depuis un magasin clé/valeur (le localStorage en production, un objet
 * simple dans les tests).
 * @returns {{contrat: object|null, valide: boolean, raison: string|null}}
 */
export function lireContratFacturation(magasin) {
  let brut = null;
  try { brut = magasin && magasin.getItem ? magasin.getItem('facturation_contract_v1') : null; }
  catch (e) { return { contrat: null, valide: false, raison: 'magasin inaccessible' }; }
  if (!brut) return { contrat: null, valide: false, raison: 'contrat absent' };
  let c = null;
  try { c = JSON.parse(brut); } catch (e) { return { contrat: null, valide: false, raison: 'JSON illisible' }; }
  const v = validerContratFacturation(c);
  return { contrat: v.ok ? c : null, valide: v.ok, raison: v.raison };
}
