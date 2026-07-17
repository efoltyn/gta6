/* ============================================================
   city/highways.js — the shared REAL-highway builder.

   CBZ.buildHighway(root, opts) lays a multi-lane highway ribbon along a
   centreline polyline (straight or L-shaped). It is the one builder the
   island causeways CALL — the island module owns placement + region
   registration; this file only knows how to make ONE highway cheaply.

   WHY draw-call discipline (the engine is draw-call bound): everything that
   repeats is MERGED or INSTANCED, and ALL lane markings are BAKED into the
   deck's CanvasTexture (UV-mapped along the ribbon) so painting the centre
   line + dashed dividers + edge/fog lines costs ZERO extra draw calls. A
   whole highway is ~5-6 draw calls: deck, (rumble shoulders share the deck),
   one guardrail InstancedMesh per side, one light-pole InstancedMesh, and —
   if elevated — one pylon InstancedMesh + a couple of ramp wedges.

   Deterministic: no global rng — jitter (if any) comes from opts.rng, the
   caller's seeded fn. Headless-safe: no <canvas> → flat coloured deck.

   TERRAIN-FOLLOWING DECKS (opts.heightAt): optional per-vertex height sample
   fn(x,z)->y (callers pass CBZ.terrainHeight). When supplied, the deck mesh,
   lane paint, curb colliders, guardrail posts and light poles all sample it
   instead of riding one constant deckY — so a long causeway crossing the
   far-backdrop relief (world/terrain.js, non-flat near the map rim) reads as
   grade-following instead of a flat slab floating over/clipping through
   hills. Omit it (default) for byte-identical flat decks; terrainHeight is
   itself exactly 0 over the in-grid mainland's flat contract, so even a
   caller that DOES pass it sees zero change there.

   Returns { group, deckTop(x,z)->y, footprint:{minX,maxX,minZ,maxZ} }.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const _highways = [];
  CBZ.cityHighways = function () { return _highways; };

  const THEME = {
    asphalt:  { deck: "#2a2c32", edge: "#23252a", rumble: 0x3a3d44 },
    concrete: { deck: "#9498a0", edge: "#80848c", rumble: 0xa8acb4 },
    dirt:     { deck: "#6b5a42", edge: "#5a4b37", rumble: 0x7a6850 }
  };

  // ============================================================
  //  CATENARY SOLVER (ported by hand from the dulnan/catenary-curve algorithm
  //  — a small Newton-Raphson root-find, no library needed). A real hanging
  //  cable between two anchors settles into y = a*cosh((x-offsetX)/a) +
  //  offsetY; `a` controls how tight/saggy the curve reads and has NO
  //  closed-form solution from (span, drop, desired sag) alone, so we solve
  //  for it iteratively. WHY here instead of a per-frame physics cable: the
  //  bridge's main cable is static set-dressing — solving once at build time
  //  and baking the sampled curve into a TubeGeometry costs zero runtime,
  //  unlike an actual verlet rope would.
  //
  //  Parameterized by SAG (metres the lowest point of the curve droops below
  //  the straight A→B chord) rather than raw cable length/slack: the original
  //  dulnan algorithm solves from cable length, but that formulation needs
  //  `cableLen - straightDist` (a tiny difference of two near-equal large
  //  numbers for a realistically-taut suspension cable) and loses precision
  //  catastrophically right where suspension bridges actually live — sag
  //  ratios of a few percent. Sag is also the more useful knob for an artist
  //  call-site anyway ("droop 6 metres") and starting Newton-Raphson from the
  //  standard shallow-cable parabolic approximation (a≈dx²/8·sag) converges
  //  in a handful of iterations with no cancellation error.
  //
  //  solveCatenary(dx, dy, sag) -> {a, offsetX, offsetY} describing
  //  y(x) = a*cosh((x-offsetX)/a) + offsetY for x in [0,dx], passing through
  //  (0,0) and (dx,dy), whose lowest point sits `sag` metres below the
  //  straight chord connecting those two endpoints. Never throws: a
  //  degenerate/non-converging input falls back to the parabolic estimate
  //  for `a` rather than propagate a NaN into the caller's geometry.
  // ============================================================
  function solveCatenary(dx, dy, sag) {
    sag = Math.max(0.05, sag);
    if (dx <= 1e-4) return { a: 1e6, offsetX: dx / 2, offsetY: -1e6 };
    // vertex sag relative to the straight chord, for a trial `a` — the exact
    // (non-approximated) quantity Newton-Raphson drives to zero below.
    function vertexSag(a) {
      const half = dx / 2;
      const sh = Math.sinh(half / a) || 1e-12;
      const offX = half - a * Math.asinh(dy / (2 * a * sh));
      const offY = -a * Math.cosh(-offX / a);
      const chordY = dy * (offX / dx);           // straight chord's height at x=offX
      return chordY - (offY + a);                // chord height minus the curve's vertex height
    }
    // shallow-cable parabolic approximation (exact in the small-sag limit) —
    // a well-conditioned starting guess with no large-number cancellation.
    let a = (dx * dx) / (8 * sag);
    for (let i = 0; i < 40; i++) {
      const h = Math.max(a * 1e-4, 1e-6);
      const g = vertexSag(a) - sag;
      const gPrime = (vertexSag(a + h) - sag - g) / h;
      if (!isFinite(g) || Math.abs(gPrime) < 1e-9) break;
      let next = a - g / gPrime;
      if (!isFinite(next) || next <= 0) next = a / 2;    // keep it in-domain
      if (Math.abs(next - a) < 1e-4) { a = next; break; }
      a = next;
    }
    if (!isFinite(a) || a <= 0) a = (dx * dx) / (8 * sag);   // non-convergent — safe fallback
    const half = dx / 2;
    const sh = Math.sinh(half / a) || 1e-12;
    const offX = half - a * Math.asinh(dy / (2 * a * sh));
    const offY = -a * Math.cosh(-offX / a);
    return { a, offsetX: offX, offsetY: offY };
  }
  // sample nPts points along the solved catenary from anchor A to anchor B
  // (world-space, A/B are {x,y,z}); returns an array of THREE.Vector3 in the
  // curve's own local sag plane mapped back into world XYZ. `sag` is metres
  // of droop below the straight A→B chord at the curve's lowest point.
  function catenaryPoints(A, B, sag, nPts) {
    const dx = Math.hypot(B.x - A.x, B.z - A.z);   // horizontal span (XZ plane)
    const dy = B.y - A.y;
    const { a, offsetX, offsetY } = solveCatenary(dx, dy, sag);
    const ux = dx > 1e-6 ? (B.x - A.x) / dx : 0, uz = dx > 1e-6 ? (B.z - A.z) / dx : 0;
    const pts = [];
    for (let i = 0; i <= nPts; i++) {
      const t = i / nPts, x = t * dx;
      const y = a * Math.cosh((x - offsetX) / a) + offsetY;
      pts.push(new THREE.Vector3(A.x + ux * x, A.y + y, A.z + uz * x));
    }
    return pts;
  }

  // seeded LCG for the grain speckle below — FIX: this used to call
  // Math.random() directly, so the asphalt texture's grain pattern differed
  // every reload (determinism contract violation). Seeded per theme deck
  // color so each theme still gets its own fixed, reproducible speckle.
  function grainRng(seedStr) {
    let s = 0;
    for (let i = 0; i < seedStr.length; i++) s = (s * 31 + seedStr.charCodeAt(i)) | 0;
    s = (s ^ 0x9e3779b9) & 0x7fffffff || 0x2f6e2b1;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  // SMALL TILING ASPHALT texture (no baked lane lines). WHY the rewrite: lane
  // lines baked into a 128px-wide canvas and stretched over a 24m × up-to-286m
  // ribbon MIP-COLLAPSED at grazing angle into a broken, shimmering stripe that
  // read as a yellow line FLOATING in the air, over a flat untextured slab. Now
  // the deck is plain tiling tarmac and the markings are crisp merged GEOMETRY
  // just above it (buildLanePaint) — the exact look the good in-city roads use.
  function bakeAsphalt(theme) {
    let cv;
    try { cv = document.createElement("canvas"); } catch (e) { return null; }
    if (!cv || !cv.getContext) return null;
    const S = 64; cv.width = S; cv.height = S;
    const g = cv.getContext("2d"); if (!g) return null;
    g.fillStyle = theme.deck; g.fillRect(0, 0, S, S);
    // faint grain so the tarmac reads as a real surface, not a flat slab
    const rng = grainRng(theme.deck + "|" + theme.edge);
    for (let i = 0; i < 800; i++) {
      const lvl = (rng() - 0.5) * 0.12;
      g.fillStyle = (lvl >= 0 ? "rgba(255,255,255," : "rgba(0,0,0,") + Math.abs(lvl).toFixed(3) + ")";
      g.fillRect((rng() * S) | 0, (rng() * S) | 0, 1, 1);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;     // tiles across AND along
    tex.anisotropy = 4;
    return tex;
  }

  // CRISP LANE PAINT as merged flat geometry coplanar just above the deck. WHY:
  // geometry lines can NEVER mip-collapse into a floating smear the way baked
  // texture lines did. Exactly TWO meshes total (one white, one yellow) no matter
  // how long the road — every dash/line accumulates into shared arrays then builds
  // once (the world.js paintMesh discipline). Lane offsets match the lanes the
  // traffic AI drives (±k·laneW dividers, ±(width/2−0.4) edge lines).
  function buildLanePaint(path, width, lanesPerDir, laneW, deckY, median, heightAt, medianW) {
    const white = [], yellow = [], yOff = 0.015;
    // half-width of the physical median band: every lane offset shifts outward
    // by this, so lane 1 is a full laneW wide instead of being squeezed between
    // the median edge and a divider still sitting at ±1·laneW (the old bug).
    const medHalf = median ? (medianW != null ? medianW : 1.2) / 2 : 0;
    // grade-following: sample the same terrain height the deck used, plus the
    // fixed clearance above it, so painted lines never float off / sink into
    // a sloped deck. Flat callers (heightAt omitted) keep the old constant y.
    const hAt = typeof heightAt === "function"
      ? function (x, z) { return heightAt(x, z) + yOff; }
      : function () { return deckY + yOff; };
    function quad(arr, ax, az, bx, bz, dx, dz, off, hw) {
      const px = -dz, pz = dx, oL = off - hw, oR = off + hw;        // unit perpendicular
      const aLx = ax + px * oL, aLz = az + pz * oL, aRx = ax + px * oR, aRz = az + pz * oR;
      const bLx = bx + px * oL, bLz = bz + pz * oL, bRx = bx + px * oR, bRz = bz + pz * oR;
      const aLy = hAt(aLx, aLz), aRy = hAt(aRx, aRz), bLy = hAt(bLx, bLz), bRy = hAt(bRx, bRz);
      arr.push(aLx, aLy, aLz, aRx, aRy, aRz, bRx, bRy, bRz, aLx, aLy, aLz, bRx, bRy, bRz, bLx, bLy, bLz);
    }
    function solid(arr, off, hw) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1]; let dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1e-3; dx /= L; dz /= L;
        quad(arr, a.x, a.z, b.x, b.z, dx, dz, off, hw);
      }
    }
    function dashed(arr, off, hw) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1]; let dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1e-3; dx /= L; dz /= L;
        for (let t = 0; t + 2.4 <= L; t += 7) quad(arr, a.x + dx * t, a.z + dz * t, a.x + dx * (t + 2.4), a.z + dz * (t + 2.4), dx, dz, off, hw);
      }
    }
    if (median) solid(yellow, 0, medHalf);                            // the median band, full physical width
    else { solid(yellow, -0.26, 0.08); solid(yellow, 0.26, 0.08); }   // double yellow centreline
    for (let s = -1; s <= 1; s += 2) {
      for (let k = 1; k < lanesPerDir; k++) dashed(white, s * (medHalf + k * laneW), 0.07);   // lane dividers
      solid(white, s * (width / 2 - 0.4), 0.08);                                              // edge/fog line
    }
    const out = [];
    function mesh(arr, color) {
      if (!arr.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3));
      // PAINTED, NOT GEOMETRY: polygonOffset pulls the paint toward the camera
      // in DEPTH, so the tiny yOff above is coplanarity insurance, not the thing
      // holding the line off the deck — markings hug the tarmac like paint.
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.matrixAutoUpdate = false; m.receiveShadow = false; m.renderOrder = 1;
      // batch-exempt (non-empty userData): the V2 merge re-materials its buckets
      // with a shared plain material, which would silently DROP polygonOffset +
      // renderOrder; kept live, the paint also culls by its own full-span sphere
      // — always in lockstep with the textured (equally batch-exempt) deck.
      m.userData.roadPaint = true;
      out.push(m);
    }
    mesh(white, 0xeef1f5); mesh(yellow, 0xf2c83a);
    return out;
  }

  // turn the centreline polyline into per-segment quads (a ribbon at y, or
  // grade-following if heightAt is supplied), accumulating positions/uvs into
  // a merged BufferGeometry. UV: u across (0..1), v along (metres → texture
  // repeat handled by tex.repeat).
  //
  // TERRAIN-FOLLOWING DECKS (heightAt): macro highways/causeways crossing the
  // far backdrop relief (world/terrain.js — non-flat near the map rim) used
  // to sit at one CONSTANT y per call, so a long causeway floated above or
  // clipped into the rising ground it crossed. `heightAt(x,z)` is an OPTIONAL
  // per-vertex sampling callback (the caller passes CBZ.terrainHeight, already
  // offset by the caller's deckY so the deck still rides its usual clearance
  // above grade); when present each of the 4 quad corners is displaced to
  // heightAt(x,z) instead of the flat constant `y`. This is purely additive:
  // every existing caller that omits heightAt gets byte-identical flat decks
  // (heightAt defaults to "always return the constant y"), so the in-grid
  // mainland — which is dead flat by contract — is completely unaffected
  // (terrainHeight is itself exactly 0 there, so even a caller that DID pass
  // it would see no change inside the flat region).
  function buildDeck(path, width, y, mat, vRepeatPerM, heightAt) {
    const hAt = typeof heightAt === "function" ? heightAt : function () { return y; };
    const pos = [], uv = [], nrm = [];
    let vAcc = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      let dx = b.x - a.x, dz = b.z - a.z;
      const segLen = Math.hypot(dx, dz) || 1e-3;
      dx /= segLen; dz /= segLen;
      const px = -dz * width / 2, pz = dx * width / 2;   // half-width perpendicular
      const v0 = vAcc, v1 = vAcc + segLen * vRepeatPerM; vAcc = v1;
      // corners: left/right at a and b, each sampled for its own grade height
      const aLx = a.x - px, aLz = a.z - pz, aRx = a.x + px, aRz = a.z + pz;
      const bLx = b.x - px, bLz = b.z - pz, bRx = b.x + px, bRz = b.z + pz;
      const aLy = hAt(aLx, aLz), aRy = hAt(aRx, aRz), bLy = hAt(bLx, bLz), bRy = hAt(bRx, bRz);
      const aL = [aLx, aLy, aLz], aR = [aRx, aRy, aRz];
      const bL = [bLx, bLy, bLz], bR = [bRx, bRy, bRz];
      const quad = [
        [aL, 0, v0], [aR, 1, v0], [bR, 1, v1],
        [aL, 0, v0], [bR, 1, v1], [bL, 0, v1]
      ];
      for (const c of quad) {
        pos.push(c[0][0], c[0][1], c[0][2]);
        nrm.push(0, 1, 0);     // placeholder; recomputed below when grade-following
        uv.push(c[1], c[2]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nrm), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
    if (heightAt) geo.computeVertexNormals();   // grade-following: real per-face slope lighting
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true; m.matrixAutoUpdate = false;
    return { mesh: m, length: vAcc / vRepeatPerM };
  }

  // ============================================================
  //  SUSPENSION-BRIDGE DRESSING (ONE span only — the airport causeway, the
  //  longest water-gap crossing in the city). Purely a VISUAL layer added
  //  ON TOP of the already-built flat deck above: two towers, a sagging main
  //  cable (real catenary curve via solveCatenary/catenaryPoints) rendered as
  //  a TubeGeometry along a CatmullRomCurve3 of sampled points, plus straight
  //  TubeGeometry hanger cables dropping from the main cable down to the deck
  //  at regular intervals. NOTHING here touches deckTop/colliders/city.roads —
  //  a car still drives the identical flat deck buildDeck() laid down earlier;
  //  this only adds geometry above/beside it. Cheap: 2 tower groups (a
  //  handful of merged-scale boxes each), 2 cable tubes (one per side), and
  //  one small InstancedMesh for every hanger — a few draw calls total for
  //  the whole span, not per-hanger meshes.
  // ============================================================
  function buildSuspensionDressing(group, path, width, deckY, gradeAt) {
    if (!THREE.TubeGeometry || !THREE.CatmullRomCurve3) return;   // headless/minimal THREE stub — skip gracefully
    // the span runs along path[0]->path[1] (the fingerprinted call is a
    // straight 2-point causeway); towers stand 1/5 of the way in from each
    // end so the cable's central sag reads clearly over the main gap, with a
    // shorter "back-stay" segment from each tower down to its own deck anchor.
    const a0 = path[0], a1 = path[path.length - 1];
    let dx = a1.x - a0.x, dz = a1.z - a0.z;
    const span = Math.hypot(dx, dz) || 1e-3;
    dx /= span; dz /= span;
    const px = -dz, pz = dx;                    // unit perpendicular (across the deck)
    const towerT = span * 0.18;                 // towers stand 18% of the way in from each end
    const towerY = deckY + 26;                   // tower deck-top height (tall enough to read over the gap)
    const railOff = width / 2 - 1.2;             // cables run just inboard of the guardrail line

    const towerMat = new THREE.MeshLambertMaterial({ color: 0x8b929c });
    const cableMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
    const hangerMat = new THREE.MeshLambertMaterial({ color: 0x3a3e46 });

    function towerAt(t) {
      const bx = a0.x + dx * t, bz = a0.z + dz * t;
      return { x: bx, z: bz, y: gradeAt(bx, bz) };
    }
    const towers = [towerAt(towerT), towerAt(span - towerT)];

    // ---- two A-frame towers straddling the deck (one leg each side + a
    //      crossbeam near the top, like a real suspension tower silhouette) ----
    towers.forEach((tw) => {
      const tg = new THREE.Group();
      tg.position.set(tw.x, tw.y, tw.z);
      const yaw = Math.atan2(dx, dz);
      tg.rotation.y = yaw;
      const legH = towerY - tw.y;
      const legGeo = new THREE.BoxGeometry(1.1, legH, 1.1);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, towerMat);
        leg.position.set(s * railOff, legH / 2, 0);
        leg.castShadow = true;
        tg.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(railOff * 2 + 1.1, 1.0, 1.0), towerMat);
      beam.position.set(0, legH - 3.0, 0);
      tg.add(beam);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(railOff * 2 + 1.4, 0.8, 1.4), towerMat);
      cap.position.set(0, legH + 0.4, 0);
      tg.add(cap);
      group.add(tg);
    });

    // ---- main cable per side: three catenary spans (back-stay/main/back-stay)
    //      strung tower-to-tower over deck anchors, sampled into one smooth
    //      CatmullRomCurve3 per side and extruded as a single TubeGeometry ----
    const hangerSpots = [];   // {x,y,z, hx,hy,hz (deck point)} accumulated across both sides
    [-1, 1].forEach((s) => {
      const offX = px * s * railOff, offZ = pz * s * railOff;
      const anchorA = { x: a0.x + offX, y: gradeAt(a0.x, a0.z) + 1.2, z: a0.z + offZ };
      const tA = { x: towers[0].x + offX, y: towerY, z: towers[0].z + offZ };
      const tB = { x: towers[1].x + offX, y: towerY, z: towers[1].z + offZ };
      const anchorB = { x: a1.x + offX, y: gradeAt(a1.x, a1.z) + 1.2, z: a1.z + offZ };

      // sample each of the 3 sub-spans with its own catenary SAG in metres
      // (Newton-solved `a` per span — a real hanging cable, not a hand-tuned
      // bezier), stitched into one point list for the smooth CatmullRomCurve3
      // below. A real suspension bridge's main cable sags gently (roughly
      // span/9..span/11 — the classic engineering ratio) while the back-stay
      // from tower down to the low deck anchor is short and much straighter.
      const mainSag = Math.hypot(tB.x - tA.x, tB.z - tA.z) / 10;
      const backSag = Math.max(0.3, Math.hypot(tA.x - anchorA.x, tA.z - anchorA.z) / 30);
      const segPts = [];
      [[anchorA, tA, backSag], [tA, tB, mainSag], [tB, anchorB, backSag]].forEach(([A, B, sag], si) => {
        const pts = catenaryPoints(A, B, sag, 14);
        for (let i = si === 0 ? 0 : 1; i < pts.length; i++) segPts.push(pts[i]);   // skip dup joint point
      });
      const curve = new THREE.CatmullRomCurve3(segPts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.22, 6, false), cableMat);
      tube.castShadow = false;
      group.add(tube);

      // ---- hangers: vertical drops from the MAIN span (tA..tB, the sagging
      //      part) down to the existing deck, every ~10m. Sampled straight off
      //      the same segPts (the main-span slice) rather than re-solving. ----
      const mainSpan = catenaryPoints(tA, tB, mainSag, 20);
      for (let i = 1; i < mainSpan.length - 1; i += 2) {   // every other sample ≈ 10 spots
        const p = mainSpan[i];
        const deckY2 = gradeAt(p.x, p.z);
        if (p.y - deckY2 < 1.0) continue;   // near the towers the cable is nearly AT deck height — skip degenerate hangers
        hangerSpots.push({ x: p.x, y: p.y, z: p.z, dy: deckY2 + 0.3 });
      }
    });

    // one InstancedMesh for every hanger cable (thin vertical tube, scaled per
    // instance to its own drop length) — a single draw call no matter how many
    // hangers the span has.
    if (hangerSpots.length) {
      const hangGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 5);
      const him = new THREE.InstancedMesh(hangGeo, hangerMat, hangerSpots.length);
      const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q0 = new THREE.Quaternion(), scl = new THREE.Vector3();
      hangerSpots.forEach((hs, i) => {
        const drop = Math.max(0.1, hs.y - hs.dy);
        pos.set(hs.x, (hs.y + hs.dy) / 2, hs.z);
        scl.set(1, drop, 1);
        m4.compose(pos, q0, scl);
        him.setMatrixAt(i, m4);
      });
      him.instanceMatrix.needsUpdate = true; him.castShadow = false;
      group.add(him);
    }
  }

  CBZ.buildHighway = function (root, opts) {
    opts = opts || {};
    // Resolve this before any optional visual branch.  The old declaration
    // lived beside the guardrail code, so removing those rails could leave a
    // cached buildHighway revision with HWY-3 still referencing a variable
    // that no longer existed.  Keep road publication independent of scenery.
    const cityRoads = opts.cityRoads || (CBZ.city && CBZ.city.roads) || null;
    const path = (opts.path && opts.path.length >= 2) ? opts.path : [{ x: 0, z: 0 }, { x: 0, z: 100 }];
    const width = opts.width != null ? opts.width : 24;
    // ROADS_V2 (owner: "never many lanes or wide highways"): a paved highway
    // defaults to a REAL 3+3 cross-section with a hard median — 6×3.6m lanes +
    // 1.2m median + 0.4m edge margins = 23.2m, inside the 24m deck with a 0.4m
    // shoulder per side. Dirt tracks keep 2 lanes and get NO paint (below).
    const V2 = !CBZ.CONFIG || CBZ.CONFIG.ROADS_V2 !== false;
    const isDirt = opts.theme === "dirt";
    const lanesPerDir = Math.max(1, (opts.lanesPerDir != null ? opts.lanesPerDir
      : (V2 && !isDirt && width >= 23) ? 3 : 2) | 0);
    const laneW = opts.laneW != null ? opts.laneW : 3.6;
    const elevated = !!opts.elevated;
    const theme = THEME[opts.theme] || THEME.asphalt;
    const median = opts.median != null ? !!opts.median : (V2 && !isDirt && lanesPerDir >= 3);
    const medianW = opts.medianW != null ? opts.medianW : 1.2;
    // dirt tracks have no painted markings — a yellow centreline on a dirt
    // causeway was one of the "same look, dup code" offenders.
    const markings = opts.markings != null ? !!opts.markings : !isDirt;
    // NOTE: opts.rng (the caller's seeded fn) is accepted for API compat /
    // future jitter use, but nothing in this function currently consumes it
    // — removed the old `|| Math.random` fallback (dead code that was also
    // a determinism-contract violation) rather than leave an unused random
    // source lying around.
    // Every ribbon gets a tiny deterministic render layer.  Separate road
    // builders frequently meet or cross at the exact same elevation; putting
    // two coplanar quads there made the dirt roads flash and look like one road
    // was carelessly pasted over another.  The sub-centimetre layer is far
    // below suspension/vehicle tolerances, but gives the depth buffer one
    // unambiguous winner at junctions.
    const deckLayer = elevated ? 0 : ((_highways.length % 8) * 0.0008);
    const deckY = (elevated ? 2.5 : 0.05) + deckLayer;

    // ---- TERRAIN-FOLLOWING GRADE (optional): long causeways cross genuinely
    //      non-flat world/terrain.js relief near the map rim. opts.heightAt
    //      (callers pass CBZ.terrainHeight) lets the deck ride that grade
    //      instead of sitting at one constant y. Over the flat in-grid
    //      mainland terrainHeight is EXACTLY 0 (terrain.js's contract), so
    //      gradeAt collapses to the same constant deckY there — zero change
    //      to anything load-bearing for collision/AI/placement. Omitted
    //      entirely (the default), every existing caller is byte-identical.
    const heightAt = typeof opts.heightAt === "function"
      ? function (x, z) { return opts.heightAt(x, z) + deckY; }
      : null;

    const group = new THREE.Group();
    (root || CBZ.scene).add(group);

    // total length (for texture detail + light/pylon spacing)
    let totLen = 0;
    for (let i = 0; i < path.length - 1; i++) totLen += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);

    // ---- deck ribbon: plain TILING tarmac + crisp GEOMETRY lane paint above it
    //      (was a stretched baked-line canvas → the floating-yellow-line bug) ----
    const tex = bakeAsphalt(theme);
    let deckMat;
    if (tex) { tex.repeat.set(width / 8, 1); deckMat = new THREE.MeshLambertMaterial({ map: tex }); }
    else deckMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.deck) });
    const vRepeatPerM = tex ? (1 / 8) : 0.0625;        // tile every ~8m along (U tiles via tex.repeat.x)
    const deck = buildDeck(path, width, deckY, deckMat, vRepeatPerM, heightAt);
    group.add(deck.mesh);
    if (markings) {
      const lanePaint = buildLanePaint(path, width, lanesPerDir, laneW, deckY, median, heightAt, medianW);
      for (let i = 0; i < lanePaint.length; i++) group.add(lanePaint[i]);
    }
    // per-point grade sample used by every prop below (colliders/rails/poles/
    // pylons/ramps) so the WHOLE highway — not just the deck mesh — rises and
    // falls together; flat callers (heightAt null) get the old constant deckY.
    function gradeAt(x, z) { return heightAt ? heightAt(x, z) : deckY; }

    // footprint (axis-aligned bounds over all corners)
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of path) {
      minX = Math.min(minX, p.x - width / 2); maxX = Math.max(maxX, p.x + width / 2);
      minZ = Math.min(minZ, p.z - width / 2); maxZ = Math.max(maxZ, p.z + width / 2);
    }

    // helper: walk the polyline at ~`spacing` metres, calling fn(x,z,dx,dz)
    function alongPath(spacing, fn) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        let dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1e-3; dx /= L; dz /= L;
        const n = Math.max(1, Math.floor(L / spacing));
        for (let k = 0; k <= n; k++) {
          if (i > 0 && k === 0) continue;   // skip shared joints
          const t = (k / n) * L;
          fn(a.x + dx * t, a.z + dz * t, dx, dz);
        }
      }
    }

    // Open-road contract: no edge rails and, crucially, no invisible curb
    // collider bands.  Those bands turned every dirt track and causeway into a
    // chute that vehicles and mounted animals could not leave.  A visible
    // bridge tower/cable may still dress a true suspension span below, but the
    // drivable road surface itself is completely open on both sides.
    // HWY-3 below still publishes each visible ribbon as a road traffic can
    // actually drive; its registry was resolved at function entry so it never
    // depends on optional scenery branches.

    // ---- ONE InstancedMesh light poles (~40m), emissive head ----
    // HWY_LAMPS default OFF (owner: "dumb useless props like streetlights on
    // the highway and bridges" — 62 deck lamps audited). Real highways here
    // run unlit; the old poles come back only if the flag is flipped true.
    if (opts.lights && CBZ.CONFIG && CBZ.CONFIG.HWY_LAMPS === true) {
      const hw = width / 2 - 0.6, poles = [];
      let toggle = 0;
      alongPath(40, (x, z, dx, dz) => {
        const px = -dz, pz = dx, side = (toggle++ % 2 === 0) ? 1 : -1;   // alternate sides
        poles.push({ x: x + side * px * hw, z: z + side * pz * hw });
      });
      if (poles.length) {
        const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
        const poleMat = new THREE.MeshLambertMaterial({ color: 0x4b5158 });
        const pim = new THREE.InstancedMesh(poleGeo, poleMat, poles.length);
        const headGeo = new THREE.BoxGeometry(0.5, 0.25, 1.0);
        const headMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
        const him = new THREE.InstancedMesh(headGeo, headMat, poles.length);
        const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), q0 = new THREE.Quaternion();
        poles.forEach((s, i) => {
          const gy = gradeAt(s.x, s.z);
          p.set(s.x, gy + 3.5, s.z); m4.compose(p, q0, one); pim.setMatrixAt(i, m4);
          p.set(s.x, gy + 7, s.z); m4.compose(p, q0, one); him.setMatrixAt(i, m4);
        });
        pim.instanceMatrix.needsUpdate = true; him.instanceMatrix.needsUpdate = true;
        pim.castShadow = false; him.castShadow = false;
        group.add(pim); group.add(him);
      }
    }

    // ---- elevated: ONE InstancedMesh tapered pylons (~24m) + end ramp wedges ----
    if (elevated) {
      const pylonsAt = [];
      alongPath(24, (x, z) => pylonsAt.push({ x, z }));
      if (pylonsAt.length) {
        const pyGeo = new THREE.CylinderGeometry(0.9, 1.4, deckY, 8);
        const pyMat = new THREE.MeshLambertMaterial({ color: 0x8b9097 });
        const pim = new THREE.InstancedMesh(pyGeo, pyMat, pylonsAt.length);
        const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q0 = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
        pylonsAt.forEach((s, i) => { p.set(s.x, deckY / 2, s.z); m4.compose(p, q0, one); pim.setMatrixAt(i, m4); });
        pim.instanceMatrix.needsUpdate = true; pim.castShadow = false;
        group.add(pim);
      }
      // simple ramp wedge at each end down to grade (one mesh each).
      // FIX (dormant branch — every current caller passes elevated:false): the
      // old code left rotation.z = 0 at the deck-height centre, so the "ramp"
      // was a FLAT plane floating at deckY/2. Real math: yaw to the heading
      // first (YXZ order), then pitch about the yawed X axis by
      // atan2(deckY, rampLen); the plane's length is the true hypotenuse, so
      // its high edge meets the deck at exactly deckY and its low edge lands
      // exactly on grade rampLen out along the heading.
      const rampMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.deck) });
      [[path[0], path[1]], [path[path.length - 1], path[path.length - 2]]].forEach(([end, prev]) => {
        let dx = end.x - prev.x, dz = end.z - prev.z;
        const L = Math.hypot(dx, dz) || 1e-3; dx /= L; dz /= L;
        const rampLen = 14;
        const slope = Math.atan2(deckY, rampLen);
        const geo = new THREE.PlaneGeometry(width, Math.hypot(rampLen, deckY));
        const ramp = new THREE.Mesh(geo, rampMat);
        const h = Math.atan2(dx, dz);
        ramp.rotation.order = "YXZ";
        ramp.rotation.y = h;
        ramp.rotation.x = -Math.PI / 2 + slope;   // lie flat, then tilt down toward grade
        ramp.position.set(end.x + dx * rampLen / 2, deckY / 2, end.z + dz * rampLen / 2);
        ramp.receiveShadow = true; group.add(ramp);
      });
    }

    // ---- SUSPENSION-BRIDGE VISUAL UPGRADE (ONE span only): the airport
    //      causeway (mainland ↔ airport island, straight 2-point path over
    //      water at x≈0, z -566..-280) is the longest, most visually
    //      prominent gap any highway crosses — a flat deck floating over open
    //      water reads as unfinished. Fingerprinted (not opt-in'd through the
    //      caller, since island_airport.js is out of this task's file list)
    //      by matching this exact call's geometry: a straight, non-elevated,
    //      width-24 span whose length lands in the causeway's known ~286m
    //      range. Any OTHER buildHighway call (every biome/other island
    //      causeway, the desert arterial, etc.) simply doesn't match and is
    //      byte-identical to before — this never rewrites the deck/collision
    //      machinery above, only adds cable/tower dressing over it.
    // Explicit opts flag takes priority over the geometry fingerprint below —
    // island_airport.js (or any future causeway caller) is out of this task's
    // file list, so it can't be edited to pass this, but ANY caller that
    // already has (or later gains) the opts object can just say
    // `suspensionBridge: true/false` and skip the guesswork entirely.
    // FP = the tolerant fingerprint, overridable in one place via
    // CBZ.CONFIG.BRIDGE_FINGERPRINT so future drift (a re-tuned causeway
    // length/width) doesn't require touching this file blind.
    const FP = Object.assign({
      width: 24, widthTol: 0.01, lenMin: 280, lenMax: 292,
      // wider band used only to detect a "near miss" worth warning about —
      // catches e.g. a causeway nudged to len 295 or width 22 that would
      // otherwise silently stop getting its bridge dressing.
      nearWidthTol: 2, nearLenMin: 250, nearLenMax: 320,
    }, (CBZ.CONFIG && CBZ.CONFIG.BRIDGE_FINGERPRINT) || {});
    const straight2pt = !elevated && path.length === 2 && Math.abs(path[0].x - path[1].x) < 0.5;
    const fpMatch = straight2pt && Math.abs(width - FP.width) < FP.widthTol &&
      totLen > FP.lenMin && totLen < FP.lenMax;
    const wantBridge = opts.suspensionBridge != null ? !!opts.suspensionBridge : fpMatch;
    if (wantBridge) {
      try { buildSuspensionDressing(group, path, width, deckY, gradeAt); }
      catch (e) { /* pure visual dressing — never sink the highway build over it */ }
    } else if (opts.suspensionBridge == null && straight2pt &&
        Math.abs(width - FP.width) < FP.nearWidthTol &&
        totLen > FP.nearLenMin && totLen < FP.nearLenMax) {
      // near-miss: looks like it WANTS to be the dressed causeway (close width,
      // plausible length) but fails the tight fingerprint — flag it loudly so
      // drift in a caller we don't own doesn't silently drop the bridge visual.
      console.warn("[highways] suspension-bridge fingerprint near-miss (width=" + width +
        ", len=" + totLen.toFixed(1) + ") — no dressing built. Pass opts.suspensionBridge " +
        "or tune CBZ.CONFIG.BRIDGE_FINGERPRINT if this span should get it.");
    }

    // ---- HWY-3: REGISTER DRIVABLE ROAD SEGMENTS (the WHY: a highway you can
    //      SEE but cars never use is dead scenery — register each axis-aligned
    //      leg as a drivable centre-line so vehicles.js findRoad snaps onto it
    //      and traffic.js recycles cars onto it, exactly like the in-grid roads
    //      and the island causeways the callers already hand-push). Same record
    //      shape {x,z,vertical,len,district} those consumers read. Idempotent:
    //      skip a leg if an identical (x,z,vertical) segment already exists, so
    //      a caller that still pushes its own (until HWY-7 retires those) never
    //      ends up with double segments. Pure data — no extra draw calls. -------
    const builtRoads = [];
    if (opts.registerRoads !== false && cityRoads) {
      const roads = cityRoads;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const ax = a.x, az = a.z, bx = b.x, bz = b.z;
        const adx = Math.abs(bx - ax), adz = Math.abs(bz - az);
        if (adx < 0.5 && adz < 0.5) continue;             // degenerate joint
        let seg;
        if (adx > adz) seg = { x: (ax + bx) / 2, z: az, vertical: false, len: adx, district: "highway" };
        else seg = { x: ax, z: (az + bz) / 2, vertical: true, len: adz, district: "highway" };
        // ROADS_V2 lane data: every consumer (traffic lane-keeping, prop
        // placement, CBZ.roadLanes) can read the REAL cross-section instead
        // of assuming the city-grid default.
        seg.w = width; seg.lanesPerDir = lanesPerDir; seg.laneW = laneW;
        if (median) { seg.median = true; seg.medianW = medianW; }
        // dedupe against any existing identical centre-line (caller push or a
        // prior buildHighway over the same axis) — match by axis + the two
        // coords within a tight tolerance so we never carpet city.roads.
        let dup = false;
        for (let k = 0; k < roads.length; k++) {
          const r = roads[k];
          if (!!r.vertical !== !!seg.vertical) continue;
          if (Math.abs(r.x - seg.x) < 1.0 && Math.abs(r.z - seg.z) < 1.0) { dup = true; break; }
        }
        if (dup) continue;
        roads.push(seg);
        builtRoads.push(seg);
      }
    }

    const rec = {
      group,
      deckTop: function (x, z) { return gradeAt(x, z); },  // grade-following if heightAt was supplied, else constant deckY
      footprint: { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ },
      length: totLen, deckY: deckY, width: width,
      roads: builtRoads                                  // HWY-3: the drivable segs this highway registered
    };
    _highways.push(rec);
    return rec;
  };

  // ---- HWY-4: CAUSEWAY → GRID CONNECTORS (pure road DATA, no geometry — the
  //      seawall gates + causeway decks already exist in world.js). The WHY: a
  //      car on a grid avenue reaching the map edge needs ONE overlapping road
  //      segment that bridges the grid intersection and the causeway mouth so
  //      vehicles.js findRoad (9m snap tolerance) can turn the car NORTH onto the
  //      causeway instead of dead-ending at the seawall. Each connector is a
  //      single short segment laid EXACTLY on an existing grid line (so the snap
  //      lands) that overlaps both the grid edge and the first causeway segment.
  //      Registered via the same HWY-3 city.roads path; idempotent by coord.
  function pushConnector(roads, seg) {
    if (!roads) return false;
    for (let k = 0; k < roads.length; k++) {
      const r = roads[k];
      if (!!r.vertical !== !!seg.vertical) continue;
      if (Math.abs(r.x - seg.x) < 1.0 && Math.abs(r.z - seg.z) < 1.0) return false;   // already connected
    }
    seg.district = seg.district || "highway";
    roads.push(seg);
    return true;
  }
  CBZ.buildHighwayConnector = function (opts, roads) {
    opts = opts || {};
    roads = roads || (CBZ.city && CBZ.city.roads);
    if (!roads) return false;
    // {x,z,vertical,len} describing the short overlap segment; defaults give the
    // airport causeway connector (x=0 avenue → causeway start at z≈-558).
    const seg = {
      x: opts.x != null ? opts.x : 0,
      z: opts.z != null ? opts.z : -558,
      vertical: opts.vertical != null ? !!opts.vertical : true,
      len: opts.len != null ? opts.len : 24,
      district: "highway",
      // carry the causeway cross-section onto the join segment so every lane-
      // aware consumer (props clearance, roadLanes, world-audit) reads a real
      // width here too — a connector overlaps a 24m 3+3 causeway.
      w: opts.w != null ? opts.w : 24,
      lanesPerDir: opts.lanesPerDir != null ? opts.lanesPerDir : 3,
      laneW: opts.laneW != null ? opts.laneW : 3.6,
      median: opts.median != null ? !!opts.median : true,
      medianW: opts.medianW != null ? opts.medianW : 1.2,
    };
    return pushConnector(roads, seg);
  };

  // ---- HWY-4 connector registrar. The world tail runs this after every
  //      landmass/causeway is built so the short, data-only joins enter
  //      city.roads for HWY-3/traffic. It operates on the LIVE city descriptor
  //      passed in (city.roads), robust during the build phase where CBZ.city
  //      may not be wired yet. ------------------------------------------------
  CBZ.buildArterials = function (city) {
    city = city || CBZ.city;
    const roads = city && city.roads;
    if (!roads) return;

    // HWY-4: the causeway mouths that meet the CITY GRID (coords VERIFIED against
    // config CITY center 0,-700, block 34 + road 16 → step 50, grid lines
    // xLines[-150..150 step 50], zLines[-850..-550 step 50]). Each connector is
    // ONE short segment laid EXACTLY on an existing grid line that OVERLAPS both
    // the grid edge and the causeway's first registered segment, so vehicles.js
    // findRoad (9m snap) can turn a car off the grid onto the causeway.
    //   • airport : causeway x=0 (avenue xLines[3]), z=-566..-280. Grid north
    //     cross-street is z=-550. Connector at x=0 spans z=-546..-570 → bridges
    //     the grid (z≈-550) to the causeway south end (z=-566).
    //   • military: causeway z=-700 (cross-street zLines[3]), x=-380..-133. Grid
    //     west avenue is x=-150. Connector at z=-700 spans x=-129..-153 → bridges
    //     the grid (x≈-150) to the causeway east end (x=-133).
    // (Speedway/other islands reached by their OWN bridges — already internally
    //  connected at their L-corner — are out of this connector's scope.)
    CBZ.buildHighwayConnector({ x: 0, z: -558, vertical: true, len: 24, w: 24, district: "highway" }, roads);            // airport
    CBZ.buildHighwayConnector({ x: -141, z: -700, vertical: false, len: 24, w: 24, district: "highway" }, roads);        // military

    // The desert is already connected by real, authored infrastructure:
    // city bridge -> commerce annex -> Diamond Speedway causeway -> Saltlands
    // causeway. The former direct L-shaped arterial duplicated the bridge deck,
    // cut through the annex, and then projected a bright centreline into open
    // space at its turn. Leave the existing connected roads as the sole owner
    // of that route instead of drawing a second, overlapping highway.
  };

  // SELF-REGISTER the connector registrar as a late landmass builder so it runs
  // in cityWorldGeo AFTER every island/biome causeway has pushed its own road
  // segments (default order 50 -> we use 90). This is the safe world-tail hook
  // without touching world.js. Headless-safe when worldmap.js is absent.
  if (CBZ.addLandmass) {
    CBZ.addLandmass(function (city) {
      try { CBZ.buildArterials(city); } catch (e) { /* never break the world build */ }
    }, 90);
  }
})();
