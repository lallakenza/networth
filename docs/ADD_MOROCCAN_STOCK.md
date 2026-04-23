# Ajouter une nouvelle action marocaine (Bourse de Casablanca)

Runbook pratique pour ajouter une action de la BVC (ex: CSR Cosumar, LHM Label'Vie,
IAM Maroc Telecom, ATW Attijariwafa, BCP, CIH, TQM Taqa Morocco, MNG Managem, WAA Wafa Assurance…).

Yahoo Finance ne couvre pas la Bourse de Casablanca, on utilise donc le même pipeline
que SGTM : **scraper GitHub Actions → JSON committé dans le repo → chart + KPIs live**.

Pour la spec architecturale complète, voir `ARCHITECTURE.md §v331 "Moroccan stocks live pipeline"`.

---

## Pipeline en un coup d'œil

```
.github/workflows/<ticker>-scrape.yml  ← cron `30 8-14 * * 1-5` (heures BVC)
         │
         ▼
scripts/scrape_<ticker>.py             ← Playwright Chromium headless
  ├─ casablanca-bourse.com/...         (HTTP puis Playwright en fallback)
  ├─ idbourse.com/stocks/<TICKER>      (hydratation SPA)
  └─ fr.investing.com/equities/<slug>  (bypass Cloudflare via Playwright)
         │
         ▼ (commit si prix changé OU snapshot > 1h)
data/<ticker>_live.json                ← { ticker, priceMAD, currency, lastUpdate, source, raw }
data/<ticker>_history.json             ← upsert daily { series: [{date, priceMAD, source}] }
         │
         ▼ auto-deploy GitHub Pages (~60s)
js/api.js :: fetchMoroccanStockPrice(ticker)
js/charts.js → merge history dans BASE_<TICKER>_PRICES
```

---

## Checklist (7 étapes, ~30 min la première fois, ~10 min ensuite)

### 1. Récolte des infos métadonnées

Avant d'écrire du code, vérifier sur **casablanca-bourse.com** :
- Ticker officiel (ex: `CSR` pour Cosumar)
- URL ticker sur casablanca-bourse.com (format `https://www.casablanca-bourse.com/fr/live-market/instrument/<ISIN>`)
- Slug investing.com (ex: `cosumar` → `fr.investing.com/equities/cosumar`)
- Fourchette 52 semaines (pour définir `MIN_PRICE` / `MAX_PRICE` du scraper, éviter les valeurs aberrantes)
- Nombre d'actions détenues + cost basis moyen (pour P&L)

### 2. `js/data.js` — Déclarer la position

Dans `PORTFOLIO.amine` (ou `PORTFOLIO.nezha` ou les deux) :

```js
// Cosumar (BVC) - acheté 18/12/2025 @ 320 MAD x 50 actions
csr: { shares: 50, costBasisMAD: 320 }
```

Dans `PORTFOLIO.market`, pour les prix/flags live :

```js
csrPriceMAD: 380,         // bootstrap (sera écrasé par data/csr_live.json au runtime)
csrCostBasisMAD: 320,     // cost basis per share
_csrLive: false,          // runtime flag, mis à true si fetch OK
_csrSource: null,         // 'repo:casablanca-bourse.com', 'scraping', 'cache', etc.
_csrLastUpdate: null,     // ISO timestamp du dernier snapshot
```

**Règle** : tout ticker avec `broker: 'Attijari'` est automatiquement traité comme "marché
sans API Yahoo" par le badge UI (gris neutre, pas rouge alarmiste). La logique est dans
`render.js :: isPositionStatic()` et `isMoroccanNoYahoo()`.

### 3. `scripts/scrape_<ticker>.py` — Cloner le scraper SGTM

```bash
cp scripts/scrape_sgtm.py scripts/scrape_csr.py
```

Modifier :

| Variable | SGTM | À changer pour CSR (exemple) |
|---|---|---|
| `OUT_PATH` | `data/sgtm_live.json` | `data/csr_live.json` |
| `HISTORY_PATH` | `data/sgtm_history.json` | `data/csr_history.json` |
| `MIN_PRICE` / `MAX_PRICE` | `300` / `2000` | Selon 52w range du titre |
| URL casablanca-bourse | `.../instrument/<ISIN SGTM>` | ISIN CSR |
| URL idbourse | `.../stocks/SGTM` | `.../stocks/CSR` |
| URL investing | `.../sgtm` | `.../cosumar` |
| Tag `ticker` dans snapshot | `"SGTM"` | `"CSR"` |

### 4. `.github/workflows/<ticker>-scrape.yml` — Cloner le workflow

```bash
cp .github/workflows/sgtm-scrape.yml .github/workflows/csr-scrape.yml
```

Remplacer les **3 occurrences** de `sgtm` → `csr` (name du workflow, chemin du script,
chemin du JSON dans le `paths:` trigger). **Garder le cron `30 8-14 * * 1-5`** : budget
~90 min/mois par ticker, largement dans la limite gratuite de 2000 min/mois même avec 10+ tickers.

### 5. `data/<ticker>_live.json` — Bootstrap initial

```json
{
  "ticker": "CSR",
  "priceMAD": 380,
  "currency": "MAD",
  "lastUpdate": "2026-04-23T12:00:00Z",
  "source": "static-bootstrap",
  "raw": "380"
}
```

Le flag `source: "static-bootstrap"` déclenche volontairement le badge `STATIC` gris
jusqu'au premier succès CI — évite de mentir "live ✓" sur une valeur encore hardcodée.

### 6. `js/api.js` — Factoriser (recommandé dès le 2ème ticker)

À partir de la 2ème action marocaine, factoriser pour ne pas dupliquer. Remplacer
`fetchSGTMFromRepo()` + `fetchSGTMPrice()` par :

```js
// Table des bornes de sanity par ticker
const MOROCCAN_TICKERS_BOUNDS = {
  SGTM: [300, 2000],
  CSR:  [200, 700],
  // ... autres
};

async function fetchMoroccanStockFromRepo(ticker) {
  const url = './data/' + ticker.toLowerCase() + '_live.json?h=' + new Date().getHours();
  // ... même logique que fetchSGTMFromRepo
}

async function fetchMoroccanStockPrice(ticker, portfolio) {
  // Même chaîne de fallback : repo fresh → scraping → repo stale → null
  // Écrit dans portfolio.market[ticker.toLowerCase() + 'PriceMAD']
  // et les flags _<ticker>Live / _<ticker>Source
}
```

Puis dans `fetchStockPrices()`, itérer : `for (const t of Object.keys(MOROCCAN_TICKERS_BOUNDS)) await fetchMoroccanStockPrice(t, portfolio);`

### 7. Propagation `engine.js` + `render.js` + `charts.js`

**`engine.js`** — Même pattern que SGTM : exposer `_<ticker>Live` + `_<ticker>Source` dans
le retour de `compute()`. Inclure la valeur dans `amineTotalAssets` ou `nezhaTotalAssets`
selon l'owner.

**`render.js`** — Injecter la position dans `allPositions.push({...})` avec `_live` et
`_source`. La logique `isPositionStatic()` / `isMoroccanNoYahoo()` est déjà prête — pas de
modif nécessaire.

**`charts.js`** — Optionnel mais recommandé pour l'historique : cloner le pattern SGTM du
chart YTD (v338). Exposer `historicalData.<ticker>History` depuis `app.js` après
`fetchHistoricalPrices`, puis merger avec une baseline hardcodée `BASE_<TICKER>_PRICES` dans
`buildPortfolioYTDChart`. Sans ça, l'action n'apparaîtra que dans le NW "aujourd'hui", pas
dans le chart historique.

### 8. Tests de régression

Hard-refresh et vérifier :

- [ ] Avec `<ticker>_live.json` frais (< 24h) : badge "live ✓" dans l'en-tête, pas de `STATIC` sur la ligne
- [ ] Avec JSON stale (> 24h) + scraping OK : badge "live (scraping)"
- [ ] Avec JSON stale + scraping KO : badge "dernier relevé" + `DATED` jaune sur la ligne
- [ ] Avec JSON absent + scraping KO : fallback data.js, badge "statique" + `STATIC` gris
- [ ] Badge compteur : `Actions: N+1/N+1 live` (la nouvelle action s'ajoute au total)
- [ ] Treemap : la position apparaît dans la case "Maroc (SGTM)" ou nouvelle case dédiée
- [ ] Allocation géographique : Maroc reste cohérent (somme actions MAD)

### 9. Bumper la cache-bust et committer

```bash
# Bump ?v=N → ?v=N+1 sur les 18 imports (app.js ×7, charts.js ×4, simulators.js ×2, render.js ×2, engine.js ×1, index.html ×1) + APP_VERSION dans data.js
for f in js/render.js js/charts.js js/engine.js js/app.js js/simulators.js js/data.js index.html; do
  python3 -c "import sys; p=sys.argv[1]; c=open(p).read(); c2=c.replace('?v=<N>','?v=<N+1>').replace(\"APP_VERSION = 'v<N>'\",\"APP_VERSION = 'v<N+1>'\"); open(p,'w').write(c2)" "$f"
done

git add js/ data/<ticker>_live.json scripts/scrape_<ticker>.py .github/workflows/<ticker>-scrape.yml index.html
git commit -m "vN+1: Ajout action <TICKER> (Bourse de Casablanca, live via scraper)"
git push
```

Pousser sur `main` déclenche (a) le déploiement GitHub Pages et (b) le premier run CI du
nouveau workflow. Vérifier dans **GitHub → Actions** que le run passe ; sinon télécharger
l'artifact `scrape-debug-<run_id>` pour diagnostiquer (screenshots + HTML des tentatives).

---

## Troubleshooting — scraper rouge au premier run

**WAF bloque l'IP GitHub Actions** (cas SGTM sur casablanca-bourse.com) : c'est géré par le fallback
Playwright qui simule un vrai navigateur. Si l'URL principale HTTP échoue, le scraper tente
automatiquement Playwright sur la même URL. Vérifier que `scrape_casablanca_bourse_playwright()`
est bien copié depuis `scrape_sgtm.py`.

**Timeout sur idbourse.com** : le site hydrate via JS en ~3-5s. Augmenter `page.wait_for_timeout(5000)`
à 8000ms si besoin.

**Prix hors bornes** : si le scraper extrait "462,00" mais interprète comme 462 au lieu de 46.2,
vérifier la fonction `parse_french_number()` — gère `'1 234,56' → 1234.56` mais pas les décimales
séparées par point ambigu. Les bornes `MIN_PRICE`/`MAX_PRICE` attrapent ce cas et le run échoue
proprement avec un artifact de debug.

**Cloudflare challenge sur investing.com** : le fallback Playwright gère ce cas en utilisant un
vrai Chromium. Si Cloudflare devient trop aggressif, commenter investing.com et se reposer sur
casablanca-bourse.com + idbourse.com.

---

## Référence

- Code source du pattern SGTM (implémentation de référence) :
  - `scripts/scrape_sgtm.py`
  - `.github/workflows/sgtm-scrape.yml`
  - `data/sgtm_live.json` + `data/sgtm_history.json`
  - `js/api.js` :: `fetchSGTMFromRepo`, `fetchSGTMPrice`
  - `js/charts.js` :: `SGTM_PRICES` merge dans `buildPortfolioYTDChart` (v338)
- Spec architecturale complète : `ARCHITECTURE.md §v331`
- Invariants : `CLAUDE.md §"Moroccan stocks live pipeline"`
