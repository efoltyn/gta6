/* PRISON WING PROPS — the before/after for the 2026-08-15 "every prop is
   usable or it goes" pass. For tools/visual-compare.mjs.

   WHY A SECOND ROOM PRESET EXISTS
   -------------------------------
   tools/visual-presets/prison-rooms.mjs audits all 37 rooms in the escape
   venue and is the survey that FOUND this work: it is where `deadProps` and
   `deadPropVolume` are defined, and its baseline lives in
   artifacts/visual-comparisons/prison-rooms-audit. This preset is not a
   replacement for it and does not re-derive anything it already proved. It is
   the narrow instrument for ONE change: the thirteen rooms touched by
   world/prisonwings.js, world/gunroom.js, world/cellblock.js and
   world/adminwing.js under CBZ.CONFIG.PRISON_PROP_HONESTY_V1. Running the
   37-room survey to read twelve numbers photographs twenty-four rooms nobody
   touched and buries the twelve that moved.

   THE CENSUS IS PRISON-ROOMS' CENSUS, DELIBERATELY VERBATIM
   ---------------------------------------------------------
   The whole stage function below — the one walk of CBZ.prisonRoot, the
   collider prefilter, the registry claims, the floor-point anchor matching,
   the two-hop contact cluster, the shell shape test, and above all the pass
   that UNPICKS core/batch.js's merged inert buffers back into boxes — is
   copied from prison-rooms.mjs rather than rewritten. That is the point: the
   owner's judgement is a comparison against a number that already exists, and
   a second implementation of "what is a dead prop" would let this file grade
   its own homework. Read prison-rooms.mjs's header for how every metric is
   measured; it is the authority and this file must not disagree with it.

   WHAT THIS FILE ADDS: `interactiveProps`
   ---------------------------------------
   The owner asked, in words, for "the number of props a player can actually
   interact with". `usedProps` cannot answer that, because a use claim SPREADS
   to every box touching a claimed box (prison-rooms' cluster rule — a bunk is
   eight boxes and one bed anchor, and calling its pillow dead scenery would be
   a lie). So `usedProps` counts BOXES that belong to something used, which is
   the right number for "is this dressing or furniture" and the wrong number
   for "how many things can I touch". `interactiveProps` counts only PRIMARY
   claims — the box a registry itself resolved to, never a `-part` — so it is a
   count of THINGS: placed items, seats, beds, door leaves, breach targets,
   shovables, grates, packs, interact sites. In the tool crib it is the number
   of tools; in a cell it is the bunk, the stool and the fittings.

   THE THIRTEEN ROOMS AND WHAT WAS WRONG WITH EACH
   -----------------------------------------------
   Every row's `was` is this room's number in the prison-rooms baseline, so a
   reader can see what the change was aimed at without opening that run:

     tool-crib / knife-cage / property-cage
        cage() ended with three "shelves" sized to the WHOLE cage — in the
        crib a 10.4 x 14.4 m cream plane 7 cm thick, three of them stacked.
        deadPropVolume 10.48 / 7.57 / 9.03 m3 = 27.08 m3 of walk-through
        shelf across three rooms that hold three or four items each.
     industries      155 props, 23 dead, 13.33 m3 — almost all of it the tool
                     crib's shelves, which stand inside this room's rect.
     powerhouse      35 props, 10 solid, 15 dead in 896 m2. Its own comment
                     says it exists for COVER; nothing in it was below 4 m.
     segregation     sixteen bunks that were raw addBox slabs — no useBed, no
                     CBZ.propRegisterBed, no CBZ.prisonBunk — plus a
                     zero-height zero-depth black box drawn sixteen times
                     whose own comment admitted it was a no-op.
     control         69 props, 38 dead. Eight 3 x 1 x 0.1 monitor slabs on a
                     wall with nothing behind or under them.
     armory          221 props, 88 solid, 8 used, 125 DEAD — the worst dead
                     COUNT in the compound. The top of that list was the
                     FURNITURE: plinth 1.026 m3, backboard 0.849, bench apron
                     0.624, bench top 0.288, all drawn with `{}` and no solid.
     cell-single     every cell in the prison had a walk-through toilet.
     cell-showers    9 props, 0 solid, 0 USED. A plank at y=1.0 with no legs.
     cell-store      5 props, 0 solid, 0 used, 3.61 m3 — including a 2.145 m3
                     laundry cart, the biggest dead box in the cell house.
     cell-officer-post  a duty chair nobody could sit in.
     admin-records   two 3.4 x 3.6 m shelf planes, 0.857 m3 EACH — the admin
                     block's two biggest dead boxes, the same lie as the cages.
     warden-office   included as a CONTROL. Almost nothing in it is mine
                     (CBZ.furnish.bossDesk is world/roombuild.js), so its
                     numbers should barely move, and if they move a lot
                     something leaked out of the four files this pass owns.

   Read `deadPropVolume` before `deadProps`. A room whose dead count falls by
   three but whose dead VOLUME falls by 10 m3 deleted a wall-sized lie; a room
   whose count falls by thirty and volume by 0.2 m3 deleted confetti.

   Run:
     npm run visual:prison-wing-props -- --before http://127.0.0.1:8799/
   Baseline without network (f957614 is the commit this pass started from):
     git worktree add /tmp/cbz-wing-base f957614
     cd /tmp/cbz-wing-base && PORT=8799 python3 tools/devserver.py
*/

/* ---- THE ROOMS. Same contract as prison-rooms.mjs:
   live:"id"  → rect taken from CBZ.prisonLights.rooms[id] at stage time; the
                x0/x1/z0/z1 here are only the degrade path.
   cell:true  → rect read off CBZ.cellblock.playerCell.
   door       → the real doorway from the source line named in `src`.          */
const ROOMS = [
  // ---- world/prisonwings.js -------------------------------------------------
  { id: "tool-crib", label: "Industries · tool crib", h: 2.9,
    x0: -116, x1: -104, z0: 28, z1: 44, door: { side: "N", center: -108.9 },
    src: "world/prisonwings.js cage() + CRIB_DOOR + cageRack()" },
  { id: "knife-cage", label: "Kitchen · knife cage", h: 2.9,
    x0: 98, x1: 110, z0: 84, z1: 96, door: { side: "N", center: 103.7 },
    src: "world/prisonwings.js cage() + KNIFE_DOOR + cageRack()" },
  { id: "property-cage", label: "Visitation · property cage", h: 2.9,
    x0: 96, x1: 110, z0: 104, z1: 116, door: { side: "S", center: 103 },
    src: "world/prisonwings.js cage() + PROP_DOOR + cageRack()" },
  { id: "industries", label: "Prison industries", live: "industries", h: 7.5,
    x0: -116, x1: -66, z0: -4, z1: 44, door: { side: "E", center: 20 },
    src: "world/prisonwings.js room({id:'industries'})" },
  { id: "powerhouse", label: "Powerhouse", live: "powerhouse", h: 8,
    x0: -112, x1: -84, z0: 62, z1: 94, door: { side: "E", center: 78 },
    src: "world/prisonwings.js room({id:'powerhouse'}) + pipeBank()" },
  { id: "segregation", label: "Segregation unit", live: "segregation", h: 7,
    x0: 58, x1: 112, z0: -4, z1: 44, door: { side: "W", center: 20 },
    src: "world/prisonwings.js room({id:'segregation'}) + CBZ.prisonBunk" },
  { id: "control", label: "Central control", live: "control", h: 6.5,
    x0: -26, x1: 26, z0: -108, z1: -78, door: { side: "S", center: 0 },
    src: "world/prisonwings.js room({id:'control'}) + the relay run" },

  // ---- world/gunroom.js -----------------------------------------------------
  { id: "armory", label: "Armoury / gun room", live: "armory", h: 6,
    x0: 19, x1: 29, z0: -6, z1: 8, door: { side: "W", center: 1 },
    src: "world/gunroom.js roomShell + unit()" },

  // ---- world/cellblock.js ---------------------------------------------------
  { id: "cell-single", label: "Cell A-1 · one cell interior", h: 3.6, cell: true,
    x0: -12.9, x1: -9.1, z0: -43.5, z1: -38, door: { side: "S", center: -11 },
    src: "world/cellblock.js NORTH_ROW A-1 + toiletSink(); rect live off CBZ.cellblock.playerCell" },
  { id: "cell-showers", label: "Cell house · shower alcove", h: 3.6,
    x0: -15.5, x1: -13.24, z0: -43.5, z1: -38, door: { side: "S", center: -14.37 },
    src: "world/cellblock.js showerAlcove()" },
  { id: "cell-store", label: "Cell house · linen store", h: 3.6,
    x0: 13.24, x1: 15.5, z0: -43.5, z1: -38, door: { side: "S", center: 14.37 },
    src: "world/cellblock.js storeAlcove()" },
  { id: "cell-officer-post", label: "Cell house · officer post", h: 3.6,
    x0: -4.62, x1: 4.62, z0: -43.5, z1: -38, door: { side: "S", center: 0 },
    src: "world/cellblock.js officerPost()" },

  // ---- world/adminwing.js ---------------------------------------------------
  { id: "admin-records", label: "Administration · records & property cage", h: 6,
    x0: -19.7, x1: -7, z0: -63.7, z1: -49.4, door: { side: "S", center: -13.6 },
    src: "world/adminwing.js propertyCage()" },
  { id: "warden-office", label: "Warden's office — CONTROL, barely touched", h: 6,
    x0: 6, x1: 19.7, z0: -57.4, z1: -49.4, door: { side: "S", center: 11.4 },
    src: "world/adminwing.js furnish('warden-office'); the desk is world/roombuild.js's, not ours" },
];

const ANGLES = [
  { id: "over", label: "raised three-quarter",
    focus: "The whole room from above the doorway wall, roof deck clipped off. Is there a program in here, or a scatter of boxes?" },
  { id: "eye", label: "doorway, eye level",
    focus: "What a player sees walking in: eye at 1.70 m, 0.55 m inside the door. Anything that reads as furniture from here must be usable from here." },
  { id: "plan", label: "plan",
    focus: "Straight down with the roof clipped, +X right and +Z down like the minimap. Circulation, blocked lanes, props stacked on each other." },
];

const ROSTER = ROOMS.filter((room) => room.live).map((room) => room.live);
const ENCLOSED = ROOMS.filter((room) => !room.open)
  .map((room) => ({ id: room.id, live: room.live || null, cell: !!room.cell,
    x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1 }));

const subjects = [];
for (const room of ROOMS) {
  for (const angle of ANGLES) {
    subjects.push({
      id: `${room.id}-${angle.id}`,
      label: `${room.label} — ${angle.label}`,
      focus: angle.focus,
      angle: angle.id,
      room,
      roster: ROSTER,
      enclosed: room.open ? ENCLOSED : null,
    });
  }
}

async function stageWingProps(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

  let S = window.__prisonWingPropAudit;

  // ======================================================================
  //  ONE-TIME: boot the real game into escape mode, freeze it, census it.
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
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing" && CBZ.game.mode === "escape";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached escape/playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // Freeze the rAF loop; CBZ.stepSim is the only clock from here.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    // THE COMPOUND IS NOT FINISHED AT TICK 0. The three stock cages
    // (prisonwings.js:437), the yard tool laying (yardfurniture.js:235), the
    // crate tools (crates.js:227) and world/cellblock.js's propuse flush all
    // ride deferred onUpdate passes. A census taken before they run reports a
    // prison with no placed items and no registered bunks.
    for (let i = 0; i < 240; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
    }

    const overlay = document.createElement("div");
    overlay.id = "__prisonWingPropOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-nums></div><div data-rect></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__prisonWingPropAudit = { overlay, census: null, rooms: {}, camera: null, clip: null };
    // The runner re-renders through this hook right before the compositor
    // barrier, so it — not the stage's own render call — is what the
    // screenshot actually contains. It has to re-apply the ceiling cut, or
    // every clipped plate ships as an un-clipped roof.
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
      if (child.id === "__prisonWingPropOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  // ======================================================================
  //  THE CENSUS — one walk of CBZ.prisonRoot, reused by every room.
  // ======================================================================
  if (!S.census) {
    const root = CBZ.prisonRoot || CBZ.scene;
    CBZ.scene.updateMatrixWorld(true);

    // -- the collider prefilter. CBZ.colliders is the whole game's static
    //    world (six figures with the city up); only the ones over the
    //    compound can ever answer a prison question, and the 400 m2 cap
    //    keeps a room-sized AABB from marking every box inside it solid.
    const BOUND = { x0: -130, x1: 130, z0: -122, z1: 135 };
    const cols = [];
    for (const c of (CBZ.colliders || [])) {
      if (!c || c.maxX <= BOUND.x0 || c.minX >= BOUND.x1 || c.maxZ <= BOUND.z0 || c.minZ >= BOUND.z1) continue;
      if ((c.maxX - c.minX) * (c.maxZ - c.minZ) > 400) continue;
      cols.push(c);
    }

    // -- the mesh refs that ARE a use, by identity. Anything under one of
    //    these objects is claimed by whatever registered it.
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
    // whether or not it also carries a collider.
    for (const pp of (CBZ.pushProps || [])) {
      for (const part of ((pp && pp.parts) || [])) claim(part, "push");
    }
    for (const cell of ((CBZ.cellblock && CBZ.cellblock.cells) || [])) {
      if (!cell) continue;
      claim(cell.bars, "door"); claim(cell.leafClosed, "door"); claim(cell.leafOpen, "door");
    }

    // -- the floor-point registries. A propuse anchor is the walkable spot
    //    the body stands on, not a point on the mesh, so these are matched by
    //    XZ containment and resolved to the SMALLEST prop that contains them.
    const points = [];
    const inBound = (x, z) => x > BOUND.x0 && x < BOUND.x1 && z > BOUND.z0 && z < BOUND.z1;
    for (const s of (CBZ.propSeats || [])) {
      // a seat anchor's y is the FLOOR the sitter stands on; `cushionH` is the
      // pad it credits, so the height to match against is the cushion.
      if (s && inBound(s.x, s.z)) points.push({ x: s.x, z: s.z, y: (s.y || 0) + (s.cushionH || 0.45), kind: "seat", pad: 0.35 });
    }
    // A BUNK IS TWO BEDS AT ONE (x,z). world/cellblock.js registers the lower
    // rack and the upper rack on the same footprint and separates them by
    // `top` (the mattress surface, 0.79 and 1.97). Matching XZ alone credited
    // the lower mattress twice and left the whole upper rack — frame, mattress,
    // bedding, rail — filed as dead scenery in every cell in the prison.
    for (const b of (CBZ.propBeds || [])) {
      if (b && inBound(b.x, b.z)) points.push({ x: b.x, z: b.z, y: b.top, kind: "bed", pad: 0.6 });
    }
    for (const inst of (CBZ.propInstances || [])) {
      if (inst && inst.pos && inBound(inst.pos.x, inst.pos.z)) points.push({ x: inst.pos.x, z: inst.pos.z, kind: "item", pad: 0.3 });
    }
    // CBZ.vents — the escape-route network (world/ventilation.js,
    // world/escape_routes.js). A floor hatch is twelve boxes and the one thing
    // in the room a player crawls into; the grate is not scenery.
    for (const v of (CBZ.vents || [])) {
      if (v && inBound(v.x, v.z)) points.push({ x: v.x, z: v.z, kind: "vent", pad: 1.1 });
    }
    // CBZ.coins — the cigarette packs, a walk-over pickup.
    for (const c of (CBZ.coins || [])) {
      const pos = c && (c.pos || c.group && c.group.position);
      if (pos && inBound(pos.x, pos.z)) points.push({ x: pos.x, z: pos.z, kind: "pack", pad: 0.3 });
    }

    const items = [];
    const box3 = new T.Box3();
    const scale = new T.Vector3();
    let liveMeshes = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      // core/batch.js's merged copies are excluded from the census. The WALL
      // pass keeps its originals in the graph (visible=false) and they are
      // counted below; the INERT pass removes and disposes its originals, and
      // those are recovered straight out of the merged buffer further down.
      if (o.name === "batch-wall" || o.name === "batch-inert") return;
      // An actor rig is not room dressing. core/batch.js tags every ped/guard
      // subtree userData.dynamic and refuses to descend into it; so do we.
      // A door leaf carries BOTH dynamic and mover (world/cellblock.js:417) —
      // that is hardware, and it stays in.
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
      // Use the declared box for size/volume (rotation-invariant) and the
      // world AABB for placement.
      const dims = p
        ? [Math.abs(p.width * scale.x), Math.abs(p.height * scale.y), Math.abs(p.depth * scale.z)]
        : [box3.max.x - box3.min.x, box3.max.y - box3.min.y, box3.max.z - box3.min.z];
      const rec = {
        obj: o, box: !!p,
        ax0: box3.min.x, ax1: box3.max.x, ay0: box3.min.y, ay1: box3.max.y, az0: box3.min.z, az1: box3.max.z,
        cx: (box3.min.x + box3.max.x) / 2, cy: (box3.min.y + box3.max.y) / 2, cz: (box3.min.z + box3.max.z) / 2,
        w: dims[0], hh: dims[1], d: dims[2],
        vol: dims[0] * dims[1] * dims[2],
        color: (o.material && o.material.color && o.material.color.getHexString) ? o.material.color.getHexString() : null,
        solid: false, use: null, merged: false,
      };
      liveMeshes++;
      // used: identity first (a light fitting, a door leaf, a placed item).
      // Only a live mesh can be identified this way; a recovered box has no
      // object left to compare against.
      for (let q = o; q; q = q.parent) {
        const kind = refUse.get(q);
        if (kind) { rec.use = kind; break; }
        const ud = q.userData;
        if (ud && ud.mover) { rec.use = "door"; break; }
        if (q === root) break;
      }
      items.push(rec);
    });

    /* ---- WHAT THE BATCHER ATE, PUT BACK ---------------------------------
       core/batch.js's INERT pass (batch.js:509) merges every mesh that is
       provably untouchable — opaque, untextured, non-emissive, no collider,
       no LOS blocker, no userData — into one buffer per tile per lighting
       class, then REMOVES AND DISPOSES the originals. That filter is almost
       exactly this tool's definition of a dead prop, so a census of the live
       graph alone would report the compound with its decoration already
       deleted: the player's own cell came back with two props and no bunk.
       The merged buffer is non-indexed and baked to world space, so each
       original BoxGeometry is still in there as 36 consecutive vertices
       sitting on the 8 corners of one axis-aligned box. Walk the buffer, and
       for every 36-vertex run that PROVES itself a box (every vertex on a
       corner of the run's own AABB) emit the box back; anything else — the
       cylinders and tori that share a bucket — resyncs a triangle at a time
       and is counted as residue instead of being guessed at.
       Every recovered box is by construction collider-free, unlit, immobile
       and un-textured. It can still be claimed below by a seat/bed anchor or
       a small unref'd collider; most of them are the worklist itself.        */
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

    // -- solid, for live and recovered alike: the mesh's own collider record,
    //    or a small CBZ.colliders rect that owns this spot.
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
    //    contains the anchor, so a seat credits the stool and not the slab.
    const seeds = [];
    for (const pt of points) {
      let best = null;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.box) continue;
        if (pt.x < it.ax0 - pt.pad || pt.x > it.ax1 + pt.pad) continue;
        if (pt.z < it.az0 - pt.pad || pt.z > it.az1 + pt.pad) continue;
        if (it.ay0 > 2.6) continue;                       // a ceiling box is not a chair
        // the anchor's own surface height, when it has one: the box has to
        // reach it (within 0.3 m) to be the thing being sat or slept on.
        if (pt.y != null && (it.ay1 < pt.y - 0.3 || it.ay0 > pt.y + 0.3)) continue;
        if (!best || it.vol < best.vol) best = it;
      }
      if (best) { if (!best.use) best.use = pt.kind; seeds.push(best); }
    }

    // -- used: registered breach targets. CBZ.breachTargetAt is the only public
    //    read of systems/breach.js's private TARGETS list, and a target's own
    //    reach is metres wide, so only a prop sitting ON the point is claimed.
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
       A bunk is eight boxes and ONE bed anchor. Filing the mattress as used
       and the pillow, blanket, rails and legs as dead scenery would be a lie
       about a bed a man sleeps in. A use claim therefore spreads to boxes in
       CONTACT with the claimed box — AABBs overlapping within 12 cm — two
       hops out and at most 24 boxes per cluster, which is one piece of
       furniture and not the room it stands in. Shell boxes are already out of
       the prop set, so a claim cannot leak through the floor into the walls. */
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
              if (!cand.use) cand.use = seed.use + "-part";
              if (seen.size >= 24) break;
            }
          }
        }
        frontier = next;
      }
    }

    S.census = {
      items, colliders: cols.length, points: points.length, refs: refUse.size,
      liveMeshes, recovered, residueTris,
    };
  }

  // ======================================================================
  //  ONE ROOM: resolve the rect live, then classify everything inside it.
  // ======================================================================
  const subject = input.subject;
  const authored = subject.room;
  const angle = subject.angle;

  if (!S.rooms[authored.id]) {
    const rect = { x0: authored.x0, x1: authored.x1, z0: authored.z0, z1: authored.z1, h: authored.h, source: "authored" };
    // LIVE FIRST. systems/prisonnight.js publishes its regions as the live
    // array CBZ.prisonLights.rooms; adminwing.js and prisonwings.js push onto
    // the same array on their first tick, so a room that moved moves here too.
    if (authored.live) {
      const live = ((CBZ.prisonLights && CBZ.prisonLights.rooms) || []).find((r) => r && r.id === authored.live);
      if (live && Number.isFinite(live.x0)) {
        rect.x0 = live.x0; rect.x1 = live.x1; rect.z0 = live.z0; rect.z1 = live.z1;
        rect.source = "CBZ.prisonLights.rooms[" + authored.live + "]";
      }
    }
    if (authored.cell) {
      const c = CBZ.cellblock && CBZ.cellblock.playerCell;
      if (c && Number.isFinite(c.x)) {
        rect.x0 = c.x - c.hx; rect.x1 = c.x + c.hx; rect.z0 = c.z - c.hz; rect.z1 = c.z + c.hz;
        rect.h = CBZ.cellblock.height || rect.h;
        rect.source = "CBZ.cellblock.playerCell";
      }
    }

    const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0, h = rect.h;
    const area = w * d;
    // An open yard subtracts the enclosed shells standing inside its rect —
    // they are audited as their own rooms, and counting their fittings as yard
    // scatter would report the cafeteria's chairs as litter on the grass.
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
      // meshes: live draw objects whose AABB overlaps the room volume. A
      // recovered box is geometry, not a draw call — it is inside one of
      // core/batch.js's tile-wide merged buffers — so it is counted through
      // `props` and `mergedProps` instead.
      if (!it.merged && it.ax1 > rect.x0 && it.ax0 < rect.x1 && it.az1 > rect.z0 && it.az0 < rect.z1 &&
          it.ay1 > -0.1 && it.ay0 < h + 0.2) meshes++;
      // props: centre inside the rect, so a passing perimeter wall is never
      // this room's prop
      if (!it.box) continue;
      if (it.cx < rect.x0 - 0.35 || it.cx > rect.x1 + 0.35) continue;
      if (it.cz < rect.z0 - 0.35 || it.cz > rect.z1 + 0.35) continue;
      if (it.cy < -0.2 || it.cy > h + 0.8) continue;
      if (cutouts.length && cutOut(it.cx, it.cz)) { excludedProps++; continue; }
      inside.push(it);
    }

    // -- SHELL. A room's own floor slab, boundary walls and roof deck are not
    //    dressing and must never be counted against it.
    const nearEdge = (v, a, b) => Math.abs(v - a) <= 1.2 || Math.abs(v - b) <= 1.2;
    /* A ROOM CAN HAVE A PARTIAL CEILING, so the shell test is a SHAPE test and
       not a fraction of the room. The cell wing is 1152 m2 of open-topped hall
       with thirteen 24 m2 lids in it (world/cellblock.js:450) and the north
       yard has the mess, armoury and lounge decks standing inside its rect —
       an area-fraction rule called every one of those a dead prop, which is a
       lie about a concrete ceiling. A slab is structure when it is a slab:
       at least 5 cm thick, at least 6 m2 of footprint, lying on the deck or
       carried overhead. Deck PAINT stays out of it by the 5 cm floor — a
       floorLine is 2 cm — so a painted circulation spine is still dressing. */
    let shell = 0, props = 0, solidProps = 0, usedProps = 0, deadProps = 0, deadFlat = 0, mergedProps = 0;
    let interactive = 0;
    let propVolume = 0, deadPropVolume = 0;
    const dead = [], used = [];
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
      /* interactiveProps — THE NUMBER THE OWNER ASKED FOR IN WORDS: "the
         number of props a player can actually interact with". `usedProps`
         cannot answer it, because a use claim SPREADS to the boxes touching a
         claimed box (prison-rooms.mjs's own two-hop cluster rule, kept
         verbatim below) so a bunk's pillow and blanket are `used` and no
         player ever touched them. This counts only PRIMARY claims — the box
         the registry itself resolved to, never a `-part` — so it is a count of
         things, not of boxes: a placed item, a seat, a bed, a door leaf, a
         breach target, a shovable, a grate, a pack, an interact site. It is
         also counted BEFORE the solid branch below, because a rack that is
         both cover and the thing holding the prize is both, and filing it as
         `solid` only would hide the prize.                                   */
      if (it.use && it.use.indexOf("-part") < 0) interactive++;
      /* `usedProps` had the same fault `interactive` was added to dodge, and
         dodging it left the original number wrong: solid answered first and
         stopped, so a solid rack, bench or bunk never reached the used branch.
         Both are independent facts about one prop now — see the same repair in
         prison-rooms.mjs, which this census is copied from so the two runs can
         never disagree. `deadProps` is unchanged: neither solid nor used. */
      if (it.solid) solidProps++;
      if (it.use) { usedProps++; used.push(it); }
      if (it.solid || it.use) continue;
      deadProps++;
      deadPropVolume += it.vol;
      if (Math.min(it.w, it.hh, it.d) <= 0.05) deadFlat++;
      dead.push(it);
    }
    dead.sort((a, b) => b.vol - a.vol);

    S.rooms[authored.id] = {
      rect, area,
      aggregate: !!authored.aggregate,
      excludedProps,
      metrics: {
        meshes, props, solidProps, usedProps, interactiveProps: interactive,
        deadProps, deadFlat, mergedProps,
        shellBoxes: shell,
        floorArea: round(area, 1),
        propVolume: round(propVolume, 2),
        deadPropVolume: round(deadPropVolume, 2),
      },
      // The worklist, biggest first: position, size and material colour are
      // what a reader greps the world files with.
      deadSample: dead.slice(0, 14).map((it) => ({
        x: round(it.cx), y: round(it.cy), z: round(it.cz),
        w: round(it.w), h: round(it.hh), d: round(it.d), vol: round(it.vol, 3), color: it.color,
      })),
      useKinds: used.reduce((acc, it) => { acc[it.use] = (acc[it.use] || 0) + 1; return acc; }, {}),
    };
  }
  const R = S.rooms[authored.id];
  const rect = R.rect;

  // ======================================================================
  //  THE CAMERA — a function of the rect and the door side, nothing else.
  // ======================================================================
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0, h = rect.h;
  const rad = 0.5 * Math.hypot(w, d);
  const aspect = input.width / input.height;
  const DEG = Math.PI / 180;
  // The doorway. Rooms with no authored door take the wall whose midpoint is
  // closest to the compound spine at (0, 20) — the side a player arrives from.
  let door = authored.door;
  if (!door) {
    const cands = [
      { side: "N", x: cx, z: rect.z0 }, { side: "S", x: cx, z: rect.z1 },
      { side: "W", x: rect.x0, z: cz }, { side: "E", x: rect.x1, z: cz },
    ];
    cands.sort((a, b) => Math.hypot(a.x, a.z - 20) - Math.hypot(b.x, b.z - 20));
    door = { side: cands[0].side, center: cands[0].side === "N" || cands[0].side === "S" ? cx : cz };
  }
  const OUT = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
  const n = OUT[door.side] || OUT.S;

  const camera = CBZ.camera;
  camera.aspect = aspect;
  camera.near = 0.12;
  camera.far = 20000;
  let clipY = null;
  let fov = 50;
  if (angle === "plan") {
    fov = 45;
    const need = Math.max(d / 2, (w / 2) / aspect) * 1.14;
    const camY = h + need / Math.tan((fov / 2) * DEG);
    camera.fov = fov;
    camera.up.set(0, 0, -1);
    camera.position.set(cx, camY, cz);
    camera.lookAt(cx, 0, cz);
    if (!authored.open) clipY = h - 0.15;
  } else if (angle === "eye") {
    fov = 62;
    camera.fov = fov;
    camera.up.set(0, 1, 0);
    const px = door.side === "E" ? rect.x1 - 0.55 : door.side === "W" ? rect.x0 + 0.55 : door.center;
    const pz = door.side === "S" ? rect.z1 - 0.55 : door.side === "N" ? rect.z0 + 0.55 : door.center;
    camera.position.set(px, 1.70, pz);
    // Look at the room's middle, unless the doorway is already standing on it
    // (a 2 m alcove), in which case look straight in along the door normal.
    if (Math.hypot(cx - px, cz - pz) > 1.5) camera.lookAt(cx, 1.45, cz);
    else camera.lookAt(px - n[0] * 4, 1.45, pz - n[1] * 4);
  } else {
    fov = 50;
    camera.fov = fov;
    camera.up.set(0, 1, 0);
    // 38 deg off the doorway normal, 48 deg up. The elevation is what keeps a
    // neighbouring shell out of the sight line; the range is solved so the
    // rect's circumradius fits the lens.
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
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }

  // THE ROOF COMES OFF WITH A CLIPPING PLANE, not by hiding meshes: most of
  // the deck over this compound is merged geometry shared with other rooms
  // (core/batch.js), so there is no per-room mesh left to hide, and a global
  // plane cuts the merged copy and the original alike. r128's clipping shader
  // discards where dot(vClipPosition, plane.xyz) > plane.w and vClipPosition is
  // MINUS the view position, so the plane that keeps everything under clipY is
  // a -Y normal with constant clipY (Plane.coplanarPoint puts it at y=+clipY).
  // Costs one shader recompile the first time each variant is used, then
  // nothing — three caches the clipped and unclipped programs side by side.
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
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:20px;left:24px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  // A prison interior at noon renders near-white in this engine, so every
  // caption sits on its own dark plate or half the report is unreadable.
  const PLATE = "background:rgba(9,13,19,.72);padding:6px 10px;border-radius:7px;";
  q("name").style.cssText = "position:absolute;top:62px;left:24px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:620px;" + PLATE;
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;top:104px;left:24px;color:#c8d6e2;font-size:12px;font-weight:550;max-width:600px;" + PLATE;
  q("nums").textContent =
    `props ${m.props} · solid ${m.solidProps} · used ${m.usedProps} · touchable ${m.interactiveProps} · DEAD ${m.deadProps} (${m.deadPropVolume} m3)`;
  q("nums").style.cssText = `position:absolute;right:22px;top:20px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;color:${m.deadProps > 20 ? "#ff9c9c" : "#9fe8c3"};` + PLATE;
  q("rect").textContent =
    `x[${round(rect.x0, 1)},${round(rect.x1, 1)}] z[${round(rect.z0, 1)},${round(rect.z1, 1)}] h${round(h, 1)} · ${round(R.area, 0)} m2 · rect ${rect.source} · merged-recovered ${m.mergedProps}` +
    (R.aggregate ? " · AGGREGATE of the rooms inside it" : "") +
    (R.excludedProps ? ` · ${R.excludedProps} props left to the enclosed rooms` : "") +
    ` · draws ${drawCalls}`;
  q("rect").style.cssText = "position:absolute;right:22px;bottom:18px;color:#b3c1cd;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;max-width:620px;" + PLATE;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:18px;left:24px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;" + PLATE;

  // A live region nobody authored a row for. Reported so a new wing is a
  // number in the report instead of a room this tool silently skips.
  const liveIds = ((CBZ.prisonLights && CBZ.prisonLights.rooms) || []).map((r) => r && r.id).filter(Boolean);
  const rostered = new Set(subject.roster || []);
  const unknownLiveRooms = liveIds.filter((id) => id !== "wing" && !rostered.has(id));

  return {
    ok: true,
    room: authored.id,
    angle,
    rect: {
      x0: round(rect.x0), x1: round(rect.x1), z0: round(rect.z0), z1: round(rect.z1),
      h: round(rect.h), source: rect.source,
    },
    camera: {
      position: [round(camera.position.x), round(camera.position.y), round(camera.position.z)],
      fov: camera.fov, clipY: clipY == null ? null : round(clipY),
      door: door.side + "@" + round(door.center, 1),
    },
    census: { meshes: S.census.items.length, colliders: S.census.colliders, anchors: S.census.points, refs: S.census.refs },
    useKinds: R.useKinds,
    deadSample: R.deadSample,
    unknownLiveRooms,
    drawCalls,
    // `aggregate` rooms (the cell wing, the admin block) are honest totals over
    // the tiers and offices audited separately; `excludedProps` is what an open
    // yard handed back to the enclosed rooms standing inside its rect.
    aggregate: R.aggregate,
    excludedProps: R.excludedProps,
    metrics: R.metrics,
  };
}
export default {
  id: "prison-wing-props",
  title: "Prison: Every Prop Usable Or Gone",
  description: "The thirteen rooms changed by CBZ.CONFIG.PRISON_PROP_HONESTY_V1, photographed three ways from the live world and counted. props are boxes that are not the room's own shell; solidProps have a collider; usedProps belong to something a registry claims; interactiveProps is the count of THINGS a player can touch (primary claims only, never a cluster part); deadProps is the remainder — decoration a player walks through and can never touch. deadProps and deadPropVolume are the verdict; interactiveProps is what replaced them.",
  beforeLabel: "BEFORE · f957614",
  afterLabel: "AFTER · PROP HONESTY",
  viewport: { width: 1200, height: 760 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "Census copied verbatim from tools/visual-presets/prison-rooms.mjs so the two runs cannot disagree — including its recovery of boxes that core/batch.js merged and disposed (mergedProps says how much of a room came back that way). Measured live inside each room's AABB while the plate was staged. A prop is solid (a CBZ.colliders rect under 400 m2 owning its centre, or its own addBox collider), used (a propuse seat/bed anchor, a CBZ.prisonPlaceItem instance, a prisonLights fitting, a breach target, a pushProp, a vent, a pack, a door leaf — and the boxes touching one of those), or DEAD. interactiveProps counts only the primary claim, so it is things and not boxes. deadFlat is the sub-5 cm slice — deck paint, decals, sign skins — broken out because the owner's rule explicitly protects surface graphics; it is still inside deadProps, and deadPropVolume is the honest companion that says whether the dead dressing is paint or furniture.",
  metrics: {
    props: { label: "Prop boxes" },
    solidProps: { label: "Props with a collider", better: "higher" },
    usedProps: { label: "Prop boxes something uses", better: "higher" },
    interactiveProps: { label: "Props a player can touch", better: "higher" },
    deadProps: { label: "Dead props", better: "lower" },
    deadFlat: { label: "Dead props under 5 cm (paint/signage)", better: "lower" },
    deadPropVolume: { label: "Dead prop volume", unit: "m3", better: "lower" },
    propVolume: { label: "Prop volume", unit: "m3" },
    mergedProps: { label: "Props recovered from the batcher" },
    shellBoxes: { label: "Shell boxes (floor/wall/roof)" },
    meshes: { label: "Draw objects in rect" },
    floorArea: { label: "Floor area", unit: "m2" },
  },
  subjects,
  stage: stageWingProps,
};
