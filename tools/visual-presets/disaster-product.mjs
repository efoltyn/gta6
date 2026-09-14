/* Disaster Survival — PRODUCT PHOTOGRAPHY, shot by the engine.

   Store covers for the Disaster Survival release (index.html?mode=survival:
   a hundred people on an island, the director throwing tsunami / volcano /
   quake / wildfire / nuke at them). No generated art, no repainting, no edits
   to gameplay: the REAL mode is booted, the director is FORCED onto the
   disaster each cover needs, the sim is stepped to the beat the cover is about
   (polled on the event's own physical state, never on a wall clock), the crowd
   is put where a director would put extras, the sun is pinned, and the lens is
   set for whatever ratio ba was asked for. Everything in the frame is the
   shipped build rendering its own scene; the title is the only overlay.

   Portal rules this obeys (docs.crazygames.com/requirements/game-covers):
     16:9 1920x1080 · 2:3 800x1200 · 1:1 800x800 — no borders, no text but the
     title, no icons. Every subject below survives all three.

   Run (one ratio per run; the game serves from the repo root, so ba's `local`
   before is fine with --only after):
     ba disaster-product --before local --only after --width 1920 --height 1080 \
        --out ~/harness/out/gta6/portal/disaster --no-open --cdp-timeout 300000
     ... --width 800 --height 800      ... --width 800 --height 1200

   Staging facts (same family as tsunami-stages.mjs / disaster-sequence.mjs):
   - rAF is stubbed after boot, so CBZ.stepSim is the only clock; hitstop and
     slowmo are zeroed per tick.
   - The island is CBZ.surv.arena {center, radius}; hills[0] is the volcano.
   - The tsunami's bearing is seeded-random per run, so the wave tripods are
     RELATIVE to the live front: CBZ.waterEventGet().dx/dz and
     CBZ.disasters.tsunamiAudit().frontS/shoal/phase.
   - THE UNDERWATER-FOG TRAP: world/water_underwater.js grades the medium off
     the game camera, which follows the PLAYER during stepSim. The player is
     parked 140 m over the island every tick so the chase camera never
     submerges and the fog stays the sky's. The crowd IS the players in frame.
   - THE DAY IS 150 s LONG: a tsunami arc walks the sun a tenth of the way
     round the sky, so the sun is pinned right before the shot (and per frame
     in the trailer hook), never at boot.
   - window.__volcanoMagPin is the director's own hook for the eruption size;
     the cover pins the big one.

   HARNESS TRAP: stage() is SERIALIZED into the page, so nothing from this
   module's scope is reachable inside it — every knob rides on input.subject
   and the title is a literal in the function. */

/* Subject order is the SHOOTING order of one live match: the volcano goes
   first because the tsunami wrecks the town and the eruption cover wants it
   standing. `shot.narrow` overrides the tripod when the frame is square or
   portrait (a 68-degree vertical lens is only 48 degrees wide at 2:3). */
const subjects = [
  {
    id: "cover-volcano", label: "The mountain wakes up",
    focus: "The stratovolcano nine seconds into a pinned-big eruption, from the shore over the town at the burn: convective column over the crater, the lava fountain, the flows coming down the barrancos, and a crowd running down the road away from it. The bearing is chosen by scanning the compass for the corridor with the least tower height between the shore and the crater.",
    sun: 0.475,
    act: { force: "volcano", magPin: 0.96, untilState: "active", crowdAfterSecs: 7,
      crowd: { n: 44, from: 10, to: 40, side: 0, spread: 12, out: true }, extraSecs: 2 },
    shot: { mode: "center", bearing: "auto", dist: 130, alt: 18, aimY: 30, fov: 48,
      narrow: { dist: 120, alt: 14, aimY: 40, fov: 58 } },
  },
  {
    id: "cover-tsunami", label: "The wall over the beach",
    focus: "THE STAND: shoaling has traded the bore's speed for height and the wall (18 to 48 m, the size is a per-occurrence roll) stands over the shoreline for a held beat (0.45 s) before the lip comes down. The crowd was put on the sand at shoal 0.72 so they are a second into their sprint when the wall stands; the lens is on the beach, along the shore, low enough that the wave is a wall and not a rug.",
    sun: 0.40,
    act: { force: "flood", crowdAtShoal: 0.72, crowd: { n: 60, from: 4, to: 30, side: 10, spread: 30 },
      untilStalled: true, extraSecs: 0.08 },
    shot: { mode: "front", back: 14, side: 60, alt: 3.5, aimAhead: -10, aimSide: -6, aimY: 8, fov: 68,
      narrow: { back: 12, side: 52, aimAhead: -14, aimSide: -16, aimY: 10, fov: 78 } },
  },
  {
    id: "cover-run", label: "RUN",
    focus: "The same stand from the town side: a crowd sprints straight at a lens parked at knee height on the beach road, the standing wall filling the sky behind them. The tripod hangs on the SHORELINE, not the front.",
    sun: 0.40,
    act: { force: "flood", crowdAtShoal: 0.72, crowd: { n: 64, from: 10, to: 32, side: 0, spread: 13 },
      untilStalled: true, extraSecs: 0.08 },
    shot: { mode: "front", anchor: "beach", back: 34, side: 0, alt: 2.4, aimAhead: 0, aimSide: 0, aimY: 9, fov: 58,
      narrow: { back: 38, alt: 2.2, aimY: 11, fov: 70 } },
  },
];

async function stageDisasterProduct(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const TITLE = "DISASTER SURVIVAL";
  const sub = input.subject, act = sub.act || {};
  const W = input.width || innerWidth, Hh = input.height || innerHeight;
  const sh = (W / Hh < 1.2 && sub.shot && sub.shot.narrow) ? Object.assign({}, sub.shot, sub.shot.narrow) : (sub.shot || {});
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };

  let S = window.__disasterProduct;
  if (!S) {
    // ---- one-time: boot the real game into survival free play -------------
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") return { ok: false, err: "no CBZ.disasters.force" };
    // headless settles into the LOW tier and the water's segment count is
    // tier-driven; the cover is shot at the tier the owner plays
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    // the first-person arms are parented to the camera and follow any tripod
    try { if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    S = window.__disasterProduct = { forced: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const A = CBZ.surv.arena;
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.pos) {
      CBZ.player.pos.x = A.center.x; CBZ.player.pos.z = A.center.z; CBZ.player.pos.y = 140;
      if (CBZ.player.vel) { CBZ.player.vel.x = 0; CBZ.player.vel.y = 0; CBZ.player.vel.z = 0; }
    }
  };
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); heal(); }
  };
  const audit = () => { try { return CBZ.disasters.tsunamiAudit() || {}; } catch (_) { return {}; } };

  // ---- the director: put it on this cover's disaster ----------------------
  if (act.magPin != null) window.__volcanoMagPin = act.magPin;
  if (act.force) { CBZ.disasters.force(act.force); S.forced = act.force; step(0.1); }

  // ---- the axes: along the wave's travel, or a chosen bearing --------------
  // (computed as soon as the event exists — the crowd is placed on them)
  const axes = () => {
    const ev = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
    let dx, dz;
    if (sh.mode === "front") {
      dx = ev && Number.isFinite(ev.dx) ? ev.dx : 1; dz = ev && Number.isFinite(ev.dz) ? ev.dz : 0;
    } else {
      let bearing = sh.bearing || 0;
      if (sh.bearing === "auto") {
        /* THE TOWERS HIDE THE MOUNTAIN. The town's skyscrapers are taller
           than the volcano (26 m peak), so a bearing chosen blind photographed
           a plume behind a tower. Scan the compass for the corridor with the
           least building height between the shore and the crater. */
        let best = 0, bestCost = Infinity;
        for (let k = 0; k < 48; k++) {
          const b = (k / 48) * Math.PI * 2, ux = Math.cos(b), uz = Math.sin(b);
          let cost = 0;
          for (const f of A.fragile || []) {
            const rx = f.x - A.center.x, rz = f.z - A.center.z;
            const along = rx * ux + rz * uz, perp = Math.abs(-rx * uz + rz * ux);
            if (along > 8 && perp < 34 + along * 0.18) cost += f.h * f.h * (1 - perp / (34 + along * 0.18));
          }
          if (cost < bestCost) { bestCost = cost; best = b; }
        }
        bearing = best;
      }
      S.bearing = bearing;
      dx = -Math.cos(bearing); dz = -Math.sin(bearing);     // "inland" = toward the centre
    }
    return { dx, dz, px: -dz, pz: dx };
  };

  /* THE SHORE IS NOT THE SAME SHORE TWICE. Every forced flood rolls a fresh
     bearing off the seeded stream, so the stretch of coast the wall stands
     over is different on every run — and the third sweep photographed a run
     tripod from inside a roof. The shore tripods therefore choose their
     LATERAL stretch: scan offsets along the shoreline and score the corridor
     between the lens and its aim point against the town's buildings and
     trees, then hang the camera and the crowd on the clearest one. */
  let lateral = 0;
  const pickLateral = () => {
    if (sh.mode !== "front" || sh.lateral === false) return 0;
    const X = axes();
    const anchor = -A.radius;
    const P = (along, side) => ({ x: A.center.x + X.dx * along + X.px * side, z: A.center.z + X.dz * along + X.pz * side });
    const segCost = (a, b, list, rad, weight) => {
      let cost = 0;
      const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz || 1;
      for (const o of list || []) {
        if (o.fallen || o.burnt) continue;
        const t = Math.max(0, Math.min(1, ((o.x - a.x) * abx + (o.z - a.z) * abz) / L2));
        const dx = o.x - (a.x + abx * t), dz = o.z - (a.z + abz * t);
        const r = rad(o);
        const d = Math.hypot(dx, dz) - r;
        if (d < 3) cost += weight(o) * (d < 0 ? 1 : 1 - d / 3);
      }
      return cost;
    };
    let best = 0, bestCost = Infinity;
    for (let L = -64; L <= 64; L += 4) {
      const cam = P(anchor + (sh.back || 0), L + (sh.side || 0));
      const aim = P(anchor + (sh.aimAhead || 0), L + (sh.aimSide || 0));
      const crowdA = P(anchor + ((act.crowd && act.crowd.from) || 0), L);
      const crowdB = P(anchor + ((act.crowd && act.crowd.to) || 0), L);
      let cost = segCost(cam, aim, A.fragile, (b) => Math.max(b.w || 8, b.d || 8) * 0.5, (b) => 20 + (b.h || 0));
      cost += segCost(cam, crowdB, A.fragile, (b) => Math.max(b.w || 8, b.d || 8) * 0.5, (b) => 10 + (b.h || 0));
      cost += segCost(cam, aim, A.flammable, () => 2.5, () => 6);
      cost += segCost(crowdA, crowdB, A.flammable, () => 2.5, () => 2);
      // the lens itself must not stand inside a building
      for (const b of A.fragile || []) {
        if (b.fallen) continue;
        if (Math.abs(b.x - cam.x) < (b.w || 8) * 0.5 + 2 && Math.abs(b.z - cam.z) < (b.d || 8) * 0.5 + 2) cost += 200;
      }
      cost += Math.abs(L) * 0.05;                  // ties go to the middle of the beach
      /* THE LIST IS NOT THE WORLD. The 2:3 run photographed one flat grey
         frame from a lens standing inside something the fragile list does
         not name (a prop, a canopy, a kerb-high slab). So the scan also
         ASKS THE SCENE: a ray from the lens toward its aim, against the
         arena's own meshes, and anything inside 8 m rejects the candidate. */
      if (cost < bestCost) {
        const eye = new T.Vector3(cam.x, CBZ.surv.floorAt(cam.x, cam.z) + (sh.alt || 5), cam.z);
        const to = new T.Vector3(aim.x, sh.aimY || 5, aim.z).sub(eye);
        const ray = new T.Raycaster(eye, to.normalize(), 0, 8);
        ray.camera = CBZ.camera;     // r128: a scene with Sprites throws without it
        let blocked = false;
        try {
          const hits = ray.intersectObject(A.root, true);
          for (const h of hits) { if (h.object && h.object.visible && !(h.object.userData && h.object.userData.waterSurface)) { blocked = true; break; } }
        } catch (_) {}
        if (!blocked) { bestCost = cost; best = L; }
      }
    }
    S.lateralCost = +bestCost.toFixed(1);
    return best;
  };

  // ---- the extras: a crowd on the shore, running -------------------------
  // b.state/target/urg are survivorbot.js's own fields; the sim that runs
  // between the placement and the shot animates the sprint and turns the
  // bodies onto their target. Placed BEFORE the beat is polled, so by the
  // time the wall stands they have been running for most of a second.
  let placed = 0;
  const placeCrowd = () => {
    const c = act.crowd; if (!c || !CBZ.bots) return;
    const X = axes();
    const shoreS = -A.radius;
    const runDir = c.out ? -1 : 1;
    let k = 0;
    for (let i = 0; i < CBZ.bots.length && placed < c.n; i++) {
      const b = CBZ.bots[i];
      if (!b || b.dead || !b.pos) continue;
      const u = (k * 0.618033) % 1, v = ((k * 0.754877) + 0.31) % 1; k++;
      let s = shoreS + c.from + (c.to - c.from) * u;
      const side = lateral + (c.side || 0) + (v - 0.5) * 2 * c.spread;
      let x = A.center.x + X.dx * s + X.px * side, z = A.center.z + X.dz * s + X.pz * side;
      // DRY GROUND ONLY: an extra dropped into standing water swims (the
      // first cut had the crowd prone in brown water). Walk inland until dry.
      for (let t = 0; t < 8; t++) {
        let wet = 0; try { wet = CBZ.survFloodDepthAt ? CBZ.survFloodDepthAt(x, z) : 0; } catch (_) {}
        if (!(wet > 0.12)) break;
        s += 5; x = A.center.x + X.dx * s + X.px * side; z = A.center.z + X.dz * s + X.pz * side;
      }
      b.pos.x = x; b.pos.z = z; b.pos.y = CBZ.surv.floorAt(x, z);
      b.swim = false; b.panicT = 0; b.pause = 0;
      b.state = "flee"; b.urg = 1;
      b.target.set(x + X.dx * 60 * runDir, 0, z + X.dz * 60 * runDir);
      b.group.rotation.y = Math.atan2(X.dx * runDir, X.dz * runDir);
      placed++;
    }
  };

  // ---- poll to the beat's PHYSICAL moment ---------------------------------
  let guard = 0;
  if (act.untilState) while (guard++ < 4000 && CBZ.disasters.state() !== act.untilState) step(0.1);
  const pollShoal = (want) => {
    guard = 0;
    while (guard++ < 6000) {
      const a = audit();
      if (a.phase === "sweep" && a.shoal != null && a.shoal >= want) break;
      if (a.phase && a.phase !== "sweep" && a.phase !== "warn") break;   // missed it; do not hang
      step(1 / 60);
    }
  };
  if (act.crowdAtShoal != null) pollShoal(act.crowdAtShoal);
  if (act.crowdAfterSecs) step(act.crowdAfterSecs);
  lateral = pickLateral();
  placeCrowd();
  if (act.untilShoal != null) pollShoal(act.untilShoal);
  if (act.untilStalled) {
    // THE STAND: the wall at full height over the beach, creeping (0.45 s)
    guard = 0;
    while (guard++ < 6000) {
      const a = audit();
      if (a.stalled) break;
      if (a.crashAge != null && a.crashAge >= 0) break;                 // already broke
      if (a.phase && a.phase !== "sweep" && a.phase !== "warn") break;
      step(1 / 60);
    }
  }
  if (act.untilCrashed) {
    guard = 0;
    while (guard++ < 6000) {
      const a = audit();
      if (a.crashAge != null && a.crashAge >= 0) break;
      if (a.phase && a.phase !== "sweep" && a.phase !== "warn") break;
      step(1 / 60);
    }
  }
  if (act.untilFrontPast != null) {
    guard = 0;
    while (guard++ < 6000) {
      const a = audit();
      if (a.phase && a.phase !== "sweep" && a.phase !== "warn") break;
      if (a.phase === "sweep" && a.frontS != null && a.frontS > -A.radius + act.untilFrontPast) break;
      step(1 / 60);
    }
  }
  if (act.extraSecs) step(act.extraSecs);

  // ---- the sun, then three ticks so the light rig and the sky follow -------
  if (typeof CBZ.dayPhase === "function" && sub.sun != null) CBZ.dayPhase(sub.sun);
  step(3 / 60);

  // ---- where things ARE now (read AFTER the last step: the bore covers
  //      metres per tick, and a tripod hung on a stale front was 38 m off) ---
  const X = axes(); const dx = X.dx, dz = X.dz, px = X.px, pz = X.pz;
  const a2 = audit();
  const fs = a2.frontS != null && a2.frontS > -1e8 ? a2.frontS : -A.radius;
  // the wave tripods hang on the live front; "beach" hangs on the shoreline,
  // which is where a lens at knee height has to stand once the bore is loose
  const anchorS = (sh.mode === "front" && sh.anchor !== "beach") ? fs : -A.radius;
  const fx = A.center.x + dx * anchorS, fz = A.center.z + dz * anchorS;

  // ---- the lens ------------------------------------------------------------
  const cam = CBZ.camera;
  cam.aspect = W / Hh; cam.fov = sh.fov || 50; cam.near = 0.3; cam.far = 20000;
  const alt = sh.alt || 5, aimY = sh.aimY || 5;
  const place = (extraBack) => {
    let cx, cz, ax, az;
    if (sh.mode === "front") {
      const back = (sh.back || 0) + extraBack;
      cx = fx + dx * back + px * (lateral + (sh.side || 0));
      cz = fz + dz * back + pz * (lateral + (sh.side || 0));
      ax = fx + dx * (sh.aimAhead || 0) + px * (lateral + (sh.aimSide || 0));
      az = fz + dz * (sh.aimAhead || 0) + pz * (lateral + (sh.aimSide || 0));
    } else {
      cx = A.center.x - dx * (sh.dist || 200); cz = A.center.z - dz * (sh.dist || 200);
      ax = A.center.x; az = A.center.z;
    }
    const ground = CBZ.surv.floorAt(cx, cz);
    // the eye stays over the ground AND over any water standing on it (a
    // knee-height lens in a flooded street photographed the underside of
    // the flood: one flat teal frame)
    let water = -1e9; try { if (CBZ.survSeaHeightAt) water = CBZ.survSeaHeightAt(cx, cz); } catch (_) {}
    return { cx, cz, ax, az, ey: Math.max(ground + alt, water + 0.9) };
  };
  /* THE LENS MUST SEE. The 2:3 run cover came back one flat grey frame:
     a 49 m wave's lip overhangs the shore by tens of metres and the lens,
     38 m inland, stood inside the curl — nothing the shore scan could know
     before the wave existed. So the placed lens asks the scene, now: a ray
     toward the aim point, and any visible hit inside 8 m backs the tripod
     off another 8 m inland (three times at most; the crowd stays put). */
  let L = place(0), retreated = 0;
  for (let t = 0; t < 3 && sh.mode === "front"; t++) {
    const eye = new T.Vector3(L.cx, L.ey, L.cz);
    const dir = new T.Vector3(L.ax, aimY, L.az).sub(eye).normalize();
    let blocked = false;
    try {
      const ray = new T.Raycaster(eye, dir, 0, 8);
      ray.camera = CBZ.camera;       // r128: a scene with Sprites throws without it
      const hits = ray.intersectObject(CBZ.scene, true);
      for (const h of hits) {
        let o = h.object, vis = true;
        while (o) { if (o.visible === false) { vis = false; break; } o = o.parent; }
        if (!vis) continue;
        if (h.object.userData && h.object.userData.waterSurface) continue;
        blocked = true; break;
      }
    } catch (_) {}
    if (!blocked) break;
    retreated += 8; L = place(retreated);
  }
  const cx = L.cx, cz = L.cz, ax = L.ax, az = L.az;
  cam.position.set(cx, L.ey, cz);
  cam.up.set(0, 1, 0); cam.lookAt(ax, aimY, az);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else { const rig = CBZ.skyDome && CBZ.skyDome.parent; if (rig && rig.position) rig.position.set(cx, 0, cz); }

  // ---- clean frame: the game canvas and nothing else -----------------------
  for (const el of document.body.children) {
    if (el.id === "game" || el.id === "disasterProductTitle" || el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    el.style.setProperty("display", "none", "important");
  }
  if (!document.getElementById("disasterProductNoHint")) {
    const st = document.createElement("style"); st.id = "disasterProductNoHint";
    st.textContent = "#lockHint{display:none!important}";
    document.head.appendChild(st);
  }

  // ---- the title — the one thing the portal allows on a cover ---------------
  const portrait = W / Hh < 1.2;
  let title = document.getElementById("disasterProductTitle");
  if (!title) { title = document.createElement("div"); title.id = "disasterProductTitle"; document.body.appendChild(title); }
  // landscape: one line sized to the width; square/portrait: two stacked words
  const px1 = portrait ? Math.round(Math.min(W * 0.19, Hh * 0.12)) : Math.round(Math.min(W * 0.07, Hh * 0.15));
  title.style.cssText = "position:fixed;z-index:2147483647;top:" + (portrait ? 5 : 4.5) + "%;left:3%;right:3%;text-align:center;color:#fff;"
    + "font-family:Fredoka,'Arial Black',Impact,Arial,sans-serif;font-weight:900;font-size:" + px1 + "px;line-height:.9;letter-spacing:-.04em;"
    + "text-shadow:0 4px 0 #3a0d08,0 10px 30px rgba(10,4,2,.9),0 0 60px rgba(255,120,40,.35);pointer-events:none;white-space:nowrap";
  title.innerHTML = portrait ? "DISASTER<br>SURVIVAL" : TITLE;
  title.style.display = "";

  CBZ.renderer.render(CBZ.scene, cam);

  // ---- THE TRAILER HOOK: hold the cover half a second, then let it play ----
  const H = window.__cbzVisualCompare;
  const tripod = [cx, cam.position.y, cz, ax, aimY, az];
  H.videoFrame = async function (dt, index) {
    if (index <= 12) { CBZ.renderer.render(CBZ.scene, cam); return; }
    title.style.display = "none";
    if (typeof CBZ.dayPhase === "function" && sub.sun != null) CBZ.dayPhase(sub.sun);
    CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(dt); heal();
    cam.position.set(tripod[0], tripod[1], tripod[2]); cam.lookAt(tripod[3], tripod[4], tripod[5]);
    cam.updateMatrixWorld(true);
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    CBZ.renderer.render(CBZ.scene, cam);
  };

  return {
    ok: true,
    disaster: CBZ.disasters.current(), state: CBZ.disasters.state(),
    phase: a2.phase || null, frontS: Number(fs.toFixed(1)), faceH: a2.faceH != null ? a2.faceH : null,
    stalled: !!a2.stalled, crashAge: a2.crashAge != null ? a2.crashAge : null, eventT: a2.eventT != null ? a2.eventT : null,
    crowd: placed, sun: sub.sun, bearing: S.bearing != null ? +S.bearing.toFixed(2) : null,
    lateral: lateral, lateralCost: S.lateralCost != null ? S.lateralCost : null, retreated: retreated,
    camera: [cx, cam.position.y, cz].map((v) => +v.toFixed(1)), width: W, height: Hh,
  };
}

export default {
  id: "disaster-product",
  title: "Disaster Survival — in-engine product photography",
  description: "Store covers for the Disaster Survival release, staged in the shipped build: the director is forced onto each cover's disaster, the sim is stepped to the beat the cover is about, the crowd is placed where a director would put extras, the sun is pinned, and the lens is set for whatever ratio the run asks for. Every pixel is the game rendering its own scene; the title is the only overlay.",
  defaultBefore: "local",
  beforeLabel: "SOURCE GAME", afterLabel: "PRODUCT CAPTURE",
  pairNote: "Every pixel is the shipped build rendering its own scene · title is the only overlay",
  viewport: { width: 1920, height: 1080 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metrics: {}, metricsNote: "Product captures, not a gameplay score.",
  subjects,
  stage: stageDisasterProduct,
};
