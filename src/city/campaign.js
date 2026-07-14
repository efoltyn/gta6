/* ============================================================
   city/campaign.js — THE CONTRACT: canonical hitman campaign.

   The huge city remains a set, not the point of the game. This director owns
   exactly one assignment at all times and casts only the people/props needed
   for the current observed scene. Durable state is plain data; live actors,
   markers and set dressing stay in the private runtime and are rebuilt from a
   checkpoint after a city/prison transition.

   Story spine:
     helicopter drop -> unavoidable rooftop arrest -> prison/warden choice ->
     two studio hits -> family hostage rescue -> airport comply/refuse reveal ->
     the Director -> an endless generated contract line.
============================================================ */
(function () {
  "use strict";

  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // ONE canonical campaign flag: CBZ.CONFIG.CITY_HITMAN_CAMPAIGN. Older embeds
  // and saves toggled it in four legacy locations; migrate the first defined one
  // exactly once, then every reader goes through CBZ.cityCampaignEnabled().
  if (CFG.CITY_HITMAN_CAMPAIGN == null) {
    const legacyFlags = [CBZ.CITY_HITMAN_CAMPAIGN, window.CITY_HITMAN_CAMPAIGN, g.CITY_HITMAN_CAMPAIGN, g.cityHitmanCampaign];
    for (let i = 0; i < legacyFlags.length; i++) {
      if (legacyFlags[i] != null) { CFG.CITY_HITMAN_CAMPAIGN = !!legacyFlags[i]; break; }
    }
  }
  // config.js defaults to sandbox for rapid world testing. Preserve that when
  // this director is embedded without the normal config load; an explicit true
  // still enables the complete story.
  if (CFG.CITY_HITMAN_CAMPAIGN == null) CFG.CITY_HITMAN_CAMPAIGN = false;
  // Endless-line archetypes (sniper/disguise/vehicle/high-value contracts).
  if (CFG.CAMPAIGN_CONTRACT_VARIETY == null) CFG.CAMPAIGN_CONTRACT_VARIETY = true;
  // Ambient scenedirector set-pieces during ENDLESS free time (scripted phases
  // always suppress them — see CBZ.cityCampaignScenesBlocked below).
  if (CFG.CAMPAIGN_AMBIENT_SCENES == null) CFG.CAMPAIGN_AMBIENT_SCENES = true;

  const VERSION = 1;
  const PHASE = {
    DROP: "prologue_drop",
    PRISON: "prison_arrival",
    PRISON_ESCAPE: "prison_escape",
    PRISON_SPY_EXIT: "prison_spy_exit",
    SPY_INSERTION: "spy_airport_insertion",
    SPY_INTEL: "spy_airport_intel",
    STUDIO_ONE: "studio_one",
    STUDIO_TWO: "studio_two",
    FAMILY: "family_hostage",
    AIRPORT: "airport_arrival",
    AIRPORT_CHOICE: "airport_choice",
    AIRPORT_COMPLY: "airport_comply",
    AIRPORT_REFUSE: "airport_refuse",
    RECKONING: "reckoning",
    ENDLESS: "endless_contracts",
  };

  const R = {
    key: "",
    kind: "",
    t: 0,
    dialogueT: 0,
    transitionT: 0,
    target: null,
    actors: [],
    props: [],
    marker: null,
    markerTarget: null,
    markerPoint: null,
    helicopter: null,
    pad: null,
    swat: [],
    victims: [],
    captors: [],
    hostage: null,
    familyRecord: null,
    intelPoint: null,
    required: 0,
    lastProgress: -1,
    transportReleased: false,
    contract: null,
  };

  function active() { return CFG.CITY_HITMAN_CAMPAIGN !== false; }
  CBZ.cityCampaignActive = active;
  CBZ.cityCampaignEnabled = active;   // canonical flag read (campaign_ui + siblings delegate here)
  CBZ.cityCampaignOwnsMission = function () { return active(); };

  function freshState() {
    return {
      version: VERSION,
      chapter: 0,
      phase: PHASE.DROP,
      branch: null,
      contractNo: 0,
      flags: {
        dropped: false,
        arrested: false,
        wardenSpoke: false,
        spyInserted: false,
        spyIntel: false,
        studioOneLot: null,
        studioTwoLot: null,
        familyName: null,
        familySaved: false,
        familyLost: false,
        airportChoice: null,
        directorDead: false,
      },
      history: [],
    };
  }

  function plainCopy(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
  }

  function normalizeState(raw) {
    const base = freshState();
    if (!raw || raw.version !== VERSION) return base;
    base.chapter = raw.chapter | 0;
    base.phase = typeof raw.phase === "string" ? raw.phase : base.phase;
    base.branch = raw.branch === "spy" || raw.branch === "rogue" ? raw.branch : null;
    base.contractNo = Math.max(0, raw.contractNo | 0);
    base.flags = Object.assign(base.flags, raw.flags || {});
    base.history = Array.isArray(raw.history) ? raw.history.slice(-24) : [];
    // The phase is the durable evidence of the prison decision. Repair saves
    // made before the choice lock existed instead of allowing the opposite
    // branch to be selected after a reload.
    if (base.phase === PHASE.PRISON_ESCAPE) base.branch = "rogue";
    if (base.phase === PHASE.PRISON_SPY_EXIT || base.phase === PHASE.SPY_INSERTION || base.phase === PHASE.SPY_INTEL) base.branch = "spy";
    return base;
  }

  function state() {
    if (!g.cityCampaign || g.cityCampaign.version !== VERSION) {
      g.cityCampaign = normalizeState(g.cityCampaignPending);
      g.cityCampaignPending = null;
    }
    return g.cityCampaign;
  }

  CBZ.cityCampaignSnapshot = function () { return plainCopy(state()); };
  CBZ.cityCampaignRestore = function (data) {
    g.cityCampaign = normalizeState(data);
    g.cityCampaignPending = null;
    R.key = "";
    return g.cityCampaign;
  };
  CBZ.cityCampaignReset = function () {
    cleanupRuntime();
    g.cityCampaign = freshState();
    g.cityCampaignPending = null;
    R.key = "";
    commit();
    if (g.mode === "city" && g.state === "playing") activatePhase(true);
    return g.cityCampaign;
  };

  function commit() {
    if (CBZ.cityWorldCommit) {
      try { CBZ.cityWorldCommit(); } catch (e) {}
    }
  }

  function UI() { return CBZ.campaignUI || null; }
  function setMission(def) {
    const ui = UI();
    if (ui && ui.setMission) ui.setMission(def);
  }
  function notify(channel, from, body, meta) {
    const ui = UI();
    if (ui && ui.notify) ui.notify(channel, from, body, meta);
  }
  function clearDialogue() {
    const ui = UI();
    if (ui && ui.clearDialogue) ui.clearDialogue();
    R.dialogueT = 0;
  }
  function say(speaker, body, secs, actor) {
    const ui = UI();
    if (ui && ui.say) ui.say(speaker, body, { actor: actor || null });
    R.dialogueT = secs || 3.2;
    if (actor && CBZ.citySay) {
      try { CBZ.citySay(actor, body, "#dfe7ff", secs || 3.2); } catch (e) {}
    }
  }

  function floorY(x, z) {
    try { return CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0; } catch (e) { return 0; }
  }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function player() { return CBZ.player; }
  function distTo(x, z) {
    const P = player();
    return P && P.pos ? Math.hypot(P.pos.x - x, P.pos.z - z) : Infinity;
  }

  function seeded(salt) {
    let seed = 0x51f15e ^ (salt | 0) ^ ((CBZ.WORLD_SEED || 0) | 0);
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function disposeProp(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    obj.traverse(function (node) {
      if (node.geometry && !node.geometry._shared && node.geometry.dispose) {
        try { node.geometry.dispose(); } catch (e) {}
      }
      const m = node.material;
      if (m && !m._shared && m.dispose) {
        try { m.dispose(); } catch (e) {}
      }
    });
  }

  function releaseActor(actor) {
    if (!actor) return;
    actor._campaignTarget = false;
    actor._campaignCaptive = false;
    actor._campaignRole = null;
    actor._campaignAnchor = null;
    actor._campaignHostile = false;
    actor._campaignHold = false;
    if (actor.char) actor.char.handsUp = false;
    if (actor.dead) return;
    actor.pause = 0.2;
    actor.state = "walk";
    actor.rage = null;
    actor.fear = 0;
    actor.surrender = false;
  }

  function cleanupRuntime() {
    const hidPlayerForTransport = R.kind === "prologue" || R.kind === "spy_insertion";
    const P = player();
    clearDialogue();
    if (R.contract && R.contract.car) unseatContractCar(false);   // never leak an invisible driver
    R.contract = null;
    if (R.marker) disposeProp(R.marker);
    R.marker = null; R.markerTarget = null; R.markerPoint = null;
    for (let i = 0; i < R.props.length; i++) disposeProp(R.props[i]);
    R.props.length = 0;
    for (let i = 0; i < R.actors.length; i++) releaseActor(R.actors[i]);
    R.actors.length = 0;
    R.target = null; R.helicopter = null; R.pad = null;
    R.swat.length = 0; R.victims.length = 0; R.captors.length = 0;
    R.hostage = null; R.familyRecord = null; R.intelPoint = null;
    R.required = 0; R.lastProgress = -1; R.transportReleased = false;
    R.t = 0; R.transitionT = 0; R.dialogueT = 0; R.kind = "";
    if (hidPlayerForTransport && CBZ.playerChar && CBZ.playerChar.group && P) {
      CBZ.playerChar.group.visible = !P.dead;
    }
  }

  function addProp(obj) {
    const A = arena();
    if (!obj || !A || !A.root) return obj;
    obj.userData.transient = true;
    A.root.add(obj);
    R.props.push(obj);
    return obj;
  }

  function box(group, x, y, z, w, h, d, color) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: color })
    );
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  function makeHelicopter() {
    // Use the most detailed in-game light-helicopter art pass: tapered pod and
    // boom, bubble canopy, cowl/exhaust, real skids, four-blade main rotor,
    // tail rotor, livery, and navigation lights. It is the same asset players
    // can see in the vehicle catalog, not a prologue-only approximation.
    if (CBZ.debugBuildPlayerVehicle && CBZ.debugBuildPlayerVehicle.helicopter) {
      try {
        const inner = CBZ.debugBuildPlayerVehicle.helicopter();
        if (inner) {
          const group = new THREE.Group();
          group.add(inner);
          group.userData.rotor = inner.userData.mainRotor || inner.getObjectByName("heli_mainRotor");
          group.userData.trotor = inner.userData.tailRotor || inner.getObjectByName("heli_tailRotor");
          return group;
        }
      } catch (e) {}
    }
    // First fallback is the flyable personal-chopper asset.
    if (CBZ.debugBuildPlayerAir && CBZ.debugBuildPlayerAir.chopper) {
      try {
        const inner = CBZ.debugBuildPlayerAir.chopper();
        if (inner) {
          const group = new THREE.Group();
          inner.position.y = 1.05;                 // skid bottoms → outer origin
          group.add(inner);
          group.userData.rotor = inner.userData.rotor;
          group.userData.trotor = inner.userData.trotor;
          return group;
        }
      } catch (e) {}
    }
    // fallback: the legacy box stand-in (only if playerair.js failed to load)
    const group = new THREE.Group();
    box(group, 0, 1.25, 0.6, 3.2, 2.0, 5.2, 0x202a34);
    box(group, 0, 1.45, -3.2, 0.75, 0.75, 4.0, 0x26313b);
    box(group, 0, 2.2, -5.0, 0.22, 2.8, 1.2, 0x1b222a);
    box(group, -1.25, 0.15, 0.5, 0.16, 0.16, 5.0, 0x111820);
    box(group, 1.25, 0.15, 0.5, 0.16, 0.16, 5.0, 0x111820);
    const mast = box(group, 0, 2.55, 0, 0.22, 0.7, 0.22, 0x77818b);
    const rotor = new THREE.Group();
    rotor.position.set(0, 2.9, 0);
    box(rotor, 0, 0, 0, 10.5, 0.06, 0.32, 0x0c1116);
    box(rotor, 0, 0.02, 0, 0.32, 0.06, 10.5, 0x0c1116);
    group.add(rotor);
    group.userData.rotor = rotor;
    group.userData.mast = mast;
    return group;
  }

  function helipad() {
    let p = null;
    if (CBZ.cityHelipad) {
      try { p = CBZ.cityHelipad(); } catch (e) { p = null; }
    }
    if (p) return { x: p.x, y: p.y || 0, z: p.z, r: p.r || 7 };
    const A = arena(), lots = A && A.lots;
    let best = null;
    if (lots) {
      lots.forEach(function (lot) {
        const b = lot && lot.building;
        if (!b) return;
        const y = b.h || (b.storeys || 1) * 4;
        if (!best || y > best.y) best = {
          x: b.roofCx != null ? b.roofCx : lot.cx,
          y: y + 0.05,
          z: b.roofCz != null ? b.roofCz : lot.cz,
          r: 7,
        };
      });
    }
    if (best) return best;
    const c = A && A.center ? A.center : { x: 0, z: -700 };
    return { x: c.x, y: 2, z: c.z, r: 7 };
  }

  function makeMarker(target, point, color) {
    if (R.marker) disposeProp(R.marker);
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.75, 28),
      new THREE.MeshBasicMaterial({ color: color || 0xffc766, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34, 0),
      new THREE.MeshBasicMaterial({ color: color || 0xffc766, transparent: true, opacity: 0.9, depthWrite: false })
    );
    diamond.position.y = 2.8;
    group.add(diamond);
    const A = arena();
    if (A && A.root) {
      group.userData.transient = true;
      A.root.add(group);
    }
    R.marker = group; R.markerTarget = target || null; R.markerPoint = point || null;
    updateMarker();
    return group;
  }

  function updateMarker() {
    if (!R.marker) return;
    let x = 0, y = 0, z = 0;
    if (R.markerTarget && R.markerTarget.pos) {
      x = R.markerTarget.pos.x; y = R.markerTarget.pos.y || floorY(x, R.markerTarget.pos.z); z = R.markerTarget.pos.z;
    } else if (R.markerPoint) {
      x = R.markerPoint.x; z = R.markerPoint.z; y = R.markerPoint.y != null ? R.markerPoint.y : floorY(x, z);
    }
    R.marker.position.set(x, y + 0.08, z);
    R.marker.rotation.y += 0.018;
    const s = 1 + Math.sin((CBZ.now || 0) * 0.004) * 0.08;
    R.marker.scale.set(s, s, s);
  }

  function lotKey(lot) {
    if (!lot) return null;
    return String(Math.round((lot.cx || 0) * 10) / 10) + ":" + String(Math.round((lot.cz || 0) * 10) / 10);
  }

  function chooseLot(salt, minDistance, excluded) {
    const A = arena();
    if (!A || !A.lots || !A.lots.length) return null;
    excluded = excluded || [];
    const P = player();
    const px = P && P.pos ? P.pos.x : A.center.x;
    const pz = P && P.pos ? P.pos.z : A.center.z;
    const good = A.lots.filter(function (lot) {
      return lot && lot.building && lot.building.door && lot.kind !== "park" &&
        excluded.indexOf(lotKey(lot)) < 0 &&
        Math.hypot(lot.cx - px, lot.cz - pz) >= (minDistance || 55);
    });
    const pool = good.length ? good : A.lots.filter(function (lot) {
      return lot && lot.building && lot.building.door && excluded.indexOf(lotKey(lot)) < 0;
    });
    if (!pool.length) return null;
    pool.sort(function (a, b) {
      return Math.hypot(b.cx - px, b.cz - pz) - Math.hypot(a.cx - px, a.cz - pz);
    });
    const r = seeded(salt)();
    return pool[Math.min(pool.length - 1, (r * Math.min(6, pool.length)) | 0)];
  }

  function studioLot(which) {
    const c = state();
    const field = which === 1 ? "studioOneLot" : "studioTwoLot";
    const saved = c.flags[field];
    const A = arena();
    if (saved && (which === 1 || saved !== c.flags.studioOneLot) && A && A.lots) {
      for (let i = 0; i < A.lots.length; i++) {
        if (lotKey(A.lots[i]) === saved) return A.lots[i];
      }
    }
    const excluded = which === 2 && c.flags.studioOneLot ? [c.flags.studioOneLot] : [];
    const lot = chooseLot(which === 1 ? 101 : 202, 65, excluded);
    if (lot) {
      c.flags[field] = lotKey(lot);
      commit();
    }
    return lot;
  }

  function lotAnchor(lot) {
    const A = arena();
    if (!lot || !lot.building || !lot.building.door) {
      const c = A && A.center ? A.center : { x: 0, z: -700 };
      return { x: c.x, z: c.z };
    }
    const d = lot.building.door;
    return { x: d.x + (d.nx || 0) * 3.4, z: d.z + (d.nz || 0) * 3.4 };
  }

  function castExisting(name, anchor, opts) {
    opts = opts || {};
    const peds = CBZ.cityPeds || [];
    let pick = null, best = -1;
    const P = player();
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      // Only recast a stable, live street actor. The crowd promotion pool keeps
      // parked peds in cityPeds at an off-map coordinate, and regionlife owns a
      // separate streaming/despawn ring. Recasting either produces a hidden or
      // subsequently disposed mission target that can never be killed, stranding
      // every later phase that waits on target.dead.
      if (!p || !p.pos || !p.group || !p.group.parent || p.dead || p.culled || p.ko > 0 ||
          p.vendor || p.isFamily || p._campaignTarget || p._campaignCaptive ||
          p.companion || p.recruited || p.controlled || p.inCar || p.enterT > 0 ||
          p._parked || p._crowd || p._regionLife) continue;
      const d = P && P.pos ? Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z) : 0;
      if (d > best) { best = d; pick = p; }
    }
    if (!pick) return spawnPed(name, anchor.x, anchor.z, opts);
    pick.name = name || pick.name;
    pick.pos.set(anchor.x, floorY(anchor.x, anchor.z), anchor.z);
    if (pick.group) pick.group.position.copy(pick.pos);
    pick.group.visible = true;
    if (pick.target && pick.target.set) pick.target.set(anchor.x, 0, anchor.z);
    pick.pause = 2; pick.state = "idle"; pick.path = null; pick.finalGoal = null;
    pick._campaignTarget = !!opts.target;
    pick._campaignRole = opts.role || "mark";
    pick._campaignAnchor = { x: anchor.x, z: anchor.z };
    pick._campaignHostile = !!opts.hostile;
    if (opts.armed != null) pick.armed = !!opts.armed;
    if (opts.weapon) pick.weapon = opts.weapon;
    if (opts.aggr != null) pick.aggr = opts.aggr;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(pick);
    R.actors.push(pick);
    return pick;
  }

  function spawnPed(name, x, z, opts) {
    opts = opts || {};
    const A = arena();
    if (!A || !A.root || !CBZ.cityMakePed) return null;
    const rng = seeded((opts.salt || 1) + ((x * 17 + z * 31) | 0));
    let ped = null;
    try {
      ped = CBZ.cityMakePed(x, z, rng, {
        name: name,
        armed: !!opts.armed,
        weapon: opts.weapon || (opts.armed ? "Pistol" : null),
        aggr: opts.aggr != null ? opts.aggr : 0.2,
        archetype: opts.archetype || (opts.armed ? "professional" : "resident"),
        job: opts.job || opts.role || "campaign",
        wealth: opts.wealth != null ? opts.wealth : 0.55,
        isFamily: !!opts.family,
      });
    } catch (e) { ped = null; }
    if (!ped) return null;
    A.root.add(ped.group);
    (CBZ.cityPeds || (CBZ.cityPeds = [])).push(ped);
    ped._campaignSpawned = true;
    ped._campaignTarget = !!opts.target;
    ped._campaignCaptive = !!opts.captive;
    ped._campaignRole = opts.role || "campaign";
    ped._campaignAnchor = { x: x, z: z };
    ped._campaignHostile = !!opts.hostile;
    ped.pause = opts.captive ? 999 : 1.5;
    ped.state = "idle";
    if (opts.captive && ped.char) ped.char.handsUp = true;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    R.actors.push(ped);
    return ped;
  }

  // Promote an actor already owned by another city system into the current
  // observed scene without replacing their identity. Family kidnaps use this
  // path so the hostage on the phone is the same person who lives at home.
  function adoptActor(ped, anchor, opts) {
    opts = opts || {};
    const A = arena();
    if (!ped || !ped.pos || !ped.group || !A || !A.root) return null;
    ped.pos.set(anchor.x, floorY(anchor.x, anchor.z), anchor.z);
    ped.group.position.copy(ped.pos);
    ped.group.visible = true;
    if (!ped.group.parent) A.root.add(ped.group);
    const peds = CBZ.cityPeds || (CBZ.cityPeds = []);
    if (peds.indexOf(ped) < 0) peds.push(ped);
    if (ped.target && ped.target.set) ped.target.set(anchor.x, 0, anchor.z);
    ped.finalGoal = null; ped.path = null; ped.state = "idle";
    ped.pause = opts.captive ? 999 : 1.5;
    ped._campaignTarget = !!opts.target;
    ped._campaignCaptive = !!opts.captive;
    ped._campaignRole = opts.role || ped._campaignRole || "campaign";
    ped._campaignAnchor = { x: anchor.x, z: anchor.z };
    ped._campaignHostile = !!opts.hostile;
    ped._campaignHold = !!opts.hold;
    if (opts.armed != null) ped.armed = !!opts.armed;
    if (opts.weapon) ped.weapon = opts.weapon;
    if (opts.aggr != null) ped.aggr = opts.aggr;
    if (opts.captive && ped.char) ped.char.handsUp = true;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    if (R.actors.indexOf(ped) < 0) R.actors.push(ped);
    return ped;
  }

  function studioSet(anchor, tint) {
    const group = new THREE.Group();
    const gy = floorY(anchor.x, anchor.z);
    box(group, 0, 2.7, -3.4, 12, 5.4, 0.35, tint || 0x26313b);
    box(group, -5.4, 1.8, -1.8, 0.22, 3.6, 0.22, 0x4c5660);
    box(group, 5.4, 1.8, -1.8, 0.22, 3.6, 0.22, 0x4c5660);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe3a0 });
    [-5.4, 5.4].forEach(function (x) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 6), lampMat.clone());
      lamp.position.set(x, 3.5, -1.8); group.add(lamp);
    });
    group.position.set(anchor.x, gy, anchor.z);
    addProp(group);
    return group;
  }

  function recordPhase(next) {
    const c = state();
    if (c.phase !== next) {
      c.history.push({ phase: c.phase, t: Date.now() });
      if (c.history.length > 24) c.history.splice(0, c.history.length - 24);
    }
    c.phase = next;
    commit();
  }

  function award(pay, label) {
    if (pay && CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay);
    if (CBZ.cityEvent) {
      try { CBZ.cityEvent("hitman-complete", { cash: 0, hitman: 3, label: label || "Contract completed" }, { silent: true, noWanted: true }); } catch (e) {}
    }
  }

  function transition(next, pay, label) {
    if (pay) award(pay, label);
    recordPhase(next);
    activatePhase(true);
  }

  function stagePrologue() {
    R.kind = "prologue";
    R.transportReleased = false;
    g.cash = 0; g.cityBank = 0; g.escapedConvict = false; g.wanted = 0; g.heat = 0;
    R.pad = helipad();
    const h = makeHelicopter();
    h.position.set(R.pad.x, R.pad.y + 19, R.pad.z);
    addProp(h); R.helicopter = h;
    const P = player();
    if (P && P.pos) {
      P.driving = false; P._vehicle = null;
      // Spawn once on the roof. From the next frame onward the stock physics
      // controller exclusively owns position, facing, collision, and gait.
      P.pos.set(R.pad.x + 2.6, R.pad.y + 0.08, R.pad.z + 0.5);
      P.speed = 0; P.crouch = false; P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) {
        CBZ.playerChar.group.position.copy(P.pos);
        CBZ.playerChar.group.visible = true;
      }
    }
    if (CBZ.setFPS) CBZ.setFPS(false);
    setMission({
      id: "drop-point",
      title: "DROP POINT",
      briefing: "The pilot has one instruction: step onto the tallest roof and wait for the handoff.",
      location: "The Spire — helipad",
      status: "active",
      objectives: [{ id: "land", text: "Exit the helicopter", done: false }],
    });
    notify("personal", "PILOT", "Thirty seconds out. No luggage. No questions.");
    say("PILOT", "Hold tight. Setting down on the Spire now.", 3.0);
  }

  function spawnRooftopSwat() {
    if (R.swat.length || !CBZ.citySpawnCop || !R.pad) return;
    const pad = R.pad;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rr = 4.4 + (i % 2) * 1.6;
      let cop = null;
      try { cop = CBZ.citySpawnCop(pad.x + Math.cos(a) * rr, pad.z + Math.sin(a) * rr, true); } catch (e) { cop = null; }
      if (!cop) continue;
      if (cop.pos && cop.pos.set) cop.pos.set(pad.x + Math.cos(a) * rr, pad.y + 0.05, pad.z + Math.sin(a) * rr);
      if (cop.group && cop.pos) cop.group.position.copy(cop.pos);
      cop._campaignRoofX = pad.x + Math.cos(a) * rr;
      cop._campaignRoofZ = pad.z + Math.sin(a) * rr;
      cop.sees = true; cop.alert = 1; cop.arrestT = 0; cop._campaignRoofSwat = true;
      R.swat.push(cop);
    }
    if (CBZ.cityForceArrestSetup) {
      // wanted.js's scripted-arrest API: heat forced into the highest still-
      // ARRESTABLE band (police.js arrest-first goes lethal at 4★+), fired-upon
      // stamps and spree memory cleared, stale bust latch reset. The cordon
      // closes in to cuff; the scripted CBZ.cityBust below owns the handoff.
      // Bolting still burns SWAT patience and honestly returns lethal force —
      // the roof is a trap either way.
      try { CBZ.cityForceArrestSetup({ stars: 4, reason: "Rooftop Ambush" }); } catch (e) {}
    } else {
      // legacy fallback: the old hand-poked heat table
      if (CBZ.cityForceStars) { try { CBZ.cityForceStars(4); } catch (e) {} }
      const thresholds = CBZ.CITY && CBZ.CITY.starHeat;
      if (thresholds) g.heat = Math.max(g.heat || 0, (thresholds[4] || 3200) + 5);
      g.wanted = Math.max(g.wanted || 0, 4);
    }
    say("SWAT COMMANDER", "On your knees. The roof was the trap.", 3.2, R.swat[0]);
    notify("news", "VERIDIA LIVE", "Tactical units have sealed the Spire after an unidentified helicopter landing.");
    setMission({
      id: "drop-point",
      title: "DROP POINT",
      briefing: "The handoff was an arrest. There is no clean route off this roof.",
      location: "The Spire — helipad",
      status: "active",
      objectives: [
        { id: "land", text: "Exit the helicopter", done: true },
        { id: "arrest", text: "Face the arrest", done: false },
      ],
    });
  }

  function tickPrologue(dt) {
    const P = player();
    if (!P || !P.pos || !R.pad || !R.helicopter) return;
    R.t += dt;
    const rotor = R.helicopter.userData.rotor;
    if (rotor) rotor.rotation.y += dt * 17;
    const trotor = R.helicopter.userData.trotor;
    if (trotor) trotor.rotation.x += dt * 26;
    if (R.t < 3.4) {
      const q = Math.min(1, R.t / 3.4);
      const ease = q * q * (3 - 2 * q);
      const y = R.pad.y + 19 * (1 - ease) + 0.75;
      R.helicopter.position.set(R.pad.x, y - 0.7, R.pad.z);
      return;
    }
    // Runtime release is separate from the durable checkpoint flag. Reloading a
    // save written after the first landing used to skip this entire block, leave
    // the actor inside the helicopter, and make WASD appear to move only the
    // chase camera. Every activation now releases the body exactly once.
    if (!R.transportReleased) {
      R.transportReleased = true;
      say("PILOT", "Roof is clear. Move.", 2.2);
      if (!state().flags.dropped) {
        state().flags.dropped = true;
        commit();
      }
    }
    if (R.t >= 5.2) spawnRooftopSwat();
    // The arrest-first cordon can legitimately complete its own cuff a beat
    // before the scripted 9.4s handoff (both funnel into CBZ.cityBust, which
    // stamps g.busted immediately). Converge on the durable flags the moment
    // EITHER arrest lands, so the prison arrival is always chapter 1 — never a
    // mid-DROP "detention" that thinks the contract is still outside.
    if ((R.t >= 9.4 || g.busted) && !state().flags.arrested) {
      const c = state();
      c.flags.arrested = true;
      c.phase = PHASE.PRISON;
      c.chapter = 1;
      commit();
      clearDialogue();
      if (CBZ.cityBust) {
        // wanted.js owns a 2.6s bust-overlay callback that performs the actual
        // mode switch. Pin the new phase key while that callback is pending;
        // otherwise the next campaign tick sees city:prison_arrival, invokes
        // goToPrison immediately, and the still-pending callback resets prison a
        // second time when it fires. If the cordon's own arrest already stamped
        // g.busted, that pending overlay owns the switch — don't double-bust.
        R.key = g.mode + ":" + c.phase;
        R.kind = "awaiting_prison_handoff";
        if (!g.busted) {
          try { CBZ.cityBust({ peaceful: true, note: "Processed off the Spire roof." }); }
          catch (e) { goToPrison(); }
        }
      } else {
        goToPrison();
      }
    }
  }

  function goToPrison() {
    if (g.mode === "escape") return;
    cleanupRuntime();
    if (CBZ.setMode) CBZ.setMode("escape"); else g.mode = "escape";
    if (CBZ.setRole) CBZ.setRole("inmate"); else g.role = "inmate";
    if (CBZ.startRun) CBZ.startRun();
  }

  function prisonMission() {
    R.kind = "prison";
    setMission({
      id: "the-offer",
      title: "THE OFFER",
      briefing: "The prison has two exits. Break yourself out, or hear what the warden wants in return for the door.",
      location: "Cell Block Z",
      status: "active",
      objectives: [
        { id: "warden", text: "Speak with the warden", done: !!state().branch },
        { id: "leave", text: state().branch === "spy" ? "Leave under the warden's protection" : "Escape the prison", done: false },
      ],
    });
    if (!state().flags.wardenSpoke) notify("personal", "UNKNOWN", "The warden is asking for you by name. That is never good news.");
  }

  function openingPrisonPhase(phase) {
    return phase === PHASE.PRISON || phase === PHASE.PRISON_ESCAPE || phase === PHASE.PRISON_SPY_EXIT;
  }

  function detentionMission() {
    R.kind = "campaign_detention";
    setMission({
      id: "unfinished-business",
      title: "UNFINISHED BUSINESS",
      briefing: "The active contract is still waiting outside. Get out of Cell Block Z and return to it.",
      location: "Cell Block Z",
      status: "active",
      objectives: [{ id: "escape", text: "Escape and resume the contract", done: false }],
    });
  }

  function wardenActor() {
    const guards = CBZ.guards || [];
    for (let i = 0; i < guards.length; i++) if (guards[i] && guards[i].kind === "warden") return guards[i];
    return null;
  }

  function tickPrison(dt) {
    R.t += dt;
    const c = state();
    const w = wardenActor();
    if (openingPrisonPhase(c.phase) && w && !c.flags.wardenSpoke && w.group && distTo(w.group.position.x, w.group.position.z) < 5.2) {
      c.flags.wardenSpoke = true;
      commit();
      say("WARDEN", "You can climb my walls, or work for me. Refuse, and the people you call family become leverage.", 5.2, w);
    }
    if (c.phase === PHASE.PRISON_SPY_EXIT) {
      R.transitionT -= dt;
      if (R.transitionT <= 0) leavePrisonForCity("spy");
    }
  }

  function leavePrisonForCity(branch, resumePhase) {
    const c = state();
    // Once the warden answer is recorded no later handoff may rewrite it.
    c.branch = c.branch || branch || "rogue";
    if (resumePhase) c.phase = resumePhase;
    else {
      c.phase = c.branch === "spy" ? PHASE.SPY_INSERTION : PHASE.STUDIO_ONE;
      c.chapter = 2;
    }
    commit();
    cleanupRuntime();
    // The warden's authored release is clean; every later return from jail is
    // a real breakout and must retain the active phase plus the convict floor.
    g.escapedConvict = !!resumePhase || c.branch !== "spy";
    if (CBZ.setMode) CBZ.setMode("city"); else g.mode = "city";
    if (CBZ.startRun) CBZ.startRun();
  }

  function stageSpyInsertion() {
    R.kind = "spy_insertion";
    R.transportReleased = false;
    const point = { x: 205, z: -190 };
    point.y = floorY(point.x, point.z);
    R.pad = point;
    const h = makeHelicopter();
    h.position.set(point.x, point.y + 23, point.z);
    addProp(h); R.helicopter = h;
    const P = player();
    if (P && P.pos) {
      P.driving = false; P._vehicle = null;
      // As in the prologue, transport is staging, not a second movement system.
      // Place the actor once and leave every live frame to physics.js.
      P.pos.set(point.x + 2.8, point.y + 0.08, point.z + 0.5);
      P.speed = 0; P.crouch = false; P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) {
        CBZ.playerChar.group.position.copy(P.pos);
        CBZ.playerChar.group.visible = true;
      }
    }
    if (CBZ.setFPS) CBZ.setFPS(false);
    setMission({
      id: "black-rotor",
      title: "BLACK ROTOR",
      briefing: "The warden's helicopter is inserting you behind Halloran's runway. This is surveillance work: recover the hidden flight manifest before the first contract.",
      location: "Halloran Field — north infield",
      status: "active",
      objectives: [{ id: "insert", text: "Complete the helicopter insertion", done: false }],
    });
    notify("personal", "WARDEN", "No gunfire at the drop. I need the manifest more than I need another body.");
  }

  function tickSpyInsertion(dt) {
    const P = player();
    if (!P || !P.pos || !R.pad || !R.helicopter) return;
    R.t += dt;
    const rotor = R.helicopter.userData.rotor;
    if (rotor) rotor.rotation.y += dt * 18;
    const trotor = R.helicopter.userData.trotor;
    if (trotor) trotor.rotation.x += dt * 28;
    const duration = 4.2;
    if (R.t < duration) {
      const q = Math.min(1, R.t / duration);
      const ease = q * q * (3 - 2 * q);
      const y = R.pad.y + 23 * (1 - ease) + 0.8;
      R.helicopter.position.set(R.pad.x, y - 0.7, R.pad.z);
      return;
    }
    state().flags.spyInserted = true;
    recordPhase(PHASE.SPY_INTEL);
    activatePhase(true);
  }

  function stageSpyIntel() {
    const c = state();
    if (c.flags.spyIntel) {
      recordPhase(PHASE.STUDIO_ONE);
      activatePhase(true);
      return;
    }
    R.kind = "spy_intel";
    const point = { x: -160, z: -20 };
    point.y = floorY(point.x, point.z);
    R.intelPoint = point;
    const relay = new THREE.Group();
    box(relay, 0, 0.28, 0, 1.35, 0.5, 0.9, 0x171c22);
    box(relay, 0, 0.56, -0.12, 1.05, 0.08, 0.55, 0x56b6b1);
    box(relay, 0.48, 0.68, -0.12, 0.08, 0.14, 0.08, 0xffc766);
    relay.position.set(point.x, point.y, point.z);
    addProp(relay);
    makeMarker(null, point, 0x82d7ff);
    setMission({
      id: "quiet-channel",
      title: "QUIET CHANNEL",
      briefing: "A relay case beneath Halloran's taxiway beacon contains the production manifest. Stay at the relay while it copies the names without firing a shot.",
      target: "Production manifest",
      location: "Halloran Field — taxiway relay",
      status: "active",
      objectives: [{ id: "intel", text: "Recover the manifest from the relay", done: false }],
    });
    say("WARDEN", "That case maps the studios financing the ambush. Bring me the names; then you get a target.", 5.0);
  }

  function tickSpyIntel(dt) {
    dt = dt || 0;
    if (!R.intelPoint || distTo(R.intelPoint.x, R.intelPoint.z) > 3.2) {
      R.transitionT = 0;
      return;
    }
    const keys = CBZ.keys || {};
    if (!(keys.e || keys.E)) {
      R.transitionT = Math.max(0, R.transitionT - dt * 2);
      return;
    }
    // This is a physical data copy, not a disguised tap prompt. The player has
    // to stay at the relay and hold the interaction long enough to finish it.
    R.transitionT += dt;
    if (R.transitionT < 1.15) return;
    keys.e = false; keys.E = false;
    const c = state();
    c.flags.spyIntel = true;
    commit();
    notify("personal", "WARDEN", "Copy received. Vale and Voss are running separate stages. Start with Vale.");
    transition(PHASE.STUDIO_ONE, 0, "Halloran manifest recovered");
  }

  function stageStudio(which) {
    const first = which === 1;
    const spy = state().branch === "spy";
    R.kind = first ? "studio_one" : "studio_two";
    const lot = studioLot(which);
    const anchor = lotAnchor(lot);
    studioSet(anchor, first ? 0x263746 : 0x3a2635);
    const target = castExisting(first ? "Elias Vale" : "Mara Voss", { x: anchor.x, z: anchor.z - 1.2 }, {
      target: true, role: "studio target", armed: first, weapon: "Pistol", aggr: first ? 0.72 : 0.38,
    });
    R.target = target;
    makeMarker(target, target ? null : anchor, first ? 0xffc766 : 0xff776e);
    const title = first ? "FALSE FRONT" : "SECOND UNIT";
    const location = first ? "Glasshouse Studios" : "Northlight Stage 12";
    const briefing = first
      ? (spy
        ? "The Halloran manifest identifies Vale as the producer who staged your rooftop arrest. The warden has authorized the hit; remove Vale without losing the paper trail."
        : "Vale sold the rooftop ambush and put your face on every camera in the city. Ghostline has his location. Remove him on the set.")
      : (spy
        ? "Voss owns a different studio and the footage linking the warden to your first contract. Recovering it is impossible while she is alive."
        : "Voss runs a different studio and bought the footage of your first contract. Ghostline wants the archive burned and its keeper erased.");
    setMission({
      id: first ? "false-front" : "second-unit",
      title: title,
      briefing: briefing,
      target: target ? target.name : ((first ? "Elias Vale" : "Mara Voss") + " dossier"),
      location: location,
      reward: first ? 12000 : 18000,
      status: "active",
      objectives: [{ id: "hit", text: target ? "Eliminate the target" : "Recover the target dossier", done: false }],
    });
    const line = first
      ? (spy ? "The manifest was real. Vale is the first name; the remaining studios are still intelligence, not collateral." : "First dossier attached. Vale paid for the roof trap. Hit the man who bought it.")
      : (spy ? "Northlight is a separate stage. Voss has my archive; she cannot leave with it." : "Different studio, same audience. Voss bought the recording and marked you for cleanup.");
    notify("personal", cHandler(), line);
  }

  function cHandler() { return state().branch === "spy" ? "WARDEN" : "GHOSTLINE"; }

  function tickStudio() {
    const complete = R.target ? R.target.dead : !!(R.markerPoint && distTo(R.markerPoint.x, R.markerPoint.z) <= 5);
    if (complete) {
      if (R.kind === "studio_one") transition(PHASE.STUDIO_TWO, 12000, "Elias Vale contract");
      else transition(PHASE.FAMILY, 18000, "Mara Voss contract");
    }
  }

  function stageFamilyHostage() {
    R.kind = "family";
    const lot = chooseLot(303, 75);
    const anchor = lotAnchor(lot);
    studioSet({ x: anchor.x, z: anchor.z }, 0x251d1d);
    const hostagePoint = { x: anchor.x, z: anchor.z - 1.8 };
    let familyRecord = null;
    let seededHostage = null;
    try { familyRecord = CBZ.cityKidnap ? CBZ.cityKidnap() : null; } catch (e) { familyRecord = null; }
    if (!familyRecord && CBZ.cityStartFamilyKidnap) {
      try { familyRecord = CBZ.cityStartFamilyKidnap(); } catch (e) { familyRecord = null; }
    }
    // A new campaign may not own a sandbox house yet, so family.js can have no
    // pre-cast player household to select. Seed Lena once, then hand that same
    // actor to the real kidnap system so its captive/captor state remains the
    // source of truth instead of silently falling back to a parallel fake cast.
    if (!familyRecord && CBZ.cityStartFamilyKidnap) {
      seededHostage = spawnPed("Lena", hostagePoint.x, hostagePoint.z, {
        captive: true, family: true, role: "your family", salt: 303, aggr: 0.05,
      });
      if (seededHostage) {
        try { familyRecord = CBZ.cityStartFamilyKidnap(seededHostage); } catch (e) { familyRecord = null; }
      }
    }

    // Prefer the real household actor and the captors owned by family.js. The
    // authored API registers them as live city actors; this director only moves
    // that same cast onto the mission set and gives it campaign observation rules.
    if (familyRecord && familyRecord.ped && !familyRecord.ped.dead) {
      familyRecord.authored = true;
      familyRecord.x = hostagePoint.x; familyRecord.z = hostagePoint.z;
      familyRecord.t = Math.max(180, familyRecord.t || 0);
      R.familyRecord = familyRecord;
      R.hostage = adoptActor(familyRecord.ped, hostagePoint, {
        captive: true, hold: true, role: "your family", aggr: 0.05,
      });
      if (R.hostage) {
        R.hostage.captiveX = hostagePoint.x; R.hostage.captiveZ = hostagePoint.z;
      }
      const ownedCaptors = Array.isArray(familyRecord.captors) ? familyRecord.captors : [];
      for (let i = 0; i < ownedCaptors.length; i++) {
        const ang = i * Math.PI * 2 / Math.max(1, ownedCaptors.length);
        const p = adoptActor(ownedCaptors[i], {
          x: anchor.x + Math.cos(ang) * 3.2,
          z: anchor.z + Math.sin(ang) * 3.2,
        }, { target: true, armed: true, aggr: 0.96, role: "captor", hostile: true });
        if (p) R.captors.push(p);
      }
    }

    // A city with no cast household/gang still gets the authored beat. This is
    // the fallback only; it never duplicates a family.js kidnap cast.
    if (!R.hostage) {
      R.hostage = seededHostage || spawnPed("Lena", hostagePoint.x, hostagePoint.z, {
        captive: true, family: true, role: "your family", salt: 303, aggr: 0.05,
      });
      if (R.hostage) R.hostage._campaignHold = true;
      for (let i = 0; i < 3; i++) {
        const ang = i * Math.PI * 2 / 3;
        const p = spawnPed("Captor " + (i + 1), anchor.x + Math.cos(ang) * 3.2, anchor.z + Math.sin(ang) * 3.2, {
          armed: true, weapon: i === 0 ? "SMG" : "Pistol", aggr: 0.96, role: "captor", hostile: true, salt: 320 + i,
        });
        if (p) { p._campaignTarget = true; R.captors.push(p); }
      }
    }

    const familyName = R.hostage && R.hostage.name ? R.hostage.name : "Lena";
    state().flags.familyName = familyName;
    commit();
    makeMarker(R.hostage, R.hostage ? null : hostagePoint, 0x82d7ff);
    setMission({
      id: "blood-relative",
      title: "BLOOD RELATIVE",
      briefing: "They took " + familyName + " to force the airport assignment. There is no failure screen here: bring family home, or carry what happens next.",
      target: R.captors.length + " captors",
      location: "Northlight holding set",
      reward: 0,
      status: "active",
      objectives: [{ id: "rescue", text: "Neutralize the captors and reach " + familyName, done: false }],
    });
    notify("personal", familyName.toUpperCase(), "They keep calling this place a set. Please come before they roll cameras again.");
  }

  function tickFamily() {
    let live = 0;
    for (let i = 0; i < R.captors.length; i++) {
      const p = R.captors[i];
      if (p && !p.dead && !(p.ko > 0)) live++;
    }
    if (live > 0) return;
    const c = state();
    const familyName = c.flags.familyName || "Lena";
    if (!R.hostage || R.hostage.dead) {
      c.flags.familySaved = false;
      c.flags.familyLost = true;
      commit();
      transition(PHASE.AIRPORT, 0, "Family hostage lost");
      notify("personal", cHandler(), familyName + " is gone. The airport order remains active; grief is not a mission failure.");
      return;
    }
    if (R.lastProgress !== 0) {
      R.lastProgress = 0;
      setMission({
        id: "blood-relative",
        title: "BLOOD RELATIVE",
        briefing: "The captors are down. The rescue is not complete until you physically reach " + familyName + ".",
        target: familyName,
        location: "Northlight holding set",
        status: "active",
        objectives: [
          { id: "captors", text: "Neutralize the captors", done: true },
          { id: "reach", text: "Reach " + familyName, done: false },
        ],
      });
    }
    R.hostage._campaignHold = true;
    R.hostage.state = "idle"; R.hostage.pause = 2; R.hostage.speed = 0;
    if (distTo(R.hostage.pos.x, R.hostage.pos.z) > 4.5) return;
    c.flags.familySaved = true;
    c.flags.familyLost = false;
    commit();
    const rescued = R.hostage;
    releaseActor(rescued);
    transition(PHASE.AIRPORT, 0, "Family recovered");
    notify("personal", familyName.toUpperCase(), "They wanted you angry enough to obey. Don't give them that ending.");
  }

  function familyOutcome(c) {
    const name = c.flags.familyName || "Lena";
    if (c.flags.familySaved) return name + " is alive, and the people behind the airport order no longer have that leverage.";
    if (c.flags.familyLost) return name + " died on their set, and the people behind the airport order expect grief to make you obedient.";
    return "The people behind the airport order tried to turn your family into leverage.";
  }

  function stageAirportArrival() {
    R.kind = "airport_arrival";
    const c = state();
    const point = { x: -40, y: 0, z: 18 };
    makeMarker(null, point, 0xffc766);
    setMission({
      id: "departures",
      title: "DEPARTURES",
      briefing: familyOutcome(c) + " Reach Halloran Field. The handler will give the final order inside the terminal.",
      location: "Halloran International Airport",
      status: "active",
      objectives: [{ id: "arrive", text: "Reach the airport terminal", done: false }],
    });
    notify("news", "CITY DESK", "Halloran Field remains open despite an unusual tactical-police presence on the causeway.");
    notify("personal", cHandler(), c.flags.familySaved
      ? "You broke their leverage. Commercial aircraft are live assets if the field collapses."
      : "They are counting on what happened to your family. Commercial aircraft are live assets if the field collapses.");
  }

  function tickAirportArrival() {
    if (distTo(-40, 18) > 48) return;
    recordPhase(PHASE.AIRPORT_CHOICE);
    activatePhase(true);
  }

  function showAirportChoice() {
    R.kind = "airport_choice";
    const c = state();
    setMission({
      id: "no-clean-hands",
      title: "NO CLEAN HANDS",
      briefing: "The order is a massacre. Comply and the story continues. Refuse and the story continues. The only permanent choice is who you become.",
      location: "Halloran terminal",
      status: "active",
      objectives: [{ id: "choose", text: "Answer the handler", done: false }],
    });
    const order = c.flags.familySaved
      ? "You saved them once. Refuse me and we build another set around everyone you love. No names. Everyone in the concourse is the assignment."
      : "You know what refusal costs now. No names. No extraction list. Everyone in the concourse is the assignment.";
    say(cHandler(), order, 8.0);
    const ui = UI();
    if (ui && ui.choice) {
      ui.choice({
        id: "airport-order",
        speaker: cHandler(),
        prompt: "Carry out the massacre, or turn on the people who ordered it.",
        options: [
          { id: "comply", label: "Carry out the order" },
          { id: "refuse", label: "Refuse — hunt the handler" },
        ],
        onChoose: function (id) { CBZ.cityCampaignChoose(id); },
      });
    }
  }

  function stageAirportComply() {
    R.kind = "airport_comply";
    const rng = seeded(404);
    for (let i = 0; i < 8; i++) {
      const x = -75 + rng() * 70;
      const z = 12 + rng() * 22;
      const p = spawnPed("Traveler " + (i + 1), x, z, {
        role: "traveler", job: "traveller", archetype: "tourist", salt: 404 + i, aggr: 0.02,
      });
      if (p) R.victims.push(p);
    }
    R.required = Math.min(6, R.victims.length);
    makeMarker(null, { x: -40, y: 0, z: 22 }, 0xff776e);
    setMission({
      id: "black-gate",
      title: "BLACK GATE",
      briefing: "You accepted an order with no target. The terminal is full of ordinary people and hidden cameras.",
      location: "Halloran concourse",
      status: "active",
      progress: 0,
      objectives: [{ id: "massacre", text: R.required ? "Carry out the order — 0/" + R.required : "Enter the staged concourse", done: false }],
    });
  }

  function tickAirportComply(dt) {
    R.t += dt;
    if (R.required <= 0) {
      // Missing crowd actors cannot turn a moral choice into a broken mission.
      // The Director recorded the player's answer even though the staged cast
      // failed to appear, so the story advances after a short observed beat.
      if (R.t < 0.8) return;
      notify("personal", "THE DIRECTOR", "The concourse feed is empty. Your answer was not. Consent is all the test required.");
      transition(PHASE.RECKONING, 0, "Airport order accepted");
      return;
    }
    let dead = 0;
    for (let i = 0; i < R.victims.length; i++) if (R.victims[i] && R.victims[i].dead) dead++;
    if (dead !== R.lastProgress) {
      R.lastProgress = dead;
      setMission({
        id: "black-gate",
        title: "BLACK GATE",
        briefing: "The order was never about security. It was about seeing whether you would obey while the audience watched.",
        location: "Halloran concourse",
        status: "active",
        progress: Math.min(1, dead / R.required),
        objectives: [{ id: "massacre", text: "Carry out the order — " + dead + "/" + R.required, done: dead >= R.required }],
      });
    }
    if (dead < R.required) return;
    notify("news", "GLOBAL WIRE", "Live feeds from Halloran show a mass-casualty attack. The footage appeared online before police received the first call.");
    transition(PHASE.RECKONING, 0, "Airport order carried out");
  }

  function stageAirportRefuse() {
    R.kind = "airport_refuse";
    const anchor = { x: -160, z: 18 };
    const target = castExisting("Handler Rook", anchor, { target: true, role: "handler", armed: true, weapon: "SMG", aggr: 0.98, hostile: true });
    R.target = target;
    makeMarker(target, target ? null : anchor, 0x82d7ff);
    setMission({
      id: "cut-the-feed",
      title: "CUT THE FEED",
      briefing: "You refused. Rook is leaving through the control-tower apron with the recording and the names behind it.",
      target: target ? "Handler Rook" : "Rook's dead drop",
      location: "Halloran control apron",
      status: "active",
      objectives: [{ id: "rook", text: target ? "Eliminate Rook" : "Reach Rook's dead drop", done: false }],
    });
    notify("personal", "ROOK", "You think refusal makes you clean? It only makes you the next target.");
  }

  function tickAirportRefuse() {
    if (R.target && R.target.dead) {
      transition(PHASE.RECKONING, 0, "Handler Rook eliminated");
      return;
    }
    // If the handler actor could not be cast, his physical dead drop on the
    // apron carries the same recording. Reaching it preserves the refusal path.
    if (!R.target && R.markerPoint && distTo(R.markerPoint.x, R.markerPoint.z) <= 5) {
      notify("personal", cHandler(), "Rook missed extraction. His recorder names Studio Zero.");
      transition(PHASE.RECKONING, 0, "Handler dead drop recovered");
    }
  }

  function reckoningPay(c) {
    let pay = c.flags.airportChoice === "refuse" ? 60000 : 35000;
    if (c.flags.familySaved) pay += 5000;
    return pay;
  }

  function stageReckoning() {
    R.kind = "reckoning";
    const c = state();
    const refused = c.flags.airportChoice === "refuse";
    const pay = reckoningPay(c);
    const lot = chooseLot(505, 90);
    const anchor = lotAnchor(lot);
    studioSet(anchor, 0x15181d);
    const target = castExisting("The Director", { x: anchor.x, z: anchor.z - 1 }, {
      target: true, role: "director", armed: true, weapon: refused ? "Pistol" : "SMG", aggr: refused ? 0.86 : 0.98, hostile: true,
    });
    R.target = target;
    makeMarker(target, target ? null : anchor, 0xffffff);
    setMission({
      id: "the-audience",
      title: "THE AUDIENCE",
      briefing: (refused
        ? "You broke the Halloran order and followed Rook's recording to the person writing it. "
        : "You carried the Halloran order out, and the Director turned those deaths into the season finale. ") +
        familyOutcome(c) + " The city was built around your reactions. End the broadcast without ending the game.",
      target: target ? "The Director" : "Studio Zero master reel",
      location: "Studio Zero",
      reward: pay,
      status: "active",
      objectives: [{ id: "director", text: target ? "Kill the Director" : "Recover the master reel", done: false }],
    });
    notify("personal", "THE DIRECTOR", refused
      ? "You refused the scene and still arrived on my mark. Rebellion is excellent blocking."
      : "Halloran proved you would fill any role I wrote. Your family only improved the performance.");
  }

  function tickReckoning() {
    if (R.target && !R.target.dead) return;
    if (!R.target && (!R.markerPoint || distTo(R.markerPoint.x, R.markerPoint.z) > 5)) return;
    const c = state();
    c.flags.directorDead = true;
    c.contractNo = 0;
    award(reckoningPay(c), "The Director");
    notify("news", "CITY DESK", c.flags.airportChoice === "refuse"
      ? "Studio Zero has gone dark after the Halloran order was exposed. Contract killings continue without a central broadcaster."
      : "Studio Zero has gone dark, but the Halloran massacre remains on every feed. Contract killings continue without a central broadcaster.");
    recordPhase(PHASE.ENDLESS);
    activatePhase(true);
  }

  const ENDLESS_NAMES = ["Anton Grey", "Celeste Ward", "Niko Barr", "Imani Cross", "Victor Sanz", "Rhea Knox", "Dorian Pike", "Sloane Mercer"];
  const ENDLESS_TITLES = ["CLOSED SET", "NIGHT CALL", "DEAD AIR", "PRACTICAL EFFECT", "LAST TAKE", "NO CREDITS"];

  function endlessPay(n, c) {
    return 9000 + Math.min(41000, n * 1750) + (c.flags.airportChoice === "refuse" ? 2500 : 0) + (c.flags.familySaved ? 1000 : 0);
  }

  // ============================================================
  //  ENDLESS CONTRACT VARIETY (CFG.CAMPAIGN_CONTRACT_VARIETY)
  //
  //  Five archetypes over the same observed-scene machinery, each reusing an
  //  existing city system rather than inventing one:
  //    classic   — the original close hit (castExisting street mark)
  //    sniper    — the mark holds a forecourt position behind watchers; a kill
  //                from beyond SNIPER_RANGE pays a fieldcraft bonus
  //                (scopeview.js/gunmods optics make the distance practical)
  //    disguise  — a door crew guards the venue; the outfits.js uniform on a
  //                spawned steward (interact.js corpse swap) walks you past them
  //    vehicle   — the mark drives live traffic (vehicles.js npcDriver seat);
  //                stop, wreck, or burn the car and they run on foot
  //    highvalue — every 5th contract, "DIRECTOR'S LIST": bodyguard ring,
  //                2.25× pay, and a permadeath-honest warning
  //  Every parameter of contract n derives from CBZ.seedStream("endless-<n>")
  //  with a FIXED draw order, so a checkpoint/death/jail restage rebuilds the
  //  identical assignment for the same (world seed, contract index).
  // ============================================================
  const SNIPER_RANGE = 40;
  const ARCH_MULT = { classic: 1, sniper: 1.35, disguise: 1.5, vehicle: 1.4, highvalue: 2.25 };
  const ARCH_TITLES = {
    classic: ENDLESS_TITLES,
    sniper: ["LONG LENS", "WIDE SHOT", "CRANE SHOT", "DEEP FOCUS"],
    disguise: ["COSTUME DEPARTMENT", "DRESS REHEARSAL", "EXTRAS CALL", "WARDROBE CHANGE"],
    vehicle: ["PICTURE CAR", "MOVING SHOT", "CHASE UNIT", "PROCESS TRAILER"],
    highvalue: ["DIRECTOR'S LIST"],
  };
  const ARCH_NEWS = {
    classic: [
      "Police found a body on a commercial lot this morning. Neighbors report no dispute, no robbery, no suspect.",
      "Another quiet killing in the production district. Investigators privately call the wounds professional.",
    ],
    sniper: [
      "A single long-range shot killed a man in the open today. Police canvassed every roofline and found nothing.",
      "Witnesses heard one distant report, then saw a body. The shooter was never inside the cordon.",
    ],
    disguise: [
      "A guarded venue lost its principal last night. Staff swear nobody unfamiliar crossed the rope.",
      "Private security is under review citywide after a protected host died inside his own perimeter.",
    ],
    vehicle: [
      "A vehicle was forced off the road and its driver killed. Traffic cameras in the area had been dark for weeks.",
      "The morning commute stalled around a burned-out sedan. The medical examiner says its driver never made it out.",
    ],
    highvalue: [
      "A heavily protected figure and his entire detail were found dead. The city's private-security rates doubled overnight.",
      "Bodyguards, cameras, money — none of it mattered. Another name from the old production network is gone.",
    ],
  };

  // soft prestige ladder surfaced on the phone (STANDING chip + rank-up line)
  function prestigeTitle(done) {
    if (done >= 35) return "Director's Own";
    if (done >= 20) return "Wraith";
    if (done >= 10) return "Specialist";
    if (done >= 5) return "Cleaner";
    return "Freelancer";
  }
  function prestigeLine(c, n) {
    let s = "Contract " + n + " · " + prestigeTitle(Math.max(0, n - 1));
    if (c.flags.cityBoss) s += " · CITY BOSS";
    return s;
  }

  function contractStream(n) {
    return CBZ.seedStream ? CBZ.seedStream("endless-" + n) : seeded(0x6e57 + n * 131);
  }
  function pickArchetype(n, r) {
    if (CFG.CAMPAIGN_CONTRACT_VARIETY === false) return "classic";
    if (n % 5 === 0) return "highvalue";           // the escalation beat
    if (r < 0.30) return "classic";
    if (r < 0.55) return "sniper";
    if (r < 0.80) return "disguise";
    return "vehicle";
  }

  // is the player dressed for the venue? The exact staff blacks pass; so does a
  // police uniform (outfits.js already teaches that cloth buys deference).
  function disguiseWornOk(need) {
    const w = CBZ.cityOutfitGet ? CBZ.cityOutfitGet() : null;
    if (!w) return false;
    return w.id === need || !!w.cop;
  }
  function disguiseName(id) {
    return id === "waiter" ? "Waiter Blacks" : "Guard Blacks";
  }

  // ---- vehicle hits: seat the cast mark behind the wheel of live traffic ----
  function seatTargetInCar(target) {
    const cars = CBZ.cityCars || [];
    let car = null, best = Infinity;
    for (let i = 0; i < cars.length; i++) {
      const cc = cars[i];
      if (!cc || cc.player || cc.owned || cc.dead || cc.npcDriver || cc.abandoned) continue;
      if (cc.stolen || (cc.wreckT || 0) > 0 || !cc.ai || !cc.road) continue;
      const d = Math.hypot(cc.pos.x - target.pos.x, cc.pos.z - target.pos.z);
      if (d < best) { best = d; car = cc; }
    }
    if (!car) return null;
    // exactly the vehicles.js npcDriver contract, minus the carjack flags —
    // this car is not stolen and not wanted; it just carries the mark.
    car.npcDriver = target;
    car._campaignBaseV0 = car.baseV != null ? car.baseV : null;
    car.baseV = Math.min(car.baseV || 8, 6.5);      // catchable on foot or wheels
    target.inCar = car; target.controlled = true;
    if (target.group) target.group.visible = false;
    target._campaignAnchor = null;                  // the car owns position now
    target._campaignHold = false;
    return car;
  }
  function unseatContractCar(fleeing) {
    const con = R.contract;
    const car = con && con.car;
    if (!car) return;
    const ped = car.npcDriver;
    if (ped) {
      // mirror vehicles.js ejectNpcDriver for a driver we seated ourselves
      car.npcDriver = null;
      ped.inCar = null; ped.controlled = false;
      if (ped.group) ped.group.visible = !ped.dead;
      if (!ped.dead && ped.pos) {
        const ex = car.pos.x + 1.6, ez = car.pos.z;
        ped.pos.set(ex, floorY(ex, ez), ez);
        if (ped.group) ped.group.position.copy(ped.pos);
        if (ped.target && ped.target.set) ped.target.set(ex, 0, ez);
        if (fleeing) {
          ped.state = "flee"; ped.fear = 4; ped.pause = 0;
          if (CBZ.cityFleeFrom) { try { CBZ.cityFleeFrom(ped, car.pos.x, car.pos.z); } catch (e) {} }
        }
      }
    }
    if (car._campaignBaseV0 != null) { car.baseV = car._campaignBaseV0; car._campaignBaseV0 = null; }
    con.car = null;
  }

  // the live mission card for the current generated contract (re-issued when a
  // sub-objective flips so the phone reflects the disguise/stop state).
  function missionForContract(con) {
    const objectives = [];
    if (con.type === "disguise" && con.outfit) {
      objectives.push({ id: "dress", text: "Optional: take a " + disguiseName(con.outfit) + " uniform — the door crew waves staff through", done: !!con.dressed });
    }
    if (con.type === "vehicle" && con.hadCar) {
      objectives.push({ id: "stop", text: "Force the car to stop — box it, wreck it, or burn it", done: !!con.bailed || !!(R.target && R.target.dead) });
    }
    objectives.push({
      id: "hit",
      text: (R.target ? "Eliminate " + con.name : "Recover " + con.name + "'s dossier") +
        (con.type === "sniper" ? " — from beyond " + SNIPER_RANGE + "m for the bonus" : ""),
      done: false,
    });
    return {
      id: "open-contract-" + con.n,
      title: con.title,
      briefing: con.brief,
      target: R.target ? con.name : con.name + " dossier",
      location: con.loc,
      reward: con.bonus ? con.pay + " (+" + con.bonus + " range bonus)" : con.pay,
      prestige: prestigeLine(state(), con.n),
      status: "active",
      objectives: objectives,
    };
  }

  function stageEndless() {
    const c = state();
    // contractNo names the currently active generated contract. Incrementing
    // here used to skip one every time a checkpoint, death, or jail return
    // rebuilt the live target. Only tickEndless advances it after a confirmed
    // kill; a first entry still initializes contract 1.
    if ((c.contractNo | 0) < 1) {
      c.contractNo = 1;
      commit();
    }
    R.kind = "endless";
    fireTakeoverMoment();          // a queued gang-game win lands in free time
    const n = c.contractNo;
    const rng = contractStream(n);
    // FIXED draw order — restaging contract n replays identical values.
    const rType = rng(), rTitle = rng(), rOutfit = rng(), rNews = rng(), rGuard = rng();
    const type = pickArchetype(n, rType);
    const lot = chooseLot(600 + n * 17, type === "sniper" ? 80 : 60);
    const anchor = lotAnchor(lot);
    const name = ENDLESS_NAMES[(n - 1) % ENDLESS_NAMES.length];
    const basePay = endlessPay(n, c);
    const titles = ARCH_TITLES[type] || ENDLESS_TITLES;
    const con = R.contract = {
      n: n, type: type, name: name,
      title: CFG.CAMPAIGN_CONTRACT_VARIETY === false
        ? ENDLESS_TITLES[(n - 1) % ENDLESS_TITLES.length]
        : titles[(rTitle * titles.length) | 0],
      pay: Math.round(basePay * (ARCH_MULT[type] || 1) / 50) * 50,
      bonus: 0, newsIdx: rNews, brief: "", loc: "Generated field location",
      point: { x: anchor.x, z: anchor.z },
      car: null, hadCar: false, bailed: false, bailT: 0,
      guards: [], steward: null, outfit: null, dressed: false, blown: false,
    };

    const target = castExisting(name, { x: anchor.x, z: anchor.z - (type === "classic" ? 0 : 1.2) }, {
      target: true,
      role: "contract target",
      armed: type === "highvalue" || (type === "classic" && n % 3 === 0),
      weapon: type === "highvalue" ? "SMG" : (type === "classic" && n % 3 === 0 ? "Pistol" : null),
      aggr: type === "highvalue" ? 0.92 : (type === "classic" && n % 3 === 0 ? 0.8 : 0.34),
      hostile: type === "highvalue",
    });
    R.target = target;
    if (!target && con.type !== "classic") con.type = "classic";   // dossier fallback keeps the old shape

    // ---- archetype dressing (existing systems only) ----
    if (con.type === "sniper") {
      con.loc = "Open forecourt — long sightlines";
      target._campaignHold = true;   // the scripted outdoor position
      for (let i = 0; i < 2; i++) {
        const a = rGuard * 6.28 + i * 2.6;
        const p = spawnPed("Watcher " + (i + 1), anchor.x + Math.cos(a) * 4.6, anchor.z + Math.sin(a) * 4.6, {
          armed: true, weapon: "Pistol", aggr: 0.9, role: "watcher", hostile: true, salt: 610 + n * 7 + i,
        });
        if (p) con.guards.push(p);
      }
    } else if (con.type === "disguise") {
      con.loc = "Guarded venue";
      con.outfit = rOutfit < 0.5 ? "security" : "waiter";
      target._campaignHold = true;
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + 0.5;
        const p = spawnPed("Door Crew " + (i + 1), anchor.x + Math.cos(a) * 3.8, anchor.z + Math.sin(a) * 3.8, {
          armed: true, weapon: i === 0 ? "SMG" : "Pistol", aggr: 0.9, role: "venue guard", salt: 640 + n * 7 + i,
        });
        if (p) { p._campaignHostile = false; con.guards.push(p); }   // tickEndless decides who they hate
      }
      // the disguise walks the street on a steward's back (outfits.js job
      // wardrobe + interact.js "take their clothes" once he's down)
      con.steward = spawnPed("Steward", anchor.x + 8 + rOutfit * 5, anchor.z + 7, {
        role: "steward", job: con.outfit, aggr: 0.04, salt: 660 + n * 7,
      });
    } else if (con.type === "vehicle") {
      con.car = seatTargetInCar(target);
      if (con.car) {
        con.hadCar = true;
        con.loc = "Mobile — tracked vehicle";
      } else {
        // no live traffic anywhere near the cast point — degrade to a guarded
        // street hit so the briefing never promises a car that does not exist
        con.type = "classic";
        const p = spawnPed("Wheelman", anchor.x + 2.6, anchor.z + 1.4, {
          armed: true, weapon: "Pistol", aggr: 0.9, role: "wheelman", hostile: true, salt: 670 + n * 7,
        });
        if (p) con.guards.push(p);
      }
    } else if (con.type === "highvalue") {
      con.loc = "Fortified lot";
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + rGuard;
        const p = spawnPed("Bodyguard " + (i + 1), anchor.x + Math.cos(a) * 3.4, anchor.z + Math.sin(a) * 3.4, {
          armed: true, weapon: i === 0 ? "SMG" : "Pistol", aggr: 0.95, role: "bodyguard", hostile: true, salt: 690 + n * 7 + i,
        });
        if (p) con.guards.push(p);
      }
    }

    makeMarker(target, target ? null : anchor, con.type === "highvalue" ? 0xff776e : 0xffc766);

    const refused = c.flags.airportChoice === "refuse";
    const lore = (refused
      ? "The names recovered by refusing Halloran are still moving through the production network. "
      : "Halloran remains on your ledger; each new hit cuts one producer out of the network that staged it. ") +
      (c.flags.familySaved ? "Your family is out of their hands. " : "The family loss remains part of every contract. ");
    if (con.type === "sniper") {
      con.brief = lore + con.name + " holds a forecourt mark behind armed watchers who clock every face inside forty meters. " +
        "Take the kill from beyond " + SNIPER_RANGE + "m and the fee carries a fieldcraft bonus — a magnified optic from the gun bench makes the distance honest.";
    } else if (con.type === "disguise") {
      con.brief = lore + con.name + " hosts behind a door crew that pats down strangers. " + disguiseName(con.outfit) +
        " walk straight past the rope — a steward on his smoke break beside the venue wears a set. Work close, keep it quiet: one loud mistake and the calm ends.";
    } else if (con.type === "vehicle") {
      con.brief = lore + con.name + " is rolling — a marked car threading live traffic. Box it in, wreck it, or burn it; a mark whose wheels stop will run, and a hard enough hit ends it at the wheel.";
    } else if (con.type === "highvalue") {
      con.brief = "DIRECTOR'S LIST. " + lore + con.name + " travels with a paid ring of professional guns, and they shoot first. " +
        "You die once in this city — walk in with a plan or do not walk in.";
    } else {
      con.brief = lore + "This target is cast only when the assignment begins and the next contract is already waiting.";
    }

    setMission(missionForContract(con));
    notify("personal", cHandler(), (refused ? "Rook's list" : "The Halloran atonement list") +
      " marks contract " + n + (con.type === "highvalue" ? " — a Director's List name. Bring everything." :
        ". No empire building. No errands. Just the target."));
  }

  // ---- per-archetype live logic --------------------------------------------
  function tickDisguise(con) {
    const dressed = disguiseWornOk(con.outfit);
    if (dressed !== con.dressed) {
      con.dressed = dressed;
      setMission(missionForContract(con));
      if (dressed && con.point && distTo(con.point.x, con.point.z) < 30) {
        say("DOOR CREW", "Staff comes through the side. Go on.", 2.4, con.guards[0]);
      }
    }
    if (!con.blown) {
      let down = 0;
      for (let i = 0; i < con.guards.length; i++) {
        const p = con.guards[i];
        if (!p || p.dead || p.ko > 0) down++;
      }
      if (down > 0 || (R.target && R.target.dead)) con.blown = true;
    }
    // hostile only to undisguised strangers inside the rope (or once blown);
    // presentCampaign's hostile branch then drives the actual aggression.
    const hot = con.blown || (!dressed && con.point && distTo(con.point.x, con.point.z) < 15);
    for (let i = 0; i < con.guards.length; i++) {
      const p = con.guards[i];
      if (!p || p.dead) continue;
      p._campaignHostile = hot;
      if (!hot && p.rage) { p.rage = null; p.state = "idle"; p.pause = 1.2; }
    }
  }

  function tickVehicle(con, dt) {
    const car = con.car, t = R.target;
    if (!car || !t || t.dead) return;
    if (t.inCar !== car) {
      // ejected by another system (cop stop, crash): restore the car profile
      // and continue as a foot contract — the marker already follows the body.
      unseatContractCar(false);
      con.bailed = true;
      setMission(missionForContract(con));
      return;
    }
    const gone = car.dead || !car.group || !car.group.parent;
    const burning = !!car._onFire;
    if (gone || burning) {
      unseatContractCar(true);
      con.bailed = true;
      setMission(missionForContract(con));
      notify("personal", cHandler(), con.name + " bailed out. On foot now — finish it.");
      return;
    }
    // A bail needs DISTRESS, not a red light: a wrecked/beaten car with the
    // player closing, or the player physically on the stopped car's door.
    const wrecked = (car.wreckT || 0) > 0 || (car.crumple || 0) > 0.2;
    const stalled = Math.abs(car.v || 0) < 0.8;
    const d = distTo(car.pos.x, car.pos.z);
    if ((wrecked && d < 40) || (stalled && d < 9)) {
      con.bailT += dt;
      if (con.bailT > (wrecked ? 0.7 : 2.2)) {
        unseatContractCar(true);
        con.bailed = true;
        setMission(missionForContract(con));
        notify("personal", cHandler(), con.name + " is out of the car and running.");
      }
    } else con.bailT = 0;
  }

  function tickEndless(dt) {
    fireTakeoverMoment();
    const c = state();
    const con = R.contract;
    if (con && R.target) {
      if (con.type === "disguise") tickDisguise(con);
      else if (con.type === "vehicle") tickVehicle(con, dt || 0);
    }
    const killed = R.target ? R.target.dead : false;
    if (!killed && !(R.target == null && R.markerPoint && distTo(R.markerPoint.x, R.markerPoint.z) <= 5)) return;
    const n = c.contractNo;
    let pay = con ? con.pay : endlessPay(n, c);
    // sniper fieldcraft bonus: the player's own kill, measured at the death
    // frame (cityKillPed stamps g._cityKillDetail for player kills).
    if (con && con.type === "sniper" && killed && R.target) {
      // measure to the HELD position, not the corpse — the ragdoll fling could
      // otherwise rob a shot taken exactly on the line.
      const px = con.point ? con.point.x : R.target.pos.x;
      const pz = con.point ? con.point.z : R.target.pos.z;
      const d = distTo(px, pz);
      const mine = !!R.target._campaignKilledByPlayer ||
        !!(g._cityKillDetail && g._cityKillDetail.ped === R.target);
      if (mine && d >= SNIPER_RANGE) {
        con.bonus = Math.round(con.pay * 0.4 / 50) * 50;
        pay += con.bonus;
      }
    }
    award(pay, "Open contract " + n);
    const doneCount = n;
    const rankBefore = prestigeTitle(n - 1), rankAfter = prestigeTitle(doneCount);
    notify("personal", cHandler(), "Contract " + n + " settled — $" + pay.toLocaleString() +
      (con && con.bonus ? " (fieldcraft bonus included)" : "") + ". Standing: " + rankAfter + ".");
    if (rankAfter !== rankBefore) notify("personal", cHandler(), "The network has a new word for you: " + rankAfter.toUpperCase() + ". Rates follow reputation.");
    if (con) {
      const pool = ARCH_NEWS[con.type] || ARCH_NEWS.classic;
      notify("news", "CITY DESK", pool[(con.newsIdx * pool.length) | 0]);
    }
    c.contractNo = n + 1;
    commit();
    // Settle beat: clear the mark, hold a short rest so the kill can breathe,
    // then stage the next assignment (activatePhase re-runs stageEndless).
    if (con && con.car) unseatContractCar(false);
    if (R.marker) { disposeProp(R.marker); R.marker = null; R.markerTarget = null; R.markerPoint = null; }
    R.kind = "endless_rest";
    R.transitionT = 6.5;
    setMission({
      id: "contract-settled-" + n,
      title: "PAYMENT CLEARED",
      briefing: "Contract " + n + " is settled and the fee has landed. The next name is already being pulled.",
      status: "complete",
      prestige: prestigeLine(c, n + 1),
      objectives: [{ id: "done", text: "Await the next contract", done: false }],
    });
  }

  function tickEndlessRest(dt) {
    fireTakeoverMoment();
    R.transitionT -= dt;
    if (R.transitionT <= 0) activatePhase(true);
  }

  // ============================================================
  //  CITY BOSS — the gang-game win becomes a real campaign moment.
  //
  //  turf.js → story.js cityWin("takeover") used to end the entire ambient
  //  gang game with one silent phone bulletin (city.big is rerouted into the
  //  handset while the campaign runs). story.js now grants the material
  //  rewards and routes the CEREMONY here: a full-screen CITY BOSS card plus
  //  slow-mo in endless free time, or a queued moment that fires the instant
  //  a scripted beat hands the street back. flags.cityBoss is permanent
  //  campaign state and rides every prestige line afterward.
  // ============================================================
  function fireTakeoverMoment() {
    const c = state();
    if (!c.flags.takeoverPending || c.flags.takeoverShown) return;
    if (g.mode !== "city" || g.state !== "playing") return;
    c.flags.takeoverPending = false;
    c.flags.takeoverShown = true;
    commit();
    if (CBZ.doSlowmo) { try { CBZ.doSlowmo(0.45); } catch (e) {} }
    const ui = UI();
    if (ui && ui.takeover) {
      ui.takeover({
        title: "CITY BOSS",
        sub: "EVERY BLOCK FLIES YOUR COLORS",
        body: "The takeover is complete. The crews answer to you now — the contracts keep coming, but from tonight the city itself is yours.",
      });
    } else if (CBZ.flashToast && CBZ.flashToast._campaignOriginal) {
      try { CBZ.flashToast._campaignOriginal("CITY BOSS — YOU OWN THE CITY"); } catch (e) {}
    }
    say(cHandler(), "The whole map answers to you now. That does not cancel the list.", 4.6);
  }

  CBZ.cityCampaignTakeover = function (how) {
    if (!active()) return false;   // legacy slow-mo + big-text path in story.js
    const c = state();
    if (c.flags.cityBoss) return true;
    c.flags.cityBoss = true;
    c.flags.takeoverPending = true;
    c.flags.takeoverShown = false;
    c.flags.takeoverHow = how || "takeover";
    commit();
    notify("news", "CITY DESK", "Street sources say every crew in the city now answers to a single organization. Nobody will print the name.");
    // In endless free time the ceremony fires this frame; mid-script it waits
    // for the next endless tick instead of interrupting an authored beat.
    if (c.phase === PHASE.ENDLESS && g.mode === "city" && g.state === "playing") fireTakeoverMoment();
    return true;
  };

  // ---- composition reads for siblings (scenedirector.js, campaign_ui.js) ----
  CBZ.cityCampaignInEndless = function () {
    return active() && g.mode === "city" && state().phase === PHASE.ENDLESS;
  };
  CBZ.cityCampaignScenesBlocked = function () {
    if (!active()) return false;
    if (CFG.CAMPAIGN_AMBIENT_SCENES === false) return true;
    return !(g.mode === "city" && state().phase === PHASE.ENDLESS);
  };
  CBZ.cityCampaignContractPoint = function () {
    if (!active() || (R.kind !== "endless" && R.kind !== "endless_rest")) return null;
    if (R.markerTarget && R.markerTarget.pos) return { x: R.markerTarget.pos.x, z: R.markerTarget.pos.z };
    if (R.markerPoint) return { x: R.markerPoint.x, z: R.markerPoint.z };
    const con = R.contract;
    return con && con.point ? { x: con.point.x, z: con.point.z } : null;
  };

  function activatePhase(force) {
    if (!active()) return;
    const c = state();
    const key = g.mode + ":" + c.phase;
    if (!force && R.key === key) return;
    cleanupRuntime();
    R.key = key;
    if (g.mode === "escape") {
      if (openingPrisonPhase(c.phase)) prisonMission();
      else detentionMission();
      return;
    }
    if (g.mode !== "city") return;
    if (c.phase === PHASE.DROP) stagePrologue();
    else if (c.phase === PHASE.PRISON || c.phase === PHASE.PRISON_ESCAPE || c.phase === PHASE.PRISON_SPY_EXIT) {
      // A persisted prison checkpoint was launched from the canonical city
      // title. Switch only after startRun reaches playing so state.js can finish.
      R.kind = "return_to_prison";
    }
    else if (c.phase === PHASE.SPY_INSERTION) stageSpyInsertion();
    else if (c.phase === PHASE.SPY_INTEL) stageSpyIntel();
    else if (c.phase === PHASE.STUDIO_ONE) stageStudio(1);
    else if (c.phase === PHASE.STUDIO_TWO) stageStudio(2);
    else if (c.phase === PHASE.FAMILY) stageFamilyHostage();
    else if (c.phase === PHASE.AIRPORT) stageAirportArrival();
    else if (c.phase === PHASE.AIRPORT_CHOICE) showAirportChoice();
    else if (c.phase === PHASE.AIRPORT_COMPLY) stageAirportComply();
    else if (c.phase === PHASE.AIRPORT_REFUSE) stageAirportRefuse();
    else if (c.phase === PHASE.RECKONING) stageReckoning();
    else { c.phase = PHASE.ENDLESS; stageEndless(); }
  }

  function update(dt) {
    if (!active() || g.state !== "playing") return;
    activatePhase(false);
    if (R.dialogueT > 0) {
      R.dialogueT -= dt;
      if (R.dialogueT <= 0 && (!UI() || !UI().state || !(UI().state().dialogue && UI().state().dialogue.choices.length))) clearDialogue();
    }
    updateMarker();
    if (R.kind === "return_to_prison") { goToPrison(); return; }
    if (g.mode === "escape") { tickPrison(dt); return; }
    if (g.mode !== "city") return;
    if (R.kind === "prologue") tickPrologue(dt);
    else if (R.kind === "spy_insertion") tickSpyInsertion(dt);
    else if (R.kind === "spy_intel") tickSpyIntel(dt);
    else if (R.kind === "studio_one" || R.kind === "studio_two") tickStudio();
    else if (R.kind === "family") tickFamily();
    else if (R.kind === "airport_arrival") tickAirportArrival();
    else if (R.kind === "airport_comply") tickAirportComply(dt);
    else if (R.kind === "airport_refuse") tickAirportRefuse();
    else if (R.kind === "reckoning") tickReckoning();
    else if (R.kind === "endless") tickEndless(dt);
    else if (R.kind === "endless_rest") tickEndlessRest(dt);
  }

  // Presentation pass after police/ped movement: the prologue squad is an
  // authored rooftop cordon, so ordinary street navigation must not pull it
  // through the tower to ground level. Markers also finish on the actor's final
  // position for the frame.
  function presentCampaign() {
    if (!active() || g.state !== "playing") return;
    if (R.kind === "prologue" && R.pad) {
      for (let i = 0; i < R.swat.length; i++) {
        const cop = R.swat[i];
        if (!cop || cop.dead || !cop.pos) continue;
        cop.pos.set(cop._campaignRoofX, R.pad.y + 0.05, cop._campaignRoofZ);
        if (cop.group) cop.group.position.copy(cop.pos);
      }
    }
    // Truman-show staging: actors outside the player's observation bubble hold
    // their authored mark instead of simulating an unrelated life. Once the
    // player arrives they rejoin normal physics/combat; hostile roles acquire the
    // real player actor rather than resolving through a scripted timer.
    for (let i = 0; i < R.actors.length; i++) {
      const actor = R.actors[i];
      if (!actor || actor.dead || !actor.pos || !actor._campaignAnchor) continue;
      const d = distTo(actor.pos.x, actor.pos.z);
      if (actor._campaignHold || d > 72) {
        const a = actor._campaignAnchor;
        actor.pos.set(a.x, floorY(a.x, a.z), a.z);
        if (actor.group) actor.group.position.copy(actor.pos);
        if (actor.target && actor.target.set) actor.target.set(a.x, 0, a.z);
        actor.state = "idle"; actor.pause = 2; actor.path = null; actor.rage = null;
      } else if (actor._campaignHostile && d < 38 && CBZ.city && CBZ.city.playerActor) {
        actor.rage = CBZ.city.playerActor;
        actor.state = "fight";
        actor.pause = 0;
      }
    }
    updateMarker();
  }

  // ---- prison interaction seam --------------------------------------------
  CBZ.cityCampaignPrisonVerbs = function (actor) {
    if (!active() || g.mode !== "escape" || !actor || actor.kind !== "warden") return null;
    const c = state();
    if (c.phase === PHASE.PRISON && !c.branch) return ["campaign-spy", "campaign-escape"];
    return null;
  };
  CBZ.cityCampaignPrisonLabel = function (actor, verb) {
    if (!actor || actor.kind !== "warden") return null;
    if (verb === "campaign-spy") return "Take the deal — work as the warden's spy";
    if (verb === "campaign-escape") return "Refuse him — escape on your own";
    return null;
  };
  CBZ.cityCampaignPrisonSub = function (actor, verb) {
    if (!actor || actor.kind !== "warden") return null;
    if (verb === "campaign-spy") return "the door opens · the leash stays";
    if (verb === "campaign-escape") return "no mission fails · the manhunt follows";
    return null;
  };
  CBZ.cityCampaignPrisonAct = function (verb, actor) {
    if (!active() || !actor || actor.kind !== "warden") return null;
    const locked = state();
    // Key repeat, a stale interaction card, or a direct API call cannot reverse
    // the answer after either branch has been committed.
    if (locked.branch || locked.phase !== PHASE.PRISON) return { handled: true, locked: true };
    if (verb === "campaign-spy") {
      const c = locked;
      c.branch = "spy"; c.phase = PHASE.PRISON_SPY_EXIT; c.chapter = 2;
      commit();
      setMission({
        id: "the-offer",
        title: "THE OFFER",
        briefing: "You took the deal. The warden opens the door and owns the first name on your phone.",
        location: "Cell Block Z",
        status: "active",
        objectives: [{ id: "leave", text: "Leave under the warden's protection", done: false }],
      });
      say("WARDEN", "Good. Your family stays breathing as long as my targets stop.", 3.2, actor);
      R.kind = "prison"; R.transitionT = 3.0; R.key = g.mode + ":" + c.phase;
      return { handled: true };
    }
    if (verb === "campaign-escape") {
      const c = locked;
      c.branch = "rogue"; c.phase = PHASE.PRISON_ESCAPE;
      commit();
      setMission({
        id: "break-out",
        title: "BREAK OUT",
        briefing: "You refused the warden. Find a keycard, a tunnel, a friend, or a weakness in the gate. Any real escape advances the story.",
        location: "Cell Block Z",
        status: "active",
        objectives: [{ id: "escape", text: "Escape the prison", done: false }],
      });
      say("WARDEN", "Then run. Every camera outside already knows your face.", 3.0, actor);
      R.key = g.mode + ":" + c.phase;
      return { handled: true };
    }
    return null;
  };

  CBZ.cityCampaignChoose = function (id) {
    id = String(id || "").toLowerCase();
    const c = state();
    if (id === "comply" && c.phase === PHASE.AIRPORT_CHOICE) {
      c.flags.airportChoice = "comply";
      recordPhase(PHASE.AIRPORT_COMPLY);
      activatePhase(true);
      return true;
    }
    if (id === "refuse" && c.phase === PHASE.AIRPORT_CHOICE) {
      c.flags.airportChoice = "refuse";
      recordPhase(PHASE.AIRPORT_REFUSE);
      activatePhase(true);
      return true;
    }
    if ((id === "spy" || id === "campaign-spy") && c.phase === PHASE.PRISON && !c.branch) {
      return !!CBZ.cityCampaignPrisonAct("campaign-spy", wardenActor());
    }
    if ((id === "escape" || id === "campaign-escape") && c.phase === PHASE.PRISON && !c.branch) {
      return !!CBZ.cityCampaignPrisonAct("campaign-escape", wardenActor());
    }
    return false;
  };

  // ---- integration: origin retirement, city reset, escape completion -------
  const originalOriginApply = CBZ.cityOriginApply;
  CBZ.cityOriginApply = function (game) {
    if (active()) return { introActive: false, campaign: true };
    return originalOriginApply ? originalOriginApply.apply(this, arguments) : null;
  };
  const originalOriginActive = CBZ.cityOriginIntroActive;
  CBZ.cityOriginIntroActive = function () {
    if (active()) return false;
    return originalOriginActive ? originalOriginActive() : false;
  };
  const originalOriginOpts = CBZ.cityOriginIntroOpts;
  CBZ.cityOriginIntroOpts = function () {
    if (active()) return null;
    return originalOriginOpts ? originalOriginOpts() : null;
  };

  const originalStartIntro = CBZ.startIntro;
  CBZ.startIntro = function () {
    if (active() && g.mode === "city") return;
    if (originalStartIntro) return originalStartIntro.apply(this, arguments);
  };

  const cityMode = CBZ.modes && CBZ.modes.city;
  if (cityMode && cityMode.reset && !cityMode.reset._campaignWrapped) {
    const baseReset = cityMode.reset;
    const wrappedReset = function (game) {
      const out = baseReset.apply(this, arguments);
      if (active()) {
        if (g.cityCampaignPending) CBZ.cityCampaignRestore(g.cityCampaignPending);
        state();
        g.cityJob = null; g.cityGig = null; g.cityHeist = null; g.cityActivity = null;
        // worldstate may have restored a legacy sandbox arsenal after mode.js's
        // initial campaign loadout pass. Reassert the authored kit at the final
        // reset seam so the opening is a hitman story, not an RPG test bench.
        if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
        if (CBZ.unlockWeapon) CBZ.unlockWeapon("sidearm", { select: true });
        if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();
        if (CBZ.fpsAddAmmo) CBZ.fpsAddAmmo(48, "sidearm");
        if (CBZ.setFPS) CBZ.setFPS(false);
        R.key = "";
        activatePhase(true);
      }
      return out;
    };
    wrappedReset._campaignWrapped = true;
    cityMode.reset = wrappedReset;
  }

  // Sniper fieldcraft attribution: stamp player kills on the body itself.
  // g._cityKillDetail is consumed + nulled SYNCHRONOUSLY by promotion.js's
  // addKill wrapper, so a poll one frame later (tickEndless) never sees it.
  // campaign.js is the last-loaded script; the wrap preserves every earlier one.
  if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._campaignWrapped) {
    const baseKillPed = CBZ.cityKillPed;
    const wrappedKillPed = function (ped, imp, cause) {
      if (ped && !ped.dead) ped._campaignKilledByPlayer = imp ? imp.byPlayer !== false : true;
      return baseKillPed.apply(this, arguments);
    };
    wrappedKillPed._campaignWrapped = true;
    CBZ.cityKillPed = wrappedKillPed;
  }

  const originalWinGame = CBZ.winGame;
  CBZ.winGame = function (reason, actor) {
    if (active() && g.mode === "escape") {
      const c = state();
      const resumePhase = openingPrisonPhase(c.phase) ? null : c.phase;
      if (!c.branch) c.branch = "rogue";
      if (CBZ.cityEvent) {
        try { CBZ.cityEvent("jail-escape", { respect: 4, panic: 2 }, { noWanted: true, silent: true }); } catch (e) {}
      }
      leavePrisonForCity(c.branch, resumePhase);
      return;
    }
    if (originalWinGame) return originalWinGame.apply(this, arguments);
  };

  if (g.cityCampaignPending) CBZ.cityCampaignRestore(g.cityCampaignPending);
  state();
  // The scene director is no longer hard-disabled here: scenedirector.js asks
  // CBZ.cityCampaignScenesBlocked() per tick, so ambient set-pieces run during
  // ENDLESS free time (CFG.CAMPAIGN_AMBIENT_SCENES) and stay silent through
  // every scripted beat. CITY_SCENE_DIRECTOR itself remains the master switch.
  if (CBZ.onUpdate) CBZ.onUpdate(36.85, update);
  if (CBZ.onUpdate) CBZ.onUpdate(99.1, presentCampaign);
})();
