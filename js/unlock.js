/**
 * unlock.js — déverrouillage des données patrimoniales au chargement.
 *
 * Le site est servi depuis un dépôt public : tout fichier publié est téléchargeable. Les blocs
 * sensibles (soldes, positions, créances, immobilier, revenus) ne sont donc plus publiés en clair
 * mais dans `js/data.enc.js`, chiffré en AES-256-GCM. Ce module les remet en place dans les objets
 * que le reste de l'application importe déjà — sans changer une seule ligne d'engine, render ou charts.
 *
 * POURQUOI ÇA MARCHE SANS TOUT RÉÉCRIRE : les modules font `import { PORTFOLIO } from './data.js'`
 * et reçoivent une RÉFÉRENCE. En remplissant l'objet existant (au lieu de le remplacer), toutes
 * les vues voient les données. C'est exactement le mécanisme qu'utilise déjà `applyImmoRef`
 * (surcouche Supabase) et `applyPriceRefs` (prix de référence).
 *
 * OÙ VA LA PHRASE — dit franchement : elle n'est écrite ni dans le dépôt, ni dans un cookie, ni
 * sur disque. En revanche, après un déverrouillage réussi, elle est gardée dans le `sessionStorage`
 * de l'onglet pour ne pas être redemandée à chaque rechargement (F5). Conséquences assumées :
 * elle disparaît à la fermeture de l'onglet, mais elle reste lisible par tout script s'exécutant
 * dans la page. Ce compromis ne dégrade pas la sécurité réelle — un script hostile capable de la
 * lire pourrait tout aussi bien lire les données déjà déchiffrées en mémoire. Pour supprimer ce
 * confort, retirer l'appel à `sessionStorage.setItem` ci-dessous : la phrase sera alors redemandée
 * à chaque rechargement.
 */

// LE SUFFIXE ?v=N EST OBLIGATOIRE, PAS DÉCORATIF. Les modules ES sont indexés par URL résolue :
// './data.js' et './data.js?v=502' sont DEUX modules distincts, donc deux objets PORTFOLIO
// distincts. Sans ce suffixe, le déchiffrement remplissait un orphelin que personne ne lit —
// le déverrouillage réussissait et le tableau de bord restait vide (v496 à v500).
import * as DATA from './data.js?v=502';

// Import DYNAMIQUE : tant que `js/data.enc.js` n'existe pas (chiffrement pas encore activé), le
// site continue de fonctionner exactement comme avant. Cela permet de livrer ce mécanisme sans
// rien casser, et de basculer le jour où la phrase est choisie et le blob généré.
let DATA_ENC = null;
export async function blobDisponible() {
  if (DATA_ENC) return true;
  // ?v=N ici aussi : sans lui le blob chiffré n'est JAMAIS invalidé par un bump de version, et
  // le service worker sert indéfiniment l'ancien. Il se déchiffre sans erreur (même phrase),
  // donc des soldes périmés s'affichent sous des badges « live ».
  try { DATA_ENC = (await import('./data.enc.js?v=502')).DATA_ENC; return !!DATA_ENC; }
  catch (e) { return false; }
}

const CLE_SESSION = 'nw_unlocked_v1';

// Appairage de l'appareil. La phrase saisie une fois est conservée dans le localStorage de CE
// navigateur, ce qui permet ensuite d'ouvrir avec le code court : le code ne déchiffre rien, il
// autorise à rejouer la phrase déjà présente. Un navigateur qui n'a jamais reçu la phrase ne
// s'ouvre pas au code, et le blob publié reste protégé par la phrase seule.
//
// Ce que cela coûte, dit franchement : la phrase est écrite sur le disque du navigateur et
// lisible par tout script servi depuis cette origine. Sur un appareil partagé, le code court
// suffit alors à ouvrir le site — c'est exactement le niveau de protection qu'il offrait avant
// le chiffrement. `oublierAppareil()` (bouton « oublier cet appareil ») annule l'appairage.
const CLE_APPAREIL = 'nw_appareil_v1';

export function appareilAppaire() {
  try { return !!localStorage.getItem(CLE_APPAREIL); } catch (e) { return false; }
}

export function oublierAppareil() {
  try { localStorage.removeItem(CLE_APPAREIL); } catch (e) { /* rien à faire */ }
}

/** Déverrouille en rejouant la phrase mémorisée sur cet appareil. */
export async function deverrouillerDepuisAppareil() {
  if (!(await blobDisponible())) return false;
  let p = null;
  try { p = localStorage.getItem(CLE_APPAREIL); } catch (e) { return false; }
  if (!p) return false;
  return deverrouiller(p);
}

/** Remplit un objet ou un tableau EXISTANT, sans casser la référence partagée par les imports. */
function remplirEnPlace(cible, source) {
  if (Array.isArray(cible) && Array.isArray(source)) {
    cible.length = 0;
    cible.push(...source);
    return;
  }
  if (cible && typeof cible === 'object' && source && typeof source === 'object') {
    for (const k of Object.keys(cible)) delete cible[k];
    Object.assign(cible, source);
  }
}

async function deriverCle(phrase, sel, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(phrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sel, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
}

const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Tente le déverrouillage avec la phrase donnée.
 * @returns {Promise<boolean>} true si les données sont en place, false si la phrase est fausse.
 */
export async function deverrouiller(phrase) {
  // Robustesse : un copier-coller depuis un gestionnaire de mots de passe traîne souvent un
  // espace ou un retour à la ligne. Sans ce nettoyage, la phrase correcte serait rejetée.
  phrase = String(phrase == null ? '' : phrase).trim();
  if (!(await blobDisponible()) || !DATA_ENC.data) {
    console.warn('[unlock] chiffrement non activé (js/data.enc.js absent) — données en clair');
    return false;
  }
  try {
    const cle = await deriverCle(phrase, deB64(DATA_ENC.sel), DATA_ENC.it || 250000);
    const clair = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deB64(DATA_ENC.iv) }, cle, deB64(DATA_ENC.data),
    );
    const blocs = JSON.parse(new TextDecoder().decode(clair));
    let n = 0;
    for (const [nom, valeur] of Object.entries(blocs)) {
      if (DATA[nom] === undefined) { console.warn('[unlock] bloc inconnu ignoré :', nom); continue; }
      remplirEnPlace(DATA[nom], valeur);
      n++;
    }
    // Confort de session : évite la re-saisie à chaque rechargement de l'onglet. Voir l'en-tête
    // du fichier pour ce que cela implique exactement.
    try { sessionStorage.setItem(CLE_SESSION, phrase); } catch (e) { /* mode privé : confort perdu, rien de plus */ }
    // Appairage : ce navigateur pourra désormais être ouvert avec le code court.
    try { localStorage.setItem(CLE_APPAREIL, phrase); } catch (e) { /* idem */ }
    console.log('[unlock] ✓ ' + n + ' blocs de données déverrouillés');
    return true;
  } catch (e) {
    return false;   // AES-GCM échoue à l'authentification → phrase fausse
  }
}

/** Rejoue le déverrouillage de la session en cours, si l'onglet en avait déjà réussi un. */
export async function deverrouillerDepuisSession() {
  if (!(await blobDisponible())) return false;
  let p = null;
  try { p = sessionStorage.getItem(CLE_SESSION); } catch (e) { return false; }
  if (!p) return false;
  return deverrouiller(p);
}

/** Efface le déverrouillage de la session (bouton « verrouiller »). */
export function verrouiller() {
  try { sessionStorage.removeItem(CLE_SESSION); } catch (e) { /* rien à faire */ }
}
