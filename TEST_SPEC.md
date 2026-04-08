# Cahier des charges — Refactoring P&L Chart v269

## 1. Contexte

Le graphique d'évolution NAV/P&L a subi 5+ patches successifs (v245→v268) pour corriger des bugs récurrents. La cause racine est architecturale : un singleton `_ytdChartFullData` partagé entre tous les modes (YTD, 1Y, alltime) qui s'écrase à chaque rebuild. Le refactoring v269 vise à éliminer définitivement cette dette technique.

## 2. Changements fonctionnels

### 2.1 Store per-mode (architectural)
- Chaque mode (ytd, 1y, alltime, 5y, max) stocke ses données dans `window._chartDataByMode[mode]`
- `window._activeChartMode` indique quel mode est affiché
- `renderPortfolioChart()` lit depuis le mode actif
- Plus de triple-rebuild (YTD→1Y→alltime→YTD)

### 2.2 Toggle Owner : Amine / Nezha / Both (nouvelle feature)
- Nouveau groupe de boutons dans la section chart : `Amine | Nezha | Both`
- Filtre les séries NAV/P&L pour n'afficher que le portefeuille de l'owner sélectionné
- `Both` = comportement actuel (tous les comptes)
- `Amine` = IBKR + Degiro + ESPP Amine + SGTM Amine + cash Amine
- `Nezha` = ESPP Nezha + SGTM Nezha + cash Nezha

---

## 3. Tests de validation (cahier de recette)

### TEST-01 — P&L identique entre modes à date commune
**Objectif** : Le P&L IBKR à une date donnée doit être cohérent entre les modes YTD, 1Y, 5Y, MAX (à l'offset de calibration ≤€500 près).

**Procédure** :
1. Charger la page, attendre chargement complet
2. En mode YTD + P&L + scope IBKR, noter le P&L au dernier point
3. Passer en 1Y + P&L + scope IBKR, noter le P&L au dernier point
4. Passer en 5Y + P&L + scope IBKR, noter le P&L au dernier point
5. Passer en MAX + P&L + scope IBKR, noter le P&L au dernier point

**Critère** : |P&L_YTD - P&L_1Y| ≤ €500, |P&L_1Y - P&L_5Y| ≤ €500

**Script de validation** :
```javascript
// Exécuter après chargement complet
const modes = ['ytd', '1y'];
const results = {};
for (const m of modes) {
  const d = window._chartDataByMode[m];
  if (d) {
    const lastIdx = d.labels.length - 1;
    results[m] = {
      date: d.labels[lastIdx],
      plIBKR: d.plValuesIBKR[lastIdx],
      navIBKR: d.ibkrValues[lastIdx],
    };
  }
}
console.table(results);
// Vérification: |ytd.plIBKR - 1y.plIBKR| < 500
```

### TEST-02 — P&L 1Y premier point ≈ 0
**Objectif** : En mode 1Y, le premier point P&L IBKR doit être proche de 0 (pas -55 000 comme avant v268).

**Critère** : |P&L_1Y[0]| < €2 000

**Historique bug** : v268 §52 — double-comptage des dépôts dans startNAVRef

### TEST-03 — Formule P&L vérifiée point par point
**Objectif** : Pour chaque point i, P&L(i) = NAV(i) - startNAVRef - cumDeposits(i)

**Procédure** :
```javascript
const d = window._chartDataByMode['1y'];
let errors = 0;
for (let i = 0; i < d.labels.length; i++) {
  const expected = Math.round(d.ibkrValues[i] - 0 - d.cumDepositsAtPoint[i]);
  if (Math.abs(d.plValuesIBKR[i] - expected) > 1) {
    console.error(`Point ${i} (${d.labels[i]}): got ${d.plValuesIBKR[i]}, expected ${expected}`);
    errors++;
  }
}
console.log(errors === 0 ? '✅ TEST-03 PASS' : `❌ TEST-03 FAIL: ${errors} mismatches`);
```

### TEST-04 — Switching modes ne corrompt pas les données
**Objectif** : Cliquer YTD → 1Y → YTD ne doit pas modifier les données YTD.

**Procédure** :
1. En mode YTD, capturer `_chartDataByMode.ytd.labels.length` et dernier P&L
2. Passer en 1Y
3. Repasser en YTD
4. Vérifier que les valeurs sont identiques au step 1

**Critère** : Aucune différence.

**Historique bug** : Avant v269, le build 1Y écrasait `_ytdChartFullData`, forçant un rebuild YTD.

### TEST-05 — Scope toggle ne triple-rebuild plus
**Objectif** : Changer le scope (IBKR → Tous → ESPP) ne doit pas déclencher de rebuild complet.

**Procédure** : Compter les appels `console.log('[ytd-chart] Built:')` avant/après un toggle scope.

**Critère** : Maximum 1 rebuild par toggle (au lieu de 3 avant v269).

### TEST-06 — P&L Total = IBKR + ESPP + SGTM + Degiro
**Objectif** : La série P&L "Tous" doit être exactement la somme des 4 composantes.

**Procédure** :
```javascript
const d = window._chartDataByMode['ytd'];
let errors = 0;
for (let i = 0; i < d.labels.length; i++) {
  const sum = d.plValuesIBKR[i] + (d.plValuesESPP[i]||0) + (d.plValuesSGTM[i]||0) + d.degiroRealizedPL;
  const total = d.plValuesTotal[i];
  if (Math.abs(total - sum) > 1) {
    console.error(`Point ${i}: total=${total}, sum=${sum}`);
    errors++;
  }
}
console.log(errors === 0 ? '✅ TEST-06 PASS' : `❌ TEST-06 FAIL`);
```

### TEST-07 — NAV consistency 1Y vs YTD (offset constant)
**Objectif** : L'offset NAV entre 1Y et YTD doit être constant (calibration drift ≈ €403).

**Historique bug** : v264 §48 — QQQM buy exclu du 1Y causait un gap de €10K variable.

**Procédure** :
```javascript
const ytd = window._chartDataByMode.ytd;
const oneY = window._chartDataByMode['1y'];
// Find overlapping dates
const offsets = [];
for (let i = 0; i < ytd.labels.length; i++) {
  const j = oneY.labels.indexOf(ytd.labels[i]);
  if (j >= 0) offsets.push(oneY.ibkrValues[j] - ytd.ibkrValues[i]);
}
const stddev = Math.sqrt(offsets.reduce((s,v) => s + (v - offsets[0])**2, 0) / offsets.length);
console.log(stddev < 10 ? '✅ TEST-07 PASS (constant offset)' : `❌ TEST-07 FAIL (stddev=${stddev})`);
```

### TEST-08 — Breakdown "Autres (arrondis)" < €500
**Objectif** : Le résidu dans le breakdown doit rester négligeable.

**Historique bug** : v263 §47 — positions clôturées absentes de allTickers → résidu €14K.

### TEST-09 — Chart title matches displayed data
**Objectif** : Le titre "P&L Tous 1Y — € X" doit correspondre au dernier point de la série affichée.

### TEST-10 — Owner toggle (Amine / Nezha / Both)
**Objectif** : Vérifier que le toggle owner filtre correctement.

**Procédure** :
1. Mode Both + P&L + YTD : noter P&L Total
2. Mode Amine + P&L + YTD : noter P&L Amine
3. Mode Nezha + P&L + YTD : noter P&L Nezha
4. Vérifier : P&L_Both ≈ P&L_Amine + P&L_Nezha (à l'arrondi près)

### TEST-11 — KPI cards update correctly on mode switch
**Objectif** : Les cartes P&L Daily/MTD/1M/YTD doivent refléter le mode actif.

**Historique bug** : KPIs Daily/MTD restaient figées sur les valeurs YTD même en mode 1Y.

### TEST-12 — 5Y/MAX splice cohérent avec alltime simulation
**Objectif** : Au point de splice entre EQUITY_HISTORY et simulation alltime, pas de saut > €1K.

**Historique bug** : v248-v252 §41 — warmup hack + Degiro NAV incorrecte au splice.

### TEST-13 — Degiro P&L constant dans le 1Y
**Objectif** : En mode 1Y, le Degiro P&L devrait être constant (+€50 665) à chaque point, ou idéalement exclu/conditionné (compte clôturé avant la période).

**Note** : Le user devra décider si le Degiro +€50K doit apparaître dans le 1Y P&L Total. C'est un gain pre-period.

---

## 4. Tests de non-régression rapides

| # | Test | Méthode | Critère |
|---|------|---------|---------|
| NR-01 | Page charge sans erreur JS | Console errors = 0 | Pas d'erreur hors extensions |
| NR-02 | KPI cards remplies | `querySelectorAll('.value')` tous non-vides | Pas de "--" |
| NR-03 | Chart visible après chargement | Canvas non-vide | pixels > 0 |
| NR-04 | Tous les period buttons fonctionnent | Click chaque bouton | Chart re-renders |
| NR-05 | Tooltip hover fonctionne | Mouse over chart | Tooltip visible |
| NR-06 | Click detail panel fonctionne | Click on chart | Panel opens |

---

## 5. Matrice de combinaisons à tester

| Mode | Scope | Display | Owner | Expected |
|------|-------|---------|-------|----------|
| YTD | IBKR | Value | Both | Baseline |
| YTD | IBKR | P&L | Both | P&L starts at 0 |
| YTD | Tous | P&L | Both | = IBKR + ESPP + SGTM + Degiro |
| 1Y | IBKR | P&L | Both | P&L[0] ≈ 0 |
| 1Y | Tous | P&L | Both | = IBKR P&L + Degiro constant |
| 5Y | Tous | P&L | Both | Splice smooth |
| MAX | Tous | P&L | Both | Full history |
| YTD | IBKR | P&L | Amine | Amine-only |
| YTD | ESPP | P&L | Nezha | Nezha ESPP only |
| 1Y → YTD | any | any | any | Data not corrupted |
| YTD → 1Y → YTD | any | any | any | Data not corrupted |
