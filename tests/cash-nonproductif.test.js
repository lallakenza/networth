// Règle métier : comptes dormants + créances restantes - dettes, sans double comptage.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { contenuClair } = require('./_clair.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cash-net-'));
for (const f of ['engine.js', 'facturation_contract.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8').replace(/\?v=\d+/g, ''));
}
fs.writeFileSync(path.join(tmp, 'data.js'), contenuClair().replace(/\?v=\d+/g, ''));
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) || null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
const clone = x => JSON.parse(JSON.stringify(x));
const proche = (a, b) => assert.ok(Math.abs(a - b) < 0.001, `${a} ≠ ${b}`);

(async () => {
  const D = await import('file://' + path.join(tmp, 'data.js'));
  const { compute } = await import('file://' + path.join(tmp, 'engine.js'));
  const fx = { ...D.FX_STATIC, MAD: 10, USD: 2 };
  const base = clone(D.PORTFOLIO);
  base.amine.creances.items = [];
  base.nezha.creances = { items: [] };
  base.amine.tva = 0;
  base.nezha.cautionRueil = 0;
  const calc = p => compute(clone(p), fx, 'static');
  const initial = calc(base);
  let echecs = 0;
  const t = (nom, fn) => { try { fn(); console.log('✓ ' + nom); } catch (e) { echecs++; console.error('✗ ' + nom, e); } };
  t('créance partiellement réglée : reste seulement, avec pondération et conversion', () => {
    const p = clone(base);
    p.amine.creances.items.push({ id: 'TEST', amount: 10000, currency: 'MAD', probability: 0.5, status: 'en_cours', payments: [{ amount: 2000 }] });
    const s = calc(p), np = s.cashView.nonProductif;
    proche(np.creances, 400);
    proche(np.net - initial.cashView.nonProductif.net, 400);
    proche(s.couple.nw - initial.couple.nw, 400);
    proche(s.cashView.totalCash, initial.cashView.totalCash);
    proche(s.couple.financialMobilisable, initial.couple.financialMobilisable);
  });
  t('créance recouvrée, crédit net de frais et probabilité zéro : aucun faux actif', () => {
    const p = clone(base);
    p.amine.creances.items.push(
      { amount: 1000, currency: 'EUR', status: 'recouvré', payments: [] },
      { amount: 1000, currency: 'EUR', status: 'en_cours', payments: [{ amount: 975, frais: 25 }] },
      { amount: 1000, currency: 'EUR', probability: 0, status: 'en_cours', payments: [] });
    const s = calc(p);
    proche(s.cashView.nonProductif.creances, 0);
    proche(s.couple.nw, initial.couple.nw);
    proche(s.creancesView.totalExpected, 0);
  });
  t('dette personnelle partiellement remboursée : soustraction du seul restant', () => {
    const p = clone(base);
    p.amine.creances.items.push({ amount: -1000, currency: 'EUR', status: 'en_cours', payments: [{ amount: 400 }] });
    const s = calc(p);
    proche(s.cashView.nonProductif.dettes, 600);
    proche(s.cashView.nonProductif.net - initial.cashView.nonProductif.net, -600);
    proche(s.couple.nw - initial.couple.nw, -600);
    proche(s.creancesView.totalDettes, 600);
  });
  t('propriétaires : TVA, caution et créance de Nezha sont attribuées correctement', () => {
    const p = clone(base);
    p.amine.tva = -300; p.amine.tvaProbability = 1;
    p.nezha.cautionRueil = 200;
    p.nezha.creances.items.push({ amount: 200, currency: 'USD', probability: 1, status: 'en_cours', payments: [] });
    const np = calc(p).cashView.nonProductif;
    proche(np.byOwner.Amine.dettes, 300);
    proche(np.byOwner.Nezha.dettes, 200);
    proche(np.byOwner.Nezha.creances, 100);
    proche(np.net, np.byOwner.Amine.net + np.byOwner.Nezha.net);
    proche(np.net - initial.cashView.nonProductif.net, -400);
  });
  t('le net peut devenir négatif ; les crédits immobiliers et la marge ne sont pas redéduits', () => {
    const np0 = initial.cashView.nonProductif;
    proche(np0.net, initial.cashView.totalNonYielding);
    const p = clone(base);
    p.amine.creances.items.push({ amount: -1000000, currency: 'EUR', status: 'en_cours', payments: [] });
    const np = calc(p).cashView.nonProductif;
    assert.ok(np.net < 0);
    proche(np.net, np0.net - 1000000);
  });
  t('facturation : entrées et sorties brutes, même lorsque le net est nul', () => {
    mem.set('nw_facturation_contrat_v1', JSON.stringify({ recuLe: Date.now(), canal: 'http', contrat: {
      schemaVersion: '1.0.0', producerVersion: 'test', generatedAt: new Date().toISOString(),
      dataAsOf: new Date().toISOString().slice(0, 10), currency: 'MAD',
      signConvention: 'positif = le tiers doit à Amine ; négatif = Amine doit au tiers',
      positionsGross: { augustin: 10000, benoit: -10000, bob: 0 }, netPositionMad: 0, nettingApplied: false,
    } }));
    try {
      const s = calc(base), np = s.cashView.nonProductif;
      proche(np.creances, 1000); proche(np.dettes, 1000);
      proche(np.net, initial.cashView.nonProductif.net);
      proche(s.couple.nw, initial.couple.nw);
    } finally { mem.clear(); }
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = echecs ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
