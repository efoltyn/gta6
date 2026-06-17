/* ============================================================
   city/armored.js — AGENT BRINKS: the ARMORED CASH TRUCK heist target.

   WHY: the city already has cars to steal and roofs to crack, but no
   high-stakes ROLLING SCORE — a target that's genuinely HARD to crack and
   pays a genuinely FAT haul. This is that target: every so often a boxy
   armored cash truck (Brink's-style) joins traffic and drives the roads
   like any other car. It is a real RISK/REWARD play:

     • HARD TO CRACK — the hull is heavily armored. Small-arms fire barely
       dents it (a wrap on cityDamageCar shrugs off ~94% of bullet energy
       against this truck only); you can empty a rifle into it and it just
       sparks. Ramming it does almost nothing.
     • CREW THAT FIGHTS — an armored crew rides with it. The moment you
       open up on the truck (or crack it), the guards BAIL OUT and engage:
       real cops spawned through citySpawnCop, so they shoot back, take
       cover, and the wanted system treats this exactly like cop combat.
     • YOU BLOW IT OPEN — the ONLY reliable way in is EXPLOSIVES. An RPG,
       a grenade, or a stuck C4 charge near the truck routes through the
       EXACT same cityExplosion chain everything else uses; we listen on
       that chain (wrap cityExplosion) and feed the blast straight into the
       truck's armored health. Enough boom = the doors blow → CRACKED.
     • REALISTIC HAUL — a cracked truck SPILLS cash on the street. The haul
       is scaled to real reporting (see RESEARCH below): a typical robbed
       truck mid-route carries several hundred K to ~$1.5M; a full-route
       "fat" truck can approach the insurance-limit ~$2M. The player walks
       over the spilled cash to loot it (auto-collect, like a pickup).
     • ARMED ROBBERY = HEAT — cracking it is a loud, reported armed robbery:
       an instant armed-robbery report + a hard star spike, so the whole
       block lights up. There is no quiet way to take it.

   RESEARCH (web, June 2026 — used to scale the haul):
     • Cash-in-transit loads run ~$50k–$500k per vehicle on a typical run;
       single ATM/branch replenishment tills are ~$100k–$300k each.
     • Real armored-truck robberies (Brink's/Loomis, Philadelphia 2025–26)
       netted $700k, $1.5M, and up to $1.8M from a single truck.
     • Trucks are insurance-limited to ~$2M on the road in practice (a
       theoretical max fully-loaded truck is cited near half a billion, but
       that's not a street-robbery figure — we cap the game haul at ~$2M).
   So: HAUL_MIN $260k, HAUL_MAX $1.5M typical; a rarer "FULL ROUTE" truck
   rolls $1.6M–$2.0M and carries a bigger guard detail. Concrete, grounded.

   PERF / SAFETY:
     • AT MOST ONE truck alive at a time, spawned on a long cooldown only
       when the player is on the street and far from one — so it's an event,
       not a fixture. It IS an ordinary traffic car (CBZ.cityMakeCar), so the
       existing traffic AI drives it for free; we add only a handful of
       armored detail boxes + a beacon to its group (draw-call-cheap, all
       merged-adjacent shared material where possible).
     • Guards are reused cop rigs (citySpawnCop) — no new ped system. They
       only exist while a truck is being robbed, then despawn with the heat.
     • CITY-ONLY: every entry point gates on g.mode==="city"; jail and
       disaster-survival never run a line of this. Headless-guarded.
     • Wraps (cityDamageCar, cityExplosion) are additive: they call through
       to the original for every non-armored-truck car, so nothing else
       changes behaviour. Idempotent install guards prevent double-wrap on
       a hot reload.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- tuning ---------------------------------------------------------------
  const TUNE = {
    spawnEvery: [80, 140],     // seconds between truck appearances (random in range)
    firstDelay: 35,            // grace before the first one can roll
    spawnFarFrom: 70,          // don't pop one right on top of the player
    maxAlive: 1,               // hard cap: one rolling score at a time
    hullHp: 1000,              // armored-health pool (separate from engineHp); explosives chew this
    bulletShrug: 0.06,         // fraction of bullet damage the hull actually takes (~94% shrugged)
    ramShrug: 0.12,            // fraction of ram/crash damage taken
    blastToHull: 220,          // hull damage from one in-radius RPG/grenade/C4 blast (power 1)
    crackArmRange: 9,          // a blast within this of the truck couples into the hull
    guardsBase: 2,             // crew that bails when you start a fight / crack it
    guardsFull: 3,             // extra crew on a "full route" truck
    haulMin: 260000,           // realistic mid-route haul floor ($260k)
    haulMax: 1500000,          // typical robbed-truck ceiling ($1.5M)
    haulFullMin: 1600000,      // a rarer "FULL ROUTE" truck...
    haulFullMax: 2000000,      // ...up to the ~$2M insurance-limit street load
    fullRouteChance: 0.22,     // chance any given truck is a fat full-route run
    lootRange: 3.2,            // walk this close to spilled cash to grab it
    despawnFar: 360,           // cull an untouched truck that drives way off
  };

  // the armored truck reads as a Brink's-style hardened van: a boxy dark-grey
  // armored body. We register it through the SAME model shape every traffic car
  // uses (detailStyle:"van" → the van visual silhouette), then bolt a few armored
  // detail boxes + a roof beacon onto its group after spawn.
  const TRUCK_MODEL = {
    name: "Armored Cash Truck",
    value: 38000, rarity: 1.0,
    color: 0x3a3f45,           // gunmetal armor grey
    s: 1.22,                   // a touch larger/heavier than a normal van
    body: "van", detailStyle: "van", designStyle: "armored",
    armoredTruck: true,
  };

  let _s = 99173;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function ri(lo, hi) { return lo + rng() * (hi - lo); }

  let truck = null;            // the live armored-truck car record (or null)
  let nextSpawnT = TUNE.firstDelay;   // seconds of in-mode time until the next spawn attempt
  let _lastElapsed = 0;

  // shared armor-detail material (one Lambert, reused across every bolt-on box →
  // these merge into the same draw bucket as the truck's dark trim, so the armored
  // dressing is draw-call-cheap). The beacon is its own tiny emissive.
  let ARMOR_MAT = null, BEACON_MAT = null, PLATE_MAT = null;
  function armorAssets() {
    if (ARMOR_MAT) return;
    ARMOR_MAT = new THREE.MeshLambertMaterial({ color: 0x2c3036 });
    PLATE_MAT = new THREE.MeshLambertMaterial({ color: 0x4a5158 });
    BEACON_MAT = new THREE.MeshBasicMaterial({ color: 0xffb030 });
    ARMOR_MAT._shared = PLATE_MAT._shared = BEACON_MAT._shared = true;
  }

  // ---- bolt the armored dressing onto a freshly-built truck group -----------
  function dressTruck(grp) {
    armorAssets();
    const dress = new THREE.Group();
    dress.userData._armoredDress = true;
    // skirt of reinforced plating low along each flank (reads as bolted armor)
    const plate = new THREE.BoxGeometry(2.4, 0.5, 0.06);
    [-1.18, 1.18].forEach((sx) => {
      const m = new THREE.Mesh(plate, PLATE_MAT);
      m.position.set(sx, 1.0, 0); m.rotation.y = Math.PI / 2; dress.add(m);
    });
    // a slit-windowed reinforced cab band across the nose
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.34, 0.12), ARMOR_MAT);
    band.position.set(0, 1.78, 2.0); dress.add(band);
    // rear blast doors — a thick double-leaf seam the player learns to aim explosives at
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.5, 0.14), ARMOR_MAT);
    door.position.set(0, 1.45, -2.45); dress.add(door);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.5, 0.16), PLATE_MAT);
    seam.position.set(0, 1.45, -2.49); dress.add(seam);
    // a small hardened roof cupola so it stands out in traffic from above
    const cupola = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.9), ARMOR_MAT);
    cupola.position.set(0, 2.45, -0.2); dress.add(cupola);
    // amber roof beacon (security escort look) — a tiny emissive box, blinked by
    // visibility toggle (no material churn)
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.34), BEACON_MAT);
    beacon.position.set(0, 2.78, -0.2); dress.add(beacon);
    dress.userData.beacon = beacon;
    grp.add(dress);
    grp.userData._armoredDress = dress;
    return dress;
  }

  // ---- spawn ----------------------------------------------------------------
  function spawnTruck() {
    if (truck || g.mode !== "city" || !CBZ.city || !CBZ.city.arena) return;
    if (!CBZ.cityMakeCar) return;
    const A = CBZ.city.arena, P = CBZ.player;
    if (!A.roads || !A.roads.length || !P) return;

    // pick a road segment whose chosen seat is far enough from the player
    let r = null, x = 0, z = 0, along = 0, dirSign = 1, lane = 0, heading = 0, tries = 0;
    do {
      r = A.roads[(rng() * A.roads.length) | 0];
      along = (rng() - 0.5) * r.len * 0.8;
      dirSign = rng() < 0.5 ? 1 : -1;
      const laneOff = ((CBZ.CITY && CBZ.CITY.traf && CBZ.CITY.traf.lane) != null) ? CBZ.CITY.traf.lane : 2.2;
      lane = dirSign * laneOff;
      x = r.vertical ? r.x + lane : r.x + along;
      z = r.vertical ? r.z + along : r.z + lane;
      heading = r.vertical ? (dirSign > 0 ? 0 : Math.PI) : (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2);
      tries++;
    } while (tries < 10 && Math.hypot(x - P.pos.x, z - P.pos.z) < TUNE.spawnFarFrom);

    const c = CBZ.cityMakeCar(x, z, heading, r.vertical, TRUCK_MODEL, 0.18);
    if (!c) return;
    // slot it into traffic exactly like spawnCityTraffic does so the AI drives it
    c.road = r; c.lane = lane; c.dirSign = dirSign;
    const cruise = (CBZ.CITY && CBZ.CITY.traf && CBZ.CITY.traf.cruise) || [7, 12];
    c.baseV = (cruise[0] + rng() * (cruise[1] - cruise[0])) * 0.85;   // a heavy truck cruises a touch slower
    c.v = c.baseV * 0.6;
    // armored-truck identity + a big armored-health pool that explosives chew
    c.armoredTruck = true;
    c.armoredHull = TUNE.hullHp;
    c.armoredCracked = false;
    c.armoredGuardsOut = false;
    c.armoredGuards = [];
    c.armoredAggroed = false;
    c.armor = 0.32;                          // its engineHp also resists (van-class), but the wrap is what makes it tank
    c.fullRoute = rng() < TUNE.fullRouteChance;
    c.armoredHaul = c.fullRoute
      ? Math.round(ri(TUNE.haulFullMin, TUNE.haulFullMax) / 1000) * 1000
      : Math.round(ri(TUNE.haulMin, TUNE.haulMax) / 1000) * 1000;
    if (c.fullRoute) c.armoredHull = Math.round(TUNE.hullHp * 1.25);   // fat trucks are even tougher

    try { dressTruck(c.group); } catch (e) { /* dressing is cosmetic — a failure must not lose the truck */ }

    truck = c;
  }

  // ---- guards: a crew bails out and fights when the truck is attacked/cracked --
  function deployGuards(reason) {
    if (!truck || truck.armoredGuardsOut || !CBZ.citySpawnCop) return;
    truck.armoredGuardsOut = true;
    const n = truck.fullRoute ? TUNE.guardsFull : TUNE.guardsBase;
    const a = truck.heading, sx = Math.sin(a), sz = Math.cos(a);
    for (let i = 0; i < n; i++) {
      // drop them around the truck (one at each rear door, the rest flanking)
      const off = i === 0 ? -2.6 : (i === 1 ? 2.4 : 0);
      const side = i >= 2 ? (i % 2 ? 1.8 : -1.8) : ((i % 2) ? 1.2 : -1.2);
      const gx = truck.pos.x + sx * off - sz * side;
      const gz = truck.pos.z + sz * off + sx * side;
      const guard = CBZ.citySpawnCop(gx, gz, false);   // armored-crew guard = a beat-cop rig
      if (guard) {
        guard.name = "Guard";
        guard.armoredGuard = true;
        guard.hp = Math.max(guard.hp || 0, 130);       // a touch hardier than a beat cop
        truck.armoredGuards.push(guard);
      }
    }
    // armed crew engaging IS a reported armed robbery in progress — light it up
    spikeHeat(reason);
    if (CBZ.city && CBZ.city.note) CBZ.city.note("🚨 Armored crew bailing out — they're shooting back!", 2.2);
  }

  // ---- the heat spike: armed robbery of an armored truck ----------------------
  function spikeHeat(reason) {
    if (g.mode !== "city" || !truck) return;
    const x = truck.pos.x, z = truck.pos.z;
    if (CBZ.cityCrime) CBZ.cityCrime(140, { instant: true, x: x, z: z, type: "armed-robbery" });
    // a hardened-target robbery is a major incident: shove the heat up hard
    // (forceStars caps at 4★ by design — a 5★ still requires an actual spree).
    if (CBZ.cityForceStars) CBZ.cityForceStars(truck.armoredCracked ? 4 : 3);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- CRACK: enough explosive damage blew the doors → spill the cash ---------
  function crackTruck() {
    if (!truck || truck.armoredCracked || g.mode !== "city") return;
    truck.armoredCracked = true;
    const x = truck.pos.x, z = truck.pos.z;
    // the truck is now a dead, smoking shell on the road — kill its engine through
    // the normal car chain so it stops + smokes + can burn out like any wreck.
    if (CBZ.cityDamageCar) CBZ.cityDamageCar(truck, 999, { byPlayer: true });
    deployGuards("crack");                       // any guards not already out pile out now (also spikes heat)
    spikeHeat("crack");                          // ensure a 4★ armed-robbery spike even if guards were already out
    spillCash(x, z, truck.armoredHaul);
    if (CBZ.sfx) CBZ.sfx("explosion");
    if (CBZ.city && CBZ.city.big) CBZ.city.big("💰 TRUCK CRACKED — $" + fmt(truck.armoredHaul) + " ON THE STREET");
    if (CBZ.city && CBZ.city.note) CBZ.city.note("Doors blown — grab the cash before the heat closes in.", 3);
  }

  function fmt(n) { return (n | 0).toLocaleString ? (n | 0).toLocaleString("en-US") : ("" + (n | 0)); }

  // ---- spilled cash: a few duffel/banknote piles the player walks over to grab -
  let CASH_GEO = null, DUFFEL_GEO = null, CASH_MAT = null, DUFFEL_MAT = null;
  const loot = [];   // { mesh, x, z, amount }
  function lootAssets() {
    if (CASH_GEO) return;
    CASH_GEO = new THREE.BoxGeometry(0.4, 0.16, 0.26);
    DUFFEL_GEO = new THREE.BoxGeometry(0.7, 0.32, 0.42);
    CASH_MAT = new THREE.MeshLambertMaterial({ color: 0x6fae5a });   // banded notes
    DUFFEL_MAT = new THREE.MeshLambertMaterial({ color: 0x2b2f36 }); // crew duffel
    CASH_GEO._shared = DUFFEL_GEO._shared = CASH_MAT._shared = DUFFEL_MAT._shared = true;
  }
  function spillCash(x, z, total) {
    lootAssets();
    const piles = 3 + (rng() * 2 | 0);          // 3–4 grabbable piles
    const per = Math.round(total / piles);
    let left = total;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    for (let i = 0; i < piles; i++) {
      const a = rng() * 6.2832, d = 0.8 + rng() * 2.4;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const fy = (CBZ.floorAt ? CBZ.floorAt(px, pz) : 0) || 0;
      const grp = new THREE.Group();
      const bag = new THREE.Mesh(DUFFEL_GEO, DUFFEL_MAT);
      bag.position.y = 0.18; grp.add(bag);
      // a couple of note bricks spilling out
      for (let k = 0; k < 3; k++) {
        const note = new THREE.Mesh(CASH_GEO, CASH_MAT);
        note.position.set((rng() - 0.5) * 0.5, 0.1 + k * 0.05, (rng() - 0.5) * 0.5);
        note.rotation.y = rng() * 6.28; grp.add(note);
      }
      grp.position.set(px, fy + 0.04, pz);
      grp.rotation.y = rng() * 6.28;
      if (root) root.add(grp);
      const amt = (i === piles - 1) ? left : per;
      left -= amt;
      loot.push({ mesh: grp, x: px, z: pz, amount: amt });
    }
  }
  function clearLoot() {
    for (const l of loot) {
      if (l.mesh && l.mesh.parent) l.mesh.parent.remove(l.mesh);
      if (l.mesh) l.mesh.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
        if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
      });
    }
    loot.length = 0;
  }
  function grabLoot() {
    if (!loot.length) return;
    const P = CBZ.player; if (!P || P.dead) return;
    for (let i = loot.length - 1; i >= 0; i--) {
      const l = loot[i];
      if (Math.hypot(l.x - P.pos.x, l.z - P.pos.z) > TUNE.lootRange) continue;
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(l.amount);
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(4);
      if (CBZ.sfx) CBZ.sfx("coin");
      if (CBZ.city && CBZ.city.note) CBZ.city.note("Grabbed $" + fmt(l.amount) + " from the truck haul.", 1.8);
      if (l.mesh && l.mesh.parent) l.mesh.parent.remove(l.mesh);
      loot.splice(i, 1);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      break;   // one grab per frame keeps the notes/feed readable
    }
  }

  // ---- teardown of a spent truck (cracked + looted, or driven off, or mode change) --
  function dropTruck() {
    if (truck) {
      // the wreck itself rejoins the normal car lifecycle (it was cityDamageCar'd
      // dead on crack); we just release our handle and dressing reference.
      truck.armoredTruck = false;   // stop the damage wrap from treating it special once spent
      truck = null;
    }
  }
  function fullReset() {
    dropTruck();
    clearLoot();
    nextSpawnT = TUNE.firstDelay;
  }

  // ============================================================
  // WRAP 1 — cityDamageCar: the armor. Bullets/rams barely scratch the truck;
  // explosives are handled separately (WRAP 2). Everything that ISN'T the live
  // armored truck passes straight through to the original, unchanged.
  // ============================================================
  function installDamageWrap() {
    const orig = CBZ.cityDamageCar;
    if (typeof orig !== "function" || orig._armoredWrapped) return;
    CBZ.cityDamageCar = function (car, amount, opts) {
      // The live, un-cracked armored truck tanks small-arms + rams. EXPLOSIVE
      // energy never arrives here as car-damage — it couples through WRAP 2
      // (cityExplosion → hitHull), so cracking only ever happens via a blast.
      if (car && car === truck && car.armoredTruck && !car.armoredCracked) {
        // a bullet or a ram on the hull: the crew notices and bails out.
        if (opts && opts.byPlayer && !car.armoredAggroed) {
          car.armoredAggroed = true;
          deployGuards("attack");
        }
        const ram = !opts || (!opts.point && !opts.crumple);   // crash path passes no point
        const scaled = amount * (ram ? TUNE.ramShrug : TUNE.bulletShrug);
        // still let the tire shot / impact decal play (cosmetic) on a tiny scale
        return orig.call(this, car, scaled, opts);
      }
      return orig.call(this, car, amount, opts);
    };
    CBZ.cityDamageCar._armoredWrapped = true;
    CBZ.cityDamageCar._origArmored = orig;
  }

  // feed explosive energy into the hull pool; crack when it runs out
  function hitHull(car, dmg, byPlayer) {
    if (!car || car.armoredCracked) return;
    if (byPlayer) car._burnByPlayer = true;
    car.armoredHull -= dmg;
    if (!car.armoredAggroed) { car.armoredAggroed = true; deployGuards("attack"); }
    if (car.armoredHull <= 0) crackTruck();
    else {
      // a non-lethal blast still rocks it + alerts the crew — tell the player it held
      if (CBZ.city && CBZ.city.note && byPlayer) {
        const pct = Math.max(0, Math.round(car.armoredHull / (car.fullRoute ? TUNE.hullHp * 1.25 : TUNE.hullHp) * 100));
        CBZ.city.note("Hull holding (" + pct + "%) — hit it with more explosives.", 1.6);
      }
    }
  }

  // ============================================================
  // WRAP 2 — cityExplosion: every RPG/grenade/C4/airstrike routes through here.
  // After the real blast runs, if the live armored truck is in radius, couple the
  // blast into its hull pool. This is THE crack path. Additive: we call the
  // original first and only ADD the hull coupling.
  // ============================================================
  function installExplosionWrap() {
    const orig = CBZ.cityExplosion;
    if (typeof orig !== "function" || orig._armoredWrapped) return;
    const wrapped = function (x, z, opts) {
      const r = orig.call(this, x, z, opts);
      try {
        const blastDamages = !opts || !opts.noDamage;   // a no-damage FX puff (heli ember) must not crack it
        if (g.mode === "city" && truck && truck.armoredTruck && !truck.armoredCracked && blastDamages) {
          const power = (opts && opts.power) || 1;
          const dx = truck.pos.x - x, dz = truck.pos.z - z;
          const d = Math.hypot(dx, dz);
          const arm = TUNE.crackArmRange * Math.max(1, power * 0.85);
          if (d <= arm) {
            const falloff = 1 - d / (arm + 0.01);
            const dmg = TUNE.blastToHull * power * Math.max(0.25, falloff);
            hitHull(truck, dmg, !!(opts && opts.byPlayer));
          }
        }
      } catch (e) { /* a coupling failure must never break the shared blast chain */ }
      return r;
    };
    wrapped._armoredWrapped = true;
    wrapped._structWrapped = orig._structWrapped;   // preserve buildings.js's flag if present
    wrapped._origArmored = orig;
    CBZ.cityExplosion = wrapped;
  }

  // (re)install both wraps — lazy, since vehicles.js/crashfx.js may load after us
  function ensureWraps() {
    installDamageWrap();
    installExplosionWrap();
  }

  // ---- per-frame manager ----------------------------------------------------
  CBZ.onUpdate(54.3, function (dt) {
    // fresh-run / hot-reload rewind detection (same trick explosives.js uses)
    const el = g.elapsed || 0;
    if (el + 0.001 < _lastElapsed) fullReset();
    _lastElapsed = el;

    ensureWraps();   // cheap idempotent re-check; survives load-order + hot reloads

    if (g.mode !== "city") {
      if (truck || loot.length) fullReset();
      return;
    }
    if (g.state !== "playing") return;

    // ---- spawn cadence: only when there's no truck and the timer's up --------
    if (!truck) {
      if (loot.length === 0) {            // don't roll a new truck while a haul's still on the ground
        nextSpawnT -= dt;
        if (nextSpawnT <= 0) {
          spawnTruck();
          nextSpawnT = ri(TUNE.spawnEvery[0], TUNE.spawnEvery[1]);
        }
      }
    } else {
      // ---- manage the live truck ----
      const t = truck;
      // it died/exploded through the car system (rammed off a cliff, burned out
      // before crack, reaped) → if it wasn't cracked, no haul; release the handle.
      if (t.dead || t._reap || CBZ.cityCars.indexOf(t) < 0) {
        if (!t.armoredCracked) dropTruck();
        else dropTruck();   // cracked wreck handled by car system; we just let go
      } else {
        // blink the beacon
        const dress = t.group && t.group.userData && t.group.userData._armoredDress;
        if (dress && dress.userData.beacon) {
          dress.userData.beacon.visible = (((g.elapsed || 0) * 2.2) % 1) < 0.55;
        }
        // Guards only spawn on attack/crack (deployGuards), so a normally-driving
        // truck strands no escort. Once they're out they're real cops and the
        // police AI fully owns them — we keep only a reference list for cleanup.
        // an untouched truck that has driven far away from the player is culled so
        // a missed score doesn't leave a stale handle forever.
        const P = CBZ.player;
        if (P && !t.armoredAggroed && !t.armoredCracked &&
            Math.hypot(t.pos.x - P.pos.x, t.pos.z - P.pos.z) > TUNE.despawnFar) {
          // remove it cleanly from the car system
          if (t.group && t.group.parent) t.group.parent.remove(t.group);
          const idx = CBZ.cityCars.indexOf(t); if (idx >= 0) CBZ.cityCars.splice(idx, 1);
          dropTruck();
        }
      }
    }

    // ---- loot pickup (auto-collect on proximity) -----------------------------
    if (loot.length) grabLoot();

    // ---- guard housekeeping: once the heat's fully gone, retire any guards we
    // spawned so they don't linger as orphan cops (police.js clears its own on
    // wanted-reset/teleport; this just prunes our reference list). --------------
    if ((g.heat || 0) <= 0 && !truck && loot.length === 0) {
      // nothing to do — guards were real cops; police.js maintain() retires them.
    }
  });

  // headless / debug / tool handles
  CBZ.cityArmored = {
    truck: function () { return truck; },
    spawn: spawnTruck,
    crack: crackTruck,
    haulOnGround: function () { let s = 0; for (const l of loot) s += l.amount; return s; },
    active: function () { return !!truck; },
    _tune: TUNE,
  };
})();
