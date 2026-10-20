/* ============================================================
   city/newsstudio.js — THE NEWS ONE STUDIO. The picture behind every TV.

   OWNER: "the TV is super fake and shows a fake person instead of an actual
   character in the game. It doesn't have to be a real character, but right
   now it doesn't look like the characters in the game look."

   The anchor was a 2D cartoon painted into city/newsroom.js's canvas: an
   ellipse head, four rectangles of eyes and brows, a trapezoid suit. Now the
   anchor IS a game character: CBZ.human.build (entities/character.js), a
   heritage.js face, a suit from the one wardrobe (CBZ.human.dress ->
   city/outfits.js + clothes.js), sitting through the rig's own seated pose,
   blinking and looking into the lens through systems/facial.js
   (rig.faceCamera), and moving the mouth to the words he or she is reading
   (rig._say, the same channel the over-head speech lines drive).

   THE SET (its own THREE.Scene, never added to the world): an anchor desk
   with papers, a chair back, a backdrop of the city skyline by the real hour
   (day or night), light panels, a lighting truss with cans, a floor, and
   three directional lights plus a hemisphere (no point or spot lights:
   core/lightpin.js budgets those for the world scene only).

   THE PICTURE (one for every TV): two 512x288 WebGLRenderTargets, ping-
   ponged. Each frame draws (1) the content, which is the studio, or the REAL
   CITY seen from a field camera on a kerb near the player (a "field report"),
   or nothing (the weather map is a full-frame graphic), then (2) newsroom's
   overlay canvas (bug, lower third, headline, bottom line) on a screen quad
   on top. The TV material then samples the target just drawn. Ping-pong is
   why a TV inside a field shot never samples the target being written.

   WHO DECIDES WHEN: city/newsroom.js. It calls render() only while a screen
   is ON SCREEN and within 40 m, at 8 fps (anchor) or 5 fps (field). This file
   never ticks on its own.

   PUBLIC: CBZ.newsStudio = { ok, render(shot, overlayTex, dt), say(text),
     framing(kind), field(), fieldSpot, texture(), audit() }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const RW = 512, RH = 288;
  const VFOV = 26;                       // the studio lens (deg, vertical)
  const FIELD_FOV = 52;
  const FIELD_FAR = 320;

  const S = {
    built: false, failed: false, why: null,
    scene: null, cam: null, fieldCam: null,
    ov: null, ovCam: null, ovMat: null,
    rtA: null, rtB: null, front: null,
    anchors: {}, anchor: null, shift: null,
    frames: {}, framing: "desk",
    backdrop: null, bdCtx: null, bdTex: null, bdNight: null,
    renders: 0, fieldRenders: 0, ms: 0, msField: 0, last: 0,
    fieldSpot: null, say: null, firstKey: null,
  };

  function ok() {
    if (S.failed) return false;
    const R = CBZ.renderer;
    if (!R || typeof R.setRenderTarget !== "function") return false;
    if (!CBZ.human || !CBZ.human.build || !CBZ.animChar) return false;
    return typeof document !== "undefined";
  }
  function hour() { try { return CBZ.citySunHour ? +CBZ.citySunHour() : 12; } catch (e) { return 12; } }
  function night() { const h = hour(); return h < 6.5 || h >= 19.5; }

  /* ---- materials (the set's own: nothing here is shared with the world) -- */
  function std(color, rough, metal) {
    return new THREE.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.6 : rough, metalness: metal || 0 });
  }
  function glow(color) {
    const m = new THREE.MeshBasicMaterial({ color: color });
    m.toneMapped = false;
    return m;
  }
  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = false;
    S.scene.add(m);
    return m;
  }

  /* ---- the backdrop: the skyline behind the desk, by the real hour -------- */
  function paintBackdrop() {
    const c = S.bdCtx, W = 1024, H = 512, nt = night();
    S.bdNight = nt;
    const sky = c.createLinearGradient(0, 0, 0, H);
    if (nt) { sky.addColorStop(0, "#050b1c"); sky.addColorStop(0.6, "#12264e"); sky.addColorStop(1, "#27477c"); }
    else { sky.addColorStop(0, "#4f86c2"); sky.addColorStop(0.65, "#9cc3e6"); sky.addColorStop(1, "#d9e6ef"); }
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    // three rows of towers, far to near, with lit windows at night
    let seed = 7;
    const rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const rows = nt ? ["#0b1630", "#08101f", "#050a14"] : ["#7d93ab", "#5d7187", "#3e4c5d"];
    for (let r = 0; r < 3; r++) {
      let x = -10;
      const base = H * (0.62 + r * 0.12);
      while (x < W) {
        const w = 26 + rnd() * 58, h = (60 + rnd() * 190) * (1 - r * 0.22);
        c.fillStyle = rows[r]; c.fillRect(x, base - h, w, H - base + h);
        if (rnd() < 0.18) c.fillRect(x + w * 0.45, base - h - 30, 3, 30);       // a mast
        const lit = nt ? (r === 2 ? 0.30 : 0.42) : 0.10;
        c.fillStyle = nt ? "rgba(255,214,140,.85)" : "rgba(220,235,250,.45)";
        for (let wy = base - h + 8; wy < base - 4; wy += 9) {
          for (let wx = x + 4; wx < x + w - 5; wx += 7) if (rnd() < lit) c.fillRect(wx, wy, 3, 4);
        }
        x += w + 2 + rnd() * 6;
      }
    }
    // the studio glass: a faint grid and a cool wash over the photo
    c.fillStyle = nt ? "rgba(40,90,170,.18)" : "rgba(30,60,120,.16)"; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(255,255,255,.05)";
    for (let i = 1; i < 8; i++) c.fillRect(i * (W / 8) - 1, 0, 2, H);
    if (S.bdTex) S.bdTex.needsUpdate = true;
  }

  /* ---- THE ANCHOR: a real person off the one human door ----------------- */
  const ANCHORS = {
    // day and night desks, each a stable person (seeded heritage roll)
    day:   { build: "f", outfit: "exec_navy", seed: "newsone|anchor|day" },
    night: { build: "m", outfit: "official_suit", seed: "newsone|anchor|night" },
  };
  function buildAnchor(key) {
    const A = ANCHORS[key];
    const fem = A.build === "f";
    const body = { build: A.build, legs: 0x1d2433, torso: 0x1d2433, collar: 0x1d2433, arms: 0x1d2433, shoes: 0x16161a };
    const look = CBZ.heritageRoll ? CBZ.heritageRoll(null, A.seed) : null;
    if (look) {
      body.skin = look.skin; body.hair = look.hair;
      if (look.eye != null) body.eye = look.eye;
      body.nose = look.nose; body.lips = look.lips; body.eyeShape = look.eyeShape;
      if (!fem) body.hairStyle = look.bald ? "buzz" : "short";       // an anchor is clean-shaven and groomed
    } else { body.skin = 0xc9a07a; body.hair = 0x2a1f18; }
    if (fem) {
      body.longHair = true;
      body.hairStyle = CBZ.cityHairStyleFor ? (CBZ.cityHairStyleFor({ seed: 41, sex: "f", band: "adult", job: "news anchor" }) || "long") : "long";
    }
    const ch = CBZ.human.build(body);
    if (!ch || !ch.group) return null;
    try { CBZ.human.dress(ch, A.outfit); } catch (e) {}
    ch.sitting = true;
    ch.seatRef = { cushion: 0.47, floorBelow: 0, kind: "exec" };   // upright: a desk chair worn for the camera
    ch._facePlayer = true;           // facial.js leaves the neck to this file (the nod, the turn)
    ch.faceCamera = S.cam;           // and the eyes go to the lens
    ch.group.name = "newsone-anchor";
    S.scene.add(ch.group);
    const rec = { key: key, ch: ch, frame: null };
    settle(rec);
    rec.frame = measure(rec);
    ch.group.visible = false;
    return rec;
  }

  // the anchor's own pose over the seated rig: forearms on the desk, hands
  // that talk, a head that nods on the stresses and drifts between lines
  function pose(ch, t, talking) {
    const P = ch.parts, J = ch.low;
    if (!P || !J) return;
    // a gesture every few seconds while reading: one hand lifts, opens, comes back
    const cyc = 3.8, k = Math.floor(t / cyc), u = (t - k * cyc) / 1.7;
    const g = talking && u < 1 ? Math.pow(Math.sin(Math.PI * u), 2) * (k % 3 === 2 ? 0.55 : 1) : 0;
    const gl = (k & 1) ? g : 0, gr = (k & 1) ? 0 : g;
    const both = talking && (k % 5 === 4) ? g * 0.6 : 0;          // now and then both hands open
    const L = gl + both, Rr = gr + both;
    if (P.la) { P.la.rotation.set(-0.42 - L * 0.32, -0.26 + L * 0.12, 0.15 + L * 0.10); }
    if (P.ra) { P.ra.rotation.set(-0.42 - Rr * 0.32, 0.26 - Rr * 0.12, -0.15 - Rr * 0.10); }
    if (J.la) J.la.rotation.set(-1.22 - L * 0.42, 0, 0);
    if (J.ra) J.ra.rotation.set(-1.22 - Rr * 0.42, 0, 0);
    if (CBZ.human.clampArm) { try { CBZ.human.clampArm(ch); } catch (e) {} }
    if (ch.setHandPose) {
      try { ch.setHandPose("l", L > 0.35 ? "open" : "relaxed"); ch.setHandPose("r", Rr > 0.35 ? "open" : "relaxed"); } catch (e) {}
    }
    if (ch.neck) {
      const nod = talking ? 0.045 * Math.sin(t * 2.3) * Math.max(0, Math.sin(t * 0.9)) : 0;
      ch.neck.rotation.x = 0.02 + nod + 0.015 * Math.sin(t * 0.31);
      ch.neck.rotation.y = 0.05 * Math.sin(t * 0.23) + (gl - gr) * 0.06;
      ch.neck.rotation.z = 0.025 * Math.sin(t * 0.17 + 1);
    }
    if (ch.body) ch.body.rotation.x += 0.035 * (L + Rr);
  }
  function step(rec, dt, t, talking) {
    const ch = rec.ch;
    try { CBZ.animChar(ch, 0, dt); } catch (e) {}
    pose(ch, t, talking);
  }
  function settle(rec) {
    for (let i = 0; i < 45; i++) step(rec, 1 / 30, i / 30, false);
    rec.ch.group.updateMatrixWorld(true);
  }

  /* ---- framing: measured off the seated body, never guessed --------------- */
  const _b = new THREE.Box3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  function measure(rec) {
    const ch = rec.ch;
    // the head's centre (the skull + hair box), the elbows, then turn the body
    // a little to the lens and measure again
    function read() {
      ch.group.updateMatrixWorld(true);
      _b.setFromObject(ch.head);
      const hc = _b.getCenter(new THREE.Vector3());
      const el = new THREE.Vector3(), er = new THREE.Vector3();
      (ch.low.la || ch.head).getWorldPosition(el);
      (ch.low.ra || ch.head).getWorldPosition(er);
      return { hc: hc, elY: Math.min(el.y, er.y), elZ: Math.max(el.z, er.z) };
    }
    let m = read();
    const deskY0 = m.elY - 0.045;
    const Fh0 = Math.max(0.9, (m.hc.y - deskY0) / 0.40);
    const d0 = (Fh0 / 2) / Math.tan(THREE.MathUtils.degToRad(VFOV / 2));
    ch.group.rotation.y = 0.7 * Math.atan2(0.2 * Fh0 * RW / RH, d0);
    settle(rec);
    m = read();
    const deskY = m.elY - 0.045;
    const F = { hc: m.hc, deskY: deskY, deskZ: m.elZ - 0.03, cams: {} };
    // desk: head at 30% from the top, desk top at 70% (just under the tag);
    // close: tighter, head at 34%. The anchor sits at 30% from the left so
    // the over-the-shoulder box has the right of the frame.
    [["desk", 1.0, 0.30], ["close", 0.70, 0.34]].forEach(function (row) {
      const Fh = Math.max(0.9, (m.hc.y - deskY) / 0.40) * row[1];
      const Fw = Fh * RW / RH;
      const d = (Fh / 2) / Math.tan(THREE.MathUtils.degToRad(VFOV / 2));
      const cx = m.hc.x + 0.2 * Fw, cy = m.hc.y - (0.5 - row[2]) * Fh;
      F.cams[row[0]] = { pos: new THREE.Vector3(cx, m.hc.y - 0.04, m.hc.z + d), at: new THREE.Vector3(cx, cy, m.hc.z), Fh: Fh, d: d };
    });
    return F;
  }

  /* ---- the set, fitted to the anchor's measured frame --------------------- */
  function buildSet(F) {
    const hc = F.hc, deskY = F.deskY, z0 = F.deskZ;
    const cam = F.cams.desk;
    const cx = cam.at.x, cy = cam.at.y;
    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), std(0x0d1524, 0.35, 0.15));
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, hc.z - 1);
    S.scene.add(floor);
    // the backdrop: the city skyline
    const bz = hc.z - 2.4;
    const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 512;
    S.bdCtx = cv.getContext("2d");
    S.bdTex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) S.bdTex.encoding = THREE.sRGBEncoding;
    paintBackdrop();
    const bdMat = new THREE.MeshBasicMaterial({ map: S.bdTex, color: 0xb4b4b4 });
    bdMat.toneMapped = false;
    const bd = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), bdMat);
    bd.position.set(cx, 1.8, bz);
    S.scene.add(bd);
    S.backdrop = bd;
    // a frame round the backdrop and two tall light panels at the edges of shot
    const frameM = std(0x1a2236, 0.5, 0.3);
    box(7.4, 0.10, 0.10, frameM, cx, 3.62, bz + 0.02);
    box(7.4, 0.14, 0.10, frameM, cx, 0.07, bz + 0.02);
    const panel = glow(0x9cc4ff);
    box(0.14, 2.7, 0.06, panel, cx - 2.35, 1.35, bz + 0.5);
    box(0.14, 2.7, 0.06, panel, cx + 2.35, 1.35, bz + 0.5);
    box(0.08, 2.7, 0.06, glow(0xc0392b), cx + 2.6, 1.35, bz + 0.5);
    // the lighting truss across the top of the shot, with cans
    const tz = hc.z - 1.4, dz = cam.pos.z - tz;
    const topY = cy + (cam.Fh / 2) * (dz / cam.d) - 0.04;
    const truss = std(0x22252b, 0.55, 0.6);
    box(6.4, 0.06, 0.06, truss, cx, topY, tz);
    box(6.4, 0.06, 0.06, truss, cx, topY - 0.16, tz);
    const canM = std(0x101114, 0.5, 0.5), lens = glow(0xfff1d6);
    for (let i = 0; i < 6; i++) {
      const x = cx - 2.5 + i;
      box(0.16, 0.2, 0.22, canM, x, topY - 0.3, tz);
      const l = box(0.12, 0.12, 0.01, lens, x, topY - 0.31, tz + 0.115);
      l.rotation.x = -0.35;
    }
    // the chair back behind the shoulders
    box(0.58, Math.max(0.2, hc.y - 0.14 - (deskY - 0.1)), 0.09, std(0x18181d, 0.55, 0.05),
      hc.x, (hc.y - 0.14 + deskY - 0.1) / 2, hc.z - 0.27);
    // THE DESK: a glossy top, a front panel with the channel's red line and
    // its name, papers under the hands
    const dW = 2.6, dD = 0.82, dX = hc.x + 0.35;
    box(dW, 0.05, dD, std(0x1b2a47, 0.28, 0.25), dX, deskY - 0.025, z0 + dD / 2);
    const front = box(dW, Math.max(0.2, deskY - 0.05), 0.06, std(0x111c33, 0.4, 0.2), dX, (deskY - 0.05) / 2, z0 + dD - 0.03);
    box(dW + 0.01, 0.035, 0.065, glow(0xc0392b), dX, deskY - 0.09, z0 + dD - 0.03);
    // the desk's name plate (a canvas, painted once)
    const lc = document.createElement("canvas"); lc.width = 512; lc.height = 128;
    const x2 = lc.getContext("2d");
    x2.fillStyle = "#0f1a31"; x2.fillRect(0, 0, 512, 128);
    x2.fillStyle = "#c0392b"; x2.fillRect(56, 34, 120, 60);
    x2.fillStyle = "#ffffff"; x2.font = "bold 46px Arial, sans-serif"; x2.textBaseline = "middle";
    x2.fillText("NEWS", 66, 66); x2.fillText("ONE", 196, 66);
    const lt = new THREE.CanvasTexture(lc);
    if (THREE.sRGBEncoding != null) lt.encoding = THREE.sRGBEncoding;
    const plateM = new THREE.MeshBasicMaterial({ map: lt });
    plateM.toneMapped = false;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), plateM);
    plate.position.set(dX, Math.max(0.2, deskY - 0.32), front.position.z + 0.032);
    S.scene.add(plate);
    const paper = std(0xeeeae2, 0.9, 0);
    const p1 = box(0.22, 0.006, 0.30, paper, hc.x - 0.05, deskY + 0.003, z0 + 0.30); p1.rotation.y = 0.08;
    const p2 = box(0.22, 0.006, 0.30, paper, hc.x - 0.03, deskY + 0.009, z0 + 0.31); p2.rotation.y = -0.05;
    // a mug and a closed laptop at the far end
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.10, 14), std(0xd9d4c8, 0.5, 0));
    mug.position.set(hc.x + 0.62, deskY + 0.05, z0 + 0.22); S.scene.add(mug);
    box(0.34, 0.02, 0.24, std(0x8c9096, 0.35, 0.7), hc.x + 1.05, deskY + 0.01, z0 + 0.28);

    // THE LIGHTS: key, fill, rim and a sky/ground ambient (directional only:
    // see the header)
    const hemi = new THREE.HemisphereLight(0xc9dbff, 0x20242c, 0.55);
    S.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff0dc, 1.25);
    key.position.set(hc.x - 1.6, hc.y + 1.9, hc.z + 3.0);
    const fill = new THREE.DirectionalLight(0xd9e6ff, 0.45);
    fill.position.set(hc.x + 2.6, hc.y + 0.6, hc.z + 2.2);
    const rim = new THREE.DirectionalLight(0x9cc4ff, 0.85);
    rim.position.set(hc.x + 0.6, hc.y + 2.4, hc.z - 3.0);
    const tgt = new THREE.Object3D(); tgt.position.copy(hc); S.scene.add(tgt);
    [key, fill, rim].forEach(function (L) { L.castShadow = false; L.target = tgt; S.scene.add(L); });
  }

  function build() {
    if (S.built || S.failed) return S.built;
    try {
      S.scene = new THREE.Scene();
      S.scene.name = "newsone-studio";
      S.scene.background = new THREE.Color(0x05080f);
      S.cam = new THREE.PerspectiveCamera(VFOV, RW / RH, 0.1, 40);
      S.scene.add(S.cam);                         // facial.js reads its matrixWorld
      S.fieldCam = new THREE.PerspectiveCamera(FIELD_FOV, RW / RH, 0.3, FIELD_FAR);
      const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
      S.rtA = new THREE.WebGLRenderTarget(RW, RH, opts);
      S.rtB = new THREE.WebGLRenderTarget(RW, RH, opts);
      [S.rtA, S.rtB].forEach(function (rt) {
        rt.texture.generateMipmaps = false;
        if (THREE.sRGBEncoding != null) rt.texture.encoding = THREE.sRGBEncoding;   // like the canvas it replaces
      });
      // the overlay pass: newsroom's canvas on a screen quad
      S.ov = new THREE.Scene();
      S.ovCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      S.ovMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
      S.ovMat.toneMapped = false;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), S.ovMat);
      q.frustumCulled = false;
      S.ov.add(q);
      // the set is built round whichever anchor is on shift first
      const first = buildAnchor(shiftNow());
      if (!first) throw new Error("no anchor");
      S.anchors[first.key] = first;
      S.firstKey = first.key;
      buildSet(first.frame);
      S.built = true;
      useAnchor(first.key);
    } catch (e) {
      S.failed = true; S.why = String(e && e.message || e);
    }
    return S.built;
  }
  function shiftNow() { const h = hour(); return h >= 5 && h < 17 ? "day" : "night"; }
  function useAnchor(key) {
    if (S.anchor && S.anchor.key === key) return;
    let rec = S.anchors[key];
    if (!rec) { try { rec = buildAnchor(key); } catch (e) { rec = null; } if (rec) S.anchors[key] = rec; }
    if (!rec) return;
    if (S.anchor) S.anchor.ch.group.visible = false;
    // the set was fitted to the first anchor. The next one sits at the same
    // desk: the chair goes up or down and in or out until THIS body's elbows
    // are on its edge, and the lens follows the head by the same amount.
    const first = S.anchors[S.firstKey];
    if (first && rec !== first && !rec.fitted) {
      rec.fitted = true;
      const F0 = first.frame, F = rec.frame;
      const dy = F0.deskY - F.deskY, dz = F0.deskZ - F.deskZ;
      rec.ch.group.position.y += dy;
      rec.ch.group.position.z += dz;
      const hy = F.hc.y + dy - F0.hc.y, hz = F.hc.z + dz - F0.hc.z;
      ["desk", "close"].forEach(function (k) {
        const a = F0.cams[k];
        F.cams[k] = { pos: a.pos.clone().add(new THREE.Vector3(0, hy, hz)), at: a.at.clone().add(new THREE.Vector3(0, hy, hz)), Fh: a.Fh, d: a.d };
      });
    }
    S.anchor = rec;
    S.shift = key;
    if (S.say) rec.ch._say = S.say;
    aim();
  }
  function aim() {
    if (!S.anchor) return;
    const c = S.anchor.frame.cams[S.framing] || S.anchor.frame.cams.desk;
    S.cam.position.copy(c.pos);
    S.cam.lookAt(c.at);
    S.cam.updateMatrixWorld(true);
  }

  /* ---- the field camera: a kerb near the player, looking down the street -- */
  function groundY(x, z, fromY) {
    try { if (CBZ.groundAt) { const y = +CBZ.groundAt(x, z, fromY); if (isFinite(y)) return y; } } catch (e) {}
    try { if (CBZ.cityGroundHeightAt) return +CBZ.cityGroundHeightAt(x, z) || 0; } catch (e) {}
    return 0;
  }
  function field() {
    const P = CBZ.player;
    if (!P || !P.pos) return null;
    const px = P.pos.x, pz = P.pos.z, py = P.pos.y || 0;
    const roads = CBZ.city && CBZ.city.roads;
    const RG = CBZ.roadGraph;
    const G = roads && RG && RG.of ? RG.of(roads) : null;
    let spot = null;
    for (let i = 0; i < 8 && !spot && G && RG.snap; i++) {
      const a = Math.random() * Math.PI * 2, r = 35 + Math.random() * 60;
      const s = RG.snap(G, px + Math.cos(a) * r, pz + Math.sin(a) * r);
      if (!s || !G.segs[s.si]) continue;
      const sg = G.segs[s.si];
      if (sg.r && (sg.r.district === "highway" || sg.r.elevated || sg.r.bridge)) continue;
      // stand on the kerb, look along the street toward the player's side
      const nx = -sg.uz, nz = sg.ux, side = Math.random() < 0.5 ? 1 : -1;
      const x = s.x + nx * sg.hw * 0.85 * side, z = s.z + nz * sg.hw * 0.85 * side;
      let dx = sg.ux, dz = sg.uz;
      if ((px - x) * dx + (pz - z) * dz < 0) { dx = -dx; dz = -dz; }
      spot = { x: x, z: z, dx: dx, dz: dz };
    }
    if (!spot) {
      const a = Math.random() * Math.PI * 2;
      spot = { x: px + Math.cos(a) * 26, z: pz + Math.sin(a) * 26, dx: -Math.cos(a), dz: -Math.sin(a) };
    }
    const gy = groundY(spot.x, spot.z, py + 3);
    spot.y = gy + 1.9;
    // a slow pan across the street while the shot is up
    spot.yaw = Math.atan2(spot.dx, spot.dz) + (Math.random() - 0.5) * 0.5;
    spot.pan = (Math.random() < 0.5 ? 1 : -1) * 0.035;
    spot.t = 0;
    S.fieldSpot = spot;
    return spot;
  }
  function aimField(dt) {
    const s = S.fieldSpot;
    if (!s) return false;
    s.t += dt;
    const yaw = s.yaw + s.pan * s.t, c = S.fieldCam;
    c.position.set(s.x, s.y, s.z);
    c.lookAt(s.x + Math.sin(yaw) * 10, s.y - 0.9, s.z + Math.cos(yaw) * 10);
    c.updateMatrixWorld(true);
    return true;
  }

  /* ---- speaking: the words on screen, read aloud by the anchor's mouth ---- */
  // the line is kept here and handed to whichever anchor is at the desk (the
  // first story arrives before the studio is built; a shift change mid-line)
  function say(text) {
    if (!text) return;
    S.say = { t0: CBZ.now || 0, text: String(text), rate: 13 };
    if (S.anchor) S.anchor.ch._say = S.say;
  }
  function talking() {
    const s = S.anchor && S.anchor.ch._say;
    if (!s) return false;
    return (CBZ.now || 0) - s.t0 < s.text.length / (s.rate || 13) * 1000 + 300;
  }

  /* ---- ONE PICTURE ------------------------------------------------------ */
  let _clock = 0;
  function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
  function render(shot, overlay, dt) {
    if (!ok() || !build()) return null;
    const R = CBZ.renderer;
    dt = Math.min(0.4, Math.max(0, dt || 0));
    _clock += dt;
    const t0 = now();
    // the anchor on shift, the backdrop's sky by the hour
    if (shot === "anchor") {
      const sh = shiftNow();
      if (sh !== S.shift) useAnchor(sh);
      if (S.bdNight !== night()) paintBackdrop();
      const ch = S.anchor.ch;
      ch.group.visible = true;
      step(S.anchor, dt, _clock, talking());
    } else if (S.anchor) S.anchor.ch.group.visible = false;
    if (shot === "field" && !(CBZ.scene && aimField(dt))) shot = "weather";

    const back = S.front === S.rtA ? S.rtB : S.rtA;
    const prevTarget = R.getRenderTarget();
    const prevAutoClear = R.autoClear;
    const sm = R.shadowMap;
    const prevAuto = sm ? sm.autoUpdate : false, prevNeeds = sm ? sm.needsUpdate : false;
    const prevExp = R.toneMappingExposure;
    let drawn = false;
    try {
      if (sm) { sm.autoUpdate = false; sm.needsUpdate = false; }   // never steal or spend the world's shadow refresh
      R.setRenderTarget(back);
      R.autoClear = true;
      if (shot === "anchor") {
        // the studio has its own lights: a fixed exposure, not the street's
        if (CBZ.toneMappingOn) R.toneMappingExposure = CBZ.renderExposureBase || 1;
        R.render(S.scene, S.cam);
        R.toneMappingExposure = prevExp;
      } else if (shot === "field") {
        if (CBZ.carInstanceFullDraw) CBZ.carInstanceFullDraw();
        R.render(CBZ.scene, S.fieldCam);
        S.fieldRenders++;
      } else {
        R.clear(true, true, false);
      }
      if (overlay) {
        if (S.ovMat.map !== overlay) { S.ovMat.map = overlay; S.ovMat.needsUpdate = true; }
        R.autoClear = false;
        R.render(S.ov, S.ovCam);
      }
      drawn = true;
    } catch (e) {
      S.why = String(e && e.message || e);
    } finally {
      R.toneMappingExposure = prevExp;
      R.autoClear = prevAutoClear;
      R.setRenderTarget(prevTarget || null);
      if (sm) { sm.autoUpdate = prevAuto; sm.needsUpdate = prevNeeds; }
    }
    const ms = now() - t0;
    if (shot === "field") S.msField = S.msField ? S.msField * 0.8 + ms * 0.2 : ms;
    else S.ms = S.ms ? S.ms * 0.8 + ms * 0.2 : ms;
    S.renders++;
    S.last = CBZ.now || 0;
    if (!drawn) return null;
    S.front = back;
    return back.texture;
  }
  // nothing on screen: stop the face work (facial.js skips a hidden rig)
  function idle() { if (S.anchor) S.anchor.ch.group.visible = false; }

  CBZ.newsStudio = {
    ok: ok,
    render: render,
    idle: idle,
    say: say,
    talking: talking,
    framing: function (k) { if (k && k !== S.framing && (k === "desk" || k === "close")) { S.framing = k; aim(); } return S.framing; },
    field: field,
    fieldSpot: function () { return S.fieldSpot; },
    texture: function () { return S.front ? S.front.texture : null; },
    audit: function () {
      return {
        built: S.built, failed: S.failed, why: S.why, shift: S.shift, framing: S.framing,
        anchors: Object.keys(S.anchors), renders: S.renders, fieldRenders: S.fieldRenders,
        msStudio: +S.ms.toFixed(2), msField: +S.msField.toFixed(2), target: RW + "x" + RH + " x2",
        studioMeshes: S.scene ? (function () { let n = 0; S.scene.traverse(function (o) { if (o.isMesh && o.visible) n++; }); return n; })() : 0,
      };
    },
  };
})();
