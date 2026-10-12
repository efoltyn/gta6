/* ============================================================
   battle/core/lod.js — WHO GETS WHAT: the tier rules, the budgets and the
   scheduler that applies them. Page-independent. Every number a tier
   decision uses lives HERE (and the settings panel writes into it).

   THE TIERS (core/store.js, core/tiersim.js)
     FULL  a full rig and the page's full brain (src/battle/*)
     MID   tiersim's individual brain, time-sliced
     FAR   tiersim's squad brain; every man still fires his own rounds
   Tiers are decided PER SQUAD (ten men), so a squad never straddles two
   brains: its march column, its shared contact and its line stay one thing.

   PROMOTION RULES (a squad becomes FULL when any is true; it drops a tier
   only after the condition has been false for DEMOTE_S seconds, and with
   HYSTERESIS on distances so nothing flickers at a boundary):
     its centre within FULL_R of the lens (nearest first, up to FULL_CAP men)
     it holds the lens subject or the player's man (forced)
   MID: within MID_R of the lens (up to MID_CAP men). FAR: everyone else.
   A battle no bigger than FULL_CAP is all FULL: exactly the page it was.

   EQUIVALENCE (held by tools/npcwar-fidelity.mjs): the same matchup run
   all-FULL and tiered gives the same winner, loser casualties within 15
   points, time to decision within 25%.

   PUBLIC  CBZ.battleLod = { RULES, BUDGET, DEVICE, animEvery(d2), tierOf(d2, why),
     device(), caps(device), schedule(sq, cam, dt, out) }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis);
  const CBZ = W.CBZ || (W.CBZ = {});
  const RULES = {
    ANIM_NEAR: 70, ANIM_MID: 150,     // render LOD: full rate / every 2nd / every 4th frame
    FULL_R: 90, MID_R: 400, HYSTERESIS: 1.15, DEMOTE_S: 3, HIT_S: 4,
    // a convoy out of contact this far from the lens moves as markers on its
    // route at road speed (systems/convoy.js), and drives again inside it
    CONVOY_R: 450,
    // full rigs alive at once. MEASURED (tools/npcwar-scale-bench.mjs): the
    // page's full brain is ~15-20 us a man a frame before its rig is animated
    // or drawn, ~7x a MID row; 320 is ~6 ms of brain on a desktop core
    FULL_CAP: { desktop: 320, tablet: 160, phone: 90 },
    MID_CAP: { desktop: 4000, tablet: 1500, phone: 600 },  // individual brains (~0.8 us a row a frame)
    PROMOTE_PER_FRAME: { desktop: 3, tablet: 2, phone: 1 }, // squads built per frame (a rig is ~ms)
  };
  /* AI tick budget per tier: how often a unit thinks (s), how often the
     tier is walked (s), and the frame milliseconds the tier may spend; the
     scheduler time-slices inside it. WORKER: MID and FAR run in the sim
     worker (core/simworker.js) when the page can host one. */
  const BUDGET = {
    think: { full: 0.25, mid: 0.25, far: 1.0 },
    tick: { mid: 0.1, far: 0.25 },
    frameMs: { full: 6, mid: 2.5, far: 1.5 },
    worker: { far: true, mid: true, full: false },
  };
  function device() {
    if (CBZ.deviceClass) return CBZ.deviceClass;
    const nav = W.navigator || {};
    const ua = String(nav.userAgent || "");
    const touch = (nav.maxTouchPoints || 0) > 0;
    const sw = Math.min(W.screen ? W.screen.width : 1920, W.screen ? W.screen.height : 1080);
    if (/iPhone|Android.*Mobile/.test(ua) || (touch && sw < 600)) return "phone";
    if (/iPad/.test(ua) || (touch && /Macintosh/.test(ua)) || (touch && sw < 1100)) return "tablet";
    return "desktop";
  }
  const DEVICE = device();
  function caps(dev) {
    dev = dev || DEVICE;
    return { full: RULES.FULL_CAP[dev] || 900, mid: RULES.MID_CAP[dev] || 6000, promote: RULES.PROMOTE_PER_FRAME[dev] || 2 };
  }
  const ANEAR2 = RULES.ANIM_NEAR * RULES.ANIM_NEAR, AMID2 = RULES.ANIM_MID * RULES.ANIM_MID;
  function animEvery(d2) { return d2 < ANEAR2 ? 1 : d2 < AMID2 ? 2 : 4; }
  // why: { subject, player, engagedFull, hitRecent, crewOfFull } (any truthy -> FULL)
  function tierOf(d2, why) {
    if (why && (why.subject || why.player || why.engagedFull || why.hitRecent || why.crewOfFull)) return 0;
    if (d2 < RULES.FULL_R * RULES.FULL_R) return 0;
    if (d2 < RULES.MID_R * RULES.MID_R) return 1;
    return 2;
  }
  /* THE SCHEDULER. sq = { n, cx, cz, men (living count), tier (current),
     forced (Uint8: 1 = must be FULL), hold (seconds the squad has wanted a
     lower tier) }. Writes sq.want. Nearest squads win the expensive tiers
     (a counting sort by distance, no per-frame sort), with hysteresis: a
     squad already in a tier keeps it out to HYSTERESIS x the radius, and only
     drops after DEMOTE_S seconds of wanting to. caps: { full, mid } men. */
  let _bins = new Int32Array(0), _order = new Int32Array(0), _d = new Float32Array(0);
  function schedule(sq, camX, camZ, dt, cp, opt) {
    const n = sq.n, R = RULES;
    opt = opt || {};
    const fullR = opt.fullR || R.FULL_R, midR = opt.midR || R.MID_R, hyst = R.HYSTERESIS;
    const force = opt.force;              // 0 | 1 | 2: every squad this tier (tools)
    if (_d.length < n) { _d = new Float32Array(n); _order = new Int32Array(n); }
    const NB = 512, binW = Math.max(1, midR * hyst * 2 / NB);
    if (_bins.length < NB + 2) _bins = new Int32Array(NB + 2);
    _bins.fill(0);
    for (let q = 0; q < n; q++) {
      const dx = sq.cx[q] - camX, dz = sq.cz[q] - camZ;
      _d[q] = Math.sqrt(dx * dx + dz * dz);
      _bins[Math.min(NB + 1, (_d[q] / binW) | 0)]++;
    }
    let acc = 0;
    for (let b = 0; b < NB + 2; b++) { const c = _bins[b]; _bins[b] = acc; acc += c; }
    for (let q = 0; q < n; q++) _order[_bins[Math.min(NB + 1, (_d[q] / binW) | 0)]++] = q;
    let full = 0, mid = 0;
    // forced squads take their FULL seats first
    for (let q = 0; q < n; q++) if (sq.forced[q] && sq.men[q] > 0) full += sq.men[q];
    for (let k = 0; k < n; k++) {
      const q = _order[k], m = sq.men[q];
      if (!m) { sq.want[q] = sq.tier[q]; continue; }
      if (force != null && force >= 0) { sq.want[q] = sq.forced[q] ? 0 : force; continue; }
      if (sq.forced[q]) { sq.want[q] = 0; sq.hold[q] = 0; continue; }
      const cur = sq.tier[q], d = _d[q];
      let w = 2;
      const fr = cur === 0 ? fullR * hyst : fullR, mr = cur <= 1 ? midR * hyst : midR;
      if (d < fr && full + m <= cp.full) w = 0;
      else if (d < mr && mid + m <= cp.mid) w = 1;
      // demotion waits DEMOTE_S; promotion is immediate
      if (w > cur) {
        sq.hold[q] += dt;
        if (sq.hold[q] < R.DEMOTE_S && (cur === 0 ? full + m <= cp.full * 1.1 : mid + m <= cp.mid * 1.1)) w = cur;
      } else sq.hold[q] = 0;
      if (w === 0) full += m; else if (w === 1) mid += m;
      sq.want[q] = w;
    }
    return { full: full, mid: mid };
  }
  CBZ.battleLod = { RULES: RULES, BUDGET: BUDGET, DEVICE: DEVICE, device: device, caps: caps,
    animEvery: animEvery, tierOf: tierOf, schedule: schedule };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleLod;
})();
