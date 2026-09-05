/* Prison heritage lineup for ba / tools/visual-compare.mjs.

   OWNER (2026-09-05): "i want different races in the jail game show me 10
   differnt races … black latino asian white (add tattoos especially for white
   nationalists) indian, etc etc" — men only.

   Boots the REAL escape mode (so the wardrobe, the atlas cache and the live
   crowd all exist exactly as in play), freezes the rAF loop, then photographs
   two things:

     THE LINEUP (studio pages) — for each of the ten heritages in
     entities/heritage.js, four men rolled from that heritage's own tables,
     built with CBZ.makeCharacter and dressed through the SAME
     CBZ.cityRecolorRig seam systems/prisonoutfits.js uses on the yard. They
     stand against a lineup wall in a scene of their own so no prop, guard or
     lamp post can wander into the proof. Close-ups follow for the ink.

     THE YARD (world pages) — the live north yard with the real crowd, so the
     integration is visible: the men who walk the game are the men on the
     lineup pages.

   BEFORE side: entities/heritage.js does not exist there, so the lineup
   falls back to what the game had — the old 8-skin / 8-hair roll, no facial
   hair, no ink, every man in the zipped coverall. That IS the before. */

const HER = [
  ["black", "Black"], ["white", "White"], ["skinhead", "White-power crew"], ["latino", "Latino"],
  ["eastasian", "East Asian"], ["southasian", "South Asian (Indian)"], ["mideast", "Middle Eastern"],
  ["native", "Native American"], ["islander", "Pacific Islander"], ["easteuro", "Eastern European"],
];

const subjects = [];
for (const [id, name] of HER) {
  subjects.push({
    id: "lineup-" + id, label: name + " — four men", studio: true, heritage: id, count: 4, view: "lineup",
    focus: "Four men rolled from the " + name + " tables: a skin RANGE (not one hex), that heritage's hair colours and cuts, facial-hair odds, tattoo odds, and the jumpsuit tied at the waist so bare arms show the ink. Before: one of eight tints, same face, zipped coverall.",
  });
}
subjects.push(
  { id: "ink-skinhead-head", label: "White-power crew — head and neck ink, close", studio: true, heritage: "skinhead", count: 2, view: "head",
    over: { bald: true, ink: "skinhead", tank: true, beard: "goatee" },
    focus: "The heaviest set in the game at conversational range: the throat block with script through it, the mark under the eye, temple bars and the bolt behind the ear, the nape crest. Shaved head, goatee, tank." },
  { id: "ink-skinhead-arms", label: "White-power crew — the blackwork sleeve", studio: true, heritage: "skinhead", count: 2, view: "arms",
    over: { ink: "skinhead", tank: true },
    focus: "Both arms bare: solid bands, the elbow web, the wrist block. The ink lives in the shared clothes atlas keyed by skin + ink set, so it costs one canvas per combination, not one per man." },
  { id: "ink-latino-arms", label: "Latino — chicano script, teardrop, three dots", studio: true, heritage: "latino", count: 2, view: "arms",
    over: { ink: "chicano", tank: true, hairStyle: "buzz", bald: false, beard: "goatee" },
    focus: "Fine script down the forearm, a motif high on the upper arm, throat script, three dots by the eye." },
  { id: "ink-islander-vory", label: "Islander tribal bands · Eastern European stars", studio: true, mixed: [["islander", { ink: "tribal", tank: true }], ["easteuro", { ink: "vory", tank: true, bald: true }]], count: 2, view: "arms",
    focus: "Two more ink cultures side by side: thick curved Polynesian bands on the left; the shoulder star and forearm rings of the Russian prison tradition on the right." },
  { id: "yard-live", label: "The yard — the live population, mustered", studio: false,
    cam: { x: 27, y: 13, z: 47, ax: -6, ay: 1, az: 18 }, act: { hour: 9, secs: 2.5, muster: true },
    focus: "The men who actually walk the game. Read for variety at yard distance: skin range, shaved heads and beards, tank tops with inked arms among the zipped coveralls. The metrics row counts the live population." },
  { id: "yard-close", label: "The yard — among the men", studio: false,
    cluster: { dist: 6, height: 1.75, aimY: 1.35 }, act: { hour: 9, secs: 0.5, muster: true },
    focus: "Eye level in the yard. Faces, beards and neck ink at the distance the player actually sees them." },
);

export async function stageHeritage(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__heritageSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="escape"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    // let prisonoutfits' 0.30 s adoption tick dress the whole crowd
    for (let i = 0; i < 150; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    // ---- the studio: a lineup wall, a floor, flat friendly light ----------
    const studio = new T.Scene();
    studio.background = new T.Color(0x5c6065);
    const wallMat = new T.MeshLambertMaterial({ color: 0x6e7176 });
    const wall = new T.Mesh(new T.BoxGeometry(14, 4, 0.2), wallMat); wall.position.set(0, 2, -0.9); studio.add(wall);
    const floor = new T.Mesh(new T.BoxGeometry(14, 0.2, 8), new T.MeshLambertMaterial({ color: 0x5f6266 })); floor.position.set(0, -0.1, 2); studio.add(floor);
    const lineMat = new T.MeshLambertMaterial({ color: 0x3a3d41 });
    for (let h = 0.4; h <= 2.2; h += 0.2) {           // the height lines every 20 cm
      const l = new T.Mesh(new T.BoxGeometry(14, 0.012, 0.02), lineMat); l.position.set(0, h, -0.79); studio.add(l);
    }
    // the game renderer runs its own exposure; the first run at 0.80/0.85 was a
    // whiteout — skin, tank and ink all bleached. Lit to read, not to glow.
    studio.add(new T.AmbientLight(0xffffff, 0.34));
    const key = new T.DirectionalLight(0xffffff, 0.50); key.position.set(1.5, 4, 5); studio.add(key);
    const rim = new T.DirectionalLight(0xbfd4ff, 0.18); rim.position.set(-2, 2, -2); studio.add(rim);
    const cam = new T.PerspectiveCamera(30, 16 / 10, 0.05, 60);
    S = window.__heritageSeq = { studio, cam, rigs: [], mode: "world", looks: [] };

    window.__cbzVisualCompare = {
      render() {
        try {
          const r = CBZ.renderer;
          r.setSize(r.domElement.clientWidth || r.domElement.width, r.domElement.clientHeight || r.domElement.height, false);
          if (S.mode === "studio") {
            S.cam.aspect = r.domElement.width / r.domElement.height; S.cam.updateProjectionMatrix();
            r.render(S.studio, S.cam);
          } else r.render(CBZ.scene, CBZ.camera);
        } catch (_) {}
      },
    };
  }

  const subject = input.subject;
  hideHud();

  // ---- the LOOK of a man: the after side rolls a heritage, the before side
  //      rolls the game's old two pools (what the yard actually had) --------
  const BASE = { legs: 0xff7a1a, torso: 0xff7a1a, collar: 0xff9747, arms: 0xff7a1a, stripes: 0xc85c00, shoes: 0x2b2b2b };
  const OLD_SKIN = [0xf0c39a, 0xe8b58c, 0xc08a5a, 0x8a5a3a, 0x6b4a32, 0xd8a177, 0xe7b58c, 0xb5825a];
  const OLD_HAIR = [0x2a2018, 0x4a3526, 0x101820, 0xb9b1a6, 0x7a4a2e, 0x222222, 0xdedede, 0x3a1f12];
  function lookFor(heritage, over, seedStr) {
    if (CBZ.heritageRoll) return Object.assign({}, BASE, CBZ.heritageRoll(heritage, seedStr, over));
    let s = 0x4a1f7b ^ [...seedStr].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
    const rr = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    return Object.assign({}, BASE, { skin: OLD_SKIN[(rr() * 8) | 0], hair: OLD_HAIR[(rr() * 8) | 0] });
  }
  function dressLook(ch, look) {
    if (CBZ.heritageApply && look.heritage) CBZ.heritageApply(ch, look);
    const cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null;
    const id = look.tank && cat && cat.inmate_tank ? "inmate_tank" : "inmate";
    const rec = cat && cat[id];
    if (rec && CBZ.cityRecolorRig) CBZ.cityRecolorRig(ch, rec.colors, rec);
    if (ch.skinSlots && ch.skinSlots.stripes) for (const st of ch.skinSlots.stripes) if (st) st.visible = false;
    ch._prisonOutfitKey = id;
    return id;
  }

  // clear the previous lineup
  for (const r of S.rigs) S.studio.remove(r.group);
  S.rigs = []; S.looks = [];

  let ticks = 0, totalMs = 0;
  if (subject.studio) {
    S.mode = "studio";
    const n = subject.count || 4;
    const gap = subject.view === "lineup" ? 1.25 : 1.1;
    for (let i = 0; i < n; i++) {
      let her = subject.heritage, over = subject.over || null;
      if (subject.mixed) { her = subject.mixed[i % subject.mixed.length][0]; over = subject.mixed[i % subject.mixed.length][1]; }
      const look = lookFor(her, over, subject.id + "#" + i);
      const ch = CBZ.makeCharacter(look);
      ch.group.userData.dynamic = true;
      ch.group.position.set((i - (n - 1) / 2) * gap, 0, 0.6);
      // the rig faces +Z as built (measured: the first run with a half-turn
      // photographed sixteen napes) — the lens sits on +Z, so no turn.
      S.studio.add(ch.group);
      ch.group.updateMatrixWorld(true);
      look.fit = dressLook(ch, look);
      S.rigs.push(ch); S.looks.push(look);
    }
    // arms out a little on the ink pages so both sleeves read
    if (subject.view === "arms") for (const ch of S.rigs) {
      try { const p = ch.parts; p.la.rotation.z = 0.55; p.ra.rotation.z = -0.55; p.la.rotation.x = -0.35; p.ra.rotation.x = -0.35; } catch (_) {}
    }
    for (const ch of S.rigs) ch.group.updateMatrixWorld(true);
    const c = S.cam;
    if (subject.view === "lineup") { c.position.set(0, 1.05, 7.4); c.lookAt(0, 1.0, 0.6); }
    else if (subject.view === "head") { c.position.set(0.15, 1.62, 2.35); c.lookAt(0, 1.55, 0.6); }
    else { c.position.set(0, 1.25, 3.4); c.lookAt(0, 1.15, 0.6); }
  } else {
    S.mode = "world";
    const act = subject.act || {};
    // YARD TIME. The run starts at lights-out (the second run's densest cluster
    // was a cell aisle). core/daynight.js's clock is a setter: 0 = sunrise 06:00,
    // so 09:00 is 0.125 — the schedule's "Morning Yard" block — and the men are
    // then walked out of the house for `act.secs` of simulated time.
    if (act.hour != null && CBZ.dayPhase && !S.yardTime) { CBZ.dayPhase(((act.hour - 6) / 24 + 1) % 1); S.yardTime = true; }
    // MUSTER. A portrait of the population, not a movement test: the men's
    // far-LOD brains crawl when the lens is 100 m off, so 75 s of walking left
    // three of sixty in the open (measured). Stand every live inmate in the
    // north yard on a seeded scatter, then let the sim settle them.
    if (act.muster && !S.mustered) {
      let sd = 0x51ac; const rr = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
      for (const n of CBZ.npcs || []) {
        if (!n || !n.group || n.dead || n._crowd) continue;
        const x = -18 + rr() * 36, z = 10 + rr() * 34;
        n.group.position.set(x, 0, z);
        if (n.target && n.target.set) n.target.set(x + (rr() - 0.5) * 3, 0, z + (rr() - 0.5) * 3);
        n.pause = 0.5 + rr() * 3;
      }
      CBZ.camera.position.set(0, 12, 28);     // near-LOD for everyone while they settle
      S.mustered = true;
    }
    const nTicks = Math.round((act.secs || 0) * 60);
    for (let i = 0; i < nTicks; i++) {
      // hold the clock at yard time: the sim day is short enough that 75 s
      // of walking ran 09:00 into chow and emptied the yard again (measured)
      if (act.hour != null && CBZ.dayPhase && (i % 30) === 0) CBZ.dayPhase(((act.hour - 6) / 24 + 1) % 1);
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now(); CBZ.stepSim(1 / 60); totalMs += performance.now() - t0; ticks++;
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
    }
    // AIM AT THE MEN, NOT AT A SPOT. The first run's fixed tripod photographed
    // an empty walkway: at sim start the crowd is wherever the schedule put it.
    // Find the densest cluster of live inmates and shoot that from `dist` away.
    let cam = subject.cam;
    if (subject.cluster) {
      // only men in the open (the cell house sits at z < -8)
      const pts = (CBZ.npcs || []).filter((n) => n && n.group && n.group.position.z > -6).map((n) => n.group.position);
      let best = null, bestN = -1;
      for (const p of pts) {
        let k = 0;
        for (const q of pts) { const dx = p.x - q.x, dz = p.z - q.z; if (dx * dx + dz * dz < 64) k++; }
        if (k > bestN) { bestN = k; best = p; }
      }
      if (best) {
        // stand between the cluster and the open middle of the north yard
        // (0, 28), so the lens is on open ground and not in a fence or a wall
        const d = subject.cluster.dist, h = subject.cluster.height;
        let dx = 0 - best.x, dz = 28 - best.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        cam = { x: best.x + dx * d, y: h, z: best.z + dz * d, ax: best.x, ay: subject.cluster.aimY, az: best.z };
      }
    }
    if (cam) {
      CBZ.camera.position.set(cam.x, cam.y, cam.z);
      CBZ.camera.lookAt(cam.ax, cam.ay, cam.az);
      CBZ.camera.updateMatrixWorld(true);
      try { if (CBZ.skyDome && CBZ.skyDome.parent) CBZ.skyDome.parent.position.copy(CBZ.camera.position); } catch (_) {}
    }
  }

  // ---- metrics: the census of whoever is on the page ----------------------
  const rows = subject.studio ? S.rigs : (CBZ.npcs || []).map((n) => n && n.char).filter(Boolean);
  const census = CBZ.heritageCensus ? CBZ.heritageCensus(rows) : null;
  const skins = {};
  let bearded = 0, inked = 0, bald = 0, tank = 0;
  for (const ch of rows) {
    if (!ch) continue;
    if (ch.skinTone != null) skins[ch.skinTone] = 1;
    if (ch.skinSlots && ch.skinSlots.beard && ch.skinSlots.beard.length) bearded++;
    if (ch.ink) inked++;
    if (ch.skinSlots && ch.skinSlots.hair && !ch.skinSlots.hair.length && !(ch.skinSlots.cap && ch.skinSlots.cap.length && ch.skinSlots.cap[0].visible)) bald++;
    if (ch._prisonOutfitKey === "inmate_tank") tank++;
  }
  const metrics = {
    men: rows.length,
    distinctSkins: Object.keys(skins).length,
    bearded, inked, bald, tank,
    heritages: census ? Object.keys(census.byHeritage).length : 0,
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
  };
  window.__cbzVisualCompare.metrics = () => metrics;
  // world-page probe: who is actually in CBZ.npcs (named/crowd/mass-crowd pool)
  let probe = null;
  if (!subject.studio) {
    const all = CBZ.npcs || [];
    let pool = 0, poolLive = 0, her = 0, beard = 0, fem = 0, sample = [], noHer = [];
    for (const n of all) {
      if (!n || !n.char) continue;
      if (n._crowd) { pool++; if (!n.dead) poolLive++; }
      if (n.char.heritage) her++; else if (noHer.length < 10) noHer.push([n.data && n.data.name, n.kind, n.role, n.prisonOutfit]);
      if (n.char.skinSlots && n.char.skinSlots.beard && n.char.skinSlots.beard.length) beard++;
      if (n.char.profile && n.char.profile.fem) fem++;
      if (sample.length < 6) sample.push([n.data && n.data.name, !!n._crowd, n.dead, n.char.heritage || null, n.char.skinTone, Number(n.group.position.x.toFixed(1)), Number(n.group.position.z.toFixed(1))]);
    }
    probe = { total: all.length, pool, poolLive, her, beard, fem, hour: CBZ.prisonSchedule ? CBZ.prisonSchedule.hour() : null, block: CBZ.prisonSchedule ? CBZ.prisonSchedule.id() : null, mass: CBZ.ambient ? CBZ.ambient.total : null, sample, noHer };
  }
  return { ok: true, probe, looks: S.looks.map((l) => ({ h: l.heritage, skin: l.skin, hair: l.hairStyle, bald: !!l.bald, beard: l.beard || null, ink: l.ink || "", fit: l.fit })), metrics };
}

export default {
  id: "prison-heritage",
  title: "Prison: who is in the yard — ten heritages",
  description: "Ten heritages, four men each, built and dressed through the live wardrobe; ink close-ups; then the real north yard crowd. The before side is the old eight-tint roll with no facial hair and no ink.",
  beforeLabel: "BEFORE · one palette",
  afterLabel: "AFTER · ten heritages",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "Counts are over the men on the page: the four on a lineup page, the whole live crowd on the yard pages.",
  metrics: {
    men: { label: "Men on the page" },
    distinctSkins: { label: "Distinct skin tones", better: "higher" },
    heritages: { label: "Heritages present", better: "higher" },
    bearded: { label: "Facial hair" },
    inked: { label: "Tattooed" },
    bald: { label: "Shaved heads" },
    tank: { label: "Top tied at the waist" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
  },
  subjects,
  stage: stageHeritage,
};
