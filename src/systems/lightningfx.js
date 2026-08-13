/* ============================================================
   systems/lightningfx.js — a lightning strike that looks like LIGHTNING.

   WHAT THIS REPLACES. The survival storm's ground strike used to be two
   things, and both were wrong:

     · the bolt was `new THREE.BoxGeometry(0.5, 40, 0.5)` — a white fence post
       dropped out of the sky, perfectly straight, one flat frame long;
     · the impact was `survBlast("kinetic", ...)`, which routes through the
       impact bus to COMPOSERS.heavy — i.e. cityAirstrikeExplosion. An ORANGE
       FIREBALL with a smoke column and a debris ejecta cone. The exact same
       draw a rocket-propelled grenade makes.

   Lightning is not ordnance. It carries no chemistry, no fuel and no fragments;
   there is nothing at the contact point to burn and nothing to throw. What a
   cloud-to-ground stroke actually looks like, and what this file draws:

     1. A CHANNEL, not a line. Midpoint-displacement path from the cloud base
        with 2-4 forks that die in the air. Rendered as cross-quad ribbons
        (WebGL ignores THREE.Line linewidth, so a real bolt cannot be a Line)
        with a white-hot core inside a wide blue sheath.
     2. RETURN STROKES. A flash is not one frame. A real flash is 3-5 strokes
        down the SAME channel over ~200 ms, which is why lightning strobes
        instead of fading. The channel re-jitters on each one and the world
        light pulses with it — that single property is most of the difference
        between "lightning" and "explosion".
     3. FLASHOVER at the ground. Surface arcs crawling radially out from the
        contact for a sixth of a second. Unmistakably electrical, and the one
        cue no fireball can fake.
     4. NO FIREBALL. A white-hot contact point that dies in 90 ms, a spray of
        sparks, and a pale STEAM puff — because the ground a storm strikes is
        soaked, and what comes off it is steam, not petrol smoke.
     5. A SCAR that stays. The strike leaves a fulgurite burn — a dark star
        scorched into the ground — which simply fades in, cold. The arena
        accumulates its own strike history.

   TWO THINGS THAT WERE HERE AND ARE NOT (2026-08-13, owner review).
     · An expanding ground RING. It was written as "a rim of light, not a shock
       front", but a bright circle racing outward from an impact is explosion
       grammar whatever colour it is drawn in, and it read as one. Deleted
       rather than tuned: the flashover arcs already say "electricity" at the
       ground, and they say it better without a shockwave drawn over them.
     · The scar's COOLING RIM — an additive overlay running white → amber as it
       faded. Physically defensible (struck ground really is incandescent) and
       wrong on screen: against grass, a dark star with a red-orange edge reads
       as a POOL OF BLOOD, which is a thing this game draws elsewhere and must
       not be confused with. The scorch is now cold from the first frame and
       neutral charcoal rather than warm brown, so it can only be a burn.

   WHY IT IS A FILE AND NOT A DISASTER DEF. systems/disasters.js owns the
   survival island's storm, but the bus that draws it is global: this file
   registers a `lightning` ordnance row plus its FX composer, exactly the way
   city/nukefx.js registers the mushroom cloud. So `CBZ.detonate(x, y, z,
   "lightning")` now works from anywhere — the city's night storm, a downed
   pylon, a scripted beat — and none of them has to re-type a bolt.

   API
     CBZ.lightningStrike(x, z, opts) — the whole event at a ground point.
       opts: y (contact height; default the floor), power (0.4..1.6 visual
       scale), ground (false = an in-cloud/air stroke: no scar, no sparks),
       sfx (false = silent, caller owns audio), flash (0..1 multiplier),
       seed (deterministic jitter).
     CBZ.lightningArc(ax, ay, az, bx, by, bz, opts) — a SIDE FLASH: the jump
       from a struck object to a person beside it, or on from that person to
       the next. opts: w (ribbon half-width), life (seconds), seed.
     CBZ.lightningLeader(x, z, opts) — the STEPPED LEADER that precedes a
       strike, as a drop-in replacement for CBZ.fx.groundMarker's handle:
       .set(progress 0..1) / .move(x, z) / .dispose(). Silent, unlit, and
       invisible for the first 45% of the countdown. Seeded from the strike
       COORDINATES, so the return stroke that follows runs up the same channel.
     CBZ.lightningFxReset() — drop every live bolt, every leader and every scar.
     CBZ.lightningFxAudit() — { strikes, live, scars, strokes, boltMeshes }.

   FLAG: CBZ.CONFIG.LIGHTNING_FX_V2 (default true). False makes
   CBZ.lightningStrike a no-op and sends systems/disasters.js back to the old
   kinetic blast — a genuine one-line revert to the fireball.

   BUDGETS. Every buffer is preallocated and every mesh is pooled: 5 concurrent
   bolts, 18 scars, ~1150 verts per channel, no allocation in the frame loop.
   Counts ride CBZ.qScale so a phone sheds sparks and forks before it sheds the
   stroke timing, which is the part that carries the read. Jitter runs off a
   local LCG, never Math.random, so a seeded run photographs the same bolt.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.scene) return;
  const scene = CBZ.scene;
  if (CBZ.CONFIG.LIGHTNING_FX_V2 == null) CBZ.CONFIG.LIGHTNING_FX_V2 = true;

  // ---- budgets -----------------------------------------------------------
  const MAX_BOLTS = 5;          // concurrent strikes; oldest is recycled
  const MAX_SCARS = 18;         // ground burns kept; oldest is recycled
  const SEG_MAX = 128;          // ribbon segments per bolt (main + forks)
  const SPARKS = 44;
  const STEAM = 22;
  const ARCS = 6;               // surface flashover tendrils
  const ARC_PTS = 7;
  const SCAR_SPIKES = 6;
  const SCAR_FAN = 16;
  const CLOUD_BASE = 62;        // metres of visible channel above the contact

  // ---- deterministic jitter (house rule: never Math.random in world FX) ---
  let seedCounter = 0x9e37;
  function lcg(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  const audit = { strikes: 0, strokes: 0, scars: 0, flashes: 0 };

  /* A ROUND MOTE. THREE.PointsMaterial with no map draws a hard SQUARE, and at
     these sizes an ember and a steam puff both came out as opaque tiles —
     which reads as blast debris, i.e. as the exact thing this file exists to
     stop drawing. One 32 px radial gradient, built once, shared by both point
     clouds. Same trick systems/taserfx.js uses for its arc glow. */
  function moteTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const g = c.getContext("2d").createRadialGradient(16, 16, 0.5, 16, 16, 15.5);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,.72)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    const x = c.getContext("2d"); x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }
  const moteTex = moteTexture();

  // ============================================================
  // CHANNEL GEOMETRY — cross-quad ribbons.
  //
  // A bolt has to hold up at 8 m and at 300 m, so it needs real thickness;
  // THREE.Line cannot give it any (WebGL dropped linewidth). Each path segment
  // becomes TWO quads at right angles to each other about the segment axis —
  // the classic cheap volumetric strip. Bolts run near-vertical, so the world
  // X and Z axes are stable perpendiculars and no per-frame billboarding is
  // needed. 12 verts a segment; the whole channel is one draw call.
  // ============================================================
  function channelMesh(color, opacity, segCap) {
    const cap = segCap || SEG_MAX;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cap * 12 * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cap * 12 * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: color, vertexColors: true, transparent: true, opacity: opacity,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;   // positions are rewritten every stroke
    m.renderOrder = 9;
    m.visible = false;
    m.userData.segCap = cap;
    scene.add(m);
    return m;
  }

  // Bake a list of paths into one ribbon buffer. `widthMul` fattens the same
  // path into the outer glow sheath, so core and sheath are one path solved
  // twice rather than two paths that can disagree about where the bolt is.
  function bake(mesh, paths, widthMul, brightMul) {
    const CAP = (mesh.userData.segCap || SEG_MAX) * 12;
    const pos = mesh.geometry.attributes.position.array;
    const col = mesh.geometry.attributes.color.array;
    let v = 0;
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p], pts = path.pts, n = pts.length;
      if (n < 2) continue;
      for (let i = 0; i < n - 1 && v < CAP; i++) {
        const a = pts[i], b = pts[i + 1];
        const ta = i / (n - 1), tb = (i + 1) / (n - 1);
        // t = 0 at the cloud, 1 at the tip. Slightly fatter up top so
        // perspective does not thin the far end into nothing.
        const wa = path.w * (1.3 - 0.5 * ta) * widthMul;
        const wb = path.w * (1.3 - 0.5 * tb) * widthMul;
        // The head fades INTO the cloud instead of ending on a hard cap, and
        // a fork fades out along its length because it never reaches ground.
        // `flat` opts out of both: a side flash is a metre-long jump between
        // two solid things and is equally bright at both ends.
        const fa = path.flat ? 1 : Math.min(1, ta / 0.18) * (path.fork ? 1 - ta * 0.92 : 0.75 + 0.4 * ta);
        const fb = path.flat ? 1 : Math.min(1, tb / 0.18) * (path.fork ? 1 - tb * 0.92 : 0.75 + 0.4 * tb);
        const ca = fa * brightMul * path.b, cb = fb * brightMul * path.b;
        // two quads: one spanning X, one spanning Z
        for (let axis = 0; axis < 2; axis++) {
          const ax = axis === 0 ? 1 : 0, az = axis === 0 ? 0 : 1;
          const a0x = a.x - ax * wa, a0z = a.z - az * wa;
          const a1x = a.x + ax * wa, a1z = a.z + az * wa;
          const b0x = b.x - ax * wb, b0z = b.z - az * wb;
          const b1x = b.x + ax * wb, b1z = b.z + az * wb;
          const q = [
            a0x, a.y, a0z, ca, a1x, a.y, a1z, ca, b1x, b.y, b1z, cb,
            a0x, a.y, a0z, ca, b1x, b.y, b1z, cb, b0x, b.y, b0z, cb,
          ];
          for (let k = 0; k < 6; k++) {
            const o = v * 3;
            pos[o] = q[k * 4]; pos[o + 1] = q[k * 4 + 1]; pos[o + 2] = q[k * 4 + 2];
            const c = q[k * 4 + 3];
            col[o] = c; col[o + 1] = c; col[o + 2] = c;
            v++;
          }
        }
      }
    }
    mesh.geometry.setDrawRange(0, v);
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.color.needsUpdate = true;
  }

  // ---- path generation ---------------------------------------------------
  // ANCHORS ONCE, FINE DETAIL PER STROKE. Real return strokes follow the
  // channel the first one ionised — they wander within it, they do not pick a
  // new route across the sky. So the coarse anchors are solved at strike time
  // and only the subdivision is re-rolled, which is what makes the strobe read
  // as one bolt flickering rather than five different bolts.
  function anchors(x, z, gy, rnd) {
    const h = CLOUD_BASE * (0.85 + rnd() * 0.45);
    // Bolts do lean, but a channel that lands 20 m from the point it appears
    // to come down at stops reading as "that is where it hit".
    const lean = 3 + rnd() * 10, a = rnd() * 6.2832;
    const tx = x + Math.cos(a) * lean, tz = z + Math.sin(a) * lean;
    const pts = [{ x: tx, y: gy + h, z: tz }];
    const N = 4;
    for (let i = 1; i < N; i++) {
      const t = i / N;
      pts.push({
        x: tx + (x - tx) * t + (rnd() - 0.5) * h * 0.17,
        y: gy + h * (1 - t),
        z: tz + (z - tz) * t + (rnd() - 0.5) * h * 0.17,
      });
    }
    pts.push({ x: x, y: gy, z: z });
    return pts;
  }

  function subdivide(pts, passes, amp, rnd) {
    let cur = pts;
    for (let p = 0; p < passes; p++) {
      const out = [cur[0]];
      for (let i = 0; i < cur.length - 1; i++) {
        const a = cur[i], b = cur[i + 1];
        const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * amp;
        out.push({
          x: (a.x + b.x) * 0.5 + (rnd() - 0.5) * d,
          // vertical wander is deliberately smaller: a bolt zig-zags ACROSS
          // its fall line, it does not stall and climb back up
          y: (a.y + b.y) * 0.5 + (rnd() - 0.5) * d * 0.3,
          z: (a.z + b.z) * 0.5 + (rnd() - 0.5) * d,
        });
        out.push(b);
      }
      cur = out; amp *= 0.6;
    }
    return cur;
  }

  function buildPaths(rec, rnd) {
    // 3 passes at a HIGH amplitude, not 4 at a low one: fewer, longer segments
    // meeting at sharper angles. The finer version drew a smooth curved ribbon,
    // which is a rope, not an arc.
    const main = subdivide(rec.anchors, 3, 0.3, rnd);
    const paths = [{ pts: main, w: 0.085 * rec.power, b: 1, fork: false }];
    const forks = Math.round(CBZ.qScale ? CBZ.qScale(1.2, 4.2) : 4);
    for (let k = 0; k < forks; k++) {
      const i = 3 + ((rnd() * main.length * 0.6) | 0);
      const from = main[Math.min(i, main.length - 4)];
      if (!from) continue;
      const len = 9 + rnd() * 24;
      const a = rnd() * 6.2832;
      const end = {
        x: from.x + Math.cos(a) * len * 0.8,
        y: Math.max(rec.gy + 5, from.y - len * (0.5 + rnd() * 0.55)),
        z: from.z + Math.sin(a) * len * 0.8,
      };
      paths.push({ pts: subdivide([from, end], 3, 0.3, rnd), w: 0.05 * rec.power, b: 0.8, fork: true });
    }
    return paths;
  }

  // ============================================================
  // GROUND SCARS — the fulgurite burn, pooled and recycled.
  // Built in WORLD coordinates with every vertex sampled off CBZ.floorAt, so
  // the star lies ON a hillside instead of hovering as a flat disc through it.
  // ============================================================
  const scars = [];
  let scarNext = 0;
  const SCAR_VERTS = SCAR_FAN * 3 + SCAR_SPIKES * 6;

  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }

  function scarSlot() {
    if (scars.length < MAX_SCARS) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SCAR_VERTS * 3), 3));
      geo.setDrawRange(0, 0);
      // COLD CHARCOAL, not warm brown: a dark star with any red in it reads as
      // a blood pool on grass, and this game draws real ones.
      const dark = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x15171b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      }));
      dark.frustumCulled = false;
      dark.renderOrder = 5;
      scene.add(dark);
      const slot = { geo, dark, fade: 0 };
      scars.push(slot);
      return slot;
    }
    const slot = scars[scarNext % MAX_SCARS];
    scarNext++;
    return slot;
  }

  function writeScar(slot, x, z, r, rnd) {
    const pos = slot.geo.attributes.position.array;
    let v = 0;
    const put = (px, pz) => {
      const o = v * 3;
      pos[o] = px; pos[o + 1] = floorAt(px, pz) + 0.05; pos[o + 2] = pz;
      v++;
    };
    // the vaporised core, an irregular disc
    let prevA = 0, prevR = r * (0.7 + rnd() * 0.5);
    for (let i = 1; i <= SCAR_FAN; i++) {
      const a = (i / SCAR_FAN) * 6.2832;
      const rr = r * (0.7 + rnd() * 0.5);
      put(x, z); put(x + Math.cos(prevA) * prevR, z + Math.sin(prevA) * prevR);
      put(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
      prevA = a; prevR = rr;
    }
    // the branches the current took through the topsoil — tapered spikes
    for (let s = 0; s < SCAR_SPIKES; s++) {
      const a = (s / SCAR_SPIKES) * 6.2832 + rnd() * 0.7;
      const len = r * (1.1 + rnd() * 1.5);
      const w = r * 0.3;
      const cx = Math.cos(a), cz = Math.sin(a), nx = -cz, nz = cx;
      const bx = x + cx * r * 0.5, bz = z + cz * r * 0.5;
      const mx = x + cx * len * 0.55 + nx * (rnd() - 0.5) * len * 0.3;
      const mz = z + cz * len * 0.55 + nz * (rnd() - 0.5) * len * 0.3;
      const ex = x + cx * len, ez = z + cz * len;
      put(bx - nx * w, bz - nz * w); put(bx + nx * w, bz + nz * w); put(mx, mz);
      put(mx - nx * w * 0.4, mz - nz * w * 0.4); put(mx + nx * w * 0.4, mz + nz * w * 0.4); put(ex, ez);
    }
    slot.geo.setDrawRange(0, v);
    slot.geo.attributes.position.needsUpdate = true;
    slot.dark.material.opacity = 0;
    slot.fade = 0.5;
    audit.scars++;
  }

  // ============================================================
  // THE BOLT RECORD — every mesh a strike can need, made once, hidden idle.
  // ============================================================
  const bolts = [];
  let boltNext = 0;

  function makeBolt() {
    const core = channelMesh(0xf4f9ff, 1);
    const glow = channelMesh(0x5aa0ff, 0.45);

    const arcs = [];
    for (let i = 0; i < ARCS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ARC_PTS * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: i % 2 ? 0xbfe4ff : 0xf2fbff, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      line.frustumCulled = false; line.visible = false; line.renderOrder = 8;
      scene.add(line); arcs.push(line);
    }

    const hot = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
    hot.visible = false; hot.renderOrder = 9;
    scene.add(hot);

    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    sparkGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    sparkGeo.setDrawRange(0, 0);
    const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
      size: 0.34, map: moteTex, vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    sparks.frustumCulled = false; sparks.visible = false; scene.add(sparks);

    const steamGeo = new THREE.BufferGeometry();
    steamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(STEAM * 3), 3));
    steamGeo.setDrawRange(0, 0);
    // STEAM, NOT SMOKE. Normal blending and a cold grey — the ground a storm
    // strikes is soaked, and what boils off it is white, not sooty orange.
    const steam = new THREE.Points(steamGeo, new THREE.PointsMaterial({
      size: 1.7, map: moteTex, color: 0xd2dade, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true,
    }));
    steam.frustumCulled = false; steam.visible = false; scene.add(steam);

    return {
      core, glow, arcs, hot, sparks, steam,
      sparkVel: new Float32Array(SPARKS * 3), steamVel: new Float32Array(STEAM * 3),
      live: false, age: 0, life: 0, fired: 0, strokes: [], anchors: null,
      x: 0, z: 0, gy: 0, power: 1, ground: true, flash: 1, att: 1, rnd: null,
    };
  }

  function boltSlot() {
    for (let i = 0; i < bolts.length; i++) if (!bolts[i].live) return bolts[i];
    if (bolts.length < MAX_BOLTS) { const b = makeBolt(); bolts.push(b); return b; }
    const b = bolts[boltNext % bolts.length]; boltNext++;
    return b;
  }

  function hideBolt(r) {
    r.live = false;
    r.core.visible = r.glow.visible = false;
    r.hot.visible = false;
    r.sparks.visible = r.steam.visible = false;
    for (let i = 0; i < r.arcs.length; i++) r.arcs[i].visible = false;
  }

  // ---- camera attenuation: a strike across the map must not slap the lens --
  function camAtten(x, y, z) {
    const cam = CBZ.camera;
    if (!cam || !cam.position) return { att: 1, dist: 0 };
    const d = Math.hypot(cam.position.x - x, cam.position.y - y, cam.position.z - z);
    return { att: Math.max(0.1, Math.min(1, 1 - (d - 30) / 230)), dist: d };
  }

  /* ONE RETURN STROKE. Called once from strike() (so the channel is on screen
     the same frame the ground lights up, whatever updater order the caller
     runs at) and then from the frame loop for each stroke after it. */
  function fireStroke(r, s) {
    // re-jitter the FINE detail; the anchors stay, because a return stroke
    // reuses the channel the leader already ionised
    const paths = buildPaths(r, r.rnd);
    bake(r.core, paths, 1, 1);
    bake(r.glow, paths, 2.8, 0.42);
    r.core.visible = r.glow.visible = true;
    audit.strokes++;
    // THE WORLD LIGHTS UP, not the bolt. Both the screen wash (survival's
    // additive flash plate) and the scene's own hemi/sun bump in
    // systems/weather.js are pulsed, so faces and shadowed walls flicker with
    // the stroke instead of a white rectangle floating in front of them.
    const amp = s.amp * r.att * r.flash;
    if (CBZ.weatherStrobe) { try { CBZ.weatherStrobe(0.8 * amp, s.dur + 0.03); } catch (e) {} }
    // Deliberately well under the 0.7 the old strike used: that plate whited
    // the frame out completely and hid the very thing it was announcing. The
    // scene light above carries the flash; this only tints it.
    if (CBZ.fx && CBZ.fx.flash && CBZ.survEnv) { try { CBZ.fx.flash(0.3 * amp, 0xd9e8ff); } catch (e) {} }
    // FULL BRIGHTNESS NOW, not on the next updater tick. A pooled record
    // arrives carrying the last bolt's faded-out opacity, and the frame a
    // stroke fires may be rendered before this file's updater runs again
    // (it sits at 27.4; systems/disasters.js fires strikes at 28) — so a
    // stroke that only set `visible` would render its first frame invisible.
    r.core.material.opacity = s.amp;
    r.glow.material.opacity = s.amp * 0.45;
    r.fired++;
  }

  /* THE SEED IS THE PLACE. A leader and the return stroke that follows it are
     the SAME channel — the stroke runs back up the path the leader ionised —
     so both derive their jitter from the strike coordinates rather than from a
     counter. No plumbing between them, no shared handle through the bus, and
     the bolt still lands exactly where the warning said it would. */
  function posSeed(x, z) {
    const a = Math.round(x * 8) | 0, b = Math.round(z * 8) | 0;
    return ((a * 73856093) ^ (b * 19349663) ^ 0x9e3779b9) >>> 0;
  }

  // ============================================================
  // THE STRIKE
  // ============================================================
  function strike(x, z, o) {
    if (CBZ.CONFIG.LIGHTNING_FX_V2 === false) return null;
    o = o || {};
    const r = boltSlot();
    const rnd = lcg(o.seed != null ? (o.seed | 0) : posSeed(x, z));
    const gy = o.y != null ? o.y : floorAt(x, z);
    r.rnd = rnd; r.x = x; r.z = z; r.gy = gy;
    r.power = Math.max(0.35, Math.min(2, o.power != null ? o.power : 1));
    r.ground = o.ground !== false;
    /* WHERE THE CHANNEL ENDS AND WHERE THE GROUND IS ARE NOT THE SAME PLACE.
       A bolt that terminates on a treetop ends six metres up; the turf burn,
       the flashover and the steam still belong on the floor beneath it, and
       they belong there SMALLER, because the current is running to earth down
       the trunk instead of vaporising the ground. A building takes it all the
       way down through the structure, so it gets none. */
    r.fy = floorAt(x, z);
    r.gScale = o.groundScale != null ? Math.max(0, Math.min(1, o.groundScale)) : 1;
    r.flash = o.flash != null ? o.flash : 1;
    r.anchors = anchors(x, z, gy, rnd);
    r.age = 0; r.fired = 0; r.live = true;

    /* THE STROKE TRAIN. Measured flashes run 3-5 return strokes with 30-90 ms
       between them; the first is the brightest and the tail ones are shorter.
       This IS the effect — a single 160 ms fade is what made the old bolt read
       as a muzzle flash rather than as lightning. */
    const n = 3 + ((rnd() * 2.99) | 0);
    r.strokes.length = 0;
    let t = 0;
    for (let i = 0; i < n; i++) {
      const dur = (i === 0 ? 0.075 : 0.028 + rnd() * 0.035);
      r.strokes.push({ at: t, dur: dur, amp: i === 0 ? 1 : 0.45 + rnd() * 0.5 });
      t += dur + 0.03 + rnd() * 0.065;
    }
    r.life = t + 0.22;
    r.channelLife = t + 0.12;

    const ca = camAtten(x, gy + 12, z);
    r.att = ca.att; r.dist = ca.dist;

    // THE FIRST STROKE IS SYNCHRONOUS. The ground kit below lights up now, so
    // the channel has to be on screen now too — deferring it to the frame loop
    // would put the sparks one frame ahead of the bolt that made them, and
    // whether that happened at all would depend on the caller's updater order.
    fireStroke(r, r.strokes[0]);
    if (CBZ.shake) { try { CBZ.shake(0.35 * r.att * r.power); } catch (e) {} }

    if (r.ground && r.gScale > 0.02) {
      groundBurst(r, rnd);
      const slot = scarSlot();
      writeScar(slot, x, z, (0.55 + 0.5 * r.power) * (0.5 + 0.5 * r.gScale), rnd);
    } else if (r.ground) {
      // struck a building: the current goes to earth inside the structure, so
      // nothing is scorched outside it. The channel and the flash still happen.
      r.hot.position.set(x, r.gy + 0.35, z);
      r.hot.scale.setScalar(0.3 * r.power);
      r.hot.material.opacity = 0.95;
      r.hot.visible = true;
      r.sparks.visible = r.steam.visible = false;
      for (let i = 0; i < r.arcs.length; i++) r.arcs[i].visible = false;
    } else {
      r.hot.visible = r.sparks.visible = r.steam.visible = false;
    }

    if (o.sfx !== false) {
      /* SOUND LAGS LIGHT, and a NEAR strike is a CRACK, not a roll. The rumble
         is the same energy heard after kilometres of atmosphere has smeared it;
         at 20 m you get the shockwave off the channel itself. Both are played:
         the crack now, the roll behind it at the speed of sound. */
      if (CBZ.sfx) {
        try {
          const d = ca.dist;
          CBZ.sfx("thunder_crack", d > 25 ? { delay: Math.min(6, d / 343), dist: d } : { dist: d });
          CBZ.sfx("thunder", { delay: Math.min(7, 0.22 + d / 343), dist: d, volume: 0.7 });
        } catch (e) {}
      }
    }
    audit.strikes++;
    return r;
  }

  function groundBurst(r, rnd) {
    const x = r.x, z = r.z, gy = r.fy;
    // the contact point itself: white-hot, gone in 90 ms. This one sits at the
    // TERMINATION — on the treetop if that is what the bolt found.
    r.hot.position.set(x, r.gy + 0.35, z);
    r.hot.scale.setScalar(0.3 * r.power);
    r.hot.material.opacity = 0.95;
    r.hot.visible = true;

    // FLASHOVER. Surface arcs crawling out from the contact — the cue that
    // says "electricity" in one frame and that no explosion can borrow.
    const arcN = Math.max(2, Math.round((CBZ.qScale ? CBZ.qScale(0.4, 1) : 1) * ARCS * r.gScale));
    for (let i = 0; i < r.arcs.length; i++) {
      const line = r.arcs[i];
      if (i >= arcN) { line.visible = false; continue; }
      const pos = line.geometry.attributes.position.array;
      const a = (i / arcN) * 6.2832 + rnd() * 0.8;
      const len = (2.6 + rnd() * 4.2) * r.power;
      let cx = x, cz = z, dir = a;
      for (let k = 0; k < ARC_PTS; k++) {
        const o = k * 3;
        pos[o] = cx; pos[o + 1] = floorAt(cx, cz) + 0.09; pos[o + 2] = cz;
        dir += (rnd() - 0.5) * 1.5;
        const step = len / (ARC_PTS - 1);
        cx += Math.cos(dir) * step; cz += Math.sin(dir) * step;
      }
      line.geometry.attributes.position.needsUpdate = true;
      line.material.opacity = 1;
      line.visible = true;
    }

    // SPARKS: vaporised ground thrown up the channel. Bright white at the
    // root, cooling to ember orange at the tips.
    const q = CBZ.qScale ? CBZ.qScale(0.4, 1) : 1;
    const sn = Math.max(8, Math.round(SPARKS * q * r.gScale));
    const sp = r.sparks.geometry.attributes.position.array;
    const sc = r.sparks.geometry.attributes.color.array;
    for (let i = 0; i < sn; i++) {
      const o = i * 3;
      sp[o] = x; sp[o + 1] = gy + 0.1; sp[o + 2] = z;
      const a = rnd() * 6.2832, up = 5 + rnd() * 13, out = 2 + rnd() * 9;
      r.sparkVel[o] = Math.cos(a) * out; r.sparkVel[o + 1] = up; r.sparkVel[o + 2] = Math.sin(a) * out;
      const hotk = 0.45 + rnd() * 0.55;
      sc[o] = 1; sc[o + 1] = 0.55 + hotk * 0.45; sc[o + 2] = 0.25 + hotk * 0.7;
    }
    r.sparks.geometry.setDrawRange(0, sn);
    r.sparks.geometry.attributes.position.needsUpdate = true;
    r.sparks.geometry.attributes.color.needsUpdate = true;
    r.sparks.material.opacity = 1;
    r.sparks.visible = true;
    r.sparkN = sn;

    // STEAM off wet ground: slow, pale, rising, no fire in it anywhere.
    const tn = Math.max(6, Math.round(STEAM * q * r.gScale));
    const tp = r.steam.geometry.attributes.position.array;
    for (let i = 0; i < tn; i++) {
      const o = i * 3, a = rnd() * 6.2832, rr = rnd() * 1.3 * r.power;
      tp[o] = x + Math.cos(a) * rr; tp[o + 1] = gy + 0.2 + rnd() * 0.5; tp[o + 2] = z + Math.sin(a) * rr;
      r.steamVel[o] = Math.cos(a) * (0.5 + rnd());
      r.steamVel[o + 1] = 1.4 + rnd() * 2.2;
      r.steamVel[o + 2] = Math.sin(a) * (0.5 + rnd());
    }
    r.steam.geometry.setDrawRange(0, tn);
    r.steam.geometry.attributes.position.needsUpdate = true;
    r.steam.material.opacity = 0.3;
    r.steam.material.size = 1.0;
    r.steam.visible = true;
    r.steamN = tn;
  }

  // ============================================================
  // ONE UPDATER for every live bolt and every cooling scar. Not mode-gated:
  // the bus can fire a strike in the city too, and a scar left mid-cool must
  // finish cooling wherever it is.
  // ============================================================
  CBZ.onUpdate(27.4, function (dt) {
    if (!dt || dt <= 0) return;
    const g = CBZ.TUNE ? CBZ.TUNE.gravity : 22;

    for (let bi = 0; bi < bolts.length; bi++) {
      const r = bolts[bi];
      if (!r.live) continue;
      r.age += dt;

      // ---- fire the next return stroke -------------------------------
      while (r.fired < r.strokes.length && r.age >= r.strokes[r.fired].at) fireStroke(r, r.strokes[r.fired]);

      // ---- the channel's own brightness envelope ----------------------
      let op = 0;
      for (let i = 0; i < r.fired; i++) {
        const s = r.strokes[i];
        const u = (r.age - s.at) / s.dur;
        // NO ATTACK RAMP. A return stroke's rise is microseconds; at 60 Hz it
        // is already at full brightness on the frame it appears, and the decay
        // is what the eye actually reads.
        if (u >= 0 && u < 1) {
          const env = Math.pow(1 - u, 2.1) * s.amp;
          if (env > op) op = env;
        }
      }
      // between strokes the channel does not vanish: it sits at a dim glow,
      // which is what makes the strobe read as ONE bolt flickering
      if (r.age < r.channelLife) op = Math.max(op, 0.075 * (1 - r.age / r.channelLife));
      r.core.material.opacity = op;
      r.glow.material.opacity = op * 0.45;
      r.core.visible = r.glow.visible = op > 0.004;

      // ---- ground kit -------------------------------------------------
      if (r.ground) {
        if (r.hot.visible) {
          const u = r.age / 0.09;
          if (u >= 1) r.hot.visible = false;
          else {
            r.hot.scale.setScalar((0.3 + u * 0.62) * r.power);
            r.hot.material.opacity = 0.95 * (1 - u);
          }
        }
        for (let i = 0; i < r.arcs.length; i++) {
          const line = r.arcs[i];
          if (!line.visible) continue;
          const u = r.age / 0.18;
          if (u >= 1) { line.visible = false; continue; }
          // flicker rather than fade: an arc is on or it is not
          line.material.opacity = (1 - u) * (r.age * 90 % 1 > 0.35 ? 1 : 0.25);
        }
        if (r.sparks.visible) {
          const u = r.age / 0.85;
          if (u >= 1) r.sparks.visible = false;
          else {
            const sp = r.sparks.geometry.attributes.position.array;
            for (let i = 0; i < r.sparkN; i++) {
              const o = i * 3;
              r.sparkVel[o + 1] -= g * dt;
              sp[o] += r.sparkVel[o] * dt;
              sp[o + 1] += r.sparkVel[o + 1] * dt;
              sp[o + 2] += r.sparkVel[o + 2] * dt;
              const fy = floorAt(sp[o], sp[o + 2]) + 0.05;
              if (sp[o + 1] < fy) { sp[o + 1] = fy; r.sparkVel[o] *= 0.4; r.sparkVel[o + 1] = -r.sparkVel[o + 1] * 0.28; r.sparkVel[o + 2] *= 0.4; }
            }
            r.sparks.geometry.attributes.position.needsUpdate = true;
            r.sparks.material.opacity = 0.9 * (1 - u * u);
            r.sparks.material.size = 0.34 * (1 - u * 0.65);
          }
        }
        if (r.steam.visible) {
          const u = r.age / 2.1;
          if (u >= 1) r.steam.visible = false;
          else {
            const tp = r.steam.geometry.attributes.position.array;
            for (let i = 0; i < r.steamN; i++) {
              const o = i * 3;
              r.steamVel[o + 1] *= 1 - dt * 0.8;
              tp[o] += r.steamVel[o] * dt;
              tp[o + 1] += r.steamVel[o + 1] * dt;
              tp[o + 2] += r.steamVel[o + 2] * dt;
            }
            r.steam.geometry.attributes.position.needsUpdate = true;
            r.steam.material.opacity = 0.3 * (1 - u) * Math.min(1, u * 8);
            r.steam.material.size = 1.0 + u * 2.2;
          }
        }
      }

      if (r.age >= r.life && !r.hot.visible && !r.sparks.visible && !r.steam.visible) hideBolt(r);
    }

    // ---- side flashes: on, then gone. They flicker rather than fade,
    //      because an arc is either struck or it is not. ------------------
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i];
      if (!f.live) continue;
      f.age += dt;
      if (f.age >= f.life) { hideFlash(f); continue; }
      const k = 1 - f.age / f.life;
      const on = (f.age * 110 % 1) > 0.3 ? 1 : 0.3;
      f.core.material.opacity = k * on;
      f.glow.material.opacity = k * on * 0.45;
    }

    // ---- scars fade in and stay. Nothing glows: see the header. ---------
    for (let i = 0; i < scars.length; i++) {
      const s = scars[i];
      if (s.fade > 0) {
        s.dark.material.opacity = Math.min(s.fade, s.dark.material.opacity + dt * 3);
      }
    }
  });

  /* ============================================================
     THE SIDE FLASH — an arc between two things, both of which are solid.

     This is the second-biggest killer in the real phenomenon (30-35% of
     casualties; ground current is 50-55% and the two together are about 60% of
     everything). Lightning attaches to a tree, the trunk turns out to be a poor
     conductor, and part of the current jumps the air to something better on its
     way to earth — the person sheltering under it. It jumps a foot or two, and
     it can jump onward from that person to the next one, which is why groups go
     down together rather than one at a time.

     Drawn by the same ribbon baker as the channel, at a fraction of the width,
     `flat` so it is equally bright at both ends (it is a jump between two solid
     objects, not something fading into a cloud), and gone in about a tenth of a
     second. systems/disasters.js decides WHO — this only draws the jump.
     ============================================================ */
  const ARC_SEG = 24;
  const FLASHES = 10;
  const flashes = [];
  let flashNext = 0;

  function flashArc(ax, ay, az, bx, by, bz, o) {
    if (CBZ.CONFIG.LIGHTNING_FX_V2 === false) return null;
    o = o || {};
    let r = null;
    for (let i = 0; i < flashes.length; i++) if (!flashes[i].live) { r = flashes[i]; break; }
    if (!r) {
      if (flashes.length < FLASHES) {
        r = { core: channelMesh(0xeaf5ff, 1, ARC_SEG), glow: channelMesh(0x74b0ff, 0.45, ARC_SEG), live: false, age: 0, life: 0 };
        flashes.push(r);
      } else { r = flashes[flashNext % flashes.length]; flashNext++; }
    }
    const rnd = lcg(o.seed != null ? (o.seed | 0) : posSeed(ax + bz, az + bx));
    const span = Math.hypot(bx - ax, by - ay, bz - az) || 0.5;
    const pts = subdivide([{ x: ax, y: ay, z: az }, { x: bx, y: by, z: bz }], 3, 0.34, rnd);
    const w = (o.w || 0.055) * Math.max(0.6, Math.min(1.6, span / 2));
    const paths = [{ pts: pts, w: w, b: 1, fork: false, flat: true }];
    bake(r.core, paths, 1, 1);
    bake(r.glow, paths, 3, 0.45);
    r.core.material.opacity = 1;
    r.glow.material.opacity = 0.45;
    r.core.visible = r.glow.visible = true;
    r.live = true; r.age = 0; r.life = o.life || 0.13;
    audit.flashes++;
    return r;
  }

  function hideFlash(r) { r.live = false; r.core.visible = r.glow.visible = false; }

  /* ============================================================
     THE STEPPED LEADER — the telegraph, and a real one.

     The storm used to warn you with CBZ.fx.groundMarker: a pulsing blue disc
     4.5 m across, painted on the ground where the bolt would land. It is a
     video-game floor decal. Nothing in the world casts it, and it announces
     the strike from directly above the one place you cannot see the sky.

     What actually precedes a cloud-to-ground stroke is the STEPPED LEADER: a
     dim, branching channel that gropes down out of the cloud in ~50 µs jumps,
     far too faint to light anything, and when it reaches the ground the return
     stroke runs back up it. So the warning is now the bolt's own approach —
     you read it by looking UP, it points at where it is going to land, and it
     gets brighter and lower the less time you have.

     Deliberately shaped as the SAME HANDLE the ground marker returned
     (`.set(progress 0..1)`, `.move(x, z)`, `.dispose()`), so systems/
     disasters.js swaps one constructor and keeps every other line — including
     the pending list its threat model and its bot-scatter AI read.

     It is silent, it does not flash, and for the first 45% of the countdown it
     is not drawn at all: a leader you can see for a full second is a floor
     decal wearing a costume.
     ============================================================ */
  const LEADERS = 4;
  const leaders = [];
  let leaderNext = 0;

  function makeLeader() {
    return {
      core: channelMesh(0xcfe7ff, 1), glow: channelMesh(0x4f8bff, 0.4),
      live: false, anchors: null, paths: null, rnd: null, seed: 0,
      x: 0, z: 0, gy: 0, h: 1, power: 1, tick: 0,
    };
  }

  // Cut a cloud→ground path off at a height, interpolating the last step, so
  // the leader has a descending TIP instead of appearing all at once.
  function sliceTo(pts, cy) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.y >= cy) { out.push(p); continue; }
      const a = pts[i - 1];
      if (a) {
        const t = (a.y - cy) / ((a.y - p.y) || 1);
        out.push({ x: a.x + (p.x - a.x) * t, y: cy, z: a.z + (p.z - a.z) * t });
      }
      break;
    }
    return out.length > 1 ? out : null;
  }

  function hideLeader(r) {
    r.live = false;
    r.core.visible = r.glow.visible = false;
  }

  function leader(x, z, o) {
    o = o || {};
    let r = null;
    for (let i = 0; i < leaders.length; i++) if (!leaders[i].live) { r = leaders[i]; break; }
    if (!r) {
      if (leaders.length < LEADERS) { r = makeLeader(); leaders.push(r); }
      else { r = leaders[leaderNext % leaders.length]; leaderNext++; }
    }
    r.seed = o.seed != null ? (o.seed | 0) : posSeed(x, z);
    r.rnd = lcg(r.seed);
    r.x = x; r.z = z;
    r.gy = o.y != null ? o.y : floorAt(x, z);
    r.power = Math.max(0.35, Math.min(2, o.power != null ? o.power : 1));
    r.anchors = anchors(x, z, r.gy, r.rnd);
    r.h = Math.max(1, r.anchors[0].y - r.gy);
    r.tick = 0; r.live = true;
    hideLeader(r); r.live = true;

    const handle = {
      set(p) {
        p = Math.max(0, Math.min(1, p));
        const START = 0.45;
        if (p < START) { r.core.visible = r.glow.visible = false; return; }
        const u = (p - START) / (1 - START);
        // the tip accelerates: a leader dawdles high up and covers the last
        // twenty metres in the blink before the stroke
        const cy = r.gy + r.h * (1 - u) * (1 - u);
        // re-roll the fine detail every third frame — a leader CRACKLES down in
        // discrete steps, it does not glide
        if ((r.tick % 3) === 0 || !r.paths) r.paths = buildPaths(r, r.rnd);
        r.tick++;
        const cut = [];
        for (let i = 0; i < r.paths.length; i++) {
          const path = r.paths[i];
          const pts = sliceTo(path.pts, cy);
          if (pts) cut.push({ pts: pts, w: path.w, b: path.b, fork: path.fork });
        }
        if (!cut.length) { r.core.visible = r.glow.visible = false; return; }
        bake(r.core, cut, 0.5, 1);
        bake(r.glow, cut, 1.9, 0.35);
        // faint, and flickering step to step. Never bright enough to be
        // mistaken for the stroke, always bright enough to be a warning.
        const op = (0.09 + 0.17 * u) * (r.tick % 3 === 1 ? 0.55 : 1);
        r.core.material.opacity = op;
        r.glow.material.opacity = op * 0.5;
        r.core.visible = r.glow.visible = true;
      },
      move(nx, nz) {
        r.x = nx; r.z = nz; r.gy = floorAt(nx, nz);
        r.anchors = anchors(nx, nz, r.gy, lcg(posSeed(nx, nz)));
        r.h = Math.max(1, r.anchors[0].y - r.gy);
        r.paths = null;
      },
      dispose() { hideLeader(r); },
    };
    handle.set(0);
    return handle;
  }

  // ============================================================
  // BUS REGISTRATION — `lightning` becomes an ordnance row like any other,
  // so anything in the game can fire one and nobody re-types a bolt.
  //
  // The row is deliberately unlike every warhead in the table: fire 0 (no fuel
  // at the contact), debris 0 (nothing to throw), struct small (a strike
  // scorches and cracks masonry; it does not open a nine-metre hole). Priced
  // through the kinetic law it would be nonsense, so it simply is not — the
  // energy of a stroke is electrical, and `power` here is a FX scale.
  // ============================================================
  let wired = false;
  function wire() {
    if (wired || !CBZ.impact || !CBZ.impact.fx || !CBZ.impact.define) return;
    wired = true;
    try {
      CBZ.impact.fx("lightning", function (x, y, z, row, opts) {
        const bag = (opts && opts.fx) || null;
        strike(x, z, {
          y: y - 0.4,
          groundScale: bag && bag.groundScale != null ? bag.groundScale : 1,
          power: 0.85 + 0.5 * ((opts && opts.scale) || 1),
          sfx: !(opts && opts.quiet),
          flash: opts && opts.flash != null ? opts.flash : 1,
          seed: opts && opts.seed,
        });
      });
      // No `shake` and no `sfx` on the row: this composer owns both, because
      // the shake belongs to the first return stroke and the audio is a
      // crack-then-roll PAIR that a single row cue cannot express.
      CBZ.impact.define("lightning", {
        power: 0.6, radius: 4.5, struct: 0.4, pen: 0.5, fire: 0, debris: 0,
        fx: "lightning",
      });
    } catch (e) { wired = false; }
  }
  wire();
  CBZ.onAlways(0.5, wire);

  // ============================================================
  // RESET. Scars are world state and must not survive the world.
  // ============================================================
  function reset() {
    for (let i = 0; i < bolts.length; i++) hideBolt(bolts[i]);
    for (let i = 0; i < leaders.length; i++) hideLeader(leaders[i]);
    for (let i = 0; i < flashes.length; i++) hideFlash(flashes[i]);
    for (let i = 0; i < scars.length; i++) {
      const s = scars[i];
      s.geo.setDrawRange(0, 0);
      s.dark.material.opacity = 0;
      s.fade = 0;
    }
    scarNext = 0;
  }
  CBZ.lightningFxReset = reset;

  let lastMode = null;
  CBZ.onAlways(28.07, function () {
    const m = CBZ.game ? CBZ.game.mode : null;
    if (m === lastMode) return;
    lastMode = m;
    reset();
  });

  CBZ.lightningStrike = strike;
  CBZ.lightningLeader = leader;
  CBZ.lightningArc = flashArc;
  CBZ.lightningFxAudit = function () {
    let live = 0, litScars = 0;
    for (let i = 0; i < bolts.length; i++) if (bolts[i].live) live++;
    for (let i = 0; i < scars.length; i++) if (scars[i].fade > 0) litScars++;
    return {
      on: CBZ.CONFIG.LIGHTNING_FX_V2 !== false,
      strikes: audit.strikes, strokes: audit.strokes, scarsCut: audit.scars,
      live: live, scars: litScars, boltPool: bolts.length,
      leaders: leaders.length, flashes: audit.flashes, wired: wired,
    };
  };
})();
