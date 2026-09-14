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

935 commits au total, `.git` ≈ 98 Mo.

## 1. Sauvegarde AVANT toute opération (indispensable, réversible)
```bash
cd ~/networth
git bundle create ~/networth-backup-$(date +%Y%m%d).bundle --all      # 1 fichier, tout l'historique
git clone --mirror . ~/networth-mirror-$(date +%Y%m%d).git            # miroir complet
```
Pour restaurer en cas de pépin : `git clone ~/networth-backup-<date>.bundle networth-restore`.

## 2. Outil
`git filter-repo` (recommandé, pas BFG). Déjà présent en pip (2.47.0). S'il n'est pas sur le PATH :
```bash
python3 -m pip install --user git-filter-repo    # ou : brew install git-filter-repo
```

## 3. Réécriture — sur un MIROIR, jamais sur ton dépôt de travail
`scripts/purge_history.sh` fait 1+3 pour toi puis S'ARRÊTE avant le push. En résumé, ce qu'il exécute :
```bash
WORK=~/networth-purge.git
git clone --mirror . "$WORK" && cd "$WORK"
# a) supprimer entièrement les fichiers sensibles retirés du HEAD
git filter-repo --force \
  --invert-paths \
  --path dashboard.html \
  --path portfolio_analysis.html --path portfolio_analysis_v2.html \
  --path portfolio_analysis_v3.html --path portfolio_analysis_v4.html \
  --path FINANCIAL_DATA_EXTRACTION.md --path AUDIT_REPORT.md --path AUDIT_SUMMARY.txt \
  --path transaction_history.csv
# b) remplacer TOUTE version en clair de js/data.js par une bannière (le HEAD post-v545 est déjà
#    une coquille : il est laissé tel quel par le callback), et masquer les n° de compte.
git filter-repo --force --path js/data.js --blob-callback '
  txt = blob.data.decode("utf-8", "replace")
  if "export const PORTFOLIO = {};" not in txt:      # tout sauf la coquille du HEAD
      blob.data = b"// Historique purge (v545) : donnees patrimoniales en clair retirees. Voir js/data.enc.js.\n"
'
git filter-repo --force --replace-text <(printf '%s\n' \
  'regex:#0?19010637138==>#redacted' 'regex:#0?19101959133==>#redacted' \
  'regex:#9925802269==>#redacted' 'regex:#6074504654==>#redacted')
```
> Le `--blob-callback` remplace chaque version NON-coquille de `js/data.js` par une bannière : la
> structure disparaît, pas seulement les valeurs. Le HEAD (coquille) est reconnu et laissé intact.

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
