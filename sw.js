// Service worker: la app funciona sin conexión.
// - Código, estilos y catálogo: primero la red (para recibir actualizaciones); sin red, lo guardado.
// - Imágenes de cartas: primero las guardadas en el dispositivo; si no están, la red.
const VERSION = 'carpetas-v4';
const IMG_CACHE = 'carpetas-imagenes-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/catalog.js', 'js/store.js', 'js/importer.js', 'js/autofill.js',
  'js/sync.js', 'js/ui.js', 'js/filters.js', 'js/picker.js', 'js/binder.js', 'js/panels.js', 'js/chars.js', 'js/charsui.js',
  'js/camera.js', 'js/table.js', 'js/geom.js', 'js/offline.js', 'js/vendor/preact-htm.js',
  'fonts/barlow-latin-400-normal.woff2', 'fonts/barlow-latin-500-normal.woff2', 'fonts/barlow-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-500-normal.woff2', 'fonts/barlow-condensed-latin-600-normal.woff2', 'fonts/barlow-condensed-latin-700-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL).then(() => c.add('data/catalog.json').catch(() => null))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // Se borran versiones viejas del código, nunca las imágenes guardadas
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== IMG_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    if (req.destination === 'image') {
      e.respondWith(caches.open(IMG_CACHE).then(c => c.match(req.url)).then(hit => hit || fetch(req)));
    }
    return;
  }
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
