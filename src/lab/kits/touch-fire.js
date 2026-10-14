/* lab kit "touch-fire": the phone's red attack button (#tfire, systems/touch.js)
   pressed with a real synthetic touch, in Gang City or the prison, unarmed or
   holding a gun, third or first person. The question it answers is the
   owner's: "the attack button doesn't work in Gang City".

   The press is a TouchEvent on the button itself (touch.js holdBtn), after a
   first touch on the window has armed the touch layer the way a phone's first
   finger does. What a press DID is read off the game's own doors:
     swings   CBZ.verbs.strike calls (every fist / bat / knife blow is one)
     shots    rounds that left the held gun (fps.rounds dropped)

   params: mode city|escape (default city), arm fists|gun|holstered (default fists),
           view tp|fp (default tp)
   probe:  ok when a fists press threw a blow and a gun press fired a round. */
CBZ.lab.kit("touch-fire", {
  about: "press the touch FIRE button with a synthetic touch: unarmed it must throw a blow, armed it must fire (city or prison, TP or FP)",
  uses: ["player"],
  files: ["src/systems/touch.js", "src/systems/verbs.js", "src/entities/verbposes.js", "src/entities/meleeposes.js", "src/systems/verbs_strike.js", "src/systems/melee.js", "src/systems/combat.js", "src/city/combat.js", "src/systems/fpsmode.js", "src/weapons/weapon-data.js"],
  params: { mode: "city", arm: "fists", view: "tp" },
  duration: 1.2,
  setup: function (W, P) {
    W.add("player", { name: "you", at: [0, 0] });
    const V = CBZ.verbs;
    W.swings = 0; W.shots = 0;
    if (V && V.strike) {
      const real = V.strike;
      V.strike = function () { const S = real.apply(this, arguments); if (S) W.swings++; return S; };
    }
    if (P.arm === "gun" || P.arm === "holstered") {
      if (CBZ.cityGiveWeapon && CBZ.game.mode === "city") CBZ.cityGiveWeapon("Pistol");
      else if (CBZ.unlockWeapon) CBZ.unlockWeapon("sidearm", { select: true });
      // holstered = the city's sandbox start (city/mode.js): you own a gun,
      // it rides on the belt, and FIRE is a punch until you draw
      const h = P.arm === "holstered";
      CBZ.game.cityHolstered = h; CBZ.game.prisonHolstered = h;
    }
    if (CBZ.setFPS) CBZ.setFPS(P.view === "fp");
    W.fire = document.getElementById("tfire");
  },
  script: function (W) {
    function touch(el, type, x, y) {
      const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
      const e = new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [t], targetTouches: type === "touchend" ? [] : [t], changedTouches: [t] });
      el.dispatchEvent(e);
    }
    function rounds() { const f = CBZ.fps; return f && f.rounds ? f.rounds[f.weapon] : null; }
    return [
      // the first finger anywhere arms the touch layer (touch.js builds the cluster)
      [0.05, function () { touch(document.body, "touchstart", 10, 10); touch(document.body, "touchend", 10, 10); W.fire = document.getElementById("tfire"); W.event("you", W.fire ? "touch layer on" : "NO #tfire"); }, "first finger"],
      [0.2, function () { W.r0 = rounds(); if (W.fire) touch(W.fire, "touchstart", 300, 500); }, "press FIRE"],
      [0.45, function () { if (W.fire) touch(W.fire, "touchend", 300, 500); W.r1 = rounds(); }, "lift FIRE"],
    ];
  },
  probe: function (W, P) {
    const shots = W.r0 != null && W.r1 != null ? Math.max(0, W.r0 - W.r1) : 0;
    const gun = P.arm === "gun";
    const armed = !!((CBZ.cityHasGun && CBZ.game.mode === "city" && CBZ.cityHasGun()) || (CBZ.fpsArmed && CBZ.fpsArmed()));
    const ok = !!W.fire && (gun ? shots > 0 && armed : W.swings > 0 && shots === 0);
    return {
      ok: ok,
      summary: P.mode + " " + P.view + " " + P.arm + ": button " + (W.fire ? "found" : "MISSING") + ", armed " + armed + ", swings " + W.swings + ", rounds fired " + shots,
      data: { swings: W.swings, shots: shots, armed: armed, fp: !!(CBZ.fps && CBZ.fps.active), rounds: [W.r0, W.r1] },
    };
  },
});
