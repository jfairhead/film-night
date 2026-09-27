// Film night service worker: app shell works offline; the film list always tries the network first.
const CACHE = "film-night-v5";
const SHELL = ["./", "index.html", "app.js", "manifest.json", "icon-192.png", "icon-512.png", "films.json"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const networkFirst = url.pathname.endsWith("films.json") || url.pathname.endsWith("app.js") || e.request.mode === "navigate";
  if (networkFirst) {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
  }
});
