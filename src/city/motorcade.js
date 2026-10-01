/* ============================================================
   city/motorcade.js — THE PRESIDENTIAL MOTORCADE, DRIVEN FOR REAL.

   WHAT THIS REPLACED. The old file put a chauffeur on the motor court whose
   E-card listed four destinations; you picked one, the screen went black for
   700 ms and you were standing at the other end of the country next to a car
   that had also teleported. The owner's word for that kind of thing is
   "gimmick". It is gone: no card of place names, no fade, no teleport.

   WHAT YOU SEE NOW
   ----------------
   In front of the Executive Mansion's steps a column stands on the motor
   court ring: a black advance car, a marked police cruiser, a black lead SUV,
   the STATE CAR (a darker-than-black Adler Kanzler with two small flags on
   its front fenders) and a black follow SUV. An agent in a dark suit stands
   at the state car's rear door.

   Walk up to him and he talks to you: "Car's ready, sir. Where to?" with two
   real answers (your next public appearance from the day's schedule if there
   is one, otherwise the Capitol or City Hall; and one other real place). Pick
   one and you walk to the door and get in. The column pulls out around the
   fountain, down the drive, through the gate and drives the actual road
   network to the place, in real time, with the camera riding along. Nobody
   types a coordinate: the route is the shortest path over the game's own
   road records (every road builder pushes the same axis-aligned segment onto
   city.roads; §1 turns that flat list into a graph once per world).

   On the way: police cruisers stand across the side streets at a few
   junctions with an officer or two beside each, the lights going; ambient
   traffic ahead is waved to the kerb. At the venue the column pulls up and
   stops; you get out the ordinary way. Get back in (walk to the agent again)
   and he asks where to next, and the column turns round and takes you.

   The helicopter on the Mansion helipad is still there for far trips (§10).

   THE NPC PRESIDENT RIDES THE SAME CARS. `CBZ.motorcade.run({ principal:
   ped, to })`, which the day's schedule (president_public.js) calls: the
   advance car leaves ~20 s early and the side-street police go up, he walks
   down the steps to the state car and is SEATED in its rear seat (a real,
   hittable body parented to the car, npclife's seat grammar), the column
   drives there, he gets out and walks to the spot, and after his dwell he
   walks back, rides home and walks inside. He stays the same ped the whole
   time, so a Hitman who shoots him through the glass, or blows up the car,
   has killed the President: a destroyed state car takes everyone in it with
   it through CBZ.cityKillPed(ped, imp, "explosion"). Bullets do not: the
   state car's glass is bulletproof (below), so it takes a bomb or a rocket.

   ARMOUR (the numbers). vehicles.js's damageEngine subtracts from
   `engineHp` (100 on a normal car; 0 = gutted/cook-off) after multiplying by
   max(0.55, 1 - armor * 1.25) for gunfire/blast and 1 - armor * 0.85 for a
   crash, with `armor` capped at 0.35 by that file. The state car gets
   engineHp 420 and armor 0.35: gunfire and blasts do x0.5625 of a normal
   car's damage against 4.2x the pool, so roughly 7.5x tougher than a normal
   car to guns and RPGs (about seven rockets instead of one). Escort SUVs get
   engineHp 170 and armor 0.25 (roughly 2.4x). THE GLASS IS BULLETPROOF:
   the state car is registered with CBZ.bulletproofCar (city/los.js), so no
   line of fire from outside reaches anyone seated in it (every NPC shooter
   asks clearLineOfFire first) and the player's rounds stop on the panel
   (fpsmode's findActorHit skips a rider of a bulletproof car; findCarHit
   already clamps the ray at the body). Blast and fire still kill.

   PANIC. Shots or an explosion within 45 m of the column, the state car
   taking damage, a car sitting in the road ahead for more than 3 s, or the
   principal being hit: `evacuate(reason)`. The column turns round, speeds up
   and drives the shortest road route home, and the escort shoves anything in
   its way aside. It rings CBZ.protection.alarm(x, z, reason) and emits
   presidency "security" {level:"evac"}.

   HOW IT DRIVES (read before touching §6). The column is RIGID ALONG ONE
   PATH: one arc-length `s` for the state car, every other car at s + a fixed
   offset (+38 advance while staged, +24 police, +12 lead, 0 state, -12
   follow). Speed is one scalar, capped by the tightest bend under ANY car,
   compound speed limits and the braking distance to the stop. Heading comes
   from the path tangent, ground height from vehicles.js's own parkSeat
   (order 37 re-seats a lane-less, AI-less car on the terrain every frame it
   moves). This is agency.js tickConvoy's approach, with a real route, real
   bends and a real speed profile. When the route has to go back the way it
   came, the path begins with the formation's own stretch of the old path and
   a U-turn off the lead car, so no car ever jumps.

   SEATS: city/carseats.js's one seat model, by its own ids. The agent
   driver sits in "driver", the door agent up front in "shotgun", the
   President (player or NPC) in the back on the kerb side, "rearR", which is
   where the right-hand door the detail opens actually is. seatIn() claims
   each chair in the car's occupancy map, so the player's seat shift and
   anybody else's boarding see the seat is taken.

   CARS SEAM (gaps in vehicles.js this file works around, not edits):
     - Riding works through passengerseat.js's chauffeur path: the state
       car's `npcDriver` carries `_cbzDriving`, so cityPaxChauffeured() is
       true, vehicles.js's player loop stands down and passengerseat.js seats
       the player and swings the camera. This file is the one integrator of
       the car's position (order 36.63, before passengerseat's 36.7).
     - cityEnterVehicle files a car theft for any car that is neither
       `stolen` nor `owned`; boarding your own state car flips `stolen` for
       the length of that one synchronous call.
     - No yield-to-convoy in the traffic AI: ambient cars ahead get
       `pullover = 2` (stop, no flee branch) and are slid sideways out of the
       column's lane, and cruisers park across the side streets.

   API: see §12 at the bottom (run / active / abort / evacuate / routeTo).
   Nothing runs per frame unless a column is actually moving or the
   President is walking to its door.
   LOAD: index.html, after presidency.js. Every CBZ.* read is guarded.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = (typeof window !== "undefined" && window.CBZ) || null;
  if (!CBZ) return;
  const THREE = (typeof window !== "undefined" && window.THREE) || null;
  const g = CBZ.game;

  // ---- tuning -------------------------------------------------------------
  const STATE_MODEL = "Adler Kanzler", STATE_PAINT = 0x07080b;
  const SUV_MODEL = "Bison Frontier", SUV_PAINT = 0x101216;
  const STATE_HP = 420, STATE_ARMOR = 0.35, SUV_HP = 170, SUV_ARMOR = 0.25;
  const FORM = [                                   // front to back, metres along the path
    { role: "police", off: 24 },
    { role: "lead", off: 12 },
    { role: "state", off: 0 },
    { role: "follow", off: -12 },
  ];
  const ADV_OFF = 38;                              // the advance car's staging slot
  const ADV_GAP = 10;                              // arc metres a column car keeps behind the advance car
  const RAM_HP = 12;                               // engine HP one crash must take off the state car to count as a ram
  const V_ROAD = 14, V_EVAC = 22, V_YARD = 6;      // m/s
  const LAT_N = 3.0, LAT_E = 5.5;                  // lateral grip budget (m/s^2) for bend speed
  const BRAKE_N = 3.2, BRAKE_E = 5.0, ACC_N = 2.2, ACC_E = 4.0;
  const MAX_POSTS = 3;                             // side-street police posts per trip
  const STAGE_R = 500, STAGE_DROP_R = 650;         // build / drop the parked column
  const AGENT_R = 120;                             // door agent posted inside this
  const ASK_R = 5.0, ASK_RESET_R = 9;              // walk-up talk radius
  const SHOT_R = 45, BLOCK_T = 3;                  // panic triggers
  const ADVANCE_LEAD = 20;                         // s, scheduled (NPC) runs

  // ---- small helpers ------------------------------------------------------
  function playing() { return !!(g && g.mode === "city" && g.state === "playing"); }
  function arena() { return (CBZ.city && CBZ.city.arena) || null; }
  function arenaRoot() { const A = arena(); return (A && A.root) || null; }
  function floorY(x, z) { try { return CBZ.floorAt ? (+CBZ.floorAt(x, z) || 0) : 0; } catch (e) { return 0; } }
  function carGround(x, z) { try { if (CBZ.cityCarGroundY) { const y = +CBZ.cityCarGroundY(x, z); if (isFinite(y)) return y; } } catch (e) {} return floorY(x, z); }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrapA(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; }
  function lerpAng(a, b, t) { return a + wrapA(b - a) * t; }
  let SIMT = 0;                                    // engine-clock seconds (stepSim-safe)

  let presCache = null, presT = -1;
  function presidentNow() {
    if (presCache && SIMT - presT < 0.5 && presT >= 0) return presCache;
    presT = SIMT; presCache = presidentRead();
    return presCache;
  }
  function presidentRead() {
    const P = CBZ.presidency;
    if (P && typeof P.current === "function") { try { const c = P.current(); if (c) return c; } catch (e) {} }
    if (P && typeof P.seat === "function") { try { if (P.seat()) return { kind: "player", ped: CBZ.player }; } catch (e) {} }
    return { kind: "vacant", ped: null };
  }
  function playerPresident() { return presidentNow().kind === "player"; }
  function emit(evt, payload) {
    const P = CBZ.presidency;
    if (P && typeof P.emit === "function") { try { P.emit(evt, payload); } catch (e) {} }
  }
  function govSite(id) {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) { const s = L[i]; if (s && s.id === id && s.rect && s.gate) return s; }
    return null;
  }
  function mansion() { return govSite("execmansion"); }
  function camPos() { return (CBZ.camera && CBZ.camera.position) || (CBZ.player && CBZ.player.pos) || null; }
  // somewhere a body or a car can appear/vanish without the player watching
  function unseen(x, z) {
    const c = camPos(); if (!c) return true;
    const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
    if (d > 95) return true;
    if (d < 30) return false;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    // the camera looks along (-sin yaw, -cos yaw) in this engine
    return (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / d < -0.2;
  }

  /* ============================================================
     §1  THE ROAD GRAPH — the flat city.roads list, asked a routing question.
     Every record is axis-aligned {x, z, vertical, len, w}. Nodes are segment
     ends, crossings of a vertical with a horizontal (within half a road width
     of each other's ends, so T-junctions meet), and the projection of any end
     that stops within a road-width of another segment (causeway docks, spurs).
     Edges run between consecutive nodes along each segment. Pure: no rng, no
     THREE, deterministic per road list. Built once per world (keyed on the
     list and its length) — a few ms on thousands of segments.
     ============================================================ */
  const CELL = 64;
  function ckey(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }
  function segCost(r) {
    if (r.access === "service") return 2.5;            // other compounds' private spurs
    if (r.district === "highway") return 0.85;         // a motorcade takes the fast road
    return 1;
  }
  function buildGraph(roads) {
    const segs = [];
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (!r || !isFinite(r.x) || !isFinite(r.z) || !(r.len > 1)) continue;
      const v = !!r.vertical, m = v ? r.z : r.x;
      segs.push({ r: r, v: v, c: v ? r.x : r.z, lo: m - r.len / 2, hi: m + r.len / 2,
        hw: Math.max(2, (r.w != null ? +r.w : 18) / 2), cost: segCost(r), st: [] });
    }
    const nx = [], nz = [], adj = [];
    function node(x, z) { nx.push(x); nz.push(z); adj.push([]); return nx.length - 1; }
    function edge(a, b, w, si) { adj[a].push(b, w, si); adj[b].push(a, w, si); }
    function pt(sg, t) { return sg.v ? { x: sg.c, z: t } : { x: t, z: sg.c }; }
    function cells(sg, pad, fn) {
      const x0 = sg.v ? sg.c - sg.hw - pad : sg.lo - pad, x1 = sg.v ? sg.c + sg.hw + pad : sg.hi + pad;
      const z0 = sg.v ? sg.lo - pad : sg.c - sg.hw - pad, z1 = sg.v ? sg.hi + pad : sg.c + sg.hw + pad;
      const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
      const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) fn(ckey(cx, cz));
    }
    const grid = new Map();
    for (let i = 0; i < segs.length; i++) {
      cells(segs[i], 4, function (k) { let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i); });
    }
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i], a = pt(sg, sg.lo), b = pt(sg, sg.hi);
      sg.na = node(a.x, a.z); sg.nb = node(b.x, b.z);
      sg.st.push({ t: sg.lo, n: sg.na }, { t: sg.hi, n: sg.nb });
    }
    // crossings (vertical x horizontal)
    const mark = new Int32Array(segs.length).fill(-1);
    for (let i = 0; i < segs.length; i++) {
      const V = segs[i]; if (!V.v) continue;
      cells(V, 4, function (k) {
        const a = grid.get(k); if (!a) return;
        for (let q = 0; q < a.length; q++) {
          const j = a[q]; if (mark[j] === i) continue; mark[j] = i;
          const H = segs[j]; if (H.v) continue;
          if (V.c < H.lo - V.hw - 2 || V.c > H.hi + V.hw + 2) continue;
          if (H.c < V.lo - H.hw - 2 || H.c > V.hi + H.hw + 2) continue;
          const n = node(V.c, H.c);
          V.st.push({ t: H.c, n: n }); H.st.push({ t: V.c, n: n });
        }
      });
    }
    // loose ends: an end within a road width of another segment docks onto it
    const stamp = new Int32Array(segs.length).fill(-1);
    let sid = 0;
    for (let i = 0; i < segs.length; i++) {
      const A = segs[i];
      for (let e = 0; e < 2; e++) {
        const t = e ? A.hi : A.lo, n = e ? A.nb : A.na, p = pt(A, t);
        const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
        sid++;
        for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
          const a = grid.get(ckey(cx + ox, cz + oz)); if (!a) continue;
          for (let q = 0; q < a.length; q++) {
            const j = a[q]; if (j === i || stamp[j] === sid) continue; stamp[j] = sid;
            const B = segs[j];
            const tb = clamp(B.v ? p.z : p.x, B.lo, B.hi), qp = pt(B, tb);
            const d = d2(p.x, p.z, qp.x, qp.z);
            if (d > Math.max(6, B.hw + 2)) continue;
            const m = node(qp.x, qp.z);
            B.st.push({ t: tb, n: m });
            edge(n, m, Math.max(0.01, d), -1);
          }
        }
      }
    }
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i], st = sg.st;
      st.sort(function (a, b) { return a.t - b.t || a.n - b.n; });
      for (let k = 0; k + 1 < st.length; k++) edge(st[k].n, st[k + 1].n, Math.max(0.001, (st[k + 1].t - st[k].t) * sg.cost), i);
    }
    return { segs: segs, nx: nx, nz: nz, adj: adj, grid: grid, pt: pt };
  }

  function snapTo(G, x, z) {
    let best = null, bd = Infinity;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const seen = new Set();
    function test(i) {
      if (seen.has(i)) return; seen.add(i);
      const sg = G.segs[i];
      const t = clamp(sg.v ? z : x, sg.lo, sg.hi), p = G.pt(sg, t);
      const d = d2(x, z, p.x, p.z) * (sg.r.access === "service" ? 1.6 : 1);
      if (d < bd) { bd = d; best = { si: i, t: t, x: p.x, z: p.z, d: d }; }
    }
    const RINGS = [1, 3, 8, 20];
    for (let r = 0; r < RINGS.length; r++) {
      const R = RINGS[r];
      for (let ox = -R; ox <= R; ox++) for (let oz = -R; oz <= R; oz++) {
        const a = G.grid.get(ckey(cx + ox, cz + oz)); if (!a) continue;
        for (let q = 0; q < a.length; q++) test(a[q]);
      }
      if (best && bd <= R * CELL) return best;
    }
    for (let i = 0; i < G.segs.length; i++) test(i);
    return best;
  }

  // Dijkstra from a snapped point to a snapped point. Returns the point chain
  // (start, nodes..., end), the segment of each leg (-1 = a dock connector)
  // and the junction nodes passed (degree >= 3).
  function routeNodes(G, from, to) {
    const A = snapTo(G, from.x, from.z), B = snapTo(G, to.x, to.z);
    if (!A || !B) return null;
    const N = G.nx.length;
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), pseg = new Int32Array(N).fill(-2);
    const hk = [], hn = [];
    function push(k, n) {
      let i = hk.length; hk.push(k); hn.push(n);
      while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; let t = hk[p]; hk[p] = hk[i]; hk[i] = t; t = hn[p]; hn[p] = hn[i]; hn[i] = t; i = p; }
    }
    function pop() {
      const n = hn[0], lk = hk.pop(), ln = hn.pop();
      if (hk.length) {
        hk[0] = lk; hn[0] = ln; let i = 0;
        for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r; if (m === i) break; let t = hk[m]; hk[m] = hk[i]; hk[i] = t; t = hn[m]; hn[m] = hn[i]; hn[i] = t; i = m; }
      }
      return n;
    }
    function bracket(sn) {
      const sg = G.segs[sn.si], st = sg.st;
      let lo = st[0], hi = st[st.length - 1];
      for (let k = 0; k < st.length; k++) {
        if (st[k].t <= sn.t + 1e-6) lo = st[k];
        if (st[k].t >= sn.t - 1e-6) { hi = st[k]; break; }
      }
      return [{ n: lo.n, c: Math.abs(sn.t - lo.t) * sg.cost }, { n: hi.n, c: Math.abs(hi.t - sn.t) * sg.cost }];
    }
    const srcs = bracket(A), dsts = bracket(B);
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i];
      if (s.c < dist[s.n]) { dist[s.n] = s.c; prev[s.n] = -1; pseg[s.n] = A.si; push(s.c, s.n); }
    }
    let best = Infinity, bestN = -1;
    if (A.si === B.si) best = Math.abs(A.t - B.t) * G.segs[A.si].cost;
    const tgt = new Map();
    for (let i = 0; i < dsts.length; i++) { const o = tgt.get(dsts[i].n); if (o == null || dsts[i].c < o) tgt.set(dsts[i].n, dsts[i].c); }
    const done = new Uint8Array(N);
    while (hk.length) {
      const k = hk[0], n = pop();
      if (done[n]) continue; done[n] = 1;
      if (k >= best) break;
      const tc = tgt.get(n);
      if (tc != null && k + tc < best) { best = k + tc; bestN = n; }
      const a = G.adj[n];
      for (let q = 0; q < a.length; q += 3) {
        const m = a[q], w = a[q + 1], nk = k + w;
        if (nk < dist[m]) { dist[m] = nk; prev[m] = n; pseg[m] = a[q + 2]; push(nk, m); }
      }
    }
    const pts = [{ x: A.x, z: A.z }], legs = [], junctions = [];
    if (bestN < 0) {
      pts.push({ x: B.x, z: B.z }); legs.push(A.si === B.si ? A.si : -1);
      return { pts: pts, legs: legs, junctions: junctions, from: A, to: B };
    }
    const chain = [];
    for (let n = bestN; n >= 0; n = prev[n]) chain.push(n);
    chain.reverse();
    for (let i = 0; i < chain.length; i++) {
      const n = chain[i];
      pts.push({ x: G.nx[n], z: G.nz[n] });
      legs.push(i === 0 ? A.si : pseg[n]);
      if (G.adj[n].length >= 9) junctions.push({ x: G.nx[n], z: G.nz[n] });
    }
    pts.push({ x: B.x, z: B.z }); legs.push(B.si);
    return { pts: pts, legs: legs, junctions: junctions, from: A, to: B };
  }

  // the drivable lane polyline for a node chain: each axis leg shifted onto
  // the innermost lane for its direction (the same roadLaneCenter traffic
  // uses), corners where a vertical leg meets a horizontal one.
  function laneOff(r, dir) {
    if (CBZ.roadLaneCenter) { try { const o = +CBZ.roadLaneCenter(r, dir, 0); if (isFinite(o)) return o; } catch (e) {} }
    return CBZ.roadLaneSide(r, dir) * 2.1;
  }
  function lanePolyline(G, R) {
    const legs = [];
    for (let i = 0; i + 1 < R.pts.length; i++) {
      const a = R.pts[i], b = R.pts[i + 1];
      if (d2(a.x, a.z, b.x, b.z) < 0.3) continue;
      const si = R.legs[i], sg = si >= 0 ? G.segs[si] : null;
      let A = { x: a.x, z: a.z }, B = { x: b.x, z: b.z }, axis = null, dir = 0;
      if (sg && (sg.v ? Math.abs(b.x - a.x) < 0.5 : Math.abs(b.z - a.z) < 0.5)) {
        dir = sg.v ? Math.sign(b.z - a.z) : Math.sign(b.x - a.x);
        const o = laneOff(sg.r, dir);
        if (sg.v) { A.x += o; B.x += o; } else { A.z += o; B.z += o; }
        axis = sg.v;
      }
      const L = legs[legs.length - 1];
      if (L && L.si === si && si >= 0 && L.dir === dir && L.axis === axis) { L.b = B; continue; }
      legs.push({ a: A, b: B, si: si, axis: axis, dir: dir, hw: sg ? sg.r.district === "highway" : false });
    }
    if (!legs.length) return { pts: R.pts.slice(), radii: R.pts.map(function () { return 10; }) };
    const pts = [legs[0].a], radii = [0];
    for (let i = 0; i + 1 < legs.length; i++) {
      const A = legs[i], B = legs[i + 1];
      if (A.axis != null && B.axis != null && A.axis !== B.axis) {
        pts.push(A.axis ? { x: A.a.x, z: B.a.z } : { x: B.a.x, z: A.a.z });
        radii.push(A.hw && B.hw ? 45 : 11);
      } else {
        pts.push(A.b); radii.push(5);
        pts.push(B.a); radii.push(5);
      }
    }
    pts.push(legs[legs.length - 1].b); radii.push(0);
    // drop near-duplicates (keep the larger radius)
    const op = [pts[0]], orad = [radii[0]];
    for (let i = 1; i < pts.length; i++) {
      const q = op[op.length - 1];
      if (d2(q.x, q.z, pts[i].x, pts[i].z) < 0.6) { orad[orad.length - 1] = Math.max(orad[orad.length - 1], radii[i]); continue; }
      op.push(pts[i]); orad.push(radii[i]);
    }
    return { pts: op, radii: orad };
  }

  const GRAPH = { roads: null, n: -1, G: null };
  function graph() {
    const c = CBZ.city; if (!c) return null;
    const A = c.arena && c.arena.roads ? c.arena : c;
    const roads = A.roads;
    if (!Array.isArray(roads) || !roads.length) return null;
    if (GRAPH.G && GRAPH.roads === roads && GRAPH.n === roads.length) return GRAPH.G;
    let G = null;
    try { G = buildGraph(roads); } catch (e) { G = null; if (window.console) console.error("[motorcade] road graph", e); }
    GRAPH.roads = roads; GRAPH.n = roads.length; GRAPH.G = G;
    ROUTE_CACHE.clear();
    return G;
  }
  const ROUTE_CACHE = new Map();
  // the road part of a trip: lane polyline + per-vertex fillet radius + junctions
  function roadRoute(from, to) {
    const G = graph();
    const key = Math.round(from.x) + "," + Math.round(from.z) + ">" + Math.round(to.x) + "," + Math.round(to.z);
    if (ROUTE_CACHE.has(key)) return ROUTE_CACHE.get(key);
    let out = null;
    if (G) {
      let R = null;
      try { R = routeNodes(G, from, to); } catch (e) { R = null; }
      if (R) { const L = lanePolyline(G, R); out = { pts: L.pts, radii: L.radii, junctions: R.junctions }; }
    }
    if (!out) out = { pts: [{ x: from.x, z: from.z }, { x: to.x, z: to.z }], radii: [0, 0], junctions: [] };
    if (ROUTE_CACHE.size > 48) ROUTE_CACHE.clear();
    ROUTE_CACHE.set(key, out);
    return out;
  }

  /* ============================================================
     §2  THE DRIVE PATH — fillet the corners, measure it, and know how fast
     every metre of it can be taken.
     ============================================================ */
  function makePath(pts, radii, zones) {
    // fillet: each corner becomes a sampled quadratic arc of its radius,
    // never eating more than 48 % of either leg
    const fx = [], fz = [];
    function add(x, z) {
      const n = fx.length;
      if (n && Math.abs(fx[n - 1] - x) < 0.05 && Math.abs(fz[n - 1] - z) < 0.05) return;
      fx.push(x); fz.push(z);
    }
    add(pts[0].x, pts[0].z);
    for (let i = 1; i + 1 < pts.length; i++) {
      const A = pts[i - 1], B = pts[i], C = pts[i + 1];
      const l1 = d2(A.x, A.z, B.x, B.z), l2 = d2(B.x, B.z, C.x, C.z);
      if (l1 < 0.01 || l2 < 0.01) { add(B.x, B.z); continue; }
      const u1x = (B.x - A.x) / l1, u1z = (B.z - A.z) / l1, u2x = (C.x - B.x) / l2, u2z = (C.z - B.z) / l2;
      const dot = clamp(u1x * u2x + u1z * u2z, -1, 1), th = Math.acos(dot);
      const R = (radii && radii[i]) || 0;
      if (th < 0.02 || th > 2.9 || R <= 0) { add(B.x, B.z); continue; }
      let T = R * Math.tan(th / 2);
      T = Math.min(T, l1 * 0.48, l2 * 0.48);
      const p1x = B.x - u1x * T, p1z = B.z - u1z * T, p2x = B.x + u2x * T, p2z = B.z + u2z * T;
      const Reff = T / Math.tan(th / 2);
      const m = Math.max(2, Math.ceil(th * Reff / 1.5));
      for (let k = 0; k <= m; k++) {
        const t = k / m, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
        add(a * p1x + b * B.x + c * p2x, a * p1z + b * B.z + c * p2z);
      }
    }
    const last = pts[pts.length - 1]; add(last.x, last.z);
    // densify long straights to <= 8 m so zone limits and braking curves are
    // sampled along them, not just at their ends
    for (let i = fx.length - 1; i > 0; i--) {
      const L = d2(fx[i], fz[i], fx[i - 1], fz[i - 1]);
      if (L <= 8) continue;
      const m = Math.ceil(L / 8), ins = [], inz = [];
      for (let k = 1; k < m; k++) { ins.push(fx[i - 1] + (fx[i] - fx[i - 1]) * k / m); inz.push(fz[i - 1] + (fz[i] - fz[i - 1]) * k / m); }
      fx.splice.apply(fx, [i, 0].concat(ins)); fz.splice.apply(fz, [i, 0].concat(inz));
    }
    const n = fx.length, s = new Float64Array(n), hv = new Float64Array(n), k = new Float64Array(n);
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + d2(fx[i], fz[i], fx[i - 1], fz[i - 1]);
    const hs = [];
    for (let i = 0; i + 1 < n; i++) hs.push(Math.atan2(fx[i + 1] - fx[i], fz[i + 1] - fz[i]));
    if (!hs.length) hs.push(0);
    for (let i = 0; i < n; i++) {
      const a = hs[Math.max(0, i - 1)], b = hs[Math.min(hs.length - 1, i)];
      hv[i] = i === 0 ? hs[0] : i === n - 1 ? hs[hs.length - 1] : lerpAng(a, b, 0.5);
      if (i > 0 && i < n - 1) {
        const ds = Math.max(0.3, (s[i + 1] - s[i - 1]) / 2);
        k[i] = Math.abs(wrapA(b - a)) / ds;
      }
    }
    // zone caps (compounds): any vertex inside a slow rect
    const zc = new Float64Array(n).fill(Infinity);
    if (zones) for (let i = 0; i < n; i++) for (let q = 0; q < zones.length; q++) {
      const Z = zones[q];
      if (fx[i] >= Z.minX && fx[i] <= Z.maxX && fz[i] >= Z.minZ && fz[i] <= Z.maxZ) zc[i] = Math.min(zc[i], Z.v);
    }
    function caps(vmax, lat, brake, zoneMul) {
      const c = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let v = vmax;
        if (k[i] > 1e-4) v = Math.min(v, Math.sqrt(lat / k[i]));
        if (zc[i] < Infinity) v = Math.min(v, zc[i] * zoneMul);
        c[i] = Math.max(2.5, v);
      }
      for (let i = n - 2; i >= 0; i--) c[i] = Math.min(c[i], Math.sqrt(c[i + 1] * c[i + 1] + 2 * brake * (s[i + 1] - s[i])));
      return c;
    }
    return {
      x: fx, z: fz, s: s, h: hv, n: n, len: s[n - 1],
      capN: caps(V_ROAD, LAT_N, BRAKE_N, 1), capE: caps(V_EVAC, LAT_E, BRAKE_E, 1.5),
    };
  }
  function segIdx(P, s) {
    let lo = 0, hi = P.n - 1;
    if (s <= 0) return 0;
    if (s >= P.len) return Math.max(0, P.n - 2);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.s[m] <= s) lo = m; else hi = m; }
    return lo;
  }
  // position + heading at arc length s (extrapolated straight past either end)
  function pathAt(P, s) {
    if (P.n < 2) return { x: P.x[0], z: P.z[0], h: P.h[0] || 0 };
    const i = segIdx(P, s), j = i + 1;
    const L = P.s[j] - P.s[i] || 1e-6;
    const f = (s - P.s[i]) / L;
    const x = P.x[i] + (P.x[j] - P.x[i]) * f, z = P.z[i] + (P.z[j] - P.z[i]) * f;
    const h = (f <= 0 || f >= 1) ? Math.atan2(P.x[j] - P.x[i], P.z[j] - P.z[i]) : lerpAng(P.h[i], P.h[j], f);
    return { x: x, z: z, h: h };
  }
  function capAt(P, s, panic) {
    const c = panic ? P.capE : P.capN;
    if (s <= 0) return c[0];
    if (s >= P.len) return c[P.n - 1];
    // v^2 is linear in s under constant braking, so interpolate the square
    const i = segIdx(P, s), L = P.s[i + 1] - P.s[i] || 1e-6, f = clamp((s - P.s[i]) / L, 0, 1);
    return Math.sqrt(c[i] * c[i] + (c[i + 1] * c[i + 1] - c[i] * c[i]) * f);
  }
  // nearest arc length to a point (optionally within [s0, s1])
  function projectS(P, x, z, s0, s1) {
    let best = 0, bd = Infinity;
    const a = s0 == null ? 0 : s0, b = s1 == null ? P.len : s1;
    for (let i = 0; i + 1 < P.n; i++) {
      if (P.s[i + 1] < a || P.s[i] > b) continue;
      const ax = P.x[i], az = P.z[i], bx = P.x[i + 1], bz = P.z[i + 1];
      const L2 = (bx - ax) * (bx - ax) + (bz - az) * (bz - az) || 1e-9;
      const t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2, 0, 1);
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const d = d2(x, z, px, pz);
      if (d < bd) { bd = d; best = P.s[i] + t * (P.s[i + 1] - P.s[i]); }
    }
    return best;
  }
  // the points of P between two arc lengths (used to keep the formation on
  // the old path while a new route is appended ahead of it)
  function pathSlice(P, s0, s1) {
    const out = [], rad = [];
    const a = pathAt(P, s0); out.push({ x: a.x, z: a.z }); rad.push(0);
    for (let i = 0; i < P.n; i++) if (P.s[i] > s0 + 0.2 && P.s[i] < s1 - 0.2) { out.push({ x: P.x[i], z: P.z[i] }); rad.push(0); }
    const b = pathAt(P, s1); out.push({ x: b.x, z: b.z }); rad.push(0);
    return { pts: out, radii: rad };
  }

  /* ============================================================
     §3  THE MANSION'S MOTOR COURT, from govcomplex.js's own layout
     (site-local): perron from cz-17 out to cz-8, a 34 m paved ring round a
     fountain at (cx, cz+18) whose collider is 8.2 m square, the drive down
     to the gate at rect.maxZ, the gatehouse booth at cx-8. The column turns
     one way round the fountain: it ARRIVES up the drive on x = -2.5, round the
     east side to the foot of the steps heading west (so the rear door the
     President uses faces the house), and LEAVES round the west side and down
     the drive on x = +2.5 — each lane on the approach road's matching lane.
     ============================================================ */
  const DOOR_L = { x: 0, z: -4.5 };
  function courtPoints(site, kind) {
    const cx = site.cx, cz = site.cz, G = site.gate.z - cz, gx = site.gate.x - cx;
    const W = function (x, z) { return { x: cx + x, z: cz + z }; };
    const ring = [[22, 28], [24, 8], [14, -3.5], [DOOR_L.x, DOOR_L.z], [-14, -3.5], [-24, 8], [-22, 28]];
    let L;
    if (Math.abs(site.gate.z - site.rect.maxZ) > 2 || G < 60) {
      // not the layout we know: a plain straight run from the steps to the gate
      L = kind === "dep"
        ? [[-30, DOOR_L.z], [0, DOOR_L.z], [gx, G - 6], [gx, G + 0.5]]
        : [[gx, G + 0.5], [gx, G - 6], [30, DOOR_L.z], [0, DOOR_L.z], [-40, DOOR_L.z]];
    } else if (kind === "dep") {
      L = ring.concat([[-10, 44], [gx + 2.5, 57], [gx + 2.5, G - 8], [gx + 2.5, G + 0.5]]);
    } else {
      L = [[gx - 2.5, G + 0.5], [gx - 2.5, G - 8], [gx - 2.5, 57], [10, 44]].concat(ring);
    }
    return L.map(function (p) { return W(p[0], p[1]); });
  }
  function courtRadii(n) { const r = []; for (let i = 0; i < n; i++) r.push(i === 0 || i === n - 1 ? 0 : 8); return r; }
  function slowZones() {
    const out = [], L = CBZ.govComplexes || [];
    for (let i = 0; i < L.length; i++) {
      const s = L[i]; if (!s || !s.rect) continue;
      out.push({ minX: s.rect.minX - 2, maxX: s.rect.maxX + 2, minZ: s.rect.minZ - 2, maxZ: s.rect.maxZ + 2, v: V_YARD });
    }
    return out;
  }
  function doorWorld(site) { return { x: site.cx + DOOR_L.x, z: site.cz + DOOR_L.z }; }
  // the gate, and a point just outside it (where a trip joins the road graph)
  function gateOut(site, m) {
    let ox = site.gate.x - site.cx, oz = site.gate.z - site.cz;
    const d = Math.hypot(ox, oz) || 1; ox /= d; oz /= d;
    return { x: site.gate.x + ox * (m || 0), z: site.gate.z + oz * (m || 0) };
  }

  /* ============================================================
     §4  WHERE A PRESIDENT GOES. Every destination is a live lookup.
     ============================================================ */
  function inRect(site, x, z, pad) {
    const R = site && site.rect; if (!R) return false;
    pad = pad || 0;
    return x >= R.minX - pad && x <= R.maxX + pad && z >= R.minZ - pad && z <= R.maxZ + pad;
  }
  function isHome(to) {
    const s = mansion(); if (!s || !to) return false;
    const R = s.rect;
    return to.x >= R.minX - 20 && to.x <= R.maxX + 20 && to.z >= R.minZ - 20 && to.z <= R.maxZ + 30;
  }
  function seatOfPower(id, label) {
    const s = govSite(id); if (!s) return null;
    return { id: id, label: label || s.name, name: s.name, x: s.gate.x, z: s.gate.z, site: s };
  }
  function nextAppearance() {
    const PB = CBZ.presidentPublic;
    if (!PB || typeof PB.schedule !== "function") return null;
    let L = null;
    try { L = PB.schedule(); } catch (e) { L = null; }
    if (!Array.isArray(L)) return null;
    const now = CBZ.dayTime ? CBZ.dayTime() : 0;
    let best = null;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a || !a.place || !isFinite(a.place.x) || !isFinite(a.place.z)) continue;
      if (a.t1 != null && a.t1 < now) continue;
      if (isHome(a.place)) continue;
      if (!best || (a.t0 || 0) < (best.t0 || 0)) best = a;
    }
    if (!best) return null;
    const nm = best.place.name || "the appearance";
    return { id: "appt:" + (best.id || nm), label: nm, name: nm, x: best.place.x, z: best.place.z, appearance: best };
  }
  // exactly two real answers, in-fiction (§9 reads this)
  function choicesFor(here) {
    const out = [];
    const atHome = !here || isHome(here);
    const near = function (d) { return here && d && d2(here.x, here.z, d.x, d.z) < 150; };
    const pool = [nextAppearance(), seatOfPower("capitol", "The Capitol"), seatOfPower("cityhall", "City Hall"),
      seatOfPower("agency", "Bureau Headquarters"), seatOfPower("defence", "Defence Headquarters")];
    if (!atHome) {
      const s = mansion();
      if (s) out.push({ id: "home", label: "Back to the Mansion", name: "the Executive Mansion", x: s.gate.x, z: s.gate.z });
    }
    for (let i = 0; i < pool.length && out.length < 2; i++) {
      const d = pool[i]; if (!d || near(d)) continue;
      let dup = false;
      for (let k = 0; k < out.length; k++) if (d2(out[k].x, out[k].z, d.x, d.z) < 60) dup = true;
      if (!dup) out.push(d);
    }
    return out;
  }
  function destById(id) {
    id = String(id || "").toLowerCase();
    if (id === "home" || id === "mansion" || id === "execmansion") { const s = mansion(); return s ? { id: "home", name: "the Executive Mansion", x: s.gate.x, z: s.gate.z } : null; }
    if (id === "bureau") id = "agency";
    return seatOfPower(id);
  }

  /* ============================================================
     §5  CARS AND PEOPLE — the engine's own car factory and ped post.
     ============================================================ */
  // city/carseats.js seat ids (+X is the car's left, the driver's side).
  // The principal rides rear right, behind the door agent.
  const SEAT_DRIVER = "driver", SEAT_FRONT = "shotgun", SEAT_PRINCIPAL = "rearR", SEAT_REAR = "rearL";

  // the state car's two fender flags: city/flags.js's car flag, the
  // President's own national design, streaming aft off a chrome staff
  function addFlags(c) {
    if (!THREE || !c || !c.group || !CBZ.flags) return;
    if (c.group.userData && c.group.userData._mcFlags) return;
    const d = c.dims || (c.group.userData && c.group.userData.vehicleDims) || {};
    const W = d.width || 2, L = d.length || 4.9, H = d.height || 1.45;
    for (let s = -1; s <= 1; s += 2) {
      const f = CBZ.flags.car(c.group, { x: s * W * 0.40, y: H * 0.55, z: L * 0.41 });
      if (f) f.userData._mcFlag = true;
    }
    c.group.userData._mcFlags = true;
  }

  function spawnCar(role, x, z, h) {
    const A = arena(); if (!A || !A.root) return null;
    let c = null;
    if (role === "police") {
      let m = null;
      if (CBZ.cityCruiserModel) { try { m = CBZ.cityCruiserModel(); } catch (e) { m = null; } }
      if (CBZ.cityMakeCar) { try { c = CBZ.cityMakeCar(x, z, h, false, m, 0.2); } catch (e) { c = null; } }
      if (c) {
        if (CBZ.cityMarkCruiser) { try { CBZ.cityMarkCruiser(c); } catch (e) {} }
        c._persist = true; c._propParked = true; c._arenaRoot = A.root; c._emergency = true;
      }
    } else {
      const state = role === "state";
      const name = state ? STATE_MODEL : SUV_MODEL, paint = state ? STATE_PAINT : SUV_PAINT;
      if (CBZ.cityAddParkedCar) { try { c = CBZ.cityAddParkedCar(x, z, h, { modelName: name, color: paint, force: true }); } catch (e) { c = null; } }
      if (!c && CBZ.cityMakeCar) {
        let m = null;
        if (CBZ.cityEcon && CBZ.cityEcon.carByName) { try { m = CBZ.cityEcon.carByName(name); } catch (e) { m = null; } }
        try { c = CBZ.cityMakeCar(x, z, h, false, m ? Object.assign({}, m, { color: paint }) : null, 0); } catch (e) { c = null; }
        if (c) { c._persist = true; c._propParked = true; c._arenaRoot = A.root; }
      }
    }
    if (!c) return null;
    if (CBZ.carOccupancyClear) { try { CBZ.carOccupancyClear(c); } catch (e) {} }   // no invented blob crew
    c.ai = false; c.v = 0; c.vx = 0; c.vz = 0; c.baseV = 0; c.road = null; c.parked = true; c.stolen = false;
    c._motorcade = role;
    if (role === "state") {
      c.name = "State Car"; c.engineHp = STATE_HP; c.armor = STATE_ARMOR;
      if (CBZ.bulletproofCar) CBZ.bulletproofCar(c, true);
      addFlags(c);
    } else if (role !== "police") {
      c.engineHp = SUV_HP; c.armor = SUV_ARMOR;
    }
    c._mcHp = c.engineHp == null ? 100 : c.engineHp;
    return c;
  }
  function carLive(c) {
    return !!(c && !c.dead && Array.isArray(CBZ.cityCars) && CBZ.cityCars.indexOf(c) >= 0 && c.group && c.group.parent);
  }
  function removeCar(c) {
    if (!c) return;
    if (c.player || (CBZ.player && CBZ.player._vehicle === c)) return;
    const L = CBZ.cityCars;
    if (Array.isArray(L)) { const i = L.indexOf(c); if (i >= 0) L.splice(i, 1); }
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
    if (CBZ.bulletproofCar) CBZ.bulletproofCar(c, false);
    c._motorcade = null;
  }

  function postPed(x, z, kind, opts) {
    if (!CBZ.cityPostNpc) return null;
    const o = {
      src: "motorcade", archetype: "security", job: kind === "cop" ? "police officer" : "secret service",
      armed: true, weapon: "Pistol", aggr: 0.55, wealth: 0.4, hp: 140,
    };
    if (opts) for (const k in opts) o[k] = opts[k];
    let p = null;
    try { p = CBZ.cityPostNpc(x, z, o); } catch (e) { p = null; }
    if (!p) return null;
    p._motorcade = true; p.maxHp = Math.max(p.maxHp || 0, 140);
    // dress comes from the job: outfits.js jobFit casts "police officer" as the
    // police uniform and "secret service" as the detail's black suit, at spawn
    // and on every re-dress (the old post-spawn dressCop was a second path).
    return p;
  }
  function unpost(p) {
    if (!p) return;
    if (p._mcCar && CBZ.carSeats) { try { CBZ.carSeats.releaseRef(p._mcCar, p); } catch (e) {} }
    if (p.dead) { p._motorcade = false; return; }        // a body stays where it fell
    if (p._cbzDriving && p._cbzDriving.motorcade) p._cbzDriving = null;
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(p); } catch (e) {} }
    p._motorcade = false;
  }
  function seatIn(p, c, slot) {
    if (!p || !c || !c.group || !CBZ.npcLife || !CBZ.npcLife.attach) return false;
    let a = null, parent = c.group;
    if (CBZ.carSeatPlacement) {
      try { const pl = CBZ.carSeatPlacement(c, slot); if (pl) { a = pl.anchor; parent = pl.parent; } } catch (e) { a = null; }
    }
    if (!a) {
      const side = (slot === SEAT_DRIVER || slot === SEAT_REAR) ? 1 : -1, rear = slot === SEAT_PRINCIPAL || slot === SEAT_REAR;
      a = { x: side * 0.42, y: 0.32, z: rear ? -0.85 : 0.15, pose: "sit", state: "sit" };
    }
    let ok = false;
    try { ok = !!CBZ.npcLife.attach(p, parent, a); } catch (e) { ok = false; }
    if (!ok) return false;
    p.inCar = c; p.controlled = true; p._mcCar = c; p._mcSlot = slot; p.staffPost = null;
    claimSeat(p, c, slot);
    return true;
  }
  // the one occupancy map (city/carseats.js): a body in a chair holds it
  function claimSeat(p, c, slot) {
    const S = CBZ.carSeats;
    if (S && c && slot) { try { S.claim(c, slot, { kind: "npc", ref: p }); } catch (e) {} }
  }
  function unseat(p, x, z) {
    if (!p) return;
    const S = CBZ.carSeats;
    if (S && p._mcCar) { try { S.releaseRef(p._mcCar, p); } catch (e) {} }
    p._mcSlot = null;
    if (CBZ.cityUnseat) { try { CBZ.cityUnseat(p, { x: x, z: z, state: p.dead ? "dead" : "walk" }); } catch (e) {} }
    else if (CBZ.npcLife && CBZ.npcLife.detach) {
      try { CBZ.npcLife.detach(p, { parent: arenaRoot(), state: "walk" }); } catch (e) {}
      if (p.pos) { p.pos.set(x, floorY(x, z), z); if (p.target && p.target.set) p.target.set(x, 0, z); }
    }
    p.inCar = null; p._mcCar = null;
  }
  function walkPed(p, x, z, run) {
    if (!p || p.dead) return;
    p.controlled = true; p.staffPost = null;
    const goal = { x: x, z: z };
    p.path = [goal]; p.finalGoal = goal;
    if (p.target && p.target.set) p.target.set(x, 0, z);
    p.state = run ? "flee" : "walk"; p.pause = 0;
  }
  function holdPed(p, face) {
    if (!p || p.dead) return;
    p.path = null; p.finalGoal = null; p.state = "idle"; p.speed = 0; p.pause = 2;
    if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z);
    if (face != null && p.group) p.group.rotation.y = face;
  }
  function placePed(p, x, z) {
    if (!p || !p.pos) return;
    p.pos.set(x, floorY(x, z), z);
    if (p.group) p.group.position.copy(p.pos);
    if (p.target && p.target.set) p.target.set(x, 0, z);
  }
  // car-frame points: right = (-cos h, sin h) (the car's local -X, the
  // passenger side), forward = (sin h, cos h)
  function carPoint(c, right, fwd) {
    const h = c.heading || 0;
    return { x: c.pos.x - Math.cos(h) * right + Math.sin(h) * fwd, z: c.pos.z + Math.sin(h) * right + Math.cos(h) * fwd };
  }

  /* ============================================================
     §6  THE COLUMN. One record for the parked column and the moving one.
     ============================================================ */
  const MC = {
    arena: null, sites: null,
    cars: [],                // { car, role, off, driver, crew:[], released }
    adv: null,               // { car, s, v, driver, parked }
    path: null, s: 0, v: 0,
    where: "none",           // "home" | "away" | "none"
    onCourt: false,          // MC.path is the Mansion departure court path
    phase: "none",           // "parked" | "hold" | "drive"
    stopS: 0, stopT: 0, lastBlockCheck: 0,
    doorAgent: null, strays: [], dismiss: [],
    flashT: 0, flashOn: false,
  };
  let RUN = null;              // the live trip
  let BOARD = null;            // the player's walk to the door
  let runSeq = 0;
  const AUDIT = { runs: 0, evacs: 0, arrivals: 0, posts: 0, lastReason: null, lastDest: null, boarded: 0 };

  function fc(role) { for (let i = 0; i < MC.cars.length; i++) if (MC.cars[i].role === role) return MC.cars[i]; return null; }
  // the detail talks the way a detail talks: short radio calls over an
  // agent's head, never a word to the crowd about where the car is going
  const DETAIL = {
    depart: ["Moving, moving.", "Eagle is moving.", "Rolling. Keep it tight.", "Clear left. Go."],
    seated: ["Eagle is secure.", "Principal in. Doors.", "Package is in the car."],
    arrive: ["Arrival. Eyes up.", "Hands. Watch the hands.", "Rooftops, check your rooftops.", "Stay on him."],
    evac: ["Cover! Cover!", "Get him down!", "Shots fired! Moving!", "Evac, evac, evac!"],
  };
  function detailSay(kind) {
    if (!CBZ.citySay) return;
    const f = fc("state") || MC.cars[0];
    const crew = [];
    if (f && f.crew) for (let i = 0; i < f.crew.length; i++) if (f.crew[i] && !f.crew[i].dead) crew.push(f.crew[i]);
    if (!crew.length) return;
    const pool = DETAIL[kind];
    const a = crew[(Math.random() * crew.length) | 0];
    try { CBZ.citySay(a, pool[(Math.random() * pool.length) | 0], kind === "evac" ? "#ffd76a" : "#d8e6ff", 2.4); } catch (e) {}
  }
  function stateCar() { const f = fc("state"); return f && !f.released && carLive(f.car) ? f.car : null; }
  function liveCars() {
    const out = [];
    for (let i = 0; i < MC.cars.length; i++) { const f = MC.cars[i]; if (f.car && !f.released && carLive(f.car)) out.push(f); }
    return out;
  }
  function minOff() { let m = 0; const L = liveCars(); for (let i = 0; i < L.length; i++) m = Math.min(m, L[i].off); return m; }
  function maxOff() { let m = 0; const L = liveCars(); for (let i = 0; i < L.length; i++) m = Math.max(m, L[i].off); return m; }

  function poseCar(c, q, v) {
    if (!c || !c.pos) return;
    c.pos.x = q.x; c.pos.z = q.z; c.heading = q.h;
    if (c.group && c.group.position !== c.pos) { c.group.position.x = q.x; c.group.position.z = q.z; }
    v = v || 0;
    c.v = v; c.vx = Math.sin(q.h) * v; c.vz = Math.cos(q.h) * v;
    c.wreckT = 0; c._runaway = false; c.abandoned = false; c._playerLeft = false;
    c.ai = false; c.road = null; c.pullover = 0;
    if (c.player && c.group) {
      // vehicles.js stands down for a chauffeured car, so nobody else seats
      // this one on the ground: two probes along the body, pitch from them.
      const f = 1.9, fy = carGround(q.x + Math.sin(q.h) * f, q.z + Math.cos(q.h) * f), by = carGround(q.x - Math.sin(q.h) * f, q.z - Math.cos(q.h) * f);
      const y = (fy + by) / 2;
      c._terrY = y;
      c.group.position.y = y;
      c.group.rotation.set(clamp(-Math.atan2(fy - by, f * 2), -0.3, 0.3), q.h, 0);
    } else if (c.group) c.group.rotation.y = q.h;
  }
  function placeFormation() {
    const L = liveCars();
    for (let i = 0; i < L.length; i++) poseCar(L[i].car, pathAt(MC.path, MC.s + L[i].off), MC.v);
  }

  // ---- staging: the parked column in the motor court ------------------------
  function stale() { return MC.arena !== arena() || MC.sites !== CBZ.govComplexes; }
  function courtPath(site) {
    const pts = courtPoints(site, "dep");
    return makePath(pts, courtRadii(pts.length), slowZones());
  }
  function doorS(P, site) { const d = doorWorld(site); return projectS(P, d.x, d.z); }
  function ensureStaged(force) {
    const site = mansion(); if (!site || !arena()) return false;
    if (stale()) teardown(true);
    if (MC.where === "away") return true;
    if (MC.where === "none") {
      MC.path = courtPath(site); MC.onCourt = true;
      MC.s = doorS(MC.path, site); MC.v = 0; MC.where = "home"; MC.phase = "parked";
      MC.arena = arena(); MC.sites = CBZ.govComplexes;
      MC.cars = FORM.map(function (f) { return { car: null, role: f.role, off: f.off, driver: null, crew: [], released: false }; });
    }
    if (!MC.onCourt || MC.phase !== "parked" && MC.phase !== "hold") return true;
    // (re)fill empty slots, out of sight unless forced
    for (let i = 0; i < MC.cars.length; i++) {
      const f = MC.cars[i];
      if (f.car && carLive(f.car) && !f.released) continue;
      if (f.car && f.car.player) continue;                 // somebody drove off in it
      const q = pathAt(MC.path, MC.s + f.off);
      if (!force && !unseen(q.x, q.z)) continue;
      if (f.car && !carLive(f.car)) f.car = null;
      const c = spawnCar(f.role, q.x, q.z, q.h);
      if (c) { f.car = c; f.released = false; poseCar(c, q, 0); }
    }
    if (!MC.adv || !carLive(MC.adv.car)) {
      const q = pathAt(MC.path, MC.s + ADV_OFF);
      if (force || unseen(q.x, q.z)) {
        const c = spawnCar("advance", q.x, q.z, q.h);
        if (c) { MC.adv = { car: c, s: MC.s + ADV_OFF, v: 0, driver: null, parked: true, staged: true }; poseCar(c, q, 0); }
      }
    }
    return true;
  }
  function teardown(hard) {
    const keep = [];
    const drop = function (c) { if (!c) return; if (hard || unseen(c.pos.x, c.pos.z)) removeCar(c); if (carLive(c) && !c.player) keep.push(c); };
    for (let i = 0; i < MC.cars.length; i++) { const f = MC.cars[i]; dropCrew(f, hard); drop(f.car); }
    if (MC.adv) {
      if (MC.adv.driver) { if (hard) unpost(MC.adv.driver); else MC.dismiss.push({ p: MC.adv.driver, car: MC.adv.car }); }
      drop(MC.adv.car);
    }
    for (let i = 0; i < MC.strays.length; i++) drop(MC.strays[i]);
    if (MC.doorAgent) { if (hard) unpost(MC.doorAgent); else MC.dismiss.push({ p: MC.doorAgent, car: null }); }
    MC.cars = []; MC.adv = null; MC.strays = keep; MC.doorAgent = null;
    MC.path = null; MC.where = "none"; MC.phase = "none"; MC.onCourt = false; MC.v = 0;
    if (RUN) { dropPosts(RUN, !!hard); RUN.done = true; RUN = null; }
    darken();
  }
  function dropCrew(f, now) {
    const L = [f.driver].concat(f.crew || []);
    for (let i = 0; i < L.length; i++) if (L[i] && L[i] !== MC.doorAgent) {
      if (now) unpost(L[i]); else MC.dismiss.push({ p: L[i], car: f.car });
    }
    if (f.car && f.car.npcDriver === f.driver) f.car.npcDriver = null;
    f.driver = null; f.crew = [];
  }

  // ---- crew up: real bodies in the seats for a trip -------------------------
  function crewUp(R) {
    const L = liveCars();
    for (let i = 0; i < L.length; i++) {
      const f = L[i], c = f.car;
      if (!f.driver || f.driver.dead) {
        const p = carPoint(c, -2.2, 0);
        const d = postPed(p.x, p.z, f.role === "police" ? "cop" : "agent", { controlled: true });
        if (d && seatIn(d, c, SEAT_DRIVER)) {
          f.driver = d;
          c.npcDriver = d;
          d._cbzDriving = { car: c, motorcade: true };   // boardingHolds + cityPaxChauffeured
        } else if (d) unpost(d);
      }
      if (f.role === "follow" && !f.crew.length) {
        const p = carPoint(c, 2.2, 0);
        const a = postPed(p.x, p.z, "agent", { controlled: true, weapon: "SMG" });
        if (a && seatIn(a, c, SEAT_PRINCIPAL)) f.crew.push(a); else if (a) unpost(a);
      }
      if (f.role === "state") {
        // the door agent rides up front; the President has the back
        const slot = SEAT_FRONT;
        let a = MC.doorAgent && !MC.doorAgent.dead ? MC.doorAgent : null;
        if (!f.crew.length) {
          if (!a) { const p = carPoint(c, 2.2, -0.8); a = postPed(p.x, p.z, "agent", { controlled: true }); }
          if (a && seatIn(a, c, slot)) { f.crew.push(a); if (a === MC.doorAgent) MC.doorAgent = null; }
          else if (a && a !== MC.doorAgent) unpost(a);
        }
      }
    }
    if (MC.adv && carLive(MC.adv.car) && (!MC.adv.driver || MC.adv.driver.dead)) {
      const c = MC.adv.car, p = carPoint(c, -2.2, 0);
      const d = postPed(p.x, p.z, "agent", { controlled: true });
      if (d && seatIn(d, c, SEAT_DRIVER)) { MC.adv.driver = d; c.npcDriver = d; d._cbzDriving = { car: c, motorcade: true }; }
      else if (d) unpost(d);
    }
  }

  // ---- building a trip's path from wherever the column is -------------------
  function uTurn(x, z, h) {
    const seg = CBZ.roadSegmentAt ? (function () { try { return CBZ.roadSegmentAt(x, z, 3); } catch (e) { return null; } })() : null;
    const fx = Math.sin(h), fz = Math.cos(h);
    let nx = -Math.cos(h), nz = Math.sin(h), o = 0, hw = 9;           // default: swing right
    if (seg) {
      hw = Math.max(4, (seg.w != null ? seg.w : 18) / 2);
      const lat = seg.vertical ? x - seg.x : z - seg.z;
      if (Math.abs(lat) > 0.4) { o = Math.abs(lat); nx = seg.vertical ? Math.sign(lat) : 0; nz = seg.vertical ? 0 : Math.sign(lat); }
    }
    const R = clamp(Math.max(o, 5), 3.5, Math.max(3.5, hw - 1.2));
    const W = function (a, l) { return { x: x + fx * a + nx * (l - o), z: z + fz * a + nz * (l - o) }; };
    const pts = [W(0, o), W(5, o)];
    if (R > o + 0.3) pts.push(W(9, R));
    const A0 = 13;
    for (let k = 1; k < 12; k++) { const ph = Math.PI * k / 12; pts.push(W(A0 + R * Math.sin(ph), R * Math.cos(ph))); }
    pts.push(W(A0 - 1, -R));
    pts.push(W(A0 - 6, -o));
    pts.push(W(A0 - 12, -o));
    return pts;
  }
  function buildTrip(to) {
    const site = mansion(); if (!site) return null;
    const home = isHome(to);
    let pts = [], radii = [], junctions = [], sState = 0;
    if (MC.where === "home" && MC.onCourt) {
      const dep = courtPoints(site, "dep");
      pts = dep.slice(); radii = courtRadii(dep.length);
      sState = MC.s;
      if (!home) {
        const r = roadRoute(dep[dep.length - 1], to);
        for (let i = 1; i < r.pts.length; i++) { pts.push(r.pts[i]); radii.push(r.radii[i]); }
        radii[dep.length - 1] = 6;
        junctions = r.junctions;
      }
    } else {
      // keep the formation where it is: its own stretch of the old path first
      const lo = MC.s + minOff() - 4, hi = MC.s + maxOff();
      const sl = pathSlice(MC.path, lo, hi);
      pts = sl.pts; radii = sl.radii;
      sState = MC.s - lo;
      const lead = pathAt(MC.path, hi);
      const target = home ? gateOut(site, 1) : to;
      let r = roadRoute(lead, target);
      // does the route leave forwards? if not, turn the column round first
      let fwd = true;
      for (let i = 1; i < r.pts.length; i++) {
        const dx = r.pts[i].x - lead.x, dz = r.pts[i].z - lead.z, d = Math.hypot(dx, dz);
        if (d > 8) { fwd = (dx * Math.sin(lead.h) + dz * Math.cos(lead.h)) / d > 0.1; break; }
      }
      let start = 1;
      if (!fwd) {
        const u = uTurn(lead.x, lead.z, lead.h);
        for (let i = 1; i < u.length; i++) { pts.push(u[i]); radii.push(0); }
        const e = u[u.length - 1];
        r = roadRoute(e, target);
        start = 1;
      }
      for (let i = start; i < r.pts.length; i++) { pts.push(r.pts[i]); radii.push(r.radii[i]); }
      junctions = r.junctions;
    }
    if (home) {
      const arr = courtPoints(site, "arr");
      for (let i = 0; i < arr.length; i++) { pts.push(arr[i]); radii.push(i === arr.length - 1 ? 0 : 8); }
    }
    radii[0] = 0; radii[radii.length - 1] = 0;
    const P = makePath(pts, radii, slowZones());
    P.poly = pts;
    let stopS;
    if (home) { const d = doorWorld(site); stopS = projectS(P, d.x, d.z, Math.max(0, P.len - 140)); }
    else stopS = Math.max(sState + 1, P.len - maxOff() - 14);          // the advance car parks at the very end
    P.junctions = [];
    for (let i = 0; i < junctions.length; i++) {
      const j = junctions[i], s = projectS(P, j.x, j.z);
      const q = pathAt(P, s);
      if (d2(q.x, q.z, j.x, j.z) < 14) P.junctions.push({ x: j.x, z: j.z, s: s });
    }
    return { P: P, sState: sState, stopS: stopS, home: home };
  }
  // back onto the parked court path (valid only while the column has not moved)
  function rebaseCourt() {
    const site = mansion(); if (!site || MC.where !== "home") return;
    MC.path = courtPath(site); MC.onCourt = true; MC.s = doorS(MC.path, site); MC.v = 0;
    MC.phase = "parked";
    if (MC.adv && carLive(MC.adv.car)) { MC.adv.s = MC.s + ADV_OFF; MC.adv.parked = true; MC.adv.staged = true; poseCar(MC.adv.car, pathAt(MC.path, MC.adv.s), 0); }
    placeFormation();
  }
  function adoptTrip(T) {
    MC.path = T.P; MC.s = T.sState; MC.stopS = T.stopS; MC.onCourt = false; MC.stopT = 0;
    // the advance car re-bases onto the new path by projection (it may be
    // anywhere ahead, or parked at the end of the last trip)
    if (MC.adv && carLive(MC.adv.car)) MC.adv.s = projectS(T.P, MC.adv.car.pos.x, MC.adv.car.pos.z);
  }

  /* ---- the public verb ----------------------------------------------------- */
  function makeHandle(R) {
    return {
      id: R.id,
      get phase() { return R.phase; },
      get done() { return !!R.done; },
      get route() { return R.route; },
      principal: R.principal, to: R.to,
      abort: function (why) { if (RUN === R) abort(why); },
      evacuate: function (why) { if (RUN === R) evacuate(why); },
      depart: function () { if (RUN === R && R.phase === "venue") R.dwellT = 0; },
    };
  }
  function run(opts) {
    opts = opts || {};
    if (!playing()) return null;
    const site = mansion(); if (!site || !arena()) return null;
    let principal = opts.principal;
    if (principal === "player" || principal === CBZ.player || principal == null) principal = "player";
    const npc = principal !== "player";
    if (npc) {
      if (!principal || principal.dead || !principal.pos) return null;
      if (principal._agencyRiding || principal._agencyOp === "finale") return null;   // the Hitman finale owns him
    }
    if (RUN && !RUN.done) {
      if (RUN.phase === "drive" || RUN.phase === "evac" || RUN.phase === "onfoot") return null;
      if (RUN.phase === "board" && (RUN.npc || npc)) return null;
      if (RUN.npc && RUN.p && RUN.p.ped && !RUN.p.ped.dead && RUN.p.stage !== "inside") return null;
      finishRun(RUN, "replaced");
    }
    const to = opts.to && isFinite(opts.to.x) && isFinite(opts.to.z) ? { x: +opts.to.x, z: +opts.to.z }
      : (function () { const c = choicesFor(null)[0]; return c ? { x: c.x, z: c.z } : null; })();
    if (!to) return null;
    ensureStaged(true);
    if (!stateCar()) return null;
    if (isHome(to) && MC.where === "home") return null;          // already there
    const T = buildTrip(to); if (!T) return null;
    adoptTrip(T);
    const R = {
      id: ++runSeq, principal: principal, npc: npc, to: to, name: opts.name || null, home: T.home,
      route: T.P.poly.map(function (p) { return { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }; }),
      phase: "board", t: 0, panic: false, reason: null, posts: [], advT: opts.advance != null ? +opts.advance : (npc ? ADVANCE_LEAD : 0),
      dwell: opts.dwell != null ? +opts.dwell : 40, dwellT: 0, onArrive: opts.onArrive, onAbort: opts.onAbort, onDone: opts.onDone,
      p: null, lastHp: null, shotsSeen: 0,
    };
    R.handle = makeHandle(R);
    RUN = R; AUDIT.runs++; AUDIT.lastDest = opts.name || (to.x.toFixed(0) + "," + to.z.toFixed(0));
    MC.phase = "hold";
    crewUp(R);
    const sc = stateCar();
    R.lastHp = sc ? sc.engineHp : null;
    R.lastShot = sc ? (sc._shotDmg || 0) : null;
    planPosts(R);
    // the advance car leaves now; the column after the lead time
    if (MC.adv && carLive(MC.adv.car)) { MC.adv.parked = false; MC.adv.staged = false; }
    if (npc) startPrincipalBoard(R);
    emit("motorcade", { phase: "start", to: to, route: R.route, principal: npc ? "npc" : "player" });
    return R.handle;
  }

  function depart(R) {
    R.phase = "drive"; MC.phase = "drive"; MC.stopT = 0;
    MC.onCourt = false; MC.where = "away";                        // the column has left its stand
    detailSay("depart");
    if (CBZ.sfxAt) { const c = stateCar(); if (c) { try { CBZ.sfxAt("door_close", c.pos.x, c.pos.z, { volume: 0.5 }); } catch (e) {} } }
    emit("motorcade", { phase: "depart", to: R.to, route: R.route });
  }

  function finishRun(R, why) {
    if (!R || R.done) return;
    R.done = true; R.phase = "done";
    dropPosts(R, false);
    darken();
    if (R.p && R.p.saved && R.p.ped && !R.p.ped.dead && R.p.stage !== "inside") restorePrincipal(R, true);
    if (RUN === R) RUN = null;
    if (why === "abort" && typeof R.onAbort === "function") { try { R.onAbort(R.handle, R.reason); } catch (e) {} }
    if (typeof R.onDone === "function") { try { R.onDone(R.handle, why); } catch (e) {} }
    // crew go home when nobody is looking
    for (let i = 0; i < MC.cars.length; i++) if (MC.where === "home") dropCrew(MC.cars[i], false);
    if (MC.where === "home" && MC.adv && MC.adv.driver) { MC.dismiss.push({ p: MC.adv.driver, car: MC.adv.car }); if (MC.adv.car) MC.adv.car.npcDriver = null; MC.adv.driver = null; }
  }

  // ---- the per-frame drive -------------------------------------------------
  function tickDrive(dt) {
    const R = RUN, P = MC.path;
    if (!P) return;
    if (MC.phase === "drive") {
      const panic = !!(R && R.panic);
      let vt = Infinity;
      const L = liveCars();
      for (let i = 0; i < L.length; i++) vt = Math.min(vt, capAt(P, MC.s + L[i].off, panic));
      const brake = panic ? BRAKE_E : BRAKE_N;
      vt = Math.min(vt, Math.sqrt(2 * brake * Math.max(0, MC.stopS - MC.s)));
      // the advance car is on the same path: the column never drives into it.
      // scanRoad ignores convoy cars, so this is the only thing that keeps a
      // column car off its bumper (the state car used to rear-end it at
      // 13 m/s, and the crash read as "the state car is under fire": an
      // evacuation home in the middle of every ride).
      const A0 = MC.adv;
      if (A0 && carLive(A0.car) && !A0.car.player) {
        let behind = -Infinity;                           // the column car nearest behind it
        for (let i = 0; i < L.length; i++) { const cs = MC.s + L[i].off; if (cs < A0.s && cs > behind) behind = cs; }
        if (behind > -Infinity) vt = Math.min(vt, Math.sqrt(2 * brake * Math.max(0, A0.s - behind - ADV_GAP)));
      }
      if (MC.blocked && !panic) vt = 0;
      const acc = panic ? ACC_E : ACC_N;
      MC.v += clamp(vt - MC.v, -brake * 1.5 * dt, acc * dt);
      if (MC.v < 0) MC.v = 0;
      MC.s += MC.v * dt;
      if (MC.s > MC.stopS) MC.s = MC.stopS;
      placeFormation();
      const hp = R && R.npc && R.p && R.p.ped;
      if (hp && hp._mcHidden && !hp.dead) { const c = stateCar(); if (c) { hp.pos.set(c.pos.x, c.pos.y || 0, c.pos.z); if (hp.group) hp.group.position.copy(hp.pos); } }
      if (MC.s >= MC.stopS - 0.05 && MC.v < 0.35) { MC.v = 0; placeFormation(); reached(); }
    }
    // the advance car: its own s on the same path, ahead, faster, parks at the end
    const A = MC.adv;
    if (A && !A.parked && carLive(A.car) && !A.car.player && P) {
      const end = P.len;
      let vt = Math.min(16, capAt(P, A.s, false) * 1.15, Math.sqrt(2 * BRAKE_N * Math.max(0, end - A.s)));
      // never run into the back of the column (a new trip's path starts behind it)
      // Only a car wholly BEHIND the column (a new trip's path can start behind
      // it) holds back. One level with or ahead of any column car drives its
      // own profile and the column yields to it (tickDrive above). The old
      // rule slowed it to 0.9x the column whenever it was less than 14 m
      // ahead of the FRONT car, which included sitting between the lead car
      // and the state car: exactly when the column was closing on it.
      if (MC.phase === "drive" || MC.phase === "hold") { if (A.s < MC.s + minOff() - 2) vt = Math.min(vt, MC.phase === "drive" ? MC.v * 0.9 : 0); }
      A.v += clamp(vt - A.v, -BRAKE_N * 1.5 * dt, 3 * dt);
      if (A.v < 0) A.v = 0;
      A.s = Math.min(end, A.s + A.v * dt);
      poseCar(A.car, pathAt(P, A.s), A.v);
      if (A.s >= end - 0.05 && A.v < 0.3) { A.parked = true; A.v = 0; poseCar(A.car, pathAt(P, A.s), 0); }
    }
  }

  // the column has reached its stop
  function reached() {
    const R = RUN;
    MC.phase = "parked";
    if (!R) return;
    if (R.halting) { R.halting = false; R.phase = "halted"; return; }
    AUDIT.arrivals++;
    const site = mansion();
    if (R.home) {
      // back on the court: re-base onto the departure court path (the
      // arrival path's last stretch IS the departure path's first stretch)
      MC.where = "home";
      if (site) { MC.path = courtPath(site); MC.onCourt = true; MC.s = doorS(MC.path, site); placeFormation(); }
      if (MC.adv && carLive(MC.adv.car)) { MC.strays.push(MC.adv.car); if (MC.adv.driver) MC.dismiss.push({ p: MC.adv.driver, car: MC.adv.car }); MC.adv = null; }
      emit("motorcade", { phase: "home", reason: R.panic ? R.reason : null });
      if (R.npc && R.p && R.p.ped && !R.p.ped.dead) { principalOut(R, true); R.phase = "home"; }
      else finishRun(R, R.panic ? "evac" : "home");
      return;
    }
    MC.where = "away";
    R.phase = "venue";
    emit("motorcade", { phase: "arrive", to: R.to });
    if (typeof R.onArrive === "function") { try { R.onArrive(R.handle); } catch (e) {} }
    if (R.npc && R.p && R.p.ped && !R.p.ped.dead) principalOut(R, false);
  }

  /* ---- the NPC principal: door to car to venue and back -------------------- */
  function startPrincipalBoard(R) {
    const p = R.principal, c = stateCar(), site = mansion();
    R.p = { ped: p, stage: "toCar", t: 0, saved: { staffPost: p.staffPost, controlled: p.controlled, x: p.pos.x, y: p.pos.y, z: p.pos.z, face: p.group ? p.group.rotation.y : 0 } };
    p._motorcadeRide = true;
    // a principal upstairs (the office) is brought down to the door out of sight
    if (site && Math.abs((p.pos.y || 0) - floorY(site.cx, site.cz - 8.5)) > 1.5) R.p.needsDown = true;
    if (c && !R.p.needsDown) { const d = carPoint(c, 1.9, -0.9); walkPed(p, d.x, d.z, false); }
  }
  function principalIn(R) {
    const c = stateCar(), p = R.p && R.p.ped;
    if (!c || !p || p.dead) return false;
    if (!seatIn(p, c, SEAT_PRINCIPAL)) {           // no seat anchor: ride hidden, pinned to the car
      p.controlled = true; p.staffPost = null; p._mcHidden = true;
      if (p.group) p.group.visible = false;
    }
    R.p.stage = "seated";
    detailSay("seated");
    if (CBZ.sfxAt) { try { CBZ.sfxAt("door_close", c.pos.x, c.pos.z, { volume: 0.5 }); } catch (e) {} }
    return true;
  }
  function principalOut(R, home) {
    const c = stateCar(), p = R.p && R.p.ped, site = mansion();
    if (!p || p.dead) return;
    const d = c ? carPoint(c, 1.9, -0.9) : { x: p.pos.x, z: p.pos.z };
    if (p._mcHidden) { p._mcHidden = false; if (p.group) p.group.visible = true; placePed(p, d.x, d.z); }
    else unseat(p, d.x, d.z);
    if (home && site) {
      R.p.stage = "toDoor"; R.p.t = 0;
      walkPed(p, site.cx, site.cz - 16, !!R.panic);
    } else {
      R.p.stage = "toVenue"; R.p.t = 0;
      // the spot: the place itself if a body can walk it, else the gate
      let vx = R.to.x, vz = R.to.z;
      if (d2(vx, vz, p.pos.x, p.pos.z) > 70) { const k = 60 / d2(vx, vz, p.pos.x, p.pos.z); vx = p.pos.x + (vx - p.pos.x) * k; vz = p.pos.z + (vz - p.pos.z) * k; }
      R.p.venue = { x: vx, z: vz };
      walkPed(p, vx, vz, false);
    }
  }
  function restorePrincipal(R, placeNow) {
    const p = R.p && R.p.ped; if (!p || p.dead) return;
    const S = R.p.saved;
    p._motorcadeRide = false;
    if (p._npcAttached) unseat(p, p.pos.x, p.pos.z);
    if (p._mcHidden) { p._mcHidden = false; if (p.group) p.group.visible = true; }
    if (placeNow && S) { p.pos.set(S.x, S.y, S.z); if (p.group) p.group.position.copy(p.pos); if (p.target && p.target.set) p.target.set(S.x, 0, S.z); }
    if (S) { p.staffPost = S.staffPost; p.controlled = S.controlled; holdPed(p, S.face); }
    R.p.stage = "inside";
  }
  // 4 Hz: the principal's legs
  function tickPrincipal(R, dt) {
    const P = R.p; if (!P || !P.ped) return;
    const p = P.ped, c = stateCar(), site = mansion();
    if (p.dead) {
      if (P.stage !== "dead") { P.stage = "dead"; if (!R.panic && R.phase !== "home") evacuate("the principal is down"); }
      return;
    }
    P.t += dt;
    if (P.stage === "toCar") {
      if (P.needsDown && site) {
        if (unseen(site.cx, site.cz - 9) || P.t > 8) { placePed(p, site.cx, site.cz - 9); P.needsDown = false; if (c) { const d = carPoint(c, 1.9, -0.9); walkPed(p, d.x, d.z, !!R.panic); } }
        return;
      }
      if (!c) return;
      const d = carPoint(c, 1.9, -0.9);
      if (d2(p.pos.x, p.pos.z, d.x, d.z) < 1.8 || P.t > 35) {
        if (P.t > 35) placePed(p, d.x, d.z);
        principalIn(R);
      } else if (P.t % 3 < dt) walkPed(p, d.x, d.z, !!R.panic);       // re-path now and then
      return;
    }
    if (P.stage === "toVenue") {
      const v = P.venue;
      if (d2(p.pos.x, p.pos.z, v.x, v.z) < 2 || P.t > 45) { holdPed(p, Math.atan2(R.to.x - p.pos.x, R.to.z - p.pos.z)); P.stage = "atVenue"; P.t = 0; R.dwellT = R.dwell; detailSay("arrive"); }
      return;
    }
    if (P.stage === "atVenue") {
      R.dwellT -= dt;
      if (R.dwellT <= 0) { P.stage = "backToCar"; P.t = 0; if (c) { const d = carPoint(c, 1.9, -0.9); walkPed(p, d.x, d.z, !!R.panic); } }
      return;
    }
    if (P.stage === "backToCar") {
      if (!c) return;
      const d = carPoint(c, 1.9, -0.9);
      if (d2(p.pos.x, p.pos.z, d.x, d.z) < 1.8 || P.t > 40) {
        if (P.t > 40) placePed(p, d.x, d.z);
        principalIn(R);
        headHome(R, !!R.panic);
      } else if (P.t % 3 < dt) walkPed(p, d.x, d.z, !!R.panic);
      return;
    }
    if (P.stage === "toDoor") {
      const S = P.saved;
      const dd = site ? d2(p.pos.x, p.pos.z, site.cx, site.cz - 16) : 0;
      const pl = CBZ.player && CBZ.player.pos;
      const lost = P.t > 20 && dd > 60 && unseen(p.pos.x, p.pos.z) && (!pl || d2(pl.x, pl.z, p.pos.x, p.pos.z) > 200);
      if (lost && S) { restorePrincipal(R, true); finishRun(R, "evac"); return; }
      if (dd >= 2.2 && !(dd < 60 && P.t > 30)) { if (site && P.t % 4 < dt) walkPed(p, site.cx, site.cz - 16, !!R.panic); return; }
      if (site) {
        if (S && Math.abs(S.y - (p.pos.y || 0)) > 1.5) {
          if (unseen(p.pos.x, p.pos.z) || P.t > 38) { restorePrincipal(R, true); finishRun(R, R.panic ? "evac" : "home"); }
        } else {
          if (S && d2(S.x, S.z, p.pos.x, p.pos.z) > 2) { walkPed(p, S.x, S.z, false); P.stage = "toPost"; P.t = 0; }
          else { restorePrincipal(R, false); finishRun(R, R.panic ? "evac" : "home"); }
        }
      }
      return;
    }
    if (P.stage === "toPost") {
      const S = P.saved;
      if (!S || d2(p.pos.x, p.pos.z, S.x, S.z) < 1.5 || P.t > 30) { restorePrincipal(R, P.t > 30); finishRun(R, R.panic ? "evac" : "home"); }
    }
  }

  function headHome(R, panic) {
    const site = mansion(); if (!site) return;
    if (panic) R.panic = true;
    const T = buildTrip({ x: site.gate.x, z: site.gate.z });
    if (!T) return;
    adoptTrip(T);
    R.home = true; R.route = T.P.poly.map(function (p) { return { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }; });
    R.phase = panic ? "evac" : "drive";
    MC.phase = "drive"; MC.stopT = 0;
    if (MC.adv && carLive(MC.adv.car)) { MC.strays.push(MC.adv.car); if (MC.adv.driver) MC.dismiss.push({ p: MC.adv.driver, car: MC.adv.car }); MC.adv = null; }
    emit("motorcade", { phase: panic ? "evac" : "return", route: R.route });
  }

  /* ============================================================
     §7  THREATS — shots, a hit on the car, a blocked road; and the panic.
     ============================================================ */
  const SHOTS = [];
  function wrapEvents() {
    const orig = CBZ.cityPostEvent;
    if (typeof orig !== "function" || orig._motorcade) return;
    const w = function (ev) {
      try {
        if (RUN && ev && ev.pos && /gun|shot|explo|blast|bomb/.test(String(ev.type || ""))) {
          SHOTS.push({ x: +ev.pos.x || 0, z: +ev.pos.z || 0, t: SIMT });
          if (SHOTS.length > 16) SHOTS.shift();
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    for (const k in orig) { try { w[k] = orig[k]; } catch (e) {} }
    w._motorcade = true;
    CBZ.cityPostEvent = w;
  }
  function inConvoy(c) { return !!(c && c._motorcade); }

  // 10 Hz while driving: what is in the road ahead, and waving traffic aside
  function scanRoad(dt) {
    const L = liveCars(); if (!L.length) { MC.blocked = null; return; }
    let front = L[0];
    for (let i = 1; i < L.length; i++) if (L[i].off > front.off) front = L[i];
    const c0 = front.car, h = c0.heading, fx = Math.sin(h), fz = Math.cos(h);
    const panic = !!(RUN && RUN.panic);
    const reach = 6 + MC.v * 0.9;
    let blocker = null;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (!o || o.dead || inConvoy(o) || !o.pos) continue;
      // every car of the column checks its own nose when panicking (shove),
      // only the front car decides "blocked"
      const dx = o.pos.x - c0.pos.x, dz = o.pos.z - c0.pos.z;
      if (dx * dx + dz * dz > 60 * 60) continue;
      const ahead = dx * fx + dz * fz, lat = dx * fz - dz * fx;
      if (ahead < -2 || ahead > 45) continue;
      const al = Math.abs(lat);
      if (o.ai && !o.player && al < 7) {
        // the escort waves it to the kerb: stop, and out of our lane
        if (o.pullover !== 4) { o.pullover = 2; o.stopT = 0; }
        if (al < 3.4) {
          const side = lat >= 0 ? 1 : -1, step = Math.min(3.4 - al, 2.6 * dt);
          o.pos.x += fz * side * step; o.pos.z += -fx * side * step;
          o.v = Math.min(o.v || 0, 1);
        }
      }
      if (ahead > 1.5 && ahead < reach && al < 2.3) blocker = blocker || o;
    }
    const P = CBZ.player;
    if (!blocker && P && P.pos && !P.dead && !P.driving) {
      const dx = P.pos.x - c0.pos.x, dz = P.pos.z - c0.pos.z;
      const ahead = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (ahead > 1 && ahead < reach && lat < 1.9) blocker = P;
    }
    if (panic) {
      // push through: anything at a convoy car's nose is shoved aside
      for (let k = 0; k < L.length; k++) {
        const cc = L[k].car, hx = Math.sin(cc.heading), hz = Math.cos(cc.heading);
        for (let i = 0; i < cars.length; i++) {
          const o = cars[i];
          if (!o || o.dead || inConvoy(o) || !o.pos || o.player) continue;
          const dx = o.pos.x - cc.pos.x, dz = o.pos.z - cc.pos.z;
          const ahead = dx * hx + dz * hz, lat = dx * hz - dz * hx;
          if (ahead < 0 || ahead > 5.5 || Math.abs(lat) > 2.4) continue;
          const side = lat >= 0 ? 1 : -1;
          o.pos.x += hz * side * 1.2 + hx * 0.6; o.pos.z += -hx * side * 1.2 + hz * 0.6;
          o.vx = (hz * side * 4 + hx * MC.v * 0.5); o.vz = (-hx * side * 4 + hz * MC.v * 0.5);
          o.wreckT = Math.max(o.wreckT || 0, 0.8); o.spin = (o.spin || 0) + side * 0.8;
          if (CBZ.cityDamageCar && !o._mcShoved) { try { CBZ.cityDamageCar(o, 6, { crumple: true }); } catch (e) {} }
          o._mcShoved = true;
        }
      }
      MC.blocked = null; MC.stopT = 0;
      return;
    }
    MC.blocked = blocker;
    if (blocker && MC.v < 0.8) MC.stopT += dt; else if (!blocker) MC.stopT = 0;
    if (MC.stopT > BLOCK_T) { MC.stopT = 0; evacuate("the road is blocked"); }
  }

  function threatCheck(R, dt) {
    const L = liveCars(), sc = stateCar();
    // the state car itself
    const f = fc("state");
    if (f && f.car && f.car.dead && !R.carLost) {
      R.carLost = true;
      stateCarDestroyed(R, f.car);
      return;
    }
    // Gunfire and blasts (vehicles.js damageEngine tallies them in _shotDmg)
    // are an attack at any amount; a CRASH is one only when it is a real ram.
    // Reading the raw engineHp drop called every scrape with a parked car
    // "the state car is under fire" and turned the ride round for home.
    if (sc) {
      const shot = sc._shotDmg || 0, hp = sc.engineHp;
      if (R.lastShot != null && shot > R.lastShot + 0.5) evacuate("the state car is under fire");
      else if (R.lastHp != null && hp != null && hp < R.lastHp - RAM_HP) evacuate("the state car was rammed");
      R.lastShot = shot; R.lastHp = hp;
    }
    // shots near any car of the column
    for (let i = SHOTS.length - 1; i >= 0; i--) {
      const s = SHOTS[i];
      if (SIMT - s.t > 1.5) break;
      for (let k = 0; k < L.length; k++) {
        const c = L[k].car;
        if (d2(s.x, s.z, c.pos.x, c.pos.z) < SHOT_R) { SHOTS.length = 0; evacuate("shots fired"); return; }
      }
    }
    // a column car somebody else is driving now
    for (let k = 0; k < MC.cars.length; k++) {
      const F = MC.cars[k];
      if (F.car && !F.released && F.car.player && F.role !== "state") { releaseCar(F); evacuate("a car was taken"); }
    }
    // the President and his state car
    if (sc && f && !R.npc) {
      const P = CBZ.player;
      const aboard = P && P._vehicle === sc;
      const pax = aboard && CBZ.cityPaxAboard && CBZ.cityPaxAboard(sc);
      if (aboard && !pax) {
        // he slid across and took the wheel: it is his car now
        if (f.driver && !f.driver.dead) { const d = carPoint(sc, -2.3, 0); unseat(f.driver, d.x, d.z); f.driver._cbzDriving = null; holdPed(f.driver); }
        sc.npcDriver = null;
        releaseCar(f);
        halt("the President took the wheel");
      } else if (!aboard && (R.phase === "drive" || R.phase === "evac")) {
        halt("the President left the car");
      }
    }
    // the state car's driver shot at the wheel: the car is disabled
    if (sc && f && f.driver && f.driver.dead && !f.released) {
      releaseCar(f);
      halt("the driver is down");
      evacuate("the state car's driver is down");
    }
  }
  // a car leaves the column's control and becomes an ordinary vehicle again
  function releaseCar(F) {
    if (!F || F.released) return;
    F.released = true;
    const c = F.car; if (!c) return;
    if (!c.player) { c.v = MC.v; c.vx = Math.sin(c.heading) * MC.v; c.vz = Math.cos(c.heading) * MC.v; c._runaway = MC.v > 1; c.wreckT = MC.v > 1 ? 4 : 0; }
  }
  function halt(why) {
    const R = RUN; if (!R || R.halting) return;
    if (MC.phase !== "drive") return;
    R.halting = true; R.reason = why;
    MC.stopS = Math.min(MC.stopS, MC.s + (MC.v * MC.v) / (2 * BRAKE_E) + 0.5);
  }
  function killAboard(p, c, byPlayer) {
    if (!p || p.dead) return;
    if (p._mcHidden) { p._mcHidden = false; if (p.group) p.group.visible = true; }
    try { if (CBZ.cityKillPed) CBZ.cityKillPed(p, { byPlayer: !!byPlayer, fromX: c.pos.x, fromZ: c.pos.z, force: 4 }, "explosion"); } catch (e) {}
  }
  function stateCarDestroyed(R, c) {
    const f = fc("state"), by = !!c._burnByPlayer;
    if (R.npc && R.p && R.p.ped && (R.p.stage === "seated")) killAboard(R.p.ped, c, by);
    if (f) { killAboard(f.driver, c, by); for (let i = 0; i < f.crew.length; i++) killAboard(f.crew[i], c, by); f.released = true; }
    AUDIT.lastReason = "the state car was destroyed";
    alarmAt(c.pos.x, c.pos.z, "the state car was destroyed");
    R.panic = true;
    halt("the state car was destroyed");
  }
  function alarmAt(x, z, why) {
    emit("security", { level: "evac", reason: why, at: { x: x, z: z } });
    const PR = CBZ.protection;
    if (PR && typeof PR.alarm === "function") { try { PR.alarm(x, z, why); } catch (e) {} }
  }

  function evacuate(reason) {
    const R = RUN;
    reason = reason || "threat";
    const sc = stateCar();
    const at = sc ? { x: sc.pos.x, z: sc.pos.z } : (mansion() ? { x: mansion().cx, z: mansion().cz } : { x: 0, z: 0 });
    if (!R) { alarmAt(at.x, at.z, reason); return false; }
    if (R.panic && R.phase === "evac") return false;
    if (R.lastEvac != null && SIMT - R.lastEvac < 8) return false;
    R.lastEvac = SIMT;
    AUDIT.evacs++; AUDIT.lastReason = reason;
    R.reason = reason;
    alarmAt(at.x, at.z, reason);
    if (CBZ.sfxAt && sc) { try { CBZ.sfxAt("siren", sc.pos.x, sc.pos.z, { volume: 0.7 }); } catch (e) {} }
    R.panic = true;
    detailSay("evac");
    const site = mansion();
    const fs = fc("state");
    if (fs && fs.released && R.npc && R.p && R.p.ped && !R.p.ped.dead && R.p.stage === "seated" && fs.car && !fs.car.dead) {
      // the car is dead in the road with him in it: out, and run for home
      const c = fs.car, d = carPoint(c, 1.9, -0.9);
      if (R.p.ped._mcHidden) { R.p.ped._mcHidden = false; if (R.p.ped.group) R.p.ped.group.visible = true; placePed(R.p.ped, d.x, d.z); }
      else unseat(R.p.ped, d.x, d.z);
      if (site) { R.p.stage = "toDoor"; R.p.t = 0; walkPed(R.p.ped, site.cx, site.cz - 16, true); }
      R.phase = "onfoot";
      return true;
    }
    if (!sc || R.carLost) return true;                       // nothing left to drive him in
    // still inside the grounds (boarding, or rolling out of the court): he
    // goes back indoors and the column stays put
    const insideYard = !!(site && (MC.onCourt || inRect(site, sc.pos.x, sc.pos.z, 10)));
    if (insideYard) {
      if (MC.phase === "drive") halt(reason);
      if (R.npc && R.p && R.p.ped && !R.p.ped.dead) {
        if (R.p.stage === "seated") principalOut(R, true);
        else if (R.p.stage === "toCar") { R.p.stage = "toDoor"; R.p.t = 0; walkPed(R.p.ped, site.cx, site.cz - 16, true); }
        R.phase = "home";
      } else if (!R.npc) { R.phase = "halted"; }
      if (MC.adv && !MC.adv.parked) MC.adv.parked = true;
      return true;
    }
    if (R.npc && R.p && R.p.ped && !R.p.ped.dead && R.p.stage !== "seated") {
      // he is on foot at the venue: run him back to the car, then go
      R.p.stage = "backToCar"; R.p.t = 0;
      const d = carPoint(sc, 1.9, -0.9); walkPed(R.p.ped, d.x, d.z, true);
      R.phase = "evac";
      return true;
    }
    if (!R.npc) {
      const P = CBZ.player;
      if (!(P && P._vehicle === sc)) {
        // he is not in it: the car holds, the agent calls him over
        if (MC.phase === "drive") halt(reason);
        const f = fc("state"), a = f && f.crew[0];
        if (a && CBZ.citySay) { try { CBZ.citySay(a, "Sir, get in the car!", "#ffd76a", 3); } catch (e) {} }
        return true;
      }
    }
    headHome(R, true);
    return true;
  }
  function abort(reason) {
    const R = RUN; if (!R) return false;
    R.reason = reason || "aborted";
    if (R.phase === "board") {
      rebaseCourt();
      // never left: the principal walks back in, the cars stay parked
      if (R.npc && R.p && R.p.ped && !R.p.ped.dead) {
        if (R.p.stage === "seated") principalOut(R, true);
        else { R.p.stage = "toDoor"; R.p.t = 0; const s = mansion(); if (s) walkPed(R.p.ped, s.cx, s.cz - 16, false); }
        R.phase = "home";
      } else finishRun(R, "abort");
      MC.phase = "parked";
      return true;
    }
    if (R.npc && R.p && R.p.ped && !R.p.ped.dead && R.p.stage !== "seated") {
      R.p.stage = "backToCar"; R.p.t = 0; R.dwellT = 0;
      return true;
    }
    headHome(R, false);
    if (typeof R.onAbort === "function") { try { R.onAbort(R.handle, R.reason); } catch (e) {} }
    return true;
  }

  /* ============================================================
     §8  THE ADVANCE TEAM'S WORK: police across the side streets.
     The advance car drives ahead of the column (§6 tickDrive); the posts go
     up at the junctions the route passes, out of sight, and come down after
     the column has gone by. A Hitman who scouts the route finds them.
     ============================================================ */
  function planPosts(R) {
    const P = MC.path, J = (P && P.junctions) || [];
    const lo = MC.s + 110, hi = MC.stopS - 60;
    const picks = [];
    const want = Math.min(MAX_POSTS, Math.max(0, Math.floor((hi - lo) / 220) + 1));
    if (want <= 0) return;
    for (let k = 0; k < want; k++) {
      const target = lo + (hi - lo) * (want === 1 ? 0.5 : k / (want - 1));
      let best = null, bd = Infinity;
      for (let i = 0; i < J.length; i++) {
        const j = J[i];
        if (j.s < lo || j.s > hi) continue;
        let clash = false;
        for (let q = 0; q < picks.length; q++) if (Math.abs(picks[q].s - j.s) < 160) clash = true;
        if (clash) continue;
        const d = Math.abs(j.s - target);
        if (d < bd) { bd = d; best = j; }
      }
      if (best) picks.push(best);
    }
    for (let i = 0; i < picks.length; i++) {
      const j = picks[i], q = pathAt(P, j.s);
      const nx = Math.cos(q.h), nz = -Math.sin(q.h), fx = Math.sin(q.h), fz = Math.cos(q.h);
      let side = 0;
      for (const sg of [1, -1]) {
        if (side) break;
        const tx = j.x + nx * sg * 16, tz = j.z + nz * sg * 16;
        let r = null;
        if (CBZ.roadSegmentAt) { try { r = CBZ.roadSegmentAt(tx, tz, 1); } catch (e) { r = null; } }
        if (r) side = sg;
      }
      if (!side) continue;
      const cx = j.x + nx * side * 12, cz = j.z + nz * side * 12;
      const ox = j.x + nx * side * 8.5, oz = j.z + nz * side * 8.5;
      R.posts.push({
        s: j.s, jx: j.x, jz: j.z, cx: cx, cz: cz, ch: q.h,
        officers: [{ x: ox + fx * 4.5, z: oz + fz * 4.5 }, { x: ox - fx * 4.5, z: oz - fz * 4.5 }].slice(0, i === 0 ? 2 : 1),
        face: Math.atan2(-nx * side, -nz * side), car: null, peds: [], state: "planned", t: 0,
      });
    }
  }
  function tickPosts(R, dt) {
    for (let i = 0; i < R.posts.length; i++) {
      const p = R.posts[i];
      p.t += dt;
      if (p.state === "planned") {
        if (MC.s + maxOff() > p.s - 25) { p.state = "gone"; continue; }   // too late, the column is on it
        if (!unseen(p.cx, p.cz)) continue;
        p.car = spawnCar("police", p.cx, p.cz, p.ch);
        if (p.car) poseCar(p.car, { x: p.cx, z: p.cz, h: p.ch }, 0);
        for (let k = 0; k < p.officers.length; k++) {
          const o = p.officers[k];
          const ped = postPed(o.x, o.z, "cop", { pin: true, face: p.face });
          if (ped) p.peds.push(ped);
        }
        p.state = "live"; AUDIT.posts++;
      } else if (p.state === "live") {
        if (MC.s + minOff() > p.s + 50 || R.done) { p.state = "passed"; p.t = 0; }
      } else if (p.state === "passed") {
        if (unseen(p.cx, p.cz) || p.t > 25) dropPost(p);
      }
    }
  }
  function dropPost(p) {
    for (let k = 0; k < p.peds.length; k++) unpost(p.peds[k]);
    p.peds = [];
    if (p.car && !p.car.player) removeCar(p.car);
    p.car = null; p.state = "done";
  }
  function dropPosts(R, now) {
    for (let i = 0; i < R.posts.length; i++) {
      const p = R.posts[i];
      if (p.state === "live") { p.state = "passed"; p.t = 0; }
      if (now || p.state === "planned") { if (p.state !== "done") dropPost(p); }
    }
    if (!now) {
      // posts still standing are handed to the upkeep so they come down unseen
      for (let i = 0; i < R.posts.length; i++) if (R.posts[i].state === "passed") LOOSE_POSTS.push(R.posts[i]);
    }
  }
  const LOOSE_POSTS = [];
  function darken() {
    const set = function (c) { const b = c && c._rbBar; if (!b) return; if (b.red) b.red.visible = false; if (b.blue) b.blue.visible = false; if (b.mid) b.mid.visible = false; };
    const f = fc("police"); if (f) set(f.car);
    for (let i = 0; i < LOOSE_POSTS.length; i++) set(LOOSE_POSTS[i].car);
  }
  function lights(dt) {
    MC.flashT += dt;
    if (MC.flashT < 0.22) return;
    MC.flashT = 0; MC.flashOn = !MC.flashOn;
    const on = !!RUN && !RUN.done;
    const set = function (c) {
      const b = c && c._rbBar; if (!b) return;
      if (b.red) b.red.visible = on && MC.flashOn;
      if (b.blue) b.blue.visible = on && !MC.flashOn;
      if (b.mid) b.mid.visible = on;
    };
    const f = fc("police"); if (f) set(f.car);
    if (RUN) for (let i = 0; i < RUN.posts.length; i++) set(RUN.posts[i].car);
  }

  /* ============================================================
     §9  THE PLAYER PRESIDENT: an agent at the door, a question, a seat.
     ============================================================ */
  function speaker() {
    const f = fc("state");
    const a = (MC.doorAgent && !MC.doorAgent.dead) ? MC.doorAgent : (f && f.crew[0] && !f.crew[0].dead ? f.crew[0] : null);
    return a;
  }
  // the kerb-side rear door, where the President gets in: the seat model's
  // own stand-off point (boarding.js), else the NPC principal's mark
  function doorStand(c) {
    const B = CBZ.boarding;
    const s = B && B.seatById ? (function () { try { return B.seatById(c, SEAT_PRINCIPAL); } catch (e) { return null; } })() : null;
    if (s && isFinite(s.outX) && isFinite(s.outZ)) {
      const h = c.heading || 0;
      return { x: c.pos.x + s.outX * Math.cos(h) + s.outZ * Math.sin(h), z: c.pos.z - s.outX * Math.sin(h) + s.outZ * Math.cos(h) };
    }
    return carPoint(c, 1.9, -0.9);
  }
  const DLG = { open: false, asked: false, token: 0 };
  function askWhere() {
    const UI = CBZ.campaignUI;
    const sc = stateCar();
    if (!UI || typeof UI.say !== "function" || !sc || BOARD) return false;
    const here = MC.where === "home" ? null : { x: sc.pos.x, z: sc.pos.z };
    const ch = choicesFor(here);
    if (!ch.length) return false;
    const a = speaker();
    const name = (a && a.name) || "Agent";
    const line = MC.where === "home" ? "Car's ready, sir. Where to?" : "Where to now, sir?";
    const tok = ++DLG.token;
    DLG.open = true; DLG.asked = true;
    let pr = null;
    try { pr = UI.say(name, line, ch.map(function (c, i) { return { id: "mc" + i, label: c.label }; }), a ? { actor: a } : null); } catch (e) { pr = null; }
    if (a && a.group && CBZ.player && CBZ.player.pos) a.group.rotation.y = Math.atan2(CBZ.player.pos.x - a.pos.x, CBZ.player.pos.z - a.pos.z);
    if (pr && typeof pr.then === "function") {
      pr.then(function (id) {
        if (tok !== DLG.token) return;
        DLG.open = false;
        if (!id) return;
        const c = ch[+String(id).slice(2)];
        if (c) startBoard(c);
      });
    }
    return true;
  }
  function closeAsk() {
    if (!DLG.open) return;
    DLG.open = false; DLG.token++;
    const UI = CBZ.campaignUI;
    if (UI && UI.clearDialogue) { try { UI.clearDialogue(); } catch (e) {} }
  }

  // the walk to the door, then the seat
  function startBoard(dest) {
    const sc = stateCar(), P = CBZ.player;
    if (!sc || !P || P.dead || P.driving) return false;
    BOARD = { dest: dest, t: 0, phase: "walk" };
    P._doorArc = true; P._doorArcOwner = "motorcade";
    const a = speaker();
    if (a && CBZ.citySay) { try { CBZ.citySay(a, "Yes, sir.", "#d8e6ff", 2); } catch (e) {} }
    return true;
  }
  function endBoard() {
    const P = CBZ.player;
    if (P && P._doorArcOwner === "motorcade") { P._doorArc = false; P._doorArcOwner = null; }
    BOARD = null;
  }
  function poseDoor(c, t) {
    const B = CBZ.boarding;
    if (B && B.door) { try { B.door(c, SEAT_PRINCIPAL, t); } catch (e) {} }
  }
  function tickBoard(dt) {
    const B = BOARD, P = CBZ.player, sc = stateCar();
    if (!P || P.dead || !sc || P.driving) { endBoard(); return; }
    B.t += dt;
    const w = doorStand(sc);
    if (B.phase === "walk") {
      const dx = w.x - P.pos.x, dz = w.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.25 && B.t < 4) {
        const step = Math.min(d, 3.4 * dt);
        P.pos.x += dx / d * step; P.pos.z += dz / d * step;
        const ch = CBZ.playerChar;
        if (ch && ch.group) {
          ch.group.position.x = P.pos.x; ch.group.position.z = P.pos.z;
          ch.group.rotation.y = Math.atan2(dx, dz);
          if (CBZ.animChar) { try { CBZ.animChar(ch, step / Math.max(dt, 1e-4), dt); } catch (e) {} }
        }
        poseDoor(sc, clamp((2.6 - d) / 1.9, 0, 1));
        return;
      }
      B.phase = "open"; B.t = 0;
      if (CBZ.sfxAt) { try { CBZ.sfxAt("door_open", sc.pos.x, sc.pos.z, { volume: 0.6 }); } catch (e) {} }
    }
    if (B.phase === "open") {
      poseDoor(sc, 1);
      if (B.t < 0.4) return;
      const dest = B.dest;
      endBoard();
      if (boardPlayer()) {
        if (CBZ.sfxAt) { try { CBZ.sfxAt("door_close", sc.pos.x, sc.pos.z, { volume: 0.6 }); } catch (e) {} }
        run({ principal: "player", to: { x: dest.x, z: dest.z }, name: dest.name });
      }
    }
  }

  /* Seat the President in the state car's back seat (rearR), chauffeured.
     This is the same seat the in-fiction walk ends in and the harness hook.
     cityEnterVehicle takes the wheel (and clears the driver's chair in the
     seat map), citySeatShift moves him into the back, then the agent driver
     is (re)seated and every crew chair is claimed again. */
  function boardPlayer() {
    if (!playing()) return false;
    ensureStaged(true);
    const sc = stateCar(), P = CBZ.player;
    if (!sc || !P || P.dead) return false;
    if (P._vehicle === sc) return true;
    if (P.driving || P._vehicle || P._aircraft) return false;
    if (!CBZ.cityEnterVehicle) return false;
    const f = fc("state");
    // cityEnterVehicle ejects any npcDriver (a jack) and files a theft for a
    // car that is neither stolen nor owned: hold both off for this one call
    const drv = sc.npcDriver; sc.npcDriver = null;
    const wasStolen = sc.stolen; sc.stolen = true;
    let ok = false;
    try { ok = CBZ.cityEnterVehicle(sc, { instant: true }) !== false; } catch (e) { ok = false; }
    sc.stolen = false; void wasStolen;
    if (!ok || P._vehicle !== sc) { sc.npcDriver = drv; return false; }
    // the back seat: free it of whoever sat there (an agent from an older
    // trip plan), then move across; "passenger" is the fallback for a body
    // with no rear row
    const S = CBZ.carSeats;
    if (S) {
      const o = S.occupant(sc, SEAT_PRINCIPAL);
      if (o && o.ref && o.ref !== P && o.ref._mcCar === sc) {
        const q = carPoint(sc, 2.2, -0.9);
        unseat(o.ref, q.x, q.z);
        if (f) { const k = f.crew.indexOf(o.ref); if (k >= 0) f.crew.splice(k, 1); }
        unpost(o.ref);
      }
    }
    let seated = false;
    if (CBZ.citySeatShift) {
      try { seated = !!CBZ.citySeatShift({ to: SEAT_PRINCIPAL, quiet: true }); } catch (e) { seated = false; }
      if (!seated) { try { CBZ.citySeatShift({ to: "passenger", quiet: true }); } catch (e) {} }
    }
    // a driver at the wheel so the chauffeur path owns the car
    if (f) {
      if (!f.driver || f.driver.dead) {
        const p = carPoint(sc, -2.2, 0);
        const d = postPed(p.x, p.z, "agent", { controlled: true });
        if (d && seatIn(d, sc, SEAT_DRIVER)) f.driver = d; else if (d) unpost(d);
      } else claimSeat(f.driver, sc, f.driver._mcSlot || SEAT_DRIVER);   // cityEnterVehicle cleared the chair
      if (f.driver) { sc.npcDriver = f.driver; f.driver._cbzDriving = { car: sc, motorcade: true }; }
      if (!f.crew.length && MC.doorAgent && !MC.doorAgent.dead) {
        if (seatIn(MC.doorAgent, sc, SEAT_FRONT)) { f.crew.push(MC.doorAgent); MC.doorAgent = null; }
      }
    }
    closeAsk(); DLG.asked = true;
    AUDIT.boarded++;
    return true;
  }

  // the E press beside a column car, for the President, is a word with the
  // agent, never a carjack (the ride router fires before any card)
  // THE COLUMN NEEDS A DRIVER YOU HIRED (city/president_staff.js). Without
  // one the state car is just a car: F gets you in and you drive it yourself.
  function hasDriver() { return !CBZ.presidentStaff || CBZ.presidentStaff.has("driver"); }
  function wantsAgent() {
    const P = CBZ.player;
    if (!P || !P.pos || P.dead || P.driving || P._vehicle || BOARD) return false;
    if (!hasDriver()) return false;
    if (!playerPresident() || (RUN && (RUN.phase === "drive" || RUN.phase === "evac"))) return false;
    const L = liveCars();
    for (let i = 0; i < L.length; i++) {
      const c = L[i].car;
      if (Math.abs((P.pos.y || 0) - (c.pos.y || 0)) < 3 && d2(P.pos.x, P.pos.z, c.pos.x, c.pos.z) < 5.2) return true;
    }
    return false;
  }

  let wired = false;
  function wireInteractions() {
    const I = CBZ.interactions;
    if (wired || !I || !I.registerZone) return;
    wired = true;
    I.registerZone({
      id: "motorcade-door", kind: "motorcade", prio: 16, radius: 6,
      find: function (px, pz) {
        if (!playerPresident() || BOARD || !hasDriver()) return null;
        if (RUN && (RUN.phase === "drive" || RUN.phase === "evac")) return null;
        const sc = stateCar(), P = CBZ.player;
        if (!sc || !P || P.driving) return null;
        if (Math.abs((P.pos.y || 0) - (sc.pos.y || 0)) > 3) return null;
        const a = speaker();
        const at = a && a.pos && !a._npcAttached ? a.pos : doorStand(sc);
        if (d2(px, pz, at.x, at.z) > 4.6 && d2(px, pz, sc.pos.x, sc.pos.z) > 3.6) return null;
        return { x: at.x, z: at.z, kind: "motorcade" };
      },
      options: [{
        id: "motorcade-ride", slot: "e", ride: true, campaignSafe: true,
        label: "Get in",
        canShow: function () { return playerPresident() && !BOARD && !!stateCar(); },
        onSelect: function () { askWhere(); },
      }],
    });
    if (I.describe) { try { I.describe("motorcade", function () { return { label: "The state car", note: "" }; }); } catch (e) {} }
    // No verb card: the one verb is F (ride:true above), pinned on nothing
    // but the agent at the door, who says "Where to?" when you press it.
  }

  /* ============================================================
     §10  THE HELICOPTER — Executive One on the Mansion helipad, the fast
     option for far trips. playeraircraft.js's VIP airframe (the lofted
     transport, not the missile gunship it used to borrow) registered on
     militaryvehicles.js's boardable registry; boarding it is not a theft.
     WHERE it parks is govcomplex.js's published layout (site.layout.heli):
     the raised pad's centre and deck height, nose toward the house.
     ============================================================ */
  const HELI = { rec: null, forArena: null, forSites: null };
  function buildHeli() {
    const root = arenaRoot(), site = mansion();
    const AB = CBZ.debugBuildAircraft;
    const make = AB && (AB.vip || AB.heli);
    if (!root || !site || !CBZ.cityRegisterMilitaryVehicle || !make) return false;
    let grp = null;
    try { grp = make(); } catch (e) { grp = null; }
    if (!grp) return false;
    const L = site.layout && site.layout.heli;
    const x = L ? L.x : site.cx + 74, z = L ? L.z : site.cz + 62;
    const belly = (grp.userData && +grp.userData.belly) || 1.2;
    grp.position.set(x, floorY(x, z) + belly, z);
    grp.rotation.y = L ? L.heading : Math.atan2(site.cx - x, site.cz - z);
    grp.userData.dynamic = true;
    root.add(grp);
    // THE AIRFRAME IS SOLID while it stands on the pad: one collider round the
    // fuselage (not the rotor disc), on the shared parked-collider protocol so
    // boarding it lifts the solid off and a re-park puts it back.
    const FW = 2.8, FL = 10.6, top = grp.position.y + 2.2;
    const a = grp.rotation.y, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    const ex = ca * FW / 2 + sa * FL / 2, ez = sa * FW / 2 + ca * FL / 2;
    const solid = { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, y0: floorY(x, z), y1: top, ref: null, _city: true };
    // parked nose-to-house on a quarter turn, the hull's REAL fore/aft extent
    // (the tail boom runs past the rotor mast) replaces the centred guess
    if (sa < 1e-3 || ca < 1e-3) {
      try {
        grp.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(grp);
        if (ca < 1e-3) { solid.minX = bb.min.x + 0.3; solid.maxX = bb.max.x - 0.3; }
        else { solid.minZ = bb.min.z + 0.3; solid.maxZ = bb.max.z - 0.3; }
      } catch (e) { /* keep the centred footprint */ }
    }
    if (CBZ.colliders) { CBZ.colliders.push(solid); if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} } }
    let rec = null;
    try {
      rec = CBZ.cityRegisterMilitaryVehicle({
        group: grp, kind: "heli", name: "Executive One",
        model: { name: "Executive One", value: 9000000, rarity: 0.02, body: "heli" },
        footW: 4.0, footL: 12.0, hot: false,
        // an unarmed transport: the flyable craft carries no missiles
        armed: false,
        collider: solid, colliderW: FW, colliderL: FL,
        // the group's origin rides `belly` over its wheels; the flight path
        // re-seats it on the ground by this, not by 0
        groundOffset: belly, modelYawOffset: 0,
      });
    } catch (e) { rec = null; }
    if (!rec) {
      if (grp.parent) grp.parent.remove(grp);
      const i = CBZ.colliders ? CBZ.colliders.indexOf(solid) : -1;
      if (i >= 0) CBZ.colliders.splice(i, 1);
      return false;
    }
    rec._motorcade = true;
    HELI.rec = rec; HELI.forArena = arena(); HELI.forSites = CBZ.govComplexes;
    return true;
  }
  function heliAlive() {
    const r = HELI.rec;
    return !!(r && !r.destroyed && Array.isArray(CBZ.cityMilitaryVehicles) && CBZ.cityMilitaryVehicles.indexOf(r) >= 0);
  }
  function dropHeli() {
    const r = HELI.rec;
    HELI.rec = null; HELI.forArena = null; HELI.forSites = null;
    if (!r || r.taken) return;
    const L = CBZ.cityMilitaryVehicles;
    if (Array.isArray(L)) { const i = L.indexOf(r); if (i >= 0) L.splice(i, 1); }
    if (r.collider && CBZ.colliders) {
      const i = CBZ.colliders.indexOf(r.collider);
      if (i >= 0) { CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} } }
    }
    if (r.group && r.group.parent) r.group.parent.remove(r.group);   // shared assets: detach, never dispose
  }
  function ensureHeli() {
    if (heliAlive() && HELI.forArena === arena() && HELI.forSites === CBZ.govComplexes) return true;
    if (HELI.rec) dropHeli();
    return buildHeli();
  }
  /* THE RIDE INTERCEPT (city/interactions.js asks it first on every F, and
     systems/touch.js before a tapped car). Two interceptions, for the
     President only: his own helicopter boards through the same flyable path
     the theft path ends in, minus the four stars; and a column car is a word
     with the agent, not a carjack. Everything else is delegated untouched. */
  function wrapRide() {
    CBZ.cityRideIntercept = function () {
      try {
        const rec = HELI.rec, P = CBZ.player;
        if (rec && !rec.taken && !rec.destroyed && rec.pos && P && P.pos && !P.dead && !P._aircraft && !P._vehicle &&
            !P.driving && playing() && playerPresident() && CBZ.citySpawnFlyableFromProp &&
            d2(P.pos.x, P.pos.z, rec.pos.x, rec.pos.z) < 11) {
          rec.taken = true;
          let c = null;
          try { c = CBZ.citySpawnFlyableFromProp(rec); } catch (e) { c = null; }
          if (c) return true;
          rec.taken = false;
        }
        if (wantsAgent()) { askWhere(); return true; }
      } catch (e) { /* never break the ride key */ }
      return false;
    };
  }

  /* ============================================================
     §11  UPKEEP
     ============================================================ */
  function tickDoorAgent() {
    const sc = stateCar(), P = CBZ.player;
    const want = sc && MC.where === "home" && MC.onCourt && (!RUN || RUN.phase === "board") && P && P.pos &&
      d2(P.pos.x, P.pos.z, sc.pos.x, sc.pos.z) < AGENT_R && !(P._vehicle === sc);
    const a = MC.doorAgent;
    if (a && a.dead) { MC.doorAgent = null; return; }
    if (want && !a) {
      const p = carPoint(sc, 1.9, -1.0);
      if (!unseen(p.x, p.z) && d2(P.pos.x, P.pos.z, p.x, p.z) < 40) return;   // never materialise in view
      const ped = postPed(p.x, p.z, "agent", { pin: true, face: Math.atan2(-Math.cos(sc.heading), Math.sin(sc.heading)) });
      if (ped) { MC.doorAgent = ped; if (CBZ.setCharPose && ped.char) { try { CBZ.setCharPose(ped.char, "foldarms"); } catch (e) {} } }
    } else if (!want && a && !a._npcAttached && P && P.pos && d2(P.pos.x, P.pos.z, a.pos.x, a.pos.z) > AGENT_R + 40) {
      unpost(a); MC.doorAgent = null;
    }
  }
  function tickAsk() {
    const P = CBZ.player, sc = stateCar();
    if (!P || !P.pos || !sc || !playerPresident()) { closeAsk(); return; }
    const parked = !RUN || RUN.phase === "venue" || RUN.phase === "halted" || RUN.phase === "board" || RUN.done;
    const d = d2(P.pos.x, P.pos.z, sc.pos.x, sc.pos.z);
    if (P.driving || P._vehicle || BOARD) { if (P._vehicle !== sc) DLG.asked = false; return; }
    if (d > ASK_RESET_R) { closeAsk(); DLG.asked = false; return; }
    if (parked && !DLG.asked && !DLG.open && d < ASK_R && Math.abs((P.pos.y || 0) - (sc.pos.y || 0)) < 3) askWhere();
  }
  function tickDismiss() {
    for (let i = MC.dismiss.length - 1; i >= 0; i--) {
      const q = MC.dismiss[i], p = q.p;
      if (!p || p.dead) { MC.dismiss.splice(i, 1); continue; }
      const at = p.pos || (q.car && q.car.pos);
      if (!at || unseen(at.x, at.z)) { unpost(p); MC.dismiss.splice(i, 1); }
    }
    for (let i = MC.strays.length - 1; i >= 0; i--) {
      const c = MC.strays[i];
      if (!c || !carLive(c) || c.player) { MC.strays.splice(i, 1); continue; }
      if (unseen(c.pos.x, c.pos.z)) { removeCar(c); MC.strays.splice(i, 1); }
    }
    for (let i = LOOSE_POSTS.length - 1; i >= 0; i--) {
      const p = LOOSE_POSTS[i];
      p.t += 0.25;
      if (p.state === "done") { LOOSE_POSTS.splice(i, 1); continue; }
      if (unseen(p.cx, p.cz) || p.t > 25) { dropPost(p); LOOSE_POSTS.splice(i, 1); }
    }
  }

  let slowAcc = 99, fastAcc = 0, scanAcc = 0;
  function upkeep(dt) {
    wireInteractions(); wrapRide(); wrapEvents();
    const pres = presidentNow();
    const site = mansion();
    if (stale() && MC.where !== "none") teardown(true);
    if (pres.kind === "vacant" || !site) {
      if (!RUN && MC.where !== "none") teardown(false);
      if (HELI.rec) dropHeli();
      return;
    }
    if (pres.kind === "player") ensureHeli(); else if (HELI.rec && !HELI.rec.taken) dropHeli();
    const P = CBZ.player, pp = P && P.pos;
    const dHome = pp ? d2(pp.x, pp.z, site.cx, site.cz) : Infinity;
    if (!RUN) {
      if (MC.where === "home" || MC.where === "none") {
        if (dHome < STAGE_R) ensureStaged(MC.where === "none" && dHome > 140);
        else if (dHome > STAGE_DROP_R && MC.where !== "none") teardown(false);
      } else if (MC.where === "away") {
        const sc = stateCar();
        const far = !sc || !pp || d2(pp.x, pp.z, sc.pos.x, sc.pos.z) > 600;
        // a column left standing inside the grounds (halted on the drive) is
        // cleared away unseen and re-staged on the court
        let yard = false;
        if (sc && inRect(site, sc.pos.x, sc.pos.z, 10)) {
          yard = true;
          const L = liveCars();
          for (let i = 0; i < L.length; i++) if (!unseen(L[i].car.pos.x, L[i].car.pos.z)) yard = false;
        }
        if (far || yard) teardown(false);
      }
    } else if (RUN.done) {
      RUN = null;
    }
    // a column parked away with a player principal gone for good goes home
    if (RUN && !RUN.npc && (RUN.phase === "venue" || RUN.phase === "halted")) {
      const sc = stateCar();
      if (!sc || !pp || d2(pp.x, pp.z, sc.pos.x, sc.pos.z) > 600) { finishRun(RUN, "left"); teardown(false); }
    }
    if (RUN && RUN.npc && RUN.phase === "halted") {
      RUN.haltT = (RUN.haltT || 0) + 1;
      const st = RUN.p && RUN.p.stage;
      if (RUN.haltT > 45 && (!RUN.p || st === "dead" || st === "inside" || st === "seated")) {
        if (st === "seated") evacuate("the column is stopped");
        else finishRun(RUN, "abort");
      }
    }
    tickDoorAgent();
  }

  function fast(dt) {
    const R = RUN;
    if (R && !R.done) {
      R.t += dt;
      if (R.phase === "board") {
        // leave when the principal is aboard and the advance team has had its lead
        R.advT -= dt;
        const sc = stateCar(), P = CBZ.player;
        const aboard = R.npc ? (R.p && R.p.stage === "seated") : !!(sc && P && P._vehicle === sc);
        if (aboard && R.advT <= 0 && R.t > 1.2) depart(R);
      }
      if (R.npc) tickPrincipal(R, dt);
      tickPosts(R, dt);
      if (R.phase === "drive" || R.phase === "evac" || R.phase === "board" || R.phase === "venue") threatCheck(R, dt);
    }
    lights(dt);
    tickAsk();
    tickDismiss();
  }

  if (CBZ.onUpdate) {
    // per frame, and only while something is moving: before passengerseat's
    // ride sync (36.7), after boarding's driver loop (36.6), before the car
    // loop's parkSeat (37) which seats every column car on the terrain
    CBZ.onUpdate(36.63, function (dt) {
      dt = dt || 0;
      SIMT += dt;
      if (!playing()) { if (BOARD) endBoard(); return; }
      if (BOARD) tickBoard(dt);
      const moving = MC.phase === "drive" || (MC.adv && !MC.adv.parked && MC.path);
      if (!moving) return;
      tickDrive(dt);
      if (MC.phase === "drive") {
        scanAcc += dt;
        if (scanAcc >= 0.1) { const s = scanAcc; scanAcc = 0; scanRoad(s); }
      }
    });
    CBZ.onUpdate(41.915, function (dt) {
      if (!playing()) return;
      dt = dt || 0;
      slowAcc += dt; fastAcc += dt;
      if (slowAcc >= 1) { slowAcc = 0; try { upkeep(1); } catch (e) { if (window.console) console.error("[motorcade]", e); } }
      const busy = !!RUN || DLG.open || MC.dismiss.length || MC.strays.length || LOOSE_POSTS.length ||
        (MC.where !== "none" && CBZ.player && CBZ.player.pos && stateCar() && d2(CBZ.player.pos.x, CBZ.player.pos.z, stateCar().pos.x, stateCar().pos.z) < 30);
      if (busy && fastAcc >= 0.25) { const s = fastAcc; fastAcc = 0; try { fast(s); } catch (e) { if (window.console) console.error("[motorcade]", e); } }
      else if (!busy) fastAcc = 0;
    });
  }

  /* ============================================================
     §12  API
     ============================================================ */
  function routeTo(dest) {
    const site = mansion();
    if (!site || !dest || !isFinite(dest.x) || !isFinite(dest.z)) return [];
    const dep = courtPoints(site, "dep");
    const r = roadRoute(dep[dep.length - 1], dest);
    const out = dep.concat(r.pts.slice(1));
    return out.map(function (p) { return { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }; });
  }
  function convoyList() {
    const out = [];
    for (let i = 0; i < MC.cars.length; i++) { const f = MC.cars[i]; if (f.car && carLive(f.car)) out.push({ car: f.car, role: f.role }); }
    if (MC.adv && carLive(MC.adv.car)) out.push({ car: MC.adv.car, role: "advance" });
    return out;
  }
  function activeRead() {
    const R = RUN;
    if (!R || R.done) return null;
    return {
      cars: convoyList(), stateCar: stateCar(), route: R.route, s: MC.s, principal: R.principal,
      phase: R.phase, panic: !!R.panic, reason: R.reason, to: R.to,
      posts: R.posts.filter(function (p) { return p.state === "live"; }).map(function (p) { return { x: p.jx, z: p.jz, car: p.car, officers: p.peds.slice() }; }),
    };
  }

  CBZ.motorcade = {
    // contract
    run: run,
    active: activeRead,
    abort: abort,
    evacuate: evacuate,
    routeTo: routeTo,
    // reads
    destinations: function (here) { return choicesFor(here || null).map(function (d) { return { id: d.id, name: d.name, label: d.label, x: d.x, z: d.z }; }); },
    car: stateCar,
    helicopter: function () { return HELI.rec; },
    // legacy verb (the old card's): a real ride now, never a teleport
    go: function (destId) {
      const d = destById(destId); if (!d) return { ok: false, why: "no such place" };
      if (!boardPlayer()) return { ok: false, why: "not boarded" };
      const h = run({ principal: "player", to: { x: d.x, z: d.z }, name: d.name });
      return { ok: !!h, dest: d.id };
    },
    audit: function () { return CBZ.motorcadeAudit(); },
    // harness hooks
    _boardPlayer: boardPlayer,
    _convoy: convoyList,
    _stage: function () { return ensureStaged(true); },
    _teardown: function () { teardown(true); },
    _math: { buildGraph: buildGraph, routeNodes: routeNodes, lanePolyline: lanePolyline, makePath: makePath, pathAt: pathAt, capAt: capAt, projectS: projectS, uTurn: uTurn },
  };
  CBZ.motorcadeAudit = function () {
    const G = GRAPH.G;
    return {
      car: !!stateCar(), cars: convoyList().length, where: MC.where, phase: RUN ? RUN.phase : MC.phase,
      destinations: choicesFor(null).map(function (d) { return d.id; }),
      helicopter: heliAlive(), runs: AUDIT.runs, rides: AUDIT.runs, arrivals: AUDIT.arrivals, evacs: AUDIT.evacs,
      posts: AUDIT.posts, boarded: AUDIT.boarded, lastReason: AUDIT.lastReason, lastDest: AUDIT.lastDest,
      graph: G ? { nodes: G.nx.length, segs: G.segs.length } : null,
      doorAgent: !!(MC.doorAgent && !MC.doorAgent.dead),
      // where the column is on its path (tools read this to tell "slow" from "stuck")
      drive: MC.path ? { s: Math.round(MC.s), stopS: Math.round(MC.stopS), len: Math.round(MC.path.len), v: +MC.v.toFixed(1),
        blocked: MC.blocked ? (MC.blocked === CBZ.player ? "player" : "car") : null, stopT: +(MC.stopT || 0).toFixed(1),
        adv: MC.adv && carLive(MC.adv.car) ? Math.round(MC.adv.s - MC.s) : null } : null,
    };
  };
})();
