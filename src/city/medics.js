/* ============================================================
   city/medics.js — bodies don't just vanish. A short while after someone
   dies, a PARAMEDIC walks in, kneels over the body, lifts it and carries
   it off — only then does the corpse disappear (peds.js holds the body on
   the ground until p.collected). Bounded to a few medics at once so it
   never becomes a parade.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.makeCharacter) return;
  const g = CBZ.game;

  const MAX = 3;                 // concurrent medics
  const REACH2 = 1.7 * 1.7;      // how close to the body counts as "reached"
  const SPAWN_DIST = 24;         // medic walks in from this far
  const SPEED = 3.3;
  const medics = [];
  let lastElapsed = 0;

  function root() { return (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene; }

  function makeMedic(bx, bz) {
    const ch = CBZ.makeCharacter({
      legs: 0x26304a, torso: 0xeef2f5, collar: 0xd23b3b, arms: 0xeef2f5,
      skin: 0xe2bd97, hair: 0x2a2018, shoes: 0x111111, stripes: 0xd23b3b,
    });
    const a = Math.random() * 6.2832;
    const sx = bx + Math.cos(a) * SPAWN_DIST, sz = bz + Math.sin(a) * SPAWN_DIST;
    ch.group.position.set(sx, CBZ.floorAt ? CBZ.floorAt(sx, sz) : 0, sz);
    root().add(ch.group);
    return { char: ch, group: ch.group, pos: ch.group.position, body: null, state: "walk", t: 0, homeX: sx, homeZ: sz };
  }

  function despawn(m) { if (m.group && m.group.parent) m.group.parent.remove(m.group); }
  function clearAll() { for (let i = 0; i < medics.length; i++) despawn(medics[i]); medics.length = 0; }

  function walkTo(m, tx, tz, dt) {
    const dx = tx - m.pos.x, dz = tz - m.pos.z, dist = Math.hypot(dx, dz) || 1;
    m.pos.x += (dx / dist) * SPEED * dt; m.pos.z += (dz / dist) * SPEED * dt;
    if (CBZ.collide) CBZ.collide(m.pos, 0.42);
    m.pos.y = CBZ.floorAt ? CBZ.floorAt(m.pos.x, m.pos.z) : 0;
    m.group.rotation.y = CBZ.lerpAngle(m.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0008, dt));
    if (CBZ.animChar) CBZ.animChar(m.char, SPEED, dt);
    return dist;
  }

  CBZ.onUpdate(34.7, function (dt) {
    if (g.mode !== "city") { if (medics.length) clearAll(); return; }
    if (g.state !== "playing") return;
    if (g.elapsed + 0.001 < lastElapsed) clearAll();   // new life → wipe
    lastElapsed = g.elapsed;

    const peds = CBZ.cityPeds || [];

    // dispatch: one un-claimed, pickup-flagged body gets a medic (up to MAX)
    if (medics.length < MAX) {
      let claimed = false, pending = null;
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!(p.dead && p.needsPickup && !p.collected && !p.culled)) continue;
        let taken = false;
        for (let j = 0; j < medics.length; j++) if (medics[j].body === p) { taken = true; break; }
        if (!taken) { pending = p; break; }
      }
      if (pending) { const m = makeMedic(pending.pos.x, pending.pos.z); m.body = pending; medics.push(m); }
    }

    // drive each medic through walk → lift → leave
    for (let i = medics.length - 1; i >= 0; i--) {
      const m = medics[i];
      const b = m.body;
      if (m.state === "walk") {
        if (!b || b.culled || b.collected || !b.dead) { m.state = "leave"; m.t = 0; continue; }
        const dx = b.pos.x - m.pos.x, dz = b.pos.z - m.pos.z;
        if (dx * dx + dz * dz > REACH2) walkTo(m, b.pos.x, b.pos.z, dt);
        else { m.state = "lift"; m.t = 0; m.group.rotation.y = Math.atan2(dx, dz); }
      } else if (m.state === "lift") {
        m.t += dt;
        if (CBZ.animChar) CBZ.animChar(m.char, 0, dt);
        // raise the body as if being lifted onto a stretcher
        if (b && b.group && b.pos) b.group.position.y = (CBZ.floorAt ? CBZ.floorAt(b.pos.x, b.pos.z) : 0) + Math.min(0.45, m.t * 0.3);
        if (m.t > 1.7) { if (b) b.collected = true; m.state = "leave"; m.t = 0; }   // peds.js culls the collected body
      } else { // leave: walk back out, then despawn
        m.t += dt;
        const d = walkTo(m, m.homeX, m.homeZ, dt);
        if (d < 0.7 || m.t > 9) { despawn(m); medics.splice(i, 1); }
      }
    }
  });
})();
