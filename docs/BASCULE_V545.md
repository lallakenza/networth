# Bascule du chiffrement — runbook d'activation, dans l'ordre sûr

> Fichier nommé `BASCULE_V545` pour l'historique ; la bascule n'a PAS de numéro réservé. Depuis
> le 19/09/2026 (v545 = mise à jour des données), le cron ne dépend plus du numéro de version mais
> de l'**état des données** (en clair / chiffrées). La « version de bascule » est simplement celle
> que produit `npm run bump` à l'étape 7. Le kit garde ses noms de fichiers `…v545…`.

> À la fin, aucune donnée patrimoniale n'est lisible sans le compte Net Worth, le cron nocturne
> continue d'écrire, et l'historique Git est prêt à être purgé.
>
> **Tous les gestes ci-dessous sont les tiens** : relever l'UID, créer les secrets, pousser le
> workflow, exécuter le SQL, saisir la phrase, pousser la version de bascule, force-pusher la purge. L'agent n'en a
> exécuté aucun.
>
> Règles pendant tout le runbook :
> - un secret ne s'écrit **jamais** dans une commande : il se saisit en masqué (`read -rs`) et passe
>   par l'entrée standard, jamais par l'historique du shell ni par les arguments d'un processus ;
> - à la première anomalie, **arrêter** : chaque étape ne suppose que les précédentes réussies.

## Le kit (hors dépôt)

| Fichier | Rôle |
|---|---|
| `/Users/amine/networth-data/activation-kit/daily-snapshot.workflow.v545.patch` | expose `NW_PASSPHRASE` et `NW_SUPABASE_SECRET_KEY` au job nocturne |
| `/Users/amine/networth-data/activation-kit/supabase_v545.sql` | un seul bloc atomique : nettoyage §A + RLS §B + vérification des invariants |

## Les clés Supabase de ce projet

Le projet a **désactivé les anciennes clés JWT** `anon` / `service_role` (`eyJ…`). Il n'en existe
plus que deux sortes :

| Clé | Où | Comment elle est envoyée |
|---|---|---|
| `sb_publishable_…` | navigateur (`js/api.js`), publique par design | `apikey` ; l'identité vient du JWT de session en `Authorization: Bearer` |
| `sb_secret_…` | **uniquement** le secret GitHub Actions `NW_SUPABASE_SECRET_KEY` | **`apikey` seul** — ce n'est pas un JWT, jamais en `Authorization: Bearer` |

La clé serveur attendue est une **nouvelle clé `sb_secret_…`**, pas une ancienne clé `service_role`.
Le cron refuse toute autre forme. Elle n'est jamais dans `js/` ni dans un fichier suivi.

## Comportement du cron pendant la transition

`scripts/_snapshot_auth.mjs`, couvert par `tests/snapshot-auth.test.js` :

| Données | `NW_SUPABASE_SECRET_KEY` valide ? | Écriture |
|---|---|---|
| en clair | non | clé publishable, **temporairement** — ne marche que tant que la RLS n'est pas fermée |
| en clair | oui | clé serveur, `apikey` seul — log `écriture en mode « secret » (version vNNN, données en clair)` |
| chiffrées | non | **refus** — aucune écriture, sortie en erreur |
| chiffrées | oui | clé serveur, `apikey` seul |

Le numéro de version n'intervient pas : les mises à jour de données peuvent monter de version
librement avant la bascule. C'est ce qui rend l'ordre ci-dessous possible : le secret est installé et
vérifié pendant que les données sont en clair, la RLS se ferme, puis seulement le chiffrement est
activé.

---

## 0. Préalables

```bash
cd ~/networth
git switch main && git pull --ff-only && git status --short     # doit être vide
git bundle create ~/networth-backup-$(date +%Y%m%d-%H%M).bundle --all
gh auth status                                                   # compte ayant les droits admin du dépôt
```

## 1. Relever et vérifier l'UID exact du compte Net Worth

Dans le **SQL Editor** Supabase (lecture seule) :

```sql
-- (a) le compte par son adresse
select id, email, created_at, last_sign_in_at
  from auth.users
 where email = '<adresse du compte Net Worth>';

-- (b) l'UID déjà épinglé par la table de clé de données, que le site utilise aujourd'hui
select policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'nw_secrets';
```

Continuer **seulement si** (a) renvoie exactement une ligne et que son `id` est l'uuid qui figure
dans `qual` en (b). Ce n'est **jamais** un compte Lalla Kenza : la base est partagée et les
policies v545 n'autorisent que cet uuid. Garde-le sous la main, sans l'écrire dans le dépôt.

## 2. Créer les deux secrets GitHub Actions, sans les afficher

**2a. `NW_PASSPHRASE`** — la phrase des données (`nw_secrets.data_key`) :

```bash
read -rs NW_PH && printf '%s' "$NW_PH" | gh secret set NW_PASSPHRASE --repo lallakenza/networth; unset NW_PH
```

**2b. `NW_SUPABASE_SECRET_KEY`** — une nouvelle clé serveur dédiée au cron.
Supabase → *Project Settings* → *API Keys* → *Secret keys* → créer une clé nommée par exemple
`github-actions-daily-snapshot`, puis la copier. Dans le terminal :

```bash
read -rs NW_K
case "$NW_K" in sb_secret_*) echo "format sb_secret_ : OK" ;; *) echo "✗ pas une clé sb_secret_… — ARRÊT"; unset NW_K ;; esac
```

Si le format est OK, contrôler qu'elle est acceptée (lecture seule ; la clé passe par l'entrée
standard de `curl`, pas par ses arguments), puis l'enregistrer :

```bash
printf 'header = "apikey: %s"\n' "$NW_K" \
  | curl -s -o /dev/null -w '%{http_code}\n' -K - \
    "https://mjbmtubkhlspwfqhqgvq.supabase.co/rest/v1/nw_snapshots?select=snap_date&limit=1"   # attendu : 200
printf '%s' "$NW_K" | gh secret set NW_SUPABASE_SECRET_KEY --repo lallakenza/networth
unset NW_K
gh secret list --repo lallakenza/networth     # affiche les NOMS uniquement : NW_PASSPHRASE, NW_SUPABASE_SECRET_KEY
```

Autre voie équivalente : dépôt GitHub → *Settings* → *Secrets and variables* → *Actions*.

## 3. Appliquer, committer et pousser le patch du workflow

```bash
cd ~/networth
P=/Users/amine/networth-data/activation-kit/daily-snapshot.workflow.v545.patch
git apply --check "$P" && git apply "$P"
git diff --stat                                   # seul .github/workflows/daily-snapshot.yml
git add .github/workflows/daily-snapshot.yml
V=$(grep -oE "APP_VERSION = 'v[0-9]+'" js/data.js | grep -oE 'v[0-9]+')   # version courante
git commit -m "$V: le snapshot nocturne reçoit NW_PASSPHRASE et NW_SUPABASE_SECRET_KEY"
git push origin main
```

Si le push est refusé faute de scope `workflow` : `gh auth refresh -h github.com -s workflow`, puis
relancer `git push origin main`.

## 4. Déclencher le workflow (données en clair) et confirmer le mode serveur

```bash
gh workflow run daily-snapshot.yml --repo lallakenza/networth
sleep 10
RUN=$(gh run list --repo lallakenza/networth --workflow daily-snapshot.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --repo lallakenza/networth --exit-status
gh run view "$RUN" --repo lallakenza/networth --log | grep "cron-snap"
```

Attendu dans le log :
- `écriture en mode « secret » (version vNNN, données en clair)` ;
- `✅ snapshot … inséré`.

**Arrêt si** le log montre `mode « legacy »` ou `⚠ NW_SUPABASE_SECRET_KEY présent mais au mauvais
format` : le secret n'est pas exposé ou pas au bon format, et fermer la RLS maintenant casserait le
cron. Si le log dit `tout statique → pas d'insert`, les prix live étaient indisponibles : relancer
plus tard. Ce déclenchement ajoute une ligne normale à la table append-only.

## 5. Exécuter le SQL atomique avec l'UID vérifié

1. Ouvrir `/Users/amine/networth-data/activation-kit/supabase_v545.sql`.
2. Dans une **copie collée dans le SQL Editor** (pas dans le fichier du kit), remplacer
   `<UID_AUTORISÉ>` par l'uuid de l'étape 1. Il n'y a qu'une occurrence, dans `v_owner`.
3. Exécuter tout le contenu d'un coup.

Le bloc refuse de tourner si l'uuid n'est pas valide. Il active la RLS sur les quatre tables, retire
toutes leurs policies existantes, crée une policy SELECT par table pour cet uuid, une seule policy
INSERT propriétaire sur `nw_snapshots`, aucune UPDATE/DELETE, applique le nettoyage §A (insertion
`immo_crd_obs` idempotente) et vérifie les invariants avant de valider. **Si un invariant échoue,
rien n'est appliqué** — lire l'erreur, corriger, relancer.

La requête finale doit lister exactement cinq policies, toutes `{authenticated}` :
`immo_crd_obs_read_owner`, `immo_loans_read_owner`, `immo_properties_read_owner`,
`nw_snapshots_insert_owner`, `nw_snapshots_read_owner`.

## 6. Confirmer : illisible et non insérable en anonyme, lisible par le propriétaire

**6a. Par l'API, avec la clé publique** — attendu `[]` quatre fois :

```bash
for T in nw_snapshots immo_properties immo_loans immo_crd_obs; do
  printf '%-16s ' "$T"
  curl -s "https://mjbmtubkhlspwfqhqgvq.supabase.co/rest/v1/$T?select=*&limit=1" \
    -H "apikey: sb_publishable_V_Xa4lXSCnobfUT940sktA_EU7I2PQO"
  echo
done
```

**6b. Dans le SQL Editor** — contrôle complet des rôles, **sans aucun résidu** : chaque insertion
tentée vit dans une sous-transaction annulée, et tout échec annule le bloc entier. Remplacer
`<UID_VÉRIFIÉ>` par le même uuid qu'à l'étape 5, puis exécuter :

```sql
do $$
declare
  v_owner text := '<UID_VÉRIFIÉ>';
  v_autre text := gen_random_uuid()::text;          -- un compte authentifié quelconque
  t text;
  n bigint;
  ok boolean;
begin
  if v_owner !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Renseigne <UID_VÉRIFIÉ> avec l''uuid utilisé à l''étape 5';
  end if;

  foreach t in array array['nw_snapshots','immo_properties','immo_loans','immo_crd_obs'] loop
    -- anonyme : lecture
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '', true);
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when insufficient_privilege then n := 0;
    end;
    if n <> 0 then raise exception 'KO % : l''anonyme lit % ligne(s)', t, n; end if;

    -- anonyme : insertion refusée
    begin
      execute format('insert into public.%I default values', t);
      raise exception 'KO % : insertion anonyme ACCEPTÉE', t;
    exception
      when insufficient_privilege then null;         -- refus RLS (42501) : attendu
      when not_null_violation or check_violation or unique_violation then
        raise exception 'INCONCLUSIF % : contrainte % évaluée avant la RLS', t, sqlstate;
    end;

    -- un AUTRE compte authentifié : lecture nulle
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_autre, 'role', 'authenticated')::text, true);
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then raise exception 'KO % : un autre compte authentifié lit % ligne(s)', t, n; end if;

    -- le compte propriétaire : lecture
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    execute format('select count(*) from public.%I', t) into n;
    if n = 0 then raise exception 'KO % : le compte propriétaire ne lit aucune ligne', t; end if;
    raise notice '% : anonyme 0, autre compte 0, propriétaire % ligne(s)', t, n;
  end loop;

  -- nw_snapshots : un autre compte ne peut pas insérer
  perform set_config('request.jwt.claims', json_build_object('sub', v_autre, 'role', 'authenticated')::text, true);
  begin
    execute 'insert into public.nw_snapshots (snap_date, quality, data) values (current_date, ''static'', ''{"verification":true}'')';
    raise exception 'KO nw_snapshots : insertion par un autre compte ACCEPTÉE';
  exception when insufficient_privilege then null;
  end;

  -- nw_snapshots : le propriétaire peut insérer (insertion aussitôt annulée)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  ok := false;
  begin
    execute 'insert into public.nw_snapshots (snap_date, quality, data) values (current_date, ''static'', ''{"verification":true}'')';
    raise exception using errcode = 'P0099', message = 'annulation volontaire du test';
  exception
    when sqlstate 'P0099' then ok := true;
    when insufficient_privilege then raise exception 'KO nw_snapshots : le propriétaire ne peut pas insérer';
  end;
  if not ok then raise exception 'KO nw_snapshots : test d''insertion propriétaire non concluant'; end if;

  perform set_config('role', 'none', true);
end $$;

select 'VÉRIFICATION RLS OK' as resultat;
```

La ligne `VÉRIFICATION RLS OK` n'apparaît que si tous les contrôles passent.

**6c. Le cron survit à la RLS fermée** — relancer l'étape 4 : toujours `mode « secret » (…,
données en clair)` et `✅ snapshot … inséré`.

> Entre cette étape et la bascule, le site (données en clair) visité **sans session** ne reçoit plus les
> snapshots ni le référentiel immo : l'immobilier retombe sur le cache local ou `data.js` (tenu en
> phase avec §A) et la vue Historique reste vide. C'est attendu et ne dure que jusqu'à l'étape 7.

## 7. Générer le blob, vider `data.js`, monter de version, tester, déployer

```bash
cd ~/networth
npm run encrypt -- --keychain
```

`scripts/enable_encryption.mjs` s'arrête à la première anomalie. Il sauvegarde le `js/data.js`
courant hors dépôt (`~/networth-data/data.source.js`), demande la phrase en saisie masquée si le
trousseau est vide puis l'enregistre après vérification, génère `js/data.enc.js` et vérifie qu'il se
déchiffre, vide les 13 blocs sensibles de `js/data.js`, et contrôle l'absence de fuite.

```bash
npm run confidentiality      # doit être vert : 13 coquilles, aucun motif privé, DOM sans montant
npm run bump                 # vN → vN+1 (= version de bascule) : ?v= de js/*.js, index.html, import du blob, APP_VERSION, sw
npm run verify               # lint + tests + desync
git add js/data.js js/data.enc.js js/*.js index.html sw.js
git status --short           # ne doit lister ni data.js.avant-chiffrement ni ~/networth-data
V=$(grep -oE "APP_VERSION = 'v[0-9]+'" js/data.js | grep -oE 'v[0-9]+')   # la version produite par npm run bump
git commit -m "$V: activation du chiffrement des données patrimoniales"
git push origin main
```

Si `npm run confidentiality` ou `npm run verify` échoue : **ne pas committer**.

Attendre le déploiement GitHub Pages :

```bash
until curl -s "https://lallakenza.github.io/networth/?cb=$RANDOM" | grep -q "app.js?v=${V#v}"; do sleep 10; done; echo "$V déployée"
```

## 8. Vérifier la production

**Anonyme** :

```bash
npm run confidentiality:prod                                                            # HTML + data.js servis : aucune fuite
curl -s "https://lallakenza.github.io/networth/js/data.js?cb=$RANDOM" | grep -c "amine: {"   # 0
```

Relancer la boucle de l'étape 6a : toujours `[]`. Dans une fenêtre privée, DevTools : *Elements*
sans aucun montant avant déverrouillage, *Network* sans réponse Supabase contenant des lignes.

**Authentifiée** : se connecter avec le compte de l'étape 1 et saisir la phrase. Le tableau se
remplit ; contrôler le Net Worth couple et l'immobilier (valeur 651 066, CRD 550 629, équité
100 437 / 89 446) contre la version précédente. La vue Historique affiche de nouveau les snapshots.

**Cron après bascule** : relancer l'étape 4. Attendu : `✓ données déchiffrées (13 blocs)`, `écriture en
mode « secret » (version vNNN, données chiffrées)`, `✅ snapshot … inséré`.

## 9. Préparer la purge — le force-push reste le tien

```bash
cd ~/networth
bash scripts/purge_history.sh --self-test    # miroir jetable, rien poussé : arborescence conservée, n° de compte → 0
bash scripts/purge_history.sh                # exige js/data.js en coquille ; sauvegarde + miroir purgé ; s'arrête
```

Le second script imprime les commandes de publication (`git push --force --all` depuis le miroir).
Tu les exécutes toi-même, après avoir lu les conséquences dans `docs/PURGE_HISTORIQUE.md` : tous les
clones doivent être refaits, et ce qui a déjà été cloné reste exposé.

---

## Rollback

| Moment | Retour arrière |
|---|---|
| Étapes 2-4 | supprimer les secrets (`gh secret delete …`) et `git revert` du commit workflow ; le cron revient au chemin publishable |
| Étape 5 échouée | rien à défaire : le bloc est atomique |
| Après l'étape 5 | ne **pas** rouvrir de policy anonyme. Le site (données en clair) retombe sur `data.js` ; corriger en avant |
| Étape 7 avant push | `git checkout -- js/data.js && rm -f js/data.enc.js` (le clair est intact) |
| Après push de la bascule | `git revert` du commit de bascule ; le clair reste dans `~/networth-data/data.source.js` et dans l'historique jusqu'à la purge |
| Étape 9 | le miroir purgé n'affecte rien tant qu'il n'est pas poussé ; restauration : `git clone ~/networth-backup-<date>.bundle` |
