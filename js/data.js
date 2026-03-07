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
    // --- ESPP Accenture ---
    espp: {
      shares: 167,
      cashEUR: 2000,        // cash residuel en EUR dans le compte ESPP
    },
    // --- IBKR Portfolio ---
    ibkr: {
      cashEUR: 2500,
      staticNAV: 204156,    // reported NAV fallback when prices not live
      positions: [
        { ticker: 'IBIT',    shares: 315, price: 52.74,  currency: 'USD', label: 'iShares Bitcoin (IBIT)' },
        { ticker: 'AIR.PA',  shares: 215, price: 163.61, currency: 'EUR', label: 'Airbus (AIR)' },
        { ticker: 'DG.PA',   shares: 270, price: 97.56,  currency: 'EUR', label: 'Vinci (DG)' },
        { ticker: 'MC.PA',   shares: 33,  price: 613.40, currency: 'EUR', label: 'LVMH (MC)' },
        { ticker: 'ETHE',    shares: 880, price: 18.92,  currency: 'USD', label: 'iShares Ethereum (ETHE)' },
        { ticker: 'SAP',     shares: 75,  price: 271.10, currency: 'EUR', label: 'SAP SE' },
        { ticker: 'SIE.DE',  shares: 80,  price: 221.55, currency: 'EUR', label: 'Siemens (SIE)' },
        { ticker: 'SAN.PA',  shares: 180, price: 43.90,  currency: 'EUR', label: 'Sanofi (SAN)' },
        { ticker: 'BNP.PA',  shares: 100, price: 72.48,  currency: 'EUR', label: 'BNP Paribas' },
        { ticker: 'TTE.PA',  shares: 155, price: 55.70,  currency: 'EUR', label: 'TotalEnergies (TTE)' },
        { ticker: 'OR.PA',   shares: 28,  price: 370.75, currency: 'EUR', label: "L'Oreal (OR)" },
        { ticker: '7203.T',  shares: 50,  price: 2815,   currency: 'JPY', label: 'Toyota (7203)' },
      ],
    },
    // --- SGTM (Bourse Casablanca) ---
    sgtm: { shares: 32 },
    // --- Immobilier ---
    immo: {
      vitry: { value: 293000, crd: 268903 },
    },
    // --- Vehicules ---
    vehicles: { cayenne: 40000, mercedes: 15000 },
    // --- Creances ---
    creances: {
      sapTax: 18200,         // SAP & Tax: 20j x 910 (garanti 45j)
      persoMAD: 285000,      // Kenza 200K + Abdelkader 55K + Mehdi 30K
      persoEUR: 4200,        // Akram 1500 + loyer 1200 + Anas 1500
    },
    // --- Passif ---
    tva: -16000,
  },

  nezha: {
    cashFrance: 85000,       // EUR
    cashMaroc: 100000,       // MAD
    sgtm: { shares: 32 },
    recvOmar: 40000,         // MAD
    immo: {
      rueil:     { value: 272000, crd: 196516 },
      villejuif: { value: 360000, crd: 318470 },
    },
  },

  // Market prices (updated by API)
  market: {
    sgtmPriceMAD: 830,       // prix unitaire SGTM
    acnPriceUSD: 188,        // prix unitaire Accenture
  },
};

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
  symbols: { EUR: '\u20ac', AED: '\u062f.\u0625', MAD: 'DH', USD: '$' },
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
