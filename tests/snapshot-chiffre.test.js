#!/usr/bin/env node
// ============================================================================
// Le cron nocturne sait-il déchiffrer le blob avec une phrase ? (item 2)
//
// Construit un blob avec une phrase JETABLE (jamais la vraie), puis vérifie que le module de
// déchiffrement partagé — celui qu'utilise scripts/daily_snapshot.mjs — retrouve PORTFOLIO, et
// qu'une mauvaise phrase échoue au lieu de rendre des données vides (le danger d'une table
// append-only serait un SUCCÈS SILENCIEUX sur des zéros).
// ============================================================================
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { execFileSync } = require('child_process');
const { contenuClair } = require('./_clair.cjs');
const RACINE = path.join(__dirname, '..');

let ko = 0;
const t = (nom, fn) => fn().then(() => console.log('  ✓', nom)).catch((e) => { ko++; console.log('  ✗', nom, '\n      ', e.message); });

(async () => {
  const { dechiffreBlobs } = await import('../scripts/_dechiffre.mjs');
  console.log('\n── cron chiffré : déchiffrement ──');

  // Blob jetable, hors dépôt : NW_DATA_SOURCE = clair courant, NW_ENC_OUT = temp.
  const PHRASE = 'phrase-jetable-de-test-du-cron-000';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cron-'));
  const srcFile = path.join(tmp, 'data.source.js');
  fs.writeFileSync(srcFile, contenuClair());
  const encOut = path.join(tmp, 'data.enc.js');
  execFileSync(process.execPath, ['scripts/build_encrypted_data.mjs', '--verify'], {
    cwd: RACINE, stdio: 'ignore',
    env: { ...process.env, NW_PASSPHRASE: PHRASE, NW_DATA_SOURCE: srcFile, NW_ENC_OUT: encOut },
  });
  const encSrc = fs.readFileSync(encOut, 'utf-8');

  await t('la bonne phrase retrouve PORTFOLIO et les 13 blocs', async () => {
    const blocs = await dechiffreBlobs(encSrc, PHRASE);
    assert.equal(Object.keys(blocs).length, 13, '13 blocs attendus');
    assert.ok(blocs.PORTFOLIO && blocs.PORTFOLIO.amine && blocs.PORTFOLIO.amine.ibkr, 'PORTFOLIO.amine.ibkr recouvré');
    assert.ok(blocs.VILLEJUIF_ACTE && blocs.VILLEJUIF_ACTE.prix, 'VILLEJUIF_ACTE recouvré (données v544)');
  });

  await t('une mauvaise phrase ÉCHOUE (jamais de données vides silencieuses)', async () => {
    await assert.rejects(() => dechiffreBlobs(encSrc, 'mauvaise-phrase-1234'), 'la mauvaise phrase aurait dû lever');
  });

  await t('le blob ne contient AUCUN montant en clair', () => {
    // Le ciphertext base64 ne doit pas laisser filtrer un solde connu.
    const B = JSON.parse(encSrc.match(/DATA_ENC\s*=\s*(\{[\s\S]*\});/)[1]);
    assert.ok(!/117005|196915|181609/.test(B.data), 'un montant apparaît en clair dans le blob');
    return Promise.resolve();
  });

  console.log(ko === 0 ? '\n✅ cron chiffré : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
