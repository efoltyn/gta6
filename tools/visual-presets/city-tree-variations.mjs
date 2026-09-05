// Gang City trees: the shared vegetation factories in a lit gallery, then
// the planted world at eye level — backcountry, Redhollow. (The 'street' kind
// stays for a build that plants pavement planters; seed 90210 has none.)
// HARNESS TRAP: gallery objects are inspection copies, not new world placements.
async function stage(input) {
  const C = window.CBZ, T = window.THREE;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async fn => {
    const end = Date.now() + 300000;
    while (Date.now() < end) { if (fn()) return true; await wait(250); }
    return false;
  };
  if (!window.__treeGallery) {
    if (!await until(() => C.stepSim && C.game && document.querySelector('[data-mode="city"]'))) return { ok: false, error: 'boot' };
    C.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    document.querySelector('[data-mode="city"]').click();
    if (!await until(() => { if (C.game.state === 'playing') return true; document.getElementById('playBtn')?.click(); return false; })) return { ok: false, error: 'play' };
    window.requestAnimationFrame = () => 0;
    await wait(600);
    C.setQualityLevel?.(3);
    C.dayPhase?.(0.25);
    for (let i = 0; i < 60; i++) C.stepSim(1 / 60);
    const scene = new T.Scene();
    scene.background = new T.Color(0xc9d9df);
    scene.add(new T.HemisphereLight(0xe9f5ff, 0x666344, 0.85));
    const sun = new T.DirectionalLight(0xffecd0, 1.1);
    sun.position.set(-30, 45, 28); scene.add(sun);
    const floor = new T.Mesh(new T.PlaneGeometry(300, 300), new T.MeshLambertMaterial({ color: 0x899375 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.08; scene.add(floor);
    const group = new T.Group(); scene.add(group);
    const camera = new T.PerspectiveCamera(42, input.width / input.height, 0.1, 500);
    window.__treeGallery = { scene, group, camera, spawn: C.player.pos.clone() };
    window.__cbzVisualCompare = { render: () => C.renderer.render(window.__treeGallery.activeScene, window.__treeGallery.activeCamera) };
  }
  const S = window.__treeGallery;
  S.group.clear();
  const kind = input.subject.kind;
  let triangles = 0;
  const gy = (x, z) => (C.floorAt && C.floorAt(x, z)) || 0;
  const worldShot = (px, py, pz, lx, ly, lz, fov) => {
    C.player.pos.set(px, py, pz);
    for (let i = 0; i < 24; i++) C.stepSim(1 / 60);
    C.playerChar.group.visible = false;
    C.camera.position.set(px, py, pz);
    C.camera.lookAt(lx, ly, lz);
    C.camera.fov = fov || 55; C.camera.aspect = input.width / input.height;
    C.camera.updateProjectionMatrix();
    for (const child of C.camera.children) child.visible = false;
    C.skySync?.();
    S.activeScene = C.scene; S.activeCamera = C.camera;
  };
  // the nearest instance of a named InstancedMesh to (x, z) → world position
  const nearestInstance = (namePrefix, x, z) => {
    const m = new T.Matrix4(), p = new T.Vector3();
    let best = null, bd = 1e9;
    C.scene.traverse(o => {
      if (!o.isInstancedMesh || !o.name.startsWith(namePrefix)) return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); p.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d > 6 && d < bd) { bd = d; best = p.clone(); }
      }
    });
    return best;
  };
  if (kind === 'world') {
    const x = -2760, z = -2280, g = gy(x, z);
    worldShot(x, g + 2.5, z, x - 65, g + 12, z + 77, 55);
  } else if (kind === 'canopy') {
    const x = -2760, z = -2280, g = gy(x, z);
    const t = nearestInstance('backcountry-tree-trunks', x, z) || new T.Vector3(x - 20, g, z + 20);
    const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz) || 1;
    const cx = t.x - dx / d * 14, cz = t.z - dz / d * 14, cg = gy(cx, cz);
    worldShot(cx, cg + 1.7, cz, t.x, t.y + 11, t.z, 60);
  } else if (kind === 'street') {
    const A = C.city && (C.city.arena || C.city);
    const props = (A && A.streetProps) || [];
    let trees = props.filter(p => p.type === 'tree');
    if (!trees.length) {
      // HARNESS TRAP: the registry can be empty; the planter box itself
      // (1.0 x 0.42 x 1.0) is unique on the street, and a planter with four
      // or more children carries a tree.
      const w = new T.Vector3();
      C.scene.traverse(o => {
        const pr = o.isMesh && o.geometry && o.geometry.parameters;
        if (!pr || pr.width !== 1 || pr.height !== 0.42 || pr.depth !== 1) return;
        const g = o.parent;
        if (!g || g.children.length < 4) return;
        g.getWorldPosition(w);
        trees.push({ x: w.x, z: w.z });
      });
    }
    if (!trees.length) return { ok: false, error: 'no street trees (registry ' + props.length + ' props, types ' + [...new Set(props.map(p => p.type))].join('/') + ')' };
    const sp = S.spawn;
    trees.sort((a, b) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(b.x - sp.x, b.z - sp.z));
    const t = trees[0], g = gy(t.x, t.z);
    const lots = (A && A.lots) || [];
    const clear = (x, z) => !lots.some(l => Math.abs(x - l.cx) < l.w / 2 + 1 && Math.abs(z - l.cz) < l.d / 2 + 1);
    let cx = t.x + 4.6, cz = t.z + 2.4;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, px = t.x + Math.cos(a) * 5.2, pz = t.z + Math.sin(a) * 5.2;
      if (clear(px, pz)) { cx = px; cz = pz; break; }
    }
    worldShot(cx, g + 1.55, cz, t.x, g + 2.1, t.z, 50);
  } else if (kind === 'forest') {
    const f = (C.worldFoot && C.worldFoot('forest')) || { cx: -560, cz: -1350, hx: 390, hz: 330 };
    const x = f.cx + f.hx * 0.35, z = f.cz + f.hz * 0.45, g = gy(x, z);
    const t = nearestInstance('redhollow-mature-wood', x, z) || new T.Vector3(x - 25, g, z - 25);
    const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz) || 1;
    const cx = t.x - dx / d * 22, cz = t.z - dz / d * 22, cg = gy(cx, cz);
    worldShot(cx, cg + 1.7, cz, t.x, t.y + 14, t.z, 60);
  } else {
    const mat = (kindName, color) => {
      const m = C.vegetationKit.material(kindName).clone();
      m.color.set(color);
      return m;
    };
    const add = (geo, kindName, color, x, y, z) => {
      const mesh = new T.Mesh(geo, mat(kindName, color));
      mesh.position.set(x, y, z); S.group.add(mesh);
      triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      return mesh;
    };
    if (kind === 'rocks') {
      for (let i = 0; i < 3; i++) {
        const g = C.makeRock(2.1, 123 + i * 97, 1);
        g.computeBoundingBox();
        const mesh = new T.Mesh(g, new T.MeshLambertMaterial({ color: [0x777a73, 0x8a8376, 0x747d79][i], flatShading: true }));
        mesh.position.set((i - 1) * 5, -g.boundingBox.min.y - 0.35, 0); S.group.add(mesh);
        triangles += g.attributes.position.count / 3;
      }
      S.camera.position.set(12, 8, 19); S.camera.lookAt(0, 1.2, 0);
    } else if (kind === 'spire') {
      const v = input.subject.variant || 0;
      add(C.vegetationKit.geometry('landscape-wood'), 'landscape-wood', 0x6f5a44, 0, 0, 0).scale.set(0.74, 0.4, 0.74);
      add(C.vegetationKit.geometry('conifer-spire', v), 'conifer-spire', 0x3a6b3a, 0, 2.6, 0);
      S.camera.position.set(24, 15, 34); S.camera.lookAt(0, 12.5, 0);
    } else {
      const mature = kind === 'mature';
      const wood = mature ? 'mature-wood' : 'landscape-wood';
      const crown = mature ? 'mature-crown' : 'landscape-crown';
      const v = input.subject.variant || 0;
      // Match continent.plantStem's metre-authored broadleaf assembly:
      // shortened bole, canopy starting 6.4 m up, broader horizontal crown.
      const timber = add(C.vegetationKit.geometry(wood), wood, 0x756049, 0, 0, 0);
      const leaves = add(C.vegetationKit.geometry(crown, v), crown, [0x6f9a45, 0x568a4a, 0x84a44c][v], 0, mature ? 13 : 6.4, 0);
      if (!mature) { timber.scale.y = 0.72; leaves.scale.set(1.28, 0.95, 1.28); }
      S.camera.position.set(30, mature ? 21 : 16, 42); S.camera.lookAt(0, mature ? 13.8 : 9.4, 0);
    }
    S.camera.updateProjectionMatrix();
    S.activeScene = S.scene; S.activeCamera = S.camera;
  }
  const pose = input.referenceStage?.pose;
  if (pose) {
    S.activeCamera.position.fromArray(pose.position);
    S.activeCamera.quaternion.fromArray(pose.quaternion);
  }
  for (const child of document.body.children) {
    if (child === C.renderer.domElement || child.contains(C.renderer.domElement)) continue;
    child.style.visibility = 'hidden';
  }
  // Water renders nested reflection passes. Auto-reset would leave only the
  // last pass's counters, hiding the geometry cost of the main forest view.
  const autoReset = C.renderer.info.autoReset;
  C.renderer.info.autoReset = false;
  C.renderer.info.reset();
  C.renderer.render(S.activeScene, S.activeCamera);
  const drawCalls = C.renderer.info.render.calls;
  const renderedTriangles = C.renderer.info.render.triangles;
  C.renderer.info.autoReset = autoReset;
  const audit = C.treeAudit?.() || {};
  return { ok: true, pose: { position: S.activeCamera.position.toArray(), quaternion: S.activeCamera.quaternion.toArray() },
    metrics: { assetTriangles: triangles, drawCalls, renderedTriangles, auditedTrees: audit.trees || 0, floatingCanopies: audit.floatingCanopies || 0,
      unseatedTrunks: audit.unseatedTrunks || 0, brokenChains: audit.brokenChains || 0 },
    treeAudit: audit, variants: C.vegetationVariantAudit?.() };
}

export default {
  id: 'city-tree-variations', title: 'Gang City — real trees',
  description: 'The shared tree factories (broadleaf, mature woodland, spruce) in a lit gallery, then the planted world at eye level: backcountry, under a canopy, Redhollow Woods.',
  defaultBefore: 'https://efoltyn.github.io/gta6/',
  beforeLabel: 'BEFORE', afterLabel: 'AFTER',
  viewport: { width: 1180, height: 800 }, urlParams: { seed: 90210, cfg_BOOT_METER: 0 },
  readyExpression: 'window.THREE && window.CBZ && CBZ.CONFIG', stageTimeoutMs: 600000,
  pairNote: 'Same seed, factory, variant, colour, lighting and camera. Gallery copies use game geometry and the kit\'s own materials; world frames show the planted world.',
  subjects: [
    { id: 'broad-crown', label: 'Backcountry broadleaf · variation 1', kind: 'landscape', variant: 0 },
    { id: 'upright-crown', label: 'Backcountry broadleaf · variation 2', kind: 'landscape', variant: 1 },
    { id: 'mature-tree', label: 'Redhollow mature tree', kind: 'mature', variant: 0 },
    { id: 'spruce', label: 'Spruce spire', kind: 'spire', variant: 0 },
    { id: 'planted-world', label: 'Gang City backcountry · eye level', kind: 'world' },
    { id: 'under-canopy', label: 'Backcountry · under a tree', kind: 'canopy' },
    { id: 'redhollow', label: 'Redhollow Woods · eye level', kind: 'forest' },
  ],
  metrics: {
    assetTriangles: { label: 'Gallery asset triangles' },
    drawCalls: { label: 'Rendered draw calls' },
    renderedTriangles: { label: 'Rendered triangles' },
    auditedTrees: { label: 'Trees checked for support' },
    floatingCanopies: { label: 'Floating canopy parts', better: 'lower' },
    unseatedTrunks: { label: 'Unseated trunks', better: 'lower' },
    brokenChains: { label: 'Broken tree connections', better: 'lower' },
  }, stage,
};
