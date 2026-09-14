// Déchiffrement du blob patrimonial, partagé par daily_snapshot.mjs et les tests. Ne dépend que
// de webcrypto (Node ≥ 20). Ne journalise JAMAIS la phrase.
import { webcrypto } from 'node:crypto';

/** Rend l'objet { NOM: valeur, … } des 13 blocs, ou lève si la phrase est fausse / le blob illisible. */
export async function dechiffreBlobs(encSrc, phrase) {
  const m = encSrc.match(/DATA_ENC\s*=\s*(\{[\s\S]*\});/);
  if (!m) throw new Error('js/data.enc.js illisible (DATA_ENC introuvable)');
  const B = JSON.parse(m[1]);
  const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(phrase), 'PBKDF2', false, ['deriveKey']);
  const cle = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(B.sel), iterations: B.it || 250000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const clair = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(B.iv) }, cle, b64(B.data));
  return JSON.parse(new TextDecoder().decode(clair));
}

/** Remplit EN PLACE les coquilles d'un module (mêmes références que celles importées par le moteur). */
export function remplirEnPlace(mod, blocs) {
  for (const [nom, valeur] of Object.entries(blocs)) {
    const cible = mod[nom];
    if (Array.isArray(cible) && Array.isArray(valeur)) { cible.length = 0; cible.push(...valeur); }
    else if (cible && typeof cible === 'object') { for (const k of Object.keys(cible)) delete cible[k]; Object.assign(cible, valeur); }
  }
}
