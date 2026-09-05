#!/usr/bin/env node
// ============================================================================
// Le libellé de la facturation doit suivre le PÉRIMÈTRE du calcul.
//
// L'écran annonçait « Facturation net (Augustin − Benoit) » alors que le chemin
// canonique lit `combined.mad`, qui agrège TOUTES les contreparties du site de
// facturation — Bob compris. Un libellé écrit à la main se désynchronise dès qu'une
// contrepartie est ajoutée. Ce test échoue si la divergence revient.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os');
const { execSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-factu-'));
for (const f of ['engine.js', 'data.js']) {
  fs.writeFileSync(path.join(TMP, f),
    fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8').replace(/\?v=\d+/g, ''));
}

let echecs = [];
(async () => {
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const { compute } = await import('file://' + path.join(TMP, 'engine.js'));
  const s = compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');

  const cps = s.amine.facturationCounterparts;
  if (!Array.isArray(cps)) echecs.push('facturationCounterparts absent : le périmètre n’est pas exposé');
  else {
    // Chaque contrepartie du calcul doit être nommée.
    const attendues = Object.keys(D.PORTFOLIO.amine.facturation || {})
      .map(k => k.charAt(0).toUpperCase() + k.slice(1));
    for (const a of attendues) {
      if (!cps.includes(a)) echecs.push(`la contrepartie « ${a} » entre dans le calcul mais n’est pas dans le libellé`);
    }
    if (cps.length !== attendues.length) {
      echecs.push(`le libellé nomme ${cps.length} contrepartie(s) pour ${attendues.length} dans le calcul`);
    }
    if (cps.some(c => /^Je$/i.test(c))) echecs.push('nom de contrepartie invalide (« Je ») — extraction depuis le libellé au lieu de la clé');
  }

  // Aucun libellé de facturation figé ne doit subsister dans le rendu.
  const render = fs.readFileSync(path.join(RACINE, 'js', 'render.js'), 'utf-8');
  if (/Facturation net \(Augustin/.test(render)) {
    echecs.push('render.js contient encore un libellé de facturation écrit en dur');
  }
  if (!/function libelleFacturation/.test(render)) {
    echecs.push('render.js : libelleFacturation() absent — le libellé n’est plus dérivé');
  }

  // Le montant doit rester une conversion MAD → EUR, pas un nombre inventé.
  if (!Number.isFinite(s.amine.facturationNet)) echecs.push('facturationNet n’est pas un nombre');

  if (echecs.length) {
    console.error('✗ ' + echecs.length + ' contrôle(s) en échec :');
    for (const e of echecs) console.error('   - ' + e);
    process.exit(1);
  }
  console.log('✓ libellé facturation aligné sur le calcul — contreparties : ' + cps.join(' + ')
    + ' | net ' + Math.round(s.amine.facturationNet) + ' EUR');
})();
