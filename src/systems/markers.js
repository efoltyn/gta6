/* ============================================================
   systems/markers.js — a floating red chevron over the head of ANY
   actor currently hunting the player: hunting guards AND provoked
   gang members alike. Bobbing, billboarded, impossible to miss.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  // red downward chevron texture
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  x.fillStyle = "#ff2a3a";
  x.strokeStyle = "rgba(0,0,0,.6)"; x.lineWidth = 5;
  x.beginPath();
  x.moveTo(10, 14); x.lineTo(54, 14); x.lineTo(32, 50); x.closePath();
  x.fill(); x.stroke();
  const tex = new THREE.CanvasTexture(c);

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

  function makeMarker() {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(0.8, 0.8, 1);
    spr.position.y = 3.7;
    spr.visible = false;
    return spr;
  }

  function makeTipMarker() {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tipTex, depthTest: false, transparent: true }));
    spr.scale.set(0.72, 0.72, 1);
    spr.position.y = 3.8;
    spr.visible = false;
    return spr;
  }

  function makeSnitchMarker() {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: snitchTex, depthTest: false, transparent: true }));
    spr.scale.set(0.66, 0.66, 1);
    spr.position.y = 3.85;
    spr.visible = false;
    return spr;
  }

  function makeAlertMarker() {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: alertTex, depthTest: false, transparent: true }));
    spr.scale.set(0.42, 0.42, 1);
    spr.position.y = 3.55;
    spr.visible = false;
    return spr;
  }

  function makeApproachMarker() {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeOfferTexture("?", "#f7f1df", "#111827"),
      depthTest: false,
      transparent: true,
    }));
    spr.scale.set(0.66, 0.52, 1);
    spr.position.y = 3.55;
    spr.visible = false;
    return spr;
  }

  function hunting(a) {
    return (a.hunt > 0 || a.huntPlayer > 0) && !a.dead && !(a.ko > 0) && !a.escaped;
  }

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

  function tick() {
    // hunt/snitch/approach chevrons ride the PRISON rosters (CBZ.guards/npcs);
    // the city has its own actors. Skip in city — the concat below allocated a
    // fresh array every frame in every mode for nothing.
    if (CBZ.game && CBZ.game.mode === "city") return;
    const bob = 0.12 * Math.sin(CBZ.now * 0.006);
    const all = CBZ.guards.concat(CBZ.npcs);
    for (const a of all) {
      if (!a._marker) { a._marker = makeMarker(); a.group.add(a._marker); }
      if (!a._tipMarker) { a._tipMarker = makeTipMarker(); a.group.add(a._tipMarker); }
      if (!a._snitchMarker) { a._snitchMarker = makeSnitchMarker(); a.group.add(a._snitchMarker); }
      if (!a._alertMarker) { a._alertMarker = makeAlertMarker(); a.group.add(a._alertMarker); }
      if (!a._approachMarker) { a._approachMarker = makeApproachMarker(); a.group.add(a._approachMarker); }
      if (guardish(a) && a.wedge) a.wedge.visible = !!a.flashlightOn;
      const on = hunting(a) && (!guardish(a) || !!a.flashlightOn);
      a._marker.visible = on;
      if (on) a._marker.position.y = headY(a) + bob;
      const softAlert = !on && guardish(a) && (a.alert || 0) > 0.15 && !a.flashlightOn && !a.dead && !(a.ko > 0);
      a._alertMarker.visible = !!softAlert;
      if (softAlert) a._alertMarker.position.y = headY(a) + bob * 0.55;
      const tip = !on && CBZ.game && CBZ.game.role === "cop" && a.copMarked > 0 && !a.dead && !(a.ko > 0) && !a.escaped;
      a._tipMarker.visible = !!tip;
      if (tip) a._tipMarker.position.y = headY(a) + bob;
      const knownReport = (a.reportedPlayerT || 0) > 0;
      const snitch = !on && !tip && (a.aiState === "snitch" || knownReport) && !a.dead && !(a.ko > 0) && !a.escaped;
      a._snitchMarker.visible = !!snitch;
      if (snitch) {
        a._snitchMarker.position.y = headY(a) + bob;
        a._snitchMarker.scale.setScalar(knownReport ? 0.56 : 0.66);
      }
      const offer = !on && !tip && !snitch && a.approach && a.approach.t > 0 && !a.dead && !(a.ko > 0) && !a.escaped;
      a._approachMarker.visible = !!offer;
      if (offer) {
        const s = approachStyle(a.approach.kind);
        a._approachMarker.material.map = makeOfferTexture(s.ch, s.bg, s.fg);
        a._approachMarker.position.y = headY(a) + bob;
      }
    }
  }

  CBZ.onAlways(60, tick);
})();
