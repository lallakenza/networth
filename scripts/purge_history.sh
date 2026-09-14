#!/usr/bin/env bash
# Purge de l'historique (item 5) — sauvegarde + réécriture sur un MIROIR, STOP avant le force-push.
# Ne touche PAS ton dépôt de travail. Ne pousse RIEN. Voir docs/PURGE_HISTORIQUE.md.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"; STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$HOME/networth-backup-$STAMP.bundle"
WORK="$HOME/networth-purge-$STAMP.git"

if ! grep -q 'export const PORTFOLIO = {};' js/data.js; then
  echo "✗ js/data.js n'est pas une coquille : la bascule v545 n'a pas eu lieu. Purge prématurée — j'arrête."
  exit 1
fi
command -v git-filter-repo >/dev/null 2>&1 || python3 -c 'import git_filter_repo' 2>/dev/null || {
  echo "✗ git-filter-repo introuvable. Installe : python3 -m pip install --user git-filter-repo"; exit 1; }

echo "· sauvegarde → $BACKUP"; git bundle create "$BACKUP" --all
echo "· miroir de travail → $WORK"; git clone --mirror "$REPO" "$WORK"; cd "$WORK"

echo "· (a) suppression des fichiers sensibles retirés du HEAD…"
git filter-repo --force --invert-paths \
  --path dashboard.html \
  --path portfolio_analysis.html --path portfolio_analysis_v2.html \
  --path portfolio_analysis_v3.html --path portfolio_analysis_v4.html \
  --path FINANCIAL_DATA_EXTRACTION.md --path AUDIT_REPORT.md --path AUDIT_SUMMARY.txt \
  --path transaction_history.csv

echo "· (b) redaction de l'historique en clair de js/data.js…"
git filter-repo --force --path js/data.js --blob-callback '
txt = blob.data.decode("utf-8", "replace")
if "export const PORTFOLIO = {};" not in txt:
    blob.data = b"// Historique purge (v545) : donnees patrimoniales en clair retirees. Voir js/data.enc.js.\n"
'
echo "· (c) masquage de tout numero de compte (# suivi de 9+ chiffres) dans l'historique…"
# Motif generique : on n'ecrit AUCUN numero reel dans ce fichier suivi (sinon on re-fuit
# ce que la purge doit retirer). filter-repo balaie tout l'historique et redige chaque
# occurrence, y compris les variantes avec zero de tete.
TMPR="$(mktemp)"; printf '%s\n' \
  'regex:#[0-9]{9,}==>#redacted' > "$TMPR"
git filter-repo --force --replace-text "$TMPR"; rm -f "$TMPR"

cat <<MSG

✅ Historique réécrit dans le miroir : $WORK
   Sauvegarde : $BACKUP

   RIEN n'a été poussé. Pour publier (destructif, irréversible pour les clones) :
     cd "$WORK"
     git remote add origin git@github.com:lallakenza/networth.git   # si absent
     git push --force --all && git push --force --tags
   Puis vérifie la prod (?v=545) et re-clone ta copie de travail.
MSG
