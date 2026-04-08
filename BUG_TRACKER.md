# Bug Tracker — Dashboard Patrimonial

Ce document recense tous les bugs détectés, leur cause racine, le mode de détection, et le correctif appliqué.
Il sert de base pour le plan de tests de non-régression.

---

## BUG-001: Bouton 1Y ne déclenche pas le rebuild du chart
- **Version**: v270 (détecté), v275 (corrigé)
- **Sévérité**: Critique
- **Détection**: Test utilisateur — clic sur le bouton 1Y ne change rien
- **Symptôme**: Le bouton 1Y (et tous les boutons de période) ne répondent pas au clic
- **Cause racine**: `ReferenceError: chartResultYTD2 is not defined` dans `app.js` ligne ~1014. Variable renommée en `chartResultYTD` lors d'un refactoring, mais une référence orpheline `chartResultYTD2` a subsisté dans un bloc `try/catch` qui avalait silencieusement l'erreur. Ceci empêchait le binding de TOUS les event handlers (période, scope, owner) car le code d'initialisation s'arrêtait avant d'atteindre le `addEventListener`.
- **Correctif**: `chartResultYTD2` → `chartResultYTD` dans `app.js`
- **Test de non-régression**:
  - [ ] Cliquer sur chaque bouton de période (MTD, 1M, 3M, YTD, 1Y, 5Y, MAX) — le chart doit se mettre à jour
  - [ ] Cliquer sur chaque bouton de scope (IBKR, ESPP, Maroc, Degiro, Tous) — le chart doit changer
  - [ ] Cliquer sur chaque bouton owner (Couple, Amine, Nezha) — le chart doit changer
  - [ ] Vérifier la console pour absence de `ReferenceError`

---

## BUG-002: Total Déposé affiche les dépôts bruts au lieu des dépôts nets
- **Version**: v270 (détecté), v271 (corrigé)
- **Sévérité**: Majeur
- **Détection**: Vérification manuelle des KPIs — €263K affiché au lieu de €238K
- **Symptôme**: Le KPI "Total Déposé" affiche €263,674 (dépôts bruts Degiro) au lieu de €238,101 (dépôts nets, après soustraction des retraits Degiro)
- **Cause racine**: Le calcul Degiro dans `engine.js` utilisait `degiroDepositsGross` sans soustraire les `degiroWithdrawals`. Le compte Degiro étant clôturé (NAV=0), la contribution nette est 0, pas le total des versements.
- **Correctif**: `degiroDepositsNet = Math.max(0, degiroDepositsGross + degiroWithdrawals)` dans `engine.js`
- **Test de non-régression**:
  - [ ] Vérifier que le KPI "Total Déposé" en scope Tous = IBKR + ESPP + SGTM (pas de Degiro car net = 0)
  - [ ] Vérifier que le Total Déposé en scope Degiro = 0€ (compte clôturé)
  - [ ] Vérifier la cohérence : P&L = NAV - Déposé pour chaque scope

---

## BUG-003: Chart canvas vide après chargement des données
- **Version**: v273 (détecté), v274 (corrigé)
- **Sévérité**: Critique
- **Détection**: Test utilisateur — la barre de progression se termine mais le canvas reste vide (300×150 par défaut)
- **Symptôme**: Après le chargement complet des prix, le chart est blanc. Il faut cliquer sur un bouton pour qu'il apparaisse.
- **Cause racine**: `refresh()` dans la séquence d'initialisation appelait `rebuildAllCharts()` qui détruisait le chart YTD (via `destroyAllCharts`). Le chart était construit par `buildPortfolioYTDChart`, puis immédiatement détruit par `refresh()` appelé juste après.
- **Correctif**: Ajout de `renderPortfolioChart()` explicite après `refresh()` dans la séquence d'init de `app.js`
- **Test de non-régression**:
  - [ ] Au chargement initial, le chart doit apparaître automatiquement après la barre de progression
  - [ ] Le canvas ne doit JAMAIS rester à la taille par défaut 300×150
  - [ ] Vérifier la console : `[renderPortfolioChart]` doit apparaître après `[refresh]`

---

## BUG-004: Barre de progression non dynamique
- **Version**: v273 (détecté), v275 (corrigé)
- **Sévérité**: Mineur
- **Détection**: Test utilisateur — la barre reste à 0% pendant le chargement
- **Symptôme**: L'overlay de progression s'affiche mais la barre ne progresse pas. Texte statique "Chargement des données..."
- **Cause racine**: Le callback `onProgress` dans `app.js` mettait à jour un élément DOM inexistant (`progressFill`) au lieu de l'overlay dans le chart (`ytdProgressFill`). De plus, la Phase 2 (prix historiques) n'avait pas de callback de progression.
- **Correctif**: Progression en deux phases — Phase 1 (prix live, 0-50%) et Phase 2 (prix historiques, 50-100%) avec mise à jour du bon élément DOM (`_chartOverlayFill`).
- **Test de non-régression**:
  - [ ] La barre doit progresser de 0% à 50% pendant le chargement des prix live
  - [ ] La barre doit progresser de 50% à 100% pendant le chargement des prix historiques
  - [ ] Le texte doit montrer le ticker en cours de chargement
  - [ ] L'overlay doit disparaître quand le chart apparaît

---

## BUG-005: Owner toggle (Amine/Nezha) affiche le même graphe avec une échelle différente
- **Version**: v269-v275 (détecté), v276 (corrigé)
- **Sévérité**: Majeur
- **Détection**: Test utilisateur — "quand je choisi amine ou nezha sur le p&l, ça m'affiche le même graph avec une échelle différente. C'est une erreur"
- **Symptôme**: Quand on passe de "Couple" à "Amine" ou "Nezha", le graphe ESPP a exactement la même forme mais avec un scale différent (ex: Amine = 80% de la courbe couple, Nezha = 20%). Les pics et creux sont identiques.
- **Cause racine**: L'implémentation utilisait un ratio proportionnel fixe (`esppRatio = amineShares/totalShares = 167/207`) appliqué à la courbe ESPP combinée. Ce raccourci produit une forme identique car `f(t) * ratio` a la même forme que `f(t)`. Or Amine et Nezha ont des lots ESPP très différents :
  - Amine : 11 lots de 2018 à 2023 (167 actions, cost basis variés)
  - Nezha : 4 lots de 2023 à 2025 (40 actions, cost basis différents)
  - Exemple : Nezha n'a aucune action avant nov 2023, donc sa NAV ESPP devrait être 0€ avant cette date, pas 20% de la NAV couple.
- **Correctif (v276)**: Refactoring complet du système owner ESPP :
  1. Calcul séparé de `esppSharesAtDateAmine(date)` et `esppSharesAtDateNezha(date)` à partir des lots réels
  2. Séries NAV per-owner : `chartValuesESPPAmine[]` et `chartValuesESPPNezha[]` calculées indépendamment
  3. Séries P&L per-owner : `plValuesESPPAmine[]` et `plValuesESPPNezha[]`
  4. Dépôts per-owner : `cumDepositsESPPAmine[]` et `cumDepositsESPPNezha[]`
  5. `renderPortfolioChart` utilise directement les arrays per-owner au lieu d'appliquer un ratio
  6. Tooltips et click detail panel mis à jour pour utiliser les données per-owner
  - Note : SGTM conserve le ratio 50/50 (même date d'achat, même prix, même cost basis pour les deux)
  - Note : IBKR et Degiro restent 100% Amine (correct)
- **Test de non-régression**:
  - [ ] En scope ESPP + owner Amine : la courbe doit être différente de owner Nezha (forme différente, pas juste échelle)
  - [ ] En scope ESPP + owner Nezha : NAV = 0€ avant novembre 2023 (premier lot Nezha)
  - [ ] En scope ESPP + owner Couple : = Amine + Nezha additionnés
  - [ ] En scope Tous + owner Amine : total = IBKR + ESPP_Amine + SGTM_50% + Degiro
  - [ ] En scope Tous + owner Nezha : total = 0 (pas d'IBKR) + ESPP_Nezha + SGTM_50% + 0 (pas de Degiro)
  - [ ] Tooltip hover : affiche les valeurs per-owner correctes (pas les valeurs couple × ratio)
  - [ ] Click detail panel : NAV, Déposé, P&L cohérents pour chaque owner
  - [ ] P&L = NAV - Déposé pour chaque owner/scope combinaison
  - [ ] Modes 1Y, 5Y, MAX : données per-owner ESPP correctes dans tous les modes

---

## BUG-006: Tooltip affiche les valeurs couple quand Amine/Nezha est sélectionné
- **Version**: v272 (détecté), v273 (corrigé, puis v276 amélioré)
- **Sévérité**: Moyen
- **Détection**: Test utilisateur — tooltip montre les mêmes valeurs quel que soit l'owner sélectionné
- **Symptôme**: En scope Tous avec owner Amine, le tooltip au survol affiche la NAV totale couple, pas la part d'Amine
- **Cause racine**: `externalTooltipHandler` et `onChartClick` lisaient les arrays `navESPP`, `plESPP` etc. sans appliquer le filtre owner.
- **Correctif v273**: Application des ratios proportionnels dans les deux handlers. **Correctif v276**: Remplacement des ratios par les vraies valeurs per-owner (voir BUG-005).
- **Test de non-régression**:
  - [ ] Tooltip hover en owner Amine : NAV = part Amine (vérifier cohérence avec la ligne du chart)
  - [ ] Tooltip hover en owner Nezha : NAV = part Nezha
  - [ ] Click detail panel : NAV ESPP per-owner cohérent

---

## BUG-007: 5Y/MAX chart utilise les données YTD (stale data)
- **Version**: v268 (détecté), v273 (corrigé)
- **Sévérité**: Majeur
- **Détection**: Test développeur — le chart 5Y affiche la même chose que YTD
- **Symptôme**: Cliquer sur 5Y ou MAX affiche les données YTD au lieu des données historiques longues
- **Cause racine**: `buildEquityHistoryChart` stockait les données dans `_ytdChartFullData` (singleton) mais `renderPortfolioChart` lisait depuis `_chartDataByMode[_activeChartMode]` qui pointait encore vers 'ytd'.
- **Correctif**: `buildEquityHistoryChart` stocke maintenant dans `_chartDataByMode[modeKey]` (avec `modeKey = '5y'` ou `'max'`) ET met à jour `_activeChartMode`.
- **Test de non-régression**:
  - [ ] Cliquer sur 5Y : chart affiche 5 ans d'historique (pas seulement YTD)
  - [ ] Cliquer sur MAX : chart affiche tout l'historique depuis 2020
  - [ ] Revenir sur YTD : chart revient aux données 2026 seulement
  - [ ] Alterner rapidement entre YTD, 1Y, 5Y, MAX : chaque mode affiche ses propres données

---

## BUG-008: CDN GitHub Pages sert du JS en cache (stale)
- **Version**: v271 (détecté, récurrent)
- **Sévérité**: Mineur (infrastructure)
- **Détection**: Test utilisateur — comportement ne change pas après deploy
- **Symptôme**: Après push vers GitHub Pages, le site continue d'utiliser l'ancien JS pendant 2-5 minutes. Les corrections semblent ne pas fonctionner.
- **Cause racine**: Le CDN GitHub Pages met en cache les fichiers statiques avec un TTL de quelques minutes. Sans cache-busting, les navigateurs continuent de charger l'ancienne version.
- **Correctif**: Paramètre `?v=N` sur tous les imports ES modules. Incrémenté à chaque deploy (v270→v276). Doit être cohérent entre `index.html`, `app.js`, et `charts.js`.
- **Test de non-régression**:
  - [ ] Après deploy : vérifier la console pour le numéro de version attendu
  - [ ] Tous les imports doivent avoir le même `?v=N`
  - [ ] Si comportement stale : attendre 5 minutes OU forcer hard refresh (Ctrl+Shift+R)

---

## BUG-009: 1Y P&L incorrect — trades avant START_DATE exclus
- **Version**: v264 (détecté et corrigé)
- **Sévérité**: Moyen
- **Détection**: Comparaison YTD vs 1Y — écart de ~10K€
- **Symptôme**: Le P&L 1Y est surestimé de ~10K€ par rapport au YTD. La NAV diverge significativement.
- **Cause racine**: En mode 1Y, `START_DATE` était fixé à "1 an avant aujourd'hui" (ex: 2025-04-08). Mais certains trades IBKR ont eu lieu avant cette date (ex: QQQM acheté le 2025-04-03). Le trade d'achat était exclu (avant START_DATE) mais le trade de vente inclus, ce qui ajoutait le coût d'achat (~€10K) à la NAV sans le soustraire.
- **Correctif**: Extension de `START_DATE` pour inclure le plus ancien trade (`earliestTradeDate - 1 jour`)
- **Test de non-régression**:
  - [ ] 1Y P&L doit être cohérent avec YTD P&L (pas d'écart > 100€ pour les mois communs)
  - [ ] Vérifier la console `[ytd-chart] Start holdings (1Y)` — doit afficher des positions vides (pas de positions au start)

---

## BUG-010: Degiro withdrawals gonflent le P&L Tous en 1Y
- **Version**: v265 (détecté et corrigé)
- **Sévérité**: Moyen
- **Détection**: P&L 1Y "Tous" montre +101K€ de trop
- **Symptôme**: Le P&L total en mode 1Y est gonflé de +101K€ (montant du retrait Degiro)
- **Cause racine**: Le retrait Degiro de -€101,079 (14 avril 2025) était inclus dans `allTotalDepositsEUR`. Étant négatif, il était soustrait des dépôts cumulés, ce qui augmentait le P&L d'autant. Or Degiro n'est pas dans le calcul NAV total (NAV Degiro = 0 car clôturé).
- **Correctif**: Exclusion des dépôts/retraits Degiro de `allTotalDepositsEUR` — le P&L Degiro est géré séparément comme une constante (+51,079€ réalisé).
- **Test de non-régression**:
  - [ ] P&L Tous en 1Y ne doit PAS inclure de "boost" de +101K des retraits Degiro
  - [ ] P&L Degiro doit être constant = +51,079€ (réalisé, compte clôturé)

---

## BUG-011: Breakdown "Autres (arrondis)" montre un gros montant (~14K€)
- **Version**: v261-v263 (détecté et corrigé progressivement)
- **Sévérité**: Moyen
- **Détection**: Clic sur un point du chart — la ligne "Autres (arrondis)" affiche -14,729€
- **Symptôme**: Le détail du P&L par position montre une ligne résiduelle "Autres (arrondis)" de -14K€, censée capturer uniquement les arrondis.
- **Cause racine**: Positions complètement ouvertes ET fermées pendant la période (ex: GLE, WLN, NXI, EDEN, QQQM) n'apparaissaient pas dans les snapshots de début ni de fin. Leur P&L réalisé fuyait dans le résiduel FX. v261: utilisation des dates daily pour le calcul FX. v263: inclusion des `tradeFlows` tickers dans `allTickers`.
- **Correctif**: `allTickers` construit à partir de `snapStart + snapEnd + tradeFlows` (pas seulement snapStart et snapEnd).
- **Test de non-régression**:
  - [ ] La ligne "Autres (arrondis)" ne doit pas dépasser ±500€ en YTD
  - [ ] Les positions fermées (GLE, WLN) doivent apparaître dans le breakdown avec leur P&L correct

---

## BUG-012: EUR cash calibration dérive de ~1,500€
- **Version**: v260 (détecté), v261 (corrigé)
- **Sévérité**: Mineur
- **Détection**: Comparaison NAV chart vs NAV IBKR — écart systématique
- **Symptôme**: La NAV du chart diverge de ~1,500€ par rapport au statement IBKR
- **Cause racine**: Le cash EUR au 2 janvier était dérivé comme résiduel : `EUR = NAV - positions - USD - JPY`. Les prix Yahoo diffèrent légèrement des prix IBKR pour la valorisation des positions non-EUR, accumulant ~1,534€ d'erreur.
- **Correctif**: Utilisation d'un `IBKR_EUR_START_OVERRIDE = -17534` tracé directement depuis le CSV IBKR (valeur exacte), avec recalcul de STARTING_NAV pour cohérence.
- **Test de non-régression**:
  - [ ] La NAV jour 1 doit correspondre à STARTING_NAV (pas d'écart > 10€)
  - [ ] Console `[ytd-chart] Day 1 calibration (IBKR-traced EUR cash)` doit apparaître

---

## BUG-013: Chart vide + boutons non-cliquables — renderPortfolioChart non exporté
- **Version**: v275 (introduit), v276 (détecté et corrigé)
- **Sévérité**: Critique (bloquant)
- **Détection**: Test utilisateur — chart reste vide après chargement, barre de progression disparaît mais rien n'apparaît. Aucun bouton ne répond.
- **Symptôme**: Après le chargement complet des prix (barre de progression 0→100%), le chart canvas reste blanc/vide. Aucun bouton (scope, période, owner, valeur/P&L) ne fonctionne au clic.
- **Cause racine**: `renderPortfolioChart()` est une fonction privée de `charts.js` (pas `export`), mais `app.js` l'appelle directement à la ligne 1031. Cet appel lance un `ReferenceError: renderPortfolioChart is not defined` qui est silencieusement attrapé par le `try/catch` englobant (ligne 1221). Ce catch avale l'erreur ET saute tout le code de binding des event handlers (lignes 1040-1220), reproduisant le même effet que BUG-001 mais avec une cause différente.
  - Note : ce bug a été introduit en v275 (ajout de `renderPortfolioChart()` après `refresh()`) mais n'a jamais été testé en production car le CDN servait encore du v274 stale quand l'utilisateur a signalé d'autres bugs.
- **Correctif**:
  1. `charts.js` : `function renderPortfolioChart` → `export function renderPortfolioChart`
  2. `app.js` : ajout de `renderPortfolioChart` dans l'import de `charts.js`
- **Test de non-régression**:
  - [ ] Au chargement initial, le chart doit apparaître automatiquement après la barre de progression
  - [ ] Tous les boutons (scope, période, owner, valeur/P&L) doivent être cliquables
  - [ ] Vérifier la console pour absence de `ReferenceError: renderPortfolioChart`
  - [ ] Le canvas ne doit JAMAIS rester vide après le chargement des données
- **Leçon**: Les `try/catch` silencieux qui englobent du code d'initialisation sont dangereux. Une erreur dans le bloc `try` saute silencieusement tout le reste, y compris les `addEventListener` critiques. Pattern à surveiller : tout code qui bind des handlers doit être HORS du try/catch du data loading, ou dans son propre try/catch avec un `console.error` explicite.

---

## Matrice de couverture par fonctionnalité

| Fonctionnalité | Bugs liés | Tests critiques |
|---|---|---|
| **Boutons période** (MTD/1M/3M/YTD/1Y/5Y/MAX) | BUG-001, BUG-007, BUG-009, BUG-013 | Tous les boutons répondent, données correctes par mode |
| **Boutons scope** (IBKR/ESPP/Maroc/Degiro/Tous) | BUG-001, BUG-013 | Chaque scope affiche les bonnes séries |
| **Boutons owner** (Couple/Amine/Nezha) | BUG-001, BUG-005, BUG-006, BUG-013 | Courbes distinctes, tooltips cohérents |
| **KPI cards** (NAV, Déposé, P&L, %) | BUG-002, BUG-010 | Formule P&L = NAV - Déposé vérifiée |
| **Barre de progression** | BUG-003, BUG-004 | Progression dynamique, chart visible après |
| **Tooltip hover** | BUG-006 | Valeurs per-owner correctes |
| **Click detail panel** | BUG-006, BUG-011 | Breakdown par position exact |
| **Cache/deploy** | BUG-008 | Version cohérente, pas de stale JS |
| **ESPP per-owner** | BUG-005 | Formes différentes, Nezha = 0 avant nov 2023 |
| **Chart init** | BUG-003, BUG-013 | Chart visible après chargement, pas de canvas vide |

---

*Dernière mise à jour: v276 — 8 avril 2026*
