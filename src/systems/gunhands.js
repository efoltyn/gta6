/* ============================================================
   systems/gunhands.js — THE OFF HAND ACTUALLY HOLDS THE GUN,
                         AND IT ACTUALLY RELOADS IT.

   OWNER, two bugs in one sentence: "I want animation in player for reloading
   gun, and I want to improve how they hold gun — right now it looks like the
   non-trigger hand is holding ABOVE the gun, not holding it."

   ---- WHY THE SUPPORT HAND MISSED --------------------------------------
   The drawn weapon is parented to the RIGHT hand socket and then has its
   world orientation overwritten every frame (systems/holsterprops.js locks
   the barrel to the crosshair). So the gun's real position and angle are the
   product of: body yaw damp → shoulder → elbow → wrist socket → aim lock →
   the ground-rest lift → this gun's own length and scale.

   The LEFT arm, meanwhile, was a table of hand-tuned Euler constants
   (entities/character.js, the `aimingPose` and `carryPose` branches). Those
   constants are a GUESS at where that chain ends up, and the guess has to be
   wrong, because it cannot depend on the two things that actually move the
   answer: which gun is drawn (a 1.3 m M249 handguard is nowhere near a
   pistol's), and where the aim lock just pointed it. Every previous fix
   re-tuned the guess for one more weapon — the git log has three rounds of
   exactly that, each ending "screenshot-diagnosed".

   So this module stops guessing. Each weapon publishes where its handguard
   IS (userData.grips.support, weapons/appearances/*.js), and the arm is
   SOLVED to that point with entities/character.js's exact two-bone IK. The
   hand lands on the gun for every weapon, every stance and every aim angle,
   including guns added tomorrow, because nothing here knows a weapon's name.

   …and a POINT was still not a hold: the socket landed near the handguard
   with the hand hanging off the forearm at whatever angle, walked half a
   metre back along every long gun when out of reach. Now the hand is put ON
   the part — a grip frame, a hand sized to it, the wrist where that hand's
   wrist has to be (CBZ.gunHold, systems/actorweapons.js) — and the body
   blades and shoulders the gun so the handguard is in reach at all
   (bladeTick; measured by tools/gun-hold-check.mjs).

   ---- AND THE RELOAD ----------------------------------------------------
   There was no reload animation at all: `fps.reloading` counted down, the HUD
   drew a "↻", the first-person viewmodel dipped, and in third person the
   player stood still holding a gun that silently refilled itself.

   A reload is the off hand's job, and the off hand is now solvable — so it is
   choreographed as a path THROUGH the same anchors: handguard → magwell →
   belt → magwell → charging handle → handguard, with the real magazine
   falling out of the gun on the way and a fresh one carried up in the fist.
   Five styles, picked from the weapon's own `grips.style`, because a belt-fed
   M249, a pump shotgun, a revolver and an RPG are not reloaded alike.

   Everything is driven off fps.reloading, which fpsmode.js already owns — no
   second timer, so the animation cannot desync from the ammo count.

   Flags (one-line reverts):
     CHAR_SUPPORT_HAND_IK  false → the old hand-tuned support-arm constants.
     CHAR_RELOAD_ANIM      false → reload is invisible again, hold IK stays.
     CHAR_SHOULDER_LONGGUN false → long guns go back to arm's length (and
                                   their handguards back out of reach).
     (NPC hands: systems/actorweapons.js CBZ.gunHold.ready — solved once per
      body and gun, both hands, no budget.)
============================================================ */
/* ==== CBZ.gunReload — THE RELOAD, ONE TABLE, BOTH VIEWS =====================
   Owner: "reload hand paths for every gun (FP and 3P): support hand goes to
   the real magazine / pump / bolt / shell, mag comes out and goes in,
   bolt-action works the bolt."

   Before this, a reload walked the off hand through three authored POINTS
   per gun (grips.mag / grips.charge / a typed pouch offset) while nothing on
   the gun moved: the magazine never left the well (a separate grey box fell
   out of the air under it, another rode the fist), the M4's charging handle,
   the Glock's slide, the M24's bolt, the revolver's cylinder and the M249's
   feed cover were all welded shut, and the sniper — a BOLT gun — was
   reloaded like an M4 by the support hand.

   Now the gun's own parts are the reload:
     · the appearance NAMES its moving parts (a name tag, no geometry:
       "part_mag", "part_slide", "part_charge", "part_bolt"/"part_boltKnob",
       "part_cylinder", "part_cover", "part_box"; reference parts "part_action",
       "part_receiver", "part_guard", "part_shell"). CBZ.holds' contract works
       too: an anchors[name] / "anchor_<name>" Object3D WITH meshes under it is
       a moving part; one without is a point.
     · rig(model) gathers each part once, measures it off its own vertices
       (centroid, box, the way out of the gun) and hangs it on a runtime pivot
       at its real joint: a magazine at its centroid, a slide/handle along the
       bore, the bolt on the bore axis, a revolver cylinder on its crane below
       and left of it, the M249 cover on its front hinge.
     · every anchor a hand goes to is a point ON a part, mapped through that
       part's live pivot, so a hand dwelling on the bolt knob travels with it.
     · RECIPES below is the one table: per reload style, the path of each
       hand as [pStart, pEnd, fromAnchor, toAnchor, arc] rows plus the part
       events (eject / grab / seat / charge / open / close). p is fpsmode's own
       reload clock (fps.reloading), so the animation cannot desync from the
       ammo count. The bolt gun also has a CYCLE: the firing hand works the
       bolt between shots off CBZ.fpsBoltCycle.
     · pose(model, p, o) puts every part where p says: the empty drops (first
       person: it falls out of the well; third person the caller hands a copy
       to the debris sim), the fresh one rides the carrying hand from the
       pouch and seats, the handle comes back and slams home.
   Third person (below, systems/gunhands.js) solves the body's arms to these
   anchors in world space with the pouch on the belt; first person
   (systems/fpsmode.js fpReloadHands) moves the viewmodel hands to the same
   anchors in model space with the pouch below the lens. Same rows, same
   parts, same events. Measured by tools/reload-hands-check.mjs. */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (u) => u * u * (3 - 2 * u);

  /* ---- THE TABLE --------------------------------------------------------
     l = the support (off) hand, r = the firing hand. Anchor names:
       support / grip  the hand's own hold (its home: on the gun, or for a
                       one-handed gun in third person wherever the free arm is)
       pouch           the belt / chest pouch (the view decides where)
       well, below     the magazine seated, and a hand's length out of the well
       charge          the charging handle / the slide's rear serrations (live)
       bolt            the bolt knob (live)
       port, portBelow, portAbove   the loading / ejection port
       cyl, cylFace, cylBack        the cylinder (live): its side, its chamber face, behind it
       latch, tray     the M249 feed-cover latch (live) and the feed tray under it
       box, boxBelow   the ammo box seated, and under it
       round, roundOut the rocket's bulb seated in the muzzle, and ahead of it
     p events: eject (the empty leaves), grab (fresh one in the hand), seat
     (it is in), charge [from, to] (the handle / slide comes back and home),
     open / cover [open0, open1, close0, close1], bolt [lift0, lift1, back0,
     back1, fwd0, fwd1, down0, down1]. Third person only: at = where the
     firing hand brings the gun for the work (body space, at torso scale 1;
     the player's right is -X), work = which way the muzzle points meanwhile
     (body space; systems/holsterprops.js turns the gun onto it). First
     person: fp = [dx, dy, dz, yaw, roll] the viewmodel comes by for the work
     (in toward the chest, turned and canted toward the off hand; fpsmode
     eases it in with the reload envelope, RL.fpWork). A shotgun
     re-arms fps.reloading per shell, so its whole row set runs again for
     each shell. */
  const RECIPES = {
    // box magazine: rifles, SMGs, pistols (the empty drops free, a fresh one
    // comes up from the pouch, the handle or slide is run)
    mag: {
      l: [
        [0.00, 0.14, "support", "well", 0.05],
        [0.14, 0.24, "well", "well", 0],            // thumb the release: the empty drops
        [0.24, 0.44, "well", "pouch", 0.14],
        [0.44, 0.54, "pouch", "pouch", 0],          // a fresh one out of the pouch
        [0.54, 0.74, "pouch", "below", 0.12],
        [0.74, 0.82, "below", "well", 0],           // up into the well and seated
        [0.82, 0.87, "well", "charge", 0.05],
        [0.87, 0.93, "charge", "charge", 0],        // the handle / slide back, and home
        [0.93, 1.00, "charge", "support", 0.04],
      ],
      eject: 0.18, grab: 0.50, seat: 0.82, charge: [0.87, 0.93], carry: "l", fresh: "mag",
      at: [-0.03, 1.53, 0.62], work: [0.50, -0.30, 0.81], fp: [-0.14, 0, 0.10, 0.30, 0.30],
    },
    // pump gun: one shell at a time up into the loading port under the
    // receiver; the pump racks when the last one is in (fpsmode pumpT)
    shell: {
      l: [
        [0.00, 0.26, "support", "pouch", 0.10],
        [0.26, 0.40, "pouch", "pouch", 0],          // pinch a shell
        [0.40, 0.68, "pouch", "portBelow", 0.09],
        [0.68, 0.84, "portBelow", "port", 0],       // thumbed into the tube
        [0.84, 1.00, "port", "support", 0.05],
      ],
      grab: 0.34, seat: 0.82, carry: "l", fresh: "shell",
      at: [-0.18, 1.48, 0.62], work: [0.42, -0.22, 0.88], fp: [-0.06, 0, 0.04, 0.15, 0.35],
    },
    // revolver / revolving drum: swing it out, dump the empties, speedloader
    // into the chambers, swing it shut
    cylinder: {
      l: [
        [0.00, 0.12, "support", "cyl", 0.04],
        [0.12, 0.28, "cyl", "cyl", 0],              // swing out, rod: the empties fall
        [0.28, 0.46, "cyl", "pouch", 0.13],
        [0.46, 0.56, "pouch", "pouch", 0],          // speedloader / a round
        [0.56, 0.76, "pouch", "cylBack", 0.11],
        [0.76, 0.84, "cylBack", "cylFace", 0],      // into the chambers
        [0.84, 0.92, "cylFace", "cyl", 0],          // and shut
        [0.92, 1.00, "cyl", "support", 0.04],
      ],
      eject: 0.24, grab: 0.50, seat: 0.82, open: [0.12, 0.20, 0.84, 0.90], carry: "l", fresh: "loader",
      at: [-0.18, 1.50, 0.62], work: [0.45, -0.12, 0.88], fp: [-0.10, 0.02, 0.08, 0.25, 0.45],
    },
    // belt-fed: cover up, empty box off, full box on, belt laid in, cover down
    belt: {
      l: [
        [0.00, 0.10, "support", "latch", 0.04],
        [0.10, 0.20, "latch", "latch", 0],          // feed cover up
        [0.20, 0.30, "latch", "box", 0.05],
        [0.30, 0.40, "box", "box", 0],              // the empty box off
        [0.40, 0.54, "box", "pouch", 0.15],
        [0.54, 0.62, "pouch", "pouch", 0],
        [0.62, 0.76, "pouch", "boxBelow", 0.13],
        [0.76, 0.82, "boxBelow", "box", 0],         // the full one on
        [0.82, 0.88, "box", "tray", 0.05],          // belt laid in the tray
        [0.88, 0.90, "tray", "latch", 0.02],
        [0.90, 0.95, "latch", "latch", 0],          // cover down under the palm
        [0.95, 1.00, "latch", "support", 0.04],
      ],
      eject: 0.36, grab: 0.58, seat: 0.82, cover: [0.10, 0.20, 0.90, 0.95], carry: "l", fresh: "box",
      at: [-0.20, 1.44, 0.62], work: [0.40, -0.18, 0.90], fp: [-0.06, 0, 0.04, 0.12, 0.15],
    },
    // a rocket goes in the FRONT of the tube
    rocket: {
      l: [
        [0.00, 0.26, "support", "pouch", 0.12],
        [0.26, 0.40, "pouch", "pouch", 0],
        [0.40, 0.74, "pouch", "roundOut", 0.16],
        [0.74, 0.86, "roundOut", "round", 0],       // shoved home
        [0.86, 1.00, "round", "support", 0.06],
      ],
      grab: 0.36, seat: 0.84, carry: "l", fresh: "spare",
      at: [-0.22, 1.40, 0.40], work: [0.82, -0.30, 0.49], fp: [-0.30, -0.04, 0.30, 1.25, 0.10],
    },
    // BOLT ACTION (the M24): the support hand keeps the rifle; the FIRING
    // hand leaves the grip, lifts the bolt and draws it back, thumbs the
    // rounds down through the open action, runs the bolt home and down
    bolt: {
      r: [
        [0.00, 0.08, "grip", "bolt", 0.03],
        [0.08, 0.20, "bolt", "bolt", 0],            // up, back
        [0.20, 0.40, "bolt", "pouch", 0.12],
        [0.40, 0.50, "pouch", "pouch", 0],          // rounds out of the pouch
        [0.50, 0.70, "pouch", "portAbove", 0.10],
        [0.70, 0.80, "portAbove", "port", 0],       // pressed into the magazine
        [0.80, 0.86, "port", "bolt", 0.02],
        [0.86, 0.94, "bolt", "bolt", 0],            // forward, down
        [0.94, 1.00, "bolt", "grip", 0.03],
      ],
      grab: 0.45, seat: 0.78, bolt: [0.08, 0.13, 0.13, 0.20, 0.86, 0.91, 0.91, 0.94], carry: "r", fresh: "clip",
      work: [0.25, -0.25, 0.93], fp: [0, 0, 0.04, 0, -0.20],
    },
  };
  // between shots (CBZ.fpsBoltCycle, 0..1): up, back, forward, down
  const CYCLES = {
    bolt: {
      r: [
        [0.00, 0.18, "grip", "bolt", 0.03],
        [0.18, 0.74, "bolt", "bolt", 0],
        [0.74, 1.00, "bolt", "grip", 0.03],
      ],
      bolt: [0.18, 0.30, 0.30, 0.48, 0.48, 0.64, 0.64, 0.74],
    },
  };
  // a mag-fed gun whose magazine is not tagged still reloads (the old
  // points), and an unknown style is a magazine
  function styleOf(model) {
    const g = model && model.userData && model.userData.grips;
    const s = g && g.style;
    return RECIPES[s] ? s : "mag";
  }

  /* ---- finding and measuring the parts ---------------------------------- */
  const _M = new THREE.Matrix4(), _v = new THREE.Vector3();
  function toModel(o, model, out) {
    out.identity();
    for (let p = o; p && p !== model; p = p.parent) { p.updateMatrix(); out.premultiply(p.matrix); }
    return out;
  }
  function hasMesh(o) {
    let any = false;
    o.traverse(function (m) { if (m.isMesh) any = true; });
    return any;
  }
  // every object carrying this part's name (outermost only), or the
  // hold engine's named anchor when it is a real piece of the gun
  function partObjects(model, name) {
    const out = [];
    const tags = { ["part_" + name]: 1, ["part:" + name]: 1 };
    model.traverse(function (o) {
      if (!tags[o.name]) return;
      for (let p = o.parent; p && p !== model; p = p.parent) if (tags[p.name]) return;
      out.push(o);
    });
    if (!out.length) {
      const an = model.userData.anchors && model.userData.anchors[name];
      if (an && an.isObject3D && hasMesh(an)) out.push(an);
      else {
        const byName = model.getObjectByName("anchor_" + name);
        if (byName && hasMesh(byName)) out.push(byName);
      }
    }
    return out;
  }
  function gather(list, model, pts) {
    pts = pts || [];
    for (const o of list) {
      o.traverse(function (m) {
        if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
        const pos = m.geometry.attributes.position;
        toModel(m, model, _M);
        const step = Math.max(1, Math.floor(pos.count / 600));
        for (let i = 0; i < pos.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(_M));
      });
    }
    return pts;
  }
  function stats(pts) {
    if (!pts.length) return null;
    const box = new THREE.Box3(), c = new THREE.Vector3();
    for (const p of pts) { box.expandByPoint(p); c.add(p); }
    c.multiplyScalar(1 / pts.length);
    return { box: box, c: c, size: box.getSize(new THREE.Vector3()), n: pts.length };
  }
  // hang the part's meshes on a pivot at `at` (model space), world poses kept
  function pivotFor(model, list, at, name) {
    const pv = new THREE.Group();
    pv.name = "reload:" + name;
    pv.position.copy(at);
    model.add(pv);
    pv.updateMatrix();
    const inv = new THREE.Matrix4().copy(pv.matrix).invert(), M = new THREE.Matrix4();
    for (const o of list) {
      toModel(o, model, M).premultiply(inv);
      if (o.parent) o.parent.remove(o);
      M.decompose(o.position, o.quaternion, o.scale);
      pv.add(o);
    }
    pv.userData.homeP = pv.position.clone();
    pv.userData.homeQ = pv.quaternion.clone();
    pv.userData.homeInv = inv;
    return pv;
  }
  // a point measured on a part at home, where that part is NOW (model space)
  function live(pv, home, out) {
    out.copy(home);
    if (!pv) return out;
    pv.updateMatrix();
    return out.applyMatrix4(pv.userData.homeInv).applyMatrix4(pv.matrix);
  }
  function brassMat() {
    if (!brassMat.m) { brassMat.m = new THREE.MeshLambertMaterial({ color: 0xc9a14a }); brassMat.m._shared = true; }
    return brassMat.m;
  }
  function roundMesh(r, len, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
    m.rotation.x = -Math.PI / 2;                 // along the bore
    m.castShadow = true;
    return m;
  }
  // the reload's own props, built only where the gun has nothing to lend:
  // a speedloader / a 40 mm round sized off the measured cylinder, a stripper
  // clip of 7.62 for the bolt gun, a magazine body for a pistol whose drawn
  // magazine is only its baseplate (sized to the drawn grip it sits in)
  function makeLoader(r) {
    const g = new THREE.Group();
    if (r > 0.09) {
      // a drum this fat is a 40 mm launcher: one grenade at a time
      g.add(roundMesh(0.026, 0.11, brassMat()));
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 6), new THREE.MeshLambertMaterial({ color: 0x9d2523 }));
      nose.position.z = -0.055; g.add(nose);
    } else {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, m = roundMesh(r * 0.17, r * 1.1, brassMat());
        m.position.set(Math.cos(a) * r * 0.56, Math.sin(a) * r * 0.56, 0);
        g.add(m);
      }
      const knob = roundMesh(r * 0.30, r * 0.9, new THREE.MeshLambertMaterial({ color: 0x1c1f23 }));
      knob.position.z = r * 0.6;
      g.add(knob);
    }
    return g;
  }
  function makeClip() {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const m = roundMesh(0.012, 0.14, brassMat());
      m.position.set(0, -i * 0.022, 0);
      g.add(m);
    }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.020), new THREE.MeshLambertMaterial({ color: 0x55585c }));
    strip.position.set(0, -0.044, 0.07);
    g.add(strip);
    return g;
  }

  /* rig(model): measured once per model, cached on it. */
  function rig(model) {
    const ud = model.userData;
    if (ud._reloadRig) return ud._reloadRig;
    const g = ud.grips || {};
    const A = (CBZ.holds && CBZ.holds.anchors) ? CBZ.holds.anchors(model) : {};
    const R = { style: styleOf(model), pts: {}, pv: {}, fresh: null, freshGrab: null, made: false, dropDir: new THREE.Vector3(0, -1, 0) };
    ud._reloadRig = R;
    model.updateMatrix();
    const pt = function (key, v, pv) { if (v) R.pts[key] = { p: v.clone(), pv: pv || null }; };
    const authored = function (k) { return A[k] || g[k] || null; };
    pt("support", g.support || A.support || null);
    const INSERT = 0.12;                        // a hand's length out of the well, model units (~6 cm)
    // the gun without the part: which way is OUT of it
    const outOf = function (part, st) {
      const rest = [];
      model.traverse(function (m) {
        if (!m.isMesh || !m.geometry || /^fp_hand/.test(m.name)) return;
        for (let p = m; p && p !== model; p = p.parent) if (part.indexOf(p) >= 0 || /^reload:/.test(p.name)) return;
        rest.push(m);
      });
      const sr = stats(gather(rest, model));
      const d = sr ? st.c.clone().sub(sr.c) : new THREE.Vector3(0, -1, 0);
      if (d.lengthSq() < 1e-6) d.set(0, -1, 0);
      return d.normalize();
    };
    // a magazine-like part: dropped, carried, seated
    const magLike = function (name, below) {
      let list = partObjects(model, name);
      if (!list.length) return null;
      let st = stats(gather(list, model));
      if (!st) return null;
      // a pistol draws only its baseplate: give the magazine its body, up
      // the drawn grip to the frame (hidden inside the grip while seated)
      if (name === "mag" && st.size.y < 0.06) {
        let owner = null;
        model.traverse(function (o) { if (!owner && o.userData && o.userData.fireGrip) owner = o; });
        const h = owner && owner.userData.fireGrip;
        if (h) {
          toModel(owner, model, _M);
          const top = new THREE.Vector3(0, h.at[0], h.at[1]).applyMatrix4(_M);
          const len = top.distanceTo(st.c);
          const m0 = list[0].isMesh ? list[0] : null;
          const body = new THREE.Mesh(new THREE.BoxGeometry(h.gripW * 0.72, len, h.gripD * 0.66), (m0 && m0.material) || brassMat());
          body.position.copy(top).add(st.c).multiplyScalar(0.5);
          body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(st.c).normalize());
          body.name = "part_mag";
          body.castShadow = true;
          (list[0].parent || model).add(body);
          list = list.concat([body]);
          st = stats(gather(list, model));
        }
      }
      const dir = outOf(list, st);
      const pv = pivotFor(model, list, st.c, name);
      const grab = new THREE.Vector3(st.box.min.x, st.c.y, st.c.z);   // the part's own left face
      pt(name === "mag" ? "well" : name, grab);
      pt(below, grab.clone().addScaledVector(dir, INSERT));
      R.pv[name] = pv;
      R.dropDir.copy(dir);
      R.fresh = pv; R.freshGrab = grab.clone(); R.made = false;
      return st;
    };
    const style = R.style;
    if (style === "mag") {
      if (!magLike("mag", "below")) {
        const w = authored("mag") || g.support;
        pt("well", w); pt("below", w && w.clone().add(new THREE.Vector3(0, -INSERT, 0)));
      }
      let list = partObjects(model, "slide"), kind = "slide";
      if (!list.length) { list = partObjects(model, "charge"); kind = "charge"; }
      const st = list.length ? stats(gather(list, model)) : null;
      if (st) {
        const pv = pivotFor(model, list, st.c, kind);
        const len = st.size.z;
        R.pv.charge = pv;
        R.chargeTravel = kind === "slide" ? 0.16 * len : 0.10;
        // a slide is grabbed over its rear serrations, a handle by itself
        pt("charge", kind === "slide" ? new THREE.Vector3(st.box.min.x, (st.c.y + st.box.max.y) / 2, st.box.max.z - 0.22 * len) : st.c, pv);
      } else pt("charge", authored("charge") || (R.pts.well && R.pts.well.p));
    } else if (style === "belt") {
      const cov = partObjects(model, "cover");
      const opt = model.getObjectByName("_baseOptic");
      const cst = cov.length ? stats(gather(cov, model)) : null;
      if (cst) {
        // the M145 rides the feed cover's rail: it lifts with it
        if (opt && opt.parent === model) {
          const o = stats(gather([opt], model));
          if (o && o.c.z < cst.box.max.z && o.c.z > cst.box.min.z) cov.push(opt);
        }
        const pv = pivotFor(model, cov, new THREE.Vector3(cst.c.x, cst.box.max.y, cst.box.min.z), "cover");   // hinged at the front
        R.pv.cover = pv;
        pt("latch", new THREE.Vector3(cst.c.x, cst.box.max.y, cst.box.max.z), pv);
        pt("tray", new THREE.Vector3(cst.box.min.x, cst.box.min.y, cst.c.z));
      } else { pt("latch", authored("charge")); pt("tray", authored("charge")); }
      if (!magLike("box", "boxBelow")) {
        const w = authored("mag");
        pt("box", w); pt("boxBelow", w && w.clone().add(new THREE.Vector3(0, -INSERT, 0)));
      }
    } else if (style === "cylinder") {
      const list = partObjects(model, "cylinder");
      const st = list.length ? stats(gather(list, model)) : null;
      let r = 0.06;
      if (st) {
        r = st.size.y / 2;
        // the crane: below and left of the cylinder, parallel to the bore
        const pv = pivotFor(model, list, new THREE.Vector3(st.c.x - r, st.c.y - 0.9 * r, st.c.z), "cylinder");
        R.pv.cylinder = pv;
        pt("cyl", new THREE.Vector3(st.box.min.x, st.c.y, st.c.z), pv);
        pt("cylFace", new THREE.Vector3(st.c.x, st.c.y, st.box.max.z), pv);
        pt("cylBack", new THREE.Vector3(st.c.x, st.c.y, st.box.max.z + INSERT), pv);
      } else {
        const m = authored("mag");
        pt("cyl", m); pt("cylFace", m); pt("cylBack", m && m.clone().add(new THREE.Vector3(0, 0, INSERT)));
      }
      const ld = makeLoader(r);
      ld.name = "reload:loader";
      ld.visible = false;
      model.add(ld);
      R.fresh = ld; R.made = true; R.loaderR = r;
    } else if (style === "shell") {
      const rec = stats(gather(partObjects(model, "receiver"), model));
      const grd = stats(gather(partObjects(model, "guard"), model));
      // the loading port: under the receiver, between the trigger plate and its front
      const port = A.shellPort || A.port ||
        (rec && grd ? new THREE.Vector3(0, rec.box.min.y, (grd.box.min.z + rec.box.min.z) / 2) : authored("mag"));
      pt("port", port);
      pt("portBelow", port && port.clone().add(new THREE.Vector3(-0.04, -INSERT, 0.03)));
      const tpl = partObjects(model, "shell")[0];
      let sh = null;
      if (tpl && tpl.isMesh) {
        sh = new THREE.Mesh(tpl.geometry, tpl.material);
        sh.rotation.x = -Math.PI / 2;            // lying along the tube, brass back
      } else sh = roundMesh(0.016, 0.086, brassMat());
      const holder = new THREE.Group();
      holder.name = "reload:shell";
      holder.add(sh);
      holder.visible = false;
      model.add(holder);
      R.fresh = holder; R.made = true;
    } else if (style === "rocket") {
      const wh = ud.warhead;
      let spare = ud.reloadWarhead || null;
      if (wh && !spare) {
        spare = wh.clone();
        spare.visible = false;
        model.add(spare);
      }
      if (wh) {
        // the bulb: the fattest band of the round's own lathe
        const pts = gather([wh], model);
        const ax = wh.position;
        let maxR = 0;
        for (const p of pts) maxR = Math.max(maxR, Math.hypot(p.x - ax.x, p.y - ax.y));
        const c = new THREE.Vector3(); let n = 0;
        for (const p of pts) if (Math.hypot(p.x - ax.x, p.y - ax.y) >= 0.92 * maxR) { c.add(p); n++; }
        c.multiplyScalar(1 / Math.max(1, n));
        const under = new THREE.Vector3(ax.x, ax.y - maxR, c.z);   // the palm under the bulb
        pt("round", under);
        pt("roundOut", under.clone().add(new THREE.Vector3(0, 0, -0.22)));
        R.freshGrab = under.clone();
      } else {
        const m = authored("mag");
        pt("round", m); pt("roundOut", m && m.clone().add(new THREE.Vector3(0, 0, -0.30)));
      }
      R.fresh = spare; R.made = false; R.spareHome = wh ? wh.position.clone() : null;
    } else if (style === "bolt") {
      const bolt = partObjects(model, "bolt"), knob = partObjects(model, "boltKnob");
      const act = stats(gather(partObjects(model, "action"), model));
      const all = bolt.concat(knob);
      const ks = knob.length ? stats(gather(knob, model)) : null;
      const bs = all.length ? stats(gather(all, model)) : null;
      if (bs) {
        const axisY = ud.muzzle ? ud.muzzle.y : (act ? act.c.y : bs.c.y);
        const knobC = ks ? ks.c : bs.c;
        const at = new THREE.Vector3(0, axisY, knobC.z);
        const travel = act ? 0.45 * act.size.z : 0.17;
        // the bolt body the handle drags out of the action (hidden inside it at home)
        const r = act ? act.size.y * 0.5 * 0.62 : 0.018;
        const body = roundMesh(r, travel + 0.04, new THREE.MeshPhongMaterial({ color: 0x8d969f, shininess: 40 }));
        body.position.set(0, axisY, knobC.z - (travel + 0.04) / 2 + 0.02);
        body.name = "part_bolt";
        model.add(body);
        all.push(body);
        const pv = pivotFor(model, all, at, "bolt");
        R.pv.bolt = pv;
        R.boltTravel = travel;
        pt("bolt", knobC, pv);
        // the port on top of the action, in front of the handle where the bolt body lies
        const port = A.port || new THREE.Vector3(act ? act.c.x + act.size.x * 0.15 : 0.01, act ? act.box.max.y : axisY + 0.03, knobC.z - travel * 0.55);
        pt("port", port);
        pt("portAbove", port.clone().add(new THREE.Vector3(0.03, INSERT, 0.02)));
      } else {
        pt("bolt", authored("charge")); pt("port", authored("mag")); pt("portAbove", authored("mag"));
      }
      const clip = makeClip();
      clip.name = "reload:clip";
      clip.visible = false;
      model.add(clip);
      R.fresh = clip; R.made = true;
    }
    return R;
  }

  /* point(model, key, out) -> model space, or null for the view's own keys
     (support / grip / pouch) and anything this gun does not have */
  function point(model, key, out) {
    const R = rig(model);
    const d = R.pts[key];
    if (!d || !d.p) return null;
    live(d.pv, d.p, out);
    if (key === "support" && model.userData.pump) out.z += model.userData.pump.position.z - (model.userData.pumpBaseZ || 0);
    return out;
  }
  /* seg(rows, u): the row p is in, eased, with the arc bow */
  const _seg = { row: null, a: null, b: null, u: 0, arc: 0, dwell: false, i: -1 };
  function seg(rows, p) {
    let i = 0;
    while (i < rows.length - 1 && p > rows[i][1]) i++;
    const r = rows[i];
    const u = smooth(clamp01((p - r[0]) / Math.max(1e-4, r[1] - r[0])));
    _seg.row = r; _seg.i = i; _seg.a = r[2]; _seg.b = r[3]; _seg.u = u;
    _seg.arc = r[4] * Math.sin(Math.PI * u); _seg.dwell = r[2] === r[3];
    return _seg;
  }
  // 0..1 over [a, b], held, back over [c, d]
  function openAt(p, k) {
    if (p < k[0]) return 0;
    if (p < k[1]) return smooth((p - k[0]) / (k[1] - k[0]));
    if (p < k[2]) return 1;
    if (p < k[3]) return 1 - smooth((p - k[2]) / (k[3] - k[2]));
    return 0;
  }
  const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
  function home(pv) {
    if (!pv) return;
    pv.position.copy(pv.userData.homeP);
    pv.quaternion.copy(pv.userData.homeQ);
    pv.visible = true;
  }
  function turn(pv, axis, ang) {
    pv.position.copy(pv.userData.homeP);
    pv.quaternion.copy(pv.userData.homeQ).multiply(_q.setFromAxisAngle(_ax.copy(axis), ang));
  }
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  function boltTo(R, keys, p) {
    const pv = R.pv.bolt;
    if (!pv) return;
    const lift = openAt(p, [keys[0], keys[1], keys[6], keys[7]]);
    const back = openAt(p, [keys[2], keys[3], keys[4], keys[5]]);
    turn(pv, Z, 1.05 * lift);                         // the handle swings up off its notch
    pv.position.z += R.boltTravel * back;              // and the bolt comes back out of the action
  }
  const FALL_P = 0.12;
  /* pose(model, p, o): every part where reload progress p (0..1, <0 = not
     reloading) puts it. o.hand = where the carrying hand is (model space),
     o.drop = "fall" (first person: the empty falls out of the well and is
     gone) or "hide" (third person: the caller drops a real copy),
     o.cycle = the bolt cycle 0..1 between shots (-1 none). */
  function pose(model, p, o) {
    const R = rig(model), rec = RECIPES[R.style];
    o = o || {};
    // everything home first
    for (const k in R.pv) home(R.pv[k]);
    if (R.made && R.fresh) R.fresh.visible = false;
    if (R.style === "rocket" && R.fresh) R.fresh.visible = false;
    const cyc = o.cycle != null ? o.cycle : -1;
    if (!(p >= 0)) {
      if (cyc >= 0 && R.style === "bolt" && CYCLES.bolt) boltTo(R, CYCLES.bolt.bolt, cyc);
      return R;
    }
    // moving parts
    if (rec.charge && R.pv.charge) {
      const k = rec.charge, u = clamp01((p - k[0]) / (k[1] - k[0]));
      const back = p < k[0] || p > k[1] ? 0 : u < 0.55 ? smooth(u / 0.55) : u < 0.8 ? 1 : 1 - smooth((u - 0.8) / 0.2);
      R.pv.charge.position.z += R.chargeTravel * back;
    }
    if (rec.open && R.pv.cylinder) turn(R.pv.cylinder, Z, 1.6 * openAt(p, rec.open));
    if (rec.cover && R.pv.cover) turn(R.pv.cover, X, -0.95 * openAt(p, rec.cover));
    if (rec.bolt) boltTo(R, rec.bolt, p);
    // the fresh one (and, for a magazine / box, the empty before it)
    const f = R.fresh;
    if (!f) return R;
    if (!R.made && R.style !== "rocket") {
      // the gun's own magazine / box
      if (rec.eject != null && p >= rec.eject && p < rec.grab) {
        const t = (p - rec.eject) / FALL_P;
        if (o.drop === "fall" && t < 1) {
          f.position.copy(f.userData.homeP).addScaledVector(R.dropDir, 0.02 + 1.4 * t * t);
        } else f.visible = false;
      } else if (p >= rec.grab && p < rec.seat) {
        if (o.hand) f.position.copy(f.userData.homeP).add(o.hand).sub(R.freshGrab);
        else f.position.copy(f.userData.homeP).addScaledVector(R.dropDir, 0.12);
      }
      return R;
    }
    if (p >= rec.grab && p < rec.seat) {
      f.visible = true;
      if (R.style === "rocket") {
        if (R.spareHome && R.freshGrab && o.hand) f.position.copy(R.spareHome).add(o.hand).sub(R.freshGrab);
        else if (R.spareHome) f.position.copy(R.spareHome);
      } else if (o.hand) f.position.copy(o.hand);
      else f.visible = false;
    }
    return R;
  }
  /* the empties, placed where they leave the gun, for the caller to hand to
     a physics body (third person) — null when nothing falls out */
  function ejectObject(model) {
    const R = rig(model), rec = RECIPES[R.style];
    if (rec.eject == null) return null;
    if (R.style === "cylinder") {
      const f = R.fresh;
      if (!f) return null;
      point(model, "cylFace", f.position);
      f.visible = true;
      return f;
    }
    return R.fresh && !R.made ? R.fresh : null;
  }

  CBZ.gunReload = {
    RECIPES: RECIPES, CYCLES: CYCLES,
    styleOf: styleOf,
    recipe: function (model) { return model ? RECIPES[styleOf(model)] : null; },
    cycle: function (model) { return model ? CYCLES[styleOf(model)] || null : null; },
    rig: rig, point: point, seg: seg, pose: pose, ejectObject: ejectObject,
    // the viewmodel's reload offset at progress p: [dx, dy, dz, yaw, roll]
    // scaled by the same 12% ease the third-person envelope uses
    fpWork: function (model, p, out) {
      const r = RECIPES[styleOf(model)], f = r && r.fp;
      const w = p >= 0 ? smooth(clamp01(Math.min(p / 0.12, (1 - p) / 0.12))) : 0;
      for (let i = 0; i < 5; i++) out[i] = f ? f[i] * w : 0;
      return out;
    },
    // the pump's stroke at rack phase t (0..1): back and home (shotgun.js contract)
    rackAt: function (t) { return Math.sin(clamp01(t) * Math.PI) * 0.22; },
    // parts actually found on this model, by name (for the checks)
    parts: function (model) { return rig(model).pv; },
  };
})();

(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  /* The grip frames, the hand-on-grip solve and the NPC ready pose live in
     systems/actorweapons.js (CBZ.gunHold), beside the gun models they read. */
  const GH = CBZ.gunHold;
  if (!GH) return;

  if (!CBZ.onAlways) return;
  if (CBZ.CONFIG.CHAR_SUPPORT_HAND_IK == null) CBZ.CONFIG.CHAR_SUPPORT_HAND_IK = true;
  if (CBZ.CONFIG.CHAR_RELOAD_ANIM == null) CBZ.CONFIG.CHAR_RELOAD_ANIM = true;
  if (CBZ.CONFIG.CHAR_SHOULDER_LONGGUN == null) CBZ.CONFIG.CHAR_SHOULDER_LONGGUN = true;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3();
  const _tmp = new THREE.Vector3(), _bodyQ = new THREE.Quaternion();

  /* ---- WHERE A WEAPON'S HANDS GO ----------------------------------------
     Authored per weapon in weapons/appearances/*.js. The one prop that can
     reach here without them is actorweapons.js's `fallbackWeapon` — an
     unknown id — so that shape's own handguard is the default rather than a
     null that would silently turn the whole layer off. Cached on the prop. */
  const FALLBACK_GRIPS = {
    support: new THREE.Vector3(0, -0.030, -0.450),
    mag: new THREE.Vector3(0, -0.170, -0.050),
    charge: null,
    style: "mag",
    authored: false,
  };
  function gripsOf(prop) {
    const ud = prop.userData;
    if (ud._gripCache) return ud._gripCache;
    const g = ud.grips;
    const out = g ? {
      support: g.support || null,
      mag: g.mag || g.support || null,
      charge: g.charge || null,
      style: g.style || "mag",
      authored: true,
    } : FALLBACK_GRIPS;
    ud._gripCache = out;
    return out;
  }

  /* ---- THE RELOAD, THIRD PERSON -------------------------------------------
     The table, the parts and their anchors are CBZ.gunReload (the block at
     the top of this file, shared with first person). This side owns the
     body: the pouch on the belt, the arms solved to the anchors in world
     space, the empty handed to the debris sim. */
  const RL = CBZ.gunReload;
  const R = {
    active: false, style: "mag", total: 1, last: 0, p: 0, w: 0,
    cant: 0, dip: 0, ejected: false, id: null, step: 0, work: null,
  };
  /* Published for systems/holsterprops.js, which owns the drawn gun's world
     orientation: a gun being reloaded is not a gun being aimed. */
  CBZ.gunReloadPose = function () {
    return R.active
      ? { active: true, p: R.p, weight: R.w, cant: R.cant, dip: R.dip, style: R.style, work: R.work }
      : { active: false, p: 0, weight: 0, cant: 0, dip: 0, style: null, work: null };
  };

  function reloadRow() {
    const fps = CBZ.fps;
    if (!fps || !CBZ.FPS_WEAPONS) return null;
    return CBZ.FPS_WEAPONS[fps.weapon] || null;
  }

  function reloadTick(dt) {
    const fps = CBZ.fps;
    const left = fps && fps.reloading > 0 ? fps.reloading : 0;
    if (!left || CBZ.CONFIG.CHAR_RELOAD_ANIM === false ||
        !CBZ.player || CBZ.player.dead) {
      R.active = false; R.w = 0; R.p = 0; R.cant = 0; R.dip = 0;
      R.last = 0;
      return;
    }
    // the STYLE is the drawn weapon's own (a pistol with no third-person gun
    // drawn, first person, still has its row's appearance to read)
    const drawn = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    const fpM = CBZ.fpsWeaponModels && fps ? CBZ.fpsWeaponModels[fps.weapon] : null;
    R.style = RL.styleOf(drawn || fpM);
    R.work = (RL.RECIPES[R.style] && RL.RECIPES[R.style].work) || null;
    const row = reloadRow();
    // A NEW STEP is a timer that went UP: either the reload just started, or
    // the shotgun re-armed for the next shell. Either way the path restarts.
    if (!R.active || left > R.last + 1e-4) {
      R.total = Math.max(0.12, (row && row.reload) || left);
      R.ejected = false;
      R.step = R.active ? R.step + 1 : 0;
      if (!R.active) R.id = CBZ.currentWeaponId || null;
      R.active = true;
    }
    R.last = left;
    R.p = clamp01(1 - left / R.total);
    // ease the whole layer in and out so a reload never snaps on
    R.w = smooth(clamp01(Math.min(R.p / 0.12, (1 - R.p) / 0.12)));
    // The gun cants toward the body to present the part being worked — that
    // roll is most of what makes a reload READ from the chase camera. A
    // cylinder cants hardest (you look into the chambers), the bolt gun to
    // show its open action, a belt gun barely (fed from the top, 7.5 kg).
    const rollK = R.style === "cylinder" ? 1.35 : R.style === "belt" ? 0.45
      : R.style === "rocket" ? 0.30 : R.style === "bolt" ? 0.6 : 1;
    R.cant = 0.62 * rollK * R.w;
    R.dip = 0.30 * R.w;
  }

  /* ---- the body's anchors ------------------------------------------------ */
  function torsoScale(ch) {
    const pf = ch.profile;
    return pf && pf.torsoH ? (pf.legUp + pf.legLo + pf.torsoH) / 1.90 : 1;
  }
  // Magazines ride the LEFT front hip, shells the left side of the belt, a
  // rocket comes off the left shoulder, rifle rounds from the RIGHT chest
  // (the firing hand fetches them). makeCharacter mirrors the arm roots, so
  // the player's LEFT is body +X.
  function pouchLocal(ch, style, out) {
    const s = torsoScale(ch);
    if (style === "rocket") return out.set(0.30 * s, 1.28 * s, -0.14 * s);
    if (style === "shell") return out.set(0.30 * s, 1.10 * s, 0.06 * s);
    if (style === "bolt") return out.set(-0.24 * s, 1.24 * s, 0.14 * s);
    return out.set(0.31 * s, 1.01 * s, 0.11 * s);
  }
  // "support" is the grip the off hand holds; every other gun anchor is a
  // point on the gun's own parts (CBZ.gunReload), carried into world space
  function anchorWorld(key, ch, prop, grips, out) {
    if (key === "pouch") {
      pouchLocal(ch, RL.styleOf(prop), out);
      return ch.body.localToWorld(out);
    }
    if (key === "support") {
      if (!grips.support) return null;
      out.copy(grips.support);
      if (prop.userData._pumpDz) out.z += prop.userData._pumpDz;
      return prop.localToWorld(out);
    }
    if (!RL.point(prop, key, out)) return null;
    return prop.localToWorld(out);
  }

  /* ---- the empty, handed to the debris sim --------------------------------
     A reload you can only see in the arms is half an animation; the piece
     that sells it is the empty mag hitting the pavement behind you. It is a
     copy of the gun's OWN magazine / ammo box / the revolver's empties, baked
     into one mesh where it left the gun and handed to CBZ.debris.adopt: the
     one rigid-body sim gives it gravity, a bounce, a tumble onto its side,
     and then it lies there as settled debris (capped and recycled there). */
  const _dv = new THREE.Vector3(), _dw = new THREE.Vector3(), _dp = new THREE.Vector3();
  function bakedCopy(obj) {
    obj.updateWorldMatrix(true, true);
    const arrays = [];
    let mat = null, n = 0;
    obj.traverse(function (m) {
      if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
      for (let a = m; a && a !== obj.parent; a = a.parent) if (a.visible === false && a !== obj) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const pos = g.attributes.position, out = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        _dp.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        out[i * 3] = _dp.x; out[i * 3 + 1] = _dp.y; out[i * 3 + 2] = _dp.z;
      }
      if (g !== m.geometry) g.dispose();
      arrays.push(out); n += out.length;
      if (!mat) mat = Array.isArray(m.material) ? m.material[0] : m.material;
    });
    if (!n) return null;
    const all = new Float32Array(n);
    let o = 0;
    for (const a of arrays) { all.set(a, o); o += a.length; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(all, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }
  function dropEmpty(prop) {
    const obj = RL.ejectObject(prop);
    const root = CBZ.scene;
    if (!obj || !root || !CBZ.debris || !CBZ.debris.adopt) return;
    const m = bakedCopy(obj);
    if (!m) return;
    root.add(m);
    m.updateMatrixWorld(true);
    const p = CBZ.player;
    _dv.set((p && p.vx ? p.vx * 0.5 : 0) + (Math.random() - 0.5) * 0.5, -0.4,
      (p && p.vz ? p.vz * 0.5 : 0) + (Math.random() - 0.5) * 0.5);
    _dw.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
    // kind plastic: a polymer/steel mag body that must not be "bent" like torn sheet metal
    CBZ.debris.adopt(m, { velocity: _dv, angular: _dw, owner: "mags", kind: "plastic" });
    // the body carries its own copy of the geometry; the template goes
    root.remove(m);
    m.geometry.dispose();
    if (CBZ.sfx) setTimeout(function () { try { CBZ.sfx("shell"); } catch (e) {} }, 380);
  }

  /* ---- the reload walks the OFF hand through the gun's anchors ------------
     Runs before the hold solve and owns the off hand while the envelope is
     up — for a two-hand gun AND a one-hand one (a handgun in third person
     keeps its off arm free, CBZ.holds; its reload still needs that hand: it
     comes from wherever the free arm is, and goes back there). */
  const _hm = new THREE.Vector3(), _ra = new THREE.Vector3(), _rb = new THREE.Vector3();
  function armWeight() { return smooth(clamp01(Math.min(R.p, 1 - R.p) / 0.05)); }
  function oneHanded(prop, spec) {
    if (!gripsOf(prop).support || !(spec && spec.sup)) return true;
    return !!(CBZ.holds && CBZ.holds.hands && CBZ.holds.hands(prop, { view: "tp" }) < 2);
  }
  function pathWorld(ch, prop, grips, rows, p, homeW, out, side) {
    const s = RL.seg(rows, p);
    const a = s.a === "support" || s.a === "grip" ? _ra.copy(homeW) : (anchorWorld(s.a, ch, prop, grips, _ra) || _ra.copy(homeW));
    const b = s.b === "support" || s.b === "grip" ? _rb.copy(homeW) : (anchorWorld(s.b, ch, prop, grips, _rb) || _rb.copy(homeW));
    out.lerpVectors(a, b, s.u);
    // bow the path away from the ribs (body +X is the player's LEFT; the
    // firing hand bows out to its own side, -X)
    if (s.arc > 0) {
      ch.body.getWorldQuaternion(_bodyQ);
      out.add(_tmp.set(side * s.arc, -s.arc * 0.35, 0).applyQuaternion(_bodyQ));
    }
    const fl = floorUnder(out);
    if (fl != null && out.y < fl) out.y = fl;
    return s;
  }
  function reloadOffHand(ch, prop, dt, spec) {
    if (!R.active || !(R.w > 0)) return false;
    const rec = RL.recipe(prop);
    if (!rec || !rec.l) return false;
    const grips = gripsOf(prop);
    seen.drive++; seen.why = "reload";
    drove = true;
    blend += (1 - blend) * Math.min(1, 9 * (dt || 0.016));
    ch.body.updateWorldMatrix(true, false);
    // (the path starts and ends on the hand's home, so it needs no envelope of
    // its own; the arms are eased in over the first and last few percent only)
    const aw = armWeight();
    /* THE GUN COMES IN TO THE CHEST. This rig's shoulders are 1.24 apart
       against 0.91 arms (rig units): with the gun out on the firing arm, as
       the aim or the one-hand carry holds it, the magazine well is a metre
       from the off shoulder and no reload anchor is in reach. So the firing
       hand brings the gun in for the work (rec.at, chest height a little to
       the firing side, body space) and holsterprops turns it across the body
       and cants it (rec.work, gunReloadPose), which is what a real reload
       does: the well comes to the hand, not the hand out to the well. */
    if (rec.at && ch.parts.ra && aw > 0) {
      const sc = torsoScale(ch);
      _t.set(rec.at[0] * sc, rec.at[1] * sc, rec.at[2] * sc);
      ch.body.localToWorld(_t);
      CBZ.charArmTo.rest(ch, "r", 0);
      CBZ.charArmTo(ch, _t, "r", aw);
      if (CBZ.tpHandWeaponRelock) CBZ.tpHandWeaponRelock();
    }
    prop.updateWorldMatrix(true, false);
    const one = oneHanded(prop, spec);
    // home: on the gun's own support grip, or where the free arm hangs now
    if (one || !anchorWorld("support", ch, prop, grips, _hm)) {
      ch.sockets.leftHand.updateWorldMatrix(true, false);
      ch.sockets.leftHand.getWorldPosition(_hm);
    }
    // the parts where p has them (a hand dwelling on the cover latch rides it down)
    RL.pose(prop, R.p, { drop: "hide" });
    const s = pathWorld(ch, prop, grips, rec.l, R.p, _hm, _t, 1);
    // The body squares up for the work even if the player never raised the
    // sights: animChar reads these, and fpsmode rewrites them each frame
    // from its own state the moment the reload is done.
    ch.aimingPose = true;
    ch.carryPose = false;
    // The reload owns the hand, and its waypoints are deliberately OFF the
    // weapon (the belt pouch most of all) — never walked back onto the gun.
    CBZ.charArmTo.rest(ch, "l", 0);
    seen.resid0 = seen.residual = CBZ.charArmTo(ch, _t, "l", one ? aw : Math.min(aw, blend));
    seen.slid = 0; seen.placed = 0;
    if (!one) GH.supportOrient(ch, prop, R.w);        // off its grip frame and back, no snap
    else if (ch.setHandPose) ch.setHandPose("l", s.dwell || (R.p >= rec.grab && R.p < rec.seat) ? "grip" : "relaxed");
    return true;
  }
  /* ---- the FIRING hand works the bolt, and the parts follow the hands ------
     After the hold solve (54.6). The firing hand leaves the grip for the bolt
     knob (between shots and through a bolt gun's reload) while the gun stays
     exactly where the fist had it — the support hand has it — and the fresh
     magazine / shell / speedloader / round is put in the hand carrying it. */
  const _gw = new THREE.Matrix4(), _gl = new THREE.Matrix4(), _gs = new THREE.Vector3();
  let partsProp = null;
  function reloadParts(dt) {
    const ch = CBZ.playerChar;
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    if (partsProp && partsProp !== prop && partsProp.userData._reloadRig) RL.pose(partsProp, -1);   // interrupted: parts home
    partsProp = prop;
    if (!prop || !ch || !ch.sockets || !ch.body || !ch.parts || prop.userData.weaponMelee || !prop.userData.grips) return;
    const rec = RL.recipe(prop);
    const fps = CBZ.fps;
    const reloading = !!(R.active && R.w > 0 && rec);
    // the rocket on the tube is the ammo: gone when fired, back when seated
    const wh = prop.userData.warhead;
    if (wh && fps && fps.rounds && CBZ.FPS_WEAPONS) {
      const row = CBZ.FPS_WEAPONS[fps.weapon];
      if (row && row.id === prop.userData.weaponId) wh.visible = (fps.rounds[fps.weapon] || 0) > 0 || (reloading && R.p >= rec.seat);
    }
    const cyc = !reloading && CBZ.fpsBoltCycle != null && CBZ.fpsBoltCycle >= 0 ? CBZ.fpsBoltCycle : -1;
    const cycle = cyc >= 0 ? RL.cycle(prop) : null;
    if (!reloading && !cycle) {
      if (prop.userData._reloadRig) RL.pose(prop, -1);
      return;
    }
    const p = reloading ? R.p : -1;
    // the empty leaves as a real body, from where it sits in the gun this frame
    if (reloading && !R.ejected && rec.eject != null && R.p >= rec.eject) {
      R.ejected = true;
      dropEmpty(prop);
    }
    // parts first: the bolt knob a hand is going to is where the bolt IS
    RL.pose(prop, p, { cycle: cyc, drop: "hide" });
    const rows = reloading ? rec.r : cycle.r;
    const handsBusy = ch.slidePose || ch.cuffed || ch.surrender || ch.handsUp || ch.verbHold ||
      (CBZ.player && CBZ.player.dead) || !CBZ.charArmTo;
    if (rows && !handsBusy && ch.parts.ra) {
      prop.updateWorldMatrix(true, false);
      _gw.copy(prop.matrixWorld);
      ch.sockets.rightHand.updateWorldMatrix(true, false);
      ch.sockets.rightHand.getWorldPosition(_hm);          // the fist on the grip: this hand's home
      const s = pathWorld(ch, prop, gripsOf(prop), rows, reloading ? R.p : cyc, _hm, _t, -1);
      CBZ.charArmTo.rest(ch, "r", 0);
      CBZ.charArmTo(ch, _t, "r", reloading ? armWeight() : 1);
      if (ch.setHandPose) ch.setHandPose("r", s.dwell ? "grip" : "relaxed");
      // the gun does not follow the hand off its grip: it stays where it was
      if (prop.parent) {
        prop.parent.updateWorldMatrix(true, false);
        _gl.copy(prop.parent.matrixWorld).invert().multiply(_gw);
        _gl.decompose(prop.position, prop.quaternion, _gs);
        prop.updateWorldMatrix(false, false);
      }
      seen.bolt = s.i;
    }
    if (!reloading) return;
    // the fresh one rides the hand that fetched it
    const sock = rec.carry === "r" ? ch.sockets.rightHand : ch.sockets.leftHand;
    sock.updateWorldMatrix(true, false);
    prop.updateWorldMatrix(true, false);
    const hand = prop.worldToLocal(sock.getWorldPosition(_hm));
    RL.pose(prop, p, { hand: hand, drop: "hide", cycle: cyc });
  }

  /* ---- the pass: put the off hand where the gun is ----------------------
     The FIRING hand is already on the grip when this runs: holsterprops'
     aimHandProp (54) ends in CBZ.gunHold.fire, which closes the body's right
     hand on the gun's own grip and seats the gun in it. This pass owns the
     OFF hand: CBZ.gunHold.support orients it on the handguard / foregrip /
     firing fist and solves the arm so its wrist is where that hand has to
     be, and everything below is about when that is and is not reachable. */
  let blend = 0, drove = false;
  const seen = { pass: 0, drive: 0, why: "never ran" };
  const LANDED = 0.03;                     // 3 cm — a fist's worth of slop
  const _sh = new THREE.Vector3(), _fwd = new THREE.Vector3();
  const _rt = new THREE.Vector3(), _ext = new THREE.Vector3(), _sp = new THREE.Vector3();
  function release(ch) {
    blend = 0;
    // hand the off hand back ONCE: a per-frame "relaxed" here fought every
    // other owner of that hand (the flashlight's torch grip, a verb) each frame
    if (drove && ch && ch.setHandPose) ch.setHandPose("l", "relaxed");
    drove = false;
  }
  function floorUnder(p) {
    return CBZ.floorAt ? CBZ.floorAt(p.x, p.z) + 0.05 : null;
  }
  function poseHands(dt) {
    seen.pass++;
    const ch = CBZ.playerChar;
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    // holsterprops' firing fist (54) may have moved the arm this frame too
    if (prop && ch === snap.ch) snap.live = true;
    const own = !!(prop && ch && ch.parts && ch.parts.la && ch.body && ch.sockets &&
      CBZ.CONFIG.CHAR_SUPPORT_HAND_IK !== false && CBZ.charArmTo && CBZ.charArmTo.wrist &&
      !ch.slidePose && !ch.cuffed && !ch.surrender && !ch.handsUp && !ch.verbHold &&
      !(CBZ.player && CBZ.player.dead) &&
      !(CBZ.weaponTransferState && CBZ.weaponTransferState().active));
    // A one-handed weapon (the taser) publishes no support grip and keeps its
    // off arm free — that is a fact about the weapon, not a missing anchor.
    const grips = own ? gripsOf(prop) : null;
    const spec = own ? GH.specOf(prop) : null;
    // A RELOAD OWNS THE OFF HAND, one-hand gun or two (CBZ.gunReload)
    if (own && reloadOffHand(ch, prop, dt, spec)) return;
    // HOW MANY HANDS the aim pose raises (character.js animChar reads it next
    // frame): the hold engine's answer for this gun in a body's hands
    if (ch && prop && CBZ.holds) ch.aimHands = CBZ.holds.hands(prop, { view: "tp", aimed: !!ch.aimingPose });
    // A ONE-HAND gun (CBZ.holds: a handgun in a body's hands) still brings the
    // off hand in to reload it: that is the magazine's hand, not the hold's
    const reloading1H = !!(spec && !spec.sup && grips && grips.support && R.active && R.w > 0);
    // ONE OWNER PER ARM: a hand on a door, a car handle, a lift button
    // (CBZ.verbs.touch / pickup) has the off hand this beat, and a long gun
    // is a one-hand carry until it lets go (CBZ.holds, offBusy)
    const offBusy = !!(own && CBZ.verbs && CBZ.verbs.handBusy && CBZ.player && CBZ.verbs.handBusy(CBZ.player, "l"));
    if (!grips || !grips.support || !spec || (!spec.sup && !reloading1H) || (offBusy && CBZ.holds.hands(prop, { view: "tp", offBusy: true }) < 2)) {
      // Hand the arm back. Nothing to unwind: every channel this pass writes
      // is one that animChar damps home on its own the next frame — the same
      // contract entities/poses.js and the reach layer rely on.
      release(ch);
      /* ONE HAND, PRESENTING: the gun arm out on the SAME cached solve every
         armed NPC uses (gunHold.pitchNpc: solved once per body + gun + pitch
         level in the chest's frame, the off arm left alone), then the barrel
         trimmed onto the crosshair. animChar's Euler aim pose under the
         fist's IK swung the elbow between two branches mid-stride (a 2.5 cm
         jump in the chest frame, gun-hold-check aim-walk). */
      if (spec && !spec.sup && ch.aimingPose && Math.abs(ch.body.rotation.x || 0) < 0.8 && !ch.pronePose) {
        GH.pitchNpc(ch, prop, chestPitch(ch), true);
        aimTrim(ch, prop);
        seen.why = "one hand, presenting";
        return;
      }
      seen.why = !prop ? "no drawn weapon"
        : !ch ? "no player rig"
        : ch.slidePose ? "slide pose owns the rig"
        : (ch.cuffed || ch.surrender || ch.handsUp || ch.verbHold) ? "hands are busy"
        : (CBZ.player && CBZ.player.dead) ? "dead"
        : (CBZ.weaponTransferState && CBZ.weaponTransferState().active) ? "stowing"
        : offBusy ? "off hand busy (a touch / pickup)"
        : grips ? "one-handed weapon" : "no rig parts";
      return;
    }
    seen.drive++; seen.why = "";
    drove = true;
    blend += (1 - blend) * Math.min(1, 9 * (dt || 0.016));

    R.style = grips.style || "mag";
    prop.updateWorldMatrix(true, false);
    ch.body.updateWorldMatrix(true, false);


    /* ---- THE ONE HOLD: THE SAME SOLVE EVERY ARMED NPC USES ----------------
       Standing, crouched or walking (the torso upright), the player's hold IS
       CBZ.gunHold's ready pose, the one solved once per body + gun against
       the body as worn (the shaped chest and any plate carrier on it: arms
       and gun kept out of both) and copied:
         · presenting: pitched onto the aim (gunHold.pitchNpc), then the
           barrel is locked exactly onto the crosshair and the fist re-seated
           (holsterprops), and the support hand re-landed on the gun;
         · LOW READY with a long gun: the stock stays in the shoulder pocket
           and BOTH hands stay on the gun, muzzle down and a touch across the
           body (gunHold.lowReady). A pistol keeps its one-hand carry.
       A pitched torso (prone) keeps the placement below. */
    const upright = Math.abs(ch.body.rotation.x || 0) < 0.8 && !ch.pronePose;
    if (upright && (ch.aimingPose || GH.isLong(prop))) {
      const aimed = !!ch.aimingPose;
      if (aimed) {
        GH.pitchNpc(ch, prop, chestPitch(ch), true);
      } else {
        GH.lowReady(ch, prop);
        seen.why = "low ready";
      }
      // where the solve put the gun (the support hand is on it there)
      prop.updateWorldMatrix(true, false);
      _m0.copy(prop.matrixWorld);
      /* OFF THE GROUND WITH THE HANDS. The cached hold knows nothing about
         the floor; entities/character.js gunGroundRest measures how far the
         drawn gun must come up to clear it and publishes the lift. Spend it
         on the firing wrist (the gun is seated in that fist): the support
         hand re-lands below because the gun has moved. */
      const lift = ch._gunRestY || 0;
      if (lift > 1e-4) {
        // straight up at the wrist, the forearm kept on its own line (not a
        // fresh fist solve: that re-seats the whole hold and, switched on and
        // off at a threshold, walked the gun 3 cm every few frames)
        CBZ.charArmTo.crease(ch, "r", _a);
        _a.y += lift;
        ch.parts.ra.userData.low.getWorldQuaternion(_eq);
        _t.set(0, 1, 0).applyQuaternion(_eq);
        CBZ.charArmTo.wrist(ch, _a, "r", _t, 1);
      }
      // presenting, exactly onto the crosshair: the last half-degree the
      // pitch table leaves, turned into the gun and the fist together
      if (aimed) aimTrim(ch, prop);
      /* The cached solve can leave a pitched-down stock's toe in the chest
         (or its plate carrier): carry the fist, and the gun in it, out by
         exactly what is inside. At low ready always; presenting too now —
         between two cached pitch levels the wrist finishes the aim
         (actorweapons.js seatBlended) and that turn can tip the stock 1-2 cm
         into the chest on a steep down-aim (gun-hold-check, aim-down). */
      gunOffBody(ch, prop, aimed, false);
      /* THE SUPPORT HAND STAYS WHERE THE SOLVE PUT IT unless the gun really
         moved (the trim is a fraction of a degree: the hand is still on the
         gun). Only a stand-off off the chest re-lands it: a fresh solve from
         here finds a worse local answer than the cached one. */
      prop.updateWorldMatrix(true, false);
      _tp.setFromMatrixPosition(prop.matrixWorld);
      _t.setFromMatrixPosition(_m0);
      if ((_tp.distanceTo(_t) > 0.012 || Math.abs(prop.userData._pumpDz || 0) > 0.002) && GH.specOf(prop) && GH.specOf(prop).sup) {
        GH.supportPoint(ch, prop, _sp);
        const floorY = floorUnder(_sp);
        const gap = GH.support(ch, prop, 1, 0, 3, floorY);
        if (gap != null && gap > LANDED) { GH.supportLand(ch, prop, 1, LANDED, 4, floorY); seen.slid = 1; }
      }
      seen.residual = GH.last.supGap; seen.placed = aimed ? 2 : 3;
      easeArms(ch, blend);
      return;
    }

    /* ---- ONE-HAND PORT CARRY (CHAR_PORT_ARMS_CARRY) ----------------------
       At the port-arms carry the handguard rides up the diagonal, and for the
       longer guns it is genuinely outside the off arm's ellipsoid. Both ways
       of forcing two hands onto it were measured and both are worse than not:
         · the shouldered placement re-aims the gun down its own (now diagonal)
           axis and yanks the wrist toward the neck — off hand 50 cm off the
           bore (gunhands-check);
         · the inboard tuck brings the gun to the centreline, where the torso
           eats it from the chase camera — 92% of the barrel visible fell to
           23% (tp-gun-view-check, carry).
       A rifle ported in one hand is a real carry and reads clean, so when the
       handguard is out of reach the off arm is RELEASED to animChar's own
       carry swing rather than left stretching at it. span() is the
       conservative reach; the margin is the protraction it excludes. */
    if (!ch.aimingPose && buttLen(prop) > 0.18 &&
        CBZ.CONFIG.CHAR_PORT_ARMS_CARRY !== false && CBZ.charArmTo.span) {
      shoulderWorld(ch, "l", _sh);
      GH.supportPoint(ch, prop, _sp);
      if (_sh.distanceTo(_sp) > CBZ.charArmTo.span(ch, "l") + 0.10) {
        release(ch);
        seen.why = "port carry: handguard out of reach — off hand at rest";
        return;
      }
    }
    CBZ.charArmTo.rest(ch, "l", 0);
    GH.supportPoint(ch, prop, _sp);
    let floorY = floorUnder(_sp);
    let gap = GH.support(ch, prop, blend, 0, 3, floorY);
    seen.resid0 = gap;
    seen.slid = 0; seen.placed = 0;
    /* AT LOW READY the gun is where the CARRY pose hangs it — a pistol
       beside the thigh, a long gun ported up the diagonal — and nothing here
       moves it: if the off hand can land on it (walked back along a
       handguard if need be) it does, and if it cannot it is a one-hand carry
       and the off arm goes back to the walk. (The old answer, tucking a
       hanging pistol inboard for the other hand, parked the gun and both
       forearms inside the belly — tools/gun-hold-check.mjs.) */
    if (!ch.aimingPose && gap != null && gap > LANDED) {
      if (blend > 0.9) { gap = GH.supportLand(ch, prop, blend, LANDED, 4, floorY); seen.slid = 1; }
      if (gap > LANDED) {
        snapRestoreArm("l");
        release(ch);
        seen.why = "carry: support grip out of reach — off hand at rest";
        seen.residual = gap;
        return;
      }
    }

    /* PUT THE STOCK IN THE SHOULDER. The present-weapon pose holds the firing
       arm nearly straight, which puts the grip ~0.55 m in front of the chest
       and the handguard another 0.46 m past that — beyond anything the off
       arm can touch. A shouldered rifle's geometry is not a matter of
       opinion: the butt sits in the shoulder pocket and the grip is one
       buttstock-length forward of it down the barrel, so
           wrist = pocket + barrelForward x (grip-to-butt length)
       measured off the weapon's own model. PLACED, not nudged — an earlier
       pass moved the hand by the shortfall each frame and animChar's damp
       simply ate it (42 cm requested bought 10 cm). At the port-arms CARRY
       "down the barrel's own axis" is the up-across diagonal (it would drive
       the wrist into the neck), so that case is the release above instead.
       (Only long guns get here: a handgun is one hand in third person,
       CBZ.holds, and publishes no support grip to the body.) */
    const stock = buttLen(prop);
    // Presenting, the gun is ALWAYS placed (a placement gated on "did the
    // hand miss" switches on and off as the miss hovers at the threshold,
    // and the gun jumps with it)
    if (ch.aimingPose && gap != null && CBZ.CONFIG.CHAR_SHOULDER_LONGGUN !== false && blend > 0.9) {
      shoulderWorld(ch, "l", _sh, true);
      prop.getWorldQuaternion(_bodyQ);
      _fwd.set(0, 0, -1).applyQuaternion(_bodyQ);          // the barrel's own axis
      shoulderWorld(ch, "r", _rt, true);                    // the firing shoulder
      prop.getWorldPosition(_ext);                          // where the gun is now
      {
        /* TOWARD THE CENTRELINE, not into the firing shoulder pocket: the
           shoulders sit ~0.87 m apart and the arm is 0.63 m, so a gun parked
           in one pocket is unreachable by the other hand by construction.
           The weapon comes to the chest (and the body blades, bladeTick),
           which is where a third-person rifle reads from anyway. */
        _rt.lerp(_sh, 0.38);
        _rt.y -= 0.05;
        // the pocket is the chest's FRONT surface, not the shoulder joint's
        // centre inside the torso (that put the firing wrist in the chest)
        ch.body.getWorldQuaternion(_bodyQ);
        _rt.add(_tmp.set(0, 0, ((ch.profile && ch.profile.torsoD) || 0.5) * 0.5 *
          ((ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.70)).applyQuaternion(_bodyQ));
        seen.butt = stock;
        _rt.addScaledVector(_fwd, stock);
      }
      // _rt is where the GUN goes: carry the fist with it rigidly and solve
      // the arm to that wrist, the forearm led in along the hand
      CBZ.charArmTo.crease(ch, "r", _a);
      _a.add(_rt).sub(_ext);
      const hr = ch.parts.ra.userData.cap;
      if (hr) { hr.getWorldQuaternion(_bodyQ); _b.set(0, 0, 1).applyQuaternion(_bodyQ); }
      CBZ.charArmTo.rest(ch, "r", 0);
      CBZ.charArmTo.wrist(ch, _a, "r", hr ? _b : null, blend);
      seen.placed = 1;
      // The gun rode the wrist back: re-aim it (parallax from its new
      // position) and re-seat it in the fist — both in holsterprops.
      if (CBZ.tpHandWeaponRelock) CBZ.tpHandWeaponRelock();
      // prone, a launcher laid on the shoulder can sink into the kit on the
      // back (a woman's plate carrier: 5 cm, gun-hold-check aim-prone)
      if (ch.pronePose) gunOffBody(ch, prop, true, true);
      prop.updateWorldMatrix(true, false);
      GH.supportPoint(ch, prop, _sp);
      floorY = floorUnder(_sp);
      gap = GH.support(ch, prop, blend, 0, 3, floorY);
    }
    /* Still short — a bipod-legged M249, or shoulders too far apart for the
       handguard to be crossable. Then the honest answer is that the hand holds
       the weapon FURTHER BACK rather than floating off the end of it: walk the
       grip along the gun toward the receiver until the hand lands (bisection
       on the MEASURED gap, so it needs no notion of reach at all). */
    if (blend > 0.9 && gap != null && gap > LANDED) {
      gap = GH.supportLand(ch, prop, blend, LANDED, 4, floorY);
      seen.slid = 1;
    }
    seen.residual = gap;
  }

  /* The hold is laid over the animated arms: while it is coming in (blend
     rising from 0 as the gun comes up) the arms travel there from where the
     animation had them this frame, instead of snapping. */
  const _eq = new THREE.Quaternion(), _m0 = new THREE.Matrix4();
  /* THE BARREL ON THE CROSSHAIR, WITHOUT RE-SOLVING THE ARM. The pitch table
     (gunHold.pitchNpc, 0.05 rad levels blended) and the camera's parallax
     leave the barrel a fraction of a degree off the aim; turn the gun about
     its grip, and the fist round it, by exactly that (holsterprops' relock
     re-solves the whole firing arm, which from an already-solved hold walks
     the wrist centimetres every frame). */
  const _tp = new THREE.Vector3(), _td = new THREE.Vector3(), _tb = new THREE.Vector3();
  const _tqa = new THREE.Quaternion(), _tqg = new THREE.Quaternion(), _tqp = new THREE.Quaternion();
  /* THE GUN IS NEVER INSIDE THE BODY. A cached solve can leave a pitched-down
     stock's toe in the chest (or its plate carrier), a prone launcher on the
     shoulder in the kit: carry the fist, and the gun in it, out by exactly
     what is inside — along the chest's facing, or UP for a launcher (it rests
     on the shoulder) and for anything prone (the chest faces the ground). */
  function gunOffBody(ch, prop, aimed, prone) {
    for (let i = 0; i < 6; i++) {
      const gp = GH.gunInBody(ch, prop);
      if (gp < 0.003) break;
      CBZ.charArmTo.crease(ch, "r", _a);
      ch.body.getWorldQuaternion(_bodyQ);
      const bs = ch.body.matrixWorld.getMaxScaleOnAxis() || 0.7;
      if (prone || prop.userData.shoulderZ != null) _b.set(0, (gp + 0.008) * bs, 0);
      else _b.set(0, 0, (gp + 0.008) * bs).applyQuaternion(_bodyQ);
      _a.add(_b);
      const hr = ch.parts.ra.userData.cap;
      if (hr) { hr.getWorldQuaternion(_eq); _t.set(0, 0, 1).applyQuaternion(_eq); }
      CBZ.charArmTo.wrist(ch, _a, "r", hr ? _t : null, 1);
      // onto the crosshair from the new place, then the gun seated in the
      // fist as it now points (a trim after the seat turned a launcher's
      // grip out of the hand: its origin is a tube-length from the grip)
      if (aimed) aimTrim(ch, prop);
      GH.fire(ch, prop, aimed, 0);
    }
  }
  function chestPitch(ch) {
    /* THE PITCH IS THE AIM IN THE CHEST'S OWN FRAME. The cached solves
       are body-relative (arms, gun and hands all hang off ch.body), so a
       torso that leans — the crouch hunches 0.16 rad forward, a walk or a
       run leans into its pace — tips the solved gun down by exactly that
       much. Reading the level off the WORLD aim left aimTrim to turn the
       gun back up by several degrees about its own origin, which carried
       the grip out of the fist (2.3 cm) and the handguard off the support
       hand (5 cm) in every crouch (tools/gun-hold-check.mjs, crouch/walk
       stances). Express the aim in the body frame and the table answers
       the lean itself; standing upright this is the old number exactly. */
    if (CBZ.playerAimDir) CBZ.playerAimDir(_fwd); else _fwd.set(0, 0, 1);
    ch.body.getWorldQuaternion(_bodyQ);
    _tmp.copy(_fwd).applyQuaternion(_bodyQ.invert());
    return -Math.asin(Math.max(-1, Math.min(1, _tmp.y / (_tmp.length() || 1))));
  }
  function aimTrim(ch, prop) {
    if (!CBZ.camera || !prop.parent) return;
    prop.updateWorldMatrix(true, false);
    prop.getWorldPosition(_tp);
    prop.getWorldQuaternion(_tqg);
    if (CBZ.playerAimDir) CBZ.playerAimDir(_td); else _td.set(0, 0, -1).applyQuaternion(CBZ.camera.quaternion);
    _td.multiplyScalar(120).add(CBZ.camera.position).sub(_tp).normalize();
    _tb.set(0, 0, -1).applyQuaternion(_tqg);
    _tqa.setFromUnitVectors(_tb, _td);
    _tqg.premultiply(_tqa);
    prop.parent.getWorldQuaternion(_tqp);
    prop.quaternion.copy(_tqp.invert()).multiply(_tqg);
    const hr = ch.parts.ra.userData.cap;
    if (hr) {
      hr.getWorldQuaternion(_tqg);
      _tqg.premultiply(_tqa);
      hr.parent.getWorldQuaternion(_tqp);
      hr.quaternion.copy(_tqp.invert()).multiply(_tqg);
    }
  }
  function easeArms(ch, k) {
    if (k >= 0.995 || snap.ch !== ch) return;
    for (const side of ["r", "l"]) {
      const part = side === "l" ? ch.parts.la : ch.parts.ra;
      _eq.copy(part.quaternion);
      part.quaternion.copy(side === "l" ? snap.laQ : snap.raQ).slerp(_eq, k);
      const p0 = side === "l" ? snap.laP : snap.raP;
      part.position.lerp(p0, 1 - k);
    }
  }

  /* GRIP-TO-BUTT, in world metres: the gun's own +Z extent (CBZ.gunHold.
     stockZ, measured off its model) through the prop's scale and the rig's
     metre conversion. A pistol measures near zero. */
  function buttLen(prop) {
    if (prop.userData._buttLen != null) return prop.userData._buttLen;
    const rig = (CBZ.playerChar && CBZ.playerChar.group && CBZ.playerChar.group.userData
      && CBZ.playerChar.group.userData.humanScale) || 0.70;
    const len = GH.stockZ(prop) * (prop.scale.x || 1) * rig;
    prop.userData._buttLen = len;
    return len;
  }
  function shoulderWorld(ch, arm, out, atRest) {
    const part = arm === "l" ? ch.parts.la : ch.parts.ra;
    out.copy(part.position);
    if (atRest) out.z = 0;                    // the joint itself, not the pose's protraction
    ch.body.updateWorldMatrix(true, false);
    return ch.body.localToWorld(out);
  }

  /* ---- THE BLADED STANCE -------------------------------------------------
     A shouldered long gun is held with the body TURNED: support shoulder
     forward, firing shoulder back, head turned onto the sights. This rig's
     shoulders sit ~0.87 m apart against a 0.49 m arm to the wrist, and its
     rifles are drawn 1.45x real (weapons/weapon-scale.js READ), so square to
     the target the handguard is 0.8 m from the off shoulder: out of reach for
     every long gun in the game (measured, tools/gun-hold-check.mjs). Blading
     the torso is the joint a real shooter spends on exactly this — it carries
     the off shoulder ~0.2 m toward the handguard — so it is spent here.
     body.rotation.y is written ABSOLUTE while it is up (the gait's shoulder
     counter-swing has no business in a shouldered aim); the neck counter-turns
     as a baked offset that is backed out before the next one is added, the
     same own-channel pattern systems/reactions.js uses for its head track.
     Runs before holsterprops (54) so the gun is aimed and seated off the
     turned body in the same frame. */
  const BLADE = GH.BLADE, BLADE_NECK = GH.BLADE_NECK;   // the NPC ready pose blades the same
  let bladeK = 0, bladeRig = null, proneK = 0;
  const PRONE_BLADE = 0.44;
  /* ---- THE HOLD IS AN OVERLAY ON THE ANIMATION, NOT AN INPUT TO IT --------
     animChar damps every arm channel FROM its current value. Every pass here
     (the blade, holsterprops' firing fist, the support hand, the reload) IK-
     solves the arms and writes full 3D shoulder rotations — swing AND twist —
     which read back as large, oddly-branched Euler angles. Left in place,
     next frame's damp starts from them and walks the Euler components toward
     its own targets on their own: the arm swung through the body and back
     (measured: the pistol low-ready's gun jumped 7-15 cm a frame). And any
     solve made relative to where the arm IS (the inboard pistol tuck, the
     ground-rest lift) compounded frame on frame.
     So the arms animChar produced are SNAPSHOTTED before the first of these
     passes and put back just before the player's animChar runs next frame
     (physics.js updatePlayer, onUpdate 10): animChar only ever sees its own
     pose, and the hold is laid over it fresh every frame. A frame with the
     game paused (updaters skipped, these passes still running) restores
     here instead, so a paused hold cannot compound either. Only restored
     after a frame these passes were live, so every other writer of the arms
     keeps its own dynamics. */
  const snap = { ch: null, live: false,
    raQ: new THREE.Quaternion(), laQ: new THREE.Quaternion(), raP: new THREE.Vector3(), laP: new THREE.Vector3(),
    raL: new THREE.Euler(), laL: new THREE.Euler(), by: 0 };
  let ranUpdate = false;
  const _pw = new THREE.Matrix4(), _pl = new THREE.Matrix4(), _ps = new THREE.Vector3();
  function snapRestore() {
    const ch = snap.ch;
    snap.live = false;
    if (!ch || ch !== CBZ.playerChar || !ch.parts || !ch.parts.la || !ch.parts.ra || !ch.body) return;
    // the drawn gun stays where it was SEEN while the arm under it goes back:
    // the ground-rest pass inside animChar measures the gun, and it must
    // measure the one on screen, not the one the un-held arm would carry
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    if (prop && prop.parent) { prop.updateWorldMatrix(true, false); _pw.copy(prop.matrixWorld); }
    ch.parts.ra.quaternion.copy(snap.raQ); ch.parts.ra.position.copy(snap.raP); ch.parts.ra.userData.low.rotation.copy(snap.raL);
    ch.parts.la.quaternion.copy(snap.laQ); ch.parts.la.position.copy(snap.laP); ch.parts.la.userData.low.rotation.copy(snap.laL);
    ch.body.rotation.y = snap.by;
    if (prop && prop.parent) {
      prop.parent.updateWorldMatrix(true, false);
      _pl.copy(prop.parent.matrixWorld).invert().multiply(_pw);
      _pl.decompose(prop.position, prop.quaternion, _ps);          // (its own scale is left exact)
    }
  }
  // put one arm back to this frame's animated pose (a hold that was tried
  // and given up must not leave the arm where the attempt left it)
  function snapRestoreArm(side) {
    const ch = snap.ch;
    if (!ch || ch !== CBZ.playerChar || !ch.parts) return;
    const part = side === "l" ? ch.parts.la : ch.parts.ra;
    if (!part || !part.userData.low) return;
    part.quaternion.copy(side === "l" ? snap.laQ : snap.raQ);
    part.position.copy(side === "l" ? snap.laP : snap.raP);
    part.userData.low.rotation.copy(side === "l" ? snap.laL : snap.raL);
  }
  function snapTake(ch) {
    snap.ch = ch;
    if (!ch || !ch.parts || !ch.parts.la || !ch.parts.ra || !ch.body || !ch.parts.ra.userData.low) return false;
    snap.raQ.copy(ch.parts.ra.quaternion); snap.raP.copy(ch.parts.ra.position); snap.raL.copy(ch.parts.ra.userData.low.rotation);
    snap.laQ.copy(ch.parts.la.quaternion); snap.laP.copy(ch.parts.la.position); snap.laL.copy(ch.parts.la.userData.low.rotation);
    snap.by = ch.body.rotation.y;
    return true;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(9.99, function () {
    if (snap.live) snapRestore();
    ranUpdate = true;
  });

  function bladeTick(dt) {
    const ch = CBZ.playerChar;
    // the base pose for this frame's hold (see the overlay note above)
    if (!ranUpdate && snap.live) snapRestore();
    ranUpdate = false;
    snap.live = !!(snapTake(ch) && CBZ.tpHandWeapon && CBZ.tpHandWeapon());
    if (bladeRig && bladeRig !== ch) {        // a rig swap: back the neck out of the old one
      if (bladeRig.neck && bladeRig._bladeNeck) bladeRig.neck.rotation.y -= bladeRig._bladeNeck;
      if (bladeRig) bladeRig._bladeNeck = 0;
      bladeK = 0;
    }
    bladeRig = ch || null;
    if (!ch || !ch.body) return;
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    // presenting only: a reload squares the body up to its own work position
    // (holsterprops RELOAD_WORK is body-relative), so the blade eases out
    const on = !!(prop && ch.parts && ch.aimingPose && !R.active && !ch.slidePose && !ch.cuffed &&
      !ch.surrender && !ch.handsUp && !ch.verbHold && !(CBZ.player && CBZ.player.dead) &&
      !(CBZ.fps && CBZ.fps.active) && Math.abs(ch.body.rotation.x) < 0.8 &&
      GH.isLong(prop) && GH.specOf(prop) && GH.specOf(prop).sup);   // the ready solve's own test: its blade and this one agree
    bladeK += ((on ? 1 : 0) - bladeK) * Math.min(1, 8 * (dt || 0.016));
    if (bladeK < 1e-3) bladeK = 0;
    const a = -BLADE * bladeK;                  // negative yaw: the left (+X) shoulder comes forward
    if (bladeK > 0) ch.body.rotation.y = a;
    /* PRONE HAS A BLADE TOO. A prone shooter does not lie square to the
       target: the body angles off the gun line (~20 deg) so the support
       elbow lands UNDER the handguard. Square, this rig's off shoulder is
       0.78 m from a carbine's handguard against a 0.63 m arm, and the
       support hand hung 7-14 cm off every two-hand gun (gun-hold-check,
       aim-prone). The chest is hinged face-down (PRONE_PITCH), so its own
       Z axis points at the deck: a turn about it is a turn about the world
       vertical, and +Z brings the left (+X) shoulder forward. Written over
       the prone pose's own crawl sway, which damps back from it. */
    const proneOn = !!(prop && ch.parts && ch.pronePose && !R.active && !(CBZ.player && CBZ.player.dead) &&
      !(CBZ.fps && CBZ.fps.active) && GH.isLong(prop) && GH.specOf(prop) && GH.specOf(prop).sup);
    proneK += ((proneOn ? 1 : 0) - proneK) * Math.min(1, 6 * (dt || 0.016));
    if (proneK < 1e-3) proneK = 0;
    if (proneK > 0) ch.body.rotation.z += (PRONE_BLADE * proneK - ch.body.rotation.z) * Math.min(1, proneK);
    if (ch.neck) {
      const want = -a * BLADE_NECK;
      ch.neck.rotation.y += want - (ch._bladeNeck || 0);
      ch._bladeNeck = want;
    }
  }

  // 53.9: after fpsmode's own tick (52) so fps.reloading is this frame's, and
  // BEFORE holsterprops (54) so the gun it draws is already canted for the
  // reload rather than a frame behind it.
  CBZ.onAlways(53.9, reloadTick);
  // 53.95: the blade, after the reload clock (a reload squares up too) and
  // before holsterprops aims and seats the gun off this body
  CBZ.onAlways(53.95, bladeTick);
  // 54.6: after holsterprops has finished placing and aiming the gun — the
  // support hand is solved to where the weapon ACTUALLY ended up this frame,
  // which is the whole point.
  CBZ.onAlways(54.6, function (dt) {
    poseHands(dt);
    // then the firing hand's bolt work and the reload's moving parts
    reloadParts(dt);
  });

  /* Test/measurement surface — tools/visual-presets/gun-hold-reload.mjs
     reports the residual in centimetres, so "the hand is on the gun" is a
     number instead of an opinion. */
  CBZ.gunHandAudit = function () {
    const ch = CBZ.playerChar;
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    if (!ch || !prop || !ch.sockets || !ch.sockets.leftHand) return null;
    const grips = gripsOf(prop);
    if (!grips.support) return { weapon: prop.userData.weaponId, oneHanded: true };
    prop.updateWorldMatrix(true, false);
    const want = anchorWorld("support", ch, prop, grips, _a);
    ch.sockets.leftHand.updateWorldMatrix(true, false);
    const got = ch.sockets.leftHand.getWorldPosition(_b);
    return {
      weapon: prop.userData.weaponId,
      style: grips.style,
      authored: grips.authored,
      gap: got.distanceTo(want),
      above: got.y - want.y,
      blend,
      passes: seen.pass,
      driven: seen.drive,
      why: seen.why,
      // the hold solve's own working: how far the first solve missed by,
      // whether the stock was re-placed, and what it missed by in the end
      resid0: seen.resid0, placed: seen.placed, butt: seen.butt,
      slid: seen.slid, residual: seen.residual,
      // the grip frames (CBZ.gunHold): support grip-centre gap and how far
      // it walked back, wrist bends (rad) on both hands
      holdGap: GH.last.supGap, holdSlide: seen.slid ? GH.last.slide : 0,
      supportBend: GH.last.supBend, fireBend: GH.last.fireBend,
      reloading: R.active,
      reloadP: R.p,
    };
  };
})();
