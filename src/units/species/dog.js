/* ============================================================
   units/species/dog.js — the dog as NPC War fights it.

   OWNED BY: the dog agent.

   This is the one species in NPC War with no bestiary row: the war room's
   "100 LIONS v 1000 DOGS" asked for id "dog" and nothing answered it, so the
   matchup put a hundred lions on an empty field. The game's one dog is
   city/dogmodel.js (a lofted, skinned 24-bone body, five breeds, a planted-foot
   gait — the reference for every animal redraw), and this file stands it up
   as a fighter: it defines the species row, builds the body from dogModel and
   drives dogModel.animate from the battle's own motion.

   `needs` in units/manifest.js loads the kit (units/kit/gait.js, quadrig.js,
   loft.js) and city/dogmodel.js before this file.

   The numbers are a fighting dog's (the pit / shepherd / mastiff rows of
   dogmodel.js's BREEDS: hp 50-75, bite 12-18); spd is the bestiary's wander
   unit (the charge is chase below).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // the breeds a fighting pack is drawn from, by spawn index
  const BREEDS = ["pit", "shepherd", "mastiff", "mutt", "pit", "mutt"];
  const STATS = {
    hp: 55, spd: 3.0, danger: 0.6, bite: 14, scale: 1,
    chase: 8.2, march: 4.5, dmg: 18.9, rate: 1.23, brave: false, prey: false,
  };
  function build(ctx) {
    const M = CBZ.dogModel;
    if (!M || !M.build) return null;
    const seed = ((ctx && ctx.seed) | 0) || Math.floor(((ctx && ctx.rng) ? ctx.rng() : Math.random()) * 1e6);
    const rig = M.build(BREEDS[seed % BREEDS.length], seed);
    rig.group.userData.dogRig = rig;
    return rig.group;
  }
  // the body follows the battle's own motion: whatever moved the unit, the
  // legs answer to it (dogModel measures speed and turn from the positions)
  function animate(m, dt) {
    const rig = m.group && m.group.userData.dogRig;
    if (!rig || !CBZ.dogModel) return;
    const c = m._dogCtl || (m._dogCtl = { x: 0, z: 0, y: 0, heading: 0, posture: "stand", ground: null });
    c.x = m.pos.x; c.z = m.pos.z; c.y = m.pos.y;
    c.heading = typeof m.heading === "number" ? m.heading : 0;
    const t = m.tgt;
    const close = t && !t.dead ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 1e9;
    c.alert = t && !t.dead ? 1 : 0.3;
    c.aggr = close < 25 ? 1 : 0;
    c.fear = m.routed ? 1 : 0;
    c.bite = m._atkAnim != null && m._atkAnim >= 0 && m._atkAnim < 0.2;
    c.bark = !c.bite && close < 18 && (m.i % 7 === 0);
    c.ground = CBZ.floorAt || null;
    CBZ.dogModel.animate(rig, dt, c);
  }
  CBZ.unitKit.register("dog", { kind: "species", stats: STATS, build: build, animate: animate });
  // ...and the species row the battle and creature_combat read, once
  if (CBZ.defineSpecies && !(CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.dog)) {
    CBZ.defineSpecies({
      id: "dog", name: "Dog", biome: "farmland", rarity: "common",
      hp: STATS.hp, spd: STATS.spd, danger: STATS.danger, bite: STATS.bite, scale: STATS.scale,
      packs: 6, herd: [3, 8], respawn: false,
      build: build,
    });
  }
})();
