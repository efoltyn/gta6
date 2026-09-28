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
    /* Slide the hand along the grip. The web goes as high as the grip allows
       (a high grip, not a hovering one: the thumb-side edge of the palm, web
       or index knuckle, whichever a diagonal hold lifts higher, stays under
       the top), and the index knuckle sits where the trigger is a relaxed
       finger's reach away (7 cm to the pad), as level with it as it can be.
       Sliding moves every point of the hand 1:1 along the axis, so one grasp
       measures the whole family and the search is arithmetic. */
    let t = -0.045 * k;
    spec.at.copy(top).addScaledVector(axis, t);
    {
      const G = FPH.grasp(spec);
      const idx0 = G.toM([FPH.FINGERS[0].x, 0, FPH.FINGERS[0].z]).clone();
      const hi0 = Math.max(G.toM([-FPH.PALM.hw, 0, -0.030]).clone().sub(top).dot(axis),
        G.toM([-FPH.PALM.hw * 0.8, 0, -0.090]).clone().sub(top).dot(axis));
      const tMax = t + (-0.004 * k - hi0);
      let best = tMax, bestC = Infinity;
      for (let tt = tMax; tt > tMax - 0.10 * k; tt -= 0.002 * k) {
        const idx = idx0.clone().addScaledVector(axis, tt - t);
        let c = (tMax - tt) * 0.2;                     // prefer high
        if (trig) {
          const d = idx.distanceTo(trig);
          c += Math.abs(d - 0.070 * k) + 0.3 * Math.abs(trig.clone().sub(idx).dot(axis));
        }
        if (c < bestC) { bestC = c; best = tt; }
      }
      t = best;
    }
    spec.at.copy(top).addScaledVector(axis, t);
    const hd = FPH.graspHand(parent, spec, ctx.mat.skin);
    hd.userData.fpGripHand = true;
    hd.userData.foreLocal = new THREE.Vector3(0, 0, 1);                    // a straight wrist
    return hd;
  }

  CBZ.gunKit = function (ctx) {
    return {
      fin: function (name) { return finish(ctx, name); },
      prof: function (parent, key, outlines, width, material, o) { return prof(ctx, parent, key, outlines, width, material, o); },
      tube: function (parent, rF, rB, len, segs, material, x, y, z) { return tube(ctx, parent, rF, rB, len, segs, material, x, y, z); },
      hand: function (parent, h) { return hand(ctx, parent, h); },
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
    K.prof(g, "g17.slide", [
      [-0.004, 0.004], [0.398, 0.004], [0.414, 0.018], [0.414, 0.054],
      [0.404, 0.064], [0.006, 0.064], [-0.004, 0.056],
    ], 0.058, blued, { bevel: 0.005 });
    // rear cocking serrations: six ribs proud of both flanks
    const ribs = [];
    for (let i = 0; i < 6; i++) {
      const f = 0.012 + i * 0.013;
      ribs.push([[f, 0.012], [f + 0.006, 0.012], [f + 0.006, 0.052], [f, 0.052]]);
    }
    K.prof(g, "g17.serr", ribs, 0.066, mat.black, { bevel: 0 });
    // ejection port + barrel hood, cut into the top right
    box(g, 0.030, 0.010, 0.088, mat.black, 0.013, 0.066, -0.170);
    box(g, 0.004, 0.012, 0.030, mat.dark, 0.031, 0.056, -0.112);    // extractor
    // sights: U-notch rear, post front with a white dot facing the eye
    K.prof(g, "g17.rear", [
      [-0.024, 0], [0.024, 0], [0.024, 0.018], [0.008, 0.018], [0.006, 0.008],
      [-0.006, 0.008], [-0.008, 0.018], [-0.024, 0.018],
    ], 0.020, mat.black, { axis: "z", bevel: 0.002, y: 0.066, z: -0.022 });
    box(g, 0.012, 0.020, 0.018, mat.black, 0, 0.076, -0.392);
    box(g, 0.007, 0.007, 0.002, K.fin("whiteDot"), 0, 0.080, -0.382);
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
    box(g, 0.072, 0.016, 0.118, mat.black, 0, by - 0.004, -bx + 0.004, -R);

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
    return g;
  };
})();
