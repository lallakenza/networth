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
    vehicles: { cayenne: 45000, mercedes: 10000 },   // mis à jour 8 Mar 2026

    // ──────────────────────────────────────────────────────
    // CRÉANCES — argent qu'on nous doit
    // guaranteed: true = certain, false = incertain
    // probability: 0.7 = 70% de chances de récupérer
    // delayDays: délai avant paiement (ex: 45j pour SAP)
    // ──────────────────────────────────────────────────────
    creances: {
      items: [
        // status: en_cours | relancé | en_retard | recouvré | litige
        // payments: historique des paiements partiels reçus
        { label: 'SAP & Tax (20j x 910€)', amount: 18200, currency: 'EUR', guaranteed: true, probability: 1.0, delayDays: 45, status: 'en_cours', dueDate: '2026-04-15', lastContact: '2026-03-01', payments: [], notes: 'Facture envoyée, paiement sous 45j' },
        { label: 'Malt — Frais déplacement NZ', amount: 4847, currency: 'EUR', guaranteed: true, probability: 1.0, delayDays: 30, status: 'en_cours', dueDate: '2026-04-15', lastContact: '2026-03-08', payments: [], notes: 'Note de frais déplacement NZ — Sourcing Desk L\'Oréal, livré 26 fév 2026' },
        { label: 'Loyers impayés (Fév + Mars)', amount: 2400, currency: 'EUR', guaranteed: false, probability: 0.7, status: 'relancé', dueDate: '2026-03-01', lastContact: '2026-03-05', payments: [], notes: 'Relance envoyée au locataire' },
        { label: 'Kenza', amount: 200000, currency: 'MAD', guaranteed: true, probability: 1.0, status: 'en_cours', dueDate: '2026-12-31', lastContact: '2026-02-15', payments: [], notes: 'Remboursement prévu après vente terrain' },
        { label: 'Abdelkader', amount: 55000, currency: 'MAD', guaranteed: false, probability: 0.7, status: 'en_cours', dueDate: '2026-06-30', lastContact: '2026-01-10', payments: [], notes: '' },
        { label: 'Mehdi', amount: 30000, currency: 'MAD', guaranteed: true, probability: 1.0, status: 'en_cours', dueDate: '2026-09-30', lastContact: '2026-02-20', payments: [], notes: '' },
        { label: 'Akram', amount: 1500, currency: 'EUR', guaranteed: false, probability: 0.7, status: 'en_retard', dueDate: '2026-01-31', lastContact: '2026-02-01', payments: [], notes: 'Pas de nouvelle depuis' },
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
        { label: 'Omar', amount: 40000, currency: 'MAD', guaranteed: false, probability: 0.7, status: 'en_cours', dueDate: '2026-12-31', lastContact: '2026-01-15', payments: [], notes: '' },
      ],
    },
    immo: {
      // { value: valeur estimée, crd: capital restant dû, loyer: loyer mensuel }
      rueil:     { value: 272000, crd: 195275, loyer: 1300 },
      villejuif: { value: 360000, crd: 318470, loyer: 1700, signed: false, reservationFees: 3000 },
    },
  },

  // ════════════════════════════════════════════════════════
  // PRIX DE MARCHÉ (mis à jour automatiquement par API)
  // ════════════════════════════════════════════════════════
  market: {
    sgtmPriceMAD: 730,       // Cours SGTM en MAD (casablanca-bourse.com) — mis à jour 8 Mar 2026
    sgtmCostBasisMAD: 420,   // Prix d'achat IPO (offre grand public, déc 2025)
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
// IBKR CONFIGURATION — seuils et taux par tranche
// Source : interactivebrokers.com/en/trading/margin-rates.php
// Dernière vérification : mars 2026
// ════════════════════════════════════════════════════════════
export const IBKR_CONFIG = {
  // Premiers 10K EUR/USD à 0% (seuil IBKR standard pour intérêts)
  cashThreshold: 10000,
  // JPY Margin Tiers (emprunt — taux négatif appliqué)
  // BM JPY = 0.704% (mars 2026)
  jpyTiers: [
    { limit: 11000000,  rate: 0.02204 },  // Tier 1: 0 → ¥11M   = BM + 1.5%
    { limit: 114000000, rate: 0.01704 },  // Tier 2: ¥11M → ¥114M = BM + 1.0%
    { limit: Infinity,  rate: 0.01454 },  // Tier 3: > ¥114M      = BM + 0.75%
  ],
  // Recommandation : solde optimal EUR pour éviter les pénalités
  optimalCashEUR: 20000,
  // Rendement de référence cible (pour calcul coût d'opportunité)
  refYield: 0.06,
};

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
    rueil: 1001,       // 774 capital + 227 appreciation
    villejuif: 813,
  },
  villejuifStartMonth: 40, // Été 2029 ~ 40 mois à partir de mars 2026
  charges: {
    // { pret: mensualité, assurance, pno: assurance propriétaire, tf: taxe foncière/12, copro }
    vitry:     { pret: 1317, assurance: 30, pno: 15, tf: 75, copro: 150 },
    rueil:     { pret: 970, assurance: 18, pno: 12, tf: 67, copro: 80 },  // pret: 969.62, ass: 17.99 (2026)
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
    // Le champ 'vitry' est généré par computeMultiLoanSchedule(vitryLoans)
    // insurance APRIL : 209.76€/an = 17.48€/mois (externe, non incluse dans sub-loans)
    vitryInsurance: 17.48,
    vitryLoans: [
      {
        name: 'Action Logement',
        principal: 40000,
        rate: 0.005,           // 0.50%
        startDate: '2023-03',  // 1ère échéance 05/03/2023
        durationMonths: 300,   // 25 ans — fin fév 2048
        monthlyPayment: 145.20,
        insuranceMonthly: 3.33,  // assurance AL intégrée dans l'échéance
      },
      {
        name: 'PTZ (via Banque Populaire)',
        principal: 60000,
        rate: 0,               // 0% — Prêt à Taux Zéro
        startDate: '2023-12',  // 1ère échéance 06/12/2023
        durationMonths: 240,   // 20 ans — fin nov 2043
        periods: [
          { months: 60, payment: 0 },        // P1 : différé total 5 ans (déc 2023 – nov 2028)
          { months: 180, payment: 333.33 },   // P2 : amortissement constant (déc 2028 – nov 2043)
        ],
        insuranceMonthly: 0,
      },
      {
        name: 'Banque Populaire (Riv\'immo)',
        principal: 175000,
        rate: 0.021,           // 2.10%
        startDate: '2025-08',  // 1ère échéance 06/08/2025 (réalisation 10/11/2023)
        durationMonths: 281,   // 281 échéances — fin déc 2048
        periods: [
          { months: 5, payment: 306.25 },     // P1 : intérêts seuls (août–déc 2025)
          { months: 36, payment: 1020.55 },   // P2 : jan 2026 – déc 2028
          { months: 180, payment: 687.55 },   // P3 : jan 2029 – déc 2043
          { months: 60, payment: 1020.58 },   // P4 : jan 2044 – déc 2048
        ],
        insuranceMonthly: 0,   // assurance APRIL séparée
      },
    ],
    // Assurance emprunteur APRIL (couvre PTZ + BP Riv'immo)
    vitryInsuranceAPRIL: {
      annualTTC: 209.76,       // 17.48€/mois
      breakdown: {
        ptz: 53.16,            // Emprunt N°1 : 60K PTZ
        bp: 147.00,            // Emprunt N°2 : 175K Riv'immo
        cotisationAssociative: 9.60,
      },
    },
    rueil: {
      principal: 251200,
      rate: 0.012,           // 1.20%
      startDate: '2019-12',   // 1ère échéance 5 décembre 2019
      durationMonths: 300,   // 25 ans
      monthlyPayment: 969.62, // contrat notarié 5 nov 2019
      insurance: 17.99,     // assurance ACM VIE — dégressive (17.99€ en 2026)
    },
    // ── VILLEJUIF : 2 prêts — CRD calculé dynamiquement depuis villejuifLoans ──
    villejuifInsurance: 51.29,   // 46.10 + 5.19
    villejuifLoans: [
      {
        name: 'LCL Prêt 1 — Immo Taux Fixe',
        principal: 286669.95,
        rate: 0.0327,          // 3.27%
        startDate: '2025-08',  // début franchise août 2025
        durationMonths: 327,   // 36 franchise + 291 amort
        periods: [
          { months: 36, payment: 0 },       // Franchise totale — intérêts capitalisés
          { months: 291, payment: 1572.79 }, // Amortissement
        ],
        insuranceMonthly: 46.10,
        taeg: 0.0373,
        totalInterestRef: 142199,  // coût total intérêts (offre de prêt, pour ref)
        deferredInterestRef: 19055,
      },
      {
        name: 'LCL Prêt 2 — Immo Taux Fixe',
        principal: 31800,
        rate: 0.009,           // 0.90%
        startDate: '2025-08',
        durationMonths: 327,
        periods: [
          { months: 36, payment: 0 },       // Franchise totale
          { months: 291, payment: 124.99 },  // Amortissement
        ],
        insuranceMonthly: 5.19,
        taeg: 0.0139,
        totalInterestRef: 3791,
        deferredInterestRef: 575,
      },
    ],
    villejuifFranchise: {
      months: 36,              // Aug 2025 – Aug 2028
      startDate: '2025-08',
      fraisDossier: 1500,
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
    vitry:     { regime: 'reel-foncier', tmi: 0.20, ps: 0.172, cashNonDeclare: 0.30, type: 'nu' },
    // cashNonDeclare: 30% du loyer reçu en cash → base imposable réduite
    // Régime réel : on déduit intérêts d'emprunt, assurance, PNO, TF, copro
    // TMI 20% + PS 17.2% = taux effectif ~37% sur le revenu net
    rueil:     { regime: 'lmnp-amort', tmi: 0.20, ps: 0.172, type: 'lmnp' },
    // LMNP réel avec amortissement → impôt = 0 (amortissement > revenu net)
    villejuif: { regime: 'lmnp-amort', tmi: 0.20, ps: 0.172, type: 'lmnp' },
  },
  // ──────────────────────────────────────────────────────
  // MÉTADONNÉES PROPRIÉTÉS — surface, adresse, prix, appréciation
  // Utilisé par les pages détaillées (apt_*.html)
  // ──────────────────────────────────────────────────────
  properties: {
    vitry: {
      address: '8 Rue Camille Blanc, 94400 Vitry-sur-Seine',
      surface: 67.14,           // m²
      purchasePrice: 275000,    // prix d'achat TTC (VEFA 2022)
      purchaseDate: '2023-02',  // date livraison / acte
      appreciation: 0.02,       // 2%/an (GPE Ligne 15 — forte revalorisation attendue)
      type: 'T3 — Location nue',
      loyerObjectif: 1400,      // loyer cible (dont partie cash — voir fiscalite.vitry)
      totalInterestCost: 56644, // coût total intérêts (3 prêts combinés, offres de prêt)
    },
    rueil: {
      address: '57 Bd du Maréchal Joffre, 92500 Rueil-Malmaison',
      surface: 55.66,           // m²
      purchasePrice: 255000,    // prix d'achat TTC + frais notaire
      purchaseDate: '2019-11',  // acte notarié 5 novembre 2019
      purchaseDateLabel: '5 novembre 2019',
      appreciation: 0.01,       // 1%/an (conservateur IDF)
      type: 'T3 meublé — LMNP',
    },
    villejuif: {
      address: '167 Boulevard Maxime Gorki, 94800 Villejuif',
      surface: 68.92,           // m²
      totalOperation: 349456,   // montant total opération VEFA
      purchaseDate: '2025-04',  // signature VEFA
      deliveryDate: '2029-06',  // livraison été 2029
      appreciation: 0.01,       // 1%/an (marché local conservateur)
      type: 'T3 — VEFA — LMNP',
    },
  },
};

// ════════════════════════════════════════════════════════════
// HISTORIQUE PATRIMOINE — Points manuels + dernier point live
// Le dernier point (coupleNW/amineNW/nezhaNW = null) est rempli
// dynamiquement par engine.js avec les valeurs actuelles.
// Pour ajouter un point : insérer AVANT la dernière ligne.
// ════════════════════════════════════════════════════════════
export const NW_HISTORY = [
  { date: '2024-01', coupleNW: 380000, amineNW: 240000, nezhaNW: 95000, note: 'Début tracking' },
  { date: '2024-06', coupleNW: 450000, amineNW: 300000, nezhaNW: 105000 },
  { date: '2024-12', coupleNW: 550000, amineNW: 370000, nezhaNW: 130000 },
  { date: '2025-04', coupleNW: 600000, amineNW: 400000, nezhaNW: 150000, note: 'Signature Villejuif' },
  { date: '2025-09', coupleNW: 650000, amineNW: 440000, nezhaNW: 160000 },
  { date: '2026-03', coupleNW: null, amineNW: null, nezhaNW: null }, // ← rempli live
];

// ════════════════════════════════════════════════════════════
// TAUX WHT (Withholding Tax) PAR PAYS
// Applicable aux dividendes pour résident fiscal UAE
// UAE : 0% income tax, mais WHT prélevé à la source par le pays émetteur
// Plus-values : 0% WHT partout → objectif = éliminer les dividendes
// ════════════════════════════════════════════════════════════
export const WHT_RATES = {
  france: 0.30,       // 30% WHT dividendes France (pas de convention FR-UAE, taux de droit commun)
  germany: 0.26375,   // 26.375% WHT dividendes Allemagne
  us: 0.15,           // 15% WHT (convention US via W-8BEN)
  japan: 0.15,        // 15% WHT (convention JP)
  crypto: 0,          // ETFs crypto = pas de dividendes
  morocco: 0.15,      // 15% WHT Maroc
};

// Dividend yields estimés par position (annualisé)
export const DIV_YIELDS = {
  'AIR.PA': 0.012,    // Airbus ~1.2%
  'BN.PA': 0.034,     // Danone ~3.4%
  'DG.PA': 0.038,     // Vinci ~3.8%
  'FGR.PA': 0.045,    // Eiffage ~4.5%
  'MC.PA': 0.017,     // LVMH ~1.7%
  'OR.PA': 0.016,     // L'Oréal ~1.6%
  'P911.DE': 0.024,   // Porsche ~2.4%
  'RMS.PA': 0.008,    // Hermès ~0.8%
  'SAN.PA': 0.041,    // Sanofi ~4.1%
  'SAP': 0.010,       // SAP ~1.0%
  '4911.T': 0.020,    // Shiseido ~2.0%
  'IBIT': 0,          // Bitcoin ETF — pas de dividendes
  'ETHA': 0,          // Ethereum ETF — pas de dividendes
};

// ════════════════════════════════════════════════════════════
// CALENDRIER DIVIDENDES — DPS (Dividend Per Share) + Ex-dates
// Utilisé pour calculer la projection WHT et les deadlines de vente
// Données: mis à jour 8 Mar 2026 (sources: stockanalysis.com, dividendmax.com)
//
// dps: dividende par action (dans la devise de l'action)
// exDates: liste des ex-dividend dates à venir (YYYY-MM-DD)
//   → vendre AVANT cette date pour éviter la WHT
// frequency: 'annual' | 'semi-annual' | 'quarterly'
// ════════════════════════════════════════════════════════════
export const DIV_CALENDAR = {
  'DG.PA':   { dps: 5.00,  exDates: ['2026-04-21'], frequency: 'semi-annual', note: 'Solde 3.95€ en avril + acompte ~1.05€ en nov' },
  'FGR.PA':  { dps: 4.80,  exDates: ['2026-05-20'], frequency: 'annual' },
  'BN.PA':   { dps: 2.25,  exDates: ['2026-05-04'], frequency: 'annual' },
  'AIR.PA':  { dps: 2.00,  exDates: ['2026-04-22'], frequency: 'annual' },
  'P911.DE': { dps: 0.82,  exDates: ['2026-05-22'], frequency: 'annual' },
  'MC.PA':   { dps: 13.00, exDates: ['2026-04-28'], frequency: 'semi-annual', note: 'Solde 7.50€ avr + acompte 5.50€ déc' },
  'OR.PA':   { dps: 7.20,  exDates: ['2026-04-29'], frequency: 'annual' },
  'SAN.PA':  { dps: 4.12,  exDates: ['2026-05-04'], frequency: 'annual' },
  'RMS.PA':  { dps: 16.00, exDates: ['2026-05-06'], frequency: 'semi-annual', note: 'Solde ~12€ mai + acompte ~4€ fév (déjà passé)' },
  'SAP':     { dps: 2.50,  exDates: ['2026-05-06'], frequency: 'annual' },
  '4911.T':  { dps: 30,    exDates: ['2026-06-28'], frequency: 'semi-annual', note: 'Final ¥20 juin + interim ¥10 déc' },
  'IBIT':    { dps: 0,     exDates: [], frequency: 'none' },
  'ETHA':    { dps: 0,     exDates: [], frequency: 'none' },
};

// ════════════════════════════════════════════════════════════
// BUDGET — Dépenses mensuelles fixes
// freq: 'monthly' | 'quarterly' | 'yearly'
// zone: 'Dubai' | 'France' | 'Digital'
// type: 'Logement' | 'Crédits' | 'Utilities' | 'Abonnements'
// Les crédits immo sont générés dynamiquement par engine.js depuis IMMO_CONSTANTS.charges
// ════════════════════════════════════════════════════════════
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
