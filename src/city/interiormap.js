/* ============================================================
   city/interiormap.js — REAL-LOOKING ROOMS BEHIND THE GLASS.

   WHY: every building window — near or far, ground or top floor, intact
   or shot out — should read as an INHABITED room. Modeling a furnished
   interior behind thousands of panes is far too expensive for a
   draw-call-bound city, and on upper floors / at distance the furniture
   is sub-pixel anyway. So we fake it the way Marvel's Spider-Man and GTA
   do: INTERIOR MAPPING. A single flat quad sitting in the window plane
   runs a fragment shader that analytically raymarches a virtual box
   "room" behind it — floor, ceiling, two side walls, a back wall, plus a
   procedural furniture silhouette — all perspective-correct with real
   parallax as the camera moves. No modeled geometry, no cubemap
   textures: the room palette + furniture are synthesized per-seed in the
   shader. (Research: the classic technique uses a baked cubemap per room;
   the cheaper variant — what we use — computes the box intersection
   analytically and shades it procedurally. Sources: Joost's interior
   mapping, alanzucconi/halisavakis shader breakdowns, the three.js
   interior-mapping shader by mohsenheydari.)

   We chose the SHADER over a dressed recessed mini-room because it is
   strictly cheaper here: a mini-room is ~6 boxes per window; the shader
   is ONE quad per window, and ALL backdrop quads batch into ONE
   InstancedMesh sharing ONE ShaderMaterial. The whole city of "rooms"
   costs ~1 draw call. Per-window variation (room tint, furniture kind,
   depth) rides instanceColor (3 floats) — no per-instance attribute
   plumbing needed in r128.

   HOW IT'S DRAW-CALL CHEAP:
     • one InstancedMesh, one ShaderMaterial (CBZ tags it _shared)
     • instanceColor packs the per-window seed → palette/furniture
     • frustumCulled=false (instances span the city; a unit-quad bound
       would cull the whole pool); renderOrder below the glass panes so
       the see-through glass composites over the room
     • the ONLY per-frame cost is one uniform write of the camera world
       position, gated to city mode; the shader does the rest on the GPU
     • capped (BACKDROP_CAP) with distance-based reuse so a sprawling
       expansion island can't grow the pool unbounded

   PUBLIC API (the integrator in buildings.js wires these):
     CBZ.cityInteriorBackdrop(parent, x,y,z, width,height, faceNormal, seed)
       → register a deep-room backdrop recessed behind a window centered
         at world (x,y,z), sized width×height, facing faceNormal (the
         OUTWARD wall normal). seed drives the per-room look. Returns the
         record (or null if capped / not in a buildable state).
     CBZ.cityInteriorBackdropReset()  → clear+pool everything for a new run.

   SELF-TEST (paste in console while in city mode, looking at a wall):
     CBZ.cityInteriorBackdrop(CBZ.scene, px, py, pz, 1.4, 1.6,
       new THREE.Vector3(0,0,1), 7);
     // then dolly the camera sideways — the room should parallax.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const BACKDROP_CAP = 480;   // hard ceiling on simultaneous room quads
  const INSET = 0.04;         // push the quad just inside the glass plane

  // pending registrations folded into the pool on the next city frame
  // (mirrors buildings.js's pendingGlass flow so we batch one rebuild).
  let pending = [];
  let pool = null;            // the one InstancedMesh
  let mat = null;             // the one shared ShaderMaterial
  const records = [];         // live backdrops (for distance reuse + reset)
  let _tmpQuat = null, _tmpM = null, _tmpUp = null, _tmpV = null;

  function lazyTmp() {
    if (_tmpM) return;
    _tmpQuat = new THREE.Quaternion();
    _tmpM = new THREE.Matrix4();
    _tmpUp = new THREE.Vector3(0, 1, 0);
    _tmpV = new THREE.Vector3();
  }

  // ---- the shared interior-mapping material -------------------------
  // A unit XY quad (PlaneGeometry 1x1, +Z forward) is instanced and
  // oriented to sit in each window. The fragment shader treats the quad
  // as the FRONT face of a virtual room box that extends back along -Z
  // (room-local). It intersects the camera ray with the box's far planes,
  // finds which inner surface is hit, and shades it. Procedural so no
  // textures: walls/ceiling/floor/back get palette colors, and a simple
  // furniture silhouette (a dark box on the floor against the back wall)
  // sells "lived-in". Per-instance variety + day/night via uniforms.
  function buildMat() {
    if (mat) return mat;
    mat = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() },   // camera world pos (per frame)
        uNight: { value: 0.0 },                 // 0 day .. 1 night
      },
      // instanceColor (r,g,b) carries the per-window seed:
      //   r → room hue/tint pick     g → furniture kind     b → room depth
      vertexShader: [
        "varying vec3 vLocalPos;",   // fragment position in room-local space
        "varying vec3 vCamLocal;",   // camera position in room-local space
        "varying vec3 vSeed;",
        "uniform vec3 uCam;",
        // NOTE: three.js r128 itself injects `attribute vec3 instanceColor;`
        // and `attribute mat4 instanceMatrix;` (with USE_INSTANCING* defines)
        // for an InstancedMesh that has instanceColor — so we must NOT
        // redeclare them here or the shader fails to compile.
        // mat4 inverse — WebGL1 (GLSL ES 1.00) has no built-in inverse().
        "mat4 m4inv(mat4 m){",
        "  float a00=m[0][0],a01=m[0][1],a02=m[0][2],a03=m[0][3];",
        "  float a10=m[1][0],a11=m[1][1],a12=m[1][2],a13=m[1][3];",
        "  float a20=m[2][0],a21=m[2][1],a22=m[2][2],a23=m[2][3];",
        "  float a30=m[3][0],a31=m[3][1],a32=m[3][2],a33=m[3][3];",
        "  float b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10;",
        "  float b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12;",
        "  float b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30;",
        "  float b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;",
        "  float det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;",
        "  det = 1.0/det;",
        "  return mat4(",
        "    (a11*b11-a12*b10+a13*b09)*det, (a02*b10-a01*b11-a03*b09)*det, (a31*b05-a32*b04+a33*b03)*det, (a22*b04-a21*b05-a23*b03)*det,",
        "    (a12*b08-a10*b11-a13*b07)*det, (a00*b11-a02*b08+a03*b07)*det, (a32*b02-a30*b05-a33*b01)*det, (a20*b05-a22*b02+a23*b01)*det,",
        "    (a10*b10-a11*b08+a13*b06)*det, (a01*b08-a00*b10-a03*b06)*det, (a30*b04-a31*b02+a33*b00)*det, (a21*b02-a20*b04-a23*b00)*det,",
        "    (a11*b07-a10*b09-a12*b06)*det, (a00*b09-a01*b07+a02*b06)*det, (a31*b01-a30*b03-a32*b00)*det, (a20*b03-a21*b01+a22*b00)*det);",
        "}",
        "void main() {",
        "  #ifdef USE_INSTANCING_COLOR",
        "    vSeed = instanceColor;",   // declared by three's injected prefix
        "  #else",
        "    vSeed = vec3(0.5, 0.3, 0.6);",
        "  #endif",
        // world matrix of THIS instance
        "  mat4 wm = modelMatrix;",
        "  #ifdef USE_INSTANCING",
        "    wm = modelMatrix * instanceMatrix;",   // instanceMatrix from prefix
        "  #endif",
        "  mat4 inv = m4inv(wm);",
        // quad local pos: x,y in [-0.5,0.5], z=0 (the window plane).
        "  vLocalPos = position;",
        "  vCamLocal = (inv * vec4(uCam, 1.0)).xyz;",
        "  gl_Position = projectionMatrix * viewMatrix * wm * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "precision mediump float;",
        "varying vec3 vLocalPos;",
        "varying vec3 vCamLocal;",
        "varying vec3 vSeed;",
        "uniform float uNight;",
        // cheap hash for per-room palette jitter
        "float h11(float x){ return fract(sin(x*127.1)*43758.5453); }",
        "vec3 hsv2rgb(vec3 c){",
        "  vec3 p = abs(fract(c.xxx + vec3(0.,2./3.,1./3.))*6.-3.);",
        "  return c.z * mix(vec3(1.), clamp(p-1.,0.,1.), c.y);",
        "}",
        "void main(){",
        // ---- room box, local space ----
        // quad spans x,y in [-0.5,0.5] at z=0. room goes back to z = -depth.
        "  float depth = mix(0.55, 1.5, vSeed.z);",     // how deep the room is
        "  vec3 ro = vCamLocal;",
        "  vec3 rd = normalize(vLocalPos - vCamLocal);", // ray from cam through this fragment
        // intersect ray with the 5 inner faces (front open). box:
        // x in [-.5,.5], y in [-.5,.5], z in [-depth, 0].
        "  float tBest = 1e9; int face = 0; vec3 hp = vLocalPos;",
        // back wall z = -depth
        "  if (abs(rd.z) > 1e-4){ float t = (-depth - ro.z)/rd.z; if (t>0.0){ vec3 p=ro+rd*t; if(abs(p.x)<=0.5&&abs(p.y)<=0.5&&t<tBest){tBest=t;face=1;hp=p;} } }",
        // left/right walls x = +-0.5
        "  if (abs(rd.x) > 1e-4){",
        "    float t = ( 0.5 - ro.x)/rd.x; if(t>0.0){vec3 p=ro+rd*t; if(abs(p.y)<=0.5&&p.z<=0.0&&p.z>=-depth&&t<tBest){tBest=t;face=2;hp=p;}}",
        "    t = (-0.5 - ro.x)/rd.x; if(t>0.0){vec3 p=ro+rd*t; if(abs(p.y)<=0.5&&p.z<=0.0&&p.z>=-depth&&t<tBest){tBest=t;face=2;hp=p;}}",
        "  }",
        // floor/ceiling y = +-0.5
        "  if (abs(rd.y) > 1e-4){",
        "    float t = ( 0.5 - ro.y)/rd.y; if(t>0.0){vec3 p=ro+rd*t; if(abs(p.x)<=0.5&&p.z<=0.0&&p.z>=-depth&&t<tBest){tBest=t;face=3;hp=p;}}",   // ceiling
        "    t = (-0.5 - ro.y)/rd.y; if(t>0.0){vec3 p=ro+rd*t; if(abs(p.x)<=0.5&&p.z<=0.0&&p.z>=-depth&&t<tBest){tBest=t;face=4;hp=p;}}",   // floor
        "  }",
        // ---- palette ----
        "  float hue = fract(0.07 + vSeed.x * 0.9);",          // wall hue
        "  vec3 wall = hsv2rgb(vec3(hue, 0.12, 0.62));",        // muted painted wall
        "  vec3 ceil = wall * 1.18;",                            // ceiling a touch brighter
        "  vec3 floorC = mix(vec3(0.32,0.26,0.2), wall*0.5, 0.4);", // wood-ish floor
        "  vec3 col = wall;",
        "  if (face==3) col = ceil;",
        "  if (face==4) col = floorC;",
        // depth shade: deeper into the room = darker (fake AO / falloff)
        "  float dz = clamp(-hp.z / depth, 0.0, 1.0);",
        "  col *= mix(1.0, 0.45, dz);",
        // back wall gets a 'window light' gradient + the furniture silhouette
        "  if (face==1){",
        "    col *= 0.85;",
        // furniture: a dark block sitting on the floor against the back wall.
        // kind from seed.g picks width/height so rooms differ.
        "    float fk = vSeed.y;",
        "    float fw = mix(0.18, 0.42, fk);",          // half-width
        "    float fh = mix(0.12, 0.34, fract(fk*3.0));", // height off the floor
        "    if (abs(hp.x) < fw && hp.y < (-0.5 + fh)){",
        "      col = mix(col, vec3(0.10,0.09,0.11), 0.85);", // dark furniture
        "    }",
        // a poster/picture rectangle higher up, jittered per room
        "    float px = (h11(vSeed.x*31.0)-0.5)*0.5;",
        "    if (abs(hp.x-px) < 0.12 && abs(hp.y-0.18) < 0.13){",
        "      col = mix(col, hsv2rgb(vec3(fract(vSeed.y+0.5),0.5,0.7)), 0.6);",
        "    }",
        "  }",
        // ---- day / night ----
        // by day the room is dim relative to the bright street (reads dark
        // and recessed, like real glass); by night a warm interior glow.
        "  vec3 dayCol = col * 0.5;",                            // shadowed interior by day
        "  vec3 warm = vec3(1.0, 0.82, 0.55);",
        "  float lampHash = h11(vSeed.x*53.0 + vSeed.y*17.0);",
        "  float lit = step(0.45, lampHash);",                   // ~55% of rooms lit at night
        "  vec3 nightCol = col * mix(0.12, 1.0, lit) * warm;",
        "  vec3 outc = mix(dayCol, nightCol, uNight);",
        // never pure black; a tiny floor of ambient so the room never voids out
        "  outc = max(outc, vec3(0.02));",
        "  gl_FragColor = vec4(outc, 1.0);",
        "}",
      ].join("\n"),
      side: THREE.FrontSide,
      depthWrite: true,
      depthTest: true,
      transparent: false,
    });
    mat.userData._shared = true;   // tag shared per house convention
    return mat;
  }

  // unit XY plane (+Z normal), shared geometry for the pool
  let _quadGeo = null;
  function quadGeo() {
    if (!_quadGeo) { _quadGeo = new THREE.PlaneGeometry(1, 1); _quadGeo.userData._shared = true; }
    return _quadGeo;
  }

  // ---- registration -------------------------------------------------
  // Stash a backdrop request; the actual instance slot is assigned when
  // the pool is (re)built on a city frame. faceNormal is the OUTWARD wall
  // normal; we recess the quad INTO the wall by INSET so the see-through
  // glass pane composites in front of it.
  CBZ.cityInteriorBackdrop = function (parent, x, y, z, width, height, faceNormal, seed) {
    if (records.length + pending.length >= BACKDROP_CAP) return null;
    lazyTmp();
    // normalize the face normal (default +Z if degenerate)
    let nx = faceNormal ? faceNormal.x : 0, ny = faceNormal ? faceNormal.y : 0, nz = faceNormal ? faceNormal.z : 1;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    seed = (seed == null ? (Math.random() * 1000) : seed) | 0;
    const rec = {
      parent: parent || CBZ.scene,
      // recess slightly along -normal (into the building)
      x: x - nx * INSET, y: y - ny * INSET, z: z - nz * INSET,
      w: width || 1.2, h: height || 1.4,
      nx, ny, nz, seed,
      inst: -1,
    };
    pending.push(rec);
    return rec;
  };

  CBZ.cityInteriorBackdropReset = function () {
    if (pool) { if (pool.parent) pool.parent.remove(pool); pool = null; }
    records.length = 0;
    pending.length = 0;
  };

  // build the matrix that orients/sizes the unit quad to a backdrop.
  // +Z of the quad must point along the OUTWARD normal (toward the street),
  // so the shader's room (which extends to -Z) goes INTO the building.
  function recMatrix(rec, out) {
    _tmpV.set(rec.nx, rec.ny, rec.nz);
    // up vector: world-up unless the face is near-horizontal
    let up = _tmpUp;
    if (Math.abs(rec.ny) > 0.92) up = new THREE.Vector3(0, 0, 1);
    _tmpM.lookAt(new THREE.Vector3(0, 0, 0), _tmpV.clone().negate(), up);
    // lookAt builds a matrix whose -Z faces the target; we want +Z along
    // the normal, so the target is -normal → +Z ends up along +normal.
    _tmpQuat.setFromRotationMatrix(_tmpM);
    out.compose(
      new THREE.Vector3(rec.x, rec.y, rec.z),
      _tmpQuat,
      new THREE.Vector3(rec.w, rec.h, 1)
    );
    return out;
  }

  function rebuild() {
    if (!pending.length && pool) return;
    if (!CBZ.scene) return;
    lazyTmp();
    // merge pending into records (respecting cap)
    for (const r of pending) { if (records.length < BACKDROP_CAP) records.push(r); }
    pending = [];
    if (!records.length) return;
    // (re)create the pool sized to current records. cheap: happens only on
    // generation frames (initial city build + expansion island), not per-frame.
    if (pool && pool.parent) pool.parent.remove(pool);
    const m = buildMat();
    pool = new THREE.InstancedMesh(quadGeo(), m, records.length);
    pool.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    pool.castShadow = false; pool.receiveShadow = false;
    pool.frustumCulled = false;        // instances span the city
    pool.renderOrder = 0;              // BEHIND glass panes (renderOrder 1)
    pool.userData.interiorPool = true;
    // per-instance seed packed into instanceColor (r,g,b in 0..1)
    const _m4 = new THREE.Matrix4();
    const _c = new THREE.Color();
    for (let i = 0; i < records.length; i++) {
      const r = records[i]; r.inst = i;
      pool.setMatrixAt(i, recMatrix(r, _m4));
      const s = r.seed;
      _c.setRGB(
        ((s * 73 + 11) % 100) / 100,        // wall hue / tint pick
        ((s * 37 + 5) % 100) / 100,         // furniture kind
        0.15 + (((s * 19 + 3) % 70) / 100)  // room depth bias
      );
      pool.setColorAt(i, _c);
    }
    pool.instanceMatrix.needsUpdate = true;
    if (pool.instanceColor) pool.instanceColor.needsUpdate = true;
    CBZ.scene.add(pool);
  }

  // ---- per-frame: feed the shader the camera + day/night ------------
  // Only real cost is two uniform writes, gated to city mode. The GPU
  // does the parallax raymarch. Priority below buildings' glass passes.
  CBZ.onAlways(8, function () {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (pending.length) rebuild();
    if (!pool || !mat) return;
    if (CBZ.camera) mat.uniforms.uCam.value.copy(CBZ.camera.position);
    mat.uniforms.uNight.value = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
  });
})();
