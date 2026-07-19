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
   plain navy/brown torso COLORS — never kind:"cop", never the cop:true
   "police" catalog fit. This follows the casino precedent (guard blacks,
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
  function feed(m, col) { C && C.hud.feed(m, col); }
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
    V = { origin: venue.origin, _venue: venue, pending: [], staff: {}, decker: null, lou: null, rex: null,
      rosterCanvas: null, rosterTex: null, plateCanvas: null, plateTex: null, cageGate: null, fireDoor: null,
      flickTubes: [], detLamp: null, coffeeLamp: null };
    const B = (x, y, z, w, h, d, col, ry) => ctx.box(g, x, y, z, w, h, d, ctx.mat(col), ry);
    const wallRun = (x, y, z, w, h, d, col) => { B(x, y, z, w, h, d, col || PAL.wall); ctx.solid(x - w / 2, z - d / 2, x + w / 2, z + d / 2); };

    // ---- shell: floor slab, perimeter walls (front door gap x[-2,2]), ceiling
    B(0, 0.02, -5, 32, 0.2, 32, PAL.floor);                 // interior slab
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

    // ---- METAL DETECTOR arch (the entry contract) at z=+8 -------------------
    B(-1.3, 1.25, 8, 0.5, 2.5, 0.6, PAL.detBar); ctx.solid(-1.55, 7.7, -1.05, 8.3);
    B(1.3, 1.25, 8, 0.5, 2.5, 0.6, PAL.detBar); ctx.solid(1.05, 7.7, 1.55, 8.3);
    B(0, 2.62, 8, 2.9, 0.34, 0.6, PAL.detBar);
    V.detLamp = ctx.box(g, 0, 2.9, 8, 0.5, 0.18, 0.18, new THREE.MeshBasicMaterial({ color: PAL.green }));

    // ---- FRONT DESK — the corrupt sergeant's anchor (never leaves post) -----
    B(-6, 0.7, 3.4, 5, 1.4, 1.6, PAL.desk); B(-6, 1.46, 3.4, 5.3, 0.12, 1.9, PAL.desktop);
    ctx.solid(-8.5, 2.6, -3.5, 4.2);
    signPanel(ctx, g, -6, 2.9, 4.25, 3.4, 0.7, "#0c1118", "#e8b23a", ["FRONT DESK", "ALL VISITORS SIGN IN"], 28);

    // ---- BAIL WINDOW (legal release) ----------------------------------------
    B(8.2, 1.05, 3.4, 3.2, 0.5, 0.9, PAL.desktop); B(8.2, 0.45, 3.4, 3, 0.9, 0.8, PAL.desk);
    B(8.2, 3.2, 3.4, 3.4, 0.5, 0.5, PAL.steel);            // window frame top
    ctx.solid(6.6, 2.95, 9.8, 3.85);
    signPanel(ctx, g, 8.2, 2.5, 3.9, 2.6, 0.6, "#101722", "#9fd0ff", ["BAIL / BOND WINDOW"], 26);

    // ---- VISITOR PODIUM + escort badge (badge tier 1) -----------------------
    B(12, 0.75, 6, 1.1, 1.5, 0.9, PAL.desk); B(12, 1.56, 6, 1.3, 0.12, 1.1, PAL.desktop);
    ctx.solid(11.35, 5.55, 12.65, 6.45);
    V.badgeMesh = ctx.box(g, 12, 1.7, 6, 0.22, 0.24, 0.08, new THREE.MeshBasicMaterial({ color: PAL.gold }));

    // ---- WANTED BOARD (your own poster; Brisco studies it) ------------------
    signPanel(ctx, g, 15.6, 2.4, 0, 0.5, 2.6, "#12161d", "#c8402f", ["WANTED"], 34, Math.PI / 2, 2.6);

    // ---- BULLPEN (west): coffee machine + break fridge + Reyes' case file ----
    B(-14.6, 0.55, -2, 1.3, 1.1, 2.2, PAL.steel); ctx.solid(-15.25, -3.1, -13.95, -0.9); // coffee counter
    B(-14.7, 1.5, -1.4, 0.8, 0.8, 0.8, 0x22262c);          // coffee machine
    V.coffeeLamp = ctx.box(g, -14.7, 1.98, -0.98, 0.34, 0.14, 0.1, new THREE.MeshBasicMaterial({ color: 0xd23b2a }));
    B(-14.6, 1.05, -5.2, 1.2, 2.1, 1.2, 0xb8bcc0); ctx.solid(-15.2, -5.8, -14, -4.6); // break FRIDGE (the steak)
    // Reyes' desk + the case FILE tray (the case number lives here)
    deskCluster(ctx, g, -10, -6, 0);
    B(-10.6, 0.98, -6.4, 0.7, 0.22, 0.5, 0xb8a06a);         // file-tray on the desk
    // DUTY ROSTER board (redrawn per shift phase) on the west wall
    V.rosterCanvas = document.createElement("canvas"); V.rosterCanvas.width = 320; V.rosterCanvas.height = 200;
    V.rosterTex = new THREE.CanvasTexture(V.rosterCanvas);
    { const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ map: V.rosterTex }));
      m.position.set(-15.65, 2.6, -8); m.rotation.y = Math.PI / 2; g.add(m); }
    drawRoster(0);

    // ---- EVIDENCE CAGE (north-west): chain-look walls + gate + clerk + plate --
    cageWall(ctx, g, -11, -18, 8, 0.34);    // north
    cageWall(ctx, g, -11, -12, 8, 0.34);    // south
    cageWall(ctx, g, -15, -15, 0.34, 6);    // west
    cageWall(ctx, g, -7, -16.3, 0.34, 3.4); // east upper (gate gap around z -14.5..-13)
    // the cage GATE (dynamic — swings open on a solved lock)
    V.cageGate = ctx.box(g, -7, 1.8, -13, 0.34, 3.3, 2.0, PAL.cage);
    V.cageGateCol = ctx.solid(-7.17, -14, -6.83, -12);
    // the STASH duffel on a shelf inside
    V.duffel = ctx.box(g, -11, 0.95, -15, 0.9, 0.5, 0.5, 0x1f6f6a);
    // clerk desk facing the gate + the NAMEPLATE (swaps PYE/MERCER — READ IT)
    B(-5.4, 0.7, -13, 1.5, 1.4, 2.2, PAL.desk); B(-5.4, 1.46, -13, 1.8, 0.12, 2.5, PAL.desktop);
    ctx.solid(-6.15, -14.1, -4.65, -11.9);
    V.plateCanvas = document.createElement("canvas"); V.plateCanvas.width = 256; V.plateCanvas.height = 80;
    V.plateTex = new THREE.CanvasTexture(V.plateCanvas);
    { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.44), new THREE.MeshBasicMaterial({ map: V.plateTex, transparent: true }));
      m.position.set(-5.4, 1.9, -12.0); g.add(m); }
    drawPlate("PYE");
    // the flickering fluorescent over the gate (the stealth mechanic light)
    for (let k = -1; k <= 1; k += 2) {
      const tube = ctx.box(g, -9, 4.85, -14 + k * 0.18, 2.2, 0.12, 0.16, new THREE.MeshBasicMaterial({ color: 0x93a695 }));
      V.flickTubes.push(tube.material);
    }

    // ---- INTERROGATION (north-east): viewing window + doc tray + the BOY -----
    B(11, 0.78, -15, 2.6, 0.2, 1.4, PAL.steel); ctx.solid(9.7, -15.7, 12.3, -14.3); // table
    // viewing-window wall at x=6 (glass band); the tray passes the lawyer card
    B(6, 0.55, -14, 0.5, 1.1, 6, PAL.wall); ctx.solid(5.75, -17, 6.25, -11);         // sill (solid below)
    B(6, 4.15, -14, 0.5, 2.0, 6, PAL.wall);                                          // head (solid above)
    { const glass = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 5.4),
        new THREE.MeshPhongMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.16, shininess: 90 }));
      glass.position.set(6, 2.5, -14); g.add(glass); }
    V.docTray = ctx.box(g, 6, 1.22, -12.4, 0.5, 0.14, 0.9, PAL.steel);              // the tray (lawyer card)

    // ---- HOLDING bars (where the boy starts; the LOSE arc's cell) -----------
    barRun(ctx, g, 12, -4, 12, -8);     // cell A bars along x=12
    signPanel(ctx, g, 12.4, 3.3, -6, 0.4, 0.9, "#0c0f14", "#8a929c", ["HOLDING"], 22, Math.PI / 2);

    // ---- REAR FIRE DOOR (opens from inside; the stash route out) ------------
    V.fireDoor = ctx.box(g, 1.4, 2.2, -20, 2.4, 3.4, 0.24, PAL.steel);
    V.fireDoorCol = ctx.solid(0.2, -20.2, 2.6, -19.8);

    // ---- K-9 KENNEL (rear alley, past the fire door) — the toll booth -------
    penFence(ctx, g, 0, -25.5, 5.6, 0.34);   // outer
    penFence(ctx, g, -2.6, -23.6, 0.34, 4);
    penFence(ctx, g, 2.6, -23.6, 0.34, 4);
    B(1.4, 0.65, -25.9, 1.5, 1.3, 1.4, 0x5c422e); B(1.4, 1.4, -25.9, 1.7, 0.22, 1.6, 0x462f1e); // doghouse
    buildRex(ctx, g, 0, -24);

    // ---- BONDSMAN booth (outside the front, east) — both money paths start --
    B(18.5, 0.7, 6, 2.6, 1.4, 1.4, PAL.desk); B(18.5, 1.46, 6, 2.9, 0.12, 1.7, PAL.desktop);
    ctx.solid(17.2, 5.3, 19.8, 6.7);
    B(20.5, 0.8, 4.2, 1.3, 1.6, 1.3, 0x2e3540); ctx.solid(19.85, 3.55, 21.15, 4.85);   // safe
    signPanel(ctx, g, 18.5, 2.7, 6.9, 3, 0.7, "#1a0f18", "#e8b23a", ["LOU'S BONDS", "OPEN ALL NIGHT"], 24);

    // ---- EXTRACTION beater at the curb (WIN/PARTIAL reads here) -------------
    B(10, 0.6, 14, 4.2, 0.7, 1.85, PAL.beater); B(10.1, 1.24, 14, 2.1, 0.6, 1.65, 0x3a332c);
    ctx.box(g, 8, 0.62, 13.55, 0.24, 0.24, 0.5, new THREE.MeshBasicMaterial({ color: 0xffe9b0 })); // headlight ON
    ctx.box(g, 8, 0.62, 14.45, 0.24, 0.24, 0.5, new THREE.MeshBasicMaterial({ color: 0xffe9b0 }));
    V.extract = { x: 10, z: 14, r: 3.6 };

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

  /* ---- geometry helpers (chunky ≥0.3u, voxel look) ---- */
  function deskCluster(ctx, g, x, z, ry) {
    ctx.box(g, x, 0.72, z, 2.6, 0.24, 1.5, ctx.mat(PAL.desktop), ry);
    ctx.box(g, x - 1.1, 0.36, z, 0.3, 0.72, 1.4, ctx.mat(PAL.desk), ry);
    ctx.box(g, x + 1.1, 0.36, z, 0.3, 0.72, 1.4, ctx.mat(PAL.desk), ry);
    ctx.box(g, x, 0.42, z + 1.25, 0.9, 0.16, 0.9, ctx.mat(0x3a4a5c), ry);
    ctx.solid(x - 1.45, z - 0.85, x + 1.45, z + 0.85);
  }
  function cageWall(ctx, g, x, z, w, d) {
    ctx.box(g, x, 0.35, z, w || 0.34, 0.34, d || 0.34, ctx.mat(PAL.cage));
    ctx.box(g, x, 3.3, z, w || 0.34, 0.34, d || 0.34, ctx.mat(PAL.cage));
    const len = Math.max(w || 0, d || 0), n = Math.max(1, Math.floor(len / 1.0));
    for (let i = 0; i <= n; i++) {
      const tt = i / n - 0.5;
      if (w > d) ctx.box(g, x + tt * (w - 0.3), 1.82, z, 0.3, 3.3, 0.3, ctx.mat(PAL.cage));
      else ctx.box(g, x, 1.82, z + tt * (d - 0.3), 0.3, 3.3, 0.3, ctx.mat(PAL.cage));
    }
    ctx.solid(x - (w || 0.34) / 2, z - (d || 0.34) / 2, x + (w || 0.34) / 2, z + (d || 0.34) / 2);
  }
  function barRun(ctx, g, x, z0, x1, z1) {
    const cz = (z0 + z1) / 2, len = Math.abs(z1 - z0);
    ctx.box(g, x, 0.3, cz, 0.4, 0.3, len, ctx.mat(PAL.bars));
    ctx.box(g, x, 3.55, cz, 0.4, 0.3, len, ctx.mat(PAL.bars));
    const n = Math.max(1, Math.floor(len / 0.62));
    for (let i = 0; i <= n; i++) ctx.box(g, x, 1.92, z0 + 0.15 + i * (len - 0.3) / n, 0.3, 3.3, 0.3, ctx.mat(PAL.bars));
    ctx.solid(x - 0.2, Math.min(z0, z1), x + 0.2, Math.max(z0, z1));
  }
  function penFence(ctx, g, x, z, w, d) {
    ctx.box(g, x, 0.25, z, w, 0.3, d, ctx.mat(PAL.cage));
    ctx.box(g, x, 1.35, z, w, 0.3, d, ctx.mat(PAL.cage));
    const len = Math.max(w, d), n = Math.max(1, Math.floor(len / 0.75));
    for (let i = 0; i <= n; i++) { const tt = i / n - 0.5;
      if (w > d) ctx.box(g, x + tt * (w - 0.3), 0.8, z, 0.3, 1.4, 0.3, ctx.mat(PAL.cage));
      else ctx.box(g, x, 0.8, z + tt * (d - 0.3), 0.3, 1.4, 0.3, ctx.mat(PAL.cage)); }
    ctx.solid(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
  }
  // REX — a chunky voxel quadruped (a PROP with a mechanic: the smell check),
  // animated via ctx.anim. Built from ctx.box so the package stays self-contained.
  function buildRex(ctx, g, x, z) {
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

  // roster board — redraws the on-post list per shift phase (the heist is read
  // off this: who's at the cage, who's away at coffee).
  function drawRoster(t) {
    if (!V || !V.rosterCanvas) return;
    const r = rosterAt(t, S && S.lawyered);
    const cc = V.rosterCanvas.getContext("2d"), w = V.rosterCanvas.width, h = V.rosterCanvas.height;
    cc.fillStyle = "#0c1118"; cc.fillRect(0, 0, w, h);
    cc.strokeStyle = "#e8b23a"; cc.lineWidth = 3; cc.strokeRect(5, 5, w - 10, h - 10);
    cc.fillStyle = "#e8b23a"; cc.font = "bold 20px Arial"; cc.textAlign = "left";
    cc.fillText("DUTY ROSTER", 16, 30);
    cc.font = "bold 13px Arial"; cc.fillStyle = "#9fb2c4";
    cc.fillText("SHIFT CHANGE " + fmtT(SHIFT_LEN - t), 16, 52);
    const rows = [["CAGE", r.cage || "— AT COFFEE"], ["FRONT DESK", r.frontDesk], ["BAIL", r.bail || "— WINDOW SHUT"],
      ["BULLPEN", r.bullpenDesk || "— OUT"], ["INTERROGATION", r.interrogation || "— EMPTY"], ["LOBBY", r.lobby], ["K-9", r.k9]];
    cc.font = "14px Arial";
    rows.forEach((row, i) => { const y = 78 + i * 17;
      cc.fillStyle = "#cdd8e2"; cc.fillText(row[0], 16, y);
      cc.fillStyle = row[1][0] === "—" ? "#e88a7a" : "#7fe8a8"; cc.textAlign = "right"; cc.fillText(row[1], w - 16, y); cc.textAlign = "left"; });
    if (V.rosterTex) V.rosterTex.needsUpdate = true;
  }
  // nameplate at the cage — the tell: PYE (rookie, escort badge OK) vs
  // SGT. MERCER (veteran, real star only). READ IT before you sign out.
  function drawPlate(clerk) {
    if (!V || !V.plateCanvas) return;
    const cc = V.plateCanvas.getContext("2d"), w = V.plateCanvas.width, h = V.plateCanvas.height;
    cc.clearRect(0, 0, w, h); cc.fillStyle = "#12161d"; cc.fillRect(0, 0, w, h);
    cc.strokeStyle = "#84765a"; cc.lineWidth = 4; cc.strokeRect(3, 3, w - 6, h - 6);
    cc.textAlign = "center"; cc.textBaseline = "middle";
    if (clerk === "MERCER") { cc.fillStyle = "#e8b23a"; cc.font = "bold 30px Arial"; cc.fillText("SGT. MERCER", w / 2, h / 2 - 8);
      cc.fillStyle = "#9fb2c4"; cc.font = "13px Arial"; cc.fillText("EVIDENCE · 22 YRS", w / 2, h / 2 + 20); }
    else if (clerk === "PYE") { cc.fillStyle = "#cdd8e2"; cc.font = "bold 30px Arial"; cc.fillText("OFC. PYE", w / 2, h / 2 - 8);
      cc.fillStyle = "#9fb2c4"; cc.font = "13px Arial"; cc.fillText("EVIDENCE · PROBATIONARY", w / 2, h / 2 + 20); }
    else { cc.fillStyle = "#6d7f91"; cc.font = "bold 22px Arial"; cc.fillText("— POST EMPTY —", w / 2, h / 2); }
    if (V.plateTex) V.plateTex.needsUpdate = true;
  }

  /* ==========================================================
     5. CAST — real peds via ctx.npc.  THE COP-FLAG DECISION lives here:
        plain navy/brown COLORS, post:"pinned" → kind:"staff". Never
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
    const N = PAL.navy;
    // uniformed officers — plain navy torso color (reads as precinct blue).
    qNPC("KOWALCZYK", { role: "sergeant", name: "Sgt. Kowalczyk", outfit: N, skin: 0xdca87e,
      at: POSTS.KOWALCZYK.slice(0, 2), face: POSTS.KOWALCZYK[2], post: "pinned", pose: "stand",
      dialogue: ["Visiting hours. Bench is there. Sit or don't.", "Bail window's the glass. Cage is police only."], sayColor: "#dfe7ff" });
    qNPC("BRISCO", { role: "officer", name: "Ofc. Brisco", outfit: N, skin: 0x9a6a48,
      at: POSTS.BRISCO.slice(0, 2), face: POSTS.BRISCO[2], post: "pinned", pose: "stand",
      dialogue: ["Move it along, friend.", "That your face on the board?"] });
    qNPC("DASILVA", { role: "clerk", name: "Clerk da Silva", outfit: 0x5a6478, skin: 0xd8a882,
      at: POSTS.DASILVA.slice(0, 2), face: POSTS.DASILVA[2], post: "pinned", pose: "stand",
      dialogue: ["Bail's posted at the window. Cash only.", "No hoods at my window, sir."] });
    qNPC("PYE", { role: "clerk", name: "Ofc. Pye", outfit: N, skin: 0xe8c098,
      at: POSTS.CAGE.slice(0, 2), face: POSTS.CAGE[2], post: "pinned", pose: "stand",
      dialogue: ["Sign-out needs a case number and a badge, pal.", "Escort detail? Sure, sign here."] });
    qNPC("MERCER", { role: "sergeant", name: "Sgt. Mercer", outfit: N, skin: 0xba8a66,
      at: POSTS.MERCER_DESK.slice(0, 2), face: POSTS.MERCER_DESK[2], post: "pinned", pose: "sit",
      dialogue: ["Twenty-two years. I know a real star from a laminate.", "Escort badge? Walk away, son."] });
    // detectives — plain brown/grey (plainclothes, still kind:"staff", not cops).
    qNPC("REYES", { role: "detective", name: "Det. Reyes", outfit: 0x6a5a48, skin: 0xc08a5e,
      at: POSTS.REYES_DESK.slice(0, 2), face: POSTS.REYES_DESK[2], post: "pinned", pose: "sit",
      dialogue: ["That desk bites. Walk on.", "Case files are need-to-know."] });
    qNPC("VOSS", { role: "detective", name: "Det. Voss", outfit: 0x4a4450, skin: 0xe0b090,
      at: POSTS.VOSS_DESK.slice(0, 2), face: POSTS.VOSS_DESK[2], post: "pinned", pose: "sit",
      dialogue: ["Your boy in there won't stop talking. Good.", "Every word's another charge."] });
    // LOU the bondsman — loud shirt, a civilian fixer (never a cop).
    qNPC("LOU", { role: "bondsman", name: "Lou", outfit: 0xa04a68, skin: 0xe0b088,
      at: [18.5, 4.4], face: 0, post: "pinned", pose: "stand",
      dialogue: ["Everything's for sale in this precinct, friend. Especially mercy.",
        "The vig is how I stay sentimental."] });
    // THE BOY — Lt. Decker, crew teal, a civilian in custody (driven manually).
    qNPC("DECKER", { role: "detainee", name: "Lt. Decker", outfit: 0x1f6f6a, skin: 0xc89878,
      at: [12, -6], face: -Math.PI / 2, post: "pinned", pose: "sit",
      dialogue: ["Kid. The sheet's on Reyes' desk — my number's 4471-B.",
        "Lou next door knows what the sarge drinks. Ask about the word.",
        "They put the bag in the cage. Rookie runs it till the vet clocks in — read the plate.",
        "Don't bring metal past that gate."], sayColor: "#ffe9b8" });
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
  function labelSarge() { armStart(); const r = S; if (!r) return "[E] Precinct 13 — GET YOUR BOY OUT";
    if (r.bribed) return "[E] The desk sergeant (charges lost)";
    if (r.password && !r.released && r.releaseAt == null) return "[E] Whisper the word to the sergeant — $" + BOND.BRIBE;
    return "[E] Talk to the desk sergeant"; }
  function labelBail() { const r = S; if (!r) return "[E] Bail window"; if (r.chargesKicked || r.released || r.releaseAt != null) return "[E] Bail window (settled)";
    const q = bailQuote(r.charges); return q == null ? "[E] Bail window (CLOSED — RICO referral)" : "[E] Post bail — $" + q; }
  function labelCage() { const r = S; if (!r) return "[E] Evidence cage"; if (r.inv.duffel) return "[E] Evidence cage (stash out)";
    return rosterAt(r.t, r.lawyered).cage ? "[E] Evidence cage — sign-out / work the lock" : "[E] Evidence cage (clerk away)"; }
  function labelLawyer() { const r = S; if (!r || !r.inv.card || r.lawyered) return ""; return r.deckerLoc === "interrogation" ? "[E] Slide the lawyer card through the tray" : ""; }
  function labelSteak() { const r = S; if (!r || !r.inv.steak) return ""; return "[E] Toss the steak to REX"; }
  function labelExtract() { const r = S; if (!r) return "[E] The crew's beater"; return "[E] Slip away in the beater"; }
  function labelBoy() { const r = S; if (!r) return "[E] Talk to Decker"; if (r.released) return r.following ? "" : "[E] \"Let's go.\" (he follows)";
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
    if (!S.password) feed("The sergeant's on the take — but you'd need the WORD. Ask Lou next door.", "#e8b23a");
  }
  function sergeantSay(l) { const h = V && V.staff.KOWALCZYK; if (h && h.say) h.say(l); else feed("Kowalczyk: " + l, "#dfe7ff"); }

  function openBondsman() {
    armStart();
    const owe = S.loanOwed ? "  ·  you owe Lou $" + S.loanOwed : "";
    C.hud.panel(
      hHead("LOU'S BONDS", "both money paths start here" + owe) +
      "<div style='font-size:13px;margin:6px 0;line-height:1.5'>Cash <b>" + fmtCash(C.wallet.cash()) + "</b>. The sergeant's on the take — I sell the WORD that opens him. Or take a loan; the vig keeps me sentimental.</div>" +
      hBtn("word", S.password ? "WORD BOUGHT" : "Buy the word on the sarge — $" + BOND.PASSWORD, S.password ? "#26343c" : "#8a1f1f", S.password) +
      hBtn("loan", S.loanGot ? "LOAN TAKEN" : "Loan — $" + BOND.LOAN_NOW + " now, $" + BOND.LOAN_OWED + " owed", S.loanGot ? "#26343c" : "#1f4e8a", !!S.loanGot) +
      "<div style='margin-top:8px'>" + hBtn("close", "Leave", "#26343c") + "</div>",
      {
        word: () => { if (S.password) return; if (!C.wallet.spend(BOND.PASSWORD, "The word on Kowalczyk")) { feed("Short. Loans are the other thing I do."); return; }
          S.paid += BOND.PASSWORD; S.password = true; toast("WORD BOUGHT"); feed("Tell Kowalczyk: \"Half-caf, extra vig.\"", "#e8b23a"); openBondsman(); },
        loan: () => { if (S.loanGot) return; C.wallet.give(BOND.LOAN_NOW, "Lou's loan"); S.loanGot = BOND.LOAN_NOW; S.loanOwed = BOND.LOAN_OWED; toast("LOAN"); openBondsman(); },
        close: () => C.hud.closePanel(),
      });
  }

  function openBail() {
    armStart();
    if (S.chargesKicked || S.released || S.releaseAt != null) { feed("Bail's settled. Decker's release is in motion."); return; }
    if (!rosterAt(S.t, S.lawyered).bail) { feed("da Silva: Window shade is down — BACK IN 5.", "#e88a7a"); return; }
    const q = bailQuote(S.charges);
    if (q == null) { feed("da Silva: It's above my pay grade now. The DA has the file.", "#e88a7a"); return; }
    C.hud.panel(
      hHead("BAIL WINDOW", "charges: " + chargeTier(S.charges)) +
      "<div style='font-size:13px;margin:6px 0;line-height:1.5'>Bail is <b>400 + 8 × charges</b> = <b>$" + q + "</b>, and it CLIMBS while he talks in the box (freeze it with the lawyer card). Cash <b>" + fmtCash(C.wallet.cash()) + "</b>.<br><span style='opacity:.8'>Cheaper but dirty: the sergeant kicks the whole sheet for the word + $" + BOND.BRIBE + ".</span></div>" +
      hBtn("pay", "Post bail — $" + q, "#1c6b40") + hBtn("close", "Leave", "#26343c"),
      {
        pay: () => { const qq = bailQuote(S.charges); if (qq == null) { feed("Too late — RICO referral. The window's shut."); return; }
          if (!C.wallet.spend(qq, "Bail posted")) { feed("da Silva: Bail is $" + qq + ". You're short."); return; }
          S.paid += qq; S.bailPaid = true; startRelease(); toast("BAIL POSTED");
          feed("da Silva: Receipt. Processing takes a minute — wait by the desk.", "#9fd0ff"); C.hud.closePanel(); },
        close: () => C.hud.closePanel(),
      });
  }

  function liftBadge() {
    armStart(); if (S.inv.badge) return;
    if (observed()) { S.heat += 25; toast("HEY!"); feed("\"Hands off the podium.\"", "#e88a7a"); return; }
    S.inv.badge = true; toast("BADGE LIFTED"); feed("A visitor-escort badge. Fools a rookie. Not a veteran.", "#e8b23a");
  }
  function stealCase() {
    armStart(); if (S.inv.caseNo) return;
    if (rosterAt(S.t, S.lawyered).bullpenDesk === "REYES") { feed("Reyes: That desk bites. Walk on.", "#e88a7a"); S.heat += 8; return; }
    if (observed()) { S.heat += 25; toast("HEY!"); feed("\"Step away from the detective's desk.\"", "#e88a7a"); return; }
    S.inv.caseNo = CASE_NO; toast("CASE " + CASE_NO); feed("Case number " + CASE_NO + " — the duffel's sign-out key.", "#e8b23a");
  }

  function openEvidence() {
    armStart();
    if (S.inv.duffel) { feed("The stash is already out. Get it to the beater."); return; }
    const clerk = rosterAt(S.t, S.lawyered).cage;
    const blind = !clerk || flickerPhaseAt(S.t) === "dark";
    C.hud.panel(
      hHead("EVIDENCE CAGE", clerk ? ("clerk: " + clerk + (flickerPhaseAt(S.t) === "dark" ? " · tube DARK" : "")) : "post empty — tube: " + flickerPhaseAt(S.t)) +
      "<div style='font-size:13px;margin:6px 0;line-height:1.5'>Two ways past the gate:<br>• <b>SIGN IT OUT</b> — needs case# <b>" + (S.inv.caseNo || "—") + "</b> + a badge that satisfies the clerk (rookie takes the escort badge; the veteran does not — READ THE PLATE).<br>• <b>PICK THE LOCK</b> — only while the clerk can't see you (post empty OR the tube is dark). No signature, no chain.</div>" +
      hBtn("sign", "Sign the duffel out", "#1f4e8a", !clerk || S.stashLoc !== "cage") +
      hBtn("pick", S.cageOpen ? "GATE OPEN" : "Work the cage lock (" + Math.floor(S.pickProgress / 3 * 100) + "%)", "#8a1f1f", S.cageOpen || !S.inv.picks) +
      "<div style='margin-top:8px'>" + hBtn("close", "Back off", "#26343c") + "</div>" +
      (blind ? "<div style='font-size:11px;color:#7fe8a8;margin-top:4px'>The clerk can't see the gate right now.</div>" : ""),
      {
        sign: () => signOut(),
        pick: () => { for (let i = 0; i < 3; i++) pickTick(1.0); openEvidence(); },
        close: () => C.hud.closePanel(),
      });
  }
  function signOut() {
    const clerk = rosterAt(S.t, S.lawyered).cage;
    if (!clerk) { feed("Nobody at the log desk to sign anything."); return; }
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
  function clerkSay(name, l) { const h = V && V.staff[name]; if (h && h.say) h.say(l); else feed(name + ": " + l, "#dfe7ff"); }
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
    S.inv.duffel = true; S.stashLoc = "hand"; if (V.duffel) V.duffel.visible = false;
    toast("THE STASH"); feed("No signature. No chain. Like it was never here.", "#7fe8a8");
  }

  function slideLawyer() {
    armStart(); if (!S.inv.card || S.lawyered || S.deckerLoc !== "interrogation") return;
    S.inv.card = false; S.lawyered = true; S.talking = false;
    toast("HE SHUT UP"); if (V.decker && V.decker.say) V.decker.say("...I want my lawyer. Miss Ferro. Now.");
    feed("Charge meter FROZEN — he's done talking.", "#7fe8a8");
  }

  function takeSteak() {
    armStart(); if (S.inv.steak || S.steakDeployed) return;
    S.inv.steak = true; toast("STEAK"); feed("Somebody's Friday dinner. The dog needs it more.", "#e8b23a");
  }
  function tossSteak() {
    armStart(); if (!S.inv.steak) return;
    S.inv.steak = false; S.steakDeployed = true; S.dogEatUntil = S.t + 90;
    toast("GOOD BOY"); feed("REX buries his snout in the steak. The rear's open for ~90s.", "#7fe8a8");
  }

  function talkBoy() {
    armStart();
    if (S.released && !S.following) { S.following = true; if (V.decker && V.decker.say) V.decker.say("Right behind you. Walk normal."); feed("Decker's on your shoulder — get to the beater.", "#7fe8a8"); return; }
    if (V.decker && V.decker.say) V.decker.say(pick(["The sheet's on Reyes' desk — 4471-B.", "Read the plate at the cage before you sign.", "Don't bring metal past that gate."]));
  }

  /* ---- release + endings ---- */
  function startRelease() { S.releaseAt = S.t + 22; }
  function releaseTick() {
    if (S.releaseAt != null && !S.released && S.t >= S.releaseAt) {
      S.released = true; S.releaseAt = null; S.talking = false;
      S.deckerLoc = "lobby";
      if (V.decker) { V.decker.pose && V.decker.pose("stand"); V.decker.at && V.decker.at(2.5, 3.0, Math.PI); }
      toast("RELEASED"); feed("Decker walks out to the lobby. Say the word and he follows.", "#7fe8a8");
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
      S.ended = true; S.ending = "LOSE"; S.endWhy = "Cuffs, prints, cell B — you know how this ends. You've read the wall.";
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
      toast("DETECTOR — BEEP");
      feed("Metal at the gate. Every eye in the lobby just found you. Stow it or lose the picks.", "#e88a7a");
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
        toast("K-9 ALARM"); feed("REX lunges at the duffel — the whole precinct heard that.", "#e88a7a"); S.heat = 100; detain();
      } else if (!S.inv.duffel && S.dogBarkCd <= 0) { S.dogBarkCd = 12; S.heat = Math.min(100, S.heat + 4); feed("REX barks you back from the kennel.", "#e88a7a"); }
    }
  }

  function observed() {
    // a simple observation gate: an on-post officer within ~7u of the player.
    // (uses staff ped positions; enough to make lifting risky without a full LOS.)
    if (!V || !CBZ.player) return false;
    const P = CBZ.player;
    for (const name in V.staff) { const h = V.staff[name]; if (!h || !h.ped) continue;
      if (Math.hypot(h.ped.pos.x - P.pos.x, h.ped.pos.z - P.pos.z) < 7 && !awayAt(name, S.t)) return true; }
    return false;
  }

  /* ==========================================================
     9. PANELS (engine-owned overlay)
     ========================================================== */
  const BTN = "display:inline-block;margin:3px 5px 3px 0;padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;user-select:none;box-shadow:0 3px 0 rgba(0,0,0,.4);";
  function hBtn(act, label, bg, dis) { return "<span data-act='" + act + "' style='" + BTN + "background:" + (bg || "#1c6b40") + ";" + (dis ? "opacity:.4;pointer-events:none;" : "") + "'>" + label + "</span>"; }
  function hHead(title, sub) {
    return "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
      "<b style='letter-spacing:2px;color:#e8b23a'>" + title + "</b><span style='opacity:.7;font-size:12px'>" + (sub || "") + " · Esc closes</span></div>";
  }
  function fmtCash(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

  function openResult() {
    panelMode = "result";
    const s = bag(), kind = S.ending;
    const col = kind === "WIN" ? "#5db87a" : kind === "LOSE" ? "#c8402f" : "#e8b23a";
    const title = kind === "WIN" ? "CLEAN GETAWAY" : kind === "LOSE" ? (S.detained ? "BOOKED" : "SHIFT CHANGE") : kind === "PARTIAL" ? "HALF A JOB" : "YOU WALKED";
    C.hud.panel(
      "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:6px'>" +
        "<b style='letter-spacing:2px;color:" + col + ";font-size:18px'>PRECINCT 13 — " + title + "</b>" +
        "<span style='opacity:.7;font-size:12px'>Esc closes</span></div>" +
      "<div style='font-size:13px;margin:6px 0;line-height:1.5'>" + S.endWhy + "</div>" +
      "<div style='font-size:13px;margin:8px 0'>Time left <b>" + fmtT(SHIFT_LEN - S.t) + "</b> · charges <b>" + Math.round(S.charges) + " (" + chargeTier(S.charges) + ")</b> · cash spent <b>" + fmtCash(statSpent()) + "</b> · heat peak <b>" + Math.round(S.heatPeak) + "</b><br>" +
        "Record: " + s.wins + " clean · " + s.partials + " partial · " + s.busted + " booked" + "</div>" +
      hBtn("again", "Run it back", "#8a1f1f") + hBtn("close", "Leave", "#26343c"),
      { again: () => { S = null; panelMode = null; C.hud.closePanel(); armStart(); openObjectives(); },
        close: () => { S = null; panelMode = null; C.hud.closePanel(); } });
  }
  function openObjectives() {
    const r = S || freshRun();
    C.hud.panel(
      hHead("PRECINCT 13", "GET YOUR BOY OUT · shift change " + fmtT(SHIFT_LEN - r.t)) +
      "<div style='font-size:13px;margin:6px 0;line-height:1.6'>" +
        "① <b>FREE DECKER</b> — post steep cash bail at the window, OR buy the WORD from Lou and let the sergeant kick the sheet ($" + BOND.BRIBE + ").<br>" +
        "② <b>RECOVER THE STASH</b> — sign the duffel out of the cage (case # from Reyes' file + a badge that satisfies the clerk — READ THE PLATE), or pick the gate while the clerk's blind.<br>" +
        "• Freeze his rising charges with the lawyer card (viewing-window tray).<br>" +
        "• Steak the K-9 before you carry the bag out the back.<br>" +
        "• Nothing metal drawn through the front detector." +
      "</div>" + hBtn("close", "Get to work", "#1c6b40"),
      { close: () => C.hud.closePanel() });
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
        // Prefer a real civic anchor if the engine already publishes one, then
        // offset the precinct onto OPEN GROUND east of the city footprint so
        // its block never intersects a lot. Constant fallback keeps it byte-stable.
        let cx = 0, cz = 0;
        if (typeof A.maxX === "number" && typeof A.minZ === "number" && typeof A.maxZ === "number") {
          cx = A.maxX + 46;                                  // east backcountry apron (walkable underlay)
          cz = (A.minZ + A.maxZ) / 2;
        } else if (CBZ.cityPoliceStation && CBZ.cityPoliceStation()) {
          const st = CBZ.cityPoliceStation(); cx = st.x + 60; cz = st.z;
        } else { cx = 760; cz = 40; }                        // hard constant fallback (open ground)
        return { x: cx, z: cz };
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
