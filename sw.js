/* ============================================================
   sw.js — THE RELOAD IS FREE.

   The game is 575 script tags and ~28 MB of JS with no build step, served
   by GitHub Pages with a ten-minute max-age. Every reload after that was
   575 conditional requests before the title screen existed, and V8 had to
   re-parse whatever the network re-sent. This worker makes a reload cost
   nothing on the wire:

     · index.html is NETWORK-FIRST. A push to main is still the deploy and
       the page you get is always the one on main.
     · everything else same-origin (src/, css/, assets/, games/, vendor)
       is CACHE-FIRST from a single versioned cache, filled on first use.
     · ONE version set, never a mix. A different index.html than the one
       cached means a deploy happened: the whole file cache is dropped
       BEFORE the new page is answered, so every script it names is fetched
       fresh and the set is consistent. Cross-file contracts in this repo
       are load-bearing; a stale worldmap.js under a fresh world.js would
       be worse than a slow reload.
     · a src-only push (index.html unchanged) is caught by the SWEEP: after
       each page load the worker revalidates every cached file in the
       background, stages changed bytes, swaps them in together at the
       end, and tells the page — src/core/appcache.js shows "update ready,
       reload". The first load after such a push is the previous version,
       consistently; the next is the new one.

   Not registered on localhost / 127.0.0.1 (every tool in tools/ runs
   there and must see the tree as it is), and ?nosw=1 unregisters.
   Revert for a player: DevTools → Application → Unregister, or ?nosw=1.
============================================================ */
"use strict";
const CACHE = "cbz-files-v1";
const HTML_KEY = "cbz-index-html";      // the index.html the file cache belongs to
const SWEEP_EVERY_MS = 60 * 1000;      // at most one background revalidation per minute
let sweeping = false, lastSweep = 0;
const stats = { hit: 0, miss: 0 };          // per navigation; CBZ.appCacheStats() reads them

// Install: fill the cache from the page that registered us, so the very next
// visit is already free. The browser's HTTP cache still holds these bytes
// from the load that just happened, so this costs no network at all.
async function precache() {
  const cache = await caches.open(CACHE);
  const htmlCache = await caches.open(HTML_KEY);
  const pages = ["index.html"];
  for (const page of pages) {
    let res;
    try { res = await fetch(new Request(page, { cache: "no-cache" })); } catch (e) { continue; }
    if (!res || !res.ok) continue;
    const html = await res.clone().text();
    await htmlCache.put(new Request(new URL(page, self.location.href).pathname), res);
    const urls = [];
    const re = /<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) { const u = m[1]; if (!/^(https?:)?\/\//.test(u) && u.indexOf("data:") !== 0) urls.push(u); }
    for (let i = 0; i < urls.length; i += 24) {
      await Promise.all(urls.slice(i, i + 24).map(async function (u) {
        try {
          const req = new Request(u);
          if (await cache.match(req, { ignoreVary: true })) return;
          const r = await fetch(req);
          if (r && r.ok) await cache.put(req, r);
        } catch (e) {}
      }));
    }
  }
}
self.addEventListener("install", function (e) { self.skipWaiting(); e.waitUntil(precache().catch(function () {})); });
self.addEventListener("activate", function (e) {
  e.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.filter(function (n) { return n !== CACHE && n !== HTML_KEY; }).map(function (n) { return caches.delete(n); }));
    await self.clients.claim();
  })());
});

function isNavigation(req, url) {
  return req.mode === "navigate" || req.destination === "document" || /\.html$/.test(url.pathname) || /\/$/.test(url.pathname);
}
function cacheable(req, url) {
  if (req.method !== "GET" || url.origin !== self.location.origin) return false;
  if (url.pathname.indexOf("/__") >= 0) return false;                  // proxy/dev endpoints
  return true;
}

async function bytesDiffer(a, b) {
  if (!a || !b) return true;
  const ea = a.headers.get("etag"), eb = b.headers.get("etag");
  if (ea && eb) return ea !== eb;
  const la = a.headers.get("content-length"), lb = b.headers.get("content-length");
  if (la && lb && la !== lb) return true;
  const ta = await a.clone().text(), tb = await b.clone().text();
  return ta !== tb;
}

// Navigation: network first. A changed page = a deploy = drop the file cache
// so nothing stale can be mixed into the new script set.
async function handleNavigation(req) {
  stats.hit = 0; stats.miss = 0;
  let fresh = null;
  // a Request in navigate mode cannot be re-fetched as is; ask for the URL
  try { fresh = await fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin" })); } catch (e) { fresh = null; }
  const htmlCache = await caches.open(HTML_KEY);
  const key = new Request(new URL(req.url).pathname);
  if (fresh && fresh.ok) {
    const prev = await htmlCache.match(key);
    if (await bytesDiffer(prev, fresh)) {
      if (prev) { await caches.delete(CACHE); }              // a deploy: one consistent set
      await htmlCache.put(key, fresh.clone());
    } else {
      scheduleSweep();                                        // same page: look for src-only pushes
    }
    return fresh;
  }
  const cached = await htmlCache.match(key);
  return cached || new Response("offline and never cached", { status: 503, headers: { "Content-Type": "text/plain" } });
}

async function handleFile(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) { stats.hit++; return hit; }
  stats.miss++;
  let res;
  try { res = await fetch(req); } catch (e) { return new Response("", { status: 504 }); }
  if (res && res.ok && (res.type === "basic" || res.type === "default")) {
    try { await cache.put(req, res.clone()); } catch (e) { /* quota: serve without caching */ }
  }
  return res;
}

self.addEventListener("fetch", function (e) {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (!cacheable(req, url)) return;
  if (isNavigation(req, url)) { e.respondWith(handleNavigation(req)); return; }
  if (url.search.indexOf("nosw=1") >= 0) return;
  e.respondWith(handleFile(req));
});

// The sweep: revalidate every cached file. Changed responses are staged and
// swapped in together so a reload mid-sweep sees the old set or the new one,
// never both; the page is told once, at the end.
function scheduleSweep() {
  const t = Date.now();
  if (sweeping || t - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = t;
  sweeping = true;
  sweep().catch(function () {}).then(function () { sweeping = false; });
}
async function sweep() {
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  const staged = [];
  let n = 0;
  for (const req of keys) {
    n++;
    let fresh = null;
    try { fresh = await fetch(req, { cache: "no-cache" }); } catch (e) { continue; }
    if (!fresh || !fresh.ok) continue;
    const old = await cache.match(req, { ignoreVary: true });
    if (await bytesDiffer(old, fresh)) staged.push([req, fresh]);
  }
  if (!staged.length) return;
  for (const [req, res] of staged) { try { await cache.put(req, res); } catch (e) {} }
  const clients = await self.clients.matchAll({ type: "window" });
  for (const c of clients) c.postMessage({ type: "cbz-update", changed: staged.length, checked: n });
}

self.addEventListener("message", function (e) {
  const d = e.data || {};
  if (d.type === "cbz-sweep") scheduleSweep();
  if (d.type === "cbz-clear") caches.delete(CACHE);
  if (d.type === "cbz-stats" && e.source) e.source.postMessage({ type: "cbz-stats", hit: stats.hit, miss: stats.miss });
});
