/* ============================================================
   battle/core/simlink.js — THE PAGE'S END OF THE SIM WORKER
   (core/simworker.js). Page-independent: it needs a Worker and nothing else.

   start(S, cfg, T, opts) -> link | null
     S     the unit store (core/store.js); shared when S.shared
     cfg   the tier sim's config (core/tiersim.js create)
     T     the page's own tiersim instance: its profiles go to the worker in
           the same order, so a row's profile index means the same thing
   link.step(dt, ctx)     queue sim time; posts when the worker is free, so a
                          slow worker gets one bigger step, never a backlog
   link.hurt(r, dmg, byRow, head)   a FULL round on a row
   link.tier(r, w, st, cols)        a tier change (st: tiersim.adopt state;
                          cols: column values the page wrote, transfer mode)
   link.want(rows)        ask for the full state of rows about to be promoted
   link.stateOf(r)        that state, once it came back (or null)
   link.poll()            take the worker's replies: events -> opts.onEvents,
                          snapshot -> the store's MID/FAR rows (transfer mode)
   link.mode  "shared" | "transfer"     link.ms  the worker's last step (ms)
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis);
  const CBZ = W.CBZ || (W.CBZ = {});
  function scriptBase() {
    // this file's own URL: the worker sits next to it and rides its ?v= key
    const list = (typeof document !== "undefined" && document.getElementsByTagName) ? document.getElementsByTagName("script") : [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i].src || "";
      if (/battle\/core\/simlink\.js/.test(s)) return { base: s.replace(/simlink\.js.*$/, ""), ver: (s.split("?")[1] ? "?" + s.split("?")[1] : "") };
    }
    return { base: "../src/battle/core/", ver: "" };
  }
  function start(S, cfg, T, opts) {
    opts = opts || {};
    if (typeof Worker === "undefined") return null;
    const where = scriptBase();
    let w;
    try { w = new Worker(where.base + "simworker.js" + where.ver); } catch (e) { return null; }
    const mode = S.shared ? "shared" : "transfer";
    const L = { mode: mode, ready: false, busy: false, dt: 0, ms: 0, simMs: null, stats: null, dead: false, lag: 0 };
    let hurts = [], tiers = [], want = [], spare = null;
    const state = new Map();
    const inbox = [];
    // the config crosses as data (typed arrays are cloned once, here)
    const specs = T.profs.map(function (p) { return p.spec; });
    const init = { t: "init", mode: mode, cfg: cfg, specs: specs };
    if (mode === "shared") init.store = { bufs: S.buffers(), types: CBZ.battleStore.typesOf(S), cap: S.cap, rows: S.rows };
    else {
      const cols = {};
      for (const k in S.cols) cols[k] = S.cols[k].slice(0);
      init.store = { cols: cols, cap: S.cap, rows: S.rows };
    }
    w.onmessage = function (e) { inbox.push(e.data); };
    w.onerror = function (e) { L.dead = true; L.why = e && e.message; if (opts.onDead) opts.onDead(L.why); };
    w.postMessage(init);
    let full = null;
    function post(ctx) {
      const C = S.cols;
      const msg = { t: "step", dt: L.dt, ctx: ctx, hurts: hurts, tiers: tiers };
      if (want.length) { msg.want = want; want = []; }
      if (mode !== "shared") {
        // the FULL rows, packed: row, x y z heading hp life crouch speed
        let n = 0;
        const rows = opts.fullRows ? opts.fullRows() : null;
        const cnt = rows ? rows.length : 0;
        if (!full || full.length < cnt * 9) full = new Float32Array(Math.max(256, cnt * 9 * 2));
        for (let i = 0; i < cnt; i++) {
          const r = rows[i], o = n * 9;
          full[o] = r; full[o + 1] = C.x[r]; full[o + 2] = C.y[r]; full[o + 3] = C.z[r]; full[o + 4] = C.heading[r];
          full[o + 5] = C.hp[r]; full[o + 6] = C.life[r]; full[o + 7] = C.crouch[r]; full[o + 8] = C.spd[r];
          n++;
        }
        msg.full = full.slice(0, n * 9); msg.nFull = n;
        if (spare) { msg.buf = spare; spare = null; }
      }
      hurts = []; tiers = [];
      L.dt = 0; L.busy = true;
      const tr = [];
      if (msg.full) tr.push(msg.full.buffer);
      if (msg.buf) tr.push(msg.buf.buffer);
      w.postMessage(msg, tr);
    }
    L.step = function (dt, ctx) {
      if (L.dead) return;
      L.dt += dt;
      L.ctx = ctx;
    };
    // called once a frame: drain replies, then hand the worker the time it is owed
    L.poll = function () {
      if (L.dead) return;
      for (let i = 0; i < inbox.length; i++) {
        const m = inbox[i];
        if (m.t === "ready") { L.ready = true; continue; }
        if (m.t === "error") { L.dead = true; L.why = m.why; if (opts.onDead) opts.onDead(m.why); continue; }
        if (m.t !== "ev") continue;
        L.busy = false; L.ms = m.ms; L.simMs = m.simMs; L.stats = m.stats;
        if (m.snap) {
          // every MID/FAR row takes the worker's word for it; FULL rows are the page's
          const n = Math.min(m.snapRows, S.rows), C = S.cols, K = m.snapKeys, sn = m.snap;
          const tierOff = K.indexOf("tier") * m.snapRows;
          for (let k = 0; k < K.length; k++) {
            const key = K[k];
            if (key === "tier") continue;
            const col = C[key], off = k * m.snapRows;
            for (let r = 0; r < n; r++) if (C.tier[r] !== 0 && sn[tierOff + r] !== 0) col[r] = sn[off + r];
          }
          spare = sn;
        }
        if (m.state) {
          const K = m.stateKeys, stride = K.length + 1;
          for (let i2 = 0; i2 * stride < m.state.length; i2++) {
            const o = i2 * stride, rec = {};
            for (let k = 0; k < K.length; k++) rec[K[k]] = m.state[o + 1 + k];
            state.set(m.state[o] | 0, rec);
          }
        }
        if (opts.onEvents && m.n) opts.onEvents(m.events, m.n);
      }
      inbox.length = 0;
      if (L.ready && !L.busy && L.dt > 0 && L.ctx) post(L.ctx);
      else if (L.busy) L.lag += 1;
    };
    L.hurt = function (r, dmg, byRow, head) { hurts.push(r, dmg, byRow == null ? -1 : byRow, head ? 1 : 0); };
    L.tier = function (r, wt, st, cols) { tiers.push({ r: r, w: wt, st: st || null, cols: cols || null }); };
    L.want = function (rows) { for (let i = 0; i < rows.length; i++) { want.push(rows[i]); state.delete(rows[i]); } };
    L.stateOf = function (r) { return state.get(r) || null; };
    L.forget = function (r) { state.delete(r); };
    L.stop = function () { try { w.terminate(); } catch (e) {} L.dead = true; };
    return L;
  }
  CBZ.battleSimLink = { start: start };
})();
