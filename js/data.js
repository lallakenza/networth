// ============================================================
// DATA LAYER — Raw portfolio data in native currencies
// ============================================================
// All amounts are in their NATIVE currency (AED, MAD, USD, EUR, JPY)
// Never converted here. Engine does all conversions.

export const PORTFOLIO = {
  amine: {
    // --- Cash UAE (AED) ---
    uae: {
      mashreq: 413914,      // Mashreq NEO PLUS (310518 + 103396 SAP payment received in AED)
      wioSavings: 220000,   // Wio Savings (~6% rendement)
      wioCurrent: 4904,     // Wio Current
      revolutEUR: 5967,     // Revolut EUR balance (already EUR) — updated 7 Mar 2026 (Anas remboursement + ventes)
    },
    // --- Cash Maroc (MAD) ---
    maroc: {
      attijari: 151202,     // Attijariwafa Courant
      bmce: 37304,          // BMCE/BOA Cheque
    },
    // --- ESPP Accenture (from Fidelity screenshot March 2026) ---
    espp: {
      shares: 167,
      cashEUR: 2000,        // cash residuel en EUR dans le compte ESPP
      lots: [
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
      // Total cost basis USD: sum(shares * costBasis) ≈ $36,052
      totalCostBasisUSD: 36052,
    },
    // --- IBKR Portfolio (updated from CSV March 2026) ---
    ibkr: {
      staticNAV: 197477,    // reported NAV from CSV (was 204156)
      positions: [
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
      // Multi-currency cash from CSV
      cashEUR: 65927,
      cashUSD: 14482,
      cashJPY: -21390085,
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
    // --- SGTM (Bourse Casablanca) ---
    sgtm: { shares: 32 },
    // --- Immobilier ---
    immo: {
      vitry: { value: 293000, crd: 268903, loyer: 1200, parking: 70 },
    },
    // --- Vehicules ---
    vehicles: { cayenne: 40000, mercedes: 15000 },
    // --- Creances (detailed) ---
    creances: {
      items: [
        { label: 'SAP & Tax (20j x 910\u20ac)', amount: 18200, currency: 'EUR', guaranteed: true, probability: 1.0, delayDays: 45 },
        { label: 'Loyers impay\u00e9s (F\u00e9v + Mars)', amount: 2400, currency: 'EUR', guaranteed: true, probability: 1.0 },
        { label: 'Kenza', amount: 200000, currency: 'MAD', guaranteed: false, probability: 0.6 },
        { label: 'Abdelkader', amount: 55000, currency: 'MAD', guaranteed: false, probability: 0.7 },
        { label: 'Mehdi', amount: 30000, currency: 'MAD', guaranteed: false, probability: 0.5 },
        { label: 'Akram', amount: 1500, currency: 'EUR', guaranteed: false, probability: 0.8 },
        // Anas — remboursé le 7 mars 2026 (1500 EUR + ventes) → supprimé
      ],
    },
    // --- Degiro (closed April 2025 — all positions liquidated, funds withdrawn) ---
    // P/L computed from Gmail trade confirmations (avis d'opéré)
    // NVIDIA splits: 4:1 (Jul 2021) + 10:1 (Jun 2024)
    degiro: {
      closed: true,
      closedDate: '2025-04-14',
      closedPositions: [
        // NVIDIA — Biggest winner. 3 buys, 2 sells across splits.
        // Buys: 5 @ €419 (Jul 2020) + 2 @ €518 (Sep 2020) + 30 @ $194.15 (Aug 2021)
        // After 4:1 (Jul 2021): 7 Euronext → 28. Then +30 NASDAQ = 58 total
        // Sold 4 pre-10:1 (Jul 2023) → 54 remaining × 10 = 540 post-split
        // Sold all 540 in Apr 2025 (200 @ $98.40 + 140 @ $98.30 + 200 @ $97.60)
        { ticker: 'NVDA', label: 'NVIDIA (540 post-split)', costEUR: 8067, proceedsEUR: 48264, shares: 540, currency: 'EUR', pl: 40197, note: 'Apr 2025 liquidation. Net EUR from Degiro emails.' },
        { ticker: 'NVDA', label: 'NVIDIA (Jul 2023)', costEUR: 539, proceedsEUR: 1721, shares: 4, currency: 'EUR', pl: 1182, note: '4 pre-10:1 split @ $473.40. EUR approx.' },
        // LVMH — Buy 4 @ €386 (Aug 2020) + ~12 unknown buys. Sell 16 @ €701.90
        { ticker: 'MC', label: 'LVMH', costEUR: 6104, proceedsEUR: 11230, shares: 16, currency: 'EUR', pl: 5126, note: 'Sold Aug 2021. 4 buys confirmed, 12 estimated ~€380.' },
        // SAP — Buy 20 ADS @ $127.30 (Dec 2020) + ~7 unknown. Sell 27 @ €135.20
        { ticker: 'SAP', label: 'SAP SE', costEUR: 2804, proceedsEUR: 3650, shares: 27, currency: 'EUR', pl: 846, note: 'Sold Jul 2023. 20 buys confirmed, 7 estimated.' },
        // Europcar — Multiple buys (€0.32-0.44), sells @ €0.463 + €0.498
        { ticker: 'EUCAR', label: 'Europcar', costEUR: 7422, proceedsEUR: 9489, shares: 19300, currency: 'EUR', pl: 2067, note: 'Sold Jun-Aug 2021. 11800 buys confirmed, ~7500 estimated.' },
        // Spotify — No buy email found. Estimated buy ~€250
        { ticker: 'SPOT', label: 'Spotify', costEUR: 500, proceedsEUR: 1214, shares: 2, currency: 'EUR', pl: 714, note: 'Sold Feb 2025 @ €606.89. Buy price estimated.' },
        // Walt Disney — Buy 20 @ $173.10 + ~15 unknown. Sell 30 @ $175.45 + 5 @ $112.90
        { ticker: 'DIS', label: 'Walt Disney', costEUR: 5614, proceedsEUR: 5379, shares: 35, currency: 'EUR', pl: -235, note: '30 sold Sep 2021, 5 sold Feb 2025. Some buys estimated.' },
        // Infosys — Buy 200 @ $16.19 + ~100 unknown. Sell 300 @ $16.95
        { ticker: 'INFY', label: 'Infosys ADR', costEUR: 4433, proceedsEUR: 4708, shares: 300, currency: 'EUR', pl: 182, note: 'Sold Apr 2025. 200 buys confirmed, 100 estimated.' },
        // Minor positions (pre-2021 trades: FedEx, IBM, Fitbit, Juventus, Tortoise, etc.)
        { ticker: 'MISC', label: 'Autres (FedEx, IBM, Fitbit, Juve...)', costEUR: 0, proceedsEUR: 1000, shares: 0, currency: 'EUR', pl: 1000, note: 'Net ~€1000 sur positions mineures (Philip Morris, Nike, Boeing, etc.)' },
      ],
      totalRealizedPL: 51079,  // EUR — computed from Gmail trade confirmations
    },
    // --- Passif ---
    tva: -16000,
  },

  nezha: {
    cashFrance: 85000,       // EUR
    cashMaroc: 100000,       // MAD
    sgtm: { shares: 32 },
    creances: {
      items: [
        { label: 'Omar', amount: 40000, currency: 'MAD', guaranteed: false, probability: 0.6 },
      ],
    },
    immo: {
      rueil:     { value: 272000, crd: 196516, loyer: 1300 },
      villejuif: { value: 360000, crd: 318470, loyer: 1700 },
    },
  },

  // Market prices (updated by API)
  market: {
    sgtmPriceMAD: 830,       // prix unitaire SGTM
    acnPriceUSD: 185.40,     // prix unitaire Accenture (Fidelity screenshot March 2026)
  },
};

// Cash yields (annual %)
export const CASH_YIELDS = {
  mashreq: 0.0625,     // 6.25% annuel (NEO+ savings)
  wioSavings: 0.06,    // ~6% annuel
  wioCurrent: 0,
  revolutEUR: 0,
  attijari: 0,
  bmce: 0,
  ibkrCashEUR: 0.03,   // ~3% EUR cash at IBKR
  ibkrCashUSD: 0.04,   // ~4% USD cash at IBKR
  nezhaCashFrance: 0,  // pas de rendement
  nezhaCashMaroc: 0,
  esppCash: 0,
};

// Inflation rate assumption for erosion calc
export const INFLATION_RATE = 0.03; // 3% annuel

// Static FX rates as fallback (1 EUR = X foreign)
export const FX_STATIC = {
  EUR: 1,
  AED: 4.3259,
  MAD: 10.8154,
  USD: 1.0850,
  JPY: 161.50,
};

// Currency display config
export const CURRENCY_CONFIG = {
  symbols: { EUR: '\u20ac', AED: '\u062f.\u0625', MAD: 'DH', USD: '$', JPY: '\u00a5' },
  symbolAfter: { MAD: true },
};

// Immo constants for simulations
export const IMMO_CONSTANTS = {
  growth: {
    vitry: 1017,       // EUR/month wealth creation (capital repayment + appreciation)
    rueil: 838,
    villejuif: 813,
  },
  villejuifStartMonth: 40, // Ete 2029 ~ 40 months from March 2026
  charges: {
    vitry:     { pret: 1317, assurance: 30, pno: 15, tf: 75, copro: 150 },
    rueil:     { pret: 907, assurance: 25, pno: 12, tf: 67, copro: 80 },
    villejuif: { pret: 1669, assurance: 51, pno: 15, tf: 83, copro: 110 },
  },
  prets: {
    vitryEnd: 2048,
    rueilEnd: 2044,
    villejuifEnd: 2053,
  },
};
