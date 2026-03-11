# Architecture — Patrimonial Dashboard

> Guide pour IA / développeur qui doit modifier le site.
> Version courante : **v91** | Déployé sur GitHub Pages : `lallakenza.github.io/networth/`

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
| `js/data.js` | Données brutes en devise native (AED, MAD, EUR, USD, JPY). Constantes immo, taux, créances. | Mise à jour bimensuelle des soldes, ajout de compte/bien |
| `js/engine.js` | Calculs purs : `compute(PORTFOLIO, fx)` → state object. Pas de DOM. | Ajout de logique de calcul (nouveau type d'actif, diagnostic) |
| `js/render.js` | Lecture du state → mise à jour du DOM. Exports : `render(state)`, `fmt()` | Ajout d'affichage, modification de layout |
| `js/charts.js` | Chart.js : création/destruction de graphiques. Lit state, pas le DOM. | Ajout de graphique |
| `js/simulators.js` | 3 simulateurs de projection (couple, Amine, Nezha) | Modification des projections |
| `js/api.js` | Fetch FX (frankfurter.dev) + stock prices (Yahoo Finance chart API) | Ajout de source de prix |
| `index.html` | Structure HTML + CSS. Pas de logique. | Ajout de sections UI |

## Comment ajouter un nouveau bien immobilier

1. **data.js** : ajouter dans `PORTFOLIO.{owner}.immo` un objet avec `value`, `appreciation`, `purchaseDate`, `purchasePrice`, `surface`
2. **data.js** : ajouter les prêts dans `IMMO_CONSTANTS.loans.{key}Loans[]`
3. **data.js** : ajouter les charges dans `IMMO_CONSTANTS.charges.{key}`
4. **data.js** : ajouter le loyer dans `IMMO_CONSTANTS.properties.{key}`
5. **engine.js** : `buildProperty()` le détecte automatiquement via `IMMO_CONSTANTS`
6. **render.js** : les property cards se génèrent dynamiquement

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

Les prix sont récupérés côté client (navigateur) depuis GitHub Pages. CORS bloque les appels directs vers Yahoo Finance, donc on utilise des proxies :

```
fetchStockPrice(ticker):
  1. Direct Yahoo Finance (rare que ça marche, CORS)
  2. api.allorigins.win/raw?url=... (proxy CORS, fiable)
  3. corsproxy.io/?... (backup proxy)
  4. api.codetabs.com/v1/proxy?quest=... (3e backup)
  → Si tous échouent : pos._live = false, prix fallback de data.js utilisé

fetchSGTMPrice():
  1. Google Finance via allorigins (scrape data-last-price)
  2. leboursier.ma via allorigins (scrape cours)
  3. Google Finance via corsproxy.io
  → Si tous échouent : prix statique de data.js
```

Si un proxy tombe durablement, le remplacer par un autre. Alternatives connues :
- `https://thingproxy.freeboard.io/fetch/URL`
- `https://cors-anywhere.herokuapp.com/URL` (nécessite activation manuelle)
- Déployer son propre proxy Cloudflare Worker (gratuit, plus fiable)

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

## Vues (tabs)

| Tab | ID | State key |
|-----|----|-----------|
| Couple | `couple` | `state.couple.*` |
| Amine | `amine` | `state.amine.*` |
| Nezha | `nezha` | `state.nezha.*` |
| Cash | `cash` | `state.cashView` |
| Actions | `actions` | `state.actionsView` |
| Immobilier | `immobilier` | `state.immoView` |
| Budget | `budget` | `state.budgetView` |

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
- **ESPP** : chaque lot dans `espp.lots[]` est un dépôt (investissement salarié en USD)
- **SGTM** : l'achat IPO est calculé à partir de `market.sgtmCostBasisMAD × shares`
- `owner` est attribué automatiquement : Amine (IBKR, ESPP), Amine+Nezha (SGTM)

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
| P&L Daily | detailPLDaily | periodPL.daily.breakdown | P&L par position, impact FX cash |
| P&L MTD | detailPLMTD | periodPL.mtd.breakdown | P&L par position, top 3 pertes |
| P&L 1 Mois | detailPL1M | periodPL.oneMonth.breakdown | P&L par position, top 3 pertes |
| P&L YTD | detailPLYTD | periodPL.ytd.breakdown | P&L par position, total gains/pertes |
| Total Actions | detailTotal | allPos (IBKR+ESPP+SGTM) | Répartition par valeur, concentration top 3 |
| P/L Non Réalisé | detailUnrealized | allPos.unrealizedPL | P/L latent par position avec % |
| P/L Réalisé | detailRealized | closedPositions + degiro | Trades clôturés, meilleur trade |
| Total Déposé | detailDeposits | av.deposits | Historique dépôts, ROI |
| Dividendes/TWR | detailDividends | av.dividends, av.twr | Yield, commissions, WHT |

### Comment ajouter un nouveau KPI detail panel

1. Ajouter `data-detail="detailXxx"` et classe `kpi-clickable` sur le `.kpi` dans index.html
2. Ajouter un générateur dans `detailGenerators` dans `setupKPIDetailPanels()` (render.js)
3. Le générateur retourne du HTML utilisant les classes `.detail-header`, `.detail-body`, `.detail-row`, `.detail-footer`
4. Les données doivent venir de `state.actionsView` — jamais de constantes hardcodées

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

## Conventions

- Montants en devise native dans data.js, conversion en EUR dans engine.js via `toEUR()`
- `fmt(val)` pour afficher un montant EUR formaté
- `fmtAxis(val)` pour axes de graphiques (notation K)
- Les insights dans render.js doivent utiliser `state.*` et `state.cashView.*`, jamais de constantes
- Les textes de conseil/recommandation sont OK s'ils sont génériques ("optimiser le placement") mais jamais avec des montants hardcodés
