/**
 * auth.js — connexion par e-mail (code à usage unique) et récupération de la clé de données.
 *
 * POURQUOI. La clé du blob chiffré était une phrase que l'utilisateur devait retenir. Elle a été
 * perdue une fois, et le script qui la demande est conçu pour ne l'écrire nulle part : elle était
 * donc irrécupérable. Elle est remplacée par un secret ALÉATOIRE que personne ne tape ni ne
 * mémorise, servi par Supabase après authentification, et lisible par un seul compte.
 *
 * CE QUE ÇA PROTÈGE, ET CE QUE ÇA NE PROTÈGE PAS. Le blob reste publiquement téléchargeable —
 * c'est la limite de GitHub Pages. Mais sa clé fait 32 octets aléatoires au lieu de 10 000
 * combinaisons : l'attaque par force brute qui cassait un code à 4 chiffres en six minutes n'a
 * plus d'objet. La page elle-même reste publique et s'affiche vide sans connexion.
 *
 * ATTENTION — BASE PARTAGÉE. Ce projet Supabase est aussi celui de Lalla Kenza, avec ses comptes
 * clients. La politique de lecture du secret est donc épinglée sur UN identifiant précis, et non
 * sur « être authentifié » : sans cela, n'importe quel client du SaaS pourrait lire la clé.
 *
 * Pas de dépendance : les trois appels REST de Supabase suffisent, ce qui évite d'ajouter
 * supabase-js à une application sans étape de build.
 */

const SUPABASE_URL = 'https://mjbmtubkhlspwfqhqgvq.supabase.co';
const SUPABASE_ANON = 'sb_publishable_V_Xa4lXSCnobfUT940sktA_EU7I2PQO';
const CLE_SESSION = 'nw_session_v1';

/** Session conservée entre visites. Le jeton expire ; le rafraîchissement est transparent. */
function lireSession() {
  try { return JSON.parse(localStorage.getItem(CLE_SESSION) || 'null'); } catch (e) { return null; }
}
function ecrireSession(s) {
  try { localStorage.setItem(CLE_SESSION, JSON.stringify(s)); } catch (e) { /* mode privé */ }
}
export function deconnecter() {
  try { localStorage.removeItem(CLE_SESSION); } catch (e) { /* rien à faire */ }
}

export function estConnecte() {
  const s = lireSession();
  return !!(s && s.refresh_token);
}

export function emailConnecte() {
  const s = lireSession();
  return (s && s.email) || null;
}

async function appel(chemin, options) {
  const r = await fetch(SUPABASE_URL + chemin, {
    ...options,
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const texte = await r.text();
  let corps = null;
  try { corps = texte ? JSON.parse(texte) : null; } catch (e) { corps = { message: texte }; }
  if (!r.ok) {
    const err = new Error((corps && (corps.error_description || corps.msg || corps.message)) || ('HTTP ' + r.status));
    err.statut = r.status;
    throw err;
  }
  return corps;
}

/** Envoie un code à usage unique sur l'adresse donnée. */
export async function envoyerCode(email) {
  // `should_create_user: false` — la base est partagée avec un SaaS ouvert aux inscriptions.
  // Sans ce garde-fou, une faute de frappe créerait un compte au lieu d'échouer, et l'utilisateur
  // attendrait un code pour une adresse qui n'a de toute façon aucun droit de lecture.
  await appel('/auth/v1/otp', {
    method: 'POST',
    body: JSON.stringify({ email: String(email || '').trim(), should_create_user: false }),
  });
  return true;
}

/**
 * Extrait le jeton d'un lien de connexion collé par l'utilisateur.
 *
 * POURQUOI UN LIEN ET NON UN CODE. Le modèle d'e-mail de ce projet Supabase est celui de
 * Lalla Kenza : il contient un lien et n'affiche aucun code, parce que son gabarit n'inclut pas
 * `{{ .Token }}`. Le modifier changerait les e-mails envoyés aux clients du SaaS. Le jeton étant
 * présent DANS le lien, on le lit là — aucun réglage partagé n'est touché, et la liste des URL de
 * redirection n'a pas besoin d'accueillir ce site.
 */
function jetonDepuisLien(texte) {
  const brut = String(texte || '').trim();
  if (!brut) return null;
  // L'utilisateur peut coller le lien entier, ou seulement le jeton.
  const url = (brut.match(/https?:\/\/\S+/) || [])[0];
  if (!url) return brut.length > 20 ? brut : null;
  try {
    const u = new URL(url);
    return u.searchParams.get('token_hash') || u.searchParams.get('token')
      || new URLSearchParams(u.hash.replace(/^#/, '')).get('token_hash') || null;
  } catch (e) { return null; }
}

/** Vérifie le lien (ou le code) reçu par e-mail et ouvre la session. */
export async function verifierCode(email, saisie) {
  const jeton = jetonDepuisLien(saisie);
  if (!jeton) throw new Error('lien ou code illisible');
  let s;
  try {
    // Cas normal : jeton extrait du lien.
    s = await appel('/auth/v1/verify', {
      method: 'POST',
      body: JSON.stringify({ token_hash: jeton, type: 'magiclink' }),
    });
  } catch (e1) {
    // Repli : certains gabarits envoient un code court, vérifiable avec l'adresse.
    s = await appel('/auth/v1/verify', {
      method: 'POST',
      body: JSON.stringify({ email: String(email || '').trim(), token: jeton, type: 'email' }),
    });
  }
  ecrireSession({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expire_a: Date.now() + (s.expires_in || 3600) * 1000,
    email: (s.user && s.user.email) || email,
  });
  return true;
}

/** Renvoie un jeton d'accès valide, en le rafraîchissant si nécessaire. */
async function jetonValide() {
  const s = lireSession();
  if (!s || !s.refresh_token) return null;
  // Marge d'une minute : un jeton qui expire pendant la requête produirait un 401 déroutant.
  if (s.access_token && s.expire_a && Date.now() < s.expire_a - 60000) return s.access_token;
  try {
    const n = await appel('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    ecrireSession({
      access_token: n.access_token,
      refresh_token: n.refresh_token,
      expire_a: Date.now() + (n.expires_in || 3600) * 1000,
      email: (n.user && n.user.email) || s.email,
    });
    return n.access_token;
  } catch (e) {
    // Jeton de rafraîchissement révoqué ou expiré : on efface plutôt que de boucler sur des 401.
    deconnecter();
    return null;
  }
}

/**
 * Récupère la clé de déchiffrement des données.
 * @returns {Promise<string|null>} la clé, ou null si non connecté / non autorisé.
 */
export async function cleDeDonnees() {
  const jeton = await jetonValide();
  if (!jeton) return null;
  try {
    const lignes = await appel('/rest/v1/nw_secrets?id=eq.data_key&select=value', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + jeton },
    });
    if (Array.isArray(lignes) && lignes.length && lignes[0].value) return lignes[0].value;
    // Zéro ligne = authentifié mais pas autorisé par la politique (compte tiers du SaaS
    // partagé, ou identifiant non inscrit dans la règle). Ce n'est pas une erreur réseau.
    console.warn('[auth] connecté, mais ce compte n’a pas accès à la clé de données');
    return null;
  } catch (e) {
    console.warn('[auth] lecture de la clé impossible :', e.message);
    return null;
  }
}
