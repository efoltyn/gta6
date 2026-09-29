/* ============================================================
   weapons/appearances/sidearm.js — the 9mm (Glock 17) + CBZ.gunKit.

   THE GUN: a polymer-frame striker pistol. What makes it read as a Glock
   and not a brick: a narrow flat-topped slide with chamfered edges and a
   tapered nose, rear cocking serrations, the square-fronted trigger guard
   with a real hole in it, a 22-degree raked grip with finger grooves and
   the beavertail tang, a white-dot front sight and a U-notch rear.
   Proportions are the real ones (186 mm slide, 25 mm wide) at 2.25x.

   THE KIT (CBZ.gunKit): every gun-game appearance builds from it, and it
   lives here because every page that loads any appearance loads this file
   first. Side profiles are ExtrudeGeometry cut across the gun's width, so
   one mesh carries a whole silhouette (a stock, a frame with its trigger
   guard hole, a curved magazine) with chamfered edges that catch light.
   Geometries are cached module-wide and marked _shared; finishes are cached
   on the CALLER's material table (fpsmode flips flags on its own table, so
   an NPC's gun never shares a material object with the viewmodel).

   THE HAND: the firing hand is part of the model (systems/fphands.js's one
   hand, closed on the grip) on mat.skin, which fpsmode tints to the
   player's skin and which the gun room and weapon-scale skip. fpsmode grows
   the forearm out of its wrist and puts the off hand on userData.grips.

   THIS FILE IS THE APPEARANCES INDEX: it loads first on every page, so the
   contract every weapons/appearances/* model (and every held item: the
   flashlight, the charge + detonator, the grenade, the shank) honours is
   written here.

   ANCHOR CONTRACT — model.userData.anchors
   Every appearance names the points a hand, an eye or a solver needs, in the
   MODEL'S OWN LOCAL SPACE and units (the same space as userData.muzzle; the
   consumer's scale/rotation of the model applies on top). Axes: -Z toward
   the muzzle, +Y up, +X the gun's right. Every point is { pos: Vector3,
   quat: Quaternion } plus the extra fields listed; an absent part is null.

     k        model units per REAL metre as authored (Glock 2.25, Deagle
              2.4 ...). Real-metre fields (eyeRelief) times k = model units.
     grip     the firing hand's CENTRE on the grip (palm-mid, on the grip
              axis, a palm below its top). quat: +Y up the grip axis (raked
              forward-up), -Z out through the front strap where the fingers
              close, +X the gun's right. `rake` (rad) rides along.
     trigger  the face of the trigger blade the index pad presses. quat:
              the gun frame (-Z forward; the pull is +Z).
     support  the part the off hand holds, with `kind`: "guard" handguard,
              "pump" (moves with the pump), "vgrip" vertical foregrip (quat
              +Y up its axis, like grip), "tube" launcher tube, "cup" (a
              pistol: the off hand cups the firing fist, pos on the left
              grip panel), "frame" (a mag-in-grip SMG: the receiver front).
              `len` = the length of holdable surface along the bore.
     muzzle   the bore's exit (== userData.muzzle). quat: -Z the shot's way.
     mag      the magazine BODY centre; `well` = the mouth it seats into.
              quat: +Y from the body up into the well (insertion reversed).
     stock    the centre of the butt plate face that goes in the shoulder;
              `folded` true when it is drawn folded. null on a pistol.
     bolt     a bolt gun's bolt knob (the hand that works it). null if none.
     charge   the charging handle / slide serrations / cocking knob.
     sight    the EYE point for aiming: behind `rear` along the sight line
              by eyeRelief (real metres) x k. quat: a camera frame, looking
              down -Z along rear -> front, +Y up. `rear`/`front` ride along
              (irons: rear notch/aperture + front post tip; optics: ocular
              lens + objective / window centres).
     lens     scoped/dot optics only: the ocular lens (rear window) centre,
              `radius`, quat facing the eye (+Z toward it). null on irons.
     optic    { type: "iron"|"reddot"|"holo"|"scope"|"none", mag }.

   An optic group carries its own record (userData.opticAnchors, built by
   CBZ.gunAnchors.optic) in ITS local space; the gun's sight/lens/optic come
   from its "_baseOptic" child when there is one. A gunsmith optic
   (weapons/optics.js createWeaponOptic) stamps its own, and
   CBZ.gunAnchors.activeSight(model) returns the sight in use NOW (the fitted
   one if visible, else the factory one). CBZ.gunAnchors.world(model, name,
   outPos, outQuat) resolves any anchor to world space.
   Authoring: K.anchors(g, spec) at the end of a builder (spec fields as
   above, points as [x, y, z]); K.opticAnchors(group, {...}) on an optic.
   tools/gun-anchors-check.mjs proves every appearance carries them and that
   each lies on or inside the drawn mesh (the eye point excepted: it is
   behind the gun, and the check instead proves its line clears the sights).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  /* ---------------------------------------------------------- the kit */
  const GEO = new Map();
  function cachedGeo(key, make) {
    let g = GEO.get(key);
    if (!g) { g = make(); g._shared = true; GEO.set(key, g); }
    return g;
  }

  // name → [color, shininess (0 = Lambert), specular, emissive]
  const FINISH = {
    parker: [0x2a2e33, 14, 0x2c3136],      // parkerized receiver steel
    blued: [0x1c1f23, 34, 0x3f454c],       // slides, bolts, barrels
    polymer: [0x1f2123, 0, 0, 0],          // black injection-moulded furniture
    rubber: [0x111213, 0, 0, 0],           // butt pads, grip panels
    edge: [0x8d969f, 48, 0x6a7078],        // worn steel on high edges
    akWood: [0x86421d, 10, 0x2a1709],      // Soviet laminate, reddish lacquer
    walnut: [0x5c381d, 12, 0x241509],      // shotgun walnut
    odStock: [0x4a4f3c, 0, 0, 0],          // M24 synthetic, olive drab
    stainless: [0xb3b8bd, 60, 0x9a9fa6],   // Desert Eagle brushed stainless
    whiteDot: [0xe8e6dc, 0, 0, 0x222222],  // sight dots
    redDot: [0xff2a1e, 0, 0, 0xff2a1e],    // reflex dot / emitter
    lens: [0x1d2a33, 80, 0x8fb4cc],        // dark coated glass
    royalBlue: [0x131c30, 70, 0x6f86b8],   // Colt Royal Blue (Python)
    walnutCheck: [0x2e1b0e, 0, 0, 0],      // cut checkering between the diamonds
    redInsert: [0xd01e14, 0, 0, 0x3a0604], // red ramp-sight insert
    caseBrass: [0xc99a3e, 40, 0x7a5a20],   // cartridge case heads
    mglTan: [0x7a6d4e, 0, 0, 0],           // MGL flat dark earth polymer
    taserYellow: [0xf0c418, 0, 0, 0x2a1c00], // X26 safety-yellow polymer
    cartGrey: [0x3a3d40, 6, 0x222428],     // TASER cartridge housing
  };
  function finish(ctx, name) {
    const key = "gk_" + name, mat = ctx.mat;
    if (mat[key]) return mat[key];
    const f = FINISH[name], THREE = ctx.THREE;
    const m = f[1] > 0
      ? new THREE.MeshPhongMaterial({ color: f[0], shininess: f[1], specular: f[2] })
      : new THREE.MeshLambertMaterial({ color: f[0], emissive: f[3] || 0 });
    m._shared = true;
    mat[key] = m;
    return m;
  }

  function pathOf(THREE, Ctor, pts) {
    const p = new Ctor();
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    p.closePath();
    return p;
  }

  // Mesh through the CALLER's helper (so its shadow/geometry/display policy
  // applies), then swap in the cached geometry. ctx.box builds a throwaway
  // unit box; in the display ctx it may return null.
  function place(ctx, parent, geo, material, x, y, z, rx, ry, rz) {
    const m = ctx.box(parent, 1, 1, 1, material, x, y, z, rx, ry, rz);
    if (m) m.geometry = geo;
    return m;
  }

  /* Side profile extruded across the gun. Points are [forward, up] in model
     units, forward = -z (toward the muzzle). `shapes` may hold several
     outlines (serration ribs), `holes` cuts windows (trigger guards). axis
     "z" instead extrudes a FRONT profile ([x, y]) along the barrel. */
  function prof(ctx, parent, key, outlines, width, material, o) {
    o = o || {};
    const THREE = ctx.THREE, bevel = o.bevel == null ? 0.004 : o.bevel;
    const geo = cachedGeo("prof:" + key, function () {
      const list = Array.isArray(outlines[0][0]) ? outlines : [outlines];
      const shapes = list.map(function (pts, i) {
        const s = pathOf(THREE, THREE.Shape, pts);
        if (i === 0 && o.holes) o.holes.forEach(function (h) { s.holes.push(pathOf(THREE, THREE.Path, h)); });
        return s;
      });
      const depth = Math.max(0.001, width - 2 * bevel);
      const g = new THREE.ExtrudeGeometry(shapes, {
        depth: depth, steps: 1, bevelEnabled: bevel > 0,
        bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4,
      });
      g.translate(0, 0, -depth / 2);
      if (o.axis !== "z") g.rotateY(Math.PI / 2);   // shape x → -z (forward), extrusion → x
      else g.rotateY(Math.PI);                      // front profile: extrude toward the muzzle
      g.computeVertexNormals();
      // the exact shape rides the geometry: a first-person thumb closes on
      // the drawn frame, not on its bounding box (fphands.solidsOf)
      g.userData.profile = { list: list, holes: o.holes || null, width: width, bevel: bevel, axis: o.axis === "z" ? "z" : "x" };
      return g;
    });
    return place(ctx, parent, geo, material, o.x, o.y, o.z, o.rx, o.ry, o.rz);
  }

  // cylinder along the barrel (z) — tapered and faceted as asked
  function tube(ctx, parent, rFront, rBack, len, segs, material, x, y, z) {
    const THREE = ctx.THREE;
    const geo = cachedGeo("tube:" + rFront + ":" + rBack + ":" + len + ":" + segs, function () {
      const g = new THREE.CylinderGeometry(rFront, rBack, len, segs || 12);
      g.rotateX(-Math.PI / 2);   // +y (top radius) → -z (front)
      return g;
    });
    return place(ctx, parent, geo, material, x, y, z);
  }

  /* A turned part along the barrel: `pts` are [radius, forward] pairs (forward
     = -z, model units) revolved about the bore axis. A barrel with its crown,
     a knurled nut, a scope tube with its bells, a grenade body — one mesh with
     a real profile instead of a stack of cylinders. `o.axis` "y" turns about
     +Y instead (a knob, a grenade standing up); o.phi limits the sweep. */
  function lathe(ctx, parent, key, pts, segs, material, x, y, z, o) {
    o = o || {};
    const THREE = ctx.THREE;
    const geo = cachedGeo("lathe:" + key, function () {
      const g = new THREE.LatheGeometry(pts.map(function (p) { return new THREE.Vector2(Math.max(0, p[0]), p[1]); }),
        segs || 16, o.phi0 || 0, o.phi || Math.PI * 2);
      if (o.axis !== "y") g.rotateX(-Math.PI / 2);   // +y (forward) -> -z
      g.computeVertexNormals();
      return g;
    });
    return place(ctx, parent, geo, material, x, y, z, o.rx, o.ry, o.rz);
  }

  function arc(cx, cy, r, a0, a1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return out;
  }

  /* A raked pistol-grip outline. (ff, fy) = top of the front strap, the grip
     runs `len` down and back at `rake` from vertical, `depth` front-to-back.
     swellF/swellB bulge the straps mid-height, `grooves` ripples the front. */
  function gripOutline(ff, fy, depth, len, rake, o) {
    o = o || {};
    const s = Math.sin(rake), c = Math.cos(rake), dx = -s, dy = -c, nx = c, ny = -s;
    const N = 8, fr = [], bk = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const fo = (o.swellF || 0) * Math.sin(Math.PI * t) + (o.grooves ? 0.005 * Math.abs(Math.sin(Math.PI * o.grooves * t)) : 0);
      const bo = (o.swellB || 0) * Math.sin(Math.PI * t);
      fr.push([ff + dx * len * t + nx * fo, fy + dy * len * t + ny * fo]);
      bk.push([ff - nx * depth + dx * len * t - nx * bo, fy - ny * depth + dy * len * t - ny * bo]);
    }
    return fr.concat(bk.reverse());
  }

  // Picatinny rail side outline from f0 to f1: base [y0, y0+h], teeth to +t
  function railOutline(f0, f1, y0, h, t, pitch) {
    pitch = pitch || 0.018;
    const pts = [[f0, y0], [f1, y0], [f1, y0 + h]];
    for (let f = f1 - 0.004; f - pitch * 0.5 > f0 + 0.002; f -= pitch) {
      const a = f - pitch * 0.5;
      pts.push([f, y0 + h], [f, y0 + h + t], [a, y0 + h + t], [a, y0 + h]);
    }
    pts.push([f0, y0 + h]);
    return pts;
  }

  // ribbed round cross-section (handguards, heat shields): n ribs
  function ribbedRing(r, rIn, n) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2, rr = i % 2 ? rIn : r;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    return pts;
  }

  /* THE FIRING HAND, CLOSED ON THIS GUN'S GRIP. systems/fphands.js's one
     hand, GRASPED onto the grip that is actually modelled here instead of a
     fixed "pistol" pose (the old table pose buried the fingers in a fat grip
     and left them floating beside a thin one, and sized the hand per gun, so
     the same hand shrank 22% when you swapped a pistol for the shotgun).

       at      [y, z] of the top centre of the grip (model units)
       rake    grip angle back from vertical (radians)
       gripW   side-to-side width of the grip, gripD front-to-back depth
       trigger [y, z] of the trigger blade

     The hand is ONE size on every gun: GUN_K model units per real metre (the
     appearances are ~1.6-2.3x real; 2.0 is their middle), divided by the
     parent's own scale (the taser builds inside a 0.82 group). The palm lies
     flush on the right panel with the web as high as the tang allows, the
     index knuckle level with the trigger, three fingers close round the
     front strap until they touch it, the index finger's pad lands on the
     trigger's face and the thumb wraps the back strap and rides forward along
     the left flank. The hand's origin is the WRIST; it is flagged
     userData.fpGripHand and carries userData.foreLocal (the straight-wrist
     line) so fpsmode grows a forearm out of it that cannot kink the wrist. */
  const GUN_K = 2.0;
  function hand(ctx, parent, h) {
    // THE GRIP IS PART OF THE GUN even when no hand is drawn on it: a body
    // that holds this prop in third person (systems/gunhands.js CBZ.gunHold)
    // closes its OWN hand on exactly this grip, so the spec rides the model.
    if (parent && parent.userData) parent.userData.fireGrip = h;
    // a rack/shop display has no hand; a caller whose rig draws its own
    // hands (NPC props) passes ctx.noHand
    if (ctx.display || ctx.noHand || !ctx.mat.skin) return null;
    const FPH = CBZ.fpHands;
    if (!FPH || !FPH.grasp) return null;
    const THREE = ctx.THREE;
    const k = GUN_K / ((parent && parent.scale && parent.scale.x) || 1);
    const R = h.rake || 0;
    const axis = new THREE.Vector3(0, Math.cos(R), -Math.sin(R));       // up the grip
    const u = new THREE.Vector3(1, 0, 0);
    const fwd = new THREE.Vector3().crossVectors(axis, u);               // front strap side
    const top = new THREE.Vector3(0, h.at[0], h.at[1]);
    const prism = { o: top, axis: axis, u: u, hw: h.gripW * 0.5, hh: h.gripD * 0.5, rc: Math.min(h.gripW, h.gripD) * 0.22 };
    // the pad presses the FRONT face of the blade
    const trig = h.trigger ? new THREE.Vector3(0, h.trigger[0], h.trigger[1] - 0.007) : null;
    const hhM = h.gripD * 0.5 / k;
    const spec = {
      side: 1, k: k, prism: prism, name: "fire:" + [h.at, R.toFixed(3), h.gripW, h.gripD, h.trigger, k.toFixed(3)].join("/"),
      n: new THREE.Vector3().copy(u).addScaledVector(fwd, -0.22),           // back of the hand out, a touch rearward
      // fingers across the front strap; a steep stock wrist (the shotgun) is
      // taken diagonally, fingers along the bore, the way a hand really
      // closes on it (square to it the forearm would point at your eye)
      heading: h.heading ? new THREE.Vector3(h.heading[0], h.heading[1], h.heading[2]) : fwd.clone(),
      palm: [0, -FPH.PALM.th * 0.5, -(0.096 - hhM - 0.004)],            // knuckles just past the front strap
      trigger: trig,
      // the thumb: round the back strap, then forward along the left of the
      // frame, riding high (the modern thumbs-forward grip)
      thumbAim: new THREE.Vector3().copy(u).negate().addScaledVector(fwd, -0.35).addScaledVector(axis, 0.10),
      thumbAim2: new THREE.Vector3(-0.30, 0.10, -1),
      at: top.clone(),
    };
    /* Slide the hand along the grip. The web goes as HIGH as the grip allows
       (the thumb-side edge of the palm, web or index knuckle, whichever a
       diagonal hold lifts higher, stays just under the top) and comes down
       only as far as the trigger needs: the index knuckle within a finger's
       reach of the pad (4.5-7.2 cm). It used to aim for a fixed 7 cm AND for
       the knuckle level with the trigger, which on a rifle (the trigger sits
       ABOVE the grip's top) slid the whole hand 2.4 cm down the grip: on the
       M4 the ring finger hung half off the bottom and the little finger
       closed on nothing, reaching forward under the grip. Sliding moves every
       point of the hand 1:1 along the axis, so one grasp measures the whole
       family and the search is arithmetic. */
    let t = -0.045 * k;
    spec.at.copy(top).addScaledVector(axis, t);
    {
      const G = FPH.grasp(spec);
      const idx0 = G.toM([FPH.FINGERS[0].x, 0, FPH.FINGERS[0].z]).clone();
      const hi0 = Math.max(G.toM([-FPH.PALM.hw, 0, -0.030]).clone().sub(top).dot(axis),
        G.toM([-FPH.PALM.hw * 0.8, 0, -0.090]).clone().sub(top).dot(axis));
      const tMax = t + (-0.004 * k - hi0);
      let best = tMax;
      if (trig) {
        let bestC = Infinity;
        for (let tt = tMax; tt > tMax - 0.10 * k; tt -= 0.002 * k) {
          const d = idx0.clone().addScaledVector(axis, tt - t).distanceTo(trig) / k;
          if (d >= 0.045 && d <= 0.072) { best = tt; break; }        // the highest hold that reaches
          const c = Math.max(0.045 - d, d - 0.072);
          if (c < bestC) { bestC = c; best = tt; }
        }
      }
      t = best;
    }
    spec.at.copy(top).addScaledVector(axis, t);
    const hd = FPH.graspHand(parent, spec, ctx.mat.skin);
    hd.userData.fpGripHand = true;
    hd.userData.foreLocal = new THREE.Vector3(0, 0, 1);                    // a straight wrist
    return hd;
  }

  /* ------------------------------------------------------ THE ANCHORS
     See "ANCHOR CONTRACT" at the top of this file. CBZ.gunAnchors is plain
     THREE (no ctx), so a held item built outside the kit (the flashlight,
     the charge, the grenade) can stamp the same record the same way. */
  const GA = CBZ.gunAnchors = CBZ.gunAnchors || {};
  const DEF_RELIEF = { iron: 0.08, reddot: 0.20, holo: 0.18, scope: 0.09, none: 0 };
  GA.NAMES = ["grip", "trigger", "support", "muzzle", "mag", "stock", "bolt", "charge", "sight", "lens"];
  function v3(THREE, a) {
    if (!a) return null;
    return a.isVector3 ? a.clone() : new THREE.Vector3(a[0] || 0, a[1] || 0, a[2] || 0);
  }
  // a frame whose -Z looks along `dir`, +Y as near `up` (default +Y) as it can be
  function lookQuat(THREE, dir, up) {
    const z = dir.clone().normalize().negate();
    const x = new THREE.Vector3().crossVectors(up || new THREE.Vector3(0, 1, 0), z);
    if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }
  GA.lookQuat = lookQuat;
  // +Y up a part raked back from vertical by `rake` (the kit's grip axis)
  function rakeQuat(THREE, rake) {
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -(rake || 0));
  }
  function pt(THREE, s) {
    if (s == null) return null;
    const isObj = !Array.isArray(s) && !s.isVector3;
    const o = { pos: v3(THREE, isObj ? s.pos : s) };
    o.quat = isObj && s.quat ? s.quat.clone()
      : isObj && s.dir ? lookQuat(THREE, v3(THREE, s.dir), s.up ? v3(THREE, s.up) : null)
      : rakeQuat(THREE, isObj ? s.rake : 0);
    if (isObj) for (const k in s) if (k !== "pos" && k !== "quat" && k !== "dir" && k !== "up") o[k] = s[k];
    if (o.well) o.well = v3(THREE, o.well);
    return o;
  }
  /* An optic's own anchors, in the OPTIC GROUP's local space:
       rear   ocular lens / rear window / rear aperture centre
       front  objective / front window / front post tip
       lensR  ocular lens radius (scopes, dots); omit for irons
       eyeRelief real metres from `rear` back to the eye
       k      model units per real metre the optic was drawn at
       type   "iron" | "reddot" | "holo" | "scope"   mag  true magnification
     Stamped on group.userData.opticAnchors (when a group is given) so a
     gunsmith scope that replaces a factory one carries its own. */
  GA.optic = function (THREE, group, o) {
    const rear = v3(THREE, o.rear), front = v3(THREE, o.front);
    const dir = front.clone().sub(rear).normalize();
    const relief = o.eyeRelief != null ? o.eyeRelief : (DEF_RELIEF[o.type] != null ? DEF_RELIEF[o.type] : 0.1);
    const k = o.k || 2.0;
    const q = lookQuat(THREE, dir);
    const rec = {
      optic: { type: o.type || "iron", mag: o.mag || 1 },
      sight: { pos: rear.clone().addScaledVector(dir, -relief * k), quat: q, eyeRelief: relief, rear: rear, front: front },
      lens: o.lensR ? { pos: rear.clone(), quat: q.clone(), radius: o.lensR } : null,
    };
    if (group) group.userData.opticAnchors = rec;
    return rec;
  };
  // an optic group's anchors carried into an ancestor's (the gun's) space
  GA.inParent = function (THREE, node, root, rec) {
    const M = new THREE.Matrix4();
    for (let o = node; o && o !== root; o = o.parent) { o.updateMatrix(); M.premultiply(o.matrix); }
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    M.decompose(p, q, sc);
    const tp = function (v) { return v.clone().applyMatrix4(M); };
    const out = { optic: Object.assign({}, rec.optic), sight: null, lens: null };
    if (rec.sight) out.sight = { pos: tp(rec.sight.pos), quat: q.clone().multiply(rec.sight.quat), eyeRelief: rec.sight.eyeRelief, rear: tp(rec.sight.rear), front: tp(rec.sight.front) };
    if (rec.lens) out.lens = { pos: tp(rec.lens.pos), quat: q.clone().multiply(rec.lens.quat), radius: rec.lens.radius * sc.x };
    return out;
  };
  /* Stamp model.userData.anchors from a spec (arrays [x,y,z] or Vector3s,
     all in the model's own units and space). See the contract up top. */
  GA.stamp = function (THREE, model, s) {
    const A = { k: s.k || 2.0 };
    A.grip = pt(THREE, s.grip);
    A.trigger = pt(THREE, s.trigger);
    A.support = pt(THREE, s.support);
    const mz = s.muzzle || model.userData.muzzle;
    A.muzzle = mz ? pt(THREE, mz) : null;
    A.mag = pt(THREE, s.mag);
    A.stock = pt(THREE, s.stock);
    A.bolt = pt(THREE, s.bolt);
    A.charge = pt(THREE, s.charge);
    A.optic = { type: (s.optic && s.optic.type) || (s.sight && s.sight.type) || "none", mag: (s.optic && s.optic.mag) || 1 };
    A.sight = null; A.lens = null;
    if (s.sight) {
      const r = GA.optic(THREE, null, Object.assign({ k: A.k, type: A.optic.type, mag: A.optic.mag }, s.sight));
      A.sight = r.sight; A.lens = r.lens; A.optic = r.optic;
    }
    const base = model.getObjectByName && model.getObjectByName("_baseOptic");
    if (base && base.userData.opticAnchors) {
      const r = GA.inParent(THREE, base, model, base.userData.opticAnchors);
      A.sight = r.sight; A.lens = r.lens; A.optic = r.optic;
    }
    model.userData.anchors = A;
    // systems/sights.js reads the scale here
    if (model.userData.unitsPerMetre == null) model.userData.unitsPerMetre = A.k;
    return A;
  };
  /* THE SIGHT IN USE NOW, in the model's space: a visible fitted optic
     (city/gunmods.js adds one through CBZ.createWeaponOptic and hides
     "_baseOptic") wins over the factory sight. -> { sight, lens, optic } */
  GA.activeSight = function (model) {
    const THREE = window.THREE, A = model && model.userData.anchors;
    let found = null;
    if (model && THREE) model.traverse(function (o) {
      if (found || o === model || !o.userData.opticAnchors || o.name === "_baseOptic") return;
      for (let p = o; p && p !== model; p = p.parent) if (!p.visible) return;
      found = o;
    });
    if (found) return GA.inParent(THREE, found, model, found.userData.opticAnchors);
    return A ? { sight: A.sight, lens: A.lens, optic: A.optic } : null;
  };
  // one anchor in world space, for a model placed anywhere (outs optional)
  GA.world = function (model, name, outPos, outQuat) {
    const A = model && model.userData.anchors, a = A && A[name];
    if (!a) return null;
    model.updateMatrixWorld(true);
    if (outPos) outPos.copy(a.pos).applyMatrix4(model.matrixWorld);
    if (outQuat) { model.getWorldQuaternion(outQuat); outQuat.multiply(a.quat); }
    return a;
  };

  /* THE BAKE. A gun is 20-40 parts so it can read as a real gun up close;
     an NPC's gun or a racked one never needs them as separate draw calls.
     In a no-hand / display context (actorweapons' NPC props, the armory
     rack) every static part that is a DIRECT child of the model, unnamed,
     unflagged, untextured and opaque, is merged into ONE mesh per material.
     Anything that moves or is looked up stays a part: the pump, the bipod
     legs and every optic are groups, the bore is flagged. The merged
     geometry is cached by the parts' signature, so every cop's M4 shares
     one geometry per material. */
  const BAKED = new Map();
  function bake(THREE, model, skin) {
    const parts = [];
    for (let i = 0; i < model.children.length; i++) {
      const o = model.children[i];
      if (!o.isMesh || o.name || !o.visible || !o.geometry || !o.geometry.attributes.position || !o.geometry.attributes.normal) continue;
      let flagged = false;
      for (const key in o.userData) { flagged = true; break; }
      const m = o.material;
      if (flagged || !m || Array.isArray(m) || m.map || m.transparent || m === skin) continue;
      o.updateMatrix();
      parts.push(o);
    }
    if (parts.length < 4) return 0;
    const sig = parts.map(function (o) {
      return o.geometry.uuid + "|" + o.material.uuid + "|" + o.matrix.elements.map(function (e) { return e.toFixed(5); }).join(",");
    }).join(";");
    let merged = BAKED.get(sig);
    if (!merged) {
      const byMat = new Map();
      parts.forEach(function (o) {
        if (!byMat.has(o.material)) byMat.set(o.material, []);
        byMat.get(o.material).push(o);
      });
      merged = [];
      byMat.forEach(function (list, material) {
        let n = 0;
        const geos = list.map(function (o) {
          const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
          n += g.attributes.position.count;
          return g;
        });
        const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
        const v = new THREE.Vector3(), nm = new THREE.Matrix3();
        let at = 0;
        geos.forEach(function (g, gi) {
          const M = list[gi].matrix, pa = g.attributes.position, na = g.attributes.normal;
          nm.getNormalMatrix(M);
          for (let i = 0; i < pa.count; i++, at++) {
            v.fromBufferAttribute(pa, i).applyMatrix4(M); P[at * 3] = v.x; P[at * 3 + 1] = v.y; P[at * 3 + 2] = v.z;
            v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); N[at * 3] = v.x; N[at * 3 + 1] = v.y; N[at * 3 + 2] = v.z;
          }
          if (g !== list[gi].geometry) g.dispose();
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
        geo.computeBoundingBox(); geo.computeBoundingSphere();
        geo._shared = true;
        merged.push({ geo: geo, material: material });
      });
      BAKED.set(sig, merged);
    }
    const cast = parts[0].castShadow, recv = parts[0].receiveShadow;
    parts.forEach(function (o) { model.remove(o); });
    merged.forEach(function (e) {
      const mesh = new THREE.Mesh(e.geo, e.material);
      mesh.castShadow = cast; mesh.receiveShadow = recv;
      model.add(mesh);
    });
    model.userData.bakedParts = parts.length;
    return parts.length;
  }
  GA.bake = bake;

  CBZ.gunKit = function (ctx) {
    return {
      // stamps the anchors (the builder's last call), then bakes a no-hand /
      // display model's static parts (see THE BAKE)
      anchors: function (model, spec) {
        const A = GA.stamp(ctx.THREE, model, spec);
        if (ctx.noHand || ctx.display) bake(ctx.THREE, model, ctx.mat && ctx.mat.skin);
        return A;
      },
      opticAnchors: function (group, o) { return GA.optic(ctx.THREE, group, o); },
      fin: function (name) { return finish(ctx, name); },
      prof: function (parent, key, outlines, width, material, o) { return prof(ctx, parent, key, outlines, width, material, o); },
      tube: function (parent, rF, rB, len, segs, material, x, y, z) { return tube(ctx, parent, rF, rB, len, segs, material, x, y, z); },
      lathe: function (parent, key, pts, segs, material, x, y, z, o) { return lathe(ctx, parent, key, pts, segs, material, x, y, z, o); },
      hand: function (parent, h) { return hand(ctx, parent, h); },
      // a NAME on a drawn part, nothing else: the reload rig (systems/gunhands.js
      // CBZ.gunReload) finds the moving parts by it ("part_mag", "part_bolt", ...)
      tag: function (m, name) { if (m) m.name = name; return m; },
      arc: arc,
      grip: gripOutline,
      rail: railOutline,
      ribs: ribbedRing,
    };
  };

  /* ---------------------------------------------------------- the pistol */
  CBZ.weaponAppearance.sidearm = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);
    const blued = K.fin("blued"), poly = K.fin("polymer");
    const g = new THREE.Group();

    // SLIDE: flat top, chamfered edges, the nose bevelled underneath
    K.tag(K.prof(g, "g17.slide", [
      [-0.004, 0.004], [0.398, 0.004], [0.414, 0.018], [0.414, 0.054],
      [0.404, 0.064], [0.006, 0.064], [-0.004, 0.056],
    ], 0.058, blued, { bevel: 0.005 }), "part_slide");
    // rear cocking serrations: six ribs proud of both flanks
    const ribs = [];
    for (let i = 0; i < 6; i++) {
      const f = 0.012 + i * 0.013;
      ribs.push([[f, 0.012], [f + 0.006, 0.012], [f + 0.006, 0.052], [f, 0.052]]);
    }
    K.tag(K.prof(g, "g17.serr", ribs, 0.066, mat.black, { bevel: 0 }), "part_slide");
    // ejection port + barrel hood, cut into the top right
    K.tag(box(g, 0.030, 0.010, 0.088, mat.black, 0.013, 0.066, -0.170), "part_slide");
    K.tag(box(g, 0.004, 0.012, 0.030, mat.dark, 0.031, 0.056, -0.112), "part_slide");    // extractor
    // sights: U-notch rear, post front with a white dot facing the eye
    K.tag(K.prof(g, "g17.rear", [
      [-0.024, 0], [0.024, 0], [0.024, 0.018], [0.008, 0.018], [0.006, 0.008],
      [-0.006, 0.008], [-0.008, 0.018], [-0.024, 0.018],
    ], 0.020, mat.black, { axis: "z", bevel: 0.002, y: 0.066, z: -0.022 }), "part_slide");
    // front post: square rear face toward the eye, ramped nose, dot on the face
    K.tag(K.prof(g, "g17.front", [[0.384, 0.064], [0.402, 0.064], [0.398, 0.078], [0.386, 0.086], [0.382, 0.086]],
      0.012, mat.black, { bevel: 0.001 }), "part_slide");
    K.tag(box(g, 0.007, 0.007, 0.002, K.fin("whiteDot"), 0, 0.079, -0.381), "part_slide");
    // muzzle: the barrel crown sits flush in the slide nose
    const bore = cyl(g, 0.012, 0.004, mat.bore || mat.black, 0, 0.036, -0.421, Math.PI / 2);
    bore.userData.weaponBore = true;

    // FRAME: dust cover with its accessory rail, and the square trigger
    // guard with a real hole through it
    K.prof(g, "g17.frame", [
      [-0.036, -0.012], [-0.014, 0.006], [0.392, 0.006], [0.392, -0.030],
      [0.232, -0.032], [0.240, -0.092], [0.226, -0.102], [0.112, -0.102],
      [0.094, -0.090], [0.080, -0.052], [-0.020, -0.052], [-0.036, -0.028],
    ], 0.054, poly, { bevel: 0.004,
      holes: [[[0.214, -0.038], [0.222, -0.088], [0.120, -0.088], [0.104, -0.040]]] });
    box(g, 0.050, 0.006, 0.110, mat.black, 0, -0.034, -0.320);          // rail slot shadow
    // trigger blade with its safety tongue
    box(g, 0.012, 0.050, 0.012, mat.black, 0, -0.062, -0.124, -0.28);

    // GRIP: 22-degree rake, finger grooves on the front strap, beavertail
    const R = 22 * Math.PI / 180, dx = -Math.sin(R), dy = -Math.cos(R), nx = Math.cos(R), ny = -Math.sin(R);
    const front = [], back = [];
    const f0 = [0.094, -0.046], b0 = [-0.026, -0.030], L = 0.236;
    for (let i = 0; i <= 6; i++) {
      const t = (i / 6) * L;
      const bump = (i === 2 || i === 3 || i === 4) ? 0.004 * ((i % 2) ? 1 : -0.5) : 0;
      front.push([f0[0] + dx * t + nx * bump, f0[1] + dy * t + ny * bump]);
      const swell = Math.sin((i / 6) * Math.PI) * 0.006;
      back.push([b0[0] + dx * t * 0.93 - nx * swell, b0[1] + dy * t * 0.93 - ny * swell]);
    }
    K.prof(g, "g17.grip", [[-0.040, -0.014], [-0.022, -0.002], [0.080, -0.006]]
      .concat(front).concat(back.reverse()).concat([[-0.046, -0.028]]), 0.068, poly, { bevel: 0.005 });
    // magazine baseplate, square to the grip
    const bx = (front[6][0] + back[0][0]) / 2, by = (front[6][1] + back[0][1]) / 2;
    K.tag(box(g, 0.072, 0.016, 0.118, mat.black, 0, by - 0.004, -bx + 0.004, -R), "part_mag");

    // the firing hand on the grip
    K.hand(g, { at: [-0.036, -0.030], rake: R, gripW: 0.068, gripD: 0.118, trigger: [-0.062, -0.118] });

    g.userData.muzzle = new THREE.Vector3(0, 0.036, -0.424);
    // WHERE THE HANDS GO — see systems/gunhands.js. A pistol is a two-hand
    // shot: the support hand wraps the firing hand from the gun's LEFT.
    g.userData.grips = {
      support: new THREE.Vector3(-0.085, -0.150, -0.020),
      mag: new THREE.Vector3(0, -0.262, 0.030),
      charge: new THREE.Vector3(0, 0.034, -0.045),     // rear slide serrations
      style: "mag",
    };
    // THE ANCHORS (contract up top). Grip top centre (-0.034 z, -0.038 y) run
    // 9 cm-model down the raked axis = mid-palm; the mag rides the same axis
    // in the grip, its well at the grip's foot.
    const down = (t) => [0, -0.038 - Math.cos(R) * t, -0.034 + Math.sin(R) * t];
    K.anchors(g, {
      k: 2.25,
      grip: { pos: down(0.090), rake: R },
      trigger: [0, -0.066, -0.128],
      support: { pos: [-0.034, down(0.090)[1], down(0.090)[2]], kind: "cup", len: 0 },
      mag: { pos: down(0.130), well: down(0.222), rake: R },
      stock: null,
      charge: [0, 0.034, -0.045],
      // U-notch (ears' top line, between the ears) -> front post top
      sight: { rear: [0, 0.083, -0.022], front: [0, 0.086, -0.384], eyeRelief: 0.42, type: "iron" },
      optic: { type: "iron", mag: 1 },
    });
    return g;
  };
})();
