#!/usr/bin/env node
// ============================================================================
// L'allocation géographique doit totaliser 100 %, pour TOUS les filtres.
//
// Trois producteurs de pourcentages géographiques coexistaient. Deux ont été corrigés
// en v503 ; le troisième — l'insight « Diversification Géographique » — n'exposait que
// quatre postes FIXES (France, US, Crypto, et « Autres » limité à Maroc + Japon).
// L'Allemagne, 12,3 %, n'entrait dans aucun : le total affiché plafonnait à 87,8 %.
// Ce test échoue si une zone cesse d'être représentée.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-geo-'));
for (const f of ['engine.js', 'data.js']) {
  fs.writeFileSync(path.join(TMP, f),
    fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8').replace(/\?v=\d+/g, ''));
}

(async () => {
  const echecs = [];
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const { compute } = await import('file://' + path.join(TMP, 'engine.js'));

  for (const filtre of ['both', 'amine', 'nezha']) {
    globalThis.window = { _activeOwner: filtre };
    const s = compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
    const av = s.actionsView;

    // 1. L'insight doit couvrir 100 %.
    const geo = (av.insights || []).find(i => i.type === 'geo');
    if (!geo) { echecs.push(`[${filtre}] insight « geo » absente`); continue; }
    if (!Array.isArray(geo.parts)) {
      echecs.push(`[${filtre}] l'insight géo n'énumère pas ses zones — retour aux postes figés ?`);
      continue;
    }
    if (Math.abs(geo.totalPct - 100) > 0.5) {
      echecs.push(`[${filtre}] la répartition géographique totalise ${geo.totalPct.toFixed(1)} % au lieu de 100 %`);
    }

    // 2. Chaque zone de l'allocation moteur doit être représentée.
    const zonesMoteur = Object.entries(av.geoAllocation || {})
      .filter(([, v]) => isFinite(v) && v > 0).map(([k]) => k);
    const zonesAffichees = geo.parts.map(p => p.cle);
    for (const z of zonesMoteur) {
      if (!zonesAffichees.includes(z)) {
        echecs.push(`[${filtre}] la zone « ${z} » pèse dans l'allocation mais n'est affichée nulle part`);
      }
    }

    // 3. La somme des parts doit égaler l'allocation totale.
    const totalMoteur = Object.values(av.geoAllocation || {}).reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
    const totalParts = geo.parts.reduce((a, p) => a + p.valEUR, 0);
    if (totalMoteur > 0 && Math.abs(totalParts - totalMoteur) > 1) {
      echecs.push(`[${filtre}] somme des parts ${Math.round(totalParts)} ≠ allocation ${Math.round(totalMoteur)}`);
    }
  }

  // 4. Aucun poste géographique figé ne doit revenir dans le rendu.
  const render = fs.readFileSync(path.join(RACINE, 'js', 'render.js'), 'utf-8');
  if (/ins\.emergingPct|ins\.usPct|ins\.cryptoPct/.test(render)) {
    echecs.push('render.js réutilise des postes géographiques figés (usPct/cryptoPct/emergingPct)');
  }

  if (echecs.length) {
    console.error('✗ ' + echecs.length + ' contrôle(s) en échec :');
    for (const e of echecs) console.error('   - ' + e);
    process.exit(1);
  }
  console.log('✓ géographie à 100 % sur les 3 filtres, toutes les zones représentées, aucun poste figé');
})();
