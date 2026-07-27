/* ============================================================
   city/carcluster.js — THE INSTRUMENT CLUSTER.

   "HUD like a real car showing speed and speed limit in the area" — plus the
   fuel gauge, now that city/fuel.js has given vehicles a tank worth reading.

   WHY THIS IS NOT A HUD DOCTRINE VIOLATION
   ----------------------------------------
   CLAUDE.md is strict: the killfeed is the ONLY sanctioned popup, and rich
   information belongs in the phone rather than on floating cards. That rule
   is about POPUPS — transient cards that appear, say something, and leave.
   This is an instrument cluster: it exists only while you are driving, it
   never announces anything, and it is a sibling of the money and wanted
   readouts that already live permanently on screen. The cockpit wave settled
   the same question the same way for aircraft: instruments that belong to the
   vehicle are not notifications. It is gated to cars — aircraft already have
   real diegetic glass in city/cockpit*.js, and this must never fight it.

   WHERE THE NUMBERS COME FROM — no invention, no fictions
   -------------------------------------------------------
   • SPEED: vehicles.js:68 states the sim's own conversion in a comment —
     1 unit ≈ 2.4 mph, sedan top ≈ 35u ≈ 80 mph. That is the codebase's
     authority on its own scale, so it is used verbatim rather than guessed.
   • FUEL: CBZ.vehicleFuel(car), the one read city/fuel.js publishes.
   • SPEED LIMIT: see the seam note below.
   • Anything the game does not simulate is NOT drawn. The cockpit wave had to
     tear a fuel needle off the prop panel because it sat on F forever with no
     fuel model behind it; that is the trap, and CLAUDE.md bans it by name.

   THE SPEED-LIMIT SEAM — TEMPORARY, AND MEANT TO BE TAKEN OVER
   ------------------------------------------------------------
   A limit is a property of a ROAD, so `CBZ.roadSpeedLimit` belongs to whoever
   owns the road network. That work is not built yet, so this file defines the
   query ONLY IF nobody else has (`if (!CBZ.roadSpeedLimit)`), deriving it from
   what the world already exposes: highway footprints from CBZ.cityHighways(),
   and district tags off the nearest lot. When the roads domain lands and
   publishes a real per-segment limit, it wins automatically and this fallback
   goes quiet — no migration, no edit here. That is the seam shape this repo's
   postmortem says survives.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};

  if (CBZ.CONFIG.CAR_CLUSTER == null) CBZ.CONFIG.CAR_CLUSTER = true;
  // "mph" or "kmh". The sim's native scale is documented in mph, so that is
  // the default; kmh is a straight conversion, not a second calibration.
  if (CBZ.CONFIG.CAR_CLUSTER_UNIT == null) CBZ.CONFIG.CAR_CLUSTER_UNIT = "mph";
  // Show the limit roundel at all. Off = speed + fuel only.
  if (CBZ.CONFIG.CAR_CLUSTER_LIMIT == null) CBZ.CONFIG.CAR_CLUSTER_LIMIT = true;

  const MPH_PER_UNIT = 2.4;          // vehicles.js:68 — the repo's own figure
  const on = () => CBZ.CONFIG.CAR_CLUSTER !== false;

  /* ---- THE LIMIT QUERY (fallback only — see header) --------------------- */
  if (!CBZ.roadSpeedLimit) {
    const LIMIT = {
      highway: 65, arterial: 45, industrial: 35,
      core: 30, commercial: 30, residential: 25, projects: 25,
      _default: 30,
    };
    let lotCache = null, lotN = -1;
    function lots() {
      const A = CBZ.city && (CBZ.city.arena || CBZ.city);
      const L = A && A.lots;
      if (!L) return null;
      if (lotN !== L.length) { lotCache = L; lotN = L.length; }
      return lotCache;
    }
    CBZ.roadSpeedLimit = function (x, z) {
      // A highway footprint is an AABB, so this is exact and cheap.
      const hw = CBZ.cityHighways ? CBZ.cityHighways() : null;
      if (hw) {
        for (let i = 0; i < hw.length; i++) {
          const f = hw[i] && hw[i].footprint;
          if (f && x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) return LIMIT.highway;
        }
      }
      // Otherwise the neighbourhood you are in sets the limit, which is how
      // it works in reality — a limit is a property of a place, not a sign.
      const L = lots();
      if (L && L.length) {
        let best = null, bd = 1e18;
        for (let i = 0; i < L.length; i++) {
          const l = L[i]; if (!l) continue;
          const dx = l.cx - x, dz = l.cz - z, dd = dx * dx + dz * dz;
          if (dd < bd) { bd = dd; best = l; }
        }
        if (best && bd < 160 * 160) return LIMIT[best.district] || LIMIT._default;
      }
      return 0;   // 0 = unposted (open country / off-road): draw no roundel
    };
    CBZ.roadSpeedLimit._fallback = true;   // the roads domain may replace this
  }

  /* ---- THE PANEL -------------------------------------------------------- */
  let el = null, elSpeed = null, elUnit = null, elLimit = null, elLimitNum = null;
  let elFuelFill = null, elFuelWrap = null, elGear = null;
  let lastFP = "";

  function build() {
    if (el) return el;
    const css = document.createElement("style");
    css.textContent = [
      "#cCluster{position:fixed;right:14px;bottom:92px;z-index:44;display:none;",
      "font-family:ui-monospace,Menlo,monospace;color:#e8edf5;pointer-events:none;",
      "text-align:right;text-shadow:0 1px 3px rgba(0,0,0,.75)}",
      "#cCluster .row{display:flex;align-items:flex-end;justify-content:flex-end;gap:10px}",
      "#cSpeed{font-size:44px;font-weight:700;line-height:.92;letter-spacing:-1px;",
      "font-variant-numeric:tabular-nums}",
      "#cSpeedU{font-size:12px;opacity:.62;letter-spacing:1px;padding-bottom:6px}",
      "#cGear{font-size:13px;opacity:.7;padding-bottom:7px;min-width:16px}",
      "#cLimit{width:46px;height:46px;border-radius:50%;background:#f4f4f2;",
      "border:5px solid #cf2b2b;display:none;align-items:center;justify-content:center;",
      "box-shadow:0 2px 8px rgba(0,0,0,.5)}",
      "#cLimitN{color:#15181d;font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}",
      "#cCluster.over #cLimit{animation:cLimPulse .62s ease-in-out infinite}",
      "@keyframes cLimPulse{0%,100%{box-shadow:0 2px 8px rgba(0,0,0,.5)}",
      "50%{box-shadow:0 0 0 6px rgba(207,43,43,.42),0 2px 8px rgba(0,0,0,.5)}}",
      "#cFuel{margin-top:8px;width:118px;height:7px;border-radius:4px;margin-left:auto;",
      "background:rgba(255,255,255,.16);overflow:hidden}",
      "#cFuelF{height:100%;width:100%;background:#68c08a;transition:width .25s linear}",
      "#cCluster.lowfuel #cFuelF{background:#e0913c}",
      "#cCluster.dry #cFuelF{background:#cf2b2b}",
      // TOUCH: systems/touch_vehicle.js already owns a real racing dial in
      // this corner, so the cluster gives up the speed readout rather than
      // stack a second speedometer beside the first — and keeps the two
      // things that dial does NOT show, the posted limit and the fuel.
      "#cCluster.handoff{bottom:auto;top:96px}",
      "#cCluster.handoff #cSpeed,#cCluster.handoff #cSpeedU,#cCluster.handoff #cGear{display:none}",
    ].join("");
    document.head.appendChild(css);

    el = document.createElement("div");
    el.id = "cCluster";
    el.innerHTML =
      '<div class="row">' +
        '<div id="cLimit"><span id="cLimitN">30</span></div>' +
        '<span id="cGear"></span>' +
        '<span id="cSpeed">0</span>' +
        '<span id="cSpeedU">MPH</span>' +
      "</div>" +
      '<div id="cFuel"><div id="cFuelF"></div></div>';
    document.body.appendChild(el);
    elSpeed = el.querySelector("#cSpeed");
    elUnit = el.querySelector("#cSpeedU");
    elLimit = el.querySelector("#cLimit");
    elLimitNum = el.querySelector("#cLimitN");
    elFuelFill = el.querySelector("#cFuelF");
    elFuelWrap = el.querySelector("#cFuel");
    elGear = el.querySelector("#cGear");
    return el;
  }

  /* Only cars. Aircraft have real diegetic instruments (city/cockpit*.js) and
     a second readout fighting them would be worse than none; boats get the
     helm's own feedback. */
  function clusterCar() {
    const P = CBZ.player;
    if (!P || !P.driving || P.dead) return null;
    const car = P._vehicle;
    if (!car) return null;
    const feel = car._playerCarFeel;
    if (feel && feel.class === "marine") return null;
    if (P._aircraft || car.isAircraft) return null;
    return car;
  }

  CBZ.onAlways(CBZ.PRIO && CBZ.PRIO.LATE ? CBZ.PRIO.LATE - 2 : 88, function () {
    if (!on()) { if (el) el.style.display = "none"; return; }
    const g = CBZ.game;
    if (!g || g.mode !== "city") { if (el) el.style.display = "none"; return; }
    const car = clusterCar();
    if (!car) { if (el) el.style.display = "none"; return; }
    build();
    el.style.display = "block";

    const kmh = CBZ.CONFIG.CAR_CLUSTER_UNIT === "kmh";
    const mph = Math.abs(car.v || 0) * MPH_PER_UNIT;
    const shown = Math.max(0, Math.round(kmh ? mph * 1.609 : mph));

    let limit = 0;
    if (CBZ.CONFIG.CAR_CLUSTER_LIMIT !== false && CBZ.roadSpeedLimit) {
      const p = car.group ? car.group.position : car.pos;
      if (p) { try { limit = CBZ.roadSpeedLimit(p.x, p.z) | 0; } catch (e) { limit = 0; } }
    }
    const limShown = limit > 0 ? (kmh ? Math.round(limit * 1.609 / 5) * 5 : limit) : 0;
    const over = limit > 0 && mph > limit + 4;      // 4 mph of grace, as posted enforcement has

    const f = CBZ.vehicleFuel ? CBZ.vehicleFuel(car) : null;
    const gear = car._gear != null ? car._gear : null;
    const gearTxt = (car.v || 0) < -0.4 ? "R" : (gear ? String(gear) : "");

    // Hand the speedometer over to the touch dial when that layer is live.
    const handoff = !!(CBZ.touchVehicleActive && CBZ.touchVehicleActive());

    // Repaint only when something visible changed — the killfeed's fingerprint
    // trick. A per-frame innerHTML write on a driving HUD is pure jank.
    const fp = shown + "|" + limShown + "|" + (over ? 1 : 0) + "|" +
               (f ? Math.round(f.frac * 60) : -1) + "|" + gearTxt + "|" + (handoff ? 1 : 0);
    if (fp === lastFP) return;
    lastFP = fp;

    elSpeed.textContent = String(shown);
    elUnit.textContent = kmh ? "KM/H" : "MPH";
    elGear.textContent = gearTxt;
    if (limShown > 0) { elLimit.style.display = "flex"; elLimitNum.textContent = String(limShown); }
    else elLimit.style.display = "none";
    el.classList.toggle("over", !!over);
    el.classList.toggle("handoff", handoff);

    if (f) {
      elFuelWrap.style.display = "block";
      elFuelFill.style.width = (f.frac * 100).toFixed(1) + "%";
      el.classList.toggle("lowfuel", !!f.low && !f.empty);
      el.classList.toggle("dry", !!f.empty);
    } else {
      elFuelWrap.style.display = "none";   // no fuel model loaded: draw no gauge
    }
  });

  /* Whether the limit query is still this file's stopgap or the roads domain
     has taken it over. Should read false once roads land. */
  CBZ.clusterAudit = function () {
    return { limitIsFallback: !!(CBZ.roadSpeedLimit && CBZ.roadSpeedLimit._fallback) };
  };
})();
