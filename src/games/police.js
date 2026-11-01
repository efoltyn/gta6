/* ============================================================
   games/police.js — PRECINCT 13: GET YOUR BOY OUT, as a GAME PACKAGE.

   A paperwork heist ON the engine, inside a police station you walk into
   LEGALLY. Your lieutenant (LT. DECKER) got pinched with the crew's stash.
   Before the 20-minute shift change you must (1) FREE HIM — post steep cash
   bail at the window OR get the charges kicked by the corrupt desk sergeant
   (password bought from the bondsman outside, real cash at the vig) — and
   (2) RECOVER THE STASH from the EVIDENCE CAGE before it's logged out to the
   DA: a valid sign-out needs a CASE NUMBER (lifted from an unattended desk
   file while its owner is at the coffee machine) plus a BADGE glance that
   fools the rookie clerk but never the veteran (READ THE NAMEPLATE). His
   CHARGE METER rises while he keeps talking in the box — slide the lawyer
   card through the viewing-window tray to freeze it. The K-9 by the rear
   exit smells the stash on the way out = alarm, unless you tossed it the
   steak from the break room. The metal detector at the door trips on a
   drawn/metal weapon = immediate heat (real inventory/weapon state).
   Endings: WIN both · PARTIAL one · LOSE (heat maxes → booked, cell-block-z
   homage) · LEAVE (walk out empty, clean).

   ─── WHAT IS PORTED vs REBUILT ─────────────────────────────────────────
   PORTED (pure logic salvaged verbatim from games/police.html, the 1823-line
   standalone design reference — no THREE, no DOM):
     • the SHIFT CLOCK  (SHIFT_LEN=1200, CASE_NO=4471-B)
     • the DUTY ROSTER rotation (CAGE_SHIFTS / COFFEE pulls / RECORDS_RUN /
       STUDY windows → cageClerkAt / awayAt / rosterAt)
     • CHAIN-OF-CUSTODY validation (custodyCheck: case# + badge-tier truth
       table — PYE takes an escort badge, MERCER the veteran does not)
     • the CHARGE METER climb + freeze, chargeTier ladder
     • BAIL-vs-BOND math (bailQuote 400+8·charges; bondsman password/bribe/
       loan-at-vig constants)
     • the K-9 SMELL check + the deterministic FLUORESCENT flicker schedule
   REBUILT as engine-native (the standalone's shell is DROPPED):
     • the venue — a compact precinct dressed with ctx.box/solid/light, only
       load-bearing props (WHY rule): detector, front desk, bail window,
       visitor podium+badge, roster board, coffee machine, break fridge,
       Reyes' case-file desk, evidence cage+gate+nameplate, interrogation
       viewing window+doc tray, holding bars, rear fire door, K-9 kennel,
       bondsman booth, the crew's extraction beater.
     • the CAST — every officer/clerk/sergeant/bondsman and the boy is a REAL
       city ped via ctx.npc (brain, wardrobe, gunpoint hands-up, cityKillPed
       death). The roster ROTATES them on the visible shift timer by driving
       their pinned staffPost between posts (handle.at()).
     • movement/camera/collision/money/HUD are the ENGINE's — the standalone's
       renderer/input/player controller are gone.

   ─── THE COP-FLAG DECISION (deliberate; documented per the brief) ─────────
   cityOutfitIsCop reads the PLAYER's worn outfit (g.cityWornOutfit.cop) — it
   is a player-impersonation predicate and is NEVER touched by how a package
   dresses peds. The real question is whether the precinct STAFF should read
   as police to the WANTED SYSTEM (i.e. carry kind:"cop"). DECISION: they do
   NOT. Staff are cast as PINNED ctx.npc peds (kind:"staff"), dressed with
   the uniform catalog's NON-cop fits (city/outfits.js CAT.precinct: the
   patrol uniform and duty belt; CAT.detective: plainclothes, shield on the
   belt) — never kind:"cop", never the cop:true "police" catalog fit. This follows the casino precedent (guard blacks,
   "no cop flag"). Consequences, all INTENDED for a legal walk-in:
     • killing a desk clerk is ordinary homicide heat via the ped death
       funnel — NOT an instant 5★ cop-kill (tgt.kind==="cop" path).
     • staff never patrol, gun-stop, join hunts, or deplete the finite police
       force pool — they stay pinned at their posts, which the observation/
       roster model needs.
     • the wanted ramp and the real city police (city/police.js, which we do
       not edit) are untouched: THIS precinct is a bureaucratic obstacle
       course, and "bringing heat in" is handled by the package's own metal
       detector, not by wiring the staff into the force.

   Determinism: BUILD + roster + flicker are byte-identical per seed (fixed
   constants / fixed-seed mulberry / ctx.rand only — multiplayer law #12).
   Runtime dialogue picks go through one reseedable funnel. Revert:
   CBZ.CONFIG.PKG_POLICE = false (nothing mounts; city/police.js untouched).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_POLICE == null) CBZ.CONFIG.PKG_POLICE = true;

  /* ==========================================================
     1. RANDOM — one runtime funnel (dialogue/flavor). RIGQ lets a
        probe force exact rolls; reseedable so the gate is stable.
        BUILD geometry never uses this (uses fixed consts + ctx.rand).
     ========================================================== */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  let runRng = mulberry32(707707);
  const RIGQ = [];
  function nextRand() { return RIGQ.length ? RIGQ.shift() : runRng(); }
  function seedRng(s) { runRng = mulberry32(s | 0); RIGQ.length = 0; }
  function pick(arr) { return arr.length ? arr[Math.floor(nextRand() * arr.length) % arr.length] : ""; }

  /* ==========================================================
     2. PURE RULES  (salvaged from games/police.html)
        Shift clock · duty roster · custody · charges · bail/bond ·
        K-9 · detector · flicker.  No THREE, no DOM — the live sim,
        simShift(n) and the gate all run THESE.
     ========================================================== */
  const SHIFT_LEN = 1200;            // 20:00 to shift change (seconds)
  const CASE_NO = "4471-B";          // the duffel's valid case number (on Reyes' file)

  // cage clerk rotation across the shift; who runs the log room when.
  const CAGE_SHIFTS = [[0, 420, "PYE"], [420, 840, "MERCER"], [840, 1200, "PYE"]];
  // FRESH POT chime pulls the scheduled officer off post for AWAY seconds.
  const COFFEE = [[160, "REYES"], [320, "PYE"], [480, "VOSS"], [640, "DASILVA"], [800, "MERCER"], [960, "PYE"], [1120, "REYES"]];
  const AWAY = 55;
  const RECORDS_RUN = [520, 585];    // Reyes leaves his desk for the records room
  const STUDY = [[200, 212], [650, 662], [1000, 1012]]; // Brisco reads the wanted board (poster memory)

  // BAIL vs BOND economy (the two money paths).
  const BOND = { PASSWORD: 200, BRIBE: 250, LOAN_NOW: 500, LOAN_OWED: 700 }; // loan = 40% vig
  function bailQuote(charges) { return (charges >= 100) ? null : Math.round(400 + 8 * Math.round(charges)); }
  function chargeTier(c) {
    return c >= 100 ? "RICO REFERRAL" : c >= 70 ? "TRAFFICKING" : c >= 45 ? "POSS. W/ INTENT" : "POSSESSION";
  }
  function awayAt(name, t) { for (const c of COFFEE) if (c[1] === name && t >= c[0] && t < c[0] + AWAY) return true; return false; }
  function cageClerkAt(t) {
    for (const s of CAGE_SHIFTS) if (t >= s[0] && t < s[1]) return awayAt(s[2], t) ? null : s[2];
    return null;
  }
  // who is ON POST RIGHT NOW. `lawyered` frees Voss from the interrogation.
  function rosterAt(t, lawyered) {
    t = Math.max(0, Math.min(SHIFT_LEN, t));
    return {
      frontDesk: "KOWALCZYK",
      lobby: "BRISCO",
      bail: awayAt("DASILVA", t) ? null : "DASILVA",
      cage: cageClerkAt(t),
      bullpenDesk: (awayAt("REYES", t) || (t >= RECORDS_RUN[0] && t < RECORDS_RUN[1])) ? null : "REYES",
      interrogation: (t < 120) ? null : (awayAt("VOSS", t) ? null : (lawyered ? null : "VOSS")),
      k9: "REX",
    };
  }
  // CHAIN OF CUSTODY — the sign-out truth table. PYE (rookie) accepts any
  // badge (tier ≥ 1, the lifted escort badge); MERCER (veteran, 22 years)
  // demands a real precinct star (tier ≥ 2) — READ THE NAMEPLATE.
  function custodyCheck(caseNo, badgeTier, t, lawyered) {
    const clerk = cageClerkAt(t == null ? (S ? S.t : 0) : t);
    if (!clerk) return { clerk: null, caseOk: false, badgeOk: false, accept: false, reason: "post empty" };
    const caseOk = caseNo === CASE_NO;
    const badgeOk = clerk === "PYE" ? (badgeTier | 0) >= 1 : (badgeTier | 0) >= 2;
    return {
      clerk, caseOk, badgeOk, accept: caseOk && badgeOk,
      reason: !caseOk ? "bad case number" : !badgeOk ? (clerk === "MERCER" ? "veteran wants a real star" : "needs any badge") : "ok",
    };
  }
  // K-9 SMELL — pass the pen carrying the stash and REX alarms, UNLESS he is
  // busy with the steak. Pure: the alarm truth from the three facts that matter.
  function k9Alarm(o) { o = o || {}; return !!o.duffel && !(o.steakDeployed && o.dogEating); }
  // METAL DETECTOR — a DRAWN gun or a held melee reads as metal at the gate.
  // A holstered/stowed piece passes (the challenge is bringing iron OUT).
  function armedEntry(w) { w = w || {}; return (!!w.gun && !w.stowed) || !!w.melee; }

  // deterministic fluorescent flicker over the cage (blinds the clerk in the
  // dark windows). Fixed seed → byte-identical schedule for the whole shift.
  const FLICK = (function () {
    const b = mulberry32(1313), ev = []; let t = 6;
    while (t < SHIFT_LEN + 40) { const dark = 1.6 + b() * 0.9; ev.push({ warn: t - 0.8, off: t, on: t + dark }); t += 6 + b() * 7; }
    return ev;
  })();
  function flickerPhaseAt(t) {
    for (const e of FLICK) { if (t >= e.warn && t < e.off) return "warn"; if (t >= e.off && t < e.on) return "dark"; }
    return "lit";
  }

  /* ==========================================================
     3. RUNTIME STATE — the current RUN (fresh each attempt); cross-run
        STATS live in ctx.state (persisted).  S is the live heist.
     ========================================================== */
  let C = null;       // package ctx (once mounted)
  let V = null;       // venue 3D refs
  let S = null;       // the live run (null until started)
  let Sbag = null;    // persisted stats bag
  let near = false, panelMode = null, lastPhase = "lit", lastCage = "PYE";

  function bag() { return Sbag || (Sbag = C.state(() => ({ attempts: 0, wins: 0, partials: 0, busted: 0, bestTimeLeft: 0 }))); }
  function saveStats() { C && C.saveState(); }
  function fmtT(s) { s = Math.max(0, s); const m = Math.floor(s / 60), ss = Math.floor(s % 60); return String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0"); }
  function toast(m) { C && C.hud.toast(m); }

  function freshRun() {
    return {
      t: 0, started: false, ended: false, ending: null, endWhy: "", detained: false,
      heat: 0, heatPeak: 0, paid: 0, loanGot: 0, loanOwed: 0,
      charges: 35, chargesKicked: false, lawyered: false, talking: false,
      custody: [
        { t: "-1d", item: "E-3298 (9mm pistol)", caseNo: "4466-A", badge: "PCT-STAR", clerk: "MERCER", action: "SIGN-IN" },
        { t: "-4h", item: "E-3312 (duffel, narcotics)", caseNo: CASE_NO, badge: "PCT-STAR", clerk: "PYE", action: "SIGN-IN" },
      ],
      inv: { picks: true, badge: false, caseNo: null, card: true, steak: false, duffel: false },
      password: false, bribed: false, bailPaid: false, releaseAt: null, released: false, following: false,
      steakDeployed: false, dogEatUntil: 0, dogBarkCd: 0,
      cageOpen: false, pickProgress: 0,
      posterMemoryUntil: 0, veteranStrikes: 0,
      deckerLoc: "holding", stashLoc: "cage",
      detectorTrippedT: -1e9, prevZ: 99, extractDone: false,
    };
  }
  function statSpent() { return S ? S.paid + S.loanOwed - S.loanGot : 0; }

  // charge meter climbs while the boy talks; freezes on the lawyer card.
  function chargeTalking() { return !!(S && S.deckerLoc === "interrogation" && !S.lawyered && !S.chargesKicked); }

  /* ==========================================================
     4. BUILD — the venue (deterministic; chunky; every prop a job)
     ========================================================== */
  const PAL = {
    wall: 0x8e9484, wain: 0x555f57, floor: 0x5a5e56, ceil: 0x2c3036, trim: 0x2e333a,
    desk: 0x6d5b41, desktop: 0x84765a, cage: 0x7a838e, bars: 0x39424e, steel: 0x525a64,
    navy: 0x24407a, navyD: 0x1b2a44, detBar: 0x525a64, gold: 0xd8b84a, green: 0x2fd06a,
    brick: 0x5c4a41, asphalt: 0x24272c, beater: 0x6b4f3a, dog: 0x5b4632,
  };
  const WALL_H = 5.0, T = 0.6;

  function build(ctx, venue) {
    C = ctx;
    const g = venue.group;
    // Site venues do not claim a generated lot. Reserve the verified precinct
    // footprint now so later wildlife/nature passes cannot grow through it.
    if (venue.anchor && venue.anchor.bounds && CBZ.worldLayout && CBZ.worldLayout.reserve) {
      CBZ.worldLayout.reserve("pkg:precinct13", venue.anchor.bounds, { pad: 3, kind: "venue", source: "games/police" });
    }
    V = { origin: venue.origin, _venue: venue, pending: [], staff: {}, decker: null, lou: null, rex: null,
      roster: null, rosterCanvas: null, rosterTex: null, plate: null, plateCanvas: null, plateTex: null,
      cageGate: null, fireDoor: null,
      flickTubes: [], detLamp: null, coffeeLamp: null };
    const B = (x, y, z, w, h, d, col, ry) => ctx.box(g, x, y, z, w, h, d, ctx.mat(col), ry);
    const wallRun = (x, y, z, w, h, d, col) => { B(x, y, z, w, h, d, col || PAL.wall); ctx.solid(x - w / 2, z - d / 2, x + w / 2, z + d / 2); };
    /* PRECINCT 13 (2026-10-31 rebuild). The shell stays the shell (walls are
       walls), but everything a player handles or reads is now a real object
       in real metres on the merged store fixture kit (city/gunstore.js): a
       walk-through metal detector, a two-level front desk with monitors and
       a sign-in clipboard, the bail window's glass, a lectern with a real
       shield badge, a commercial coffee brewer, a two-door fridge, office
       desks with chairs and monitors, a CHAIN-LINK evidence cage (one alpha
       texture) whose gate swings on its hinge, a duffel with straps and
       handles, round-bar holding cells, a steel fire door with its push bar,
       the interrogation table with its cuff bar, a kennel with a gabled
       doghouse, the bondsman's safe, and a sedan for the getaway. ~10 draw
       calls for everything static. */
    const K = CBZ.storeFixtureKit;
    const k = K ? K.create() : null;
    const chain = chainLinkMat();
    const meshGeos = [];          // chain-link panels, merged into one mesh at the end
    const linkPanel = (x0, z0, x1, z1, y0, y1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), h = y1 - y0;
      const geo = new THREE.PlaneGeometry(len, h);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.6, uv.getY(i) * h / 0.6);
      geo.rotateY(Math.atan2(-(z1 - z0), x1 - x0));
      geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      meshGeos.push(geo);
    };

    // ---- shell: floor slab, perimeter walls (front door gap x[-2,2]), ceiling
    {
      const tile = ctx.canvasTex(256, 256, (cc, w, h) => {
        cc.fillStyle = "#8a8c84"; cc.fillRect(0, 0, w, h);
        const cols = ["#8f9188", "#86887f", "#93958c", "#7f8179"];
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { cc.fillStyle = cols[(i * 3 + j * 5) % 4]; cc.fillRect(i * 64 + 1, j * 64 + 1, 62, 62); }
        cc.fillStyle = "rgba(60,62,58,.18)"; for (let i = 0; i < 4; i++) cc.fillRect(i * 64 + 20, ((i * 37) % 64) + 10, 18, 3);
      }, 16, 16);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(32, 0.2, 32), new THREE.MeshLambertMaterial({ map: tile }));
      slab.position.set(0, 0.02, -5); slab.receiveShadow = true; g.add(slab);
    }
    B(0, WALL_H + 0.15, -5, 32, 0.3, 32, PAL.ceil);         // ceiling (fluoros own the room)
    // front wall (street side, +Z) with the door gap
    wallRun(-9, WALL_H / 2, 10, 14, WALL_H, T);
    wallRun(9, WALL_H / 2, 10, 14, WALL_H, T);
    B(0, WALL_H - 0.6, 10, 4.4, 1.4, T, PAL.wall);          // lintel over the door
    // rear wall (-Z) with the fire-door gap
    wallRun(-9, WALL_H / 2, -20, 14, WALL_H, T);
    wallRun(9, WALL_H / 2, -20, 14, WALL_H, T);
    B(0, WALL_H - 0.6, -20, 4.4, 1.4, T, PAL.wall);
    wallRun(-16, WALL_H / 2, -5, T, WALL_H, 30);            // west wall
    wallRun(16, WALL_H / 2, -5, T, WALL_H, 30);             // east wall
    // one interior spine splitting bullpen/evidence (west) from lobby/interrogation
    wallRun(0, WALL_H / 2, -14, 8, WALL_H, T);              // partial back-of-lobby wall

    if (k) {
      // institutional wainscot + rubber base on the long interior faces
      const wain = (x, z, len, yaw) => {
        k.frame(x, 0, z, yaw);
        k.box(0, 0.6, 0, len, 1.2, 0.02, PAL.wain, "gloss");
        k.box(0, 1.22, 0.005, len, 0.04, 0.03, PAL.trim, "solid");
        k.box(0, 0.06, 0.01, len, 0.12, 0.02, 0x1c1e22);
      };
      wain(-8.9, -19.69, 13.8, 0); wain(8.9, -19.69, 13.8, 0);
      wain(-15.69, -5, 29.4, Math.PI / 2); wain(15.69, -5, 29.4, -Math.PI / 2);
      wain(-9.1, 9.69, 13.6, Math.PI); wain(9.1, 9.69, 13.6, Math.PI);
      // ceiling troffers: 1.2 x 0.6 lay-in fixtures on a grid (the glow is the lens)
      k.frame(0, 0, 0, 0);
      for (let x = -12; x <= 12; x += 4) for (let z = -16; z <= 6; z += 4) {
        if (x <= -6 && x >= -12 && z <= -12) continue;              // the cage has its own tube
        k.box(x, WALL_H - 0.02, z, 1.24, 0.06, 0.64, 0xc8ccd0, "metal");
        k.box(x, WALL_H - 0.055, z, 1.14, 0.01, 0.54, 0xe8f4ee, "glow");
      }
    }

    // ---- METAL DETECTOR arch (the entry contract) at z=+8 -------------------
    if (k) {
      k.frame(0, 0, 8, 0);
      for (const e of [-1, 1]) {
        k.box(e * 1.3, 1.05, 0, 0.14, 2.1, 0.6, 0xb8bcc2, "gloss");                 // the side panels
        k.box(e * 1.23, 1.05, 0, 0.012, 1.9, 0.5, 0x2a2d33, "solid");               // inner sensor faces
        k.box(e * 1.3, 0.04, 0, 0.3, 0.08, 0.7, 0x2a2d33, "metal");                 // feet
        for (let i = 0; i < 6; i++) k.box(e * 1.37, 0.45 + i * 0.25, 0.25, 0.004, 0.08, 0.04, 0x3aff7a, "glow");   // zone LEDs
      }
      k.box(0, 2.2, 0, 2.74, 0.24, 0.62, 0xb8bcc2, "gloss");                        // the header
      k.box(0, 2.2, 0.312, 0.8, 0.12, 0.004, 0x14161a, "gloss");                    // its readout
    }
    V.detLamp = ctx.box(g, 0, 2.36, 8, 0.32, 0.08, 0.12, new THREE.MeshBasicMaterial({ color: PAL.green }));
    ctx.solid(-1.55, 7.7, -1.05, 8.3); ctx.solid(1.05, 7.7, 1.55, 8.3);

    // ---- FRONT DESK — the corrupt sergeant's anchor (never leaves post) -----
    if (k) {
      k.frame(-6, 0, 3.4, 0);                                                        // public side = +z
      const top = K.dressCounter(k, 5.0, 1.4, 1.06, 0, { clad: PAL.desk, trim: 0x8a9098, work: 0x2a2d33, kick: 0x16181c, cladKind: "gloss" });
      k.box(0, top + 0.12, 0.62, 5.2, 0.04, 0.34, 0x84765a, "gloss");                 // the raised transaction ledge
      for (const e of [-1, 1]) k.box(e * 2.55, top + 0.06, 0.62, 0.04, 0.12, 0.3, 0x2a2d33, "metal");
      for (const mx of [-1.4, 0.6]) {                                                  // monitors facing the sergeant
        k.box(mx, top + 0.02, -0.2, 0.22, 0.02, 0.16, 0x1a1c20, "metal");
        k.box(mx, top + 0.24, -0.2, 0.52, 0.32, 0.04, 0x1a1c20, "metal", 0.1, Math.PI, 0);
        k.box(mx, top + 0.24, -0.222, 0.48, 0.28, 0.004, 0x3a5a7a, "glow", 0.1, Math.PI, 0);
      }
      k.box(1.6, top + 0.035, -0.1, 0.22, 0.05, 0.18, 0x1a1c20, "gloss");             // desk phone
      k.box(-0.3, top + 0.15, 0.62, 0.24, 0.006, 0.32, 0xf2eedc);                      // sign-in clipboard
      k.box(-0.3, top + 0.157, 0.5, 0.08, 0.012, 0.03, 0x8a9098, "metal");
      // the BAIL WINDOW (legal release): counter under a glass screen
      k.frame(8.2, 0, 3.4, 0);
      const t2 = K.dressCounter(k, 3.0, 0.8, 0.9, 0, { clad: PAL.desk, trim: 0x8a9098, work: 0x84765a, kick: 0x16181c });
      k.box(0, t2 + 0.6, 0.0, 3.0, 1.2, 0.02, 0, "glass");
      k.box(0, t2 + 1.22, 0.0, 3.1, 0.06, 0.08, PAL.trim, "metal");
      for (const e of [-1, 0, 1]) k.box(e * 1.5, t2 + 0.6, 0.0, 0.05, 1.24, 0.08, PAL.trim, "metal");
      k.box(0, t2 + 0.03, 0.05, 0.4, 0.04, 0.3, 0x8a9098, "metal");                    // the deal tray
      k.box(0, 3.2, 0, 3.4, 0.5, 0.5, PAL.steel, "metal");                             // window frame top
      // VISITOR PODIUM: a lectern with the visitor log
      k.frame(12, 0, 6, 0);
      k.box(0, 0.04, 0, 0.7, 0.08, 0.6, 0x16181c);
      k.box(0, 0.62, 0, 0.56, 1.1, 0.42, PAL.desk, "gloss");
      k.box(0, 1.2, 0.04, 0.72, 0.04, 0.56, 0x84765a, "gloss", 0.2);
      k.box(-0.12, 1.23, 0.04, 0.32, 0.012, 0.24, 0xf2eedc, "solid", 0.2);
    }
    ctx.solid(-8.5, 2.6, -3.5, 4.2);
    signPanel(ctx, g, -6, 2.9, 4.25, 3.4, 0.7, "#0c1118", "#e8b23a", ["FRONT DESK", "ALL VISITORS SIGN IN"], 28);
    ctx.solid(6.6, 2.95, 9.8, 3.85);
    signPanel(ctx, g, 8.2, 2.5, 3.9, 2.6, 0.6, "#101722", "#9fd0ff", ["BAIL / BOND WINDOW"], 26);
    ctx.solid(11.35, 5.55, 12.65, 6.45);
    // the escort BADGE: a gold seven-point shield on the lectern
    V.badgeMesh = badgeModel();
    V.badgeMesh.position.set(12.18, 1.245, 6.05); V.badgeMesh.rotation.x = -Math.PI / 2 + 0.2; g.add(V.badgeMesh);

    // ---- WANTED BOARD (your own poster; Brisco studies it) ------------------
    signPanel(ctx, g, 15.6, 2.4, 0, 0.5, 2.6, "#12161d", "#c8402f", ["WANTED"], 34, Math.PI / 2, 2.6);

    // ---- BULLPEN (west): coffee machine + break fridge + Reyes' case file ----
    if (k) {
      k.frame(-14.6, 0, -2, Math.PI / 2);                                             // faces +x
      K.dressCounter(k, 2.2, 1.0, 0.9, 0, { clad: 0x5a5e66, trim: 0x8a9098, work: 0x2a2d33, kick: 0x16181c });
      // the commercial brewer: body, hood, two glass decanters on warmers
      k.box(0.3, 1.32, -0.15, 0.5, 0.82, 0.42, 0x22262c, "gloss");
      k.box(0.3, 1.66, 0.12, 0.5, 0.12, 0.22, 0x22262c, "gloss");
      for (const e of [-0.12, 0.12]) {
        k.cyl(0.3 + e, 0.952, 0.12, 0.08, 0.08, 0.012, 0x1a1c20, "metal", 0, 0, 0, 16);
        k.cyl(0.3 + e, 1.04, 0.12, 0.06, 0.075, 0.16, 0, "glass", 0, 0, 0, 14);
        k.cyl(0.3 + e, 1.0, 0.12, 0.068, 0.072, 0.08, 0x3a1e0e, "gloss", 0, 0, 0, 14);
        k.box(0.3 + e, 1.13, 0.12, 0.13, 0.03, 0.13, 0xd8a832, "solid");
      }
      for (let i = 0; i < 4; i++) k.cyl(-0.6 + i * 0.1, 0.95, 0.2, 0.04, 0.035, 0.1, 0xe8e4d8, "solid", 0, 0, 0, 10);   // the mugs
      // break FRIDGE (the steak): two-door upright, handles
      k.frame(-14.6, 0, -5.2, Math.PI / 2);
      k.box(0, 1.05, 0, 1.1, 2.1, 0.7, 0xd8dade, "gloss");
      k.box(0, 1.5, 0.352, 1.08, 0.006, 0.004, 0x8a9098);
      k.box(0, 1.05, 0.352, 0.006, 2.06, 0.004, 0x8a9098);
      for (const e of [-1, 1]) k.box(e * 0.06, 1.2, 0.38, 0.03, 0.6, 0.04, 0xa8acb2, "metal");
      k.box(0, 0.04, 0.3, 1.0, 0.08, 0.08, 0x1c1e22);
    }
    V.coffeeLamp = ctx.box(g, -14.25, 1.5, -1.7, 0.03, 0.03, 0.03, new THREE.MeshBasicMaterial({ color: 0xd23b2a }));
    ctx.solid(-15.25, -3.1, -13.95, -0.9); ctx.solid(-15.2, -5.8, -14, -4.6);
    // Reyes' desk + the case FILE tray (the case number lives here)
    deskCluster(ctx, g, k, -10, -6, 0);
    if (k) {
      k.frame(-10.6, 0, -6.4, 0);
      k.box(0, 0.79, 0, 0.36, 0.04, 0.28, 0x2a2d33, "metal");                          // the tray
      for (let i = 0; i < 4; i++) k.box(0.01 * i, 0.815 + i * 0.012, 0.005 * i, 0.32, 0.01, 0.24, [0xd8b870, 0xe8d8a0, 0xd8b870, 0xc8a860][i], "solid", 0, 0.06 * i, 0);
    }
    // ---- DUTY ROSTER board (redraws per shift phase) on the west wall ------
    // A LIVE BOARD IS A SLAB, NOT PAINT: bezel 0.025 off the wall, the roster
    // face 0.025 proud of the bezel, so no two faces share a depth.
    V.roster = ctx.canvasTexLive(512, 320);       // 1.600 == the 2.4 x 1.5 mesh
    V.rosterCanvas = V.roster.canvas; V.rosterTex = V.roster.tex;
    ctx.box(g, -15.65, 2.6, -8, 0.05, 1.72, 2.62, ctx.mat(PAL.trim));           // bezel
    { const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ map: V.rosterTex }));
      m.position.set(-15.60, 2.6, -8); m.rotation.y = Math.PI / 2;
      m.castShadow = false; m.receiveShadow = false; g.add(m); }
    drawRoster(0);

    // ---- EVIDENCE CAGE (north-west): chain-link walls + gate + clerk + plate --
    cageWall(ctx, k, linkPanel, -11, -18, 8, 0.34);    // north
    cageWall(ctx, k, linkPanel, -11, -12, 8, 0.34);    // south
    cageWall(ctx, k, linkPanel, -15, -15, 0.34, 6);    // west
    cageWall(ctx, k, linkPanel, -7, -16.3, 0.34, 3.4); // east upper (gate gap around z -14.5..-13)
    // the cage GATE (dynamic — swings open on its hinge at z -14 on a solved lock)
    {
      const gate = new THREE.Group(); gate.position.set(-7, 0, -14); g.add(gate);
      const fr = ctx.pmat(0x7a838e, 40);
      ctx.box(gate, 0, 3.4, 1.0, 0.06, 0.06, 2.0, fr); ctx.box(gate, 0, 0.12, 1.0, 0.06, 0.06, 2.0, fr);
      ctx.box(gate, 0, 1.76, 0.03, 0.06, 3.3, 0.06, fr); ctx.box(gate, 0, 1.76, 1.97, 0.06, 3.3, 0.06, fr);
      ctx.box(gate, 0, 1.76, 1.0, 0.04, 0.04, 1.9, fr);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 3.22), chain); pl.rotation.y = Math.PI / 2; pl.position.set(0, 1.76, 1.0);
      const uv = pl.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.94 / 0.6, uv.getY(i) * 3.22 / 0.6);
      gate.add(pl);
      ctx.box(gate, 0.06, 1.15, 1.85, 0.08, 0.2, 0.08, ctx.pmat(0x2a2d33, 30));      // the padlock hasp
      V.cageGate = gate;
    }
    V.cageGateCol = ctx.solid(-7.17, -14, -6.83, -12);
    // the STASH duffel on a shelf inside
    if (k) {
      k.frame(-11, 0, -15, 0);
      k.box(0, 0.66, 0, 1.2, 0.04, 0.6, 0x6a6e76, "metal");                           // the shelf it sits on
      for (const e of [-1, 1]) for (const f of [-1, 1]) k.box(e * 0.58, 0.33, f * 0.28, 0.04, 0.66, 0.04, 0x5a5e66, "metal");
    }
    V.duffel = duffelModel();
    V.duffel.position.set(-11, 0.68, -15); g.add(V.duffel);
    // clerk desk facing the gate + the NAMEPLATE (swaps PYE/MERCER — READ IT)
    if (k) {
      k.frame(-5.4, 0, -13, -Math.PI / 2);                                             // faces -x (the gate)
      K.dressCounter(k, 2.2, 1.2, 1.06, 0, { clad: PAL.desk, trim: 0x8a9098, work: 0x84765a, kick: 0x16181c, cladKind: "gloss" });
      k.box(0.6, 1.16, -0.3, 0.32, 0.18, 0.26, 0x1a1c20, "gloss");                     // a label printer
      k.box(-0.5, 1.12, -0.2, 0.3, 0.08, 0.22, 0x5a5e66, "metal");                     // evidence bags tray
    }
    ctx.solid(-6.15, -14.1, -4.65, -11.9);
    // The nameplate is the tell you have to READ, so it stands on an easel.
    V.plate = ctx.canvasTexLive(512, 160);        // 3.20 == the 1.4 x 0.44 mesh
    V.plateCanvas = V.plate.canvas; V.plateTex = V.plate.tex;
    for (const px of [-0.55, 0.55]) ctx.box(g, -5.4 + px, 1.30, -12.0, 0.03, 0.42, 0.03, ctx.mat(PAL.steel));
    { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.44), new THREE.MeshBasicMaterial({ map: V.plateTex, transparent: true }));
      m.position.set(-5.4, 1.72, -12.0); m.castShadow = false; m.receiveShadow = false; g.add(m); }
    drawPlate("PYE");
    // the flickering fluorescent over the gate (the stealth mechanic light):
    // a strip housing with two tubes whose materials flicker
    ctx.box(g, -9, 4.96, -14, 2.4, 0.08, 0.5, ctx.pmat(0xc8ccd0, 20));
    for (let q = -1; q <= 1; q += 2) {
      const tube = ctx.cyl(g, -9, 4.88, -14 + q * 0.12, 0.025, 0.025, 2.2, new THREE.MeshBasicMaterial({ color: 0x93a695 }), 8);
      tube.rotation.z = Math.PI / 2;
      V.flickTubes.push(tube.material);
    }

    // ---- INTERROGATION (north-east): viewing window + doc tray + the BOY -----
    if (k) {
      k.frame(11, 0, -15, 0);
      k.box(0, 0.76, 0, 1.6, 0.04, 0.9, 0x8a9098, "metal");                             // the steel table
      for (const e of [-1, 1]) for (const f of [-1, 1]) k.box(e * 0.74, 0.38, f * 0.4, 0.05, 0.76, 0.05, 0x5a5e66, "metal");
      k.cyl(0, 0.82, 0, 0.012, 0.012, 0.5, 0xb0b6c0, "metal", 0, 0, Math.PI / 2, 8);    // the cuff bar
      for (const e of [-0.25, 0.25]) k.box(e, 0.8, 0, 0.02, 0.06, 0.02, 0xb0b6c0, "metal");
      for (const f of [-1, 1]) {                                                         // two chairs
        k.box(0, 0.45, f * 0.75, 0.44, 0.04, 0.42, 0x3a3e46, "metal");
        k.box(0, 0.7, f * 0.96, 0.44, 0.46, 0.03, 0x3a3e46, "metal");
        for (const e of [-1, 1]) for (const h2 of [-1, 1]) k.box(e * 0.2, 0.22, f * 0.75 + h2 * 0.19, 0.025, 0.45, 0.025, 0x5a5e66, "metal");
      }
      // the pass-through tray in the viewing window sill
      k.frame(6, 0, -12.4, 0);
      k.box(0, 1.12, 0, 0.6, 0.06, 0.9, 0x5a5e66, "metal");
      k.box(0, 1.16, 0, 0.5, 0.02, 0.8, 0x8a9098, "metal");
    }
    ctx.solid(9.7, -15.7, 12.3, -14.3);
    B(6, 0.55, -14, 0.5, 1.1, 6, PAL.wall); ctx.solid(5.75, -17, 6.25, -11);         // sill (solid below)
    B(6, 4.15, -14, 0.5, 2.0, 6, PAL.wall);                                          // head (solid above)
    { const glass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.0, 5.4),
        new THREE.MeshPhongMaterial({ color: 0x7a8a94, specular: 0xffffff, transparent: true, opacity: 0.32, shininess: 120, depthWrite: false }));
      glass.position.set(6, 2.1, -14); glass.renderOrder = 1; g.add(glass); }                    // the one-way glass
    V.docTray = new THREE.Object3D(); V.docTray.position.set(6, 1.16, -12.4); g.add(V.docTray);

    // ---- HOLDING bars (where the boy starts; the LOSE arc's cell) -----------
    barRun(ctx, k, 12, -4, 12, -8);     // cell A bars along x=12
    signPanel(ctx, g, 12.4, 3.3, -6, 0.4, 0.9, "#0c0f14", "#8a929c", ["HOLDING"], 22, Math.PI / 2);

    // ---- REAR FIRE DOOR (opens from inside; the stash route out) ------------
    {
      const door = new THREE.Group(); door.position.set(1.4, 0, -20); g.add(door);
      const st = ctx.pmat(0x6a4a3a, 25), fr = ctx.pmat(0x3a3e46, 30), hw = ctx.pmat(0xb0b6c0, 70);
      ctx.box(door, 0, 1.06, 0, 1.0, 2.1, 0.05, st); ctx.box(door, 1.02, 1.06, 0, 1.0, 2.1, 0.05, st);   // a pair of leaves
      ctx.box(door, 0.51, 2.16, 0, 2.14, 0.1, 0.24, fr);                                                  // header
      for (const e of [-0.56, 1.58]) ctx.box(door, e, 1.08, 0, 0.1, 2.16, 0.24, fr);                    // jambs
      ctx.box(door, 0.5, 1.0, 0.06, 1.8, 0.05, 0.05, hw);                                                 // the push bar
      ctx.box(door, 0.51, 1.75, 0.035, 0.3, 0.12, 0.01, new THREE.MeshBasicMaterial({ color: 0xd22a2a })); // EXIT ONLY plate
      V.fireDoor = door;
    }
    V.fireDoorCol = ctx.solid(0.2, -20.2, 2.6, -19.8);

    // ---- K-9 KENNEL (rear alley, past the fire door) — the toll booth -------
    penFence(ctx, k, linkPanel, 0, -25.5, 5.6, 0.34);   // outer
    penFence(ctx, k, linkPanel, -2.6, -23.6, 0.34, 4);
    penFence(ctx, k, linkPanel, 2.6, -23.6, 0.34, 4);
    if (k) {                                                                              // the doghouse: plank walls, gabled shingle roof
      k.frame(1.4, 0, -25.9, 0);
      k.box(0, 0.05, 0, 1.4, 0.1, 1.3, 0x3a2a1c);
      k.box(0, 0.5, -0.6, 1.3, 0.8, 0.06, 0x7a5a3a); k.box(-0.62, 0.5, 0, 0.06, 0.8, 1.2, 0x7a5a3a); k.box(0.62, 0.5, 0, 0.06, 0.8, 1.2, 0x7a5a3a);
      for (const e of [-1, 1]) k.box(e * 0.42, 0.5, 0.6, 0.46, 0.8, 0.06, 0x7a5a3a);   // front either side of the door
      k.box(0, 0.86, 0.6, 0.4, 0.08, 0.06, 0x7a5a3a);
      for (const e of [-1, 1]) k.box(e * 0.36, 1.13, 0, 0.82, 0.05, 1.42, 0x3a2e2a, "solid", 0, 0, -e * 0.62);   // roof planes
      k.cyl(0, 1.38, 0, 0.03, 0.03, 1.44, 0x2a2420, "solid", Math.PI / 2, 0, 0, 6);    // ridge
      k.cyl(-0.8, 0.05, -0.8, 0.14, 0.12, 0.08, 0x8a9098, "metal", 0, 0, 0, 14);       // the water bowl
    }
    buildRex(ctx, g, 0, -24);

    // ---- BONDSMAN booth (outside the front, east) — both money paths start --
    if (k) {
      k.frame(18.5, 0, 6, Math.PI);                                                    // Lou sits +z, customers -z
      K.dressCounter(k, 2.6, 1.2, 1.06, 0, { clad: 0x4a2e1c, trim: 0xc9a24a, work: 0x2a1c12, kick: 0x16120c, cladKind: "gloss" });
      // his SAFE: a real two-tonne box, dial, three-spoke handle, hinges
      k.frame(20.5, 0, 4.2, 0);
      k.box(0, 0.8, 0, 1.2, 1.5, 1.2, 0x2a3038, "gloss");
      k.box(0, 0.8, 0.605, 0.96, 1.26, 0.02, 0x343c46, "gloss");
      k.cyl(0.1, 1.0, 0.63, 0.09, 0.09, 0.04, 0xb0b6c0, "metal", Math.PI / 2, 0, 0, 20);
      k.cyl(0.1, 1.0, 0.655, 0.03, 0.03, 0.02, 0x2a2d33, "metal", Math.PI / 2, 0, 0, 12);
      for (let i = 0; i < 3; i++) k.cyl(0.1 + Math.cos(i * 2.09) * 0.07, 0.68 + Math.sin(i * 2.09) * 0.07, 0.65, 0.008, 0.008, 0.14, 0xb0b6c0, "metal", Math.PI / 2, 0, 0, 6);
      for (const y of [0.4, 1.2]) k.cyl(-0.47, y, 0.62, 0.025, 0.025, 0.14, 0x8a9098, "metal", 0, 0, 0, 8);
      k.box(0, 0.03, 0, 1.24, 0.06, 1.24, 0x14161a);
    }
    ctx.solid(17.2, 5.3, 19.8, 6.7);
    ctx.solid(19.85, 3.55, 21.15, 4.85);   // safe
    signPanel(ctx, g, 18.5, 2.7, 6.9, 3, 0.7, "#1a0f18", "#e8b23a", ["LOU'S BONDS", "OPEN ALL NIGHT"], 24);

    // ---- EXTRACTION beater at the curb (WIN/PARTIAL reads here) -------------
    if (k) beaterCar(k, 10, 14);
    for (const z of [13.62, 14.38]) {
      const hl = ctx.box(g, 7.83, 0.68, z, 0.02, 0.12, 0.26, new THREE.MeshBasicMaterial({ color: 0xffe9b0 })); // headlight ON
      void hl;
    }
    V.extract = { x: 10, z: 14, r: 3.6 };

    if (k) k.build(g);
    if (meshGeos.length && THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries) {
      const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(meshGeos, false);
      meshGeos.forEach((gg) => gg.dispose());
      const m = new THREE.Mesh(merged, chain); m.name = "chainlink"; g.add(m);
    } else meshGeos.forEach((gg) => g.add(new THREE.Mesh(gg, chain)));

    // ---- LIGHTS (budget ≤8): fluoro pools; the flickering cage tube last ----
    ctx.light(0, 4.4, 4, 0xdff0e2, 0.9, 20);      // lobby
    ctx.light(-12, 4.4, -4, 0xdff0e2, 0.8, 18);   // bullpen
    V.cageLight = ctx.light(-9, 4.2, -14, 0xdff0e2, 0.9, 16); // EVIDENCE (flickers)
    ctx.light(11, 4.2, -14, 0xf2ead2, 0.7, 14);   // interrogation (warm hot-seat)
    ctx.light(12, 4.4, -6, 0x9fb8d0, 0.5, 14);    // holding
    ctx.light(6, 5.4, 12, 0xffb35c, 0.8, 22);     // street sodium over the beater

    // ---- CAST (deferred: real peds land after the site anchor is live) ------
    queueStaff();

    // ---- ZONES: every interaction is an [E] zone (WHY rule) -----------------
    buildZones(ctx);
  }

  /* ---- geometry helpers (real metres, merged through the fixture kit) ---- */
  let _chain = null;
  function chainLinkMat() {
    if (_chain) return _chain;
    const tex = C.canvasTex(64, 64, (cc, w, h) => {
      cc.clearRect(0, 0, w, h);
      cc.strokeStyle = "#aeb4ba"; cc.lineWidth = 3;
      cc.beginPath(); cc.moveTo(0, h / 2); cc.lineTo(w / 2, 0); cc.lineTo(w, h / 2); cc.lineTo(w / 2, h); cc.closePath(); cc.stroke();
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    _chain = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    return _chain;
  }
  function badgeModel() {
    // a seven-point star shield, 6 cm, gold with an enamel centre
    const s = new THREE.Shape();
    for (let i = 0; i < 14; i++) {
      const a = Math.PI / 2 + (i / 14) * Math.PI * 2, r = i % 2 ? 0.018 : 0.034;
      if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1 });
    const m = new THREE.Mesh(geo, C.pmat(PAL.gold, 90));
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.002, 16), C.mat(0x1f3a6a));
    c.rotation.x = Math.PI / 2; c.position.z = 0.0055; m.add(c);
    return m;
  }
  function duffelModel() {
    // a 70 cm sports holdall: tube body, end caps, two carry handles, a zip
    const grp = new THREE.Group();
    const body = C.mat(0x1f6f6a), dark = C.mat(0x14302e), webbing = C.mat(0x1a1c20);
    const b = C.cyl(grp, 0, 0.16, 0, 0.16, 0.16, 0.68, body, 14); b.rotation.z = Math.PI / 2; b.scale.set(1, 1, 0.92);
    for (const e of [-1, 1]) { const cap = C.cyl(grp, e * 0.345, 0.16, 0, 0.162, 0.162, 0.02, dark, 14); cap.rotation.z = Math.PI / 2; }
    C.box(grp, 0, 0.318, 0, 0.6, 0.006, 0.02, webbing);                                   // the zip
    for (const e of [-1, 1]) {
      C.box(grp, e * 0.14, 0.16, 0.0, 0.035, 0.33, 0.33, webbing);                      // webbing bands
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 12, Math.PI), webbing);
      h.position.set(e * 0.14, 0.32, e * 0.03); h.rotation.y = Math.PI / 2; grp.add(h);
    }
    return grp;
  }
  function deskCluster(ctx, g, k, x, z, ry) {
    if (k) {
      k.frame(x, 0, z, ry);
      k.box(0, 0.74, 0, 1.6, 0.03, 0.8, PAL.desktop, "gloss");                          // the top
      k.box(0.52, 0.36, 0, 0.42, 0.7, 0.74, PAL.desk, "gloss");                          // drawer pedestal
      for (let i = 0; i < 3; i++) { k.box(0.52, 0.15 + i * 0.22, 0.375, 0.38, 0.19, 0.01, 0x7a6849, "gloss"); k.box(0.52, 0.2 + i * 0.22, 0.385, 0.12, 0.015, 0.012, 0x8a9098, "metal"); }
      k.box(-0.76, 0.36, 0, 0.03, 0.72, 0.74, PAL.desk, "gloss");
      k.box(-0.1, 0.4, -0.38, 1.2, 0.6, 0.02, PAL.desk, "gloss");                        // modesty panel
      k.box(-0.2, 0.765, -0.2, 0.22, 0.02, 0.16, 0x1a1c20, "metal");                     // monitor
      k.box(-0.2, 0.98, -0.22, 0.56, 0.34, 0.04, 0x1a1c20, "metal");
      k.box(-0.2, 0.98, -0.198, 0.52, 0.3, 0.004, 0x3a5a7a, "glow");
      k.box(-0.2, 0.765, 0.12, 0.44, 0.02, 0.15, 0x2a2d33, "solid");                     // keyboard
      // the office chair: five-star base, gas lift, seat, back
      for (let i = 0; i < 5; i++) { const a = i * 1.2566; k.box(Math.sin(a) * 0.17, 0.06, 0.75 + Math.cos(a) * 0.17, 0.05, 0.03, 0.34, 0x1a1c20, "metal", 0, a, 0); }
      k.cyl(0, 0.25, 0.75, 0.025, 0.025, 0.4, 0x8a9098, "metal", 0, 0, 0, 8);
      k.box(0, 0.47, 0.75, 0.5, 0.08, 0.48, 0x2a3a4c, "gloss");
      k.box(0, 0.8, 0.98, 0.46, 0.52, 0.06, 0x2a3a4c, "gloss", 0.12);
    }
    ctx.solid(x - 1.45, z - 0.85, x + 1.45, z + 0.85);
  }
  function cageWall(ctx, k, linkPanel, x, z, w, d) {
    const along = w > d, len = Math.max(w || 0, d || 0);
    const x0 = along ? x - len / 2 : x, x1 = along ? x + len / 2 : x;
    const z0 = along ? z : z - len / 2, z1 = along ? z : z + len / 2;
    linkPanel(x0, z0, x1, z1, 0.12, 3.4);
    if (k) {
      k.frame(x, 0, z, along ? 0 : Math.PI / 2);
      k.cyl(0, 3.45, 0, 0.022, 0.022, len, 0x7a838e, "metal", 0, 0, Math.PI / 2, 8);   // top rail
      k.cyl(0, 0.1, 0, 0.022, 0.022, len, 0x7a838e, "metal", 0, 0, Math.PI / 2, 8);    // bottom rail
      const n = Math.max(1, Math.round(len / 1.5));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + i * len / n;
        k.cyl(t, 1.75, 0, 0.03, 0.03, 3.5, 0x6a737e, "metal", 0, 0, 0, 8);             // posts
        k.cyl(t, 0.02, 0, 0.06, 0.06, 0.04, 0x5a5e66, "metal", 0, 0, 0, 8);
      }
    }
    ctx.solid(x - (w || 0.34) / 2, z - (d || 0.34) / 2, x + (w || 0.34) / 2, z + (d || 0.34) / 2);
  }
  function barRun(ctx, k, x, z0, x1, z1) {
    const cz = (z0 + z1) / 2, len = Math.abs(z1 - z0);
    if (k) {
      k.frame(x, 0, cz, Math.PI / 2);
      k.box(0, 0.08, 0, len, 0.1, 0.08, PAL.bars, "metal");                             // floor channel
      for (const y of [1.1, 2.4]) k.box(0, y, 0, len, 0.06, 0.012, PAL.bars, "metal");  // flat cross-straps
      k.box(0, 3.5, 0, len, 0.12, 0.12, PAL.bars, "metal");                             // head channel
      const n = Math.max(2, Math.round(len / 0.13));
      for (let i = 0; i <= n; i++) k.cyl(-len / 2 + i * len / n, 1.8, 0, 0.018, 0.018, 3.4, 0x4a525e, "metal", 0, 0, 0, 8);
    }
    ctx.solid(x - 0.2, Math.min(z0, z1), x + 0.2, Math.max(z0, z1));
  }
  function penFence(ctx, k, linkPanel, x, z, w, d) {
    const along = w > d, len = Math.max(w, d);
    const x0 = along ? x - len / 2 : x, x1 = along ? x + len / 2 : x;
    const z0 = along ? z : z - len / 2, z1 = along ? z : z + len / 2;
    linkPanel(x0, z0, x1, z1, 0.05, 1.5);
    if (k) {
      k.frame(x, 0, z, along ? 0 : Math.PI / 2);
      k.cyl(0, 1.52, 0, 0.02, 0.02, len, 0x8a9098, "metal", 0, 0, Math.PI / 2, 8);
      const n = Math.max(1, Math.round(len / 1.4));
      for (let i = 0; i <= n; i++) k.cyl(-len / 2 + i * len / n, 0.78, 0, 0.025, 0.025, 1.56, 0x7a838e, "metal", 0, 0, 0, 8);
    }
    ctx.solid(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
  }
  // the getaway: a tired mid-size sedan facing -x (nose at x - 2.1), 4.2 m long
  function beaterCar(k, x, z) {
    k.frame(x, 0, z, -Math.PI / 2);                                                       // local +Z = the nose (-x)
    const P = PAL.beater, Pd = 0x4a3626, gl = 0x26303a, ch = 0x9aa0a6;
    k.box(0, 0.55, 0, 1.78, 0.5, 4.2, P, "gloss");                                        // lower body
    k.box(0, 0.86, 1.45, 1.74, 0.14, 1.2, P, "gloss", -0.05);                             // hood
    k.box(0, 0.86, -1.6, 1.74, 0.14, 0.9, P, "gloss", 0.06);                              // trunk lid
    k.box(0, 1.1, -0.1, 1.6, 0.45, 2.0, Pd, "gloss");                                     // cabin
    k.box(0, 1.1, 0.92, 1.5, 0.42, 0.02, gl, "gloss", -0.75);                             // windscreen
    k.box(0, 1.1, -1.12, 1.5, 0.4, 0.02, gl, "gloss", 0.8);                               // rear screen
    for (const e of [-1, 1]) {
      k.box(e * 0.805, 1.12, -0.1, 0.012, 0.36, 1.86, gl, "gloss");                       // side glass
      k.box(e * 0.8, 1.12, -0.1, 0.03, 0.4, 0.06, Pd, "gloss");                           // B pillar
      k.box(e * 0.895, 0.62, 0.1, 0.012, 0.03, 3.6, 0x2a221a);                            // body crease
      k.box(e * 0.9, 0.78, 0.55, 0.04, 0.025, 0.14, 0x1a1c20, "metal");                   // door handles
      k.box(e * 0.9, 0.78, -0.55, 0.04, 0.025, 0.14, 0x1a1c20, "metal");
      for (const f of [-1, 1]) {
        k.cyl(e * 0.78, 0.33, f * 1.3, 0.33, 0.33, 0.22, 0x141414, "solid", 0, 0, Math.PI / 2, 18);   // tyre
        k.cyl(e * 0.895, 0.33, f * 1.3, 0.19, 0.19, 0.02, ch, "metal", 0, 0, Math.PI / 2, 14);        // hubcap
      }
    }
    k.box(0, 0.42, 2.12, 1.82, 0.16, 0.1, ch, "metal");                                   // bumpers
    k.box(0, 0.42, -2.12, 1.82, 0.16, 0.1, ch, "metal");
    k.box(0, 0.64, 2.11, 0.8, 0.14, 0.02, 0x1a1c20);                                      // grille
    for (const e of [-1, 1]) k.box(e * 0.66, 0.66, -2.11, 0.28, 0.1, 0.02, 0xb02020, "glow");   // tail lamps
  }
  // REX — a chunky voxel quadruped (a PROP with a mechanic: the smell check),
  // animated via ctx.anim. Built from ctx.box so the package stays self-contained.
  function buildRex(ctx, g, x, z) {
    // THE ONE DOG BODY (city/dogmodel.js): a shepherd in the kennel, lying
    // watchful; on the steak it is up, nose down, tail going.
    if (CBZ.dogModel) {
      const rig = CBZ.dogModel.build("shepherd", 13);
      rig.group.position.set(x, 0, z);
      rig.group.rotation.y = -Math.PI / 2;            // nose toward the alley gate (+z)
      g.add(rig.group);
      CBZ.dogModel.collar(rig, 0x1b1a19);
      V.rex = { group: rig.group, tail: null, base: rig.group.rotation.y, rig: rig };
      const ctl = { x: x, z: z, y: 0, heading: Math.PI / 2, posture: "lie", alert: 0.5, aggr: 0, fear: 0, happy: 0, sniff: 0, lookYaw: 0, lookPitch: 0 };
      ctx.anim(function (dt, tt) {
        const eating = S && S.t < S.dogEatUntil;
        ctl.posture = eating ? "stand" : "lie";
        ctl.sniff = eating ? 1 : 0; ctl.happy = eating ? 0.8 : 0; ctl.alert = eating ? 0 : 0.5;
        ctl.lookYaw = eating ? 0 : Math.sin(tt * 0.35) * 0.5;
        CBZ.dogModel.animate(rig, dt || 0.016, ctl);
      });
      return;
    }
    const body = new THREE.Group(); body.position.set(x, 0, z); g.add(body);
    const m = ctx.mat(PAL.dog), mD = ctx.mat(0x3a2c1e);
    ctx.box(body, 0, 0.7, 0, 1.3, 0.6, 0.6, m);        // torso
    ctx.box(body, 0.75, 0.85, 0, 0.6, 0.55, 0.55, m);  // head/neck
    ctx.box(body, 1.05, 0.9, 0, 0.4, 0.4, 0.45, m);    // snout
    ctx.box(body, 0.95, 1.18, 0.18, 0.16, 0.24, 0.12, mD); // ear
    ctx.box(body, 0.95, 1.18, -0.18, 0.16, 0.24, 0.12, mD);
    for (const lx of [-0.5, 0.5]) for (const lz of [-0.22, 0.22]) ctx.box(body, lx, 0.28, lz, 0.22, 0.56, 0.22, mD); // legs
    const tail = ctx.box(body, -0.75, 0.85, 0, 0.5, 0.16, 0.16, m);
    V.rex = { group: body, tail: tail, base: 0 };
    ctx.anim(function (dt, tt) {
      const eating = S && S.t < S.dogEatUntil;
      body.rotation.y = V.rex.base + (eating ? Math.sin(tt * 6) * 0.12 : Math.sin(tt * 1.1) * 0.05);
      if (tail) tail.rotation.y = Math.sin(tt * (eating ? 9 : 3)) * 0.5;
    });
  }
  function signPanel(ctx, g, x, y, z, w, h, bg, fg, lines, size, ry, hh) {
    const tex = ctx.canvasTex(256, 128, (cc, cw, ch) => {
      cc.fillStyle = bg; cc.fillRect(0, 0, cw, ch);
      cc.fillStyle = fg; cc.textAlign = "center"; cc.textBaseline = "middle";
      cc.font = "bold " + (size || 30) + "px Arial";
      const lh = (size || 30) * 1.2, y0 = ch / 2 - (lines.length - 1) * lh / 2;
      lines.forEach((L, i) => cc.fillText(L, cw / 2, y0 + i * lh));
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(hh ? h : w, hh ? w : h), new THREE.MeshBasicMaterial({ map: tex }));
    mesh.position.set(x, y, z); if (ry) mesh.rotation.y = ry; g.add(mesh);
    return mesh;
  }

  // The heist is READ off this board — who is at the cage, who is away at
  // coffee — so at 512x320 it gets the layout that read demands: a header band
  // carrying the shift clock, then one striped row per post with the post on
  // the left and the name (green = manned, red = a hole you can walk through)
  // on the right. Event-driven: the update loop redraws it on a shift phase
  // change, never per frame.
  function drawRoster(t) {
    if (!V || !V.rosterCanvas) return;
    const r = rosterAt(t, S && S.lawyered);
    const cc = V.roster ? V.roster.cc : V.rosterCanvas.getContext("2d");
    const w = V.rosterCanvas.width, h = V.rosterCanvas.height;
    cc.textBaseline = "alphabetic";
    cc.fillStyle = "#0c1118"; cc.fillRect(0, 0, w, h);
    cc.fillStyle = "#141c27"; cc.fillRect(0, 0, w, 74);                        // header band
    cc.fillStyle = "#e8b23a"; cc.fillRect(0, 74, w, 3);
    cc.strokeStyle = "#e8b23a"; cc.lineWidth = 4; cc.strokeRect(6, 6, w - 12, h - 12);
    cc.fillStyle = "#e8b23a"; cc.font = "bold 34px Arial"; cc.textAlign = "left";
    cc.fillText("DUTY ROSTER", 24, 46);
    cc.font = "bold 19px Arial"; cc.fillStyle = "#9fb2c4"; cc.textAlign = "right";
    cc.fillText("SHIFT CHANGE " + fmtT(SHIFT_LEN - t), w - 24, 46);
    const rows = [["CAGE", r.cage, "AT COFFEE"], ["FRONT DESK", r.frontDesk], ["BAIL", r.bail, "WINDOW SHUT"],
      ["BULLPEN", r.bullpenDesk, "OUT"], ["INTERROGATION", r.interrogation, "EMPTY"], ["LOBBY", r.lobby], ["K-9", r.k9]];
    const top = 92, rh = 31;
    rows.forEach((row, i) => {
      const y = top + i * rh;
      if (i % 2 === 0) { cc.fillStyle = "rgba(255,255,255,.035)"; cc.fillRect(14, y - 20, w - 28, rh - 4); }
      cc.textAlign = "left"; cc.fillStyle = "#8fa0b2"; cc.font = "bold 17px Arial";
      cc.fillText(row[0], 26, y);
      cc.textAlign = "right"; cc.fillStyle = row[1] ? "#7fe8a8" : "#e88a7a"; cc.font = "20px Arial";
      cc.fillText(row[1] || row[2] || "", w - 26, y, w * 0.55);
    });
    if (V.roster) V.roster.paint(); else if (V.rosterTex) V.rosterTex.needsUpdate = true;
  }
  // nameplate at the cage — the tell: PYE (rookie, escort badge OK) vs
  // SGT. MERCER (veteran, real star only). READ IT before you sign out.
  function drawPlate(clerk) {
    if (!V || !V.plateCanvas) return;
    const cc = V.plate ? V.plate.cc : V.plateCanvas.getContext("2d");
    const w = V.plateCanvas.width, h = V.plateCanvas.height;
    cc.clearRect(0, 0, w, h); cc.fillStyle = "#12161d"; cc.fillRect(0, 0, w, h);
    cc.strokeStyle = "#84765a"; cc.lineWidth = 8; cc.strokeRect(6, 6, w - 12, h - 12);
    cc.fillStyle = "rgba(232,178,58,.55)"; cc.fillRect(18, h - 30, w - 36, 3);   // engraved rule
    cc.textAlign = "center"; cc.textBaseline = "middle";
    if (clerk === "MERCER") { cc.fillStyle = "#e8b23a"; cc.font = "bold 58px Arial"; cc.fillText("SGT. MERCER", w / 2, h / 2 - 16, w - 44);
      cc.fillStyle = "#9fb2c4"; cc.font = "24px Arial"; cc.fillText("EVIDENCE, 22 YEARS", w / 2, h / 2 + 38); }
    else if (clerk === "PYE") { cc.fillStyle = "#cdd8e2"; cc.font = "bold 58px Arial"; cc.fillText("OFC. PYE", w / 2, h / 2 - 16, w - 44);
      cc.fillStyle = "#9fb2c4"; cc.font = "24px Arial"; cc.fillText("EVIDENCE, PROBATIONARY", w / 2, h / 2 + 38); }
    else { cc.fillStyle = "#6d7f91"; cc.font = "bold 44px Arial"; cc.fillText("POST EMPTY", w / 2, h / 2); }
    if (V.plate) V.plate.paint(); else if (V.plateTex) V.plateTex.needsUpdate = true;
  }

  /* ==========================================================
     5. CAST — real peds via ctx.npc.  THE COP-FLAG DECISION lives here:
        catalog fits WITHOUT a cop flag (CAT.precinct / CAT.detective), post:"pinned" → kind:"staff". Never
        kind:"cop", never the cop:true "police" catalog fit. See header.
     ========================================================== */
  // POSTS (venue-LOCAL). home = where they stand; coffee = the machine.
  const POSTS = {
    KOWALCZYK: [-6, 4.6, Math.PI], BRISCO: [4, 6.2, Math.PI], DASILVA: [8.2, 4.6, Math.PI],
    PYE_DESK: [-9, -6.2, 0], MERCER_DESK: [-11, -6.2, 0], REYES_DESK: [-10, -4.6, 0],
    VOSS_DESK: [-12, -8, 0], CAGE: [-5.4, -11.6, Math.PI], RECORDS: [-11, -17, -Math.PI / 2],
    INTERROGATION: [11, -12.5, -Math.PI / 2], WANTED: [14.6, 0.6, -Math.PI / 2], COFFEE: [-13, -1.2, -Math.PI / 2],
  };
  function queueStaff() {
    // uniformed officers — city/outfits.js CAT.precinct: the patrol uniform and duty belt, NO cop flag.
    qNPC("KOWALCZYK", { role: "sergeant", name: "Sgt. Kowalczyk", outfit: "precinct", skin: 0xdca87e,
      at: POSTS.KOWALCZYK.slice(0, 2), face: POSTS.KOWALCZYK[2], post: "pinned", pose: "stand",
      dialogue: ["Visiting hours. Sit or don't.", "Name? Take a number.", "Third double this week. Don't test me."], sayColor: "#dfe7ff" });
    qNPC("BRISCO", { role: "officer", name: "Ofc. Brisco", outfit: "precinct", skin: 0x9a6a48,
      at: POSTS.BRISCO.slice(0, 2), face: POSTS.BRISCO[2], post: "pinned", pose: "stand",
      dialogue: ["Move it along, friend.", "That your face on the board?", "Coffee machine ate my dollar again."] });
    qNPC("DASILVA", { role: "clerk", name: "Clerk da Silva", outfit: 0x5a6478, skin: 0xd8a882,
      at: POSTS.DASILVA.slice(0, 2), face: POSTS.DASILVA[2], post: "pinned", pose: "stand",
      dialogue: ["Cash only.", "No hoods at my window, sir.", "Next."] });
    qNPC("PYE", { role: "clerk", name: "Ofc. Pye", outfit: "precinct", skin: 0xe8c098,
      at: POSTS.CAGE.slice(0, 2), face: POSTS.CAGE[2], post: "pinned", pose: "stand",
      dialogue: ["Rookie on the cage. Lucky me.", "Pal, I just work here.", "Six months in. Still get lost down here."] });
    qNPC("MERCER", { role: "sergeant", name: "Sgt. Mercer", outfit: "precinct", skin: 0xba8a66,
      at: POSTS.MERCER_DESK.slice(0, 2), face: POSTS.MERCER_DESK[2], post: "pinned", pose: "sit",
      dialogue: ["Twenty-two years. I know a real star from a laminate.", "Son, I've seen every trick twice.", "Eighteen months to my pension."] });
    // detectives — CAT.detective: shirt and tie, shield on the belt (still kind:"staff", not cops).
    qNPC("REYES", { role: "detective", name: "Det. Reyes", outfit: "detective", skin: 0xc08a5e,
      at: POSTS.REYES_DESK.slice(0, 2), face: POSTS.REYES_DESK[2], post: "pinned", pose: "sit",
      dialogue: ["That desk bites. Walk on.", "Case files are need-to-know."] });
    qNPC("VOSS", { role: "detective", name: "Det. Voss", outfit: "detective", skin: 0xe0b090,
      at: POSTS.VOSS_DESK.slice(0, 2), face: POSTS.VOSS_DESK[2], post: "pinned", pose: "sit",
      dialogue: ["Your boy in there won't stop talking. Good.", "Every word's another charge."] });
    // LOU the bondsman — loud shirt, a civilian fixer (never a cop).
    qNPC("LOU", { role: "bondsman", name: "Lou", outfit: 0xa04a68, skin: 0xe0b088,
      at: [18.5, 4.4], face: 0, post: "pinned", pose: "stand",
      dialogue: ["Everything's for sale in here. Especially mercy.",
        "The vig keeps me sentimental.", "I bonded out his father too."] });
    // THE BOY — Lt. Decker, crew teal, a civilian in custody (driven manually).
    qNPC("DECKER", { role: "detainee", name: "Lt. Decker", outfit: 0x1f6f6a, skin: 0xc89878,
      at: [12, -6], face: -Math.PI / 2, post: "pinned", pose: "sit",
      dialogue: ["Kid. Get me out before they move me downtown.",
        "I didn't say nothing. Yet.", "Ma thinks I'm at work.",
        "Voss keeps smiling at me. I hate that."], sayColor: "#ffe9b8" });
  }
  function qNPC(tag, spec) { if (V && V.pending) V.pending.push({ tag, spec }); }
  function arenaLive() { return !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root); }
  function drainCast() {
    if (!V || !V.pending) return;
    if (C.npc && !arenaLive() && !(V._venue && V._venue.group && V._venue.group.parent)) return;
    const pend = V.pending; V.pending = null;   // null first → idempotent
    for (const item of pend) {
      const h = C.npc(item.spec);
      if (item.tag === "DECKER") V.decker = h;
      else if (item.tag === "LOU") V.lou = h;
      else { V.staff[item.tag] = h; V.staffPost = V.staffPost || {}; }
    }
  }

  /* ==========================================================
     6. ZONES — every mechanic is an [E] zone (the interface)
     ========================================================== */
  function pNear(lx, lz, r) {
    const P = CBZ.player; if (!P || !P.pos || !V) return false;
    const dx = P.pos.x - (V.origin.x + lx), dz = P.pos.z - (V.origin.z + lz);
    return dx * dx + dz * dz < r * r;
  }
  function buildZones(ctx) {
    ctx.zone({ id: "sarge", pos: [-6, 5.2], r: 2.6, label: labelSarge, onUse: () => openSergeant() });
    ctx.zone({ id: "bail", pos: [8.2, 5.0], r: 2.6, label: labelBail, onUse: () => openBail() });
    ctx.zone({ id: "podium", pos: [12, 6], r: 2.0, label: () => S && S.inv.badge ? "" : "[E] Lift the visitor-escort badge", onUse: liftBadge });
    ctx.zone({ id: "case", pos: [-10, -4.4], r: 2.2, label: () => S && S.inv.caseNo ? "" : "[E] Flip through Reyes' case file", onUse: stealCase });
    ctx.zone({ id: "cage", pos: [-6, -11.6], r: 2.4, label: labelCage, onUse: () => openEvidence() });
    ctx.zone({ id: "grab", pos: [-11, -15], r: 2.2, label: () => (S && S.cageOpen && S.stashLoc === "cage") ? "[E] Take the duffel (no signature)" : "", onUse: grabDuffel });
    ctx.zone({ id: "lawyer", pos: [6, -12.4], r: 2.2, label: labelLawyer, onUse: slideLawyer });
    ctx.zone({ id: "fridge", pos: [-14.6, -5.2], r: 2.2, label: () => (S && !S.inv.steak && !S.steakDeployed) ? "[E] Take the break-room steak" : "", onUse: takeSteak });
    ctx.zone({ id: "steak", pos: [0, -23], r: 3.0, label: labelSteak, onUse: tossSteak });
    ctx.zone({ id: "lou", pos: [18.5, 5.0], r: 2.6, label: () => "[E] Lou the bondsman", onUse: () => openBondsman() });
    ctx.zone({ id: "extract", pos: [V ? V.extract.x : 10, V ? V.extract.z : 14], r: V ? V.extract.r : 3.6, label: labelExtract, onUse: () => finishRun() });
    ctx.zone({ id: "boy", pos: [12, -6], r: 3.2, label: labelBoy, onUse: talkBoy });
  }
  // dynamic labels (also arm the run on first approach)
  function labelSarge() { armStart(); const r = S; if (!r) return "[E] Precinct 13. GET YOUR BOY OUT";
    if (r.bribed) return "[E] The desk sergeant (charges lost)";
    if (r.password && !r.released && r.releaseAt == null) return "[E] Whisper the word to the sergeant. $" + BOND.BRIBE;
    return "[E] Talk to the desk sergeant"; }
  function labelBail() { const r = S; if (!r) return "[E] Bail window"; if (r.chargesKicked || r.released || r.releaseAt != null) return "[E] Bail window (settled)";
    const q = bailQuote(r.charges); return q == null ? "[E] Bail window (CLOSED. RICO referral)" : "[E] Post bail. $" + q; }
  function labelCage() { const r = S; if (!r) return "[E] Evidence cage"; if (r.inv.duffel) return "[E] Evidence cage (stash out)";
    return rosterAt(r.t, r.lawyered).cage ? "[E] Evidence cage, sign-out / work the lock" : "[E] Evidence cage (clerk away)"; }
  function labelLawyer() { const r = S; if (!r || !r.inv.card || r.lawyered) return ""; return r.deckerLoc === "interrogation" ? "[E] Slide the lawyer card through the tray" : ""; }
  function labelSteak() { const r = S; if (!r || !r.inv.steak) return ""; return "[E] Toss the steak to REX"; }
  function labelExtract() { const r = S; if (!r) return "[E] The crew's beater"; return "[E] Slip away in the beater"; }
  function labelBoy() { const r = S; if (!r) return "[E] Talk to Decker"; if (r.released) return r.following ? "" : "[E] Bring Decker";
    return (r.deckerLoc === "holding") ? "[E] Talk to Decker (holding)" : ""; }

  /* ==========================================================
     7. ACTIONS
     ========================================================== */
  function armStart() { if (!S) { S = freshRun(); const s = bag(); s.attempts++; saveStats(); } if (S && !S.started) S.started = true; }

  function openSergeant() {
    armStart();
    if (S.bribed) { sergeantSay("Paperwork's moving. Slow. Like me."); return; }
    if (S.password && !S.released && S.releaseAt == null) {
      // the corrupt release path — needs the word bought from Lou + real cash.
      if (!C.wallet.spend(BOND.BRIBE, "Sergeant's 'clerical error'")) { sergeantSay("That phrase costs $" + BOND.BRIBE + ". Come back heavy."); return; }
      S.paid += BOND.BRIBE; S.bribed = true; S.chargesKicked = true; S.talking = false;
      startRelease(); toast("CHARGES KICKED");
      sergeantSay("Huh. Seems Decker's arrest sheet never got filed. Clerical.");
      return;
    }
    sergeantSay(pick(["Visiting hours. Bench is there.", "You lost? Bail window's the glass."]));
  }
  function sergeantSay(l) { staffSay("KOWALCZYK", l); }
  // a staffer's words go over HIS head. No body in the room, no line.
  function staffSay(name, l) { const h = V && V.staff[name]; if (h && h.say) h.say(l); }

  function openBondsman() {
    armStart();
    if (!S.password) staffSay("LOU", "The sarge is on the take. I sell the word.");
    const owe = S.loanOwed ? "you owe Lou $" + S.loanOwed : "";
    C.hud.panel(
      hHead("LOU'S BONDS", owe) +
      "<div style='font-size:13px;margin:6px 0;line-height:1.5'>Cash <b>" + fmtCash(C.wallet.cash()) + "</b></div>" +
      hBtn("word", S.password ? "WORD BOUGHT" : "Buy the word on the sarge. $" + BOND.PASSWORD, S.password ? "#26343c" : "#8a1f1f", S.password) +
      hBtn("loan", S.loanGot ? "LOAN TAKEN" : "Loan. $" + BOND.LOAN_NOW + " now, $" + BOND.LOAN_OWED + " owed", S.loanGot ? "#26343c" : "#1f4e8a", !!S.loanGot) +
      "<div style='margin-top:8px'>" + hBtn("close", "Leave", "#26343c") + "</div>",
      {
        word: () => { if (S.password) return; if (!C.wallet.spend(BOND.PASSWORD, "The word on Kowalczyk")) { staffSay("LOU", "Short. Loans are the other thing I do."); return; }
          S.paid += BOND.PASSWORD; S.password = true; toast("WORD BOUGHT"); staffSay("LOU", "The word is half-caf, extra vig. Tell the sarge."); openBondsman(); },
        loan: () => { if (S.loanGot) return; C.wallet.give(BOND.LOAN_NOW, "Lou's loan"); S.loanGot = BOND.LOAN_NOW; S.loanOwed = BOND.LOAN_OWED; toast("LOAN"); openBondsman(); },
        close: () => C.hud.closePanel(),
      });
  }

  function openBail() {
    armStart();
    if (S.chargesKicked || S.released || S.releaseAt != null) { staffSay("DASILVA", "You're square. He's being processed."); return; }
    if (!rosterAt(S.t, S.lawyered).bail) return;   // the shade is down; the window shows it
    const q = bailQuote(S.charges);
    if (q == null) { staffSay("DASILVA", "It's above my pay grade now. The DA has the file."); return; }
    staffSay("DASILVA", S.talking ? "$" + q + ". Goes up every word he says." : "Bail's $" + q + ".");
    C.hud.panel(
      hHead("BAIL WINDOW", "charges: " + chargeTier(S.charges)) +
      "<div style='font-size:13px;margin:6px 0;line-height:1.5'>Bail <b>$" + q + "</b>. Cash <b>" + fmtCash(C.wallet.cash()) + "</b></div>" +
      hBtn("pay", "Post bail. $" + q, "#1c6b40") + hBtn("close", "Leave", "#26343c"),
      {
        pay: () => { const qq = bailQuote(S.charges); if (qq == null) { staffSay("DASILVA", "Too late. RICO referral. Window's shut."); C.hud.closePanel(); return; }
          if (!C.wallet.spend(qq, "Bail posted")) { staffSay("DASILVA", "Bail is $" + qq + ". You're short."); return; }
          S.paid += qq; S.bailPaid = true; startRelease(); toast("BAIL POSTED");
          staffSay("DASILVA", "Receipt. Processing takes a minute."); C.hud.closePanel(); },
        close: () => C.hud.closePanel(),
      });
  }

  // TAKEN WITH A HAND (systems/verbs_pickup.js): the badge leaves the podium
  // in the hand. (It used to stay on the podium after you had it.)
  function handTake(obj, key, then) {
    if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(CBZ.player, obj || null, { pose: "card", key: key, onTaken: then });
    else then();
  }
  function liftBadge() {
    armStart(); if (S.inv.badge) return;
    const w = observed();
    if (w) { S.heat += 25; toast("HEY!"); w.say("Hands off the podium."); return; }
    handTake(V && V.badgeMesh, "police-badge", function () {
      if (S.inv.badge) return;
      S.inv.badge = true; toast("BADGE LIFTED");
    });
  }
  function stealCase() {
    armStart(); if (S.inv.caseNo) return;
    if (rosterAt(S.t, S.lawyered).bullpenDesk === "REYES") { staffSay("REYES", "That desk bites. Walk on."); S.heat += 8; return; }
    const w = observed();
    if (w) { S.heat += 25; toast("HEY!"); w.say("Step away from the detective's desk."); return; }
    S.inv.caseNo = CASE_NO; toast("CASE " + CASE_NO);
  }

  function openEvidence() {
    armStart();
    if (S.inv.duffel) return;
    const clerk = rosterAt(S.t, S.lawyered).cage;
    if (clerk && flickerPhaseAt(S.t) !== "dark" && !S.cageOpen) clerkSay(clerk, S.inv.caseNo ? "Case number and a badge. Let's see 'em." : "Sign-out needs a case number and a badge, pal.");
    C.hud.panel(
      hHead("EVIDENCE CAGE", S.inv.caseNo ? "case " + S.inv.caseNo : "") +
      hBtn("sign", "Sign the duffel out", "#1f4e8a", !clerk || S.stashLoc !== "cage") +
      hBtn("pick", S.cageOpen ? "GATE OPEN" : "Pick the cage lock", "#8a1f1f", S.cageOpen || !S.inv.picks) +
      "<div style='margin-top:8px'>" + hBtn("close", "Back off", "#26343c") + "</div>",
      {
        sign: () => signOut(),
        pick: () => { for (let i = 0; i < 3; i++) pickTick(1.0); openEvidence(); },
        close: () => C.hud.closePanel(),
      });
  }
  function signOut() {
    const clerk = rosterAt(S.t, S.lawyered).cage;
    if (!clerk) return;   // nobody at the log desk
    if (!S.inv.caseNo) { clerkSay(clerk, "Sign-out needs a case number and a badge, pal."); return; }
    const r = custodyCheck(S.inv.caseNo, S.inv.badge ? 1 : 0, S.t, S.lawyered);
    if (!r.accept) {
      if (!r.badgeOk && clerk === "MERCER") {
        S.veteranStrikes++; S.heat += 22; clerkSay("MERCER", "Escort badge? Twenty-two years, son. Walk away.");
        if (S.veteranStrikes >= 2) { S.heat = 100; detain(); }   // the vet makes you on a second try
      } else if (!r.caseOk) { clerkSay(clerk, "That case number doesn't check out."); S.heat += 10; }
      else { clerkSay(clerk, "That does not check out."); S.heat += 6; }
      C.hud.closePanel(); return;
    }
    S.custody.push({ t: fmtT(S.t), item: "E-3312 (duffel, narcotics)", caseNo: S.inv.caseNo, badge: "VISITOR-ESCORT", clerk, action: "SIGN-OUT" });
    S.inv.duffel = true; S.stashLoc = "hand"; if (V.duffel) V.duffel.visible = false;
    toast("SIGNED OUT"); clerkSay(clerk, "Transfer to the DA run, right? Sign here.");
    C.hud.closePanel();
  }
  function clerkSay(name, l) { staffSay(name, l); }
  function pickTick(dt) {
    if (S.cageOpen) return;
    const clerk = rosterAt(S.t, S.lawyered).cage;
    const blind = !clerk || flickerPhaseAt(S.t) === "dark";
    if (blind) {
      S.pickProgress += dt;
      if (S.pickProgress >= 3) { S.cageOpen = true; if (V.cageGate) V.cageGate.rotation.y = 1.7;
        if (V.cageGateCol && CBZ.colliders) { const i = CBZ.colliders.indexOf(V.cageGateCol); if (i >= 0) CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
        toast("CAGE OPEN"); }
    } else { S.heat += 9 * dt; if (clerk) clerkSay(clerk, "Step AWAY from the cage."); }
  }
  function grabDuffel() {
    armStart(); if (!S.cageOpen || S.stashLoc !== "cage") return;
    handTake(V && V.duffel, "police-duffel", function () {
      if (S.stashLoc !== "cage") return;
      S.inv.duffel = true; S.stashLoc = "hand"; if (V.duffel) V.duffel.visible = false;
      toast("THE STASH");
    });
  }

  function slideLawyer() {
    armStart(); if (!S.inv.card || S.lawyered || S.deckerLoc !== "interrogation") return;
    S.inv.card = false; S.lawyered = true; S.talking = false;
    toast("HE SHUT UP"); if (V.decker && V.decker.say) V.decker.say("...I want my lawyer. Miss Ferro. Now.");
  }

  function takeSteak() {
    armStart(); if (S.inv.steak || S.steakDeployed) return;
    S.inv.steak = true; toast("STEAK");
  }
  function tossSteak() {
    armStart(); if (!S.inv.steak) return;
    S.inv.steak = false; S.steakDeployed = true; S.dogEatUntil = S.t + 90;
    toast("GOOD BOY");
  }

  function talkBoy() {
    armStart();
    if (S.released && !S.following) { S.following = true; if (V.decker && V.decker.say) V.decker.say("Right behind you. Walk normal."); return; }
    if (V.decker && V.decker.say) V.decker.say(pick(["Tell Ma I'm fine. Don't tell her where.", "How long have I been in here?", "They took my shoelaces, man.", "I didn't say nothing. Yet."]));
  }

  /* ---- release + endings ---- */
  function startRelease() { S.releaseAt = S.t + 22; }
  function releaseTick() {
    if (S.releaseAt != null && !S.released && S.t >= S.releaseAt) {
      S.released = true; S.releaseAt = null; S.talking = false;
      S.deckerLoc = "lobby";
      if (V.decker) { V.decker.pose && V.decker.pose("stand"); V.decker.at && V.decker.at(2.5, 3.0, Math.PI); }
      toast("RELEASED"); if (V.decker && V.decker.say) V.decker.say("I'm out. Get me outta here.");
    }
  }
  function finishRun() {
    armStart(); if (S.ended) return;
    const boy = S.released && S.following;
    const stash = S.inv.duffel;
    if (boy && stash) endRun("WIN", "CLEAN GETAWAY", "Boy and bag, gone before the whistle. Nobody even looked up.");
    else if (boy) endRun("PARTIAL", "HALF A JOB", "Decker rides shotgun. The stash rides to the DA at shift end.");
    else if (stash) endRun("PARTIAL", "HALF A JOB", "The bag is out. Decker watches you drive off through the bars.");
    else endRun("LEAVE", "YOU WALKED", "Empty hands, clean record. The precinct never knew your name. Decker did.");
  }
  function endRun(kind, title, why) {
    if (S.ended) return;
    S.ended = true; S.ending = kind; S.endWhy = why;
    const s = bag();
    if (kind === "WIN") { s.wins++; if (CBZ.city && CBZ.city.addRespect) { try { CBZ.city.addRespect(10); } catch (e) {} } }
    else if (kind === "PARTIAL") s.partials++;
    else if (kind === "LOSE") s.busted++;
    if (kind === "WIN" || kind === "PARTIAL") s.bestTimeLeft = Math.max(s.bestTimeLeft, Math.round(SHIFT_LEN - S.t));
    saveStats();
    openResult();
  }
  // LOSE — heat maxes → you're booked. The cell-block-z homage: cell B, camera
  // behind bars, "Z WUZ HERE" on the wall. Panel-arc (movement is engine-owned).
  function detain() {
    if (!S || S.detained || S.ended) return;
    S.detained = true; S.heat = 100;
    toast("BOOKED");
    setTimeout(() => { if (S && S.detained && !S.ended) {
      S.ended = true; S.ending = "LOSE"; S.endWhy = "Cuffs, prints, cell B.";
      const s = bag(); s.busted++; saveStats(); openResult();
    } }, 1200);
  }

  /* ==========================================================
     8. UPDATE — distance-gated sim + roster ped drive + HUD
     ========================================================== */
  function update(ctx, dt) {
    if (!V || (V._venue && ctx.venue !== V._venue)) return;
    if (V.pending && V.pending.length) drainCast();
    if (!dt || dt > 0.4) dt = 0.05;

    const P = CBZ.player, o = V.origin;
    near = !!(P && P.pos && Math.hypot(P.pos.x - o.x, P.pos.z - o.z) < 70);
    if (!near) return;                 // across the map: nothing ticks

    // flicker tube visuals always cheap while near (telegraphs the dark window)
    if (S && V.flickTubes.length) {
      const ph = flickerPhaseAt(S.t);
      const col = ph === "dark" ? 0x3c443f : ph === "warn" ? 0x6f7b70 : 0xeaf7ec;
      for (const m of V.flickTubes) m.color.setHex(col);
      if (V.cageLight) V.cageLight.intensity = ph === "dark" ? 0.12 : ph === "warn" ? 0.5 : 0.9;
    }
    if (!S || !S.started || S.ended) return;

    stepSim(dt);
    driveRoster(dt);
    driveDecker(dt);

    // positional mechanics use the REAL player transform (venue-local)
    const px = P.pos.x - o.x, pz = P.pos.z - o.z;
    checkDetector(px, pz);
    checkK9(px, pz);

    if (panelMode === "result") { /* result panel is static */ }
  }

  // headless-safe core step (also driven by api.simShift for the gate).
  function stepSim(dt) {
    if (!S || S.ended) return;
    S.t += dt;
    if (S.t >= SHIFT_LEN) {
      // shift change: the whistle ends the run unless you're already at the car.
      if (pNear(V.extract.x, V.extract.z, V.extract.r)) finishRun();
      else endRun("LOSE", "SHIFT CHANGE", "The whistle. Fresh uniforms fill the lobby, the DA van backs up to the cage, and somebody finally reads the wanted board.");
      return;
    }
    releaseTick();
    // CHARGE METER: climbs while he talks in the box; freezes on the lawyer card.
    S.talking = chargeTalking() && rosterAt(S.t, S.lawyered).interrogation === "VOSS";
    if (S.talking) S.charges = Math.min(100, S.charges + dt * (100 / 900));
    // the boy gets walked to the box at t=120 (if not already released)
    if (S.t >= 120 && S.deckerLoc === "holding" && S.releaseAt == null && !S.released) S.deckerLoc = "interrogation";
    // heat decay + booking
    S.heat = Math.max(0, S.heat - dt * 1.6);
    S.heatPeak = Math.max(S.heatPeak, S.heat);
    if (S.heat >= 100) detain();
    // boards
    const cage = rosterAt(S.t, S.lawyered).cage;
    if (cage !== lastCage) { drawPlate(cage); lastCage = cage; }
    const ph = flickerPhaseAt(S.t);
    if (ph !== lastPhase) { lastPhase = ph; }
    if (Math.floor(S.t) % 20 === 0) drawRoster(S.t);
  }

  // ROSTER-DRIVEN PED MOVEMENT — reuse the pinned staff peds by lerping their
  // staffPost between posts on the visible shift timer (coffee pulls, cage
  // swaps, records run, Voss→box). handle.at() moves both pos and staffPost.
  function officerTarget(name, t) {
    const away = awayAt(name, t);
    if (away) return POSTS.COFFEE;
    switch (name) {
      case "KOWALCZYK": return POSTS.KOWALCZYK;
      case "DASILVA": return POSTS.DASILVA;
      case "BRISCO": { for (const w of STUDY) if (t >= w[0] && t < w[1]) return POSTS.WANTED; return POSTS.BRISCO; }
      case "REYES": return (t >= RECORDS_RUN[0] && t < RECORDS_RUN[1]) ? POSTS.RECORDS : POSTS.REYES_DESK;
      case "VOSS": return (t >= 120 && !S.lawyered && !S.released && S.releaseAt == null) ? POSTS.INTERROGATION : POSTS.VOSS_DESK;
      case "PYE": return cageClerkAt(t) === "PYE" ? POSTS.CAGE : POSTS.PYE_DESK;
      case "MERCER": return cageClerkAt(t) === "MERCER" ? POSTS.CAGE : POSTS.MERCER_DESK;
    }
    return null;
  }
  function driveRoster(dt) {
    V._cur = V._cur || {}; V._pose = V._pose || {};
    for (const name in V.staff) {
      const h = V.staff[name]; if (!h || !h.ped) continue;
      const tgt = officerTarget(name, S.t); if (!tgt) continue;
      const cur = V._cur[name] || (V._cur[name] = [tgt[0], tgt[1]]);
      const k = 1 - Math.exp(-3 * dt);
      cur[0] += (tgt[0] - cur[0]) * k; cur[1] += (tgt[1] - cur[1]) * k;
      const moving = Math.hypot(tgt[0] - cur[0], tgt[1] - cur[1]) > 0.15;
      if (h.at) h.at(cur[0], cur[1], tgt[2]);
      // only re-pose on CHANGE (avoid fighting the ped anim layer every frame)
      const want = moving ? "stand" : (tgt === POSTS.REYES_DESK || tgt === POSTS.VOSS_DESK || tgt === POSTS.MERCER_DESK) ? "sit" : "stand";
      if (h.pose && V._pose[name] !== want) { h.pose(want); V._pose[name] = want; }
    }
  }
  function driveDecker(dt) {
    const h = V.decker; if (!h || !h.ped) return;
    if (S.following) {
      const P = CBZ.player, o = V.origin;
      const lx = P.pos.x - o.x, lz = P.pos.z - o.z;
      const cx = h.ped.pos.x - o.x, cz = h.ped.pos.z - o.z;
      const dx = lx - cx, dz = lz - cz, d = Math.hypot(dx, dz);
      if (d > 2.2) { const sp = Math.min(3.4, d) * dt * 1.4; h.at && h.at(cx + dx / d * sp, cz + dz / d * sp, Math.atan2(dx, dz)); }
      return;
    }
    // park him per location
    if (S.deckerLoc === "interrogation") h.at && h.at(11, -12.5, -Math.PI / 2);
    else if (S.deckerLoc === "lobby") h.at && h.at(2.5, 3.0, Math.PI);
  }

  // METAL DETECTOR — trip on an INWARD crossing (z from >8 to <8) while the
  // REAL weapon state reads a drawn gun or a held melee. Immediate heat.
  function checkDetector(px, pz) {
    if (S.prevZ === 99) { S.prevZ = pz; return; }   // first frame: seed the prior side, never trip on spawn
    const w = liveWeaponState();
    const crossedIn = S.prevZ > 8 && pz <= 8 && px > -1.6 && px < 1.6;
    if (crossedIn && armedEntry(w) && (S.t - S.detectorTrippedT) > 3) {
      S.detectorTrippedT = S.t; S.heat = Math.min(100, S.heat + 45);
      toast("BEEP");
      const eye = observed(); if (eye) eye.say("Whoa. What's on your hip?");
      if (V.detLamp) V.detLamp.material.color.setHex(0xc8402f);
      if (S.heat >= 100) detain();
    } else if (V.detLamp && (S.t - S.detectorTrippedT) > 1.5) V.detLamp.material.color.setHex(0x2fd06a);
    S.prevZ = pz;
  }
  function liveWeaponState() {
    const gg = CBZ.game || {};
    return {
      gun: !!(CBZ.cityHasGun && CBZ.cityHasGun()),
      melee: !!gg.cityMeleeWeapon,
      stowed: !!gg.cityStowedWeapon,
    };
  }

  // K-9 — carrying the stash past the pen alarms, unless REX is on the steak.
  function checkK9(px, pz) {
    if (S.dogBarkCd > 0) S.dogBarkCd -= 0.05;
    const dogD = Math.hypot(px - 0, pz - (-24));
    if (pz < -20.5 && dogD < 6.0) {
      const eating = S.t < S.dogEatUntil;
      if (k9Alarm({ duffel: S.inv.duffel, steakDeployed: S.steakDeployed, dogEating: eating })) {
        toast("K-9 ALARM"); S.heat = 100; detain();
      } else if (!S.inv.duffel && S.dogBarkCd <= 0) { S.dogBarkCd = 12; S.heat = Math.min(100, S.heat + 4); }
    }
  }

  // THE OBSERVATION GATE: an on-post officer who can actually SEE you. It
  // used to be "anyone on duty within 7 m", eyes or no eyes, so lifting a case
  // file behind a clerk's back was exactly as risky as doing it in his face.
  // Now it is CBZ.brain.perception: his cone (the archetype's), the walls and
  // the cage between you, and the dark of the flickering tube (the brain's
  // light hook). Returns the WATCHER's handle (truthy) so he is the one who
  // shouts. No brain loaded: the old 7 m disc.
  const OBS_R = 7;
  const _obsOpts = { range: OBS_R, eyeY: 1.5, targetY: 1.2 };
  function observed() {
    if (!V || !CBZ.player) return null;
    const P = CBZ.player, B = CBZ.brain;
    const pa = (CBZ.city && CBZ.city.playerActor) || P;
    for (const name in V.staff) { const h = V.staff[name]; if (!h || !h.ped) continue;
      if (awayAt(name, S.t)) continue;
      if (Math.hypot(h.ped.pos.x - P.pos.x, h.ped.pos.z - P.pos.z) >= OBS_R) continue;
      if (B && B.perception && B.perception.sees) { if (B.perception.sees(h.ped, pa, _obsOpts)) return h; }
      else return h;
    }
    return null;
  }

  /* ==========================================================
     9. PANELS (engine-owned overlay)
     ========================================================== */
  const BTN = "display:inline-block;margin:3px 5px 3px 0;padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;user-select:none;box-shadow:0 3px 0 rgba(0,0,0,.4);";
  function hBtn(act, label, bg, dis) { return "<span data-act='" + act + "' style='" + BTN + "background:" + (bg || "#1c6b40") + ";" + (dis ? "opacity:.4;pointer-events:none;" : "") + "'>" + label + "</span>"; }
  function hHead(title, sub) {
    return "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
      "<b style='letter-spacing:2px;color:#e8b23a'>" + title + "</b><span style='opacity:.7;font-size:12px'>" + (sub || "") + "</span></div>";
  }
  function fmtCash(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

  function openResult() {
    panelMode = "result";
    const s = bag(), kind = S.ending;
    const col = kind === "WIN" ? "#5db87a" : kind === "LOSE" ? "#c8402f" : "#e8b23a";
    const title = kind === "WIN" ? "CLEAN GETAWAY" : kind === "LOSE" ? (S.detained ? "BOOKED" : "SHIFT CHANGE") : kind === "PARTIAL" ? "HALF A JOB" : "YOU WALKED";
    C.hud.panel(
      "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:6px'>" +
        "<b style='letter-spacing:2px;color:" + col + ";font-size:18px'>PRECINCT 13: " + title + "</b></div>" +
      "<div style='font-size:13px;margin:6px 0;line-height:1.5'>" + S.endWhy + "</div>" +
      "<div style='font-size:13px;margin:8px 0'>Time left <b>" + fmtT(SHIFT_LEN - S.t) + "</b>, charges <b>" + Math.round(S.charges) + " (" + chargeTier(S.charges) + ")</b>, cash spent <b>" + fmtCash(statSpent()) + "</b>, heat peak <b>" + Math.round(S.heatPeak) + "</b><br>" +
        "Record: " + s.wins + " clean, " + s.partials + " partial, " + s.busted + " booked" + "</div>" +
      hBtn("again", "Run it back", "#8a1f1f") + hBtn("close", "Leave", "#26343c"),
      { again: () => { S = null; panelMode = null; C.hud.closePanel(); armStart(); },
        close: () => { S = null; panelMode = null; C.hud.closePanel(); } });
  }
  /* ==========================================================
     10. REGISTER — SITE venue (no police lotKind exists in towngen;
         city/police.js fronts intake at City Hall). Resolve to open
         ground clear of the built city, deterministic per seed.
     ========================================================== */
  CBZ.games.register({
    id: "police",
    title: "PRECINCT 13",
    venue: {
      site: "precinct13",
      resolve(CBZ) {
        const A = (CBZ.city && CBZ.city.arena) || CBZ._settlementArena;
        if (!A || !A.root) return null;                     // wait until the world can answer
        // The world-layout expansion moved the old `A.maxX + 46` apron into
        // open sea. Resolve the whole 48x50m block against the live coast,
        // shared height oracle and placement ledger instead of trusting one
        // legacy bounds number. The scan is a fixed grid sorted nearest-first:
        // deterministic on every client and cheap (only during world build).
        const terrain = A.mapTerrain, shore = terrain && terrain.shoreAt;
        const ground = A.groundHeightAt || CBZ.cityGroundHeightAt;
        const placement = CBZ.placement;
        function boundsAt(x, z) {
          return { minX: x - 24, maxX: x + 24, minZ: z - 30, maxZ: z + 20 };
        }
        function fits(x, z) {
          const b = boundsAt(x, z);
          if (terrain && terrain.bounds && (b.minX < terrain.bounds.minX || b.maxX > terrain.bounds.maxX || b.minZ < terrain.bounds.minZ || b.maxZ > terrain.bounds.maxZ)) return false;
          if (placement && placement.isFree && !placement.isFree(b)) return false;
          const xs = [b.minX + 2, x, b.maxX - 2], zs = [b.minZ + 2, z - 5, b.maxZ - 2];
          let lo = Infinity, hi = -Infinity;
          for (let iz = 0; iz < zs.length; iz++) for (let ix = 0; ix < xs.length; ix++) {
            if (shore && +shore(xs[ix], zs[iz]) < 8) return false;
            const h = ground ? (+ground(xs[ix], zs[iz]) || 0) : 0;
            if (h < lo) lo = h; if (h > hi) hi = h;
          }
          return hi <= 0.65 && hi - lo <= 0.35;
        }
        const centerX = A.center && Number.isFinite(A.center.x) ? A.center.x : ((A.minX + A.maxX) * 0.5 || 0);
        const centerZ = A.center && Number.isFinite(A.center.z) ? A.center.z : ((A.minZ + A.maxZ) * 0.5 || 0);
        const candidates = [];
        // Preserve the old preferred side when it is genuinely valid.
        if (Number.isFinite(A.maxX) && Number.isFinite(A.minZ) && Number.isFinite(A.maxZ)) {
          candidates.push({ x: A.maxX + 46, z: (A.minZ + A.maxZ) * 0.5, rank: -1 });
        }
        const extent = 1800, step = 36;
        for (let dz = -extent; dz <= extent; dz += step) for (let dx = -extent; dx <= extent; dx += step) {
          candidates.push({ x: centerX + dx, z: centerZ + dz, rank: dx * dx + dz * dz });
        }
        candidates.sort(function (a, b) { return a.rank - b.rank || a.z - b.z || a.x - b.x; });
        for (let i = 0; i < candidates.length; i++) {
          const p = candidates[i];
          if (fits(p.x, p.z)) return { x: p.x, z: p.z, bounds: boundsAt(p.x, p.z) };
        }
        return null;                                         // retry after later land registrars
      },
    },
    build(ctx, venue) { build(ctx, venue); },
    update(ctx, dt) { try { update(ctx, dt); } catch (e) { /* never break the frame loop */ } },

    /* probe surface — the numeric gate asserts THROUGH this */
    api: {
      // pure rules (the gate's truth tables run these directly)
      rules: {
        SHIFT_LEN, CASE_NO, BOND, CAGE_SHIFTS, COFFEE, RECORDS_RUN, STUDY, AWAY,
        rosterAt, cageClerkAt, awayAt, custodyCheck, bailQuote, chargeTier,
        k9Alarm, armedEntry, flickerPhaseAt,
      },
      rosterAt: (t, lawyered) => rosterAt(t, lawyered),
      custodyCheck: (caseNo, badgeTier, t, lawyered) => custodyCheck(caseNo, badgeTier, t, lawyered),
      bailQuote: (c) => bailQuote(c),
      chargeTier: (c) => chargeTier(c),
      flickerPhaseAt: (t) => flickerPhaseAt(t),
      k9Alarm: (o) => k9Alarm(o),
      armedEntry: (w) => armedEntry(w),
      liveWeaponState: () => liveWeaponState(),

      // run control + inspection (probe drives the heist headlessly)
      startRun() { armStart(); return runView(); },
      state: () => runView(),
      _state: () => S,                       // live object (mutable) for rig-and-observe
      near: () => near,
      origin: () => (V ? { x: V.origin.x, z: V.origin.z } : null),
      cast: () => (V ? { staff: Object.keys(V.staff).length, decker: !!V.decker, lou: !!V.lou, rex: !!V.rex } : null),

      // advance the shift headlessly; charge meter + roster + endings step here.
      simShift(sec) {
        armStart(); const step = 0.25; let n = Math.max(0, Math.round(sec / step));
        for (let i = 0; i < n; i++) { if (S.ended) break; stepSim(step); }
        return runView();
      },
      // rig hooks for the gate (force exact conditions, then observe)
      rig(arr) { if (Array.isArray(arr)) for (const v of arr) RIGQ.push(v); return RIGQ.length; },
      seed(s) { seedRng(s); },
      set(field, val) { armStart(); if (S && field in S) { S[field] = val; return S[field]; } if (S && S.inv && field in S.inv) { S.inv[field] = val; return S.inv[field]; } return undefined; },
      // detector: run the real trip logic against a rigged weapon state
      detectorTrip(w) { return armedEntry(w); },
      // K-9: run the real alarm against a rigged fact set
      k9Trip(o) { return k9Alarm(o); },
      // custody quick-truth for a clerk at time t
      act: {
        signOut: () => { armStart(); signOut(); return runView(); },
        lift: () => { armStart(); liftBadge(); return runView(); },
        stealCase: () => { armStart(); stealCase(); return runView(); },
        lawyer: () => { armStart(); slideLawyer(); return runView(); },
        steak: () => { armStart(); takeSteak(); tossSteak(); return runView(); },
        bribe: () => { armStart(); S.password = true; openSergeant(); return runView(); },
      },
    },
  });

  function runView() {
    if (!S) return null;
    return {
      t: S.t, timeLeft: SHIFT_LEN - S.t, clock: fmtT(SHIFT_LEN - S.t), started: S.started, ended: S.ended, ending: S.ending, endWhy: S.endWhy,
      heat: Math.round(S.heat), heatPeak: Math.round(S.heatPeak), detained: S.detained,
      charges: Math.round(S.charges), chargeTier: chargeTier(S.charges), chargesKicked: S.chargesKicked,
      talking: S.talking, lawyered: S.lawyered, bailQuote: bailQuote(S.charges),
      cash: C ? C.wallet.cash() : 0, spent: statSpent(), loanOwed: S.loanOwed,
      password: S.password, bribed: S.bribed, bailPaid: S.bailPaid, released: S.released, releasePending: S.releaseAt != null, following: S.following,
      inv: JSON.parse(JSON.stringify(S.inv)), cageOpen: S.cageOpen, pickProgress: S.pickProgress,
      steakDeployed: S.steakDeployed, dogEating: S.t < S.dogEatUntil,
      deckerLoc: S.deckerLoc, stashLoc: S.stashLoc, veteranStrikes: S.veteranStrikes,
      roster: rosterAt(S.t, S.lawyered), flicker: flickerPhaseAt(S.t), custody: S.custody.slice(),
    };
  }
})();
