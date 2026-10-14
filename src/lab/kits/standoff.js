/* lab kit "standoff": a gun pointed at a person, and what the person does.

   The gunman (an NPC, or the player with gunman=player) draws a real pistol
   (systems/actorweapons.js: the shipped model in his hand, the ready pose,
   a bounded turn onto his mark) and levels it at the target. The target is a
   person on CBZ.brain under his role's archetype: each frame he PERCEIVES
   (CBZ.brain.perception.sees: his cone, range, light, line of sight) and,
   when the gun is seen, gets the threat record the brain reads (armed,
   aimingAtMe off the barrel's real world axis, distance, weapon "gun") and
   CBZ.brain.threat.respond picks: surrender (hands up), comply (kneel,
   hands up), freeze (cower), flee, cover, or fight (a man with his own gun
   draws and aims back: the standoff). reactions.js draws the hands-up /
   aim-back / cower poses off the same flags the jail and the city set.

   params: role civilian|gang|cop|guard|inmate (the target), gunman npc|player,
           dist (m, default 6), nerve (0..1, the target's break point; default
           the archetype's), targetGun Pistol|none (default: cops/guards carry
           one), lower (s the gunman lowers the gun, default 6)
   probe:  the target's timeline (pose + brain response with times) and ok
           when he reacted to the gun at all. */
CBZ.lab.kit("standoff", {
  about: "a gunman (npc or player) levels a pistol at a person; the person's brain decides: hands up, comply, cower, flee or draw back",
  uses: ["person", "gun", "player"],
  params: { role: "civilian", gunman: "npc", dist: 6, lower: 6 },
  duration: 9,
  setup: function (W, P) {
    const d = +P.dist || 6;
    const tgtOpts = { name: "target", at: [0, 0], yaw: 0, role: P.role || "civilian" };
    if (P.nerve != null) tgtOpts.nerve = +P.nerve;
    if (P.targetGun != null) tgtOpts.weapon = P.targetGun;
    W.add("person", tgtOpts);
    if (P.gunman === "player") {
      W.add("player", { name: "gunman", at: [0, d], yaw: 180 });
      W.add("gun", { name: "pistol", holder: "gunman", weapon: P.weapon || "Pistol" });
    } else {
      W.add("player", { name: "observer", at: [-d * 1.5, -d] });   // off to the side: the player-centred systems need a player
      W.add("person", { name: "gunman", at: [0, d], yaw: 180, role: P.gunmanRole || "gang", brain: false, weapon: P.weapon || "Pistol" });
      W.add("gun", { name: "pistol", holder: "gunman", weapon: P.weapon || "Pistol" });
    }
  },
  frame: function (W) { return [W.get("target").obj, W.get("gunman").obj]; },
  script: function (W, P) {
    const gun = W.get("pistol"), tgt = W.get("target");
    return [
      [0.5, function () { gun.aimAt(tgt); }, "gunman: draw and aim at the target"],
      [+P.lower || 6, function () { gun.lower(); }, "gunman: lower the gun"],
    ];
  },
  probe: function (W, P) {
    const ev = W.log.filter(function (e) { return e.who === "target" && e.t > 0; });
    const aimT = 0.5;
    const line = ev.filter(function (e) { return !/^gun: /.test(e.what); })
      .map(function (e) { return e.what.replace(/^(pose|brain): /, "") + " at " + (e.t - aimT).toFixed(2) + " s"; });
    const firstResp = ev.filter(function (e) { return /^brain: /.test(e.what) && !/calm/.test(e.what); })[0];
    const tgt = W.get("target").state();
    const ok = !!firstResp && firstResp.t - aimT < 3;
    return {
      ok: ok,
      summary: "target (" + (P.role || "civilian") + ", gunman " + (P.gunman || "npc") + "): " + (line.length ? line.slice(0, 8).join(", ") : "no reaction") +
        " [times from the aim at 0.5 s]",
      data: { timeline: ev, target: tgt, aim: tgt.aim, gun: W.get("pistol").state() },
    };
  },
});
