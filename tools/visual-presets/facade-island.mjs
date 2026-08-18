/* FACADE ISLAND — all 31 grammars standing in the game, not in a studio.

   OWNER: "let's test out all the facades by putting them all on the buildings
   in the very quick to load one — Palm Survivor."

   WHY THIS SHEET EXISTS ALONGSIDE facade-gallery / facade-houses
   -------------------------------------------------------------
   Those two photograph one shell on a neutral pad under a studio key light,
   which is the right way to compare grammars against each other and the wrong
   way to answer "does this hold up in the game". This sheet answers the second
   question: the real island, the real sun and sky, the real ground, the real
   neighbouring buildings, at the sizes the arena actually places (6.5-11 m
   plans, 1-3 storeys in the town; 13-22 storeys downtown) — sizes no studio
   plate uses.

   WHAT IS BEING COMPARED
   ----------------------
   One variable. Both sides boot the same seeded island through the same
   Disaster Survival entry, with the same buildings in the same places at the
   same heights — the town plan is read from the facade registry regardless of
   the flag, precisely so this pairing is honest. The only difference:

       before   ?cfg_SURV_FACADES=0     the island's own plain boxes
       after    ?cfg_SURV_FACADES=1     the same boxes, dressed

   THE PLATES
   ----------
   One three-quarter plate per registered facade, framed off that building's
   OWN record (position, footprint, height) as it stands on the island — so
   each plate is photographing its real subject rather than a coordinate that
   happened to work in one seed. Then three context plates: the town ring from
   the air, the downtown skyline, and a street-level look down a row.
*/

const FH = 3.4;                                     // the island's storey height

/* THE STYLE ORDER is the registry's own sort, which is also the order the
   arena assigns them in, so a plate's index and its building never drift
   apart. Kept as a literal list (rather than read at module load, which
   happens in node where CBZ does not exist) and asserted against the live
   island at stage time. */
const LOW = ["adobe", "artdeco", "brick", "brickhouse", "brutalist", "desertmod",
  "gothic", "greekrev", "hightech", "machiya", "manor", "mosque", "pagoda",
  "plantation", "queenanne", "ranch", "romanvilla", "spanish", "stone",
  "techhouse", "victorian"];
const TOWER = ["bundled", "faceted", "intl", "megabrace", "neogothic", "pencil",
  "postmodern", "pyramid", "sunburst", "ziggurat"];

const LABEL = {
  adobe: "Pueblo Adobe", artdeco: "Deco Tower", brick: "Chicago Loft",
  brickhouse: "Brick Colonial House", brutalist: "Beton Brut",
  desertmod: "Desert Modern House", gothic: "Gothic Revival",
  greekrev: "Greek Revival Mansion", hightech: "Exostructure",
  machiya: "Japanese Residence", manor: "English Manor", mosque: "Grand Mosque",
  pagoda: "Tiered Eaves", plantation: "Antebellum Plantation",
  queenanne: "Queen Anne Painted Lady", ranch: "Plain House",
  romanvilla: "Roman Villa", spanish: "Spanish Colonial Mansion",
  stone: "Ashlar Bank", techhouse: "Modern Tech House", victorian: "Second Empire",
  bundled: "Bundled Tube", faceted: "Faceted Prism", intl: "Seagram Curtain Wall",
  megabrace: "Braced Tube", neogothic: "Cathedral of Commerce", pencil: "Supertall Slim",
  postmodern: "Broken Pediment", pyramid: "Tapered Spire", sunburst: "Radiator Crown",
  ziggurat: "Zoning Setback Tower",
};

const subjects = [];
for (const id of LOW) {
  subjects.push({ id: "house-" + id, style: id, kind: "building",
    label: LABEL[id] + " — on the island",
    focus: "The grammar on a real island building (6.5-11 m plan, 1-3 storeys) under the arena's own sun, standing next to its neighbours on real ground. The studio sheets photograph a 14x11 m shell on a neutral pad; this is smaller and rougher than anything they show, so it is where a grammar that only re-proportions on paper falls apart. The base building's own window band must still read." });
}
for (const id of TOWER) {
  subjects.push({ id: "tower-" + id, style: id, kind: "building",
    label: LABEL[id] + " — downtown",
    focus: "A skyline grammar on an island tower built tall enough to carry it (its own declared minStoreys plus three floors). These towers are far slimmer than the 34x28 m shell the tower sheet uses, so this plate is the slenderness test: banding that worked on a broad shaft can smear on a narrow one." });
}
subjects.push({ id: "town-aerial", kind: "aerial",
  label: "The town from the air",
  focus: "The whole ring at once — which is the only frame that answers whether 21 different grammars sitting on one island read as a TOWN or as a sample book. Look for silhouette variety against the ground and for any two neighbours that read as the same building." });
subjects.push({ id: "downtown", kind: "skyline",
  label: "The downtown skyline",
  focus: "The tower cluster as a skyline: ten distinct tops against the sky. If two crowns read the same from here, the grammars are not doing their job." });
subjects.push({ id: "interior", kind: "interior",
  label: "Inside a dressed building",
  focus: "The island's buildings are ENTERABLE — a front door, a switchback stair to every floor, and the heavy day-room table systems/quake.js puts on each ground floor as earthquake cover (drop, cover, hold on: a bot under that table takes a fraction of the damage). This plate exists because a facade is emitted into the building's own group, so it is the frame that catches ornament intruding through the wall into the room, or a porch beam hanging where a player walks in. The interior should look exactly as it did before the kit touched it.",
});
subjects.push({ id: "street-row", kind: "street",
  label: "Down the street",
  focus: "Eye level in the town, the way a player meets these buildings while running from a disaster. Doors, porches, ground-floor glass and whether the ornament reads at all at 1.7 m." });

async function stageIsland(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  // ---- boot into the island ONCE, then reuse it for every plate -----------
  if (!window.__facIsland) {
    const booted = await until(() => CBZ.game && CBZ.stepSim
      && document.getElementById("playBtn")
      && document.querySelector('[data-mode="survival"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing" && CBZ.game.mode === "survival") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing" && CBZ.game.mode === "survival";
    }, 240000, 300);
    if (!playing) return { ok: false, err: "never reached survival play" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    // Freeze the game's own loop so a plate is a still and not a race with rAF,
    // then step the sim briefly so the sky, sea and shadows settle.
    window.requestAnimationFrame = function () { return 0; };
    await wait(500);
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    window.__facIsland = { ok: true };
  }

  const A = CBZ.surv && CBZ.surv.arena;
  if (!A) return { ok: false, err: "no arena" };
  const camera = CBZ.camera;
  const metrics = {};

  /* Find this plate's subject BY ITS STYLE on the dressed side. The bare side
     carries the same records with facadeStyle already assigned (the flag gates
     the dressing, not the assignment), so both sides find the same building
     and the pair is a true A/B of one wall. */
  let target = null;
  if (input.subject.kind === "building") {
    for (const b of A.fragile) if (b.facadeStyle === input.subject.style) { target = b; break; }
    if (!target) return { ok: false, err: "no building wearing " + input.subject.style };
  }

  // ---- count what this building carries, so the sheet has a cost column ---
  if (target) {
    let boxes = 0, meshes = 0, tris = 0;
    target.group.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      const pos = o.geometry.attributes && o.geometry.attributes.position;
      if (!pos) return;
      const n = pos.count / 24;
      if (Number.isInteger(n) && n >= 1) boxes += n; else meshes += 1;
      tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
    });
    metrics.decoBoxes = Math.round(boxes);
    metrics.realMeshes = meshes;
    metrics.triangles = Math.round(tris);
    metrics.storeys = target.storeys || Math.round(target.h / FH);
  }

  // ---- compose ------------------------------------------------------------
  const locked = input.referenceStage && input.referenceStage.camera;
  let cam;
  if (locked) {
    cam = locked;
  } else if (input.subject.kind === "aerial") {
    // Pulled back past the tallest tower, or the downtown stands between the
    // lens and the town it is supposed to be showing.
    let top = 0;
    for (const b of A.fragile) if (b.h > top) top = b.h;
    const back = Math.max(A.radius * 1.15, top * 3.2);
    cam = { x: A.center.x + back * 0.62, y: Math.max(top * 2.1, 150), z: A.center.z + back * 0.78,
      ax: A.center.x, ay: top * 0.25, az: A.center.z, fov: 44 };
  } else if (input.subject.kind === "skyline") {
    // Solved off the tallest thing standing, from outside the ring, low enough
    // that the crowns are against sky rather than against ground.
    let top = 0, tx = A.center.x, tz = A.center.z;
    for (const b of A.fragile) if (b.h > top) { top = b.h; tx = b.x; tz = b.z; }
    cam = { x: A.center.x - 150, y: top * 0.55, z: A.center.z + 165,
      ax: tx, ay: top * 0.52, az: tz, fov: 34 };
  } else if (input.subject.kind === "interior") {
    /* Stand INSIDE a dressed low-rise building, in the corner away from the
       stairwell (which the arena puts on the -x interior strip), looking back
       across the room at the doorway wall on -z. */
    let b = null;
    for (const o of A.fragile) {
      if (o.facadeStyle && o.h < 12 && o.w > 8 && o.d > 8) { b = o; break; }
    }
    if (!b) for (const o of A.fragile) if (o.facadeStyle && o.h < 12) { b = o; break; }
    if (!b) return { ok: false, err: "no low-rise dressed building" };
    cam = { x: b.x + b.w * 0.30, y: (b.gy || 0) + 1.62, z: b.z + b.d * 0.30,
      ax: b.x - b.w * 0.10, ay: (b.gy || 0) + 1.15, az: b.z - b.d * 0.42, fov: 72 };
  } else if (input.subject.kind === "street") {
    /* Stand in the town at eye height — OUTSIDE. The first pass put the lens
       26 m from a house on a guessed bearing and landed inside a neighbour's
       living room (a table, two chairs and a staircase), because nothing
       checked the standing point against the other footprints. So: try
       bearings around the subject and take the first that is clear of every
       building on the island by a margin. */
    let best = null, bestD = 1e9;
    for (const b of A.fragile) {
      if (!b.facadeStyle || b.h > 14) continue;
      const d = Math.hypot(b.x - A.center.x, b.z - A.center.z);
      if (Math.abs(d - 70) < bestD) { bestD = Math.abs(d - 70); best = b; }
    }
    const b = best || A.fragile[0];
    const clear = (x, z) => {
      for (const o of A.fragile) {
        if (Math.abs(x - o.x) < o.w / 2 + 2.5 && Math.abs(z - o.z) < o.d / 2 + 2.5) return false;
      }
      return true;
    };
    let ex = b.x, ez = b.z + 24, found = false;
    for (let i = 0; i < 24 && !found; i++) {
      const ang = (i / 24) * Math.PI * 2;
      for (const dist of [22, 26, 30]) {
        const cxc = b.x + Math.cos(ang) * dist, czc = b.z + Math.sin(ang) * dist;
        if (clear(cxc, czc)) { ex = cxc; ez = czc; found = true; break; }
      }
    }
    const gy = A.groundHeightAt(ex, ez);
    cam = { x: ex, y: gy + 1.7, z: ez, ax: b.x, ay: (b.gy || 0) + b.h * 0.45, az: b.z, fov: 60 };
  } else {
    /* PER-BUILDING: a three-quarter view solved from this building's own
       footprint and height, swung round to the side the sun is on so the
       relief reads, and lifted with the building so a 22-storey tower and a
       one-storey cottage are both framed whole. */
    const b = target;
    const girth = Math.hypot(b.w, b.d);
    const tall = b.h * 1.45;                       // roof/crown headroom
    const back = Math.max(girth * 1.05 + tall * 0.62 + 9, 17);
    const up = Math.max(tall * 0.42, 5);
    let ox = b.x - A.center.x, oz = b.z - A.center.z;
    const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
    const sw = 0.75;
    const rx = ox * Math.cos(sw) - oz * Math.sin(sw);
    const rz = ox * Math.sin(sw) + oz * Math.cos(sw);
    const ex = b.x + rx * back, ez = b.z + rz * back;
    let ey = (b.gy || 0) + up;
    try { const g = A.groundHeightAt(ex, ez); if (ey < g + 2.2) ey = g + 2.2; } catch (_) {}
    cam = { x: ex, y: ey, z: ez, ax: b.x, ay: (b.gy || 0) + b.h * 0.46, az: b.z, fov: 42 };
  }

  camera.fov = cam.fov || 42;
  camera.aspect = input.width / input.height;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  // The sky dome rides the camera; without this the horizon sits wherever the
  // player was standing when we froze the loop.
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  setHud(false);
  CBZ.renderer.setSize(input.width, input.height, false);
  await wait(60);
  try { CBZ.renderer.render(CBZ.scene, camera); } catch (e) { return { ok: false, err: e.message }; }

  return { ok: true, camera: cam, metrics };
}

export default {
  id: "facade-island",
  title: "Every Facade, Standing on the Survival Island",
  description: "All 31 registered grammars — the twenty commercial and skyline ones, plus the eleven new houses — assigned one per building on Disaster Survival's island town, which is the build that loads in seconds. One plate per facade framed off that building's own record, then the town from the air, the downtown skyline and a street-level look. Before is the same island with the ornament flag off; the buildings, their positions and their heights are identical on both sides because the town plan is read from the facade registry either way.",
  beforeLabel: "BEFORE · PLAIN ISLAND BOXES",
  afterLabel: "AFTER · FACADE KIT ON THE ISLAND",
  viewport: { width: 1200, height: 780 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  defaultBefore: "local",
  beforeParams: { cfg_SURV_FACADES: 0 },
  afterParams: { cfg_SURV_FACADES: 1 },
  stageTimeoutMs: 600000,
  pairNote: "Same island · seed · town plan · tower heights · sun — only cfg_SURV_FACADES differs",
  method: "Both sides boot the real game and enter Disaster Survival through the menu, then freeze requestAnimationFrame and step the sim ~2 s so sky, sea and shadows settle. world/disaster_arena.js builds its own buildings (it does not call cityMakeBuilding), so the kit is given the same ctx buildings.js gives it — the host's real w/d/storeys/FH/rTop plus dbox/plat/column emitters — with dbox collecting geometries per colour and merging once per building, exactly as flushDeco does in the city. Everything lands in the building's own group, so a dressed building still topples as one piece in the earthquake. Which grammar goes where is read from the registry itself: minStoreys means skyline (downtown towers, each built tall enough for its own minimum), everything else is low-rise (the town ring). That assignment happens on BOTH sides — only the dressing is gated — so each plate's before and after are the same building.",
  metricsNote: "decoBoxes is the merged, effectively free cost: boxes folded into one mesh per colour on the building's own group. realMeshes is the cost that is not free — individually minted columns, cones, domes, spheres and lamps — against the kit's ~40 per building budget. triangles is the whole building including the arena's own shell, glass and stairs, which is why the before side is not zero.",
  metrics: {
    decoBoxes: { label: "Merged deco boxes (free)", better: "higher" },
    realMeshes: { label: "Individually minted meshes", unit: "meshes", better: "lower" },
    triangles: { label: "Triangles (whole building)", better: "lower" },
    storeys: { label: "Storeys" },
  },
  subjects,
  stage: stageIsland,
};
