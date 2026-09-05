# Chiffrer les données patrimoniales

> **ÉTAT AU 5 SEPTEMBRE 2026 : DÉSACTIVÉ, à la demande.** `js/data.js` contient de nouveau les
> données EN CLAIR, et le code à 4 chiffres est la seule serrure — il masque l'interface, il ne
> protège pas le fichier, qui est téléchargeable par qui connaît son adresse. La purge
> d'historique reste acquise pour le passé, mais chaque nouveau commit republie les données.
>
> Rien n'est supprimé : `js/unlock.js` (import du blob commenté), `js/auth.js`, `js/data.enc.js`
> et le secret rangé dans Supabase attendent. Pour rallumer, voir « Mise en service » ci-dessous —
> le blob publié aujourd'hui devra être régénéré, il est périmé dès la première mise à jour de
> données.


## Le problème

Le site est publié par GitHub Pages depuis un dépôt **public**. Tout fichier du dépôt est
téléchargeable par qui connaît son adresse — la grille de code de l'accueil ne masque que
l'interface, elle ne protège rien :

```bash
curl https://lallakenza.github.io/networth/js/data.js
# → HTTP 200, 261 Ko : soldes bancaires, créances nominatives, TVA,
#   identifiant fiscal du bien de Vitry, champs de loyer en espèces.
```

Le plus sensible n'est pas le montant des comptes : ce sont les champs
`loyerCashNonDeclare` / `loyerCashAvantBail`, publics, indexables, et associés dans le même
fichier à un identifiant fiscal et à une adresse.

## Ce que fait le chiffrement

Les 11 blocs personnels quittent le fichier publié. Ils sont chiffrés en **AES-256-GCM**, clé
dérivée de ta phrase secrète par **PBKDF2-SHA256 (250 000 itérations)**, et le navigateur les
remet en place après saisie de la phrase.

| Chiffré (81 % du fichier) | Reste en clair |
|---|---|
| `PORTFOLIO`, `IMMO_CONSTANTS`, `VITRY_CONSTRAINTS`, `VILLEJUIF_CONSTRAINTS`, `IMMO_PASSIFS_DOCUMENTES`, `NW_HISTORY`, `EQUITY_HISTORY`, `MONTHLY_INCOMES`, `BUDGET_EXPENSES`, `DEGIRO_STATIC_PRICES`, `PRICE_REFS_AS_OF` | Barèmes fiscaux publics, taux de change, tokens de design, calendrier de dividendes, presets immo |

Aucun autre fichier ne change : `engine.js`, `render.js` et `charts.js` continuent d'écrire
`import { PORTFOLIO } from './data.js'`. Ils reçoivent une **référence** d'objet, que le
déverrouillage remplit — le même mécanisme que la surcouche Supabase (`applyImmoRef`) et les prix
de référence (`applyPriceRefs`) utilisent déjà.

## Ne pas la perdre

C'est arrivé une fois, et la cause est le fonctionnement normal du script : la phrase est saisie
en masqué et n'est écrite **nulle part** — ni historique du shell, ni fichier, ni journal. Bon
pour un secret, irrécupérable si elle n'est notée nulle part ailleurs.

Depuis, le script sait la ranger dans le **trousseau macOS** :

```bash
node scripts/build_encrypted_data.mjs --keychain --verify
```

Il la demande une fois, chiffre, puis l'enregistre sous le service `networth-data-passphrase`.
Les fois suivantes, la même commande la relit toute seule sans rien demander ni afficher. Pour la
consulter : `security find-generic-password -s networth-data-passphrase -a networth -w`.

> Ce n'est pas une sauvegarde suffisante à elle seule : un trousseau se perd avec la machine.
> Mets-la aussi dans ton gestionnaire de mots de passe.

**Si elle est perdue malgré tout**, rien n'est détruit : `~/networth-data/data.source.js` contient
les données en clair. On régénère simplement un blob avec une nouvelle phrase. Le seul coût est
que chaque navigateur déjà appairé doit ressaisir la nouvelle phrase une fois.

## Choisir la phrase

C'est **la** décision qui détermine la solidité de l'ensemble : le blob est public, sa seule
protection est la phrase.

- **Minimum 12 caractères** (le script refuse en dessous).
- Vise 4-5 mots sans lien avec toi. Prénoms, dates de naissance, noms des biens et adresses du
  dossier sont les premiers essais d'un attaquant qui a lu le reste du dépôt.
- L'ancien code à 4 chiffres serait cassé en quelques minutes malgré les 250 000 itérations :
  10 000 combinaisons seulement.
- **Elle ne doit apparaître nulle part** : ni dans le dépôt, ni dans un commentaire, ni dans un
  message. Range-la dans ton gestionnaire de mots de passe.

## Mise en service

### 1. Mettre la source en clair à l'abri

```bash
mkdir -p ~/networth-data
cp ~/networth/js/data.js ~/networth-data/data.source.js
```

Ce fichier devient **le seul endroit** où tes données existent en clair, et il est **hors du
dépôt**. C'est désormais lui que tu édites pour mettre à jour un solde ou une créance.

> **Sauvegarde-le.** Sa perte est irréversible : un blob chiffré ne se retransforme pas en source
> lisible sans la phrase. iCloud, un disque chiffré, un gestionnaire de secrets — mais pas le dépôt.

### 2. Générer le blob chiffré

```bash
cd ~/networth
node scripts/build_encrypted_data.mjs --verify
```

La phrase est demandée en saisie masquée, jamais écrite ni journalisée. Le script produit
`js/data.enc.js` et vérifie qu'il se déchiffre.

### 3. Vider les blocs de `js/data.js`

```bash
node scripts/split_data_for_encryption.mjs --dry-run   # aperçu
node scripts/split_data_for_encryption.mjs             # applique
```

Une copie de sécurité `js/data.js.avant-chiffrement` est créée — à supprimer une fois le site
vérifié, et surtout **à ne pas commiter**.

### 4. Vérifier avant de publier

```bash
grep -c "mashreq: 5\|loyerCashNonDeclare" js/data.js   # doit afficher 0
node --check js/data.js && node --check js/data.enc.js
```

Puis charger le site en local, saisir la phrase, et contrôler que le net worth affiché est
identique à celui d'avant.

## À chaque mise à jour de données, ensuite

```bash
# 1. éditer ~/networth-data/data.source.js  (le clair, hors dépôt)
# 2. régénérer le blob
node scripts/build_encrypted_data.mjs
# 3. commiter js/data.enc.js — jamais la source
```

## Ce qui reste à traiter

**L'instantané nocturne.** `scripts/daily_snapshot.mjs` calcule le patrimoine à partir de
`data.js` en clair. Une fois le chiffrement actif, il ne pourra plus : il faudra lui passer la
phrase via un secret GitHub (`NW_PASSPHRASE`) et lui faire déchiffrer le blob, ou accepter
l'interruption de l'historique automatique. **À trancher avant la bascule** — l'historique
patrimonial est en écriture seule, un trou ne se rattrape pas.

**Le code d'accès de l'accueil.** Il reste indépendant du chiffrement : `checkAuth()` masque
l'interface, `deverrouiller()` déchiffre les données. Les brancher l'un sur l'autre (une seule
saisie qui fait les deux) est l'étape naturelle une fois la phrase choisie.

**Ce que le chiffrement ne résout pas.** L'historique git conserve les versions en clair déjà
publiées : quiconque a cloné le dépôt avant la bascule garde ces données. Réécrire l'historique
(`git filter-repo`) est possible mais casse tous les clones existants — à décider séparément.
