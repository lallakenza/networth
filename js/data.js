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
      staticNAV: 197076,    // NAV totale du rapport CSV au 16/03/2026
      positions: [
        // { ticker, shares, price (cours actuel fallback), costBasis (PRU), currency, label, sector, geo }
        // price: mis à jour par l'API Yahoo range=1d, sinon fallback statique ci-dessous
        // ytdOpen/mtdOpen/oneMonthAgo: prix de référence historiques — stockés une fois, mis à jour mensuellement
        //   ytdOpen = clôture 1er jour de bourse 2026 (2 jan)
        //   mtdOpen = clôture 1er jour du mois courant (3 mar 2026)
        //   oneMonthAgo = clôture ~30 jours avant (10 fév 2026)
        { ticker: 'AIR.PA',  shares: 200,  price: 169.96, costBasis: 190.25, currency: 'EUR', label: 'Airbus (AIR)', sector: 'industrials', geo: 'france', ytdOpen: 203.70, mtdOpen: 180.28, oneMonthAgo: 187.24 },
        { ticker: 'BN.PA',   shares: 200,  price: 72.84,  costBasis: 68.83,  currency: 'EUR', label: 'Danone (BN)', sector: 'consumer', geo: 'france', ytdOpen: 76.04, mtdOpen: 71.22, oneMonthAgo: 69.02 },
        { ticker: 'DG.PA',   shares: 100,  price: 131.20, costBasis: 122.46, currency: 'EUR', label: 'Vinci (DG)', sector: 'industrials', geo: 'france', ytdOpen: 121.15, mtdOpen: 138.40, oneMonthAgo: 133.55 },
        { ticker: 'FGR.PA',  shares: 100,  price: 134.60, costBasis: 111.81, currency: 'EUR', label: 'Eiffage (FGR)', sector: 'industrials', geo: 'france', ytdOpen: 123.50, mtdOpen: 145.60, oneMonthAgo: 135.40 },
        { ticker: 'MC.PA',   shares: 40,   price: 479.00, costBasis: 472.64, currency: 'EUR', label: 'LVMH (MC)', sector: 'luxury', geo: 'france', ytdOpen: 641.80, mtdOpen: 520.50, oneMonthAgo: 525.10 },
        { ticker: 'OR.PA',   shares: 30,   price: 352.05, costBasis: 361.68, currency: 'EUR', label: "L'Or\u00e9al (OR)", sector: 'luxury', geo: 'france', ytdOpen: 364.70, mtdOpen: 380.95, oneMonthAgo: 391.90 },
        { ticker: 'P911.DE', shares: 400,  price: 36.64,  costBasis: 45.22,  currency: 'EUR', label: 'Porsche (P911)', sector: 'automotive', geo: 'germany', ytdOpen: 47.60, mtdOpen: 40.27, oneMonthAgo: 41.18 },
        { ticker: 'RMS.PA',  shares: 10,   price: 1879.00, costBasis: 2053.03, currency: 'EUR', label: 'Herm\u00e8s (RMS)', sector: 'luxury', geo: 'france', ytdOpen: 2104.00, mtdOpen: 1967.00, oneMonthAgo: 2120.00 },
        { ticker: 'SAN.PA',  shares: 50,   price: 76.51,  costBasis: 77.71,  currency: 'EUR', label: 'Sanofi (SAN)', sector: 'healthcare', geo: 'france', ytdOpen: 82.32, mtdOpen: 81.45, oneMonthAgo: 82.56 },
        { ticker: 'SAP',     shares: 70,   price: 165.46, costBasis: 190.86, currency: 'EUR', label: 'SAP SE', sector: 'tech', geo: 'germany', ytdOpen: 236.92, mtdOpen: 196.01, oneMonthAgo: 212.21 },
        { ticker: '4911.T',  shares: 500,  price: 3032,   costBasis: 2180.74, currency: 'JPY', label: 'Shiseido (4911)', sector: 'consumer', geo: 'japan', ytdOpen: 2309.50, mtdOpen: 3239.00, oneMonthAgo: 3223.00 },
        { ticker: 'IBIT',    shares: 1200, price: 41.94,  costBasis: 44.97,  currency: 'USD', label: 'iShares Bitcoin (IBIT)', sector: 'crypto', geo: 'crypto', ytdOpen: 50.94, mtdOpen: 39.19, oneMonthAgo: 38.97 },
        { ticker: 'ETHA',    shares: 1100, price: 17.61,  costBasis: 18.53,  currency: 'USD', label: 'iShares Ethereum (ETHA)', sector: 'crypto', geo: 'crypto', ytdOpen: 23.58, mtdOpen: 15.37, oneMonthAgo: 15.20 },
      ],
      // ⬇️ Cash multi-devises (IBKR — mis à jour 18/03/2026 après deleverage JPY)
      cashEUR: -1,           // Solde EUR chez IBKR au 18/03/2026
      cashUSD: 0,            // Solde USD chez IBKR au 18/03/2026
      cashJPY: -4590694,     // Solde JPY chez IBKR au 18/03/2026 (après rachat 13111 EUR→JPY)
      // Performance metrics (April 2025 - March 2026)
      meta: {
        twr: 26.94,            // Time-Weighted Return % (depuis ouverture)
        realizedPL: 6798,      // +5924 précédent + ~874 (DG 100×(131.20-122.46))
        dividends: 648,        // Gross dividends received (all-time)
        commissions: -879,     // -872 précédent - 6.56 (DG sells)
      },
      // ── Historique des dépôts IBKR ──
      // Source : rapport IBKR "Deposits & Withdrawals"
      // Mettre à jour à chaque nouveau virement ou rapport IBKR
      // currency: devise du virement | amount: montant en devise native | fxRateAtDate: taux EUR/devise au jour du dépôt
      deposits: [
        { date: '2025-04-01', amount: 10000,  currency: 'EUR', fxRateAtDate: 1,     label: 'Virement initial IBKR' },
        { date: '2025-08-01', amount: 150000, currency: 'EUR', fxRateAtDate: 1,     label: 'Virement principal IBKR' },
        { date: '2025-09-01', amount: 20000,  currency: 'EUR', fxRateAtDate: 1,     label: 'Virement complémentaire' },
        { date: '2025-10-01', amount: 10000,  currency: 'EUR', fxRateAtDate: 1,     label: 'Virement complémentaire' },
        { date: '2025-11-01', amount: 5886,   currency: 'EUR', fxRateAtDate: 1,     label: 'Virement complémentaire' },
        { date: '2025-12-01', amount: 4000,   currency: 'EUR', fxRateAtDate: 1,     label: 'Virement complémentaire' },
        { date: '2026-01-15', amount: 3000,   currency: 'EUR', fxRateAtDate: 1,     label: 'Virement janvier 2026' },
      ],
      // Total dépôts IBKR = 202886 EUR
      // ── Historique complet des trades IBKR ──
      // Source: CSV IBKR U18138426 — April 2025 → March 2026
      // Format unifié: { date, ticker, label, type, qty, price, currency, cost|proceeds, realizedPL, commission, costBasis, note }
      // type: 'buy' | 'sell' | 'fx'
      // qty: toujours positif. type indique le sens.
      // cost/proceeds: montant total (qty × price). cost pour buy, proceeds pour sell.
      // realizedPL: P/L réalisé sur les sells (du CSV IBKR). Vide pour les buys.
      // commission: frais de transaction (négatif).
      // costBasis: PRU moyen au moment du trade (du CSV IBKR). Utile pour recalculer le P/L.
      trades: [
        // ═══════════════════════════════════════════════════
        //  STOCK TRADES — triés par date
        // ═══════════════════════════════════════════════════

        // ─── QQQM (Invesco Nasdaq 100) — achat avr 2025, vendu fév 2026 ───
        { date: '2025-04-03', ticker: 'QQQM', label: 'Invesco Nasdaq 100', type: 'buy',  qty: 58,   price: 185.80,  currency: 'USD', cost: 10776,  commission: -1.00, costBasis: 185.63 , source: 'ibkr' },
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
        { date: '2025-11-25', ticker: '4911.T',  label: 'Shiseido',          type: 'buy',  qty: 500,  price: 2179,    currency: 'JPY', cost: 1089500, commission: -871.60, costBasis: 2179, source: 'ibkr' },
        // ─── AIR (Airbus) — 2 lots, position ouverte ───
        { date: '2025-12-01', ticker: 'AIR.PA',  label: 'Airbus',            type: 'buy',  qty: 100,  price: 196.50,  currency: 'EUR', cost: 19650,  commission: -9.83, costBasis: 192.58 , source: 'ibkr' },
        { date: '2025-12-01', ticker: 'AIR.PA',  label: 'Airbus',            type: 'buy',  qty: 100,  price: 183.80,  currency: 'EUR', cost: 18380,  commission: -9.19, costBasis: 192.58 , source: 'ibkr' },
        // ─── IBIT (iShares Bitcoin) — position ouverte ───
        { date: '2025-12-11', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 100,  price: 50.76,   currency: 'USD', cost: 5076,   commission: -1.00, costBasis: 52.10 , source: 'ibkr' },
        // ─── EDEN rebuy jan 2026 ───
        { date: '2026-01-16', ticker: 'EDEN', label: 'Edenred',           type: 'buy',  qty: 300,  price: 17.985,  currency: 'EUR', cost: 5396,   commission: -3.00, costBasis: 17.60 , source: 'ibkr' },
        // ─── BN (Danone) — position ouverte ───
        { date: '2026-01-21', ticker: 'BN.PA',   label: 'Danone',            type: 'buy',  qty: 200,  price: 68.80,   currency: 'EUR', cost: 13760,  commission: -6.88, costBasis: 67.40 , source: 'ibkr' },
        // ─── SAP — position ouverte ───
        { date: '2026-01-21', ticker: 'SAP',     label: 'SAP SE',            type: 'buy',  qty: 70,   price: 190.76,  currency: 'EUR', cost: 13353,  commission: -6.68, costBasis: 191.04 , source: 'ibkr' },
        // ─── IBIT renforcements jan/fév 2026 ───
        { date: '2026-01-29', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 500,  price: 47.44,   currency: 'USD', cost: 23720,  commission: -2.50, costBasis: 47.60 , source: 'ibkr' },
        // ─── ETHA (iShares Ethereum) — 3 lots ───
        { date: '2026-01-30', ticker: 'ETHA',    label: 'iShares Ethereum',  type: 'buy',  qty: 500,  price: 20.59,   currency: 'USD', cost: 10295,  commission: -2.50, costBasis: 20.17 , source: 'ibkr' },
        { date: '2026-02-02', ticker: 'ETHA',    label: 'iShares Ethereum',  type: 'buy',  qty: 200,  price: 18.01,   currency: 'USD', cost: 3602,   commission: -1.00, costBasis: 17.50 , source: 'ibkr' },
        { date: '2026-02-04', ticker: 'ETHA',    label: 'iShares Ethereum',  type: 'buy',  qty: 400,  price: 16.20,   currency: 'USD', cost: 6480,   commission: -2.00, costBasis: 16.34 , source: 'ibkr' },
        // ─── IBIT renforcements fév 2026 ───
        { date: '2026-02-03', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 300,  price: 42.50,   currency: 'USD', cost: 12750,  commission: -1.50, costBasis: 43.30 , source: 'ibkr' },
        { date: '2026-02-04', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 100,  price: 41.75,   currency: 'USD', cost: 4175,   commission: -1.00, costBasis: 41.57 , source: 'ibkr' },
        { date: '2026-02-04', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 100,  price: 41.50,   currency: 'USD', cost: 4150,   commission: -1.00, costBasis: 41.57 , source: 'ibkr' },
        { date: '2026-02-04', ticker: 'IBIT',    label: 'iShares Bitcoin',   type: 'buy',  qty: 100,  price: 40.90,   currency: 'USD', cost: 4090,   commission: -1.00, costBasis: 41.57 , source: 'ibkr' },
        // ─── QQQM sell — profit-taking ───
        { date: '2026-02-24', ticker: 'QQQM', label: 'Invesco Nasdaq 100', type: 'sell', qty: 58,   price: 250.49,  currency: 'USD', proceeds: 14528, realizedPL: 3750.01, commission: -1.01, costBasis: 250.31 , source: 'ibkr' },
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
        { date: '2026-03-18', ticker: 'EUR.JPY', label: 'EUR→JPY (deleverage)', type: 'fx', qty: 13111, price: 183.545, currency: 'EUR', jpyAmount: 2406458,  commission: -317.78, note: 'Rachat JPY short — deleverage' , source: 'ibkr' },
      ],
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
      vitry: { value: 300000, valueDate: '2025-09', crd: 268903, loyerHC: 1050, loyerDeclare: 600, chargesLocataire: 150, parking: 70, loyerTotalCC: 1270, loyerDeclareCC: 600 },
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
        { label: 'SAP & Tax (20j x 910€)', amount: 18200, currency: 'EUR', type: 'pro', guaranteed: true, probability: 1.0, delayDays: 45, status: 'en_cours', dueDate: '2026-04-15', lastContact: '2026-03-01', payments: [], notes: 'Facture envoyée, paiement sous 45j' },
        { label: 'Malt — Frais déplacement NZ', amount: 4847, currency: 'EUR', type: 'pro', guaranteed: true, probability: 1.0, delayDays: 30, status: 'en_cours', dueDate: '2026-04-15', lastContact: '2026-03-08', payments: [], notes: 'Note de frais déplacement NZ — Sourcing Desk L\'Oréal, livré 26 fév 2026' },
        { label: 'Loyers impayés (Fév + Mars)', amount: 2400, currency: 'EUR', type: 'pro', guaranteed: false, probability: 0.7, status: 'relancé', dueDate: '2026-03-01', lastContact: '2026-03-05', payments: [], notes: 'Relance envoyée au locataire' },
        { label: 'Kenza', amount: 200000, currency: 'MAD', type: 'perso', guaranteed: true, probability: 1.0, status: 'en_cours', dueDate: '2026-12-31', lastContact: '2026-02-15', payments: [], notes: 'Remboursement prévu après vente terrain' },
        { label: 'Abdelkader', amount: 55000, currency: 'MAD', type: 'perso', guaranteed: false, probability: 0.7, status: 'en_cours', dueDate: '2026-06-30', lastContact: '2026-01-10', payments: [], notes: '' },
        { label: 'Mehdi', amount: 30000, currency: 'MAD', type: 'perso', guaranteed: true, probability: 1.0, status: 'en_cours', dueDate: '2026-09-30', lastContact: '2026-02-20', payments: [], notes: '' },
        { label: 'Akram', amount: 1500, currency: 'EUR', type: 'perso', guaranteed: false, probability: 0.7, status: 'en_retard', dueDate: '2026-01-31', lastContact: '2026-02-01', payments: [], notes: 'Pas de nouvelle depuis' },
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
      totalRealizedPL: 51079,  // EUR total P/L Degiro
      // Dividends from Degiro annual reports (EUR)
      dividends: {
        2021: { gross: 242.52, withholding: 48.33, net: 194.19 },
        2023: { gross: 183.25, withholding: 0, net: 183.25 },
      },
      totalDividendsNet: 377.44,  // EUR — sum of net dividends (2021 + 2023)
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
      //  Source: Gmail notifications@degiro.fr
      // ═══════════════════════════════════════════════════

      // ──────────────────────────────────────────────────
      // 2020 TRADES
      // ──────────────────────────────────────────────────
      { date: '2020-08-14', ticker: 'MC',    label: 'LVMH MOËT HENNESSY',             type: 'buy',  qty: 4,     price: 386,    currency: 'EUR', cost: 1544,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'MC.PA' },
      { date: '2020-08-19', ticker: 'PM',    label: 'Philip Morris International',   type: 'sell', qty: 20,    price: 79.55,  currency: 'USD', cost: '',     proceeds: 1591, realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2020-08-24', ticker: 'ACA',   label: 'Crédit Agricole',               type: 'buy',  qty: 35,    price: 8.484,  currency: 'EUR', cost: 297,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'ACA.PA' },
      { date: '2020-08-24', ticker: 'CAP',   label: 'Capgemini',                     type: 'buy',  qty: 10,    price: 115.4,  currency: 'EUR', cost: 1154,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'CAP.PA' },
      { date: '2020-08-25', ticker: 'SW',    label: 'Sodexo',                        type: 'sell', qty: 7,     price: 61.4,   currency: 'EUR', cost: '',     proceeds: 430, realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'SW.PA' },
      { date: '2020-08-25', ticker: 'CCL',   label: 'Carnival Corporation',          type: 'sell', qty: 10,    price: 15.41,  currency: 'USD', cost: '',     proceeds: 154, realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2020-08-25', ticker: 'CGC',   label: 'Canopy Growth Corporation',     type: 'sell', qty: 50,    price: 16.51,  currency: 'USD', cost: '',     proceeds: 826, realizedPL: '', commission: '', costBasis: '', source: 'degiro', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Dec 2023)' },
      { date: '2020-08-25', ticker: 'GOOS',  label: 'Canada Goose Holdings',         type: 'sell', qty: 9,     price: 23.87,  currency: 'USD', cost: '',     proceeds: 215, realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2020-08-26', ticker: 'FDX',   label: 'FedEx Corporation',             type: 'buy',  qty: 7,     price: 215.8,  currency: 'USD', cost: 1511,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2020-09-03', ticker: 'NKE',   label: 'Nike Inc',                      type: 'sell', qty: 10,    price: 116.7,  currency: 'USD', cost: '',     proceeds: 1167, realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2020-09-03', ticker: 'NVDA',  label: 'NVIDIA Corporation',            type: 'buy',  qty: 2,     price: 518,    currency: 'USD', cost: 1036,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', splitFactor: 40, note: 'Pre 4:1 (Jul 2021) + 10:1 (Jun 2024) splits' },
      { date: '2020-10-12', ticker: 'SAN',   label: 'Sanofi',                        type: 'sell', qty: 2,     price: 86.4,   currency: 'EUR', cost: '',     proceeds: 173, realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'SAN.PA' },
      { date: '2020-11-13', ticker: 'AF',    label: 'Air France-KLM',                type: 'sell', qty: 300,   price: 3.874,  currency: 'EUR', cost: '',     proceeds: 1162, realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'AF.PA', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Aug 2023)' },
      { date: '2020-11-13', ticker: 'KORI',  label: 'Korian (Clariane)',             type: 'sell', qty: 50,    price: 29.14,  currency: 'EUR', cost: '',     proceeds: 1457, realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'CLARI.PA', note: 'Korian rebranded to Clariane, ticker KORI→CLARI' },
      { date: '2020-11-13', ticker: 'ADP',   label: 'Aéroports de Paris',            type: 'sell', qty: 8,     price: 106.9,  currency: 'EUR', cost: '',     proceeds: 855, realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'ADP.PA', note: '4 fills: 2+2+1+3 @ 106.90' },
      { date: '2020-11-13', ticker: 'BA',    label: 'Boeing Company',                type: 'sell', qty: 15,    price: 186.5,  currency: 'USD', cost: '',     proceeds: 2798, realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2020-11-20', ticker: 'HTZ',   label: 'Hertz Global Holdings',         type: 'sell', qty: 100,   price: 1.13,   currency: 'USD', cost: '',     proceeds: 113, realizedPL: '', commission: '', costBasis: '', source: 'degiro', splitFactor: 0, note: 'Ch.11 bankruptcy Jun 2021 — old shares cancelled' },
      { date: '2020-12-18', ticker: 'SAP',   label: 'SAP SE (ADR)',                  type: 'buy',  qty: 20,    price: 127.3,  currency: 'USD', cost: 2546,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2020-12-18', ticker: 'INFY',  label: 'Infosys Limited (ADR)',         type: 'buy',  qty: 200,   price: 16.19,  currency: 'USD', cost: 3238,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro' },

      // ──────────────────────────────────────────────────
      // 2021 TRADES
      // ──────────────────────────────────────────────────
      { date: '2021-01-04', ticker: 'FIT',   label: 'Fitbit Inc',                    type: 'buy',  qty: 100,   price: 6.85,   currency: 'USD', cost: 685,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'Multi-fill: 50+50 = 100 total' },
      { date: '2021-01-14', ticker: 'FIT',   label: 'Fitbit Inc',                    type: 'sell', qty: 100,   price: 7.35,   currency: 'USD', cost: '',     proceeds: 735, realizedPL: 97.82, commission: '', costBasis: '', source: 'degiro', note: 'Google acquisition at $7.35/share (completed Jan 2021)' },
      { date: '2021-01-07', ticker: 'JUVE',  label: 'Juventus FC',                   type: 'buy',  qty: 1000,  price: 0.813,  currency: 'EUR', cost: 813,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'JUVE.MI', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Jan 2024)' },
      { date: '2021-01-22', ticker: 'IBM',   label: 'IBM Corporation',               type: 'buy',  qty: 10,    price: 118.2,  currency: 'USD', cost: 1182,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: '7 shares + 3 shares at same price' },
      { date: '2021-01-29', ticker: 'MC',    label: 'LVMH MOËT HENNESSY',            type: 'buy',  qty: 12,    price: 502.8,  currency: 'EUR', cost: 6034,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'MC.PA', note: '2 fills: 7+5 @ 502.80' },
      { date: '2021-01-29', ticker: 'GME',   label: 'GameStop Corp',                 type: 'buy',  qty: 20,    price: 340.93, currency: 'USD', cost: 6819,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'GME mania — same day buy/sell' },
      { date: '2021-01-29', ticker: 'GME',   label: 'GameStop Corp',                 type: 'sell', qty: 20,    price: 331.74, currency: 'USD', cost: '',     proceeds: 6635, realizedPL: -152.57, commission: '', costBasis: '', source: 'degiro', note: 'GME mania — sold at loss same day' },
      { date: '2021-01-29', ticker: 'CAP',   label: 'Capgemini',                     type: 'sell', qty: 36,    price: 119.85, currency: 'EUR', cost: '',     proceeds: 4315, realizedPL: 919.82, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'CAP.PA' },
      { date: '2021-01-29', ticker: 'ACA',   label: 'Crédit Agricole',               type: 'sell', qty: 280,   price: 9.404,  currency: 'EUR', cost: '',     proceeds: 2633, realizedPL: 284.59, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'ACA.PA' },
      { date: '2021-01-29', ticker: 'ACA',   label: 'Crédit Agricole',               type: 'buy',  qty: 140,   price: 9.398,  currency: 'EUR', cost: 1316,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'ACA.PA' },
      { date: '2021-01-29', ticker: 'V',     label: 'Visa Inc',                      type: 'sell', qty: 5,     price: 198.15, currency: 'USD', cost: '',     proceeds: 991, realizedPL: 15.53, commission: '', costBasis: '', source: 'degiro' },
      { date: '2021-02-08', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 1000,  price: 0.427,  currency: 'EUR', cost: 427,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA' },
      { date: '2021-02-09', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 3000,  price: 0.443,  currency: 'EUR', cost: 1329,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA' },
      { date: '2021-02-10', ticker: 'ATO',   label: 'Atos SE',                       type: 'sell', qty: 20,    price: 65.4,   currency: 'EUR', cost: '',     proceeds: 1308, realizedPL: 59.25, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'ATO.PA' },
      { date: '2021-02-11', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 4500,  price: 0.318,  currency: 'EUR', cost: 1431,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA', note: '4 fills: 977+902+1900+721 @ 0.318' },
      { date: '2021-02-11', ticker: 'SAP',   label: 'SAP SE (ADR)',                  type: 'sell', qty: 15,    price: 131.85, currency: 'USD', cost: '',     proceeds: 1978, realizedPL: 45.29, commission: '', costBasis: '', source: 'degiro', note: '2 fills: 13+2 @ 131.85' },
      { date: '2021-02-15', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 800,   price: 0.323,  currency: 'EUR', cost: 258,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA' },
      { date: '2021-02-19', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 3000,  price: 0.342,  currency: 'EUR', cost: 1026,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA' },
      { date: '2021-02-19', ticker: 'EUCAR', label: 'Europcar Groupe',               type: 'buy',  qty: 7000,  price: 0.344,  currency: 'EUR', cost: 2408,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA', note: '2560@0.344 + 4440@0.344 (merged)' },
      { date: '2021-03-01', ticker: 'JUVE',  label: 'Juventus FC',                   type: 'sell', qty: 1000,  price: 0.8304, currency: 'EUR', cost: '',     proceeds: 830, realizedPL: 8.33, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'JUVE.MI', splitFactor: 0.1, note: 'Pre reverse split 10:1 (Jan 2024)' },
      { date: '2021-03-01', ticker: 'FDX',   label: 'FedEx Corporation',             type: 'sell', qty: 7,     price: 260.7,  currency: 'USD', cost: '',     proceeds: 1825, realizedPL: 547.66, commission: '', costBasis: '', source: 'degiro' },
      { date: '2021-03-01', ticker: 'EN',    label: 'Bouygues',                      type: 'sell', qty: 50,    price: 34.22,  currency: 'EUR', cost: '',     proceeds: 1711, realizedPL: 442.02, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EN.PA' },
      { date: '2021-03-09', ticker: 'FDX',   label: 'FedEx Corporation',             type: 'sell', qty: 10,    price: 259.5,  currency: 'USD', cost: '',     proceeds: 2595, realizedPL: 778.93, commission: '', costBasis: '', source: 'degiro', note: '2 fills: 4+6 @ 259.50' },
      { date: '2021-03-09', ticker: 'IBM',   label: 'IBM Corporation',               type: 'sell', qty: 10,    price: 124.89, currency: 'USD', cost: '',     proceeds: 1249, realizedPL: 77.25, commission: '', costBasis: '', source: 'degiro' },
      { date: '2021-03-09', ticker: 'HYLN',  label: 'Hyliion Holdings (ex-SHLL)',    type: 'buy',  qty: 200,   price: 12.01,  currency: 'USD', cost: 2402,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'SHLL→HYLN merger Oct 2020. Degiro label was outdated.' },
      { date: '2021-03-10', ticker: 'HYLN',  label: 'Hyliion Holdings (ex-SHLL)',    type: 'buy',  qty: 150,   price: 11.505, currency: 'USD', cost: 1726,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: '50@11.52 + 100@11.505 (merged)' },
      { date: '2021-03-10', ticker: 'HYLN',  label: 'Hyliion Holdings (ex-SHLL)',    type: 'buy',  qty: 40,    price: 11.5,   currency: 'USD', cost: 460,    proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2021-05-10', ticker: 'SNPR',  label: 'Tortoise Acquisition II Corp',  type: 'buy',  qty: 200,   price: 9.99,   currency: 'USD', cost: 1998,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'SPAC — merged into Volta Inc (VLTA), then acquired by Shell' },
      { date: '2023-03-31', ticker: 'SNPR',  label: 'Volta Inc (ex-SNPR)',           type: 'sell', qty: 200,   price: 0.86,   currency: 'USD', cost: '',     proceeds: 172, realizedPL: -4183.2, commission: '', costBasis: '', source: 'degiro', note: 'Shell acquisition of VLTA at $0.86/share (Mar 2023)' },
      { date: '2021-06-24', ticker: 'EUCAR', label: 'Europcar Mobility Group',       type: 'sell', qty: 3500,  price: 0.463,  currency: 'EUR', cost: '',     proceeds: 1621, realizedPL: 445.67, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA' },
      { date: '2021-08-06', ticker: 'MC',    label: 'LVMH MOËT HENNESSY',            type: 'sell', qty: 16,    price: 701.9,  currency: 'EUR', cost: '',     proceeds: 11230, realizedPL: 3622.54, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'MC.PA' },
      { date: '2021-08-09', ticker: 'EUCAR', label: 'Europcar Mobility Group',       type: 'sell', qty: 15800, price: 0.498,  currency: 'EUR', cost: '',     proceeds: 7864, realizedPL: 2162.67, commission: '', costBasis: '', source: 'degiro', yahooTicker: 'EUCAR.PA', note: '11816@0.498 + 3984@0.498 (merged)' },
      { date: '2021-08-17', ticker: 'NVDA',  label: 'NVIDIA Corporation',            type: 'buy',  qty: 30,    price: 194.15, currency: 'USD', cost: 5825,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro', splitFactor: 10, note: 'Pre 10:1 split (June 2024)' },
      { date: '2021-08-19', ticker: 'DIS',   label: 'Walt Disney Company',           type: 'buy',  qty: 20,    price: 173.1,  currency: 'USD', cost: 3462,   proceeds: '', realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2021-09-24', ticker: 'DIS',   label: 'Walt Disney Company',           type: 'sell', qty: 30,    price: 175.45, currency: 'USD', cost: '',     proceeds: 5264, realizedPL: 749.58, commission: '', costBasis: '', source: 'degiro', note: '26+4 fills at same price (merged)' },

      // ──────────────────────────────────────────────────
      // 2023 TRADES
      // ──────────────────────────────────────────────────
      { date: '2023-07-27', ticker: 'SAP',   label: 'SAP SE',                        type: 'sell', qty: 27,    price: 135.2,  currency: 'EUR', cost: '',     proceeds: 3650, realizedPL: 0, commission: '', costBasis: '', source: 'degiro', note: 'SAP on Xetra (EUR)' },
      { date: '2023-07-27', ticker: 'NVDA',  label: 'NVIDIA Corporation',            type: 'sell', qty: 4,     price: 473.4,  currency: 'USD', cost: '',     proceeds: 1894, realizedPL: 1191.53, commission: '', costBasis: '', source: 'degiro', splitFactor: 10, note: 'Pre 10:1 split (June 2024)' },

      // ──────────────────────────────────────────────────
      // 2025 TRADES
      // ──────────────────────────────────────────────────
      { date: '2025-02-27', ticker: 'DIS',   label: 'Walt Disney Company',           type: 'sell', qty: 5,     price: 112.9,  currency: 'USD', cost: '',     proceeds: 565, realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2025-02-27', ticker: 'SPOT',  label: 'Spotify Technology SA',         type: 'sell', qty: 2,     price: 606.89, currency: 'USD', cost: '',     proceeds: 1214, realizedPL: '', commission: '', costBasis: '', source: 'degiro' },
      { date: '2025-04-07', ticker: 'NVDA',  label: 'NVIDIA Corporation',            type: 'sell', qty: 100,   price: 89.73,  currency: 'USD', cost: '',     proceeds: 8973, realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'April 2025 sell (from email)' },
      { date: '2025-04-07', ticker: 'NVDA',  label: 'NVIDIA Corporation',            type: 'sell', qty: 440,   price: 89.73,  currency: 'USD', cost: '',     proceeds: 39481, realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: 'April 2025 sell (from email)' },
      { date: '2025-04-07', ticker: 'INFY',  label: 'Infosys Limited (ADR)',         type: 'sell', qty: 300,   price: 16.95,  currency: 'USD', cost: '',     proceeds: 5085, realizedPL: '', commission: '', costBasis: '', source: 'degiro', note: '100@16.95 + 200@16.95 (merged)' },
    ],

    // ──────────────────────────────────────────────────────
    // PASSIF — dettes / obligations
    // ──────────────────────────────────────────────────────
    tva: -16000,             // TVA à payer (négatif = dette)
  },

  // ════════════════════════════════════════════════════════
  // NEZHA
  // ════════════════════════════════════════════════════════
  nezha: {
    // ── Cash détaillé Nezha (relevés mars 2026) ──
    cash: {
      revolutEUR: 27140,       // EUR — Revolut France (0%)
      creditMutuelCC: 10221,   // EUR — Crédit Mutuel compte courant (0%)
      lclLivretA: 23015,       // EUR — LCL Livret A (1.5% défiscalisé)
      lclCompteDepots: 31145,  // EUR — LCL Compte de dépôts (0%)
      attijariwafarMAD: 115528,// MAD — Attijariwafa Compte chèque MRE (0%)
      wioAED: 20106,           // AED — Wio Savings UAE (0%)
    },
    sgtm: { shares: 32 },   // SGTM Bourse Casablanca
    // ── ESPP Nezha — UBS Account W3 F0329 11 (relevé juin 2025) ──
    // Source : relevé UBS "Investment Account June 2025"
    // 40 actions ACN, cost basis total $10,544.20, valeur $11,955.60 au 30/06/2025
    // Cash UBS : $109.56 — dividendes YTD $71.04
    espp: {
      shares: 40,
      cashUSD: 109.56,   // Cash résiduel dans le compte UBS
      totalCostBasisUSD: 10544.20,
      lots: [
        { date: '2023-11-01', source: 'ESPP', shares: 8, costBasis: 255.148 },
        { date: '2024-05-01', source: 'ESPP', shares: 8, costBasis: 255.675 },
        { date: '2024-11-01', source: 'ESPP', shares: 8, costBasis: 294.431 },
        { date: '2025-05-01', source: 'ESPP', shares: 16, costBasis: 256.385 },
      ],
    },
    creances: {
      items: [
        { label: 'Omar', amount: 40000, currency: 'MAD', guaranteed: false, probability: 0.7, status: 'en_cours', dueDate: '2026-12-31', lastContact: '2026-01-15', payments: [], notes: '' },
      ],
    },
    // Caution locative Rueil — dépôt de garantie reçu du locataire, à rembourser au départ
    cautionRueil: 2600, // EUR — à déduire du patrimoine net (dette envers locataire)
    immo: {
      // { value: valeur estimée à valueDate, crd: capital restant dû, loyer: loyer mensuel }
      // La valeur évolue automatiquement avec le taux d'appréciation depuis valueDate
      rueil:     { value: 280000, valueDate: '2025-09', crd: 195275, loyerHC: 1300, chargesLocataire: 150 },
      // value: 280K = estimation sept 2025, 55.66m² × ~5 030€/m² (ancien rénové, 15K€ travaux réalisés)
      // Achat 255K (nov 2019) + 15K travaux = 270K investi
      // MeilleursAgents allée des Glycines : 4 445€/m² (moyenne rue, stock mixte)
      // Après rénovation : +10-12% vs non rénové → ~4 935-5 030€/m² = 275-280K
      villejuif: { value: 370000, valueDate: '2025-09', crd: 318470, loyerHC: 1700, signed: false, reservationFees: 3600 },
      // value: 370K = estimation sept 2025, 68.92m² × ~5 369€/m² (VEFA neuf, en construction)
      // Opération totale : 349 456€ avec remise résident Villejuif
      // efficity Bd Gorki jan 2026 : 5 050€/m² (ancien), prime neuf +6%
      // MeilleursAgents Bd Gorki : 5 138€/m² (ancien moyen)
      // Neuf VEFA face station L15 Louis Aragon : ~5 400-5 600€/m²
      // Valeur conservatrice en construction (livraison été 2029)
    },
  },

  // ════════════════════════════════════════════════════════
  // PRIX DE MARCHÉ (mis à jour automatiquement par API)
  // ════════════════════════════════════════════════════════
  market: {
    sgtmPriceMAD: 717,       // Cours SGTM en MAD (séance 11 Mar 2026) — casablanca-bourse.com
    sgtmCostBasisMAD: 420,   // Prix d'achat IPO (offre grand public, déc 2025)
    acnPriceUSD: 201.63,     // Cours Accenture en USD — mis à jour 11/03/2026
    // Prix de référence historiques pour P&L (stockés une fois, pas re-fetchés)
    acnYtdOpen: 259.95,      // ACN clôture 2 jan 2026
    acnMtdOpen: 205.93,      // ACN clôture 3 mar 2026
    acnOneMonthAgo: 240.86,  // ACN clôture ~10 fév 2026
  },
};

// ════════════════════════════════════════════════════════════
// DATE DE DERNIÈRE MISE À JOUR DES DONNÉES STATIQUES
// Utilisée pour afficher "données du XX" pendant le chargement
// Format : 'JJ/MM/YYYY' — à mettre à jour à chaque modification de data.js
// ════════════════════════════════════════════════════════════
export const DATA_LAST_UPDATE = '18/03/2026';

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
  // --- Nezha (détaillé par compte) ---
  nezhaRevolutEUR: 0,       // Revolut EUR — pas de rendement
  nezhaCreditMutuel: 0,     // Crédit Mutuel CC — pas de rendement
  nezhaLivretA: 0.015,      // LCL Livret A — 1.5% (depuis fév 2026, défiscalisé)
  nezhaLclDepots: 0,        // LCL Compte dépôts — pas de rendement
  nezhaAttijariMAD: 0,      // Attijariwafa Maroc — pas de rendement
  nezhaWioAED: 0,           // Wio UAE — pas de rendement (0% sur screenshot)
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
// Source : xe.com — Dernière vérification : 10 mars 2026
// ════════════════════════════════════════════════════════════
export const FX_STATIC = {
  EUR: 1,
  AED: 4.2500,       // Xe 12/03: ~4.25 (AED pegged to USD, EUR/USD 1.157)
  MAD: 10.8500,      // Xe 12/03: ~10.85
  USD: 1.1570,       // Xe 11/03: 1.1570
  JPY: 183.00,       // Xe 12/03: ~183.00
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
  // growth: calculé dynamiquement dans engine.js depuis amortSchedules + appreciation + CF
  // Ancien hardcodé supprimé — voir wealthBreakdown dans computeImmoView()
  villejuifStartMonth: 40, // Été 2029 ~ 40 mois à partir de mars 2026
  charges: {
    // { pret: mensualité, assurance, pno: assurance propriétaire, tf: taxe foncière/12, copro }
    vitry:     { pret: 1166, assurance: 17, pno: 15, tf: 75, copro: 150 },  // pret: AL 145.20 + BP 1020.55 + PTZ 0 ≈ 1166, ass: APRIL 17.48 ≈ 17
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
      months: 36,
      startDate: null,         // Prêt non encore débloqué — franchise non commencée
      loanDisbursed: false,    // Nezha n'a pas encore signé l'offre / débloqué le prêt
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
    vitry:     { regime: 'reel-foncier', tmi: 0.20, ps: 0.172, type: 'nu' },
    // Vitry : loyerDeclare (500€/mois) est dans portfolio.amine.immo.vitry
    // Régime réel : on déduit intérêts d'emprunt, assurance, PNO, TF, copro
    // TMI 20% + PS 17.2% = taux effectif ~37% sur le revenu net
    rueil:     { regime: 'lmnp-amort', tmi: 0.20, ps: 0.172, type: 'lmnp', lmnpStartDate: '2025-10' },
    // LMNP réel avec amortissement → impôt = 0 (amortissement > revenu net)
    // lmnpStartDate: date de passage en LMNP (bail signé sept 2025, prise effet oct 2025)
    // Amortissement commence à cette date, pas à la date d'achat (2019)
    villejuif: { regime: 'lmnp-amort', tmi: 0.20, ps: 0.172, type: 'lmnp', lmnpStartDate: '2029-09' },
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
      surface: 68.92,           // m²
      purchasePrice: 349456,    // prix d'achat total opération VEFA
      totalOperation: 349456,   // montant total opération VEFA
      purchaseDate: '2025-04',  // signature VEFA
      deliveryDate: '2029-06',  // livraison été 2029
      // ── Appréciation réaliste par phase ──
      // 2025-2028 : 3.0%/an — L15 Sud ouverture avril 2027, déjà L14 prolongée,
      //   en face station Villejuif Louis Aragon (future L15), pôle santé Gustave Roussy
      //   MeilleursAgents: Bd Gorki ~5 138€/m², hausse +20% entre 2021-2025
      //   efficity: 5 050€/m² jan 2026, +6% vs ville
      // 2029+ : 1.5%/an — livraison du bien, L15 roulera depuis 2 ans, effet déjà pricé
      // Moyenne lissée sur 10 ans ≈ 2.0%/an
      appreciation: 0.02,        // 2.0%/an (moyenne lissée, hub L14+L15, pôle santé)
      appreciationPhases: [
        { start: 2025, end: 2028, rate: 0.030, note: 'Anticipation L15 + L14 déjà là, pôle santé Gustave Roussy' },
        { start: 2029, end: 2040, rate: 0.015, note: 'Livraison bien, L15 roulera depuis 2 ans, effet pricé' },
      ],
      type: 'T3 — VEFA — LMNP',
      ligne15: { station: 'Villejuif Louis Aragon', distance: 'En face (<1 min)', opening: '2027-04' },
      details: {
        lot: 'A27',
        floor: '2ème étage',
        building: null,
        type: 'T3',
        yearBuilt: 2029,
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
        surfaceHabitable: 68.94,
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
      taux: 0.01,               // 1%/an
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
    note: 'VEFA — choix régime à faire avant livraison (été 2029)',
    timeline: [
      { date: '2025-04', event: 'Signature VEFA (réservation — 3 600€ versés)', icon: 'doc', done: true },
      { date: '2025-08', event: 'Offre de prêt LCL (287K + 32K, franchise 36 mois)', icon: 'bank' },
      { date: '2026-06', event: 'Choix régime fiscal (LMNP vs Jeanbrun) — décision avant livraison', icon: 'tax' },
      { date: '2027-04', event: 'Ouverture L15 Sud — station Villejuif Louis Aragon', icon: 'metro' },
      { date: '2028-08', event: 'Fin franchise → début remboursement (1 698€/mois)', icon: 'money' },
      { date: '2029-06', event: 'Livraison VEFA + remise des clés', icon: 'key' },
      { date: '2029-09', event: 'Début location (LMNP ou Jeanbrun)', icon: 'home' },
      { date: '2031-06', event: 'Fin exonération TF (construction neuve 2 ans)', icon: 'tax' },
      { date: '2035-04', event: '10 ans détention — abattement PV IR commence', icon: 'tax' },
      { date: '2052-08', event: 'Fin prêts LCL (Prêt 1 + Prêt 2)', icon: 'check' },
      { date: '2055-04', event: '30 ans détention — exonération totale IR + PS', icon: 'free' },
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
        'Montant : 40 000€ à 1%',
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
// Le bien sera livré été 2029. Il faut choisir le régime AVANT.
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
    totalOperation: 349456,
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
      loyerMaxMensuel: 1215,  // 68.92m² × 17.62 = 1 214€ (arrondi)
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
      appreciationAnnuelle: 0.02,   // 2%/an
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
