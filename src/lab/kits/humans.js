/* lab kit "humans": the people line-up a body rebuild is judged on, and the
   before / after harness for the Blender people (src/entities/people.js).

   Every body is the shipped rig (CBZ.human.build), dressed through the one
   wardrobe door (CBZ.human.dress), posed by CBZ.animChar. With skinned=1 the
   same rigs wear the Blender-authored skinned bodies (CBZ.people), driven by
   the same rig: the line-up, the poses and the cameras do not change, so a
   pair of frames is the same person before and after.

   params: cast     comma list of  sex-physique-skin-outfit[-age][~hair][^beard][@heritage]
                    sex m|f, physique average|slim|heavy|muscular, skin a
                    palette index 0..7 (pale .. deep), outfit an outfits.js
                    catalog id, age in years, hair a character.js style
                    (buzz short crop bob long pony bun pigtail afro curly locs),
                    beard full|goatee|moustache|stubble, heritage an id from
                    entities/heritage.js (colours the face and hair the way the
                    casting would)
           gap      metres between bodies (default 0.95)
           arms     rest | walk | aim | up
           gore     1: shoot and cut the line-up (wounds.js + gore.js)
           skinned  1: the Blender people (CBZ.people), 0: the procedural body
   probe:  bodies built / dressed / skinned, and the first body's triangles. */
CBZ.lab.kit("humans", {
  about: "a line-up of people of every sex, build, skin tone, age, hair and beard, in outfits; walk / aim / gore; skinned=1 swaps in the Blender people on the same rigs",
  files: ["src/entities/character.js", "src/entities/gait.js", "src/entities/heritage.js", "src/systems/fphands.js",
    "src/entities/footwear.js", "src/entities/headwear.js", "src/entities/eyewear.js", "src/city/clothes.js", "src/city/outfits.js",
    "src/systems/wounds.js", "src/systems/gore.js", "src/vendor/GLTFLoader.js", "src/entities/people.js"],
  symbols: ["human", "animChar", "cityOutfitCatalog", "cityApplyClothes"],
  params: { gap: 0.95, arms: "rest" },
  duration: 1.5,
  setup: function (W, P) {
    const SKIN = [0xf3d2bd, 0xe8b996, 0xd4a07a, 0xb98262, 0x9a6648, 0x7a4c34, 0x5c3826, 0x3e271b];
    const HAIR = [0x1a1410, 0x3a2418, 0x0e0c0a, 0x6a4a2a, 0x8a8a8a, 0x2b2018, 0x9a6a30, 0xd8d0c0];
    const DEF = [
      "m-average-5-street-34~short^stubble",
      "f-average-1-street-27~long",
      "m-muscular-7-puffer-29~buzz^full",
      "f-slim-3-scrubs-41~bun",
      "m-heavy-2-office-52~crop^moustache",
      "f-average-6-exec_navy-38~afro",
      "m-slim-0-police-24~short",
      "m-average-4-street-71~crop^goatee",
      "f-average-2-street-66~bob",
      "m-average-3-soldier-31~buzz",
    ].join(",");
    const cast = String(P.cast || DEF).split(",");
    const gap = +P.gap || 0.95;
    W.rigs = [];
    cast.forEach(function (spec, i) {
      const s = spec.trim();
      const her = (/@([\w-]+)/.exec(s) || [])[1] || null;
      const hair = (/~(\w+)/.exec(s) || [])[1] || null;
      const beard = (/\^(\w+)/.exec(s) || [])[1] || null;
      const f = s.replace(/[@~^].*$/, "").split("-");
      const sex = f[0] === "f" ? "f" : "m", ph = f[1] || "average", si = (+f[2] || 0) & 7, oid = f[3] || "street";
      const age = f[4] != null && f[4] !== "" ? +f[4] : null;
      let c = { build: sex, physique: ph, skin: SKIN[si], hair: HAIR[(i * 3 + si) % HAIR.length], longHair: sex === "f", age: age };
      if (her && CBZ.heritageRoll) {
        try { c = Object.assign(c, CBZ.heritageRoll(her, (function () { let k = 7 + i * 13; return function () { k = (k * 1103515245 + 12345) & 0x7fffffff; return k / 0x7fffffff; }; })())); } catch (e) {}
      }
      if (hair) c.hairStyle = hair;
      if (beard) c.beard = beard;
      const ch = CBZ.human.build(c);
      const grp = ch.group;
      grp.position.set((i - (cast.length - 1) / 2) * gap, 0, 0);
      W.scene.add(grp);
      let dressed = false;
      try { dressed = !!CBZ.human.dress(ch, oid); } catch (e) { dressed = "threw " + e; }
      const fb = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.85, 0.4), new THREE.MeshBasicMaterial());
      fb.visible = false; fb.position.set(grp.position.x, 0.93, 0); W.scene.add(fb);
      const actor = { char: ch, group: grp, isPlayer: false, hp: 100 };
      W.rigs.push({ ch: ch, fb: fb, id: s, dressed: dressed, actor: actor, look: c });
    });
    W.skinnedN = 0;
    W.peopleReady = true;
    if (+P.skinned === 1 && CBZ.people) {
      W.peopleReady = false;
      CBZ.people.ready().then(function () {
        for (const r of W.rigs) { try { if (CBZ.people.attach(r.ch, r.look)) W.skinnedN++; } catch (e) { W.peopleErr = String(e && e.stack || e); } }
        W.peopleReady = true;
      }, function (e) { W.peopleErr = String(e && e.stack || e); W.peopleReady = true; });
    }
    // the capture tools wait while the people pack and its textures stream in
    W.busy = function () { return !W.peopleReady || !!(CBZ.people && CBZ.people.pending && CBZ.people.pending() > 0); };
    let goreDone = false;
    W.every(function (dt) {
      const arms = P.arms || "rest";
      for (const r of W.rigs) {
        r.ch.aimingPose = arms === "aim"; if (arms === "aim") r.ch.aimHands = 2;
        r.ch.handsUp = arms === "up";
        if (CBZ.animChar) CBZ.animChar(r.ch, arms === "walk" ? 1.4 : 0, dt);
      }
      if (+P.gore === 1 && !goreDone && W.t() > 0.35) {
        goreDone = true;
        const v = new THREE.Vector3();
        W.rigs.forEach(function (r, i) {
          const ch = r.ch, a = r.actor;
          // a chest shot from the front, an arm graze, a leg hit; every third
          // body loses an arm, the last one its head
          try {
            // the chest: the torso box's centre (the body node sits on the floor)
            (ch.skinSlots.torso[0] || ch.body).getWorldPosition(v); v.y += 0.12; v.x += (i % 2 ? 0.06 : -0.05);
            CBZ.bodyWound && CBZ.bodyWound(a, v.clone(), { fromX: v.x, fromZ: v.z + 3, dmg: 30 });
            // the upper arm, a hand below the shoulder
            ch.parts.la.getWorldPosition(v); v.y -= 0.16; v.z += 0.06;
            CBZ.bodyWound && CBZ.bodyWound(a, v.clone(), { fromX: v.x, fromZ: v.z + 3, dmg: 20 });
            if (i % 3 === 1 && CBZ.goreSever) CBZ.goreSever(a, "ra", { dir: { x: -1, y: 0.3, z: 0.2 } });
            if (i === W.rigs.length - 1 && CBZ.goreSever) CBZ.goreSever(a, "head", { dir: { x: 0.2, y: 1, z: 0 } });
          } catch (e) { W.goreErr = String(e && e.stack || e); }
        });
      }
    });
  },
  frame: function (W, P) {
    P = P || W.P || {};
    if (P.focus != null && W.rigs[+P.focus]) return [W.rigs[+P.focus].fb];
    return W.rigs.map(function (r) { return r.fb; });
  },
  probe: function (W) {
    let tris = 0, meshes = 0;
    if (W.rigs[0]) W.rigs[0].ch.group.traverse(function (m) { if (m.isMesh && m.visible && m.geometry) { meshes++; const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    const bad = W.rigs.filter(function (r) { return r.dressed !== true; }).map(function (r) { return r.id + ":" + r.dressed; });
    return { ok: bad.length === 0 && !W.peopleErr, summary: W.rigs.length + " bodies, " + W.skinnedN + " skinned; first: " + meshes + " meshes " + Math.round(tris) + " tris" + (bad.length ? "; UNDRESSED " + bad.join(" ") : "") + (W.peopleErr ? "; PEOPLE ERR " + W.peopleErr.slice(0, 300) : "") + (W.goreErr ? "; GORE ERR " + W.goreErr.slice(0, 200) : "") };
  },
});
