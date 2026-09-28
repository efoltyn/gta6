/* ============================================================
   world/escape_routes.js - cell-block services + alternate routes.

   The keycard still matters because it opens staff checkpoints, but
   the block now has maintenance crawls, ceiling hatches, drainage, and
   a culvert so the map plays like a place with systems instead of a
   single locked hallway.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const K = CBZ.prisonKit || null;

  CBZ.vents = CBZ.vents || [];
  CBZ.altExitZones = CBZ.altExitZones || [];

  function sign(text, x, y, z, w, h, ry, fg, bg) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = bg || "#202833";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "rgba(255,255,255,.38)";
    g.lineWidth = 10;
    g.strokeRect(8, 8, c.width - 16, c.height - 16);
    g.fillStyle = fg || "#ffd451";
    g.font = "700 48px Fredoka, Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, c.width / 2, c.height / 2 + 2);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      // LIT, not MeshBasic: an unlit sign is a full-bright panel at night
      new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) })
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry || 0;
    scene.add(mesh);
    return mesh;
  }

  /* A FLOOR HATCH IS FLUSH WITH THE FLOOR: a galvanised curb angle 3 cm
     proud, and inside it the LID, a steel plate (open grating where the
     hatch is a drain) with black bearing bars, screwed down at its four
     corners. `opts.size` scales it (a hatch inside a cell is not a yard
     culvert); `opts.floor` is the surface it is set into (the ditch slab is
     7 cm).
     THE LID COMES OFF (2026-09-28). It is one group now, not addBox pieces
     batch.js bakes into the floor: systems/interactions.js unscrews it (or
     prises it up by hand) and it is slid off onto the floor beside the curb,
     leaving the black shaft. vent.cover = {open, set(v)}; vent.mouth =
     {kind:"floor"} tells the crawl to lower the body into it.
     opts.grate: the culvert's WELDED grate (systems/escapeplan.js owns the
     cut): no screws, no cover, its bars go and the shaft shows when cut. */
  const HATCH = {
    curb: K ? K.skin("galv", 0x8e959c) : CBZ.cmat(0x8e959c),
    bar: K ? K.skin("steel", 0x24282d) : CBZ.cmat(0x24282d),
    grating: K ? K.skin("grating", 0x6b737c) : CBZ.cmat(0x6b737c),
    screw: K ? K.skin("galv", 0xb4bcc4) : CBZ.cmat(0xb4bcc4),
    hole: new THREE.MeshBasicMaterial({ color: 0x050607 }),
  };
  function floorHatch(x, z, name, accent, opts) {
    const k = (opts && opts.size ? opts.size : 1.75) / 1.75, f = (opts && opts.floor) || 0;
    const drain = !!(opts && (opts.grate || opts.drain));
    if (opts && opts.hidden) {
      const v = { x, z, y: 0.12, name, dest: null, route: true };
      CBZ.vents.push(v);
      return v;
    }
    // the curb: four galvanised angles round the opening (static, merged)
    const C = 1.75 * k, cw = 0.15 * k;
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(C, 0.03, cw), HATCH.curb); a.position.set(x, f + 0.015, z + s * (C - cw) / 2); a.receiveShadow = true; scene.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.03, C - 2 * cw), HATCH.curb); b.position.set(x + s * (C - cw) / 2, f + 0.015, z); b.receiveShadow = true; scene.add(b);
    }
    // the shaft under the lid: black, a hair above the floor inside the curb
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(C - 2 * cw, C - 2 * cw), HATCH.hole);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(x, f + 0.006, z);
    hole.visible = false;
    hole.userData.dynamic = true;
    scene.add(hole);
    // THE LID, one group: the plate, the bearing bars, four corner screws
    const lid = new THREE.Group();
    lid.position.set(x, f, z);
    lid.userData.dynamic = true;
    const lm = (geo, mat, lx, ly, lz) => { const m = new THREE.Mesh(geo, mat); m.position.set(lx, ly, lz); m.receiveShadow = true; m.userData.dynamic = true; lid.add(m); return m; };
    const plateMat = drain ? HATCH.grating : (K ? K.skin("steel", accent || 0x515a66) : CBZ.cmat(accent || 0x515a66));
    const plate = lm(new THREE.BoxGeometry(1.45 * k, 0.012, 1.45 * k), plateMat, 0, 0.035, 0);
    const bars = [];
    for (let i = -2; i <= 2; i++) {
      bars.push(lm(new THREE.BoxGeometry(0.05 * k, 0.012, 1.3 * k), HATCH.bar, i * 0.26 * k, 0.045, 0));
      bars.push(lm(new THREE.BoxGeometry(1.3 * k, 0.012, 0.04 * k), HATCH.bar, 0, 0.047, i * 0.26 * k));
    }
    if (!(opts && opts.grate)) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      lm(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 8), HATCH.screw, sx * 0.66 * k, 0.045, sz * 0.66 * k);
    }
    scene.add(lid);
    const vent = { x, z, y: 0.12, name, dest: null, route: true,
      mouth: { kind: "floor", x: x, z: z, y: f, size: C - 2 * cw, off: (opts && opts.off) || null } };   // off: the side you climb out and step off to
    if (opts && opts.grate) {
      vent.grate = {
        cut: false,
        set: function (cut) {
          this.cut = !!cut;
          for (let i = 0; i < bars.length; i++) {
            // a cut grate keeps its two outer rails: the frame, not the bars
            const edge = i === 0 || i === 1 || i === bars.length - 1 || i === bars.length - 2;
            bars[i].visible = !cut || edge;
          }
          plate.visible = !cut;
          hole.visible = !!cut;
        },
      };
    } else {
      // unscrewed: the lid is lifted off and laid on the floor beside the
      // curb, turned a little, the way a man puts a heavy plate down
      vent.cover = {
        open: false,
        set: function (v) {
          this.open = !!v;
          hole.visible = this.open;
          if (this.open) { lid.position.set(x + C * 0.5 + 0.8 * k, f - 0.025, z + 0.15 * k); lid.rotation.y = 0.35; }
          else { lid.position.set(x, f, z); lid.rotation.y = 0; }
        },
      };
    }
    CBZ.vents.push(vent);
    return vent;
  }

  // a painted service pipe run along z, merged by the kit. (It was an
  // open-ended cylinder with a faint emissive glow.)
  function pipe(x, y, z, r, len, color) {
    const g = new THREE.CylinderGeometry(r, r, len, 14);
    if (K) return K.stat(g, K.skin("steel", color || 0x4c5864), x, y, z, { rx: Math.PI / 2, cast: false });
    const m = new THREE.Mesh(g, CBZ.cmat(color || 0x4c5864)); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); scene.add(m);
    return m;
  }

  /* THE CELL HOUSE ROOF IS world/cellblock.js's. This file drew a SECOND
     purlin grid under the same 9 m lid (the same five x-lines, 12 cm apart
     from cellblock's own purlins, fighting them) plus a 24 m "catwalk and
     cable tray" slab at 6.45 m that nobody could reach, whose ends ran 30 cm
     into the upper-tier cells. Both deleted: one roof, built once.

     The service pipes stay, but where pipes go: along the side walls in the
     bay between the truss chords (8.15..8.80), clear of every upper cell.
     They were at 7.2-7.55 m, i.e. INSIDE the east and west upper cells, run
     through their partitions and their roof slabs. */
  pipe(-15.28, 8.45, -28, 0.14, 27, 0x47515c);
  pipe(15.30, 8.45, -26, 0.12, 24, 0x5a6570);
  pipe(14.72, 8.45, -21.9, 0.12, 27.2, 0x717c86);
  // wall brackets: a steel arm off the wall under every pipe, a saddle strap
  // over each. The inner east pipe (0.78 m out) sits on the same arm; it
  // had no support at all and ran 27 m through the air.
  if (K) {
    const arm = K.skin("steel", 0x3a4048);
    const runs = [[-15.28, 0.14, -41.5, -14.5], [15.3, 0.12, -38, -14], [14.72, 0.12, -35.5, -8.3]];
    for (let z = -40; z <= -10; z += 3) {
      const on = runs.filter((r) => z > r[2] + 0.4 && z < r[3] - 0.4);
      if (!on.length) continue;
      if (on.some((r) => r[0] < 0)) K.stat(new THREE.BoxGeometry(0.24, 0.05, 0.05), arm, -15.38, 8.285, z, { cast: false });
      const east = on.filter((r) => r[0] > 0);
      if (east.length) {
        const reach = Math.min.apply(null, east.map((r) => r[0])) - 0.14;       // wall face 15.5 out to the farthest pipe
        K.stat(new THREE.BoxGeometry(15.5 - reach, 0.05, 0.05), arm, (15.5 + reach) / 2, 8.305, z, { cast: false });
      }
      for (const r of on) K.stat(new THREE.TorusGeometry(r[1] + 0.008, 0.008, 4, 12, Math.PI), arm, r[0], 8.45, z, { cast: false });
    }
  }

  // The housing gate already owns its jambs, reader, signal and moving leaf.
  // The old "checkpoint dressing" duplicated all of that with freestanding
  // rails, posts and two fake reader pylons in the clear route. Keep one
  // literal, wall-mounted identifier; circulation in front of it stays empty.
  sign("HOUSING UNIT A", 0, 4.30, -8.38, 4.6, 0.78, Math.PI, "#e8edf2", "#202833");

  // ---- route 1: cell utility crawl to the west drainage ditch ----
  // Inside A-1 on purpose (cellblock.js header): a way out through your own
  // floor. At (-12.2, -38.2) and 1.75 m square it straddled the cell's barred
  // front, half in the cell and half in the aisle under the bars; a 0.9 m
  // access plate between the bunk's foot and the door sits wholly inside.
  // The far end is the drain access in the mess hall's queue lane (the hall
  // was built over the old drainage ditch; world/cafeteria.js lays its tables
  // clear of it). It was named "Yard Drainage Ditch" from before the hall
  // stood on it, and that is what the crawl's destination line said.
  const cellCrawl = floorHatch(-12.2, -39.6, "Cell Utility Crawl", 0x6b7480, { size: 0.9, off: { x: 0, z: 1 } });
  const yardDrainIn = floorHatch(-25.4, 10.5, "Mess Hall Drain", 0x4f6d75, { floor: 0.07, drain: true });
  cellCrawl.dest = yardDrainIn;
  yardDrainIn.dest = cellCrawl;

  // ---- route 2: drainage ditch to an outer culvert beyond the FAR south
  // wall (a long maintenance run that spits you out past the new gate) ----
  const SZ = (CBZ.WORLD && CBZ.WORLD.southBlock.z1) || 52;
  // THE CULVERT IS A PLAN, NOT A DOOR (systems/escapeplan.js). Its yard
  // grate is welded: a hacksaw blade and a few unseen seconds cut it, and the
  // crawl only goes when nobody is watching the ditch. The mouth outside the
  // wall is where the route is won, and escapeplan.js checks the grate was
  // really cut before it counts.
  const yardCulvert = floorHatch(-25.2, 18.2, "Perimeter Culvert", 0x4f6d75, { grate: true, floor: 0.07 });
  const outerCulvert = floorHatch(-9, SZ + 3, "Outer Culvert Mouth", null, { hidden: true });
  // the crawl comes out of the precast bore below (invert 22 cm under grade)
  outerCulvert.mouth = { kind: "bore", x: -9, z: SZ + 2.2, nx: 0, nz: 1, y: 0.28, sill: -0.2 };   // the pipe lip
  yardCulvert.dest = outerCulvert;
  yardCulvert.culvert = true;
  outerCulvert.dest = yardCulvert;
  outerCulvert.culvertMouth = true;
  CBZ.culvertGrate = yardCulvert;
  CBZ.altExitZones.push({ x: -9, z: SZ + 3, r: 3.4, name: "culvert" });

  // (2026-09-27) The dark 6.3 x 14.8 m "ditch path" slab and its two 45 cm
  // kerbs ran straight through the middle of the MESS HALL floor — a drainage
  // ditch across a dining room. Deleted: the hatches are the route.
  // (2026-09-28) Also deleted: an 0.84 m open pipe lying 30 cm off the ground
  // through the mess hall's south wall, and a green MeshBasic "CULVERT" plaque
  // glowing on the outside of the gate wall.
  //
  // THE CULVERT MOUTH, outside the far south wall: a precast concrete pipe
  // half-buried where it daylights, a concrete headwall round it, wing walls
  // and a rip-rap apron. The crawl comes out of the bore; the vent record
  // above (no hatch drawn) is where you land.
  (function outfall(x, z0) {
    if (!K) return;
    const conc = K.skin("concrete", 0x9a9690), wet = K.skin("concrete", 0x6d6a64), bore = K.skin("steel", 0x0a0b0c, 0.95);
    const R = 0.5, T = 0.08, cy = 0.28;              // 1.0 m bore, the invert 22 cm below grade
    const L = 1.7, zc = z0 + L / 2;                  // from the wall's outer face out
    const pipeG = new THREE.CylinderGeometry(R + T, R + T, L, 20, 1, true);
    K.stat(pipeG, conc, x, cy, zc, { rx: Math.PI / 2 });
    const wetIn = wet.clone(); wetIn.side = THREE.BackSide;   // the inside of the bore
    K.stat(new THREE.CylinderGeometry(R, R, L, 20, 1, true), wetIn, x, cy, zc, { rx: Math.PI / 2, cast: false });
    K.stat(new THREE.RingGeometry(R, R + T, 20), conc, x, cy, z0 + L + 0.001, { cast: false });   // the lip
    K.stat(new THREE.CircleGeometry(R, 20), bore, x, cy, z0 + 0.35, { cast: false });           // darkness down the bore
    // headwall: two cheeks and a cap round the pipe, flush with its mouth
    const hz = z0 + L - 0.15;
    for (const s of [-1, 1]) K.stat(new THREE.BoxGeometry(0.7, 1.05, 0.3), conc, x + s * (R + T + 0.35), 0.45, hz, {});
    K.stat(new THREE.BoxGeometry(2.56, 0.3, 0.3), conc, x, 1.02, hz, {});
    // wing walls splayed back to grade
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.25, 0.7, 1.3); g.rotateY(s * 0.45);
      K.stat(g, conc, x + s * 1.5, 0.3, hz + 0.55, {});
    }
    // apron: a wet concrete slab and a scatter of rip-rap at its lip
    K.stat(new THREE.BoxGeometry(2.4, 0.06, 1.4), wet, x, 0.0, z0 + L + 0.7, { cast: false });
    const rock = K.skin("concrete", 0x7c786f);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39996, rr = 0.12 + ((i * 37) % 7) * 0.02;
      const g = new THREE.DodecahedronGeometry(rr, 0); g.scale(1, 0.55, 1);
      K.stat(g, rock, x + Math.cos(a) * (0.6 + (i % 3) * 0.35), 0.03, z0 + L + 1.45 + Math.sin(a) * 0.25, { cast: false });
    }
  })(-9, SZ + 0.5);

  // ROUTES 3 AND 4 ARE GONE (2026-09-28, "delete any vent that is not at a
  // real vent"). Route 3 was a "Ceiling Service Hatch" drawn as a 1.75 m
  // grating ON THE FLOOR of the cell house cross-aisle, paired with a
  // "Checkpoint Ceiling Drop" that was another floor grating in the yard:
  // a ceiling you walked on, doing what the cell wing's west-wall grille (the
  // armory duct, world/ventilation.js T1) already does. Route 4 was a
  // "Kitchen Grease Duct" as a floor drain in the dining room paired with a
  // "Drain Service Grate" six metres away in the yard: a crawl from one side
  // of the mess hall's door to the other. The mess hall keeps its two real
  // return-air grilles and its drain; the culvert keeps its welded grate.

  // "Extra yard detail that makes routes legible from the camera" — DELETED
  // (PRISON_PROP_USE_V1). Fourteen 3.3 m sticks, 12 cm square, bolted 5.2 m up
  // the two yard perimeter walls with 3.7 m of nothing between each one. They
  // make no route legible: every route in this file is a hatch in the floor or
  // a painted ditch, both of them at ankle height, and a dashed line of stubs
  // halfway up a 6 m wall is not a conduit run — a conduit run is continuous.
  // Nothing reaches them, nothing reads them, nothing is lit by them.
  // (The 48 m, 10 cm "pipe" hung 9.8 m over the middle of the north yard is
  // GONE. It touched no wall and no roof: from the ground it was a grey line
  // drawn diagonally across the sky, and the owner saw exactly that.)
})();
