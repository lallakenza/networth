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
import { readFileSync } from 'node:fs';

// Le moteur lit le contrat de facturation dans le localStorage au moment du calcul : il doit
// donc y être AVANT l'import. C'est la fixture du contrat réellement publié par 2048.
const _mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in _mem ? _mem[k] : null),
  setItem: (k, v) => { _mem[k] = String(v); },
  removeItem: (k) => { delete _mem[k]; },
};
const CONTRAT = {
  schemaVersion: '1.0.0', producerVersion: 'v7.36',
  generatedAt: '2026-09-05T20:42:11.904Z',
  dataAsOf: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  currency: 'MAD',
  signConvention: 'positif = le tiers doit à Amine ; négatif = Amine doit au tiers',
  positionsGross: { augustin: 66239, benoit: 17566, bob: -92376 },
  netPositionMad: -8571, nettingApplied: false,
};
_mem['nw_facturation_contrat_v1'] = JSON.stringify({ recuLe: Date.now(), canal: 'http', contrat: CONTRAT });

const { PORTFOLIO } = await import('../js/data.js');
const { compute, computeAlerts } = await import('../js/engine.js');
const { INFLATION_RATE } = await import('../js/data.js');

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

// ── 5. Passerelle 2048 : les quatre états ──────────────────────────────────────────────
t('contrat valide : comptabilisé, provenance complète', () => {
  const m = s.amine._facturationMeta;
  assert.equal(m.canal, 'contrat distant (HTTP)');
  assert.equal(m.schemaVersion, '1.0.0');
  assert.equal(m.producerVersion, 'v7.36');
  assert.equal(m.fraicheur, 'frais');
  assert.equal(m.netMAD, -8571);
  proche(s.amine.facturationNet, -8571 / fx.MAD, 1, 'conversion MAD→EUR');
});

t('les positions brutes sont séparées, jamais compensées', () => {
  const m = s.amine._facturationMeta;
  assert.equal(m.positions.length, 3, 'trois tiers attendus');
  const lignes = (s.creancesView.activeItems || []).filter((i) => i.positionCourante);
  assert.equal(lignes.length, 2, 'Augustin et Benoit doivent apparaître séparément');
  const dettes = (s.creancesView.dettes || []).filter((d) => /Bob/.test(d.label));
  assert.equal(dettes.length, 1, 'la dette envers Bob doit rester une ligne à part');
  // Aucune ligne ne doit porter le NET : ce serait la compensation qu'on refuse.
  const toutes = [...(s.creancesView.activeItems || []), ...(s.creancesView.dettes || [])];
  assert.ok(!toutes.some((x) => Math.abs(Math.abs(x.amount) - 8571) < 1),
    'une ligne porte le net compensé (8 571) au lieu des positions brutes');
});

t('une position courante garde une échéance nulle et n’est jamais « en retard »', () => {
  const lignes = (s.creancesView.activeItems || []).filter((i) => i.positionCourante);
  lignes.forEach((l) => {
    assert.equal(l.dueDate, null, l.label + ' : dueDate devrait être null');
    assert.equal(l.status, 'en_cours');
  });
  const alertes = computeAlerts(s) || [];
  lignes.forEach((l) => {
    const enRetard = alertes.filter((a) => a.severity === 'red' && a.title.includes(l.counterparty));
    assert.equal(enRetard.length, 0, l.counterparty + ' signalé en retard sans échéance');
  });
});

t('les alertes de facturation emploient une formulation naturelle', () => {
  const alertes = (computeAlerts(s) || []).filter((a) => /Position de facturation/.test(a.title));
  assert.equal(alertes.length, 2);
  ['Augustin', 'Benoit'].forEach((nom) => {
    const a = alertes.find((x) => x.title.includes(nom));
    assert.ok(a, 'alerte manquante pour ' + nom);
    assert.match(a.msg, new RegExp(nom + ' doit .* à Amine'));
    assert.ok(!/me doit/.test(a.msg), 'formulation « me doit » résiduelle');
  });
});

t('aucune valeur financière de facturation n’est codée en dur dans data.js', () => {
  const src = readFileSync(new URL('../js/data.js', import.meta.url), 'utf8');
  assert.ok(!/181609|196915/.test(src), 'les anciens montants de facturation subsistent dans data.js');
  // L'URL du contrat en commentaire est de la documentation, pas une valeur : on ne
  // cherche que des MONTANTS.
  assert.ok(!/\b8571\b|\b66239\b|\b92376\b|\b17566\b/.test(src),
    'un montant du contrat a été recopié dans data.js');
});

// ── 6. Pont avec la NAV du graphe ───────────────────────────────────────────────────────
t('le pont graphe↔canonique expose ses composantes', () => {
  const r = av.reconciliation;
  ['cashEUR', 'cashUSDeur', 'cashAEDeur', 'cashJPYeur', 'esppCashTotal'].forEach((k) => {
    assert.equal(typeof r[k], 'number', 'composante ' + k + ' absente du pont');
  });
  // Le cash courtier canonique se recompose de ses parts positives, plus l'ESPP.
  const positives = Math.max(0, r.cashEUR) + Math.max(0, r.cashUSDeur)
    + Math.max(0, r.cashAEDeur) + Math.max(0, r.cashJPYeur) + r.esppCashTotal;
  proche(positives, r.cashCourtier, 1, 'recomposition du cash courtier');
  // Le solde AED est la part que la reconstitution par les flux ne peut pas voir.
  assert.ok(r.cashAEDeur > 0, 'le solde AED devrait être positif — sinon le pont perd son objet');
});

t('14 lignes de titres, et un cash courtier non nul', () => {
  assert.equal(av.concentration.nbLignes, 14);
  assert.ok(av.reconciliation.cashCourtier > 0,
    'cash courtier nul : c’est le symptôme du « Cash 0 % »');
  const ins = (av.insights || []).find((i) => i.type === 'recommendation');
  assert.ok(ins, 'encadré recommandations absent');
  assert.equal(ins.nbPositions, 14, 'le bandeau compte encore les seules lignes IBKR');
  assert.ok(ins.cashPct > 0, 'le bandeau annonce encore « Cash 0 % »');
});

// ── 7. Seuils du cash : indépendants, chacun sur son propre rendement ───────────────────
t('chaque compte est classé selon SON rendement', () => {
  const REF = cv.refYield, nd = cv.accounts.filter((a) => !a.isDebt);
  const s3 = nd.filter((a) => (a.yield || 0) < INFLATION_RATE).reduce((x, a) => x + a.valEUR, 0);
  const s6 = nd.filter((a) => (a.yield || 0) < REF - 1e-9).reduce((x, a) => x + a.valEUR, 0);
  proche(s3, cv.coupleFrame.subInflationCash, 1, 'sous inflation');
  proche(s6, cv.coupleFrame.subOptimalCash, 1, 'sous benchmark');
});

t('le périmètre sous-inflation est INCLUS dans le périmètre sous-benchmark', () => {
  const REF = cv.refYield;
  const sousInfl = cv.accounts.filter((a) => !a.isDebt && (a.yield || 0) < INFLATION_RATE);
  sousInfl.forEach((a) => {
    assert.ok((a.yield || 0) < REF - 1e-9,
      a.label + ' est sous l’inflation mais pas sous le benchmark — inclusion rompue');
  });
  assert.ok(cv.coupleFrame.subOptimalCash >= cv.coupleFrame.subInflationCash - 1);
});

t('la partition par le benchmark couvre tout le cash', () => {
  const f = cv.coupleFrame;
  proche(f.subOptimalCash + f.atBenchmarkCash + f.aboveBenchmarkCash, cv.totalCash, 2, 'partition 6 %');
});

t('Wio Savings est AU benchmark, ce qui explique l’égalité des deux périmètres', () => {
  // Ce test documente l’état réel : `CASH_YIELDS.wioSavings` vaut exactement 6,00 %.
  // Wio n’est donc pas « sous 6 % » — il est au taux visé, et le déplacer ne rapporterait
  // rien. Le jour où ce taux sera corrigé à la baisse avec une source, ce test échouera et
  // signalera qu’il faut le mettre à jour, au lieu de laisser l’écart passer inaperçu.
  const wio = cv.accounts.find((a) => /Wio Savings/.test(a.label));
  assert.ok(wio, 'compte Wio Savings introuvable');
  assert.ok(Math.abs((wio.yield || 0) - cv.refYield) < 1e-9,
    'Wio Savings n’est plus au benchmark : mettre à jour les périmètres et ce test');
  assert.ok(cv.coupleFrame.atBenchmarkCash >= wio.valEUR - 1,
    'le périmètre « au benchmark » ne contient pas Wio Savings');
  assert.equal(cv.seuilsConfondus, true,
    'les deux seuils ne coïncident plus : l’explication affichée à l’écran est devenue fausse');
});

t('les périmètres du couple valent la somme d’Amine et Nezha', () => {
  const A = cv.byOwner.Amine, N = cv.byOwner.Nezha, f = cv.coupleFrame;
  proche(A.subOptimalCash + N.subOptimalCash, f.subOptimalCash, 2, 'sous 6 %');
  proche(A.subInflationCash + N.subInflationCash, f.subInflationCash, 2, 'sous inflation');
  proche(A.atBenchmarkCash + N.atBenchmarkCash, f.atBenchmarkCash, 2, 'au benchmark');
  proche(A.total + N.total, cv.totalCash, 2, 'cash total');
});

// ── 8. Immobilier : les horizons sont séparés ───────────────────────────────────────────
t('exploitation, portage et régime de croisière sont trois agrégats distincts', () => {
  const t2 = iv.temporel;
  assert.ok(t2, 'agrégats temporels absents');
  assert.deepEqual(t2.exploitation.biens.slice().sort(), ['Rueil', 'Vitry']);
  assert.deepEqual(t2.enConstruction.biens, ['Villejuif']);
  // Aujourd’hui = exploitation + le coût de portage, et rien d’autre.
  proche(t2.actuel.cf, t2.exploitation.cf + t2.enConstruction.coutActuel, 0.01, 'CF actuel');
  proche(t2.actuel.charges, t2.exploitation.charges - t2.enConstruction.coutActuel, 0.01, 'charges actuelles');
  // Le graphique porte sur l’exploitation seule : l’écart doit être exactement le portage.
  proche(t2.actuel.charges - t2.exploitation.charges, -t2.enConstruction.coutActuel, 0.01, 'écart nommé');
});

t('les recettes futures ne sont pas présentées comme contractées', () => {
  assert.equal(iv.temporel.enConstruction.recettesFuturesContractees, false);
  assert.equal(iv.temporel.stabilise.estime, true);
});

t('le régime de croisière n’est pas confondu avec aujourd’hui', () => {
  const t2 = iv.temporel;
  assert.notEqual(Math.round(t2.stabilise.cf), Math.round(t2.actuel.cf));
  assert.ok(t2.stabilise.recettes > t2.actuel.recettes, 'les recettes stabilisées devraient être supérieures');
});

t('les deux dates de livraison et les deux échéances de prêt restent distinctes', async () => {
  const { VILLEJUIF_CONSTRAINTS } = await import('../js/data.js');
  const L = VILLEJUIF_CONSTRAINTS.livraison;
  assert.equal(L.contractuelle, '2028-06');
  assert.equal(L.operationnelle, '2028-09');
  assert.notEqual(L.contractuelle, L.operationnelle);
  const e = VILLEJUIF_CONSTRAINTS.echeancier;
  assert.equal(e.find((x) => x.pret === 'P2').premierAmortissement, '2028-11');
  assert.equal(e.find((x) => x.pret === 'P1').premierAmortissement, '2029-02');
});

// ── 9. Aucun flottant brut à l’écran ────────────────────────────────────────────────────
t('aucune valeur numérique n’est concaténée sans mise en forme', () => {
  // « −107.05999999999997 €/mois » venait d’une concaténation directe. On interdit le motif
  // à la source : une variable collée à une unité doit passer par un formateur.
  const src = readFileSync(new URL('../js/render.js', import.meta.url), 'utf8');
  const lignes = src.split('\n');
  // Une variable collée à une unité monétaire doit avoir été mise en forme QUELQUE PART
  // dans son affectation. On ne se fie pas au nom : on lit la déclaration.
  const FORMATEURS = /(Math\.round|Math\.ceil|Math\.floor|toFixed|toLocaleString|fmt\(|fmtE\(|\bf\(|\bK\(|\bN\(|\bE\()/;
  const motif = /\+ ([A-Za-z_$][\w$]*) \+ '(\/mois|\/an| €|€\/)/g;
  const coupables = [];
  let m2;
  while ((m2 = motif.exec(src)) !== null) {
    const nom = m2[1];
    const ligne = src.slice(0, m2.index).split('\n').length;
    // Toutes les affectations de ce nom dans le fichier.
    const decls = lignes.filter((l) => new RegExp('(const|let|var)\\s+' + nom + '\\s*=|^\\s*' + nom + '\\s*=').test(l));
    if (decls.length === 0) continue;                       // paramètre ou champ : hors portée
    if (decls.some((d) => FORMATEURS.test(d))) continue;    // mise en forme trouvée
    coupables.push('render.js:' + ligne + ' → ' + nom + '  (affecté sans mise en forme)');
  }
  assert.equal(coupables.length, 0, 'concaténation brute :\n      ' + coupables.join('\n      '));
});

console.log(ko === 0 ? '\n✅ acceptation : tout passe\n' : '\n❌ ' + ko + ' échec(s)\n');
process.exit(ko === 0 ? 0 : 1);
