#!/usr/bin/env node
// ============================================================================
// Authentification d'écriture du snapshot nocturne (items 2 & 3).
//
// Prouve, sans réseau ni secret réel, que :
//   · v544 conserve son chemin ACTUEL (clé publishable, aucun secret requis) → le cron déjà en prod
//     ne casse pas avant la bascule ;
//   · v545 échoue de manière FERMÉE sans secret serveur ;
//   · v545 avec une clé serveur FACTICE (sb_secret_…) écrit avec `apikey` SEUL, jamais en Bearer
//     (une clé sb_secret_… n'est pas un JWT).
// ============================================================================
const assert = require('assert/strict');

const PUBLISHABLE = 'sb_publishable_TEST_public_key_000';
let ko = 0;
const t = (nom, fn) => fn().then(() => console.log('  ✓', nom)).catch((e) => { ko++; console.log('  ✗', nom, '\n      ', e.message); });

(async () => {
  const { resolveSnapshotWriteAuth, versionMajor, estCleServeur } = await import('../scripts/_snapshot_auth.mjs');
  console.log('\n── snapshot : authentification d\'écriture ──');

  await t('versionMajor lit v544/v545 et l\'absence', () => {
    assert.equal(versionMajor('v544'), 544);
    assert.equal(versionMajor('v545'), 545);
    assert.equal(versionMajor(''), 0);
    return Promise.resolve();
  });

  await t('estCleServeur n\'accepte que le format sb_secret_…', () => {
    assert.equal(estCleServeur('sb_secret_abcDEF-123_xyz'), true);
    assert.equal(estCleServeur('sb_publishable_xxx'), false);
    assert.equal(estCleServeur('service_role_jwt.header.payload'), false);
    assert.equal(estCleServeur(undefined), false);
    return Promise.resolve();
  });

  await t('v544 conserve son chemin ACTUEL : clé publishable, AUCUN secret requis', () => {
    const { mode, headers } = resolveSnapshotWriteAuth({ appVersion: 'v544', secretKey: undefined, publishableKey: PUBLISHABLE });
    assert.equal(mode, 'legacy');
    assert.equal(headers.apikey, PUBLISHABLE, 'apikey = clé publishable');
    assert.equal(headers.Authorization, 'Bearer ' + PUBLISHABLE, 'comportement existant conservé (Bearer publishable)');
    return Promise.resolve();
  });

  await t('v545 SANS secret → refuse (échec fermé, code NO_SERVER_KEY)', () => {
    assert.throws(
      () => resolveSnapshotWriteAuth({ appVersion: 'v545', secretKey: undefined, publishableKey: PUBLISHABLE }),
      (e) => e && e.code === 'NO_SERVER_KEY',
      'v545 sans secret aurait dû lever NO_SERVER_KEY');
    return Promise.resolve();
  });

  await t('v545 avec une clé au MAUVAIS format → refuse aussi', () => {
    assert.throws(() => resolveSnapshotWriteAuth({ appVersion: 'v545', secretKey: PUBLISHABLE, publishableKey: PUBLISHABLE }),
      (e) => e && e.code === 'NO_SERVER_KEY', 'une clé publishable ne doit pas être acceptée comme secret serveur');
    return Promise.resolve();
  });

  await t('v545 avec une clé serveur FACTICE → apikey SEUL, jamais de Bearer', () => {
    const FAUX_SECRET = 'sb_secret_FAKE_for_test_only_000';
    const { mode, headers } = resolveSnapshotWriteAuth({ appVersion: 'v545', secretKey: FAUX_SECRET, publishableKey: PUBLISHABLE });
    assert.equal(mode, 'secret');
    assert.equal(headers.apikey, FAUX_SECRET, 'le secret part dans apikey');
    assert.equal('Authorization' in headers, false, 'AUCUN en-tête Authorization (sb_secret_… n\'est pas un JWT)');
    assert.equal(headers.apikey.startsWith('sb_secret_'), true);
    return Promise.resolve();
  });

  console.log(ko === 0 ? '\n✅ snapshot auth : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
