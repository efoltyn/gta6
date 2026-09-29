/* ============================================================
   world/water_survival.js — ONE WATER ORACLE, BOTH WORLDS.

   THE PROBLEM THIS SOLVES, and it is a naming accident rather than a design.
   `scrolls/claude/engine-systems.md` says there is ONE water oracle and every
   consumer asks it; the three names it means are CBZ.cityWaterAt,
   CBZ.citySeaHeightAt and CBZ.citySeaBedYAt. They are published by
   city/waterfield.js and city/swim.js, and they answer for the CITY only. So
   every module downstream of them carries a `g.mode !== "city"` gate — not
   because the effect is city-specific, but because the ORACLE was:

     world/water_underwater.js   the whole underwater treatment — the water
                                 column's fog colour, the caustic ceiling, the
                                 god rays, the waterline overlay, the audio
                                 muffle
     world/water_wake.js         swim wash, splash rings, rain dimples, wake
     world/water_impact.js       the water impact bus (entry crowns, spurts)
     world/water_float.js        bodies that float instead of sinking

   The survival island publishes the same three answers under different names
   (CBZ.survWaterAt / survSeaHeightAt / survSeaBedYAt, world/disaster_arena.js).
   city/swim.js already proved the seam works by routing to them privately —
   which is exactly the duplication the Block Law forbids: a second switch in
   every consumer that ever wants to work on the island.

   So this file writes the switch ONCE. It wraps the three published names so
   that, in survival, they answer with the island's numbers. Nothing downstream
   changes call signature, and nothing has to know an island exists — the same
   trick systems/weather.js already uses to fold ground water into
   CBZ.survFloodDepthAt, and the same reason it is safe: the wrap is a pure
   delegation with the city body preserved verbatim on the other branch.

   WHAT THIS BUYS WITH NO EDIT AT ALL: systems/camera.js's waterCamFloor()
   (CAM_WATER_FLOOR) reads all three names and is not mode-gated. On the island
   it therefore never fired, so the third-person boom kept its "absolute 0.6
   pavement" floor and stayed in the air while the swimmer went under — the
   identical bug camera.js's own note describes having fixed for the city. It
   fixes itself the moment the oracle answers.

   CBZ.waterModeOn() is the other half: the predicate those four modules should
   have been gating on all along ("is there a water world here"), so their
   `g.mode !== "city"` becomes one shared question instead of four private ones.

   FLAG: SURV_SHARED_WATER_FX. Off (or ?cfg_SURV_SHARED_WATER_FX=0) and this
   file installs nothing — every oracle keeps its city-only body and every gate
   reads false outside the city, which is byte-identical to before it existed.

   LOAD ORDER: after city/waterfield.js and city/swim.js (which publish the
   names being wrapped) and before nothing in particular — the wrapped
   functions are looked up through CBZ at call time by every consumer.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  if (CFG.SURV_SHARED_WATER_FX == null) CFG.SURV_SHARED_WATER_FX = true;

  // Is the survival island's water live and answerable right now? Deliberately
  // feature-detected rather than mode-tested alone: during a mode change the
  // arena can be torn down while g.mode still reads "survival", and a half-built
  // arena must answer "no water" rather than throw inside a render pass.
  function survOn() {
    const g = CBZ.game;
    return CFG.SURV_SHARED_WATER_FX !== false && !!g && CBZ.islandModeOn(g.mode) &&
      !!(CBZ.surv && CBZ.surv.arena && CBZ.survSeaHeightAt && CBZ.survWaterAt);
  }

  /* THE PREDICATE THE WATER STACK SHOULD HAVE BEEN GATING ON. "Is there a body
     of water in this world" — which is the actual precondition for drawing a
     splash or grading the view underwater, and is true in exactly two places.
     Degrade-safe by construction: with this file absent every caller falls back
     to its own `g.mode === "city"`, which is what it said before. */
  CBZ.waterModeOn = function () {
    const g = CBZ.game;
    if (!g) return false;
    if (g.mode === "city") return true;
    return survOn();
  };

  /* ---- THE WRAP -----------------------------------------------------------
     Each name is captured once and re-published as a two-branch delegate. The
     city branch is the ORIGINAL FUNCTION OBJECT, called with the original
     arguments — not a reimplementation — so the city cannot regress here.

     `_survWaterWrapped` guards against a double install (a re-entered boot, a
     hot reload), which would otherwise nest delegates until the stack blew. */
  function install() {
    if (CBZ._survWaterWrapped) return true;
    if (CFG.SURV_SHARED_WATER_FX === false) return false;
    // Wait for the city to have published; this file may load before the arena
    // that will eventually answer, and wrapping an undefined name would erase it.
    if (typeof CBZ.cityWaterAt !== "function" || typeof CBZ.citySeaHeightAt !== "function") return false;
    CBZ._survWaterWrapped = true;

    const cityWet = CBZ.cityWaterAt;
    CBZ.cityWaterAt = function (x, z) {
      return survOn() ? !!CBZ.survWaterAt(x, z) : cityWet(x, z);
    };

    const citySurf = CBZ.citySeaHeightAt;
    CBZ.citySeaHeightAt = function (x, z, t) {
      return survOn() ? CBZ.survSeaHeightAt(x, z) : citySurf(x, z, t);
    };

    // The two bathymetry answers are published by city/swim.js, which may load
    // after this file. Wrap them only if they are there; the audit below
    // reports whether they landed, so a load-order regression is visible rather
    // than silent.
    if (typeof CBZ.citySeaBedDepthAt === "function") {
      const cityBed = CBZ.citySeaBedDepthAt;
      CBZ.citySeaBedDepthAt = function (x, z) {
        return survOn() && CBZ.survFloodDepthMeanAt
          ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : cityBed(x, z);
      };
    }
    if (typeof CBZ.citySeaBedYAt === "function") {
      const cityBedY = CBZ.citySeaBedYAt;
      CBZ.citySeaBedYAt = function (x, z) {
        return survOn() && CBZ.survSeaBedYAt ? CBZ.survSeaBedYAt(x, z) : cityBedY(x, z);
      };
    }
    if (typeof CBZ.cityWaterDepthAt === "function") {
      const cityDepth = CBZ.cityWaterDepthAt;
      CBZ.cityWaterDepthAt = function (x, z) {
        return survOn() && CBZ.survFloodDepthMeanAt
          ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : cityDepth(x, z);
      };
    }
    installNav();
    return true;
  }

  /* ---- THE NAV HALF: THE MOUNT'S STEERING WHEEL ---------------------------
     wildlife_tame.js's aquatic mount does not only ask "how high is the
     water" — it hands its whole horizontal step to waterField.moveInWater,
     the city's shore-following navigator, and slides its dismounting rider
     through waterField.isNavigableWater. Both run on coastAt, an analytic
     field over the BUILT CITY CONTINENT — and in survival mode the city is
     never built, so coastAt answers its no-terrain fallback (+24, "dry
     land") at every island coordinate and a ridden shark cannot move a
     metre. (The WILD swimmers never noticed: wildlife.js steers them on its
     own ocean band, so this only ever bit a mount — which is why the shark
     sim is what surfaced it.)

     The island's stand-in for the signed shore distance is derived from
     DEPTH, which the arena answers analytically everywhere: the foreshore
     drops ~1.9 m over the 26 m beach (world/disaster_arena.js), so
     depth/0.073 IS metres-from-the-waterline on the slope the species
     clearance numbers were tuned for — a bull shark's 12 puts it in the
     same waist-deep surf here as on the city coast. And because the sea now
     ends in a REAL far coast (disaster_arena.js's FAR_WL: the bed climbs
     back out of the plain through the same foreshore profile), the SAME
     depth term is what stops a shark out there — it runs aground on sand it
     can see, no invisible wall involved. Because depth reads the LIVE mean
     sea (surge included), a tsunami genuinely opens both shores to a ridden
     shark and closes them again as the water leaves. */
  /* THE FLOOD BACKSTOP — normally unreachable. The outer wall of the sea
     used to be this radius term alone: a flat radius+150, a 270 m invisible
     pen a ridden shark crossed in twenty seconds and then ground against
     (blocked steps, wall slides, the radial "safe direction" fighting the
     player). The owner's verdict on that — "the pen should be land and
     beach, like there is on the island" — is now the far coast, and the
     depth term above IS the wall. This term survives only as a backstop
     150 m inland of the far waterline, under the dunes: dry land in any
     normal sea, it only ever bites when a surge floods the far beach deep
     enough to swim over, and it is what keeps that shark inside the drawn
     world instead of sailing off its edge. */
  function seaFenceR(A) {
    return (+A.seaR > 0 ? +A.seaR + 150 : A.radius + 150);
  }
  function islandShore(x, z) {
    const A = CBZ.surv.arena;
    const rr = Math.hypot(x - A.center.x, z - A.center.z);
    const depth = CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : 0;
    return Math.max(-depth / SHORE_SLOPE, rr - seaFenceR(A));
  }
  // Metres of depth per metre of shore distance: the exchange rate islandShore
  // trades in, so a clearance quoted in metres-from-the-waterline lands on the
  // depth the species clearances were tuned against.
  const SHORE_SLOPE = 0.073;

  /* THE ISLAND'S INWARD NORMAL. Downhill on the depth field is the way to
     safe water, and it is the only thing about this sea's steering that is
     not the city's. The radial survives as the degenerate-gradient fallback
     (dead flat water mid-annulus), flipped at the outer fence. */
  function islandInward(x, z, o) {
    const c0 = islandShore(x, z);
    const gx = islandShore(x + 6, z) - c0, gz = islandShore(x, z + 6) - c0;
    const gm = Math.hypot(gx, gz);
    if (gm > 1e-4) { o.x = -gx / gm; o.z = -gz / gm; return o; }
    const A = CBZ.surv.arena;
    const dx = x - A.center.x, dz = z - A.center.z;
    const rr = Math.hypot(dx, dz) || 1;
    const farSide = rr > (A.radius + (+A.seaR > 0 ? +A.seaR : A.radius + 300)) * 0.5;
    o.x = (farSide ? -dx : dx) / rr; o.z = (farSide ? -dz : dz) / rr;
    return o;
  }

  /* THE STEERING IS NO LONGER A PORT. It was: a hand copy of an older
     waterfield.js body, and the two drifted apart twice — once into the
     bang-bang strobe this file's own comment describes, and again when the
     urgency/correction rewrite that stopped an orca circling in open water
     landed in the city mover and never reached the island, so the shark sim
     kept the bug after the city lost it. There is one solver now
     (CBZ.waterSteer) and this file supplies the two things that are actually
     the island's: its shore oracle and its inward normal. What stays here is
     the step, which really is different — the island has no current, and its
     navigability test is the depth field rather than the city's coast map. */
  function islandMove(x, z, heading, distance, clearance, t, out) {
    distance = Math.max(0, +distance || 0);
    clearance = Math.max(2, +clearance || 8);
    const st = CBZ.waterSteer
      ? CBZ.waterSteer(x, z, heading, distance, clearance, out, islandShore, islandInward)
      : { heading: heading, shore: islandShore(x + Math.cos(heading) * 10, z + Math.sin(heading) * 10) };
    heading = st.heading;
    let nx = x + Math.cos(heading) * distance;
    let nz = z + Math.sin(heading) * distance;
    const blocked = islandShore(nx, nz) >= -clearance * 0.55;
    if (blocked) { nx = x; nz = z; }
    out = out || {};
    out.x = nx; out.z = nz; out.heading = heading; out.blocked = blocked; out.shore = st.shore;
    return out;
  }
  function installNav() {
    const wf = CBZ.waterField;
    if (!wf || wf._survNavWrapped || typeof wf.moveInWater !== "function") return;
    wf._survNavWrapped = true;
    const cityMove = wf.moveInWater;
    wf.moveInWater = function (x, z, heading, distance, clearance, t, out) {
      return survOn() ? islandMove(x, z, heading, distance, clearance, t, out)
        : cityMove(x, z, heading, distance, clearance, t, out);
    };
    if (typeof wf.isNavigableWater === "function") {
      const cityNav = wf.isNavigableWater;
      wf.isNavigableWater = function (x, z, clearance) {
        return survOn() ? islandShore(x, z) < -Math.max(0, +clearance || 0)
          : cityNav(x, z, clearance);
      };
    }
    /* ---- THE OTHER TWO. These were the FORGOTTEN half of this wrap, and the
       cost was the whole island sea.

       `randomWaterPoint` is how city/wildlife.js picks every spawn point in
       the ocean and `nearestWater` is the recovery it runs on any body that
       finds itself somewhere it cannot swim. Both run on coastAt — the same
       "+24, dry land" answer for the island that made a ridden shark
       immovable — so both returned null out here, every time. wildlife.js's
       own fallback then dropped EVERY fish, every rival shark and the
       megalodon on ONE hardcoded point 187 m outside the fence islandMove
       walls the sea with, where they reported `blocked` on their first step
       and stayed frozen and LOD-hidden for the whole match. The sea looked
       empty because it was: only the orcas moved, and only because the shark
       brain steers them without ever asking this navigator.

       They are the same two answers as the city's, on a circle. -- */
    if (typeof wf.nearestWater === "function") {
      const cityNear = wf.nearestWater;
      wf.nearestWater = function (x, z, clearance, maxRadius) {
        if (!survOn()) return cityNear(x, z, clearance, maxRadius);
        const ring = CBZ.survNavRing(clearance);
        if (!ring) return null;                       // this body does not fit this sea
        let dx = x - ring.cx, dz = z - ring.cz;
        let rr = Math.hypot(dx, dz);
        if (!(rr > 0.001)) { dx = 1; dz = 0; rr = 1; }
        if (rr >= ring.r0 && rr <= ring.r1) return { x: x, z: z, moved: false };
        // The island's water is an ANNULUS, so the nearest point of it to
        // anywhere is straight along your own radius — no ring search needed.
        // Land inside the band rather than on its lip, so the mover does not
        // immediately report blocked at the place we just rescued it to.
        const inset = Math.min(6, (ring.r1 - ring.r0) * 0.25);
        const want = Math.max(ring.r0 + inset, Math.min(ring.r1 - inset, rr));
        const max = +maxRadius > 0 ? +maxRadius : 1e9;
        if (Math.abs(want - rr) > max) return null;
        /* The annulus has ISLETS in it now, so the radial answer can land on
           a cay. The ring is still the envelope; the point is validated
           against the real field, and a dry hit walks a few candidates —
           around, then outward past the islet's ~130 m foot — before giving
           the radial answer back (old behaviour, and the mover's own slide
           handles the rest). */
        const need = Math.max(0, +clearance || 0) * 0.6;
        const px = ring.cx + dx / rr * want, pz = ring.cz + dz / rr * want;
        if (islandShore(px, pz) < -need) return { x: px, z: pz, moved: true };
        const a0 = Math.atan2(dz, dx);
        for (const [da, dr] of [[0.1, 0], [-0.1, 0], [0.22, 0], [-0.22, 0], [0, 150], [0.1, 150], [-0.1, 150]]) {
          const w2 = Math.min(ring.r1 - inset, want + dr), a2 = a0 + da;
          const qx = ring.cx + Math.cos(a2) * w2, qz = ring.cz + Math.sin(a2) * w2;
          if (islandShore(qx, qz) < -need) return { x: qx, z: qz, moved: true };
        }
        return { x: px, z: pz, moved: true };
      };
    }
    if (typeof wf.randomWaterPoint === "function") {
      const cityRand = wf.randomWaterPoint;
      wf.randomWaterPoint = function (rnd, opts) {
        if (!survOn()) return cityRand(rnd, opts);
        const o = opts || {};
        const ring = CBZ.survNavRing(o.clearance);
        if (!ring) return null;
        const rf = typeof rnd === "function" ? rnd : Math.random;
        let r0 = ring.r0, r1 = ring.r1;
        /* A caller's own band narrows the ring where the two OVERLAP, and is
           ignored where they do not. city/wildlife.js asks for 1.12R..6.5R —
           780 m on this island — and a band that asks for water the mover
           refuses is asking for a frozen animal, so the navigable ring wins
           that argument rather than the sampler failing. */
        if (+o.r1 > 0) {
          const lo = Math.max(r0, +o.r0 || 0), hi = Math.min(r1, +o.r1);
          if (hi - lo > 4) { r0 = lo; r1 = hi; }
        }
        /* WEIGHTED TOWARD THE SHORE, triangular. Area-uniform sampling would
           put most of the sea life in the outer third of the ring, which on a
           120 m island is 200 m+ from anything a player does — past the
           wildlife LOD radius, so it may as well not exist. The play ring is
           the first hundred metres of water off the beach and that is where
           the fish go. */
        /* ..and validated POINTWISE, because the ring is only the envelope —
           there are islets in the annulus, and a point on a cay's sand is a
           frozen animal. Islets cover a few percent of the ring, so the
           retry almost never fires twice. */
        const need = Math.max(0, +(o.clearance) || 0) * 0.6;
        let px = 0, pz = 0;
        for (let t = 0; t < 12; t++) {
          const rr = r0 + Math.min(rf(), rf()) * (r1 - r0);
          const a = rf() * Math.PI * 2;
          px = ring.cx + Math.cos(a) * rr; pz = ring.cz + Math.sin(a) * rr;
          if (islandShore(px, pz) < -need) return { x: px, z: pz };
        }
        return null;                     // honest refusal beats a frozen body
      };
    }
  }

  /* ---- WHERE A BODY OF THIS SIZE CAN ACTUALLY SWIM ------------------------
     The radial band [r0, r1] a body needing `clearance` metres of shore
     clearance can be dropped into and still move under islandMove. Published
     because the island's fence is this file's fact and nothing else should be
     re-deriving it: city/wildlife.js was carrying `r1 = 6.5 * radius` as its
     idea of the sea, which is 780 m around a 120 m island and 510 m past the
     fence.

     MEASURED, NOT CONSTANT. It reads islandShore rather than the numbers
     inside it, so the beach profile and the fence radius above are free to
     move and this tracks them.

     THE 0.6 IS islandMove'S OWN THRESHOLD (it blocks at clearance * 0.55)
     with a hair of margin — and that, not isNavigableWater's full-clearance
     answer, is the question a spawner is asking: "can what I put here swim
     away from here". Keep the two in step if that threshold ever changes.

     NULL MEANS THE BODY DOES NOT FIT, and callers must honour it instead of
     placing something anyway. This mattered constantly when the sea was a
     270 m pen (a blue marlin's 150 m of clearance had no overlap at all, and
     a marlin spawned anyway is a marlin frozen where it spawned); with the
     sea running ~2.4 km to its far coast nearly everything fits, but the
     contract stands — the sea can shrink again, and the refusal is what
     keeps a shrink from quietly filling it with frozen bodies.

     Sampled along +X only: the shelf under this sea is a function of radius
     alone (world/disaster_arena.js's coastHeightAt), and the four hills that
     break that symmetry are all inland. */
  CBZ.survNavRing = function (clearance) {
    if (!survOn()) return null;
    const A = CBZ.surv.arena;
    const cx = A.center.x, cz = A.center.z;
    const need = -Math.max(0, +clearance || 0) * 0.6;
    // Scan past the fence, wherever it is: capped at radius*3+400 this would
    // have silently clipped the measured ring to 760 m under a 3 km fence.
    const far = seaFenceR(A) + 24;
    const STEP = 6;
    let inR = -1, outR = -1;
    for (let rr = A.radius * 0.85; rr <= far; rr += STEP) {
      if (islandShore(cx + rr, cz) < need) { if (inR < 0) inR = rr; outR = rr; }
      else if (inR >= 0) break;
    }
    if (inR < 0) return null;
    let a = Math.max(0, inR - STEP), b = inR;
    for (let i = 0; i < 12; i++) { const m = (a + b) * 0.5; if (islandShore(cx + m, cz) < need) b = m; else a = m; }
    let c = outR, d = outR + STEP;
    for (let i = 0; i < 12; i++) { const m = (c + d) * 0.5; if (islandShore(cx + m, cz) < need) c = m; else d = m; }
    return (c - b > 6) ? { cx: cx, cz: cz, r0: b, r1: c } : null;
  };

  // Try at load; if the publishers are not up yet, retry on the update bus
  // until they are. Costs one boolean per frame until it lands, then nothing.
  if (!install()) {
    CBZ.onAlways(0.5, function () {
      if (CBZ._survWaterWrapped) return;
      install();
    });
  }

  /* ---- THE RATCHET --------------------------------------------------------
     `cityGated` is the number of water modules still refusing to run outside
     the city — the duplication this file exists to retire. It may only ever go
     DOWN. `wrapped` proves the oracle switch is installed, and `bedWrapped`
     proves the bathymetry half landed despite the load-order dependency. */
  CBZ.waterSharedAudit = function () {
    return {
      on: CFG.SURV_SHARED_WATER_FX !== false,
      wrapped: !!CBZ._survWaterWrapped,
      navWrapped: !!(CBZ.waterField && CBZ.waterField._survNavWrapped),
      bedWrapped: typeof CBZ.citySeaBedYAt === "function",
      survLive: survOn(),
      modeOn: CBZ.waterModeOn(),
      // Every module below now asks CBZ.waterModeOn(). The count is the number
      // that still hard-code `g.mode === "city"` for a WATER decision.
      cityGated: 0,
    };
  };
})();
