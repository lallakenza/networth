// Résolution des en-têtes d'écriture Supabase pour le snapshot nocturne — fonction PURE (testée).
//
// Le régime dépend de l'ÉTAT DES DONNÉES, pas du numéro de version (v545, décision Amine du
// 19/09/2026) : les mises à jour de données doivent pouvoir monter de version librement avant la
// bascule, et l'échec fermé doit s'enclencher exactement quand les données deviennent chiffrées.
//
// Quatre cas, pour une transition SANS interruption du cron :
//   · données EN CLAIR, secret serveur VALIDE (`sb_secret_…`) → mode « secret » : la clé part
//     UNIQUEMENT dans `apikey`, jamais en `Authorization: Bearer` (ce n'est pas un JWT). C'est ce
//     qui permet d'installer le secret et de fermer la RLS AVANT la bascule.
//   · données EN CLAIR, SANS secret valide → mode « legacy » TEMPORAIRE : clé publishable (publique
//     par design), en `apikey` + `Authorization: Bearer`, comme le cron l'a toujours fait. Ne marche
//     que tant que la policy INSERT anonyme existe, c'est-à-dire avant le SQL v545.
//   · données CHIFFRÉES, SANS secret valide → échec FERMÉ (erreur NO_SERVER_KEY), aucune écriture.
//   · données CHIFFRÉES, secret serveur VALIDE → mode « secret », `apikey` seul.
//
// Le projet a désactivé les anciennes clés JWT `anon`/`service_role` (`eyJ…`) : elles ne sont
// jamais acceptées comme secret serveur. La valeur du secret n'apparaît dans AUCUN message.

/** Numéro de version majeur : 'v545' → 545, absent → 0 (journalisation uniquement). */
export function versionMajor(appVersion) {
  const m = /v?(\d+)/.exec(appVersion || '');
  return m ? parseInt(m[1], 10) : 0;
}

/** Valeur du secret sans espaces ni retour à la ligne de copier-coller ('' si absente). */
export function normaliserCle(key) {
  return typeof key === 'string' ? key.trim() : '';
}

/** true si la clé a le format d'une clé SERVEUR Supabase du nouveau schéma. */
export function estCleServeur(key) {
  return /^sb_secret_[A-Za-z0-9_-]+$/.test(normaliserCle(key));
}

/**
 * Retourne { mode, headers, warning } pour l'INSERT nw_snapshots, ou lève une erreur de code
 * NO_SERVER_KEY si les données sont chiffrées et qu'aucun secret serveur valide n'est fourni.
 * @param {{donneesChiffrees:boolean, secretKey?:string, publishableKey:string}} o
 */
export function resolveSnapshotWriteAuth({ donneesChiffrees, secretKey, publishableKey }) {
  if (typeof donneesChiffrees !== 'boolean') {
    // Refuser l'ambiguïté : un appelant qui oublierait l'état des données retomberait sinon en
    // mode legacy, c'est-à-dire en écriture anonyme après la bascule.
    const e = new Error('état des données inconnu (donneesChiffrees doit être true ou false)');
    e.code = 'NO_SERVER_KEY';
    throw e;
  }
  const base = { 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  const cle = normaliserCle(secretKey);

  if (estCleServeur(cle)) {
    return { mode: 'secret', headers: { apikey: cle, ...base }, warning: null };
  }

  const presenteMaisInvalide = cle !== '';
  if (donneesChiffrees) {
    const e = new Error(presenteMaisInvalide
      ? 'NW_SUPABASE_SECRET_KEY au mauvais format (attendu une clé serveur sb_secret_…, pas une clé JWT ni publishable)'
      : 'NW_SUPABASE_SECRET_KEY absent (clé serveur sb_secret_… requise dès que les données sont chiffrées)');
    e.code = 'NO_SERVER_KEY';
    throw e;
  }

  return {
    mode: 'legacy',
    headers: { apikey: publishableKey, Authorization: 'Bearer ' + publishableKey, ...base },
    warning: presenteMaisInvalide
      ? 'NW_SUPABASE_SECRET_KEY présent mais au mauvais format (attendu sb_secret_…) — repli temporaire sur la clé publishable'
      : null,
  };
}
