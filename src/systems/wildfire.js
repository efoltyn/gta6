/* ============================================================
   systems/wildfire.js — THE WILDFIRE CORE (CBZ.wildfire).

   The old wildfire (systems/disasters.js, kept verbatim there as the
   WILDFIRE_V2=false revert path) had four fakes that between them deleted the
   event's identity:

     · its embers and its smoke were CBZ.fx.particleCloud fields centred on
       THE CAMERA — orange specks around you wherever you stood, no relation
       to where anything burned. The fire had no smoke column; you had one.
     · a tree burned for 2.5-4.5 s and then burnOut() DELETED its ground
       scorch. The trunk went black but the ground went back to green, and at
       end() every trace but the black boxes was disposed. Fire that leaves
       no scar is a light show.
     · spread was a 13 m coin-flip diffusion you outrun at walking pace.
       No spotting, no slope, and smoke hurt nobody — only flame contact
       killed, which inverts the real casualty table.
     · safeDir pointed radially away from the flames — for anyone downwind
       that is STRAIGHT DOWNWIND, the one direction a wildfire is guaranteed
       to win.

   This file is the real event, built from what a wildfire actually is:

   SPREAD IS THE EVENT. Fire moves tree to tree by radiant/convective heating:
   each burning tree pours heat into unburnt neighbours and a tree ignites
   when its heat integral crosses 1 — so the front is a travelling WAVE with
   a shape, not a per-tick dice roll. The heating is elliptical about the
   wind (a head fire runs, flanks creep, the heel barely backs — Rothermel's
   wind coefficient, arena-scaled) and exponential in slope (the field rule
   of thumb: rate of spread roughly doubles per 10° uphill, because the flame
   tilts into the fuel and pre-heats it). Fuel DRIES on camera: a heated
   canopy turns ochre before it torches, which is the front telegraphing
   itself a tree ahead.

   THE SMOKE KILLS MORE PEOPLE THAN THE FLAME, AND IT ARRIVES FIRST. Most
   civilian wildfire deaths are smoke inhalation/asphyxiation, not burns, and
   the plume runs ahead of the front at wind speed while the front itself
   crawls. So the plume here is a physical field anchored to the burning
   trees — a downwind corridor (Gaussian in crosswind, ~60 m long) that
   chokes anyone inside it: less damage per second than standing in flame,
   over twenty times the area. Its deaths carry their own killfeed cause.
   Visually the smoke is TWO behaviours from one particle pool: convective
   columns that stand up off each torching crown and bend over downwind, and
   heavy surface smoke that hugs the ground and runs ahead of the fire —
   which is why the escape route fogs out before the flames are anywhere
   near it.

   SPOTTING: lofted embers start NEW fires 15-50 m ahead of the front. That
   is the mechanism that makes "I have a head start, I'll outrun it
   downwind" a fatal plan — the fire is already ahead of you. Embers here
   are real tracked projectiles (visible as streaks), they land, smoulder,
   and ignite the fuel they land in or fizzle into a small scar.

   BLACK IS BLACK. A burnt tree stays burnt — canopy consumed to a charred
   skeleton — and the ground under the run stays black: one instanced scar
   mesh accumulates a charred footprint per tree and per ember strike and
   SURVIVES the event's end. The burn scar is what a wildfire leaves; it is
   also, famously, the one safe place ("the black") once the front has
   passed. threat() knows that: burnt ground scores zero.

   ACROSS THE WIND, NOT AWAY FROM IT. safeDir answers with the crosswind
   escape: flanking out of the plume corridor beats racing the head fire,
   because the head fire (plus its spotting) is faster than you and the
   flanks are not. Upwind of the fire the radial answer is honest and kept.

   REUSE, NOT REINVENTION: deaths via CBZ.surv.hurt (killfeed causes
   resolve there), wind IS the weather's wind (the def drives
   CBZ.weatherDrive with this module's bearing so rain streaks, debris and
   the tornado all agree), determinism via CBZ.survRnd for anything that
   places a hazard or decides damage (per the line drawn in disasters.js),
   Math.random only for FX jitter no rule reads. The def in
   systems/disasters.js keeps ownership of env tint, weather driving, pacing
   and the legacy revert path; this file owns the fire.

   Ratchet: CBZ.wildfireAudit() — live-measured, works (with zeros) on the
   legacy path too so an A/B table means something.
   Flag: WILDFIRE_V2 (declared HERE, default on; ?cfg_WILDFIRE_V2=0 reverts
   to the old behaviour exactly).
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.wildfire) return;                    // idempotent family guard
  const THREE = window.THREE;

  if (CBZ.CONFIG.WILDFIRE_V2 == null) CBZ.CONFIG.WILDFIRE_V2 = true;
  if (CBZ.CONFIG.WILDFIRE_RENDER_V3 == null) CBZ.CONFIG.WILDFIRE_RENDER_V3 = true;

  // hazard-placing draws come from THE shared survival stream (see the
  // determinism header in systems/disasters.js); FX jitter stays Math.random
  const rnd = () => (CBZ.survRnd ? CBZ.survRnd() : Math.random());
  const jit = () => Math.random();

  const surv = () => CBZ.surv;
  const ground = (x, z) => (CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena.groundHeightAt(x, z) : 0);

  /* ---- tuning ---------------------------------------------------------- */
  const REACH = 26;          // m — radiant/convective heating reach, tree to tree
  const PLUME_BASE = 34;     // m — plume corridor length before the wind term
  const SPOT_MIN = 15, SPOT_SPAN = 36;   // m — ember flight, downwind
  const MAXFLAME = 48;       // simultaneous torching trees drawn
  const MAXSMOKE = 1600, MAXEMBER = 320, MAXSCAR = 340;

  /* ---- run state -------------------------------------------------------- */
  const F = {
    live: false,             // between beginWarn and stop
    arena: null,
    t: 0,                    // module clock (s) for flicker
    wx: 1, wz: 0, wspd: 10,  // THE wind (the def feeds it to weatherDrive)
    seed: null,              // the origin tree
    intensity: 0,
    spreadCd: 0, spotCd: 2.2, veer: 0,
    burningList: [],         // cache rebuilt each tick
    spots: [],               // embers in flight
    smoulders: [],           // landed embers deciding whether to take
    smokeLinger: 0,          // seconds of post-event plume decay left
  };
  let stats = null;
  function zeroStats() {
    stats = {
      ignitions: 0, spotLaunched: 0, spotFires: 0, spotMaxM: 0,
      smokeDamage: 0, flameDamage: 0, smokeDeaths: 0, flameDeaths: 0,
      scarM2: 0,
    };
  }
  zeroStats();

  /* ---- the drawn fire: GPU sprites, pooled smoke/embers ------------------
     r128's PointsMaterial draws an untextured point as a literal square. That
     was the whole visible failure here: 1,600 grey panes and three six-sided
     cones can describe the right plume and still look nothing like one.

     The V3 road is the small, native Three.js answer: one Points buffer per
     effect, custom size/opacity attributes, and gl_PointCoord shaping in a
     ShaderMaterial. Overlapping translucent billboards give smoke volume;
     three animated flame tongues per crown give the front a broken edge. The
     simulation, pools and draw-call budget stay where they were. The exact old
     geometry remains behind WILDFIRE_RENDER_V3=false for matched A/B proof. */
  let FX = null;
  const dummy = new THREE.Object3D();

  function fogUniforms(extra) {
    return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, extra]);
  }

  function flameMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: fogUniforms({
        uTime: { value: 0 }, uScale: { value: 320 }, uWind: { value: new THREE.Vector2(1, 0) },
      }),
      vertexShader: `
        uniform float uScale;
        uniform vec2 uWind;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aSeed;
        varying float vAlpha;
        varying float vSeed;
        varying float vWindX;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          mvPosition.z += 1.15;   // sit clear of the crown box, not inside it
          vec2 vw = (viewMatrix * vec4(uWind.x, 0.0, uWind.y, 0.0)).xy;
          vWindX = length(vw) > 0.001 ? normalize(vw).x : 0.0;
          vAlpha = aAlpha;
          vSeed = aSeed;
          gl_PointSize = min(220.0, max(0.0, aSize * uScale / max(1.0, -mvPosition.z)));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying float vAlpha;
        varying float vSeed;
        varying float vWindX;
        #include <fog_pars_fragment>
        void main() {
          // gl_PointCoord.y runs DOWNWARD (0 = top of the sprite). Every term
          // below is written in height-above-the-base, so flip the axis once
          // here. Read straight, this shader drew a goblet: widest and hottest
          // at the top, flat-cut where the tip should taper, wind bending the
          // root instead of the tongue.
          float y = 1.0 - gl_PointCoord.y;
          float x = gl_PointCoord.x * 2.0 - 1.0;
          float lick = sin(y * 10.0 + vSeed * 17.0 + uTime * 8.5) * (0.035 + y * 0.09);
          float lean = vWindX * y * y * 0.48;
          float width = (0.04 + 0.62 * pow(max(0.0, 1.0 - y), 0.76)) *
            (0.9 + 0.1 * sin(vSeed * 31.0 + uTime * 10.0 - y * 7.0));
          float q = abs(x - lean - lick) / max(0.04, width);
          // A flame is a soft, folding sheet rather than a cut-out triangle.
          // Feather the whole tongue and nibble its edge with two frequencies
          // so overlapping points merge into one crown fire.
          float body = 1.0 - smoothstep(0.58, 1.08, q);
          body *= 0.90 + 0.10 * sin(y * 18.0 + x * 5.0 + vSeed * 37.0 + uTime * 11.0);
          body *= smoothstep(0.01, 0.10, y);
          body *= 1.0 - smoothstep(0.87 + 0.045 * sin(vSeed * 23.0 + uTime * 7.0), 1.0, y);
          float core = pow(max(0.0, 1.0 - q), 2.1) * pow(max(0.0, 1.0 - y), 0.55);
          vec3 color = mix(vec3(1.0, 0.075, 0.008), vec3(1.0, 0.38, 0.015), body);
          color = mix(color, vec3(1.0, 0.78, 0.16), smoothstep(0.15, 0.78, core) * 0.82);
          float alpha = body * vAlpha * (0.88 + 0.12 * sin(vSeed * 41.0 + uTime * 13.0));
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(color, alpha);
          #include <fog_fragment>
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: true,
    });
  }

  function smokeMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: fogUniforms({
        uTime: { value: 0 }, uScale: { value: 320 }, uWind: { value: new THREE.Vector2(1, 0) },
      }),
      vertexShader: `
        uniform float uScale;
        uniform vec2 uWind;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aSeed;
        attribute float aSurface;
        attribute float aHot;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        varying float vSurface;
        varying float vHot;
        varying vec2 vWind;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vec2 vw = (viewMatrix * vec4(uWind.x, 0.0, uWind.y, 0.0)).xy;
          vWind = length(vw) > 0.001 ? normalize(vw) : vec2(1.0, 0.0);
          vColor = aColor;
          vAlpha = aAlpha;
          vSeed = aSeed;
          vSurface = aSurface;
          vHot = aHot;
          gl_PointSize = min(240.0, max(0.0, aSize * uScale / max(1.0, -mvPosition.z)));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        varying float vSurface;
        varying float vHot;
        varying vec2 vWind;
        #include <fog_pars_fragment>
        void main() {
          vec2 p = (gl_PointCoord - 0.5) * 2.0;
          if (vSurface > 0.5) {
            vec2 crossWind = vec2(-vWind.y, vWind.x);
            float along = dot(p, vWind) * 0.72;
            float across = dot(p, crossWind) * 1.18;
            p = vWind * along + crossWind * across;
          }
          p += vec2(sin(p.y * 4.1 + vSeed * 19.0), sin(p.x * 3.7 + vSeed * 29.0)) * 0.075;
          float angle = atan(p.y, p.x);
          float edge = 0.86 + 0.055 * sin(angle * 3.0 + vSeed * 19.0) +
            0.035 * sin(angle * 7.0 - vSeed * 31.0);
          float d = length(p);
          // Gaussian falloff avoids the flat opaque centres that made a plume
          // read as a chain of grey coins at distance. The irregular outer
          // cutoff keeps each billboard from becoming a perfect circle.
          float q = d / max(0.2, edge);
          float body = exp(-2.65 * q * q) * (1.0 - smoothstep(0.78, 1.12, q));
          float mottled = 0.90 + 0.10 * sin((p.x + vSeed) * 5.0) * sin((p.y - vSeed) * 4.0);
          float alpha = body * mottled * vAlpha;
          if (alpha < 0.006) discard;
          // Same downward axis: this glow belongs on the puff's UNDERSIDE,
          // where the fire is, so measure height from the bottom edge.
          float h = 1.0 - gl_PointCoord.y;
          float under = (1.0 - smoothstep(0.10, 0.78, h)) * vHot;
          vec3 color = vColor + vec3(0.34, 0.085, 0.012) * under * body;
          gl_FragColor = vec4(color, alpha);
          #include <fog_fragment>
        }
      `,
      transparent: true, depthWrite: false, fog: true,
    });
  }

  function emberMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 320 } },
      vertexShader: `
        uniform float uScale;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vAlpha = aAlpha;
          gl_PointSize = min(18.0, 1.5 + 0.22 * uScale / max(1.0, -mvPosition.z));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float alpha = (1.0 - smoothstep(0.12, 1.0, d)) * vAlpha;
          if (alpha < 0.01) discard;
          vec3 color = mix(vec3(1.0, 0.22, 0.015), vec3(1.0, 0.92, 0.42), 1.0 - smoothstep(0.0, 0.5, d));
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  function radialGlowMap() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const r = g.createRadialGradient(32, 32, 1, 32, 32, 31);
    r.addColorStop(0, "rgba(255,255,255,.88)");
    r.addColorStop(0.28, "rgba(255,255,255,.54)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false; t._wildfireTexture = true;
    return t;
  }

  function irregularDisc() {
    const geo = new THREE.CircleGeometry(1, 28);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), a = Math.atan2(y, x), d = Math.hypot(x, y);
      if (d < 0.01) continue;
      const r = 0.88 + 0.08 * Math.sin(a * 3 + 0.7) + 0.06 * Math.sin(a * 7 - 0.3);
      p.setXY(i, x * r, y * r);
    }
    p.needsUpdate = true; geo.rotateX(-Math.PI / 2); return geo;
  }

  function buildFX(root) {
    if (FX) return;
    /* Three.js allocates UUIDs with Math.random(). The old cone road creates
       a different number of geometries/materials than the shader road, so a
       rendering flag used to advance the GLOBAL random stream by a different
       amount. Unrelated actor choices then diverged and even smoke-death totals
       changed in a rendering-only A/B. Construction is synchronous: give UUID
       allocation a private deterministic stream and restore the game's stream
       immediately. Runtime puff jitter keeps using `jit` as before. */
    const priorRandom = Math.random;
    let fxSeed = (0x57464d33 ^ ((root && root.id) || 0)) >>> 0;
    Math.random = function () {
      fxSeed = (Math.imul(fxSeed, 1664525) + 1013904223) >>> 0;
      return fxSeed / 4294967296;
    };
    try { buildFXMeshes(root); }
    finally { Math.random = priorRandom; }
  }

  function buildFXMeshes(root) {
    const renderV3 = CBZ.CONFIG.WILDFIRE_RENDER_V3 !== false;
    let flames = [], flame = null;
    if (renderV3) {
      const fgeo = new THREE.BufferGeometry();
      const count = MAXFLAME * 3;
      fgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3).fill(-9999), 3).setUsage(THREE.DynamicDrawUsage));
      fgeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
      fgeo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
      fgeo.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
      fgeo.setDrawRange(0, 0);
      flame = new THREE.Points(fgeo, flameMaterial());
      flame.renderOrder = 8; flame.frustumCulled = false;
      flame.userData.transient = true; root.add(flame);
    } else {
      const cone = new THREE.ConeGeometry(1, 2.4, 6);
      cone.translate(0, 1.2, 0);
      const layer = (color, opacity) => {
        const m = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({
          color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
        }), MAXFLAME);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.count = 0; m.renderOrder = 8; m.frustumCulled = false;
        m.userData.transient = true; root.add(m); return m;
      };
      flames = [layer(0xff3a0e, 0.8), layer(0xff7a1e, 0.7), layer(0xffd24a, 0.6)];
    }

    const glowGeo = new THREE.CircleGeometry(1, renderV3 ? 28 : 18);
    glowGeo.rotateX(-Math.PI / 2);
    const glow = new THREE.InstancedMesh(glowGeo, new THREE.MeshBasicMaterial({
      color: 0xff3c08, map: renderV3 ? radialGlowMap() : null, transparent: true,
      opacity: renderV3 ? 0.24 : 0.28, depthWrite: false, blending: THREE.AdditiveBlending,
    }), MAXFLAME);
    glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    glow.count = 0; glow.renderOrder = 5; glow.frustumCulled = false;
    glow.userData.transient = true; root.add(glow);
    // THE SCAR — the one mesh here that outlives the event on purpose.
    const scar = new THREE.InstancedMesh(renderV3 ? irregularDisc() : glowGeo, new THREE.MeshBasicMaterial({
      color: 0x14100b, transparent: true, opacity: 0.85, depthWrite: false,
    }), MAXSCAR);
    scar.count = 0; scar.renderOrder = 4; scar.frustumCulled = false;
    scar.userData.transient = true; root.add(scar);

    // smoke stays one pool and one draw call; V3 adds the attributes its
    // organic edge, age fade and fire-lit underside need.
    const sgeo = new THREE.BufferGeometry();
    const spos = new Float32Array(MAXSMOKE * 3).fill(-9999);
    const scol = new Float32Array(MAXSMOKE * 3);
    sgeo.setAttribute("position", new THREE.BufferAttribute(spos, 3).setUsage(THREE.DynamicDrawUsage));
    sgeo.setAttribute(renderV3 ? "aColor" : "color", new THREE.BufferAttribute(scol, 3).setUsage(THREE.DynamicDrawUsage));
    if (renderV3) {
      sgeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(MAXSMOKE), 1).setUsage(THREE.DynamicDrawUsage));
      sgeo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(MAXSMOKE), 1).setUsage(THREE.DynamicDrawUsage));
      sgeo.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(MAXSMOKE), 1));
      sgeo.setAttribute("aSurface", new THREE.BufferAttribute(new Float32Array(MAXSMOKE), 1).setUsage(THREE.DynamicDrawUsage));
      sgeo.setAttribute("aHot", new THREE.BufferAttribute(new Float32Array(MAXSMOKE), 1).setUsage(THREE.DynamicDrawUsage));
      const seed = sgeo.attributes.aSeed.array;
      for (let i = 0; i < MAXSMOKE; i++) seed[i] = ((i * 0.61803398875) % 1 + 1) % 1;
    }
    const smoke = new THREE.Points(sgeo, renderV3 ? smokeMaterial() : new THREE.PointsMaterial({
      size: 3.6, vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, sizeAttenuation: true, fog: true,
    }));
    smoke.renderOrder = 9; smoke.frustumCulled = false;
    smoke.userData.transient = true; root.add(smoke);

    const egeo = new THREE.BufferGeometry();
    const epos = new Float32Array(MAXEMBER * 3).fill(-9999);
    egeo.setAttribute("position", new THREE.BufferAttribute(epos, 3).setUsage(THREE.DynamicDrawUsage));
    if (renderV3) egeo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(MAXEMBER), 1).setUsage(THREE.DynamicDrawUsage));
    const embers = new THREE.Points(egeo, renderV3 ? emberMaterial() : new THREE.PointsMaterial({
      size: 0.2, color: 0xff8828, transparent: true, opacity: 0.8, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    embers.renderOrder = 10; embers.frustumCulled = false;
    embers.userData.transient = true; root.add(embers);

    FX = {
      root, renderV3, flames, flame,
      glow, scar, scarUsed: 0,
      smoke, spuff: new Array(MAXSMOKE).fill(null), sFree: [],
      embers, epuff: new Array(MAXEMBER).fill(null), eFree: [],
    };
    for (let i = MAXSMOKE - 1; i >= 0; i--) FX.sFree.push(i);
    for (let i = MAXEMBER - 1; i >= 0; i--) FX.eFree.push(i);
  }
  function disposeFX() {
    if (!FX) return;
    const kill = (m) => {
      if (!m) return;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material && m.material.map && m.material.map._wildfireTexture) m.material.map.dispose();
      if (m.material && m.material.dispose) m.material.dispose();
    };
    FX.flames.forEach(kill); kill(FX.flame); kill(FX.glow); kill(FX.scar); kill(FX.smoke); kill(FX.embers);
    FX = null;
  }
  // the FX root died with the arena (or the transient sweep took it): drop refs
  function fxAlive() { return FX && FX.scar && FX.scar.parent; }

  function addScar(x, z, r) {
    if (!fxAlive() || FX.scarUsed >= MAXSCAR) return;
    dummy.position.set(x, ground(x, z) + 0.06, z);
    dummy.rotation.set(0, jit() * 6.28, 0);
    dummy.scale.set(r, 1, r);
    dummy.updateMatrix();
    FX.scar.setMatrixAt(FX.scarUsed++, dummy.matrix);
    FX.scar.count = FX.scarUsed;
    FX.scar.instanceMatrix.needsUpdate = true;
    stats.scarM2 += Math.PI * r * r;
  }

  function spawnSmoke(x, y, z, surface, dense) {
    if (!fxAlive() || !FX.sFree.length) return;
    const i = FX.sFree.pop();
    const drift = F.wspd * (surface ? 0.75 : 0.5);
    // a persistent crosswind component per puff: the drawn corridor has to
    // WIDEN downwind the way the analytic damage Gaussian does, or a person
    // choking on σ=15 m smoke stands in visibly clear air (storyboard pass 8)
    const cw = (jit() - 0.5) * (surface ? 3.2 : 1.6);
    FX.spuff[i] = {
      x: x + (jit() - 0.5) * 1.6, y, z: z + (jit() - 0.5) * 1.6,
      vx: F.wx * drift * (0.4 + jit() * 0.4), vz: F.wz * drift * (0.4 + jit() * 0.4),
      vy: surface ? 0.15 + jit() * 0.25 : 3.2 + jit() * 2.8, cw,
      age: 0, life: surface ? 9 + jit() * 5 : 5 + jit() * 3.5,
      surface, dense: !!dense, dark: dense ? 0.75 + jit() * 0.25 : 0.5 + jit() * 0.3,
    };
  }
  function spawnEmber(x, y, z, vx, vy, vz, life) {
    if (!fxAlive() || !FX.eFree.length) return;
    const i = FX.eFree.pop();
    FX.epuff[i] = { x, y, z, vx, vy, vz, age: 0, life };
  }

  /* ---- trees ------------------------------------------------------------ */
  function canopyY(t) { return t.foliage ? t.foliage.position.y : ground(t.x, t.z) + 3.5; }

  function prepTrees(A) {
    const tr = A.flammable || [];
    for (let i = 0; i < tr.length; i++) {
      const t = tr[i];
      t._wfHeat = 0; t._wfFuel = 0;
      // undo a previous run's charring mutations (colours are the arena
      // reset's job; the consumed-canopy scale is ours)
      if (t._wfCharred) {
        if (t.foliage) t.foliage.scale.set(1, 1, 1);
        t._wfCharred = false;
      }
    }
    return tr;
  }

  // wrap arena.reset ONCE so a between-matches regrow also undoes what this
  // module did to the trees and lets the transient sweep take the scar
  function wrapReset(A) {
    if (A._wfResetWrapped) return;
    A._wfResetWrapped = true;
    const orig = A.reset;
    A.reset = function () {
      const tr = A.flammable || [];
      for (let i = 0; i < tr.length; i++) {
        const t = tr[i];
        if (t.foliage) { t.foliage.scale.set(1, 1, 1); if (t.foliage.material && t.foliage.material.emissive) { t.foliage.material.emissive.setHex(0x000000); t.foliage.material.emissiveIntensity = 1; } }
        t._wfHeat = 0; t._wfFuel = 0; t._wfCharred = false;
      }
      hardStop();          // FX meshes are transient; the sweep in orig() will take them
      FX = null;
      return orig.apply(A, arguments);
    };
  }

  function igniteTree(t, why) {
    if (t.burnt || t.burning) return;
    t._wfFuel = 5.5 + rnd() * 2.5;             // a torching crown holds for a while
    t.burning = t._wfFuel;                     // the SAME live field every other def reads
    t._wfHeat = 1;
    stats.ignitions++;
    if (why === "spot") stats.spotFires++;
    if (t.foliage && t.foliage.material) {
      // Fuel is dark behind fire. Painting the canopy orange turned every
      // burning crown into a luminous cube; the shader tongues own the light.
      const v3 = CBZ.CONFIG.WILDFIRE_RENDER_V3 !== false;
      // Kill the diffuse almost entirely: whatever the sun does to a lit box
      // is exactly the `slab` look we are trying to lose. The crown's colour
      // is EMISSIVE, which Lambert adds flat across every face, so a torching
      // canopy glows evenly from within instead of showing a shaded top.
      t.foliage.material.color.setHex(v3 ? 0x0c0705 : 0xc23c0c);
      if (t.foliage.material.emissive) {
        t.foliage.material.emissive.setHex(v3 ? 0x5a1c04 : 0xff3808);
        t.foliage.material.emissiveIntensity = v3 ? 0.40 : 0.5;
      }
    }
    addScar(t.x, t.z, 1.6 + rnd() * 0.8);
    if (CBZ.sfxAt) CBZ.sfxAt("fire", t.x, t.z); else if (CBZ.sfx) CBZ.sfx("fire");
  }

  function charTree(t) {
    t.burning = 0; t.burnt = true; t._wfCharred = true;
    if (t.foliage) {
      if (t.foliage.material) { t.foliage.material.color.setHex(0x181008); if (t.foliage.material.emissive) { t.foliage.material.emissive.setHex(0x000000); } }
      // almost all crown fuel is gone — a charred clump on a bare trunk, but
      // still a clump, not a pancake stuck to the top of the stick.
      const v3burnt = CBZ.CONFIG.WILDFIRE_RENDER_V3 !== false;
      t.foliage.scale.set(v3burnt ? 0.34 : 0.72, v3burnt ? 0.28 : 0.5, v3burnt ? 0.34 : 0.72);
    }
    if (t.trunk && t.trunk.material) t.trunk.material.color.setHex(0x140d08);
    // the ground under it stays black — and PATCHY, the way a burn actually
    // reads from the air: a main scar wider than the crown that peeks out
    // from under the skeleton, plus satellite patches where the litter took,
    // so neighbouring burnt trees knit into one connected black field
    addScar(t.x, t.z, 4.6 + rnd() * 1.4);
    for (let k = 0; k < 2; k++) {
      const a = rnd() * 6.28, r2 = 3 + rnd() * 4;
      addScar(t.x + Math.cos(a) * r2 + F.wx * 2, t.z + Math.sin(a) * r2 + F.wz * 2, 2 + rnd() * 1.6);
    }
    if (CBZ.fx) CBZ.fx.dropDebris({ x: t.x, z: t.z, fromY: ground(t.x, t.z) + 3, vy: 2, size: 0.5, color: 0x2a2622, linger: 0.6 });
  }

  /* ---- the smoke field --------------------------------------------------
     One analytic plume per burning tree: a downwind corridor, Gaussian in
     crosswind, that widens as it travels. Summed, clamped. This is what the
     choke damage, the bot threat and the player's fog all read — the drawn
     puffs are the same field's portrait, not a second model. */
  function plumeLen() { return PLUME_BASE + F.wspd * 2.2; }
  function smokeAt(x, z) {
    const B = F.burningList;
    if (!B.length) return 0;
    const L = plumeLen();
    let s = 0;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      const rx = x - b.x, rz = z - b.z;
      const down = rx * F.wx + rz * F.wz;
      if (down < -4 || down > L) continue;
      const cross = Math.abs(rz * F.wx - rx * F.wz);
      const sig = 3.5 + down * 0.38;
      if (cross > sig * 3) continue;
      // a fresh torch has not MADE its plume yet — weight by the same burn
      // phase the drawn smoke scales with, so the choke field and the smoke
      // a player can actually see never disagree about where the danger is
      const ph = b._wfPh != null ? b._wfPh : 1;
      const amp = (down < 0 ? 1 + down / 4 : 1 - 0.78 * (down / L)) * (0.3 + 0.7 * ph);
      s += amp * Math.exp(-(cross * cross) / (2 * sig * sig));
      if (s > 3) return 3;
    }
    return s;
  }

  /* ---- lifecycle -------------------------------------------------------- */
  function beginWarn(ctx) {
    const A = ctx.arena;
    F.arena = A; F.live = true; F.t = 0; F.intensity = ctx.intensity || 0;
    F.spreadCd = 0; F.spotCd = 2.4; F.smokeLinger = 0;
    F.spots.length = 0; F.smoulders.length = 0; F.burningList.length = 0;
    zeroStats();
    buildFX(A.root); wrapReset(A);
    // NOTE the scar mesh is NOT reset here: black ground earned by an earlier
    // fire in this same match stays black — only the arena's own between-match
    // reset (which regrows the trees too) takes it away.
    const tr = prepTrees(A);

    // the WEATHER owns a bearing already? adopt it; else draw one. Either way
    // this module's wind IS the wind the def hands to weatherDrive.
    const w = CBZ.weatherWind ? CBZ.weatherWind() : null;
    if (w && w.speed > 0.5) { F.wx = w.x; F.wz = w.z; } else { const a = rnd() * 6.28; F.wx = Math.cos(a); F.wz = Math.sin(a); }
    F.wspd = 9 + 4 * F.intensity;
    F.veer = (rnd() - 0.5) * 0.05;             // slow drift so the run bends a little

    /* THE SEED IS UPWIND. A random tree wastes the event half the time (a
       downwind-edge seed has no fuel to run into and the fire dies at the
       beach). Real ignitions become the fire you remember when the wind has
       the whole fuel bed in front of them, so: pick among the most-upwind
       standing trees, and the run gets the island to cross. */
    const cx = A.center.x, cz = A.center.z;
    const cands = tr.filter((t) => !t.burnt);
    cands.sort((a, b) => ((a.x - cx) * F.wx + (a.z - cz) * F.wz) - ((b.x - cx) * F.wx + (b.z - cz) * F.wz));
    F.seed = cands.length ? cands[(rnd() * Math.min(6, cands.length)) | 0] : null;
    if (F.seed) {
      igniteTree(F.seed, "seed");
      // the seed torches through the WHOLE warn phase — its smoke column is
      // the telegraph, so it must still be alight when the run starts
      F.seed._wfFuel += 5.5; F.seed.burning = F.seed._wfFuel;
    }
  }

  function begin(ctx) {
    // the fire GROWS out of the warn-phase seed: kick its two best downwind
    // neighbours to near-ignition so the run is visibly moving at t=0
    F.intensity = ctx.intensity || F.intensity;
    const tr = (F.arena && F.arena.flammable) || [];
    const s = F.seed;
    if (s) {
      const near = tr.filter((t) => t !== s && !t.burning && !t.burnt &&
        Math.hypot(t.x - s.x, t.z - s.z) < REACH * 1.2);
      near.sort((a, b) => {
        const da = Math.hypot(a.x - s.x, a.z - s.z), db = Math.hypot(b.x - s.x, b.z - s.z);
        const wa = ((a.x - s.x) * F.wx + (a.z - s.z) * F.wz) / (da || 1);
        const wb = ((b.x - s.x) * F.wx + (b.z - s.z) * F.wz) / (db || 1);
        return (db * (1 - wb * 0.7)) - (da * (1 - wa * 0.7));
      });
      for (let i = 0; i < Math.min(2, near.length); i++) near[i]._wfHeat = Math.max(near[i]._wfHeat || 0, 0.8);
    }
    if (!tr.some((t) => t.burning) && tr.length) igniteTree(tr[(rnd() * tr.length) | 0], "seed");
  }

  /* the fire's own frame — called from the def during warn and active.
     `warn` true = the telegraph phase: ONE tree torches and its column
     stands up; its neighbours DRY (visibly, green → ochre) but do not catch,
     and no embers loft. The run belongs to the active phase. */
  function tick(dt, ctx, warn) {
    if (!F.live || !F.arena) return;
    F.intensity = (ctx && ctx.intensity != null) ? ctx.intensity : F.intensity;
    const tr = F.arena.flammable || [];

    // the wind veers slowly; the def re-feeds it to weatherDrive every frame
    const ang = Math.atan2(F.wz, F.wx) + F.veer * dt;
    F.wx = Math.cos(ang); F.wz = Math.sin(ang);

    // cache the burning set once per frame — every field below reads it
    const B = F.burningList; B.length = 0;
    for (let i = 0; i < tr.length; i++) if (tr[i].burning > 0) B.push(tr[i]);

    // ---- burn down + torch visuals + flame contact ----
    for (let i = 0; i < B.length; i++) {
      const t = B[i];
      t.burning -= dt;
      const age = t._wfFuel - t.burning;
      const ph = Math.min(1, age / 1.1) * Math.min(1, Math.max(0, t.burning) / 1.6);   // ramp up, die down
      t._wfPh = ph;
      // flame contact: severe, local — the def's own default cause applies
      hurtActorsNear(t.x, t.z, 2.2 + 1.6 * ph, (16 + 18 * F.intensity) * ph * dt, "burned alive in the wildfire", true);
      // emit: a column off the crown + surface smoke + embers. A LONE torching
      // tree pours its whole budget into ONE standing column — that is the
      // warn-phase telegraph — while a broad front shares the pool out.
      const y = canopyY(t) + 1.2;
      const rate = (6 + 20 / B.length) * ph * dt;
      if (jit() < rate) spawnSmoke(t.x, y, t.z, false, true);
      // surface smoke is MOST of what a person in the corridor experiences,
      // so it gets most of the budget — two draws a frame, long lives
      if (jit() < rate * 1.6) spawnSmoke(t.x, ground(t.x, t.z) + 1.2, t.z, true, true);
      if (jit() < rate * 0.8) spawnSmoke(t.x + F.wx * 6, ground(t.x, t.z) + 1.6, t.z + F.wz * 6, true, false);
      if (jit() < 9 * ph * dt) spawnEmber(t.x + (jit() - 0.5) * 2, y - 1 + jit() * 2, t.z + (jit() - 0.5) * 2,
        (jit() - 0.5) * 2 + F.wx * F.wspd * 0.3, 2 + jit() * 3, (jit() - 0.5) * 2 + F.wz * F.wspd * 0.3, 0.7 + jit());
      if (t.burning <= 0) { charTree(t); B.splice(i, 1); i--; }
    }

    // ---- SPREAD: heat integration, elliptical about the wind, uphill-fast --
    F.spreadCd -= dt;
    if (F.spreadCd <= 0 && B.length) {
      const step = 0.35;
      F.spreadCd = step;
      const gain = 1.8 * (0.8 + 0.5 * F.intensity);
      for (let i = 0; i < B.length; i++) {
        const b = B[i]; if (b._wfPh != null && b._wfPh < 0.25) continue;   // a just-lit tree isn't radiating yet
        const gy = ground(b.x, b.z);
        for (let j = 0; j < tr.length; j++) {
          const o = tr[j]; if (o.burning || o.burnt) continue;
          const dx = o.x - b.x, dz = o.z - b.z;
          const d = Math.hypot(dx, dz);
          if (d > REACH || d < 0.01) continue;
          const align = (dx * F.wx + dz * F.wz) / d;
          // head fire >> flanks >> heel: the head races, the flanks WORK —
          // a front that dies the moment its downwind lane is spent is a
          // fuse, not a fire
          const wind = 0.5 + 1.5 * Math.pow(Math.max(0, align), 1.5) * (0.6 + F.wspd / 22);
          // uphill doubles per ~3 m rise at these tree spacings (the 10° rule, arena-scaled)
          // uphill doubles per ~3 m rise (the 10° rule, arena-scaled);
          // downhill only MODERATES — a fire cresting a ridge does not stop,
          // it walks down the far side (the -6 clamp here once killed the
          // whole event at the mountain top)
          const rise = ground(o.x, o.z) - gy;
          const slope = Math.pow(2, Math.max(-2.5, Math.min(9, rise)) / 3);
          // LINEAR falloff: the arena's trees stand 12-22 m apart, and a
          // quadratic here made every flank neighbour an 18-second reach —
          // the fire became a fuse that died the moment its head lane ended
          const near = 1 - d / REACH;
          o._wfHeat = (o._wfHeat || 0) + step * (warn ? gain * 0.3 : gain) * wind * slope * near * (0.85 + rnd() * 0.3);
          if (warn && o._wfHeat > 0.95) o._wfHeat = 0.95;   // drying, not catching — yet
          if (o._wfHeat >= 1) igniteTree(o, "front");
          else if (o._wfHeat > 0.15 && o.foliage && o.foliage.material) {
            // the fuel DRIES on camera: green → ochre as the front closes in
            const u = Math.min(1, o._wfHeat);
            o.foliage.material.color.setRGB(
              0.25 + 0.36 * u, 0.60 - 0.20 * u, 0.31 - 0.16 * u);
          }
        }
      }
    }

    // ---- SPOTTING: lofted embers start fires ahead of the front ----------
    F.spotCd -= dt;
    if (F.spotCd <= 0 && B.length && !warn) {
      F.spotCd = (B.length >= 6 ? 1.1 : 2.0) - 0.6 * F.intensity + rnd() * 0.8;
      if (F.spots.length < 4) {
        const src = B[(rnd() * B.length) | 0];
        const D = SPOT_MIN + rnd() * SPOT_SPAN;
        const cross = (rnd() - 0.5) * 14;
        let lx = src.x + F.wx * D - F.wz * cross;
        let lz = src.z + F.wz * D + F.wx * cross;
        // keep the landing on the island, not in the surf
        const A = F.arena, ox = lx - A.center.x, oz = lz - A.center.z, od = Math.hypot(ox, oz);
        if (od > A.radius - 8) { lx = A.center.x + ox / od * (A.radius - 8); lz = A.center.z + oz / od * (A.radius - 8); }
        // most real embers die in the open; the ones history remembers are
        // the ones that landed IN FUEL. Model that survivor bias directly:
        // usually snap the landing to the nearest unburnt tree in range so a
        // spot fire is what this mechanism reliably produces
        if (rnd() < 0.75) {
          let bt = null, bd2 = 18;
          for (let j = 0; j < tr.length; j++) {
            const t2 = tr[j]; if (t2.burning || t2.burnt) continue;
            const dd = Math.hypot(t2.x - lx, t2.z - lz);
            if (dd < bd2) { bd2 = dd; bt = t2; }
          }
          if (bt) { lx = bt.x + (rnd() - 0.5) * 2; lz = bt.z + (rnd() - 0.5) * 2; }
        }
        const dist = Math.hypot(lx - src.x, lz - src.z);
        F.spots.push({
          sx: src.x, sy: canopyY(src) + 1.5, sz: src.z, lx, lz, dist,
          u: 0, T: 0.9 + dist / 26, arc: 4 + dist * 0.14,
        });
        stats.spotLaunched++;
      }
    }
    for (let i = F.spots.length - 1; i >= 0; i--) {
      const p = F.spots[i];
      p.u += dt / p.T;
      const u = Math.min(1, p.u);
      const x = p.sx + (p.lx - p.sx) * u, z = p.sz + (p.lz - p.sz) * u;
      const gy = ground(x, z);
      const y = p.sy + (gy + 0.3 - p.sy) * u + Math.sin(Math.PI * u) * p.arc;
      // the ember IS its trail: it re-lights its path every frame
      spawnEmber(x, y, z, (jit() - 0.5), 0.5, (jit() - 0.5), 0.35);
      if (p.u >= 1) {
        F.spots.splice(i, 1);
        F.smoulders.push({ x: p.lx, z: p.lz, t: 0.9 + rnd() * 0.8, dist: p.dist });
      }
    }
    for (let i = F.smoulders.length - 1; i >= 0; i--) {
      const m = F.smoulders[i];
      m.t -= dt;
      if (jit() < 5 * dt) spawnEmber(m.x + (jit() - 0.5), ground(m.x, m.z) + 0.3, m.z + (jit() - 0.5), 0, 0.8, 0, 0.4);
      if (jit() < 2.5 * dt) spawnSmoke(m.x, ground(m.x, m.z) + 0.8, m.z, true, false);
      if (m.t > 0) continue;
      F.smoulders.splice(i, 1);
      // did it take? the fuel decides: an unburnt tree close enough catches
      let best = null, bd = 8;
      for (let j = 0; j < tr.length; j++) {
        const t2 = tr[j]; if (t2.burning || t2.burnt) continue;
        const d = Math.hypot(t2.x - m.x, t2.z - m.z);
        if (d < bd) { bd = d; best = t2; }
      }
      if (best) {
        igniteTree(best, "spot");
        if (m.dist > stats.spotMaxM) stats.spotMaxM = Math.round(m.dist);
      } else addScar(m.x, m.z, 0.8 + rnd() * 0.5);   // fizzled — but it still marks the ground
    }

    // ---- THE CHOKE: the plume hurts everyone inside the corridor ----------
    chokeTick(dt);
  }

  function hurtActorsNear(x, z, r, dmg, cause, flame) {
    if (!surv() || dmg <= 0) return;
    const r2 = r * r;
    surv().forEachActor(function (a) {
      const dx = a.pos.x - x, dz = a.pos.z - z;
      if (dx * dx + dz * dz > r2) return;
      const deadBefore = a.isPlayer ? CBZ.player.dead : a.dead;
      surv().hurt(a, dmg, { cause });
      const deadAfter = a.isPlayer ? CBZ.player.dead : a.dead;
      if (flame) stats.flameDamage += dmg; else stats.smokeDamage += dmg;
      if (!deadBefore && deadAfter) { if (flame) stats.flameDeaths++; else stats.smokeDeaths++; }
    });
  }

  function chokeTick(dt) {
    if (!surv() || !F.burningList.length) return;
    const inten = 0.8 + 0.4 * F.intensity;
    surv().forEachActor(function (a) {
      const s = smokeAt(a.pos.x, a.pos.z);
      if (s < 0.25) return;
      // a roof helps for a while (smoke gets in, slower); the open plume does
      // not. DEEP smoke — several plumes overlapped — kills in seconds, the
      // corridor's edge only wears you down: crossing out fast survives,
      // dithering inside does not, which is exactly the decision the event
      // is supposed to pose.
      const shel = sheltered(a) ? 0.35 : 1;
      const dmg = 9 * Math.min(2, s) * shel * inten * dt;
      const deadBefore = a.isPlayer ? CBZ.player.dead : a.dead;
      surv().hurt(a, dmg, { cause: "suffocated in the wildfire smoke" });
      stats.smokeDamage += dmg;
      const deadAfter = a.isPlayer ? CBZ.player.dead : a.dead;
      if (!deadBefore && deadAfter) stats.smokeDeaths++;
    });
  }
  function sheltered(a) {
    if (CBZ.CONFIG.SURV_PHYSICAL_SHELTER === false) return false;
    const plats = CBZ.platforms; if (!plats) return false;
    const head = a.pos.y + 2.1;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p.top > head && a.pos.x >= p.minX && a.pos.x <= p.maxX && a.pos.z >= p.minZ && a.pos.z <= p.maxZ) return true;
    }
    return false;
  }

  /* ---- the drawn frame: flames/glow matrices + particle advection --------
     Registered as its own updater so the smoke can OUTLIVE the def (a plume
     does not switch off with the director's timer) and so the flames flicker
     during the warn phase, which the def only ticks at warnTick cadence. */
  function fxTick(dt) {
    if (!fxAlive()) return;
    F.t += dt;
    const B = F.burningList;
    const pointScale = Math.max(1, ((CBZ.renderer && CBZ.renderer.domElement && CBZ.renderer.domElement.height) || 640) * 0.5);
    if (FX.renderV3) {
      FX.flame.material.uniforms.uTime.value = F.t;
      FX.flame.material.uniforms.uScale.value = pointScale;
      FX.flame.material.uniforms.uWind.value.set(F.wx, F.wz);
      FX.smoke.material.uniforms.uTime.value = F.t;
      FX.smoke.material.uniforms.uScale.value = pointScale;
      FX.smoke.material.uniforms.uWind.value.set(F.wx, F.wz);
      FX.embers.material.uniforms.uScale.value = pointScale;
    }

    // Flames WRAP THE CROWN. V3 writes three soft GPU tongues into ONE point
    // buffer; the revert road writes the old three cone instance buffers.
    const n = Math.min(MAXFLAME, B.length);
    if (FX.renderV3) {
      const fg = FX.flame.geometry;
      const fp = fg.attributes.position.array;
      const fs = fg.attributes.aSize.array;
      const fa = fg.attributes.aAlpha.array;
      const fseed = fg.attributes.aSeed.array;
      // A RING around the trunk, not a line across it. Three tongues on one
      // axis all hid behind the crown from half the compass; spaced 120° apart
      // one is always on the camera's side, so the box reads as fuel INSIDE
      // the fire rather than a box with fire behind it.
      // `rad` is a FRACTION of the crown's own half-width, not metres. The
      // canopy shrinks as its fuel goes, so a fixed radius walked the outer
      // tongues off the tree and left them burning in mid-air.
      const spec = [
        { size: 7.2, rad: 0.0, down: 0.0 },
        { size: 5.8, rad: 0.85, down: 0.25 },
        { size: 4.6, rad: 0.85, down: 0.55 },
      ];
      for (let i = 0; i < n; i++) {
        const t = B[i];
        const ph = t._wfPh != null ? t._wfPh : 1;
        if (t.foliage) {
          // Shrink the canopy UNIFORMLY as its fuel goes. Squashing Y harder
          // than XZ turned a consumed crown into a wide flat slab; starting at
          // 1.0 also removes the pop the old 0.80 first frame put on ignition.
          const fuel = Math.max(0, Math.min(1, t.burning / Math.max(0.01, t._wfFuel)));
          const sc = 0.55 + fuel * 0.45;
          t.foliage.scale.set(sc, sc, sc);
        }
        const crownBase = (t.foliage ? t.foliage.position.y - 1.4 : ground(t.x, t.z) + 2);
        const ring = t.x * 0.7 + t.z * 1.3;   // stable per-tree ring orientation
        const gp = t.foliage && t.foliage.geometry && t.foliage.geometry.parameters;
        const crownR = gp ? (gp.width * t.foliage.scale.x) / 2 : 1.2;
        for (let k = 0; k < 3; k++) {
          const j = i * 3 + k, s0 = spec[k];
          const flicker = 0.9 + 0.1 * Math.sin(F.t * (9 + k * 1.7) + t.x * 0.31 + t.z * 0.17);
          const size = s0.size * (0.55 + 0.45 * ph) * flicker;
          const a = ring + k * 2.0944;
          fp[j * 3] = t.x + Math.cos(a) * s0.rad * crownR + F.wx * s0.down;
          fp[j * 3 + 1] = crownBase + size * 0.43 + k * 0.18;
          fp[j * 3 + 2] = t.z + Math.sin(a) * s0.rad * crownR + F.wz * s0.down;
          fs[j] = size;
          fa[j] = Math.min(1, ph * 1.8) * (0.70 + k * 0.04);
          fseed[j] = ((t.x * 0.013 + t.z * 0.017 + k * 0.271) % 1 + 1) % 1;
        }
      }
      fg.setDrawRange(0, n * 3);
      fg.attributes.position.needsUpdate = true;
      fg.attributes.aSize.needsUpdate = true;
      fg.attributes.aAlpha.needsUpdate = true;
      fg.attributes.aSeed.needsUpdate = true;
    } else {
      const L = FX.flames;
      const layerSpec = [
        { s: 2.6, y: -0.8 }, { s: 1.8, y: 0.6 }, { s: 1.0, y: 2.0 },
      ];
      for (let k = 0; k < 3; k++) {
        const mesh = L[k], spec = layerSpec[k];
        for (let i = 0; i < n; i++) {
          const t = B[i];
          const ph = t._wfPh != null ? t._wfPh : 1;
          const crownBase = (t.foliage ? t.foliage.position.y - 1.3 : ground(t.x, t.z) + 2);
          const f = (0.75 + 0.35 * Math.sin(F.t * 12 + t.x + k * 2.1)) * (0.35 + 0.75 * ph);
          dummy.position.set(t.x, crownBase + spec.y, t.z);
          dummy.rotation.set(0, F.t * (0.6 + k * 0.3) + t.z, 0);
          dummy.scale.set(spec.s * (1 + 0.12 * Math.sin(F.t * 17 + k)), spec.s * f, spec.s * (1 + 0.12 * Math.cos(F.t * 15 + k)));
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (let i = 0; i < n; i++) {
      const t = B[i];
      const ph = t._wfPh != null ? t._wfPh : 1;
      const pulse = (3.4 + 0.9 * Math.sin(F.t * 9 + t.x)) * (0.5 + 0.5 * ph);
      dummy.position.set(t.x, ground(t.x, t.z) + 0.08, t.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(pulse, 1, pulse);
      dummy.updateMatrix();
      FX.glow.setMatrixAt(i, dummy.matrix);
    }
    FX.glow.count = n;
    FX.glow.instanceMatrix.needsUpdate = true;

    // smoke: rise, bend downwind, lighten, die
    const sp = FX.smoke.geometry.attributes.position.array;
    const smokeColor = FX.renderV3 ? FX.smoke.geometry.attributes.aColor : FX.smoke.geometry.attributes.color;
    const sc = smokeColor.array;
    const ss = FX.renderV3 ? FX.smoke.geometry.attributes.aSize.array : null;
    const sa = FX.renderV3 ? FX.smoke.geometry.attributes.aAlpha.array : null;
    const ssurf = FX.renderV3 ? FX.smoke.geometry.attributes.aSurface.array : null;
    const shot = FX.renderV3 ? FX.smoke.geometry.attributes.aHot.array : null;
    for (let i = 0; i < MAXSMOKE; i++) {
      const p = FX.spuff[i]; if (!p) continue;
      p.age += dt;
      if (p.age >= p.life) {
        FX.spuff[i] = null; FX.sFree.push(i);
        sp[i * 3] = -9999; sp[i * 3 + 1] = -9999; sp[i * 3 + 2] = -9999;
        if (FX.renderV3) { ss[i] = 0; sa[i] = 0; shot[i] = 0; }
        continue;
      }
      const u = p.age / p.life;
      // the column STANDS first and bends over as it climbs — young smoke
      // rises nearly straight, the wind takes it progressively
      const grip = p.surface ? 1 : Math.min(1, p.age / 2.2);
      const drift = F.wspd * (p.surface ? 0.75 : 0.55) * grip;
      const cw = p.cw || 0;
      p.vx += ((F.wx * drift - F.wz * cw) - p.vx) * 0.6 * dt;
      p.vz += ((F.wz * drift + F.wx * cw) - p.vz) * 0.6 * dt;
      // surface smoke HUGS the ground — it is the corridor you choke in, not
      // a second sky layer (an earlier draft let it climb 0.5 m/s and the
      // whole ground corridor floated out of every street-level frame);
      // the convective columns bend over and slow their climb instead
      if (p.surface) p.vy += (0.03 - p.vy) * 0.4 * dt;
      else p.vy += (0.7 - p.vy) * 0.26 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      // surface smoke flows ALONG the terrain: a corridor running uphill was
      // advecting its puffs straight into the hillside, which is why a person
      // at choke 2.7 could stand in visibly clear air (storyboard pass 10)
      if (p.surface) {
        const g0 = ground(p.x, p.z);
        if (p.y < g0 + 0.9) p.y = g0 + 0.9;
        else if (p.y > g0 + 3.4) p.y = g0 + 3.4;
      }
      sp[i * 3] = p.x; sp[i * 3 + 1] = p.y; sp[i * 3 + 2] = p.z;
      // dark and tight young → paler, thinner old (the fade a single-opacity
      // Points material cannot do is faked in the colour ramp) — but it stays
      // SMOKE-dark; a puff must never read as a white pane
      const g = 0.09 + 0.06 * (1 - p.dark) + 0.26 * u;
      sc[i * 3] = g * 1.12; sc[i * 3 + 1] = g * 0.98; sc[i * 3 + 2] = g * 0.84;
      if (FX.renderV3) {
        const fadeIn = Math.min(1, u / 0.08);
        const fadeOut = u < 0.58 ? 1 : Math.max(0, (1 - u) / 0.42);
        const base = p.surface ? 5.2 : 4.1;
        ss[i] = base * (0.74 + u * (p.surface ? 1.0 : 1.2)) * (0.93 + 0.09 * Math.sin(i * 1.7));
        sa[i] = (p.surface ? 0.22 : 0.28) * fadeIn * fadeOut * (0.75 + p.dark * 0.25);
        ssurf[i] = p.surface ? 1 : 0;
        shot[i] = (p.dense ? 1 : 0.35) * Math.max(0, 1 - u * 2.4);
      }
    }
    FX.smoke.geometry.attributes.position.needsUpdate = true;
    smokeColor.needsUpdate = true;
    if (FX.renderV3) {
      FX.smoke.geometry.attributes.aSize.needsUpdate = true;
      FX.smoke.geometry.attributes.aAlpha.needsUpdate = true;
      FX.smoke.geometry.attributes.aSurface.needsUpdate = true;
      FX.smoke.geometry.attributes.aHot.needsUpdate = true;
    }

    const ep = FX.embers.geometry.attributes.position.array;
    const ea = FX.renderV3 ? FX.embers.geometry.attributes.aAlpha.array : null;
    for (let i = 0; i < MAXEMBER; i++) {
      const p = FX.epuff[i]; if (!p) continue;
      p.age += dt;
      if (p.age >= p.life) {
        FX.epuff[i] = null; FX.eFree.push(i);
        ep[i * 3] = -9999; ep[i * 3 + 1] = -9999; ep[i * 3 + 2] = -9999;
        if (FX.renderV3) ea[i] = 0;
        continue;
      }
      p.vy -= 1.2 * dt;                      // embers arc over and fall
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      ep[i * 3] = p.x; ep[i * 3 + 1] = p.y; ep[i * 3 + 2] = p.z;
      if (FX.renderV3) ea[i] = Math.max(0, 1 - p.age / p.life);
    }
    FX.embers.geometry.attributes.position.needsUpdate = true;
    if (FX.renderV3) FX.embers.geometry.attributes.aAlpha.needsUpdate = true;

    // after stop(): the plume thins out instead of blinking off
    if (!F.live && F.smokeLinger > 0) F.smokeLinger -= dt;
  }

  CBZ.onUpdate(27.7, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "survival") { if (FX) { disposeFX(); F.live = false; } return; }
    // pools are built the first frame an ARENA exists, not at fire time —
    // quake.js's law: a hitch (buffer allocation, shader compile) when the
    // sirens start is a tell, so pay it during boot instead
    if (FX && !fxAlive()) { disposeFX(); }     // the arena rebuilt under us
    if (!FX && CBZ.CONFIG.WILDFIRE_V2 !== false) {
      const A = CBZ.surv && CBZ.surv.arena;
      if (A && A.root) { buildFX(A.root); wrapReset(A); }
    }
    if (!FX) return;
    fxTick(dt);
  });
  if (CBZ.bootComplete && CBZ.updaters && CBZ.updaters.sort) {
    CBZ.updaters.sort(function (a, b) { return a.order - b.order; });
  }

  /* ---- end of the event -------------------------------------------------
     The director's timer starves the fire, it does not un-burn the island:
     still-torching trees char out, the flames stop, the plume drifts off
     over the next seconds — and the scar mesh and every charred tree STAY. */
  function stop() {
    F.live = false;
    F.smokeLinger = 8;
    const tr = (F.arena && F.arena.flammable) || [];
    for (let i = 0; i < tr.length; i++) {
      const t = tr[i];
      if (t.burning > 0) charTree(t);
      else if (!t.burnt && t._wfHeat > 0.15 && t.foliage && t.foliage.material) {
        // singed but standing: the browned edge of the burn is part of the scar
        t._wfHeat = 0;
      }
    }
    F.burningList.length = 0;
    F.spots.length = 0; F.smoulders.length = 0;
    if (fxAlive()) {
      FX.flames.forEach((m) => { m.count = 0; });
      if (FX.flame) FX.flame.geometry.setDrawRange(0, 0);
      FX.glow.count = 0;
    }
  }
  function hardStop() {
    F.live = false; F.burningList.length = 0; F.spots.length = 0; F.smoulders.length = 0;
    F.seed = null;
  }

  /* ---- bot / threat surface --------------------------------------------- */
  function threat(x, z) {
    let t = 0;
    const B = F.burningList;
    for (let i = 0; i < B.length; i++) {
      const d = Math.hypot(x - B[i].x, z - B[i].z);
      if (d < 10) t = Math.max(t, 1 - d / 10);
    }
    const s = smokeAt(x, z);
    if (s > 0.3) t = Math.max(t, Math.min(1, 0.25 + 0.45 * s));
    return t;
  }
  /* ACROSS THE WIND. Downwind of the fire you cannot outrun the head fire
     plus its spotting — the survivable move is out the flank of the plume
     corridor. Upwind of it, plain distance is honest and kept. */
  function safeDir(x, z) {
    const B = F.burningList;
    if (!B.length) return null;
    let cx = 0, cz = 0, nd = 1e9, nx = 0, nz = 0;
    for (let i = 0; i < B.length; i++) {
      cx += B[i].x; cz += B[i].z;
      const d = Math.hypot(x - B[i].x, z - B[i].z);
      if (d < nd) { nd = d; nx = B[i].x; nz = B[i].z; }
    }
    cx /= B.length; cz /= B.length;
    if (nd > 90 && smokeAt(x, z) < 0.3) return null;
    let ax = x - nx, az = z - nz;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const down = (x - cx) * F.wx + (z - cz) * F.wz;
    if (down > -4) {
      // in (or entering) the corridor: flank out of it, with a touch of away
      let px = -F.wz, pz = F.wx;
      if (px * ax + pz * az < 0) { px = F.wz; pz = -F.wx; }
      const vx = px + ax * 0.45, vz = pz + az * 0.45;
      const vl = Math.hypot(vx, vz) || 1;
      return { x: vx / vl, z: vz / vl };
    }
    return { x: ax, z: az };
  }

  /* ---- audit ------------------------------------------------------------
     Live-measured on BOTH paths (the legacy fire mutates the same tree
     records), so a before/after table compares one vocabulary. */
  CBZ.wildfireAudit = function () {
    const A = CBZ.surv && CBZ.surv.arena;
    const tr = (A && A.flammable) || [];
    let burning = 0, burnt = 0;
    let ccx = 0, ccz = 0;
    for (let i = 0; i < tr.length; i++) {
      if (tr[i].burning > 0) { burning++; ccx += tr[i].x; ccz += tr[i].z; }
      if (tr[i].burnt) burnt++;
    }
    // how far the fire has RUN from its origin, and its wind-alignment
    let runM = 0, runDownM = 0, runUpM = 0;
    const s0 = F.seed;
    if (s0) {
      for (let i = 0; i < tr.length; i++) {
        const t = tr[i];
        if (!t.burnt && !(t.burning > 0)) continue;
        const dx = t.x - s0.x, dz = t.z - s0.z;
        const d = Math.hypot(dx, dz);
        if (d > runM) runM = d;
        const down = dx * F.wx + dz * F.wz;
        if (down > runDownM) runDownM = down;
        if (-down > runUpM) runUpM = -down;
      }
    }
    // the escape the bots are actually told: probe 28 m downwind of the
    // burning centroid, angle between fleeVector and the wind. ~90° is the
    // crosswind lesson; ~0° is "run straight downwind", i.e. the old advice.
    // Measured against the WEATHER's live wind so the number is honest on
    // the legacy path too (whose bearing lives in the def's ctx, not here).
    let escapeAngleDeg = null;
    let wxx = F.wx, wzz = F.wz;
    const ww = CBZ.weatherWind ? CBZ.weatherWind() : null;
    if (ww && ww.speed > 0.5) { const m = Math.hypot(ww.x, ww.z) || 1; wxx = ww.x / m; wzz = ww.z / m; }
    if (burning > 0 && CBZ.disasters && CBZ.disasters.fleeVector) {
      const px = ccx / burning + wxx * 28, pz = ccz / burning + wzz * 28;
      const fv = CBZ.disasters.fleeVector(px, pz);
      if (fv && (fv.x || fv.z)) {
        const dot = Math.max(-1, Math.min(1, fv.x * wxx + fv.z * wzz));
        escapeAngleDeg = Math.round(Math.acos(Math.abs(dot)) * 180 / Math.PI);
      }
    }
    let smokeAlphaMax = 0, smokeSizeMax = 0, smokeBufferLive = 0, pointSizeMaxPx = 0;
    if (FX && FX.renderV3 && FX.smoke) {
      const aa = FX.smoke.geometry.attributes.aAlpha.array;
      const ss = FX.smoke.geometry.attributes.aSize.array;
      const pp = FX.smoke.geometry.attributes.position.array;
      for (let i = 0; i < aa.length; i++) {
        if (aa[i] > smokeAlphaMax) smokeAlphaMax = aa[i];
        if (ss[i] > smokeSizeMax) smokeSizeMax = ss[i];
        if (pp[i * 3] > -9000 && aa[i] > 0) smokeBufferLive++;
      }
      try {
        const gl = CBZ.renderer.getContext();
        pointSizeMaxPx = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 0;
      } catch (_) {}
    }
    return {
      v2: !!(CBZ.CONFIG.WILDFIRE_V2 !== false),
      renderV3: !!(FX && FX.renderV3),
      treesTotal: tr.length, treesBurning: burning, treesBurnt: burnt,
      ignitions: stats.ignitions,
      spotLaunched: stats.spotLaunched, spotFires: stats.spotFires, spotMaxM: stats.spotMaxM,
      runM: Math.round(runM), runDownwindM: Math.round(runDownM), runUpwindM: Math.round(runUpM),
      smokeDamage: Math.round(stats.smokeDamage), flameDamage: Math.round(stats.flameDamage),
      smokeDeaths: stats.smokeDeaths, flameDeaths: stats.flameDeaths,
      scarM2: Math.round(stats.scarM2),
      // only a claim when the module is actually running the fire
      plumeLenM: (CBZ.CONFIG.WILDFIRE_V2 !== false && F.seed) ? Math.round(plumeLen()) : 0,
      smokePuffsLive: FX ? MAXSMOKE - FX.sFree.length : 0,
      smokeBufferLive,
      smokeAlphaMax: +smokeAlphaMax.toFixed(3), smokeSizeMax: +smokeSizeMax.toFixed(2),
      flameSpritesLive: FX && FX.renderV3 ? burning * 3 : 0,
      pointSizeMaxPx,
      spotsInFlight: F.spots.length,
      escapeAngleDeg,
      windX: +F.wx.toFixed(2), windZ: +F.wz.toFixed(2),
    };
  };

  CBZ.wildfire = {
    beginWarn, begin, tick, stop,
    threat, safeDir, smokeAt,
    wind() { return { x: F.wx, z: F.wz, speed: F.wspd }; },
    // diagnostic: are the DRAWN puffs where the analytic field claims smoke?
    puffStats(x, z) {
      let live = 0, surf = 0, near = 0, nd = 1e9, ny = 0;
      if (FX) for (let i = 0; i < FX.spuff.length; i++) {
        const p = FX.spuff[i]; if (!p) continue;
        live++;
        if (!p.surface) continue;
        surf++;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < nd) { nd = d; ny = p.y; }
        if (d < 18) near++;
      }
      return { live, surf, near, nd: nd === 1e9 ? -1 : Math.round(nd), ny: Math.round(ny) };
    },
    seedPos() { return F.seed ? { x: F.seed.x, z: F.seed.z } : null; },
    live() { return F.live; },
    audit() { return CBZ.wildfireAudit(); },
  };
})();
