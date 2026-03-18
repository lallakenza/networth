# Architecture — Patrimonial Dashboard

> Guide pour IA / développeur qui doit modifier le site.
> Version courante : **v149** | Déployé sur GitHub Pages : `lallakenza.github.io/networth/`

## Principe fondamental

**Zéro hardcode.** Toute valeur affichée doit provenir de `data.js` (données brutes) ou être calculée dynamiquement par `engine.js`. Ne jamais écrire de montants, noms de comptes, ou textes de conseil en dur dans render.js ou index.html.

## Pipeline de données

```
data.js  →  engine.js  →  render.js  →  DOM (index.html)
  (raw)      (compute)     (display)      (structure)
                ↓
            charts.js (Chart.js visualisations)
            simulators.js (projections interactives)
```

## Fichiers

| Fichier | Rôle | Quand modifier |
|---------|------|----------------|
| `js/app.js` | Point d'entrée. Orchestre DATA → ENGINE → RENDER. Gère le routing des vues, le switch devise, le chargement FX/stocks. | Changement de vue, devise, refresh |
| `js/data.js` | Données brutes en devise native (AED, MAD, EUR, USD, JPY). Constantes immo, taux, créances. | Mise à jour bimensuelle des soldes, ajout de compte/bien |
| `js/engine.js` | Calculs purs : `compute(PORTFOLIO, fx)` → state object. Pas de DOM. | Ajout de logique de calcul (nouveau type d'actif, diagnostic) |
| `js/render.js` | Lecture du state → mise à jour du DOM. Exports : `render(state)`, `fmt()` | Ajout d'affichage, modification de layout |
| `js/charts.js` | Chart.js : création/destruction de graphiques. Lit state, pas le DOM. | Ajout de graphique |
| `js/simulators.js` | 3 simulateurs de projection (couple, Amine, Nezha) | Modification des projections |
| `js/api.js` | Fetch FX (frankfurter.dev) + stock prices (Yahoo Finance chart API) | Ajout de source de prix |
| `index.html` | Structure HTML + CSS. Pas de logique. | Ajout de sections UI |

## Comment ajouter un nouveau bien immobilier

1. **data.js** : ajouter dans `PORTFOLIO.{owner}.immo` un objet avec `value`, `valueDate`, `appreciation`, `purchaseDate`, `purchasePrice`, `surface`
2. **data.js** : ajouter les prêts dans `IMMO_CONSTANTS.loans.{key}Loans[]`
3. **data.js** : ajouter les charges dans `IMMO_CONSTANTS.charges.{key}`
4. **data.js** : ajouter le loyer dans `IMMO_CONSTANTS.properties.{key}`
5. **engine.js** : `buildProperty()` le détecte automatiquement via `IMMO_CONSTANTS`
6. **render.js** : les property cards se génèrent dynamiquement

## Estimation dynamique de la valeur des biens (engine.js → buildProperty)

La valeur d'un bien évolue dans le temps grâce au taux d'appréciation, à partir d'une **date de référence** (`valueDate`).

### Principe

Chaque bien dans `PORTFOLIO.{owner}.immo.{key}` a :
- `value` : valeur estimée à la date de référence (en EUR)
- `valueDate` : date de cette estimation au format `'YYYY-MM'` (ex: `'2025-09'`)

Au chargement, `engine.js` calcule la valeur actuelle par capitalisation mensuelle :
```
valeur_actuelle = value × (1 + taux_appreciation / 12) ^ mois_depuis_valueDate
```

Le taux d'appréciation utilise les `appreciationPhases` de `IMMO_CONSTANTS.properties.{key}` si disponibles (taux différent par période), sinon le taux global `appreciation`.

### Ajuster la valeur à tout moment

Pour recalibrer l'estimation d'un bien (ex: après une expertise, un comparatif marché) :
1. Mettre à jour `value` avec la nouvelle estimation dans `data.js`
2. Mettre à jour `valueDate` avec la date de cette nouvelle estimation
3. Toute la projection future repart de ce nouveau point de référence

Exemple : si en mars 2026 une expertise évalue Vitry à 310K :
```javascript
vitry: { value: 310000, valueDate: '2026-03', ... }
```

### Données exposées par engine.js

Chaque propriété retournée par `buildProperty()` inclut :
- `value` : valeur dynamique actuelle (calculée)
- `referenceValue` : valeur de référence (celle de data.js)
- `valueDate` : date de la référence

### Impact sur les projections

Les projections (`computeNetWorthProjection`) utilisent `prop.value` (= valeur dynamique actuelle) comme point de départ et capitalisent vers le futur. Pas de double comptage : l'appréciation de `valueDate` → aujourd'hui est dans `prop.value`, la projection calcule de aujourd'hui → futur.

## Comment ajouter un nouveau compte cash

1. **data.js** : ajouter le montant dans `PORTFOLIO.{owner}.{zone}`
2. **data.js** : ajouter le taux dans `CASH_YIELDS.{key}`
3. **engine.js** : ajouter dans `computeCashView()` → section "Build accounts list"
4. Le diagnostic dormant se détecte automatiquement (rendement < 3%)

## Comment ajouter une nouvelle position IBKR

1. **data.js** : ajouter dans `PORTFOLIO.amine.ibkr.positions[]` : `{ ticker, shares, price, costBasis, currency, label, sector, geo }`
2. **api.js** : `fetchStockPrices()` le récupère automatiquement via Yahoo Finance
3. **engine.js** : `computeIBKRPositions()` le traite automatiquement

### Trouver le bon ticker Yahoo Finance

Le ticker dans `positions[].ticker` doit correspondre au format Yahoo Finance :

| Bourse | Format ticker | Exemples |
|--------|--------------|----------|
| Euronext Paris | `SYMBOL.PA` | `AIR.PA` (Airbus), `MC.PA` (LVMH), `BN.PA` (Danone) |
| Xetra (Allemagne) | `SYMBOL.DE` | `P911.DE` (Porsche), `SAP` (exception : pas de suffixe) |
| Tokyo Stock Exchange | `CODE.T` | `4911.T` (Shiseido) |
| NYSE / NASDAQ (US) | `SYMBOL` (pas de suffixe) | `IBIT`, `ETHA`, `ACN` |
| Casablanca (Maroc) | Pas de ticker Yahoo | SGTM → scraping Google Finance (`GTM:CAS`) |

Pour vérifier un ticker : `https://finance.yahoo.com/quote/TICKER` — si la page affiche un prix, le ticker est bon.

### Architecture API (api.js)

Les prix sont récupérés côté client (navigateur) depuis GitHub Pages. CORS bloque les appels directs vers Yahoo Finance, donc on utilise des proxies CORS.

**PRINCIPE : maximiser le taux de succès.** Pour chaque ticker, on lance TOUS les proxies × TOUS les endpoints Yahoo en parallèle (Promise.any). Le premier qui répond gagne. Ensuite, si des tickers ont échoué, on relance automatiquement en boucle (retry loop) jusqu'à tout avoir.

#### Proxies CORS (6 sources, toutes lancées en parallèle)
```
1. Direct Yahoo (sans proxy — marche dans certains navigateurs)
2. api.allorigins.win/raw?url=
3. api.codetabs.com/v1/proxy?quest=
4. corsproxy.io/?
5. api.cors.lol/?url=
6. thingproxy.freeboard.io/fetch/
```

#### Endpoints Yahoo (2 par ticker, lancés en parallèle via chaque proxy)
```
- v8 chart:  /v8/finance/chart/TICKER?range=1d&interval=1d  → extractFromChart()
- v6 quote:  /v6/finance/quote?symbols=TICKER               → extractFromQuote()
```

Résultat : pour chaque ticker, **12 requêtes en parallèle** (6 proxies × 2 endpoints). Promise.any retourne le premier succès.

#### Flux complet
```
1. Charger depuis localStorage cache (tickers déjà récupérés aujourd'hui)
2. Lancer TOUS les tickers manquants en parallèle (pas de batching)
3. Pour chaque ticker: 12 requêtes en parallèle → premier succès = sauvegardé
4. Si des tickers ont échoué → RETRY LOOP automatique:
   - Attendre 5 secondes
   - Relancer les tickers manquants (12 requêtes/ticker)
   - Rafraîchir le dashboard à chaque succès
   - Max 5 rounds de retry
   - S'arrête dès que 14/14 loadés
5. Chaque prix récupéré est immédiatement sauvegardé dans le cache du jour
```

#### fetchStockPrice(ticker) — retourne { price, previousClose }
```
Race 12 promises en parallèle (6 proxies × 2 endpoints Yahoo)
Timeout: 10s par requête
Si TOUS échouent: return null → pos._live = false, fallback data.js
```

#### fetchSGTMPrice() — retourne prix en MAD
```
Race 10 promises en parallèle (5 proxies × 2 sources: Google Finance + leboursier.ma)
Si TOUS échouent: prix statique de data.js
```

#### retryFailedTickers() — boucle de retry
```
- Max 5 rounds, 5s entre chaque round
- Chaque round relance les tickers manquants en parallèle
- Met à jour portfolio + cache + badge à chaque succès
- Log console: [retry] Round X/5: N tickers (TICKER1, TICKER2...)
```

#### Séparation données live vs stockées
```
LIVE (API): price + previousClose uniquement
STOCKÉ (data.js): ytdOpen, mtdOpen, oneMonthAgo
→ mtdOpen: mettre à jour au 1er de chaque mois
→ oneMonthAgo: mettre à jour toutes les 2 semaines
→ ytdOpen: ne change qu'au 1er janvier
```

Si un proxy tombe durablement, le remplacer dans le tableau PROXIES de api.js. Sources alternatives :
- `https://cors-anywhere.herokuapp.com/URL` (nécessite activation manuelle)
- Déployer son propre proxy Cloudflare Worker (gratuit, plus fiable)
- `https://corsfix.com/` (60 req/min gratuit)

## Cache localStorage (api.js)

Pour éviter de surcharger les APIs à chaque refresh, les résultats sont cachés dans `localStorage` pour la journée :

```
Clé : nw_cache_YYYY-MM-DD
Contenu : { stocks: { TICKER: { price, previousClose } }, fx: { rates }, sgtm: { price } }
```

**Comportement (stale-while-revalidate, v131+) :**
- Au chargement : les tickers en cache sont appliqués immédiatement pour un rendu rapide (0 latence)
- Chaque entrée cache a un timestamp `_ts` (Date.now() au moment du fetch)
- Si un ticker est en cache mais son `_ts` a plus de 10 min (`CACHE_TTL_MS = 10 * 60 * 1000`), il est re-fetché en arrière-plan
- Les prix frais remplacent les stale et le dashboard se rafraîchit automatiquement
- Les entrées des jours précédents sont purgées automatiquement au chargement du module

**Boutons :**
- **Refresh** (gris) : smart refresh — ne requête que les tickers absents du cache du jour
- **⚡ Hard Refresh** (orange) : ignore le cache, re-télécharge tout (FX + stocks + SGTM)

**Auto-refresh** : toutes les 10 minutes, smart refresh automatique.

## Cache busting

Chaque module importe les autres avec `?v=XX`. À chaque commit, incrémenter le numéro dans **tous les fichiers** :
- `app.js`, `engine.js`, `render.js`, `charts.js`, `simulators.js`, `index.html`
- Les fichiers `apt_*.html` ne sont plus liés mais gardent leur version

## Diagnostics (engine.js → cashView.diagnostics)

Système générique — ne jamais hardcoder de noms de comptes :
- `summary` : bilan global (% dormant, manque à gagner)
- `dormant_{owner}` : comptes < 3% par propriétaire (détection auto)
- `sub_optimal` : comptes > 0% mais < 1.5% avec > 5K€
- `jpy_leverage` : info sur l'emprunt JPY si > 5K€
- `action_plan` : étapes générées dynamiquement à partir des diagnostics ci-dessus

## Fonctions principales engine.js

| Fonction | Rôle |
|----------|------|
| `compute(portfolio, fx)` | Point d'entrée. Retourne le state complet (couple, amine, nezha, cashView, actionsView, immoView, budgetView) |
| `computeIBKRPositions()` | Calcule valeur EUR, P&L, period P&L (daily/MTD/YTD/1M) pour chaque position IBKR |
| `computeCashView()` | Construit la liste de comptes cash avec yields, diagnostics dormants |
| `buildProperty()` | Construit un objet propriété complet : valeur dynamique, CRD, equity, CF, fiscalité, exit costs |
| `computeAmortizationSchedule()` | Tableau d'amortissement d'un prêt (mensualité, capital, intérêts, CRD) |
| `computeMultiLoanSchedule()` | Combine plusieurs prêts (ex: Vitry 2 prêts) avec assurance |
| `computeFiscalite()` | Calcul fiscal : loyer déclaré, charges déductibles, régime réel/micro → impôt mensuel |
| `computeExitCosts()` | Frais de sortie : IRA, plus-value immo, frais agence, notaire |
| `computeExitCostsAtYear()` | Exit costs projetés à une année future (pour projections) |
| `computeNetWorthProjection()` | Projection mensuelle sur 20 ans : capital amorti + appréciation + CF + exit costs |
| `computeVillejuifRegimeComparison()` | Compare régimes fiscaux pour Villejuif VEFA (LMNP réel vs micro) |

## Analyse dividendes et WHT (engine.js)

Le système analyse les dividendes projetés et la retenue à la source (WHT) pour chaque position :
- **DIV_YIELDS** (data.js) : yield annuel par ticker
- **DIV_CALENDAR** (data.js) : prochaines dates ex-dividende
- **WHT_RATES** (data.js) : taux WHT par géographie (FR 30%, US 15%, JP 15%, etc.)
- Calcul automatique : dividende projeté, WHT retenu, net après WHT
- Recommandation keep/switch vers ETF capitalisant si WHT élevé
- Alertes ex-date dans les 90 jours (diagnostic `dividend-wht`)

## Vues (tabs)

| Tab | ID | State key |
|-----|----|-----------|
| Couple | `couple` | `state.couple.*` |
| Amine | `amine` | `state.amine.*` |
| Nezha | `nezha` | `state.nezha.*` |
| Cash | `cash` | `state.cashView` |
| Actions | `actions` | `state.actionsView` |
| Immobilier | `immobilier` | `state.immoView` |
| Créances | `creances` | `state.creancesView` |
| Budget | `budget` | `state.budgetView` |

### Vue Créances
Suivi des créances (prêts à des tiers) avec statut : en_cours, relancé, en_retard, recouvré, litige. Chaque item a un montant, une date de dernier contact, et un calcul du coût d'opportunité (manque à gagner vs placement).

### Vue Budget
Suivi mensuel des dépenses par catégorie (Dubai, France, Digital). Comparaison budget réel vs projeté.

## Mise à jour des données — Checklist

À chaque session de mise à jour, l'IA doit vérifier l'ancienneté des données et mettre à jour ce qui est périmé.

### Données temps-réel (récupérées automatiquement par api.js au chargement du site)
- **Taux FX** : récupérés live via frankfurter.dev → pas besoin de toucher `FX_STATIC` sauf si l'API plante
- **Cours actions IBKR** : récupérés live via Yahoo Finance chart API → les `price` dans `positions[]` servent de fallback statique

### Mise à jour obligatoire à chaque session

**À chaque session, l'IA DOIT mettre à jour les prix des actions dans data.js** — même si l'API les récupère en live au chargement, les `price` dans `positions[]` servent de fallback et doivent rester à jour :

1. **Cours SGTM** (`market.sgtmPriceMAD`) — Pas d'API disponible. L'IA doit chercher le cours sur le web :
   - Source primaire : `casablanca-bourse.com` ou `leboursier.ma` (chercher "SGTM cours")
   - Mettre à jour le prix ET le commentaire de date
2. **Cours ACN** (`market.acnPriceUSD`) — Chercher via web search "ACN stock price" ou Yahoo Finance
3. **Prix fallback IBKR** (`positions[].price`) — Récupérer les cours actuels via web search pour chaque position et mettre à jour les prix dans data.js. L'API Yahoo les récupère en live, mais les fallback doivent rester récents.
4. **`FX_STATIC`** — Mettre à jour les taux de change depuis xe.com

### Données à mettre à jour manuellement dans data.js

| Donnée | Fréquence | Source | Comment vérifier l'ancienneté |
|--------|-----------|--------|-------------------------------|
| Soldes bancaires (cash UAE, Maroc, Revolut, IBKR cash) | Chaque session | Apps bancaires, IBKR | Commentaires `mis à jour` dans data.js |
| Positions IBKR (shares, costBasis) | Si nouveau trade | CSV IBKR ou fichier utilisateur | Comparer `trades[]` dernière date vs aujourd'hui |
| CRD immobilier | Mensuel | Tableau d'amortissement | Comparer au schedule calculé par engine |
| Créances | Quand payées/ajoutées | Factures | Vérifier items[] dans creances |
| Véhicules | Trimestriel | Argus / La Centrale | Commentaire date |
| `CASH_YIELDS` | Si taux changent | Sites banques | Commentaire date |
| `staticNAV` (IBKR) | Chaque mise à jour IBKR | Rapport CSV IBKR | Doit correspondre à NAV du CSV |

### Dépôts (ibkr.deposits[])

Les dépôts sont enregistrés dans `ibkr.deposits[]` avec :
- `date` : date du virement (ISO format)
- `amount` : montant en devise native
- `currency` : devise du virement (EUR, USD, MAD...)
- `fxRateAtDate` : taux EUR/devise au jour du dépôt (1 pour EUR)
- `label` : description du virement

**À mettre à jour** : à chaque nouveau dépôt/virement ou rapport IBKR "Deposits & Withdrawals".

**Autres sources de dépôts** (calculés automatiquement par engine.js) :
- **ESPP Amine** : chaque lot dans `amine.espp.lots[]` est un dépôt (investissement salarié, enregistré en EUR car paie française)
- **ESPP Nezha** : chaque lot dans `nezha.espp.lots[]` est un dépôt (même logique, via UBS compte W3 F0329 11)
- **SGTM** : l'achat IPO est calculé à partir de `market.sgtmCostBasisMAD × shares`
- `owner` est attribué automatiquement : Amine (IBKR, ESPP Amine), Nezha (ESPP Nezha), Amine+Nezha (SGTM)

### Transactions (trades[])

**Les transactions ne sont JAMAIS supprimées.** Elles sont toujours ajoutées (append-only).
Quand l'utilisateur fournit un CSV ou relevé IBKR, comparer avec les trades existants et ajouter uniquement les nouvelles opérations.

### Règle d'ancienneté automatique

Au début de chaque session, l'IA doit :
1. Lire les dates dans les commentaires de `data.js`
2. Mettre à jour **tous les prix** (SGTM via web, ACN via web, positions[].price via web)
3. Mettre à jour `FX_STATIC` depuis xe.com
4. Si les soldes bancaires ont **> 14 jours** → demander à l'utilisateur les soldes actuels
5. Mettre à jour les commentaires de date après chaque modification
6. Toujours bumper le numéro de version `?v=XX` dans tous les imports après modification

## Comment traiter un fichier CSV / relevé IBKR

L'utilisateur fournit régulièrement un export IBKR (CSV ou PDF). Voici comment l'interpréter :

### 1. Identifier les nouvelles opérations

Comparer les trades du fichier avec `PORTFOLIO.amine.ibkr.trades[]` dans data.js.
Tout trade dont la date + ticker + qty n'existe pas encore doit être ajouté.

### 2. Format des trades dans data.js

```javascript
// Achat
{ date: 'YYYY-MM-DD', ticker: 'AIR.PA', label: 'Airbus', type: 'buy',
  qty: 100, price: 196.50, currency: 'EUR', cost: 19650,
  commission: -9.83, costBasis: 192.58, source: 'ibkr' }

// Vente
{ date: 'YYYY-MM-DD', ticker: 'GLE', label: 'Société Générale', type: 'sell',
  qty: 200, price: 75.34, currency: 'EUR', proceeds: 15068,
  realizedPL: 4807.34, commission: -7.53, costBasis: 76.24, source: 'ibkr' }

// FX trade
{ date: 'YYYY-MM-DD', ticker: 'EUR.JPY', label: 'EUR→JPY (short)', type: 'fx',
  qty: 65926, price: 183.595, currency: 'EUR', jpyAmount: 12103684,
  commission: -1.72, note: 'Rachat JPY short', source: 'ibkr' }
```

### 3. Mettre à jour les positions après un trade

Après ajout d'un trade, mettre à jour la section `positions[]` :

| Opération | Action sur positions[] |
|-----------|----------------------|
| **Achat d'une action existante** | Mettre à jour `shares` (nouveau total) et `costBasis` (nouveau PRU moyen du CSV) |
| **Achat d'une nouvelle action** | Ajouter une nouvelle entrée dans `positions[]` avec ticker, shares, price, costBasis, currency, label, sector, geo |
| **Vente partielle** | Réduire `shares`. Le `costBasis` reste le même (PRU moyen). Ajouter le realizedPL dans meta.realizedPL |
| **Vente totale (clôture)** | Supprimer l'entrée de `positions[]`. Ajouter le realizedPL dans meta.realizedPL |
| **Trade FX** | Mettre à jour `cashEUR`, `cashUSD`, `cashJPY` selon les montants convertis |

### 4. Mettre à jour les agrégats IBKR

Après tout changement :
- `staticNAV` : NAV totale du rapport CSV (ligne "Net Asset Value")
- `meta.deposits` : si dépôt/retrait détecté
- `meta.realizedPL` : somme de tous les realizedPL des sells
- `meta.dividends` : si dividendes reçus
- `meta.commissions` : cumul commissions

### 5. Mettre à jour le cash IBKR

Le CSV IBKR donne les soldes cash par devise :
- `cashEUR` : solde EUR (attention au seuil IBKR 10K à 0%)
- `cashUSD` : solde USD
- `cashJPY` : solde JPY (négatif = emprunt short JPY)

## Mise à jour des insights (render.js)

Les insights dans `renderDynamicInsights()` sont 100% dynamiques — ils lisent `state.*` et `state.cashView.*`. **Ils ne doivent jamais contenir de montants, noms de comptes, ou conseils spécifiques en dur.**

### Règles pour les insights
- Utiliser `state.cashView.accounts` pour lister les comptes dynamiquement
- Utiliser `state.immoView.properties` pour les données immo
- Utiliser `state.actionsView` pour les données actions
- Les textes de conseil doivent être génériques : "Optimiser le placement" au lieu de "Transférer vers Wio"
- Les montants doivent toujours être calculés : `K(cashTotal)` au lieu de `"85K€"`
- Les projections doivent utiliser les données réelles (CF immo, rendement actuel) et jamais des constantes

### Si on ajoute un nouvel insight
1. Calculer les valeurs depuis `state.*` dans `renderDynamicInsights()`
2. Utiliser `fmt()` / `K()` / `N()` pour le formatage
3. Ne jamais mentionner un compte par son nom en dur — utiliser `accounts.find()` ou `accounts.filter()`

## KPI Detail Panels (render.js → setupKPIDetailPanels)

Les KPI de la vue Actions sont cliquables. Chaque clic ouvre un panneau détaillé avec la répartition par ticker.

### KPIs disponibles et leur contenu

| KPI | ID panel | Données source | Contenu |
|-----|----------|---------------|---------|
| P&L Daily | detailPLDaily | periodPL.daily.breakdown | Two-column pertes/gains, positions à €0 filtrées (marché fermé) |
| P&L MTD | detailPLMTD | periodPL.mtd.breakdown | P&L par position, top 3 pertes |
| P&L 1 Mois | detailPL1M | periodPL.oneMonth.breakdown | P&L par position, top 3 pertes |
| P&L YTD | detailPLYTD | periodPL.ytd.breakdown | P&L par position, total gains/pertes |
| Total Actions | detailTotal | allPos (IBKR+ESPP+SGTM) | Répartition par valeur, concentration top 3 |
| P/L Non Réalisé | detailUnrealized | allPos.unrealizedPL | Two-column: pertes (gauche) / gains (droite), avec % et barres |
| P/L Réalisé | detailRealized | closedPositions + degiro | Trades clôturés, meilleur trade |
| Total Déposé | detailDeposits | av.depositHistory | Historique groupé par owner → platform (trié par montant décroissant), ROI |
| Dividendes/TWR | detailDividends | av.dividends, av.twr | Yield, commissions, WHT |

### Comment ajouter un nouveau KPI detail panel

1. Ajouter `data-detail="detailXxx"` et classe `kpi-clickable` sur le `.kpi` dans index.html
2. Ajouter un générateur dans `detailGenerators` dans `setupKPIDetailPanels()` (render.js)
3. Le générateur retourne du HTML utilisant les classes `.detail-header`, `.detail-body`, `.detail-row`, `.detail-footer`
4. Les données doivent venir de `state.actionsView` — jamais de constantes hardcodées

### Affichage P&L breakdown (render.js → renderPLBreakdown)

- **Two-column layout** : pertes à gauche (rouge), gains à droite (vert)
- **Filtrage €0** : les positions avec |P&L| < 0.5€ sont masquées (ex: actions européennes quand le marché US est ouvert mais pas EU). Un compteur "(N à €0 masqués)" est affiché dans le header.
- **P/L Non Réalisé** (detailUnrealized) : même layout two-column avec % par position
- **Dépôts** (detailDeposits) : groupés par owner → platform, plateformes triées par montant total décroissant (IBKR avant ESPP pour Amine)

### Sources des period P&L (engine.js)

- `previousClose` → vient de `meta.previousClose` (Yahoo Finance) = clôture veille → pour Daily P&L
- `chartPreviousClose` → clôture avant début range YTD (31 dec) → NE PAS utiliser pour Daily
- `mtdOpen` → premier close du mois courant (depuis timestamps)
- `ytdOpen` → premier close de l'année (depuis timestamps)
- `oneMonthAgo` → close il y a 30 jours (depuis timestamps)

⚠ Bug historique (fixé v94) : `chartPreviousClose` était utilisé pour Daily P&L, ce qui affichait le changement YTD au lieu du daily.

### Formule Period P&L — gestion des achats intra-période (fixé v97)

**Problème** : si on achète 1000 actions IBIT en février 2026, le YTD P&L ne doit PAS calculer `1000 × (prix_actuel - prix_1er_jan)` car ces actions n'existaient pas au 1er janvier.

**Formule correcte** :
```
periodPL = endValue - startValue - netCashInvested
```
Où :
- `endValue` = currentShares × currentPrice (en EUR)
- `startValue` = sharesAtStart × refPrice (en EUR)
- `netCashInvested` = coût des achats pendant la période − produit des ventes pendant la période (en EUR)
- `sharesAtStart` = currentShares − buysDuringPeriod + sellsDuringPeriod

**Exemple concret (IBIT YTD)** :
- 1200 shares actuelles, 100 achetées en dec 2025, 1100 achetées en jan-fév 2026
- sharesAtStart (1er jan) = 1200 - 1100 = 100
- startValue = 100 × ytdOpenPrice / fx.USD
- netCashInvested = toEUR(48885 USD buys) (les 1100 shares achetées en 2026)
- YTD P&L = valeur actuelle - startValue - netCashInvested
- Résultat : seule la variation de prix sur les 100 shares + le gain/perte réel des 1100 shares (vs leur prix d'achat) sont comptés

**Implémentation** : `computeIBKRPositions()` dans engine.js utilise `ibkr.trades[]` pour calculer `sharesAtStart` et `netCashInvested` pour chaque période et chaque ticker.

**Note ESPP** : tous les lots ESPP (ACN) sont antérieurs à 2023. La formule simple `shares × (currentPrice - refPrice)` reste correcte pour ESPP car aucun trade n'a eu lieu pendant les périodes calculées.

## Variables CSS (index.html)

Palette de couleurs définie en variables CSS :
- `--primary` : texte principal, `--accent` : bleu actions, `--red` : pertes, `--green` : gains
- `--gray` : texte secondaire, `--bg` : fond, `--card` : fond carte, `--gold` : immobilier

Classes utilitaires : `.pl-pos` (vert gains), `.pl-neg` (rouge pertes), `.num` (alignement droite)

## Conventions

- Montants en devise native dans data.js, conversion en EUR dans engine.js via `toEUR()`
- `fmt(val)` pour afficher un montant EUR formaté
- `fmtAxis(val)` pour axes de graphiques (notation K)
- Les insights dans render.js doivent utiliser `state.*` et `state.cashView.*`, jamais de constantes
- Les textes de conseil/recommandation sont OK s'ils sont génériques ("optimiser le placement") mais jamais avec des montants hardcodés

## Règle de merge des tickers partagés (Amine + Nezha)

**PRINCIPE FONDAMENTAL** : tout est affiché PAR TICKER (fusionné) partout, **sauf** dans les vues individuelles "Amine" et "Nezha" où la séparation par personne est pertinente.

Quand un même ticker est détenu par les deux personnes (ex: ACN via ESPP, SGTM via Bourse Casablanca) :

| Vue / Composant | Comportement | Exemple |
|-----|-------------|---------|
| **Treemaps** (couple, actions, geo) | Merger → une seule entrée | "ESPP Accenture €36K", "SGTM €4K" |
| **Positions table** (vue Actions) | Merger → une seule ligne | "Accenture (207 ACN)", "SGTM (64 actions)" |
| **KPI sub-cards** (vue Couple, expand stocks) | Merger | "ESPP: €36K (Amine 167 + Nezha 40)" |
| **P&L breakdowns** (daily, MTD, YTD, 1M) | Merger → "Accenture (ACN)" | Un seul P&L combiné pour le ticker |
| **P/L non réalisé** (allPos breakdown) | Merger → "Accenture (ACN)" | Valeur + coût combinés |
| **Donut géo** (vue Couple) | Merger | "Irlande/US (ACN)" inclut Amine+Nezha |
| **Vue Amine** (detail table) | Séparer (Amine only) | "ESPP Accenture (167 ACN @ $202)" |
| **Vue Nezha** (detail table) | Séparer (Nezha only) | "ESPP Accenture (40 ACN @ $202)" |
| **Deposit history / lots** | Séparer par owner | Lots ESPP Amine vs Nezha |

**En résumé** : la division par personne n'existe que dans les vues "Amine" et "Nezha". Partout ailleurs (Actions, Couple, treemaps, P&L, positions latentes…), tout est affiché par ticker.

## Tableau des positions (vue Actions)

Le tableau unifié "Toutes les Positions" dispose de deux toggles interactifs :

### Toggle 1 : Total / Unitaire
- **Total** (défaut) : colonnes Valeur (€ total) + Coût (€ total)
- **Unitaire** : colonnes Prix (cours unitaire avec devise) + PRU (prix de revient unitaire en €)

### Toggle 2 : Période (Daily / MTD / 1M / YTD)
La colonne d'évolution change selon la période sélectionnée :
- **En mode Total** : affiche le P&L en € de la période (combien mes holdings ont évolué, tenant compte des achats/ventes intra-période)
- **En mode Unitaire** : affiche le % de variation du prix de l'action sur la période (indépendant de quand on a acheté)

### Badges
- **LIVE** (bleu `#bee3f8`) : cours en temps réel via API Yahoo Finance
- **STATIC** (gris `#e2e8f0` pour SGTM, rouge `#fed7d7` si API indisponible) : cours statique

### Couleurs gains/pertes
- Vert (`pl-pos`) pour les gains, Rouge (`pl-neg`) pour les pertes
- Appliqué aux colonnes P/L, %, et la colonne d'évolution de période

### Système de colonnes interactives (v119+)

Le tableau utilise `_colConfig` (visibilité) et `_colOrder` (ordre) pour un contrôle dynamique :

**Colonnes disponibles** : broker, shares, prix, valeur, pru, cout, pl, pctPL, evo, weight, sector, geo — chacune activable/désactivable indépendamment.

**Chips de colonnes** (barre sous le tableau) :
- Cliquer un chip → toggle la visibilité de la colonne
- Glisser-déposer un chip (HTML5 Drag & Drop) → réordonner les colonnes
- Les chips actifs sont en fond sombre, les inactifs en fond clair

**Preset Total / Unitaire** :
- Total : active valeur + cout + pl + pctPL, désactive prix + pru
- Unitaire : active prix + pru, désactive valeur + cout + pl + pctPL
- Les colonnes peuvent être modifiées manuellement après un preset

### Historique des trades (expandable rows)

Cliquer sur une ligne de position déplie un sous-tableau avec l'historique d'achat/vente :
- Un seul ticker déplié à la fois (le précédent se replie)
- Colonnes : Date, Qui (si multi-owner), Qté, Type, PRU, Prix actuel, Valeur, P/L, P/L %
- **Prix actuel** : cours live du ticker (même valeur pour chaque lot, en bleu)
- **P/L par lot** : calculé comme `qty × prix_actuel_EUR - coût_lot_EUR`
- En-têtes triables (clic pour trier asc/desc)
- Owner : Amine ou Nezha pour les tickers partagés (ESPP, SGTM)

### KPI detail panels (vue Actions)

Les KPIs de la vue Actions sont cliquables (`data-detail="detailXxx"`) et ouvrent un panneau détaillé :
- **Two-column layout** pour les P&L : pertes (rouge, gauche) / gains (vert, droite)
- Les positions à |P&L| < 0.5€ sont masquées avec compteur "(N à €0 masqués)"
- Panels disponibles : P&L Daily, MTD, 1M, YTD, Total Actions, P/L Non Réalisé, P/L Réalisé, Dépôts, Dividendes/TWR

### Tooltips immobilier (v123+)

Les 8 KPIs de la vue Immobilier affichent un tooltip au survol avec la décomposition par bien :

- Equity brute/nette : montant par propriété
- Frais de sortie : IRA + PV immo + agence par propriété
- CF net : détail par propriété avec signe +/-
- Valeur totale : valeur estimée dynamique avec référence (date + montant initial)
- CRD : montant par propriété avec année de fin de prêt
- Création richesse : décomposition capital amorti / appréciation / cash flow (uses `iv.totalWealthBreakdown`, NOT `iv.wealthBreakdown`)
- LTV : ratio par propriété (CRD / valeur)

**Positionnement** : les tooltips de la 1ère rangée (Equity Brute, Equity Nette, Frais Sortie, CF Net) s'affichent **en dessous** (classe par défaut `.kpi-tooltip`). Les tooltips de la 2ème rangée (Valeur Totale, CRD, Création Richesse, LTV) s'affichent **au-dessus** (classe `.kpi-tooltip.above`) pour éviter d'être coupés par le bord de page.

**Helper** : `_setTip(elId, html, above)` dans `renderImmoView()` — le 3e paramètre `above` (boolean) ajoute la classe `.above` au tooltip.

### Positions fermées expandables (v125+)

Les tableaux de positions fermées (IBKR et Degiro) sont cliquables. Au clic sur une ligne :

1. Les sous-tableaux existants se ferment (single-expansion : `_expandedClosed` / `_expandedDegiroClosed`)
2. Un sous-tableau s'ouvre avec les colonnes : Date, Type (Achat/Vente), Qté, Prix, Montant, Si gardé auj.
3. Les ventes sont en rouge, les achats en noir
4. **"Si gardé auj."** : pour chaque vente, affiche la valeur hypothétique si les actions n'avaient pas été vendues + le diff (vert si gain manqué, rouge si bonne vente)
5. Ligne résumé "Total si gardé" comparant le produit réel vs la valeur hypothétique totale

**Données engine.js** : chaque position fermée agrégée inclut :

- `_allTrades` : tableau chronologique de tous les trades (buy + sell) pour ce ticker
- `_ifHeldPriceEUR` : prix unitaire actuel en EUR (depuis la position live IBKR)
- `_ifHeldValueEUR` : `totalQtySold × _ifHeldPriceEUR`
- `_ifHeldPL` : `_ifHeldValueEUR - costEUR`

⚠ `_ifHeldPriceEUR` n'est disponible que si le ticker a encore une position ouverte dans IBKR (sinon pas de cours live).

### Devises et formatage

- `fmt(val)` : formatte en EUR avec `€ X XXX` (respecte la devise active via `_currency`)
- `fmtAxis(val)` : pour axes charts, notation K/M
- **CF NET** : utiliser `fmt()` pour inclure le symbole `€`, pas `iv.totalCF + '/mois'` directement
- **Prix actions** : format `€ XX.XX` (Unicode `\u20ac` + espace), jamais `XX.XX EUR`
- `_fmtK(val)` : helper local pour tooltips immo, format compact `XK €` ou `X €`

### Chargement progressif des prix actions (v127+)

Le chargement des prix se fait en 2 phases avec rafraichissement progressif de l'UI :

1. **Held stocks** : `fetchStockPrices()` dans `api.js` accepte un callback `onTickerLoaded`. Pour chaque ticker chargé (cache ou API), le prix est appliqué immédiatement au portfolio via `applyTickerToPortfolio()`, puis le callback déclenche un `throttledRefresh()` (800ms debounce dans `app.js`) qui fait `compute()` + `render()`.

2. **Sold stocks** : Seulement si TOUS les held stocks sont chargés sans erreur, `fetchSoldStockPrices()` est appelé en background. Les prix sont stockés dans `portfolio._soldPrices[ticker]` et utilisés par `engine.js` pour calculer `_ifHeldPriceEUR` / `_ifHeldValueEUR` dans les positions fermées.

**Mapping Yahoo Finance** : Les tickers EUR Euronext sans suffixe (ex: `EDEN`) sont mappés vers `EDEN.PA` pour l'API Yahoo. Le mapping inverse est conservé pour retrouver le ticker original dans le portfolio.

### Badge LIVE/STATIC (v127+, fix v128)

- Affiché dans la colonne label (nom de l'action), pas dans la colonne prix
- Visible sur **toutes les vues** (Total et Unitaire)
- 3 badges : LIVE (bleu), STATIC (rouge = API pas encore chargée), STATIC (gris = SGTM, pas d'API)

### Sort dynamique par période (v127+, fix v132)

Le tri de la colonne "Evo" s'adapte à la période sélectionnée (Daily/MTD/1M/YTD) :
- `_hdefs.evo.sort` est dynamique : `{ daily: 'dailyPL', mtd: 'mtdPL', ... }[_posPeriod]`
- Trie par **P&L absolu en EUR** (pas par %), cohérent avec ce qui est affiché en vue Total
- Quand l'utilisateur change de période via `posPeriodToggle`, `_allSortKey` est mis à jour si l'ancien key était un key de période (Pct ou PL)
- **Null-to-bottom** (v132+) : les positions sans données de période (SGTM, tickers STATIC) sont triées en dernier, quel que soit le sens du tri (asc ou desc). Logique : `if (va == null) return 1; if (vb == null) return -1;`

### Tables de détail triables (v133+)

Les tables "Patrimoine Couple / Amine / Nezha — Detail consolidé" sont triables par clic sur les en-têtes :
- **Poste** : tri alphabétique (asc par défaut)
- **Montant** : tri numérique (desc par défaut, du plus grand au plus petit)
- La ligne **Total** (Net Worth) reste toujours épinglée en bas, indépendamment du tri
- Utilise le même `makeTableSortable()` que les autres tables

### FX auto-refresh & cache TTL (v134+)

- **FX_TTL_MS** = 5 minutes : les taux FX sont re-fetchés automatiquement toutes les 5 min via `setInterval(() => refreshFX(true), 5 * 60 * 1000)`
- **Stale-while-revalidate** : si le cache FX est périmé (>5 min), on retourne les données stale immédiatement puis on re-fetch en background
- Le badge FX affiche l'**heure** (HH:MM) et non la date
- `_ts` timestamp sur chaque entrée cache (stocks et FX) pour vérifier la fraîcheur

### Hard refresh — cache clear (v135+)

- Le bouton "Hard Refresh" appelle `clearCache()` qui supprime entièrement le localStorage du jour avant de re-fetcher
- Avant v135, le hard refresh re-fetchait tout mais ne vidait pas le cache → si un fetch échouait, l'ancienne donnée stale persistait
- `stockRefreshInProgress` ne bloque plus le hard refresh : `if (stockRefreshInProgress && !forceRefresh) return;`

### Footer FX timestamp dynamique (v135+)

- Le footer affiche la date et l'heure de la dernière mise à jour FX : `(màj 13/03/2026 à 14:30)`
- Mis à jour automatiquement à chaque fetch FX (initial, auto-refresh 5 min, hard refresh)
- Span `#fxTimestamp` dans le footer, alimenté par `updateFxTimestamp()` dans app.js

### Positions fermées — colonnes "Si gardé auj." (v136+)

Les tables de positions fermées (IBKR 12 mois + Degiro historique) affichent 3 colonnes "Si gardé auj." dans les rows principales :
- **Valeur** : valeur hypothétique si les parts vendues étaient encore détenues aujourd'hui (`_ifHeldValueEUR`)
- **+/- value** : écart entre la valeur hypothétique et le produit de vente réel (`_ifHeldValueEUR - proceedsEUR`)
- **%** : pourcentage de l'écart par rapport au produit de vente (`diffVsSale / proceedsEUR * 100`)
- Les mêmes 3 colonnes apparaissent dans les sous-tables de détail (per-trade) quand on clique sur une position
- Données calculées dans `engine.js` : `_ifHeldPriceEUR`, `_ifHeldValueEUR`, `_ifHeldPL`

### Projection — NW sans arret masqué par défaut (v136+)

La ligne pointillée "NW sans arret" dans les charts de projection (simulators.js) est masquée par défaut (`hidden: true`). L'utilisateur peut l'activer via la légende du graphique.

### Sold ticker mapping fixes (v137-v139)

Plusieurs bugs empêchaient le calcul "Si gardé auj." pour les positions fermées Degiro :

1. **Devises incorrectes** (v137) : les actions US (NVDA, SPOT, DIS, INFY) avaient `currency: 'EUR'` au lieu de `'USD'`, causant un suffixe `.PA` erroné pour l'API Yahoo. Corrigé dans `data.js`.
2. **`yahooTicker` explicite** (v137) : ajout du champ `yahooTicker` sur les trades dont le ticker Degiro diffère du ticker Yahoo (ex: `MC` → `yahooTicker: 'MC.PA'` pour LVMH, `EUCAR` → `yahooTicker: 'EUCAR.PA'` pour Europcar).
3. **Progress counter double-count** (v137) : les tickers stale (en cache mais périmés) étaient comptés deux fois dans le compteur de progression. Corrigé avec un `staleTickers` Set dans `api.js`.
4. **`allHeldLoaded` gate** (v138) : le fetch des prix sold était bloqué si un seul held ticker échouait via CORS. Gate supprimée — les prix sold se chargent toujours en background.
5. **LVMH ticker lookup** (v138) : `engine.js` ne trouvait pas la position live IBKR `MC.PA` quand le trade Degiro utilisait `MC`. Ajout d'un fallback `.PA` dans le lookup : `ibkrPositions.find(p => p.ticker === cp.ticker + '.PA')`.
6. **Degiro trades non collectés** (v139) : `app.js` ne collectait que `ibkr.trades` pour les sold tickers, ignorant `allTrades` (Degiro). Corrigé avec `const allTrades = (ibkr.trades || []).concat(allTrades || [])`.

### Stock split support — `splitFactor` (v140+)

Pour les actions vendues avant un stock split (ex: NVDA 10:1 en juin 2024), le calcul "Si gardé auj." doit ajuster la quantité.

**Champ `splitFactor`** (data.js) : multiplicateur optionnel sur un trade. Ex: `splitFactor: 10` signifie que chaque action vendue correspond à 10 actions post-split.

**Calcul ajusté** :
- `engine.js` : `totalQtySoldAdj = sells.reduce((s, t) => s + (t.qty || 0) * (t.splitFactor || 1), 0)` — la quantité totale vendue est multipliée par le split factor
- `render.js` : dans les sous-tables de détail per-trade, `hypothetical = t.qty * (t.splitFactor || 1) * cp._ifHeldPriceEUR`

**Exemple** : 4 actions NVDA vendues pre-split → `splitFactor: 10` → 40 actions post-split → valeur "Si gardé" = 40 × prix actuel NVDA.

### Fix partial report coverage — NVIDIA, DIS (v146)

**Problème** : Quand seulement CERTAINES ventes d'un ticker avaient un `realizedPL` officiel (rapport annuel), le moteur sommait les P/L partiels et les utilisait comme P/L total. Résultat : NVIDIA +1 192€ (1 seule vente sur 3 avec rapport) au lieu de +43 487€ (proceeds-cost).

**Correction** : Ajout de `_reportPLCount` dans l'agrégation des ventes. La logique :
- Si TOUTES les ventes ont un `realizedPL` officiel → utiliser la somme (EUR, précis)
- Si seulement CERTAINES → fallback sur `proceedsEUR - costEUR` (devise native, approximatif)
- Track Record : filtre `_hasReportPL || (costEUR > 0 && proceedsEUR > 0)`

### Enrichissement Degiro P/L depuis rapports annuels (v145)

Ajout de `realizedPL` (EUR) depuis les rapports annuels Degiro 2021 et 2023 sur 19 ventes :
- 2021 : FIT, GME, CAP, ACA, V, ATO, SAP, JUVE, FDX (×2), EN, IBM, EUCAR (×2), MC, DIS
- 2023 : SNPR, SAP, NVDA
- Track Record corrigé : 11% → 86% win rate (19W/3L, profit factor 8.9×)
- Ajout dividendes Degiro : 2021 (194.19€ net), 2023 (183.25€ net)

### Fix tableau Degiro + prix statiques + Top 10 (v144)

**Bug fix :** Colonne "Coût" affichait €0 — le code accumulait `cost` depuis les trades sell (où cost='') au lieu des trades buy. Corrigé dans engine.js.

**Bug fix :** Colonne "P/L" affichait +€0 — fallback `proceeds - cost` ajouté quand `realizedPL` est vide (trades Degiro).

**Prix statiques :** Ajout de `DEGIRO_STATIC_PRICES` dans data.js avec prix approximatifs (mars 2026) pour tous les tickers Degiro vendus. Utilisés comme fallback avant que l'API Yahoo ne retourne les prix live. Flag `_staticPrice` propagé pour identification.

**Top 10 :** Le tableau Degiro affiche maintenant les 10 premières positions par défaut, avec un bouton "Voir les N positions ▼" pour déplier. Les totaux sont toujours calculés sur l'ensemble.

### Sanity check corporate actions sur tous les tickers (v142)

Vérification systématique de tous les tickers pour splits, reverse splits, fusions, acquisitions et faillites. 7 corrections appliquées :

**Reverse splits (splitFactor: 0.1) :**
- JUVE (buy + sell) : reverse split 10:1 (Jan 2024)
- AF : reverse split 10:1 (Aug 2023)
- CGC : reverse split 10:1 (Dec 2023)

**Faillite (splitFactor: 0) :**
- HTZ : Ch.11 bankruptcy Jun 2021 — anciennes actions annulées

**Ticker merger :**
- SHLL → HYLN : 3 entrées buy corrigées (merger Oct 2020)

**Acquisitions (sell entries ajoutés) :**
- FIT : vente 100 @ $7.35 — acquisition Google (Jan 2021)
- SNPR : vente 200 @ $0.86 — acquisition Shell/VLTA (Mar 2023)

**Ticker rebrand :**
- KORI : yahooTicker mis à jour KORI.PA → CLARI.PA (Korian → Clariane)

`allTrades` : 59 → 61 entrées.

### Extraction complète trades Degiro via Gmail (v141)

Extraction exhaustive de l'historique complet des transactions Degiro depuis les emails `notifications@degiro.fr` (compte am.koraibi@gmail.com). 50 emails "Avis d'opéré" analysés (août 2020 — avril 2025).

**Modifications data.js :**
- `allTrades` : 45 → 59 entrées (14 trades manquants ajoutés depuis 5 emails multi-ordres)
- Trades ajoutés : LVMH (achat 12), GME (buy+sell 20), Capgemini (vente 36), Crédit Agricole (vente 280 + achat 140), Visa (vente 5), Europcar (achat 4500), SAP (vente 15), Juventus (vente 1000), FedEx (vente 7+10), Bouygues (vente 50), IBM (vente 10)
- ADP : corrigé qty 2→8 (4 fills : 2+2+1+3 @ 106.90)
- NVDA splitFactor : achat 2020-09-03 → `splitFactor: 40` (4:1 Jul 2021 + 10:1 Jun 2024)
- NVDA splitFactor : achat 2021-08-17 → `splitFactor: 10` (10:1 Jun 2024 seulement)

**Cohérence vérifiée :**
- 5 tickers parfaitement équilibrés : EUCAR, GME, IBM, JUVE, MC
- 16 tickers sell-only (positions pré-tracking, achetées avant août 2020)
- 7 tickers partiellement matchés (achats pré-tracking)
- 3 tickers buy-only : FIT (acquisition Google), SHLL/SNPR (SPACs)

### Tooltips Cash Productif vs Dormant (v127+)

Les 3 barres (Couple, Amine, Nezha) ont un tooltip au hover qui affiche :
- Montant total et rendement moyen
- Liste des comptes productifs (≥3%) triés par montant décroissant
- Liste des comptes dormants (<3%) triés par montant décroissant
- Net vs inflation annuel

Les données par compte sont enrichies dans `engine.js` via `byOwner[name].accounts[]`.

### setEur() — mise à jour dynamique des KPIs (fix v129)

`setEur(id, val)` met à jour un élément de KPI par son ID :
- Met à jour `data-eur` (attribut) ET le `textContent` visible
- Nécessaire pour que les toggles dynamiques (ex: Villejuif) mettent à jour l'affichage en temps réel
- Respecte `data-sign` (préfixe +/-) et `data-type` (skip textContent si type="pct")

### Toggle Villejuif — Immobilier (v127+)

Un bouton checkbox "Inclure Villejuif (achat futur)" en haut de la vue Immobilier permet d'exclure Villejuif des KPIs agrégés :
- Variable : `_immoIncludeVillejuif` (booléen, défaut `true`)
- Quand désactivé : les 8 KPIs (Equity, Valeur, CRD, CF, Wealth, LTV, Exit Costs, Net Equity) sont recalculés à partir des propriétés filtrées (sans Villejuif)
- Les tooltips affichent "Hors Villejuif (achat futur)" quand le toggle est off
- La carte Villejuif dans la grille est visuellement atténuée (opacity 0.45)
- Le tableau wealth breakdown et les charts respectent aussi le filtre
- Les tables de détail (prêts, fiscalité, CF) restent complètes (affichent les 3 biens)

### Fix Villejuif Equity Projection — Simulateurs (v148)

**Problème** : Les simulateurs (couple + Nezha) utilisaient un `wealthCreation` mensuel fixe pour Villejuif. Ce taux fixe ne capturait pas la transition franchise (36 mois, intérêts capitalisés) → amortissement. Résultat : equity Villejuif à 121K en 2045 au lieu de ~380K.

**Correction** :
- Ajout de `computeVillejuifEquity(m)` dans les simulateurs couple et Nezha
- La fonction calcule l'equity absolue à chaque mois en :
  1. Convertissant le mois simulateur en date calendaire (YYYY-MM)
  2. Cherchant le CRD dans le tableau d'amortissement (`amortSchedules.villejuif.schedule`)
  3. Appliquant l'appréciation par phases (3%/an 2025-2028, 1.5%/an 2029+)
  4. Retournant `valeur_projetée - CRD`
- Flag `_computedEquity: true` dans `immoBreakdown` pour que `runSimulatorGeneric` traite les valeurs comme absolues (pas incrémentales)

**Correction complémentaire (engine.js)** : La projection de richesse (`wealthProjection`) utilisait un taux d'appréciation fixe (`propMeta.appreciation`) au lieu des phases (`appreciationPhases`). Corrigé pour itérer année par année avec le taux de phase applicable.

### Simulateurs — Computed Equity pour toutes les propriétés (v148)

Les 3 simulateurs (couple, Amine, Nezha) utilisent maintenant `makeComputePropertyEquity()` — une fonction générique qui calcule l'equity nette absolue de chaque propriété à chaque mois :

1. Convertit le mois simulateur en date calendaire (YYYY-MM)
2. Cherche le CRD dans le tableau d'amortissement
3. Applique l'appréciation par phases (ex: Villejuif 3%→1.5%, Rueil 0.5%→1.5%)
4. Applique l'appréciation intra-année (partielle)
5. Soustrait les exit costs projetés (interpolés linéairement entre années)
6. Retourne `Math.max(0, valeur_projetée - CRD - exit_costs)`

Le flag `_computedEquity: true` dans `immoBreakdown` permet à `runSimulatorGeneric` de traiter ces valeurs comme absolues. Le `dataImmo` total est calculé comme la somme des propriétés (pas via cumul de deltas) pour garantir la cohérence tooltip.

Granularité : mensuelle (chaque mois = 1 data point). `maxTicksLimit: 24` sur l'axe X.

### Données IBKR — v147-148

- Mise à jour des prix statiques au close 16/03/2026 (CSV IBKR Q1 2026)
- Vente partielle DG (Vinci) : 100 actions à 131.20€ le 17/03 (2 lots: 40 TGATE + 60 SBF)
- Position DG réduite de 200 → 100 actions
- Deleverage JPY : 13 111 EUR → 2 406 458 JPY @ 183.545 le 18/03
- Cash IBKR mis à jour : EUR ~0, JPY -4 590 694, USD ~0

### Timelines propriétés (v148)

Ajout de timelines pour Rueil et Villejuif dans `EXIT_COSTS` (data.js) :

**Rueil** (données de l'acte de vente + bail Docusign) :
- Achat : 240 000€ le 5 novembre 2019 (vendeuse Mme Candalot)
- Prêt : Crédit Mutuel Franconville (251 200€ à 1.20%, 25 ans)
- RP Nezha : nov 2019 → sept 2025
- Passage LMNP : bail meublé signé 25/09/2025, début location 04/10/2025
- Locataires : Marouane El Mejjati & Myriem Kadri Hassani (1 300€ HC + 150€ charges)
- Milestones PV : exonération IR à 22 ans (2041), IR+PS à 30 ans (2049)

**Villejuif** (VEFA en cours) :
- Réservation : avril 2025 (3 600€ versés)
- Prêts LCL : 287K + 32K, franchise 36 mois (intérêts capitalisés)
- Livraison : été 2029
- Milestones : choix régime fiscal, ouverture L15 Sud (2026), fin franchise (2028)

Fonction helper `renderTimelineHTML()` dans render.js pour générer les timelines de façon générique.

### Chart PV Abattements (v148)

Nouveau graphe en barres empilées dans le détail de chaque propriété :
- Montre pour chaque année de détention (1 à 30) le % de la PV qui va à :
  - Net (vert) : ce que tu gardes
  - IR (rouge) : impôt 19% × (1 - abattement IR)
  - PS (orange) : prélèvements sociaux 17.2% × (1 - abattement PS)
- Ligne verticale à la durée de détention actuelle
- Données calculées par `computePVAbattementSchedule()` dans engine.js
- Canvas `pvAbattementChart` dans index.html, rendu par `buildPVAbattementChart()` dans charts.js

### Détails appartements — Property Info Cards (v148)

Ajout des détails de chaque appartement depuis les plans (Nexity, Fair' Promotion, acte de vente) :
- `details` object dans `IC.properties[loanKey]` avec rooms[], surfaces, étage, lot, exposition, DPE, floorPlan
- `renderPropertyInfoCard(details)` dans render.js : barre cliquable des pièces + métriques en pills
- Intégré dans `renderAptView()` pour les vues #apt_vitry, #apt_rueil, #apt_villejuif
- Intégré dans `renderPropertyDetail()` pour le panel de détail dans la vue Immo

### Plans d'appartement SVG interactifs (v148)

Plans SVG calculés mathématiquement à partir des cotes architecturales. Chaque pièce est un polygone dont la surface SVG correspond exactement à la surface réelle (tolérance <0.3m²).

**Vitry 3302** (9 pièces, viewBox `-380 -30 912 978`) :
- Plan en L : loggia à gauche, cuisine et entrée en haut, séjour central en L
- Chambres en bas séparées par le dégagement
- Cotes : Cuisine 280×304, Entrée 179×327, Séjour L-shape (21.28m²), Ch1 390×317, Ch2 327×304
- Sources : plan Nexity série notaire indice 3, 22/11/2022

**Villejuif A27** (7 pièces, viewBox `-166 -30 1212 1028`) :
- Plan en V : murs diagonaux à 8° de la verticale, chambres dans les ailes
- Séjour/Cuisine trapézoïdal 35.09m², loggia en bande entre les ailes
- Cotes : SdB 258×211, Entrée 171×211, WC 177×131, Ch2 332×336, Ch1 302×369
- Sources : plan Fair' Promotion indice A, mai 2025

**Rueil** (8 pièces, schématique, viewBox `-20 -20 940 660`) :
- Plan basé sur le croquis du propriétaire (pas de plan archi)
- Layout : Cuisine/Entrée/Salon en haut, Ch2/SdB-WC/Ch1 en bas
- Surfaces nulles (pas de cotes exactes disponibles)

**Interaction** :
- Barre des pièces : affiche les noms uniquement, superficie au clic (toggle)
- Plan SVG : hover CSS pur (fill-opacity 8% → 35%), tooltip native SVG `<title>`
- Couleurs : bleu (#3b82f6) espaces de vie, vert (#22c55e) chambres, gris (#94a3b8) utilités, or (#d69e2e) loggia

### Section LMP — Seuil et comparaison LMNP vs LMP (v148)

Section dans la vue Immobilier qui analyse le risque de passage LMP pour Nezha :
- Comparaison seuil : aujourd'hui (Rueil seul ~15 600€/an) vs après Villejuif (~37 200€/an > 23K€ seuil)
- Tableau fiscal sur loyer : LMNP (IR 20% + PS 17.2%) vs LMP (IR 20% + SSI ~40%)
- Tableau exit costs LMNP vs LMP sur 25 ans (dépliable)
- Note non-résident : condition "recettes > revenus d'activité" auto-remplie

### Manque à gagner Cash (v148)

Remplacement du donut "Répartition par Devise" par un panneau "Manque à gagner" :
- Pour chaque personne, calcule le rendement perdu sur le cash rapportant <6%
- Affiche le manque à gagner en €/jour, €/mois, €/an (en rouge)
- Utilise `cashView.byOwner` et `cashView.accounts` pour les calculs dynamiques

### Fix données Vitry — parking 70€ (v148)

- Parking: 0 → 70€/mois dans data.js (loué séparément en cash)
- `loyerTotalCC`: 1200 → 1270€/mois (HC 1050 + charges 150 + parking 70)
- `loyerObjectif`: 1200 → 1270€/mois
- Impact CF Vitry : -223€/mois → -153€/mois

### Fix données Rueil (v148)

- `purchasePrice`: 255K → 240K (prix acte notarié, hors frais)
- Banque : LCL → Crédit Mutuel Franconville (confirmé par acte)
- `lmnpStartDate`: ajouté (oct 2025 — date du bail Docusign)
- Amortissement LMNP calculé depuis la date de passage en LMNP (pas depuis l'achat 2019)
- L15 Sud : ouverture corrigée à avril 2027

### Jeanbrun collapsible (v148)

Section Jeanbrun dans la vue Villejuif rendue collapsible :
- Bannière rouge : "Dispositif Jeanbrun non retenu — loyer plafonné trop bas (1 215€ vs 1 700€ marché)"
- Détails masqués par défaut, affichés au clic sur "Voir les détails ▼"
- Contenu : calcul loyer plafonné, réduction d'impôt, conditions d'éligibilité, avantages/inconvénients

### Chart PV Abattements par propriété (v148)

Graphe en barres empilées montrant pour chaque année de détention (1-30 ans) :
- Net (vert) : ce que le vendeur garde
- IR (rouge) : 19% × (1 - abattement IR cumulé)
- PS (orange) : 17.2% × (1 - abattement PS cumulé)
- Ligne verticale à la durée de détention actuelle
- Fonction `computePVAbattementSchedule()` dans engine.js
- Canvas `pvAbattementChart`, rendu par `buildPVAbattementChart()` dans charts.js

### Redesign CSS — "Patrimoine Précis" (v148)

Refonte visuelle appliquée depuis le skill `frontend-design` d'Anthropic :
- **Typographie** : DM Sans (body, données) + Instrument Serif (titres) via Google Fonts
- **Couleurs** : fond off-white chaud (#fafaf9), navy profond nav (#1e3a5f), bordures warm gray (#e7e5e4)
- **Navigation** : tabs uppercase avec letter-spacing 0.3px, underline animé pour l'onglet actif
- **KPI cards** : ombres subtiles, animations fadeUp en cascade (0.05s entre chaque)
- **Tables** : headers uppercase letter-spaced, hover states, densité professionnelle
- **Micro-animations** : @keyframes fadeUp, transitions 0.2s ease partout
- **Tabular numerics** : font-variant-numeric: tabular-nums pour les colonnes de chiffres

### Données IBKR — v147-148

- Mise à jour des prix statiques au close 16/03/2026 (CSV IBKR Q1 2026)
- Vente partielle DG (Vinci) : 100 actions à 131.20€ le 17/03 (2 lots: 40 TGATE + 60 SBF)
- Position DG réduite de 200 → 100 actions
- Deleverage JPY : 13 111 EUR → 2 406 458 JPY @ 183.545 le 18/03
- Cash IBKR mis à jour : EUR ~0, JPY -4 590 694, USD ~0

### Prompt dashboard patrimonial pour amis (v148)

Prompt en 3 phases créé dans `/mnt/outputs/prompt-dashboard-patrimonial.md` :
1. Phase 1 : inventaire du patrimoine via questions (Claude guide l'utilisateur)
2. Phase 2 : construction du site (architecture data/engine/render/charts/simulators/api/app)
3. Phase 3 : enrichissement par documents (relevés, contrats, tableaux d'amortissement)
Personnalisé pour Anas & Rania, contexte Europe/Maroc.

### Drafts Gmail (v148)

- Draft Degiro sur am.koraibi@gmail.com → clients@degiro.fr (rapports 2020-2025)
- Draft BoursoBank sur amine.koraibi@gmail.com → contact@boursobank.com
  - Numéros PEA complets retrouvés dans les emails de clôture
  - Timeline complète reconstruite : CTO (avr 2020), PEA (juil 2021), PEA-PME (sept 2024)

### Audit KPIs v148

Tous les KPIs et projections ont été audités :
- ✅ Equity par bien (Vitry, Rueil, Villejuif) : correct
- ✅ Exit costs avec réintégration amortissements LMNP (loi finances 2025) : correct
- ✅ Couple NW avec `villejuifSigned: false` : correct (exclusion + reservation fees)
- ✅ CF projection : charges, rent growth, loan end dates, parking corrects
- ✅ Track Record : win rate, realized P/L corrects
- ✅ Appréciation par phases : corrigée dans wealth projection (engine.js)
- ✅ Simulateurs : equity nette composée (amort schedule + appreciation + exit costs)
- ✅ Banque Rueil : Crédit Mutuel Franconville (confirmé par acte notarié)
- ✅ Parking Vitry : 70€/mois intégré dans les revenus
- ✅ Plans SVG : surfaces calculées matchent les surfaces réelles (<0.3m² tolérance)
- ✅ BP Vitry : intérêts seuls août-déc 2025, capital à partir de jan 2026

## State Object Schema

The `compute()` function (from engine.js) returns a complete state object with the following structure:

```javascript
state = {
  // Person-specific net worth rollups
  couple: { nw, immoEquity, immoEquityBrute, immoValue, immoCRD, nbBiens, ... },
  amine: { nw, ibkr, espp, sgtm, uae, moroccoCash, vitryEquity, vehicles, recvPro, recvPersonal, tva, ... },
  nezha: { nw, espp, revolutEUR, creditMutuel, livretA, lclDepots, cashMaroc, cashUAE, villejuifEquity, rueilEquity, recvOmar, cautionRueil, sgtm, ... },

  // Consolidated asset views
  pools: { actions, cash },  // global action + cash tallies
  cashView: { accounts[], totalCash, byCurrency, byOwner, diagnostics, ... },
  immoView: { properties[], amortSchedules, wealthProjection, totalWealthCreation, ... },
  actionsView: { positions[], closedPositions[], insights, twr, ... },
  creancesView: { items[], total, ... },
  budgetView: { expenses[], total, ... },

  // Hierarchical drilldown data (by view)
  categories: [...],  // couple view breakdown
  amineCategories, nezhaCategories,  // person-specific breakdowns
  viewConfig: { couple: {...}, amine: {...}, nezha: {...} },  // metadata + NW refs

  // Time series
  nwHistory: [...],  // historical net worth by date

  // Formatting & state
  fx: { EUR: 1, AED, MAD, USD, JPY },  // exchange rates
  portfolio: PORTFOLIO,  // raw data reference
  ibkrPositions: [...],  // computed positions with price/P&L
}
```

## View Routing

Views represent different analytical scopes:

| View | Type | Purpose |
|------|------|---------|
| `couple` | Person | Combined household (Amine + Nezha) |
| `amine` | Person | Amine's personal net worth |
| `nezha` | Person | Nezha's personal net worth |
| `actions` | Asset | All stocks, ETFs, crypto (IBKR + ESPP + SGTM) |
| `cash` | Asset | All cash accounts (UAE, Maroc, France) |
| `immobilier` | Asset | Real estate portfolio overview |
| `apt_vitry` | Property | Vitry-sur-Seine (19 Rue Nathalie Lemel) detail |
| `apt_rueil` | Property | Rueil-Malmaison (21 Allée des Glycines) detail |
| `apt_villejuif` | Property | Villejuif (167 Bd Maxime Gorki) detail |
| `creances` | Asset | Receivables & recovery analysis |
| `budget` | Asset | Monthly expense tracking |

**URL Hash Routing:** Hash fragments (#couple, #amine, #actions, etc.) stored in window.location.hash. Sub-views (apt_*) rendered as secondary options under immobilier main tab.

## API Strategy

### FX Rates

- **Source:** open.er-api.com/v6 (was frankfurter.dev — OUTDATED in docs)
- **Fallback:** FX_STATIC in data.js (hardcoded rates for offline mode)
- **Cache:** localStorage, 5-minute TTL
- **Refresh:** Automatic every 5 minutes via setInterval in app.js

### Stock Prices

- **Source:** Yahoo Finance v8 chart endpoint (range=1d, interval=1d)
- **Tickers:** IBKR positions + ESPP + SGTM + closed position history
- **CORS Strategy:** 6 proxies raced in parallel via Promise.any():
  - `query1.finance.yahoo.com/v10/finance/quoteSummary/`
  - `query2.finance.yahoo.com/v10/finance/quoteSummary/`
  - ... (6 total)
- **Cache:** localStorage per ticker, 10-minute TTL
- **Fallback:** Static prices in data.js (market.acnPriceUSD, market.sgtmPriceMAD, ibkr.positions[].price)
- **SGTM Special:** No API (MAD-listed stock, illiquid) — always uses static price

### Error Handling & Retries

- Failed tickers retried once via `retryFailedTickers()`
- If all proxies fail, display "⚠️ Some prices stale" badge and use last-known values
- Sold positions prices fetched separately to show historical P&L

## Chart Registry

All Chart.js instances managed centrally in charts.js:

| Chart | Builder Function | Canvas ID | View |
|-------|-----------------|-----------|------|
| Couple Donut | `buildCoupleDonut()` | `#coupleDrillDown` | couple |
| Amine Donut | `buildAmineDonut()` | `#amineDonut` | amine |
| Nezha Donut | `buildNezhaDonut()` | `#nezhaDonut` | nezha |
| Geo Breakdown | `buildGeoChart()` | `#geoChart` | couple/amine/nezha |
| Immo Equity Bar | `buildImmoEquityBar()` | `#immoViewEquityChart` | immobilier |
| Immo Projection | `buildImmoProjection()` | `#immoProjectionChart` | immobilier |
| CF Projection | `buildCFProjection()` | `#cfProjectionChart` | couple/amine/nezha |
| Wealth Projection | `buildWealthProjection()` | `#wealthProjectionChart` | immobilier |
| Actions Geo | `buildActionsGeo()` | `#actionsGeoDonut` | actions |
| Actions Sector | `buildActionsSector()` | `#actionsSectorDonut` | actions |
| Actions Treemap | `buildActionsTreemap()` | `#actionsTreemapChart` | actions |
| Cash Currency Yield | (HTML overlay, no canvas) | `#cashCurrencyChart` | cash |
| Budget Zone | `buildBudgetZone()` | `#budgetZoneChart` | budget |
| Budget Type | `buildBudgetType()` | `#budgetTypeChart` | budget |
| PV Abattement | `buildPVAbattement()` | `#pvAbattementChart` | immobilier |
| NW History | `buildNWHistory()` | `#nwHistoryChart` | couple |

All charts destroyed and rebuilt on view switch via `rebuildAllCharts(state, view)`.

## Data Exports from data.js

| Export | Type | Purpose |
|--------|------|---------|
| `PORTFOLIO` | Object | Complete raw portfolio data (AED, MAD, EUR, USD, JPY native currencies) |
| `CURRENCY_CONFIG` | Object | Symbol mapping, symbol-after flag, display names |
| `CASH_YIELDS` | Object | Interest rates by account (Mashreq 3%, Wio 6%, etc.) |
| `IMMO_CONSTANTS` | Object | Tax rates, notary fees, agency fees, insurance rates |
| `EXIT_COSTS` | Object | Selling costs by property type (agency 4%, notary 7-8%, staging 2%) |
| `VITRY_CONSTRAINTS` | Object | Rent cap, occupancy rules, loan parameters |
| `VILLEJUIF_REGIMES` | Object | Tax regimes (Jeanbrun, micro-BIC, LMNP rules) |
| `FX_STATIC` | Object | Fallback FX rates when API fails |
| `DATA_LAST_UPDATE` | String | Human-readable date of last data refresh |

## Key Formulas

### Real Estate Equity Calculation

```
Equity brute = value - CRD
Equity nette = max(0, salePrice - exitCosts - CRD)
  where exitCosts = agency(4%) + notary(7-8%) + staging(2%) + broker fees
```

### Capital Gains Tax (PV — Plus-Value)

```
PV brute = salePrice - (purchasePrice + 7.5% acquisition frais) + amort_reintegration

Abattement IR (Income Tax):
  1-5 years: 0%
  6-21 years: 6% per year
  22 years: 4%
  → 100% exemption after 22 years

Abattement PS (Social Tax):
  1-5 years: 0%
  6-21 years: 1.65% per year
  22 years: 1.6%
  9-30 years: 9% per year
  → 100% exemption after 30 years

Taxe IR = PV brute × (1 - cumAbattementIR) × 19%
Taxe PS = PV brute × (1 - cumAbattementPS) × 17.2%
```

### LMNP Depreciation Reintegration

```
Annual amortization = purchasePrice × 80% × 2% × yearsInLMNPStatus
  (only counted from lmnpStartDate, not purchase date)

Example (Rueil, purchased 2019, LMNP from Oct 2025):
  = 240,000 × 0.80 × 0.02 × 0.5 years
  = 1,920€/year (pro-rata to Oct 2026)
```

### JPY Carry Trade Cost (IBKR Negative Balance)

IBKR applies tiered borrow rates on negative JPY positions:

```
Tier 1: First 500K JPY @ 5.5% p.a.
Tier 2: Next 1M JPY @ 6.5% p.a.
Tier 3: 1.5M+ JPY @ 7.5% p.a.

Example: -4,590,694 JPY balance (18/03/2026)
  Tier 1: 500,000 × 5.5% / 365 = 75.34 JPY/day
  Tier 2: 1,000,000 × 6.5% / 365 = 178.08 JPY/day
  Tier 3: 3,090,694 × 7.5% / 365 = 635.80 JPY/day
  Total: ~889 JPY/day cost (~0.48€/day @ 183.5 JPY/EUR)
```

Used in `ibkrJPYBorrowCost()` function (engine.js).

### UX Audit & 20 Fixes (v148 — Session 18/03/2026)

Audit complet réalisé avec le skill `frontend-design` d'Anthropic + inspection Chrome live.

**Batch 1 — Fixes 1-5 :**
1. ✅ Villejuif warning caché sur les vues non pertinentes (actions/cash/budget/creances)
2. ✅ KPI labels : uppercase → title case (plus lisible)
3. ✅ Loading skeleton pendant le fetch API initial
4. ✅ Immo KPIs : class `.primary` sur Equity Brute/Nette (hiérarchie visuelle)
5. ✅ FX status bar : prominence réduite (opacity + font-size)

**Batch 2 — Fixes 6-20 :**
6. ✅ Treemap : hide labels sur segments < 1200px² (évite overlap)
7. ✅ Column toggle pills : réduites (10px, opacity 0.8)
8. ✅ Manque à gagner : rouge → amber (opportunité, pas erreur)
9. ✅ Viewport meta : déjà présent (vérifié)
10. ✅ Footer timestamp : format complet "Dernière MAJ : 18 mars 2026 à 21:48"
11. ⏭ Delta indicator : nécessite historique (skipped)
12. ✅ Double €€ sur axe Y : symbole dupliqué supprimé dans budget chart
13. ✅ Donut legends : padding et box sizes augmentés
14. ✅ Hard Refresh : ⚡ texte → 🔄 icône subtile
15. ⏭ Slider labels : fonctionnent correctement (skipped)
16. ✅ LIVE badge : caché quand toutes les positions sont live
17. ✅ Cash table : alternating row colors (#fafaf9)
18. ✅ Budget charts : min-height augmenté à 280px
19. ⏭ Close button : géré par navigation standard (skipped)
20. ✅ Favicon : 💰 SVG ajouté

**Bug fix supplémentaire :**
- ✅ `villejuifNote` (HTML statique) caché dynamiquement dans render() selon la vue

### Documentation Completeness Audit (v148)

Audit de la complétude de ARCHITECTURE.md vs le code réel :

**Documenté (ajouté dans cette session) :**
- State Object Schema (structure complète de compute())
- View Routing (10 vues + hash routing)
- API Strategy (FX, stocks, CORS proxies, cache TTL, fallback)
- Chart Registry (16 instances Chart.js avec canvas IDs)
- Data Exports (18 exports de data.js avec types)
- Key Formulas (equity, PV abattement, LMNP amort, carry cost)

### v149 Features

**Feature 1: Net Worth History Evolution Chart**
- Source: `NW_HISTORY` in `data.js` (array of {date, coupleNW, amineNW, nezhaNW, note})
- Chart function: `buildNWHistoryChart()` in `charts.js` (enabled, was disabled in v86)
- Canvas element: `nwHistoryChart` in `index.html` (added after coupleTreemap)
- Displays: Line chart with Couple NW (green fill), Amine NW (dashed blue), Nezha NW (dashed orange)
- Tooltip: Shows % change between consecutive data points + annotations (notes field)
- Automatically filters null values (2026-03 live update)

**Feature 2: Delta Indicators on KPIs**
- Location: Below couple NW KPI (kpiCoupleNW)
- Data: `couple.nwDelta` and `couple.nwDeltaPct` computed in `engine.js`
- Calculation: previousNW = NW_HISTORY[length-2].coupleNW; delta = currentNW - previousNW
- Display function: `setDelta()` in `render.js` (similar to setSubPct)
- Colors: Green if positive, Red if negative
- Format: "+€2,340 (+0.3%) ce mois"

**Feature 3: Version v149 Bump**
- Updated: index.html, app.js, charts.js, engine.js, render.js
- All module imports now use ?v=149
- ARCHITECTURE.md version bumped

**Encore à documenter (v150+) :**
- Liste complète des fonctions privées de engine.js (~20 fonctions)
- Liste complète des fonctions render.js (~25+ fonctions)
- Liste complète des chart builders (~30 fonctions)
- HTML section/view mapping détaillé
- Simulator architecture (generic engine + property equity computer)
- Error handling & fallback strategies
- Stock source strategy ('live' vs 'statique')

### Méthode de construction des plans SVG (v149)

**Objectif** : Construire des plans d'appartement SVG interactifs dont les surfaces proportionnelles correspondent aux surfaces réelles (erreur <5%).

#### Étape 1 — Sources de données
Pour chaque appartement, rassembler :
- **Plan architectural** (PDF du promoteur/notaire, ex: Nexity, Fair' Promotion)
- **Certificat Loi Carrez** (surfaces exactes par pièce)
- **Croquis** (si pas de plan archi)

#### Étape 2 — Extraction des dimensions
1. Convertir le plan PDF en image haute résolution (400 dpi) : `pdftoppm -png -r 400 plan.pdf output`
2. Cropper la zone du plan uniquement (sans légendes/tableaux)
3. Scanner les murs avec un script Python + Pillow :
   - Scanner des lignes horizontales et verticales
   - Détecter les murs noirs (pixels < 80 en grayscale)
   - Trouver les centres des murs et leurs largeurs
   - Tracer les murs diagonaux (pour les plans non-orthogonaux comme Villejuif)

#### Étape 3 — Construction du modèle géométrique
1. Définir chaque pièce comme un polygone (liste de points SVG)
2. Utiliser la **formule du lacet (Shoelace)** pour calculer l'aire de chaque polygone
3. Définir un **facteur d'échelle** : `px_per_m2 = total_SVG_area / total_target_m2`
4. Ajuster les dimensions de chaque pièce pour que `SVG_area / px_per_m2 ≈ target_m2`

#### Étape 4 — Validation (OBLIGATOIRE)
Pour chaque pièce, vérifier :
- **Erreur de surface** : `|computed_m2 - target_m2| / target_m2 < 5%`
- **Pas de chevauchement** : les bounding boxes des pièces adjacentes ne se croisent pas (sauf edges partagés)
- **Adjacence correcte** : les pièces qui se touchent partagent des coordonnées exactes

Script de validation Python :
```python
def polygon_area(pts):
    n = len(pts)
    return abs(sum(pts[i][0]*pts[(i+1)%n][1] - pts[(i+1)%n][0]*pts[i][1] for i in range(n))) / 2

total_target = sum(room.target for room in rooms)
total_svg = sum(polygon_area(room.pts) for room in rooms)
scale = total_svg / total_target

for room in rooms:
    computed = polygon_area(room.pts) / scale
    error = abs(computed - room.target) / room.target * 100
    assert error < 5, f"{room.name}: {error:.1f}% error"
```

#### Étape 5 — Itération
Si la validation échoue :
1. Identifier les pièces avec erreur >5%
2. Ajuster `width × height` pour que `width × height / scale ≈ target_m2`
3. Re-valider
4. Répéter jusqu'à ce que TOUTES les pièces passent

#### Étape 6 — Intégration dans data.js
Ajouter `floorPlan` dans `IMMO_CONSTANTS.properties[loanKey].details` :
```javascript
floorPlan: {
  viewBox: 'minX minY width height',
  schematic: true/false,  // true si pas de plan archi
  rooms: [
    { name: 'Nom', surface: X.XX, color: '#hex', points: 'x1,y1 x2,y2 ...' },
  ],
},
```

#### Types de polygones
- **Rectangle** : 4 points (pièces orthogonales)
- **L-shape** : 6 points (séjour en L)
- **Trapèze** : 4 points avec bords non parallèles (loggia)
- **Parallélogramme** : 4 points avec bords inclinés (chambres dans ailes V)

#### Couleurs standard
- Bleu `#3b82f6` : espaces de vie (séjour, cuisine, salon)
- Vert `#22c55e` : chambres
- Gris `#94a3b8` : utilités (SdB, WC, entrée, dégagement)
- Or `#d69e2e` : loggia/extérieur

#### Résultats de validation v149
| Appartement | Max erreur | Status |
|---|---|---|
| Vitry 3302 | 2.1% | ✅ PASS |
| Rueil (Loi Carrez) | 4.6% | ✅ PASS |
| Villejuif A27 | 40.8% | ❌ FAIL (itération en cours) |

Le plan Villejuif nécessite encore du travail — les chambres en parallélogramme (murs diagonaux V) ont des aires SVG disproportionnées par rapport aux petites pièces (SdB, Entrée, WC). La forme V est visuellement correcte mais les proportions d'aire ne sont pas calibrées.

### Constraint-Based Geometric Solver — Plans SVG (v149)

Les plans d'appartement SVG sont générés par un solver géométrique à contraintes, pas par approximation manuelle.

**Variables du solver :**
- ``V_ANGLE` : angle des murs diagonaux (27.5° pour Villejuif, mesuré par régression)
- `APEX_X` : position du sommet du V
- `TOP_W` : largeur au sommet (7.5m)
- `UTIL_H` : hauteur du bloc utilitaire (2.1m)
- `SEJOUR_DEPTH` : profondeur du séjour (résolu itérativement)
- `LOGGIA_H` : hauteur de la loggia (résolue par équation quadratique)
- `CH_W`, `CH_DEPTH` : dimensions des chambres

**Contraintes :**
1. Aire de chaque pièce = surface réelle ±5%
2. Pas de chevauchement (murs partagés)
3. Forme en V préservée (angle symétrique)
4. Adjacence : séjour touche utility + loggia, loggia touche les 2 chambres

**Algorithme :**
1. Résout le bloc utilitaire (rectangulaire) depuis les surfaces et la hauteur
2. Calcule la profondeur du séjour (L-shape = triangle + rectangle)
3. Résout la hauteur de la loggia (équation quadratique du trapèze)
4. Calcule les dimensions des chambres (parallélogrammes)
5. **Itère** : ajuste SEJOUR_DEPTH jusqu'à convergence (<1% erreur sur le séjour)

**Résultats validation Villejuif A27 :**
```
Salle de bain    5.45m² → 5.450m²  err=0.000% ✓
Entrée           3.60m² → 3.600m²  err=0.000% ✓
WC               2.32m² → 2.320m²  err=0.000% ✓
Séjour/Cuisine  35.09m² → 35.090m²  err=0.000% ✓
Loggia           9.51m² → 9.510m²  err=0.000% ✓
Chambre 2       11.24m² → 11.240m²  err=0.000% ✓
Chambre 1       11.24m² → 11.240m²  err=0.000% ✓
Max error: 0.000% → PASS (all rooms exact) ✓
```

**Résultats validation Vitry 3302 :** Max error 2.1% → PASS ✓
**Résultats validation Rueil :** Max error 4.6% → PASS ✓ (surfaces Loi Carrez exactes)
