// Résolution des en-têtes d'écriture Supabase pour le snapshot nocturne — fonction PURE (testable).
//
// Deux régimes, gouvernés par APP_VERSION (item 3 : ne pas casser le cron v544 déjà en prod) :
//   · AVANT v545  → comportement EXISTANT : clé publishable (publique par design), en `apikey`
//     ET en `Authorization: Bearer` comme le faisait le cron. Aucun secret requis : v544 continue
//     de tourner jusqu'à la bascule.
//   · À PARTIR de v545 → échec FERMÉ : exige un secret serveur au nouveau format `sb_secret_…`
//     (le projet a migré des clés `anon`/`service_role` vers `sb_publishable_…`/`sb_secret_…`).
//     La clé `sb_secret_…` N'EST PAS un JWT : on la met UNIQUEMENT dans l'en-tête `apikey`,
//     jamais en `Authorization: Bearer`. Absente ou au mauvais format → on refuse d'écrire.
//
// Le secret n'apparaît jamais en clair ici : il vient de l'environnement (GitHub Actions).

/** Numéro de version majeur comparable : 'v544' → 544, 'v545' → 545, absent → 0. */
export function versionMajor(appVersion) {
  const m = /v?(\d+)/.exec(appVersion || '');
  return m ? parseInt(m[1], 10) : 0;
}

/** true si la clé a le format d'une clé SERVEUR Supabase (nouveau schéma). */
export function estCleServeur(key) {
  return typeof key === 'string' && /^sb_secret_[A-Za-z0-9_-]+$/.test(key);
}

/**
 * Retourne { mode, headers } pour l'INSERT nw_snapshots, ou lève une erreur (code NO_SERVER_KEY)
 * si v545+ et que le secret serveur manque / a un mauvais format.
 * @param {{appVersion:string, secretKey?:string, publishableKey:string}} o
 */
export function resolveSnapshotWriteAuth({ appVersion, secretKey, publishableKey }) {
  const base = { 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  if (versionMajor(appVersion) >= 545) {
    if (!estCleServeur(secretKey)) {
      const e = new Error('secret serveur Supabase manquant ou format invalide (attendu sb_secret_…)');
      e.code = 'NO_SERVER_KEY';
      throw e;
    }
    // Clé sb_secret_… : apikey UNIQUEMENT, pas de Bearer (ce n'est pas un JWT).
    return { mode: 'secret', headers: { apikey: secretKey, ...base } };
  }
  // v544 et avant : comportement existant, clé publishable (publique par design).
  return { mode: 'legacy', headers: { apikey: publishableKey, Authorization: 'Bearer ' + publishableKey, ...base } };
}
