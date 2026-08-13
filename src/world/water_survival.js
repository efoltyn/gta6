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
    return CFG.SURV_SHARED_WATER_FX !== false && !!g && g.mode === "survival" &&
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
    return true;
  }

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
      bedWrapped: typeof CBZ.citySeaBedYAt === "function",
      survLive: survOn(),
      modeOn: CBZ.waterModeOn(),
      // Every module below now asks CBZ.waterModeOn(). The count is the number
      // that still hard-code `g.mode === "city"` for a WATER decision.
      cityGated: 0,
    };
  };
})();
