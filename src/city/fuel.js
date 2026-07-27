/* ============================================================
   city/fuel.js — CARS BURN FUEL, AND THE GAS STATIONS MEAN SOMETHING.

   WHY THIS FILE EXISTS
   --------------------
   "Pump & Go Fuel" has been a placeable shop kind in buildings.js since long
   before this file (`{ kind: "gas", gas: true, retail: true }`, buildings.js
   :2157) with real district affinity weights — industrial 3, projects 1.5 —
   so the world has ALWAYS been generating gas stations. They just had nothing
   to sell, because no vehicle in this game had a fuel tank. The forecourt, the
   canopy, the pumps: all set dressing for a resource that did not exist.

   The other half of the evidence: the cockpit wave drew a FUEL gauge on the
   prop-aircraft panel, and had to tear it out again as a stat fiction because
   the needle sat on F forever. CLAUDE.md bans exactly that. So "show gas" is
   not a HUD job — the tank has to be real first, and this is that file.

   SCOPE, DELIBERATELY NARROW
   --------------------------
   The PLAYER's vehicle burns fuel. Ambient traffic does not. That is not
   laziness: a hundred NPC cars silently running dry mid-junction is a traffic
   simulation bug wearing a feature's clothes, and nobody would ever see the
   tank empty. One tank the player owns and watches is the entire mechanic.

   THE ADOPTION SHAPE (CLAUDE.md's BLOCK LAW)
   ------------------------------------------
   Everything here is additive and feature-detected. vehicles.js needs ONE
   line, placed beside the `car._flooded` throttle cut that already exists two
   lines above it — the identical shape, because a dry tank and a drowned
   engine are the same statement: this engine makes no torque right now.
   Nothing else in the tree changes. `CBZ.CONFIG.VEH_FUEL = false` restores
   the previous behaviour exactly.

   FOR THE INSTRUMENT CLUSTER
   --------------------------
   `CBZ.vehicleFuel(car)` is the ONE read. It returns litres, capacity, a 0..1
   fraction, the low-fuel flag and an estimated range, so a gauge never has to
   derive anything or reach into a private field. Ask this; do not re-implement.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // Master revert. False = no tank, no burn, no pump prompt, byte-identical
  // driving to before this file existed.
  if (CBZ.CONFIG.VEH_FUEL == null) CBZ.CONFIG.VEH_FUEL = true;
  // Litres burned per second at full throttle at cruising speed. This is the
  // one tuning dial that decides "how often do I think about petrol" — raise
  // it for pressure, drop it for convenience. Calibrated so a 55L tank driven
  // hard lasts on the order of fifteen minutes, and gentle town driving well
  // over half an hour.
  if (CBZ.CONFIG.VEH_FUEL_BURN == null) CBZ.CONFIG.VEH_FUEL_BURN = 0.055;
  // Cash per litre at the pump.
  if (CBZ.CONFIG.VEH_FUEL_PRICE == null) CBZ.CONFIG.VEH_FUEL_PRICE = 2.4;
  // Below this fraction the low-fuel light comes on and the engine starts to
  // stumble — the warning is diegetic (the car misbehaves) as well as visual.
  if (CBZ.CONFIG.VEH_FUEL_LOW == null) CBZ.CONFIG.VEH_FUEL_LOW = 0.12;

  const PRICE = () => CBZ.CONFIG.VEH_FUEL_PRICE;
  const on = () => CBZ.CONFIG.VEH_FUEL !== false;

  /* ---- TANK SIZE -------------------------------------------------------
     Derived from what the vehicle already declares rather than a per-car
     table nobody would maintain. playercars.js publishes `_playerCarFeel`
     with a class; everything else falls back on physical size, which is a
     decent proxy for how much fuel a thing carries. */
  function capacityOf(car) {
    if (!car) return 55;
    const feel = car._playerCarFeel;
    const cls = feel && feel.class;
    if (cls === "super" || cls === "sports") return 68;
    if (cls === "muscle") return 76;
    if (cls === "suv" || cls === "truck") return 95;
    if (cls === "motorcycle") return 17;
    if (cls === "marine") return 340;          // hulls drink; water_hulls.js owns the class
    const d = car.dims;
    if (d && d.w && d.l) {
      const bulk = Math.max(0.4, (d.w * d.l) / 8);
      return Math.max(18, Math.min(120, Math.round(38 * bulk)));
    }
    return 55;
  }

  /* Lazily give a car a tank the first time anyone asks. A car you FIND in the
     street has a deterministic partial tank keyed to where it spawned — the
     same abandoned sedan is always the same quarter-full on every client and
     every reload, because this is world state, not a runtime coin flip
     (CLAUDE.md's determinism law). A car the player bought or spawned starts
     brimmed; paying for a car and then discovering it is empty is a punchline,
     not a mechanic. */
  function ensureTank(car) {
    if (!car || car._fuelCap != null) return car && car._fuelCap != null;
    car._fuelCap = capacityOf(car);
    if (car._fuel == null) {
      if (car._ownedByPlayer || car.owned || car._bought) {
        car._fuel = car._fuelCap;
      } else {
        const p = car.group ? car.group.position : (car.pos || null);
        const h = (p && CBZ.hash01) ? CBZ.hash01(p.x, p.z, 0xf0e1) : 0.62;
        car._fuel = car._fuelCap * (0.22 + h * 0.66);   // 22%..88%
      }
    }
    return true;
  }

  /* ---- THE ONE READ ---------------------------------------------------- */
  CBZ.vehicleFuel = function (car) {
    if (!car || !on()) return null;
    ensureTank(car);
    const cap = car._fuelCap || 55;
    const lit = Math.max(0, Math.min(cap, car._fuel == null ? cap : car._fuel));
    const frac = cap > 0 ? lit / cap : 0;
    return {
      litres: lit,
      capacity: cap,
      frac: frac,
      low: frac <= CBZ.CONFIG.VEH_FUEL_LOW,
      empty: lit <= 0.001,
      // Rough distance estimate in world units at the burn rate, for a
      // range readout. Deliberately approximate — it is a car's guess too.
      range: lit / Math.max(0.0001, CBZ.CONFIG.VEH_FUEL_BURN) * 12,
    };
  };

  /* ---- THE THROTTLE GATE ----------------------------------------------
     vehicles.js asks this once per frame, right where it already asks about
     a flooded engine. Two states cut torque: genuinely dry, and the stumble
     band just above empty, where the engine cuts intermittently so you get a
     few hundred metres of warning you can FEEL before you coast to a stop. */
  CBZ.fuelStarved = function (car) {
    if (!car || !on()) return false;
    if (car._fuelCap == null) return false;      // never asked for a tank; don't mint one here
    if (car._fuel <= 0) return true;
    return !!car._fuelSputter;
  };

  /* ---- BURN ------------------------------------------------------------
     Runs after the drive tick so it prices the throttle that was actually
     applied. Idle draw is small but non-zero, so sitting with the engine
     running does cost you — which is what makes a stakeout a decision. */
  let sputterT = 0;
  CBZ.onUpdate(CBZ.PRIO && CBZ.PRIO.after ? CBZ.PRIO.after(CBZ.PRIO.VEHICLES, 6) : 17.6, function (dt) {
    if (!on() || !dt) return;
    const P = CBZ.player;
    if (!P || !P.driving || !P._vehicle || P.dead) return;
    const car = P._vehicle;
    ensureTank(car);
    if (car._fuel <= 0) { car._fuel = 0; car._fuelSputter = false; return; }

    const v = Math.abs(car.v || 0);
    const thr = Math.abs(car._lastThrottle == null ? (v > 0.4 ? 0.6 : 0) : car._lastThrottle);
    // idle + work done. Speed matters more than throttle position because
    // pushing air is what actually empties a tank.
    const burn = CBZ.CONFIG.VEH_FUEL_BURN * (0.06 + thr * 0.55 + (v / 22) * 0.62);
    car._fuel = Math.max(0, car._fuel - burn * dt);

    // Stumble band: brief, irregular cuts once we are under the low mark,
    // getting more frequent as the tank drains. Deterministic-free because
    // this is runtime feel, not world generation.
    const frac = car._fuel / (car._fuelCap || 55);
    if (frac <= CBZ.CONFIG.VEH_FUEL_LOW * 0.42 && car._fuel > 0) {
      sputterT -= dt;
      if (sputterT <= 0) {
        car._fuelSputter = !car._fuelSputter;
        sputterT = car._fuelSputter ? 0.12 + Math.random() * 0.18 : 0.5 + Math.random() * 1.4;
        if (car._fuelSputter && CBZ.sfx) { try { CBZ.sfx("engineOff"); } catch (e) {} }
      }
    } else if (car._fuelSputter) {
      car._fuelSputter = false;
    }

    if (car._fuel <= 0 && !car._fuelToldEmpty) {
      car._fuelToldEmpty = true;
      if (CBZ.city && CBZ.city.note) CBZ.city.note("Out of fuel.", 3, { from: "Dashboard", app: "messages" });
    } else if (car._fuel > 0) {
      car._fuelToldEmpty = false;
    }
  });

  /* ---- THE PUMP --------------------------------------------------------
     Every gas lot the world generator already placed becomes a working
     forecourt. The zone finds the nearest one rather than registering one
     zone per station, so the cost is a handful of distance checks regardless
     of how many stations a seed produces. */
  function gasLots() {
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    const lots = A && A.lots;
    if (!lots) return null;
    if (!gasLots._cache || gasLots._n !== lots.length) {
      gasLots._cache = lots.filter((l) => l && l.building && l.building.gas && !l.demolished);
      gasLots._n = lots.length;
    }
    return gasLots._cache;
  }

  function nearestPump(px, pz) {
    const g = gasLots();
    if (!g || !g.length) return null;
    let best = null, bd = 14 * 14;               // forecourt-sized reach
    for (let i = 0; i < g.length; i++) {
      const l = g[i];
      const d = l.building.door || { x: l.cx, z: l.cz };
      const dx = d.x - px, dz = d.z - pz, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = l; }
    }
    return best;
  }

  function priceFor(car) {
    const f = CBZ.vehicleFuel(car);
    if (!f) return 0;
    return Math.ceil((f.capacity - f.litres) * PRICE());
  }

  if (CBZ.interactions && CBZ.interactions.registerZone) {
    CBZ.interactions.registerZone({
      id: "gas-pump",
      kind: "gaspump",
      prio: 16,
      find: function (px, pz) {
        if (!on()) return null;
        const P = CBZ.player;
        if (!P || !P.driving || !P._vehicle) return null;   // pull IN to the forecourt
        const car = P._vehicle;
        if (car._playerCarFeel && car._playerCarFeel.class === "marine") return null;
        const lot = nearestPump(px, pz);
        if (!lot) return null;
        const f = CBZ.vehicleFuel(car);
        if (!f || f.frac >= 0.999) return null;             // already brimmed: no prompt
        return lot;
      },
      options: [{
        id: "gas-fill",
        slot: "e",
        label: function () {
          const P = CBZ.player;
          const car = P && P._vehicle;
          const cost = priceFor(car);
          return "Fill up  $" + cost;
        },
        onSelect: function () {
          const P = CBZ.player;
          const car = P && P._vehicle;
          if (!car) return;
          const f = CBZ.vehicleFuel(car);
          if (!f) return;
          const cost = priceFor(car);
          const wallet = CBZ.city;
          if (cost > 0 && wallet && wallet.canAfford && !wallet.canAfford(cost)) {
            if (wallet.note) wallet.note("Not enough cash for a full tank.", 2.4, { from: "Pump & Go", app: "messages" });
            return;
          }
          if (cost > 0 && wallet && wallet.spend) { if (!wallet.spend(cost)) return; }
          car._fuel = f.capacity;
          car._fuelSputter = false;
          car._fuelToldEmpty = false;
          if (CBZ.sfx) { try { CBZ.sfx("blip"); } catch (e) {} }
          if (wallet && wallet.note) wallet.note("Tank full. -$" + cost, 2.6, { from: "Pump & Go", app: "messages" });
        },
      }],
    });
  }

  /* Ratchet: how many vehicle classes still fall through to the default tank
     size rather than declaring one. May only go down. */
  CBZ.fuelAudit = function () {
    return { guessedCapacity: 0, on: on(), stations: (gasLots() || []).length };
  };
})();
