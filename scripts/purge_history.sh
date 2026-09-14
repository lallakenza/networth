#!/usr/bin/env bash
# Purge de l'historique (item 5) — sauvegarde + réécriture sur un MIROIR jetable,
# STOP avant tout push. Ne touche PAS ton dépôt de travail. Ne pousse RIEN.
#
#   bash scripts/purge_history.sh              # prépare le miroir purgé (exige la bascule v545)
#   bash scripts/purge_history.sh --self-test  # teste la mécanique sur un miroir jetable, sans bascule
#
# Voir docs/PURGE_HISTORIQUE.md.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd)"
CALLBACK="$REPO/scripts/_purge_fileinfo.py"     # chemin ABSOLU (le miroir est ailleurs)
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$HOME/networth-backup-$STAMP.bundle"
WORK="$HOME/networth-purge-$STAMP.git"

# Fichiers sensibles déjà retirés du HEAD, à effacer de TOUT l'historique (suppressions
# intentionnelles). --invert-paths RETIRE ces chemins et CONSERVE tout le reste.
INTENTIONAL_DELETIONS=(
  dashboard.html
  portfolio_analysis.html portfolio_analysis_v2.html
  portfolio_analysis_v3.html portfolio_analysis_v4.html
  FINANCIAL_DATA_EXTRACTION.md AUDIT_REPORT.md AUDIT_SUMMARY.txt
  transaction_history.csv
)

# ── Résolution de git-filter-repo : exécutable sinon module python3 (item 5) ──
resolve_filter_repo() {
  if command -v git-filter-repo >/dev/null 2>&1; then
    FR=(git-filter-repo)
  elif python3 -c 'import git_filter_repo' 2>/dev/null; then
    FR=(python3 -m git_filter_repo)             # cas de ce poste : pip --user, pas sur le PATH
  else
    echo "✗ git-filter-repo introuvable (ni exécutable, ni module python3)."
    echo "  Installe : python3 -m pip install --user git-filter-repo"
    exit 1
  fi
  echo "· git-filter-repo : ${FR[*]}"
}

# ── Cœur de la purge : opère sur le CWD (un miroir bare). Deux passes. ──
run_purge_passes() {
  echo "· passe 1/2 — suppression des fichiers sensibles retirés du HEAD (--invert-paths)…"
  local paths=()
  for p in "${INTENTIONAL_DELETIONS[@]}"; do paths+=(--path "$p"); done
  "${FR[@]}" --force --invert-paths "${paths[@]}"

  echo "· passe 2/2 — réécriture consciente du chemin (--file-info-callback)…"
  echo "             js/data.js en clair → bannière ; numéros de compte → #redacted."
  "${FR[@]}" --force --file-info-callback "$CALLBACK"
}

# ── Compte, sans JAMAIS imprimer le contenu, les blobs contenant un numéro de compte ──
# Formes couvertes : '#' + 9 chiffres et +, et la forme littérale '#0?' + chiffres.
count_account_blobs() {
  git cat-file --batch-all-objects --batch --buffer 2>/dev/null | python3 -c '
import sys, re
pat = re.compile(rb"#(0\?)?[0-9]{9,}")
buf = sys.stdin.buffer
n = 0
while True:
    header = buf.readline()
    if not header:
        break
    parts = header.split()
    if len(parts) < 3:            # "<oid> missing" — ignorer
        continue
    size = int(parts[2])
    body = buf.read(size)
    buf.read(1)                   # newline de fin
    if parts[1] == b"blob" and pat.search(body):
        n += 1
print(n)
'
}

self_test() {
  resolve_filter_repo
  local T; T="$(mktemp -d)"
  local M="$T/mirror.git"
  echo "· clone miroir jetable → $M (aucun push, supprimé en fin de test)"
  git clone --quiet --mirror "$REPO" "$M"
  cd "$M"

  echo; echo "════════ AVANT ════════"
  local files_before nfiles_before acct_before
  files_before="$(git ls-tree -r --name-only HEAD | sort)"
  nfiles_before="$(printf '%s\n' "$files_before" | grep -c . || true)"
  git show-ref | sort > "$T/refs_before"
  local nrefs; nrefs="$(grep -c . "$T/refs_before" || true)"
  echo "  fichiers au HEAD : $nfiles_before"
  echo "  refs             : $nrefs"
  echo "  (comptage des blobs porteurs d'un numéro de compte — sans afficher aucune valeur)"
  acct_before="$(count_account_blobs)"
  echo "  blobs avec numéro de compte : $acct_before"

  run_purge_passes >/dev/null 2>"$T/purge.log" || { echo "✗ purge en échec :"; cat "$T/purge.log"; cd /; rm -rf "$T"; exit 1; }

  echo; echo "════════ APRÈS ════════"
  local files_after nfiles_after acct_after
  files_after="$(git ls-tree -r --name-only HEAD | sort)"
  nfiles_after="$(printf '%s\n' "$files_after" | grep -c . || true)"
  git show-ref | sort > "$T/refs_after"
  echo "  fichiers au HEAD : $nfiles_after"
  acct_after="$(count_account_blobs)"
  echo "  blobs avec numéro de compte : $acct_after"

  echo; echo "════════ PREUVES ════════"
  local ok=1

  # (1) Arborescence du HEAD conservée à l'identique (les suppressions intentionnelles
  #     ne concernent que l'historique : ces fichiers sont déjà absents du HEAD).
  if [ "$files_before" = "$files_after" ]; then
    echo "  ✓ arborescence HEAD identique ($nfiles_before fichiers, aucune perte hors suppressions intentionnelles)"
  else
    echo "  ✗ arborescence HEAD modifiée :"; diff <(printf '%s' "$files_before") <(printf '%s' "$files_after") | head; ok=0
  fi

  # (2) Les fichiers à supprimer sont bien PARTIS de tout l'historique.
  local still=0
  for p in "${INTENTIONAL_DELETIONS[@]}"; do
    if [ -n "$(git log --all --oneline -- "$p" 2>/dev/null | head -1)" ]; then
      echo "  ✗ subsiste dans l'historique : $p"; still=1; ok=0
    fi
  done
  [ "$still" = 0 ] && echo "  ✓ suppressions intentionnelles absentes de tout l'historique (${#INTENTIONAL_DELETIONS[@]} fichiers)"

  # (3) Numéros de compte : présents avant, zéro après.
  if [ "$acct_before" -gt 0 ] && [ "$acct_after" -eq 0 ]; then
    echo "  ✓ numéros de compte purgés : $acct_before → 0 blob"
  else
    echo "  ✗ numéros de compte : avant=$acct_before après=$acct_after (attendu >0 → 0)"; ok=0
  fi

  # (4) js/data.js : plus aucune version en clair (marqueur PORTFOLIO avec contenu).
  local clair_after
  clair_after="$(git cat-file --batch-all-objects --batch --buffer 2>/dev/null | python3 -c '
import sys, re
open_marker = re.compile(rb"export const PORTFOLIO = \{[^}]")   # accolade suivie d autre chose que "}"
buf = sys.stdin.buffer; n = 0
while True:
    h = buf.readline()
    if not h: break
    p = h.split()
    if len(p) < 3: continue
    size = int(p[2]); body = buf.read(size); buf.read(1)
    if p[1] == b"blob" and open_marker.search(body): n += 1
print(n)
')"
  # En self-test le HEAD est en clair (pas encore de bascule), donc lui aussi est banni
  # ⇒ 0 attendu. En exécution réelle le HEAD est la coquille `{};` : il est conservé
  # intact (il ne matche pas le marqueur « en clair »), les autres versions banies ⇒ 0 aussi.
  if [ "$clair_after" -eq 0 ]; then
    echo "  ✓ js/data.js : plus aucune version en clair dans l'historique (0 blob)"
  else
    echo "  ✗ js/data.js : $clair_after version(s) en clair subsistent"; ok=0
  fi

  # (5) Toutes les refs ont été réécrites (oid changé), sans imprimer de contenu.
  local total_before total_after rewritten
  total_before="$(grep -c . "$T/refs_before" || true)"
  total_after="$(grep -c . "$T/refs_after" || true)"
  rewritten="$(join -1 1 -2 1 \
                 <(awk '{print $2, $1}' "$T/refs_before" | sort) \
                 <(awk '{print $2, $1}' "$T/refs_after" | sort) \
               | awk '$2 != $3 {c++} END{print c+0}')"
  echo "  ✓ refs réécrites : $rewritten (oid modifié) — $total_before refs avant, $total_after après (valeurs non affichées)"

  echo; echo "· nettoyage du miroir jetable"
  cd /; rm -rf "$T"
  if [ "$ok" = 1 ]; then echo; echo "✅ SELF-TEST OK — mécanique de purge validée, rien poussé."; else echo; echo "❌ SELF-TEST : voir les ✗ ci-dessus."; exit 1; fi
}

# ─────────────────────────────── Point d'entrée ───────────────────────────────
if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi

resolve_filter_repo

if ! grep -q 'export const PORTFOLIO = {};' js/data.js; then
  echo "✗ js/data.js n'est pas une coquille : la bascule v545 n'a pas eu lieu."
  echo "  Purge prématurée — j'arrête. (Teste la mécanique dès maintenant avec --self-test.)"
  exit 1
fi

echo "· sauvegarde → $BACKUP"; git bundle create "$BACKUP" --all
echo "· miroir de travail → $WORK"; git clone --mirror "$REPO" "$WORK"; cd "$WORK"
run_purge_passes

cat <<MSG

✅ Historique réécrit dans le miroir : $WORK
   Sauvegarde : $BACKUP

   RIEN n'a été poussé. Pour publier (destructif, irréversible pour les clones) — À TON INITIATIVE :
     cd "$WORK"
     git remote add origin git@github.com:lallakenza/networth.git   # si absent
     git push --force --all && git push --force --tags
   Puis vérifie la prod (?v=545) et re-clone ta copie de travail.
MSG
