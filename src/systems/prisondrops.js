/* ============================================================
   systems/prisondrops.js — WHAT A DEAD MAN LEAVES ON THE FLOOR.

   OWNER, verbatim: "gang city also has when someone dies things they drop
   are the actual things for guns."

   Gang city has had this since city/morgue.js: one drop routine at the kill
   choke point, the dead man's ACTUAL weapon becomes a physical model lying
   where he fell, and you walk to it. The prison had none of it. A prison
   death paid out two ways and neither of them was an object:

     (1) a PLAYER kill called CBZ.econ.lootActor(victim) — the whole man's
         pockets teleported into your bag the instant he hit the ground, and
         announced themselves with a full-screen red shout;
     (2) an NPC-vs-NPC kill called CBZ.addPack() — a generic 6-cigarette
         stash, identical whether the dead man was the Warden carrying the
         gun-room key or a pacifist carrying a bar of soap.

   Neither is a thing you can SEE, and that is the whole complaint. So:
   ONE routine, CBZ.prisonDrop(actor), called from ai.js's kill() — the
   choke point EVERY prison death already funnels through (combat.js's
   execute, fpsmode's takedown, capture.js, killstreaks' nuke, and the
   internal down()/exchangeBlows brawl deaths all call CBZ.aiKill). That is
   morgue.js's lesson copied exactly: hook the choke point once, not the
   nine callers.

   IT AUTHORS NO LOOT TABLE. The table is systems/economy.js's rollLoadout()
   — the one that already knows a warden carries the gun-room key and a
   dealer carries product. The ROLL against it is economy.js's rollDrops(),
   which CONSUMES, so a body can never pay out twice: this file takes the
   pockets physically and the frisk that used to run one line later in
   ai.js finds an already-looted body and returns null. That is the
   migration, and it is why nothing in ai.js had to be deleted.

   IT DRAWS NO GUN. CBZ.buildActorWeapon (systems/actorweapons.js) owns
   every firearm model in this game and CBZ.weaponPhysics owns how a
   released one falls, tumbles, bounces off a wall and comes to rest on its
   measured lowest vertex. A dropped pistol here is that model under that
   solver. The small stuff (a key card, a carton, a watch) gets a compact
   local ballistic instead, for one reason worth writing down: weaponPhysics
   settles a body onto its SIDE because that is what a firearm does, and a
   playing-card-shaped keycard resting on its edge would be wrong.

   IT OWNS NO LIFECYCLE. systems/proptypes.js is the registry for exactly
   this shape of object (spawn → animate → proximity-react → despawn) and
   has sat at ONE consumer (entities/coins.js) since the day it shipped.
   This is the second: one registerPropType, one spawnProp per item, and
   the reap/dispose/mode-gate come free.

   Flag: PRISON_DROPS_V1 (one-line revert — the old invisible frisk comes
   straight back, because nothing in ai.js was removed to make room).
   Ratchet: CBZ.prisonDropAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};
  const C = CBZ.CONFIG;
  if (C.PRISON_DROPS_V1 == null) C.PRISON_DROPS_V1 = true;
  // Separately revertible because it is the one part keyed to ANOTHER file's
  // solver: off, a dropped gun falls through the local ballistic below instead
  // of CBZ.weaponPhysics, and everything else is unchanged.
  if (C.PRISON_DROPS_PHYSICS == null) C.PRISON_DROPS_PHYSICS = true;

  // ---- the numbers, and why -------------------------------------------------
  const CAP = 24;            // live drops. A bad yard brawl leaves 6-10; 24 is
                             // two full multi-body scenes and still 3 meshes each.
  const TTL = 90;            // s a drop survives — but the clock (d.far) only
                             // runs while you are NOT standing over it.
  const KEEP_R = 30;         // m. Inside this, a drop never ages out. You can
                             // not have a thing blink out from under your feet.
  const KEEP_R2 = KEEP_R * KEEP_R;
  const EVICT_R2 = 12 * 12;  // the cap prefers to evict something far away
  // Floor loot is collected only when the player's feet actually cross it.
  // One close radius for every shape: no long invisible reach and no pickup UI.
  const AUTO_R = 1.15;       // m — tight walk-over radius for every floor item
  const BLINK = 1.6;         // s of flicker before an expired drop is gone
  const GRAV = 19.0;         // m/s² for the small-prop ballistic
  const SPAWN_Y = 1.06;      // m — pockets are at the chest, not at the feet

  // ---- audit counters -------------------------------------------------------
  let spawned = 0, taken = 0, expired = 0, evicted = 0, bodies = 0, gunsDropped = 0, torchesDropped = 0;
  // guns that reached an inmate's hand off the floor (PRISON_GUN_PROVENANCE)
  let npcArmed = 0;

  function floorY(x, z, fromY) {
    if (CBZ.groundAt) { const y = CBZ.groundAt(x, z, fromY); if (isFinite(y)) return y; }
    if (CBZ.floorAt) { const y = CBZ.floorAt(x, z); if (isFinite(y)) return y; }
    return 0;
  }

  // ONE quiet line. Never a toast: see economy.js's announceLoot for the
  // owner's ruling on the red shout this replaces. hud.js's feed renders the
  // count itself ("Cigarettes ×12") and collapses repeats, so the number goes
  // in opts.count and never into the name as well.
  function note(name, rare, count) {
    if (CBZ.pickupNote) { CBZ.pickupNote(name, { rare: !!rare, count: count || 1 }); return; }
    CBZ.flashHint && CBZ.flashHint((count > 1 ? count + "× " : "") + name, 1.3);
  }

  /* ============================================================
     SHAPES — a drop is the REAL object, the one in the trade table.

     A gun, the guard's torch and the shank are the authored weapon models
     (CBZ.buildActorWeapon / CBZ.buildFlashlight), stripped of their hand pose
     and laid on the shared measured-rest solver. EVERYTHING ELSE is the item's
     own model from city/itemassets.js — the pack of cigarettes, the flip
     phone, the brass knuckles, the bag of pruno — at its real size, which is
     also exactly what its icon is a photograph of. This file used to draw its
     own two-box stand-ins per tag (a "card" for a phone, a "pouch" cube for
     anything it had no row for): the cubes the owner asked about.
     ============================================================ */
  const cmat = function (c, o) { return CBZ.cmat ? CBZ.cmat(c, o) : new THREE.MeshLambertMaterial({ color: c }); };
  const bgeo = function (w, h, d) {
    if (CBZ.boxGeom) return CBZ.boxGeom(w, h, d);
    const g = new THREE.BoxGeometry(w, h, d); g._shared = true; return g;
  };
  function put(parent, geo, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  // the three things that ride the weapon rest solver; everything else is "item"
  const RIGID_BY_NAME = { "Gun": "gun", "Rifle": "gun", "Guard Torch": "torch", "Shiv": "shank", "Shank": "shank" };
  function shapeOf(name) { return RIGID_BY_NAME[name] || "item"; }
  function rigidShape(shape) { return shape === "gun" || shape === "torch" || shape === "shank"; }

  // An item asset, centred on its own bounds so the ballistic below can spin
  // it about its middle and rest it on its measured half-height.
  function centred(obj) {
    const g = new THREE.Group();
    g.add(obj);
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    if (!isFinite(b.min.x)) return { mesh: g, hh: 0.03, r: 0.08 };
    obj.position.x -= (b.min.x + b.max.x) / 2;
    obj.position.y -= (b.min.y + b.max.y) / 2;
    obj.position.z -= (b.min.z + b.max.z) / 2;
    const hh = Math.max(0.004, (b.max.y - b.min.y) / 2);
    const r = Math.max(0.04, Math.min(0.16, Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2));
    return { mesh: g, hh: hh, r: r };
  }
  function itemModel(name) {
    let o = null;
    try { o = CBZ.itemAssetPickup ? CBZ.itemAssetPickup(name, null, null) : null; } catch (e) { o = null; }
    return o;
  }

  // Each builder returns { mesh, hh, r } — hh is the half-height it rests on,
  // r the collision radius for the ballistic.
  function buildShape(shape, name) {
    const g = new THREE.Group();
    let hh = 0.07, r = 0.12;
    if (shape === "gun") {
      // THE CANONICAL MODEL, NEVER A NEW ONE. buildActorWeapon owns every
      // firearm in this game; this wrapper exists only so the drop has one
      // transform of its own to fall and to fade with. The build ships a
      // HAND-SOCKET pose (holsterprops.js overwrites the same three lines for
      // its body mounts) — a gun on the floor wants none of it.
      if (CBZ.buildActorWeapon) {
        const model = CBZ.buildActorWeapon(name);
        model.position.set(0, 0, 0);
        model.rotation.set(0, 0, 0);
        // REAL-DIMENSION SIZING (weapons/weapon-scale.js): the floor is world
        // space, so the world scalar applies directly.
        model.scale.setScalar((CBZ.weaponWorldScale && CBZ.weaponWorldScale(name)) || 1.05);
        g.add(model);
      } else {
        put(g, bgeo(0.10, 0.06, 0.30), cmat(0x30363f), 0, 0, 0);   // no actorweapons.js loaded
      }
      hh = 0.05; r = 0.13;
    } else if (shape === "torch") {
      // The exact held model, with the hand-socket rotation removed.
      if (CBZ.buildFlashlight) {
        const model = CBZ.buildFlashlight({ lit: false });
        model.position.set(0, 0, 0);
        model.rotation.set(0, 0, 0);
        model.scale.setScalar(1.08);
        g.add(model);
      } else {
        put(g, bgeo(0.11, 0.11, 0.44), cmat(0x20262d), 0, 0, 0);
      }
      hh = 0.055; r = 0.12;
    } else if (shape === "shank") {
      // the AUTHORED shank, hand-socket pose stripped: the same blade that
      // was in his fist a second earlier.
      if (CBZ.buildActorWeapon) {
        const model = CBZ.buildActorWeapon("Shiv");
        model.position.set(0, 0, 0);
        model.rotation.set(0, 0, 0);
        model.scale.setScalar((CBZ.weaponWorldScale && CBZ.weaponWorldScale("Shiv")) || 1.05);
        g.add(model);
      } else {
        put(g, bgeo(0.035, 0.02, 0.26), cmat(0xb9c2cc), 0, 0.005, 0.10);
      }
      hh = 0.018; r = 0.10;
    } else {
      const o = itemModel(name);
      if (o) return centred(o);
      put(g, bgeo(0.10, 0.04, 0.14), cmat(0x5a5347), 0, 0, 0);       // no itemassets.js loaded
      hh = 0.02; r = 0.08;
    }
    return { mesh: g, hh: hh, r: r };
  }

  // The cigarettes a body is carrying land as packs, not N loose props: one
  // pack under a full pack's worth (20), two lying together from 20 up.
  function buildCigs(n) {
    const g = new THREE.Group();
    const a = itemModel("Cigarettes");
    if (!a) { put(g, bgeo(0.055, 0.022, 0.088), cmat(0xf4f1ea), 0, 0, 0); return { mesh: g, hh: 0.011, r: 0.06 }; }
    a.rotation.x = -Math.PI / 2;                 // a dropped pack lies on its back
    g.add(a);
    if (n >= 20) {
      const b = itemModel("Cigarettes");
      if (b) { b.rotation.set(-Math.PI / 2, 0, 0.5); b.position.set(0.05, 0, 0.03); g.add(b); }
    }
    return centred(g);
  }

  /* ============================================================
     THE PROP TYPE — proptypes.js's second consumer.
     ============================================================ */
  const live = [];             // spawn-ordered, for the cap

  function planarD2(inst) {
    const P = CBZ.player;
    if (!P || !P.pos) return Infinity;
    const dx = P.pos.x - inst.pos.x, dz = P.pos.z - inst.pos.z;
    return dx * dx + dz * dz;
  }

  function stepBallistic(d, dt) {
    // A compact free-fall for the small props: gravity, walls, up to two
    // bounces, then lie FLAT (keeping the tumble's yaw so two drops from one
    // body never form a copied row). Guns do not come through here — they
    // ride CBZ.weaponPhysics, which rests a firearm on its side instead.
    const m = d.mesh;
    let steps = Math.max(1, Math.min(4, Math.ceil(Math.abs(d.vy) * dt / 0.22)));
    const sdt = dt / steps;
    for (let i = 0; i < steps && !d.rest; i++) {
      d.vy -= GRAV * sdt;
      m.position.x += d.vx * sdt;
      m.position.y += d.vy * sdt;
      m.position.z += d.vz * sdt;
      m.rotation.x += d.wx * sdt; m.rotation.y += d.wy * sdt; m.rotation.z += d.wz * sdt;
      if (CBZ.collide) {
        const ox = m.position.x, oz = m.position.z;
        CBZ.collide(m.position, d.r, m.position.y - d.hh, m.position.y + d.hh);
        if (Math.abs(m.position.x - ox) > 1e-5) d.vx *= -0.3;
        if (Math.abs(m.position.z - oz) > 1e-5) d.vz *= -0.3;
      }
      const fy = floorY(m.position.x, m.position.z, m.position.y + 0.4);
      if (m.position.y - d.hh <= fy && d.vy <= 0) {
        const impact = -d.vy;
        m.position.y = fy + d.hh;
        if (impact > 1.5 && d.bounces < 2) {
          d.bounces++;
          d.vy = impact * (d.bounces === 1 ? 0.26 : 0.12);
          d.vx *= 0.55; d.vz *= 0.55;
          d.wx *= 0.5; d.wy *= 0.6; d.wz *= 0.5;
        } else {
          d.rest = true;
          m.rotation.set(0, m.rotation.y, 0);      // lie flat, keep the yaw
          m.position.y = fy + d.hh;
          // A crate landing in the yard is somebody else's sound: it has a
          // position, so it gets one. This was global — a drop 90 m away
          // clattered at full volume in your ear like it had landed at
          // your feet. `ref` is short because a small metal knock is quiet.
          if (impact > 1.0 && CBZ.worldSfx) {
            try { CBZ.worldSfx("shell", m.position.x, m.position.z, { y: m.position.y, ref: 6 }); } catch (e) {}
          }
        }
      }
      const drag = Math.pow(0.986, sdt);
      d.vx *= drag; d.vz *= drag;
      d.age2 += sdt;
      if (d.age2 > 3.5 && !d.rest) {
        d.rest = true;
        const fy2 = floorY(m.position.x, m.position.z, m.position.y + 0.4);
        m.rotation.set(0, m.rotation.y, 0);
        m.position.y = fy2 + d.hh;
      }
    }
  }

  function grant(d) {
    if (d.cigs > 0) { CBZ.econ && CBZ.econ.addCigs(d.cigs); note("Cigarettes", false, d.cigs); CBZ.sfx && CBZ.sfx("coin"); return; }
    CBZ.econ && CBZ.econ.addItem && CBZ.econ.addItem(d.item, 1);
    note(d.item, CBZ.econ && CBZ.econ.isRare ? CBZ.econ.isRare(d.item) : false, 1);
    CBZ.sfx && CBZ.sfx(rigidShape(d.shape) ? "equip" : "pickup");
  }

  /* TAKEN WITH A HAND (systems/verbs_pickup.js), by you or by an inmate: the
     body bends to it, the hand closes on it and it leaves the floor in the
     hand. What it grants lands on the grab frame and the prop goes back to the
     registry then. (It used to rise 0.65 m on its own and shrink to nothing:
     a thing leaving the floor with no hand under it.) */
  function releaseBody(d) {
    // hand the model back from the shared gun solver before a hand moves it
    if (d.body && CBZ.weaponPhysics && CBZ.weaponPhysics.release) {
      try { CBZ.weaponPhysics.release(d.mesh); } catch (e) {}
      d.body = null;
    }
  }
  function handTake(who, inst, d, then) {
    d.taken = true;
    releaseBody(d);
    const took = function () {
      then();
      CBZ.removeProp && CBZ.removeProp(inst);
      dropGone(inst);
    };
    const kind = d.cigs > 0 ? "card" : (rigidShape(d.shape) ? "grip" : "card");
    if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(who, d.mesh, { pose: kind, keep: d.item === "Gun" || d.item === "Rifle" || d.item === "Taser", onTaken: took });
    else took();
  }
  function takeDrop(inst) {
    const d = inst.data;
    if (d.taken) return;
    handTake(CBZ.player, inst, d, function () { grant(d); taken++; });
  }

  if (CBZ.registerPropType) CBZ.registerPropType({
    id: "prisondrop",
    modes: ["escape"],
    build: function (pos, opts) {
      const built = opts.cigs > 0 ? buildCigs(opts.cigs) : buildShape(opts.shape, opts.item);
      const m = built.mesh;
      m.userData.dynamic = true;
      m.position.set(pos.x, pos.y, pos.z);
      m.rotation.set(Math.random() * 6.283, Math.random() * 6.283, Math.random() * 6.283);
      return {
        mesh: m, radius: AUTO_R,
        data: {
          mesh: m, item: opts.item || "", cigs: opts.cigs || 0, shape: opts.shape,
          hh: built.hh, r: built.r,
          vx: opts.vx, vy: opts.vy, vz: opts.vz,
          wx: (Math.random() - 0.5) * 9, wy: (Math.random() - 0.5) * 7, wz: (Math.random() - 0.5) * 9,
          bounces: 0, rest: false, age2: 0, far: 0, taken: false,
          life: TTL,           // s of far-clock before it goes; Infinity = never (placed / planted)
          body: null, inst: null,
        },
      };
    },
    onUpdate: function (dt, inst) {
      const d = inst.data;
      const m = d.mesh;

      // TAKEN: a hand has it (handTake above); the registry gets the instance
      // back on the grab frame, which disposes it (every geometry/material
      // here is _shared, so nothing another drop is using is freed).
      if (d.taken) return;

      // PHYSICS. A gun is driven by the shared weapon solver (its body is a
      // record in actorweapons.js, ticked at 37.45); everything else falls
      // through the compact local solve above. Either way inst.pos tracks the
      // model — proptypes.js fixes inst.pos at spawn and a falling thing moves.
      if (d.body) {
        // the solver hands the model back the moment it comes to rest; from
        // then on the drop IS at rest and must not be re-integrated by us. Keep
        // the body reference while settled: the shared solver continues corpse
        // contact, and pickup can release that tracking immediately.
        if (d.body.dead) { d.body = null; d.rest = true; }
        else if (d.body.settled) d.rest = true;
      } else if (!d.rest) {
        stepBallistic(d, Math.min(0.05, dt));
      }
      inst.pos.set(m.position.x, m.position.y, m.position.z);

      // LIFETIME. The clock only runs while you are far away — morgue.js's
      // witness law applied to loot. A thing lying at your feet never blinks
      // out; a shiv dropped in a brawl on the far side of the yard does.
      // `life` is the per-drop budget: TTL for loot, Infinity for anything
      // placed in the world (prisonPlaceItem) or planted by a system (the
      // warden's favour shiv). It used to be written and never read, so a
      // tool on a workbench blinked out 90 s after you left the room.
      const d2 = planarD2(inst);
      if (d2 > KEEP_R2 && d.life !== Infinity) d.far += dt;
      if (d.far > d.life) {
        d.blink = (d.blink || 0) + dt;
        m.visible = Math.floor(d.blink * 7) % 2 === 0;
        if (d.blink > BLINK) { expired++; CBZ.removeProp && CBZ.removeProp(inst); dropGone(inst); }
        return;
      }

      // A DROP AT REST STAYS AT REST — no bob, no spin, no glow ring. OWNER's
      // standing note on glowing floor pickups is that they turn the game into
      // Subway Surfers; the object is the signal, and a settled body that goes
      // on rotating is not settled. Findability is the walk-over radius's job.

      // PROXIMITY. Every floor item uses the same close walk-over collection;
      // there is no reach prompt and no device-specific button. The lifetime
      // law above already needs this exact squared distance, so one measurement
      // owns both answers. You still cannot catch a thing in mid-air. Without
      // that guard, a
      // point-blank kill puts the pile inside the pickup radius on the frame
      // it spawns and the whole toss is swallowed — which is the invisible
      // frisk again, wearing a mesh.
      if (!d.rest) return;
      // cuffed (CBZ.arrest.playerCuffed): hands behind your back pick nothing up
      if (d2 <= AUTO_R * AUTO_R && !(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on())) { takeDrop(inst); return; }

      // A WEAPON ON THE FLOOR IS A WEAPON ANYONE CAN REACH.
      npcTakeWeapon(inst, d);
    },
  });

  /* ============================================================
     THE FLOOR IS NOT THE PLAYER'S PRIVATE INVENTORY.
     (PRISON_GUN_PROVENANCE — see systems/intimidate.js decideGun)

     OWNER: "they need to actually run over a dead person who has a gun."

     Inmates used to spawn holding concealed firearms from a dice roll. That
     roll is gone, so this is now the FIRST way a gun legitimately reaches an
     inmate's hand, and it reads on screen without a word: you shoot a guard,
     his sidearm hits the dirt, and the man who was watching walks over and
     picks it up. Nothing announces it. You were there.

     Deliberately narrow, because a floor the whole yard hoovers up is worse
     than one only the player can touch:
       · WEAPONS ONLY. Cigarettes, torches and the rest stay the player's.
         A gun is the one object whose owner changes the situation.
       · LIVE, FREE INMATES ONLY. Not the downed, not the cuffed, not guards
         (a screw who wants a gun already has one).
       · ALREADY-ARMED MEN DON'T STOOP. One is enough.
       · SAME WALK-OVER RADIUS the player uses, slightly widened for a body
         that has no camera to aim with. No second loot path, no reach prompt.
     The take routes through the same takeDrop bookkeeping, so the audit
     counters and the hand stay honest about where the object went.
     ============================================================ */
  const NPC_TAKE_R2 = (AUTO_R * 1.5) * (AUTO_R * 1.5);
  const ARMABLE = { "Gun": "Pistol", "Rifle": "Rifle", "Taser": "Taser" };

  function npcTakeWeapon(inst, d) {
    const want = ARMABLE[d.item];
    if (!want) return;                       // only a weapon changes hands
    const npcs = CBZ.npcs;
    if (!npcs || !npcs.length) return;
    const m = d.mesh;
    if (!m) return;
    const px = m.position.x, pz = m.position.z;
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (!n || !n.group || n.dead || n.escaped || (n.ko || 0) > 0) continue;
      if (n.hasGun || n.armed || n._pickingUp) continue;   // he already has one (or is picking one up)
      if (n.restraint || n.cuffed) continue;  // cuffed hands take nothing
      const dx = px - n.group.position.x, dz = pz - n.group.position.z;
      if (dx * dx + dz * dz > NPC_TAKE_R2) continue;
      n._pickingUp = true;
      handTake(n, inst, d, function () {
        n._pickingUp = false;
        if (n.dead) return;
        armNpc(n, want, d.item);
        taken++; npcArmed++;
      });
      return;
    }
  }

  /* Put the weapon in his hand for real. `weapon` + `armed` is the pair
     systems/actorweapons.js reads to build and show the carried model and to
     resolve a muzzle, and `hasGun` is what systems/intimidate.js reads when it
     decides whether a man at gunpoint surrenders or draws. Setting all three
     is what makes the pickup a fact about the world rather than a cosmetic. */
  function armNpc(n, weaponName, itemName) {
    n.weapon = weaponName;
    n.armed = true;
    n.hasGun = true;
    n._intimidInit = true;                   // his answer is no longer "unarmed"
    n._gunFrom = itemName === "Taser" ? "corpse:taser" : "corpse:gun";
    if (CBZ.econ && CBZ.econ.rollLoadout) {
      // reflect it into his loadout so a frisk or a takedown can yield the
      // same gun back — the object keeps moving, it never evaporates.
      const ld = CBZ.econ.rollLoadout(n);
      if (ld && ld.items && ld.items.indexOf(itemName) < 0) ld.items.push(itemName);
    }
    if (CBZ.buildActorWeapon) { try { CBZ.buildActorWeapon(n); } catch (e) {} }
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(n); } catch (e) {} }
    if (CBZ.worldSfx && n.group) {
      try { CBZ.worldSfx("switch", n.group.position.x, n.group.position.z, { ref: 10 }); } catch (e) {}
    }
  }
  // Exported so the armory and tailgate paths (world/gunroom.js) arm a man the
  // same way this does, instead of each growing its own version.
  CBZ.prisonArmNpc = armNpc;

  function dropGone(inst) {
    const i = live.indexOf(inst);
    if (i >= 0) live.splice(i, 1);
  }

  /* ============================================================
     CBZ.prisonDrop(actor, opts) — THE ONE DROP ROUTINE.

     ONE-LINE ADOPTION at a death site:  if (CBZ.prisonDrop) CBZ.prisonDrop(v);
     It REPLACES nothing the caller writes, because the caller's own payout
     line (ai.js's lootActor / addPack) is left standing and simply finds an
     empty body — so flipping PRISON_DROPS_V1 off restores the old behaviour
     exactly, with no code to put back.

     Idempotent per body (`_dropped`), so a second hook, a sweep or a
     re-entrant kill can all call it without duplicating the pile.
     ============================================================ */
  /* A POOLED RIG IS NOT ONE PERSON. entities/crowd.js recycles a handful of
     actor OBJECTS across the whole yard — assignRig re-stamps `_id`, the name
     and a fresh loadout onto the same object every time a distant inmate comes
     into face range. A plain boolean latch would therefore let the FIRST man
     who ever died on that rig silence every later one who wears it. Latch on
     the identity the pool itself stamps; a real named actor (CBZ.npcs /
     CBZ.guards) has no `_id` and a stable name, so its tag never changes and
     it still drops exactly once per run. */
  function dropTag(a) {
    return (a._id != null ? a._id : "n") + "|" + ((a.data && a.data.name) || "?");
  }

  CBZ.prisonDrop = function (actor, opts) {
    opts = opts || {};
    if (C.PRISON_DROPS_V1 === false) return 0;
    if (!actor) return 0;
    const tag = dropTag(actor);
    if (actor._dropped === tag) return 0;
    if (!CBZ.spawnProp || !CBZ.econ || !CBZ.econ.rollDrops) return 0;
    const g = CBZ.game;
    if (g && g.mode !== "escape") return 0;
    const grp = actor.group;
    if (!grp && opts.x == null) return 0;
    actor._dropped = tag;

    const got = CBZ.econ.rollDrops(actor);
    const cigs = got.cigs | 0;
    const items = got.items || [];
    if (!cigs && !items.length) return 0;

    const x = opts.x != null ? opts.x : grp.position.x;
    const z = opts.z != null ? opts.z : grp.position.z;
    const y = (opts.y != null ? opts.y : floorY(x, z, SPAWN_Y + 1)) + SPAWN_Y;
    bodies++;

    let n = 0;
    // scatter the pile: a small toss per item so the pockets empty ACROSS the
    // body instead of stacking into one z-fighting tower. Runtime FX, so
    // Math.random is the right generator here (no world-gen determinism).
    const spread = items.length + (cigs > 0 ? 1 : 0);
    const base = Math.random() * 6.283;
    let k = 0;
    const toss = function (item, nCigs) {
      const a = base + (k / Math.max(1, spread)) * 6.283 + (Math.random() - 0.5) * 0.7;
      const sp = 0.9 + Math.random() * 1.1;
      k++;
      if (!spawnDrop(item, nCigs, x, y, z, Math.sin(a) * sp, 1.4 + Math.random() * 1.1, Math.cos(a) * sp)) return;
      n++;
    };
    for (let i = 0; i < items.length; i++) toss(items[i], 0);
    if (cigs > 0) toss("", cigs);
    return n;
  };

  function spawnDrop(item, cigs, x, y, z, vx, vy, vz) {
    const shape = cigs > 0 ? "cigs" : shapeOf(item);
    enforceCap();
    const inst = CBZ.spawnProp("prisondrop", x, y, z, {
      item: item, cigs: cigs, shape: shape,
      vx: vx, vy: vy, vz: vz,
      parent: CBZ.prisonRoot || CBZ.scene,
    });
    if (!inst || !inst.data) return null;
    inst.data.inst = inst;
    live.push(inst);
    spawned++;

    // THE CANONICAL SOLVER FOR THE CANONICAL MODEL. weaponPhysics owns how a
    // released gun falls: it carries the throw velocity and spin, substeps
    // walls, bounces, and sets the model's MEASURED lowest vertex on the
    // highest support under its footprint. Never a second gun physics.
    // The mesh must already be parented for this — spawnProp did that above.
    if (rigidShape(shape)) {
      if (shape === "gun") gunsDropped++; else torchesDropped++;
      if (C.PRISON_DROPS_PHYSICS !== false && CBZ.weaponPhysics && CBZ.weaponPhysics.drop) {
        try {
          inst.data.body = CBZ.weaponPhysics.drop(inst.data.mesh, {
            vx: vx, vy: vy, vz: vz, source: "prison-drop", sound: "shell",
            corpseCollision: true,
          });
        } catch (e) { inst.data.body = null; }
      }
      // no solver (flag off / actorweapons.js absent) → the local ballistic
      // above takes it, which is why d.rest starts false for every drop.
    }
    return inst;
  }

  // THE CAP. Prefer to evict something you are nowhere near — yanking a pile
  // out of the room you are standing in to make space for one across the yard
  // is the wrong trade every time.
  // A PERMANENT drop (placed in the world, or planted with life = Infinity) is
  // not loot: it neither counts toward the cap nor is ever the one evicted.
  // The eleven cage/bench items alone used to fill half the cap, and a brawl
  // could evict the Lockpick off the tool-crib rack.
  function permanent(inst) { return !!(inst.data && (inst.data.world || inst.data.life === Infinity)); }
  function enforceCap() {
    let n = 0;
    for (let i = 0; i < live.length; i++) if (!permanent(live[i])) n++;
    if (n < CAP) return;
    let victim = null, oldest = null;
    for (let i = 0; i < live.length; i++) {
      const inst = live[i];
      if (inst.data.taken || permanent(inst)) continue;
      if (!oldest) oldest = inst;
      if (planarD2(inst) > EVICT_R2) { victim = inst; break; }   // oldest far one
    }
    if (!victim) victim = oldest;
    if (!victim) return;
    evicted++;
    CBZ.removeProp && CBZ.removeProp(victim);
    dropGone(victim);
  }

  /* ============================================================
     CBZ.prisonPlaceItem(item, x, y, z) — A THING LYING WHERE IT WOULD LIE.

     OWNER: "there's chests still for some reason." The doctrine behind that is
     the ITEM EXISTENCE TEST: an item must have a physical asset and the WORLD
     must be the inventory — "glowing floor pickups make it Subway Surfers",
     and a loot CONTAINER is the same sin one step removed. world/crates.js had
     five boxes you pried open for a payout; the crates were cover the yard
     genuinely needs, but the CHEST was a menu with a lid on it.

     Everything needed to answer that already lived in this file: a real prop
     instance, a real mesh, and the quiet walk-over pickup. The only thing
     missing was a way to place one that nobody had DIED for. That is this —
     the drop routine with no corpse.

     `world:true` marks it as a PLACED item rather than loot: it survives the
     new-run sweep below (a hacksaw on a workbench does not vanish because you
     restarted) and it never counts against the death-drop cap.
     ============================================================ */
  /* ONE ITEM, OUT OF A LIVING MAN'S HAND. `prisonDrop` above empties a CORPSE
     — it consumes the whole rolled loadout and is tagged `_dropped` so a body
     can only be emptied once. Neither is right for a man who is still standing
     and has just decided to let go of the thing he was holding, which is what
     a shiv hitting the concrete at gunpoint is. Same spawn, same physics, same
     walk-over pickup; one item, a small toss so it lands beside him rather than
     inside his shoes, and no corpse bookkeeping. */
  CBZ.prisonDropOne = function (item, x, y, z, opts) {
    opts = opts || {};
    if (!item || !CBZ.spawnProp) return null;
    const g = CBZ.game;
    if (g && g.mode !== "escape") return null;
    const a = opts.dir != null ? opts.dir : Math.random() * 6.283;
    const sp = opts.speed != null ? opts.speed : 0.55 + Math.random() * 0.5;
    return spawnDrop(item, 0, x, (y == null ? 0.9 : y) + SPAWN_Y, z,
      Math.sin(a) * sp, opts.up != null ? opts.up : 0.7, Math.cos(a) * sp);
  };

  const placed = [];
  CBZ.prisonPlaceItem = function (item, x, y, z) {
    if (!item) return null;
    for (let i = 0; i < placed.length; i++) {                 // idempotent per spot
      const p = placed[i];
      if (p.item === item && Math.abs(p.x - x) < 0.05 && Math.abs(p.z - z) < 0.05 && p.inst && !p.inst.data.taken) return p.inst;
    }
    const inst = spawnDrop(item, 0, x, y == null ? 0.12 : y, z, 0, 0, 0);
    if (!inst || !inst.data) return null;
    inst.data.world = true;
    inst.data.rest = true;                                    // it is ON the thing, not falling
    inst.data.life = Infinity;                                // a placed item does not despawn
    placed.push({ item: item, x: x, y: y, z: z, inst: inst });
    return inst;
  };
  // re-lay every placed item (called after the new-run sweep)
  function replaceWorldItems() {
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      p.inst = spawnDrop(p.item, 0, p.x, p.y == null ? 0.12 : p.y, p.z, 0, 0, 0);
      if (p.inst && p.inst.data) { p.inst.data.world = true; p.inst.data.rest = true; p.inst.data.life = Infinity; }
    }
  }
  CBZ.prisonPlacedAudit = function () {
    let live2 = 0;
    for (let i = 0; i < placed.length; i++) if (placed[i].inst && !placed[i].inst.data.taken) live2++;
    return { placed: placed.length, standing: live2 };
  };

  CBZ.prisonDropClear = function () {
    for (let i = live.length - 1; i >= 0; i--) { CBZ.removeProp && CBZ.removeProp(live[i]); }
    live.length = 0;
  };

  /* ============================================================
     THE TICK — notice a new run. Pickup itself stays on each prop's 40.05
     update so walking over an item collects it in the same simulation frame.
     ============================================================ */
  let lastEl = 0;
  CBZ.onUpdate(40.08, function () {
    const g = CBZ.game;
    // NEW RUN: state.js revives every body but leaves their pockets emptied
    // (rollLoadout caches on the actor), so the run-2 yard would drop nothing
    // at all. The clock going backwards is the shared signal for this —
    // inventory.js and morgue.js both read it the same way.
    const el = (g && g.elapsed) || 0;
    if (el + 0.001 < lastEl) {
      CBZ.prisonDropClear();
      CBZ.econ && CBZ.econ.resetLoadouts && CBZ.econ.resetLoadouts();
      spawned = 0; taken = 0; expired = 0; evicted = 0; bodies = 0; gunsDropped = 0; torchesDropped = 0;
      replaceWorldItems();      // a placed tool is part of the world, not of the run
    }
    lastEl = el;

  });

  /* ============================================================
     RATCHET — CBZ.prisonDropAudit()

       deathFrisks   economy.js's count of FULL frisks paid out on an already
                     dead body: loot that teleported into the bag instead of
                     landing on the floor. PIN AT 0 — that number IS the
                     owner's complaint, and it can only go to zero by a death
                     site adopting CBZ.prisonDrop.
       itemToasts    structurally 0. There is no flashToast left on any item
                     path in economy.js or here; a re-introduced red shout
                     shows up as a non-zero here.
       physicalGuns  guns that came off a body as a real model. If this is 0
                     after a firefight the migration is not doing its job.
       gunSolver     true when the dropped guns are riding the SHARED
                     CBZ.weaponPhysics release solve rather than the local
                     fallback — i.e. one gun physics, not two.
       orphans       live drops whose mesh left the scene graph. PIN AT 0.
       underfloor    live settled drops resting below their own floor. PIN 0.
     ============================================================ */
  CBZ.prisonDropAudit = function () {
    const la = (CBZ.econ && CBZ.econ.lootAudit) ? CBZ.econ.lootAudit() : { deathFrisks: -1, itemToasts: -1 };
    let orphans = 0, underfloor = 0, resting = 0;
    for (let i = 0; i < live.length; i++) {
      const d = live[i].data;
      if (!d || !d.mesh) { orphans++; continue; }
      if (!d.mesh.parent) orphans++;
      if (d.rest && !d.taken) {
        resting++;
        // A GUN IS NOT MEASURED HERE. weaponPhysics rests it on its own
        // measured lowest vertex and audits that itself (weaponPhysicsAudit's
        // `underground`); re-deriving a half-height for it would only invent a
        // second, worse answer to a question that already has one.
        if (rigidShape(d.shape)) continue;
        const fy = floorY(d.mesh.position.x, d.mesh.position.z, d.mesh.position.y + 0.4);
        if (d.mesh.position.y - d.hh < fy - 0.06) underfloor++;
      }
    }
    return {
      live: live.length, cap: CAP, spawned: spawned, taken: taken,
      expired: expired, evicted: evicted, bodies: bodies,
      physicalGuns: gunsDropped, physicalTorches: torchesDropped, resting: resting,
      gunSolver: !!(CBZ.weaponPhysics && CBZ.weaponPhysics.drop && C.PRISON_DROPS_PHYSICS !== false),
      pickupMode: "walkover", pickupRadius: AUTO_R, pickupPrompt: false,
      // PRISON_GUN_PROVENANCE: guns that reached an inmate's hand off the
      // floor. Nobody spawns armed any more, so this number IS the armed
      // population's origin story — if it is 0, every gun in the yard is
      // still in a guard's holster or behind the armory gate.
      npcArmedFromFloor: npcArmed,
      orphans: orphans, underfloor: underfloor,
      deathFrisks: la.deathFrisks, itemToasts: la.itemToasts,
      registry: !!CBZ.registerPropType,
    };
  };
})();
