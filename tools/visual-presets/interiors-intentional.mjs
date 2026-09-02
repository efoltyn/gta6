/*
  interiors-intentional.mjs — "make interiors intentional in the gang city game"

  THE COMPLAINT, VERBATIM: "interiors have tons of fake walls and shit fake
  interiors, i dont like interior walls unless they are intentional, aka locked
  apartment you have key to that allows interior walls in an apartment building,
  bank vault, but i like open space and theres a lot of unnecessary walls rn."

  WHAT THIS PHOTOGRAPHS. Five real rooms in the real city, same seed, same lot,
  same camera on both sides. On the BEFORE side every interior wall in this game
  is a DECAL: city/buildings.js's roomKit and city/interior_programs.js both
  drew their partitions cast:false and NON-collider on purpose, and their own
  comments said so ("because they carry no y1 collider they're invisible to the
  carve/breach picker"). You walk through the meeting room, the fitting booths,
  the hospital's exam bays, the penthouse's "sealed master suite" and the wall
  between two flats. On the AFTER side the generic dividers are DELETED — an
  office plate, a shop floor and a penthouse are open — and the ones that remain
  because the room is a real place (a flat, the strongroom, a shop's stockroom,
  a state room) carry colliders, with a LOCKED front door on every flat.

  HOW THE NUMBER IS MEASURED, IDENTICALLY ON BOTH SIDES. Neither build is asked
  what it drew. A grid of 0.5 m cells is laid across the floor plate at 2.6 m —
  above every piece of furniture, below the ceiling strip, so the only thing in
  that band is architecture — and each cell is asked two questions:

     DRAWN?  a triangle of the merged scene crosses that height inside it
             (the merged batch IS what the player sees).
     SOLID?  a collider box covers it and spans 2.6 m (that IS what the player
             walks into — the same CBZ.colliders every wall in the game uses).

  walkThroughCells = drawn AND NOT solid. That is a painting of a wall, counted.
  It is the owner's sentence with a number attached, and it may only go DOWN.

  Staging facts (verified against src, 2026-09-01):
  - lots: CBZ.city.arena.lots (328) / .shopLots (182) / .homeLots (136), each
    {i,j,kind,building}; building carries ox/oz/w/d/FH/wt/hasStairs/stairW/
    storeys/floorTops. HARNESS TRAP: `CBZ.city.lots` is EMPTY — the live arrays
    hang off CBZ.city.arena, and no lot in this world carries building.office
    (the office-tower branch never fired on seed 90210), so an "office floor" is
    reached as the STOREYS ABOVE A STOREFRONT, which is where interiorMix
    actually puts desk farms and meeting rooms here.
  - subject lots are picked by a DETERMINISTIC sort (i,j) + predicate + index,
    never by typed coordinates, so both columns frame the same building.
  - CBZ.cityUnitDoors is the AFTER-only registry; the BEFORE side reports 0
    locked doors, which is the honest answer for a build that has none.
  - rAF is frozen; CBZ.stepSim is the clock (the house pattern).
*/

const READY =
  "document.getElementById('playBtn') && document.querySelector('.mode-btn[data-mode=\"city\"]')";

export default {
  id: "interiors-intentional",
  title: "Gang City interiors — every wall is a wall now, or it is gone",
  description:
    "Five interiors in one deterministic city (seed 90210), photographed from the same camera on both sides. " +
    "Before: office floors, shop floors, hospital bays and penthouse suites diced up by full-height partitions with no colliders — " +
    "walls you walk through. After: open plan by default, and the only walls left are the intentional ones — " +
    "a flat behind a LOCKED door you need the key or the deed for, the bank's strongroom, a shop's stockroom.",
  beforeLabel: "BEFORE · fake walls everywhere",
  afterLabel: "AFTER · open plan, and the walls that stayed are real",
  pairNote: "Same seed, same lot, same storey, same camera — the walls are the variable",
  defaultFocus:
    "Is the space open? And where a wall survives, is there a reason for it standing there?",
  viewport: { width: 1180, height: 720 },
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  readyExpression: READY,
  method:
    "Both pages boot the same seeded city, freeze rAF and drive CBZ.stepSim. The subject building is chosen by a deterministic " +
    "(i,j) sort plus a predicate over CBZ.city.lots, so the two columns frame the same address. The camera is the game's own " +
    "CBZ.camera, placed inside the plate in building-local coordinates. Metrics come from a 0.5 m cell grid at 2.6 m: a cell is " +
    "DRAWN if any scene triangle crosses that height inside it, SOLID if a CBZ.colliders box covering it spans that height. The cost \
metric is core/batch.js's own build-time count of merged static meshes, not a per-frame draw-call snapshot (which is not comparable across two pages).",
  subjects: [
    {
      id: "flat-above-a-shop",
      label: "A floor of flats over a storefront — the whole plate",
      focus:
        "The storey above a shop is where this city's `residential` program runs: a corridor with flats off it. BEFORE: every " +
        "one of those walls is a decal — the whole floor is one room you can walk across in a straight line. AFTER: the same " +
        "walls are walls, and each flat has a locked front door.",
    },
    {
      id: "shop-floor-clothing",
      label: "A clothing shop's sales floor",
      focus:
        "BEFORE: three fitting-booth dividers standing 4.5 m tall with curtains in front of them, every one walk-through, plus a " +
        "back-of-house partition you also walked through. AFTER: the booths are gone (the curtain is the read), the floor is " +
        "open, and the ONE wall left — the stockroom's — is solid.",
    },
    {
      id: "bank-floor",
      label: "A bank's banking hall",
      focus:
        "THE WALL THAT STAYED. The owner named the bank vault himself. BEFORE: the strongroom's two walls AND a 'glass-front " +
        "manager's cell', all of them decals. AFTER: the manager's cell is gone, the hall is open, and the strongroom's walls " +
        "are solid — the heist has to go through them instead of around.",
    },
    {
      id: "apartment-corridor",
      label: "An apartment corridor",
      focus:
        "THE EXCEPTION THE OWNER ASKED FOR. A corridor with doors off it. BEFORE: the corridor walls and every party wall are " +
        "decals — you walk sideways through the flats. AFTER: the corridor is public, the walls are solid, and each flat has a " +
        "real front door with [E] on it that says 'Locked. Unit 3B.' unless you own the address or carry its key.",
    },
    {
      id: "apartment-unit",
      label: "Inside one flat",
      focus:
        "Standing in a bay: a bed, a kitchen run, a door. The point is that this small room is enclosed ON PURPOSE, and that " +
        "the thing enclosing it is a wall rather than a picture of one.",
    },
  ],
  metrics: {
    walkThroughCells: {
      label: "Places on this floor where a wall is drawn and nothing stops you — a painting of a wall",
      unit: "cells", better: "lower",
    },
    solidCells: {
      label: "Places where a wall is drawn AND stops you — a wall",
      unit: "cells",
    },
    fakeWallShare: {
      label: "Share of this floor's drawn wall that you can walk through",
      unit: "%", better: "lower",
    },
    lockedDoors: {
      label: "Locked unit doors on this storey (a flat you need a key or the deed for)",
      unit: "doors", better: "higher",
    },
    staticDrawMeshes: {
      label: "Static draw calls the world build produced (merged inert + merged wall buckets)",
      unit: "meshes", better: "lower",
    },
  },
  metricsNote:
    "The cell grid is laid over the building's own usable plate (the roomKit band: inside the facade, clear of the -x stair " +
    "strip) at 2.6 m above the storey's slab — above furniture, below the ceiling strip, so the band holds architecture only. " +
    "walkThroughCells is the headline and is the owner's complaint stated as a number: it may only go down. solidCells is " +
    "printed beside it because the answer to a fake wall is EITHER deleting it OR making it real, and the two numbers together " +
    "say which happened where — an office floor should lose its fake wall cells outright, a flat should convert them.",

  stage: async function stageInteriorsIntentional(input) {
    const CBZ = window.CBZ;
    const T = window.THREE;
    if (!CBZ || !T) return { ok: false, err: "no CBZ/THREE" };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { if (test()) return true; } catch (_) {}
        await wait(stepMs || 250);
      }
      return false;
    };

    // ---- boot once per page ------------------------------------------------
    let S = window.__interiorsIntentionalSeq;
    if (!S) {
      const booted = await until(
        () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
          document.querySelector('.mode-btn[data-mode="city"]'),
        300000
      );
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('.mode-btn[data-mode="city"]').click();
      await wait(250);
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn");
        if (b) b.click();
        return CBZ.game.state === "playing";
      }, 240000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      try { if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts"; } catch (_) {}
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      // THE LOADER IS AN rAF ANIMATION. systems/bootprogress.js eases its card
      // to 100% and hides it on a rAF tick, so freezing rAF the instant the
      // state flips to "playing" leaves "BUILDING THE WORLD 99%" painted over
      // the whole frame — which is what the first run of this preset
      // photographed, twice, at full marks on every metric.
      await until(() => {
        const c = document.getElementById("bootload");
        return !c || c.style.display === "none" || !c.isConnected;
      }, 60000, 200);
      window.requestAnimationFrame = function () { return 0; };
      try {
        const c = document.getElementById("bootload");
        if (c) c.style.display = "none";
        if (CBZ.bootMeter && CBZ.bootMeter.hide) CBZ.bootMeter.hide();
      } catch (_) {}
      await wait(600);
      for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      S = window.__interiorsIntentionalSeq = { ray: new T.Raycaster(), colBuf: [] };
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };
    }

    const step = (secs) => {
      const n = Math.max(1, Math.round(secs * 60));
      for (let i = 0; i < n; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.stepSim(1 / 60);
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
      }
    };

    // ---- the deterministic lot picker -------------------------------------
    // Sorted by grid index, never by coordinate, so both columns of the pair
    // land on the same building without a single typed number.
    const A = (CBZ.city && CBZ.city.arena) || {};
    const byIJ = (a, b) => (a.i - b.i) || (a.j - b.j);
    const sortLots = (arr) => (arr || []).filter(
      (l) => l && l.building && l.building.w > 8 && l.building.d > 8
    ).slice().sort(byIJ);
    const shopLots = sortLots(A.shopLots);
    const homeLots = sortLots(A.homeLots);
    const first = (arr, pred) => { for (const l of arr) if (pred(l)) return l; return null; };

    const SUBJ = input.subject.id;
    let lot = null, floorK = 0;
    // THE FLATS IN THIS CITY SIT OVER STOREFRONTS. There is no office tower on
    // seed 90210 (world.js's officeLot never fired) and the free-standing home
    // lots come out as single dwellings; the storeys ABOVE a shop are where
    // CBZ.interiorMix actually puts the `residential` corridor program. So one
    // building — the first storefront by (i,j) with a storey over it and a
    // plate big enough for two ranks of flats — carries all three flat
    // subjects, photographed from three places. Deterministic on both sides.
    const flatBlock = () => first(shopLots, (l) => (l.building.storeys | 0) >= 2 && l.building.w * l.building.d >= 500);
    if (SUBJ === "shop-floor-clothing") {
      lot = first(shopLots, (l) => l.kind === "clothing") || first(shopLots, (l) => l.kind === "hospital");
      floorK = 0;
    } else if (SUBJ === "bank-floor") {
      lot = first(shopLots, (l) => l.kind === "bank");
      floorK = 0;
    } else {
      lot = flatBlock();
      floorK = 1;
    }
    if (!lot) return { ok: false, err: "no lot for " + SUBJ };

    const b = lot.building;
    const FH = b.FH || 3.2, wt = b.wt != null ? b.wt : 0.4;
    const tops = b.floorTops || null;
    const baseY = tops && tops[floorK] != null ? tops[floorK] : floorK * FH;
    const ox = b.ox || 0, oz = b.oz || 0;
    // the building's own usable plate (roomKit's band, verbatim)
    const xLo = b.hasStairs ? (-b.w / 2 + wt + b.stairW + 0.4) : (-b.w / 2 + wt + 0.4);
    const xHi = b.w / 2 - wt - 0.4;
    const zLo = -b.d / 2 + wt + 0.4;
    const zHi = b.d / 2 - wt - 0.4;

    // ---- put the player on this storey so the LOD/streaming shows it -------
    const P = CBZ.player;
    const put = (lx, lz, ly) => {
      if (!P || !P.pos) return;
      P.pos.set(ox + lx, ly, oz + lz);
      if (P.vel) { P.vel.x = 0; P.vel.y = 0; P.vel.z = 0; }
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    };

    // ---- camera placements, all in building-local coordinates -------------
    const alongX = (xHi - xLo) >= (zHi - zLo);
    const eye = { x: 0, z: 0 }, look = { x: 0, z: 0 };
    const EYE_Y = baseY + 1.62;
    if (SUBJ === "apartment-corridor") {
      // the corridor runs down the LONG axis at the plate's cross centre
      const cross = alongX ? (zLo + zHi) / 2 : (xLo + xHi) / 2;
      eye.x = alongX ? xLo + 1.0 : cross;
      eye.z = alongX ? cross : zLo + 1.0;
      look.x = alongX ? xHi - 0.5 : cross;
      look.z = alongX ? cross : zHi - 0.5;
    } else if (SUBJ === "apartment-unit") {
      // one bay in from the corridor, on the -cross rank (progResidential's
      // side -1): between the plate edge and the corridor wall.
      const c0 = alongX ? zLo : xLo;
      const cMid = alongX ? (zLo + zHi) / 2 : (xLo + xHi) / 2;
      const inBay = (c0 + (cMid - 0.85)) / 2;
      const run0 = alongX ? xLo : zLo, run1 = alongX ? xHi : zHi;
      const runAt = run0 + (run1 - run0) * 0.14;
      eye.x = alongX ? runAt : inBay;
      eye.z = alongX ? inBay : runAt;
      look.x = alongX ? runAt + 3.0 : cMid;
      look.z = alongX ? cMid : runAt + 3.0;
    } else {
      // A SHOP IS READ FROM ITS OWN DOOR. b.localDoor is the building's own
      // record of where you come in and which way you face doing it ({x,z,nx,nz},
      // normal pointing INTO the room — the same handle every program in the kit
      // orients itself with), so the shot is the customer's view down the sales
      // floor rather than a corner of plaster.
      // A SHOP IS READ FROM THE CORNER YOU ARRIVE IN, LOOKING AT THE MIDDLE OF
      // THE FLOOR. b.localDoor says which end of the plate the way in is at;
      // the camera stands at the plate corner nearest it and looks at the
      // centre, which is inside the shell by construction.
      // (HARNESS TRAP: walking 2 m along localDoor's own normal puts the camera
      //  on the pavement about half the time — the normal's sign is not a
      //  reliable "inwards", and flipping it toward the plate centre does not
      //  fix a door that sits ON the plate edge.)
      const din = b.localDoor || { x: xLo, z: zLo };
      const cxq = Math.abs(din.x - xLo) <= Math.abs(din.x - xHi) ? xLo + 1.4 : xHi - 1.4;
      const czq = Math.abs(din.z - zLo) <= Math.abs(din.z - zHi) ? zLo + 1.4 : zHi - 1.4;
      eye.x = cxq; eye.z = czq;
      look.x = (xLo + xHi) / 2; look.z = (zLo + zHi) / 2;
    }

    put(eye.x, eye.z, baseY + 0.1);
    step(0.5);
    put(eye.x, eye.z, baseY + 0.1);
    step(0.2);

    // the game's own camera, aimed by hand (rAF is frozen, so nothing
    // overwrites this before the frame is taken)
    const cam = CBZ.camera;
    cam.position.set(ox + eye.x, EYE_Y, oz + eye.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(ox + look.x, baseY + 1.45, oz + look.z);
    cam.updateMatrixWorld(true);
    if (CBZ.cam) {
      const vx = look.x - eye.x, vz = look.z - eye.z;
      CBZ.cam.yaw = Math.atan2(-vx, -vz);
    }

    // ---- THE MEASUREMENT: drawn-vs-solid, cell by cell --------------------
    // A 0.5 m cell grid over the plate, sliced at 2.6 m. A cell is DRAWN if any
    // triangle in the scene spans that height inside it, and SOLID if any
    // collider box that spans that height covers it. Triangles rather than a
    // Raycaster on purpose: by the time a frame exists, core/batch.js has
    // merged every interior box into a handful of buffers and REMOVED the
    // originals, so the only honest question left is "what geometry is
    // physically there", which is a pass over the merged buffers.
    // (HARNESS TRAP: ray.intersectObject(CBZ.scene, true) throws in r128 on
    //  this scene — some pooled child has a null matrixWorld — and would also
    //  have cost a full-buffer walk per ray.)
    const BAND = baseY + 2.6;            // above furniture, below the ceiling strip
    const CELL = 0.5;
    const NX = Math.max(1, Math.floor((xHi - xLo) / CELL));
    const NZ = Math.max(1, Math.floor((zHi - zLo) / CELL));
    const X0 = ox + xLo, Z0 = oz + zLo;
    const drawnCell = new Uint8Array(NX * NZ);
    const solidCell = new Uint8Array(NX * NZ);
    const cellIdx = (cx, cz) => cz * NX + cx;
    const markRange = (arr, wx0, wz0, wx1, wz1) => {
      let i0 = Math.floor((wx0 - X0) / CELL), i1 = Math.floor((wx1 - X0) / CELL);
      let j0 = Math.floor((wz0 - Z0) / CELL), j1 = Math.floor((wz1 - Z0) / CELL);
      if (i1 < 0 || j1 < 0 || i0 >= NX || j0 >= NZ) return;
      if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
      if (i1 >= NX) i1 = NX - 1; if (j1 >= NZ) j1 = NZ - 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) arr[cellIdx(i, j)] = 1;
    };

    // ---- DRAWN: every triangle that crosses the band inside the plate ------
    const PX1 = ox + xHi, PZ1 = oz + zHi;
    const gbox = new T.Box3();
    const p0 = new T.Vector3(), p1 = new T.Vector3(), p2 = new T.Vector3();
    let triScanned = 0;
    const TRI_CAP = 6000000;
    CBZ.scene.traverse(function (o) {
      if (triScanned > TRI_CAP) return;
      if (!o.isMesh || o.isInstancedMesh || o.isSprite || !o.geometry) return;
      const g = o.geometry, pos = g.attributes && g.attributes.position;
      if (!pos || !pos.count) return;
      const mt = o.material;
      if (mt && !Array.isArray(mt) && mt.transparent && mt.opacity < 0.35) return;
      if (!g.boundingBox) { try { g.computeBoundingBox(); } catch (_) { return; } }
      if (!g.boundingBox) return;
      gbox.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      if (gbox.max.y < BAND || gbox.min.y > BAND) return;
      if (gbox.max.x < X0 || gbox.min.x > PX1 || gbox.max.z < Z0 || gbox.min.z > PZ1) return;
      const idx = g.index;
      const n = idx ? idx.count : pos.count;
      const M = o.matrixWorld;
      for (let t = 0; t + 2 < n; t += 3) {
        const a0 = idx ? idx.getX(t) : t, a1 = idx ? idx.getX(t + 1) : t + 1, a2 = idx ? idx.getX(t + 2) : t + 2;
        p0.fromBufferAttribute(pos, a0).applyMatrix4(M);
        p1.fromBufferAttribute(pos, a1).applyMatrix4(M);
        p2.fromBufferAttribute(pos, a2).applyMatrix4(M);
        triScanned++;
        const ylo = Math.min(p0.y, p1.y, p2.y), yhi = Math.max(p0.y, p1.y, p2.y);
        if (yhi < BAND || ylo > BAND) continue;
        const tx0 = Math.min(p0.x, p1.x, p2.x), tx1 = Math.max(p0.x, p1.x, p2.x);
        const tz0 = Math.min(p0.z, p1.z, p2.z), tz1 = Math.max(p0.z, p1.z, p2.z);
        if (tx1 < X0 || tx0 > PX1 || tz1 < Z0 || tz0 > PZ1) continue;
        markRange(drawnCell, tx0, tz0, tx1, tz1);
      }
    });

    // ---- SOLID: every collider box that spans the band inside the plate ----
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c) continue;
      if (c.y0 == null) continue;                    // full-height world box, not a storey wall
      if (BAND < c.y0 || BAND > c.y1) continue;
      if (c.maxX < X0 || c.minX > PX1 || c.maxZ < Z0 || c.minZ > PZ1) continue;
      markRange(solidCell, c.minX, c.minZ, c.maxX, c.maxZ);
    }

    let drawn = 0, solid = 0, walkThrough = 0;
    for (let i = 0; i < drawnCell.length; i++) {
      if (!drawnCell[i]) continue;
      drawn++;
      if (solidCell[i]) solid++; else walkThrough++;
    }
    const tested = NX * NZ;

    // ---- locked doors on this storey --------------------------------------
    let lockedDoors = 0;
    if (CBZ.cityUnitDoors && CBZ.cityUnitDoors.on) {
      try { lockedDoors = CBZ.cityUnitDoors.on(b, baseY, 0.8).filter((d) => !d.open).length; }
      catch (_) { lockedDoors = 0; }
    }

    // THE COST, MEASURED WHERE IT IS STABLE. renderer.info.render.calls after a
    // single manual render is not comparable between two pages (what else has
    // rendered since the last reset differs), and the first cut of this preset
    // duly reported a 26x "improvement" that was pure bookkeeping. core/batch.js
    // publishes the number that actually changed: how many merged static meshes
    // the build produced, which is one draw call each and is a pure function of
    // the geometry. A solid partition leaves the shared per-tile inert bucket
    // for its building's own wall bucket, and this is what that costs.
    const bs = CBZ.batchStats || {};
    const staticDrawMeshes = (bs.mergedMeshes | 0) + (bs.wallMerged | 0);

    return {
      ok: true,
      lot: { i: lot.i, j: lot.j, storeys: b.storeys | 0, w: Math.round(b.w), d: Math.round(b.d) },
      floor: floorK,
      cellsTested: tested,
      hasUnitDoorRegistry: !!CBZ.cityUnitDoors,
      metrics: {
        walkThroughCells: walkThrough,
        solidCells: solid,
        fakeWallShare: drawn ? Math.round((walkThrough / drawn) * 1000) / 10 : 0,
        lockedDoors: lockedDoors,
        staticDrawMeshes: staticDrawMeshes,
      },
    };
  },
};
