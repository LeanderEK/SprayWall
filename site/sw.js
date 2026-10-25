// The service worker: it saves the whole app on the phone the first time it is opened, so everything works with no
// signal afterwards. Run `python tools/stamp.py` after changing any file in this folder: it rewrites the two lines below
// (the list of files to save, and a version made from their contents) so phones notice the new version.

const VERSION = 'b2e7110ac7d5';
const ASSETS = [
  "./",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./index.html",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/data/db.js",
  "./src/data/repo.js",
  "./src/data/wallimport.js",
  "./src/domain/climbs.js",
  "./src/domain/holds.js",
  "./src/domain/outline.js",
  "./src/domain/roles.js",
  "./src/domain/share.js",
  "./src/domain/viewport.js",
  "./src/domain/wallpack.js",
  "./src/domain/zip.js",
  "./src/main.js",
  "./src/ui/dom.js",
  "./src/ui/editor.js",
  "./src/ui/importer.js",
  "./src/ui/list.js",
  "./src/ui/sharing.js",
  "./src/ui/viewer.js",
  "./src/ui/walls.js",
  "./src/ui/wallview.js",
  "./styles.css"
];

const CACHE = `spraywall-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((path) => new Request(path, { cache: 'reload' })))),
  );
  // No skipWaiting here: the new version waits until you tap "Update" (or close and reopen the app), so it never
  // changes under you in the middle of setting a climb.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('spraywall-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((saved) => {
      if (saved) return saved;
      // A page address we have not saved (for example one typed by hand) still opens the app. An address ending in a file
      // name, such as the wall pack download, is a real file and goes to the web as it is.
      if (request.mode === 'navigate' && /\/[^/.]*$/.test(new URL(request.url).pathname)) {
        return caches.match('./index.html').then((page) => page || fetch(request));
      }
      return fetch(request);
    }),
  );
});
