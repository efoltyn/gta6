/* ============================================================
   core/sky.js — THE SKY AND THE EDGE OF THE WORLD.
   WHY: the world must never visibly end. The old dome was r=400 with
   depthWrite ON — anything past 400u got depth-rejected, so the far
   island/city VANISHED across town. Now: an r=850 dome (camera far is
   1000) that writes no depth, whose horizon is forced to EXACTLY the
   scene fog colour every frame (no seam between fogged ground and sky,
   in every mode, at every time of day), stars + sun + moon riding
   daynight's clock, and clouds over every inhabited region.
   NO HORIZON RINGS — owner's standing order (filmed it twice): no
   painted skyline cylinders, no window-light ring, no haze band. The
   horizon is the real sea + fog, nothing else. Do not re-add them.

   THE SUNSET PASS (user-filmed: skyline read as flat white paper
   cutouts, dusk read as one flat orange wash):
   - the dome canvas is now a TRUE multi-stop gradient driven by
     deliberate palette tables (day / dusk / night) — zenith stays deep
     blue at sunset while a wide warm BURN pinned to the sun's azimuth
     makes the horizon glow on the sun's side only. A uniform tint
     (the old daynight skyC multiply) mathematically cannot do this;
     daynight now leaves the dome tint white and this file owns colour.
   - the sun disc grows a big soft additive halo at golden hour/dusk.
   BUDGET: the authored daylight photograph is the one cloud source. Procedural
   box/billboard layers are retained only as dormant fallback code and are not
   mounted or updated, avoiding both the visual double-cloud and two draw calls.
   - assets/sky/day.jpg (2:1 equirect) is used as the day layer when it
     loads; it crossfades OUT at golden hour (the photo has no sunset
     in it) and the procedural gradient takes over.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.scene;
  const g = CBZ.game;

  // seeded prng so the skyline is the same city every session (players
  // learn the silhouette of "their" town — it reads as a place, not noise)
  function mulberry32(s) {
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* ---------------- 0a. THE SKY AT ALTITUDE (SKY_ALTITUDE) -------------
     OWNER (with a screenshot from the pilot origin's B-2 at 1,750 m):
     "when too high sky goes black and the fake sky doesn't show… sun acts
     strange, rising from looking like its coming from the ground instead
     of coming from horizon."

     Both symptoms were ONE line. The rig followed the camera in x/z only
     (`rig.position.set(cam.x, 0, cam.z)`), so:
       • the r=850 BackSide dome was centred on SEA LEVEL. Above y=850 the
         camera is OUTSIDE the sphere, a back-faced sphere seen from
         outside draws nothing, and the sky is a black void. At 1,750 m
         you are twice the dome's radius above its centre.
       • the sun/moon/halo/glare sprites sit at radius 795 on that same
         rig, so their apparent direction was measured from a point
         1,750 m BELOW the eye. The sun at true elevation 0° appeared at
         asin(795·sin(0°) − 1750)/795 → far under the airframe: a glow
         coming up out of the terrain instead of a disc on the horizon.

     THE SUN IS AT INFINITY. Its apparent direction is the SAME from a
     kerb and from 5 km up, and that is exactly what centring the rig on
     the camera in all three axes restores — the disc lands on the real
     `CBZ.sun` direction at every altitude, for free, with no per-altitude
     correction of any kind. Nothing else has to move.

     This is only safe because the dome is a pure background: MeshBasic,
     depthWrite:false, depthTest:false, renderOrder −10000. It cannot
     occlude, depth-reject or z-fight with world geometry no matter where
     its centre sits, so wrapping it around the camera costs nothing.

     THE HORIZON LINE DOES NOT MOVE, AND THAT IS DERIVED, NOT LAZY. Our
     world is FLAT (scrolls/claude/doctrine.md — the true sphere was refused
     on arithmetic). On a flat sea the horizon is the vanishing line of
     the water plane, which sits at EXACTLY eye level at every altitude
     (atan(h/d) → 0 as d → ∞); only a curved earth dips it. So the
     painted horizon stays at v=0.5 and everything below it stays the
     pure fog colour — which is also what closes the seam at altitude:
     the water plate is clipped at camera.far (≥7000 m airborne), so
     between 0° and asin(1750/7000) = 14.5° of depression there is no
     geometry at all and the dome IS the distant sea. Painting a
     "horizon dip" there would be a fake band, and fake bands are banned
     by the same owner order as the skyline rings.
  --------------------------------------------------------------------- */
  if (CBZ.CONFIG.SKY_ALTITUDE == null) CBZ.CONFIG.SKY_ALTITUDE = true;

  // Barometric scale height of Earth's atmosphere. Pressure — and with it
  // the Rayleigh column that IS the blue of the sky — falls as exp(-h/H).
  const AIR_SCALE_H = 8500;   // m
  // Aerosol (haze/dust/water-vapour) scale height. Much lower than the gas
  // column: this is the layer that makes the bright band hugging the horizon.
  const HAZE_SCALE_H = 1200;  // m
  // What the sky tends toward once you have climbed out of the air that lit
  // it: not grey, but a deep violet-black — high-altitude skies desaturate
  // toward space, they do not fade toward the fog.
  const SPACE = new THREE.Color(0x040814);

  // Everything sky-distance lives on one rig that FOLLOWS the camera, so
  // the sky surrounds the player in all three worlds (escape z≈0,
  // survival z≈600, city z≈-700) — a dome pinned to origin showed as a
  // black "roof" over the far arenas.
  const rig = new THREE.Group();
  scene.add(rig);

  /* ---------------- 0. palette tables --------------------------------
     Deliberate keyframes instead of deriving every colour from the one
     fog colour (that derivation is exactly what made day rings read as
     white paper and dusk read flat). Day ring tints still TRACK the
     live fog (weather darkens them correctly) — but desaturated and
     stepped darker; dusk/night looks are authored here. */
  // UPPER-ATMOSPHERE BAND (`top`): the dome used to start at the zenith stop
  // and run straight down, so from an aircraft — where you are looking at a
  // lot of sky above the zenith line — the whole upper hemisphere was one
  // flat colour. A fourth, darker/denser stop above the zenith gives the sky
  // real vertical depth for the cost of one extra gradient stop in a canvas
  // repaint that is already throttled to <=10Hz.
  const PAL = {
    day: {
      top: new THREE.Color(0x14418f),   // thin air above the zenith
      zen: new THREE.Color(0x2a64c8),   // zenith blue
      mid: new THREE.Color(0x6fa3e8),   // mid-sky
    },
    dusk: {
      top: new THREE.Color(0x0e1636),
      zen: new THREE.Color(0x1d2c58),   // zenith STAYS deep blue at sunset
      mid: new THREE.Color(0x8a5f7e),   // mauve mid-band
      ringNear: new THREE.Color(0x2e2840), // dark backlit silhouette
      ringFar: new THREE.Color(0x4d3c52),  // one haze step lighter
      win: new THREE.Color(0xffa45e),      // window dots warm up
    },
    night: {
      top: new THREE.Color(0x02030a),
      zen: new THREE.Color(0x05080f),
      mid: new THREE.Color(0x0c1428),
      ringNear: new THREE.Color(0x0a0e16), // near-black; windows carry it
      ringFar: new THREE.Color(0x121a2b),
    },
    /* THE STORM DECK. Authored, not derived — for the same reason every
       other row here is authored: a deck derived from the disaster's fog
       colour (0x3a4150) is just that slate everywhere, and a real overcast
       sky is NOT one flat value. It is dark directly overhead, where you are
       looking through the whole thickness of the cloud base, and it gets
       PALER toward the horizon, where daylight is leaking in under the deck
       from tens of kilometres away. That vertical inversion — dark above,
       bright below — is what reads as "a ceiling over the world" instead of
       "grey paint on a dome", and it is the first thing the owner's
       reference photograph shows. These are then nudged 18% toward the live
       fog so a blizzard's whiteout and a volcanic red still carry into the
       cloud, without the mood being allowed to flatten it. */
    storm: {
      top: new THREE.Color(0x3c4652),   // the base of the cloud, straight up
      mid: new THREE.Color(0x5b6874),
      low: new THREE.Color(0x8e9ca8),   // daylight under the deck, near the horizon
    },
    glow: { // the sunset burn, golden hour (sun up) → civil dusk (sun dipped)
      golden: new THREE.Color(0xffd98c),
      goldenMid: new THREE.Color(0xffb15e),
      civil: new THREE.Color(0xff7330),    // hot orange core
      civilMid: new THREE.Color(0xff5a57), // pink shoulder
    },
  };

  function css(c) {
    return "rgb(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + ")";
  }
  function cssA(c, aa) {
    return "rgba(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + "," + (+aa).toFixed(3) + ")";
  }

  /* ---------------- 1. the dome -------------------------------------
     r=850 < camera far (1000); depthWrite:false so it can never depth-
     reject real geometry behind/inside it. The canvas is repainted
     (throttled) so its horizon band ALWAYS equals scene.fog.color
     divided by the dome's tint — survival's env override multiplies the
     dome by material.color, so texel × tint must land exactly on the
     fog colour where sky meets ground. */
  const SKY_W = 1024, SKY_H = 512, HORIZON_Y = SKY_H * 0.5; // v=0.5 = y-0 horizon
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = SKY_W; skyCanvas.height = SKY_H;
  const skyCtx = skyCanvas.getContext("2d");
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  const dome = new THREE.Mesh(
    // 48x32 rather than 32x20: at altitude the horizon ramp compresses to a
    // few degrees (see hazeK below) and a 9°-tall latitude band was wide
    // enough to facet it. One dome, 1536 quads — free, and it buys a clean
    // horizon line from an aircraft.
    new THREE.SphereGeometry(850, 48, 32),
    // This is a background, never world geometry. The old depth-tested sphere
    // sat only 850 m from the camera; once aircraft draw distance grew to
    // kilometres its lower hemisphere passed the depth test in front of dry
    // land and painted a fake light-blue/grey "second water" over the map.
    // Draw it first without touching/testing depth so every real land, ocean,
    // mountain and building deterministically overwrites it afterward.
    new THREE.MeshBasicMaterial({
      map: skyTex, side: THREE.BackSide, fog: false,
      depthWrite: false, depthTest: false,
    })
  );
  dome.renderOrder = -10000;
  dome.frustumCulled = false;
  rig.add(dome);
  CBZ.skyDome = dome; // modes/survival.js tints this for disaster moods

  // optional photo sky: assets/sky/day.jpg (equirect 2:1). Pre-downscaled
  // ONCE into an offscreen canvas so each repaint is a cheap blit, never a
  // 2048×1024 rescale. If the file is missing/broken we just stay procedural.
  let photoLayer = null;
  (function loadPhoto() {
    const img = new Image();
    img.onload = function () {
      const pc = document.createElement("canvas");
      pc.width = SKY_W; pc.height = Math.floor(SKY_H * 0.66); // upper sky only; fog band owns the rest
      pc.getContext("2d").drawImage(img, 0, 0, img.width, img.height * 0.66, 0, 0, pc.width, pc.height);
      photoLayer = pc;
      forcePaint = true;
    };
    img.onerror = function () { photoLayer = null; };
    img.src = "assets/sky/day.jpg";
  })();

  /* ---------------- 1b. THE STORM DECK ------------------------------
     OWNER, holding up a photograph of a real strike: "your lighting in the
     game is fucking amazing, the issue is the sky is a nice blue sky with
     hardly any clouds during the lightning storm."

     Correct, and it was structural rather than a tuning miss. This file had
     NO weather input at all: its one read of systems/weather.js sat behind
     PROCEDURAL_CLOUDS, which is false, so the LIGHTNING STORM disaster —
     which drives rain 0.92, wind 9, fog and lightning 1 through the shared
     weather system, and gets wet asphalt, wet grip, flashes and real bolts
     for it — was throwing those bolts out of the clear-day gradient and the
     cloudless assets/sky/day.jpg. survival's mood tint then multiplied that
     blue by slate, which is a DARKER BLUE CLOUDLESS SKY, exactly as filmed.
     A multiply can only ever darken what is already painted; it cannot put
     cloud where there is none.

     So the deck is painted, into the one canvas that already carries the
     sky, and it is painted IN PERSPECTIVE. A cloud layer is flat and it is
     over your head, so the piece of it directly above you is small and
     spread across a lot of sky, while everything from there to the horizon
     is tens of kilometres of deck crushed into the last few degrees. Drawing
     the noise straight down the canvas gets that exactly backwards and reads
     as wallpaper on a dome — the giveaway being cloud "features" that stay
     the same size all the way to the waterline. Instead the band loop below
     samples the tile at the ground radius r = h/tan(elevation) that each
     canvas row is actually looking at, so the structure compresses toward
     the horizon on its own and the deck reads as a ceiling with distance in
     it. Cost is ~40 pattern fillRects inside a repaint that is already
     throttled to ≤10 Hz, and zero when it is not raining.

     BUDGET NOTE: this is why the dormant PROCEDURAL_CLOUDS box/billboard
     layers stay dormant. They are two more draw calls and they cannot do
     the one thing an overcast sky must do — close the WHOLE sky. */
  const DECK_N = 256;                 // tile is square and wraps in both axes
  const DECK_BANDS = 22;              // perspective steps from zenith to horizon
  /* The ground radius (in deck heights) at which HALF the tile has been
     crossed. This was written as a multiplier on r and it was the single
     worst thing in the first pass: r·6.3 saturates by r≈0.16, i.e. the ENTIRE
     tile was spent within a few degrees of the zenith and the rest of the sky
     was one smeared band. As a radius, 1.15 puts the halfway point at 41°
     elevation — features stay roughly square through the mid sky and the
     compression lands where a real deck's does, in the last few degrees. */
  const DECK_R0 = 1.15;
  let deckDark = null, deckLite = null, deckBuilt = false;
  let deckPatD = null, deckPatL = null;
  const DECK_XFORM = (typeof DOMMatrix !== "undefined");

  function buildDeck() {
    if (deckBuilt) return;
    deckBuilt = true;                 // one attempt, ever — a failure stays failed
    try {
      // Periodic value noise. Every octave's period DIVIDES DECK_N, which is
      // what makes the tile seamless in both axes — required, because the
      // painter wraps it around all 360° of azimuth and scrolls it as the
      // deck drifts downwind. Lattices are built first and sampled bilinearly,
      // rather than hashing per pixel per octave: same field, ~8× cheaper,
      // and this runs on the frame the first storm cloud appears.
      const OCT = [[4, 0.50], [8, 0.26], [16, 0.14], [32, 0.08], [64, 0.05], [128, 0.022]];
      const field = new Float32Array(DECK_N * DECK_N);
      let norm = 0;
      for (let o = 0; o < OCT.length; o++) {
        const P = OCT[o][0], amp = OCT[o][1]; norm += amp;
        const lat = new Float32Array(P * P);
        for (let i = 0; i < P * P; i++) {
          let n = Math.imul(i + 1, 374761393) ^ Math.imul(o + 7, 668265263);
          n = Math.imul(n ^ (n >>> 13), 1274126177);
          lat[i] = ((n ^ (n >>> 16)) >>> 0) / 4294967296;
        }
        const cell = DECK_N / P;
        for (let y = 0; y < DECK_N; y++) {
          const fy = y / cell, iy = Math.floor(fy), ty = fy - iy;
          const sy = ty * ty * (3 - 2 * ty);
          const y0 = (iy % P) * P, y1 = ((iy + 1) % P) * P;
          for (let x = 0; x < DECK_N; x++) {
            const fx = x / cell, ix = Math.floor(fx), tx = fx - ix;
            const sx = tx * tx * (3 - 2 * tx);
            const x0 = ix % P, x1 = (ix + 1) % P;
            const a = lat[y0 + x0], b = lat[y0 + x1];
            const c = lat[y1 + x0], d = lat[y1 + x1];
            field[y * DECK_N + x] += amp * ((a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy);
          }
        }
      }
      // TWO COMPLEMENTARY MAPS OFF ONE FIELD, never two fields: where the
      // cloud is thick its underside is dark, and where it thins the daylight
      // above it comes through. Splitting one density about its midpoint keeps
      // the light and the dark INTERLOCKED — the bright patches are exactly
      // the gaps in the dark ones, which is what makes a deck read as a single
      // body of cloud rather than two unrelated grey washes.
      const mk = function (r, g, b, lo, hi, gain) {
        const cv = document.createElement("canvas");
        cv.width = DECK_N; cv.height = DECK_N;
        const cx = cv.getContext("2d");
        const im = cx.createImageData(DECK_N, DECK_N);
        const px = im.data;
        for (let i = 0; i < DECK_N * DECK_N; i++) {
          const d = field[i] / norm;
          let a = (d - lo) / (hi - lo);
          a = a < 0 ? 0 : a > 1 ? 1 : a;
          a = a * a * (3 - 2 * a) * gain;
          const o = i * 4;
          px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = Math.round(a * 255);
        }
        cx.putImageData(im, 0, 0);
        return cv;
      };
      // Thresholds are deliberately MEAN-OFFSET rather than symmetric about
      // the field's centre. An overcast deck is mostly deck: light has to be
      // earned by a real thinning, or the "gaps" cover half the sky and the
      // whole thing renders as white fog instead of storm cloud. (It did.)
      deckDark = mk(20, 25, 32, 0.40, 0.74, 1);      // thick cloud, lit from above only
      deckLite = mk(226, 234, 240, 0.34, 0.12, 1);   // hi<lo inverts: only the thin gaps
      deckPatD = skyCtx.createPattern(deckDark, "repeat");
      deckPatL = skyCtx.createPattern(deckLite, "repeat");
    } catch (_) { deckDark = deckLite = deckPatD = deckPatL = null; }
  }

  // canvas row → how far out across a flat deck that row is looking, 0 at the
  // zenith and saturating at the horizon. This one line is the perspective.
  function deckV(y) {
    const el = Math.max(0.02, (0.5 - y / SKY_H) * Math.PI);
    const r = 1 / Math.tan(el);        // ground radius, in deck heights
    return r / (r + DECK_R0);
  }

  function deckLayer(pat, reps, driftU, driftV, alpha, bot) {
    if (!pat || alpha < 0.004) return;
    const sx = SKY_W / (DECK_N * 3);   // three tile widths around the horizon
    skyCtx.fillStyle = pat;
    const span = DECK_N * reps;
    for (let i = 0; i < DECK_BANDS; i++) {
      /* BANDS BUTT-JOINT ON INTEGER ROWS. They used to overlap by a pixel to
         hide a rounding gap — but these fills are TRANSLUCENT, so an
         overlapping row is composited twice and comes out darker than either
         neighbour. That drew 22 concentric arcs across the sky: not clouds,
         the seams between the bands drawing them. Snapping to integers makes
         the rects tile exactly, so there is nothing to gap and nothing to
         double. */
      const y0 = Math.round((i / DECK_BANDS) * bot), y1 = Math.round(((i + 1) / DECK_BANDS) * bot);
      if (y1 <= y0) continue;
      const v0 = deckV(y0) * span, v1 = deckV(y1) * span;
      const dv = v1 - v0;
      if (!(dv > 1e-4)) continue;
      /* AND THE STRUCTURE FADES OUT AT THE ZENITH. An equirectangular canvas
         wraps every row around a latitude circle, so near the pole one row of
         tile is smeared through 360° and cloud detail turns into radial
         streaks — a mapping artefact, not weather. Fading the structure into
         the flat base over the top of the sky removes it, and removes it in
         the direction the truth points anyway: straight up through a storm
         deck you are looking through its full thickness, which is the darkest
         and most featureless part of the sky. Same `v` as the perspective, so
         it costs nothing. */
      const zen = Math.min(1, (deckV((y0 + y1) * 0.5)) * 4.2);
      if (zen < 0.01) continue;
      const sy = (y1 - y0) / dv;
      skyCtx.globalAlpha = alpha * zen;
      pat.setTransform(new DOMMatrix([sx, 0, 0, sy, driftU, y0 - (v0 + driftV) * sy]));
      skyCtx.fillRect(0, y0, SKY_W, y1 - y0);
    }
    skyCtx.globalAlpha = 1;
  }

  function paintDeck(fadeTop) {
    const k = frame.stormK;
    if (k < 0.01) return;
    buildDeck();
    /* THE DECK RUNS TO THE HORIZON ROW, NOT TO `fadeTop`. The fog ramp only
       reaches full opacity AT the horizon, so a deck that stopped where the
       ramp starts left ~50 px of untouched clear blue between the cloud and
       the fog — a bright band right around the waterline, which is the one
       place the owner was already looking. Painting down to HORIZON_Y hands
       the last 50 px to the ramp, which melts the cloud into exactly the fog
       colour, and the seam law at step 4 is untouched. */
    const bot = HORIZON_Y;
    // 1) the base ceiling: opaque at full overcast, so the blue underneath is
    //    GONE rather than tinted. This is the half that fixes the complaint;
    //    the structure below is the half that makes it worth looking at.
    const g = skyCtx.createLinearGradient(0, 0, 0, bot);
    g.addColorStop(0, cssA(_stTop, k));
    g.addColorStop(0.55, cssA(_stMid, k));
    g.addColorStop(1, cssA(_stLow, k));
    skyCtx.fillStyle = g;
    skyCtx.fillRect(0, 0, SKY_W, Math.ceil(bot));
    if (!DECK_XFORM || !deckPatD || !deckPatD.setTransform) return; // flat deck, still a deck
    // 2) structure. The two layers run at different tile counts and different
    //    drift rates because a storm sky is not one sheet — it is a ragged
    //    lower layer sliding under a slower mass above it, and that parallax
    //    is most of what sells depth in a still frame.
    deckLayer(deckPatD, 1.15, frame.stormU, frame.stormV, k * 0.92, bot);
    deckLayer(deckPatL, 0.8, frame.stormU * 0.5 + 90, frame.stormV * 0.5, k * frame.stormLit * 0.3, bot);
  }

  // horizon colour = fog ÷ tint (clamped) so (texel × tint) == fog exactly
  function horizonCss(fog, tint) {
    const r = Math.min(255, Math.round((fog.r / Math.max(tint.r, 0.004)) * 255));
    const gg = Math.min(255, Math.round((fog.g / Math.max(tint.g, 0.004)) * 255));
    const b = Math.min(255, Math.round((fog.b / Math.max(tint.b, 0.004)) * 255));
    return "rgb(" + r + "," + gg + "," + b + ")";
  }

  // frame state the painter reads (computed each frame, painted throttled)
  const frame = {
    glowU: 0, glowK: 0, photoK: 1, duskW: 0, spaceK: 0, hazeK: 1,
    // the storm deck: coverage 0..1, its drift in canvas px, and how much
    // daylight is left to light the thin gaps (a night deck has none).
    stormK: 0, stormU: 0, stormV: 0, stormLit: 1,
  };
  const _zen = new THREE.Color(), _mid = new THREE.Color(), _top = new THREE.Color();
  const _hot = new THREE.Color(), _gmid = new THREE.Color();
  const _stTop = new THREE.Color(), _stMid = new THREE.Color(), _stLow = new THREE.Color();

  function paintSky(fog, tint) {
    const hz = horizonCss(fog, tint);
    // THE HAZE BAND IS AN AEROSOL LAYER, SO IT THINS AS YOU LEAVE IT.
    // Sea-level band is 52 px of a 512 px / 180° canvas = 18.3°, shortened
    // at dusk so the burn reaches the waterline. `frame.hazeK` is the share
    // of the aerosol column still ABOVE the camera (exp(-h/1200): 1.00 on
    // the deck, 0.23 at 1,750 m, 0.015 at 5 km) — that is how much air a
    // near-horizontal sight line still has to cross, so it is how tall the
    // band should be. The 0.30 floor keeps ~5.5° of softness: a real
    // horizon from a jetliner is CRISP, never a hard cut, and a hard cut
    // here would read as exactly the painted band the owner banned.
    const fadeTop = HORIZON_Y - (52 - 26 * frame.duskW) * (0.30 + 0.70 * frame.hazeK);
    // 1) multi-stop vertical gradient: zenith → mid → fog-horizon. The
    //    zenith keeps its own colour while only the low sky approaches the
    //    fog — the one thing a whole-dome tint could never do.
    const grd = skyCtx.createLinearGradient(0, 0, 0, SKY_H);
    grd.addColorStop(0, css(_top));
    grd.addColorStop(0.15, css(_zen));
    grd.addColorStop(0.28, css(_mid));
    grd.addColorStop(0.47, hz);
    grd.addColorStop(1, hz);
    skyCtx.fillStyle = grd; skyCtx.fillRect(0, 0, SKY_W, SKY_H);
    // 2) the photo sky owns clear daylight, fading out into golden hour —
    //    there is no sunset inside the jpg, the gradient has to take over
    if (photoLayer && frame.photoK > 0.01) {
      skyCtx.globalAlpha = frame.photoK;
      skyCtx.drawImage(photoLayer, 0, 0);
      skyCtx.globalAlpha = 1;
    }
    // 2b) ALTITUDE. Drawn AFTER the photo on purpose: assets/sky/day.jpg was
    //    shot from the ground and would otherwise paste a sea-level sky over
    //    the whole upper hemisphere at 5 km. `frame.spaceK` is the share of
    //    the air column already BELOW the camera (1 - exp(-h/8500) — 0.00 on
    //    the deck, 0.19 at 1,750 m, 0.45 at 5 km), i.e. exactly how much of
    //    the sky's own scattering source you have climbed out of, times how
    //    lit the sky is at all. It fades to zero at the top of the fog band,
    //    so the seam texel is untouched by construction.
    if (frame.spaceK > 0.008) {
      const gsp = skyCtx.createLinearGradient(0, 0, 0, fadeTop);
      gsp.addColorStop(0, cssA(SPACE, frame.spaceK));
      gsp.addColorStop(0.55, cssA(SPACE, frame.spaceK * 0.45));
      gsp.addColorStop(1, cssA(SPACE, 0));
      skyCtx.fillStyle = gsp; skyCtx.fillRect(0, 0, SKY_W, Math.ceil(fadeTop));
    }
    // 2c) THE STORM DECK, over the clear sky and over the photo — a cloud
    //     layer is the nearest thing in the sky and it occludes everything
    //     behind it, including the sun's own burn below. Drawn only down to
    //     `fadeTop`, so the fog band at step 4 melts it into the horizon for
    //     free and the seam law is untouched.
    paintDeck(fadeTop);
    // 3) THE BURN: a wide warm glow pinned to the sun's azimuth (canvas u),
    //    so the horizon goes hot orange/pink on the sun's side while the
    //    far side and zenith stay cool. Drawn 3× for the u=0/1 seam wrap;
    //    only above the horizon — below it the fog band owns everything.
    if (frame.glowK > 0.015) {
      // The burn is sunlight scattered by the LOW atmosphere, so its vertical
      // reach shrinks with the same aerosol column that sets the haze band:
      // from the deck it floods 79° of sky, from 1,750 m about 40°, from 5 km
      // about 28°. That is what turns a flat pink wash over the whole
      // windscreen into a burn that hugs the horizon the sun is rising out of.
      const gx = frame.glowU * SKY_W, ry = SKY_H * 0.44 * (0.35 + 0.65 * frame.hazeK);
      for (let i = -1; i <= 1; i++) {
        skyCtx.save();
        skyCtx.translate(gx + i * SKY_W, HORIZON_Y);
        skyCtx.scale(2.2, 1); // sunset glow is wide, not tall
        const g2 = skyCtx.createRadialGradient(0, 0, 0, 0, 0, ry);
        g2.addColorStop(0, cssA(_hot, 0.85 * frame.glowK));
        g2.addColorStop(0.38, cssA(_gmid, 0.45 * frame.glowK));
        g2.addColorStop(1, cssA(_gmid, 0));
        skyCtx.fillStyle = g2;
        skyCtx.fillRect(-ry, -ry, ry * 2, ry);
        skyCtx.restore();
      }
    }
    // 4) the fog band: sky melts into EXACTLY the fog colour at the horizon,
    //    and everything below the horizon IS the fog colour (no seam, ever).
    //    The band gets SHORTER at dusk so the burn reaches the waterline.
    // THE RAMP MUST REACH ALPHA 1 EXACTLY AT THE HORIZON ROW. It used to end
    // at HORIZON_Y + 4, so at the horizon itself the fade was only
    // (band)/(band+4) opaque — 87% at sea level, and 75% once the band thins
    // at altitude — while the row immediately below is the solid fog fill at
    // 100%. That step let a quarter of the sunset burn survive on one side of
    // a line and none on the other: a hard horizontal edge straight across
    // the sky, i.e. exactly the painted band this file bans. It was always
    // there; at sea level real geometry covers the row it happens on.
    const fade = skyCtx.createLinearGradient(0, fadeTop, 0, HORIZON_Y);
    fade.addColorStop(0, hz.replace("rgb", "rgba").replace(")", ",0)"));
    fade.addColorStop(1, hz.replace("rgb", "rgba").replace(")", ",1)"));
    skyCtx.fillStyle = fade; skyCtx.fillRect(0, fadeTop, SKY_W, HORIZON_Y - fadeTop);
    skyCtx.fillStyle = hz; skyCtx.fillRect(0, HORIZON_Y, SKY_W, SKY_H - HORIZON_Y);
    skyTex.needsUpdate = true;
  }

  /* ---------------- 2. NO horizon rings. EVER. ----------------------
     OWNER DECISION (stated twice, with screenshots): no painted skyline
     cutouts, no lit-window ring, no haze-band cylinder — every one of
     them reads as a fake "ring around the world" from any rooftop or
     aircraft. The horizon is the real sea plane melting into the fog
     and the dome's fog band. DO NOT ADD RING MESHES BACK. */

  /* ---------------- 3. stars -----------------------------------------
     Disabled by design.  Screen-space Points read as white weather/dust
     floating in front of the HUD and terrain from an aircraft.  The authored
     sky gradient, sun and moon carry time-of-day without fake specks. */
  const STARS = 800;
  const starGeo = new THREE.BufferGeometry();
  (function () {
    const rnd = mulberry32(777);
    const pos = new Float32Array(STARS * 3), col = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
      const az = rnd() * Math.PI * 2;
      const up = 0.05 + 0.95 * rnd();                  // upper hemisphere only
      const hr = Math.sqrt(Math.max(0, 1 - up * up));
      const r = 780 * (0.97 + rnd() * 0.03);
      pos[i * 3] = Math.cos(az) * hr * r; pos[i * 3 + 1] = up * r; pos[i * 3 + 2] = Math.sin(az) * hr * r;
      const warm = rnd();                              // subtle blue↔warm spread
      const b = 0.72 + rnd() * 0.28;
      col[i * 3] = b * (0.85 + warm * 0.15); col[i * 3 + 1] = b * 0.92; col[i * 3 + 2] = b * (1.0 - warm * 0.18);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  })();
  const starMat = new THREE.PointsMaterial({
    size: 1.7, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -5; stars.visible = false;
  rig.add(stars);

  /* ---------------- 4. sun + moon sprites + dusk halo ----------------
     Placed from daynight's sun angle (CBZ.sunAngle) so the glowing disc
     in the sky IS the light that's hitting the streets. Additive, no
     depth write — the skyline rings silhouette against them at dusk.
     At golden hour/dusk the disc warms, swells slightly, and a big soft
     additive halo blooms around it (the burn made local). */
  function discTexture(stops) {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 128;
    const cx = cv.getContext("2d");
    const grd = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const s of stops) grd.addColorStop(s[0], s[1]);
    cx.fillStyle = grd; cx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  }
  function skySprite(tex, scale) {
    const m = new THREE.SpriteMaterial({
      map: tex, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, fog: false, opacity: 0,
    });
    const s = new THREE.Sprite(m);
    s.scale.set(scale, scale, 1);
    s.renderOrder = -4; s.visible = false;
    rig.add(s);
    return s;
  }
  const sunSpr = skySprite(discTexture([
    [0, "#ffffff"], [0.16, "#fff3c8"], [0.42, "rgba(255,205,110,0.55)"], [1, "rgba(255,170,60,0)"],
  ]), 95);
  const moonSpr = skySprite(discTexture([
    [0, "#f4f8ff"], [0.2, "#cfd9f2"], [0.45, "rgba(168,188,228,0.28)"], [1, "rgba(150,170,210,0)"],
  ]), 58);
  moonSpr.material.color.setHex(0xdfe8ff);
  // coreless, very soft falloff — pure glow, the white centre stays the disc's job
  const haloSpr = skySprite(discTexture([
    [0, "rgba(255,210,150,0.5)"], [0.4, "rgba(255,165,95,0.26)"], [1, "rgba(255,120,60,0)"],
  ]), 200);

  /* ---------------- 4b. SUN GLARE (the sun-shaft approximation) -------
     There is no EffectComposer here and there is not going to be one, so
     "god rays" cannot be a radial-blur post pass. What actually sells the
     sun in a game like this is not geometric shafts anyway — it is the
     enormous soft veiling glare that swamps the frame when the sun enters
     view. That is exactly one very large additive sprite whose opacity is
     driven by how closely the camera is looking at the sun, and now that
     core/renderer.js installs a filmic tone map it ROLLS OFF instead of
     clipping to a flat white disc, which is what makes it read as light
     rather than as a decal. One draw call, only while the sun is up and
     roughly in front of you, and the whole thing is a config flag away
     from never existing. */
  if (CBZ.CONFIG.GFX_SUN_GLARE == null) CBZ.CONFIG.GFX_SUN_GLARE = true;
  const glareSpr = skySprite(discTexture([
    [0, "rgba(255,246,225,0.55)"], [0.18, "rgba(255,228,175,0.30)"],
    [0.55, "rgba(255,190,130,0.10)"], [1, "rgba(255,160,90,0)"],
  ]), 600);
  glareSpr.renderOrder = -3.5;   // in front of the dome, behind the disc
  const _camFwd = new THREE.Vector3(), _sunDirV = new THREE.Vector3();

  /* ---------------- 5. legacy procedural clouds (disabled) ---------
     The daylight photograph already contains the coherent cloud field. The
     block-puff and radial-plane layers looked synthetic beside it, so do not
     render a second weather system over the authored sky. Keeping construction
     code dormant makes missing-photo fallback work easy to revisit without
     putting mixed cloud styles on screen now. */
  const PROCEDURAL_CLOUDS = false;
  /* ---------------- legacy box cloud pool ---------------------------
     The old clouds were ~36 separate meshes (one draw call per puff) and
     only covered the prison + survival island — the city had an empty
     ceiling. Now every puff in every region is one instanced draw call,
     and clusters drift/wrap over all three worlds. */
  const PUFFS = [[0, 0, 0, 9], [6, -1, 1, 6], [-6, -1, -1, 7], [2, 2, 0, 5]];
  const clusters = [];
  function cloud(x, y, z, s, wrapMin, wrapMax) {
    clusters.push({ x: x, y: y, z: z, s: s, min: wrapMin, max: wrapMax });
  }
  // prison / escape (origin) — same spots as always
  cloud(-60, 70, -40, 1.4, -150, 150);
  cloud(50, 80, 30, 1.8, -150, 150);
  cloud(10, 75, 90, 1.2, -150, 150);
  cloud(-30, 85, 70, 1.6, -150, 150);
  // survival island
  if (CBZ.SURV && CBZ.SURV.arena) {
    const a = CBZ.SURV.arena;
    cloud(a.cx - 55, 74, a.cz - 45, 1.6, a.cx - 150, a.cx + 150);
    cloud(a.cx + 50, 84, a.cz + 35, 2.0, a.cx - 150, a.cx + 150);
    cloud(a.cx + 15, 78, a.cz + 85, 1.3, a.cx - 150, a.cx + 150);
    cloud(a.cx - 35, 88, a.cz + 55, 1.7, a.cx - 150, a.cx + 150);
    cloud(a.cx + 65, 72, a.cz - 65, 1.5, a.cx - 150, a.cx + 150);
  }
  // THE CITY — wide drift wrap across the whole span (center ≈ z=-700)
  const cc = (CBZ.CITY && CBZ.CITY.center) || { x: 0, z: -700 };
  cloud(cc.x - 180, 76, cc.z + 120, 1.7, cc.x - 280, cc.x + 280);
  cloud(cc.x + 40, 84, cc.z + 60, 2.1, cc.x - 280, cc.x + 280);
  cloud(cc.x + 190, 72, cc.z, 1.5, cc.x - 280, cc.x + 280);
  cloud(cc.x - 90, 88, cc.z - 60, 1.9, cc.x - 280, cc.x + 280);
  cloud(cc.x + 120, 78, cc.z - 120, 1.6, cc.x - 280, cc.x + 280);
  cloud(cc.x - 200, 82, cc.z, 1.4, cc.x - 280, cc.x + 280);
  cloud(cc.x, 92, cc.z + 160, 1.8, cc.x - 280, cc.x + 280);

  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const cloudInst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.6, 1), cloudMat, clusters.length * PUFFS.length
  );
  cloudInst.name = "procedural-box-clouds";
  cloudInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cloudInst.frustumCulled = false; // clusters span all three worlds
  if (PROCEDURAL_CLOUDS) scene.add(cloudInst); // world-anchored — NOT on the camera rig

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(),
        _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  function writeClouds(dt) {
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      cl.x += dt * 0.8;
      if (cl.x > cl.max) cl.x = cl.min;
      for (let p = 0; p < PUFFS.length; p++) {
        const pf = PUFFS[p];
        _p.set(cl.x + pf[0] * cl.s, cl.y + pf[1] * cl.s, cl.z + pf[2] * cl.s);
        _s.setScalar(pf[3] * cl.s);
        _m.compose(_p, _q, _s);
        cloudInst.setMatrixAt(i * PUFFS.length + p, _m);
      }
    }
    cloudInst.instanceMatrix.needsUpdate = true;
  }
  if (PROCEDURAL_CLOUDS) writeClouds(0);

  /* ---------------- 5b. billboard cloud layer (Technique 1) ---------
     mrdoob's classic clouds example merged a pile of plane meshes into
     ONE static BufferGeometry with GeometryUtils.merge (deprecated/gone
     in r128) so puffs the camera could fly past were still just flat
     paper cutouts baked at world-fixed spots. We want the OPPOSITE of
     world-fixed here: a thin high layer that always reads as "clouds
     drifting overhead ahead of you" no matter which of the three worlds
     (or how far you've walked in the city) you're in — so instead of a
     merge we use ONE InstancedMesh (same draw-call win the merge was
     going for, just the r128-idiomatic instanced form) of small soft-
     edged billboard planes, RECYCLED AROUND THE CAMERA exactly like
     weather.js's rain pool: a fixed-size ring of puffs seeded on a disc
     around the player, each one silently re-seeded to a fresh spot once
     it drifts far enough away that recycling it is invisible. That's
     the only way a bounded instance count can cover unbounded player
     travel across escape/survival/city without ever thinning out or
     needing per-region authoring (the section above, which stays as-is
     for the low "always visible in the distance" skyline puffs).
     Texture: one shared runtime radial-gradient CanvasTexture (same
     canvas-blob-of-alpha approach city/blobshadows.js uses for ground
     contact shadows, just white-on-transparent instead of black) — no
     asset dependency, one canvas, one texture, one material, one mesh. */
  const BCLOUD_N = 26;              // pooled billboard count (small: this is a THIN high layer, not full overcast)
  const BCLOUD_RADIUS = 340;        // disc radius around the camera puffs are scattered/recycled within
  const BCLOUD_Y_MIN = 100, BCLOUD_Y_MAX = 150; // altitude band, above the box-puff clusters (72-92)
  const BCLOUD_DRIFT = 1.1;         // units/sec — same order of magnitude as the box clusters' 0.8

  function billboardCloudTex() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const cx = cv.getContext("2d");
    const grd = cx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, "rgba(255,255,255,0.85)");
    grd.addColorStop(0.5, "rgba(255,255,255,0.4)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    cx.fillStyle = grd; cx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }

  // seeded LCG (never Math.random — matches weather.js / every other
  // system's determinism rule) so the puff layout is stable session to
  // session instead of reshuffling on every reload.
  let _bcSeed = 91771;
  function bcRng() { _bcSeed = (_bcSeed * 1103515245 + 12345) & 0x7fffffff; return _bcSeed / 0x7fffffff; }

  const bcTex = billboardCloudTex();
  const bcMat = new THREE.MeshBasicMaterial({
    map: bcTex, color: 0xffffff, transparent: true, depthWrite: false,
    fog: true, side: THREE.DoubleSide,
  });
  const bcGeo = new THREE.PlaneGeometry(1, 1);
  const bcInst = new THREE.InstancedMesh(bcGeo, bcMat, BCLOUD_N);
  bcInst.name = "procedural-billboard-clouds";
  bcInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bcInst.frustumCulled = false; // camera-relative pool — never off-screen-culled away wrongly
  bcInst.renderOrder = -3;      // behind sun/moon/halo sprites, in front of the dome
  if (PROCEDURAL_CLOUDS) scene.add(bcInst); // world-space, NOT parented to the camera rig

  // per-puff scratch (positions/scale only — no per-instance rotation
  // state needed since ALL puffs share one camera-facing quaternion,
  // written once per frame below, exactly like a billboard particle pool)
  const bcPos = new Float32Array(BCLOUD_N * 3);
  const bcScale = new Float32Array(BCLOUD_N);
  function bcSeed(i, cx, cz, anywhere) {
    const a = bcRng() * Math.PI * 2;
    const r = (anywhere ? Math.sqrt(bcRng()) : (0.55 + bcRng() * 0.45)) * BCLOUD_RADIUS;
    const o = i * 3;
    bcPos[o] = cx + Math.cos(a) * r;
    bcPos[o + 1] = BCLOUD_Y_MIN + bcRng() * (BCLOUD_Y_MAX - BCLOUD_Y_MIN);
    bcPos[o + 2] = cz + Math.sin(a) * r;
    bcScale[i] = 55 + bcRng() * 70;
  }
  (function seedAll() {
    const cx = CBZ.camera.position.x, cz = CBZ.camera.position.z;
    for (let i = 0; i < BCLOUD_N; i++) bcSeed(i, cx, cz, true);
  })();

  const _bcM = new THREE.Matrix4(), _bcP = new THREE.Vector3(), _bcS = new THREE.Vector3();
  const _bcQ = new THREE.Quaternion();
  const BCLOUD_R2 = (BCLOUD_RADIUS + 40) * (BCLOUD_RADIUS + 40); // recycle band (a little past the seed radius, like rain's r2 hysteresis)
  function writeBillboardClouds(dt) {
    const cx = CBZ.camera.position.x, cz = CBZ.camera.position.z;
    _bcQ.copy(CBZ.camera.quaternion); // one shared billboard facing for every instance this frame
    // gentle uniform drift (wind reads as "the whole layer creeping one way"
    // rather than each puff wandering independently — cheap and looks right
    // at this altitude/scale) + camera-relative recycling, same shape as
    // weather.js's rain-drop recycle: past the ring → reseed "ahead of you".
    const driftX = BCLOUD_DRIFT, driftZ = BCLOUD_DRIFT * 0.35;
    for (let i = 0; i < BCLOUD_N; i++) {
      const o = i * 3;
      bcPos[o] += driftX * dt;
      bcPos[o + 2] += driftZ * dt;
      const dx = bcPos[o] - cx, dz = bcPos[o + 2] - cz;
      if (dx * dx + dz * dz > BCLOUD_R2) bcSeed(i, cx, cz, false);
      _bcP.set(bcPos[o], bcPos[o + 1], bcPos[o + 2]);
      _bcS.setScalar(bcScale[i]);
      _bcM.compose(_bcP, _bcQ, _bcS);
      bcInst.setMatrixAt(i, _bcM);
    }
    bcInst.instanceMatrix.needsUpdate = true;
  }
  if (PROCEDURAL_CLOUDS) writeBillboardClouds(0);

  /* ---------------- per-frame sync ----------------------------------
     Runs at order 99 — AFTER daynight (@2), weather's fog lerp (@90),
     survival's env override (@93) and city's light override (@94) — so
     it reads the FINAL fog colour of the frame, whatever mode wrote it.
     That's the whole seam fix: horizon stop == scene.fog.color, always. */
  let forcePaint = true, lastPaintAt = -1e9;
  const lastFog = new THREE.Color(-1, -1, -1), lastTint = new THREE.Color(-1, -1, -1);
  let lastKDay = -1, lastGlowK = -1, lastGlowU = -1, lastPhotoK = -1;
  let lastSpaceK = -1, lastHazeK = -1, lastStormK = -1, lastStormU = -1e9;
  const _white = new THREE.Color(1, 1, 1);
  /* WRITING THE TINT HAS TO BE IDEMPOTENT. Normally daynight (@2) resets the
     dome tint to white and survival (@93) re-asserts the disaster mood before
     this file touches it, so a fresh base arrives every frame and nothing can
     accumulate. But CBZ.skySync() runs skyFrame() by hand — frozen-loop tools
     call it between renders with no engine tick in between — and a second
     pass would then lerp and brighten a tint this file had ALREADY lerped and
     brightened. Remembering both sides of our own write closes it exactly: if
     the tint still is what we left, nobody else has had a turn, so restore
     the base we started from and redo the write. Cheap, and it means
     skyFrame() can be called any number of times for one world state. */
  const _tintBase = new THREE.Color(1, 1, 1), _tintWrote = new THREE.Color(-1, -1, -1);
  const _fogFallback = new THREE.Color(0xb6c4c8);
  function moved(a, b) {
    return Math.abs(a.r - b.r) > 0.006 || Math.abs(a.g - b.g) > 0.006 || Math.abs(a.b - b.b) > 0.006;
  }

  // The rig carries everything that is "at infinity" — the dome, the sun,
  // the moon, the halo and the veiling glare. Centring it on the CAMERA (not
  // on sea level) is what keeps the sky around you and the sun on the real
  // horizon at any altitude. See section 0a.
  let altY = 0;
  // a number somebody else owns, made safe to paint with
  function fin(v, d) { return (v == null || !Number.isFinite(v)) ? d : v; }
  function syncRig() {
    const cam = CBZ.camera.position;
    const hi = !!CBZ.CONFIG.SKY_ALTITUDE;
    /* A NON-FINITE CAMERA MUST NOT TAKE THE SKY WITH IT. `Math.max(0, NaN)`
       is NaN, and altY feeds frame.hazeK, which feeds `fadeTop`, which is a
       createLinearGradient stop — so ONE degenerate camera frame throws, and
       because the camera stays degenerate it throws EVERY FRAME for the rest
       of the match and the sky simply stops painting. Anything upstream can
       do this: a blast impulse that divided by a zero distance, an unclamped
       shake, a physics step that overflowed. The sky is the last consumer in
       that chain and it is the wrong place to find out about it, so it
       defends itself and leaves the camera bug to the camera. */
    const cx = Number.isFinite(cam.x) ? cam.x : 0;
    const cy = Number.isFinite(cam.y) ? cam.y : 0;
    const cz = Number.isFinite(cam.z) ? cam.z : 0;
    rig.position.set(cx, hi ? cy : 0, cz);
    altY = hi ? Math.max(0, cy) : 0;   // metres above mean sea level
  }

  function skyFrame(dt) {
    syncRig();

    const fog = scene.fog ? scene.fog.color : _fogFallback;
    const tint = dome.material.color;

    if (tint.equals(_tintWrote)) tint.copy(_tintBase);
    _tintBase.copy(tint);

    /* Same defence, one layer out: every one of these is written by somebody
       else (the day cycle, a disaster's weather drive), a `== null` test says
       nothing about NaN, and each of them reaches a gradient stop. Read them
       through `fin()` so a bad writer costs one wrong-looking frame instead
       of the sky for the rest of the run. */
    const night = fin(CBZ.nightAmount, 0);
    const dayness = fin(CBZ.dayness, 1);
    const duskness = fin(CBZ.duskness, 0);
    const a = fin(CBZ.sunAngle, 1.1);
    const up = fin(CBZ.sunHeight, Math.sin(a)); // signed sun height

    // ---- frame palette: blend the keyframe tables -------------------
    const kDay = clamp01(up * 2.2 + 0.05);   // full daytime sky by mid-morning
    const civil = clamp01(0.45 - up * 3.2);  // 0 = golden hour, 1 = sun dipped
    _top.copy(PAL.night.top).lerp(PAL.day.top, kDay).lerp(PAL.dusk.top, duskness * 0.6);
    _zen.copy(PAL.night.zen).lerp(PAL.day.zen, kDay).lerp(PAL.dusk.zen, duskness * 0.6);
    _mid.copy(PAL.night.mid).lerp(PAL.day.mid, kDay).lerp(PAL.dusk.mid, duskness * 0.85);
    // the deck: authored, dimmed into the night with the rest of the sky, then
    // nudged toward the live fog so the disaster's own mood carries into it
    const stLum = 0.12 + 0.88 * kDay;
    _stTop.copy(PAL.storm.top).multiplyScalar(stLum).lerp(fog, 0.18);
    _stMid.copy(PAL.storm.mid).multiplyScalar(stLum).lerp(fog, 0.18);
    _stLow.copy(PAL.storm.low).multiplyScalar(stLum).lerp(fog, 0.22);
    _hot.copy(PAL.glow.golden).lerp(PAL.glow.civil, civil);
    _gmid.copy(PAL.glow.goldenMid).lerp(PAL.glow.civilMid, civil);
    frame.duskW = duskness;
    frame.glowK = duskness;
    frame.photoK = clamp01((up - 0.3) * 4); // photo fades out entering golden hour

    /* ---- THE STORM (see section 1b) --------------------------------
       systems/weather.js owns "how much cloud is overhead" because it is the
       file that knows the difference between drizzle, a driven disaster and
       a dry scripted strobe. This file owns what that LOOKS like. */
    const W = CBZ.weather;
    frame.stormK = clamp01(W && typeof W.overcast === "number" ? W.overcast : 0);
    if (frame.stormK > 0.002) {
      // drift: the deck moves downwind, and the wind is the ONE wind vector
      // systems/weather.js publishes — never a private bearing. Azimuthal
      // component only (a deck crossing overhead sweeps the sky sideways);
      // the approach term is slower, because a ceiling coming at you moves
      // far less in apparent angle than it does in kilometres.
      const spd = W && typeof W.wind === "number" ? W.wind : 0;
      const dtc = Math.min(0.1, dt > 0 ? dt : 0);
      frame.stormU -= dtc * (5 + spd * 1.6) * (W && W.windX != null ? (W.windX * 0.8 + 0.5) : 1);
      frame.stormV += dtc * (1.4 + spd * 0.35);
      // WRAP ON THE SHARED PERIOD, not on "some big number". The tile is drawn
      // twice around the canvas (period SKY_W/2 = 512 px) and the second layer
      // drifts at exactly HALF the first — so 1024 px is a whole number of
      // tiles for BOTH layers and the wrap is invisible. An arbitrary wrap, or
      // none at all, either jumps the sky or lets the offset grow until float
      // precision starts quantising the drift into visible steps.
      if (frame.stormU <= -1024) frame.stormU += 1024;
      if (frame.stormV >= 512) frame.stormV -= 512;
      // the thin gaps only glow if there is daylight above the deck to glow
      frame.stormLit = 0.10 + 0.90 * kDay;
      // A DECK OCCLUDES WHAT IS BEHIND IT. The clear-sky photograph, the
      // sunset burn, the sun disc, its halo and the veiling glare are all
      // things you cannot see through cloud, and leaving any of them running
      // under an overcast sky is the tell that the grey is a filter rather
      // than a ceiling.
      frame.photoK *= 1 - frame.stormK;
      frame.glowK *= 1 - frame.stormK * 0.88;
      /* AND THE DOME TINT HAS TO LET GO. modes/survival.js multiplies the
         whole dome by the disaster's fog colour (0x3a4150 for the storm) so
         the sky reads the mood — which was the only storm-sky mechanism
         there was, and which caps every texel at that slate. Now that the
         mood is PAINTED, that multiply can only crush it, so ease the tint
         back to white as the deck takes over. Legal, and deliberately here:
         this file runs at order 99, after daynight (@2, which rewrites the
         tint to white every frame) and after survival (@93) — it is the last
         writer of sky colour by design, and nothing accumulates because both
         of those re-assert the tint from scratch on the next frame. */
      tint.lerp(_white, clamp01(frame.stormK * 1.2));
    } else {
      frame.stormLit = 1;
    }
    /* THE STROKE LIGHTS THE CLOUD IT CAME OUT OF. The reference photograph is
       not a bright bolt on a dark sky — the whole sky is blazing, because a
       return stroke is a hundred million volts INSIDE the deck. Pushing the
       tint overbright (>1 is legal on a MeshBasicMaterial and clamps at the
       output) flares the entire painted sky on the frame the bolt fires, for
       free: no repaint, no second material, no extra draw. It rides the exact
       decay curve systems/weather.js is already using for the hemi/sun bump,
       so the sky, the lit faces and the shadowed faces all pulse together. */
    const fl = W && typeof W.flash === "number" ? W.flash : 0;
    if (fl > 0.004) {
      const fk = Math.min(1.6, fl * 0.75) * (0.35 + 0.65 * frame.stormK);
      // ceiling on the add: daynight.js (@2) rewrites this tint to white every
      // frame so nothing can accumulate here, but a bounded write costs one
      // Math.min and cannot blow the sky out if a future context ever skips it.
      tint.r = Math.min(2.4, tint.r + fk * 0.92);
      tint.g = Math.min(2.4, tint.g + fk * 0.97);
      tint.b = Math.min(2.4, tint.b + fk * 1.18);
    }
    // ---- altitude terms (section 0a) --------------------------------
    // spaceK: the share of the atmosphere already below you, scaled by how
    // lit the sky is at all — a night sky is black without any help, and
    // darkening the dusk burn would just mute the one thing worth seeing.
    // The 0.30 ceiling is a real limit, not taste: this ONE canvas carries
    // both the sky and the photo layer's cloud TOPS, and a cloud top at 5 km
    // is lit as brightly as one at sea level. The uncapped column term (0.45
    // at 5 km) would paint them grey, so the deepening stops where the sky
    // stops being the only thing it is darkening.
    frame.spaceK = Math.min(0.30, 1 - Math.exp(-altY / AIR_SCALE_H)) * kDay * (1 - duskness * 0.6);
    frame.hazeK = Math.exp(-altY / HAZE_SCALE_H);
    // sun azimuth → canvas u (r128 SphereGeometry: x=-cos(2πu)·s, z=sin(2πu)·s)
    let gu = Math.atan2(-10, -Math.cos(a) * 80) / (Math.PI * 2);
    frame.glowU = gu - Math.floor(gu);

    _tintWrote.copy(tint);

    // dome repaint — throttled (canvas refill + ~2MB upload is cheap at
    // <10Hz, wasteful at 60); fog/palette drift over seconds, not frames
    const du = Math.abs(frame.glowU - lastGlowU);
    const palMoved = Math.abs(kDay - lastKDay) > 0.02 ||
      Math.abs(frame.glowK - lastGlowK) > 0.02 ||
      (frame.glowK > 0.02 && Math.min(du, 1 - du) > 0.01) ||
      Math.abs(frame.photoK - lastPhotoK) > 0.03 ||
      Math.abs(frame.spaceK - lastSpaceK) > 0.015 ||
      Math.abs(frame.hazeK - lastHazeK) > 0.02 ||
      Math.abs(frame.stormK - lastStormK) > 0.012 ||
      // the deck DRIFTS, so it needs its own repaint reason: without this the
      // cloud would only move when something else happened to change. 1.2 px
      // of a 1024 px / 360° canvas is 0.4°, i.e. a repaint about every half
      // second at storm wind speeds — motion, well under the 10 Hz ceiling.
      (frame.stormK > 0.02 && Math.abs(frame.stormU - lastStormU) > 1.2);
    if (forcePaint || (CBZ.now - lastPaintAt > 100 && (moved(fog, lastFog) || moved(tint, lastTint) || palMoved))) {
      paintSky(fog, tint);
      lastFog.copy(fog); lastTint.copy(tint);
      lastKDay = kDay; lastGlowK = frame.glowK; lastGlowU = frame.glowU; lastPhotoK = frame.photoK;
      lastSpaceK = frame.spaceK; lastHazeK = frame.hazeK;
      lastStormK = frame.stormK; lastStormU = frame.stormU;
      lastPaintAt = CBZ.now; forcePaint = false;
    }

    // No floating point-stars: keep the object inert so no per-frame scene
    // rebuild is needed and older save/config state cannot turn it back on.
    stars.visible = false;

    // sun + moon ride daynight's angle
    _p.set(Math.cos(a) * 80, Math.sin(a) * 95, -10).normalize();
    const sunY = _p.y;
    sunSpr.position.copy(_p).multiplyScalar(795);
    // NOTHING IN THE SKY SURVIVES THE DECK. A visible sun disc under full
    // overcast is the single most obvious "the grey is a filter" tell.
    const clear = 1 - frame.stormK;
    let sop = Math.min(1, dayness * 1.6 + duskness * 0.5) * (clear * clear);
    if (sunY < -0.02) sop = 0;
    sunSpr.visible = sop > 0.01;
    if (sunSpr.visible) {
      sunSpr.material.opacity = sop;
      if (CBZ.sunTint) sunSpr.material.color.copy(CBZ.sunTint);
      const coreS = 95 * (1 + duskness * 0.5); // the low sun looks bigger
      sunSpr.scale.set(coreS, coreS, 1);
    }
    // dusk halo: blooms with duskness, lingers a moment after the disc dips
    const hop = duskness * clamp01((sunY + 0.15) * 7) * clear;
    haloSpr.visible = hop > 0.015;
    if (haloSpr.visible) {
      haloSpr.position.copy(sunSpr.position);
      haloSpr.material.opacity = Math.min(1, hop);
      haloSpr.material.color.copy(_hot);
      const hs = 170 + 170 * duskness;
      haloSpr.scale.set(hs * 1.35, hs, 1); // wider than tall — it hugs the horizon
    }
    // veiling glare — opacity ramps hard with how directly you are looking at
    // the sun (pow 5 keeps it out of the frame until you actually turn into
    // it), scaled by how high and how warm the sun is. Tier 0 never gets it.
    {
      const tierOK = (CBZ.qualityLevel == null ? 2 : CBZ.qualityLevel) >= 1;
      let gop = 0;
      if (CBZ.CONFIG.GFX_SUN_GLARE && tierOK && sunY > -0.02) {
        _sunDirV.set(Math.cos(a) * 80, Math.sin(a) * 95, -10).normalize();
        CBZ.camera.getWorldDirection(_camFwd);
        const align = clamp01(_camFwd.dot(_sunDirV));
        gop = Math.pow(align, 5) * clamp01(sunY * 3 + 0.15) * (0.42 + duskness * 0.5);
        // Veiling glare is light scattered toward you by the air BETWEEN you
        // and the sun, so it thins with the same aerosol column as the haze
        // band (halved by 1,750 m). The 0.30 floor is not atmosphere — it is
        // the glare a lens or an eye makes on its own, which altitude cannot
        // take away. Without this the sunrise shot from the cockpit was one
        // flat cream wash with no horizon left in it.
        gop *= (0.30 + 0.70 * frame.hazeK) * clear * clear;
      }
      glareSpr.visible = gop > 0.008;
      if (glareSpr.visible) {
        glareSpr.position.copy(sunSpr.position);
        glareSpr.material.opacity = Math.min(0.95, gop);
        glareSpr.material.color.copy(CBZ.sunTint || _hot);
        const gs = 460 + 420 * duskness;
        glareSpr.scale.set(gs, gs, 1);
      }
    }
    _p.set(Math.cos(a + Math.PI) * 80, Math.sin(a + Math.PI) * 95, -10).normalize();
    moonSpr.position.copy(_p).multiplyScalar(795);
    let mop = Math.min(1, Math.max(0, (night - 0.12) * 1.25));
    if (_p.y < -0.02) mop = 0;
    moonSpr.visible = mop > 0.01;
    if (moonSpr.visible) moonSpr.material.opacity = mop;

    if (PROCEDURAL_CLOUDS) {
      writeClouds(dt);
      cloudMat.color.setScalar(0.35 + 0.65 * dayness).lerp(fog, 0.12 + night * 0.2 + duskness * 0.25);
      writeBillboardClouds(dt);
      const rainI = (CBZ.weather && typeof CBZ.weather.intensity === "number") ? CBZ.weather.intensity : 0;
      bcMat.color.setScalar(0.35 + 0.65 * dayness).lerp(fog, 0.12 + night * 0.2 + duskness * 0.25);
      bcMat.color.multiplyScalar(1 - rainI * 0.35);
      bcMat.opacity = 0.9 - rainI * 0.15;
    }
  }

  CBZ.onAlways(99, skyFrame);

  /* ---------------- the seam: CBZ.skySync() --------------------------
     Frozen-loop tools (tools/visual-compare.mjs presets stub out
     requestAnimationFrame and call renderer.render by hand) move the
     camera between renders with nothing left to follow it. Four presets
     had each hand-rolled `CBZ.skyDome.parent.position.set(cam.x, 0,
     cam.z)` — a private detail of this file, copied five times, and now
     WRONG at altitude. One call re-runs the whole frame sync (rig,
     palette, forced repaint, sun/moon/glare placement) against the
     camera as it stands right now. Degrade-safe by shape: a caller that
     does not have it falls back to its old inline line. */
  CBZ.skySync = function () {
    forcePaint = true;
    try { skyFrame(0); } catch (_) {}
    return altY;
  };

  // Numbers for the gate: everything a screenshot could only guess at.
  function elevDeg(x, y, z) {
    const L = Math.hypot(x, y, z);
    return L > 1e-6 ? Math.asin(Math.max(-1, Math.min(1, y / L))) * 180 / Math.PI : 0;
  }
  CBZ.skyAudit = function () {
    return {
      flag: !!CBZ.CONFIG.SKY_ALTITUDE,
      altY: +altY.toFixed(1),
      rigY: +rig.position.y.toFixed(1),
      camY: +CBZ.camera.position.y.toFixed(1),
      // must stay 0 — the eye is inside the dome at every altitude
      camOutsideDome: rig.position.distanceTo(CBZ.camera.position) >= 850 ? 1 : 0,
      spaceK: +frame.spaceK.toFixed(3),
      hazeK: +frame.hazeK.toFixed(3),
      // the storm deck, for the gate: coverage, whether the tile actually
      // built, and how far the sun/photo/burn have been shut down by it.
      stormK: +frame.stormK.toFixed(3),
      deck: deckDark ? 1 : 0,
      deckPerspective: (DECK_XFORM && deckPatD && deckPatD.setTransform) ? 1 : 0,
      photoK: +frame.photoK.toFixed(3),
      sunOpacity: +(sunSpr.visible ? sunSpr.material.opacity : 0).toFixed(3),
      tintR: +dome.material.color.r.toFixed(3),
      // apparent elevation of the sun disc AS DRAWN, measured from the
      // camera, vs. the elevation of the light that is actually shading the
      // world. These two must AGREE at every altitude — they differed by
      // tens of degrees from an aircraft, and that difference is the whole
      // "sun rising out of the ground" bug.
      sunElevDeg: +(elevDeg(
        sunSpr.position.x + rig.position.x - CBZ.camera.position.x,
        sunSpr.position.y + rig.position.y - CBZ.camera.position.y,
        sunSpr.position.z + rig.position.z - CBZ.camera.position.z)).toFixed(2),
      lightElevDeg: +(elevDeg(Math.cos(CBZ.sunAngle == null ? 0 : CBZ.sunAngle) * 80,
        Math.sin(CBZ.sunAngle == null ? 0 : CBZ.sunAngle) * 95, -10)).toFixed(2),
    };
  };
})();
