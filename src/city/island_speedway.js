/* ============================================================
   city/island_speedway.js — THE BULLRING, the place.

   The island's ground, the causeway that reaches it, and the stadium, built
   by the SAME modules games/race.html draws (race_core + race_track +
   race_venue), so there is one bowl and one circuit. The race itself is run
   IN THE WORLD by city/speedway_race.js: you walk in, get into a car with F
   and race on this track against the field.

   WHAT MAKES IT A PLACE YOU WALK, not a picture:
     - the banking is ground: CBZ.registerCityGroundHeight publishes the
       racing surface and the apron (race_core.surfaceY), so feet, parked
       cars and anything else that asks CBZ.floorAt stand on the 24 degree
       turns, not under them;
     - the way in is the drivers' tunnel (race_track.js tunnelSpec): the main
       gate in the back of the grandstand, a 1:8 ramp down under the stands,
       under the wall, the racing surface and pit road, and a flight of stairs
       up into the pass-through garage bay, whose roller door opens on pit
       road; a crew gap in the pit wall leads to the grid. Its floors and
       ceiling are solidground carvings (the lid over the tunnel is the track
       itself), its walls and rails are y-banded colliders, and the island's
       ground has the corridor cut out of it so you walk DOWN into it;
     - walls you cannot walk through: the outside of the stands (open only at
       the gate), the SAFER wall from the track side, the pit wall (but its
       crew gap), the garage block (but the pass-through bay), and the infield
       buildings once the stadium is built.

   Phone: the stadium is not built with the world. It is built the first time
   you come within BUILD_R and hidden past SHOW_R; the ground, the causeway
   and the colliders are cheap and built with the world.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const RACE = CBZ.race || {};
  const RC = RACE.core;

  // ---- footprint (the world layout, the desert strait, the causeway lane and
  //      the map are all planned around these numbers) ----
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("speedway")) || { dx: 0, dz: 0 };
  const CX = 490 + _WOFF.dx, CZ = -350 + _WOFF.dz, R = 210;
  const SITE_HX = 214, SITE_HZ = 182, SITE_DZ = -23, SITE_POW = 2.45;
  const ACCESS_Z = CZ - 190;
  const CW_X = 348;                          // the causeway lane (x 336..360)

  /* THE BOWL IN CITY COORDINATES. The race modules author the circuit with
     the front stretch toward +z (south). Here the public arrives from the
     north, so the venue is turned half a turn about its centre V:
       city = V - core      (the same formula both ways)
       city yaw = core yaw + PI                                            */
  const VX = CX, VZ = CZ + 12;
  const toCity = (x, z, o) => { o = o || {}; o.x = VX - x; o.z = VZ - z; return o; };
  const toCore = toCity;
  const yawToCity = (y) => { let a = y + Math.PI; if (a > Math.PI) a -= Math.PI * 2; return a; };

  const BUILD_R = 1300, SHOW_R = 2600;
  const QUALITY = ("ontouchstart" in window) || navigator.maxTouchPoints > 0 ? "low" : "high";

  // ---- the causeway leaves the annex (expansion.js reads annexPorts) -------
  CBZ.annexPorts = (CBZ.annexPorts || []).filter(function (p) { return p && p.name !== "Diamond Causeway"; });
  CBZ.annexPorts.push({ name: "Diamond Causeway", side: "south", x: CW_X, half: 14.4 });
  let CW_START_Z = -585, CW_REC_Z = -585;
  function annexDock(city) {
    CW_START_Z = CW_REC_Z = -585;
    const S = city && city.annex && city.annex.streets && city.annex.streets.south;
    if (!S || !isFinite(S.z) || !isFinite(S.hw)) return;
    if (S.x0 > CW_X - 12 || S.x1 < CW_X + 12) return;
    CW_START_Z = S.z + S.hw;
    CW_REC_Z = S.z;
  }

  // ---- the site boundary (a superellipse: a campus cut into the country) --
  function siteEdge(a, m) {
    const ca = Math.cos(a), sa = Math.sin(a), p = 2 / SITE_POW;
    return {
      x: CX + Math.sign(ca) * Math.pow(Math.abs(ca), p) * (SITE_HX - m),
      z: CZ + SITE_DZ + Math.sign(sa) * Math.pow(Math.abs(sa), p) * (SITE_HZ - m),
    };
  }

  /* What the city needs to know about the stadium BEFORE it is built: where
     the outside of the stands is, the gate, and the tunnel. race_venue.js
     answers from the frame alone. */
  const VENUE_SPEC = RC && RACE.venue ? RACE.venue.spec(RC) : null;
  const TU = VENUE_SPEC ? VENUE_SPEC.tunnel : null;
  const D = RC ? RC.DIMS : null;

  /* THE ENTRANCE: where the venue says its public gate is, in city space,
     plus the point on the plaza you stand on in front of it. */
  let ENT = null;
  function entrance() {
    if (ENT) return ENT;
    if (!RC || !VENUE_SPEC) return null;
    const me = VENUE_SPEC.mainEntrance;
    const f = RC.frame(me.s), out = me.u + 7;
    const p = toCity(f.x + f.nx * out, f.z + f.nz * out);
    const door = toCity(f.x + f.nx * me.u, f.z + f.nz * me.u);
    ENT = { x: p.x, z: p.z, doorX: door.x, doorZ: door.z, heading: Math.atan2(door.x - p.x, door.z - p.z) };
    return ENT;
  }
  CBZ.speedwayGate = function () {
    const e = entrance();
    return e ? { x: e.x, z: e.z, heading: e.heading } : null;
  };

  // ====================================================================== //
  //  THE BANKING IS GROUND                                                  //
  // ====================================================================== //
  /* The racing surface, the apron and THE STANDS, as the city's ground height
     (the max of every registered landmass): a quick box reject for the whole
     world, then race_core's own nearest() with the last answer as the hint.

     WHY PEOPLE STOOD IN THE ASPHALT. This provider was always here, but its
     hint was one number shared by every caller (the player's feet, every
     ped's feet, the camera, the crowd), and race_core.nearest() searched only
     +-40 m round it: a ped across the bowl from the last caller got the
     nearest point of a 40 m window that did not contain him, a u that was
     wrong, and a floor of 0 (the infield grade) or another place's banking.
     race_core now refuses a window whose best sample is at its edge.

     THE STANDS (race_track.js kit: STAND / standSection, the numbers
     race_venue.js draws from): the walkway behind the catch fence at the
     wall top, the parapet lip, twenty rows, the cross-aisle, eighteen rows,
     the concourse. Their faces are colliders (buildWalls), so a step is a
     step and the fascia and the vom wall are walls. */
  const KIT = RACE.track && RACE.track.kit;
  const STAND = KIT ? KIT.STAND : null, SUITES = KIT ? KIT.SUITES : null;
  const OUT_MAX = STAND && SUITES ? STAND.uBack + SUITES.depth : (D ? D.WALL_U : 0);
  const BAND_X = RC ? D.bbox.x1 + OUT_MAX + 2 : 0, BAND_Z = RC ? D.bbox.z1 + OUT_MAX + 2 : 0;
  let hintS = null;
  const _nr = {}, _sec = {};
  /* the walking surface of the stands at (s, u), u past the SAFER wall face */
  function standY(s, u) {
    KIT.standSection(RC, s, _sec);
    if (u < STAND.U0 - 0.25) return _sec.wallTop;                    // wall top + the walkway behind the fence
    if (u < STAND.U0) return _sec.y0 + 0.95;                         // the parapet lip
    if (u < STAND.uC0) return _sec.y0 + Math.min(STAND.T1 - 1, Math.floor((u - STAND.U0) / STAND.TREAD)) * STAND.RISER;
    if (u < STAND.uC1) return _sec.yX;                               // the cross-aisle
    if (u < STAND.uTop) return _sec.y2 + Math.min(STAND.T2 - 1, Math.floor((u - STAND.uC1) / STAND.TREAD)) * STAND.RISER;
    return _sec.yConc;                                               // the concourse
  }
  /* where the stands end: the outer wall (and in front of the main gate's
     recess, which is ground level: the plaza and the tunnel mouth) */
  function standOuter(s) { return VENUE_SPEC.outerU(s) - 1.8; }
  function bowlAt(x, z) {
    const cx = VX - x, cz = VZ - z;
    if (cx > BAND_X || cx < -BAND_X || cz > BAND_Z || cz < -BAND_Z) return null;
    RC.nearest(cx, cz, hintS, _nr);
    if (Math.abs(_nr.u) > 40) RC.nearest(cx, cz, null, _nr);
    hintS = _nr.s;
    return _nr;
  }
  function bowlSurfaceY(x, z) {
    const n = bowlAt(x, z);
    if (!n || n.u < D.APRON_IN) return 0;
    if (n.u <= D.WALL_U) return RC.surfaceY(n.s, n.u);
    if (!STAND || n.u > standOuter(n.s)) return 0;
    return standY(n.s, n.u);
  }
  if (RC && CBZ.registerCityGroundHeight) CBZ.registerCityGroundHeight(bowlSurfaceY, { name: "Bullring banking and stands" });

  /* WHO MAY BE PUT DOWN INSIDE THE BOWL. Nobody the street deals: no ambient
     walker, no corner dealer, on the racing surface, the apron, the pit lane,
     the infield or the stands. The people who belong there are placed by
     this file and city/speedway_race.js directly (the fans are the crowd in
     the seats, promoted near you), never through a spawner. A shaped zone:
     the rect is the broadphase, the test is the bowl's own (s, u). */
  CBZ.noSpawnTests = CBZ.noSpawnTests || Object.create(null);
  CBZ.noSpawnTests["speedway-bowl"] = function (x, z, pad) {
    const n = bowlAt(x, z);
    return !!(n && n.u < standOuter(n.s) + (pad || 0));
  };
  function noSpawnZone() {
    return { minX: VX - BAND_X, maxX: VX + BAND_X, minZ: VZ - BAND_Z, maxZ: VZ + BAND_Z, test: "speedway-bowl", label: "speedway-bowl" };
  }
  /* the racing surface alone (u from the apron's inside edge to the wall),
     for the race: a person standing here is a hazard to the field */
  CBZ.speedwayOnTrack = function (x, z) {
    const n = bowlAt(x, z);
    return !!(n && n.u > D.APRON_IN && n.u < D.WALL_U);
  };
  CBZ.speedwayFrame = function (x, z, out) {
    const n = bowlAt(x, z);
    if (!n) return null;
    out = out || {}; out.s = n.s; out.u = n.u;
    return out;
  };

  // ---- colliders (records carry ref "speedway" so a world rebuild can drop them) ----
  let myCols = [], myCarves = [];
  function dropOwn() {
    if (CBZ.colliders && myCols.length) {
      const set = new Set(myCols);
      for (let i = CBZ.colliders.length - 1; i >= 0; i--) if (set.has(CBZ.colliders[i])) CBZ.colliders.splice(i, 1);
    }
    myCols = [];
    if (CBZ.removeCarving) for (const c of myCarves) CBZ.removeCarving(c);
    myCarves = [];
  }
  /* a wall between two city points, t thick, from y0 to y1 */
  function wallSeg(ax, az, bx, bz, t, y0, y1) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.05 || !CBZ.orientedCollider) return;
    const c = CBZ.orientedCollider((ax + bx) / 2, (az + bz) / 2, len / 2 + 0.05, t / 2, Math.atan2(-dz, dx), y0, y1);
    c.ref = "speedway";
    CBZ.colliders.push(c); myCols.push(c);
  }
  const _a = {}, _b = {}, _w = {};
  /* a wall along the circuit at offset u from s0 to s1, in pieces of <= step metres */
  function wallAlong(s0, s1, u, t, y0, y1, step) {
    const n = Math.max(1, Math.ceil((s1 - s0) / (step || 6)));
    for (let i = 0; i < n; i++) {
      const sa = s0 + (s1 - s0) * i / n, sb = s0 + (s1 - s0) * (i + 1) / n;
      const ua = typeof u === "function" ? u(sa) : u, ub = typeof u === "function" ? u(sb) : u;
      RC.toWorld(sa, ua, 0, _w); toCity(_w.x, _w.z, _a);
      RC.toWorld(sb, ub, 0, _w); toCity(_w.x, _w.z, _b);
      // a band that follows the banking: y0 / y1 may be functions of s (the
      // piece takes the lower bottom and the higher top of its two ends)
      const ya = typeof y0 === "function" ? Math.min(y0(sa), y0(sb)) : y0;
      const yb = typeof y1 === "function" ? Math.max(y1(sa), y1(sb)) : y1;
      wallSeg(_a.x, _a.z, _b.x, _b.z, t, ya, yb);
    }
  }
  /* a wall across the circuit at s from u0 to u1 */
  function wallAcross(s, u0, u1, t, y0, y1) {
    RC.toWorld(s, u0, 0, _w); toCity(_w.x, _w.z, _a);
    RC.toWorld(s, u1, 0, _w); toCity(_w.x, _w.z, _b);
    wallSeg(_a.x, _a.z, _b.x, _b.z, t, y0, y1);
  }
  /* the tunnel corridor, in city space: x across (d), z along (u) */
  const tx = (d) => VX - (TU.x + d), tz = (u) => VZ - (TU.z0 + u);

  function buildWalls() {
    const L = D.L, PIT = RC.PIT, H = VENUE_SPEC.height || 30, GATE = VENUE_SPEC.gate;
    // the outside of the stands, all the way round but the main gate. The gate's
    // recess is square to the S/F normal (core x = +-GATE.hw at s = 0), so the ring
    // stops where its line passes the jambs, not at s = +-GATE.hw along the curve.
    const ring = (s) => VENUE_SPEC.outerU(s) - 1.2;
    let sA = 0;
    while (sA < 40) { RC.toWorld(sA, ring(sA), 0, _w); if (_w.x >= GATE.hw + 0.3) break; sA += 0.25; }
    // (the suite block stands 9 m further out than the stands either side: the
    //  ring runs in three pieces with a wall across each step)
    const S1 = 78, S0 = L - 78, uBk = VENUE_SPEC.outerU(L / 2) - 1.2, uSu = VENUE_SPEC.outerU(0) - 1.2;
    wallAlong(sA, S1, uSu, 2.8, 0, H, 7);
    wallAlong(S1, S0, ring, 2.8, 0, H, 7);
    wallAlong(S0, L - sA, uSu, 2.8, 0, H, 7);
    wallAcross(S1, uBk - 1.4, uSu + 1.4, 1.2, 0, H);
    wallAcross(S0, uBk - 1.4, uSu + 1.4, 1.2, 0, H);
    // the gate recess: jambs, and the lit back wall either side of the tunnel mouth
    const uO = VENUE_SPEC.outerU(0), uR = uO - 1.5, z0 = TU.z0;
    const seg = (x0, zz0, x1, zz1, t) => { toCity(x0, zz0, _a); toCity(x1, zz1, _b); wallSeg(_a.x, _a.z, _b.x, _b.z, t, -0.3, H); };
    for (const x of [-GATE.hw - 0.25, GATE.hw + 0.25]) seg(x, z0 + uR - 0.45, x, z0 + uO + 0.3, 0.5);
    seg(-GATE.hw, z0 + uR - 0.25, TU.x - TU.hw, z0 + uR - 0.25, 0.5);
    seg(TU.x + TU.hw, z0 + uR - 0.25, GATE.hw, z0 + uR - 0.25, 0.5);
    // the SAFER wall and the catch fence on it, to the top rail wherever the
    // banking puts it (it was a flat 14 m: on the 24 degree turns the rail is
    // at 16.5). Over it is a climb (the fence ladders below), not a walk.
    const surfW = (s) => RC.surfaceY(s, D.WALL_U);
    wallAlong(0, L, D.WALL_U + 0.45, 0.9, (s) => surfW(s) - 0.3, (s) => surfW(s) + D.WALL_H + D.FENCE_H + 0.3, 4);
    // THE STANDS' FACES (the floors are the ground provider, standY): the
    // fascia under the front row with its parapet lip (a 3 m wall from the
    // walkway; from the front row a 0.95 m parapet you vault), and the vom
    // wall between the cross-aisle and the upper tier.
    if (STAND) {
      const sec = {};
      const at = (s, k) => { KIT.standSection(RC, s, sec); return sec[k]; };
      wallAlong(0, L, STAND.U0 - 0.13, 0.26, (s) => at(s, "wallTop") - 0.3, (s) => at(s, "y0") + 0.95, 4);
      wallAlong(0, L, STAND.uC1 - 0.15, 0.3, (s) => at(s, "yX") - 0.3, (s) => at(s, "y2") - 0.02, 4);
    }
    // the pit wall, with the crew gap in front of the pass-through bay
    wallAlong(PIT.s0 - 6, TU.pitGap[0], PIT.wallU, 0.6, -0.3, 1.05, 6);
    wallAlong(TU.pitGap[1], PIT.s1 + 6, PIT.wallU, 0.6, -0.3, 1.05, 6);
    // the garage block: solid but the pass-through bay, which is a room with a door
    const G = TU.garage, g0 = PIT.boxS(0) - PIT.boxLen / 2 - 3, g1 = PIT.boxS(PIT.boxes - 1) + PIT.boxLen / 2 + 3;
    const uMid = (G.uF + G.uB) / 2, depth = G.uF - G.uB;
    wallAlong(g0, TU.bayS0, uMid, depth, -0.3, G.H, 6);
    wallAlong(TU.bayS1, g1, uMid, depth, -0.3, G.H, 6);
    wallAcross(TU.bayS0, G.uF, G.uB, 0.3, -0.3, G.H);
    wallAcross(TU.bayS1, G.uF, G.uB, 0.3, -0.3, G.H);
    wallAlong(TU.bayS0, TU.bayS1, G.uB + 0.15, 0.3, -0.3, G.H, 12);
    wallAlong(TU.bayS0, TU.bayS - TU.doorHW, G.uF - 0.12, 0.3, -0.3, G.H, 12);
    wallAlong(TU.bayS + TU.doorHW, TU.bayS1, G.uF - 0.12, 0.3, -0.3, G.H, 12);
    // the tunnel: its side walls (full height under the stands, below the lid under
    // the track, and up to the rail round the stairwell in the garage), and the rail
    // across the stairwell over the tunnel's end
    const side = (u0, u1, y0, y1) => { for (const d of [-TU.hw - 0.2, TU.hw + 0.2]) wallSeg(tx(d), tz(u0), tx(d), tz(u1), 0.4, y0, y1); };
    side(TU.uRampEnd - 0.5, TU.uMouth, -4.5, 6.2);
    side(TU.uStairBot, TU.uRampEnd, -4.5, TU.lid - 0.05);
    side(TU.uStairTop, TU.uStairBot + 0.2, -4.5, 1.0);
    wallSeg(tx(-TU.hw - 0.2), tz(TU.uStairBot + 0.1), tx(TU.hw + 0.2), tz(TU.uStairBot + 0.1), 0.2, -0.45, 1.0);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  /* THE TUNNEL'S FLOORS AND CEILING. Three solidground boxes on one straight
     corridor: the ramp (open above, its floor the 1:8 slope), the run under
     the track (a LID: the racing surface, the apron and pit road stay solid
     over a 3.0 m room), and the stairwell (open, its floor the flight). */
  function buildCarvings() {
    if (!CBZ.addCarving) return;
    const u2z = (u) => VZ - TU.z0 - u, floorFn = function (x, z) { return TU.floorAt(VZ - TU.z0 - z); };
    const box = (u0, u1, o) => {
      const c = Object.assign({ kind: "box", cx: tx(0), cz: (u2z(u0) + u2z(u1)) / 2, hw: TU.hw, hd: Math.abs(u1 - u0) / 2, yaw: 0, dry: true, owner: "speedway", mode: "city" }, o);
      myCarves.push(CBZ.addCarving(c));
    };
    // the ramp is open to its own ceiling (3.0 m over the gate's floor), not to
    // the sky: the stands over it are ground now, and a slot through them to
    // y = 60 dropped anybody crossing those rows into the tunnel
    box(TU.uRampEnd, TU.uMouth, { y0: TU.floor - 0.5, y1: TU.clear, open: true, floorFn });
    box(TU.uStairBot, TU.uRampEnd, { y0: TU.floor, y1: TU.lid, open: false });
    box(TU.uStairTop, TU.uStairBot, { y0: TU.floor - 0.5, y1: 60, open: true, floorFn });
  }

  // ====================================================================== //
  //  THE ISLAND (built with the world)                                      //
  // ====================================================================== //
  CBZ.addLandmass(function (city) {
    const root = city.root;
    if (!root || !RC || !VENUE_SPEC) return;
    annexDock(city);
    ENT = null;
    dropOwn();
    const L = D.L;

    // ---- the ground: country grass, a paved ring round the stadium, the
    //      entrance plaza and the approach apron; one canvas, one mesh ----
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1024;
    const c2 = cv.getContext("2d");
    const SPAN = Math.max(SITE_HX, SITE_HZ + Math.abs(SITE_DZ)) + 4;
    const px = (x) => (x - (CX - SPAN)) / (2 * SPAN) * 1024;
    const pz = (z) => (z - (CZ - SPAN)) / (2 * SPAN) * 1024;
    c2.fillStyle = "#5f7a4a"; c2.fillRect(0, 0, 1024, 1024);
    c2.globalAlpha = 0.08; c2.fillStyle = "#3f5a33";
    for (let y = 0; y < 1024; y += 36) c2.fillRect(0, y, 1024, 16);
    c2.globalAlpha = 1;
    function ring(extra) {
      c2.beginPath();
      for (let i = 0; i <= 240; i++) {
        const s = i / 240 * L, f = RC.frame(s), u = VENUE_SPEC.outerU(s) + extra;
        const p = toCity(f.x + f.nx * u, f.z + f.nz * u);
        if (i === 0) c2.moveTo(px(p.x), pz(p.z)); else c2.lineTo(px(p.x), pz(p.z));
      }
      c2.closePath();
    }
    ring(16); c2.fillStyle = "#44474c"; c2.fill();                 // the concourse apron round the bowl
    ring(15); c2.strokeStyle = "rgba(230,232,236,.35)"; c2.lineWidth = 2; c2.stroke();
    const E = entrance();
    // the plaza: from the approach road up to the main gate
    c2.fillStyle = "#55585d";
    const pzx0 = Math.min(E.doorX - 38, CX - 80), pzx1 = E.doorX + 38;
    c2.fillRect(px(pzx0), pz(ACCESS_Z - 14), px(pzx1) - px(pzx0), pz(E.doorZ + 2) - pz(ACCESS_Z - 14));
    c2.strokeStyle = "rgba(255,255,255,.08)"; c2.lineWidth = 1;
    for (let x = pzx0; x < pzx1; x += 6) { c2.beginPath(); c2.moveTo(px(x), pz(ACCESS_Z - 14)); c2.lineTo(px(x), pz(E.doorZ)); c2.stroke(); }
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    if (CBZ.freeCanvasAfterUpload) CBZ.freeCanvasAfterUpload(tex);   // painted once: the canvas goes once uploaded
    const shape = new THREE.Shape();
    for (let i = 0; i <= 192; i++) {
      const p = siteEdge(i / 192 * Math.PI * 2, 0);
      if (i === 0) shape.moveTo(p.x - CX, -(p.z - CZ)); else shape.lineTo(p.x - CX, -(p.z - CZ));
    }
    // the tunnel's corridor is cut out of the ground: you walk DOWN into it at the gate
    {
      const hole = new THREE.Path(), hx = TU.hw + 0.05;
      const pts = [[-hx, TU.uStairTop - 0.05], [hx, TU.uStairTop - 0.05], [hx, TU.uMouth + 0.05], [-hx, TU.uMouth + 0.05]];
      pts.forEach(([d, u], i) => { const x = tx(d) - CX, y = -(tz(u) - CZ); if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y); });
      hole.closePath();
      shape.holes.push(hole);
    }
    const geo = new THREE.ShapeGeometry(shape, 12);
    const pa = geo.attributes.position, uv = new Float32Array(pa.count * 2);
    for (let i = 0; i < pa.count; i++) {
      uv[i * 2] = (pa.getX(i) + SPAN) / (2 * SPAN);
      uv[i * 2 + 1] = (pa.getY(i) + SPAN) / (2 * SPAN);
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const gm = new THREE.MeshLambertMaterial({ map: tex });
    gm.polygonOffset = true; gm.polygonOffsetFactor = 1; gm.polygonOffsetUnits = 2;
    const ground = new THREE.Mesh(geo, gm);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(CX, 0.015, CZ);
    ground.receiveShadow = true;
    ground.userData.terrain = true; ground.userData.worldSurface = true;
    ground.matrixAutoUpdate = false; ground.updateMatrix();
    root.add(ground);

    // ---- the causeway, through to the plaza -----------------------------------
    const endX = Math.min(E.doorX - 30, CX - 60);
    if (CBZ.buildHighway) {
      CBZ.buildHighway(root, {
        path: [{ x: CW_X, z: CW_START_Z }, { x: CW_X, z: ACCESS_Z }, { x: endX, z: ACCESS_Z }],
        width: 24, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6, theme: "asphalt",
        guardrail: false, elevated: false, rng: CBZ.seedStream ? CBZ.seedStream("speedway") : null,
      });
    }

    buildWalls();
    buildCarvings();
    // the bowl is closed to the street's spawners (see noSpawnTests above)
    if (CBZ.registerNoSpawnZone) CBZ.registerNoSpawnZone(city, noSpawnZone());

    // ---- regions and roads (the map, traffic, the biome) ---------------------
    CBZ.registerCityRegion(city, { name: "Diamond Speedway", subtitle: "The Bullring", biome: "speedway", kind: "circle", cx: CX, cz: CZ, r: R, pad: 6, underlay: true, terrainGrade: true });
    CBZ.registerCityRegion(city, { name: "Diamond Causeway", subtitle: "The Bullring", biome: "speedway", kind: "rect", minX: CW_X - 12, maxX: CW_X + 12, minZ: CW_START_Z, maxZ: ACCESS_Z + 12, pad: 1 });
    CBZ.registerCityRegion(city, { name: "Diamond Causeway", subtitle: "The Bullring", biome: "speedway", kind: "rect", minX: 336, maxX: endX + 12, minZ: ACCESS_Z - 12, maxZ: ACCESS_Z + 12, pad: 1 });
    if (city.roads) {
      city.roads.push({ x: CW_X, z: (CW_REC_Z + ACCESS_Z) / 2, vertical: true, len: ACCESS_Z - CW_REC_Z, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
      city.roads.push({ x: (348 + endX) / 2, z: ACCESS_Z, vertical: false, len: endX - 348, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2, venueSite: "speedway" });
    }

    STAD.root = root; STAD.built = null;
    // a one-shot page raising this island (CBZ.studio.raise: NPC War's
    // speedway map) has no player walking up to it: build the bowl now
    if (CBZ.addLandmass._studioCollector) buildStadium();
  }, 20);

  // ====================================================================== //
  //  THE STADIUM (built when you come near, hidden when you are far)        //
  // ====================================================================== //
  const STAD = { root: null, built: null, group: null, track: null, venue: null, shown: false, infieldCols: [] };
  function buildStadium() {
    // a world rebuild made a new root: the old bowl goes with the old world
    if (STAD.group) {
      if (STAD.group.parent) STAD.group.parent.remove(STAD.group);
      STAD.track.dispose(); STAD.venue.dispose();
    }
    const grp = new THREE.Group(); grp.name = "bullring";
    grp.position.set(VX, 0, VZ); grp.rotation.y = Math.PI;
    STAD.track = RACE.track.build(THREE, RC, { quality: QUALITY });
    STAD.venue = RACE.venue.build(THREE, RC, { quality: QUALITY });
    grp.add(STAD.track.group); grp.add(STAD.venue.group);
    // the race page's own parking lot and far skyline band are for a page
    // with nothing around it; Gang City is what is around it here
    const sur = STAD.venue.surroundings;
    if (sur && sur.parent) sur.parent.remove(sur);
    grp.userData.dynamic = true;             // core/batch.js never bakes the bowl (it animates, and it is torn down)
    STAD.root.add(grp);
    STAD.group = grp; STAD.built = STAD.root;
    STAD.venue.setLights(0, false);
    // the infield buildings are solid once they exist (the garage block has its own walls)
    const inf = (STAD.venue.stats && STAD.venue.stats.infield) || [];
    const n0 = myCols.length;
    for (let i = 1; i < inf.length; i++) {
      const [s, u, hl, hw] = inf[i];
      wallAlong(s - hl, s + hl, u, hw * 2, -0.3, 8, 12);
    }
    STAD.infieldCols = myCols.slice(n0);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  CBZ.onUpdate(55.5, function (dt) {
    if (!g || g.mode !== "city" || !STAD.root || !RC) return;
    const P = CBZ.player; if (!P || !P.pos) return;
    const d = Math.hypot(P.pos.x - VX, P.pos.z - VZ);
    if (STAD.built !== STAD.root) {
      if (d > BUILD_R) return;
      buildStadium();
    }
    const show = d < SHOW_R;
    STAD.shown = show;
    if (STAD.group.visible !== show) STAD.group.visible = show;
    if (!show) return;
    const rs = CBZ.speedwayRaceState ? CBZ.speedwayRaceState() : null;
    STAD.venue.update(dt, { excite: rs ? rs.excite : 0.05, flag: rs ? rs.flag : "green", leaderNumber: rs ? rs.leader : 0, camera: CBZ.camera });
    if (STAD.track.update) STAD.track.update(dt, CBZ.camera);
  });

  /* what city/speedway_race.js needs of the place: the transforms, the built
     stadium (its lights, pylon and skid marks) and the root to hang cars on */
  CBZ.speedway = {
    VX, VZ, CX, CZ, toCity, toCore, yawToCity, QUALITY, SHOW_R, spec: VENUE_SPEC, tunnel: TU,
    stadium: STAD, noSpawnZone,
    ready: function () { return !!(STAD.group && STAD.built === STAD.root); },
    distance: function (x, z) { return Math.hypot(x - VX, z - VZ); },
    /* where a grid box is in the city: the racer's origin stands you beside yours */
    gridPose: function (slot) {
      if (!RC) return null;
      const sl = RC.GRID.slot(slot), f = RC.frame(sl.s);
      const side = sl.u > 0 ? 1 : -1, u = sl.u - side * 2.3;          // beside the car, toward the middle of the track
      const p = toCity(f.x + f.nx * u, f.z + f.nz * u);
      const c = toCity(f.x + f.nx * sl.u, f.z + f.nz * sl.u);
      return { x: p.x, z: p.z, y: RC.surfaceY(sl.s, u), heading: Math.atan2(c.x - p.x, c.z - p.z) };
    },
  };

  // ====================================================================== //
  //  ON FOOT IN THE BOWL: over the fence, the fans in the seats, the house  //
  //  answering trouble                                                      //
  // ====================================================================== //
  const TOUCH = QUALITY === "low";
  const dsS = (a, b) => (RC ? RC.ds(a, b) : 0);
  function playerOnFoot() {
    const P = CBZ.player;
    return !!(P && P.pos && !P.dead && !P.driving && !P._vehicle && !P._aircraft);
  }

  /* ---- THE CATCH FENCE IS CLIMBED (systems/climb.js, an `over` climb).
     A chain-link fence is a ladder everywhere along it, so the climb is
     laid where you stand: within reach of the fence, the three ways over it
     are (re)registered at your s — from the track (up the SAFER wall and
     the fence, over the top rail, down into the front row), and back from
     the front row or the walkway behind the fence (over, down onto the
     banking). They move with you and go when you walk away. */
  const FENCE = { L: [], s: null, t: 0 };
  function fenceDrop() {
    if (!CBZ.climb) return;
    for (const L of FENCE.L) if (!L.climber) CBZ.climb.remove(L);
    FENCE.L = FENCE.L.filter((L) => L.climber);
    if (!FENCE.L.length) FENCE.s = null;
  }
  function fenceLay(s) {
    const f = RC.frame(s), sec = {};
    KIT.standSection(RC, s, sec);
    const yTop = RC.surfaceY(s, D.WALL_U) + D.WALL_H + D.FENCE_H;
    const at = (u, o) => toCity(f.x + f.nx * u, f.z + f.nz * u, o || {});
    // a core direction is the opposite city direction (city = V - core)
    const toTrack = { x: f.nx, z: f.nz }, toStands = { x: -f.nx, z: -f.nz };
    const rowLand = at(STAND.U0 + 0.45), trackLand = at(D.WALL_U - 1.1);
    const tag = "bullring-fence";
    const add = (spec) => { const L = CBZ.climb.add(Object.assign({ tag, name: "catch fence", mode: "city" }, spec)); if (L) FENCE.L.push(L); };
    // from the track
    const a = at(D.WALL_U);
    add({ x: a.x, z: a.z, nx: toTrack.x, nz: toTrack.z, y0: RC.surfaceY(s, D.WALL_U - 0.42), y1: yTop,
      over: { x: rowLand.x, y: sec.y0, z: rowLand.z } });
    // from the front row, and from the walkway behind the fence
    const b = at(D.WALL_U + 0.5);
    const rowFoot = at(STAND.U0 + 0.4), walkFoot = at(D.WALL_U + D.WALL_T + 0.5);
    add({ x: b.x, z: b.z, nx: toStands.x, nz: toStands.z, y0: sec.y0, y1: yTop, bottom: { x: rowFoot.x, z: rowFoot.z },
      over: { x: trackLand.x, y: RC.surfaceY(s, D.WALL_U - 1.1), z: trackLand.z } });
    add({ x: b.x, z: b.z, nx: toStands.x, nz: toStands.z, y0: sec.wallTop, y1: yTop, bottom: { x: walkFoot.x, z: walkFoot.z },
      over: { x: trackLand.x, y: RC.surfaceY(s, D.WALL_U - 1.1), z: trackLand.z } });
    FENCE.s = s;
  }
  function fenceTick(dt) {
    if (!CBZ.climb || !STAND) return;
    FENCE.t -= dt;
    if (FENCE.t > 0) return;
    FENCE.t = 0.12;
    if (CBZ.climb.playerOn()) return;                 // never move a fence out from under a climber
    const P = CBZ.player;
    const n = playerOnFoot() && STAD.shown ? bowlAt(P.pos.x, P.pos.z) : null;
    const near = n && n.u > D.WALL_U - 2.2 && n.u < STAND.U0 + 2.2;
    if (!near) { if (FENCE.L.length) fenceDrop(); return; }
    if (FENCE.s != null && Math.abs(dsS(FENCE.s, n.s)) < 0.5) return;
    fenceDrop();
    fenceLay(n.s);
  }

  /* ---- THE FANS NEAR YOU ARE PEOPLE. Every seat is a row of the one crowd
     store, drawn on the GPU (race_venue.js). The ones within reach become
     full rigs (CBZ.cityPostNpc, dressed in that row's own colours, in that
     seat: npcLife holds a seated body on the cushion) and the row is hidden;
     walk away and an undisturbed fan sits back down into the crowd. A fan
     who is hit, scared or who sees trouble gets up and the shared brain has
     him (flee, fight, film: CBZ.cityScare). A fan who dies is the crowd's
     count (crowdstore noteDead). */
  const FANS = { list: [], bySeat: new Map(), grid: null, t: 0, seats: null, made: 0 };
  const FAN_R = TOUCH ? 11 : 15, FAN_MAX = TOUCH ? 7 : 14, FAN_KEEP = FAN_R + 9;
  const FAN_JOBS = ["electrician", "teacher", "mechanic", "nurse", "truck driver", "plumber", "office worker", "student", "retiree", "welder", "cook", "farmer"];
  function fanGrid(seats) {
    // a 6 m bucket grid over the seats, in CITY coordinates
    const G = new Map(), C = 6;
    for (let i = 0; i < seats.n; i++) {
      const x = VX - seats.x[i], z = VZ - seats.z[i];
      const k = Math.floor(x / C) + "," + Math.floor(z / C);
      let b = G.get(k); if (!b) G.set(k, (b = [])); b.push(i);
    }
    return { G, C };
  }
  function fanRelease(rec, back) {
    const ST = CBZ.crowds, ped = rec.ped;
    FANS.bySeat.delete(rec.i);
    if (ped && !ped.dead && CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(ped); } catch (e) {} }
    if (back && ST && rec.r >= 0 && ST.life(rec.r) === ST.ALIVE) {
      ST.S.hide[rec.r] = 0;
      const G = FANS.seats && FANS.seats.group(); if (G) G.markDirty();
    }
  }
  function fanMake(i) {
    const seats = FANS.seats, ST = CBZ.crowds, CG = CBZ.crowdGPU;
    const r = seats.row(i);
    if (r < 0 || !ST || ST.life(r) !== ST.ALIVE || ST.S.hide[r]) return false;
    const x = VX - seats.x[i], z = VZ - seats.z[i], y = seats.y[i], yaw = yawToCity(seats.yaw[i]);
    const look = seats.look[i];
    const lo = CG && look >= 0 && CG.rigOpts ? CG.rigOpts(look) : {};
    let ped = null;
    try {
      ped = CBZ.cityPostNpc(x, z, Object.assign({
        job: FAN_JOBS[(i * 7 + 3) % FAN_JOBS.length], kind: "civilian", archetype: "resident",
        aggr: 0.2 + ((i * 37) % 100) / 100 * 0.6, wealth: 0.3 + ((i * 13) % 40) / 100,
        face: yaw, armed: false, src: "speedway:fan",
      }, lo));
    } catch (e) { ped = null; }
    if (!ped) return false;
    if (ped.char && CG && look >= 0 && CG.dressRig) { try { CG.dressRig(ped.char, look); } catch (e) {} }
    if (CBZ.citySetAttending) CBZ.citySetAttending(ped, "the races", "The Bullring");
    ped._speedwayFan = true;
    const seated = !seats.stand[i];
    if (seated && CBZ.npcLife && CBZ.npcLife.attach) {
      // the seat's cushion is the row's root (+0.45 over the tread): the chair solve folds him into it
      CBZ.npcLife.attach(ped, STAD.root || (CBZ.city && CBZ.city.arena && CBZ.city.arena.root), {
        x, y, z, yaw, pose: "sit", state: "sit", cushionH: 0.45, floorBelow: 0.45,
      });
    } else {
      ped.pos.y = y;
      ped.staffPost = { x, z, face: yaw };           // a standing fan holds his place on the row
      ped.state = "idle"; ped.speed = 0;
    }
    ST.S.hide[r] = 1;
    const G = seats.group(); if (G) G.markDirty();
    const rec = { i, r, ped, hp0: ped.hp, loose: false, seated };
    FANS.list.push(rec); FANS.bySeat.set(i, rec);
    FANS.made++;
    return true;
  }
  /* trouble reaches him: out of the seat, and the brain decides */
  function fanRouse(rec, threat) {
    const ped = rec.ped;
    rec.loose = true;
    ped.staffPost = null;
    if (ped._npcAttached && CBZ.cityUnseat) { try { CBZ.cityUnseat(ped, { state: "walk" }); } catch (e) {} }
    else if (ped._npcAttached && CBZ.npcLife && CBZ.npcLife.detach) { try { CBZ.npcLife.detach(ped, { state: "walk" }); } catch (e) {} }
    if (ped.dead || ped.ko > 0) return;
    if (ped.rage) { ped.state = "fight"; return; }
    if (CBZ.cityScare) { try { CBZ.cityScare(ped, threat || (CBZ.city && CBZ.city.playerActor), { bias: 0.1 }); } catch (e) {} }
  }
  function fansTick(dt) {
    FANS.t -= dt;
    if (FANS.t > 0) return;
    FANS.t = 0.25;
    const seats = STAD.venue && STAD.venue.seats;
    if (seats !== FANS.seats) {                         // a rebuilt bowl: the old fans go with it
      for (const rec of FANS.list) fanRelease(rec, false);
      FANS.list.length = 0; FANS.bySeat.clear();
      FANS.seats = seats || null; FANS.grid = seats ? fanGrid(seats) : null;
    }
    if (!seats || !CBZ.cityPostNpc || !CBZ.crowds) return;
    // on foot only: from a car at racing speed the front rows would be made
    // and given back every lap for nobody
    const P = CBZ.player, here = !!(P && P.pos && STAD.shown && g.mode === "city" && playerOnFoot());
    const px = here ? P.pos.x : 1e9, pz = here ? P.pos.z : 1e9, py = here ? P.pos.y : 0;
    const ST = CBZ.crowds, pa = CBZ.city && CBZ.city.playerActor;
    // the ones we have
    for (let k = FANS.list.length - 1; k >= 0; k--) {
      const rec = FANS.list[k], ped = rec.ped;
      const d = Math.hypot(ped.pos.x - px, ped.pos.z - pz);
      if (ped.dead) {
        // his body is the rig's; the count is the crowd's
        if (rec.r >= 0) { try { ST.noteDead(rec.r, "violence", {}); } catch (e) {} }
        FANS.bySeat.delete(rec.i); FANS.list.splice(k, 1);
        continue;
      }
      if (!rec.loose) {
        const hurt = ped.hp < rec.hp0 || ped.ko > 0 || !!ped.rage;
        const shaken = (ped.alarmed || 0) > 2.5 || (ped.fear || 0) > 3 || ped.state === "flee" || ped.state === "fight";
        if (hurt || shaken) fanRouse(rec, pa);
      }
      if (rec.loose ? d > 70 : d > FAN_KEEP) { fanRelease(rec, !rec.loose); FANS.list.splice(k, 1); }
    }
    if (!here || CBZ.citySpawnDraining) return;
    // the nearest seats within reach, two new rigs a tick
    const live = FANS.list.reduce((n, r) => n + (r.loose ? 0 : 1), 0);
    if (live >= FAN_MAX) return;
    const { G, C } = FANS.grid, cx = Math.floor(px / C), cz = Math.floor(pz / C), R = Math.ceil(FAN_R / C);
    const cand = [];
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      const bucket = G.get((cx + a) + "," + (cz + b)); if (!bucket) continue;
      for (const i of bucket) {
        if (FANS.bySeat.has(i)) continue;
        const dx = VX - seats.x[i] - px, dz = VZ - seats.z[i] - pz, dy = seats.y[i] - py;
        const d2 = dx * dx + dz * dz;
        if (d2 > FAN_R * FAN_R || Math.abs(dy) > 9) continue;
        cand.push([i, d2]);
      }
    }
    cand.sort((p, q) => p[1] - q[1]);
    let made = 0;
    for (let k = 0; k < cand.length && made < 2 && live + made < FAN_MAX; k++) if (fanMake(cand[k][0])) made++;
  }

  /* ---- THE HOUSE ANSWERS. Every crime the city hears of (CBZ.cityCrime, the
     one crime bus) that happens in the bowl is the Bullring's: the news has
     it by the venue's name, and the track's own security comes for whoever
     did it, out of the nearest stairs (the wanted level and the police are
     the crime bus's own, as anywhere). */
  const HOUSE = { guards: [], newsT: {}, sendT: 0 };
  const GUARD_MAX = TOUCH ? 3 : 5;
  function headlineFor(type, onTrack) {
    if (/murder|cop-kill/.test(type)) return onTrack ? ["Man killed on the track at the Bullring", "Police say the race was running"] : ["Spectator killed at the Bullring", "A fan died in the stands"];
    if (/vehicular|reckless/.test(type)) return ["Car hits a man on the Bullring track", "The caution came out"];
    if (/shots|brandish|armed/.test(type)) return ["Shots fired at the Bullring", "Fans ran for the exits"];
    if (/assault|gang/.test(type)) return onTrack ? ["Fight on the track at the Bullring", "The race was under caution"] : ["Fan attacks spectators at the Bullring", "Security moved in on the stands"];
    if (/bomb|explos|terror/.test(type)) return ["Blast at the Bullring", "The stands were packed"];
    return ["Trouble at the Bullring", ""];
  }
  function guardsLive() {
    HOUSE.guards = HOUSE.guards.filter((p) => p && !p.dead && p.group && p.group.parent);
    return HOUSE.guards.length;
  }
  /* a guard comes out of the stands' stairs 14-26 m along the bowl from the
     trouble, on the same tier, where you are not looking if we can help it */
  function sendGuards(x, z, n) {
    const nn = bowlAt(x, z); if (!nn || !STAND) return 0;
    const s0 = nn.s, u = Math.max(STAND.U0 + 0.5, Math.min(nn.u, STAND.uTop - 0.5));
    const tier = u < STAND.uC0 ? 0 : 1;
    const uPost = tier ? STAND.uC0 + STAND.CROSS * 0.5 : STAND.U0 + 0.6 + ((u - STAND.U0) | 0) % 3;
    let made = 0;
    for (let k = 0; k < 6 && made < n; k++) {
      const s = s0 + (k % 2 ? 1 : -1) * (14 + (k >> 1) * 6);
      const f = RC.frame(s), uu = tier ? uPost : Math.min(u, STAND.uC0 - 0.5);
      const p = toCity(f.x + f.nx * uu, f.z + f.nz * uu);
      if (CBZ.npcTransitionSafe && k < 4 && !CBZ.npcTransitionSafe(p.x, p.z, { minDistance: 10, maxDistance: 80 })) continue;
      let ped = null;
      try {
        ped = CBZ.cityPostNpc(p.x, p.z, { job: "security guard", kind: "security", archetype: "worker", armed: false, aggr: 0.75,
          outfit: 0x1b1d22, src: "speedway:security", face: yawToCity(f.yaw) });
      } catch (e) { ped = null; }
      if (!ped) continue;
      ped.pos.y = bowlSurfaceY(p.x, p.z);
      if (CBZ.citySetAttending) CBZ.citySetAttending(ped, "working the races", "The Bullring");
      const pa = CBZ.city && CBZ.city.playerActor;
      ped.rage = pa; ped.mem = pa; ped.state = "fight"; ped.alarmed = 8;
      ped._speedwaySecurity = true;
      HOUSE.guards.push(ped);
      made++;
    }
    return made;
  }
  function houseHears(sev, info) {
    if (!info || g.mode !== "city") return;
    const P = CBZ.player;
    if (info.x == null || info.z == null) {
      // a crime with no place is the player's, where he stands
      if (!P || !P.pos) return;
      info = Object.assign({}, info, { x: P.pos.x, z: P.pos.z });
    }
    const n = bowlAt(info.x, info.z);
    if (!n || n.u >= standOuter(n.s)) return;
    const type = String(info.type || "");
    if (/^(speed|red-light|trespass|lying-to-police|dealing)$/.test(type)) return;
    const onTrack = n.u <= D.WALL_U;
    // the news, once per kind of trouble per few minutes
    const [h, sub] = headlineFor(type, onTrack);
    const now = (CBZ.now || 0) / 1000;
    if (CBZ.news && CBZ.news.push && !(HOUSE.newsT[h] > now - 240)) {
      HOUSE.newsT[h] = now;
      try { CBZ.news.push(h, { sub, cat: "Local", key: "bullring:" + h, hold: 240, kind: (sev >= 40 ? "breaking" : "story") }); } catch (e) {}
    }
    // the house's own answer: security for whoever did it (the player only: an
    // NPC's crime is the brains' and the police's business)
    if (info.byPlayer === false || sev < 10 || !playerOnFoot()) return;
    if (HOUSE.sendT > now - 6) return;
    const room = GUARD_MAX - guardsLive();
    if (room <= 0) return;
    HOUSE.sendT = now;
    sendGuards(info.x, info.z, Math.min(room, sev >= 40 ? 3 : 2));
  }
  function wrapCrime() {
    const c = CBZ.cityCrime;
    if (typeof c !== "function") return false;
    if (c._speedway) return true;
    const w = function (sev, info) {
      const r = c.apply(this, arguments);
      try { houseHears(sev, info || {}); } catch (e) {}
      return r;
    };
    for (const k in c) w[k] = c[k];
    w._speedway = true;
    CBZ.cityCrime = w;
    return true;
  }
  /* guards who lost you (or it is over) go back to the stairs */
  function houseTick(dt) {
    if (!HOUSE.guards.length) return;
    const P = CBZ.player;
    for (let k = HOUSE.guards.length - 1; k >= 0; k--) {
      const p = HOUSE.guards[k];
      if (!p || p.dead || !p.group || !p.group.parent) { HOUSE.guards.splice(k, 1); continue; }
      const d = P && P.pos ? Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z) : 1e9;
      if (d > 160 || (P && P.dead)) { if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(p); } catch (e) {} } HOUSE.guards.splice(k, 1); }
    }
  }

  CBZ.onUpdate(55.6, function (dt) {
    if (!g || g.mode !== "city" || !RC || !STAD.group) return;
    if (!CBZ.cityCrime || !CBZ.cityCrime._speedway) wrapCrime();
    try { fenceTick(dt); } catch (e) { if (!fenceTick._e) { fenceTick._e = 1; console.error("[speedway fence]", e); } }
    try { fansTick(dt); } catch (e) { if (!fansTick._e) { fansTick._e = 1; console.error("[speedway fans]", e); } }
    try { houseTick(dt); } catch (e) {}
  });
  CBZ.speedwayPeopleAudit = function () {
    return {
      fence: FENCE.L.length, fenceS: FENCE.s,
      fans: FANS.list.length, fansSeated: FANS.list.filter((r) => !r.loose).length, fansMade: FANS.made,
      guards: HOUSE.guards.length, crimeHooked: !!(CBZ.cityCrime && CBZ.cityCrime._speedway),
    };
  };
  CBZ.speedwayHouse = { hears: houseHears, sendGuards, headlineFor, fenceLay, fenceDrop };
})();
