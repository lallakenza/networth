/**
 * Tests d'acceptation — les égalités que l'écran promet au lecteur.
 *
 * Chacune de ces assertions correspond à une contradiction constatée à l'écran, pas à une
 * hypothèse d'implémentation : un total qui ne valait pas la somme de ses lignes, deux
 * pourcentages pour une même notion, un périmètre réutilisé sous deux noms. Elles portent
 * sur le RÉSULTAT du moteur, de sorte qu'une refonte interne qui préserve les chiffres les
 * laisse passer, et qu'une refonte qui les casse échoue.
 */
import assert from 'node:assert/strict';
import { PORTFOLIO } from '../js/data.js';
import { compute } from '../js/engine.js';

const fx = { USD: 1.17, JPY: 172, AED: 4.30, MAD: 10.75 };
const s = compute(PORTFOLIO, fx, 'static');
const av = s.actionsView, cv = s.cashView, iv = s.immoView;

let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };
const proche = (a, b, tol, quoi) => assert.ok(Math.abs(a - b) <= tol,
  quoi + ' : ' + Math.round(a).toLocaleString('fr-FR') + ' ≠ ' + Math.round(b).toLocaleString('fr-FR')
  + ' (écart ' + Math.round(Math.abs(a - b)).toLocaleString('fr-FR') + ', toléré ' + tol + ')');

console.log('\n── acceptation ──');

// ── 1. Le patrimoine du couple est la somme des deux patrimoines ────────────────────────
t('Couple = Amine + Nezha', () => {
  proche(s.couple.nw, s.amine.nw + s.nezha.nw, 2, 'NW couple');
});

t('views.couple.other = views.amine.other + views.nezha.other', () => {
  proche(s.views.couple.other.val, s.views.amine.other.val + s.views.nezha.other.val, 2, 'poste « autre »');
});

t('chaque vue : stocks + cash + immo + autre = NW de la vue', () => {
  ['couple', 'amine', 'nezha'].forEach((v) => {
    const V = s.views[v];
    proche(V.stocks.val + V.cash.val + V.immo.val + V.other.val, V.nwRef, 2, 'somme des catégories (' + v + ')');
  });
});

// ── 2. Le tableau des positions et la carte « Total » se rejoignent ─────────────────────
t('titres + cash courtier − dette de marge = NAV du compte-titres', () => {
  const r = av.reconciliation;
  proche(r.valTitres + r.cashCourtier + r.detteMarge, r.nav, 1, 'réconciliation');
  proche(r.nav, av.totalStocks, 1, 'NAV vs carte « Total »');
});

t('le P&L latent est titres − coût des titres détenus, et rien d’autre', () => {
  const r = av.reconciliation;
  proche(r.valTitres - r.coutTitres, r.plLatent, 1, 'latent');
  proche(r.plLatent, av.combinedUnrealizedPL, 1, 'latent vs combinedUnrealizedPL');
});

t('le P&L latent en % est rapporté au coût des titres, pas au capital déployé', () => {
  const r = av.reconciliation;
  proche(r.plLatentPct, r.plLatent / r.coutTitres * 100, 0.01, 'dénominateur du latent');
  assert.notEqual(
    Math.round(r.plLatent / r.coutTitres * 1000),
    Math.round(r.plLatent / r.capitalDeploye * 1000),
    'les deux dénominateurs coïncident : le test ne discrimine plus rien',
  );
});

t('la concentration porte sur les lignes réellement listées', () => {
  const c = av.concentration;
  const attendu = av.ibkrPositions.length
    + ((av.esppShares + (av.nezhaEsppShares || 0)) > 0 ? 1 : 0)
    + (av.sgtmTotal > 0 ? 1 : 0);
  assert.equal(c.nbLignes, attendu, 'nombre de lignes');
  assert.ok(c.top3Pct > 0 && c.top3Pct <= 100, 'top 3 hors bornes : ' + c.top3Pct);
  proche(c.top3.reduce((a, x) => a + x.pct, 0), c.top3Pct, 0.01, 'top3Pct = Σ des 3 poids');
});

t('la dette de marge est un passif, jamais du cash', () => {
  assert.ok(av.reconciliation.detteMarge <= 0, 'la dette devrait être ≤ 0');
  assert.ok(av.reconciliation.cashCourtier >= 0, 'le cash courtier devrait être ≥ 0');
});

// ── 3. Le cash : somme, et périmètres distincts ─────────────────────────────────────────
t('la somme des comptes (hors dette) fait le cash total', () => {
  // La ligne « IBKR Cash JPY » est un EMPRUNT de marge. Elle figure au tableau — il faut la
  // voir — mais elle n'entre pas dans le cash total. Qui additionne la colonne trouve donc
  // 9 355 € de moins que la carte. L'écart est légitime ; il doit être écrit, et c'est ce
  // que vérifie l'assertion suivante.
  const somme = cv.accounts.filter((c) => !c.isDebt).reduce((a, c) => a + c.valEUR, 0);
  proche(somme, cv.totalCash, 2, 'Σ comptes hors dette');
});

t('la ligne de dette est présente au tableau, et négative', () => {
  const dettes = cv.accounts.filter((c) => c.isDebt);
  assert.ok(dettes.length > 0, 'aucune ligne de dette : la dette de marge a disparu du tableau');
  dettes.forEach((d) => assert.ok(d.valEUR < 0, d.label + ' marquée dette mais positive'));
  const brut = cv.accounts.reduce((a, c) => a + c.valEUR, 0);
  assert.ok(Math.abs(brut - cv.totalCash) > 1,
    'si la somme brute égale le total, la note d’exclusion à l’écran est devenue fausse');
});

t('cash battant l’inflation + cash sous l’inflation = cash total', () => {
  proche(cv.totalYielding + cv.totalNonYielding, cv.totalCash, 2, 'partition inflation');
});

t('cash ≥ 6 % + cash < 6 % = cash total', () => {
  const f = cv.coupleFrame;
  proche(f.optimalCash + f.subOptimalCash, cv.totalCash, 2, 'partition benchmark');
});

t('les seuils 3 % et 6 % sont deux critères, et la coïncidence est signalée', () => {
  const memeMontant = Math.abs(cv.coupleFrame.subOptimalCash - cv.totalNonYielding) < 1;
  assert.equal(cv.seuilsConfondus, memeMontant,
    'seuilsConfondus doit refléter l’état réel — sinon l’écran annonce deux constats pour un seul');
});

// ── 4. Immobilier : les flux se recomposent ─────────────────────────────────────────────
t('par bien : recettes − charges = cash-flow', () => {
  iv.properties.forEach((p) => {
    proche((p.totalRevenue || 0) - (p.charges || 0), p.cf, 1, 'CF de ' + (p.label || p.loanKey));
  });
});

t('les biens conditionnels sont hors flux mais dans le bilan', () => {
  const cond = iv.properties.filter((p) => p.conditional);
  cond.forEach((p) => {
    assert.ok(p.equity !== undefined, (p.label || p.loanKey) + ' absent du bilan');
  });
});

// ── 5. Provenance de la facturation ─────────────────────────────────────────────────────
t('la provenance de la facturation est toujours renseignée', () => {
  const m = s.amine._facturationMeta;
  assert.ok(m && m.canal, 'métadonnées absentes');
  assert.ok(['à jour', 'à rafraîchir', 'périmé', 'inconnue'].includes(m.fraicheur),
    'fraîcheur inattendue : ' + m.fraicheur);
});

t('hors navigateur, le repli data.js est actif et le motif est écrit', () => {
  const m = s.amine._facturationMeta;
  assert.equal(m.canal, 'data.js (hors ligne)');
  assert.equal(m.motifRepli, 'contrat absent');
});

console.log(ko === 0 ? '\n✅ acceptation : tout passe\n' : '\n❌ ' + ko + ' échec(s)\n');
process.exit(ko === 0 ? 0 : 1);
