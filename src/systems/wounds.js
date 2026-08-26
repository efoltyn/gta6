/* ============================================================
   systems/wounds.js — THE BODY CARRIES THE HITS (universal gore).

   Shoot someone and the damage stays LEGIBLE on the rig:
     • WOUND DECALS: tiny dark entry-wound discs stamped on the exact body
       part at the exact hit point (world hit → part-local, snapped to the
       face the bullet came through, sitting slightly proud). ONE shared
       CircleGeometry + 3 shared unlit materials (fresh dark red → drying
       brown after ~12s; blunt hits leave a bruise-dark patch, no hole).
       Per-wound scale jitter so no two holes are identical.
     • LOCAL SOAK PATCH: an irregular dark stain SPREADS AROUND each entry
       wound over a few seconds — anchored to the wound, riding the same
       body part. Never a whole-garment recolor (the old clean→bloodied→
       soaked material ladder turned people maroon — DELETED). 3 shared
       blob geometries (per-vertex radial jitter baked at startup) + random
       spin + per-axis stretch keep any two stains from matching.
     • SEVERITY READS: headshot = wound at the head + a HEAVY insta-spread
       splatter on the head that runs down onto the collar (a second stain
       seated at the top of the shirt); a shotgun blast scatters 2-3 wounds
       (per-pellet calls collapse into one ≤3-wound burst); melee blunt =
       bigger bruise patch, no hole, no blood.

   Budget discipline (the game is draw-call bound):
     • hard caps: CITY 22 meshes per actor (a hit = wound + its soak stain,
       so ~11 readable hits — a riddled body reads genuinely shot up) / 320
       global; JAIL+SURVIVAL keep 10 per actor / 200 global byte-identical.
       Both recycle oldest-first (wounds keep ACCUMULATING — shooting a
       corpse adds holes — but stay bounded); a free-mesh pool so churn
       never reallocates (geometry/material reassigned on reuse — both
       shared, nothing cloned or disposed).
     • wounds are CHILDREN of the rig's part meshes → they animate, fall
       and despawn WITH the body for free; a throttled (0.8s) sweep frees
       records once a rig leaves the scene. Soak growth ticks per-frame
       ONLY while a stain is actively spreading (a few seconds per hit);
       the whole system sleeps when nobody is being shot (one early-out).
     • spawn distance-gated at 45u (matches gore.js's LOD band) so far
       NPC-vs-NPC scraps cost nothing.

   Public API:
     CBZ.bodyWound(actor, worldPoint, opts) — opts:
        { head:bool, cal|caliber:0.7..1.6, mm:<bore in millimetres>,
          melee:"blunt"|"blade"|true, dir:{x,y,z} through-direction,
          fromX, fromZ }  (fromX/Z bias a synthetic centre-point toward
          the attacker so the wound lands on the facing surface, AND are
          the fallback source of the through-direction)
     CBZ.bodyBite(actor, worldPoint, {jaw, sev, sever})
     CBZ.woundDecalAudit() → {decals, oversized, cameraFacing} — the ratchet.
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
  function capBase() { return (CBZ.qScale ? CBZ.qScale(100, 400) : 200) | 0; }
  function capCity() { return (CBZ.qScale ? CBZ.qScale(160, 640) : 320) | 0; }
  // wound+stain pairs per body — also rides the quality tier
  function perActorBase() { return (CBZ.qScale ? CBZ.qScale(5, 20) : 10) | 0; }
  function perActorCity() { return (CBZ.qScale ? CBZ.qScale(11, 44) : 22) | 0; }
  function capGlobal() { return cityWounds() ? capCity() : capBase(); }
  function perActor() { return cityWounds() ? perActorCity() : perActorBase(); }
  const SPAWN_D2 = 45 * 45; // matches gore.js's "only where it can be seen" band
  const DRY_T = 12;         // seconds until a fresh wound dries brown
  const PROUD = 0.013;      // how far the disc sits off the surface (no z-fight)
  const PROUD_SOAK = 0.008; // the stain sits UNDER its wound disc

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
  const EXIT_MAX_FRAC = 0.34;      // a blowout is a third of the panel, not more
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
  //  OPAQUE material cannot dissolve anything (2026-08-26). MAT_SOAK was a
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
      // MAT_SOAK, the edge all but vanishes into the cloth.
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
  const G_SOAK = [blobGeo(), blobGeo(), blobGeo()];

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
  const RO_SOAK = 0.1, RO_WOUND = 0.2;   // see the renderOrder note in unlit()
  const MAT_FRESH = unlit(0x4e070b);   // fresh entry wound: near-black red
  const MAT_DRY = unlit(0x351409);     // dried: dark brown scab
  const MAT_BRUISE = unlit(0x3a2334);  // blunt trauma: purple-dark, no hole
  const MAT_SOAK = unlit(0x310609, -1); // wet cloth around the hole: near-black
  // TORN flesh (a bite) is WETTER and brighter than a bullet's cauterised-looking
  // entry hole — a tooth tears the skin open rather than punching through it.
  const MAT_TORN = unlit(0x6b0d10);
  // An EXIT is wetter and redder still: it is not a hole, it is an opening.
  const MAT_EXIT = unlit(0x8a1014);

  // WOUNDS_BITE — the one-line revert for the bite/maul wound type below.
  // OFF: a bite falls back to the ordinary "shot" wound it used to leave.
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.WOUNDS_BITE == null) CBZ.CONFIG.WOUNDS_BITE = true;

  const wounds = [];   // FIFO: { m, actor, age, kind, dried, gone, (soak: gx,gy,gt,t) }
  const growing = [];  // soak records still spreading (per-frame, short-lived)
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
  const LEDGER = { biteCalls: 0, biteMarks: 0, woundCalls: 0, woundMarks: 0, refusals: 0, lastRefusal: "" };
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
     which one the point is nearest — the same measured, name-free method
     partAt() already uses for wildlife, in the same file. It is correct for
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
    r.gone = true;                               // growing[] skips stale refs
    if (r.m.parent) r.m.parent.remove(r.m);
    if (r.actor) r.actor._woundN = Math.max(0, (r.actor._woundN || 1) - 1);
    if (!reuse && free.length < 36) free.push(r.m);  // reuse = caller takes the mesh
    return r.m;
  }
  function meshFor(actor) {
    // per-actor cap: recycle THIS body's oldest hit first (keeps wounds
    // ACCUMULATING — shooting a corpse keeps adding holes — but bounded).
    if ((actor._woundN || 0) >= perActor()) {
      for (let i = 0; i < wounds.length; i++) {
        if (wounds[i].actor === actor) return dropWound(i, true);
      }
    }
    if (free.length) return free.pop();
    if (wounds.length >= capGlobal()) return dropWound(0, true);   // global cap: oldest-first
    const m = new THREE.Mesh(G_WOUND, MAT_FRESH);
    m.castShadow = m.receiveShadow = false;
    return m;
  }

  // ---- LOCAL SOAK: an irregular stain spreads around the entry point --------
  // a child of the SAME part, seated on the SAME face, under the wound disc;
  // grows from a blot to full spread over `growT` seconds (per-frame while
  // active, then it costs nothing).
  function spawnSoak(actor, part, lp, size, growT) {
    const m = meshFor(actor);
    const geo = G_SOAK[(Math.random() * 3) | 0];
    m.geometry = geo;
    m.material = MAT_SOAK;
    m.renderOrder = RO_SOAK;      // under its own hole (see unlit()'s renderOrder note)
    const ax = faceAxis(part, lp);         // one face for the clamp AND the seat
    // A stain can never outgrow the panel it's soaked into — bigger than the
    // face, it reads as a rigid sheet hovering off the body (user-filmed).
    //
    // THE OLD CAP DID NOT DO THAT, and it is the disc in the screenshot. It
    // compared a RADIUS against the part's FULL WIDTH (`min(w,h,d)*1.05`), an
    // off-by-two that let a head stain grow to 0.98 m across on a 0.60 m head —
    // 163% of the face — while the comment above it claimed it was capped. The
    // cap now measures against the HALF-span of the face the stain is seated
    // on, through the same fitR() every other decal uses, and folds in the blob
    // geometry's own ±41% rim wobble so a stain cannot overhang by its wobble
    // either.
    let gx, gy;
    if (v2()) {
      const mh = faceMin(part, ax);
      const cap = fitR(geo, mh, mh);
      gx = Math.min(cap, size * (0.8 + Math.random() * 0.5));
      gy = Math.min(cap, size * (0.8 + Math.random() * 0.5));
    } else {
      const pp = part.geometry && part.geometry.parameters || {};
      const cap = Math.max(0.16, Math.min(pp.width || 0.5, pp.height || 0.7, pp.depth || 0.4) * 1.05);
      gx = Math.min(cap, size * (0.8 + Math.random() * 0.5));
      gy = Math.min(cap * 1.25, size * (0.8 + Math.random() * 0.5));
    }
    seat(m, part, lp, v2() ? PROUD_SOAK_V2 : PROUD_SOAK, undefined, ax,
         v2() ? Math.max(gx, gy) * geo._maxR : 0);
    m.scale.set(gx * 0.35, gy * 0.35, 1);
    part.add(m);
    const r = { m, actor, age: 0, kind: "soak", dried: true, gx, gy, gt: growT, t: 0 };
    wounds.push(r);
    growing.push(r);
    actor._woundN = (actor._woundN || 0) + 1;
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
  //  BITE / MAUL — the wound a MOUTH leaves.
  //
  //  WHY THIS EXISTS: every creature in this game that bites you — dogs, wolves,
  //  bears, big cats, snakes, and now sharks — used to stamp the same single
  //  round disc a 9mm leaves. That reads as "you were shot by an invisible
  //  pistol", not as "something got its teeth into you", and it was the reason
  //  animal attacks never looked dangerous no matter how much damage they did.
  //
  //  A jaw does not punch one hole. It closes, so it leaves TWO OPPOSING
  //  CRESCENTS of punctures — the upper and lower tooth rows — with torn, wet
  //  edges between them, and it bleeds far harder and faster than a bullet
  //  because it tears rather than penetrates. That silhouette is instantly
  //  legible even at gameplay distance and even on a low-poly rig: the player
  //  reads "bitten" without being told.
  //
  //  Shared on purpose (BLOCK LAW): the caller passes only the JAW SIZE it
  //  actually has. A terrier's 0.14 and a megalodon's 1.2 run the identical
  //  code and produce correctly-scaled marks — nothing here is shark-specific.
  //
  //    CBZ.bodyBite(actor, worldPoint, opts)
  //      jaw    jaw RADIUS in metres (dog ~0.16, wolf ~0.22, bear ~0.34,
  //             great white ~0.55, megalodon ~1.2). Default 0.22.
  //      teeth  punctures per arc (clamped 3..6, quality-scaled). Default 5.
  //      double both tooth rows (default true; false = a raking single-row swipe)
  //      sev    0..1 severity — scales the tear, the soak and the limp. Default 0.7
  //      sever  true = this bite may take the limb clean off (routes to
  //             CBZ.goreSever, which owns the stump cap + the restore audit)
  //      fromX/fromZ, head  — same meaning as bodyWound
  // ============================================================
  const _bl = { x: 0, y: 0, z: 0 };     // reused local-point scratch (no allocation)
  CBZ.bodyBite = function (actor, wp, opts) {
    opts = opts || {};
    if (!(CBZ.CONFIG && CBZ.CONFIG.WOUNDS_BITE)) {          // flag off → the old read
      // _fromBite stops the melee:"bite" router below bouncing straight back here.
      return CBZ.bodyWound(actor, wp,
        { head: opts.head, cal: 1.3, fromX: opts.fromX, fromZ: opts.fromZ, _fromBite: true });
    }
    LEDGER.biteCalls++;
    if (!actor) { refuse("bite:no-actor"); return; }
    if (!wp) { refuse("bite:no-point"); return; }
    if (actor.culled) { refuse("bite:culled"); return; }
    if (!CBZ.scene) { refuse("bite:no-scene"); return; }
    const ch = actor.char;
    if (!ch) { refuse("bite:no-char"); return; }
    if (!ch.skinSlots) { refuse("bite:no-skinSlots"); return; }
    if (!actor.group) { refuse("bite:no-group"); return; }
    /* WAS: `actor.group.visible === false` -> refuse.

       That is a RENDER flag being used as an EXISTENCE test, and it is wrong
       for a system whose marks are persistent state. entities/pedinstance.js,
       city/crowd.js and city/police.js all park rigs by flipping `visible`,
       and restrain.js seats a body the same way — so a hit taken while a rig
       happens to be parked, instanced or seated was silently thrown away and
       the body came back CLEAN. A wound is a fact about the body, not about
       whether the renderer is drawing it this frame.

       The honest test is whether the rig is in the world at all, and it is
       the exact one the leak sweep at the bottom of this file already uses
       (`!a.group.parent` -> drop the record). A detached group can carry no
       decal because there is nothing to parent it to; an attached-but-hidden
       one will show every mark the moment it is drawn again. */
    if (!actor.group.parent) { refuse("bite:detached"); return; }
    let px = wp.x, py = wp.y, pz = wp.z;
    if (px == null || py == null || pz == null) { refuse("bite:null-coord"); return; }
    if (dist2Cam(px, pz) > SPAWN_D2) { refuse("bite:too-far"); return; }   // only where it can be seen

    // A bite is ONE event that intentionally lays many marks, so it stamps the
    // burst window rather than being throttled by it (the shotgun-pellet guard
    // in bodyWound would otherwise eat most of the tooth row). Re-biting the
    // same body inside the window is still refused.
    const now = performance.now();
    if (now - (actor._biteT || -1e9) < 260) { refuse("bite:rebite-throttle"); return; }
    actor._biteT = now; actor._woundT = now; actor._woundBurst = 99;

    const sev = Math.max(0, Math.min(1, opts.sev != null ? opts.sev : 0.7));
    const jawR = Math.max(0.08, Math.min(1.4, opts.jaw != null ? opts.jaw : 0.22));

    // bias the mark toward the face the jaw closed on, same trick bodyWound uses
    if (opts.fromX != null && opts.fromZ != null) {
      let nx = opts.fromX - px, nz = opts.fromZ - pz;
      const nl = Math.hypot(nx, nz);
      if (nl > 0.01) { px += (nx / nl) * 0.4; pz += (nz / nl) * 0.4; }
    }

    const pick = pickPart(actor, px, py, pz, !!opts.head);
    const part = pick.mesh;
    if (!part || !part.geometry) { refuse("bite:no-part"); return; }
    LEDGER.biteMarks++;

    part.updateWorldMatrix(true, false);
    const lp = tmpV.set(px, py, pz);
    part.worldToLocal(lp);
    const cx = lp.x, cy = lp.y, cz = lp.z;
    const ax = faceAxis(part, lp);                          // ONE face for the whole jaw

    // Teeth are laid in the face's tangent plane. Which two local components
    // that is depends on which face we're on — pick them once, up front.
    //   ax "x" -> tangents (z, y)   ax "y" -> tangents (x, z)   ax "z" -> (x, y)
    const t1 = ax === "x" ? "z" : "x";
    const t2 = ax === "y" ? "z" : "y";

    // A LIMB the jaws closed around gets the bite wrapped around it rather than
    // stamped flat, so shrink the arc to the part it actually has to fit on.
    const prm = part.geometry.parameters || {};
    const fit = Math.max(0.12, Math.min(prm.width || 0.5, prm.height || 0.8, prm.depth || 0.4));
    const R = Math.min(jawR, fit * 0.85);
    // Individual TEETH obey the same clamp everything else does. A megalodon
    // puncture is 0.135 across before this, which clears a 0.60 head but is
    // wider than a 0.27 forearm — the exact failure the bullet hole had, just
    // rarer. One line, and CBZ.woundDecalAudit().oversized stays at zero for
    // bites as well as bullets.
    const biteHalf = faceMin(part, ax);

    const roll = Math.random() * 6.28;                      // the jaw's angle of attack
    const cosR = Math.cos(roll), sinR = Math.sin(roll);
    const qn = CBZ.qScale ? CBZ.qScale(3, 6) : 5;
    let n = Math.max(3, Math.min(6, Math.round(opts.teeth != null ? opts.teeth : qn)));
    const rows = opts.double === false ? 1 : 2;
    // FIT THE WHOLE JAW IN ONE BUDGET. meshFor() recycles this body's OLDEST
    // wound when the per-actor cap is hit — fine for successive bullets, but a
    // bite is one event laying many marks, so an over-budget arc would eat its
    // own first teeth while still drawing its last ones and leave a lopsided
    // half-print. (Bites at 12-14 meshes clear the CITY cap at every tier, but
    // jail/survival at tiers 0-1 cap at 5/9.) Thin the tooth row instead — a
    // sparser jaw still reads as a jaw; a half-erased one reads as a bug.
    const budget = perActor() - 2;                          // reserve the 2 soak stains
    if (rows * n > budget) n = Math.max(2, Math.floor(budget / rows));

    for (let r = 0; r < rows; r++) {
      const side = r === 0 ? 1 : -1;                        // upper row / lower row
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;      // -1..1 across the jaw
        // a crescent, not a line: the row bulges away from the bite centre and
        // the outermost teeth pull back — the shape a closing mouth actually makes
        const along = t * R;
        const out = side * (R * (0.34 + 0.42 * (1 - t * t)));
        // rotate (out, along) by the jaw roll into the face's tangent plane
        const o1 = out * cosR - along * sinR;
        const o2 = out * sinR + along * cosR;
        const m = meshFor(actor);
        m.geometry = G_WOUND;
        m.material = MAT_TORN;
        m.renderOrder = RO_WOUND;
        _bl.x = cx; _bl.y = cy; _bl.z = cz;
        _bl[t1] += o1; _bl[t2] += o2;
        // jitter: teeth are not evenly spaced and a couple always tear wider
        _bl[t1] += (Math.random() - 0.5) * R * 0.16;
        _bl[t2] += (Math.random() - 0.5) * R * 0.16;
        const s0 = (0.030 + 0.030 * sev) * (0.75 + Math.random() * 0.7);
        let tw = s0 * 0.72, th = s0 * 1.55;                 // a tooth tears long, not round
        if (v2()) {
          const k = fitR(G_WOUND, th, biteHalf) / th;       // shrink BOTH axes together
          tw *= k; th *= k;
        }
        // every puncture rakes the same way (the jaw dragged) — a coherent row
        // reads as one bite; individually-spun discs read as random buckshot.
        seat(m, part, _bl, v2() ? proudFor(th) : PROUD, roll + (Math.random() - 0.5) * 0.5, ax,
             v2() ? th * G_WOUND._maxR : 0);
        m.scale.set(tw, th, 1);
        part.add(m);
        wounds.push({ m, actor, age: 0, kind: "bite", dried: false });
        actor._woundN = (actor._woundN || 0) + 1;
      }
    }

    /* THE TEAR: a bite bleeds far harder and faster than a bullet — one broad
       stain filling the whole jaw print, arriving fast, plus a heavier second
       bloom for a deep bite. This is most of what sells it at distance.

       AND IT WAS SIZED OFF THE JAW, WHICH IS THE ONE THING IT MUST NOT BE.
       Measured on the adult male thigh (legW 0.34, legUp 0.48, so the panel a
       bite seats on is 0.34 wide, half-span 0.17): a great white's 0.55 jaw
       gives R = 0.289, and `R * (1.7 + sev*1.1)` at sev 0.7 asks for 0.714 —
       a stain FOUR TIMES the width of the leg. spawnSoak's fitR() rail then
       chopped it to 0.116 and the wound came out looking identical for every
       animal in the game, because EVERY bite of consequence was pinned flat
       against the safety rail. This file's own doctrine, thirty lines up in
       the bullet path: "a design number that only works because the safety
       rail catches it is not a design number."

       So the stain is quoted the way the bullet's is — as a fraction of the
       PANEL, with the jaw only deciding how much of that fraction it earns.
       Finished width (after spawnSoak's own 0.8-1.3 growth jitter and the blob
       geometry's ±41% rim wobble, i.e. ×1.48 at the mean) lands near 49% of
       the panel for the first stain and 74% for the heavy second one, peaking
       at 91% for a maximum-severity full-jaw bite. Heavy, unmistakably blood,
       and it clears the 96% rail on its own arithmetic rather than by being
       caught. woundDecalAudit().oversized therefore stays at zero without the
       clamp ever having to fire. */
    _bl.x = cx; _bl.y = cy; _bl.z = cz;
    // how much of the panel the jaw actually spans: a terrier gets ~0.5, a
    // great white on a limb gets the lot. (biteHalf is the panel half-span
    // already measured above for the tooth clamp — no second measurement.)
    const jawSpan = Math.max(0.35, Math.min(1, R / (biteHalf * 1.5)));
    spawnSoak(actor, part, _bl, biteHalf * (0.26 + sev * 0.10) * jawSpan, 0.7);
    if (sev > 0.55) spawnSoak(actor, part, _bl, biteHalf * (0.36 + sev * 0.14) * jawSpan, 1.9);

    // A MAULED LEG is not a limp, it's a collapse. Reuse character.js's existing
    // legHurt channel (same field the bullet path writes) — no new state.
    if ((pick.region === "legL" || pick.region === "legR") && !actor.isPlayer && !ch.legGone) {
      const s2 = pick.region === "legL" ? -1 : 1;
      const prev = ch.legHurt;
      const sevNew = Math.min(1, (prev && prev.side === s2 ? prev.sev : 0) + 0.5 + sev * 0.5);
      if (!prev || prev.side === s2 || sevNew > prev.sev) ch.legHurt = { side: s2, sev: sevNew, t: 9999 };
    }

    // THE LIMB COMES OFF — routed to gore.js, which already owns the stump cap,
    // the flying part and the guaranteed restore-on-rig-reuse audit. We never
    // hide a limb ourselves; that bookkeeping has exactly one owner.
    if (opts.sever && CBZ.goreSever && !actor.isPlayer) {
      // THE HEAD WAS MISSING FROM THIS MAP, and it is the one a shark takes.
      // gore.js's STUMPS table has always carried a "head" entry (it is what
      // death.js drives for the player's own decapitation, and severBody
      // treats it as the whole neck group so the face flies with the skull) —
      // this map simply never named it, so a bite to the head could not sever
      // no matter how big the jaw or how explicit the caller. One entry.
      // TORSO stays out on purpose: there is no stump for a body.
      const key = pick.region === "legL" ? "ll" : pick.region === "legR" ? "rl"
        : pick.region === "armL" ? "la" : pick.region === "armR" ? "ra"
        : pick.region === "head" ? "head" : null;
      // AND IT LEAVES ALONG THE JAW'S LINE. gore.js throws a severed part
      // along opts.dir and picks a RANDOM azimuth when there isn't one — so
      // every limb this file took off flew in a direction unrelated to the
      // animal that bit it. throughDir() already turns the caller's ray, or
      // failing that its fromX/fromZ (which every predator here passes, and
      // which IS attacker → bite point), into exactly that line.
      if (key) { try { CBZ.goreSever(actor, key, { dir: opts.dir || throughDir(opts, wp) }); } catch (e) {} }
    }
  };

  // ---- CBZ.bodyWound(actor, worldPoint, opts) -------------------------------
  CBZ.bodyWound = function (actor, wp, opts) {
    LEDGER.woundCalls++;
    if (!actor) { refuse("wound:no-actor"); return; }
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
    let px = wp.x, py = wp.y, pz = wp.z;
    if (px == null || py == null || pz == null) { refuse("wound:null-coord"); return; }
    if (dist2Cam(px, pz) > SPAWN_D2) { refuse("wound:too-far"); return; }   // only where it can be seen

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

    const melee = opts.melee === true ? "blunt" : opts.melee;
    const kind = melee === "blunt" ? "bruise" : (melee === "blade" ? "blade" : "shot");
    const cal = opts.cal != null ? opts.cal : (opts.caliber != null ? opts.caliber : 1);

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
    if ((pick.region === "legL" || pick.region === "legR") && kind !== "bruise" &&
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
    let mat = kind === "bruise" ? MAT_BRUISE : MAT_FRESH;
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
      // bigger (it's the kill tell); a bruise is a broad flat patch; a blade
      // leaves a thin slash. Every wound carries its own jitter — no two match.
      s0 = 0.045 + 0.032 * cal;
      if (pick.region === "head") s0 *= 1.15;
      if (kind === "bruise") {
        /* A BRUISE WAS FOUR TIMES WIDER THAN A BULLET HOLE. (OWNER: "the
           bruise is way too big too.")

           Measured on the 0.60-unit adult head this file already sizes
           everything against: `s0 * 2.2` with cal 1 gives a 0.169 patch, which
           is 28% of the head — while the bullet path a few lines up was
           deliberately tuned DOWN to 0.043 across, "1 face in 14", i.e. 7%.
           A fist left a mark four times the width of a gunshot.

           A contusion IS broader than a puncture, so this stays the widest
           wound in the file — just not by a factor of four. 0.95 puts it near
           0.073, about 1 face in 8: plainly bigger than a bullet hole, plainly
           a mark rather than a splodge. The jitter is kept so no two match. */
        const b = s0 * 0.95;
        sx = b * (0.85 + Math.random() * 0.3); sy = b * (0.7 + Math.random() * 0.3);
      } else if (kind === "blade") {
        sx = s0 * (0.45 + Math.random() * 0.2); sy = s0 * (1.7 + Math.random() * 0.4);
      } else {
        sx = s0 * (0.85 + Math.random() * 0.3); sy = s0 * (0.85 + Math.random() * 0.3);
      }
    }

    // ---- ONE CLAMP, AND IT IS THE LAST WORD ---------------------------------
    // Every kind runs through it, including the bruise and the slash: a blunt
    // patch wider than the forearm it sits on reads exactly as fake as an
    // oversized bullet hole did. It measures the decal's TRUE outer radius (its
    // scale times its own geometry's rim wobble) against the half-span of the
    // face, so its diameter can never reach that face's width — which is the
    // single invariant CBZ.woundDecalAudit().oversized pins at zero.
    if (v2on) {
      const mx = Math.max(sx, sy), k = fitR(geo, mx, minHalf) / mx;
      if (k < 1) { sx *= k; sy *= k; }
    }

    const rad = Math.max(sx, sy);
    m.geometry = geo;
    m.material = mat;
    m.renderOrder = RO_WOUND;
    seat(m, part, lp, v2on ? proudFor(rad) : PROUD, undefined, ax, v2on ? rad * geo._maxR : 0);
    m.scale.set(sx, sy, 1);
    part.add(m);   // rides the part: animates, ragdolls and despawns with the rig
    wounds.push({ m, actor, age: 0, kind, dried: false });
    actor._woundN = (actor._woundN || 0) + 1;

    // ---- THE EXIT IS THE BIG ONE ---------------------------------------------
    //  A rifle round that goes through leaves a small tidy hole where it went in
    //  and a torn cavity where it came out — the asymmetry IS the read, and it
    //  is why a single mark on the near side always looked like a decal. Only
    //  fired when the round genuinely went through: heavy enough (strictly
    //  above fpsmode's own heavyRound line, so an untyped default does not),
    //  a real direction available (never guessed — see throughDir), and at
    //  least EXIT_MIN_TRAVEL of part crossed rather than a graze.
    let exitAt = null;
    if (shotV2 && cal > EXIT_MIN_CAL) {
      const dir = throughDir(opts, wp);
      const dl = dir ? localDir(part, wp, dir) : null;
      const ex = dl ? boxExit(part, lp, dl) : null;
      if (ex && ex.t > EXIT_MIN_TRAVEL) {
        // An exit runs 3.5x (pistol-plus) to 6.2x (rifle) the entry bore before
        // the panel caps it — the real ratio is wider still, but a third of the
        // face is where a mark stops being a wound and starts being a sticker.
        const eHalf = faceMin(part, ex.ax);
        const eWant = rad * (1.6 + 2.4 * Math.min(2.4, cal));
        const eCap = capR(G_EXIT, eHalf, EXIT_MAX_FRAC);
        let esx = Math.min(eWant * (0.85 + Math.random() * 0.35), eCap);
        let esy = Math.min(eWant * (0.85 + Math.random() * 0.35), eCap);
        const emx = Math.max(esx, esy), ek = fitR(G_EXIT, emx, eHalf) / emx;
        if (ek < 1) { esx *= ek; esy *= ek; }
        const er = Math.max(esx, esy);
        const em = meshFor(actor);
        em.geometry = G_EXIT;
        em.material = MAT_EXIT;
        em.renderOrder = RO_WOUND;
        seat(em, part, ex, proudFor(er), undefined, ex.ax, er * G_EXIT._maxR);
        em.scale.set(esx, esy, 1);
        part.add(em);
        wounds.push({ m: em, actor, age: 0, kind: "shot", dried: false });
        actor._woundN = (actor._woundN || 0) + 1;
        exitAt = ex;
      }
    }

    // ---- LOCAL SOAK STAIN (a bruise doesn't bleed) ----
    // the cloth around the hole goes dark and keeps spreading for a few
    // seconds — local, irregular, anchored to THIS wound. Headshot = heavy
    // fast splatter on the head PLUS a run-down stain seated at the collar.
    if (kind !== "bruise") {
      if (shotV2) {
        // THE STAIN IS NOW THE VISIBLE WOUND, so it is sized off the ENERGY and
        // the PART rather than off the (correctly tiny) hole — otherwise
        // shrinking the hole by 4x would have silently shrunk the blood by 4x
        // and left the body looking untouched. gore.js still owns the spray,
        // the pool and the underwater bloom; this is only the local soak.
        //
        // Sized so the FINISHED stain (after spawnSoak's own 0.8-1.3 growth
        // jitter and the blob's ±33% rim wobble) lands at 49% of the panel's
        // width for a 9 mm and 66% for a rifle round — heavy, obviously blood,
        // and never near the 96% rail. It used to reach 159% on a head and
        // 350% on an arm. Deliberately NOT cap-bound: a design number that only
        // works because the safety rail catches it is not a design number.
        const soakR = minHalf * (0.19 + 0.12 * Math.min(2.4, cal));
        // blood runs from the EXIT, not the entry — when we know where that is,
        // the heavy stain goes there and the entry keeps only its own seep.
        spawnSoak(actor, part, exitAt || lp, soakR * (exitAt ? 1.25 : 1), exitAt ? 1.6 : 2.4);
        if (pick.region === "head") {
          const torso = ch.skinSlots.torso && ch.skinSlots.torso[0];
          if (torso && torso.geometry) {
            torso.updateWorldMatrix(true, false);
            tmpV.set(px, py, pz);
            torso.worldToLocal(tmpV);                     // same side the round came from
            const tp = torso.geometry.parameters || {};
            tmpV.y = (tp.height || 0.9) * 0.5 * 0.72;     // up at the collar line
            spawnSoak(actor, torso, tmpV, soakR * 1.2, 1.1);
          }
        }
      } else if (pick.region === "head") {
        spawnSoak(actor, part, lp, s0 * 3.4, 0.6);
        const torso = ch.skinSlots.torso && ch.skinSlots.torso[0];
        if (torso && torso.geometry) {
          torso.updateWorldMatrix(true, false);
          tmpV.set(px, py, pz);
          torso.worldToLocal(tmpV);                       // same side the round came from
          const tp = torso.geometry.parameters || {};
          tmpV.y = (tp.height || 0.9) * 0.5 * 0.72;       // up at the collar line
          spawnSoak(actor, torso, tmpV, s0 * 3.8, 1.1);
        }
      } else {
        const heavy = kind === "shot" && cal >= 1.25;
        spawnSoak(actor, part, lp, s0 * (heavy ? 3.4 : 2.6), heavy ? 2.2 : 3.2);
      }
    }
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
      // which face is it on? seat() pushes the decal PAST the box on exactly
      // one axis and clamps the other two inside, so the answer is unambiguous.
      const ax = Math.abs(m.position.x) >= hx ? "x" : (Math.abs(m.position.y) >= hy ? "y" : "z");
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
      woundCalls: LEDGER.woundCalls, woundMarks: LEDGER.woundMarks,
      refusals: LEDGER.refusals, lastRefusal: LEDGER.lastRefusal,
    };
  };

  // ============================================================
  //  A BITE THAT TAKES SOMETHING WITH IT — persistent, on ANY rig.
  //
  //  Owner, 2026-08-25: "I want to get part of my tail ripped off by an orca
  //  bite, etc." Everything above this line assumes a HUMANOID: bodyBite and
  //  bodyWound both require actor.char.skinSlots and give up on anything else.
  //  So when a pod bit the player's shark the ONLY feedback was a health bar
  //  going down and a puff of blood that lasted a second — which is why being
  //  eaten alive by three orcas read as nothing at all.
  //
  //  This is the missing half, and it is deliberately NOT shark-specific
  //  (BLOCK LAW, same as bodyBite): any actor whose group is a pile of box
  //  meshes — every wildlife body in this game — can have a piece taken out
  //  of it. The caller passes the world point the jaw closed on and how big
  //  the jaw was; this finds the mesh that was in it and removes material.
  //
  //  WHAT IT DOES TO THE MESH, and why it survives the animators. The swim rig
  //  (city/wildlife_rig.js animateSwim) owns exactly two channels on a tail
  //  part: position.z + rotation.y for a fish, position.y + rotation.z for a
  //  cetacean. It never touches SCALE and never touches position.x. So the
  //  chunk is taken by shrinking the part's scale — the piece is gone — and
  //  the raw edge is capped with a dark torn face parented to the same mesh,
  //  which therefore swims, banks and dies with the body for free. Nothing
  //  here can fight the tail animation because it does not write to it.
  //
  //  It is PERSISTENT: nothing removes it but a restore. A shark that lost a
  //  third of its caudal fin in the first minute is still missing it when the
  //  pod comes back, which is the entire point.
  //
  //    CBZ.creatureBiteChunk(actor, worldPoint, opts)
  //      jaw   jaw RADIUS in metres — how much of the part is taken
  //      sev   0..1 severity (default 0.6)
  //      bleed true (default) = a lasting chum trail off the wound
  //    CBZ.creatureBiteChunkRestore(actor)   put every piece back
  //    CBZ.creatureBiteChunkAudit()          for the tools: {actors, chunks,
  //      severed, craters, veiled, bleeders, deepest, widestWound} — and
  //      widestWound (metres) is the one that would have caught the plank.
  // ============================================================
  if (CBZ.CONFIG.CREATURE_BITE_CHUNK == null) CBZ.CONFIG.CREATURE_BITE_CHUNK = true;
  function chunkOn() { return CBZ.CONFIG.CREATURE_BITE_CHUNK !== false; }

  const CHUNKS = [];                    // {actor, mesh, sx,sy,sz, pits, deep, ...}
  const MAX_CHUNKS_PER_ACTOR = 4;
  const MAX_CHUNKS = 24;

  /* ---- THE MATERIALS, and the plank that made them ------------------------
     Owner, 2026-08-25, on a bitten orca photographed from a boat: the wound
     "looks like a BLOCK". It did, and there were two independent reasons.

     ONE: a single flat 0x3d0608 MeshBasicMaterial. A bite is not one colour.
     The decal ramps above this line already encode the real read — near-black
     bore, ONE bright raw torn margin, dark pit wall — but a solid box has no
     vertex ramp to shade it, so the ramp has to be built out of geometry
     instead: three shared materials seated brightest-outermost. (NOT the
     MAT_TORN decal above: that one is a polygon-offset DECAL with
     vertexColors on, and a box with no colour attribute renders black under
     it. A cut face is solid geometry and needs solid materials of its own.)

     TWO, and this is the one that made it a BLOCK rather than merely a flat
     patch: world/water_spec.js's SEA_TRANSLUCENT does not paint submerged
     bodies from outside. It hands each rig a VEILED TWIN of every material it
     owns (CBZ.waterVeilApply, run once at spawn) that attenuates toward the
     water colour over the real eye->fragment water column. A cut face is
     created LONG after spawn — mid-fight — so it never met that pass, and a
     wound sat inside a body that fades into the sea rendering at full,
     unattenuated, sunlit maroon. That is the whole reason it read as a plank
     lying ON the animal instead of a hole IN it.

     So every cut material here is fetched through the veil on the way in.
     waterVeilMaterial caches its clone per source material, so N wounded
     animals still share one program, and it hands the material straight back
     when SEA_TRANSLUCENT is off or when the shader chunks it patches are
     missing — which is also why this is safe to call for a LAND wound: the
     veil term is dead code on any fragment above the waterline. */
  let MAT_BORE = null, MAT_MEAT = null, MAT_RIM = null;
  function solidMat(c) {
    // unlit on purpose: torn tissue has to read as a DARK HOLE in the
    // silhouette, and a lit one blows out white against a sunlit sea edge-on.
    //
    // vertexColors IS THE DEPTH. An unlit material has no shading of its own,
    // so the ONLY thing that can make a solid piece of geometry read as a pit
    // is a ramp baked into its vertices — MeshBasicMaterial multiplies its
    // authored hex by the per-vertex colour, exactly the way the decal ramps
    // above this line do. The ramp only ever multiplies DOWN (1.0 at the raw
    // torn margin, 0.05 in the bore), so the brightest point of a wound is
    // still precisely the hex chosen against the encoder below, and turning
    // this on can only make the wound DARKER than the plank it replaced —
    // which is the whole failure mode the encoder note guards against.
    //
    // CONTRACT: every geometry drawn with one of these materials MUST carry a
    // `color` attribute or it renders BLACK. craterGeo() and chipGeo() both
    // bake one; nothing else may use these three.
    const m = new THREE.MeshBasicMaterial({ color: c, vertexColors: true });
    m._shared = true;                      // rig-disposal sweeps skip it
    return m;
  }
  function cutMat(layer) {
    if (!MAT_BORE) {
      /* THE VALUES ARE LOW ON PURPOSE, and the first capture is why. This
         renderer runs with outputEncoding = sRGBEncoding and r128's colour
         management OFF, so a material colour is treated as LINEAR and encoded
         on the way out — 0x6a1014 leaves the pipe at roughly #ae4545. A wound
         authored at "dark maroon" photographs as bright arterial red, which
         is how the first pass of this fix produced a smaller but even louder
         patch than the plank it replaced. Every hex here is chosen for what
         comes out of the encoder, not for what it looks like in a swatch. */
      MAT_BORE = solidMat(0x040002);       // the bore: near-black at any depth
      MAT_MEAT = solidMat(0x130203);       // the pit wall
      MAT_RIM = solidMat(0x2c0507);        // the raw torn margin — the bright band
    }
    const base = layer === 0 ? MAT_RIM : (layer === 1 ? MAT_MEAT : MAT_BORE);
    /* ALWAYS THE VEILED TWIN, on land as much as at sea, and that is not a
       shortcut: the veil term is `if (camera above the sea && fragment below
       it)`, so on any dry-land fragment it is provably dead code and the
       clone renders byte-identically to the plain material. Asking the medium
       first is what made this fragile — one bite out of three answered "air"
       on a staged orca and left a single unveiled wound glowing inside an
       otherwise-correct body, which is the exact failure this whole change
       exists to remove. Fetch it once, share it forever. */
    if (typeof CBZ.waterVeilMaterial !== "function") return base;
    try { return CBZ.waterVeilMaterial(base) || base; } catch (e) { return base; }
  }

  /* ---- IT WAS A BOX. THAT IS WHY IT LOOKED LIKE A RED SQUARE --------------
     Owner, 2026-08-26: "it puts a red square where i bit them ... not this
     geometry shit, real missing shit."

     He is describing exactly what was here. Every cut face was
     `new THREE.BoxGeometry(1,1,1)` with each CORNER nudged by up to +-0.15,
     scaled `(ra*2, ra*2, th)` — a flat rectangular PLATE. The comment that
     shipped with it claimed the jitter existed "so the three do not read as
     nested squares", which is measurable nonsense: a +-0.15 wobble on a
     +-0.50 box moves a corner by at most 30% of the half-width and leaves
     four corners joined by four straight edges. It photographs as a
     quadrilateral from every angle, at every distance, forever. And because
     the materials are unlit on purpose, the SILHOUETTE was carrying the
     entire read — so the silhouette being a rectangle was the whole bug.

     WHAT REPLACES IT: a real torn crater, built as a closed solid of
     revolution with a ragged rim.

       ring A   the RIM, at local z = +0.5 (the outward face). 17 points at
                strongly varied radii — 0.45 .. 1.00 of nominal, with a ~1-in-5
                chance of a DEEP notch where a tooth took more — and each at
                its own height, so the lip is ragged in profile as well as in
                plan. No straight edge survives anywhere on the outline.
       ring B   the bowl wall, 0.55 of the rim radius
       ring C   the bore mouth, 0.26
       D        the bore FLOOR, on the axis, at z = -0.36
       ring E   the back rim at z = -0.5, joined to A by an outer side wall
       F        the back cap centre

     So it is a bowl pressed into a short cylinder: front bowl + side wall +
     back cap, fully CLOSED. A grazing angle sees the outer wall, never the
     inside of the animal — the failure a naked bowl (an open surface with
     backface culling on) would have had.

     THE +-0.5 EXTENTS ARE PRESERVED EXACTLY. The rim radii are normalised so
     the widest point is 1.0 (i.e. 0.5 from the axis) and the rim heights are
     shifted so the highest is exactly +0.5; the back is flat at -0.5. Every
     sizing line downstream — `ra`, `th`, PIT_R/PIT_T, `cr`, the `full`
     severance branch and creatureBiteChunkAudit's widestWound (which measures
     the matrixWorld columns, i.e. the SCALE) — therefore means the same thing
     it meant when this was a box, and none of them had to move.

     THE COLOUR RAMP IS BAKED IN, which is what lets one mesh be a pit instead
     of needing three plates to fake one. Bore near-black, bowl wall dark, ONE
     bright band at the raw torn margin on the rim. Values multiply the
     material hex (see solidMat) and never exceed 1.0, so the loudest pixel in
     a wound is still MAT_RIM as authored against the sRGB encoder and the
     bore is blacker than anything the old plates could reach.

     Two shared variants, built once at boot, `_shared` so disposal sweeps
     skip them. A wound still allocates NOTHING per bite. */
  const CRATER_SEG = 17;                 // rim points (prime: the tear never lines up with itself)
  let GEO_TORN = null, GEO_TORN_B = null;
  function craterGeo(seed) {
    const N = CRATER_SEG;
    let s = (seed >>> 0) || 1;
    const rnd = function () { s = (s * 1664525 + 1013904223) >>> 0; return (s >>> 8) / 16777216; };
    // ---- the ragged rim: radius and height, per point ----------------------
    const rw = new Float32Array(N), rz = new Float32Array(N);
    let wmax = 0, zmin = 1;
    for (let i = 0; i < N; i++) {
      let k = 0.74 + rnd() * 0.26;
      if (rnd() < 0.21) k *= 0.60 + rnd() * 0.18;   // a DEEP notch: a tooth took more here
      rw[i] = k; if (k > wmax) wmax = k;
      const h = rnd() * 0.17;                       // the lip is ragged in profile too
      rz[i] = h; if (h < zmin) zmin = h;
    }
    for (let i = 0; i < N; i++) { rw[i] /= wmax; rz[i] = 0.5 - (rz[i] - zmin); }
    // ---- vertices ----------------------------------------------------------
    // A[0..N-1] rim | B[N..] bowl wall | C[2N..] bore mouth | D bore floor |
    // E[3N+1..] back rim | F back centre
    const B_R = 0.55, C_R = 0.26, B_Z = 0.05, C_Z = -0.30, D_Z = -0.36;
    const vN = 4 * N + 2;
    const pos = new Float32Array(vN * 3);
    const col = new Float32Array(vN * 3);
    // [brightness, warm] per ring. warm scales green/blue only, so the rim can
    // go RAW RED rather than merely lighter — the same trick discGeo uses.
    const put = function (vi, x, y, z, v, warm) {
      pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = z;
      col[vi * 3] = v; col[vi * 3 + 1] = v * warm; col[vi * 3 + 2] = v * warm;
    };
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      const r = rw[i] * 0.5;
      put(i,           cs * r,       sn * r,       rz[i], 1.00, 0.76);   // raw torn margin
      put(N + i,       cs * r * B_R, sn * r * B_R, B_Z,   0.32, 0.88);   // pit wall
      put(2 * N + i,   cs * r * C_R, sn * r * C_R, C_Z,   0.09, 1.00);   // bore
      put(3 * N + 1 + i, cs * r,     sn * r,       -0.5,  0.15, 0.94);   // back rim (side wall foot)
    }
    put(3 * N, 0, 0, D_Z, 0.04, 1.00);            // D — the bore floor, near-black
    put(4 * N + 1, 0, 0, -0.5, 0.04, 1.00);       // F — back cap centre
    // ---- triangles ---------------------------------------------------------
    // Winding follows discGeo's: an INNER-first strip and a CENTRE-first fan
    // both come out front-facing toward +Z, which is the outward face here
    // (seatPits aims +Z down the wound normal). The back cap is reversed.
    const idx = [];
    const D = 3 * N, F = 4 * N + 1, E0 = 3 * N + 1;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a0 = i, a1 = j, b0 = N + i, b1 = N + j, c0 = 2 * N + i, c1 = 2 * N + j;
      const e0 = E0 + i, e1 = E0 + j;
      idx.push(b0, a0, a1, b0, a1, b1);          // bowl: rim -> wall
      idx.push(c0, b0, b1, c0, b1, c1);          // bowl: wall -> bore mouth
      idx.push(D, c0, c1);                       // bore floor fan
      idx.push(a0, e0, e1, a0, e1, a1);          // outer side wall (normals radial)
      idx.push(F, e1, e0);                       // back cap (faces -Z)
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    // no normals: every material that draws this is MeshBasicMaterial, which
    // never reads one. Skipping the attribute saves 70 vec3s and a per-vertex
    // upload for something the shader would discard.
    g.computeBoundingBox(); g.computeBoundingSphere();
    g._shared = true;
    return g;
  }
  function tornGeo(i) {
    if (!GEO_TORN) { GEO_TORN = craterGeo(0x9e37c1); GEO_TORN_B = craterGeo(0x51c10b); }
    return i ? GEO_TORN_B : GEO_TORN;
  }

  /* ---- AND THE MEAT THAT LEFT THE BODY ------------------------------------
     A crater says material is missing. Chunks flying off say it LEFT. This is
     the old jaggedBox, kept for the one job it was ever right for: a chunk of
     torn flesh is a LUMP, and a corner-jittered box is a lump for free.

     THE JITTER IS KEYED ON THE CORNER, not on the vertex. r128's BoxGeometry
     carries 24 vertices for 8 corners (each face needs its own normal/uv), so
     jittering per-vertex splits every corner three ways and opens visible
     cracks along the seams. Hashing the ORIGINAL position instead moves all
     three copies of a corner to the same place and the box stays closed. The
     jitter is +-0.45 here (it was +-0.30 when this was pretending to be a
     wound) because nothing about a torn chunk should be square either. */
  let GEO_CHIP = null, GEO_CHIP_B = null;
  function chipGeo(seed) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const arr = g.attributes.position.array;
    const col = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i += 3) {
      // corner key: the unit box's coords are all +-0.5, so a sign triple
      let h = (((arr[i] > 0 ? 1 : 0) * 73856093) ^ ((arr[i + 1] > 0 ? 1 : 0) * 19349663) ^
               ((arr[i + 2] > 0 ? 1 : 0) * 83492791) ^ seed) >>> 0;
      h = (h * 1664525 + 1013904223) >>> 0; arr[i] += (((h >>> 9) & 255) / 255 - 0.5) * 0.45;
      h = (h * 1664525 + 1013904223) >>> 0; arr[i + 1] += (((h >>> 9) & 255) / 255 - 0.5) * 0.45;
      h = (h * 1664525 + 1013904223) >>> 0; arr[i + 2] += (((h >>> 9) & 255) / 255 - 0.5) * 0.45;
      // the same corner hash drives the shading: one or two faces of a torn
      // lump are raw and the rest is dark meat, and an unlit material can only
      // say so through the colour attribute (which solidMat now requires).
      h = (h * 1664525 + 1013904223) >>> 0;
      const v = 0.34 + (((h >>> 9) & 255) / 255) * 0.66;
      col[i] = v; col[i + 1] = v * 0.82; col[i + 2] = v * 0.82;
    }
    g.attributes.position.needsUpdate = true;
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    g._shared = true;
    return g;
  }
  function chipGeoOf(i) {
    if (!GEO_CHIP) { GEO_CHIP = chipGeo(0x2b7f41); GEO_CHIP_B = chipGeo(0xd10e93); }
    return i ? GEO_CHIP_B : GEO_CHIP;
  }
  const _cbv = new THREE.Vector3();
  const _half = new THREE.Vector3();     // half-extents in PARENT units (geometry x scale)
  const _geoH = new THREE.Vector3();     // ..and in the mesh's own local units
  const _geoC = new THREE.Vector3();     // the geometry's centre, local units
  /* THE BOUNDING BOX IS NOT NECESSARILY CENTRED ON THE MESH ORIGIN, and the
     first version of this assumed it was. A fin whose geometry is authored
     offset from its joint then got its cut face seated at the joint instead of
     at the fin's edge — which photographs as a red slab floating in the water
     beside the shark, exactly what the preset's first capture showed. Carry
     the centre and everything seats on the actual surface. */
  function meshHalf(m, out) {
    const gm = m.geometry;
    if (!gm) return false;
    if (!gm.boundingBox) gm.computeBoundingBox();
    const bb = gm.boundingBox;
    if (!bb) return false;
    _geoH.set((bb.max.x - bb.min.x) * 0.5, (bb.max.y - bb.min.y) * 0.5, (bb.max.z - bb.min.z) * 0.5);
    _geoC.set((bb.max.x + bb.min.x) * 0.5, (bb.max.y + bb.min.y) * 0.5, (bb.max.z + bb.min.z) * 0.5);
    out.set(_geoH.x * Math.abs(m.scale.x), _geoH.y * Math.abs(m.scale.y), _geoH.z * Math.abs(m.scale.z));
    return out.x > 0 || out.y > 0 || out.z > 0;
  }
  // WHICH PART WAS IN THE MOUTH. The group's own children, scored by distance
  // from the bite point in the group's local frame; ties broken toward the
  // SMALLER part, because a jaw that closes across a tail and a flank at the
  // same range took the tail.
  function partAt(actor, wp, jawR) {
    const grp = actor.group; if (!grp) return null;
    grp.updateMatrixWorld(true);
    const local = _cbv.set(wp.x, wp.y, wp.z);
    grp.worldToLocal(local);
    const lx = local.x, ly = local.y, lz = local.z;
    const kids = grp.children;
    let best = null, bestScore = 1e9;
    const reach = Math.max(0.6, jawR * 2.4) / Math.max(0.05, grp.scale.x || 1);
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i];
      if (!m || !m.isMesh || m.visible === false || m._tornCap) continue;
      if (!meshHalf(m, _half)) continue;
      // distance from the bite point to this box, in group-local metres
      const cx = m.position.x + _geoC.x * m.scale.x;
      const cy = m.position.y + _geoC.y * m.scale.y;
      const cz = m.position.z + _geoC.z * m.scale.z;
      const dx = Math.max(0, Math.abs(lx - cx) - _half.x);
      const dy = Math.max(0, Math.abs(ly - cy) - _half.y);
      const dz = Math.max(0, Math.abs(lz - cz) - _half.z);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > reach) continue;
      const vol = _half.x * _half.y * _half.z;
      const score = d + Math.min(0.4, vol * 0.9);   // prefer the small part
      if (score < bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  function recordFor(actor, mesh) {
    for (let i = 0; i < CHUNKS.length; i++) if (CHUNKS[i].mesh === mesh) return CHUNKS[i];
    return null;
  }
  function chunkCount(actor) {
    let n = 0;
    for (let i = 0; i < CHUNKS.length; i++) if (CHUNKS[i].actor === actor) n++;
    return n;
  }

  /* ---- CAN THIS PIECE COME OFF AT ALL? ------------------------------------
     The original of this function had exactly one answer for every part it
     found: shrink it and cap the cut. That is the right answer for a caudal
     fin and a catastrophic one for a TRUNK, and the orca is the case that
     proved it. Its body is not a pile of boxes at all — city/wildlife_orca.js
     builds ONE generated hull mesh spanning local x -2.35..3.25 — so a bite
     anywhere on the animal found the hull, shrank the whole orca 20% shorter
     in one axis, and capped it with a slab scaled to the hull's own
     cross-section: a 5-metre maroon plank lying down the animal's back. That
     is the screenshot. Nothing about the shrink-and-cap model was ever going
     to survive being handed the body itself.

     So there are two outcomes now, and which one you get is measured, never a
     species list (BLOCK LAW):

       APPENDAGE — a part that is not the trunk AND whose cross-section the
         jaw can actually close around. A piece comes away: shrink, slide, and
         cap the raw cross-section. (A fluke, a pectoral, a tail lobe.)

       TRUNK / too big for the mouth — a CRATER. The body keeps its shape,
         because a bite does not make an orca smaller, and a jaw-sized hole is
         torn in the flank where the teeth actually closed.

     THE TRUNK IS THE BIGGEST BOX IN THE RIG. Measured once per actor and
     cached on it; every wildlife body in this game has one part that is
     obviously the body, and asking the geometry is cheaper and more honest
     than any name list would be (the hulls are variously "cetaceanHull",
     "sharkHull", or unnamed). */
  function trunkOf(actor) {
    const grp = actor.group;
    if (!grp) return null;
    const cached = actor._cbcTrunk;
    if (cached && cached.parent === grp) return cached;
    let best = null, bestVol = -1;
    const kids = grp.children;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i];
      if (!m || !m.isMesh || m._tornCap) continue;
      if (!meshHalf(m, _half)) continue;
      const vol = _half.x * _half.y * _half.z;
      if (vol > bestVol) { bestVol = vol; best = m; }
    }
    actor._cbcTrunk = best;
    return best;
  }

  /* ---- THE WOUND ITSELF ---------------------------------------------------
     Three nested boxes on the surface the teeth came through: the raw torn
     margin widest and brightest, a darker pit wall inside it, a near-black
     bore in the middle, each a hair prouder than the last so it wins the
     depth test on a physical offset rather than on a polygonOffset fight. All
     three share the jittered geometry, so the composite silhouette is ragged
     in every direction and no two wounds are the same shape.

     They are parented INTO the part, so they swim, bank, roll and die with
     the body for free and nothing per-frame ever touches them.

     WHERE THE SURFACE ACTUALLY IS — and this is the difference between a
     crater and a slab floating in the water beside the animal. The first
     version of the cap seated on the part's BOUNDING BOX, which on a rounded
     hull is the true surface at exactly four points: bite an orca a metre
     short of the fluke and the box face is half a metre outside the body. So
     the seat is a RAYCAST. Fired from outside, through the bite point, at the
     body's centre, it lands on the real triangle the teeth would have met and
     brings that triangle's own normal back with it — so the wound hugs the
     hull, and the blood leaves along the flank's real outward direction. One
     ray against one mesh, at most once per bite per animal, which is a
     rounding error next to the bite itself; the box method is still there as
     the fallback for the day it misses.

     `full` means this is a SEVERANCE face, not a crater: fill the part's
     whole cross-section at the end that came away, which for a cut fin is
     correct and is the one case where a wound legitimately spans the part. */
  const _pit = new THREE.Vector3();
  const _nrm = new THREE.Vector3();
  const _org = new THREE.Vector3();
  const _tgt = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _ray = new THREE.Raycaster();
  /* THE THREE LAYERS ARE NOW A TERRACE, NOT A STACK OF PLATES.

     WHY THE OLD OFFSETS CANNOT SURVIVE THE CRATER. PIT_O used to push each
     layer FURTHER out of the skin as it got darker and smaller (0, .055, .10),
     because three flat plates can only be seen if each one stands proud of the
     one under it. Handed real bowls, that ordering builds a black wart: the
     near-black bore layer, being both thickest and proudest, ends up sticking
     0.375*cr out of the flank.

     AND YOU CANNOT SIMPLY RECESS THEM. The hull is an opaque closed shell; a
     bowl sunk into it is not visible AT ALL, because nothing here cuts a hole
     in the animal — the body's own front face is in front of the bore and wins
     the depth test. Every visible part of a wound has to be OUTSIDE the skin.

     So the read is built the only way it can be: each layer is a shallow bowl
     that sits ENTIRELY above the surface, and they descend — widest/brightest/
     highest first, narrowest/near-black/lowest last, each nesting inside the
     mouth of the one outside it. What you see is a raised, everted, ragged lip
     of raw margin stepping down through two darker terraces to a black bore
     that meets the skin. That is a crater in relief instead of a crater in
     paint, and it is the read a bite actually has.

     PIT_LIP replaces PIT_O and is quoted against the layer's OWN thickness,
     not against `cr`: the bowl's floor sits at local z = -0.36 of a +-0.5 box,
     so a rim height of 0.93*th puts the floor 0.07*th PROUD (clear of the
     skin, no z-fight) and the back cap 0.07*th BURIED (never visible, and it
     provably cannot punch out the far side of the part because `cr` is capped
     at 0.76 of the part's smallest half-extent). Quoting the lip against
     thickness is also what lets a re-bitten wound deepen: `th` grows with
     r.deep and the lip follows it instead of staying at a fixed fraction of a
     width that has already hit its ceiling. */
  const PIT_R = [0.88, 0.50, 0.26];      // tangential radius, as a fraction of cr
  const PIT_T = [0.34, 0.22, 0.13];      // relief: rim-to-back thickness, fraction of cr
  const PIT_LIP = 0.93;                  // rim height above the skin, fraction of the layer's own th
  function seatPits(r, mesh, wp, jawR, sev, full) {
    meshHalf(mesh, _half);               // (re)fills _geoH / _geoC, geometry units
    const hx = Math.max(0.01, _geoH.x), hy = Math.max(0.01, _geoH.y), hz = Math.max(0.01, _geoH.z);
    // world -> geometry scale for THIS mesh. Rigs are near-uniform, so the
    // length of the world matrix's X column is the honest scalar and it costs
    // no allocation (getWorldScale would need a Vector3 and a decompose).
    const e = mesh.matrixWorld.elements;
    const wsc = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) || 1;
    _tgt.copy(_geoC).applyMatrix4(mesh.matrixWorld);       // the part's centre, in world

    let cross;
    if (full) {
      // THE CUT FACE: flat, square to the part's long axis, filling it.
      const n = r.axis;
      const sgn = ((n === 0 ? _geoC.x : n === 1 ? _geoC.y : _geoC.z) >= 0) ? 1 : -1;
      cross = Math.min(n === 0 ? hy : hx, n === 2 ? hy : hz);
      _pit.copy(_geoC);
      if (n === 0) _pit.x += sgn * hx; else if (n === 1) _pit.y += sgn * hy; else _pit.z += sgn * hz;
      _pit.applyMatrix4(mesh.matrixWorld);
      _nrm.set(n === 0 ? sgn : 0, n === 1 ? sgn : 0, n === 2 ? sgn : 0).transformDirection(mesh.matrixWorld);
    } else {
      cross = Math.min(hx, Math.min(hy, hz));
      // fire from outside, through the teeth, at the body's middle
      _pit.set(wp.x, wp.y, wp.z);
      _nrm.copy(_pit).sub(_tgt);
      if (_nrm.lengthSq() < 1e-8) _nrm.set(0, 1, 0);
      _nrm.normalize();
      const reach = Math.max(hx, Math.max(hy, hz)) * wsc * 2.2 + 1;
      _org.copy(_tgt).addScaledVector(_nrm, reach);
      _dir.copy(_tgt).sub(_org).normalize();
      _ray.set(_org, _dir);
      _ray.near = 0; _ray.far = reach * 2.4;
      let hit = null;
      try { const hs = _ray.intersectObject(mesh, false); hit = (hs && hs[0]) || null; } catch (er) { hit = null; }
      if (hit) {
        _pit.copy(hit.point);
        if (hit.face) {
          _org.copy(hit.face.normal).transformDirection(mesh.matrixWorld);
          // a triangle whose winding disagrees with "away from the body" is
          // wrong about which side it is on, so the outward ray wins.
          if (_org.dot(_nrm) > 0.05) _nrm.copy(_org).normalize();
        }
      } else {
        // FALLBACK: the bounding box's nearest face — exact for the box rigs,
        // merely approximate for a rounded hull, and never a floating slab
        // because the size below is the jaw's, not the animal's.
        mesh.worldToLocal(_pit);
        const px = Math.max(_geoC.x - hx, Math.min(_geoC.x + hx, _pit.x));
        const py = Math.max(_geoC.y - hy, Math.min(_geoC.y + hy, _pit.y));
        const pz = Math.max(_geoC.z - hz, Math.min(_geoC.z + hz, _pit.z));
        const dx = hx - Math.abs(px - _geoC.x), dy = hy - Math.abs(py - _geoC.y), dz = hz - Math.abs(pz - _geoC.z);
        let n = 0, nd = dx;
        if (dy < nd) { n = 1; nd = dy; }
        if (dz < nd) { n = 2; nd = dz; }
        const sgn = ((n === 0 ? px : n === 1 ? py : pz) >= (n === 0 ? _geoC.x : n === 1 ? _geoC.y : _geoC.z)) ? 1 : -1;
        _pit.set(px, py, pz);
        if (n === 0) _pit.x = _geoC.x + sgn * hx;
        else if (n === 1) _pit.y = _geoC.y + sgn * hy;
        else _pit.z = _geoC.z + sgn * hz;
        _pit.applyMatrix4(mesh.matrixWorld);
        cross = Math.min(n === 0 ? hy : hx, n === 2 ? hy : hz);
        _nrm.set(n === 0 ? sgn : 0, n === 1 ? sgn : 0, n === 2 ? sgn : 0).transformDirection(mesh.matrixWorld);
      }
    }

    /* THE SIZE, and this is the plank fix in one line: a wound is the size of
       the JAW that made it, not the size of the animal it is in. Widened by
       accumulated depth (bite the same place twice and the hole grows), given
       a floor so a small mouth on a big flank is still legible at range, and
       a ceiling at three quarters of the flank so it can never become the
       silhouette again. */
    let cr = full ? cross * 0.94
                  : (jawR / wsc) * (0.36 + sev * 0.32) * (1 + r.deep * 1.5);
    // (the severance face is exempt from the crater's ceiling — a cut fin's
    // raw edge IS its cross-section, and clamping it to 0.76 of one left a
    // visible collar of intact skin around a piece that had come off)
    cr = Math.max(cross * 0.12, Math.min(cross * (full ? 0.98 : 0.76), cr));

    if (!r.pits) r.pits = [null, null, null];
    for (let i = 0; i < 3; i++) {
      let m = r.pits[i];
      if (!m) {
        m = new THREE.Mesh(tornGeo(i & 1), cutMat(i));
        m._tornCap = true;                // partAt/trunkOf must never see it
        m.castShadow = false; m.receiveShadow = false;
        mesh.add(m);
        r.pits[i] = m;
      } else {
        m.material = cutMat(i);
      }
      const ra = cr * PIT_R[i];
      // BITE THE SAME PLACE AGAIN AND IT GETS DEEPER, not merely wider. `cr`
      // already grows with r.deep but is capped at 0.76 of the flank, so on a
      // small part a second and third bite used to change nothing at all: the
      // accumulator existed and was invisible. Relief is uncapped by that
      // ceiling, so this is the channel that carries repeat bites, up to
      // +47% at r.deep's own 0.85 rail.
      const th = Math.max(0.008, cr * PIT_T[i] * (1 + (r.deep || 0) * 0.55));
      // The seat, built in WORLD and then dropped into the part's frame. The
      // offset puts the layer's RIM at PIT_LIP of its own thickness above the
      // real surface (see the PIT_LIP note), i.e. the mesh CENTRE goes at
      // rim - th/2: the whole bowl is outside the opaque hull and therefore
      // visible, and the back cap is inside it and therefore never is.
      _org.copy(_pit).addScaledVector(_nrm, (PIT_LIP - 0.5) * th * wsc);
      if (!full) {
        // A HAIR of decentring so the terraces are not machined-concentric.
        // It used to be 0.55*cr in every axis, which was fine for plates and
        // is destructive for bowls: a quarter of the wound's own radius is
        // enough to shove the black bore out through the side of the bright
        // rim. 0.09 is visible as raggedness and cannot break the nesting.
        const j = cr * wsc * 0.09;
        _org.x += (Math.random() - 0.5) * j;
        _org.y += (Math.random() - 0.5) * j;
        _org.z += (Math.random() - 0.5) * j;
      }
      m.position.copy(_org);
      mesh.worldToLocal(m.position);
      // aim the thin axis (+Z) down the wound normal, then roll it. lookAt
      // resolves through the parent's world rotation in r128, so this is
      // correct for a child of a banking, rolling, swimming rig — and the
      // scale is written AFTER, because lookAt reads matrixWorld.
      // The roll is free (it decorrelates the two shared variants' notches so
      // three layers never repeat a silhouette); the TILT is not — it lifts
      // one side of the rim off the skin by ra*sin(t), so it is now +-0.10 rad
      // rather than +-0.25, which on the widest layer is 0.09*cr of lift
      // against 0.32*cr of intended relief.
      m.scale.set(1, 1, 1);
      m.lookAt(_pit.x + _nrm.x, _pit.y + _nrm.y, _pit.z + _nrm.z);
      m.rotateZ(Math.random() * 6.283185307);
      m.rotateX((Math.random() - 0.5) * 0.2);
      m.rotateY((Math.random() - 0.5) * 0.2);
      m.scale.set(ra * 2, ra * 2, th);
    }
    _cbv.copy(_pit);                      // where the wound is, for the bloom seed
    return cr * wsc;                      // and how wide it is, in metres
  }

  /* ---- ONE TRAIL PER ANIMAL, not one per hole -----------------------------
     gore.js caps the whole game at TWELVE chum handles and city/
     marine_predation.js deliberately holds six of them, arbitrated by
     severity across every wounded thing in the water. The old code here
     opened a thirteenth-and-fourteenth: one handle per CHUNK RECORD, up to
     four per actor, on top of the one wildlife_tame.js opens for a clamp — so
     a single player bite on an orca could hold five slots for one animal and
     starve every other bleeder on the map.

     An animal bleeds. Its individual holes do not bleed separately. So: ask
     marine_predation's arbiter first (it owns the "which six" question and
     already follows the body), and only fall back to a raw handle when that
     file is absent or refuses. One per actor either way. */
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
    const at = { x: 0, y: 0, z: 0 };
    const rec = { actor: actor, h: null, node: node, at: at };
    // gore.js reads x() then y() then z() in that order every frame, so the
    // one world-position read rides on x and the other two are free.
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

  /* ---- THE MEAT LEAVING THE BODY -----------------------------------------
     Owner: "real missing shit". A crater is the AFTER. This is the DURING —
     the material that came off, visibly coming off, on the frame the jaw
     closes. Without it a bite is a wound that appears by magic; with it the
     wound is the hole the chunks came out of.

     A TRUNK bite is the case that needed it most. The trunk exemption a few
     hundred lines down is correct and stays (an orca is ONE generated hull
     mesh; shrinking it makes the whole animal shorter, which is the 5-metre
     maroon plank that started all of this) — but it meant a bite to the body
     removed nothing whatsoever. Now the crater deepens AND the flesh leaves.

     WHY THESE ARE MADE HERE AND NOT ASKED FOR FROM gore.js. gore.js's only
     public particle entries are goreBloom (blood puffs), goreImpact (a spray)
     and gore() (a whole death event: flash, shake, kill context). None of
     them emits a solid gib on request — severBody does, but only as part of
     taking a named humanoid limb off a named humanoid rig. Rather than invent
     a function in a file another builder owns, the chunks ride this file's
     own shared torn geometry and its own cut materials, which is also what
     keeps them inside the water veil with the wound they came out of.

     ONLY IN WATER, and that is the file's existing law, not a new gate: the
     same `wet` test that decides whether goreBloom fires. On land gore.js
     already owns the debris for a mauling and a second, unarbitrated source
     of flying meat would double it. Chunks in air also want ballistics,
     bounce and a ground contact that nothing here has; in water they simply
     decelerate and sink, which is three lines and always correct. */
  const CHIPS = [];                      // {m, vx,vy,vz, t, life, rx,ry,rz, s}
  const CHIP_FREE = [];                  // recycled meshes (no churn during a frenzy)
  const CHIP_CAP = 30;                   // hard ceiling: a frenzy is many bites
  const CHIP_SINK = -1.15;               // m/s^2 — gravity minus flesh's near-neutral buoyancy
  const CHIP_DRAG = 2.6;                 // 1/s, applied as exp(-k*dt) so a long frame cannot overshoot
  function dropChip(i) {
    const c = CHIPS.splice(i, 1)[0];
    if (c.m.parent) c.m.parent.remove(c.m);
    if (CHIP_FREE.length < 18) CHIP_FREE.push(c.m);
  }
  // n chunks off the wound at (x,y,z), thrown along the surface normal (nx,ny,nz)
  function tossChips(n, x, y, z, nx, ny, nz, woundR, sev) {
    if (!CBZ.scene) return;
    for (let k = 0; k < n; k++) {
      if (CHIPS.length >= CHIP_CAP) dropChip(0);        // oldest first, same law as the decals
      let m = CHIP_FREE.pop();
      if (!m) {
        m = new THREE.Mesh(chipGeoOf(k & 1), cutMat(k & 1));
        m.castShadow = m.receiveShadow = false;
      } else {
        m.geometry = chipGeoOf(k & 1);
        m.material = cutMat(k & 1);       // ALWAYS refetched: the veil twin is cached, not free
      }
      // a chunk is a fraction of the hole it came out of, and no two match
      const s = Math.max(0.02, woundR * (0.16 + Math.random() * 0.26));
      m.scale.set(s, s * (0.6 + Math.random() * 0.7), s * (0.6 + Math.random() * 0.7));
      m.position.set(x + (Math.random() - 0.5) * woundR * 0.9,
                     y + (Math.random() - 0.5) * woundR * 0.9,
                     z + (Math.random() - 0.5) * woundR * 0.9);
      m.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      CBZ.scene.add(m);
      // OUT ALONG THE NORMAL, hard, then the water takes it. No upward bias:
      // meat is heavier than seawater, and a chunk that arcs UP reads as a
      // firework. The spread is wide because a jaw does not aim.
      const sp = (1.4 + Math.random() * 2.2) * (0.55 + sev * 0.75);
      CHIPS.push({
        m: m,
        vx: nx * sp + (Math.random() - 0.5) * 1.9,
        vy: ny * sp * 0.55 + (Math.random() - 0.5) * 1.1,
        vz: nz * sp + (Math.random() - 0.5) * 1.9,
        rx: (Math.random() - 0.5) * 7, ry: (Math.random() - 0.5) * 7, rz: (Math.random() - 0.5) * 7,
        t: 0, life: 3.2 + Math.random() * 2.6, s: s,
      });
    }
  }
  function stepChips(dt) {
    for (let i = CHIPS.length - 1; i >= 0; i--) {
      const c = CHIPS[i], m = c.m;
      c.t += dt;
      const k = Math.exp(-CHIP_DRAG * dt);
      c.vy += CHIP_SINK * dt;
      c.vx *= k; c.vy *= k; c.vz *= k;
      m.position.x += c.vx * dt; m.position.y += c.vy * dt; m.position.z += c.vz * dt;
      m.rotation.x += c.rx * dt; m.rotation.y += c.ry * dt; m.rotation.z += c.rz * dt;
      c.rx *= k; c.ry *= k; c.rz *= k;
      // the last second is a shrink, not a pop: something eats it or it
      // disperses. (Scale, not opacity — these share the opaque cut materials
      // with the wound itself and must never fade one of those to transparent.)
      const left = c.life - c.t;
      if (left < 1) {
        const f = Math.max(0, left);
        m.scale.set(c.s * f, c.s * f, c.s * f);
      }
      if (c.t >= c.life) dropChip(i);
    }
  }
  function chipsClear() { for (let i = CHIPS.length - 1; i >= 0; i--) dropChip(i); }

  CBZ.creatureBiteChunk = function (actor, wp, opts) {
    opts = opts || {};
    if (!chunkOn() || !actor || !wp || !actor.group || !CBZ.scene) return false;
    if (actor.culled || actor.group.visible === false) return false;
    if (wp.x == null || wp.y == null || wp.z == null) return false;
    if (!isFinite(wp.x) || !isFinite(wp.y) || !isFinite(wp.z)) return false;
    // ONLY WHERE IT CAN BE SEEN — same band bodyBite and gore.js use. A food
    // chain runs across this whole map; a wound nobody can look at is a cap
    // mesh and a chum source bought for nothing.
    if (dist2Cam(wp.x, wp.z) > SPAWN_D2) return false;
    // a child is never dismembered (systems/childsafe.js owns that rule; this
    // is the same test bodyBite's callers honour, asked directly)
    if (actor.child || actor._childSafe) return false;
    const sev = Math.max(0.15, Math.min(1, opts.sev != null ? opts.sev : 0.6));
    const jawR = Math.max(0.1, Math.min(3.5, opts.jaw != null ? opts.jaw : 0.4));
    const mesh = partAt(actor, wp, jawR);
    if (!mesh) return false;
    if (!meshHalf(mesh, _half)) return false;

    /* WHICH MEDIUM, decided ONCE, here, at seat time — never by forking the
       material set. It picks two things: whether the cut materials come back
       veiled (see the material block above), and whether the blood is a
       plume or is left to the caller's own air-medium gore. A land bite must
       come out of this function byte-identical to what it always was apart
       from the wound being better shaped, which is also why goreBloom is now
       gated: it was firing on BEARS. goreBloom has no medium test of its own,
       and its puffs are clamped to the sea surface as a lid — so every bite
       in a forest was spawning blood plumes that teleported to y=0 under the
       terrain and lived there for four seconds, unseen, out of the same
       capped pool the ocean needs. */
    const wet = (typeof CBZ.goreMedium === "function") &&
                (function () { try { return CBZ.goreMedium(wp.x, wp.y, wp.z) === "water"; } catch (e) { return false; } })();

    let r = recordFor(actor, mesh);
    if (!r) {
      if (CHUNKS.length >= MAX_CHUNKS || chunkCount(actor) >= MAX_CHUNKS_PER_ACTOR) return false;
      r = {
        actor: actor, mesh: mesh, deep: 0, pits: null, axis: 0, sever: false,
        sx: mesh.scale.x, sy: mesh.scale.y, sz: mesh.scale.z,
        px: null, py: null, pz: null,
      };
      CHUNKS.push(r);
    }

    /* IS THERE A PIECE TO TAKE, or is this the body? Two measurements, both
       cheap, both about the mouth rather than about the species:
         • the trunk is never dismembered — an orca does not get shorter
         • and neither is anything whose cross-section the jaw cannot close
           around: a mouth that cannot get past a fluke's root tears a hole in
           it, it does not bite it off. */
    const gsc = (function () {
      const e = actor.group.matrixWorld.elements;
      return Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) || 1;
    })();
    const jawLocal = jawR / gsc;                 // the jaw in the group's own units
    const ax = _half.x >= _half.y ? (_half.x >= _half.z ? 0 : 2) : (_half.y >= _half.z ? 1 : 2);
    const crossR = Math.min(ax === 0 ? _half.y : _half.x, ax === 2 ? _half.y : _half.z);
    const sever = mesh !== trunkOf(actor) && jawLocal >= crossR * 0.55;
    r.axis = ax;
    r.sever = r.sever || sever;

    let woundR;
    if (sever) {
      meshHalf(mesh, _half);   // trunkOf() walked the rig and clobbered it
      // HOW MUCH CAME AWAY. The jaw against the part's own size, capped so a
      // body part never vanishes entirely — a stump has to stay readable —
      // and ACCUMULATING, so a second bite in the same place takes more.
      // (jawLocal, not jawR: _half is in the GROUP's frame and the jaw is in
      // metres, and comparing the two directly was wrong on every rig whose
      // group is not at scale 1 — which is most of them.)
      const partR = Math.max(0.05, Math.max(_half.x, Math.max(_half.y, _half.z)));
      const took = Math.max(0.20, Math.min(0.45, (jawLocal / (partR * 2.6)) * (0.5 + sev * 0.6)));
      r.deep = Math.min(0.70, r.deep + took);
      const k = 1 - r.deep;
      // Shrink OFF THE LONG AXIS and pinch the cross-section: a caudal fin at
      // a third of its height with a raw edge is unmistakably a fin that lost
      // its top lobe, and it costs nothing per frame. THE LONG AXIS IS
      // MEASURED, all three ways: the old code only ever compared y against z,
      // so a body plan built down +X (every cetacean in this game) had its
      // LENGTH treated as a cross-section and got capped with a slab as long
      // as the animal.
      const pinch = 0.7 + 0.3 * k;
      mesh.scale.set(r.sx * (ax === 0 ? k : pinch),
                     r.sy * (ax === 1 ? k : pinch),
                     r.sz * (ax === 2 ? k : pinch));
      /* AND THE ROOT STAYS ATTACHED. Scale alone shrinks a part about its own
         origin, i.e. from BOTH ends — which reads as "that fin is smaller",
         not "that fin lost its tip". Slide the part back along the shrink axis
         by exactly what the inner end moved, and the piece that is missing is
         the OUTER one, which is the only version of this anybody can read.

         WHICH AXIS IS SAFE TO WRITE. city/wildlife_rig.js's animateSwim owns
         position.x on every rigged part plus ONE more channel per body plan —
         position.y for a cetacean, position.z for a fish — and rewrites them
         every frame. Writing one of those is a fight nobody wins, so the slide
         happens only on the single channel the rig provably leaves alone; the
         cut face seats correctly either way. */
      if (r.px == null) { r.px = mesh.position.x; r.py = mesh.position.y; r.pz = mesh.position.z; }
      const freeAxis = (actor.swim && actor.swim.vert) ? 2 : 1;
      if (ax === freeAxis) {
        const inner = ax === 1 ? (_geoC.y - _geoH.y) : (_geoC.z - _geoH.z);
        const shift = inner * (ax === 1 ? r.sy : r.sz) * (1 - k);
        if (ax === 1) mesh.position.y = r.py + shift; else mesh.position.z = r.pz + shift;
      }
      woundR = seatPits(r, mesh, wp, jawR, sev, true);
    } else {
      // A CRATER. The body is untouched; a jaw-sized hole is torn where the
      // teeth actually closed, and it deepens if they close there again —
      // and it now READS as deepening, because seatPits spends r.deep on the
      // wound's RELIEF as well as on its width, and width alone was already
      // pinned at the 0.76-of-flank ceiling after the first or second bite.
      r.deep = Math.min(0.85, r.deep + 0.24 + sev * 0.26);
      woundR = seatPits(r, mesh, wp, jawR, sev, false);
    }

    if (!wet) return true;                 // land: the caller owns the blood

    /* THE MATERIAL THAT LEFT. Fired before the bloom so the chunks are already
       moving when the blood arrives around them, and seeded from exactly the
       same pair the bloom uses (_cbv = the wound's real world point, _nrm =
       the flank's true outward normal, both left by seatPits) so the meat and
       the blood leave along the same line. Count rides severity and size: a
       nip throws two, an orca taking a fluke throws seven. */
    tossChips(Math.max(2, Math.min(7, Math.round(2 + sev * 3 + woundR * 3.5))),
      _cbv.x, _cbv.y, _cbv.z, _nrm.x, _nrm.y, _nrm.z, woundR, sev);

    /* BLOOD IN THE WATER, staged. _cbv is the wound's real world position
       (seatPits leaves it there) and _nrm is the surface it came out of —
       so the burst ERUPTS from the flank along the outward normal instead of
       ballooning symmetrically about a point inside the animal, which is the
       difference between "a bite" and "a red sphere". */
    if (CBZ.goreBloom) {
      _bloomOpts.amount = Math.max(0.6, Math.min(2.6, (0.7 + sev * 1.0) * (0.7 + woundR * 1.2)));
      _bloomOpts.arterial = sev > 0.6;
      _bloomDir.x = _nrm.x; _bloomDir.y = _nrm.y * 0.4 + 0.25; _bloomDir.z = _nrm.z;
      _bloomOpts.dir = _bloomDir;
      try { CBZ.goreBloom(_cbv.x, _cbv.y, _cbv.z, _bloomOpts); } catch (e) {}
    }
    // and the trailing haze: one source per ANIMAL, following the wound, for
    // as long as the fight lasts. (See bleedFor — this used to be one per
    // hole, which starved a twelve-slot pool with a single victim.)
    if (opts.bleed !== false) {
      bleedFor(actor, r.pits && r.pits[0], Math.max(0.25, Math.min(1, 0.3 + sev * 0.6 + r.deep * 0.3)),
        Math.max(4, Math.min(40, opts.bleedS || 14)));
    }
    return true;
  };
  const _bloomOpts = { amount: 1, arterial: false, dir: null };
  const _bloomDir = { x: 0, y: 0, z: 0 };

  function restoreChunk(r) {
    if (!r) return;
    if (r.mesh) {
      r.mesh.scale.set(r.sx, r.sy, r.sz);
      if (r.px != null) r.mesh.position.set(r.px, r.py, r.pz);
    }
    if (r.pits) {
      for (let i = 0; i < r.pits.length; i++) {
        const p = r.pits[i];
        if (p && p.parent) p.parent.remove(p);
      }
    }
    r.pits = null;
  }
  CBZ.creatureBiteChunkRestore = function (actor) {
    for (let i = CHUNKS.length - 1; i >= 0; i--) {
      if (!actor || CHUNKS[i].actor === actor) { restoreChunk(CHUNKS[i]); CHUNKS.splice(i, 1); }
    }
    bleedStop(actor);
    if (actor) { actor._cbcTrunk = undefined; actor._cbzKillCloud = 0; }
  };
  CBZ.creatureBiteChunkAudit = function () {
    const seen = [];
    let deepest = 0, severed = 0, craters = 0, veiled = 0, widest = 0;
    for (let i = 0; i < CHUNKS.length; i++) {
      const r = CHUNKS[i];
      if (seen.indexOf(r.actor) < 0) seen.push(r.actor);
      if (r.deep > deepest) deepest = r.deep;
      if (r.sever) severed++; else craters++;
      const p = r.pits && r.pits[0];
      if (p) {
        // the wound's world width in METRES, which is the one number that says
        // whether a wound is jaw-sized or is a plank the length of the animal.
        // The pit's matrixWorld columns already carry its own scale times
        // every parent's, so their lengths ARE the box's world extents.
        const e = p.matrixWorld.elements;
        const wr = Math.max(
          Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]),
          Math.max(Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]),
                   Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10])));
        if (wr > widest) widest = wr;
        if (p.material && p.material.userData && p.material.userData.cbzVeiled) veiled++;
      }
    }
    return {
      actors: seen.length, chunks: CHUNKS.length, severed: severed, craters: craters,
      veiled: veiled, bleeders: BLEED.length, chips: CHIPS.length,
      deepest: Math.round(deepest * 100) / 100,
      widestWound: Math.round(widest * 100) / 100,
    };
  };
  // LEAK-PROOF: a rig that left the scene (culled corpse, recycled body, mode
  // change) drops its record. Same law severAudit runs on for limbs.
  function chunkAudit() {
    for (let i = CHUNKS.length - 1; i >= 0; i--) {
      const r = CHUNKS[i], a = r.actor;
      if (!a || a.culled || !a.group || !a.group.parent || r.mesh.parent !== a.group) {
        restoreChunk(r); CHUNKS.splice(i, 1);
        if (a) { bleedStop(a); a._cbcTrunk = undefined; }
      }
    }
    for (let i = BLEED.length - 1; i >= 0; i--) {
      const a = BLEED[i].actor;
      if (!a || a.culled || !a.group || !a.group.parent) {
        if (BLEED[i].h && CBZ.goreChumStop) { try { CBZ.goreChumStop(BLEED[i].h); } catch (e) {} }
        BLEED.splice(i, 1);
      }
    }
  }

  /* ---- THE KILL PAYOFF ----------------------------------------------------
     Before this, dying to a bite underwater produced exactly the same puff of
     blood as being nicked by one: the burst at the last wound, and then
     nothing. A death is the moment the whole hunt was for and it has to read
     from thirty metres away, so it gets gore.js's kill cloud — a full burst
     plus a slow haze SHELL around the body plus a slick on the surface above
     it — once per animal, the frame after it stops.

     Hung off the chunk records rather than off any one attacker, because
     "something that had been bitten died" is the same event whether an orca
     pod did it, the player's own shark did it, or it bled out ten seconds
     after getting away. gore.js's own goreKillCloud refuses on dry land, so a
     bitten wolf dying in a forest is unaffected.

     COST while nothing is dying: a `.dead` read on at most 24 records, six
     times a second, and only while a wound exists anywhere in the world. */
  function deathScan() {
    for (let i = 0; i < CHUNKS.length; i++) {
      const r = CHUNKS[i], a = r.actor;
      if (!a || !a.dead || a._cbzKillCloud) continue;
      a._cbzKillCloud = 1;
      if (typeof CBZ.goreKillCloud !== "function") continue;
      const p = r.pits && r.pits[0];
      let x, y, z;
      if (p && p.parent) { p.getWorldPosition(_cbv); x = _cbv.x; y = _cbv.y; z = _cbv.z; }
      else if (a.group) { x = a.group.position.x; y = a.group.position.y; z = a.group.position.z; }
      else continue;
      // the cloud scales with the ANIMAL: a tuna is a puff, an orca is weather
      const L = (typeof CBZ.marineBodyLen === "function") ? CBZ.marineBodyLen(a) : 0;
      try { CBZ.goreKillCloud(x, y, z, { size: Math.max(0.5, Math.min(2.6, (L > 0 ? L : 4) * 0.22)) }); } catch (e) {}
    }
  }

  // ---- reset: detach everything ---------------------------------------------
  CBZ.clearWounds = function () {
    CBZ.creatureBiteChunkRestore(null);
    bleedStop(null);
    chipsClear();                  // loose meat is scene-parented, so it does NOT go with the rigs
    for (let i = 0; i < wounds.length; i++) {
      const r = wounds[i];
      r.gone = true;
      if (r.m.parent) r.m.parent.remove(r.m);
      if (free.length < 36) free.push(r.m);
      if (r.actor) { r.actor._woundN = 0; if (r.actor.char) r.actor.char.legHurt = null; }
    }
    wounds.length = 0;
    growing.length = 0;
  };

  // chain onto CBZ.clearGore (match reset / scene swap) — checked lazily every
  // frame (cheap flag read) so script order vs gore.js never matters.
  function wrapClearGore() {
    const orig = CBZ.clearGore;
    CBZ.clearGore = function () { CBZ.clearWounds(); return orig.apply(this, arguments); };
    CBZ.clearGore._wounds = true;
  }

  // ---- one updater: ZERO cost while nobody is being shot ---------------------
  // soak spread runs per-frame (only while a stain is actively growing);
  // record lifecycle stays on the cheap 0.8s throttle.
  let tick = 0, chunkT = 0, deadT = 0;
  CBZ.onAlways(9, function (dt) {
    if (CBZ.clearGore && !CBZ.clearGore._wounds) wrapClearGore();
    if (CHUNKS.length) {
      chunkT += dt; if (chunkT > 1.1) { chunkT = 0; chunkAudit(); }
      // a death has to read on the frame it happens, not on the 1.1s sweep
      deadT += dt; if (deadT > 0.16) { deadT = 0; deathScan(); }
    }
    // torn flesh in the water: at most 30 records, and only for the few
    // seconds after a bite. One length check when nothing is being eaten.
    if (CHIPS.length) stepChips(dt);
    if (!wounds.length) return;   // the whole system sleeps
    for (let i = growing.length - 1; i >= 0; i--) {
      const r = growing[i];
      if (r.gone || !r.m.parent) { growing.splice(i, 1); continue; }
      r.t += dt;
      const k = Math.min(1, r.t / r.gt);
      const e = 0.35 + 0.65 * Math.sqrt(k);   // fast blot, slow creep (gore pools' curve)
      r.m.scale.set(r.gx * e, r.gy * e, 1);
      if (k >= 1) growing.splice(i, 1);
    }
    tick += dt;
    if (tick < 0.8) return;
    const step = tick;
    tick = 0;
    for (let i = wounds.length - 1; i >= 0; i--) {
      const r = wounds[i], a = r.actor;
      // rig left the scene (corpse cull / crowd replacement) → free the record
      if (!a || a.culled || !a.group || !a.group.parent) { dropWound(i); continue; }
      r.age += step;
      // torn flesh scabs over on the same clock a bullet hole does
      if ((r.kind === "shot" || r.kind === "bite") && !r.dried && r.age > DRY_T) { r.dried = true; r.m.material = MAT_DRY; }
    }
  });
})();
