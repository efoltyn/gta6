/* ============================================================
   systems/buildmode.js — CBZ.buildMode: THE WALKING SKELETON (B2,
   BUILD-PLAN Stage B). Ghost preview, hotbar strip, confirm/rotate/
   undo/demolish, all calling B1's CBZ.building.place()/remove() end to
   end. No new geometry system — this file is pure input + a preview
   mesh layered on top of systems/building.js + systems/pieces.js.

   ------------------------------------------------------------------
   KEY BINDINGS — audited against every existing keydown/mousedown
   listener in src/ (grepped, not guessed) before picking each one:

     N        toggle build mode (only in city/survival, CBZ.game.state
              === "playing", no menu/stash open, not driving/dead).
              CONFLICT: systems/killstreaks.js also binds N (tactical
              nuke @ 25-streak) with NO mode gate at all. Once build
              mode owns N in city/survival, a 25-streak nuke reached in
              those modes can never be keyboard-detonated again — a
              real but extremely rare edge (that reward is themed
              "guards/yard", i.e. escape-mode content, and needs an
              unbroken 25-kill streak). Documented trade-off, same
              spirit as fpsmode.js's own "V is not bound in city
              because city owns V" carve-out.
     T        rotate (fill kinds face rot; wall/doorframe picks an
              edge). Q was the obvious pick but fpsmode.js already
              polls CBZ.keys["q"] every frame to swap guns whenever
              shoulderActive() (any city moment you're carrying a gun,
              not just while aiming) — a FAR busier conflict than N's.
              T is next: net/netui.js opens multiplayer chat on T, but
              ONLY while CBZ.net.active, and Enter is a documented
              second way to open that same chat (netui.js:174) — so
              capturing T here costs nothing reachable.
     R / F    working level up/down (gy). Both are genuinely busy in
              fpsmode.js (R=reload, F=fire) whenever the player is
              armed in third person (shoulderActive(), which is just
              "holding any gun", not "aiming"). Mitigated by
              auto-holstering on build-mode ENTRY (city mode only, via
              the existing CBZ.cityHolster de-escalation flag) — armed()
              reads false, shoulderActive() reads false, R/F fall
              through cleanly. Survival has no firearms, so no real
              conflict there. Per the task's own steer, scroll was
              ruled out (systems/fpsmode.js's wheel listener already
              cycles weapons/hotbar) — R/F only, no wheel.
     E/LMB    place (calls CBZ.building.place). E doubles as the global
              interact key (city/interactions.js) and LMB doubles as
              fire/punch (fpsmode.js/combat.js) — both are fully owned
              by this module's capture-phase listeners while build mode
              is active (see INTERCEPTION below), so neither can fire
              alongside a placement.
     X        demolish the aimed piece. Conflicts only inside menu-
              scoped UIs (city/shops.js's qty-cycle X), which can't be
              open at the same time build mode is active outdoors.
     Z        undo the last piece placed THIS session. Conflicts only
              with city/zillow.js's property-menu toggle (gated
              !cityMenuOpen, same non-overlap as X above).
     1-6      select a piece kind. inventory.js's hotbar also reads
              1-9 — see INTERCEPTION below for how that's resolved
              WITHOUT touching inventory.js.

   INTERCEPTION MODEL: one CAPTURE-PHASE listener on window per event
   (keydown, mousedown). Capture-phase listeners on `window` run before
   ANY bubble-phase listener anywhere in the document (window is the
   outermost node in the propagation path, visited first on the way
   down and last on the way back up) — so stopPropagation() here
   reliably starves every other module's listener for that same event,
   REGARDLESS of script load order. This is how numbers 1-6 stay clear
   of inventory.js's hotbar-select handler with a ZERO-LINE edit to
   inventory.js, and how E/LMB never double-fire an interact/shoot/punch
   alongside a placement. Movement (WASD) and mouse-look are never
   claimed — only the keys/buttons this module actually understands
   swallow the event; everything else passes through untouched.

   TARGETING MODEL (~10Hz throttle, core loop stays untouched every
   other frame): raycast from camera through screen-center.
     1) Scan CBZ.pieces within ~20m of the camera, raycast against
        their meshRefs (recursive, since fill-kind meshes are Groups —
        pieces.js's own documented Group-raycast caveat — so a hit
        reports a child; walk .parent up to the node stamped with
        userData.pieceId, spawnPiece's own convention).
     2) Piece hit + fill kind + top-face normal (ny>0.5) → target the
        cell ABOVE it (stacking: gx/gz unchanged, gy = piece.gy+1).
     3) Piece hit + wall/doorframe → target THAT piece's cell, edge
        auto-picked by whichever axis the hit point sits furthest off
        the cell centre (simple nearest-edge snap, not full socket
        logic — B3's job).
     4) No piece hit → intersect a virtual horizontal plane at
        y = level*WALL_H (the R/F-controlled working level) and snap
        gx/gz = round(x/CELL), round(z/CELL).
   Every result is fed straight into CBZ.building.validate() (the B1
   refactor below) for the ghost's tint + the HUD reason line — B2
   never re-implements occupancy/support/world-collision, it only asks.

   MODE GATES: city + survival only. NOT escape (the prison break story
   mode) — that campaign has its own fixed geography and no build
   economy; wiring a construction mode into it would be a different
   feature, not this one. No resource costs this wave (CATALOG.cost is
   data-only — B7 wires crafting/inventory deduction against it).
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.building) return;
  if (CBZ.buildMode) return; // idempotent, same guard idiom as the rest of this family
  const THREE = window.THREE;
  const B = CBZ.building;
  const CELL = B.CELL, WALL_H = B.WALL_H;

  const KINDS = ["foundation", "wall", "floor", "roof", "stairs", "doorframe"];
  const LABEL = { foundation: "FND", wall: "WAL", floor: "FLR", roof: "ROF", stairs: "STR", doorframe: "DOR" };
  const TOGGLE_KEY = "n";
  const THROTTLE = 0.1;      // ~10Hz targeting/ghost refresh
  const PIECE_SCAN_R2 = 20 * 20; // ~20m piece-hit scan radius, squared
  const LEVEL_MAX = 20;

  /* ================= B7: RESOURCE COSTS =====================
     CATALOG.cost{Wood:N} (data-only since B1) becomes real: tryPlace()
     below checks affordability against CBZ.craft.itemStore() (systems/
     craft.js's ONE store accessor for whichever mode is live) before
     calling B.place(), and deducts only on a SUCCESSFUL placement — a
     placement B.place() rejects for some other reason (occupied cell,
     out of span, etc.) never costs you anything (check-then-place).

     CBZ.CONFIG.BUILD_FREE — self-defaulted false, same in-module-tuning
     idiom as city/police.js:49-51 (never edit config.js directly here).
     When true it's a hard global override: everything is free everywhere.

     Left false (the default), costsApply() below decides per mode/kind:
       • survival — ALWAYS costs. It's the core gather→build loop there.
       • city     — FREE for the 6 generic structural pieces (foundation/
         wall/floor/roof/stairs/doorframe). City building is brand-new
         this wave; charging up front for a wall would just stop anyone
         from touching the feature at all — keep the friction low.
         The 3 baseclaim pieces (cupboard/container/door) still cost,
         because THOSE stake a real claim (systems/baseclaim.js's
         BaseRecord + placement-rejection radius) and shouldn't be free
         to spam across a block. */
  if (CBZ.CONFIG && CBZ.CONFIG.BUILD_FREE == null) CBZ.CONFIG.BUILD_FREE = false;
  const CLAIM_KINDS = { cupboard: 1, container: 1, door: 1 };
  function costsApply(kind) {
    if (CBZ.CONFIG && CBZ.CONFIG.BUILD_FREE) return false;
    if (CBZ.game.mode === "survival") return true;
    return !!CLAIM_KINDS[kind];
  }
  // affordability({ok, cost, short}) — cost is the CATALOG entry (or null
  // when this kind/mode charges nothing this wave); short names the first
  // material you're missing when ok is false.
  function affordability(kind) {
    const def = B.CATALOG[kind];
    if (!def || !def.cost || !costsApply(kind)) return { ok: true, cost: null };
    const S = CBZ.craft && CBZ.craft.itemStore ? CBZ.craft.itemStore() : null;
    if (!S) return { ok: true, cost: def.cost };   // store not loaded yet — never hard-block on a load-order fluke
    for (const mat in def.cost) if (S.count(mat) < def.cost[mat]) return { ok: false, cost: def.cost, short: mat };
    return { ok: true, cost: def.cost };
  }

  const bm = CBZ.buildMode = {
    active: false,
    kind: KINDS[0],
    kindIdx: 0,
    rot: 0,
    level: 0,      // gy of the virtual working plane (R/F)
    gx: null, gy: 0, gz: null,   // last resolved target cell (null = no target)
    lastValid: null,
    placedStack: [],            // this-session undo stack (piece ids)
  };

  /* ================= ghost meshes (one per kind, built once) ================= */
  const ghostMatValid = new THREE.MeshBasicMaterial({ color: 0x33dd55, transparent: true, opacity: 0.4, depthWrite: false });
  const ghostMatInvalid = new THREE.MeshBasicMaterial({ color: 0xdd3333, transparent: true, opacity: 0.4, depthWrite: false });
  const ghosts = {}; // kind -> { root, parts:[Mesh,...] }
  KINDS.forEach(function (kind) {
    const def = B.CATALOG[kind];
    const group = new THREE.Group();
    const built = def.build({ group: group, x: 0, y: 0, z: 0, rot: 0, rng: Math.random, scale: 1 });
    const root = (built && built.isObject3D) ? built : group;
    const parts = [];
    root.traverse(function (o) {
      // frustumCulled lives on each MESH (its own geometry bounding sphere),
      // not on a parent Group — set it per-part so a repositioned ghost
      // never pops out of view from a stale local-origin bounding sphere.
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.material = ghostMatValid; o.frustumCulled = false; parts.push(o); }
    });
    root.visible = false;
    root.matrixAutoUpdate = true;   // unlike spawnPiece's real pieces, the ghost moves every throttle tick
    CBZ.scene.add(root);
    ghosts[kind] = { root: root, parts: parts };
  });
  function hideAllGhosts() { for (const k in ghosts) ghosts[k].root.visible = false; }
  function renderGhost(v) {
    hideAllGhosts();
    const g = ghosts[bm.kind];
    if (!g || bm.gx == null) return;
    const pos = v.pos || B.gridToWorld(bm.gx, bm.gy, bm.gz);
    g.root.position.set(pos.x, pos.y, pos.z);
    g.root.rotation.y = bm.rot * (Math.PI / 2);
    g.root.visible = true;
    const tint = v.ok ? ghostMatValid : ghostMatInvalid;
    for (let i = 0; i < g.parts.length; i++) g.parts[i].material = tint;
  }

  /* ================= HUD: hint line + kind strip (self-styled, ISO to hotbar) ================= */
  const hintEl = document.createElement("div");
  hintEl.className = "panel";
  hintEl.style.cssText = "position:fixed;left:50%;bottom:78px;transform:translateX(-50%);" +
    "display:none;padding:6px 14px;font:600 12px/1.4 inherit;color:#e8ecf2;" +
    "text-align:center;white-space:nowrap;z-index:15;pointer-events:none;";
  document.body.appendChild(hintEl);

  const stripEl = document.createElement("div");
  stripEl.style.cssText = "position:fixed;left:50%;bottom:132px;transform:translateX(-50%);" +
    "display:none;gap:6px;z-index:15;pointer-events:none;";
  const stripCells = KINDS.map(function (kind) {
    const c = document.createElement("div");
    c.className = "islot";
    c.style.cssText = "width:42px;height:42px;font:700 11px/1 inherit;";
    c.textContent = LABEL[kind];
    stripEl.appendChild(c);
    return c;
  });
  document.body.appendChild(stripEl);

  function renderStrip() {
    for (let i = 0; i < stripCells.length; i++) stripCells[i].classList.toggle("sel", i === bm.kindIdx);
  }
  function setHint(text, warn) { hintEl.textContent = text; hintEl.style.color = warn ? "#ff6a6a" : ""; }
  // B7: append the piece's live cost (when this mode/kind actually charges —
  // see costsApply() above) and flag the whole line red when short.
  function hintLine(v, afford) {
    let s = "[" + bm.kind.toUpperCase() + "] · rot T · level R/F (" + bm.level + ") · click/E place · X demolish · Z undo · N exit";
    if (afford && afford.cost) {
      const parts = Object.keys(afford.cost).map(function (m) { return afford.cost[m] + " " + m; });
      s += "  ·  cost " + parts.join(", ");
      if (!afford.ok) s += "  ⚠ need " + afford.cost[afford.short] + " " + afford.short;
    }
    if (!v.ok) s += "  —  " + (v.reason || "invalid");
    return s;
  }
  function showUI() { hintEl.style.display = "block"; stripEl.style.display = "flex"; renderStrip(); }
  function hideUI() { hintEl.style.display = "none"; stripEl.style.display = "none"; }

  /* ================= B3: SOCKET SNAP ================================
     snapCandidate(kind, hitPiece, hitPoint, camDir) -> {gx,gy,gz,rot} | null

     Pure function, no THREE/DOM/CBZ dependency (unit-testable in the node
     harness with plain object literals) — derives a Rust-feel CANDIDATE
     placement from the piece actually hit + the selected kind's known
     compatibility, instead of raw "same cell as whatever's under the
     crosshair" cell math. Returns null when the (kind, hit-piece kind)
     pair has no compatibility rule here, so the caller (updateTarget,
     below) falls back to the pre-B3 same-cell/top-face behaviour.

       kind      — bm.kind, the piece the player currently has selected.
       hitPiece  — { kind, gridPos:{gx,gy,gz}, rot } of the piece the
                   raycast actually landed on.
       hitPoint  — {x,y,z} world-space point the ray hit (THREE.Vector3
                   duck-typed — only .x/.y/.z are read).
       camDir    — {x,y,z} the ray's normalized look direction (only used
                   to break a near-corner tie for edge kinds; safe to omit).

     Multi-candidate cycling (TAB, corner aims with >1 plausible edge) is
     explicitly OUT of scope this step — polish later; we always resolve
     to a single best candidate. */
  function snapCandidate(kind, hitPiece, hitPoint, camDir) {
    if (!hitPiece || !hitPiece.gridPos || !hitPoint) return null;
    const hp = hitPiece.gridPos;
    const cx = hp.gx * CELL, cz = hp.gz * CELL;
    const FILL_KINDS = { foundation: 1, floor: 1, roof: 1, stairs: 1 };

    // 1) foundation selected + foundation hit -> the ADJACENT cell in the
    // direction of the hit point (Rust's "expand the pad sideways" feel;
    // NOT a vertical stack, even though a foundation's own top face is
    // flush with the next gy up — this rule takes priority over that).
    if (kind === "foundation" && hitPiece.kind === "foundation") {
      const dx = hitPoint.x - cx, dz = hitPoint.z - cz;
      if (Math.abs(dx) >= Math.abs(dz)) {
        return { gx: hp.gx + (dx >= 0 ? 1 : -1), gy: hp.gy, gz: hp.gz, rot: 0 };
      }
      return { gx: hp.gx, gy: hp.gy, gz: hp.gz + (dz >= 0 ? 1 : -1), rot: 0 };
    }

    // 2) wall/doorframe selected + a FILL piece hit -> the NEAREST EDGE of
    // THAT cell, picked by hit-point-to-edge distance (not just "which
    // half the point is in" — a true nearest-edge test). Near a corner
    // (top two edges within CORNER_EPS of each other) prefer whichever
    // edge's OUTWARD normal faces the camera (most opposed to camDir) —
    // that's the face the player is actually looking at.
    if ((kind === "wall" || kind === "doorframe") && FILL_KINDS[hitPiece.kind]) {
      const half = CELL / 2;
      const edges = [
        { rot: 0, d: Math.abs(hitPoint.z - (cz - half)), n: { x: 0, z: -1 } }, // north
        { rot: 1, d: Math.abs(hitPoint.x - (cx + half)), n: { x: 1, z: 0 } },  // east
        { rot: 2, d: Math.abs(hitPoint.z - (cz + half)), n: { x: 0, z: 1 } },  // south
        { rot: 3, d: Math.abs(hitPoint.x - (cx - half)), n: { x: -1, z: 0 } }, // west
      ];
      edges.sort(function (a, b) { return a.d - b.d; });
      let best = edges[0];
      const CORNER_EPS = 0.2; // metres — "near a corner" tie band
      if (camDir && Math.abs(edges[1].d - edges[0].d) < CORNER_EPS) {
        const dot0 = edges[0].n.x * camDir.x + edges[0].n.z * camDir.z;
        const dot1 = edges[1].n.x * camDir.x + edges[1].n.z * camDir.z;
        best = dot1 < dot0 ? edges[1] : edges[0]; // more negative dot = normal opposes the look dir = faces the camera
      }
      return { gx: hp.gx, gy: hp.gy, gz: hp.gz, rot: best.rot };
    }

    // 3) floor/roof selected + a wall/doorframe hit -> the cell/level ABOVE
    // that wall (the floor IT supports — matches building.js's own
    // floor/roof support rule: "a wall at gy-1 supports a floor at gy").
    if ((kind === "floor" || kind === "roof") && (hitPiece.kind === "wall" || hitPiece.kind === "doorframe")) {
      return { gx: hp.gx, gy: hp.gy + 1, gz: hp.gz, rot: 0 };
    }

    // 4) stairs selected + a FILL piece hit -> the adjacent cell, SAME
    // level, rot facing AWAY from the hit cell: the low step lands on the
    // hit cell's fill piece and the climb runs away from it (the walk-up
    // direction) — matches building.js place()'s rot->climb-direction
    // convention (rot0/1 climb +z/+x, rot2/3 climb -z/-x).
    if (kind === "stairs" && FILL_KINDS[hitPiece.kind]) {
      const dx = hitPoint.x - cx, dz = hitPoint.z - cz;
      if (Math.abs(dx) >= Math.abs(dz)) {
        const east = dx >= 0;
        return { gx: hp.gx + (east ? 1 : -1), gy: hp.gy, gz: hp.gz, rot: east ? 1 : 3 };
      }
      const south = dz >= 0;
      return { gx: hp.gx, gy: hp.gy, gz: hp.gz + (south ? 1 : -1), rot: south ? 0 : 2 };
    }

    return null; // no compatibility rule for this pair — caller falls back
  }
  // exposed for the node harness (B3) — pure function, safe to call
  // directly without the rest of build mode being active.
  bm.snapCandidate = snapCandidate;

  /* ================= raycast helpers ================= */
  const raycaster = new THREE.Raycaster();
  const NDC_CENTER = new THREE.Vector2(0, 0);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _planePt = new THREE.Vector3();
  const _nearbyMeshes = [];

  // raycast the piece nearest the crosshair within ~20m of the camera —
  // shared by the stacking/edge-snap logic below AND the X demolish key,
  // so "what you're aiming at" and "what X removes" are always the
  // exact same answer.
  function raycastNearbyPiece() {
    _nearbyMeshes.length = 0;
    const cp = CBZ.camera.position;
    CBZ.pieces.forEach(function (p) {
      if (!p.alive || !p.meshRef) return;
      const dx = p.pos.x - cp.x, dy = p.pos.y - cp.y, dz = p.pos.z - cp.z;
      if (dx * dx + dy * dy + dz * dz > PIECE_SCAN_R2) return;
      _nearbyMeshes.push(p.meshRef);
    });
    if (!_nearbyMeshes.length) return null;
    // recursive:true — fill-kind meshRefs are Groups (pieces.js's own
    // documented "Group.raycast is a no-op" caveat), so a hit reports a
    // CHILD object; walk .parent up to the node spawnPiece stamped with
    // userData.pieceId (every piece root gets exactly one such stamp).
    const hits = raycaster.intersectObjects(_nearbyMeshes, true);
    for (let i = 0; i < hits.length; i++) {
      let o = hits[i].object;
      while (o && (!o.userData || o.userData.pieceId == null)) o = o.parent;
      if (o && o.userData.pieceId != null) return { pieceId: o.userData.pieceId, hit: hits[i] };
    }
    return null;
  }

  /* ================= the throttled targeting + ghost update ================= */
  function updateTarget() {
    if (!bm.active) return;
    raycaster.setFromCamera(NDC_CENTER, CBZ.camera);

    let gx = null, gy = bm.level, gz = null, rot = bm.rot;
    const pieceHit = raycastNearbyPiece();

    if (pieceHit) {
      const piece = CBZ.pieces.get(pieceHit.pieceId);
      if (piece && piece.gridPos) {
        // B3: ask the socket-snap function for a compatibility-driven
        // candidate first (foundation-edge, wall-onto-edge, floor-above-
        // wall, stairs-adjacent) — falls back to the pre-B3 same-cell/
        // top-face behaviour below when there's no rule for this pair.
        const cand = snapCandidate(bm.kind, { kind: piece.kind, gridPos: piece.gridPos, rot: piece.rot }, pieceHit.hit.point, raycaster.ray.direction);
        if (cand) {
          gx = cand.gx; gy = cand.gy; gz = cand.gz; rot = cand.rot;
        } else {
          const isEdgeKind = (bm.kind === "wall" || bm.kind === "doorframe");
          const n = pieceHit.hit.face ? pieceHit.hit.face.normal : null;
          if (!isEdgeKind && n && n.y > 0.5) {
            // hit a top face with a FILL kind selected → stack on top of it
            gx = piece.gridPos.gx; gz = piece.gridPos.gz; gy = piece.gridPos.gy + 1;
          } else {
            // same cell/level as the hit piece; walls/doorframes snap to
            // whichever of the cell's 4 edges the hit point sits nearest
            gx = piece.gridPos.gx; gz = piece.gridPos.gz; gy = piece.gridPos.gy;
            if (isEdgeKind) {
              const cx = gx * CELL, cz = gz * CELL;
              const dxp = pieceHit.hit.point.x - cx, dzp = pieceHit.hit.point.z - cz;
              rot = Math.abs(dxp) > Math.abs(dzp) ? (dxp > 0 ? 1 : 3) : (dzp > 0 ? 2 : 0);
            }
          }
        }
      }
    }

    if (gx == null) {
      // fall back to the virtual ground plane at the current working level
      groundPlane.constant = -(bm.level * WALL_H);
      const pt = raycaster.ray.intersectPlane(groundPlane, _planePt);
      if (pt) { gx = Math.round(pt.x / CELL); gz = Math.round(pt.z / CELL); gy = bm.level; }
    }

    if (gx == null) {
      bm.gx = null; bm.gy = bm.level; bm.gz = null; bm.lastValid = null;
      hideAllGhosts();
      setHint("[" + bm.kind.toUpperCase() + "] · rot T · level R/F (" + bm.level + ") · click/E place · X demolish · Z undo · N exit  —  no target");
      return;
    }

    bm.gx = gx; bm.gy = gy; bm.gz = gz;
    // wall/doorframe always auto-face their snapped edge; stairs only get
    // an auto-rot from snapCandidate's rule 4 (fill-piece hit) — everywhere
    // else `rot` still equals bm.rot here, so this assignment is a no-op.
    if (bm.kind === "wall" || bm.kind === "doorframe" || bm.kind === "stairs") bm.rot = rot;

    const v = B.validate(bm.kind, bm.gx, bm.gy, bm.gz, bm.rot);
    bm.lastValid = v;
    renderGhost(v);
    const afford = affordability(bm.kind);
    setHint(hintLine(v, afford), !afford.ok);
  }

  /* ================= actions ================= */
  function tryPlace() {
    if (!bm.active) return;
    if (bm.gx == null) { CBZ.flashHint && CBZ.flashHint("🚫 No target", 1.0); return; }
    // B7: check affordability BEFORE B.place() (check-then-place — a failed
    // placement below never costs you anything either way).
    const afford = affordability(bm.kind);
    if (!afford.ok) {
      CBZ.flashHint && CBZ.flashHint("🚫 Need " + afford.cost[afford.short] + " " + afford.short, 1.4);
      return;
    }
    // B6: thread the builder's stable pid through so every piece carries
    // its owner (foreign-base placement gate + the demolish gate below both
    // key off this) — CBZ.netPid() always resolves, online or offline.
    const piece = B.place(bm.kind, bm.gx, bm.gy, bm.gz, bm.rot, { ownerId: CBZ.netPid ? CBZ.netPid() : null });
    if (piece) {
      if (afford.cost) {
        const S = CBZ.craft && CBZ.craft.itemStore ? CBZ.craft.itemStore() : null;
        if (S) for (const mat in afford.cost) S.take(mat, afford.cost[mat]);
        // E1: placing consumes Wood — signal materials demand to the living
        // economy shim (sim/market.js), guarded (may not be loaded yet).
        if (CBZ.market && afford.cost.Wood) CBZ.market.recordBuy("materials", afford.cost.Wood / 10);
      }
      bm.placedStack.push(piece.id);
      // audio.js's BANK has no "place" entry yet (grepped) — "coin" is
      // the documented fallback the task asks for until one lands.
      CBZ.sfx && CBZ.sfx("coin");
      updateTarget();
    } else {
      const v = B.validate(bm.kind, bm.gx, bm.gy, bm.gz, bm.rot);
      CBZ.flashHint && CBZ.flashHint("🚫 " + (v.reason || "Can't place there"), 1.4);
    }
  }
  function tryDemolish() {
    if (!bm.active) return;
    raycaster.setFromCamera(NDC_CENTER, CBZ.camera);
    const hit = raycastNearbyPiece();
    if (!hit) { CBZ.flashHint && CBZ.flashHint("🚫 Nothing in range to demolish", 1.0); return; }
    const piece = CBZ.pieces.get(hit.pieceId);
    // B6 OWNERSHIP GATE: X only works on (a) ownerless pieces — legacy/
    // pre-B6 saves and anything spawned outside the build system, same
    // permissive default as before this wave — (b) pieces YOU built, or
    // (c) any piece sitting inside a BaseRecord radius you're authorized
    // on (your own base's tool cupboard covers your whole claim, not just
    // the pieces you personally placed). Raiders demolish someone else's
    // base through DAMAGE (systems/structdamage.js), never through this
    // verb — there is no "break in and demolish" shortcut.
    if (!piece) { CBZ.flashHint && CBZ.flashHint("🚫 Can't demolish that", 1.0); return; }
    const me = CBZ.netPid ? CBZ.netPid() : null;
    const ownedByMe = piece.ownerId == null || piece.ownerId === me;
    const inMyBase = !ownedByMe && CBZ.baseAt && (function () {
      const rec = CBZ.baseAt(piece.pos.x, piece.pos.z);
      return !!(rec && rec.authorized.indexOf(me) >= 0);
    })();
    if (!ownedByMe && !inMyBase) { CBZ.flashHint && CBZ.flashHint("🚫 Can't demolish that", 1.0); return; }
    const idx = bm.placedStack.indexOf(hit.pieceId);
    if (idx >= 0) bm.placedStack.splice(idx, 1);
    B.remove(hit.pieceId);
    CBZ.sfx && CBZ.sfx("hit");
    updateTarget();
  }
  function tryUndo() {
    if (!bm.active) return;
    while (bm.placedStack.length) {
      const id = bm.placedStack.pop();
      if (CBZ.pieces.has(id)) {
        B.remove(id);
        CBZ.flashHint && CBZ.flashHint("↩ Undid last piece", 1.0);
        updateTarget();
        return;
      }
    }
    CBZ.flashHint && CBZ.flashHint("Nothing to undo this session", 1.0);
  }
  function selectKind(idx) {
    if (idx < 0 || idx >= KINDS.length || idx === bm.kindIdx) { if (idx >= 0 && idx < KINDS.length) updateTarget(); return; }
    bm.kindIdx = idx; bm.kind = KINDS[idx];
    renderStrip();
    updateTarget();
  }

  function canEnter() {
    const g = CBZ.game;
    if (!g || g.state !== "playing") return false;
    if (g.mode !== "city" && g.mode !== "survival") return false; // NOT escape — see file header
    if (CBZ.cityMenuOpen || CBZ.invOpen) return false;
    if (CBZ.player && (CBZ.player.driving || CBZ.player.dead)) return false;
    return true;
  }
  function enterBuildMode() {
    bm.active = true;
    bm.rot = 0; bm.level = 0; bm.kindIdx = 0; bm.kind = KINDS[0];
    bm.placedStack.length = 0;
    // free up R/F (reload/fire) for the duration of the session — see
    // the R/F conflict note in the file header. City-only: cityHolster
    // itself no-ops outside city mode.
    if (CBZ.game.mode === "city" && CBZ.cityHolster) CBZ.cityHolster(true);
    showUI();
    updateTarget();
    CBZ.flashHint && CBZ.flashHint("🛠 Build mode", 1.0);
  }
  function exitBuildMode() {
    bm.active = false;
    hideUI();
    hideAllGhosts();
  }

  /* ================= input: capture-phase, see file header ================= */
  addEventListener("keydown", function (e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();

    if (k === TOGGLE_KEY) {
      if (bm.active) exitBuildMode();
      else { if (!canEnter()) return; enterBuildMode(); }
      e.preventDefault(); e.stopPropagation();
      return;
    }

    if (!bm.active) return; // every other key passes through untouched while build mode is off

    let handled = true;
    if (k === "t") bm.rot = (bm.rot + 1) % 4;
    else if (k === "r") bm.level = Math.min(LEVEL_MAX, bm.level + 1);
    else if (k === "f") bm.level = Math.max(0, bm.level - 1);
    else if (k === "e") tryPlace();
    else if (k === "x") tryDemolish();
    else if (k === "z") tryUndo();
    else {
      const n = "123456".indexOf(k);
      if (n >= 0) selectKind(n);
      else handled = false;
    }
    if (!handled) return; // e.g. WASD — let physics.js/input.js see it normally

    e.preventDefault();
    e.stopPropagation();
    updateTarget(); // immediate refresh for rot/level/kind changes (snappier than waiting for the throttle)
  }, true);

  addEventListener("mousedown", function (e) {
    if (!bm.active) return;
    if (e.button === 0) tryPlace();
    e.preventDefault();
    e.stopPropagation();
  }, true);

  /* ================= per-frame: mode-gate safety net + throttle ================= */
  let acc = 0;
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.GAMEPLAY + 0.2 : 40.2, function (dt) {
    if (!bm.active) return;
    if (!canEnter()) { exitBuildMode(); return; } // mode/menu/vehicle changed out from under us
    acc += dt;
    if (acc < THROTTLE) return;
    acc = 0;
    updateTarget();
  });
})();
