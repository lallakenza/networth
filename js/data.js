// ============================================================
// DATA LAYER — Raw portfolio data in native currencies
// ============================================================
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
    // ──────────────────────────────────────────────────────
    uae: {
      mashreq: 360734,      // Mashreq NEO PLUS — mis à jour 7 Mar 2026
      wioSavings: 220000,   // Wio Savings (~6% rendement)
      wioCurrent: 4904,     // Wio Current (compte courant, 0% rendement)
      revolutEUR: 5967,     // Revolut EUR balance (déjà en EUR) — mis à jour 7 Mar 2026
    },

    // ──────────────────────────────────────────────────────
    // CASH MAROC (en MAD) — se connecter à Attijari/Nabd app
    // ──────────────────────────────────────────────────────
    maroc: {
      attijari: 151202,     // Attijariwafa Courant (0% rendement)
      nabd: 37304,          // Nabd (ex-Société Générale Maroc, 0% rendement)
    },

    // ──────────────────────────────────────────────────────
    // ESPP ACCENTURE — voir Fidelity NetBenefits
    // ──────────────────────────────────────────────────────
    espp: {
      shares: 167,          // Nombre d'actions ACN détenues
      cashEUR: 2000,        // Cash résiduel en EUR dans le compte ESPP
      lots: [
        // { date, source, shares, costBasis (USD/action) }
        { date: '2023-05-01', source: 'ESPP', shares: 17, costBasis: 236.8788 },
        { date: '2022-08-15', source: 'FRAC', shares: 3,  costBasis: 272.3600 },
        { date: '2022-05-01', source: 'ESPP', shares: 12, costBasis: 305.8900 },
        { date: '2021-11-01', source: 'ESPP', shares: 11, costBasis: 355.9900 },
        { date: '2021-04-30', source: 'ESPP', shares: 15, costBasis: 289.6400 },
        { date: '2020-10-30', source: 'ESPP', shares: 14, costBasis: 215.7250 },
        { date: '2020-05-01', source: 'ESPP', shares: 19, costBasis: 181.1250 },
        { date: '2019-11-01', source: 'ESPP', shares: 18, costBasis: 187.2300 },
        { date: '2019-05-01', source: 'ESPP', shares: 17, costBasis: 182.3200 },
        { date: '2018-11-01', source: 'ESPP', shares: 21, costBasis: 158.3250 },
        { date: '2018-05-01', source: 'ESPP', shares: 20, costBasis: 151.0350 },
      ],
      totalCostBasisUSD: 36052,
    },

    // ──────────────────────────────────────────────────────
    // IBKR — Télécharger le CSV "Net Asset Value" depuis
    //        Interactive Brokers > Performance & Reports
    //
    // Positions : mettre à jour price (cours) et shares (nb)
    // Cash : mettre à jour cashEUR, cashUSD, cashJPY
    // cashJPY est NÉGATIF = emprunt (short JPY pour levier)
    // ──────────────────────────────────────────────────────
    ibkr: {
      staticNAV: 197477,    // NAV totale du rapport CSV (pour vérification)
      positions: [
        // { ticker, shares, price (cours actuel), costBasis (PRU), currency, label, sector, geo }
        // Cours mis à jour automatiquement par l'API Yahoo Finance
        { ticker: 'AIR.PA',  shares: 200,  price: 175.88, costBasis: 190.25, currency: 'EUR', label: 'Airbus (AIR)', sector: 'industrials', geo: 'france' },
        { ticker: 'BN.PA',   shares: 200,  price: 70.04,  costBasis: 68.83,  currency: 'EUR', label: 'Danone (BN)', sector: 'consumer', geo: 'france' },
        { ticker: 'DG.PA',   shares: 200,  price: 131.70, costBasis: 122.46, currency: 'EUR', label: 'Vinci (DG)', sector: 'industrials', geo: 'france' },
        { ticker: 'FGR.PA',  shares: 100,  price: 137.50, costBasis: 111.81, currency: 'EUR', label: 'Eiffage (FGR)', sector: 'industrials', geo: 'france' },
        { ticker: 'MC.PA',   shares: 40,   price: 505.80, costBasis: 472.64, currency: 'EUR', label: 'LVMH (MC)', sector: 'luxury', geo: 'france' },
        { ticker: 'OR.PA',   shares: 30,   price: 371.45, costBasis: 361.68, currency: 'EUR', label: "L'Or\u00e9al (OR)", sector: 'luxury', geo: 'france' },
        { ticker: 'P911.DE', shares: 400,  price: 38.64,  costBasis: 45.22,  currency: 'EUR', label: 'Porsche (P911)', sector: 'automotive', geo: 'germany' },
        { ticker: 'RMS.PA',  shares: 10,   price: 1899.50, costBasis: 2053.03, currency: 'EUR', label: 'Herm\u00e8s (RMS)', sector: 'luxury', geo: 'france' },
        { ticker: 'SAN.PA',  shares: 50,   price: 77.73,  costBasis: 77.71,  currency: 'EUR', label: 'Sanofi (SAN)', sector: 'healthcare', geo: 'france' },
        { ticker: 'SAP',     shares: 70,   price: 170.98, costBasis: 190.86, currency: 'EUR', label: 'SAP SE', sector: 'tech', geo: 'germany' },
        { ticker: '4911.T',  shares: 500,  price: 3040,   costBasis: 2180.74, currency: 'JPY', label: 'Shiseido (4911)', sector: 'consumer', geo: 'japan' },
        { ticker: 'IBIT',    shares: 1200, price: 40.39,  costBasis: 44.97,  currency: 'USD', label: 'iShares Bitcoin (IBIT)', sector: 'crypto', geo: 'crypto' },
        { ticker: 'ETHA',    shares: 1100, price: 15.80,  costBasis: 18.53,  currency: 'USD', label: 'iShares Ethereum (ETHA)', sector: 'crypto', geo: 'crypto' },
      ],
      // ⬇️ Cash multi-devises (depuis rapport IBKR)
      cashEUR: 65927,       // Solde EUR chez IBKR
      cashUSD: 14482,       // Solde USD chez IBKR
      cashJPY: -21390085,   // Solde JPY chez IBKR (NÉGATIF = emprunt margin)
      // Performance metrics from CSV (April 2025 - March 2026)
      meta: {
        twr: 26.94,            // Time-Weighted Return %
        realizedPL: 5980,      // Total realized P/L (stocks + forex)
        dividends: 648,        // Gross dividends received
        commissions: -872,     // Commissions + transaction fees
        deposits: 199886,      // Net deposits
        closedPositions: [
          { ticker: 'GLE',  pl: 4807, label: 'Soci\u00e9t\u00e9 G\u00e9n\u00e9rale' },
          { ticker: 'QQQM', pl: 3185, label: 'Invesco Nasdaq 100' },
          { ticker: 'EDEN', pl: 570,  label: 'Edenred' },
          { ticker: 'NXI',  pl: 400,  label: 'Nexity' },
          { ticker: 'WLN',  pl: -3202, label: 'Worldline' },
        ],
      },
    },

    // ──────────────────────────────────────────────────────
    // SGTM (Bourse Casablanca) — voir cours sur casablanca-bourse.com
    // ──────────────────────────────────────────────────────
    sgtm: { shares: 32 },   // prix unitaire dans market.sgtmPriceMAD

    // ──────────────────────────────────────────────────────
    // IMMOBILIER — mettre à jour valeur estimée + CRD mensuel
    // CRD = Capital Restant Dû (vérifier sur tableau d'amortissement)
    // ──────────────────────────────────────────────────────
    immo: {
      vitry: { value: 293000, crd: 268903, loyer: 1200, parking: 70 },
    },

    // ──────────────────────────────────────────────────────
    // VÉHICULES — valeur estimée revente
    // ──────────────────────────────────────────────────────
    vehicles: { cayenne: 40000, mercedes: 15000 },

    // ──────────────────────────────────────────────────────
    // CRÉANCES — argent qu'on nous doit
    // guaranteed: true = certain, false = incertain
    // probability: 0.7 = 70% de chances de récupérer
    // delayDays: délai avant paiement (ex: 45j pour SAP)
    // ──────────────────────────────────────────────────────
    creances: {
      items: [
        { label: 'SAP & Tax (20j x 910\u20ac)', amount: 18200, currency: 'EUR', guaranteed: true, probability: 1.0, delayDays: 45 },
        { label: 'Loyers impay\u00e9s (F\u00e9v + Mars)', amount: 2400, currency: 'EUR', guaranteed: false, probability: 0.7 },
        { label: 'Kenza', amount: 200000, currency: 'MAD', guaranteed: true, probability: 1.0 },
        { label: 'Abdelkader', amount: 55000, currency: 'MAD', guaranteed: false, probability: 0.7 },
        { label: 'Mehdi', amount: 30000, currency: 'MAD', guaranteed: true, probability: 1.0 },
        { label: 'Akram', amount: 1500, currency: 'EUR', guaranteed: false, probability: 0.7 },
        // Anas — remboursé le 7 mars 2026 → supprimé
      ],
    },

    // ──────────────────────────────────────────────────────
    // DEGIRO (fermé avril 2025 — toutes positions liquidées)
    // P/L calculé depuis les emails de confirmation Gmail
    // ──────────────────────────────────────────────────────
    degiro: {
      closed: true,
      closedDate: '2025-04-14',
      closedPositions: [
        // { ticker, label, costEUR (coût total), proceedsEUR (vente totale), shares, pl (P/L) }
        { ticker: 'NVDA', label: 'NVIDIA (540 post-split)', costEUR: 8067, proceedsEUR: 48264, shares: 540, currency: 'EUR', pl: 40197, note: 'Apr 2025 liquidation. Net EUR from Degiro emails.' },
        { ticker: 'NVDA', label: 'NVIDIA (Jul 2023)', costEUR: 539, proceedsEUR: 1721, shares: 4, currency: 'EUR', pl: 1182, note: '4 pre-10:1 split @ $473.40. EUR approx.' },
        { ticker: 'MC', label: 'LVMH', costEUR: 6104, proceedsEUR: 11230, shares: 16, currency: 'EUR', pl: 5126, note: 'Sold Aug 2021.' },
        { ticker: 'SAP', label: 'SAP SE', costEUR: 2804, proceedsEUR: 3650, shares: 27, currency: 'EUR', pl: 846, note: 'Sold Jul 2023.' },
        { ticker: 'EUCAR', label: 'Europcar', costEUR: 7422, proceedsEUR: 9489, shares: 19300, currency: 'EUR', pl: 2067, note: 'Sold Jun-Aug 2021.' },
        { ticker: 'SPOT', label: 'Spotify', costEUR: 500, proceedsEUR: 1214, shares: 2, currency: 'EUR', pl: 714, note: 'Sold Feb 2025 @ €606.89.' },
        { ticker: 'DIS', label: 'Walt Disney', costEUR: 5614, proceedsEUR: 5379, shares: 35, currency: 'EUR', pl: -235, note: '30 sold Sep 2021, 5 sold Feb 2025.' },
        { ticker: 'INFY', label: 'Infosys ADR', costEUR: 4433, proceedsEUR: 4708, shares: 300, currency: 'EUR', pl: 182, note: 'Sold Apr 2025.' },
        { ticker: 'MISC', label: 'Autres (FedEx, IBM, Fitbit, Juve...)', costEUR: 0, proceedsEUR: 1000, shares: 0, currency: 'EUR', pl: 1000, note: 'Net ~€1000 sur positions mineures.' },
      ],
      totalRealizedPL: 51079,  // EUR total P/L Degiro
    },

    // ──────────────────────────────────────────────────────
    // PASSIF — dettes / obligations
    // ──────────────────────────────────────────────────────
    tva: -16000,             // TVA à payer (négatif = dette)
  },

  // ════════════════════════════════════════════════════════
  // NEZHA
  // ════════════════════════════════════════════════════════
  nezha: {
    cashFrance: 85000,       // EUR — compte bancaire France (0% rendement)
    cashMaroc: 100000,       // MAD — compte bancaire Maroc (0% rendement)
    sgtm: { shares: 32 },   // SGTM Bourse Casablanca
    creances: {
      items: [
        { label: 'Omar', amount: 40000, currency: 'MAD', guaranteed: false, probability: 0.7 },
      ],
    },
    immo: {
      // { value: valeur estimée, crd: capital restant dû, loyer: loyer mensuel }
      rueil:     { value: 272000, crd: 196516, loyer: 1300 },
      villejuif: { value: 360000, crd: 318470, loyer: 1700 },
    },
  },

  // ════════════════════════════════════════════════════════
  // PRIX DE MARCHÉ (mis à jour automatiquement par API)
  // ════════════════════════════════════════════════════════
  market: {
    sgtmPriceMAD: 830,       // Cours SGTM en MAD (casablanca-bourse.com)
    acnPriceUSD: 185.40,     // Cours Accenture en USD (Fidelity)
  },
};

// ════════════════════════════════════════════════════════════
// TAUX DE RENDEMENT CASH (annuels)
//
// ⚠️  Pour IBKR : les taux ci-dessous sont les taux NOMINAUX
//     (avant seuil 10K). Le rendement EFFECTIF est calculé
//     dans engine.js en tenant compte de :
//     - EUR/USD : premiers 10 000 à 0% (seuil IBKR)
//     - JPY : taux par tranche (voir ibkrJPYBorrowCost)
//
// Source : https://www.interactivebrokers.com/en/accounts/fees/pricing-interest-rates.php
// Dernière vérification : 7 mars 2026
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
  nezhaCashFrance: 0,  // Pas de livret / pas de rendement
  nezhaCashMaroc: 0,   // Pas de rendement
  esppCash: 0,         // Cash résiduel ESPP, pas de rendement
};

// Taux d'inflation annuel (pour calcul érosion cash dormant)
export const INFLATION_RATE = 0.03; // 3% annuel

// ════════════════════════════════════════════════════════════
// TAUX DE CHANGE STATIQUES (fallback si API indisponible)
// Format : 1 EUR = X devises étrangères
// Source : xe.com — Dernière vérification : mars 2026
// ════════════════════════════════════════════════════════════
export const FX_STATIC = {
  EUR: 1,
  AED: 4.3259,
  MAD: 10.8154,
  USD: 1.0850,
  JPY: 161.50,
};

// Symboles devises pour affichage
export const CURRENCY_CONFIG = {
  symbols: { EUR: '\u20ac', AED: '\u062f.\u0625', MAD: 'DH', USD: '$', JPY: '\u00a5' },
  symbolAfter: { MAD: true },
};

// ════════════════════════════════════════════════════════════
// IMMOBILIER — constantes pour simulations
// ════════════════════════════════════════════════════════════
export const IMMO_CONSTANTS = {
  growth: {
    vitry: 1017,       // EUR/mois création de richesse (remboursement capital + appréciation)
    rueil: 838,
    villejuif: 813,
  },
  villejuifStartMonth: 40, // Été 2029 ~ 40 mois à partir de mars 2026
  charges: {
    // { pret: mensualité, assurance, pno: assurance propriétaire, tf: taxe foncière/12, copro }
    vitry:     { pret: 1317, assurance: 30, pno: 15, tf: 75, copro: 150 },
    rueil:     { pret: 907, assurance: 25, pno: 12, tf: 67, copro: 80 },
    villejuif: { pret: 1669, assurance: 51, pno: 15, tf: 83, copro: 110 },
  },
  prets: {
    vitryEnd: 2048,      // Année fin du prêt
    rueilEnd: 2044,
    villejuifEnd: 2053,
  },
};
