#!/usr/bin/env node
// ============================================================================
// Authentification d'écriture du snapshot nocturne — les quatre cas de la transition.
//
//   données EN CLAIR, sans secret valide → clé publishable, temporairement (chemin actuel du cron)
//   données EN CLAIR, avec secret valide → clé serveur sb_secret_…, `apikey` seul
//   données CHIFFRÉES, sans secret valide → échec fermé
//   données CHIFFRÉES, avec secret valide → clé serveur sb_secret_…, `apikey` seul
// Le régime dépend de l'état des données, PAS du numéro de version (décision du 19/09/2026).
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
  const CLAIR = false, CHIFFRE = true;
  const resoudre = (donneesChiffrees, secretKey) => resolveSnapshotWriteAuth({ donneesChiffrees, secretKey, publishableKey: PUBLISHABLE });
  const refuse = (donneesChiffrees, secretKey) => assert.throws(() => resoudre(donneesChiffrees, secretKey), (e) => e && e.code === 'NO_SERVER_KEY');

  console.log('\n── snapshot : authentification d\'écriture (4 cas) ──');

  await t('versionMajor lit v544/v545 et l\'absence (journalisation)', () => {
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

  // ── Cas 1 : données en clair, sans secret valide ──
  await t('cas 1 — données EN CLAIR, SANS secret : clé publishable conservée temporairement', () => {
    const { mode, headers, warning } = resoudre(CLAIR, undefined);
    assert.equal(mode, 'legacy');
    assert.equal(headers.apikey, PUBLISHABLE);
    assert.equal(headers.Authorization, 'Bearer ' + PUBLISHABLE, 'chemin actuel du cron inchangé');
    assert.equal(warning, null);
  });

  await t('cas 1 bis — EN CLAIR avec secret au MAUVAIS format : repli publishable + avertissement sans la valeur', () => {
    for (const mauvais of [PUBLISHABLE, JWT_LEGACY, 'n-importe-quoi']) {
      const { mode, headers, warning } = resoudre(CLAIR, mauvais);
      assert.equal(mode, 'legacy');
      assert.equal(headers.apikey, PUBLISHABLE, 'jamais la valeur invalide dans apikey');
      assert.ok(warning && /mauvais format/.test(warning), 'un avertissement est émis');
      assert.equal(warning.includes(mauvais), false, 'l\'avertissement ne contient pas la valeur');
    }
  });

  // ── Cas 2 : données en clair, avec secret valide ──
  await t('cas 2 — EN CLAIR AVEC secret valide : clé serveur préférée immédiatement, apikey seul', () => {
    const { mode, headers, warning } = resoudre(CLAIR, FAUX_SECRET);
    assert.equal(mode, 'secret');
    apikeySeul(headers, FAUX_SECRET);
    assert.notEqual(headers.apikey, PUBLISHABLE);
    assert.equal(warning, null);
  });

  // ── Cas 3 : données chiffrées, sans secret valide ──
  await t('cas 3 — données CHIFFRÉES SANS secret : échec fermé (NO_SERVER_KEY)', () => {
    refuse(CHIFFRE, undefined);
    refuse(CHIFFRE, '');
    refuse(CHIFFRE, '   ');
  });

  await t('cas 3 bis — CHIFFRÉES avec clé JWT legacy ou publishable : échec fermé, message sans la valeur', () => {
    for (const mauvais of [JWT_LEGACY, PUBLISHABLE]) {
      refuse(CHIFFRE, mauvais);
      try { resoudre(CHIFFRE, mauvais); } catch (e) { assert.equal(e.message.includes(mauvais), false); }
    }
  });

  await t('le numéro de version ne change rien : seule compte l\'état des données', () => {
    // Une version postérieure avec des données encore en clair garde le chemin historique.
    const { mode } = resolveSnapshotWriteAuth({ donneesChiffrees: false, secretKey: undefined, publishableKey: PUBLISHABLE, appVersion: 'v546' });
    assert.equal(mode, 'legacy');
  });

  await t('état des données inconnu : refus (jamais de repli anonyme par défaut)', () => {
    assert.throws(() => resolveSnapshotWriteAuth({ secretKey: undefined, publishableKey: PUBLISHABLE }),
      (e) => e && e.code === 'NO_SERVER_KEY');
    assert.throws(() => resolveSnapshotWriteAuth({ donneesChiffrees: 'v546', secretKey: undefined, publishableKey: PUBLISHABLE }),
      (e) => e && e.code === 'NO_SERVER_KEY');
  });

  // ── Cas 4 : données chiffrées, avec secret valide ──
  await t('cas 4 — CHIFFRÉES AVEC secret valide : apikey seul, jamais de Bearer', () => {
    const { mode, headers } = resoudre(CHIFFRE, FAUX_SECRET);
    assert.equal(mode, 'secret');
    apikeySeul(headers, FAUX_SECRET);
  });

  await t('un secret collé avec retour à la ligne est normalisé (en-tête propre)', () => {
    const { mode, headers } = resoudre(CHIFFRE, FAUX_SECRET + '\n');
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
