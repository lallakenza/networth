# Bascule v545 — activer le chiffrement, de bout en bout (item 6)

> Procédure ATOMIQUE : à la fin, aucune donnée patrimoniale n'est accessible sans authentification.
> La phrase n'apparaît JAMAIS dans l'historique du shell (`npm run encrypt -- --keychain` la demande
> en saisie masquée). Ne rien pousser tant que la vérification anonyme locale n'est pas verte.

Prérequis : être sur `main` à jour, arbre propre (`git status` vide).

## 1. Générer le blob + vider `js/data.js` + vérifier — un geste
```bash
cd ~/networth
npm run encrypt -- --keychain
```
Ce que ça fait (`scripts/enable_encryption.mjs`), en s'arrêtant à la 1re anomalie :
1. sauvegarde le `js/data.js` **courant** (v544) hors dépôt → `~/networth-data/data.source.js`
   (écrase toute copie périmée) ;
2. **demande la phrase en saisie masquée** (trousseau vide) puis l'enregistre au trousseau après
   vérification — ou la relit si déjà présente ; ne TOURNE aucune clé ;
3. génère `js/data.enc.js` et vérifie qu'il se déchiffre ;
4. vide les 13 blocs sensibles de `js/data.js` ;
5. contrôle qu'aucune donnée ne fuit (`verify_no_leak`).

## 2. Vérification locale (doit être VERTE avant de committer)
```bash
npm run confidentiality      # ✅ aucune fuite (13 coquilles, pas de motif privé, DOM sans montant)
npm test                     # ✅ tout passe (les données viennent de ~/networth-data/data.source.js)
npm run desync               # ✅
node scripts/verify_no_leak.mjs   # doublon explicite du contrôle de fuite
```
Si `npm run confidentiality` échoue : NE PAS committer.

## 3. Bump de version + tests
```bash
npm run bump                 # v544 → v545 (js/*.js ?v=, index.html, unlock.js blob, APP_VERSION, sw VERSION)
npm run verify               # lint + test + desync
```

## 4. Commit + push
```bash
git add js/data.js js/data.enc.js js/*.js index.html sw.js
git status --short           # NE DOIT PAS lister data.js.avant-chiffrement ni ~/networth-data
git commit -m "v545: activation du chiffrement des donnees patrimoniales"
git push origin main
```
> `js/data.js.avant-chiffrement` (copie de sécurité locale) et `~/networth-data` sont ignorés — ne
> jamais les committer.

## 5. Attente du déploiement (~1 min)
```bash
V=$(grep -oE "APP_VERSION = 'v[0-9]+'" js/data.js | grep -oE '[0-9]+')   # la version produite par npm run bump
until curl -s "https://lallakenza.github.io/networth/?cb=$RANDOM" | grep -q "app.js?v=$V"; do sleep 10; done
echo "déployé en v$V"
```

## 6. Vérification ANONYME en production (le cœur de la bascule)
```bash
node scripts/verify_no_leak.mjs --prod       # HTML + js/data.js servis : ✅ aucune fuite
# data.js servi = coquilles :
curl -s "https://lallakenza.github.io/networth/js/data.js?cb=$RANDOM" | grep -c "amine: {" # → 0
# Supabase encore lisible en anonyme ? (AVANT le §B RLS : oui — d'où l'étape SQL)
curl -s "https://mjbmtubkhlspwfqhqgvq.supabase.co/rest/v1/nw_snapshots?select=snap_date&limit=1" \
  -H "apikey: sb_publishable_V_Xa4lXSCnobfUT940sktA_EU7I2PQO"   # [] seulement APRÈS supabase_v545.sql §B
```
DOM + réseau en session anonyme : ouvrir la prod dans une fenêtre privée, DevTools → Elements
(aucun montant dans le DOM avant saisie) et Network (aucune réponse Supabase avec des lignes immo /
snapshots). La grille reste affichée, le tableau reste vide.

## 7. Vérification AUTHENTIFIÉE des chiffres
Saisir la phrase (ou le code court sur un appareil appairé) : le tableau se remplit. Contrôler que
le Net Worth couple et l'immobilier (valeur 651 066 / CRD 550 629 / équité 100 437 / 89 446)
correspondent à la v544. Le premier déverrouillage appaire l'appareil : le code à 4 chiffres suffit
ensuite.

## 8. Snapshot nocturne
Le cron écrit dans une table APPEND-ONLY : sans la phrase, `daily_snapshot.mjs` REFUSE d'écrire
(pas de faux zéro). Pour le rétablir :
1. **Appliquer d'abord la modif du workflow** (le jeton de l'agent n'a pas le scope `workflow`) :
   remplacer `.github/workflows/daily-snapshot.yml` par `scratchpad/daily-snapshot.yml.v545`
   (ajoute `permissions: contents: read` et `env: NW_PASSPHRASE: ${{ secrets.NW_PASSPHRASE }}`),
   puis `git add .github/workflows/daily-snapshot.yml && git commit && git push`.
2. Dépôt GitHub → Settings → Secrets and variables → Actions → New secret : `NW_PASSPHRASE` = la phrase.
   (Le workflow l'expose alors ; GitHub le masque dans les logs.)
2. Déclencher une fois à la main : Actions → « Daily NW snapshot » → Run workflow, et vérifier le log
   `[cron-snap] ✓ données déchiffrées (13 blocs)` puis l'insertion.
```bash
# test local du chemin de déchiffrement (sans toucher la prod), phrase en saisie non journalisée :
read -rs -p 'Phrase: ' NW_PASSPHRASE; export NW_PASSPHRASE; echo
node scripts/daily_snapshot.mjs --dry-run ; unset NW_PASSPHRASE
```

## 9. Ensuite, à ton initiative (gated)
- **Supabase** : exécuter `supabase_v545.sql` (§A nettoyage, puis §B RLS après avoir renseigné l'UID).
- **Historique Git** : `bash scripts/purge_history.sh` (sauvegarde + réécriture sur miroir), puis le
  force-push que le script imprime. Voir `docs/PURGE_HISTORIQUE.md`.

## Rollback
Avant push : `git checkout -- js/data.js && rm -f js/data.enc.js` (le clair est intact).
Après push : `git revert` du commit v545 (le clair reste dans `~/networth-data/data.source.js` et
dans l'historique jusqu'à la purge).
