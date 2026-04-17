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

## BUG-017: Breakdown table et KPI cards désynchronisés — facturationNet et cautionRueil manquants
- **Version**: v284 (détecté), v285 (corrigé)
- **Sévérité**: Majeur (les KPIs affichés sont incohérents entre eux)
- **Détection**: Test utilisateur — "On voit où ici azarkan et badre ? Normalement ce breakdown doit inclure tout ? Or le breakdown inclus un montant différent de ce qu'on a dans les cards. C'est un bug"
- **Symptôme**: 
  - Le tableau "Patrimoine Couple — Detail consolidé" ne montrait pas la ligne Facturation (Augustin/Benoit)
  - Le KPI card "Autres Actifs" était inférieur au vrai montant (manquait ~1,450€ de facturation)
  - La somme Actions + Cash + Immo + Autres ≠ NW affiché dans la card principale
  - Même problème pour Amine (breakdown table sans facturation) et Nezha (missing cautionRueil)
- **Cause racine** (5 emplacements désynchronisés) :
  1. `couple.autreTotal` (engine.js:3704) : manquait `+ amineFacturationNet`
  2. `views.couple.other` (engine.js:3822) : manquait `- nezhaCautionRueil`
  3. `views.nezha.other` (engine.js:3843) : manquait `- nezhaCautionRueil`
  4. `coupleCategories` treemap (engine.js:3813) : pas de catégorie "Dettes" (TVA + caution)
  5. `amineCategories` treemap (engine.js:3922) : pas de catégorie TVA
  6. `nezhaCategories` treemap (engine.js:3962) : pas de caution dans "Créances"
  7. `renderCoupleTable` (render.js:964) : pas de ligne facturation
  8. `renderAmineTable` (render.js:985) : pas de ligne facturation
  9. Insights kpiCoupleAmNW et kpiCoupleAutre : facturation manquante dans les sommes
- **Correctif** :
  1. Ajout `+ amineFacturationNet` dans `couple.autreTotal`
  2. Ajout `- nezhaCautionRueil` dans `views.couple.other` et `views.nezha.other`
  3. Nouvelle catégorie "Dettes & Obligations" dans `coupleCategories` (TVA + caution)
  4. Nouvelle catégorie "TVA à payer" dans `amineCategories`
  5. Ajout `- nezhaCautionRueil` dans `nezhaCategories` "Créances & Autres"
  6. Ajout ligne "Facturation net" dans `renderCoupleTable` et `renderAmineTable`
  7. Fix des insights pour inclure facturation dans les sommes
- **Invariant ajouté** : Pour chaque vue (couple, amine, nezha), `stocks + cash + immo + other = nwRef`
- **Test de non-régression** :
  - [ ] Tableau couple : ligne "Facturation net (Augustin − Benoit)" visible avec montant ~-1,450€
  - [ ] KPI Autres = somme des lignes Véhicules + Créances + Facturation + TVA + Réserv. - Caution
  - [ ] Actions + Cash + Immo + Autres = Net Worth affiché (à ±1€ près pour arrondis)
  - [ ] Treemap couple : catégorie "Dettes & Obligations" visible avec TVA + Caution
  - [ ] Treemap amine : catégorie "TVA à payer" visible (-16K€)
  - [ ] Treemap nezha : "Caution Rueil" visible dans "Créances & Autres"
  - [ ] Tooltip insight kpiCoupleAutre mentionne "Facturation"
  - [ ] Amine breakdown table : ligne facturation visible
- **Leçon** : Quand on ajoute un nouveau composant au calcul NW (ici `facturationNet`), il faut mettre à jour TOUS les endroits qui décomposent le NW : (1) calcul NW, (2) KPI cards, (3) breakdown tables, (4) treemap categories, (5) insights tooltips, (6) views object. Checklist à suivre systématiquement à chaque ajout.

---

## BUG-018: Tooltip chart affiche le delta couple au lieu du delta per-owner (Nezha)
- **Version**: v285 (détecté), v286 (corrigé)
- **Sévérité**: Majeur (information trompeuse — delta de -45K affiché pour un portefeuille de 8K)
- **Détection**: Test utilisateur — "On a un bug dans la vue nezha, normalement on affiche seulement son delta et non celui du couple"
- **Symptôme**: En mode Valeur, scope Tous, owner Nezha, le tooltip au survol d'un point du chart affiche "€ -45 895 (-84.62%)" alors que la NAV Nezha est ~8 339€ (début 1Y: 6 288€). Le delta correct serait ~+2 051€. Le header titre affichait correctement -2 927€ (P&L net après dépôts).
- **Cause racine** (`charts.js`, tooltip handler, ligne 2590) :
  ```js
  const startV = startValueRef || nav; // startValueRef = data.startValue
  const diff = nav - startV;
  ```
  `startValueRef` est défini comme `data.startValue` (ligne 2416) qui est la NAV de départ **couple** (~54 234€ en mode 1Y), jamais filtrée par owner. Quand Nezha est sélectionné :
  - `nav` = 8 339€ (correctement filtré par les arrays per-owner)
  - `startV` = 54 234€ (couple, NON filtré)
  - `diff = 8 339 - 54 234 = -45 895` ← le bug
  
  Note : le header titre était correct car il utilise `plForTitle` (issu des PL series qui SONT filtrées par owner à la ligne 2153). Le bug était isolé au tooltip hover.
- **Correctif** :
  Quand `owner !== 'both'`, recalcul de `startV` à partir des arrays NAV per-owner au `startIdx` :
  ```js
  switch (scope) {
    case 'espp': startV = _ownerESPPNav[startIdx]; break;
    case 'maroc': startV = navSGTM[startIdx] * sgtmRatio; break;
    case 'all': startV = navIBKR[startIdx]*ibkrRatio + _ownerESPPNav[startIdx] 
                        + navSGTM[startIdx]*sgtmRatio + navDegiro[startIdx]*degiroRatio; break;
    // ...
  }
  ```
  Même logique que le filtre owner existant (lignes 2143-2154), appliqué au point de départ de la période.
- **Test de non-régression** :
  - [ ] Owner Nezha, scope Tous, mode Valeur : tooltip au survol montre delta ~+2K (pas -45K)
  - [ ] Owner Amine, scope Tous : tooltip cohérent (~NAV Amine - startNAV Amine)
  - [ ] Owner Couple (both) : tooltip inchangé (pas de régression)
  - [ ] Mode P&L : tooltip inchangé (n'utilise pas `startValueRef`)
  - [ ] Scope ESPP + owner Nezha : delta calculé depuis la NAV ESPP Nezha au start
  - [ ] Modes 5Y et MAX : même fix appliqué (même tooltip handler)
- **Leçon** : Dans le chart system, 3 niveaux de données coexistent : (1) les series brutes (couple), (2) les series filtrées par owner (boucle 2143-2154), (3) les metadata comme `startValue` qui restent couple-level. Chaque nouveau consumer de ces données (tooltip, header, click panel) doit appliquer le filtre owner de manière consistante. Pattern récurrent : BUG-005, BUG-006, BUG-018.

---

## BUG-019: Augustin (Azarkan) absent de la vue créances
- **Version**: v286 (détecté), v287 (corrigé)
- **Sévérité**: Majeur
- **Détection**: Test utilisateur — "Ici je vois badre mais pas azarkan ?"
- **Symptôme**: Dans la page #creances, Benoit (Badre) apparaît dans la section Dettes mais Augustin (Azarkan, +181 609 MAD) n'apparaît nulle part dans la vue. Pourtant il est bien pris en compte dans le calcul NW via `amineFacturationNet`.
- **Cause racine**: `computeCreancesView()` n'injectait pas les positions facturation positives (receivables) dans `activeItems`. Seules les positions négatives (dettes) étaient traitées. Les facturations positives (= on me doit de l'argent) étaient ignorées côté vue créances, bien qu'elles soient correctement comptées dans le NW via `amineFacturationNet` (calcul séparé dans `compute()`).
- **Correctif** : Refactoring de `computeCreancesView()` pour créer deux arrays séparés : `factuCreances[]` (positives → receivables à afficher dans les actives) et `dettes[]` (négatives → obligations). Injection de `factuCreances` dans `activeItems` via `activeItems.push(...factuCreances)`. Calcul des KPIs (`totalNominal`, `totalExpected`, etc.) déplacé APRÈS l'injection pour que les totaux incluent Augustin. Support localStorage + fallback data.js pour les deux chemins.
- **Audit NW** : Vérifié aucun double-comptage. `amineRecvPro`/`amineRecvPersonal` (dans le calcul NW) proviennent uniquement de `p.amine.creances.items`. `amineFacturationNet` est calculé séparément depuis localStorage/data.js facturation. `computeCreancesView()` est display-only et n'alimente pas le calcul NW.
- **Test de non-régression** :
  - [ ] Augustin (Azarkan) visible dans la section "Créances en cours" avec +181 609 MAD
  - [ ] Benoit (Badre) visible dans la section "Dettes & Obligations"
  - [ ] TVA toujours visible dans Dettes
  - [ ] KPIs créances (Total Nominal, Garanti, Incertain) incluent Augustin
  - [ ] Barre Garanti/Incertain inclut Augustin (garanti)
  - [ ] NW inchangée (pas de double-comptage — créances view est display-only)
  - [ ] Fallback data.js fonctionne si localStorage vide

---

## Matrice de couverture par fonctionnalité

| Fonctionnalité | Bugs liés | Tests critiques |
|---|---|---|
| **Boutons période** (MTD/1M/3M/YTD/1Y/5Y/MAX) | BUG-001, BUG-007, BUG-009, BUG-013 | Tous les boutons répondent, données correctes par mode |
| **Boutons scope** (IBKR/ESPP/Maroc/Degiro/Tous) | BUG-001, BUG-013 | Chaque scope affiche les bonnes séries |
| **Boutons owner** (Couple/Amine/Nezha) | BUG-001, BUG-005, BUG-006, BUG-013 | Courbes distinctes, tooltips cohérents |
| **KPI cards** (NAV, Déposé, P&L, %) | BUG-002, BUG-010 | Formule P&L = NAV - Déposé vérifiée |
| **Barre de progression** | BUG-003, BUG-004 | Progression dynamique, chart visible après |
| **Tooltip hover** | BUG-006, BUG-018 | Valeurs per-owner correctes, delta calculé depuis start NAV per-owner |
| **Click detail panel** | BUG-006, BUG-011 | Breakdown par position exact |
| **Cache/deploy** | BUG-008, BUG-036, BUG-038 | Version cohérente, badge version visible, pas de stale JS |
| **ESPP per-owner** | BUG-005 | Formes différentes, Nezha = 0 avant nov 2023 |
| **Chart init** | BUG-003, BUG-013 | Chart visible après chargement, pas de canvas vide |
| **Comptabilité Degiro** (compte clôturé) | BUG-002, BUG-010, BUG-014 | Dépôts nets négatifs autorisés, cohérence NAV−Déposé = P&L Réalisé+Non Réalisé |
| **Créances (vue)** | BUG-015, BUG-016, BUG-019 | Actives séparées des recouvrées, dettes visibles, facturation receivables injectées, KPIs basés sur actives uniquement |
| **NW Breakdown / KPI cards** | BUG-017 | Tous les composants NW dans les breakdowns, cards, treemaps et insights. Invariant: stocks+cash+immo+autre = NW |

---

## BUG-020: ESPP cash (~2,100€) absent du calcul NW
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Majeur (NW sous-estimé de ~2,100€)
- **Détection**: Audit codebase automatisé
- **Symptôme**: Le cash résiduel dans les comptes ESPP UBS (2,000 EUR Amine + $109.56 Nezha) n'est compté nulle part dans le NW. Le commentaire dit "Cash ESPP côté cashView" mais cashView est display-only.
- **Cause racine**: `engine.js:3529` calcule `amineEspp = shares × price` sans ajouter `cashEUR`. Idem `engine.js:3654` pour `nezhaEspp` qui ignore `cashUSD`.
- **Correctif**: Ajout du cash ESPP dans les calculs: `amineEspp` inclut `cashEUR`, `nezhaEspp` inclut `toEUR(cashUSD)`. Exposé dans l'objet retourné pour affichage.
- **Test de non-régression**:
  - [ ] `amineEspp` = shares × price + 2,000€ (pas juste shares × price)
  - [ ] `nezhaEspp` = shares × price + toEUR($109.56) (pas juste shares × price)
  - [ ] NW couple augmenté de ~2,100€ vs v287

---

## BUG-021: Event listeners dupliqués sur les toggles chart
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Majeur (handlers tirés N fois après N refreshes)
- **Détection**: Audit codebase automatisé
- **Symptôme**: Après un hard refresh ou auto-refresh (10 min), cliquer sur scope/period/mode/owner lance le handler N fois (une fois par appel de `loadStockPrices`).
- **Cause racine**: `app.js:1101-1282` — les `addEventListener` sont à l'intérieur de `loadStockPrices()` qui est appelé au init, au refresh manuel, et toutes les 10 min. Chaque appel ajoute un nouveau listener.
- **Correctif**: Guard avec flag `_chartTogglesBound`. Les listeners ne sont bindés qu'une seule fois au premier appel.
- **Test de non-régression**:
  - [ ] Faire un hard refresh → cliquer sur un bouton scope → un seul rebuild (pas deux)
  - [ ] Attendre 10 min auto-refresh → cliquer sur un toggle → un seul handler

---

## BUG-022: Table breakdown Nezha manque villejuifReservation
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Moyen (total table ≠ KPI card)
- **Détection**: Audit codebase automatisé
- **Symptôme**: La table détail Nezha ne montre pas la ligne "Réservation Villejuif" (3K€ quand `!villejuifSigned`), mais le KPI card Nezha l'inclut → le total table < NW Nezha affiché.
- **Cause racine**: `render.js:997-1009` — `renderNezhaTable` construit les rows sans inclure `villejuifReservation`.
- **Correctif**: Ajout conditionnel de la ligne "Réservation Villejuif" dans les rows quand `!villejuifSigned && reservation > 0`.
- **Test de non-régression**:
  - [ ] Table Nezha : total = KPI NW Nezha (à ±1€ près)
  - [ ] Ligne "Réservation Villejuif" visible quand bail non signé

---

## BUG-023: Expand sub-card créances inclut les items recouvrés
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Moyen (total sub-card gonflé)
- **Détection**: Audit codebase automatisé
- **Symptôme**: Le breakdown créances dans les KPI expand cards inclut les items `recouvré` → total plus élevé que la contribution réelle au NW.
- **Cause racine**: `render.js:480-497` — lit directement `portfolio.*.creances.items` sans filtrer `status === 'recouvré'`.
- **Correctif**: Ajout du filtre `.filter(c => c.status !== 'recouvré')` avant le mapping.
- **Test de non-régression**:
  - [ ] Sub-card créances n'inclut aucun item recouvré
  - [ ] Total sub-card = somme des créances actives uniquement

---

## BUG-024: WHT_RATES incohérents avec les dividendes réels IBKR
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Moyen (projections dividendes faussées)
- **Détection**: Audit codebase — comparaison costs[] vs WHT_RATES
- **Symptôme**: `WHT_RATES.france = 0.30` mais les dividendes réels FR dans costs[] montrent 25% WHT. `WHT_RATES.us = 0.15` mais QQQM dividendes montrent 30% WHT.
- **Cause racine**: Les taux dans WHT_RATES sont les taux statutaires/conventionnels, pas les taux effectifs appliqués par IBKR. UAE résident → pas de convention FR-UAE (30% FR), pas de W-8BEN (30% US).
- **Correctif**: `WHT_RATES.france = 0.25` (taux effectif IBKR), `WHT_RATES.us = 0.30` (UAE, pas de W-8BEN). Commentaires mis à jour.
- **Test de non-régression**:
  - [ ] Projections dividendes FR utilisent 25% (pas 30%)
  - [ ] Projections dividendes US utilisent 30% (pas 15%)

---

## BUG-025: startValue scope fallthrough dans charts — 'all' et 'degiro' utilisent IBKR
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Moyen (label reference line incorrect)
- **Détection**: Audit codebase automatisé
- **Symptôme**: En scope "Tous", le `startValue` stocké est la NAV IBKR-only au lieu de la NAV totale. Affecte le label de la ligne de référence.
- **Cause racine**: `charts.js:3998` — le ternaire ne couvre que 'espp' et 'maroc', le reste (dont 'all' et 'degiro') tombe sur `chartValues[0]` (IBKR).
- **Correctif**: Ajout des cas 'all' → `chartValuesTotal[0]` et 'degiro' → `chartValuesDegiro[0]`.
- **Test de non-régression**:
  - [ ] Scope Tous : reference line label = NAV totale au start (pas IBKR seul)
  - [ ] Scope Degiro : reference line label = NAV Degiro au start

---

## BUG-026: DG.PA dans DIV_CALENDAR et DIV_YIELDS après vente complète
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Moyen (projections dividendes incluent position vendue)
- **Détection**: Audit codebase automatisé
- **Symptôme**: DG.PA (Vinci) a été entièrement vendu le 08/04/2026 mais reste dans DIV_YIELDS et DIV_CALENDAR → projections de dividendes futures sur une position inexistante.
- **Cause racine**: `data.js` — DG.PA non retiré de DIV_YIELDS et DIV_CALENDAR après la vente.
- **Correctif**: Suppression de DG.PA des deux objets. Commentaire ajouté pour traçabilité.
- **Test de non-régression**:
  - [ ] Projection dividendes ne mentionne plus DG.PA/Vinci
  - [ ] Aucune alerte ex-date pour DG.PA

---

## BUG-027: DATA_LAST_UPDATE stale (31/03 au lieu de 12/04)
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Mineur (affichage trompeur)
- **Détection**: Audit codebase automatisé
- **Symptôme**: Le badge "données du 31/03/2026" alors que les soldes sont à jour au 12/04/2026.
- **Cause racine**: `data.js:1115` — `DATA_LAST_UPDATE` non mis à jour.
- **Correctif**: `'31/03/2026'` → `'12/04/2026'`
- **Test de non-régression**:
  - [ ] Badge affiche "12/04/2026"

---

## BUG-028: Taux Action Logement incohérent (0.5% vs 1%)
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Mineur (EXIT_COSTS informatif, pas utilisé dans le calcul CRD)
- **Détection**: Audit codebase automatisé
- **Symptôme**: Loan definition = 0.5% (`rate: 0.005`) vs EXIT_COSTS = 1% (`taux: 0.01`). L'amortissement est correct (utilise 0.5%), mais EXIT_COSTS affiche le mauvais taux.
- **Cause racine**: `data.js:1788` — `taux: 0.01` au lieu de `0.005`.
- **Correctif**: `taux: 0.01` → `taux: 0.005`
- **Test de non-régression**:
  - [ ] EXIT_COSTS.vitry.actionLogement.taux = 0.005

---

## BUG-029: Allocation géographique chart hardcodée (53% France, 21% Crypto...)
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Moyen (chart trompeur après achats/ventes)
- **Détection**: Audit codebase automatisé
- **Symptôme**: Le chart géo utilise des ratios statiques (`geoIBKR*0.53` pour France) au lieu de calculer depuis les positions réelles. Les pourcentages deviennent faux après tout trade.
- **Cause racine**: `charts.js:341` — ratios hardcodés lors de la première implémentation.
- **Correctif**: Calcul dynamique par agrégation des positions IBKR groupées par `pos.geo`, plus ESPP et SGTM.
- **Test de non-régression**:
  - [ ] Chart géo reflète les positions actuelles
  - [ ] Après un trade, les pourcentages changent
  - [ ] ESPP et SGTM sont dans les bonnes catégories

---

## BUG-030: Tooltips insight hardcodés (43%, +12.5% YTD, +€41K...)
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Mineur (tooltips trompeurs avec le temps)
- **Détection**: Audit codebase automatisé
- **Symptôme**: Plusieurs KPI insights contiennent des valeurs hardcodées qui ne reflètent plus la réalité.
- **Cause racine**: `render.js:6242-6262` — valeurs écrites en dur lors de la première implémentation.
- **Correctif**: Remplacement par des valeurs calculées dynamiquement depuis `state`.
- **Test de non-régression**:
  - [ ] Tooltip kpiAmPortfolio : concentration top 3 calculée dynamiquement
  - [ ] Tooltip kpiActionsTotal : pas de benchmarks hardcodés

---

## BUG-031: Période % total affiche "—%" au lieu de "0.0%"
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Mineur (cosmétique)
- **Détection**: Audit codebase automatisé
- **Symptôme**: Quand `totalEvoPL` est exactement 0 (falsy en JS), la cellule affiche "—%" au lieu de "0.0%".
- **Cause racine**: `render.js:1541` — `totalEvoPL && totalVal` est faux quand `totalEvoPL === 0`.
- **Correctif**: `totalEvoPL != null && totalVal` au lieu de `totalEvoPL && totalVal`.
- **Test de non-régression**:
  - [ ] Quand l'évolution période = 0€, le % affiche "0.0%" pas "—%"

---

## BUG-032: Commentaires stale (file header v233, mtdOpen mars 2026)
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Mineur (cosmétique)
- **Détection**: Audit codebase automatisé
- **Symptôme**: File header dit "Version: v233", mtdOpen comment dit "3 mars 2026".
- **Correctif**: Mise à jour des commentaires.
- **Test de non-régression**:
  - [ ] Header dit v288
  - [ ] Commentaire mtdOpen dit "avril 2026"

---

## BUG-033: nezhaRecvOmar hardcode items[0] — casse si 2e créance Nezha
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Mineur (fragile, pas de bug actuel)
- **Détection**: Audit codebase automatisé
- **Symptôme**: `engine.js:3660` hardcode `items[0]` pour la créance Omar. Si Nezha obtient une 2e créance, les suivantes sont ignorées.
- **Cause racine**: Code écrit quand Nezha n'avait qu'une seule créance.
- **Correctif**: Boucle sur tous les items Nezha (même logique que pour Amine), filtrant par `status !== 'recouvré'`.
- **Test de non-régression**:
  - [ ] nezhaRecv inclut toutes les créances actives de Nezha
  - [ ] NW Nezha inchangé (Omar est toujours la seule créance)

---

## BUG-034: refreshFX standalone sans try/catch — unhandled rejection possible
- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Mineur (erreur silencieuse)
- **Détection**: Audit codebase automatisé
- **Symptôme**: Si l'API FX lève une exception (vs retourner null), `refreshFX(false)` à la ligne 417 et l'intervalle 5 min propagent une unhandled promise rejection.
- **Cause racine**: `app.js:417,425` — pas de `.catch()` ou `try/catch`.
- **Correctif**: Wrapping dans `.catch()`.
- **Test de non-régression**:
  - [ ] Pas d'unhandled rejection si API FX échoue

---

## BUG-035: _equityEntries index désaligné dans charts 5Y/MAX

- **Version**: v287 (détecté), v288 (corrigé)
- **Sévérité**: Mineur (notes click panel incorrectes)
- **Détection**: Audit codebase automatisé
- **Symptôme**: `_equityEntries` est filtré (seulement les entries avec notes) mais indexé par position chart → le click panel montre des notes fausses ou manquantes.
- **Cause racine**: `charts.js:4469` — `dataPoints.filter(d => d.note)` perd l'alignement d'index avec le chart.
- **Correctif**: Stocker le tableau complet (non filtré) pour maintenir l'alignement d'index. Les consumers vérifient `entry.note` avant affichage.
- **Test de non-régression**:
  - [ ] Click sur un point 5Y/MAX : note correcte affichée si elle existe
  - [ ] Click sur un point sans note : pas de note affichée (comportement normal)

## BUG-036: simulators.js imports stale (?v=259 au lieu de ?v=288)

- **Version**: v289 (fix)
- **Sévérité**: Moyenne
- **Détection**: Audit code v288
- **Symptôme**: simulators.js charge des modules render.js et data.js potentiellement obsolètes
- **Cause racine**: Les imports de simulators.js n'avaient pas été mis à jour lors des bumps de version successifs (restés à v=259)
- **Correctif**: Mise à jour des imports vers `?v=289`
- **Test de non-régression**:
  - [ ] Ouvrir Simulateurs → 3 simulateurs fonctionnent, graphiques visibles

## BUG-037: P&L par action n'inclut pas l'impact FX (EUR/USD, EUR/JPY)

- **Version**: v289 (fix)
- **Sévérité**: Haute (données financières incorrectes)
- **Détection**: Audit v288 — question utilisateur
- **Symptôme**: P&L affiché pour positions USD/JPY = mouvement cours seul, sans impact taux de change
- **Cause racine**: `costEUR = toEUR(shares * costBasis, currency, fx)` utilise le FX actuel pour le coût. Le P&L annule l'effet FX car les deux côtés utilisent le même taux.
- **Correctif**: Ajout `fxRate` (ECB historique) par trade non-EUR, décomposition stockPL + fxPL dans engine.js, colonne "FX P/L" dans render.js
- **Test de non-régression**:
  - [ ] Positions EUR: FX P/L = "—"
  - [ ] Positions USD (IBIT, ETHA): FX P/L non nul, signe cohérent avec mouvement EUR/USD
  - [ ] Position JPY (4911.T): FX P/L non nul
  - [ ] Total P/L incluant FX ≈ ancien P/L ± impact FX

## BUG-038: Version du code non affichée dans le header

- **Version**: v289 (fix)
- **Sévérité**: Basse (UX)
- **Détection**: Demande utilisateur
- **Symptôme**: Impossible de vérifier si le navigateur utilise le bon code après déploiement
- **Correctif**: Badge `APP_VERSION` dans le header. Constante dans `data.js`, peuplée par `app.js`.
- **Test de non-régression**:
  - [ ] Badge "v289" visible dans le header du site

## BUG-039: Cash page manque Nezha ESPP cash (94€)

- **Version**: v295 (fix)
- **Sévérité**: Moyenne (données)
- **Détection**: Audit automatisé — delta cash page total vs couple cash card
- **Symptôme**: Cash page total (282 202€) ≠ couple cash card (282 296€), delta = 94€ = Nezha ESPP cash USD converti
- **Cause racine**: `computeCashView()` (engine.js ~L1458) listait Amine ESPP cash mais pas Nezha ESPP cash. Le compte Nezha ESPP (cashUSD=109.56) était comptabilisé dans le NW mais absent de la vue Cash détaillée.
- **Correctif**: Ajout d'une entrée `{ label: 'ESPP Cash (Nezha)', native: (p.nezha.espp && p.nezha.espp.cashUSD) || 0, currency: 'USD', yield: CASH_YIELDS.esppCash, owner: 'Nezha' }` dans la liste des comptes de `computeCashView()`.
- **Test de non-régression**:
  - [ ] Cash page total = couple cash card (delta = 0)
  - [ ] Cash page liste Nezha ESPP Cash avec montant non-nul (~94€)
  - [ ] NW couple inchangé (cash breakdown only)

## BUG-040: Créances sub-card — montants nominaux au lieu de pondérés + groupement par champ incorrect

- **Version**: v296 (fix)
- **Sévérité**: Moyenne (données)
- **Détection**: Audit métier — comparaison sub-card total (74 989€) vs contribution NW créances (71 919€)
- **Symptôme**: (1) Sub-card total créances 74 989€ ≠ contribution NW 71 919€ (delta 3 070€). Les montants utilisaient `c.amount` (nominal) au lieu de `(amount - payments) × probability`. (2) Groupement par `c.guaranteed` au lieu de `c.type` — Kenza (type='perso', guaranteed=true) apparaissait sous "Créances pro".
- **Cause racine**: `renderExpandSubs()` (render.js ~L485-530) mappait `eur: toEUR(c.amount, c.currency)` sans déduire les paiements partiels ni appliquer la probabilité. Le groupement utilisait `c.guaranteed` comme proxy de type pro/perso, mais ce champ indique la certitude, pas la catégorie.
- **Correctif**: 
  - L485-507: Chaque item calcule `paymentsTotal`, `remaining = amount - payments`, `eur = toEUR(remaining × probability, currency)` — même formule que engine.js L3587-3589.
  - L516-517: Groupement `type === 'pro'` / `type !== 'pro'` au lieu de `guaranteed` / `!guaranteed`.
  - Appliqué pour les 3 vues (amine, nezha, couple).
- **Test de non-régression**:
  - [ ] Sub-card total créances = contribution NW créances (71 919€, delta = 0)
  - [ ] Kenza apparaît sous "Créances personnelles" (pas "pro")
  - [ ] Abdelkader: montant affiché = 55000 × 0.7 / FX_MAD ≈ 3 539€ (pas 5 056€ nominal)
  - [ ] Akram: montant affiché = 1500 × 0.7 = 1 050€ (pas 1 500€ nominal)
  - [ ] Omar (Nezha): montant = 40000 × 0.7 / FX_MAD ≈ 2 574€

## BUG-041: Sub-cards immo CRD détail écrasé par updateAllDataEur()

- **Version**: v296 (fix)
- **Sévérité**: Moyenne (affichage)
- **Détection**: Audit automatisé — innerHTML des éléments subVitryCrdDetail/subRueilCrdDetail/subVillejuifCrdDetail
- **Symptôme**: Les sub-cards immo affichaient seulement "€ 300 000" (valeur) au lieu de "€ 302 257 (2%/an)\nCRD € 267 213" (valeur + CRD). L'information CRD était invisible.
- **Cause racine**: `renderExpandSubs()` (L629) appelait `setHTML(id, value + CRD)` pour injecter le détail HTML. Mais `updateAllDataEur()` (L1147-1153), exécuté APRÈS (L276), itérait tous les `[data-eur]` et écrasait `textContent` avec juste `fmt(data-eur)`, détruisant le HTML injecté.
- **Correctif**: 
  - index.html: ajout `data-type="html"` sur les 3 spans (subVitryCrdDetail, subRueilCrdDetail, subVillejuifCrdDetail)
  - render.js L1148: `updateAllDataEur()` skip maintenant `data-type="html"` (comme `data-type="pct"`)
- **Test de non-régression**:
  - [ ] Sub-card Vitry affiche "€ 302 257 (2%/an)\nCRD € 267 xxx"
  - [ ] Sub-card Rueil affiche "€ 281 xxx\nCRD € 193 xxx"
  - [ ] Sub-card Villejuif affiche "€ 374 xxx\nCRD € 325 xxx"

## BUG-042: Immo CRD mensuel au lieu de prorata journalier

- **Version**: v296 (amélioration)
- **Sévérité**: Basse (précision)
- **Détection**: Demande utilisateur
- **Symptôme**: Le CRD (Capital Restant Dû) ne changeait qu'au 1er de chaque mois (saut mensuel). L'équité immobilière restait constante pendant tout le mois, puis sautait au mois suivant.
- **Cause racine**: `computeImmoView()` (engine.js ~L2570) utilisait `amort.schedule[currentIdx].remainingCRD` qui est le CRD à la fin du mois courant (après mensualité). Pas d'interpolation entre les mois.
- **Correctif**: Interpolation linéaire journalière entre le CRD début de mois (`schedule[idx-1].remainingCRD`) et fin de mois (`schedule[idx].remainingCRD`) basée sur `(dayOfMonth - 1) / daysInMonth`. Ex: le 14 avril, fraction ≈ 43%, CRD = début − (début−fin) × 0.43.
- **Test de non-régression**:
  - [ ] Le 1er du mois : CRD ≈ CRD fin mois précédent
  - [ ] Le 15 du mois : CRD ≈ moyenne entre début et fin de mois
  - [ ] Vitry CRD < CRD statique 268 061€ (reflète l'amortissement partiel d'avril)
  - [ ] invariant couple NW = amine NW + nezha NW respecté (delta = 0)
  - [ ] invariant catSum = coupleNW respecté (delta = 0)

---

## BUG-043: Nezha ESPP cost basis — NW utilise current FX, stocks view utilise per-lot historical FX

- **Version**: v297 (fix)
- **Sévérité**: Haute (incohérence de données entre vues)
- **Détection**: Audit métier plus poussé — comparaison P&L non-réalisé Nezha ESPP entre `s.nezha.esppUnrealizedPL` (depuis `compute()`) et `computeActionsView()` côté engine
- **Symptôme**: Deux calculs du même KPI divergeaient lorsque l'EURUSD live s'éloignait du FX historique des lots :
  - `engine.compute()` L3729 : `toEUR(nezhaEsppData.totalCostBasisUSD, 'USD', fx)` — utilise le FX courant
  - `engine.computeActionsView()` L268 : `lots.reduce((s,l) => s + esppLotCostEUR(l, 1.15), 0)` — utilise le FX historique de chaque lot (ou défaut 1.10 pour Nezha, 1.15 pour Amine)
  - Exemple : avec EURUSD live = 1.0936 (vs 1.10 défaut), delta ≈ 50-100€ sur `nezhaEsppUnrealizedPL`, qui se propage dans les insights et la ventilation ESPP.
- **Cause racine**: `esppLotCostEUR` était défini localement dans `computeActionsView` (portée fonction), inaccessible depuis `compute()`. `compute()` utilisait donc la formule courante moins précise.
- **Correctif**: 
  - `engine.js` L33-52 : hoisting de `esppLotCostEUR(lot, defaultFx)` au niveau module. JSDoc explicatif.
  - `engine.js` L253-255 : suppression de la déclaration locale dans `computeActionsView`, commentaire pointant vers le hoisting.
  - `engine.js` L3729-3732 : `compute()` utilise maintenant `(nezhaEsppData.lots || []).reduce((s,l) => s + esppLotCostEUR(l, 1.10), 0)` — formule identique à `computeActionsView`.
- **Test de non-régression**:
  - [ ] `s.nezha.esppUnrealizedPL` = `actionsView.espp.unrealizedPL` (delta = 0)
  - [ ] Les 4 lots Nezha (nov 2023 → août 2025) utilisent bien leur FX historique via `fxRateAtDate`
  - [ ] P&L ESPP Nezha identique entre stock source statique et live

---

## BUG-044: nezhaNW ne contient pas nezhaVillejuifEquity quand l'acte est signé

- **Version**: v297 (fix, latent depuis introduction de villejuifSigned)
- **Sévérité**: Haute (NW owner-level faux quand villejuifSigned=true)
- **Détection**: Audit métier plus poussé — grep de `+ nezhaVillejuifEquity` dans `engine.js`, puis analyse des consommateurs aval de `s.nezha.nw`
- **Symptôme**: Tant que `villejuifSigned=false` : aucun effet (nezhaVillejuifEquity=0). Dès signature :
  - `s.nezha.nw` sous-estimé de ~44K€ (370K valeur − 325K CRD)
  - `coupleNW = amineNW + nezhaNW + nezhaVillejuifEquity` compensait au niveau couple mais pas au niveau owner
  - Insights, breakdowns, splits de propriété, et toute vue utilisant `s.nezha.nw` directement affichaient un NW Nezha faux
  - Test `nezhaNwRefMatchesNezhaNW` aurait cassé à l'activation du signing
- **Cause racine**: `nezhaVillejuifEquity` était un "extra" ajouté uniquement à `coupleNW` (L3810) et à `views.nezha.nwRef` (L3984), jamais à `nezhaNW` (L3748). Construction historique : on voulait garder `nezhaNW` = "patrimoine net sans le bien en cours d'acquisition", mais ça créait une divergence dès signature.
- **Correctif**: 
  - `engine.js` L3762 : `nezhaNW` inclut maintenant `+ nezhaVillejuifEquity`. Quand non signé : 0. Quand signé : valeur complète − CRD.
  - `engine.js` L3775 : `nwWithVillejuif = nezhaNW - nezhaVillejuifEquity - nezhaVillejuifReservation + nezhaVillejuifFutureEquity` (évite double comptage : on soustrait l'équité actuelle si signée + la réservation si non signée, puis on ajoute l'équité future projetée).
  - `engine.js` L3823 : `coupleNW = amineNW + nezhaNW` (suppression du `+ nezhaVillejuifEquity` redondant).
  - `engine.js` L3999 : `views.nezha.nwRef = nezhaNW` (suppression du `+ nezhaVillejuifEquity`).
- **Test de non-régression**:
  - [ ] `villejuifSigned=false` (cas actuel) : toutes les invariants inchangés (`coupleNW = amineNW + nezhaNW`, `nezhaViewMatchesNwRef = 0`)
  - [ ] Basculer `villejuifSigned=true` temporairement : `coupleNW = amineNW + nezhaNW` reste vrai, `s.nezha.nw` augmente de ~44K
  - [ ] `s.nezha.nwWithVillejuif` ≥ `s.nezha.nw` dans les deux cas (équité future ≥ équité courante)
  - [ ] Insights Nezha affichent le bon NW après signature

---

## BUG-045: Insights `cashCouple` exclut broker cash (IBKR+ESPP) et Nezha UAE cash

- **Version**: v297 (fix)
- **Sévérité**: Moyenne (indicateurs d'insights faux)
- **Détection**: Audit métier — comparaison entre `cashCouple` dans `renderDynamicInsights` et `s.couple.totalCashEUR` (ainsi que la card "Cash" du treemap)
- **Symptôme**: 
  - `cashCouple` dans les insights positifs (render.js L761-765) = UAE + Revolut + Maroc Amine + France Nezha + Maroc Nezha. Manquait : Amine broker cash (IBKR+ESPP, ~2K€), Nezha broker cash (ESPP, ~94€), Nezha UAE cash.
  - Bloc "risque" (L782-785) utilisait la même définition tronquée → `aedPct = s.amine.uae / cashTotalTronqué` avec dénominateur sous-évalué → AED% surestimé.
  - Les totaux "Tu as X€ en cash" dans les insights affichaient donc un montant inférieur au vrai cash couple.
- **Cause racine**: Les champs `s.amine.brokerCash`, `s.nezha.brokerCash`, et `s.nezha.cashUAE` ont été ajoutés récemment (reclassification cash courtier, cash Nezha UAE) mais `renderDynamicInsights` n'a pas été mis à jour. Le treemap et le NW étaient cohérents, seuls les insights étaient en retard.
- **Correctif**: 
  - `render.js` L761-765 : `cashAmine = s.amine.uae + s.amine.revolutEUR + s.amine.moroccoCash + (s.amine.brokerCash || 0)`, `cashNezha = s.nezha.cashFrance + s.nezha.cashMaroc + (s.nezha.cashUAE || 0) + (s.nezha.brokerCash || 0)`, `cashCouple = cashAmine + cashNezha`.
  - `render.js` L782-787 : mêmes expressions appliquées au bloc "risque" pour cohérence.
- **Test de non-régression**:
  - [ ] Insights positifs : `cashCouple` = couple.totalCashEUR (match exact)
  - [ ] Insights risque : `aedPct = s.amine.uae / cashTotalVrai` — pourcentage inférieur à avant la correction
  - [ ] Pas de régression du NW treemap (les insights n'affectent pas le NW)

---

## BUG-046: Chart header %Change faux quand owner=Nezha + scope=IBKR/Degiro/SGTM

- **Version**: v297 (fix)
- **Sévérité**: Haute (chiffres visibles dans le header du chart)
- **Détection**: Audit métier poussé — test manuel du header %change en basculant owner/scope
- **Symptôme**: Le header du chart (plPct, capitalDeployed) utilisait `depSeries` couple-level même quand `refValue` et `mainSeries` étaient filtrés per-owner. Exemples : 
  - Owner=Nezha + Scope=IBKR : devrait être 0 (Nezha n'a pas d'IBKR) mais le dénominateur utilisait tous les dépôts IBKR (169K€), rendant plPct infiniment négatif.
  - Owner=Nezha + Scope=Maroc (SGTM) : refValue filtré 50/50 correct, mais deposits = 100% couple → ratio faussé par 2x.
- **Cause racine**: Le filtrage per-owner des séries était câblé uniquement pour `scope === 'espp'` et `scope === 'all'`. Pour IBKR/Degiro (100% Amine) et Maroc (SGTM 50/50), `depSeries` restait couple-level alors que les autres séries étaient filtrées.
- **Correctif**: `charts.js` L2299-2318 — après sélection de `depSeries` selon scope, application d'un `ownerRatio` :
  - IBKR / Degiro : Amine → 1, Nezha → 0
  - Maroc (SGTM) : ratio basé sur `PORTFOLIO.*.sgtm.shares` (actuellement 32/32 = 50%, dynamique si mis à jour)
  - ESPP / All : déjà géré en amont par les séries per-owner (chartValuesESPPAmine, etc.)
- **Test de non-régression**:
  - [ ] Owner=Nezha + Scope=IBKR : depSeries = [0, 0, …] et plPct finit à 0 (pas de division)
  - [ ] Owner=Nezha + Scope=Degiro : idem
  - [ ] Owner=Nezha + Scope=Maroc : depSeries = 50% de la série couple, plPct cohérent avec NAV × 50%
  - [ ] Owner=Amine + Scope=IBKR : depSeries = série couple intacte (ratio 1)
  - [ ] Basculer Couple→Amine→Nezha en scope IBKR : plPct et capitalDeployed se mettent à jour instantanément

---

## BUG-047: Cash Dormant exclut wioCurrent si négatif → treemap invariant cassé

- **Version**: v297 (fix)
- **Sévérité**: Moyenne (risque d'invariance cassée en cas de découvert)
- **Détection**: Audit métier — recherche de dissymétrie entre `amineCashTotal` et les sub-cards "Cash Dormant"
- **Symptôme**: Si `p.amine.uae.wioCurrent` devenait négatif (découvert), `amineCashTotal` le prenait avec son signe (L3655), mais :
  - Catégorie "Cash Dormant" couple (L3908-3923) le zérait via `> 0 ? toEUR(...) : 0`
  - Même logique appliquée dans la vue amine (L4068)
  - Conséquence : `views.X.cash < amineCashTotal` → invariant `stocks+cash+immo+other = nwRef` cassé
  - Aujourd'hui non observé car `wioCurrent = 371 AED > 0`, mais régression latente.
- **Cause racine**: Check `wioCurrent > 0` conçu pour cacher les montants nuls dans le sub-array, étendu par erreur au total de la catégorie.
- **Correctif**: 
  - `engine.js` L3910, L4071 (totaux) : `toEUR(p.amine.uae.wioCurrent, 'AED', fx)` sans guard.
  - `engine.js` L3953, L4076 (sub-arrays) : remplacement de `> 0` par `!== 0` — un découvert non-nul est affiché, mais zéro reste caché.
- **Test de non-régression**:
  - [ ] `wioCurrent > 0` (cas actuel) : aucun changement visuel, treemap invariant OK
  - [ ] Simuler `wioCurrent = -500` : total Cash Dormant diminue de 500 AED × FX, entrée sub-card affichée avec signe négatif, invariant toujours OK
  - [ ] Simuler `wioCurrent = 0` : entrée sub-card masquée, total non impacté (0)

---

## BUG-048: Chart label de référence dit "NAV 1er jan" même en période MTD/1M/3M

- **Version**: v297 (fix)
- **Sévérité**: Basse (affichage trompeur)
- **Détection**: Audit UX — clic sur les boutons de période
- **Symptôme**: La ligne pointillée horizontale (référence NAV au début de la période) affichait toujours "NAV 1er jan (€ X)" même quand `period=MTD`, `1M`, ou `3M`. La valeur était correcte (refValue bien slicé à `startIdx`), mais le label ne reflétait pas la période.
- **Cause racine**: `charts.js` L2416 hard-codé `data.mode === '1y' ? 'NAV début 1Y' : 'NAV 1er jan'` — pas de branche pour les sous-filtres de période.
- **Correctif**: `charts.js` L2434-2444 — label calculé par switch sur `period` (MTD, 1M, 3M, YTD) puis par `data.mode` (1y, 5y, max) :
  ```javascript
  period === 'MTD' ? 'NAV début mois' :
  period === '1M'  ? 'NAV il y a 1M' :
  period === '3M'  ? 'NAV il y a 3M' :
  period === 'YTD' ? 'NAV 1er jan' :
  (data.mode === '1y' ? 'NAV début 1Y' :
   data.mode === '5y' ? 'NAV début 5Y' :
   data.mode === 'max' ? 'NAV début' : 'NAV 1er jan')
  ```
- **Test de non-régression**:
  - [ ] Période MTD : label = "NAV début mois (€ X)"
  - [ ] Période 1M : label = "NAV il y a 1M (€ X)"
  - [ ] Période 3M : label = "NAV il y a 3M (€ X)"
  - [ ] Période YTD : label = "NAV 1er jan (€ X)"
  - [ ] Mode 1Y (via bouton) : label = "NAV début 1Y (€ X)"
  - [ ] Mode 5Y / MAX : labels "NAV début 5Y" / "NAV début"
  - [ ] `refValue` affiché dans le label = première valeur des séries filtrées (invariant)

---

## BUG-049: Simulators — taux mensuel = r/12 au lieu de (1+r)^(1/12) − 1

- **Version**: v297 (fix)
- **Sévérité**: Moyenne (projection 20 ans biaisée à la hausse)
- **Détection**: Audit métier — code review des simulateurs "20 ans"
- **Symptôme**: Les simulateurs (Amine+Nezha couple et Nezha seule) utilisaient `monthlyReturn = annualReturn / 12`. Composé 12 fois, ça donne un rendement annuel effectif supérieur à celui affiché :
  - 10%/an input → 10%/12 = 0.833%/mo → (1.00833)^12 = 1.1047 → 10.47% effectif/an
  - Overshoot +47bp/an, sur 20 ans sur un portefeuille actions de 150K € : écart final ~60K€ en faveur du simulateur (trop optimiste).
- **Cause racine**: Approximation "APR/12" classique — acceptable pour des durées courtes ou des taux faibles, mais inadaptée pour un simulateur 20 ans avec rendements 5-10%.
- **Correctif**: 
  - `simulators.js` L57-61 (`runSimulatorGeneric`) : `monthlyReturnActions = Math.pow(1 + returnActions, 1 / 12) - 1`, idem pour cash.
  - `simulators.js` L679-681 (`runNezhaSimulator`) : même fix pour cash, et nouvelle variable `monthlySgtmReturn = Math.pow(1.07, 1/12) - 1` au lieu de `0.07/12` hard-codé.
- **Test de non-régression**:
  - [ ] Simulateur 20 ans avec rendements à zéro (cash=0%, actions=0%) : NW final = NW initial + contributions (pas d'intérêts)
  - [ ] Simulateur avec 10% actions : NW final légèrement inférieur à la version pré-fix (baisse d'environ 5-10%)
  - [ ] Cohérence : `Math.pow(1 + monthlyReturn, 12) === annualReturn + 1` (±1e-10)
  - [ ] Simulateur Nezha seul : sgtm pousse exactement à 7% annuel effectif

---

## BUG-050: Action Logement (AL) — principal amorti inclut l'assurance intégrée

- **Version**: v297 (fix)
- **Sévérité**: Moyenne (CRD AL sous-estimé sur la durée)
- **Détection**: Audit métier — vérification cohérence échéance AL 145.20€ vs tableau d'amortissement
- **Symptôme**: L'échéance AL de 145.20€/mois inclut :
  - 141.87€ de capital+intérêts (P&I)
  - 3.33€ d'assurance intégrée (payée dans l'échéance, non en plus)
  
  Le code `computeSubLoanSchedule` traitait les 145.20€ comme full P&I, donc `principalPart = 145.20 − interest`. Sur 300 mois, cela sur-amortit le principal de ~3.33€×300 = 1000€, aboutissant à CRD=0 plusieurs mois trop tôt.
- **Cause racine**: Champ `loan.insuranceMonthly` lu pour l'affichage mais pas pour la logique d'amortissement. Pas de distinction entre assurance intégrée (AL) et assurance externe (APRIL pour PTZ/BP).
- **Correctif**: `engine.js` L1836-1854 (`computeSubLoanSchedule`, branche simple sans périodes) :
  ```javascript
  const insuranceInPayment = loan.insuranceMonthly || 0;
  const effectivePayment = loan.monthlyPayment - insuranceInPayment;
  const principalPart = Math.min(effectivePayment - interest, crd);
  ```
  Le champ `payment` dans le schedule garde l'échéance utilisateur (145.20€) pour l'affichage, mais le calcul d'amortissement utilise 141.87€.
- **Test de non-régression**:
  - [ ] AL durée totale = 300 mois (CRD atteint 0 exactement au mois 300)
  - [ ] Cumul capital amorti = capital initial AL (30 000€)
  - [ ] Cumul intérêts payés ≈ 2 250€ (taux 0.5% × 300 mois simplifié)
  - [ ] Prêts avec `insuranceMonthly=0` (PTZ, BP APRIL) : pas de changement d'amortissement (régression baseline)
  - [ ] CRD mensuel AL au mois M : égal à la formule fermée `P(1+r)^M - (M·P&I)·((1+r)^M - 1)/r`

---

## BUG-051: Animation montagne — 2 phases avec overshoot + saut visible

- **Version**: v298 (refonte)
- **Sévérité**: Moyenne (UX trompeuse)
- **Détection**: Retour utilisateur — "ça avance lentement puis s'arrete à 532k puis boom avance encore plus vite à la position finale"
- **Symptôme**: L'animation de la montagne se déroulait en 2 phases :
  - **Phase 1** (18s) : montée lente ease-out quad vers `STATIC_EUR × 0.80 = 532 776€`
  - **Phase 2** (1.8s) : ajustement rapide ease-out cubic vers la vraie valeur
  
  Deux défauts visibles :
  1. Overshoot : quand `realValue < 532K` (cas Amine seul ≈ 412K), le couple montait jusqu'à 532K puis **descendait** en Phase 2 — visuellement incohérent pour une "progression".
  2. Saut perçu : transition discontinue en vitesse entre les deux phases (accélération/décélération différentes), donnant l'impression d'un "stop-and-go".
- **Cause racine**: Design en deux phases avec cible intermédiaire basée sur `STATIC_EUR` (estimation obsolète par construction) :
  - `PHASE1_TARGET_EUR = STATIC_EUR × 0.80` figé à chaque release
  - Le délai de 18s de Phase 1 était sensé couvrir le chargement API, mais finissait par être overshoot pour les utilisateurs rapides
  - Pas de garantie que `realValue > PHASE1_TARGET_EUR` (couple/amine-only/nezha-only varient largement)
- **Correctif**: Refonte complète en state machine à 4 phases + animation unique :
  - `waiting` : compteur pulse (CSS `counterPulse` 1.6s), aucun mouvement. Dure jusqu'à `_gridAnimationComplete()` ou timeout.
  - `ambient` (optionnel) : après `AMBIENT_START_DELAY_MS=1200`, si données pas prêtes, montée asymptotique plafonnée à `AMBIENT_CAP_RATIO=0.08` (80K€). Safe par construction : toujours < realValue.
  - `animating` : **animation unique** ease-in-out cubic de `currentRatio → realValue/TARGET`. Durée **adaptative** `ANIM_DURATION_MIN..MAX = 1800..2800ms` selon la distance. `startRatio = currentRatio` → continuité parfaite depuis `ambient`.
  - `done` : bloc vélocité apparaît, invariants vérifiés.
  
  Safety net : `DATA_TIMEOUT_MS=5000` fallback sur `STATIC_EUR` si les données ne sont pas arrivées.
  Suppression complète de `PHASE1_RATIO`, `PHASE1_TARGET_EUR`, `PHASE1_DURATION_MS`, `PHASE2_DURATION_MS`, `phase1Done`, `phase2StartTime`, `startPhase1`, `startPhase2`.
- **Test de non-régression**:
  - [ ] Animation monotone : pour tout `realValue`, la valeur du compteur est strictement non-décroissante (sauf si déjà > target, cas impossible ici car cap 1M€)
  - [ ] `realValue < 532K` (ex : Amine-only 412K) : couple monte directement à 412K, pas d'excursion au-dessus
  - [ ] `realValue > 700K` : transition douce, durée > 1.8s (adaptée)
  - [ ] Timeout fallback : si `_gridAnimationComplete` n'est jamais appelée, animation vers `STATIC_EUR` après 5s
  - [ ] Ambient : si données > 1.2s mais < 5s, animation ambient visible puis interrompue sans jerk par l'animation finale
  - [ ] Log `[mountain] Final animation start` apparaît une seule fois
  - [ ] Log `Animation parity ok` (drift < 0.5% entre `currentRatio` et `realValue/TARGET`)
  - [ ] Pas de log `Phase 1 done` ou `Phase 2 start` (confirme suppression)

---

## BUG-052: Animation auth-gate — variante "machine à sous" + audit UX complet

- **Version**: v301 (ajout)
- **Sévérité**: Mineure (nouvelle feature + audit de polish)
- **Détection**: Demande utilisateur — "make a second animation of a casino machine that loads till the numbers keep turning till it's loaded. Make either the mountain or machine appear randomly on first page."
- **Symptôme / contexte**: Avant v301, l'animation d'attente du gate était une unique variante (montagne). L'utilisateur voulait une 2e variante casino-style en sélection aléatoire, pour que chaque chargement soit surprenant.
- **Implémentation**:
  1. **Module pattern partagé** : les deux animations exposent le même contrat `{ init, trigger, hide }` via `window._mountainAnim` et `window._slotAnim`. Un IIFE externe (wrap de scope) expose UNIQUEMENT ces 2 objets + `window._gridAnimationComplete` au global.
  2. **AnimKit namespace** : constants (`TARGET_EUR`, `TARGET_DATE`, `STATIC_EUR`, `DATA_TIMEOUT_MS`) + helpers (`formatEur`, `formatEurShort`, `renderVelocityLines`, ETA math) factorés pour éviter la duplication entre modules.
  3. **Slot machine** : cabinet dark blue + bordure gold, 3 LEDs wave-pulse, 8 reels (jusqu'à 99 999 999€) groupés `XX XXX XXX`, strip de 11 digits (0-9+0) pour wrap sans trou visuel, ease-out-quart decel, cascade gauche→droite avec stagger 150ms. Flash vert de la cabinet au `is-done` + base-glow vert.
  4. **Sélecteur random 50/50** : `Math.random() < 0.5` avec override URL `?anim=mountain|slot` pour tests. Cache le non-sélectionné (`display:none`), init le choisi, route `_gridAnimationComplete` dessus.
  5. **Audit triple parallèle** (physics / visual / code-quality) via sub-agents avant commit. 13 findings majeurs → appliqués :
     - **Physics** : formule de rotations INVERSÉE (avant : leftmost 3.6 rot = kick 18× la vitesse de spin ; après : leftmost 0.8 rot → rightmost 2.9 rot, kick ~5×). Stagger cohérent avec distance (reel qui lock en dernier a plus d'anticipation + plus de rotations = reveal plus satisfaisant).
     - **Visual** : halo externe retiré, `.slot-sep` 6px→10px (lisibilité des triplets "XX XXX XXX"), letter-spacing -0.5→0 (money counter wider), 5 LEDs→3 (moins frénétique), base-glow désaturé en warm-white pendant spin puis vert au done, flash brightness 0.6s au reveal, aspect-ratio:1.2 retiré (cabinet hugge le contenu, plus d'espace vide).
     - **Code** : rAF stop une fois `done && animationFullyDone` (CPU leak évité), `dt` clampé à 100ms (anti-snap après réveil d'onglet), IIFE externe pour éviter collision globale `const AnimKit`, guard double-init et double-trigger, guard `!hasInit` défensif dans trigger, null-guard `#slotContainer`, aria-live polite qui annonce la valeur finale aux screen readers, reset opacité avant dim des leading zeros, prefers-reduced-motion (JS+CSS, fige les reels à `00 000 000`), fallback measurement si `getBoundingClientRect().height===0` (race avec CSS clamp).
  6. **Timeout fallback bumpé 5s→12s** (AnimKit.DATA_TIMEOUT_MS) : sur cold-cache le pipeline app.js peut prendre ~7-10s ; 5s déclenchait le fallback avant l'arrivée des vraies données. Touche aussi la montagne (shared).
  7. **Re-lock defensive** : si trigger arrive APRÈS le fallback (phase='done') et la valeur diffère, la slot reset les reels et relance une cascade vers la vraie valeur. Corrige le "stale STATIC_EUR forever" qui aurait persisté sinon.
- **Test de non-régression**:
  - [ ] Random selector : ~50% mountain, ~50% slot sur 10 reloads
  - [ ] URL override : `?anim=mountain` force mountain, `?anim=slot` force slot
  - [ ] Slot cascade : les 8 reels locked gauche→droite avec stagger visible (~1.5-2s total)
  - [ ] Leading zeros dimmés pour valeurs < 10M€ (ex: "00 699 804" → les deux "0" à opacity 0.32)
  - [ ] Cabinet reçoit `.is-done` + flash brightness ~0.6s au reveal, base-glow devient vert
  - [ ] Late data arrival : si app.js prend > 12s, slot lock sur STATIC_EUR, puis re-lock sur vraie valeur dès qu'elle arrive (log `Re-locking from stale ...`)
  - [ ] prefers-reduced-motion : reels figés à "00 000 000" pendant attente, pas de spin
  - [ ] Aria : `#slotSrLive` contient `"Patrimoine actuel : € X XXX"` une fois locked
  - [ ] Pas de log d'erreur JS à aucun moment
  - [ ] Sur iPhone SE 320px : cabinet rentre dans 256px (80vw), pas de débordement horizontal
  - [ ] Mountain continue de fonctionner identiquement à v298 (module pattern non-cassant)
  - [ ] Pas de flash de variant non-sélectionnée (les deux commencent `display:none`, le sélecteur révèle la bonne)

---

## BUG-053: Déposé ESPP incohérent entre chart modes (FRAC lot `contribEUR=0` falsy)

- **Version**: v302 (corrigé)
- **Sévérité**: Moyenne (incohérence visible dans les tooltips — P&L réel côté engine n'est PAS affecté)
- **Détection**: Retour utilisateur — "bug sur le calcul de P&L, la valeur finale est différente selon le graph affiché". Capture d'écran :
  - Tooltip MAX au 17/04/2026 : NAV €243 701, Déposé €189 615, P&L +€54 086
  - Tooltip YTD au 17/04/2026 : NAV €243 298, Déposé €190 326, P&L +€52 972
  - Différence : ΔDéposé = 711€, ΔNAV = 403€ (résiduel non corrigé par v302, voir ci-dessous)
- **Symptôme**: À date identique (aujourd'hui), le tooltip affiche des Déposé/NAV/P&L différents selon la période visualisée (YTD vs 1Y vs MAX). Mathématiquement cohérent par période (NAV − Déposé = P&L) mais le snapshot "aujourd'hui" devrait être unique.
- **Cause racine**: `PORTFOLIO.amine.espp.lots` contient 1 lot `source: 'FRAC'` (3 shares reçues via dividendes réinvestis ~août 2022) avec `contribEUR: 0` — "aucune contribution salariale, c'est un réinvestissement de dividende" (data.js L145). Les 6 call-sites ESPP dans `charts.js` utilisaient le pattern `if (lot.contribEUR) { push(contribEUR) } else { push(fallback_via_fxRate) }`. Comme `0` est falsy en JavaScript, le lot FRAC tombait dans le `else` et générait un dépôt fantôme de `(3 × 272.36) / 1.15 ≈ 710.5€`.
  - `buildEquityHistoryChart` (MAX path, L4376) utilisait `if (lot.contribEUR) { push }` SANS `else` → skippait FRAC correctement par chance
  - `computeAbsoluteTooltipArrays` (YTD path, L1938) avait un `else` → 710€ phantom
  - `computeAbsoluteTooltipPerOwnerESPP` (per-owner YTD, L2058) : idem phantom
  - `buildEquityHistoryChart` (per-owner Amine, L4424) : idem phantom
  - Les deux call-sites Nezha du même pattern n'étaient pas buggés en pratique (Nezha n'a pas de FRAC) mais étaient fragiles.
- **Correctif**: Helper `_esppLotDeposit(lot, fallbackFx)` qui centralise la sémantique correcte :
  - `lot.source === 'FRAC'` → `return null` (skip)
  - `lot.contribEUR != null && lot.contribEUR > 0` → dépôt exact
  - `lot.contribEUR === 0` → `return null` (zéro explicite, skip)
  - `lot.contribEUR == null` → fallback `(shares × costBasis) / (fxRateAtDate || fallbackFx)`
  Appliqué aux 6 call-sites (charts.js).
- **Résidu non corrigé**: ΔNAV ~403€ restant entre MAX et YTD vient du replay alltime-from-zero dans MAX (STARTING_NAV=0, cashEUR=0) vs YTD calibré avec `IBKR_EUR_START_OVERRIDE=-17534` (traced depuis CSV IBKR). Commentaire charts.js L2842-2843 : "EUR cash previously derived as residual → accumulated ~1,534€ error due to Yahoo FX rates differing from IBKR's. Using traced value eliminates this drift." Fixer cela requiert un refactor architectural (unifier alltime avec calibration IBKR) et est documenté comme tech debt.
- **Test de non-régression**:
  - [ ] Tooltip MAX vs YTD au jour courant : ΔDéposé ≈ 0 (était 711€)
  - [ ] Tooltip 1Y vs YTD au jour courant : ΔDéposé ≈ 0
  - [ ] P&L total au jour courant : même valeur quel que soit le mode (MAX/1Y/YTD) modulo le drift NAV résiduel (~400€)
  - [ ] Grep `lot\.contribEUR` dans `js/charts.js` : aucun call-site ne doit utiliser `if (lot.contribEUR) { ... } else { ... }` — tous passent par `_esppLotDeposit`
  - [ ] Le lot FRAC de Amine (2022-08-15, contribEUR: 0) n'apparaît dans AUCUNE série de dépôts cumulés
  - [ ] engine.js `esppLotCostEUR` inchangé (utilise `!== undefined` qui est déjà correct)
  - [ ] NW total (page patrimoine) inchangé — le helper ne change pas la comptabilité côté engine, juste les séries chart

---

## Matrice de couverture par fonctionnalité

| Fonctionnalité | Bugs liés | Tests critiques |
|---|---|---|
| **Boutons période** (MTD/1M/3M/YTD/1Y/5Y/MAX) | BUG-001, BUG-007, BUG-009, BUG-013 | Tous les boutons répondent, données correctes par mode |
| **Boutons scope** (IBKR/ESPP/Maroc/Degiro/Tous) | BUG-001, BUG-013 | Chaque scope affiche les bonnes séries |
| **Boutons owner** (Couple/Amine/Nezha) | BUG-001, BUG-005, BUG-006, BUG-013 | Courbes distinctes, tooltips cohérents |
| **KPI cards** (NAV, Déposé, P&L, %) | BUG-002, BUG-010, BUG-020 | Formule P&L = NAV - Déposé vérifiée, ESPP cash inclus |
| **Barre de progression** | BUG-003, BUG-004 | Progression dynamique, chart visible après |
| **Tooltip hover** | BUG-006, BUG-018 | Valeurs per-owner correctes, delta calculé depuis start NAV per-owner |
| **Click detail panel** | BUG-006, BUG-011, BUG-035 | Breakdown par position exact, notes 5Y/MAX correctes |
| **Cache/deploy** | BUG-008, BUG-036, BUG-038 | Version cohérente, badge version visible, pas de stale JS |
| **ESPP per-owner** | BUG-005 | Formes différentes, Nezha = 0 avant nov 2023 |
| **Chart init** | BUG-003, BUG-013 | Chart visible après chargement, pas de canvas vide |
| **Comptabilité Degiro** (compte clôturé) | BUG-002, BUG-010, BUG-014 | Dépôts nets négatifs autorisés, cohérence NAV−Déposé = P&L Réalisé+Non Réalisé |
| **Créances (vue)** | BUG-015, BUG-016, BUG-019, BUG-023, BUG-040 | Actives séparées des recouvrées, dettes visibles, sub-card filtrée, montants pondérés prob |
| **NW Breakdown / KPI cards** | BUG-017, BUG-022 | Tous les composants NW dans les breakdowns (incl. villejuifReservation Nezha) |
| **NW Calcul** | BUG-020, BUG-033, BUG-039 | ESPP cash inclus, Nezha créances dynamiques, Cash page = Cash card |
| **Immobilier sub-cards** | BUG-041, BUG-042 | CRD détail visible, prorata journalier, equity lisse |
| **Charts geo** | BUG-029 | Allocation calculée dynamiquement depuis positions |
| **Event listeners** | BUG-021 | Pas de duplication après refresh |
| **Dividendes projection** | BUG-024, BUG-026 | WHT rates corrects, positions vendues exclues |
| **Insights tooltips** | BUG-030 | Valeurs dynamiques, pas hardcodées |
| **P&L FX decomposition** | BUG-037 | FX P/L colonne visible, positions EUR = "—", positions USD/JPY = valeur non nulle |
| **ESPP cost basis unicité** | BUG-043 | NW et stocks view utilisent `esppLotCostEUR` partagé |
| **Villejuif signed NW** | BUG-044 | `nezhaNW` inclut `villejuifEquity`, `coupleNW = amineNW + nezhaNW` sans extra |
| **Insights cash couple** | BUG-045 | Cash couple = uae+revolut+maroc+france+brokerCash (tous buckets) |
| **Chart header owner-ratio** | BUG-046 | Deposits series filtrées par owner pour IBKR/Degiro (1/0) et SGTM (shares ratio) |
| **Cash Dormant signé** | BUG-047 | `wioCurrent` sommé sans guard `>0`, treemap invariant protégé |
| **Chart reference label** | BUG-048 | Label de la ligne de référence reflète la période (MTD/1M/3M/YTD/…) |
| **Simulator compounding** | BUG-049 | Taux mensuel = geometric root, `(1+monthly)^12 = 1+annual` |
| **Action Logement amort** | BUG-050 | Assurance intégrée retirée du P&I avant amortissement |
| **Animation montagne** | BUG-051 | Une animation unique monotone, durée adaptative, pas de saut Phase1→Phase2 |
| **Animation auth-gate (variantes)** | BUG-052 | Slot-machine comme alternative, random selector, module pattern, audit physics/visual/code |
| **Tooltip Déposé chart** | BUG-053 | `_esppLotDeposit` helper unique pour les 6 call-sites, skip FRAC + `contribEUR=0`, pas de fallback phantom |

---

*Dernière mise à jour: v302 — 17 avril 2026 (BUG-053 : fix phantom deposit FRAC lot `contribEUR=0` falsy → 711€ de divergence tooltip YTD vs MAX. Helper `_esppLotDeposit` unique pour les 6 call-sites dans charts.js.)*
