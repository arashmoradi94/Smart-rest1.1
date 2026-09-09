const CACHE = "break-manager-v2";
const SHELL = ["/", "/login", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

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
  let data = null;
  try {
    const parsed = e.data ? e.data.json() : null;
    if (parsed && typeof parsed === "object") data = parsed;
  } catch (error) {
    console.warn("Invalid push payload", error);
  }
  if (!data || typeof data.title !== "string" || typeof data.body !== "string") return;
  const kinds = ["break-start", "break-end", "reminder", "achievement", "announcement"];
  const kind = kinds.includes(data.kind) ? data.kind : "announcement";
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//")
    ? data.url
    : "/dashboard";
  const vibration = {
    "break-start": [120, 80, 120, 80, 220],
    "break-end": [180, 70, 120, 70, 180],
    reminder: [70],
    achievement: [50, 50, 50, 50, 90],
    announcement: [60],
  }[kind] ?? [60];
  e.waitUntil(
    self.registration.showNotification(data.title ?? "مدیریت استراحت", {
      body: data.body ?? "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag,
      vibrate: vibration,
      dir: "rtl",
      lang: "fa",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const requestedUrl = e.notification.data?.url;
  const url = typeof requestedUrl === "string" && requestedUrl.startsWith("/") && !requestedUrl.startsWith("//")
    ? requestedUrl
    : "/dashboard";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const client = list.find((c) => "focus" in c);
      if (client) return client.focus();
      return self.clients.openWindow(url);
    }),
  );
});
