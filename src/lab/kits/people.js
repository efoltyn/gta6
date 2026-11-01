/* lab kit "people": a casting line-up. Real game bodies (CBZ.human.build,
   the shipped rig) of every build, sex, age band and skin tone, each dressed
   through the one wardrobe door (CBZ.human.dress -> city/outfits.js +
   city/clothes.js) in a role's outfit, posed by CBZ.animChar. The row a
   rebuild of the body, the face, the hair or a uniform is judged on.

   params: cast   comma list of  sex-physique-skin-outfit[-age]  (default:
                  ten people, cop, banker, civilians, gang, inmate, nurse,
                  soldier, builder, executive, guard)
                  skin is a palette index 0..7 (pale .. deep)
           gap    metres between bodies (default 0.9)
           focus  index: the cameras frame that one body only
           crop   top: chest up
           arms   rest | walk
   probe:  bodies built / dressed, and the triangle count of the first. */
CBZ.lab.kit("people", {
  about: "a line-up of dressed people (cop, gang, civilian, inmate, guard, soldier, banker, worker) for before/after shots of bodies, faces, hair and outfits",
  files: ["src/entities/character.js", "src/entities/gait.js", "src/entities/heritage.js", "src/systems/fphands.js", "src/entities/footwear.js", "src/entities/headwear.js", "src/entities/eyewear.js", "src/city/clothes.js", "src/city/outfits.js"],
  symbols: ["human", "animChar", "cityOutfitCatalog", "cityApplyClothes"],
  params: {},
  duration: 1.0,
  setup: function (W, P) {
    const SKIN = [0xf3d2bd, 0xe8b996, 0xd4a07a, 0xb98262, 0x9a6648, 0x7a4c34, 0x5c3826, 0x3e271b];
    const HAIR = [0x1a1410, 0x3a2418, 0x0e0c0a, 0x6a4a2a, 0x8a8a8a, 0x2b2018, 0x9a6a30, 0xd8d0c0];
    const DEF = "m-average-3-police,m-heavy-1-office,f-average-0-street,m-muscular-6-puffer,m-slim-2-inmate,f-slim-5-scrubs,m-average-1-soldier,m-heavy-4-construction,f-average-2-exec_navy,m-slim-7-corrections";
    const cast = String(P.cast || DEF).split(",");
    const gap = +P.gap || 0.9;
    W.rigs = [];
    cast.forEach(function (c, i) {
      const f = c.trim().split("-");
      const sex = f[0] === "f" ? "f" : "m", ph = f[1] || "average", si = (+f[2] || 0) & 7, oid = f[3] || "street";
      const age = f[4] != null ? +f[4] : null;
      const ch = CBZ.human.build({ build: sex, physique: ph, skin: SKIN[si], hair: HAIR[(i * 3 + si) % HAIR.length], longHair: sex === "f", age: age });
      const grp = ch.group;
      grp.position.set((i - (cast.length - 1) / 2) * gap, 0, 0);
      W.scene.add(grp);
      let dressed = false;
      try { dressed = !!CBZ.human.dress(ch, oid); } catch (e) { dressed = "threw " + e; }
      const top = P.crop === "top";
      const fb = new THREE.Mesh(new THREE.BoxGeometry(0.62, top ? 0.7 : 1.85, 0.4), new THREE.MeshBasicMaterial());
      fb.visible = false; fb.position.set(grp.position.x, top ? 1.42 : 0.93, 0); W.scene.add(fb);
      W.rigs.push({ ch: ch, fb: fb, id: c, dressed: dressed });
    });
    W.every(function (dt) { for (const r of W.rigs) if (CBZ.animChar) CBZ.animChar(r.ch, P.arms === "walk" ? 1.4 : 0, dt); });
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
    return { ok: bad.length === 0, summary: W.rigs.length + " bodies; first: " + meshes + " meshes " + Math.round(tris) + " tris" + (bad.length ? "; UNDRESSED " + bad.join(" ") : "") };
  },
});
