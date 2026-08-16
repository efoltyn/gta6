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
  const FADE = 0.34;         // s of rise-and-shrink when a drop is taken
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
     SHAPES — a drop is a real object, and the object says what it is.

     Keyed off economy.js's OWN item table (its `tag` field), with a short
     list of name overrides for the things a tag cannot separate. Adding an
     item to economy.js gets a shape for free from its tag; adding a NEW
     SHAPE is a row here and nothing else. There is no per-item table and
     there must never be one.
     ============================================================ */
  const cmat = function (c, o) { return CBZ.cmat ? CBZ.cmat(c, o) : new THREE.MeshLambertMaterial({ color: c }); };
  const bgeo = function (w, h, d) {
    if (CBZ.boxGeom) return CBZ.boxGeom(w, h, d);
    const g = new THREE.BoxGeometry(w, h, d); g._shared = true; return g;
  };
  const _cyl = new Map();
  function cgeo(r, h) {
    const k = r + "," + h;
    let g = _cyl.get(k);
    if (!g) { g = new THREE.CylinderGeometry(r, r, h, 10); g._shared = true; _cyl.set(k, g); }
    return g;
  }
  const _tor = new Map();
  function tgeo(r, t) {
    const k = r + "," + t;
    let g = _tor.get(k);
    if (!g) { g = new THREE.TorusGeometry(r, t, 5, 12); g._shared = true; _tor.set(k, g); }
    return g;
  }
  function put(parent, geo, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  // name -> shape overrides. Everything else falls through to its ITEMS tag.
  const SHAPE_BY_NAME = {
    "Gun": "gun", "Guard Torch": "torch",
    // "shank" is the Shiv's OWN shape, not the generic blade: it is the only
    // improvised blade in the catalog with a real authored model, so the thing
    // you see lying on the concrete is the thing that was in his fist a second
    // earlier. The rest keep the two-box approximation until they earn a model.
    "Shiv": "shank", "Shank": "shank",
    "Razor Blade": "blade", "Hacksaw Blade": "blade",
    "Brass Knuckles": "blade", "Hatchet": "blade", "Pickaxe": "blade",
    "Handcuff Key": "card", "Contraband Map": "card", "Burner SIM": "card",
    "Phone Charger": "card", "Burner Phone": "card", "Tattoo Gun": "pouch",
    "Cigarette Carton": "carton", "Ramen": "carton", "Energy Bar": "carton",
    "Energy Drink": "vial", "Soap": "carton", "Lighter": "vial",
    "Cash Roll": "roll", "Gold Chain": "chain", "Gold Tooth": "trinket",
    "Luxury Watch": "trinket", "Stolen Wallet": "carton",
    "Bedsheet Rope": "roll", "Lockpick": "blade",
  };
  const SHAPE_BY_TAG = {
    key: "card", valuables: "trinket", drugs: "vial",
    tools: "pouch", goods: "pouch", resource: "pouch",
  };
  function shapeOf(name) {
    if (SHAPE_BY_NAME[name]) return SHAPE_BY_NAME[name];
    const it = CBZ.econ && CBZ.econ.ITEMS && CBZ.econ.ITEMS[name];
    return (it && SHAPE_BY_TAG[it.tag]) || "pouch";
  }
  function rigidShape(shape) { return shape === "gun" || shape === "torch" || shape === "shank"; }

  // A tint per rarity, so a gold chain in the dirt reads differently from a
  // bar of soap without anybody typing a colour per item.
  // Tints match css/inventory.css's slot borders (rare = blue, epic = gold) —
  // the ground glint and the bag border are the same claim about the same item,
  // and the two tables disagreeing was caught at merge. Change BOTH or neither.
  const RARE_TINT = { common: 0x8b8f96, uncommon: 0x6fa9c8, rare: 0x60a4ff, epic: 0xffcb5c };
  function tintOf(name) {
    const it = CBZ.econ && CBZ.econ.ITEMS && CBZ.econ.ITEMS[name];
    return RARE_TINT[(it && it.rarity) || "common"] || RARE_TINT.common;
  }

  // Each builder returns { mesh, hh, r } — hh is the half-height it rests on,
  // r the collision radius for the ballistic. Two or three meshes, no more.
  function buildShape(shape, name) {
    const tint = tintOf(name);
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
        // space, so the world scalar applies directly — the gun on the deck
        // is the same length as the one that lands in the hand (it used to be
        // ~40% longer and shrink on pickup).
        model.scale.setScalar((CBZ.weaponWorldScale && CBZ.weaponWorldScale(name)) || 1.05);
        g.add(model);
      } else {
        put(g, bgeo(0.10, 0.06, 0.30), cmat(0x30363f), 0, 0, 0);   // no actorweapons.js loaded
      }
      hh = 0.05; r = 0.13;
    } else if (shape === "torch") {
      // The exact held model, with the hand-socket rotation removed. Released
      // torches join the same measured side-rest solver as firearms, so their
      // reflector/body—not a guessed half-height—decides where the ground is.
      if (CBZ.buildFlashlight) {
        const model = CBZ.buildFlashlight({ lit: false });
        model.position.set(0, 0, 0);
        model.rotation.set(0, 0, 0);
        model.scale.setScalar(1.08);
        g.add(model);
      } else {
        put(g, cgeo(0.055, 0.44), cmat(0x20262d), 0, 0, 0, Math.PI / 2);
      }
      hh = 0.055; r = 0.12;
    } else if (shape === "shank") {
      // Same law as the gun and the torch above: the dropped object is the
      // AUTHORED object with the hand-socket pose stripped off, so it lands on
      // its real flat side under the shared measured-rest solver instead of on
      // a guessed half-height. A shank that fell out of a dead man's waistband
      // must be the same shank you pick up.
      if (CBZ.buildActorWeapon) {
        const model = CBZ.buildActorWeapon("Shiv");
        model.position.set(0, 0, 0);
        model.rotation.set(0, 0, 0);
        // same real-dimension law as the gun branch above
        model.scale.setScalar((CBZ.weaponWorldScale && CBZ.weaponWorldScale("Shiv")) || 1.05);
        g.add(model);
      } else {
        put(g, bgeo(0.05, 0.04, 0.20), cmat(0x1b1f26), 0, 0, -0.02);
        put(g, bgeo(0.035, 0.02, 0.26), cmat(0xb9c2cc), 0, 0.005, 0.20);
      }
      hh = 0.018; r = 0.10;
    } else if (shape === "blade") {
      put(g, bgeo(0.05, 0.04, 0.20), cmat(0x1b1f26), 0, 0, -0.02);           // taped grip
      put(g, bgeo(0.035, 0.02, 0.26), cmat(0xb9c2cc), 0, 0.005, 0.20);       // ground edge
      hh = 0.02; r = 0.10;
    } else if (shape === "card") {
      put(g, bgeo(0.20, 0.014, 0.13), cmat(0xe8e3d6), 0, 0, 0);
      put(g, bgeo(0.20, 0.016, 0.035), cmat(tint), 0, 0.002, -0.04);         // mag stripe
      hh = 0.008; r = 0.10;
    } else if (shape === "carton") {
      put(g, bgeo(0.26, 0.13, 0.17), cmat(0xf2ede0), 0, 0, 0);
      put(g, bgeo(0.27, 0.05, 0.18), cmat(tint), 0, 0.05, 0);                // band
      hh = 0.065; r = 0.14;
    } else if (shape === "vial") {
      put(g, cgeo(0.045, 0.16), cmat(0x2f3a44), 0, 0, 0, Math.PI / 2);       // lies on its side
      put(g, cgeo(0.048, 0.03), cmat(tint), 0, 0, 0.088, Math.PI / 2);       // cap
      hh = 0.045; r = 0.09;
    } else if (shape === "roll") {
      put(g, cgeo(0.055, 0.15), cmat(0x4d6b45), 0, 0, 0, Math.PI / 2);       // rolled notes
      put(g, tgeo(0.058, 0.012), cmat(0xb03a3a), 0, 0, 0, 0);                // rubber band
      hh = 0.055; r = 0.09;
    } else if (shape === "chain") {
      put(g, tgeo(0.10, 0.018), cmat(tint), 0, 0, 0, Math.PI / 2);           // laid flat
      hh = 0.018; r = 0.12;
    } else if (shape === "trinket") {
      put(g, bgeo(0.075, 0.03, 0.075), cmat(tint), 0, 0, 0);                 // face / stone
      put(g, bgeo(0.045, 0.018, 0.19), cmat(0x2a2118), 0, -0.004, 0);        // strap
      hh = 0.018; r = 0.09;
    } else {                                                                  // pouch
      put(g, bgeo(0.17, 0.10, 0.12), cmat(0x5a5347), 0, 0, 0);
      put(g, bgeo(0.06, 0.03, 0.13), cmat(tint), 0, 0.055, 0);               // tie
      hh = 0.05; r = 0.11;
    }
    return { mesh: g, hh: hh, r: r };
  }

  // The cigarettes a body is carrying land as ONE physical bundle rather
  // than as N separate props — a dozen loose packs on the floor is confetti.
  function buildCigs(n) {
    const g = new THREE.Group();
    put(g, bgeo(0.20, 0.11, 0.13), cmat(0xf6f3ea), 0, 0, 0);
    put(g, bgeo(0.21, 0.045, 0.14), cmat(0xc94d3a), 0, 0.045, 0);
    if (n >= 10) put(g, bgeo(0.18, 0.10, 0.12), cmat(0xe9e3d2), 0.045, 0.10, 0.02, 0, 0.4, 0);
    return { mesh: g, hh: 0.055, r: 0.12 };
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

  function takeDrop(inst) {
    const d = inst.data;
    if (d.taken) return;
    d.taken = true; d.fade = 0;
    // hand the model back from the shared gun solver before it starts moving
    // under a take animation the solver knows nothing about
    if (d.body && CBZ.weaponPhysics && CBZ.weaponPhysics.release) {
      try { CBZ.weaponPhysics.release(d.mesh); } catch (e) {}
      d.body = null;
    }
    grant(d);
    taken++;
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
          bounces: 0, rest: false, age2: 0, far: 0, taken: false, fade: -1,
          body: null, inst: null,
        },
      };
    },
    onUpdate: function (dt, inst) {
      const d = inst.data;
      const m = d.mesh;

      // TAKEN: rise and shrink out, then hand the instance back to the
      // registry, which disposes it (every geometry/material here is _shared,
      // so nothing another drop is using can be freed out from under it).
      if (d.taken) {
        d.fade += dt;
        const t = Math.min(1, d.fade / FADE);
        m.position.y += dt * 1.9;
        m.scale.setScalar(Math.max(0.001, 1 - t));
        if (t >= 1) { m.visible = false; CBZ.removeProp && CBZ.removeProp(inst); dropGone(inst); }
        return;
      }

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
      const d2 = planarD2(inst);
      if (d2 > KEEP_R2) d.far += dt;
      if (d.far > TTL) {
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
      if (d2 <= AUTO_R * AUTO_R) { takeDrop(inst); return; }

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
     counters and the fade stay honest about where the object went.
     ============================================================ */
  const NPC_TAKE_R2 = (AUTO_R * 1.5) * (AUTO_R * 1.5);
  const ARMABLE = { "Gun": "Pistol", "Taser": "Taser" };

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
      if (n.hasGun || n.armed) continue;      // he already has one
      if (n.restraint || n.cuffed) continue;  // cuffed hands take nothing
      const dx = px - n.group.position.x, dz = pz - n.group.position.z;
      if (dx * dx + dz * dz > NPC_TAKE_R2) continue;
      armNpc(n, want, d.item);
      d.taken = true; d.fade = 0;
      if (d.body && CBZ.weaponPhysics && CBZ.weaponPhysics.release) {
        try { CBZ.weaponPhysics.release(m); } catch (e) {}
        d.body = null;
      }
      taken++; npcArmed++;
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
  function enforceCap() {
    if (live.length < CAP) return;
    let victim = null;
    for (let i = 0; i < live.length; i++) {
      const inst = live[i];
      if (inst.data.taken) continue;
      if (planarD2(inst) > EVICT_R2) { victim = inst; break; }   // oldest far one
    }
    if (!victim) victim = live[0];
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
