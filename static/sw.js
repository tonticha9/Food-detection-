self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Basic pass-through fetch - hairuhusu offline caching ya API calls,
// lakini inaruhusu "Add to Home Screen" kufanya kazi
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
