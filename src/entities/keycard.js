/* ============================================================
   entities/keycard.js — THE KEYCARD, and the promise it makes.

   OWNER (CLAUDE.md LAW 1): "it's not about getting cigarettes and opening the
   dumb chests — it's getting a keycard which already gets you into a very cool
   armory room." So this object is the first rung of the whole game's spine and
   it has to LOOK like a thing somebody left on a desk, not like a collectible.

   WHAT CHANGED, and why each was wrong:
     · IT FLOATED AND SPUN. A 0.7 m card hovering at y=1.4 over a glowing floor
       ring, spinning at 2 rad/s — the owner's own words for that grammar are
       "Subway Surfers". A physical, crafted thing that you find because you
       LOOK is the opposite of a marker that finds you. The card now lies FLAT
       on a real duty desk in the corner post, under a lamp, next to the key
       cabinet it came out of. It doesn't spin; it breathes.
     · THE PROMISE WAS INVISIBLE. Nothing in the world said a key existed until
       you tripped over one. The Warden — the man whose own bark is "The gun
       room stays locked. My key, my rules." — now WEARS his Gun-Room Key on
       his belt, in brass, on a red fob. That is a TRUE claim, not a tease:
       systems/economy.js already pays that exact item out three ways (bribe
       :316, pickpocket :485, corpse loot :546), and the fob hides itself the
       instant you actually hold one, so the world can never lie about it.

   CONTRACT PRESERVED EXACTLY. CBZ.keycard still exposes { group, ring,
   collected, baseY } — systems/interactions.js (pickup + bob), systems/state.js
   (respawn reset), systems/minimap.js and systems/fullmap.js all read those and
   none of them changed. The idle animation is OWNED here now, on an updater
   that runs just after interactions.js's, so the legacy spin/bob is overwritten
   in the same frame it is written and no fenced file had to be edited.

   Flag: CBZ.CONFIG.PRISON_ARMORY_SPINE (declared in world/gunroom.js, the
   owning file) reverts all of it — the card goes back to the floating, spinning
   card at (13.5, 1.4, -11.5) with its floor ring, and no desk, lamp, cabinet or
   belt fob is built.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { mat, COL } = CBZ;
  const addBox = CBZ.addBox;

  // gunroom.js owns the default; if it somehow failed to load we still want
  // the better room, so an undefined flag reads as ON.
  const SPINE = !(CBZ.CONFIG && CBZ.CONFIG.PRISON_ARMORY_SPINE === false);

  const KX = 13.5, KZ = -11.5;                 // unchanged: the pickup test is planar
  const REST_Y = SPINE ? 0.985 : 1.4;          // on the desk, or the old hover height

  const grp = new THREE.Group();
  grp.userData.dynamic = true;

  const cardMat = mat(COL.KEY, { emissive: COL.KEY_E, ei: 1.3 });
  const card = SPINE
    ? new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.27, 0.035), cardMat)
    : new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.06), cardMat);

  if (SPINE) {
    // LIE FLAT. The card mesh carries the -90° itself so the group's yaw (which
    // systems/interactions.js still writes) only ever slews it in the ground
    // plane — it can never stand the card back up.
    card.rotation.x = -Math.PI / 2;
    card.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.075, 0.02), mat(0x0a3b33));
    stripe.position.set(0, 0.082, 0.026);      // card-local; ends up proud, on top
    card.add(stripe);
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.06, 0.018), mat(0xd6a33b, { emissive: 0x4a3308, ei: 0.5 }));
    chip.position.set(-0.13, -0.03, 0.025);
    card.add(chip);
    const punch = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.022), mat(0x0a3b33));
    punch.position.set(0.165, 0.0, 0.02);      // the lanyard slot
    card.add(punch);
    grp.add(card);
  } else {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.07), mat(0x0a3b33));
    stripe.position.y = 0.08;
    grp.add(card, stripe);
  }

  grp.position.set(KX, REST_Y, KZ);            // SE corner, past the indoor guard
  scene.add(grp);

  /* The ring. It stays on the exports because systems/state.js and
     systems/interactions.js both toggle `ring.visible` — but a 1.15 m halo
     painted on the floor is the pickup-marker language we are trying to get
     rid of, so under the flag it becomes what it should always have been: the
     small pool of light the desk lamp throws across the card. */
  const ringMat = new THREE.MeshBasicMaterial({
    color: SPINE ? 0xffd9a0 : COL.KEY,
    transparent: true, opacity: SPINE ? 0.16 : 0.4,
    // depthWrite off only on the new light-spill disc; the legacy floor halo
    // keeps its exact original material so the flag-off path is unchanged.
    side: THREE.DoubleSide, depthWrite: !SPINE,
  });
  const ring = SPINE
    ? new THREE.Mesh(new THREE.CircleGeometry(0.60, 22), ringMat)
    : new THREE.Mesh(new THREE.RingGeometry(0.8, 1.15, 24), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(KX, SPINE ? 0.952 : 0.06, KZ);
  scene.add(ring);

  CBZ.keycard = { group: grp, ring, collected: false, baseY: REST_Y };

  if (!SPINE) return;

  // ==================================================================
  //  THE DUTY POST — a place, so the card is something you FIND
  // ==================================================================
  // Cell block interior is x -16..16, z -44..-8 (inner faces 15.5 / -8.5), so
  // this corner is clear of the bunks, the toilet block and the cell bars.
  addBox(13.9, 0.90, -11.50, 1.90, 0.08, 0.95, 0x39424e, { solid: true, y0: 0, y1: 0.95 });   // desk top
  addBox(13.9, 0.62, -11.50, 1.74, 0.44, 0.80, 0x2f3742, { cast: false });                    // drawer bank
  addBox(13.05, 0.43, -11.50, 0.10, 0.86, 0.80, 0x39424e, { cast: false });                   // legs
  addBox(14.75, 0.43, -11.50, 0.10, 0.86, 0.80, 0x39424e, { cast: false });
  addBox(13.05, 0.70, -11.50, 0.06, 0.06, 0.78, 0x8b95a1, { cast: false });                   // drawer pulls
  addBox(14.75, 0.70, -11.50, 0.06, 0.06, 0.78, 0x8b95a1, { cast: false });

  // desk clutter — a shift log, a mug, a spare lanyard coil
  addBox(14.28, 0.955, -11.72, 0.34, 0.03, 0.46, 0xe4e0d4, { cast: false });                  // clipboard paper
  addBox(14.28, 0.975, -11.90, 0.30, 0.02, 0.06, 0x39424e, { cast: false });                  // its clip
  addBox(14.52, 1.00, -11.24, 0.14, 0.16, 0.14, 0xd9dee5, { cast: false });                   // mug
  addBox(14.60, 1.00, -11.24, 0.05, 0.09, 0.05, 0xd9dee5, { cast: false });                   // handle
  addBox(13.16, 0.955, -11.26, 0.22, 0.03, 0.20, 0x0a3b33, { cast: false });                  // coiled lanyard
  addBox(13.16, 0.975, -11.26, 0.10, 0.02, 0.09, 0x123f39, { cast: false });
  // the lanyard still threaded through the card's punch slot, trailing off it
  addBox(13.78, 0.958, -11.50, 0.16, 0.014, 0.035, 0x0a3b33, { cast: false });
  addBox(13.94, 0.958, -11.58, 0.14, 0.014, 0.030, 0x0a3b33, { cast: false });

  // the desk lamp that is actually throwing the pool of light on the card
  addBox(14.66, 0.98, -11.86, 0.20, 0.05, 0.20, 0x21262e, { cast: false });                   // base
  addBox(14.66, 1.22, -11.86, 0.05, 0.44, 0.05, 0x21262e, { cast: false });                   // stem
  addBox(14.40, 1.42, -11.78, 0.56, 0.05, 0.05, 0x21262e, { cast: false });                   // arm
  addBox(14.14, 1.36, -11.74, 0.20, 0.14, 0.20, 0x2b313a, { cast: false });                   // shade
  addBox(14.14, 1.28, -11.74, 0.15, 0.03, 0.15, 0xffe6b0, { emissive: 0xffb347, ei: 1.0, cast: false });

  /* THE KEY CABINET, AND WHY IT IS HERE. A card lying on a desk answers
     "what is this"; the steel cabinet on the wall behind it, door hanging
     open with one hook stripped bare, answers "where did it come from and
     who is missing it". Storytelling for six boxes and no draw call of its
     own — every piece is opaque, non-emissive, empty userData, so core/
     batch.js folds it into the cell block's existing static merge. */
  addBox(15.38, 1.86, -11.50, 0.16, 0.70, 0.62, 0x2f3742, { cast: false });                   // cabinet body
  addBox(15.30, 1.86, -11.50, 0.02, 0.62, 0.54, 0x1b1e23, { cast: false });                   // dark interior
  addBox(15.20, 1.86, -11.03, 0.34, 0.68, 0.04, 0x39424e, { cast: false });                   // door, swung open
  addBox(15.05, 1.84, -11.05, 0.06, 0.06, 0.04, 0x8b95a1, { cast: false });                   // handle
  for (let i = 0; i < 4; i++) {
    addBox(15.29, 2.06, -11.72 + i * 0.15, 0.04, 0.04, 0.03, 0x8b95a1, { cast: false });      // hooks
    if (i) addBox(15.27, 1.96, -11.72 + i * 0.15, 0.05, 0.14, 0.03, 0xb8bec7, { cast: false }); // tags — hook 0 is EMPTY
  }

  // ==================================================================
  //  THE WARDEN WEARS HIS KEY
  // ==================================================================
  // The second rung of the spine has to be visible on a MAN, not discovered by
  // accident, or the inner cage is a door nobody knows exists.
  let fob = null, fobHost = null;
  (function belt() {
    const list = CBZ.guards;
    if (!list || !list.length) return;
    let w = null;
    for (let i = 0; i < list.length; i++) if (list[i].kind === "warden") { w = list[i]; break; }
    if (!w || !w.char || !w.char.body) return;
    // Derive the body scale from the SHARED mount table rather than re-typing
    // character.js's torso formula — one number read from the owning file.
    const M = CBZ.charMounts ? CBZ.charMounts(w.char) : null;
    const s = (M && M.hip) ? (M.hip.position.y / 1.05) : 1;
    fob = new THREE.Group();
    fob.position.set(-0.30 * s, 1.02 * s, 0.15 * s);   // left hip, forward of the seam
    fob.rotation.set(0, 0, 0.18);
    fob.userData.mover = true;                          // keep the batcher out of it
    const brass = mat(0xd6a33b, { emissive: 0x4a3308, ei: 0.45 });
    const ringM = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.012), mat(0x8b95a1));
    ringM.position.set(0, 0.075, 0);
    const shank = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.13, 0.011), brass);
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.011), brass);
    bow.position.y = 0.04;
    const bit = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.028, 0.011), brass);
    bit.position.set(0.015, -0.055, 0);
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.085, 0.010), mat(0xc94d3a, { emissive: 0x4a0f0c, ei: 0.5 }));
    tag.position.set(0.055, -0.01, 0.004);
    fob.add(ringM, shank, bow, bit, tag);
    fob.traverse(function (o) { o.castShadow = false; });
    w.char.body.add(fob);
    fobHost = w;
  })();

  // ==================================================================
  //  IDLE — it breathes, it does not spin
  // ==================================================================
  // Order 40.6 puts this immediately AFTER systems/interactions.js's own
  // keycard block (order 40), which still writes rotation.y and a ±0.12 bob.
  // Overwriting them here is what let this land without touching that file.
  const K = CBZ.keycard;
  let t = 0;
  CBZ.onUpdate(40.6, function (dt) {
    t += dt;
    if (!K.collected) {
      grp.rotation.y = 0.42 + Math.sin(t * 0.35) * 0.02;   // a card set down at an angle
      grp.position.y = REST_Y + Math.sin(t * 0.9) * 0.006; // barely — it is on a desk
      const pulse = 0.78 + Math.sin(t * 2.2) * 0.34;
      cardMat.emissiveIntensity = pulse;
      ringMat.opacity = 0.11 + pulse * 0.07;
    }
    // A uniform is a claim about the man wearing it (CLAUDE.md). The Warden's
    // key is only on his belt while he still has it — the moment you bribe,
    // pick or loot it off him the world stops advertising it.
    if (fob) {
      const held = !!(CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Gun-Room Key"));
      if (fob.visible === held) fob.visible = !held;
    }
  });

  /* Ratchet for the spine: `floatingPickups` is pinned at 0 — a reward that
     hovers and spins is the grammar this change exists to delete — and
     `visiblePromises` counts the rungs of the keycard→armory chain that the
     player can SEE before earning them (the card on its lit desk, the key on
     the Warden's belt). It may only go UP. */
  CBZ.keycardAudit = function () {
    return {
      spine: SPINE,
      floatingPickups: SPINE ? 0 : 1,
      visiblePromises: (SPINE ? 1 : 0) + (fob ? 1 : 0),
      wardenFob: !!fob,
      wardenFound: !!fobHost,
      restY: REST_Y,
      collected: !!CBZ.keycard.collected,
    };
  };
})();
