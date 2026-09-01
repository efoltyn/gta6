/* THE MOUTH, MADE REAL — the great white's upper jaw, teeth and roof.

   OWNER (2026-09-01): "improve the appearance of the shark mouth and how the
   shark looks while biting something … especially the top of the mouth and
   the top teeth seem to overlap with top of mouth, especially when opening
   it … I hate fake shit."

   Photographed and measured, three things were fake about the top of the
   mouth, and every page here is one of them seen from where a player sees it:

     1. THE TEETH WERE A WALL. The front row was 19 teeth of 0.132 on a jaw
        line about 2.0 long — each tooth overlapped the next by a quarter, so
        the row photographed as one continuous white slab under the snout.
        Real great white teeth touch at the base and no more; you can count
        them. The count comes down and the width is capped by the pitch.
     2. THE PALATE CUT THROUGH THE TEETH. The rostrum shell's mouth roof sat
        8 cm BELOW the upper gum band, so the gum was buried in the snout and
        every upper tooth sprouted from a lit grey plane at 40% of its height
        — the "top of the mouth" the teeth overlapped. The roof is now above
        the gum, and it is unlit: a mouth roof is in shadow.
     3. THE UPPER JAW DID NOT PROTRUDE. A great white slides its tooth-bearing
        upper jaw down and forward OUT of the snout when it commits. Ours
        lifted the whole head as one piece, so the teeth hung straight off
        the snout's white skin edge with no tissue between. The jaw now drops
        a quarter of the gap and slides forward as the mouth opens, its pale
        pink tissue comes out from under the skin, and the teeth stand in it.

   And two things that are true of the animal and were not true of this one:
   the eyes ROLL BACK white as the bite commits (a great white has no
   nictitating membrane; it rotates the eyeball into the socket), and the
   gums are wet dark red-pink, not the salmon the linear-hex trap made them.

   Both columns run the same staging function (shark-bites.mjs) through the
   production species builders, CBZ.buildSwimRig and CBZ.swimJaw; this file
   adds two rulers read out of the built geometry:

     toothWallPct  — walk the upper front tooth row at mid-crown and ask, at
                     120 stations along the jaw line, whether there is tooth
                     there. 100 is a wall. Real teeth leave gaps.
     gumOutM       — at the photographed gape, how far the upper tooth ROOTS
                     stand below the snout shell's own skin edge at the front
                     of the mouth. Negative = the roots (and the gum) are
                     swallowed by the snout and the teeth grow out of skin;
                     positive = the jaw has protruded and the teeth stand in
                     tissue outside the head, as they do on the animal. */

import { stagePredatorMouth } from "./shark-bites.mjs";

const HERO = "great_white_shark";

const subjects = [
  {
    id: "gw-rest-profile", label: "Great White — Sealed, Profile", species: HERO, open: 0,
    frame: 2.65, target: [2.38, 0.76, 0], cameraOffset: [0.35, 0.30, 6.5],
    focus: "At rest nothing changes: the mouth is a line, the upper crowns tip over the lower lip, the eye is dark. The protrusion, the roll and the roof are all inside the closed head.",
    state: "REST · JAW 0%", metric: "Same closed silhouette · dark eye",
  },
  {
    id: "gw-windup-profile", label: "Great White — Opening, Profile", species: HERO, open: 0.42,
    frame: 2.85, target: [2.43, 0.62, 0], cameraOffset: [0.55, 0.35, 6.8],
    focus: "As the jaw drops the upper jaw begins to slide out from under the snout. Before: the teeth hung from the snout's white skin edge. After: pink jaw tissue between the skin and the crowns.",
    state: "WIND-UP · JAW 42%", metric: "Upper jaw tissue emerges · teeth countable",
  },
  {
    id: "gw-gape-profile", label: "Great White — Full Gape, Profile", species: HERO, open: 1,
    frame: 3.05, target: [2.42, 0.48, 0], cameraOffset: [0.70, 0.55, 7.0],
    focus: "The owner's frame. Before: a white comb glued to the underside of the nose, roots hidden in the snout. After: the tooth-bearing jaw has protruded down and forward; broad spaced teeth stand in pale pink tissue with a dark roof behind them; the eye has rolled white.",
    state: "FULL GAPE · JAW 100%", metric: "Protruded jaw · teeth in tissue · eye rolled",
  },
  {
    id: "gw-gape-three-quarter", label: "Great White — Full Gape, Three-Quarter", species: HERO, open: 1,
    frame: 3.15, target: [2.40, 0.50, 0], cameraOffset: [2.55, 0.80, 5.9],
    focus: "The prey's view. The roof of the mouth is dark all the way to the gum line; the upper teeth are individual blades with gum between them, not a rail.",
    state: "FULL GAPE · PREY VIEW", metric: "Dark roof to the gum · countable teeth",
  },
  {
    id: "gw-gape-head-on", label: "Great White — Full Gape, Head-On", species: HERO, open: 1,
    frame: 2.9, target: [2.45, 0.62, 0], cameraOffset: [8.5, 0.35, 0.05],
    focus: "Straight down the throat. Before: a lit grey plane over the upper teeth — the palate cutting through the tooth field — and the tooth row a solid white bar. After: dark roof, pink gum band, teeth you can count top and bottom.",
    state: "FULL GAPE · HEAD-ON", metric: "No grey plane over the teeth",
  },
  {
    id: "gw-gape-below", label: "Great White — Full Gape, From Below", species: HERO, open: 1,
    frame: 3.0, target: [2.45, 0.60, 0], cameraOffset: [3.2, -2.6, 3.4],
    focus: "The swimmer's last view — looking up into the mouth from below and ahead. The underside of the protruded upper jaw is tissue with teeth in it, and the sack behind the teeth is shallow at the front so the crowns stand against the dark.",
    state: "FULL GAPE · FROM BELOW", metric: "Teeth against dark, not against a slab",
  },
  {
    id: "gw-rider-view", label: "Great White — Full Gape, Rider's View", species: HERO, open: 1,
    frame: 2.6, target: [2.35, 0.75, 0], cameraOffset: [-1.9, 1.9, 1.35],
    focus: "Where the Shark Sim camera actually sits: above and behind the head. What the player sees of an open mouth is the lifted snout and the protruded jaw's tissue and teeth under it — not a white slab under the nose.",
    state: "FULL GAPE · RIDER'S VIEW", metric: "The bite reads from the saddle",
  },
  {
    id: "gw-contact", label: "Great White — Tuna Between the Teeth", species: HERO, open: 0.82,
    frame: 3.65, target: [2.60, 0.53, 0], cameraOffset: [1.8, 0.70, 7.2],
    targetSpecies: "tuna", targetAt: [3.25, 0.70, 0], targetYaw: Math.PI / 2,
    focus: "A meal in the gape. The upper teeth come down on it out of tissue, not out of the skull; the eye is already rolled.",
    state: "CONTACT · JAW 82%", metric: "Teeth meet the body from the jaw, not the skull",
  },
  /* ---- THE CLOSED MOUTHS, ALL FOUR SHARKS. Owner, mid-wave: "the issue
     with many like megalodon and the bull and great white is black shit in
     the mouth protruding out the lips … the hammerhead is protruding a
     pinkish colour." A closed shark mouth is a LINE. Anything dark or pink
     standing outside it is an interior mesh (sack, throat, liner, gum) that
     has escaped the skin. Each is photographed from the low three-quarter
     the player actually gets, and again with every mesh in its own flat
     colour so the escapee can be NAMED, not guessed at. */
  {
    id: "gw-rest-low", label: "Great White — Closed, Low Three-Quarter", species: HERO, open: 0,
    frame: 2.4, target: [2.30, 0.70, 0], cameraOffset: [2.6, -0.9, 4.6],
    focus: "The closed mouth from below and ahead. Nothing dark and nothing pink may stand outside the lip line.",
    state: "REST · LOW VIEW", metric: "Closed mouth is a line",
  },
  {
    id: "gw-rest-low-parts", label: "Great White — Closed, Part Map", species: HERO, open: 0, parts: true,
    frame: 2.4, target: [2.30, 0.70, 0], cameraOffset: [2.6, -0.9, 4.6],
    focus: "Same frame, every mesh its own colour: what is standing outside the lips, by name.",
    state: "REST · PART MAP", metric: "Names, not guesses",
  },
  {
    id: "bull-rest-low", label: "Bull Shark — Closed, Low Three-Quarter", species: "bull_shark", open: 0,
    frame: 2.1, target: [1.85, 0.66, 0], cameraOffset: [2.2, -0.8, 3.9],
    focus: "The bull shark's closed mouth from the water below it.",
    state: "REST · LOW VIEW", metric: "Closed mouth is a line",
  },
  {
    id: "bull-rest-low-parts", label: "Bull Shark — Closed, Part Map", species: "bull_shark", open: 0, parts: true,
    frame: 2.1, target: [1.85, 0.66, 0], cameraOffset: [2.2, -0.8, 3.9],
    focus: "Every mesh its own colour.",
    state: "REST · PART MAP", metric: "Names, not guesses",
  },
  {
    id: "meg-rest-low", label: "Megalodon — Closed, Low Three-Quarter", species: "megalodon", open: 0,
    animal: [0, -1.6, 0], frame: 5.2, target: [8.2, -0.2, 0], cameraOffset: [5.6, -2.2, 9.8],
    focus: "The megalodon's closed mouth from below.",
    state: "REST · LOW VIEW", metric: "Closed mouth is a line",
  },
  {
    id: "meg-rest-unlit-chin", label: "Megalodon — Closed, Chin Unlit (diagnostic)", species: "megalodon", open: 0,
    animal: [0, -1.6, 0], frame: 5.2, target: [8.2, -0.2, 0], cameraOffset: [5.6, -2.2, 9.8], unlitMesh: "sharkChin",
    focus: "The chin painted with an unlit copy of its own colour. If the dark strip along the jaw goes away, it was a lighting artefact of the chin's own faces.",
    state: "REST · DIAGNOSTIC", metric: "",
  },
  {
    id: "meg-rest-lambert-chin", label: "Megalodon — Closed, Chin in the Game's Lambert", species: "megalodon", open: 0,
    animal: [0, -1.6, 0], frame: 5.2, target: [8.2, -0.2, 0], cameraOffset: [5.6, -2.2, 9.8], lambertMesh: "sharkChin",
    probe: [[0.66, 0.42], [0.67, 0.43], [0.68, 0.42], [0.69, 0.41], [0.66, 0.44], [0.665, 0.425], [0.675, 0.415], [0.655, 0.435], [0.68, 0.44], [0.70, 0.40]],
    focus: "The chin rendered with smooth MeshLambert over its built vertex normals, as the game does. BEFORE: the rim vertices were shared with the dark deck walls, so their normals averaged to nothing useful and the top of the chin shaded as a dark band along the closed jaw line. AFTER: the lip is a hard edge.",
    state: "REST · GAME SHADING", metric: "No dark band along the lip",
  },
  {
    id: "gw-rest-lambert-chin", label: "Great White — Closed, Chin in the Game's Lambert", species: HERO, open: 0,
    frame: 2.4, target: [2.30, 0.70, 0], cameraOffset: [2.6, -0.9, 4.6], lambertMesh: "sharkChin",
    focus: "Same diagnostic on the hero.",
    state: "REST · GAME SHADING", metric: "No dark band along the lip",
  },
  {
    id: "meg-rest-probe", label: "Megalodon — Closed, Probe", species: "megalodon", open: 0,
    animal: [0, -1.6, 0], frame: 5.2, target: [8.2, -0.2, 0], cameraOffset: [5.6, -2.2, 9.8],
    probe: [[0.50, 0.40], [0.55, 0.42], [0.60, 0.43], [0.65, 0.40], [0.70, 0.37], [0.62, 0.36], [0.66, 0.30], [0.60, 0.29], [0.68, 0.25], [0.64, 0.27]],
    focus: "Named by ray: what is the dark strip and what is the pink strip.",
    state: "REST · PROBE", metric: "",
  },
  {
    id: "meg-rest-low-parts", label: "Megalodon — Closed, Part Map", species: "megalodon", open: 0, parts: true,
    animal: [0, -1.6, 0], frame: 5.2, target: [8.2, -0.2, 0], cameraOffset: [5.6, -2.2, 9.8],
    focus: "Every mesh its own colour.",
    state: "REST · PART MAP", metric: "Names, not guesses",
  },
  {
    id: "hh-rest-low", label: "Hammerhead — Closed, Low Three-Quarter", species: "hammerhead_shark", open: 0,
    frame: 2.3, target: [1.75, 0.62, 0], cameraOffset: [2.3, -0.8, 4.1],
    focus: "The hammerhead's closed mouth. The owner sees pink standing outside it.",
    state: "REST · LOW VIEW", metric: "Closed mouth is a line",
  },
  {
    id: "hh-rest-low-parts", label: "Hammerhead — Closed, Part Map", species: "hammerhead_shark", open: 0, parts: true,
    frame: 2.3, target: [1.75, 0.62, 0], cameraOffset: [2.3, -0.8, 4.1],
    focus: "Every mesh its own colour.",
    state: "REST · PART MAP", metric: "Names, not guesses",
  },
  {
    id: "hh-gape", label: "Hammerhead — Full Gape", species: "hammerhead_shark", open: 1,
    frame: 2.5, target: [1.80, 0.50, 0], cameraOffset: [1.7, 0.5, 5.0],
    focus: "The hammerhead's mouth is the legacy (non-split) path; it shares the teeth, gums and colours.",
    state: "FULL GAPE · HAMMERHEAD", metric: "Shared teeth and gums",
  },
  {
    id: "bull-gape", label: "Bull Shark — Same Grammar", species: "bull_shark", open: 1,
    frame: 2.75, target: [1.95, 0.52, 0], cameraOffset: [1.85, 0.60, 5.6],
    focus: "Every split-body shark inherits the protrusion, the roof and the tooth spacing from the shared mouth builder; nothing here is hero-only.",
    state: "FULL GAPE · BULL SHARK", metric: "Shared mouth grammar",
  },
  {
    id: "meg-gape", label: "Megalodon — Same Grammar at Scale", species: "megalodon", open: 1,
    animal: [0, -1.6, 0], frame: 7.6, target: [9.45, -0.05, 0], cameraOffset: [5.2, 2.0, 15.5],
    focus: "At 2.6x the megalodon's 0.245-wide teeth were the worst wall of all (21 of them on a 3.0 arc). Capped by the pitch they become teeth.",
    state: "FULL GAPE · MEGALODON", metric: "Pitch-capped teeth at scale",
  },
];

async function stageSharkMouthReal(input) {
  const out = stagePredatorMouth(input);
  if (!out || !out.ok) return out;
  const T = window.THREE, studio = window.__cbzVisualCompare;
  const scene = studio && studio.scene;
  if (!scene) return out;
  // the animal is the first child with an authored mouth
  let animal = null;
  scene.traverse(function (o) { if (!animal && o._aquaticMouth) animal = o; });
  if (!animal) return out;
  animal.updateMatrixWorld(true);
  const mo = animal._aquaticMouth, c = mo.contract;
  let upperTooth = null, rostrum = null;
  animal.traverse(function (o) {
    if (!o.isMesh) return;
    if (!upperTooth && o.name === "sharkUpperTooth") upperTooth = o;
    if (!rostrum && o.name === "sharkRostrum") rostrum = o;
  });
  const metrics = out.metrics || (out.metrics = {});

  /* PART MAP. Every mesh in its own flat colour, re-rendered at the identical
     camera, with a legend in the caption — so a dark thing outside the lips
     is a NAME (borrowed from shark-head-weld.mjs, which learned that guessing
     costs capture cycles). Also counts, by raycast grid over the frame, how
     much of the picture is mouth interior (sack / throat / liner) on a CLOSED
     mouth — which should be none of it. */
  if (input.subject.parts) {
    const HUES = ["#ff5f5f", "#ffd23f", "#4ad991", "#5aa9ff", "#c77dff", "#ff9f45", "#3ddad7", "#ff6fb5",
      "#b6ff3d", "#8f8fff", "#d94a4a", "#a37b00", "#0f8f5a", "#0b4ea8", "#6a1fb0", "#8a4b00", "#0d7a78",
      "#a8005c", "#5f8f00", "#3a3aa8"];
    const seen = new Map(); let n = 0;
    animal.traverse(function (o) {
      if (!o.isMesh) return;
      const nm = o.name || "(unnamed)";
      if (!seen.has(nm)) { seen.set(nm, HUES[n % HUES.length]); n++; }
      o.material = new T.MeshBasicMaterial({ color: seen.get(nm), side: T.DoubleSide });
    });
    studio.renderer.render(scene, studio.camera);
    const legend = [];
    seen.forEach(function (col, nm) { legend.push(nm + " " + col); });
    const metricEl = studio.overlay.querySelector("[data-metric]");
    if (metricEl) { metricEl.textContent = legend.join("  ·  "); metricEl.style.maxWidth = "1100px"; metricEl.style.whiteSpace = "normal"; }
  }
  /* DEBUG: paint one named mesh with an UNLIT copy of its own colour. If a
     dark patch on it vanishes, the darkness was lighting (a normal), not
     geometry standing in front of it. */
  /* DEBUG 2: the GAME's material on one mesh — smooth MeshLambert over the
     built vertex normals — because the studio flat-shades and so cannot show
     a vertex-normal defect the player sees every night. */
  if (input.subject.lambertMesh) {
    animal.traverse(function (o) {
      if (!o.isMesh || o.name !== input.subject.lambertMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const rep = mats.map(function (mm) { return new T.MeshLambertMaterial({ color: mm.color ? mm.color.getHex() : 0xffffff, side: mm.side }); });
      o.material = Array.isArray(o.material) ? rep : rep[0];
    });
    studio.renderer.render(scene, studio.camera);
  }
  if (input.subject.unlitMesh) {
    animal.traverse(function (o) {
      if (!o.isMesh || o.name !== input.subject.unlitMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const rep = mats.map(function (mm) { return new T.MeshBasicMaterial({ color: mm.color ? mm.color.getHex() : 0xffffff, side: mm.side }); });
      o.material = Array.isArray(o.material) ? rep : rep[0];
    });
    studio.renderer.render(scene, studio.camera);
  }
  /* PROBE: name what is at a screen point (x,y in 0..1), with the material
     group and the world point — the question a person asks by pointing. */
  if (input.subject.probe && studio.camera) {
    const pr = new T.Raycaster();
    const outp = input.subject.probe.map(function (pt) {
      pr.setFromCamera({ x: pt[0] * 2 - 1, y: 1 - pt[1] * 2 }, studio.camera);
      const hit = pr.intersectObject(animal, true);
      if (!hit.length) return "(" + pt[0] + "," + pt[1] + ")=nothing";
      const h0 = hit[0], mi = h0.face && h0.face.materialIndex != null ? h0.face.materialIndex : -1;
      return "(" + pt[0] + "," + pt[1] + ")=" + (h0.object.name || "(unnamed)") + "#g" + mi +
        "@" + h0.point.x.toFixed(2) + "," + h0.point.y.toFixed(2) + "," + h0.point.z.toFixed(2);
    });
    out.probed = outp;
    const metricEl = studio.overlay.querySelector("[data-metric]");
    if (metricEl) { metricEl.textContent = outp.join("  "); metricEl.style.maxWidth = "1100px"; metricEl.style.whiteSpace = "normal"; }
  }
  if (Number(input.subject.open) === 0 && studio.camera) {
    const pr = new T.Raycaster(); let hits = 0, cav = 0;
    const GX = 60, GY = 38;
    for (let iy = 0; iy < GY; iy++) for (let ix = 0; ix < GX; ix++) {
      pr.setFromCamera({ x: ((ix + 0.5) / GX) * 2 - 1, y: 1 - ((iy + 0.5) / GY) * 2 }, studio.camera);
      const h = pr.intersectObject(animal, true);
      if (!h.length) continue;
      hits++;
      // interior meshes only: the gum bands' outer faces ARE the lips' skin
      if (/Sack|Throat|Liner/i.test(h[0].object.name || "")) cav++;
    }
    metrics.closedInteriorPct = hits ? Number(((cav / hits) * 100).toFixed(2)) : 0;
  }

  /* toothWallPct — in the tooth mesh's OWN frame (so it is the same number at
     any gape), walk the front row's arc at mid-crown height and fire a short
     ray down through the row at each station. The builder's front row sits on
     the oral arc (r = 1.00) at the gum's base height; both are read off the
     built geometry's bounds, not off the builder's numbers. */
  if (upperTooth && upperTooth.geometry) {
    const geo = upperTooth.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    // the front row is the outermost ring of the field: its arc is the bbox
    // in plan, and the crowns hang from the top of the box
    const cx = (bb.min.x + bb.max.x) / 2, hx = (bb.max.x - bb.min.x) / 2, hz = (bb.max.z - bb.min.z) / 2;
    const h = bb.max.y - bb.min.y;
    // FACE-ON, NOT EDGE-ON. A tooth is a thin blade standing radially on the
    // arc: a ray fired down its length is parallel to the blade and misses
    // (the first build of this ruler read 0% on a row that was visibly a
    // wall). The rays come in horizontally from outside the arc toward its
    // centre at mid-crown height, which is how the blade presents its face.
    const rc = new T.Raycaster(); rc.near = 0; rc.far = Math.max(hx, hz) * 2;
    const o0 = new T.Vector3(), d0 = new T.Vector3();
    const probe = new T.Mesh(geo, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    probe.updateMatrixWorld(true);
    let hit = 0, n = 0;
    const yMid = bb.max.y - h * 0.5;
    for (let i = 0; i < 120; i++) {
      const a = -Math.PI * 0.47 + (i / 119) * Math.PI * 0.94;
      const px = cx + Math.cos(a) * hx * 1.6, pz = Math.sin(a) * hz * 1.6;
      o0.set(px, yMid, pz); d0.set(cx - px, 0, -pz).normalize();
      rc.set(o0, d0);
      const hits = rc.intersectObject(probe, false);
      n++;
      // the first thing the ray meets must be within the outer row's own
      // radius (a rear row lying flat behind a gap is not the front row)
      if (hits.length) {
        const q = hits[0].point;
        const rr = Math.hypot((q.x - cx) / hx, q.z / hz);
        if (rr > 0.86) hit++;
      }
    }
    metrics.toothWallPct = n ? Number(((hit / n) * 100).toFixed(1)) : null;
    metrics.upperFrontTeeth = c && c.upperTeeth != null ? c.upperTeeth : null;
  }

  /* gumOutM — the upper tooth roots against the snout shell's skin edge, both
     in world space at the photographed gape, over the front 30% of the jaw. */
  if (upperTooth && rostrum) {
    const sc = animal.scale.x || 1;
    const inv = new T.Matrix4().copy(animal.matrixWorld).invert();
    const v = new T.Vector3();
    const x0 = c.hinge.x + (c.bite.x - c.hinge.x) * 0.70;
    function scan(mesh, pick) {
      const pos = mesh.geometry.attributes.position;
      let best = null;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
        if (v.x < x0) continue;
        if (Math.abs(v.z) > 0.12 * (c.bite.x - c.hinge.x)) continue;   // the front of the arc only
        if (best == null || pick(v.y, best)) best = v.y;
      }
      return best;
    }
    const rootY = scan(upperTooth, function (y, b) { return y > b; });      // highest tooth vertex = root line
    const skinY = scan(rostrum, function (y, b) { return y < b; });         // lowest shell vertex = skin edge
    if (rootY != null && skinY != null) metrics.gumOutM = Number(((skinY - rootY) * sc).toFixed(3));
  }
  return out;
}

export default {
  id: "shark-mouth-real",
  title: "The Mouth, Made Real — Teeth in Tissue, a Dark Roof, a Jaw that Protrudes",
  description: "Ten locked comparisons of the great white's mouth (plus the bull shark and megalodon for the shared grammar). BEFORE is main at b0566c8. AFTER protrudes the tooth-bearing upper jaw out of the snout as the mouth opens, lifts the mouth roof above the gum and paints it unlit, caps every tooth's width by the pitch of its row so the teeth can be counted, darkens the gums to wet gingiva, and rolls the eyes white as the bite commits.",
  beforeLabel: "BEFORE · b0566c8",
  afterLabel: "AFTER · PROTRUDED JAW, DARK ROOF, COUNTABLE TEETH",
  pairNote: "Same species · scale · gape · target · camera · light · viewport",
  method: "Both columns execute the same staging function (shark-bites.mjs) through the registered production species builders, CBZ.buildSwimRig and CBZ.swimJaw, in a studio scene with fixed lights and an orthographic camera. The two rulers are read out of the built geometry in the page: toothWallPct walks the upper front row at mid-crown with 120 downward rays in the tooth mesh's own frame and reports how much of the jaw line is solid tooth (100 = a wall); gumOutM measures, at the photographed gape and over the front of the arc, how far the upper tooth roots stand below the snout shell's skin edge (negative = roots swallowed by the snout, teeth growing out of skin). Neither number is authored anywhere; both are the same instrument on both builds.",
  viewport: { width: 1200, height: 760 },
  readyExpression: "window.THREE && window.CBZ && CBZ.buildSwimRig && CBZ.swimJaw && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark && CBZ.WILDLIFE_SPECIES.bull_shark && CBZ.WILDLIFE_SPECIES.megalodon",
  subjects,
  /* HARNESS TRAP: the stage is STRINGIFIED and run inside the page, so a
     module import is not in scope there. The shared staging function is
     embedded as source into a self-contained function instead. */
  stage: new Function("input",
    `const stagePredatorMouth = (${stagePredatorMouth.toString()});\n` +
    `return (${stageSharkMouthReal.toString()})(input);`),
  metricsWhitelist: true,
  metrics: {
    toothWallPct: { label: "Upper front row: share of the jaw line that is solid tooth at mid-crown (100 = a wall)", unit: "%", better: "lower" },
    gumOutM: { label: "Upper tooth roots below the snout's skin edge at this gape (− = buried in the snout)", unit: "m", better: "higher" },
    upperFrontTeeth: { label: "Upper teeth built (all rows)" },
    upperEnvelopeTravelM: { label: "Actual upper body-envelope travel", unit: "m" },
    closedInteriorPct: { label: "CLOSED mouth: share of the animal's pixels that are mouth INTERIOR (sack, throat, liner) showing", unit: "%", better: "lower" },
  },
  metricsNote: "toothWallPct is the owner's 'overlap' as a number: at 100 the front row is one white slab; real teeth leave gaps. gumOutM is where the teeth grow from: negative means the roots and the gum are inside the snout and the crowns sprout from skin; positive means the jaw has protruded and the teeth stand in tissue outside the head. At rest (jaw 0%) both builds are expected negative — that is a closed mouth.",
};
