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
  //  actually shipped was a flat linear centre→rim gradient. That is the second
  //  half of "it looks like a sticker", and it is why the bullet path below now
  //  builds its own ring-subdivided disc (discGeo) instead of this one. This
  //  geometry is left byte-identical because the bite/blade/bruise arcs are
  //  tuned around it; only its true outer radius is now recorded for the clamp.
  function rampGeo(seg, jitter, floor) {
    const g = new THREE.CircleGeometry(1, seg);
    g._shared = true;
    const pos = g.attributes.position;
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i);
      const r0 = Math.sqrt(x * x + y * y);
      if (jitter && r0 > 0.25) {
        // the same randomly-phased-sine rim wobble the soak blobs already use,
        // just tighter — a punched hole is irregular, not lumpy
        const a = Math.atan2(y, x);
        const k = 1 + jitter * (Math.sin(a * 3 + p1) * 0.5 + Math.sin(a * 5 + p2) * 0.33 + Math.sin(a * 7 + p3) * 0.2);
        x *= k; y *= k;
        pos.setXY(i, x, y);
      }
      const r = Math.min(1, Math.sqrt(x * x + y * y));
      // r^2 keeps the dark core tight and small instead of a soft grey wash —
      // the pit should be a PIT, with the falloff crowded against the rim.
      let v = floor + (1 - floor) * (r * r);
      col[i * 3] = v;
      // green/blue lag red slightly through the mid-band, so the ring just
      // inside the rim goes raw and red rather than merely lighter.
      const raw = 1 - 0.22 * Math.max(0, 1 - Math.abs(r - 0.72) * 4);
      col[i * 3 + 1] = v * raw;
      col[i * 3 + 2] = v * raw;
    }
    pos.needsUpdate = true;
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g._maxR = maxRadiusOf(g);
    return g;
  }
  // The TRUE outer radius of a jittered disc (the rim wobble pushes vertices
  // past 1.0). Every size clamp and the audit measure against THIS, not the
  // nominal 1.0, or a stain could still overhang by its own wobble.
  function maxRadiusOf(g) {
    const p = g.attributes.position;
    let mx = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i));
      if (r > mx) mx = r;
    }
    return mx || 1;
  }
  // 14 segments reads as round at contact range; the 0.30 floor is the pit.
  const G_WOUND = rampGeo(14, 0.10, 0.30);
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
  function blobGeo() {
    const g = new THREE.CircleGeometry(1, 14);
    g._shared = true;
    const pos = g.attributes.position;
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    const col = new Float32Array(pos.count * 3);
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
      col[i * 3] = v; col[i * 3 + 1] = v * 0.94; col[i * 3 + 2] = v * 0.94;
    }
    pos.needsUpdate = true;
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g._maxR = maxRadiusOf(g);
    return g;
  }
  const G_SOAK = [blobGeo(), blobGeo(), blobGeo()];

  // ---- A DISC WITH ACTUAL RINGS IN IT (the pit the comment above promised) --
  //
  //  Everything the old ramp wanted needs vertices at the radii being shaded,
  //  and CircleGeometry has none, so build the fan by hand. `stops` are ordered
  //  outward from the centre as [radius, brightness, warm]:
  //    brightness MULTIPLIES the material's authored hex, so every wound TYPE
  //      keeps its own colour and only the SHADING lives here (same law as the
  //      old ramp — the geometry never introduces a hue of its own);
  //    warm scales green/blue only, so a band can go RAW RED rather than merely
  //      lighter — which is what an abraded margin actually looks like.
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
    const col = new Float32Array(vN * 3);
    const idx = [];
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    pos[0] = 0; pos[1] = 0; pos[2] = 0; nrm[2] = 1;
    col[0] = stops[0][1]; col[1] = stops[0][1] * stops[0][2]; col[2] = stops[0][1] * stops[0][2];
    let maxR = 0, v = 1;
    for (let s = 1; s < n; s++) {
      const r0 = stops[s][0], val = stops[s][1], warm = stops[s][2];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const k = jitter
          ? 1 + jitter * (Math.sin(a * 3 + p1) * 0.5 + Math.sin(a * 5 + p2) * 0.33 + Math.sin(a * 7 + p3) * 0.2)
          : 1;
        const rr = r0 * k;
        pos[v * 3] = Math.cos(a) * rr; pos[v * 3 + 1] = Math.sin(a) * rr; pos[v * 3 + 2] = 0;
        nrm[v * 3 + 2] = 1;
        col[v * 3] = val; col[v * 3 + 1] = val * warm; col[v * 3 + 2] = val * warm;
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
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g._shared = true;
    g._maxR = maxR || 1;
    return g;
  }
  // ENTRY: a bore you look INTO, ringed by one narrow raw margin and a low-
  // contrast bruise collar that dissolves into skin (a bright hard rim is what
  // read as a sticker). Nearly round — a punched hole is not ragged.
  const G_ENTRY = discGeo([
    [0.00, 0.05, 1.00],   // the bore itself — near-black at any wound colour
    [0.34, 0.09, 1.00],   // pit wall, still dark
    [0.60, 0.85, 0.72],   // the raw torn margin: THE one bright band
    [0.80, 0.44, 0.80],   // abrasion / stippling
    [1.00, 0.20, 0.88],   // bruising, low contrast against skin
  ], 16, 0.07);
  // EXIT: a cavity, not a bore. Brightest just off centre (wet, open tissue),
  // fading out, and TORN — the heavy rim jitter is the whole silhouette.
  const G_EXIT = discGeo([
    [0.00, 0.58, 0.85],
    [0.30, 0.95, 0.72],
    [0.55, 0.62, 0.78],
    [0.78, 0.34, 0.85],
    [1.00, 0.13, 0.90],
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
    const m = new THREE.MeshBasicMaterial({
      color, vertexColors: true,
      polygonOffset: true, polygonOffsetFactor: po != null ? po : -3, polygonOffsetUnits: po != null ? po : -3,
    });
    m._shared = true;
    return m;
  }
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

  function dist2Cam(x, z) {
    const c = CBZ.camera && CBZ.camera.position;
    if (!c) return 0;
    const dx = x - c.x, dz = z - c.z;
    return dx * dx + dz * dz;
  }

  // ---- which body part did the hit land on? --------------------------------
  // Classified in the ACTOR ROOT's local frame (handles facing + ragdoll
  // topple): head sphere flag wins outright, else height + lateral offset
  // split torso / arm / leg, matching the rig layout in entities/character.js.
  function pickPart(actor, px, py, pz, headFlag) {
    const S = actor.char.skinSlots, g = actor.group;
    g.updateWorldMatrix(true, false);
    tmpV.set(px, py, pz);
    g.worldToLocal(tmpV);
    const x = tmpV.x, y = tmpV.y;
    if ((headFlag || y > 1.98) && S.head && S.head[0]) return { mesh: S.head[0], region: "head" };
    if (y > 1.02) {
      if (Math.abs(x) > 0.47 && S.arms && S.arms.length === 2) {
        // two-segment arms: below the elbow line (~1.38 in root space) the
        // round hit the FOREARM mesh, not the upper arm — seat the decal on
        // the mesh that actually contains the point or it clamps to the
        // upper segment's end face and every arm wound bunches at the elbow.
        const lower = y < 1.40 && S.armsLower && S.armsLower.length === 2 ? S.armsLower : null;
        const list = lower || S.arms;
        return x < 0 ? { mesh: list[0], region: "armL" } : { mesh: list[1], region: "armR" };
      }
      return { mesh: S.torso && S.torso[0], region: "torso" };
    }
    if (S.legs && S.legs.length === 2) {
      // knee line sits ~0.47 in root space; below it the shin took the hit
      const lower = y < 0.47 && S.legsLower && S.legsLower.length === 2 ? S.legsLower : null;
      const list = lower || S.legs;
      return x < 0 ? { mesh: list[0], region: "legL" } : { mesh: list[1], region: "legR" };
    }
    return { mesh: S.torso && S.torso[0], region: "torso" };
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
    if (!actor || !wp || actor.culled || !CBZ.scene) return;
    const ch = actor.char;
    if (!ch || !ch.skinSlots || !actor.group || actor.group.visible === false) return;
    let px = wp.x, py = wp.y, pz = wp.z;
    if (px == null || py == null || pz == null) return;
    if (dist2Cam(px, pz) > SPAWN_D2) return;                // only where it can be seen

    // A bite is ONE event that intentionally lays many marks, so it stamps the
    // burst window rather than being throttled by it (the shotgun-pellet guard
    // in bodyWound would otherwise eat most of the tooth row). Re-biting the
    // same body inside the window is still refused.
    const now = performance.now();
    if (now - (actor._biteT || -1e9) < 260) return;
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
    if (!part || !part.geometry) return;

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

    // THE TEAR: a bite bleeds far harder and faster than a bullet — one broad
    // stain filling the whole jaw print, arriving fast, plus a heavier second
    // bloom for a deep bite. This is most of what sells it at distance.
    _bl.x = cx; _bl.y = cy; _bl.z = cz;
    spawnSoak(actor, part, _bl, R * (1.7 + sev * 1.1), 0.7);
    if (sev > 0.55) spawnSoak(actor, part, _bl, R * (2.4 + sev * 1.4), 1.9);

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
      const key = pick.region === "legL" ? "ll" : pick.region === "legR" ? "rl"
        : pick.region === "armL" ? "la" : pick.region === "armR" ? "ra" : null;
      if (key) { try { CBZ.goreSever(actor, key, { dir: opts.dir || null }); } catch (e) {} }
    }
  };

  // ---- CBZ.bodyWound(actor, worldPoint, opts) -------------------------------
  CBZ.bodyWound = function (actor, wp, opts) {
    if (!actor || !wp || actor.culled || !CBZ.scene) return;
    const ch = actor.char;
    if (!ch || !ch.skinSlots || !actor.group || actor.group.visible === false) return;
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
    if (px == null || py == null || pz == null) return;
    if (dist2Cam(px, pz) > SPAWN_D2) return;   // only where it can be seen

    // burst window: a shotgun's pellets (or a same-frame double report) land
    // SCATTERED wounds, never a pool-flushing spray. CITY lets more pellets
    // through (a shotgun blast peppers the body — owner wants it to READ shot
    // up) while still capping the same-frame burst; jail/survival keep 3.
    const burstCap = cityWounds() ? 6 : 3;
    const now = performance.now();
    if (now - (actor._woundT || -1e9) < 90) {
      if ((actor._woundBurst || 0) >= burstCap) return;
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
    if (!part || !part.geometry) return;

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
    return { decals: decals, oversized: oversized, cameraFacing: cameraFacing };
  };

  // ---- reset: detach everything ---------------------------------------------
  CBZ.clearWounds = function () {
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
  let tick = 0;
  CBZ.onAlways(9, function (dt) {
    if (CBZ.clearGore && !CBZ.clearGore._wounds) wrapClearGore();
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
