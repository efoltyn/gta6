/* lab kit "detain": somebody is cuffed and taken in, and the body never pops
   out of existence in front of the player.

   OWNER (Gang City): "when you detain someone, they just disappear after they
   get arrested, which is dumb." The game's one arrest pipeline runs here for
   real: city/restrain.js (the ONE restraint enum: cuffed / escorted /
   boarding / in_vehicle), CBZ.verbs (the hands: cuffs on the wrists behind
   the back, the escort hold), city/custody.js (the job: the unit that pulls
   up, the back door, the drive away, the walk-in at the desk) and
   city/boarding.js (the back seat reached on foot through a real door, the
   rig seated by npclife, visible through the glass). Mode is "city": those
   ticks only run there.

   flow  player   the player cuffs a man with his hands up, marches him, radios
                  it in; a cruiser (custody.js's unit, a real cityMakeCar car)
                  rolls up, he is put in the back seat, the car drives off
         officer  a police officer on foot takes him (custody.take): order,
                  cuffs, frisk, walked to the cruiser that pulls up, back seat,
                  away
         desk     the player marches a WANTED man to the precinct desk and
                  hands him over: a desk officer walks him through the door
                  (a little room with a side door), gone once a wall is
                  between him and the player
   eyes  stare    (default) the player WATCHES him the whole way: the camera is
                  the player's head, aimed at the man every frame. The only
                  honest exits left are distance and walls.
         free     the camera stays where the kit left it
   car=0          no unit can come: he is walked off on foot

   probe: the man's state over time (cuffed, escorted, boarding, in car,
          away, gone) and every frame he stopped being drawn; FAIL when he
          stopped being drawn while in the player's view (on screen, no wall
          between, inside the 95 m living-rig band). */
CBZ.lab.kit("detain", {
  about: "a man is cuffed and taken in (player collar + radio, an officer's arrest, or the precinct desk); the probe fails if the body ever vanishes in the player's view",
  uses: ["person", "player", "car"],
  files: ["src/city/interactions.js", "src/systems/verbs.js", "src/city/restrain.js", "src/city/custody.js",
    "src/entities/npclife.js", "src/city/carseats.js", "src/city/boarding.js", "src/systems/spatialgrid.js"],
  mode: "city",
  depth: 0,
  params: { flow: "player", eyes: "stare", car: 1 },
  duration: 60,
  setup: function (W, P) {
    const THREE = window.THREE;
    const city = CBZ.city || (CBZ.city = {});
    // the player as an actor (city/mode.js's shape: what restrain/verbs hold)
    city.playerActor = city.playerActor || {
      isPlayer: true,
      get pos() { return CBZ.player.pos; },
      get group() { return CBZ.playerChar ? CBZ.playerChar.group : null; },
      get hp() { return CBZ.player.hp; }, set hp(v) { CBZ.player.hp = v; },
      get dead() { return !!CBZ.player.dead; },
    };
    // the arena root cityMakeCar parents a car under (ingredients/car.js's stub)
    if (!city.arena) {
      const host = W.root || (W.root = new THREE.Group());
      if (!host.parent) W.scene.add(host);
      city.arena = { root: host, roads: [], lab: true };
    }
    // the desk's payday lands on the HUD the lab does not have
    ["addCash", "addRespect", "big", "note"].forEach(function (k) { if (typeof city[k] !== "function") city[k] = function () {}; });
    CBZ.cityPeds = CBZ.cityPeds || [];
    CBZ.cityCops = CBZ.cityCops || [];
    CBZ.cityCars = CBZ.cityCars || [];
    if (P.car === "0" || P.car === 0) CBZ.cityMakeCar = null;   // no unit can come

    const flow = P.flow || "player";
    W.add("player", { name: "player", at: [0, 0], yaw: 0 });
    const man = W.add("person", { name: "man", at: [0, 2.2], yaw: 180, role: "gang", brain: false, cityPed: true, weapon: "none" });
    const M = man.actor;
    M.kind = "civ"; M.job = "civilian"; M.npcWanted = 0;
    if (flow === "desk") { M.bounty = 600; M.bountyTag = "Lab bounty"; }
    // hands up: he gave up (systems/arrest.js's rule: cuffable)
    M.surrender = true; M.poseHandsUp = true; if (M.char) M.char.handsUp = true;
    if (flow === "officer" || flow === "desk") {
      const cop = W.add("person", { name: "officer", at: flow === "desk" ? [2.4, 12] : [7, -5], yaw: 0, role: "cop", brain: false, cityPed: true, weapon: "none" });
      cop.actor.kind = "cop"; cop.actor.job = "police officer";
      CBZ.cityCops.push(cop.actor);
    }
    if (flow === "desk") {
      // a little precinct: a room x -5..5, z 14..22, its door a 1.6 m gap at x = 3
      const C = 0x8a8f99, o = { solid: true, blockLOS: true };
      CBZ.addBox(-1.4, 1.6, 14, 7.2, 3.2, 0.3, C, o);      // front wall, left of the door
      CBZ.addBox(4.4, 1.6, 14, 1.2, 3.2, 0.3, C, o);       // front wall, right of the door
      CBZ.addBox(0, 1.6, 22, 10, 3.2, 0.3, C, o);          // back
      CBZ.addBox(-5, 1.6, 18, 0.3, 3.2, 8, C, o);          // sides
      CBZ.addBox(5, 1.6, 18, 0.3, 3.2, 8, C, o);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      CBZ.cityPoliceStation = function () { return { x: 3, z: 13.6, lot: { cx: 0, cz: 18 } }; };
    }

    // ---- THE PLAYER'S EYES: the camera is his head, looking at the man ----
    const cam = CBZ.camera;
    const head = new THREE.Vector3(), aim = new THREE.Vector3(), ndc = new THREE.Vector3();
    function look() {
      if (P.eyes === "free" || !cam) return;
      const pp = CBZ.player.pos;
      head.set(pp.x, (pp.y || 0) + 1.7, pp.z);
      const mp = M.group.position;
      aim.set(mp.x, (mp.y || 0) + 1.1, mp.z);
      if (aim.distanceTo(head) < 0.3) aim.set(pp.x, 1.4, pp.z + 3);
      // a car he rides in: the seat is parented to it, so read the world position
      if (M.group.parent && M.group.parent !== W.scene) M.group.getWorldPosition(aim).y += 1.1;
      cam.position.copy(head); cam.lookAt(aim);
      cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    }
    look();

    // ---- what the probe reads, every frame ----
    const rec = W.detain = { t0: {}, drawnLast: true, vanish: [], gone: null, minVisibleDist: null, maxDist: 0, inCarT: 0, samples: [] };
    function attached(o) { let p = o; while (p) { if (p === W.scene) return true; p = p.parent; } return false; }
    function drawn() { return !M._gone && !!M.group && M.group.visible !== false && attached(M.group); }
    function where() { const v = new THREE.Vector3(); M.group.getWorldPosition(v); return v; }
    function inView() {
      if (!cam) return false;
      const w = where(), pp = CBZ.player.pos;
      const d = Math.hypot(w.x - pp.x, w.z - pp.z);
      if (d > 95) return false;                                    // past the living-rig band
      ndc.set(w.x, w.y + 1.0, w.z).project(cam);
      const on = ndc.z >= -1 && ndc.z <= 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
      if (!on) return false;
      return !(CBZ.npcOccluded && CBZ.npcOccluded(w.x, w.y, w.z, cam));
    }
    function stateNow() {
      const r = M.restraint, c = M._custody, j = CBZ.custody && CBZ.custody.jobOf ? CBZ.custody.jobOf(M) : null;
      if (!drawn()) return "gone";
      let s = r ? r.state : (c ? c.state : "free");
      if (s === "in_vehicle") s = j && j.departed ? "in car, driving away" : "in car";
      if (j && (j.phase === "walkoff" || j.phase === "walkin")) s += ", " + (j.phase === "walkin" ? "walked in" : "walked off");
      if (r && (r.state === "escorted") && r.officer) s += " by the officer";
      return s;
    }
    rec.stateNow = stateNow; rec.inView = inView; rec.drawn = drawn;
    let lastView = true;
    W.every(function () {
      look();
      const t = W.t();
      const s = stateNow();
      if (!(s in rec.t0)) rec.t0[s] = t;
      const dr = drawn();
      const w = where(), pp = CBZ.player.pos;
      // once he is out of the scene his rig's world position means nothing:
      // the distance at a vanish is the last one measured while drawn
      const d = dr ? Math.hypot(w.x - pp.x, w.z - pp.z) : (rec.lastD || 0);
      if (dr) rec.lastD = d;
      if (dr && d > rec.maxDist) rec.maxDist = d;
      if (rec.drawnLast && !dr) {
        rec.vanish.push({ t: +t.toFixed(2), dist: +d.toFixed(1), inView: lastView });
        W.event("man", (lastView ? "VANISHED IN VIEW" : "left the world out of view") + " at " + d.toFixed(1) + " m");
        if (rec.gone == null) rec.gone = { t: +t.toFixed(2), dist: +d.toFixed(1), inView: lastView };
      }
      if (/in car/.test(s)) rec.inCarT += L_dt();
      rec.drawnLast = dr;
      lastView = dr && inView();
    });
    function L_dt() { return (window.__lab && window.__lab.dt) || 1 / 60; }
    W.watch("man", "state", function () { return stateNow(); });
    W.watch("man", "in view", function () { return drawn() ? (inView() ? "yes" : "no") : null; });
    W.watch("custody", "phase", function () { const j = CBZ.custody && CBZ.custody.jobOf ? CBZ.custody.jobOf(M) : null; return j ? j.phase + (j.unit ? " / unit " + j.unit.state : "") : null; });
  },
  frame: function (W) { return W.subjects(); },
  script: function (W, P) {
    const man = W.get("man"), M = man.actor, pl = W.get("player");
    const R = function () { return CBZ.cityRestrain; };
    const flow = P.flow || "player";
    if (flow === "officer") {
      return [
        [0.5, function () { CBZ.custody.take(M, { by: "police", verb: "arrest", officers: [W.get("officer").actor], subdued: true }); }, "officer: takes him in (custody.take)"],
      ];
    }
    const s = [
      [0.3, function () { R().cuff(M); }, "player: cuffs him (restrain.cuff)"],
      [3.0, function () { R().escort(M); }, "player: marches him (restrain.escort)"],
    ];
    if (flow === "desk") {
      s.push([3.1, function () { pl.walkTo(3, 8.5); }, "player: walks him to the precinct door"]);
      s.push([12, function () { R().turnIn(M); }, "player: hands him over at the desk (restrain.turnIn)"]);
      s.push([20, function () { pl.walkTo(3, 11.5); }, "player: steps up to the door and looks in"]);
      return s;
    }
    s.push([3.1, function () { pl.walkTo(5, 7); }, "player: walks him up the street"]);
    s.push([8.0, function () { CBZ.custody.take(M, { by: "police", verb: "arrest", handsOff: true, owner: "player" }); }, "player: radios it in (custody.take, handsOff)"]);
    return s;
  },
  probe: function (W, P) {
    const r = W.detain, M = W.get("man").actor;
    const order = Object.keys(r.t0).sort(function (a, b) { return r.t0[a] - r.t0[b]; });
    const line = order.map(function (k) { return k + " " + r.t0[k].toFixed(1) + " s"; }).join(", ");
    const badVanish = r.vanish.filter(function (v) { return v.inView; });
    const cuffed = r.t0.cuffed != null || r.t0.escorted != null;
    const flow = P.flow || "player";
    let reached;
    if (flow === "desk") reached = /walked in/.test(order.join("|"));
    else if (P.car === "0" || P.car === 0) reached = /walked off/.test(order.join("|"));
    else reached = r.t0["in car"] != null;
    const ok = cuffed && reached && badVanish.length === 0;
    const end = r.gone ? "left the world at " + r.gone.t + " s, " + r.gone.dist + " m away, " + (r.gone.inView ? "IN VIEW" : "out of view") : "still in the world at the end (" + r.stateNow() + ")";
    return {
      ok: ok,
      summary: "flow " + flow + ": " + line + "; in car " + r.inCarT.toFixed(1) + " s; " + end +
        (badVanish.length ? "; VANISHED IN VIEW x" + badVanish.length : "; never vanished in view"),
      data: { timeline: r.t0, vanish: r.vanish, maxDist: +r.maxDist.toFixed(1), inCarSeconds: +r.inCarT.toFixed(1),
        custody: CBZ.custody && CBZ.custody.audit ? CBZ.custody.audit() : null,
        boarding: CBZ.boarding && CBZ.boarding.audit ? CBZ.boarding.audit() : null,
        restraint: M.restraint ? M.restraint.state : null },
    };
  },
});
