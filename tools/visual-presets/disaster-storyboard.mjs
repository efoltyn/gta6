/* THE WHOLE DISASTER GAME, ONE STORYBOARD (tools/visual-compare.mjs / ba).

   Every disaster in Disaster Survival, four beats each (warning, onset, peak,
   aftermath), plus island overviews and one HUD shot of the spectator after
   death. One seeded match per build, the director forced through the same arc
   with CBZ.disasters.force(id), the rAF loop frozen and CBZ.stepSim as the
   only clock, so both sides are photographed at the same simulated seconds
   of the same disaster phase.

   BUILD-AGNOSTIC BY CONSTRUCTION. This has to work on the old 120 m island
   (CBZ.SURV.arena {cx:0, cz:600, radius:120}, volcano dead centre) and on the
   240 m planned island (CBZ.island: districts, harbour, volcano to the
   north-west). So nothing here is a typed coordinate. Every camera is SOLVED
   off what the live build exposes:
     - the island: CBZ.island (center, R, buildings, volcano) when present,
       else CBZ.surv.arena (center, radius, fragile, hills), else CBZ.SURV.arena
     - the subject: the hazard's real position — CBZ.tornado.active(), the
       volcano (island.volcano / arena.hills[0]), CBZ.disasters.hazards()
       (sinkholes, strikes, meteor pending, fire, fronts), CBZ.meteorAudit()
       impacts, the tsunami's travel direction from CBZ.waterEventGet()
     - the town: the centroid of the standing buildings
   and the eye is pushed up until nothing (a building box, the terrain) sits
   between it and the subject. A beat whose subject the build does not expose
   falls back to a framed shot of the town and SAYS so in its caption.

   TIMING. Each beat is "N simulated seconds into phase P of disaster D":
   warn +3 s, active +2 s (onset), active +peak s (per disaster), and 3 s
   after the active phase ends (aftermath, inside the director's 6-8 s gap so
   the next card has not been dealt). Phase lengths differ between builds;
   the offsets do not. A beat whose disaster is not the live one (or whose
   moment has already passed, e.g. a --subjects subset) re-forces it.

   The player is healed every tick until the final beat, which kills him on
   purpose to photograph the spectator view with its HUD. */

// [disaster id, short name, peak offset (s into active), per-beat focus]
const ARC = [
  ["tornado", "Tornado", 9, {
    warn: "The sky as the telegraph: low cloud, the green cast, the wind rising over the town before anything touches down.",
    onset: "Touchdown, framed on the funnel's real position: column from ground contact to the cloud base, the debris skirt at its foot.",
    peak: "Full strength in town: the funnel over buildings, roofs and debris going up, cars moving.",
    after: "The storm is gone. What is left along its track: torn ground, wreckage, damaged buildings." }],
  ["volcano", "Volcano", 10, {
    warn: "The mountain wakes up: glow at the crater, ash, the crowd leaving its flanks. Framed from the town side.",
    onset: "The eruption begins: the column, the first lava over the rim, bombs.",
    peak: "Lava flows down toward the town, ash over the island.",
    after: "The eruption is over. Where the lava went, what it buried and what is burning." }],
  ["meteor", "Meteor shower", 8, {
    warn: "Something is wrong with the sky over the town: the first streaks before anything lands.",
    onset: "Bolides in the air, framed on where they are actually headed.",
    peak: "Impacts in town: craters, flash, ejecta, glass, fires — aimed at the last real impact.",
    after: "The craters left in the town and what they hit." }],
  ["sinkhole", "Sinkholes", 8, {
    warn: "The telegraphed site: the ground at the first hole's real position before it opens.",
    onset: "The ground gives way: the first hole, framed on its real site.",
    peak: "Holes opening across town: depth, what falls in, roads and buildings at the edge.",
    after: "The holes left behind: open shafts in the town." }],
  ["wildfire", "Wildfire", 14, {
    warn: "Fire weather: dry wind, haze, the woods before ignition.",
    onset: "Ignition, framed on the fire's real position: first flames and smoke.",
    peak: "The fire front through trees and toward buildings: flame, smoke, ember spread.",
    after: "The burn scar: blackened ground and trees, what burnt and what survived." }],
  ["storm", "Lightning storm", 6, {
    warn: "The storm rolls in: dark sky, rain starting over the town.",
    onset: "First strikes, framed on where the bolts are actually landing.",
    peak: "The storm at full strength: rain, wet ground, strikes on the town.",
    after: "The storm passes: the light coming back, scorch marks, the wet town." }],
  ["blizzard", "Blizzard", 9, {
    warn: "The cold comes in: grey sky, wind, the first snow over the town.",
    onset: "Whiteout starts: visibility closing in on the streets.",
    peak: "Full blizzard: snow cover on roofs and roads, people caught outside.",
    after: "After the blizzard: the snow left on the town." }],
  ["hurricane", "Hurricane", 12, {
    warn: "The hurricane approaches: the sea rising and roughening at the harbour, the sky closing.",
    onset: "Landfall: wind-driven rain, surf over the waterfront.",
    peak: "Peak wind and surge: roofs peeling, trees down, boats and debris moving, the sea in the streets.",
    after: "The damage the hurricane left at the waterfront and in town." }],
  ["flashflood", "Flash flood", 14, {
    warn: "Rain upstream: the channel and low ground before the water arrives.",
    onset: "The water front arrives, framed on where the flood is actually advancing.",
    peak: "The flood at its height: streets underwater, cars swept, bridges and low buildings hit.",
    after: "The water drains: mud, stranded cars, what the flood moved." }],
  ["quake", "Earthquake", 8, {
    warn: "The town just before: the foreshock, things rattling, people reacting.",
    onset: "The shaking starts: the town in motion.",
    peak: "Buildings failing, framed on the most damaged structure: collapse, rubble, cracks.",
    after: "The aftermath: rubble fields, collapsed and leaning buildings across the town." }],
  ["flood", "Tsunami", 14, {
    warn: "The drawdown: the sea pulls back from the coast the wave will come from, exposing the seabed.",
    onset: "The wave arrives at the coast, framed ahead of its real front.",
    peak: "The water through the town: buildings, cars and people in the flood.",
    after: "The backwash: the drowned town as the water runs back out." }],
];

const BEATS = [
  ["warn", "warning"], ["onset", "onset"], ["peak", "peak"], ["after", "aftermath"],
];

const subjects = [
  { id: "island-overview", label: "The island, before anything happens",
    focus: "Aerial overview of the whole island at the start of the match: the town, the volcano, the coast, the sea. This is the place every later frame is damaging.",
    act: { overview: "start" } },
];
for (const [dis, name, peak, focus] of ARC) {
  for (const [beat, word] of BEATS) {
    subjects.push({
      id: `${dis === "flood" ? "tsunami" : dis}-${beat}`,
      label: `${name}: ${word}`,
      focus: focus[beat],
      act: { dis, beat, peak },
    });
  }
}
subjects.push(
  { id: "island-after", label: "The island after the whole arc",
    focus: "The same aerial as the opening frame, after every disaster has hit: what is still standing, burnt, flooded, cratered.",
    act: { overview: "end" } },
  { id: "spectator-hud", label: "After death: the spectator view", hud: true,
    focus: "The player killed during a storm, six simulated seconds later: the screen as the player sees it, the death/spectate HUD and the camera the game hands him.",
    act: { death: true } },
);

async function stageStoryboard(input) {
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
  const OVERLAY = "__stormboardOverlay";
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === OVERLAY) continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__stormboard;
  if (!S) {
    // ---- one-time: boot the real game into survival -----------------------
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
      document.querySelector('[data-mode="survival"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") return { ok: false, err: "no CBZ.disasters.force" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = OVERLAY;
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-note></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    // simT: simulated seconds since staging began. marks[id]: the sim second
    // each phase of the live occurrence of that disaster began / ended.
    S = window.__stormboard = { overlay, simT: 0, marks: {}, lastState: null, lastId: null, killed: false };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  const D = CBZ.disasters;
  const curId = () => (typeof D.currentId === "function" ? D.currentId() : null);

  // ---- the clock -----------------------------------------------------------
  let ticks = 0, totalMs = 0, maxMs = 0;
  const heal = () => {
    if (S.killed || !CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.stamina != null) CBZ.player.stamina = 100;
  };
  const watch = () => {
    const st = D.state(), id = curId();
    if (st !== S.lastState || id !== S.lastId) {
      if (S.lastId && S.lastState === "active" && (id !== S.lastId || st !== "active")) {
        const m = S.marks[S.lastId]; if (m && m.end == null) m.end = S.simT;
      }
      if (id && st === "warn" && (id !== S.lastId || S.lastState !== "warn")) S.marks[id] = { warn: S.simT, active: null, end: null };
      if (id && st === "active") { const m = S.marks[id] || (S.marks[id] = { warn: null, active: null, end: null }); if (m.active == null) m.active = S.simT; }
      S.lastState = st; S.lastId = id;
    }
  };
  const tick = () => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    const t0 = performance.now();
    CBZ.stepSim(1 / 60);
    const ms = performance.now() - t0;
    ticks++; totalMs += ms; if (ms > maxMs) maxMs = ms;
    S.simT += 1 / 60;
    heal(); watch();
  };
  const step = (secs) => { const n = Math.max(0, Math.round(secs * 60)); for (let i = 0; i < n; i++) tick(); };
  const stepWhile = (cond, capSecs) => { let n = Math.round(capSecs * 60); while (n-- > 0 && cond()) tick(); };

  // ---- the island, whatever this build calls it ----------------------------
  const arena = (CBZ.surv && CBZ.surv.arena) || null;
  const I = CBZ.island || null;
  const cfgA = (CBZ.SURV && CBZ.SURV.arena) || { cx: 0, cz: 600, radius: 120 };
  const C = (I && I.center) || (arena && arena.center) || { x: cfgA.cx, z: cfgA.cz };
  const R = (I && (I.R || I.radius)) || (arena && arena.radius) || cfgA.radius || cfgA.r || 120;
  const buildings = (I && I.buildings) || (arena && arena.fragile) || [];
  const groundAt = (x, z) => {
    try {
      if (I && I.groundAt) return I.groundAt(x, z);
      if (arena && arena.groundHeightAt) return arena.groundHeightAt(x, z);
      if (CBZ.floorAt) return CBZ.floorAt(x, z);
    } catch (_) {}
    return 0;
  };
  const bx = (b) => (b.ox != null ? b.ox : b.x), bz = (b) => (b.oz != null ? b.oz : b.z);
  const town = (() => {
    let sx = 0, sz = 0, n = 0;
    for (const b of buildings) { if (b.fallen) continue; sx += bx(b); sz += bz(b); n++; }
    if (!n) for (const b of buildings) { sx += bx(b); sz += bz(b); n++; }
    return n ? { x: sx / n, z: sz / n } : { x: C.x, z: C.z };
  })();
  const volcano = (I && I.volcano) || (arena && arena.hills && arena.hills[0]) || null;
  const hazards = () => { try { return (D.hazards && D.hazards()) || []; } catch (_) { return []; } };
  const centroid = (pts) => {
    if (!pts || !pts.length) return null;
    let sx = 0, sz = 0; for (const p of pts) { sx += p.x; sz += p.z; }
    return { x: sx / pts.length, z: sz / pts.length };
  };
  const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };
  const rot = (d, a) => ({ x: d.x * Math.cos(a) - d.z * Math.sin(a), z: d.x * Math.sin(a) + d.z * Math.cos(a) });
  // direction from the island centre out through p (the town-side default
  // when p IS the centre, as the old island's volcano is)
  const outward = (p) => {
    const ox = p.x - C.x, oz = p.z - C.z;
    if (Math.hypot(ox, oz) > 4) return unit(ox, oz);
    const tx = town.x - C.x, tz = town.z - C.z;
    return Math.hypot(tx, tz) > 4 ? unit(tx, tz) : { x: 0.6, z: 0.8 };
  };

  // ---- put the disaster at the requested moment ----------------------------
  let note = "";
  const arm = (dis) => {
    if (!D.force(dis)) return false;
    step(0.1);
    stepWhile(() => !(curId() === dis && D.state() === "warn"), 40);
    return curId() === dis;
  };
  const beatTarget = (dis, beat, peak) => {
    const m = S.marks[dis];
    if (!m) return null;
    if (beat === "warn") return m.warn != null ? m.warn + 3 : null;
    if (beat === "onset") return m.active != null ? m.active + 2 : null;
    if (beat === "peak") return m.active != null ? m.active + peak : null;
    return m.end != null ? m.end + 3 : null;
  };
  if (act.dis) {
    const { dis, beat, peak } = act;
    // is the live occurrence still before this beat's moment? else re-force
    const live = curId() === dis && (D.state() === "warn" || D.state() === "active");
    const tgt = beatTarget(dis, beat, peak);
    const stale = !live && !(beat === "after" && S.marks[dis] && S.marks[dis].end != null && S.simT <= S.marks[dis].end + 3);
    if (stale || (tgt != null && S.simT > tgt + 0.05)) {
      if (!arm(dis)) return { ok: false, err: `force(${dis}) did not reach its warning on this build` };
    }
    if (beat === "warn") {
      stepWhile(() => curId() === dis && D.state() === "warn" && S.simT < S.marks[dis].warn + 3, 20);
    } else {
      stepWhile(() => curId() === dis && D.state() === "warn", 40);
      const m = S.marks[dis] || {};
      if (beat === "onset") stepWhile(() => curId() === dis && D.state() === "active" && S.simT < m.active + 2, 20);
      else if (beat === "peak") stepWhile(() => curId() === dis && D.state() === "active" && S.simT < m.active + peak, 90);
      else {
        stepWhile(() => curId() === dis && D.state() === "active", 120);
        if (m.end == null) m.end = S.simT;
        stepWhile(() => S.simT < m.end + 3, 10);
      }
    }
    const m = S.marks[dis] || {};
    const into = beat === "warn" ? S.simT - (m.warn || 0) : beat === "after" ? S.simT - (m.end || 0) : S.simT - (m.active || 0);
    note = `${beat === "warn" ? "warn" : beat === "after" ? "after end" : "active"} +${into.toFixed(1)} s`;
  } else if (act.overview === "start") {
    step(2);
    note = "match start";
  } else if (act.overview === "end") {
    stepWhile(() => D.state() === "active", 60);
    step(1);
    note = "after the arc";
  } else if (act.death) {
    if (!arm("storm")) arm("tornado");
    stepWhile(() => D.state() === "warn", 30);
    step(2);
    S.killed = true;
    let pa = null;
    try { CBZ.surv.forEachActor((a) => { if (a && a.isPlayer) pa = a; }); } catch (_) {}
    try { if (CBZ.game) CBZ.game.invuln = 0; } catch (_) {}
    try { if (pa && CBZ.surv.hurt) CBZ.surv.hurt(pa, 9999, { cause: "struck by lightning" }); } catch (_) {}
    step(0.2);
    if (!CBZ.player.dead) {
      // the fairness law may price the hit down; take the remaining hp the
      // same way until the mode's own killPlayer runs
      for (let i = 0; i < 6 && !CBZ.player.dead; i++) {
        try { CBZ.player.hp = 1; if (pa) CBZ.surv.hurt(pa, 9999, { cause: "struck by lightning" }); } catch (_) {}
        step(0.3);
      }
    }
    step(6);
    note = CBZ.player.dead ? "player dead +6 s, game camera" : "PLAYER DID NOT DIE on this build";
  }

  // ---- SOLVE THE CAMERA ----------------------------------------------------
  const id = curId();
  const st = D.state();
  let eye = null, look = null, what = "";
  const frame = (tgt, o) => {
    // o: dir (unit, eye placed along it from the target), dist, h, lookY
    const d = o.dir || outward(tgt);
    const gy = groundAt(tgt.x, tgt.z);
    eye = { x: tgt.x + d.x * o.dist, y: 0, z: tgt.z + d.z * o.dist };
    eye.y = Math.max(groundAt(eye.x, eye.z), 0) + o.h;
    look = { x: tgt.x, y: gy + (o.lookY != null ? o.lookY : 2), z: tgt.z };
  };
  // the tallest standing building: the old island's towers reach well above
  // an R-scaled aerial, so every high shot clears them
  // (measured off the drawn groups once: the old island's ledger h is the
  // storey stack, not the spire, and its towers stand far above R * 0.75)
  if (S.maxH == null) {
    let mh = 0;
    const box = new T.Box3();
    for (const b of buildings) {
      mh = Math.max(mh, (b.gy || 0) + (b.h || 0));
      try { if (b.group) { box.setFromObject(b.group); if (isFinite(box.max.y)) mh = Math.max(mh, box.max.y); } } catch (_) {}
    }
    S.maxH = Math.min(400, mh);
    S.maxHraw = mh;
  }
  const maxH = S.maxH;
  let noLift = false;
  const aerial = (lift) => {
    const d = rot(outward(town), 0.55);
    const dist = Math.max(R * 1.35, maxH * 1.9);
    eye = { x: C.x + d.x * dist, y: Math.max(R * (lift || 0.75), maxH * 1.3), z: C.z + d.z * dist };
    look = { x: C.x + (town.x - C.x) * 0.3, y: 0, z: C.z + (town.z - C.z) * 0.3 };
  };
  // just offshore, low, looking up over the skyline: the frame is mostly
  // sky with the whole town under it. Offshore because neither island has a
  // building-free beach on every side (the planned town runs to its harbour).
  const skyShot = () => {
    const d = rot(outward(town), 0.35);
    // far enough out that the nearest towers do not fill the frame
    const out = R * 1.12 + Math.min(220, maxH * 0.8);
    eye = { x: C.x + d.x * out, y: 0, z: C.z + d.z * out };
    eye.y = Math.max(groundAt(eye.x, eye.z), 0) + 20;
    look = { x: town.x, y: Math.max(25, maxH * 0.25), z: town.z };
    noLift = true;     // the town IS between eye and aim point; lifting would put the eye in the skyline
  };
  const townShot = (h, dist, swing) => {
    frame(town, { dir: rot(outward(town), swing || 0.6), dist: dist || R * 0.55, h: h || 28, lookY: 4 });
  };

  if (act.overview) {
    aerial(0.75);
    what = "whole island";
  } else if (act.dis) {
    const dis = act.dis, beat = act.beat;
    const live = id === dis && st === "active";
    const hz = live || st === "warn" ? hazards() : [];
    const circles = hz.filter((h) => !h.line);
    const line = hz.find((h) => h.line);
    if (dis === "tornado") {
      const fun = CBZ.tornado && CBZ.tornado.active ? CBZ.tornado.active()[0] : null;
      const f = fun || (circles[0] ? { x: circles[0].x, z: circles[0].z, r: 20 } : null);
      if (beat === "warn" || !f) {
        if (beat === "after") {
          const au = CBZ.tornado && CBZ.tornado.audit ? CBZ.tornado.audit() : null;
          const p = au && au.path;
          if (p && p.x0 != null) {
            const dd = unit(p.x1 - p.x0, p.z1 - p.z0);
            eye = { x: p.x0 - dd.x * 40, y: 0, z: p.z0 - dd.z * 40 };
            eye.y = groundAt(eye.x, eye.z) + 55;
            look = { x: (p.x0 + p.x1) / 2, y: 0, z: (p.z0 + p.z1) / 2 };
            what = "down the damage track";
          }
        }
        if (!eye) {
          // low eye on the town edge, lots of sky over the roofs
          skyShot();
          what = beat === "warn" ? "sky over the town" : (f ? "town" : "NO FUNNEL EXPOSED: town");
        }
      } else {
        const H = fun ? (fun.h || Math.max(55, Math.min(260, (fun.r || 20) * 2.4))) : 90;
        const back = Math.max(H * 1.3, (f.r || 20) * 4);
        frame(f, { dir: rot(unit(f.x - town.x || 0.01, f.z - town.z), 0.5), dist: back, h: H * 0.45, lookY: H * 0.38 });
        if (beat === "peak") {
          // the funnel with the town behind it
          frame(f, { dir: rot(unit(f.x - town.x || 0.01, f.z - town.z), 0.3), dist: back * 0.9, h: H * 0.5, lookY: H * 0.3 });
        }
        what = `funnel at (${f.x.toFixed(0)}, ${f.z.toFixed(0)})`;
      }
    } else if (dis === "volcano") {
      if (volcano) {
        const vr = volcano.r || 36, pk = volcano.peak || 30;
        // from the town side: the town in the foreground, the mountain behind
        let d = unit(town.x - volcano.x, town.z - volcano.z);
        if (Math.hypot(town.x - volcano.x, town.z - volcano.z) < 5) d = outward(volcano);
        if (beat === "after") {
          const lava = circles.filter((c) => Math.hypot(c.x - volcano.x, c.z - volcano.z) > vr * 0.4);
          const lc = centroid(lava);
          if (lc) { frame(lc, { dir: rot(d, 0.5), dist: vr * 2.2, h: pk * 1.2 + 20, lookY: 2 }); what = "lava field"; }
        }
        if (!eye) {
          const dist = beat === "warn" ? vr * 3.2 : beat === "onset" ? vr * 3.6 : vr * 4.2;
          frame(volcano, { dir: rot(d, 0.35), dist, h: pk * (beat === "warn" ? 0.55 : 0.9) + 8, lookY: pk * (beat === "warn" ? 0.75 : 0.95) });
          what = `volcano at (${volcano.x.toFixed(0)}, ${volcano.z.toFixed(0)})`;
        }
      }
    } else if (dis === "meteor") {
      const au = CBZ.meteorAudit ? (() => { try { return CBZ.meteorAudit(); } catch (_) { return null; } })() : null;
      if (beat === "warn") {
        skyShot();
        what = "sky over the town";
      } else if (beat === "onset") {
        const b = au && au.bolides && au.bolides[0];
        const tgt = b ? { x: b.tx, z: b.tz } : (circles[0] || null);
        if (tgt) { frame(tgt, { dir: rot(outward(tgt), 0.5), dist: 70, h: 14, lookY: 30 }); what = b ? "bolide inbound target" : "pending impact"; }
      } else {
        const craters = au && au.craters && au.craters.length ? au.craters : null;
        const imp = au && au.lastImpact;
        const tgt = beat === "peak" ? (imp || (craters && craters[craters.length - 1]) || circles[0]) : (craters ? centroid(craters) : imp);
        if (tgt && tgt.x != null) { frame(tgt, { dist: beat === "peak" ? 45 : 70, h: beat === "peak" ? 20 : 40, lookY: 1 }); what = beat === "peak" ? "last impact" : `${craters ? craters.length : 1} craters`; }
      }
    } else if (dis === "sinkhole") {
      const holes = circles.length ? circles : ((CBZ.survHoles || []).filter((h) => h && h.x != null));
      const tgt = beat === "after" || beat === "peak" ? (holes.length > 1 ? centroid(holes) : holes[0]) : holes[0];
      if (tgt) {
        const r = holes[0].r || 6;
        frame(tgt, { dir: rot(outward(tgt), 0.5), dist: Math.max(28, r * 4 + (beat === "peak" || beat === "after" ? 25 : 0)), h: Math.max(16, r * 3), lookY: -1 });
        what = `${holes.length} hole${holes.length === 1 ? "" : "s"}`;
      }
    } else if (dis === "wildfire") {
      let pts = circles;
      if (!pts.length && beat !== "warn") {
        const tr = (I && I.trees) || (arena && arena.flammable) || [];
        pts = tr.filter((t) => t && (t.burning || (beat === "after" && t.burnt)));
      }
      const fc = centroid(pts.slice(0, 40));
      if (fc && beat !== "warn") {
        frame(fc, { dist: beat === "after" ? 80 : 60, h: beat === "after" ? 50 : 26, lookY: 4 });
        what = `fire ${pts.length} points`;
      } else {
        const tr = (I && I.trees) || (arena && arena.flammable) || [];
        const tc = centroid(tr.filter((t) => t && t.x != null).slice(0, 400));
        if (tc) { frame(tc, { dist: 75, h: 30, lookY: 4 }); what = "the woods"; }
      }
    } else if (dis === "storm") {
      if ((beat === "onset" || beat === "peak") && circles.length) {
        frame(circles[0], { dist: 55, h: 16, lookY: 12 });
        what = `strike at (${circles[0].x.toFixed(0)}, ${circles[0].z.toFixed(0)})`;
      } else if (beat === "warn") { skyShot(); what = "sky over the town"; }
      else { townShot(22, R * 0.55, 0.5); what = "town"; }
    } else if (dis === "blizzard") {
      townShot(beat === "peak" ? 14 : 20, beat === "peak" ? R * 0.35 : R * 0.5, 0.7);
      what = "town";
    } else if (dis === "hurricane") {
      let hb = null;
      if (I && I.harbour && I.harbour.length) hb = centroid(I.harbour.filter((p) => p && p.x != null));
      if (!hb) {
        // the waterfront of the town: the coast in the town's direction
        const d = outward(town);
        hb = { x: C.x + d.x * R * 0.92, z: C.z + d.z * R * 0.92 };
      }
      // stand inland of the waterfront, looking out across it to the sea
      const sea = unit(hb.x - town.x || 0.01, hb.z - town.z);
      frame(hb, { dir: rot({ x: -sea.x, z: -sea.z }, 0.45), dist: beat === "peak" ? 55 : 75, h: beat === "warn" ? 14 : 24, lookY: 2 });
      what = "waterfront";
    } else if (dis === "flashflood") {
      let tgt = null;
      if (beat !== "warn" && circles.length) tgt = centroid(circles.filter((c) => c.fill !== false)) || centroid(circles);
      if (!tgt && line) tgt = { x: line.x, z: line.z };
      if (!tgt && CBZ.groundWaterFront) { try { const F = CBZ.groundWaterFront(); if (F) tgt = { x: F.x + F.dx * F.s, z: F.z + F.dz * F.s }; } catch (_) {} }
      if (!tgt && I && I.rivers && I.rivers[0] && I.rivers[0].pts) { const p = I.rivers[0].pts; tgt = p[Math.floor(p.length / 2)]; what = "the channel"; }
      if (tgt) { frame(tgt, { dist: beat === "after" ? 70 : 55, h: beat === "after" ? 38 : 22, lookY: 0 }); what = what || "flood front"; }
    } else if (dis === "quake") {
      let worst = null, ws = 0;
      for (const b of buildings) {
        const s = b.fallen ? 2 : (b._dmg || b.dmg || 0) + (b.lean || b._lean ? 0.5 : 0);
        if (s > ws) { ws = s; worst = b; }
      }
      if ((beat === "peak") && worst) {
        const p = { x: bx(worst), z: bz(worst) };
        frame(p, { dir: rot(outward(p), 0.6), dist: Math.max(40, (worst.h || 12) * 2.6), h: Math.max(16, (worst.h || 12) * 0.9), lookY: (worst.h || 12) * 0.35 });
        what = `most damaged building${worst.fallen ? " (fallen)" : ""}`;
      } else if (beat === "after") { townShot(55, R * 0.6, 0.4); what = "town"; }
      else { townShot(beat === "warn" ? 14 : 20, R * 0.45, 0.8); what = "town"; }
    } else if (dis === "flood") {
      let ev = null;
      try { ev = CBZ.waterEventGet ? CBZ.waterEventGet() : null; } catch (_) {}
      let d = null;
      if (ev && /tsunami/.test(ev.owner || ev.kind || "") && ev.dx != null) d = unit(ev.dx, ev.dz);
      else if (line) d = unit(line.dx, line.dz);
      // the wave travels +d; it comes in from the coast at centre - d*R
      if (d) {
        const coast = { x: C.x - d.x * R, z: C.z - d.z * R };
        if (beat === "warn") {
          // inland of the coast it will hit, looking out at the exposed seabed
          frame(coast, { dir: rot(d, 0.35), dist: R * 0.45, h: 24, lookY: -2 });
          what = "the coast the wave comes from";
        } else if (beat === "onset" || beat === "peak") {
          const f = line ? { x: line.x, z: line.z } : (beat === "onset" ? coast : town);
          frame(f, { dir: rot(d, 0.4), dist: beat === "onset" ? 70 : 85, h: beat === "onset" ? 24 : 36, lookY: 3 });
          what = line ? "ahead of the wave front" : "coast";
        } else { townShot(45, R * 0.6, 0.4); what = "town"; }
      } else {
        townShot(30, R * 0.6, 0.4); what = "NO WAVE DIRECTION EXPOSED: town";
      }
    }
    if (!eye) { townShot(32, R * 0.6, 0.5); what = what || "SUBJECT NOT EXPOSED: town"; }
  }

  // ---- keep the subject in sight: lift the eye until nothing is between ----
  if (eye && !act.death && !noLift) {
    const blocked = () => {
      const N = 24;
      for (let i = 1; i < N; i++) {
        const u = i / N;
        if (u > 0.85) break;                 // the subject itself may be a building
        const x = eye.x + (look.x - eye.x) * u, y = eye.y + (look.y - eye.y) * u, z = eye.z + (look.z - eye.z) * u;
        if (y < groundAt(x, z) + 0.5) return true;
        for (const b of buildings) {
          if (b.fallen) continue;
          const hw = (b.w || 8) / 2 + 0.5, hd = (b.d || 8) / 2 + 0.5;
          if (Math.abs(x - bx(b)) < hw && Math.abs(z - bz(b)) < hd && y < (b.gy || 0) + (b.h || 10) + 1) return true;
        }
      }
      return false;
    };
    let lifts = 0;
    if (eye.y < groundAt(eye.x, eye.z) + 2) eye.y = groundAt(eye.x, eye.z) + 2;
    while (lifts < 12 && blocked()) { eye.y += 6; lifts++; }
    if (lifts) what += ` (eye lifted ${lifts * 6} m)`;
  }

  // ---- render ---------------------------------------------------------------
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  if (!act.death) {
    camera.fov = 55; camera.near = 0.4; camera.far = 20000;
    camera.position.set(eye.x, eye.y, eye.z);
    camera.lookAt(look.x, look.y, look.z);
  }
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  setHud(!!subject.hud);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const rinfo = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;bottom:52px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:520px";
  q("note").textContent = `${D.current() || "no disaster"} · ${D.state()} · ${note} · ${what} · sim ${S.simT.toFixed(1)} s`;
  q("note").style.cssText = "position:absolute;bottom:30px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:900px";
  q("perf").textContent = `${ticks} ticks · avg ${(ticks ? totalMs / ticks : 0).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms · island R ${Math.round(R)} m · tallest ${Math.round(maxH)} m`;
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";
  if (act.death) {
    // keep our labels out of the way of the game's own death HUD
    q("name").style.bottom = "auto"; q("name").style.top = "64px";
    q("note").style.bottom = "auto"; q("note").style.top = "96px";
  }

  let alive = null;
  try { alive = CBZ.surv && CBZ.surv.aliveCount ? CBZ.surv.aliveCount() : null; } catch (_) {}
  return {
    ok: true,
    disaster: D.current(),
    state: D.state(),
    note: `${note} · ${what}`,
    metrics: {
      simSeconds: Number(S.simT.toFixed(1)),
      alive: alive == null ? undefined : alive,
      tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
      tickMaxMs: Number(maxMs.toFixed(1)),
      drawCalls: Number(rinfo.calls || 0),
    },
  };
}

export default {
  id: "disaster-storyboard",
  title: "Disaster Survival: every disaster, four beats",
  description: "One seeded survival match per build. The director is forced through all eleven disasters (tornado, volcano, meteor shower, sinkholes, wildfire, lightning storm, blizzard, hurricane, flash flood, earthquake, tsunami) and each is photographed at its warning, onset, peak and aftermath, at the same simulated seconds into each phase on both builds. Every camera is solved off what the live build exposes (CBZ.island or the survival arena, the funnel, the volcano, the hazard list, the meteor impacts, the tsunami's travel direction), so the same preset frames the old 120 m island and the 240 m planned island. Opens and closes on an island aerial; ends on the spectator HUD after death.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  metricsNote: "simSeconds = simulated seconds since staging began (the clock both sides share). alive = actors still alive. Tick costs are advancing the same simulated seconds on the same machine.",
  metrics: {
    simSeconds: { label: "Sim clock", unit: "s" },
    alive: { label: "Alive" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageStoryboard,
};
