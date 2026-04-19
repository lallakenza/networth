# Bug Tracker — Dashboard Patrimonial

Ce document recense tous les bugs détectés, leur cause racine, le mode de détection, et le correctif appliqué.
Il sert de base pour le plan de tests de non-régression.

---

## BUG-063: Débordement mobile systémique — 13 tableaux non wrappés (audit post-v326)
- **Version**: Cumulatif (chaque tableau introduit depuis v1), v327 (corrigé en masse)
- **Sévérité**: Moyenne/Haute (page entière déborde horizontalement sur iPhone → toutes les vues affectées)
- **Détection**: Retour utilisateur post-v326 : « y a plein d'autres tableaux/documents sur toutes les pages qui ont une largeur supérieure et par conséquent qui font que la page est plus large et n'est pas bien affichée ». Après que v326 ait corrigé le tableau « Toutes les Positions », l'utilisateur a fait le tour des autres vues et constaté que le débordement affectait en cascade Couple, Actions, Cash, Immobilier, Créances, Budget, Plan-Fiscal, Property Detail.
- **Symptôme**: Sur iPhone 375-430px, chaque tableau ≥ 5 colonnes faisait déborder son parent. Le `body { overflow-x: hidden }` (ligne ~888) masquait visuellement le débordement mais les cellules wrappaient sur 2-3 lignes (comme BUG-062 mais multiplié par 13 tableaux). La conséquence visible : page globalement « trop large », layout cassé, zoom automatique inconsistant.
- **Cause racine**: Pattern historique inconsistant. Les tableaux ajoutés successivement (v1 → v325) n'ont pas tous reçu le wrapper responsive. Seuls 6 tableaux avaient été wrappés en v229 (Plan Objectifs, Sensibilité, Calendrier Fiscal, Loyer Vitry, PV Vitry, Rapatriement) + 1 en v321 (Financement) + 1 en v326 (Positions). Les 13 autres tableaux étaient encore bare :
  - HIGH : #whtTable (9 cols), #fiscalTable (9 cols), #allClosedTable (8 cols), propDetailLoans dynamique, pdFiscalTable dynamique
  - MEDIUM : #immoLoansTable (7), #amortSummaryTable (8), #creancesTable (8), #cashTable (8), #cfProjectionTable (5), #budgetTable (7), immoCFTable dynamique (10 !)
  - LOW : #immoTable (7), #dettesTable (5), #recoveredTable (7)

  Plus : 4 tableaux dynamiques render.js (`overflow-x:auto` + `width:100%`) où le `width:100%` empêche le scroll de se déclencher — la table se rétrécit au lieu de déborder. Le scroll ne s'active jamais.
- **Correctif** (index.html + render.js) :
  1. **Pattern universel** : classe `.table-wrap` avec CSS variable `--tbl-min` paramétrable.
     ```css
     .table-wrap { overflow-x: auto; max-width: 100%; }
     .table-wrap > table { min-width: var(--tbl-min, 600px); }
     ```
  2. **13 tableaux statiques HTML** wrappés dans `<div class="table-wrap" style="--tbl-min:Xpx">` avec valeur calibrée par nombre de colonnes (520px pour 5 cols, 680-740px pour 7 cols, 820-900px pour 8-9 cols).
  3. **5 tableaux dynamiques render.js** : ajout de `min-width:Xpx` sur le `<table>` (préserve le comportement desktop via `width:100%`, force le scroll mobile). Locations : lignes 4884 (propDetailLoans), 5164 (pdFiscalTable), 5356 (propDetailLoans #2), 5610 (Jeanbrun comparison), 5649 (Exit projection).
  4. **immoCFTable** (10 cols dynamique, ~4475) : wrappé dans `.table-wrap` généré inline dans l'innerHTML avec `--tbl-min:960px`.
  5. 3 IDs ajoutés à des tableaux anonymes pour le CSS ciblé (`#whtTable`, `#fiscalTable`, `#immoLoansTable`, `#amortSummaryTable`).
- **Alternatives rejetées**:
  - **Blanket CSS `display:block` sur toutes les tables mobile** : casse `table-layout`, désaligne thead/tbody, casse le scroll-shadow, impacte le tri data-sort. Rejeté au profit du wrapper qui conserve le comportement natif.
  - **Wrap via selector générique `.card table`** : risque de wrapper des tableaux 2-3 cols qui n'en ont pas besoin et d'ajouter un scroll horizontal inutile. Rejeté au profit d'un wrap explicite table-par-table.
- **Test de non-régression** (iPhone 375px + 390px + 430px) :
  - [ ] Vue Couple : #immoTable scroll horizontal ok, pas de wrap vertical dans les cellules
  - [ ] Vue Actions : #allClosedTable + #whtTable scroll ok, KPI strip WHT (4 cols) responsive
  - [ ] Vue Cash : #cashTable 8 cols scroll ok, valeurs natives « 5000 USD » et yields « 4.5% » sur une ligne
  - [ ] Vue Immobilier (sous-vues Synthèse) : #immoLoansTable + #amortSummaryTable + #fiscalTable scroll ok
  - [ ] Vue Immobilier (Cash Flow) : immoCFTable 10 cols scroll ok (v327 wrapped inline dans render.js)
  - [ ] Vue Immobilier (CF Projection) : #cfProjectionTable scroll ok (même si 5 cols, années peuvent être longues)
  - [ ] Vue Créances : #creancesTable + #dettesTable + #recoveredTable tous scrollent individuellement
  - [ ] Vue Budget : #budgetTable 7 cols scroll ok, fréquences affichées sur 1 ligne
  - [ ] Property Detail (Vitry/Rueil/Villejuif) : propDetailLoans + pdFiscalTable + Jeanbrun + Exit projection tous scrollent
  - [ ] Desktop ≥ 1024px : aucun changement visuel, pas de scrollbar horizontale parasite (min-width < card width)
  - [ ] Tablette 600-900px : comportement natif correct, wrappers n'activent leur scroll que si min-width > parent
  - [ ] Tri data-sort sur toutes les colonnes toujours fonctionnel après wrap (vérifier que le clic sur `<th>` est intercepté correctement dans le wrapper)

---

## BUG-061: Dropdown « Analyse » invisible sur iPhone (iOS Safari containing-block bug)
- **Version**: v320 (dropdown introduit), v321 (refonte mobile `position: fixed`), v326 (corrigé)
- **Sévérité**: Haute (fonctionnalité complète inaccessible sur mobile — 4 vues « Créances / Budget / Financement / Plan & Fiscalité » inatteignables depuis iPhone)
- **Détection**: Retour utilisateur « liste analyse s'affiche pas » avec screenshot iPhone en 01:46. Le caret tournait bien (▼ → ▲) et `aria-expanded` passait à `true`, mais les 4 items du menu n'étaient jamais affichés.
- **Symptôme**: Sur iPhone (Safari, iOS 16+), taper sur le toggle « Analyse » dans la barre de nav mettait bien à jour l'état visuel du toggle (caret retourné, surligné) mais le dropdown-menu restait invisible. Les 4 sous-vues devenaient donc totalement inaccessibles depuis mobile. Fonctionnement correct sur Chrome DevTools émulation mobile (fausse assurance).
- **Cause racine** (index.html:1010, @media max-width 480px) :
  ```css
  .view-switcher {
    flex-wrap: nowrap !important;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;  /* ← source du bug */
    ...
  }
  ```
  **Quirk iOS Safari** : depuis iOS 5, `-webkit-overflow-scrolling: touch` active le momentum scrolling hardware-accelerated. Effet de bord non documenté dans la spec CSS : le navigateur WebKit crée un nouveau **containing block** pour tous les descendants en `position: fixed`. Donc l'élément `<div class="view-dropdown-menu">` positionné en `position: fixed` (via `@media max-width: 600px`, ligne 947) ne s'ancre PLUS au viewport — il s'ancre à `.view-switcher`. Combiné avec `overflow-x: auto` sur ce même `.view-switcher`, le menu est clippé hors de la zone visible.

  Chaîne complète :
  1. `.view-switcher { overflow-x: auto; -webkit-overflow-scrolling: touch }` sur ≤480px.
  2. `.view-dropdown-menu { position: fixed; left: 8px; right: 8px }` sur ≤600px.
  3. JS `positionMenuMobile()` calcule `menu.style.top = swRect.bottom + 1` (~150px).
  4. iOS Safari comporte le menu comme `position: absolute` avec containing block = `.view-switcher`.
  5. `top: 150px` dans un scroll container de hauteur ~40px → menu entièrement clippé par `overflow: auto`.

  Chrome/Firefox respectent strictement la spec CSS : `position: fixed` s'ancre TOUJOURS au viewport, même dans un ancêtre scrollable avec `-webkit-overflow-scrolling`. D'où la détection tardive (émulation DevTools ≠ iOS Safari réel).
- **Correctif** (index.html:1010) : suppression pure et simple de `-webkit-overflow-scrolling: touch`. Depuis **iOS 13 (2019)** le momentum scrolling est natif sur tous les éléments scrollables, la propriété est un no-op positif mais garde son effet secondaire de casser le containing block `fixed`. Cleanup legacy. Même suppression appliquée à `.immo-sub-nav` (ligne 1026) par cohérence.
- **Alternatives rejetées**:
  - DOM restructure : déplacer `<div id="analyseMenu">` hors de `.view-switcher`. Fonctionnel mais invasif, sépare le toggle de son menu dans le markup.
  - JS append to body : appendre le menu à `document.body` au click et restaurer au close. Rajoute z-index/scroll management, fragile.
- **Test de non-régression**:
  - [ ] iPhone Safari réel (pas émulation) : tap sur « Analyse » → les 4 items (Créances / Budget / Financement / Plan & Fiscalité) s'affichent en dropdown plein-largeur sous la nav
  - [ ] Tap sur un item ferme le dropdown ET navigue vers la vue
  - [ ] Tap extérieur ferme le dropdown sans naviguer
  - [ ] Esc ferme le dropdown
  - [ ] Orientation change (portrait ↔ paysage) : dropdown se repositionne correctement si ouvert
  - [ ] Scroll horizontal de la nav (si onglets ne tiennent pas) : fonctionne toujours avec momentum natif iOS 13+
  - [ ] Desktop ≥ 600px : dropdown reste en `position: absolute` ancré au toggle (comportement inchangé)
  - [ ] Tablette 600-900px : pas de scroll horizontal (flex-wrap actif), dropdown absolute classique

---

## BUG-062: Tableau « Toutes les Positions » illisible sur mobile (10 colonnes wrappent verticalement)
- **Version**: v229 (refonte mobile responsive), v326 (corrigé)
- **Sévérité**: Moyenne (tableau reste techniquement lisible mais chaque ligne fait 3× sa hauteur normale — UX dégradée)
- **Détection**: Retour utilisateur « tableau trop long » avec screenshot iPhone : chaque valeur (« € 44 737 », « -18.1% ») wrappe sur 2-3 lignes, tableau de ~600px de haut au lieu de ~200px.
- **Symptôme**: Sur iPhone 375-430px, le tableau `#allPositionsTable` (10 colonnes : Position, Qte, Valeur, Coût, P/L, %, FX P/L, Poids, Secteur, Géo) compresse chaque cellule à ~38px de large. Les valeurs financières (« € 44 737 » = 7 chars × 6-8px = 42-56px) ne tiennent pas → browser wrap automatique de la cellule. Chaque position occupe 2-3 lignes verticales de hauteur, rendant la comparaison visuelle entre positions quasi impossible.
- **Cause racine** (index.html:3520) :
  ```html
  <table id="allPositionsTable" style="width:100%;">
    ...
  </table>
  ```
  Pas de wrapper `overflow-x: auto` ni `min-width` sur le tableau. Les autres tableaux larges du dashboard (Plan Objectifs, Sensibilité, Calendrier Fiscal, Financement comparatif, Créances, Budget) ont tous reçu leur wrapper en v229 / v321. Le tableau positions avait été oublié (probablement parce que `body { overflow-x: hidden }` masquait visuellement le problème en production, sans le faire scroller).
- **Correctif** (index.html) :
  1. HTML (~3520) : wrap dans `<div class="positions-table-wrap" style="overflow-x: auto; max-width: 100%;">`.
  2. CSS ≤480px (~1240) : règle `.positions-table-wrap #allPositionsTable { min-width: 720px; }` force le tableau à sa taille naturelle. 720px = ~80px par colonne × 9 cols de données (POSITION prend plus).
  3. Pattern cohérent avec les autres tableaux larges du dashboard.
- **Test de non-régression**:
  - [ ] iPhone (≤480px) : le tableau positions fait 1 ligne par position (pas de wrap vertical des valeurs)
  - [ ] iPhone : swipe horizontal sur le tableau révèle progressivement Coût, P/L, %, FX P/L, Poids, Secteur, Géo
  - [ ] iPhone : la ligne « Total (14 positions) » reste visible et alignée
  - [ ] Desktop ≥ 900px : aucun scroll horizontal visible (tableau fait < 100% du container `.card`)
  - [ ] Tablette 600-900px : pas de scroll horizontal (tableau fit naturellement en landscape)
  - [ ] Toggle de période (All / Daily / MTD / 1M / YTD) : scroll position horizontale conservée ou reset propre
  - [ ] Sort par colonne : fonctionne via tap sur header même pendant un scroll horizontal en cours

---

## BUG-060: Bloc "Patrimoine par Catégorie" vide (€0/--) sur la vue Financement Immo
- **Version**: v306 (détecté v318), v318 (corrigé)
- **Sévérité**: Moyenne
- **Détection**: Revue visuelle utilisateur — les 4 cards Actions/Cash/Immo/Autres affichent toutes `€0` et `--` sur la vue `immo-financing`.
- **Symptôme**: Le bloc `#catNav` ("Patrimoine par Catégorie") reste visible sur la vue Financement Immo mais sans aucune donnée. Rend l'UX incompréhensible (l'utilisateur voit un bloc avec des valeurs à zéro au-dessus des scénarios de financement).
- **Cause racine** (render.js:250) :
  ```js
  if (PERSON_VIEWS.includes(view)) {
    renderCategoryCards(state, view);
    renderCategoryPcts(state, view);
    // ...
  }
  ```
  `PERSON_VIEWS = ['couple', 'amine', 'nezha']` — sur `immo-financing`, `renderCategoryCards` n'est jamais appelé. Mais le HTML `#catNav` (`index.html:2849`) n'a pas d'attribut `data-view` pour être caché → le bloc reste visible avec ses placeholders `--` et `data-eur="0"`.
- **Correctif** (render.js:269+) :
  ```js
  if (view === 'immo-financing') {
    renderImmoFinancingView(state);
    // v318 — populer avec vue Amine (module centré Amine)
    renderCategoryCards(state, 'amine');
    renderCategoryPcts(state, 'amine');
  }
  ```
  Choix de la vue `amine` : le module Financement Immo est centré sur les positions IBKR d'Amine (collateral margin), son patrimoine mobilisable, et son épargne mensuelle. Afficher les cards Amine donne le contexte patrimonial avant les scénarios de financement.
- **Test de non-régression**:
  - [ ] Naviguer vers "Financement Immo" — les 4 cards affichent les valeurs Amine (Actions IBKR+ESPP+SGTM, Cash UAE+Revolut+Maroc, Vitry equity, Véhicules+Créances+Facturation−TVA)
  - [ ] Les pourcentages (en haut-droite de chaque card) s'affichent correctement (somme = 100%)
  - [ ] Revenir à la vue Couple puis Financement — pas de rémanence des valeurs Couple
  - [ ] Les autres vues non-personne (cash, actions, créances, budget, plan-fiscal) gardent le bloc visible avec les dernières valeurs lues (comportement existant, hors scope de ce fix)

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

## BUG-054: Chart Evolution — 3 formules de P&L divergentes + label "NAV actuelle" hardcodé

- **Version**: v303 (refactor ciblé)
- **Sévérité**: Haute (valeurs visibles incohérentes entre périodes)
- **Détection**: Retour utilisateur — "bug sur le calcul de P&L, la valeur finale est différente selon le graph affiché". Capture :
  - Tooltip MAX au 17/04/2026 → P&L total +€54 086
  - Tooltip YTD au 17/04/2026 → P&L total +€52 972
  - Header 1Y → "NAV actuelle : €-11 028" (absurde — c'était le delta P&L, pas la NAV)
- **Symptôme**: à date identique (aujourd'hui), les trois pipelines du graphique (`mode='ytd'`, `mode='1y'`, `mode='alltime'`) exposaient trois valeurs différentes pour `plValuesTotal[last]` :
  - YTD : 30 942 € (= navChange + degiroRealizedPL, PÉRIODE-relative)
  - 1Y/alltime : 89 874 € (= NAV from-zero − deposits_replayed + degiroRealized, FROM-ZERO-REPLAY)
  - `absPLTotal` (tooltip) : 53 347 € (= navTotal − absDepsTotal, LIFETIME correct)
  
  Parallèlement, le label "NAV actuelle" dans le header du chart était HARDCODÉ dans `index.html:3215` et ne changeait jamais. En mode P&L, la valeur injectée était `plChange` (delta période), donc le user lisait "NAV actuelle : -€11 028" pour un portefeuille qui vaut €243 000.
- **Cause racine**:
  1. Absence de définition canonique unique de "P&L total au jour t". 4 implémentations coexistaient (YTD period, 1Y/alltime from-zero, `buildEquityHistoryChart`, `computeAbsoluteTooltipArrays.absPLTotal`) avec des formules différentes.
  2. Le span "NAV actuelle" n'avait pas d'`id` → `renderPortfolioChart` ne pouvait pas le relabeler.
  3. `capitalDeployed = refValue + depositsInPeriod` utilisait `refValue=0` en mode P&L → le dénominateur du % P&L titre était sous-évalué.
- **Correctif (v303 — refactor ciblé, pas complet)**:
  1. **Formule canonique unique** : `plValues*[t] = navValues*[t] − absDepositsValues*[t]` (= `absPLTotal[t]`). Appliquée à TOUS les modes en écrasant `plValues*` stockés avec `absTooltip.abs*` juste après leur calcul. `buildEquityHistoryChart` faisait déjà ça correctement ; `buildPortfolioYTDChart` a été aligné.
  2. **`absTooltip` déplacé AVANT le early-return 'alltime'** dans `buildPortfolioYTDChart` (auparavant calculé seulement pour ytd/1y, donc alltime n'avait pas accès aux valeurs lifetime).
  3. **Per-platform & per-owner plValues** également unifiés : `plValuesIBKR/ESPP/SGTM/Degiro/ESPPAmine/ESPPNezha` viennent tous de `absTooltip.absPL*` désormais.
  4. **Label "NAV actuelle" → dynamique** : ajout `id="ytdEndLabel"` dans `index.html:3214-3216`, `renderPortfolioChart` le relabèle en "P&L actuel" en mode P&L, "NAV actuelle" en mode Valeur.
  5. **Valeur injectée en mode P&L** : `ytdEndEl.textContent = endVal` (P&L lifetime courant) au lieu de `plChange` (delta période, déjà dans le titre) → plus de duplication.
  6. **`capitalDeployed` basé sur la NAV de départ de la période** : lecture directe depuis `data.totalValues[startIdx]` etc. (mode-invariant, donne un dénominateur cohérent pour le % P&L affiché dans le titre).
  7. **Tests de régression inline** (`_assertV303Invariants`) dans chaque build, 3 invariants vérifiés aux points {0, n/2, n-1} avec tolérances €1-4 : (I1) plValuesTotal == absPLTotal, (I2) Total == Σ per-platform, (I3) ESPP == Amine + Nezha. Fail loud via `console.warn` si dérive.
- **Résidu non corrigé** (tech debt pré-existant) : ΔNAV ~€400 entre YTD (53 347) et 1Y/alltime (53 750) vient du replay alltime-from-zero (STARTING_NAV=0, cashEUR=0) vs YTD calibré avec `IBKR_EUR_START_OVERRIDE=-17534` traced depuis CSV IBKR. Documenté dans `charts.js:2842-2843` comme drift Yahoo FX vs IBKR FX. Fixer cela requiert d'unifier les 4 pipelines (buildPortfolioYTDChart × 3 modes + buildEquityHistoryChart) — estimé 3-4 jours, hors scope v303.
- **Vérification runtime** (preview worktree v303):
  ```
  Mode     plTotalLast   absPLLast    Invariants
  ytd      53 347 €      53 347 €     I1 ✓  I2 ✓  I3 ✓
  1y       53 750 €      53 750 €     I1 ✓  I2 ✓  I3 ✓
  alltime  53 750 €      53 750 €     I1 ✓  I2 ✓  I3 ✓
  ```
  Header P&L mode :
  - YTD : P&L départ €73 068 → P&L actuel +€53 347 (delta YTD = −€19 721 = titre)
  - 1Y  : P&L départ €10 374 → P&L actuel +€53 750 (delta 1Y = +€43 376 = titre)
  - MAX : P&L départ €2 487  → P&L actuel +€53 750 (delta MAX = +€51 263 = titre)
- **Test de non-régression**:
  - [ ] Preview : ouvrir la console, chercher `[v303] ✓ plValues* invariants OK` — doit apparaître pour chaque mode (ytd, 1y, alltime)
  - [ ] Pas de `[v303] ⚠` warnings dans la console
  - [ ] Header en mode Valeur : "NAV 1er jan : X / NAV actuelle : Y" (labels inchangés)
  - [ ] Header en mode P&L : "P&L départ : X / P&L actuel : Y" (nouveau label)
  - [ ] En mode P&L : `endVal` (P&L actuel) ≠ `plChange` (delta titre), plus de duplication entre titre et header
  - [ ] Cross-mode : `_chartDataByMode.ytd.plValuesTotal.at(-1)` ≈ `_chartDataByMode.ytd._absoluteTooltip.absPLTotal.at(-1)` (même pour 1y, alltime)
  - [ ] `_chartDataByMode['1y'].plValuesTotal.at(-1)` === `_chartDataByMode.alltime.plValuesTotal.at(-1)` (même pipeline from-zero)
  - [ ] Drift YTD vs 1Y/alltime ≤ €500 (drift documenté, pas critique)

---

## Feature (v303): Badge de confirmation des dividendes dans le calendrier WHT

- **Version**: v303 (nouvelle feature)
- **Contexte**: Demande utilisateur — "fais une mise à jour de ce tableau et montre le quand une dividende est confirmée" (tableau `whtTbody` affichant le calendrier des ex-dates).
- **Besoin métier**: Distinguer visuellement les dividendes **officiellement annoncés** (via AGM ou résultats annuels) de ceux simplement **projetés** (estimation DPS × shares basée sur l'an passé, sans confirmation). Utile car entre le 1er trimestre et l'AGM, les dividendes affichés sont hypothétiques — l'utilisateur peut ne pas vouloir planifier des ventes pré-ex-date sur cette base.
- **Schéma étendu** (`data.js` `DIV_CALENDAR`):
  ```js
  {
    dps: number,                    // DPS natif (devise action)
    exDates: Array<string|Object>,  // string 'YYYY-MM-DD' OR { date, confirmed?, dps?, note? }
    frequency: 'annual'|'semi-annual'|'quarterly'|'none',
    confirmed?: boolean,            // NOUVEAU — défaut pour toutes les exDates strings
    source?: string,                // NOUVEAU — provenance (ex: "Airbus AGM 15 avril 2026")
    note?: string,
  }
  ```
  Sémantique `confirmed` :
  - `true`  → annonce officielle (AGM votée, rapport annuel, press release) → badge vert "✓ confirmé"
  - `false`/absent → projection basée sur historique → badge gris "⏳ projeté"

  Le support per-date (via objet ExDateObj) permet de marquer confirmed=true pour le solde mai et confirmed=false pour l'acompte décembre (cas semi-annuel LVMH/Hermès).
- **Propagation** (`engine.js` dans le builder dividendAnalysis):
  - Normalisation des `exDates` (string OR object → object avec .date, .confirmed, .note)
  - Exposition de `nextExConfirmed: boolean` et `nextExNote: string|null` sur chaque position
  - Exposition de `divSource: string|null` (depuis `cal.source`)
  - `upcomingPayments` carries `{ exDate, daysUntil, confirmed, note }` pour usage futur (tooltip, etc.)
- **Affichage** (`render.js` `renderWHTRows`):
  - Dans la cellule "VENDRE AVANT", ajout après la ligne `J-X` d'un badge small pill :
    - Confirmé : `<span style="background:#c6f6d5;color:#276749">✓ confirmé</span>` + tooltip `title="Source : Airbus AGM 15 avril 2026"`
    - Projeté : `<span style="background:#edf2f7;color:#718096">⏳ projeté</span>` + tooltip expliquant que c'est une projection
  - Si `nextExNote` présent (ex: "Solde 7.50€ avr + acompte 5.50€ déc"), rendu en italique gris sous le badge
- **Données mises à jour**: tous les dividendes CAC 40 avec ex-date avril-mai 2026 marqués `confirmed: true` avec `source` pointant vers l'AGM ou les résultats annuels 2025 (publiés fév-mars 2026). Shiseido (juin) confirmé via rapport FY2025 mars 2026. IBIT/ETHA (DPS=0) marqués confirmed=true par cohérence (pas de dividende à projeter).
- **Verif preview**:
  ```
  Ticker        Badge            Source tooltip
  Airbus (AIR)  ✓ confirmé       Airbus AGM 15 avril 2026
  LVMH (MC)     ✓ confirmé       LVMH AGM 16 avril 2026
  Porsche       ✓ confirmé       Porsche AG résultats FY2025 (mars 2026)
  ... (10/10 rows)
  ```
- **Test de non-régression**:
  - [ ] Chaque ligne du tableau dividendes affiche un badge "✓ confirmé" ou "⏳ projeté" sous la date
  - [ ] Hover sur le badge → tooltip avec la source
  - [ ] Ajouter un faux dividende avec `confirmed: false` dans data.js → badge gris "⏳ projeté" doit apparaître
  - [ ] Format object pour `exDates` (ex: `[{ date: '2026-05-04', confirmed: false }]`) également supporté
  - [ ] Aucune régression sur les calculs `projectedDivEUR` / `projectedWHT` / `daysUntilEx`

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
| **Chart P&L unifié cross-mode** | BUG-054 | `plValues* == absPLTotal == navTotal − absDepsTotal` dans tous les modes ; label dynamique `ytdEndLabel` ; invariants I1/I2/I3 via `console.warn` |
| **Dividendes confirmées** | feature v303 | Badge `✓ confirmé` / `⏳ projeté` + tooltip source dans calendrier WHT ; schéma `DIV_CALENDAR` étendu avec `confirmed` et `source` |
| **Chart 1Y première valeur** | BUG-055 | Reconstruction `chartValuesDegiro[t] = absDepsDegiro[t] + degiroRealizedPL` pour `t < 2025-04-14` → `absPLDegiro` constant pré-clôture |

---

## BUG-055: Chart 1Y/alltime — première valeur sous-estimée (~€60K manquants)

- **Version**: v304 (corrigé)
- **Sévérité**: Moyenne (incohérence visible entre 1Y premier point et 5Y au même jour)
- **Détection**: Retour utilisateur — "y a un petit bug sur la première valeur de 1Y (comparé à 5Y) non ?"
  - 1Y chart premier point (2025-04-08) : +€10 374
  - 5Y chart à la même date : ~€70 000
  - Écart : ~€60 000 (≈ `degiroRealizedPL = 50 665€`)
- **Symptôme visible**: dans le chart 1Y, la courbe démarre à +€10K puis saute brusquement à +€65K dès le 2e point (~mi-mai). Le 5Y (et MAX au même jour) montrait la bonne valeur stable autour de €65-70K.
- **Cause racine**: dans `buildPortfolioYTDChart` (charts.js:4031), `chartValuesDegiro = chartLabels.map(() => 0)` force la NAV Degiro à 0 pour TOUTES les dates. Ce choix était correct pour le compte post-clôture (14/04/2025) mais incorrect pour les dates pré-clôture où Degiro avait encore un NAV réel (~€55K = €4K deposits nets + €50K P&L réalisé déjà banked en cash dans le compte).
  
  La formule v303 `absPLDegiro = navDegiro − absDepsDegiro` donnait :
  - Pré-clôture : `0 − 4 149 = −4 149€` (faux, devrait être +€50 665)
  - Post-clôture : `0 − (−50 665) = +50 665€` (correct naturellement car `absDeps` devient négatif suite aux retraits)
  
  Différence de +€54 814 qui ressortait brusquement au 14/04/2025 → saut visible dans la courbe.
  
  Le chart 5Y (`buildEquityHistoryChart`) n'avait pas le bug car il splice `EQUITY_HISTORY` monthly qui contient la vraie NAV Degiro pré-clôture.
- **Correctif**: dans `buildPortfolioYTDChart`, juste après `computeAbsoluteTooltipArrays`, reconstruire les NAV Degiro pré-clôture :
  ```js
  const DEGIRO_CLOSE_DATE = '2025-04-14';
  for (let i = 0; i < chartLabels.length; i++) {
    if (chartLabels[i] < DEGIRO_CLOSE_DATE) {
      chartValuesDegiro[i] = absTooltip.absDepsDegiro[i] + degiroRealizedPL;
    }
    // Else: stays 0 (closed)
  }
  // Then recompute chartValuesTotal + absPL{Degiro,Total} to propagate
  ```
  Cela garantit `absPLDegiro[t] = degiroRealizedPL` constant pré-clôture, aligné avec le `plValuesDegiro` flat utilisé ailleurs. Post-clôture inchangé (formule naturelle nav−deps → +realizedPL).
  
  Ensuite recalcul de `chartValuesTotal = Σ plateformes NAV` et des champs `absPLDegiro` / `absPLTotal` dans `absTooltip` → tous les consommateurs en v303 (plValues unifiés, tooltip, header, KPIs) voient la valeur corrigée.
- **Vérification runtime** (preview v304, 2025-04-08):
  | Mode | plTotal[first] | plDegiro[first] | navDegiro[first] | absDepsDegiro[first] |
  |---|---|---|---|---|
  | 1y | €65 188 (était €10 374) | +€50 665 | €54 814 (reconstruit) | €4 149 |
  | alltime | €65 188 (était €10 374) | +€50 665 | €54 814 | €4 149 |
  | ytd (Jan 2) | €73 068 (inchangé, démarre post-clôture) | +€50 665 | €0 | €−50 665 |
  
  Invariants v303 (I1/I2/I3) continuent à passer dans les 3 modes.
- **Test de non-régression**:
  - [ ] Preview : chart 1Y mode P&L, premier point >=€50K (pas €10K)
  - [ ] Cross-mode : `_chartDataByMode['1y'].plValuesTotal[0]` === `_chartDataByMode.alltime.plValuesTotal[0]`
  - [ ] Console : `[v304] Degiro pre-close NAV reconstructed for N date(s)` apparaît au build (N=1 à 6 selon le mode)
  - [ ] Invariants `[v303] ✓ plValues*` toujours OK dans les 3 modes
  - [ ] Chart 5Y/MAX (buildEquityHistoryChart) inchangé — il n'avait pas le bug
  - [ ] Dernière valeur des 3 modes inchangée (±€1 vs v303, le fix ne touche que les dates < 2025-04-14)

---

## BUG-056: Cash-flow consolidé — loyers nets jamais agrégés (mauvais chemin de lecture)

- **Version**: v308 (introduit) → v313 (corrigé)
- **Sévérité**: Haute (revenus mensuels sous-estimés → savings rate, runway, emergency fund tous faussés)
- **Détection**: audit v312 — `[audit] ligne "Loyer net Vitry" absente du Budget view malgré un bien locatif actif`
- **Symptôme visible**:
  - Budget view : table "Revenus" ne contient que Bairok + dividendes, pas de loyer
  - KPIs Cash-flow sous-estimés d'environ +950 €/mois (loyer Vitry net)
- **Cause racine**: dans `computeCashFlow` (engine.js:4814), la boucle lisait `prop.cashFlow.netMonthly`. Or aucune propriété retournée par `computeImmoView().properties[i]` ne porte de champ `cashFlow`. Les champs réels sont `cf` (mensuel net), `loyer`, `chargesLoc`, `loanInterestAnnuel`. La condition `if (prop.cashFlow && …)` était donc toujours fausse → skip silencieux.
- **Correctif** (engine.js:4814-4833) :
  ```js
  if (prop.conditional) continue;          // ignorer VEFA non livrée
  const netMo = prop.cf;                    // cash-flow mensuel net exposé par buildProperty()
  if (netMo != null && Math.abs(netMo) > 1) {
    incomeSources.push({
      label: 'Loyer net ' + (prop.name || prop.loanKey),
      owner: (prop.owner || 'Amine').toLowerCase(),
      …
      monthlyEUR: netMo,
    });
    incomeMonthly += netMo;
  }
  ```
- **Test de non-régression**:
  - [ ] Budget view : ligne "Loyer net Vitry-sur-Seine" apparaît avec ~€950/mois
  - [ ] KPI "Revenus mensuels" augmente proportionnellement
  - [ ] Rueil (conditional=false) apparaît aussi
  - [ ] Villejuif (conditional=true, VEFA) absent comme prévu
  - [ ] `savingsRate` et `runwayMonths` bougent dans le bon sens

---

## BUG-057: Fiscalité MRE — table "IR Loyer Vitry" vide (mauvais chemin de lecture)

- **Version**: v311 (introduit) → v313 (corrigé)
- **Sévérité**: Haute (moitié de la vue Plan & Fiscalité non-opérationnelle)
- **Détection**: audit v312 — preview renvoyait 0 ligne dans la table IR
- **Symptôme visible**: tableau "IR Loyer Vitry" vide, bloc IR/PS/revenu imposable tous à 0 ou absents
- **Cause racine**: dans `computeFiscaliteMRE` (engine.js:5145-5148), lecture de `vitry.cashFlow.loyerMensuel`, `vitry.cashFlow.chargesMensuelles`, `vitry.cashFlow.interetsMensuels` — tous inexistants. Même racine que BUG-056 (il n'y a pas de `vitry.cashFlow`).
- **Correctif** (engine.js:5145-5152) :
  ```js
  const loyerAnnuel = vitry.loyerDeclareAnnuel || (vitry.totalRevenue || 0) * 12;
  const chargesAnnuelles = vitry.deductibleChargesAnnuel || 0;
  const interetsAnnuels = vitry.loanInterestAnnuel || 0;
  ```
  Plus utilisation de `vitry.propertyMeta?.purchaseDate` et `vitry.value` pour la section PV immo.
- **Test de non-régression**:
  - [ ] Plan & Fiscalité : table IR affiche loyerAnnuel ≈ 11 400 € (Vitry), chargesAnnuelles, intérêts
  - [ ] Régime micro-foncier détecté correctement (< 15K€)
  - [ ] IR, PS, total IR+PS affichés avec valeurs non-nulles
  - [ ] PV Vitry calculée à partir du vrai purchaseDate (propertyMeta), pas le fallback 2019-12-15

---

## BUG-058: Alerte P&L IBKR — jamais déclenchée (3 noms de champs incorrects)

- **Version**: v309 (introduit) → v313 (corrigé)
- **Sévérité**: Moyenne (règle #5 des alertes proactives muette)
- **Détection**: audit v312 — aucune alerte verte "rebalancing" ne s'affichait malgré META/GOOGL à +40/50%
- **Symptôme visible**: panel Alertes ne propose jamais de prise de bénéfices
- **Cause racine**: dans `computeAlerts` règle #5 (engine.js:4990), cumul de 3 noms incorrects :
  1. `state.actionsView.positions` → le champ s'appelle `ibkrPositions`
  2. `pos.platform !== 'IBKR'` → aucune position n'a de champ `platform` (filtre exclut tout)
  3. `pos.costBasisEUR` → le champ s'appelle `costEUR_hist`
- **Correctif** (engine.js:4990-5007) :
  ```js
  if (state.actionsView && Array.isArray(state.actionsView.ibkrPositions)) {
    for (const pos of state.actionsView.ibkrPositions) {
      if (!pos.valEUR || !pos.costEUR_hist || pos.costEUR_hist <= 0) continue;
      const plPct = (pos.valEUR - pos.costEUR_hist) / pos.costEUR_hist;
      if (plPct > 0.30 && pos.valEUR > 5000) { … }
    }
  }
  ```
- **Test de non-régression**:
  - [ ] Panel Alertes : au moins 1 alerte verte "P&L X : +Y%" apparaît pour META/GOOGL/MSFT si gain > 30 % & val > €5K
  - [ ] Pas de crash si `ibkrPositions` absent (Array.isArray guard)
  - [ ] Aucune alerte pour positions à €0 ou cost=0

---

## BUG-059: Fiscalité MRE — IR France appliqué en flat au lieu de marginal

- **Version**: v311 (introduit) → v313 (corrigé)
- **Sévérité**: Haute (chiffre fiscal sur-estimé 30-45 % quand revenu > 28 K€)
- **Détection**: audit v312 — relecture manuelle des tranches IR MRE
- **Symptôme visible**: impôt affiché ≈ 30 % × revenu imposable (flat), au lieu du barème progressif
- **Cause racine** (engine.js:5162) :
  ```js
  const tauxIR = revenuImposable > 28000 ? 0.30 : 0.20;
  const ir = revenuImposable * tauxIR;
  ```
  Cette formule applique 30 % à **toute** la base dès qu'elle dépasse 28 K€. Pour un revenu imposable de 35 K€, l'IR calculé était 35 000 × 30 % = **10 500 €** alors que le barème correct donne 28 797 × 20 % + 6 203 × 30 % = **7 621 €**. Sur-estimation de 37 %.
  
  Le barème MRE non-résident 2026 est bien **progressif** : 20 % marginal sur la tranche 0-28 797 €, 30 % au-delà (loi de finances 2026, art. 197 A du CGI).
- **Correctif** (engine.js:5163-5167) :
  ```js
  const SEUIL = 28797;
  const ir = revenuImposable <= SEUIL
    ? revenuImposable * 0.20
    : SEUIL * 0.20 + (revenuImposable - SEUIL) * 0.30;
  const tauxIREffectif = revenuImposable > 0 ? ir / revenuImposable : 0;
  ```
  Le champ `tauxIR` exposé devient le taux **effectif** (moyen) pour l'affichage.
- **Test de non-régression**:
  - [ ] IR(10 000 €) = 2 000 € (marginal 20 %)
  - [ ] IR(28 797 €) = 5 759 € (limite inférieure)
  - [ ] IR(30 000 €) ≈ 6 120 € (pas 9 000 €)
  - [ ] IR(50 000 €) ≈ 12 121 € (pas 15 000 €)
  - [ ] `tauxIR` affiché croît avec la base (effet marginal)
  - [ ] Régime micro-foncier (loyer < 15K) : IR = 0.20 × loyer × 0.70 (pas de bascule 30 %)

---

*Dernière mise à jour: v327 — 19 avril 2026 (BUG-063 — débordement mobile systémique suite à retour utilisateur post-v326 « y a plein d'autres tableaux qui ont une largeur supérieure ». Audit des 9 vues (Couple, Amine, Nezha, Actions, Cash, Immobilier, Créances, Budget, Plan-Fiscal, Property Detail) a identifié 13 tableaux ≥ 5 colonnes sans wrapper `overflow-x: auto` + 5 tableaux dynamiques render.js avec `width:100%` qui empêchait le scroll de se déclencher + 1 tableau 10 colonnes (immoCFTable) sans wrapper du tout. Fix généralisé via pattern `.table-wrap` + CSS var `--tbl-min` paramétrable : 13 wraps HTML + 5 min-width dynamiques + 1 wrap inline dans render.js. `--tbl-min` calibré par nombre de colonnes (520 px pour 5 cols, 680-740 px pour 7 cols, 820-900 px pour 8-9 cols). Règle d'or documentée : tout nouveau tableau ≥ 5 colonnes DOIT être wrappé. Voir ARCHITECTURE.md §74.)*

*v326 — 19 avril 2026 (deux bugs mobile iPhone — BUG-061 dropdown « Analyse » totalement invisible sur iOS Safari : `-webkit-overflow-scrolling: touch` sur `.view-switcher` (≤480px) créait un nouveau containing block pour les descendants `position: fixed`, donc notre dropdown-menu `fixed` se comportait comme `absolute` et se faisait clipper par `overflow-x: auto`. Spec CSS violée par WebKit depuis iOS 5, non reproductible sur Chrome/Firefox mobile émulé — d'où détection tardive. Fix : suppression de la propriété (legacy, no-op depuis iOS 13 où le momentum scrolling est natif). BUG-062 tableau « Toutes les Positions » illisible sur iPhone : 10 colonnes dans 375px = ~38px/colonne, valeurs « € 44 737 » wrappaient sur 2-3 lignes, chaque ligne du tableau faisait 3× sa hauteur normale. Fix : wrapper `.positions-table-wrap { overflow-x: auto }` + `#allPositionsTable { min-width: 720px }` en ≤480px. Pattern cohérent avec les autres tableaux larges (Plan/Fiscalité/Créances/Budget/Financement) wrappés en v229/v321. Voir ARCHITECTURE.md §73.)*

*v325 — 18 avril 2026 (UX senior redesign du chart Stress Casa suite à retour « les couleurs red/green/orange c'était bien, mais les graphs étaient basiques et pas UX friendly » + « améliore ce graph tel un UX graph designer senior ». Réconciliation stoplight + identity : fills/borders per-bar stoplight (signal métier primaire « puis-je financer Casa ? » en L1 lecture 1-sec), identité scénario A/B/C portée par lettre `textMuted` 10px sous la barre + caption bas `A · Cash intégral    B · Prêt banque    C · Cash + margin IBKR` (L2 lecture 10-sec). Labels inline multi-couleur `2.58 M  ✓ 65%` sans pill/background style FT/Bloomberg — moins de chart junk. Légende custom hard-codée via `generateLabels` (3 statuts + 1 besoin) qui élimine la dérivation Chart.js cassée par les arrays de backgroundColor. Error bars neutralisés en `textSecondary` pour ne pas concurrencer les fills stoplight. Layout `{ top: 22, right: 12, bottom: 40, left: 4 }` pour accueillir lettres + caption, `scales.x.ticks.padding: 18` pour cushion lettre/tick horizon. 2 nouveaux plugins Chart.js : `scenLetterPlugin` + `scenCaptionPlugin`. Voir ARCHITECTURE.md §72.)*

*v324 — 18 avril 2026 (fix micro post-v323 : bug de superposition MDH text + pill statut sur le chart Stress Casa — les labels étaient stackés verticalement avec seulement 2 px de gap (MDH baseline bottom à yAnchor, pill top à yAnchor+2), donc sur ~10.5 px le descender du texte chevauchait le top du pill. Refonte en layout INLINE horizontal : `2.58 M  [✗ 65%]` sur une seule ligne avec baseline alphabétique partagée (text align left + center pour pill), total 14 px de hauteur. Plus de padding top excessif (38→20) et ajout d'un `yMax` calculé explicitement (`Math.ceil(maxData × 1.12 × 2) / 2`) basé sur max(besoin, plafonds, planchers) pour garantir que le plafond le plus haut + label restent dans le viewport — résout aussi le clipping T+18 scénario B qui mordait le haut du canvas.)*

*v323 — 18 avril 2026 (retours utilisateur post-v322 : #1 panneau `#alertsPanel` (5 règles proactives) déplacé du haut de la vue Couple vers la fin (après le Simulateur Couple). Les alertes sont un complément de lecture, pas un headline — la KPI strip reprend sa place au sommet de la page. #2 rework premium des 3 charts du module Financement Immo (Patrimoine / LTV / Stress Casa) : fill pastel `hexToRgba(scenCol, 0.22)` + border scénario plein 1.25px + légende qui reflète enfin l'identité scénario (fix bug où Chart.js dérivait la swatch de `backgroundColor[0]` stoplight). Stress Casa : pills de statut colorés (✓/≈/✗) au-dessus des barres qui encodent `plancher vs besoin`, error bars fins avec cap + point terminal, padding top 38px (labels plus clippés), tooltip custom sombre (#1c1917), ticks compact "X.X M" + DM Sans partout. #3 loose ends v322 corrigés : `var(--card-bg, white)` (token inexistant) → `var(--surface)` dans `renderAlertsPanel`, `statusColors` créances migrés de 5 hex hardcodés vers DESIGN_TOKENS info/warning/danger/success/scenD. Voir ARCHITECTURE.md §71.)*

*v322 — 18 avril 2026 (charte graphique Networth : inventaire initial ≈ 185 hex uniques éparpillés (4 verts, 5 rouges, 3 palettes de gris). Design d'une palette premium warm-stone avec 36 tokens en 6 catégories (surfaces + brand + semantic + scenarios + asset-classes + geo). Expose côté CSS dans `:root` (index.html) et côté JS via `DESIGN_TOKENS` exporté depuis `data.js` pour les contextes `<canvas>` Chart.js/treemap qui ne lisent pas les `var(--xxx)`. Améliorations contraste : `--text-secondary` #78716c (fail AA 4.13:1) → #57534e (AA 6.21:1). Migrations v322 : 4 cartes scénarios Financement, bannière reco, classes `.pos/.neg/.highlight/.success/.info`, `scenarioMeta` engine, `statusColor` objectifs, `sevMeta` alertes, `macro-risks` sColor, `liqColor` tableau comparatif, bouton chart mode actif. Aliases legacy conservés (`--red/--green/--blue/--gray/--card`) pour rétro-compat. Voir ARCHITECTURE.md §70 pour la charte complète + règles d'usage.)*

*v321 — 18 avril 2026 (fix mobile iPhone suite à screenshot utilisateur : #1 dropdown "Analyse" (v320) débordait hors écran à droite car `position: absolute` ancré au toggle + clippé par `.view-switcher { overflow-x: auto }` sur ≤ 480 px → passage en `position: fixed; left:8px; right:8px` avec JS qui calcule `top` dynamiquement depuis `view-switcher.getBoundingClientRect().bottom` à chaque ouverture (et sur resize si ouvert). #2 ajout d'une règle CSS @480px qui match `div[style*="grid-template-columns:repeat(N,1fr)"]` pour N=2..6 → stacking 1-col, fixant les 4 cartes scénarios A/B/C/D du Financement Immo. #3 `overflow-x:auto` + `min-width` sur les tableaux Plan & Fiscalité (Objectifs 7 cols / Sensibilité / Calendrier) pour scroll horizontal propre au lieu de déborder. Voir ARCHITECTURE.md §69.)*

*v320 — 18 avril 2026 (4 améliorations groupées : A Patrimoine par Catégorie — Amine (subcards Rueil+Villejuif cachées, ESPP/SGTM filtrés Amine-only via `renderExpandSubs(state, 'amine', { strict: true })`) ; B dropdown "Analyse" dans la nav qui regroupe Créances/Budget/Financement/Plan & Fiscalité (toggle avec `parent-active` orange, item actif avec bandeau vertical gold, close on outside click + Esc) ; C tableau comparatif Financement enrichi de 3 colonnes dérivées (Impact net vs baseline sans appart, ROI annualisé CAGR, Gain horizon = patrimoine − capital injecté) — 6 → 9 colonnes, scroll horizontal mobile ; D constante `DECLARED_MONTHLY_SAVINGS_EUR = 8000` dans data.js, `syncEpargneFromCashFlow` + `renderPlanFiscalView` la consomment au lieu de `netSavings` qui surestimait (16 670 vs 8 000) car les dépenses variables ne sont pas trackées — KPI Budget "Épargne nette" renommée "Surplus structurel" (diagnostic) + nouvelle KPI "Épargne déclarée" (effective). Voir ARCHITECTURE.md §68.)*

*v319 — 18 avril 2026 (refonte UX Financement Immo : #1 Stress Casa passe à T+6/12/18 avec plancher 0 % marché + error bar plafond +20 % et épargne DCA — formule `positions × marketMult + netSavings × n × savingsMult`, SAFETY_COEFF 0,75. #2 default chart mode `absolu` → `delta` (vue la plus actionnable). #3 bandeau 4 cartes accordéon A/B/C/D + tableau comparatif remonté full-width avant les charts. #4 suppression chart "Évolution cash mobilisable" illisible à 25 ans. Voir ARCHITECTURE.md §67.)*

*v318 — 18 avril 2026 (BUG-060 : cards "Patrimoine par Catégorie" vides sur vue Financement Immo — fix par `renderCategoryCards(state, 'amine')` ajouté au rendu de `immo-financing`. Le module Financement étant centré Amine, ses 4 cards donnent le contexte patrimonial avant les scénarios.)*

*v317 — 18 avril 2026 (alertes enrichies post-audit 3ᵉ passe : C1 règle #5 symétrique moins-values IBKR ≤−20 % severity yellow, C2 nouvelle règle #6 fraîcheur données (DATA_LAST_UPDATE > 45j jaune, > 90j rouge), C5 guards div-by-zero dans `computeObjectifs` et `computeSensibilite` si annualReturn = 0 (limite mathématique `n` au lieu de NaN). + ARCHITECTURE.md §65.)*

*v316 — 18 avril 2026 (plan long-terme post-audit 2ᵉ passe : B1 épargne mensuelle tirée de `computeCashFlow` (plus de hardcode 8000), B2 horizons longs (≥10 ans) affichent target+projected en €réels 2026 (déflatés × inflationFactor), B3 `computeSensibilite(state, obj, opts)` centré sur baseRendement/baseSavings réels avec variations ±2pts / ±20 %. + ARCHITECTURE.md §64.)*

*v315 — 18 avril 2026 (robustesse post-audit : A1 auto-feed épargne mensuelle depuis computeCashFlow au 1er rendu (`syncEpargneFromCashFlow` + guard `_immoFinEpargneAutoFed`), A2 reco multi-projets via `projetsTendus` qui capture Casa+Proj2+Proj3 ≤24 mois, A3 coeff sécurité 0.75 sur capacité collatérale (liquiditeMult = 1 + ltvTarget×0.75), A9 MARGIN_RATES.EUR 3.1%→4.3% aligné €STR 2025-2026. + ARCHITECTURE.md §63.)*

*v314 — 18 avril 2026 (quality fixes post-audit : A5 resync visuel boutons chart mode au premier render, A7 coeff CRD moyen 0.55 sur assurance DI, A8 warn console créances sans dueDate. + ARCHITECTURE.md §54-§62 complétée (v305→v314) + CLAUDE.md mis à jour avec shapes inter-modules en règle d'or #7.)*

*v313 — 18 avril 2026 (audit v305-v312 : BUG-056 cash-flow loyers, BUG-057 fiscalité Vitry table vide, BUG-058 alerte P&L IBKR muette, BUG-059 IR marginal au lieu de flat. + apportRatio data-driven par preset (A6).)*
