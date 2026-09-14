#!/usr/bin/env node
// ============================================================================
// Authentification d'écriture du snapshot nocturne — les quatre cas de la transition.
//
//   v544 sans secret valide  → clé publishable, temporairement (chemin actuel du cron)
//   v544 avec secret valide  → clé serveur sb_secret_…, `apikey` seul
//   v545 sans secret valide  → échec fermé
//   v545 avec secret valide  → clé serveur sb_secret_…, `apikey` seul
//
// Sans réseau ni secret réel : les clés factices sont construites par concaténation pour qu'aucune
// valeur au format serveur n'apparaisse telle quelle dans un fichier suivi.
// ============================================================================
const assert = require('assert/strict');
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const RACINE = path.join(__dirname, '..');

const PUBLISHABLE = 'sb_publishable_' + 'TEST_public_key_000';
const FAUX_SECRET = 'sb_' + 'secret_' + 'FAKE_for_test_only_000';
const JWT_LEGACY = 'eyJ' + 'hbGciOiJIUzI1NiJ9.e30.signature';

let ko = 0;
const t = (nom, fn) => Promise.resolve().then(fn).then(() => console.log('  ✓', nom)).catch((e) => { ko++; console.log('  ✗', nom, '\n      ', e.message); });

const apikeySeul = (headers, cle) => {
  assert.equal(headers.apikey, cle, 'la clé serveur part dans apikey');
  assert.equal('Authorization' in headers, false, 'aucun en-tête Authorization (sb_secret_… n\'est pas un JWT)');
};

(async () => {
  const { resolveSnapshotWriteAuth, versionMajor, estCleServeur } = await import('../scripts/_snapshot_auth.mjs');
  const resoudre = (appVersion, secretKey) => resolveSnapshotWriteAuth({ appVersion, secretKey, publishableKey: PUBLISHABLE });
  const refuse = (appVersion, secretKey) => assert.throws(() => resoudre(appVersion, secretKey), (e) => e && e.code === 'NO_SERVER_KEY');

  console.log('\n── snapshot : authentification d\'écriture (4 cas) ──');

  await t('versionMajor lit v544/v545 et l\'absence', () => {
    assert.equal(versionMajor('v544'), 544);
    assert.equal(versionMajor('v545'), 545);
    assert.equal(versionMajor(''), 0);
  });

  await t('estCleServeur n\'accepte que le format sb_secret_…', () => {
    assert.equal(estCleServeur(FAUX_SECRET), true);
    assert.equal(estCleServeur(PUBLISHABLE), false);
    assert.equal(estCleServeur(JWT_LEGACY), false, 'une ancienne clé JWT service_role est refusée');
    assert.equal(estCleServeur(undefined), false);
    assert.equal(estCleServeur(''), false);
  });

  // ── Cas 1 : v544 sans secret valide ──
  await t('cas 1 — v544 SANS secret : clé publishable conservée temporairement', () => {
    const { mode, headers, warning } = resoudre('v544', undefined);
    assert.equal(mode, 'legacy');
    assert.equal(headers.apikey, PUBLISHABLE);
    assert.equal(headers.Authorization, 'Bearer ' + PUBLISHABLE, 'chemin actuel du cron inchangé');
    assert.equal(warning, null);
  });

  await t('cas 1 bis — v544 avec secret au MAUVAIS format : repli publishable + avertissement sans la valeur', () => {
    for (const mauvais of [PUBLISHABLE, JWT_LEGACY, 'n-importe-quoi']) {
      const { mode, headers, warning } = resoudre('v544', mauvais);
      assert.equal(mode, 'legacy');
      assert.equal(headers.apikey, PUBLISHABLE, 'jamais la valeur invalide dans apikey');
      assert.ok(warning && /mauvais format/.test(warning), 'un avertissement est émis');
      assert.equal(warning.includes(mauvais), false, 'l\'avertissement ne contient pas la valeur');
    }
  });

  // ── Cas 2 : v544 avec secret valide ──
  await t('cas 2 — v544 AVEC secret valide : clé serveur préférée immédiatement, apikey seul', () => {
    const { mode, headers, warning } = resoudre('v544', FAUX_SECRET);
    assert.equal(mode, 'secret');
    apikeySeul(headers, FAUX_SECRET);
    assert.notEqual(headers.apikey, PUBLISHABLE);
    assert.equal(warning, null);
  });

  // ── Cas 3 : v545 sans secret valide ──
  await t('cas 3 — v545 SANS secret : échec fermé (NO_SERVER_KEY)', () => {
    refuse('v545', undefined);
    refuse('v545', '');
    refuse('v545', '   ');
  });

  await t('cas 3 bis — v545 avec clé JWT legacy ou publishable : échec fermé, message sans la valeur', () => {
    for (const mauvais of [JWT_LEGACY, PUBLISHABLE]) {
      refuse('v545', mauvais);
      try { resoudre('v545', mauvais); } catch (e) { assert.equal(e.message.includes(mauvais), false); }
    }
    refuse('v546', undefined);
  });

  // ── Cas 4 : v545 avec secret valide ──
  await t('cas 4 — v545 AVEC secret valide : apikey seul, jamais de Bearer', () => {
    const { mode, headers } = resoudre('v545', FAUX_SECRET);
    assert.equal(mode, 'secret');
    apikeySeul(headers, FAUX_SECRET);
  });

  await t('un secret collé avec retour à la ligne est normalisé (en-tête propre)', () => {
    const { mode, headers } = resoudre('v545', FAUX_SECRET + '\n');
    assert.equal(mode, 'secret');
    apikeySeul(headers, FAUX_SECRET);
  });

  await t('aucune clé serveur réelle dans js/ ni dans un fichier suivi', () => {
    const suivis = execFileSync('git', ['ls-files'], { cwd: RACINE, encoding: 'utf8' }).split('\n').filter(Boolean);
    const motif = /sb_secret_[A-Za-z0-9]{8,}/;
    const fautifs = suivis.filter((f) => {
      const p = path.join(RACINE, f);
      if (!fs.existsSync(p) || fs.statSync(p).size > 5e6) return false;
      return motif.test(fs.readFileSync(p, 'utf8'));
    });
    assert.deepEqual(fautifs, [], 'valeur au format sb_secret_ trouvée dans : ' + fautifs.join(', '));
  });

  console.log(ko === 0 ? '\n✅ snapshot auth : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
