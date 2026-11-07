// Résolution de l'écriture du cron (snapshot nocturne, cache de cours) sur Neon — fonction PURE (testée).
//
// v591 — adaptée à Neon. La v545 visait Supabase (clé serveur `sb_secret_…`) : ce régime n'a pas de sens
// sur Neon, où l'acteur serveur est un RÔLE Postgres dédié (`nw_ecrivain`, droits d'écriture limités aux
// deux tables du cron), joint par une chaîne de connexion fournie en secret GitHub `NW_NEON_WRITER_URL`.
//
// Le régime dépend de l'ÉTAT DES DONNÉES, pas du numéro de version (décision du 19/09/2026) :
//   · rôle écrivain VALIDE                        → mode « ecrivain » (SQL direct, données claires ou chiffrées) ;
//   · données EN CLAIR, sans rôle valide          → mode « anonyme » TEMPORAIRE : jeton anonyme de la
//     Data API, tant que le rôle `anonymous` garde ses droits d'écriture (à retirer à la bascule) ;
//   · données CHIFFRÉES, sans rôle valide         → échec FERMÉ (erreur NO_SERVER_KEY), aucune écriture.
// La chaîne de connexion n'apparaît dans AUCUN message, même mal formée.

/** Numéro de version majeur : 'v545' → 545, absent → 0 (journalisation uniquement). */
export function versionMajor(appVersion) {
  const m = /v?(\d+)/.exec(appVersion || '');
  return m ? parseInt(m[1], 10) : 0;
}

/** Valeur du secret sans espaces ni retour à la ligne de copier-coller ('' si absente). */
export function normaliserCle(key) {
  return typeof key === 'string' ? key.trim() : '';
}

/** true si la valeur a la forme d'une chaîne de connexion Postgres Neon avec identifiant et mot de passe. */
export function estUrlEcrivain(url) {
  return /^postgres(ql)?:\/\/[^:@\s/]+:[^@\s]+@[a-z0-9.-]+\.neon\.tech(:\d+)?\/[A-Za-z0-9_-]+(\?\S*)?$/.test(normaliserCle(url));
}

/**
 * Retourne { mode: 'ecrivain', url } ou { mode: 'anonyme', headers, warning },
 * ou lève une erreur de code NO_SERVER_KEY si les données sont chiffrées sans rôle écrivain valide.
 * @param {{donneesChiffrees:boolean, writerUrl?:string, jetonAnonyme?:string}} o
 */
export function resolveSnapshotWriteAuth({ donneesChiffrees, writerUrl, jetonAnonyme }) {
  if (typeof donneesChiffrees !== 'boolean') {
    // Refuser l'ambiguïté : un appelant qui oublierait l'état des données retomberait sinon en
    // écriture anonyme après la bascule.
    const e = new Error('état des données inconnu (donneesChiffrees doit être true ou false)');
    e.code = 'NO_SERVER_KEY';
    throw e;
  }
  const url = normaliserCle(writerUrl);
  if (estUrlEcrivain(url)) return { mode: 'ecrivain', url, warning: null };

  const presenteMaisInvalide = url !== '';
  if (donneesChiffrees) {
    const e = new Error(presenteMaisInvalide
      ? 'NW_NEON_WRITER_URL au mauvais format (attendu postgresql://<rôle>:<mot de passe>@<hôte>.neon.tech/<base>)'
      : 'NW_NEON_WRITER_URL absent (rôle écrivain Neon requis dès que les données sont chiffrées)');
    e.code = 'NO_SERVER_KEY';
    throw e;
  }
  if (!jetonAnonyme) {
    const e = new Error('jeton anonyme absent : aucune écriture possible');
    e.code = 'NO_SERVER_KEY';
    throw e;
  }
  return {
    mode: 'anonyme',
    headers: { Authorization: 'Bearer ' + jetonAnonyme, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    warning: presenteMaisInvalide
      ? 'NW_NEON_WRITER_URL présent mais au mauvais format — repli temporaire sur le jeton anonyme (données en clair)'
      : null,
  };
}

/** Exécute une requête paramétrée avec le rôle écrivain (pilote HTTP officiel de Neon, chargé à la demande). */
export async function executerEcrivain(url, requete, parametres) {
  const { neon } = await import('@neondatabase/serverless');
  return neon(url).query(requete, parametres);
}
