/* lab kit "football": the President's military aide carrying the nuclear
   football, standing, walking, turning, running, stopping, then opening it.

   OWNER (President mode): "The Secret Service guy carrying the briefcase
   looks dumb. He doesn't carry it correctly."

   One agent of the detail (the black suit, core/stage.js "agent") carries
   the case in his left hand:
     carry=new   (default) the game's: city/warroom.js's case model through
                 CBZ.handCarry (entities/character.js): hung plumb from the
                 fist by its handle, the arm straight and a little wide, a
                 damped pendulum on the grip; at `open` s he raises it flat
                 in front of him and the lid opens (the order's first beat)
     carry=old   the pre-fix carry, kept to measure the bug: the old 6-box
                 case parented straight onto the hand socket, nothing else

   script: stand 2 s, walk 7 m, turn 50 deg, run 18 m, stop, (new) open.
   probe, over the walk/turn/run:
     tilt    the case's long-edge tilt off plumb (deg): max, and its swing
             range at a walk and at a run
     clear   the narrowest gap (cm) between the case's inner face and the
             outside of his left thigh, in his own frame (< 0 = through it)
     scale   the case's drawn size (cm), against the real 46 x 34 x 13
   ok = tilt under 20 deg at a walk, no clipping into the leg, real size.

   params: carry new|old, open (s, default 17) */
CBZ.lab.kit("football", {
  about: "the military aide carries the nuclear football: does it hang from his hand like a real case through walk/turn/run, and open",
  uses: ["person"],
  files: ["src/city/warroom.js"],
  params: { carry: "new", open: 17 },
  duration: 20,
  setup: function (W, P) {
    W.add("person", { name: "aide", at: [0, 0], yaw: 0, role: "agent", brain: false });
    W.marks = { samples: [] };
  },
  frame: function (W) { return [W.get("aide").obj]; },
  script: function (W, P) {
    const THREE = window.THREE;
    const aide = W.get("aide"), a = aide.actor, ch = a.char;
    const old = P.carry === "old";
    let mesh = null;
    function oldCase() {
      // the pre-fix model and attach, verbatim (city/warroom.js before 2026-10-14)
      const grp = new THREE.Group();
      const m = function (hex) { return CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex }); };
      const box = function (w, h, d, x, y, z, mm) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mm); b.position.set(x, y, z); grp.add(b); return b; };
      const leather = m(0x17181b), brass = m(0xb08a3e);
      box(0.12, 0.34, 0.46, 0, -0.22, 0, leather);
      box(0.035, 0.04, 0.14, 0, -0.03, 0, leather);
      box(0.03, 0.035, 0.02, 0, -0.06, 0.06, leather);
      box(0.03, 0.035, 0.02, 0, -0.06, -0.06, leather);
      box(0.125, 0.03, 0.05, 0, -0.1, 0.15, brass);
      box(0.125, 0.03, 0.05, 0, -0.1, -0.15, brass);
      return grp;
    }
    // case corners in its own frame (the long box: old centred 0.22 below
    // the grip; new from the model's own dims)
    let corners = [];
    function caseCorners() {
      const ud = mesh.userData || {};
      const L = old ? 0.46 : ud.caseL, H = old ? 0.34 : ud.caseH, T = old ? 0.12 : ud.caseT;
      const yTop = old ? -0.05 : -ud.handleH, yBot = yTop - H;
      corners = [];
      for (const x of [-T / 2, T / 2]) for (const y of [yTop, yBot]) for (const z of [-L / 2, L / 2]) corners.push(new THREE.Vector3(x, y, z));
    }
    const _v = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion(), _inv = new THREE.Matrix4();
    // the outside of the left thigh, in the root's frame: the left leg's
    // meshes' bounding boxes, transformed
    function legOuterX() {
      const ll = ch.parts && ch.parts.ll;
      if (!ll) return null;
      let mx = -Infinity;
      ll.traverse(function (o) {
        if (!o.isMesh || !o.geometry || o.visible === false) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (let i = 0; i < 8; i++) {
          _v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
          o.localToWorld(_v); _v.applyMatrix4(_inv);
          if (_v.y > 0.35 && _v.y < 0.9) mx = Math.max(mx, _v.x);   // the thigh, where the case hangs
        }
      });
      return isFinite(mx) ? mx : null;
    }
    W.every(function () {
      if (!mesh || !mesh.parent) return;
      const t = W.t();
      const g = aide.obj;
      g.updateMatrixWorld(true);
      // root frame without its scale: metres, his own facing
      _inv.makeRotationY(g.rotation.y).setPosition(g.position).invert();
      // tilt: the case's local -y (plumb when hanging) against world down
      mesh.getWorldQuaternion(_q);
      _u.set(0, -1, 0).applyQuaternion(_q);
      const tilt = Math.acos(Math.max(-1, Math.min(1, -_u.y))) * 180 / Math.PI;
      // the case's inner face and the thigh, in his frame
      let inner = Infinity, lo = Infinity, hi = -Infinity;
      for (let i = 0; i < corners.length; i++) {
        _v.copy(corners[i]); mesh.localToWorld(_v); _v.applyMatrix4(_inv);
        inner = Math.min(inner, _v.x); lo = Math.min(lo, _v.y); hi = Math.max(hi, _v.y);
      }
      const leg = legOuterX();
      const spd = a.speedNow || 0;
      W.marks.samples.push({ t: t, tilt: tilt, clear: leg != null ? inner - leg : null, spd: spd, low: lo, high: hi });
    });
    return [
      [0.05, function () {
        if (old) {
          mesh = oldCase();
          ch.sockets.leftHand.add(mesh);
        } else {
          mesh = CBZ.warroom && CBZ.warroom.footballCase ? CBZ.warroom.footballCase() : null;
          if (mesh && CBZ.handCarry) CBZ.handCarry(ch, mesh, "l");
        }
        if (mesh) caseCorners();
        W.marks.mesh = mesh;
        W.event("aide", mesh ? "takes the case (" + (old ? "old: hand socket" : "CBZ.handCarry") + ")" : "NO CASE: warroom.footballCase missing");
      }, "the aide takes the football in his left hand"],
      [2.0, function () { aide.walkTo(0, 9, 1.4); }, "walk"],
      [8.4, function () { aide.walkTo(4, 12.5, 1.4); }, "turn right"],
      [11.4, function () { aide.walkTo(4.5, 30, 4.6); }, "run"],
      [15.2, function () { const p = aide.obj.position; aide.walkTo(p.x, p.z + 0.5, 1.0); }, "stop"],
      [+P.open || 17, function () {
        if (old || !CBZ.handCarry || !mesh) return;
        CBZ.handCarry.present(ch, true); CBZ.handCarry.open(ch, 1);
        W.event("aide", "raises the case and opens it");
      }, "open the case"],
    ];
  },
  probe: function (W, P) {
    const S = W.marks.samples;
    const R1 = function (v) { return Math.round(v * 10) / 10; };
    const win = function (t0, t1) { return S.filter(function (s) { return s.t >= t0 && s.t <= t1; }); };
    const stat = function (L, k) {
      let mn = Infinity, mx = -Infinity;
      L.forEach(function (s) { if (s[k] == null) return; mn = Math.min(mn, s[k]); mx = Math.max(mx, s[k]); });
      return isFinite(mn) ? { min: mn, max: mx } : { min: null, max: null };
    };
    const walk = win(4, 8.3), turn = win(8.4, 11.3), run = win(12.5, 15), still = win(0.5, 1.9);
    const tw = stat(walk, "tilt"), tr = stat(run, "tilt"), tt = stat(turn, "tilt"), ts = stat(still, "tilt");
    const moving = S.filter(function (s) { return s.t >= 2 && s.t <= 16; });
    const cl = stat(moving, "clear");
    const m = W.marks.mesh;
    // the drawn size: the authored dims (metres) times the world scale it is drawn at
    let size = null;
    if (m) {
      const ws = new window.THREE.Vector3(); m.getWorldScale(ws);
      const ud = m.userData || {}, old = P.carry === "old";
      const dims = old ? [0.46, 0.34, 0.12] : [ud.caseL, ud.caseH, ud.caseT];
      size = [Math.round(dims[0] * ws.z * 100), Math.round(dims[1] * ws.y * 100), Math.round(dims[2] * ws.x * 100)];
    }
    const st = CBZ.handCarry && W.get("aide").actor.char.handCarry ? CBZ.handCarry.state(W.get("aide").actor.char) : null;
    const ok = !!m && tw.max != null && tw.max < 20 && (cl.min == null || cl.min > -0.005) && size && size[0] >= 40;
    return {
      ok: ok,
      summary: (P.carry === "old" ? "OLD carry" : "NEW carry") +
        ": tilt off plumb standing " + R1(ts.max) + " deg, walk " + R1(tw.min) + ".." + R1(tw.max) + ", turn max " + R1(tt.max) + ", run " + R1(tr.min) + ".." + R1(tr.max) +
        " | thigh clearance min " + (cl.min == null ? "?" : R1(cl.min * 100) + " cm") +
        " | case " + (size ? size.join(" x ") + " cm (L x H x T)" : "none") +
        (st ? " | end: " + st.mode + " open " + st.open : ""),
      tilt: { still: ts, walk: tw, turn: tt, run: tr }, clearance: cl, size: size, end: st,
    };
  },
});
