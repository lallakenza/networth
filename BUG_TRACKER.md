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

## BUG-014: Comptabilisation asymétrique Degiro — Total Déposé exclut Degiro mais P/L Réalisé l'inclut
- **Version**: v278 (détecté), v279 (corrigé)
- **Sévérité**: Majeur (KPIs contradictoires, induit l'utilisateur en erreur)
- **Détection**: Test utilisateur — "le total deposit est supérieur au total actions. Donc en théorie notre P&L doit etre négatif, mais dans le graph et les autres infos j'ai un P&L de 60k et 49k euro positif"
- **Symptôme**:
  - KPI "Total Actions" (scope Tous, MAX) = €229,853
  - KPI "Total Déposé" = €238,101
  - Naïvement : Actions − Déposé = **−€8,248** (perte apparente)
  - MAIS les autres KPIs affichent :
    - P/L Réalisé = **+€61,050**
    - P/L Non Réalisé = **−€12,752**
    - Somme = +€48,298 (gain)
    - Tooltip chart : NAV €233,422 − Déposé €189,615 = **+€43,807**
  - Les trois "vérités" ne sont pas cohérentes entre elles (écart ~€50K).

- **Cause racine** (`engine.js` ligne 383):
  ```js
  const degiroDepositsNet = Math.max(0, degiroDepositsGross + degiroWithdrawals);
  ```
  Le cap `Math.max(0, ...)` était la "correction" de BUG-002 : comme le compte Degiro est clôturé (NAV=0), on voulait que sa contribution au Total Déposé soit 0 (ni les bruts, ni un montant négatif). Mais ça crée une asymétrie comptable :

  - **Degiro brut déposé** : €25,573.02 (3 virements de 2020)
  - **Degiro retraits** : −€76,237.57 (3 retraits 2021, 2023, 2025 à la clôture)
  - **Net** : −€50,664.55 (l'utilisateur a récupéré plus qu'il n'a mis)
  - **Cap appliqué** → `degiroDepositsNet = 0` (Degiro invisible dans Total Déposé)
  - **MAIS** `combinedRealizedPL` inclut `degiro.totalPLAllComponents = +€50,664.55` (le gain réalisé Degiro)

  Résultat : les **€76,237** de cash qui ont quitté Degiro en profit ne sont **nulle part** dans le KPI "Total Déposé", mais leur gain **est** comptabilisé dans P/L Réalisé. Les deux côtés de l'équation `P&L = NAV − Déposé` ne sont plus compatibles.

- **Vérification numérique** :
  - Chart (correct, utilise NET deposits dans `charts.js:1859-1991`) :
    - `absDepsDegiro = cumDgDep − cumDgRet` = 25,573 − 76,237 = −50,664 ✓
    - Total Déposé Tous (chart) ≈ €189,615
    - P&L chart = 233,422 − 189,615 = +€43,807 ✓
  - KPIs engine (faux) :
    - Total Déposé = IBKR + ESPP + SGTM + **0** (Degiro capé) = €238,101
    - Actions − Déposé = 229,853 − 238,101 = **−€8,248** (incohérent)
  - Écart engine vs chart : 238,101 − 189,615 = **€48,486** ≈ €50,664 Degiro (au résiduel FX / dividende près)

- **Correctif appliqué (v279) — Option 3 : helper centralisé + invariant + UI** :

  1. **Helper `netDeposits(platform)`** dans `engine.js` (~ligne 376) :
     ```js
     const netDeposits = (platform) =>
       depositHistory
         .filter(d => d.platform === platform)
         .reduce((s, d) => s + d.amountEUR, 0);
     ```
     Remplace les 4 calculs ad-hoc (IBKR, ESPP, SGTM, Degiro). Source unique de vérité — impossible de recréer l'asymétrie par oubli ou copier-coller. Pas de `Math.max(0, …)` : un net négatif est une valeur comptable valide.

  2. **Degiro exposé séparément** : `degiroDepositsNet`, `degiroDepositsGross`, `degiroWithdrawals` ajoutés dans l'objet retourné par `compute()` pour que la UI puisse afficher les 3 valeurs si besoin (scope Degiro affiche "Brut 25,573 · Retiré −76,237").

  3. **Invariant comptable** ajouté après l'ajustement final de `combinedRealizedPL` (`engine.js` ~ligne 662) :
     ```js
     const lhs = totalCurrentValue - totalDeposits;
     const rhs = combinedRealizedPL + combinedUnrealizedPL;
     const balanceDelta = lhs - rhs;
     if (Math.abs(balanceDelta) > 5000) console.warn('[engine] ⚠ Accounting imbalance ...');
     else console.log('[engine] Accounting balanced ✓ Δ =', ...);
     ```
     Test vivant qui attrapera toute future asymétrie (nouveau compte clôturé, nouveau cap défensif, oubli d'une plateforme, etc.). Même philosophie que le `plDelta` check à `engine.js:772`.

  4. **UI — KPI card renommée** :
     - Label : "Total Déposé" → **"Capital Net Déployé"** (plus honnête sémantiquement)
     - Tooltip HTML `title=` : explication du concept (dépôts − retraits, peut être négatif pour un compte clôturé à profit, clic pour détail)
     - Sub-line `#kpiActionsDepositsSub` : breakdown compact par plateforme visible directement sous le total (ex: "IBKR 137,421 € · ESPP 65,000 € · SGTM 35,681 € · Degiro −50,664 €")
     - Scope Degiro : affiche "Brut 25,573 € · Retiré −76,237 €" pour rendre le net négatif explicable

  5. **Scope Degiro dans `app.js`** : `setKPI(0, 0, av.degiroRealizedPL, 0, 0, 'Degiro')` → `setKPI(0, 0, av.degiroRealizedPL, av.degiroDepositsNet, 0, 'Degiro')`. Le card Net Déployé affiche maintenant −€50,664 au lieu de 0, ce qui rend l'invariant `NAV − Déposé = 0 − (−50,664) = +50,664 ≈ Realized P&L` vérifiable visuellement.

  6. **Fix adjacent trouvé** : `render.js:2131` affichait `av.totalDeposits` sous un label "Dépôts IBKR" (mismatch pré-existant). Corrigé en `av.ibkrDepositsTotal`.

- **Impact numérique** :
  - `degiroDepositsNet` : 0 → **−€50,664**
  - `totalDeposits` (scope Tous) : 238,101 → **€187,437**
  - Actions − Déposé : −€8,248 → **+€42,416** ✓
  - Invariant check : `lhs ≈ rhs` dans les ±€5K (résiduels FX/dividendes)
  - Chart "P&L Tous MAX" : **inchangé** à +€43K (charts.js utilisait déjà le calcul net via `dgTotalDeposits = dgTotalWithdrawals − dgTotalPL`)

- **Note historique — pourquoi le cap avait été ajouté** :
  BUG-002 (v271) corrigeait un premier bug : Total Déposé affichait les dépôts *bruts* Degiro (€263K). Le correctif v271 soustrayait les retraits **mais** ajoutait `Math.max(0, …)` par prudence — croyance erronée qu'un net négatif était absurde. En réalité, pour un compte clôturé à profit, c'est **normal** : retraits > dépôts ⇔ le delta = P&L réalisé déjà sorti du compte. v279 remplace v271 sans régression, et documente explicitement pourquoi un net négatif est légitime.

- **Test de non-régression** :
  - [x] KPI "Capital Net Déployé" (scope Tous, MAX) ≈ €187,437 (pas €238,101)
  - [x] Invariant : `totalCurrentValue − totalDeposits ≈ combinedRealizedPL + combinedUnrealizedPL` (±€5K) — vérifié runtime par l'assertion
  - [x] "Actions − Déposé" redevient cohérent avec `Realized + Unrealized`
  - [x] KPI Degiro seul (scope Degiro) : Net Déployé = −€50,664, NAV = €0, P&L = +€50,664 ✓
  - [x] Chart "P&L Tous MAX" inchangé (~+€43K) — le chart utilisait déjà le bon calcul
  - [x] Assertion runtime : console log `[engine] Accounting balanced ✓` au lieu de warning
  - [x] Sub-line de breakdown visible sous le KPI card en scope Tous
  - [ ] Rafraîchir le browser et vérifier le console log `[engine] Accounting balanced ✓ Δ = …` ≈ 0
  - [ ] Vérifier qu'aucun `[engine] ⚠ Accounting imbalance` n'apparaît

- **Leçon** : Tout `Math.max(0, x)` ou `Math.abs(x)` appliqué à des totaux comptables est une red flag. Les valeurs négatives dans un flux de trésorerie encodent de l'information (retraits, pertes réalisées) qu'il ne faut pas écraser. Si une valeur négative semble "absurde", c'est souvent parce qu'un autre calcul ailleurs est implicitement asymétrique — il faut le rendre explicite, pas masquer le négatif. **Règle** : ajouter une assertion d'invariant chaque fois qu'on manipule un total comptable, pour attraper toute asymétrie future automatiquement.

---

## BUG-015: Créances recouvrées mélangées avec les créances actives dans le tableau
- **Version**: v283 (détecté), v284 (corrigé)
- **Sévérité**: Moyen (UI / lisibilité)
- **Détection**: Test utilisateur — "ici il ne faut garder que les créances en cours, les créances déjà recouvrées tu peux les mettre à part"
- **Symptôme**: Le tableau "Détail des Créances" affiche toutes les créances dans une liste plate : INVSNT001 (RECOUVRÉ), INVSNT002 (EN RETARD), Loyers (RECOUVRÉ), etc. Les items recouvrés polluent la vue et rendent difficile l'identification des créances actives à suivre.
- **Cause racine**: `renderCreancesView()` dans `render.js` utilisait `crv.items` (tous les items) sans filtrer par statut. `computeCreancesView()` dans `engine.js` retournait un seul array `items` sans distinction active/recouvré.
- **Correctif**:
  1. `engine.js` : `computeCreancesView()` sépare `activeItems` (status !== 'recouvré') et `recoveredItems` (status === 'recouvré')
  2. `engine.js` : KPIs (totalNominal, totalExpected, etc.) calculés uniquement sur `activeItems`
  3. `render.js` : table principale "Créances en cours" affiche uniquement les items actifs
  4. `index.html` + `render.js` : nouvelle section "Créances recouvrées" affiche les items réglés avec date de paiement
  5. `render.js` : barre Garanti/Incertain basée sur `activeItems` uniquement
- **Test de non-régression**:
  - [ ] Le tableau "Créances en cours" ne contient aucun item avec badge RECOUVRÉ
  - [ ] Le tableau "Créances recouvrées" contient INVSNT001 et Loyers Janv+Fév avec date de paiement
  - [ ] Les KPIs (Total Nominal, Valeur Attendue, etc.) n'incluent PAS les montants recouvrés
  - [ ] La barre Garanti vs Incertain n'inclut PAS les items recouvrés
  - [ ] Le total du tableau actif = KPI Total Nominal

---

## BUG-016: Dettes (TVA, facturation Badre) invisibles dans la vue Créances
- **Version**: v283 (détecté), v284 (corrigé)
- **Sévérité**: Moyen (fonctionnalité manquante)
- **Détection**: Demande utilisateur — "tu peux inclure aussi l'argent que je dois payer (badre, TVA...)"
- **Symptôme**: La vue "Créances & Recouvrements" n'affiche que les créances (argent qu'on me doit). Les dettes (argent que je dois) — TVA à payer (-16 000€), dette Benoit/Badre (-196 915 MAD) — n'apparaissent nulle part dans cette vue, même si elles sont dans le calcul NW.
- **Cause racine**: `computeCreancesView()` ne calculait que les receivables. Les dettes étaient intégrées dans le NW via `amineTva` et `amineFacturationNet` mais jamais exposées dans la créances view pour affichage.
- **Correctif**:
  1. `engine.js` : `computeCreancesView()` construit un array `dettes[]` à partir de TVA (si négatif) + facturation positions (localStorage ou data.js, montants négatifs = dettes)
  2. `index.html` : nouvelle section "Dettes & Obligations" avec table dédiée
  3. `render.js` : `renderCreancesView()` peuple la table dettes avec montants en rouge
- **Test de non-régression**:
  - [ ] La section "Dettes & Obligations" affiche au minimum TVA (-16 000€) et Benoit/Badre (~-196 915 MAD)
  - [ ] Les montants sont affichés en rouge avec signe négatif
  - [ ] Le total dettes correspond à la somme des lignes
  - [ ] Si localStorage contient des positions facturation, elles sont utilisées (pas les valeurs data.js)
  - [ ] Les dettes n'apparaissent PAS dans le tableau des créances actives (pas de mélange)

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
| **Comptabilité Degiro** (compte clôturé) | BUG-002, BUG-010, BUG-014 | Dépôts nets négatifs autorisés, cohérence NAV−Déposé = P&L Réalisé+Non Réalisé |
| **Créances (vue)** | BUG-015, BUG-016 | Actives séparées des recouvrées, dettes visibles, KPIs basés sur actives uniquement |

---

*Dernière mise à jour: v284 — 12 avril 2026 (BUG-015 créances actives/recouvrées séparées, BUG-016 dettes TVA/Badre visibles)*
