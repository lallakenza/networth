#!/usr/bin/env node
// ============================================================================
// Confidentialité — ce que le dépôt PUBLIC ne doit plus contenir (v543).
//
// Le dépôt est public et servi par GitHub Pages : tout fichier suivi est téléchargeable. Ce test
// parcourt TOUS les fichiers suivis et refuse les motifs de données privées retirées en v543. Il
// ne prouve pas l'absence de toute donnée sensible (le patrimoine lui-même reste en clair par
// décision de l'utilisateur, v517) ; il empêche le retour de celles qui ont été retirées.
// ============================================================================
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..');
const MOI = path.relative(RACINE, __filename);

// Motifs construits par concaténation pour que ce fichier ne se signale pas lui-même.
const INTERDITS = [
  ['revenu locatif hors bail', new RegExp('esp' + '[eè]ces|non d' + '[ée]clar|loyer' + 'Cash|parking' + 'CashVoisin', 'i')],
  ['adresse d’un bien', new RegExp('Nathalie ' + 'Lemel|Maxime ' + 'Gorki|des ' + 'Glycines|Léon ' + 'Geffroy', 'i')],
  ['IBAN', new RegExp('\\bFR\\d{2}(?: ?\\d{4}){2,}')],
  ['numéro de compte', new RegExp('#\\d{9,}')],
  ['identifiant de local fiscal', new RegExp('Local n° ' + '\\d{6,}')],
];
const HERITES = ['dashboard.html', 'portfolio_analysis.html', 'portfolio_analysis_v2.html', 'portfolio_analysis_v3.html',
  'portfolio_analysis_v4.html', 'AUDIT_REPORT.md', 'AUDIT_SUMMARY.txt', 'transaction_history.csv', 'FINANCIAL_DATA_EXTRACTION.md'];

let ko = 0;
const t = (nom, fn) => { try { fn(); console.log('  ✓', nom); } catch (e) { ko++; console.log('  ✗', nom, '\n      ', e.message); } };
console.log('\n── confidentialité du dépôt public ──');

const fichiers = execSync('git ls-files', { cwd: RACINE, encoding: 'utf-8' }).split('\n').filter(Boolean)
  .filter((f) => f !== MOI && !/\.(png|jpg|jpeg|ico|webp)$/.test(f) && f !== 'js/data.enc.js');

for (const [nom, re] of INTERDITS) {
  t('aucun fichier suivi ne contient : ' + nom, () => {
    const hits = [];
    for (const f of fichiers) {
      let txt; try { txt = fs.readFileSync(path.join(RACINE, f), 'utf-8'); } catch (e) { continue; }
      txt.split('\n').forEach((l, i) => { if (re.test(l)) hits.push(f + ':' + (i + 1)); });
    }
    assert(hits.length === 0, hits.slice(0, 8).join(', '));
  });
}
t('les fichiers hérités exposant des données personnelles ne sont plus suivis', () => {
  const restants = HERITES.filter((f) => fichiers.includes(f));
  assert(restants.length === 0, restants.join(', '));
});
t('la surcouche Supabase ne réinjecte aucun champ de loyer hors bail', () => {
  const api = fs.readFileSync(path.join(RACINE, 'js', 'api.js'), 'utf-8');
  assert(!/parking: fin\(v\.rent\.parking\)/.test(api), 'parking encore repris depuis la base');
});
function assert(c, m) { if (!c) throw new Error(m || 'assertion'); }

console.log(ko === 0 ? '\n✅ confidentialité : tout passe\n' : '\n❌ ' + ko + ' échec(s)\n');
process.exit(ko === 0 ? 0 : 1);
