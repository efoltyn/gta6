/* ============================================================
   city/security.js - private guards for high-value businesses.

   Police remain the city-wide response. These guards are ordinary city peds
   with a job, a post and a local threat scan, so robberies have immediate
   consequences without a separate combat implementation.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  let _s = 91337;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  const POSTS = { bank: 2, guns: 1, jewelry: 1, security: 2, carlot: 1, pawn: 1 };
  CBZ.citySecurity = CBZ.citySecurity || [];

  // THE SHARED POST (city/occupy.js). It is exactly the four lines this file
  // used to write by hand — make the ped, parent it, roster it, stamp the post
  // — so adopting it deletes code instead of adding any. Degrade-safe: if
  // occupy.js is absent (or OCCUPY_V1 is off) the inline fallback below is the
  // byte-for-byte prior behaviour.
  function post(x, z, o) {
    if (CBZ.cityPostNpc) return CBZ.cityPostNpc(x, z, o);
    const p = CBZ.cityMakePed(x, z, o.rng, o);
    if (!p) return null;
    (o.parent || CBZ.city.arena.root).add(p.group);
    CBZ.cityPeds.push(p);
    return p;
  }

  CBZ.spawnCitySecurity = function () {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !CBZ.cityMakePed) return;
    _s = 91337;
    CBZ.citySecurity.length = 0;
    for (const lot of A.shopLots || []) {
      const count = POSTS[lot.kind] || 0;
      const d = lot.building && lot.building.door;
      if (!d) continue;
      for (let i = 0; i < count; i++) {
        const lateral = (i - (count - 1) / 2) * 1.8;
        const x = d.x - d.nx * 3.2 + d.nz * lateral;
        const z = d.z - d.nz * 3.2 - d.nx * lateral;
        const armed = lot.kind === "bank" || lot.kind === "guns" || lot.kind === "security" || rng() < 0.72;
        const ped = post(x, z, {
          src: "security:shop", rng: rng, parent: A.root,
          kind: "security", faction: "security", archetype: "security",
          job: "private security", behavior: "defensive", reactivity: 0.78,
          guard: { x, z }, homeGuard: { x, z }, outfit: 0x4d6275, wealth: 0.46,
          aggr: 0.7 + rng() * 0.1, armed, weapon: armed ? "Pistol" : null,
          hp: 135, name: "Sentinel Guard",
        });
        if (!ped) continue;
        ped.protectLot = lot;
        if (armed) ped.ammo = 36;
        CBZ.citySecurity.push(ped);
      }
    }
  };

  CBZ.citySecurityIntruder = function (guard) {
    if (!guard || guard.dead) return null;
    if (guard.mem && !guard.mem.dead && guard.mem.pos && guard.alarmed > 0) return guard.mem;
    let best = null, bd = 18 * 18;
    for (const p of CBZ.cityPeds) {
      if (p === guard || p.dead || (p.npcWanted | 0) < 1) continue;
      const dx = p.pos.x - guard.pos.x, dz = p.pos.z - guard.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = p; }
    }
    const actor = CBZ.city && CBZ.city.playerActor;
    if (actor && !actor.dead && (CBZ.game.wanted | 0) >= 1) {
      const dx = actor.pos.x - guard.pos.x, dz = actor.pos.z - guard.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) best = actor;
    }
    return best;
  };

  // Reset used to only drop the tracking array, leaving every guard ped alive
  // in CBZ.cityPeds and in the scene — a real leak across a city rebuild. The
  // shared teardown (occupy.js) is the matching half of the shared post, so
  // now it actually unposts them.
  CBZ.citySecurityReset = function () {
    if (CBZ.cityUnpostNpc) for (let i = 0; i < CBZ.citySecurity.length; i++) CBZ.cityUnpostNpc(CBZ.citySecurity[i]);
    CBZ.citySecurity.length = 0;
  };
})();
