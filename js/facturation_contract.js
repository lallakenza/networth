/**
 * Contrat de facturation publié par le site 2048 (dépôt `lallakenza/2048`).
 *
 * POURQUOI UN CONTRAT DISTANT. Le montant de facturation vient d'un AUTRE dépôt. Il
 * transitait par un objet libre déposé dans le localStorage : présent seulement si l'autre
 * site avait été ouvert dans ce navigateur, sans version de schéma, sans producteur, sans
 * date. Le dashboard ne pouvait ni détecter un changement de format en amont, ni dire si le
 * chiffre affiché datait d'hier ou de six mois. 2048 publie désormais un JSON versionné à
 * une URL stable : c'est la source de vérité, lisible sans avoir ouvert l'autre site.
 *
 * ORDRE DES SOURCES, du plus fiable au moins fiable :
 *   1. le contrat HTTP (`URL_CONTRAT`), validé — source prioritaire ;
 *   2. le dernier contrat valide mis en cache localement, si le réseau est indisponible ;
 *   3. l'objet libre hérité `facturation_positions`, si 2048 n'a pas encore publié ;
 *   4. rien — état « indisponible », annoncé comme tel.
 *
 * IL N'Y A PAS DE CINQUIÈME SOURCE. Les valeurs de repli qui vivaient dans `data.js` ont été
 * retirées : elles donnaient Benoit DÉBITEUR (−196 915 MAD) là où le contrat le donne
 * CRÉANCIER (+17 566), ignoraient Bob (−92 376) et aboutissaient à −1 424 € au lieu de
 * −788 €. Un chiffre faux qu'on ne peut pas distinguer d'un chiffre juste est pire qu'une
 * absence : l'absence, elle, se voit.
 *
 * CONVENTION DE SIGNE — vérifiée, jamais supposée. `positif = le tiers doit à Amine`. Le
 * contrat la déclare en toutes lettres ; si la déclaration change, le contrat est refusé
 * plutôt que comptabilisé à l'envers.
 *
 * PAS DE NETTING. `netPositionMad` est la somme ARITHMÉTIQUE des positions brutes. Un
 * contrat qui annoncerait `nettingApplied: true` compenserait ce qu'Augustin doit avec ce
 * qu'Amine doit à Bob — deux créances sur des tiers différents, sans accord de compensation.
 * Ce cas est refusé.
 */

export const URL_CONTRAT = 'https://lallakenza.github.io/2048/data/networth-bridge.json';
export const CLE_CACHE = 'nw_facturation_contrat_v1';

/** Version majeure de schéma que ce dashboard sait lire. */
export const SCHEMA_MAJEUR = 1;

/** Convention de signe attendue. Une autre formulation ⇒ refus, pas d'interprétation. */
export const CONVENTION_SIGNE = 'positif = le tiers doit à Amine ; négatif = Amine doit au tiers';

/** Au-delà, les données ne décrivent plus la situation courante. */
export const SEUIL_PERIME_JOURS = 31;

/** Âge en jours d'une date ISO `AAAA-MM-JJ` ; null si illisible. */
export function ageJours(iso, maintenant) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const t = Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(t)) return null;
  return Math.floor(((maintenant || Date.now()) - t) / 86400000);
}

/**
 * Valide un contrat. Ne lève jamais : un contrat douteux doit faire replier, pas planter
 * le calcul du patrimoine.
 * @returns {{ok: boolean, code: string, raison: string|null}}
 *   code ∈ 'ok' | 'schema-incompatible' | 'invalide'
 */
export function validerContrat(c) {
  const ko = (code, raison) => ({ ok: false, code, raison });
  if (!c || typeof c !== 'object') return ko('invalide', 'payload absent ou non-objet');

  // ── Version de schéma : compatibilité par version MAJEURE ──
  const sv = c.schemaVersion;
  if (typeof sv !== 'string' || !/^\d+\.\d+\.\d+$/.test(sv)) {
    return ko('invalide', 'schemaVersion absent ou mal formé');
  }
  const majeur = parseInt(sv.split('.')[0], 10);
  if (majeur !== SCHEMA_MAJEUR) {
    return ko('schema-incompatible',
      'schéma ' + sv + ' — ce dashboard lit la version majeure ' + SCHEMA_MAJEUR);
  }

  if (typeof c.producerVersion !== 'string' || !c.producerVersion) {
    return ko('invalide', 'producerVersion non déclarée');
  }
  if (ageJours(c.dataAsOf) == null) return ko('invalide', 'dataAsOf absent ou illisible');
  if (c.currency !== 'MAD') return ko('invalide', 'devise « ' + c.currency +' » inattendue');

  // ── Convention de signe : comparée, pas supposée ──
  if (c.signConvention !== CONVENTION_SIGNE) {
    return ko('schema-incompatible',
      'convention de signe inattendue : « ' + c.signConvention + ' »');
  }

  // ── Pas de compensation entre tiers ──
  if (c.nettingApplied === true) {
    return ko('invalide', 'nettingApplied=true — la compensation entre tiers n’est pas comptabilisable');
  }

  const pg = c.positionsGross;
  if (!pg || typeof pg !== 'object' || Object.keys(pg).length === 0) {
    return ko('invalide', 'positionsGross absent ou vide');
  }
  for (const [cle, v] of Object.entries(pg)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return ko('invalide', 'position non numérique pour « ' + cle + ' »');
    }
  }
  if (typeof c.netPositionMad !== 'number' || !Number.isFinite(c.netPositionMad)) {
    return ko('invalide', 'netPositionMad non numérique');
  }
  // Le net DOIT être la somme des positions brutes. S'il en diverge, une compensation a eu
  // lieu quelque part malgré `nettingApplied: false`, et le total n'est plus la position
  // brute agrégée que le dashboard accepte de comptabiliser.
  const somme = Object.values(pg).reduce((s, v) => s + v, 0);
  if (Math.abs(somme - c.netPositionMad) > 1) {
    return ko('invalide', 'netPositionMad (' + c.netPositionMad + ') ≠ Σ positions brutes (' + somme + ')');
  }
  return { ok: true, code: 'ok', raison: null };
}

/** 'frais' tant que les données sont récentes, 'périmé' au-delà du seuil. */
export function etatFraicheur(dataAsOf, maintenant) {
  const a = ageJours(dataAsOf, maintenant);
  if (a == null) return 'indisponible';
  return a <= SEUIL_PERIME_JOURS ? 'frais' : 'périmé';
}

/**
 * Normalise un contrat validé en la forme que l'engine consomme.
 * Aucune conversion de devise ici : l'engine seul détient le taux.
 */
export function normaliser(c, canal) {
  const positions = Object.entries(c.positionsGross).map(([cle, montantMAD]) => ({
    cle,
    nom: cle.charAt(0).toUpperCase() + cle.slice(1),
    montantMAD,
    // Convention vérifiée plus haut : positif ⇒ le tiers doit à Amine.
    sens: montantMAD >= 0 ? 'tiers-doit-a-amine' : 'amine-doit-au-tiers',
  })).sort((a, b) => b.montantMAD - a.montantMAD);
  return {
    canal,                                  // 'http' | 'cache'
    schemaVersion: c.schemaVersion,
    producerVersion: c.producerVersion,
    dataAsOf: c.dataAsOf.slice(0, 10),
    generatedAt: c.generatedAt || null,
    devise: c.currency,
    netMAD: c.netPositionMad,
    positions,
    ageJours: ageJours(c.dataAsOf),
    fraicheur: etatFraicheur(c.dataAsOf),
  };
}

/** Écrit le contrat validé dans le cache local (pour les chargements hors ligne). */
export function mettreEnCache(c, magasin) {
  try {
    const m = magasin || (typeof localStorage !== 'undefined' ? localStorage : null);
    // Le canal d'ORIGINE est mémorisé : sans lui, un contrat reçu à l'instant par HTTP
    // s'annonçait « cache local » au rendu suivant — indiscernable du repli hors ligne.
    if (m) m.setItem(CLE_CACHE, JSON.stringify({ recuLe: Date.now(), canal: 'http', contrat: c }));
  } catch (e) { /* mode privé : le cache hors ligne est perdu, rien de plus */ }
}

/**
 * Lecture SYNCHRONE du dernier contrat mis en cache. L'engine est synchrone : il ne peut
 * pas attendre le réseau, il lit ce que le chargement asynchrone a déposé.
 * @returns {{contrat: object|null, code: string, raison: string|null}}
 */
export function lireContratEnCache(magasin) {
  let brut = null;
  try {
    const m = magasin || (typeof localStorage !== 'undefined' ? localStorage : null);
    brut = m ? m.getItem(CLE_CACHE) : null;
  } catch (e) { return { contrat: null, code: 'indisponible', raison: 'magasin inaccessible' }; }
  if (!brut) return { contrat: null, code: 'indisponible', raison: 'aucun contrat reçu' };
  let enveloppe = null;
  try { enveloppe = JSON.parse(brut); }
  catch (e) { return { contrat: null, code: 'invalide', raison: 'cache illisible' }; }
  const c = enveloppe && enveloppe.contrat;
  const v = validerContrat(c);
  if (!v.ok) return { contrat: null, code: v.code, raison: v.raison };
  const n = normaliser(c, enveloppe.canal || 'cache');
  n.recuLe = enveloppe.recuLe || null;
  // Un contrat reçu il y a plus d'une journée n'a pas été rafraîchi depuis : la lecture
  // est alors bien celle du CACHE, pas d'une récupération distante récente.
  n.canal = (n.canal === 'http' && enveloppe.recuLe && (Date.now() - enveloppe.recuLe) < 86400000)
    ? 'http' : 'cache';
  return { contrat: n, code: 'ok', raison: null };
}

/**
 * Récupère le contrat par HTTP et le met en cache s'il est valide.
 * Appelé au démarrage, avant le premier calcul, comme `loadImmoRef`.
 * @returns {Promise<{contrat: object|null, code: string, raison: string|null}>}
 */
export async function chargerContratDistant(fetchImpl, magasin) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { contrat: null, code: 'indisponible', raison: 'fetch indisponible' };
  let rep = null;
  try {
    // `cache: 'no-store'` : la ressource est servie avec max-age=600 ; sans cela le
    // dashboard pourrait afficher « frais » sur un contrat vieux de dix minutes de plus
    // que ce qu'il annonce, et surtout rater une publication récente de 2048.
    rep = await f(URL_CONTRAT, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
  } catch (e) {
    return { contrat: null, code: 'indisponible', raison: 'réseau : ' + (e && e.message) };
  }
  if (!rep || !rep.ok) {
    return { contrat: null, code: 'indisponible', raison: 'HTTP ' + (rep ? rep.status : '?') };
  }
  let c = null;
  try { c = await rep.json(); }
  catch (e) { return { contrat: null, code: 'invalide', raison: 'JSON illisible' }; }
  const v = validerContrat(c);
  if (!v.ok) return { contrat: null, code: v.code, raison: v.raison };
  mettreEnCache(c, magasin);
  return { contrat: normaliser(c, 'http'), code: 'ok', raison: null };
}
