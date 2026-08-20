/* EVERY ANIMAL IS AN INDIVIDUAL — size spread and visible hunger.

   OWNER, verbatim: "all wildlife including sharks should have varying size
   (viable) and varying hunger (visible behavior and movement)".

   IT IS A FLAG A/B, NOT A DEPLOY DIFF. Both sides are THIS checkout and the
   only difference is two query params — `cfg_WILDLIFE_SIZE_VARY=0` and
   `cfg_WILDLIFE_HUNGER=0`, the feature's own one-line reverts. So the BEFORE
   column is literally the old world: every animal of a species at exactly
   sp.scale, and no hunger anywhere. Nothing else can move between the columns.

   IT STAGES THE REAL GAME, not a studio. Every animal photographed here is a
   REGISTERED actor out of CBZ.cityWildlife that the world spawned for itself —
   its size is the size the seed gave it — teleported into a line-up and, for
   the behaviour subjects, driven by CBZ.stepSim, i.e. wildlife.js's own tick.
   A studio that rebuilt the models and applied the sampler by hand would be
   photographing this preset's arithmetic instead of the game's.

   SPECIES ARE RESOLVED BY QUERY, NOT BY NAME. Subjects ask for "the most
   numerous water species" or "a land predator that eats" and the stage picks
   it out of the live registry (with a preference list that is a hint, never a
   requirement). The bestiary is under active edit; a preset that hard-codes
   `tuna` photographs an error page the week somebody renames it.

   ---- WHAT EACH SUBJECT IS FOR --------------------------------------------
     water-lineup / land-lineup / school-lineup
        Ten of ONE species, sorted small to large. The BEFORE column is ten
        identical bodies — that IS the bug — and the AFTER column has to read
        as a spread at a glance, not as a number in a table. The school is the
        control: a schooling species declares a TIGHT spread through its own
        `herd` field, so a bait ball must stay noticeably more uniform than the
        solitary predator does. A "fix" that jitters everything equally fails
        this frame.
     runt-monster
        The smallest individual of a species, the species constant, and the
        biggest, in one frame at one camera. This is the whole feature in a
        single picture, and the middle animal is the old world standing between
        the two new ones.
     hunt-fed-vs-starving
        The hard one, and the reason the preset simulates instead of posing.
        Two lanes, identical geometry: a predator, and its quarry pinned forty
        metres away. One predator is set to hunger 0.02, the other to 0.98, and
        then the SAME twenty-five simulated seconds run in both lanes. In the
        AFTER column the starving lane has closed the gap and the fed lane has
        barely left its mark; in the BEFORE column the two lanes are the same
        picture, because there was no such thing as hunger.
     sea-fed-vs-starving
        The same claim in the water, on the animal the owner named. Two sharks,
        one swimmer each, same seconds — and the metrics carry the two numbers
        the shared hunt driver actually reads off their bundles: the radius at
        which they will engage, and how long they circle before committing.
*/

const subjects = [
  {
    id: "water-lineup",
    kind: "lineup",
    label: "Ten of one sea species, smallest to largest",
    pick: { aquatic: true, prefer: ["great_white_shark", "bull_shark", "tuna", "dolphin"], min: 4 },
    count: 10,
    focus: "Ten REGISTERED animals of one species out of the live world, sorted small to large and lined up at one camera. BEFORE: ten identical bodies — that is the reported bug, and no table is needed to see it. AFTER: a readable spread, with the biggest visibly outgrowing the smallest, and none of them broken.",
    state: "SEA LINE-UP",
  },
  {
    id: "land-lineup",
    kind: "lineup",
    label: "Ten of one land species, smallest to largest",
    pick: { aquatic: false, prefer: ["whitetail_deer", "elk", "caribou", "bison"], min: 4, herd: true },
    count: 10,
    focus: "The same read on land, on a herd species. A herd is where identical bodies are most obvious, because you see a dozen at once — and where the spread has to stay tight enough that the herd still reads as one species.",
    state: "HERD LINE-UP",
  },
  {
    id: "school-lineup",
    kind: "lineup",
    label: "A bait ball — the species that must NOT vary much",
    pick: { aquatic: true, schooling: true, prefer: ["sardine", "fish", "mackerel"], min: 4 },
    count: 10,
    focus: "The control. Spread is a SPECIES TRAIT here, derived from the bestiary's own herd size: a schooling fish is meant to be near-uniform, because that is what schooling looks like. Its spread must be visibly tighter than the solitary predator's, or the feature is just noise applied evenly.",
    state: "SCHOOL · TIGHT BY DESIGN",
  },
  {
    id: "runt-monster",
    kind: "trio",
    label: "Runt · the old constant · the big one",
    pick: { aquatic: true, prefer: ["great_white_shark", "bull_shark", "tuna"], min: 3 },
    focus: "The smallest individual this world grew, the SPECIES CONSTANT in the middle (the old world, forced to exactly sp.scale so it stands in its own comparison), and the largest. One camera, one frame. In the BEFORE column all three are the middle one.",
    state: "RUNT · BASELINE · MONSTER",
  },
  {
    id: "hunt-fed-vs-starving",
    kind: "behaviour",
    label: "Fed vs starving — twenty-five seconds of hunting",
    pick: { aquatic: false, predator: true, prefer: ["gray_wolf", "coyote", "black_bear", "lion"], min: 2 },
    run: 25,
    lane: 40,
    gap: 42,
    focus: "Two identical lanes, twenty-five simulated seconds each, driven by wildlife.js's own tick. Top lane: hunger 0.98. Bottom lane: hunger 0.02. The quarry is pinned so the only variable is the hunter's willingness. The starving one should be ON its deer; the fed one should still be near its mark, because a fed predator does not even look.",
    state: "STARVING (TOP) vs FED (BOTTOM) · t+25s",
  },
  {
    id: "sea-fed-vs-starving",
    kind: "behaviour",
    label: "Fed vs starving in the water",
    pick: { aquatic: true, predator: true, prefer: ["great_white_shark", "bull_shark"], min: 2 },
    run: 25,
    lane: 55,
    gap: 48,
    focus: "The owner named the sharks. Same two lanes, same seconds, in the sea: a starving shark comes for the swimmer and a fed one drifts. The two numbers underneath are read straight off the bundle systems/predator.js actually steers with — the radius it will engage from, and the seconds it circles before it commits.",
    state: "SHARKS · STARVING (TOP) vs FED (BOTTOM)",
  },
];

const readyExpression =
  "window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')";

async function stageSizeHunger(input) {
  const subject = input.subject;
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, every = 250) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (fn()) return true; } catch (_) {} await wait(every); }
    return false;
  };

  // ---- ONE BOOT PER PAGE. Subjects run in declaration order in a single
  // page per side, so the world is booted, frozen and settled exactly once and
  // every subject then borrows the same world. (Re-booting per subject would
  // give each of them a different sea.)
  let S = window.__whStage;
  if (!S) {
    /* GENEROUS ON PURPOSE. This world is a 25 km archipelago and the harness
       runs it on a software rasteriser, often beside other agents' browsers;
       a boot budget tuned on an idle machine is a preset that fails for a
       reason that has nothing to do with the change being photographed. */
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"), 600000, 500);
    if (!booted) return { ok: false, err: "never booted", state: CBZ.game && CBZ.game.state };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    // The button and the function it is bound to, because a headless click can
    // land while the boot meter still holds `bootBusy` and be dropped.
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      if (CBZ.game.state !== "playing" && typeof CBZ.startRunPresented === "function") {
        try { CBZ.startRunPresented(); } catch (_) {}
      }
      return CBZ.game.state === "playing";
    }, 420000, 500);
    if (!playing) return { ok: false, err: "never reached playing", state: CBZ.game && CBZ.game.state };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    // quality 4 = the widest LOD radius, so a subject parked two hundred
    // metres from the player still THINKS. wildlife.js freezes calm animals
    // whose group is hidden, and a frozen fed animal would not be a fair
    // "fed animals do not move" — it would be an animal nobody ticked.
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(4); } catch (_) {}

    // Freeze the render loop; CBZ.stepSim becomes the only clock.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);

    // ONE seeded stream for the whole staging pass. The wander FSM and
    // predator.js's hunt both roll dice; without this the two columns walk
    // different state paths and the comparison stops being about the flag.
    let seed = 0x9e3779b9 >>> 0;
    Math.random = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__whOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f8fc;text-shadow:0 2px 9px #001019;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-read></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__whStage = { overlay, taken: {} };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__whOverlay") continue;
      child.style.visibility = "hidden";
    }
  };
  const label = (name, text, css) => {
    const el = S.overlay.querySelector("[data-" + name + "]");
    if (!el) return;
    el.textContent = text;
    el.style.cssText = css;
  };

  // wildlife.js's matrix LOD stamps matrixAutoUpdate=false on an out-of-range
  // animal. Without re-arming it the mesh renders at its SPAWN transform
  // however far we move the actor — the body silently vanishes from the shot
  // while the numbers stay right.
  const liveMats = (a) => {
    const g = a && a.group; if (!g) return;
    g.matrixAutoUpdate = true;
    g.traverse((o) => { o.matrixAutoUpdate = true; });
    g.visible = true;
    g.updateMatrix(); g.updateMatrixWorld(true);
  };

  const list = (CBZ.cityWildlifeList && CBZ.cityWildlifeList()) || [];
  const alive = list.filter((a) => a && !a.dead && !a.tamed && !a.ridden && !a.external && a.species);

  // ---- SPECIES BY QUERY. The bestiary is under active edit; a preset that
  // names a species photographs an error page the week it is renamed.
  function eats(sp) {
    try { if (CBZ.predatorEats) return !!CBZ.predatorEats(sp); } catch (_) {}
    return (sp.danger || 0) >= 0.5;
  }
  function resolveSpecies(pick) {
    const buckets = {};
    for (const a of alive) {
      const sp = a.species;
      if (!!sp.aquatic !== !!pick.aquatic) continue;
      if (sp.rarity === "legendary") continue;         // exactly one exists; no line-up
      if (pick.predator && !eats(sp)) continue;
      if (pick.herd && !(sp.herd && sp.herd[1] >= 4)) continue;
      const school = !!(sp.herd && sp.herd[1] >= 8);
      if (pick.schooling != null && school !== !!pick.schooling) continue;
      (buckets[sp.id] || (buckets[sp.id] = [])).push(a);
    }
    for (const id of pick.prefer || []) {
      if (buckets[id] && buckets[id].length >= (pick.min || 2)) return { id, actors: buckets[id] };
    }
    let best = null;
    for (const id in buckets) {
      if (buckets[id].length < (pick.min || 2)) continue;
      if (!best || buckets[id].length > best.actors.length) best = { id, actors: buckets[id] };
    }
    return best;
  }

  const found = resolveSpecies(subject.pick || {});
  if (!found) return { ok: false, err: "no species matched " + JSON.stringify(subject.pick) };
  const sp = found.actors[0].species;

  // sorted small -> large, so the frame itself reads as a gradient
  const bySize = found.actors.slice().sort(
    (p, q) => (p._sizeMul || 1) - (q._sizeMul || 1) || (p.pos.x - q.pos.x));

  // model length, for spacing that does not overlap at any size
  function bodyLen(a) {
    const g = a.group;
    if (!g) return 2;
    if (a._whLen == null) {
      try {
        const bb = new T.Box3().setFromObject(g);
        a._whLen = Math.max(0.6, bb.max.x - bb.min.x);
      } catch (_) { a._whLen = 2; }
    }
    return a._whLen;
  }

  // ---- deterministic anchors. Fixed scan order, never Math.random.
  function findWater(minShore, maxShore) {
    const wf = CBZ.waterField;
    if (!wf) return null;
    for (let r = 700; r <= 9000; r += 40) {
      for (let i = 0; i < 96; i++) {
        const ang = (i / 96) * Math.PI * 2;
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const s = wf.shoreAt(x, z);
        if (!(s <= maxShore && s >= minShore)) continue;
        if (!wf.isSurfaceWater(x, z, 0)) continue;
        if (CBZ.waterInlandFactorAt && CBZ.waterInlandFactorAt(x, z) > 0.02) continue;
        return { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)) };
      }
    }
    return null;
  }
  function findLand() {
    // the home anchor of the herd we are photographing: flat-ish, in biome,
    // and identical on both sides because it comes from the same seed.
    const a0 = bySize[Math.floor(bySize.length / 2)];
    return { x: a0.home.x, z: a0.home.z };
  }

  const ref = input.referenceStage || null;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.12; camera.far = 24000;

  function shoot(camPos, camAim) {
    camera.position.set(camPos[0], camPos[1], camPos[2]);
    camera.lookAt(camAim[0], camAim[1], camAim[2]);
    camera.updateProjectionMatrix();
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    hideHud();
    CBZ.renderer.setSize(input.width, input.height, false);
    CBZ.renderer.render(CBZ.scene, camera);
  }

  // spread over the staged animals only — this describes the FRAME, which is
  // what the reader is looking at, not the whole world
  function spreadOf(actors) {
    let n = 0, mn = Infinity, mx = -Infinity, sum = 0, sq = 0, big = 0;
    let hpMn = Infinity, hpMx = -Infinity;
    for (const a of actors) {
      const k = a._sizeMul > 0 ? a._sizeMul : 1;
      n++; sum += k; sq += k * k;
      if (k < mn) mn = k; if (k > mx) mx = k;
      if (a._bigOne) big++;
      const hp = a.maxHp || 0;
      if (hp < hpMn) hpMn = hp; if (hp > hpMx) hpMx = hp;
    }
    const mean = n ? sum / n : 0;
    const r3 = (v) => (Number.isFinite(v) ? Number(v.toFixed(3)) : 0);
    return {
      sizeMin: r3(n ? mn : 0), sizeMax: r3(n ? mx : 0),
      sizeStd: r3(n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0),
      sizeRange: r3(n ? mx - mn : 0),
      biggestOverSmallest: r3(n && mn > 0 ? mx / mn : 1),
      bigOnes: big,
      hpMin: Math.round(n ? hpMn : 0), hpMax: Math.round(n ? hpMx : 0),
    };
  }

  const sideBadge = (before) => {
    label("side", before ? input.beforeLabel : input.afterLabel,
      `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`);
  };
  const chrome = (read) => {
    sideBadge(input.side === "before");
    label("name", (sp.name || found.id) + " — " + subject.label,
      "position:absolute;top:64px;left:26px;font-size:25px;font-weight:800;letter-spacing:-.02em");
    label("focus", subject.focus,
      "position:absolute;top:100px;left:28px;color:#c3d4de;font-size:13px;font-weight:550;max-width:760px;line-height:1.35");
    label("state", subject.state,
      `position:absolute;right:26px;top:25px;color:${input.side === "before" ? "#ffb0b0" : "#7ff0bb"};font-size:11px;font-weight:900;letter-spacing:.1em`);
    label("read", read,
      "position:absolute;right:26px;top:52px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;white-space:pre;text-align:right");
    label("source", new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname,
      "position:absolute;bottom:20px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace");
  };

  // ============================================================
  //  LINE-UP / TRIO — pose only, no simulation. The animals are placed in a
  //  row along the camera's across-screen axis, every one of them broadside,
  //  and the camera is pulled back far enough to hold the whole row.
  // ============================================================
  if (subject.kind === "lineup" || subject.kind === "trio") {
    let cast;
    if (subject.kind === "trio") {
      cast = [bySize[0], bySize[Math.floor(bySize.length / 2)], bySize[bySize.length - 1]];
      // THE MIDDLE ONE IS THE OLD WORLD. Forced to exactly sp.scale so the
      // baseline stands inside its own comparison rather than being described.
      const mid = cast[1];
      mid.group.scale.setScalar(sp.scale || 1);
      mid._whBaseline = true;
    } else {
      cast = bySize.slice(0, subject.count || 10);
    }
    if (!cast.length || cast.indexOf(undefined) >= 0) return { ok: false, err: "empty cast" };

    const anchor = (ref && ref.anchor) || (sp.aquatic ? findWater(-4000, -400) : findLand());
    if (!anchor) return { ok: false, err: "no anchor" };

    let span = 0;
    for (const a of cast) span = Math.max(span, bodyLen(a));
    const step = span * 1.30;
    const half = (cast.length - 1) * step * 0.5;

    // The row runs along Z (across the screen); every animal faces +Z, so its
    // long axis lies across the frame and adjacent bodies do not overlap.
    const surf = sp.aquatic && CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(anchor.x, anchor.z) : 0;
    for (let i = 0; i < cast.length; i++) {
      const a = cast[i], g = a.group;
      const z = anchor.z - half + i * step;
      const draft = a.swimDepth || 1;
      const y = sp.aquatic ? surf - draft : (CBZ.floorAt ? CBZ.floorAt(anchor.x, z) : 0);
      g.position.set(anchor.x, y, z);
      a.home.x = anchor.x; a.home.z = z;
      a.heading = Math.PI / 2; a.faceH = Math.PI / 2;
      if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(g, a.heading);
      g.rotation.x = 0; g.rotation.z = 0;
      if (a._waterMove) { a._waterMove.x = anchor.x; a._waterMove.z = z; }
      liveMats(a);
    }

    // pull back far enough to hold the row, with a shallow down-tilt so the
    // bodies separate instead of stacking on one horizon line
    const rowW = (cast.length - 1) * step + span;
    const dist = Math.max(span * 3, (rowW * 0.62) / Math.tan((camera.fov * Math.PI / 180) * 0.5) * 0.62);
    const eye = sp.aquatic ? surf - (cast[0].swimDepth || 1) + span * 0.22 : span * 0.7;
    const camPos = (ref && ref.camera) ? ref.camera.position.slice()
      : [anchor.x - dist, eye + span * 0.35, anchor.z];
    const camAim = (ref && ref.camera) ? ref.camera.target.slice()
      : [anchor.x, sp.aquatic ? surf - (cast[0].swimDepth || 1) : span * 0.28, anchor.z];
    // park the player at the camera so any depth/LOD pass centres here
    if (CBZ.player && CBZ.player.pos) {
      CBZ.player.pos.x = camPos[0]; CBZ.player.pos.z = camPos[2]; CBZ.player.pos.y = camPos[1];
      if (sp.aquatic) CBZ.player._swim = true;
    }
    shoot(camPos, camAim);

    const m = spreadOf(cast);
    chrome(
      `size ${m.sizeMin.toFixed(2)} .. ${m.sizeMax.toFixed(2)}  (x${m.biggestOverSmallest.toFixed(2)})\n` +
      `stddev ${m.sizeStd.toFixed(3)} · hp ${m.hpMin}..${m.hpMax}`);

    return {
      ok: true, kind: subject.kind, species: found.id, n: cast.length,
      anchor, camera: { position: camPos.slice(), target: camAim.slice() },
      world: CBZ.wildlifeTraitAudit ? CBZ.wildlifeTraitAudit(found.id) : null,
      metrics: m,
    };
  }

  // ============================================================
  //  BEHAVIOUR — two lanes, identical geometry, the SAME simulated seconds.
  //  Only the hunger differs, and in the BEFORE column not even that (the flag
  //  is off, so both lanes are the same animal and the two halves of the frame
  //  are the same picture — which is the point being made).
  // ============================================================
  const preyPick = { aquatic: !!sp.aquatic, prefer: [], min: 2, predator: false };
  const preyFound = (function () {
    const buckets = {};
    for (const a of alive) {
      const s2 = a.species;
      if (!!s2.aquatic !== !!sp.aquatic) continue;
      if (s2.id === sp.id || s2.rarity === "legendary") continue;
      if (eats(s2)) continue;
      (buckets[s2.id] || (buckets[s2.id] = [])).push(a);
    }
    let best = null;
    for (const id in buckets) {
      if (buckets[id].length < 2) continue;
      if (!best || buckets[id].length > best.length) best = buckets[id];
    }
    return best;
  })();

  const hunters = [bySize[Math.floor(bySize.length * 0.5)], bySize[Math.floor(bySize.length * 0.5) + 1] || bySize[0]];
  if (!hunters[0] || !hunters[1] || hunters[0] === hunters[1]) return { ok: false, err: "need two hunters" };

  const anchor = (ref && ref.anchor) ||
    (sp.aquatic ? findWater(-4000, -600) : { x: hunters[0].home.x, z: hunters[0].home.z });
  if (!anchor) return { ok: false, err: "no anchor" };
  const surf = sp.aquatic && CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(anchor.x, anchor.z) : 0;
  const laneZ = [anchor.z - subject.lane * 0.5, anchor.z + subject.lane * 0.5];
  const gap = subject.gap || 42;

  // ---- lane set-up. Both lanes are geometrically identical; the ONLY thing
  // that differs is the hunger the traits file is told to hold.
  const HUNGERS = [0.98, 0.02];
  const marks = [];
  const quarry = [];
  for (let L = 0; L < 2; L++) {
    const h = hunters[L], g = h.group;
    const y0 = sp.aquatic ? surf - (h.swimDepth || 1) : (CBZ.floorAt ? CBZ.floorAt(anchor.x, laneZ[L]) : 0);
    g.position.set(anchor.x, y0, laneZ[L]);
    g.rotation.x = 0; g.rotation.z = 0;
    h.home.x = anchor.x; h.home.z = laneZ[L];
    h.heading = 0; h.faceH = 0;
    h.state = "wander"; h.stateT = 0; h.alarm = 0;
    h._satT = 0; h._prey = null; h._feedT = 0; h._huntSt = null;
    if (h._waterMove) { h._waterMove.x = anchor.x; h._waterMove.z = laneZ[L]; }
    if (CBZ.wildlifeSetHunger) CBZ.wildlifeSetHunger(h, HUNGERS[L]);
    liveMats(h);
    marks.push({ x: anchor.x, z: laneZ[L] });

    // the quarry, PINNED. Forty metres straight ahead in both lanes, held in
    // place every step so the only variable measured is the hunter's own
    // willingness to close — not how well the deer ran.
    if (preyFound && preyFound[L]) {
      const p = preyFound[L], pg = p.group;
      const py = sp.aquatic ? surf - (p.swimDepth || 1) : (CBZ.floorAt ? CBZ.floorAt(anchor.x + gap, laneZ[L]) : 0);
      pg.position.set(anchor.x + gap, py, laneZ[L]);
      p.home.x = anchor.x + gap; p.home.z = laneZ[L];
      p.heading = 0; p.faceH = 0; p.state = "graze"; p.stateT = 999; p.alarm = 0;
      p._huntedBy = null;
      if (p._waterMove) { p._waterMove.x = anchor.x + gap; p._waterMove.z = laneZ[L]; }
      liveMats(p);
      quarry.push(p);
    } else quarry.push(null);
  }

  // For the SEA lanes the quarry is the SWIMMER: wildlife.js hands a shark to
  // CBZ.sharkBrain, which hunts the player and not a fish, so a pinned mackerel
  // would measure nothing. The player is parked between the two lanes at the
  // same forward offset, which is exactly one swimmer for two sharks.
  const P = CBZ.player && CBZ.player.pos;
  const playerAt = sp.aquatic
    ? { x: anchor.x + gap, z: anchor.z }
    : { x: anchor.x - 210, z: anchor.z };
  const pinPlayer = () => {
    if (!P) return;
    P.x = playerAt.x; P.z = playerAt.z;
    P.y = sp.aquatic ? (CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.x, P.z) - 0.3 : -0.8)
                     : (CBZ.floorAt ? CBZ.floorAt(P.x, P.z) + 1.6 : 1.6);
    if (sp.aquatic) CBZ.player._swim = true;
    CBZ.player.hp = 100;
  };
  pinPlayer();

  const travel = [0, 0];
  const prev = [
    { x: hunters[0].group.position.x, z: hunters[0].group.position.z },
    { x: hunters[1].group.position.x, z: hunters[1].group.position.z },
  ];
  const steps = Math.round((subject.run || 25) * 60);
  for (let i = 0; i < steps; i++) {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    pinPlayer();
    for (let L = 0; L < 2; L++) {
      const q = quarry[L];
      if (q && !q.dead) { q.group.position.x = anchor.x + gap; q.group.position.z = laneZ[L]; }
      // hold the hunger where the subject put it: it drifts on the clock, and
      // twenty-five seconds of drift would blur the two lanes together.
      if (CBZ.wildlifeSetHunger) hunters[L].hunger = HUNGERS[L];
    }
    CBZ.stepSim(1 / 60);
    for (let L = 0; L < 2; L++) {
      const g = hunters[L].group;
      travel[L] += Math.hypot(g.position.x - prev[L].x, g.position.z - prev[L].z);
      prev[L].x = g.position.x; prev[L].z = g.position.z;
    }
  }

  // ---- read the two lanes off the live actors and their live hunt bundles
  function kitOf(h) {
    return (h._shark && h._shark.opts) || h._landHunt || h._preyHunt || null;
  }
  function gapOf(L) {
    const g = hunters[L].group;
    const t = sp.aquatic ? playerAt : { x: anchor.x + gap, z: laneZ[L] };
    return Math.hypot(g.position.x - t.x, g.position.z - t.z);
  }
  const kits = [kitOf(hunters[0]), kitOf(hunters[1])];
  const r2 = (v) => (Number.isFinite(v) ? Number(v.toFixed(2)) : 0);

  // ---- the camera: straight down over both lanes, so the two geometries are
  // one picture. Both lanes started on the same mark with the same gap ahead.
  const midX = anchor.x + gap * 0.35;
  const up = Math.max(48, subject.lane * 1.5 + gap * 0.9);
  const camPos = (ref && ref.camera) ? ref.camera.position.slice()
    : [midX - up * 0.42, (sp.aquatic ? surf : (CBZ.floorAt ? CBZ.floorAt(midX, anchor.z) : 0)) + up, anchor.z];
  const camAim = (ref && ref.camera) ? ref.camera.target.slice()
    : [midX, sp.aquatic ? surf - 2 : (CBZ.floorAt ? CBZ.floorAt(midX, anchor.z) : 0), anchor.z];
  shoot(camPos, camAim);

  const metrics = {
    starvingTravelM: r2(travel[0]), fedTravelM: r2(travel[1]),
    starvingGapM: r2(gapOf(0)), fedGapM: r2(gapOf(1)),
    starvingCommitR: r2(kits[0] && kits[0].senseR), fedCommitR: r2(kits[1] && kits[1].senseR),
    starvingPatienceS: r2(kits[0] && kits[0].circleT), fedPatienceS: r2(kits[1] && kits[1].circleT),
    travelRatio: r2(travel[1] > 0.01 ? travel[0] / travel[1] : (travel[0] > 0.01 ? 99 : 1)),
  };
  chrome(
    `travelled  starving ${metrics.starvingTravelM}m · fed ${metrics.fedTravelM}m\n` +
    `gap left   starving ${metrics.starvingGapM}m · fed ${metrics.fedGapM}m\n` +
    `commit at  starving ${metrics.starvingCommitR}m · fed ${metrics.fedCommitR}m`);

  return {
    ok: true, kind: "behaviour", species: found.id,
    quarry: quarry[0] ? quarry[0].species.id : (sp.aquatic ? "player" : null),
    anchor, camera: { position: camPos.slice(), target: camAim.slice() },
    lanes: [
      { hunger: HUNGERS[0], state: hunters[0]._huntSt || hunters[0].state },
      { hunger: HUNGERS[1], state: hunters[1]._huntSt || hunters[1].state },
    ],
    world: CBZ.wildlifeTraitAudit ? CBZ.wildlifeTraitAudit() : null,
    metrics,
  };
}

export default {
  id: "wildlife-size-hunger",
  title: "Wildlife — individual size and visible hunger",
  description:
    "Every animal of a species used to be exactly sp.scale and no wild animal carried a hunger value at " +
    "all. Photographed against this same checkout with the feature's own two one-line reverts " +
    "(cfg_WILDLIFE_SIZE_VARY=0, cfg_WILDLIFE_HUNGER=0). Line-ups of ten registered animals show the " +
    "size spread — and show that a schooling species stays deliberately tighter than a solitary " +
    "predator; a runt/baseline/monster trio puts the old world between the two new extremes; and two " +
    "simulated lanes run wildlife.js's own tick for twenty-five seconds to show a starving hunter " +
    "closing on prey a fed one will not even look at.",
  defaultBefore: "local",
  beforeLabel: "BEFORE — no size spread, no hunger (this checkout, flags off)",
  afterLabel: "AFTER — this checkout",
  urlParams: { seed: "90210" },
  beforeParams: { cfg_WILDLIFE_SIZE_VARY: "0", cfg_WILDLIFE_HUNGER: "0" },
  viewport: { width: 1200, height: 660 },
  stageTimeoutMs: 1200000,
  subjects,
  readyExpression,
  stage: stageSizeHunger,
  metricsNote:
    "Size numbers are the individual multipliers of the animals IN THAT FRAME (1.00 = the species " +
    "constant), read off the live actors. The behaviour numbers come from wildlife.js's own tick run " +
    "for twenty-five simulated seconds per lane with the quarry pinned, and commit/patience are read " +
    "straight off the bundle systems/predator.js steers with. Every animal is a registered actor the " +
    "world spawned for itself — nothing here is posed by the preset except where it stands.",
  metrics: {
    sizeMin: { label: "Smallest in frame", unit: "x species", better: "lower" },
    sizeMax: { label: "Largest in frame", unit: "x species", better: "higher" },
    sizeStd: { label: "Size spread (stddev)", unit: "x species", better: "higher" },
    sizeRange: { label: "Largest minus smallest", unit: "x species", better: "higher" },
    biggestOverSmallest: { label: "Biggest / smallest", unit: "ratio", better: "higher" },
    bigOnes: { label: "Monster-tail specimens", unit: "animals", better: "higher" },
    hpMin: { label: "Weakest in frame", unit: "hp", better: "lower" },
    hpMax: { label: "Toughest in frame", unit: "hp", better: "higher" },
    starvingTravelM: { label: "Starving — metres travelled", unit: "m/25s", better: "higher" },
    fedTravelM: { label: "Fed — metres travelled", unit: "m/25s", better: "lower" },
    travelRatio: { label: "Starving / fed travel", unit: "ratio", better: "higher" },
    starvingGapM: { label: "Starving — gap left to quarry", unit: "m", better: "lower" },
    fedGapM: { label: "Fed — gap left to quarry", unit: "m", better: "higher" },
    starvingCommitR: { label: "Starving — engages from", unit: "m", better: "higher" },
    fedCommitR: { label: "Fed — engages from", unit: "m", better: "lower" },
    starvingPatienceS: { label: "Starving — circles before commit", unit: "s", better: "lower" },
    fedPatienceS: { label: "Fed — circles before commit", unit: "s", better: "higher" },
  },
};
