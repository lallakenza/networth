#!/usr/bin/env node
/**
 * recalculer_immo_historique.mjs — valeur, capital restant dû et équité nette de Vitry et Rueil, jour
 * par jour, calculés par le moteur ACTUEL (v566).
 *
 * Usage : node scripts/recalculer_immo_historique.mjs --du AAAA-MM-JJ --au AAAA-MM-JJ
 * Sortie : JSON { 'AAAA-MM-JJ': { vitry: [valeur, crd, équitéNette], rueil: [...] } } sur stdout.
 *
 * Les snapshots d'avant la v476 / v418 portaient l'équité nette de Vitry et Rueil avec d'anciennes
 * méthodes de frais de sortie (Vitry à 0 jusqu'au 27/08/2026). La table produite ici alimente
 * IMMO_RECALCULE (data.js), appliquée à la lecture par appliquerSoldesRetroactifs. Horloge figée à
 * 00:30 UTC, l'heure du cron : le moteur date l'amortissement et l'appréciation avec `new Date()`.
 * Villejuif n'y figure pas : son coût engagé se recalcule par formule (restaterVillejuif).
 */
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const DU = arg('--du'), AU = arg('--au');
if (!/^\d{4}-\d\d-\d\d$/.test(DU || '') || !/^\d{4}-\d\d-\d\d$/.test(AU || '')) {
  console.error('usage : --du AAAA-MM-JJ --au AAAA-MM-JJ'); process.exit(2);
}
// stdout ne porte que le JSON.
console.log = (...a) => console.error(...a);

const tmp = await mkdtemp(join(tmpdir(), 'nw-immo-'));
for (const f of ['data.js', 'engine.js', 'facturation_contract.js']) {
  await writeFile(join(tmp, f), (await readFile(join(ROOT, 'js', f), 'utf8')).replace(/\?v=\d+/g, ''));
}
const D = await import(pathToFileURL(join(tmp, 'data.js')).href);
const E = await import(pathToFileURL(join(tmp, 'engine.js')).href);

const DateReelle = Date;
const out = {};
for (let t = Date.parse(DU + 'T00:30:00Z'); t <= Date.parse(AU + 'T00:30:00Z'); t += 86400000) {
  const jour = new DateReelle(t).toISOString().slice(0, 10);
  globalThis.Date = class extends DateReelle {
    constructor(...a) { super(...(a.length ? a : [t])); }
    static now() { return t; }
  };
  const s = E.compute(D.PORTFOLIO, { ...D.FX_STATIC }, 'static');
  const [vitry, rueil] = s.immoView.properties;
  out[jour] = {
    vitry: [Math.round(vitry.value), Math.round(vitry.crd), Math.round(s.amine.vitryEquity)],
    rueil: [Math.round(rueil.value), Math.round(rueil.crd), Math.round(s.nezha.rueilEquity)],
  };
}
globalThis.Date = DateReelle;
process.stdout.write(JSON.stringify(out));
