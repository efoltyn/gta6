/* ============================================================
   entities/npclife.js — reusable NPC profiles, placement and attachment.

   A profile says WHO an actor is. A placement says WHERE they belong and
   what they are doing. City streets, authored scenes and moving aircraft all
   use the same real city-ped actor factory through this module; callers do not
   build decorative people or duplicate registration/cleanup code.

   Public API: CBZ.npcLife
     define(id, { actor, life })
     resolve(id, overrides?)
     apply(actor, id, overrides?, remember?)
     releaseProfile(actor)
     spawnCity(id, placement, overrides?)
     claimCity(id, placement, predicate?, overrides?)
     attach(actor, parent, anchor)
     detach(actor, opts?)
     release(actor, opts?)
     destroyCity(actor)
     definePopulation(id, { root, entries })
     removePopulation(id)
     populateAircraftCabins()

   Attachments retain a WORLD position on actor.pos for combat/interaction,
   while the actual character group stays parented in plane-local space. That
   makes passengers ordinary hittable actors which follow a taxiing/flying
   aircraft, not baked meshes painted into its model.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;

  const profiles = Object.create(null);
  const attached = [];
  const assignedCabins = [];
  const populations = Object.create(null);
  const populationIds = [];
  let populationCursor = 0;
  let cabinScanT = 0;
  let cabinEventOff = null;

  function copy(src) {
    const out = {};
    if (!src) return out;
    for (const k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    return out;
  }

  function merge(a, b) {
    const out = copy(a);
    if (b) for (const k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = b[k];
    return out;
  }

  function define(id, def) {
    if (!id || !def) return null;
    profiles[id] = {
      id: id,
      actor: copy(def.actor),
      life: copy(def.life),
    };
    return profiles[id];
  }

  function resolve(id, overrides) {
    const p = profiles[id] || profiles.cityResident || { id: id || "cityResident", actor: {}, life: {} };
    return { id: p.id, actor: merge(p.actor, overrides), life: copy(p.life) };
  }

  // Actor fields changed by a temporary profile are restored exactly. This is
  // used by the ambient scene director and aircraft cabin claims, so drafting a
  // real pedestrian never permanently turns that person into a role costume.
  function apply(actor, id, overrides, remember) {
    if (!actor) return null;
    const p = resolve(id, overrides);
    if (remember && !actor._npcLifeRestore) actor._npcLifeRestore = Object.create(null);
    for (const k in p.actor) {
      if (remember && !Object.prototype.hasOwnProperty.call(actor._npcLifeRestore, k)) {
        actor._npcLifeRestore[k] = actor[k];
      }
      actor[k] = p.actor[k];
    }
    actor._npcProfile = p.id;
    actor._npcLife = merge(actor._npcLife, p.life);
    if (actor._npcLife.initialState && !actor.dead) {
      if (remember && !Object.prototype.hasOwnProperty.call(actor._npcLifeRestore, "state")) actor._npcLifeRestore.state = actor.state;
      actor.state = actor._npcLife.initialState;
    }
    if (CBZ.syncActorWeapon && (p.actor.armed != null || p.actor.weapon != null)) CBZ.syncActorWeapon(actor);
    return actor;
  }

  function releaseProfile(actor) {
    if (!actor) return;
    const old = actor._npcLifeRestore;
    if (old) for (const k in old) actor[k] = old[k];
    actor._npcLifeRestore = null;
    actor._npcProfile = null;
    actor._npcLife = null;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(actor);
  }

  function cityRoot() {
    return (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene || null;
  }

  function registerCity(actor, parent) {
    if (!actor || !actor.group) return null;
    parent = parent || cityRoot();
    if (parent && actor.group.parent !== parent) parent.add(actor.group);
    const list = CBZ.cityPeds || (CBZ.cityPeds = []);
    if (list.indexOf(actor) < 0) list.push(actor);
    return actor;
  }

  function spawnCity(id, placement, overrides) {
    placement = placement || {};
    if (!CBZ.cityMakePed) return null;
    const p = resolve(id, overrides);
    const rng = placement.rng || Math.random;
    const x = placement.x == null ? 0 : placement.x;
    const z = placement.z == null ? 0 : placement.z;
    let actor = null;
    try { actor = CBZ.cityMakePed(x, z, rng, p.actor); }
    catch (_) { return null; }
    if (!actor) return null;
    // A caller that had to grow the roster (rather than temporarily claim an
    // existing citizen) can later tear down exactly that owned fallback.  Do
    // not infer ownership from `_npcProfile`: claimed citizens have profiles
    // too, and must be returned to their prior lives instead of despawned.
    actor._npcLifeSpawned = true;
    actor._npcProfile = p.id;
    actor._npcLife = copy(p.life);
    registerCity(actor, placement.parent);
    if (placement.anchor || placement.attached) {
      attach(actor, placement.parent, placement.anchor || placement);
    } else if (placement.yaw != null && actor.group) actor.group.rotation.y = placement.yaw;
    return actor;
  }

  function draftableCity(actor) {
    return !!(actor && actor.group && !actor.dead && !actor.isPlayer && !actor.vendor && !actor.gang &&
      actor.kind === "civilian" && !actor.controlled && !actor.companion && !actor.recruited &&
      !actor._crowd && !actor._parked && !actor._npcAttached && !actor._scene && !actor.inCar &&
      !(actor.ko > 0) && !actor.rage && !actor.surrender && !actor.reportState && !actor.approach &&
      !actor.isFamily && !actor.protectGang && !actor.hostage && !actor.kidnapped);
  }

  function claimCity(id, placement, predicate, overrides) {
    const list = CBZ.cityPeds || [];
    for (let i = 0; i < list.length; i++) {
      const actor = list[i];
      if (!draftableCity(actor) || (predicate && !predicate(actor))) continue;
      apply(actor, id, overrides, true);
      if (placement && (placement.anchor || placement.attached)) attach(actor, placement.parent, placement.anchor || placement);
      else if (placement) {
        if (actor.group.parent !== (placement.parent || cityRoot())) (placement.parent || cityRoot()).add(actor.group);
        actor.group.position.set(placement.x || 0, placement.y || 0, placement.z || 0);
        actor.pos = actor.group.position;
        if (placement.yaw != null) actor.group.rotation.y = placement.yaw;
      }
      return actor;
    }
    return null;
  }

  function removeAttached(actor) {
    const i = attached.indexOf(actor);
    if (i >= 0) attached.splice(i, 1);
  }

  function worldPose(group) {
    if (!group) return null;
    if (group.updateMatrixWorld) group.updateMatrixWorld(true);
    const THREE = window.THREE;
    if (!THREE) return null;
    const p = new THREE.Vector3();
    const q = THREE.Quaternion ? new THREE.Quaternion() : null;
    const s = new THREE.Vector3(1, 1, 1);
    if (group.matrixWorld && group.matrixWorld.decompose && q) group.matrixWorld.decompose(p, q, s);
    else if (group.getWorldPosition) group.getWorldPosition(p);
    else p.copy(group.position);
    return { p: p, q: q, s: s };
  }

  function attach(actor, parent, anchor) {
    if (!actor || !actor.group || !parent) return false;
    anchor = anchor || {};
    if (actor._npcAttached) detach(actor, { parent: cityRoot() });
    const group = actor.group;
    actor._npcAttached = {
      parent: parent,
      anchor: copy(anchor),
      oldParent: group.parent || cityRoot(),
      oldState: actor.state,
      oldParked: actor._parked,
      oldVisible: group.visible,
    };
    parent.add(group);
    group.position.set(anchor.x || 0, anchor.y || 0, anchor.z || 0);
    if (group.rotation && group.rotation.set) group.rotation.set(anchor.pitch || 0, anchor.yaw || 0, anchor.roll || 0);
    else if (group.rotation) group.rotation.y = anchor.yaw || 0;
    actor.pos = THREE ? new THREE.Vector3() : { x: 0, y: 0, z: 0 };
    actor.state = anchor.state || "sit";
    actor.speed = 0; actor.pause = Math.max(actor.pause || 0, 1);
    actor._parked = false;
    // The street render-LOD (peds.js) hides rigs beyond ~95m, and cabin
    // drafts deliberately claim FAR bodies (safeCabinDraft rejects anyone
    // the player could watch vanish) — so a claimed actor usually arrives
    // here with group.visible=false, and the peds tick used to skip
    // _npcAttached actors before its visibility recompute. That produced
    // live, hittable, talking but INVISIBLE passengers (r128 raycasts
    // ignore visible=false). An anchor is an authored, meant-to-be-seen
    // placement: force the rig visible. peds.js re-applies distance LOD
    // to attached rigs every frame after this.
    group.visible = true;
    if (actor.char) {
      actor.char.sitting = anchor.pose !== "stand";
      actor.char.handsUp = false;
    }
    if (attached.indexOf(actor) < 0) attached.push(actor);
    syncAttached(actor, 0);
    return true;
  }

  function detach(actor, opts) {
    if (!actor || !actor.group || !actor._npcAttached) return false;
    opts = opts || {};
    const rec = actor._npcAttached;
    const pose = worldPose(actor.group);
    const parent = opts.parent || rec.oldParent || cityRoot();
    if (parent) parent.add(actor.group);
    if (pose) {
      actor.group.position.copy(pose.p);
      if (pose.q && actor.group.quaternion && actor.group.quaternion.copy) actor.group.quaternion.copy(pose.q);
      if (pose.s && actor.group.scale && actor.group.scale.copy) actor.group.scale.copy(pose.s);
    }
    actor.pos = actor.group.position;
    actor._npcAttached = null;
    actor._parked = !!rec.oldParked;
    actor.group.visible = rec.oldVisible !== false;
    if (actor.char) actor.char.sitting = false;
    if (!actor.dead) {
      actor.state = opts.state || rec.oldState || "walk";
      actor.pause = Math.max(actor.pause || 0, 0.4);
      if (actor.target && actor.target.set) actor.target.set(actor.pos.x, 0, actor.pos.z);
    }
    removeAttached(actor);
    return true;
  }

  function release(actor, opts) {
    opts = opts || {};
    if (!actor) return;
    if (actor._npcAttached) detach(actor, opts);
    if (opts.restore !== false) releaseProfile(actor);
  }

  // Permanently remove an actor created by a modular placement.  This mirrors
  // clearCityPeds' cleanup contract but operates on one known-owned body, so a
  // short-lived taxi fare / destroyed aircraft cabin cannot slowly grow the
  // global roster.  Callers must never use this for a claimed citizen.
  function destroyCity(actor) {
    if (!actor) return false;
    removeAttached(actor);
    actor._npcAttached = null;
    if (actor._unit && CBZ.cityHomeRelease) {
      try { CBZ.cityHomeRelease(actor); } catch (_) {}
    }
    actor._unit = null; actor._digs = null; actor._home = null; actor._household = null;
    if (actor.group && actor.group.parent) actor.group.parent.remove(actor.group);
    if (actor.group && actor.group.traverse) actor.group.traverse(function (o) {
      if (o.isSprite) return;
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) {
        try { o.geometry.dispose(); } catch (_) {}
      }
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (_) {} }
        }
      }
    });
    const list = CBZ.cityPeds;
    if (list) {
      const i = list.indexOf(actor);
      if (i >= 0) list.splice(i, 1);
    }
    actor._npcLifeDestroyed = true;
    actor.culled = true;
    return true;
  }

  // Persistent authored casts. A population is data (profile + placement +
  // optional setup), not bespoke spawn code. Its actors are ordinary city
  // peds, filled incrementally and recreated after a city reset. Re-defining a
  // key replaces the old owned cast, which makes landmass rebuilds idempotent.
  function removePopulation(id) {
    const pop = populations[id];
    if (!pop) return false;
    for (let i = 0; i < pop.actors.length; i++) {
      const a = pop.actors[i];
      if (a && CBZ.cityPeds && CBZ.cityPeds.indexOf(a) >= 0) destroyCity(a);
    }
    delete populations[id];
    const k = populationIds.indexOf(id);
    if (k >= 0) populationIds.splice(k, 1);
    return true;
  }

  function definePopulation(id, def) {
    if (!id || !def || !def.root) return null;
    removePopulation(id);
    const entries = Array.isArray(def.entries) ? def.entries.slice() : [];
    const pop = populations[id] = {
      id: id, root: def.root, entries: entries, actors: new Array(entries.length), cursor: 0,
    };
    populationIds.push(id);
    fillPopulation(pop, Math.min(2, entries.length));
    return pop;
  }

  function fillPopulation(pop, budget) {
    if (!pop || !pop.root || !pop.root.parent || !budget) return 0;
    const roster = CBZ.cityPeds || [];
    let made = 0, scanned = 0, n = pop.entries.length;
    while (n && made < budget && scanned < n) {
      const i = pop.cursor++ % n; scanned++;
      const old = pop.actors[i];
      if (old && roster.indexOf(old) >= 0) continue;
      pop.actors[i] = null;
      const e = pop.entries[i] || {};
      const placement = merge(e.placement, { parent: (e.placement && e.placement.parent) || pop.root });
      const a = spawnCity(e.profile || "cityResident", placement, e.overrides);
      if (!a) continue;
      a._npcPopulation = pop.id;
      a._npcPopulationSlot = i;
      pop.actors[i] = a;
      if (typeof e.configure === "function") { try { e.configure(a, i); } catch (_) {} }
      made++;
    }
    return made;
  }

  function tickPopulations() {
    if (!populationIds.length || CBZ.citySpawnDraining) return;
    const liveRoot = cityRoot();
    let budget = 4, checked = 0;
    while (budget > 0 && checked < populationIds.length) {
      if (populationCursor >= populationIds.length) populationCursor = 0;
      const pop = populations[populationIds[populationCursor++]]; checked++;
      if (!pop || pop.root !== liveRoot || !pop.root.parent) continue;
      budget -= fillPopulation(pop, 1);
    }
  }

  function syncAttached(actor, dt) {
    const rec = actor && actor._npcAttached;
    if (!rec || !actor.group) return;
    if (actor.dead || !rec.parent || !rec.parent.parent) {
      detach(actor, { parent: cityRoot(), state: actor.dead ? "dead" : "walk" });
      if (!actor.dead) releaseProfile(actor);
      return;
    }
    if (actor.group.updateMatrixWorld) actor.group.updateMatrixWorld(true);
    if (actor.group.getWorldPosition) actor.group.getWorldPosition(actor.pos);
    else {
      const p = worldPose(actor.group);
      if (p) actor.pos.copy(p.p);
    }
    actor.speed = 0;
    actor.state = rec.anchor.state || "sit";
    if (actor.char) {
      actor.char.sitting = rec.anchor.pose !== "stand";
      if (CBZ.animChar && actor.group.visible) CBZ.animChar(actor.char, 0, dt || 0);
    }
  }

  function cabinList() {
    const reg = CBZ.aircraftPassengerCabins;
    if (!reg) return [];
    if (Array.isArray(reg)) return reg;
    if (Array.isArray(reg.cabins)) return reg.cabins;
    if (typeof reg.list === "function") { try { return reg.list() || []; } catch (_) { return []; } }
    return [];
  }

  function cabinGroup(c) {
    return c && (c.group || c.aircraft || (c.rec && c.rec.group) || (c.record && c.record.group));
  }

  function cabinSeats(c) {
    if (!c) return [];
    return c.passengerSeats || c.passengerAnchors || c.occupiedSeats || c.passengers || c.seats || c.anchors || [];
  }

  function cabinUsable(c) {
    return !!(c && c.state !== "destroyed" && c.active !== false && cabinGroup(c));
  }

  function cabinEntry(c) {
    for (let i = 0; i < assignedCabins.length; i++) if (assignedCabins[i].source === c) return assignedCabins[i];
    const e = { source: c, group: cabinGroup(c), occupants: [], nextSeat: 0 };
    assignedCabins.push(e);
    return e;
  }

  function normalizeSeat(raw, i) {
    raw = raw || {};
    const p = raw.position || raw.local || raw;
    return {
      x: p.x || 0,
      y: p.y == null ? (raw.floorTop == null ? 0 : raw.floorTop) : p.y,
      z: p.z || 0,
      yaw: raw.yaw == null ? (raw.heading == null ? Math.PI / 2 : raw.heading) : raw.yaw,
      pitch: raw.pitch || 0,
      roll: raw.roll || 0,
      pose: raw.pose || "sit",
      state: raw.state || "sit",
      role: raw.role || (i < 2 && raw.cockpit ? "pilot" : "passenger"),
      source: raw,
    };
  }

  function safeCabinDraft(p) {
    const P = CBZ.player;
    if (!P || !P.pos) return true;          // initial build: nobody can see the roster yet
    const dx = p.pos.x - P.pos.x, dz = p.pos.z - P.pos.z, d2 = dx * dx + dz * dz;
    if (d2 < 90 * 90) return false;         // never make a nearby street body disappear
    // Inside the broader band, also reject anything in the camera's forward
    // cone. Far/behind bodies are safe to recast; otherwise build a fresh real
    // actor through the same city factory instead of visibly teleporting one.
    if (d2 < 170 * 170) {
      const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
      const d = Math.sqrt(d2) || 1;
      const dot = (dx / d) * -Math.sin(yaw) + (dz / d) * -Math.cos(yaw);
      if (dot >= 0.25) return false;
    }
    return true;
  }

  function fillCabinOne(e) {
    const seats = cabinSeats(e.source);
    if (!cabinUsable(e.source) || !e.group || !e.group.parent) return false;
    // A player or another system may already own a seat. Advance over it;
    // never replace its occupant or construct a second body at the anchor.
    while (e.nextSeat < seats.length && seats[e.nextSeat] && seats[e.nextSeat].occupant) e.nextSeat++;
    if (e.nextSeat >= seats.length) return false;
    const seat = normalizeSeat(seats[e.nextSeat], e.nextSeat);
    const profile = seat.role === "pilot" ? "aircraftPilot" : "aircraftPassenger";
    // Reassign a normal existing pedestrian first. A tiny fresh fallback keeps
    // authored cabins complete when low quality reduces the street roster.
    let actor = claimCity(profile, { parent: e.group, anchor: seat }, function (p) {
      return safeCabinDraft(p) && (p.archetype === "tourist" || p.job === "traveller" || p.job === "between jobs" || p.archetype === "resident");
    });
    let spawned = false;
    if (!actor) {
      actor = spawnCity(profile, { parent: e.group, anchor: seat, rng: Math.random });
      spawned = !!actor;
    }
    if (!actor) return false;
    actor._aircraftCabin = e;
    actor._aircraftCabinSpawned = spawned;
    actor._aircraftSeat = e.nextSeat;
    if (seat.source) seat.source.occupant = actor;
    e.occupants.push(actor);
    e.nextSeat++;
    return true;
  }

  function pruneCabins(live) {
    for (let i = assignedCabins.length - 1; i >= 0; i--) {
      const e = assignedCabins[i];
      if (live.indexOf(e.source) >= 0 && cabinUsable(e.source) && e.group && e.group.parent) continue;
      for (let j = 0; j < e.occupants.length; j++) {
        const a = e.occupants[j];
        if (a) {
          const seats = cabinSeats(e.source);
          for (let k = 0; k < seats.length; k++) if (seats[k] && seats[k].occupant === a) seats[k].occupant = null;
          const spawned = !!a._aircraftCabinSpawned;
          a._aircraftCabin = null; a._aircraftSeat = -1; a._aircraftCabinSpawned = false;
          if (spawned) destroyCity(a);
          else release(a);
        }
      }
      assignedCabins.splice(i, 1);
    }
  }

  // Incremental: at most two character claims/rig builds in one frame. Cabins
  // still end up fully populated, without a one-frame airport construction hitch.
  function populateAircraftCabins() {
    const live = cabinList();
    pruneCabins(live);
    if (!live.length || CBZ.citySpawnDraining) return 0;
    let made = 0;
    for (let i = 0; i < live.length && made < 2; i++) {
      if (!cabinUsable(live[i])) continue;
      const e = cabinEntry(live[i]);
      if (fillCabinOne(e)) made++;
    }
    return made;
  }

  function resetCity() {
    for (let i = 0; i < assignedCabins.length; i++) {
      const e = assignedCabins[i];
      const seats = cabinSeats(e.source);
      for (let j = 0; j < seats.length; j++) if (seats[j]) seats[j].occupant = null;
      // resetCity normally runs immediately before clearCityPeds, but it is
      // also a public lifecycle boundary. Tear down only cabin-owned fallback
      // bodies now; claimed citizens are restored/detached. This keeps a direct
      // reset from leaking actors and keeps clearCityPeds from double-disposing
      // them because destroyCity removes each from the roster first.
      for (let j = 0; j < e.occupants.length; j++) {
        const a = e.occupants[j];
        if (!a) continue;
        const spawned = !!a._aircraftCabinSpawned;
        a._aircraftCabin = null; a._aircraftSeat = -1; a._aircraftCabinSpawned = false;
        if (spawned) destroyCity(a);
        else release(a);
      }
    }
    for (let i = attached.length - 1; i >= 0; i--) {
      const a = attached[i];
      if (a) { a._npcAttached = null; a._aircraftCabin = null; }
    }
    attached.length = 0;
    assignedCabins.length = 0;
    // Authored population definitions survive a mode reset, their owned bodies
    // do not. The normal updater refills these same slots incrementally into the
    // still-live city root after clearCityPeds completes.
    for (let i = 0; i < populationIds.length; i++) {
      const pop = populations[populationIds[i]];
      if (!pop) continue;
      for (let j = 0; j < pop.actors.length; j++) {
        const a = pop.actors[j];
        if (a && CBZ.cityPeds && CBZ.cityPeds.indexOf(a) >= 0) destroyCity(a);
        pop.actors[j] = null;
      }
      pop.cursor = 0;
    }
  }

  // Canonical reusable casting profiles. They intentionally contain no scene
  // scripting: directors assign targets/actions, while profiles only define a
  // consistent identity, equipment and baseline temperament.
  define("cityResident", { actor: { kind: "civilian", archetype: "resident" }, life: { initialState: "walk" } });
  define("terminalTraveller", { actor: { kind: "civilian", archetype: "tourist", job: "traveller", aggr: 0.08, armed: false, weapon: null }, life: { initialState: "walk", venue: "airport" } });
  define("venueSpectator", { actor: { kind: "civilian", archetype: "fan", job: "spectator", aggr: 0.12, armed: false, weapon: null }, life: { initialState: "sit", stationary: true, venue: true } });
  define("venueWorker", { actor: { kind: "worker", archetype: "laborer", job: "venue worker", aggr: 0.16, armed: false, weapon: null }, life: { initialState: "walk", workPost: true, venue: true } });
  define("cabPassenger", { actor: { kind: "civilian", archetype: "resident", job: "passenger", aggr: 0.08, armed: false, weapon: null }, life: { initialState: "sit", stationary: true, ride: "cab" } });
  define("aircraftPassenger", { actor: { kind: "civilian", archetype: "tourist", job: "traveller", aggr: 0.08, armed: false, weapon: null }, life: { initialState: "sit", stationary: true } });
  define("aircraftPilot", { actor: { kind: "worker", archetype: "worker", job: "pilot", aggr: 0.16, armed: false, weapon: null }, life: { initialState: "sit", stationary: true } });
  define("groundCrew", { actor: { kind: "worker", archetype: "laborer", job: "ground crew", aggr: 0.15, armed: false }, life: { initialState: "walk", workPost: true } });
  define("militarySoldier", { actor: { kind: "civilian", archetype: "soldier", job: "soldier", aggr: 0.45, armed: true, weapon: "AK-47", hp: 140 }, life: { initialState: "walk", patrol: true } });
  define("militaryDrill", { actor: { kind: "civilian", archetype: "soldier", job: "soldier", aggr: 0.35, armed: true, weapon: "AK-47", hp: 140 }, life: { initialState: "idle", stationary: true, drill: true } });
  define("homelessScare", { actor: { kind: "civilian", archetype: "vagrant", job: "panhandling", vagrant: true, aggr: 0.8, armed: false }, life: { initialState: "idle", holdMin: 4, holdMax: 12 } });
  define("hostileAttacker", { actor: { kind: "civilian", archetype: "thug", job: "criminal", aggr: 0.9, armed: true, weapon: "Pistol", ammo: 30 }, life: { initialState: "walk", incident: "attack" } });
  define("terrorAttacker", { actor: { kind: "civilian", archetype: "thug", job: "terror attacker", aggr: 0.98, armed: true, weapon: "AK-47", ammo: 90 }, life: { initialState: "walk", incident: "terror" } });
  define("hitman", { actor: { kind: "civilian", archetype: "hitman", job: "contract killer", aggr: 0.94, armed: true, weapon: "Pistol", ammo: 45 }, life: { initialState: "walk", incident: "hit" } });
  define("jailInmate", { actor: { kind: "inmate", role: "inmate" }, life: { initialState: "idle", routine: true } });

  const api = CBZ.npcLife = {
    profiles: profiles,
    define: define,
    resolve: resolve,
    apply: apply,
    releaseProfile: releaseProfile,
    registerCity: registerCity,
    spawnCity: spawnCity,
    claimCity: claimCity,
    draftableCity: draftableCity,
    attach: attach,
    detach: detach,
    release: release,
    destroyCity: destroyCity,
    definePopulation: definePopulation,
    removePopulation: removePopulation,
    syncAttached: syncAttached,
    populateAircraftCabins: populateAircraftCabins,
    resetCity: resetCity,
    stats: function () {
      let seats = 0;
      for (let i = 0; i < assignedCabins.length; i++) seats += assignedCabins[i].occupants.length;
      let populationActors = 0;
      for (let i = 0; i < populationIds.length; i++) {
        const pop = populations[populationIds[i]];
        if (pop) for (let j = 0; j < pop.actors.length; j++) if (pop.actors[j] && CBZ.cityPeds && CBZ.cityPeds.indexOf(pop.actors[j]) >= 0) populationActors++;
      }
      return { profiles: Object.keys(profiles).length, attached: attached.length, cabins: assignedCabins.length,
        aircraftOccupants: seats, populations: populationIds.length, populationActors: populationActors };
    },
  };

  if (CBZ.onUpdate) CBZ.onUpdate(33.8, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    // The airport module parses later than this shared layer. Bind lazily and
    // retain polling as a recovery path for registries that existed before
    // the subscription was available.
    if (!cabinEventOff && typeof CBZ.onAircraftPassengerCabinState === "function") {
      try {
        const off = CBZ.onAircraftPassengerCabinState(function () { cabinScanT = 0; });
        cabinEventOff = typeof off === "function" ? off : true;
      } catch (_) { cabinEventOff = null; }
    }
    for (let i = attached.length - 1; i >= 0; i--) syncAttached(attached[i], dt);
    cabinScanT -= dt;
    if (cabinScanT <= 0) {
      cabinScanT = 0.08;                 // incremental fill; no full-registry scan every frame
      populateAircraftCabins();
    }
    tickPopulations();
  });
})();
