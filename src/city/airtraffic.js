/* ============================================================
   city/airtraffic.js — AMBIENT CIVILIAN AIR TRAFFIC.

   A handful of deterministic civilian aircraft — light high-wing singles, the
   odd regional turboprop, and light twin helicopters in civil, news and
   medical colours (every airframe is city/airframes.js's real model) —
   orbiting the city on stacked altitude bands,
   banking into their turns at the physically-correct constant-radius bank
   angle (tan(bank) = v^2 / (R*g)). Since AIR_TRAFFIC_COLLIDE those bands are
   REAL: a craft whose hull reaches a building's collider does not pass through
   it, it dies there — the same explosion and the same tumbling wreck a craft
   shot out of the sky gets.

   They register no colliders of their own, carry no weapons, take no part in
   the wanted system and cannot be boarded — but they are no longer only
   scenery: a heavy-weapon blast can down one (the shoot-down arc at the
   bottom of the file; CBZ.CONFIG.AIRTRAFFIC_DAMAGE), and so can a tower
   (AIR_TRAFFIC_COLLIDE, which routes into that same arc).
   Everything about WHERE they fly and WHAT they look like is
   position-hash deterministic (CBZ.hash01 — never Math.random), so every
   client sees the same fleet in the same sky. The only per-frame state is
   one accumulated clock. Gated by CBZ.CONFIG.AIR_TRAFFIC_AMBIENT (one-line
   revert to an empty sky).

   The police/wanted air threat lives in aircraft.js; the player's own
   flyable birds in playeraircraft.js — this module touches neither.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // OWNER, the fault: "LITTLE PROPELLOR PLANES FLY THRU BUILDINGS."
  // OWNER, the fix he actually wanted: "WHAT I MEANT FOR LITTLE PLANES WAS NOT
  // FLY HIGHER BUT IF THEY FLY AT CURRENT HEIGHT AND GO THRU BUILDING BLOW UP
  // LIKE OTHER PLANE."
  //
  // There are two honest answers to one fault and he picked the second, so the
  // file carries both and ships his. AIR_TRAFFIC_CLEARANCE (raise the track
  // above the roofline — ROOF CLEARANCE, below) is complete, tested by
  // construction and one line from being live again; it is OFF because a sky in
  // which nothing can go wrong is not the sky he asked for. AIR_TRAFFIC_COLLIDE
  // is the shipped behaviour: the bands do not move one metre, and a craft that
  // flies into a building dies the way a craft the player shot down dies.
  // They compose — both on means "climb over what you can, die on what you
  // cannot" — but the shipped world is COLLIDE alone.
  if (CFG.AIR_TRAFFIC_CLEARANCE == null) CFG.AIR_TRAFFIC_CLEARANCE = false;
  if (CFG.AIR_TRAFFIC_COLLIDE == null) CFG.AIR_TRAFFIC_COLLIDE = true;

  function h01(i, salt) { return CBZ.hash01 ? CBZ.hash01(i * 17 + 3, i * 5 - 11, salt) : 0.5; }

  // ---- tunables -------------------------------------------------------------
  const N_TRAFFIC   = 4;                       // a handful — atmosphere, not an airshow
  // Stacked VFR bands. (The old comment here claimed these sat "all above the
  // police air (44/52)"; that stopped being true when Air-1 moved onto
  // CBZ.heliSpec's 150 m search / 85 m engaged postures. These bands are
  // deliberately UNCHANGED — this fleet is TRANSITING traffic, not air support
  // orbiting a point, so a low-level GA circuit crossing under and over a
  // police orbit is correct and is also what keeps these craft shootable.)
  // THEY ARE STILL THE TRACK, AND NOW THEY HAVE CONSEQUENCES. Under the
  // shipped AIR_TRAFFIC_COLLIDE these four numbers are exactly what they
  // always were — nothing raises them — but the city underneath is no longer
  // notional: buildings.js's 52-storey mega tower stands at 52 * FH(3.2) =
  // 166.4 m, above ALL FOUR of them, and a craft that meets it dies on it.
  // (Under the alternate AIR_TRAFFIC_CLEARANCE they become a FLOOR instead;
  // see ROOF CLEARANCE below.)
  const ALT_BANDS   = [72, 96, 122, 148];
  const VIS_RING    = 520;                     // cull update+draw beyond this from the player
  // GA accent stripes / heli bold bodies — classic civilian schemes
  const GA_ACCENTS  = [0x2d5fb0, 0xc0392b, 0xd8821f, 0x1f7a4d];
  const HELI_BODIES = [0xb33636, 0x1f5fa8, 0xd8a11f, 0x1f7a4d];
  // role liveries: a news bird in a bold channel colour, the air ambulance in
  // high-visibility red over white with a yellow line
  const HELI_ROLE = {
    civil: null,
    news: { body: 0x1f5fa8, belly: 0xe8eaec, accent: 0xf2c230 },
    medical: { body: 0xf2f2ef, belly: 0xc8262c, accent: 0xf2c230 },
  };

  // ---- THE AIRFRAMES -------------------------------------------------------
  // Every craft here is city/airframes.js's real model, built once per type
  // and shared (a livery is a material). The fleet flies them nose +Z, which
  // is the airframes' own frame.
  function buildCraft(kind, type, colour, variant) {
    if (kind === "heli") {
      const lv = HELI_ROLE[variant] || { body: colour, belly: 0xe8e8e4, accent: 0x1c2026 };
      return CBZ.airframes.build("heli", { variant: variant === "news" ? "news" : (variant === "medical" ? "medical" : "civil"), livery: lv });
    }
    const g = CBZ.airframes.build(type, { livery: colour });
    // a transiting fixed-wing is cleaned up: gear up (the single's is fixed)
    CBZ.airframes.poseGear(g, 0);
    return g;
  }

  // ---- fleet state -----------------------------------------------------------
  let fleet = null;        // [{ grp, kind, cx, cz, radius, alt, dir, speed, phase }]
  let fleetRoot = null;    // the arena root the fleet was built into
  let clock = 0;
  let crashes = 0;         // cumulative building strikes since this fleet was built

  /* ============================================================
     THE BANDS ARE REAL  (CBZ.CONFIG.AIR_TRAFFIC_COLLIDE — shipped)
     ROOF CLEARANCE      (CBZ.CONFIG.AIR_TRAFFIC_CLEARANCE — alternate)

     OWNER: "LITTLE PROPELLOR PLANES FLY THRU BUILDINGS." Then, deciding which
     way that should be cured: "WHAT I MEANT FOR LITTLE PLANES WAS NOT FLY
     HIGHER BUT IF THEY FLY AT CURRENT HEIGHT AND GO THRU BUILDING BLOW UP LIKE
     OTHER PLANE."

     THE FAULT, either way: the fleet's altitude was FOUR AUTHORED NUMBERS and
     the city was never consulted. ALT_BANDS tops out at 148 while buildings.js's
     makeMegaTower puts a 52-storey flagship at 52 * FH(3.2) = 166.4 m — so
     EVERY band flew through the tallest thing in the world, and the lowest (72)
     flew through anything over 22 storeys. Nothing here was wrong about the
     circuit; the circuit simply had no idea what was underneath it. The
     shipped answer is not to move the circuit — it is to make the building
     count.

     ONE PIECE OF MATH SERVES BOTH MODES, WHICH IS THE WHOLE REASON THE SECOND
     ONE IS CHEAP. These craft fly a FIXED CIRCLE, so "what does my track
     touch" has a stable answer that only has to be recomputed when the city
     changes. `scanRing` walks CBZ.colliders ONCE per craft on a slow
     round-robin and returns two things from the same pass: the tallest roof on
     the ring (which is all AIR_TRAFFIC_CLEARANCE ever needed) and a SHORTLIST
     of the colliders on that ring standing tall enough to be flown into. The
     annulus test is exact and allocation-free: the set of distances from the
     orbit centre to the points of an AABB is precisely the interval
     [near, far], so a padded circle of radius R touches the box iff
     near <= R+pad AND far >= R-pad — squared throughout, no sqrt, no trig.

     COLLIDE then costs almost nothing per frame. The shortlist is filtered to
     the handful of colliders whose vertical span actually brackets the level
     this craft flies at (`t.hits`, usually EMPTY — a ring that crosses nothing
     tall arms nothing at all), and the per-frame work is an exact hull-vs-AABB
     test against that tiny list at the craft's live position. There is no
     tunnelling to worry about: a candidate is a WHOLE TOWER, so the test is
     "am I inside this box", not "did I cross this plane", and at 26-43 m/s a
     craft spends many frames inside a 15-20 m footprint. Detection is
     therefore every frame for an armed craft and NEVER for an unarmed one,
     which is tighter than the coordinator's floor and cheaper than the slow
     cadence it replaces.

     THE CRASH IS NOT A NEW DEATH PATH. It calls `downTraffic`, the exact
     function a rocket or a rifle burst already calls — the lurch, the frozen
     crash heading, the death roll / flat spin, the smoke trail, `fallTraffic`'s
     ride-down and its terminal fireball, the kill-bus line for the occupants.
     A building strike only differs in the two ways it must: an impact blast at
     the WALL FACE it struck (byPlayer false — a plane the player never touched
     puts no heat on him and no attribution in the feed), and a shorter carried
     speed, because you leave a wall, you do not fly on through it.

     Degrade-safe: no colliders, or both flags off ⇒ no shortlist, no hits,
     cruise === the authored band ⇒ byte-identical to the sky that shipped.
  ============================================================ */
  const CLEARANCE = () => CFG.AIR_TRAFFIC_CLEARANCE === true;
  const COLLIDE   = () => CFG.AIR_TRAFFIC_COLLIDE !== false;
  // HULL_V — the airframe's vertical half-extent about its own origin, worst
  // case, WHILE BANKED (the orbit is flown at a bank clamped to 0.5 rad in the
  // update loop). It is SYMMETRIC for the honest reason that a banked wing
  // dips on one side by exactly what it rises on the other:
  //   plane — outboard tip of the 10.6 span moves 5.3*sin(0.5) = 2.54;
  //           gear at -1.58 and fin crown at +1.75 are both inside that.
  //   heli  — rotor tip 4.6*sin(0.5) = 2.20; skids -1.14, rotor hub +1.34.
  const HULL_V = 2.6;
  // HULL_SPAN — half the widest horizontal dimension, i.e. how far out the
  // thing that hits the wall is. A wing striking a tower IS a crash, so this
  // is the pad on the footprint test, not the fuselage radius.
  function hullSpan(t) { return t.halfSpan || (t.kind === "heli" ? 4.6 : 5.3); }
  // ROOFTOP HARDWARE THE COLLIDER SET DOES NOT CARRY. Roof gear is drawn as
  // decoration far more often than it is registered solid: expansion.js hangs
  // a beacon 1.0 above b.h with no collider, buildings.js's helipad mast is
  // 2.4 tall and unsolid, plant/aerials sit on top of that. 7 covers the
  // tallest of them and then some.
  const ROOF_GEAR = 7;
  // READ GAP — the daylight that makes it read as flying OVER rather than
  // skimming: ~5 storeys at buildings.js's FH of 3.2.
  const READ_GAP = 16;
  const ROOF_CLEAR = HULL_V + ROOF_GEAR + READ_GAP;         // 25.6
  // FAIRNESS CEILING. aircraft.js states the law this obeys: a range is a
  // FAIRNESS invariant, not a gun stat. This fleet is shootable
  // (AIRTRAFFIC_DAMAGE, above), the sanctioned anti-air answer is the RPG at
  // 200 m and the longest gun in the game is the sniper at 240 m — so a
  // clearance clamp may push a craft up to 198 (still inside the RPG's reach
  // from the street) and never past it. The shipped skyline fits with room:
  // the 166.4 m mega tower asks for 192.0. A ring that asks for more than
  // this is a SKYLINE change, not an air-traffic change, and it surfaces as
  // `overCeil` in the audit rather than silently making a craft unreachable.
  const CRUISE_CEIL = 198;
  const ROOF_CAP = 310;             // ignore absurd colliders (trafficRoofTop's own cap)
  const CLEAR_REFRESH = 4.0;        // seconds between one craft's re-scan (round-robin)
  let clearNext = 0, clearWho = 0;

  // A HELICOPTER IS NOT A PLANE, AND aircraft.js ALREADY SAID SO. HELI_SPECS
  // carries a `traffic` role (agl 122 — literally ALT_BANDS[2] — v 22, R 105,
  // roofClear 10) that was authored FOR this fleet and that this file has
  // never read; roofClear is the one number of it this change needs, so it is
  // asked for rather than re-typed. Rotorcraft are legitimately allowed to
  // cross a roof closer than a fixed-wing does, which is why the two differ.
  function roofClearFor(t) {
    if (t.kind === "heli" && CBZ.heliSpec) {
      try {
        const s = CBZ.heliSpec("traffic");
        if (s && s.roofClear > 0) return s.roofClear;
      } catch (e) {}
    }
    return ROOF_CLEAR;
  }

  // THE ONE O(colliders) WALK. Returns the tallest collider top under this
  // craft's orbit RING and fills `t._tall` with every collider on that ring
  // standing high enough to be flown into. Exact annulus test (see the block
  // header), squared throughout, with a `y1 <= top && !tallEnough` early-out
  // that rejects essentially every short collider in the world after the first
  // tall one is found.
  const TALL_CAP = 256;      // shortlist ceiling — a ring crossing more is a forest of towers
  function scanRing(t) {
    const tall = t._tall || (t._tall = []);
    tall.length = 0;
    t.tallOverflow = false;
    const cols = CBZ.colliders;
    if (!cols || !cols.length) return 0;
    const cx = t.cx, cz = t.cz, R = t.radius;
    // half-span plus a wingtip of slop: candidates are deliberately OVER-
    // selected (the safe direction) because the hit test below is exact.
    const pad = hullSpan(t) + 3;
    const rp = R + pad, rm = R - pad;
    const rp2 = rp * rp, rm2 = rm > 0 ? rm * rm : 0;
    // Nothing whose top is below the craft's LOWEST possible level can ever be
    // struck: `alt` is never under the authored band in either mode.
    const reach = t.band - HULL_V;
    let top = 0;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || c.y1 == null || c.y1 > ROOF_CAP) continue;
      const tallEnough = c.y1 >= reach;
      if (c.y1 <= top && !tallEnough) continue;            // can't raise `top`, can't be hit
      const dx = Math.max(c.minX - cx, 0, cx - c.maxX);
      const dz = Math.max(c.minZ - cz, 0, cz - c.maxZ);
      if (dx * dx + dz * dz > rp2) continue;               // whole box outside the ring
      const fx = Math.max(Math.abs(c.minX - cx), Math.abs(c.maxX - cx));
      const fz = Math.max(Math.abs(c.minZ - cz), Math.abs(c.maxZ - cz));
      if (fx * fx + fz * fz < rm2) continue;               // whole box inside the ring
      if (c.y1 > top) top = c.y1;
      if (tallEnough) { if (tall.length < TALL_CAP) tall.push(c); else t.tallOverflow = true; }
    }
    return top;
  }

  // Of the tall things on the ring, the ones whose vertical span actually
  // brackets the level this craft flies at. Usually EMPTY, which is what makes
  // the per-frame test free for most of the fleet.
  function armHits(t) {
    const hits = t.hits || (t.hits = []);
    hits.length = 0;
    if (!COLLIDE() || !t._tall) return;
    const lo = t.alt - HULL_V, hi = t.alt + HULL_V;
    for (let i = 0; i < t._tall.length; i++) {
      const c = t._tall[i];
      if ((c.y0 == null ? 0 : c.y0) <= hi && c.y1 >= lo) hits.push(c);
    }
  }

  // EXACT hull-vs-collider test at a live position, over the tiny armed list.
  // A candidate is a whole tower, not a plane to be crossed, so there is
  // nothing to tunnel through: at 26-43 m/s a craft is inside a 15-20 m
  // footprint for many consecutive frames.
  function hullStrike(t, x, z) {
    const hits = t.hits;
    if (!hits || !hits.length) return null;
    const s = hullSpan(t), lo = t.alt - HULL_V, hi = t.alt + HULL_V;
    for (let i = 0; i < hits.length; i++) {
      const c = hits[i];
      if (x < c.minX - s || x > c.maxX + s || z < c.minZ - s || z > c.maxZ + s) continue;
      if (c.y1 < lo || (c.y0 == null ? 0 : c.y0) > hi) continue;
      return c;
    }
    return null;
  }

  // An armed candidate is a REFERENCE captured up to one full round-robin ago,
  // so a demolished tower could still be sitting in the list. The SAME
  // predicate is re-run against the LIVE collider array before an aircraft is
  // killed — O(colliders), but only ever on the single frame a craft actually
  // strikes something, and it also catches anything built since the last scan.
  function strikeConfirm(x, z, s, lo, hi) {
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || c.y1 == null || c.y1 > ROOF_CAP) continue;
      if (c.y1 < lo || (c.y0 == null ? 0 : c.y0) > hi) continue;
      if (x < c.minX - s || x > c.maxX + s || z < c.minZ - s || z > c.maxZ + s) continue;
      return c;
    }
    return null;
  }

  // Re-measure one craft's circuit and publish its cruise altitude.
  // `snap` (fleet build) places it there outright; afterwards a REQUIRED CLIMB
  // is taken immediately and only a descent is flown at rate — you never
  // descend into a building, but you may take your time coming back down.
  // That asymmetry is what lets airTrafficAudit().clipping pin at 0.
  function refreshClear(t, snap) {
    if (!t || t.downed) return;
    const need = CLEARANCE() || COLLIDE();
    t.ringRoof = need ? scanRing(t) : 0;
    if (!need && t._tall) t._tall.length = 0;
    if (CLEARANCE()) {
      const want = t.ringRoof > 0 ? t.ringRoof + roofClearFor(t) : 0;
      // THE CEILING IS A PREFERENCE, NOT A LICENCE TO CLIP. Staying inside the
      // RPG's reach is polish; not being inside a building is the fix, and the
      // fix outranks the polish. `noClip` is the lowest altitude at which no
      // part of the airframe is inside the roof — if the ceiling would sit
      // under it, the roof wins and `overCeil` records the trade instead of the
      // craft quietly going back through the tower.
      const noClip = t.ringRoof > 0 ? t.ringRoof + HULL_V + 1 : 0;
      t.overCeil = want > CRUISE_CEIL;
      t.cruise = Math.max(t.band, noClip, Math.min(CRUISE_CEIL, want));
    } else {
      t.overCeil = false;
      t.cruise = t.band;                 // the authored track, exactly as it shipped
    }
    if (snap || t.alt == null || t.cruise > t.alt) t.alt = t.cruise;
    armHits(t);                          // altitude is settled — arm what it can hit
  }
  const CLIMB_DOWN = 4.5;           // m/s — a light single's honest rate of descent
  function easeClear(t, dt) {
    if (t.alt > t.cruise) t.alt = Math.max(t.cruise, t.alt - CLIMB_DOWN * dt);
  }

  /* CBZ.airTrafficAudit() — WHAT IS THE AMBIENT FLEET DOING TO THE CITY?

     Read the two headline numbers TOGETHER; each alone can be gamed.

       crashed  — cumulative building strikes since this fleet was built. In
                  the shipped COLLIDE world this is the FEATURE WORKING and it
                  is expected to climb off 0 as soon as a track that crosses a
                  tower is flown in view. It is not a ratchet in either
                  direction; it is proof the sky has consequences.
       clipping — RATCHET, must be 0. A craft that is being SIMULATED (inside
                  the ring cull, i.e. actually drawn) while its hull is inside
                  a building and it is still flying. Zero by construction: the
                  update loop kills such a craft on the same frame it draws it.
                  Culled craft are excluded on purpose — they are frozen, and
                  they die on the frame they resume.

     `armed`/`candidates` say how much of the fleet the detector is even
     watching, so a "fix" that silently stopped arming anything cannot hide
     behind clipping:0. `raised` is 0 whenever AIR_TRAFFIC_CLEARANCE is off,
     which is the one-line proof that the alternate mode is not secretly on. */
  CBZ.airTrafficAudit = function () {
    const out = {
      mode: COLLIDE() ? (CLEARANCE() ? "collide+clearance" : "collide")
                      : (CLEARANCE() ? "clearance" : "off"),
      clearance: CLEARANCE(), collide: COLLIDE(),
      craft: 0, planes: 0, helis: 0,
      crashed: crashes,          // cumulative strikes — the feature working
      clipping: 0,               // RATCHET: must be 0
      armed: 0, candidates: 0, overflow: false,
      raised: 0, overCeil: 0, minGap: null, maxAlt: 0,
      bands: ALT_BANDS.slice(), roofClear: ROOF_CLEAR, ceiling: CRUISE_CEIL,
      colliders: (CBZ.colliders || []).length, list: [],
    };
    if (!fleet) return out;
    const P = CBZ.player;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      if (!t || t.downed) continue;
      out.craft++;
      if (t.kind === "heli") out.helis++; else out.planes++;
      const nHits = (t.hits && t.hits.length) || 0;
      if (nHits) out.armed++;
      out.candidates += nHits;
      if (t.tallOverflow) out.overflow = true;
      // the craft's TRUE orbit position (the mesh transform is stale while a
      // craft is ring-culled, and reading it would report a ghost)
      const ang = t.phase + t.dir * (t.speed / t.radius) * clock;
      const x = t.cx + Math.cos(ang) * t.radius, z = t.cz + Math.sin(ang) * t.radius;
      const simmed = !P || ((x - P.pos.x) * (x - P.pos.x) + (z - P.pos.z) * (z - P.pos.z)) <= VIS_RING * VIS_RING;
      if (simmed && COLLIDE() && hullStrike(t, x, z)) out.clipping++;
      const roof = t.ringRoof || 0;
      const gap = (t.alt || 0) - HULL_V - roof;
      if (t.overCeil) out.overCeil++;
      if ((t.alt || 0) > t.band + 0.01) out.raised++;
      if (out.minGap == null || gap < out.minGap) out.minGap = +gap.toFixed(2);
      if ((t.alt || 0) > out.maxAlt) out.maxAlt = Math.round(t.alt || 0);
      out.list.push({ kind: t.kind, band: t.band, alt: Math.round(t.alt || 0),
                      roof: Math.round(roof), gap: +gap.toFixed(1),
                      r: Math.round(t.radius), armed: nHits });
    }
    return out;
  };

  // ---- studio hook: pure mesh builders for tools/studio.mjs expr shots ----
  CBZ.debugBuildAirTraffic = {
    plane: function (c) { return buildCraft("plane", "single", c != null ? c : GA_ACCENTS[0]); },
    turboprop: function (c) { return buildCraft("plane", "turboprop", c != null ? c : GA_ACCENTS[0]); },
    heli: function (c, v) { return buildCraft("heli", null, c != null ? c : HELI_BODIES[0], v || "civil"); },
  };

  function arenaRoot() {
    const a = CBZ.city && CBZ.city.arena;
    return a ? a.root : null;
  }

  function buildFleet(root) {
    const arena = CBZ.city && CBZ.city.arena;
    const cx0 = arena && arena.center ? arena.center.x : 0;
    const cz0 = arena && arena.center ? arena.center.z : 0;
    const list = [];
    for (let i = 0; i < N_TRAFFIC; i++) {
      const isHeli = h01(i, 80) < 0.3;
      const acc = GA_ACCENTS[(h01(i, 81) * GA_ACCENTS.length) | 0];
      const bodyC = HELI_BODIES[(h01(i, 82) * HELI_BODIES.length) | 0];
      // one in four fixed-wing is a regional turboprop; helis fly civil, news
      // and air-ambulance colours
      const type = isHeli ? "heli" : (h01(i, 83) < 0.25 ? "turboprop" : "single");
      const variant = isHeli ? ["civil", "news", "medical"][(h01(i, 84) * 3) | 0] : null;
      const grp = buildCraft(isHeli ? "heli" : "plane", type, isHeli ? bodyC : acc, variant);
      const dims = grp.userData.aircraftDims || {};
      const t = {
        grp,
        kind: isHeli ? "heli" : "plane",
        type: type,
        // collision half-span off the real airframe (a turboprop's wing is 13 m)
        halfSpan: isHeli ? 4.6 : Math.max(5.3, (dims.span || 10) / 2),
        afs: { gear: type === "single" ? 1 : 0, power: 0.75, running: true, lights: "on", landing: false },
        cx: cx0 + (h01(i, 71) * 2 - 1) * 180,
        cz: cz0 + (h01(i, 72) * 2 - 1) * 180,
        radius: (isHeli ? 70 : 95) + h01(i, 73) * 70,
        // `band` is the authored VFR level; `alt` is what the craft actually
        // flies, which is the band unless its own circuit crosses something
        // tall (see ROOF CLEARANCE). refreshClear() below fills cruise/alt.
        band: ALT_BANDS[i % ALT_BANDS.length],
        alt: ALT_BANDS[i % ALT_BANDS.length],
        cruise: ALT_BANDS[i % ALT_BANDS.length],
        ringRoof: 0,
        dir: h01(i, 76) < 0.5 ? 1 : -1,
        speed: (isHeli ? 18 : 27) + h01(i, 74) * (isHeli ? 8 : 16),
        phase: h01(i, 75) * Math.PI * 2,
      };
      // measure the circuit before the craft is ever drawn, so it is ARMED
      // (and, under the alternate clearance mode, already at its level) from
      // its very first frame. Reads only CBZ.colliders — a pure function of
      // the seeded world build — and draws no rng, so the fleet stays
      // byte-identical per seed.
      refreshClear(t, true);
      root.add(grp);
      // SOMEBODY IS FLYING IT. The heliAudit census below has always reported
      // these craft as `crew: 1` on the argument that "a light single flown by
      // its owner IS a crewed aircraft" — which was true of the bookkeeping and
      // false of the world: the canopy was empty. One shared call
      // (playeraircraft.js AIR_PILOT_VISIBLE) seats the game's ordinary
      // character rig on the derived cockpit seat, so the claim and the
      // aeroplane now agree. Four craft, one body each, animated only while
      // the airframe is inside the visibility ring.
      if (CBZ.airEnsurePilot) {
        const like = {
          group: grp, airClass: isHeli ? "heli" : (type === "turboprop" ? "airliner" : "prop"),
          displayName: isHeli ? "Light Heli" : (type === "turboprop" ? "Turboprop" : "Light Single"), modelYawOffset: 0,
        };
        try {
          const rig = CBZ.airEnsurePilot(like);
          if (rig) { rig.group.visible = true; t.pilotRig = rig; }
        } catch (e) { /* a fleet must never fail to build over a passenger */ }
      }
      list.push(t);
    }
    return list;
  }

  function teardown() {
    if (!fleet) return;
    for (let i = 0; i < fleet.length; i++) {
      const grp = fleet[i].grp;
      if (grp.parent) grp.parent.remove(grp);
      grp.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
        const m = o.material;
        if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
      });
    }
    fleet = null;
    fleetRoot = null;
  }
  CBZ.cityClearAirTraffic = teardown;
  CBZ.cityAirTrafficList = function () { return fleet ? fleet.slice() : []; };
  // CBZ.heliAudit() census provider (aircraft.js owns the audit; each fleet
  // pushes ONE of these). Ambient civil helis are deliberately reported as
  // crewed:1 — a light single flown by its owner IS a crewed aircraft, and
  // counting it as `uncrewed` would poison the number that must trend to 0.
  // Fixed-wing traffic is not a rotorcraft and is not reported here.
  CBZ.heliFleet = CBZ.heliFleet || [];
  CBZ.heliFleet.push(function () {
    if (!fleet) return null;
    const out = [];
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      if (!t || t.kind !== "heli" || !t.grp || !t.grp.parent) continue;
      const p = t.grp.position;
      const gy = CBZ.floorAt ? (+CBZ.floorAt(p.x, p.z) || 0) : 0;
      out.push({
        role: "traffic", x: p.x, y: p.y, z: p.z, agl: p.y - gy,
        speed: t.speed, orbitR: t.radius, crew: 1,
        roofTop: trafficRoofTop(p.x, p.z), downed: !!t.downed,
      });
    }
    return out;
  });

  // systems/lockon.js UNIVERSAL-acquisition seam (owner: "homing doesn't work
  // for small planes"): every ambient GA plane / light heli is a lockable
  // craft like any street car. Identity is the fleet record; the cached seek
  // getter goes null once the craft is ring-culled or the fleet tears down,
  // which breaks a live lock the same frame. cb(...) === false stops the walk
  // (candidate pool full). A homing hit now lands on a REAL damage model —
  // the AIRTRAFFIC_DAMAGE shoot-down arc below (cityAirTrafficSplash).
  function trafficLockSeek(t) {
    if (!t._lockSeek) {
      t._lockSeek = function () {
        return t.grp && t.grp.parent && t.grp.visible !== false
          ? { x: t.grp.position.x, y: t.grp.position.y, z: t.grp.position.z }
          : null;
      };
    }
    return t._lockSeek;
  }
  CBZ.cityAirTrafficEnumTargets = function (cb) {
    if (!fleet) return;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      if (!t || !t.grp || !t.grp.parent || t.grp.visible === false) continue;
      const p = t.grp.position;
      if (cb(t, trafficLockSeek(t), p.x, p.y, p.z, t.kind === "heli" ? 2.6 : 3.2, "air-traffic") === false) return;
    }
  };

  // ============================================================
  //  SHOOT-DOWN (AIRTRAFFIC_DAMAGE): the lock seam above made these craft
  //  ACQUIRABLE, so a homing missile could ride all the way in and
  //  proximity-detonate — on a prop with no HP, for nothing. This closes
  //  that gap. Splash from the fpsmode detonation fan-out is the ONLY
  //  damage source (same call shape as cityAircraftSplash); ambient flight
  //  is untouched until a craft is actually wounded or downed. The fleet
  //  has no replenish cycle, so a destroyed craft simply leaves the sky one
  //  lighter until the next city rebuild re-seeds the full deterministic
  //  set. Death FX are runtime-only → Math.random is sanctioned here (the
  //  build path stays pure CBZ.hash01).
  // ============================================================
  const CRAFT_HP = { plane: 60, heli: 50 };    // light civilian airframes: one rocket kills
  function trafficHP(t) { return CRAFT_HP[t.kind] || 55; }

  CBZ.cityAirTrafficSplash = function (x, y, z, radius, dmg) {
    if (!fleet || (CBZ.CONFIG && CBZ.CONFIG.AIRTRAFFIC_DAMAGE === false)) return 0;
    let hit = 0;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      // a ring-culled craft holds a STALE mesh position (the orbit math skips
      // it), so a blast can't meaningfully reach one — same visibility gate
      // the lock seam uses.
      if (!t || t.downed || !t.grp || !t.grp.parent || t.grp.visible === false) continue;
      const p = t.grp.position;
      // blast reaches the hull surface (island_airport grammar; hull radii
      // match the lock seam), and damage FALLS OFF with distance: a direct
      // hit wrecks the airframe, a near miss WOUNDS it into tier smoke.
      const hullD = Math.max(0, Math.hypot(p.x - x, p.y - y, p.z - z) - (t.kind === "heli" ? 2.6 : 3.2));
      if (hullD > radius) continue;
      let d = dmg * Math.max(0.3, 1 - hullD / radius);
      // NO SINGLE BLAST DOWNS A HELICOPTER (owner: "helicopters need two rpg
      // hits to come down"): rotorcraft cap any ONE explosive splash at 62%
      // of max hp — the first rocket wounds the bird into tier smoke (50hp
      // vs the 140 splash used to vaporise it), the second kills. Planes are
      // unchanged, and bullets (damageTraffic via the ray path) untouched.
      if (t.kind === "heli" && (!CBZ.CONFIG || CBZ.CONFIG.AIR_HELI_TWO_BLAST !== false)) d = Math.min(d, trafficHP(t) * 0.62);
      damageTraffic(t, d);
      hit++;
    }
    return hit;
  };

  function damageTraffic(t, dmg, quiet) {
    if (!t || t.downed || !(dmg > 0)) return;
    if (t.hp == null) t.hp = trafficHP(t);     // lazy — untouched craft carry no combat state
    t.hp -= dmg;
    // quiet = fpsmode already stamped the impact at the exact hull point (bullets);
    // skip this center spark so a sustained burst doesn't double every hit.
    if (!quiet && CBZ.bulletImpact) { try { CBZ.bulletImpact({ x: t.grp.position.x, y: t.grp.position.y, z: t.grp.position.z }, { x: 0, y: 1, z: 0 }, { kind: "spark", power: 1.1 }); } catch (e) {} }
    if (t.hp <= 0) downTraffic(t);
  }

  // ---- PLAIN-GUNFIRE HULL HIT (owner: "they also can't be shot") -------------
  // Like Air-1, the ambient fleet had a splash seam but no bullet ray-test, so
  // ordinary rounds passed through. Mirror the police-air / gunship ray-vs-sphere
  // idiom and route hits into the SAME damageTraffic pool → shared wounded-tier
  // smoke + shoot-down arc, idempotent behind `downed`. Flimsy civilian airframes
  // (hp 50/60) drop in a shorter burst than the police bird; a sniper takes one in
  // a couple. Ring-culled craft (520u+ away, stale mesh) are skipped, same gate as
  // the lock/splash seams. FX only → runtime Math.random elsewhere stays sanctioned.
  const TRAFFIC_BULLET_MULT = 0.28;   // w.damage × this per bullet (see POLICE_AIR_BULLET_MULT rationale)
  CBZ.cityAirTrafficRayTest = function (ox, oy, oz, dx, dy, dz, range) {
    if (!fleet || (CBZ.CONFIG && CBZ.CONFIG.AIRTRAFFIC_DAMAGE === false)) return null;
    let best = null, bestT = range, bestRec = null;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      if (!t || t.downed || !t.grp || !t.grp.parent || t.grp.visible === false) continue;
      const p = t.grp.position;
      const rad = t.kind === "heli" ? 2.6 : 3.2;         // same hull radii the lock/splash seams use
      const cx = p.x - ox, cy = p.y - oy, cz = p.z - oz;
      const tt = cx * dx + cy * dy + cz * dz;            // projection of the hull onto the ray
      if (tt < 0 || tt >= bestT) continue;
      const ex = ox + dx * tt - p.x, ey = oy + dy * tt - p.y, ez = oz + dz * tt - p.z;
      if (ex * ex + ey * ey + ez * ez > rad * rad) continue;
      bestT = tt; bestRec = t; best = { x: ox + dx * tt, y: oy + dy * tt, z: oz + dz * tt, dist: tt };
    }
    if (!best) return null;
    best.rec = bestRec; best.hitBullet = trafficBullet;
    return best;
  };
  // per-bullet chip into the shared pool for the craft the ray struck (rec is
  // threaded from the hit record; quiet: fpsmode stamped the hull impact).
  function trafficBullet(dmg, fromX, fromZ, rec) {
    if (!rec || (CBZ.CONFIG && CBZ.CONFIG.AIRTRAFFIC_DAMAGE === false)) return;
    damageTraffic(rec, Math.max(1.5, (dmg || 0) * TRAFFIC_BULLET_MULT), true);
  }

  // opts.cause === "building" is the AIR_TRAFFIC_COLLIDE strike; everything
  // else (the default) is the gun/rocket path and is byte-identical to what it
  // always did. ONE die function, because "blow up like other plane" is a
  // statement about reuse, not about a new effect.
  function downTraffic(t, opts) {
    if (!t || t.downed) return;                // idempotent — one death per airframe
    opts = opts || {};
    const struck = opts.cause === "building";
    t.downed = true;
    t.hitWall = struck;
    // freeze the orbit tangent as the crash heading: the wreck flies ON where
    // it was pointed, it doesn't keep steering the circuit.
    const ang = t.phase + t.dir * (t.speed / t.radius) * clock;
    t.crashDir = { x: -Math.sin(ang) * t.dir, z: Math.cos(ang) * t.dir };
    t.crashHeading = Math.atan2(t.crashDir.x, t.crashDir.z);
    // a plane carries its speed into the dive (fallJet grammar); a heli mostly
    // drops where it was hit (fallHeli grammar). Both get the lurch-up beat.
    t.crashSpd = t.kind === "plane" ? t.speed + 6 : t.speed * 0.4;
    t.vy = t.kind === "plane" ? 1.2 : 2.2;
    t.rollRate = t.kind === "plane" ? (Math.random() < 0.5 ? -1 : 1) * (2.0 + Math.random() * 2) : 0;   // wing-loss death roll
    t.yawRate = t.kind === "heli" ? (Math.random() < 0.5 ? -1 : 1) * (3.5 + Math.random() * 3) : 0;     // tail-rotor-loss flat spin
    t.spinT = 0; t.smokeCD = 0;
    if (struck) {
      // BLOW UP WHERE IT HIT. The impact grammar is the one fallTraffic
      // already uses when a wreck lands on a roof, fired at the WALL FACE
      // instead of at the ground under it — and byPlayer FALSE throughout,
      // because a plane the player never touched must put no heat on him.
      const q = opts.impact || t.grp.position;
      if (CBZ.cityExplosion) { try { CBZ.cityExplosion(q.x, q.z, { power: 1.6, radius: 8, byPlayer: false, y: q.y, kind: "aircraft" }); } catch (e) {} }
      if (CBZ.cityDamageBuilding) { try { CBZ.cityDamageBuilding(q.x, q.y, q.z, 1.8); } catch (e) {} }
      if (CBZ.cityShatter) { try { CBZ.cityShatter(q.x, q.z, 10); } catch (e) {} }
      if (CBZ.cityScorch) { try { CBZ.cityScorch(q.x, q.z, 3); } catch (e) {} }
      if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(q.x, q.y, q.z); } catch (e) {} }
      // you leave a wall, you do not fly on through it: the wreck drops down
      // the face instead of carrying its cruise speed into the building.
      t.crashSpd = t.kind === "plane" ? 8 : 4;
      t.vy = -1.0;
    }
    if (CBZ.sfx) CBZ.sfx("explosion");
    if (CBZ.shake) CBZ.shake(struck ? 0.35 : 0.3);
    if (CBZ.cityFlavor) CBZ.cityFlavor(
      struck
        ? (t.kind === "heli" ? "A civilian helicopter has flown into a building!"
                             : "A civilian plane has flown into a building!")
        : (t.kind === "heli" ? "You shot down a civilian helicopter!"
                             : "You shot down a civilian plane!"),
      "#ff8b6b");
    // occupants die with the airframe — route through the KILL BUS so the
    // corner feed attributes it ("You killed <citizen> · plane crash"; the
    // bus generates the citizen name for a null victim). GA planes sometimes
    // carry a passenger, so a second line can follow the pilot's.
    // A BUILDING STRIKE HAS NO KILLER: `by` is null, so killfeed.js logs the
    // (still generated) victim name with no attribution — nobody did this, and
    // the player must not be credited with a death he had no part in.
    if (CBZ.cityKillFeed) {
      const n = t.kind === "plane" && Math.random() < 0.4 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        try { CBZ.cityKillFeed(struck ? null : "You", null, t.kind === "heli" ? "helicopter crash" : "plane crash"); } catch (e) {}
      }
    }
  }

  // local collider-top scan (aircraft.js roofTopAt, per the builders-stay-
  // self-contained convention): a falling craft detonates ON the roof it
  // lands on, never the street six storeys below it.
  // Through the collider broadphase (the 8 m cell under the wreck holds every
  // box whose footprint + 1 m pad covers it — the same set the old walk of all
  // ~142k colliders found, every frame of every fall).
  const roofCols = [];
  function trafficRoofTop(x, z) {
    let topY = 0;
    const cols = CBZ.queryCollidersNear(x, z, 0, roofCols);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || c.y1 == null || c.y1 <= topY || c.y1 > 310) continue;
      if (x < c.minX - 1 || x > c.maxX + 1 || z < c.minZ - 1 || z > c.maxZ + 1) continue;
      topY = c.y1;
    }
    return topY;
  }

  // ballistic wreck ride-down — one function, both silhouettes (the plane
  // flies fallJet's carried-momentum roll, the heli fallHeli's flat spin).
  // Returns true once the wreck has impacted (caller removes the craft).
  function fallTraffic(t, dt) {
    t.vy -= 17 * dt;                                        // gravity owns it now
    const p = t.grp.position;
    if (t.kind === "plane") {
      t.crashSpd = Math.max(14, t.crashSpd - 22 * dt);      // momentum bleeds off
      p.x += t.crashDir.x * t.crashSpd * dt;
      p.z += t.crashDir.z * t.crashSpd * dt;
      t.grp.rotation.y = t.crashHeading;
      t.grp.rotation.x += dt * 0.5;                         // nose falls through the horizon
      t.grp.rotation.z += t.rollRate * dt;                  // death roll
    } else {
      p.x += t.crashDir.x * t.crashSpd * dt;
      p.z += t.crashDir.z * t.crashSpd * dt;
      t.grp.rotation.y += t.yawRate * dt;                   // flat spin
      t.grp.rotation.z += dt * 1.7;                         // roll belly-up as it dies
      t.grp.rotation.x = Math.sin((t.spinT += dt * 4) * 0.6) * 0.45;   // pitch lurch
    }
    p.y += t.vy * dt;
    // engine dead — everything windmills, the lights stay on
    t.afs.power = 0.12; t.afs.rotor = 0.45;
    CBZ.airframes.animate(t.grp, t.afs, dt);
    t.smokeCD -= dt;
    if (t.smokeCD <= 0) {
      t.smokeCD = 0.05;                                     // black smoke trail down the arc
      if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(p.x, p.y, p.z); } catch (e) {} }
    }
    const groundRaw = CBZ.floorAt ? +CBZ.floorAt(p.x, p.z) : 0;
    const ground = isFinite(groundRaw) ? groundRaw : 0;
    // YOU CANNOT LAND ON A ROOF YOU ARE ALREADY BELOW. trafficRoofTop answers
    // "tallest collider top here" with no reference to the wreck's own height,
    // so a craft falling PAST a tower — or one that just flew into its 40th
    // storey — used to "impact" on that tower's ROOF, detonating dozens of
    // metres above itself. Discarding a roof the wreck is under can only ever
    // let it fall FURTHER; it can never carry one through a surface it was
    // above, because in that case p.y is greater and the clamp does nothing.
    let roof = trafficRoofTop(p.x, p.z);
    if (roof > p.y) roof = 0;
    const surf = Math.max(ground, roof);
    if (p.y > surf + 1.2) return false;
    // CONTAINED crash fireball (aircraft.js wreckImpact grammar at light-
    // airframe scale) + a scorch where it couples to true ground — never the
    // block-leveling airstrike blast.
    const onRoof = surf > ground + 0.5;
    if (CBZ.cityExplosion) { try { CBZ.cityExplosion(p.x, p.z, { power: onRoof ? 1.5 : 1.2, radius: onRoof ? 7 : 6, byPlayer: false, y: surf + 1.0, kind: "aircraft" }); } catch (e) {} }
    if (onRoof && CBZ.cityDamageBuilding) { try { CBZ.cityDamageBuilding(p.x, surf + 1.0, p.z, 1.6); } catch (e) {} }
    if (CBZ.cityShatter) { try { CBZ.cityShatter(p.x, p.z, onRoof ? 9 : 7); } catch (e) {} }
    if (!onRoof && CBZ.cityScorch) { try { CBZ.cityScorch(p.x, p.z, 4); } catch (e) {} }
    if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(p.x, surf + 1.0, p.z); } catch (e) {} }
    if (CBZ.shake) CBZ.shake(0.5);
    return true;
  }

  // single-craft teardown (same dispose rules as teardown()); the parent
  // removal also nulls the cached lock seek, breaking any live lock.
  function removeTraffic(t) {
    const gi = fleet ? fleet.indexOf(t) : -1;
    if (gi >= 0) fleet.splice(gi, 1);
    if (!t.grp) return;
    if (t.grp.parent) t.grp.parent.remove(t.grp);
    t.grp.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      const m = o.material;
      if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
    });
  }

  CBZ.onUpdate(42.7, function (dt) {
    if (g.mode !== "city" || (CBZ.CONFIG && CBZ.CONFIG.AIR_TRAFFIC_AMBIENT === false)) {
      if (fleet) teardown();
      return;
    }
    if (CBZ.net && CBZ.net.noSim && CBZ.net.noSim()) { if (fleet) teardown(); return; }
    const root = arenaRoot();
    if (!root) { if (fleet) teardown(); return; }
    if (fleet && fleetRoot !== root) teardown();     // city rebuilt → fresh fleet
    if (!fleet) { fleet = buildFleet(root); fleetRoot = root; clearNext = 0; clearWho = 0; crashes = 0; }
    clock += Math.min(dt, 0.05);
    // ROUND-ROBIN CIRCUIT RE-MEASURE: one craft every CLEAR_REFRESH seconds, so
    // a tower demolished (demolition.js) or raised (construction.js) under an
    // existing track re-arms (or disarms) that craft within one fleet-length of
    // refreshes, for the cost of a single collider walk. The whole fleet is
    // never scanned in one frame after the build. This is the SLOW half of the
    // detector — the fast half is the per-frame armed-list test in the loop
    // below, which is exactly why this can afford to be slow.
    if (fleet.length && clock >= clearNext) {
      clearNext = clock + CLEAR_REFRESH;
      refreshClear(fleet[clearWho % fleet.length], false);
      clearWho++;
    }
    const P = CBZ.player;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      // a downed craft is a ballistic wreck: no orbit math, and NO ring cull —
      // the fall must finish (and detonate) even if the player drives away.
      if (t.downed) {
        t.grp.visible = true;
        if (fallTraffic(t, dt)) { removeTraffic(t); i--; }
        continue;
      }
      const ang = t.phase + t.dir * (t.speed / t.radius) * clock;
      const x = t.cx + Math.cos(ang) * t.radius;
      const z = t.cz + Math.sin(ang) * t.radius;
      // altitude converges BEFORE the cull, so a craft that spends a lap out
      // of sight still arrives back holding the right level (and a required
      // CLIMB was already taken outright by refreshClear — only the descent
      // is flown at rate).
      easeClear(t, dt);
      // ring cull: far traffic neither draws nor animates
      if (P) {
        const dx = x - P.pos.x, dz = z - P.pos.z;
        if (dx * dx + dz * dz > VIS_RING * VIS_RING) { t.grp.visible = false; continue; }
      }
      t.grp.visible = true;
      t.grp.position.set(x, t.alt, z);
      // ---- THE BUILDING IS REAL (AIR_TRAFFIC_COLLIDE) ---------------------
      // Tested AFTER the ring cull on purpose: a craft that is frozen and
      // undrawn should not detonate on the far side of the map, spend its FX
      // budget and empty the sky before the player has ever seen the fleet. It
      // resumes, and it dies on the frame it is drawn inside the tower — which
      // is also what makes this something you WATCH happen.
      if (COLLIDE() && t.hits && t.hits.length) {
        const s = hullSpan(t), lo = t.alt - HULL_V, hi = t.alt + HULL_V;
        // tiny armed-list test first; the O(colliders) live confirm runs only
        // on the one frame it says yes.
        if (hullStrike(t, x, z)) {
          const c = strikeConfirm(x, z, s, lo, hi);
          if (c) {
            // closest point of the box to the craft IS the wall face it struck
            const qx = Math.max(c.minX, Math.min(c.maxX, x));
            const qz = Math.max(c.minZ, Math.min(c.maxZ, z));
            const qy = Math.max(c.y0 == null ? 0 : c.y0, Math.min(c.y1, t.alt));
            crashes++;
            downTraffic(t, { cause: "building", impact: { x: qx, y: qy, z: qz } });
            continue;                    // the wreck arc owns it from here
          }
          t.hits.length = 0;             // stale candidate (demolished) — disarm until the next scan
        }
      }
      // heading = the orbit tangent; bank = the constant-radius turn angle
      // (tan(bank) = v^2 / (R*g)), signed to lean INTO the turn (matches the
      // player model's roll→turn sign convention). THIS FILE'S OWN FORMULA is
      // now the shared one — CBZ.heliOrbitBank (city/aircraft.js) is exactly
      // this expression, and the police chopper and the military gunship fly
      // their orbits on it too instead of a decorative sin() wobble. Local
      // fallback kept so this module never depends on load order.
      const vx = -Math.sin(ang) * t.dir, vz = Math.cos(ang) * t.dir;
      const heading = Math.atan2(vx, vz);
      const bank = -t.dir * (CBZ.heliOrbitBank ? CBZ.heliOrbitBank(t.speed, t.radius)
                                               : Math.atan((t.speed * t.speed) / (t.radius * 9.8))) * 0.85;
      t.grp.rotation.set(0, heading, Math.max(-0.5, Math.min(0.5, bank)));
      // surfaces hold the bank (a little aileron into the turn, rudder
      // coordinating), engines at cruise, strobes and beacon flashing
      t.afs.ail = -t.dir * 0.12; t.afs.rud = -t.dir * 0.08;
      CBZ.airframes.animate(t.grp, t.afs, dt);
      // damage-tier smoke: a wounded engine streams smoke while the craft
      // still flies its circuit — a glancing blast visibly COUNTS.
      if (t.hp != null && t.hp <= trafficHP(t) * 0.5) {
        t.hurtSmokeCD = (t.hurtSmokeCD || 0) - dt;
        if (t.hurtSmokeCD <= 0) {
          t.hurtSmokeCD = 0.4 + Math.random() * 0.35;
          if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(x + (Math.random() - 0.5), t.alt - 0.2, z + (Math.random() - 0.5)); } catch (e) {} }
        }
      }
    }
  });
})();
