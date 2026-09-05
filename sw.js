/**
 * Service worker du dashboard patrimonial (v426).
 *
 * Objectif : rendre le site consultable hors ligne et instantané au relancement, SANS
 * jamais servir un chiffre périmé à la place d'un chiffre frais.
 *
 * Stratégie par type de ressource — c'est le point important :
 *
 *   Coquille de l'app (HTML, JS, CSS)   → STALE-WHILE-REVALIDATE
 *       On sert la copie en cache immédiatement, et on rafraîchit en arrière-plan.
 *       Le versionnement `?v=N` des imports garantit qu'une nouvelle version a une
 *       URL différente : aucun risque de servir du JS périmé pour du JS neuf.
 *
 *   Données live (Supabase, Yahoo, taux de change, prix SGTM) → RÉSEAU D'ABORD
 *       Un patrimoine affiché avec des cours d'hier est pire qu'un patrimoine qui met
 *       deux secondes à charger. On ne bascule sur le cache qu'en cas d'échec réseau,
 *       et l'app affiche alors ses propres badges « statique / dernier relevé ».
 *
 *   Requêtes non-GET, et tout ce qui n'est pas same-origin hors liste → JAMAIS caché.
 */

const VERSION = 'v512';
const CACHE_COQUILLE = 'patrimoine-coquille-' + VERSION;
const CACHE_DONNEES = 'patrimoine-donnees-' + VERSION;

// Hôtes qui servent des données vivantes : toujours tenter le réseau en premier.
const HOTES_DONNEES = [
  'supabase.co',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'open.er-api.com',
  'api.exchangerate',
];

const estDonneeLive = (url) =>
  HOTES_DONNEES.some((h) => url.hostname.includes(h)) ||
  // Les prix scrapés sont servis depuis notre propre origine mais changent toutes les heures.
  url.pathname.includes('/data/') && url.pathname.endsWith('.json');

self.addEventListener('install', (e) => {
  // On ne pré-cache rien : la coquille se remplit à la première visite réelle.
  // Pré-cacher une liste figée obligerait à la maintenir en phase avec les ?v=N.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms.filter((n) => n.startsWith('patrimoine-') && !n.endsWith(VERSION))
            .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  // ── Données vivantes : réseau d'abord, cache en filet de sécurité ──
  if (estDonneeLive(url)) {
    e.respondWith(
      fetch(req)
        .then((rep) => {
          if (rep && rep.ok) {
            const copie = rep.clone();
            caches.open(CACHE_DONNEES).then((c) => c.put(req, copie)).catch(() => {});
          }
          return rep;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // ── Reste : uniquement notre propre origine ──
  if (url.origin !== self.location.origin) return;

  // ── Coquille : cache d'abord, revalidation en arrière-plan ──
  e.respondWith(
    caches.match(req).then((enCache) => {
      const reseau = fetch(req)
        .then((rep) => {
          if (rep && rep.ok) {
            const copie = rep.clone();
            caches.open(CACHE_COQUILLE).then((c) => c.put(req, copie)).catch(() => {});
          }
          return rep;
        })
        .catch(() => enCache);
      return enCache || reseau;
    })
  );
});
