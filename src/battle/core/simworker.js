/* ============================================================
   battle/core/simworker.js — THE MID AND FAR SIMS OFF THE MAIN THREAD.
   A dedicated Web Worker that runs core/tiersim.js (the same file the page
   runs in-process and node runs in the proofs) over the unit store.

   Two ways to share the rows (core/simlink.js picks):
     shared    the page is cross-origin isolated: every column is on a
               SharedArrayBuffer, the worker writes the MID/FAR rows the
               renderer reads, the page writes the FULL rows the worker
               aims at. Only commands and events cross as messages.
     transfer  no SharedArrayBuffer (GitHub Pages cannot send COOP/COEP): the
               worker owns its copy of the rows; the page sends the FULL rows
               each step and the worker sends back a packed snapshot of every
               row (a transferable Float32Array, ping-ponged, never copied)
               at up to SNAP_HZ, and the full state of rows the page is about
               to promote, on request.

   MESSAGES  in:  init {mode, cfg, specs, store}
                  step {dt, ctx, full?, hurts, tiers, want?, buf?}
             out: ready {}    ev {events, n, ms, snap?, state?}
   Page-independent: importScripts only, no DOM.
============================================================ */
(function () {
  "use strict";
  const W = self;
  W.CBZ = W.CBZ || {};
  const base = (W.location && W.location.href ? W.location.href.replace(/[^/]*$/, "") : "");
  const ver = (W.location && W.location.search) || "";
  try { importScripts(base + "store.js" + ver, base + "flow.js" + ver, base + "tiersim.js" + ver); }
  catch (e) { W.postMessage({ t: "error", why: String(e && e.message || e) }); return; }
  const CBZ = W.CBZ;
  // the snapshot every row ships back in transfer mode (floats per row)
  const SNAP = ["x", "y", "z", "heading", "vx", "vz", "hp", "life", "crouch", "slot", "tgt", "tier"];
  const STATE = ["mag", "cool", "reloadT", "supp", "iqs", "routT", "routBest", "routStall", "rallyT", "gx", "gz", "hx", "hz", "tgt", "crouch"];
  const SNAP_DT = 1 / 15;
  let S = null, T = null, mode = "transfer", snapAt = -1, spare = [];
  W.onmessage = function (e) {
    const m = e.data;
    if (m.t === "init") {
      mode = m.mode;
      if (mode === "shared") S = CBZ.battleStore.adopt(m.store.bufs, m.store.types, m.store.cap, m.store.rows);
      else {
        S = CBZ.battleStore.create(m.store.cap);
        for (const k in m.store.cols) {
          if (!S.cols[k]) S._extra[k] = { Ctor: m.store.cols[k].constructor, fill: 0 };
          S.cols[k] = m.store.cols[k];
        }
        S.rows = m.store.rows;
      }
      T = CBZ.battleTierSim.create(S, m.cfg);
      for (let i = 0; i < m.specs.length; i++) T.profile(m.specs[i]);
      T.squads();
      W.postMessage({ t: "ready", mode: mode });
      return;
    }
    if (m.t !== "step" || !T) return;
    if (m.buf) spare.push(m.buf);
    const C = S.cols;
    // the page's FULL rows (transfer mode): where they are and how they stand
    if (m.full) {
      const F = m.full;
      for (let i = 0; i < m.nFull; i++) {
        const o = i * 9, r = F[o] | 0;
        C.x[r] = F[o + 1]; C.y[r] = F[o + 2]; C.z[r] = F[o + 3]; C.heading[r] = F[o + 4];
        C.hp[r] = F[o + 5]; C.life[r] = F[o + 6]; C.crouch[r] = F[o + 7]; C.spd[r] = F[o + 8];
        C.tier[r] = 0;
      }
    }
    // tier changes (a squad promoted or demoted, MID <-> FAR)
    if (m.tiers) for (let i = 0; i < m.tiers.length; i++) {
      const c = m.tiers[i];
      C.tier[c.r] = c.w;
      if (c.w !== 0) {
        if (c.cols) for (const k in c.cols) C[k][c.r] = c.cols[k];
        T.adopt(c.r, c.st);
      }
    }
    // FULL men's rounds that landed on rows (ghosts)
    if (m.hurts) for (let i = 0; i < m.hurts.length; i += 4) T.hurt(m.hurts[i] | 0, m.hurts[i + 1], m.hurts[i + 2] | 0, m.hurts[i + 3] > 0);
    // the step, sub-stepped like the page's own clock
    let left = Math.min(0.5, m.dt);
    const t0 = performance.now();
    while (left > 1e-6) { const d = Math.min(0.1, left); T.step(d, m.ctx); left -= d; }
    const ms = performance.now() - t0;
    const out = { t: "ev", n: T.nEv, ms: ms, simMs: T.ms, events: T.events.slice(0, T.nEv * 4), stats: T.stats };
    T.nEv = 0;
    const transfer = [out.events.buffer];
    // the rows the page asked for, in full, before it promotes them
    if (m.want && m.want.length) {
      const st = new Float32Array(m.want.length * (STATE.length + 1));
      for (let i = 0; i < m.want.length; i++) {
        const r = m.want[i], o = i * (STATE.length + 1);
        st[o] = r;
        for (let k = 0; k < STATE.length; k++) st[o + 1 + k] = C[STATE[k]][r];
      }
      out.state = st; out.stateKeys = STATE; transfer.push(st.buffer);
    }
    // the snapshot of every row (transfer mode), at SNAP_HZ
    if (mode !== "shared" && (T.simT - snapAt >= SNAP_DT || snapAt < 0)) {
      snapAt = T.simT;
      const n = S.rows, need = n * SNAP.length;
      let buf = null;
      while (spare.length && !buf) { const b = spare.pop(); if (b.length >= need) buf = b; }
      if (!buf) buf = new Float32Array(Math.max(need, 1024));
      for (let k = 0; k < SNAP.length; k++) {
        const col = C[SNAP[k]], off = k * n;
        for (let r = 0; r < n; r++) buf[off + r] = col[r];
      }
      out.snap = buf; out.snapRows = n; out.snapKeys = SNAP; out.snapT = T.simT;
      transfer.push(buf.buffer);
    }
    W.postMessage(out, transfer);
  };
})();
