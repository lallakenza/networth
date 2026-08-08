# Archivage Notion — où vivent les documents

Espace Notion : **💰 Patrimoine — Control Tower**
<https://app.notion.com/p/3b00b87c70448184b6e2c3e3fc9e55f5>

Base **📄 Documents sources** : 13 fiches, 25 pièces jointes.
Chaque fiche décrit la source, la méthode d'obtention et la fiabilité du document.

---

## Fichiers du repo — archivés dans Notion, **conservés ici**

Ces fichiers ont une copie consultable dans Notion, mais **le repo reste canonique**.
Ne pas les supprimer : plusieurs sont lus à l'exécution ou par la doc.

| Fichier | Pourquoi il doit rester |
|---|---|
| `data/sgtm_live.json` | **Lu en production** par `js/api.js` (source primaire du cours SGTM) |
| `data/sgtm_history.json` | Alimente les graphes (`js/app.js`, `js/charts.js`) |
| `data/*_balance_20260719.json` | Séries consommées par le script de backfill |
| `ARCHITECTURE.md` | Référencé par `CLAUDE.md` |
| `BUG_TRACKER.md` | Référencé par `CLAUDE.md` |
| `CLAUDE.md` | Instructions projet, chargées à chaque session |
| `docs/ADD_MOROCCAN_STOCK.md` | Référencé par `CLAUDE.md` |
| `docs/SERVER_STORE_SETUP.md` | Runbook d'infrastructure |
| `transaction_history.csv` | Historique courtiers 2018-2026, source du capital net déployé |
| `FINANCIAL_DATA_EXTRACTION.md` | Dossier patrimonial février 2026 |
| `AUDIT_REPORT.md`, `AUDIT_SUMMARY.txt`, `TEST_SPEC.md` | Audits et spécifications |

Tous sont suivis par git : les supprimer produirait un commit qui casserait le site
déployé et la documentation.

**Note format** : Notion refuse l'extension `.md`, les copies y sont donc en `.txt`.
`ARCHITECTURE` est en `.zip` (son contenu déclenche le pare-feu applicatif de Notion).

---

## Relevés et actes — archivés dans Notion, **retirés du local**

Ces fichiers n'existaient qu'en copie unique dans `~/Downloads`. Ils sont désormais
attachés à leur fiche Notion, et la copie locale a été mise à la corbeille.

| Document | Fiche Notion |
|---|---|
| Relevés Mashreq (2 PDF) | Mashreq — relevés PDF Savings + Current |
| Relevés Wio (3 CSV) | Wio — relevés CSV |
| Relevés Revolut (2 CSV) | Revolut — relevés CSV multi-poches |
| Acte VEFA Villejuif | Villejuif — acte authentique |
| Tableaux d'amortissement LCL (2 PDF) | Villejuif — tableaux d'amortissement |

**Réversible** : les fichiers sont dans la corbeille macOS, pas supprimés définitivement.
Les relevés bancaires sont de toute façon ré-exportables depuis chaque banque, et une
copie de l'acte est ré-obtenable auprès du notaire.

---

*Dernière mise à jour : 8 août 2026.*
