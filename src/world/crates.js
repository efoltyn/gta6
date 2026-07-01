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
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const { addBox, COL } = CBZ;
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
    addBox(x, s / 2, z, s, s, s, COL.CRATE, { solid: true, blockLOS: true });
    // darker plank banding so it reads as wood, not a flat cube
    addBox(x, s / 2, z, s + 0.06, s * 0.34, s + 0.06, COL.CRATE_D, { cast: false });
    // a little corner bracket detail — kept as `lid` so crackOpen can swap it
    // dark once busted open (roofloot's "material SWAP reads looted" trick)
    const lid = addBox(x, s * 0.92, z, s * 1.02, 0.08, s * 1.02, 0x6e4a22, { cast: false });
    crateList.push({ x, z, s, lid, cracked: false });
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
