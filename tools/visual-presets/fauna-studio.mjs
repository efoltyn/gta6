/* FAUNA STUDIO — the dog breeds and the birds, before/after, in one page.

   The NPC War catalogue (tools/catalogue.mjs --kind species) shoots every
   bestiary animal. What it cannot reach is here: the five dog breeds (the
   "dog" unit only ever draws one), and the birds, which are not units at all
   (gulls live in world/sea_scene.js, the songbird flocks in
   world/wildnature.js).

   Boots ?mode=sharksim (index.html: every script, and the sea scene's live
   gull flocks), freezes the frame loop, and renders each subject in its OWN
   studio scene: grey floor and backdrop, a 1 m bar for scale, sun + sky
   light at the game's own intensities. One subject = one composite frame:

     studio subjects   hero 3/4 (left) | side profile (top right) | head (bottom right)
     motion subjects   four moments of the gait or wingbeat, 2 x 2

   Where the bodies come from, per tree:
     dogs       CBZ.dogModel.build(breed, seed) + animate (both trees)
     birds      CBZ.birdKit.build(kind, seed) -> rig with rig.pose({mode, phase})
                when the tree has it; otherwise the tree's own geometry: the
                gull is the live "sea-scene-gulls" mesh (flap = its Y scale, as
                sea_scene.js drives it), the songbird is wildnature.js's body
                cone + wing triangle, rebuilt from the same numbers (that file
                only builds them inside Gang City).
     gulls in the world   the pier-head flock the scene itself flies.         */

const subjects = [
  { id: "dog-shepherd", kind: "dog", breed: "shepherd", label: "Dog: German shepherd (police K9)", focus: "The K9: tan under a black saddle, black mask, pricked ears." },
  { id: "dog-pit", kind: "dog", breed: "pit", label: "Dog: pit bull (gang yard dog)", focus: "Blocky head, wide chest, short coat, rose ears." },
  { id: "dog-mastiff", kind: "dog", breed: "mastiff", label: "Dog: mastiff (guard dog)", focus: "Heavy body, deep muzzle, fawn with a black mask." },
  { id: "dog-lab", kind: "dog", breed: "lab", label: "Dog: labrador (pet)", focus: "Otter tail, drop ears, broad head." },
  { id: "dog-mutt", kind: "dog", breed: "mutt", seed: 4, label: "Dog: mutt (stray)", focus: "A mixed stray, patched coat." },
  { id: "wild-gray_wolf", kind: "species", species: "gray_wolf", label: "Gray wolf, as the world's wildlife builds it", focus: "The wolf you meet in the forest (city/island wildlife), not NPC War's." },
  { id: "wild-arctic_wolf", kind: "species", species: "arctic_wolf", label: "Arctic wolf, as the world's wildlife builds it", focus: "" },
  { id: "wild-coyote", kind: "species", species: "coyote", label: "Coyote, as the world's wildlife builds it", focus: "" },
  { id: "wild-red_fox", kind: "species", species: "red_fox", label: "Red fox, as the world's wildlife builds it", focus: "" },
  { id: "dog-trot", kind: "dog-move", breed: "shepherd", speed: 2.6, label: "Dog: trotting, four moments", focus: "Diagonal pairs, feet planted while in stance, back level." },
  { id: "dog-gallop", kind: "dog-move", breed: "pit", speed: 7.5, label: "Dog: galloping, four moments", focus: "Spine flexes and extends, both phases of flight." },
  { id: "dog-rest", kind: "dog-rest", label: "Dogs at rest on the ground", focus: "Mastiff on its side, mastiff sitting, shepherd lying down, shepherd dead; a low lens at ground level shows what touches the ground and what goes into it." },
  { id: "gull-studio", kind: "bird", bird: "gull", label: "Bird: herring gull", focus: "White head and body, grey mantle, black wingtips, yellow bill, real wing shape." },
  { id: "gull-flap", kind: "bird-flap", bird: "gull", label: "Bird: gull wingbeat, four moments", focus: "Downstroke with the wing spread, upstroke with the wing folded at the wrist." },
  { id: "songbird-studio", kind: "bird", bird: "songbird", label: "Bird: the wilderness flock bird", focus: "What Gang City's flocks are made of, up close." },
  { id: "songbird-flap", kind: "bird-flap", bird: "songbird", label: "Bird: flock bird wingbeat, four moments", focus: "" },
  { id: "gulls-pier", kind: "world-gulls", label: "Gulls over the pier, in the game", focus: "The flock the sea scene flies over the pier head, from the pier." },
];

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__fauna;
  if (!D) {
    D = window.__fauna = {
      chapter: -1, m: {}, job: null,
      step(n) { for (let i = 0; i < n; i++) { if (CBZ.game.state !== "playing") CBZ.game.state = "playing"; CBZ.stepSim(1 / 30); } },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.mode !== "sharksim") return false;
        D._raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => D._raf.call(window, () => res()));
        D.step(60);
        return true;
      },
      // ---- the studio: its own scene, so nothing of the game is in frame ----
      studio() {
        if (D.st) return D.st;
        const s = new T.Scene();
        s.background = new T.Color(0xb9bec2);
        const hemi = new T.HemisphereLight(0xe4eefa, 0x8d8272, 0.95);
        const sun = new T.DirectionalLight(0xfff2de, 1.15);
        sun.position.set(6, 10, 7);
        const rim = new T.DirectionalLight(0xdfe8ff, 0.35);
        rim.position.set(-6, 5, -8);
        s.add(hemi, sun, rim);
        const floor = new T.Mesh(new T.CircleGeometry(60, 64), new T.MeshLambertMaterial({ color: 0xa9aeb2 }));
        floor.rotation.x = -Math.PI / 2;
        s.add(floor);
        // a 1 m bar with 10 cm ticks, for scale
        const bar = new T.Group();
        const bm = new T.MeshLambertMaterial({ color: 0x23272b });
        const b0 = new T.Mesh(new T.BoxGeometry(1, 0.012, 0.03), bm); b0.position.set(0.5, 0.006, 0); bar.add(b0);
        for (let i = 0; i <= 10; i++) {
          const tk = new T.Mesh(new T.BoxGeometry(0.008, 0.02, i % 5 === 0 ? 0.08 : 0.05), bm);
          tk.position.set(i * 0.1, 0.01, 0); bar.add(tk);
        }
        s.add(bar);
        D.st = { scene: s, floor, bar, cam: new T.PerspectiveCamera(30, 1, 0.02, 400), subject: null };
        return D.st;
      },
      clearSubject() {
        const st = D.studio();
        if (st.subject) { st.scene.remove(st.subject); st.subject = null; }
      },
      // minLen: a bird kit's wings are posed in the vertex shader, so the CPU box
      // holds only the body; the real wingspan frames the shot instead
      setSubject(obj, fwd, hoverY, minLen) {
        const st = D.studio();
        D.clearSubject();
        st.minLen = minLen || 0;
        const g = new T.Group();
        g.add(obj);
        st.scene.add(g);
        st.subject = g;
        st.fwd = fwd || new T.Vector3(1, 0, 0);
        st.hover = hoverY || 0;
        g.position.y = st.hover;
        g.updateMatrixWorld(true);
        D.fit();
      },
      fit() {
        const st = D.studio();
        const box = new T.Box3().setFromObject(st.subject, true);
        if (box.isEmpty()) box.set(new T.Vector3(-0.5, 0, -0.5), new T.Vector3(0.5, 1, 0.5));
        st.box = box;
        const size = box.getSize(new T.Vector3()), c = box.getCenter(new T.Vector3());
        st.size = size; st.center = c;
        // the scale bar sits beside the subject, on the floor
        st.bar.position.set(c.x - 0.5, 0.001, box.max.z + Math.max(0.15, size.z * 0.25));
        st.bar.visible = st.hover < 0.5;
        // the head end: the extreme of the box along the forward axis
        const f = st.fwd;
        const half = Math.abs(f.x) * size.x * 0.5 + Math.abs(f.y) * size.y * 0.5 + Math.abs(f.z) * size.z * 0.5;
        st.head = c.clone().addScaledVector(f, half * 0.72);
        st.head.y = Math.max(c.y, box.max.y - size.y * (st.hover > 0.5 ? 0.5 : 0.28));
        st.len = Math.max(size.x, size.z, size.y, st.minLen || 0);
      },
      // one view: aim at `target`, from direction `dir` (unit), framing `extent` metres
      view(dir, target, extent, x, y, w, h) {
        const st = D.studio(), R = CBZ.renderer, cam = st.cam;
        cam.aspect = w / h;
        const dist = (extent * 0.62) / Math.tan((cam.fov * Math.PI / 180) / 2) / Math.min(1, cam.aspect);
        cam.position.copy(target).addScaledVector(dir, dist);
        cam.near = Math.max(0.01, dist * 0.05); cam.far = dist * 20;
        cam.lookAt(target);
        cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
        R.setViewport(x, y, w, h); R.setScissor(x, y, w, h); R.setScissorTest(true);
        R.render(st.scene, cam);
      },
      dirs() {
        const st = D.studio(), f = st.fwd.clone().normalize();
        const side = new T.Vector3(0, 1, 0).cross(f).normalize();          // the animal's left
        return {
          hero: f.clone().multiplyScalar(0.72).addScaledVector(side, 0.62).add(new T.Vector3(0, 0.36, 0)).normalize(),
          side: side.clone().add(new T.Vector3(0, 0.08, 0)).normalize(),
          head: f.clone().multiplyScalar(0.8).addScaledVector(side, 0.5).add(new T.Vector3(0, 0.22, 0)).normalize(),
          front: f.clone().add(new T.Vector3(0, 0.12, 0)).normalize(),
          below: f.clone().multiplyScalar(0.25).addScaledVector(side, 0.55).add(new T.Vector3(0, -0.42, 0)).normalize(),
        };
      },
      // ---- the dog ---------------------------------------------------------
      dog(breed, seed) {
        const M = CBZ.dogModel;
        if (!M || !M.build) return null;
        const rig = M.build(breed, seed == null ? 1 : seed);
        const c = { x: 0, z: 0, y: 0, heading: 0, posture: "stand", alert: 0.8, ground: null };
        for (let i = 0; i < 90; i++) M.animate(rig, 1 / 30, c);
        rig._c = c;
        return rig;
      },
      // ---- the birds ---------------------------------------------------------
      gullMesh() {
        let im = null;
        CBZ.scene.traverse(function (o) { if (!im && o.isInstancedMesh && /gull/i.test(o.name || (o.material && o.material.name) || "")) im = o; });
        return im;
      },
      bird(kind) {
        // the tree's own bird kit, if it has one
        const K = CBZ.birdKit;
        if (K && typeof K.build === "function") {
          const rig = K.build(kind, 7);
          if (rig && (rig.group || rig.isObject3D)) {
            const obj = rig.group || rig;
            const SP = K.SPECIES || {}, spec = SP[rig.kind] || SP[kind] || (kind === "songbird" ? SP.crow : null);
            return { obj, span: spec && spec.span ? spec.span : 0, fwd: rig.forward ? new T.Vector3().copy(rig.forward) : new T.Vector3(1, 0, 0),
              pose(mode, ph) { if (typeof rig.pose === "function") rig.pose({ mode, phase: ph }); obj.updateMatrixWorld(true); } };
          }
        }
        if (kind === "gull") {
          const im = D.gullMesh();
          if (!im) return null;
          const m = new T.Mesh(im.geometry, im.material);
          const sc = 1.5;
          return { obj: m, fwd: new T.Vector3(1, 0, 0),
            pose(mode, ph) {
              // sea_scene.js: the flap IS the instance's Y scale (cos of the beat); a glide holds ~0.85
              const flap = mode === "glide" ? 0.85 : Math.cos(ph * Math.PI * 2);
              m.scale.set(sc, sc * flap, sc); m.updateMatrixWorld(true);
            } };
        }
        // wildnature.js's flock bird: the same geometry, matrices and colour
        const g = new T.Group();
        const col = new T.Color(0.14, 0.12, 0.12);
        const bodyGeo = new T.ConeGeometry(0.09, 1, 4); bodyGeo.rotateX(Math.PI / 2);
        const wingGeo = new T.BufferGeometry();
        wingGeo.setAttribute("position", new T.Float32BufferAttribute([0, 0, 0, 1, 0, -0.12, 0.55, 0, 0.05], 3));
        wingGeo.computeVertexNormals();
        const mat = new T.MeshLambertMaterial({ color: col });
        const body = new T.Mesh(bodyGeo, mat); body.scale.set(1, 1, 1.6);
        const wl = new T.Mesh(wingGeo, mat), wr = new T.Mesh(wingGeo, mat);
        wl.scale.set(1.4, 1, 1.4); wr.scale.set(1.4, 1, 1.4);
        g.add(body, wl, wr);
        return { obj: g, fwd: new T.Vector3(0, 0, 1),
          pose(mode, ph) {
            const flap = mode === "glide" ? 0 : Math.sin(ph * Math.PI * 2) * 0.9;
            wl.rotation.set(0, 0, flap); wr.rotation.set(0, 0, Math.PI - flap); g.updateMatrixWorld(true);
          } };
      },
      // ---- the frame layouts ---------------------------------------------------
      layoutStudio() {
        const st = D.studio(), W = CBZ.renderer.domElement.width, H = CBZ.renderer.domElement.height;
        const d = D.dirs(), L = st.len;
        const lw = Math.round(W * 0.595), rw = W - lw - 2, hh = Math.floor((H - 2) / 2);
        const R = CBZ.renderer;
        R.setScissorTest(true);
        R.setScissor(0, 0, W, H); R.setViewport(0, 0, W, H);
        R.setClearColor(0x1c2024, 1); R.clear();
        D.view(d.hero, st.center, L * 1.05, 0, 0, lw, H);
        D.view(d.side, st.center, L * 1.0, lw + 2, hh + 2, rw, hh);
        D.view(d.head, st.head, Math.max(st.size.y * 0.72, L * 0.34), lw + 2, 0, rw, hh);
      },
      layoutFour(drawEach) {
        const W = CBZ.renderer.domElement.width, H = CBZ.renderer.domElement.height;
        const w = Math.floor((W - 2) / 2), h = Math.floor((H - 2) / 2);
        const R = CBZ.renderer;
        R.setScissorTest(true);
        R.setScissor(0, 0, W, H); R.setViewport(0, 0, W, H);
        R.setClearColor(0x1c2024, 1); R.clear();
        const cells = [[0, h + 2], [w + 2, h + 2], [0, 0], [w + 2, 0]];
        for (let i = 0; i < 4; i++) drawEach(i, cells[i][0], cells[i][1], w, h);
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        const canvas = CBZ.renderer && CBZ.renderer.domElement;
        for (const child of Array.from(document.body.children)) {
          if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
          child.style.visibility = "hidden";
        }
        await new Promise((res) => D._raf.call(window, () => {
          const R = CBZ.renderer;
          const ac = R.autoClear;
          R.autoClear = false;
          try { if (D.job) D.job(); else R.render(CBZ.scene, CBZ.camera); }
          finally {
            R.autoClear = ac;
            R.setScissorTest(false);
            const W = R.domElement.width, H = R.domElement.height;
            R.setViewport(0, 0, W, H); R.setScissor(0, 0, W, H);
          }
          res();
        }));
        await new Promise((r) => setTimeout(r, 400));
      },
    };
  }

  if (D.chapter < 0) { if (!await D.boot()) throw new Error("shark sim never started"); D.chapter = 0; }
  const k = sub.kind;
  D.m = {};
  if (k === "dog") {
    const rig = D.dog(sub.breed, sub.seed);
    if (!rig) throw new Error("no CBZ.dogModel");
    D.setSubject(rig.group, new T.Vector3(1, 0, 0), 0);
    D.m = { length: +D.studio().size.x.toFixed(2), height: +D.studio().size.y.toFixed(2) };
    D.job = function () { D.layoutStudio(); };
  } else if (k === "species") {
    // exactly what city/wildlife.js does to give an actor its body
    const sp = (CBZ.WILDLIFE_SPECIES || {})[sub.species];
    if (!sp || typeof sp.build !== "function") throw new Error("no species " + sub.species);
    let s = 0x5B0D7;
    const rng = function () { s = (s + 0x6D2B79F5) | 0; let r = Math.imul(s ^ (s >>> 15), 1 | s); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
    const mat = CBZ.cmat || CBZ.mat || function (c) { return new T.MeshLambertMaterial({ color: c }); };
    const body = sp.build({ THREE: T, mat: mat, rng: rng });
    if (!body) throw new Error("species " + sub.species + " built nothing");
    if (sp.scale) body.scale.multiplyScalar(sp.scale);
    D.setSubject(body, new T.Vector3(1, 0, 0), 0);
    D.m = { length: +D.studio().size.x.toFixed(2), height: +D.studio().size.y.toFixed(2) };
    D.job = function () { D.layoutStudio(); };
  } else if (k === "dog-move") {
    const rig = D.dog(sub.breed, 3);
    if (!rig) throw new Error("no CBZ.dogModel");
    const M = CBZ.dogModel, c = rig._c;
    c.alert = 1;
    // get up to speed along +X for two seconds before the first moment
    for (let i = 0; i < 60; i++) { c.x += sub.speed / 30; M.animate(rig, 1 / 30, c); }
    D.setSubject(rig.group, new T.Vector3(1, 0, 0), 0);
    D.m = { speed: sub.speed };
    D.job = function () {
      D.layoutFour(function (i, x, y, w, h) {
        if (i > 0) for (let s = 0; s < 3; s++) { c.x += sub.speed / 60; M.animate(rig, 1 / 60, c); }
        rig.group.updateMatrixWorld(true);
        D.fit();
        const st = D.studio(), d = D.dirs();
        D.view(d.side, st.center, st.len * 1.05, x, y, w, h);
      });
    };
  } else if (k === "dog-rest") {
    // four rests, each built, posed and settled for 4 s on flat ground at y = 0;
    // the lowest posed vertex of each is measured (negative = into the ground)
    const M = CBZ.dogModel;
    if (!M || !M.build) throw new Error("no CBZ.dogModel");
    const cases = [["mastiff", "side"], ["mastiff", "sit"], ["shepherd", "lie"], ["shepherd", "dead"]];
    const rigs = cases.map(function (cs, i) {
      const rig = M.build(cs[0], 2 + i);
      // the studio floor IS the ground (left null, the kit asks the world, and at
      // the shark sim's origin the world is seabed 1.5 m down)
      // ...and there is no water on the stage (the kit swims a dog that stands in
      // the world's sea; water far under the floor = dry ground)
      const c = { x: 0, z: 0, y: 0, heading: 0, posture: cs[1], alert: 0.2, ground: function () { return 0; }, water: -1000, dead: cs[1] === "dead" };
      for (let t = 0; t < 120; t++) M.animate(rig, 1 / 30, c);
      rig.group.updateMatrixWorld(true);
      return rig;
    });
    const v = new T.Vector3();
    const lowest = function (g) {
      let lo = 1e9;
      g.traverseVisible(function (m) {
        if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
        const pos = m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          if (m.isSkinnedMesh && m.applyBoneTransform) m.applyBoneTransform(i, v);
          v.applyMatrix4(m.matrixWorld);
          if (v.y < lo) lo = v.y;
        }
      });
      return lo;
    };
    const lows = rigs.map(function (r) { return Math.round(lowest(r.group) * 1000); });
    D.m = { lowestMm: lows.join(" ") };
    D.job = function () {
      D.layoutFour(function (i, x, y, w, h) {
        D.setSubject(rigs[i].group, new T.Vector3(1, 0, 0), 0);
        const st = D.studio(), d = D.dirs();
        // a lens almost at ground level, from the side, so the contact reads
        const dir = d.side.clone(); dir.y = 0.06; dir.normalize();
        D.view(dir, st.center.clone().setY(Math.max(0.12, st.center.y * 0.6)), st.len * 0.95, x, y, w, h);
      });
    };
  } else if (k === "bird") {
    const B = D.bird(sub.bird);
    if (!B) throw new Error("no " + sub.bird + " in this tree");
    B.pose("glide", 0.15);
    D.setSubject(B.obj, B.fwd, 0.6, B.span);
    D.m = { span: +(B.span || Math.max(D.studio().size.x, D.studio().size.z)).toFixed(2) };
    D.job = function () { D.layoutStudio(); };
  } else if (k === "bird-flap") {
    const B = D.bird(sub.bird);
    if (!B) throw new Error("no " + sub.bird + " in this tree");
    B.pose("flap", 0);
    D.setSubject(B.obj, B.fwd, 0.6, B.span);
    D.job = function () {
      D.layoutFour(function (i, x, y, w, h) {
        B.pose("flap", i / 4);
        D.fit();
        const st = D.studio(), d = D.dirs();
        D.view(d.front.clone().multiplyScalar(0.55).add(d.side.clone().multiplyScalar(0.45)).normalize(), st.center, st.len * 1.0, x, y, w, h);
      });
    };
  } else if (k === "world-gulls") {
    D.clearSubject();
    const S = CBZ.sharkSeaScene;
    const ph = S && S.pier && S.pier.head ? S.pier.head : null;
    if (!ph) throw new Error("no sea scene pier");
    D.step(30);
    const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(ph.x, ph.z) : 0;
    // WHERE THE FLOCK ACTUALLY IS: the gull instances' own positions (birds
    // that follow boats and land on posts are not where a fixed lens points)
    const gulls = [];
    CBZ.scene.traverse(function (o) {
      if (!o.isInstancedMesh || !/gull/i.test(o.name || (o.material && o.material.name) || "")) return;
      o.updateMatrixWorld(true);
      const m = new T.Matrix4();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.premultiply(o.matrixWorld);
        const p = new T.Vector3().setFromMatrixPosition(m);
        if (p.lengthSq() > 1 && m.elements[0] * m.elements[0] + m.elements[1] * m.elements[1] + m.elements[2] * m.elements[2] > 1e-6) gulls.push(p);
      }
    });
    // the nearest gull IN THE AIR over the pier (2.5 m above the sea or more),
    // else the nearest one at all (perched, floating)
    let tgt = null, best = 1e9;
    for (const p of gulls) { const d = Math.hypot(p.x - ph.x, p.z - ph.z); if (p.y > sy + 2.5 && d < 80 && d < best) { best = d; tgt = p; } }
    if (!tgt) for (const p of gulls) { const d = Math.hypot(p.x - ph.x, p.z - ph.z); if (d < best) { best = d; tgt = p; } }
    D.m = { gulls: gulls.length, nearest: tgt ? +best.toFixed(1) : -1, aloft: tgt ? +(tgt.y - sy).toFixed(1) : -1 };
    D.job = function () {
      const cam = CBZ.camera;
      cam.fov = 50; cam.aspect = CBZ.renderer.domElement.width / CBZ.renderer.domElement.height;
      if (tgt) {
        // the lens 5 m off that gull, a little below it, looking up at it against
        // the sky with the rest of the flock behind
        let dx = tgt.x - ph.x, dz = tgt.z - ph.z; const l = Math.hypot(dx, dz);
        if (l < 0.5) { dx = 1; dz = 1; } const k = 1 / (Math.hypot(dx, dz) || 1);
        cam.position.set(tgt.x - dz * k * 5, Math.max(sy + 1.2, tgt.y - 1.4), tgt.z + dx * k * 5);
        cam.lookAt(tgt.x, tgt.y + 0.3, tgt.z);
      } else {
        cam.position.set(ph.x + 4, sy + 4.5, ph.z + 4);
        cam.lookAt(ph.x - 3, sy + 9.5, ph.z - 3);
      }
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      if (CBZ.skySync) CBZ.skySync();
      CBZ.renderer.render(CBZ.scene, cam);
    };
  }
  return { ok: true, state: JSON.stringify(D.m), metrics: D.m };
}

export default {
  id: "fauna-studio",
  title: "Dogs and birds, in the studio",
  description: "The five dog breeds (still and in motion) and the birds (gull, flock bird; still and wingbeat), each in a neutral studio with a 1 m bar, plus the gulls over the pier in the game.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  pairNote: "Same studio, same light, same camera rules on both sides",
  method: "Boots ?mode=sharksim, freezes the frame loop and renders each subject in its own studio scene. Dogs from CBZ.dogModel; birds from CBZ.birdKit when the tree has one, else from the tree's own gull mesh and flock-bird geometry.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  metrics: {
    length: { label: "Dog length, m" },
    height: { label: "Dog height, m" },
    span: { label: "Bird span, m" },
    gulls: { label: "Gulls in the scene" },
  },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage,
};
