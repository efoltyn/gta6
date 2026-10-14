/* lab kit "person-chair": a person and a chair, and what they do to each other.

   An NPC (the shared rig + CBZ.brain, ingredients/person.js) walks to a loose
   chair (city/furniture.js + systems/pushables.js), sits through the one
   furniture layer (CBZ.rest -> propSit -> the moves_posture sequencer), sits
   a while, stands and walks off. Then the PLAYER (entities/player.js on
   systems/physics.js) walks into the empty chair, which slides (pushables:
   contact drive, mass 7 kg), backs off, and SPRINTS into it, which knocks it
   over (pushables TIP_DRIVE: faster than a walk). Every step is the game's.

   params: role (the NPC's), seed, sit (s the NPC stays seated, default 4)
   probe: the NPC was seated and stood again, the walk-in pushed the chair,
          the sprint tipped it, and the player's feet never left y = 0. */
CBZ.lab.kit("person-chair", {
  about: "an NPC sits on a chair and gets up; the player walks into the chair (it slides), then sprints into it (it tips)",
  uses: ["person", "chair", "player"],
  params: { role: "civilian", sit: 4 },
  duration: 22,
  setup: function (W, P) {
    W.add("chair", { name: "chair", at: [0, 0], yaw: 0 });
    W.add("person", { name: "npc", at: [3.2, 3.6], yaw: -140, role: P.role, brain: true });
    W.add("player", { name: "player", at: [0.3, -7] });
    W.marks = {};
  },
  frame: function (W) { return W.subjects(); },
  script: function (W, P) {
    const npc = W.get("npc"), chair = W.get("chair"), pl = W.get("player");
    const sitFor = +P.sit || 4;
    let pushStart = null;
    return [
      [0.2, function () { npc.sit(chair); }, "npc: go sit on the chair"],
      [0.2 + 3.6 + sitFor, function () { npc.stand(); }, "npc: get up"],
      [0.2 + 3.6 + sitFor + 2.4, function () { npc.walkTo(4.5, 5.5); }, "npc: walk off"],
      [12.5, function () {
        // walk straight THROUGH where the chair stands: contact is the push
        const c = chair.pos(); pushStart = c;
        W.marks.pushFrom = { x: c.x, z: c.z };
        pl.walkTo(c.x, c.z + 1.6);
      }, "player: walk into the chair"],
      [16.0, function () {
        const c = chair.pos();
        W.marks.pushed = Math.hypot(c.x - W.marks.pushFrom.x, c.z - W.marks.pushFrom.z);
        pl.walkTo(c.x, c.z - 5.5);
      }, "player: back off"],
      [18.6, function () {
        const c = chair.pos();
        W.marks.sprintFrom = { x: c.x, z: c.z };
        pl.walkTo(c.x, c.z + 3.0, { sprint: true });
      }, "player: sprint into the chair"],
    ];
  },
  probe: function (W, P) {
    const ev = W.log;
    const first = function (who, what) { for (let i = 0; i < ev.length; i++) if (ev[i].who === who && ev[i].what.indexOf(what) >= 0) return ev[i].t; return null; };
    const seatedAt = first("npc", "pose: seated");
    const stoodAt = (function () { for (let i = 0; i < ev.length; i++) if (ev[i].who === "npc" && ev[i].t > (seatedAt || 0) && /pose: (getting_up|standing|walking)/.test(ev[i].what)) return ev[i].t; return null; })();
    const tipAt = first("chair", "tipped: falling");
    const c = W.get("chair").state();
    const pl = W.get("player").state();
    const pushed = W.marks.pushed != null ? W.marks.pushed : null;
    const ok = seatedAt != null && stoodAt != null && pushed != null && pushed > 0.15 && tipAt != null && tipAt > 18.6 && pl.yRange < 0.02;
    const f = function (v) { return v == null ? "never" : v.toFixed(2) + " s"; };
    return {
      ok: ok,
      summary: "npc seated at " + f(seatedAt) + ", stood at " + f(stoodAt) + "; walk-in pushed the chair " + (pushed == null ? "?" : pushed.toFixed(2)) +
        " m; sprint tipped it at " + f(tipAt) + "; player y range " + pl.yRange + " m, peak speed " + pl.peakSpeed + " m/s",
      data: { seatedAt: seatedAt, stoodAt: stoodAt, pushed: pushed, tipAt: tipAt, chair: c, player: pl, npc: W.get("npc").state() },
    };
  },
});
