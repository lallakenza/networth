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
      revolutEUR: 4267,     // Revolut EUR balance (already EUR)
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
        { label: 'Loyer impay\u00e9', amount: 1200, currency: 'EUR', guaranteed: true, probability: 1.0 },
        { label: 'Kenza', amount: 200000, currency: 'MAD', guaranteed: false, probability: 0.6 },
        { label: 'Abdelkader', amount: 55000, currency: 'MAD', guaranteed: false, probability: 0.7 },
        { label: 'Mehdi', amount: 30000, currency: 'MAD', guaranteed: false, probability: 0.5 },
        { label: 'Akram', amount: 1500, currency: 'EUR', guaranteed: false, probability: 0.8 },
        { label: 'Anas', amount: 1500, currency: 'EUR', guaranteed: false, probability: 0.7 },
      ],
    },
    // --- Degiro (closed April 2025 — all positions liquidated, funds withdrawn) ---
    degiro: {
      closed: true,
      closedDate: '2025-04-14',
      closedPositions: [
        { ticker: 'NVDA', label: 'NVIDIA', buyPrice: 19.42, sellPrice: 98.40, shares: 260, currency: 'USD', pl: 18825, note: 'Bought 30 pre-split Aug 2021 @ $194.15 → 300 post-split (10:1 Jun 2024). Sold 4 pre-split @ $473.4 Jul 2023.' },
        { ticker: 'NVDA', label: 'NVIDIA (Jul 2023)', buyPrice: 194.15, sellPrice: 473.40, shares: 4, currency: 'USD', pl: 1020, note: 'Sold pre-split Jul 2023' },
        { ticker: 'SAP', label: 'SAP SE', sellPrice: 135.20, shares: 27, currency: 'EUR', pl: 650, note: 'Sold Jul 2023' },
        { ticker: 'MC', label: 'LVMH', sellPrice: 701.90, shares: 16, currency: 'EUR', pl: 2400, note: 'Sold Aug 2021' },
        { ticker: 'SPOT', label: 'Spotify', sellPrice: 606.89, shares: 2, currency: 'USD', pl: 850, note: 'Sold Feb 2025' },
        { ticker: 'DIS', label: 'Walt Disney', buyPrice: 173.10, sellPrice: 112.90, shares: 5, currency: 'USD', pl: -275, note: 'Sold Feb 2025 at loss' },
        { ticker: 'INFY', label: 'Infosys ADR', sellPrice: 16.95, shares: 300, currency: 'USD', pl: -650, note: 'Sold Apr 2025' },
        { ticker: 'EUCAR', label: 'Europcar', shares: 15800, currency: 'EUR', pl: -4200, note: 'Sold Aug 2021 at large loss' },
      ],
      totalRealizedPL: 18620,  // EUR approximate total
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
