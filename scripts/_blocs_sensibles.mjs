// Liste UNIQUE des exports de js/data.js à chiffrer (build_encrypted_data.mjs) et à vider en
// coquilles (split_data_for_encryption.mjs). Un seul endroit : les deux scripts ne peuvent plus
// diverger et oublier un bloc — c'est ainsi qu'un nouveau bloc sensible (VILLEJUIF_ACTE,
// RESIDENCE_FISCALE) a failli rester en clair après la v543.
//
// Chaque entrée : [nom, typeCoquille]. La coquille garde le TYPE pour que unlock.js remplisse en
// place la référence partagée par les imports (un tableau ne se remplit pas comme un objet).
// Seuls des objets/tableaux : un scalaire ne se mute pas en place, il resterait en clair.
export const BLOCS_SENSIBLES = [
  ['PORTFOLIO', '{}'],
  ['IMMO_CONSTANTS', '{}'],
  ['VITRY_CONSTRAINTS', '{}'],
  ['VILLEJUIF_CONSTRAINTS', '{}'],
  ['VILLEJUIF_ACTE', '{}'],
  ['IMMO_PASSIFS_DOCUMENTES', '[]'],
  ['RESIDENCE_FISCALE', '{}'],
  ['NW_HISTORY', '[]'],
  ['EQUITY_HISTORY', '[]'],
  ['MONTHLY_INCOMES', '[]'],
  ['BUDGET_EXPENSES', '[]'],
  ['DEGIRO_STATIC_PRICES', '{}'],
  ['PRICE_REFS_AS_OF', '{}'],
  // v555 — registres ajoutés en v551/v555, restés hors de la liste par oubli : ils nomment des
  // tiers et des montants (fonds RTL d'Azarkan, frais Igal) et des soldes de comptes.
  ['FONDS_DE_TIERS', '[]'],
  ['ECARTS_DE_REGLEMENT', '[]'],
  ['SOLDES_RETROACTIFS', '{}'],
  // v563 — soldes bancaires jour par jour et patrimoines reconstitués.
  ['RELEVES_QUOTIDIENS', '{}'],
  ['SNAPSHOTS_RECONSTRUITS', '{}'],
  // v566 — historique recalculé au modèle actuel (immobilier, facturation).
  ['IMMO_RECALCULE', '{}'],
  ['FACTURATION_HISTORIQUE', '[]'],
];
export const NOMS_SENSIBLES = BLOCS_SENSIBLES.map(([n]) => n);
export const COQUILLES = Object.fromEntries(BLOCS_SENSIBLES);
