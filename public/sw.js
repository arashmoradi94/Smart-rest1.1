const CACHE = "break-manager-v1";
const SHELL = ["/", "/login", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for navigation & API, cache fallback for shell when offline
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "Content-Type": "application/json" } })));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? caches.match("/"))),
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {}
  const vibration = {
    "break-start": [70, 80, 70],
    "break-end": [100, 60, 100, 60, 150],
    reminder: [70],
    achievement: [50, 50, 50, 50, 90],
    announcement: [60],
  }[data.kind] ?? [60];
  e.waitUntil(
    self.registration.showNotification(data.title ?? "مدیریت استراحت", {
      body: data.body ?? "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag,
      vibrate: vibration,
      dir: "rtl",
      lang: "fa",
      data: { url: data.url ?? "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const client = list.find((c) => "focus" in c);
      if (client) return client.focus();
      return self.clients.openWindow(e.notification.data?.url ?? "/dashboard");
    }),
  );
});
