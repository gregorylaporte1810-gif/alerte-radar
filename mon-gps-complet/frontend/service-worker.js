const CACHE_NAME = 'mon-gps-cache-v2';
const assetsToCache = [
  './index.html',
  './style.css',
  './app.js'
];

// Installation du Service Worker et mise en cache sécurisée
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Mise en cache des fichiers de l\'application');
      // On utilise add au lieu de addAll pour éviter un plantage global si un fichier échoue
      return Promise.allSettled(
        assetsToCache.map(asset => cache.add(asset).catch(err => console.log(`Fichier non mis en cache: ${asset}`, err)))
      );
    })
  );
});

// Interception des requêtes réseau pour servir le cache si besoin
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/radars')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});