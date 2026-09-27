/* ============================================================
   systems/buildmode.js — CBZ.buildMode: ghost preview, hotbar, confirm/
   rotate/undo/demolish, all calling CBZ.building.place()/remove().

   TWO FLAVOURS, one module:
     SURVIVAL — the Rust wood kit on the global grid, paid in Wood
       (CBZ.econ.itemStore). Hotbar, keys and costs are the original B2..B7
       behaviour.
     CITY — you build on a plot you OWN (CBZ.cityPlots, the lead's
       city/plots.js). N only works standing on or next to one ("Buy the lot
       first" otherwise); the grid snaps to THAT plot's own grid (lots are
       30 m and do not sit on the global 3 m lattice); the hotbar shows
       CATEGORIES (Walls, Gates, Defense, Buildings, Structure) from
       city/compoundkit.js with names and prices; every piece costs real
       money (cash first, then bank) and X gives half back for your own
       piece. The hint says the price and, when the ghost is red, why.

   ------------------------------------------------------------------
   KEY BINDINGS — audited against every existing keydown/mousedown
   listener in src/ (grepped, not guessed) before picking each one:

     N        toggle build mode (city/survival, state "playing", no menu/
              stash open, not driving/dead). CONFLICT: systems/killstreaks.js
              also binds N (tactical nuke at a 25-streak) with no mode gate;
              in city/survival build mode wins. Documented trade-off.
     T        rotate. Q was the obvious pick but fpsmode.js polls
              CBZ.keys["q"] every frame to swap guns while armed; T only
              opens net chat while CBZ.net.active and Enter does that too.
     R / F    working level up/down. Busy in fpsmode.js (reload/fire) while
              armed in third person, so city entry holsters (CBZ.cityHolster)
              and R/F fall through cleanly. Survival has no firearms.
     E/LMB    place (both owned by the capture-phase listeners while active).
     X        demolish the aimed piece (city: half the price back).
     Z        undo the last piece placed this session (city: full refund,
              it is an undo). Conflicts only with zillow.js's property menu,
              which cannot be open at the same time.
     1-6      survival: select a piece kind (inventory.js's hotbar also reads
              1-9; starved by the capture-phase listener while active).
     1-9      city: pick a piece inside the current category.
     TAB      city only: next category. Audit: leaderboard.js toggles its
              board on Tab in city (gated !cityMenuOpen), dashboard.js uses
              Tab only OUTSIDE city, zillow.js's "tab" is a click action, not
              a key, gamepad.js BACK taps Tab for the same leaderboard. So
              while city build mode is active Tab is starved from the
              leaderboard, the one real overlap, same trade as N. Survival
              never captures Tab. C was the runner-up but physics.js polls
              keys["c"] as the sneak key and playercars.js uses it in cars.

   INTERCEPTION MODEL: one CAPTURE-PHASE listener on window per event
   (keydown, mousedown), so stopPropagation() here starves every other
   module's listener for the keys build mode understands, regardless of
   script order. Movement and mouse-look are never claimed.

   TARGETING (~10Hz): raycast from the camera through screen centre.
     1) piece hit within ~20 m (same grid only in the city) -> socket snap
        (snapCandidate) or stack/edge rules;
     2) else the virtual plane at the working level, snapped to the grid.
   The result goes straight into CBZ.building.validate() for the ghost tint
   and the hint's reason: this file never re-implements occupancy, support
   or collision, it only asks.
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.building) return;
  if (CBZ.buildMode) return; // idempotent
  const THREE = window.THREE;
  const B = CBZ.building;
  const CELL = B.CELL, WALL_H = B.WALL_H;

  const KINDS = ["foundation", "wall", "floor", "roof", "stairs", "doorframe"];
  const LABEL = { foundation: "FND", wall: "WAL", floor: "FLR", roof: "ROF", stairs: "STR", doorframe: "DOR" };
  const TOGGLE_KEY = "n";
  const THROTTLE = 0.1;
  const PIECE_SCAN_R2 = 20 * 20;
  const LEVEL_MAX = 20;

  function isCity() { return CBZ.game && CBZ.game.mode === "city"; }
  function kit() { return CBZ.compoundKit || null; }

  /* ================= COSTS =====================
     Survival: CATALOG.cost {Wood:N} against CBZ.econ.itemStore(), deducted
     only on a successful placement. CBZ.CONFIG.BUILD_FREE overrides all.
     City: the def's dollar price (compoundkit.js), charged cash first then
     bank on a successful placement. */
  if (CBZ.CONFIG && CBZ.CONFIG.BUILD_FREE == null) CBZ.CONFIG.BUILD_FREE = false;
  function free() { return !!(CBZ.CONFIG && CBZ.CONFIG.BUILD_FREE); }
  function affordability(kind) {
    if (free()) return { ok: true, cost: null, price: 0 };
    if (bm.grid) {
      const d = B.defFor(kind, bm.grid);
      const price = (d && d.price) || 0;
      const K = kit();
      return { ok: !price || !K || K.canAfford(price), cost: null, price: price };
    }
    const def = B.CATALOG[kind];
    if (!def || !def.cost || CBZ.game.mode !== "survival") return { ok: true, cost: null, price: 0 };
    const S = CBZ.econ && CBZ.econ.itemStore ? CBZ.econ.itemStore() : null;
    if (!S) return { ok: true, cost: def.cost, price: 0 };
    for (const mat in def.cost) if (S.count(mat) < def.cost[mat]) return { ok: false, cost: def.cost, short: mat, price: 0 };
    return { ok: true, cost: def.cost, price: 0 };
  }
  function money(n) { const K = kit(); return K ? K.money(n) : "$" + Math.round(n); }

  const bm = CBZ.buildMode = {
    active: false,
    kind: KINDS[0],
    kindIdx: 0,
    cat: 0,           // city: category index into compoundKit.categories
    rot: 0,
    level: 0,
    gx: null, gy: 0, gz: null,
    lastValid: null,
    placedStack: [],
    grid: null,       // city: the plot grid {id, ox, oz, oy}; null = survival's global grid
    plot: null,
  };

  function cats() { const K = kit(); return (K && K.categories) || []; }
  function catKinds() { const c = cats()[bm.cat]; return c ? c.kinds : []; }

  /* ================= ghosts: built lazily, one per def ================= */
  const ghostMatValid = new THREE.MeshBasicMaterial({ color: 0x33dd55, transparent: true, opacity: 0.4, depthWrite: false });
  const ghostMatInvalid = new THREE.MeshBasicMaterial({ color: 0xdd3333, transparent: true, opacity: 0.4, depthWrite: false });
  const ghosts = new Map(); // def -> { root, parts }
  let shownGhost = null;
  function ghostFor(kind) {
    const def = B.defFor(kind, bm.grid);
    if (!def) return null;
    let gh = ghosts.get(def);
    if (gh) return gh;
    const group = new THREE.Group();
    const built = def.build({ group: group, x: 0, y: 0, z: 0, rot: 0, rng: Math.random, scale: 1 });
    const root = (built && built.isObject3D) ? built : group;
    const parts = [];
    root.traverse(function (o) {
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.material = ghostMatValid; o.frustumCulled = false; parts.push(o); }
    });
    root.visible = false;
    root.matrixAutoUpdate = true;
    CBZ.scene.add(root);
    gh = { root: root, parts: parts };
    ghosts.set(def, gh);
    return gh;
  }
  function hideAllGhosts() { if (shownGhost) shownGhost.root.visible = false; shownGhost = null; }
  function renderGhost(v) {
    const gh = ghostFor(bm.kind);
    if (shownGhost && shownGhost !== gh) shownGhost.root.visible = false;
    shownGhost = gh;
    if (!gh || bm.gx == null) { if (gh) gh.root.visible = false; return; }
    const pos = v.pos || B.gridToWorld(bm.gx, bm.gy, bm.gz, bm.grid);
    gh.root.position.set(pos.x, pos.y, pos.z);
    gh.root.rotation.y = B.meshYaw(bm.kind, bm.rot, bm.grid);
    gh.root.visible = true;
    const tint = v.ok ? ghostMatValid : ghostMatInvalid;
    for (let i = 0; i < gh.parts.length; i++) gh.parts[i].material = tint;
  }

  /* ================= HUD: hint line + hotbar strip ================= */
  const hintEl = document.createElement("div");
  hintEl.className = "panel";
  hintEl.style.cssText = "position:fixed;left:50%;bottom:78px;transform:translateX(-50%);" +
    "display:none;padding:6px 14px;font:600 12px/1.4 inherit;color:#e8ecf2;" +
    "text-align:center;white-space:nowrap;z-index:15;pointer-events:none;max-width:96vw;overflow:hidden;";
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

  // city strip: category tabs over the category's pieces (name + price)
  const cityEl = document.createElement("div");
  cityEl.style.cssText = "position:fixed;left:50%;bottom:124px;transform:translateX(-50%);display:none;" +
    "z-index:15;pointer-events:none;text-align:center;font:600 12px/1.25 inherit;color:#e8ecf2;max-width:96vw;";
  document.body.appendChild(cityEl);
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; }); }
  function renderCityStrip() {
    const C = cats();
    let h = "<div style='margin-bottom:6px'>";
    for (let i = 0; i < C.length; i++) {
      const on = i === bm.cat;
      h += "<span style='display:inline-block;margin:0 3px;padding:3px 9px;border-radius:6px;" +
        (on ? "background:rgba(255,209,102,0.22);color:#ffd166" : "background:rgba(10,12,16,0.55);color:#9aa4b2") + "'>" + esc(C[i].name) + "</span>";
    }
    h += "<span style='color:#7d8796;font-size:11px;margin-left:6px'>Tab</span></div><div style='display:flex;gap:6px;justify-content:center;flex-wrap:wrap'>";
    const ks = catKinds();
    for (let i = 0; i < ks.length; i++) {
      const d = B.defFor(ks[i], bm.grid) || {};
      const on = ks[i] === bm.kind;
      h += "<div class='islot" + (on ? " sel" : "") + "' style='width:auto;min-width:74px;height:auto;padding:5px 8px;font:700 11px/1.3 inherit;text-align:center'>" +
        "<div style='color:#7d8796'>" + (i + 1) + "</div><div>" + esc(d.label || ks[i]) + "</div><div style='color:#9fe58a'>" + money(d.price || 0) + "</div></div>";
    }
    h += "</div>";
    cityEl.innerHTML = h;
  }
  function renderStrip() {
    if (bm.grid) { renderCityStrip(); return; }
    for (let i = 0; i < stripCells.length; i++) stripCells[i].classList.toggle("sel", i === bm.kindIdx);
  }
  function setHint(text, warn) { hintEl.textContent = text; hintEl.style.color = warn ? "#ff6a6a" : ""; }
  function hintLine(v, afford) {
    if (bm.grid) {
      const d = B.defFor(bm.kind, bm.grid) || {};
      let s = (d.label || bm.kind) + " " + money(afford.price || 0) + "  |  T rotate  |  R/F level " + bm.level + "  |  E place  |  X demolish, half back  |  Z undo  |  N exit";
      if (!afford.ok) s = "Not enough money for " + (d.label || bm.kind) + " (" + money(afford.price) + ")  |  " + s;
      else if (v && !v.ok) s = cap(v.reason || "Can't place there") + "  |  " + s;
      return s;
    }
    let s = "[" + bm.kind.toUpperCase() + "]  rot T  |  level R/F (" + bm.level + ")  |  click/E place  |  X demolish  |  Z undo  |  N exit";
    if (afford && afford.cost) {
      const parts = Object.keys(afford.cost).map(function (m) { return afford.cost[m] + " " + m; });
      s += "  |  cost " + parts.join(", ");
      if (!afford.ok) s += ", need " + afford.cost[afford.short] + " " + afford.short;
    }
    if (v && !v.ok) s += "  |  " + (v.reason || "invalid");
    return s;
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function showUI() {
    hintEl.style.display = "block";
    if (bm.grid) { stripEl.style.display = "none"; cityEl.style.display = "block"; }
    else { stripEl.style.display = "flex"; cityEl.style.display = "none"; }
    renderStrip();
  }
  function hideUI() { hintEl.style.display = "none"; stripEl.style.display = "none"; cityEl.style.display = "none"; }

  /* ================= SOCKET SNAP ================================
     snapCandidate(kind, hitPiece, hitPoint, camDir, grid) -> {gx,gy,gz,rot}|null
     Pure (no THREE/DOM): a Rust-feel candidate from the piece actually hit.
     grid {ox, oz} (optional, default the global lattice at 0,0) is the
     cell-centre origin, so a plot grid snaps the same way. Returns null when
     the pair has no rule and the caller falls back. */
  const FILL_KINDS = { foundation: 1, floor: 1, roof: 1, stairs: 1 };
  function isEdgeKind(kind) {
    if (kind === "wall" || kind === "doorframe") return true;
    const st = B.slotTypeOf ? B.slotTypeOf(kind) : null;
    return st === "edge" || st === "cam";
  }
  function snapCandidate(kind, hitPiece, hitPoint, camDir, grid) {
    if (!hitPiece || !hitPiece.gridPos || !hitPoint) return null;
    const hp = hitPiece.gridPos;
    const ox = grid ? grid.ox || 0 : 0, oz = grid ? grid.oz || 0 : 0;
    const cx = ox + hp.gx * CELL, cz = oz + hp.gz * CELL;

    // 1) foundation on foundation -> the adjacent cell toward the hit point
    if (kind === "foundation" && hitPiece.kind === "foundation") {
      const dx = hitPoint.x - cx, dz = hitPoint.z - cz;
      if (Math.abs(dx) >= Math.abs(dz)) return { gx: hp.gx + (dx >= 0 ? 1 : -1), gy: hp.gy, gz: hp.gz, rot: 0 };
      return { gx: hp.gx, gy: hp.gy, gz: hp.gz + (dz >= 0 ? 1 : -1), rot: 0 };
    }

    // 2) an edge kind on a FILL piece -> the nearest edge of that cell; near a
    //    corner prefer the edge whose outward normal faces the camera
    if (isEdgeKind(kind) && FILL_KINDS[hitPiece.kind]) {
      const half = CELL / 2;
      const edges = [
        { rot: 0, d: Math.abs(hitPoint.z - (cz - half)), n: { x: 0, z: -1 } },
        { rot: 1, d: Math.abs(hitPoint.x - (cx + half)), n: { x: 1, z: 0 } },
        { rot: 2, d: Math.abs(hitPoint.z - (cz + half)), n: { x: 0, z: 1 } },
        { rot: 3, d: Math.abs(hitPoint.x - (cx - half)), n: { x: -1, z: 0 } },
      ];
      edges.sort(function (a, b) { return a.d - b.d; });
      let best = edges[0];
      const CORNER_EPS = 0.2;
      if (camDir && Math.abs(edges[1].d - edges[0].d) < CORNER_EPS) {
        const dot0 = edges[0].n.x * camDir.x + edges[0].n.z * camDir.z;
        const dot1 = edges[1].n.x * camDir.x + edges[1].n.z * camDir.z;
        best = dot1 < dot0 ? edges[1] : edges[0];
      }
      return { gx: hp.gx, gy: hp.gy, gz: hp.gz, rot: best.rot };
    }

    // 3) floor/roof on a wall/doorframe -> the cell above that wall
    if ((kind === "floor" || kind === "roof") && (hitPiece.kind === "wall" || hitPiece.kind === "doorframe")) {
      return { gx: hp.gx, gy: hp.gy + 1, gz: hp.gz, rot: 0 };
    }

    // 4) stairs on a FILL piece -> the adjacent cell, climbing away from it
    if (kind === "stairs" && FILL_KINDS[hitPiece.kind]) {
      const dx = hitPoint.x - cx, dz = hitPoint.z - cz;
      if (Math.abs(dx) >= Math.abs(dz)) {
        const east = dx >= 0;
        return { gx: hp.gx + (east ? 1 : -1), gy: hp.gy, gz: hp.gz, rot: east ? 1 : 3 };
      }
      const south = dz >= 0;
      return { gx: hp.gx, gy: hp.gy, gz: hp.gz + (south ? 1 : -1), rot: south ? 0 : 2 };
    }

    // 5) a camera on any edge-holding piece -> that piece's own edge
    if (kind === "camera" && isEdgeKind(hitPiece.kind)) {
      return { gx: hp.gx, gy: hp.gy, gz: hp.gz, rot: hitPiece.rot | 0 };
    }
    return null;
  }
  bm.snapCandidate = snapCandidate;

  /* ================= raycast helpers ================= */
  const raycaster = new THREE.Raycaster();
  const NDC_CENTER = new THREE.Vector2(0, 0);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _planePt = new THREE.Vector3();
  const _nearbyMeshes = [];

  // the piece nearest the crosshair within ~20 m: the SAME answer for
  // snapping and for X, so what you aim at is what X removes
  function raycastNearbyPiece() {
    _nearbyMeshes.length = 0;
    const cp = CBZ.camera.position;
    CBZ.pieces.forEach(function (p) {
      if (!p.alive || !p.meshRef) return;
      const dx = p.pos.x - cp.x, dy = p.pos.y - cp.y, dz = p.pos.z - cp.z;
      if (dx * dx + dy * dy + dz * dz > PIECE_SCAN_R2 * (p.grid ? 2.5 : 1)) return;
      _nearbyMeshes.push(p.meshRef);
    });
    if (!_nearbyMeshes.length) return null;
    const hits = raycaster.intersectObjects(_nearbyMeshes, true);
    for (let i = 0; i < hits.length; i++) {
      let o = hits[i].object;
      if (o.material && o.material.userData && o.material.userData.noTint && o.material.transparent) continue; // light beams are not things
      while (o && (!o.userData || o.userData.pieceId == null)) o = o.parent;
      if (o && o.userData.pieceId != null) return { pieceId: o.userData.pieceId, hit: hits[i] };
    }
    return null;
  }

  // the edge of cell (gx,gz) nearest a world point
  function nearestEdge(gx, gz, pt) {
    const gr = bm.grid || { ox: 0, oz: 0 };
    const dx = pt.x - (gr.ox + gx * CELL), dz = pt.z - (gr.oz + gz * CELL);
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
  }
  // a multi-cell prefab is anchored at its min corner: centre it on the aim
  function anchorFor(kind, gx, gz, rot) {
    const def = B.defFor(kind, bm.grid);
    if (!def || !def.span) return { gx: gx, gz: gz };
    const st = B.slotTypeOf(kind);
    if (st === "edge" || st === "cam") {
      const n = def.span.w || 1, sh = Math.floor((n - 1) / 2);
      return (rot === 0 || rot === 2) ? { gx: gx - sh, gz: gz } : { gx: gx, gz: gz - sh };
    }
    const sp = B.spanOf(def, rot);
    return { gx: gx - Math.floor((sp.W - 1) / 2), gz: gz - Math.floor((sp.D - 1) / 2) };
  }
  // does this kind pick its rot from the aimed edge (walls, gates, poles)?
  function autoEdge(kind) {
    if (isEdgeKind(kind)) return true;
    const d = B.defFor(kind, bm.grid);
    return !!(d && d.edgeInset != null);
  }

  /* ================= the throttled targeting + ghost update ================= */
  function updateTarget() {
    if (!bm.active) return;
    raycaster.setFromCamera(NDC_CENTER, CBZ.camera);
    const gr = bm.grid;
    const ox = gr ? gr.ox : 0, oz = gr ? gr.oz : 0, oy = gr ? gr.oy : 0;

    let gx = null, gy = bm.level, gz = null, rot = bm.rot;
    let pieceHit = raycastNearbyPiece();
    let piece = pieceHit ? CBZ.pieces.get(pieceHit.pieceId) : null;
    // a piece on another grid (a neighbour's lot, a survival base) is not a socket here
    if (piece && ((piece.grid ? piece.grid.id : null) !== (gr ? gr.id : null))) { piece = null; pieceHit = null; }
    // kit pieces (walls, towers, cages) are not sockets for other kit pieces:
    // aiming across your yard at a wall should land the stash on the ground,
    // not on the wall. Cameras are the exception, they mount on them.
    if (piece && gr && piece.defRef && piece.defRef.kit && bm.kind !== "camera") { piece = null; pieceHit = null; }

    if (piece && piece.gridPos) {
      const cand = snapCandidate(bm.kind, { kind: piece.kind, gridPos: piece.gridPos, rot: piece.rot }, pieceHit.hit.point, raycaster.ray.direction, gr);
      if (cand) {
        gx = cand.gx; gy = cand.gy; gz = cand.gz; rot = cand.rot;
      } else {
        const edgeK = isEdgeKind(bm.kind);
        const n = pieceHit.hit.face ? pieceHit.hit.face.normal : null;
        // stacking on a top face: survival stacks any non-edge kind (all its
        // kinds are slabs); in the city only the slab kinds stack
        if (!edgeK && n && n.y > 0.5 && (!gr || FILL_KINDS[bm.kind])) {
          gx = piece.gridPos.gx; gz = piece.gridPos.gz; gy = piece.gridPos.gy + 1;
        } else {
          gx = piece.gridPos.gx; gz = piece.gridPos.gz; gy = piece.gridPos.gy;
          if (edgeK || autoEdge(bm.kind)) rot = nearestEdge(gx, gz, pieceHit.hit.point);
        }
      }
    }

    if (gx == null) {
      groundPlane.constant = -(oy + bm.level * WALL_H);
      const pt = raycaster.ray.intersectPlane(groundPlane, _planePt);
      if (pt) {
        gx = Math.round((pt.x - ox) / CELL); gz = Math.round((pt.z - oz) / CELL); gy = bm.level;
        if (autoEdge(bm.kind)) rot = nearestEdge(gx, gz, pt);
      }
    }

    if (gx == null) {
      bm.gx = null; bm.gy = bm.level; bm.gz = null; bm.lastValid = null;
      hideAllGhosts();
      setHint(hintLine({ ok: false, reason: "no target" }, affordability(bm.kind)));
      return;
    }

    if (autoEdge(bm.kind) || bm.kind === "stairs") bm.rot = rot;
    const an = anchorFor(bm.kind, gx, gz, bm.rot);
    bm.gx = an.gx; bm.gy = gy; bm.gz = an.gz;

    const v = B.validate(bm.kind, bm.gx, bm.gy, bm.gz, bm.rot, CBZ.netPid ? CBZ.netPid() : null, gr);
    bm.lastValid = v;
    renderGhost(v);
    const afford = affordability(bm.kind);
    setHint(hintLine(v, afford), !afford.ok || (gr && !v.ok));
  }

  /* ================= actions ================= */
  function tryPlace() {
    if (!bm.active) return;
    if (bm.gx == null) { CBZ.flashHint && CBZ.flashHint("No target", 1.0); return; }
    const afford = affordability(bm.kind);
    if (!afford.ok) {
      CBZ.flashHint && CBZ.flashHint(bm.grid ? "Need " + money(afford.price) : "Need " + afford.cost[afford.short] + " " + afford.short, 1.4);
      return;
    }
    const piece = B.place(bm.kind, bm.gx, bm.gy, bm.gz, bm.rot, { ownerId: CBZ.netPid ? CBZ.netPid() : null, grid: bm.grid });
    if (piece) {
      if (bm.grid) {
        const K = kit();
        if (afford.price && K) { K.charge(afford.price); if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }
      } else if (afford.cost) {
        const S = CBZ.econ && CBZ.econ.itemStore ? CBZ.econ.itemStore() : null;
        if (S) for (const mat in afford.cost) S.take(mat, afford.cost[mat]);
        if (CBZ.market && afford.cost.Wood) CBZ.market.recordBuy("materials", afford.cost.Wood / 10);
      }
      bm.placedStack.push(piece.id);
      CBZ.sfx && CBZ.sfx("coin");
      updateTarget();
    } else {
      const v = B.validate(bm.kind, bm.gx, bm.gy, bm.gz, bm.rot, null, bm.grid);
      CBZ.flashHint && CBZ.flashHint(cap(v.reason || "Can't place there"), 1.4);
    }
  }
  function tryDemolish() {
    if (!bm.active) return;
    raycaster.setFromCamera(NDC_CENTER, CBZ.camera);
    const hit = raycastNearbyPiece();
    if (!hit) { CBZ.flashHint && CBZ.flashHint("Nothing in range to demolish", 1.0); return; }
    const piece = CBZ.pieces.get(hit.pieceId);
    // OWNERSHIP GATE: ownerless (legacy) pieces, pieces you built, pieces in a
    // base you're authorized on, or (city) anything standing on a plot you own.
    // Raiders take bases down through DAMAGE, never through this verb.
    if (!piece) { CBZ.flashHint && CBZ.flashHint("Can't demolish that", 1.0); return; }
    const me = CBZ.netPid ? CBZ.netPid() : null;
    const K = kit();
    const onMyPlot = !!(piece.grid && K && K.plotOf && K.plotOf(piece));
    const ownedByMe = onMyPlot || piece.ownerId == null || piece.ownerId === me;
    const inMyBase = !ownedByMe && CBZ.baseAt && (function () {
      const rec = CBZ.baseAt(piece.pos.x, piece.pos.z);
      return !!(rec && rec.authorized.indexOf(me) >= 0);
    })();
    if (!ownedByMe && !inMyBase) { CBZ.flashHint && CBZ.flashHint("Can't demolish that", 1.0); return; }
    const idx = bm.placedStack.indexOf(hit.pieceId);
    if (idx >= 0) bm.placedStack.splice(idx, 1);
    const back = (piece.grid && K && K.refund) ? K.refund(piece) : 0;
    B.remove(hit.pieceId);
    CBZ.sfx && CBZ.sfx("hit");
    if (back > 0 && CBZ.flashHint) CBZ.flashHint("Torn down, " + money(back) + " back", 1.4);
    updateTarget();
  }
  function tryUndo() {
    if (!bm.active) return;
    while (bm.placedStack.length) {
      const id = bm.placedStack.pop();
      const p = CBZ.pieces.get(id);
      if (p && p.alive) {
        // an undo is a mistake fixed: the full price comes back
        const d = p.grid ? (p.defRef || B.CATALOG[p.kind]) : null;
        if (d && d.price) { CBZ.game.cash = (CBZ.game.cash || 0) + d.price; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
        B.remove(id);
        updateTarget();
        return;
      }
    }
    CBZ.flashHint && CBZ.flashHint("Nothing to undo this session", 1.0);
  }
  function selectKind(idx) {
    if (bm.grid) {
      const ks = catKinds();
      if (idx < 0 || idx >= ks.length) return;
      bm.kindIdx = idx; bm.kind = ks[idx];
    } else {
      if (idx < 0 || idx >= KINDS.length) return;
      bm.kindIdx = idx; bm.kind = KINDS[idx];
    }
    renderStrip();
    updateTarget();
  }
  function cycleCategory() {
    const C = cats(); if (!C.length) return;
    bm.cat = (bm.cat + 1) % C.length;
    bm.kindIdx = 0; bm.kind = catKinds()[0];
    renderStrip();
  }

  function canEnter() {
    const g = CBZ.game;
    if (!g || g.state !== "playing") return false;
    if (g.mode !== "city" && g.mode !== "survival") return false; // NOT escape
    if (CBZ.cityMenuOpen || CBZ.invOpen) return false;
    if (CBZ.player && (CBZ.player.driving || CBZ.player.dead)) return false;
    return true;
  }
  function enterBuildMode() {
    bm.grid = null; bm.plot = null;
    if (isCity()) {
      const K = kit();
      const P = CBZ.player;
      const plot = K && P ? K.plotAt(P.pos.x, P.pos.z, 4) : null;
      if (!plot) {
        if (CBZ.city && CBZ.city.note) CBZ.city.note("Buy the lot first", 1.8);
        else if (CBZ.flashHint) CBZ.flashHint("Buy the lot first", 1.8);
        return false;
      }
      bm.plot = plot; bm.grid = K.gridOf(plot);
      if (!bm.grid) return false;
    }
    bm.active = true;
    bm.rot = 0; bm.level = 0;
    if (bm.grid) {
      const C = cats();
      if (bm.cat >= C.length) bm.cat = 0;
      const ks = catKinds();
      if (bm.kindIdx >= ks.length) bm.kindIdx = 0;
      bm.kind = ks[bm.kindIdx] || "cwall";
    } else { bm.kindIdx = 0; bm.kind = KINDS[0]; }
    bm.placedStack.length = 0;
    if (isCity() && CBZ.cityHolster) CBZ.cityHolster(true); // frees R/F, see header
    showUI();
    updateTarget();
    return true;
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

    if (!bm.active) return;

    let handled = true;
    if (k === "t") bm.rot = (bm.rot + 1) % 4;
    else if (k === "r") bm.level = Math.min(LEVEL_MAX, bm.level + 1);
    else if (k === "f") bm.level = Math.max(0, bm.level - 1);
    else if (k === "e") tryPlace();
    else if (k === "x") tryDemolish();
    else if (k === "z") tryUndo();
    else if (k === "tab" && bm.grid) cycleCategory();
    else {
      const n = (bm.grid ? "123456789" : "123456").indexOf(k);
      if (n >= 0) selectKind(n);
      else handled = false;
    }
    if (!handled) return;

    e.preventDefault();
    e.stopPropagation();
    updateTarget();
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
    if (!canEnter() || (bm.grid && !isCity())) { exitBuildMode(); return; }
    acc += dt;
    if (acc < THROTTLE) return;
    acc = 0;
    updateTarget();
  });
})();
