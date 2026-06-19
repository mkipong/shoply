/* Shoply service worker — cache-first for static assets, network-first for API */

const CACHE = "shoply-v1";
const STATIC = [
  "/",
  "/static/css/style.css",
  "/static/js/app.js",
  "/static/images/icons8-buying-100.png",
  "/static/images/icons8-online-store-48.png",
  "/static/manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Network-first for all API calls so data is always fresh
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: "offline" }), {
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // Cache-first for everything else (shell, CSS, JS, images)
  e.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      // Cache new static responses as we encounter them
      if (res.ok && request.method === "GET") {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(request, clone));
      }
      return res;
    }))
  );
});
