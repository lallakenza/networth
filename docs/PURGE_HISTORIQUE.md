# Purge de l'historique Git — données en clair déjà publiées (plan, item 5)

> **À faire APRÈS la bascule v545** (quand `js/data.js` du HEAD est déjà une coquille). Purger
> avant n'a pas de sens : le HEAD porterait encore le clair. **Rien n'est force-pushé sans ton
> accord explicite.** `scripts/purge_history.sh` s'arrête AVANT le push et t'imprime la commande.

## Ce que le chiffrement NE résout pas
Le blob protège le HEAD et l'avenir. Mais **quiconque a cloné le dépôt avant la bascule garde les
versions en clair** — et elles restent dans l'historique publié tant qu'il n'est pas réécrit.
Une réécriture d'historique a déjà eu lieu (1re tâche de la session) : c'est pourquoi `js/data.js`
ne remonte qu'au 30/08/2026. Ce plan couvre le RÉSIDUEL depuis.

## Inventaire exact (mesuré le 14/09/2026)
| Chemin | Commits en clair | État au HEAD |
|---|---|---|
| `js/data.js` | **48** (30/08 → 14/09) | coquille après v545 — à réécrire pour l'historique |
| `dashboard.html` | 4 | supprimé en v543 |
| `portfolio_analysis.html` + `_v2/_v3/_v4` | 2 chacun (8) | supprimés en v543 |
| `FINANCIAL_DATA_EXTRACTION.md` | 2 | supprimé en v543 |
| `AUDIT_REPORT.md`, `AUDIT_SUMMARY.txt` | 2 chacun | supprimés en v543 |
| `transaction_history.csv` | 2 | supprimé en v543 |
| `data/*_balance_*.json` | 6 | n° de compte masqués en v543 |

1 385 commits au total (mesuré le 14/09/2026), 4 139 blobs.

## 1. Sauvegarde AVANT toute opération (indispensable, réversible)
```bash
cd ~/networth
git bundle create ~/networth-backup-$(date +%Y%m%d).bundle --all      # 1 fichier, tout l'historique
git clone --mirror . ~/networth-mirror-$(date +%Y%m%d).git            # miroir complet
```
Pour restaurer en cas de pépin : `git clone ~/networth-backup-<date>.bundle networth-restore`.

## 2. Outil
`git filter-repo` (recommandé, pas BFG). Déjà présent en pip (2.47.0) mais **pas sur le PATH** de ce
poste : le script le détecte et bascule automatiquement sur `python3 -m git_filter_repo`. Sinon :
```bash
python3 -m pip install --user git-filter-repo    # ou : brew install git-filter-repo
```

## 3. Réécriture — sur un MIROIR, jamais sur ton dépôt de travail
`scripts/purge_history.sh` sauvegarde, clone un miroir, réécrit, puis **S'ARRÊTE avant le push**.
Il fait **deux passes** (le détail vit dans le script + `scripts/_purge_fileinfo.py`) :

- **Passe 1 — `--invert-paths`** : *retire* les fichiers sensibles listés et **conserve tout le
  reste**. ⚠️ On n'utilise **jamais** `--path <fichier>` seul pour cibler `js/data.js` : `--path`
  est un filtre de *conservation*, il aurait réduit l'historique au seul `js/data.js` en supprimant
  tous les autres fichiers.
- **Passe 2 — `--file-info-callback` (conscient du chemin)** : ne réécrit que le CONTENU.
  `js/data.js` en clair → bannière (la coquille `{};` du HEAD est reconnue et laissée intacte) ;
  partout ailleurs, rédaction des numéros de compte sous leurs **deux formes** présentes dans
  l'historique (`#`+chiffres, et la forme littérale `#0?`+chiffres qui avait fuité dans l'outillage).
  Aucun numéro réel n'est écrit dans le script.

**Teste la mécanique dès maintenant** (avant même la bascule), sur un miroir jetable, sans rien
pousser — prouve que l'arborescence et le nombre de fichiers sont conservés (hors suppressions
intentionnelles), que les numéros de compte tombent à zéro et que toutes les refs sont réécrites :
```bash
bash scripts/purge_history.sh --self-test
```
Puis, une fois la bascule v545 faite (HEAD = coquille), lance la vraie préparation :
```bash
bash scripts/purge_history.sh          # exige que js/data.js soit une coquille ; s'arrête avant le push
```

## 4. Publication (À TON INITIATIVE — le script ne le fait pas)
```bash
cd ~/networth-purge.git
git remote add origin git@github.com:lallakenza/networth.git   # si absent
git push --force --all && git push --force --tags
```

## 5. Conséquences (à assumer AVANT le force-push)
- **Tous les clones et forks existants deviennent incompatibles** : les SHA changent. Toute copie
  doit être re-clonée ; un `git pull` échouera. Sur ta machine : re-clone après le push.
- **PR / branches ouvertes** : à recréer sur le nouvel historique.
- **GitHub Pages** : republie automatiquement depuis l'historique réécrit ; l'URL ne change pas,
  mais un déploiement se relance (~1 min). Vérifier ensuite `?v=545` en prod.
- **Objets orphelins côté GitHub** : les anciens objets restent accessibles par SHA un certain temps
  (cache, vues « commit ») ; pour forcer leur purge, ouvrir un ticket au support GitHub.
- **Irréductible** : qui a déjà cloné garde les données. La réécriture réduit l'exposition FUTURE,
  elle n'efface pas le passé déjà distribué.
