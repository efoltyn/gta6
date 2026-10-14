/* lab kit "dismiss": let go of a man who works for you, and watch him leave.

   OWNER (Gang City): "when you dismiss someone, it still says their role over
   their head, and it's just dumb. And they do this weird animation where they
   walk and turn in a circle and start crouching."

   The player walks; one of his people (a crewman on CBZ.brain's crew
   archetype, CBZ.brain.employ'd as "Crew" on the player's side, a pistol on
   his belt) follows a stride and a half behind his shoulder; a second
   crewman stands at the player's side with his pistol OUT (the President's
   detail, your crew with their guns drawn). At `at` s the follower is let go:

     mode=brain   (default) CBZ.brain.dismiss: the job record ends, every
                  job-held thing in his head goes, he nods, says a line and
                  walks to his home (`home`, default 24,-18)
     mode=legacy  the city's old way: the follow flag and the crew side
                  cleared by hand, nothing else (what careers.js's payroll
                  walk-off and president_staff.js's walk did)

   probe, over the 10 s after the dismissal:
     label     what the name over his head reads (CBZ.brain.job's title, else
               his name: city/roles.js titleOf's rule)
     stance    seconds spent crouched / cowering / hands up / aiming
     spin      total heading turned (deg) and the heading turned per metre
               walked (path curvature); a man walking off turns once
     dest      metres from home at the end, and whether he got there
     said      his line
   ok = label cleared, no crouch/cower, spin under 270 deg, ended nearer home.

   params: mode brain|legacy, at (s, default 3), home "x,z", line */
CBZ.lab.kit("dismiss", {
  about: "a follower is dismissed: does his role tag clear, does he crouch or spin, does he walk home",
  uses: ["person", "gun", "player"],
  params: { mode: "brain", at: 3, home: "24,-18", line: "Alright. I'm gone." },
  duration: 13.5,
  setup: function (W, P) {
    W.add("player", { name: "boss", at: [0, 0], yaw: 0 });
    W.add("person", { name: "follower", at: [0.9, -1.6], yaw: 0, role: "crew" });
    W.add("person", { name: "partner", at: [1.3, 0.6], yaw: 0, role: "crew" });
    W.add("gun", { name: "pistol", holder: "partner", weapon: "Pistol" });
    W.marks = { samples: [] };
  },
  frame: function (W) { return W.subjects(); },
  script: function (W, P) {
    const boss = W.get("boss"), fol = W.get("follower"), par = W.get("partner");
    const at = +P.at || 3;
    const hp = String(P.home || "24,-18").split(",").map(Number);
    const home = { x: hp[0], z: hp[1] };
    W.marks.home = home; W.marks.at = at;
    // sample the follower every frame from the dismissal on
    let last = null;
    W.every(function () {
      const t = W.t();
      if (t < at) return;
      const a = fol.actor, g = a.group, p = g.position;
      const s = { t: t, x: p.x, z: p.z, yaw: g.rotation.y, pose: fol.pose(), posture: CBZ.moves ? CBZ.moves.posture(a) : "stand", label: fol.label() };
      if (last && t - last.t < 1e-6) return;
      W.marks.samples.push(s); last = s;
    });
    return [
      [0.05, function () {
        fol.employ(boss, "Crew", "player"); par.employ(boss, "Crew", "player");
        fol.follow(boss); W.get("pistol").draw();
      }, "the follower and the partner work for the boss; the partner's gun is out"],
      [0.3, function () { boss.walkTo(0, 6); }, "boss: walk on"],
      [at, function () {
        if (P.mode === "legacy") fol.dismissLegacy();
        else fol.dismiss({ from: boss, to: home, line: P.line });
      }, "dismiss the follower (" + (P.mode === "legacy" ? "legacy" : "brain") + ")"],
    ];
  },
  probe: function (W, P) {
    const S = W.marks.samples, home = W.marks.home, at = W.marks.at;
    const win = S.filter(function (s) { return s.t <= at + 10; });
    const R2 = function (v) { return Math.round(v * 100) / 100; };
    let spin = 0, walked = 0, crouch = 0, cower = 0, hands = 0, aim = 0;
    const DEG = 180 / Math.PI;
    for (let i = 1; i < win.length; i++) {
      const a = win[i - 1], b = win[i], dt = b.t - a.t;
      let d = b.yaw - a.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      spin += Math.abs(d);
      walked += Math.hypot(b.x - a.x, b.z - a.z);
      if (b.posture === "crouch" || b.pose === "crouched") crouch += dt;
      if (b.pose === "cowering") cower += dt;
      if (b.pose === "hands_up" || b.pose === "kneeling_hands_up") hands += dt;
      if (b.pose === "aiming") aim += dt;
    }
    const s0 = win[0] || { x: 0, z: 0, label: "" }, s1 = win[win.length - 1] || s0;
    const d0 = Math.hypot(home.x - s0.x, home.z - s0.z), d1 = Math.hypot(home.x - s1.x, home.z - s1.z);
    const labelAfter = s1.label, labelAt = (win[Math.min(win.length - 1, 30)] || s1).label;
    const said = (W.log.filter(function (e) { return e.who === "follower" && /^says /.test(e.what); })[0] || {}).what || null;
    const poses = [];
    W.log.forEach(function (e) { if (e.who === "follower" && e.t >= at && /^pose: /.test(e.what)) poses.push(e.what.slice(6) + "@" + (e.t - at).toFixed(1)); });
    const out = {
      mode: P.mode === "legacy" ? "legacy" : "brain",
      label: labelAfter, labelAt0_5s: labelAt,
      stance: { crouchS: R2(crouch), cowerS: R2(cower), handsUpS: R2(hands), aimS: R2(aim) },
      spinDeg: Math.round(spin * DEG), walkedM: R2(walked), degPerM: walked > 0.5 ? Math.round(spin * DEG / walked) : null,
      home: { startM: R2(d0), endM: R2(d1), arrived: d1 < 2 },
      said: said, poses: poses.slice(0, 12),
      brain: W.get("follower").state().brain,
    };
    const ok = labelAfter !== "Crew" && crouch + cower < 0.1 && out.spinDeg < 270 && d1 < d0 - 5;
    return {
      ok: ok,
      summary: "[" + out.mode + "] 10 s after dismiss: label '" + labelAfter + "', crouch " + out.stance.crouchS + " s, cower " + out.stance.cowerS +
        " s, aim " + out.stance.aimS + " s, heading turned " + out.spinDeg + " deg over " + out.walkedM + " m (" + (out.degPerM == null ? "-" : out.degPerM) +
        " deg/m), home " + out.home.startM + " -> " + out.home.endM + " m" + (out.home.arrived ? " (arrived)" : "") + ", said " + (said ? said.slice(5) : "nothing"),
      data: out,
    };
  },
});
