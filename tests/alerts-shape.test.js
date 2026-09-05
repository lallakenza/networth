#!/usr/bin/env node
// ============================================================================
// Toute alerte produite doit être AFFICHABLE.
//
// v523 a introduit une alerte avec `severity: 'amber'` et `detail`, alors que le rendu
// ne connaît que red/yellow/green et lit `msg`. Elle était filtrée en silence : le
// compteur annonçait 8 alertes, six s'affichaient. Une alerte censée rendre un silence
// visible était elle-même invisible.
//
// Ce test compare ce que le moteur PRODUIT à ce que le rendu CONSOMME.
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os');

const RACINE = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-alerts-'));
for (const f of ['engine.js', 'data.js']) {
  fs.writeFileSync(path.join(TMP, f),
    fs.readFileSync(path.join(RACINE, 'js', f), 'utf-8').replace(/\?v=\d+/g, ''));
}

const SEVERITES_AFFICHABLES = ['red', 'yellow', 'green'];
const CHAMPS_REQUIS = ['severity', 'title', 'msg'];

(async () => {
  const echecs = [];
  const D = await import('file://' + path.join(TMP, 'data.js'));
  const { compute, computeAlerts } = await import('file://' + path.join(TMP, 'engine.js'));
  const s = compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
  const alerts = computeAlerts(s);

  if (!Array.isArray(alerts) || !alerts.length) echecs.push('computeAlerts ne produit aucune alerte');

  alerts.forEach((a, i) => {
    const nom = a.title || a.category || ('alerte #' + i);
    if (!SEVERITES_AFFICHABLES.includes(a.severity)) {
      echecs.push(`« ${nom} » a severity « ${a.severity} » — le rendu ne connaît que ${SEVERITES_AFFICHABLES.join('/')}, elle sera filtrée en silence`);
    }
    for (const champ of CHAMPS_REQUIS) {
      if (!a[champ]) echecs.push(`« ${nom} » n’a pas de champ « ${champ} » — le rendu affichera un vide`);
    }
  });

  // Le nombre d'alertes AFFICHABLES doit égaler le nombre produit : sinon un compteur
  // annoncera plus de cartes qu'il n'en existe.
  const affichables = alerts.filter(a => SEVERITES_AFFICHABLES.includes(a.severity)).length;
  if (affichables !== alerts.length) {
    echecs.push(`${alerts.length} alertes produites mais ${affichables} affichables — ${alerts.length - affichables} disparaîtront sans trace`);
  }

  // Le rendu doit toujours lire les mêmes champs : si render.js change, ce test doit suivre.
  const render = fs.readFileSync(path.join(RACINE, 'js', 'render.js'), 'utf-8');
  for (const sev of SEVERITES_AFFICHABLES) {
    if (!new RegExp("'" + sev + "'|" + sev + ':').test(render)) {
      echecs.push(`render.js ne mentionne plus la sévérité « ${sev} » — la liste du test est périmée`);
    }
  }

  if (echecs.length) {
    console.error('✗ ' + echecs.length + ' contrôle(s) en échec :');
    for (const e of echecs) console.error('   - ' + e);
    process.exit(1);
  }
  console.log('✓ ' + alerts.length + ' alerte(s), toutes affichables (sévérité connue, title et msg présents)');
})();
