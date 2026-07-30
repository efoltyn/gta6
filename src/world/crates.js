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

   THE CHESTS ARE NOT THE POINT (PRISON_ARMORY_SPINE, declared in world/
   gunroom.js). OWNER, verbatim: "it's not about getting cigarettes and opening
   the dumb chests — it's getting a keycard which already gets you into a very
   cool armory room." These crates were competing with that: bright orange-tan
   lumber shouting from across the yard, a gold-trimmed prompt chip, and a
   payout in the one currency the game already drowns in. Two changes, and
   NEITHER deletes a crate — a crate is still cover, still pryable, still worth
   something:
     1. THEY STOP SHOUTING. The palette drops to a weathered, desaturated
        grey-brown and the chip's gold accent goes to steel, so the eye lands
        on the ARMORY sign across the yard instead of on a box.
     2. TWO OF THEM SERVE THE SPINE. The two crates nearest the armory approach
        (11,17) and (0,11) hold a TOOL instead of only smokes — a Hacksaw Blade
        and a Lockpick. The blade is the point: world/gunroom.js's inner cage
        now grinds open under one, which is the first verb "Hacksaw Blade" has
        ever had in this game (it was fence-value loot and nothing else). A
        tool crate pays roughly half the cigs, so the yard's total contraband
        barely moves — the crates were re-POINTED, not nerfed.
   Flag off (?cfg_PRISON_ARMORY_SPINE=0) restores the original colours, the
   original chip and a cigs-only payout on all five, with the rng stream drawn
   in the same order either way.

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

  // gunroom.js is the OWNING file for this flag (loads at index.html:447, this
  // at :630). Undefined reads as ON so a load-order accident cannot silently
  // put the shouting crates back.
  const SPINE = !(CBZ.CONFIG && CBZ.CONFIG.PRISON_ARMORY_SPINE === false);
  // weathered, rained-on lumber instead of fresh orange pine. Same three boxes.
  const C_MAIN = SPINE ? 0x6f5a3d : COL.CRATE;
  const C_BAND = SPINE ? 0x53422c : COL.CRATE_D;
  const C_LID = SPINE ? 0x4a3c26 : 0x6e4a22;

  // deterministic LCG — same seed shape every existing file in this codebase
  // uses; loot amount/flavor never shuffles between runs.
  let _s = 51301;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  const crateList = [];   // {x,z,s,lid,cracked,tool}

  // `tool` is an economy.js item name; a crate that carries one is a crate that
  // feeds the keycard→armory chain instead of competing with it. It is a fixed
  // property of the CRATE, never a roll — the world keeps the same promise
  // every run, which is what makes a route learnable.
  function crate(x, z, s, tool) {
    s = s || 2.6;
    const half = s / 2;
    let lid = null;   // captured out of build() so the pry-open loot path can swap it dark

    const def = {
      footprint: { hx: half, hz: half },
      y0: -half, y1: half, // world y-range [0, s] once offset by pos.y (=half)
      build: function () {
        const main = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), CBZ.mat(C_MAIN, {}));
        main.castShadow = true;
        main.receiveShadow = true;

        // darker plank banding so it reads as wood, not a flat cube
        // (same x/z/pos as the main box in the old code -> local (0,0,0))
        const band = new THREE.Mesh(new THREE.BoxGeometry(s + 0.06, s * 0.34, s + 0.06), CBZ.mat(C_BAND, {}));
        band.castShadow = false;
        band.receiveShadow = true;
        main.add(band);

        // a little corner bracket detail (old world y = s*0.92 -> local
        // offset from the main box's own centre at s/2 is s*0.42). Kept as
        // `lid` so crackOpen can swap it dark once busted open (roofloot's
        // "material SWAP reads looted" trick) — cloned mat so the swap never
        // repaints every crate sharing the cached CBZ.mat instance.
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, 0.08, s * 1.02), CBZ.mat(C_LID, {}).clone());
        bracket.position.set(0, s * 0.42, 0);
        bracket.castShadow = false;
        bracket.receiveShadow = true;
        main.add(bracket);
        lid = bracket;

        return main;
      },
    };

    const piece = CBZ.spawnPiece(def, { pos: { x: x, y: half, z: z }, solid: true, blockLOS: true });
    crateList.push({ x, z, s, lid, cracked: false, tool: (SPINE && tool) || null });
    return piece;
  }

  crate(-9, 22);
  crate(8, 28);
  crate(-12, 36);
  // the two on the armory approach. The blade is the one that matters: it is
  // the second route through world/gunroom.js's inner cage, and until now
  // "Hacksaw Blade" was an item with a fence price and no verb anywhere.
  crate(11, 17, 2.6, "Hacksaw Blade");
  crate(0, 11, 2.2, "Lockpick");

  // ---- CRACKING ONE OPEN (mirrors roofloot.js's crackOpen exactly) ----------
  // TOOL FLAVOUR: a line that points at the door the tool opens, not at the
  // number it added. "+4 cigs" teaches the player that crates are the point;
  // "that'll bite through a padlock" teaches him where to walk next.
  const TOOL_LINE = {
    "Hacksaw Blade": "Hacksaw blade — that'll bite through a padlock.",
    "Lockpick": "A lockpick. Somebody was planning something.",
  };
  function crackOpen(ct) {
    ct.cracked = true;
    if (ct.lid && ct.lid.material) ct.lid.material.color.setHex(0x2c2416);   // busted-open = dark, dead lid
    // a small haul — cigs are the only currency escape-mode actually has
    // (see entities/ai.js / guards.js CBZ.econ.addCigs call sites). ONE rng()
    // draw either way, so the stream reads identically with the flag off.
    const roll = rng();
    const cigs = ct.tool ? (1 + ((roll * 3) | 0)) : (2 + ((roll * 5) | 0));
    if (CBZ.econ && CBZ.econ.addCigs) CBZ.econ.addCigs(cigs);
    if (ct.tool && CBZ.econ && CBZ.econ.addItem) CBZ.econ.addItem(ct.tool, 1);
    if (CBZ.sfx) CBZ.sfx(ct.tool ? "key" : "coin");
    flashChip(ct.tool
      ? (TOOL_LINE[ct.tool] || (ct.tool + " — pocketed.")) + "  (+" + cigs + " cigs)"
      : "Cracked the crate — +" + cigs + " cigs", ct.tool ? 2.8 : 2.0);
  }

  // ---- the tiny prompt chip (one DOM node, hidden when idle; headless-safe) —
  //      byte-for-byte the same shape as roofloot.js's chip/chipText/dom ----
  let chip = null;
  function dom() {
    if (chip || typeof document === "undefined" || !document.body) return;
    try {
      chip = document.createElement("div");
      chip.id = "crateChip";
      // gold trim reads as "treasure". A crate is a crate: steel trim, cooler
      // type colour, so the only warm light in the yard is the armory's.
      chip.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:278px;z-index:24;display:none;" +
        "padding:6px 12px;border-radius:9px;background:rgba(8,14,22,.78);border:1px solid " +
        (SPINE ? "rgba(139,149,161,.26)" : "rgba(255,209,102,.30)") + ";" +
        "color:" + (SPINE ? "#cdd6e0" : "#ffe9bd") + ";font:600 13px/1.2 'Fredoka',system-ui,sans-serif;pointer-events:none;text-shadow:0 1px 2px #000";
      document.body.appendChild(chip);
    } catch (e) { chip = null; }
  }
  // ---- ratchet declaration (see CBZ.prisonPromptAudit in interactions.js) ----
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "crate", act: "e", was: "[E] Pry the crate open" }
  );

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
      // PRISON_TOUCH_PROMPTS: "[E]" is unactionable on a touchscreen, and this
      // chip is a textContent slot (chipText, line 150) so pill HTML cannot go
      // in it. On touch the prompt becomes a real pill in the shared band.
      // Unlike the polled prison verbs this one can fire the PLAIN "e" key:
      // onKey below is a genuine document keydown listener, so touch.js's
      // synthesized KeyboardEvent reaches it.
      const pilled = !!(ct && CBZ.prisonPrompt &&
        CBZ.prisonPrompt("crate", "e", "Pry the crate open", null));
      if (!ct && CBZ.prisonPromptClear) CBZ.prisonPromptClear("crate");
      chipText(pilled ? null : (ct ? "[E] Pry the crate open" : null));
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

  /* Ratchet for "the chests are not the point": `toolCrates` counts crates
     whose payout FEEDS the keycard→armory spine rather than competing with it,
     and may only go UP; `crates` is printed beside it so a "fix" that deletes
     boxes cannot pass (the owner asked for quieter crates, not fewer). */
  CBZ.crateAudit = function () {
    let tools = 0, cracked = 0;
    for (let i = 0; i < crateList.length; i++) {
      if (crateList[i].tool) tools++;
      if (crateList[i].cracked) cracked++;
    }
    return { spine: SPINE, crates: crateList.length, toolCrates: tools, cracked: cracked, muted: SPINE };
  };
})();
