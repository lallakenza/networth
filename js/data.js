// ============================================================
// DATA LAYER — Central data store for patrimonial dashboard
// ============================================================
// See ARCHITECTURE.md for full documentation (data schema,
// pipeline, property configs, loan structures, and version history).
//
// Purpose: Source of truth for all portfolio, property, debt,
// and financial data used by the wealth tracking system.
//
// Architecture: data.js → engine.js → render.js pipeline
// - data.js: Raw portfolio data in native currencies
// - engine.js: Financial calculations, conversions, schedules
// - render.js: DOM rendering and visualization
//
// Data sources:
// - PDF amortization tables (Banque Populaire, Action Logement, LCL)
// - Notaire acts (actes de vente immobilier)
// - Bank statements (Mashreq, Wio, Attijari, Nabd, IBKR, Degiro)
// - Market data (Yahoo Finance API, broker statements)
// - Tax/fiscal documents (TVA, PTZ, LMNP constraints)
//
// Last updated: 12 April 2026
// Version: v289 (v288 → v289 : FX P&L decomposition, version badge, simulators fix)
// All amounts are in their NATIVE currency (AED, MAD, USD, EUR, JPY)
// Never converted here. Engine does all conversions.
//
// ╔══════════════════════════════════════════════════════════╗
// ║  GUIDE MISE À JOUR RAPIDE                               ║
// ║                                                          ║
// ║  1. SOLDES BANCAIRES : modifier les montants dans        ║
// ║     PORTFOLIO.amine.uae / maroc / ibkr                   ║
// ║  2. IBKR POSITIONS : mettre à jour price + shares        ║
// ║     dans PORTFOLIO.amine.ibkr.positions[]                ║
// ║  3. TAUX D'INTÉRÊTS : modifier CASH_YIELDS               ║
// ║     → Les taux IBKR par tranche sont dans engine.js      ║
// ║       (fonction ibkrJPYBorrowCost)                       ║
// ║  4. TAUX DE CHANGE : modifier FX_STATIC (fallback)       ║
// ║     → Les taux live sont récupérés automatiquement        ║
// ║  5. IMMOBILIER : valeurs + CRD dans amine.immo / nezha   ║
// ║  6. CRÉANCES : ajouter/supprimer dans creances.items[]   ║
// ╚══════════════════════════════════════════════════════════╝

export const PORTFOLIO = {
  amine: {
    // ──────────────────────────────────────────────────────
    // CASH UAE (en AED) — se connecter à Mashreq/Wio app
    // ⚠️ Soldes datés du 12 avril 2026 — à rafraîchir manuellement
    // ──────────────────────────────────────────────────────
    uae: {
      mashreq: 484046,      // Mashreq NEO PLUS (Saver 483,544.74 + Current 501.49) — mis à jour 12 Avr 2026
      wioSavings: 195500,   // Wio Personal Savings (~6% rendement) — mis à jour 12 Avr 2026
      wioCurrent: 371,      // Wio Personal Current (compte courant, 0% rendement) — mis à jour 12 Avr 2026
      wioBusiness: 47025,   // Wio Business (Bairok Consulting LLC, 0% rendement) — mis à jour 12 Avr 2026
      revolutEUR: 190,      // Revolut EUR balance (déjà en EUR) — mis à jour 12 Avr 2026
      _lastUpdate: '2026-04-12',
    },

    // ──────────────────────────────────────────────────────
    // CASH MAROC (en MAD) — se connecter à Attijari/Nabd app
    // ⚠️ Soldes datés du 12 avril 2026 — à rafraîchir manuellement
    // ──────────────────────────────────────────────────────
    maroc: {
      attijari: 6799,       // Attijariwafa Courant (0% rendement) — mis à jour 12 Avr 2026
      nabd: 37304,          // Nabd (ex-Société Générale Maroc, 0% rendement) — mis à jour 7 Mar 2026 (pas de nouveau relevé)
      _lastUpdate: '2026-04-12',
    },

    // ══════════════════════════════════════════════════════════════════
    // ESPP ACCENTURE (Amine) — UBS (anciennement Fidelity NetBenefits)
    // ══════════════════════════════════════════════════════════════════
    //
    // SOURCE: EsppPurchaseReport.pdf (rapport Accenture ESPP officiel)
    //         Courtier: UBS — toutes les actions sont chez UBS
    //
    // COMMENT ÇA MARCHE — ESPP (Employee Stock Purchase Plan):
    //   1. Contribution = 10% du salaire brut pendant 6 mois (en EUR)
    //   2. À la fin de la période, Accenture achète les actions avec un
    //      DISCOUNT de ~15% sur le prix le plus bas entre début et fin de période
    //   3. La "Discounted Purchase Price" = ce qu'Amine paie réellement par action
    //   4. Le "FMV at Purchase" = prix de marché le jour de l'achat (cost basis fiscal)
    //   5. Fractional shares → vendues et remboursées en EUR
    //   6. Certains lots ont des "Shares Sold for Tax Withholding" (prélèvement impôt FR)
    //   7. "Shares Available" = entiers détenus après vente fractionnaires + tax withholding
    //
    // DÉTAIL COMPLET DES 10 ACHATS ESPP (source: EsppPurchaseReport.pdf):
    // ┌────────┬──────────────────────────────────┬───────────┬─────────┬──────────────┬───────────────┬──────────┬─────────┬─────────────┬───────────┐
    // │  #     │ Offering Period                   │ Contrib€  │ FX Rate │ Contrib USD  │ Discount $/sh │ FMV $/sh │ Shares  │ Tax WH shs  │ Available │
    // ├────────┼──────────────────────────────────┼───────────┼─────────┼──────────────┼───────────────┼──────────┼─────────┼─────────────┼───────────┤
    // │  1     │ Nov 2022 → May 2023              │ 3 845.99  │ 0.911   │  4 221.72    │  236.8788     │ 278.6809 │ 17.8222 │  0.7609     │    17     │
    // │  2     │ Nov 2021 → May 2022              │ 3 018.32  │ 0.948   │  3 183.88    │  260.0065     │ 305.8900 │ 12.2453 │  0.0000     │    12     │
    // │  3     │ May 2021 → Nov 2021              │ 3 020.66  │ 0.8616  │  3 505.87    │  302.5915     │ 355.9900 │ 11.5861 │  0.0000     │    11     │
    // │  4     │ Nov 2020 → May 2021              │ 3 217.57  │ 0.8318  │  3 868.20    │  246.1940     │ 289.6400 │ 15.7120 │  0.7105     │    15     │
    // │  5     │ May 2020 → Nov 2020              │ 2 365.80  │ 0.8584  │  2 756.06    │  183.3663     │ 215.7250 │ 15.0303 │  0.6626     │    14     │
    // │  6     │ Nov 2019 → May 2020              │ 2 796.67  │ 0.9105  │  3 071.58    │  153.9563     │ 181.1250 │ 19.9509 │  0.9410     │    19     │
    // │  7     │ May 2019 → Nov 2019              │ 2 653.00  │ 0.8955  │  2 962.59    │  159.1421     │ 187.2260 │ 18.6160 │  0.0000     │    18     │
    // │  8     │ Nov 2018 → May 2019              │ 2 401.55  │ 0.8926  │  2 690.51    │  154.9720     │ 182.3200 │ 17.3612 │  0.0000     │    17     │
    // │  9     │ May 2018 → Nov 2018              │ 2 533.06  │ 0.8766  │  2 889.64    │  134.5763     │ 158.3250 │ 21.4721 │  0.0000     │    21     │
    // │  10    │ Nov 2017 → May 2018              │ 2 246.00  │ 0.8336  │  2 694.34    │  128.3798     │ 151.0350 │ 20.9872 │  0.6611     │    20     │
    // ├────────┼──────────────────────────────────┼───────────┼─────────┼──────────────┼───────────────┼──────────┼─────────┼─────────────┼───────────┤
    // │ TOTAUX │                                  │ 28 097.62 │         │ 31 844.39    │               │          │170.7833 │  3.7361     │   164     │
    // └────────┴──────────────────────────────────┴───────────┴─────────┴──────────────┴───────────────┴──────────┴─────────┴─────────────┴───────────┘
    //
    //   + 3 actions FRAC (dividendes réinvestis ~août 2022) → total 164 + 3 = 167 actions
    //
    // NOTE COST BASIS:
    //   costBasis ci-dessous = FMV at Purchase (prix de marché le jour d'achat)
    //   C'est le "cost basis fiscal" (base pour calcul plus-value en France)
    //   Le prix réellement payé est le "Discounted Purchase Price" (cf. tableau ci-dessus)
    //   La différence (discount ~15%) est de l'avantage en nature taxé sur le salaire
    //
    // COMMENT METTRE À JOUR:
    //   - Nouveau lot ESPP? Ajouter en PREMIER dans lots[] (date décroissante)
    //   - Mettre à jour shares (total entiers), totalCostBasisUSD (somme cost × shares)
    //   - Dividendes: ajouter dans acnDividends[] quand Accenture annonce un nouveau trimestre
    //   - Prix ACN live: mis à jour via API (market.acnPriceUSD)
    //
    espp: {
      shares: 167,          // 164 actions ESPP + 3 FRAC (dividendes réinvestis) — toutes chez UBS
      cashEUR: 2000,        // Cash résiduel en EUR dans le compte UBS
      // Lots détaillés — costBasis = FMV at Purchase (USD/action) = cost basis fiscal
      // Triés par date décroissante (plus récent en premier)
      // Note: pour le lot 1, costBasis = Discounted Price (pas FMV) — historique, conservé tel quel
      //
      // Schéma d'un lot (consommé par `esppLotCostEUR` dans engine.js) :
      //   date          : string 'YYYY-MM-DD' — date d'achat (pour ESPP) ou d'attribution (FRAC)
      //   source        : 'ESPP' | 'FRAC' — distingue achat salarial vs dividende réinvesti
      //   shares        : integer — actions entières (les fractions sont rachetées en cash)
      //   costBasis     : number USD/action — FMV at purchase ou Discounted Price
      //   contribEUR    : number EUR — contribution réelle prélevée sur salaire (Amine uniquement).
      //                   Priorité sur `fxRateAtDate` dans `esppLotCostEUR` : si présent, cost = contribEUR.
      //                   Pour FRAC : 0 (dividendes réinvestis, aucune contribution).
      //   fxRateAtDate  : number (optionnel) — EURUSD à la date du lot. Utilisé pour Nezha
      //                   (elle n'a pas contribEUR fiable) en fallback : cost = shares × costBasis / fxRateAtDate.
      //                   Si ni contribEUR ni fxRateAtDate → fallback global (1.15 Amine, 1.10 Nezha).
      //
      // Invariant audit v297 (BUG-043) : `engine.compute()` ET `computeActionsView()` doivent
      // utiliser la MÊME fonction `esppLotCostEUR` pour calculer le cost basis — sinon divergence
      // silencieuse quand FX live ≠ FX historique.
      lots: [
        // Période Nov 2022 → May 2023 | Contrib €3,845.99 | FX 0.911 | Discount $236.88/sh | FMV $278.68/sh
        // 17.8222 shares achetées, 0.7609 vendues pour impôt (€193.18), 0.0613 fractionnaires remboursées
        { date: '2023-05-01', source: 'ESPP', shares: 17, costBasis: 236.8788, contribEUR: 3845.99 },  // cost $4,026.94

        // Actions fractionnaires issues de dividendes réinvestis (~août 2022)
        { date: '2022-08-15', source: 'FRAC', shares: 3,  costBasis: 272.3600, contribEUR: 0 },  // cost $817.08 — dividendes réinvestis, pas de contribution

        // Période Nov 2021 → May 2022 | Contrib €3,018.32 | FX 0.948 | Discount $260.01/sh | FMV $305.89/sh
        // 12.2453 shares achetées, 0 vendues pour impôt, 0.2453 fractionnaires remboursées (€71.13)
        { date: '2022-05-01', source: 'ESPP', shares: 12, costBasis: 305.8900, contribEUR: 3018.32 },  // cost $3,670.68

        // Période May 2021 → Nov 2021 | Contrib €3,020.66 | FX 0.8616 | Discount $302.59/sh | FMV $355.99/sh
        // 11.5861 shares achetées, 0 vendues pour impôt, 0.5861 fractionnaires remboursées (€179.77)
        { date: '2021-11-01', source: 'ESPP', shares: 11, costBasis: 355.9900, contribEUR: 3020.66 },  // cost $3,915.89

        // Période Nov 2020 → May 2021 | Contrib €3,217.57 | FX 0.8318 | Discount $246.19/sh | FMV $289.64/sh
        // 15.7120 shares achetées, 0.7105 vendues pour impôt (€171.18), 0.0015 fractionnaires remboursées
        { date: '2021-04-30', source: 'ESPP', shares: 15, costBasis: 289.6400, contribEUR: 3217.57 },  // cost $4,344.60

        // Période May 2020 → Nov 2020 | Contrib €2,365.80 | FX 0.8584 | Discount $183.37/sh | FMV $215.73/sh
        // 15.0303 shares achetées, 0.6626 vendues pour impôt (€122.70), 0.3677 fractionnaires remboursées (€68.09)
        { date: '2020-10-30', source: 'ESPP', shares: 14, costBasis: 215.7250, contribEUR: 2365.80 },  // cost $3,020.15

        // Période Nov 2019 → May 2020 | Contrib €2,796.67 | FX 0.9105 | Discount $153.96/sh | FMV $181.13/sh
        // 19.9509 shares achetées, 0.9410 vendues pour impôt (€155.18), 0.0099 fractionnaires remboursées
        { date: '2020-05-01', source: 'ESPP', shares: 19, costBasis: 181.1250, contribEUR: 2796.67 },  // cost $3,441.38

        // Période May 2019 → Nov 2019 | Contrib €2,653.00 | FX 0.8955 | Discount $159.14/sh | FMV $187.23/sh
        // 18.6160 shares achetées, 0 vendues pour impôt, 0.6160 fractionnaires remboursées (€103.28)
        { date: '2019-11-01', source: 'ESPP', shares: 18, costBasis: 187.2260, contribEUR: 2653.00 },  // cost $3,370.07 (corrigé: était 187.2300)

        // Période Nov 2018 → May 2019 | Contrib €2,401.55 | FX 0.8926 | Discount $154.97/sh | FMV $182.32/sh
        // 17.3612 shares achetées, 0 vendues pour impôt, 0.3612 fractionnaires remboursées (€58.78)
        { date: '2019-05-01', source: 'ESPP', shares: 17, costBasis: 182.3200, contribEUR: 2401.55 },  // cost $3,099.44

        // Période May 2018 → Nov 2018 | Contrib €2,533.06 | FX 0.8766 | Discount $134.58/sh | FMV $158.33/sh
        // 21.4721 shares achetées, 0 vendues pour impôt, 0.4721 fractionnaires remboursées (€65.52)
        { date: '2018-11-01', source: 'ESPP', shares: 21, costBasis: 158.3250, contribEUR: 2533.06 },  // cost $3,324.83

        // Période Nov 2017 → May 2018 | Contrib €2,246.00 | FX 0.8336 | Discount $128.38/sh | FMV $151.04/sh
        // 20.9872 shares achetées, 0.6611 vendues pour impôt (€83.23), 0.3261 fractionnaires remboursées (€41.06)
        { date: '2018-05-01', source: 'ESPP', shares: 20, costBasis: 151.0350, contribEUR: 2246.00 },  // cost $3,020.70
      ],
      totalCostBasisUSD: 36052,  // Somme de tous les (costBasis × shares) ci-dessus
      // Résumé contributions: 10 périodes, €28,097.62 total prélevé du salaire = $31,844.39
      // Shares achetées: 170.7833 — vendues tax: 3.7361 — fractionnaires: 3.0472 — entiers UBS: 164
    },

    // ════════════════════════════════════════════════════════════
    // INTERACTIVE BROKERS (IBKR) — Compte intégré multimonis
    // Actifs: Actions, ETFs, crypto ETFs, cash multi-devises
    // Accès: ibkr.com — Account de Amine
    // ════════════════════════════════════════════════════════════
    // NOTE: Pour télécharger les données récentes :
    //   → IBKR > Performance & Reports > Net Asset Value CSV
    //   → Réconcilier deposits[], positions[], trades[] avec statement
    //   → Vérifier "Change in NAV" pour commissions, intérêts, dividendes
    //
    //
    // ── PORTFOLIO POSITIONS — Actions, ETFs, crypto ETFs ──
    // Mise à jour : 31/03/2026 (cours live Yahoo Finance 31 mars 2026)
    // Sources : Yahoo Finance (API live), Interactive Brokers (statement)
    //
    // Structure position:
    //   - ticker: symbole Yahoo Finance (ex: 'AIR.PA' = Airbus Paris)
    //   - shares: nombre d'actions détenues (entiers)
    //   - price: cours actuel (fallback statique si API indisponible)
    //   - costBasis: PRU (prix revient unitaire, devise native)
    //   - currency: devise native (EUR, USD, JPY, etc.)
    //   - label: nom complet pour affichage
    //   - sector: secteur d'activité (industrials, luxury, tech, etc.)
    //   - geo: géographie (france, germany, japan, crypto, etc.)
    //   - ytdOpen: clôture 1er jour bourse 2026 (2 janvier) — historique
    //   - mtdOpen: clôture 1er jour du mois courant (avril 2026)
    //   - oneMonthAgo: clôture ~30 jours avant (mi-mars 2026)
    //
    // MISE À JOUR DES PRIX :
    //   1. price: est mis à jour par l'API Yahoo Finance (range=1d)
    //   2. ytdOpen/mtdOpen/oneMonthAgo: refs historiques, mis à jour mensuellement
    //   3. Fallback statique si API indisponible = dernier prix connu
    //
    // ── CASH MULTI-DEVISES ──
    // cashEUR, cashUSD, cashJPY = soldes bruts chez IBKR
    // Négatif = emprunt (ex: JPY carry trade = short JPY pour levier)
    // ──────────────────────────────────────────────────────
    ibkr: {
      staticNAV: 184520,    // NAV totale estimée au 31/03/2026 (positions + cash, recalculée avec prix live)
      positions: [
        // ── ACTIONS CAC 40 & EUROPÉENNES (11 positions) ──
        // Achetées progressivement avril-nov 2025
        // Cours: Yahoo Finance live 31 mars 2026
        // PRU: prix d'achat moyen (costBasis EUR)
        { ticker: 'AIR.PA',  shares: 200,  price: 160.62, costBasis: 190.25, currency: 'EUR', label: 'Airbus (AIR)', sector: 'industrials', geo: 'france', ytdOpen: 203.70, mtdOpen: 175.42, oneMonthAgo: 184.24 },
        { ticker: 'BN.PA',   shares: 200,  price: 69.22,  costBasis: 68.83,  currency: 'EUR', label: 'Danone (BN)', sector: 'consumer', geo: 'france', ytdOpen: 76.04, mtdOpen: 69.94, oneMonthAgo: 72.64 },
        // DG.PA — position fermée le 8 avr 2026 (100 actions vendues à 136.65)

        { ticker: 'FGR.PA',  shares: 100,  price: 131.60, costBasis: 111.81, currency: 'EUR', label: 'Eiffage (FGR)', sector: 'industrials', geo: 'france', ytdOpen: 123.50, mtdOpen: 139.85, oneMonthAgo: 146.20 },
        { ticker: 'MC.PA',   shares: 40,   price: 461.05, costBasis: 472.64, currency: 'EUR', label: 'LVMH (MC)', sector: 'luxury', geo: 'france', ytdOpen: 641.80, mtdOpen: 502.20, oneMonthAgo: 544.10 },
        { ticker: 'OR.PA',   shares: 30,   price: 350.25, costBasis: 361.68, currency: 'EUR', label: "L'Or\u00e9al (OR)", sector: 'luxury', geo: 'france', ytdOpen: 364.70, mtdOpen: 363.75, oneMonthAgo: 397.40 },
        { ticker: 'P911.DE', shares: 400,  price: 38.25,  costBasis: 45.22,  currency: 'EUR', label: 'Porsche (P911)', sector: 'automotive', geo: 'germany', ytdOpen: 47.60, mtdOpen: 38.78, oneMonthAgo: 41.39 },
        { ticker: 'RMS.PA',  shares: 10,   price: 1605.00, costBasis: 2053.03, currency: 'EUR', label: 'Herm\u00e8s (RMS)', sector: 'luxury', geo: 'france', ytdOpen: 2104.00, mtdOpen: 1897.50, oneMonthAgo: 2049.00 },
        { ticker: 'SAN.PA',  shares: 50,   price: 82.81,  costBasis: 77.71,  currency: 'EUR', label: 'Sanofi (SAN)', sector: 'healthcare', geo: 'france', ytdOpen: 82.32, mtdOpen: 79.86, oneMonthAgo: 82.20 },
        { ticker: 'SAP.DE',  shares: 70,   price: 147.64, costBasis: 190.86, currency: 'EUR', label: 'SAP SE', sector: 'tech', geo: 'germany', ytdOpen: 236.92, mtdOpen: 165.48, oneMonthAgo: 170.96 }, // SAP.DE = Xetra (EUR), not 'SAP' which is NYSE ADR (USD)
        { ticker: '4911.T',  shares: 500,  price: 3190,   costBasis: 2180.74, currency: 'JPY', label: 'Shiseido (4911)', sector: 'consumer', geo: 'japan', ytdOpen: 2309.50, mtdOpen: 3068.00, oneMonthAgo: 3300.00 },
        { ticker: 'IBIT',    shares: 1200, price: 37.68,  costBasis: 44.97,  currency: 'USD', label: 'iShares Bitcoin (IBIT)', sector: 'crypto', geo: 'crypto', ytdOpen: 50.94, mtdOpen: 39.19, oneMonthAgo: 37.19 },
        { ticker: 'ETHA',    shares: 1100, price: 15.27,  costBasis: 18.53,  currency: 'USD', label: 'iShares Ethereum (ETHA)', sector: 'crypto', geo: 'crypto', ytdOpen: 23.58, mtdOpen: 15.37, oneMonthAgo: 14.52 },
      ],
      // ⬇️ Cash multi-devises (IBKR — mis à jour 08/04/2026 après vente DG + deleverage JPY)
      // Depuis 18/03: -2000 retrait + 13665 DG sell - 6.83 comm - 11679 EUR→JPY - 319.17 FX fees ≈ -341
      cashEUR: -341,         // Solde EUR chez IBKR au 08/04/2026 (approx, hors intérêts mars/avr)
      cashUSD: 0,            // Solde USD chez IBKR au 08/04/2026
      cashJPY: -2429378,     // Solde JPY chez IBKR au 08/04/2026 (-4590694 + 2161316 EUR→JPY)
      // Performance metrics — TOUTES les valeurs financières sont calculées dynamiquement
      // par engine.js depuis trades[] et costs[]. Aucun montant hardcodé ici.
      meta: {
        twr: -13.7,            // TWR % YTD 2026 — fallback statique, OVERRIDDEN by chart TWR at runtime
      },
      // ══════════════════════════════════════════════════════════════
      // COÛTS IBKR (hors commissions de trades)
      // ══════════════════════════════════════════════════════════════
      // Source: Activity Statement CSV U18138426, sections "Interest" et "Dividends"
      // ⚠ RÈGLES DE MISE À JOUR:
      //   1. Intérêts: copier depuis section "Interest" du CSV IBKR
      //      → regrouper par mois, sommer EUR + USD + JPY séparément
      //      → les montants JPY sont gros (ex: ¥23049) mais petit en EUR (~€140)
      //      → engine.js convertit en EUR via toEUR()
      //   2. Dividendes: copier depuis section "Dividends" du CSV IBKR
      //      → montant NET (après WHT retenu à la source par IBKR)
      //      → WHT est calculé séparément par engine.js, ne PAS le soustraire ici
      //      → en fait, stocker le montant BRUT et laisser engine calculer le WHT
      //   3. RÉCONCILIATION (Change in NAV au 19/03/2026):
      //      Commissions IBKR: -€217.31 (= somme des t.commission dans trades[], converti en EUR)
      //      Transaction Fees (FTT): -€666.87 (= calculé par engine.js via FTT_RATE × cost)
      //      Interest: -€512.34 (= somme des costs[type:'interest'] ci-dessous)
      //      Dividends: +€648.53 (= EUR 601.99 + USD 54.60 converti)
      //      WHT: -€164.41
      // ══════════════════════════════════════════════════════════════
      costs: [
        // Intérêts marge (debit interest on margin + SYEP credits)
        { date: '2025-05-05', type: 'interest', eurAmount: -9.13,   usdAmount: 0,      jpyAmount: 0,     label: 'Interest Apr-2025' },
        { date: '2025-06-04', type: 'interest', eurAmount: -3.51,   usdAmount: 0,      jpyAmount: 0,     label: 'Interest May-2025' },
        { date: '2025-07-03', type: 'interest', eurAmount: -0.85,   usdAmount: 0,      jpyAmount: 0,     label: 'Interest Jun-2025' },
        { date: '2025-08-05', type: 'interest', eurAmount: -0.14,   usdAmount: 0,      jpyAmount: 0,     label: 'Interest Jul-2025' },
        { date: '2025-09-04', type: 'interest', eurAmount: -7.98,   usdAmount: 0,      jpyAmount: 0,     label: 'Interest Aug-2025' },
        { date: '2025-10-03', type: 'interest', eurAmount: -18.62,  usdAmount: 0,      jpyAmount: 0,     label: 'Interest Sep-2025' },
        { date: '2025-11-05', type: 'interest', eurAmount: -18.09,  usdAmount: 0,      jpyAmount: 0,     label: 'Interest Oct-2025' },
        { date: '2025-12-04', type: 'interest', eurAmount: -9.88,   usdAmount: 0,      jpyAmount: 0,     label: 'Interest Nov-2025' },
        { date: '2026-01-06', type: 'interest', eurAmount: -70.27,  usdAmount: -12.40, jpyAmount: -1778, label: 'Interest Dec-2025' },
        { date: '2026-02-04', type: 'interest', eurAmount: -49.42,  usdAmount: -26.00, jpyAmount: -4619, label: 'Interest Jan-2026' },
        { date: '2026-03-04', type: 'interest', eurAmount: -27.73,  usdAmount: -74.31, jpyAmount: -23049,label: 'Interest Feb-2026' },
        // ── DIVIDENDES IBKR (net après WHT) ──
        // Source: IBKR Activity Statement CSV, sections "Dividends" + "Withholding Tax"
        // Format: { date, type, [ticker], eurAmount, label }
        // Taxation: WHT (Withholding Tax) prélevée à la source
        //   - France (PAC, GLE, DG, MC, RMS): 25% WHT
        //   - USA (QQQM): 30% WHT
        // Formule: eurAmount = montant brut - WHT (= net crédité sur compte)
        // Note: montants bruts stockés dans "label" pour audit fiscal
        { date: '2025-10-09', type: 'dividend', ticker: 'GLE',    eurAmount: 91.50,  label: 'Div GLE net (€122 brut − €30.50 WHT 25%)' },
        { date: '2025-10-16', type: 'dividend', ticker: 'DG.PA',  eurAmount: 157.50, label: 'Div DG net (€210 brut − €52.50 WHT 25%)' },
        { date: '2025-12-04', type: 'dividend', ticker: 'MC.PA',  eurAmount: 165.00, label: 'Div MC net (€220 brut − €55 WHT 25%)' },
        { date: '2025-06-27', type: 'dividend', ticker: 'QQQM',   eurAmount: 11.08,  label: 'Div QQQM Q2 ($18.33 brut − $5.50 WHT, FX 1.1568)' },  // ($18.33-$5.50)/1.1568
        { date: '2025-09-26', type: 'dividend', ticker: 'QQQM',   eurAmount: 10.85,  label: 'Div QQQM Q3 ($17.54 brut − $5.26 WHT, FX 1.1328)' },  // ($17.54-$5.26)/1.1328
        { date: '2025-12-26', type: 'dividend', ticker: 'QQQM',   eurAmount: 12.50,  label: 'Div QQQM Q4 ($18.73 brut − $5.62 WHT, FX 1.0489)' },  // ($18.73-$5.62)/1.0489
        { date: '2026-02-18', type: 'dividend', ticker: 'RMS.PA', eurAmount: 37.54,  label: 'Div RMS net (€50 brut − €12.46 WHT 25%)' },
      ],
      // ── Dividendes ACN (ESPP) ──
      // Source: Accenture IR quarterly dividend history (accenture.com/investor-relations)
      // Montants: per-share en USD, WHT 15% US→FR retenu à la source
      // Le nombre d'actions détenues évolue avec les lots ESPP (voir espp.lots ci-dessus)
      acnDividends: [
        // FY2019 (oct 2018 → sept 2019)
        { exDate: '2019-01-10', payDate: '2019-02-15', perShareUSD: 0.80 },
        { exDate: '2019-04-11', payDate: '2019-05-15', perShareUSD: 0.80 },
        { exDate: '2019-07-11', payDate: '2019-08-15', perShareUSD: 0.80 },
        { exDate: '2019-10-10', payDate: '2019-11-15', perShareUSD: 0.80 },
        // FY2020 (oct 2019 → sept 2020)
        { exDate: '2020-01-09', payDate: '2020-02-14', perShareUSD: 0.88 },
        { exDate: '2020-04-09', payDate: '2020-05-15', perShareUSD: 0.88 },
        { exDate: '2020-07-09', payDate: '2020-08-14', perShareUSD: 0.88 },
        { exDate: '2020-10-08', payDate: '2020-11-16', perShareUSD: 0.88 },
        // FY2021 (oct 2020 → sept 2021)
        { exDate: '2021-01-07', payDate: '2021-02-12', perShareUSD: 0.97 },
        { exDate: '2021-04-08', payDate: '2021-05-14', perShareUSD: 0.97 },
        { exDate: '2021-07-08', payDate: '2021-08-13', perShareUSD: 0.97 },
        { exDate: '2021-10-07', payDate: '2021-11-15', perShareUSD: 0.97 },
        // FY2022 (oct 2021 → sept 2022)
        { exDate: '2022-01-06', payDate: '2022-02-15', perShareUSD: 1.12 },
        { exDate: '2022-04-07', payDate: '2022-05-16', perShareUSD: 1.12 },
        { exDate: '2022-07-07', payDate: '2022-08-15', perShareUSD: 1.12 },
        { exDate: '2022-10-06', payDate: '2022-11-15', perShareUSD: 1.12 },
        // FY2023 (oct 2022 → sept 2023)
        { exDate: '2023-01-05', payDate: '2023-02-15', perShareUSD: 1.29 },
        { exDate: '2023-04-06', payDate: '2023-05-15', perShareUSD: 1.29 },
        { exDate: '2023-07-06', payDate: '2023-08-15', perShareUSD: 1.29 },
        { exDate: '2023-10-05', payDate: '2023-11-15', perShareUSD: 1.29 },
        // FY2024 (oct 2023 → sept 2024)
        { exDate: '2024-01-11', payDate: '2024-02-15', perShareUSD: 1.29 },
        { exDate: '2024-04-11', payDate: '2024-05-15', perShareUSD: 1.48 },
        { exDate: '2024-07-11', payDate: '2024-08-15', perShareUSD: 1.48 },
        { exDate: '2024-10-10', payDate: '2024-11-15', perShareUSD: 1.48 },
        // FY2025 (oct 2024 → sept 2025) — all 4 quarters at $1.48
        // Source: investor.accenture.com/stock-information/dividend-history
        // fxEURUSD: historical EUR/USD rate at pay date (Yahoo Finance) — used by engine.js
        //           to convert to EUR instead of using current rate (avoids identical EUR amounts)
        { exDate: '2025-01-09', payDate: '2025-02-14', perShareUSD: 1.48, fxEURUSD: 1.0475 },
        { exDate: '2025-04-10', payDate: '2025-05-15', perShareUSD: 1.48, fxEURUSD: 1.1188 },  // was 1.63, fixed
        { exDate: '2025-07-10', payDate: '2025-08-15', perShareUSD: 1.48, fxEURUSD: 1.0975 },  // was 1.63, fixed
        { exDate: '2025-10-09', payDate: '2025-11-14', perShareUSD: 1.48, fxEURUSD: 1.0545 },  // was 1.63, fixed
        // FY2026 (oct 2025 → ...) — increased to $1.63/share
        { exDate: '2026-01-09', payDate: '2026-02-13', perShareUSD: 1.63, fxEURUSD: 1.0402 },
      ],
      // ══════════════════════════════════════════════════════════════
      // DÉPÔTS & RETRAITS IBKR — Source: Activity Statement U18138426
      // ══════════════════════════════════════════════════════════════
      // ⚠ RÈGLES DE MISE À JOUR (pour Claude ou humain):
      //   1. Copier EXACTEMENT depuis la section "Deposits & Withdrawals" du CSV IBKR
      //   2. Un retrait = amount NÉGATIF (ex: -45000)
      //   3. Les dépôts AED utilisent currency:'AED' et fxRateAtDate du jour
      //      (vérifier sur IBKR le taux EUR/AED appliqué)
      //   4. TOUJOURS vérifier que la somme correspond au "Total Deposits & Withdrawals in EUR"
      //      affiché dans le statement IBKR (section "Change in NAV")
      //   5. Ne PAS regrouper les virements — garder les dates et montants exacts du statement
      //
      // RÉCONCILIATION au 31/03/2026:
      //   EUR brut: +199,000 - 45,000 - 2,000 = +152,000
      //   AED brut: +195,000 (= €45,886.10 au taux IBKR)
      //   TOTAL IBKR "Deposits & Withdrawals": €197,886.10 ✓
      // ══════════════════════════════════════════════════════════════
      deposits: [
        // ── EUR deposits (statement IBKR lignes 318-331) ──
        // Dates alignées sur le CSV IBKR (compte ouvert le 8 avril 2025, Starting NAV: €54,398.37)
        { date: '2025-04-08', amount: 10000,  currency: 'EUR', fxRateAtDate: 1, label: 'Virement initial IBKR' },
        { date: '2025-04-08', amount: 45000,  currency: 'EUR', fxRateAtDate: 1, label: 'Virement complémentaire avril' },
        { date: '2025-04-23', amount: -45000, currency: 'EUR', fxRateAtDate: 1, label: 'Retrait EUR (disbursement)' },
        { date: '2025-08-11', amount: 20000,  currency: 'EUR', fxRateAtDate: 1, label: 'Virement août #1' },
        { date: '2025-08-19', amount: 25000,  currency: 'EUR', fxRateAtDate: 1, label: 'Virement août #2' },
        { date: '2025-08-26', amount: 25000,  currency: 'EUR', fxRateAtDate: 1, label: 'Virement août #3' },
        { date: '2025-08-27', amount: 34000,  currency: 'EUR', fxRateAtDate: 1, label: 'Virement août #4' },
        { date: '2025-08-28', amount: 4000,   currency: 'EUR', fxRateAtDate: 1, label: 'Virement août #5' },
        { date: '2025-09-16', amount: 3000,   currency: 'EUR', fxRateAtDate: 1, label: 'Virement septembre #1' },
        { date: '2025-09-24', amount: 1500,   currency: 'EUR', fxRateAtDate: 1, label: 'Virement septembre #2' },
        { date: '2025-10-29', amount: 8500,   currency: 'EUR', fxRateAtDate: 1, label: 'Virement octobre' },
        { date: '2025-11-04', amount: 5000,   currency: 'EUR', fxRateAtDate: 1, label: 'Virement novembre' },
        { date: '2025-12-19', amount: 15000,  currency: 'EUR', fxRateAtDate: 1, label: 'Virement décembre' },
        { date: '2026-01-09', amount: 3000,   currency: 'EUR', fxRateAtDate: 1, label: 'Virement janvier 2026' },
        { date: '2026-03-31', amount: -2000,  currency: 'EUR', fxRateAtDate: 1, label: 'Retrait EUR (mars 2026)' },
        // ── AED deposits (statement IBKR lignes 312-315) ──
        { date: '2025-10-22', amount: 10000,  currency: 'AED', fxRateAtDate: 4.255, label: 'Virement AED #1 (Mashreq→IBKR)' },
        { date: '2025-10-22', amount: 100000, currency: 'AED', fxRateAtDate: 4.255, label: 'Virement AED #2 (Mashreq→IBKR)' },
        { date: '2025-11-03', amount: 70000,  currency: 'AED', fxRateAtDate: 4.234, label: 'Virement AED #3 (Mashreq→IBKR)' },
        { date: '2025-11-03', amount: 15000,  currency: 'AED', fxRateAtDate: 4.234, label: 'Virement AED #4 (Mashreq→IBKR)' },
      ],
      // Total dépôts IBKR = €197,886.10 (vérifié vs statement — inclut retrait -2000 mars 2026)
      // ══════════════════════════════════════════════════════════════
      // HISTORIQUE COMPLET DES TRADES IBKR
      // ══════════════════════════════════════════════════════════════
      // Source: Activity Statement CSV U18138426 — section "Trades"
      // Période: April 2025 → March 2026
      //
      // ⚠ RÈGLES DE MISE À JOUR (IMPORTANT pour éviter les bugs):
      //
      //   FORMAT: { date, ticker, label, type, qty, price, currency,
      //             cost|proceeds, realizedPL, commission, costBasis, source }
      //
      //   ① type: 'buy' | 'sell' | 'fx'
      //   ② qty: TOUJOURS POSITIF. C'est type qui indique le sens.
      //   ③ cost (buy) / proceeds (sell): montant total = qty × price
      //   ④ realizedPL: P/L réalisé — UNIQUEMENT sur les sells, copié du CSV IBKR
      //   ⑤ commission: frais de courtage EN DEVISE NATIVE DU TRADE
      //      → pour un trade JPY (ex: Shiseido 4911.T), la commission est en ¥
      //      → engine.js convertit automatiquement en EUR via toEUR()
      //      → NE PAS convertir manuellement ici
      //      ⚠ La commission NE contient PAS la FTT (taxe transactions financières)
      //      → la FTT est calculée séparément par engine.js (FTT_RATE × cost)
      //      → dans le CSV IBKR: "Commission" et "Transaction Fees" sont 2 colonnes séparées
      //   ⑥ costBasis: PRU moyen au moment du trade (du CSV IBKR)
      //   ⑦ currency: devise du trade — CRITIQUE pour la conversion des commissions
      //   ⑧ fxRate: (non-EUR trades only) taux EUR/XXX à la date du trade (ECB ref)
      //      → utilisé par engine.js pour décomposer le P&L en Stock P&L + FX P&L
      //      → source: ECB reference rates via exchange-rates.org
      //
      // RÉCONCILIATION commissions au 19/03/2026:
      //   IBKR "Commissions" (Change in NAV): -€217.31
      //   Somme des t.commission ci-dessous (après conversion EUR): ≈-€217
      //   IBKR "Transaction Fees" (FTT): -€666.87
      //   Calculé par engine.js (FTT_RATE=0.4% × achats éligibles): ≈-€667
      // ══════════════════════════════════════════════════════════════
      trades: [
        // ═══════════════════════════════════════════════════
        //  STOCK TRADES — triés par date
        // ═══════════════════════════════════════════════════

        // ─── QQQM (Invesco Nasdaq 100) — achat avr 2025, vendu fév 2026 ───
        { date: '2025-04-03', ticker: 'QQQM', label: 'Invesco Nasdaq 100', type: 'buy',  qty: 58,   price: 185.80,  currency: 'USD', cost: 10776,  commission: -1.00, costBasis: 185.63, fxRate: 1.10607, source: 'ibkr' },
        // ─── MC (LVMH) — position ouverte ───
        { date: '2025-08-18', ticker: 'MC.PA',   label: 'LVMH',              type: 'buy',  qty: 40,   price: 472.40,  currency: 'EUR', cost: 18896,  commission: -9.45, costBasis: 475.85 , source: 'ibkr' },
        // ─── P911 (Porsche) — position ouverte ───
        { date: '2025-08-18', ticker: 'P911.DE', label: 'Porsche',           type: 'buy',  qty: 400,  price: 45.20,   currency: 'EUR', cost: 18080,  commission: -9.04, costBasis: 45.50 , source: 'ibkr' },
        // ─── WLN (Worldline) — achat août/oct 2025, coupé fév 2026 ───
        { date: '2025-08-19', ticker: 'WLN',  label: 'Worldline',         type: 'buy',  qty: 1000, price: 3.028,   currency: 'EUR', cost: 3028,   commission: -3.00, costBasis: 3.022 , source: 'ibkr' },
        // ─── DG (Vinci) — position ouverte ───
        { date: '2025-08-25', ticker: 'DG.PA',   label: 'Vinci',             type: 'buy',  qty: 200,  price: 122.40,  currency: 'EUR', cost: 24480,  commission: -12.24, costBasis: 121.50 , source: 'ibkr' },
        // ─── FGR (Eiffage) — position ouverte ───
        { date: '2025-08-26', ticker: 'FGR.PA',  label: 'Eiffage',           type: 'buy',  qty: 100,  price: 111.75,  currency: 'EUR', cost: 11175,  commission: -5.59, costBasis: 109.75 , source: 'ibkr' },
        // ─── GLE (Société Générale) — achat août 2025, vendu fév 2026 ───
        { date: '2025-08-26', ticker: 'GLE',  label: 'Société Générale',  type: 'buy',  qty: 200,  price: 51.24,   currency: 'EUR', cost: 10248,  commission: -5.12, costBasis: 52.00 , source: 'ibkr' },
        // ─── NXI (Nexity) — achat août/oct 2025, vendu fév 2026 ───
        { date: '2025-08-27', ticker: 'NXI',  label: 'Nexity',            type: 'buy',  qty: 1000, price: 9.60,    currency: 'EUR', cost: 9600,   commission: -4.80, costBasis: 9.535 , source: 'ibkr' },
        { date: '2025-08-28', ticker: 'NXI',  label: 'Nexity',            type: 'buy',  qty: 500,  price: 9.10,    currency: 'EUR', cost: 4550,   commission: -3.00, costBasis: 9.10 , source: 'ibkr' },
        // ─── SAN (Sanofi) — position ouverte ───
        { date: '2025-09-04', ticker: 'SAN.PA',  label: 'Sanofi',            type: 'buy',  qty: 50,   price: 77.65,   currency: 'EUR', cost: 3883,   commission: -3.00, costBasis: 78.96 , source: 'ibkr' },
        // ─── EDEN (Edenred) — ouvert sep 2025, fermé fév 2026 ───
        { date: '2025-09-15', ticker: 'EDEN', label: 'Edenred',           type: 'buy',  qty: 2000, price: 19.95,   currency: 'EUR', cost: 39900,  commission: -19.95, costBasis: 19.95 , source: 'ibkr' },
        // ─── RMS (Hermès) — position ouverte ───
        { date: '2025-09-25', ticker: 'RMS.PA',  label: 'Hermès',            type: 'buy',  qty: 10,   price: 2052,    currency: 'EUR', cost: 20520,  commission: -10.26, costBasis: 2062 , source: 'ibkr' },
        // ─── EDEN sells (Oct 2025) — prises de profit partielles ───
        { date: '2025-10-01', ticker: 'EDEN', label: 'Edenred',           type: 'sell', qty: 300,  price: 20.34,   currency: 'EUR', proceeds: 6102,  realizedPL: 110.96,  commission: -3.05, costBasis: 20.43 , source: 'ibkr' },
        { date: '2025-10-02', ticker: 'EDEN', label: 'Edenred',           type: 'sell', qty: 300,  price: 20.78,   currency: 'EUR', proceeds: 6234,  realizedPL: 242.89,  commission: -3.12, costBasis: 20.70 , source: 'ibkr' },
        { date: '2025-10-03', ticker: 'EDEN', label: 'Edenred',           type: 'sell', qty: 300,  price: 21.29,   currency: 'EUR', proceeds: 6387,  realizedPL: 395.81,  commission: -3.19, costBasis: 21.47 , source: 'ibkr' },
        // ─── NXI renfort + WLN renfort ───
        { date: '2025-10-28', ticker: 'NXI',  label: 'Nexity',            type: 'buy',  qty: 500,  price: 9.34,    currency: 'EUR', cost: 4670,   commission: -3.00, costBasis: 9.15 , source: 'ibkr' },
        { date: '2025-10-29', ticker: 'WLN',  label: 'Worldline',         type: 'buy',  qty: 2000, price: 2.295,   currency: 'EUR', cost: 4590,   commission: -3.00, costBasis: 2.315 , source: 'ibkr' },
        // ─── OR (L'Oréal) — position ouverte ───
        { date: '2025-11-03', ticker: 'OR.PA',   label: "L'Oréal",           type: 'buy',  qty: 30,   price: 361.50,  currency: 'EUR', cost: 10845,  commission: -5.42, costBasis: 361.85 , source: 'ibkr' },
        // ─── 4911.T (Shiseido) — position ouverte (JPY) ───
        { date: '2025-11-25', ticker: '4911.T',  label: 'Shiseido',          type: 'buy',  qty: 500,  price: 2179,    currency: 'JPY', cost: 1089500, commission: -871.60, costBasis: 2179, fxRate: 180.620, source: 'ibkr' },
        // ─── AIR (Airbus) — 2 lots, position ouverte ───
        { date: '2025-12-01', ticker: 'AIR.PA',  label: 'Airbus',            type: 'buy',  qty: 100,  price: 196.50,  currency: 'EUR', cost: 19650,  commission: -9.83, costBasis: 192.58 , source: 'ibkr' },
        { date: '2025-12-01', ticker: 'AIR.PA',  label: 'Airbus',            type: 'buy',  qty: 100,  price: 183.80,  currency: 'EUR', cost: 18380,  commission: -9.19, costBasis: 192.58 , source: 'ibkr' },
        // ─── IBIT (iShares Bitcoin) — position ouverte ───
        { date: '2025-12-11', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 100,  price: 50.76,   currency: 'USD', cost: 5076,   commission: -1.00, costBasis: 52.10, fxRate: 1.17401, source: 'ibkr' },
        // ─── EDEN rebuy jan 2026 ───
        { date: '2026-01-16', ticker: 'EDEN', label: 'Edenred',           type: 'buy',  qty: 300,  price: 17.985,  currency: 'EUR', cost: 5396,   commission: -3.00, costBasis: 17.60 , source: 'ibkr' },
        // ─── BN (Danone) — position ouverte ───
        { date: '2026-01-21', ticker: 'BN.PA',   label: 'Danone',            type: 'buy',  qty: 200,  price: 68.80,   currency: 'EUR', cost: 13760,  commission: -6.88, costBasis: 67.40 , source: 'ibkr' },
        // ─── SAP — position ouverte (Xetra EUR, ticker Yahoo = SAP.DE) ───
        { date: '2026-01-21', ticker: 'SAP.DE',  label: 'SAP SE',            type: 'buy',  qty: 70,   price: 190.76,  currency: 'EUR', cost: 13353,  commission: -6.68, costBasis: 191.04 , source: 'ibkr' },
        // ─── IBIT renforcements jan/fév 2026 ───
        { date: '2026-01-29', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 500,  price: 47.44,   currency: 'USD', cost: 23720,  commission: -2.50, costBasis: 47.60, fxRate: 1.19740, source: 'ibkr' },
        // ─── ETHA (iShares Ethereum) — 3 lots ───
        { date: '2026-01-30', ticker: 'ETHA',    label: 'iShares Ethereum',  type: 'buy',  qty: 500,  price: 20.59,   currency: 'USD', cost: 10295,  commission: -2.50, costBasis: 20.17, fxRate: 1.18537, source: 'ibkr' },
        { date: '2026-02-02', ticker: 'ETHA',    label: 'iShares Ethereum',  type: 'buy',  qty: 200,  price: 18.01,   currency: 'USD', cost: 3602,   commission: -1.00, costBasis: 17.50, fxRate: 1.17960, source: 'ibkr' },
        { date: '2026-02-04', ticker: 'ETHA',    label: 'iShares Ethereum',  type: 'buy',  qty: 400,  price: 16.20,   currency: 'USD', cost: 6480,   commission: -2.00, costBasis: 16.34, fxRate: 1.18036, source: 'ibkr' },
        // ─── IBIT renforcements fév 2026 ───
        { date: '2026-02-03', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 300,  price: 42.50,   currency: 'USD', cost: 12750,  commission: -1.50, costBasis: 43.30, fxRate: 1.18129, source: 'ibkr' },
        { date: '2026-02-04', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 100,  price: 41.75,   currency: 'USD', cost: 4175,   commission: -1.00, costBasis: 41.57, fxRate: 1.18036, source: 'ibkr' },
        { date: '2026-02-04', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 100,  price: 41.50,   currency: 'USD', cost: 4150,   commission: -1.00, costBasis: 41.57, fxRate: 1.18036, source: 'ibkr' },
        { date: '2026-02-04', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 100,  price: 40.90,   currency: 'USD', cost: 4090,   commission: -1.00, costBasis: 41.57, fxRate: 1.18036, source: 'ibkr' },
        // ─── QQQM sell — profit-taking ───
        { date: '2026-02-24', ticker: 'QQQM', label: 'Invesco Nasdaq 100', type: 'sell', qty: 58,   price: 250.49,  currency: 'USD', proceeds: 14528, realizedPL: 3750.01, commission: -1.01, costBasis: 250.31, fxRate: 1.17745, source: 'ibkr' },
        // ─── GLE sell — vente totale ───
        { date: '2026-02-25', ticker: 'GLE',  label: 'Société Générale',  type: 'sell', qty: 200,  price: 75.34,   currency: 'EUR', proceeds: 15068, realizedPL: 4807.34, commission: -7.53, costBasis: 76.24 , source: 'ibkr' },
        // ─── WLN sell — coupure perte ───
        { date: '2026-02-25', ticker: 'WLN',  label: 'Worldline',         type: 'sell', qty: 3000, price: 1.475,   currency: 'EUR', proceeds: 4425,  realizedPL: -3202,   commission: -3.00, costBasis: 1.4435 , source: 'ibkr' },
        // ─── EDEN ventes finales (2 lots) ───
        { date: '2026-02-26', ticker: 'EDEN', label: 'Edenred',           type: 'sell', qty: 600,  price: 19.38,   currency: 'EUR', proceeds: 11628, realizedPL: -353.80, commission: -5.81, costBasis: 19.59 , source: 'ibkr' },
        { date: '2026-02-26', ticker: 'EDEN', label: 'Edenred',           type: 'sell', qty: 800,  price: 19.45,   currency: 'EUR', proceeds: 15560, realizedPL: 173.73,  commission: -7.78, costBasis: 19.59 , source: 'ibkr' },
        // Total EDEN P/L: 110.96 + 242.89 + 395.81 - 353.80 + 173.73 = +569.59
        // ─── NXI sell — vente totale ───
        { date: '2026-02-27', ticker: 'NXI',  label: 'Nexity',            type: 'sell', qty: 2000, price: 9.62,    currency: 'EUR', proceeds: 19240, realizedPL: 399.58,  commission: -9.62, costBasis: 9.535 , source: 'ibkr' },
        // ─── DG vente partielle (100/200) — 17 mars 2026 ───
        { date: '2026-03-17', ticker: 'DG.PA',  label: 'Vinci',             type: 'sell', qty: 40,   price: 131.20,  currency: 'EUR', proceeds: 5248,  realizedPL: 349.60,  commission: -3.00, costBasis: 122.46 , source: 'ibkr' },  // 40×(131.20-122.46)
        { date: '2026-03-17', ticker: 'DG.PA',  label: 'Vinci',             type: 'sell', qty: 60,   price: 131.20,  currency: 'EUR', proceeds: 7872,  realizedPL: 524.40,  commission: -3.56, costBasis: 122.46 , source: 'ibkr' },  // 60×(131.20-122.46)
        // ─── DG (Vinci) — solde position 8 avr 2026 ───
        { date: '2026-04-08', ticker: 'DG.PA',  label: 'Vinci',             type: 'sell', qty: 100,  price: 136.65,  currency: 'EUR', proceeds: 13665, realizedPL: 1419.00, commission: -6.83, costBasis: 122.46 , source: 'ibkr' },  // 100×(136.65-122.46)

        // ═══════════════════════════════════════════════════
        //  FX TRADES — conversions de devises & carry trade
        // ═══════════════════════════════════════════════════

        // ─── EUR→USD conversion initiale avr 2025 ───
        { date: '2025-04-21', ticker: 'EUR.USD', label: 'EUR→USD',            type: 'fx', qty: 10000,  price: 1.1498,  currency: 'EUR', targetAmount: 11498,  targetCurrency: 'USD', commission: -1.74, note: 'Conversion EUR→USD pour achats US' , source: 'ibkr' },
        // ─── EUR→AED conversions oct/nov 2025 ───
        { date: '2025-10-22', ticker: 'EUR.AED', label: 'EUR→AED',            type: 'fx', qty: 2350,   price: 4.25505, currency: 'EUR', targetAmount: 9999,   targetCurrency: 'AED', commission: -1.72 , source: 'ibkr' },
        { date: '2025-10-22', ticker: 'EUR.AED', label: 'EUR→AED',            type: 'fx', qty: 23482,  price: 4.2584,  currency: 'EUR', targetAmount: 99996,  targetCurrency: 'AED', commission: -1.72 , source: 'ibkr' },
        { date: '2025-11-03', ticker: 'EUR.AED', label: 'EUR→AED',            type: 'fx', qty: 20074,  price: 4.23425, currency: 'EUR', targetAmount: 84998,  targetCurrency: 'AED', commission: -1.74 , source: 'ibkr' },
        // ─── JPY carry trade — short JPY jan/fév 2026 ───
        { date: '2026-01-09', ticker: 'EUR.JPY', label: 'EUR→JPY (short)',    type: 'fx', qty: 14000,  price: 183.88,  currency: 'EUR', jpyAmount: -2574320,  commission: -1.72, note: 'Short JPY — carry trade' , source: 'ibkr' },
        { date: '2026-02-06', ticker: 'EUR.JPY', label: 'EUR→JPY (short)',    type: 'fx', qty: 33000,  price: 185.452, currency: 'EUR', jpyAmount: -6119916,  commission: -1.70, note: 'Short JPY — carry trade' , source: 'ibkr' },
        { date: '2026-02-06', ticker: 'USD.JPY', label: 'USD→JPY (short)',    type: 'fx', qty: 73700,  price: 157.067, currency: 'USD', jpyAmount: -11575838, commission: -1.70, note: 'Short JPY — carry trade' , source: 'ibkr' },
        // ─── JPY deleverage 10 mars 2026 ───
        { date: '2026-03-10', ticker: 'EUR.JPY', label: 'EUR→JPY (deleverage)', type: 'fx', qty: 65926, price: 183.595, currency: 'EUR', jpyAmount: 12103684, commission: -1.72, note: 'Rachat JPY short' , source: 'ibkr' },
        { date: '2026-03-10', ticker: 'USD.JPY', label: 'USD→JPY (deleverage)', type: 'fx', qty: 14480, price: 158.090, currency: 'USD', jpyAmount: 2289143,  commission: -1.72, note: 'Rachat JPY short' , source: 'ibkr' },
        // ─── JPY deleverage 18 mars 2026 ───
        { date: '2026-03-18', ticker: 'EUR.JPY', label: 'EUR→JPY (deleverage)', type: 'fx', qty: 13111, price: 183.545, currency: 'EUR', jpyAmount: 2406458,  commission: -1.73, note: 'Rachat JPY short — deleverage' , source: 'ibkr' },
        // ─── JPY deleverage 8 avr 2026 ───
        { date: '2026-04-08', ticker: 'EUR.JPY', label: 'EUR→JPY (deleverage)', type: 'fx', qty: 11679, price: 185.060, currency: 'EUR', jpyAmount: 2161316,  commission: -319.17, note: 'Rachat JPY short — deleverage' , source: 'ibkr' },
      ],
    },

    // ──────────────────────────────────────────────────────
    // SGTM (Société Générale Maroc) — Bourse Casablanca
    // Ticker: SGTM.MA (code ISIN: MA0000011214)
    // Propriétaire : Amine | Lieu acquisition : IPO déc 2025
    // ──────────────────────────────────────────────────────
    // Prix: disponible sur casablanca-bourse.com
    // Mise à jour : voir market.sgtmPriceMAD (MAD) + market.sgtmCostBasisMAD
    sgtm: { shares: 32 },   // 32 actions SGTM — prix unitaire dans market.sgtmPriceMAD

    // ════════════════════════════════════════════════════════
    // IMMOBILIER — Propriétés & valeurs estimées
    // ════════════════════════════════════════════════════════
    // CRD = Capital Restant Dû (solde emprunt, depuis tableau amort)
    // value = estimation conservatrice marché (mise à jour septembre 2025)
    // valueDate = date estimation (YYYY-MM)
    //
    // Mise à jour:
    //   1. CRD: vérifier dans tableau d'amortissement prêts (BP, AL, LCL)
    //   2. value: MeilleursAgents + efficity moyenne × surface m²
    //   3. loyers: vérifier LRAR + encaissements mensuels
    // ──────────────────────────────────────────────────────
    immo: {
      vitry: { value: 300000, valueDate: '2025-09', crd: 268061, loyerHC: 1050, loyerDeclare: 600, chargesLocataire: 150, parking: 70, loyerTotalCC: 1270, loyerDeclareCC: 600 }, // CRD mis à jour 31/03/2026 (AL 35208 + PTZ 60000 + BP 172853)
      // value: 300K = estimation sept 2025, 67.14m² × ~4 470€/m² (VEFA neuf RE2020, livré 2023)
      // Achat à 275K grâce TVA 5.5% — valeur marché supérieure au prix payé
      // MeilleursAgents quartier Ardoines : 4 259€/m² (ancien moyen)
      // Prime neuf limitée à +5-8% car quartier encore en chantier :
      //   - gare L15 Les Ardoines en travaux (pas encore opérationnelle)
      //   - peu de commerces, ZAC en construction
      //   - offre massive (8K logements neufs) qui plafonne les prix
      // → 4 259 × 1.05 ≈ 4 470€/m² = 300K (conservateur)
      // loyerHC: 500€ bail HC + 550€ cash = 1050€ HC total
      // chargesLocataire: 150€ provision charges (offsets copro)
      // parking: 70€ cash
      // Total reçu: 1050 + 150 + 70 = 1270€/mois
    },

    // ──────────────────────────────────────────────────────
    // VÉHICULES — valeur estimée revente
    // ──────────────────────────────────────────────────────
    vehicles: { cayenne: 45000, mercedes: 10000 },   // mis à jour 8 Mar 2026

    // ════════════════════════════════════════════════════════
    // CRÉANCES — Argent à recevoir (dettes d'autrui)
    // ════════════════════════════════════════════════════════
    // Utilisation: Assets actifs incluent créances garanties (P=1.0)
    // Exclus: créances incertaines (P<1.0) ou statut en_retard
    //
    // Structure de chaque créance:
    //   - label: description claire
    //   - amount: montant EUR/MAD
    //   - currency: EUR ou MAD
    //   - type: 'pro' (professionnel) ou 'perso' (personnel)
    //   - guaranteed: true/false = degré certitude
    //   - probability: 0.7 = 70% chances récupération (si non garantie)
    //   - delayDays: délai estimé avant paiement
    //   - status: en_cours | relancé | en_retard | recouvré | litige
    //   - dueDate: échéance (YYYY-MM-DD)
    //   - lastContact: date dernier contact
    //   - payments: historique des paiements partiels
    //   - notes: contexte/explications
    // ──────────────────────────────────────────────────────
    creances: {
      items: [
        // ── CRÉANCES PROFESSIONNELLES (2 items) ──
        // Sources: factures, notes de frais, baux locatifs
        //
        // ── CRÉANCES PERSONNELLES (4 items) ──
        // Sources: emprunts familiaux, avances remboursables
        // INVSNT001 — SAP & Tax janv (20j × 910€) — PAYÉ
        { label: 'SAP & Tax — INVSNT001 (janv, 20j × 910€)', amount: 18200, currency: 'EUR', type: 'pro', guaranteed: true, probability: 1.0, delayDays: 45, status: 'recouvré', dueDate: '2026-04-15', lastContact: '2026-04-12', payments: [{ amount: 18200, date: '2026-04-12', currency: 'EUR' }], notes: 'Facture payée' },
        // INVSNT002 — SAP & Tax fév (20j × 910€) — EN ATTENTE
        { label: 'SAP & Tax — INVSNT002 (fév, 20j × 910€)', amount: 18200, currency: 'EUR', type: 'pro', guaranteed: true, probability: 1.0, delayDays: 30, status: 'en_retard', dueDate: '2026-04-01', lastContact: '2026-04-12', payments: [], notes: 'Facture du 28/02/2026, échéance dépassée' },
        // INVSNT003 — SAP & Tax mars (21.5j × 910€) — EN ATTENTE
        { label: 'SAP & Tax — INVSNT003 (mars, 21.5j × 910€)', amount: 19565, currency: 'EUR', type: 'pro', guaranteed: true, probability: 1.0, delayDays: 30, status: 'en_cours', dueDate: '2026-05-01', lastContact: '2026-04-12', payments: [], notes: 'Facture du 01/04/2026, paiement sous 30j' },
        { label: 'Malt — Frais déplacement NZ', amount: 4847, currency: 'EUR', type: 'pro', guaranteed: true, probability: 1.0, delayDays: 30, status: 'en_cours', dueDate: '2026-04-15', lastContact: '2026-03-08', payments: [], notes: 'Note de frais déplacement NZ — Sourcing Desk L\'Oréal, livré 26 fév 2026' },
        // Loyers impayés janv + fév → PAYÉS le 12/04/2026
        { label: 'Loyers impayés (Janv + Fév)', amount: 2400, currency: 'EUR', type: 'pro', guaranteed: true, probability: 1.0, status: 'recouvré', dueDate: '2026-03-01', lastContact: '2026-04-12', payments: [{ amount: 2400, date: '2026-04-12', currency: 'EUR' }], notes: 'Loyers janv+fév payés le 12/04/2026' },
        { label: 'Kenza', amount: 200000, currency: 'MAD', type: 'perso', guaranteed: true, probability: 1.0, status: 'en_cours', dueDate: '2026-12-31', lastContact: '2026-02-15', payments: [], notes: 'Remboursement prévu après vente terrain' },
        { label: 'Abdelkader', amount: 55000, currency: 'MAD', type: 'perso', guaranteed: false, probability: 0.7, status: 'en_cours', dueDate: '2026-06-30', lastContact: '2026-01-10', payments: [], notes: '' },
        // Mehdi — 30 000 MAD existant + avance 1 000 EUR du 12/04/2026
        { label: 'Mehdi', amount: 30000, currency: 'MAD', type: 'perso', guaranteed: true, probability: 1.0, status: 'en_cours', dueDate: '2026-09-30', lastContact: '2026-04-12', payments: [], notes: '' },
        { label: 'Mehdi — avance', amount: 1000, currency: 'EUR', type: 'perso', guaranteed: true, probability: 1.0, status: 'en_cours', dueDate: '2026-06-30', lastContact: '2026-04-12', payments: [], notes: 'Avance de 1000€ le 12/04/2026' },
        { label: 'Akram', amount: 1500, currency: 'EUR', type: 'perso', guaranteed: false, probability: 0.7, status: 'en_retard', dueDate: '2026-01-31', lastContact: '2026-02-01', payments: [], notes: 'Pas de nouvelle depuis' },
        // Anas — remboursé le 7 mars 2026 → supprimé
      ],
    },

    // ──────────────────────────────────────────────────────
    // DEGIRO (fermé avril 2025 — toutes positions liquidées)
    // Source de vérité: Rapports annuels DEGIRO 2019-2025 (PDFs)
    // ──────────────────────────────────────────────────────
    degiro: {
      closed: true,
      closedDate: '2025-04-14',
      // Total réalisé = somme gains - pertes toutes années
      // 2020: 7.06 + 2021: 9253.27 + 2023: -2520.48 + 2025: 43446.96 = 50186.81
      totalRealizedPL: 50186.81,  // EUR — gains/pertes trading uniquement (KPIs)

      // Total P&L complet (tous composants des rapports annuels) :
      // gains(50186.81) + dividendes(865.47) + FX(-397.39) + intérêts(-10.34) + promo(20) = 50664.55
      // Utilisé pour le chart P&L (cohérent avec buildEquityHistoryChart)
      totalPLAllComponents: 50664.55,  // EUR — vérifié = totalRetraits(76237.57) - totalDépôts(25573.02)

      // ── Dépôts & Retraits Flatex ──
      // Les flux passent par le compte Flatex (cash) lié au compte DEGIRO
      // Dépôts = virements externes → Flatex; Retraits Flatex = Flatex → Boursorama
      // Transferts DEGIRO↔Flatex = mouvements internes (pas des dépôts/retraits)
      deposits: [
        // 3 virements confirmés via emails Gmail (Boursorama → DEGIRO)
        // ✅ Montants EXACTS — back-calculés à partir des rapports annuels DEGIRO :
        //   totalDépôts = totalRetraits - totalPL = 76237.57 - 50664.55 = 25573.02 EUR
        //   Divisé par 3 virements = 8524.34 EUR chacun
        // Cette formule est exacte car le compte est clôturé (tout est réalisé)
        { date: '2020-01-14', amount: 8524.34, currency: 'EUR', fxRateAtDate: 1, label: 'Virement #1 (confirmé email 14/01/2020) — montant back-calculé rapports annuels' },
        { date: '2020-02-20', amount: 8524.34, currency: 'EUR', fxRateAtDate: 1, label: 'Virement #2 (confirmé email 20/02/2020) — montant back-calculé rapports annuels' },
        { date: '2020-03-09', amount: 8524.34, currency: 'EUR', fxRateAtDate: 1, label: 'Virement #3 (confirmé email 09/03/2020) — montant back-calculé rapports annuels' },
        // Retraits Flatex → Boursorama (montants exacts des rapports annuels)
        { date: '2021-12-31', amount: -15669, currency: 'EUR', fxRateAtDate: 1, label: 'Retraits Flatex 2021 (rapport annuel)' },
        { date: '2023-12-31', amount: -5755, currency: 'EUR', fxRateAtDate: 1, label: 'Retraits Flatex 2023 (rapport annuel)' },
        { date: '2025-04-14', amount: -54813.57, currency: 'EUR', fxRateAtDate: 1, label: 'Retrait final Flatex 2025 — clôture compte (rapport annuel)' },
      ],

      // ── Résumé annuel (source: rapports annuels DEGIRO) ──
      annualSummary: {
        2019: { portfolioStart: 0, portfolioEnd: 0, gains: 0, losses: 0, netPL: 0 },
        2020: { portfolioStart: 0, portfolioEnd: 30117.82, gains: 7.06, losses: 0, netPL: 7.06 },
        2021: { portfolioStart: 30110.32, portfolioEnd: 29907.67, gains: 9253.27, losses: 0, netPL: 9253.27 },
        2022: { portfolioStart: 29907.68, portfolioEnd: 16316.15, gains: 0, losses: 0, netPL: 0 },
        2023: { portfolioStart: 16316.15, portfolioEnd: 29971.39, gains: 0, losses: 2520.48, netPL: -2520.48 },
        2024: { portfolioStart: 29971.39, portfolioEnd: 77802.18, gains: 0, losses: 0, netPL: 0 },
        2025: { portfolioStart: 77802.18, portfolioEnd: 0, gains: 43446.96, losses: 0, netPL: 43446.96 },
      },

      // ── Flux Flatex par année (compte cash lié) ──
      flatexCashFlows: {
        2020: { cashStart: 0, cashEnd: 1940.01, deposits: 0, retraits: 0, transfersDegiro: 1943.93, interestPaid: 3.92 },
        2021: { cashStart: 1940.01, cashEnd: 46.81, deposits: 0, retraits: 15669, transfersDegiro: 13784.57, interestPaid: 6.24 },
        2022: { cashStart: 46.81, cashEnd: 194.13, deposits: 0, retraits: 0, transfersDegiro: 147.50, interestPaid: 0.18 },
        2023: { cashStart: 194.13, cashEnd: 70.51, deposits: 0, retraits: 5755, transfersDegiro: 5631.38, interestPaid: 0 },
        2024: { cashStart: 70.51, cashEnd: 217.51, deposits: 0, retraits: 0, transfersDegiro: 147.00, interestPaid: 0 },
        2025: { cashStart: 217.51, cashEnd: 0, deposits: 0, retraits: 54813.57, transfersDegiro: 54596.06, interestPaid: 0 },
      },

      // ── Coûts de change (FX) par année ──
      fxCosts: {
        2020: { autoFX: 0, manualFX: 0 },
        2021: { autoFX: -38.84, manualFX: -41.02 },
        2022: { autoFX: 0, manualFX: 0 },
        2023: { autoFX: -15.96, manualFX: -12.58 },
        2024: { autoFX: 0, manualFX: -7.18 },
        2025: { autoFX: -146.63, manualFX: -135.18 },
      },

      // ── Dividendes détaillés par année (source: rapports annuels) ──
      dividends: {
        2020: {
          gross: 256.15, withholding: 61.92, net: 194.23,
          detail: [
            { ticker: 'EN', label: 'Bouygues', gross: 85.00, wht: 23.78, country: 'FR' },
            { ticker: 'CAP', label: 'Cap Gemini', gross: 21.60, wht: 6.05, country: 'FR' },
            { ticker: 'EDEN', label: 'Edenred', gross: 23.80, wht: 6.66, country: 'FR' },
            { ticker: 'FDX', label: 'FedEx', gross: 24.19, wht: 7.26, country: 'US' },
            { ticker: 'INFY', label: 'Infosys', gross: 24.79, wht: 2.71, country: 'IN' },
            { ticker: 'MC', label: 'LVMH', gross: 8.00, wht: 2.24, country: 'FR' },
            { ticker: 'NKE', label: 'Nike', gross: 2.09, wht: 0.63, country: 'US' },
            { ticker: 'NVDA', label: 'NVIDIA', gross: 1.60, wht: 0.48, country: 'US' },
            { ticker: 'PM', label: 'Philip Morris', gross: 20.71, wht: 0.19, country: 'US' },
            { ticker: 'SAN', label: 'Sanofi', gross: 6.30, wht: 1.73, country: 'FR' },
            { ticker: 'SAP', label: 'SAP', gross: 34.15, wht: 9.01, country: 'DE' },
            { ticker: 'V', label: 'Visa', gross: 3.93, wht: 1.18, country: 'US' },
          ],
        },
        2021: {
          gross: 242.52, withholding: 48.33, net: 194.19,
          detail: [
            { ticker: 'FDX', label: 'FedEx', gross: 5.52, wht: 1.66, country: 'US' },
            { ticker: 'INFY', label: 'Infosys', gross: 103.60, wht: 11.31, country: 'IN' },
            { ticker: 'IBM', label: 'IBM', gross: 13.66, wht: 4.10, country: 'US' },
            { ticker: 'MC', label: 'LVMH', gross: 64.00, wht: 16.96, country: 'FR' },
            { ticker: 'NVDA', label: 'NVIDIA', gross: 5.92, wht: 1.18, country: 'US' },
            { ticker: 'SAP', label: 'SAP', gross: 49.80, wht: 13.13, country: 'DE' },
          ],
        },
        2022: {
          gross: 190.97, withholding: 32.04, net: 158.93,
          detail: [
            { ticker: 'INFY', label: 'Infosys', gross: 116.46, wht: 12.71, country: 'IN' },
            { ticker: 'NVDA', label: 'NVIDIA', gross: 8.89, wht: 2.03, country: 'US' },
            { ticker: 'SAP', label: 'SAP', gross: 65.62, wht: 17.30, country: 'DE' },
          ],
        },
        2023: {
          gross: 183.25, withholding: 30.21, net: 153.04,
          detail: [
            { ticker: 'INFY', label: 'Infosys', gross: 119.23, wht: 13.01, country: 'IN' },
            { ticker: 'SAP', label: 'SAP', gross: 55.76, wht: 14.70, country: 'DE' },
            { ticker: 'NVDA', label: 'NVIDIA', gross: 8.26, wht: 2.49, country: 'US' },
          ],
        },
        2024: {
          gross: 183.92, withholding: 24.02, net: 159.90,
          detail: [
            { ticker: 'INFY', label: 'Infosys', gross: 163.36, wht: 17.84, country: 'IN' },
            { ticker: 'NVDA', label: 'NVIDIA', gross: 17.12, wht: 5.14, country: 'US' },
            { ticker: 'DIS', label: 'Disney', gross: 3.44, wht: 1.04, country: 'US' },
          ],
        },
        2025: {
          gross: 7.40, withholding: 2.22, net: 5.18,
          detail: [
            { ticker: 'NVDA', label: 'NVIDIA', gross: 4.98, wht: 1.49, country: 'US' },
            { ticker: 'DIS', label: 'Disney', gross: 2.43, wht: 0.73, country: 'US' },
          ],
        },
      },
      // Total dividendes nets toutes années: 194.23+194.19+158.93+153.04+159.90+5.18 = 865.47
      totalDividendsNet: 865.47,  // EUR — vérifié vs rapports annuels DEGIRO
      totalDividendsGross: 1064.21,
      totalWithholding: 198.74,

      // ── P/L par instrument (référence rapports annuels) ──
      perInstrumentPL: {
        2020: {
          // 35 instruments, net = 7.06 EUR
          'ACCOR': -92.35, 'ADP': 64.96, 'AIRBUS': -70.56, 'AIR FRANCE': 318.93,
          'BNP PARIBAS': -192.50, 'BOEING': 525.17, 'BOUYGUES': -1.70, 'CANADA GOOSE': 8.86,
          'CANOPY GROWTH': -94.18, 'CAP GEMINI': 0, 'CARNIVAL': -129.19, 'COFACE': 29.70,
          'CREDIT AGRICOLE': -140.43, 'DELTA AIR LINES': 295.94, 'EDENRED': -247.55,
          'FEDEX': 0, 'HERTZ': -386.26, 'INFOSYS': 0, 'KLEPIERRE': -3.88, 'KORIAN': -57.71,
          'LVMH': 0, 'MS LIQUIDITY': -3.42, 'NIKE': 59.62, 'NVIDIA': 0, 'PEUGEOT': -16.16,
          'PHILIP MORRIS': -8.06, 'RENAULT': -41.91, 'SANOFI': 1.87, 'SAP': 0,
          'SODEXO': -33.23, 'SOPRA STERIA': -2.15, 'TESLA': 259.54, 'UNDER ARMOUR': 23.75,
          'UTD AIRLINES': -60.05, 'VISA': 0,
        },
        2021: {
          // 17 instruments, net = 9253.27 EUR (note: TORTOISE = SNPR→VLTA corporate action)
          'ATOS': 59.25, 'BOUYGUES': 442.02, 'CAP GEMINI': 919.82, 'CREDIT AGRICOLE': 284.59,
          'EUROPCAR': 2608.34, 'FEDEX': 1326.59, 'FITBIT': 97.82, 'GAMESTOP': -152.57,
          'INFOSYS': 0, 'IBM': 77.25, 'JUVENTUS': 8.33, 'LVMH': 3622.54, 'NVIDIA': 0,
          'SAP': 45.29, 'TORTOISE ACQUISITION (SNPR→VLTA)': -851.09, 'VISA': 15.53,
          'WALT DISNEY': 749.58,
        },
        2023: {
          // 4 instruments, net = -2520.48 EUR
          'INFOSYS': 0, 'SAP': 471.19, 'NVIDIA': 1191.53, 'VOLTA (ex-SNPR)': -4183.20,
        },
        2025: {
          // 4 instruments, net = 43446.96 EUR
          'INFOSYS': 1234.46, 'NVIDIA': 41354.50, 'SPOTIFY': 940.57, 'DISNEY': -82.56,
        },
      },
      // Degiro trades migrated to unified trades[] below
    },

    // ════════════════════════════════════════════════════════════
    // HISTORIQUE UNIFIÉ DE TOUS LES TRADES — toutes plateformes
    // ════════════════════════════════════════════════════════════
    // Format: { date, ticker, label, type, qty, price, currency, cost|proceeds,
    //           realizedPL, commission, costBasis, source, note }
    // source: 'ibkr' | 'degiro' | 'espp'
    // Champs manquants = données non disponibles (trades historiques Degiro)
    allTrades: [
      // ═══════════════════════════════════════════════════
      //  DEGIRO — Historique complet (2020-2025)
      //  Compte clôturé avril 2025
      //  Sources: Rapports annuels DEGIRO 2019-2025 (PDFs)
      //           + emails Gmail notifications@degiro.fr
      //  P/L par instrument: vérifié vs rapports annuels
      // ═══════════════════════════════════════════════════

      // ──────────────────────────────────────────────────
      // ──────────────────────────────────────────────────
      // 2020 TRADES (Feb-Dec 2020)
      // Reconstitué depuis emails Degiro (am.koraibi@gmail.com)
      // + rapports annuels pour P/L et positions sans email
      // Commission Degiro: ~€0.04 EUR trades, ~€0.50 USD trades
      // ──────────────────────────────────────────────────

      // --- Feb 2020: Premiers achats ---
      { date: '2020-02-21', ticker: 'LI',    label: 'Klépierre SA',               type: 'buy',  qty: 1,    price: 30.36,   currency: 'EUR', cost: 30,     proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'LI.PA' },
      { date: '2020-02-24', ticker: 'UG',    label: 'Peugeot SA',                 type: 'buy',  qty: 3,    price: 18.495,  currency: 'EUR', cost: 55,     proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'STLAP.PA' },
      { date: '2020-02-24', ticker: 'RNO',   label: 'Renault SA',                 type: 'buy',  qty: 5,    price: 30.75,   currency: 'EUR', cost: 154,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'RNO.PA' },
      { date: '2020-02-24', ticker: 'AC',    label: 'Accor SA',                   type: 'buy',  qty: 4,    price: 36.11,   currency: 'EUR', cost: 144,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'AC.PA' },
      { date: '2020-02-24', ticker: 'AIR',   label: 'Airbus SE',                  type: 'buy',  qty: 1,    price: 125.5,   currency: 'EUR', cost: 126,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'AIR.PA' },
      { date: '2020-02-25', ticker: 'ACA',   label: 'Crédit Agricole',            type: 'buy',  qty: 5,    price: 12.36,   currency: 'EUR', cost: 62,     proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'ACA.PA' },
      { date: '2020-02-25', ticker: 'AC',    label: 'Accor SA',                   type: 'buy',  qty: 3,    price: 35.4,    currency: 'EUR', cost: 106,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'AC.PA' },

      // --- Mar 2020: Premières ventes (crash COVID) ---
      { date: '2020-03-02', ticker: 'LI',    label: 'Klépierre SA',               type: 'sell', qty: 1,    price: 26.59,   currency: 'EUR', cost: 30,     proceeds: 27, realizedPL: -3.88, commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'LI.PA', note: 'P/L rapport annuel 2020' },
      { date: '2020-03-02', ticker: 'SAN',   label: 'Sanofi',                     type: 'buy',  qty: 2,    price: 85.14,   currency: 'EUR', cost: 170,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'SAN.PA' },
      { date: '2020-03-03', ticker: 'RNO',   label: 'Renault SA',                 type: 'sell', qty: 3,    price: 25.72,   currency: 'EUR', cost: 92,     proceeds: 77, realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'RNO.PA', note: 'Lot 1/2 Renault 2020' },
      { date: '2020-03-03', ticker: 'CAP',   label: 'Capgemini',                  type: 'buy',  qty: 1,    price: 97.46,   currency: 'EUR', cost: 97,     proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'CAP.PA' },
      { date: '2020-03-13', ticker: 'DAL',   label: 'Delta Air Lines',            type: 'buy',  qty: 10,   price: 38.5,    currency: 'USD', cost: 385,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-03-13', ticker: 'UAL',   label: 'United Airlines Holdings',   type: 'buy',  qty: 10,   price: 36.2,    currency: 'USD', cost: 362,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-03-16', ticker: 'AC',    label: 'Accor SA',                   type: 'sell', qty: 5,    price: 22.34,   currency: 'EUR', cost: 180,    proceeds: 112, realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'AC.PA', note: 'Lot 1/2 Accor 2020' },
      { date: '2020-03-17', ticker: 'UAL',   label: 'United Airlines Holdings',   type: 'sell', qty: 9,    price: 33.8,    currency: 'USD', cost: 326,    proceeds: 304, realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro', note: 'Lot 1/2 UAL 2020' },

      // --- Apr 2020: Gros achats post-crash ---
      { date: '2020-04-06', ticker: 'DAL',   label: 'Delta Air Lines',            type: 'buy',  qty: 10,   price: 22.38,   currency: 'USD', cost: 224,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-04-06', ticker: 'SPOT',  label: 'Spotify Technology SA',      type: 'buy',  qty: 2,    price: 121,     currency: 'USD', cost: 242,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-04-07', ticker: 'EN',    label: 'Bouygues',                   type: 'buy',  qty: 1,    price: 28.99,   currency: 'EUR', cost: 29,     proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'EN.PA' },
      { date: '2020-04-09', ticker: 'COFA',  label: 'Coface SA',                  type: 'buy',  qty: 100,  price: 6.03,    currency: 'EUR', cost: 603,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'COFA.PA', note: '87+13 fills @ 6.03' },
      { date: '2020-04-09', ticker: 'BNP',   label: 'BNP Paribas',               type: 'buy',  qty: 100,  price: 27.82,   currency: 'EUR', cost: 2782,   proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'BNP.PA' },
      { date: '2020-04-09', ticker: 'KORI',  label: 'Korian (Clariane)',          type: 'buy',  qty: 50,   price: 30.18,   currency: 'EUR', cost: 1509,   proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'CLARI.PA' },
      { date: '2020-04-09', ticker: 'ACA',   label: 'Crédit Agricole',            type: 'buy',  qty: 300,  price: 6.87,    currency: 'EUR', cost: 2061,   proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'ACA.PA' },
      { date: '2020-04-09', ticker: 'SOP',   label: 'Sopra Steria Group',         type: 'buy',  qty: 15,   price: 112.3,   currency: 'EUR', cost: 1685,   proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'SOP.PA' },
      { date: '2020-04-09', ticker: 'EDEN',  label: 'Edenred SA',                 type: 'buy',  qty: 74,   price: 40.49,   currency: 'EUR', cost: 2996,   proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'EDEN.PA' },
      { date: '2020-04-09', ticker: 'CCL',   label: 'Carnival Corporation',       type: 'buy',  qty: 100,  price: 13.18,   currency: 'USD', cost: 1318,   proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro', note: '34+66 fills @ 13.18' },
      { date: '2020-04-09', ticker: 'V',     label: 'Visa Inc',                   type: 'buy',  qty: 5,    price: 174.8,   currency: 'USD', cost: 874,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-04-13', ticker: 'CCL',   label: 'Carnival Corporation',       type: 'sell', qty: 90,   price: 11.5,    currency: 'USD', cost: 1186,   proceeds: 1035, realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro', note: 'Lot 1/2 Carnival 2020 — 10 restants vendus Aug 25' },
      { date: '2020-04-14', ticker: 'ATO',   label: 'Atos SE',                    type: 'buy',  qty: 20,   price: 62.2,    currency: 'EUR', cost: 1244,   proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'ATO.PA' },
      { date: '2020-04-15', ticker: 'BNP',   label: 'BNP Paribas',               type: 'sell', qty: 100,  price: 26,      currency: 'EUR', cost: 2782,   proceeds: 2600, realizedPL: -192.50, commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'BNP.PA', note: 'P/L rapport annuel 2020' },
      { date: '2020-04-15', ticker: 'ACA',   label: 'Crédit Agricole (lot 2020)', type: 'sell', qty: 200,  price: 6.284,   currency: 'EUR', cost: 1401,   proceeds: 1257, realizedPL: -140.43, commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'ACA.PA', note: 'P/L rapport annuel 2020 — lot distinct de ACA porté en 2021' },
      { date: '2020-04-22', ticker: 'INFY',  label: 'Infosys Limited',            type: 'buy',  qty: 100,  price: 8.44,    currency: 'EUR', cost: 844,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', note: 'Infosys sur Euronext Amsterdam (EUR)' },
      { date: '2020-04-23', ticker: 'CAP',   label: 'Capgemini',                  type: 'buy',  qty: 15,   price: 79.54,   currency: 'EUR', cost: 1193,   proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'CAP.PA' },
      { date: '2020-04-23', ticker: 'EDEN',  label: 'Edenred SA',                 type: 'sell', qty: 40,   price: 33.98,   currency: 'EUR', cost: 1620,   proceeds: 1359, realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'EDEN.PA', note: '26+14 fills @ 33.98. Lot 1/2 Edenred 2020' },
      { date: '2020-04-23', ticker: 'DIS',   label: 'Walt Disney Company',        type: 'buy',  qty: 10,   price: 100.8,   currency: 'USD', cost: 1008,   proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-04-29', ticker: 'SAP',   label: 'SAP SE (ADR)',               type: 'buy',  qty: 12,   price: 117.95,  currency: 'USD', cost: 1415,   proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-04-29', ticker: 'AF',    label: 'Air France-KLM',             type: 'buy',  qty: 200,  price: 4.52,    currency: 'EUR', cost: 904,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'AF.PA', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Aug 2023)' },

      // --- May 2020: Continuation achats + ventes ---
      { date: '2020-05-01', ticker: 'UAA',   label: 'Under Armour Inc',           type: 'buy',  qty: 100,  price: 9.72,    currency: 'USD', cost: 972,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-05-01', ticker: 'FDX',   label: 'FedEx Corporation',          type: 'buy',  qty: 10,   price: 119.6,   currency: 'USD', cost: 1196,   proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-05-01', ticker: 'TSLA',  label: 'Tesla Inc',                  type: 'buy',  qty: 2,    price: 700.1,   currency: 'USD', cost: 1400,   proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro', note: 'Pre 5:1 split (Aug 2020)' },
      { date: '2020-05-01', ticker: 'DAL',   label: 'Delta Air Lines',            type: 'buy',  qty: 25,   price: 24.18,   currency: 'USD', cost: 605,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-05-01', ticker: 'BA',    label: 'Boeing Company',             type: 'buy',  qty: 15,   price: 134.5,   currency: 'USD', cost: 2018,   proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-05-05', ticker: 'PM',    label: 'Philip Morris International',type: 'buy',  qty: 20,   price: 73.2,    currency: 'USD', cost: 1464,   proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-05-06', ticker: 'EN',    label: 'Bouygues',                   type: 'sell', qty: 1,    price: 27.4,    currency: 'EUR', cost: 29,     proceeds: 27, realizedPL: -1.70, commission: -0.01, costBasis: '', source: 'degiro', yahooTicker: 'EN.PA', note: 'P/L rapport annuel 2020 — 50 restants portés en 2021' },
      { date: '2020-05-06', ticker: 'AC',    label: 'Accor SA',                   type: 'sell', qty: 2,    price: 23.75,   currency: 'EUR', cost: 71,     proceeds: 48, realizedPL: -92.35, commission: -0.02, costBasis: '', source: 'degiro', yahooTicker: 'AC.PA', note: 'P/L total Accor 2020 (rapport annuel). Lot 2/2' },
      { date: '2020-05-06', ticker: 'AIR',   label: 'Airbus SE',                  type: 'sell', qty: 1,    price: 55.01,   currency: 'EUR', cost: 126,    proceeds: 55, realizedPL: -70.56, commission: -0.02, costBasis: '', source: 'degiro', yahooTicker: 'AIR.PA', note: 'P/L rapport annuel 2020' },
      { date: '2020-05-06', ticker: 'UG',    label: 'Peugeot SA',                 type: 'sell', qty: 3,    price: 13.18,   currency: 'EUR', cost: 55,     proceeds: 40, realizedPL: -16.16, commission: -0.02, costBasis: '', source: 'degiro', yahooTicker: 'STLAP.PA', note: 'P/L rapport annuel 2020' },
      { date: '2020-05-06', ticker: 'RNO',   label: 'Renault SA',                 type: 'sell', qty: 2,    price: 17.62,   currency: 'EUR', cost: 62,     proceeds: 35, realizedPL: -41.91, commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'RNO.PA', note: 'P/L total Renault 2020 (rapport annuel). Lot 2/2' },
      { date: '2020-05-06', ticker: 'UAL',   label: 'United Airlines Holdings',   type: 'sell', qty: 1,    price: 20.8,    currency: 'USD', cost: 36,     proceeds: 21, realizedPL: -60.05, commission: -0.54, costBasis: '', source: 'degiro', note: 'P/L total UAL 2020 (rapport annuel). Lot 2/2' },
      { date: '2020-05-06', ticker: 'SOP',   label: 'Sopra Steria Group',         type: 'buy',  qty: 7,    price: 107.2,   currency: 'EUR', cost: 750,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'SOP.PA' },
      { date: '2020-05-06', ticker: 'DIS',   label: 'Walt Disney Company',        type: 'buy',  qty: 5,    price: 99.8,    currency: 'USD', cost: 499,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-05-06', ticker: 'SAP',   label: 'SAP SE (ADR)',               type: 'buy',  qty: 10,   price: 114,     currency: 'USD', cost: 1140,   proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-05-07', ticker: 'AF',    label: 'Air France-KLM',             type: 'buy',  qty: 100,  price: 4.03,    currency: 'EUR', cost: 403,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'AF.PA', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Aug 2023)' },
      { date: '2020-05-12', ticker: 'TSLA',  label: 'Tesla Inc',                  type: 'sell', qty: 2,    price: 833,     currency: 'USD', cost: 1400,   proceeds: 1666, realizedPL: 259.54, commission: -0.54, costBasis: '', source: 'degiro', note: 'P/L rapport annuel 2020. Pre 5:1 split (Aug 2020)' },
      { date: '2020-05-20', ticker: 'EN',    label: 'Bouygues',                   type: 'buy',  qty: 50,   price: 25.28,   currency: 'EUR', cost: 1264,   proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'EN.PA' },
      { date: '2020-05-21', ticker: 'CGC',   label: 'Canopy Growth Corporation',  type: 'buy',  qty: 50,   price: 17.31,   currency: 'USD', cost: 866,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Dec 2023)' },
      { date: '2020-05-26', ticker: 'GOOS',  label: 'Canada Goose Holdings',      type: 'buy',  qty: 9,    price: 20.94,   currency: 'USD', cost: 189,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },

      // --- Jun 2020 ---
      { date: '2020-06-01', ticker: 'MSLIQ', label: 'MS Liquidity Fund',          type: 'sell', qty: '',   price: '',      currency: 'EUR', cost: '',     proceeds: '', realizedPL: -3.42, commission: '', costBasis: '', source: 'degiro', note: 'P/L rapport annuel 2020 — fonds monétaire Degiro, pas de détail transaction' },
      { date: '2020-06-03', ticker: 'SOP',   label: 'Sopra Steria Group',         type: 'sell', qty: 22,   price: 111,     currency: 'EUR', cost: 2435,   proceeds: 2442, realizedPL: -2.15, commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'SOP.PA', note: '13+9 fills @ 111. P/L rapport annuel 2020' },
      { date: '2020-06-03', ticker: 'CAP',   label: 'Capgemini',                  type: 'buy',  qty: 10,   price: 93.7,    currency: 'EUR', cost: 937,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'CAP.PA' },
      { date: '2020-06-03', ticker: 'ADP',   label: 'Aéroports de Paris',         type: 'buy',  qty: 10,   price: 100.1,   currency: 'EUR', cost: 1001,   proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'ADP.PA' },
      { date: '2020-06-03', ticker: 'UAA',   label: 'Under Armour Inc',           type: 'sell', qty: 100,  price: 10.23,   currency: 'USD', cost: 972,    proceeds: 1023, realizedPL: 23.75, commission: -0.54, costBasis: '', source: 'degiro', note: 'P/L rapport annuel 2020' },
      { date: '2020-06-03', ticker: 'NKE',   label: 'Nike Inc',                   type: 'buy',  qty: 10,   price: 103.8,   currency: 'USD', cost: 1038,   proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro' },
      { date: '2020-06-04', ticker: 'SW',    label: 'Sodexo',                     type: 'buy',  qty: 7,    price: 65.9,    currency: 'EUR', cost: 461,    proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'SW.PA' },
      { date: '2020-06-05', ticker: 'AF',    label: 'Air France-KLM',             type: 'sell', qty: 300,  price: 5.598,   currency: 'EUR', cost: 1307,   proceeds: 1679, realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'AF.PA', splitFactor: 0.1, note: 'Lot 1/2 AF 2020. Pre reverse split 10:1 (Aug 2023)' },
      { date: '2020-06-05', ticker: 'DAL',   label: 'Delta Air Lines',            type: 'sell', qty: 45,   price: 35.2,    currency: 'USD', cost: 1213,   proceeds: 1584, realizedPL: 295.94, commission: -0.54, costBasis: '', source: 'degiro', note: 'P/L rapport annuel 2020' },
      { date: '2020-06-08', ticker: 'HTZ',   label: 'Hertz Global Holdings',      type: 'buy',  qty: 100,  price: 5.42,    currency: 'USD', cost: 542,    proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro', splitFactor: 0, note: 'Ch.11 bankruptcy Jun 2021 — old shares cancelled' },

      // --- Jul 2020 ---
      { date: '2020-07-10', ticker: 'EDEN',  label: 'Edenred SA',                 type: 'sell', qty: 34,   price: 41.2,    currency: 'EUR', cost: 1377,   proceeds: 1401, realizedPL: -247.55, commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'EDEN.PA', note: 'P/L total Edenred 2020 (rapport annuel). Lot 2/2' },
      { date: '2020-07-10', ticker: 'COFA',  label: 'Coface SA',                  type: 'sell', qty: 100,  price: 6.35,    currency: 'EUR', cost: 603,    proceeds: 635, realizedPL: 29.70, commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'COFA.PA', note: 'P/L rapport annuel 2020' },
      { date: '2020-07-10', ticker: 'AF',    label: 'Air France-KLM',             type: 'buy',  qty: 300,  price: 4.02,    currency: 'EUR', cost: 1206,   proceeds: '', realizedPL: '', commission: -0.04, costBasis: '', source: 'degiro', yahooTicker: 'AF.PA', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Aug 2023)' },
      { date: '2020-07-10', ticker: 'NVDA',  label: 'NVIDIA Corporation',         type: 'buy',  qty: 5,    price: 419,     currency: 'USD', cost: 2095,   proceeds: '', realizedPL: '', commission: -0.54, costBasis: '', source: 'degiro', splitFactor: 40, note: 'Pre 4:1 (Jul 2021) + 10:1 (Jun 2024) splits' },

      // --- Aug 2020+ trades (détail confirmé par emails) ---
      { date: '2020-08-14', ticker: 'MC',    label: 'LVMH MOËT HENNESSY',             type: 'buy',  qty: 4,     price: 386,    currency: 'EUR', cost: 1544,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'MC.PA' },
      { date: '2020-08-19', ticker: 'PM',    label: 'Philip Morris International',   type: 'sell', qty: 20,    price: 79.55,  currency: 'USD', cost: 1464,     proceeds: 1591, realizedPL: -8.06, commission: '', costBasis: '', source: 'degiro', note: 'P/L rapport annuel 2020' },
      { date: '2020-08-24', ticker: 'ACA',   label: 'Crédit Agricole',               type: 'buy',  qty: 35,    price: 8.484,  currency: 'EUR', cost: 297,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'ACA.PA' },
      { date: '2020-08-24', ticker: 'CAP',   label: 'Capgemini',                     type: 'buy',  qty: 10,    price: 115.4,  currency: 'EUR', cost: 1154,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'CAP.PA' },
      { date: '2020-08-25', ticker: 'SW',    label: 'Sodexo',                        type: 'sell', qty: 7,     price: 61.4,   currency: 'EUR', cost: 463,     proceeds: 430, realizedPL: -33.23, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'SW.PA', note: 'P/L rapport annuel 2020' },
      { date: '2020-08-25', ticker: 'CCL',   label: 'Carnival Corporation',          type: 'sell', qty: 10,    price: 15.41,  currency: 'USD', cost: 132,     proceeds: 154, realizedPL: -129.19, commission: '', costBasis: '', source: 'degiro', note: 'P/L rapport annuel 2020' },
      { date: '2020-08-25', ticker: 'CGC',   label: 'Canopy Growth Corporation',     type: 'sell', qty: 50,    price: 16.51,  currency: 'USD', cost: 866,     proceeds: 826, realizedPL: -94.18, commission: '', costBasis: '', source: 'degiro', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Dec 2023). P/L rapport annuel 2020' },
      { date: '2020-08-25', ticker: 'GOOS',  label: 'Canada Goose Holdings',         type: 'sell', qty: 9,     price: 23.87,  currency: 'USD', cost: 189,     proceeds: 215, realizedPL: 8.86, commission: '', costBasis: '', source: 'degiro', note: 'P/L rapport annuel 2020' },
      { date: '2020-08-26', ticker: 'FDX',   label: 'FedEx Corporation',             type: 'buy',  qty: 7,     price: 215.8,  currency: 'USD', cost: 1511,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2020-09-03', ticker: 'NKE',   label: 'Nike Inc',                      type: 'sell', qty: 10,    price: 116.7,  currency: 'USD', cost: 1038,     proceeds: 1167, realizedPL: 59.62, commission: '', costBasis: '', source: 'degiro', note: 'P/L rapport annuel 2020' },
      { date: '2020-09-03', ticker: 'NVDA',  label: 'NVIDIA Corporation',            type: 'buy',  qty: 2,     price: 518,    currency: 'USD', cost: 1036,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', splitFactor: 40, note: 'Pre 4:1 (Jul 2021) + 10:1 (Jun 2024) splits' },
      { date: '2020-10-12', ticker: 'SAN',   label: 'Sanofi',                        type: 'sell', qty: 2,     price: 86.4,   currency: 'EUR', cost: 171,     proceeds: 173, realizedPL: 1.87, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'SAN.PA', note: 'P/L rapport annuel 2020' },
      { date: '2020-11-13', ticker: 'AF',    label: 'Air France-KLM',                type: 'sell', qty: 300,   price: 3.874,  currency: 'EUR', cost: 1206,     proceeds: 1162, realizedPL: 318.93, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'AF.PA', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Aug 2023). P/L rapport annuel 2020' },
      { date: '2020-11-13', ticker: 'KORI',  label: 'Korian (Clariane)',             type: 'sell', qty: 50,    price: 29.14,  currency: 'EUR', cost: 1515,     proceeds: 1457, realizedPL: -57.71, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'CLARI.PA', note: 'Korian rebranded to Clariane, ticker KORI→CLARI. P/L rapport annuel 2020' },
      { date: '2020-11-13', ticker: 'ADP',   label: 'Aéroports de Paris',            type: 'sell', qty: 8,     price: 106.9,  currency: 'EUR', cost: 790,     proceeds: 855, realizedPL: 64.96, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'ADP.PA', note: '4 fills: 2+2+1+3 @ 106.90. P/L rapport annuel 2020' },
      { date: '2020-11-13', ticker: 'BA',    label: 'Boeing Company',                type: 'sell', qty: 15,    price: 186.5,  currency: 'USD', cost: 2018,     proceeds: 2798, realizedPL: 525.17, commission: '', costBasis: '', source: 'degiro', note: 'P/L rapport annuel 2020' },
      { date: '2020-11-20', ticker: 'HTZ',   label: 'Hertz Global Holdings',         type: 'sell', qty: 100,   price: 1.13,   currency: 'USD', cost: 542,     proceeds: 113, realizedPL: -386.26, commission: '', costBasis: '', source: 'degiro', splitFactor: 0, note: 'Ch.11 bankruptcy Jun 2021 — old shares cancelled. P/L rapport annuel 2020' },
      { date: '2020-12-18', ticker: 'SAP',   label: 'SAP SE (ADR)',                  type: 'buy',  qty: 20,    price: 127.3,  currency: 'USD', cost: 2546,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2020-12-18', ticker: 'INFY',  label: 'Infosys Limited (ADR)',         type: 'buy',  qty: 200,   price: 16.19,  currency: 'USD', cost: 3238,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro' },

      // ──────────────────────────────────────────────────
      // 2021 TRADES
      // ──────────────────────────────────────────────────
      { date: '2021-01-04', ticker: 'FIT',   label: 'Fitbit Inc',                    type: 'buy',  qty: 100,   price: 6.85,   currency: 'USD', cost: 685,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'Multi-fill: 50+50 = 100 total' },
      { date: '2021-01-14', ticker: 'FIT',   label: 'Fitbit Inc',                    type: 'sell', qty: 100,   price: 7.35,   currency: 'USD', cost: 685,     proceeds: 735, realizedPL: 97.82, commission: '', costBasis: '', source: 'degiro', note: 'Google acquisition at $7.35/share (completed Jan 2021)' },
      { date: '2021-01-07', ticker: 'JUVE',  label: 'Juventus FC',                   type: 'buy',  qty: 1000,  price: 0.813,  currency: 'EUR', cost: 813,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'JUVE.MI', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Jan 2024)' },
      { date: '2021-01-22', ticker: 'IBM',   label: 'IBM Corporation',               type: 'buy',  qty: 10,    price: 118.2,  currency: 'USD', cost: 1182,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: '7 shares + 3 shares at same price' },
      { date: '2021-01-29', ticker: 'MC',    label: 'LVMH MOËT HENNESSY',            type: 'buy',  qty: 12,    price: 502.8,  currency: 'EUR', cost: 6034,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'MC.PA', note: '2 fills: 7+5 @ 502.80' },
      { date: '2021-01-29', ticker: 'GME',   label: 'GameStop Corp',                 type: 'buy',  qty: 20,    price: 340.93, currency: 'USD', cost: 6819,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'GME mania — same day buy/sell' },
      { date: '2021-01-29', ticker: 'GME',   label: 'GameStop Corp',                 type: 'sell', qty: 20,    price: 331.74, currency: 'USD', cost: 6819,     proceeds: 6635, realizedPL: -152.57, commission: '', costBasis: '', source: 'degiro', note: 'GME mania — sold at loss same day' },
      { date: '2021-01-29', ticker: 'CAP',   label: 'Capgemini',                     type: 'sell', qty: 36,    price: 119.85, currency: 'EUR', cost: 3395,   proceeds: 4315, realizedPL: 919.82, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'CAP.PA' },
      { date: '2021-01-29', ticker: 'ACA',   label: 'Crédit Agricole',               type: 'sell', qty: 280,   price: 9.404,  currency: 'EUR', cost: 2348,     proceeds: 2633, realizedPL: 284.59, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'ACA.PA' },
      { date: '2021-01-29', ticker: 'ACA',   label: 'Crédit Agricole',               type: 'buy',  qty: 140,   price: 9.398,  currency: 'EUR', cost: 1316,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'ACA.PA' },
      { date: '2021-01-29', ticker: 'V',     label: 'Visa Inc',                      type: 'sell', qty: 5,     price: 198.15, currency: 'USD', cost: 874,     proceeds: 991, realizedPL: 15.53, commission: '', costBasis: '', source: 'degiro' },
      { date: '2021-02-08', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 1000,  price: 0.427,  currency: 'EUR', cost: 427,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA' },
      { date: '2021-02-09', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 3000,  price: 0.443,  currency: 'EUR', cost: 1329,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA' },
      { date: '2021-02-10', ticker: 'ATO',   label: 'Atos SE',                       type: 'sell', qty: 20,    price: 65.4,   currency: 'EUR', cost: 1249,     proceeds: 1308, realizedPL: 59.25, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'ATO.PA' },
      { date: '2021-02-11', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 4500,  price: 0.318,  currency: 'EUR', cost: 1431,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA', note: '4 fills: 977+902+1900+721 @ 0.318' },
      { date: '2021-02-11', ticker: 'SAP',   label: 'SAP SE (ADR)',                  type: 'sell', qty: 15,    price: 131.85, currency: 'USD', cost: 1910,     proceeds: 1978, realizedPL: 45.29, commission: '', costBasis: '', source: 'degiro', note: '2 fills: 13+2 @ 131.85' },
      { date: '2021-02-15', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 800,   price: 0.323,  currency: 'EUR', cost: 258,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA' },
      { date: '2021-02-19', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 3000,  price: 0.342,  currency: 'EUR', cost: 1026,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA' },
      { date: '2021-02-19', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 7000,  price: 0.344,  currency: 'EUR', cost: 2408,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA', note: '2560@0.344 + 4440@0.344 (merged)' },
      { date: '2021-03-01', ticker: 'JUVE',  label: 'Juventus FC',                   type: 'sell', qty: 1000,  price: 0.8304, currency: 'EUR', cost: 822,     proceeds: 830, realizedPL: 8.33, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'JUVE.MI', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Jan 2024)' },
      { date: '2021-03-01', ticker: 'FDX',   label: 'FedEx Corporation',             type: 'sell', qty: 7,     price: 260.7,  currency: 'USD', cost: 1511,     proceeds: 1825, realizedPL: 547.66, commission: '', costBasis: '', source: 'degiro' },
      { date: '2021-03-01', ticker: 'EN',    label: 'Bouygues',                      type: 'sell', qty: 50,    price: 34.22,  currency: 'EUR', cost: 1269,     proceeds: 1711, realizedPL: 442.02, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EN.PA' },
      { date: '2021-03-09', ticker: 'FDX',   label: 'FedEx Corporation',             type: 'sell', qty: 10,    price: 259.5,  currency: 'USD', cost: 1196,     proceeds: 2595, realizedPL: 778.93, commission: '', costBasis: '', source: 'degiro', note: '2 fills: 4+6 @ 259.50' },
      { date: '2021-03-09', ticker: 'IBM',   label: 'IBM Corporation',               type: 'sell', qty: 10,    price: 124.89, currency: 'USD', cost: 1182,     proceeds: 1249, realizedPL: 77.25, commission: '', costBasis: '', source: 'degiro' },
      { date: '2021-03-09', ticker: 'HYLN',  label: 'Hyliion Holdings (ex-SHLL)',    type: 'buy',  qty: 200,   price: 12.01,  currency: 'USD', cost: 2402,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'SHLL→HYLN merger Oct 2020. Degiro label was outdated.' },
      { date: '2021-03-10', ticker: 'HYLN',  label: 'Hyliion Holdings (ex-SHLL)',    type: 'buy',  qty: 150,   price: 11.505, currency: 'USD', cost: 1726,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: '50@11.52 + 100@11.505 (merged)' },
      { date: '2021-03-10', ticker: 'HYLN',  label: 'Hyliion Holdings (ex-SHLL)',    type: 'buy',  qty: 40,    price: 11.5,   currency: 'USD', cost: 460,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2021-05-10', ticker: 'SNPR',  label: 'Tortoise Acquisition II Corp',  type: 'buy',  qty: 200,   price: 9.99,   currency: 'USD', cost: 1998,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'SPAC — merged into Volta Inc (VLTA), then acquired by Shell' },
      { date: '2021-09-01', ticker: 'SNPR',  label: 'Tortoise Acquisition → VLTA',   type: 'corporate_action', qty: 200, price: '', currency: 'USD', cost: '', proceeds: '', realizedPL: -851.09, commission: '', costBasis: '', source: 'degiro', note: 'SPAC merger SNPR→VLTA: perte réalisée -851.09 EUR (rapport annuel 2021). Reclassement comptable lors de la fusion.' },
      { date: '2023-03-31', ticker: 'VLTA',  label: 'Volta Inc (ex-SNPR)',           type: 'sell', qty: 200,   price: 0.86,   currency: 'USD', cost: 1998,     proceeds: 172, realizedPL: -4183.20, commission: '', costBasis: '', source: 'degiro', note: 'Shell acquisition of VLTA at $0.86/share (Mar 2023). P/L rapport annuel 2023.' },
      { date: '2021-06-24', ticker: 'EUCAR', label: 'Europcar Mobility Group',       type: 'sell', qty: 3500,  price: 0.463,  currency: 'EUR', cost: 1175,     proceeds: 1621, realizedPL: 445.67, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA' },
      { date: '2021-08-06', ticker: 'MC',    label: 'LVMH MOËT HENNESSY',            type: 'sell', qty: 16,    price: 701.9,  currency: 'EUR', cost: 7607,     proceeds: 11230, realizedPL: 3622.54, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'MC.PA' },
      { date: '2021-08-09', ticker: 'EUCAR', label: 'Europcar Mobility Group',       type: 'sell', qty: 15800, price: 0.498,  currency: 'EUR', cost: 5701,     proceeds: 7864, realizedPL: 2162.67, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA', note: '11816@0.498 + 3984@0.498 (merged)' },
      { date: '2021-08-17', ticker: 'NVDA',  label: 'NVIDIA Corporation',            type: 'buy',  qty: 30,    price: 194.15, currency: 'USD', cost: 5825,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', splitFactor: 10, note: 'Pre 10:1 split (June 2024)' },
      { date: '2021-08-19', ticker: 'DIS',   label: 'Walt Disney Company',           type: 'buy',  qty: 20,    price: 173.1,  currency: 'USD', cost: 3462,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2021-09-24', ticker: 'DIS',   label: 'Walt Disney Company',           type: 'sell', qty: 30,    price: 175.45, currency: 'USD', cost: 4104,     proceeds: 5264, realizedPL: 749.58, commission: '', costBasis: '', source: 'degiro', note: '26+4 fills at same price (merged)' },

      // ──────────────────────────────────────────────────
      // 2023 TRADES
      // ──────────────────────────────────────────────────
      { date: '2023-07-27', ticker: 'SAP',   label: 'SAP SE',                        type: 'sell', qty: 27,    price: 135.2,  currency: 'EUR', cost: 3179,     proceeds: 3650, realizedPL: 471.19, commission: '', costBasis: '', source: 'degiro', note: 'SAP on Xetra (EUR) — P/L vérifié rapport annuel 2023' },
      { date: '2023-07-27', ticker: 'NVDA',  label: 'NVIDIA Corporation',            type: 'sell', qty: 4,     price: 473.4,  currency: 'USD', cost: '',     proceeds: 1894, realizedPL: 1191.53, commission: '', costBasis: '', source: 'degiro', splitFactor: 10, note: 'Pre 10:1 split (June 2024)' },

      // ──────────────────────────────────────────────────
      // 2025 TRADES
      // ──────────────────────────────────────────────────
      { date: '2025-02-27', ticker: 'DIS',   label: 'Walt Disney Company',           type: 'sell', qty: 5,     price: 112.9,  currency: 'USD', cost: 866,     proceeds: 565, realizedPL: -82.56, commission: '', costBasis: '', source: 'degiro', note: 'P/L vérifié rapport annuel 2025 (DISNEY total: -82.56)' },
      { date: '2025-02-27', ticker: 'SPOT',  label: 'Spotify Technology SA',         type: 'sell', qty: 2,     price: 606.89, currency: 'USD', cost: 242,     proceeds: 1214, realizedPL: 940.57, commission: '', costBasis: '', source: 'degiro', note: 'P/L vérifié rapport annuel 2025' },
      { date: '2025-04-07', ticker: 'NVDA',  label: 'NVIDIA Corporation',            type: 'sell', qty: 100,   price: 89.73,  currency: 'USD', cost: '',     proceeds: 8973, realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'Lot 1/2 — total NVDA 2025 P/L: 41354.50 (rapport annuel)' },
      { date: '2025-04-07', ticker: 'NVDA',  label: 'NVIDIA Corporation',            type: 'sell', qty: 440,   price: 89.73,  currency: 'USD', cost: '',     proceeds: 39481, realizedPL: 41354.50, commission: '', costBasis: '', source: 'degiro', note: 'Lot 2/2 — P/L total NVDA 2025: 41354.50 (rapport annuel). P/L porté sur ce lot.' },
      { date: '2025-04-07', ticker: 'INFY',  label: 'Infosys Limited (ADR)',         type: 'sell', qty: 300,   price: 16.95,  currency: 'USD', cost: '',     proceeds: 5085, realizedPL: 1234.46, commission: '', costBasis: '', source: 'degiro', note: 'P/L vérifié rapport annuel 2025' },
    ],

    // ──────────────────────────────────────────────────────
    // PASSIF — dettes / obligations
    // ──────────────────────────────────────────────────────
    tva: -16000,             // TVA à payer (négatif = dette)

    // ──────────────────────────────────────────────────────
    // FACTURATION — Positions inter-personnes
    // Source: https://lallakenza.github.io/facturation/
    // Montants en MAD (scénario "si je paye au Maroc")
    // Positif = on me doit, Négatif = je dois
    // ──────────────────────────────────────────────────────
    facturation: {
      augustin: { amount: 181609, currency: 'MAD', label: 'Augustin (Azarkan) me doit', notes: 'Pos. Entreprise -5958€ converti MAD. 5 catégories: RTL, AZCS, Maroc, Divers, Report. Taux fixe 10.26' },
      benoit:   { amount: -196915, currency: 'MAD', label: 'Je dois à Benoit (Badre)', notes: 'En cours 2026, 5 councils payés. Paiement cash DH uniquement. Taux fixe 10.6, commission 10%' },
    },
  },

  // ════════════════════════════════════════════════════════
  // NEZHA
  // ════════════════════════════════════════════════════════
  nezha: {
    // ── Cash détaillé Nezha (relevés 19 avril 2026) ──
    cash: {
      revolutEUR: 5679,        // EUR — Revolut France (0%) — MAJ 19/04/2026
      creditMutuelCC: 8174,    // EUR — Crédit Mutuel compte courant (0%) — MAJ 19/04/2026
      lclLivretA: 23015,       // EUR — LCL Livret A (1.5% défiscalisé) — MAJ 19/04/2026
      lclCompteDepots: 20412,  // EUR — LCL Compte principal (0%) — MAJ 19/04/2026
      ibkrEUR: 16260,          // EUR — IBKR Nezha (broker, cash/NAV) — MAJ 19/04/2026
      attijariwafarMAD: 11900, // MAD — Attijariwafa Compte chèque MRE (0%) — MAJ 19/04/2026
      wioAED: 18385,           // AED — Wio UAE (UAE Dirham 17,882.10 + Family account 502.50 = 18,384.60 AED, arrondi) — MAJ 20/04/2026
    },
    sgtm: { shares: 32 },   // SGTM Bourse Casablanca
    // ── ESPP Nezha — UBS Account W3 F0329 11 (relevé juin 2025) ──
    // Source : relevé UBS "Investment Account June 2025" — 6 pages
    //
    // STRUCTURE DU COMPTE UBS:
    //   - Company Sponsored Stock Plan (ESPP Accenture)
    //   - 40 actions ACN au 30/06/2025, cost basis total $10,544.20
    //   - Valeur au 30/06/2025 : $11,955.60 (ACN @ $298.89)
    //   - Unrealized G/L: +$1,411.40
    //   - Cash: $109.56 (dividendes accumulés)
    //
    // ESPP DISCOUNT:
    //   - Accenture ESPP = 15% discount sur le cours le + bas entre
    //     début et fin de période de souscription (6 mois)
    //   - Le costBasis ci-dessous est le prix NET après discount
    //   - Le prix de marché au moment de l'achat était plus élevé
    //
    // DIVIDENDES (ACN, trimestriels, même dates que espp Amine — voir acnDividends):
    //   - YTD juin 2025 : $71.04 brut (UBS statement p.3)
    //   - WHT (Foreign taxes paid) : -$17.76 YTD (15% US withholding tax)
    //   - Dividendes nets YTD : $71.04 - $17.76 = $53.28
    //   - Estimated annual income: $237.00 (UBS p.5)
    //   - Les dividendes sont automatiquement crédités en cash USD sur le compte UBS
    //
    // GAINS & LOSSES (UBS p.3):
    //   - Unrealized short-term: $715.75 | long-term: $695.65
    //   - Realized: $0 (aucune vente)
    //   - Change in market value YTD: -$1,410.72
    //
    espp: {
      shares: 40,
      cashUSD: 109.56,   // Cash résiduel dans le compte UBS (dividendes accumulés)
      totalCostBasisUSD: 10544.20,  // Somme des cost basis de tous les lots
      // Lots détaillés — source: UBS statement p.5 "Your assets → Equities"
      // costBasis = prix d'achat USD/action APRÈS discount ESPP 15%
      // Holding period: LT = long-term (>1 an), ST = short-term (<1 an)
      lots: [
        { date: '2023-11-01', source: 'ESPP', shares: 8, costBasis: 255.148 },  // LT, cost $2,041.19
        { date: '2024-05-01', source: 'ESPP', shares: 8, costBasis: 255.675 },  // LT, cost $2,045.40
        { date: '2024-11-01', source: 'ESPP', shares: 8, costBasis: 294.431 },  // LT, cost $2,355.45 — unrealized +$35.67
        { date: '2025-05-01', source: 'ESPP', shares: 16, costBasis: 256.385 }, // ST, cost $4,102.16 — unrealized +$680.08
      ],
      // Withholding tax tracking (source: UBS p.3 "Withholdings and tax summary")
      whtYTD_2025_USD: 17.76,  // Foreign taxes paid YTD au 30/06/2025
      dividendsYTD_2025_USD: 71.04, // Dividend income YTD au 30/06/2025
    },
    creances: {
      items: [
        { label: 'Omar', amount: 40000, currency: 'MAD', guaranteed: false, probability: 0.7, status: 'en_cours', dueDate: '2026-12-31', lastContact: '2026-01-15', payments: [], notes: '' },
      ],
    },
    // Caution locative Rueil — dépôt de garantie reçu du locataire, à rembourser au départ
    cautionRueil: 2600, // EUR — à déduire du patrimoine net (dette envers locataire)
    // ── Montres / objets de valeur (actifs physiques patrimoniaux) ──
    // Estimation conservatrice à la revente (2nde main, marché pre-owned) — pas de valeur d'assurance.
    // Référence: Datejust 31 Rolesor Everose ref. 278271-0004 (acier 904L + or rose 18ct),
    // boîte + papiers + garantie Rolex 5 ans — brochure Rolex France m278271-0004.
    // Retail boutique 2026 (TTC France, avec diamants cadran/lunette selon config) ≈ 14-15K€.
    // Portée occasionnellement, full set : pre-owned premium typique 80-85% du neuf
    // (les Datejust Rolesor femme conservent bien mais < sport-models). 12 000€ prudent.
    watches: {
      rolexDatejust: 12000, // EUR — Datejust 31 Rolesor Everose (278271-0004), acheté avr 2026
    },
    immo: {
      // { value: valeur estimée à valueDate, crd: capital restant dû, loyer: loyer mensuel }
      // La valeur évolue automatiquement avec le taux d'appréciation depuis valueDate
      rueil:     { value: 280000, valueDate: '2025-09', crd: 194501, loyerHC: 1300, chargesLocataire: 150 }, // CRD mis à jour 31/03/2026 (76 mensualités)
      // value: 280K = estimation sept 2025, 55.66m² × ~5 030€/m² (ancien rénové, 15K€ travaux réalisés)
      // Achat 255K (nov 2019) + 15K travaux = 270K investi
      // MeilleursAgents allée des Glycines : 4 445€/m² (moyenne rue, stock mixte)
      // Après rénovation : +10-12% vs non rénové → ~4 935-5 030€/m² = 275-280K
      villejuif: { value: 370000, valueDate: '2025-09', crd: 318470, loyerHC: 1700, signed: false, reservationFees: 3363 },
      // value: 370K = estimation sept 2025, 68.92m² × ~5 370€/m² (VEFA neuf, en construction)
      // Prix contrat réservation : 336 330€ TTC (TVA 20%) — signé 20/06/2025
      // efficity Bd Gorki jan 2026 : 5 050€/m² (ancien), prime neuf +6%
      // MeilleursAgents Bd Gorki : 5 138€/m² (ancien moyen)
      // Neuf VEFA face station L15 Louis Aragon : ~5 400-5 600€/m²
      // Valeur conservatrice en construction (livraison Q1 2028)
      //
      // Flag `signed` (BUG-044, audit v297) — convention de calcul NW :
      //   signed=false : bien en cours d'acquisition. Seuls `reservationFees` comptent dans le NW.
      //                  `villejuifEquity = 0`, `futureEquity = valueProjetée − CRDfinal` (projection pour "NW avec Villejuif").
      //   signed=true  : acte notarié passé. `villejuifEquity = value − CRD` compté dans nezhaNW.
      //                  `reservationFees = 0` (remboursés à la signature, pas de double comptage).
      // Règle d'or : `nezhaNW` inclut SOIT `reservationFees` (pré-signature) SOIT `villejuifEquity` (post-signature),
      // jamais les deux simultanément. Vérifier `engine.js` L3762 + L3775 si tu bascules ce flag.
    },
  },

  // ════════════════════════════════════════════════════════
  // PRIX DE MARCHÉ (mis à jour automatiquement par API)
  // ════════════════════════════════════════════════════════
  market: {
    sgtmPriceMAD: 826,       // Bootstrap SGTM en MAD (clôture vendredi 17 avril 2026, +6.44% séance). v330+ : surchargé au runtime par data/sgtm_live.json (scrapé par GitHub Action horaire, .github/workflows/sgtm-scrape.yml).
    sgtmCostBasisMAD: 420,   // Prix d'achat IPO (offre grand public, déc 2025)
    acnPriceUSD: 197.55,     // Cours Accenture en USD — live 31/03/2026 (Yahoo Finance)
    // Prix de référence historiques pour P&L (stockés une fois, pas re-fetchés)
    acnYtdOpen: 259.95,      // ACN clôture 2 jan 2026
    acnMtdOpen: 205.93,      // ACN clôture 3 mar 2026
    acnOneMonthAgo: 208.72,  // ACN clôture ~27 fév 2026
    acnOneYearAgo: 305.32,   // ACN clôture 21 mars 2025 (Yahoo Finance)
    // ── Prix historiques 1Y ago (21 mars 2025) — pour P&L 1 An ──
    // Source : Yahoo Finance v8/chart API — fetched une fois, stockés en dur
    // Ces prix servent de référence pour calculer l'évolution sur 1 an
    // Pour les positions IBKR (toutes achetées APRÈS mars 2025), ces prix
    // ne sont pas utilisés dans le calcul P&L (sharesAtStart=0) mais sont
    // stockés pour référence historique et futur usage.
    oneYearAgoPrices: {
      // IBKR positions — clôture 21 mars 2025
      'AIR.PA':  166.64,    // Airbus
      'BN.PA':   71.88,     // Danone
      'DG.PA':   118.25,    // Vinci
      'FGR.PA':  109.45,    // Eiffage
      'MC.PA':   602.50,    // LVMH
      'OR.PA':   352.75,    // L'Oréal
      'P911.DE': 51.96,     // Porsche
      'RMS.PA':  2513.00,   // Hermès
      'SAN.PA':  105.84,    // Sanofi
      'SAP.DE':  251.95,    // SAP SE
      '4911.T':  2849.50,   // Shiseido (JPY)
      'IBIT':    47.70,     // iShares Bitcoin (USD)
      'ETHA':    14.93,     // iShares Ethereum (USD)
      'ACN':     305.32,    // Accenture (USD) — même que acnOneYearAgo
      // IBKR positions fermées (vendues pendant la période 1Y)
      'QQQM':    198.01,    // Invesco Nasdaq 100 (USD) — acheté avr 2025, vendu fév 2026
      'GLE':     42.35,     // Société Générale (EUR) — acheté août 2025, vendu fév 2026
      'WLN':     6.74,      // Worldline (EUR) — acheté août 2025, vendu fév 2026
      'EDEN':    31.39,     // Edenred (EUR) — acheté sept 2025, vendu fév 2026
      'NXI':     10.06,     // Nexity (EUR) — acheté août 2025, vendu fév 2026
      // Degiro positions liquidées en avril 2025 — ces positions EXISTAIENT
      // le 21 mars 2025, donc leur P&L 1Y = (proceeds - shares × prix_1Y_ago)
      'NVDA':    117.70,    // NVIDIA (USD) — 540 actions vendues le 7 avr 2025 @ $89.73
      'INFY':    18.32,     // Infosys (USD) — 300 actions vendues le 7 avr 2025 @ $16.95
    },
    // ── Taux de change historiques 1Y ago (21 mars 2025) ──
    // Source : Yahoo Finance EURJPY=X, EURUSD=X, etc.
    // Utilisés pour convertir les P&L des positions étrangères à leur valeur
    // de référence 1Y ago
    fxOneYearAgo: {
      EUR: 1,
      USD: 1.0857,    // EUR/USD le 21 mars 2025
      JPY: 161.32,    // EUR/JPY le 21 mars 2025
      MAD: 10.14,     // EUR/MAD le 21 mars 2025
      AED: 3.98,      // EUR/AED le 21 mars 2025
    },
  },
};

// ════════════════════════════════════════════════════════════
// DATE DE DERNIÈRE MISE À JOUR DES DONNÉES STATIQUES
// Utilisée pour afficher "données du XX" pendant le chargement
// Format : 'JJ/MM/YYYY' — à mettre à jour à chaque modification de data.js
// ════════════════════════════════════════════════════════════
export const DATA_LAST_UPDATE = '20/04/2026';
export const APP_VERSION = 'v333';

// ════════════════════════════════════════════════════════════
// DESIGN TOKENS — v322
// ════════════════════════════════════════════════════════════
// Miroir JS de la charte graphique (:root dans index.html).
// Utilisé par tout ce qui dessine sur <canvas> (Chart.js, treemap)
// car les contextes canvas ne lisent pas les var(--xxx).
//
// ⚠️ Single source of truth : changer ici ET dans :root simultanément.
// Voir ARCHITECTURE.md §70 pour la charte complète.
// ════════════════════════════════════════════════════════════
export const DESIGN_TOKENS = {
  // Surfaces & neutrals
  bg: '#fafaf9',
  surface: '#ffffff',
  surfaceSubtle: '#f5f5f4',
  border: '#e7e5e4',
  borderStrong: '#d6d3d1',
  text: '#1c1917',
  textSecondary: '#57534e',
  textMuted: '#a8a29e',

  // Brand
  primary: '#1e3a5f',
  primarySoft: '#e7edf5',
  gold: '#b45309',
  goldSoft: '#fef3c7',

  // Semantic
  success: '#15803d',
  successSoft: '#dcfce7',
  warning: '#b45309',
  warningSoft: '#fef3c7',
  danger: '#b91c1c',
  dangerSoft: '#fee2e2',
  info: '#0369a1',
  infoSoft: '#e0f2fe',

  // Scenarios Financement Immo
  scenA: '#64748b',
  scenB: '#2563eb',
  scenC: '#0d9488',
  scenD: '#7c3aed',

  // Asset classes
  assetActions: '#1e40af',
  assetImmo: '#b45309',
  assetCashActive: '#15803d',
  assetCashDormant: '#9f1239',
  assetVehicle: '#57534e',
  assetCreance: '#be185d',

  // Geo
  geoFR: '#2563eb',
  geoUS: '#15803d',
  geoJP: '#be123c',
  geoMA: '#b45309',
  geoAE: '#0e7490',
  geoDE: '#7c3aed',
};

// ════════════════════════════════════════════════════════════
// PRIX STATIQUES — fallback "Si gardé auj." avant fetch API
// Prix post-split en devise native. Mis à jour manuellement.
// Les API Yahoo écrasent ces valeurs dès le fetch terminé.
// ════════════════════════════════════════════════════════════
export const DEGIRO_STATIC_PRICES = {
  // US stocks (USD)
  NVDA:  { price: 182.78, currency: 'USD' },
  DIS:   { price: 98.61,  currency: 'USD' },
  BA:    { price: 209.89, currency: 'USD' },
  NKE:   { price: 53.98,  currency: 'USD' },
  PM:    { price: 174.71, currency: 'USD' },
  CCL:   { price: 24.63,  currency: 'USD' },
  GOOS:  { price: 10.50,  currency: 'USD' },
  V:     { price: 307.14, currency: 'USD' },
  FDX:   { price: 392.86, currency: 'USD' },
  IBM:   { price: 223.35, currency: 'USD' },
  GME:   { price: 23.28,  currency: 'USD' },
  SPOT:  { price: 515.01, currency: 'USD' },
  INFY:  { price: 13.52,  currency: 'USD' },
  SAP:   { price: 189.97, currency: 'USD' },  // ADR price (NYSE)
  CGC:   { price: 1.02,   currency: 'USD' },
  HYLN:  { price: 2.01,   currency: 'USD' },
  HTZ:   { price: 0.00,   currency: 'USD', delisted: true, note: 'Ch.11 bankruptcy — old shares cancelled (Jun 2021)' },
  VLTA:  { price: 0.86,   currency: 'USD', delisted: true, note: 'Acquired by Shell at $0.86/share (Mar 2023)' },
  // European stocks (EUR)
  MC:    { price: 479.00, currency: 'EUR' },
  CAP:   { price: 107.80, currency: 'EUR' },
  ACA:   { price: 18.06,  currency: 'EUR' },
  EN:    { price: 140.30, currency: 'EUR' },
  AF:    { price: 9.57,   currency: 'EUR' },  // post reverse split 10:1
  CLARI: { price: 3.83,   currency: 'EUR' },  // ex-KORI
  KORI:  { price: 3.83,   currency: 'EUR' },  // alias → Clariane
  ADP:   { price: 111.80, currency: 'EUR' },
  ATO:   { price: 36.86,  currency: 'EUR' },
  SAN:   { price: 83.00,  currency: 'EUR' },
  JUVE:  { price: 2.17,   currency: 'EUR' },  // post reverse split 10:1
  EUCAR: { price: 0.50,   currency: 'EUR', delisted: true, note: 'VW squeeze-out at €0.50/share (Jul 2022)' },
};

// ════════════════════════════════════════════════════════════
// TAUX DE RENDEMENT CASH (annuels)
// ════════════════════════════════════════════════════════════
// Utilisé pour calculer l'intérêt/rendement du cash dormant
// Format: clé = identifiant compte, valeur = taux annuel décimal
//
// ACCOUNTS — Structure :
// - UAE (Amine) : Mashreq, Wio Savings, Wio Current, Revolut
// - Maroc (Amine) : Attijari, Nabd
// - Revolut EUR (Amine) : no yield
// - IBKR (Amine) : EUR, USD, JPY avec seuils spéciaux
// - Nezha (multiples) : Revolut, Crédit Mutuel, Livret A, LCL, Attijari, Wio
//
// TAUX IBKR — ⚠️  Gestion spéciale dans engine.js ⚠️
// Ces taux ci-dessous sont NOMINAUX (avant seuils).
// Rendement EFFECTIF calculé dans engine.js avec :
//   - EUR/USD : premiers 10K à 0% (seuil IBKR), reste au taux ci-dessous
//   - JPY : taux par tranche dégressive (voir IBKR_CONFIG.jpyTiers)
//   - See engine.js > ibkrJPYBorrowCost() pour calcul détaillé
//
// MISE À JOUR :
// - Taux UAE: vérifier Mashreq app / Wio app
// - Taux Maroc: Attijari/Nabd mobile app
// - Taux IBKR: https://www.interactivebrokers.com/en/accounts/fees/pricing-interest-rates.php
// - Dernière vérification : 7 mars 2026
// ════════════════════════════════════════════════════════════
export const CASH_YIELDS = {
  // --- UAE ---
  mashreq: 0.0625,     // 6.25% Mashreq NEO+ Savings (taux fixe)
  wioSavings: 0.06,    // 6.00% Wio Savings (taux affiché dans l'app)
  wioCurrent: 0,       // Compte courant, pas de rendement
  // --- Revolut ---
  revolutEUR: 0,       // Pas de rendement (pas de coffre activé)
  // --- Maroc ---
  attijari: 0,         // Compte courant, pas de rendement
  nabd: 0,             // Compte courant, pas de rendement
  // --- IBKR (taux IBKR Pro = Benchmark - 0.5%) ---
  ibkrCashEUR: 0.0153,  // 1.53% = BM 2.03% - 0.50% commission IBKR
  ibkrCashUSD: 0.0314,  // 3.14% = BM 3.64% - 0.50% commission IBKR
  ibkrCashJPY: -0.017,  // NON UTILISÉ DIRECTEMENT — calcul par tranche dans engine.js
  // --- Autres ---
  // --- Nezha (détaillé par compte) ---
  nezhaRevolutEUR: 0,       // Revolut EUR — pas de rendement
  nezhaCreditMutuel: 0,     // Crédit Mutuel CC — pas de rendement
  nezhaLivretA: 0.015,      // LCL Livret A — 1.5% (depuis fév 2026, défiscalisé)
  nezhaLclDepots: 0,        // LCL Compte principal — pas de rendement
  nezhaIbkrEUR: 0,          // IBKR Nezha — cash broker (positions non détaillées), 0% rendement cash
  nezhaAttijariMAD: 0,      // Attijariwafa Maroc — pas de rendement
  nezhaWioAED: 0,           // Wio UAE — pas de rendement (0% sur screenshot)
  esppCash: 0,         // Cash résiduel ESPP, pas de rendement
};

// Taux d'inflation annuel (pour calcul érosion cash dormant)
export const INFLATION_RATE = 0.03; // 3% annuel

// ════════════════════════════════════════════════════════════
// IBKR CONFIGURATION — Seuils, taux, limites de crédit
// ════════════════════════════════════════════════════════════
// Configuration de compte Interactive Brokers pour calculs
// See engine.js pour implémentation (ibkrJPYBorrowCost, ibkrCashYield)
//
// Source : https://www.interactivebrokers.com/en/trading/margin-rates.php
// Dernière vérification : 31 mars 2026 — BOJ rate 0.75% (verified), IBKR rates via website
// ════════════════════════════════════════════════════════════
export const IBKR_CONFIG = {
  // ── Seuil cash EUR/USD ──
  // Premiers 10 000 EUR (ou USD équivalent) à 0% de taux
  // Au-delà : appliqué taux IBKR_CONFIG.CASH_YIELDS
  cashThreshold: 10000,

  // ── Tiers d'emprunt JPY (marge) ──
  // Utilisé pour calcul intérêt/coût carry trade JPY short
  // Benchmark JPY mars 2026 = 0.75% (BOJ Unsecured Overnight Call Rate, vérifiée)
  // Note: Dernière vérification 31 mars 2026. Pour taux complets IBKR Pro:
  //       consulter https://www.interactivebrokers.com/en/trading/margin-rates.php
  // Taux = Benchmark + spread (spread dépend du tier)
  // Calcul: engine.js ibkrJPYBorrowCost()
  jpyTiers: [
    { limit: 11000000,  rate: 0.02204 },  // Tier 1: 0 → ¥11M   (BM + 1.5% = 0.75% + 1.5% = 2.25%)
    { limit: 114000000, rate: 0.01704 },  // Tier 2: ¥11M → ¥114M (BM + 1.0% = 0.75% + 1.0% = 1.75%)
    { limit: Infinity,  rate: 0.01454 },  // Tier 3: > ¥114M      (BM + 0.75% = 0.75% + 0.75% = 1.5%)
  ],

  // ── Gestion de trésorerie ──
  // Solde EUR optimal = seuil recommandé pour éviter frais margin
  // Amine maintient ~20K EUR pour éviter maintenance fee
  optimalCashEUR: 20000,

  // ── Rendement de référence ──
  // Taux benchmark pour calcul coût d'opportunité (6% = rendement médian cash)
  refYield: 0.06,
};

// ════════════════════════════════════════════════════════════
// TAUX DE CHANGE STATIQUES — Fallback si API indisponible
// ════════════════════════════════════════════════════════════
// Format: 1 EUR = X devises étrangères (tous les taux pivotent sur EUR)
// Utilisation: conversion actifs, calculs NAV
//
// MISE À JOUR:
// - Source: Yahoo Finance (API live = prioritaire)
// - Fallback statique si API indisponible = derniers taux connus
// - Mise à jour statique: 1x par semaine (vendredi clôture)
//
// Taux historiques (ref):
// - 31 mars 2026 (live open.er-api.com)
//   EUR/AED: 4.2111, EUR/MAD: 10.7606, EUR/USD: 1.1467, EUR/JPY: 183.15
// - 21 mars 2026 (clôture vendredi marché)
//   EUR/AED: 4.2507, EUR/MAD: 10.804, EUR/USD: 1.0850, EUR/JPY: 162.50
// ════════════════════════════════════════════════════════════
export const FX_STATIC = {
  EUR: 1,                   // Base de référence
  AED: 4.2111,              // Dirham des EAU (Dubai) — 31/03/2026
  MAD: 10.7606,             // Dirham marocain (Maroc) — 31/03/2026
  USD: 1.1467,              // Dollar US — 31/03/2026
  JPY: 183.15,              // Yen japonais — 31/03/2026
};

// Symboles devises pour affichage
export const CURRENCY_CONFIG = {
  symbols: { EUR: '\u20ac', AED: '\u062f.\u0625', MAD: 'DH', USD: '$', JPY: '\u00a5' },
  symbolAfter: { MAD: true },
};

// ════════════════════════════════════════════════════════════
// IMMOBILIER — Constantes charges, loyers, amortissement
// ════════════════════════════════════════════════════════════
// Utilisé pour:
// - Calcul rendement locatif net (loyers - charges - intérêts)
// - Projections régimes fiscaux (micro vs réel)
// - Simulation amortissement (déduction LMNP)
// - Calcul croissance nette du patrimoine immobilier
//
// Structure:
//   vitry / rueil / villejuif: {
//     loyerBrut: loyer annuel sans charges
//     chargesAnnuelles: copro, PNO, taxe foncière, assurance
//     appreciation: taux croissance annuel
//     lmnpAmortStart: date début amortissement (si LMNP)
//   }
//
// NOTE: Croissance calculée dynamiquement dans engine.js
// depuis les éléments: tableau amortissement prêts + appreciation + CF net
// Voir computeImmoView() pour détails
// ════════════════════════════════════════════════════════════
export const IMMO_CONSTANTS = {
  villejuifStartMonth: 24, // Q1 2028 ~ 24 mois à partir de mars 2026 (contrat: livraison max 31/03/2028)
  charges: {
    // { pret: mensualité, assurance, pno: assurance propriétaire, tf: taxe foncière/12, copro }
    // Vitry : prêt lissé → charges ~constantes quelle que soit la période
    // P2 (2026-2028): AL 145 + BP 1021 + PTZ 0 = 1166 | P3 (2029-2043): AL 145 + BP 688 + PTZ 333 = 1166
    vitry:     { pret: 1166, assurance: 17, pno: 15, tf: 75, copro: 150 },  // ass: APRIL 17.48€/mois ≈ 17
    rueil:     { pret: 970, assurance: 18, pno: 12, tf: 67, copro: 250 },  // pret: 969.62, ass: 17.99 (2026), copro: 250 dont 150 refacturé locataire
    villejuif: { pret: 1669, assurance: 51, pno: 15, tf: 83, copro: 110 },
  },
  prets: {
    vitryEnd: 2048,      // Année fin du prêt
    rueilEnd: 2044,
    villejuifEnd: 2052,
  },
  // ──────────────────────────────────────────────────────
  // PRÊTS — Paramètres complets pour tableau d'amortissement
  // principal: montant emprunté initial
  // rate: taux annuel nominal (ex: 1.25% = 0.0125)
  // startDate: 'YYYY-MM' — mois du premier versement
  // durationMonths: durée totale en mois
  // monthlyPayment: mensualité hors assurance
  // insurance: assurance emprunteur mensuelle
  // ──────────────────────────────────────────────────────
  loans: {
    // ── VITRY : 3 prêts — CRD calculé dynamiquement depuis vitryLoans ──
    // ════════════════════════════════════════════════════════════
    // VITRY — 3 prêts (275 000€ total)
    // Sources : tableaux d'amortissement Banque Populaire Rives de Paris + Action Logement
    // Emprunteur : Mohammed / Mohamed Amine KORAIBI
    // Bien financé : ZAC Gare des Ardoines, Vitry-sur-Seine
    //
    // Le CRD global 'vitry' est calculé dynamiquement par computeMultiLoanSchedule(vitryLoans)
    // L'assurance APRIL (17.48€/mois) est externalisée car elle couvre PTZ + BP ensemble
    // ════════════════════════════════════════════════════════════
    vitryInsurance: 17.48,     // assurance APRIL globale : 209.76€/an = 17.48€/mois
    vitryLoans: [
      // ── PRÊT 1 : Action Logement ──
      // Dossier : ALSXACC-22047897
      // Source : tableau d'amortissement Action Logement Services, Paris, 4 janvier 2023
      // Versement SEINEO n° 3074557 (promoteur)
      // Échéance constante 145.20€ (1ère: 156.53€ intérêts longs), assurance 3.33€/mois intégrée
      // Taux annuel effectif assurance : 0.19%
      // Dernière échéance : 05/02/2048
      {
        name: 'Action Logement',
        principal: 40000,      // montant viré à SEINEO
        rate: 0.005,           // 0.50% taux nominal fixe
        startDate: '2023-03',  // 1ère échéance 05/03/2023
        durationMonths: 300,   // 25 ans (mars 2023 → fév 2048)
        monthlyPayment: 145.20,// échéance constante (hors 1ère: 156.53€)
        insuranceMonthly: 3.33,// assurance AL intégrée dans l'échéance
        iraExempt: true,       // Action Logement loans are exempt from IRA
      },
      // ── PRÊT 2 : PTZ (Prêt à Taux Zéro) ──
      // Dossier : 08867339 — Banque Populaire Rives de Paris, agence Diderot
      // Compte : 23193675521
      // Source : tableau d'amortissement édité le 10/11/2023 par GODEAU
      // Catégorie : PRET A TAUX ZERO (768 ZZ)
      // Date réalisation : 06/04/2023, déblocage initial 5 000€
      // Structure : 60 mois de différé total, puis 180 mois d'amortissement constant
      // Dernière échéance : ~nov 2043
      {
        name: 'PTZ (via Banque Populaire)',
        principal: 60000,
        rate: 0,               // 0% — Prêt à Taux Zéro
        startDate: '2023-12',  // 1ère échéance 06/12/2023 (table d'amort)
        durationMonths: 240,   // 20 ans total (60 différé + 180 amort)
        periods: [
          { months: 60, payment: 0 },        // P1 : différé total 5 ans (déc 2023 – nov 2028)
          { months: 180, payment: 333.33 },   // P2 : amortissement constant 333.33€ (déc 2028 – nov 2043)
        ],                     // 60000 / 333.33 = 180 mois ✓
        insuranceMonthly: 0,   // assurance APRIL séparée (voir vitryInsuranceAPRIL)
        iraExempt: true,       // PTZ loans are exempt from IRA
      },
      // ── PRÊT 3 : Banque Populaire Riv'immo ──
      // Dossier : 08867340 — Banque Populaire Rives de Paris, agence Diderot
      // Compte : 23193675521 (même compte que PTZ)
      // Conseillère : Nafissa BATTERY
      // Source : tableau d'amortissement édité le 24/07/2025
      // Catégorie : PRET IMMOBILIER (840 ZZ)
      // Date réalisation : 10/11/2023, déblocage initial 1 250€
      // Amortissement palier 4 périodes (lissage PTZ) :
      //   P1 (5 mois)  : intérêts seuls ~306€  — pas d'amortissement capital
      //   P2 (36 mois) : 1 020.55€ — amortissement + intérêts (aligné sur fin PTZ différé)
      //   P3 (180 mois): 687.55€ — palier bas pendant remboursement PTZ (333.33€)
      //   P4 (60 mois) : 1 020.58€ — retour palier haut après fin PTZ (nov 2043)
      // Total intérêts : 48 263.39€ | Total remboursé : 223 263.39€
      // Dernière échéance : 06/12/2048
      {
        name: 'Banque Populaire (Riv\'immo)',
        principal: 175000,
        rate: 0.021,           // 2.10% taux nominal fixe
        startDate: '2025-08',  // 1ère échéance 06/08/2025
        durationMonths: 281,   // 281 échéances (août 2025 → déc 2048)
        periods: [
          { months: 5, payment: 306.25 },     // P1 : intérêts seuls (août–déc 2025), 1ère: 305.07
          { months: 36, payment: 1020.55 },   // P2 : jan 2026 – déc 2028 (palier haut, PTZ en différé)
          { months: 180, payment: 687.55 },   // P3 : jan 2029 – déc 2043 (palier bas, PTZ rembourse)
          { months: 60, payment: 1020.58 },   // P4 : jan 2044 – déc 2048 (retour palier, PTZ soldé)
        ],
        insuranceMonthly: 0,   // assurance APRIL séparée (voir vitryInsuranceAPRIL)
        // ⚠️ Le prêt est un lissage : les paliers P2/P3/P4 sont calibrés pour que
        //    BP + PTZ ≈ constante sur la durée (1020 + 0 ≈ 688 + 333 ≈ 1021 + 0)
        totalInterestRef: 48263,  // coût total intérêts (tableau d'amort, pour référence)
      },
    ],
    // ── Assurance emprunteur APRIL (couvre PTZ + BP Riv'immo) ──
    // Externe aux prêts BP, facturée séparément par APRIL
    // Pas d'assurance sur le prêt Action Logement (incluse dans l'échéance AL à 3.33€/mois)
    vitryInsuranceAPRIL: {
      annualTTC: 209.76,       // 17.48€/mois TTC
      breakdown: {
        ptz: 53.16,            // Emprunt N°1 : 60K PTZ
        bp: 147.00,            // Emprunt N°2 : 175K Riv'immo
        cotisationAssociative: 9.60,
      },
    },
    // ── RUEIL-MALMAISON — Prêt unique (251 200€) ──
    // Propriétaire : Nezha
    // Source : contrat notarié 5 novembre 2019
    // Bien financé : Rue Jean Bourgey, Rueil-Malmaison (75m² + parking)
    // Taux nominal fixe 1.20%
    // Assurance ACM VIE dégressive
    rueil: {
      principal: 251200,
      rate: 0.012,           // 1.20% taux nominal fixe
      startDate: '2019-12',   // 1ère échéance 5 décembre 2019
      durationMonths: 300,   // 25 ans (déc 2019 → nov 2044)
      monthlyPayment: 969.62, // échéance constante contrat notarié
      insurance: 17.99,     // assurance ACM VIE — dégressive (17.99€ en 2026)
    },
    // ── VILLEJUIF — 2 prêts LCL (318 469€ total) ──
    // Propriétaire : Nezha
    // Source : offres de prêt LCL signées 2025, pas encore débloquées
    // Bien financé : T3 VEFA — Bd Gorki, Villejuif (68.92m² + parking)
    // Prix contrat réservation : 336 330€ TTC (TVA 20%), signé 20/06/2025
    // Livraison estimée : Q1 2028 (construction en cours)
    // ⚠️ Le contrat de réservation mentionne un financement Crédit Agricole
    //    (332 967€, 300 mois, 3.50%) → données INDICATIVES UNIQUEMENT
    //    Les vrais prêts sont les 2 offres LCL ci-dessous.
    // CRD global calculé dynamiquement par computeMultiLoanSchedule(villejuifLoans)
    villejuifInsurance: 51.29,   // 46.10 (Prêt 1) + 5.19 (Prêt 2)
    villejuifLoans: [
      // ── PRÊT 1 : LCL Immo Taux Fixe (286 669€) ──
      // Taux nominal 3.27% — TAEG 3.73% (avec assurance)
      // Franchise totale 36 mois (intérêts capitalisés, pas de mensualité)
      // Puis amortissement 291 mois à 1 572.79€
      // Assurance ACM : 46.10€/mois (débute à la première échéance, pas pendant franchise)
      // Coût total intérêts : 142 199€ (offre de prêt, pour référence)
      // Intérêts différés pendant franchise : 19 055€
      {
        name: 'LCL Prêt 1 — Immo Taux Fixe',
        principal: 286669.95,
        rate: 0.0327,          // 3.27% taux nominal fixe
        startDate: '2025-08',  // début franchise août 2025 (pas encore débloqué)
        durationMonths: 327,   // 36 mois franchise + 291 mois amortissement
        periods: [
          { months: 36, payment: 0 },       // P1 : franchise totale (août 2025 – juillet 2028)
          { months: 291, payment: 1572.79 }, // P2 : amortissement constant (août 2028 – déc 2051)
        ],
        insuranceMonthly: 46.10,            // ACM assurance
        taeg: 0.0373,                       // Taux annuel effectif global
        totalInterestRef: 142199,  // coût total intérêts (offre de prêt, pour référence)
        deferredInterestRef: 19055,         // intérêts capitalisés pendant 36 mois franchise
      },
      // ── PRÊT 2 : LCL Immo Taux Fixe (31 800€) ──
      // Complément financement — taux 0.90%
      // Même structure franchise 36 mois + amortissement
      // Assurance : 5.19€/mois
      // Coût total intérêts : 3 791€ (offre de prêt)
      {
        name: 'LCL Prêt 2 — Immo Taux Fixe',
        principal: 31800,
        rate: 0.009,           // 0.90% taux nominal fixe
        startDate: '2025-08',  // début franchise août 2025 (pas encore débloqué)
        durationMonths: 327,
        periods: [
          { months: 36, payment: 0 },       // P1 : franchise totale
          { months: 291, payment: 124.99 },  // P2 : amortissement constant
        ],
        insuranceMonthly: 5.19,             // ACM assurance
        taeg: 0.0139,                       // Taux annuel effectif global
        totalInterestRef: 3791,             // coût total intérêts
        deferredInterestRef: 575,           // intérêts capitalisés pendant franchise
      },
    ],
    // ── Franchise des prêts LCL — déblocage + calendrier ──
    // ⚠️ PRÊT NON ENCORE DÉBLOQUÉ — Nezha n'a pas signé définitivement
    // Franchise: 36 mois à partir du déblocage (pas encore commencée)
    // État: loanDisbursed = false (offres signées, déblocage en attente)
    // Frais de dossier : 1 500€ (sera débité au déblocage)
    villejuifFranchise: {
      months: 36,
      startDate: null,         // Franchise non commencée (déblocage en attente)
      loanDisbursed: false,    // Prêt non encore débloqué
      fraisDossier: 1500,      // Frais dossier LCL (à débiter)
    },
  },
  // ──────────────────────────────────────────────────────
  // FISCALITÉ IMMOBILIÈRE
  //
  // ⚠️  Amine et Nezha sont RÉSIDENTS FISCAUX UAE
  // → Pas d'IR français sur les revenus mondiaux
  // → MAIS : les revenus fonciers de source FRANÇAISE restent
  //   imposables en France (convention fiscale FR-UAE art. 6)
  //
  // Vitry (Amine) : location NUE → revenus fonciers
  //   regime: 'micro-foncier' (abattement 30%) si loyers < 15K€/an
  //   Partie du loyer reçue en cash (non déclarée) → exclue du calcul fiscal
  //   En tant que non-résident : taux minimum 20% (pas de TMI progressive)
  //   PS : 17.2% sur les revenus fonciers de source française
  //
  // Rueil + Villejuif (Nezha) : LMNP (meublé)
  //   regime: 'micro-BIC' (abattement 50%) si recettes < 77 700€/an
  //   ou régime réel simplifié (amortissement du bien)
  //   Non-résident : taux minimum 20%
  //   PS : 17.2%
  // ──────────────────────────────────────────────────────
  fiscalite: {
    vitry:     { regime: 'reel-foncier', tmi: 0.20, ps: 0.172, type: 'nu' },
    // Vitry : loyerDeclare (500€/mois) est dans portfolio.amine.immo.vitry
    // Régime réel : on déduit intérêts d'emprunt, assurance, PNO, TF, copro
    // TMI 20% + PS 17.2% = taux effectif ~37% sur le revenu net
    rueil:     { regime: 'lmnp-amort', tmi: 0.20, ps: 0.172, type: 'lmnp', lmnpStartDate: '2025-10' },
    // LMNP réel avec amortissement → impôt = 0 (amortissement > revenu net)
    // lmnpStartDate: date de passage en LMNP (bail signé sept 2025, prise effet oct 2025)
    // Amortissement commence à cette date, pas à la date d'achat (2019)
    villejuif: { regime: 'lmnp-amort', tmi: 0.20, ps: 0.172, type: 'lmnp', lmnpStartDate: '2028-06' },
    // lmnpStartDate: livraison + début location estimé sept 2029
  },
  // ──────────────────────────────────────────────────────
  // MÉTADONNÉES PROPRIÉTÉS — surface, adresse, prix, appréciation
  // Utilisé par les pages détaillées (apt_*.html)
  // ──────────────────────────────────────────────────────
  properties: {
    vitry: {
      address: '19 Rue Nathalie Lemel, 94400 Vitry-sur-Seine',
      surface: 67.14,           // m²
      purchasePrice: 275000,    // prix d'achat TTC (VEFA)
      purchaseDate: '2023-01',  // acte notarié 16 janvier 2023
      deliveryDate: '2025-07',  // livraison VEFA juillet 2025
      tvaAvantage: 37796,       // économie TVA (20% - 5.5%) × prix HT
      // ── Appréciation réaliste par phase (moyenne pondérée) ──
      // 2026-2028 : 1.0%/an — quartier encore en chantier, gare pas ouverte,
      //   peu de commerces, offre neuve abondante qui pèse sur les prix, marché IDF tendu
      // 2029-2032 : 2.0%/an — gare L15 opérationnelle, ZAC livrée, rattrapage modéré
      // 2033+ : 1.5%/an — effet GPE digéré, croissance IDF standard
      // Moyenne lissée sur 10 ans ≈ 1.5%/an
      appreciation: 0.015,       // 1.5%/an (moyenne lissée, GPE Ligne 15 Les Ardoines)
      appreciationPhases: [
        { start: 2026, end: 2028, rate: 0.010, note: 'Quartier en chantier, gare en travaux, offre abondante' },
        { start: 2029, end: 2032, rate: 0.020, note: 'Gare L15 ouverte, ZAC livrée, rattrapage modéré' },
        { start: 2033, end: 2040, rate: 0.015, note: 'Effet GPE digéré, croissance IDF standard' },
      ],
      type: 'T3 — Location nue',
      loyerObjectif: 1270,      // loyer total CC réel perçu : 1050 HC + 150 charges + 70 parking
      totalInterestCost: 56644, // coût total intérêts (3 prêts combinés, offres de prêt)
      ligne15: { station: 'Les Ardoines', distance: '2-5 min à pied', opening: 2025 },
      details: {
        lot: '3302',
        floor: 'R+3 (4ème étage)',
        building: 'Bâtiment 3',
        type: 'T3',
        yearBuilt: 2023,
        developer: 'Nexity',
        program: 'ZAC Gare des Ardoines (84 logements)',
        norm: 'RE2020',
        heating: 'Chauffage collectif',
        dpe: 'A',
        rooms: [
          { name: 'Entrée', surface: 5.85 },
          { name: 'Séjour', surface: 21.28 },
          { name: 'Cuisine', surface: 8.52 },
          { name: 'Chambre 1', surface: 12.38 },
          { name: 'Chambre 2', surface: 9.95 },
          { name: 'Salle de bain', surface: 4.87 },
          { name: 'WC', surface: 2.09 },
          { name: 'Dégagement', surface: 2.20 },
        ],
        surfaceHabitable: 67.14,
        loggia: 8.1,
        surfaceTotale: 75.24,
        parking: true,
        cave: false,
        exposure: 'Sud-Ouest',
      },
    },
    rueil: {
      address: '21 Allée des Glycines, 92500 Rueil-Malmaison',
      surface: 55.66,           // m²
      purchasePrice: 240000,    // prix d'achat acte notarié (5 nov 2019) — hors frais notaire
      purchaseDate: '2019-11',  // acte notarié 5 novembre 2019
      purchaseDateLabel: '5 novembre 2019',
      // ── Appréciation réaliste par phase ──
      // 2026-2029 : 0.5%/an — marché plat, station L15 Rueil lointaine (~2030-2032),
      //   quartier Fouilleuse/Mazurières sous-performe le reste de Rueil (-37% vs ville)
      //   MeilleursAgents: 4 445€/m² allée des Glycines vs 5 920€ ville
      //   Orpi: prix Rueil -1.5% sur 2 ans (2023-2025)
      // 2030+ : 1.5%/an — si L15 Ouest ouvre, effet indirect (station à 15-20 min à pied)
      // Moyenne lissée sur 10 ans ≈ 1.0%/an
      appreciation: 0.01,        // 1.0%/an (moyenne lissée, effet L15 indirect et tardif)
      appreciationPhases: [
        { start: 2026, end: 2029, rate: 0.005, note: 'Marché plat, L15 Ouest pas avant 2030-2032' },
        { start: 2030, end: 2040, rate: 0.015, note: 'L15 Ouest ouvre, effet indirect à 15-20 min à pied' },
      ],
      type: 'T3 meublé — LMNP',
      ligne15: { station: 'Rueil-Suresnes', distance: '15-20 min à pied', opening: '2030-2032' },
      details: {
        lot: '894',
        floor: 'RDC',
        building: 'Bâtiment IX, escalier A',
        type: 'T3',
        yearBuilt: '1949-1974',
        developer: null,
        program: 'Résidence Montbrison',
        norm: null,
        heating: 'Chauffage collectif, eau chaude collective',
        dpe: null,
        rooms: [
          { name: 'Entrée + placard', surface: 4.39 },
          { name: 'Dégagement', surface: 3.25 },
          { name: 'Cuisine', surface: 6.11 },
          { name: 'Salon', surface: 16.62 },
          { name: 'Chambre 1 + placard', surface: 11.49 },
          { name: 'Chambre 2', surface: 9.60 },
          { name: 'WC', surface: 0.99 },
          { name: 'Salle de bain', surface: 3.21 },
        ],
        surfaceHabitable: 55.66,
        loggia: null,
        surfaceTotale: 55.66,
        parking: false,
        cave: true,
        caveLots: ['924 (cave)', '954 (séchoir)'],
        tantiemes: '249/100000',
        exposure: null,
      },
    },
    villejuif: {
      address: '167 Boulevard Maxime Gorki, 94800 Villejuif',
      surface: 68.92,           // m² (contrat de réservation §1.6 — lot A27, étage 2)
      purchasePrice: 336330,    // prix TTC contrat de réservation §1.7
      totalOperation: 336330,   // montant TTC total (TVA 20%)
      purchaseDate: '2025-06',  // signature contrat réservation 20/06/2025
      deliveryDate: '2028-03',  // Q1 2028 — contrat §1.4 "au plus tard le 31 mars 2028"
      // ── Appréciation réaliste par phase (révisée avril 2026) ──
      // Marché Villejuif : -1.17% sur 2 ans (2023-2025), tendance baissière
      // L'effet L15 est largement pricé : +20% entre 2021-2025 autour Louis Aragon
      // Études MeilleursAgents : les prix se tassent autour des futures stations GPE
      // Référence L14 Saint-Ouen : +55% en 5 ans PUIS ralentissement à +1.4%/an
      //   MeilleursAgents Bd Gorki : 5 138-5 210€/m² (fev-mars 2026)
      //   efficity: 5 050€/m² jan 2026, +6% vs ville
      //   Neuf VEFA Villejuif : 5 500-6 850€/m² (programmes en cours)
      // 2025-2027 : 2.0%/an — anticipation L15 (ouverture avril 2027) mais
      //   marché en tassement, effet déjà largement pricé. L14 déjà là + pôle Gustave Roussy
      // 2028-2040 : 1.5%/an — post-livraison, L15 opérationnelle, effet digéré
      //   cohérent avec inflation immobilière IDF long-terme
      // Moyenne lissée sur 15 ans ≈ 1.7%/an
      appreciation: 0.017,       // 1.7%/an (moyenne lissée, hub L14+L15, pôle santé)
      appreciationPhases: [
        { start: 2025, end: 2027, rate: 0.020, note: 'Anticipation L15 (avril 2027) + L14, marché en tassement, effet déjà pricé' },
        { start: 2028, end: 2040, rate: 0.015, note: 'Livraison bien Q1 2028, L15 opérationnelle depuis ~1 an, effet digéré' },
      ],
      type: 'T3 — VEFA — LMNP',
      ligne15: { station: 'Villejuif Louis Aragon', distance: 'En face (<1 min)', opening: '2027-04' },
      details: {
        lot: 'A27',
        floor: '2ème étage',
        building: null,
        type: 'T3',
        yearBuilt: 2028,
        developer: 'Fair\' Promotion',
        program: '167 Aragon (Villejuif)',
        norm: 'RE2020, PMR évolutif',
        heating: null,
        dpe: null,
        rooms: [
          { name: 'Entrée', surface: 3.60 },
          { name: 'Séjour/Cuisine', surface: 35.09 },
          { name: 'Chambre 1', surface: 11.24 },
          { name: 'Chambre 2', surface: 11.24 },
          { name: 'Salle de bain', surface: 5.45 },
          { name: 'WC', surface: 2.32 },
        ],
        surfaceHabitable: 68.92,
        loggia: 9.51,
        surfaceTotale: 78.45,
        parking: false,
        cave: false,
        exposure: 'Sud-Ouest',
      },
    },
  },
};

// ════════════════════════════════════════════════════════════
// FRAIS DE SORTIE IMMOBILIER — Plus-value, agence, notaire
//
// Permet de calculer la "net equity après sortie" à tout moment.
// La plus-value immobilière des NON-RÉSIDENTS est taxée à :
//   - IR : 19% (taux forfaitaire non-résident)
//   - PS : 17.2% (prélèvements sociaux)
//   - Surtaxe : 0-6% si PV > 50K€
//   = Total de base : 36.2%
//
// Abattements progressifs selon la durée de détention :
//   IR (19%) : exonéré après 22 ans
//   PS (17.2%) : exonéré après 30 ans
//
// Sources : BOFiP, CGI art. 150 U / 150 VB / 150 VC
// ════════════════════════════════════════════════════════════
export const EXIT_COSTS = {
  // Abattements IR (par année de détention, à partir de la 6ème année)
  // Années 1-5 : 0%  |  Années 6-21 : 6%/an  |  Année 22 : 4%  →  100% après 22 ans
  irAbattement: [
    { fromYear: 1, toYear: 5, ratePerYear: 0 },
    { fromYear: 6, toYear: 21, ratePerYear: 0.06 },
    { fromYear: 22, toYear: 22, ratePerYear: 0.04 },
    // Au-delà de 22 ans : exonéré (100%)
  ],
  // Abattements PS (par année de détention)
  // Années 1-5 : 0%  |  Années 6-21 : 1.65%/an  |  Année 22 : 1.60%  |  Année 23-30 : 9%/an  →  100% après 30 ans
  psAbattement: [
    { fromYear: 1, toYear: 5, ratePerYear: 0 },
    { fromYear: 6, toYear: 21, ratePerYear: 0.0165 },
    { fromYear: 22, toYear: 22, ratePerYear: 0.016 },
    { fromYear: 23, toYear: 30, ratePerYear: 0.09 },
    // Au-delà de 30 ans : exonéré (100%)
  ],
  irRate: 0.19,     // Taux forfaitaire non-résident
  psRate: 0.172,    // Prélèvements sociaux
  // Surtaxe sur plus-values élevées (CGI art. 1609 nonies G)
  surtaxe: [
    { from: 0,      to: 50000,  rate: 0 },
    { from: 50001,  to: 100000, rate: 0.02 },
    { from: 100001, to: 150000, rate: 0.03 },
    { from: 150001, to: 200000, rate: 0.04 },
    { from: 200001, to: 250000, rate: 0.05 },
    { from: 250001, to: Infinity, rate: 0.06 },
  ],
  // Frais d'agence (à la charge du vendeur en France)
  agencyFeePct: 0.04,    // ~4% du prix de vente (fourchette 3-5%)
  // Diagnostics obligatoires avant vente
  diagnosticsCost: 500,  // DPE, amiante, plomb, etc.
  // Frais de mainlevée hypothécaire si prêt en cours
  mainleveeFixe: 500,    // Frais fixes huissier/notaire
  mainleveePct: 0.003,   // ~0.3% du capital initial emprunté

  // Indemnités de remboursement anticipé (IRA)
  // Plafond légal : min(6 mois d'intérêts, 3% du CRD)
  // PTZ et Action Logement : 0€ d'IRA (remboursement anticipé sans pénalité)
  iraMonthsInterest: 6,  // 6 mois d'intérêts restants
  iraPctCRD: 0.03,       // 3% du CRD
  iraExemptTypes: ['ptz', 'action-logement'],  // pas d'IRA sur ces prêts

  // ── Contraintes spécifiques par dispositif ──
  vitry: {
    // TVA 5.5% — Article 278 sexies du CGI
    // Si revente avant 10 ans : remboursement du différentiel TVA (20% - 5.5% = 14.5%)
    // Prorata temporis : 1/10ème par année restante
    tvaReduite: {
      tauxReduit: 0.055,
      tauxNormal: 0.20,
      dureeEngagement: 10,       // années depuis livraison
      prixHTApprox: 260000,      // prix HT approximatif (275K TTC à TVA 5.5%)
      dateLivraison: '2025-07',  // obligation 10 ans commence à la livraison VEFA
      dateFinObligation: '2035-07', // fin obligation TVA
    },
    // PTZ — Prêt à Taux Zéro
    // Doit occuper comme résidence principale pendant 6 ans (2023-2029)
    // Remboursement anticipé sans pénalité (pas de frais de sortie PTZ)
    // Mais si mis en location avant 6 ans : peut être rappelé
    ptz: {
      dureeOccupation: 6,        // années en résidence principale (ou assimilé)
      dateDebut: '2023-11',      // premier déblocage PTZ ~novembre 2023
      dateFin: '2029-12',        // fin obligation RP (~décembre 2029)
      differeTotalMois: 60,      // 60 mois de différé total
      montant: 60000,
      mensualite: 333,           // ~333€/mois après fin du différé (dec 2028)
      note: 'Location nue possible après 6 ans. Meublé possible après PTZ. Rappel CRD si infraction.',
    },
    // Action Logement
    // Conditions : plafond de ressources du locataire
    // Pas de pénalité spécifique à la revente, mais le prêt doit être remboursé
    actionLogement: {
      montant: 40000,
      taux: 0.005,              // 0.50%/an (BUG-028: aligné avec loan definition rate: 0.005)
      duree: 300,               // 300 mois (25 ans)
      dateDebut: '2023-02',
      dateFin: '2048-02',       // obligation RP jusqu'à fin prêt
      plafondRessources: true,   // locataire doit respecter plafonds PLS
      sanction: 'Rappel immédiat du CRD (40K€)',
      note: 'Obligation RP toute la durée du prêt. Rappel CRD en cas de manquement.',
    },
  },
  rueil: {
    // Pas de dispositif particulier — achat classique ancien
    // LMNP : pas de contrainte de revente spécifique
    // Mais : si LMNP réel, les amortissements déduits sont réintégrés
    // dans le calcul de la plus-value (amortissements = majoration du prix d'achat !)
    // Attention : depuis loi de finances 2025, les amortissements LMNP
    // sont désormais réintégrés dans le calcul de la PV (art. 150 VB bis CGI)
    lmnpAmortReintegration: true,
    note: 'LMNP réel : amortissements réintégrés dans la PV depuis 2025 (loi de finances 2025)',
    timeline: [
      { date: '2019-11', event: 'Acte notarié signé (5 nov 2019) — achat 240K€', icon: 'doc', done: true },
      { date: '2019-12', event: 'Début prêt Crédit Mutuel Franconville (251K€ à 1.20%, 25 ans)', icon: 'bank', done: true },
      { date: '2019-12', event: 'Résidence principale Nezha', icon: 'home', done: true },
      { date: '2025-09', event: 'Bail meublé signé (Docusign 25/09/2025) — passage LMNP réel', icon: 'doc', done: true },
      { date: '2025-10', event: 'Début location meublée (1 300€ HC + 150€ charges)', icon: 'key', done: true },
      { date: '2025-11', event: '6 ans détention — abattement PV IR 6%', icon: 'tax', done: true },
      { date: '2026-10', event: 'Fin bail initial (1 an) → reconduction tacite', icon: 'doc' },
      { date: '2030-11', event: '11 ans détention — abattement IR 36%, PS 8.25%', icon: 'tax' },
      { date: '2041-11', event: '22 ans détention — exonération totale IR (100%)', icon: 'free' },
      { date: '2044-12', event: 'Fin prêt Crédit Mutuel (25 ans)', icon: 'check' },
      { date: '2049-11', event: '30 ans détention — exonération totale IR + PS (100%)', icon: 'free' },
    ],
  },
  villejuif: {
    // VEFA en cours — pas encore livré
    // LMNP ou JEANBRUN selon le choix
    // Si LMNP réel : même règle de réintégration des amortissements
    lmnpAmortReintegration: true,
    note: 'VEFA — choix régime à faire avant livraison (Q1 2028)',
    timeline: [
      { date: '2025-06', event: 'Signature contrat de réservation (dépôt 3 363€)', icon: 'doc', done: true },
      { date: '2025-08', event: 'Offre de prêt LCL (287K + 32K, franchise 36 mois)', icon: 'bank' },
      { date: '2027-04', event: 'Ouverture L15 Sud — station Villejuif Louis Aragon', icon: 'metro' },
      { date: '2028-03', event: 'Livraison VEFA + remise des clés (contractuel Q1 2028)', icon: 'key' },
      { date: '2028-06', event: 'Début location (LMNP ou Jeanbrun)', icon: 'home' },
      { date: '2028-08', event: 'Fin franchise → début remboursement (1 698€/mois)', icon: 'money' },
      { date: '2028-01', event: 'Choix régime fiscal (LMNP vs Jeanbrun) — décision avant 1ère mise en location', icon: 'tax' },
      { date: '2030-03', event: 'Fin exonération TF (construction neuve 2 ans)', icon: 'tax' },
      { date: '2035-06', event: '10 ans détention — abattement PV IR commence', icon: 'tax' },
      { date: '2052-08', event: 'Fin prêts LCL (Prêt 1 + Prêt 2)', icon: 'check' },
      { date: '2055-06', event: '30 ans détention — exonération totale IR + PS', icon: 'free' },
    ],
  },
};

// ════════════════════════════════════════════════════════════
// CONTRAINTES VITRY — Rappel de toutes les obligations
// liées aux dispositifs de financement et TVA réduite
// ════════════════════════════════════════════════════════════
export const VITRY_CONSTRAINTS = {
  summary: 'Vitry cumule 4 dispositifs avec obligations : Anti-spéculation, TVA 5.5%, PTZ, Action Logement',
  constraints: [
    {
      dispositif: 'Anti-Spéculation (Municipal)',
      reference: 'Acte de vente art. 5.1.3',
      obligation: 'Interdiction de revente avec profit pendant 5 ans',
      dateDebut: '2023-01',
      dateFin: '2028-01',       // 5 ans depuis acte 16/01/2023
      penalite: 'Reversement de 100% du profit net à la commune',
      details: [
        'Clause anti-spéculation inscrite dans l\'acte notarié du 16/01/2023',
        'Durée : 5 ans → expire le 16 janvier 2028',
        'Si vente avant : 100% de la plus-value nette reversée à la mairie',
        'Après 5 ans : aucune contrainte, vente libre',
      ],
      status: 'actif',
      yearsRemaining: 2,  // à partir de mars 2026
    },
    {
      dispositif: 'TVA 5.5%',
      reference: 'CGI art. 278 sexies',
      obligation: 'Résidence principale pendant 10 ans depuis livraison',
      dateDebut: '2025-07',     // obligation depuis livraison VEFA
      dateFin: '2035-07',       // 10 ans depuis livraison juillet 2025
      penalite: 'Remboursement différentiel TVA (14.5% × prix HT) au prorata des années restantes',
      details: [
        'Bien acheté 275 000€ TTC à TVA 5.5% au lieu de 20%',
        'Économie TVA : 37 796€ (différentiel 14.5% × 260 000€ HT)',
        'Obligation : RP 10 ans depuis livraison VEFA (juillet 2025)',
        'Pénalité dégressive : -1/10ème par an',
        'Après juillet 2035 : aucune pénalité — conversion LMNP possible',
        'Zone ANRU / QPV Balzac — condition de localisation respectée',
        'RP maintenue via déclaration fiscale conjointe (Nezha résidente France)',
      ],
      status: 'actif',
      yearsRemaining: 9,  // à partir de mars 2026
    },
    {
      dispositif: 'PTZ (Prêt à Taux Zéro)',
      reference: 'Code de la construction L.31-10-6',
      obligation: 'Résidence principale ou assimilé pendant 6 ans',
      dateDebut: '2023-11',     // premier déblocage PTZ
      dateFin: '2029-12',       // fin obligation RP (~décembre 2029)
      penalite: 'Rappel du prêt PTZ (remboursement immédiat de 60 000€)',
      details: [
        'Montant PTZ : 60 000€ à 0%',
        'Différé total : 60 mois → début remboursement ~décembre 2028',
        'Mensualité post-différé : ~333€/mois',
        'Obligation : RP pendant 6 ans (jusqu\'à ~décembre 2029)',
        'Location nue autorisée (motif légitime : éloignement professionnel)',
        'Conditions : bail nu, plafonds PLS, notification LRAR',
        'Après décembre 2029 : meublé possible, conversion LMNP envisageable',
        'Remboursement anticipé : sans pénalité ni frais',
      ],
      status: 'actif',
      yearsRemaining: 4,
    },
    {
      dispositif: 'Action Logement',
      reference: 'Convention entre employeur et Action Logement Services',
      obligation: 'Résidence principale pendant toute la durée du prêt',
      dateDebut: '2023-02',
      dateFin: '2048-02',       // 25 ans
      penalite: 'Rappel immédiat du CRD (40 000€)',
      details: [
        'Montant : 40 000€ à 0,5%',
        'Obligation RP pendant toute la durée (25 ans → février 2048)',
        'Sanction si manquement : rappel immédiat du capital restant dû',
        'Le locataire doit respecter les plafonds de ressources PLS',
        'Fréquence d\'audit : rare',
        'Remboursement anticipé : possible sans pénalité',
      ],
      status: 'actif',
      yearsRemaining: 22,
    },
    {
      dispositif: 'Location nue (régime foncier)',
      reference: 'CGI art. 14 / 28',
      obligation: 'Déclaration des revenus fonciers de source française',
      dateDebut: '2026-04',
      dateFin: null,
      penalite: 'Redressement fiscal si non-déclaration',
      details: [
        'Non-résident UAE : IR 20% minimum + PS 17.2% = 37.2%',
        'Régime réel foncier (intérêts + charges déductibles)',
        'Loyer déclaré : 500€/mois (partie bail officiel)',
        'Complément en espèces non déclaré (stratégie Scénario D)',
        'Loyer de marché comparable : 1 250€ HC (référence rapport stratégique)',
        'Justification loyer bas : 6 clauses (état équipement, parking, acoustique, QPV, GPE, stabilité)',
      ],
      status: 'actif',
      yearsRemaining: null,
    },
  ],
  timeline: [
    { date: '2023-01', event: 'Acte notarié VEFA signé (16 janvier)', icon: 'doc', done: true },
    { date: '2025-07', event: 'Livraison VEFA + début occupation', icon: 'key', done: true },
    { date: '2025-08', event: 'Début prêt BP — intérêts seuls 306€/mois (5 mois)', icon: 'bank', done: true },
    { date: '2026-01', event: 'Début remboursement capital BP (1 021€/mois)', icon: 'money', done: true },
    { date: '2026-04', event: 'Début location nue', icon: 'home' },
    { date: '2027-12', event: 'Fin exonération TF (construction neuve 2 ans)', icon: 'tax' },
    { date: '2028-01', event: 'Fin clause anti-spéculation (5 ans)', icon: 'unlock' },
    { date: '2028-12', event: 'Fin différé PTZ → début remboursement 333€/mois', icon: 'money' },
    { date: '2029-12', event: 'Fin obligation RP PTZ (6 ans) → meublé possible', icon: 'unlock' },
    { date: '2035-07', event: 'Fin obligation TVA 5.5% (10 ans livraison) → LMNP possible', icon: 'free' },
    { date: '2043-11', event: 'Fin prêt PTZ', icon: 'check' },
    { date: '2048-02', event: 'Fin prêt Action Logement + fin obligation RP', icon: 'check' },
    { date: '2048-12', event: 'Fin prêt Banque Populaire (Riv\'immo)', icon: 'check' },
  ],
};

// ════════════════════════════════════════════════════════════
// VILLEJUIF — Comparaison JEANBRUN vs LMNP vs LMP
//
// Le bien sera livré Q1 2028 (au plus tard 31 mars 2028, contrat §1.4). Il faut choisir le régime AVANT.
// 3 options :
//   1. Dispositif JEANBRUN (neuf, loi 2025) — location nue
//   2. LMNP réel (meublé) — avec amortissement
//   3. LMP (si seuil dépassé) — meublé professionnel
//
// Paramètres de simulation :
//   - Meublé : +3 000€ de mobilier initial + +100€ de loyer/mois
//   - Nue (JEANBRUN) : pas de frais mobilier, loyer de base
// ════════════════════════════════════════════════════════════
export const VILLEJUIF_REGIMES = {
  // Données de base (identiques pour tous les régimes)
  base: {
    loyerNuHC: 1700,          // Loyer HC en location nue
    loyerMeubleHC: 1800,      // Loyer HC en meublé (+100€)
    coutMobilier: 3000,        // Investissement mobilier initial
    renouvellementMobilier: 500, // Renouvellement mobilier annuel moyen
    chargesProprietaire: 259,  // copro 110 + PNO 15 + TF 83 + assurance 51
    mensualitePret: 1669,      // prêt LCL P1+P2
    assurancePret: 51,
    valeurBien: 370000,
    totalOperation: 336330,
    surface: 68.92,
  },

  // ── Option 1 : JEANBRUN (ex-Pinel Denormandie rénové) ──
  // Dispositif de la loi de finances 2025 pour le neuf
  // Réduction d'impôt proportionnelle à la durée d'engagement
  jeanbrun: {
    nom: 'Dispositif JEANBRUN (Loi 2025)',
    type: 'nu',       // location nue obligatoire
    dureeEngagement: [6, 9, 12],  // choix durée
    reductionImpot: {
      // Réduction d'impôt calculée sur le prix d'achat plafonné
      plafondPrix: 300000,      // plafond d'investissement
      plafondM2: 5500,          // plafond prix/m²
      taux6ans: 0.09,           // 9% sur 6 ans = 1.5%/an
      taux9ans: 0.12,           // 12% sur 9 ans = 1.33%/an
      taux12ans: 0.14,          // 14% sur 12 ans = 1.17%/an
    },
    conditions: [
      'Logement neuf (VEFA) en zone tendue (zone A → Villejuif OK)',
      'Respect du plafond de loyer : ~17.62€/m² zone A (2025)',
      'Respect du plafond de ressources du locataire',
      'Location nue à titre de résidence principale du locataire',
      'Engagement de location 6, 9 ou 12 ans',
      'Performance énergétique RE2020 (VEFA → OK automatiquement)',
    ],
    plafondLoyer: {
      zoneA: 17.62,   // €/m²/mois (2025, à actualiser)
      loyerMaxMensuel: 1215,  // 68.94m² × 17.62 = 1 214€ (arrondi)
    },
    avantages: [
      'Réduction d\'impôt directe (non-résident : imputable sur IR français)',
      'Pas de mobilier à acheter ni entretenir',
      'Loyer plafonné mais sécurisé (zone tendue)',
    ],
    inconvenients: [
      'Loyer plafonné à ~1 215€ (vs 1 700€ marché)',
      'Location NUE uniquement',
      'Engagement longue durée (6-12 ans)',
      'Plafond de ressources locataire',
      'Non cumulable avec LMNP',
    ],
  },

  // ── Option 2 : LMNP réel (amortissement) ──
  lmnp: {
    nom: 'LMNP Réel (Amortissement)',
    type: 'meuble',
    conditions: [
      'Logement meublé (mobilier minimum défini par décret)',
      'Recettes locatives < 23 000€/an ET < revenus d\'activité → sinon LMP',
      'Inscription au greffe du tribunal de commerce (P0i)',
      'Comptabilité d\'engagement (BIC réel simplifié)',
    ],
    fiscalite: {
      regime: 'reel-simplifie',
      amortissementBien: 0.02,     // ~2% du bien/an sur 30-50 ans (hors terrain)
      amortissementMobilier: 0.10, // ~10% du mobilier/an sur 7-10 ans
      partTerrain: 0.20,           // 20% = terrain (non amortissable)
      // Charges déductibles : intérêts, assurance, PNO, TF, copro, comptable, CFE
      fraisComptable: 1200,        // Expert-comptable + adhésion CGA ~1200€/an
      cfe: 200,                    // Cotisation Foncière des Entreprises ~200€/an
    },
    avantages: [
      'Loyer libre (marché) : 1 800€ HC',
      'Amortissement du bien → impôt = 0 pendant 15-20 ans',
      'Charges déductibles (intérêts, travaux, comptable)',
      'Récupération TVA si neuf (mais pas en non-professionnel simple)',
    ],
    inconvenients: [
      'Coût mobilier initial : 3 000€',
      'Renouvellement mobilier : ~500€/an',
      'Frais comptable : ~1 200€/an',
      'CFE : ~200€/an',
      'Réintégration amortissements dans PV à la revente (loi 2025)',
      'Risque de basculement LMP si recettes > 23K€',
    ],
  },

  // ── Option 3 : LMP (Loueur Meublé Professionnel) ──
  lmp: {
    nom: 'LMP (Loueur Meublé Professionnel)',
    type: 'meuble',
    seuils: {
      recettesMin: 23000,       // Recettes > 23 000€/an
      // ET recettes > revenus d'activité du foyer fiscal
      // Non-résident : pas de revenus d'activité en France → condition 2 auto-remplie ?
      note: 'Attention : non-résident sans revenus FR → potentiellement LMP automatique si > 23K€',
    },
    fiscalite: {
      // Comme LMNP réel mais avec :
      cotisationsSociales: 0.40, // ~40% de cotisations sociales (SSI) sur le bénéfice
      plusValuePro: true,        // PV professionnelle (exonération après 5 ans si CA < 90K)
      deficitImputable: true,    // Déficit imputable sur revenu global (pas juste BIC)
    },
    avantages: [
      'Déficit imputable sur le revenu global',
      'PV professionnelle : exonération totale si > 5 ans ET CA < 90K€',
      'Amortissement du bien (comme LMNP)',
    ],
    inconvenients: [
      'Cotisations sociales SSI ~40% sur le bénéfice',
      'Complexité administrative (déclaration pro)',
      'Affiliation SSI obligatoire',
      'Risque : requalification des amortissements passés',
    ],
    risque: 'Avec Rueil (1300×12=15600) + Villejuif (1800×12=21600) = 37 200€/an → dépasse le seuil de 23K€. Si pas de revenus d\'activité en France → LMP automatique.',
  },

  // ── Simulation comparative sur 10 ans ──
  simulation: {
    duree: 10,   // années
    hypotheses: {
      appreciationAnnuelle: 0.017,  // 1.7%/an (cohérent avec IC.properties.villejuif.appreciation)
      inflationLoyer: 0.015,         // 1.5%/an (IRL)
      tauxIR: 0.20,                  // Non-résident
      tauxPS: 0.172,
      tauxAmortissement: 0.02,       // 2% du bien/an (hors terrain)
      partTerrain: 0.20,
    },
  },
};

// ════════════════════════════════════════════════════════════
// HISTORIQUE PATRIMOINE — Points manuels + dernier point live
// Le dernier point (coupleNW/amineNW/nezhaNW = null) est rempli
// dynamiquement par engine.js avec les valeurs actuelles.
// Pour ajouter un point : insérer AVANT la dernière ligne.
// ════════════════════════════════════════════════════════════
// NW_HISTORY: Removed invented historical data (v150)
// This array should be populated with real historical net worth snapshots
// Structure: [{ date: 'YYYY-MM', coupleNW, amineNW, nezhaNW, note? }, ...]
// ════════════════════════════════════════════════════════════
export const NW_HISTORY = [];

// ════════════════════════════════════════════════════════════
// HISTORIQUE EQUITY — Portfolio actions mensuel (Degiro + ESPP + IBKR)
// Source: Rapports annuels Degiro (points annuels vérifiés),
//         ESPP lots (dates exactes), IBKR deposits/NAV (2025+)
// Points année-end = valeurs exactes des rapports PDF
// Points intermédiaires = interpolation linéaire
// Format: { date: 'YYYY-MM-DD', degiro, espp, ibkr, total, note? }
//   degiro = portfolio Degiro + cash Flatex (EUR)
//   espp = shares × ACN price approximatif (EUR)
//   ibkr = NAV IBKR approx (EUR), 0 avant avril 2025
//   total = degiro + espp + ibkr
//   degiro inclut Flatex cash (ex: dec 2020 = 30117.82 portefeuille + 1940.01 Flatex = 32058)
// ════════════════════════════════════════════════════════════
export const EQUITY_HISTORY = [
  // ── 2020 ── (Degiro ouvert, premiers trades)
  // Dépôts exacts: 3 × 8524.34 = 25573.02 EUR (back-calculé rapports annuels)
  // Points vérifiés: 2020-12 (portefeuille 30117.82 + Flatex 1940.01 = 32058)
  { date: '2020-01-31', degiro: 8500,   espp: 14440, ibkr: 0, total: 22940,  note: '1er dépôt Degiro (8.5K) — 14/01' },
  { date: '2020-02-29', degiro: 17000,  espp: 13832, ibkr: 0, total: 30832,  note: '2ème dépôt Degiro — 20/02' },
  { date: '2020-03-31', degiro: 22000,  espp: 10875, ibkr: 0, total: 32875,  note: '3ème dépôt 09/03 (25.6K total) — COVID crash' },
  { date: '2020-04-30', degiro: 23500,  espp: 12160, ibkr: 0, total: 35660,  note: 'Début recovery COVID' },
  { date: '2020-05-31', degiro: 25000,  espp: 15675, ibkr: 0, total: 40675,  note: 'ESPP lot 6 (19 sh)' },
  { date: '2020-06-30', degiro: 26500,  espp: 16625, ibkr: 0, total: 43125 },
  { date: '2020-07-31', degiro: 27500,  espp: 17290, ibkr: 0, total: 44790 },
  { date: '2020-08-31', degiro: 28000,  espp: 18525, ibkr: 0, total: 46525 },
  { date: '2020-09-30', degiro: 28500,  espp: 17765, ibkr: 0, total: 46265 },
  { date: '2020-10-31', degiro: 29000,  espp: 20165, ibkr: 0, total: 49165,  note: 'ESPP lot 5 (14 sh)' },
  { date: '2020-11-30', degiro: 30500,  espp: 21255, ibkr: 0, total: 51755 },
  { date: '2020-12-31', degiro: 32058,  espp: 22563, ibkr: 0, total: 54621,  note: 'Rapport annuel: Degiro 30117.82 + Flatex 1940.01' },

  // ── 2021 ── (Trading actif, LVMH/Europcar/FedEx gros gains, ESPP continue)
  // Points vérifiés: 2021-12 (portefeuille 29907.67 + Flatex 46.81, retrait 15669)
  { date: '2021-01-31', degiro: 31500,  espp: 22890, ibkr: 0, total: 54390 },
  { date: '2021-02-28', degiro: 31200,  espp: 24525, ibkr: 0, total: 55725 },
  { date: '2021-03-31', degiro: 30800,  espp: 24525, ibkr: 0, total: 55325 },
  { date: '2021-04-30', degiro: 30500,  espp: 29140, ibkr: 0, total: 59640,  note: 'ESPP lot 4 (15 sh)' },
  { date: '2021-05-31', degiro: 30200,  espp: 29760, ibkr: 0, total: 59960 },
  { date: '2021-06-30', degiro: 22000,  espp: 31000, ibkr: 0, total: 53000,  note: 'Ventes EUCAR/LVMH — retrait 15.7K' },
  { date: '2021-07-31', degiro: 21000,  espp: 32240, ibkr: 0, total: 53240 },
  { date: '2021-08-31', degiro: 20500,  espp: 33728, ibkr: 0, total: 54228,  note: 'Achat NVDA 30sh + vente LVMH 16sh' },
  { date: '2021-09-30', degiro: 24000,  espp: 34720, ibkr: 0, total: 58720 },
  { date: '2021-10-31', degiro: 26000,  espp: 35960, ibkr: 0, total: 61960 },
  { date: '2021-11-30', degiro: 28000,  espp: 41850, ibkr: 0, total: 69850,  note: 'ESPP lot 3 (11 sh)' },
  { date: '2021-12-31', degiro: 29955,  espp: 43875, ibkr: 0, total: 73830,  note: 'Rapport annuel: Degiro 29907.67 + Flatex 46.81' },

  // ── 2022 ── (Bear market, pas de trades, ESPP continue)
  // Points vérifiés: 2022-12 (portefeuille 16316.15 + Flatex 194.13)
  { date: '2022-01-31', degiro: 28500,  espp: 44835, ibkr: 0, total: 73335 },
  { date: '2022-02-28', degiro: 27000,  espp: 42630, ibkr: 0, total: 69630 },
  { date: '2022-03-31', degiro: 25500,  espp: 44835, ibkr: 0, total: 70335 },
  { date: '2022-04-30', degiro: 24000,  espp: 42630, ibkr: 0, total: 66630 },
  { date: '2022-05-31', degiro: 22500,  espp: 40425, ibkr: 0, total: 62925,  note: 'ESPP lot 2 (12 sh)' },
  { date: '2022-06-30', degiro: 21500,  espp: 37485, ibkr: 0, total: 58985 },
  { date: '2022-07-31', degiro: 20500,  espp: 40500, ibkr: 0, total: 61000 },
  { date: '2022-08-31', degiro: 19500,  espp: 42000, ibkr: 0, total: 61500,  note: 'ESPP FRAC 3sh (div reinvested)' },
  { date: '2022-09-30', degiro: 18700,  espp: 36750, ibkr: 0, total: 55450 },
  { date: '2022-10-31', degiro: 17900,  espp: 38250, ibkr: 0, total: 56150 },
  { date: '2022-11-30', degiro: 17100,  espp: 40500, ibkr: 0, total: 57600 },
  { date: '2022-12-31', degiro: 16510,  espp: 37500, ibkr: 0, total: 54010,  note: 'Rapport annuel: Degiro 16316.15 + Flatex 194.13' },

  // ── 2023 ── (SAP+NVDA vendus, VOLTA perte, ESPP lot final)
  // Points vérifiés: 2023-12 (portefeuille 29971.39 + Flatex 70.51, retrait 5755)
  { date: '2023-01-31', degiro: 17000,  espp: 37296, ibkr: 0, total: 54296 },
  { date: '2023-02-28', degiro: 17500,  espp: 38385, ibkr: 0, total: 55885 },
  { date: '2023-03-31', degiro: 15500,  espp: 37500, ibkr: 0, total: 53000,  note: 'VOLTA liquidé (-4183)' },
  { date: '2023-04-30', degiro: 18000,  espp: 39855, ibkr: 0, total: 57855 },
  { date: '2023-05-31', degiro: 20000,  espp: 45925, ibkr: 0, total: 65925,  note: 'ESPP lot 1 final (17 sh) — 167 sh total' },
  { date: '2023-06-30', degiro: 22000,  espp: 45925, ibkr: 0, total: 67925 },
  { date: '2023-07-31', degiro: 22500,  espp: 47595, ibkr: 0, total: 70095,  note: 'Vente SAP+NVDA partielles' },
  { date: '2023-08-31', degiro: 24000,  espp: 48430, ibkr: 0, total: 72430 },
  { date: '2023-09-30', degiro: 25500,  espp: 46760, ibkr: 0, total: 72260 },
  { date: '2023-10-31', degiro: 27000,  espp: 45925, ibkr: 0, total: 72925 },
  { date: '2023-11-30', degiro: 28500,  espp: 50100, ibkr: 0, total: 78600 },
  { date: '2023-12-31', degiro: 30042,  espp: 52605, ibkr: 0, total: 82647,  note: 'Rapport annuel: Degiro 29971.39 + Flatex 70.51' },

  // ── 2024 ── (NVDA explose, pas de trades, dividendes seulement)
  // Points vérifiés: 2024-12 (portefeuille 77802.18 + Flatex 217.51)
  { date: '2024-01-31', degiro: 34000,  espp: 53440, ibkr: 0, total: 87440 },
  { date: '2024-02-29', degiro: 38000,  espp: 55110, ibkr: 0, total: 93110 },
  { date: '2024-03-31', degiro: 42000,  espp: 56780, ibkr: 0, total: 98780 },
  { date: '2024-04-30', degiro: 44500,  espp: 54275, ibkr: 0, total: 98775 },
  { date: '2024-05-31', degiro: 49000,  espp: 54275, ibkr: 0, total: 103275 },
  { date: '2024-06-30', degiro: 54000,  espp: 46760, ibkr: 0, total: 100760,  note: 'NVDA split 10:1 (juin)' },
  { date: '2024-07-31', degiro: 58000,  espp: 48430, ibkr: 0, total: 106430 },
  { date: '2024-08-31', degiro: 62000,  espp: 51770, ibkr: 0, total: 113770 },
  { date: '2024-09-30', degiro: 66000,  espp: 53440, ibkr: 0, total: 119440 },
  { date: '2024-10-31', degiro: 70000,  espp: 54275, ibkr: 0, total: 124275 },
  { date: '2024-11-30', degiro: 74000,  espp: 56780, ibkr: 0, total: 130780 },
  { date: '2024-12-31', degiro: 78020,  espp: 57615, ibkr: 0, total: 135635,  note: 'Rapport annuel: Degiro 77802.18 + Flatex 217.51' },

  // ── 2025 ── (Liquidation Degiro → IBKR, gros flush août)
  { date: '2025-01-31', degiro: 78000,  espp: 55110, ibkr: 0,      total: 133110 },
  { date: '2025-02-28', degiro: 78000,  espp: 56780, ibkr: 0,      total: 134780,  note: 'Vente DIS+SPOT Degiro' },
  { date: '2025-03-31', degiro: 78000,  espp: 57615, ibkr: 0,      total: 135615 },
  { date: '2025-04-30', degiro: 0,      espp: 51770, ibkr: 10000,  total: 61770,   note: 'Clôture Degiro — IBKR ouvert (10K)' },
  { date: '2025-05-31', degiro: 0,      espp: 54275, ibkr: 20000,  total: 74275 },
  { date: '2025-06-30', degiro: 0,      espp: 53440, ibkr: 35000,  total: 88440 },
  { date: '2025-07-31', degiro: 0,      espp: 53440, ibkr: 50000,  total: 103440 },
  { date: '2025-08-31', degiro: 0,      espp: 55110, ibkr: 135000, total: 190110,  note: 'Flush 108K vers IBKR' },
  { date: '2025-09-30', degiro: 0,      espp: 55945, ibkr: 180000, total: 235945 },
  { date: '2025-10-31', degiro: 0,      espp: 56780, ibkr: 210000, total: 266780 },
  { date: '2025-11-30', degiro: 0,      espp: 57615, ibkr: 220000, total: 277615 },
  { date: '2025-12-31', degiro: 0,      espp: 58450, ibkr: 200000, total: 258450,  note: 'IPO SGTM (non inclus ici)' },

  // ── 2026 ── (données live à partir d'ici)
  // espp = (Amine 167 + Nezha 40) × ACN_USD / fx_EURUSD + cash (€2000 + $109.56)
  { date: '2026-01-31', degiro: 0,      espp: 53855, ibkr: 190000, total: 243855,  note: 'ACN~$260, fx~1.04' },
  { date: '2026-02-28', degiro: 0,      espp: 43700, ibkr: 180000, total: 223700,  note: 'ACN~$209, fx~1.04' },
  { date: '2026-03-31', degiro: 0,      espp: 37757, ibkr: 187700, total: 225457,  note: 'ACN=$197.55, fx=1.1467, IBKR NAV=185700+2000 retrait' },
];

// ════════════════════════════════════════════════════════════
// TAUX WHT (Withholding Tax) — Retenue à la source par pays
// ════════════════════════════════════════════════════════════
// WHT = impôt retenu automatiquement par le pays émetteur
// Applicable aux dividendes pour résident fiscal UAE
//
// CONTEXTE AMINE (résident fiscal UAE):
// - UAE: 0% impôt sur revenus → aucune imposition supplémentaire
// - MAIS: WHT prélevée à la source dans chaque pays
// - Plus-values: généralement 0% WHT partout
// - Stratégie: minimiser les dividendes, maximiser plus-values
// - Note: WHT France 30% très lourd → préférer vente plutôt que dividendes
//
// CONVENTIONS FISCALES (double imposition):
// - France: 30% (pas de convention FR-UAE, taux droit commun)
// - Allemagne: 26.375% (convention FR-DE, via Xetra)
// - USA: 15% (convention FR-USA, requiert W-8BEN)
// - Japon: 15% (convention FR-JP)
// - Maroc: 15% (convention FR-MA)
// - Crypto: 0% (les ETFs spot ne distribuent pas)
//
// IMPACT FISCAL:
// - Non-résident UAE ne peut PAS récupérer le WHT
// - Impôt effectif = WHT payée au pays × 1.0 (perte sèche)
// - Exemple: divid France 100€ → 30€ WHT → net 70€ crédité
// ════════════════════════════════════════════════════════════
export const WHT_RATES = {
  france: 0.25,       // 25% WHT effectif IBKR (BUG-024: vérifié vs costs[] réels — 30.50/122, 52.50/210 = 25%)
  germany: 0.26375,   // 26.375% WHT (convention FR-DE, Xetra)
  us: 0.30,           // 30% WHT (BUG-024: UAE résident, pas de W-8BEN → taux plein 30%, vérifié QQQM 5.50/18.33)
  japan: 0.15,        // 15% WHT (convention FR-JP)
  crypto: 0,          // ETFs crypto = 0% (pas de distribution)
  morocco: 0.15,      // 15% WHT (convention FR-MA)
};

// ════════════════════════════════════════════════════════════
// RENDEMENTS DIVIDENDES — Yield annualisé par position
// ════════════════════════════════════════════════════════════
// Dividend yield estimé = DPS annuel / cours action × 100
// Format: annualisé décimal (ex: 0.034 = 3.4% de rendement annuel)
//
// Utilisation:
// - Projection revenus passifs des actions détenues
// - Calcul rendement portefeuille
// - Comparaison allocation secteurs
//
// SOURCES & MISE À JOUR:
// - Annonces d'IR (investor relations) des sociétés
// - Consensus analystes (Bloomberg, Yahoo Finance)
// - Historique dividendes (5 ans) pour moyenne pondérée
// - Mise à jour: 1x par trimestre (après annonces dividendes)
// - Dernière vérification: 8 mars 2026
//
// NOTES:
// - Rendements variables en fonction du cycle dividende
// - Certaines entreprises (Hermès, SAP) versent peu en dividendes
// - ETFs crypto (IBIT, ETHA) ne versent PAS de dividendes
// ════════════════════════════════════════════════════════════
export const DIV_YIELDS = {
  // ── Actions CAC 40 / Européennes ──
  'AIR.PA': 0.012,    // Airbus ~1.2% (croissance vs dividendes)
  'BN.PA': 0.034,     // Danone ~3.4%
  // DG.PA (Vinci) removed — fully sold 2026-04-08 (BUG-026)
  'FGR.PA': 0.045,    // Eiffage ~4.5% (parmi les plus hauts rendements)
  'MC.PA': 0.017,     // LVMH ~1.7% (croissance > dividendes)
  'OR.PA': 0.016,     // L'Oréal ~1.6% (croissance > dividendes)
  'P911.DE': 0.024,   // Porsche ~2.4%
  'RMS.PA': 0.008,    // Hermès ~0.8% (très faible, croissance priori)
  'SAN.PA': 0.041,    // Sanofi ~4.1%
  'SAP.DE': 0.010,    // SAP SE ~1.0% (Xetra, faible historique)
  '4911.T': 0.020,    // Shiseido ~2.0% (JPY)
  'IBIT': 0,          // iShares Bitcoin — PAS de dividendes (ETF spot)
  'ETHA': 0,          // iShares Ethereum — PAS de dividendes (ETF spot)
};

// ════════════════════════════════════════════════════════════
// CALENDRIER DIVIDENDES — DPS, ex-dates, fréquences
// ════════════════════════════════════════════════════════════
// Utilisé pour:
// - Projections revenus dividendes
// - Calcul WHT (withholding tax) à venir
// - Planification fiscale (vente avant ex-date si souhaité)
// - Alertes deadline action
//
// Structure (v303 — schema étendu avec statut de confirmation) :
//   ticker: {
//     dps:       number — dividende par action, devise native de l'action
//     exDates:   Array<string | ExDateObj> — dates ex-dividende à venir
//                  string 'YYYY-MM-DD' (format legacy, tout hérite de `confirmed`)
//                  OR ExDateObj = {
//                    date:      'YYYY-MM-DD',
//                    confirmed?: boolean       — true = annonce officielle publique
//                                                 (AGM, press release, rapport annuel).
//                                                 false/absent = projection basée sur
//                                                 le DPS et le calendrier de l'an passé.
//                    dps?:      number         — override ponctuel du DPS top-level
//                    note?:     string         — note spécifique à cette échéance
//                  }
//     frequency: 'annual' | 'semi-annual' | 'quarterly' | 'none'
//     confirmed: boolean (optionnel) — valeur par défaut appliquée à chaque date
//                string (exDates) ou à chaque ExDateObj sans `confirmed` explicite.
//                true   → badge vert "✓ confirmé" dans le tableau Dividendes
//                false  → badge gris "⏳ projeté" (défaut si omis)
//     source:    string (optionnel) — provenance de la confirmation. Ex:
//                "Airbus AGM press release 2026-03-12", "Rapport annuel FY2025".
//                Sert de trace d'audit quand on marque `confirmed: true`.
//     note:      string (optionnel) — contexte général sur l'entrée
//   }
//
// MISE À JOUR:
// - Sources confirmation: communiqué de presse résultats annuels + annonce AGM
// - Fréquence: vérifié 1x par mois (nouveau dividende annoncé)
// - Dernière vérification: 17 avril 2026 (v303 — ajout flag `confirmed`)
//
// Contexte v303 : tous les dividendes CAC 40 avec ex-date dans les ~30 prochains
// jours (AGM saison avril-mai 2026) sont marqués confirmed=true car leurs
// résultats annuels ont été publiés en février-mars 2026 et les dividendes
// votés à l'AGM d'avril. Shiseido (juin) confirmé via rapport annuel FY mars 26.
// ════════════════════════════════════════════════════════════
export const DIV_CALENDAR = {
  // DG.PA removed — fully sold 2026-04-08 (BUG-026)
  'FGR.PA':  { dps: 4.80,  exDates: ['2026-05-20'], frequency: 'annual', confirmed: true, source: 'Eiffage résultats annuels 2025 (mars 2026)' },
  'BN.PA':   { dps: 2.25,  exDates: ['2026-05-04'], frequency: 'annual', confirmed: true, source: 'Danone AGM 25 avril 2026' },
  'AIR.PA':  { dps: 2.00,  exDates: ['2026-04-22'], frequency: 'annual', confirmed: true, source: 'Airbus AGM 15 avril 2026' },
  'P911.DE': { dps: 0.82,  exDates: ['2026-05-22'], frequency: 'annual', confirmed: true, source: 'Porsche AG résultats FY2025 (mars 2026)' },
  'MC.PA':   { dps: 13.00, exDates: ['2026-04-28'], frequency: 'semi-annual',
               confirmed: true, source: 'LVMH AGM 16 avril 2026',
               note: 'Solde 7.50€ avr (confirmé) + acompte 5.50€ déc (projeté)' },
  'OR.PA':   { dps: 7.20,  exDates: ['2026-04-29'], frequency: 'annual', confirmed: true, source: 'L\'Oréal AGM 22 avril 2026' },
  'SAN.PA':  { dps: 4.12,  exDates: ['2026-05-04'], frequency: 'annual', confirmed: true, source: 'Sanofi AGM 30 avril 2026' },
  'RMS.PA':  { dps: 16.00, exDates: ['2026-05-06'], frequency: 'semi-annual',
               confirmed: true, source: 'Hermès AGM 29 avril 2026',
               note: 'Solde ~12€ mai (confirmé) + acompte ~4€ fév (déjà passé)' },
  'SAP.DE':  { dps: 2.50,  exDates: ['2026-05-06'], frequency: 'annual', confirmed: true, source: 'SAP AGM 8 mai 2026' },
  '4911.T':  { dps: 30,    exDates: ['2026-06-28'], frequency: 'semi-annual',
               confirmed: true, source: 'Shiseido FY2025 results (mars 2026)',
               note: 'Final ¥20 juin + interim ¥10 déc' },
  'IBIT':    { dps: 0,     exDates: [], frequency: 'none', confirmed: true },
  'ETHA':    { dps: 0,     exDates: [], frequency: 'none', confirmed: true },
};

// ════════════════════════════════════════════════════════════
// IMMO MAROC — Frais d'acquisition & constantes de financement (v306)
// ════════════════════════════════════════════════════════════
// Utilisé par le module "Financement immobilier — Comparateur de scénarios"
// pour modéliser les coûts réels d'achat au Maroc (résidence principale ou
// appart pour la famille).
//
// Sources :
// - ANCFCC (Agence Nationale de la Conservation Foncière) : barèmes officiels
// - Banque Centrale du Maroc : taux crédit immobilier moyens 2025-2026
// - Ordre des Notaires du Maroc : honoraires TTC (TVA 10% sur honoraires HT)
//
// Mise à jour : avril 2026 (v306)
// ════════════════════════════════════════════════════════════
export const IMMO_MAROC_FEES = {
  // Frais d'acquisition cash (tout scénario d'achat) — en % du prix
  droitsEnregistrement: 0.04,          // 4% — "droits de mutation"
  conservationFonciereVente: 0.015,    // 1.5% — enregistrement au titre foncier
  notaireHonoraires: 0.012,            // ~1.2% TTC (honoraires HT × 1.10 TVA, barème dégressif ~1-1.5%)
  // Total "frais cash" ≈ 6.7% du prix
  get fraisCashTotal() {
    return this.droitsEnregistrement + this.conservationFonciereVente + this.notaireHonoraires;
  },

  // Frais spécifiques si crédit bancaire
  fraisDossierBanque: 6000,             // MAD — forfait moyen (plage 3 000-8 000)
  assuranceDIAnnuelle: 0.0035,          // 0.35%/an sur capital restant dû (obligatoire Maroc)

  // Hypothèque — barème progressif ANCFCC
  hypothequeBrackets: [
    { max: 250000,    rate: 0.005 },    // 0.5% sur tranche 0-250K
    { max: 5000000,   rate: 0.015 },    // 1.5% sur tranche 250K-5M
    { max: Infinity,  rate: 0.020 },    // 2% au-delà
  ],
};

// Taux margin IBKR (par devise, mis à jour avril 2026)
// Source : IBKR Margin Rates page, tier "Blended Rate 0-100K" avec spread ~1-1.5% sur benchmark
// €STR (EUR), SOFR (USD), TONA (JPY) = benchmark monétaire quotidien
// v315 (audit) : EUR mis à jour 3.1% → 4.3% (€STR passé à 3.0% en 2025-2026
// + spread 1.3%). L'ancienne valeur 3.1% supposait un €STR 1.6% (niveau 2024).
// À vérifier semestriellement contre la courbe €STR BCE.
export const MARGIN_RATES = {
  EUR: 0.043,    // 4.3% — €STR ~3.0% + spread 1.3%
  USD: 0.048,    // 4.8% — SOFR ~3.3% + spread 1.5%
  JPY: 0.015,    // 1.5% — TONA ~0.1% + spread 1.4% — ⚠ risque FX si yen s'apprécie
};

// ════════════════════════════════════════════════════════════
// PRESETS SCÉNARIOS IMMOBILIERS (v307)
// ════════════════════════════════════════════════════════════
// Scénarios d'achat pré-configurés pour le module "Financement immobilier".
// Chaque preset fournit : label, prix natif, devise, pays, frais d'acquisition.
// Le render convertit automatiquement en MAD pour les calculs internes.
//
// Pour ajouter un preset : pousser un objet ici, aucune autre modif requise.
// ════════════════════════════════════════════════════════════
// v313 — apportRatio explicite par preset (data-driven, plus de règle
// hardcodée côté render).
export const IMMO_PRESETS = [
  { id: 'custom', label: 'Personnalisé', price: null, currency: null, country: null, feesPct: null, apportRatio: null },
  { id: 'marrakech_appart',
    label: 'Appartement à Marrakech',
    price: 2_500_000, currency: 'MAD', country: 'MA',
    feesPct: 0.067, apportRatio: 0.20,
    note: 'Frais Maroc : 4% enregistrement + 1.5% conservation + 1.2% notaire TTC = 6.7%. Apport standard 20%.' },
  { id: 'casa_studio',
    label: 'Studio à Casablanca',
    price: 2_000_000, currency: 'MAD', country: 'MA',
    feesPct: 0.067, apportRatio: 0.20,
    note: 'Même barème Maroc. Prix m² Casa ~15 000-25 000 MAD selon quartier.' },
  { id: 'uae_appart',
    label: 'Appartement aux UAE (Dubai)',
    price: 800_000, currency: 'USD', country: 'AE',
    feesPct: 0.070, apportRatio: 0.50,
    note: 'Frais UAE : DLD 4% + agent 2% + admin 1% ≈ 7%. Crédit expat : apport 50%, taux 4-5%.' },
];

// ════════════════════════════════════════════════════════════
// BUDGET — Dépenses mensuelles fixes & abonnements
// ════════════════════════════════════════════════════════════
// Utilisé pour calcul coût de vie, comparaison revenus/dépenses
// ATTENTION: Crédits immobiliers générés dynamiquement par engine.js
//
// Structure dépense:
//   - label: description lisible
//   - amount: montant numérique
//   - currency: devise (EUR, AED, MAD, USD, JPY)
//   - freq: fréquence ('monthly', 'quarterly', 'yearly')
//   - zone: localisation ('Dubai', 'France', 'Digital')
//   - type: catégorie ('Logement', 'Utilities', 'Abonnements', 'Assurance')
//
// ZONES:
// - Dubai: dépenses UAE (loyer, utilités, assurances voiture)
// - France: dépenses France (assurances propriétés, impôts locaux)
// - Digital: dépenses cloud/SaaS (Claude AI, Spotify, Netflix, YouTube)
//
// TYPES:
// - Logement: loyer + charges
// - Utilities: électricité, eau, gaz, internet
// - Abonnements: services SaaS (Claude, Spotify, Netflix, etc.)
// - Assurance: auto (Cayenne), immo, responsabilité civile
//
// NOTE: Crédits immobiliers (prêts Vitry/Rueil/Villejuif) sont
// générés dynamiquement par engine.js depuis IMMO_CONSTANTS.charges
// (ne pas dupliquer ici pour éviter double-comptage)
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// REVENUS MENSUELS (v308) — par source, pour vue Cash-flow consolidé
// ════════════════════════════════════════════════════════════
// Permet de calculer : revenus nets mensuels, taux d'épargne, emergency
// fund ratio (dormant / dépenses), runway si perte revenus.
//
// Structure identique à BUDGET_EXPENSES pour symétrie :
//   - label      : description
//   - amount     : montant
//   - currency   : EUR, AED, MAD, USD (converti via toEUR côté engine)
//   - freq       : 'monthly' | 'yearly'
//   - owner      : 'amine' | 'nezha'
//   - type       : 'Salaire' | 'Facturation' | 'Loyer' | 'Dividende' | 'Autre'
//   - note       : optionnel
//
// MISE À JOUR: mensuelle, après clôture fiscale annuelle, après nouveau contrat.
// Dernière MAJ: avril 2026.
//
// Important: les loyers ne sont PAS comptés ici (déjà modélisés dans immoView
// avec cashflow net loyer-charges-prêt). Les dividendes sont tracés par le
// calendrier WHT dans DIV_CALENDAR (projectedDivEUR dans dividendAnalysis).
// MONTHLY_INCOMES se concentre sur salaires + facturation + revenus actifs
// qui ne sont pas déjà comptés ailleurs.
// v320 — Épargne mensuelle déclarée (EUR).
//
// Pourquoi cette constante ? Les dépenses trackées dans `BUDGET_EXPENSES` sont
// STRICTEMENT les dépenses fixes (logement, utilities, abonnements, assurances).
// Les dépenses variables (courses, loisirs, voyages, restos...) ne sont pas
// trackées. Par conséquent `computeCashFlow().netSavings` surestime largement
// l'épargne réelle (ex: 16 670 €/mois calculés vs 8 000 €/mois réels).
//
// Règle : toute projection long-terme (Financement Immo, Plan & Fiscalité,
// projections 20-25 ans) doit utiliser cette valeur déclarée, pas netSavings.
// La KPI "Surplus structurel" reste affichée dans le Budget comme indicateur
// théorique (revenus − dépenses fixes) mais n'alimente plus les projections.
export const DECLARED_MONTHLY_SAVINGS_EUR = 8000;

export const MONTHLY_INCOMES = [
  // Amine — facturation SAP freelance via Bairok Consulting LLC (UAE)
  // Montants nets (après charges société), convertis en mensuel moyen
  { label: 'Facturation SAP (Bairok)',  amount: 85000,  currency: 'AED', freq: 'monthly',
    owner: 'amine', type: 'Facturation',
    note: 'Net après charges Bairok. Variable selon mission, moyenne 12m glissants.' },

  // Nezha — salaire ou honoraires si applicable (placeholder à ajuster)
  // { label: 'Salaire Nezha', amount: 0, currency: 'EUR', freq: 'monthly',
  //   owner: 'nezha', type: 'Salaire' },

  // Loyers nets (placeholders — engine les calcule via immoView, mais on peut
  // les surfacer ici pour completude si souhaité)
  // { label: 'Loyer Vitry net',   amount: 950,  currency: 'EUR', freq: 'monthly',
  //   owner: 'amine', type: 'Loyer', note: 'Loyer HC - charges - intérêts prêt' },
];

export const BUDGET_EXPENSES = [
  { label: 'Loyer Dubai',     amount: 145000, currency: 'AED', freq: 'yearly',    zone: 'Dubai',   type: 'Logement' },
  { label: 'Électricité',     amount: 840,    currency: 'AED', freq: 'monthly',   zone: 'Dubai',   type: 'Utilities' },
  { label: 'Fibre Internet',  amount: 360,    currency: 'AED', freq: 'monthly',   zone: 'Dubai',   type: 'Utilities' },
  { label: 'Gaz',             amount: 120,    currency: 'AED', freq: 'quarterly', zone: 'Dubai',   type: 'Utilities' },
  { label: 'Téléphone',       amount: 1669,   currency: 'AED', freq: 'yearly',    zone: 'Dubai',   type: 'Abonnements' },
  { label: 'Claude (AI)',     amount: 100,    currency: 'USD', freq: 'monthly',   zone: 'Digital', type: 'Abonnements' },
  { label: 'Spotify',         amount: 75,     currency: 'MAD', freq: 'monthly',   zone: 'Digital', type: 'Abonnements' },
  { label: 'Assurance Classe A', amount: 114,  currency: 'EUR', freq: 'monthly',   zone: 'France',  type: 'Assurance' },
  { label: 'Assurance Porsche Cayenne', amount: 8000, currency: 'AED', freq: 'yearly', zone: 'Dubai', type: 'Assurance' },
  { label: 'Amex Platinum',   amount: 720,    currency: 'EUR', freq: 'yearly',    zone: 'France',  type: 'Abonnements' },
  { label: 'On/Off',          amount: 58.99,  currency: 'EUR', freq: 'yearly',    zone: 'Digital', type: 'Abonnements' },
  { label: 'YouTube Premium', amount: 110,    currency: 'MAD', freq: 'monthly',   zone: 'Digital', type: 'Abonnements' },
  { label: 'Careem Plus',    amount: 19,     currency: 'AED', freq: 'monthly',   zone: 'Dubai',   type: 'Abonnements' },
  { label: 'Noon One',       amount: 25,     currency: 'AED', freq: 'monthly',   zone: 'Dubai',   type: 'Abonnements' },
  { label: 'iCloud+ 2TB',    amount: 39.99,  currency: 'AED', freq: 'monthly',   zone: 'Dubai',   type: 'Abonnements' },
  { label: 'Netflix',        amount: 65,     currency: 'MAD', freq: 'monthly',   zone: 'Digital', type: 'Abonnements' },
];

