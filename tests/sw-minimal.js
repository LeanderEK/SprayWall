// The smallest possible service worker, used only to find out whether a browser can run service workers at all.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
