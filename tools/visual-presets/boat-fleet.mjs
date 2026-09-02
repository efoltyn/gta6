/* Boat fleet — is the hull a SURFACE or a stack of boxes?

   Every boat in this game was 3-6 stepped prisms. This preset photographs the
   fleet from the two angles that make that impossible to hide: a 3/4 bow view
   with the camera 1.4 m over the water (where a person stands on a dock) and a
   dead-bow view (where flare, deadrise, chine and beam either exist or do not).

   The BEFORE side is the pre-wave checkout, so the two brand-new keys (kayak,
   jetski) do not exist there at all. Those stages return ok:false with a
   readable reason — "no such hull" against a real boat IS the honest before,
   and faking it with a stand-in would be worse than an empty plate.

   THE NUMBER THAT SAYS BOXES is `faceted`: the fraction of adjacent triangle
   pairs whose normals break by more than 25 degrees, keyed by rounded POSITION
   so a welded hard edge still counts as adjacency. src/world/hull_loft.js
   ships that measurement as CBZ.hullLoft.audit() and this stage calls it
   wherever it exists — which is the AFTER side. The BEFORE build predates the
   file, so the stage carries the identical routine to measure it with. Same
   yardstick, both sides; the geometry is the variable. */

const smallCraft = ["kayak", "jetski", "skiff", "pirate_skiff"];

const HULLS = [
  { key: "kayak", name: "Sandbar 14", focus: "A 4.2 m sit-on-top: round bilge, no chine anywhere, a cambered deck welded to the sheer, upswept ends, seat well, hatches, deck lines and the paddle across the well." },
  { key: "jetski", name: "Vareo GT", focus: "A 3.3 m PWC: deep-V with sponsons, moulded deck, saddle for two, bars and dash, boarding step, jet nozzle — and no propeller anywhere." },
  { key: "skiff", name: "Coastline Skiff 18", focus: "5.5 m of welded aluminium: modest V, hard chine, flat sheer, squared transom, three real thwarts, oars in their locks, a tiller outboard." },
  { key: "pirate_skiff", name: "Open Panga", focus: "7.6 m attack panga: high flared bow, fine entry, almost no freeboard aft, twin outboards, fuel drums, boarding pole, timber patch, tarp." },
  { key: "dinghy", name: "Calanque Tender 15", focus: "RIB tender: tube collar, deep-V pan, jockey console, single outboard." },
  { key: "boat", name: "Bellamar Speedboat", focus: "The 6.2 m runabout: hull form, cockpit, windscreen and engine." },
  { key: "console", name: "Centre console", focus: "7.5 m centre console with a T-top and twin outboards (registered later in this wave)." },
  { key: "sloop", name: "Marlow 44 Sloop", focus: "Keelboat: canoe body, ballast fin, coachroof, rig." },
  { key: "cruiser", name: "Bellamar Corsa 46", focus: "14 m sport cruiser: sheer, topsides, saloon, side decks, flybridge." },
  { key: "sportfish", name: "Ravenna 41 Convertible", focus: "Convertible sportfisher: cockpit, flybridge, tower, hull form." },
  { key: "trawler", name: "Bergen Fisher 60", focus: "18 m working trawler: hull, bulwarks, wheelhouse, gantry." },
  { key: "yacht", name: "Nordholm Aurelia 112", focus: "34 m motor yacht: continuous hull, deck stack, bow form." },
  { key: "yacht46", name: "Verano 150", focus: "46 m superyacht: hull line from the water, not from above." },
];

const VIEWS = [
  { id: "quarter", label: "3/4 bow, water level", focus: "Camera 1.4 m over the surface off the bow quarter — the angle a person actually sees a boat from. Sheer line, chine run, entry and transom must all read as one continuous surface." },
  { id: "bowon", label: "dead ahead", focus: "Dead-bow view: flare, deadrise, the V of the sections and the actual beam. A boat made of boxes has vertical sides here and nothing else." },
];

const subjects = [];
let plate = 1;
for (const h of HULLS) {
  for (const v of VIEWS) {
    subjects.push({
      id: `${h.key}-${v.id}`,
      key: h.key,
      view: v.id,
      label: `${String(plate++).padStart(2, "0")} · ${h.name} — ${v.label}`,
      focus: `${h.focus} ${v.focus}`,
    });
  }
}
subjects.push({
  id: "smallcraft-raftup",
  key: null,
  view: "raftup",
  raft: smallCraft,
  label: `${String(plate++).padStart(2, "0")} · Small craft raft-up — kayak, jetski, skiff, panga`,
  focus: "All four small hulls side by side at the same scale and light. This is the plate that shows whether the fleet's small end is four distinct boats or four sizes of the same box.",
});

async function stageBoatFleet(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  if (!T || !CBZ || !CBZ.marineHulls) return { ok: false, error: "marine registry unavailable" };
  const sub = input.subject || {};
  const round = (v, n) => {
    const p = Math.pow(10, n == null ? 3 : n);
    return Number.isFinite(Number(v)) ? Math.round(Number(v) * p) / p : 0;
  };

  // ---- THE YARDSTICK -------------------------------------------------------
  // src/world/hull_loft.js ships audit() and it is the authority wherever it
  // exists. The BEFORE checkout predates the file, so this is the same routine
  // verbatim, used only to measure a build that cannot measure itself.
  const facetedOf = (geos) => {
    const Q = 1e4, COS = Math.cos(25 * Math.PI / 180);
    const normals = [];
    const edges = new Map();
    let faces = 0;
    for (const entry of geos) {
      const geo = entry.geo, mat = entry.mat;
      const p = geo.attributes && geo.attributes.position ? geo.attributes.position.array : null;
      if (!p) continue;
      const index = geo.index ? geo.index.array : null;
      const count = index ? index.length / 3 : p.length / 9;
      const key = (i) => {
        const v = new T.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(mat);
        return `${Math.round(v.x * Q)},${Math.round(v.y * Q)},${Math.round(v.z * Q)}`;
      };
      const pos = (i) => new T.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(mat);
      for (let f = 0; f < count; f++) {
        const ia = index ? index[f * 3] : f * 3, ib = index ? index[f * 3 + 1] : f * 3 + 1, ic = index ? index[f * 3 + 2] : f * 3 + 2;
        const A = pos(ia), B = pos(ib), C = pos(ic);
        const n = B.clone().sub(A).cross(C.clone().sub(A));
        if (n.lengthSq() < 1e-16) continue;
        n.normalize();
        const id = faces++;
        normals.push(n);
        const ka = key(ia), kb = key(ib), kc = key(ic);
        for (const e of [[ka, kb], [kb, kc], [kc, ka]]) {
          const k = e[0] < e[1] ? `${e[0]}|${e[1]}` : `${e[1]}|${e[0]}`;
          let l = edges.get(k);
          if (!l) { l = []; edges.set(k, l); }
          l.push(id);
        }
      }
    }
    let pairs = 0, hard = 0;
    edges.forEach((l) => {
      for (let i = 0; i < l.length; i++) {
        for (let j = i + 1; j < l.length; j++) {
          pairs++;
          if (normals[l[i]].dot(normals[l[j]]) < COS) hard++;
        }
      }
    });
    return pairs ? hard / pairs : 0;
  };

  let ST = window.__cbzBoatFleetVisual;
  if (!ST) {
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    if (renderer.shadowMap) renderer.shadowMap.enabled = true;
    if (T.SRGBColorSpace && "outputColorSpace" in renderer) renderer.outputColorSpace = T.SRGBColorSpace;
    if (T.ACESFilmicToneMapping != null) { renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }
    renderer.domElement.style.cssText = `position:fixed;left:0;top:0;width:${input.width}px;height:${input.height}px;z-index:2147483000`;
    document.body.appendChild(renderer.domElement);

    const overlay = document.createElement("div");
    overlay.id = "__cbzBoatFleetOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483600;color:#f4f7f9;text-shadow:0 2px 9px #000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-detail></div>";
    document.body.appendChild(overlay);

    const scene = new T.Scene();
    scene.background = new T.Color(0x9fc2d4);
    scene.fog = new T.Fog(0x9fc2d4, 200, 1400);
    const camera = new T.PerspectiveCamera(42, input.width / input.height, 0.02, 3000);
    scene.add(new T.HemisphereLight(0xe7f5ff, 0x2b3a45, 2.15));
    const sun = new T.DirectionalLight(0xfff2d8, 3.1);
    sun.position.set(-70, 95, 62); sun.castShadow = true; scene.add(sun);
    const fill = new T.DirectionalLight(0x9dd7ff, 1.05);
    fill.position.set(80, 30, -40); scene.add(fill);

    // The sea is the reference plane for every plate: waterline y = 0 is the
    // hull convention, so the water surface goes there and stays there.
    const seaMat = new T.MeshStandardMaterial({ color: 0x14657f, roughness: 0.32, metalness: 0.06 });
    const sea = new T.Mesh(new T.PlaneGeometry(3000, 3000, 1, 1), seaMat);
    sea.rotation.x = -Math.PI / 2; sea.position.y = 0; scene.add(sea);

    ST = window.__cbzBoatFleetVisual = { renderer, overlay, scene, camera, sea, subjects: [] };
    ST.render = function () { try { renderer.render(scene, camera); } catch (_) {} };
    window.__cbzVisualCompare = { render: ST.render };
  }
  ST.renderer.setSize(input.width, input.height, false);
  ST.camera.aspect = input.width / input.height;
  ST.camera.updateProjectionMatrix();

  for (const child of Array.from(document.body.children)) {
    child.style.visibility = (child === ST.renderer.domElement || child === ST.overlay) ? "" : "hidden";
  }
  for (const old of ST.subjects) ST.scene.remove(old);
  ST.subjects = [];

  // A MISSING HULL GETS ITS OWN PLATE. Returning early without touching the
  // scene leaves the renderer holding the PREVIOUS subject's frame, and the
  // pair page then shows the wrong boat labelled with this one's caption —
  // which is a worse lie than an empty plate. Clear, caption, render, THEN
  // report the failure.
  const missing = (key, why) => {
    q0("[data-side]").textContent = input.side === "before" ? input.beforeLabel : input.afterLabel;
    q0("[data-side]").style.cssText = `position:absolute;left:24px;top:20px;padding:8px 12px;border-radius:7px;background:${input.side === "before" ? "#a43131" : "#197650"};font-size:12px;font-weight:900;letter-spacing:.12em`;
    q0("[data-name]").textContent = sub.label || sub.key;
    q0("[data-name]").style.cssText = "position:absolute;left:24px;top:66px;font-size:26px;font-weight:900";
    q0("[data-focus]").textContent = sub.focus || "";
    q0("[data-focus]").style.cssText = "position:absolute;left:25px;top:104px;max-width:660px;color:#d5e2e8;font-size:13px;line-height:1.35";
    q0("[data-state]").textContent = why;
    q0("[data-state]").style.cssText = "position:absolute;left:24px;top:50%;transform:translateY(-50%);padding:16px 22px;background:rgba(120,26,26,.86);border:1px solid rgba(255,255,255,.35);border-radius:8px;font:800 20px ui-monospace,SFMono-Regular,Menlo,monospace";
    q0("[data-detail]").textContent = "";
    ST.render();
    return { ok: false, error: why };
  };
  const q0 = (sel) => ST.overlay.querySelector(sel);

  const keys = sub.raft ? sub.raft.slice() : [sub.key];
  const built = [];
  for (const key of keys) {
    let rec = null;
    try { rec = CBZ.marineHulls.get(key); } catch (_) { rec = null; }
    if (!rec) return missing(key, `NO SUCH HULL "${key}" IN THIS BUILD`);
    let root = null;
    try { root = CBZ.marineHulls.build(key); } catch (e) { root = null; }
    if (!root) return missing(key, `HULL "${key}" IS REGISTERED BUT DID NOT BUILD`);
    built.push({ key, rec, root });
  }

  // ---- lay them out --------------------------------------------------------
  let spanX = 0;
  if (sub.raft) {
    // Side by side, beam-to-beam, sterns lined up: the point of the plate is
    // relative size and relative shape, so nothing is scaled or nudged.
    const gap = 1.6;
    let x = 0;
    const widths = built.map((b) => Number((b.rec.spec && b.rec.spec.beam) || 2));
    const total = widths.reduce((a, b) => a + b, 0) + gap * (built.length - 1);
    x = -total / 2;
    built.forEach((b, i) => {
      b.root.position.set(x + widths[i] / 2, 0, 0);
      x += widths[i] + gap;
    });
    spanX = total;
  } else {
    built[0].root.position.set(0, 0, 0);
  }
  for (const b of built) {
    b.root.rotation.set(0, 0, 0);
    b.root.updateMatrixWorld(true);
    ST.scene.add(b.root);
    ST.subjects.push(b.root);
  }

  // ---- measure -------------------------------------------------------------
  const primary = built[0];
  const spec = primary.rec.spec || primary.rec.hull || {};
  const loa = Number(spec.loa || 8), beam = Number(spec.beam || 3);
  const geos = [];
  let tris = 0, loftedTris = 0, shell = null;
  primary.root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    const g = o.geometry;
    tris += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    o.updateWorldMatrix(true, false);
    geos.push({ geo: g, mat: o.matrixWorld.clone() });
    if (o.name === "hull_surface" || (o.userData && o.userData.hullSurface)) {
      shell = o;
      loftedTris += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    }
  });

  // The shipped tool wherever it exists; the carried copy where it does not.
  let faceted = 0, facetedSource = "preset copy (no CBZ.hullLoft in this build)";
  if (CBZ.hullLoft && CBZ.hullLoft.audit && geos.length === 1) {
    faceted = CBZ.hullLoft.audit(geos[0].geo).faceted;
    facetedSource = "CBZ.hullLoft.audit";
  } else {
    faceted = facetedOf(geos);
    if (CBZ.hullLoft && CBZ.hullLoft.audit) facetedSource = "preset copy (multi-mesh vessel)";
  }
  // null, not -1: a hull with no lofted shell has no hard-edge fraction, and a
  // sentinel below every real value made every new shell rank as "worse".
  let hullFaceted = null;
  if (shell && CBZ.hullLoft && CBZ.hullLoft.audit) hullFaceted = CBZ.hullLoft.audit(shell.geometry).faceted;

  // beam fit: measured off the HULL SHELL when there is one, because a paddle
  // laid across a kayak is 2.1 m wide and is not the boat's beam.
  const box = new T.Box3().setFromObject(shell || primary.root);
  const measuredBeam = box.max.x - box.min.x;
  const beamFitErr = Math.abs(measuredBeam - beam);
  const freeboardM = (spec.stab && Number.isFinite(spec.stab.freeboard)) ? spec.stab.freeboard : 0;

  // ---- the camera ----------------------------------------------------------
  const height = Math.max(0.5, box.max.y - Math.min(0, box.min.y));
  let desired;
  if (sub.view === "raftup") {
    const d = Math.max(spanX * 1.02, 10);
    desired = { pos: [d * 0.26, 2.4, d * 0.96], target: [0, 0.28, -0.1], fov: 40 };
  } else if (sub.view === "bowon") {
    const d = Math.max(loa * 0.80, beam * 4.4, 4.2);
    desired = { pos: [0, Math.min(1.30, 0.35 + height * 0.45), loa * 0.5 + d], target: [0, Math.min(0.55, height * 0.30), loa * 0.1], fov: 32 };
  } else {
    // 3/4 bow, EYE AT 1.4 m OVER THE WATER — the whole point of the plate.
    // The distance has to clear the AIR DRAFT too: a 7.6 m panga with a 1.7 m
    // bow standing 7.7 m away puts its stem out of the top of the frame.
    const d = Math.max(loa * 1.24, beam * 4.0, height * 3.4, 4.0);
    desired = { pos: [d * 0.60, 1.4, d * 0.80], target: [0, Math.min(0.65, height * 0.36), loa * 0.04], fov: 42 };
  }
  const ref = input.referenceStage && input.referenceStage.camera;
  const cam = ref || desired;
  ST.camera.position.fromArray(cam.pos);
  ST.camera.up.set(0, 1, 0);
  ST.camera.lookAt(new T.Vector3().fromArray(cam.target));
  ST.camera.fov = Number(cam.fov) || 42;
  ST.camera.near = 0.02;
  ST.camera.far = Math.max(1500, loa * 20);
  ST.camera.updateProjectionMatrix();
  ST.camera.updateMatrixWorld(true);

  const q = (sel) => ST.overlay.querySelector(sel);
  q("[data-side]").textContent = input.side === "before" ? input.beforeLabel : input.afterLabel;
  q("[data-side]").style.cssText = `position:absolute;left:24px;top:20px;padding:8px 12px;border-radius:7px;background:${input.side === "before" ? "#a43131" : "#197650"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("[data-name]").textContent = sub.label || sub.key;
  q("[data-name]").style.cssText = "position:absolute;left:24px;top:66px;font-size:26px;font-weight:900";
  q("[data-focus]").textContent = sub.focus || "";
  q("[data-focus]").style.cssText = "position:absolute;left:25px;top:104px;max-width:660px;color:#d5e2e8;font-size:13px;line-height:1.35";
  q("[data-state]").textContent = sub.raft
    ? `${built.length} SMALL CRAFT · ${built.map((b) => b.key).join(" · ")}`
    : `${sub.key} · ${round(loa, 1)} m × ${round(beam, 2)} m · ${spec.stab ? "stab block" : "NO stab block"}`;
  q("[data-state]").style.cssText = "position:absolute;left:24px;bottom:57px;padding:7px 10px;background:rgba(6,13,18,.78);border:1px solid rgba(255,255,255,.25);border-radius:6px;font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace";
  q("[data-detail]").textContent = `${tris.toLocaleString()} tris · faceted ${round(faceted, 3)} (${facetedSource}) · lofted shell ${loftedTris.toLocaleString()} tris · beam err ${round(beamFitErr, 3)} m · freeboard ${round(freeboardM, 2)} m`;
  q("[data-detail]").style.cssText = "position:absolute;left:24px;bottom:27px;color:#d5e2e8;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  ST.render();
  return {
    ok: true,
    key: sub.key || "raftup",
    camera: { pos: cam.pos.slice(), target: cam.target.slice(), fov: Number(cam.fov) || 42 },
    metrics: {
      tris,
      faceted: round(faceted, 4),
      hullFaceted: hullFaceted == null ? null : round(hullFaceted, 4),
      loftedTris,
      beamFitErr: round(beamFitErr, 4),
      freeboardM: round(freeboardM, 3),
    },
  };
}

export default {
  id: "boat-fleet",
  title: "Boat Fleet — the hull is a surface, not a stack of boxes",
  description: "Every registered hull from the two angles that expose a fake one: a 3/4 bow view with the camera 1.4 m over the water, and dead ahead. Plus the four smallest craft rafted up at one scale.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · CURRENT",
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG && CBZ.marineHulls && CBZ.marineHulls.keys && CBZ.marineHulls.keys().length >= 4",
  viewport: { width: 1120, height: 700 },
  stageTimeoutMs: 240000,
  urlParams: { seed: "boat-fleet-2026-09-01" },
  pairNote: "Same registry key · same camera · same light · waterline y = 0 · same viewport",
  method: "Hulls are built by CBZ.marineHulls.build(key) into a bare studio with the sea at the hull convention's own waterline. The AFTER side inherits the exact BEFORE tripod, so the geometry is the only variable. Keys that do not exist on a side return ok:false naming the missing hull rather than substituting a stand-in.",
  metricsNote: "faceted is the fraction of adjacent triangle pairs whose normals break more than 25 degrees, keyed by rounded world position so a welded hard edge still counts. CBZ.hullLoft.audit() ships that measurement; the BEFORE checkout predates the file, so the stage carries the identical routine for it. A BoxGeometry scores 0.67; a hull drawn as stepped prisms scores higher; a lofted hull with only its chine and transom hard lands near 0.10.",
  metrics: {
    faceted: { label: "Hard-edge fraction (whole vessel)", better: "lower" },
    hullFaceted: { label: "Hard-edge fraction (hull shell; blank = no shell)", better: "lower" },
    loftedTris: { label: "Triangles in a lofted hull shell", better: "higher" },
    tris: { label: "Triangles drawn", better: "lower" },
    beamFitErr: { label: "Measured beam vs spec (m)", unit: "m", better: "lower" },
    freeboardM: { label: "Declared freeboard (0 = no stab block)", unit: "m", better: "higher" },
  },
  defaultFocus: "Does this read as a hull — sheer, chine, flare, entry, transom — or as boxes?",
  subjects,
  stage: stageBoatFleet,
};
