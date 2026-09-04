/* ============================================================
   core/appcache.js — registers sw.js (the file cache that makes a reload
   free — see its header) and shows the one message it can send: an update
   landed in the cache behind this page, reload to get it.

   Not on localhost / 127.0.0.1 / file: (tools, and a dev who wants the
   tree as it is). ?nosw=1 unregisters and clears, for a player with a
   stuck cache. ?cfg_APP_CACHE=0 does the same through the config bus.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ || (window.CBZ = {});
  if (!("serviceWorker" in navigator)) return;
  const host = location.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "" || location.protocol === "file:";
  const off = /[?&]nosw=1/.test(location.search) || (CBZ.CONFIG && CBZ.CONFIG.APP_CACHE === false);

  function unregisterAll() {
    return navigator.serviceWorker.getRegistrations().then(function (rs) {
      const jobs = rs.map(function (r) { return r.unregister(); });
      if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
      return Promise.all(jobs);
    }).catch(function () {});
  }
  if (local || off) { CBZ.appCacheOff = off ? unregisterAll() : Promise.resolve(); return; }
  // how the last navigation was served — {hit, miss} counts from the worker
  CBZ.appCacheStats = function () {
    return new Promise(function (resolve) {
      const c = navigator.serviceWorker.controller;
      if (!c) { resolve(null); return; }
      const onMsg = function (e) { if (e.data && e.data.type === "cbz-stats") { navigator.serviceWorker.removeEventListener("message", onMsg); resolve({ hit: e.data.hit, miss: e.data.miss }); } };
      navigator.serviceWorker.addEventListener("message", onMsg);
      c.postMessage({ type: "cbz-stats" });
      setTimeout(function () { navigator.serviceWorker.removeEventListener("message", onMsg); resolve(null); }, 2000);
    });
  };

  let told = false;
  function toast(msg) {
    if (told) return; told = true;
    const el = document.createElement("div");
    el.id = "appUpdate";
    el.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:60;background:#1a1f2a;color:#fff;" +
      "padding:10px 16px;border-radius:12px;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);cursor:pointer;pointer-events:auto";
    el.textContent = msg + " — tap to reload";
    el.addEventListener("click", function () { location.reload(); });
    document.body.appendChild(el);
  }
  navigator.serviceWorker.addEventListener("message", function (e) {
    const d = e.data || {};
    if (d.type === "cbz-update") toast("A new version is ready");
  });
  // Register once the page has loaded: the first visit's 575 script fetches
  // are not competing with the worker's install, and every later visit is
  // answered from the cache before the network is even asked.
  addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function (e) { try { console.warn("[appcache]", e); } catch (_) {} });
  });
  CBZ.appCacheClear = function () {
    if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: "cbz-clear" });
  };
})();
