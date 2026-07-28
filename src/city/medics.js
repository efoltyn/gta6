/* ============================================================
   city/medics.js — THE STRIPE-SHIRT GUYS.

   OWNER, verbatim: "body stays there until an AMBULANCE drives up and one of
   the stripe-shirt guys removes the body."

   This file has always had a paramedic who walks, collides properly against
   the ped wall contract, kneels at a body and lifts it. What it never had was
   an AMBULANCE. The medic materialised out of thin air 24 m away, on a
   4-second timer peds.js set on every corpse in the world, walked in, lifted,
   and walked back out to the empty patch of pavement he had appeared on —
   while traffic.js's real ambulance, on the other side of the same city, was
   separately driving to bodies and flagging them for a stretcher team that
   had already been and gone. Three files, one arc, no introductions.

   They are introduced now, and this file's job narrowed to the part it was
   always good at — a person on foot doing a job:

     debus  a paramedic steps out of the REAR of a parked ambulance
     walk   to the body (the same three-pass wall resolution as before)
     work   kneels over it a beat, hands on the body (poses.js "tend")
     carry  the body comes with him — CBZ.ragdollPin holds one mass point at
            his shoulder and the other twelve hang off it, so what he is
            carrying reads as a BODY and not a prop welded to his hands
     load   at the van's rear, the body goes in and only THEN is it removed
     board  no bodies left → he gets back in and the truck rolls

   WHO DECIDES ANY OF IT: city/morgue.js. It clusters deaths into scenes,
   holds the unit back while the scene is still hot (real EMS stages — they do
   not walk into gunfire), and answers morgueUnitReady/morgueNextBody. If it
   is not loaded, every seam here falls back to the original behaviour: walk
   in from 24 m, lift, leave.

   COPS COUNT. The corpse pool is CBZ.cityPeds AND CBZ.cityCops — an officer's
   body was invisible to this file for its whole life, which is half of why it
   could only ever be cleared by police.js's 8-second delete.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.makeCharacter) return;
  const g = CBZ.game;

  const MAX = 3;                 // concurrent medics citywide
  const CREW = 2;                // how many step out of one ambulance
  const REACH2 = 1.7 * 1.7;      // how close to the body counts as "reached"
  const VAN_R2 = 2.6 * 2.6;      // how close to the van's rear counts as "at the truck"
  const SPAWN_DIST = 24;         // LEGACY (no ambulance): medic walks in from this far
  const SPEED = 3.3;
  const CARRY_SPEED = 2.35;      // slower with a body on your shoulder
  const MEDIC_R = 0.5;           // SAME body radius as peds.js PED_R — one wall contract
  const WORK_T = 2.2;            // the beat spent over the body before it is lifted
  const LOAD_T = 1.1;            // the beat at the van's rear doors
  const medics = [];
  let lastElapsed = 0;

  // EXPOSED: fpsmode's findActorHit scans this exactly like cityPeds/cityCops,
  // so a paramedic is a legitimate hit-scan target (records carry hp/dead/group
  // in the shared actor shape; the kill routes through cityKillPed → real
  // murder heat + the witness flow, ragdoll via CBZ.body).
  CBZ.cityMedics = medics;

  function root() { return (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene; }
  function emsOn() { return !!(CBZ.CONFIG && CBZ.CONFIG.EMS_RESPONSE !== false && CBZ.morgueUnitScene); }

  const _probe = { x: 0, y: 0, z: 0 };
  // Push a point out of geometry and report whether it had to move. Used both
  // for the legacy walk-in spawn and for the step-off point beside a van.
  function clearSpot(cx, cz) {
    _probe.x = cx; _probe.y = 0; _probe.z = cz;
    if (CBZ.collide) CBZ.collide(_probe, MEDIC_R, 0, 1.7);
    return { x: _probe.x, z: _probe.z, ok: Math.abs(_probe.x - cx) < 0.05 && Math.abs(_probe.z - cz) < 0.05 };
  }

  function buildRig() {
    // PARAMEDIC BLUES. The palette is outfits.js's own `ems` record ("Paramedic
    // Blues", worn by EMS crews) rather than a fourth opinion about what a
    // medic looks like — navy shirt and trousers, hi-vis collar — and the
    // `stripes` slot (entities/character.js mounts three torso bands) carries
    // the reflective chest stripe clothes.js's PAINT.ems paints. That is the
    // owner's "stripe-shirt guys", off the two records that already described
    // them. Degrade-safe: no outfits.js and the literals below stand in.
    const cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null;
    const ems = (cat && cat.ems && cat.ems.colors) || null;
    const navy = ems ? ems.torso : 0x24304a;
    const hiviz = ems ? ems.collar : 0xc6d435;
    return CBZ.makeCharacter({
      legs: ems ? ems.legs : 0x24304a, torso: navy, collar: hiviz, arms: navy,
      skin: 0xe2bd97, hair: 0x2a2018, shoes: ems ? ems.shoes : 0x101216, stripes: hiviz,
    });
  }

  function makeRecord(ch, sx, sz) {
    ch.group.position.set(sx, CBZ.floorAt ? CBZ.floorAt(sx, sz) : 0, sz);
    root().add(ch.group);
    return {
      char: ch, group: ch.group, pos: ch.group.position, body: null,
      state: "walk", t: 0, homeX: sx, homeZ: sz, unit: null, scene: null,
      // shared actor shape (findActorHit / cityGunHit / cityKillPed / CBZ.body):
      kind: "medic", name: "Paramedic", job: "paramedic", isPlayer: false,
      hp: 80, dead: false, deadT: 0, ko: 0, speed: 0,
    };
  }

  // LEGACY PATH (no morgue.js): the original walk-in, kept byte-for-byte in
  // behaviour so a build without the dispatcher still clears its bodies.
  function makeMedic(bx, bz) {
    // SPAWN IN FREE SPACE: a blind random angle 24u out lands INSIDE a building
    // most of the time (blocks are mostly buildings) — the user-filmed "medic
    // inside the wall". Probe up to 8 angles and keep the first spot the wall
    // resolver doesn't displace; even a bad last resort gets depenetrated.
    let sx = bx + SPAWN_DIST, sz = bz;
    for (let t = 0; t < 8; t++) {
      const a = Math.random() * 6.2832;
      const s = clearSpot(bx + Math.cos(a) * SPAWN_DIST, bz + Math.sin(a) * SPAWN_DIST);
      sx = s.x; sz = s.z;
      if (s.ok) break;   // clear spot
    }
    return makeRecord(buildRig(), sx, sz);
  }

  // ---- THE VAN ------------------------------------------------------------
  // Where the rear doors are, in world space. The truck is 5.4 m long and its
  // group's +Z is forward (traffic.js sets grp.rotation.y = heading and drives
  // along sin/cos of it), so the tail is 2.9 m back along that heading.
  const _rear = { x: 0, z: 0 };
  function vanRear(e) {
    const s = Math.sin(e.heading || 0), c = Math.cos(e.heading || 0);
    _rear.x = e.pos.x - s * 2.9;
    _rear.z = e.pos.z - c * 2.9;
    return _rear;
  }
  // A step-off point beside the tailgate — never INSIDE the hull, so the first
  // frame of a debussing medic is not a body standing in a van.
  function stepOff(e, i) {
    const s = Math.sin(e.heading || 0), c = Math.cos(e.heading || 0);
    const side = (i % 2 === 0) ? 1.9 : -1.9;     // left/right of the tailgate
    const r = vanRear(e);
    return clearSpot(r.x + c * side, r.z - s * side);
  }
  function medicsOn(e) { let n = 0; for (let i = 0; i < medics.length; i++) if (!medics[i].dead && medics[i].unit === e) n++; return n; }
  // AN AMBULANCE DOES NOT DRIVE OFF WITHOUT ITS CREW. morgue.js's
  // morgueUnitBusy asks this before letting traffic.js release the truck —
  // without it the last body being loaded ends the scene, the truck rolls, and
  // a paramedic is left jogging after it down the street.
  CBZ.cityMedicsOn = medicsOn;

  function despawn(m) {
    if (m.body && CBZ.ragdollUnpin) { try { CBZ.ragdollUnpin(m.body); } catch (e) {} }
    if (m.body) m.body._morgueClaimed = false;
    if (m.group && m.group.parent) m.group.parent.remove(m.group);
  }
  function clearAll() { for (let i = 0; i < medics.length; i++) despawn(medics[i]); medics.length = 0; }

  function walkTo(m, tx, tz, dt, spd) {
    spd = spd || SPEED;
    const dx = tx - m.pos.x, dz = tz - m.pos.z, dist = Math.hypot(dx, dz) || 1;
    m.pos.x += (dx / dist) * spd * dt; m.pos.z += (dz / dist) * spd * dt;
    // THE PED WALL CONTRACT (peds.js move(), verbatim): multi-pass collide with
    // the body's vertical span + the city clamp between passes. The old single
    // bare-radius pass was the documented corner-tunnel bug — one push can shove
    // the body OUT of one wall INTO the adjacent one and a walker squeezes
    // straight through (peds.js carries the same 3-pass fix for that reason).
    if (CBZ.collide) {
      for (let pass = 0; pass < 3; pass++) {
        const bx = m.pos.x, bz = m.pos.z;
        CBZ.collide(m.pos, MEDIC_R, m.pos.y, m.pos.y + 1.7);
        if (CBZ.city && CBZ.city.arena && CBZ.city.arena.clampToCity) CBZ.city.arena.clampToCity(m.pos, MEDIC_R);
        if (Math.abs(m.pos.x - bx) < 0.002 && Math.abs(m.pos.z - bz) < 0.002) break;   // converged
      }
    }
    m.pos.y = CBZ.floorAt ? CBZ.floorAt(m.pos.x, m.pos.z) : 0;
    m.group.rotation.y = CBZ.lerpAngle(m.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0008, dt));
    if (CBZ.animChar) CBZ.animChar(m.char, spd, dt);
    return dist;
  }

  // ---- THE CARRY ----------------------------------------------------------
  // CBZ.ragdollPin (city/ragdoll.js) holds ONE mass point of the verlet
  // skeleton at a world position somebody else owns; the other twelve whip off
  // it. It shipped with exactly one consumer — the predator seize — and
  // CLAUDE.md names migrating a second as the debt owed. A body over a
  // paramedic's shoulder IS that second consumer: the same API, the same
  // reason (something else owns this point of the body now), and the result is
  // a corpse that swings and settles instead of a plank glued to a rig.
  // Degrade-safe in both directions: no ragdoll module, or a body with no slot
  // to spare, and the fallback is the original direct transform write.
  // ONE closure per medic, built once and reused — ragdoll.js calls `at` every
  // verlet SUBSTEP, and its contract is explicit that the callback must not
  // allocate. Re-minting the closure per frame would not break that rule, but
  // it would hand the GC three throwaway functions a frame for nothing.
  function carryAnchor(m) {
    if (m._anchor) return m._anchor;
    m._anchor = function (out) {
      const s = Math.sin(m.group.rotation.y), c = Math.cos(m.group.rotation.y);
      out.x = m.pos.x + s * 0.18;
      out.y = (m.pos.y || 0) + 1.34;      // shoulder height
      out.z = m.pos.z + c * 0.18;
    };
    return m._anchor;
  }
  function holdBody(m, dt) {
    const b = m.body; if (!b || !b.group) return;
    let pinned = false;
    if (CBZ.ragdollPin) {
      // re-issued every frame with a short `until` so the hold lapses by itself
      // the instant this medic stops asking (killed mid-carry, van despawned).
      try { pinned = CBZ.ragdollPin(b, { point: "torso", at: carryAnchor(m), until: 0.6, stiff: 1 }); } catch (e) { pinned = false; }
    }
    if (!pinned) {
      // no verlet slot available — carry it the cheap way (the pre-existing
      // lift used exactly this write, so nothing regresses)
      const s = Math.sin(m.group.rotation.y), c = Math.cos(m.group.rotation.y);
      b.group.position.set(m.pos.x + s * 0.18, (m.pos.y || 0) + 1.05, m.pos.z + c * 0.18);
    }
  }
  function dropBody(m) {
    const b = m.body;
    if (b) {
      if (CBZ.ragdollUnpin) { try { CBZ.ragdollUnpin(b); } catch (e) {} }
      b._morgueClaimed = false;
      if (b.group && b.pos) b.group.position.y = CBZ.floorAt ? CBZ.floorAt(b.pos.x, b.pos.z) : 0;
    }
    m.body = null;
  }

  // ---- who still needs collecting -----------------------------------------
  function claimedBy(p) {
    for (let j = 0; j < medics.length; j++) if (!medics[j].dead && medics[j].body === p) return true;
    return false;
  }
  // LEGACY scan: any flagged body anywhere (the pre-ambulance behaviour).
  function findLooseBody() {
    const pools = [CBZ.cityPeds, CBZ.cityCops];
    for (let q = 0; q < pools.length; q++) {
      const arr = pools[q]; if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        if (!(p.dead && p.needsPickup && !p.collected && !p.culled)) continue;
        if (!claimedBy(p)) return p;
      }
    }
    return null;
  }

  CBZ.onUpdate(34.7, function (dt) {
    if (g.mode !== "city") { if (medics.length) clearAll(); return; }
    if (g.state !== "playing") return;
    if (g.elapsed + 0.001 < lastElapsed) clearAll();   // new life → wipe
    lastElapsed = g.elapsed;

    // ================= DISPATCH =================
    if (medics.length < MAX) {
      if (emsOn()) {
        // A CREW COMES OUT OF A VAN THAT IS ACTUALLY THERE. morgueUnitReady is
        // true only when the ambulance has parked, the scene has been declared
        // safe (staging) and there is still somebody to collect.
        const emgs = CBZ.cityEmergencyUnits ? CBZ.cityEmergencyUnits() : null;
        if (emgs) for (let i = 0; i < emgs.length && medics.length < MAX; i++) {
          const e = emgs[i];
          if (!e || e.kind !== "ambulance" || e.state !== "work") continue;
          if (!CBZ.morgueUnitReady(e)) continue;
          const have = medicsOn(e);
          if (have >= CREW) continue;
          const sc = CBZ.morgueUnitScene(e); if (!sc) continue;
          // ONE MEDIC PER BODY. He is assigned — and CLAIMS — before he exists,
          // so a second crewman only ever steps out when there is a second
          // person on the ground, and two paramedics can never converge on one
          // corpse (the claim is what morgueNextBody skips on).
          const next = CBZ.morgueNextBody(sc, e.pos.x, e.pos.z);
          if (!next) continue;
          const s = stepOff(e, have);
          const m = makeRecord(buildRig(), s.x, s.z);
          m.unit = e; m.homeX = s.x; m.homeZ = s.z;
          m.body = next; next._morgueClaimed = true;
          m.state = "debus"; m.t = 0;
          m.group.rotation.y = (e.heading || 0) + Math.PI;   // facing out of the tailgate
          medics.push(m);
        }
      } else {
        // LEGACY: no dispatcher → the original walk-in from 24 m.
        const pending = findLooseBody();
        if (pending) { const m = makeMedic(pending.pos.x, pending.pos.z); m.body = pending; medics.push(m); }
      }
    }

    // ================= THE CREW =================
    for (let i = medics.length - 1; i >= 0; i--) {
      const m = medics[i];
      const b = m.body;
      // SHOT DEAD (cityKillPed via the player's hitscan): the ragdoll/CBZ.body
      // owns the corpse — release the half-lifted body, hold the scene a beat,
      // then despawn (same 8s rhythm as a downed cop).
      if (m.dead) {
        if (!m._deadHandled) { m._deadHandled = true; dropBody(m); }
        m.deadT += dt;
        if (m.deadT > 8) { despawn(m); medics.splice(i, 1); }
        continue;
      }
      if (m.ko > 0) { m.ko -= dt; continue; }                                  // tased — out cold, body system sprawls him
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(m)) { holdBody(m, dt); continue; }   // knockdown/ragdoll owns the rig this frame

      // THE VAN LEFT WITHOUT HIM: the truck was stolen, destroyed or rolled on
      // (traffic.js owns its lifecycle, never this file). Put the body down and
      // walk off the scene rather than servicing a vehicle that is not there.
      if (m.unit) {
        const e = m.unit;
        const gone = !e.grp || !e.grp.parent || e.dead || e._reap || e.player || e.stolen || e.state === "leave";
        if (gone) { dropBody(m); m.unit = null; m.state = "leave"; m.t = 0; }
      }

      if (m.state === "debus") {
        m.t += dt;
        if (CBZ.animChar) CBZ.animChar(m.char, 0, dt);
        if (m.t > 0.8) { m.state = "walk"; m.t = 0; }
        continue;
      }

      if (m.state === "walk") {
        if (!b || b.culled || b.collected || !b.dead) {
          // pick the next body at this scene (nearest to the van, so the crew
          // works outward instead of criss-crossing the street)
          let next = null;
          if (m.unit && CBZ.morgueNextBody) {
            const sc = CBZ.morgueUnitScene(m.unit);
            if (sc) next = CBZ.morgueNextBody(sc, m.unit.pos.x, m.unit.pos.z);
          } else if (!emsOn()) next = findLooseBody();
          if (next && !claimedBy(next)) { m.body = next; next._morgueClaimed = true; }
          else { m.state = m.unit ? "board" : "leave"; m.t = 0; }
          continue;
        }
        b._morgueClaimed = true;
        const dx = b.pos.x - m.pos.x, dz = b.pos.z - m.pos.z;
        if (dx * dx + dz * dz > REACH2) {
          m.t += dt;
          // can't get to it (mid-building body, blocked stair): give it up
          // rather than grinding at a wall forever.
          if (m.t > 26) { b._morgueClaimed = false; m.body = null; m.state = m.unit ? "board" : "leave"; m.t = 0; continue; }
          walkTo(m, b.pos.x, b.pos.z, dt);
        } else { m.state = "work"; m.t = 0; m.group.rotation.y = Math.atan2(dx, dz); }
        continue;
      }

      if (m.state === "work") {
        // KNEEL AND WORK THE BODY. poses.js's "tend" row owns the arms (both
        // hands down and forward, elbows bent) — the pose registry, not arm
        // math typed into this file.
        m.t += dt;
        if (CBZ.setCharPose) CBZ.setCharPose(m.char, "tend");
        if (CBZ.animChar) CBZ.animChar(m.char, 0, dt);
        if (m.t > WORK_T) {
          if (CBZ.setCharPose) CBZ.setCharPose(m.char, "stand");
          if (!b || b.culled || b.collected) { m.body = null; m.state = "walk"; m.t = 0; continue; }
          // NO AMBULANCE (legacy): lift where he stands and the body is gone at
          // the top of the lift, exactly as before.
          m.state = m.unit ? "carry" : "lift"; m.t = 0;
        }
        continue;
      }

      if (m.state === "carry") {
        if (!m.unit) { dropBody(m); m.state = "leave"; m.t = 0; continue; }
        if (!b || b.culled || b.collected) { dropBody(m); m.state = "walk"; m.t = 0; continue; }
        m.t += dt;
        const r = vanRear(m.unit);
        const dx = r.x - m.pos.x, dz = r.z - m.pos.z;
        if (dx * dx + dz * dz <= VAN_R2) { m.state = "load"; m.t = 0; m.group.rotation.y = Math.atan2(dx, dz); }
        else if (m.t > 30) {
          // couldn't get back (the truck moved, a wreck landed in the way). SET
          // THE BODY DOWN WHERE HE IS and go — never finish the load remotely,
          // which would slide a corpse across the street into a van it never
          // reached. It stays on the ground and another unit can come for it.
          dropBody(m); m.state = "board"; m.t = 0;
        } else walkTo(m, r.x, r.z, dt, CARRY_SPEED);
        holdBody(m, dt);
        continue;
      }

      if (m.state === "load") {
        if (!m.unit) { dropBody(m); m.state = "leave"; m.t = 0; continue; }
        m.t += dt;
        if (CBZ.animChar) CBZ.animChar(m.char, 0, dt);
        // the body slides in over the load beat — it goes UP and INTO the tail,
        // and is removed at the END of it. Never a teleport: it is removed at
        // the rear doors of a van you are watching it be put into.
        if (b && b.group) {
          const k = Math.min(1, m.t / LOAD_T);
          const r = vanRear(m.unit);
          const s = Math.sin(m.unit.heading || 0), c = Math.cos(m.unit.heading || 0);
          b.group.position.set(r.x + s * k * 1.5, (m.pos.y || 0) + 0.95, r.z + c * k * 1.5);
          if (CBZ.ragdollUnpin && k > 0.35) { try { CBZ.ragdollUnpin(b); } catch (e) {} }
        }
        if (m.t > LOAD_T) {
          if (b) {
            if (CBZ.ragdollUnpin) { try { CBZ.ragdollUnpin(b); } catch (e) {} }
            b._morgueClaimed = false;
            if (CBZ.morgueOnCollected) CBZ.morgueOnCollected(b);
            else b.collected = true;     // peds.js / police.js cull the collected body
          }
          m.body = null; m.state = "walk"; m.t = 0;
        }
        continue;
      }

      if (m.state === "lift") {
        // LEGACY lift (no ambulance): raise the body as if onto a stretcher.
        m.t += dt;
        if (CBZ.animChar) CBZ.animChar(m.char, 0, dt);
        if (b && b.group && b.pos) b.group.position.y = (CBZ.floorAt ? CBZ.floorAt(b.pos.x, b.pos.z) : 0) + Math.min(0.45, m.t * 0.3);
        if (m.t > 1.7) {
          if (b) { b._morgueClaimed = false; if (CBZ.morgueOnCollected) CBZ.morgueOnCollected(b); else b.collected = true; }
          m.body = null; m.state = "leave"; m.t = 0;
        }
        continue;
      }

      if (m.state === "board") {
        if (!m.unit) { m.state = "leave"; m.t = 0; continue; }
        // back in the van; the truck rolls once morgueUnitBusy goes false.
        m.t += dt;
        const r = vanRear(m.unit);
        const d = walkTo(m, r.x, r.z, dt);
        if (d < 1.5 || m.t > 16) { despawn(m); medics.splice(i, 1); }
        continue;
      }

      // leave: walk back out, then despawn (legacy exit)
      m.t += dt;
      const d = walkTo(m, m.homeX, m.homeZ, dt);
      if (d < 0.7 || m.t > 9) { despawn(m); medics.splice(i, 1); }
    }
  });
})();
