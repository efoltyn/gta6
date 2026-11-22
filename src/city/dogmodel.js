/* ============================================================
   city/dogmodel.js — CBZ.dogModel: the dog API, on the one canid body.

   Every dog is CBZ.canid (src/units/kit/canid.js): a breed is a row of that
   family next to the wolves, coyotes and foxes. This file is only the API
   the dog hosts already call (city/dogs.js, games/police.js and NPC War's
   units/species/dog.js):

     build(breed, seed, coat?) -> rig  { group, mesh, bones, dims, breed, coat }
                               breeds: shepherd pit mastiff lab mutt
     animate(rig, dt, ctrl)    one frame of motion and body language
                               (ctrl as documented at CBZ.canid's POSE)
     collar(rig, hex | null)   the collar band (part of the body, one draw)
     mouth(rig) -> {x, y, z}   the mouth at rest, in the group's units
     dims(breed, seed) -> D    the body plan; BREEDS the rows; BN the bones
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  // node tools load this file on its own: bring the family's maths along
  if (!CBZ.canid && typeof module !== "undefined" && typeof require === "function") { try { require("../units/kit/canid.js"); } catch (e) {} }
  const C = CBZ.canid;
  if (!C) { if (W.console) console.error("[dogmodel] needs src/units/kit/canid.js loaded first"); return; }
  const BREEDS = {};
  ["shepherd", "pit", "mastiff", "lab", "mutt"].forEach(function (k) { BREEDS[k] = C.ROWS[k]; });
  function key(breed) { return BREEDS[breed] ? breed : "mutt"; }
  function dims(breed, seed) { return C.dims(key(breed), { shape: Math.abs(seed | 0) % 6 }); }
  function build(breed, seed, coat) {
    const rig = C.rig(key(breed), { seed: Math.abs(seed | 0) || 1, coat: coat });
    rig.dims = rig.D;
    rig.trackMouth = true;
    return rig;
  }
  function animate(rig, dt, ctrl) { return C.pose(rig, dt, ctrl); }
  function collar(rig, hex) { return C.collar(rig, hex); }
  function mouth(rig) { const M = rig.D.mouth, s = rig.mesh.scale.x; return { x: M.x * s, y: M.y * s, z: 0 }; }
  CBZ.dogModel = { BREEDS: BREEDS, dims: dims, build: build, animate: animate, collar: collar, mouth: mouth, BN: C.BN };
  if (typeof module !== "undefined" && module.exports) module.exports = { dims: dims, BREEDS: BREEDS };
})();
