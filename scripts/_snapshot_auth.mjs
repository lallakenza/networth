// Résolution des en-têtes d'écriture Supabase pour le snapshot nocturne — fonction PURE (testée).
//
// Quatre cas, pour une transition SANS interruption du cron :
//   · v544, secret serveur VALIDE (`sb_secret_…`) → mode « secret » immédiat : la clé part
//     UNIQUEMENT dans `apikey`, jamais en `Authorization: Bearer` (ce n'est pas un JWT). C'est ce
//     qui permet d'installer le secret et de fermer la RLS AVANT le déploiement v545.
//   · v544, SANS secret valide → mode « legacy » TEMPORAIRE : clé publishable (publique par
//     design), en `apikey` + `Authorization: Bearer`, comme le cron l'a toujours fait. Ne marche
//     que tant que la policy INSERT anonyme existe, c'est-à-dire avant le SQL v545.
//   · v545+, SANS secret valide → échec FERMÉ (erreur NO_SERVER_KEY), aucune écriture.
//   · v545+, secret serveur VALIDE → mode « secret », `apikey` seul.
//
// Le projet a désactivé les anciennes clés JWT `anon`/`service_role` (`eyJ…`) : elles ne sont
// jamais acceptées comme secret serveur. La valeur du secret n'apparaît dans AUCUN message.

/** Numéro de version majeur comparable : 'v544' → 544, 'v545' → 545, absent → 0. */
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
 * NO_SERVER_KEY en v545+ sans secret serveur valide.
 * @param {{appVersion:string, secretKey?:string, publishableKey:string}} o
 */
export function resolveSnapshotWriteAuth({ appVersion, secretKey, publishableKey }) {
  const base = { 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  const cle = normaliserCle(secretKey);

  if (estCleServeur(cle)) {
    return { mode: 'secret', headers: { apikey: cle, ...base }, warning: null };
  }

  const presenteMaisInvalide = cle !== '';
  if (versionMajor(appVersion) >= 545) {
    const e = new Error(presenteMaisInvalide
      ? 'NW_SUPABASE_SECRET_KEY au mauvais format (attendu une clé serveur sb_secret_…, pas une clé JWT ni publishable)'
      : 'NW_SUPABASE_SECRET_KEY absent (clé serveur sb_secret_… requise à partir de v545)');
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
