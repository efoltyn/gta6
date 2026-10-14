/* ============================================================
   world/tsunami_runup.js — THE WATER ON THE LAND IS A REAL FLOW.

   Until this file the island tsunami was a bathtub: one sea level walked up
   and down, with a straight line across the island marking where it had
   "arrived". Every street the line had passed was under the same flat sheet
   at the same instant, the water knew nothing about the buildings, and it
   left the same way, all at once. What every piece of Tohoku and Aceh
   footage shows instead:

     - the flood RUNS UP the land as a current, fastest down the streets and
       the gaps between buildings (the blocks are walls, the streets are
       channels), deepest in the low ground, and it STOPS where the land rises
       above what its momentum can climb;
     - it arrives at different places at different times, so the front is
       ragged, not a ruled line;
     - buildings fill through their doors and windows, slower than the street
       outside them, which is why the waterline on a facade is higher than the
       one inside it;
     - when the sea falls the water on the land does not vanish, it RUNS BACK,
       down the same streets, and that backwash is the half that drags the
       wreckage out to sea.

   So the land is now a shallow-water solver: the LOCAL INERTIAL scheme of
   Bates, Horritt & Fewtrell (2010) as stabilised by de Almeida et al. (2012),
   the one real flood-inundation models (LISFLOOD-FP) run. A grid of cells
   over the island, each with a bed height and a water depth; between each
   pair a unit-width discharge q that accelerates down the water-surface
   slope and is held back by Manning friction:

       q' = (q - g h dt dEta/dx) / (1 + g dt n^2 |q| / h^(7/3))
       h' = h + dt (sum q_in - sum q_out) / dx

   Buildings are POROUS cells: the faces between a standing building and the
   street pass only an opening fraction (doors, windows), so the ground floor
   floods late and to a lower level than the street. A building that falls
   becomes rubble: open, and rough.

   THE SEA IS THE BOUNDARY. Every cell joined to the open sea (below the rest
   level, flood-filled from the domain edge) is FORCED to whatever level the
   director's sea is at that point (`forcing(x, z)`), which is exactly the
   level the sheet is drawn at outside the grid. So the drawdown, the bore
   over the shelf and the fall of the sea are the director's, and everything
   above the waterline is physics.

   ONE WATER. This file does not draw anything and it does not answer
   anybody's water question on its own: world/water_spec.js asks the field
   attached here (CBZ.tsuRunup.current()) inside its own CBZ.waterFrontDropAt,
   CBZ.waterEventSample and CBZ.waterDisasterSurfaceY, and its disaster sea
   material displaces the shared sheet by the same field (one RGBA texture,
   uploaded once per frame), so the swimmer, the bots, the debris, the mud
   and the rendered surface all read one number.

   COST (phone law): a grid of <= 160 x 160 cells (cell >= 2.5 m: two to four
   across a street), one substep per frame at normal depths, ~3 typed-array
   passes. Measured in the lab kit `tsunami`. Nothing allocates per frame.
============================================================ */
(function () {
  "use strict";
  const CBZ = (typeof window !== "undefined" ? window : globalThis).CBZ;
  if (!CBZ) return;

  const G = 9.81;
  const VMAX = 15;            // m/s: velocity cap (a supercritical sheet down a steep street is real; 15 is beyond any flood)
  const OPEN = 0.14;          // the share of a standing building's wall that passes water (doors, windows, vents)
  const N_TOWN = 0.035;       // Manning n: streets, yards, gardens
  const N_SEA = 0.025;        // the shelf
  const N_RUBBLE = 0.075;     // a collapsed building
  const FROUDE_CAP = 1.25;    // the Froude cap every inertial flood model carries: a thin sheet down a steep
                              // slope otherwise accelerates without bound and the scheme blows up
  const THETA = 0.8;          // the momentum blend (see substep)
  const WET = 0.02;           // m: wetter than this is water
  // THE TEXTURE'S ENCODING is the shader's (world/water_spec.js RUN_ENC,
  // which loads first); these fallbacks only serve a page without it
  const ENC = CBZ.waterRunupEnc || { lo: -16, span: 64, depth: 25, speed: 16, dryLift: 0.6 };
  const DRY_LIFT = ENC.dryLift;          // m a dry cell's drawn surface sits under its bed
  const ENC_LO = ENC.lo, ENC_SPAN = ENC.span, DEPTH_ENC = ENC.depth, SPEED_ENC = ENC.speed;

  function create(o) {
    o = o || {};
    const groundAt = o.groundAt;
    if (typeof groundAt !== "function") throw new Error("tsuRunup.create: groundAt(x, z) required");
    const restY = Number.isFinite(o.restY) ? +o.restY : 0;
    const FROUDE = Number.isFinite(o.froude) ? +o.froude : FROUDE_CAP;
    const maxN = Math.max(32, Math.min(256, o.maxN || 160));
    const half = Math.max(20, +o.half || 100);
    let dx = Math.max(+o.cell || 2.5, (2 * half) / maxN);
    const n = Math.max(16, Math.ceil((2 * half) / dx));
    dx = (2 * half) / n;
    const x0 = (+o.cx || 0) - half, z0 = (+o.cz || 0) - half;
    const NN = n * n;

    const zb = new Float32Array(NN);          // bed
    const h = new Float32Array(NN);           // depth
    const u = new Float32Array(NN), v = new Float32Array(NN);  // cell velocity (m/s)
    const qx = new Float32Array((n + 1) * n); // x faces: f = j*(n+1)+i, between (i-1,j) and (i,j)
    const qz = new Float32Array(n * (n + 1)); // z faces: f = j*n+i, between (i,j-1) and (i,j)
    const qx0 = new Float32Array(qx.length), qz0 = new Float32Array(qz.length);   // last substep's, for the theta blend
    const cx_ = new Float32Array((n + 1) * n), cz_ = new Float32Array(n * (n + 1));   // face conductance
    const n2 = new Float32Array(NN);          // Manning n^2 per cell
    const bid = new Int16Array(NN).fill(-1);  // building index per cell
    const forced = new Uint8Array(NN);
    const scale = new Float32Array(NN);
    const hmax = new Float32Array(NN);
    const arrive = new Float32Array(NN).fill(-1);
    const coast = new Float32Array(NN).fill(-1);   // m from the rest-level sea (-1 = sea)
    let forcedList = new Int32Array(0), fX = new Float32Array(0), fZ = new Float32Array(0);
    let blocks = [];
    let t = 0, steps = 0, subTotal = 0, lastMs = 0, msSum = 0, msN = 0, msMax = 0;
    let peakLandVol = 0, landVol = 0, inflow = 0;
    let forcing = null;
    let tex = null, texData = null, texDirty = true;

    const cxAt = (i) => x0 + (i + 0.5) * dx, czAt = (j) => z0 + (j + 0.5) * dx;

    /* ---- THE BED ------------------------------------------------------- */
    let bedRow = 0;
    function bedSlice(rows) {
      const end = Math.min(n, bedRow + (rows || n));
      for (let j = bedRow; j < end; j++) {
        const z = czAt(j);
        for (let i = 0; i < n; i++) zb[j * n + i] = groundAt(cxAt(i), z);
      }
      bedRow = end;
      if (bedRow >= n) finishBed();
      return bedRow / n;
    }
    let ready = false;
    function finishBed() {
      // THE OPEN SEA: everything below rest level joined to the domain edge
      const seaCut = restY - 0.25;
      const stack = [];
      for (let i = 0; i < n; i++) { stack.push(i, (n - 1) * n + i, i * n, i * n + n - 1); }
      while (stack.length) {
        const k = stack.pop();
        if (forced[k]) continue;
        const i = k % n, j = (k / n) | 0;
        const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
        if (!edge && zb[k] > seaCut) continue;
        forced[k] = 1;
        if (i > 0) stack.push(k - 1);
        if (i < n - 1) stack.push(k + 1);
        if (j > 0) stack.push(k - n);
        if (j < n - 1) stack.push(k + n);
      }
      let m = 0;
      for (let k = 0; k < NN; k++) if (forced[k]) m++;
      forcedList = new Int32Array(m); fX = new Float32Array(m); fZ = new Float32Array(m);
      m = 0;
      for (let k = 0; k < NN; k++) if (forced[k]) { forcedList[m] = k; fX[m] = cxAt(k % n); fZ[m] = czAt((k / n) | 0); m++; }
      // distance from the sea, chamfer 3-4 (two passes): what "how far inland
      // did it reach" is measured in
      const INF = 1e9, d = new Float32Array(NN);
      for (let k = 0; k < NN; k++) d[k] = forced[k] ? 0 : INF;
      const a = dx, b = dx * Math.SQRT2;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i; let m0 = d[k];
        if (i > 0) m0 = Math.min(m0, d[k - 1] + a);
        if (j > 0) { m0 = Math.min(m0, d[k - n] + a); if (i > 0) m0 = Math.min(m0, d[k - n - 1] + b); if (i < n - 1) m0 = Math.min(m0, d[k - n + 1] + b); }
        d[k] = m0;
      }
      for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
        const k = j * n + i; let m0 = d[k];
        if (i < n - 1) m0 = Math.min(m0, d[k + 1] + a);
        if (j < n - 1) { m0 = Math.min(m0, d[k + n] + a); if (i < n - 1) m0 = Math.min(m0, d[k + n + 1] + b); if (i > 0) m0 = Math.min(m0, d[k + n - 1] + b); }
        d[k] = m0;
      }
      for (let k = 0; k < NN; k++) coast[k] = forced[k] ? -1 : d[k];
      // the sea's edge: forced cells that touch the land (they feed it)
      coastF = new Uint8Array(NN);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (!forced[k]) continue;
        if ((i > 0 && !forced[k - 1]) || (i < n - 1 && !forced[k + 1]) || (j > 0 && !forced[k - n]) || (j < n - 1 && !forced[k + n])) coastF[k] = 1;
      }
      ready = true;
      setBlocks(pendingBlocks);
    }

    /* ---- THE BUILDINGS --------------------------------------------------
       list: [{x, z, w, d, yaw?, gy?, h?, fallen?, ref?}] — the footprint of
       each standing building. Its cells take the floor height as bed and
       exchange water with the street through OPEN of their face. */
    let pendingBlocks = o.blocks || [];
    function setBlocks(list) {
      pendingBlocks = list || [];
      if (!ready) return;
      bid.fill(-1);
      blocks = [];
      for (let bi = 0; bi < pendingBlocks.length && blocks.length < 32000; bi++) {
        const B = pendingBlocks[bi];
        if (!B || !(B.w > 0) || !(B.d > 0)) continue;
        const rec = { ref: B.ref || B, x: +B.x, z: +B.z, w: +B.w, d: +B.d, yaw: +B.yaw || 0, gy: B.gy, h: B.h,
          fallen: !!B.fallen, cells: [], rim: [], rimLvl: -99, rimNow: -99, inLvl: -99, maxH: 0, maxHV2: 0 };
        const c = Math.cos(rec.yaw), s = Math.sin(rec.yaw);
        const R = Math.hypot(rec.w, rec.d) * 0.5 + dx * 1.6;
        const i0 = Math.max(0, Math.floor((rec.x - R - x0) / dx)), i1 = Math.min(n - 1, Math.ceil((rec.x + R - x0) / dx));
        const j0 = Math.max(0, Math.floor((rec.z - R - z0) / dx)), j1 = Math.min(n - 1, Math.ceil((rec.z + R - z0) / dx));
        const idx = blocks.length;
        const inside = function (px, pz, grow) {
          const lx = (px - rec.x) * c - (pz - rec.z) * s, lz = (px - rec.x) * s + (pz - rec.z) * c;
          return Math.abs(lx) <= rec.w * 0.5 + grow && Math.abs(lz) <= rec.d * 0.5 + grow;
        };
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = j * n + i, px = cxAt(i), pz = czAt(j);
          if (inside(px, pz, -0.15 * dx)) {
            if (forced[k] || bid[k] >= 0) continue;
            bid[k] = idx; rec.cells.push(k);
            if (Number.isFinite(rec.gy)) zb[k] = Math.max(zb[k], +rec.gy);
          } else if (inside(px, pz, dx * 1.2) && !forced[k]) rec.rim.push(k);
        }
        if (rec.cells.length || rec.rim.length) blocks.push(rec);
      }
      rebuildFaces();
    }
    function rebuildFaces() {
      for (let k = 0; k < NN; k++) {
        const b = bid[k];
        n2[k] = b >= 0 && blocks[b].fallen ? N_RUBBLE * N_RUBBLE : forced[k] ? N_SEA * N_SEA : N_TOWN * N_TOWN;
      }
      const cond = function (a, b) {
        const A = bid[a], B = bid[b];
        if (A === B) return 1;
        const sa = A >= 0 && !blocks[A].fallen, sb = B >= 0 && !blocks[B].fallen;
        return sa || sb ? OPEN : 1;
      };
      // 0 = a closed face (the domain's edge); -1 = a face inside the open
      // sea, which the forcing owns outright (never computed, never blended)
      for (let j = 0; j < n; j++) {
        for (let i = 0; i <= n; i++) {
          const a = j * n + i - 1, b = a + 1;
          cx_[j * (n + 1) + i] = (i === 0 || i === n) ? 0 : (forced[a] && forced[b]) ? -1 : cond(a, b);
        }
      }
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i < n; i++) {
          const a = (j - 1) * n + i, b = j * n + i;
          cz_[j * n + i] = (j === 0 || j === n) ? 0 : (forced[a] && forced[b]) ? -1 : cond(a, b);
        }
      }
    }
    // a building came down: its footprint is rubble from now on
    function setFallen(ref) {
      for (let i = 0; i < blocks.length; i++) if (blocks[i].ref === ref && !blocks[i].fallen) { blocks[i].fallen = true; rebuildFaces(); return true; }
      return false;
    }

    /* ---- ONE FRAME ------------------------------------------------------ */
    function applyForcing() {
      if (!forcing) return;
      for (let m = 0; m < forcedList.length; m++) {
        const k = forcedList[m];
        const lvl = forcing(fX[m], fZ[m]);
        const d = Number.isFinite(lvl) ? lvl - zb[k] : 0;
        h[k] = d > 0 ? d : 0;
      }
    }

    /* ---- ONLY WHERE THE WATER IS ------------------------------------------
       Per row, the span of cells that are wet (or are the sea's edge cells,
       which feed the land), widened by the distance a front can travel in
       one frame. Every pass below walks only these spans, so the dry island
       before the wave and the drained town after it cost next to nothing. */
    const lo = new Int32Array(n), hi = new Int32Array(n);
    const plo = new Int32Array(n).fill(n), phi = new Int32Array(n).fill(-1);
    const rlo = new Int32Array(n), rhi = new Int32Array(n);
    let coastF = null;
    function spans(m) {
      for (let j = 0; j < n; j++) {
        let a = n, b = -1;
        const row = j * n;
        for (let i = 0; i < n; i++) {
          const k = row + i;
          if (h[k] > WET && (!forced[k] || coastF[k])) { if (i < a) a = i; b = i; }
        }
        rlo[j] = a; rhi[j] = b;
      }
      for (let j = 0; j < n; j++) {
        let a = n, b = -1;
        for (let r = Math.max(0, j - m); r <= Math.min(n - 1, j + m); r++) {
          if (rhi[r] < 0) continue;
          if (rlo[r] < a) a = rlo[r];
          if (rhi[r] > b) b = rhi[r];
        }
        lo[j] = b < 0 ? n : Math.max(0, a - m); hi[j] = b < 0 ? -1 : Math.min(n - 1, b + m);
        // faces that just left the span carry nothing (and the cells are still)
        if (phi[j] >= 0) {
          const fr = j * (n + 1), row = j * n;
          for (let i = plo[j]; i <= phi[j]; i++) {
            if (i >= lo[j] && i <= hi[j]) continue;
            qx[fr + i] = 0; qx[fr + i + 1] = 0; qz[row + i] = 0; qz[row + n + i] = 0;
            u[row + i] = 0; v[row + i] = 0;
          }
        }
        plo[j] = lo[j]; phi[j] = hi[j];
      }
    }

    function substep(dt) {
      let hm = 0;
      // ---- x faces. THE THETA BLEND (de Almeida et al. 2012): the momentum
      // a face carries is mostly its own and partly its two neighbours' along
      // the flow; without it the inertial scheme grows a checkerboard in the
      // low-friction channels between buildings and stacks water into a spike.
      for (let j = 0; j < n; j++) {
        if (hi[j] < 0) continue;
        const frow = j * (n + 1);
        const i0 = Math.max(1, lo[j]), i1 = Math.min(n - 1, hi[j] + 1);
        for (let i = i0 - 1; i <= i1 + 1 && i <= n; i++) qx0[frow + i] = qx[frow + i];
      }
      for (let j = 0; j < n; j++) {
        if (hi[j] < 0) continue;
        const row = j * n, frow = j * (n + 1);
        const i0 = Math.max(1, lo[j]), i1 = Math.min(n - 1, hi[j] + 1);
        for (let i = i0; i <= i1; i++) {
          const f = frow + i, c = cx_[f];
          const a = row + i - 1, b = a + 1;
          if (c <= 0) { qx[f] = 0; continue; }
          const ea = zb[a] + h[a], eb = zb[b] + h[b];
          const hf = (ea > eb ? ea : eb) - (zb[a] > zb[b] ? zb[a] : zb[b]);
          if (hf <= 1e-3) { qx[f] = 0; continue; }
          // (only across faces of the same kind: blending a street face into a
          // building's doorway would carry the street's momentum through the wall)
          const q0 = qx0[f], qa = cx_[f - 1] === c ? qx0[f - 1] : q0, qb = cx_[f + 1] === c ? qx0[f + 1] : q0;
          let q = THETA * q0 + (1 - THETA) * 0.5 * (qa + qb);
          const nn = n2[a] > n2[b] ? n2[a] : n2[b];
          q = (q - G * hf * dt * (eb - ea) / dx) / (1 + G * dt * nn * (q < 0 ? -q : q) / (hf * hf * Math.cbrt(hf)));
          const qm = hf * Math.min(VMAX, FROUDE * Math.sqrt(G * hf));
          qx[f] = q > qm ? qm : q < -qm ? -qm : q;
          if (hf > hm) hm = hf;
        }
      }
      // ---- z faces (between rows j-1 and j)
      for (let j = 1; j < n; j++) {
        const i0 = Math.min(lo[j], lo[j - 1]), i1 = Math.max(hi[j], hi[j - 1]);
        const row = j * n;
        for (let i = i0; i <= i1; i++) { const f = row + i; qz0[f] = qz[f]; qz0[f - n] = qz[f - n]; qz0[f + n] = qz[f + n]; }
      }
      for (let j = 1; j < n; j++) {
        const i0 = Math.min(lo[j], lo[j - 1]), i1 = Math.max(hi[j], hi[j - 1]);
        const row = j * n;
        for (let i = i0; i <= i1; i++) {
          const f = row + i, c = cz_[f];
          const a = row - n + i, b = row + i;
          if (c <= 0) { qz[f] = 0; continue; }
          const ea = zb[a] + h[a], eb = zb[b] + h[b];
          const hf = (ea > eb ? ea : eb) - (zb[a] > zb[b] ? zb[a] : zb[b]);
          if (hf <= 1e-3) { qz[f] = 0; continue; }
          const q0 = qz0[f], qa = cz_[f - n] === c ? qz0[f - n] : q0, qb = cz_[f + n] === c ? qz0[f + n] : q0;
          let q = THETA * q0 + (1 - THETA) * 0.5 * (qa + qb);
          const nn = n2[a] > n2[b] ? n2[a] : n2[b];
          q = (q - G * hf * dt * (eb - ea) / dx) / (1 + G * dt * nn * (q < 0 ? -q : q) / (hf * hf * Math.cbrt(hf)));
          const qm = hf * Math.min(VMAX, FROUDE * Math.sqrt(G * hf));
          qz[f] = q > qm ? qm : q < -qm ? -qm : q;
          if (hf > hm) hm = hf;
        }
      }
      // ---- never take more water out of a cell than it holds
      for (let j = 0; j < n; j++) {
        for (let i = lo[j]; i <= hi[j]; i++) {
          const k = j * n + i;
          let out = 0, f;
          f = j * (n + 1) + i; if (qx[f] < 0) out -= qx[f] * cx_[f];          // west face, flowing west
          f = j * (n + 1) + i + 1; if (qx[f] > 0) out += qx[f] * cx_[f];      // east face, flowing east
          f = j * n + i; if (qz[f] < 0) out -= qz[f] * cz_[f];                // south
          f = (j + 1) * n + i; if (qz[f] > 0) out += qz[f] * cz_[f];          // north
          const vol = out * dt;
          scale[k] = vol > h[k] * dx ? (h[k] * dx) / vol : 1;
        }
      }
      for (let j = 0; j < n; j++) {
        if (hi[j] < 0) continue;
        const row = j * n, frow = j * (n + 1);
        const i0 = Math.max(1, lo[j]), i1 = Math.min(n - 1, hi[j] + 1);
        for (let i = i0; i <= i1; i++) {
          const f = frow + i, q = qx[f];
          if (q > 0) { if (i - 1 >= lo[j]) qx[f] = q * scale[row + i - 1]; }
          else if (q < 0) { if (i <= hi[j]) qx[f] = q * scale[row + i]; }
        }
      }
      for (let j = 1; j < n; j++) {
        const i0 = Math.min(lo[j], lo[j - 1]), i1 = Math.max(hi[j], hi[j - 1]);
        for (let i = i0; i <= i1; i++) {
          const f = j * n + i, q = qz[f];
          if (q > 0) { if (i >= lo[j - 1] && i <= hi[j - 1]) qz[f] = q * scale[(j - 1) * n + i]; }
          else if (q < 0) { if (i >= lo[j] && i <= hi[j]) qz[f] = q * scale[j * n + i]; }
        }
      }
      // ---- continuity
      const k_ = dt / dx;
      for (let j = 0; j < n; j++) {
        for (let i = lo[j]; i <= hi[j]; i++) {
          const k = j * n + i;
          const fw = j * (n + 1) + i, fe = fw + 1, fs = j * n + i, fn = fs + n;
          const net = qx[fw] * cx_[fw] - qx[fe] * cx_[fe] + qz[fs] * cz_[fs] - qz[fn] * cz_[fn];
          if (forced[k]) { inflow -= net * dt * dx; continue; }   // what the sea gave the land (m^3), for the books
          const hn = h[k] + k_ * net;
          h[k] = hn > 0 ? hn : 0;
        }
      }
      return hm;
    }

    let hmLast = 4;
    function step(dt) {
      if (!ready || !(dt > 0)) return;
      const T0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
      dt = Math.min(dt, 0.1);
      t += dt; steps++;
      applyForcing();
      const dtMax = 0.7 * dx / Math.sqrt(G * Math.max(0.5, hmLast + 1));
      const ns = Math.max(1, Math.min(12, Math.ceil(dt / dtMax)));
      const sd = dt / ns;
      let hm = 0;
      spans(ns + 1);
      for (let s = 0; s < ns; s++) {
        const r = substep(sd);
        if (r > hm) hm = r;
        if (s < ns - 1) applyForcing();
      }
      subTotal += ns;
      hmLast = hm;
      /* THE GROUND TAKES THE LAST OF IT. `seep` (m/s, 0 by default) is an
         infiltration the event's owner ramps up once the sea is back: water
         left standing in a hollow below every drain otherwise stays for the
         rest of the match. It is the game's clock, not the soil's (real
         ground takes hours); the backwash itself is the solver's. */
      const sp0 = F.seep > 0 ? F.seep * dt : 0;
      if (sp0 > 0) for (let j = 0; j < n; j++) for (let i = lo[j]; i <= hi[j]; i++) {
        const k = j * n + i;
        if (!forced[k] && h[k] > 0) h[k] = h[k] > sp0 ? h[k] - sp0 : 0;
      }
      // ---- velocities, books, arrival
      landVol = 0;
      for (let j = 0; j < n; j++) {
        const row = j * n;
        for (let i = lo[j]; i <= hi[j]; i++) {
          const k = row + i, hk = h[k];
          if (hk > WET) {
            const fw = j * (n + 1) + i, fs = j * n + i;
            const qxx = 0.5 * (qx[fw] * cx_[fw] + qx[fw + 1] * cx_[fw + 1]);
            const qzz = 0.5 * (qz[fs] * cz_[fs] + qz[fs + n] * cz_[fs + n]);
            const hh = hk > 0.05 ? hk : 0.05;
            let uu = qxx / hh, vv = qzz / hh;
            const sp = Math.hypot(uu, vv), cap = Math.min(VMAX, FROUDE * Math.sqrt(G * hh));
            if (sp > cap) { uu *= cap / sp; vv *= cap / sp; }
            u[k] = uu; v[k] = vv;
            if (!forced[k]) {
              landVol += hk;
              if (hk > hmax[k]) hmax[k] = hk;
              if (arrive[k] < 0 && hk > 0.1) arrive[k] = t;
            }
          } else { u[k] = 0; v[k] = 0; }
        }
      }
      landVol *= dx * dx;
      if (landVol > peakLandVol) peakLandVol = landVol;
      // ---- what each building is standing in
      for (let b = 0; b < blocks.length; b++) {
        const B = blocks[b];
        let lv = -99, mh = 0, mhv = 0;
        for (let r = 0; r < B.rim.length; r++) {
          const k = B.rim[r], hk = h[k];
          if (hk <= 0.05) continue;
          const e = zb[k] + hk;
          if (e > lv) lv = e;
          if (hk > mh) mh = hk;
          const hv2 = hk * (u[k] * u[k] + v[k] * v[k]);
          if (hv2 > mhv) mhv = hv2;
        }
        B.rimNow = lv;
        if (lv > B.rimLvl) B.rimLvl = lv;
        if (mh > B.maxH) B.maxH = mh;
        if (mhv > B.maxHV2) B.maxHV2 = mhv;
        B.hNow = mh; B.hv2Now = mhv;
        let il = -99;
        for (let c = 0; c < B.cells.length; c++) { const k = B.cells[c]; if (h[k] > WET) { const e = zb[k] + h[k]; if (e > il) il = e; } }
        B.inLvl = il;
      }
      texDirty = true;
      const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - T0;
      lastMs = ms; msSum += ms; msN++; if (ms > msMax) msMax = ms;
      for (let a = 0; a < F.after.length; a++) { try { F.after[a](dt, F); } catch (e) {} }
    }

    /* ---- READING IT ------------------------------------------------------ */
    // bilinear over cell centres; `out` gets {in (0..1 inside weight), eta (the
    // drawn surface: bed - 0.6 where dry), depth, u, v, speed, wet}
    function sample(x, z, out) {
      out = out || {};
      const fx = (x - x0) / dx - 0.5, fz = (z - z0) / dx - 0.5;
      if (!ready || fx < -0.5 || fz < -0.5 || fx > n - 0.5 || fz > n - 0.5) { out.in = 0; out.wet = false; out.depth = 0; out.u = 0; out.v = 0; out.speed = 0; out.eta = NaN; out.forced = 1; return out; }
      let i = Math.floor(fx), j = Math.floor(fz);
      let ax = fx - i, az = fz - j;
      if (i < 0) { i = 0; ax = 0; } if (j < 0) { j = 0; az = 0; }
      if (i > n - 2) { i = n - 2; ax = 1; } if (j > n - 2) { j = n - 2; az = 1; }
      const k00 = j * n + i, k10 = k00 + 1, k01 = k00 + n, k11 = k01 + 1;
      const w00 = (1 - ax) * (1 - az), w10 = ax * (1 - az), w01 = (1 - ax) * az, w11 = ax * az;
      const eR = function (k) { return h[k] > WET ? zb[k] + h[k] : zb[k] - DRY_LIFT; };
      out.eta = eR(k00) * w00 + eR(k10) * w10 + eR(k01) * w01 + eR(k11) * w11;
      out.depth = h[k00] * w00 + h[k10] * w10 + h[k01] * w01 + h[k11] * w11;
      out.u = u[k00] * w00 + u[k10] * w10 + u[k01] * w01 + u[k11] * w11;
      out.v = v[k00] * w00 + v[k10] * w10 + v[k01] * w01 + v[k11] * w11;
      out.speed = Math.hypot(out.u, out.v);
      out.wet = out.depth > WET;
      out.bed = zb[k00] * w00 + zb[k10] * w10 + zb[k01] * w01 + zb[k11] * w11;
      // how much of this point is the forced open sea (its current is the
      // director's, not this field's: forced cells carry no flux between them)
      out.forced = forced[k00] * w00 + forced[k10] * w10 + forced[k01] * w01 + forced[k11] * w11;
      // the outer cell and a half fade to the outside world
      const e = Math.min(fx + 0.5, fz + 0.5, n - 0.5 - fx, n - 0.5 - fz);
      out.in = e >= 1.5 ? 1 : e <= 0 ? 0 : e / 1.5;
      return out;
    }
    function cellAt(x, z) {
      const i = Math.floor((x - x0) / dx), j = Math.floor((z - z0) / dx);
      if (i < 0 || j < 0 || i >= n || j >= n) return -1;
      return j * n + i;
    }
    // the standing building whose footprint holds (x, z), or null
    function blockAt(x, z) {
      const k = cellAt(x, z);
      if (k < 0) return null;
      const b = bid[k];
      return b >= 0 && !blocks[b].fallen ? blocks[b] : null;
    }
    function buildingOf(ref) { for (let i = 0; i < blocks.length; i++) if (blocks[i].ref === ref) return blocks[i]; return null; }

    /* ---- THE GPU COPY: one RGBA8 texel per cell --------------------------
       R,G  the drawn surface (16 bit over ENC_LO..+ENC_SPAN m)
       B    depth, sqrt-encoded (fine at the waterline, coarse at 20 m)
       A    speed (0..SPEED_ENC m/s)                                       */
    function texture() {
      const THREE = (typeof window !== "undefined") ? window.THREE : null;
      if (!THREE || !ready) return null;
      if (!tex) {
        texData = new Uint8Array(NN * 4);
        tex = new THREE.DataTexture(texData, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false; tex.flipY = false;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.name = "tsunami-runup";
      }
      if (texDirty) {
        for (let k = 0; k < NN; k++) {
          const hk = h[k];
          const eta = hk > WET ? zb[k] + hk : zb[k] - DRY_LIFT;
          let e = Math.round(((eta - ENC_LO) / ENC_SPAN) * 65535);
          e = e < 0 ? 0 : e > 65535 ? 65535 : e;
          const o4 = k * 4;
          texData[o4] = e >> 8; texData[o4 + 1] = e & 255;
          const d = hk > DEPTH_ENC ? 1 : hk / DEPTH_ENC;
          texData[o4 + 2] = Math.round(Math.sqrt(d) * 255);
          const sp = Math.hypot(u[k], v[k]) / SPEED_ENC;
          texData[o4 + 3] = Math.round((sp > 1 ? 1 : sp) * 255);
        }
        tex.needsUpdate = true;
        texDirty = false;
      }
      return tex;
    }

    function reset() {
      h.fill(0); u.fill(0); v.fill(0); qx.fill(0); qz.fill(0);
      F.seep = 0;
      hmax.fill(0); arrive.fill(-1);
      t = 0; steps = 0; subTotal = 0; msSum = 0; msN = 0; msMax = 0; peakLandVol = 0; landVol = 0; inflow = 0; hmLast = 4;
      for (let b = 0; b < blocks.length; b++) { const B = blocks[b]; B.rimLvl = -99; B.rimNow = -99; B.inLvl = -99; B.maxH = 0; B.maxHV2 = 0; }
      texDirty = true;
    }

    /* ---- THE BOOKS ------------------------------------------------------- */
    function stats() {
      let wetNow = 0, wetEver = 0, maxD = 0, runD = 0, runE = -99, maxSp = 0;
      for (let k = 0; k < NN; k++) {
        if (forced[k]) continue;
        if (h[k] > 0.05) wetNow++;
        const s = Math.hypot(u[k], v[k]); if (s > maxSp) maxSp = s;
        if (hmax[k] > 0.1) {
          wetEver++;
          if (bid[k] < 0 && hmax[k] > maxD) maxD = hmax[k];
          if (coast[k] > runD) runD = coast[k];
          if (zb[k] > runE) runE = zb[k];
        }
      }
      const r2 = (x) => Math.round(x * 100) / 100;
      let flooded = 0; for (let b = 0; b < blocks.length; b++) if (blocks[b].inLvl > -90 || blocks[b].maxH > 0.3) flooded++;
      return {
        n: n, cell: r2(dx), t: r2(t), steps: steps, substeps: subTotal,
        wetCellsNow: wetNow, wetCellsEver: wetEver, floodedAreaM2: Math.round(wetEver * dx * dx),
        maxDepthM: r2(maxD), runupDistM: r2(runD), runupElevM: r2(runE > -90 ? runE - restY : 0), maxSpeedMs: r2(maxSp),
        landVolM3: Math.round(landVol), peakLandVolM3: Math.round(peakLandVol), seaInflowM3: Math.round(inflow),
        buildings: blocks.length, buildingsWet: flooded,
        msLast: r2(lastMs), msMean: msN ? r2(msSum / msN) : 0, msMax: r2(msMax), msTotal: msSum,
      };
    }

    const F = {
      n: n, cell: dx, x0: x0, z0: z0, size: n * dx, restY: restY, NN: NN,
      zb: zb, h: h, u: u, v: v, hmax: hmax, arrive: arrive, coast: coast, forced: forced, bid: bid,
      after: [], seep: 0,
      get ready() { return ready; },
      get t() { return t; },
      get blocks() { return blocks; },
      get landVol() { return landVol; },
      get peakLandVol() { return peakLandVol; },
      bedSlice: bedSlice,
      setBlocks: setBlocks, setFallen: setFallen,
      setForcing: function (fn) { forcing = typeof fn === "function" ? fn : null; },
      step: step, sample: sample, cellAt: cellAt, blockAt: blockAt, buildingOf: buildingOf,
      texture: texture, reset: reset, stats: stats,
    };
    if (o.build !== false) bedSlice(n);
    return F;
  }

  /* ---- THE ONE ATTACHED FIELD ------------------------------------------
     At most one field answers the water questions at a time. It steps
     itself (order 28.3: after the disaster director at 28 has published this
     frame's sea, before anything that reads the water) for as long as it is
     attached; `opts.until(field)` returning true detaches it (the drain-out
     after its event has ended). */
  let cur = null, curOpts = null;
  function attach(field, opts) {
    cur = field || null; curOpts = opts || {};
    if (cur && curOpts.forcing) cur.setForcing(curOpts.forcing);
    return cur;
  }
  function detach(field) {
    if (field && field !== cur) return false;
    if (cur) cur.after.length = 0;
    cur = null; curOpts = null;
    return true;
  }
  /* 30 Hz, not every frame: the flood's fastest front covers half a metre a
     tick (a fifth of a cell), the shader interpolates between cells anyway,
     and on a phone at 60 fps this halves the cost for no visible change. */
  const TICK = 1 / 30;
  let acc = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(28.3, function (dt) {
    const f = cur;
    if (!f || !f.ready) return;
    if (curOpts && curOpts.live && !curOpts.live()) return;
    acc += Math.max(0, Math.min(0.1, dt || 0));
    if (acc < TICK - 1e-6) return;
    f.step(acc); acc = 0;
    if (curOpts && curOpts.until && curOpts.until(f)) detach(f);
  });

  /* THE DEBRIS FIELD'S WATER (world/tsunami_debris.js cfg.flowAt): the
     field's own depth and current on the land; on the forced open sea (no
     flux between forced cells) the sea's depth and the published event's
     current, so what the bore picks up over the shelf comes in with it.
     seaY(x, z) / groundY(x, z) are the caller's water and ground. */
  function debrisFlow(field, seaY, groundY) {
    const ws = {};
    return function (x, z, out) {
      const r = cur === field ? field.sample(x, z, out) : null;
      if (r && r.in > 0 && r.forced < 0.5) return out;
      out.depth = seaY(x, z) - groundY(x, z);
      const e = CBZ.waterEventSample ? CBZ.waterEventSample(x, z, null, ws) : null;
      out.u = e && e.active ? e.currentX || 0 : 0;
      out.v = e && e.active ? e.currentZ || 0 : 0;
      return out;
    };
  }

  CBZ.tsuRunup = {
    create: create, attach: attach, detach: detach, debrisFlow: debrisFlow,
    current: function () { return cur && cur.ready ? cur : null; },
    ENC: ENC,
  };
})();
