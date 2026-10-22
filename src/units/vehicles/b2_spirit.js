/* ============================================================
   units/vehicles/b2_spirit.js — B-2A Spirit stealth bomber (USAF).

   Redrawn from scratch for NPC War (wave B). Before this file drew its own
   airframe it borrowed Gang City's model (city/strategic.js makeB2) and
   registered no rig: the B-2 flew the battle with its gear hanging, its bay
   shut while bombs fell out of its belly from nowhere, nothing moving on it,
   and in node (no city file) it was the runtime's grey box. Gang City's
   model was the starting point; its planform was not the real one (the
   trailing-edge teeth were not parallel to the leading edges and the tips
   came to a 1.5 m point), so the loft is new.

   THE AIRFRAME (real metres, nose +Z, port +X, wheels on y = 0):
     span 52.43 m, length 20.9 m, height 5.18 m, wing area ~478 m2;
     leading edge swept 33 deg; THE PLANFORM HAS ONLY TWO EDGE DIRECTIONS:
     every trailing-edge segment is parallel to one leading edge or the
     other, which is what turns the radar return into four narrow spikes.
     That gives the double-W trailing edge: centre point at 20.9 m, inner
     notches at 7.0 m out, the inboard aft points at 10.8 m, the outer
     notches at 17.5 m, then a constant-chord outer panel to a 3.1 m tip.
     (The area comes out at ~473 m2 against the published 478.)
     The section is a flying-wing aerofoil, 80% of it above the chord plane;
     the centrebody is 2.5 m deep, the outer wing ~9% thick, a knife edge at
     the tip. The flight deck is a blister on the centrebody with the real
     FOUR-PANE windscreen (two big front panes, two smaller side panes, a
     post down the middle), two seats abreast (pilot left, mission commander
     right) with both crew in it. The four F118s live in two nacelle swells
     outboard of the deck: each has an S-duct inlet slit across its face
     with the serrated (W) lip and a boundary-layer splitter ahead of it,
     and exhausts into a recessed deck of heat tiles on TOP of the wing that
     runs to the trailing edge, so nothing below can see the hot metal.
     THE CONTROL SURFACES are real hinged parts cut out of the trailing
     edge: the beaver tail (the gust-load-alleviation surface) at the centre,
     three elevons a side, and the SPLIT DRAG RUDDERS outboard (upper and
     lower halves that open like a clam for yaw and as speed brakes).
     TWO BOMB BAYS side by side on the centreline, 6.4 m long, each with two
     doors (painted with the sawtooth ends) and a ROTARY LAUNCHER of eight
     2,000 lb weapons: GBU-31(V)3 JDAMs on the BLU-109 penetrator in the left
     bay, GBU-31(V)1 JDAMs on the Mk 84 in the right one. The gear (twin-
     wheel nose leg, two four-wheel bogies on a 12.2 m track, the main doors
     hanging vertical outboard of the legs) retracts in flight.
     The skin is one radar-absorbent dark grey (FS 36118-ish), top and belly
     the same paint, with panel seams, sawtooth access-door outlines, the
     leading-edge treatment, exhaust-deck tiles and soot painted into ONE
     planform-mapped canvas (per page). The nation's flag goes on as a
     LOW-VISIBILITY insignia (grey on grey), upper port and lower starboard
     wing, the USAF convention.

   THE RIG (every moving part, on the battle clock, animate -> tick):
     bank          the airframe banks to the coordinated-turn angle,
                   tan(bank) = v * yaw rate / g, not the runtime's steer roll
     elevons       pitch (flight-path rate) + roll (bank rate), rate-limited
                   at the actuators' ~60 deg/s, trimmed slightly reflexed
     drag rudders  the inside rudder splits open in a yawing turn; both crack
                   open as speed brakes slow and low; shut on the ground
     beaver tail   flutters a degree or two (gust alleviation)
     bay doors     open only on the bomb run (stealth): rig.canFire asks for
                   them once the release point is ~10 s out and holds the
                   bomb until they are open and the launcher has indexed
     launcher      rotates 45 deg after every release to bring the next
                   weapon to the bottom; each bomb leaves ITS slot, falls on
                   the same ballistics as the battle's round (the JDAM steers
                   onto the mark all the way down) and is gone at impact
     gear          up above 25 m, down below it (and on the stand)
     lights        nav lights and the tail light on at low level, dark in
                   the fight (combat lights-out)
     damage        a penetrating hit smokes the nacelle it hit, burning adds
                   flame; a kill blackens the skin and TEARS AN OUTER WING
                   PANEL OFF (it tumbles away with its elevon and rudder) and
                   the fire streams from the root; the wreck lies gear-up

   WEAPONS & ARMOUR. Sixteen 2,000 lb-class JDAMs, the B-2's standard heavy
   load: 8 x GBU-31(V)3 (BLU-109 penetrator: 240 kg Tritonal behind a hard
   case that goes 1.8-2.4 m into reinforced concrete, delay fuze; here it is
   the one for ARMOUR and anything dug in, a top-attack kill with a smaller
   surface blast) and 8 x GBU-31(V)1 (Mk 84: 429 kg Tritonal, blast and
   fragments, the one for men, beasts and soft vehicles). Released from
   12 km at Mach 0.85, guided (GPS/INS, ~5 m CEP) from inside a basket of
   0.15 x the fall: two penetrators per armoured mark, a stick of four Mk 84s
   per pass on men. There are no guns. The skin is composite RAM, a few mm:
   anything that reaches 12 km (a SAM) goes through it.

   CREW & TACTICS. Two crew: the pilot (left seat) flies, the mission
   commander (right seat) works the bombs. def.tactics says what it is: a
   strategic bomber that flies single straight-and-level passes at altitude,
   bay shut until the run, and prefers armour and launchers.
   moves(veh, tgt): the penetrator for an armoured mark, the Mk 84 for
   everything else, for a player who takes the bomber over.

   Units: metres, m/s, kg; armour in mm RHA equivalent per face.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;

  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function sm(a, b, v) { const u = clamp((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); }

  // =====================================================================
  //  THE PLANFORM (all edges parallel to one of the two leading edges)
  // =====================================================================
  const LEN = 20.9, HALF = 26.215, SW = Math.tan(33 * DEG);
  const APEX = LEN / 2;                 // model z of the nose
  const CY = 2.35;                      // chord plane over the ground, gear down
  const HEIGHT = 5.18;
  const TE = (function () {
    const xs = [0, 7.0, 10.8, 17.5, HALF], sl = [-SW, SW, -SW, SW], p = [[0, LEN]];
    let d = LEN;
    for (let i = 1; i < xs.length; i++) { d += sl[i - 1] * (xs[i] - xs[i - 1]); p.push([xs[i], d]); }
    return p;
  })();
  function teD(x) {
    x = Math.abs(x);
    for (let i = 1; i < TE.length; i++) {
      if (x <= TE[i][0] + 1e-9) { const a = TE[i - 1], b = TE[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    }
    return TE[TE.length - 1][1];
  }
  function leD(x) { return Math.abs(x) * SW; }
  function chord(x) { return Math.max(0.3, teD(x) - leD(x)); }
  function thick(x) { return 0.67 * Math.exp(-Math.pow(x / 7, 2)) + 0.085 * chord(x); }
  function foil(t) { return !(t > 0) || t >= 1 ? 0 : Math.pow(t, 0.42) * Math.pow(1 - t, 0.95) / 0.4298; }
  // the flight-deck blister: rises from the apex, peaks over the seats and
  // runs aft as the spine that blends into the nacelles
  function blister(x, t) {
    if (!(t > 0)) return 0;
    const w = t < 0.2 ? 0.12 : 0.26;
    return Math.exp(-Math.pow(x / 3.2, 2)) * Math.exp(-Math.pow((t - 0.2) / w, 2)) * Math.min(1, t / 0.08) * 0.9;
  }
  // the nacelles: swells in the wing, inlet face at t 0.17 -> 0.215
  const ENG_X = 4.9, ENG_W = 1.35;
  const IN_T0 = 0.17, IN_T1 = 0.215, EX_T0 = 0.60, EX_T1 = 0.66;
  function engX(x) { return Math.exp(-Math.pow((Math.abs(x) - ENG_X) / ENG_W, 2)); }
  function hump(x, t) { return t > 0 ? 0.6 * engX(x) * sm(IN_T0, IN_T1, t) * (1 - sm(0.36, 0.70, t)) : 0; }
  // the exhaust deck: aft of the engines the top skin steps DOWN into a trough
  function trough(x, t) {
    if (!(t > EX_T0)) return 0;
    return 0.3 * Math.exp(-Math.pow((Math.abs(x) - ENG_X) / 1.05, 4)) * sm(EX_T0, EX_T1, t);
  }
  function topAt(x, t) {
    if (!(t > 0) || t >= 1) return CY;
    const th = thick(x), f = foil(t);
    return Math.max(CY + th * f * 0.8 + blister(x, t) + hump(x, t) - trough(x, t), CY - th * f * 0.22 + 0.025);
  }
  function botAt(x, t) { return !(t > 0) || t >= 1 ? CY : CY - thick(x) * foil(t) * 0.22; }
  function zOf(x, t) { return APEX - (leD(x) + t * chord(x)); }
  function tOf(x, z) { return (APEX - z - leD(x)) / chord(x); }
  function topY(x, z) { return topAt(x, tOf(x, z)); }
  function botY(x, z) { return botAt(x, tOf(x, z)); }

  // THE CONTROL SURFACES (x >= 0 half; the beaver tail spans the centre).
  // `depth` is the hinge's distance ahead of the trailing edge; the beaver
  // tail's hinge is a spanwise line at 17.9 m.
  const BT_D = 17.9, BT_X = 3.2;
  const SURF = [
    { id: "elevon1", a: 7.3, b: 10.5, depth: 1.5, roll: 0.55 },
    { id: "elevon2", a: 11.1, b: 17.2, depth: 1.5, roll: 1.0 },
    { id: "elevon3", a: 17.8, b: 21.6, depth: 1.4, roll: 1.0, outer: true },
    { id: "rudder", a: 21.8, b: 25.7, depth: 1.4, roll: 0.4, outer: true, split: true },
  ];
  function csDepth(x) {
    const ax = Math.abs(x);
    if (ax <= BT_X + 1e-6) return Math.max(0, teD(ax) - BT_D);
    for (let i = 0; i < SURF.length; i++) { const s = SURF[i]; if (ax >= s.a - 1e-6 && ax <= s.b + 1e-6) return s.depth; }
    return 0;
  }
  function tHinge(x) { return 1 - csDepth(x) / chord(x); }

  // the four-pane windscreen in the loft's own parameter space
  const GLASS_XC = 0.8, GLASS_X = 1.5;
  function isGlass(xa, xb, t0, t1) {
    const ax = Math.max(Math.abs(xa), Math.abs(xb));
    if (ax <= GLASS_XC + 1e-6) return t0 >= 0.07 - 1e-6 && t1 <= 0.215 + 1e-6;
    if (ax <= GLASS_X + 1e-6) return t0 >= 0.095 - 1e-6 && t1 <= 0.19 + 1e-6;
    return false;
  }
  // bays + gear
  const BAY_D0 = 6.9, BAY_D1 = 13.3, BAY_XI = 0.12, BAY_XO = 2.12;
  const BAY_ZM = APEX - (BAY_D0 + BAY_D1) / 2, BAY_L = BAY_D1 - BAY_D0;
  const MAIN_X = 6.1, MAIN_D = 10.75, NOSE_D = 4.2;
  const RLA_R = 0.66;
  const OUTER_X = 17.5;                 // the outer panel joint (the outer notch)

  const TS = [0, 0.01, 0.025, 0.045, 0.07, 0.095, 0.12, 0.145, 0.17, 0.19, 0.215, 0.24,
    0.27, 0.30, 0.34, 0.38, 0.43, 0.48, 0.53, 0.58, 0.60, 0.63, 0.66, 0.70, 0.75, 0.80,
    0.85, 0.90, 0.95, 1.0];
  function uvOf(x, z, belly) {
    const u = (x + HALF) / (2 * HALF), v = (APEX - z) / LEN;
    return [u, belly ? 0.5 - v * 0.5 : 1 - v * 0.5];
  }

  // =====================================================================
  //  THE WEAPONS
  // =====================================================================
  const WID_PEN = "gbu31_blu109", WID_MK84 = "gbu31_mk84";
  /* The order is the order vehAirWeapon plans a pass round: the penetrator
     for armour first, the Mk 84 for everything else. Bombs are `free`
     (no facing) and guided: released inside a basket of 0.15 x the fall
     distance, homing all the way down (src/battle/vehicles.js vehBombRun). */
  const WEAPONS = [
    { id: WID_PEN, seat: "commander", kind: "bombs", vs: "armour", guided: true, basket: 0.15,
      rof: 2, salvo: 2, reload: 25, range: 24000, ammo: 8, mun: "gbu31v3" },
    { id: WID_MK84, seat: "commander", kind: "bombs", vs: "any", guided: true, basket: 0.15,
      rof: 2.5, salvo: 4, reload: 30, range: 24000, ammo: 8, mun: "gbu31v1" },
  ];
  const BAY_OF = { gbu31_blu109: 0, gbu31_mk84: 1 };   // left (port, +X) bay, right bay

  // =====================================================================
  //  THE TEMPLATE: every geometry and material built once per page
  // =====================================================================
  const C = {
    skin: 0x4b5158, belly: 0x464b51, dark: 0x2a2e33, frame: 0x16191d, deck: 0x1a1d21,
    glow: 0x2f6f6a, gear: 0x9aa0a6, hub: 0xb0b5bb, tire: 0x151618, well: 0x24272b,
    mk84: 0x4d5434, blu: 0x5a5f4a, jdam: 0x7c8081, band: 0xc9a227, rla: 0x3a3e42,
    suit: 0x5d6150, helmet: 0x3f434a, visor: 0x2b2416, skinT: 0xa47d62, seat: 0x23262a,
  };
  let TPL = null;

  function rgb(hex) { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; }
  function paintG(g, col) {
    const THREE = window.THREE;
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = p.count, c = new Float32Array(n * 3);
    const fixed = typeof col === "function" ? null : rgb(col);
    for (let i = 0; i < n; i++) {
      const r = fixed || rgb(col(p.getX(i), p.getY(i), p.getZ(i)));
      c[i * 3] = r[0]; c[i * 3 + 1] = r[1]; c[i * 3 + 2] = r[2];
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    if (g.attributes.uv) g.deleteAttribute("uv");
    return g;
  }
  function mergeG(list) {
    const THREE = window.THREE;
    let n = 0;
    for (let i = 0; i < list.length; i++) n += list[i].attributes.position.count;
    if (!n) return null;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Cc = new Float32Array(n * 3);
    let o = 0;
    for (let i = 0; i < list.length; i++) {
      const g = list[i], k = g.attributes.position.count;
      P.set(g.attributes.position.array, o * 3);
      N.set(g.attributes.normal.array, o * 3);
      Cc.set(g.attributes.color.array, o * 3);
      o += k;
    }
    const G = new THREE.BufferGeometry();
    G.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    G.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    G.setAttribute("color", new THREE.Float32BufferAttribute(Cc, 3));
    G.computeBoundingSphere();
    return G;
  }
  function xf(g, x, y, z, rx, ry, rz) {
    const THREE = window.THREE;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, "XYZ"));
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    return g;
  }
  // a cylinder from p0 to p1
  function rod(p0, p1, r, seg, r1) {
    const THREE = window.THREE;
    const a = new THREE.Vector3(p0[0], p0[1], p0[2]), b = new THREE.Vector3(p1[0], p1[1], p1[2]);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r1 != null ? r1 : r, r, len, seg || 10);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    g.applyMatrix4(m);
    return g;
  }
  // a w x h bar from p0 to p1 (lying along the line), "up" kept as near +Y as it can be
  function bar(p0, p1, w, h) {
    const THREE = window.THREE;
    const a = new THREE.Vector3(p0[0], p0[1], p0[2]), b = new THREE.Vector3(p1[0], p1[1], p1[2]);
    const g = new THREE.BoxGeometry(w, h, a.distanceTo(b));
    const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 1, 0));
    m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    g.applyMatrix4(m);
    return g;
  }
  function onTop(x, z, lift) { return [x, topY(x, z) + (lift || 0), z]; }

  // ---- the loft: rows of the top and the belly at every span station --------------
  function stations() {
    const half = [];
    for (let x = 0; x <= 8.0001; x += 0.5) half.push(x);
    for (let x = 8.9; x < HALF; x += 0.9) half.push(x);
    half.push(7.0, 10.8, OUTER_X, HALF, GLASS_XC, GLASS_X, BAY_XI, BAY_XO, BT_X, BT_X + 0.03);
    SURF.forEach(function (s) { half.push(s.a - 0.03, s.a, s.b, s.b + 0.03); });
    const u = Array.from(new Set(half.filter(function (v) { return v <= HALF + 1e-6; })
      .map(function (v) { return Math.round(v * 1000) / 1000; }))).sort(function (a, b) { return a - b; });
    const out = [];
    for (let i = u.length - 1; i >= 1; i--) out.push(-u[i]);
    for (let i = 0; i < u.length; i++) out.push(u[i]);
    return out;
  }
  function nearestK(t) { let k = 0, e = 9; for (let i = 0; i < TS.length; i++) { const d = Math.abs(TS[i] - t); if (d < e) { e = d; k = i; } } return k; }

  function buildLoft() {
    const THREE = window.THREE;
    const S = stations(), NS = S.length, NC = TS.length - 1;
    // the bay openings: two columns of the belly are snapped onto the bay's
    // fore and aft edges so the cut-out is an exact rectangle
    const xb = (BAY_XI + BAY_XO) / 2;
    const kF = nearestK((BAY_D0 - leD(xb)) / chord(xb)), kB = nearestK((BAY_D1 - leD(xb)) / chord(xb));
    const top = [], bot = [], tH = [];
    for (let s = 0; s < NS; s++) {
      const x = S[s], tip = Math.abs(x) >= HALF - 1e-6, th = tHinge(x);
      tH.push(th);
      const rt = [], rb = [];
      for (let k = 0; k <= NC; k++) {
        const t = Math.min(TS[k], th);
        rt.push([x, tip ? CY : topAt(x, t), zOf(x, t), t]);
        let tb = t;
        if (Math.abs(x) <= 2.6) {
          if (k === kF) tb = clamp((BAY_D0 - leD(x)) / chord(x), TS[k - 1] + 0.005, TS[k + 1] - 0.005);
          if (k === kB) tb = clamp((BAY_D1 - leD(x)) / chord(x), TS[k - 1] + 0.005, TS[k + 1] - 0.005);
          tb = Math.min(tb, th);
        }
        rb.push([x, tip ? CY : botAt(x, tb), zOf(x, tb), tb]);
      }
      top.push(rt); bot.push(rb);
    }
    function inBay(xa, xc) {
      const a = Math.abs(xa), c = Math.abs(xc);
      return xa * xc >= 0 && a >= BAY_XI - 1e-6 && a <= BAY_XO + 1e-6 && c >= BAY_XI - 1e-6 && c <= BAY_XO + 1e-6;
    }
    // one piece of the wing between station indices i0..i1
    function piece(i0, i1, glass) {
      const P = [], U = [], I = [], IG = [];
      function v(p, belly) { P.push(p[0], p[1], p[2]); const uv = uvOf(p[0], p[2], belly); U.push(uv[0], uv[1]); return P.length / 3 - 1; }
      const T0 = [], B0 = [];
      for (let s = i0; s <= i1; s++) {
        T0.push(top[s].map(function (p) { return v(p, false); }));
        B0.push(bot[s].map(function (p) { return v(p, true); }));
      }
      for (let s = i0; s < i1; s++) {
        const j = s - i0;
        for (let k = 0; k < NC; k++) {
          const flat = top[s][k][3] === top[s][k + 1][3] && top[s + 1][k][3] === top[s + 1][k + 1][3];
          if (!flat) {
            const a = T0[j][k], b = T0[j][k + 1], c = T0[j + 1][k], d = T0[j + 1][k + 1];
            (glass && isGlass(S[s], S[s + 1], TS[k], TS[k + 1]) ? IG : I).push(a, c, b, b, c, d);
          }
          const flatB = bot[s][k][3] === bot[s][k + 1][3] && bot[s + 1][k][3] === bot[s + 1][k + 1][3];
          if (flatB) continue;
          if (k >= kF && k < kB && inBay(S[s], S[s + 1])) continue;       // the bay opening
          const e = B0[j][k], f = B0[j][k + 1], g = B0[j + 1][k], h = B0[j + 1][k + 1];
          I.push(e, f, g, f, h, g);
        }
        // the hinge wall: the body's aft face where a control surface is cut out
        if (tH[s] < 0.999 && tH[s + 1] < 0.999) {
          const p0 = v(top[s][NC], false), p1 = v(top[s + 1][NC], false), p2 = v(bot[s + 1][NC], true), p3 = v(bot[s][NC], true);
          I.push(p0, p1, p2, p0, p2, p3);
        }
      }
      function mk(idx, lift) {
        if (!idx.length) return null;
        let arr = P;
        if (lift) { arr = P.slice(); for (let i = 1; i < arr.length; i += 3) arr[i] += lift; }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        g.computeBoundingSphere();
        return g;
      }
      return { skin: mk(I, 0), glass: glass ? mk(IG, 0.012) : null };
    }
    let iL = 0, iR = NS - 1;
    for (let s = 0; s < NS; s++) if (Math.abs(S[s] + OUTER_X) < 1e-6) iL = s;
    for (let s = 0; s < NS; s++) if (Math.abs(S[s] - OUTER_X) < 1e-6) iR = s;
    return {
      centre: piece(iL, iR, true),
      port: piece(iR, NS - 1, false).skin,         // +X outer panel
      stbd: piece(0, iL, false).skin,              // -X outer panel
      S: S,
    };
  }

  // ---- a control surface between x0 and x1 (signed, ascending) --------------------
  function buildSurface(x0, x1, part, S) {
    const THREE = window.THREE;
    const xs = [x0];
    for (let i = 0; i < S.length; i++) if (S[i] > x0 + 1e-4 && S[i] < x1 - 1e-4) xs.push(S[i]);
    xs.push(x1);
    const NU = 5, P = [], U = [], I = [];
    function v(x, y, z, belly) { P.push(x, y, z); const uv = uvOf(x, z, belly); U.push(uv[0], uv[1]); return P.length / 3 - 1; }
    function mid(x, t) { return (topAt(x, t) + botAt(x, t)) / 2; }
    const up = part !== "lower", lo = part !== "upper";
    const rowsT = [], rowsB = [];
    xs.forEach(function (x) {
      const th = tHinge(x), rt = [], rb = [];
      for (let k = 0; k <= NU; k++) {
        const t = Math.min(0.9999, th + (1 - th) * k / NU), z = zOf(x, t);
        const tip = k === NU;
        const yT = tip ? CY : (up ? topAt(x, t) : mid(x, t));
        const yB = tip ? CY : (lo ? botAt(x, t) : mid(x, t));
        rt.push(v(x, yT, z, false)); rb.push(v(x, yB, z, true));
      }
      rowsT.push(rt); rowsB.push(rb);
    });
    for (let s = 0; s < xs.length - 1; s++) {
      for (let k = 0; k < NU; k++) {
        const a = rowsT[s][k], b = rowsT[s][k + 1], c = rowsT[s + 1][k], d = rowsT[s + 1][k + 1];
        I.push(a, c, b, b, c, d);
        const e = rowsB[s][k], f = rowsB[s][k + 1], g = rowsB[s + 1][k], h = rowsB[s + 1][k + 1];
        I.push(e, f, g, f, h, g);
      }
      // the front (hinge) face, facing forward
      const p0 = rowsT[s][0], p1 = rowsT[s + 1][0], p2 = rowsB[s + 1][0], p3 = rowsB[s][0];
      I.push(p0, p2, p1, p0, p3, p2);
    }
    // the end caps
    for (let e = 0; e < 2; e++) {
      const s = e ? xs.length - 1 : 0, T0 = rowsT[s], B0 = rowsB[s];
      for (let k = 0; k < NU; k++) {
        if (e === 0) I.push(T0[k], T0[k + 1], B0[k + 1], T0[k], B0[k + 1], B0[k]);
        else I.push(T0[k], B0[k + 1], T0[k + 1], T0[k], B0[k], B0[k + 1]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    // the pivot frame: X along the hinge line, Y up, origin at x0's hinge point
    const h0 = new THREE.Vector3(x0, mid(x0, tHinge(x0)), zOf(x0, tHinge(x0)));
    const h1 = new THREE.Vector3(x1, mid(x1, tHinge(x1)), zOf(x1, tHinge(x1)));
    const X = h1.clone().sub(h0).normalize();
    const Y = new THREE.Vector3(0, 1, 0).addScaledVector(X, -X.y).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const M = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(h0);
    const inv = M.clone().invert();
    g.applyMatrix4(inv);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    // which way is trailing-edge DOWN about +X?
    const te = new THREE.Vector3((x0 + x1) / 2, CY, zOf((x0 + x1) / 2, 0.999)).applyMatrix4(inv);
    const y0 = te.clone().applyMatrix4(M).y;
    const y1 = te.clone().applyMatrix4(new THREE.Matrix4().makeRotationX(0.1)).applyMatrix4(M).y;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    M.decompose(pos, q, sc);
    return { geo: g, pos: pos, quat: q, sgn: y1 < y0 ? 1 : -1 };
  }

  // ---- the bay doors: conforming leaves on the belly, in hinge space ------------------
  function buildDoor(xh, xf2) {
    const THREE = window.THREE;
    const NX = 4, NZ = 10, P = [], U = [], I = [];
    const z0 = APEX - BAY_D0, z1 = APEX - BAY_D1;
    const yh = botY(xh, BAY_ZM) - 0.008;
    for (let i = 0; i <= NX; i++) {
      const x = xh + (xf2 - xh) * i / NX;
      for (let j = 0; j <= NZ; j++) {
        const z = z0 + (z1 - z0) * j / NZ;
        P.push(x - xh, botY(x, z) - 0.008 - yh, z - BAY_ZM);
        const uv = uvOf(x, z, true); U.push(uv[0], uv[1]);
      }
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const a = i * (NZ + 1) + j, b = a + 1, c = a + NZ + 1, d = c + 1;
      I.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return { geo: g, pos: [xh, yh, BAY_ZM], open: xf2 < xh ? 1 : -1 };
  }

  // ---- a 2,000 lb JDAM (nose +Z, centred on its lugs) ------------------------------------
  function buildBomb(pen) {
    const THREE = window.THREE;
    const L = pen ? 3.77 : 3.88, R = pen ? 0.185 : 0.229;
    const parts = [];
    // the body: JDAM tail cone, the bomb case, the ogive (penetrators are blunter)
    const prof = pen
      ? [[0, 0.11], [0.08, 0.15], [0.95, 0.185], [1.05, R], [2.9, R], [3.3, 0.17], [3.6, 0.11], [3.75, 0.05], [3.77, 0]]
      : [[0, 0.12], [0.1, 0.16], [0.9, 0.2], [1.1, R], [2.75, R], [3.2, 0.19], [3.55, 0.12], [3.8, 0.05], [3.88, 0]];
    const pts = prof.map(function (p) { return new THREE.Vector2(p[1], p[0] - L / 2); });
    pts.unshift(new THREE.Vector2(0, -L / 2));
    const lathe = new THREE.LatheGeometry(pts, 16);
    lathe.rotateX(PI / 2);                       // lathe Y -> model Z (nose +Z)
    parts.push(paintG(lathe, function (x, y, z) {
      const s = z + L / 2;
      if (s < 1.0) return C.jdam;                // the JDAM tail kit
      if (Math.abs(s - (pen ? 3.05 : 2.95)) < 0.05) return C.band;   // yellow HE band
      return pen ? C.blu : C.mk84;
    }));
    // four tail fins in an X, and the mid-body strakes
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + i * PI / 2;
      const fin = new THREE.Shape();
      fin.moveTo(0, 0); fin.lineTo(0.42, 0); fin.lineTo(0.36, 0.3); fin.lineTo(0.12, 0.3); fin.lineTo(0, 0);
      const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.012, bevelEnabled: false });
      // shape X = along the bomb, shape Y = out from the axis
      fg.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(a), Math.sin(a), 0), new THREE.Vector3(-Math.sin(a), Math.cos(a), 0)));
      xf(fg, Math.cos(a) * 0.12, Math.sin(a) * 0.12, -L / 2 + 0.05);
      parts.push(paintG(fg, C.jdam));
      const st = new THREE.BoxGeometry(0.012, 0.07, 0.5);
      xf(st, Math.cos(a) * (R + 0.03), Math.sin(a) * (R + 0.03), 0.35, 0, 0, a - PI / 2);
      parts.push(paintG(st, C.jdam));
    }
    // the suspension lugs on top
    [-0.38, 0.38].forEach(function (z) { const lg = new THREE.BoxGeometry(0.05, 0.06, 0.08); xf(lg, 0, R + 0.02, z); parts.push(paintG(lg, C.jdam)); });
    return mergeG(parts);
  }

  // ---- the skin paint, one canvas per page, drawn from the same planform ----------------
  function skinTexture() {
    const THREE = window.THREE;
    if (typeof document === "undefined" || !document.createElement) return null;
    const W = 2048, H = 1024, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext && cv.getContext("2d");
    if (!c) return null;
    function hex(h) { return "#" + h.toString(16).padStart(6, "0"); }
    function P(x, d, belly) { const uv = uvOf(x, APEX - d, belly); return [uv[0] * W, (1 - uv[1]) * H]; }
    function path(pts, belly) { c.beginPath(); for (let i = 0; i < pts.length; i++) { const p = P(pts[i][0], pts[i][1], belly); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); } }
    const pxm = W / (2 * HALF);                  // canvas px per metre across
    function outline() {
      const pts = [];
      for (let x = -HALF; x <= HALF + 1e-6; x += 0.25) pts.push([x, leD(x)]);
      for (let x = HALF; x >= -HALF - 1e-6; x -= 0.25) pts.push([x, teD(x)]);
      return pts;
    }
    // a door: straight sides, sawtooth ends (radar returns go sideways, not back)
    function zig(x0, x1, d0, d1, n) {
      const pts = [], w = (x1 - x0) / n;
      for (let i = 0; i <= n * 2; i++) pts.push([x0 + w * i / 2, d0 - (i % 2 ? 0.3 : 0)]);
      for (let i = n * 2; i >= 0; i--) pts.push([x0 + w * i / 2, d1 + (i % 2 ? 0.3 : 0)]);
      pts.push(pts[0]);
      return pts;
    }
    function dOf(x, t) { return leD(x) + t * chord(x); }
    let seed = 1337;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (let half = 0; half < 2; half++) {
      const belly = half === 1;
      c.save();
      path(outline(), belly); c.closePath();
      c.fillStyle = hex(belly ? C.belly : C.skin); c.fill();
      c.clip();
      // RAM ages in patches: very low-contrast blotches, and the tape/putty
      // over the seams reads a hair lighter than the panels it closes
      for (let i = 0; i < 320; i++) {
        const x = (rnd() * 2 - 1) * 25, d = rnd() * 20.5, r = 0.5 + rnd() * 2.4;
        const p = P(x, d, belly);
        c.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.026)";
        c.beginPath(); c.ellipse(p[0], p[1], r * pxm, r * pxm * 0.8, rnd() * 3, 0, TAU); c.fill();
      }
      // the leading-edge treatment: a lighter band all along the LE
      c.lineWidth = 0.9 * pxm; c.strokeStyle = "rgba(200,206,214,0.09)";
      const le = []; for (let x = -HALF; x <= HALF + 1e-6; x += 0.25) le.push([x, leD(x) + 0.4]);
      path(le, belly); c.stroke();
      // spanwise structure seams, parallel to the leading edge
      c.strokeStyle = "rgba(12,14,17,0.32)"; c.lineWidth = 1.2;
      [2.0, 4.6, 7.8, 11.4].forEach(function (off) {
        const ln = [];
        for (let x = -HALF; x <= HALF + 1e-6; x += 0.25) { const d = leD(x) + off; if (d < teD(x) - 0.9) ln.push([x, d]); else if (ln.length) break; }
        if (ln.length > 2) { path(ln, belly); c.stroke(); }
      });
      // chordwise rib seams (outer panels) and the panel joint at the outer notch
      [OUTER_X, 21.0, 24.0, 13.5, 9.0].forEach(function (x) {
        [-1, 1].forEach(function (s) { path([[s * x, leD(x) + 0.5], [s * x, teD(x) - 0.2]], belly); c.stroke(); });
      });
      path([[0, 0.5], [0, LEN - 0.4]], belly); c.stroke();     // centreline
      // the control-surface hinge lines (the parts are cut there; the paint
      // keeps the seam crisp)
      c.strokeStyle = "rgba(8,9,11,0.6)"; c.lineWidth = 1.4;
      SURF.forEach(function (S0) {
        [-1, 1].forEach(function (s) {
          const pts = []; for (let x = S0.a; x <= S0.b + 1e-6; x += 0.25) pts.push([s * x, teD(x) - S0.depth]);
          path(pts, belly); c.stroke();
        });
      });
      path([[-BT_X, BT_D], [BT_X, BT_D]], belly); c.stroke();
      if (!belly) {
        // the cockpit surround, sawtooth-edged
        c.strokeStyle = "rgba(10,12,14,0.55)"; c.lineWidth = 1.4;
        path(zig(-2.4, 2.4, 1.0, 5.4, 4), false); c.stroke();
        // the refuelling receptacle on the spine (and its lead-in lines)
        path(zig(-0.45, 0.45, 6.8, 7.5, 1), false); c.stroke();
        c.strokeStyle = "rgba(225,228,230,0.10)"; c.lineWidth = 0.6 * pxm;
        path([[0, 7.6], [0, 9.8]], false); c.stroke();
        for (const s of [-1, 1]) {
          const ex = s * ENG_X;
          c.strokeStyle = "rgba(10,12,14,0.55)"; c.lineWidth = 1.3;
          // nacelle access panels and the auxiliary inlet doors behind the lip
          path(zig(ex - 1.9, ex + 1.9, dOf(ex, 0.24), dOf(ex, 0.56), 3), false); c.stroke();
          path(zig(ex - 0.6, ex + 0.6, dOf(ex, 0.235), dOf(ex, 0.28), 2), false); c.stroke();
          path(zig(ex - 0.7, ex + 0.7, dOf(ex, 0.10), dOf(ex, 0.13), 2), false); c.stroke();
          // THE EXHAUST DECK: heat tiles (lighter, gridded), soot fanning aft
          const d0 = dOf(ex, EX_T0 + 0.01), d1 = teD(ex) - 0.05;
          const pa = P(ex - 1.05, d0, false), pb = P(ex + 1.05, d1, false);
          const rx = Math.min(pa[0], pb[0]), ry = Math.min(pa[1], pb[1]), rw = Math.abs(pb[0] - pa[0]), rh = Math.abs(pb[1] - pa[1]);
          c.fillStyle = "#77736b"; c.fillRect(rx, ry, rw, rh);
          c.strokeStyle = "rgba(40,38,34,0.55)"; c.lineWidth = 1;
          for (let d = d0; d < d1; d += 0.5) { path([[ex - 1.05, d], [ex + 1.05, d]], false); c.stroke(); }
          for (let x = ex - 1.05; x <= ex + 1.06; x += 0.35) { path([[x, d0], [x, d1]], false); c.stroke(); }
          const gr = c.createLinearGradient(0, ry, 0, ry + rh);
          gr.addColorStop(0, "rgba(20,18,16,0.05)"); gr.addColorStop(1, "rgba(20,18,16,0.45)");
          c.fillStyle = gr; c.fillRect(rx - 0.4 * pxm, ry, rw + 0.8 * pxm, rh);
          // outboard access doors, sawtoothed
          path(zig(s * 9.4 - 0.9, s * 9.4 + 0.9, dOf(s * 9.4, 0.3), dOf(s * 9.4, 0.42), 2), false); c.stroke();
          path(zig(s * 14.5 - 0.7, s * 14.5 + 0.7, dOf(s * 14.5, 0.25), dOf(s * 14.5, 0.38), 2), false); c.stroke();
        }
      } else {
        c.strokeStyle = "rgba(8,9,11,0.65)"; c.lineWidth = 1.4;
        for (const s of [-1, 1]) {
          // the two bays (four leaves), sawtooth ends drawn past the cut
          const xi = s * BAY_XI, xo = s * BAY_XO;
          path(zig(Math.min(xi, xo), Math.max(xi, xo), BAY_D0, BAY_D1, 4), true); c.stroke();
          path([[s * (BAY_XI + BAY_XO) / 2, BAY_D0], [s * (BAY_XI + BAY_XO) / 2, BAY_D1]], true); c.stroke();
          // main gear doors
          path(zig(s * MAIN_X - 1.0, s * MAIN_X + 1.0, MAIN_D - 2.3, MAIN_D + 2.3, 2), true); c.stroke();
          // weapons-bay / avionics access panels outboard
          path(zig(s * 3.4 - 0.6, s * 3.4 + 0.6, 7.5, 9.2, 2), true); c.stroke();
        }
        path(zig(-0.55, 0.55, NOSE_D - 1.6, NOSE_D + 1.4, 1), true); c.stroke();     // nose gear doors
      }
      c.restore();
    }
    const tex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  }

  // ---- a seated crewman in a flight suit and an HGU-55 helmet (sitting at x, floor y, seat back z) ----
  function crewman(parts, x, y, z) {
    const THREE = window.THREE;
    function add(g, col) { parts.push(paintG(g, col)); }
    add(xf(new THREE.CylinderGeometry(0.17, 0.2, 0.6, 10), x, y + 0.72, z + 0.12, -0.12), C.suit);           // torso
    add(xf(new THREE.BoxGeometry(0.36, 0.14, 0.46), x, y + 0.42, z + 0.34), C.suit);                         // thighs
    add(xf(new THREE.BoxGeometry(0.3, 0.42, 0.12), x, y + 0.2, z + 0.6), C.suit);                            // shins
    add(xf(new THREE.SphereGeometry(0.1, 10, 8), x, y + 1.1, z + 0.16), C.skinT);                            // face
    add(xf(new THREE.SphereGeometry(0.135, 12, 9, 0, TAU, 0, PI * 0.62), x, y + 1.12, z + 0.13), C.helmet);  // helmet shell
    add(xf(new THREE.BoxGeometry(0.2, 0.06, 0.04), x, y + 1.1, z + 0.26), C.visor);                          // tinted visor
    add(xf(new THREE.BoxGeometry(0.1, 0.07, 0.07), x, y + 1.0, z + 0.26), C.helmet);                         // oxygen mask
    [-1, 1].forEach(function (s) {
      add(rod([x + s * 0.21, y + 0.96, z + 0.12], [x + s * 0.24, y + 0.66, z + 0.3], 0.05, 6), C.suit);       // upper arm
      add(rod([x + s * 0.24, y + 0.66, z + 0.3], [x + s * 0.14, y + 0.6, z + 0.6], 0.045, 6), C.suit);        // forearm to the stick / throttle
    });
  }

  function template() {
    if (TPL) return TPL;
    const THREE = window.THREE;
    if (!THREE || !THREE.BufferGeometry) return null;
    const L = buildLoft();
    const G = { centre: L.centre.skin, glass: L.centre.glass, port: L.port, stbd: L.stbd };
    // ---- control surfaces ----
    G.surf = [];
    const bt = buildSurface(-BT_X, BT_X, "full", L.S);
    G.surf.push({ id: "beaver", side: 0, roll: 0, outer: false, parts: [bt] });
    SURF.forEach(function (s) {
      [1, -1].forEach(function (side) {
        const x0 = side > 0 ? s.a : -s.b, x1 = side > 0 ? s.b : -s.a;
        const parts = s.split ? [buildSurface(x0, x1, "upper", L.S), buildSurface(x0, x1, "lower", L.S)] : [buildSurface(x0, x1, "full", L.S)];
        G.surf.push({ id: s.id, side: side, roll: s.roll, outer: !!s.outer, split: !!s.split, parts: parts });
      });
    });
    // ---- inlets (the serrated slit) and nozzle slots: dark sheets on the loft ----
    {
      const P = [], I = [];
      function strip(rowA, rowB) {
        const base = P.length / 3;
        for (let i = 0; i < rowA.length; i++) { P.push(rowA[i][0], rowA[i][1], rowA[i][2]); P.push(rowB[i][0], rowB[i][1], rowB[i][2]); }
        for (let i = 0; i < rowA.length - 1; i++) { const a = base + i * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      [-1, 1].forEach(function (s) {
        const A = [], B = [], NA = 16;
        for (let i = 0; i <= NA; i++) {
          const x = s * ENG_X + (i / NA - 0.5) * 3.5;
          const zig = (i % 2 ? 1 : -1) * 0.22 * engX(x);
          const tb = IN_T0 - 0.004, zl = zOf(x, IN_T1 + 0.004) + zig;
          A.push([x, topAt(x, tb) + 0.012, zOf(x, tb)]);
          B.push([x, topY(x, zl) + 0.03, zl]);
        }
        strip(A, B);
        const A2 = [], B2 = [], NB = 10;
        for (let i = 0; i <= NB; i++) {
          const x = s * ENG_X + (i / NB - 0.5) * 2.0;
          A2.push([x, topAt(x, EX_T1) + 0.012, zOf(x, EX_T1)]);
          B2.push([x, topAt(x, EX_T0 - 0.004) + 0.012, zOf(x, EX_T0 - 0.004)]);
        }
        strip(A2, B2);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setIndex(I); g.computeVertexNormals(); g.computeBoundingSphere();
      G.mouth = g;
    }
    // ---- the airframe's fittings (vertex-coloured, one draw) ----
    {
      const parts = [], crewParts = [];
      function add(g, col) { parts.push(paintG(g, col)); }
      [-1, 1].forEach(function (s) {
        // the boundary-layer splitter plate ahead of each inlet
        const ex = s * ENG_X;
        add(bar(onTop(ex - 1.2, zOf(ex, 0.13), 0.03), onTop(ex + 1.2, zOf(ex, 0.13), 0.03), 0.4, 0.04), C.dark);
        // blade antennas under the centrebody, the static ports, the pitot-free nose
        add(xf(new THREE.BoxGeometry(0.03, 0.22, 0.32), s * 1.6, botY(s * 1.6, APEX - 15.5) - 0.11, APEX - 15.5), C.dark);
      });
      // the flight deck interior: floor, bulkhead, side walls, panel, consoles, seats
      const D = topY(0, APEX - 6.0) - 1.55;      // the cabin floor
      const deck = function (x, y, z, w, h, d, col, rx) { add(xf(new THREE.BoxGeometry(w, h, d), x, D + y, APEX - z, rx || 0), col); };
      deck(0, -0.03, 4.25, 2.9, 0.12, 3.4, C.dark);                 // floor
      deck(0, 0.6, 5.9, 2.9, 1.2, 0.14, C.dark);                    // rear bulkhead
      deck(1.44, 0.4, 4.6, 0.12, 0.8, 2.5, C.dark); deck(-1.44, 0.4, 4.6, 0.12, 0.8, 2.5, C.dark);
      deck(0, 0.82, 3.05, 1.8, 0.13, 0.46, C.dark, 0.42);           // glareshield
      deck(0, 0.24, 4.2, 0.4, 0.3, 1.3, C.dark);                    // centre console
      [-0.62, 0.62].forEach(function (x) {
        deck(x, 0.2, 4.45, 0.6, 0.16, 0.62, C.seat);                // ACES II seat pan
        deck(x, 0.66, 4.82, 0.6, 0.94, 0.14, C.seat, -0.14);        // seat back
        deck(x, 1.16, 4.88, 0.34, 0.22, 0.16, C.seat);              // headbox
        crewman(crewParts, x, D + 0.28, APEX - 4.45);
      });
      // the four-pane frame: posts and cross frames seated on the skin
      const F = function (x0, t0, x1, t1, w) { add(bar(onTop(x0, zOf(x0, t0), 0.03), onTop(x1, zOf(x1, t1), 0.03), w || 0.08, 0.06), C.frame); };
      F(0, 0.215, 0, 0.07, 0.09);
      [-1, 1].forEach(function (s) {
        const xc = s * GLASS_XC, xo = s * GLASS_X;
        F(xc, 0.215, xc, 0.07, 0.1); F(xo, 0.19, xo, 0.095, 0.1);
        F(0, 0.07, xc, 0.07); F(0, 0.215, xc, 0.215); F(xc, 0.095, xo, 0.095); F(xc, 0.19, xo, 0.19);
        F(xc, 0.07, xc, 0.095); F(xc, 0.215, xc, 0.19);
      });
      G.parts = mergeG(parts);
      // the two crew are their own mesh: a host empties a parked B-2
      G.crew = mergeG(crewParts);
      const glow = [];
      const gl = function (x, y, z, w, h, d, rx) { glow.push(paintG(xf(new THREE.BoxGeometry(w, h, d), x, D + y, APEX - z, rx || 0), C.glow)); };
      gl(0, 0.52, 3.2, 1.72, 0.5, 0.09, 0.42);                      // the main panel (four MFDs)
      gl(-0.52, 0.56, 3.3, 0.32, 0.26, 0.06, 0.42); gl(0.52, 0.56, 3.3, 0.32, 0.26, 0.06, 0.42);
      gl(0, 0.44, 3.78, 0.3, 0.1, 0.34, 0.25);                      // throttle quadrant lights
      gl(0, 1.38, 4.6, 1.2, 0.1, 0.76, -0.2);                       // overhead panel
      G.glow = mergeG(glow);
    }
    // ---- the gear (own group: it retracts) ----
    {
      const parts = [], holes = [];
      function add(g, col) { parts.push(paintG(g, col)); }
      function wheel(x, z, r, w) {
        add(xf(new THREE.CylinderGeometry(r, r, w, 20), x, r, z, 0, 0, PI / 2), C.tire);
        add(xf(new THREE.CylinderGeometry(r * 0.56, r * 0.56, w + 0.02, 14), x, r, z, 0, 0, PI / 2), C.hub);
      }
      // nose: oleo, drag brace, axle, twin wheels, the two doors either side
      {
        const z = APEX - NOSE_D, yb = botY(0, z);
        add(rod([0, yb, z], [0, 0.45, z], 0.13), C.gear);
        add(rod([0, 0.85, z], [0, yb - 0.1, z - 1.3], 0.06), C.gear);
        add(rod([-0.32, 0.45, z], [0.32, 0.45, z], 0.07), C.gear);
        wheel(-0.36, z, 0.45, 0.3); wheel(0.36, z, 0.45, 0.3);
        [-1, 1].forEach(function (s) { add(xf(new THREE.BoxGeometry(0.05, 0.9, 2.6), s * 0.58, yb - 0.45, z + 0.2), C.belly); });
        const wg = new THREE.PlaneGeometry(1.1, 3.0); wg.rotateX(PI / 2); xf(wg, 0, yb - 0.012, z + 0.1); holes.push(paintG(wg, C.well));
      }
      [-1, 1].forEach(function (s) {
        const x = s * MAIN_X, z = APEX - MAIN_D, yb = botY(x, z);
        add(rod([x, yb, z], [x, 0.9, z], 0.2), C.gear);                         // oleo
        add(rod([x, 1.4, z], [x - s * 0.1, yb - 0.05, z - 1.6], 0.08), C.gear); // drag brace
        add(rod([x, yb - 0.1, z + 0.2], [x + s * 0.9, yb - 0.1, z + 0.2], 0.06), C.gear);
        add(rod([x, 0.62, z - 1.25], [x, 0.62, z + 1.25], 0.15), C.gear);       // bogie beam
        [-1, 1].forEach(function (a) { wheel(x - 0.42, z + a * 0.95, 0.58, 0.36); wheel(x + 0.42, z + a * 0.95, 0.58, 0.36); });
        // the big main door hangs vertical outboard of the leg
        const dg = new THREE.BoxGeometry(0.06, 1.9, 4.2);
        add(xf(dg, x + s * 1.15, yb - 0.97, z), C.belly);
        const wg = new THREE.PlaneGeometry(1.9, 4.3); wg.rotateX(PI / 2); xf(wg, x, yb - 0.012, z); holes.push(paintG(wg, C.well));
      });
      G.gear = mergeG(parts);
      G.wells = mergeG(holes);
    }
    // ---- the bays: inner walls, doors, rotary launchers, bombs ----
    {
      const walls = [];
      G.doors = [];
      [-1, 1].forEach(function (s) {
        const cx = s * (BAY_XI + BAY_XO) / 2, yb = botY(cx, BAY_ZM);
        const h = 2.1;
        const box = new THREE.BoxGeometry(BAY_XO - BAY_XI - 0.04, h, BAY_L - 0.06);
        xf(box, cx, yb + h / 2 - 0.02, BAY_ZM);
        walls.push(paintG(box, C.well));
        G.doors.push(buildDoor(s * BAY_XO, cx));
        G.doors.push(buildDoor(s * BAY_XI, cx));
      });
      G.bayWalls = mergeG(walls);
      // the rotary launcher: a beam on the bay axis, two eight-armed spiders
      const rp = [];
      rp.push(paintG(xf(new THREE.CylinderGeometry(0.11, 0.11, BAY_L - 0.4, 10), 0, 0, 0, PI / 2), C.rla));
      [-1, 1].forEach(function (e) {
        const ring = new THREE.CylinderGeometry(RLA_R + 0.06, RLA_R + 0.06, 0.06, 8, 1, true);
        xf(ring, 0, 0, e * (BAY_L / 2 - 0.5), PI / 2, 0, PI / 8);
        rp.push(paintG(ring, C.rla));
        for (let i = 0; i < 8; i++) {
          const a = -PI / 2 + i * PI / 4;
          rp.push(paintG(rod([0, 0, e * 1.2], [Math.cos(a) * (RLA_R - 0.2), Math.sin(a) * (RLA_R - 0.2), e * 1.2], 0.03, 6), C.rla));
        }
      });
      G.rla = mergeG(rp);
      G.bomb = [buildBomb(true), buildBomb(false)];
    }
    // ---- lights: port red, starboard green (wingtips), white tail ----
    {
      const L2 = [];
      [1, -1].forEach(function (s) {
        const x = s * (HALF - 0.6), z = zOf(x, 0.45);
        L2.push(paintG(xf(new THREE.SphereGeometry(0.11, 8, 6), x, topY(x, z) + 0.05, z), s > 0 ? 0xff3a2e : 0x2fe07a));
      });
      L2.push(paintG(xf(new THREE.SphereGeometry(0.12, 8, 6), 0, topY(0, APEX - 18.5) + 0.06, APEX - 18.5), 0xf2f4ff));
      G.lamps = mergeG(L2);
    }
    // ---- the insignia patches: conforming grids on the upper port / lower starboard wing ----
    function patch(xc, dc, w, h, belly) {
      const NX = 6, NZ = 4, P = [], U = [], I = [];
      for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) {
        const x = xc + (i / NX - 0.5) * w, z = APEX - dc + (0.5 - j / NZ) * h;
        P.push(x, belly ? botY(x, z) - 0.015 : topY(x, z) + 0.015, z);
        // the flag reads hoist-forward on top; mirrored under the belly so it reads from below
        U.push(belly ? i / NX : 1 - i / NX, 1 - j / NZ);
      }
      for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
        const a = i * (NZ + 1) + j, b = a + 1, c = a + NZ + 1, d = c + 1;
        if (belly) I.push(a, b, c, b, d, c); else I.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
      g.setIndex(I); g.computeVertexNormals(); g.computeBoundingSphere();
      return g;
    }
    const xi = 20.0, di = leD(xi) + 0.5 * chord(xi);
    G.insTop = patch(xi, di, 1.8, 1.2, false);
    G.insBot = patch(-xi, di, 1.8, 1.2, true);

    // ---- materials ----
    const tex = skinTexture();
    const M = {};
    M.skin = new THREE.MeshPhongMaterial({ color: tex ? 0xffffff : C.skin, map: tex || null, shininess: 14, specular: 0x23272c });
    M.skin2 = M.skin.clone(); M.skin2.side = THREE.DoubleSide;
    M.vc = new THREE.MeshLambertMaterial({ vertexColors: true });
    M.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    M.glass = new THREE.MeshPhongMaterial({ color: 0x1b2633, specular: 0xc8b070, shininess: 90, transparent: true, opacity: 0.58, depthWrite: false });
    M.mouth = new THREE.MeshBasicMaterial({ color: 0x050607, side: THREE.DoubleSide });
    M.hole = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    M.bay = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.BackSide });
    for (const k in M) M[k]._shared = true;
    TPL = { G: G, M: M };
    return TPL;
  }

  // ---- the low-visibility national insignia --------------------------------------------
  const FLAGM = Object.create(null);
  function flagMat(id, design) {
    if (FLAGM[id] !== undefined) return FLAGM[id];
    const THREE = window.THREE, F = CBZ.flags;
    let m = null;
    try {
      const d = design || (F && F.designFor ? F.designFor(id) : null);
      if (THREE && F && F.paint && d && typeof document !== "undefined") {
        const cv = document.createElement("canvas"); cv.width = 192; cv.height = 128;
        const g = cv.getContext && cv.getContext("2d");
        if (g) {
          F.paint(g, d, 192, 128, { grain: false });
          // low-vis: the design kept as tone only, pulled most of the way into the skin grey
          g.globalCompositeOperation = "saturation"; g.fillStyle = "#808080"; g.fillRect(0, 0, 192, 128);
          g.globalCompositeOperation = "source-over"; g.fillStyle = "rgba(75,81,88,0.62)"; g.fillRect(0, 0, 192, 128);
          const t = new THREE.CanvasTexture(cv);
          if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
          m = new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -2 });
          m._shared = true;
        }
      }
    } catch (e) { m = null; }
    return (FLAGM[id] = m);
  }

  // =====================================================================
  //  BUILD: one airframe, every geometry and material shared
  // =====================================================================
  function build(ctx) {
    const TP = template();
    if (!TP) return null;
    const THREE = window.THREE, G = TP.G, M = TP.M;
    const root = new THREE.Group(); root.name = "b2-spirit";
    const lean = new THREE.Group(); lean.name = "b2-lean"; root.add(lean);
    function mesh(geo, mat, parent, shadow) {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow !== false; m.receiveShadow = shadow !== false;
      parent.add(m); return m;
    }
    const skins = [];
    skins.push(mesh(G.centre, M.skin, lean));
    mesh(G.glass, M.glass, lean, false);
    mesh(G.mouth, M.mouth, lean, false);
    mesh(G.parts, M.vc, lean);
    const crewMesh = mesh(G.crew, M.vc, lean, false);
    mesh(G.glow, M.glow, lean, false);
    // the outer panels hang off the outer notch so a kill can tear one away
    const wings = {};
    [1, -1].forEach(function (s) {
      const z0 = zOf(OUTER_X, 0.5);
      const pv = new THREE.Group(); pv.name = "b2-wing" + (s > 0 ? "P" : "S");
      pv.position.set(s * OUTER_X, CY, z0); lean.add(pv);
      const inner = new THREE.Group(); inner.position.set(-s * OUTER_X, -CY, -z0); pv.add(inner);
      skins.push(mesh(s > 0 ? G.port : G.stbd, M.skin, inner));
      wings[s] = { pivot: pv, inner: inner };
    });
    // control surfaces: pivot on the hinge line, a flap that rotates about it
    const surfs = [];
    for (let i = 0; i < G.surf.length; i++) {
      const S = G.surf[i];
      const parent = S.outer ? wings[S.side].inner : lean;
      const flaps = [];
      for (let p = 0; p < S.parts.length; p++) {
        const part = S.parts[p];
        const pv = new THREE.Group(); pv.position.copy(part.pos); pv.quaternion.copy(part.quat); parent.add(pv);
        const flap = new THREE.Group(); pv.add(flap);
        skins.push(mesh(part.geo, M.skin, flap));
        flaps.push({ node: flap, sgn: part.sgn });
      }
      surfs.push({ id: S.id, side: S.side, roll: S.roll, split: S.split, flaps: flaps, d: 0, o: 0 });
    }
    // insignia
    const ins = [mesh(G.insTop, M.vc, wings[1].inner, false), mesh(G.insBot, M.vc, wings[-1].inner, false)];
    ins[0].visible = ins[1].visible = false;
    // gear
    const gear = new THREE.Group(); gear.name = "gear"; lean.add(gear);
    mesh(G.gear, M.vc, gear); mesh(G.wells, M.hole, gear, false);
    // bays
    const bayWalls = mesh(G.bayWalls, M.bay, lean, false);
    bayWalls.visible = false;
    const doors = [];
    for (let i = 0; i < G.doors.length; i++) {
      const D = G.doors[i];
      const pv = new THREE.Group(); pv.position.set(D.pos[0], D.pos[1], D.pos[2]); lean.add(pv);
      skins.push(mesh(D.geo, M.skin2, pv));
      doors.push({ node: pv, open: D.open, bay: D.pos[0] > 0 ? 0 : 1 });
    }
    const bays = [];
    [1, -1].forEach(function (s, bi) {
      const cx = s * (BAY_XI + BAY_XO) / 2, ringY = botY(cx, BAY_ZM) + RLA_R + 0.3;
      const rla = new THREE.Group(); rla.name = "b2-rla" + bi;
      rla.position.set(cx, ringY, BAY_ZM); lean.add(rla);
      mesh(G.rla, M.vc, rla, false);
      const bombs = [];
      for (let i = 0; i < 8; i++) {
        const a = -PI / 2 + i * PI / 4;
        const b = mesh(G.bomb[bi], M.vc, rla);
        b.position.set(Math.cos(a) * RLA_R, Math.sin(a) * RLA_R, 0);
        bombs.push({ mesh: b, slot: i, home: b.position.clone() });
      }
      bays.push({ rla: rla, bombs: bombs, next: 0, rot: 0, open: 0, req: -1e9, hold: 0 });
    });
    const lamps = mesh(G.lamps, M.glow, lean, false);

    const R = {
      group: root, lean: lean, wings: wings, surfs: surfs, gear: gear, doors: doors, bays: bays, bayWalls: bayWalls,
      lamps: lamps, skins: skins, ins: ins, falls: [], veh: null,
      clock: 0, px: 0, py: 0, pz: 0, h0: 0, vx: 0, vz: 0, vy: 0, gam0: 0, gamRate: 0, yawRate: 0, bank: 0, bankRate: 0,
      agl: 0, flying: false, gearK: 1, dead: false, crashed: false, torn: 0, tornT: 0, scorched: false,
      hit: 0, fire: false, smokeT: 0, seeded: false, seed: (ctx && ctx.seed) || 0, groundAt: null,
    };
    const rig = {
      turret: null,
      settle: function () { R.seeded = false; tick(R, true, 0, null); },
      muzzleWorld: function (out, shot) { return muzzle(R, out, shot); },
      fire: function (shot) { fire(R, shot); },
      canFire: function (shot) { return canFire(R, shot); },
      reload: function () { /* a B-2 lands to rearm: the salvo cadence is not a reload */ },
      damage: function (vs, res) { damage(R, vs, res); },
      mark: function (nation, ground, side) { rig.setNation(nation || (side && side.flagId), side && side.flag); },
      setNation: function (id, design) {
        const m = id || design ? flagMat(String(id || "flag"), design) : null;
        for (let i = 0; i < ins.length; i++) { ins[i].material = m || M.vc; ins[i].visible = !!m; }
        return !!m;
      },
      setBay: function (k) { for (let i = 0; i < bays.length; i++) bays[i].open = clamp(+k || 0, 0, 1); pose(R); },
      setGear: function (k) { R.gearK = clamp(+k || 0, 0, 1); pose(R); },
      state: R,
    };
    R.rig = rig;
    root.userData.rig = rig;
    root.userData.aircraftDims = { family: "B-2-stealth", length: LEN, span: HALF * 2, height: HEIGHT, bodyW: 9.2, bodyL: LEN };
    root.userData.bombBay = true;
    // the host's handles (city/playeraircraft.js, cockpit.js): the crew figure
    // a host shows when somebody flies it, and the cockpit view's eye (the
    // pilot's, the left seat)
    if (crewMesh) { crewMesh.userData.crewFigure = true; root.userData.pilot = crewMesh; }
    root.userData.cockpit = { eye: { x: 0.62, y: topY(0, APEX - 6.0) - 1.27 + 0.84, z: APEX - 4.32 } };
    root.userData.crewSeats = [
      { job: "Pilot", x: 0.62, y: topY(0, APEX - 6.0) - 1.27, z: APEX - 4.5, yaw: 0, cushionH: 0.45, floorBelow: 0.28 },
      { job: "Mission Commander", x: -0.62, y: topY(0, APEX - 6.0) - 1.27, z: APEX - 4.5, yaw: 0, cushionH: 0.45, floorBelow: 0.28 },
    ];
    if (ctx && (ctx.nation || ctx.flag)) rig.setNation(ctx.nation || ctx.flagId, ctx.flag);
    tick(R, true, 0, null);
    return { group: root, rig: rig, footW: HALF * 2, footL: LEN, height: HEIGHT };
  }

  // ---- the stores ------------------------------------------------------------------------
  let _w = null, _v = null;
  function V3() { return new window.THREE.Vector3(); }
  function bayOf(shot) { return shot && BAY_OF[shot.wid] != null ? BAY_OF[shot.wid] : 1; }
  function bottomBomb(B) { return B.next < 8 ? B.bombs[B.next] : null; }
  function muzzle(R, out, shot) {
    if (!_w) _w = V3();
    out = out || _w;
    const B = R.bays[bayOf(shot)], b = bottomBomb(B);
    R.group.updateMatrixWorld(true);
    if (b) return b.mesh.getWorldPosition(out);
    return B.rla.getWorldPosition(out);
  }
  // the bay opens for the run, and the bomb waits for the doors and the launcher
  function canFire(R, shot) {
    if (R.dead) return false;
    const bi = bayOf(shot), B = R.bays[bi];
    if (B.next >= 8) return false;
    const veh = R.veh, t = (veh && veh.tgt && !veh.tgt.dead && veh.tgt) || (shot && shot.target);
    // the Mk 84s are not spent on armour while a penetrator is left for it
    if (bi === 1 && t && t.vehicle && R.bays[0].next < 8 && !(veh && veh.you)) return false;
    let want = true;
    if (t && t.pos && !(veh && veh.you) && R.flying) {
      // the doors open ~6 s short of the release point (the fall's lead
      // plus the guided basket), never on the long legs
      const spd = Math.max(80, Math.hypot(R.vx, R.vz));
      const h = R.group.rotation.y;
      const dx = t.pos.x - R.group.position.x, dz = t.pos.z - R.group.position.z, d = Math.hypot(dx, dz);
      const lead = spd * Math.sqrt(2 * Math.max(10, R.agl) / 9.81);
      const off = Math.abs(wrap(Math.atan2(dx, dz) - h));
      want = d - lead < spd * 6 + lead * 0.15 && off < 0.5;
    }
    if (want) B.req = R.clock;
    return B.open > 0.92 && Math.abs(B.rot - (-B.next * PI / 4)) < 0.04;
  }
  function fire(R, shot) {
    const THREE = window.THREE;
    const bi = bayOf(shot), B = R.bays[bi], b = bottomBomb(B);
    B.req = R.clock; B.hold = 3;
    if (!b) return;
    B.next++;
    const scene = R.group.parent;
    if (!scene) { b.mesh.visible = false; return; }
    R.group.updateMatrixWorld(true);
    scene.attach(b.mesh);
    const p = b.mesh.position;
    // it leaves with the aircraft's own velocity (the battle's round does the same),
    // and a guided one is put on the line to the mark
    const f = { b: b, vx: R.vx, vy: R.vy - 2, vz: R.vz, tgt: null, t: 0 };
    const tg = shot && shot.target;
    const w = shot && shot.w;
    if (tg && tg.pos && (!w || w.guided)) {
      const gy = groundAt(R, p.x, p.z);
      const tf = Math.sqrt(2 * Math.max(10, p.y - gy) / 9.81);
      f.vx = (tg.pos.x - p.x) / tf; f.vz = (tg.pos.z - p.z) / tf; f.tgt = tg;
    }
    R.falls.push(f);
    if (!_v) _v = new THREE.Vector3();
  }
  function groundAt(R, x, z) {
    try {
      if (R.groundAt) return +R.groundAt(x, z) || 0;
      if (CBZ.floorAt) return +CBZ.floorAt(x, z) || 0;
    } catch (e) {}
    return 0;
  }
  function stepFalls(R, dt) {
    if (!R.falls.length || !(dt > 0)) return;
    const THREE = window.THREE;
    if (!_v) _v = new THREE.Vector3();
    const n = Math.max(1, Math.ceil(dt / 0.05)), h = dt / n;
    for (let i = R.falls.length - 1; i >= 0; i--) {
      const f = R.falls[i], m = f.b.mesh, p = m.position;
      let gone = false;
      for (let s = 0; s < n && !gone; s++) {
        f.t += h;
        f.vy -= 9.81 * h;
        const hm = f.tgt;
        if (hm && !hm.dead && hm.pos) {
          const g = groundAt(R, p.x, p.z), ht = p.y - g;
          const tl = (f.vy + Math.sqrt(Math.max(0, f.vy * f.vy + 2 * 9.81 * Math.max(0, ht)))) / 9.81;
          if (tl > 0.3) {
            const k = Math.min(1, h * 1.5);
            f.vx += ((hm.pos.x - p.x) / tl - f.vx) * k;
            f.vz += ((hm.pos.z - p.z) / tl - f.vz) * k;
          }
        }
        p.x += f.vx * h; p.y += f.vy * h; p.z += f.vz * h;
        if (p.y <= groundAt(R, p.x, p.z) + 0.5 || f.t > 120) gone = true;
      }
      if (gone) { if (m.parent) m.parent.remove(m); R.falls.splice(i, 1); continue; }
      _v.set(p.x + f.vx, p.y + f.vy, p.z + f.vz);
      m.lookAt(_v);                               // nose along the flight path
    }
  }

  function damage(R, vs, res) {
    if (!res || !res.pen) return;
    if (!R.hit) R.hit = (R.seed + Math.floor(R.clock * 7)) & 1 ? 1 : -1;
    if (res.burning || (vs && vs.burning)) R.fire = true;
  }

  // the parts' poses that do not need time (gear, doors): set from state
  function pose(R) {
    const k = R.gearK;
    R.gear.visible = k > 0.02;
    R.gear.position.y = (1 - k) * 1.3;
    R.gear.scale.y = 0.3 + 0.7 * k;
    for (let i = 0; i < R.doors.length; i++) {
      const D = R.doors[i], o = R.bays[D.bay].open, e = o * o * (3 - 2 * o);
      D.node.rotation.z = D.open * e * 1.5;
    }
    R.bayWalls.visible = R.bays[0].open > 0.01 || R.bays[1].open > 0.01;
  }

  function scorch(R) {
    if (R.scorched) return;
    R.scorched = true;
    const M = template().M;
    const a = M.skin.clone(), b = M.skin2.clone();
    a.color.setHex(0x3a3633); b.color.setHex(0x3a3633);
    for (let i = 0; i < R.skins.length; i++) { const s = R.skins[i]; if (s) s.material = s.material === M.skin2 ? b : a; }
  }

  // ---- the rig: every moving part, once per animate (the battle clock) ------------------
  function tick(R, snap, dtRaw, ctx) {
    let dt = dtRaw > 0 ? dtRaw : 0;
    if (ctx && ctx.groundAt) R.groundAt = ctx.groundAt;
    stepFalls(R, Math.min(0.25, dt));
    if (dt > 0.1) dt = 0.1;
    R.clock += dt;
    const g = R.group;
    if (ctx && ctx.dead) R.dead = true;
    const dead = R.dead;
    // motion, read off the airframe's own transform
    const px = g.position.x, py = g.position.y, pz = g.position.z, h = g.rotation.y;
    if (!R.seeded || snap) { R.px = px; R.py = py; R.pz = pz; R.h0 = h; R.seeded = true; }
    if (dt > 0) {
      const k = Math.min(1, dt * 4);
      R.vx += ((px - R.px) / dt - R.vx) * k; R.vz += ((pz - R.pz) / dt - R.vz) * k; R.vy += ((py - R.py) / dt - R.vy) * k;
      R.yawRate += (wrap(h - R.h0) / dt - R.yawRate) * k;
    }
    R.px = px; R.py = py; R.pz = pz; R.h0 = h;
    const spd = Math.hypot(R.vx, R.vz);
    const agl = ctx && isFinite(ctx.agl) ? ctx.agl : py - groundAt(R, px, pz);
    R.agl = agl;
    R.flying = agl > 3 && !R.crashed;
    if (dead && R.flying === false && agl < 8) R.crashed = true;
    const gam = ctx && isFinite(ctx.gamma) ? ctx.gamma : -g.rotation.x;
    if (dt > 0) R.gamRate += ((gam - R.gam0) / dt - R.gamRate) * Math.min(1, dt * 3);
    R.gam0 = gam;
    // ---- bank: the coordinated-turn angle, not the runtime's steer roll -------------
    const kB = snap ? 1 : Math.min(1, dt * 1.5);
    const bank0 = R.bank;
    if (R.flying && !dead) R.bank += (clamp(-Math.atan(spd * R.yawRate / 9.81), -0.8, 0.8) - R.bank) * kB;
    else R.bank += (0 - R.bank) * kB;
    if (dt > 0) R.bankRate += ((R.bank - bank0) / dt - R.bankRate) * Math.min(1, dt * 4);
    R.lean.rotation.z = R.flying && !dead ? R.bank - g.rotation.z : 0;
    // ---- control surfaces ------------------------------------------------------------
    const rate = 1.05 * dt;                     // ~60 deg/s actuators
    const pitch = R.flying ? clamp(-R.gamRate * 5, -0.35, 0.35) - 0.035 : 0;       // reflex trim in flight
    const roll = R.flying ? clamp(R.bankRate * 1.6, -0.4, 0.4) : 0;
    const yawOpen = R.flying ? clamp(Math.abs(R.yawRate) * 6, 0, 0.6) : 0;
    const brake = R.flying && agl < 400 && spd < 120 ? 0.35 : 0;
    for (let i = 0; i < R.surfs.length; i++) {
      const S = R.surfs[i];
      let want, open = 0;
      if (dead) { want = 0.25 * Math.sin(R.clock * (5 + i) + i); open = S.split ? 0.4 + 0.3 * Math.sin(R.clock * 3 + i) : 0; }
      else if (S.id === "beaver") want = R.flying ? pitch * 0.5 + 0.03 * Math.sin(R.clock * 1.7) * Math.sin(R.clock * 0.37 + 1) : 0;
      else {
        // port (+X) TE goes UP to roll left (bank negative)
        want = pitch + S.side * S.roll * roll;
        if (S.split) open = Math.max(brake, (R.yawRate * S.side > 0 ? yawOpen : 0));
      }
      if (snap) { S.d = want; S.o = open; }
      else { S.d += clamp(want - S.d, -rate, rate); S.o += clamp(open - S.o, -rate, rate); }
      if (S.split) {
        S.flaps[0].node.rotation.x = S.flaps[0].sgn * (S.d - S.o);   // upper half: TE up as it opens
        S.flaps[1].node.rotation.x = S.flaps[1].sgn * (S.d + S.o);   // lower half: TE down
      } else S.flaps[0].node.rotation.x = S.flaps[0].sgn * S.d;
    }
    // ---- gear: up above 25 m, down on the stand and on a slow, low approach ------------
    const gearWant = R.crashed ? 0 : (agl > 25 || (R.flying && spd > 110) ? 0 : 1);
    if (snap) R.gearK = gearWant; else R.gearK += clamp(gearWant - R.gearK, -dt / 9, dt / 9);
    if (R.crashed) R.gearK = 0;
    // ---- bays: open for the run, hold after the release, then shut; index the launcher --
    for (let i = 0; i < R.bays.length; i++) {
      const B = R.bays[i];
      B.hold = Math.max(0, B.hold - dt);
      const want = !dead && (R.clock - B.req < 1.2 || B.hold > 0) ? 1 : 0;
      if (snap) B.open = want; else B.open += clamp(want - B.open, -dt / 2.2, dt / 2.2);
      const rT = -B.next * PI / 4;
      if (B.next < 8) { if (snap) B.rot = rT; else B.rot += clamp(rT - B.rot, -dt * 1.8, dt * 1.8); }
      B.rla.rotation.z = B.rot;
    }
    pose(R);
    // ---- lights: on at low level, dark in the fight ------------------------------------
    R.lamps.visible = !dead && agl < 60;
    // ---- damage: smoke from a hit nacelle, flame when burning; a kill tears a wing -----
    const veh = R.veh;
    const hpF = veh && veh.vs && veh.vs.maxHp ? veh.vs.hp / veh.vs.maxHp : 1;
    if (dead) {
      scorch(R);
      if (!R.torn) R.torn = R.hit || (R.seed & 1 ? 1 : -1);
      R.tornT += dt;
      const W = R.wings[R.torn];
      if (W && W.pivot.visible) {
        const t = R.tornT, s = R.torn;
        W.pivot.rotation.z = s * Math.min(1.6, t * 1.1);
        W.pivot.rotation.y = s * t * 0.35;
        W.pivot.rotation.x = -t * 0.5;
        W.pivot.position.x = s * (OUTER_X + t * 7);
        W.pivot.position.y = CY - 4.9 * t * t;
        W.pivot.position.z = zOf(OUTER_X, 0.5) - t * 10;
        if (t > 6 || R.crashed) W.pivot.visible = false;
      }
    }
    if (dt > 0 && (R.hit || R.fire || hpF < 0.6 || dead) && CBZ.cityCrashSmoke) {
      R.smokeT -= dt;
      if (R.smokeT <= 0) {
        R.smokeT = R.crashed ? 0.6 : 0.22;
        const side = R.torn || R.hit || 1;
        const x = dead ? side * (OUTER_X - 0.5) : side * ENG_X, z = dead ? zOf(OUTER_X, 0.5) : zOf(ENG_X, 0.9);
        try {
          if (!_w) _w = V3();
          g.updateMatrixWorld(true);
          const p = R.lean.localToWorld(_w.set(x, topY(x, z) + 0.3, z));
          CBZ.cityCrashSmoke(p.x, p.y, p.z, { count: dead ? 2 : 1, scale: (dead ? 1.4 : 0.7) + 0.6 * (1 - hpF), shade: dead || R.fire || hpF < 0.3 ? 0.22 : 0.55, flame: !!(R.fire || dead) });
        } catch (e) {}
      }
    }
  }

  // which bomb a player's attack works on this mark
  function moves(veh, tgt) {
    if (!tgt) return null;
    const pen = veh && veh.wpn ? veh.wpn.find(function (W) { return W.w.id === WID_PEN; }) : null;
    const arm = tgt.vehicle && tgt.def && tgt.def.stats && tgt.def.stats.armour ? (tgt.def.stats.armour.side || 0) : 0;
    if (tgt.vehicle && arm > 10 && (!pen || pen.ammo > 0)) return WID_PEN;
    return WID_MK84;
  }

  CBZ.unitKit.register("b2_spirit", {
    kind: "vehicle",
    domain: "air",
    drive: "jet",
    /* B-2A: 71,700 kg empty, 152,200 kg at max take-off; Mach 0.85 at
       altitude (~250 m/s true at 12 km), service ceiling 15.2 km; it bombs
       from 12 km. A heavy wing turns at ~2.3 deg/s (35-45 deg of bank at
       that speed), which the jet doctrine turns into a 6 km turn circle
       and long racetrack legs: one straight pass per salvo. Unarmoured:
       a few mm of composite and RAM, so a SAM that reaches it goes through. */
    stats: { hp: 800, mass: 152000, speed: 250, accel: 3, turn: 0.04, alt: 12000, length: LEN, width: HALF * 2, height: HEIGHT,
      armour: { front: 3, side: 2, rear: 2, top: 2 }, standoff: 0 },
    crew: [{ seat: "pilot", pos: [0.62, 4.0, APEX - 4.5] }, { seat: "commander", pos: [-0.62, 4.0, APEX - 4.5] }],
    passengers: 0,
    weapons: WEAPONS,
    tactics: {
      role: "strategic-bomber",
      engage: { bombs: 12000 },                 // release height, m
      priorities: ["armour", "launcher", "soft", "men"],
      pass: "single straight-and-level run per salvo, bay shut until the run",
      stealth: true,
      hullDown: false, faceThreat: false, reverseOut: false, screen: null,
    },
    build: build,
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.state) { r.state.veh = veh; tick(r.state, false, dt, ctx); }
    },
    moves: moves,
  });
})();
