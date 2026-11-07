#!/usr/bin/env node
// ============================================================================
// Authentification d'écriture du cron sur Neon (v591) — les quatre cas de la transition.
//
//   données EN CLAIR, sans rôle écrivain valide → jeton anonyme, temporairement (chemin actuel du cron)
//   données EN CLAIR, avec rôle écrivain valide → SQL direct avec le rôle écrivain
//   données CHIFFRÉES, sans rôle écrivain valide → échec fermé, aucune écriture
//   données CHIFFRÉES, avec rôle écrivain valide → SQL direct avec le rôle écrivain
// Le régime dépend de l'état des données, PAS du numéro de version (décision du 19/09/2026).
//
// Sans réseau ni secret réel : les chaînes factices sont construites par concaténation pour qu'aucune
// chaîne de connexion complète n'apparaisse telle quelle dans un fichier suivi.
// ============================================================================
const assert = require('assert/strict');
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const RACINE = path.join(__dirname, '..');

const JETON = 'eyJ' + 'hbGciOiJFZERTQSJ9.e30.signature';
const FAUX_MDP = 'FAKE' + '_pw_for_test_only';
const URL_OK = 'postgresql://' + 'nw_ecrivain:' + FAUX_MDP + '@ep-exemple-000.c-7.eu-central-1.aws.neon.tech/neondb?sslmode=require';

let ko = 0;
const t = (nom, fn) => Promise.resolve().then(fn).then(() => console.log('  ✓', nom)).catch((e) => { ko++; console.log('  ✗', nom, '\n      ', e.message); });

(async () => {
  const { resolveSnapshotWriteAuth, versionMajor, estUrlEcrivain } = await import('../scripts/_snapshot_auth.mjs');
  const CLAIR = false, CHIFFRE = true;
  const resoudre = (donneesChiffrees, writerUrl, jetonAnonyme = JETON) => resolveSnapshotWriteAuth({ donneesChiffrees, writerUrl, jetonAnonyme });
  const refuse = (donneesChiffrees, writerUrl, jetonAnonyme) => assert.throws(() => resoudre(donneesChiffrees, writerUrl, jetonAnonyme), (e) => e && e.code === 'NO_SERVER_KEY');
  const MAUVAIS = ['postgresql://nw_ecrivain@hote.neon.tech/neondb', 'https://exemple.neon.tech', 'postgresql://u:' + FAUX_MDP + '@db.supabase.co/postgres', 'n-importe-quoi'];

  console.log('\n── cron : authentification d\'écriture Neon (4 cas) ──');

  await t('versionMajor lit v590/v591 et l\'absence (journalisation)', () => {
    assert.equal(versionMajor('v590'), 590);
    assert.equal(versionMajor('v591'), 591);
    assert.equal(versionMajor(''), 0);
  });

  await t('estUrlEcrivain n\'accepte qu\'une chaîne Postgres Neon avec identifiant et mot de passe', () => {
    assert.equal(estUrlEcrivain(URL_OK), true);
    assert.equal(estUrlEcrivain(URL_OK.replace('postgresql:', 'postgres:')), true);
    for (const m of MAUVAIS) assert.equal(estUrlEcrivain(m), false, m);
    assert.equal(estUrlEcrivain(undefined), false);
    assert.equal(estUrlEcrivain(''), false);
  });

  await t('cas 1 — EN CLAIR, SANS rôle : jeton anonyme conservé temporairement', () => {
    const { mode, headers, warning } = resoudre(CLAIR, undefined);
    assert.equal(mode, 'anonyme');
    assert.equal(headers.Authorization, 'Bearer ' + JETON);
    assert.equal(warning, null);
  });

  await t('cas 1 bis — EN CLAIR avec chaîne au MAUVAIS format : repli anonyme + avertissement sans la valeur', () => {
    for (const m of MAUVAIS) {
      const { mode, headers, warning } = resoudre(CLAIR, m);
      assert.equal(mode, 'anonyme');
      assert.equal(JSON.stringify(headers).includes(m), false, 'jamais la valeur invalide dans les en-têtes');
      assert.ok(warning && /mauvais format/.test(warning));
      assert.equal(warning.includes(m), false, 'l\'avertissement ne contient pas la valeur');
    }
  });

  await t('cas 1 ter — EN CLAIR sans rôle ni jeton anonyme : échec fermé', () => refuse(CLAIR, undefined, null));

  await t('cas 2 — EN CLAIR AVEC rôle valide : rôle écrivain préféré immédiatement', () => {
    const r = resoudre(CLAIR, URL_OK);
    assert.equal(r.mode, 'ecrivain');
    assert.equal(r.url, URL_OK);
    assert.equal('headers' in r, false, 'aucun jeton anonyme en mode écrivain');
  });

  await t('cas 3 — CHIFFRÉES SANS rôle : échec fermé même avec un jeton anonyme', () => {
    refuse(CHIFFRE, undefined);
    refuse(CHIFFRE, '');
    refuse(CHIFFRE, '   ');
  });

  await t('cas 3 bis — CHIFFRÉES avec chaîne invalide : échec fermé, message sans la valeur', () => {
    for (const m of MAUVAIS) {
      refuse(CHIFFRE, m);
      try { resoudre(CHIFFRE, m); } catch (e) { assert.equal(e.message.includes(m), false); assert.equal(e.message.includes(FAUX_MDP), false); }
    }
  });

  await t('état des données inconnu : refus (jamais de repli anonyme par défaut)', () => {
    assert.throws(() => resolveSnapshotWriteAuth({ jetonAnonyme: JETON }), (e) => e && e.code === 'NO_SERVER_KEY');
    assert.throws(() => resolveSnapshotWriteAuth({ donneesChiffrees: 'v591', jetonAnonyme: JETON }), (e) => e && e.code === 'NO_SERVER_KEY');
  });

  await t('cas 4 — CHIFFRÉES AVEC rôle valide (collé avec retour à la ligne) : rôle écrivain, valeur normalisée', () => {
    const r = resoudre(CHIFFRE, URL_OK + '\n', null);
    assert.equal(r.mode, 'ecrivain');
    assert.equal(r.url, URL_OK);
  });

  await t('le cron n\'imprime jamais la chaîne de connexion (journaux masqués)', () => {
    for (const f of ['scripts/daily_snapshot.mjs', 'scripts/refresh_price_history.mjs']) {
      const src = fs.readFileSync(path.join(RACINE, f), 'utf8');
      assert.equal(/console\.(log|error|warn)\([^)]*NW_NEON_WRITER_URL\s*\)/.test(src), false, f + ' imprime le secret');
      assert.ok(/<url>/.test(src), f + ' masque les chaînes postgres dans les erreurs');
    }
  });

  await t('aucune chaîne de connexion avec mot de passe ni clé serveur dans un fichier suivi', () => {
    const suivis = execFileSync('git', ['ls-files'], { cwd: RACINE, encoding: 'utf8' }).split('\n').filter(Boolean);
    const motifs = [/sb_secret_[A-Za-z0-9]{8,}/, /postgres(?:ql)?:\/\/[A-Za-z0-9_]+:[A-Za-z0-9_]{12,}@[a-z0-9.-]+\.neon\.tech/];
    const fautifs = suivis.filter((f) => {
      const p = path.join(RACINE, f);
      if (!fs.existsSync(p) || fs.statSync(p).size > 5e6) return false;
      const c = fs.readFileSync(p, 'utf8');
      return motifs.some((m) => m.test(c));
    });
    assert.deepEqual(fautifs, [], 'secret trouvé dans : ' + fautifs.join(', '));
  });

  console.log(ko === 0 ? '\n✅ cron auth (Neon) : OK\n' : '\n❌ ' + ko + ' échec(s)\n');
  process.exit(ko === 0 ? 0 : 1);
})();
