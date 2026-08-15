/* PRISON YARD + SERVICE-ROOM PROP AUDIT for tools/visual-compare.mjs.

   WHY A SECOND ROOM PRESET EXISTS
   -------------------------------
   tools/visual-presets/prison-rooms.mjs photographs all 37 rooms and is the
   compound-wide worklist. This one photographs SEVEN of them — the yards, the
   sally port, the chow hall, the dayroom, the laundry and the workshop, i.e.
   exactly the rooms world/southblock.js, world/yardfurniture.js,
   world/escape_routes.js, world/lounge.js and world/cafeteria.js draw — and it
   asks one question that preset cannot answer.

   THE NUMBER THIS TOOL WAS BUILT FOR IS `playerUsable`
   ----------------------------------------------------
   prison-rooms.mjs classifies every prop as solid, then used, then dead, in
   that order and with a `continue` after each. That ordering is right for its
   own question ("what is decoration?") and WRONG for the owner's: a mess bench
   that carries a collider AND a propuse seat anchor is filed under `solid`,
   and `usedProps` never sees it. The staff lounge measured `used: 7` on the
   2026-08-15 baseline and every one of the seven was a light — while a couch
   with three registered sit spots, an armchair and a four-stool card table sat
   in the same room being counted as masonry.

   So this preset counts the same four buckets, by the same rules, so its
   numbers can be laid straight beside that audit — and then counts a fifth
   INDEPENDENTLY:

     playerUsable   props the player can do something to. A propuse seat or
                    bed anchor, a CBZ.prisonPlaceItem instance, an escape-route
                    grate (CBZ.vents), a cigarette pack (CBZ.coins), a
                    systems/pushables.js shovable, a systems/breach.js target,
                    or a door leaf — plus the boxes welded to one of those, by
                    the same contact spread. Solidity is NOT considered: a
                    bench you can sit on counts whether or not you also bump
                    into it. THIS is "how many props in this room can a player
                    actually interact with".

     coverProps     props with a collider and nothing else. Not a verb, but not
                    nothing either: it is what stops you and what you hide
                    behind, and the owner's rule counts it as usable.

     dead           props - shell - solid - used, IDENTICAL to prison-rooms.mjs
                    so a reader can diff the two reports line for line.
     deadFlat       of those, the sub-5 cm slice: deck paint, decals, signage
                    skins. Broken out and NEVER treated as a defect — wayfinding
                    lines, court markings, wall bands and dados are 2 cm surface
                    graphics and they are legitimate. `deadPropVolume` is the
                    honest headline for the same reason.

   Plus three one-line facts about the room-furnishing plumbing itself, because
   world/lounge.js's header spent a wave asserting the wrong one of them:
     furnish        is CBZ.furnish up? (city/furniture.js, index.html:482)
     seatAnchors    CBZ.propSeats landing inside this room's rect
     bedAnchors     CBZ.propBeds landing inside this room's rect

   HOW IT MEASURES — the same census, stated the same way
   ------------------------------------------------------
   One walk of CBZ.prisonRoot per page, cached and reused by all 21 subjects.
   Every Mesh contributes its world AABB, its BoxGeometry dimensions when it has
   them, whether a collider owns it and which registry claims it. Subtrees
   tagged userData.dynamic WITHOUT userData.mover are skipped — the tag
   core/batch.js refuses to descend into, which in escape mode is the guard and
   inmate rigs and the armoury's visibility-toggled racks. A door leaf carries
   both tags and stays in.

   AND IT UNDOES THE BATCHER, because it has to. core/batch.js's inert pass
   merges every mesh that is provably untouchable and disposes the originals —
   very nearly this tool's own definition of a dead prop, so a census of the
   live graph reports a compound with its decoration already deleted. The merged
   buffers are non-indexed and baked to world space, so each swallowed
   BoxGeometry is still 36 consecutive vertices on the 8 corners of one
   axis-aligned box; the walk emits every 36-vertex run that proves itself a box,
   recovers its baked vertex tint, and resyncs a triangle at a time past the
   cylinders and tori sharing the bucket. `mergedProps` reports the recovery.

   SHELL is a SHAPE test, not a fraction of the room: a slab at least 5 cm thick
   and at least 6 m2 of footprint, lying on the deck or carried overhead, or a
   tall thin box on the rect boundary. Deck paint stays out of it by the 5 cm
   floor. Two known consequences, both reported rather than hidden: a roof
   parapet kerb (world/roofs.js:112, 0.32 x 0.34 x span) and a facade coping
   (world/building_dress.js:731, 0.22 x 0.22 x span) each miss the 6 m2 footprint
   by a couple of square metres on a 16 m elevation, so they are filed as this
   room's dead props when they are the roof's edge. They are NOT slop and this
   tool does not ask anybody to delete them; `deadOverhead` counts how much of
   the dead volume sits above 4.5 m so a reader can see that share at a glance.

   THE SEVEN ROOMS, and who draws them
   -----------------------------------
     lower-yard   world/southblock.js  — the exercise yard. Baseline: used 0.
     north-yard   world/yardfurniture.js + world/props.js + world/yard.js
     sally-port   world/southblock.js  — checkpoint, guard hut, transport
     mess         world/cafeteria.js   — chow hall, and CBZ.prisonDress's home
     lounge       world/lounge.js      — the dayroom
     laundry      world/southblock.js
     workshop     world/southblock.js
   Rects come LIVE off CBZ.prisonLights.rooms where the room publishes one
   (mess, lounge, laundry, workshop); the three open spaces publish nothing and
   are authored below against the source lines named on each row — the same rects
   prison-rooms.mjs uses, on purpose, so the two reports are comparable.

   AN OPEN YARD IS NOT THE BUILDINGS IN IT: the cafeteria, armoury and lounge
   all stand inside CBZ.WORLD.northYard's rect, so an unsubtracted yard census
   reports the mess hall's chairs as litter on the grass. Every enclosed rect
   travels on the subject and open rooms cut them out.

   Run:
     npm run visual:prison-yard-props -- --before http://127.0.0.1:8797/
*/

/* ---- THE ROOMS -------------------------------------------------------------
   live:"id"  → rect taken from CBZ.prisonLights.rooms[id] at stage time; the
                x0/x1/z0/z1 here are the degrade path. `h` is always authored:
                the light regions are 2-D and carry no height.
   open:true  → no roof, so the plan and three-quarter views do not clip, and
                the room subtracts the enclosed shells standing inside it.      */
const ROOMS = [
  { id: "lower-yard", label: "Lower yard · the exercise yard", h: 8, open: true,
    x0: -24, x1: 24, z0: 80, z1: 116, door: { side: "N", center: 0 },
    owner: "world/southblock.js:324-360 (half-court, weights, pull-up rig, bleachers)" },
  { id: "north-yard", label: "North exercise yard", h: 11, open: true,
    x0: -30, x1: 30, z0: -8, z1: 52, door: { side: "N", center: 0 },
    owner: "world/yardfurniture.js (handball, weights, pavilion, phones, board)" },
  { id: "sally-port", label: "Sally port + guard hut", h: 6, open: true,
    x0: -14, x1: 22, z0: 112, z1: 127.5, door: { side: "N", center: 4 },
    owner: "world/southblock.js:346-390 (pillars, boom, barriers, bus, hut)" },
  { id: "mess", label: "Cafeteria · the chow hall", live: "mess", h: 6,
    x0: -29, x1: -19, z0: 6, z1: 22, door: { side: "E", center: 14 },
    owner: "world/cafeteria.js — and CBZ.prisonDress's own home" },
  { id: "lounge", label: "Staff lounge / dayroom", live: "lounge", h: 6,
    x0: 19, x1: 29, z0: 30, z1: 44, door: { side: "W", center: 37 },
    owner: "world/lounge.js" },
  { id: "laundry", label: "Laundry", live: "laundry", h: 6,
    x0: -42, x1: -26, z0: 88, z1: 104, door: { side: "E", center: 96 },
    owner: "world/southblock.js:211-243" },
  { id: "workshop", label: "Workshop · welding bay", live: "workshop", h: 6,
    x0: -42, x1: -24, z0: 58, z1: 80, door: { side: "E", center: 69 },
    owner: "world/southblock.js:112-145" },
];

/* The enclosed shells an open room has to cut out of its own census. Only the
   ones that can actually stand inside one of the three open rects above. */
const ENCLOSED = [
  { id: "mess", live: "mess", x0: -29, x1: -19, z0: 6, z1: 22 },
  { id: "armory", live: "armory", x0: 19, x1: 29, z0: -6, z1: 8 },
  { id: "lounge", live: "lounge", x0: 19, x1: 29, z0: 30, z1: 44 },
  { id: "gatehouse", live: "gatehouse", x0: -22, x1: -14, z0: 116, z1: 124 },
];

const ANGLES = [
  { id: "over", label: "raised three-quarter",
    focus: "The room from above the doorway wall, roof clipped. Every object in frame should be one you can sit on, take from, hide behind or be stopped by." },
  { id: "eye", label: "doorway, eye level",
    focus: "Eye at 1.70 m, 0.55 m inside the door — the shipped view. Anything that reads as furniture from here has to BE furniture from here." },
  { id: "plan", label: "plan",
    focus: "Straight down, roof clipped, +X right and +Z down like the minimap. Circulation, and props stacked on top of each other." },
];

const subjects = [];
for (const room of ROOMS) {
  for (const angle of ANGLES) {
    subjects.push({
      id: `${room.id}-${angle.id}`,
      label: `${room.label} — ${angle.label}`,
      focus: angle.focus,
      angle: angle.id,
      room,
      enclosed: room.open ? ENCLOSED : null,
    });
  }
}

async function stageYardProps(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const round = (v, n) => {
    const k = Math.pow(10, n == null ? 2 : n);
    return Number.isFinite(v) ? Math.round(v * k) / k : 0;
  };

  let S = window.__yardPropAudit;

  // ======================================================================
  //  ONE-TIME: boot the real game into escape mode and freeze it.
  // ======================================================================
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="escape"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing" && CBZ.game.mode === "escape") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing" && CBZ.game.mode === "escape";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached escape/playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // Freeze rAF; CBZ.stepSim is the only clock from here.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    // THE COMPOUND IS NOT FINISHED AT TICK 0: the stock cages, the yard tool
    // laying (world/yardfurniture.js:234), the crate tools and the propuse
    // flush all ride deferred onUpdate passes, and world/roombuild.js's anchor
    // queue flushes on `load`. A census before those run reports a prison with
    // no placed items and no registered seats — which is the exact number this
    // preset exists to measure, so getting it wrong here would be fatal.
    for (let i = 0; i < 240; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
    }

    const overlay = document.createElement("div");
    overlay.id = "__yardPropOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-nums></div><div data-use></div><div data-rect></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__yardPropAudit = { overlay, census: null, rooms: {}, camera: null, clip: null };
    // The runner re-renders through this hook right before the compositor
    // barrier, so it — not the stage's own render call — is what the screenshot
    // contains. It has to re-apply the ceiling cut or every clipped plate ships
    // with its roof on.
    window.__cbzVisualCompare = {
      render() {
        try {
          CBZ.renderer.clippingPlanes = S.clip ? [S.clip] : [];
          CBZ.renderer.render(CBZ.scene, S.camera || CBZ.camera);
        } catch (_) {}
      },
    };
  }

  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__yardPropOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  // ======================================================================
  //  THE CENSUS — one walk of CBZ.prisonRoot, reused by every room.
  // ======================================================================
  if (!S.census) {
    const root = CBZ.prisonRoot || CBZ.scene;
    CBZ.scene.updateMatrixWorld(true);

    // -- collider prefilter. CBZ.colliders is the whole game's static world;
    //    only rects over the compound can answer a prison question, and the
    //    400 m2 cap keeps one room-sized AABB from marking everything in it
    //    solid.
    const BOUND = { x0: -130, x1: 130, z0: -122, z1: 135 };
    const cols = [];
    for (const c of (CBZ.colliders || [])) {
      if (!c || c.maxX <= BOUND.x0 || c.minX >= BOUND.x1 || c.maxZ <= BOUND.z0 || c.minZ >= BOUND.z1) continue;
      if ((c.maxX - c.minX) * (c.maxZ - c.minZ) > 400) continue;
      cols.push(c);
    }

    /* -- WHAT COUNTS AS A CLAIM, AND WHICH KIND IT IS.
          `verb` claims are things the PLAYER does to a prop and are what
          `playerUsable` counts. A light fitting is a claim too — the night
          system drives it, so it is not dead — but nobody interacts with it,
          so it is filed as `lit` and kept out of the headline. */
    const VERB = { seat: 1, bed: 1, item: 1, vent: 1, pack: 1, push: 1, breach: 1, door: 1, interact: 1 };
    const refUse = new Map();
    const claim = (obj, kind) => { if (obj && !refUse.has(obj)) refUse.set(obj, kind); };
    for (const f of ((CBZ.prisonLights && CBZ.prisonLights.fixtures) || [])) {
      claim(f && f.mesh, "light"); claim(f && f.pool, "light"); claim(f && f.beam, "light");
    }
    for (const inst of (CBZ.propInstances || [])) claim(inst && inst.mesh, "item");
    if (CBZ.door) { claim(CBZ.door.mesh, "door"); claim(CBZ.door.reader, "door"); claim(CBZ.door.readerLight, "door"); }
    if (CBZ.armory) { claim(CBZ.armory.gate, "door"); claim(CBZ.armory.lamp, "light"); }
    if (CBZ.breaker) { claim(CBZ.breaker.box, "interact"); claim(CBZ.breaker.light, "interact"); }
    // systems/pushables.js: a box you can shove is a box the player touches,
    // with or without a collider. This is the registry the 2026-08-15 pass
    // added the laundry carts, the barbells, the milk crates and the wet-floor
    // sign to, so it is the one that has to be read by identity.
    for (const pp of (CBZ.pushProps || [])) {
      for (const part of ((pp && pp.parts) || [])) claim(part, "push");
    }
    for (const cell of ((CBZ.cellblock && CBZ.cellblock.cells) || [])) {
      if (!cell) continue;
      claim(cell.bars, "door"); claim(cell.leafClosed, "door"); claim(cell.leafOpen, "door");
    }

    // -- the floor-point registries. A propuse anchor is the walkable spot the
    //    body stands on, not a point on the mesh, so these match by XZ
    //    containment and resolve to the SMALLEST prop that contains them: a
    //    seat credits the stool, never the room.
    const points = [];
    const inBound = (x, z) => x > BOUND.x0 && x < BOUND.x1 && z > BOUND.z0 && z < BOUND.z1;
    for (const s of (CBZ.propSeats || [])) {
      // a seat anchor's y is the FLOOR the sitter stands on; cushionH is the
      // pad it credits, so the height to match is the cushion.
      if (s && inBound(s.x, s.z)) points.push({ x: s.x, z: s.z, y: (s.y || 0) + (s.cushionH || 0.45), kind: "seat", pad: 0.35 });
    }
    // A BUNK IS TWO BEDS ON ONE FOOTPRINT, separated by `top`. Matching XZ
    // alone credits the lower mattress twice and files a whole upper rack as
    // scenery.
    for (const b of (CBZ.propBeds || [])) {
      if (b && inBound(b.x, b.z)) points.push({ x: b.x, z: b.z, y: b.top, kind: "bed", pad: 0.6 });
    }
    for (const inst of (CBZ.propInstances || [])) {
      if (inst && inst.pos && inBound(inst.pos.x, inst.pos.z)) points.push({ x: inst.pos.x, z: inst.pos.z, kind: "item", pad: 0.3 });
    }
    for (const v of (CBZ.vents || [])) {
      if (v && inBound(v.x, v.z)) points.push({ x: v.x, z: v.z, kind: "vent", pad: 1.1 });
    }
    for (const c of (CBZ.coins || [])) {
      const pos = c && (c.pos || (c.group && c.group.position));
      if (pos && inBound(pos.x, pos.z)) points.push({ x: pos.x, z: pos.z, kind: "pack", pad: 0.3 });
    }

    const items = [];
    const box3 = new T.Box3();
    const scale = new T.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      // core/batch.js's merged copies are excluded. The WALL pass keeps its
      // originals in the graph (visible=false) and they are counted; the INERT
      // pass disposes its originals and they are recovered from the buffer
      // below.
      if (o.name === "batch-wall" || o.name === "batch-inert") return;
      // An actor rig is not room dressing. A door leaf carries BOTH dynamic and
      // mover and stays in.
      for (let q = o; q && q !== root; q = q.parent) {
        const ud = q.userData;
        if (ud && ud.dynamic && !ud.mover) return;
      }
      const g = o.geometry;
      if (!g.boundingBox) { try { g.computeBoundingBox(); } catch (_) { return; } }
      if (!g.boundingBox) return;
      box3.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      o.getWorldScale(scale);
      const p = (g.type === "BoxGeometry" && g.parameters) ? g.parameters : null;
      // Declared box for size/volume (rotation-invariant), world AABB for placement.
      const dims = p
        ? [Math.abs(p.width * scale.x), Math.abs(p.height * scale.y), Math.abs(p.depth * scale.z)]
        : [box3.max.x - box3.min.x, box3.max.y - box3.min.y, box3.max.z - box3.min.z];
      const rec = {
        obj: o, box: !!p, merged: false,
        ax0: box3.min.x, ax1: box3.max.x, ay0: box3.min.y, ay1: box3.max.y, az0: box3.min.z, az1: box3.max.z,
        cx: (box3.min.x + box3.max.x) / 2, cy: (box3.min.y + box3.max.y) / 2, cz: (box3.min.z + box3.max.z) / 2,
        w: dims[0], hh: dims[1], d: dims[2],
        vol: dims[0] * dims[1] * dims[2],
        color: (o.material && o.material.color && o.material.color.getHexString) ? o.material.color.getHexString() : null,
        solid: false, use: null,
      };
      // used: identity first. Only a live mesh can be identified this way; a
      // recovered box has no object left to compare against.
      for (let q = o; q; q = q.parent) {
        const kind = refUse.get(q);
        if (kind) { rec.use = kind; break; }
        const ud = q.userData;
        if (ud && ud.mover) { rec.use = "door"; break; }
        if (q === root) break;
      }
      items.push(rec);
    });

    /* ---- WHAT THE BATCHER ATE, PUT BACK ----------------------------------
       core/batch.js's INERT pass merges every mesh that is provably
       untouchable — opaque, untextured, non-emissive, no collider, no LOS
       blocker, no userData — into one buffer per tile per lighting class, then
       removes and disposes the originals. That filter is almost exactly this
       tool's definition of a dead prop, so the live graph alone reports the
       compound with its decoration already deleted. The buffer is non-indexed
       and world-baked, so every original BoxGeometry is 36 consecutive
       vertices on the 8 corners of one axis-aligned box: emit every 36-vertex
       run that PROVES itself a box, and resync a triangle at a time past the
       cylinders and tori sharing the bucket rather than guessing at them.
       Every recovered box is by construction collider-free, unlit and
       immobile; it can still be claimed by an anchor or a small unref'd
       collider below, and most of them are the worklist itself.               */
    let recovered = 0, residueTris = 0;
    root.traverse((o) => {
      if (!o.isMesh || o.name !== "batch-inert" || !o.geometry) return;
      const pos = o.geometry.attributes.position;
      const col = o.geometry.attributes.color;
      if (!pos) return;
      const a = pos.array, n = pos.count, E = 1e-4;
      let i = 0;
      while (i + 36 <= n) {
        let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (let k = 0; k < 36; k++) {
          const b = (i + k) * 3, x = a[b], y = a[b + 1], z = a[b + 2];
          if (x < mnx) mnx = x; if (x > mxx) mxx = x;
          if (y < mny) mny = y; if (y > mxy) mxy = y;
          if (z < mnz) mnz = z; if (z > mxz) mxz = z;
        }
        let isBox = true;
        for (let k = 0; k < 36 && isBox; k++) {
          const b = (i + k) * 3, x = a[b], y = a[b + 1], z = a[b + 2];
          if (!((Math.abs(x - mnx) < E || Math.abs(x - mxx) < E) &&
                (Math.abs(y - mny) < E || Math.abs(y - mxy) < E) &&
                (Math.abs(z - mnz) < E || Math.abs(z - mxz) < E))) isBox = false;
        }
        if (!isBox) { residueTris++; i += 3; continue; }
        let hex = null;
        if (col) {
          const b = i * 3;
          hex = ((Math.round(col.array[b] * 255) << 16) | (Math.round(col.array[b + 1] * 255) << 8) |
            Math.round(col.array[b + 2] * 255)).toString(16).padStart(6, "0");
        }
        const w2 = mxx - mnx, h2 = mxy - mny, d2 = mxz - mnz;
        items.push({
          obj: null, box: true, merged: true,
          ax0: mnx, ax1: mxx, ay0: mny, ay1: mxy, az0: mnz, az1: mxz,
          cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, cz: (mnz + mxz) / 2,
          w: w2, hh: h2, d: d2, vol: w2 * h2 * d2, color: hex,
          solid: false, use: null,
        });
        recovered++;
        i += 36;
      }
    });

    // -- solid, live and recovered alike: the mesh's own collider record, or a
    //    small CBZ.colliders rect that owns this spot.
    for (let j = 0; j < items.length; j++) {
      const rec = items[j];
      if (rec.obj && rec.obj.userData && rec.obj.userData.collider) { rec.solid = true; continue; }
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (rec.cx < c.minX - 0.05 || rec.cx > c.maxX + 0.05 || rec.cz < c.minZ - 0.05 || rec.cz > c.maxZ + 0.05) continue;
        if (c.y0 != null && rec.ay1 < c.y0) continue;
        if (c.y1 != null && rec.ay0 > c.y1) continue;
        rec.solid = true; break;
      }
    }

    // -- used: the floor-point registries, resolved to the SMALLEST prop that
    //    contains the anchor. NOTE the difference from prison-rooms.mjs: a
    //    SOLID box is still eligible here, because the whole point of this
    //    preset is that a bench being solid must not erase the fact that you
    //    can sit on it.
    const seeds = [];
    for (const pt of points) {
      let best = null;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.box) continue;
        if (pt.x < it.ax0 - pt.pad || pt.x > it.ax1 + pt.pad) continue;
        if (pt.z < it.az0 - pt.pad || pt.z > it.az1 + pt.pad) continue;
        if (it.ay0 > 2.6) continue;                       // a ceiling box is not a chair
        if (pt.y != null && (it.ay1 < pt.y - 0.3 || it.ay0 > pt.y + 0.3)) continue;
        if (!best || it.vol < best.vol) best = it;
      }
      if (best) { if (!best.use) best.use = pt.kind; seeds.push(best); }
    }

    // -- used: registered breach targets. CBZ.breachTargetAt is the only public
    //    read of systems/breach.js's private list, and a target's reach is
    //    metres wide, so only a prop sitting ON the point is claimed.
    if (typeof CBZ.breachTargetAt === "function") {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.use || !it.box) continue;
        let hit = null;
        try { hit = CBZ.breachTargetAt(it.cx, it.cy, it.cz, 0); } catch (_) { hit = null; }
        if (hit && hit.dist <= 1.0) { it.use = "breach"; seeds.push(it); }
      }
    }

    /* ---- THE PIECE, NOT THE ANCHOR --------------------------------------
       A bunk is eight boxes and one bed anchor; a bleacher tier is one box and
       four. Filing a bed's pillow, blanket and rails as scenery would be a lie
       about a bed a man sleeps in, so a claim spreads to boxes in CONTACT with
       the claimed box — AABBs overlapping within 12 cm — two hops out and at
       most 24 to a cluster, which is one piece of furniture and not the room it
       stands in. Shell boxes are already out of the prop set, so a claim cannot
       leak through a floor into a wall. Solid neighbours are not absorbed:
       a bench must not drag the wall behind it into its own cluster.           */
    const GRID = 2.5;
    const cellsOf = (it) => {
      const out = [];
      const gx0 = Math.floor((it.ax0 - 0.2) / GRID), gx1 = Math.floor((it.ax1 + 0.2) / GRID);
      const gz0 = Math.floor((it.az0 - 0.2) / GRID), gz1 = Math.floor((it.az1 + 0.2) / GRID);
      if ((gx1 - gx0 + 1) * (gz1 - gz0 + 1) > 64) return out;   // a room-sized box indexes nowhere
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) out.push(gx + "," + gz);
      return out;
    };
    const grid = new Map();
    for (const it of items) {
      if (!it.box) continue;
      for (const key of cellsOf(it)) {
        let bucket = grid.get(key);
        if (!bucket) { bucket = []; grid.set(key, bucket); }
        bucket.push(it);
      }
    }
    const touches = (a, b) => a.ax0 - 0.12 <= b.ax1 && a.ax1 + 0.12 >= b.ax0 &&
      a.ay0 - 0.12 <= b.ay1 && a.ay1 + 0.12 >= b.ay0 &&
      a.az0 - 0.12 <= b.az1 && a.az1 + 0.12 >= b.az0;
    for (const seed of seeds) {
      let frontier = [seed];
      const seen = new Set([seed]);
      for (let hop = 0; hop < 2 && seen.size < 24; hop++) {
        const next = [];
        for (const cur of frontier) {
          for (const key of cellsOf(cur)) {
            for (const cand of (grid.get(key) || [])) {
              if (seen.has(cand) || cand.solid || !touches(cur, cand)) continue;
              seen.add(cand); next.push(cand);
              if (!cand.use) cand.use = (seed.use || "seat") + "-part";
              if (seen.size >= 24) break;
            }
          }
        }
        frontier = next;
      }
    }

    S.census = {
      items, VERB,
      colliders: cols.length, points: points.length, refs: refUse.size,
      recovered, residueTris,
      // the room-furnishing plumbing, as three facts instead of a header claim
      furnish: !!(CBZ.furnish && typeof CBZ.furnish.sofa === "function"),
      seats: (CBZ.propSeats || []).length,
      beds: (CBZ.propBeds || []).length,
      pushProps: (CBZ.pushProps || []).length,
    };
  }

  // ======================================================================
  //  ONE ROOM: resolve the rect live, then classify everything inside it.
  // ======================================================================
  const subject = input.subject;
  const authored = subject.room;
  const angle = subject.angle;
  const VERB = S.census.VERB;

  if (!S.rooms[authored.id]) {
    const rect = { x0: authored.x0, x1: authored.x1, z0: authored.z0, z1: authored.z1, h: authored.h, source: "authored" };
    // LIVE FIRST: systems/prisonnight.js publishes its regions as
    // CBZ.prisonLights.rooms and other files push onto the same array on their
    // first tick, so a room that moved moves here too.
    if (authored.live) {
      const live = ((CBZ.prisonLights && CBZ.prisonLights.rooms) || []).find((r) => r && r.id === authored.live);
      if (live && Number.isFinite(live.x0)) {
        rect.x0 = live.x0; rect.x1 = live.x1; rect.z0 = live.z0; rect.z1 = live.z1;
        rect.source = "CBZ.prisonLights.rooms[" + authored.live + "]";
      }
    }

    const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0, h = rect.h;
    const area = w * d;
    const cutouts = [];
    for (const other of (subject.enclosed || [])) {
      if (other.id === authored.id) continue;
      const box = { x0: other.x0, x1: other.x1, z0: other.z0, z1: other.z1 };
      if (other.live) {
        const live = ((CBZ.prisonLights && CBZ.prisonLights.rooms) || []).find((r) => r && r.id === other.live);
        if (live && Number.isFinite(live.x0)) { box.x0 = live.x0; box.x1 = live.x1; box.z0 = live.z0; box.z1 = live.z1; }
      }
      if (box.x1 <= rect.x0 || box.x0 >= rect.x1 || box.z1 <= rect.z0 || box.z0 >= rect.z1) continue;
      cutouts.push(box);
    }
    const cutOut = (x, z) => {
      for (const b of cutouts) if (x > b.x0 - 0.6 && x < b.x1 + 0.6 && z > b.z0 - 0.6 && z < b.z1 + 0.6) return true;
      return false;
    };

    const items = S.census.items;
    let meshes = 0, excludedProps = 0;
    const inside = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.merged && it.ax1 > rect.x0 && it.ax0 < rect.x1 && it.az1 > rect.z0 && it.az0 < rect.z1 &&
          it.ay1 > -0.1 && it.ay0 < h + 0.2) meshes++;
      // props: CENTRE inside the rect, so a passing perimeter wall is never
      // this room's prop.
      if (!it.box) continue;
      if (it.cx < rect.x0 - 0.35 || it.cx > rect.x1 + 0.35) continue;
      if (it.cz < rect.z0 - 0.35 || it.cz > rect.z1 + 0.35) continue;
      if (it.cy < -0.2 || it.cy > h + 0.8) continue;
      if (cutouts.length && cutOut(it.cx, it.cz)) { excludedProps++; continue; }
      inside.push(it);
    }

    // -- SHELL: a floor slab, a boundary wall, a roof deck. Never dressing, so
    //    never counted against the room. A SHAPE test, not a fraction: at least
    //    5 cm thick and 6 m2 of footprint, on the deck or overhead. Deck paint
    //    stays out by the 5 cm floor — a floorLine is 2 cm.
    const nearEdge = (v, a, b) => Math.abs(v - a) <= 1.2 || Math.abs(v - b) <= 1.2;
    let shell = 0, props = 0, solidProps = 0, usedProps = 0, deadProps = 0, deadFlat = 0, mergedProps = 0;
    let playerUsable = 0, coverProps = 0, litProps = 0, deadOverhead = 0;
    let propVolume = 0, deadPropVolume = 0, deadOverheadVolume = 0;
    const dead = [];
    const verbKinds = {};
    for (const it of inside) {
      const foot = it.w * it.d;
      let kind = null;
      if (it.hh >= 0.05 && it.hh <= 0.4 && it.cy <= 0.7 && foot >= 6) kind = "floor";
      else if (it.hh >= 0.05 && it.hh <= 0.7 && it.ay0 >= 2.2 && foot >= 6) kind = "roof";
      else if (it.hh >= 1.2 && Math.min(it.w, it.d) <= 1.2 && Math.max(it.w, it.d) >= 1.5 &&
        (nearEdge(it.cx, rect.x0, rect.x1) || nearEdge(it.cz, rect.z0, rect.z1))) kind = "wall";
      if (kind) { shell++; continue; }

      props++;
      if (it.merged) mergedProps++;
      propVolume += it.vol;

      /* THE OWNER'S NUMBER, COUNTED FIRST AND INDEPENDENTLY. A prop that
         carries a verb is usable whether or not it also carries a collider —
         which is the whole reason this preset exists beside prison-rooms.mjs.
         `-part` suffixes come from the contact spread and are the same verb. */
      const base = it.use ? String(it.use).replace(/-part$/, "") : null;
      if (base && VERB[base]) {
        playerUsable++;
        verbKinds[base] = (verbKinds[base] || 0) + 1;
      } else if (base === "light") {
        litProps++;
      } else if (it.solid) {
        coverProps++;
      }

      // THE THREE BUCKETS prison-rooms.mjs reports, in prison-rooms.mjs's own
      // order, so the two reports can be diffed line for line.
      if (it.solid) { solidProps++; continue; }
      if (it.use) { usedProps++; continue; }
      deadProps++;
      deadPropVolume += it.vol;
      if (Math.min(it.w, it.hh, it.d) <= 0.05) deadFlat++;
      // How much of the dead volume is roof-edge and ceiling structure a player
      // can never reach? Reported so nobody reads a parapet kerb as slop.
      if (it.ay0 >= 4.5) { deadOverhead++; deadOverheadVolume += it.vol; }
      dead.push(it);
    }
    dead.sort((a, b) => b.vol - a.vol);

    // The plumbing, inside THIS rect: anchors that actually landed here.
    const inRect = (x, z) => x >= rect.x0 - 0.5 && x <= rect.x1 + 0.5 && z >= rect.z0 - 0.5 && z <= rect.z1 + 0.5;
    let seatAnchors = 0, bedAnchors = 0;
    for (const s of (CBZ.propSeats || [])) if (s && inRect(s.x, s.z) && !(cutouts.length && cutOut(s.x, s.z))) seatAnchors++;
    for (const b of (CBZ.propBeds || [])) if (b && inRect(b.x, b.z) && !(cutouts.length && cutOut(b.x, b.z))) bedAnchors++;

    S.rooms[authored.id] = {
      rect, area, excludedProps, seatAnchors, bedAnchors, verbKinds,
      metrics: {
        meshes, props, playerUsable, coverProps, litProps,
        solidProps, usedProps, deadProps, deadFlat, deadOverhead, mergedProps,
        shellBoxes: shell,
        seatAnchors, bedAnchors,
        floorArea: round(area, 1),
        propVolume: round(propVolume, 2),
        deadPropVolume: round(deadPropVolume, 2),
        deadOverheadVolume: round(deadOverheadVolume, 2),
      },
      // the worklist, biggest first: position, size and colour are what a
      // reader greps the world files with.
      deadSample: dead.slice(0, 16).map((it) => ({
        x: round(it.cx), y: round(it.cy), z: round(it.cz),
        w: round(it.w), h: round(it.hh), d: round(it.d), vol: round(it.vol, 3), color: it.color,
      })),
    };
  }
  const R = S.rooms[authored.id];
  const rect = R.rect;

  // ======================================================================
  //  THE CAMERA — a function of the rect and the door side, nothing else, so
  //  a room that grows reframes itself instead of needing a hand-tuned shot.
  // ======================================================================
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0, h = rect.h;
  const rad = 0.5 * Math.hypot(w, d);
  const aspect = input.width / input.height;
  const DEG = Math.PI / 180;
  const door = authored.door || { side: "N", center: cx };
  const OUT = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
  const n = OUT[door.side] || OUT.S;

  const camera = CBZ.camera;
  camera.aspect = aspect;
  camera.near = 0.12;
  camera.far = 20000;
  let clipY = null;
  if (angle === "plan") {
    const fov = 45;
    const need = Math.max(d / 2, (w / 2) / aspect) * 1.14;
    camera.fov = fov;
    camera.up.set(0, 0, -1);
    camera.position.set(cx, h + need / Math.tan((fov / 2) * DEG), cz);
    camera.lookAt(cx, 0, cz);
    if (!authored.open) clipY = h - 0.15;
  } else if (angle === "eye") {
    camera.fov = 62;
    camera.up.set(0, 1, 0);
    const px = door.side === "E" ? rect.x1 - 0.55 : door.side === "W" ? rect.x0 + 0.55 : door.center;
    const pz = door.side === "S" ? rect.z1 - 0.55 : door.side === "N" ? rect.z0 + 0.55 : door.center;
    camera.position.set(px, 1.70, pz);
    if (Math.hypot(cx - px, cz - pz) > 1.5) camera.lookAt(cx, 1.45, cz);
    else camera.lookAt(px - n[0] * 4, 1.45, pz - n[1] * 4);
  } else {
    const fov = 50;
    camera.fov = fov;
    camera.up.set(0, 1, 0);
    // 38 deg off the doorway normal, 48 deg up: high enough that a neighbouring
    // shell never stands in the sight line, and backed off so the rect's
    // circumradius fits the lens.
    const yaw = 38 * DEG, ca = Math.cos(yaw), sa = Math.sin(yaw);
    const dx = n[0] * ca - n[1] * sa, dz = n[0] * sa + n[1] * ca;
    const dist = Math.max(11, (rad * 1.2 + h * 0.5) / Math.tan((fov / 2) * DEG));
    const elev = 48 * DEG;
    camera.position.set(cx + dx * dist * Math.cos(elev), h * 0.4 + dist * Math.sin(elev), cz + dz * dist * Math.cos(elev));
    camera.lookAt(cx, h * 0.2, cz);
    if (!authored.open) clipY = h - 0.15;
  }
  camera.updateProjectionMatrix();
  S.camera = camera;

  // Every camera here is a detached inspection view; the local avatar's
  // third-person rig must never wander into one.
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
  if (typeof CBZ.skySync === "function") CBZ.skySync();

  // THE ROOF COMES OFF WITH A CLIPPING PLANE, not by hiding meshes: most of the
  // deck over this compound is merged geometry shared between rooms, so there
  // is no per-room mesh left to hide, and a global plane cuts the merged copy
  // and the original alike. r128 discards where dot(vClipPosition, plane.xyz) >
  // plane.w with vClipPosition = MINUS the view position, so keeping everything
  // under clipY is a -Y normal at constant clipY.
  const renderer = CBZ.renderer;
  renderer.localClippingEnabled = true;
  S.clip = clipY == null ? null : new T.Plane(new T.Vector3(0, -1, 0), clipY);
  renderer.clippingPlanes = S.clip ? [S.clip] : [];

  setHud(false);
  if (renderer.info && renderer.info.reset) renderer.info.reset();
  renderer.render(CBZ.scene, camera);
  const drawCalls = (renderer.info && renderer.info.render && renderer.info.render.calls) || 0;

  // ---- the overlay ------------------------------------------------------
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  const m = R.metrics;
  // A prison interior at noon renders near-white in this engine, so every
  // caption sits on its own dark plate or half the report is unreadable.
  const PLATE = "background:rgba(9,13,19,.72);padding:6px 10px;border-radius:7px;";
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:20px;left:24px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:62px;left:24px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:620px;" + PLATE;
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;top:104px;left:24px;color:#c8d6e2;font-size:12px;font-weight:550;max-width:600px;" + PLATE;
  q("use").textContent = `USABLE ${m.playerUsable} of ${m.props}  ·  cover ${m.coverProps} · lit ${m.litProps} · seats ${m.seatAnchors} · beds ${m.bedAnchors}`;
  q("use").style.cssText = `position:absolute;right:22px;top:20px;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;text-align:right;color:${m.playerUsable ? "#9fe8c3" : "#ff9c9c"};` + PLATE;
  q("nums").textContent =
    `props ${m.props} · solid ${m.solidProps} · used ${m.usedProps} · DEAD ${m.deadProps} (${m.deadPropVolume} m3, ${m.deadFlat} flat, ${m.deadOverhead} overhead)`;
  q("nums").style.cssText = `position:absolute;right:22px;top:60px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;color:${m.deadProps > 20 ? "#ff9c9c" : "#9fe8c3"};` + PLATE;
  q("rect").textContent =
    `x[${round(rect.x0, 1)},${round(rect.x1, 1)}] z[${round(rect.z0, 1)},${round(rect.z1, 1)}] h${round(h, 1)} · ${round(R.area, 0)} m2 · rect ${rect.source}` +
    ` · merged-recovered ${m.mergedProps}` +
    (R.excludedProps ? ` · ${R.excludedProps} props left to the enclosed rooms` : "") +
    ` · furnish ${S.census.furnish ? "up" : "ABSENT"} · draws ${drawCalls}` +
    ` · ${authored.owner}`;
  q("rect").style.cssText = "position:absolute;right:22px;bottom:18px;color:#b3c1cd;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;max-width:700px;" + PLATE;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:18px;left:24px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;" + PLATE;

  return {
    ok: true,
    room: authored.id,
    angle,
    owner: authored.owner,
    rect: {
      x0: round(rect.x0), x1: round(rect.x1), z0: round(rect.z0), z1: round(rect.z1),
      h: round(rect.h), source: rect.source,
    },
    camera: {
      position: [round(camera.position.x), round(camera.position.y), round(camera.position.z)],
      fov: camera.fov, clipY: clipY == null ? null : round(clipY),
      door: door.side + "@" + round(door.center, 1),
    },
    // the compound-wide plumbing, so a report says WHY a room has no seats
    plumbing: {
      furnish: S.census.furnish,
      seatAnchorsTotal: S.census.seats,
      bedAnchorsTotal: S.census.beds,
      pushPropsTotal: S.census.pushProps,
      colliders: S.census.colliders,
      recoveredFromBatcher: S.census.recovered,
    },
    verbKinds: R.verbKinds,
    deadSample: R.deadSample,
    excludedProps: R.excludedProps,
    drawCalls,
    metrics: R.metrics,
  };
}

export default {
  id: "prison-yard-props",
  title: "Prison Yards + Service Rooms: Is Any Of This Usable?",
  description: "Seven prison rooms — both yards, the sally port, the chow hall, the dayroom, the laundry and the workshop — photographed three ways from the live world, with every prop in them counted. `playerUsable` is the headline and the one number the other room audit cannot give: props the player can sit on, sleep in, take from, crawl into, shove, breach or open, counted INDEPENDENTLY of whether they are also solid. `coverProps` are the ones that only stop you; `deadProps` are the remainder, decoration a body walks through and can never touch, with the sub-5 cm paint slice and the above-4.5 m roof-edge slice broken out so neither is mistaken for slop.",
  beforeLabel: "BEFORE · BASELINE",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1200, height: 760 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "Measured live inside each room's AABB while the plate was staged. `props` counts BoxGeometry meshes whose centre is inside the rect and that are not the room's floor, boundary wall or roof deck. playerUsable counts the props claimed by a PLAYER verb — a city/propuse.js seat or bed anchor, a CBZ.prisonPlaceItem instance, a CBZ.vents grate, a CBZ.coins pack, a systems/pushables.js shovable, a systems/breach.js target or a door leaf — and, unlike prison-rooms.mjs's usedProps, it does not lose a bench for also being solid. deadProps/deadFlat/deadPropVolume use prison-rooms.mjs's exact rules and ordering so the two reports diff line for line. deadFlat (deck paint, decals, signage skins) and deadOverhead (roof parapet kerbs, copings, ceiling purlins above 4.5 m) are legitimate and are broken out so the headline count is not read as a defect list.",
  metrics: {
    playerUsable: { label: "Props a player can interact with", better: "higher" },
    coverProps: { label: "Props that are cover only", better: "higher" },
    litProps: { label: "Light fittings on the night circuit" },
    seatAnchors: { label: "propuse seat anchors in the room", better: "higher" },
    bedAnchors: { label: "propuse bed anchors in the room", better: "higher" },
    props: { label: "Prop boxes" },
    solidProps: { label: "Props with a collider", better: "higher" },
    usedProps: { label: "Props claimed, collider aside (prison-rooms rule)" },
    deadProps: { label: "Dead props", better: "lower" },
    deadPropVolume: { label: "Dead prop volume", unit: "m3", better: "lower" },
    deadFlat: { label: "of those, under 5 cm (deck paint / signage)" },
    deadOverhead: { label: "of those, above 4.5 m (roof edge / purlins)" },
    mergedProps: { label: "Props recovered from the batcher" },
    shellBoxes: { label: "Shell boxes (floor/wall/roof)" },
    meshes: { label: "Draw objects in rect" },
    floorArea: { label: "Floor area", unit: "m2" },
    propVolume: { label: "Prop volume", unit: "m3" },
    deadOverheadVolume: { label: "Dead volume above 4.5 m", unit: "m3" },
  },
  subjects,
  stage: stageYardProps,
};
