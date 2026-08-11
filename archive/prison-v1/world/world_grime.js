/* ============================================================
   world/world_grime.js — WEAR, PAINT AND PUDDLES (layer 4 of 5).

   Clean geometry is the tell. A real street surface is a record of
   everything that ever happened on it: cracked and patched, painted and
   repainted, stained where cars leak and puddled where it never drains.

   city/world.js's own roadDetail() pass already owns the FIRST layer of
   this (kerbs, stop bars, manholes, gutter grates, a few asphalt patches
   and intersection scuffs, turn arrows) — none of that is duplicated
   here. This pass adds what it does not have:

     • KERB PAINT ZONES — red fire lanes and yellow loading zones running
       along the kerb line, the single most recognisable "this is a real
       street" marking after the centreline.
     • PARKING BAY LINES — the white T-marks that turn undifferentiated
       kerbside asphalt into somewhere cars are supposed to be.
     • CRACK NETWORKS — branching hairline fractures radiating from the
       stress points (kerb joints, junction mouths), not a random scatter.
     • TYRE MARKS — paired braking streaks at stop lines and arcing scuffs
       through turns, where a real junction is black with rubber.
     • GUTTER STAINING — the dark wet line where runoff has run for years.
     • PAVEMENT PATCHES and gum spots on the sidewalk slabs.
     • PUDDLES in the low spots, the one textured layer here (a soft
       alpha disc; everything else is flat vertex-coloured geometry).

   DRAW-CALL BUDGET
     regulation paint 1 · wear/grime 1 · puddles 1  =  3.

   All decal materials carry polygonOffset and non-empty userData so
   core/batch.js's V2 merge never re-materials them — that merge drops
   polygonOffset, which is exactly the "floating yellow line" bug
   city/world.js:paintMesh documents.

   Flag: CBZ.CONFIG.DETAIL_GROUND_GRIME.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.detailKit) return;
  const THREE = window.THREE;
  const DK = CBZ.detailKit;

  // Height ladder over city/world.js's existing paint stack (asphalt 0.040/
  // 0.045 → lane paint 0.055/0.057 → zebra 0.063 → stop bars & arrows 0.065 →
  // manholes 0.066 → sidewalk slab 0.080 → expansion joints 0.088). We sit at
  // 0.070 on the carriageway (above every marking, under the pavement) and
  // 0.093 on the pavement, with polygonOffset doing the real separation.
  const Y_ROAD = 0.070, Y_WALK = 0.093, Y_KERB = 0.232;

  // ---- puddle texture: one soft disc, deterministic edge wobble ---------
  let _puddleTex = null;
  function puddleTex() {
    if (_puddleTex) return _puddleTex;
    const S = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, S, S);
    // an irregular blob: a radial falloff modulated by a fixed harmonic
    // series (the concreteTex idiom in world/materials.js — arithmetic, never
    // Math.random, so the texture is reproducible on every client)
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
        const a = Math.atan2(dy, dx), r = Math.sqrt(dx * dx + dy * dy);
        const wobble = 0.78 + 0.11 * Math.sin(a * 3 + 0.7) + 0.07 * Math.sin(a * 5 - 1.9) + 0.05 * Math.sin(a * 8 + 2.6);
        let al = 1 - Math.max(0, Math.min(1, (r - wobble * 0.55) / 0.34));
        al = Math.max(0, Math.min(1, al));
        al = al * al * (3 - 2 * al);
        const q = (y * S + x) * 4;
        // slightly brighter toward the middle: a puddle mirrors the sky
        const sheen = 150 + 70 * (1 - Math.min(1, r / 0.9));
        img.data[q] = sheen * 0.62; img.data[q + 1] = sheen * 0.72; img.data[q + 2] = sheen * 0.86;
        img.data[q + 3] = (al * 205) | 0;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    _puddleTex = t;
    return t;
  }

  // =====================================================================
  //  THE PASS
  // =====================================================================
  DK.register(30, "world-grime", function (city, DK) {
    if (CBZ.CONFIG.DETAIL_GROUND_GRIME === false) return;
    const root = city.root;

    // Unlit vertex-coloured sheets: they read identically at noon and
    // midnight, which is what real paint does under street lighting, and each
    // costs one draw for the whole city.
    // TWO of them, not one, and the split is deliberate: painted REGULATION
    // (kerb zones, parking bays) is structural information a player reads and
    // must survive a tier downgrade, while wear (cracks, stains, gum, tyre
    // marks) is pure texture and is the right thing to drop first. One extra
    // draw call buys a low tier that still looks administered rather than
    // merely dirty.
    const paint = DK.sheet("ground-paint", { cls: "decor", unlit: true, decal: true });
    const marks = DK.sheet("ground-marks", { cls: "fine", unlit: true, decal: true });
    const puddles = DK.sheet("puddles", { cls: "fine", unlit: true, map: puddleTex(), renderOrder: 2 });

    const streets = DK.streetRoads(city);
    const ROADW = city.ROAD || 18;

    // =====================================================================
    //  1) KERB PAINT + PARKING BAYS
    // =====================================================================
    // A kerb run picks ONE zoning per stretch (red fire lane / yellow loading
    // / white parking bays / unpainted) so the street reads as administered
    // rather than confetti. Zoning is hashed per road + stretch index.
    const RED = 0xb63630, YEL = 0xd9b13a, WHT = 0xdfe3e4;
    let bayN = 0;
    const BAY_MAX = DK.count(420);
    // Kerb paint has to sit ON a kerb, and only the mainland grid actually has
    // one (city/world.js:roadDetail rings every block with a 0.34m × 0.22m
    // kerb box at BLK/2-0.2, i.e. exactly road-half + 0.2). Town lanes and
    // biome roads have no kerb geometry, so painting a stripe at kerb height
    // there would leave a 23cm-high floating ribbon. Restrict to the grid.
    function hasKerb(r) {
      if (r.district) return false;
      if (r.w != null && Math.abs(r.w - ROADW) > 0.5) return false;
      const bx = city.minX, bX = city.maxX, bz = city.minZ, bZ = city.maxZ;
      if (![bx, bX, bz, bZ].every(Number.isFinite)) return false;
      return r.x >= bx - 30 && r.x <= bX + 30 && r.z >= bz - 30 && r.z <= bZ + 30;
    }
    for (let i = 0; i < streets.length; i++) {
      const r = streets[i];
      const half = (r.w != null ? r.w : ROADW) / 2;
      const kerbed = hasKerb(r);
      const kerbOff = half + 0.17;                 // ON the kerb top (world.js's kerb is 0.34 wide at BLK/2-0.2)
      const stretch = 13;
      const n = Math.floor(r.len / stretch);
      if (n < 1) continue;
      for (let k = 0; k < n; k++) {
        const t = -r.len / 2 + (k + 0.5) * (r.len / n);
        for (let s = -1; s <= 1; s += 2) {
          const cx = r.vertical ? r.x + s * kerbOff : r.x + t;
          const cz = r.vertical ? r.z + t : r.z + s * kerbOff;
          const zone = DK.h01(cx, cz, 0x6101);
          const gy = DK.groundY(cx, cz);
          const L = r.len / n - 1.4;
          if (L < 3) continue;
          if (!kerbed) {
            // no kerb here — the bays below still apply (they are painted on
            // the carriageway), the kerb stripes do not.
          } else if (zone < 0.13) {
            // fire lane — solid red down the kerb face/top
            paint.quadXZ(cx, gy + Y_KERB, cz, r.vertical ? 0.36 : L, r.vertical ? L : 0.36, 0, RED, null);
          } else if (zone < 0.24) {
            // loading zone — yellow
            paint.quadXZ(cx, gy + Y_KERB, cz, r.vertical ? 0.36 : L, r.vertical ? L : 0.36, 0, YEL, null);
          } else if (zone < 0.62 && bayN < BAY_MAX) {
            // parking bays: a T-mark every 5.6m just inside the gutter
            const bayOff = half - 2.4;
            const nb = Math.max(1, Math.floor(L / 5.6));
            for (let b = 0; b <= nb && bayN < BAY_MAX; b++) {
              const bt = t - L / 2 + b * (L / nb);
              const bx = r.vertical ? r.x + s * bayOff : r.x + bt;
              const bz = r.vertical ? r.z + bt : r.z + s * bayOff;
              const by = DK.groundY(bx, bz) + Y_ROAD;
              // stem, pointing in from the kerb
              paint.quadXZ(bx, by, bz, r.vertical ? 2.2 : 0.13, r.vertical ? 0.13 : 2.2, 0, WHT, null);
              // and the cross-bar at the kerb end
              const tx = r.vertical ? bx + s * 1.05 : bx, tz = r.vertical ? bz : bz + s * 1.05;
              paint.quadXZ(tx, by, tz, r.vertical ? 0.13 : 1.5, r.vertical ? 1.5 : 0.13, 0, WHT, null);
              bayN++;
            }
          }
        }
      }
    }

    // =====================================================================
    //  2) CRACK NETWORKS
    // =====================================================================
    // Asphalt fails at its edges and at the junction mouths where the load
    // concentrates. A crack is drawn as a short chain of thin quads whose
    // heading wanders by a position hash — a branch, not a scratch.
    function crack(x0, z0, dir, len, width, color, y, segs) {
      let x = x0, z = z0, a = dir;
      const n = segs || 4;
      const step = len / n;
      for (let i = 0; i < n; i++) {
        a += DK.h11(x, z, 0x6111 + i) * 0.55;
        const nx2 = x + Math.cos(a) * step, nz2 = z + Math.sin(a) * step;
        const mx = (x + nx2) / 2, mz = (z + nz2) / 2;
        marks.quadXZ(mx, y, mz, step * 1.06, width * (1 - i / (n + 2)), a, color, null);
        x = nx2; z = nz2;
      }
      return { x: x, z: z, a: a };
    }
    let crackN = 0;
    const CRACK_MAX = DK.count(260);
    for (let i = 0; i < streets.length && crackN < CRACK_MAX; i++) {
      const r = streets[i];
      const half = (r.w != null ? r.w : ROADW) / 2;
      const n = Math.max(1, Math.floor(r.len / 17));
      for (let k = 0; k < n && crackN < CRACK_MAX; k++) {
        const t = -r.len / 2 + (k + 0.5) * (r.len / n);
        const lane = DK.h11(r.x + t, r.z + t, 0x6112) * (half - 1.2);
        const x = r.vertical ? r.x + lane : r.x + t;
        const z = r.vertical ? r.z + t : r.z + lane;
        if (DK.h01(x, z, 0x6113) > 0.55) continue;
        const gy = DK.groundY(x, z) + Y_ROAD;
        const dir = DK.h01(x, z, 0x6114) * 6.28;
        const end = crack(x, z, dir, 2.4 + DK.h01(x, z, 0x6115) * 4.2, 0.075, 0x121317, gy, 4);
        // one branch off the main run — the thing that makes it read as damage
        if (DK.h01(x, z, 0x6116) < 0.55) {
          crack(end.x, end.z, end.a + (DK.h01(x, z, 0x6117) < 0.5 ? 0.9 : -0.9), 1.4 + DK.h01(x, z, 0x6118) * 1.6, 0.055, 0x15161a, gy, 3);
        }
        crackN++;
      }
    }

    // =====================================================================
    //  3) TYRE MARKS
    // =====================================================================
    // Paired streaks (a car has two tracks), laid where cars actually brake
    // and turn: at the stop line on a junction approach, and arcing through
    // the junction box itself.
    const inter = city.intersections || [];
    let skidN = 0;
    const SKID_MAX = DK.count(200);
    for (let i = 0; i < inter.length && skidN < SKID_MAX; i++) {
      const it = inter[i];
      const gy = DK.groundY(it.x, it.z) + Y_ROAD;
      const stop = ROADW / 2 + 2.9;
      for (let ap = 0; ap < 4; ap++) {
        if (DK.h01(it.x + ap, it.z - ap, 0x6121) > 0.5) continue;
        const vert = ap < 2, s = (ap % 2) ? 1 : -1;
        const lane = 3.6 * (ap % 2 ? 0.5 : -0.5) * 2;
        // two parallel streaks 1.55m apart (a real track width)
        for (let w = -1; w <= 1; w += 2) {
          const off = lane + w * 0.78;
          const len = 2.2 + DK.h01(it.x + ap * 3, it.z + w, 0x6122) * 3.4;
          const cx = vert ? it.x + off : it.x - s * (stop + len / 2);
          const cz = vert ? it.z - s * (stop + len / 2) : it.z + off;
          marks.quadXZ(cx, gy, cz, vert ? 0.2 : len, vert ? len : 0.2, 0, 0x17181c, null);
        }
        skidN++;
      }
      // an arcing scuff through the box, where somebody took the corner hot
      if (DK.h01(it.x, it.z, 0x6123) < 0.45) {
        const R = ROADW * 0.42, a0 = ((DK.h01(it.x, it.z, 0x6124) * 4) | 0) * (Math.PI / 2);
        for (let s2 = 0; s2 < 6; s2++) {
          const a = a0 + s2 * 0.19;
          const px = it.x + Math.cos(a) * R, pz = it.z + Math.sin(a) * R;
          marks.quadXZ(px, gy, pz, 0.9, 0.19, a + Math.PI / 2, 0x191a1e, null);
        }
      }
    }

    // =====================================================================
    //  4) GUTTER STAINING + PAVEMENT WEAR + PUDDLES
    // =====================================================================
    // The gutter line is the dirtiest metre of any street; the pavement wears
    // in irregular patches and collects gum. Puddles gather against the kerb
    // where the camber sends the water.
    let stainN = 0, gumN = 0, patchN = 0, puddN = 0;
    const STAIN_MAX = DK.count(700), GUM_MAX = DK.count(600),
      PATCH_MAX = DK.count(260), PUDD_MAX = DK.count(150);
    DK.eachKerb(city, 5.2, 0x6131, function (p) {
      const h = p.h;
      const gy = DK.groundY(p.x, p.z);
      let any = false;
      // (a) the dark wet line in the gutter, hugging the kerb
      if (stainN < STAIN_MAX && h < 0.72) {
        const gx = p.x - p.nx * 0.62, gz = p.z - p.nz * 0.62;
        const along = p.road.vertical ? 0 : 1;
        marks.quadXZ(gx, gy + Y_ROAD - 0.002, gz,
          along ? 5.0 : 0.95, along ? 0.95 : 5.0, 0,
          h < 0.34 ? 0x1c1d21 : 0x212328, null);
        stainN++; any = true;
      }
      // (b) pavement patch — a repaired slab in a different concrete
      if (patchN < PATCH_MAX && h > 0.80) {
        const wx = p.x + p.nx * 0.7, wz = p.z + p.nz * 0.7;
        const w = 1.0 + DK.h01(wx, wz, 0x6132) * 1.5;
        marks.quadXZ(wx, gy + Y_WALK, wz, w, 0.8 + DK.h01(wz, wx, 0x6133) * 1.0,
          DK.h11(wx, wz, 0x6134) * 0.22,
          DK.h01(wx, wz, 0x6135) < 0.5 ? 0xa79d80 : 0xb0a78c, null);
        patchN++; any = true;
      }
      // (c) trodden-in gum — tiny, dark, and everywhere on a real pavement
      if (gumN < GUM_MAX && h > 0.26 && h < 0.60) {
        for (let k = 0; k < 3 && gumN < GUM_MAX; k++) {
          const gx = p.x + p.nx * (0.3 + k * 0.42) + p.nz * DK.h11(p.x + k, p.z, 0x6136) * 0.7;
          const gz = p.z + p.nz * (0.3 + k * 0.42) - p.nx * DK.h11(p.x + k, p.z, 0x6136) * 0.7;
          const s = 0.07 + DK.h01(gx, gz, 0x6137) * 0.09;
          marks.quadXZ(gx, gy + Y_WALK, gz, s, s * 0.85, DK.h01(gz, gx, 0x6138) * 3.14, 0x4a463d, null);
          gumN++;
        }
        any = true;
      }
      // (d) a puddle against the kerb in the gutter's low spot
      if (puddN < PUDD_MAX && h > 0.955) {
        const px = p.x - p.nx * 0.85, pz = p.z - p.nz * 0.85;
        const w = 1.5 + DK.h01(px, pz, 0x6139) * 2.4;
        const d = 0.9 + DK.h01(pz, px, 0x613a) * 1.3;
        puddles.quadXZ(px, gy + Y_ROAD + 0.004, pz,
          p.road.vertical ? d : w, p.road.vertical ? w : d,
          DK.h11(px, pz, 0x613b) * 0.3, 0xffffff, DK.atlasCell(0, 1));
        puddN++; any = true;
      }
      // Never claim: these are flat stains with no volume, and reserving the
      // ground under them would starve the (later) building-dressing pass.
      // `alley: false` is the same argument applied to city/props.js's ALLEY
      // LAW: nothing in this pass is a PROP — it is paint, wear and water —
      // so none of it may spend an alley's one-solid budget. This whole file
      // is deliberately untouched by PROPS_PURGE_V1 for exactly that reason:
      // it places no collider and blocks nothing.
      return false;
    }, { band: 1.0, free: { door: false, props: false, roadMargin: -0.4, alley: false } });

    // =====================================================================
    //  5) DOORWAY WEAR
    // =====================================================================
    // The one place foot traffic is guaranteed: a scuffed, darker apron in
    // front of every shop door. Cheap, and it makes a doorway look used.
    let apronN = 0;
    const APRON_MAX = DK.count(220);
    DK.eachBuilding(city, function (bi) {
      if (apronN >= APRON_MAX || !bi.door) return;
      const d = bi.door;
      const nx = Number.isFinite(d.nx) ? -d.nx : 0, nz = Number.isFinite(d.nz) ? -d.nz : 0;
      const ax = d.x + nx * 1.35, az = d.z + nz * 1.35;
      if (DK.onRoad(ax, az, 0.2)) return;
      const gy = DK.groundY(ax, az);
      marks.quadXZ(ax, gy + Y_WALK, az, 2.5, 2.5, 0, 0xaba28a, null);
      marks.quadXZ(ax, gy + Y_WALK + 0.001, az, 1.5, 1.5, 0, 0x9d947e, null);
      apronN++;
    });

    paint.build(root);
    marks.build(root);
    puddles.build(root);
  });
})();
