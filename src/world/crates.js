/* ============================================================
   world/crates.js — wooden cover crates that break guard line-of-sight
   and create the stealth routes through the yard.

   NO-DECOY FIX: these read as "should be lootable" (they're crates,
   the game's own shorthand for a container everywhere else — see
   city/roofloot.js's roof stashes), but sat there as pure geometry.
   They now get a genuine PRY-OPEN interaction, modeled directly on
   roofloot.js's crackOpen: walk up, hold [E] through a short pry-beat
   (a chip prompt + a screen-shake "the lid fights back" jolt at the
   same timing roofloot uses), and it pops for a small amount of loot.
   Escape-mode has no cash economy (see systems/interact.js's search
   verb) — the payout is CIGS, the same currency every other yard
   interaction pays in, via CBZ.econ.addCigs. A cracked crate goes
   visibly EMPTY (a material swap, roofloot's own trick) so you don't
   walk the yard re-prying crates you already hit; the collider stays
   solid either way — it's still cover once it's a busted crate.

   Draw-call discipline unchanged: same 3 boxes per crate, shared
   COL palette materials. The pry-open path adds zero new geometry —
   only a material swap on crack (same cached CBZ.mat/addBox pool).

   F7 MIGRATION: crate(x,z,s) now routes through CBZ.spawnPiece (systems/
   pieces.js, F4) instead of calling world/materials.js's addBox directly.
   This is the migration PROOF for the Piece model — same compound-box
   geometry/materials/dimensions as before (moved into the inline def's
   build()), same solid + blockLOS behaviour, byte-identical scene.

   Geometry convention: build() returns the MAIN box Mesh itself (not
   ctx.group) with the two decorative boxes attached as ITS children at
   LOCAL offsets from the piece origin. This matters for two reasons:
     1. spawnPiece positions whatever build() returns at the piece's
        world pos — returning the main box directly (rather than wrapping
        it in a group) means its children inherit the correct world
        position for free, with no extra bookkeeping.
     2. CBZ.losBlockers is a flat Mesh[] tested via a NON-recursive
        raycast (see systems/pieces.js's new blockLOS handling) — a
        THREE.Group has no raycastable geometry of its own, so only a
        real Mesh registers as a sightline blocker. The old code only
        ever set blockLOS on the main box (the banding/bracket details
        never blocked LOS), so returning that specific mesh keeps the
        LOS-blocker count identical: 1 per crate, not 3.

   NOTE (documented, not "papered over"): addBox's collider omits y0/y1
   entirely for crates (never passed), which systems/physics.js treats as
   an unconditionally full-height wall that can never be stepped/vaulted
   over. spawnPiece's collider ALWAYS carries y0/y1 (here: the crate's
   real physical footprint, 0..s above its base) — a height-GATED
   collider. For every actor's actual traversal capability in this game
   (no vault/jump reaches a 2.6m+ box top), this is behaviourally
   identical to the old full-height collider; it only theoretically
   differs if something could get its feet above the crate's own top.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const { COL } = CBZ;
  const g = CBZ.game;

  const REACH = 2.2;          // [E] pry reach — a hair tighter than roofloot (ground-level, tighter yard)
  const CRACK_T = 0.9;        // the SAME pry-beat timing roofloot.js's CRACK_T uses

  // deterministic LCG — same seed shape every existing file in this codebase
  // uses; loot amount/flavor never shuffles between runs.
  let _s = 51301;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  const crateList = [];   // {x,z,s,lid,cracked}

  function crate(x, z, s) {
    s = s || 2.6;
    const half = s / 2;
    let lid = null;   // captured out of build() so the pry-open loot path can swap it dark

    const def = {
      footprint: { hx: half, hz: half },
      y0: -half, y1: half, // world y-range [0, s] once offset by pos.y (=half)
      build: function () {
        const main = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), CBZ.mat(COL.CRATE, {}));
        main.castShadow = true;
        main.receiveShadow = true;

        // darker plank banding so it reads as wood, not a flat cube
        // (same x/z/pos as the main box in the old code -> local (0,0,0))
        const band = new THREE.Mesh(new THREE.BoxGeometry(s + 0.06, s * 0.34, s + 0.06), CBZ.mat(COL.CRATE_D, {}));
        band.castShadow = false;
        band.receiveShadow = true;
        main.add(band);

        // a little corner bracket detail (old world y = s*0.92 -> local
        // offset from the main box's own centre at s/2 is s*0.42). Kept as
        // `lid` so crackOpen can swap it dark once busted open (roofloot's
        // "material SWAP reads looted" trick) — cloned mat so the swap never
        // repaints every crate sharing the cached CBZ.mat instance.
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, 0.08, s * 1.02), CBZ.mat(0x6e4a22, {}).clone());
        bracket.position.set(0, s * 0.42, 0);
        bracket.castShadow = false;
        bracket.receiveShadow = true;
        main.add(bracket);
        lid = bracket;

        return main;
      },
    };

    const piece = CBZ.spawnPiece(def, { pos: { x: x, y: half, z: z }, solid: true, blockLOS: true });
    crateList.push({ x, z, s, lid, cracked: false });
    return piece;
  }

  crate(-9, 22);
  crate(8, 28);
  crate(-12, 36);
  crate(11, 17);
  crate(0, 11, 2.2);

  // ---- CRACKING ONE OPEN (mirrors roofloot.js's crackOpen exactly) ----------
  function crackOpen(ct) {
    ct.cracked = true;
    if (ct.lid && ct.lid.material) ct.lid.material.color.setHex(0x2c2416);   // busted-open = dark, dead lid
    // a small haul — cigs are the only currency escape-mode actually has
    // (see entities/ai.js / guards.js CBZ.econ.addCigs call sites).
    const cigs = 2 + ((rng() * 5) | 0);
    if (CBZ.econ && CBZ.econ.addCigs) CBZ.econ.addCigs(cigs);
    if (CBZ.sfx) CBZ.sfx("coin");
    flashChip("Cracked the crate — +" + cigs + " cigs", 2.0);
  }

  // ---- the tiny prompt chip (one DOM node, hidden when idle; headless-safe) —
  //      byte-for-byte the same shape as roofloot.js's chip/chipText/dom ----
  let chip = null;
  function dom() {
    if (chip || typeof document === "undefined" || !document.body) return;
    try {
      chip = document.createElement("div");
      chip.id = "crateChip";
      chip.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:278px;z-index:24;display:none;" +
        "padding:6px 12px;border-radius:9px;background:rgba(8,14,22,.78);border:1px solid rgba(255,209,102,.30);" +
        "color:#ffe9bd;font:600 13px/1.2 'Fredoka',system-ui,sans-serif;pointer-events:none;text-shadow:0 1px 2px #000";
      document.body.appendChild(chip);
    } catch (e) { chip = null; }
  }
  let _chipLast, _chipHoldT = 0;
  function chipText(t) {
    if (t === _chipLast) return;
    dom(); if (!chip) return;
    _chipLast = t;
    if (!t) { chip.style.display = "none"; return; }
    chip.style.display = "block"; chip.textContent = t;
  }
  // a brief result line (the haul) shown OVER the prompt for a couple seconds,
  // then the chip clears itself — no persistent HUD hook exists in escape
  // mode (unlike city/roofloot.js's CBZ.city.note), so this is self-contained.
  function flashChip(t, secs) {
    dom(); if (!chip) return;
    _chipLast = t; _chipHoldT = secs;
    chip.style.display = "block"; chip.textContent = t;
  }

  // the un-cracked crate you're standing next to
  function crateNear() {
    const P = CBZ.player; if (!P) return null;
    for (const ct of crateList) {
      if (ct.cracked) continue;
      if (Math.hypot(P.pos.x - ct.x, P.pos.z - ct.z) <= REACH + ct.s * 0.5) return ct;
    }
    return null;
  }

  let cracking = null;   // { ct, t }
  let _promptT = 0;
  CBZ.onUpdate(42, function (dt) {
    if (_chipHoldT > 0) { _chipHoldT -= dt; if (_chipHoldT <= 0) chipText(null); }
    if (g.mode !== "escape" || g.state !== "playing") { cracking = null; return; }
    const P = CBZ.player;
    if (cracking) {
      const ct = cracking.ct;
      if (!P || ct.cracked || Math.hypot(P.pos.x - ct.x, P.pos.z - ct.z) > REACH + ct.s * 0.5 + 1) { cracking = null; chipText(null); return; }
      cracking.t += dt;
      chipText("Prying it open…");
      if (CBZ.shake && cracking.t > 0.4 && cracking._j !== 1) { cracking._j = 1; CBZ.shake(0.06); }   // the lid fights back
      if (cracking.t >= CRACK_T) { crackOpen(ct); cracking = null; }
      return;
    }
    // prompt scan at ~12 Hz (matches roofloot's own throttle — a walk-up
    // prompt doesn't need frame-rate reactions). Skipped while a result flash
    // is still holding the chip (flashChip owns it until _chipHoldT expires).
    if (_chipHoldT > 0) return;
    _promptT += dt;
    if (_promptT >= 1 / 12) {
      _promptT = 0;
      const ct = crateNear();
      chipText(ct ? "[E] Pry the crate open" : null);
    }
  });

  // [E] starts the pry — same document-level + stopPropagation pattern
  // roofloot.js uses so systems/interact.js's own key handling never double-fires.
  function onKey(e) {
    if (g.mode !== "escape" || g.state !== "playing" || cracking) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    const ct = crateNear();
    if (!ct) return;
    e.preventDefault();
    e.stopPropagation();
    cracking = { ct, t: 0 };
    if (CBZ.sfx) CBZ.sfx("clank");
  }
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", onKey);
})();
