/* ============================================================
   systems/wounds.js — THE BODY CARRIES THE HITS (universal gore).

   Shoot someone and the damage stays LEGIBLE on the rig:
     • WOUND DECALS: tiny dark entry-wound discs stamped on the exact body
       part at the exact hit point (world hit → part-local, snapped to the
       face the bullet came through, sitting slightly proud). ONE shared
       CircleGeometry + 3 shared unlit materials (fresh dark red → drying
       brown after ~12s). A fist, a boot or a baton stamps NOTHING (owner:
       "there's a hole in his back as if he got shot" from a punch): blunt
       trauma is systems/vitals.js's daze, never a decal.
       Per-wound scale jitter so no two holes are identical.
     • NO SOAK. THE CLOTHES KEEP THEIR COLOUR (owner 2026-10-09: "I don't
       really like clothes changing colours because of blood. Instead it
       should just be the blood holes, like when you just get shot"). Each
       hole carries ONE small tight blood ring, a few cm, stamped at its
       final size on the frame of the hit; it never grows, never creeps and
       never runs down to the collar. The spreading stain (bloom + a 40 s
       creep to two-thirds of the panel) and the headshot collar run-down
       are DELETED; gore.js's corpse-in-a-pool material swap is deleted
       too. Blood lives in the drips and pools on the ground.
     • HOLES NEVER TIME OUT. A hole stays as long as the body exists, alive
       or dead (owner: "bullet holes disappear after a while, which is
       dumb"). Only a cap recycles one, and the global cap picks the hole
       furthest from the lens / behind it, never the one you are looking at.
     • THE PLAYER TOO: the city's playerActor (no .char) resolves to
       capture.js's CBZ.playerWoundActor; the first-person arm is the rig's
       own arm (fphands poseBodyArm), so a hole in it shows down the lens.
     • a shotgun blast scatters 2-3 wounds (per-pellet calls collapse into
       one burst).

   Budget discipline (the game is draw-call bound):
     • caps: a LIVING man carries CITY 22 / elsewhere 10 meshes (a hit =
       hole + cloth hole + its blood ring). A DEAD body has no low cap: 96 meshes (48
       holes with their stains) before his own oldest recycles, so a corpse
       you keep shooting or stabbing keeps collecting holes (owner: "you
       should be able to add unlimited bullet holes or stab holes"). Global
       cap rides the quality tier, oldest-first; a free-mesh pool so churn
       never reallocates (geometry/material reassigned on reuse — both
       shared, nothing cloned or disposed).
     • wounds are CHILDREN of the rig's part meshes → they animate, fall
       and despawn WITH the body for free; a throttled (0.8s) sweep frees
       records once a rig leaves the scene. Nothing on a body animates
       after the hit; the whole system sleeps when nobody is being shot.
     • spawn distance-gated at 300u for holes (a sniper's kill keeps its
       holes when you walk up to it); bites keep the old 45u band.

   Public API:
     CBZ.bodyWound(actor, worldPoint, opts) — opts:
        { head:bool, cal|caliber:0.7..1.6, mm:<bore in millimetres>,
          melee:"blade" (a SLIT along the blade + a cut in the cloth) |
                "blunt"|true (stamps nothing),
          bladeMm:<edge width in mm>, slash:true|false (default: read off
          `dir` — a blade travelling along the skin slashes, into it stabs),
          dir:{x,y,z} through-direction,
          fromX, fromZ }  (fromX/Z bias a synthetic centre-point toward
          the attacker so the wound lands on the facing surface, AND are
          the fallback source of the through-direction)
     CBZ.bodyBite(actor, worldPoint, {jaw, sev, sever, by, byActor, dir, part,
        fromX, fromZ}) — a person bitten: every tooth of the attacker's own
        arch (systems/dentition.js) struck against the real body; see BITES.
     CBZ.creatureBiteChunk(actor, worldPoint, {jaw, sev, by, byActor, dir,
        bleedS}) — an animal bitten, rigid or one skinned mesh; flesh the
        mouth takes is really gone (see BITES).
     CBZ.woundDecalAudit() → {decals, oversized, cameraFacing, biteCalls,
        biteMarks, personBites, animalBites, lastRefusal} — the ratchet.
     CBZ.woundSkinAudit() → {marks, attached, skinned, verts, kinds, cap,
        animating, owned} — the bite marks cut from the bodies' own surfaces.
     CBZ.clearWounds() — also chained automatically onto CBZ.clearGore.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // CITY bodies should read as GENUINELY shot up — a riddled corpse carries
  // many holes (owner: "MORE bullet holes"). City raises the per-actor budget
  // (each readable hit = wound disc + its soak stain, so ~22 holes ≈ 11 hits)
  // and bumps the global cap modestly; jail/survival keep the original 10/200
  // byte-identical. Both stay LRU-recycled oldest-first so draw calls stay
  // bounded no matter how long the magdump runs.
  function cityWounds() { return !!(CBZ.game && CBZ.game.mode === "city"); }
  // global live-mesh cap (each is 1 tiny draw call) — now rides the quality tier,
  // read LIVE per check (the slider can move mid-run); fallback = old constants.
  // (x1.5 since WOUND_REAL_V3: a clothed hit is hole + CLOTH hole + stain —
  // three meshes, not two — and the owner asked for MORE holes, not fewer)
  function capBase() { return (CBZ.qScale ? CBZ.qScale(240, 780) : 450) | 0; }
  function capCity() { return (CBZ.qScale ? CBZ.qScale(330, 1140) : 630) | 0; }
  // wound+stain pairs per body — also rides the quality tier
  function perActorBase() { return (CBZ.qScale ? CBZ.qScale(8, 30) : 15) | 0; }
  function perActorCity() { return (CBZ.qScale ? CBZ.qScale(16, 66) : 33) | 0; }
  function capGlobal() { return cityWounds() ? capCity() : capBase(); }
  // A DEAD BODY IS NOT CAPPED LOW: 48 hole+stain pairs before his own oldest
  // recycles. Living men keep the tier caps (a fight never piles 96 on one).
  const PER_CORPSE = 144;   // 48 hits x (hole + cloth hole + stain)
  function perActor(actor) {
    if (actor && actor.dead) return PER_CORPSE;
    return cityWounds() ? perActorCity() : perActorBase();
  }
  const SPAWN_D2 = 45 * 45; // bites: matches gore.js's "only where it can be seen" band
  // HOLES: a body you shot from across the street still carries the hole when
  // you walk up to it. Caps bound the cost, not distance.
  const WOUND_D2 = 300 * 300;
  const DRY_T = 12;         // seconds until a fresh wound dries brown
  const PROUD = 0.013;      // how far the disc sits off the surface (no z-fight)

  // ============================================================
  //  WOUND_DECAL_V2 — THE HOLE IS THE SIZE OF THE ROUND, NOT OF THE DAMAGE.
  //
  //  THE BUG, MEASURED (owner: "it looks like a sticker … it is WIDER THAN THE
  //  FACE"). Nothing here was ever sized against the body. `bodyWound` computed
  //  a RADIUS of `0.045 + 0.032*cal`, multiplied it by 1.15 for a head and by a
  //  0.85..1.15 jitter, and stamped it. That is a DIAMETER of 0.138 m for a
  //  9 mm and 0.308 m for the sniper — on an adult head that is a 0.60-unit
  //  cube, i.e. 23% to 51% of the whole skull, and `seat()` was free to centre
  //  it 0.78 of the way to the edge, so the biggest rounds physically hung off
  //  both sides. Worse, the SOAK stain that rides under it capped itself by
  //  comparing its RADIUS against the part's FULL WIDTH (`min(w,h,d)*1.05`) —
  //  an off-by-two that let a head stain reach 0.98 m across on a 0.60 m head:
  //  163% of the face. That capped-and-still-oversized stain IS the disc in
  //  the screenshot.
  //
  //  THE PHYSICAL TRUTH. A 9 mm entry wound is about 9 mm; 5.56 and 7.62 are
  //  smaller still. A skull is ~137 mm across. So an entry hole is ~1/15th of
  //  a face — a dark POINT. What is actually big is the blood that runs out of
  //  it, the abrasion ring around it, and the EXIT, which is far larger and
  //  messier than the entry. Those are three different things and this file
  //  used to draw all of them as one disc.
  //
  //  Flip WOUND_DECAL_V2 false and every number below reverts to the old ones.
  // ============================================================
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.WOUND_DECAL_V2 == null) CBZ.CONFIG.WOUND_DECAL_V2 = true;
  function v2() { return CBZ.CONFIG.WOUND_DECAL_V2 !== false; }

  // THE RIG IS A CARICATURE AND THE WOUND HAS TO LIVE ON IT. A real entry hole
  // is ~9 mm on a ~137 mm skull. This game's adult head is a 0.60-unit CUBE
  // (entities/character.js, P.headSize), so the rig draws a head 4.4x life
  // size and a literally-9-millimetre hole would be a third of a pixel.
  // RIG_MAG is that caricature factor and NOTHING ELSE — 0.60 / 0.137 — so a
  // 9 mm round comes out 0.040 units across on a 0.60 head: exactly the 1-in-15
  // the physical truth demands, and 3.5x-7.6x smaller than what shipped.
  const RIG_MAG = 4.4;
  // THE CLAMP THAT KILLS "WIDER THAN THE FACE". A hole's DIAMETER may never
  // exceed this fraction of the WIDTH of the box face it landed on, so the same
  // .50 that leaves a real mark on a chest leaves a small one on a forearm, and
  // no decal can ever approach the silhouette of the part carrying it. 1/15th
  // of a face is 0.067; 0.085 leaves the heaviest round in the game room to
  // read heavier without ever getting near the edge. This is the ratchet.
  // (Both are quoted as face-WIDTH fractions and must be turned into radii by
  // capR() below, which divides out the decal geometry's own rim wobble.)
  const ENTRY_MAX_FRAC = 0.085;
  const EXIT_MAX_FRAC = 0.16;      // an exit is SLIGHTLY bigger than the entry, never a blowout
  // fpsmode.js's own heavyRound() line is `cal >= 1.0`; we use STRICTLY greater
  // so the untyped default (`cal` omitted → 1) does not punch through — a
  // caller that never named a round has not told us it was a rifle.
  const EXIT_MIN_CAL = 1.0;
  const EXIT_MIN_TRAVEL = 0.04;    // <4 cm inside the part = a graze, not a through-shot

  // THE GAME'S `cal` DIAL IS ENERGY, NOT BORE, AND IT CANNOT BE INVERTED INTO
  // ONE. fpsmode's table ranks sniper 1.9 > ak 1.6 > shotgun 1.5 > deagle 1.3,
  // while by DIAMETER the deagle (12.7 mm) beats the sniper (8.6) and the ak
  // (7.62), and the carbine's 5.56 is the smallest thing on the list. So we do
  // not pretend to recover a bore from it: `cal` moves the hole only gently
  // (every round in this game bores between 5.5 and 12.7 mm — a 2.3x span,
  // against a 7.6x damage span), and a caller that actually KNOWS its bore says
  // so in millimetres. That is the bodyBite `jaw` contract exactly: the caller
  // passes a real physical measurement in real units and nothing here ever
  // learns a weapon name.
  function mmFor(opts, cal) {
    if (opts.mm != null) return Math.max(2, Math.min(30, opts.mm));
    return 7.0 + 2.8 * Math.max(0.2, Math.min(2.4, cal));
  }

  // A DECAL THAT HOVERS IS A STICKER. The fixed 0.013 stand-off was a THIRD of
  // the new hole's radius — from any oblique angle that is a chip floating off
  // the skin. Scale the offset with the mark instead and let polygonOffset (on
  // every wound material below) do the z-fight work it exists for.
  // (Ceiling at the old PROUD so this can only ever pull a decal CLOSER to the
  // skin — a broad bruise patch standing further off than before would be the
  // same bug wearing a different number.)
  function proudFor(r) { return Math.min(PROUD, Math.max(0.0045, r * 0.12)); }
  const PROUD_SOAK_V2 = 0.0022;   // the stain still sits UNDER its hole

  // ---- shared geometry + materials ------------------------------------------
  //
  //  WHY THE OLD HOLE LOOKED FAKE (owner: "the bullet hole and blood shit looks
  //  dumb"). It was a CircleGeometry(1, 8) — a flat, single-colour OCTAGON. Three
  //  separate tells, and all three were free to fix:
  //    1. EIGHT SEGMENTS. Close up that is a visible stop sign, not a hole.
  //    2. ONE FLAT COLOUR. A real entry wound is a dark pit ringed by raw,
  //       abraded skin. A single flat fill cannot be a pit — it is a sticker.
  //    3. A PERFECT CIRCLE. Nothing about torn tissue is perfectly round.
  //
  //  The fix costs ZERO extra draw calls and zero extra geometry, because the
  //  geometry is SHARED: every wound in the game reads this one object, so
  //  improving it once improves every hit ever taken, forever.
  //
  //  THE TRICK IS VERTEX COLOUR. MeshBasicMaterial multiplies its own colour by
  //  the per-vertex colour, so baking a radial ramp into the geometry gives the
  //  disc DEPTH while leaving every existing material colour — and therefore
  //  every wound TYPE (fresh / dry / bruise / torn) — exactly as authored. The
  //  ramp only ever DARKENS toward the centre and reaches 1.0 at the rim, so
  //  the outer edge is still today's exact colour and nothing can wash out.
  //  A bullet hole, a bite and a bruise all become pits from one change, and
  //  none of them needed a new material, a texture, or a second mesh.
  //
  //  HONEST CORRECTION (2026-07-27, measured against the vendored r128 source):
  //  MOST OF THE PARAGRAPH ABOVE NEVER REACHED THE SCREEN. r128's
  //  CircleGeometry emits exactly TWO radii — one centre vertex at r=0 and one
  //  rim ring at r=1 (`s.push(0,0,0)` then a single loop of `segments+1` rim
  //  vertices) — so there is no vertex anywhere in between for a ramp to shape.
  //  Consequences, both verifiable by hand: the `r*r` that was supposed to
  //  "keep the dark core tight" evaluates to r*r at r=0 and r=1, which is
  //  IDENTICAL to r, i.e. a plain linear fade; and the `raw` band centred on
  //  r=0.72 computes `max(0, 1 - |r-0.72|*4)` = 0 at BOTH radii that exist, so
  //  the raw red ring was multiplied by zero on every vertex, always. What
  //  actually shipped was a flat linear centre→rim gradient.
  //
  //  SECOND CORRECTION (2026-08-26). The note above ended "this geometry is
  //  left byte-identical because the bite/blade/bruise arcs are tuned around
  //  it" — i.e. every wound a MOUTH leaves was left running on the broken
  //  ramp, which is precisely the arc the owner is now complaining about
  //  ("when i bit a person it dosnt look like im biting them"). A tooth
  //  puncture drawn with a two-vertex linear fade and an opaque material is a
  //  flat disc with a hard cut edge: a sticker, exactly as reported. rampGeo
  //  is DELETED and G_WOUND is built by discGeo, the ring-subdivided fan the
  //  bullet path already proved out, so the bite finally gets the dark bore
  //  and the raw margin the comment has been promising since July.
  //  (discGeo is a hoisted function declaration; it is defined below.)
  //
  //  The TRUE outer radius of a jittered disc (the rim wobble pushes vertices
  //  past 1.0). Every size clamp and the audit measure against THIS, not the
  //  nominal 1.0, or a stain could still overhang by its own wobble.
  function maxRadiusOf(g) {
    const p = g.attributes.position;
    let mx = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i));
      if (r > mx) mx = r;
    }
    return mx || 1;
  }
  // THE BITE / BLADE / BRUISE DISC. Dark bore, ONE bright raw margin, and an
  // outermost ring at ALPHA ZERO so the mark dissolves into skin instead of
  // ending in a cut edge. 14 segments reads as round at contact range; the
  // jitter is what makes it a tear rather than a stamp.
  const G_WOUND = discGeo([
    [0.00, 0.30, 1.00, 1.00],   // the pit — the old `floor`, now actually reachable
    [0.42, 0.46, 0.98, 1.00],
    [0.74, 0.96, 0.80, 0.95],   // the raw torn margin: THE one bright band
    [1.00, 0.88, 0.84, 0.00],   // feathered out — no rim, no sticker
  ], 14, 0.10);
  // soak stains: IRREGULAR blob outlines — a circle with per-vertex radial
  // jitter (sum of randomly-phased sines) baked ONCE at startup. 3 shared
  // geometries, randomly picked + spun + stretched per stain.
  //
  //  The stains had the SAME defect as the hole and it read even worse, because
  //  a stain is bigger: an irregular outline was already here, but the fill was
  //  flat, so a soak ended in a HARD EDGE — a solid sticker of blood with a
  //  crisp border. Blood wicking through cloth is dark where it pooled and
  //  fades out where it spread. Same free fix: a radial ramp in vertex colour,
  //  darkest at the centre, falling to nearly nothing at the rim so the stain
  //  DISSOLVES into the garment instead of being cut out of it.
  //
  //  AND IT DID NOT DISSOLVE, for two years, because a colour ramp on an
  //  OPAQUE material cannot dissolve anything (2026-08-26). MAT_RING (then MAT_SOAK) was a
  //  plain MeshBasicMaterial with no `transparent`, so the rim vertices merely
  //  went from near-black to a slightly-less-near-black and then stopped dead
  //  at the outline. That is the hard cut edge, still there, still a sticker,
  //  under a comment claiming it was fixed. The ramp now drives ALPHA as well
  //  as brightness (r128 takes a 4-component `color` attribute — see the note
  //  on unlit() below), so the stain genuinely ends in nothing.
  function blobGeo() {
    const g = new THREE.CircleGeometry(1, 14);
    g._shared = true;
    const pos = g.attributes.position;
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i);
      if (x * x + y * y >= 0.25) {                   // centre vertex stays put
        const a = Math.atan2(y, x);
        const k = 1 + 0.18 * Math.sin(a * 3 + p1) + 0.14 * Math.sin(a * 5 + p2) + 0.09 * Math.sin(a * 7 + p3);
        x *= k; y *= k;
        pos.setXY(i, x, y);
      }
      // 1 at the pooled centre → 0.18 at the feathered rim. Multiplied against
      // MAT_RING, the edge all but vanishes into the cloth.
      const r = Math.min(1, Math.sqrt(x * x + y * y));
      const v = 1 - 0.82 * (r * r);
      col[i * 4] = v; col[i * 4 + 1] = v * 0.94; col[i * 4 + 2] = v * 0.94;
      // A STAIN IS A GRADIENT, so a plain linear alpha is exactly right here
      // and the two-radii CircleGeometry is not a defect for this one shape:
      // opaque where the blood pooled, gone at the wicking edge. 0.92 rather
      // than 1.0 at the centre so even the darkest soak lets a little cloth
      // through — wet fabric, not paint.
      col[i * 4 + 3] = 0.92 * (1 - r);
    }
    pos.needsUpdate = true;
    g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g._maxR = maxRadiusOf(g);
    return g;
  }
  const G_RING = [blobGeo(), blobGeo(), blobGeo()];

  // ---- A DISC WITH ACTUAL RINGS IN IT (the pit the comment above promised) --
  //
  //  Everything the old ramp wanted needs vertices at the radii being shaded,
  //  and CircleGeometry has none, so build the fan by hand. `stops` are ordered
  //  outward from the centre as [radius, brightness, warm, alpha]:
  //    brightness MULTIPLIES the material's authored hex, so every wound TYPE
  //      keeps its own colour and only the SHADING lives here (same law as the
  //      old ramp — the geometry never introduces a hue of its own);
  //    warm scales green/blue only, so a band can go RAW RED rather than merely
  //      lighter — which is what an abraded margin actually looks like;
  //    alpha (optional, default 1) is the FEATHER. A wound is opaque where it
  //      is a hole and has to reach zero before it reaches its outline, or the
  //      decal ends in a cut edge and reads as a sticker no matter how good
  //      the shading inside it is. r128's shader takes a 4-component `color`
  //      attribute (USE_COLOR_ALPHA → `diffuseColor *= vColor`), verified in
  //      the vendored build, so this costs one float per vertex and no
  //      material, texture or second pass.
  //  `jitter` wobbles every ring by one shared randomly-phased sine sum, so the
  //  silhouette is torn but the bands stay concentric inside it.
  //
  //  Cost: one shared indexed BufferGeometry per wound TYPE, built once at
  //  load. A hit still draws exactly one mesh; only its triangle count moves,
  //  from 14 to ~130 on a decal that is four centimetres across.
  function discGeo(stops, seg, jitter) {
    const n = stops.length;
    const vN = 1 + (n - 1) * (seg + 1);
    const pos = new Float32Array(vN * 3);
    const nrm = new Float32Array(vN * 3);
    const col = new Float32Array(vN * 4);
    const idx = [];
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    pos[0] = 0; pos[1] = 0; pos[2] = 0; nrm[2] = 1;
    col[0] = stops[0][1]; col[1] = stops[0][1] * stops[0][2]; col[2] = stops[0][1] * stops[0][2];
    col[3] = stops[0][3] != null ? stops[0][3] : 1;
    let maxR = 0, v = 1;
    for (let s = 1; s < n; s++) {
      const r0 = stops[s][0], val = stops[s][1], warm = stops[s][2];
      const alp = stops[s][3] != null ? stops[s][3] : 1;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const k = jitter
          ? 1 + jitter * (Math.sin(a * 3 + p1) * 0.5 + Math.sin(a * 5 + p2) * 0.33 + Math.sin(a * 7 + p3) * 0.2)
          : 1;
        const rr = r0 * k;
        pos[v * 3] = Math.cos(a) * rr; pos[v * 3 + 1] = Math.sin(a) * rr; pos[v * 3 + 2] = 0;
        nrm[v * 3 + 2] = 1;
        col[v * 4] = val; col[v * 4 + 1] = val * warm; col[v * 4 + 2] = val * warm;
        col[v * 4 + 3] = alp;
        if (rr > maxR) maxR = rr;
        v++;
      }
    }
    for (let i = 0; i < seg; i++) idx.push(0, 1 + i, 2 + i);            // centre fan
    for (let s = 1; s < n - 1; s++) {                                   // ring strips
      const a0 = 1 + (s - 1) * (seg + 1), b0 = 1 + s * (seg + 1);
      for (let i = 0; i < seg; i++) {
        idx.push(a0 + i, b0 + i, b0 + i + 1, a0 + i, b0 + i + 1, a0 + i + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    g._shared = true;
    g._maxR = maxR || 1;
    return g;
  }
  // ENTRY: a bore you look INTO, ringed by one narrow raw margin and a low-
  // contrast bruise collar that dissolves into skin (a bright hard rim is what
  // read as a sticker). Nearly round — a punched hole is not ragged.
  const G_ENTRY = discGeo([
    [0.00, 0.05, 1.00, 1.00],   // the bore itself — near-black at any wound colour
    [0.34, 0.09, 1.00, 1.00],   // pit wall, still dark
    [0.60, 0.85, 0.72, 1.00],   // the raw torn margin: THE one bright band
    [0.80, 0.44, 0.80, 0.72],   // abrasion / stippling — starts letting skin through
    [1.00, 0.20, 0.88, 0.00],   // bruising, gone by the outline (it was a cut edge)
  ], 16, 0.07);
  // EXIT: a cavity, not a bore. Brightest just off centre (wet, open tissue),
  // fading out, and TORN — the heavy rim jitter is the whole silhouette.
  const G_EXIT = discGeo([
    [0.00, 0.58, 0.85, 1.00],
    [0.30, 0.95, 0.72, 1.00],
    [0.55, 0.62, 0.78, 1.00],
    [0.78, 0.34, 0.85, 0.66],
    [1.00, 0.13, 0.90, 0.00],
  ], 18, 0.30);

  function unlit(color, po) {
    // unlit = the wound reads as a HOLE (no light catch), and it's the
    // cheapest material in the renderer. _shared → rig-disposal sweeps skip it.
    // vertexColors MULTIPLIES this colour by the geometry's baked radial ramp,
    // which is what turns a flat fill into a pit. Every material here keeps its
    // authored hex — the ramp only shades within it. (r128 takes a boolean.)
    //
    // polygonOffset is what lets the mark sit nearly FLUSH with the skin
    // instead of standing 13 mm proud of it: the decal wins the depth test on
    // shading distance rather than on a physical gap you can see edge-on. The
    // stack is deliberately ordered — holes (-3) beat their soak stain (-1)
    // beats the body — so a stain can never swallow the hole it belongs to.
    //
    // ---- transparent + depthWrite:false, and both halves are deliberate ----
    //
    // WHY TRANSPARENT (owner, 2026-08-26, on being bitten: the marks are
    // stickers). Every geometry above bakes a radial ramp that fades to
    // nothing at the outline, and every one of those ramps was being THROWN
    // AWAY, because an opaque material cannot fade to nothing — it can only
    // fade to a slightly different colour and then stop dead at the triangle
    // edge. A blood soak with a hard border is not blood. Turning blending on
    // is what lets the alpha column of the vertex ramp actually reach the
    // framebuffer, so a puncture and a stain end in skin instead of in a rim.
    //
    // WHY depthWrite IS OFF. A transparent surface that writes depth is a
    // trap: its INVISIBLE fragments (alpha 0 out at the feathered rim) still
    // stamp the depth buffer, so anything drawn later and further away —
    // another decal, spray, the water veil, rain — is depth-rejected inside a
    // disc-shaped region where nothing is drawn. That is a literal hole
    // punched in the frame, and it is the standard way "I made my decal
    // transparent" turns into "there is a circle of missing world on this
    // guy's thigh". Off, the decal only READS depth, which is all it needs:
    // polygonOffset biases the value used by the TEST as well as the write, so
    // the mark still wins against the skin it sits on and still cannot z-fight
    // it. What we give up is decal-vs-decal depth rejection, and that is the
    // right thing to give up — two overlapping blood marks should BLEND (and
    // darken, which is what real overlapping blood does), not fight.
    //
    // Ordering between a hole and its own soak is then a sort question, not a
    // depth question, so it is answered explicitly at the spawn sites with
    // renderOrder (soak 0.1 under hole 0.2). Deliberately fractional: whole
    // numbers would jump the whole decal population past every other
    // renderOrder-0 transparent in the scene.
    const m = new THREE.MeshBasicMaterial({
      color, vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: po != null ? po : -3, polygonOffsetUnits: po != null ? po : -3,
    });
    m._shared = true;
    return m;
  }
  const RO_RING = 0.1, RO_WOUND = 0.2;   // see the renderOrder note in unlit()
  const MAT_FRESH = unlit(0x4e070b);   // fresh entry wound: near-black red
  const MAT_DRY = unlit(0x351409);     // dried: dark brown scab
  const MAT_RING = unlit(0x310609, -1); // the wet ring round a hole: near-black red
  // TORN flesh (a bite) is WETTER and brighter than a bullet's cauterised-looking
  // entry hole — a tooth tears the skin open rather than punching through it.
  const MAT_TORN = unlit(0x6b0d10);
  // An EXIT is wetter and redder still: it is not a hole, it is an opening.
  const MAT_EXIT = unlit(0x8a1014);

  // ============================================================
  //  WOUND_REAL_V3 — STAB SLITS, AND THE HOLE IN THE CLOTHES
  //  (2026-09-29, owner: "bullet holes and stab holes and realness; blood is
  //  already pretty damn good").
  //
  //  WHAT WAS STILL FAKE:
  //   1. A KNIFE LEFT A BULLET HOLE. kind "blade" drew G_WOUND — a round disc
  //      — squashed to an ellipse at a RANDOM spin, sized off the legacy
  //      damage dial (0.24 u long on a 0.7 shank: a third of a chest). A stab
  //      is a SLIT: a lens pinched to a point at both ends, gaping dark along
  //      its middle with raw lips, lying along the blade. Now: G_SLIT, laid
  //      along the blade's own path across the skin (a slash runs with the
  //      swing; a thrust stands the edge up with a little wrist tilt), sized
  //      off the BLADE's width in millimetres, not off damage.
  //   2. THE CLOTHES WERE NEVER HOLED. Every mark sat on the garment as if it
  //      were skin: the red bore of an entry wound painted straight onto a
  //      denim jacket. Rounds and blades go THROUGH cloth and leave a torn
  //      hole or a frayed cut in it, and the fabric around is what the blood
  //      wicks into. Now every clothed hit also stamps a CLOTH mark — a ragged
  //      torn hole (bullet), a star tear (exit), a frayed slit (blade) — drawn
  //      with MULTIPLY blending, so it darkens WHATEVER the garment is (blue
  //      denim stays blue around a black torn hole; a white shirt shows a grey
  //      fibre edge) with one shared material and no texture sampling.
  //      Skin (head, hands, a bare forearm matched against the rig's own skin
  //      tone) gets no cloth mark.
  //   3. BLOOD STOPPED SPREADING AFTER TWO SECONDS. A soak now keeps CREEPING
  //      outward through the cloth for ~40 s after its fast bloom (capped by
  //      the panel, so the audit's oversized ratchet still reads 0), on the
  //      existing 0.8 s lifecycle sweep — no per-frame cost.
  // ============================================================
  // One fan builder for both shapes. rings: [rx, ry, bright, warm, alpha],
  // ordered outward. o.slit → the unit outline is a pointed LENS (y = cos a,
  // x = sgn(sin a)|sin a|^1.5 — the pinch that makes the ends acute); o.jitter
  // = a smooth sine wobble (a tear), o.rag = per-segment random fray (fibres),
  // applied to every ring from the same noise so bands stay nested.
  function fanGeo(core, rings, seg, o) {
    o = o || {};
    const n = rings.length, vN = 1 + n * (seg + 1);
    const pos = new Float32Array(vN * 3), nrm = new Float32Array(vN * 3), col = new Float32Array(vN * 4);
    const idx = [];
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    const noise = [];
    for (let i = 0; i < seg; i++) noise.push(Math.random() * 2 - 1);
    nrm[2] = 1;
    col[0] = core[0]; col[1] = core[0] * core[1]; col[2] = core[0] * core[1]; col[3] = core[2] != null ? core[2] : 1;
    let v = 1, maxR = 0;
    for (let s = 0; s < n; s++) {
      const rg = rings[s], rx = rg[0], ry = rg[1], val = rg[2], warm = rg[3], alp = rg[4] != null ? rg[4] : 1;
      const own = [];
      for (let i = 0; i < seg; i++) own.push(Math.random() * 2 - 1);
      for (let i = 0; i <= seg; i++) {
        const j = i % seg, a = (j / seg) * Math.PI * 2;
        const sm = o.jitter ? o.jitter * (Math.sin(a * 3 + p1) * 0.5 + Math.sin(a * 5 + p2) * 0.33 + Math.sin(a * 7 + p3) * 0.2) : 0;
        const rag = o.rag ? o.rag * (noise[j] * 0.7 + own[j] * 0.3) : 0;
        let x, y;
        if (o.slit) {
          const sa = Math.sin(a);
          x = (sa < 0 ? -1 : 1) * Math.pow(Math.abs(sa), 1.5) * rx * (1 + sm + rag);   // the lips fray
          y = Math.cos(a) * ry * (1 + sm * 0.25);                                     // the ends stay sharp
        } else {
          const k = 1 + sm + rag;
          x = Math.cos(a) * rx * k; y = Math.sin(a) * ry * k;
        }
        pos[v * 3] = x; pos[v * 3 + 1] = y; nrm[v * 3 + 2] = 1;
        col[v * 4] = val; col[v * 4 + 1] = val * warm; col[v * 4 + 2] = val * warm; col[v * 4 + 3] = alp;
        const rr = Math.hypot(x, y); if (rr > maxR) maxR = rr;
        v++;
      }
    }
    for (let i = 0; i < seg; i++) idx.push(0, 1 + i, 2 + i);
    for (let s = 1; s < n; s++) {
      const a0 = 1 + (s - 1) * (seg + 1), b0 = 1 + s * (seg + 1);
      for (let i = 0; i < seg; i++) idx.push(a0 + i, b0 + i, b0 + i + 1, a0 + i, b0 + i + 1, a0 + i + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    g._shared = true;
    g._maxR = maxR || 1;
    return g;
  }
  // THE STAB: a hairline dark gap the full length, raw wet lips either side,
  // a bruised margin, feathered to nothing. Unit long axis = y.
  const G_SLIT = fanGeo([0.03, 1, 1], [
    [0.07, 0.82, 0.04, 1.00, 1.00],   // the gap — you look into it
    [0.27, 0.92, 0.95, 0.70, 1.00],   // raw lips
    [0.56, 0.98, 0.46, 0.82, 0.78],   // bruised margin
    [1.00, 1.05, 0.20, 0.90, 0.00],   // gone by the outline
  ], 22, { slit: true, jitter: 0.04, rag: 0.05 });
  // THE CLOTH (multiply: 1.0 = the garment untouched, 0 = black). Values are
  // grey so the fabric keeps its own hue; only brightness moves.
  const G_CLOTH_HOLE = fanGeo([0.03, 1], [
    [0.30, 0.30, 0.05, 1],            // the torn hole
    [0.48, 0.48, 0.34, 1],            // fibre shadow at the ragged edge
    [0.72, 0.72, 0.74, 1],            // bullet wipe / grease ring
    [1.00, 1.00, 1.00, 1],
  ], 22, { jitter: 0.08, rag: 0.26 });
  const G_CLOTH_TEAR = fanGeo([0.05, 1], [
    [0.36, 0.36, 0.08, 1],            // blown outward: a star, not a hole
    [0.62, 0.62, 0.46, 1],
    [1.00, 1.00, 1.00, 1],
  ], 24, { jitter: 0.22, rag: 0.42 });
  const G_CLOTH_SLIT = fanGeo([0.04, 1], [
    [0.10, 0.92, 0.06, 1],            // the cut gapes
    [0.30, 0.97, 0.50, 1],            // frayed lips
    [0.60, 1.00, 0.84, 1],
    [1.00, 1.04, 1.00, 1],
  ], 22, { slit: true, jitter: 0.05, rag: 0.20 });
  // Multiply, unlit, untone-mapped (tone mapping would turn the 1.0 rim into
  // a visible darker ring), no fog (fog would tint the multiplier). Same
  // depth discipline as unlit(): reads depth, never writes it.
  const MAT_CLOTH = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,   // r128's MultiplyBlending (r187's wants premultiplied alpha)
    // the canvas keeps its own alpha: the context has one, and a multiply
    // that also multiplied it let the page show through as a pale quad
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    fog: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  MAT_CLOTH._shared = true;
  const RO_CLOTH = 0.15;              // over its soak, under the flesh it shows
  const CLOTH_HOLE_K = 2.3;           // cloth hole radius ÷ entry-wound radius
  const SLIT_MAX_FRAC = 0.40;         // a slit's LENGTH, as a fraction of the face width
  const SOAK_CREEP_T = 40;            // skin marks (bites): how long their stain wicks
  // THE BLOOD RING round a hole: a few cm and no more. Radius in rig units
  // (0.07 u reads as a few centimetres of wet fabric round a torn hole).
  const RING_K = 1.35;                // ring radius / the hole it rings (cloth hole if any)
  const RING_MAX = 0.075;             // never more than this, whatever hit
  const RING_MAX_FRAC = 0.30;         // ..and never more than 30% of the panel's width
  if (CBZ.CONFIG.WOUND_REAL_V3 == null) CBZ.CONFIG.WOUND_REAL_V3 = true;
  function realOn() { return CBZ.CONFIG.WOUND_REAL_V3 !== false; }

  // Is this panel CLOTH? Heads and hands are skin. A limb whose own material
  // IS the rig's skin tone (a bare forearm under a tee, a shirtless torso) is
  // skin. Everything else a round lands on is a garment.
  function clothedPart(actor, part, region) {
    if (region === "head") return false;
    const ch = actor.char, S = ch && ch.skinSlots;
    if (S && S.hands && S.hands.indexOf(part) >= 0) return false;
    let m = part.material;
    if (Array.isArray(m)) m = m[0];
    if (!m) return false;
    const tone = ch && ch.skinTone;
    if (tone != null && m.color && !m.map) {
      const c = m.color;
      const d = Math.abs(c.r - ((tone >> 16) & 255) / 255) + Math.abs(c.g - ((tone >> 8) & 255) / 255) + Math.abs(c.b - (tone & 255) / 255);
      if (d < 0.07) return false;
    }
    return true;
  }

  // Stamp one decal on a part (the shared tail of every mark below). `pad` is
  // the radius the CENTRE is kept inside the panel by — pass the same pad for
  // a hole and its cloth mark so the two can never be clamped apart.
  function stamp(actor, part, lp, geo, mat, ro, sx, sy, ax, spin, pad, kind) {
    const m = meshFor(actor);
    m.geometry = geo; m.material = mat; m.renderOrder = ro;
    seat(m, part, lp, proudFor(Math.max(sx, sy)), spin, ax, pad);
    hugDecal(m, part, proudFor(Math.max(sx, sy)));   // box face -> the real skin (see SKIN MARKS)
    m.scale.set(sx, sy, 1);
    part.add(m);
    wounds.push({ m, actor, age: 0, kind, dried: kind === "cloth" });
    actor._woundN = (actor._woundN || 0) + 1;
    return m;
  }
  // The in-plane spin that lays a decal's long (+y) axis along the part-local
  // direction t. seat() writes rotation (a, b, spin) with Euler XYZ, so the
  // spin is applied FIRST in the decal's own plane: read the decal's x/y axes
  // at spin 0, project t onto them, and solve Rz(spin)·(0,1) = t̂.
  const _sx = new THREE.Vector3(), _sy = new THREE.Vector3(), _sn = new THREE.Vector3(), _st = new THREE.Vector3();
  const _sq = new THREE.Quaternion(), _se = new THREE.Euler();
  function spinAlong(m, tx, ty, tz) {
    _se.set(m.rotation.x, m.rotation.y, 0, m.rotation.order);
    _sq.setFromEuler(_se);
    _sx.set(1, 0, 0).applyQuaternion(_sq);
    _sy.set(0, 1, 0).applyQuaternion(_sq);
    const u = tx * _sx.x + ty * _sx.y + tz * _sx.z, v = tx * _sy.x + ty * _sy.y + tz * _sy.z;
    if (u * u + v * v < 1e-6) return null;
    return Math.atan2(-u, v);
  }
  function decalNormal(m) {
    _se.set(m.rotation.x, m.rotation.y, 0, m.rotation.order);
    _sq.setFromEuler(_se);
    return _sn.set(0, 0, 1).applyQuaternion(_sq);
  }

  // WOUNDS_BITE — the one-line revert for the bite/maul wound type below.
  // OFF: a bite falls back to the ordinary "shot" wound it used to leave.
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.WOUNDS_BITE == null) CBZ.CONFIG.WOUNDS_BITE = true;

  const wounds = [];   // FIFO: { m, actor, age, kind, dried, gone }
  const free = [];     // recycled meshes awaiting reuse
  const tmpV = new THREE.Vector3();

  /* ---- THE REFUSAL LEDGER, and why a wound system needs one ---------------
     2026-08-26, from a measured capture: a player shark bites a survivor bot
     through the whole production path, aquaticMountAudit().hits increments,
     the killfeed prints EATEN BY A BULL SHARK, the body ragdolls — and
     CBZ.woundDecalAudit() reads {decals: 0}. Nothing on the body at all.

     That took an afternoon to NOT diagnose, and the reason is structural:
     every refusal in this file is a bare `return`, every caller between here
     and the bite site wraps the call in `try {} catch (e) {}` (creature_combat
     biteWound, wildlife_tame biteHumanWound — both swallow silently), and the
     one thing the game could report was a count of what DID get drawn. A
     system whose whole job is to leave evidence was the only system in the
     chain leaving none about itself.

     So every early return now stamps WHY, and the audit reports it. Cost:
     one string store on a path that was about to abandon the call anyway, and
     two counter increments on the path that succeeds. Read it with
     CBZ.woundDecalAudit().lastRefusal — one probe call instead of a bisect. */
  const LEDGER = { biteCalls: 0, biteMarks: 0, personBites: 0, animalBites: 0, woundCalls: 0, woundMarks: 0, refusals: 0, lastRefusal: "", lastBite: null, jobs: 0, jobsDropped: 0, biteMsMax: 0, sliceMsMax: 0, jobFrameMsMax: 0 };
  function refuse(why) { LEDGER.refusals++; LEDGER.lastRefusal = why; }

  function dist2Cam(x, z) {
    const c = CBZ.camera && CBZ.camera.position;
    if (!c) return 0;
    const dx = x - c.x, dz = z - c.z;
    return dx * dx + dz * dz;
  }

  /* ---- WHICH BODY PART DID THE HIT LAND ON? -------------------------------

     THIS WAS BROKEN, AND NOT SUBTLY. It classified a hit by comparing the
     point's root-local y against the literals 1.98 (head), 1.02 (torso vs
     legs), 1.40 (elbow) and 0.47 (knee), and |x| against 0.47 (arm). Those
     numbers are correct for the rig entities/character.js built BEFORE
     HUMAN_SCALE landed — a 2.60-unit tall body. The rig has since been shrunk
     by a uniform 0.70 on `model` (config.js: CBZ.HUMAN_SCALE = 0.70; an adult
     now stands ~1.82 m) and NOTHING here moved with it. Every threshold is
     43% too high. Worked against the adult male, whose group-local landmarks
     are hip 0.665, elbow 0.966, shoulder 1.288, chin 1.316, crown 1.736:

       • y > 1.98 for a head can NEVER be true. The crown is at 1.736. A bite
         or a bullet to the face only ever resolved to the head because the
         CALLER passed head:true; a correct contact point could not.
       • y > 1.02 for the torso puts the waistline three quarters of the way
         up the chest, so every hit from the navel down — belly, hip, groin,
         the whole lower torso — came back "leg", got seated on a thigh, and
         (bullet path) started a LIMP.
       • |x| > 0.47 for an arm sits outside the arm entirely: the adult arm
         box spans 0.329 .. 0.539 from the midline, so the inner two thirds of
         both arms answered "torso".
       • y < 1.40 for the elbow is above the shoulder (1.288), so an arm hit
         that did resolve ALWAYS took the forearm mesh — the exact "every arm
         wound bunches at the elbow" failure the old comment says it fixed.
       • y < 0.47 for the knee is above the real knee (0.329), so the bottom
         third of the thigh was seated on the shin.

     And a CHILD rig is shorter again, so on a child literally every hit
     landed on a leg.

     THE FIX IS TO STOP GUESSING. The rig is a pile of boxes whose live world
     transforms we can read for free, so classify by asking the actual meshes
     which one the point is nearest — measured and name-free, like the bite
     code's own seat on the real triangles further down. It is correct for
     the adult male, the female rig, a child, any future HUMAN_SCALE, and any
     pose (a raised arm moves with its box), and there is no literal left in
     it that can drift out of date again.

     Cost: one subtree matrix update plus a box-distance test over ~13 meshes,
     on a hit event that is already distance-gated to 45 u. */
  const _ppP = new THREE.Vector3();
  const _ppC = new THREE.Vector3();
  // distance from the group-local point (x,y,z) to `mesh`'s box, in group units
  function partDist(g, mesh, gsc, x, y, z) {
    const prm = mesh.geometry && mesh.geometry.parameters;
    if (!prm) return -1;
    _ppC.setFromMatrixPosition(mesh.matrixWorld);
    g.worldToLocal(_ppC);
    const e = mesh.matrixWorld.elements;
    const sc = (Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) || gsc) / gsc;
    const hx = (prm.width || 0.3) * 0.5 * sc;
    const hy = (prm.height || 0.3) * 0.5 * sc;
    const hz = (prm.depth || 0.3) * 0.5 * sc;
    const dx = Math.max(0, Math.abs(x - _ppC.x) - hx);
    const dy = Math.max(0, Math.abs(y - _ppC.y) - hy);
    const dz = Math.max(0, Math.abs(z - _ppC.z) - hz);
    // the tie-break: a point inside two overlapping boxes (the pelvis laps the
    // torso, a limb cap laps its segment) goes to the SMALLER one, which is
    // the more specific answer and the one that carries the better read.
    return Math.sqrt(dx * dx + dy * dy + dz * dz) + Math.min(0.12, hx * hy * hz * 0.9);
  }
  const _ppBest = { mesh: null, region: "torso" };
  function pickPart(actor, px, py, pz, headFlag) {
    const S = actor.char.skinSlots, g = actor.group;
    // the whole subtree at once: 13 separate updateWorldMatrix(true,false)
    // calls would each re-walk the same parent chain.
    g.updateWorldMatrix(true, true);
    _ppP.set(px, py, pz);
    g.worldToLocal(_ppP);
    const x = _ppP.x, y = _ppP.y, z = _ppP.z;
    // A HEAD FLAG STILL WINS OUTRIGHT. Callers that name a headshot know
    // something the geometry does not (fpsmode's hit table, a kill cause), and
    // that outranks any measurement.
    if (headFlag && S.head && S.head[0]) return { mesh: S.head[0], region: "head" };
    const ge = g.matrixWorld.elements;
    const gsc = Math.sqrt(ge[0] * ge[0] + ge[1] * ge[1] + ge[2] * ge[2]) || 1;
    let best = null, bestR = "torso", bestD = 1e9;
    const consider = function (mesh, region) {
      if (!mesh || !mesh.geometry) return;
      const d = partDist(g, mesh, gsc, x, y, z);
      if (d < 0 || d >= bestD) return;
      bestD = d; best = mesh; bestR = region;
    };
    if (S.head) consider(S.head[0], "head");
    if (S.torso) { consider(S.torso[0], "torso"); consider(S.torso[1], "torso"); }
    if (S.pelvis) consider(S.pelvis[0], "torso");
    if (S.arms && S.arms.length === 2) { consider(S.arms[0], "armL"); consider(S.arms[1], "armR"); }
    if (S.armsLower && S.armsLower.length === 2) { consider(S.armsLower[0], "armL"); consider(S.armsLower[1], "armR"); }
    if (S.legs && S.legs.length === 2) { consider(S.legs[0], "legL"); consider(S.legs[1], "legR"); }
    if (S.legsLower && S.legsLower.length === 2) { consider(S.legsLower[0], "legL"); consider(S.legsLower[1], "legR"); }
    if (!best) return { mesh: S.torso && S.torso[0], region: "torso" };
    // tmpV is what the callers go on to re-derive the part-local point from;
    // leave it holding the root-local point exactly as this function always has.
    tmpV.copy(_ppP);
    _ppBest.mesh = best; _ppBest.region = bestR;
    return _ppBest;
  }

  // ---- seat a decal on a part: part-local point → snapped to the box face --
  // the round came through, slightly proud, spun in its own plane.
  // which box face did the hit come through? Split out of seat() so the bite
  // arc below can lay a whole tooth row on the SAME face without re-deriving it
  // per tooth (and without any risk of two teeth snapping to different faces).
  function faceAxis(part, lp) {
    const prm = part.geometry.parameters || {};
    const hx = (prm.width || 0.6) * 0.5, hy = (prm.height || 0.9) * 0.5, hz = (prm.depth || 0.45) * 0.5;
    const rx = Math.abs(lp.x) / hx, ry = Math.abs(lp.y) / hy, rz = Math.abs(lp.z) / hz;
    if (rx > rz + 0.02 && rx > ry) return "x";
    if (ry > rz + 0.02 && ry > rx) return "y";
    return "z";                                   // front/back wins ties
  }
  // The NARROW half-span of the panel a decal seated on face `ax` actually has
  // to fit inside — i.e. half of "how wide is the thing it hit". This is the
  // one number every size clamp below measures against, and it is read off the
  // real rig mesh the hit resolved to, so nothing here ever has to know that a
  // head, a forearm and a chest are different (BLOCK LAW: no part is named).
  function faceMin(part, ax) {
    const prm = part.geometry.parameters || {};
    const hx = (prm.width || 0.6) * 0.5, hy = (prm.height || 0.9) * 0.5, hz = (prm.depth || 0.45) * 0.5;
    if (ax === "x") return Math.min(hz, hy);
    if (ax === "y") return Math.min(hx, hz);
    return Math.min(hx, hy);
  }
  // THE CLAMP. A decal's true outer radius (its scale times its geometry's own
  // wobble) may never reach the half-span of the face it sits on, so its
  // DIAMETER can never reach that face's WIDTH. 0.96 keeps a hair of margin so
  // the audit below reads a clean zero rather than sitting on the boundary.
  function fitR(geo, r, minHalf) {
    const mr = (geo && geo._maxR) || 1;
    return Math.min(r, (minHalf * 0.96) / mr);
  }
  // The radius at which a decal's DIAMETER is exactly `frac` of the face's
  // WIDTH. Every design cap below is quoted that way ("a third of the panel"),
  // so it must divide out the geometry's own rim wobble — quoting a cap as a
  // radius and reading it as a diameter is how 0.34 silently became 0.43.
  function capR(geo, minHalf, frac) {
    return (minHalf * frac) / ((geo && geo._maxR) || 1);
  }
  // spinOverride/axOverride/padR are optional; omitted = the original behaviour.
  // padR is the decal's true outer radius: the centre is pulled in by it so the
  // mark cannot HANG OFF the edge of the part (the old 0.78 clamp let a wide
  // disc centred near the edge overhang by its own radius — half the reason a
  // head wound read as a sticker pasted over the face).
  function seat(m, part, lp, proud, spinOverride, axOverride, padR) {
    const prm = part.geometry.parameters || {};
    const hx = (prm.width || 0.6) * 0.5, hy = (prm.height || 0.9) * 0.5, hz = (prm.depth || 0.45) * 0.5;
    const ax = axOverride || faceAxis(part, lp);
    const pad = padR || 0;
    const cl = (v, h) => {
      const lim = Math.max(0, Math.min(h * 0.78, h - pad));
      return Math.max(-lim, Math.min(lim, v));
    };
    const spin = spinOverride != null ? spinOverride : Math.random() * 6.28;   // decal spin in its own plane
    // A LOFTED LIMB (entities/character.js LIMBS) is round, not a box: the
    // mark goes ON its real surface at the hit's height, along the hit's own
    // bearing, facing out along the section's normal — the box face would
    // float it off a wrist by several centimetres.
    const lh = ax !== "y" && CBZ.humanLimbHalfAt ? CBZ.humanLimbHalfAt(part.geometry, cl(lp.y, hy)) : null;
    if (lh) {
      let dx = lp.x, dz = lp.z - lh.cz;
      if (Math.abs(dx) + Math.abs(dz) < 1e-6) dz = 1;
      const k = 1 / Math.sqrt((dx * dx) / (lh.hx * lh.hx) + (dz * dz) / (lh.hz * lh.hz));
      const px = dx * k, pz = dz * k;
      let nx = px / (lh.hx * lh.hx), nz = pz / (lh.hz * lh.hz);
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      m.position.set(px + nx * proud, cl(lp.y, hy), lh.cz + pz + nz * proud);
      m.rotation.set(0, Math.atan2(nx, nz), spin);
      return;
    }
    if (ax === "x") {
      const s = lp.x >= 0 ? 1 : -1;
      m.position.set(s * (hx + proud), cl(lp.y, hy), cl(lp.z, hz));
      m.rotation.set(0, s * Math.PI / 2, spin);
    } else if (ax === "y") {
      const s = lp.y >= 0 ? 1 : -1;
      m.position.set(cl(lp.x, hx), s * (hy + proud), cl(lp.z, hz));
      m.rotation.set(s > 0 ? -Math.PI / 2 : Math.PI / 2, 0, spin);
    } else {
      const s = lp.z >= 0 ? 1 : -1;
      m.position.set(cl(lp.x, hx), cl(lp.y, hy), s * (hz + proud));
      m.rotation.set(0, s > 0 ? 0 : Math.PI, spin);
    }
  }

  // ---- mesh pool ------------------------------------------------------------
  function dropWound(i, reuse) {
    const r = wounds.splice(i, 1)[0];
    r.gone = true;
    if (r.m.parent) r.m.parent.remove(r.m);
    if (r.actor) r.actor._woundN = Math.max(0, (r.actor._woundN || 1) - 1);
    if (!reuse && free.length < 64) free.push(r.m);  // reuse = caller takes the mesh
    return r.m;
  }
  function meshFor(actor) {
    const m = meshFor0(actor);
    // a recycled mesh may carry a frozen matrix from its last body (see the
    // SKIN MARKS root-cause note): re-arm it, or it draws at its OLD offset
    m.matrixAutoUpdate = true;
    return m;
  }
  function meshFor0(actor) {
    // per-actor cap: recycle THIS body's oldest hit first (keeps wounds
    // ACCUMULATING — shooting a corpse keeps adding holes — but bounded).
    if ((actor._woundN || 0) >= perActor(actor)) {
      for (let i = 0; i < wounds.length; i++) {
        if (wounds[i].actor === actor) return dropWound(i, true);
      }
    }
    if (free.length) return free.pop();
    if (wounds.length >= capGlobal()) return dropWound(victim(), true);
    const m = new THREE.Mesh(G_WOUND, MAT_FRESH);
    m.castShadow = m.receiveShadow = false;
    return m;
  }

  // GLOBAL CAP VICTIM. The player must never watch a hole vanish, so when the
  // pool is full the record recycled is the one furthest from the lens, with
  // a big bonus for being behind it; age breaks ties (index 0 = oldest). Runs
  // only at the cap (one pass over the records), never per frame.
  const _vp = new THREE.Vector3();
  function victim() {
    const cam = CBZ.camera;
    if (!cam || !wounds.length) return 0;
    const cx = cam.position.x, cz = cam.position.z;
    cam.getWorldDirection(_vp);
    const fx = _vp.x, fz = _vp.z;
    let best = 0, bs = -Infinity;
    for (let i = 0; i < wounds.length; i++) {
      const a = wounds[i].actor, p = a && (a.pos || (a.group && a.group.position));
      let sc;
      if (!p) sc = 1e9;                        // nobody to see it on
      else {
        const dx = p.x - cx, dz = p.z - cz;
        sc = dx * dx + dz * dz;
        if (dx * fx + dz * fz < 0) sc += 1e6;  // behind the lens
      }
      sc -= i * 1e-3;
      if (sc > bs) { bs = sc; best = i; }
    }
    return best;
  }

  // ---- THE FIRST-PERSON ARMS CARRY YOUR HOLES TOO ---------------------------
  // with no code here: the first-person arm IS the player rig's arm
  // (systems/fphands.js poseBodyArm mirrors every piece hanging off the rig's
  // limb into the viewmodel each frame), so a hole stamped on the rig's
  // forearm or upper arm below is drawn down the lens in the same place, at
  // the same size, on the same cloth. (It used to be re-stamped onto a
  // separate lathe arm by hand, with its own size guess and cap.)

  // ---- THE BLOOD RING: a small tight ring of blood round a hole --------------
  // a child of the SAME part, seated on the SAME face, under the hole; stamped
  // at its FINAL size on the frame of the hit. It never grows and never
  // spreads: the clothes keep their colour, the blood is in the hole's ring
  // and on the ground. `holeR` = the outer radius of what it rings.
  // o (optional): { spin, kx, ky } — a ring laid ALONG something (a slit).
  function spawnRing(actor, part, lp, ax, holeR, pad, o) {
    const m = meshFor(actor);
    const geo = G_RING[(Math.random() * 3) | 0];
    m.geometry = geo;
    m.material = MAT_RING;
    m.renderOrder = RO_RING;      // under its own hole (see unlit()'s renderOrder note)
    const mh = faceMin(part, ax);
    const cap = Math.min(RING_MAX, capR(geo, mh, RING_MAX_FRAC), fitR(geo, mh, mh));
    const r = Math.min(cap, holeR * RING_K * (0.92 + Math.random() * 0.16));
    const gx = Math.min(cap, r * ((o && o.kx) || 1)), gy = Math.min(cap, r * ((o && o.ky) || 1));
    seat(m, part, lp, PROUD_SOAK_V2, o && o.spin != null ? o.spin : undefined, ax,
         Math.max(pad || 0, Math.max(gx, gy) * geo._maxR));
    hugDecal(m, part, PROUD_SOAK_V2);
    m.scale.set(gx, gy, 1);
    part.add(m);
    wounds.push({ m, actor, age: 0, kind: "ring", dried: true });
    actor._woundN = (actor._woundN || 0) + 1;
    return m;
  }

  // ---- ENTRY vs EXIT: where was the round GOING? ----------------------------
  //
  //  The whole point of an exit wound is that it is on the OTHER SIDE, so it
  //  cannot be faked from the hit point alone — and we do not fake it. Two
  //  honest sources, in order:
  //    1. opts.dir — the shot direction, if the caller has a ray. NOTHING in
  //       the game passes this yet (fpsmode.js and gore.js both have the vector
  //       in scope at their bodyWound call and simply don't thread it); the
  //       argument exists so they can, in one word each.
  //    2. opts.fromX/fromZ — the ATTACKER'S OWN POSITION, which police.js,
  //       peds.js, ragdoll.js and predator.js already pass to bias the wound
  //       onto the facing surface. Attacker → hit point IS the shot line. It is
  //       horizontal-only (no muzzle height), which is why y is left at 0
  //       rather than guessed.
  //  No direction from either source means NO EXIT MARK. A wound stamped on a
  //  side the round never came out of would be a worse lie than the sticker.
  function throughDir(opts, wp) {
    const d = opts.dir;
    if (d) {
      const l = Math.hypot(d.x || 0, d.y || 0, d.z || 0);
      if (l > 1e-4) return { x: (d.x || 0) / l, y: (d.y || 0) / l, z: (d.z || 0) / l };
    }
    if (opts.fromX != null && opts.fromZ != null) {
      const dx = wp.x - opts.fromX, dz = wp.z - opts.fromZ;
      const l = Math.hypot(dx, dz);
      if (l > 0.05) return { x: dx / l, y: 0, z: dz / l };
    }
    return null;
  }
  const _ld1 = new THREE.Vector3(), _ld2 = new THREE.Vector3();
  // world direction → the part's local frame (two transformed points, so the
  // part's own scale is honoured exactly the way worldToLocal honours it for
  // the hit point itself).
  function localDir(part, wp, d) {
    _ld1.set(wp.x, wp.y, wp.z); part.worldToLocal(_ld1);
    _ld2.set(wp.x + d.x, wp.y + d.y, wp.z + d.z); part.worldToLocal(_ld2);
    _ld2.sub(_ld1);
    const l = _ld2.length();
    return l > 1e-6 ? _ld2.multiplyScalar(1 / l) : null;
  }
  // Where does a ray from `lp` along `dl` LEAVE the part's box? Slab test in
  // the part's own local frame: the nearest positive face crossing wins, and it
  // hands back the face axis so seat() can put the mark there without any
  // notion of front/back/side.
  const _ex = { ax: "z", x: 0, y: 0, z: 0, t: 0 };
  function boxExit(part, lp, dl) {
    const prm = part.geometry.parameters || {};
    const h = { x: (prm.width || 0.6) * 0.5, y: (prm.height || 0.9) * 0.5, z: (prm.depth || 0.45) * 0.5 };
    const A = ["x", "y", "z"];
    let bt = Infinity, ba = null;
    for (let i = 0; i < 3; i++) {
      const a = A[i], d = dl[a];
      if (Math.abs(d) < 1e-5) continue;
      const t = ((d > 0 ? h[a] : -h[a]) - lp[a]) / d;
      if (t > 1e-4 && t < bt) { bt = t; ba = a; }
    }
    if (!ba) return null;
    _ex.ax = ba; _ex.t = bt;
    _ex.x = lp.x + dl.x * bt; _ex.y = lp.y + dl.y * bt; _ex.z = lp.z + dl.z * bt;
    return _ex;
  }

  // ============================================================
  //  BITES — EVERY TOOTH, WHERE IT MET THIS BODY.
  //
  //  Owner, 2026-11-22: "improving the way humans look after different bites
  //  from diff animals and the way animals look after diff bites from diff
  //  animals ... I don't want any fake shit I want real physics."
  //
  //  WHAT WAS FAKE. Every attacker laid the same stamp: one painted "two
  //  crescents" print, one soak and one cloth tear, scaled by `jaw` alone (a
  //  wolf's jaw number from creature_combat is 0.25 m, so its print was half a
  //  metre wide), in one saturated red with a hard rim, white scratch lines and
  //  black spikes (3-D slits stood on the skin), the same colours on a sleeve,
  //  on fur, on a shark and on a whale. And on every rebuilt animal (one
  //  SkinnedMesh each) it laid nothing at all: the projector refused skinned
  //  meshes, and the chunk code shrank "the part", which on a one-mesh body is
  //  the whole animal.
  //
  //  WHAT A BITE IS NOW, in order, all of it measured on the bodies involved:
  //   1. THE ATTACKER'S TEETH (systems/dentition.js): every tooth's place in
  //      the arch, its crown length and width, its shape, and what the head
  //      does once they are in (shake, saw, rake, crush, slice, take flesh).
  //   2. THE STRIKE. The arch is put round the contact in the mouth's own
  //      frame and every tooth is driven along its real path: the jaw's line
  //      of attack, and the close of the jaws. A tooth leaves a mark only
  //      where that path meets this body's surface. So a dog's bite on a
  //      forearm puts its canines on top of the arm and the lower ones under
  //      it; on a flank it leaves two facing arcs of incisors and canines and
  //      nothing from the premolars that never reached; a great white's
  //      serrated row cuts a crescent; an orca's cones punch spaced holes.
  //   3. WHAT EACH TOOTH LEAVES, by its shape and the head's behaviour:
  //      punctures dark at depth with a pale torn lip; serrated cuts joined
  //      by the saw into one scalloped incision; lacerations dragged out of
  //      the deep teeth by the shake; parallel rakes along the line of travel;
  //      clean slices from blades; bruising between the jaws that darkens
  //      over the next twenty seconds.
  //   4. THE BODY ANSWERS IN ITS OWN TISSUE. Marks are drawn by a shader that
  //      colours each pixel by how deep the wound goes there, through the
  //      victim's own layers: skin, fat, red muscle for people and furred
  //      animals; a pale blubber band over near-black muscle for whales and
  //      dolphins; pale pink flesh for sharks; white flesh for bony fish (red
  //      for tuna). Cloth is punctured, torn along the pull and soaked;
  //      fur mats dark rather than taking paint; a fish loses scales round
  //      the bite; torn cloth and hide hang as real flaps.
  //   5. FLESH THAT IS GONE IS GONE. On a one-mesh body the vertices inside
  //      the jaw's removal volume are pushed back to its floor (a scalloped
  //      crater) in a copy of the geometry owned by that animal; a bite
  //      through a thin part (a fin, a fluke, an ear) or round a tail stock
  //      takes the triangles inside the jaw, everything no longer connected
  //      to the body comes away with them, the raw end is capped with its own
  //      cross-section, and the piece that left is a real object in the
  //      water. A rigid body (people, the bestiary) shows the crater painted.
  //   6. BLOOD MOVES. On land it soaks and wicks (cloth, fur), and runs down
  //      the body along the real surface under gravity, lengthening over
  //      time; under water it thins off the wound and goes into the sea
  //      (bleedFor's plume, below).
  //
  //  RIDING THE SKIN. A skinned body's marks are clipped from its POSED
  //  triangles (systems/surfacedecal.js, the game's one projector), rebuilt in
  //  the body's bind space with the source vertices' bone weights blended by
  //  barycentre (four strongest kept), and drawn as a SkinnedMesh bound to the
  //  same skeleton and bind matrix: the mark bends with the swimming tail and
  //  the running dog's flank. A rigid part's marks are children of the part.
  //
  //  BUDGET. One bite is at most two meshes per body part it touched (the
  //  tissue layer, the multiply layer), every per-bite geometry is disposed
  //  with its record, a body's own geometry copy is made once, on its first
  //  bite that takes flesh, and freed (shared attributes detached first) by
  //  the same sweep that drops the records of bodies that left the scene.
  // ============================================================
  const SKIN = [];                       // {m, actor, host, layer, age, t, anims, fc, gone}
  function skinCap() { return (CBZ.qScale ? CBZ.qScale(40, 140) : 90) | 0; }
  const SKIN_PER_ACTOR = 48;             // meshes: a bite is 1-2 per part it touched
  const SKIN_RO = 0.25;                  // over the holes and soaks: it is the top layer of skin
  const SKIN_LIFT = 0.0025;              // metres off the skin, along the skin's own normal
  function NOOP() {}

  // ---- noise ----------------------------------------------------------------
  function h2(x, y, s) {                 // integer hash -> 0..1 (no trig: it runs per texel)
    let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((y | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul((s | 0) + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }
  // one 64x64 lattice of hashes, built once; value noise reads it
  let NTAB = null;
  function vnoise(x, y, s) {             // smooth value noise, 0..1
    if (!NTAB) { NTAB = new Float32Array(64 * 64); for (let i = 0; i < 4096; i++) NTAB[i] = h2(i & 63, i >> 6, 7); }
    const xs = x + s * 17.3, ys = y + s * 7.9;
    const xi = Math.floor(xs), yi = Math.floor(ys), xf = xs - xi, yf = ys - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = xi & 63, x1 = (xi + 1) & 63, y0 = (yi & 63) << 6, y1 = ((yi + 1) & 63) << 6;
    const a = NTAB[y0 + x0], b = NTAB[y0 + x1], c = NTAB[y1 + x0], d = NTAB[y1 + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function sstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  // two octaves on rotated axes: no square grain from the lattice
  function fbm(x, y, s) {
    return 0.62 * vnoise(x * 0.8 + y * 0.6, y * 0.8 - x * 0.6, s) + 0.38 * vnoise(x * 1.25 - y * 1.6, y * 1.25 + x * 1.6, s + 3);
  }
  // the angle's own noise, continuous round the circle
  function angN(th, s) { return vnoise(Math.cos(th) * 2.3 + 5, Math.sin(th) * 2.3 + 5, s); }

  /* ---- THE TWO ATLASES ------------------------------------------------------
     TISSUE (4 x 3 cells of 128, linear DATA, not colour): per texel
       R depth (0 the cut's lip .. 1 the bottom of the wound)
       G where the fat shows in the cut's wall (patchy, never a ring)
       B wet blood on it      A cover (0 outside the opening and its blood)
     The tissue shader turns depth into the victim's own layers (see
     woundMat), so ONE puncture cell is a dog's bite in an arm, a cone's hole
     in a shark and an orca's in a whale, each in its own flesh. The skin
     round a wound is not painted here: it is the stain layer's.
     STAIN (4 x 3 cells of 128, display multipliers, drawn MULTIPLY): RGB a
     detail multiplier (never above 1), A how much of the stain there is.
     The shader fades the multiplier to white by A, so where A is 0 nothing
     changes, and a stain can only ever darken what is under it: blood in a
     weave (wicking along the threads, heavier downhill), blood matting fur,
     a film of blood on skin (thin blood is a dye: drawn as paint at half
     cover it turns to mud), a bruise, the inflamed skin round a wound, the
     hole a tooth tears in cloth, the coat parted round a hole, a rip, a
     tooth's scrape.
     Every shape fades to 0 well inside its cell (EDGE), so no mark ever ends
     on the cell's straight border.
     Both are painted a few rows a frame after the first seconds of play; a
     bite that comes first finishes them on the spot. */
  const SKIN_GUT = 4;
  const _px = [0, 0, 0, 0];
  function b255(v) { return v <= 0 ? 0 : (v >= 1 ? 255 : (v * 255 + 0.5) | 0); }
  function col(px, r, g, b, a) { px[0] = r; px[1] = g; px[2] = b; px[3] = a; }
  function texJob(fns, cols, rows, C) {
    return { fns: fns, cols: cols, rows: rows, C: C, W: cols * C, H: rows * C, data: new Uint8Array(cols * C * rows * C * 4), c: 0, j: 0, done: false };
  }
  function texJobStep(job, nRows) {
    const C = job.C, Wd = job.W, data = job.data, px = _px;
    while (nRows-- > 0 && !job.done) {
      const fn = job.fns[job.c], j = job.j;
      const ox = (job.c % job.cols) * C, oy = ((job.c / job.cols) | 0) * C;
      const y = (j + 0.5) / C * 2 - 1;
      for (let i = 0; i < C; i++) {
        const x = (i + 0.5) / C * 2 - 1;
        if (fn) fn(x, y, px); else col(px, 1, 1, 1, 0);
        // the gutter is forced clear, so a filtered sample never reaches the
        // neighbouring cell (the shapes are already clear long before it)
        const gut = i < SKIN_GUT || j < SKIN_GUT || i >= C - SKIN_GUT || j >= C - SKIN_GUT;
        const o = ((oy + j) * Wd + ox + i) * 4;
        data[o] = b255(px[0]); data[o + 1] = b255(px[1]); data[o + 2] = b255(px[2]);
        data[o + 3] = gut ? 0 : b255(px[3]);
      }
      if (++job.j >= C) { job.j = 0; if (++job.c >= job.fns.length) job.done = true; }
    }
    return job.done;
  }
  function makeTex(job, srgb) {
    texJobStep(job, 1e9);
    const t = new THREE.DataTexture(job.data, job.W, job.H, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    // the stain atlas is authored as DISPLAY multipliers (decoded on read and
    // re-encoded on the way out, so what is written is what the eye gets);
    // the tissue atlas is data and is read raw
    if (srgb && THREE.SRGBColorSpace != null) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    t._shared = true;
    return t;
  }
  // the safety margin every shape is already inside of
  function EDGE(x, y) { return 1 - sstep(0.86, 0.92, Math.max(Math.abs(x), Math.abs(y))); }

  // ---- the tissue cells (x, y in -1..1 across the cell; +y is "up" the mark)
  // the fat a cut shows: a thin band just inside its edge (e 0 at the edge,
  // 1 well inside), broken into patches (blood covers more of it)
  function fatBand(e, x, y, s) { return sstep(0.0, 0.03, e) * (1 - sstep(0.06, 0.12, e)) * sstep(0.6, 0.72, vnoise(x * 11, y * 11, s)); }
  // 0 PUNCTURE: a conical tooth's hole. Round with a hint of the tooth's three
  // sides, torn on along the drag (+x), a steep wall going black at the
  // bottom, the fat showing in patches in the wall, blood welling in it and
  // nothing outside it: the skin round it (inflamed, smeared with blood) is
  // the stain layer's.
  function cPuncture(x, y, px) {
    const r = Math.hypot(x, y), th = Math.atan2(y, x);
    const R0 = 0.33 * (1 + 0.07 * Math.cos(3 * th + 0.4) + 0.22 * (angN(th, 31) - 0.5)) + 0.12 * Math.pow(Math.max(0, Math.cos(th)), 5);
    const q = r / R0;
    const open = 1 - sstep(0.86, 1.0, q);
    const depth = open * Math.min(1, 0.3 + 0.8 * Math.pow(Math.max(0, 1 - q), 0.5));
    const fat = fatBand(1 - q, x, y, 32);
    const well = open * (0.3 + 0.45 * sstep(0.3, 0.75, vnoise(x * 5, y * 5, 34)));
    col(px, depth, fat * (1 - well), well, open * EDGE(x, y));
  }
  // 1 PUNCTURE, SLANTED: a tooth that went in at an angle and ploughed on: a
  // ragged slot, deepest where it entered (-x)
  function cPuncture2(x, y, px) {
    const ex = (x + 0.05) / 0.42, ey = y / 0.19;
    const th = Math.atan2(ey, ex);
    const q = Math.hypot(ex, ey) / (1 + 0.22 * (angN(th, 37) - 0.5) + 0.12 * Math.pow(Math.max(0, -Math.cos(th)), 4));
    const open = 1 - sstep(0.84, 1.0, q);
    const deep = 1 - sstep(-0.4, 0.5, x);
    const depth = open * Math.min(1, 0.25 + (0.45 + 0.5 * deep) * Math.pow(Math.max(0, 1 - q), 0.5));
    const fat = fatBand(1 - q, x, y, 38);
    const well = open * (0.3 + 0.5 * sstep(0.35, 0.7, vnoise(x * 6, y * 6, 39)));
    col(px, depth, fat * (1 - well), well, open * EDGE(x, y));
  }
  // 2 SERRATED: one serrated blade's cut. It enters at its widest (the base,
  // -y) and the close drags it on toward +y; both edges sawn.
  function cSerrated(x, y, px) {
    const t = (y + 0.70) / 1.45;
    if (t < -0.12 || t > 1.04) { col(px, 0, 0, 0, 0); return; }
    const tt = Math.max(0, Math.min(1, t));
    const b0 = -0.08 + 0.06 * (vnoise(x * 9, 5, 45) - 0.5);
    const hw0 = 0.44 * (1 - tt) * (1 + 0.14 * (vnoise(y * 4, 2, 41) - 0.5)) * sstep(b0, b0 + 0.12, t);
    const saw = 0.035 * (0.5 + 0.5 * Math.sin(y * 60 + 1.3)) * (1 - tt);
    const hw = Math.max(0, hw0 - saw);
    const ax = Math.abs(x + 0.025 * Math.sin(y * 3.1)) + 0.03 * (vnoise(y * 25, x > 0 ? 1 : 3, 43) - 0.5);
    const open = 1 - sstep(hw - 0.025, hw + 0.008, ax);
    const depth = open * (0.3 + 0.7 * (1 - sstep(0, Math.max(0.04, hw), ax)) * (1 - 0.5 * tt));
    const fat = fatBand((hw - ax) / Math.max(0.02, hw) * 0.5, x, y, 44);
    const blood = open * (0.4 + 0.35 * vnoise(x * 8, y * 8, 42));
    col(px, depth, fat * (1 - blood), blood, open * EDGE(x, y) * (1 - sstep(0.8, 0.86, Math.abs(y))));
  }
  // 3 SLIT: a clean cut along x (a blade's edge, a beak, a knife row)
  function cSlit(x, y, px) {
    const ax = Math.abs(x);
    if (ax > 0.84) { col(px, 0, 0, 0, 0); return; }
    const hw = 0.12 * Math.pow(Math.max(0, 1 - Math.pow(ax / 0.82, 2)), 0.6) * (1 + 0.2 * (vnoise(x * 6, 3, 51) - 0.5));
    const yc = 0.025 * Math.sin(x * 4.1) + 0.02 * (vnoise(x * 11, 4, 52) - 0.5);
    const ay = Math.abs(y - yc);
    const open = 1 - sstep(hw * 0.8, hw + 0.01, ay);
    const depth = open * (0.35 + 0.65 * (1 - sstep(0, Math.max(0.02, hw), ay)));
    const fat = fatBand((hw - ay) / Math.max(0.02, hw) * 0.5, x, y, 53);
    const blood = open * (0.45 + 0.25 * vnoise(x * 7, 1, 54));
    col(px, depth, fat * (1 - blood), blood, open * EDGE(x, y));
  }
  // 4 TEAR: a laceration the shake dragged out of a deep tooth. Torn, not
  // cut: the line wanders, the edges are ragged, the width comes and goes.
  function cTear(x, y, px) {
    const ax = Math.abs(x);
    if (ax > 0.84) { col(px, 0, 0, 0, 0); return; }
    const yc = 0.10 * Math.sin(x * 2.3 + 0.4) + 0.10 * (vnoise(x * 3, 7, 61) - 0.5);
    const hw = 0.2 * Math.pow(Math.max(0, 1 - Math.pow(ax / 0.82, 1.7)), 0.8) * (0.45 + 0.9 * vnoise(x * 4.5, 1, 62));
    const dy = y - yc;
    const ay = Math.abs(dy) + 0.05 * (vnoise(x * 22, dy > 0 ? 1 : 5, 63) - 0.5);
    const open = 1 - sstep(hw * 0.78, hw + 0.012, ay);
    const depth = open * (0.3 + 0.55 * (1 - sstep(0, Math.max(0.03, hw), ay)));
    const fat = fatBand((hw - ay) / Math.max(0.02, hw) * 0.5, x, y, 65);
    const blood = open * (0.5 + 0.35 * vnoise(x * 7, y * 7, 64));
    col(px, depth, fat * (1 - blood), blood, open * EDGE(x, y));
  }
  // 5 RAKE: one tooth dragged along the skin: a shallow line tapering in and
  // out, the skin scraped off and bleeding along it
  function cRake(x, y, px) {
    const ax = Math.abs(x);
    if (ax > 0.84) { col(px, 0, 0, 0, 0); return; }
    const taper = Math.pow(Math.max(0, 1 - Math.pow(ax / 0.82, 2)), 0.5);
    const yc = 0.05 * Math.sin(x * 3.3 + 0.7);
    const hw = 0.26 * taper * (0.65 + 0.7 * vnoise(x * 10, 2, 71));
    const ay = Math.abs(y - yc);
    const open = 1 - sstep(hw * 0.5, hw, ay);
    const blood = 0.62 + 0.3 * vnoise(x * 4, 3, 72);
    col(px, open * (0.06 + 0.1 * (1 - ay / Math.max(0.01, hw))), 0, blood, open * 0.95 * EDGE(x, y));
  }
  // 6 CRATER: where flesh was taken, an oval dish. Its rim scalloped by the
  // teeth that cut it, the cut muscle's grain across the floor, the fat in
  // patches in its wall, blood pooled in its lower half. Depth runs 0 at the
  // rim to 1 at the middle, so a whale's blubber shows as its own band.
  function cCrater(x, y, px) {
    const r = Math.hypot(x, y), th = Math.atan2(y, x);
    const sc = (0.5 + 0.5 * Math.cos(th * 15 + 1.7 + 2 * angN(th, 86))) * (0.3 + 0.9 * angN(th * 1.7, 87));
    const R0 = 0.78 * (1 - 0.05 * sc - 0.06 * (angN(th, 81) - 0.5));
    if (r > R0 + 0.04) { col(px, 0, 0, 0, 0); return; }
    const q = Math.min(1, r / R0);
    const fib = 0.025 * Math.sin(x * 46 + y * 9 + 4 * vnoise(x * 3, y * 3, 82)) * (1 - q) * (1 - q);
    const open = 1 - sstep(R0 - 0.03, R0 + 0.01, r);
    const depth = open * Math.min(0.97, Math.max(0, 0.08 + 0.9 * Math.pow(Math.max(0, 1 - q * q), 0.8) + fib));
    const fat = fatBand(1 - r / R0, x, y, 83);
    const blood = open * Math.min(0.85, Math.max(0.15 * (1 - q) + 0.55 * sstep(0.0, -0.7, y) + 0.15 * vnoise(x * 7, y * 7, 84), 0.7 * sstep(0.5, 0.72, vnoise(x * 6, y * 6, 85)) * sstep(0.55, 0.8, q)));
    col(px, depth, fat * (1 - blood), blood, open * EDGE(x, y));
  }
  // 7 GAPE: where a big mouth took a chunk, seen on the skin: wider than it
  // is deep, its outline torn (not cut) between the tooth lines that bound
  // it above and below, notched at tooth scale, a few tongues of skin left
  // hanging into it. Inside, the layers the teeth went through, as they
  // are: the torn skin at the lip, the fat under it as a lobed band in the
  // wall, then the muscle, its bundles running along the bite with dark
  // seams between them and the cut grain across them, the foot of the wall
  // in shadow. Blood stands in the floor's lower part up to a level, fills
  // the seams and runs down the wall from the upper lip. Black only in the
  // seams: a hole that deep is meat, not a shadow. The tooth cuts along its
  // two edges are their own marks.
  function cGape(x, y, px) {
    const ex = x / 0.74, ey = (y + 0.02) / 0.52;
    const r = Math.hypot(ex, ey), th = Math.atan2(ey, ex);
    // the tongues of skin: a few narrow lobes of the rim reaching in
    const tag = 0.14 * Math.pow(Math.max(0, Math.sin(th * 5 + 2.2 + 2.5 * angN(th, 149))), 22) * sstep(0.45, 0.7, angN(th * 3, 150));
    const R0 = 1 + 0.16 * (angN(th, 141) - 0.5) + 0.1 * (angN(th * 2 + 1.3, 142) - 0.5)
      - 0.05 * Math.pow(Math.abs(Math.sin(th * 9 + 3 * angN(th, 143))), 6) + 0.025 * (vnoise(x * 22, y * 22, 147) - 0.5) - tag;
    const q = r / R0;
    const open = 1 - sstep(0.9, 1.0, q);
    if (open <= 0) { col(px, 0, 0, 0, 0); return; }
    const e = Math.max(0, 1 - q);                           // 0 at the lip .. 1 in the middle
    // how thick the skin and the fat are here (they vary round the rim)
    const skinE = 0.035 + 0.02 * angN(th * 2.1, 153);
    const fatE = skinE + 0.12 + 0.1 * angN(th * 1.3, 152);
    const wallE = fatE + 0.08;                               // the muscle wall's foot
    // the muscle: bundles running along the bite (bent and uneven, as a
    // muscle's are), each rounded toward the light, narrow dark seams
    // between them, the cut fibres across them
    const yy = y + 0.22 * (vnoise(x * 1.6, y * 1.6, 154) - 0.5) + 0.12 * x * (vnoise(2, y * 2, 160) - 0.5);
    const ph = yy * (30 + 8 * (vnoise(x * 2, 5, 161) - 0.5));
    const band = 0.5 + 0.5 * Math.sin(ph);                   // 1 on a bundle's crest, 0 in a seam
    const inMuscle = sstep(fatE - 0.01, fatE + 0.04, e);
    const seam = Math.pow(1 - band, 8) * sstep(0.0, 0.06, e - fatE);
    const grain = 0.014 * Math.sin(x * 60 + 9 * vnoise(x * 3, yy * 12, 155)) * band;
    // depth through the victim's own layers (woundMat): the torn skin and
    // the fat shallow; a bundle's crest just into the muscle (lit, its
    // sheen), its flanks the muscle itself, a seam near the dark bottom
    const lip = 0.04 + 0.14 * sstep(0, skinE, e) + 0.12 * sstep(skinE, fatE, e);
    const meat = 0.2 + 0.16 * (1 - band * band) + 0.04 * (vnoise(x * 6, y * 6, 156) - 0.5) + grain + 0.52 * seam
      // the foot of the wall, where the floor meets it, is in its shadow
      + 0.26 * Math.max(0, 1 - Math.abs(e - wallE) / 0.05);
    let depth = lip + (meat - lip) * inMuscle;
    depth = open * Math.min(0.97, Math.max(0.02, depth));
    // the fat: a band in the wall, lobed (its lobules show as rounded bumps)
    const lob = sstep(0.3, 0.62, vnoise(x * 14, y * 14, 157));
    const fat = sstep(skinE * 0.7, skinE + 0.01, e) * (1 - sstep(fatE - 0.02, fatE + 0.01, e)) * (0.7 + 0.3 * lob);
    // blood: standing in the floor's lower part up to a level (flat, not a
    // gradient), in the seams, and run down the wall from the upper lip
    const level = -0.24 + 0.07 * (vnoise(x * 3, 1, 158) - 0.5);
    const pool = sstep(level + 0.035, level - 0.035, y) * sstep(skinE, fatE, e);
    const runs = sstep(0.66, 0.8, vnoise(x * 9, 3, 159)) * sstep(-0.05, 0.3, y) * (1 - inMuscle * 0.5);
    const film = 0.07 + 0.1 * vnoise(x * 7, y * 7, 146);
    const blood = open * Math.min(0.95, Math.max(pool, 0.65 * seam, 0.75 * runs, film));
    col(px, depth, fat * (1 - blood), blood, open * EDGE(x, y));
  }
  // 8 POOL: wet blood standing on bare skin under a wound: opaque (a pool is
  // not a film), glossy, its edge short and irregular. The thin film round
  // it is the stain layer's.
  function cBlood(x, y, px) {
    const yy = y - 0.05, ys = yy / (yy > 0 ? 0.7 : 1.0);
    const r = Math.hypot(x, ys), th = Math.atan2(ys, x);
    const edge = 0.6 * (1 + 0.14 * Math.sin(th * 3 + 0.7) + 0.08 * Math.sin(th * 5 + 2.1)) + 0.1 * (angN(th, 91) - 0.5);
    const a = 1 - sstep(edge - 0.07, edge, r);
    col(px, 0.03, 0, 1, a * EDGE(x, y));
  }
  // 9 top: a RUN of blood (u across the run, v along it); bottom: a FLAP's
  // outline (torn cloth or hide), frayed on every free edge
  function cStripFlap(x, y, px) {
    if (y > 0.06) {
      const prof = 1 - sstep(0.55 + 0.15 * vnoise(x * 3, y * 9, 95), 1.0, Math.abs(x));
      col(px, 0.03, 0.0, 1.0, prof);
    } else if (y < -0.06) {
      const fy = (y + 0.53) / 0.44, k = Math.max(0, Math.min(1, (fy + 1) * 0.5));
      const ex = (0.93 - 0.5 * k * k) * (1 - 0.14 * vnoise(y * 30, 1, 96)) + 0.08 * (vnoise(y * 5, 3, 98) - 0.5);
      const ey = 0.93 - 0.18 * vnoise(x * 24, 2, 97);
      const a = (1 - sstep(ex - 0.05, ex, Math.abs(x + 0.1 * k * (vnoise(1, 4, 99) - 0.5)))) * (1 - sstep(ey - 0.06, ey, Math.abs(fy)));
      col(px, 0, 0, 0, a);
    } else col(px, 0, 0, 0, 0);
  }
  // 11 RAGGED: a crushing bite's wound: torn open in lobes, tags of skin
  // poking into it, the crushed meat mottled, blood in its lower part
  function cRagged(x, y, px) {
    const r = Math.hypot(x, y), th = Math.atan2(y, x);
    const lobes = 0.18 * (angN(th, 161) - 0.5) + 0.12 * (angN(th * 2.3 + 1, 162) - 0.5);
    const tags = 0.06 * Math.pow(Math.abs(Math.sin(th * 7 + 3 * angN(th, 163))), 8);
    const R0 = 0.64 * (1 + lobes) - tags;
    const q = r / Math.max(0.05, R0);
    const open = 1 - sstep(0.88, 1.0, q);
    const mott = vnoise(x * 6, y * 6, 164);
    const depth = open * Math.min(1, Math.max(0, 0.3 + 0.6 * Math.pow(Math.max(0, 1 - q), 0.6) + 0.2 * (mott - 0.5)));
    const fat = fatBand(1 - q, x, y, 165);
    const blood = open * Math.min(0.9, 0.3 + 0.45 * sstep(0.35, 0.75, vnoise(x * 4, y * 4, 166)) + 0.2 * sstep(0, -0.6, y));
    col(px, depth, fat * (1 - blood), blood, open * EDGE(x, y));
  }
  // ---- the stain cells (RGB = a display multiplier's detail, A = cover; the
  //      RGB runs on smoothly past the shape so filtering never fringes it)
  // 0 BRUISE: blotchy, soft-edged, broken by the blood under the skin
  function sBruise(x, y, px) {
    const r = Math.hypot(x, y), th = Math.atan2(y, x);
    const n = fbm(x * 3.2, y * 3.2, 101), n2 = fbm(x * 7, y * 7, 102);
    const R = 0.66 * (1 + 0.22 * (angN(th, 103) - 0.5));
    const a = (1 - sstep(0.2, R, r + 0.22 * (n - 0.5))) * (0.62 + 0.38 * n2);
    const v = 0.88 + 0.12 * n2;
    col(px, v, v, v, a * EDGE(x, y));
  }
  // 1 SOAK, CLOTH: blood wicking into a weave. It travels fastest along the
  // threads (a squarish front, ragged at thread scale), further down than up,
  // and leaves its darker tide line at the front.
  function sSoakCloth(x, y, px) {
    const yy = y + 0.1, ys = yy / (yy > 0 ? 0.66 : 0.9);
    const d = 0.62 * Math.hypot(x, ys) + 0.38 * Math.max(Math.abs(x), Math.abs(ys));
    const th = Math.atan2(ys, x);
    const e = 0.6 * (1 + 0.12 * Math.sin(th * 3 + 0.2) + 0.07 * Math.sin(th * 7 + 1.1)) + 0.1 * (angN(th, 111) - 0.5)
      + 0.035 * (vnoise(x * 42, y * 2.5, 112) - 0.5) + 0.035 * (vnoise(x * 2.5, y * 42, 113) - 0.5);
    const a = (1 - sstep(e - 0.09, e, d)) * (0.62 + 0.38 * (1 - sstep(0, e, d)) + 0.1 * (fbm(x * 5, y * 5, 114) - 0.5));
    const tide = 1 - sstep(0.0, 0.06, Math.abs(d - (e - 0.05)));
    const v = Math.min(1, 0.88 + 0.08 * fbm(x * 6, y * 6, 115) - 0.25 * tide);
    col(px, v, v, v, a * EDGE(x, y));
  }
  // 2 SOAK, FUR: blood mats the coat into dark wet locks along its lie (down
  // the body); never paints it red
  function sSoakFur(x, y, px) {
    const yy = y + 0.12, ys = yy / (yy > 0 ? 0.62 : 0.92);
    const r = Math.hypot(x, ys), th = Math.atan2(ys, x);
    const e = 0.62 * (1 + 0.14 * (angN(th, 121) - 0.5));
    // locks: clumps a little longer than wide, wandering, not a comb
    const wx = x + 0.12 * (fbm(x * 2, y * 2, 124) - 0.5);
    const lock = fbm(wx * 7, y * 3, 122);
    const blob = 1 - sstep(e - 0.22, e + 0.12 * (lock - 0.5), r);
    const v = 0.66 + 0.26 * fbm(x * 6, y * 3, 123);
    col(px, v, v, v, blob * (0.6 + 0.4 * sstep(0.3, 0.7, lock)) * EDGE(x, y));
  }
  // 3 HOLE, CLOTH: a tooth's hole torn in a weave: it tears along the threads
  // (squarish, its edge notched at thread scale), the fabric round it wet
  // and darker toward the hole
  function sHoleCloth(x, y, px) {
    const th = Math.atan2(y, x);
    const dm = 0.55 * Math.hypot(x, y) + 0.45 * Math.max(Math.abs(x), Math.abs(y));
    const R0 = 0.34 * (1 + 0.3 * (angN(th * 1.3, 131) - 0.5)) + 0.025 * (vnoise(x * 26, y * 26, 132) - 0.5);
    const hole = 1 - sstep(R0 - 0.02, R0 + 0.01, dm);
    const wet = (1 - sstep(R0, R0 + 0.3, dm)) * (1 - hole);
    const v = (0.55 + 0.3 * sstep(R0, R0 + 0.3, dm)) * (1 - hole) + (0.08 + 0.08 * vnoise(x * 8, y * 8, 135)) * hole;
    col(px, v, v, v, Math.max(hole, wet * 0.6) * EDGE(x, y));
  }
  // 4 HOLE, FUR: the coat parted round a tooth's hole: the hole dark, the
  // hair round it wet and clumped, drawn out down the lie of the coat
  function sHoleFur(x, y, px) {
    const yy = y + 0.06, ys = yy / (yy > 0 ? 0.8 : 1.0);
    const r = Math.hypot(x, ys), th = Math.atan2(ys, x);
    const R0 = 0.28 * (1 + 0.3 * (angN(th, 141) - 0.5));
    const hole = 1 - sstep(R0 - 0.03, R0 + 0.01, r);
    const clump = sstep(0.3, 0.7, fbm(x * 6, y * 4, 142));
    const mat = (1 - sstep(R0, R0 + 0.26 + 0.1 * clump, r)) * (1 - hole);
    const v = 0.1 * hole + (1 - hole) * (0.5 + 0.25 * clump);
    col(px, v, v, v, Math.max(hole, mat * (0.45 + 0.4 * clump)) * EDGE(x, y));
  }
  // 5 RIP: a tear along x in a weave: the dark gap, edges notched at thread
  // scale, a narrow frayed and wet band either side
  function sRip(x, y, px) {
    const ax = Math.abs(x);
    const taper = Math.pow(Math.max(0, 1 - Math.pow(ax / 0.84, 2)), 0.5);
    const yc = 0.03 * Math.sin(x * 5) + 0.02 * (vnoise(x * 9, 2, 151) - 0.5);
    const ay = Math.abs(y - yc), up = y > yc;
    const hw = 0.09 * taper * (0.7 + 0.6 * vnoise(x * 5, 3, 152));
    const notch = 0.025 * (vnoise(x * 34, up ? 4 : 5, 153) - 0.5);
    const gap = (1 - sstep(hw - 0.01, hw + 0.01, ay + notch)) * (taper > 0 ? 1 : 0);
    const fray = (1 - sstep(hw, hw + 0.05 + 0.03 * vnoise(x * 20, up ? 6 : 7, 154), ay)) * (1 - gap) * taper;
    const wet = (1 - sstep(hw, hw + 0.16, ay)) * (1 - gap) * taper;
    const v = (0.5 + 0.3 * (1 - fray)) * (1 - gap) + 0.1 * gap;
    col(px, v, v, v, Math.max(gap, fray * 0.75, wet * 0.35) * EDGE(x, y));
  }
  // 6 RIM: the skin round a wound, inflamed and bruised: darker and redder
  // than itself (the tint makes it so), strongest at the wound
  function sRim(x, y, px) {
    const r = Math.hypot(x, y), th = Math.atan2(y, x);
    const R = 0.66 * (1 + 0.2 * (angN(th, 161) - 0.5));
    const n = vnoise(x * 7, y * 7, 162);
    const a = (1 - sstep(0.1, R, r + 0.15 * (n - 0.5))) * (0.6 + 0.4 * n);
    const v = 0.9 + 0.1 * vnoise(x * 13, y * 13, 163);
    col(px, v, v, v, a * EDGE(x, y));
  }
  // 7 ABRASION: where a small tooth pressed or scraped and did not go in:
  // a patch scratched along the drag
  function sAbrasion(x, y, px) {
    const ex = x / 0.68, ey = y / 0.34, q = Math.hypot(ex, ey) + 0.3 * (vnoise(x * 4, y * 4, 171) - 0.5);
    const patch = 1 - sstep(0.55, 1.0, q);
    const stri = sstep(0.3, 0.7, vnoise(x * 2.5, y * 20, 172));
    const dots = sstep(0.74, 0.86, vnoise(x * 16, y * 16, 174));
    const v = 0.74 + 0.2 * fbm(x * 8, y * 8, 173) - 0.55 * dots;
    col(px, v, v, v, patch * Math.max(0.45 + 0.55 * stri, dots) * EDGE(x, y));
  }
  // 8 BLOOD ON SKIN: a film of blood is a dye, not a paint: it darkens and
  // reddens the skin under it, thicker toward the wound, lying lower than
  // it, a few fingers running on downhill
  function sBloodSkin(x, y, px) {
    const yy = y - 0.12, ys = yy / (yy > 0 ? 0.6 : 0.92);
    const r = Math.hypot(x, ys), th = Math.atan2(ys, x);
    const e = 0.56 * (1 + 0.13 * Math.sin(th * 3 + 0.9) + 0.07 * Math.sin(th * 6 + 2.0)) + 0.08 * (angN(th, 181) - 0.5);
    let a = (1 - sstep(e - 0.16, e, r)) * (0.7 + 0.3 * (1 - r / Math.max(0.05, e)));
    // the fingers: where the film's lower edge let go
    const k = Math.floor((x + 1) * 5), xc = -1 + (k + 0.5) / 5 + 0.06 * (h2(k, 3, 182) - 0.5);
    if (h2(k, 7, 183) > 0.5 && ys < 0 && Math.abs(xc) < 0.35) {
      const L = 0.2 + 0.2 * h2(k, 5, 184), y0 = -e * 0.5, dy = (y0 - ys) / L;
      if (dy > 0 && dy < 1) {
        const w = 0.035 * (1 - dy * 0.6);
        a = Math.max(a, (1 - sstep(w * 0.6, w, Math.abs(x - xc))) * (1 - sstep(0.75, 1, dy)) * 0.85);
      }
    }
    const v = 0.9 + 0.1 * fbm(x * 6, y * 6, 185);
    col(px, v, v, v, Math.min(1, a) * EDGE(x, y));
  }
  // 9 SMEAR: blood beaded and smeared round a tooth's hole, patchy
  function sSmear(x, y, px) {
    const r = Math.hypot(x, y), th = Math.atan2(y, x);
    const R = 0.6 * (1 + 0.25 * (angN(th, 191) - 0.5));
    const patch = sstep(0.38, 0.62, fbm(x * 5, y * 5, 192));
    const a = (1 - sstep(R * 0.55, R, r)) * patch;
    const v = 0.85 + 0.15 * fbm(x * 9, y * 9, 193);
    col(px, v, v, v, a * EDGE(x, y));
  }
  // cell rectangles in uv (u0, v0, du, dv)
  function cellRect(i, cols, rows) { return [(i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows]; }
  const TCELL = {
    puncture: cellRect(0, 4, 3), puncture2: cellRect(1, 4, 3), serrated: cellRect(2, 4, 3), slit: cellRect(3, 4, 3),
    tear: cellRect(4, 4, 3), rake: cellRect(5, 4, 3), crater: cellRect(6, 4, 3), gape: cellRect(7, 4, 3),
    blood: cellRect(8, 4, 3), ragged: cellRect(11, 4, 3),
  };
  (function () {
    const c = cellRect(9, 4, 3);
    TCELL.strip = [c[0], c[1] + c[3] * 0.53, c[2], c[3] * 0.44];
    TCELL.flap = [c[0], c[1] + c[3] * 0.03, c[2], c[3] * 0.44];
  })();
  const SCELL = {
    bruise: cellRect(0, 4, 3), soakCloth: cellRect(1, 4, 3), soakFur: cellRect(2, 4, 3), holeCloth: cellRect(3, 4, 3),
    holeFur: cellRect(4, 4, 3), rip: cellRect(5, 4, 3), rim: cellRect(6, 4, 3), abrasion: cellRect(7, 4, 3),
    bloodSkin: cellRect(8, 4, 3), smear: cellRect(9, 4, 3),
  };
  let SKIN_JOBS = null;
  function skinJobs() {
    if (!SKIN_JOBS) SKIN_JOBS = {
      tissue: texJob([cPuncture, cPuncture2, cSerrated, cSlit, cTear, cRake, cCrater, cGape, cBlood, cStripFlap, null, cRagged], 4, 3, 128),
      stain: texJob([sBruise, sSoakCloth, sSoakFur, sHoleCloth, sHoleFur, sRip, sRim, sAbrasion, sBloodSkin, sSmear, null, null], 4, 3, 128),
    };
    return SKIN_JOBS;
  }

  /* ---- THE VICTIM'S OWN TISSUE ---------------------------------------------
     LINEAR albedos, each solved through the game's own output transform
     (core/renderer.js: exposure / 0.6, ACES, the grade, sRGB) to show as a
     chosen colour on a face lit at 1.0: ACES pushes any red with little
     green toward a pure, bright red, so a "dark red" hex reads as a sticker
     on screen. What each shows:
       mammal   cut skin wall 0.46/0.13/0.11 (darker and redder than any
                skin), fat 0.76/0.66/0.48 (only in patches in the wall),
                muscle 0.36/0.07/0.05 (deep red-brown), the bottom near
                black, blood 0.38/0.03/0.03 (dark, wet)
       cetacean grey skin cut 0.30/0.27/0.28, a thick blubber band
                0.72/0.58/0.52, muscle near black-red 0.22/0.04/0.04
       shark    pale pink flesh all the way down (0.78/0.60/0.56 .. 0.72/0.50/0.47)
       fish     white flesh;  redfish  tuna and marlin, dark red meat 0.40/0.07/0.08
     L = [fat starts, muscle starts, the dark blood-filled bottom starts], in
     the tissue atlas's depth units; solid = 1 when the fat is a continuous
     band (blubber), 0 when it only shows in patches in a cut's wall. */
  const TISSUE = {
    mammal: { dermis: [0.1609, 0.0364, 0.0233], fat: [0.3975, 0.2939, 0.1653], muscle: [0.1189, 0.0204, 0.0], deep: [0.0229, 0.0, 0.0], blood: [0.1295, 0.0145, 0.0], scar: [0.4604, 0.314, 0.2791], L: [0.10, 0.17, 0.80], solid: 0 },
    cetacean: { dermis: [0.0859, 0.0751, 0.0765], fat: [0.3447, 0.2273, 0.1893], muscle: [0.067, 0.008, 0.0], deep: [0.0167, 0.0, 0.0], blood: [0.1047, 0.0111, 0.0], scar: [0.4411, 0.451, 0.4608], L: [0.05, 0.52, 0.86], solid: 1 },
    shark: { dermis: [0.2034, 0.1498, 0.1447], fat: [0.4179, 0.2416, 0.2153], muscle: [0.3384, 0.176, 0.1606], deep: [0.0933, 0.0203, 0.009], blood: [0.1122, 0.014, 0.0], scar: [0.4771, 0.4887, 0.4804], L: [0.05, 0.30, 0.86], solid: 1 },
    fish: { dermis: [0.2385, 0.2005, 0.2016], fat: [0.5455, 0.3869, 0.3419], muscle: [0.4565, 0.2935, 0.2614], deep: [0.1066, 0.0309, 0.0236], blood: [0.1122, 0.014, 0.0], scar: [0.5181, 0.5319, 0.5461], L: [0.05, 0.25, 0.86], solid: 1 },
    redfish: { dermis: [0.1255, 0.0934, 0.0996], fat: [0.2357, 0.1355, 0.126], muscle: [0.1358, 0.022, 0.0121], deep: [0.0356, 0.0, 0.0], blood: [0.0969, 0.01, 0.0], scar: [0.4763, 0.4511, 0.461], L: [0.04, 0.12, 0.85], solid: 1 },
  };
  function lin3(a) { return new THREE.Color(a[0], a[1], a[2]); }
  function linArr(r, g, b) { return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)]; }
  let TEX_T = null, TEX_S = null;
  function tissueTex() { return TEX_T || (TEX_T = makeTex(skinJobs().tissue, false)); }
  function stainTex() { return TEX_S || (TEX_S = makeTex(skinJobs().stain, true)); }
  const WMATS = Object.create(null);
  /* THE TISSUE SHADER. A Phong (wet tissue and blood catch the light; a
     wound in a dim sea is as dim as the body) whose diffuse is chosen per
     pixel from the atlas depth through the victim's layers: the cut skin
     wall, the fat (a mammal's thin layer where the atlas lets it show just
     inside a cut's edge, a whale's blubber as the band of depth it is), the
     muscle, the black bottom, blood where the atlas says wet, a healed scar
     as a rake ages, and a flap's own colour (cloth or hide outside, its raw
     or lined underside behind). Per vertex: colour.r how deep this mark
     goes (it caps the atlas depth: a shallow hole has the same sharp wall
     and no black bottom), .g how healed, .b 1 = a hide flap / 0.5 = a cloth
     flap, .a its fade; wCol the flap's outside colour. Blood and the open wound are glossy, the rest is
     not. */
  function woundMat(kind) {
    const T = TISSUE[kind] || TISSUE.mammal;
    if (WMATS[kind]) return WMATS[kind];
    const U = {
      uTDermis: { value: lin3(T.dermis) }, uTFat: { value: lin3(T.fat) },
      uTMuscle: { value: lin3(T.muscle) }, uTDeep: { value: lin3(T.deep) }, uTBlood: { value: lin3(T.blood) },
      uTScar: { value: lin3(T.scar) }, uTL: { value: new THREE.Vector3(T.L[0], T.L[1], T.L[2]) }, uTSolid: { value: T.solid },
    };
    const m = new THREE.MeshPhongMaterial({
      map: tissueTex(), color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, shininess: 90, specular: new THREE.Color(0.07, 0.068, 0.066),
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    m.onBeforeCompile = function (sh) {
      for (const k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 wCol;\nvarying vec3 vWCol;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWCol = wCol;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWCol;\nuniform vec3 uTDermis;\nuniform vec3 uTFat;\nuniform vec3 uTMuscle;\nuniform vec3 uTDeep;\nuniform vec3 uTBlood;\nuniform vec3 uTScar;\nuniform vec3 uTL;\nuniform float uTSolid;\nfloat wWet = 0.0;")
        .replace("#include <map_fragment>", [
          "vec4 wT = texture2D( map, vMapUv );",
          "float wD = clamp( min( wT.r, vColor.r ), 0.0, 1.0 );",
          "vec3 wC = mix( uTDermis, uTMuscle, smoothstep( uTL.y, uTL.y + 0.12, wD ) );",
          "wC = mix( wC, uTDeep, smoothstep( uTL.z, 1.0, wD ) );",
          "float wFat = mix( wT.g * 0.9, smoothstep( uTL.x, uTL.x + 0.03, wD ) * ( 1.0 - smoothstep( uTL.y - 0.015, uTL.y + 0.03, wD ) ), uTSolid );",
          "wC = mix( wC, uTFat, wFat );",
          "wC = mix( wC, uTBlood, wT.b );",
          "wC = mix( wC, uTScar, vColor.g );",
          "vec3 wBack = mix( vWCol * 0.45, uTDermis * 0.75, step( 0.75, vColor.b ) );",
          "wC = mix( wC, gl_FrontFacing ? vWCol : wBack, step( 0.25, vColor.b ) );",
          "wWet = max( wT.b, smoothstep( 0.2, 0.6, wD ) ) * ( 1.0 - vColor.g ) * ( 1.0 - step( 0.25, vColor.b ) );",
          "diffuseColor.rgb = wC;",
          "diffuseColor.a *= wT.a;",
        ].join("\n"))
        .replace("#include <color_fragment>", "diffuseColor.a *= vColor.a;")
        .replace("#include <specularmap_fragment>", "float specularStrength = 0.05 + 0.95 * wWet;");
    };
    m.customProgramCacheKey = function () { return "cbzWound3"; };
    m._shared = true;
    m.name = "wound-" + kind;
    WMATS[kind] = m;
    return m;
  }
  /* THE STAIN LAYER: MULTIPLY. What a stain does to light is absorb it: a
     film of blood, a bruise, blood in a weave are dyes, so the multiplier
     is the colour raised to its cover (Beer-Lambert: half as thick lets the
     square root through), and the blend writes
       out.rgb = dst.rgb * pow( map.rgb * tint, cover )   <= dst.rgb
     where cover 0 is exactly 1: nothing it covers is ever lightened, and a
     thin film is already red, not a pink-grey veil. The alpha factors keep the
     canvas's own alpha: the WebGL context has one (three always asks for
     it), and multiplying it by the stain's alpha let the page show through
     every quad as a pale rectangle. */
  let SMAT = null;
  function stainMat() {
    if (SMAT) return SMAT;
    const m = new THREE.MeshBasicMaterial({
      map: stainTex(), color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      fog: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    m.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>",
        "#include <opaque_fragment>\ngl_FragColor.rgb = pow( clamp( gl_FragColor.rgb, vec3( 0.001 ), vec3( 1.0 ) ), vec3( clamp( gl_FragColor.a, 0.0, 1.0 ) ) );");
    };
    m.customProgramCacheKey = function () { return "cbzStain3"; };
    m._shared = true;
    m.name = "wound-stain";
    SMAT = m;
    return m;
  }
  // under water the body is seen through its veil (world/water_spec.js): the
  // tissue layer goes through the same one or it sits unattenuated inside a
  // body that fades into the sea
  function markMat(layer, kind) {
    if (layer === "s") return stainMat();
    const base = woundMat(kind);
    if (typeof CBZ.waterVeilMaterial !== "function") return base;
    try { return CBZ.waterVeilMaterial(base) || base; } catch (e) { return base; }
  }
  // the warm-up: a few rows a frame after the first seconds of play, then the
  // GL programs queued (core/fxwarm.js) with the attributes a real mark has
  let skinWarmT = 0, skinWarmed = false;
  function skinWarm(dt) {
    skinWarmT += dt;
    if (skinWarmT < 2.5) return;
    const J = skinJobs();
    const a = texJobStep(J.tissue, 6), b = texJobStep(J.stain, 6);
    if (!a || !b) return;
    skinWarmed = true;
    if (typeof CBZ.shaderQueue === "function") {
      try {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
        g.setAttribute("color", new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 4));
        g.setAttribute("wCol", new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
        const gq = new THREE.Group();
        gq.add(new THREE.Mesh(g, woundMat("mammal")), new THREE.Mesh(g, markMat("w", "mammal")), new THREE.Mesh(g, stainMat()));
        // and the skinned variants a mark on a one-mesh animal draws with
        const gs = g.clone();
        gs.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
        gs.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
        const mats = [woundMat("mammal"), markMat("w", "mammal"), stainMat()];
        for (let i = 0; i < mats.length; i++) {
          const bone = new THREE.Bone(), sm = new THREE.SkinnedMesh(gs, mats[i]);
          sm.add(bone); sm.bind(new THREE.Skeleton([bone]));
          gq.add(sm);
        }
        CBZ.shaderQueue(gq, {});
      } catch (e) {}
    }
  }

  // ---- matrices that are TRUE at seat time -------------------------------
  // A rig can be mid-frame (moved, not yet composed) or LOD-frozen
  // (matrixAutoUpdate false). Recompose every node from its TRS, then the
  // world chain, before anything is measured against it.
  function freshMats(root, frozen) {
    if (!root) return;
    if (frozen) root.traverse(function (o) { o.updateMatrix(); });
    root.updateWorldMatrix(true, true);
  }

  // ---- WHERE THE SKIN IS: a ray against the part's own triangles ---------
  // Local space, no Raycaster: r128's Raycaster tests LAYERS, and
  // entities/pedinstance.js parks pooled body parts on a private layer, so a
  // Raycaster would miss exactly the pedestrians the shark is eating.
  const _ra = new THREE.Vector3(), _rb = new THREE.Vector3(), _rc = new THREE.Vector3();
  const _re1 = new THREE.Vector3(), _re2 = new THREE.Vector3(), _rp = new THREE.Vector3(), _rq = new THREE.Vector3(), _rs = new THREE.Vector3();
  const SEAT = { t: 0, p: new THREE.Vector3(), n: new THREE.Vector3(), tri: -1 };
  function localRay(geo, o, d, far) {
    const pa = geo.attributes.position, na = geo.attributes.normal;
    if (!pa) return null;
    const idx = geo.index ? geo.index.array : null;
    const nt = idx ? (idx.length / 3) | 0 : (pa.count / 3) | 0;
    let best = far, bi = -1, bu = 0, bv = 0;
    for (let t = 0; t < nt; t++) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      _ra.fromBufferAttribute(pa, i0); _rb.fromBufferAttribute(pa, i1); _rc.fromBufferAttribute(pa, i2);
      _re1.subVectors(_rb, _ra); _re2.subVectors(_rc, _ra);
      _rp.crossVectors(d, _re2);
      const det = _re1.dot(_rp);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      _rs.subVectors(o, _ra);
      const u = _rs.dot(_rp) * inv; if (u < 0 || u > 1) continue;
      _rq.crossVectors(_rs, _re1);
      const v = d.dot(_rq) * inv; if (v < 0 || u + v > 1) continue;
      const tt = _re2.dot(_rq) * inv;
      if (tt <= 1e-6 || tt >= best) continue;
      best = tt; bi = t; bu = u; bv = v;
    }
    if (bi < 0) return null;
    const i0 = idx ? idx[bi * 3] : bi * 3, i1 = idx ? idx[bi * 3 + 1] : bi * 3 + 1, i2 = idx ? idx[bi * 3 + 2] : bi * 3 + 2;
    SEAT.t = best; SEAT.tri = bi;
    SEAT.p.copy(d).multiplyScalar(best).add(o);
    if (na) {
      _ra.fromBufferAttribute(na, i0).multiplyScalar(1 - bu - bv);
      _rb.fromBufferAttribute(na, i1).multiplyScalar(bu);
      _rc.fromBufferAttribute(na, i2).multiplyScalar(bv);
      SEAT.n.copy(_ra).add(_rb).add(_rc);
    } else {
      _ra.fromBufferAttribute(pa, i0); _rb.fromBufferAttribute(pa, i1); _rc.fromBufferAttribute(pa, i2);
      SEAT.n.crossVectors(_re1.subVectors(_rb, _ra), _re2.subVectors(_rc, _ra));
    }
    if (SEAT.n.lengthSq() < 1e-12) SEAT.n.copy(d).negate();
    SEAT.n.normalize();
    // a normal pointing along the ray is a wound-backwards triangle; the ray wins
    if (SEAT.n.dot(d) > 0) SEAT.n.negate();
    return SEAT;
  }
  // The nearest point of a geometry's surface to a LOCAL point, with that
  // triangle's outward normal. Fills SEAT like localRay.
  const _nT = new THREE.Triangle(), _nO = new THREE.Vector3();
  function localNearest(geo, q) {
    const pa = geo.attributes.position;
    if (!pa) return null;
    const idx = geo.index ? geo.index.array : null;
    const nt = idx ? (idx.length / 3) | 0 : (pa.count / 3) | 0;
    let best = Infinity, bi = -1;
    for (let t = 0; t < nt; t++) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      _ra.fromBufferAttribute(pa, i0); _rb.fromBufferAttribute(pa, i1); _rc.fromBufferAttribute(pa, i2);
      _nT.set(_ra, _rb, _rc); _nT.closestPointToPoint(q, _nO);
      const d = _nO.distanceToSquared(q);
      if (d < best) { best = d; bi = t; SEAT.p.copy(_nO); }
    }
    if (bi < 0) return null;
    const i0 = idx ? idx[bi * 3] : bi * 3, i1 = idx ? idx[bi * 3 + 1] : bi * 3 + 1, i2 = idx ? idx[bi * 3 + 2] : bi * 3 + 2;
    _ra.fromBufferAttribute(pa, i0); _rb.fromBufferAttribute(pa, i1); _rc.fromBufferAttribute(pa, i2);
    _nT.set(_ra, _rb, _rc); _nT.getNormal(SEAT.n);
    // outward = away from the part's middle
    if (!geo.boundingBox) geo.computeBoundingBox();
    geo.boundingBox.getCenter(_rs);
    if (_rq.subVectors(SEAT.p, _rs).dot(SEAT.n) < 0) SEAT.n.negate();
    SEAT.t = Math.sqrt(best); SEAT.tri = bi;
    return SEAT;
  }
  const _so = new THREE.Vector3(), _sd = new THREE.Vector3(), _sc = new THREE.Vector3();
  // Put an already-seated flat decal ON the skin: cast back down its own
  // normal from just outside and move it to the triangle it meets, facing
  // that triangle's (interpolated) normal. Its in-plane spin is kept. A decal
  // with nothing under it within reach is left where it was.
  const _hq = new THREE.Quaternion(), _hn = new THREE.Vector3();
  function hugDecal(m, part, proud) {
    const g = part && part.geometry;
    if (!g || !g.attributes || !g.attributes.position) return;
    if (!g.boundingBox) g.computeBoundingBox();
    const span = g.boundingBox.max.distanceTo(g.boundingBox.min) || 1;
    _hn.set(0, 0, 1).applyQuaternion(m.quaternion);
    _so.copy(m.position).addScaledVector(_hn, span * 0.5);
    _sd.copy(_hn).negate();
    let hit = localRay(g, _so, _sd, span);
    // a hit far behind the decal is the far side of a thin part, not its skin
    if (hit && Math.abs(hit.t - span * 0.5) > span * 0.35) hit = null;
    // nothing under it (the box runs past the end of a rounded limb): the
    // NEAREST point of the real surface instead — never the air beside it
    if (!hit) hit = localNearest(g, m.position);
    if (!hit) return;
    _hq.setFromUnitVectors(_hn, hit.n);
    m.quaternion.premultiply(_hq);
    m.position.copy(hit.p).addScaledVector(hit.n, proud);
  }

  /* ---- SURFACES: a body part as the triangles the teeth actually meet ------
     A rigid part (a person's lofted limb, a bestiary part) is posed by its
     matrixWorld. A skinned body is posed by its skeleton: every vertex is
     blended through its four bones exactly as the GPU will draw it this
     frame (the same sum as SkinnedMesh.applyBoneTransform, once per vertex
     with the bone matrices composed once per bone). Everything a bite
     measures (where the skin is, which way it faces, where a tooth's path
     meets it) is measured on these POSED positions; everything it builds is
     written back in the part's own space (local, or the body's bind space
     with the source vertices' bone weights), so it rides the pose after. */
  const SCRF = [], SCRU = [];
  function scrF(slot, n) { let a = SCRF[slot]; if (!a || a.length < n) a = SCRF[slot] = new Float32Array(Math.max(n, 256)); return a; }
  function scrU(slot, n) { let a = SCRU[slot]; if (!a || a.length < n) a = SCRU[slot] = new Uint32Array(Math.max(n, 256)); return a; }
  function surfaceOf(mesh, slot) {
    const g = mesh && mesh.geometry, pa = g && g.attributes && g.attributes.position;
    if (!pa || pa.itemSize !== 3 || pa.isInterleavedBufferAttribute) return null;
    const na = g.attributes.normal;
    if (!na || na.itemSize !== 3 || na.isInterleavedBufferAttribute) return null;
    const skinned = !!(mesh.isSkinnedMesh && mesh.skeleton && g.attributes.skinIndex && g.attributes.skinWeight);
    return {
      mesh: mesh, slot: slot, geo: g, skinned: skinned, nv: pa.count, P: pa.array, N: na.array,
      idx: g.index ? g.index.array : null, nt: g.index ? (g.index.count / 3) | 0 : (pa.count / 3) | 0,
      W: null, WN: null, M: null, cidx: null, nc: 0, proxy: null, wsc: 1, cloth: false, region: "torso",
    };
  }
  // re-read the geometry (a body that now owns a wounded copy) and re-pose
  function surfaceRefresh(S, geo) {
    const g = geo || S.mesh.geometry;
    S.geo = g; S.P = g.attributes.position.array; S.N = g.attributes.normal.array;
    S.idx = g.index ? g.index.array : null; S.nv = g.attributes.position.count;
    S.nt = g.index ? (g.index.count / 3) | 0 : (S.nv / 3) | 0;
  }
  const _pm = new THREE.Matrix4(), _pm2 = new THREE.Matrix4(), _pm3 = new THREE.Matrix4();
  const _nm3 = new THREE.Matrix3();
  // per bone: bind-space point -> world, composed once (both bind modes)
  function boneMats(mesh, out) {
    const sk = mesh.skeleton, B = sk.bones, I = sk.boneInverses, nb = B.length;
    if (!out || out.length < nb * 16) out = new Float32Array(nb * 16);
    const attached = mesh.bindMode !== "detached";
    if (!attached) _pm.copy(mesh.matrixWorld).multiply(_pm3.copy(mesh.bindMatrix).invert());
    for (let b = 0; b < nb; b++) {
      _pm2.multiplyMatrices(B[b].matrixWorld, I[b]).multiply(mesh.bindMatrix);
      if (!attached) _pm2.premultiply(_pm);
      const e = _pm2.elements;
      for (let k = 0; k < 16; k++) out[b * 16 + k] = e[k];
    }
    return out;
  }
  // every vertex of a skinned geometry posed by bone matrices M into W (+ WN)
  function poseSkinned(P, N, SI, SW, M, nv, W, WN, from) {
    for (let i = from || 0; i < nv; i++) {
      const i3 = i * 3, i4 = i * 4;
      const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
      let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0;
      const qx = N ? N[i3] : 0, qy = N ? N[i3 + 1] : 0, qz = N ? N[i3 + 2] : 0;
      for (let k = 0; k < 4; k++) {
        const w = SW[i4 + k];
        if (!w) continue;
        const o = SI[i4 + k] * 16;
        x += w * (M[o] * px + M[o + 4] * py + M[o + 8] * pz + M[o + 12]);
        y += w * (M[o + 1] * px + M[o + 5] * py + M[o + 9] * pz + M[o + 13]);
        z += w * (M[o + 2] * px + M[o + 6] * py + M[o + 10] * pz + M[o + 14]);
        if (WN) {
          nx += w * (M[o] * qx + M[o + 4] * qy + M[o + 8] * qz);
          ny += w * (M[o + 1] * qx + M[o + 5] * qy + M[o + 9] * qz);
          nz += w * (M[o + 2] * qx + M[o + 6] * qy + M[o + 10] * qz);
        }
      }
      W[i3] = x; W[i3 + 1] = y; W[i3 + 2] = z;
      if (WN) { const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; WN[i3] = nx / l; WN[i3 + 1] = ny / l; WN[i3 + 2] = nz / l; }
    }
  }
  // (the posed arrays are the surface's own, not scratch: a bite's work is
  // spread over frames and other bites may pose in between; the matrices are
  // the ones of the bite's instant, kept with it)
  function surfacePose(S, M) {
    const nv = S.nv, P = S.P, N = S.N;
    const W = S.W = new Float32Array(nv * 3), WN = S.WN = new Float32Array(nv * 3);
    const mw = S.MW || (S.MW = S.mesh.matrixWorld.clone());
    S.wsc = Math.cbrt(Math.abs(mw.determinant())) || 1;
    if (S.skinned) {
      if (!M) S.M = boneMats(S.mesh, S.M);
      const g = S.geo;
      poseSkinned(P, N, g.attributes.skinIndex.array, g.attributes.skinWeight.array, S.M, nv, W, WN);
      return;
    }
    const e = mw.elements;
    _nm3.getNormalMatrix(mw);
    const n = _nm3.elements;
    for (let i = 0; i < nv; i++) {
      const i3 = i * 3, x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
      W[i3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      W[i3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      W[i3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = N[i3], b = N[i3 + 1], c = N[i3 + 2];
      let nx = n[0] * a + n[3] * b + n[6] * c, ny = n[1] * a + n[4] * b + n[7] * c, nz = n[2] * a + n[5] * b + n[8] * c;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      WN[i3] = nx / l; WN[i3 + 1] = ny / l; WN[i3 + 2] = nz / l;
    }
  }
  // the triangles within R of a point (posed), and the projector's view of them
  // the triangles within R of a point (posed), each with its bounding sphere
  // (what lets a search or a mark skip everything not near it), and the
  // projector's view of them
  function surfaceNear(S, cx, cy, cz, R) {
    const W = S.W, idx = S.idx, nt = S.nt, nv = S.nv;
    // a triangle is near when a corner is: widen the reach by the longest
    // edge this body has, so a big hull triangle is not missed
    const flag = scrB(S.slot, nv);
    let emax = 0;
    for (let t = 0; t < nt; t += Math.max(1, (nt / 96) | 0)) {
      const a = (idx ? idx[t * 3] : t * 3) * 3, b = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3;
      const e = Math.abs(W[a] - W[b]) + Math.abs(W[a + 1] - W[b + 1]) + Math.abs(W[a + 2] - W[b + 2]);
      if (e > emax) emax = e;
    }
    const RR = R + emax * 2, R2 = RR * RR;
    for (let i = 0; i < nv; i++) {
      const dx = W[i * 3] - cx, dy = W[i * 3 + 1] - cy, dz = W[i * 3 + 2] - cz;
      flag[i] = dx * dx + dy * dy + dz * dz <= R2 ? 1 : 0;
    }
    const ci = scrU(S.slot, nt * 3), cs = scrF(16 + S.slot, nt * 4), ct = scrU(32 + S.slot, nt);
    let n = 0, rmax = 0, rsum = 0;
    for (let t = 0; t < nt; t++) {
      const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
      if (a === b || b === c || a === c) continue;                 // a removed (collapsed) triangle
      if (!(flag[a] | flag[b] | flag[c])) continue;
      const a3 = a * 3, b3 = b * 3, c3 = c * 3;
      const mx = (W[a3] + W[b3] + W[c3]) / 3, my = (W[a3 + 1] + W[b3 + 1] + W[c3 + 1]) / 3, mz = (W[a3 + 2] + W[b3 + 2] + W[c3 + 2]) / 3;
      let r2 = (W[a3] - mx) * (W[a3] - mx) + (W[a3 + 1] - my) * (W[a3 + 1] - my) + (W[a3 + 2] - mz) * (W[a3 + 2] - mz);
      let q = (W[b3] - mx) * (W[b3] - mx) + (W[b3 + 1] - my) * (W[b3 + 1] - my) + (W[b3 + 2] - mz) * (W[b3 + 2] - mz); if (q > r2) r2 = q;
      q = (W[c3] - mx) * (W[c3] - mx) + (W[c3 + 1] - my) * (W[c3 + 1] - my) + (W[c3 + 2] - mz) * (W[c3 + 2] - mz); if (q > r2) r2 = q;
      const rr = Math.sqrt(r2);
      ci[n * 3] = a; ci[n * 3 + 1] = b; ci[n * 3 + 2] = c;
      cs[n * 4] = mx; cs[n * 4 + 1] = my; cs[n * 4 + 2] = mz; cs[n * 4 + 3] = rr;
      ct[n] = t;
      rsum += rr; if (rr > rmax) rmax = rr;
      n++;
    }
    S.cidx = ci.slice(0, n * 3); S.csph = cs.slice(0, n * 4); S.ctri = ct.slice(0, n); S.nc = n; S.grid = null; S.rmax = rmax; S.rsum = rsum;
    S.proxy = {
      attributes: { position: { array: W, itemSize: 3, count: S.nv }, normal: { array: S.WN, itemSize: 3, count: S.nv } },
      index: { array: S.cidx },
    };
    return n;
  }
  const SCRBY = [];
  function scrB(slot, n) { let a = SCRBY[slot]; if (!a || a.length < n) a = SCRBY[slot] = new Uint8Array(Math.max(n, 256)); return a; }
  // a projector's view of only the triangles within r of a point
  function proxyNear(S, x, y, z, r) {
    const ci = S.cidx, cs = S.csph, nc = S.nc;
    const out = scrU(24, nc * 3);
    let n = 0;
    for (let k = 0; k < nc; k++) {
      const dx = cs[k * 4] - x, dy = cs[k * 4 + 1] - y, dz = cs[k * 4 + 2] - z, rr = r + cs[k * 4 + 3];
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      out[n * 3] = ci[k * 3]; out[n * 3 + 1] = ci[k * 3 + 1]; out[n * 3 + 2] = ci[k * 3 + 2]; n++;
    }
    if (!n) return null;
    return { attributes: S.proxy.attributes, index: { array: out.subarray(0, n * 3) } };
  }

  // ---- WHERE A PATH MEETS THE SKIN ---------------------------------------
  // facing: 1 = only the outside of a body (a tooth coming in), -1 = only an
  // inside face (where a ray leaves a part), 0 = either
  function hitRec() { return { S: null, t: 0, i0: 0, i1: 0, i2: 0, b0: 0, b1: 0, b2: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 1 }; }
  function castAll(surfs, ox, oy, oz, dx, dy, dz, tmax, facing, out) {
    let best = tmax;
    out.S = null;
    for (let s = 0; s < surfs.length; s++) {
      const S = surfs[s];
      if (!S || !S.nc) continue;
      const W = S.W, WN = S.WN, ci = S.cidx, nc = S.nc, cs = S.csph;
      for (let k = 0; k < nc; k++) {
        // the ray against the triangle's sphere first (d is unit)
        const ox0 = cs[k * 4] - ox, oy0 = cs[k * 4 + 1] - oy, oz0 = cs[k * 4 + 2] - oz, rr = cs[k * 4 + 3];
        const tc = ox0 * dx + oy0 * dy + oz0 * dz;
        if (tc < -rr || tc - rr > best) continue;
        const q2 = ox0 * ox0 + oy0 * oy0 + oz0 * oz0 - tc * tc;
        if (q2 > rr * rr) continue;
        const i0 = ci[k * 3], i1 = ci[k * 3 + 1], i2 = ci[k * 3 + 2];
        const a = i0 * 3, b = i1 * 3, c = i2 * 3;
        const e1x = W[b] - W[a], e1y = W[b + 1] - W[a + 1], e1z = W[b + 2] - W[a + 2];
        const e2x = W[c] - W[a], e2y = W[c + 1] - W[a + 1], e2z = W[c + 2] - W[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-14 && det < 1e-14) continue;
        const inv = 1 / det;
        const sx = ox - W[a], sy = oy - W[a + 1], sz = oz - W[a + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t <= 1e-6 || t >= best) continue;
        const w0 = 1 - u - v;
        let nx = WN[a] * w0 + WN[b] * u + WN[c] * v, ny = WN[a + 1] * w0 + WN[b + 1] * u + WN[c + 1] * v, nz = WN[a + 2] * w0 + WN[b + 2] * u + WN[c + 2] * v;
        const dn = nx * dx + ny * dy + nz * dz;
        if (facing > 0 && dn > -0.02) continue;
        if (facing < 0 && dn < 0.02) continue;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        best = t;
        out.S = S; out.t = t; out.i0 = i0; out.i1 = i1; out.i2 = i2; out.b0 = w0; out.b1 = u; out.b2 = v;
        out.px = ox + dx * t; out.py = oy + dy * t; out.pz = oz + dz * t;
        out.nx = nx / nl; out.ny = ny / nl; out.nz = nz / nl;
      }
    }
    return out.S ? out : null;
  }
  // the nearest point of the skin to a world point
  const _tA = new THREE.Vector3(), _tB = new THREE.Vector3(), _tC = new THREE.Vector3(), _tQ = new THREE.Vector3(), _tO = new THREE.Vector3(), _tBc = new THREE.Vector3();
  const _tri = new THREE.Triangle();
  /* the nearest point of the skin to a world point. A grid over the bite's
     triangles (a few triangles to a cell, built on the first ask after the
     triangles were gathered) is searched ring by ring outward, stopping once
     the next ring cannot hold anything nearer: a few dozen exact tests a
     query, not thousands. */
  let _gq = 0;
  const GB = 4096;                        // hash buckets (a power of two)
  function gridOf(S) {
    if (!S.grid || S.grid.built < S.nc) gridBuild(S, Infinity);
    return S.grid;
  }
  // the grid filed a part at a time (n more triangles; true when all are)
  function gridBuild(S, n) {
    let G = S.grid;
    if (G && G.built >= S.nc) return true;
    const cs = S.csph, nc = S.nc;
    if (!G) {
      // a cell is at least two of the biggest triangles across, so a
      // triangle filed by its centre touches only the cells next to its own
      const h = Math.max(1e-3, S.rmax * 2, (S.rsum / Math.max(1, nc)) * 3);
      G = S.gridMem && S.gridMem.cx.length >= nc ? S.gridMem : (S.gridMem = {
        cx: new Int32Array(Math.max(nc, 256)), cy: new Int32Array(Math.max(nc, 256)), cz: new Int32Array(Math.max(nc, 256)),
        next: new Int32Array(Math.max(nc, 256)), seen: new Int32Array(Math.max(nc, 256)), head: new Int32Array(GB),
      });
      G.head.fill(-1);
      G.h = h; G.built = 0;
      S.grid = G;
    }
    const h = G.h, end = Math.min(nc, G.built + n);
    for (let k = G.built; k < end; k++) {
      const ix = Math.floor(cs[k * 4] / h), iy = Math.floor(cs[k * 4 + 1] / h), iz = Math.floor(cs[k * 4 + 2] / h);
      G.cx[k] = ix; G.cy[k] = iy; G.cz[k] = iz;
      const b = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (GB - 1);
      G.next[k] = G.head[b]; G.head[b] = k;
    }
    G.built = end;
    return end >= nc;
  }
  function nearestAll(surfs, qx, qy, qz, out) {
    let best = Infinity;
    out.S = null;
    _tQ.set(qx, qy, qz);
    for (let s = 0; s < surfs.length; s++) {
      const S = surfs[s];
      if (!S || !S.nc) continue;
      const G = gridOf(S), h = G.h, seen = G.seen;
      const W = S.W, ci = S.cidx;
      const qid = ++_gq;
      const cx = Math.floor(qx / h), cy = Math.floor(qy / h), cz = Math.floor(qz / h);
      const test = function (k) {
        if (seen[k] === qid) return;
        seen[k] = qid;
        const i0 = ci[k * 3], i1 = ci[k * 3 + 1], i2 = ci[k * 3 + 2];
        _tA.fromArray(W, i0 * 3); _tB.fromArray(W, i1 * 3); _tC.fromArray(W, i2 * 3);
        _tri.set(_tA, _tB, _tC);
        _tri.closestPointToPoint(_tQ, _tO);
        const d2 = _tO.distanceToSquared(_tQ);
        if (d2 >= best) return;
        best = d2;
        out.S = S; out.i0 = i0; out.i1 = i1; out.i2 = i2; out.px = _tO.x; out.py = _tO.y; out.pz = _tO.z; out.t = Math.sqrt(d2);
      };
      // shells of cells outward; a triangle filed in shell r is at least
      // (r - 1.5) cells away, so once that passes the best the search is done
      let settled = false;
      for (let r = 0; r <= 3; r++) {
        const lim = (r - 1.5) * h;
        if (best < Infinity && lim > 0 && lim * lim >= best) { settled = true; break; }
        for (let ix = cx - r; ix <= cx + r; ix++) for (let iy = cy - r; iy <= cy + r; iy++) for (let iz = cz - r; iz <= cz + r; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy), Math.abs(iz - cz)) !== r) continue;
          const b = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (GB - 1);
          for (let k = G.head[b]; k >= 0; k = G.next[k]) if (G.cx[k] === ix && G.cy[k] === iy && G.cz[k] === iz) test(k);
        }
      }
      if (!settled && !(best < Infinity && (2.5 * h) * (2.5 * h) >= best)) {
        // a point far from this part. A triangle is no nearer than its
        // sphere's near side and no farther than its far side: the nearest
        // far side bounds the answer, and only a triangle whose near side
        // beats it is tested
        const cs = S.csph, nc = S.nc;
        let ub = best < Infinity ? Math.sqrt(best) : Infinity;
        for (let k = 0; k < nc; k++) {
          const sx = cs[k * 4] - qx, sy = cs[k * 4 + 1] - qy, sz = cs[k * 4 + 2] - qz;
          const far = Math.sqrt(sx * sx + sy * sy + sz * sz) + cs[k * 4 + 3];
          if (far < ub) ub = far;
        }
        for (let k = 0; k < nc; k++) {
          const sx = cs[k * 4] - qx, sy = cs[k * 4 + 1] - qy, sz = cs[k * 4 + 2] - qz, sr = Math.sqrt(sx * sx + sy * sy + sz * sz) - cs[k * 4 + 3];
          if (sr > ub || (sr > 0 && sr * sr >= best)) continue;
          test(k);
        }
      }
    }
    if (!out.S) return null;
    const S = out.S, W = S.W, WN = S.WN;
    _tA.fromArray(W, out.i0 * 3); _tB.fromArray(W, out.i1 * 3); _tC.fromArray(W, out.i2 * 3);
    _tri.set(_tA, _tB, _tC);
    _tO.set(out.px, out.py, out.pz);
    _tri.getBarycoord(_tO, _tBc);
    out.b0 = _tBc.x; out.b1 = _tBc.y; out.b2 = _tBc.z;
    let nx = WN[out.i0 * 3] * out.b0 + WN[out.i1 * 3] * out.b1 + WN[out.i2 * 3] * out.b2;
    let ny = WN[out.i0 * 3 + 1] * out.b0 + WN[out.i1 * 3 + 1] * out.b1 + WN[out.i2 * 3 + 1] * out.b2;
    let nz = WN[out.i0 * 3 + 2] * out.b0 + WN[out.i1 * 3 + 2] * out.b1 + WN[out.i2 * 3 + 2] * out.b2;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
    return out;
  }
  // world -> the part's own space at a surface point: rigid = the inverse
  // world matrix; skinned = the inverse of the bone blend at that point
  function hostInverse(S, h, out) {
    if (!S.skinned) return out.copy(S.MW || S.mesh.matrixWorld).invert();
    const e = out.elements;
    for (let k = 0; k < 16; k++) e[k] = 0;
    const SI = S.geo.attributes.skinIndex.array, SW = S.geo.attributes.skinWeight.array, M = S.M;
    const C = [h.i0, h.i1, h.i2], Bc = [h.b0, h.b1, h.b2];
    for (let c = 0; c < 3; c++) {
      const v4 = C[c] * 4, bc = Bc[c];
      if (!(bc > 0)) continue;
      for (let k = 0; k < 4; k++) {
        const w = SW[v4 + k] * bc;
        if (!w) continue;
        const o = SI[v4 + k] * 16;
        for (let j = 0; j < 16; j++) e[j] += w * M[o + j];
      }
    }
    return out.invert();
  }
  // the four strongest bones under a surface point (barycentric blend)
  const _wAcc = new Float64Array(64), _wIdx = new Int32Array(64);
  function blendWeights(S, i0, i1, i2, b0, b1, b2, outI, outW, oo) {
    const SI = S.geo.attributes.skinIndex.array, SW = S.geo.attributes.skinWeight.array;
    let n = 0;
    const C0 = [i0, i1, i2], B0 = [b0, b1, b2];
    for (let c = 0; c < 3; c++) {
      const v4 = C0[c] * 4, bc = B0[c];
      if (!(bc > 1e-6)) continue;
      for (let k = 0; k < 4; k++) {
        const w = SW[v4 + k] * bc;
        if (!(w > 1e-6)) continue;
        const bi = SI[v4 + k];
        let j = 0;
        while (j < n && _wIdx[j] !== bi) j++;
        if (j === n) { if (n >= 64) continue; _wIdx[n] = bi; _wAcc[n] = 0; n++; }
        _wAcc[j] += w;
      }
    }
    let tot = 0;
    for (let q = 0; q < 4; q++) {
      let bj = -1, bw = 0;
      for (let j = 0; j < n; j++) if (_wAcc[j] > bw) { bw = _wAcc[j]; bj = j; }
      if (bj >= 0) { outI[oo + q] = _wIdx[bj]; outW[oo + q] = bw; tot += bw; _wAcc[bj] = -1; }
      else { outI[oo + q] = 0; outW[oo + q] = 0; }
    }
    if (tot > 0) for (let q = 0; q < 4; q++) outW[oo + q] /= tot;
    else { outI[oo] = 0; outW[oo] = 1; }
  }

  /* ---- THE BUFFERS ONE BITE FILLS: per part, per layer --------------------
     "w" the tissue layer (punctures, cuts, rakes, crater, blood on skin,
     runs, flaps, cut faces), "s" the multiply layer (bruise, soak, the holes
     and rips in cloth and fur). One mesh each, per part touched. */
  // a growable typed array (a mark is built straight into the arrays the GPU
  // gets, no boxed numbers on the way)
  function GBuf(Ctor, cap) { this.C = Ctor; this.a = new Ctor(cap); this.n = 0; }
  GBuf.prototype.need = function (k) {
    if (this.n + k <= this.a.length) return;
    const b = new this.C(Math.max(this.a.length * 2, this.n + k));
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  };
  GBuf.prototype.p1 = function (x) { this.need(1); this.a[this.n++] = x; };
  GBuf.prototype.p2 = function (x, y) { this.need(2); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; this.n = n + 2; };
  GBuf.prototype.p3 = function (x, y, z) { this.need(3); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n = n + 3; };
  GBuf.prototype.p4 = function (x, y, z, w) { this.need(4); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; a[n + 3] = w; this.n = n + 4; };
  GBuf.prototype.out = function () { return this.a.slice(0, this.n); };
  function layerBuf(bite, S, layer) {
    const key = S.slot * 2 + (layer === "s" ? 1 : 0);
    let B = bite.bufs[key];
    if (!B) {
      const F = Float32Array;
      B = bite.bufs[key] = {
        S: S, layer: layer, pos: new GBuf(F, 768), nrm: new GBuf(F, 768), uv: new GBuf(F, 512), col: new GBuf(F, 1024),
        wcol: new GBuf(F, 768), si: new GBuf(Uint16Array, 1024), sw: new GBuf(F, 1024), fc: new GBuf(F, 512), along: new GBuf(F, 256),
        anims: [], n: 0,
      };
      bite.keys.push(key);
    }
    return B;
  }
  const _bwI = new Int32Array(4), _bwW = new Float32Array(4);
  // one vertex at a surface point given by a triangle and its barycentre,
  // written in the part's own space (lifted off it along its own normal)
  function vertBary(B, i0, i1, i2, b0, b1, b2, u, v, c, wc, lift, fcu, fcv, al) {
    const S = B.S, P = S.P, N = S.N;
    let nx = N[i0 * 3] * b0 + N[i1 * 3] * b1 + N[i2 * 3] * b2;
    let ny = N[i0 * 3 + 1] * b0 + N[i1 * 3 + 1] * b1 + N[i2 * 3 + 1] * b2;
    let nz = N[i0 * 3 + 2] * b0 + N[i1 * 3 + 2] * b1 + N[i2 * 3 + 2] * b2;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    B.pos.p3(P[i0 * 3] * b0 + P[i1 * 3] * b1 + P[i2 * 3] * b2 + nx * lift,
      P[i0 * 3 + 1] * b0 + P[i1 * 3 + 1] * b1 + P[i2 * 3 + 1] * b2 + ny * lift,
      P[i0 * 3 + 2] * b0 + P[i1 * 3 + 2] * b1 + P[i2 * 3 + 2] * b2 + nz * lift);
    B.nrm.p3(nx, ny, nz);
    vertTail(B, i0, i1, i2, b0, b1, b2, u, v, c, wc, fcu, fcv, al);
  }
  function vertTail(B, i0, i1, i2, b0, b1, b2, u, v, c, wc, fcu, fcv, al) {
    const S = B.S;
    B.uv.p2(u, v);
    B.col.p4(c[0], c[1], c[2], c[3]);
    if (B.layer === "w") B.wcol.p3(wc ? wc[0] : 1, wc ? wc[1] : 1, wc ? wc[2] : 1);
    B.fc.p2(fcu || 0, fcv || 0);
    B.along.p1(al || 0);
    if (S.skinned) {
      blendWeights(S, i0, i1, i2, b0, b1, b2, _bwI, _bwW, 0);
      B.si.p4(_bwI[0], _bwI[1], _bwI[2], _bwI[3]);
      B.sw.p4(_bwW[0], _bwW[1], _bwW[2], _bwW[3]);
    }
    B.n++;
  }
  // a vertex given in WORLD (built geometry: flaps, runs, cut faces), seated
  // on the part through the surface point h it hangs from
  const _hv = new THREE.Vector3(), _hvn = new THREE.Vector3();
  function vertWorld(B, h, inv, wx, wy, wz, nx, ny, nz, u, v, c, wc, fcu, fcv, al) {
    _hv.set(wx, wy, wz).applyMatrix4(inv);
    _hvn.set(nx, ny, nz).transformDirection(inv);
    B.pos.p3(_hv.x, _hv.y, _hv.z);
    B.nrm.p3(_hvn.x, _hvn.y, _hvn.z);
    vertTail(B, h.i0, h.i1, h.i2, h.b0, h.b1, h.b2, u, v, c, wc, fcu, fcv, al);
  }

  /* ---- ONE MARK = A BOX PROJECTED ON THE SKIN --------------------------------
     el = { layer, cell (a TCELL/SCELL rect), P, N (world), T (world, the
     mark's +u), sx, sy (box size, m), dz (half depth), c (vertex colour),
     wc, anim, only (a surface) }. Projected through every part of this bite
     by systems/surfacedecal.js on the posed triangles near it. */
  const _eb = new THREE.Matrix4(), _ebi = new THREE.Matrix4();
  const _eT = new THREE.Vector3(), _eB = new THREE.Vector3(), _eN = new THREE.Vector3();
  const _dirA = [0, 0, 1];
  function stampEl(bite, el) {
    if (!CBZ.surfaceDecal || !CBZ.surfaceDecal.project) return false;
    _eN.set(el.N.x, el.N.y, el.N.z).normalize();
    _eT.set(el.T.x, el.T.y, el.T.z).addScaledVector(_eN, -(el.T.x * _eN.x + el.T.y * _eN.y + el.T.z * _eN.z));
    if (_eT.lengthSq() < 1e-10) { _eT.set(-_eN.z, 0, _eN.x); if (_eT.lengthSq() < 1e-10) _eT.set(1, 0, 0); }
    _eT.normalize();
    _eB.crossVectors(_eN, _eT);
    const sx = Math.max(1e-4, el.sx), sy = Math.max(1e-4, el.sy), sz = el.depthExact ? Math.max(1e-4, el.dz * 2) : Math.max(1e-4, el.dz * 2, Math.max(sx, sy) * 0.35);
    _eb.set(_eT.x * sx, _eB.x * sy, _eN.x * sz, el.P.x,
      _eT.y * sx, _eB.y * sy, _eN.y * sz, el.P.y,
      _eT.z * sx, _eB.z * sy, _eN.z * sz, el.P.z,
      0, 0, 0, 1);
    _ebi.copy(_eb).invert();
    _dirA[0] = _eN.x; _dirA[1] = _eN.y; _dirA[2] = _eN.z;
    const cell = el.cell;
    let any = false;
    for (let s = 0; s < bite.surfs.length; s++) {
      const S = bite.surfs[s];
      if (!S || !S.nc || (el.only && el.only !== S)) continue;
      const px = proxyNear(S, el.P.x, el.P.y, el.P.z, 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz));
      if (!px) continue;
      let r = null;
      try { r = CBZ.surfaceDecal.project(px, _ebi.elements, { dir: _dirA, minFacing: el.minFacing != null ? el.minFacing : 0.12, maxTris: 700 }); } catch (e) { r = null; }
      if (!r) continue;
      any = true;
      const B = layerBuf(bite, S, el.layer);
      if (B.n > BITE_VERTS) continue;
      const first = B.n, lift = (el.lift != null ? el.lift : SKIN_LIFT) / S.wsc;
      const src = r.src, bar = r.bary, uv = r.uv;
      for (let v = 0; v < r.n; v++) {
        const ub = uv[v * 2], vb = uv[v * 2 + 1];
        vertBary(B, src[v * 3], src[v * 3 + 1], src[v * 3 + 2], bar[v * 3], bar[v * 3 + 1], bar[v * 3 + 2],
          cell[0] + ub * cell[2], cell[1] + vb * cell[3], el.c, el.wc, lift, ub - 0.5, vb - 0.5, 0);
      }
      if (el.anim) {
        const list = Array.isArray(el.anim) ? el.anim : [el.anim];
        for (let k = 0; k < list.length; k++) B.anims.push(Object.assign({ a: first, n: B.n - first, cell: cell }, list[k]));
      }
    }
    return any;
  }

  /* ---- THE MARK MESHES, THEIR LIFE, THEIR BUDGET ------------------------- */
  /* THE BUDGET: meshes per body and in the world on the quality tier, and the
     vertices all marks hold together (a phone's memory is the real limit: a
     great white's bite on a tuna is a few thousand vertices). Oldest first. */
  function skinVertCap() { return (CBZ.qScale ? CBZ.qScale(120000, 400000) : 240000) | 0; }
  let SKIN_VERTS = 0;
  const BITE_VERTS = 9000;               // one layer of one bite on one part, at most
  function skinDrop(i) {
    const r = SKIN.splice(i, 1)[0];
    if (!r) return;
    r.gone = true;
    SKIN_VERTS -= r.verts || 0;
    if (r.m.parent) r.m.parent.remove(r.m);
    if (r.m.geometry) { try { r.m.geometry.dispose(); } catch (e) {} }
  }
  function skinMake(actor, nv) {
    // this body's own oldest first, then the world's
    let n = 0, first = -1;
    for (let i = 0; i < SKIN.length; i++) if (SKIN[i].actor === actor) { if (first < 0) first = i; n++; }
    if (n >= SKIN_PER_ACTOR && first >= 0) skinDrop(first);
    else if (SKIN.length >= skinCap()) skinDrop(0);
    const cap = skinVertCap();
    while (SKIN.length && SKIN_VERTS + nv > cap) skinDrop(0);
  }
  const ANIM = [];
  // one layer's mesh on one surface (a slice of the bite's job)
  function buildMark(bite, key) {
    {
      const B = bite.bufs[key];
      if (!B || B.n < 3) return null;
      const S = B.S, host = S.mesh;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(B.pos.out(), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(B.nrm.out(), 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(B.uv.out(), 2));
      geo.setAttribute("color", new THREE.BufferAttribute(B.col.out(), 4));
      if (B.layer === "w") geo.setAttribute("wCol", new THREE.BufferAttribute(B.wcol.out(), 3));
      if (S.skinned) {
        geo.setAttribute("skinIndex", new THREE.BufferAttribute(B.si.out(), 4));
        geo.setAttribute("skinWeight", new THREE.BufferAttribute(B.sw.out(), 4));
        // culled by the body's own (pose-padded) sphere, set below
        geo.boundingSphere = host.boundingSphere ? host.boundingSphere.clone() : null;
      } else geo.computeBoundingSphere();
      const mat = markMat(B.layer, bite.tissue);
      let m;
      if (S.skinned) {
        // bound to the body's own skeleton and bind matrix: a child of the
        // body at identity, so it draws exactly where the skin draws
        m = new THREE.SkinnedMesh(geo, mat);
        m.bindMode = host.bindMode;
        m.bind(host.skeleton, host.bindMatrix);
        if (host.boundingSphere) m.boundingSphere = host.boundingSphere; else m.frustumCulled = false;
        if (host.boundingBox) m.boundingBox = host.boundingBox;
      } else m = new THREE.Mesh(geo, mat);
      m.name = "biteMark";
      m.userData.cbzSkinMark = B.layer === "s" ? "stain" : "flesh";
      m._tornCap = true;                       // part finders must never see it
      m.raycast = NOOP;                        // nor a bullet, nor a camera ray
      m.castShadow = false; m.receiveShadow = false;
      m.renderOrder = SKIN_RO + (B.layer === "s" ? -0.01 : 0);
      skinMake(bite.actor, B.n);
      host.add(m);
      const rec = {
        m: m, actor: bite.actor, host: host, layer: B.layer, age: 0, t: 0, gone: false,
        anims: B.anims.length ? B.anims : null, fc: B.fc.out(), along: B.along.out(),
        a0: null,
      };
      if (rec.anims) {
        const ca = geo.attributes.color.array;
        rec.a0 = new Float32Array(B.n);
        for (let v = 0; v < B.n; v++) rec.a0[v] = ca[v * 4 + 3];
        ANIM.push(rec);
        animStep(rec, 0);
      }
      rec.verts = B.n;
      SKIN_VERTS += B.n;
      SKIN.push(rec);
      bite.made = (bite.made || 0) + 1;
      return m;
    }
  }

  /* ---- TIME ON A WOUND -------------------------------------------------------
     grow   blood blooms out of the wound in the first second, then keeps
            wicking (cloth, fur) or creeping (skin) for tens of seconds
     alpha  a ramp: a bruise darkening, blood thinning off a wound in the sea
     front  a run of blood lengthening down the body, slowing as it clots
     heal   a rake ageing to the pale scar every sea mammal and shark carries */
  function ease(k) { return k <= 0 ? 0 : (k >= 1 ? 1 : 1 - (1 - k) * (1 - k)); }
  function UVC(x) { return x < -0.47 ? -0.47 : (x > 0.47 ? 0.47 : x); }
  function animStep(rec, dt) {
    rec.t += dt;
    const g = rec.m.geometry, A = rec.anims;
    let live = false, uvDirty = false, colDirty = false;
    const uv = g.attributes.uv.array, ca = g.attributes.color.array, fc = rec.fc;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (a.done) continue;
      const t = rec.t - (a.t0 || 0);
      if (t < 0) { live = true; continue; }
      if (a.type === "grow") {
        // fast bloom to g1, then the slow creep to full size
        const g1 = a.g1 != null ? a.g1 : 0.8;
        let gg;
        if (t < a.T) gg = a.g0 + (g1 - a.g0) * Math.sqrt(t / a.T);
        else { const k = Math.min(1, (t - a.T) / (a.creep || 40)); gg = g1 + (1 - g1) * ease(k); if (k >= 1) a.done = true; }
        const c = a.cell, ax = a.ax || 0, ay = a.ay || 0;
        for (let v = a.a; v < a.a + a.n; v++) {
          uv[v * 2] = c[0] + (UVC((fc[v * 2] - ax) / gg + ax) + 0.5) * c[2];
          uv[v * 2 + 1] = c[1] + (UVC((fc[v * 2 + 1] - ay) / gg + ay) + 0.5) * c[3];
        }
        uvDirty = true;
      } else if (a.type === "alpha") {
        const k = Math.min(1, t / a.T), f = a.from + (a.to - a.from) * ease(k);
        for (let v = a.a; v < a.a + a.n; v++) ca[v * 4 + 3] = rec.a0[v] * f;
        colDirty = true;
        if (k >= 1) a.done = true;
      } else if (a.type === "front") {
        // L(t) = 1 - e^(-t/tau): the flow slows as the wound clots
        const L = 1 - Math.exp(-t / a.tau), al = rec.along;
        for (let v = a.a; v < a.a + a.n; v++) ca[v * 4 + 3] = rec.a0[v] * (1 - sstep(L - 0.03, L + 0.05, al[v]));
        colDirty = true;
        if (L > 0.985) a.done = true;
      } else if (a.type === "heal") {
        const k = Math.min(1, t / a.T), f = (a.to || 0.85) * ease(k);
        for (let v = a.a; v < a.a + a.n; v++) ca[v * 4 + 1] = f;
        colDirty = true;
        if (k >= 1) a.done = true;
      }
      if (!a.done) live = true;
    }
    if (uvDirty) g.attributes.uv.needsUpdate = true;
    if (colDirty) g.attributes.color.needsUpdate = true;
    return live;
  }
  let animT = 0;
  function animAll(dt) {
    animT += dt;
    if (animT < 0.1) return;
    const step = animT;
    animT = 0;
    for (let i = ANIM.length - 1; i >= 0; i--) {
      const r = ANIM[i];
      if (r.gone || !r.m.parent) { ANIM.splice(i, 1); continue; }
      if (!animStep(r, step)) ANIM.splice(i, 1);
    }
  }
  function under(o, root) {
    for (let k = 0; o && k < 16; k++, o = o.parent) if (o === root) return true;
    return false;
  }
  // the 0.8 s sweep: a mark whose body left the scene goes with it (and its
  // geometry is freed); nothing here ever heals a living body
  function skinSweep(step) {
    for (let i = SKIN.length - 1; i >= 0; i--) {
      const r = SKIN[i], a = r.actor;
      if (!r.m.parent || !a || a.culled || !a.group || !a.group.parent || !under(r.host, a.group)) { skinDrop(i); continue; }
      r.age += step;
    }
  }
  function skinForget(actor) {
    for (let i = SKIN.length - 1; i >= 0; i--) if (!actor || SKIN[i].actor === actor) skinDrop(i);
  }

  /* ---- A BODY THAT LOST FLESH OWNS ITS GEOMETRY ------------------------------
     A species' geometry is shared by every animal of it (and every LOD of it
     is swapped in by its rig: city/wildlife_rig.js marineLod, units/kit/
     canid.js lodCheck and collar()). A bite that takes flesh therefore gives
     THAT animal its own copy, once, on its first such bite, and never touches
     the template: positions, normals and colours are its own (the crater,
     the cut, the raw tissue are written there); every other attribute stays
     shared with the species.

     The rig keeps swapping geometries as it always has. The body's
     `geometry` slot becomes an accessor: whatever shared geometry the rig
     assigns, the animal is handed its own wounded copy of THAT one (built on
     first sight by replaying every wound it has taken, recorded in world
     space at the moment of the bite together with the bone matrices of that
     moment, so a far LOD carries the same crater and the same missing fluke
     as the near one). Freed by the leak sweep below: the copies are marked
     _shared so no rig disposal touches them, and their shared attributes are
     detached before they are disposed (disposing one would delete the GPU
     buffer the rest of the species draws from). */
  const OWNED = [];
  function ownCap() { return (CBZ.qScale ? CBZ.qScale(6, 18) : 10) | 0; }
  function ownBody(actor, mesh) {
    if (mesh._cbzOwn) return mesh._cbzOwn;
    const rec = { actor: actor, mesh: mesh, shared: mesh.geometry, cur: null, map: new Map(), ops: [], removed: 0, severed: 0, craters: 0 };
    Object.defineProperty(mesh, "geometry", {
      configurable: true, enumerable: true,
      get: function () { return rec.cur; },
      set: function (g) { rec.shared = g; rec.cur = ownFor(rec, g); },
    });
    rec.cur = ownFor(rec, rec.shared);
    mesh._cbzOwn = rec;
    OWNED.push(rec);
    return rec;
  }
  function ownFor(rec, g) {
    if (!g || !g.attributes || !g.attributes.position) return g;
    if (g.userData && g.userData.cbzOwnOf === rec) return g;
    let o = rec.map.get(g);
    if (!o) {
      o = copyGeo(g, rec);
      rec.map.set(g, o);
      for (let i = 0; i < rec.ops.length; i++) {
        try { if (!rec.ops[i].through) refineAll(o, rec.ops[i]); applyRemove(rec, o, rec.ops[i], false); } catch (e) {}
      }
    }
    return o;
  }
  // a template geometry's welded ids, shared by every copy of it (positions
  // equal until a dig or a refinement changes the copy)
  const TWID = new WeakMap();
  function widOf(geo, P, nv) {
    const u = geo.userData || (geo.userData = {});
    if (u.wid && u.wid.length === nv) return u.wid;
    u.wid = weldIds(P, nv);
    if (u.tpl && u.tpl.attributes && u.tpl.attributes.position && u.tpl.attributes.position.count === nv && !u.refined) TWID.set(u.tpl, u.wid);
    return u.wid;
  }
  function copyGeo(g, rec) {
    const o = new THREE.BufferGeometry();
    const own = [];
    for (const k in g.attributes) {
      const A = g.attributes[k];
      if (k === "position" || k === "normal" || k === "color") {
        o.setAttribute(k, new THREE.BufferAttribute(A.array.slice(0), A.itemSize, A.normalized));
        own.push(k);
      } else o.setAttribute(k, A);
    }
    if (g.index) o.setIndex(g.index);                  // shared until a cut needs its own
    for (let i = 0; i < g.groups.length; i++) o.addGroup(g.groups[i].start, g.groups[i].count, g.groups[i].materialIndex);
    o.boundingBox = g.boundingBox ? g.boundingBox.clone() : null;
    o.boundingSphere = g.boundingSphere ? g.boundingSphere.clone() : null;
    o.userData = { cbzOwnOf: rec, mbTag: g.userData ? g.userData.mbTag : undefined, ownAttrs: own, ownIndex: false, wid: TWID.get(g) || null, tpl: g };
    o._shared = true;
    o.name = (g.name || "body") + "+wounds";
    return o;
  }
  function ownIndex(o) {
    if (o.userData.ownIndex || !o.index) return;
    o.setIndex(new THREE.BufferAttribute(o.index.array.slice(0), 1));
    o.userData.ownIndex = true;
  }
  function freeGeo(o) {
    const own = (o.userData && o.userData.ownAttrs) || [];
    const ks = Object.keys(o.attributes);
    for (let i = 0; i < ks.length; i++) if (own.indexOf(ks[i]) < 0) o.deleteAttribute(ks[i]);
    if (!(o.userData && o.userData.ownIndex)) o.setIndex(null);
    try { o.dispose(); } catch (e) {}
  }
  // give the species' geometry back (a reset, or the body left the world)
  function freeOwn(rec) {
    const i = OWNED.indexOf(rec);
    if (i >= 0) OWNED.splice(i, 1);
    const m = rec.mesh;
    if (m && m._cbzOwn === rec) {
      delete m.geometry;
      m.geometry = rec.shared;
      m._cbzOwn = undefined;
    }
    rec.map.forEach(function (o) { freeGeo(o); });
    rec.map.clear();
  }
  function ownSweep() {
    for (let i = OWNED.length - 1; i >= 0; i--) {
      const r = OWNED[i], a = r.actor;
      if (!a || a.culled || !a.group || !a.group.parent || !under(r.mesh, a.group)) freeOwn(r);
    }
  }

  /* ---- WELDED TOPOLOGY ----------------------------------------------------
     The marine bodies cut their colour lines THROUGH the triangles, so one
     surface is many index-disconnected pieces sharing positions. Anything
     that asks "what is still attached to what" welds by position first. */
  const WB = 16384;
  let _wHead = null, _wNext = null;
  function weldIds(P, nv) {
    const wid = new Int32Array(nv);
    if (!_wHead) _wHead = new Int32Array(WB);
    if (!_wNext || _wNext.length < nv) _wNext = new Int32Array(Math.max(nv, 1024));
    _wHead.fill(-1);
    for (let i = 0; i < nv; i++) {
      const x = Math.round(P[i * 3] * 2e4), y = Math.round(P[i * 3 + 1] * 2e4), z = Math.round(P[i * 3 + 2] * 2e4);
      const b = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (WB - 1);
      let found = -1;
      for (let j = _wHead[b]; j >= 0; j = _wNext[j]) {
        if (Math.round(P[j * 3] * 2e4) === x && Math.round(P[j * 3 + 1] * 2e4) === y && Math.round(P[j * 3 + 2] * 2e4) === z) { found = j; break; }
      }
      if (found < 0) { _wNext[i] = _wHead[b]; _wHead[b] = i; wid[i] = i; }
      else wid[i] = found;
    }
    return wid;
  }
  function ufNew(n) { const p = new Int32Array(n); for (let i = 0; i < n; i++) p[i] = i; return p; }
  function ufFind(p, a) { while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; } return a; }
  function ufJoin(p, a, b) { a = ufFind(p, a); b = ufFind(p, b); if (a !== b) p[a] = b; }
  function eKey(a, b) { return a < b ? a * 1048576 + b : b * 1048576 + a; }

  /* ---- TAKING FLESH -----------------------------------------------------------
     op (all world, at the bite): C the bite's seat, F into the body, S / U the
     jaw's width and close axes, rS rU rF the jaw's removal volume (its outline
     on the skin, scalloped by n teeth, and how deep it goes), through = the
     jaw closed right through the part, M the bone matrices of that instant,
     tis the tissue palette.

     Every vertex is posed with M and asked whether it lies in the volume:
       CRATER (the body is thicker than the bite): skin inside the outline is
         pushed back along F to the floor of an ellipsoidal dish; its colour
         becomes the tissue at that depth.
       THROUGH (a fin, a fluke, an ear, a tail stock the jaw closed round, or
         any thin appendage inside the outline): the triangles inside are
         removed; the vertices kept triangles still use are moved out to the
         outline, so the part ends at the bite's edge.
     Then what is still attached is decided by topology: per piece of the
     body (welded), the part that holds its root bone keeps it; a fin or an ear
     whose root was on a piece that left goes with it. Severed triangles are
     removed too. Every new open edge is a cut: at the bite (full) its loops
     are returned for a cross-section face, and the removed triangles for the
     piece that leaves. A replay on another LOD (full = false) only reshapes. */
  const _bl = new THREE.Matrix4(), _bv = new THREE.Vector3();
  function blendOf(SI, SW, i, M, out) {
    const e = out.elements;
    for (let k = 0; k < 16; k++) e[k] = 0;
    for (let k = 0; k < 4; k++) {
      const w = SW[i * 4 + k];
      if (!w) continue;
      const o = SI[i * 4 + k] * 16;
      for (let j = 0; j < 16; j++) e[j] += w * M[o + j];
    }
    return out;
  }
  function setBind(P, SI, SW, i, M, wx, wy, wz) {
    blendOf(SI, SW, i, M, _bl).invert();
    _bv.set(wx, wy, wz).applyMatrix4(_bl);
    P[i * 3] = _bv.x; P[i * 3 + 1] = _bv.y; P[i * 3 + 2] = _bv.z;
  }
  // the tissue colour at a depth fraction (0 skin edge .. 1 the floor)
  function tisCol(tis, d, out) {
    const L = tis.L;
    let c = tis._dermis;
    const mixc = function (a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; };
    c = mixc(c, tis._fat, sstep(L[0], L[0] + 0.05, d));
    c = mixc(c, tis._muscle, sstep(L[1], L[1] + 0.06, d));
    c = mixc(c, tis._deep, sstep(L[2], 1, d) * 0.6);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    return out;
  }
  function tisLin(kind) {
    const T = TISSUE[kind] || TISSUE.mammal;
    if (!T._dermis) {
      const f = function (h) { return [Math.pow(((h >> 16) & 255) / 255, 2.2), Math.pow(((h >> 8) & 255) / 255, 2.2), Math.pow((h & 255) / 255, 2.2)]; };
      T._dermis = f(T.dermis); T._fat = f(T.fat); T._muscle = f(T.muscle); T._deep = f(T.deep); T._rim = f(T.rim);
    }
    return T;
  }
  const _tc3 = [0, 0, 0];
  /* ---- A CRATER ON A COARSE BODY ------------------------------------------
     A dolphin's or a megalodon's triangles are as big as the bite: pushing
     the few vertices inside the dish in would dent a facet many times its
     size, so the dish used to be painted only. Before the dig, the triangles
     under the dish that face the jaw are split, each long edge at its middle
     and every neighbour that shares a split edge with it (the closure: a
     triangle with two split edges splits its third), so the surface never
     cracks, until their edges are a fraction of the dish (REFINE_K), at most
     REFINE_LEVELS times. A new vertex is the average of its edge's ends in
     every attribute (position, normal renormalised, colour, uv, a marine
     body's skin data) and the four strongest of their bones. One level per
     call: a bite's job runs one a frame. Returns true while more is due. */
  const REFINE_LEVELS = 5, REFINE_K = 0.38;
  // (only the triangles round the dish are touched: the rest of the body is
  // copied through, so a level costs the dish, not the whale)
  /* st, the caller's, kept from level to level: W, WN the posed body (grown
     with each level's new vertices, posed alone); test, the triangles worth
     testing at the next level (this level's region's children); seed, the
     instant's near triangles, tested at the first level instead of all */
  function refineLevel(geo, op, st) {
    if (!geo.index || (geo.groups && geo.groups.length > 1)) return false;
    const AT = geo.attributes;
    for (const k in AT) if (AT[k].isInterleavedBufferAttribute) return false;
    if (!AT.normal || !AT.skinIndex || !AT.skinWeight) return false;
    const u = geo.userData || (geo.userData = {});
    st = st || {};
    const P = AT.position.array, N = AT.normal.array, nv = AT.position.count;
    const SI = AT.skinIndex.array, SW = AT.skinWeight.array;
    const idx = geo.index.array, nt = (idx.length / 3) | 0;
    let W = st.W, WN = st.WN;
    if (!W || W.length !== nv * 3) {
      W = new Float32Array(nv * 3); WN = new Float32Array(nv * 3);
      poseSkinned(P, N, SI, SW, op.M, nv, W, WN);
      st.test = null; st.seed = null;
    }
    const wid = widOf(geo, P, nv);
    const C = op.C, S = op.S, U = op.U, F = op.F, target = REFINE_K * Math.min(op.rS, op.rU), t2 = target * target;
    // edge keys as small integers (a hash key that is a boxed double is slow)
    const KB = nv * 4 + 8 < 32768 ? 32768 : (nv * 4 + 8 < 1048576 ? 1048576 : 0);
    if (!KB) return false;
    const eK = function (p, q) { return p < q ? p * KB + q : q * KB + p; };
    // 1. the triangles under the dish that face the jaw: their long edges split
    const test = st.test || st.seed || null, ntest = test ? test.length : nt;
    const split = new Set();
    const mark = new Uint8Array(nv);          // by welded id: an end of a split edge
    const A0 = _rfA, B0 = _rfB;
    for (let ti = 0; ti < ntest; ti++) {
      const t = test ? test[ti] : ti;
      if (t >= nt) continue;
      const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      let rmin = Infinity, cmin = Infinity;
      for (let k = 0; k < 3; k++) {
        const v = (k === 0 ? i0 : k === 1 ? i1 : i2) * 3, dx = W[v] - C[0], dy = W[v + 1] - C[1], dz = W[v + 2] - C[2];
        const aa = (dx * S[0] + dy * S[1] + dz * S[2]) / op.rS, bb = (dx * U[0] + dy * U[1] + dz * U[2]) / op.rU;
        A0[k] = aa; B0[k] = bb;
        const r2 = aa * aa + bb * bb; if (r2 < rmin) rmin = r2;
        const cc = dx * F[0] + dy * F[1] + dz * F[2]; if (cc < cmin) cmin = cc;
      }
      if (cmin > op.rF * 1.5) continue;
      if (rmin > 1.69 && !inTri2(A0, B0)) continue;
      const e1x = W[i1 * 3] - W[i0 * 3], e1y = W[i1 * 3 + 1] - W[i0 * 3 + 1], e1z = W[i1 * 3 + 2] - W[i0 * 3 + 2];
      const e2x = W[i2 * 3] - W[i0 * 3], e2y = W[i2 * 3 + 1] - W[i0 * 3 + 1], e2z = W[i2 * 3 + 2] - W[i0 * 3 + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      if ((nx * F[0] + ny * F[1] + nz * F[2]) / nl > 0.35) continue;
      for (let k = 0; k < 3; k++) {
        const p = k === 0 ? i0 : k === 1 ? i1 : i2, qv = k === 0 ? i1 : k === 1 ? i2 : i0;
        const dx = W[p * 3] - W[qv * 3], dy = W[p * 3 + 1] - W[qv * 3 + 1], dz = W[p * 3 + 2] - W[qv * 3 + 2];
        if (dx * dx + dy * dy + dz * dz > t2) { split.add(eK(wid[p], wid[qv])); mark[wid[p]] = 1; mark[wid[qv]] = 1; }
      }
    }
    if (!split.size) return false;
    // 2. the region: every triangle with a corner at an end of a split edge.
    // Whatever shares a split edge is in it, across seams too, and the
    // closure only ever splits edges between such corners (a triangle with
    // two split edges has all three corners on them)
    const region = [];
    for (let t = 0; t < nt; t++) {
      if (mark[wid[idx[t * 3]]] | mark[wid[idx[t * 3 + 1]]] | mark[wid[idx[t * 3 + 2]]]) region.push(t);
    }
    // a triangle with two split edges splits its third too (no slivers, no
    // hanging vertices)
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (let ri = 0; ri < region.length; ri++) {
        const t = region[ri], i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
        const k0 = eK(wid[i0], wid[i1]), k1 = eK(wid[i1], wid[i2]), k2 = eK(wid[i2], wid[i0]);
        const c = (split.has(k0) ? 1 : 0) + (split.has(k1) ? 1 : 0) + (split.has(k2) ? 1 : 0);
        if (c === 2) { split.add(k0); split.add(k1); split.add(k2); changed = true; }
      }
      if (!changed) break;
    }
    // 3. one new vertex per split edge per side of a seam
    const mids = new Map();
    let nn = nv;
    const ends = [];
    for (let ri = 0; ri < region.length; ri++) {
      const t = region[ri];
      for (let k = 0; k < 3; k++) {
        const p = idx[t * 3 + k], qv = idx[t * 3 + (k + 1) % 3];
        if (!split.has(eK(wid[p], wid[qv]))) continue;
        const key = eK(p, qv);
        if (!mids.has(key)) { mids.set(key, nn++); ends.push(p, qv); }
      }
    }
    if (nn === nv) return false;
    const nm = nn - nv;
    for (const name in AT) {
      const A = AT[name], sz = A.itemSize, src = A.array;
      if (name === "skinIndex" || name === "skinWeight") continue;
      const dst = new src.constructor(nn * sz);
      dst.set(src);
      for (let m = 0; m < nm; m++) {
        const p = ends[m * 2], qv = ends[m * 2 + 1], o = (nv + m) * sz;
        for (let c = 0; c < sz; c++) dst[o + c] = (src[p * sz + c] + src[qv * sz + c]) * 0.5;
        if (name === "normal") {
          const l = Math.sqrt(dst[o] * dst[o] + dst[o + 1] * dst[o + 1] + dst[o + 2] * dst[o + 2]) || 1;
          dst[o] /= l; dst[o + 1] /= l; dst[o + 2] /= l;
        }
      }
      geo.setAttribute(name, new THREE.BufferAttribute(dst, sz, A.normalized));
    }
    // the bones: both ends' influences, the four strongest, renormalised
    const nSI = new SI.constructor(nn * 4), nSW = new SW.constructor(nn * 4);
    nSI.set(SI); nSW.set(SW);
    for (let m = 0; m < nm; m++) {
      const p = ends[m * 2], qv = ends[m * 2 + 1], o = (nv + m) * 4;
      let n = 0;
      for (let e = 0; e < 2; e++) {
        const v = e ? qv : p;
        for (let k = 0; k < 4; k++) {
          const w = SW[v * 4 + k] * 0.5;
          if (!(w > 0)) continue;
          const bn = SI[v * 4 + k];
          let j = 0;
          while (j < n && _wIdx[j] !== bn) j++;
          if (j === n) { _wIdx[n] = bn; _wAcc[n] = 0; n++; }
          _wAcc[j] += w;
        }
      }
      let tot = 0;
      for (let k = 0; k < 4; k++) {
        let best = -1;
        for (let j = 0; j < n; j++) if (_wAcc[j] > 0 && (best < 0 || _wAcc[j] > _wAcc[best])) best = j;
        if (best < 0) { nSI[o + k] = 0; nSW[o + k] = 0; continue; }
        nSI[o + k] = _wIdx[best]; nSW[o + k] = _wAcc[best]; tot += _wAcc[best]; _wAcc[best] = 0;
      }
      if (tot > 0) for (let k = 0; k < 4; k++) nSW[o + k] /= tot;
    }
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(nSI, 4, AT.skinIndex.normalized));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(nSW, 4, AT.skinWeight.normalized));
    // 4. the triangles: the region's kept, halved or quartered; the rest as
    // they were. The region's children are the next level's to test.
    const inR = new Uint8Array(nt);
    let extra = 0;
    for (let ri = 0; ri < region.length; ri++) {
      const t = region[ri];
      inR[t] = 1;
      const k = (mids.has(eK(idx[t * 3], idx[t * 3 + 1])) ? 1 : 0) + (mids.has(eK(idx[t * 3 + 1], idx[t * 3 + 2])) ? 1 : 0) + (mids.has(eK(idx[t * 3 + 2], idx[t * 3])) ? 1 : 0);
      extra += k === 0 ? 0 : (k === 1 ? 1 : 3);
    }
    const I = (nn > 65535 ? new Uint32Array((nt + extra) * 3) : new Uint16Array((nt + extra) * 3));
    const next = [];
    let o = 0;
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      if (!inR[t]) { I[o++] = a; I[o++] = b; I[o++] = c; continue; }
      const mab = mids.get(eK(a, b)), mbc = mids.get(eK(b, c)), mca = mids.get(eK(c, a));
      const k = (mab != null ? 1 : 0) + (mbc != null ? 2 : 0) + (mca != null ? 4 : 0);
      const t0 = o / 3;
      next.push(t0); if (k) { next.push(t0 + 1); if (k !== 1 && k !== 2 && k !== 4) next.push(t0 + 2, t0 + 3); }
      if (k === 0) { I[o++] = a; I[o++] = b; I[o++] = c; }
      else if (k === 1) { I[o++] = a; I[o++] = mab; I[o++] = c; I[o++] = mab; I[o++] = b; I[o++] = c; }
      else if (k === 2) { I[o++] = a; I[o++] = b; I[o++] = mbc; I[o++] = a; I[o++] = mbc; I[o++] = c; }
      else if (k === 4) { I[o++] = a; I[o++] = b; I[o++] = mca; I[o++] = mca; I[o++] = b; I[o++] = c; }
      else {
        I[o++] = a; I[o++] = mab; I[o++] = mca; I[o++] = mab; I[o++] = b; I[o++] = mbc;
        I[o++] = mca; I[o++] = mbc; I[o++] = c; I[o++] = mab; I[o++] = mbc; I[o++] = mca;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(o === I.length ? I : I.slice(0, o), 1));
    // the welded ids grow with the new vertices: a new one can only share a
    // place with another new one (the two sides of a seam split together)
    const nw = new Int32Array(nn);
    nw.set(wid);
    const seen = new Map();
    for (let m = 0; m < nm; m++) {
      const key = eK(wid[ends[m * 2]], wid[ends[m * 2 + 1]]);
      const f = seen.get(key);
      if (f != null) nw[nv + m] = f; else { seen.set(key, nv + m); nw[nv + m] = nv + m; }
    }
    u.wid = nw;
    u.ownAttrs = Object.keys(geo.attributes); u.ownIndex = true;
    u.comp = null;
    u.refined = (u.refined || 0) + 1;
    u.refinedVerts = (u.refinedVerts || 0) + nm;
    // the next level's pose (the old vertices' as they were, the new ones
    // posed alone) and what it tests
    const W2 = new Float32Array(nn * 3), WN2 = new Float32Array(nn * 3);
    W2.set(W); WN2.set(WN);
    poseSkinned(geo.attributes.position.array, geo.attributes.normal.array, nSI, nSW, op.M, nn, W2, WN2, nv);
    st.W = W2; st.WN = WN2; st.test = next; st.seed = null;
    return true;
  }
  const _rfA = [0, 0, 0], _rfB = [0, 0, 0];
  // (a, b) of a triangle's corners round the dish's centre
  function inTri2(a, b) {
    const d1 = a[0] * b[1] - b[0] * a[1], d2 = a[1] * b[2] - b[1] * a[2], d3 = a[2] * b[0] - b[2] * a[0];
    return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
  }
  function refineAll(geo, op) { const st = {}; for (let g = 0; g < REFINE_LEVELS && refineLevel(geo, op, st); g++) { /* level by level */ } return st; }

  /* pre: { W, WN } the posed body of the bite's instant for this very
     geometry (the job hands it in: no second pose) */
  function applyRemove(rec, geo, op, full, pre) {
    const pa = geo.attributes.position, P = pa.array, nv = pa.count;
    const N = geo.attributes.normal.array;
    const ca = geo.attributes.color, Cc = ca ? ca.array : null, cs = ca ? ca.itemSize : 3;
    const SI = geo.attributes.skinIndex.array, SW = geo.attributes.skinWeight.array;
    const M = op.M;
    let W, WN;
    if (pre && pre.W && pre.W.length === nv * 3) { W = pre.W; WN = pre.WN; }
    else { W = new Float32Array(nv * 3); WN = new Float32Array(nv * 3); poseSkinned(P, N, SI, SW, M, nv, W, WN); }
    const idx = geo.index ? geo.index.array : null;
    const nt = idx ? (idx.length / 3) | 0 : (nv / 3) | 0;
    const T3 = function (t, k) { return idx ? idx[t * 3 + k] : t * 3 + k; };
    const ud = geo.userData || (geo.userData = {});
    const wid = widOf(geo, P, nv);
    // the pieces of the body as they were (kept with the geometry until a
    // cut or a refinement changes them)
    let CP = ud.comp;
    if (!CP || CP.nv !== nv || CP.nt !== nt) {
      const par0 = ufNew(nv);
      for (let t = 0; t < nt; t++) {
        const a = T3(t, 0), b = T3(t, 1), c = T3(t, 2);
        if (a === b || b === c || a === c) continue;
        ufJoin(par0, wid[a], wid[b]); ufJoin(par0, wid[b], wid[c]);
      }
      const ct = new Map();
      for (let t = 0; t < nt; t++) {
        const a = T3(t, 0);
        if (a === T3(t, 1)) continue;
        const r = ufFind(par0, wid[a]);
        ct.set(r, (ct.get(r) || 0) + 1);
      }
      let h0 = -1, hN = -1;
      ct.forEach(function (n, r) { if (n > hN) { hN = n; h0 = r; } });
      CP = ud.comp = { nv: nv, nt: nt, par: par0, compTris: ct, hull: h0 };
    }
    const par = CP.par, compTris = CP.compTris, hull = CP.hull;
    const comp = function (v) { return ufFind(par, wid[v]); };
    // which vertices the jaw holds
    const C = op.C, S = op.S, U = op.U, F = op.F;
    const cls = new Uint8Array(nv), dep = new Float32Array(nv);
    let nIn = 0;
    for (let v = 0; v < nv; v++) {
      const dx = W[v * 3] - C[0], dy = W[v * 3 + 1] - C[1], dz = W[v * 3 + 2] - C[2];
      const a = (dx * S[0] + dy * S[1] + dz * S[2]) / op.rS, b = (dx * U[0] + dy * U[1] + dz * U[2]) / op.rU;
      const r2 = a * a + b * b;
      if (r2 >= 1.25) continue;
      const th = Math.atan2(b, a);
      const rs = 1 - op.scA * (0.5 + 0.5 * Math.cos(th * op.scN + op.scP));
      const r = Math.sqrt(r2);
      if (r >= rs) continue;
      const c = dx * F[0] + dy * F[1] + dz * F[2];
      const app = comp(v) !== hull;
      if (op.through || app) {
        if (c > -op.rF * 0.6 && c < op.rF * 1.05) { cls[v] = 2; nIn++; }
      } else {
        const q = r / rs, cf = op.rF * Math.sqrt(Math.max(0, 1 - q * q));
        const facing = WN[v * 3] * F[0] + WN[v * 3 + 1] * F[1] + WN[v * 3 + 2] * F[2];
        if (c < cf && c > -op.rF * 0.6 && facing < 0.35) { cls[v] = 1; dep[v] = cf - c; nIn++; }
      }
    }
    const out = full ? { removedTris: 0, severedTris: 0, pushed: 0, edged: 0, loops: [], chunk: [], sever: [], W: W, WN: WN, wid: wid } : null;
    if (!nIn) return out;
    // a dish narrower than the body's own triangles cannot be dug: the few
    // vertices inside it pushed in would dent a facet many times the bite's
    // size. Its floor is painted instead.
    if (!op.through && nIn < 10) {
      let cut2 = false;
      for (let v = 0; v < nv && !cut2; v++) if (cls[v] === 2) cut2 = true;
      if (!cut2) return out;
    }
    // triangles: 1 = taken by the jaw, 2 = severed with something that left
    const tcl = new Uint8Array(nt);
    let anyCut = false;
    for (let t = 0; t < nt; t++) {
      const a = T3(t, 0), b = T3(t, 1), c = T3(t, 2);
      if (a === b || b === c || a === c) { tcl[t] = 3; continue; }
      if (cls[a] === 2 && cls[b] === 2 && cls[c] === 2) { tcl[t] = 1; anyCut = true; }
    }
    // what is still attached to what
    if (anyCut) {
      const kp = ufNew(nv);
      const live = new Uint8Array(nv);
      for (let t = 0; t < nt; t++) {
        if (tcl[t]) continue;
        const a = wid[T3(t, 0)], b = wid[T3(t, 1)], c = wid[T3(t, 2)];
        ufJoin(kp, a, b); ufJoin(kp, b, c);
        live[a] = live[b] = live[c] = 1;
      }
      // the root of each piece: the vertex nearest the origin of the highest
      // bone that moves it (the spine's root for the hull, a fin's own root
      // bone or the spine bone it grows from, an ear's head, a tail's pelvis)
      const sk = rec.mesh.skeleton, bones = sk.bones;
      if (!rec.boneInfo) {
        const depth = [], org = [];
        for (let b = 0; b < bones.length; b++) {
          let d = 0, p = bones[b].parent;
          while (p && p.isBone && d < 64) { d++; p = p.parent; }
          depth.push(d);
          _pm.copy(sk.boneInverses[b]).invert().premultiply(_pm3.copy(rec.mesh.bindMatrix).invert());
          org.push([_pm.elements[12], _pm.elements[13], _pm.elements[14]]);
        }
        rec.boneInfo = { depth: depth, org: org };
      }
      const BI = rec.boneInfo;
      const topBone = new Map();
      for (let v = 0; v < nv; v++) {
        const r = comp(v);
        let tb = topBone.has(r) ? topBone.get(r) : -1;
        for (let k = 0; k < 4; k++) {
          if (SW[v * 4 + k] < 0.05) continue;
          const b = SI[v * 4 + k];
          if (tb < 0 || BI.depth[b] < BI.depth[tb]) tb = b;
        }
        topBone.set(r, tb);
      }
      const rootV = new Map(), rootD = new Map();
      for (let v = 0; v < nv; v++) {
        const r = comp(v), tb = topBone.get(r);
        if (tb == null || tb < 0) continue;
        const o = BI.org[tb];
        const d = (P[v * 3] - o[0]) * (P[v * 3] - o[0]) + (P[v * 3 + 1] - o[1]) * (P[v * 3 + 1] - o[1]) + (P[v * 3 + 2] - o[2]) * (P[v * 3 + 2] - o[2]);
        if (!rootD.has(r) || d < rootD.get(r)) { rootD.set(r, d); rootV.set(r, v); }
      }
      // the hull keeps the piece that holds its root
      const hv = rootV.get(hull);
      const hullKeep = hv != null && live[wid[hv]] ? ufFind(kp, wid[hv]) : -1;
      const attached = function (v) { return live[wid[v]] && ufFind(kp, wid[v]) === hullKeep; };
      let hullLost = false;
      for (let v = 0; v < nv; v++) if (comp(v) === hull && live[wid[v]] && !attached(v)) { hullLost = true; break; }
      // an appendage keeps the piece that holds its own root, and only while
      // that root still sits on the kept body
      const keepOf = new Map();
      const touched = new Map();
      for (let v = 0; v < nv; v++) if (cls[v] === 2) touched.set(comp(v), true);
      compTris.forEach(function (n, r) {
        if (r === hull) return;
        if (!touched.get(r) && !hullLost) { keepOf.set(r, -2); return; }   // untouched and its body is whole
        const rv = rootV.get(r);
        if (rv == null || !live[wid[rv]]) { keepOf.set(r, -1); return; }
        // where it grows from: the nearest hull vertex to its root
        let best = Infinity, bv = -1;
        for (let v = 0; v < nv; v++) {
          if (comp(v) !== hull) continue;
          const dx = P[v * 3] - P[rv * 3], dy = P[v * 3 + 1] - P[rv * 3 + 1], dz = P[v * 3 + 2] - P[rv * 3 + 2];
          const d = dx * dx + dy * dy + dz * dz;
          if (d < best) { best = d; bv = v; }
        }
        if (bv >= 0 && !attached(bv) && cls[bv] !== 1) { keepOf.set(r, -1); return; }
        keepOf.set(r, ufFind(kp, wid[rv]));
      });
      for (let t = 0; t < nt; t++) {
        if (tcl[t]) continue;
        const a = T3(t, 0), r = comp(a);
        let keep;
        if (r === hull) keep = attached(a);
        else {
          const k = keepOf.get(r);
          keep = k === -2 || (k >= 0 && ufFind(kp, wid[a]) === k);
        }
        if (!keep) tcl[t] = 2;
      }
    }
    // vertices a kept triangle still uses
    const used = new Uint8Array(nv);
    for (let t = 0; t < nt; t++) {
      if (tcl[t]) continue;
      used[T3(t, 0)] = used[T3(t, 1)] = used[T3(t, 2)] = 1;
    }
    // reshape
    const tis = tisLin(op.tis);
    const moved = new Uint8Array(nv);
    for (let v = 0; v < nv; v++) {
      if (!cls[v]) continue;
      const x = W[v * 3], y = W[v * 3 + 1], z = W[v * 3 + 2];
      if (cls[v] === 1) {
        // the crater floor, and the tissue of that depth
        const nx = x + F[0] * dep[v], ny = y + F[1] * dep[v], nz = z + F[2] * dep[v];
        setBind(P, SI, SW, v, M, nx, ny, nz);
        W[v * 3] = nx; W[v * 3 + 1] = ny; W[v * 3 + 2] = nz;
        if (Cc) {
          const dx = x - C[0], dy = y - C[1], dz = z - C[2];
          const a = (dx * S[0] + dy * S[1] + dz * S[2]) / op.rS, b = (dx * U[0] + dy * U[1] + dz * U[2]) / op.rU;
          const q = Math.min(1, Math.sqrt(a * a + b * b));
          tisCol(tis, Math.sqrt(Math.max(0, 1 - q * q)), _tc3);
          Cc[v * cs] = _tc3[0]; Cc[v * cs + 1] = _tc3[1]; Cc[v * cs + 2] = _tc3[2];
        }
        moved[v] = 1;
        if (out) out.pushed++;
      } else if (used[v]) {
        // the edge of the bite: out to the outline, raw
        const dx = x - C[0], dy = y - C[1], dz = z - C[2];
        const a = dx * S[0] + dy * S[1] + dz * S[2], b = dx * U[0] + dy * U[1] + dz * U[2], c = dx * F[0] + dy * F[1] + dz * F[2];
        const an = a / op.rS, bn = b / op.rU, r = Math.sqrt(an * an + bn * bn) || 1e-6;
        const th = Math.atan2(bn, an);
        const rs = 1 - op.scA * (0.5 + 0.5 * Math.cos(th * op.scN + op.scP));
        const k = rs / r;
        const nx = C[0] + S[0] * a * k + U[0] * b * k + F[0] * c, ny = C[1] + S[1] * a * k + U[1] * b * k + F[1] * c, nz = C[2] + S[2] * a * k + U[2] * b * k + F[2] * c;
        setBind(P, SI, SW, v, M, nx, ny, nz);
        W[v * 3] = nx; W[v * 3 + 1] = ny; W[v * 3 + 2] = nz;
        if (Cc) { tisCol(tis, 0.35, _tc3); Cc[v * cs] = _tc3[0]; Cc[v * cs + 1] = _tc3[1]; Cc[v * cs + 2] = _tc3[2]; }
        moved[v] = 1;
        if (out) out.edged++;
      }
    }
    // removed triangles leave the index (collapsed, so nothing is drawn)
    let cutN = 0;
    for (let t = 0; t < nt; t++) if (tcl[t] === 1 || tcl[t] === 2) cutN++;
    if (cutN) {
      ownIndex(geo);
      ud.comp = null;
      const I = geo.index.array;
      for (let t = 0; t < nt; t++) {
        if (tcl[t] !== 1 && tcl[t] !== 2) continue;
        const a = I[t * 3];
        I[t * 3 + 1] = a; I[t * 3 + 2] = a;
      }
      geo.index.needsUpdate = true;
    }
    // normals round everything that moved, welded across the colour cuts
    const aff = new Uint8Array(nv);
    for (let t = 0; t < nt; t++) {
      if (tcl[t]) continue;
      const a = T3(t, 0), b = T3(t, 1), c = T3(t, 2);
      if (moved[a] || moved[b] || moved[c]) aff[wid[a]] = aff[wid[b]] = aff[wid[c]] = 1;
    }
    const acc = new Float32Array(nv * 3);
    for (let t = 0; t < nt; t++) {
      if (tcl[t]) continue;
      const a = T3(t, 0), b = T3(t, 1), c = T3(t, 2);
      const wa = wid[a], wb = wid[b], wc = wid[c];
      if (!(aff[wa] || aff[wb] || aff[wc])) continue;
      const e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2];
      const e2x = P[c * 3] - P[a * 3], e2y = P[c * 3 + 1] - P[a * 3 + 1], e2z = P[c * 3 + 2] - P[a * 3 + 2];
      const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
      const W3 = [wa, wb, wc];
      for (let k = 0; k < 3; k++) { const o = W3[k] * 3; acc[o] += fx; acc[o + 1] += fy; acc[o + 2] += fz; }
    }
    for (let v = 0; v < nv; v++) {
      const w = wid[v];
      if (!aff[w]) continue;
      const o = w * 3, l = Math.hypot(acc[o], acc[o + 1], acc[o + 2]);
      if (l < 1e-12) continue;
      N[v * 3] = acc[o] / l; N[v * 3 + 1] = acc[o + 1] / l; N[v * 3 + 2] = acc[o + 2] / l;
    }
    ud.dug = true;
    pa.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    if (ca) ca.needsUpdate = true;
    if (!out) return out;
    // ---- at the bite: the cut's loops, and what left
    if (cutN) {
      // an edge is a NEW open edge when it bounded a kept triangle and a
      // removed one (an old open edge of the model — a mouth, a socket — is
      // not a wound)
      const kept = new Map(), gone = new Map();
      for (let t = 0; t < nt; t++) {
        if (tcl[t] === 3) continue;
        const a = T3(t, 0), b = T3(t, 1), c = T3(t, 2);
        const E = [[a, b], [b, c], [c, a]];
        for (let k = 0; k < 3; k++) {
          const key = eKey(wid[E[k][0]], wid[E[k][1]]);
          if (tcl[t]) gone.set(key, (gone.get(key) || 0) + 1);
          else kept.set(key, E[k]);
        }
      }
      // directed boundary of the kept side: a -> b as the kept triangle winds
      const next = new Map(), vOf = new Map();
      kept.forEach(function (e, key) {
        if (!gone.has(key)) return;
        next.set(wid[e[0]], wid[e[1]]);
        vOf.set(wid[e[0]], e[0]); vOf.set(wid[e[1]], e[1]);
      });
      const seen = new Set();
      next.forEach(function (_, start) {
        if (seen.has(start)) return;
        const loop = [];
        let w = start, guard = 0;
        while (w != null && !seen.has(w) && guard++ < 4096) { seen.add(w); loop.push(vOf.get(w)); w = next.get(w); }
        if (loop.length >= 3 && w === start) out.loops.push(loop);
      });
      for (let t = 0; t < nt; t++) {
        if (tcl[t] === 1) { out.chunk.push(T3(t, 0), T3(t, 1), T3(t, 2)); out.removedTris++; }
        else if (tcl[t] === 2) { out.sever.push(T3(t, 0), T3(t, 1), T3(t, 2)); out.severedTris++; }
      }
    }
    return out;
  }

  /* ---- THE PIECE THAT LEFT, built from the triangles that left ------------
     The body's own surface at the instant of the bite (posed, world), with
     every attribute its material reads (colour, the sea's spec and mark
     channels, the fur flow), and its torn ends closed with raw tissue. */
  function pieceGeo(geo, tris, W, WN, wid, tis) {
    if (!tris || tris.length < 9) return null;
    const remap = new Map(), verts = [];
    for (let i = 0; i < tris.length; i++) if (!remap.has(tris[i])) { remap.set(tris[i], verts.length); verts.push(tris[i]); }
    // its own open ends (edges used once among its triangles that were
    // closed on the whole body)
    const cnt = new Map(), dir = new Map();
    for (let t = 0; t < tris.length; t += 3) {
      const E = [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]];
      for (let k = 0; k < 3; k++) {
        const key = eKey(wid[E[k][0]], wid[E[k][1]]);
        cnt.set(key, (cnt.get(key) || 0) + 1);
        dir.set(key, E[k]);
      }
    }
    const next = new Map(), vOf = new Map();
    cnt.forEach(function (n, key) {
      if (n !== 1) return;
      const e = dir.get(key);
      next.set(wid[e[0]], wid[e[1]]); vOf.set(wid[e[0]], e[0]); vOf.set(wid[e[1]], e[1]);
    });
    const loops = [], seen = new Set();
    next.forEach(function (_, start) {
      if (seen.has(start) || loops.length > 6) return;
      const loop = [];
      let w = start, guard = 0;
      while (w != null && !seen.has(w) && guard++ < 2048) { seen.add(w); loop.push(vOf.get(w)); w = next.get(w); }
      if (loop.length >= 3 && w === start) loops.push(loop);
    });
    let capV = 0;
    for (let i = 0; i < loops.length; i++) capV += loops[i].length + 1;
    const nV = verts.length + capV;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < verts.length; i++) { cx += W[verts[i] * 3]; cy += W[verts[i] * 3 + 1]; cz += W[verts[i] * 3 + 2]; }
    cx /= verts.length; cy /= verts.length; cz /= verts.length;
    const out = new THREE.BufferGeometry();
    const pos = new Float32Array(nV * 3), nrm = new Float32Array(nV * 3);
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      pos[i * 3] = W[v * 3] - cx; pos[i * 3 + 1] = W[v * 3 + 1] - cy; pos[i * 3 + 2] = W[v * 3 + 2] - cz;
      nrm[i * 3] = WN[v * 3]; nrm[i * 3 + 1] = WN[v * 3 + 1]; nrm[i * 3 + 2] = WN[v * 3 + 2];
    }
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    const T = tisLin(tis);
    for (const k in geo.attributes) {
      if (k === "position" || k === "normal" || k === "skinIndex" || k === "skinWeight") continue;
      const A = geo.attributes[k];
      if (A.isInterleavedBufferAttribute) continue;
      const s = A.itemSize, arr = new A.array.constructor(nV * s);
      for (let i = 0; i < verts.length; i++) for (let j = 0; j < s; j++) arr[i * s + j] = A.array[verts[i] * s + j];
      out.setAttribute(k, new THREE.BufferAttribute(arr, s, A.normalized));
    }
    const ix = [];
    for (let t = 0; t < tris.length; t++) ix.push(remap.get(tris[t]));
    // close each torn end with its cross-section: muscle in the middle,
    // the skin's own layers round the rim
    let o = verts.length;
    const colA = out.attributes.color;
    for (let l = 0; l < loops.length; l++) {
      const L = loops[l];
      let lx = 0, ly = 0, lz = 0;
      for (let i = 0; i < L.length; i++) { lx += W[L[i] * 3]; ly += W[L[i] * 3 + 1]; lz += W[L[i] * 3 + 2]; }
      lx /= L.length; ly /= L.length; lz /= L.length;
      let fx = 0, fy = 0, fz = 0;
      for (let i = 0; i < L.length; i++) {
        const a = L[i], b = L[(i + 1) % L.length];
        const ax = W[a * 3] - lx, ay = W[a * 3 + 1] - ly, az = W[a * 3 + 2] - lz, bx = W[b * 3] - lx, by = W[b * 3 + 1] - ly, bz = W[b * 3 + 2] - lz;
        fx += ay * bz - az * by; fy += az * bx - ax * bz; fz += ax * by - ay * bx;
      }
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= -fl; fy /= -fl; fz /= -fl;
      const base = o;
      for (let i = 0; i < L.length; i++) {
        const v = L[i];
        pos[o * 3] = W[v * 3] - cx; pos[o * 3 + 1] = W[v * 3 + 1] - cy; pos[o * 3 + 2] = W[v * 3 + 2] - cz;
        nrm[o * 3] = fx; nrm[o * 3 + 1] = fy; nrm[o * 3 + 2] = fz;
        if (colA) { tisCol(T, 0.3, _tc3); const s = colA.itemSize; colA.array[o * s] = _tc3[0]; colA.array[o * s + 1] = _tc3[1]; colA.array[o * s + 2] = _tc3[2]; }
        o++;
      }
      pos[o * 3] = lx - cx; pos[o * 3 + 1] = ly - cy; pos[o * 3 + 2] = lz - cz;
      nrm[o * 3] = fx; nrm[o * 3 + 1] = fy; nrm[o * 3 + 2] = fz;
      if (colA) { tisCol(T, 0.95, _tc3); const s = colA.itemSize; colA.array[o * s] = _tc3[0]; colA.array[o * s + 1] = _tc3[1]; colA.array[o * s + 2] = _tc3[2]; }
      const ctr = o; o++;
      for (let i = 0; i < L.length; i++) ix.push(base + ((i + 1) % L.length), base + i, ctr);
    }
    out.setIndex(ix);
    out.computeBoundingSphere();
    out.userData.cbzPieceAt = [cx, cy, cz];
    return out;
  }

  /* ---- WHO BIT ------------------------------------------------------------
     Callers pass `by` = the attacker's species id (a string; a dog is
     "dog:<breed>") and `byActor` = the attacker. Older callers pass the actor
     itself as `by`. Both are read: the actor from byActor, or from by when it
     is an object; the species from by when it is a string, else off the
     actor. */
  function biterOf(opts) {
    let a = opts && opts.byActor && typeof opts.byActor === "object" ? opts.byActor : null;
    if (!a && opts && opts.by && typeof opts.by === "object") a = opts.by;
    let sid = opts && typeof opts.by === "string" ? opts.by : "";
    if (!sid && a) {
      const ud = a.group && a.group.userData;
      const rig = ud && ud.canidRig;
      if (rig && CBZ.canid && typeof CBZ.canid.biteId === "function") { try { sid = CBZ.canid.biteId(rig) || ""; } catch (e) { sid = ""; } }
      if (!sid) sid = (a.species && a.species.id) || (ud && ud.canid && ud.canid.id) || "";
    }
    return { actor: a, sid: sid };
  }
  // the arch, from systems/dentition.js; a minimal generic one if it is absent
  function dentOf(who, jaw) {
    if (CBZ.dentition && typeof CBZ.dentition.of === "function") {
      try { const d = CBZ.dentition.of(who.sid, who.actor, jaw); if (d && d.teeth) return d; } catch (e) {}
    }
    const j = Math.max(0.02, jaw || 0.05), T = [];
    const tooth = function (up, s, x, L, W, kind) { T.push({ up: up, s: s, x: x, L: L, W: W, kind: kind }, { up: up, s: -s, x: x, L: L, W: W, kind: kind }); };
    tooth(true, j * 0.42, j * 0.35, j * 0.55, j * 0.17, "canine"); tooth(false, j * 0.36, j * 0.42, j * 0.45, j * 0.14, "canine");
    tooth(true, j * 0.12, 0, j * 0.18, j * 0.08, "incisor"); tooth(true, j * 0.26, j * 0.04, j * 0.18, j * 0.08, "incisor");
    return { family: "generic", sid: who.sid, k: 1, hw: j * 0.45, depth: j * 1.2, gape: j * 1.6, pinch: j * 0.5, jawRef: j, teeth: T,
      removes: 0.05, shake: 0.7, saw: 0, rake: 0.15, crush: 0.4, slice: 0, deep: 0.8 };
  }

  // ---- THE BITTEN BODY ------------------------------------------------------
  function skinOk(m) {
    if (!m || !m.isMesh || m.isInstancedMesh || m.visible === false) return false;
    if (m._tornCap || m._cbzPiece || (m.userData && (m.userData.cbzSkinMark || m.userData.interior))) return false;
    const g = m.geometry;
    if (!g || !g.attributes || !g.attributes.position || !g.attributes.normal) return false;
    if (g.morphAttributes && g.morphAttributes.position && g.morphAttributes.position.length) return false;
    const mt = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!mt || mt.transparent || mt.isSpriteMaterial) return false;
    return true;
  }
  const _ts = new THREE.Sphere();
  function nearP(m, x, y, z, r) {
    const g = m.geometry;
    if (!g) return false;
    if (m.isSkinnedMesh && m.boundingSphere) _ts.copy(m.boundingSphere);
    else { if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingSphere) return false; _ts.copy(g.boundingSphere); }
    _ts.applyMatrix4(m.matrixWorld);
    const dx = _ts.center.x - x, dy = _ts.center.y - y, dz = _ts.center.z - z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) <= _ts.radius + r;
  }
  // how far a point is outside a part's bounding sphere (negative inside)
  function sphereGap(m, x, y, z) {
    const g = m.geometry;
    if (!g) return Infinity;
    if (m.isSkinnedMesh && m.boundingSphere) _ts.copy(m.boundingSphere);
    else { if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingSphere) return Infinity; _ts.copy(g.boundingSphere); }
    _ts.applyMatrix4(m.matrixWorld);
    return Math.hypot(_ts.center.x - x, _ts.center.y - y, _ts.center.z - z) - _ts.radius;
  }
  // which region of a person a part is (its skinSlots list), for the limp and
  // for what a big enough mouth can take off
  function regionOf(actor, mesh) {
    const S = actor.char && actor.char.skinSlots;
    if (!S) return "torso";
    for (let k = 0, m = mesh; k < 3 && m; k++, m = m.parent) {
      if (S.head && S.head.indexOf(m) >= 0) return "head";
      if ((S.arms && S.arms[0] === m) || (S.armsLower && S.armsLower[0] === m) || (S.hands && S.hands[0] === m)) return "armL";
      if ((S.arms && S.arms[1] === m) || (S.armsLower && S.armsLower[1] === m) || (S.hands && S.hands[1] === m)) return "armR";
      if ((S.legs && S.legs[0] === m) || (S.legsLower && S.legsLower[0] === m)) return "legL";
      if ((S.legs && S.legs[1] === m) || (S.legsLower && S.legsLower[1] === m)) return "legR";
    }
    return "torso";
  }
  // every part of a person the jaw's reach can touch, and any garment worn
  // over them, the NEAREST eight (a bite at the throat is the collar's and
  // the neck's, not the first eight limbs in the rig's list); each knows
  // whether it is cloth or skin
  function personSurfaces(actor, wp, R, headOnly) {
    const S = actor.char.skinSlots, cand = [], seen = [];
    const keys = headOnly ? ["head"] : ["armsLower", "arms", "legsLower", "legs", "torso", "pelvis", "head", "hands", "collar"];
    const consider = function (m, garment) {
      if (!m || seen.indexOf(m) >= 0 || !skinOk(m) || m.isSkinnedMesh) return;
      seen.push(m);
      const d = sphereGap(m, wp.x, wp.y, wp.z);
      if (!(d <= R)) return;
      cand.push({ m: m, garment: garment, d: d });
    };
    for (let k = 0; k < keys.length; k++) {
      const L = S[keys[k]];
      if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const m = L[i];
        consider(m, false);
        if (m && m.children) for (let j = 0; j < m.children.length; j++) consider(m.children[j], true);
      }
    }
    cand.sort(function (a, b) { return a.d - b.d; });
    const out = [];
    for (let i = 0; i < cand.length && out.length < 8; i++) {
      const c = cand[i], s2 = surfaceOf(c.m, out.length);
      if (!s2) continue;
      s2.region = regionOf(actor, c.m);
      s2.cloth = c.garment || (realOn() && clothedPart(actor, c.m, s2.region));
      out.push(s2);
    }
    return out;
  }
  // an animal: its one skinned body, or the parts of a rigid one (not its
  // eyes, teeth, gill slits and the rest of the detail on it)
  function animalSurfaces(actor, wp, R) {
    const grp = actor.group, out = [], kids = [];
    grp.traverse(function (o) { if (o !== grp && o.isMesh && kids.length < 64) kids.push(o); });
    let big = 0;
    const rad = [];
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i];
      let r = 0;
      if (skinOk(m)) {
        const g = m.geometry;
        if (m.isSkinnedMesh && m.boundingSphere) r = m.boundingSphere.radius;
        else { if (!g.boundingSphere) g.computeBoundingSphere(); r = g.boundingSphere ? g.boundingSphere.radius : 0; }
        const e = m.matrixWorld.elements;
        r *= Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) || 1;
      }
      rad.push(r);
      if (r > big) big = r;
    }
    for (let i = 0; i < kids.length && out.length < 8; i++) {
      const m = kids[i];
      if (!(rad[i] > 0) || rad[i] < big * 0.06) continue;
      if (!nearP(m, wp.x, wp.y, wp.z, R)) continue;
      const s = surfaceOf(m, out.length);
      if (s) out.push(s);
    }
    return out;
  }
  // what the victim is made of
  function tissueOf(actor, kind) {
    if (kind === "person") return "mammal";
    const ud = actor.group && actor.group.userData, mb = ud && ud.marineBody;
    const id = actor.species && actor.species.id;
    if (mb) {
      if (mb.plan === "vertical") return "cetacean";
      const sp = mb.tpl && mb.tpl.spec;
      if ((sp && sp.sharkLike) || mb.plan === "flap") return "shark";
      if (mb.plan === "flipper") return "mammal";       // a turtle's meat is dark red
      if (id === "tuna" || id === "marlin") return "redfish";
      return "fish";
    }
    return "mammal";
  }
  // what covers it: fur mats and parts, bare skin takes a wet film and runs
  function coatOf(actor, kind) {
    if (kind === "person") return "skin";
    const ud = actor.group && actor.group.userData, sp = actor.species;
    const mb = ud && ud.marineBody;
    if (mb) {
      const spec = mb.tpl && mb.tpl.spec;
      if (mb.plan === "vertical" || (spec && spec.sharkLike) || mb.plan === "flap" || mb.plan === "flipper") return "skin";
      return "scales";                                  // a bony fish
    }
    if (ud && (ud.canidRig || ud.canid)) return "fur";
    if (sp && sp.snake) return "scales";
    if (sp && sp.aquatic) return "skin";
    if (sp && /elephant|rhino|pig|hippo|chicken|turtle/.test(sp.id || "")) return "skin";
    return "fur";
  }
  // the attacker's head: up, from its own body when we have it
  const _hx = { fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, sx: 0, sy: 0, sz: 1 };
  function headUp(a, out) {
    const g = a && a.group;
    if (!g) return false;
    try {
      if (g.userData && g.userData.marineBody && typeof CBZ.marineHeadAxes === "function" && CBZ.marineHeadAxes(g, _hx)) { out.set(_hx.ux, _hx.uy, _hx.uz); return true; }
      const rig = g.userData && g.userData.canidRig;
      const hb = rig && rig.bones && CBZ.canid && CBZ.canid.BN ? rig.bones[CBZ.canid.BN.head] : null;
      if (hb) { hb.updateWorldMatrix(true, false); const e = hb.matrixWorld.elements; out.set(e[4], e[5], e[6]).normalize(); return true; }
      g.updateWorldMatrix(true, false);
      const e = g.matrixWorld.elements;
      out.set(e[4], e[5], e[6]).normalize();
      return out.lengthSq() > 0.5;
    } catch (e) { return false; }
  }
  // the colour a flap of this part wears outside (garment or coat)
  function hostColour(S, h, out) {
    let m = S.mesh.material;
    if (Array.isArray(m)) m = m[0];
    let r = 1, g = 1, b = 1;
    if (m && m.color) { r = m.color.r; g = m.color.g; b = m.color.b; }
    const ca = S.geo.attributes.color;
    if (ca && m && m.vertexColors && !ca.isInterleavedBufferAttribute) {
      const s = ca.itemSize, A = ca.array;
      r *= A[h.i0 * s] * h.b0 + A[h.i1 * s] * h.b1 + A[h.i2 * s] * h.b2;
      g *= A[h.i0 * s + 1] * h.b0 + A[h.i1 * s + 1] * h.b1 + A[h.i2 * s + 1] * h.b2;
      b *= A[h.i0 * s + 2] * h.b0 + A[h.i1 * s + 2] * h.b1 + A[h.i2 * s + 2] * h.b2;
    }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }
  function deepKind(k) { return k === "canine" || k === "fang" || k === "tusk" || k === "cone" || k === "needle"; }
  function pickTeeth(T, max) {
    if (T.length <= max) return T;
    const keep = [], rest = [];
    for (let i = 0; i < T.length; i++) (deepKind(T[i].kind) && T[i].L > T[i].W ? keep : rest).push(T[i]);
    const room = Math.max(0, max - keep.length), step = rest.length / Math.max(1, room);
    for (let i = 0; i < room && i * step < rest.length; i++) keep.push(rest[Math.floor(i * step)]);
    return keep;
  }

  /* ---- THE STRIKE --------------------------------------------------------- */
  const _P = new THREE.Vector3(), _N = new THREE.Vector3(), _F = new THREE.Vector3(), _U = new THREE.Vector3(), _S = new THREE.Vector3();
  const _U0 = new THREE.Vector3(), _O = new THREE.Vector3(), _T0 = new THREE.Vector3(), _tr = new THREE.Vector3(), _trT = new THREE.Vector3();
  const _mid = new THREE.Vector3(), _gv = new THREE.Vector3(), _tq = new THREE.Vector3();
  const _H0 = hitRec(), _H1 = hitRec(), _H2 = hitRec(), _HS = hitRec();
  function copyHit(h) { return { S: h.S, t: h.t, i0: h.i0, i1: h.i1, i2: h.i2, b0: h.b0, b1: h.b1, b2: h.b2, px: h.px, py: h.py, pz: h.pz, nx: h.nx, ny: h.ny, nz: h.nz }; }
  // the line the jaw came in on: opts.dir, else attacker -> point
  function attackLine(opts, wp, out) {
    const d = opts.dir;
    if (d && isFinite(d.x) && isFinite(d.y) && isFinite(d.z)) {
      out.set(d.x || 0, d.y || 0, d.z || 0);
      if (out.lengthSq() > 1e-8) { out.normalize(); return true; }
    }
    if (opts.fromX != null && opts.fromZ != null) {
      out.set(wp.x - opts.fromX, 0, wp.z - opts.fromZ);
      if (out.lengthSq() > 0.0025) { out.normalize(); return true; }
    }
    return false;
  }
  // tangent of v on the skin at normal n (unit), or null
  function onSkin(vx, vy, vz, n, out) {
    const k = vx * n.x + vy * n.y + vz * n.z;
    out.set(vx - n.x * k, vy - n.y * k, vz - n.z * k);
    if (out.lengthSq() < 1e-8) return null;
    return out.normalize();
  }
  function hN(h) { return _tq.set(h.nx, h.ny, h.nz); }

  /* The whole bite: seat, frame, strike every tooth, lay what each leaves,
     take flesh where the mouth takes flesh, blood, and build the meshes.
     kind: "person" | "animal". Returns { made, lead, wet, region, P, removed,
     severed, strikes } or { why } when nothing could be laid. */
  /* A body that keeps a light far shell on the same skeleton (a marine body,
     a canid) is bitten on its full shell. Marks laid on the far shell's
     coarse facets stand centimetres off the round near shell once it is
     back, and a long rake laid straight across a facet sticks out into the
     water where the real skin curves away from it (the orca's rakes on a
     megalodon bitten before its LOD caught up with the eye). A bite is close
     enough to matter: the near shell is shown now, through the body's own
     state; its own LOD check swaps it back if the eye is far, where the
     marks being a few centimetres off a far shell cannot be seen. */
  function finestShell(actor) {
    const ud = actor.group && actor.group.userData;
    if (!ud) return;
    const mb = ud.marineBody;
    if (mb && mb.mesh && mb.tpl && mb.tpl.geo && mb.tpl.geo.length > 1) {
      if ((mb.lod || 0) !== 0) {
        mb.mesh.geometry = mb.tpl.geo[0];
        mb.lod = 0;
        const rig = actor.swim;
        if (rig && rig.marine === mb) { rig.lod = 0; rig.lodT = Math.max(rig.lodT || 0, 0.3); }
      }
      return;
    }
    const cr = ud.canidRig;
    if (cr && cr.lod && CBZ.canid && typeof CBZ.canid.collar === "function") {
      cr.lod = 0;
      try { CBZ.canid.collar(cr, cr.collarHex); } catch (e) {}
      cr.lodT = Math.max(cr.lodT || 0, 0.4);
    }
  }
  function runBite(actor, wp, opts, kind, who, dent, sev) {
    const grp = actor.group;
    if (kind === "animal") finestShell(actor);
    freshMats(grp, actor._mOn === false);
    const span = Math.max(dent.hw, dent.depth) + dent.gape;
    const R = span * 1.15 + 0.08;
    const surfs = kind === "person" ? personSurfaces(actor, wp, R + 0.25, !!opts.head) : animalSurfaces(actor, wp, R + 0.5);
    if (!surfs.length) return { why: "no-surface" };
    let nc = 0;
    for (let i = 0; i < surfs.length; i++) { surfacePose(surfs[i]); nc += surfaceNear(surfs[i], wp.x, wp.y, wp.z, R); }
    if (!nc) return { why: "no-skin-near" };
    const bite = {
      actor: actor, surfs: surfs, bufs: Object.create(null), keys: [], dent: dent, sev: sev, who: who, kind: kind,
      tissue: tissueOf(actor, kind), coat: coatOf(actor, kind), wet: false, seatS: null, made: 0, removed: 0, severed: 0,
      els: [], strikes: null, ext: null, fold: 0,
    };
    // ---- THE SEAT: the first skin on the jaw's line, or the nearest skin
    const have = attackLine(opts, wp, _tr);
    let h = null;
    if (have && !opts.head) {
      h = castAll(surfs, wp.x - _tr.x * R, wp.y - _tr.y * R, wp.z - _tr.z * R, _tr.x, _tr.y, _tr.z, R * 2, 1, _H0);
      if (h && Math.hypot(h.px - wp.x, h.py - wp.y, h.pz - wp.z) > R * 0.6) h = null;
    }
    if (!h) h = nearestAll(surfs, wp.x, wp.y, wp.z, _H0);
    if (!h) return { why: "no-seat" };
    const seat = copyHit(h);
    bite.seatS = seat.S;
    _P.set(seat.px, seat.py, seat.pz); _N.set(seat.nx, seat.ny, seat.nz);
    bite.wet = typeof CBZ.goreMedium === "function" && (function () { try { return CBZ.goreMedium(_P.x, _P.y, _P.z) === "water"; } catch (e) { return false; } })();
    // ---- THE MOUTH'S FRAME: F into the body, U the head's up, S across
    if (have) {
      const dn = _tr.dot(_N);
      if (dn < -0.25) _F.copy(_tr); else _F.copy(_tr).multiplyScalar(0.35).sub(_N).normalize();
    } else _F.copy(_N).negate();
    const trav = have ? onSkin(_tr.x, _tr.y, _tr.z, _N, _trT) : null;
    if (!headUp(who.actor, _U0)) _U0.set(0, 1, 0);
    // how far the jaw's line runs through the part before it leaves it
    const ex = castAll(surfs, _P.x + _F.x * 1e-4, _P.y + _F.y * 1e-4, _P.z + _F.z * 1e-4, _F.x, _F.y, _F.z, dent.gape * 2 + dent.depth, -1, _H1);
    const thickF = ex ? ex.t : Infinity;
    // the jaws open along the head's own up: what lies between them is what
    // they close on
    _S.crossVectors(_F, _U0);
    if (_S.lengthSq() < 1e-4) _S.crossVectors(_F, _gv.set(1, 0, 0));
    _S.normalize();
    _U.crossVectors(_S, _F).normalize();
    if (_U.dot(_U0) < 0) { _U.negate(); _S.negate(); }
    // ---- DOES THE PART FIT BETWEEN THE JAWS? Its own extent along their
    // closing, and nothing of the body past it within the gape: a thigh runs
    // on into the hip and the knee, and no jaw closes round that
    _mid.copy(_P).addScaledVector(_F, Math.min(isFinite(thickF) ? thickF * 0.5 : dent.gape * 0.5, dent.gape * 0.5));
    const up = castAll(surfs, _mid.x, _mid.y, _mid.z, _U.x, _U.y, _U.z, dent.gape, -1, _H1);
    const upT = up ? up.t : Infinity;
    const dnH = castAll(surfs, _mid.x, _mid.y, _mid.z, -_U.x, -_U.y, -_U.z, dent.gape, -1, _H2);
    const dnT = dnH ? dnH.t : Infinity;
    let wrap = isFinite(upT) && isFinite(dnT) && upT + dnT < dent.gape * 0.98 && thickF < dent.gape * 1.6 + dent.depth;
    if (wrap) {
      // a limb lying along the closing (a hanging arm, a standing leg, a
      // neck) is longer that way than across: its ends sit inside the next
      // part, and the jaws take its flank
      const sl = castAll(surfs, _mid.x, _mid.y, _mid.z, _S.x, _S.y, _S.z, dent.gape, -1, _H1);
      const sr = castAll(surfs, _mid.x, _mid.y, _mid.z, -_S.x, -_S.y, -_S.z, dent.gape, -1, _H2);
      const across = (sl ? sl.t : dent.gape) + (sr ? sr.t : dent.gape);
      if (upT + dnT > across * 1.3) wrap = false;
    }
    if (wrap) {
      // and nothing of the body past its ends within the gape: not another
      // part's outside, nor the inside of one its end is sunk in (a limb's
      // end sits inside the shoulder, the hip)
      const room = dent.gape - (upT + dnT) + 0.01, e = 0.003, seatM = seat.S.mesh;
      const others = surfs.filter(function (S) { return S !== seat.S && S.mesh.parent !== seatM && seatM.parent !== S.mesh; });
      if (castAll(others, _mid.x + _U.x * (upT + e), _mid.y + _U.y * (upT + e), _mid.z + _U.z * (upT + e), _U.x, _U.y, _U.z, room, 0, _H1) ||
        castAll(others, _mid.x - _U.x * (dnT + e), _mid.y - _U.y * (dnT + e), _mid.z - _U.z * (dnT + e), -_U.x, -_U.y, -_U.z, room, 0, _H2) ||
        castAll([seat.S], _mid.x + _U.x * (upT + e), _mid.y + _U.y * (upT + e), _mid.z + _U.z * (upT + e), _U.x, _U.y, _U.z, room, 1, _H1) ||
        castAll([seat.S], _mid.x - _U.x * (dnT + e), _mid.y - _U.y * (dnT + e), _mid.z - _U.z * (dnT + e), -_U.x, -_U.y, -_U.z, room, 1, _H2)) wrap = false;
    }
    const partU = wrap ? upT + dnT : 0;
    // ---- PLACE THE ARCH
    // every tooth of a shark's functional rows (24 + 22); a dolphin's eighty
    // needles thinned to as many
    const teeth = pickTeeth(dent.teeth, 48);
    let Lfront = 0, xGrip = 0, ng = 0, Lmax = 0, Wavg = 0, Lg = 0;
    for (let i = 0; i < teeth.length; i++) {
      const t = teeth[i];
      if (t.L > Lmax) Lmax = t.L;
      Wavg += t.W;
      if (t.x < dent.depth * 0.3 && t.L > Lfront) Lfront = t.L;
      if (deepKind(t.kind) && t.up) { xGrip += t.x; Lg += t.L; ng++; }
    }
    Wavg /= Math.max(1, teeth.length);
    if (!Lfront) Lfront = Lmax;
    xGrip = ng ? xGrip / ng : dent.depth * 0.35;
    Lg = ng ? Lg / ng : Lfront;
    // THE FOLD. On the flank the flesh the jaws close on bulges into the
    // mouth: to the gripping teeth and a little past them, further the
    // harder the bite. A tooth behind the fold's back edge never touches
    // it; the rest meet it where it reaches them, and when it lies flat again
    // the upper arch's teeth sit on an arc above the bite's middle and the
    // lower arch's on one below (the two arcs of every bite mark), the front
    // teeth furthest out. The arcs are as wide as the arch is at the fold's
    // depth, and a little less tall than wide.
    let fold = (xGrip + 0.45 * Lg) * (0.8 + 0.4 * sev);
    fold = Math.min(fold, dent.depth * 0.6 + Lfront * 0.5);
    if (isFinite(thickF)) fold = Math.min(fold, Math.max(thickF * 0.8, Lfront));
    const KF = 0.6, bMin = 0.15 * Lg;
    // a thin part (a fin, an ear, a fluke) is in the mouth whole: no fold
    // limits it, and the jaws meet it as far apart as they are when they
    // close on it
    const thinPart = isFinite(thickF) && thickF < Lmax * 1.4;
    const foldX = thinPart ? Math.max(fold, dent.depth * 0.5) : fold;
    const bThin = thinPart ? 0.5 * dent.pinch * (0.8 + 0.4 * sev) : 0;
    let g = 0;
    if (wrap) {
      _O.copy(_mid).addScaledVector(_U, (upT - dnT) * 0.5).addScaledVector(_F, xGrip);
      g = partU + Lmax * 0.8;
    }
    // ---- EVERY TOOTH ALONG ITS PATH, AND HOW FAR IT WENT IN
    const strikes = [];
    const back = dent.gape + dent.depth + 0.25, reach = Math.max(0.05, Lmax * 2 + foldX);
    for (let i = 0; i < teeth.length; i++) {
      const t = teeth[i], ux = t.up ? 1 : -1;
      let s = null, contact = 1;
      if (wrap) {
        _T0.copy(_O).addScaledVector(_S, t.s).addScaledVector(_F, -t.x).addScaledVector(_U, ux * g * 0.5);
        s = castAll(surfs, _T0.x, _T0.y, _T0.z, -ux * _U.x, -ux * _U.y, -ux * _U.z, g * 0.5 + t.L * 0.8, 1, _HS);
      } else {
        if (t.x > foldX) continue;
        contact = Math.max(0.25, Math.min(1, (foldX - t.x) / (0.35 * foldX)));
        const b = ux * Math.max((foldX - t.x) * KF + bMin, bThin);
        _T0.copy(_P).addScaledVector(_S, t.s).addScaledVector(_U, b);
        s = castAll(surfs, _T0.x - _F.x * reach, _T0.y - _F.y * reach, _T0.z - _F.z * reach, _F.x, _F.y, _F.z, reach + Math.max(0.05, foldX) + dent.depth * 0.6, 1, _HS);
      }
      if (!s) continue;
      const st = copyHit(s);
      st.t = t; st.ux = ux;
      // how far it went in: the bite's force, where it met the fold, and
      // the luck of where it landed (no two holes alike)
      st.pen = Math.min(1.3, (0.55 + 0.6 * sev) * contact * (0.7 + 0.6 * Math.random()));
      // the way the close drags it through the skin
      st.drag = onSkin(-ux * _U.x, -ux * _U.y, -ux * _U.z, hN(st), new THREE.Vector3()) || onSkin(_S.x, _S.y, _S.z, hN(st), new THREE.Vector3()) || new THREE.Vector3(1, 0, 0);
      strikes.push(st);
    }
    if (!strikes.length) {
      // nothing reached: the lunge still met the skin at the seat
      const st = copyHit(seat);
      st.t = teeth[0] || { up: true, s: 0, x: 0, L: dent.hw * 0.3, W: dent.hw * 0.2, kind: "canine" };
      st.ux = 1; st.pen = 0.6 + 0.4 * sev;
      st.drag = onSkin(_U.x, _U.y, _U.z, _N, new THREE.Vector3()) || new THREE.Vector3(1, 0, 0);
      strikes.push(st);
    }
    bite.strikes = strikes;
    bite.fold = wrap ? 0 : fold;
    // the strikes' spread round the seat, in the jaw's own axes
    let aMin = Infinity, aMax = -Infinity, bMin2 = Infinity, bMax = -Infinity;
    for (let i = 0; i < strikes.length; i++) {
      const st = strikes[i], dx = st.px - _P.x, dy = st.py - _P.y, dz = st.pz - _P.z;
      const a = dx * _S.x + dy * _S.y + dz * _S.z, b = dx * _U.x + dy * _U.y + dz * _U.z;
      if (a < aMin) aMin = a; if (a > aMax) aMax = a; if (b < bMin2) bMin2 = b; if (b > bMax) bMax = b;
    }
    bite.ext = { aMin: aMin, aMax: aMax, bMin: bMin2, bMax: bMax, Wavg: Wavg, Lmax: Lmax };

    // ---- FLESH THAT GOES WITH THE MOUTH (a body that owns its geometry)
    const seatS = seat.S;
    let removalOp = null;
    if (seatS.skinned && kind === "animal") {
      const thin = isFinite(thickF) && thickF < Lmax * 1.4 && (dent.removes >= 0.3 || dent.shake * sev >= 0.5);
      const engulf = wrap && dent.removes >= 0.5 && sev >= 0.55 && isFinite(thickF) && thickF < dent.gape;
      const scoop = dent.removes * sev >= 0.2 && strikes.length >= 3;
      // the bodies that own a wounded copy of their geometry are bounded: past
      // the cap a new body takes its marks (the scoop painted) and keeps the
      // species' geometry
      const room = !!seatS.mesh._cbzOwn || OWNED.length < ownCap();
      if (room && (thin || engulf || scoop)) {
        const through = thin || engulf;
        const rS = Math.max(dent.hw * 0.3, Math.max(-aMin, aMax) + Wavg * 0.6);
        const rU = Math.max(dent.hw * 0.25, Math.max(-bMin2, bMax) + Wavg * 0.6, wrap ? partU * 0.6 : 0);
        let rF = through ? (isFinite(thickF) ? thickF * 1.15 : Lmax * 2) + Lmax * 0.2
          : dent.removes * sev * (Lmax * 1.5 + dent.hw * 0.3);
        if (!through && isFinite(thickF)) rF = Math.min(rF, thickF * 0.6);
        if (rF > 0.004) {
          const nTeeth = Math.max(6, Math.min(30, strikes.length));
          removalOp = {
            C: [_P.x, _P.y, _P.z], F: [_F.x, _F.y, _F.z], S: [_S.x, _S.y, _S.z], U: [_U.x, _U.y, _U.z],
            rS: rS, rU: rU, rF: rF, through: through,
            scN: nTeeth, scA: Math.max(0.02, Math.min(0.09, Wavg / Math.max(1e-4, 2 * rS))), scP: Math.random() * 6.283,
            M: seatS.M.slice(0, seatS.mesh.skeleton.bones.length * 16),
            tis: bite.tissue,
          };
        }
      }
    }
    // ---- THE REST IS WORK, NOT THE INSTANT: dug, laid, stamped and built a
    // slice a frame (see BITE JOBS). What the caller needs now is above.
    bite.P = _P.clone(); bite.N = _N.clone(); bite.S = _S.clone(); bite.U = _U.clone(); bite.F = _F.clone();
    bite.trav = trav ? trav.clone() : null; bite.wrap = wrap; bite.op = removalOp; bite.cut = null;
    bite.R = R; bite.wp = { x: wp.x, y: wp.y, z: wp.z }; bite.geo0 = seatS.geo;
    bite.phase = 0; bite.k = 0; bite.t0 = performance.now();
    JOBS.push(bite);
    LEDGER.jobs++;
    return {
      made: 1, pending: true, lead: null, host: seatS.mesh, wet: bite.wet, region: seatS.region || "torso", P: bite.P, N: bite.N,
      removed: removalOp ? 1 : 0, severed: 0, strikes: strikes.length, family: dent.family, wrap: wrap,
      size: Math.max(aMax - aMin, bMax - bMin2) * 0.5 + Wavg, fold: bite.fold, bite: bite,
    };
  }

  /* ---- BITE JOBS ---------------------------------------------------------
     The instant of a bite (where the jaws met the body, every tooth's
     strike, what flesh goes) is computed when it happens, on the body as it
     is then. Everything that follows from it is a job worked a slice a
     frame, inside BITE_BUDGET ms: the dig (the body's own geometry, refined
     where it is coarse), the marks planned, each mark projected, the flap,
     the runs, the cut faces, the piece that left, the atlases if they are
     still being painted, the meshes. It all reads the bite's own copies of
     the posed body and the matrices of its instant, so a body that swims on
     in between is marked where it was bitten. A body that leaves the world
     drops its job; CBZ.woundsFlush() finishes every job now (a reset, a
     tool). */
  const JOBS = [];
  const BITE_BUDGET = 2.5;               // ms of bite work in a frame
  function jobAlive(bite) {
    const a = bite.actor;
    return !!(a && a.group && a.group.parent && !a.culled);
  }
  // one slice; true when the bite is finished
  function biteSlice(bite) {
    switch (bite.phase) {
      case 0: {                          // the dig: the body's own copy
        const op = bite.op, seatS = bite.seatS;
        if (!op) { bite.phase = 17; bite.k = 0; return false; }
        bite.phase = 11;
        try {
          const own = ownBody(bite.actor, seatS.mesh);
          own.ops.push(op);
          // the copy of the geometry the bite was struck on (the template's
          // own copy, made now on a first bite); every other LOD's after
          bite.own = own;
          bite.g0 = bite.geo0 && bite.geo0.userData && bite.geo0.userData.cbzOwnOf === own ? bite.geo0 : (own.map.get(bite.geo0) || own.cur);
          bite.lods = [];
          own.map.forEach(function (o) { if (o !== bite.g0) bite.lods.push(o); });
          bite.refined = 0;
        } catch (e) { bite.op = null; bite.phase = 17; bite.k = 0; }
        return false;
      }
      case 11:                           // a coarse body refined under the dish, a level a slice
        try {
          const g0 = bite.g0, nv0 = g0.attributes.position.count;
          // the instant's pose and its near triangles, when it posed this
          // geometry or the template this untouched copy was made from
          if (!bite.rst) {
            const sS = bite.seatS, gu = g0.userData || {};
            const same = sS.geo === g0 || (gu.tpl === sS.geo && !gu.refined && !gu.dug);
            bite.rst = same && sS.W && sS.W.length === nv0 * 3 ? { W: sS.W, WN: sS.WN, seed: sS.ctri } : {};
          }
          if (!bite.op.through && bite.refined < REFINE_LEVELS && refineLevel(g0, bite.op, bite.rst)) { bite.refined++; return false; }
          if (g0.attributes.position.count !== nv0) bite.refined++;
        } catch (e) {}
        bite.phase = 12;
        return false;
      case 12: {                         // the dig itself
        const own = bite.own, g0 = bite.g0, seatS = bite.seatS, op = bite.op;
        try {
          // the instant's pose (grown with the refinement's new vertices)
          const pre = bite.rst && bite.rst.W ? bite.rst : (seatS.geo === g0 ? { W: seatS.W, WN: seatS.WN } : null);
          const cut = applyRemove(own, g0, op, true, pre);
          if (cut) {
            if (cut.pushed) own.craters++;
            own.removed += cut.removedTris; own.severed += cut.severedTris;
            bite.removed = cut.removedTris + cut.pushed; bite.severed = cut.severedTris;
          }
          bite.cut = cut;
        } catch (e) { bite.cut = null; }
        bite.phase = 13;
        return false;
      }
      case 13:                           // the other LODs' copies, one a slice
        if (bite.lods && bite.lods.length) {
          const o = bite.lods.shift();
          try { if (!bite.op.through) refineAll(o, bite.op); applyRemove(bite.own, o, bite.op, false); } catch (e) {}
          return false;
        }
        bite.phase = 14;
        return false;
      case 14: {                         // the marks are laid on the body as it now is, posed as it was
        const seatS = bite.seatS;
        try { surfaceRefresh(seatS, bite.g0); surfacePose(seatS, seatS.M); } catch (e) {}
        bite.phase = 16;
        return false;
      }
      case 16: {                         // the triangles near the bite on it
        const seatS = bite.seatS;
        try { surfaceNear(seatS, bite.wp.x, bite.wp.y, bite.wp.z, bite.R); } catch (e) {}
        bite.phase = 17; bite.k = 0;
        return false;
      }
      case 17:                           // every surface's search grid, a part a slice
        while (bite.k < bite.surfs.length) {
          const S = bite.surfs[bite.k];
          if (!S || !S.nc || gridBuild(S, 1200)) { bite.k++; continue; }
          return false;
        }
        bite.phase = 1;
        return false;
      case 1:                            // the plan: the teeth
        lay(bite, bite.strikes, bite.P, bite.N, bite.S, bite.U, bite.trav, bite.wrap, bite.cut, bite.op);
        bite.phase = 15;
        return false;
      case 15:                           // the plan: what the bite does round them
        lay2(bite, bite.strikes, bite.P, bite.N, bite.S, bite.U, bite.trav, bite.wrap, bite.cut, bite.op);
        bite.phase = 2; bite.k = 0;
        return false;
      case 2:                            // one mark onto the skin
        if (bite.k < bite.els.length) { stampEl(bite, bite.els[bite.k++]); return false; }
        bite.els.length = 0; bite.phase = 3;
        return false;
      case 3:                            // the flap
        if (bite.flapAt) { flap(bite, bite.flapAt); bite.flapAt = null; }
        bite.phase = 4; bite.k = 0;
        bite.lows = runsFrom(bite);
        return false;
      case 4:                            // one run of blood
        if (bite.k < bite.lows.length) { runOne(bite, bite.lows[bite.k++]); return false; }
        bite.phase = 5;
        return false;
      case 5: {                          // the piece that left
        const cut = bite.cut;
        if (cut && (cut.sever.length || cut.chunk.length)) { try { shedFrom(bite, bite.seatS, cut, bite.who.actor); } catch (e) {} }
        bite.phase = 6;
        return false;
      }
      case 6:                            // the atlases, if a first bite came before they were painted
        if (!atlasesReady()) { atlasSlice(); return false; }
        bite.phase = 7; bite.k = 0; bite.made = 0;
        return false;
      case 7: {                          // the meshes, one a slice
        if (bite.k < bite.keys.length) { buildMark(bite, bite.keys[bite.k++]); return false; }
        bite.phase = 8;
        const nt = bite.note;
        if (nt) { nt.meshes = bite.made; nt.removed = bite.removed || 0; nt.severed = bite.severed || 0; nt.ms = Math.round(performance.now() - bite.t0); }
        return true;
      }
    }
    return true;
  }
  // what a slice of each phase has cost lately (a running mean)
  const SLICE_MS = new Float64Array(32);
  function jobsRun(budget) {
    const t0 = performance.now();
    let worked = 0;
    while (JOBS.length) {
      const bite = JOBS[0];
      if (!jobAlive(bite)) { JOBS.shift(); LEDGER.jobsDropped++; continue; }
      const ph = bite.phase & 31;
      if (worked && performance.now() - t0 + SLICE_MS[ph] > budget) break;
      const ts = performance.now();
      let done = true;
      try { done = biteSlice(bite); } catch (e) { done = true; }
      const d = performance.now() - ts;
      SLICE_MS[ph] = SLICE_MS[ph] ? SLICE_MS[ph] * 0.7 + d * 0.3 : d;
      if (d > LEDGER.sliceMsMax) LEDGER.sliceMsMax = d;
      worked++;
      if (done) JOBS.shift();
      if (performance.now() - t0 >= budget) break;
    }
    return worked;
  }
  CBZ.woundsFlush = function () { jobsRun(Infinity); };
  function jobsForget(actor) {
    for (let i = JOBS.length - 1; i >= 0; i--) if (!actor || JOBS[i].actor === actor) JOBS.splice(i, 1);
  }
  function atlasesReady() { const J = skinJobs(); return J.tissue.done && J.stain.done; }
  function atlasSlice() { const J = skinJobs(); texJobStep(J.tissue, 10); texJobStep(J.stain, 10); }

  /* ---- WHAT THE TEETH LEAVE, AND WHAT THE BODY ANSWERS -------------------- */
  function tint(r, g, b, a) { const l = linArr(r, g, b); return [l[0], l[1], l[2], a]; }
  // the stain layer's colours (display multipliers; the 4th is how much)
  const TINT = {
    bruise: tint(0.66, 0.40, 0.48, 1), bruiseSea: tint(0.80, 0.56, 0.56, 1),
    rim: tint(0.80, 0.50, 0.47, 0.85), rimSea: tint(0.74, 0.58, 0.58, 0.7),
    abrasion: tint(0.80, 0.50, 0.48, 0.8), abrasionSea: tint(0.80, 0.66, 0.66, 0.7),
    soakCloth: tint(0.42, 0.06, 0.07, 1), soakFur: tint(0.36, 0.08, 0.07, 1), bloodSkin: tint(0.5, 0.06, 0.06, 1),
    holeCloth: tint(0.40, 0.06, 0.07, 1), holeFur: tint(0.36, 0.08, 0.07, 1), ripCloth: tint(0.40, 0.06, 0.07, 1),
    scales: tint(0.82, 0.74, 0.74, 1),
  };
  function withA(c, a) { return [c[0], c[1], c[2], a]; }
  function snap(bite, x, y, z) {
    const h = nearestAll(bite.surfs, x, y, z, hitRec());
    return h;
  }
  function snapOn(S, x, y, z) {
    const h = nearestAll([S], x, y, z, hitRec());
    return h;
  }
  const PAINT = new Map([
    [TCELL.blood, 0], [TCELL.crater, 2], [TCELL.gape, 2], [TCELL.ragged, 2], [TCELL.rake, 3], [TCELL.tear, 4],
    [TCELL.slit, 5], [TCELL.serrated, 6], [TCELL.puncture2, 7], [TCELL.puncture, 7],
    [SCELL.soakCloth, 0], [SCELL.soakFur, 0], [SCELL.bloodSkin, 0], [SCELL.bruise, 1], [SCELL.smear, 1], [SCELL.rim, 2], [SCELL.abrasion, 2], [SCELL.rip, 3], [SCELL.holeFur, 4], [SCELL.holeCloth, 4],
  ]);
  function elAt(layer, cell, h, T, sx, sy, dz, c, wc, anim, only) {
    return { layer: layer, cell: cell, P: { x: h.px, y: h.py, z: h.pz }, N: { x: h.nx, y: h.ny, z: h.nz }, T: T, sx: sx, sy: sy, dz: dz, c: c, wc: wc || null, anim: anim || null, only: only || null };
  }
  // the in-plane direction that lays a cell drawn along its y on dir
  function alongY(dir, n) { return new THREE.Vector3().crossVectors(dir, n).normalize(); }
  // T, or T turned round, so that a cell's lower half (where its blood
  // stands) is the lower on the body as it stands (a cell's +y is n x T)
  function poolDown(T, n) {
    return n.z * T.x - n.x * T.z < 0 ? new THREE.Vector3(-T.x, -T.y, -T.z) : T;
  }
  // dir turned about n by up to +-a radians
  function askew(dir, n, a) {
    const th = (Math.random() * 2 - 1) * a, c = Math.cos(th), s2 = Math.sin(th);
    const cx = n.y * dir.z - n.z * dir.y, cy = n.z * dir.x - n.x * dir.z, cz = n.x * dir.y - n.y * dir.x;
    return new THREE.Vector3(dir.x * c + cx * s2, dir.y * c + cy * s2, dir.z * c + cz * s2).normalize();
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function lay(bite, strikes, P, N, S, U, trav, wrap, cut, op) {
    const D = bite.dent, sev = bite.sev, wet = bite.wet, coat = bite.coat;
    const sea = bite.tissue === "cetacean" || bite.tissue === "shark";
    const healA = sea ? { type: "heal", T: 150, t0: 25, to: 0.85 } : null;
    const rimT = sea ? TINT.rimSea : TINT.rim;
    // the saw: where a shark's head shook, a run of its upper teeth was
    // dragged sideways along the jaw's line, and only there
    const sawed = new Set();
    if (D.saw * sev >= 0.4) {
      const row = strikes.filter(function (s) { return s.t.up && s.t.kind === "serrated" && (s.pen || 0) >= 0.45; }).sort(function (a, b) { return a.t.s - b.t.s; });
      if (row.length >= 3) {
        const k = Math.min(row.length, 3 + Math.floor(Math.random() * 4)), i0 = Math.floor(Math.random() * (row.length - k + 1));
        for (let i = i0; i < i0 + k; i++) sawed.add(row[i]);
      }
    }
    const rowN = [0, 0];
    for (let i = 0; i < strikes.length; i++) if (deepKind(strikes[i].t.kind) || strikes[i].t.kind === "serrated") rowN[strikes[i].t.up ? 0 : 1]++;
    // 1. one mark per tooth, as deep as that tooth went. A fang or a blade
    //    that went in leaves a hole or a cut (its own size, one of two
    //    shapes, its own depth); one that only pressed, a small bruise. The
    //    small teeth between never punch: where they pressed hardest the skin
    //    is scraped, and through cloth nothing shows. Round a hole the skin
    //    is inflamed (stain), cloth is torn along its threads, fur is parted.
    for (let i = 0; i < strikes.length; i++) {
      const st = strikes[i], t = st.t, n = hN(st), cloth = !!st.S.cloth;
      const dk = deepKind(t.kind), cutter = t.kind === "serrated" || t.kind === "blade" || t.kind === "edge";
      const dz = Math.max(0.006, Math.min(t.L * 0.9, 0.05));
      const pen = st.pen != null ? st.pen : 1;
      if (!dk && !cutter) continue;
      const crowd = rowN[t.up ? 0 : 1] > 5, small = crowd && t.W < 0.006;
      if (pen < (small ? (cloth ? 0.95 : 0.7) : 0.32) || (crowd && Math.random() < 0.33)) {
        if (!small && !cloth && coat !== "fur" && Math.random() < 0.6) bite.els.push(elAt("s", SCELL.rim, st, st.drag, t.W * 2.4 / 0.66, t.W * 2.4 / 0.66, dz, withA(rimT, 0.45), null, null, st.S));
        continue;
      }
      if (small || crowd) {
        const j = t.W * (small ? 1.2 : 0.9);
        const jx = (Math.random() - 0.5) * j, jy = (Math.random() - 0.5) * j;
        const tq = onSkin(st.drag.y * n.z - st.drag.z * n.y, st.drag.z * n.x - st.drag.x * n.z, st.drag.x * n.y - st.drag.y * n.x, n, new THREE.Vector3()) || st.drag;
        st.px += st.drag.x * jx + tq.x * jy; st.py += st.drag.y * jx + tq.y * jy; st.pz += st.drag.z * jx + tq.z * jy;
      }
      const dScale = Math.min(1, 0.35 + 0.65 * Math.min(1, t.L / Math.max(1e-4, t.W * 1.6))) * (0.6 + 0.4 * (D.deep != null ? D.deep : 1));
      const depthK = Math.max(0.3, Math.min(1, dScale * (0.5 + 0.5 * Math.min(1, pen))));
      if (t.kind === "serrated") {
        // a blade tooth's cut is a short sawn slit along the jaw's line (the
        // blade's width runs along the jaw), widest where it went in; each its
        // own length, a little askew. The teeth the head shook sideways cut on
        // along the line and join into one ragged incision there.
        const sw = sawed.has(st);
        const len = Math.max(t.W * 1.1, t.L * 0.7) * (0.65 + 0.7 * Math.random()) * (0.8 + 0.3 * Math.min(1, pen)) * (sw ? 1.9 + 1.4 * D.saw * sev : 1);
        bite.els.push(elAt("w", TCELL.serrated, st, askew(st.drag, n, 0.3), (t.W * (0.35 + 0.15 * sev) * (0.7 + 0.6 * Math.random())) / 0.44, len / 0.72, dz, [Math.max(0.55, Math.min(0.75, depthK)), 0, 0, 1], null, null, st.S));
      } else if (t.kind === "blade" || t.kind === "edge") {
        const len = t.kind === "edge" ? D.hw * 1.6 : t.W * 2.4;
        const along = onSkin(S.x, S.y, S.z, n, new THREE.Vector3()) || st.drag;
        bite.els.push(elAt("w", TCELL.slit, st, along, len / 0.82, (t.W * 0.45) / 0.12, dz, [0.85 * depthK, 0, 0, 1], null, null, st.S));
      } else {
        const diam = t.W * (0.85 + 0.35 * D.crush + 0.15 * sev) * (0.8 + 0.4 * Math.random()) * (cloth ? 0.8 : 1);
        if (Math.random() < 0.35) bite.els.push(elAt("w", TCELL.puncture2, st, st.drag, diam * 1.3 / 0.42, diam * 0.8 / 0.19, dz, [depthK, 0, 0, 1], null, null, st.S));
        else bite.els.push(elAt("w", TCELL.puncture, st, st.drag, diam / 0.36, diam / 0.36 * (1 + 0.2 * D.crush), dz, [depthK, 0, 0, 1], null, null, st.S));
      }
      if (cloth) {
        // a fang punches the weave (a small one's hole is the wound's own)
        if (dk && t.W >= 0.005) {
          const diam = t.W * 1.05 + t.L * 0.1;
          bite.els.push(elAt("s", SCELL.holeCloth, st, st.drag, diam / 0.34, diam / 0.34, dz, TINT.holeCloth, null, null, st.S));
        }
      } else if (coat === "fur") {
        const diam = t.W * 1.8;
        const g0 = onSkin(0, -1, 0, n, new THREE.Vector3());
        bite.els.push(elAt("s", SCELL.holeFur, st, g0 ? alongY(g0.negate(), n) : st.drag, diam / 0.28, diam / 0.28, dz, TINT.holeFur, null, null, st.S));
      } else if (coat === "skin") {
        const diam = t.W * (2.0 + 1.2 * D.crush) * (0.8 + 0.4 * Math.min(1, pen));
        if (!small) bite.els.push(elAt("s", SCELL.rim, st, st.drag, diam / 0.66, diam / 0.66, dz, rimT, null, null, st.S));
        // blood beading out of it and smeared over its lip
        if (!wet && Math.random() < 0.7) {
          const sd = t.W * (1.6 + 1.4 * Math.random());
          bite.els.push(elAt("s", SCELL.smear, st, st.drag, sd / 0.6, sd / 0.6, dz, withA(TINT.bloodSkin, 0.85), null, null, st.S));
        }
      }
    }
    // 1b. the small teeth between the fangs never punch: where a row of them
    //     pressed hardest on bare skin it is scraped, one mark along the row
    //     (broken by the cell, never a dotted line of them); through cloth
    //     and fur nothing shows
    for (let r = 0; r < 2; r++) {
      const row = strikes.filter(function (s) { return s.t.up === (r === 0) && !deepKind(s.t.kind) && s.t.kind !== "serrated" && s.t.kind !== "blade" && s.t.kind !== "edge" && !s.S.cloth && (s.pen || 0) > 0.5; })
        .sort(function (a, b) { return a.t.s - b.t.s; });
      if (row.length < 2 || coat === "fur" || Math.random() < 0.3) continue;
      const a = row[0], b = row[row.length - 1];
      const dx = b.px - a.px, dy = b.py - a.py, dz = b.pz - a.pz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const h = snap(bite, (a.px + b.px) * 0.5, (a.py + b.py) * 0.5, (a.pz + b.pz) * 0.5);
      if (!h || h.S.cloth) continue;
      let wsum = 0, psum = 0;
      for (let i = 0; i < row.length; i++) { wsum += row[i].t.W; psum += row[i].pen; }
      const W1 = wsum / row.length, P1 = psum / row.length;
      const dir = onSkin(dx, dy, dz, hN(h), new THREE.Vector3()) || S;
      bite.els.push(elAt("s", SCELL.abrasion, h, dir, (d + W1 * 2) / 0.68 * 0.75, W1 * 1.4 / 0.34, Math.max(0.01, d * 0.4),
        withA(sea ? TINT.abrasionSea : TINT.abrasion, Math.min(0.85, 0.3 + 0.45 * P1)), null, null, h.S));
    }
    // 2. a knife row cuts one straight line (a barracuda's), through the
    //    skin and through any cloth over it
    for (let r = 0; r < 2; r++) {
      const row = strikes.filter(function (s) { return s.t.up === (r === 0) && (s.t.kind === "serrated" || s.t.kind === "blade" || s.t.kind === "edge") && (s.pen || 0) >= 0.32; })
        .sort(function (a, b) { return a.t.s - b.t.s; });
      const knife = D.slice >= 0.5;
      if (!knife) continue;
      const use = row;
      if (use.length < 2) continue;
      const a = use[0], b = use[use.length - 1];
      const dx = b.px - a.px, dy = b.py - a.py, dz = b.pz - a.pz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-4) continue;
      const h = snap(bite, (a.px + b.px) * 0.5, (a.py + b.py) * 0.5, (a.pz + b.pz) * 0.5);
      if (!h) continue;
      const w = Math.max(a.t.W, b.t.W) * (0.35 + 0.3 * sev);
      if (knife) bite.els.push(elAt("w", TCELL.slit, h, new THREE.Vector3(dx, dy, dz), (d + a.t.W) / 0.82, w / 0.12, Math.max(0.008, d * 0.4), [0.85, 0, 0, 1], null, null));
      if (h.S.cloth) bite.els.push(elAt("s", SCELL.rip, h, new THREE.Vector3(dx, dy, dz), (d + a.t.W * 1.5) / 0.84, Math.max(0.006, w * 0.6) / 0.09, Math.max(0.008, d * 0.4), TINT.ripCloth, null, null, h.S));
    }
    // 4. the shake tears some of the holes on along the pull and leaves the
    //    rest as they went in
    if (D.shake >= 0.3 && sev > 0.3) {
      const deep = strikes.filter(function (s) { return (deepKind(s.t.kind) || s.t.kind === "serrated") && (s.pen || 0) >= 0.5; })
        .sort(function (a, b) { return b.t.L - a.t.L; }).slice(0, 4);
      shuffle(deep);
      const nT = Math.min(deep.length, Math.max(1, Math.round((0.5 + 2.0 * D.shake * sev) * (0.45 + 0.6 * Math.random()))));
      let longest = null;
      const side = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < nT; i++) {
        const st = deep[i], n = hN(st), t = st.t;
        const px = (trav ? -trav.x * 0.8 : 0) + S.x * side * D.shake * 0.6, py = (trav ? -trav.y * 0.8 : 0) + S.y * side * D.shake * 0.6, pz = (trav ? -trav.z * 0.8 : 0) + S.z * side * D.shake * 0.6;
        const pull = onSkin(px, py, pz, n, new THREE.Vector3()) || st.drag;
        const len = t.L * (1.0 + 2.4 * D.shake * sev) * (0.8 + 0.4 * D.crush) * (0.7 + 0.5 * Math.random());
        const wid = t.W * (0.9 + 0.5 * D.crush);
        const h = snap(bite, st.px + pull.x * len * 0.42, st.py + pull.y * len * 0.42, st.pz + pull.z * len * 0.42);
        if (!h) continue;
        const cloth = !!h.S.cloth;
        bite.els.push(elAt("w", TCELL.tear, h, pull, len / 0.82, wid / 0.2 * (cloth ? 0.7 : 1), Math.max(0.01, len * 0.3), [0.75, 0, 0, 1], null, null));
        if (cloth) bite.els.push(elAt("s", SCELL.rip, h, pull, len * 1.15 / 0.84, wid * 0.9 / 0.09, Math.max(0.01, len * 0.3), TINT.ripCloth, null, null));
        if (!longest || len > longest.len) longest = { h: h, pull: pull, len: len, wid: wid, cloth: cloth };
      }
      // a big enough tear leaves a flap hanging: the cloth or the hide the
      // shake pulled loose (built after the marks on the skin: it stands off
      // the body and has to draw over whatever is on the skin behind it)
      if (longest && D.shake * sev >= 0.4 && (longest.cloth || coat === "fur")) bite.flapAt = longest;
    }
  }
  // the second slice of the plan: rakes, the flesh taken, the cut faces,
  // the bruise and the blood
  function lay2(bite, strikes, P, N, S, U, trav, wrap, cut, op) {
    const D = bite.dent, sev = bite.sev, wet = bite.wet, coat = bite.coat;
    const sea = bite.tissue === "cetacean" || bite.tissue === "shark";
    const healA = sea ? { type: "heal", T: 150, t0: 25, to: 0.85 } : null;
    // 5. the teeth dragged along the line of travel: the rakes
    if (D.rake >= 0.25) {
      const n = Math.min(14, strikes.length), step = strikes.length / n;
      for (let k = 0; k < n; k++) {
        const st = strikes[Math.floor(k * step)], nn = hN(st), t = st.t;
        const dir = (trav && onSkin(trav.x, trav.y, trav.z, nn, new THREE.Vector3())) || st.drag;
        const len = Math.max(t.W * 3, Math.min(D.hw * 3, D.hw * (0.6 + 1.6 * D.rake * sev))) * (0.6 + 0.5 * Math.random());
        const h = snap(bite, st.px + dir.x * len * 0.5, st.py + dir.y * len * 0.5, st.pz + dir.z * len * 0.5);
        if (!h) continue;
        bite.els.push(elAt("w", TCELL.rake, h, dir, len / 0.82, (t.W * 0.7) / 0.26, Math.max(0.01, len * 0.25), [0.8, 0, 0, 1], null, healA));
      }
    }
    // the middle of the bite on the skin: between the arcs on the flank, the
    // seat round a limb the jaws closed on
    const X = bite.ext, seatM = bite.seatS.mesh;
    let sa0 = Infinity, sa1 = -Infinity, sb0 = Infinity, sb1 = -Infinity;
    for (let i = 0; i < strikes.length; i++) {
      const st = strikes[i], Sx = st.S;
      if (Sx !== bite.seatS && Sx.mesh.parent !== seatM && seatM.parent !== Sx.mesh) continue;
      const dx = st.px - P.x, dy = st.py - P.y, dz = st.pz - P.z;
      const a = dx * S.x + dy * S.y + dz * S.z, b = dx * U.x + dy * U.y + dz * U.z;
      if (a < sa0) sa0 = a; if (a > sa1) sa1 = a; if (b < sb0) sb0 = b; if (b > sb1) sb1 = b;
    }
    if (!(sa1 >= sa0)) { sa0 = X.aMin; sa1 = X.aMax; sb0 = X.bMin; sb1 = X.bMax; }
    const spanA = Math.max(0.01, sa1 - sa0), spanB = Math.max(0.01, sb1 - sb0);
    const ac = (sa1 + sa0) * 0.5, bc = (sb1 + sb0) * 0.5;
    const mid = wrap ? snap(bite, P.x, P.y, P.z) : snap(bite, P.x + S.x * ac + U.x * bc, P.y + S.y * ac + U.y * bc, P.z + S.z * ac + U.z * bc);
    // 6. the flesh that went with the mouth
    if (op && !op.through) {
      // the dug dish, floor and walls, in the victim's own layers: projected
      // down the jaw's own line from where the skin was, centred on the dish
      // it dug (its walls are steep: they take the paint too, or the skin
      // shows through them)
      const half = op.rF * 0.5 + 0.01;
      const h = { px: op.C[0] + op.F[0] * half, py: op.C[1] + op.F[1] * half, pz: op.C[2] + op.F[2] * half, nx: -op.F[0], ny: -op.F[1], nz: -op.F[2] };
      const el = elAt("w", TCELL.crater, h, S, op.rS * 2.3 / 0.78, op.rU * 2.3 / 0.78, half + 0.02, [1, 0, 0, 1], null, null);
      el.minFacing = -0.5;
      el.depthExact = true;            // the dish and no deeper: not the body's far side
      bite.els.push(el);
    } else if (!op && D.removes >= 0.5 && sev >= 0.5 && mid) {
      if (!wrap) {
        // a rigid body (a person): the gape the jaws took, painted between
        // the arcs and clipped to them: as wide as they are, a little less
        // deep, the tooth cuts along its edges
        const w = Math.max(X.Wavg * 3, spanA + X.Wavg * 0.5);
        const hgt = Math.min(w * 0.8, Math.max(X.Wavg * 2, spanB + X.Wavg * 0.3));
        const Tg = poolDown(S, hN(mid));
        if (D.crush >= 0.6) bite.els.push(elAt("w", TCELL.ragged, mid, Tg, w / 0.64, hgt / 0.64, Math.max(0.02, X.Lmax), [0.95, 0, 0, 1], null, null, mid.S));
        else bite.els.push(elAt("w", TCELL.gape, mid, Tg, w / 0.74, hgt / 0.52, Math.max(0.02, X.Lmax), [0.95, 0, 0, 1], null, null, mid.S));
      } else {
        // round a limb: the flesh cut out along each jaw's line
        for (let r = 0; r < 2; r++) {
          const row = strikes.filter(function (s) { return s.t.up === (r === 0); }).sort(function (a, b) { return a.t.s - b.t.s; });
          if (row.length < 3) continue;
          let cx = 0, cy = 0, cz = 0;
          for (let i = 0; i < row.length; i++) { cx += row[i].px; cy += row[i].py; cz += row[i].pz; }
          const hr = snap(bite, cx / row.length, cy / row.length, cz / row.length);
          if (!hr) continue;
          const a = row[0], b = row[row.length - 1];
          const d = Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz);
          const dir = poolDown(onSkin(b.px - a.px, b.py - a.py, b.pz - a.pz, hN(hr), new THREE.Vector3()) || S, hN(hr));
          bite.els.push(elAt("w", D.crush >= 0.6 ? TCELL.ragged : TCELL.gape, hr, dir, (d + X.Wavg) / (D.crush >= 0.6 ? 0.64 : 0.74),
            X.Lmax * 2.4 / (D.crush >= 0.6 ? 0.64 : 0.52), Math.max(0.02, X.Lmax), [0.9, 0, 0, 1], null, null, hr.S));
        }
      }
    }
    // 7. the cut's own faces where a part came away
    if (cut && cut.loops.length) capFaces(bite, bite.seatS, cut.loops);
    if (mid) bruiseAndBlood(bite, mid, S, spanA, spanB, X, sea, coat, wet, sev, D);
    // stamp everything, the blood first and the tooth holes last (a later
    // mark blends over an earlier one in the same mesh)
    // stamped a mark at a time by the bite's job, the blood first and the
    // tooth holes last (a later mark blends over an earlier one in the same
    // mesh)
    bite.els.sort(function (a, b) { return (PAINT.get(a.cell) || 0) - (PAINT.get(b.cell) || 0); });
  }
  // 11. on land, blood runs down the body along its real surface, from the
  //     lowest holes, onto whatever it meets: the holes it runs from
  function runsFrom(bite) {
    const sev = bite.sev;
    if (bite.wet || bite.coat === "fur" || sev <= 0.3) return [];
    const lows = bite.strikes.filter(function (s) { return (deepKind(s.t.kind) || s.t.kind === "serrated" || s.t.kind === "blade") && (s.pen || 0) >= 0.32; })
      .sort(function (a, b) { return a.py - b.py; });
    const out = [];
    for (let i = 0; i < lows.length && out.length < 1 + Math.round(sev * 2); i++) {
      const st = lows[i];
      let near = false;
      for (let j = 0; j < out.length; j++) if (Math.hypot(out[j].px - st.px, out[j].py - st.py, out[j].pz - st.pz) < st.t.W * 2.5) near = true;
      if (!near) out.push(st);
    }
    return out;
  }
  function runOne(bite, st) {
    // through cloth the run is a wet trail soaking down the fabric
    if (st.S.cloth) bloodTrail(bite, st, bite.sev);
    else bloodRun(bite, st, Math.max(0.0035, st.t.W * 0.35), 0.06 + 0.24 * bite.sev);
  }
  // 8-10: what the bitten skin does round the teeth
  function bruiseAndBlood(bite, mid, S, spanA, spanB, X, sea, coat, wet, sev, D) {
    const grav = onSkin(0, -1, 0, hN(mid), new THREE.Vector3());
    // 8. the crush bruise, on every bare surface the jaws closed on, round
    //    the teeth that landed there: red at once, darkening for half a minute
    if (D.crush * sev > 0.15 && coat !== "fur" && coat !== "scales") {
      const k = Math.min(1, D.crush * sev * (sea ? 0.6 : 0.95));
      const groups = new Map();
      for (let i = 0; i < bite.strikes.length; i++) {
        const st = bite.strikes[i];
        if (st.S.cloth) continue;
        let gp = groups.get(st.S);
        if (!gp) groups.set(st.S, gp = { n: 0, x: 0, y: 0, z: 0, pts: [] });
        gp.n++; gp.x += st.px; gp.y += st.py; gp.z += st.pz; gp.pts.push(st);
      }
      groups.forEach(function (gp, Sx) {
        const h = snapOn(Sx, gp.x / gp.n, gp.y / gp.n, gp.z / gp.n);
        if (!h) return;
        let r = 0;
        for (let i = 0; i < gp.pts.length; i++) r = Math.max(r, Math.hypot(gp.pts[i].px - h.px, gp.pts[i].py - h.py, gp.pts[i].pz - h.pz));
        const d = Math.max(X.Wavg * 4, (r + X.Wavg * 1.5) * 2.1);
        bite.els.push(elAt("s", SCELL.bruise, h, S, d / 0.66, d * 0.85 / 0.66, Math.max(0.02, d * 0.3),
          withA(sea ? TINT.bruiseSea : TINT.bruise, k), null, { type: "alpha", from: 0.4, to: 1, T: 25 }, Sx));
      });
    }
    // 9. scales torn off round a fish bite
    if (coat === "scales" && bite.kind === "animal" && (bite.tissue === "fish" || bite.tissue === "redfish")) {
      bite.els.push(elAt("s", SCELL.bruise, mid, S, (spanA * 1.6 + X.Wavg * 4) / 0.66, (spanB * 1.6 + X.Wavg * 4) / 0.66, Math.max(0.02, spanA * 0.5), TINT.scales, null, null, mid.S));
    }
    // 10. BLOOD
    const bloodR = (Math.max(spanA, spanB) * 0.5 + X.Wavg * 2 + 0.015) * (0.7 + 0.6 * sev);
    const lowG = grav ? 0.18 * bloodR : 0;
    const hb = grav ? snap(bite, mid.px + grav.x * lowG, mid.py + grav.y * lowG, mid.pz + grav.z * lowG) : mid;
    const hB = hb || mid;
    const upT = grav ? new THREE.Vector3().crossVectors(hN(hB), grav) : S;
    // (each stays on the surface it is on: blood does not jump the gap from
    // a trouser leg to the hand hanging beside it)
    if (hB.S.cloth) {
      // through the cloth: it soaks and wicks, darkening the fabric, heavier
      // and further below the wound
      bite.els.push(elAt("s", SCELL.soakCloth, hB, upT, bloodR * 2.1 / 0.6, bloodR * 2.6 / 0.6, Math.max(0.02, bloodR * 0.5), TINT.soakCloth, null,
        { type: "grow", g0: 0.18, g1: 0.42, T: 3, creep: 60, ay: 0.12 }, hB.S));
    } else if (coat === "fur") {
      // in fur it mats dark, it does not paint the coat red
      bite.els.push(elAt("s", SCELL.soakFur, hB, upT, bloodR * 1.9 / 0.62, bloodR * 2.4 / 0.62, Math.max(0.02, bloodR * 0.5), TINT.soakFur, null,
        { type: "grow", g0: 0.22, g1: 0.5, T: 2.5, creep: 40, ay: 0.12 }, hB.S));
    } else {
      // bare skin: the film (a dye: it darkens and reddens the skin), and
      // on land the wet pool standing under the wound, glossy
      const grow = { type: "grow", g0: 0.38, g1: 0.78, T: 1.2, creep: wet ? 20 : 45 };
      // in the sea the blood leaves the wound: thinner every minute
      bite.els.push(elAt("s", SCELL.bloodSkin, hB, upT, bloodR * 2 / 0.56, bloodR * 2.3 / 0.56, Math.max(0.02, bloodR * 0.5), withA(TINT.bloodSkin, wet ? 0.8 : 1), null,
        wet ? [grow, { type: "alpha", from: 1, to: 0.3, T: 90, t0: 5 }] : grow, hB.S));
      if (!wet) {
        const pr = bloodR * 0.42, pl = bloodR * 0.3;
        const hp = grav ? (snapOn(hB.S, hB.px + grav.x * pl, hB.py + grav.y * pl, hB.pz + grav.z * pl) || hB) : hB;
        bite.els.push(elAt("w", TCELL.blood, hp, upT, pr * 2 / 0.6, pr * 2.3 / 0.6, Math.max(0.02, pr * 0.5), [0, 0, 0, 0.92], null,
          { type: "grow", g0: 0.3, g1: 0.75, T: 1.5, creep: 30 }, hB.S));
      }
    }
  }

  // a flap of cloth or hide hanging from the lip of the longest tear,
  // peeled back over it
  const _fv = new THREE.Vector3(), _fw = new THREE.Vector3(), _fo1 = new THREE.Vector3(), _fo2 = new THREE.Vector3(), _fc3 = [0, 0, 0];
  /* A FLAP: the hide or cloth the shake tore loose, hinged along one side
     of the tear and lifted off it. The hinge follows the skin (each column
     of the flap stands on its own foot, in that spot's own frame), the flap
     curls on as it goes out (a torn edge rolls), its free corners further
     than its middle (it cups), and wherever it would pass into the body it
     is laid on it instead. Its outside is its front face: the tissue
     shader shows the hide or the soaked cloth there and the raw or lined
     underside behind. */
  const FLAP_NC = 5, FLAP_NR = 5;
  // the triangles of a part within r of a point, as it was posed for the
  // bite (a flap reaches past the bite's near list)
  function localTris(S, cx, cy, cz, r) {
    const W = S.W, idx = S.idx, nt = S.nt, out = [];
    for (let t = 0; t < nt; t++) {
      const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
      if (a === b || b === c || a === c) continue;
      const a3 = a * 3, b3 = b * 3, c3 = c * 3;
      const mx = (W[a3] + W[b3] + W[c3]) / 3, my = (W[a3 + 1] + W[b3 + 1] + W[c3 + 1]) / 3, mz = (W[a3 + 2] + W[b3 + 2] + W[c3 + 2]) / 3;
      let r2 = (W[a3] - mx) * (W[a3] - mx) + (W[a3 + 1] - my) * (W[a3 + 1] - my) + (W[a3 + 2] - mz) * (W[a3 + 2] - mz);
      let q = (W[b3] - mx) * (W[b3] - mx) + (W[b3 + 1] - my) * (W[b3 + 1] - my) + (W[b3 + 2] - mz) * (W[b3 + 2] - mz); if (q > r2) r2 = q;
      q = (W[c3] - mx) * (W[c3] - mx) + (W[c3 + 1] - my) * (W[c3 + 1] - my) + (W[c3 + 2] - mz) * (W[c3 + 2] - mz); if (q > r2) r2 = q;
      const lim = r + Math.sqrt(r2), dx = mx - cx, dy = my - cy, dz = mz - cz;
      if (dx * dx + dy * dy + dz * dz <= lim * lim) out.push(a, b, c);
    }
    return out;
  }
  // the nearest point of those triangles, as a hit (bone weights, normal)
  function nearestIn(S, list, qx, qy, qz, out) {
    const W = S.W, WN = S.WN;
    let best = Infinity;
    _tQ.set(qx, qy, qz);
    for (let k = 0; k < list.length; k += 3) {
      const i0 = list[k], i1 = list[k + 1], i2 = list[k + 2];
      _tA.fromArray(W, i0 * 3); _tB.fromArray(W, i1 * 3); _tC.fromArray(W, i2 * 3);
      _tri.set(_tA, _tB, _tC);
      _tri.closestPointToPoint(_tQ, _tO);
      const d2 = _tO.distanceToSquared(_tQ);
      if (d2 >= best) continue;
      best = d2;
      out.S = S; out.i0 = i0; out.i1 = i1; out.i2 = i2; out.px = _tO.x; out.py = _tO.y; out.pz = _tO.z; out.t = Math.sqrt(d2);
    }
    if (best === Infinity) return null;
    _tA.fromArray(W, out.i0 * 3); _tB.fromArray(W, out.i1 * 3); _tC.fromArray(W, out.i2 * 3);
    _tri.set(_tA, _tB, _tC);
    _tO.set(out.px, out.py, out.pz);
    _tri.getBarycoord(_tO, _tBc);
    out.b0 = _tBc.x; out.b1 = _tBc.y; out.b2 = _tBc.z;
    let nx = WN[out.i0 * 3] * out.b0 + WN[out.i1 * 3] * out.b1 + WN[out.i2 * 3] * out.b2;
    let ny = WN[out.i0 * 3 + 1] * out.b0 + WN[out.i1 * 3 + 1] * out.b1 + WN[out.i2 * 3 + 1] * out.b2;
    let nz = WN[out.i0 * 3 + 2] * out.b0 + WN[out.i1 * 3 + 2] * out.b1 + WN[out.i2 * 3 + 2] * out.b2;
    // the face's own side wins where the smooth normal disagrees with it
    // (a crease): what is outside is outside the triangle
    _tri.getNormal(_tN3);
    if (nx * _tN3.x + ny * _tN3.y + nz * _tN3.z < 0) { nx = _tN3.x; ny = _tN3.y; nz = _tN3.z; }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
    return out;
  }
  const _tN3 = new THREE.Vector3();
  // the triangles of every part of the bite near a point, flat: S, a, b, c
  function localAll(bite, cx, cy, cz, r) {
    const out = [];
    for (let s = 0; s < bite.surfs.length; s++) {
      const S = bite.surfs[s];
      if (!S || !S.W || !S.nt) continue;
      const l = localTris(S, cx, cy, cz, r);
      for (let k = 0; k < l.length; k += 3) out.push(S, l[k], l[k + 1], l[k + 2]);
    }
    return out;
  }
  // the first face a segment goes in through (from its front: into the
  // body), as the fraction along it and that face's normal; null if none
  const _segH = { t: 0, nx: 0, ny: 0, nz: 1 };
  function segIn(L, px, py, pz, qx, qy, qz) {
    const dx = qx - px, dy = qy - py, dz = qz - pz;
    let best = Infinity;
    for (let k = 0; k < L.length; k += 4) {
      const Wt = L[k].W, a = L[k + 1] * 3, b = L[k + 2] * 3, c = L[k + 3] * 3;
      const e1x = Wt[b] - Wt[a], e1y = Wt[b + 1] - Wt[a + 1], e1z = Wt[b + 2] - Wt[a + 2];
      const e2x = Wt[c] - Wt[a], e2y = Wt[c + 1] - Wt[a + 1], e2z = Wt[c + 2] - Wt[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (nx * dx + ny * dy + nz * dz >= 0) continue;
      const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (det > -1e-14 && det < 1e-14) continue;
      const f = 1 / det, sx = px - Wt[a], sy = py - Wt[a + 1], sz = pz - Wt[a + 2];
      const u = f * (sx * hx + sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;
      const rx = sy * e1z - sz * e1y, ry = sz * e1x - sx * e1z, rz = sx * e1y - sy * e1x;
      const v = f * (dx * rx + dy * ry + dz * rz);
      if (v < 0 || u + v > 1) continue;
      const t = f * (e2x * rx + e2y * ry + e2z * rz);
      if (t < 0 || t > 1 || t >= best) continue;
      best = t;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      _segH.t = t; _segH.nx = nx / l; _segH.ny = ny / l; _segH.nz = nz / l;
    }
    return best < Infinity ? _segH : null;
  }
  const _ff = new THREE.Vector3(), _fT = new THREE.Vector3(), _fB = new THREE.Vector3(), _fN = new THREE.Vector3();
  function flap(bite, L) {
    const h = L.h, n = hN(h).clone(), T = L.pull.clone(), Bv = new THREE.Vector3().crossVectors(n, T).normalize();
    const hingeW = L.len * 0.5, height = L.wid * (L.cloth ? 1.7 : 1.4);
    const hc = { x: h.px + Bv.x * L.wid * 0.5, y: h.py + Bv.y * L.wid * 0.5, z: h.pz + Bv.z * L.wid * 0.5 };
    const hh = snap(bite, hc.x, hc.y, hc.z);
    if (!hh) return;
    const S = hh.S, B = layerBuf(bite, S, "w");
    hostColour(S, hh, _fc3);
    // how far it stands off at the hinge, how much more it turns by its free
    // edge, and how much further its corners turn than its middle
    const phi = 0.85 + Math.random() * 0.35, curl = 0.6 + Math.random() * 0.4, cup = 0.14;
    const lift = 0.002, clear = 0.003;
    const cell = TCELL.flap, c = [0, 0, L.cloth ? 0.5 : 1, 1];
    // the soak the stain layer gives the fabric (or the coat) round it, as
    // an albedo: the dye raised to its cover (see stainMat), linearised
    const tn = L.cloth ? TINT.soakCloth : TINT.soakFur;
    const soakAt = function (cover) {
      const out = [0, 0, 0];
      for (let k = 0; k < 3; k++) out[k] = _fc3[k] * Math.pow(Math.max(0.001, Math.pow(tn[k], 1 / 2.2) * 0.9), cover * 2.2);
      return out;
    };
    const NC = FLAP_NC, NR = FLAP_NR, seg = height / (NR - 1);
    const P = new Float32Array(NC * NR * 3), Q = new Array(NC * NR);
    const reach = hingeW * 0.6 + height * 1.2 + 0.02;
    const every = localAll(bite, hh.px, hh.py, hh.pz, reach), local = [];
    for (let k = 0; k < every.length; k += 4) if (every[k] === S) local.push(every[k + 1], every[k + 2], every[k + 3]);
    if (!local.length) return;
    const nh = hN(hh).clone(), out0 = Math.min(0.05, Math.max(0.015, height * 1.5));
    // the hinge: one foot a column, each the skin you see there (come down
    // on from outside: the nearest skin can be a shell under another). It
    // must be one unbroken edge of skin: where a foot finds nothing (the
    // bite took it) or jumps (a fold, the next part over), the hinge is
    // narrowed until it is; a tear with no such edge has no flap.
    let hw = hingeW, feet = null;
    for (let attempt = 0; attempt < 3 && !feet; attempt++, hw *= 0.6) {
      feet = [];
      let prevH = 0;
      for (let i = 0; i < NC && feet; i++) {
        const u = i / (NC - 1) - 0.5;
        const tx = hh.px + T.x * u * hw, ty = hh.py + T.y * u * hw, tz = hh.pz + T.z * u * hw;
        const sx = tx + nh.x * out0, sy = ty + nh.y * out0, sz = tz + nh.z * out0;
        const ex = tx - nh.x * out0, ey = ty - nh.y * out0, ez = tz - nh.z * out0;
        const dn = segIn(every, sx, sy, sz, ex, ey, ez);
        if (!dn) { feet = null; break; }
        const fx = sx + (ex - sx) * dn.t, fy = sy + (ey - sy) * dn.t, fz = sz + (ez - sz) * dn.t;
        const hgt = (fx - hh.px) * nh.x + (fy - hh.py) * nh.y + (fz - hh.pz) * nh.z;
        if (i && Math.abs(hgt - prevH) > 0.6 * hw / (NC - 1) + 0.003) { feet = null; break; }
        prevH = hgt;
        feet.push([fx, fy, fz, dn.nx, dn.ny, dn.nz, u]);
      }
    }
    if (!feet) return;
    hw /= 0.6;
    const soak = [];
    for (let j = 0; j < NR; j++) soak.push(soakAt(0.95 - 0.24 * j / (NR - 1) - 0.08 * Math.random()));
    for (let i = 0; i < NC; i++) {
      const u = feet[i][6];
      // the column's foot, seated on its part (its bones), in the skin's frame there
      const fx = feet[i][0], fy = feet[i][1], fz = feet[i][2];
      const f = nearestIn(S, local, fx, fy, fz, hitRec()) || copyHit(hh);
      Q[i] = f;
      f.px = fx; f.py = fy; f.pz = fz;
      if (feet[i][3] * f.nx + feet[i][4] * f.ny + feet[i][5] * f.nz < 0.3) { f.nx = feet[i][3]; f.ny = feet[i][4]; f.nz = feet[i][5]; }
      // every column turns in the hinge's own frame: the flap is one sheet
      // (columns in frames of their own fan apart or cross where the skin
      // under the hinge curves)
      _fN.copy(nh);
      _fT.copy(T).addScaledVector(_fN, -T.dot(_fN));
      if (_fT.lengthSq() < 1e-10) _fT.copy(T);
      _fT.normalize();
      _fB.crossVectors(_fN, _fT);
      let x = f.px + _fN.x * lift, y = f.py + _fN.y * lift, z = f.pz + _fN.z * lift;
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
      let lx = 0, ly = 0, lz = 0, lying = false;
      for (let j = 1; j < NR; j++) {
        const k = j / (NR - 1);
        const ang = phi + curl * Math.pow(k, 1.4) + cup * Math.abs(u * 2) * k * k;
        _ff.copy(_fB).multiplyScalar(-Math.cos(ang)).addScaledVector(_fN, Math.sin(ang));
        // once it lies on the skin it goes on along it, not into it
        if (lying) {
          const dn = _ff.x * lx + _ff.y * ly + _ff.z * lz;
          if (dn < 0) { _ff.x -= lx * dn; _ff.y -= ly * dn; _ff.z -= lz * dn; const l = _ff.length(); if (l > 1e-6) _ff.multiplyScalar(1 / l); }
        }
        let nx = x + _ff.x * seg, ny = y + _ff.y * seg, nz = z + _ff.z * seg;
        // a ragged free edge
        if (j === NR - 1) { const r = (Math.random() - 0.5) * hw * 0.12; nx += _fT.x * r; ny += _fT.y * r; nz += _fT.z * r; }
        // never into the body: where the step would go in through the skin
        // it meets it and slides on along it the rest of the way, standing
        // off it a little (the slide is tried too: off one face it can be
        // into the next)
        for (let it = 0; it < 3; it++) {
          const hit = segIn(every, x, y, z, nx, ny, nz);
          if (!hit) break;
          const t = Math.max(0, hit.t - 1e-3);
          const hx = x + (nx - x) * t + hit.nx * clear, hy = y + (ny - y) * t + hit.ny * clear, hz = z + (nz - z) * t + hit.nz * clear;
          let rx = (nx - x) * (1 - t), ry = (ny - y) * (1 - t), rz = (nz - z) * (1 - t);
          const rn = rx * hit.nx + ry * hit.ny + rz * hit.nz;
          rx -= hit.nx * rn; ry -= hit.ny * rn; rz -= hit.nz * rn;
          lx = hit.nx; ly = hit.ny; lz = hit.nz; lying = true;
          if (it === 2) { nx = hx; ny = hy; nz = hz; if (segIn(every, x, y, z, nx, ny, nz)) { nx = x; ny = y; nz = z; } break; }
          x = hx; y = hy; z = hz;
          nx = hx + rx; ny = hy + ry; nz = hz + rz;
        }
        x = nx; y = ny; z = nz;
        Q[j * NC + i] = nearestIn(S, local, x, y, z, hitRec()) || f;
        const o = (j * NC + i) * 3;
        P[o] = x; P[o + 1] = y; P[o + 2] = z;
      }
    }
    // smooth normals, the outside's: across x along (the front face's)
    const NV = new Float32Array(NC * NR * 3);
    for (let j = 0; j < NR; j++) for (let i = 0; i < NC; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(NC - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(NR - 1, j + 1);
      const ax = P[(j * NC + i1) * 3] - P[(j * NC + i0) * 3], ay = P[(j * NC + i1) * 3 + 1] - P[(j * NC + i0) * 3 + 1], az = P[(j * NC + i1) * 3 + 2] - P[(j * NC + i0) * 3 + 2];
      const bx = P[(j1 * NC + i) * 3] - P[(j0 * NC + i) * 3], by = P[(j1 * NC + i) * 3 + 1] - P[(j0 * NC + i) * 3 + 1], bz = P[(j1 * NC + i) * 3 + 2] - P[(j0 * NC + i) * 3 + 2];
      let nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      NV[(j * NC + i) * 3] = nx / l; NV[(j * NC + i) * 3 + 1] = ny / l; NV[(j * NC + i) * 3 + 2] = nz / l;
    }
    // each point seated through the skin nearest it: the flap bends where
    // the body under it bends
    const INV = new Array(NC * NR);
    for (let k = 0; k < NC * NR; k++) INV[k] = hostInverse(S, Q[k], new THREE.Matrix4());
    const put = function (i, j) {
      const k = j * NC + i, o = k * 3;
      vertWorld(B, Q[k], INV[k], P[o], P[o + 1], P[o + 2], NV[o], NV[o + 1], NV[o + 2],
        cell[0] + (i / (NC - 1)) * cell[2], cell[1] + (j / (NR - 1)) * cell[3], c, soak[j], 0, 0, 0);
    };
    // wound so the front face is the outside: (along, across) turns from
    // the outward direction to the hinge's
    for (let j = 0; j < NR - 1; j++) {
      for (let i = 0; i < NC - 1; i++) {
        put(i, j); put(i + 1, j + 1); put(i + 1, j);
        put(i, j); put(i, j + 1); put(i + 1, j + 1);
      }
    }
  }

  // a run of blood traced downhill over the real surface from a wound, its
  // front lengthening as it flows and slowing as it clots. It follows the
  // skin it reaches next (a neck's runs go on down the chest); where it
  // meets cloth it soaks in there.
  const _bp1 = new THREE.Vector3(), _bq1 = new THREE.Vector3(), _bg1 = new THREE.Vector3(), _bs1 = new THREE.Vector3();
  function bloodRun(bite, st, width, Lmax) {
    let S = st.S, pts = [copyHit(st)], len = 0, total = 0, soakAt = null;
    const segs = [];
    const step = Math.max(width * 2.2, 0.006);
    for (let k = 0; k < 64 && total < Lmax; k++) {
      const h = pts[pts.length - 1];
      // gravity along the skin
      const ny = h.ny;
      _bg1.set(h.nx * ny, -1 + ny * ny, h.nz * ny);    // (0,-1,0) minus its normal part
      const gl = _bg1.length();
      if (gl < 0.3) break;                            // facing up or down: it pools
      _bg1.multiplyScalar(1 / gl);
      _bq1.set(h.px + _bg1.x * step, h.py + _bg1.y * step, h.pz + _bg1.z * step);
      const nh = nearestAll(bite.surfs, _bq1.x, _bq1.y, _bq1.z, hitRec());
      if (!nh || nh.t > step * 0.7) break;            // over an edge, or off what we know
      const d = Math.hypot(nh.px - h.px, nh.py - h.py, nh.pz - h.pz);
      if (d < step * 0.25) break;
      if (nh.S !== S) {
        if (nh.S.cloth) { soakAt = copyHit(nh); break; }
        if (pts.length >= 3) segs.push({ S: S, pts: pts, len: len });
        S = nh.S; pts = [copyHit(nh)]; len = 0; total += d;
        continue;
      }
      len += d; total += d;
      pts.push(copyHit(nh));
    }
    if (pts.length >= 3) segs.push({ S: S, pts: pts, len: len });
    if (!segs.length && !soakAt) return false;
    let delay = 0;
    const tau = 4 + Math.random() * 5;
    for (let q = 0; q < segs.length; q++) {
      runStrip(bite, segs[q].S, segs[q].pts, segs[q].len, width * (1 - 0.3 * q / Math.max(1, segs.length)), tau, delay);
      delay += tau * 0.9;
    }
    if (soakAt) {
      // where the run met the cloth it soaks in and wicks on down
      const g0 = onSkin(0, -1, 0, hN(soakAt), new THREE.Vector3());
      const w = Math.max(width * 5, 0.02);
      const T = g0 ? new THREE.Vector3().crossVectors(hN(soakAt), g0) : new THREE.Vector3(1, 0, 0);
      const gl = g0 ? 0.35 * w * 2 : 0;
      const hh = g0 ? (snapOn(soakAt.S, soakAt.px + g0.x * gl, soakAt.py + g0.y * gl, soakAt.pz + g0.z * gl) || soakAt) : soakAt;
      stampEl(bite, elAt("s", SCELL.soakCloth, hh, T, w / 0.6, w * 2.6 / 0.6, Math.max(0.02, w), TINT.soakCloth, null,
        { type: "grow", g0: 0.15, g1: 0.6, T: 2.5, creep: 50, t0: delay, ay: 0.4 }, soakAt.S));
    }
    return true;
  }
  function runStrip(bite, S, pts, len, width, tau, t0) {
    const B = layerBuf(bite, S, "w"), cell = TCELL.strip, first = B.n;
    const lift = 0.0018;
    const rows = [];
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i) acc += Math.hypot(pts[i].px - pts[i - 1].px, pts[i].py - pts[i - 1].py, pts[i].pz - pts[i - 1].pz);
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      _bp1.set(b.px - a.px, b.py - a.py, b.pz - a.pz);
      const n = hN(pts[i]);
      _bs1.crossVectors(n, _bp1).normalize();
      const al = acc / Math.max(1e-6, len);
      const w = width * (1 - 0.55 * al * al) * 0.5;
      const p = pts[i];
      rows.push({ h: p, al: al, L: [p.px + _bs1.x * w + n.x * lift, p.py + _bs1.y * w + n.y * lift, p.pz + _bs1.z * w + n.z * lift],
        R: [p.px - _bs1.x * w + n.x * lift, p.py - _bs1.y * w + n.y * lift, p.pz - _bs1.z * w + n.z * lift], n: [n.x, n.y, n.z] });
    }
    const c = [0, 0, 0, 0.95];
    const inv = new THREE.Matrix4();
    for (let i = 0; i + 1 < rows.length; i++) {
      const r0 = rows[i], r1 = rows[i + 1];
      const quad = [[r0, "L", 0], [r0, "R", 1], [r1, "R", 1], [r0, "L", 0], [r1, "R", 1], [r1, "L", 0]];
      for (let k = 0; k < 6; k++) {
        const r = quad[k][0], p = r[quad[k][1]];
        hostInverse(S, r.h, inv);
        vertWorld(B, r.h, inv, p[0], p[1], p[2], r.n[0], r.n[1], r.n[2],
          cell[0] + quad[k][2] * cell[2], cell[1] + (0.04 + r.al * 0.92) * cell[3], c, null, 0, 0, r.al);
      }
    }
    B.anims.push({ type: "front", a: first, n: B.n - first, tau: tau, t0: t0 || 0, cell: cell });
  }
  // through cloth a run is a trail: the blood soaks down the fabric below a
  // hole, narrow and long, lengthening as it wicks
  function bloodTrail(bite, st, sev) {
    const n = hN(st), g0 = onSkin(0, -1, 0, n, new THREE.Vector3());
    if (!g0) return false;
    const L = (0.06 + 0.16 * sev) * (0.7 + 0.6 * Math.random()), w = Math.max(st.t.W * 2.2, 0.015);
    const h = snapOn(st.S, st.px + g0.x * L * 0.45, st.py + g0.y * L * 0.45, st.pz + g0.z * L * 0.45);
    if (!h) return false;
    const T = new THREE.Vector3().crossVectors(hN(h), g0);
    if (T.lengthSq() < 1e-8) return false;
    stampEl(bite, elAt("s", SCELL.soakCloth, h, T.normalize(), w / 0.6, L / 0.6, Math.max(0.02, L * 0.4), TINT.soakCloth, null,
      { type: "grow", g0: 0.15, g1: 0.5, T: 3, creep: 60, ay: 0.4 }, st.S));
    return true;
  }

  // the raw cross-section where a part came away: a fan over each loop of the
  // cut, rim in the skin's own layers, meat in the middle (the crater cell)
  const _cc = new THREE.Vector3(), _ce1 = new THREE.Vector3(), _ce2 = new THREE.Vector3(), _cn = new THREE.Vector3(), _cp = new THREE.Vector3();
  function capFaces(bite, S, loops) {
    const B = layerBuf(bite, S, "w"), cell = TCELL.crater, W = S.W;
    for (let l = 0; l < loops.length; l++) {
      const L = loops[l];
      if (L.length < 3 || L.length > 2000) continue;
      _cc.set(0, 0, 0);
      for (let i = 0; i < L.length; i++) _cc.x += W[L[i] * 3], _cc.y += W[L[i] * 3 + 1], _cc.z += W[L[i] * 3 + 2];
      _cc.multiplyScalar(1 / L.length);
      _cn.set(0, 0, 0);
      for (let i = 0; i < L.length; i++) {
        const a = L[i] * 3, b = L[(i + 1) % L.length] * 3;
        const ax = W[a] - _cc.x, ay = W[a + 1] - _cc.y, az = W[a + 2] - _cc.z, bx = W[b] - _cc.x, by = W[b + 1] - _cc.y, bz = W[b + 2] - _cc.z;
        _cn.x += ay * bz - az * by; _cn.y += az * bx - ax * bz; _cn.z += ax * by - ay * bx;
      }
      // the fan (b, a, centre) closes the kept side: its normal is the reverse
      if (_cn.lengthSq() < 1e-14) continue;
      _cn.normalize().negate();
      _ce1.set(W[L[0] * 3] - _cc.x, W[L[0] * 3 + 1] - _cc.y, W[L[0] * 3 + 2] - _cc.z);
      _ce1.addScaledVector(_cn, -_ce1.dot(_cn));
      if (_ce1.lengthSq() < 1e-12) continue;
      _ce1.normalize();
      _ce2.crossVectors(_cn, _ce1);
      let rmax = 1e-5;
      for (let i = 0; i < L.length; i++) {
        _cp.set(W[L[i] * 3] - _cc.x, W[L[i] * 3 + 1] - _cc.y, W[L[i] * 3 + 2] - _cc.z);
        rmax = Math.max(rmax, Math.hypot(_cp.dot(_ce1), _cp.dot(_ce2)));
      }
      const uvOf = function (x, y, z) {
        _cp.set(x - _cc.x, y - _cc.y, z - _cc.z);
        const u = _cp.dot(_ce1) / rmax * 0.86, v = _cp.dot(_ce2) / rmax * 0.86;
        return [cell[0] + (u * 0.5 + 0.5) * cell[2], cell[1] + (v * 0.5 + 0.5) * cell[3]];
      };
      // the centre rides the loop vertex nearest it
      let near = L[0], nd = Infinity;
      for (let i = 0; i < L.length; i++) {
        const d = Math.hypot(W[L[i] * 3] - _cc.x, W[L[i] * 3 + 1] - _cc.y, W[L[i] * 3 + 2] - _cc.z);
        if (d < nd) { nd = d; near = L[i]; }
      }
      const hc = { i0: near, i1: near, i2: near, b0: 1, b1: 0, b2: 0 };
      const inv = hostInverse(S, hc, new THREE.Matrix4());
      const c = [1, 0, 0, 1];
      for (let i = 0; i < L.length; i++) {
        const a = L[i], b = L[(i + 1) % L.length];
        const ub = uvOf(W[b * 3], W[b * 3 + 1], W[b * 3 + 2]), ua = uvOf(W[a * 3], W[a * 3 + 1], W[a * 3 + 2]), uc = uvOf(_cc.x, _cc.y, _cc.z);
        capVert(B, S, b, ub, c, _cn);
        capVert(B, S, a, ua, c, _cn);
        vertWorld(B, hc, inv, _cc.x, _cc.y, _cc.z, _cn.x, _cn.y, _cn.z, uc[0], uc[1], c, null, 0, 0, 0);
      }
    }
  }
  // a cut-face vertex ON a body vertex: its own bind position and bones, the
  // face's normal
  const _cvI = new THREE.Matrix4();
  function capVert(B, S, v, uv, c, nW) {
    const P = S.P;
    hostInverse(S, { i0: v, i1: v, i2: v, b0: 1, b1: 0, b2: 0 }, _cvI);
    _hvn.copy(nW).transformDirection(_cvI);
    B.pos.p3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    B.nrm.p3(_hvn.x, _hvn.y, _hvn.z);
    vertTail(B, v, v, v, 1, 0, 0, uv[0], uv[1], c, null, 0, 0, 0);
  }

  function biteNote(res, who, dent) {
    return {
      by: who.sid || "", family: dent.family, teeth: dent.teeth.length, strikes: res.strikes, wrap: !!res.wrap,
      region: res.region, removed: res.removed || 0, severed: res.severed || 0, meshes: res.made, wet: !!res.wet,
      archMm: Math.round(dent.hw * 2000), size: Math.round((res.size || 0) * 1000) / 1000,
    };
  }
  CBZ.woundSkinAudit = function () {
    const kinds = {};
    let verts = 0, onLive = 0, skinned = 0;
    for (let i = 0; i < SKIN.length; i++) {
      const r = SKIN[i];
      kinds[r.layer] = (kinds[r.layer] || 0) + 1;
      if (r.m.parent) onLive++;
      if (r.m.isSkinnedMesh) skinned++;
      verts += r.m.geometry.attributes.position.count;
    }
    return { marks: SKIN.length, attached: onLive, skinned: skinned, verts: verts, kinds: kinds, cap: skinCap(), animating: ANIM.length, owned: OWNED.length };
  };
  CBZ._woundSkinList = function () { return SKIN; };

  // ============================================================
  //  CBZ.bodyBite(actor, worldPoint, opts) — A PERSON BITTEN.
  //    jaw     the bite's radius in metres (sizes an unknown biter's arch; a
  //            known one's is its own anatomy, nudged within its spread)
  //    sev     0..1 how hard (default 0.7): how deep, how far the shake tears,
  //            how much blood
  //    sever   true = this bite may take the limb (CBZ.goreSever owns the
  //            stump, the flying limb and the restore audit; the biter
  //            keeps the limb in its mouth)
  //    by      the attacker's species id ("dog:<breed>" for a dog), or the
  //            attacker itself;  byActor  the attacker
  //    dir     the jaw's line into the body (unit);  fromX/fromZ the
  //            attacker's position when there is no line;  head, part
  //  The city player has no rig of his own: his limbs are
  //  systems/capture.js's wound rig, the same one bullets use.
  // ============================================================
  CBZ.bodyBite = function (actor, wp, opts) {
    opts = opts || {};
    if (!(CBZ.CONFIG && CBZ.CONFIG.WOUNDS_BITE)) {          // flag off → the old read
      // _fromBite stops the melee:"bite" router below bouncing straight back here.
      return CBZ.bodyWound(actor, wp,
        { head: opts.head, cal: 1.3, fromX: opts.fromX, fromZ: opts.fromZ, _fromBite: true });
    }
    LEDGER.biteCalls++;
    if (actor && actor.isPlayer && !actor.char && CBZ.playerWoundActor) actor = CBZ.playerWoundActor;
    if (!actor) { refuse("bite:no-actor"); return; }
    if (!wp) { refuse("bite:no-point"); return; }
    if (actor.culled) { refuse("bite:culled"); return; }
    if (!CBZ.scene) { refuse("bite:no-scene"); return; }
    const ch = actor.char;
    if (!ch) { refuse("bite:no-char"); return; }
    if (!ch.skinSlots) { refuse("bite:no-skinSlots"); return; }
    if (!actor.group) { refuse("bite:no-group"); return; }
    /* attachment, not `visible`: a parked, instanced or seated rig still
       carries every mark it took (see the identical note in bodyWound) */
    if (!actor.group.parent) { refuse("bite:detached"); return; }
    if (wp.x == null || wp.y == null || wp.z == null || !isFinite(wp.x) || !isFinite(wp.y) || !isFinite(wp.z)) { refuse("bite:null-coord"); return; }
    if (dist2Cam(wp.x, wp.z) > SPAWN_D2) { refuse("bite:too-far"); return; }   // only where it can be seen
    // a bite is ONE event that lays many marks: it stamps the shotgun-burst
    // window rather than being throttled by it; re-biting inside the window
    // is still refused
    const now = performance.now();
    if (now - (actor._biteT || -1e9) < 260) { refuse("bite:rebite-throttle"); return; }
    actor._biteT = now; actor._woundT = now; actor._woundBurst = 99;

    const sev = Math.max(0, Math.min(1, opts.sev != null ? opts.sev : 0.7));
    const jaw = Math.max(0.01, Math.min(2.5, opts.jaw != null ? opts.jaw : 0.22));
    const who = biterOf(opts);
    const dent = dentOf(who, jaw);
    let res = null;
    const tb = performance.now();
    try { res = runBite(actor, wp, opts, "person", who, dent, sev); } catch (e) { res = { why: "error:" + (e && e.message) }; }
    LEDGER.biteMsMax = Math.max(LEDGER.biteMsMax, performance.now() - tb);
    if (!res || !res.made) { refuse("bite:" + ((res && res.why) || "nothing")); return; }
    LEDGER.biteMarks++; LEDGER.personBites++;
    LEDGER.lastBite = biteNote(res, who, dent);
    if (res.bite) res.bite.note = LEDGER.lastBite;
    // BLEEDING INTO THE SEA: the trail leaves from the bitten part itself
    if (res.wet) bleedFor(actor, res.lead || res.host, Math.max(0.35, Math.min(1, 0.4 + sev * 0.6)), 18 + sev * 14);

    // A MAULED LEG is a collapse: character.js's own legHurt channel
    const region = res.region;
    if ((region === "legL" || region === "legR") && !actor.isPlayer && !ch.legGone) {
      const s2 = region === "legL" ? -1 : 1;
      const prev = ch.legHurt;
      const sevNew = Math.min(1, (prev && prev.side === s2 ? prev.sev : 0) + 0.5 + sev * 0.5);
      if (!prev || prev.side === s2 || sevNew > prev.sev) ch.legHurt = { side: s2, sev: sevNew, t: 9999 };
    }
    // THE LIMB COMES OFF — gore.js owns the stump, the flying part and the
    // restore audit; it goes along the jaw's line, into the mouth that took it
    if (opts.sever && CBZ.goreSever && !actor.isPlayer) {
      const key = region === "legL" ? "ll" : region === "legR" ? "rl"
        : region === "armL" ? "la" : region === "armR" ? "ra"
        : region === "head" ? "head" : null;
      if (key) { try { CBZ.goreSever(actor, key, { dir: opts.dir || throughDir(opts, wp), by: who.actor || null }); } catch (e) {} }
    }
  };

  // ---- CBZ.bodyWound(actor, worldPoint, opts) -------------------------------
  CBZ.bodyWound = function (actor, wp, opts) {
    LEDGER.woundCalls++;
    if (!actor) { refuse("wound:no-actor"); return; }
    // the city's playerActor carries no .char: the player's rig is capture.js's
    // wound actor, one record for every mode (so a hole stays YOUR hole)
    if (actor.isPlayer && !actor.char && CBZ.playerWoundActor) actor = CBZ.playerWoundActor;
    if (!wp) { refuse("wound:no-point"); return; }
    if (actor.culled) { refuse("wound:culled"); return; }
    if (!CBZ.scene) { refuse("wound:no-scene"); return; }
    const ch = actor.char;
    if (!ch) { refuse("wound:no-char"); return; }
    if (!ch.skinSlots) { refuse("wound:no-skinSlots"); return; }
    if (!actor.group) { refuse("wound:no-group"); return; }
    // attachment, not `visible` — see the identical note in bodyBite above
    if (!actor.group.parent) { refuse("wound:detached"); return; }
    opts = opts || {};
    // ONE-LINE ADOPTION for every biting creature already in the game: any caller
    // that already passes a melee type just says "bite" and gets the tooth-row
    // wound instead of a bullet hole. No call signature changes anywhere. Routed
    // before the burst-window guard because a bite is deliberately many marks
    // from ONE event (bodyBite runs its own distance + re-bite guards).
    if (opts.melee === "bite" && !opts._fromBite && typeof CBZ.bodyBite === "function") {
      return CBZ.bodyBite(actor, wp, opts);
    }
    // A PUNCH LEAVES NO MARK. Blunt trauma is a daze (systems/vitals.js), not
    // a decal: every "bruise" this used to stamp read as a bullet hole.
    if (opts.melee === "blunt" || opts.melee === true) { refuse("wound:blunt"); return; }
    let px = wp.x, py = wp.y, pz = wp.z;
    if (px == null || py == null || pz == null) { refuse("wound:null-coord"); return; }
    if (dist2Cam(px, pz) > WOUND_D2) { refuse("wound:too-far"); return; }   // only where it can be seen

    // burst window: a shotgun's pellets (or a same-frame double report) land
    // SCATTERED wounds, never a pool-flushing spray. CITY lets more pellets
    // through (a shotgun blast peppers the body — owner wants it to READ shot
    // up) while still capping the same-frame burst; jail/survival keep 3.
    const burstCap = cityWounds() ? 6 : 3;
    const now = performance.now();
    if (now - (actor._woundT || -1e9) < 90) {
      if ((actor._woundBurst || 0) >= burstCap) { refuse("wound:burst-cap"); return; }
      actor._woundBurst = (actor._woundBurst || 0) + 1;
    } else {
      actor._woundBurst = 1;
    }
    actor._woundT = now;

    // a synthetic centre-point (NPC hit rolls have no ray) leans toward the
    // shooter so the wound lands on the surface FACING them.
    if (opts.fromX != null && opts.fromZ != null) {
      let nx = opts.fromX - px, nz = opts.fromZ - pz;
      const nl = Math.hypot(nx, nz);
      if (nl > 0.01) {
        px += (nx / nl) * 0.45;
        pz += (nz / nl) * 0.45;
        // scatter a touch so a magdump doesn't stack one pixel
        px += (Math.random() - 0.5) * 0.18;
        py += (Math.random() - 0.5) * 0.22;
        pz += (Math.random() - 0.5) * 0.18;
      }
    }

    const kind = opts.melee === "blade" ? "blade" : "shot";
    const cal = opts.cal != null ? opts.cal : (opts.caliber != null ? opts.caliber : 1);

    // THE BLENDER PEOPLE (entities/people.js): the skin the camera sees takes
    // the wound where the round met it (cast along the shooter's line, stored
    // in bind space so it rides every pose). The hidden proc body below still
    // takes it too: the limp, the ledger, the decal bookkeeping all stay.
    if (ch._people && CBZ.people && CBZ.people.wound) {
      try { CBZ.people.wound(ch, new THREE.Vector3(wp.x, wp.y, wp.z), { kind: kind === "blade" ? "cut" : "shot", cal: cal, dmg: opts.dmg, fromX: opts.fromX, fromZ: opts.fromZ, dir: opts.dir }); } catch (e) {}
    }

    const pick = pickPart(actor, px, py, pz, !!opts.head);
    const part = pick.mesh;
    if (!part || !part.geometry) { refuse("wound:no-part"); return; }
    LEDGER.woundMarks++;

    // ---- LEG HIT → LIMP (the "smart/realistic" read) -------------------------
    // a round/blade to a leg makes the actor favour it: entities/character.js
    // reads ch.legHurt and limps (shortened stiff stride on the hurt side, the
    // body dips toward it on each weight-bearing step, reduced speed). Severity
    // follows the caliber; a blade hobbles less than a slug. Light wounds ease
    // off over ~20s; heavy ones persist until death. We DON'T touch the player
    // here — death.js owns the player's own probabilistic leg-wound/limp model
    // (P._legWound); see report. A leg already GONE (severed) stays gone.
    if ((pick.region === "legL" || pick.region === "legR") &&
        !actor.isPlayer && !ch.legGone) {
      const side = pick.region === "legL" ? -1 : 1;
      const add = (kind === "blade" ? 0.28 : 0.34) + cal * 0.34;   // caliber widens the limp
      const prev = ch.legHurt;
      const sevNew = Math.min(1, (prev && prev.side === side ? prev.sev : 0) + add);
      // a new wound to the OTHER leg takes over only if it's worse than the old
      if (!prev || prev.side === side || sevNew > prev.sev) {
        ch.legHurt = { side, sev: sevNew, t: 9999 };   // t counts down only once light (animChar)
      }
    }

    // ---- A BLADE LEAVES A SLIT (WOUND_REAL_V3) --------------------------------
    //  Sized off the BLADE (opts.bladeMm, the edge's width at the depth it went
    //  in; default grows gently with `cal`: shank 0.7 → ~22 mm), never off the
    //  damage dial. A stab's slit is about as long as the blade is wide; a
    //  SLASH (the blade travelling along the skin rather than into it) opens a
    //  cut ~2.6x longer and narrower. Laid along the blade's path; a thrust
    //  stands the edge along the part's long axis with a little wrist tilt.
    if (kind === "blade" && v2() && realOn()) {
      part.updateWorldMatrix(true, false);
      const lp = tmpV.set(px, py, pz);
      part.worldToLocal(lp);
      const ax = faceAxis(part, lp);
      const minHalf = faceMin(part, ax);
      const clothed = clothedPart(actor, part, pick.region);
      const dir = throughDir(opts, wp);
      const dlv = dir ? localDir(part, wp, dir) : null;
      const dlx = dlv ? dlv.x : 0, dly = dlv ? dlv.y : 0, dlz = dlv ? dlv.z : 0;
      // how much of the blade's travel lies ALONG the face it hit
      const dn = dlv ? Math.abs(ax === "x" ? dlx : ax === "y" ? dly : dlz) : 1;
      const slash = opts.slash === true || (opts.slash !== false && !!dlv && dn < 0.69);
      const bladeMm = opts.bladeMm != null ? Math.max(6, Math.min(60, opts.bladeMm)) : 16 + 8 * Math.min(2, Math.max(0, cal));
      let halfL = bladeMm * 0.0005 * RIG_MAG * (slash ? 2.6 : 1) * (0.9 + Math.random() * 0.2);
      halfL = fitR(G_SLIT, Math.min(halfL, capR(G_SLIT, minHalf, SLIT_MAX_FRAC)), minHalf);
      const halfW = halfL * (slash ? 0.17 : 0.27);
      // the fabric parts a little ahead of the edge and frays wider than the skin
      const cL = clothed ? fitR(G_CLOTH_SLIT, halfL * 1.2, minHalf) : 0;
      const cW = halfW * 1.3;
      const pad = Math.max(halfL * G_SLIT._maxR, cL * G_CLOTH_SLIT._maxR);
      const wm = stamp(actor, part, lp, G_SLIT, MAT_TORN, RO_WOUND, halfW * (clothed ? 0.8 : 1), halfL, ax, 0, pad, "blade");
      const n = decalNormal(wm);
      let spin = null;
      if (slash) {
        const k = dlx * n.x + dly * n.y + dlz * n.z;
        spin = spinAlong(wm, dlx - n.x * k, dly - n.y * k, dlz - n.z * k);
        if (spin != null) spin += (Math.random() - 0.5) * 0.2;
      }
      if (spin == null) {
        spin = spinAlong(wm, -n.x * n.y, 1 - n.y * n.y, -n.z * n.y);   // the part's up, in the face
        spin = (spin == null ? Math.random() * 6.28 : spin) + (Math.random() - 0.5) * 0.9;
      }
      wm.rotation.z = spin;
      if (clothed) stamp(actor, part, lp, G_CLOTH_SLIT, MAT_CLOTH, RO_CLOTH, cW, cL, ax, spin, pad, "cloth");
      // a thin wet margin along the cut, at its final size now: no soak
      const rW = Math.max(halfW * 1.6, clothed ? cW : 0);
      const rL = Math.max(halfL, clothed ? cL : 0);
      spawnRing(actor, part, lp, ax, rW, pad, { spin: spin, kx: 1, ky: Math.min(3.2, rL / Math.max(1e-4, rW)) });
      return;
    }

    const m = meshFor(actor);

    // world hit → part-local, snapped to the box face the round came through
    part.updateWorldMatrix(true, false);
    const lp = tmpV.set(px, py, pz);
    part.worldToLocal(lp);
    const ax = faceAxis(part, lp);        // ONE face for the hole AND its stain
    const minHalf = faceMin(part, ax);    // half the WIDTH of the panel it hit
    const v2on = v2();
    const shotV2 = v2on && kind === "shot";

    let geo = G_WOUND;
    let mat = MAT_FRESH;
    let sx, sy, s0 = 0;
    if (shotV2) {
      // ---- THE ROUND SIZES THE HOLE, AND THE PART CAPS IT ------------------
      //  Two inputs and nothing else. The BORE (millimetres, from the caller if
      //  it knows one) fixes the hole's real size; the FACE it landed on caps
      //  it. No body part is named and no damage number is consulted, so a
      //  9 mm is a 9 mm whether it lands on a skull, a chest or a wrist — it
      //  simply cannot exceed 8.5% of whichever of those it hit.
      //
      //  Worked and measured, on the adult 0.60-unit head (minHalf 0.30) —
      //  DIAMETERS, against 0.205 / 0.280 / 0.308 for the same three before:
      //    9 mm sidearm  → 0.043 across, 1 face in 14   (4.8x smaller)
      //    7.62 ak       → 0.051, capped by ENTRY_MAX_FRAC (5.5x smaller)
      //    sniper        → 0.051, capped                 (6.0x smaller)
      //  On a 0.27 forearm the same ak clamps to 0.023 — ten times smaller than
      //  it used to be, because the FOREARM said so and not because anything
      //  here knows what a forearm is.
      //  The head no longer gets the old 1.15x "kill tell" bonus: a bore does
      //  not grow because it hit a skull. The headshot read now comes from the
      //  stain and the collar run-down below, which is where it belongs.
      geo = G_ENTRY;
      const want = mmFor(opts, cal) * 0.0005 * RIG_MAG;   // radius, in rig units
      const cap = capR(G_ENTRY, minHalf, ENTRY_MAX_FRAC);
      // the jitter goes on the BORE (no two holes tear identically) and the cap
      // lands AFTER it — a jitter applied to an already-capped size is exactly
      // how an oversized decal sneaks back in.
      sx = Math.min(want * (0.90 + Math.random() * 0.20), cap);
      sy = Math.min(want * (0.90 + Math.random() * 0.20), cap);
    } else {
      // severity → size: caliber widens the hole; the head wound reads a touch
      // bigger (it's the kill tell); a blade
      // leaves a thin slash. Every wound carries its own jitter — no two match.
      s0 = 0.045 + 0.032 * cal;
      if (pick.region === "head") s0 *= 1.15;
      if (kind === "blade") {
        sx = s0 * (0.45 + Math.random() * 0.2); sy = s0 * (1.7 + Math.random() * 0.4);
      } else {
        sx = s0 * (0.85 + Math.random() * 0.3); sy = s0 * (0.85 + Math.random() * 0.3);
      }
    }

    // ---- ONE CLAMP, AND IT IS THE LAST WORD ---------------------------------
    // Every kind runs through it, including the slash: a cut wider than the
    // forearm it sits on reads exactly as fake as an oversized bullet hole did. It measures the decal's TRUE outer radius (its
    // scale times its own geometry's rim wobble) against the half-span of the
    // face, so its diameter can never reach that face's width — which is the
    // single invariant CBZ.woundDecalAudit().oversized pins at zero.
    if (v2on) {
      const mx = Math.max(sx, sy), k = fitR(geo, mx, minHalf) / mx;
      if (k < 1) { sx *= k; sy *= k; }
    }

    const rad = Math.max(sx, sy);
    // THE HOLE IN THE CLOTHES (WOUND_REAL_V3): a ragged torn hole in the
    // garment, a little wider than the wound it shows, sharing the wound's
    // centre and pad so the two can never be clamped apart.
    const clothOn = shotV2 && realOn() && clothedPart(actor, part, pick.region);
    const cr = clothOn
      ? fitR(G_CLOTH_HOLE, Math.min(rad * CLOTH_HOLE_K, capR(G_CLOTH_HOLE, minHalf, ENTRY_MAX_FRAC * 2.6)), minHalf)
      : 0;
    const padE = v2on ? Math.max(rad * geo._maxR, cr * G_CLOTH_HOLE._maxR) : 0;
    m.geometry = geo;
    m.material = mat;
    m.renderOrder = RO_WOUND;
    seat(m, part, lp, v2on ? proudFor(rad) : PROUD, undefined, ax, padE);
    hugDecal(m, part, v2on ? proudFor(rad) : PROUD);
    m.scale.set(sx, sy, 1);
    part.add(m);   // rides the part: animates, ragdolls and despawns with the rig
    wounds.push({ m, actor, age: 0, kind, dried: false });
    actor._woundN = (actor._woundN || 0) + 1;
    if (cr > 0) {
      stamp(actor, part, lp, G_CLOTH_HOLE, MAT_CLOTH, RO_CLOTH,
            cr * (0.92 + Math.random() * 0.16), cr * (0.92 + Math.random() * 0.16), ax, Math.random() * 6.28, padE, "cloth");
    }

    // ---- THE EXIT IS THE BIG ONE ---------------------------------------------
    //  A rifle round that goes through leaves a small tidy hole where it went in
    //  and a torn cavity where it came out — the asymmetry IS the read, and it
    //  is why a single mark on the near side always looked like a decal. Only
    //  fired when the round genuinely went through: heavy enough (strictly
    //  above fpsmode's own heavyRound line, so an untyped default does not),
    //  a real direction available (never guessed — see throughDir), and at
    //  least EXIT_MIN_TRAVEL of part crossed rather than a graze.
    let exitAt = null, exitR = 0, exitPad = 0;
    if (shotV2 && cal > EXIT_MIN_CAL) {
      const dir = throughDir(opts, wp);
      const dl = dir ? localDir(part, wp, dir) : null;
      const ex = dl ? boxExit(part, lp, dl) : null;
      if (ex && ex.t > EXIT_MIN_TRAVEL) {
        // An exit runs 3.5x (pistol-plus) to 6.2x (rifle) the entry bore before
        // the panel caps it — the real ratio is wider still, but a third of the
        // face is where a mark stops being a wound and starts being a sticker.
        const eHalf = faceMin(part, ex.ax);
        // SLIGHTLY bigger than the entry (owner: "exit wounds where
        // through-and-through, slightly bigger"): 1.6x a pistol-plus, ~2x a rifle
        const eWant = rad * (1.3 + 0.45 * Math.min(2.4, cal));
        const eCap = capR(G_EXIT, eHalf, EXIT_MAX_FRAC);
        let esx = Math.min(eWant * (0.85 + Math.random() * 0.35), eCap);
        let esy = Math.min(eWant * (0.85 + Math.random() * 0.35), eCap);
        const emx = Math.max(esx, esy), ek = fitR(G_EXIT, emx, eHalf) / emx;
        if (ek < 1) { esx *= ek; esy *= ek; }
        const er = Math.max(esx, esy);
        // cloth blown OUTWARD: a star tear over the cavity (same part, so the
        // same garment test as the entry)
        const ctr = clothOn ? fitR(G_CLOTH_TEAR, er * 1.15, eHalf) : 0;
        const padX = Math.max(er * G_EXIT._maxR, ctr * G_CLOTH_TEAR._maxR);
        const em = meshFor(actor);
        em.geometry = G_EXIT;
        em.material = MAT_EXIT;
        em.renderOrder = RO_WOUND;
        seat(em, part, ex, proudFor(er), undefined, ex.ax, padX);
        hugDecal(em, part, proudFor(er));
        em.scale.set(esx, esy, 1);
        part.add(em);
        wounds.push({ m: em, actor, age: 0, kind: "shot", dried: false });
        actor._woundN = (actor._woundN || 0) + 1;
        if (ctr > 0) stamp(actor, part, ex, G_CLOTH_TEAR, MAT_CLOTH, RO_CLOTH, ctr, ctr * (0.85 + Math.random() * 0.3), ex.ax, Math.random() * 6.28, padX, "cloth");
        exitAt = ex; exitR = Math.max(er * G_EXIT._maxR, ctr * G_CLOTH_TEAR._maxR); exitPad = padX;
      }
    }

    // ---- THE BLOOD RING (no soak, no collar run-down) ----
    // One small tight ring round each hole, at its final size on this frame.
    // The clothes keep their colour; the blood is on the ground (gore.js).
    spawnRing(actor, part, lp, ax, Math.max(rad * geo._maxR, cr * G_CLOTH_HOLE._maxR), padE);
    if (exitAt) spawnRing(actor, part, exitAt, exitAt.ax, exitR, exitPad);
  };

  // ---- RATCHET: CBZ.woundDecalAudit() ---------------------------------------
  //
  //  {decals, oversized, cameraFacing} over every wound mesh LIVE on a body
  //  right now. Two of the three are the owner's bug expressed as numbers, so
  //  they can never come back without the gate saying so:
  //
  //    oversized — decals whose true outer DIAMETER (scale x the geometry's own
  //      rim wobble) reaches the WIDTH of the box face they are seated on. This
  //      is literally "wider than the face". It read 1 per head shot and 1 per
  //      heavy soak before this change; it must read 0 and may only go DOWN.
  //    cameraFacing — decals that billboard instead of lying on the surface.
  //      Sprites are the way that regression would arrive; it has always been 0
  //      here (seat() writes an axis-aligned rotation on the part's own face)
  //      and this is the tripwire that keeps it 0.
  //
  //  Measured against the LIVE rig, not against the spawn code: it reads the
  //  geometry parameters of whatever mesh the decal actually got parented to,
  //  so a future part with different proportions is checked for free.
  CBZ.woundDecalAudit = function () {
    let decals = 0, oversized = 0, cameraFacing = 0;
    for (let i = 0; i < wounds.length; i++) {
      const r = wounds[i], m = r && r.m;
      if (!m || !m.parent) continue;
      decals++;
      if (m.isSprite || (m.material && m.material.isSpriteMaterial)) cameraFacing++;
      const prm = m.parent.geometry && m.parent.geometry.parameters;
      if (!prm) continue;
      const hx = (prm.width || 0) * 0.5, hy = (prm.height || 0) * 0.5, hz = (prm.depth || 0) * 0.5;
      if (!(hx > 0 && hy > 0 && hz > 0)) continue;
      // which face is it on? Read off the decal's own NORMAL: since hugDecal
      // puts every mark on the real (rounded) skin, its position is no longer
      // outside the box on any axis, but it still faces out of one side.
      _sn.set(0, 0, 1).applyQuaternion(m.quaternion);
      const anx = Math.abs(_sn.x), any = Math.abs(_sn.y), anz = Math.abs(_sn.z);
      const ax = anx >= any && anx >= anz ? "x" : (any >= anz ? "y" : "z");
      const tan = ax === "x" ? Math.min(hz, hy) : (ax === "y" ? Math.min(hx, hz) : Math.min(hx, hy));
      const mr = (m.geometry && m.geometry._maxR) || 1;
      const rad = Math.max(Math.abs(m.scale.x), Math.abs(m.scale.y)) * mr;
      if (rad > tan) oversized++;     // its diameter meets/exceeds the face's width
    }
    return {
      decals: decals, oversized: oversized, cameraFacing: cameraFacing,
      // THE LEDGER (see its declaration up by the wound pools). `decals: 0`
      // used to be the end of the conversation; now it comes with the reason.
      //   biteCalls / woundCalls  — how many times we were ASKED
      //   biteMarks / woundMarks  — how many got past every guard and drew
      //   lastRefusal             — the exact guard that turned the last one away
      // A call count of 0 means the failure is UPSTREAM of this file (nobody
      // asked); calls > 0 with marks 0 means it is here, and lastRefusal says
      // which line.
      biteCalls: LEDGER.biteCalls, biteMarks: LEDGER.biteMarks,
      personBites: LEDGER.personBites, animalBites: LEDGER.animalBites,
      // the last bite that landed: whose mouth, how many teeth met the body,
      // whether the part went between the jaws, the flesh taken
      lastBite: LEDGER.lastBite,
      woundCalls: LEDGER.woundCalls, woundMarks: LEDGER.woundMarks,
      refusals: LEDGER.refusals, lastRefusal: LEDGER.lastRefusal,
      // a bite's work after its instant (BITE JOBS): pending, dropped with
      // their bodies, and the longest the instant / one frame's slice took
      biteJobs: JOBS.length, jobsDropped: LEDGER.jobsDropped, biteMsMax: LEDGER.biteMsMax, sliceMsMax: LEDGER.sliceMsMax, jobFrameMsMax: LEDGER.jobFrameMsMax,
    };
  };

  // ============================================================
  //  CBZ.creatureBiteChunk(actor, worldPoint, opts) — AN ANIMAL BITTEN.
  //
  //  Any animal: a shark, a whale, a dolphin, a fish, a dog, a wolf (one
  //  SkinnedMesh each), or a bestiary animal built from rigid parts. The same
  //  bite as a person's (runBite above): every tooth of the attacker struck
  //  against this body's posed surface, the marks in its own tissue, and — on
  //  a one-mesh body — the flesh the mouth takes really gone: a scalloped
  //  crater in the animal's own copy of its geometry, or, through a fin, a
  //  fluke, an ear or round a tail stock, the part removed at the bite and
  //  everything past it with it, the raw end capped, the piece in the water.
  //
  //    opts  jaw   the bite's radius in metres
  //          sev   0..1 (default 0.6)
  //          by    the attacker's species id (or the attacker itself)
  //          byActor  the attacker: its own teeth, its head's roll, and the
  //                mouth a severed piece is carried in
  //          dir   the jaw's line (unit); a line along the skin is a rake
  //          bleed (default true), bleedS  the sea trail's length
  //    returns true when the bite landed on the body
  //
  //    CBZ.creatureBiteChunkRestore(actor)   heal it (a reset, never a sweep)
  //    CBZ.creatureBiteChunkAudit()          { actors, owned, craters,
  //      removedTris, severedTris, bleeders, marks, pieces }
  // ============================================================
  if (CBZ.CONFIG.CREATURE_BITE_CHUNK == null) CBZ.CONFIG.CREATURE_BITE_CHUNK = true;
  function chunkOn() { return CBZ.CONFIG.CREATURE_BITE_CHUNK !== false; }
  const BITTEN = [];                     // {actor, n, removed, severed, lx, ly, lz}
  function bittenRec(actor) {
    for (let i = 0; i < BITTEN.length; i++) if (BITTEN[i].actor === actor) return BITTEN[i];
    const r = { actor: actor, n: 0, removed: 0, severed: 0, lx: 0, ly: 0, lz: 0 };
    BITTEN.push(r);
    return r;
  }
  const _bloomOpts = { amount: 1, arterial: false, dir: null };
  const _bloomDir = { x: 0, y: 0, z: 0 };
  const _cbv = new THREE.Vector3();
  CBZ.creatureBiteChunk = function (actor, wp, opts) {
    opts = opts || {};
    LEDGER.biteCalls++;
    if (!chunkOn()) { refuse("chunk:off"); return false; }
    if (!actor || !wp || !actor.group) { refuse("chunk:no-actor"); return false; }
    if (!CBZ.scene) { refuse("chunk:no-scene"); return false; }
    if (actor.culled) { refuse("chunk:culled"); return false; }
    if (!actor.group.parent) { refuse("chunk:detached"); return false; }
    if (!(isFinite(wp.x) && isFinite(wp.y) && isFinite(wp.z))) { refuse("chunk:null-coord"); return false; }
    // ONLY WHERE IT CAN BE SEEN — the same band bodyBite and gore.js use
    if (dist2Cam(wp.x, wp.z) > SPAWN_D2) { refuse("chunk:too-far"); return false; }
    // a child is never dismembered (systems/childsafe.js owns that rule)
    if (actor.child || actor._childSafe) { refuse("chunk:child"); return false; }
    // a death roll's beats come a third of a second apart; a double report
    // in one frame is one bite
    const now = performance.now();
    if (now - (actor._chunkT || -1e9) < 120) { refuse("chunk:rebite-throttle"); return false; }
    actor._chunkT = now;
    const sev = Math.max(0.1, Math.min(1, opts.sev != null ? opts.sev : 0.6));
    const jaw = Math.max(0.01, Math.min(3.5, opts.jaw != null ? opts.jaw : 0.4));
    const who = biterOf(opts);
    const dent = dentOf(who, jaw);
    let res = null;
    const tb = performance.now();
    try { res = runBite(actor, wp, opts, "animal", who, dent, sev); } catch (e) { res = { why: "error:" + (e && e.message) }; }
    LEDGER.biteMsMax = Math.max(LEDGER.biteMsMax, performance.now() - tb);
    if (!res || (!res.made && !res.removed)) { refuse("chunk:" + ((res && res.why) || "nothing")); return false; }
    LEDGER.biteMarks++; LEDGER.animalBites++;
    LEDGER.lastBite = biteNote(res, who, dent);
    if (res.bite) res.bite.note = LEDGER.lastBite;
    const B = bittenRec(actor);
    B.n++; B.removed += res.removed || 0; B.severed += res.severed || 0;
    _cbv.copy(res.P);
    actor.group.worldToLocal(_cbv);
    B.lx = _cbv.x; B.ly = _cbv.y; B.lz = _cbv.z;
    if (!res.wet) return true;           // land: the caller owns the ground's blood
    /* BLOOD IN THE WATER: it erupts from the flank along the wound's own
       outward normal, and an animal (not each hole) trails it */
    if (CBZ.goreBloom) {
      _bloomOpts.amount = Math.max(0.6, Math.min(2.6, (0.7 + sev) * (0.7 + (res.size || 0.2) * 1.2) * (res.removed ? 1.3 : 1)));
      _bloomOpts.arterial = sev > 0.6;
      _bloomDir.x = res.N.x; _bloomDir.y = res.N.y * 0.4 + 0.25; _bloomDir.z = res.N.z;
      _bloomOpts.dir = _bloomDir;
      try { CBZ.goreBloom(res.P.x, res.P.y, res.P.z, _bloomOpts); } catch (e) {}
    }
    if (opts.bleed !== false) {
      bleedFor(actor, res.lead || res.host, Math.max(0.25, Math.min(1, 0.3 + sev * 0.6 + (res.removed ? 0.25 : 0))),
        Math.max(6, Math.min(70, (opts.bleedS || 14) * (1 + B.n * 0.22))));
    }
    return true;
  };

  /* ---- ONE TRAIL PER ANIMAL, not one per hole -----------------------------
     gore.js caps the whole game at twelve chum handles and city/
     marine_predation.js holds six of them, arbitrated by severity across
     every wounded thing in the water. An animal bleeds; its holes do not
     bleed separately. Ask that arbiter first (it owns "which six" and
     already follows the body); fall back to one raw handle per animal. */
  const BLEED = [];                      // {actor, h, node}
  function bleedFor(actor, node, sev, ttl) {
    if (typeof CBZ.marineBleed === "function") {
      let ok = false;
      try { ok = CBZ.marineBleed(actor, sev); } catch (e) { ok = false; }
      if (ok) return;
    }
    if (typeof CBZ.goreChum !== "function") return;
    for (let i = 0; i < BLEED.length; i++) {
      const b = BLEED[i];
      if (b.actor !== actor) continue;
      b.node = node || b.node;           // the newest wound leads the trail
      if (b.h) { if (sev > b.h.rate) b.h.rate = Math.min(1, sev); b.h.ttl = Math.max(b.h.ttl, ttl); }
      return;
    }
    if (!node) return;
    // A REAL Vector3: Object3D.getWorldPosition writes into it with
    // setFromMatrixPosition, and a plain object threw every frame
    const at = new THREE.Vector3();
    const rec = { actor: actor, h: null, node: node, at: at };
    // gore.js reads x() then y() then z() in that order every frame, so the
    // one world-position read rides on x and the other two are free
    const fx = function () { if (rec.node) rec.node.getWorldPosition(at); return at.x; };
    const fy = function () { return at.y; };
    const fz = function () { return at.z; };
    try { rec.h = CBZ.goreChum(fx, fy, fz, sev, ttl); } catch (e) { rec.h = null; }
    if (rec.h) BLEED.push(rec);
  }
  function bleedStop(actor) {
    for (let i = BLEED.length - 1; i >= 0; i--) {
      if (actor && BLEED[i].actor !== actor) continue;
      if (BLEED[i].h && CBZ.goreChumStop) { try { CBZ.goreChumStop(BLEED[i].h); } catch (e) {} }
      BLEED.splice(i, 1);
    }
  }

  /* ---- THE PIECE THAT CAME OFF ---------------------------------------------
     Built from the very triangles that left the body (pieceGeo above): the
     body's own surface at the instant of the bite, its own material, its torn
     ends closed with raw tissue. If the attacker has an authored mouth
     (group.userData.aquaticMouth) the piece rides in that jaw for a beat,
     worried, and is thrown with the head's own velocity; then it obeys
     whichever medium it is in (THE PIECE OBEYS THE WATER, below): gravity in
     the air, its own buoyancy in the sea (fat and cartilage float, muscle
     sinks), the sea bed or dry ground to rest on. Eight in the world, oldest
     recycled; the geometry is the piece's own and goes with it, the material
     is the body's (shared, never disposed here). */
  const PIECE_DRAG = 2.6;                // 1/s, applied as exp(-k*dt) so a long frame cannot overshoot
  const PIECES = [];                     // {m, vx,vy,vz, rx,ry,rz, t, life, carry, by, rest}
  const PIECE_CAP = 8;
  const PIECE_LIFE = 34;                 // s on the bottom before the slot is reclaimed
  const PIECE_CARRY = 1.35;              // s in the jaw before the head shake throws it
  const _q = new THREE.Quaternion();
  function dropPiece(i) {
    const p = PIECES.splice(i, 1)[0];
    if (!p || !p.m) return;
    if (p.m.parent) p.m.parent.remove(p.m);
    if (p.m.geometry && p.m.geometry.dispose) { try { p.m.geometry.dispose(); } catch (e) {} }
  }
  function piecesClear() { for (let i = PIECES.length - 1; i >= 0; i--) dropPiece(i); }
  // the attacker's own mouth, if it published one
  function mouthOf(by) {
    const g = by && by.group;
    const mo = g && g.userData && g.userData.aquaticMouth;
    if (!mo || !mo.bite) return null;
    return mo;
  }
  function spawnPiece(geo, material, by, out) {
    if (!CBZ.scene || !geo || !material) return null;
    if (PIECES.length >= PIECE_CAP) dropPiece(0);
    const m = new THREE.Mesh(geo, material);
    m._cbzPiece = true;
    m.name = "bittenPiece";
    m.castShadow = false; m.receiveShadow = false;
    const at = geo.userData.cbzPieceAt || [0, 0, 0];
    m.position.set(at[0], at[1], at[2]);
    CBZ.scene.add(m);
    const mo = mouthOf(by);
    const size = geo.boundingSphere ? geo.boundingSphere.radius : 0.3;
    const sev = out.sev;
    const rec = {
      m: m, t: 0, life: PIECE_LIFE, rest: false, afloat: false,
      carry: mo ? PIECE_CARRY * (0.7 + Math.random() * 0.6) : 0,
      by: mo ? by : null, q0: null,
      size: size,
      buoy: Math.random() < 0.55 ? 0.35 + Math.random() * 0.55 : -(0.45 + Math.random() * 0.7),
      draft: Math.max(0.04, size * 0.35),
      setA: Math.random() * 6.283,
      curT: 0, cx: 0, cz: 0,
      // out along the wound's normal, with the bite's own violence behind it
      vx: out.nx * (1.1 + sev * 2.2) + (Math.random() - 0.5) * 1.4,
      vy: out.ny * (0.6 + sev * 1.1) + (Math.random() - 0.5) * 0.8,
      vz: out.nz * (1.1 + sev * 2.2) + (Math.random() - 0.5) * 1.4,
      rx: (Math.random() - 0.5) * 4.2, ry: (Math.random() - 0.5) * 4.2, rz: (Math.random() - 0.5) * 4.2,
    };
    PIECES.push(rec);
    return rec;
  }
  // the pieces of one bite: what was severed falls free; what the jaw held is
  // carried in the mouth when there is a mouth to carry it
  function shedFrom(bite, S, cut, by) {
    const geo = S.mesh.geometry, mat = S.mesh.material;
    const o = { sev: bite.sev, nx: _N.x, ny: _N.y, nz: _N.z };
    if (cut.sever.length >= 9) { const g = pieceGeo(geo, cut.sever, cut.W, cut.WN, cut.wid, bite.tissue); if (g) spawnPiece(g, Array.isArray(mat) ? mat[0] : mat, null, o); }
    if (cut.chunk.length >= 9) { const g = pieceGeo(geo, cut.chunk, cut.W, cut.WN, cut.wid, bite.tissue); if (g) spawnPiece(g, Array.isArray(mat) ? mat[0] : mat, by, o); }
  }

  /* ---- THE PIECE OBEYS THE WATER --------------------------------------------
     Owner, 2026-09-08: "when I bite something sometimes the bitten-off fin
     will float in mid-air above water."

     The lobe had exactly one physics: CHIP_SINK (-1.15 m/s^2, flesh in
     seawater) under a water drag of exp(-1.43 dt), applied wherever the
     piece happened to be. That is right a metre down and wrong in the air —
     and the jaw that carries it is out of the water more often than not. The
     bite that takes a fin is a surface lunge; the head shake that throws the
     piece (the release velocity is the mouth's own, see the carry branch
     below) happens with the head UP. A lobe let go two metres over the swell
     then had a terminal fall speed of 1.15 / 1.43 = 0.8 m/s: it drifted back
     down to the sea over five to ten seconds with nothing visibly acting on
     it, which is the hang the owner saw. (The seabed rest test was not the
     problem — sharksim is an island mode, so the floor oracle IS the
     bathymetry there. The medium was.)

     So the piece now asks which medium it is in every frame, off the live
     swell, and has a physics for each:
       AIR     real gravity — PIECE_G_AIR is BREACH_G, the 17.5 m/s^2 the
               shark that threw it falls through (city/wildlife_tame.js), so
               a fin and the jaw that let go of it agree on how fast down is
               — light drag, and the tumble the throw gave it. Crossing the
               surface is an ENTRY: the water_wake splash sized to the piece,
               most of the velocity taken by the water, and from there
       WATER   the old near-neutral physics, but with a buoyancy of its OWN
               (spawnPiece rolls it): a fin's fat and cartilage float, muscle
               sinks, so a little over half of what comes off rises and rides
               the swell and the rest settles on the bed as before. Nothing
               rests in mid-water and nothing rests in the air: a rest is the
               seabed, or dry ground.
       AFLOAT  re-seated on the live surface every frame (eight pieces at
               most, so this is eight swell reads a frame, not the hundreds
               the blood slicks have to throttle), drifting with the field's
               current plus a slow set of its own; it grounds where the bed
               comes up to meet it — a fin washed up on the sand is the right
               ending, and it is the one place a piece may lie above the sea. */
  const PIECE_G_AIR = 17.5;
  const PIECE_DRAG_AIR = 0.32;
  const _pcur = { x: 0, z: 0 };
  // the live surface over this column, or null when it is not water at all
  // (CBZ.cityWaterAt is survival-wrapped, so this is honest on the island too)
  function pieceSeaY(x, z) {
    if (!CBZ.citySeaHeightAt) return null;
    try {
      if (CBZ.cityWaterAt && !CBZ.cityWaterAt(x, z)) return null;
      const y = CBZ.citySeaHeightAt(x, z);
      return (typeof y === "number" && isFinite(y)) ? y : null;
    } catch (e) { return null; }
  }
  // what a piece can come to rest on: the seabed under water (city/swim.js's
  // bathymetry, survival-wrapped to the arena's own field), the walkable
  // ground over land. surv.floorAt is the last resort — it answers 0 outside
  // the island modes, which is a rest at y=0.12 over whatever the sea is
  // doing, so it is only ever trusted when nothing better is loaded.
  function pieceFloorY(x, z, wet) {
    try {
      if (wet && typeof CBZ.citySeaBedYAt === "function") {
        const b = +CBZ.citySeaBedYAt(x, z); if (isFinite(b)) return b;
      }
      if (!wet && typeof CBZ.floorAt === "function") {
        const f = +CBZ.floorAt(x, z); if (isFinite(f)) return f;
      }
      if (CBZ.surv && typeof CBZ.surv.floorAt === "function") {
        const f = +CBZ.surv.floorAt(x, z); if (isFinite(f)) return f;
      }
    } catch (e) {}
    return null;
  }
  function pieceSettle(p, floor) {
    p.m.position.y = floor + 0.12;
    p.rest = true; p.afloat = false;
    p.rx = p.ry = p.rz = 0;
    p.vx = p.vy = p.vz = 0;
  }
  const _mpos = new THREE.Vector3();
  function stepPieces(dt) {
    for (let i = PIECES.length - 1; i >= 0; i--) {
      const p = PIECES[i], m = p.m;
      p.t += dt;
      if (p.carry > 0) {
        /* IN THE JAW. The mouth seam is a LOCAL point on the attacker's group,
           so reading it through matrixWorld is what makes the piece bank and
           roll with the head instead of hanging in the water where the bite
           happened. If the holder dies or leaves, the piece is dropped rather
           than following a corpse. */
        const mo = mouthOf(p.by);
        const g = p.by && p.by.group;
        if (!mo || !g || !g.parent || p.by.dead) { p.carry = 0; p.by = null; continue; }
        g.updateMatrixWorld(true);
        _mpos.set(mo.bite.x, mo.bite.y || 0, mo.bite.z || 0).applyMatrix4(g.matrixWorld);
        // where it was last frame tells us how fast the head is moving, and
        // that velocity is what the piece is released with
        if (p.lastX != null && dt > 1e-4) {
          p.vx = (_mpos.x - p.lastX) / dt; p.vy = (_mpos.y - p.lastY) / dt; p.vz = (_mpos.z - p.lastZ) / dt;
        }
        p.lastX = _mpos.x; p.lastY = _mpos.y; p.lastZ = _mpos.z;
        m.position.copy(_mpos);
        g.getWorldQuaternion(_q);
        // held as it was taken: the jaw's turn since then, never a snap to
        // the jaw's own axes
        if (!p.q0) p.q0 = _q.clone().invert().multiply(m.quaternion);
        m.quaternion.copy(_q).multiply(p.q0);
        m.rotateY(Math.sin(p.t * 9) * 0.25);            // worried in the mouth
        p.carry -= dt;
        if (p.carry <= 0) {
          // thrown by the shake, and given a little of the jaw's own toss
          p.vx *= 0.8; p.vy = p.vy * 0.8 + 0.6; p.vz *= 0.8;
          p.by = null;
        }
        continue;
      }
      if (!p.rest) {
        const sy = pieceSeaY(m.position.x, m.position.z);   // live surface, or null over dry ground
        if (p.afloat) {
          if (sy == null) {
            // drifted onto a column that is not water any more (a drawdown, a
            // sandbar): it is in the air now and falls like anything else
            p.afloat = false;
          } else {
            p.curT -= dt;
            if (p.curT <= 0) {
              p.curT = 0.4;
              p.cx = p.cz = 0;
              if (CBZ.waterField && CBZ.waterField.currentAt) {
                try {
                  const c = CBZ.waterField.currentAt(m.position.x, m.position.z, undefined, _pcur);
                  if (isFinite(c.x) && isFinite(c.z)) { p.cx = c.x; p.cz = c.z; }
                } catch (e) {}
              }
            }
            // the current, a slow swell set of its own, and whatever the throw left
            const kd = Math.exp(-1.2 * dt);
            p.vx *= kd; p.vz *= kd; p.vy = 0;
            m.position.x += (p.cx + Math.cos(p.setA) * 0.07 + p.vx) * dt;
            m.position.z += (p.cz + Math.sin(p.setA) * 0.07 + p.vz) * dt;
            m.position.y = sy - p.draft;
            // it rolls over flat and rides, rocking a little with the swell
            const ks = Math.exp(-2.5 * dt);
            p.rx *= ks; p.ry *= ks; p.rz *= ks;
            m.rotation.x += (p.rx + Math.sin(p.t * 1.7 + p.setA) * 0.05) * dt;
            m.rotation.y += p.ry * dt;
            m.rotation.z += (p.rz + Math.cos(p.t * 1.3 + p.setA) * 0.05) * dt;
            // the bed came up to meet it: washed up, and it stays there
            const floor = pieceFloorY(m.position.x, m.position.z, true);
            if (floor != null && floor + 0.12 >= m.position.y) pieceSettle(p, floor);
          }
        } else if (sy == null || m.position.y > sy) {
          /* AIR. Real gravity, light drag, the tumble the throw gave it. */
          const k = Math.exp(-PIECE_DRAG_AIR * dt);
          p.vy -= PIECE_G_AIR * dt;
          p.vx *= k; p.vy *= k; p.vz *= k;
          m.position.x += p.vx * dt; m.position.y += p.vy * dt; m.position.z += p.vz * dt;
          m.rotation.x += p.rx * dt; m.rotation.y += p.ry * dt; m.rotation.z += p.rz * dt;
          if (sy != null && m.position.y <= sy) {
            /* ENTRY: it hits the water. One water_wake splash sized to the
               piece (1 is a person, so a lobe off a seal is a small one and a
               slab off a megalodon's fluke is a real crash), and the water
               takes most of the velocity on the way in. */
            if (CBZ.waterSplashAt) {
              try { CBZ.waterSplashAt(m.position.x, sy, m.position.z, Math.max(0.3, Math.min(3, p.size * 1.6))); } catch (e) {}
            }
            p.vx *= 0.45; p.vy *= 0.35; p.vz *= 0.45;
            p.rx *= 0.5; p.ry *= 0.5; p.rz *= 0.5;
          } else if (sy == null) {
            // over dry ground: it lands on the ground and lies there
            const floor = pieceFloorY(m.position.x, m.position.z, false);
            if (floor != null && m.position.y <= floor + 0.12) pieceSettle(p, floor);
          }
        } else {
          /* WATER. Near-neutral, with its own sign: floaters rise to the
             surface and ride it, sinkers settle on the bed. Nothing rests
             anywhere else. */
          const k = Math.exp(-PIECE_DRAG * 0.55 * dt);
          p.vy += p.buoy * dt;
          p.vx *= k; p.vy *= k; p.vz *= k;
          m.position.x += p.vx * dt; m.position.y += p.vy * dt; m.position.z += p.vz * dt;
          m.rotation.x += p.rx * dt; m.rotation.y += p.ry * dt; m.rotation.z += p.rz * dt;
          p.rx *= k; p.ry *= k; p.rz *= k;
          if (p.buoy > 0 && m.position.y >= sy - p.draft) {
            m.position.y = sy - p.draft;
            p.vy = 0;
            p.afloat = true;
          }
          /* THE BOTTOM. The same bathymetry the swimmers and the spawners
             walk the sea floor with, so a lobe comes to rest on the real
             seabed and not at y=0. With no oracle it simply keeps sinking and
             the life timer takes it. */
          const floor = pieceFloorY(m.position.x, m.position.z, true);
          if (floor != null && m.position.y <= floor + 0.12) pieceSettle(p, floor);
        }
      }
      if (p.t >= p.life) {
        // the last two seconds are a shrink, not a pop (these share the RIG's
        // own opaque materials and must never fade one of those to transparent),
        // and it is driven off the REMEMBERED scale so a long frame cannot
        // compound the shrink into nothing early
        if (!p.s0) p.s0 = { x: m.scale.x, y: m.scale.y, z: m.scale.z };
        const f = Math.max(0, (p.life + 2 - p.t) * 0.5);
        if (f <= 0) { dropPiece(i); continue; }
        m.scale.set(p.s0.x * f, p.s0.y * f, p.s0.z * f);
      }
    }
  }


  /* PUTTING IT BACK IS A RESET, NOT HOUSEKEEPING: regrowing a fluke and
     healing its cuts is right for a match reset or a scene swap and a lie
     anywhere else, so this is reachable only from here and clearWounds. The
     sweeps below drop records and free memory; they never heal a body that
     is still in the world. */
  CBZ.creatureBiteChunkRestore = function (actor) {
    jobsForget(actor);
    for (let i = OWNED.length - 1; i >= 0; i--) if (!actor || OWNED[i].actor === actor) freeOwn(OWNED[i]);
    skinForget(actor);
    bleedStop(actor);
    for (let i = BITTEN.length - 1; i >= 0; i--) if (!actor || BITTEN[i].actor === actor) BITTEN.splice(i, 1);
    if (actor) actor._cbzKillCloud = 0;
  };
  CBZ.creatureBiteChunkAudit = function () {
    let removed = 0, severed = 0, craters = 0, marks = 0;
    for (let i = 0; i < OWNED.length; i++) { removed += OWNED[i].removed; severed += OWNED[i].severed; craters += OWNED[i].craters; }
    for (let i = 0; i < SKIN.length; i++) if (SKIN[i].actor && !SKIN[i].actor.char) marks++;
    return {
      actors: BITTEN.length, owned: OWNED.length, craters: craters, removedTris: removed, severedTris: severed,
      bleeders: BLEED.length, marks: marks, pieces: PIECES.length,
    };
  };
  // LEAK-PROOF: a body that left the scene drops its records and its own
  // geometry (the meshes went with the rig); a living body is never healed
  function bittenSweep() {
    for (let i = BITTEN.length - 1; i >= 0; i--) {
      const a = BITTEN[i].actor;
      if (!a || a.culled || !a.group || !a.group.parent) { BITTEN.splice(i, 1); if (a) bleedStop(a); }
    }
    for (let i = BLEED.length - 1; i >= 0; i--) {
      const a = BLEED[i].actor;
      if (!a || a.culled || !a.group || !a.group.parent) {
        if (BLEED[i].h && CBZ.goreChumStop) { try { CBZ.goreChumStop(BLEED[i].h); } catch (e) {} }
        BLEED.splice(i, 1);
      }
    }
    ownSweep();
  }

  /* ---- THE KILL PAYOFF ----------------------------------------------------
     A bitten animal that dies under water gets gore.js's kill cloud (a full
     burst, a slow haze shell, a slick above), once, the frame after it stops,
     at its last wound, sized to the animal. goreKillCloud refuses dry land, so
     a wolf dying in a forest is unaffected. Six reads a second while anything
     bitten is alive. */
  function deathScan() {
    for (let i = 0; i < BITTEN.length; i++) {
      const r = BITTEN[i], a = r.actor;
      if (!a || !a.dead || a._cbzKillCloud) continue;
      a._cbzKillCloud = 1;
      if (typeof CBZ.goreKillCloud !== "function" || !a.group) continue;
      _cbv.set(r.lx, r.ly, r.lz);
      a.group.updateWorldMatrix(true, false);
      a.group.localToWorld(_cbv);
      // the cloud scales with the ANIMAL: a tuna is a puff, an orca is weather
      const L = (typeof CBZ.marineBodyLen === "function") ? CBZ.marineBodyLen(a) : 0;
      try { CBZ.goreKillCloud(_cbv.x, _cbv.y, _cbv.z, { size: Math.max(0.5, Math.min(2.6, (L > 0 ? L : 4) * 0.22)) }); } catch (e) {}
    }
  }

  // ---- reset: detach everything ---------------------------------------------
  CBZ.clearWounds = function () {
    jobsForget(null);
    CBZ.creatureBiteChunkRestore(null);
    bleedStop(null);
    piecesClear();                 // pieces are scene-parented: they do NOT go with the rigs
    skinForget(null); ANIM.length = 0;
    for (let i = 0; i < wounds.length; i++) {
      const r = wounds[i];
      r.gone = true;
      if (r.m.parent) r.m.parent.remove(r.m);
      if (free.length < 36) free.push(r.m);
      if (r.actor) { r.actor._woundN = 0; if (r.actor.char) r.actor.char.legHurt = null; }
    }
    wounds.length = 0;
  };
  // ONE BODY'S HOLES, gone: the rig is being handed to a new person (crowd.js
  // promotion) or the player respawned. Never called on a timer.
  CBZ.woundsForget = function (actor) {
    if (!actor) return;
    if (actor.isPlayer && !actor.char && CBZ.playerWoundActor) actor = CBZ.playerWoundActor;
    for (let i = wounds.length - 1; i >= 0; i--) if (wounds[i].actor === actor) dropWound(i);
    actor._woundN = 0;
    jobsForget(actor);
    skinForget(actor);
  };

  // chain onto CBZ.clearGore (match reset / scene swap) — checked lazily every
  // frame (cheap flag read) so script order vs gore.js never matters.
  function wrapClearGore() {
    const orig = CBZ.clearGore;
    CBZ.clearGore = function () { CBZ.clearWounds(); return orig.apply(this, arguments); };
    CBZ.clearGore._wounds = true;
  }

  // ---- one updater: ZERO cost while nobody is hurt --------------------------
  // record lifecycle rides cheap throttles; a bite's marks animate only while
  // their blood is spreading, their bruise darkening, their rakes healing.
  // A hole has NO timeout: it goes only with its body (or a cap).
  let tick = 0, sweepT = 0, deadT = 0, skinT = 0;
  CBZ.onAlways(9, function (dt) {
    if (CBZ.clearGore && !CBZ.clearGore._wounds) wrapClearGore();
    if (JOBS.length) {
      const t0 = performance.now();
      jobsRun(BITE_BUDGET);
      LEDGER.jobFrameMsMax = Math.max(LEDGER.jobFrameMsMax, performance.now() - t0);
    }
    if (!skinWarmed) skinWarm(dt);  // paint the bite atlases ahead of the first bite
    if (BITTEN.length || OWNED.length || BLEED.length) {
      sweepT += dt; if (sweepT > 1.1) { sweepT = 0; bittenSweep(); }
      // a death has to read on the frame it happens, not on the 1.1 s sweep
      deadT += dt; if (deadT > 0.16) { deadT = 0; deathScan(); }
    }
    // pieces: at most eight, the only thing here that lives for half a minute
    if (PIECES.length) stepPieces(dt);
    if (ANIM.length) animAll(dt);
    if (SKIN.length) { skinT += dt; if (skinT > 0.8) { skinSweep(skinT); skinT = 0; } }
    if (!wounds.length) return;   // the whole system sleeps
    tick += dt;
    if (tick < 0.8) return;
    const step = tick;
    tick = 0;
    for (let i = wounds.length - 1; i >= 0; i--) {
      const r = wounds[i], a = r.actor;
      // rig gone (corpse cull) → free the record. A rig merely DETACHED (a car
      // seat, a cutscene, a crowd park) keeps its holes for a while: a rig
      // handed to a new person is wiped by CBZ.woundsForget at the hand-off,
      // and the player's own body is never swept.
      if (!a || a.culled) { dropWound(i); continue; }
      if (!a.isPlayer && (!a.group || !a.group.parent)) {
        r.off = (r.off || 0) + step;
        if (r.off > 20) { dropWound(i); continue; }
      } else r.off = 0;
      r.age += step;
      // torn flesh scabs over on the same clock a bullet hole does
      if ((r.kind === "shot" || r.kind === "bite" || r.kind === "blade") && !r.dried && r.age > DRY_T) { r.dried = true; r.m.material = MAT_DRY; }
    }
  });
})();
