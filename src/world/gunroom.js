/* ============================================================
   world/gunroom.js - THE GUN ROOM. The locked armory with physical
   weapon-rack slots, and the spine of the whole escape game.

   OWNER (CLAUDE.md LAW 1, verbatim): "it's not about getting cigarettes and
   opening the dumb chests — it's getting a keycard which already gets you
   into a very cool armory room." And on why he ran the jail for hours:
   "the jail is dumb but I ran to get the keycard relentlessly… that's what
   makes it a game."

   THE GUN-ROOM GRAMMAR, and every line below serves one of its three rules:
     (a) IT WAS LOCKED, and you could SEE what was behind the lock. A locked
         door with something visible behind it out-motivates any quest marker.
     (b) IT WAS THE BEST-MADE ROOM IN THE GAME. Polish spread evenly creates
         no gradient, so nothing pulls; polish spent ASYMMETRICALLY here is
         what makes the player walk toward this door instead of a chest.
     (c) THE REWARD CHANGED HIS CATEGORY — "the only character with a gun in
         the jail" — not a bigger number.

   WHAT THIS FILE FIXES, and all three were arithmetic, not taste:
     1. YOU COULD NOT SEE IN. The "barred gate" was a SOLID 0.6 x 6 x 3.0 slab
        with two decorative cross-bars stuck on the front. Rule (a) — the whole
        reason the room works — was never actually shipped. The gate is now a
        real welded barred leaf over a fully transparent collider pane: the
        collider rect, the LOS blocker and the mover are BYTE-IDENTICAL (only
        `material` changed), so nothing about detection or physics moves, and
        you can finally see the rack from the yard.
     2. THE SIGNAGE WAS INSIDE THE DOOR. The red ARMORY band sat at x=19 with
        a 0.2 depth (18.9..19.1) — i.e. buried INSIDE the gate slab (18.7..19.3)
        — and the status lamp sat at x=20, INSIDE the room behind that slab.
        Both were invisible in the only state that matters: locked. They are
        now on the outside wall face where they read from across the yard.
     3. THE CROSS-BARS DID NOT RIDE THE GATE. They were scene-level static
        boxes, so opening the gate left two bars hanging in the empty doorway.
        core/batch.js's walk() never descends into a Mesh and always skips a
        `userData.mover` subtree, so parenting them to the gate both fixes the
        bug and keeps them out of the static merge for free.

   AND WHAT IT ADDS — A LADDER OF DOORS, because one door is a lock and two
   doors are a game. Behind the rack's five slots there is now an INNER CAGE
   holding the one long gun the rack does not: the BOLT SNIPER. Its own barred
   gate answers to a HIGHER tier than the keycard — the Warden's own
   "Gun-Room Key", which systems/economy.js has been handing out through
   bribe / pickpocket / corpse loot since the day it shipped and which, until
   now, OPENED NOTHING. That item was a stat fiction by CLAUDE.md's own
   definition; it has a door now. Second route: a Hacksaw Blade, ground
   through the padlock over ~6 s of held [E] — which is what gives the yard
   crates something to be FOR (see world/crates.js).

   DRAW-CALL DISCIPLINE. Static opaque dressing uses plain addBox and is
   merged by core/batch.js exactly like the rest of the prison shell. The two
   MOVERS cannot be batched (by design), so every bar of each gate is WELDED
   into ONE BufferGeometry at build time: a whole barred gate is 1 draw call,
   not 14. Only genuinely emissive / transparent pieces (lamps, light cones,
   floor pools) cost a call each, and there are ten of them in the room.

   Flag: CBZ.CONFIG.PRISON_ARMORY_SPINE (default true) is the one-line revert
   for ALL of the above — the room falls back to the exact geometry, the exact
   floor tone, the exact band/lamp coordinates and the exact pack positions it
   shipped with. world/crates.js, entities/keycard.js and systems/quests.js
   read the same flag (declared HERE, in the owning file, per CLAUDE.md's
   config.js Edit-race rule).
============================================================ */
(function () {
  "use strict";
  // SHOW DON'T TELL (JAIL_SHOW_DONT_TELL, declared in entities/ai.js, gated by
  // systems/capture.js). Returns true when the line was suppressed.
  function tellHint(m, s) { if (CBZ.jailTell) return CBZ.jailTell.hint(m, s); if (CBZ.flashHint) try { CBZ.flashHint(m, s); } catch (e) {} return false; }

  const CBZ = window.CBZ;
  const THREE = window.THREE;
  const { addBox, roomShell } = CBZ;
  const ROOT = CBZ.prisonRoot || CBZ.scene;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_ARMORY_SPINE == null) CBZ.CONFIG.PRISON_ARMORY_SPINE = true;
  const SPINE = !!CBZ.CONFIG.PRISON_ARMORY_SPINE;

  /* ---- 2026-08-05: THE ARMORY IS A KEY DOOR, NOT A PRICE ------------------
     OWNER: "The armory door needs a key card… It's dumb that an amount of
     money can get you into the armory."

     Both gates in this room now pass `power:false` to the shared lock, so the
     loyalty ledger's buy-your-way-in route is off HERE and nowhere else. The
     line they print collapses from four clauses that the HUD truncated —
     "needs a Keycard, the police, $204,167 more, or 10 more guns un…" — to the
     card the door actually reads. Both, not just the outer one the owner was
     standing at: they are two locks in one room and fixing one would have left
     the identical cash quote six metres inside it.

     Nothing else about the door moves. The keycard route, the police route and
     the cop-role bypass are byte-for-byte what they were, because those are
     things the door physically respects; route 4 was the only one that wasn't.
     PRISON_ARMORY_KEY_ONLY=false hands the ledger route back to both gates. */
  if (CBZ.CONFIG.PRISON_ARMORY_KEY_ONLY == null) CBZ.CONFIG.PRISON_ARMORY_KEY_ONLY = true;
  // undefined (not false) when reverted, so the lock's own default path runs
  const LOCK_POWER = CBZ.CONFIG.PRISON_ARMORY_KEY_ONLY === false ? undefined : false;

  // ------------------------------------------------------------------
  //  shared palette + the three build helpers (hoisted above the shell so
  //  the gate itself can use them — they were previously declared after it)
  // ------------------------------------------------------------------
  const mats = {
    dark: new THREE.MeshLambertMaterial({ color: 0x161a20 }),
    black: new THREE.MeshLambertMaterial({ color: 0x080a0c }),
    bore: new THREE.MeshLambertMaterial({ color: 0x010203 }),
    steel: new THREE.MeshLambertMaterial({ color: 0x48515c }),
    worn: new THREE.MeshLambertMaterial({ color: 0x747f8c }),
    tan: new THREE.MeshLambertMaterial({ color: 0x8b6a42 }),
    polymer: new THREE.MeshLambertMaterial({ color: 0x232a24 }),
    brass: new THREE.MeshLambertMaterial({ color: 0xd6a33b }),
    redShell: new THREE.MeshLambertMaterial({ color: 0x9d2523 }),
    skin: new THREE.MeshLambertMaterial({ color: 0xf0c39a }),
    // added for the room build-out; the weapon-appearance builders only ever
    // read the names above, so extra keys are inert to them.
    bar: new THREE.MeshLambertMaterial({ color: 0x39424e }),
    rubber: new THREE.MeshLambertMaterial({ color: 0x1b1e23 }),
    olive: new THREE.MeshLambertMaterial({ color: 0x3f4a33 }),
    kevlar: new THREE.MeshLambertMaterial({ color: 0x2b3a2c }),
  };

  function box(parent, sx, sy, sz, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  function cyl(parent, r, len, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  /* WELD — merge an authored list of boxes into ONE mesh.
     `specs` is [[x,y,z,w,h,d], …] in the RESULT mesh's own local frame.
     This exists for exactly one reason: core/batch.js cannot merge anything
     under a mover (it returns before descending), so a barred gate built the
     obvious way is fourteen live draw calls forever. Welded, it is one — and
     because the weld happens at build time the gate stays a single Object3D
     that rides its parent's transform with no bookkeeping. Degrades to a
     Group of plain meshes if BufferGeometryUtils is somehow absent. */
  function weld(specs, material, cast) {
    const BGU = THREE.BufferGeometryUtils;
    const geos = [];
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const g = new THREE.BoxGeometry(s[3], s[4], s[5]);
      g.applyMatrix4(m4.makeTranslation(s[0], s[1], s[2]));
      geos.push(g);
    }
    if (BGU && BGU.mergeBufferGeometries && geos.length) {
      const merged = BGU.mergeBufferGeometries(geos);
      if (merged) {
        for (let i = 0; i < geos.length; i++) geos[i].dispose();
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = cast !== false;
        mesh.receiveShadow = true;
        return mesh;
      }
    }
    const grp = new THREE.Group();
    for (let i = 0; i < geos.length; i++) {
      const m = new THREE.Mesh(geos[i], material);
      m.castShadow = cast !== false;
      m.receiveShadow = true;
      grp.add(m);
    }
    return grp;
  }

  /* STENCIL — blocky painted lettering from thin boxes, run-length collapsed
     (a row of "111" is ONE box, not three). 3x5 glyphs, drawn in the plane
     x = const with the text running along +Z and up along +Y, which is the
     reading orientation for somebody standing in the yard looking east. */
  const FONT = {
    A: ["111", "101", "111", "101", "101"],
    R: ["111", "101", "111", "110", "101"],
    M: ["101", "111", "101", "101", "101"],
    O: ["111", "101", "101", "101", "111"],
    Y: ["101", "101", "111", "010", "010"],
  };
  function stencil(text, x, yTop, z0, px, color) {
    let z = z0;
    for (let i = 0; i < text.length; i++) {
      const rows = FONT[text[i]];
      if (rows) {
        for (let r = 0; r < rows.length; r++) {
          let c = 0;
          while (c < 3) {
            if (rows[r][c] !== "1") { c++; continue; }
            let run = 1;
            while (c + run < 3 && rows[r][c + run] === "1") run++;
            addBox(x, yTop - (r + 0.5) * px, z + (c + run / 2) * px,
              0.05, px, px * run, color, { cast: false, receive: false });
            c += run;
          }
        }
      }
      z += px * 4;   // 3 wide + a 1px gap
    }
    return z - z0 - px;
  }

  // ------------------------------------------------------------------
  //  THE SHELL
  // ------------------------------------------------------------------
  roomShell({
    x0: 19, x1: 29, z0: -6, z1: 8, h: 6,
    // Rule (b): the floor is the largest surface in the room and the cheapest
    // thing to make read as a hardened facility — dark rubber matting instead
    // of the same blue-grey concrete every other prison room has.
    wall: 0x515a66, floor: SPINE ? 0x272b31 : 0x3a414b,
    door: { side: "W", center: 1, width: 3.0 },
  });

  // red "ARMORY" band. It used to sit at x=19 with a 0.2 depth, which put it
  // fully INSIDE the gate slab (18.7..19.3) — visible only once the gate had
  // already opened, i.e. never when it mattered. Now on the outside face.
  addBox(SPINE ? 18.62 : 19, 5.4, 1, SPINE ? 0.16 : 0.2, 0.8, 2.8, 0xc94d3a, { cast: false });

  // ------------------------------------------------------------------
  //  THE GATE — the locked door you can SEE THROUGH
  // ------------------------------------------------------------------
  // The mesh itself is unchanged in geometry, position, collider and LOS
  // membership; under the flag only its MATERIAL changes, to a near-invisible
  // pane, and the visible gate becomes one welded barred leaf parented to it.
  const gate = addBox(19, 3, 1, 0.6, 6, 3.0, 0x2a2f38, { solid: true, blockLOS: true, emissive: 0x111418, ei: 0.4 });
  gate.userData.mover = true;

  if (SPINE) {
    gate.material.transparent = true;
    gate.material.opacity = 0.05;
    gate.material.depthWrite = false;
    gate.material.emissive.setHex(0x000000);
    gate.castShadow = false;          // an invisible slab must not cast a solid shadow
    gate.receiveShadow = false;

    const BZ = [];
    BZ.push([0, 0, -1.42, 0.26, 5.9, 0.16]);      // stiles
    BZ.push([0, 0, 1.42, 0.26, 5.9, 0.16]);
    BZ.push([0, 2.87, 0, 0.26, 0.18, 3.0]);       // head + sill rails
    BZ.push([0, -2.87, 0, 0.26, 0.18, 3.0]);
    BZ.push([0, 1.2, 0, 0.26, 0.16, 3.0]);        // the two original cross-bars,
    BZ.push([0, -1.0, 0, 0.26, 0.16, 3.0]);       // now part of the leaf that MOVES
    for (let i = 0; i < 7; i++) BZ.push([0, 0, -1.2 + i * 0.4, 0.13, 5.7, 0.13]);
    // padlock on the YARD side of the leaf — the lock has to be part of what
    // you see from outside, or "locked" is a hint string instead of an object
    BZ.push([-0.17, 0.35, 1.06, 0.30, 0.44, 0.30]);
    const leaf = weld(BZ, mats.bar, true);
    gate.add(leaf);
  } else {
    addBox(19, 4.2, 1, 0.7, 0.18, 3.0, 0x4a525c, { cast: false });
    addBox(19, 2.0, 1, 0.7, 0.18, 3.0, 0x4a525c, { cast: false });
  }

  // Status lamp. Was at (20, 4.4, 1) — INSIDE the room, behind a solid slab.
  // A door light nobody can see is not a door light; it lives on the outside
  // wall face beside the reader now.
  const lamp = SPINE
    ? addBox(18.60, 3.34, 2.86, 0.18, 0.18, 0.18, 0xff3b3b, { emissive: 0xff0000, ei: 1.0, cast: false })
    : addBox(20, 4.4, 1, 0.18, 0.18, 0.18, 0xff3b3b, { emissive: 0xff0000, ei: 1.0, cast: false });
  lamp.userData.mover = true;

  if (SPINE) {
    // the card reader the keycard actually answers to, and the painted sign
    addBox(18.62, 2.34, 2.86, 0.14, 0.42, 0.30, 0x21262e, { cast: false });
    addBox(18.52, 2.40, 2.86, 0.04, 0.10, 0.20, 0x39ffd0, { emissive: 0x12b89a, ei: 0.9, cast: false });
    addBox(18.72, 3.34, 2.86, 0.06, 0.34, 0.30, 0x21262e, { cast: false });   // lamp backplate
    stencil("ARMORY", 18.71, 4.05, 3.50, 0.115, 0xd9dee5);
    addBox(18.70, 3.36, 4.80, 0.04, 0.06, 2.64, 0xd9dee5, { cast: false });   // underline
  }

  const armory = { gate, lamp, collider: gate.userData.collider, open: false, t: 0, slots: [] };

  // ------------------------------------------------------------------
  //  THE RACK — a weapon is supported by the hardware it is displayed on.
  //
  //  The old "shelves" sat ABOVE the weapon receivers while a second glowing
  //  pad floated half a metre below. Nothing touched anything. Keep the warm
  //  backboard and two-row inventory, but give every slot one slotted upright
  //  and one measured shelf whose top is used to seat that model's own bounds.
  // ------------------------------------------------------------------
  addBox(27.8, 1.75, 1, 0.55, 2.7, 11.6, 0x3c2f22, {});
  for (let i = -2; i <= 2; i++)
    addBox(27.44, 1.75, 1 + i * 2.0, 0.09, 2.30, 0.08, 0x11161c, { cast: false });

  function fallbackGun() {
    const g = new THREE.Group();
    box(g, 0.15, 0.10, 0.54, mats.steel, 0, 0.04, -0.3);
    box(g, 0.12, 0.23, 0.12, mats.dark, 0, -0.15, -0.02, -0.2);
    g.userData.muzzle = new THREE.Vector3(0, 0.06, -0.62);
    return g;
  }

  // a HANDGUN-sized silhouette needs more scale to read at rack distance than a
  // rifle does. One list instead of the old `id === "sidearm" || id === "taser"`
  // test, because the rack now carries five small guns rather than two.
  const SMALL = { sidearm: 1, taser: 1, revolver: 1, deagle: 1, uzi: 1 };
  function rackScale(id) { return SMALL[id] ? 1.25 : 1.05; }
  function buildRackModel(id) {
    const builder = CBZ.weaponAppearance && CBZ.weaponAppearance[id];
    // Appearance builders serve held weapons too, and many deliberately add a
    // skin-coloured hand around the grip. A display context reuses the same
    // canonical gun geometry while refusing that held-only material. The
    // traverse is a defensive backstop for a future builder that bypasses the
    // supplied helpers.
    const displayBox = function () {
      if (arguments[4] === mats.skin) return null;
      return box.apply(null, arguments);
    };
    const displayCyl = function () {
      if (arguments[3] === mats.skin) return null;
      return cyl.apply(null, arguments);
    };
    const model = builder ? builder({ THREE, box: displayBox, cyl: displayCyl, mat: mats, display: true }) : fallbackGun();
    model.traverse(function (o) { if (o.material === mats.skin) o.visible = false; });
    model.scale.setScalar(rackScale(id));
    model.rotation.set(0, 0, 0);
    return model;
  }

  /* ==================================================================
     EVERY GUN IN THE GAME IS IN THIS ROOM (PRISON_ARMORY_FULL_RACK).

     OWNER: "the armory needs to have all the guns."

     CBZ.FPS_WEAPONS declares fourteen and this room is the ISSUE store for
     thirteen of them. The armory carried six — five on the rack and the bolt
     sniper in the cage — so seven weapons the game fully models, animates and
     gives a voice to existed nowhere a player could ever pick one up in the
     prison. That is the gun-room grammar failing its own rule (c): the room is
     supposed to be where a CATEGORY changes hands.

     THE FOURTEENTH IS CONTRABAND AND IS DELIBERATELY ABSENT. `shank` is the one
     weapon in the roster nobody issues (weapons/appearances/shank.js: "Nobody
     issued it, nobody finished it"), and systems/economy.js:114 syncShankWeapon
     un/locks it off the Shiv row of the bag on every addItem/takeItem — so its
     rack IS the inventory, and a blade on a guard's wall would be the bug.
     Recorded HERE because its NOT being recorded here is the whole fault:
     tools/prison-polish-check.mjs counted the roster against this wall and
     called the room short by one (missing=["shank"]) for months.

     They are placed by what they are, not dumped in a row:
       · THE RACK (nine, open the moment the keycard turns) — every gun a screw
         could plausibly be holding: three handguns, three long guns, two
         machine pistols and the taser. The four new ones go on the LOWER shelf
         run, which the rack has always had and never used, so the board, the
         brackets and the five original positions are untouched.
       · THE CAGE (four GUNS, behind the Warden's key or a hacksaw) — the ones
         that change what game you are playing: the bolt sniper on its plinth,
         plus the M249, the RPG and the 40mm on a wall rack beside it. REACH and
         EXPLOSIVES are the categorical tier; that is why they are the ones
         behind the second door rather than the first.
         The demolition crate built further down shares the cage as a fourteenth
         slot — 9 rack + 4 cage guns + it — but it is an ITEM slot (`slot.item`,
         a count into the bag), not a weapon unlock. So the tier is asserted over
         GUN slots: a bare `gatedSlots === 4` reads 5 the moment the cage stocks
         anything that is not a rifle, and this file's own RATCHET below says
         gatedSlots may only go UP. Count guns.
     Flag false → the exact five-and-one the room shipped with.
     ================================================================== */
  if (CBZ.CONFIG.PRISON_ARMORY_FULL_RACK == null) CBZ.CONFIG.PRISON_ARMORY_FULL_RACK = true;
  const FULL = SPINE && CBZ.CONFIG.PRISON_ARMORY_FULL_RACK !== false;

  const rackData = [
    // ---- TOP row: shelfY is the physical top each model is seated onto ----
    { id: "sidearm", z: -3.0, shelfY: 1.82, name: "9MM SIDEARM" },
    { id: "shotgun", z: -1.0, shelfY: 1.82, name: "12G PUMP" },
    { id: "carbine", z: 1.0, shelfY: 1.82, name: "M4 CARBINE" },
    { id: "smg", z: 3.0, shelfY: 1.82, name: "COMPACT SMG" },
    { id: "taser", z: 5.0, shelfY: 1.82, name: "X26 TASER" },
  ];
  if (FULL) {
    // ---- LOWER row -----------------------------------------------------
    rackData.push(
      { id: "revolver", z: -3.0, shelfY: 0.62, name: ".357 MAGNUM" },
      { id: "ak47", z: -1.0, shelfY: 0.62, name: "AK-47" },
      { id: "uzi", z: 1.0, shelfY: 0.62, name: "MICRO UZI" },
      { id: "deagle", z: 3.0, shelfY: 0.62, name: ".50 DESERT EAGLE" }
    );
  }

  function makeSlot(data) {
    const model = buildRackModel(data.id);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const spanZ = Math.max(0.70, bounds.max.z - bounds.min.z);
    const shelfLen = Math.min(1.76, spanZ + 0.18);
    const pad = addBox(27.13, data.shelfY, data.z, 0.64, 0.07, shelfLen,
      0x11161c, { cast: false, emissive: 0x030507, ei: 0.35 });
    // Two turned-up retainers make the support legible at rack distance and
    // stop it reading as another stripe painted behind the gun.
    const end = Math.max(0.18, shelfLen / 2 - 0.10);
    addBox(26.83, data.shelfY + 0.09, data.z - end, 0.07, 0.18, 0.09, 0x11161c, { cast: false });
    addBox(26.83, data.shelfY + 0.09, data.z + end, 0.07, 0.18, 0.09, 0x11161c, { cast: false });
    // Slot ownership toggles this model's VISIBILITY at runtime. Keep its parent
    // matrix live when the rest of the static prison set is frozen.
    model.userData.dynamic = true;
    // Back surface is x=27.525. Seat the model from its own AABB: bottom on the
    // shelf, longitudinal centre in the bay, rear-most part just proud of the
    // board. No per-weapon eyeballed offsets and no intersections by accident.
    model.position.set(27.42 - bounds.max.x, data.shelfY + 0.045 - bounds.min.y,
      data.z - (bounds.min.z + bounds.max.z) * 0.5);
    ROOT.add(model);
    const slot = { id: data.id, name: data.name, pad, model, taken: false, cool: 0, x: 26.2, z: data.z };
    armory.slots.push(slot);
    return slot;
  }
  rackData.forEach(makeSlot);

  /* ---- AN EMPTY BRACKET IS THE RECEIPT (PRISON_RACK_EMPTIES) ---------------
     OWNER: "when I take a gun it turns green under it, instead of just removing
     the gun from the wall as it should do."

     He is describing a UI tell standing in for a physical fact. The rifle stayed
     bolted to the wall after you took it, shrunk by 8% (invisible at rack
     distance) with a green pad glowing under it — a status LED explaining a
     thing the world could simply have shown by not having the rifle there any
     more. Two wrong readings fall out of it: the rack still looks fully stocked
     after you have cleared it, and green — the colour every door lamp in this
     room uses for OPEN — reads as "available" on the one gun that is gone.

     The gun leaves the wall. The pad goes DARK, because an unlit bracket is what
     an empty bracket looks like, and the lit ones now genuinely mean "there is a
     weapon here". Flag false = the old shrink-and-glow, byte for byte. */
  if (CBZ.CONFIG.PRISON_RACK_EMPTIES == null) CBZ.CONFIG.PRISON_RACK_EMPTIES = true;
  function refreshSlotVisual(slot) {
    // weapon slots read ownership off the weapon roster; an ITEM slot (the
    // demolition crate) owns its own `taken` — items live in the bag, and the
    // bag emptying (a charge SPENT) must not restock the crate mid-run.
    const owned = slot.item ? !!slot.taken : !!(CBZ.hasWeapon && CBZ.hasWeapon(slot.id));
    if (!slot.item) slot.taken = owned;
    if (CBZ.CONFIG.PRISON_RACK_EMPTIES === false) {
      slot.pad.material.color.setHex(owned ? 0x254f35 : 0x11161c);
      slot.pad.material.emissive.setHex(owned ? 0x0b3b1b : 0x080b10);
      slot.model.visible = true;
      slot.model.scale.setScalar(rackScale(slot.id) * (owned ? 0.92 : 1));
      return;
    }
    slot.model.visible = !owned;
    slot.model.scale.setScalar(rackScale(slot.id));
    slot.pad.material.color.setHex(owned ? 0x0b0e12 : 0x11161c);
    slot.pad.material.emissive.setHex(owned ? 0x000000 : 0x080b10);
  }

  function pickupSlot(slot) {
    if (slot.item) {
      // an ITEM slot: a COUNT into the mode's bag (systems/economy.js
      // itemStore — g.inventory here, g.cityInv in a city), never a weapon
      // unlock. Stocked once; the crate refills with the rack on a new run.
      if (slot.taken) return;
      const S = CBZ.econ && CBZ.econ.itemStore ? CBZ.econ.itemStore() : null;
      if (!S) return;
      S.add(slot.item, slot.grant || 1);
      slot.taken = true;
      refreshSlotVisual(slot);
      CBZ.sfx("pickup");
      if (CBZ.pickupNote) { try { CBZ.pickupNote(slot.name + " ×" + (slot.grant || 1), { rare: true }); } catch (e) {} }
      else tellHint("Took " + (slot.grant || 1) + " charges — [B] plants, hold [B] fires.", 2.2);
      return;
    }
    const owned = CBZ.hasWeapon && CBZ.hasWeapon(slot.id);
    if (owned && CBZ.currentWeaponId === slot.id) return;
    const first = owned ? false : (CBZ.unlockWeapon && CBZ.unlockWeapon(slot.id, { select: true }));
    if (owned && CBZ.setCurrentWeapon) CBZ.setCurrentWeapon(slot.id);
    refreshSlotVisual(slot);
    CBZ.sfx(first ? "pickup" : "equip");
    // THE QUIET PICKUP NOTE, not a shout. systems/hud.js:130-151 records the
    // owner hating "LUXURY WATCH in red huge on screen"; a rifle off a rack is
    // the same event. The boxed hotbar chip lighting up IS "equipped", so that
    // half of the line is deleted outright.
    if (CBZ.pickupNote) { try { CBZ.pickupNote(slot.name, { rare: true }); } catch (e) {} }
    // (fallback only — pickupNote owns this normally.) "Q/wheel" is a keyboard
    // and a mouse; a thumb has the swap button, which the hotbar already shows.
    else tellHint((first ? "Picked up " : "Equipped ") + slot.name +
      (CBZ.touchMode ? "." : " — Q/wheel swaps."), 1.8);
  }

  // ==================================================================
  //  RULE (b): THE BEST-MADE ROOM IN THE GAME
  // ==================================================================
  // Everything below is DRESSING: no colliders, no userData, cast:false on
  // the smalls, so core/batch.js folds the opaque half into the existing
  // static merge. The transparent/emissive pieces (10 of them) are the only
  // ones that cost a draw call, and they are the ones doing the pulling.
  const inner = { gate: null, leaf: null, lamp: null, collider: null, open: false, t: 0, saw: 0, sawMsg: 0 };

  /* ---- A PIECE OF FURNITURE IS ONE COLLIDER ------------------------------
     MEASURED (tools/visual-presets/prison-rooms.mjs, baseline
     artifacts/visual-comparisons/prison-rooms-audit): this room was 221 props,
     88 solid, 8 used and 125 DEAD in 140 m2 — the worst dead COUNT in the
     compound. But the top of that list is not decoration, it is the
     FURNITURE: the sniper's plinth (1.026 m3), the heavy rack's backboard
     (0.849), the workbench apron (0.624) and the bench top itself (0.288)
     were every one of them drawn with `{}` and no `solid`, so the best-made
     room in the game was a room you walked straight through.
     `unit()` puts ONE collider over a whole piece of furniture and everything
     standing on it. That is the honest physics — a bench is one bench, not
     eleven independent boxes — and it is what stops the vise, the stripped
     gun, the parts tray and the ammunition being filed as scenery.
     WHAT IT DELIBERATELY DOES NOT TOUCH: the five rack slots, the two gates,
     the cage panes, the lock ladder, the pads or any weapon model.
     tools/prison-polish-check.mjs measures those and they are the reason the
     room exists. Nor the rubber matting (3 cm — the floor's own surface, the
     same class as a painted line) or the luminaire housings and task strip
     (they are the light; rule (b)'s whole pull is that wash over the guns). */
  // PRISON_PROP_HONESTY_V1 (declared world/cellblock.js, which parses first)
  // is the one-line revert: off, and every collider added below goes away and
  // the room is walk-through dressing again exactly as it shipped.
  const HONEST = CBZ.CONFIG && CBZ.CONFIG.PRISON_PROP_HONESTY_V1 !== false;
  const unit = function (x0, z0, x1, z1, y1) {
    if (!HONEST) return null;
    const c = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0: 0, y1: y1 };
    (CBZ.colliders || (CBZ.colliders = [])).push(c);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return c;
  };

  if (SPINE) {
    // ---- light. There are no real lights in this scene, so a luminaire is a
    // housing + an emissive lens + a translucent cone + a floor pool. Four
    // cheap pieces read as one warm wash across the guns, which is the whole
    // "see something bright at the back of a dark room" pull.
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffcf8a, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide,
    });
    const poolMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide,
    });
    const luminaire = function (x, z, span, coneR, poolR) {
      addBox(x, 5.62, z, 0.50, 0.22, span, 0x2b313a, { cast: false });
      addBox(x, 5.46, z, 0.42, 0.09, span - 0.16, 0xffe6b0, { emissive: 0xffb347, ei: 1.0, cast: false });
      // the shaft has to REACH the pool it makes, or it reads as a floating
      // cone: lens at y 5.46, pool at 0.085, so span 0.28..5.48
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.5, coneR, 5.2, 14, 1, true), coneMat);
      cone.position.set(x, 2.88, z);
      ROOT.add(cone);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(poolR, 20), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.085, z);
      ROOT.add(pool);
    };
    luminaire(26.4, -1.6, 1.4, 2.0, 1.7);
    luminaire(26.4, 4.0, 1.4, 2.0, 1.7);

    // task strip washing the rack backboard from just above it
    addBox(27.50, 3.34, 1, 0.26, 0.10, 11.2, 0x2b313a, { cast: false });
    addBox(27.42, 3.22, 1, 0.10, 0.07, 11.0, 0xffe6b0, { emissive: 0xffb347, ei: 0.9, cast: false });

    // ---- rubber matting: a runner down the rack lane, a pad at the bench
    addBox(26.5, 0.075, 1, 2.0, 0.03, 11.4, 0x1b1e23, { cast: false });
    addBox(23.5, 0.075, 6.5, 3.4, 0.03, 1.6, 0x1b1e23, { cast: false });

    // ---- pegboard + hung tools, south wall over the bench
    addBox(23.5, 2.30, 7.66, 3.2, 1.70, 0.06, 0x2f3742, { cast: false });
    for (let i = 0; i < 9; i++) addBox(22.1 + i * 0.36, 1.62, 7.60, 0.05, 0.05, 0.10, 0x8b95a1, { cast: false });
    addBox(22.30, 2.62, 7.58, 0.09, 0.62, 0.09, 0x8b95a1, { cast: false });   // wrench
    addBox(22.30, 2.92, 7.58, 0.22, 0.10, 0.09, 0x8b95a1, { cast: false });
    addBox(22.95, 2.66, 7.58, 0.08, 0.54, 0.08, 0x747f8c, { cast: false });   // pliers
    addBox(22.95, 2.94, 7.58, 0.18, 0.09, 0.08, 0x747f8c, { cast: false });
    addBox(23.60, 2.70, 7.58, 0.07, 0.50, 0.07, 0x6e4a22, { cast: false });   // hammer
    addBox(23.60, 2.96, 7.58, 0.24, 0.12, 0.10, 0x39424e, { cast: false });
    addBox(24.30, 2.72, 7.58, 0.30, 0.30, 0.06, 0x8b95a1, { cast: false });   // clamp
    addBox(24.95, 2.66, 7.58, 0.06, 0.56, 0.06, 0x8b95a1, { cast: false });   // rod

    // ---- the workbench, with a gun stripped down on it. A room reads as a
    // WORKED room when something on the table is mid-job, not when the table
    // is tidy.
    unit(21.90, 6.65, 25.10, 7.55, 1.30);   // the bench, and the job laid out on it
    addBox(23.5, 0.92, 7.10, 3.20, 0.10, 0.90, 0x6e4a22, {});                 // top
    addBox(23.5, 0.74, 7.10, 3.00, 0.26, 0.80, 0x3c2f22, { cast: false });    // apron / drawer bank
    addBox(22.10, 0.44, 7.10, 0.14, 0.86, 0.80, 0x39424e, { cast: false });   // legs
    addBox(24.90, 0.44, 7.10, 0.14, 0.86, 0.80, 0x39424e, { cast: false });
    addBox(22.20, 1.10, 7.05, 0.26, 0.26, 0.22, 0x39424e, { cast: false });   // bench vise
    addBox(22.20, 1.26, 7.05, 0.30, 0.08, 0.26, 0x8b95a1, { cast: false });
    // the stripped gun: receiver in the vise, barrel + slide + mag laid out
    addBox(22.55, 1.06, 7.05, 0.52, 0.14, 0.11, 0x161a20, { cast: false });   // receiver
    addBox(22.60, 0.98, 7.05, 0.13, 0.20, 0.10, 0x161a20, { cast: false });   // grip stub
    cyl(ROOT, 0.035, 0.62, mats.steel, 23.30, 1.02, 7.28, 0, 0, Math.PI / 2); // barrel out of the gun
    addBox(23.28, 1.01, 6.92, 0.46, 0.10, 0.13, 0x48515c, { cast: false });   // slide
    addBox(23.86, 1.03, 7.20, 0.10, 0.14, 0.30, 0x232a24, { cast: false });   // magazine
    addBox(24.20, 0.99, 7.05, 0.34, 0.05, 0.26, 0x2f3742, { cast: false });   // parts tray
    for (let i = 0; i < 5; i++) {
      cyl(ROOT, 0.017, 0.048, mats.brass, 24.10 + (i % 3) * 0.09, 1.03, 6.98 + ((i / 3) | 0) * 0.09, Math.PI / 2, 0, 0);
    }
    addBox(24.62, 1.00, 7.10, 0.22, 0.06, 0.30, 0x9d2523, { cast: false });   // rag

    // ---- ammo shelving, north wall beside the cage
    unit(25.28, -5.75, 27.42, -5.05, 1.80);   // the shelving, and every crate on it
    addBox(26.35, 1.42, -5.40, 2.10, 0.07, 0.62, 0x39424e, { cast: false });
    addBox(26.35, 0.86, -5.40, 2.10, 0.07, 0.62, 0x39424e, { cast: false });
    addBox(25.34, 1.14, -5.40, 0.08, 1.32, 0.62, 0x39424e, { cast: false });
    addBox(27.36, 1.14, -5.40, 0.08, 1.32, 0.62, 0x39424e, { cast: false });
    for (let i = 0; i < 4; i++) {
      addBox(25.60 + i * 0.50, 1.60, -5.40, 0.42, 0.29, 0.48, i % 2 ? 0x3f4a33 : 0x6e4a22, { cast: false });
      addBox(25.60 + i * 0.50, 1.04, -5.40, 0.42, 0.29, 0.48, i % 2 ? 0x6e4a22 : 0x3f4a33, { cast: false });
    }
    for (let i = 0; i < 6; i++) {
      cyl(ROOT, 0.021, 0.062, mats.brass, 25.46 + i * 0.36, 1.49, -5.14, Math.PI / 2, 0, 0);
    }

    // ---- kevlar on a rail, west wall south of the door
    for (let i = 0; i < 3; i++) {
      const z = -1.30 - i * 1.15;
      addBox(19.44, 2.28, z, 0.20, 0.62, 0.66, 0x2b3a2c, {});                 // plate carrier body
      addBox(19.44, 2.66, z - 0.24, 0.18, 0.20, 0.16, 0x2b3a2c, { cast: false }); // shoulder straps
      addBox(19.44, 2.66, z + 0.24, 0.18, 0.20, 0.16, 0x2b3a2c, { cast: false });
      addBox(19.42, 2.10, z, 0.14, 0.12, 0.34, 0x3f4a33, { cast: false });    // pouch row
    }
    addBox(19.36, 2.92, -2.45, 0.08, 0.08, 3.20, 0x8b95a1, { cast: false });  // the rail itself

    // ==================================================================
    //  THE INNER CAGE — the second door, and the reason there is a ladder
    // ==================================================================
    // x 21.6..25.2, z -5.75..-2.2 (the room's own north wall is its back
    // wall), 3.0 tall. It is BARRED on the west and the front so it reads
    // from the doorway through the outer gate's bars: two locks deep, and
    // you can see the prize through both of them.
    const CX0 = 21.6, CX1 = 25.2, CZ0 = -5.75, CZ1 = -2.2, CH = 3.0;
    const GX0 = 22.55, GX1 = 24.25;      // the inner gate leaf spans this
    const CXM = (CX0 + CX1) / 2, CZM = (CZ0 + CZ1) / 2, CZD = CZ1 - CZ0;

    // Collider panes: one transparent box per barred face. Same trick as the
    // outer gate — the physics rect and the look are decoupled, so a barred
    // wall stops a body without being a slab.
    const pane = function (x, z, w, d) {
      const p = addBox(x, CH / 2, z, w, CH, d, 0x39424e, { solid: true });
      p.material.transparent = true;
      p.material.opacity = 0.05;
      p.material.depthWrite = false;
      p.castShadow = false;
      p.receiveShadow = false;
      return p;
    };
    pane(CX0, CZM, 0.12, CZD);                      // west face (barred)
    pane((CX0 + GX0) / 2, CZ1, GX0 - CX0, 0.12);    // front-left (barred)
    pane((GX1 + CX1) / 2, CZ1, CX1 - GX1, 0.12);    // front-right (barred)
    addBox(CX1, CH / 2, CZM, 0.14, CH, CZD, 0x39424e, { solid: true });  // east face: solid steel

    // every static bar in the cage, welded into ONE mesh
    const CB = [];
    for (let i = 0; i < 8; i++) CB.push([CX0, 1.5, CZ0 + 0.2 + i * 0.45, 0.10, 2.90, 0.10]);
    CB.push([CX0, 2.93, CZM, 0.14, 0.14, CZD]);
    CB.push([CX0, 0.12, CZM, 0.14, 0.14, CZD]);
    for (let i = 0; i < 3; i++) CB.push([CX0 + 0.15 + i * 0.33, 1.5, CZ1, 0.10, 2.90, 0.10]);
    for (let i = 0; i < 3; i++) CB.push([GX1 + 0.15 + i * 0.33, 1.5, CZ1, 0.10, 2.90, 0.10]);
    CB.push([(CX0 + GX0) / 2, 2.93, CZ1, GX0 - CX0, 0.14, 0.14]);
    CB.push([(CX0 + GX0) / 2, 0.12, CZ1, GX0 - CX0, 0.14, 0.14]);
    CB.push([(GX1 + CX1) / 2, 2.93, CZ1, CX1 - GX1, 0.14, 0.14]);
    CB.push([(GX1 + CX1) / 2, 0.12, CZ1, CX1 - GX1, 0.14, 0.14]);
    CB.push([CX0, 1.5, CZ1, 0.18, CH, 0.18]);       // corner posts
    CB.push([CX1, 1.5, CZ1, 0.18, CH, 0.18]);
    CB.push([CX0, 1.5, CZ0 + 0.1, 0.18, CH, 0.18]);
    CB.push([CX1, 1.5, CZ0 + 0.1, 0.18, CH, 0.18]);
    for (let i = 0; i < 6; i++) CB.push([CXM, CH + 0.02, CZ0 + 0.3 + i * 0.62, CX1 - CX0, 0.09, 0.09]);
    for (let i = 0; i < 3; i++) CB.push([CX0 + 0.9 + i * 0.9, CH + 0.02, CZM, 0.09, 0.09, CZD]);
    const cageBars = weld(CB, mats.bar, false);
    ROOT.add(cageBars);

    // the swinging leaf. A cage gate SWINGS — a slider would have to rise
    // three metres into open air above a three-metre cage. The pivot group
    // sits on the hinge stile and is tagged `mover`, which is what keeps the
    // whole subtree out of the static batch (core/batch.js walk()).
    const pivot = new THREE.Group();
    pivot.position.set(GX0, 0, CZ1);
    pivot.userData.mover = true;
    ROOT.add(pivot);
    const GW = GX1 - GX0;
    const GB = [
      [0.08, 1.5, 0, 0.16, 2.90, 0.14],
      [GW - 0.08, 1.5, 0, 0.16, 2.90, 0.14],
      [GW / 2, 2.86, 0, GW, 0.14, 0.14],
      [GW / 2, 0.14, 0, GW, 0.14, 0.14],
      [GW / 2, 1.50, 0, GW, 0.12, 0.12],
      [GW - 0.18, 1.42, 0.11, 0.20, 0.30, 0.22],   // padlock housing
    ];
    for (let i = 0; i < 4; i++) GB.push([0.42 + i * 0.34, 1.5, 0, 0.09, 2.70, 0.09]);
    const leaf2 = weld(GB, mats.bar, true);
    pivot.add(leaf2);
    const cageLamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.11, 0.11),
      new THREE.MeshLambertMaterial({ color: 0xffb347, emissive: 0xff7a1a, emissiveIntensity: 1.0 })
    );
    cageLamp.position.set(GW - 0.18, 1.74, 0.14);
    pivot.add(cageLamp);

    inner.gate = pivot;
    inner.leaf = leaf2;
    inner.lamp = cageLamp;
    inner.collider = { minX: GX0, maxX: GX1, minZ: CZ1 - 0.09, maxZ: CZ1 + 0.09, ref: leaf2 };
    CBZ.colliders.push(inner.collider);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    // ---- what is actually IN the cage. Rule (c): a CATEGORY, not a number.
    // The rack gives you a sidearm, a pump, a carbine, an SMG and a taser —
    // every one of them a ~50 m gun in a yard the towers watch from 40 m up.
    // The cage gives you REACH, which is a different game.
    // the plinth is furniture: one collider over it, its cap and the two
    // cradle posts. The slot's own pickup point is (23.40, -3.30), a metre
    // clear of it, so the prize does not get walled off by its own stand.
    unit(22.40, -4.98, 24.40, -4.02, 1.10);
    addBox(23.40, 0.32, -4.50, 1.90, 0.60, 0.90, 0x2b313a, {});               // plinth
    addBox(23.40, 0.64, -4.50, 2.02, 0.06, 1.02, 0x39424e, { cast: false });  // plinth cap
    // cradle posts, set where the rifle ACTUALLY lies: the sniper model runs
    // local z -1.32..0.50 and is yawed 90°, so at scale 1.05 about x=23.40 its
    // body spans 22.01..23.93 — a post at 24.1 would have been holding air.
    addBox(22.45, 0.86, -4.50, 0.10, 0.40, 0.16, 0x48515c, { cast: false });
    addBox(23.60, 0.86, -4.50, 0.10, 0.40, 0.16, 0x48515c, { cast: false });
    const cagePad = addBox(23.40, 0.30, -4.02, 0.60, 0.11, 0.05, 0x202833, { cast: false, emissive: 0x080b10, ei: 0.5 });
    const cageGun = buildRackModel("sniper");
    cageGun.userData.dynamic = true;
    cageGun.rotation.set(0.04, Math.PI / 2, 0);   // broadside to the gate: the readable silhouette
    cageGun.position.set(23.40, 1.06, -4.50);
    ROOT.add(cageGun);
    armory.slots.push({
      id: "sniper", name: "BOLT SNIPER", pad: cagePad, model: cageGun,
      taken: false, cool: 0, x: 23.40, z: -3.30, gated: true,
    });
    // ---- THE REST OF THE CATEGORICAL TIER (PRISON_ARMORY_FULL_RACK) --------
    // A wall rack on the cage's one SOLID face (x=25.2), so the three heaviest
    // things in the game hang broadside to the gate and read through both sets
    // of bars beside the rifle on its plinth. Guns lie along Z at x≈24.55,
    // clear of the plinth (z -4.95..-4.05) and inside the cage (z -5.75..-2.2).
    if (FULL) {
      const HX = 24.55, HZ = -3.10;
      addBox(24.98, 1.66, HZ, 0.20, 2.62, 1.62, 0x3c2f22, { solid: HONEST });  // backboard
      const heavy = [
        { id: "lmg", y: 2.42, name: "M249 LMG" },
        { id: "bazooka", y: 1.62, name: "RPG LAUNCHER" },
        { id: "glauncher", y: 0.82, name: "40MM LAUNCHER" },
      ];
      for (let i = 0; i < heavy.length; i++) {
        const h = heavy[i];
        addBox(24.74, h.y - 0.20, HZ, 0.44, 0.08, 1.30, 0x14181d, { cast: false });   // bracket
        const pad = addBox(24.90, h.y - 0.44, HZ, 0.10, 0.09, 1.30, 0x202833, { cast: false, emissive: 0x080b10, ei: 0.5 });
        const model = buildRackModel(h.id);
        model.userData.dynamic = true;
        model.position.set(HX, h.y, HZ + 0.40);
        ROOT.add(model);
        armory.slots.push({
          id: h.id, name: h.name, pad: pad, model: model,
          taken: false, cool: 0, x: 23.90, z: HZ, gated: true,
        });
      }
    }
    // ammunition for it, because a locked rifle with no rounds is a prop
    addBox(24.62, 0.22, -4.86, 0.72, 0.44, 0.52, 0x3f4a33, { solid: HONEST });   // ammo crate
    addBox(24.62, 0.46, -4.86, 0.76, 0.06, 0.56, 0x2f3a26, { cast: false });
    for (let i = 0; i < 4; i++) cyl(ROOT, 0.024, 0.075, mats.brass, 24.36 + i * 0.17, 0.52, -4.86, Math.PI / 2, 0, 0);
    // ---- THE DEMOLITION CRATE. world/door.js has promised for a week that
    // the yard door's 5 lb price is paid with "a charge you had to steal from
    // the armory", and adminwing.js offers "or 5 lb of C4" on three of its
    // locks — while no C4 existed anywhere in the pen. This is that charge:
    // an ITEM slot (a count into the bag via systems/economy.js itemStore,
    // not a weapon unlock), behind the same two cage routes as the rifle.
    // Three bricks: one for the yard door with two to decide with — the
    // 7 lb control console needs a pair set together (det cord adds).
    addBox(22.15, 0.26, -3.30, 0.72, 0.52, 0.52, 0x2e3328, { solid: HONEST });  // olive crate
    addBox(22.15, 0.55, -3.30, 0.76, 0.06, 0.56, 0x232919, { cast: false });  // lid
    const c4Pad = addBox(22.15, 0.30, -2.80, 0.60, 0.11, 0.05, 0x202833, { cast: false, emissive: 0x080b10, ei: 0.5 });
    const c4Disp = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const brick = CBZ.cityC4Mesh ? CBZ.cityC4Mesh()
        : new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.24), new THREE.MeshLambertMaterial({ color: 0x2e3328 }));
      brick.position.set((i - 1) * 0.06, 0.62 + i * 0.12, (i - 1) * 0.04);
      brick.rotation.y = -0.4 + i * 0.45;
      c4Disp.add(brick);
    }
    c4Disp.position.set(22.15, 0, -3.30);
    c4Disp.userData.dynamic = true;
    ROOT.add(c4Disp);
    armory.slots.push({
      id: "c4", name: "C4 CHARGES", item: "C4 Charge", grant: 3,
      pad: c4Pad, model: c4Disp, taken: false, cool: 0, x: 22.15, z: -2.80, gated: true,
    });
    // a warm shrine light so the prize reads from outside two sets of bars
    addBox(23.40, 2.86, -4.50, 0.34, 0.14, 0.90, 0x2b313a, { cast: false });
    addBox(23.40, 2.75, -4.50, 0.28, 0.07, 0.76, 0xffe6b0, { emissive: 0xffb347, ei: 1.0, cast: false });
    const shrine = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 1.05, 2.62, 12, 1, true), coneMat);
    shrine.position.set(23.40, 1.42, -4.50);
    ROOT.add(shrine);
    const shrinePool = new THREE.Mesh(new THREE.CircleGeometry(1.05, 18), poolMat);
    shrinePool.rotation.x = -Math.PI / 2;
    shrinePool.position.set(23.40, 0.09, -4.50);
    ROOT.add(shrinePool);
    // a painted floor caution box around the cage mouth
    addBox(23.40, 0.078, -1.55, 3.60, 0.02, 0.14, 0xd8b021, { cast: false });
  }

  inner.setOpen = function (v, quiet) {
    if (!inner.gate) return false;
    v = !!v;
    if (v === inner.open) return v;
    inner.open = v;
    if (v) {
      const i = CBZ.colliders.indexOf(inner.collider);
      if (i >= 0) CBZ.colliders.splice(i, 1);
      if (inner.lamp) { inner.lamp.material.color.setHex(0x39ff88); inner.lamp.material.emissive.setHex(0x14c258); }
      if (CBZ.prisonPromptClear) CBZ.prisonPromptClear("gunroom-cage");
    } else {
      inner.t = 0; inner.saw = 0;
      inner.gate.rotation.y = 0;
      if (CBZ.colliders.indexOf(inner.collider) === -1) CBZ.colliders.push(inner.collider);
      if (inner.lamp) { inner.lamp.material.color.setHex(0xffb347); inner.lamp.material.emissive.setHex(0xff7a1a); }
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (!quiet) {
      if (v) CBZ.sfx("key");
      CBZ.sfx(v ? "door_open" : "door_close");
    }
    return v;
  };

  /* ---- ONE OWNER FOR THE OUTER GATE'S STATE -------------------------------
     The tick below used to inline the open — flip the flag, splice the
     collider, paint the lamp, ring the cue — as five statements inside an
     `if (L.open)`. That is precisely why this door had no close: the verb
     existed only as a branch. Same five statements, named, and they now run
     BOTH ways. systems/state.js's reset still pokes the fields directly and
     is unaffected (it snaps the gate to y=3, which is t=0's own position). */
  armory.setOpen = function (v, quiet) {
    v = !!v;
    if (v === armory.open) return v;
    armory.open = v;
    const i = CBZ.colliders.indexOf(armory.collider);
    if (v && i >= 0) CBZ.colliders.splice(i, 1);
    else if (!v && i < 0) CBZ.colliders.push(armory.collider);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    armory.lamp.material.color.setHex(v ? 0x39ff88 : 0xff3b3b);
    armory.lamp.material.emissive.setHex(v ? 0x14c258 : 0xff0000);
    if (!quiet && CBZ.sfx) CBZ.sfx(v ? "door_open" : "door_close");
    return v;
  };

  armory.inner = inner;
  // The contract the rest of the game may hold on the second door. Anything
  // that earns the right to open it (a scripted beat, a warden's death, a
  // future loyalty tier) calls setOpen(true) and nothing else.
  CBZ.gunroomInner = inner;

  armory.resetSlots = function () {
    // a new run restocks the crate exactly as it re-arms the rack (the bag it
    // fed, g.inventory, was reset by the same state.js pass that calls this)
    armory.slots.forEach((slot) => { slot.cool = 0; if (slot.item) slot.taken = false; refreshSlotVisual(slot); });
    // state.js resets the OUTER gate through this same hook (it calls
    // a.resetSlots() at the end of its armory block), so the inner cage rides
    // the existing seam and systems/state.js needs no edit at all.
    inner.setOpen(false, true);
    inner.sawMsg = 0;
  };

  // the incidental contraband. It used to sit at (24,1) — dead centre of the
  // sightline through the door, i.e. the first thing you saw when you looked
  // into the GUN room was a stack of cigarettes. Same three stashes, same
  // values, now tucked along the side wall where they belong.
  const PACKS = SPINE
    ? [[20.3, 3.4, 20], [20.3, 5.2, 15], [20.3, 7.0, 15]]
    : [[24, 1, 20], [24, 4, 15], [24, -2, 15]];
  if (CBZ.addPack) PACKS.forEach((p) => CBZ.addPack(p[0], p[1], p[2]));

  // key-gated opening + rack pickups
  CBZ.onUpdate(41, function (dt) {
    // Register with the lock ledger LAZILY: index.html loads this file at :447
    // and city/loyalty.js at :925, so CBZ.cityLockRegister does not exist at
    // this module's parse time. Doing it on the first tick costs one boolean.
    if (!armory._lockReg && CBZ.cityLockRegister) {
      armory._lockReg = true;
      CBZ.cityLockRegister("prison-armory");
      if (inner.gate) CBZ.cityLockRegister("prison-armory-cage");
    }
    /* THE LEAF TRAVELS BOTH WAYS. This ramp used to live inside the "already
       open" branch and only ever counted UP, so a gate that closed would have
       stayed drawn in its pocket six metres overhead. Same 1.6 rate, same
       authored 6 m of travel, one direction added. */
    {
      const want = armory.open ? 1 : 0;
      if (armory.t !== want) {
        const step = dt * 1.6;
        armory.t = want > armory.t ? Math.min(want, armory.t + step) : Math.max(want, armory.t - step);
        armory.gate.position.y = 3 + armory.t * 6;
      }
    }
    if (!armory.open) {
      const dx = CBZ.player.pos.x - 19, dz = CBZ.player.pos.z - 1;
      // LAW 3 (systems/interactions.js): a gate the player shut himself is not
      // re-opened by the fact that he is still standing on its reader.
      const latched = !!(CBZ.prisonDoorLatched && CBZ.prisonDoorLatched("prison-armory"));
      const near = dx * dx + dz * dz < 14 && !latched;
      if (near) {
        /* §THE ORIGINAL GUN ROOM, MIGRATED TO THE SHARED LOCK.
           OWNER (the keycard story, CLAUDE.md LAW 1): "the jail is dumb but I
           ran to get the keycard relentlessly… that's what makes it a game."
           THIS is the door he ran for, and it is the archetype the loyalty
           ledger's lock was written from — so it adopts the law rather than
           staying the one special case that inspired it.

           The KEYCARD STILL WINS. `have` is the file's own original condition,
           byte-for-byte, and the lock returns immediately on it — a key is a
           key and no amount of power takes that away.

           What the lock adds here is now only the POLICE route (the uniform
           the door would believe) — `power:false` since 2026-08-05 declines
           the crew-strong-enough-to-take-it route, per the owner's call at the
           top of this file. That was always the honest answer in the prison
           anyway: in here you have no people, so the ledger route was
           unreachable while still quoting a cash price at the player. The key
           is the way, which is exactly the story. */
        const have = !!(CBZ.game.hasKey || CBZ.game.role === "cop");
        const L = CBZ.cityLock
          ? CBZ.cityLock({ id: "prison-armory", verb: "press", label: "The armory door", have: have, keys: ["Keycard"], orgs: ["police"], power: LOCK_POWER })
          : { open: have, line: "The armory door needs a Keycard." };
        if (L.open) {
          armory.setOpen(true);
          // the cage swinging open in front of you is the line.
          tellHint("The armory rack's open — take what you need.", 2.6);
        } else {
          // KEPT, and it is the one hint in this file that earns its place: a
          // locked door's REASON is not visible from outside it, and this is
          // the whole keycard gradient the owner ran the jail hundreds of times
          // for (doctrine LAW 1). Declared on the audit so the number is honest.
          CBZ.flashHint(L.line || "The armory door needs a Keycard.", 1.4);
        }
      }
    } else if (armory.t >= 1) {   // still travelling = the room is not open yet
      // ---- THE SECOND DOOR ------------------------------------------------
      // Only live once you are actually inside the armory, which is what makes
      // it a LADDER and not two locks on the same threshold.
      if (inner.gate) {
        if (!inner.open) {
          // stand-off point is just OUTSIDE the cage mouth (23.40, -1.55) —
          // the same shape as the outer door's own proximity test
          const ix = CBZ.player.pos.x - 23.40, iz = CBZ.player.pos.z + 1.55;
          const nearCage = ix * ix + iz * iz < 5.3;
          if (nearCage) {
            const econ = CBZ.econ;
            const keyed = !!(econ && econ.hasItem && econ.hasItem("Gun-Room Key"));
            const L = CBZ.cityLock
              ? CBZ.cityLock({ id: "prison-armory-cage", verb: "press", label: "The inner cage", have: keyed, keys: ["Gun-Room Key"], power: LOCK_POWER })
              : { open: keyed, line: "" };
            // LAW 3 again: the key still works, it just does not work BY
            // ITSELF on a cage you deliberately shut and are still stood at.
            const latched = !!(CBZ.prisonDoorLatched && CBZ.prisonDoorLatched("prison-armory-cage"));
            if (L.open && !latched) {
              inner.setOpen(true);
              // the lock turning and the door opening say both halves of this.
              tellHint("The Warden's key turns. There's a rifle in there.", 2.6);
            } else if (!L.open) {
              // ROUTE TWO — graft. A hacksaw blade is the only item in the
              // prison's tool list that had never had a verb; it has one now,
              // and it is what makes the yard crates serve this door.
              const saw = !!(econ && econ.hasItem && econ.hasItem("Hacksaw Blade"));
              const pressing = !!(CBZ.keys && CBZ.keys["e"]);
              // "[E]" is unactionable on a touchscreen; systems/interactions.js
              // owns the shared prison pill band, so adopt it if it is there.
              // Degrade-safe: with no touch layer this is a no-op and the
              // polled key above is still the whole interaction.
              if (saw && CBZ.prisonPrompt) CBZ.prisonPrompt("gunroom-cage", "e", "Saw the padlock", null);
              else if (CBZ.prisonPromptClear) CBZ.prisonPromptClear("gunroom-cage");
              if (saw && pressing) {
                inner.saw += dt;
                if (CBZ.shake && inner.saw % 0.5 < dt) CBZ.shake(0.03);
                if (inner.sawMsg <= 0) {
                  inner.sawMsg = 0.9;
                  // KEPT: a hold-to-saw with no readout is a hold with no
                  // feedback, and there is no diegetic surface for "how far
                  // through the shackle am I". Declared on the audit.
                  CBZ.flashHint("Sawing the padlock… " + Math.round((inner.saw / 6) * 100) + "%", 1.0);
                }
                if (inner.saw >= 6) {
                  if (econ && econ.takeItem) econ.takeItem("Hacksaw Blade");   // the blade snaps
                  // THE BLADE IS GONE BUT THE PADLOCK IS TOO. Remembered
                  // because the close verb asks "would you have been allowed
                  // to open this" — and a man who cut the shackle off is
                  // allowed, for the rest of the run, with nothing in his bag.
                  inner.sawed = true;
                  inner.setOpen(true);
                  // the shackle falling off the hasp is the event.
                  tellHint("The padlock drops. The blade's finished — worth it.", 2.6);
                }
              } else {
                inner.saw = Math.max(0, inner.saw - dt * 2);
                if (inner.sawMsg <= 0) {
                  inner.sawMsg = 1.6;
                  // The hand-written line WINS over `L.line` here (it used to
                  // be the fallback). The lock can only name routes it was
                  // told about, and the cage's second route is a hacksaw —
                  // which is not a key, an org or a power rung, so no
                  // generated sentence can ever mention it. This one does, in
                  // fewer characters than the ledger's used to take.
                  // "[E]" names a key an iPad does not have, and the pill
                  // raised above already says "Saw the padlock" in words —
                  // so on touch the sentence keeps the FACT and drops the
                  // instruction, exactly as crates.js/prisondrops.js do.
                  const pilled = saw && CBZ.touchMode && CBZ.prisonPrompt;
                  tellHint(saw
                    ? (pilled ? "Padlocked. That blade will go through it."
                              : "Padlocked. Hold [E] to saw through it.")
                    : "Padlocked — the Warden has that key. Or find something that cuts.", 1.5);
                }
              }
            }
          } else {
            inner.saw = Math.max(0, inner.saw - dt * 2);
            if (CBZ.prisonPromptClear) CBZ.prisonPromptClear("gunroom-cage");
          }
          if (inner.sawMsg > 0) inner.sawMsg -= dt;
        } else if (inner.t < 1) {
          inner.t = Math.min(1, inner.t + dt * 1.9);
          inner.gate.rotation.y = -inner.t * 1.75;   // swings out into the room
        }
      }

      // shared gate: at most one rack pickup every ~0.35s, so walking past a
      // row of weapons collects them one-at-a-time instead of all at once
      // (which used to fire a burst of swap sounds).
      armory._pickCD = Math.max(0, (armory._pickCD || 0) - dt);
      let best = null, bestD = 5.2;
      for (const slot of armory.slots) {
        slot.cool = Math.max(0, slot.cool - dt);
        // a caged slot is not on offer until its own door is open — the
        // pickup radius alone would otherwise reach straight through the bars
        if (slot.gated && !inner.open) continue;
        // Only AUTO-COLLECT weapons you don't own yet. Standing on a rack you
        // already own must NOT keep re-equipping it — that was overriding the
        // Q / scroll weapon switch every frame (switch, then snap back).
        // (an emptied ITEM slot is out of the running the same way)
        if (slot.item ? slot.taken : (CBZ.hasWeapon && CBZ.hasWeapon(slot.id))) continue;
        const dx = CBZ.player.pos.x - slot.x, dz = CBZ.player.pos.z - slot.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD && slot.cool <= 0) { best = slot; bestD = d2; }
      }
      if (best && armory._pickCD <= 0) {
        best.cool = 1.2;
        armory._pickCD = 0.35;
        pickupSlot(best);
      }
    }
  });

  /* RATCHET. `seeThrough` is the gun-room grammar's one hard invariant and is
     pinned at 1: a locked door you cannot see past is a wall, and a wall
     motivates nobody. `innerRoutes` and `gatedSlots` may only go UP; `bespoke`
     counts locks in this room that do NOT go through CBZ.cityLock (pinned 0). */
  CBZ.gunroomAudit = function () {
    let gated = 0;
    for (let i = 0; i < armory.slots.length; i++) if (armory.slots[i].gated) gated++;
    const m = armory.gate && armory.gate.material;
    return {
      spine: SPINE,
      seeThrough: (m && m.transparent && m.opacity < 0.2) ? 1 : 0,
      doors: inner.gate ? 2 : 1,
      innerRoutes: inner.gate ? 2 : 0,          // the Warden's key · a hacksaw blade
      bespoke: 0,
      rackSlots: armory.slots.length,
      gatedSlots: gated,
      // what actually SPAWNED, not what the table lists: entities/coins.js's
      // PRISON_GROUND_CIGS turns every addPack in the game into a no-op
      // (cigarettes are earned, not swept off a floor), and an audit that
      // reports three stashes nobody can pick up is a lie a later phase reads.
      cigPacks: PACKS.filter(function () { return !!(CBZ.CONFIG && CBZ.CONFIG.PRISON_GROUND_CIGS); }).length,
      outerOpen: !!armory.open,
      innerOpen: !!inner.open,
    };
  };

  // ---- ratchet declaration (see CBZ.prisonPromptAudit in interactions.js).
  // The saw pill adopts the prompt wave's contract; declaring the site here is
  // what lets its audit count us — an undeclared site is invisible to the
  // ratchet, which is the whole reason there is only one census array.
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "gunroom-cage", act: "e", was: "hold [E] to saw the padlock" }
  );

  /* ---- AND A WAY TO SHUT THEM (systems/interactions.js's door registry) ----
     Two declarations, one per leaf of the ladder. Both credentials are the
     tick's own: the outer gate reads the Keycard (or the uniform), the inner
     cage wants the Warden's key — or the memory of the hacksaw that already
     beat it, since the blade snaps and a man who cut a padlock off does not
     lose the right to swing the gate he opened. `autoR` values are the square
     roots of this file's own proximity tests (14 and 5.3). */
  (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = [])).push({
    id: "prison-armory", label: "the armory door", autoR: 3.75,
    at: function () { return { x: 19, y: 2.0, z: 1 }; },
    pick: function () { return [gate]; },
    col: function () { return armory.collider; },
    isOpen: function () { return !!armory.open; },
    permanent: function () { return false; },
    canUse: function () { return !!(CBZ.game && (CBZ.game.hasKey || CBZ.game.role === "cop")); },
    set: function (v) { armory.setOpen(v); return armory.open === !!v; },
  });
  if (inner.gate) {
    (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = [])).push({
      id: "prison-armory-cage", label: "the inner cage", autoR: 2.3,
      at: function () { return { x: 23.40, y: 1.4, z: -1.55 }; },
      pick: function () { return [inner.gate]; },
      col: function () { return inner.collider; },
      isOpen: function () { return !!inner.open; },
      permanent: function () { return false; },
      canUse: function () {
        const econ = CBZ.econ;
        return !!(inner.sawed || (econ && econ.hasItem && econ.hasItem("Gun-Room Key")));
      },
      set: function (v) { inner.setOpen(v); return inner.open === !!v; },
    });
  }

  CBZ.armory = armory;
  /* THE TWO LINES THIS FILE KEEPS, DECLARED. CBZ.jailShowAudit().hints reads
     this list, so the ratchet reports 2 rather than pretending the prison has
     no hint text left. Both are state a player cannot see from where he is
     standing: WHY a locked door is locked, and how far through a padlock a
     hacksaw has cut. Either one becoming diegetic drops the number. */
  (CBZ._jailShowRaw = CBZ._jailShowRaw || { toasts: [], hints: [], narrations: [] })
    .hints.push("gunroom:locked-reason", "gunroom:saw-progress");
})();
