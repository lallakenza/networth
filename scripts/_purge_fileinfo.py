# git-filter-repo --file-info-callback body (purge historique v545, item 5).
#
# CONSCIENT DU CHEMIN, contrairement à l'ancien `--path js/data.js` qui — étant un
# filtre de conservation — aurait réduit TOUT l'historique au seul js/data.js et
# supprimé tous les autres fichiers. Ici on ne supprime aucun chemin : on réécrit
# uniquement le CONTENU de certaines versions.
#
# Deux traitements, aucun numéro réel n'est écrit dans ce fichier suivi :
#   1. js/data.js : toute version en clair (structure comprise) est remplacée par une
#      bannière ; seule la coquille post-bascule (`export const PORTFOLIO = {};`) est
#      conservée intacte. Détection par CONTENU (pas par blob_id, dont le type varie).
#   2. tout autre fichier : rédaction générique des numéros de compte, sous les deux
#      formes présentes dans l'historique — `#` + 9 chiffres et +, et la forme littérale
#      `#0?` + chiffres qui avait fuité dans l'outillage lui-même (commit ebfa605).
#
# Signature imposée par filter-repo : file_info_callback(filename, mode, blob_id, value)
# Doit renvoyer un tuple (filename, mode, blob_id).
import re
d = value.data
if 'purge_init' not in d:
    d['purge_init'] = True
    d['redactions'] = [re.compile(rb'#[0-9]{9,}'), re.compile(rb'#0\?[0-9]{9,}')]
    d['banner'] = b'// purge historique v545 : donnees patrimoniales en clair retirees. Voir js/data.enc.js.\n'
if mode == b'160000':          # gitlink / sous-module : aucun contenu à traiter
    return (filename, mode, blob_id)
contents = value.get_contents_by_identifier(blob_id)
if contents is None:
    return (filename, mode, blob_id)
if filename == b'js/data.js':
    if b'export const PORTFOLIO = {};' in contents:
        return (filename, mode, blob_id)                       # coquille : intacte
    return (filename, mode, value.insert_file_with_contents(d['banner']))
if value.is_binary(contents):
    return (filename, mode, blob_id)
new = contents
for rgx in d['redactions']:
    new = rgx.sub(b'#redacted', new)
if new != contents:
    return (filename, mode, value.insert_file_with_contents(new))
return (filename, mode, blob_id)
