/* ============================================================
   systems/gunfx.js — lightweight, mode-AGNOSTIC gunfire visuals
   (tracer beams + muzzle flashes) for the prison/escape game,
   where the survival VFX kit (CBZ.fx) is gated off.

   Used by the watch-tower armed response (systems/capture.js) and
   by armed inmates returning fire in a stand-off (systems/
   intimidate.js). Everything is pooled and self-animating on a
   single always-updater; no per-frame allocation.

     CBZ.tracer(from, to, opts)  — a fading line + (by default) a
                                   muzzle flash at `from`.
     CBZ.muzzleFlash(pos, opts)  — a brief additive glow.

   `from`/`to` are any {x,y,z}. opts: {color, life, muzzle:false,
   muzzleScale, scale}.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;

  // ---- pooled fading tracer lines ----
  const linePool = [];
  const liveLines = [];
  function takeLine() {
    let m = linePool.pop();
    if (!m) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.95, depthWrite: false });
      m = new THREE.Line(geo, mat);
      m.frustumCulled = false; m.renderOrder = 8;
      scene.add(m);
    }
    return m;
  }

  // ---- pooled muzzle-flash sprites (a soft additive glow) ----
  let flashTex = null;
  function makeFlashTex() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,244,200,1)");
    g.addColorStop(0.4, "rgba(255,184,80,0.7)");
    g.addColorStop(1, "rgba(255,120,30,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const flashPool = [];
  const liveFlashes = [];
  function takeFlash() {
    let s = flashPool.pop();
    if (!s) {
      if (!flashTex) flashTex = makeFlashTex();
      s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTex, transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      s.renderOrder = 9;
      scene.add(s);
    }
    return s;
  }

  CBZ.muzzleFlash = function (pos, opts) {
    opts = opts || {};
    const s = takeFlash();
    s.position.set(pos.x, pos.y, pos.z);
    const sc = (opts.scale || 1) * (0.7 + Math.random() * 0.5);
    s.scale.set(sc, sc, sc);
    s.material.opacity = 1;
    s.visible = true;
    const life = opts.life || 0.06;
    liveFlashes.push({ spr: s, life: life, max: life });
    return s;
  };

  CBZ.tracer = function (from, to, opts) {
    opts = opts || {};
    const m = takeLine();
    const p = m.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x;   p[4] = to.y;   p[5] = to.z;
    m.geometry.attributes.position.needsUpdate = true;
    m.material.color.setHex(opts.color != null ? opts.color : 0xfff2b0);
    m.material.opacity = 0.95;
    m.visible = true;
    const life = opts.life || 0.07;
    liveLines.push({ mesh: m, life: life, max: life });
    if (opts.muzzle !== false) CBZ.muzzleFlash(from, { scale: opts.muzzleScale || 0.9 });
    return m;
  };

  // one always-updater fades + recycles every transient (runs in all modes,
  // like the rig/facial layers, so brief bursts never freeze mid-fade).
  CBZ.onAlways(54, function (dt) {
    for (let i = liveLines.length - 1; i >= 0; i--) {
      const t = liveLines[i];
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / t.max) * 0.95;
      if (t.life <= 0) { t.mesh.visible = false; linePool.push(t.mesh); liveLines.splice(i, 1); }
    }
    for (let i = liveFlashes.length - 1; i >= 0; i--) {
      const f = liveFlashes[i];
      f.life -= dt;
      f.spr.material.opacity = Math.max(0, f.life / f.max);
      if (f.life <= 0) { f.spr.visible = false; flashPool.push(f.spr); liveFlashes.splice(i, 1); }
    }
  });
})();
