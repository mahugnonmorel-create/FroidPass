// FroidPass — service worker : ouverture hors connexion + notifications sur le téléphone
const CACHE = "froidpass-v1";
const SHELL = ["/app", "/style.css?v=14", "/manifest.json", "/icon.svg"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
// L'application envoie la liste des fichiers déjà chargés pour les garder en cache
self.addEventListener("message", e => { if (e.data?.type === "precache") e.waitUntil(caches.open(CACHE).then(c => Promise.all((e.data.urls || []).map(u => c.match(u).then(m => m || fetch(u, { mode: u.startsWith(self.location.origin) ? "same-origin" : "cors" }).then(r => r.ok && c.put(u, r)).catch(() => {})))))); });

const externeStatique = u => /cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u.host);
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (u.pathname.startsWith("/api/")) return; // jamais de cache pour les API
    // Réseau d'abord (toujours la dernière version), cache si pas de réseau
    e.respondWith(fetch(req).then(r => { if (r.ok && r.type === "basic") { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; })
      .catch(async () => (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? caches.match("/app") : Response.error())));
  } else if (externeStatique(u)) {
    // Bibliothèques et polices : cache d'abord
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; })));
  }
});

// ---------- Notifications ----------
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { titre: "FroidPass", corps: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.titre || "FroidPass", { body: d.corps || "", icon: "/icon.svg", badge: "/icon.svg", tag: d.tag, data: { url: d.url || "/app#tableau" }, requireInteraction: !!d.urgent, vibrate: d.urgent ? [200, 100, 200, 100, 300] : [150] }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/app", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(l => { const w = l.find(c => c.url.startsWith(self.location.origin + "/app")); if (w) { w.navigate(url); return w.focus(); } return self.clients.openWindow(url); }));
});
