/* ============================================================
   systems/markers.js — contextual actor markers plus the shared
   cityTargetsPlayer() hostility predicate used by map surfaces.

   Hostility is communicated by actor behavior, sound, and the map — never
   by a floating marker over an enemy or predator's head.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  const tc = document.createElement("canvas");
  tc.width = tc.height = 64;
  const tx = tc.getContext("2d");
  tx.fillStyle = "#ffd451";
  tx.strokeStyle = "rgba(0,0,0,.65)"; tx.lineWidth = 5;
  tx.beginPath();
  tx.arc(32, 26, 14, 0, Math.PI * 2);
  tx.fill(); tx.stroke();
  tx.beginPath();
  tx.lineWidth = 6;
  tx.moveTo(42, 38); tx.lineTo(54, 52);
  tx.stroke();
  const tipTex = new THREE.CanvasTexture(tc);

  const sc = document.createElement("canvas");
  sc.width = sc.height = 64;
  const sx = sc.getContext("2d");
  sx.fillStyle = "#f7f1df";
  sx.strokeStyle = "rgba(0,0,0,.65)"; sx.lineWidth = 5;
  sx.beginPath();
  sx.arc(32, 26, 17, 0, Math.PI * 2);
  sx.fill(); sx.stroke();
  sx.fillStyle = "#ff7a1a";
  sx.font = "bold 34px Fredoka, Arial, sans-serif";
  sx.textAlign = "center"; sx.textBaseline = "middle";
  sx.fillText("!", 32, 29);
  const snitchTex = new THREE.CanvasTexture(sc);

  const ac = document.createElement("canvas");
  ac.width = ac.height = 64;
  const ax = ac.getContext("2d");
  ax.fillStyle = "#ffb020";
  ax.strokeStyle = "rgba(0,0,0,.65)"; ax.lineWidth = 5;
  ax.beginPath();
  ax.arc(32, 32, 13, 0, Math.PI * 2);
  ax.fill(); ax.stroke();
  ax.fillStyle = "#1a1207";
  ax.font = "bold 30px Fredoka, Arial, sans-serif";
  ax.textAlign = "center"; ax.textBaseline = "middle";
  ax.fillText("!", 32, 32);
  const alertTex = new THREE.CanvasTexture(ac);

  const offerTex = {};
  function makeOfferTexture(ch, bg, fg) {
    const key = ch + bg + fg;
    if (offerTex[key]) return offerTex[key];
    const oc = document.createElement("canvas");
    oc.width = oc.height = 64;
    const ox = oc.getContext("2d");
    ox.fillStyle = bg;
    ox.strokeStyle = "rgba(0,0,0,.68)";
    ox.lineWidth = 5;
    ox.beginPath();
    ox.roundRect ? ox.roundRect(9, 12, 46, 38, 10) : ox.rect(9, 12, 46, 38);
    ox.fill();
    ox.stroke();
    ox.fillStyle = fg;
    ox.font = "bold 32px Fredoka, Arial, sans-serif";
    ox.textAlign = "center";
    ox.textBaseline = "middle";
    ox.fillText(ch, 32, 32);
    offerTex[key] = new THREE.CanvasTexture(oc);
    return offerTex[key];
  }

  /* ---- THE ICONS ARE DEPTH-TESTED NOW -------------------------------------
     Every one of these was `depthTest: false`, which is not a style choice —
     it is a wallhack. A snitch two cells away, a guard on the far side of the
     block and every offer in the south wing floated THROUGH solid geometry,
     so the prison's whole social layer was readable from the yard without
     walking anywhere. Turning depth back on hands that information to the
     walls the rest of the game already respects, and `depthWrite:false` keeps
     the transparent quads from fighting each other for sort order. */
  function markerMat(map) {
    return new THREE.SpriteMaterial({
      map: map, depthTest: true, depthWrite: false, transparent: true, opacity: 0,
    });
  }

  function makeTipMarker() {
    const spr = new THREE.Sprite(markerMat(tipTex));
    spr.scale.set(0.72, 0.72, 1);
    spr.position.y = 3.8;
    spr.visible = false;
    return spr;
  }

  function makeSnitchMarker() {
    const spr = new THREE.Sprite(markerMat(snitchTex));
    spr.scale.set(0.66, 0.66, 1);
    spr.position.y = 3.85;
    spr.visible = false;
    return spr;
  }

  function makeAlertMarker() {
    const spr = new THREE.Sprite(markerMat(alertTex));
    spr.scale.set(0.42, 0.42, 1);
    spr.position.y = 3.55;
    spr.visible = false;
    return spr;
  }

  function makeApproachMarker() {
    const spr = new THREE.Sprite(markerMat(makeOfferTexture("?", "#f7f1df", "#111827")));
    spr.scale.set(0.66, 0.52, 1);
    spr.position.y = 3.55;
    spr.visible = false;
    return spr;
  }

  function hunting(a) {
    return (a.hunt > 0 || a.huntPlayer > 0) && !a.dead && !(a.ko > 0) && !a.escaped;
  }

  // One binary fact for every tactical surface: is this LIVE actor currently
  // committed to harming/capturing the player? Cops, gangs, terrorists,
  // soldiers and predators all publish through their real brain state; map UI
  // no longer guesses from costume ("all cops red") or weapon alone.
  function cityTargetsPlayer(a) {
    if (!a || a.dead || (a.ko || 0) > 0 || a.escaped) return false;
    const pa = CBZ.city && CBZ.city.playerActor;
    if (a.animal) return a.state === "charge" || a.state === "stalk" || a.attackPlayer === true || a.targetPlayer === true || a.target === pa;
    if (a.curTarget === pa || a.npcTarget === pa || a.rage === pa || a.target === pa || a.targetActor === pa || a._aimTgt === pa) return true;
    if (a.huntPlayer > 0 || a.attackPlayer === true || a.targetPlayer === true) return true;
    // Some faction brains store the literal player record instead of the city
    // adapter.  Accept those explicit pointers, but never infer hostility just
    // because an actor is armed or belongs to an organization.
    if (a.curTarget === CBZ.player || a.rage === CBZ.player || a.target === CBZ.player || a.targetActor === CBZ.player) return true;
    return false;
  }
  CBZ.cityTargetsPlayer = cityTargetsPlayer;

  function guardish(a) {
    return !!(a && (a.wedge || a.kind === "guard" || a.kind === "warden"));
  }

  function approachStyle(kind) {
    if (kind === "tax" || kind === "snitchThreat" || kind === "debtCollect" || kind === "jobThreat" || kind === "infoSell" || kind === "stashCover" || kind === "racketCover" || kind === "coverDebt" || kind === "witnessFix" || kind === "recantOffer" || kind === "crewDues" || kind === "stickUp" || kind === "alibiDeal" || kind === "witnessBlackmail" || kind === "payoffOffer" || kind === "racketOffer" || kind === "snitchIntel") {
      return { ch: "$", bg: "#172033", fg: "#ffd451" };
    }
    if (kind === "coverStory" || kind === "favor" || kind === "lookout" || kind === "crewBackup" || kind === "gangJob" || kind === "gangParley" || kind === "gangInvite" || kind === "reputation" || kind === "heatWarning") {
      return { ch: "+", bg: "#16351f", fg: "#8dff9f" };
    }
    if (kind === "turfWarning" || kind === "copTaunt" || kind === "copTip" || kind === "copPlea") {
      return { ch: "!", bg: "#3d2113", fg: "#ffb020" };
    }
    return { ch: "?", bg: "#f7f1df", fg: "#111827" };
  }

  // overhead-marker height: just above the (unscaled-root) character's head.
  // Post HUMAN_SCALE=0.70 the old 3.55–3.85 literals (tuned to the 2.60u rig)
  // floated a metre high; CBZ.charHeadY(a) resolves to ~1.97 (head 1.82 + margin).
  // Guard-called so a missing helper falls back to the old flush-head value.
  const headY = (a) => (CBZ.charHeadY ? CBZ.charHeadY(a) : 1.97);

  /* ============================================================
     WHEN AN ICON IS ALLOWED TO EXIST — the conversation gate.

     The information these four sprites carry (this man will talk to you, this
     man has already talked ABOUT you, this screw is getting suspicious) is
     good information. It was being delivered at the wrong moment, to a player
     stood 40 m away who could do nothing about it, THROUGH the walls of the
     room it was happening in. So the icon becomes a property of BEING THERE:

       range   3.8 m — systems/interact.js's own RANGE (3.6) plus a hair, so
               the icon appears a step before the verbs it advertises do and
               can never promise a conversation the panel then refuses.
       facing  you are looking roughly at him (dot > 0.30, a ~72° half-cone).
               An icon behind your head is a HUD element, not a world one.
       sight   one raycast against CBZ.losBlockers. Depth-testing the sprite
               hides it behind a wall visually; this stops it being MISSED-BY-
               A-PIXEL visible round a door frame and, more usefully, stops us
               paying for the fade at all through a solid wall.
       fade    0.22 s in and out. A sprite that pops is a notification; a
               sprite that fades is something you walked up to.

     Cost is lower than what it replaces: the state tests and the four
     `visible` writes now run only for actors already inside 3.8 m (typically
     none to three), and the raycast only for those.
     ============================================================ */
  const NEAR = 3.8, NEAR2 = NEAR * NEAR;
  const FADE = 4.5;                        // opacity units per second (≈0.22 s)
  const FACE_DOT = 0.30;
  const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
  const _ray = new THREE.Raycaster();

  function seesActor(a, dist) {
    const bl = CBZ.losBlockers;
    if (!bl || !bl.length || !CBZ.player) return true;
    const p = CBZ.player.pos;
    _ro.set(p.x, (p.y || 0) + 1.35, p.z);
    _rd.set(a.group.position.x - p.x, headY(a) - 0.35 - ((p.y || 0) + 1.35), a.group.position.z - p.z).normalize();
    _ray.set(_ro, _rd);
    _ray.far = Math.max(0.1, dist - 0.45);
    return (CBZ.losRaycast ? CBZ.losRaycast(_ray, bl) : _ray.intersectObjects(bl, false)).length === 0;
  }

  // one fade channel per actor, shared by whichever of its four sprites is up
  function fadeTo(a, want, dt) {
    const cur = a._markFade || 0;
    const next = want ? Math.min(1, cur + dt * FADE) : Math.max(0, cur - dt * FADE);
    a._markFade = next;
    return next;
  }
  function paint(spr, on, op, y) {
    const vis = on && op > 0.02;
    if (spr.visible !== vis) spr.visible = vis;
    if (!vis) return;
    spr.material.opacity = op;
    spr.position.y = y;
  }

  function tick(dt) {
    // Context markers below belong to the prison rosters. City hostility stays
    // physical and diegetic; cityTargetsPlayer() remains available to maps.
    if (CBZ.game && CBZ.game.mode === "city") return;
    dt = dt > 0 ? Math.min(dt, 0.1) : 0.016;
    const bob = 0.12 * Math.sin(CBZ.now * 0.006);
    const p = CBZ.player && CBZ.player.pos;
    const pc = CBZ.playerChar;
    // player facing: (sin h, cos h), the convention systems/minimap.js reads
    const h = pc && pc.group ? pc.group.rotation.y : 0;
    const fx = Math.sin(h), fz = Math.cos(h);
    const all = CBZ.guards.concat(CBZ.npcs);
    for (const a of all) {
      // ---- the wedge is not a marker: it belongs to the torch, and a guard
      //      50 m away must still show his beam. Kept outside the gate.
      if (guardish(a) && a.wedge) a.wedge.visible = !!a.flashlightOn;

      const near = a._markFade > 0 || (p && !a.escaped &&
        (a.group.position.x - p.x) * (a.group.position.x - p.x) +
        (a.group.position.z - p.z) * (a.group.position.z - p.z) < NEAR2);
      if (!near) continue;                       // no sprites, no state tests

      if (!a._tipMarker) { a._tipMarker = makeTipMarker(); a.group.add(a._tipMarker); }
      if (!a._snitchMarker) { a._snitchMarker = makeSnitchMarker(); a.group.add(a._snitchMarker); }
      if (!a._alertMarker) { a._alertMarker = makeAlertMarker(); a.group.add(a._alertMarker); }
      if (!a._approachMarker) { a._approachMarker = makeApproachMarker(); a.group.add(a._approachMarker); }

      // A HUNT IS THE THREAT, NOT THE TORCH. This used to require a guard's
      // flashlight to be ON before his hunt counted as hostile — which only
      // ever worked because entities/guards.js lit the beam for every hunt,
      // including a midday sprint across the yard. Now that a torch is a
      // dark-hours tool again, a guard chasing you under the sun would have
      // fallen through to `softAlert` and grown a friendly "walk up and talk"
      // marker over his head mid-charge. Ask the brain state directly.
      const hostile = hunting(a);
      const softAlert = !hostile && guardish(a) && (a.alert || 0) > 0.15 && !a.flashlightOn && !a.dead && !(a.ko > 0);
      const tip = !hostile && CBZ.game && CBZ.game.role === "cop" && a.copMarked > 0 && !a.dead && !(a.ko > 0) && !a.escaped;
      const knownReport = (a.reportedPlayerT || 0) > 0;
      const snitch = !hostile && !tip && (a.aiState === "snitch" || knownReport) && !a.dead && !(a.ko > 0) && !a.escaped;
      const offer = !hostile && !tip && !snitch && a.approach && a.approach.t > 0 && !a.dead && !(a.ko > 0) && !a.escaped;

      // eligible = has something to say AND you are walking up to him
      let want = softAlert || tip || snitch || offer;
      if (want && p) {
        const dx = a.group.position.x - p.x, dz = a.group.position.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= NEAR2) want = false;
        else {
          const d = Math.sqrt(d2) || 1e-4;
          if ((dx / d) * fx + (dz / d) * fz < FACE_DOT) want = false;
          else if (!seesActor(a, d)) want = false;
        }
      }
      const op = fadeTo(a, want, dt);
      paint(a._alertMarker, softAlert, op, headY(a) + bob * 0.55);
      paint(a._tipMarker, tip, op, headY(a) + bob);
      paint(a._snitchMarker, snitch, op, headY(a) + bob);
      if (snitch) a._snitchMarker.scale.setScalar(knownReport ? 0.56 : 0.66);
      if (offer) {
        const s = approachStyle(a.approach.kind);
        a._approachMarker.material.map = makeOfferTexture(s.ch, s.bg, s.fg);
      }
      paint(a._approachMarker, offer, op, headY(a) + bob);
    }
  }

  CBZ.onAlways(60, tick);
})();
