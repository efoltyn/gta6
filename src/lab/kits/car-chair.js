/* lab kit "car-chair": a real car (city/vehicles.js model on city/cardyn.js's
   chassis) drives into a loose chair (city/furniture.js + systems/pushables.js).

   lab.html?kit=car-chair&speed=8&offset=0.4&chair=chair&model=Bison%20Vista
     speed   cruise target, m/s (8 = ~18 mph)
     offset  the chair's lateral offset from the car's centre line, m
             (|offset| > ~1.3 is a miss: the bumper is 2 m wide)
     chair   chair | taskChair | stool
     model   any city/economy.js catalog name
     brakeAt sim second the driver stands on the brake (default 3.2)

   The car starts 10 m short of the chair, pointing at it, accelerates and
   holds `speed`. The chair is never told anything: pushables' carHit finds
   the car in CBZ.cityCars, flings the chair along the car's travel, tips it,
   and takes a breath of speed off the car.

   probe: ok when the chair went over and ended up downstream of where it
   stood (along the car's travel), and the car was not stopped by it. */
CBZ.lab.kit("car-chair", {
  about: "a real car drives into a loose chair: the chair is flung along its travel and tips",
  uses: ["car", "chair"],
  params: { speed: 8, offset: 0.3, chair: "chair", model: "Bison Vista", brakeAt: 3.2 },
  duration: 5,
  /* DEPTH 0: only the scripts these files need at LOAD. Every runtime read
     vehicles.js / playercars.js make outside that (CBZ.keys, cityIsRed,
     qualityLevel, playerChar, cam) sits on a city-mode path (the player's
     driving loop, the traffic loop) that the lab's mode never runs, and
     following them pulled core/quality.js (which reads CBZ.sun and builds the
     WebGL context at load, +1 s) and entities/player.js (which moves
     CBZ.player to the prison spawn, 40 m away, so pushables never looked at
     the chair). */
  depth: 0,
  setup: function (W, P) {
    W.add("chair", { name: "chair", at: [+P.offset || 0, 0], yaw: 180, kind: P.chair });
    const car = W.add("car", { name: "car", at: [0, -10], heading: 0, model: P.model });
    const ch = W.get("chair");
    const rec = { hitT: null, vBefore: null, vAfter: null, tipT: null, x0: ch.pos().x, z0: ch.pos().z, maxD: 0 };
    W.carChair = rec;
    // the contact, read off the real record: pushables stamps the piece's
    // _carT the frame a car flings it
    let lastCarT = 0, prevV = 0;
    W.every(function () {
      const pc = ch.piece, v = car.speed();
      if (pc && pc._carT && pc._carT !== lastCarT) {
        lastCarT = pc._carT;
        if (rec.hitT == null) { rec.hitT = W.t(); rec.vBefore = prevV; W.event("car", "hit the chair at " + prevV.toFixed(2) + " m/s"); }
      }
      if (rec.hitT != null && rec.vAfter == null && W.t() - rec.hitT >= 0.1) rec.vAfter = v;
      if (rec.tipT == null && ch.tipped()) rec.tipT = W.t();
      const p = ch.pos();
      rec.maxD = Math.max(rec.maxD, Math.hypot(p.x - rec.x0, p.z - rec.z0));
      prevV = v;
    });
  },
  script: function (W, P) {
    return [
      [0, function () { W.get("car").drive(+P.speed || 8); }, "car: drive at " + (+P.speed || 8) + " m/s"],
      [+P.brakeAt || 3.2, function () { W.get("car").brake(); }, "car: brake"],
    ];
  },
  frame: function (W) { return [W.get("chair").obj, W.get("car").obj]; },
  probe: function (W, P) {
    const r = W.carChair, ch = W.get("chair"), car = W.get("car");
    const cs = ch.state(), ks = car.state();
    const p = ch.pos();
    const along = p.z - r.z0, lat = p.x - r.x0;           // the car drives +z
    const lost = r.vBefore ? 1 - (r.vAfter != null ? r.vAfter : car.speed()) / r.vBefore : null;
    const stoppedByChair = r.hitT != null && r.vAfter != null && r.vAfter < 0.5 * r.vBefore;
    const ok = r.hitT != null && cs.tipped && along > 0.5 && !stoppedByChair;
    const fmt = function (v, n) { return v == null ? "-" : v.toFixed(n == null ? 2 : n); };
    const summary = r.hitT == null
      ? "car never touched the chair (offset " + P.offset + " m, car reached " + ks.maxSpeed + " m/s)"
      : "hit at " + fmt(r.hitT) + " s at " + fmt(r.vBefore) + " m/s; chair " + (cs.tipped ? "tipped at " + fmt(r.tipT) + " s" : "did NOT tip") +
        ", flung " + fmt(Math.hypot(along, lat)) + " m (" + fmt(along) + " along, " + fmt(lat) + " across); car lost " +
        (lost == null ? "-" : (lost * 100).toFixed(1) + "%") + " speed" + (stoppedByChair ? " (STOPPED by the chair)" : ", not stopped by it");
    return {
      ok: ok, summary: summary,
      data: { hitT: r.hitT, tipT: r.tipT, vBefore: r.vBefore, vAfter: r.vAfter, speedLostFrac: lost, flungAlong: along, flungAcross: lat,
        maxDisplacement: r.maxD, chair: cs, car: ks },
    };
  },
});
