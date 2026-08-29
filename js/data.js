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

// PORTFOLIO — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
export const PORTFOLIO = {};

// ════════════════════════════════════════════════════════════
// DATES DE RÉFÉRENCE DES PRIX HISTORIQUES (anti-péremption silencieuse)
// ════════════════════════════════════════════════════════════
// v483 — CES DATES SONT DÉSORMAIS AUTO-RAFRAÎCHIES AU RUNTIME (app.js applyPriceRefs) :
// à chaque chargement, les refs des positions TENUES + ACN sont recalculées depuis les
// séries Yahoo du graphe et PRICE_REFS_AS_OF est muté en conséquence. Les valeurs figées
// ci-dessous ne servent plus que de FALLBACK hors-ligne (la garde v368 les masque si
// périmées). Les tickers VENDUS gardent leurs refs figées (Yahoo réajuste rétroactivement
// après splits — unités ≠ journal, cf. WLN).
// v368 (BUG-070) — mtdOpen / oneMonthAgo / oneYearAgo sont des prix FIGÉS dans data.js
// (l'API ne rafraîchit que previousClose). Ils étaient restés à une vintage mars/avril 2026
// alors que l'engine les appariait à des DATES de début de période calculées correctement
// → un prix de mars comparé à une fenêtre de juillet (écart engine MTD −6 115 vs réel).
//
// Ces dates déclarent À QUELLE DATE chaque prix de référence a été relevé. L'engine les
// compare aux bornes qu'il calcule et DÉGRADE (hasData=false → « -- ») au lieu d'afficher
// un chiffre faux. Rafraîchir mtdOpen le 1er de chaque mois et oneMonthAgo/oneYearAgo
// avec, puis mettre ces dates à jour.
// PRICE_REFS_AS_OF — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
export const PRICE_REFS_AS_OF = {};

// ════════════════════════════════════════════════════════════
// DATE DE DERNIÈRE MISE À JOUR DES DONNÉES STATIQUES
// Utilisée pour afficher "données du XX" pendant le chargement
// Format : 'JJ/MM/YYYY' — à mettre à jour à chaque modification de data.js
// ════════════════════════════════════════════════════════════
export const DATA_LAST_UPDATE = '28/08/2026';
export const APP_VERSION = 'v499';

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
// DEGIRO_STATIC_PRICES — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
export const DEGIRO_STATIC_PRICES = {};

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
  // --- Revolut / Banque Populaire / Binance ---
  revolutEUR: 0,       // Pas de rendement (pas de coffre activé)
  banquePopulaire: 0,  // Compte individuel BP, pas de rendement
  binanceUSDT: 0,      // USDT Funding Binance, pas de rendement (hors Earn)
  // --- Maroc ---
  attijari: 0,         // Compte courant, pas de rendement
  nabd: 0,             // Compte courant, pas de rendement
  cih: 0,              // CIH compte chèques, pas de rendement
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
  nezhaWioAED: 0.06,        // Wio — espace d'épargne fixe (« Flouss nezha pas touchi ») : 6%, comme tous les saving spaces Wio — MAJ 28/08/2026
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
// IMMO_CONSTANTS — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
export const IMMO_CONSTANTS = {};

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
  // v477 — non-résident hors EEE (résidence fiscale EAU) : représentant fiscal accrédité
  // OBLIGATOIRE (art. 244 bis A IV CGI, BOI-RFPI-PVINR-30-20) sauf prix ≤ 150K ou détention
  // > 30 ans. Barème de place 0,4-1% du prix — on retient 0,7% (milieu de fourchette).
  representantFiscal: { pct: 0.007, seuilPrix: 150000, exemptionDetentionAnnees: 30 },
  // v477 — exonération non-résident art. 150 U II 2° : 150 000 € de PV nette, JETON UNIQUE
  // (un seul bien, une seule fois), cession avant le 31/12 de la 10e année suivant le départ.
  // NON appliquée automatiquement : arbitrage à poser entre Vitry / Rueil / Villejuif.
  // L'exo « ancienne résidence principale » est FERMÉE (EAU sans convention d'assistance
  // au recouvrement, BOI-ANNX-000508).
  exoNonResident150k: { plafond: 150000, applique: null },
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
    // v478 — clause anti-spéculative de l'acte (16/01/2023, 5 ans → 16/01/2028) : même
    // mécanique de restitution que SADEV Villejuif (plus-value au-delà du prix indexé ICC).
    // Aujourd'hui INOPÉRANTE (valeur DVF 280 K < prix indexé ~292 K) mais datée dans les
    // projections pré-2028. Le DVF montre par ailleurs que la clause ne produit AUCUNE
    // décote de prix — c'est un coût de liquidité (analyse 27/08/2026).
    clauseAntiSpec: { dateFin: '2028-01', iccAnnuelHypothese: 0.02 },
    tvaReduite: {
      tauxReduit: 0.055,
      tauxNormal: 0.20,
      dureeEngagement: 10,       // années depuis livraison
      prixHTApprox: 260000,      // prix HT approximatif (275K TTC à TVA 5.5%)
      dateLivraison: '2025-07',  // obligation 10 ans commence à la livraison VEFA
      dateFinObligation: '2035-07', // fin obligation TVA (historique)
      // v458 — exception « naissance » ACQUISE (26/08/2026) : engagement RP levé,
      // AUCUN complément de TVA à provisionner → clawback = 0 dans les frais de sortie.
      exceptionAcquise: true,
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
      { date: '2030-06', event: 'Ouverture L15 Ouest — gare Rueil-Suresnes (fourchette 2030-2032), effet indirect à 15-20 min à pied', icon: 'metro' },
      { date: '2030-11', event: '11 ans détention — abattement IR 36%, PS 8.25%', icon: 'tax' },
      { date: '2041-11', event: '22 ans détention — exonération totale IR (100%)', icon: 'free' },
      { date: '2044-12', event: 'Fin prêt Crédit Mutuel (25 ans)', icon: 'check' },
      { date: '2049-11', event: '30 ans détention — exonération totale IR + PS (100%)', icon: 'free' },
    ],
  },
  villejuif: {
    // VEFA en cours — pas encore livré
    // LMNP ou foncier nu selon le choix (Jeanbrun non retenu — v440)
    // Si LMNP réel : même règle de réintégration des amortissements
    lmnpAmortReintegration: true,
    note: 'VEFA — choix régime à faire avant livraison (Q3 2028)',
    timeline: [
      { date: '2025-06', event: 'Signature contrat de réservation (dépôt 3 363€)', icon: 'doc', done: true },
      { date: '2025-08', event: 'Offre de prêt LCL (287K + 32K, franchise 36 mois)', icon: 'bank', done: true },
      { date: '2026-06', event: 'Acte de vente signé (Me Wysocki, Évry — 34% appelés soit 114 352€)', icon: 'doc', done: true },
      { date: '2027-10', event: 'Ouverture L15 Sud — station Villejuif Louis Aragon (automne 2027, 4e report SGP 25/06/2026)', icon: 'metro' },
      { date: '2028-09', event: 'Livraison VEFA + remise des clés (Q3 2028 — acte : max 30/06/2028)', icon: 'key' },
      { date: '2028-10', event: 'Début location (LMNP)', icon: 'home' },
      { date: '2028-11', event: '1re mensualité P2 (124,25 € — sur capital tiré) puis P1 en fév 2029 (345,70 €) ; recalcul à chaque appel de fonds, cible ~1 698 € au tirage plein', icon: 'money' },
      { date: '2028-01', event: 'Choix régime fiscal (LMNP vs foncier nu) — décision avant 1ère mise en location', icon: 'tax' },
      { date: '2030-03', event: 'Fin exonération TF (construction neuve 2 ans)', icon: 'tax' },
      { date: '2035-06', event: '10 ans détention — abattement PV IR commence', icon: 'tax' },
      { date: '2053-01', event: 'Dernière échéance des 2 prêts LCL (tableaux définitifs : 05/01/2053)', icon: 'check' },
      { date: '2055-06', event: '30 ans détention — exonération totale IR + PS', icon: 'free' },
    ],
  },
};

// ════════════════════════════════════════════════════════════
// CONTRAINTES VITRY — Rappel de toutes les obligations
// liées aux dispositifs de financement et TVA réduite
// ════════════════════════════════════════════════════════════
// VITRY_CONSTRAINTS — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
export const VITRY_CONSTRAINTS = {};

// ════════════════════════════════════════════════════════════
// CONTRAINTES VILLEJUIF (v415) — clause de restitution des avantages
//
// Découverte en lisant l'acte authentique du 05/06/2026 (p.18-19). Elle était
// ABSENTE du modèle alors que c'est la contrainte la plus lourde du bien.
//
// Pourquoi elle existe : le lot A27 a été acquis ~25% sous le prix du même
// immeuble (336 330 € soit 4 880 €/m², contre 400 000-438 000 € / 6 280-6 530 €/m²
// pour les T3 encore commercialisés en 08/2026). Cette décote est une condition
// de la Ville de Villejuif ; la clause en est la contrepartie.
//
// ⚠️ NON MODÉLISÉE dans le calcul patrimonial : choix explicite de valoriser au
// marché (voir PORTFOLIO.nezha.immo.villejuif.value). La clause est une contrainte
// de LIQUIDITÉ, pas une dépréciation — le bien n'est pas destiné à la revente
// avant l'échéance. Elle est documentée ici pour ne pas être oubliée à la décision.
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// PASSIFS ET LITIGES IMMOBILIERS DOCUMENTÉS (v422)
//
// Découverts en dépouillant le dossier iCloud 04 - Perso/Immobilier.
// ⚠️ AUCUN de ces montants n'est encore branché dans le calcul du patrimoine :
// leur statut à ce jour n'est pas établi par un document. Ils sont consignés ici
// pour décision. Voir la règle CLAUDE.md §3 : brancher un passif oblige à le
// déclarer dans autreTotal, les deux tables de breakdown, le treemap, les insights
// ET les trois cartes views.*.other, puis à revérifier les invariants.
// ════════════════════════════════════════════════════════════
// IMMO_PASSIFS_DOCUMENTES — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
export const IMMO_PASSIFS_DOCUMENTES = [];

// VILLEJUIF_CONSTRAINTS — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
export const VILLEJUIF_CONSTRAINTS = {};
// v440 — VILLEJUIF_REGIMES supprimé : dispositif Jeanbrun non retenu (loyer plafonné
// 1 215€ vs 1 700€ marché), section comparative retirée de la fiche. Historique : git ≤ v439.


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
// NW_HISTORY — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
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
// EQUITY_HISTORY — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
export const EQUITY_HISTORY = [];

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
  netherlands: 0.15,  // v493 (audit) — Airbus SE a son siège aux Pays-Bas bien qu'elle cote à Paris :
                      // la retenue suit le pays de SOURCE du dividende, pas la place de cotation.
                      // Vérifié sur le versement du 23/04/2026 : 640 € brut − 96 € = 15 %.
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

// v479 — hypothèses du prolongement du graphe NW dans le futur (graphe fusionné).
// Rendements marché ANNUELS par scénario (bande p10-p90 affichée, médiane p50 en ligne).
// Contribution : hypothèse du simulateur (8K/mois pendant 3 ans) — à faire piloter par
// les sliders du simulateur dans une itération future.
export const PROJECTION_HYPOTHESES = {
  contributionMensuelle: 8000,
  dureeContributionsMois: 36,
  rendements: { p10: 0.03, p50: 0.07, p90: 0.10 },
  horizonMois: 240,
};

// MONTHLY_INCOMES — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
export const MONTHLY_INCOMES = [];

// BUDGET_EXPENSES — CHIFFRÉ. Coquille remplie au chargement par js/unlock.js
// (données dans js/data.enc.js). Source en clair : hors dépôt, voir scripts/build_encrypted_data.mjs.
export const BUDGET_EXPENSES = [];

