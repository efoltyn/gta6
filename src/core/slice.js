/* ============================================================
   core/slice.js — CITY SLICES: boot one piece of Gang City as its own world.

   Owner, 2026-09-29: "you know how the jail game is so fast to run: find a
   way to break up the Gang City into jail-game-sized pieces that run fast."

   The prison boots in a few seconds because it IS a few hectares. Gang City
   is a continent. A slice is a circle of it (a named place or x,z,r) booted
   as the whole world:

     index.html?mode=city&slice=gangcity-downtown
     index.html?mode=city&slice=-2900,3050,450        (x, z, radius in metres)
     index.html?mode=city&slice=estate&sliceView=900  (override the view band)

   WHAT IS BUILT. Everything that can be SEEN from inside the circle, and
   nothing else. "Seen" is not a guess: city geometry fogs out completely at
   CBZ.cityFogFar (the quality tier's fog, 760 m at tier 2), so from any spot
   inside the slice an ordinary object further than r + fogFar is a pixel of
   pure fog colour. That band is the KEEP circle (keepR). Inside it every
   builder, lot, prop, tree, ped and car is the real one, same code, same
   look. Outside it only what outlives the fog is kept: the ground plate and
   terrain (they fog at 0.08-0.12x, the horizon), the sea, the mountains and
   the metro's far HLOD tiles, which already exist for exactly this.

   HOW:
     • city/worldmap.js skips a landmass builder whose recorded footprint
       (src/city/slice_manifest.js, measured by tools/city-slice-trace.mjs)
       misses the keep circle, and REPLAYS the plain data it registers
       (regions, roads, water bodies, no-spawn zones, biome blends), so the
       continent, the map and the coastline are byte-for-byte the full city's.
       Builders that own terrain (a ground-height oracle or a far-fogged
       surface) always run: the horizon has to stay real.
     • city/mode.js prunes whatever else was built outside the keep circle
       (CBZ.slicePrune) before the batch pass: meshes, colliders, platforms.
     • traffic spawns inside the slice; downtown peds and crowd only spawn
       when the slice holds downtown; the player starts at the slice centre.

   No slice in the URL = every helper answers "keep" and nothing changes.
   This file loads right after config.js; it touches nothing at load.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});

  /* THE NAMED SLICES. Coordinates are read off the live world (seed 90210):
     the city rect, govcomplex's sites, metro plans, registered regions.
     r is the PLAYABLE circle; the keep band is added on top. */
  const SLICES = {
    "gangcity-downtown": { x: 0, z: -700, r: 260, label: "Gang City downtown (the 330 m core grid)" },
    "harbor": { x: 250, z: -700, r: 220, label: "East harbour + marina off downtown" },
    "kingsport-downtown": { x: -2900, z: 3050, r: 450, label: "Kingsport CBD (metro towers, central park edge)" },
    "kingsport": { x: -2780, z: 2800, r: 1300, label: "Kingsport metro core (about half the metro)" },
    "karvel": { x: 5000, z: -1500, r: 450, label: "Karvel city centre (the monument square)" },
    "estate": { x: -2175, z: -4416, r: 260, label: "The Executive Mansion (presidential estate)" },
    "capitol": { x: 2306, z: -4461, r: 260, label: "The Capitol" },
    "redhollow": { x: -1460, z: -2250, r: 550, label: "Redhollow Woods" },
    "fort-brandt": { x: -1520, z: -1180, r: 300, label: "Fort Brandt military base" },
    "goldspire": { x: 150, z: 1370, r: 300, label: "Goldspire" },
    "cape-harbor": { x: 610, z: 995, r: 300, label: "Cape Harbor town" },
    "neon-reef": { x: -2110, z: -260, r: 260, label: "Neon Reef" },
    "saltlands": { x: 3900, z: 2000, r: 600, label: "The Saltlands desert" },
    "mercy": { x: 350, z: -3850, r: 500, label: "Mount Mercy" },
  };
  CBZ.SLICES = SLICES;

  function parse(str) {
    if (!str) return null;
    str = String(str).trim();
    if (SLICES[str]) { const s = SLICES[str]; return { name: str, x: s.x, z: s.z, r: s.r, label: s.label }; }
    const m = str.split(",").map(Number);
    if (m.length === 3 && m.every(Number.isFinite) && m[2] > 0) return { name: "xyr", x: m[0], z: m[1], r: m[2], label: "x " + m[0] + ", z " + m[1] + ", r " + m[2] };
    console.warn("[slice] unknown slice '" + str + "' — booting the whole city. Known: " + Object.keys(SLICES).join(", ") + " or x,z,r");
    return null;
  }
  CBZ.sliceParse = parse;

  let q = null;
  try { q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null; } catch (e) { q = null; }
  const S = q ? parse(q.get("slice")) : null;
  const viewArg = q && q.get("sliceView") != null ? +q.get("sliceView") : NaN;
  CBZ.SLICE_TRACE = !!(q && q.get("sliceTrace"));

  if (S) {
    /* THE VIEW BAND. City fog completes at CBZ.cityFogFar (quality.js); an
       object past r + fogFar can never be a visible pixel from inside the
       circle. Read live (the tier is picked before the city builds), with a
       60 m margin for the fog's own soft edge and the camera boom. */
    S.view = function () {
      if (Number.isFinite(viewArg) && viewArg >= 0) return viewArg;
      return Math.max(380, +CBZ.cityFogFar || 760) + 60;
    };
    S.keepR = function () { return S.r + S.view(); };
    CBZ.slice = S;
    // the whole-city page title stays; the loading card says what is coming
    CBZ.SLICE_LABEL = S.label;
  } else {
    CBZ.slice = null;
  }

  /* ---- the questions every consumer asks. All answer "keep" with no slice. */
  // does the axis-aligned rect touch the KEEP circle (what may be seen)?
  CBZ.sliceKeepsRect = function (minX, maxX, minZ, maxZ, pad) {
    const s = CBZ.slice; if (!s) return true;
    const R = s.keepR() + (pad || 0);
    const cx = Math.max(minX, Math.min(s.x, maxX)), cz = Math.max(minZ, Math.min(s.z, maxZ));
    return (cx - s.x) * (cx - s.x) + (cz - s.z) * (cz - s.z) <= R * R;
  };
  // does a circle (x, z, radius) touch the KEEP circle?
  CBZ.sliceKeeps = function (x, z, rad) {
    const s = CBZ.slice; if (!s) return true;
    const R = s.keepR() + (rad || 0);
    return (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) <= R * R;
  };
  // is the point inside the PLAYABLE circle (where actors spawn)?
  CBZ.sliceHolds = function (x, z, pad) {
    const s = CBZ.slice; if (!s) return true;
    const R = s.r + (pad || 0);
    return (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) <= R * R;
  };

  /* ---- THE PRUNE (city/mode.js, after buildCity, before the batch pass) ----
     Whatever a builder that DID run (a world-wide one: highways, road rules,
     the downtown grid for a far slice) drew outside the keep circle goes.
     Walks top-down: a subtree entirely outside is detached whole; one that
     straddles the edge is opened and its children judged one by one. Never
     removed: terrain and far-fogged surfaces (the horizon), the metro's far
     HLOD, anything world-scale (the sea), anything dynamic. Colliders and
     platforms the city build added outside the circle go with it, so the
     physics broadphase is jail-sized too. */
  function isHorizon(o) {
    const u = o.userData || {};
    if (u.worldSurface || u.terrain || u.metroFar || u.farLod != null || u.dynamic) return true;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    return !!(m && (m.isShaderMaterial || (m.userData && m.userData._cbzFogScaled)));
  }
  CBZ.slicePrune = function (root, colStart, platStart) {
    const s = CBZ.slice; if (!s || !root || !window.THREE) return null;
    const THREE = window.THREE;
    const R = s.keepR();
    const box = new THREE.Box3(), gb = new THREE.Box3(), v = new THREE.Vector3(), m4 = new THREE.Matrix4();
    const stats = { removed: 0, kept: 0, opened: 0, instTrimmed: 0, colliders: 0, platforms: 0 };
    // NOT updateMatrixWorld: core/matrixskip.js makes it return early for a
    // hidden node, and the city root is hidden while it builds, so every
    // matrixWorld stayed identity and the prune judged each building by its
    // LOCAL bounds (all near the origin): the downtown streets were parked
    // as "725 m away" (the same trap core/batch.js documents).
    root.updateWorldMatrix(true, true);
    // world bounds of a subtree; null if it holds horizon (never removed whole)
    function boundsOf(o) {
      let horizon = false;
      box.makeEmpty();
      o.traverse(function (c) {
        if (horizon) return;
        if (isHorizon(c)) { horizon = true; return; }
        const g = c.geometry;
        if (!g || !(c.isMesh || c.isLine || c.isPoints)) return;
        if (!g.boundingBox) { try { g.computeBoundingBox(); } catch (e) { return; } }
        if (!g.boundingBox || g.boundingBox.isEmpty()) return;
        if (c.isInstancedMesh) {
          const r = g.boundingBox.min.distanceTo(g.boundingBox.max) / 2;
          for (let i = 0; i < c.count; i++) {
            c.getMatrixAt(i, m4); v.setFromMatrixPosition(m4).applyMatrix4(c.matrixWorld);
            box.expandByPoint(v.set(v.x - r, v.y, v.z - r)); box.expandByPoint(v.set(v.x + 2 * r, v.y, v.z + 2 * r));
          }
          return;
        }
        gb.copy(g.boundingBox).applyMatrix4(c.matrixWorld);
        box.union(gb);
      });
      return horizon ? null : box;
    }
    function outside(b) {
      const cx = Math.max(b.min.x, Math.min(s.x, b.max.x)), cz = Math.max(b.min.z, Math.min(s.z, b.max.z));
      return (cx - s.x) * (cx - s.x) + (cz - s.z) * (cz - s.z) > R * R;
    }
    function inside(b) {
      const dx = Math.max(Math.abs(b.min.x - s.x), Math.abs(b.max.x - s.x));
      const dz = Math.max(Math.abs(b.min.z - s.z), Math.abs(b.max.z - s.z));
      return dx * dx + dz * dz <= R * R;
    }
    function judge(o, depth) {
      const b = boundsOf(o);
      if (b && b.isEmpty()) { stats.kept++; return; }
      if (b && outside(b)) {
        const parent = o.parent;
        parent.remove(o); stats.removed++; prunedTops.add(o);
        if (s.stream && CBZ.streamParkPruned) CBZ.streamParkPruned(o, parent, b.clone(), null, null);
        return;
      }
      if (b && inside(b)) { stats.kept++; return; }
      // straddles the edge, or holds horizon somewhere inside: open it
      if (o.children && o.children.length && depth < 6) {
        stats.opened++;
        const kids = o.children.slice();
        for (const k of kids) judge(k, depth + 1);
        return;
      }
      stats.kept++;
    }
    const prunedTops = new Set();
    const kids = root.children.slice();
    for (const k of kids) judge(k, 0);
    // LOS blockers that went with a pruned subtree leave the list too: a
    // detached wall still in CBZ.losBlockers kept its whole building alive
    // through its parent chain (measured: 8.5k of the estate slice's 9.7k
    // blockers, ~100 MB of heap) and still blocked sight where nothing stands.
    // Streamed, each goes with its parked job and returns when it does.
    stats.los = CBZ.sliceDropDetachedLos(root, prunedTops);

    const keepRect = function (c) {
      if (!c || c.minX == null) return true;
      return CBZ.sliceKeepsRect(c.minX, c.maxX, c.minZ, c.maxZ);
    };
    // streamed: what leaves the broadphase is parked per 400 m cell and
    // comes back when the player does (core/citystream.js)
    const cells = s.stream ? new Map() : null;
    const bucket = function (c, kind) {
      if (!cells) return;
      const kx = Math.floor((c.minX + c.maxX) / 800), kz = Math.floor((c.minZ + c.maxZ) / 800);
      const k = kx + "," + kz;
      let e = cells.get(k);
      if (!e) cells.set(k, e = { rect: { minX: kx * 400, maxX: kx * 400 + 400, minZ: kz * 400, maxZ: kz * 400 + 400 }, cols: [], plats: [] });
      e[kind].push(c);
      e.rect.minX = Math.min(e.rect.minX, c.minX); e.rect.maxX = Math.max(e.rect.maxX, c.maxX);
      e.rect.minZ = Math.min(e.rect.minZ, c.minZ); e.rect.maxZ = Math.max(e.rect.maxZ, c.maxZ);
    };
    const cols = CBZ.colliders;
    if (cols && colStart != null && colStart < cols.length) {
      let w = colStart;
      for (let i = colStart; i < cols.length; i++) { const c = cols[i]; if (keepRect(c)) cols[w++] = c; else { stats.colliders++; bucket(c, "cols"); } }
      cols.length = w;
    }
    const pl = CBZ.platforms;
    if (pl && platStart != null && platStart < pl.length) {
      let w = platStart;
      for (let i = platStart; i < pl.length; i++) { const p = pl[i]; if (keepRect(p)) pl[w++] = p; else { stats.platforms++; bucket(p, "plats"); } }
      pl.length = w;
    }
    if (cells && CBZ.streamParkColliders) for (const e of cells.values()) CBZ.streamParkColliders(e.rect, e.cols, e.plats);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    CBZ.slicePruneResult = stats;
    return stats;
  };

  // the top of o's detached subtree, or null when o is in the scene
  function detachedTop(o, root) {
    let p = o, top = o;
    while (p) { if (p === root || p.isScene) return null; top = p; p = p.parent; }
    return top;
  }
  CBZ.sliceDropDetachedLos = function (root, tops) {
    const L = CBZ.losBlockers; if (!L || !L.length) return 0;
    let w = 0, n = 0;
    for (let i = 0; i < L.length; i++) {
      const m = L[i], top = m ? detachedTop(m, root) : null;
      if (!top || (tops && !tops.has(top))) { L[w++] = m; continue; }
      n++;
      if (CBZ.streamParkLos) CBZ.streamParkLos(top, m);
    }
    L.length = w;
    return n;
  };

  /* ---- actors: traffic on the slice's own streets, the player in the slice */
  function roadRect(r) {
    const hw = (r.w || r.width || 10) / 2, hl = (r.len || 0) / 2;
    return r.vertical ? [r.x - hw, r.x + hw, r.z - hl, r.z + hl] : [r.x - hl, r.x + hl, r.z - hw, r.z + hw];
  }
  function roadInPlay(r) {
    const s = CBZ.slice; if (!s) return true;
    const b = roadRect(r);
    const cx = Math.max(b[0], Math.min(s.x, b[1])), cz = Math.max(b[2], Math.min(s.z, b[3]));
    return (cx - s.x) * (cx - s.x) + (cz - s.z) * (cz - s.z) <= s.r * s.r;
  }
  // every traffic placement (spawn and recycle) goes through CBZ.roadPick:
  // in a slice it only answers with a street inside the playable circle
  function wrapRoadPick() {
    if (!CBZ.slice || !CBZ.roadPick || CBZ.roadPick._slice) return;
    const orig = CBZ.roadPick;
    const w = function (opts) {
      const o = Object.assign({}, opts || {});
      const f = o.filter;
      o.filter = function (r) { return roadInPlay(r) && (!f || f(r)); };
      o.tries = Math.max(o.tries || 12, 48);
      return orig(o);
    };
    w._slice = true;
    CBZ.roadPick = w;
  }
  // the city's traffic count, scaled to the share of road length the slice holds
  CBZ.sliceTrafficCount = function (A, n) {
    if (!CBZ.slice || !A || !A.roads) return n;
    wrapRoadPick();
    let all = 0, mine = 0;
    const s = CBZ.slice;
    for (const r of A.roads) {
      // length of the road's centreline inside the circle (coarse, 10 m steps)
      const L = r.len || 0; all += L;
      const steps = Math.max(1, Math.ceil(L / 10));
      let inside = 0;
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps - 0.5;
        const x = r.vertical ? r.x : r.x + t * L, z = r.vertical ? r.z + t * L : r.z;
        if ((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) <= s.r * s.r) inside++;
      }
      mine += L * inside / steps;
    }
    if (!(all > 0) || !(mine > 0)) return 0;
    // the downtown grid holds most of the traffic by design; never fewer than
    // a street's worth where the slice has streets
    return Math.max(8, Math.min(n, Math.round(n * Math.min(1, 3 * mine / all))));
  };
  // put the player on the slice's nearest street (or its centre)
  CBZ.slicePlacePlayer = function (A, P) {
    const s = CBZ.slice; if (!s || !P || !P.pos) return false;
    let bx = s.x, bz = s.z, bd = Infinity;
    for (const r of (A && A.roads) || []) {
      if (r.elevated) continue;
      const hl = (r.len || 0) / 2;
      // nearest point on the centreline, then onto the kerb side (footway)
      let x, z;
      if (r.vertical) { x = r.x + ((r.w || 10) / 2 + 1.5); z = Math.max(r.z - hl, Math.min(s.z, r.z + hl)); }
      else { z = r.z + ((r.w || 10) / 2 + 1.5); x = Math.max(r.x - hl, Math.min(s.x, r.x + hl)); }
      const d = (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z);
      if (d < bd) { bd = d; bx = x; bz = z; }
    }
    if (bd > s.r * s.r) { bx = s.x; bz = s.z; }
    const y = A && A.groundHeightAt ? A.groundHeightAt(bx, bz) : 0;
    P.pos.set(bx, y, bz); P.vy = 0; P.grounded = true;
    const ch = CBZ.playerChar && CBZ.playerChar.group;
    if (ch) ch.position.copy(P.pos);
    return true;
  };

  /* The manifest (tools/city-slice-trace.mjs → src/city/slice_manifest.js)
     is only needed by a slice boot, so only a slice boot pays for parsing it.
     document.write from a parser-inserted script inserts a parser-blocking
     tag right here, before worldmap.js reads it. */
  // a streamed city boot (core/citystream.js, ?stream=1) needs it too
  const wantManifest = S || !!(q && (q.get("stream") === "1" || q.get("stream") === "true"));
  if (wantManifest && typeof document !== "undefined" && document.readyState === "loading") {
    try {
      const me = document.currentScript && document.currentScript.src;
      const v = me && /\?v=([^&#]+)/.exec(me);
      document.write('<script src="src/city/slice_manifest.js' + (v ? "?v=" + v[1] : "") + '"><\/script>');
    } catch (e) { console.warn("[slice] manifest not loaded", e); }
  }
})();
