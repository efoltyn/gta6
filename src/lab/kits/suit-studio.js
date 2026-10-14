/* lab kit "suit-studio": suited people of every build stood in a row, for
   looking at how a jacket sits (the shoulders, the sleeve head, the collar).

   Each body is the shipped rig (CBZ.human.build with a physique and a build),
   dressed through the one wardrobe door (CBZ.human.dress -> city/clothes.js
   applyClothes: the jacket shell, the sleeve heads, the tailored atlas), and
   animated by CBZ.animChar, the same layer that poses every person in the game.

   params: outfit   an outfits.js catalog id (default exec_suit, the chalk
                    stripe; staff_grey, president_suit, detail, suit, warden...)
           arms     rest | up (hands up: ch.handsUp) | aim (ch.aimingPose) |
                    walk (mid-stride) — default rest
           builds   comma list of m|f + physique (default
                    m-average,m-slim,m-heavy,m-muscular,f-average)
           focus    index into the row: the cameras frame that one body only
           gap      metres between bodies (default 1.1)
           crop     top: the cameras frame chest-up (the shoulders)
           hide     jacket,caps,chest,collar,arms: layers taken off (debug)
   probe:  how many bodies wore a jacket shell. */
CBZ.lab.kit("suit-studio", {
  about: "suited bodies of several builds in a row (rest / hands up / aim / walk): look at the jacket's shoulders, sleeve heads and collar",
  files: ["src/entities/character.js", "src/entities/gait.js", "src/entities/heritage.js", "src/city/clothes.js", "src/city/outfits.js"],
  symbols: ["human", "animChar", "cityOutfitCatalog", "cityApplyClothes"],
  params: { outfit: "exec_suit", arms: "rest" },
  duration: 1.5,
  setup: function (W, P) {
    const builds = String(P.builds || "m-average,m-slim,m-heavy,m-muscular,f-average").split(",");
    const gap = +P.gap || 1.1;
    W.rigs = [];
    builds.forEach(function (b, i) {
      const m = /^(m|f)-?(\w+)?$/.exec(b.trim()) || [];
      const ch = CBZ.human.build({ build: m[1] || "m", physique: m[2] || "average", skin: 0xc79a7a, hair: 0x2b2018 });
      const grp = ch.group;
      grp.position.set((i - (builds.length - 1) / 2) * gap, 0, 0);
      W.scene.add(grp);
      const dressed = CBZ.human.dress(ch, P.outfit || "exec_suit");
      // what the cameras frame: the body (or, crop=top, chest up), as an
      // invisible box: a rig's own bounds carry hidden parts
      const top = P.crop === "top";
      const fb = new THREE.Mesh(new THREE.BoxGeometry(0.75, top ? 0.75 : 1.85, 0.4), new THREE.MeshBasicMaterial());
      fb.visible = false; fb.position.set(grp.position.x, top ? 1.38 : 0.93, 0); W.scene.add(fb);
      W.rigs.push({ ch: ch, grp: grp, fb: fb, build: b, dressed: dressed });
      // hide=jacket,caps,chest,collar: take layers off to see what is whose
      String(P.hide || "").split(",").forEach(function (k) {
        const s = ch.skinSlots || {};
        const L = k === "jacket" ? [ch._jacketMesh] : k === "caps" ? (ch._sleeveHeads || []) : k === "chest" ? (s.torso || []) : k === "collar" ? (s.collar || []) : k === "arms" ? (s.arms || []) : [];
        L.forEach(function (m) { if (m && m !== ch._jacketMesh && k === "chest") { m.material = m.material.clone(); m.material.visible = false; } else if (m) m.visible = false; });
      });
      const arms = P.arms || "rest";
      if (arms === "up") ch.handsUp = true;
      if (arms === "aim") { ch.aimingPose = true; ch.aimHands = 2; }
    });
    W.every(function (dt) {
      const walk = (P.arms === "walk");
      for (const r of W.rigs) if (CBZ.animChar) CBZ.animChar(r.ch, walk ? 1.4 : 0, dt);
    });
  },
  frame: function (W, P) {
    P = P || W.P || {};
    if (P.focus != null && W.rigs[+P.focus]) return [W.rigs[+P.focus].fb];
    return W.rigs.map(function (r) { return r.fb; });
  },
  probe: function (W) {
    const n = W.rigs.filter(function (r) { return r.ch._jacketMesh && r.ch._jacketMesh.visible; }).length;
    return { ok: n === W.rigs.length, summary: n + "/" + W.rigs.length + " bodies wear a jacket shell (" + W.rigs.map(function (r) { return r.build + (r.dressed ? "" : " UNDRESSED"); }).join(", ") + ")" };
  },
});
