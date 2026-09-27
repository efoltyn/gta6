/* ============================================================
   world/carfx.js — vehicle-only PBR materials + a cheap fake-reflection
   environment map. Adds ~ZERO draw calls (it is materials + ONE prefiltered
   env texture); the city stays on Lambert (cmat) and is untouched.

   WHY a separate factory: the city is draw-call bound and Lambert ignores
   envMap, so giving CARS MeshStandardMaterial + a stylized PMREM env makes
   bodywork/glass/chrome read as reflective metal WITHOUT touching the
   thousands of static Lambert city meshes (setting scene.environment only
   affects Standard/Physical mats — i.e. only what this file makes).

   EXPORTS:
     CBZ.ENV          — a THREE.Texture (prefiltered PMREM cubemap-ish) used as
                        envMap on every reflective vehicle material. May be null
                        briefly before the renderer exists; back-filled lazily.
     CBZ.vehicleMat(role, color, opts) — see the role table below.
     CBZ.buildVehicleEnv()  — (idempotent) force the env to build if a renderer
                        is present; normally called for you.

   Renderer-readiness: the PMREM env REQUIRES a live WebGLRenderer. carfx.js is
   wired AFTER core/renderer.js so CBZ.renderer usually exists at load and the
   env builds eagerly. If it does NOT (headless / different load order), we
   DEFER: every created material is recorded in a registry, the env is retried
   on the first CBZ.vehicleMat() call that sees a renderer AND on a per-frame
   CBZ.onAlways hook, and once built we back-fill .envMap onto everything
   already made. Nothing here ever throws when the renderer/THREE is absent.

   Gate: set window.CBZ.VEHICLE_FX = false BEFORE this loads to disable — then
   CBZ.vehicleMat() falls back to plain Lambert (CBZ.cmat / CBZ.mat) so callers
   keep working and the recolor flag is still honoured.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});

  // Default ON; honour an explicit opt-out set before this file loads.
  if (CBZ.VEHICLE_FX === false) {
    // Disabled path: still provide the contract so B/C agents don't break.
    // Fall back to the existing Lambert factory + honour the _bodyPaint flag.
    if (!CBZ.vehicleMat) {
      CBZ.vehicleMat = function (role, color, opts) {
        opts = opts || {};
        const cmat = CBZ.cmat || CBZ.mat;
        let m;
        if (role === "paint") {
          // fresh, recolourable
          m = (CBZ.mat || cmat)(color != null ? color : 0xb0b4ba, {
            emissive: 0x000000,
          });
          m._bodyPaint = true;
          return m;
        }
        if (role === "lightFront") return cmat(0x222018, { emissive: 0xfff2cc, ei: 1.15 });
        if (role === "lightTail") return cmat(0x220404, { emissive: 0xff2020, ei: 1.1 });
        const fallbackColor = {
          glass: 0x10161c, chrome: 0xc8ccd2, metal: 0xc8ccd2, rim: 0xb9bdc4, autoGlass: 0x10161c, wheel: 0x2a2c30,
          tire: 0x14161a, plastic: 0x1b1d20, interior: 0x0d0e10,
        }[role];
        return cmat(fallbackColor != null ? fallbackColor : (color != null ? color : 0xb0b4ba), {});
      };
    }
    CBZ.buildVehicleEnv = CBZ.buildVehicleEnv || function () {};
    // The audit is part of the contract too — a gate that calls it must not
    // throw just because vehicle FX are off. Nothing here is glass in the
    // material sense (the kill switch hands back opaque Lambert), so say so.
    CBZ.glassAudit = CBZ.glassAudit || function () {
      return { vehicleGlassMode: "fx-off", flagOn: false, oneGlassConsumers: 0, oneGlassCalls: 0,
        buildingGlassInPool: false, vehicleGlassVariants: 0, vehicleGlassTints: [], tintRefused: 0,
        tintInFrostWindow: true, frostMargin: null, worstTint: null,
        transparent: false, opacity: 1, doubleSided: false };
    };
    if (CBZ.ENV === undefined) CBZ.ENV = null;
    // taperBox is pure geometry, NOT a material/env concern — the six aircraft
    // builders call it unconditionally, so it must survive this kill switch too
    // (function declarations hoist, so the definition below is already bound).
    CBZ.taperBox = taperBox;
    return;
  }

  const THREE = window.THREE;

  // REAL GLASS feature flag — one-line revert to the old opaque vehicle glass.
  if (CBZ.CONFIG && CBZ.CONFIG.VEHICLE_REAL_GLASS == null) CBZ.CONFIG.VEHICLE_REAL_GLASS = true;
  // VEHICLE_GLASS_V2 — route the 'glass' role through CBZ.glass (materials.js),
  // i.e. the SAME material the city's curtain walls are made of. False falls all
  // the way back to the MeshStandardMaterial recipe below, byte for byte.
  if (CBZ.CONFIG && CBZ.CONFIG.VEHICLE_GLASS_V2 == null) CBZ.CONFIG.VEHICLE_GLASS_V2 = true;

  /* ---- THE ENV DIMS WITH THE SUN (cbzEnvK) --------------------------------
     CBZ.ENV is a baked DAYLIGHT sky. Without this, midnight paint reflects a
     noon sky: bodywork goes chalky, chrome glows, glass lights up like a
     lamp. One shared uniform scales every env lookup (the specular
     reflection, the clearcoat reflection AND the env's diffuse fill — both
     return lines of r128's envmap_physical_pars_fragment) by daylight, and
     one per-frame write moves the whole fleet.

     SAME PROGRAM FOR EVERY CAR. r128 keys a program on
     onBeforeCompile.toString(), so every material wearing this ONE function
     shares the program its type/defines would have had anyway. Material.clone()
     does NOT carry onBeforeCompile (r128 Material.copy skips it) — and every
     traffic car's paint is a clone (playercars recolorBody), as is every
     crash-frosted pane — so a hooked material gets an own `clone` that
     re-hooks the copy. Without that the fleet would silently compile a
     second, un-dimmed program. */
  const ENV_K = { value: 1 };
  const ENV_K_NIGHT = 0.1;
  function envHook(shader) {
    shader.uniforms.cbzEnvK = ENV_K;
    shader.fragmentShader = "uniform float cbzEnvK;\n" + shader.fragmentShader.replace(
      "#include <envmap_physical_pars_fragment>",
      THREE.ShaderChunk.envmap_physical_pars_fragment.replace(/\* envMapIntensity;/g, "* envMapIntensity * cbzEnvK;"));
  }
  /* ---- METALLIC PAINT: flop + flake (paint materials only) ----------------
     A metallic paint is not "a shinier solid". Its aluminium flakes lie
     roughly parallel to the panel, so a panel FACING you is bright and one
     turning away goes dark: the FLOP that makes a silver car read as metal
     from across the street. Up close the flakes glint individually. Both are
     a few lines after lighting, keyed by a per-material uniform (cbzFlake,
     0 = solid paint: the multiply is 1 and the glint branch never runs), so
     solid and metallic paint share ONE program. The glint cell is 3 mm in
     the car's own frame and fades out by 3.5 m, before a cell drops under a
     pixel and turns into shimmer. No uv needed (the loft has none). */
  function paintHook(shader) {
    envHook(shader);
    shader.uniforms.cbzFlake = this._flakeU || (this._flakeU = { value: 0 });
    shader.vertexShader = "varying vec3 vCbzObj;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>", "#include <begin_vertex>\n\tvCbzObj = position;");
    shader.fragmentShader = "uniform float cbzFlake;\nvarying vec3 vCbzObj;\n" +
      "float cbzHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n" +
      shader.fragmentShader.replace(
        "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
        [
          "if ( cbzFlake > 0.0 ) {",
          "  vec3 cbzV = normalize( vViewPosition );",
          "  float cbzNV = saturate( dot( normal, cbzV ) );",
          "  outgoingLight *= mix( 1.0, mix( 0.5, 1.2, pow( cbzNV, 0.65 ) ), cbzFlake );",
          "  float cbzD = length( vViewPosition );",
          "  if ( cbzD < 3.5 ) {",
          "    vec3 cbzC = floor( vCbzObj * 330.0 );",
          "    vec3 cbzR = vec3( cbzHash( cbzC + 1.7 ), cbzHash( cbzC + 3.1 ), cbzHash( cbzC + 5.3 ) ) - 0.5;",
          "    float cbzG = pow( saturate( dot( normalize( normal + cbzR * 0.9 ), cbzV ) ), 48.0 ) * step( 0.5, cbzHash( cbzC ) );",
          "    outgoingLight += cbzG * cbzFlake * ( 1.0 - smoothstep( 1.4, 3.5, cbzD ) ) * 0.9 *",
          "      ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular );",
          "  }",
          "}",
          "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
        ].join("\n"));
  }
  function hookedClone() {
    const c = new this.constructor().copy(this);
    if (this._cbzPaint) {
      c._cbzPaint = true;
      c._flakeU = { value: this._flakeU ? this._flakeU.value : 0 };
      c._paintResponse = this._paintResponse;
    }
    return hookEnv(c);
  }
  function hookEnv(mat) {
    if (!mat || !("envMap" in mat)) return mat;
    mat.onBeforeCompile = mat._cbzPaint ? paintHook : envHook;
    mat.clone = hookedClone;
    return mat;
  }
  /* WHICH PAINTS ARE METALLIC. Deterministic off the hex (multiplayer builds
     identical cars): the neutrals a real lot is full of (silver, grey,
     graphite, black, deep blue and green) are metallic, and a hash picks
     roughly a third of the saturated colours. Solid paint keeps the authored
     per-style response; metallic trades a little of the diffuse lobe for a
     colour-tinted reflection, still under the washed-out ceiling below
     (metalness x envMapIntensity <= 0.32). */
  function isMetallicHex(hex) {
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    if (sat < 0.18) return true;                                    // silver / grey / black / white-pearl
    if (mx < 0.42 && b >= r) return true;                           // deep blue / green / navy
    return ((Math.imul(hex >>> 0, 2654435761) >>> 29) & 7) < 3;
  }
  function carPaintFinish(m, hex) {
    if (!m || !m._cbzPaint) return m;
    const P = m._paintResponse;
    const metal = isMetallicHex(hex >>> 0);
    if (!m._flakeU) m._flakeU = { value: 0 };
    if (metal) {
      m.metalness = 0.42;
      m.roughness = 0.4;
      m.envMapIntensity = 0.74;
      m.clearcoatRoughness = 0.03;
      m._flakeU.value = 1;
    } else if (P) {
      m.metalness = P.metalness; m.roughness = P.roughness;
      m.envMapIntensity = P.envMapIntensity; m.clearcoatRoughness = P.clearcoatRoughness;
      m._flakeU.value = 0;
    }
    m._metallic = metal;
    return m;
  }
  CBZ.carPaintFinish = carPaintFinish;
  CBZ.carPaintIsMetallic = isMetallicHex;
  function envDaylight() {
    const d = typeof CBZ.dayness === "number" ? CBZ.dayness : 1;
    const k = d <= 0 ? 0 : d >= 1 ? 1 : d;
    return ENV_K_NIGHT + (1 - ENV_K_NIGHT) * k;
  }
  let envTickOn = false;
  function ensureEnvTick() {
    if (envTickOn || typeof CBZ.onAlways !== "function") return;
    envTickOn = true;
    CBZ.onAlways(1.2, function () { ENV_K.value = envDaylight(); });
  }
  CBZ.vehicleEnvLevel = function () { return ENV_K.value; };

  // Registry of EVERY material this factory has produced, so we can back-fill
  // .envMap once CBZ.ENV exists (and bump .needsUpdate to recompile shaders).
  const envClients = [];
  function registerForEnv(mat) {
    if (mat) envClients.push(hookEnv(mat));
    return mat;
  }
  function applyEnv(mat) {
    if (mat && CBZ.ENV && "envMap" in mat) {
      mat.envMap = CBZ.ENV;
      if (mat.envMapIntensity == null) mat.envMapIntensity = 1.0;
      mat.needsUpdate = true;
    }
  }
  function backfillEnv() {
    if (!CBZ.ENV) return;
    for (let i = 0; i < envClients.length; i++) applyEnv(envClients[i]);
  }

  /* ---- THE STUDIO-STREET SKY the env map is baked from ---------------------
     Was an 8x256 two-stop gradient: a reflection with nothing IN it, so paint
     could only ever be "lighter on top", never glossy. Real car paint reads as
     paint because it carries a picture of the world that slides over the
     panels as the car moves: a bright sky, a hard horizon, a dark street, and
     a few bright sources to make highlights. So the equirect has exactly that:
       - sky: deep blue zenith to a pale haze at the horizon
       - the sun plus two soft bright cloud banks at other bearings, the
         moving highlights on hoods and roofs
       - a SKYLINE band on the horizon (blocks of different heights and
         tones), which is what draws the dark reflected line along every
         door and makes chrome look like chrome rather than grey
       - a dark asphalt ground with a lighter kerb band at the horizon
     Authored as sRGB and TAGGED sRGB (the old canvas was read as linear,
     which lifted every stop and is half of why paint washed to white). */
  /* 2026-09-27 (cars round 2): 512x256, and the HORIZON IS A HARD EDGE.
     The line a stranger reads as "that's a car" is the reflected horizon
     running down the flank: bright sky above, dark street below, meeting
     in a crisp line that bends with every panel. At 256x128 the PMREM mip
     the clearcoat samples smeared that edge into a grey gradient (matte
     clay). Now: sky at full brightness right down to the skyline, a thin
     bright kerb glint, then the street drops straight to dark asphalt, and
     two long overhead light banks give the hood and roof a sharp moving
     highlight instead of a blob. Same picture drives the studio plates
     (CBZ.vehicleEnvCanvas), so the capture shows what the game shows. */
  function envCanvas() {
    const W = 512, H = 256;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const hz = H * 0.5;
    let grad = g.createLinearGradient(0, 0, 0, hz);
    grad.addColorStop(0.0, "#36629f");
    grad.addColorStop(0.45, "#7ea6d6");
    grad.addColorStop(0.85, "#d4e2ef");
    grad.addColorStop(1.0, "#f2f6fa");
    g.fillStyle = grad; g.fillRect(0, 0, W, hz);
    function blob(x, y, rx, ry, a) {
      for (let dx = -W; dx <= W; dx += W) {          // wrap across the seam
        const rg = g.createRadialGradient(x + dx, y, 0, x + dx, y, rx);
        rg.addColorStop(0, "rgba(255,255,255," + a + ")");
        rg.addColorStop(1, "rgba(255,255,255,0)");
        g.save(); g.translate(x + dx, y); g.scale(1, ry / rx); g.translate(-(x + dx), -y);
        g.fillStyle = rg; g.fillRect(x + dx - rx, y - rx, rx * 2, rx * 2);
        g.restore();
      }
    }
    blob(W * 0.62, H * 0.24, 80, 22, 0.8);
    blob(W * 0.90, H * 0.34, 60, 14, 0.65);
    blob(W * 0.36, H * 0.30, 50, 10, 0.5);
    // two long bright bands high in the sky: the crisp streak on a hood/roof
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.fillRect(0, H * 0.08, W, 5);
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.fillRect(0, H * 0.17, W, 3);
    blob(W * 0.20, H * 0.18, 18, 18, 1.0);          // sun
    blob(W * 0.20, H * 0.18, 6, 6, 1.0);
    // skyline on the horizon — deterministic blocks, dark against the bright haze
    let s = 7;
    function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    for (let x = 0; x < W;) {
      const bw = 8 + Math.floor(rnd() * 24), bh = 4 + Math.floor(rnd() * 22);
      const tone = 60 + Math.floor(rnd() * 50);
      g.fillStyle = "rgb(" + tone + "," + (tone + 6) + "," + (tone + 16) + ")";
      g.fillRect(x, hz - bh, bw, bh);
      x += bw + (rnd() < 0.3 ? 4 + Math.floor(rnd() * 16) : 0);
    }
    // the street: a 2 px kerb glint, then straight down to dark asphalt
    g.fillStyle = "#9a9894"; g.fillRect(0, hz, W, 2);
    grad = g.createLinearGradient(0, hz + 2, 0, H);
    grad.addColorStop(0.0, "#3c3c3f");
    grad.addColorStop(0.25, "#2a2a2d");
    grad.addColorStop(1.0, "#131315");
    g.fillStyle = grad; g.fillRect(0, hz + 2, W, H - hz - 2);
    return c;
  }
  CBZ.vehicleEnvCanvas = envCanvas;

  // PMREM-prefilter the equirect ONCE into a roughness-aware env texture,
  // shared by every vehicle material.
  let envBuilding = false;
  function buildVehicleEnv() {
    if (CBZ.ENV) return CBZ.ENV; // idempotent
    if (envBuilding) return null;
    if (!THREE || !CBZ.renderer || typeof document === "undefined") return null; // defer — no live renderer yet
    if (!THREE.PMREMGenerator || !THREE.CanvasTexture) return null;
    envBuilding = true;
    try {
      const tex = new THREE.CanvasTexture(envCanvas());
      tex.mapping = THREE.EquirectangularReflectionMapping;
      if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
      tex.needsUpdate = true;
      const pmrem = new THREE.PMREMGenerator(CBZ.renderer);
      if (pmrem.compileEquirectangularShader) pmrem.compileEquirectangularShader();
      const rt = pmrem.fromEquirectangular(tex); // r128: returns a WebGLRenderTarget
      CBZ.ENV = rt.texture;
      tex.dispose();
      pmrem.dispose();

      // Bake into scene.environment too (only Standard/Physical mats react,
      // i.e. the vehicle mats — Lambert city is unaffected, by design).
      if (CBZ.scene && CBZ.scene.environment == null) CBZ.scene.environment = CBZ.ENV;

      backfillEnv();
    } catch (e) {
      // Never throw out of a foundation module. Leave ENV null; retried later.
      CBZ.ENV = CBZ.ENV || null;
    } finally {
      envBuilding = false;
    }
    return CBZ.ENV;
  }

  // ---- shared material cache (one instance per role; NEVER for 'paint') ----
  const sharedCache = new Map();
  function shared(role, make) {
    let m = sharedCache.get(role);
    if (!m) {
      m = make();
      m._shared = true; // clearers must never dispose these
      sharedCache.set(role, m);
      registerForEnv(m);
      applyEnv(m); // in case ENV already exists
    }
    return m;
  }

  function num(v, d) { return typeof v === "number" ? v : d; }

  // ---- VEHICLE GLASS: the tint law and the emissive floor ------------------
  //
  //  THE TINT IS NOT A FREE CHOICE. city/crashdeform.js recognises "this mesh
  //  is a window, craze it after a crash" by pure colour arithmetic — there is
  //  no flag, no userData, no registry, just isGlassMat():
  //
  //        b - r > 0.045   &&   b < 0.4   &&   r < 0.25        (0..1 channels)
  //
  //  so a tint outside that box silently kills crash frosting for whatever
  //  wears it, and nothing anywhere reports it. The default below sits well
  //  inside on all three sides:
  //
  //    0x24435a → r 36/255 = .1412 · g 67/255 = .2627 · b 90/255 = .3529
  //      b - r = .2118 ✓ (clears by .167)
  //      b     = .3529 ✓ (clears by .047)
  //      r     = .1412 ✓ (clears by .109)
  //
  //  Every shipped caller tint clears it too, but only just in one case —
  //  island_airport's 0x10161c clears b-r by .0021 — so a tint that FAILS is
  //  refused here and swapped for the default rather than being drawn and
  //  quietly un-frostable. CBZ.glassAudit() re-runs this arithmetic against
  //  the LIVE materials, so the day somebody nudges a canopy toward grey the
  //  number moves instead of the behaviour.
  const GLASS_TINT_VEH = 0x24435a;
  const GLASS_OPACITY = 0.35;
  //  THE UNDERLIGHT IS A FLOOR, NOT A SETTING. Real glass never goes fully
  //  dark — it is always bouncing some sky back at you — and that emissive lift
  //  is the entire reason the city's curtain walls read as glass instead of as
  //  tinted cellophane (materials.js's own note). A canopy without it is a
  //  black void the moment the sun sets, which is most of what the owner was
  //  looking at. This is buildings.js's EXACT lift hex at 0.36 of its strength:
  //  a windscreen is a little over half the density of a curtain wall (0.35 vs
  //  0.60 opacity), so the same lift at full power would frost it. A caller may
  //  ask for MORE (per-channel max, below); it may not ask for less.
  const GLASS_LIFT_VEH = 0x3f8aa6, GLASS_LIFT_EI = 0.36;

  const vehGlass = [];          // every vehicle-glass material minted, for the audit
  const carGlass = [];          // the car-only reflective panes (role 'autoGlass')

  // ---- the WHEEL RAMP: 16x1 texels, g = roughness, b = metalness -----------
  // Index names are exported so city/carwheels.js tags its vertices by name.
  // Rubber is three channels on purpose: the tread face is dead matte, the
  // groove floors deader still, the sidewall a satin a hair shinier, and only
  // the SHOULDER roll carries the sheen that tells you it is a tyre. Metal is
  // split the way a real two-tone alloy is: a machined bright spoke face and
  // polished lip over gunmetal-painted pockets, a dark barrel, a rotor whose
  // friction ring is bare steel and whose hat is dull.
  const WHEEL_CH = {
    tread: 0, side: 1, alloy: 2, chrome: 3, rotor: 4, satin: 5, gloss: 6, dark: 7,
    groove: 8, shoulder: 9, face: 10, pocket: 11, hat: 12, lip: 13,
  };
  const WHEEL_RAMP = [
    [0.93, 0.00],   // 0  tread rubber
    [0.88, 0.00],   // 1  sidewall (satin rubber)
    [0.30, 0.90],   // 2  painted silver alloy (mesh wheels, aero fins)
    [0.05, 1.00],   // 3  chrome
    [0.40, 0.90],   // 4  rotor friction ring (bare steel)
    [0.50, 0.15],   // 5  satin paint (steelies, dust shield)
    [0.20, 0.10],   // 6  gloss paint (aero covers, centre caps)
    [0.36, 0.80],   // 7  dark alloy (barrel)
    [0.97, 0.00],   // 8  groove floors / sipe walls
    [0.66, 0.00],   // 9  tyre shoulder (the only rubber with a sheen)
    [0.14, 1.00],   // 10 machined spoke face
    [0.42, 0.55],   // 11 gunmetal-painted pockets / spoke flanks
    [0.62, 0.55],   // 12 rotor hat
    [0.08, 1.00],   // 13 polished lip
    [0.93, 0.00],   // 14 spare (= tread)
    [0.93, 0.00],   // 15 spare (= tread)
  ];
  CBZ.WHEEL_CH = WHEEL_CH;
  CBZ.WHEEL_RAMP_W = WHEEL_RAMP.length;
  let _wheelRamp = null;
  function wheelRamp() {
    if (_wheelRamp) return _wheelRamp;
    const d = new Uint8Array(WHEEL_RAMP.length * 4);
    for (let i = 0; i < WHEEL_RAMP.length; i++) {
      d[i * 4] = 255;
      d[i * 4 + 1] = Math.round(WHEEL_RAMP[i][0] * 255);
      d[i * 4 + 2] = Math.round(WHEEL_RAMP[i][1] * 255);
      d[i * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(d, WHEEL_RAMP.length, 1, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    _wheelRamp = t;
    return t;
  }

  /* ---- NUMBER PLATES: one small canvas atlas, eight plates ----------------
     Plain plates, as they are: a light field, a thin dark border, and a
     registration of a digit, three letters and three digits ("7KQ 482").
     No state names, no slogans, no brand (signage law). One 512x128 canvas
     holds all eight; each plate material is a texture VIEW of it (clone +
     offset/repeat, so it uploads once per variant at 64 KB). A box's faces
     each carry the full 0..1 UV, so on a plate box the front face shows one
     whole plate, upright, from outside. */
  const PLATE_N = 8;
  const PLATE_STYLE = [
    ["#f3f3ef", "#1c2440"], ["#f1ecd8", "#1a1a1a"], ["#f4f4f2", "#7a1c1c"], ["#f2d33a", "#141414"],
    ["#e9eef2", "#15315e"], ["#f3f3ef", "#1a1a1a"], ["#f1ecd8", "#123a22"], ["#f4f4f2", "#1c2440"],
  ];
  let plateCanvas = null, plateTex = null;
  const plateMats = [];
  let plateNext = 0;
  function plateAtlas() {
    if (plateCanvas || typeof document === "undefined") return plateCanvas;
    const cw = 128, ch = 64;
    const c = document.createElement("canvas");
    c.width = cw * 4; c.height = ch * 2;
    const g = c.getContext("2d");
    let s = 91;
    function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    const L = "ABCDEFGHJKLMNPRSTUVWXYZ";
    for (let i = 0; i < PLATE_N; i++) {
      const x = (i % 4) * cw, y = Math.floor(i / 4) * ch, st = PLATE_STYLE[i];
      g.fillStyle = st[0]; g.fillRect(x, y, cw, ch);
      g.strokeStyle = st[1]; g.lineWidth = 3; g.strokeRect(x + 3.5, y + 3.5, cw - 7, ch - 7);
      const reg = String(1 + Math.floor(rnd() * 9)) + L[Math.floor(rnd() * L.length)] + L[Math.floor(rnd() * L.length)] +
        L[Math.floor(rnd() * L.length)] + " " + String(Math.floor(rnd() * 900) + 100);
      g.fillStyle = st[1];
      g.font = "bold 30px Arial, Helvetica, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(reg, x + cw / 2, y + ch / 2 + 2, cw - 16);
    }
    plateCanvas = c;
    return c;
  }
  function carPlateMat(variant) {
    const i = variant == null ? (plateNext++ % PLATE_N) : (((variant | 0) % PLATE_N) + PLATE_N) % PLATE_N;
    if (plateMats[i]) return plateMats[i];
    let map = null;
    const atlas = plateAtlas();
    if (atlas && THREE.CanvasTexture) {
      if (!plateTex) {
        plateTex = new THREE.CanvasTexture(atlas);
        if (THREE.sRGBEncoding != null) plateTex.encoding = THREE.sRGBEncoding;
        plateTex.anisotropy = 4;
      }
      map = plateTex.clone();
      map.needsUpdate = true;
      map.repeat.set(0.25, 0.5);
      map.offset.set((i % 4) * 0.25, Math.floor(i / 4) === 0 ? 0.5 : 0);   // flipY: row 0 is the TOP half
    }
    const m = new THREE.MeshStandardMaterial({
      color: map ? 0xffffff : 0xe8e8e2,
      map: map,
      metalness: 0.25,
      roughness: 0.45,
      envMap: CBZ.ENV || null,
      envMapIntensity: 0.7,
    });
    m._shared = true;
    registerForEnv(m);
    plateMats[i] = m;
    return m;
  }
  let glassTintRefused = 0;     // caller tints rejected by the frost window

  function frostOk(hex) {
    const r = ((hex >> 16) & 255) / 255, b = (hex & 255) / 255;
    return (b - r > 0.045) && (b < 0.4) && (r < 0.25);
  }
  function glassTint(color) {
    const hex = color != null ? ((color | 0) & 0xffffff) : GLASS_TINT_VEH;
    if (frostOk(hex)) return hex;
    glassTintRefused++;
    return GLASS_TINT_VEH;
  }
  // Fold a caller's { emissive, ei } into the floor. The caller's lift is first
  // rescaled into the floor's intensity (so ei is comparable), then taken
  // per channel against the floor — brighter wins, darker is ignored. Result is
  // one hex to hand CBZ.glass at GLASS_LIFT_EI, so the common case (no caller
  // emissive) is the building lift EXACTLY, with no rounding.
  function glassLift(opts) {
    const em = opts.emissive != null ? ((opts.emissive | 0) & 0xffffff) : 0;
    if (!em) return GLASS_LIFT_VEH;
    const k = (opts.ei != null ? +opts.ei : 1) / GLASS_LIFT_EI;
    let out = 0;
    for (let s = 16; s >= 0; s -= 8) {
      const floor = (GLASS_LIFT_VEH >> s) & 255;
      const want = Math.min(255, Math.round(((em >> s) & 255) * k));
      out |= (want > floor ? want : floor) << s;
    }
    return out;
  }

  // ---- the public factory --------------------------------------------------
  // role table (B and C agents depend on this exact contract):
  //   'paint'      FRESH MeshPhysicalMaterial per call, _bodyPaint=true,
  //                satin base + clearcoat (see CLEARCOAT below)
  //   'glass'      THE ONE GLASS (Lambert pool) - aircraft, boats
  //   'autoGlass'  SHARED car glass: Physical transmission, reflective tint
  //   'chrome'/'metal' SHARED mirror metal
  //   'rim'        SHARED alloy
  //   'wheel'      SHARED vertex-coloured wheel material (carwheels.js ramp)
  //   'tire'       SHARED matte rubber (env for diffuse fill)
  //   'lightFront' SHARED emissive warm white
  //   'lightTail'  SHARED emissive red
  //   'plastic'    SHARED dark matte (slight env)
  //   'interior'   SHARED very dark matte (no envMap)
  // opts may override { roughness, metalness, emissiveIntensity }.
  /* ==========================================================================
     WHY A RANK OF CARS WAS A RANK OF WHITE CARS  —  CAR_PAINT_V2

     OWNER, looking at the speedway car park: "this gray whiteish car glitch".
     Every vehicle on the campus — twenty parked cars off a colourful catalog
     (0xe24b4b red, 0xf2c43d taxi yellow, 0x7d2bd6 purple, 0x1470e3 blue) —
     rendered as the same pale grey-white. The colours were never lost: the
     material's `.color` is the catalog hex on every one of them. The paint was
     simply not most of the pixel.

     THE ARITHMETIC. A MeshStandardMaterial splits its response by metalness:
     the DIFFUSE lobe — the only lobe that carries the car's own colour under a
     Lambert-lit world — is scaled by (1 - metalness), and the rest is a
     specular reflection of `envMap` scaled by `envMapIntensity`. This file's
     paint ran metalness 0.55 and playercars.js's per-style table pushed it to
     0.70 on a lowrider, with envMapIntensity up to 1.5. So:

         diffuse share   1 - 0.55            =  45%   (0.30 on the lowrider)
         env share       0.55 x 1.0          =  55%   (1.05 on the lowrider)

     and the env being reflected is `gradientCanvas()` above, whose top stop is
     #9fc4ff — a bright blue-white sky. On the surfaces you actually look at
     from a standing or overhead camera (roof, hood, boot lid) the normal points
     UP, samples that top stop, and more than half the pixel becomes pale sky.
     Then core/renderer.js's tone map pre-multiplies by exposure/0.6 = 1.67x and
     the survivors clip toward white. A red car is 45% red and 55% bright sky
     times 1.67 — which is a white car, exactly as filmed.

     THE LAW, and why it is a scale and not a new table. playercars.js's
     PAINT_OPTS is authored intent worth keeping — a Veyron IS meant to read
     wetter than a hatchback — so the ordering survives untouched and only the
     absolute response moves: metalness is scaled so the diffuse lobe carries
     the paint, and the env load is scaled to a sheen rather than a coat.

         metalness         x 0.40   0.48 -> 0.19   0.70 -> 0.28
         envMapIntensity   x 0.45   1.00 -> 0.45   1.50 -> 0.68
         roughness         x 0.92   a slightly tighter highlight, so what env
                                    survives reads as a HIGHLIGHT and not a wash

     diffuse share goes 45% -> 81%, and env load 0.55 -> 0.085. Real automotive
     paint is a pigmented dielectric under a clearcoat, not a metal; the flake
     is what the residual metalness is for. `metalEnvLoad` (metalness x
     envMapIntensity) is the number that was wrong and it is the ratchet.

     CLEARCOAT (2026-09 car wave). The paint is now what real paint is: a
     coloured, satin, mostly-dielectric BASE under a glossy CLEARCOAT
     (r128 MeshPhysicalMaterial clearcoat / clearcoatRoughness). The coat is
     where the sharp moving highlight and the skyline reflection live; it is
     Fresnel-weighted (about 4% face-on, strong at grazing), so it cannot
     repeat the white-car wash above: a roof seen from above reflects ~4% of
     the sky, a door seen along the street reflects the skyline. The base
     keeps the scaled metalness (flake) and a broader roughness, so the colour
     stays most of the pixel. The CAR_PAINT_V2 flag is gone (git is the undo);
     the ratchet below still reads metalness x envMapIntensity off the BASE.

     COST: r128 always compiles CLEARCOAT for a Physical material, so every
     paint in the city is ONE program (one extra specular lobe per light plus
     one env fetch, on car pixels only). Draw calls unchanged. */
  /* Measured in the car-showcase studio: at base metalness 0.40 x authored the
     base layer mirrored the bright street sky across every panel and a navy
     sedan photographed powder blue. Solid paint is a dielectric; the gloss
     lives in the CLEARCOAT lobe, so the base keeps only a trace of metal
     (flake) and the car keeps its colour. */
  const PAINT_V2 = { metalness: 0.12, envMapIntensity: 0.75 };
  // A paint whose env reflection out-weighs this much of its own colour is the
  // defect above. paintResponse clamps envMapIntensity so metalness x env can
  // never exceed 0.32 (the old unscaled table's softest, a hatch, was 0.48).
  const METAL_ENV_CEIL = 0.35;
  /* PAINT IS AUTHORED IN sRGB, THIS RENDERER IS NOT. The game runs the legacy
     pipeline (hex taken as linear, sRGB output), which lifts every mid-tone:
     a catalog navy 0x2d5f9a photographed powder blue and a red went salmon.
     Car paint is the one surface a stranger judges by saturation, so its hex
     is pulled most of the way into linear (gamma 1.7, not the full 2.2, so a
     car still sits in the same world as the lifted buildings around it). */
  function paintColor(hex) {
    const c = new THREE.Color(hex);
    c.r = Math.pow(c.r, 1.7); c.g = Math.pow(c.g, 1.7); c.b = Math.pow(c.b, 1.7);
    return c;
  }
  CBZ.carPaintColor = paintColor;
  function paintResponse(metalness, roughness, envMapIntensity) {
    const m = metalness * PAINT_V2.metalness;
    const e = Math.min(0.32 / Math.max(m, 0.05), envMapIntensity * PAINT_V2.envMapIntensity);
    // base: satin under the coat; the authored table's ordering is kept
    const r = Math.min(0.9, 0.34 + roughness * 0.5);
    // coat: the wetter the authored paint, the tighter the coat (~0.04..0.09)
    const cr = Math.min(0.12, 0.02 + roughness * 0.16);
    return {
      metalness: m, roughness: r, envMapIntensity: e, clearcoatRoughness: cr,
      diffuseShare: 1 - m,          // how much of the pixel is the car's colour
      metalEnvLoad: m * e,          // how much of it is the sky
      v2: true,
    };
  }
  /* CBZ.carPaintAudit() — THE RATCHET. `washed` is the number that matters:
     live body-paint materials whose reflection load exceeds the ceiling, i.e.
     cars whose own colour is not most of them. It read every paint material in
     the world before this change and must read 0. `minDiffuseShare` may only
     go UP. `mutedHex` counts materials whose colour is NOT what the catalog
     asked for — a different fault (a dead recolour hook) that would otherwise
     hide behind the same symptom, so it is counted separately and pinned too. */
  CBZ.carPaintAudit = function () {
    const out = {
      v2: true,                     // the flag is gone; kept for readers of the shape
      cars: 0, paints: 0, washed: 0, mutedHex: 0, marine: 0,
      minDiffuseShare: 1, maxMetalEnvLoad: 0, ceiling: METAL_ENV_CEIL,
      liveried: 0, distinctHex: 0, muted: [],
    };
    const list = CBZ.cityCars || [];
    const hexes = Object.create(null);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || !c.group || c.dead) continue;
      /* A HULL IS NOT A CAR AND IS NOT MEANT TO MATCH THE CATALOG.
         playercars.js's recolorBody returns early on `userData.marineLivery`:
         world/water_hulls.js authors a boat's paint scheme itself and the
         catalog `color` on a marine record is only the showroom swatch. Counted
         as cars, the marina's tenders and fishers were the whole `mutedHex`
         reading — a fault that was in the audit, not in the fleet. */
      const vis = c.group.userData && c.group.userData.carVisual;
      if ((vis && vis.userData && vis.userData.marineLivery) ||
          (c.group.userData && c.group.userData.marineLivery)) { out.marine++; continue; }
      out.cars++;
      let seen = false;
      c.group.traverse(function (o) {
        const m = o.material;
        if (!m || Array.isArray(m) || !m._bodyPaint) return;
        out.paints++;
        const mt = m.metalness == null ? 0 : m.metalness;
        const ei = m.envMapIntensity == null ? 1 : m.envMapIntensity;
        const load = m.envMap ? mt * ei : 0;
        if (load > METAL_ENV_CEIL) out.washed++;
        if (1 - mt < out.minDiffuseShare) out.minDiffuseShare = 1 - mt;
        if (load > out.maxMetalEnvLoad) out.maxMetalEnvLoad = load;
        if (!seen && m.color && m.color.getHex) {
          seen = true;
          const hx = m.color.getHex();
          hexes[hx] = (hexes[hx] || 0) + 1;
          // the paint the CATALOG asked for, before buildCar's per-car clearcoat
          // tint (0.86..1.14) — compare on hue, not on exact bytes.
          const want = c.color != null ? c.color : (c.model ? c.model.color : null);
          if (want != null && hueGap(hx, want) > 0.06) {
            out.mutedHex++;
            // NAME THE OFFENDER. A bare count is a number you can only argue
            // with; a row you can look up is one you can fix or exonerate.
            if (out.muted.length < 6) {
              out.muted.push({
                model: (c.model && c.model.name) || "?",
                want: "#" + ("000000" + (want >>> 0).toString(16)).slice(-6),
                got: "#" + ("000000" + (hx >>> 0).toString(16)).slice(-6),
                why: c._raceCar ? "raceCar" : c.player ? "player" : c._propParked ? "parked" : c.ai ? "traffic" : "other",
              });
            }
          }
        }
        if (o.userData && o.userData.raceLiveryBase) out.liveried++;
      });
    }
    out.distinctHex = Object.keys(hexes).length;
    out.minDiffuseShare = +out.minDiffuseShare.toFixed(3);
    out.maxMetalEnvLoad = +out.maxMetalEnvLoad.toFixed(3);
    return out;
  };
  // hue distance in [0,1] between two packed hexes (0 = same hue family)
  function hueGap(a, b) {
    function hue(h) {
      const r = ((h >> 16) & 255) / 255, g2 = ((h >> 8) & 255) / 255, bl = (h & 255) / 255;
      const mx = Math.max(r, g2, bl), mn = Math.min(r, g2, bl), d = mx - mn;
      // A NEAR-GREY HAS NO MEANINGFUL HUE. At d < 0.09 the hue angle is decided
      // by a couple of bytes of rounding, so an off-white repainted to a
      // slightly different off-white reported a full hue mismatch and showed up
      // as a fault. Below the threshold both colours are simply "grey" and
      // compare equal — the test is "did the paint go missing", not "did the
      // eighth decimal move".
      if (d < 0.09) return -1;
      let hh;
      if (mx === r) hh = ((g2 - bl) / d + 6) % 6;
      else if (mx === g2) hh = (bl - r) / d + 2;
      else hh = (r - g2) / d + 4;
      return hh / 6;
    }
    const ha = hue(a), hb = hue(b);
    if (ha < 0 || hb < 0) return ha === hb ? 0 : 0.5;
    const d = Math.abs(ha - hb);
    return Math.min(d, 1 - d);
  }

  function vehicleMat(role, color, opts) {
    opts = opts || {};

    // Headless / THREE missing: hand back a harmless object so callers don't
    // crash. (In the real game THREE is always present here.)
    if (!THREE || !THREE.MeshStandardMaterial) {
      const cmat = CBZ.cmat;
      if (cmat) {
        const m = cmat(color != null ? color : 0xb0b4ba, {});
        if (role === "paint") { const mm = (CBZ.mat || cmat)(color != null ? color : 0xb0b4ba, {}); mm._bodyPaint = true; return mm; }
        return m;
      }
      return {};
    }

    // Opportunistically build the env the moment a renderer is available.
    if (!CBZ.ENV) buildVehicleEnv();
    ensureEnvTick();

    if (role === "paint") {
      // ALWAYS fresh — per-car recolor clones the FIRST instance, but each
      // vehicle template gets its own paint material to recolour independently.
      const col = color != null ? color : 0xb0b4ba;
      const P = paintResponse(num(opts.metalness, 0.55),
                             num(opts.roughness, 0.38),
                             num(opts.envMapIntensity, 1.0));
      // flatShading OFF: a panel shades by the normals its geometry carries
      // (faceted geometry still reads faceted; a smooth panel can now be one).
      const m = new THREE.MeshPhysicalMaterial({
        color: paintColor(col),
        metalness: P.metalness,
        roughness: P.roughness,
        clearcoat: 1.0,
        clearcoatRoughness: P.clearcoatRoughness,
        envMap: CBZ.ENV || null,
        envMapIntensity: P.envMapIntensity,
      });
      m._paintResponse = P;                    // read by CBZ.carPaintAudit()
      // a whisper of self-glow only: the env's diffuse fill lifts the shadow
      // side now, and a bigger glow is what turns paint chalky after dark.
      m.emissive = paintColor(col).multiplyScalar(0.03);
      m.emissiveIntensity = num(opts.emissiveIntensity, 1.0);
      m._bodyPaint = true; // <-- EXACT flag matched from playercars.js recolorBody
      m._cbzPaint = true;  // paintHook (flop + flake) — survives clone via hookedClone
      m._flakeU = { value: 0 };
      registerForEnv(m); // back-fill envMap if ENV builds after this
      carPaintFinish(m, col);
      return m;
    }

    if (role === "glass") {
      // ==========================================================
      //  VEHICLE GLASS **IS** THE ONE GLASS.
      //
      //  OWNER: "a huge thing is the plane cockpit doesn't have windows like
      //  buildings that you see through."
      //
      //  It already WAS transparent (VEHICLE_REAL_GLASS, opacity .34) and it
      //  still read as a black slab, because transparency was never the fault.
      //  The fault was the material TYPE. This branch built a
      //  MeshStandardMaterial whose only light was CBZ.ENV — an 8x256 grey-blue
      //  gradient — with NO emissive at all, inside a world lit for Lambert.
      //  city/buildings.js wrote the post-mortem before this file ever made the
      //  mistake: "r128 has no PMREM/envMap reflection that works under a
      //  Lambert world (MeshStandard+envMap renders near-black)". The curtain
      //  wall the owner is comparing against is Lambert + an emissive lift, and
      //  the lift is the whole trick. So the canopy now asks for the SAME
      //  OBJECT OUT OF THE SAME POOL — not a lookalike.
      //
      //  Two more defects died with it, both invisible, both at every call site:
      //    • every caller passed { emissive, ei } — the repo-wide mat
      //      convention — and this branch read NEITHER. Dead tuning in
      //      aircraft.js, playeraircraft.js, playercars.js, vehicles.js,
      //      island_military.js and water_hulls.js alike. It is honoured now
      //      (as a floor: see glassLift).
      //    • shared() keyed the cache on the bare string "glass", so whichever
      //      vehicle happened to be built FIRST chose the pane for the airliner,
      //      the gunship, the bomber, every car and every boat at once. The key
      //      is role+resolved tint now, so the bomber's 0x2a3b4d and the police
      //      gunship's 0x121b22 are finally two different windows.
      //
      //  DoubleSide is not a preference: a camera can sit BEHIND this pane
      //  (cockpit_shapes.js says the same thing about its own glazing), and a
      //  FrontSide canopy is simply absent from the pilot's seat. depthWrite
      //  follows CBZ.glass's own rule for a double-sided pane — off, so a
      //  canopy cannot sort in front of its own instrument panel.
      //
      //  Batch-safe: still transparent, and core/batch.js refuses anything
      //  transparent (mergeableKeyV2) AND anything with a non-zero emissive, so
      //  the merge set cannot move. Deliberately NOT registered for the envMap
      //  back-fill — r128's Lambert envMap is a reflection COMBINE against a
      //  non-PMREM lookup, i.e. exactly the near-black this change removes.
      // ==========================================================
      const clear = !CBZ.CONFIG || CBZ.CONFIG.VEHICLE_REAL_GLASS !== false;
      const v2 = !CBZ.CONFIG || CBZ.CONFIG.VEHICLE_GLASS_V2 !== false;
      const tint = glassTint(color);
      if (v2 && clear && CBZ.glass) {
        const m = CBZ.glass({
          tint: tint,
          lift: glassLift(opts),
          ei: GLASS_LIFT_EI,
          opacity: num(opts.opacity, GLASS_OPACITY),
          // opts.side wins if a builder really means FrontSide; `double:false`
          // is NOT honoured, because the two call sites that pass `double` pass
          // it TRUE and the ones that omit it are the cockpits that need it most.
          side: opts.side != null ? (opts.side | 0) : THREE.DoubleSide,
          fog: opts.fog !== false,
        });
        if (vehGlass.indexOf(m) < 0) vehGlass.push(m);
        return m;
      }
      // LEGACY (flag off, or materials.js stripped): the MeshStandard recipe
      // that shipped before, with the cache-key bug fixed anyway so a revert
      // does not also revert every vehicle back to one shared tint.
      const m = shared("glass|" + tint, function () {
        return new THREE.MeshStandardMaterial({
          color: clear ? tint : 0x10161c,
          metalness: num(opts.metalness, clear ? 0.55 : 0.9),
          roughness: num(opts.roughness, 0.07),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.0),
          transparent: clear,
          opacity: clear ? 0.34 : 1,
          depthWrite: !clear,
        });
      });
      if (vehGlass.indexOf(m) < 0) vehGlass.push(m);
      return m;
    }

    /* ---- CAR GLASS: dark tinted, REFLECTIVE, and see-through ---------------
       The 'glass' role above is THE ONE GLASS (Lambert + emissive lift) and
       stays that for aircraft/boats/buildings. On a CAR it read as a flat
       tinted film: no reflection at all, so a windscreen never looked like
       glass, and its lift glowed after dark. Car glass is its own role now.

       r128's MeshPhysicalMaterial `transmission` does exactly what automotive
       glass needs, cheaply (no extra pass in r128): alpha becomes
           opacity x (1 - transmission + luminance(specular reflection))
       so where the pane reflects bright sky (grazing angles: a windscreen
       from the street, a side window along the car) it turns into a mirror,
       and face-on, or looking out from the cabin at the dark street, it is
       ~36% tint over a clear view. At night the env term is dimmed by
       cbzEnvK, so the pane goes back to plain dark tint: nothing glows.

       Frost law: the tint 0x24435a sits inside crashdeform.js's isGlassMat
       window, and crashdeform's frost clone drops `transmission` so a crazed
       pane goes opaque (the hooked clone keeps the program shared). */
    if (role === "autoGlass") {
      const tint = glassTint(color);
      const m = shared("autoGlass|" + tint, function () {
        return new THREE.MeshPhysicalMaterial({
          color: tint,
          metalness: 0.0,
          roughness: 0.04,
          transmission: num(opts.transmission, 0.5),   // 0.64 read as pale grey-blue glass in daylight
          transparent: true,
          opacity: 1.0,
          depthWrite: false,
          side: THREE.DoubleSide,
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.5),
        });
      });
      if (carGlass.indexOf(m) < 0) carGlass.push(m);
      return m;
    }

    if (role === "chrome" || role === "metal") {
      // a MIRROR: full metal, nearly polished. What it shows is the env's
      // skyline + sky, which is exactly what reads as chrome.
      return shared("chrome", function () {
        return new THREE.MeshStandardMaterial({
          color: 0xe4e7eb,
          metalness: num(opts.metalness, 1.0),
          roughness: num(opts.roughness, 0.07),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.2),
        });
      });
    }

    if (role === "rim") {
      return shared("rim", function () {
        return new THREE.MeshStandardMaterial({
          color: 0xc4c9cf,
          metalness: num(opts.metalness, 0.9),
          roughness: num(opts.roughness, 0.26),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.0),
        });
      });
    }

    /* ---- THE WHEEL: one material for tyre, rim, rotor and lugs ------------
       city/carwheels.js builds each wheel as ONE mesh with vertex colours and
       a uv whose u picks a texel of this 16x1 ramp: green = roughness, blue =
       metalness (r128 reads roughnessMap.g and metalnessMap.b). Rubber,
       alloy, chrome, rotor steel and satin paint in one draw call. */
    if (role === "wheel") {
      return shared("wheel", function () {
        return new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 1.0,
          metalness: 1.0,
          roughnessMap: wheelRamp(),
          metalnessMap: wheelRamp(),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.0),
        });
      });
    }

    if (role === "tire") {
      return shared("tire", function () {
        // matte rubber. It takes the env now, for its DIFFUSE fill: without
        // it a tyre in shade was a flat black hole.
        return new THREE.MeshStandardMaterial({
          color: 0x1c1d20,
          metalness: num(opts.metalness, 0.0),
          roughness: num(opts.roughness, 0.9),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 0.8),
        });
      });
    }

    if (role === "lightFront") {
      return shared("lightFront", function () {
        return new THREE.MeshStandardMaterial({
          color: 0x222018,
          emissive: 0xfff2cc,
          emissiveIntensity: num(opts.emissiveIntensity, 1.15),
          metalness: 0.0,
          roughness: 0.4,
        });
      });
    }

    if (role === "lightTail") {
      return shared("lightTail", function () {
        return new THREE.MeshStandardMaterial({
          color: 0x220404,
          emissive: 0xff2020,
          emissiveIntensity: num(opts.emissiveIntensity, 1.1),
          metalness: 0.0,
          roughness: 0.4,
        });
      });
    }

    if (role === "plastic") {
      // black trim: SATIN, dielectric — a soft sheen, never a mirror
      return shared("plastic", function () {
        return new THREE.MeshStandardMaterial({
          color: 0x17191c,
          metalness: num(opts.metalness, 0.0),
          roughness: num(opts.roughness, 0.52),
          envMap: CBZ.ENV || null,
          envMapIntensity: num(opts.envMapIntensity, 1.0),
        });
      });
    }

    if (role === "interior") {
      return shared("interior", function () {
        // very dark matte cabin — no envMap (it's enclosed; reflection unseen)
        return new THREE.MeshStandardMaterial({
          color: 0x0d0e10,
          metalness: num(opts.metalness, 0.0),
          roughness: num(opts.roughness, 0.85),
        });
      });
    }

    // Unknown role: safe generic painted-ish surface so callers never get null.
    const col = color != null ? color : 0xb0b4ba;
    const gm = new THREE.MeshStandardMaterial({
      color: col,
      metalness: num(opts.metalness, 0.2),
      roughness: num(opts.roughness, 0.6),
      envMap: CBZ.ENV || null,
      envMapIntensity: num(opts.envMapIntensity, 1.0),
    });
    return registerForEnv(gm);
  }

  // ---- SHARED VEHICLE/AIRCRAFT GEOMETRY SCULPTOR ---------------------------
  //  taperBox() was hand-copied into SIX builders (aircraft.js, airtraffic.js,
  //  island_military.js, playerair.js, playeraircraft.js, strategic.js). Five
  //  copies were byte-identical; the sixth differed only in variable names and
  //  comments — same math, same defaults, same return. Verified by extracting
  //  each brace-matched body and diffing (2026-07-26 duplication census), then
  //  collapsed here. carfx.js is the natural home: it is already the shared
  //  vehicle-construction module (CBZ.vehicleMat/CBZ.ENV) and it loads at
  //  index.html:344, well before every consumer (585-739), so the handle always
  //  exists by the time a builder runs.
  //
  //  Scales each vertex's X/Y by a factor that depends on its Z (nose=+Z → nz,
  //  tail=-Z → tz), with optional roofline (top) / keel (bot) narrowing.
  //  Returns a BoxGeometry; callers flag it _shared so the cache disposer
  //  leaves it alone. Pure function of its arguments — no external state.
  function taperBox(w, h, d, opt) {
    opt = opt || {};
    // Resolve THREE off window, NOT the module-scoped `const THREE` below: on
    // the CBZ.VEHICLE_FX === false kill-switch path this function is exported
    // before that const is ever evaluated, so touching it would throw a
    // temporal-dead-zone ReferenceError. (Verified by executing both paths.)
    const T = window.THREE;
    const nz = opt.nz != null ? opt.nz : 1, tz = opt.tz != null ? opt.tz : 1;
    const top = opt.top != null ? opt.top : 1, bot = opt.bot != null ? opt.bot : 1;
    const geo = new T.BoxGeometry(w, h, d, opt.segW || 2, opt.segH || 2, opt.segD || 6);
    const pos = geo.attributes.position, hd = d / 2, hh = h / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const f = z / hd, zt = f >= 0 ? (1 + (nz - 1) * f) : (1 + (tz - 1) * -f);
      let sx = zt, sy = zt;
      const vy = hh > 0 ? y / hh : 0;
      if (vy > 0) sx *= (1 + (top - 1) * vy);
      if (vy < 0) sx *= (1 + (bot - 1) * -vy);
      pos.setX(i, x * sx); pos.setY(i, y * sy);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }

  // ---- CBZ.glassAudit() ----------------------------------------------------
  //  Two questions, both answered off the LIVE materials rather than off the
  //  constants above — the constants cannot lie, but a caller's tint can.
  //
  //  (1) IS VEHICLE GLASS ACTUALLY THE ONE GLASS? `vehicleGlassMode` reads
  //      "one-glass" only when the material a vehicle is really wearing is the
  //      Lambert pane out of materials.js's pool. `oneGlassConsumers` is that
  //      pool's size: DISTINCT panes minted game-wide (a curtain wall, a
  //      cockpit pane, a terminal window and a canopy are four different asks
  //      off one recipe). It started at 1 — buildings.js was the only file that
  //      could reach the recipe at all — so this number is the adoption ratchet
  //      and may only ever go UP.
  //
  //  (2) CAN A CRASH STILL FROST IT? city/crashdeform.js finds windows by pure
  //      colour arithmetic and by nothing else, so a tint change is a silent
  //      way to delete crash frosting from the whole game. Every vehicle glass
  //      material ever minted is re-tested here against that exact window;
  //      `frostMargin` is how much slack the WORST of them has left (metres of
  //      nothing — it is a 0..1 colour margin; negative means broken).
  //      `tintInFrostWindow` is the hard invariant and must stay true.
  function glassAudit() {
    const pool = (CBZ.glassPool ? CBZ.glassPool() : null) || { mats: [], variants: 0, calls: 0 };
    let buildingGlass = false;
    for (let i = 0; i < pool.mats.length; i++) {
      const c = pool.mats[i] && pool.mats[i].color;
      if (c && c.getHex && c.getHex() === ((CBZ.GLASS_TINT | 0) & 0xffffff)) buildingGlass = true;
    }
    let inWindow = true, worst = null, worstMargin = null;
    const tints = [];
    const allGlass = vehGlass.concat(carGlass);   // car panes must stay frostable too
    for (let i = 0; i < allGlass.length; i++) {
      const m = allGlass[i];
      if (!m || !m.color) continue;
      const r = m.color.r, b = m.color.b;
      // the three clearances of crashdeform.js's isGlassMat, smallest wins
      const margin = Math.min(b - r - 0.045, 0.4 - b, 0.25 - r);
      const hex = "0x" + m.color.getHexString();
      if (tints.indexOf(hex) < 0) tints.push(hex);
      if (margin <= 0) inWindow = false;
      if (worstMargin == null || margin < worstMargin) { worstMargin = margin; worst = hex; }
    }
    const first = vehGlass[0] || null;
    return {
      vehicleGlassMode: !first ? "unbuilt"
        : (first.isMeshLambertMaterial ? "one-glass" : "legacy-standard"),
      flagOn: !CBZ.CONFIG || CBZ.CONFIG.VEHICLE_GLASS_V2 !== false,
      oneGlassConsumers: pool.variants,     // distinct panes in THE ONE GLASS pool
      oneGlassCalls: pool.calls,            // how often anything asked for glass
      buildingGlassInPool: buildingGlass,   // the curtain wall and the canopy share a pool
      vehicleGlassVariants: vehGlass.length,
      vehicleGlassTints: tints,
      tintRefused: glassTintRefused,        // caller tints the frost window rejected
      tintInFrostWindow: inWindow,
      frostMargin: worstMargin == null ? null : +worstMargin.toFixed(4),
      worstTint: worst,
      transparent: !!(first && first.transparent),
      opacity: first ? first.opacity : null,
      doubleSided: !!(first && THREE && first.side === THREE.DoubleSide),
      carGlassVariants: carGlass.length,    // 'autoGlass': Physical transmission panes on cars
      carGlassTransmission: carGlass[0] ? carGlass[0].transmission : null,
    };
  }

  // ---- wire up exports + readiness backstops ------------------------------
  CBZ.buildVehicleEnv = buildVehicleEnv;
  CBZ.vehicleMat = vehicleMat;
  CBZ.glassAudit = glassAudit;
  CBZ.taperBox = taperBox;
  // CBZ.carPlateMat(i) -> shared plate material i (0..7); no argument cycles.
  CBZ.carPlateMat = carPlateMat;
  if (CBZ.ENV === undefined) CBZ.ENV = null;

  // Try once at load (renderer usually already exists here).
  buildVehicleEnv();
  ensureEnvTick();

  // Per-frame backstop: if the renderer wasn't ready at load, build the env on
  // the first frame it IS, then back-fill, then stop trying. Cheap no-op once
  // built. Guarded so headless (no onAlways) still loads fine.
  if (!CBZ.ENV && typeof CBZ.onAlways === "function") {
    let tries = 0;
    CBZ.onAlways(1, function () {
      if (CBZ.ENV) return; // done
      if (tries++ > 600) return; // give up after ~a few seconds; stay graceful
      buildVehicleEnv();
    });
  }
})();
