/* ============================================================
   systems/sights.js — AIMING DOWN THE SIGHTS, FOR REAL.

   OWNER (2026-09-28): "right now when you scope in, it's like a fake scope.
   It's not real scopes. You're not holding the gun up and actually looking
   through it."

   What it was: first-person "aim" slid the viewmodel 0.36 to the left and
   narrowed the lens; the sniper and the LMG optic hid the gun and hands
   entirely and put a black DOM mask with a hole in it over the screen
   (lockon.js #realScope), and a bought gunsmith optic put up a SECOND DOM
   mask of its own (city/scopeview.js). Both overlays are deleted. This file
   is the one owner of the sight picture:

     1. WHAT THE SIGHT IS. For the gun in your hands: where the EYE goes, the
        line of sight, the sight type (iron / reddot / holo / scope) and its
        magnification, and the ocular lens. Read from the gun's own ANCHORS
        when the model publishes them (contract below), otherwise derived from
        the geometry that is actually drawn: the optic's rear glass, or the
        iron line over the rear sight and the front post.
     2. BRINGING THE GUN TO THE EYE (first person). The viewmodel is SOLVED
        each frame so the sight's eye point sits on the camera and the sight
        line on the view axis — the rear notch and the front post, the dot
        glass, the scope's ocular are really in front of your eye, held by
        the same two hands that hold it at the hip. It comes up over the
        optic's own `ads` seconds, canting through the raise; breathing
        sways the gun a hair against the eye; a shot kicks it OFF the sight
        line (muzzle up, back into the face) and it settles back on.
     3. REAL GLASS. A red dot / holo is a reticle projected AT INFINITY onto
        the optic's glass (a shader on the lens computes the eye ray, so the
        dot stays on the target when the head moves and is only visible when
        you are actually behind the glass). A SCOPE is a scope: the tube and
        the ocular bell are in front of you, and through the lens a second
        camera renders the magnified world into a small render target, with
        the reticle in true milliradians and an exit-pupil shadow that swims
        in from the edge as the eye moves off axis or off the eye relief
        (the raise itself passes through it). Around the scope the world
        stays visible at 1x, dimmed by the eyepiece's shade. The render
        target only exists while a scope is up, is 320 px on a touch device,
        and never re-renders shadows.
     4. SWAY + BREATH (moved here from lockon.js): the shooter's body sway in
        real milliradians (fpsmode's playerSwayRad) applied to the ACTUAL aim
        while sighted; Shift / CBZ.fpsHoldBreath steadies a magnified optic
        for four seconds and then the body takes it back.
     5. THIRD PERSON: CBZ.playerChar.adsK (0..1) (+ aimHands from the hold
        engine, systems/actorweapons.js CBZ.holds). character.js
        raises a long gun to a cheek weld (stock up, head down and over onto
        the comb) and pushes a pistol / Uzi out to a locked arm, one-handed.
        A magnified scope still takes you to the eye (first person) while it
        is up — that is what a scope is for.

   ANCHORS. The contract is the one at the top of
   weapons/appearances/sidearm.js (model.userData.anchors): sight.pos = the
   EYE POINT, sight.quat looking down the line, sight.rear / sight.front the
   notch + post tip (or ocular + objective), eyeRelief (real m), lens
   { pos, radius }, optic { type, mag }, k = model units per real metre.
   This file reads the sight IN USE through CBZ.gunAnchors.activeSight (a
   visible fitted gunsmith optic's record over the factory one) and fills
   every field of its record from it: eye, dir, up, rear, front, lens,
   relief, type, mag. The drawn-geometry derivation below is ONLY for a
   model that publishes no anchors. One hand or two is not decided here:
   that is CBZ.holds (systems/actorweapons.js).

   ENGINE CONTRACT: plain IIFE on window.CBZ, THREE r128. The pure parts
   (resolve / fpPose) run headless in tools/ads-check.mjs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const S = CBZ.sights = CBZ.sights || {};

  /* ==========================================================================
     1) WHAT THE SIGHT IS
  ========================================================================== */
  // real metres, converted to model units per gun
  const EYE = {
    scopeRelief: 0.085,   // a rifle scope's eye relief (M3A: 3.4 in)
    cheek: 0.14,          // eye forward of the butt at a cheek weld
    dotMin: 0.07,         // never closer than this to a red dot's rear glass
    ironMin: 0.03,        // …or to a rear aperture
    pistolArm: 0.42,      // rear sight ahead of the eye, two hands out
    stubArm: 0.36,        // a stockless SMG (Uzi) held out at the eye
  };
  // weapon-data optic id -> the picture it makes
  const ROW_TYPE = { none: "none", iron: "iron", dot: "reddot", holo: "holo", mgo: "scope", acog: "scope", m3a: "scope", pgo7: "scope" };
  // gunsmith overlay name -> the picture it makes
  const FIT_TYPE = { dot: "reddot", reflex: "reddot", holo: "holo", acog: "scope", scope: "scope" };
  const HIP = 75;
  const LEAN = { iron: 12, reddot: 17, holo: 17, scope: 22, none: 0 };

  function v3(a) {
    if (!a) return null;
    if (a.isVector3) return a.clone();
    if (Array.isArray(a) && a.length >= 3) return new THREE.Vector3(+a[0], +a[1], +a[2]);
    if (typeof a.x === "number") return new THREE.Vector3(a.x, a.y, a.z);
    return null;
  }
  function q4(a) {
    if (!a) return null;
    if (a.isQuaternion) return a.clone();
    if (Array.isArray(a) && a.length >= 4) return new THREE.Quaternion(+a[0], +a[1], +a[2], +a[3]).normalize();
    if (typeof a.w === "number") return new THREE.Quaternion(a.x, a.y, a.z, a.w).normalize();
    return null;
  }
  function isHandish(o) {
    return !!(o && ((o.name && /^fp_/.test(o.name)) || (o.userData && (o.userData.fpGripHand || o.userData.grasp || o.userData.sightFx))));
  }
  // o's matrix in `root` space (root excluded); null when o is hidden on the way
  function toRoot(o, root, out) {
    out.identity();
    for (let p = o; p && p !== root; p = p.parent) {
      if (p.visible === false) return null;
      p.updateMatrix();
      out.premultiply(p.matrix);
    }
    return out;
  }
  function boxesOf(model, under, skip) {
    const out = [], M = new THREE.Matrix4();
    (under || model).traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      for (let p = o; p && p !== model; p = p.parent) { if (isHandish(p) || (skip && skip(p))) return; }
      if (!toRoot(o, model, M)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(M);
      if (!isFinite(b.min.x) || !isFinite(b.max.x)) return;
      b.obj = o;
      out.push(b);
    });
    return out;
  }
  function named(model, test) {
    let r = null;
    model.traverse(function (o) { if (!r && test(o)) r = o; });
    return r;
  }
  function visibleIn(o, model) {
    for (let p = o; p && p !== model; p = p.parent) if (p.visible === false) return false;
    return true;
  }

  /* The optic on the gun: a fitted gunsmith optic wins, then the factory
     "_baseOptic", then the RPG-7's PGO-7 (which sits beside the tube as loose
     parts). Returns the mesh boxes of just that optic, or null. */
  function opticParts(model) {
    const fitted = named(model, function (o) { return o.name === "_gmods"; });
    if (fitted) {
      const op = named(fitted, function (o) { return o.userData && o.userData.isWeaponOptic; });
      if (op && visibleIn(op, model)) return { kind: "fitted", root: op, boxes: boxesOf(model, op) };
    }
    const base = named(model, function (o) { return o.name === "_baseOptic"; });
    if (base && visibleIn(base, model)) return { kind: "base", root: base, boxes: boxesOf(model, base) };
    const pgo = named(model, function (o) { return o.name === "rpg:scope"; });
    if (pgo) {
      const all = boxesOf(model), c = new THREE.Vector3();
      const pb = all.find(function (b) { return b.obj === pgo; });
      if (pb) {
        pb.getCenter(c);
        const hx = (pb.max.x - pb.min.x) / 2 + 0.01, hy = (pb.max.y - pb.min.y) / 2 + 0.01;
        const mine = all.filter(function (b) {
          const bx = (b.min.x + b.max.x) / 2, by = (b.min.y + b.max.y) / 2;
          return Math.abs(bx - c.x) < hx && Math.abs(by - c.y) < hy;
        });
        return { kind: "pgo", root: null, boxes: mine };
      }
    }
    return null;
  }

  /* The optic's axis and its rear glass, from the drawn parts alone: the
     rear-most ROUND part (a tube, bell, eyecup or lens disc seen end-on is as
     wide as it is tall) is the ocular; its centre is the axis. A glass disc
     (thin along the bore) there wins the lens radius. */
  function opticAxis(boxes) {
    let best = null, bestZ = -Infinity, glass = null, glassZ = -Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const ex = b.max.x - b.min.x, ey = b.max.y - b.min.y, ez = b.max.z - b.min.z;
      const big = Math.max(ex, ey), small = Math.min(ex, ey);
      if (small < 0.022 || Math.abs(ex - ey) > 0.2 * big) continue;
      if (b.max.z > bestZ) { bestZ = b.max.z; best = b; }
      if (ez < 0.012 && b.max.z > glassZ) { glassZ = b.max.z; glass = b; }
    }
    if (!best) return null;
    const c = new THREE.Vector3();
    best.getCenter(c);
    let lensR = Math.min(best.max.x - best.min.x, best.max.y - best.min.y) / 2 * 0.86;
    let lensZ = best.max.z;
    if (glass && glass.max.z > bestZ - 0.04) {
      lensR = Math.min(glass.max.x - glass.min.x, glass.max.y - glass.min.y) / 2;
      lensZ = Math.max(lensZ, glass.max.z);
    }
    return { x: c.x, y: c.y, z: lensZ, r: lensR };
  }

  /* IRON SIGHTS: the front post is the highest thing in the front third of
     the gun, near the centreline; the rear sight is whatever the line from
     the post's tip back toward the eye rests on (the supporting line — the
     line of sight grazes the rear notch and everything in between is below
     it). Nothing behind the eye counts (a stock comb is under the cheek). */
  function ironLine(boxes, rearLimit) {
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < boxes.length; i++) { zMin = Math.min(zMin, boxes[i].min.z); zMax = Math.max(zMax, boxes[i].max.z); }
    const L = zMax - zMin;
    const cen = boxes.filter(function (b) { return Math.abs((b.min.x + b.max.x) / 2) < 0.045 && (b.max.x - b.min.x) < 0.3; });
    let F = null;
    const fEnd = zMin + 0.34 * L;
    for (let i = 0; i < cen.length; i++) {
      const b = cen[i];
      if (b.min.z > fEnd) continue;
      if (!F || b.max.y > F.y) F = { x: (b.min.x + b.max.x) / 2, y: b.max.y, z: Math.min(fEnd, (b.min.z + b.max.z) / 2) };
    }
    if (!F) return null;
    let R = null, bestS = -Infinity;
    const r0 = F.z + 0.10 * L;
    for (let i = 0; i < cen.length; i++) {
      const b = cen[i];
      const a = Math.max(b.min.z, r0), e = Math.min(b.max.z, rearLimit);
      if (e <= a) continue;
      for (const z of [a, e]) {
        const s = (b.max.y - F.y) / (z - F.z);
        if (s > bestS) { bestS = s; R = { x: F.x, y: b.max.y, z: z }; }
      }
    }
    if (!R) R = { x: F.x, y: F.y, z: F.z + 0.3 * L };
    return { F: new THREE.Vector3(F.x, F.y, F.z), R: new THREE.Vector3(R.x, R.y, R.z) };
  }

  function weaponRow(w) {
    if (!w) return null;
    if (typeof w === "string") return CBZ.weaponById ? CBZ.weaponById(w) : null;
    return w;
  }
  function stubby(w) {
    return !!(w && (w.slot === "pistol" || (w.real && w.real.len && w.real.len < 0.34)));
  }
  function fittedSpec(w) {
    if (!w || !CBZ.gunModsScopeOf) return null;
    try { return CBZ.gunModsScopeOf(w.id || w.key) || null; } catch (e) { return null; }
  }

  /* resolve(model, w) -> the sight record, cached on the model and rebuilt
     when the fitted optic changes. Model space. */
  S.resolve = function (model, w) {
    if (!model) return null;
    w = weaponRow(w);
    const fit = fittedSpec(w);
    const gm = named(model, function (o) { return o.name === "_gmods"; });
    const key = (fit ? fit.id : "-") + "|" + (gm ? gm.uuid : "-");
    const ud = model.userData;
    if (ud._sight && ud._sightKey === key) return ud._sight;
    const rec = build(model, w, fit);
    ud._sight = rec; ud._sightKey = key;
    return rec;
  };

  /* The sight the anchors publish for the model as it is NOW: a visible
     fitted optic's own record (CBZ.gunAnchors.activeSight) over the factory
     one. Returns { sight, lens, optic, root } or null (no anchors). */
  function anchoredSight(model) {
    const A = model.userData.anchors;
    if (!A) return null;
    const GA = CBZ.gunAnchors;
    const act = (GA && GA.activeSight) ? GA.activeSight(model) : { sight: A.sight, lens: A.lens, optic: A.optic };
    if (!act) return null;
    // the node whose parts ARE the optic in use (its painted reticle is
    // hidden under the live glass): a fitted optic, else the factory one
    let root = null;
    model.traverse(function (o) {
      if (root || o === model || !o.userData.opticAnchors || !visibleIn(o, model)) return;
      if (o.name !== "_baseOptic") root = o;
    });
    if (!root) { const b = named(model, function (o) { return o.name === "_baseOptic"; }); if (b && visibleIn(b, model)) root = b; }
    act.root = root;
    return act;
  }

  function build(model, w, fit) {
    const ud = model.userData;
    const AS = anchoredSight(model);
    const A = ud.anchors || null;
    // units: the anchors' k (model units per real metre) is THE scale
    const upm = (A && A.k) || ud.unitsPerMetre || 2;
    const row = CBZ.weaponOptic ? CBZ.weaponOptic(w) : { id: "iron", mag: 1, ads: 0.2 };
    let type = ROW_TYPE[row.id] || "iron", mag = row.mag || 1, thermal = false, tint = null;
    if (fit) {
      type = FIT_TYPE[fit.overlay] || (fit.highMag ? "scope" : "reddot");
      mag = fit.mag || (type === "scope" ? Math.tan(HIP * Math.PI / 360) / Math.tan((fit.fov || 20) * Math.PI / 360) : 1);
      thermal = !!fit.thermal; tint = fit.tint || null;
    } else if (AS && AS.optic && AS.optic.type) {
      // what is drawn is what you look through
      type = AS.optic.type; mag = AS.optic.mag || (type === "scope" ? mag : 1);
    }
    const adsSec = Math.max(0.12, Math.min(0.6, (row.ads || 0.22) + (fit && type === "scope" ? 0.12 : 0)));
    // no shoulder (no stock, or a folded one): held out at the arms, the
    // gun's sway is heavier. A fact of the gun, not a hands rule (one hand or
    // two is CBZ.holds', systems/actorweapons.js).
    const stub = A ? !(A.stock && !A.stock.folded) : stubby(w);
    const rec = {
      type: type, mag: Math.max(1, mag), thermal: thermal, tint: tint, adsSec: adsSec,
      eye: null, dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0),
      rear: null, front: null, lens: null, relief: 0, upm: upm, stub: stub, from: "derived", opticRoot: null,
    };
    if (type === "none") return rec;

    // ---- ANCHORS: the gun's (or the fitted optic's) own word ----
    const as = AS && AS.sight;
    const aEye = as && v3(as.pos);
    if (aEye) {
      rec.from = "anchors";
      rec.rear = v3(as.rear); rec.front = v3(as.front);
      const q = q4(as.quat);
      if (rec.rear && rec.front && rec.front.distanceToSquared(rec.rear) > 1e-10) rec.dir.copy(rec.front).sub(rec.rear).normalize();
      else if (q) rec.dir.set(0, 0, -1).applyQuaternion(q);
      if (q) rec.up.set(0, 1, 0).applyQuaternion(q);
      // up square to the sight line (roll from the quat, never tilt)
      rec.up.addScaledVector(rec.dir, -rec.up.dot(rec.dir)).normalize();
      if (!rec.rear) rec.rear = aEye.clone().addScaledVector(rec.dir, (as.eyeRelief || 0.1) * upm);
      if (!rec.front) rec.front = rec.rear.clone().addScaledVector(rec.dir, 0.1 * upm);
      rec.eye = aEye;
      // a fitted optic of another kind than its record (a gunsmith dot on the
      // generic tube): the eye sits where THAT sight is used
      const aType = AS.optic && AS.optic.type;
      if (fit && aType && aType !== type && (type === "reddot" || type === "holo")) {
        const relief = rec.stub ? EYE.pistolArm : 0.20;
        rec.eye = rec.rear.clone().addScaledVector(rec.dir, -relief * upm);
      }
      const al = AS.lens, lp = al && v3(al.pos);
      if (lp) rec.lens = { pos: lp, r: al.radius || 0.02 };
      else if (type !== "iron") rec.lens = { pos: rec.rear.clone(), r: 0.02 * upm };
      rec.opticRoot = (type !== "iron") ? AS.root : null;
      rec.relief = rec.eye.distanceTo(rec.lens ? rec.lens.pos : rec.rear);
      return rec;
    }

    // ---- GEOMETRY FALLBACK (a model with no anchors) ----
    const all = boxesOf(model, null, function (p) { return p.name === "_gmods" || p.name === "_baseOptic" || (p.userData && p.userData.isWeaponOptic); });
    let buttZ = -Infinity;
    for (let i = 0; i < all.length; i++) buttZ = Math.max(buttZ, all[i].max.z);
    if (!isFinite(buttZ)) buttZ = 0.3;
    const cheekZ = buttZ - EYE.cheek * upm;

    // ---- DERIVED from the drawn optic ----
    if (type !== "iron") {
      const op = opticParts(model), ax = op && opticAxis(op.boxes);
      if (ax) {
        rec.lens = { pos: new THREE.Vector3(ax.x, ax.y, ax.z), r: ax.r };
        rec.opticRoot = op.root;
        let ez;
        if (type === "scope") ez = ax.z + EYE.scopeRelief * upm;
        else if (rec.stub) ez = ax.z + EYE.pistolArm * upm;
        else ez = Math.max(ax.z + EYE.dotMin * upm, cheekZ);
        rec.eye = new THREE.Vector3(ax.x, ax.y, ez);
        rec.rear = rec.lens.pos.clone(); rec.front = rec.rear.clone().addScaledVector(rec.dir, 0.1 * upm);
        rec.relief = rec.eye.distanceTo(rec.rear);
        return rec;
      }
      type = rec.type = "iron";          // an optic row with no optic drawn: irons
    }

    // ---- DERIVED iron line ----
    const rearLimit = rec.stub ? buttZ + 1 : cheekZ;
    const il = ironLine(all, rearLimit);
    if (!il) {
      // nothing to sight along: over the top of the gun, straight down the bore
      let top = -Infinity;
      for (let i = 0; i < all.length; i++) top = Math.max(top, all[i].max.y);
      rec.eye = new THREE.Vector3(0, isFinite(top) ? top + 0.01 : 0.1, rec.stub ? buttZ + EYE.pistolArm * upm : cheekZ);
      rec.rear = rec.eye.clone().addScaledVector(rec.dir, 0.1 * upm); rec.front = rec.eye.clone().addScaledVector(rec.dir, 0.5 * upm);
      rec.relief = 0.1 * upm;
      return rec;
    }
    rec.dir.copy(il.F).sub(il.R).normalize();
    const back = rec.dir.clone().negate();
    let ez = rec.stub ? il.R.z + (w && w.slot === "pistol" ? EYE.pistolArm : EYE.stubArm) * upm
                      : Math.max(il.R.z + EYE.ironMin * upm, cheekZ);
    const t = (ez - il.R.z) / Math.max(1e-4, back.z);
    rec.eye = il.R.clone().addScaledVector(back, t);
    rec.rear = il.R; rec.front = il.F;
    rec.relief = rec.eye.distanceTo(il.R);
    // up stays perpendicular to the sight line, in the gun's vertical plane
    rec.up.set(0, 1, 0).addScaledVector(rec.dir, -rec.dir.y).normalize();
    return rec;
  }

  /* ==========================================================================
     2) THE FIRST-PERSON RAISE — solve the viewmodel so the eye point is on
        the camera and the sight line is the view axis.
  ========================================================================== */
  const _M = new THREE.Matrix4(), _B = new THREE.Matrix4();
  const _e = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3();
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  // pose (camera space) of the viewmodel root `vm` given the chain
  // vm -> gunObj -> ... -> model. Writes out.pos / out.quat.
  S.fpPose = function (vmObj, model, rec, out) {
    if (!rec || !rec.eye) return null;
    if (!toRoot(model, vmObj, _M)) { _M.identity(); for (let p = model; p && p !== vmObj; p = p.parent) { p.updateMatrix(); _M.premultiply(p.matrix); } }
    _e.copy(rec.eye).applyMatrix4(_M);
    _d.copy(rec.dir).transformDirection(_M);
    _u.copy(rec.up).transformDirection(_M);
    _z.copy(_d).negate();
    _x.crossVectors(_u, _z).normalize();
    _y.crossVectors(_z, _x);
    _B.makeBasis(_x, _y, _z);
    out.quat.setFromRotationMatrix(_B).invert();
    out.pos.copy(_e).applyQuaternion(out.quat).negate();
    return out;
  };

  /* ==========================================================================
     3) GLASS — reticle-at-infinity shaders + the scope's magnified lens
  ========================================================================== */
  const VERT = "varying vec3 vP;\nvoid main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
  // a red dot / holo: the reticle lives in the DIRECTION of the eye ray, so it
  // is parallax-free and only shows when the eye is behind the glass
  const DOT_FRAG = [
    "uniform vec3 uCam; uniform vec3 uColor; uniform float uKind; uniform float uPix; uniform float uR;",
    "varying vec3 vP;",
    "void main(){",
    "  vec3 d = vP - uCam; float fz = max(1e-4, -d.z); vec2 t = d.xy / fz; float r = length(t);",
    "  float px = max(uPix, 1e-5);",
    "  float dotR = max(px * 1.4, 0.0009);",
    "  float a = 1.0 - smoothstep(dotR - px * 0.7, dotR + px * 0.7, r);",
    "  float glow = exp(-(r * r) / (dotR * dotR * 7.0)) * 0.30;",
    "  if (uKind > 0.5) {",
    "    float ringR = 0.0099; float w = max(px * 0.8, 0.00035);",
    "    a = max(a, 1.0 - smoothstep(w, w + px, abs(r - ringR)));",
    "    float q = (r - ringR) / (w * 3.0);",
    "    glow += exp(-q * q) * 0.14;",
    "  }",
    "  float e = length(vP.xy) / uR;",
    "  float glass = 0.05 + 0.16 * smoothstep(0.72, 1.0, e);",
    "  float lit = clamp(a + glow, 0.0, 1.0);",
    "  vec3 col = uColor * lit + vec3(0.46, 0.62, 0.70) * glass * (1.0 - lit);",
    "  gl_FragColor = vec4(col, clamp(lit + glass, 0.0, 1.0));",
    "}",
  ].join("\n");
  // a scope's ocular: the magnified world, a second-focal-plane reticle in
  // true mils, and the exit-pupil shadow off the eye's actual position
  const SCOPE_FRAG = [
    "uniform sampler2D uMap; uniform vec3 uCam; uniform float uR; uniform float uMag; uniform float uTan;",
    "uniform float uRelief; uniform float uPix; uniform float uThermal; uniform float uLive; uniform vec3 uRet;",
    "varying vec3 vP;",
    "void main(){",
    "  vec3 d = vP - uCam; float fz = max(1e-4, -d.z); vec2 t = d.xy / fz;",
    "  vec2 p = vP.xy / uR;",
    "  vec3 col;",
    "  if (uLive > 0.5) {",
    // the eye ray at tangent t sees the world at t/mag; the target spans
    // +-uTan/mag, so the texel is t/uTan
    "    vec2 uv = 0.5 + 0.5 * t / uTan;",
    "    col = texture2D(uMap, clamp(uv, 0.0, 1.0)).rgb;",
    "    if (uThermal > 0.5) { float l = dot(col, vec3(0.30, 0.59, 0.11)); l = clamp((l - 0.08) * 1.6, 0.0, 1.0); col = vec3(l * 1.02, l * 0.98, l * 0.92); }",
    "    col *= vec3(0.96, 0.99, 1.02);",
    "  } else {",
    "    col = vec3(0.020, 0.030, 0.045) + vec3(0.10, 0.14, 0.18) * smoothstep(0.2, 1.0, 1.0 - length(p - vec2(-0.35, 0.4)));",
    "  }",
    "  vec2 e = uCam.xy / uR;",
    "  float dz = (uCam.z - uRelief) / uRelief;",
    "  float rad = clamp(1.0 - abs(dz) * 0.85, 0.06, 1.0);",
    "  float s = length(p + e * 1.5) / rad;",
    "  float vis = 1.0 - smoothstep(0.66, 1.0, s);",
    "  vis *= 1.0 - smoothstep(0.93, 1.0, length(p));",
    "  vec2 m = (t / uMag) / 0.001;",
    "  float lw = max(uPix / uMag / 0.001, 1e-4);",
    "  float ax = abs(m.x), ay = abs(m.y);",
    "  float thin = (1.0 - smoothstep(lw * 0.5, lw * 1.1, ay)) * step(ax, 10.0) + (1.0 - smoothstep(lw * 0.5, lw * 1.1, ax)) * step(ay, 10.0);",
    "  float thick = (1.0 - smoothstep(lw * 1.6, lw * 2.3, ay)) * step(10.0, ax) + (1.0 - smoothstep(lw * 1.6, lw * 2.3, ax)) * step(10.0, ay);",
    "  float dr = max(lw * 1.4, 0.09);",
    "  vec2 mr = m - floor(m + 0.5);",
    "  float dx = (1.0 - smoothstep(dr * 0.8, dr * 1.2, length(vec2(mr.x, m.y)))) * step(0.5, ax) * step(ax, 9.5);",
    "  float dy = (1.0 - smoothstep(dr * 0.8, dr * 1.2, length(vec2(m.x, mr.y)))) * step(0.5, ay) * step(ay, 9.5);",
    "  float ret = clamp(thin + thick + dx + dy, 0.0, 1.0) * uLive;",
    "  col = mix(col, uRet, ret);",
    "  gl_FragColor = vec4(col * vis, 1.0);",
    "}",
  ].join("\n");
  // the eyepiece's shade on the world around the scope: darkest at the bell,
  // gone a few lens-widths out — the 1x world stays visible, dimmed
  const SHADE_FRAG = [
    "uniform float uR; uniform float uK;",
    "varying vec3 vP;",
    "void main(){ float r = length(vP.xy) / uR; float a = (1.0 - smoothstep(1.2, 7.0, r)) * 0.78 + (1.0 - smoothstep(7.0, 14.0, r)) * 0.18; gl_FragColor = vec4(0.0, 0.0, 0.0, a * uK); }",
  ].join("\n");

  const _inv = new THREE.Matrix4(), _cp = new THREE.Vector3();
  function camLocal(mesh, camera, out) {
    _inv.copy(mesh.matrixWorld).invert();
    return out.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);
  }
  let pixTan = 0.0015;             // tangent units per screen pixel, refreshed per frame
  function trackCam(mesh) {
    mesh.onBeforeRender = function (renderer, scene, camera) {
      const u = mesh.material.uniforms;
      camLocal(mesh, camera, _cp);
      u.uCam.value.copy(_cp);
      if (u.uPix) u.uPix.value = pixTan;
    };
  }
  function colorOf(tint, fallback) {
    try { return new THREE.Color(tint || fallback); } catch (e) { return new THREE.Color(fallback); }
  }

  /* Hang the glass on a viewmodel. One group per model (rebuilt when the
     fitted optic changes), in a frame whose -Z is the sight line and whose
     origin is the rear glass. */
  function ensureFx(model, rec) {
    const ud = model.userData;
    if (ud._sightFx && ud._sightFx.userData.rec === rec) return ud._sightFx;
    if (ud._sightFx) { if (ud._sightFx.parent) ud._sightFx.parent.remove(ud._sightFx); ud._sightFx = null; }
    if (!rec.lens || (rec.type !== "reddot" && rec.type !== "holo" && rec.type !== "scope")) return null;
    const fx = new THREE.Group();
    fx.name = "_sightFx";
    fx.userData.sightFx = true;
    fx.userData.rec = rec;
    _z.copy(rec.dir).negate();
    _x.crossVectors(rec.up, _z).normalize();
    _y.crossVectors(_z, _x);
    _B.makeBasis(_x, _y, _z);
    fx.quaternion.setFromRotationMatrix(_B);
    fx.position.copy(rec.lens.pos).addScaledVector(rec.dir, -0.0016);   // just on the eye side of the glass
    const r = rec.lens.r;
    const late = function (m, order) { m.renderOrder = order; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; return m; };
    if (rec.type === "scope") {
      const lensMat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: null }, uCam: { value: new THREE.Vector3() }, uR: { value: r }, uMag: { value: rec.mag },
          uTan: { value: 0.3 }, uRelief: { value: rec.relief || EYE.scopeRelief * rec.upm }, uPix: { value: pixTan },
          uThermal: { value: rec.thermal ? 1 : 0 }, uLive: { value: 0 }, uRet: { value: rec.thermal ? new THREE.Vector3(0.9, 0.3, 0.1) : new THREE.Vector3(0.015, 0.02, 0.022) },
        },
        vertexShader: VERT, fragmentShader: SCOPE_FRAG, depthTest: true, depthWrite: true, transparent: true,
      });
      const lens = late(new THREE.Mesh(new THREE.CircleGeometry(r, 40), lensMat), 1003);
      lens.name = "_scopeLens";
      trackCam(lens);
      fx.add(lens);
      const shadeMat = new THREE.ShaderMaterial({
        uniforms: { uR: { value: r }, uK: { value: 0 } },
        vertexShader: VERT, fragmentShader: SHADE_FRAG, depthTest: false, depthWrite: false, transparent: true,
      });
      const shade = late(new THREE.Mesh(new THREE.RingGeometry(r * 1.15, r * 14, 48, 1), shadeMat), 1002);
      shade.name = "_scopeShade";
      shade.position.z = -0.002;
      fx.add(shade);
      fx.userData.lens = lens; fx.userData.shade = shade;
    } else {
      const c = colorOf(rec.tint, rec.type === "holo" ? "#ff4030" : "#ff2a1a");
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Vector3(Math.min(1, c.r * 1.2), c.g, c.b) },
          uKind: { value: rec.type === "holo" ? 1 : 0 }, uPix: { value: pixTan }, uR: { value: r },
        },
        vertexShader: VERT, fragmentShader: DOT_FRAG, depthTest: true, depthWrite: false, transparent: true,
      });
      const glass = late(new THREE.Mesh(new THREE.CircleGeometry(r, 32), mat), 1003);
      glass.name = "_dotGlass";
      trackCam(glass);
      fx.add(glass);
    }
    // the painted-on dot / crosshair the model drew on its glass is the fake
    // this replaces: hide tiny parts sitting on the optic axis at the glass
    if (rec.opticRoot || rec.type !== "scope") hidePaintedReticle(model, rec);
    model.add(fx);
    ud._sightFx = fx;
    return fx;
  }
  function hidePaintedReticle(model, rec) {
    const root = rec.opticRoot || model;
    const boxes = boxesOf(model, root);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i], o = b.obj;
      const ex = b.max.x - b.min.x, ey = b.max.y - b.min.y, ez = b.max.z - b.min.z;
      const cx = (b.min.x + b.max.x) / 2 - rec.lens.pos.x, cy = (b.min.y + b.max.y) / 2 - rec.lens.pos.y;
      const onAxis = Math.hypot(cx, cy) < rec.lens.r * 0.5;
      const nearGlass = Math.abs(b.max.z - rec.lens.pos.z) < 0.03 || (rec.type === "scope" && b.max.z > rec.lens.pos.z - 0.03);
      const thin = Math.min(ex, ey) < 0.008 && ez < 0.01;
      if (onAxis && nearGlass && thin && o.geometry && o.geometry.type !== "CircleGeometry") o.visible = false;
    }
  }

  /* THE SCOPE'S SECOND CAMERA. One low-res render target, made on first use,
     rendered only while a scope is actually at the eye, vm hidden, no shadow
     re-render (same discipline as city/cctv.js's feed). */
  let rt = null, rtCam = null, rtSize = 0;
  const TOUCH = typeof navigator !== "undefined" && ((navigator.maxTouchPoints || 0) > 0 || /iPad|iPhone|Android/.test(navigator.userAgent || ""));
  function ensureRt() {
    if (rt) return rt;
    rtSize = TOUCH ? 320 : 512;
    rt = new THREE.WebGLRenderTarget(rtSize, rtSize, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
    rt.texture.generateMipmaps = false;
    if (THREE.sRGBEncoding) rt.texture.encoding = THREE.sRGBEncoding;
    rtCam = new THREE.PerspectiveCamera(10, 1, 0.3, 2000);
    return rt;
  }
  const _wq = new THREE.Quaternion(), _wp = new THREE.Vector3();
  function renderScope(fx, rec, vmObj) {
    const renderer = CBZ.renderer, scene = CBZ.scene, cam = CBZ.camera;
    if (!renderer || !scene || !cam || !fx.userData.lens) return;
    ensureRt();
    const lens = fx.userData.lens;
    // the widest the eye can look through this lens (it sits at eye relief)
    const tanMax = Math.min(0.9, (rec.lens.r / Math.max(0.02, rec.relief || EYE.scopeRelief * rec.upm)) * 1.35);
    const tanRt = tanMax / rec.mag;
    lens.material.uniforms.uTan.value = tanMax;
    lens.material.uniforms.uMap.value = rt.texture;
    lens.material.uniforms.uLive.value = 1;
    cam.updateMatrixWorld();
    fx.updateWorldMatrix(true, false);
    fx.getWorldPosition(_wp);
    fx.getWorldQuaternion(_wq);
    rtCam.position.copy(_wp);
    rtCam.quaternion.copy(_wq);
    const fov = 2 * Math.atan(tanRt) * 180 / Math.PI;
    if (Math.abs(rtCam.fov - fov) > 1e-3 || rtCam.far !== cam.far) { rtCam.fov = fov; rtCam.far = cam.far; rtCam.updateProjectionMatrix(); }
    rtCam.updateMatrixWorld();
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap ? renderer.shadowMap.autoUpdate : true;
    const vmVis = vmObj ? vmObj.visible : false;
    if (vmObj) vmObj.visible = false;
    if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;
    try {
      renderer.setRenderTarget(rt);
      renderer.render(scene, rtCam);
    } catch (e) { /* context loss / headless: the lens stays dark glass */ }
    finally {
      renderer.setRenderTarget(prevTarget || null);
      if (renderer.shadowMap) renderer.shadowMap.autoUpdate = prevAuto;
      if (vmObj) vmObj.visible = vmVis;
    }
  }

  /* ==========================================================================
     4) STATE — the raise, the sway, breath, the public scope API
  ========================================================================== */
  let adsK = 0, adsE = 0, adsFor = null;       // eased 0..1 FP raise, and for which model
  let tpK = 0;                                  // third-person raise
  let swayT = 0, breathT0 = 0;
  const fpState = { vm: null, model: null, rec: null, fx: null };

  function gun() { return CBZ.currentGun ? CBZ.currentGun() : null; }
  function curModel() {
    const i = CBZ.fpsWeaponIndex ? CBZ.fpsWeaponIndex() : -1;
    return (CBZ.fpsWeaponModels && i >= 0) ? CBZ.fpsWeaponModels[i] : null;
  }
  function curRec() {
    const w = gun(), m = curModel();
    return (w && m) ? S.resolve(m, w) : null;
  }
  S.current = curRec;
  function smoother(k) { return k * k * k * (k * (k * 6 - 15) + 10); }
  function fpOn() { return !!(CBZ.fpsActive && CBZ.fpsActive()); }

  const _hq = new THREE.Quaternion(), _hp = new THREE.Vector3();
  const _pq = new THREE.Quaternion(), _pe = new THREE.Euler();
  const _pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  /* Called by fpsmode AFTER it has written the hip pose onto vm. Blends to
     the solved sight pose. o: { aim, dt, recoil, recoilSide, punch, reload,
     bobX, bobY, swap } */
  S.fpApply = function (vmObj, model, w, o) {
    const rec = model ? S.resolve(model, w) : null;
    fpState.vm = vmObj; fpState.model = model; fpState.rec = rec;
    if (adsFor !== model) { adsFor = model; adsK = 0; }
    const want = !!(o.aim && rec && rec.eye && rec.type !== "none" && !o.reload && !o.swap);
    const sec = rec ? rec.adsSec : 0.22;
    adsK = Math.max(0, Math.min(1, adsK + (want ? 1 : -1.45) * o.dt / sec));
    adsE = smoother(adsK);
    fpState.fx = (rec && model) ? ensureFx(model, rec) : null;
    if (fpState.fx && fpState.fx.userData.shade) fpState.fx.userData.shade.material.uniforms.uK.value = adsE;
    if (fpState.fx && fpState.fx.userData.lens && adsE < 0.2) fpState.fx.userData.lens.material.uniforms.uLive.value = 0;
    if (adsE <= 0 || !rec || !rec.eye) return 0;
    _hp.copy(vmObj.position); _hq.copy(vmObj.quaternion);
    // solve against the model as it is parented right now (vm at identity)
    vmObj.position.set(0, 0, 0); vmObj.quaternion.identity();
    S.fpPose(vmObj, model, rec, _pose);
    // breathing + the walk: the gun moves a hair against the eye
    swayT += o.dt;
    const heavy = rec.stub ? 1.6 : 1;
    const br = (o.breath != null ? o.breath : 1);
    const pitchB = (Math.sin(swayT * 1.25) * 0.0016 + Math.sin(swayT * 2.9 + 0.7) * 0.0005) * heavy * br;
    const yawB = (Math.sin(swayT * 0.85 + 1.1) * 0.0019 + Math.sin(swayT * 2.3) * 0.0004) * heavy * br;
    // the shot: muzzle up and right, the gun back into the face; it settles
    // as fpsmode's recoil decays
    const kickP = (o.recoil || 0) * 0.22 + (o.punch || 0) * 0.07;
    const kickY = (o.recoilSide || 0) * 0.30;
    const cant = Math.sin(Math.PI * adsE) * (rec.stub ? 0.05 : 0.11);
    _pe.set(pitchB + kickP + (o.bobY || 0) * 0.05, yawB - kickY - (o.bobX || 0) * 0.04, (o.recoilSide || 0) * 0.12, "YXZ");
    _pq.setFromEuler(_pe);
    _pose.pos.applyQuaternion(_pq);
    _pose.quat.premultiply(_pq);
    _pose.pos.z += (o.recoil || 0) * 0.07 + (o.punch || 0) * 0.10;
    _pose.pos.y += -(o.recoil || 0) * 0.012 + (o.bobY || 0) * 0.08;
    _pose.pos.x += (o.bobX || 0) * 0.05;
    // blend from the hip: the gun comes up with a little dip and cant
    vmObj.position.copy(_hp).lerp(_pose.pos, adsE);
    vmObj.position.y -= Math.sin(Math.PI * adsE) * 0.025;
    vmObj.quaternion.copy(_hq).slerp(_pose.quat, adsE);
    if (cant) { _pe.set(0, 0, cant, "XYZ"); _pq.setFromEuler(_pe); vmObj.quaternion.multiply(_pq); }
    return adsE;
  };
  S.fpAdsK = function () { return adsE; };
  CBZ.fpsAdsK = S.fpAdsK;

  // ---- the optic API other systems read (was lockon.js section 2) --------
  let manual = false, scopedNow = false, forcedFP = false;
  const BREATH_HOLD = 4.0, BREATH_DEBT = 3.0, BREATH_STEADY = 0.2, BREATH_PUNISH = 2.2;
  let breathKey = false, breathT = BREATH_HOLD, breathDebt = 0, breathK = 1;
  let swayYaw = 0, swayPitch = 0, driftY = 0, driftP = 0, driftTY = 0, driftTP = 0, driftClock = 0;

  function sightRec() {
    const w = gun();
    if (!w) return null;
    const m = curModel();
    if (m) return S.resolve(m, w);
    // no viewmodel (a page without fpsmode's models): the row alone
    const row = CBZ.weaponOptic ? CBZ.weaponOptic(w) : null;
    const fit = fittedSpec(w);
    const type = fit ? (FIT_TYPE[fit.overlay] || "reddot") : (ROW_TYPE[row && row.id] || "iron");
    return { type: type, mag: fit ? 1 : ((row && row.mag) || 1), thermal: !!(fit && fit.thermal) };
  }
  function canScope() {
    const g = CBZ.game;
    if (!g || g.state !== "playing") return false;
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P._swim) return false;
    const r = sightRec();
    return !!(r && (r.type === "reddot" || r.type === "holo" || r.type === "scope"));
  }
  function magnified(r) { return !!(r && r.type === "scope" && r.mag >= 3); }
  function adsFovOf(r) { return Math.max(20, HIP - (LEAN[r ? r.type : "iron"] || 12)); }

  function resolveScope() {
    const want = canScope() && (manual || (CBZ.fpsAimHeld && CBZ.fpsAimHeld()));
    const r = want ? sightRec() : null;
    if (want && !scopedNow) {
      scopedNow = true;
      // a magnified optic is looked THROUGH: it takes the eye to the glass
      if (magnified(r) && !fpOn() && CBZ.fpsSetActive) {
        const P = CBZ.player;
        if (P && !P.driving && !P.dead) { CBZ.fpsSetActive(true); forcedFP = true; }
      }
      if (magnified(r) && CBZ.sfx) { try { CBZ.sfx("rack", { pitch: 1.25, volume: 0.2 }); } catch (e) {} }
    } else if (!want && scopedNow) {
      scopedNow = false;
      if (CBZ.cam) CBZ.cam.yaw -= swayYaw;
      if (CBZ.fps && CBZ.fps.active) CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp - swayPitch));
      swayYaw = 0; swayPitch = 0;
      if (forcedFP) { if (fpOn() && CBZ.fpsSetActive) CBZ.fpsSetActive(false); forcedFP = false; }
    }
    return scopedNow;
  }

  CBZ.fpsCanScope = canScope;
  CBZ.fpsScoped = function () { return scopedNow; };
  CBZ.fpsScopeTube = function () { const r = scopedNow ? sightRec() : null; return !!(r && r.type === "scope"); };
  CBZ.fpsScope = function (down) {
    manual = !!down && canScope();
    if (CBZ.fpsSetAim) CBZ.fpsSetAim(manual);
    resolveScope();
    return manual;
  };
  CBZ.fpsScopeToggle = function () {
    manual = !manual && canScope();
    if (CBZ.fpsSetAim) CBZ.fpsSetAim(manual);
    resolveScope();
    return manual;
  };
  CBZ.fpsHoldBreath = function (down) { breathKey = !!down; return breathKey; };
  CBZ.fpsBreathState = function () {
    return { holding: breathKey && breathT > 0 && breathDebt <= 0,
      left: Math.round(breathT * 100) / 100, debt: Math.round(breathDebt * 100) / 100 };
  };
  // THE MAIN LENS while an optic is up: a lean-in, never the magnification —
  // that lives in the glass now, so the world around the scope stays 1x.
  CBZ.fpsScopeFov = function () { return scopedNow ? adsFovOf(sightRec()) : null; };
  // look sensitivity: the lens ratio, and through a magnified optic most of
  // the way to 1/mag so the reticle crawls, not the world
  CBZ.fpsLookSensMul = function () {
    const ads = CBZ.isADS && CBZ.isADS();
    if (!ads) return 1;
    const r = sightRec();
    const fov = r ? adsFovOf(r) : HIP - 12;
    let k = Math.tan(fov * Math.PI / 360) / Math.tan(HIP * Math.PI / 360);
    if (scopedNow && r && r.type === "scope") k *= Math.pow(r.mag, -0.75);
    return k;
  };
  // gamepad.js slows the right stick while a magnified optic is up; a
  // non-gun lens (the hitman's binoculars) may wrap cityScopeFov itself
  CBZ.cityScopeHigh = function () { return scopedNow && magnified(sightRec()); };
  if (!CBZ.cityScopeFov) CBZ.cityScopeFov = function () { return null; };

  CBZ.fpsScopeMilPlan = function () {
    const r = sightRec();
    return { mag: r ? r.mag : 1, px: pixTan, milPx: r ? 0.001 * r.mag / pixTan : 0 };
  };

  if (!CBZ.onAlways) return;

  // before fpsmode (52): this frame's aim already carries the sway
  CBZ.onAlways(51.5, function (dt) {
    if (manual && !canScope()) manual = false;
    resolveScope();
    const cam = CBZ.camera;
    if (cam) {
      const H = (CBZ.renderer && CBZ.renderer.domElement && CBZ.renderer.domElement.height) || (typeof innerHeight !== "undefined" ? innerHeight : 900);
      pixTan = 2 * Math.tan((cam.fov || 60) * Math.PI / 360) / Math.max(200, H);
    }
    // THIRD PERSON: publish the raise for character.js
    const ch = CBZ.playerChar;
    const tpWant = !!(CBZ.isADS && CBZ.isADS() && !fpOn());
    tpK = Math.max(0, Math.min(1, tpK + (tpWant ? 1 : -1.6) * dt / 0.28));
    // (one hand or two is the hold engine's, systems/actorweapons.js CBZ.holds:
    // gunhands.js publishes it to the rig as aimHands)
    if (ch) ch.adsK = smoother(tpK);
    const sighted = fpOn() && adsE > 0.85 && (CBZ.isADS && CBZ.isADS());
    // BREATH recovers even with the gun down
    const r = sighted ? sightRec() : null;
    const shift = !!(CBZ.keys && (CBZ.keys.shift || CBZ.keys["shift"]));
    const canHold = !!(r && r.type === "scope");
    const wantHold = canHold && (breathKey || shift) && breathDebt <= 0 && breathT > 0;
    breathK = 1;
    if (wantHold) { breathT = Math.max(0, breathT - dt); breathK = BREATH_STEADY; if (breathT <= 0) breathDebt = BREATH_DEBT; }
    else if (breathDebt > 0) { breathDebt = Math.max(0, breathDebt - dt); breathK = sighted ? BREATH_PUNISH : 1; if (breathDebt <= 0) breathT = BREATH_HOLD; }
    else if (breathT < BREATH_HOLD) breathT = Math.min(BREATH_HOLD, breathT + dt * 0.8);
    if (!sighted) {
      if (swayYaw || swayPitch) {
        if (CBZ.cam) CBZ.cam.yaw -= swayYaw;
        if (CBZ.fps && CBZ.fps.active) CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp - swayPitch));
        swayYaw = 0; swayPitch = 0;
      }
      return;
    }
    /* SWAY IS THE BODY'S — real radians off the stance (fpsmode's
       playerSwayRad), applied to the ACTUAL aim so the round goes where the
       swaying sight points. Not multiplied by magnification: the glass does
       that to the picture by itself. */
    breathT0 += dt;
    driftClock -= dt;
    const AMP = (CBZ.playerSwayRad ? CBZ.playerSwayRad() : 0.004) * breathK;
    if (driftClock <= 0) {
      driftClock = 1.4 + Math.random() * 1.2;
      driftTY = (Math.random() - 0.5) * AMP * 1.05;
      driftTP = (Math.random() - 0.5) * AMP * 0.8;
    }
    driftY += (driftTY - driftY) * Math.min(1, dt * 1.2);
    driftP += (driftTP - driftP) * Math.min(1, dt * 1.2);
    const wy = Math.sin(breathT0 * 0.9) * AMP + Math.sin(breathT0 * 2.17 + 1.3) * AMP * 0.35 + driftY;
    const wp = Math.cos(breathT0 * 1.23) * AMP * 0.8 + Math.sin(breathT0 * 2.9) * AMP * 0.3 + driftP;
    if (CBZ.cam) { CBZ.cam.yaw += wy - swayYaw; swayYaw = wy; }
    if (CBZ.fps && CBZ.fps.active) { CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp + (wp - swayPitch))); swayPitch = wp; }
  });
  S.breathMul = function () { return breathK; };

  // after the camera is final (camera 50, fpsmode 52, lockon 54): the scope's
  // second camera, only while the glass is actually at the eye
  CBZ.onAlways(58, function () {
    const fx = fpState.fx, rec = fpState.rec, vmObj = fpState.vm;
    if (!fx || !rec || rec.type !== "scope" || !fx.userData.lens) return;
    const live = adsE > 0.2 && vmObj && vmObj.visible && fpOn() && fx.parent && fx.parent.visible !== false && CBZ.game && CBZ.game.state === "playing";
    if (!live) { fx.userData.lens.material.uniforms.uLive.value = 0; return; }
    renderScope(fx, rec, vmObj);
  });

  // headless handles for tools/ads-check.mjs
  S._EYE = EYE;
  S._opticAxis = opticAxis;
  S._ironLine = ironLine;
})();
