# Confidentialité sur Neon — chaîne complète et gestes du propriétaire

> **ÉTAT AU 7 NOVEMBRE 2026 (v591) : NON TERMINÉ.** `npm run verify` échoue désormais tant que la
> confidentialité échoue (`npm run verify:code` couvre le seul code). `npm run confidentiality:prod`
> relève 23 fuites : les 20 du dépôt public et 3 côté Neon, lues avec un simple jeton anonyme. Aucune
> étape ci-dessous ne doit être présentée comme faite avant d'être vérifiée en production.

## La chaîne visée

| Maillon | Exigence | État v591 |
|---|---|---|
| 1. Avant authentification | aucune donnée patrimoniale servie (dépôt, site, base) | ❌ `js/data.js` en clair ; snapshots et référentiel immo lisibles en anonyme |
| 2. Lectures patrimoniales | réservées au propriétaire | ❌ `anonymous` a SELECT sur toutes les tables |
| 3. Écritures | restreintes au cron, sur deux tables | ⚠ `anonymous` écrit encore `nw_snapshots` et `price_history` |
| 4. Cron | authentification serveur propre à Neon | ✅ code prêt (rôle `nw_ecrivain`, secret `NW_NEON_WRITER_URL`) ; ⏳ mot de passe et secret à poser |
| 5. Traitement autorisé | déchiffrement uniquement côté propriétaire et cron | ✅ code prêt (`NW_PASSPHRASE`) ; ⏳ phrase à saisir |
| 6. Échec fermé | données chiffrées sans écrivain : aucune écriture | ✅ testé (`tests/snapshot-auth.test.js`) |
| 7. Vérification honnête | `verify` rouge tant qu'une fuite subsiste | ✅ v591 |

## Ce qui est déjà en place (v591)

- **Rôle Neon `nw_ecrivain`**, créé en SQL (et non depuis la console, qui donnerait `neon_superuser`) :
  `NOLOGIN`, `NOBYPASSRLS`, aucun héritage. Droits : `INSERT` sur `nw_snapshots`, `SELECT/INSERT/UPDATE`
  sur `price_history`, avec leurs propres politiques RLS. Il ne lit ni les snapshots ni le référentiel
  immo. Sans mot de passe, personne ne peut s'y connecter.
- **Cron** (`scripts/_snapshot_auth.mjs`) : rôle écrivain dès que `NW_NEON_WRITER_URL` est valide ; jeton
  anonyme seulement tant que les données sont en clair ; échec fermé si elles sont chiffrées sans
  écrivain. La chaîne de connexion n'est jamais imprimée (erreurs masquées en `<url>`).
- **Workflow** : `NW_NEON_WRITER_URL` et `NW_PASSPHRASE` exposés au job s'ils existent (vides sinon) ; le
  pilote `@neondatabase/serverless@1.2.0` n'est installé que si le secret écrivain existe.
- **Contrôle** : `scripts/verify_no_leak.mjs --prod` interroge aussi Neon en anonyme.

## Gestes du propriétaire, dans l'ordre

Chaque étape laisse le site fonctionnel. Ne pas sauter d'étape : retirer une lecture avant que le code
sache lire autrement casserait l'historique (coquille vide).

### 1. Activer le rôle écrivain (5 min)

Dans la console Neon → SQL Editor (branche `production`), avec un mot de passe long tiré d'un
gestionnaire de mots de passe (jamais collé dans le dépôt, un ticket ou Notion) :

```sql
ALTER ROLE nw_ecrivain LOGIN PASSWORD '<mot de passe généré>';
```

Puis GitHub → `lallakenza/networth` → Settings → Secrets and variables → Actions → *New repository
secret* `NW_NEON_WRITER_URL` =
`postgresql://nw_ecrivain:<mot de passe>@ep-green-mountain-b91jna2h.c-7.eu-central-1.aws.neon.tech/neondb?sslmode=require`.

Contrôle : *Actions → Daily NW snapshot → Run workflow* ; le journal doit dire
`écriture en mode « ecrivain »`.

### 2. Retirer les écritures anonymes (après un cron vert en mode écrivain)

Le navigateur n'écrit plus de snapshots depuis la v582 ; il écrit encore le cache de cours. Retirer
d'abord le droit sur les snapshots, sans risque :

```sql
DROP POLICY nw_snap_insert ON nw_snapshots;
REVOKE INSERT ON nw_snapshots FROM anonymous;
```

Le cache de cours (`price_history`) ne contient que des cours publics ; le laisser inscriptible en
anonyme est acceptable tant que le navigateur l'alimente. Sinon : couper l'écriture navigateur dans
`js/api.js` (cache L2) puis révoquer `INSERT, UPDATE`.

### 3. Lectures réservées au propriétaire (développement requis, puis SQL)

Neon Auth est déjà provisionné (jetons anonymes). Il faut :

1. que le propriétaire crée **lui-même** son compte Neon Auth (e-mail + mot de passe ou OAuth) ;
2. développer la lecture authentifiée dans `js/api.js` (`loadSnapshots`, `loadImmoRef`) : jeton de
   session au lieu du jeton anonyme, et repli `data.js` si l'utilisateur n'est pas connecté ;
3. **seulement ensuite**, en SQL :
   ```sql
   GRANT SELECT ON nw_snapshots, immo_properties, immo_loans, immo_crd_obs TO authenticated;
   CREATE POLICY nw_snap_owner ON nw_snapshots FOR SELECT TO authenticated USING (auth.user_id() = '<id du compte>');
   -- idem pour les trois tables immo
   DROP POLICY nw_snap_read ON nw_snapshots;  REVOKE SELECT ON nw_snapshots FROM anonymous;
   -- idem pour immo_properties, immo_loans, immo_crd_obs
   ```

Les lignes brutes ne sont ni réécrites ni purgées : on change qui peut les lire, pas leur contenu.

### 4. Chiffrer `js/data.js`

Voir `docs/CHIFFREMENT_DONNEES.md`. La phrase est saisie par le propriétaire dans le prompt masqué
(`npm run encrypt`), puis posée en secret `NW_PASSPHRASE` pour le cron. Après l'étape 1 seulement :
une fois les données chiffrées, le cron refuse d'écrire sans rôle écrivain.

### 5. Champs hors bail dans le référentiel immo

La colonne `rent` de la ligne `vitry` de `immo_properties` contient des champs de revenus hors bail,
lisibles en anonyme. Ils ne servent à aucun calcul servi par le site. Leur suppression modifie une
donnée de la base : elle attend l'accord explicite du propriétaire (une requête `UPDATE … SET rent =
rent - '<champ>'` par champ, après export). L'étape 3 les rend de toute façon illisibles en anonyme.

### 6. Historique Git

Les anciennes versions de `js/data.js` restent lisibles dans l'historique public. Une purge (réécriture
de l'historique + force-push) ou un passage du dépôt en privé exige l'accord explicite du propriétaire :
voir `docs/PURGE_HISTORIQUE.md`.

## Vérifier

```bash
npm run verify                 # rouge tant qu'une fuite subsiste
npm run confidentiality:prod   # dépôt servi + base Neon en anonyme
```
