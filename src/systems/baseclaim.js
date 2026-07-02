/* ============================================================
   systems/baseclaim.js — CBZ.baseClaim: OWNERSHIP (B6, BUILD-PLAN Stage
   B). The tool cupboard, BaseRecord, placement-rejection radius, door
   locks and lockable containers — the Rust-style "building privilege"
   layer sitting on top of B1-B5's piece/catalog/damage machinery.

   ------------------------------------------------------------------
   SLOT MODEL (3 new CATALOG kinds, registered directly into
   CBZ.building.CATALOG below — that object is the raw, mutable def
   registry building.js's own header explains was chosen specifically so
   assets.define's field-whitelist never strips this family's data; see
   that file's top comment):

     cupboard  — a small chest-like box. Occupies its OWN "tc" cell slot
                 (systems/building.js's slotFor/checkSupport), so it rides
                 ON TOP of a foundation/floor/roof/stairs at the same cell
                 instead of competing with it for the "fill" slot. Support
                 rule: needs a fill piece at its own (gx,gy,gz).
     container — a wood storage box. Same slot model as cupboard, its own
                 "box" cell slot (ONE per cell, per the task's steer —
                 no stacking multiple boxes on one cell this wave).
     door      — fills a doorframe's walk-through gap. Occupies "dr"+rot
                 (an edge slot DISTINCT from the doorframe's own "e"+rot,
                 so the two coexist at the same cell+edge instead of
                 double-claiming one slot) and REQUIRES a doorframe piece
                 already standing at that "e"+rot slot (support rule, see
                 building.js's checkSupport door branch).

   All three kinds' slot/support/MAX_SPAN rules live INSIDE building.js
   itself (private closures this file can't reach) — this file only
   supplies the CATALOG mesh/def data plus everything ownership-shaped:
   BaseRecord, the placement gate, door/container state + locks, verbs.

   ------------------------------------------------------------------
   GATE SEMANTICS (Rust-lite "building privilege"):
     • PLACEMENT: building.js's computeValidity gate (d) — CBZ.baseAt(x,z)
       covering the target point + the placer's pid not on `authorized`
       → "building blocked (foreign base)". First cupboard on virgin
       ground always succeeds (no record covers it yet).
     • DEMOLISH (X, buildmode.js): only pieces you own OR that sit inside
       a base radius you're authorized on. Raiders demolish someone
       else's base through DAMAGE (structdamage.js), never this verb —
       there's no "sneak in and demolish" shortcut.
     • DOOR/CONTAINER LOCKS: a `locked` piece refuses open/withdraw to
       anyone except its owner, a base-authorized pid, or — the W9-style
       BREACH RULE — anyone at all, for BREACH_WINDOW seconds after
       structdamage.js destroyed ANY piece inside that base's radius
       (simplification of "an adjacent wall/doorframe": this wave counts
       any destroyed piece in the radius, not just literally-adjacent
       ones, per the task's "keep minimal" steer — documented here).

   PERSISTENCE: BaseRecords ride their OWN netpersist.js rider (blob.base,
   beside blob.bld's established guarded line) — NOT folded into
   building.js's blob.bld, so a world can restore its base claims/auth
   lists independently of piece geometry. Door open/locked + container
   contents instead ride ON THE PIECE itself, as generic optional fields
   building.js's serialize()/apply() now passes through blind (see that
   file's B6 edits) — this file is the only thing that gives them meaning.
   Also wrapped into the single-player g.cityWorld ledger, copying
   city/familytree.js's exact `_xWrap` idiom (own guard flag `_bcWrap`).
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.building || !CBZ.pieces) return;
  if (CBZ.baseClaim) return; // idempotent (same guard idiom as the rest of this family)
  const THREE = window.THREE;
  const B = CBZ.building;
  const g = CBZ.game;

  const BASE_RADIUS = 30;     // metres — a founding cupboard's claim
  const BREACH_WINDOW = 300;  // seconds (5 min) — the W9-style raider window

  function pid() { return CBZ.netPid ? CBZ.netPid() : "solo"; }
  function nowSec() { return (g && g.elapsed) || 0; }

  /* ============================================================
     CATALOG additions — cupboard/container/door mesh defs. Sized off
     building.js's own exposed constants (B.CELL/B.WALL_T/B.DOOR_GAP_W/
     B.DOOR_GAP_H) so a door panel matches its doorframe's actual gap.
     ============================================================ */
  const WALL_T = B.WALL_T || 0.2;
  const DOOR_GAP_W = B.DOOR_GAP_W || 1.2;
  const DOOR_GAP_H = B.DOOR_GAP_H || 2.0;

  B.CATALOG.cupboard = {
    kind: "cupboard", label: "Tool Cupboard",
    footprint: { hx: 0.4, hz: 0.3 },
    y0: 0, y1: 0.8,
    hp: 150, cost: { Wood: 100 },
    solid: true, walkTop: false, blockLOS: false,
    build: function (ctx) {
      const body = new THREE.Mesh(CBZ.boxGeom(0.8, 0.8, 0.6), CBZ.cmat(0x3a4a5c));
      body.position.set(0, 0.4, 0);
      body.castShadow = true; body.receiveShadow = true;
      ctx.group.add(body);
      const trim = new THREE.Mesh(CBZ.boxGeom(0.84, 0.08, 0.64), CBZ.cmat(0x22303d));
      trim.position.set(0, 0.76, 0);
      ctx.group.add(trim);
    },
  };

  B.CATALOG.container = {
    kind: "container", label: "Storage Box",
    footprint: { hx: 0.5, hz: 0.35 },
    y0: 0, y1: 0.6,
    hp: 150, cost: { Wood: 80 },
    solid: true, walkTop: false, blockLOS: false,
    build: function (ctx) {
      const body = new THREE.Mesh(CBZ.boxGeom(1.0, 0.6, 0.7), CBZ.cmat(0x5a4630));
      body.position.set(0, 0.3, 0);
      body.castShadow = true; body.receiveShadow = true;
      ctx.group.add(body);
      const lid = new THREE.Mesh(CBZ.boxGeom(1.04, 0.08, 0.74), CBZ.cmat(0x6b5638));
      lid.position.set(0, 0.62, 0);
      ctx.group.add(lid);
    },
  };

  B.CATALOG.door = {
    kind: "door", label: "Wood Door",
    footprint: { hx: DOOR_GAP_W / 2, hz: WALL_T / 2 },
    y0: 0, y1: DOOR_GAP_H,
    hp: 150, cost: { Wood: 50 },
    // Group-raycast caveat (same as wall/doorframe, see building.js's own
    // comment on it): blockLOS stays false unless build() returns a real
    // Mesh AND opts.blockLOS is threaded through, neither of which this
    // kind claims this wave.
    solid: true, walkTop: false, blockLOS: false,
    build: function (ctx) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(DOOR_GAP_W * 0.92, DOOR_GAP_H * 0.96, 0.08), CBZ.cmat(0x6b4a2b));
      m.position.set(0, DOOR_GAP_H / 2, 0);
      m.castShadow = true; m.receiveShadow = true;
      return m; // real Mesh (not ctx.group) — a single hit-testable node, matching wall's own convention
    },
  };

  /* ============================================================
     BASERECORD REGISTRY — {id, ownerPid, cx, cz, radius, authorized[],
     createdAt, upkeepPaid, lastBreach, cupboardId}. CBZ.baseAt(x,z) is
     the NEAREST record whose radius actually covers the point (modeled
     on city/turf.js's cityZoneOwner "nearest wins" shape, but gated by
     radius since bases — unlike turf zones — don't tile the whole map).
     ============================================================ */
  const bases = new Map(); // id -> BaseRecord
  let baseSeq = 0;

  CBZ.baseAt = function (x, z) {
    let best = null, bd = Infinity;
    bases.forEach(function (rec) {
      const dx = rec.cx - x, dz = rec.cz - z, dd = dx * dx + dz * dz;
      if (dd <= rec.radius * rec.radius && dd < bd) { bd = dd; best = rec; }
    });
    return best;
  };

  // canAccess(piece, who) — the shared door/container lock gate: owner,
  // base-authorized, or inside the W9 breach window. An UNLOCKED piece is
  // always accessible (locked===false/undefined short-circuits true).
  function canAccess(piece, who) {
    if (!piece.locked) return true;
    if (piece.ownerId != null && piece.ownerId === who) return true;
    const rec = CBZ.baseAt(piece.pos.x, piece.pos.z);
    if (rec) {
      if (rec.authorized.indexOf(who) >= 0) return true;
      if (rec.lastBreach && (nowSec() - rec.lastBreach) <= BREACH_WINDOW) return true;
    }
    return false;
  }
  // isAuthorizedOwner(piece, who) — gate for CHANGING a lock (owner or
  // base-authorized; the breach window does NOT let a raider re-lock/
  // unlock at will, only pass through an already-locked door/container).
  function isAuthorizedOwner(piece, who) {
    if (piece.ownerId != null && piece.ownerId === who) return true;
    const rec = CBZ.baseAt(piece.pos.x, piece.pos.z);
    return !!(rec && rec.authorized.indexOf(who) >= 0);
  }
  function recFor(piece) { return CBZ.baseAt(piece.pos.x, piece.pos.z); }

  // door collider swap — world/door.js's exact pattern (splice out of
  // CBZ.colliders when open, push back when closed), adapted to a piece's
  // own single collider (piece.colliders[0], spawnPiece's single-AABB
  // path since door has no def.colliders()). Idempotent both ways, so it's
  // safe to call unconditionally from both the fresh-place hook AND the
  // replay hook without checking which one already ran.
  function syncDoorCollider(piece) {
    if (piece.kind !== "door") return;
    const c = piece.colliders && piece.colliders[0];
    if (!c) return;
    const idx = CBZ.colliders.indexOf(c);
    if (piece.open) { if (idx >= 0) CBZ.colliders.splice(idx, 1); }
    else if (idx < 0) CBZ.colliders.push(c);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  /* ============================================================
     PLACE/REMOVE HOOKS — building.js's B6 extension points (CBZ.
     onPiecePlace fires after EVERY successful place(), fresh or
     replayed; CBZ.onPieceRemove fires for every piece a remove()/cascade
     is about to kill; CBZ.onPieceReplay fires from B.apply() AFTER the
     saved open/locked/contents fields have been restored onto the piece,
     so derived state — the door collider — can be re-synced against the
     RESTORED value instead of the fresh-place default).
     ============================================================ */
  function afterPlace(piece /* , opts */) {
    if (piece.kind === "cupboard") {
      // Only mint a NEW BaseRecord if this cupboard doesn't already land
      // inside an existing base's radius — a 2nd cupboard inside your own
      // claim is just redundancy, not a second competing claim.
      const existing = CBZ.baseAt(piece.pos.x, piece.pos.z);
      if (!existing) {
        const owner = piece.ownerId != null ? piece.ownerId : pid();
        const rec = {
          id: "base_" + (++baseSeq).toString(36),
          ownerPid: owner, cx: piece.pos.x, cz: piece.pos.z, radius: BASE_RADIUS,
          authorized: [owner], createdAt: nowSec(), upkeepPaid: nowSec(), lastBreach: 0,
          cupboardId: piece.id,
        };
        bases.set(rec.id, rec);
      }
    } else if (piece.kind === "container") {
      if (piece.contents == null) piece.contents = {};
      if (piece.locked == null) piece.locked = false;
    } else if (piece.kind === "door") {
      if (piece.open == null) piece.open = false;
      if (piece.locked == null) piece.locked = false;
      syncDoorCollider(piece); // no-op for the default closed state; matters once B.apply restores open:true
    }
  }
  CBZ.onPiecePlace = afterPlace;

  function onRemove(piece) {
    if (piece.kind === "cupboard") {
      const rec = CBZ.baseAt(piece.pos.x, piece.pos.z);
      // Rust semantics: the FOUNDING cupboard falling dissolves the whole
      // claim (building privilege lifts for the entire radius) — a
      // secondary/redundant cupboard inside the same claim dying does
      // nothing (rec.cupboardId still points at the founder).
      if (rec && rec.cupboardId === piece.id) bases.delete(rec.id);
    }
    if (containerPanelPiece === piece) closeContainerPanel();
  }
  CBZ.onPieceRemove = onRemove;

  function onReplay(piece /* , rec */) {
    if (piece.kind === "door") { syncDoorCollider(piece); return; } // re-sync against the just-restored piece.open
    if (piece.kind !== "cupboard") return;
    // B6: a full world reload hands out FRESH piece ids (pieceSeq restarts
    // at boot) — blob.base's cupboardId still points at the OLD id from
    // before the reload. If that old id no longer resolves to a live piece
    // (i.e. this IS the reload case, not just a redundant 2nd cupboard
    // replaying into an already-fixed-up record), repoint cupboardId at
    // THIS freshly-replayed piece so a later destroy of it still correctly
    // dissolves the record it founded. Guarded so a genuine secondary
    // cupboard at the same position never clobbers an already-live pointer.
    const rec = CBZ.baseAt(piece.pos.x, piece.pos.z);
    if (rec && !CBZ.pieces.has(rec.cupboardId)) rec.cupboardId = piece.id;
  }
  CBZ.onPieceReplay = onReplay;

  /* ============================================================
     CITY-MODE VERBS — city/interactions.js's registry loads AFTER this
     file in index.html (needed BEFORE it in the interaction-slot sense
     but not at parse time), so wiring is LAZY: the first onUpdate tick
     that finds CBZ.interactions installs the 3 zones and never runs
     again — same "ensureXWraps" idiom as city/familytree.js's
     save-wrap installer.
     ============================================================ */
  const ZONE_R = 2.5, DOOR_ZONE_R = 2.2, SCAN_CAP = 60 * 60; // generous scan cap (m²) — interactions.js applies the REAL radius filter itself
  function nearestOfKind(px, pz, kind) {
    let best = null, bd = SCAN_CAP;
    CBZ.pieces.forEach(function (p) {
      if (!p.alive || p.kind !== kind) return;
      const dx = p.pos.x - px, dz = p.pos.z - pz, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = p; }
    });
    return best;
  }

  let cityVerbsWired = false;
  function wireCityVerbs() {
    if (cityVerbsWired || !CBZ.interactions) return;
    cityVerbsWired = true;
    const I = CBZ.interactions;

    I.registerZone({
      id: "baseclaim-cupboard", kind: "tc", radius: ZONE_R,
      find: function (px, pz) { return nearestOfKind(px, pz, "cupboard"); },
      options: [
        {
          id: "tc-authorize", slot: "e", prio: 1,
          label: function (t) { const rec = recFor(t); return (rec && rec.authorized.indexOf(pid()) >= 0) ? "Already authorized" : "Authorize"; },
          onSelect: function (t) {
            const rec = recFor(t); if (!rec) return;
            const who = pid();
            if (rec.authorized.indexOf(who) < 0) { rec.authorized.push(who); CBZ.flashHint && CBZ.flashHint("✅ Authorized on this base", 1.4); }
            else CBZ.flashHint && CBZ.flashHint("Already authorized", 1.2);
          },
        },
        {
          // stub: B8 wires real decay/upkeep cost — this just surfaces the verb
          // so the panel/UX contract exists before the economy lands behind it.
          id: "tc-upkeep", slot: "i", prio: 1, label: "Deposit upkeep",
          onSelect: function () { CBZ.flashHint && CBZ.flashHint("🚧 Upkeep not yet required", 1.6); },
        },
        {
          id: "tc-demolish", slot: "j", prio: 1, bad: true, label: "Demolish base",
          canShow: function (t) { const rec = recFor(t); return !!(rec && rec.ownerPid === pid()); },
          onSelect: function (t) { CBZ.building.remove(t.id); CBZ.flashHint && CBZ.flashHint("💥 Base demolished", 1.4); CBZ.sfx && CBZ.sfx("hit"); },
        },
      ],
    });

    I.registerZone({
      id: "baseclaim-container", kind: "container", radius: ZONE_R,
      find: function (px, pz) { return nearestOfKind(px, pz, "container"); },
      options: [
        {
          id: "container-open", slot: "e", prio: 1,
          label: function (t) { return canAccess(t, pid()) ? "Open" : "🔒 Locked"; },
          onSelect: function (t) {
            if (!canAccess(t, pid())) { CBZ.flashHint && CBZ.flashHint("🔒 Locked", 1.2); return; }
            openContainerPanel(t);
          },
        },
        {
          id: "container-lock", slot: "i", prio: 1,
          canShow: function (t) { return isAuthorizedOwner(t, pid()); },
          label: function (t) { return t.locked ? "Unlock" : "Lock"; },
          onSelect: function (t) { t.locked = !t.locked; CBZ.flashHint && CBZ.flashHint(t.locked ? "🔒 Locked" : "🔓 Unlocked", 1.2); },
        },
      ],
    });

    I.registerZone({
      id: "baseclaim-door", kind: "door", radius: DOOR_ZONE_R,
      find: function (px, pz) { return nearestOfKind(px, pz, "door"); },
      options: [
        {
          id: "door-toggle", slot: "e", prio: 1,
          label: function (t) { return t.open ? "Close" : "Open"; },
          onSelect: function (t) {
            if (!t.open && !canAccess(t, pid())) { CBZ.flashHint && CBZ.flashHint("🔒 Locked", 1.2); return; }
            t.open = !t.open; syncDoorCollider(t); CBZ.sfx && CBZ.sfx("door");
          },
        },
        {
          id: "door-lock", slot: "i", prio: 1,
          canShow: function (t) { return isAuthorizedOwner(t, pid()); },
          label: function (t) { return t.locked ? "Unlock" : "Lock"; },
          onSelect: function (t) { t.locked = !t.locked; CBZ.flashHint && CBZ.flashHint(t.locked ? "🔒 Locked" : "🔓 Unlocked", 1.2); },
        },
      ],
    });
  }
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.LATE + 1 : 91, wireCityVerbs);

  /* ============================================================
     SURVIVAL-MODE FALLBACK — city/interactions.js's whole panel is gated
     on g.mode === "city" (grepped: releasePanel() fires unconditionally
     the instant mode isn't city), so survival gets its own minimal
     proximity+key path: within 2.5m + E when not in build mode.
       E        = primary verb (authorize / open panel / toggle open).
       SHIFT+E  = secondary verb (demolish base / toggle lock).
     Audited against every existing keydown in src/: no other shift+e
     binding exists (only shift+b: wealth.js/explosives.js). Plain E in
     survival IS also bound by systems/grapple.js (grab a nearby ragdoll)
     — a real but harmless overlap (grab() only acts on a body, this only
     acts on a cupboard/container/door; both firing on the rare occasion
     you're near both is no worse than buildmode.js's own documented
     N-vs-killstreaks trade-off).
     ============================================================ */
  const REACH_SURVIVAL = 2.5;
  function nearestOwnershipPiece() {
    if (!CBZ.player) return null;
    const p = CBZ.player.pos;
    let best = null, bd = REACH_SURVIVAL * REACH_SURVIVAL;
    CBZ.pieces.forEach(function (pc) {
      if (!pc.alive) return;
      if (pc.kind !== "cupboard" && pc.kind !== "container" && pc.kind !== "door") return;
      const dx = pc.pos.x - p.x, dz = pc.pos.z - p.z, dd = dx * dx + dz * dz;
      if (dd <= bd) { bd = dd; best = pc; }
    });
    return best;
  }
  addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (!g || g.mode !== "survival" || g.state !== "playing") return;
    if (CBZ.buildMode && CBZ.buildMode.active) return; // build mode owns E there
    if (CBZ.invOpen) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    const piece = nearestOwnershipPiece();
    if (!piece) return;
    const who = pid();
    if (piece.kind === "cupboard") {
      if (e.shiftKey) {
        const rec = recFor(piece);
        if (rec && rec.ownerPid === who) { CBZ.building.remove(piece.id); CBZ.flashHint && CBZ.flashHint("💥 Base demolished", 1.4); }
        else CBZ.flashHint && CBZ.flashHint("🚫 Not your base", 1.2);
      } else {
        const rec = recFor(piece);
        if (rec) {
          if (rec.authorized.indexOf(who) < 0) { rec.authorized.push(who); CBZ.flashHint && CBZ.flashHint("✅ Authorized on this base", 1.4); }
          else CBZ.flashHint && CBZ.flashHint("Already authorized", 1.2);
        }
      }
    } else if (piece.kind === "container") {
      if (e.shiftKey) {
        if (isAuthorizedOwner(piece, who)) { piece.locked = !piece.locked; CBZ.flashHint && CBZ.flashHint(piece.locked ? "🔒 Locked" : "🔓 Unlocked", 1.2); }
        else CBZ.flashHint && CBZ.flashHint("🚫 Not authorized", 1.2);
      } else if (canAccess(piece, who)) openContainerPanel(piece);
      else CBZ.flashHint && CBZ.flashHint("🔒 Locked", 1.2);
    } else if (piece.kind === "door") {
      if (e.shiftKey) {
        if (isAuthorizedOwner(piece, who)) { piece.locked = !piece.locked; CBZ.flashHint && CBZ.flashHint(piece.locked ? "🔒 Locked" : "🔓 Unlocked", 1.2); }
        else CBZ.flashHint && CBZ.flashHint("🚫 Not authorized", 1.2);
      } else {
        if (!piece.open && !canAccess(piece, who)) { CBZ.flashHint && CBZ.flashHint("🔒 Locked", 1.2); return; }
        piece.open = !piece.open; syncDoorCollider(piece); CBZ.sfx && CBZ.sfx("door");
      }
    }
  });

  /* ============================================================
     CONTAINER PANEL — a minimal self-styled overlay (city/captives.js's
     DOM convention: plain divs, inline cssText, built once). Shows the
     container's contents (count-map) with a "Take all" button per row,
     and a "Deposit all" button per item currently in CBZ.game.inventory.
     DEVIATION FROM THE TASK TEXT: "deposit-all-of-selected-hotbar-item"
     assumes a hotbar-selection accessor — systems/inventory.js exposes
     none (grepped: `selIdx` is a private closure var) — so this lists
     "Deposit all" for EVERY carried item instead of just the selected
     one. Still one click, still minimal, and doesn't invent a new public
     API on inventory.js just for this panel.
     ============================================================ */
  let containerPanelPiece = null, panelEl = null, bodyEl = null;
  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }
  function buildPanel() {
    if (panelEl || typeof document === "undefined" || !document.body) return;
    panelEl = el("div",
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "z-index:9001;width:min(420px,92vw);max-height:76vh;overflow:auto;" +
      "font:14px/1.4 system-ui,Segoe UI,Roboto,sans-serif;color:#eef;" +
      "background:rgba(14,16,22,0.95);border:1px solid rgba(120,150,200,0.35);" +
      "border-radius:12px;padding:0;display:none;box-shadow:0 18px 60px rgba(0,0,0,0.7);");
    const head = el("div", "display:flex;align-items:center;justify-content:space-between;" +
      "padding:12px 14px;border-bottom:1px solid rgba(120,150,200,0.22);");
    head.appendChild(el("div", "font:700 14px system-ui;color:#fff;", "📦 Container"));
    const close = el("div", "cursor:pointer;font:700 16px system-ui;color:#9aa6bd;", "✕");
    close.addEventListener("click", closeContainerPanel);
    head.appendChild(close);
    panelEl.appendChild(head);
    bodyEl = el("div", "padding:10px 14px 14px;");
    panelEl.appendChild(bodyEl);
    document.body.appendChild(panelEl);
  }
  function row(label, count, btnLabel, onClick) {
    const r = el("div", "display:flex;align-items:center;justify-content:space-between;" +
      "padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);");
    r.appendChild(el("div", "color:#dfe6f2;", label + (count > 1 ? " ×" + count : "")));
    const btn = el("div", "cursor:pointer;padding:3px 9px;border-radius:6px;" +
      "background:rgba(120,150,200,0.18);color:#cfe0ff;font:600 12px system-ui;", btnLabel);
    btn.addEventListener("click", onClick);
    r.appendChild(btn);
    return r;
  }
  function renderPanel() {
    if (!bodyEl || !containerPanelPiece) return;
    bodyEl.innerHTML = "";
    bodyEl.appendChild(el("div", "font:700 11px system-ui;letter-spacing:1px;text-transform:uppercase;color:#9fb6da;margin:2px 0 6px;", "Contents"));
    const contents = containerPanelPiece.contents || {};
    let any = false;
    for (const name in contents) {
      if (!(contents[name] > 0)) continue;
      any = true;
      bodyEl.appendChild(row(name, contents[name], "Take all", (function (n) { return function () { takeAll(n); }; })(name)));
    }
    if (!any) bodyEl.appendChild(el("div", "color:#7e8aa3;font:12px system-ui;padding:4px 0 10px;", "Empty"));
    bodyEl.appendChild(el("div", "font:700 11px system-ui;letter-spacing:1px;text-transform:uppercase;color:#9fb6da;margin:12px 0 6px;", "Your inventory"));
    const inv = (g && g.inventory) || {};
    let anyInv = false;
    for (const name in inv) {
      if (!(inv[name] > 0)) continue;
      anyInv = true;
      bodyEl.appendChild(row(name, inv[name], "Deposit all", (function (n) { return function () { depositAll(n); }; })(name)));
    }
    if (!anyInv) bodyEl.appendChild(el("div", "color:#7e8aa3;font:12px system-ui;padding:4px 0;", "Nothing carried"));
  }
  function takeAll(name) {
    if (!containerPanelPiece) return;
    const have = (containerPanelPiece.contents || {})[name] || 0;
    if (have <= 0) return;
    if (CBZ.econ && CBZ.econ.addItem) CBZ.econ.addItem(name, have);
    else { g.inventory[name] = (g.inventory[name] || 0) + have; CBZ.refreshInventory && CBZ.refreshInventory(); }
    delete containerPanelPiece.contents[name];
    renderPanel();
  }
  function depositAll(name) {
    if (!containerPanelPiece) return;
    const have = (g.inventory && g.inventory[name]) || 0;
    if (have <= 0) return;
    containerPanelPiece.contents = containerPanelPiece.contents || {};
    containerPanelPiece.contents[name] = (containerPanelPiece.contents[name] || 0) + have;
    delete g.inventory[name];
    CBZ.refreshInventory && CBZ.refreshInventory();
    renderPanel();
  }
  function openContainerPanel(piece) {
    buildPanel();
    if (!panelEl) return;
    containerPanelPiece = piece;
    if (piece.contents == null) piece.contents = {};
    renderPanel();
    panelEl.style.display = "block";
  }
  function closeContainerPanel() {
    if (panelEl) panelEl.style.display = "none";
    containerPanelPiece = null;
  }
  addEventListener("keydown", function (e) {
    if (containerPanelPiece && (e.key === "Escape" || e.key === "escape")) closeContainerPanel();
  });

  /* ============================================================
     CBZ.baseClaim — public API + BaseRecord serialize()/apply(), the
     netpersist.js rider (blob.base, wired beside blob.bld — see that
     file's B6 edits) and the single-player g.cityWorld wrap (copying
     city/familytree.js's `_xWrap` idiom verbatim, own guard `_bcWrap`).
     ============================================================ */
  function serialize() {
    const out = [];
    bases.forEach(function (rec) {
      out.push({
        id: rec.id, ownerPid: rec.ownerPid, cx: rec.cx, cz: rec.cz, radius: rec.radius,
        authorized: rec.authorized.slice(), createdAt: rec.createdAt, upkeepPaid: rec.upkeepPaid,
        lastBreach: rec.lastBreach, cupboardId: rec.cupboardId,
      });
    });
    return { v: 1, bases: out };
  }
  function apply(blob) {
    if (!blob || blob.v !== 1 || !Array.isArray(blob.bases)) { if (blob) console.warn("[baseclaim] apply: blob v" + blob.v + " — skipped"); return; }
    bases.clear();
    let maxSeq = 0;
    for (let i = 0; i < blob.bases.length; i++) {
      const r = blob.bases[i];
      if (!r || !r.id) continue;
      bases.set(r.id, {
        id: r.id, ownerPid: r.ownerPid || null, cx: r.cx || 0, cz: r.cz || 0, radius: r.radius || BASE_RADIUS,
        authorized: Array.isArray(r.authorized) ? r.authorized.slice() : [],
        createdAt: r.createdAt || 0, upkeepPaid: r.upkeepPaid || 0, lastBreach: r.lastBreach || 0,
        cupboardId: r.cupboardId || null,
      });
      const m = /^base_([a-z0-9]+)$/.exec(r.id);
      if (m) { const n = parseInt(m[1], 36); if (n > maxSeq) maxSeq = n; }
    }
    if (maxSeq > baseSeq) baseSeq = maxSeq;
  }
  function reset() { bases.clear(); baseSeq = 0; }

  CBZ.baseClaim = {
    BASE_RADIUS: BASE_RADIUS, BREACH_WINDOW: BREACH_WINDOW,
    list: function () { return Array.from(bases.values()); },
    get: function (id) { return bases.get(id) || null; },
    canAccess: canAccess, isAuthorizedOwner: isAuthorizedOwner,
    serialize: serialize, apply: apply, reset: reset,
  };
  CBZ.baseClaimReset = reset; // top-level guard-call convention (see cityFamilyTreeReset)

  // ---- SINGLE-PLAYER PERSIST — city/familytree.js's bank.js-style pattern
  function stampBaseClaim() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.baseClaim = serialize();
  }
  function ensureBaseClaimSaveWraps() {
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._bcWrap) {
      const w = function () { stampBaseClaim(); return commit.apply(this, arguments); };
      w._bcWrap = true; CBZ.cityWorldCommit = w;
      if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._bcWrap) {
        const col = CBZ.cityWorldCollect;
        const wc = function () { stampBaseClaim(); return col.apply(this, arguments); };
        wc._bcWrap = true; CBZ.cityWorldCollect = wc;
      }
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.baseClaim) apply(led.baseClaim);
  }
  if (CBZ.onUpdate) {
    CBZ.onUpdate(45.93, function () { // right beside familytree.js's own 45.92 tick
      if (!g) return;
      ensureBaseClaimSaveWraps();
      hydrateFromLedger();
    });
  }
})();
