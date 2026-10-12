/* ============================================================
   core/stage.js — THE STAGE: the parts of the studio a page needs to put
   people and machines in a world it did not raise.

   cast (a person by role: the shipped rig, dressed), drop (remove a thing and
   give its GPU memory back), structureAt / collapseAt (what stands here, and
   bring it down), trail (a smoke or contrail line, one draw call).

   One owner: src/core/studio.js hands its own studio.cast / drop /
   structureAt / collapseAt / trail to these (pages that load the studio load
   this first), and Gang City's war (city/armypage.js, the battle realm's page
   layer) uses them with no studio on the page.

   PUBLIC  CBZ.stage = { cast(role, opts), roles(), drop(obj),
                         structureAt(x, z, reach), collapseAt(pos, opts),
                         trail(opts) }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  if (CBZ.stage) return;
  const ST = {};
  /* ==========================================================================
     THE CASTING TABLE — a person by NAME.

     city/occupy.js already owns a role table and calls it "casting only: job +
     archetype + temperament; everything downstream is the shipped ped
     pipeline". That table is the right one and this does not replace it: when
     occupy.js is loaded its rows are merged in, so a page gets the same
     soldier the city's fortresses get.

     What lives here is the part occupy.js cannot give a page outside the city:
     a WEARABLE reading of the role. city/peds.js's makePed is genuinely
     city-coupled (wanted ladder, cityKillPed, the ped brain), so a one-shot
     cannot have it — but the BODY is engine (entities/character.js) and the
     wardrobe is a catalog (city/outfits.js). So `cast` builds the shipped rig,
     dressed to the role, and leaves the brain to the game. A page that wants
     the full city ped loads the city and calls makePed.
     ========================================================================== */
  const CASTING = {
    soldier:   { pal: { legs: 0x3e4630, torso: 0x47503a, arms: 0x47503a, shoes: 0x241f19, cap: 0x3a4230, capKind: "milcap" }, armed: "Rifle", hp: 170 },
    officer:   { pal: { legs: 0x2f3626, torso: 0x39412e, arms: 0x39412e, shoes: 0x1e1a15, cap: 0x2b3223, capKind: "peaked:officer" }, armed: "Pistol", hp: 200 },
    guard:     { pal: { legs: 0x22242a, torso: 0x2b2e36, arms: 0x2b2e36, shoes: 0x17181c, cap: 0x22242a, capKind: "peaked:police" }, armed: "Pistol", hp: 140 },
    security:  { pal: { legs: 0x22242a, torso: 0x2b2e36, arms: 0x2b2e36, shoes: 0x17181c, cap: 0x22242a, capKind: "peaked:police" }, armed: "Pistol", hp: 140 },
    agent:     { pal: { legs: 0x18181c, torso: 0x1f1f24, arms: 0x1f1f24, shoes: 0x101013 }, armed: "Pistol", hp: 150 },
    muscle:    { pal: { legs: 0x1d1d20, torso: 0x3a2f2a, arms: 0x3a2f2a, shoes: 0x141416 }, armed: "Pistol", hp: 150 },
    thug:      { pal: { legs: 0x2a2f38, torso: 0x6d2f2f, arms: 0x6d2f2f, shoes: 0x1a1a1d }, armed: "Pistol", hp: 110 },
    civilian:  { pal: { legs: 0x3a4152, torso: 0x9aa3b4, arms: 0x9aa3b4, shoes: 0x2a2622 }, hp: 100 },
    worker:    { pal: { legs: 0x394a63, torso: 0xc8862c, arms: 0xc8862c, shoes: 0x2a2622 }, hp: 110 },
    exec:      { pal: { legs: 0x23252c, torso: 0x2c2f38, arms: 0x2c2f38, shoes: 0x191a1e }, hp: 100 },
    medic:     { pal: { legs: 0xe9edf2, torso: 0xf3f6fa, arms: 0xf3f6fa, shoes: 0x2a2622 }, hp: 110 },
    pilot:     { pal: { legs: 0x3f4438, torso: 0x5a6046, arms: 0x5a6046, shoes: 0x241f19, cap: 0xd8dce2, capKind: "peaked:captain" }, hp: 120 },
    runner:    { pal: { legs: 0x2f3a48, torso: 0xb4643a, arms: 0xb4643a, shoes: 0x22201c }, hp: 100 },
  };
  ST.roles = function () { return Object.keys(CASTING).slice(); };

  /* cast(role, opts) -> THREE.Group (the rig's group), with .userData.charRig
     opts: { color }  team/faction colour, overrides the torso and cap
           { variant } integer; picks skin and hair deterministically
           { scale }   metres tall override, default the shipped 1.82 m
           { build }   "m" | "f" — entities/character.js's body profile
           { hairStyle } a key in character.js's HAIR_STYLES table
           { heritage } an entities/heritage.js id (default: rolled)
           { beard }   false = clean-shaven regardless of the roll
     WHO the person is comes from entities/heritage.js — one seeded roll per
     (role, variant), so variant 3 of "guard" is the same man on every page and
     every boot: skin, hair colour + texture, eyes, nose, lips, facial hair.
     (It used to be two six-entry colour tables indexed by variant — a palette,
     not a population.) The body is built through CBZ.human, the same door
     every other system uses.
     Returns null when the `people` pack is not loaded, so a caller can fall
     back rather than crash — the same degrade rule the rest of the file uses. */
  ST.cast = function (role, opts) {
    const build = (CBZ.human && CBZ.human.build) || CBZ.makeCharacter;
    if (!build) return null;
    opts = opts || {};
    const occ = (CBZ.cityOccupyRoles && CBZ.cityOccupyRoles[role]) || null;
    const C = CASTING[role] || CASTING[(occ && occ.archetype)] || CASTING.civilian;
    const v = (opts.variant | 0);
    const pal = C.pal;
    const body = {
      legs: pal.legs, torso: opts.color != null ? opts.color : pal.torso,
      collar: opts.color != null ? opts.color : pal.torso,
      arms: pal.arms, shoes: pal.shoes,
    };
    const fem = opts.build === "f";
    const look = CBZ.heritageRoll ? CBZ.heritageRoll(opts.heritage || null, "cast|" + role + "|" + v) : null;
    if (look) {
      body.skin = look.skin; body.hair = look.hair;
      if (look.eye != null) body.eye = look.eye;
      body.nose = look.nose; body.lips = look.lips; body.eyeShape = look.eyeShape;
      if (!fem && look.beard && opts.beard !== false) body.beard = look.beard;
      // the roll's hair texture for men; a woman keeps the body's own default
      if (!fem) { body.hairStyle = look.hairStyle; if (look.bald) body.bald = true; }
    } else {
      body.skin = 0xc9a07a; body.hair = 0x2a1f18;       // heritage.js not loaded: one plain person
    }
    // the role's hat KIND rides with its colour (entities/headwear.js): a
    // soldier's patrol cap, an officer's peaked cap, a pilot's captain's cap
    if (pal.cap != null) { body.cap = opts.color != null ? opts.color : pal.cap; body.capKind = pal.capKind; }
    /* A UNIFORM, NOT A PAINT BUCKET. `color` repaints torso+collar+cap in one
       flat team colour, which is how NPC War's armies came out as toy soldiers.
       `uniform` names each part (legs/torso/arms/cap/shoes/collar/belt) and wins
       over both the role palette and `color`. Only read when passed. */
    if (opts.uniform) {
      const u = opts.uniform;
      ["legs", "torso", "collar", "arms", "shoes", "cap", "capKind", "belt"].forEach(function (k) { if (u[k] != null) body[k] = u[k]; });
    }
    /* CASTING IS ALSO A CASTING DECISION, not only a paint job.
       entities/character.js has always taken `build` ("m" | "f", default "m")
       and `hairStyle` (a key in its own HAIR_STYLES table) — but studio.cast
       forwarded NEITHER, so every page that casts through this door got the
       adult male profile with `short` hair and had no way to say otherwise
       short of calling CBZ.makeCharacter itself and re-implementing the whole
       role table. Desert Warlord needs exactly that door: it is a game with no
       women in it (owner) and its men should not be wearing the engine's
       default nape-length shell.

       Forwarded ONLY when asked for, so this is a no-op for every existing
       caller — grepped: 26 studio.cast call sites in this repo on 2026-09-01
       and not one of them passes `build` or `hairStyle`. Gang city and the
       prison keep the exact bodies they had, byte for byte, and an unknown
       style id falls through character.js's own `HAIR_STYLES[c.hairStyle]`
       guard back to the default rather than throwing. */
    if (opts.build) body.build = opts.build;
    if (opts.hairStyle) { body.hairStyle = opts.hairStyle; body.bald = false; }
    let ch = null;
    try { ch = build(body); } catch (e) { return null; }
    const g = (ch && ch.isObject3D) ? ch : (ch && ch.group);
    if (!g) return null;
    g.userData.charRig = ch;
    g.userData.role = role;
    g.userData.hp = C.hp || 100;
    if (C.armed) g.userData.weapon = C.armed;
    if (opts.scale > 0 && g.scale) g.scale.setScalar(opts.scale / 1.82);
    return g;
  };

  /* drop(obj) — REMOVE IT AND GIVE THE MEMORY BACK.

     `parent.remove(obj)` unhooks it from the scene graph and leaves every
     BufferGeometry and Material it owns resident on the GPU. That is not a
     leak you notice: it is a slow climb, and it was measured here at +11.7 MB
     per aircraft, monotonic, in a game that respawns aircraft on a nine second
     timer. Any page that spawns and despawns needs this and no page had it.

     SHARED assets are spared. materials.js caches materials and geometry
     behind `_shared`, and microboot's own helpers do the same, so disposing
     one of those would blank every other object using it. Anything a page
     wants kept regardless takes `userData.keepAssets = true`. */
  ST.drop = function (obj) {
    if (!obj) return 0;
    let freed = 0;
    const seenG = new Set(), seenM = new Set();
    obj.traverse(function (o) {
      if (o.userData && o.userData.keepAssets) return;
      if (o.geometry && !o.geometry._shared && !seenG.has(o.geometry)) {
        seenG.add(o.geometry);
        if (o.geometry.dispose) { o.geometry.dispose(); freed++; }
      }
      const m = o.material;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      for (let i = 0; i < list.length; i++) {
        const mm = list[i];
        if (!mm || mm._shared || seenM.has(mm)) continue;
        seenM.add(mm);
        // a texture a material owns goes with it, unless it is shared too
        for (const k of ["map", "normalMap", "emissiveMap", "alphaMap", "roughnessMap"]) {
          const t = mm[k];
          if (t && !t._shared && t.dispose) t.dispose();
        }
        if (mm.dispose) { mm.dispose(); freed++; }
      }
    });
    if (obj.parent) obj.parent.remove(obj);
    return freed;
  };

  /* structureAt(x, z, reach) — WHAT IS STANDING HERE.

     Reads CBZ.colliders, which is the registry the whole engine already writes
     and reads, and returns the nearest full-height box's own record — its
     centre, its extents and its height — or null over open ground. A world
     declares a building by registering one collider with a `ref`; nothing here
     knows what a lot, a district or a city is, so the prison, the desert and
     the city all answer the same way.

     `reach` lets a near miss still find the wall it went off beside, which is
     what a bomb actually does to a building. */
  ST.structureAt = function (x, z, reach) {
    const list = CBZ.colliders;
    if (!list || !list.length) return null;
    const R = reach > 0 ? reach : 0;
    let best = null, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.y0 != null) continue;                 // height-gated: a rail, a roof, not a structure
      const r = c.ref;
      if (!r || !(r.w > 0) || !(r.h > 0)) continue;     // a record that cannot describe itself
      if (r.alive === false) continue;
      const dx = Math.max(c.minX - x, 0, x - c.maxX);
      const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  };

  /* collapseAt(pos, opts) — THE STRUCTURAL HALF ON ITS OWN.

     systems/ordnance.js already draws its own fireball and applies its own
     damage when a store goes off, so a page hooking onDetonate and calling
     boom() there gets the explosion TWICE: two fireballs, two bangs, and the
     sound stacking seven deep across a stick. What ordnance does not do is
     bring the building down, and that is the only part such a hook wants.

     cityAirstrikeCollapse resolves a facade out of whatever it is given, and
     given only a point it has to guess the footprint. The world already knows:
     the structure under the impact is a collider with a `ref` carrying its own
     extents. Hand over the real lot and the collapse lands on the real face at
     the real roofline. Returns the struck record, or null over open ground. */
  ST.collapseAt = function (pos, opts) {
    opts = opts || {};
    if (!CBZ.cityAirstrikeCollapse || !pos) return null;
    const R = opts.radius > 0 ? opts.radius : 18;
    const s = ST.structureAt(pos.x, pos.z, opts.reach != null ? opts.reach : R);
    const lot = s ? { cx: s.x, cz: s.z, w: s.w, d: s.d } : { x: pos.x, z: pos.z };
    try {
      CBZ.cityAirstrikeCollapse(lot, {
        at: pos, top: s ? s.h : undefined,
        power: opts.power > 0 ? opts.power : 1, radius: R,
      });
    } catch (e) { return null; }
    return s;
  };

  /* ==========================================================================
     trail(opts) — A CONTRAIL, A SMOKE COLUMN, A WAKE. One draw call.

     Anything that moves fast and matters reads better with a line behind it,
     and every page that wanted one has either gone without or spawned a
     particle per frame and watched the frame time climb. This is a single
     THREE.Line over a ring buffer: fixed memory, fixed draw calls, and the
     tail fades by vertex colour rather than by spawning anything.

       const t = ST.trail({ length: 90, color: 0xdfe6ee });
       t.push(af.pos);        // each frame while it should be drawing
       t.cut();               // a gap: the aeroplane died, do not join the dots
     ========================================================================== */
  ST.trail = function (opts) {
    opts = opts || {};
    const THREE = window.THREE;
    if (!THREE || !CBZ.scene) return { push: function () {}, cut: function () {}, dispose: function () {} };
    const N = Math.max(8, opts.length || 80);
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const c = new THREE.Color(opts.color != null ? opts.color : 0xdfe6ee);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: opts.opacity != null ? opts.opacity : 0.55, depthWrite: false,
    }));
    line.frustumCulled = false;
    line.renderOrder = 850;
    CBZ.scene.add(line);
    let n = 0, last = null;
    const minStep = opts.minStep != null ? opts.minStep : 6;
    return {
      line: line,
      push: function (p) {
        if (!p) return;
        if (last && (p.x - last.x) * (p.x - last.x) + (p.y - last.y) * (p.y - last.y) +
            (p.z - last.z) * (p.z - last.z) < minStep * minStep) return;
        last = { x: p.x, y: p.y, z: p.z };
        // shift back by one and write the head: a ring buffer would need an
        // index attribute to draw in order, and N is small enough that the
        // copy is cheaper than the bookkeeping.
        if (n >= N) {
          pos.copyWithin(0, 3);
          n = N - 1;
        }
        pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
        n++;
        for (let i = 0; i < n; i++) {
          const f = i / Math.max(1, n - 1);      // 0 at the tail, 1 at the head
          col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f;
        }
        geo.setDrawRange(0, n);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.computeBoundingSphere();
      },
      cut: function () { n = 0; last = null; geo.setDrawRange(0, 0); },
      dispose: function () { if (line.parent) line.parent.remove(line); geo.dispose(); line.material.dispose(); },
    };
  };

  CBZ.stage = ST;
})();
