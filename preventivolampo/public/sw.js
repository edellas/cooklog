// Service worker: l'app funziona anche senza connessione (cantieri, cantine, zone senza campo).
// Cambia VERSIONE a ogni pubblicazione importante per forzare l'aggiornamento della cache.
const VERSIONE = "pl-v3";
const FILE_APP = [
  "app.html",
  "accetta.html",
  "css/app.css",
  "fonts/inter-latin.woff2",
  "fonts/inter-latin-ext.woff2",
  "js/app.js",
  "js/accetta.js",
  "js/core.js",
  "js/config.js",
  "js/store.js",
  "js/pdf.js",
  "js/licenza.js",
  "js/link.js",
  "js/firma.js",
  "js/foto.js",
  "js/ui.js",
  "js/mestieri.js",
  "js/icone.js",
  "js/incassi.js",
  "js/qr.js",
  "vendor/jspdf.umd.min.js",
  "vendor/jspdf.plugin.autotable.min.js",
  "vendor/qrcode.js",
  "manifest.webmanifest",
  "img/icona.svg",
  "img/icona-192.png",
];

// Alcuni hosting reindirizzano "app.html" -> "/app": una risposta rediretta non può essere
// usata per una navigazione, quindi la si salva in cache come risposta "pulita".
async function pulita(r) {
  if (!r.redirected) return r;
  return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(VERSIONE)
      .then((c) =>
        Promise.all(
          FILE_APP.map(async (f) => {
            const r = await fetch(f, { cache: "reload" });
            if (!r.ok) throw new Error(`${f}: ${r.status}`);
            await c.put(f, await pulita(r));
          }),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((chiavi) => Promise.all(chiavi.filter((k) => k !== VERSIONE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // Pagine: prima la rete (per avere sempre l'ultima versione), poi la cache.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok && r.type === "basic" && !r.redirected) {
            const copia = r.clone();
            caches.open(VERSIONE).then((c) => c.put(req, copia));
          }
          return r;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("app.html"))),
    );
    return;
  }

  // File statici: risposta immediata dalla cache, aggiornamento in background.
  e.respondWith(
    caches.match(req).then((inCache) => {
      const rete = fetch(req)
        .then(async (r) => {
          if (r.ok && r.type === "basic") {
            const copia = await pulita(r.clone());
            caches.open(VERSIONE).then((c) => c.put(req, copia));
          }
          return r;
        })
        .catch(() => inCache);
      return inCache || rete;
    }),
  );
});
