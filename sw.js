const CACHE_NAME = 'program-clinic-v1';
const ASSETS = [
    './index.html',
    './src/styles/main.css',
    './src/js/app.js',
    'https://unpkg.com/dexie@latest/dist/dexie.js',
    'https://unpkg.com/lucide@latest',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
