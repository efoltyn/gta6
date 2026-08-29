/* Matched self-A/B for two connected asks, photographed in one seeded city.

   1) "improve how buildings react to explosions rn they dont look real when hit
      by an explosion". MEASURED before this wave: a direct hit from the
      heaviest row in the ordnance table (missile, power 3.0 / radius 16) on an
      8-storey glass office left the facade WITHOUT A SCRATCH. carveHole would
      only accept a wall box at least 1.6 m tall and opaque, and a curtain-wall
      storey is a 0.55 m sill course, a 0.45 m header course, two corner jambs
      and a grid of transparent panes — nothing eligible, at any power, on the
      most common building type in the city.

   2) "adding the missles to the back of a truck with a map to target them ...
      which should explode on impact with the beautiful rpg cloud". The launcher
      is the motor pool's own truck chassis with a real elevating four-tube
      rack; the round is the existing pooled missile flown on a lofted route;
      the map is the existing one waypoint, in fire-control dress. The warhead
      spends the bus's RPG row by name, because that is the cloud the owner
      asked for.

   BEFORE is this same checkout with three flags off, which is the tighter
   control than a deployed build: identical seed, identical world, identical
   cameras, and only the behaviour under test changes. */

const subjects = [
  { id: "rpg-facade", label: "RPG on a glass office — after the dust", focus: "Same building, same rocket, same camera. BEFORE: the curtain wall cannot be breached at all, so the tower stands unmarked and the event is a puff of shards. AFTER: a real multi-storey bay is gone, the floor slabs are exposed and the concrete is in the street." },
  { id: "rpg-close", label: "The wound, close", focus: "20 m from the breach. Jagged slab teeth around the opening, reinforcement torn out of the concrete, a contact-stacked rubble heap on the pavement, and no fake-interior billboard left standing in the hole." },
  { id: "launcher", label: "Motor pool — the launcher truck", focus: "Same bay, same chassis. The Patriot keeps the army truck's cab, frame and six wheels and replaces the canvas bed with a braced elevating four-tube rack carrying visible rounds." },
  { id: "fire-control", label: "The map becomes fire control", focus: "While commanding the battery the ONE shared city waypoint becomes an exact impact reticle with an explicit LAUNCH control; before, the same surface is the ordinary navigation map. No second targeting system was built." },
  { id: "launch", label: "Patriot away", focus: "The round leaves an authored tube transform at the rack's real 45 degrees and starts a dense smoke train. The legacy truck has no weapon and nothing to fire." },
  { id: "flight", label: "The lofted flight", focus: "Meteor Shower's useful silhouette — a readable body crossing a lot of sky with a coherent train behind it — on a ground-launched lob toward one designated building. Same pooled projectile, no second flight engine." },
  { id: "impact", label: "Impact — the RPG cloud", focus: "The designated facade is struck at its real height and the bus's RPG row blooms at contact, rather than the heavy row whose additive fireball whites out the building it just hit." },
  { id: "aftermath", label: "What the strike left", focus: "The cloud has cleared. Before: the designated tower is untouched because nothing was fired and, even if it had been, the glass facade could not open. After: an open bay, exposed structure, a heap in the street and smoke still coming off the wound." },
];

async function stagePatriot(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, err: "missing CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const tick = () => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    CBZ.stepSim(1 / 60);
    if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
  };
  const seconds = (s) => { const n = Math.max(1, Math.round(s * 60)); for (let i = 0; i < n; i++) tick(); };
  const DAY = 0.40;

  // Every non-canvas body child goes dark for a shot. Re-applied per subject:
  // an explosion authors kill-feed rows and a weapon swap re-parents a
  // viewmodel to the camera long after the first pass ran.
  const clean = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__patriotHud") continue;
      child.style.visibility = "hidden";
    }
    const cam = CBZ.camera;
    if (cam && cam.children) for (const c of cam.children) c.visible = false;
  };
  // The day cycle advances under stepSim far faster than wall time, and these
  // subjects simulate tens of seconds between them. Re-assert the hour before
  // every shot or the last plate is golden-hour and the first is noon.
  const daylight = () => { try { if (CBZ.dayPhase) CBZ.dayPhase(DAY); } catch (_) {} };
  const groundAt = (x, z) => { try { return CBZ.floorAt ? +CBZ.floorAt(x, z) || 0 : 0; } catch (_) { return 0; } };
  const wet = (x, z) => { try { return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)); } catch (_) { return false; } };
  // Is this point standing inside something? Cheap AABB sweep at one height.
  const solidAt = (x, y, z, pad) => {
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]; if (!c) continue;
      const y0 = c.y0 == null ? -1e3 : c.y0, y1 = c.y1 == null ? 1e3 : c.y1;
      if (y < y0 - 0.6 || y > y1 + 0.6) continue;
      if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
    }
    return false;
  };
  // Can this camera SEE that point? CBZ.losBlockers is the city's own
  // structural-visibility set (walls/roofs, not panes), which is exactly the
  // question — a tripod is useless inside the parking deck across the road.
  const _ray = new T.Raycaster(), _o = new T.Vector3(), _d = new T.Vector3();
  const losClear = (from, to) => {
    const L = CBZ.losBlockers;
    if (!L || !L.length) return true;
    _d.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const d = _d.length(); if (d < 2) return true;
    _d.divideScalar(d);
    _ray.set(_o.set(from.x, from.y, from.z), _d);
    _ray.near = 0.5; _ray.far = d - 2.2;         // the wall we are photographing is the far end
    let hits = [];
    try { hits = _ray.intersectObjects(L, false); } catch (_) { return true; }
    return hits.length === 0;
  };
  // THREE RAYS, NOT ONE. A single ray to the centre of the wound is happy to
  // stand behind a building that crosses half the frame — it only has to miss
  // that one line. Spreading the test across the width of the facade rejects a
  // foreground occluder, which is what "can I photograph this" actually means.
  const seesFacade = (eye, w) => {
    const a = Math.min(15, w.width * 0.46), b = Math.min(9, w.width * 0.26);
    return losClear(eye, { x: w.x, y: w.y, z: w.z }) &&
      losClear(eye, { x: w.x + w.tx * b, y: w.y + 3, z: w.z + w.tz * b }) &&
      losClear(eye, { x: w.x - w.tx * b, y: w.y - 2, z: w.z - w.tz * b }) &&
      losClear(eye, { x: w.x + w.tx * a, y: w.y + 1, z: w.z + w.tz * a }) &&
      losClear(eye, { x: w.x - w.tx * a, y: w.y + 1, z: w.z - w.tz * a });
  };
  // First tripod in the list that is standing in open air AND has the shot.
  const clearEye = (w, tries) => {
    const look = { x: w.x, y: w.y, z: w.z };
    for (let i = 0; i < tries.length; i++) {
      const t = tries[i];
      const eye = { x: w.x + w.nx * t[0] + w.tx * t[2], y: Math.max(3, w.y + t[1]), z: w.z + w.nz * t[0] + w.tz * t[2] };
      if (solidAt(eye.x, eye.y, eye.z, 1.4)) continue;
      if (!seesFacade(eye, w)) continue;
      return { eye, look, fov: t[3] || 52 };
    }
    const t = tries[0];
    return { eye: { x: w.x + w.nx * t[0] + w.tx * t[2], y: Math.max(3, w.y + t[1]), z: w.z + w.nz * t[0] + w.tz * t[2] },
      look, fov: t[3] || 52 };
  };
  // The establishing plate has to contain the BUILDING, not a crop of the band
  // the rocket hit: seat the tripod off the tower's own height and look at its
  // middle, or a neighbour's podium roof fills half the frame.
  const towerEye = (w) => {
    const look = { x: w.x, y: w.h * 0.46, z: w.z };
    const D = Math.max(52, Math.min(120, w.h * 2.3));
    const mid = { x: w.x, y: w.h * 0.46, z: w.z, nx: w.nx, nz: w.nz, tx: w.tx, tz: w.tz, width: w.width };
    for (const t of [[D, 0.62, 0.30], [D * 1.15, 0.7, -0.34], [D * 0.85, 0.55, 0.5], [D * 1.3, 0.8, 0.62]]) {
      const eye = { x: w.x + w.nx * t[0] + w.tx * (t[0] * t[2]), y: Math.max(6, w.h * t[1]),
        z: w.z + w.nz * t[0] + w.tz * (t[0] * t[2]) };
      if (solidAt(eye.x, eye.y, eye.z, 1.6)) continue;
      if (!seesFacade(eye, mid)) continue;
      return { eye, look, fov: 52 };
    }
    return { eye: { x: w.x + w.nx * D + w.tx * D * 0.3, y: Math.max(6, w.h * 0.62), z: w.z + w.nz * D + w.tz * D * 0.3 },
      look, fov: 52 };
  };
  // Park the player clear of the blast AT REAL GROUND HEIGHT. Dropping them at
  // y=0 sinks them under the street, the swim test flips, and scene.fog is
  // rewritten to underwater teal (near 5 / far 34) — which paints the whole
  // frame, sky included, a few seconds after the shot.
  const parkPlayer = (w) => {
    if (!CBZ.player || !CBZ.player.pos) return;
    // Candidates alongside the struck building, then its own lot centre, which
    // is land by construction. A spot over water is the trap: the gameplay
    // camera follows the player there during the simulated seconds, the
    // underwater treatment takes ownership of scene.fog (near 5 / far 34, deep
    // teal) and every subsequent render — including this preset's own detached
    // camera — comes back painted through it, sky included.
    const half = w.width * 0.5;
    const opts = [
      { x: w.x + w.tx * (half + 16), z: w.z + w.tz * (half + 16) },
      { x: w.x - w.tx * (half + 16), z: w.z - w.tz * (half + 16) },
      { x: w.ox, z: w.oz },
    ];
    let p = opts[opts.length - 1];
    for (const o of opts) if (!wet(o.x, o.z)) { p = o; break; }
    CBZ.player.pos.set(p.x, groundAt(p.x, p.z) + 1.0, p.z);
    if (CBZ.player.vel) CBZ.player.vel.set(0, 0, 0);
  };
  // Belt and braces: if scene.fog is still the underwater stand-in when a shot
  // is due, put the eye on land and let the treatment hand the fog back.
  const dryOut = () => {
    const f = CBZ.scene && CBZ.scene.fog;
    if (!f || !(f.far < 80)) return;
    const w = S.rpg;
    if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(w.ox, groundAt(w.ox, w.oz) + 1.0, w.oz);
    for (let i = 0; i < 60 && CBZ.scene.fog.far < 80; i++) tick();
  };

  let S = window.__patriotSeq;
  if (!S) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
      document.querySelector('.mode-btn[data-mode="city"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    document.querySelector('.mode-btn[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(650);
    // settle the world + wait for the motor pool to register its vehicles
    let recs = [];
    for (let i = 0; i < 900; i++) {
      tick(); recs = CBZ.cityMilitaryVehicles || [];
      if (recs.some((r) => r && (r.kind === "patriot" || r.kind === "ground"))) break;
    }
    daylight(); seconds(0.3);

    // ---- the two target shells --------------------------------------------
    // Both sides run this identically off the same seed, so the cameras, the
    // designated point and the flight geometry are the same pixels' worth of
    // world on either side of the comparison.
    const A = CBZ.city && CBZ.city.arena;
    const shells = (A && A.root && A.root.userData && A.root.userData.shells) || [];
    // DENSITY, then the shot. The first pass scored a face by how FEW things
    // stood in front of it, which reliably chose a tower on the edge of the map
    // staring at farmland — the launcher then deployed into a field and the
    // "city strike" was photographed over a country road. What a plate of this
    // actually needs is a building with a city behind it AND a tripod position
    // that is standing in the open with line of sight to the facade.
    const density = (x, z) => {
      let n = 0;
      for (const b of shells) if (b && Math.abs(b.ox - x) < 200 && Math.abs(b.oz - z) < 200) n++;
      return n;
    };
    const cands = [];
    for (const b of shells) {
      if (!b || b.boarded || !b.colliders || !b.colliders.length) continue;
      if (!(b.storeys >= 5) || b.w < 12 || b.d < 12) continue;
      // A MID-RISE IS THE SUBJECT. The city's landmark towers win every density
      // and storey tally, and then the establishing plate has to stand 460 m
      // back to contain one, the wound is four pixels, and the flight arc is
      // aimed 90 m up into empty sky. 16-46 m is the band where a whole
      // building and one blown-open bay fit in the same frame.
      if (!(b.h >= 16 && b.h <= 46)) continue;
      if (Math.hypot(b.ox, b.oz) > 900) continue;
      const dens = density(b.ox, b.oz);
      if (dens < 4) continue;                       // not a block, a lone shed
      const faces = [
        { nx: 1, nz: 0, x: b.ox + b.w / 2, z: b.oz, width: b.d },
        { nx: -1, nz: 0, x: b.ox - b.w / 2, z: b.oz, width: b.d },
        { nx: 0, nz: 1, x: b.ox, z: b.oz + b.d / 2, width: b.w },
        { nx: 0, nz: -1, x: b.ox, z: b.oz - b.d / 2, width: b.w },
      ];
      for (const f of faces) {
        const y = Math.min(b.h - 2.2, b.FH * 2 + 1.6);
        const tx = -f.nz, tz = f.nx;
        const eye = { x: f.x + f.nx * 46 + tx * 13, y: Math.max(3, y + 9), z: f.z + f.nz * 46 + tz * 13 };
        const shot = !solidAt(eye.x, eye.y, eye.z, 1.4) && losClear(eye, { x: f.x, y: y, z: f.z });
        // What is on THIS side of the building, 180 m out? That is where the
        // tripod stands, where the launcher deploys and what the flight plate
        // has behind it. Scoring a face purely on "can I see it" chose the one
        // pointing at open country every time, and then a city strike was
        // photographed over a marina.
        const outX = f.x + f.nx * 180, outZ = f.z + f.nz * 180;
        cands.push({ b, f, score: (shot ? 90 : 0) + Math.min(14, dens) * 4 +
          Math.min(12, density(outX, outZ)) * 6 - (wet(outX, outZ) ? 80 : 0) +
          Math.min(9, b.storeys) * 3 + (b.office ? 6 : 0) - (wet(eye.x, eye.z) ? 40 : 0) });
      }
    }
    cands.sort((p, q) => (q.score - p.score) || (p.b.ox - q.b.ox) || (p.b.oz - q.b.oz));
    if (!cands.length) return { ok: false, err: "no candidate shells", shells: shells.length };
    const spec = (c) => {
      const b = c.b, f = c.f;
      return { x: f.x, z: f.z, y: Math.min(b.h - 2.2, b.FH * 2 + 1.6),
        // where a MAP-DESIGNATED round actually lands: militaryvehicles.js
        // resolves a waypoint against this same shell registry and seats the
        // warhead in the middle storeys. The camera has to agree with it or the
        // impact plate frames a floor the cloud never reached.
        hitY: Math.min(b.h - 1.6, Math.max(3.4, b.h * 0.45)),
        nx: f.nx, nz: f.nz, tx: -f.nz, tz: f.nx,
        width: f.width, h: b.h, storeys: b.storeys, ox: b.ox, oz: b.oz };
    };
    const rpg = spec(cands[0]);
    const far = cands.find((c) => c.b !== cands[0].b &&
      Math.hypot(c.b.ox - rpg.ox, c.b.oz - rpg.oz) > 140 && c.b.storeys >= 6) ||
      cands.find((c) => c.b !== cands[0].b) || cands[0];
    const target = spec(far);

    // ---- the battery -------------------------------------------------------
    // The launcher lives at the island motor pool, which is the right home for
    // it and the wrong backdrop for a photograph of a city strike: the flight
    // would cross open water and the "impact" would be a parking deck. It is a
    // TRUCK. So we board it and drive it to the street, which is exactly what a
    // player does, and stage the launch from there.
    const armed = recs.filter((r) => r && r.kind === "patriot");
    const plain = recs.filter((r) => r && r.kind === "ground");
    const pool = (armed.length ? armed : plain).slice()
      .sort((a, b) => (a.pos.x - b.pos.x) || (a.pos.z - b.pos.z));
    const vehicle = pool[0] || null;
    if (!vehicle) return { ok: false, err: "no motor-pool truck" };

    // firing position: back off the target face, on its outward side, so the
    // round crosses the block and the tower is ahead of the truck's nose. Take
    // the first candidate that is dry, standing in the open and still inside
    // the built-up area — a launcher parked in a meadow photographs a meadow.
    let fx = target.x + target.nx * 235 + target.tx * 42;
    let fz = target.z + target.nz * 235 + target.tz * 42;
    let fireScore = -1e9;
    for (const D of [200, 225, 250, 275]) {
      for (const L of [8, 42, -42, 74, -74, 110, -110]) {
        const cx = target.x + target.nx * D + target.tx * L;
        const cz = target.z + target.nz * D + target.tz * L;
        if (wet(cx, cz) || solidAt(cx, groundAt(cx, cz) + 2.2, cz, 7)) continue;
        // The flight plate is shot from the middle of the arc, so the middle of
        // the arc is what has to be over the city — a launcher 220 m from a
        // downtown tower can still be standing at a marina, and then the
        // "city strike" is photographed over a boat dock and a mountain range.
        const mx = (cx + target.x) / 2, mz = (cz + target.z) / 2;
        const sc = density(cx, cz) * 2 + density(mx, mz) * 3 - (wet(mx, mz) ? 60 : 0);
        if (sc > fireScore) { fireScore = sc; fx = cx; fz = cz; }
      }
    }

    const hud = document.createElement("div");
    hud.id = "__patriotHud";
    hud.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;color:#f6f9fb;text-shadow:0 2px 10px rgba(0,0,0,.85);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    hud.innerHTML = "<div data-side></div><div data-name></div><div data-state></div><div data-detail></div>";
    document.body.appendChild(hud);

    /* EVERY CAMERA IS DECIDED NOW, WHILE THE CITY IS STILL INTACT.

       clearEye/towerEye answer "can this tripod see the facade" by raycasting
       CBZ.losBlockers — and a breach REMOVES walls from that set. So the two
       sides were choosing their tripods against different worlds: the after
       side's first candidate could see through the hole it had just made and
       took it, the before side found that same line blocked and fell to a
       fallback several buildings away. MEASURED: the aftermath pair came back
       with one plate of the wounded tower and one of the inside of a car park.
       A comparison whose camera moves BECAUSE of the change under test is not a
       comparison. Both sides now resolve identical geometry, once, up here. */
    const fireHeading = Math.atan2(target.x - fx, target.z - fz);
    const fireY = groundAt(fx, fz);
    const atTruck = (px, pz, h, py, lx, ly, lz) => {
      const c = Math.cos(h), sn = Math.sin(h);
      return { x: px + lx * c + lz * sn, y: py + ly, z: pz - lx * sn + lz * c };
    };
    const truckCam = (px, pz, h, py, tries, look) => {
      for (const t of tries) {
        const e = atTruck(px, pz, h, py, t[0], t[1], t[2]);
        if (solidAt(e.x, e.y, e.z, 1.2)) continue;
        return { eye: e, look: atTruck(px, pz, h, py, look[0], look[1], look[2]), fov: look[3] };
      }
      return { eye: atTruck(px, pz, h, py, tries[0][0], tries[0][1], tries[0][2]),
        look: atTruck(px, pz, h, py, look[0], look[1], look[2]), fov: look[3] };
    };
    // the deterministic arc, from the tube transform the round really leaves
    const q0 = atTruck(fx, fz, fireHeading, fireY, -0.53, 3.5, -2.63);
    const q3 = { x: target.x, y: target.hitY, z: target.z };
    const qdx = q3.x - q0.x, qdz = q3.z - q0.z, qd = Math.hypot(qdx, qdz) || 1;
    const qux = qdx / qd, quz = qdz / qd;
    const qrise = Math.max(38, Math.min(240, 26 + qd * 0.23));
    const qapex = Math.max(q0.y, q3.y) + qrise;
    const qapp = Math.min(90, Math.max(16, qd * 0.26));
    const q1 = { x: q0.x + qux * Math.min(10, qd * 0.06), y: qapex, z: q0.z + quz * Math.min(10, qd * 0.06) };
    const q2 = { x: q3.x - qux * qapp, y: qapex - qrise * 0.08, z: q3.z - quz * qapp };
    const cub = (u) => {
      const v = 1 - u, vv = v * v, uu = u * u;
      return { x: vv * v * q0.x + 3 * vv * u * q1.x + 3 * v * uu * q2.x + uu * u * q3.x,
        y: vv * v * q0.y + 3 * vv * u * q1.y + 3 * v * uu * q2.y + uu * u * q3.y,
        z: vv * v * q0.z + 3 * vv * u * q1.z + 3 * v * uu * q2.z + uu * u * q3.z };
    };
    const qdur = Math.max(2.0, Math.min(9, 1.35 + qd / 135));   // aircraft.js's own pacing
    const qmid = cub(0.42), qpx = -quz, qpz = qux;
    const flightSide = (o) => ({ x: qmid.x + qpx * 16 * o + qux * 12, y: qmid.y + 6, z: qmid.z + qpz * 16 * o + quz * 12 });
    let flightEye = flightSide(1);
    if (solidAt(flightEye.x, flightEye.y, flightEye.z, 2)) flightEye = flightSide(-1);

    const cams = {
      rpgWide: towerEye(rpg),
      rpgClose: clearEye(rpg, [[21, 0.4, 7, 54], [24, 1.2, 11, 54], [19, 0.2, -7, 56], [27, 2, -14, 54],
        [31, 3, 18, 52], [23, 1, 0, 56], [34, 4, -22, 52], [28, 2.5, 22, 54]]),
      launcher: truckCam(vehicle.pos.x, vehicle.pos.z, vehicle.heading || 0, vehicle.pos.y || 0,
        [[12.5, 5.0, -10.0], [-12.5, 5.0, -10.0], [13.5, 6.0, 8.0], [-13.5, 6.0, 8.0], [15, 8, -16]], [0, 2.1, -0.8, 44]),
      launch: truckCam(fx, fz, fireHeading, fireY,
        [[21, 9, -21], [-21, 9, -21], [23, 11, 13], [-23, 11, 13]], [0, 8.5, -2.0, 52]),
      flight: { eye: flightEye, look: { x: qmid.x - qux * 4, y: qmid.y - 1, z: qmid.z - quz * 4 }, fov: 48 },
      impact: clearEye(Object.assign({}, target, { y: target.hitY }),
        [[44, 4, 20, 54], [38, 3, 14, 56], [52, 7, 28, 52], [34, 2, -14, 58], [62, 11, -34, 50]]),
      aftermath: towerEye(target),
    };

    S = window.__patriotSeq = {
      rpg, target, vehicle, hud, cams, fire: { x: fx, z: fz }, fireHeading, fireY, flightDur: qdur, simT: null,
      rpgDone: false, moved: false, driving: false, launched: false, hit: false, t: 0, ht: 0,
    };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }

  const pose = (eye, look, fov) => {
    const cam = CBZ.camera;
    cam.aspect = input.width / input.height; cam.fov = fov || 50; cam.near = 0.25; cam.far = 20000;
    cam.position.set(eye.x, eye.y, eye.z); cam.lookAt(look.x, look.y, look.z); cam.updateProjectionMatrix();
    if (CBZ.skySync) CBZ.skySync();
    CBZ.renderer.render(CBZ.scene, cam);
  };
  const shoot = (c) => pose(c.eye, c.look, c.fov);
  // Put the launcher on the street pointing at the target, once.
  const deployTruck = () => {
    if (S.moved) return;
    const r = S.vehicle;
    r.pos.x = S.fire.x; r.pos.z = S.fire.z; r.pos.y = S.fireY;
    r.heading = S.fireHeading;          // the exact heading the stored cameras were built on
    r.v = 0;
    if (r.group) { r.group.position.set(r.pos.x, r.pos.y, r.pos.z); r.group.rotation.set(0, r.heading, 0); }
    S.moved = true;
  };
  const board = () => {
    deployTruck();
    if (S.driving) return;
    try { CBZ.cityDriveArmor(S.vehicle); } catch (_) {}
    S.driving = true;
    seconds(0.25);              // let the rack slew toward the designated point
  };
  const designate = () => {
    if (!CBZ.fullMap || !CBZ.fullMap.setWaypoint) return;
    CBZ.fullMap.setWaypoint(S.target.x, S.target.z, "Patriot target");
    // Navigation is allowed to snap a click to a nearby door; fire control is
    // not, and the BEFORE side is still navigation. Hold the point exact so the
    // reticle sits on the same pixel on both plates.
    const wp = CBZ.fullMap.points && CBZ.fullMap.points.city;
    if (wp) { wp.x = S.target.x; wp.z = S.target.z; }
  };
  /* ONE CLOCK FOR BOTH SIDES. The impact beat used to wait for the ledger to
     report a hit — which only ever happens on the AFTER side, so the before
     plate was photographed several simulated SECONDS earlier than its pair.
     That is not a small thing: traffic, pedestrians, the day ramp and the
     distance-LOD pass all move in that gap, and the aftermath pair came back
     with two different-looking cities. The arc is deterministic (it is the same
     arithmetic aircraft.js flies), so the schedule can be too: both sides step
     to the same second since launch and the after side simply has a missile in
     the air while it does. */
  const advanceTo = (t) => {
    if (S.simT == null) S.simT = 0;
    if (t > S.simT) { seconds(t - S.simT); S.simT = t; }
  };
  const fire = () => {
    // Deploy and designate on BOTH sides, always. The before side has no
    // battery to fire, but it must still have driven the same truck to the
    // same street and put the reticle on the same building, or every plate
    // downstream is photographed from a different place than its pair — and
    // the pair is the entire point of the tool.
    board(); designate();
    if (S.simT == null) S.simT = 0;
    if (S.launched || !patriotOn()) return;
    try { S.launched = CBZ.cityArmorFire() !== false; } catch (_) { S.launched = false; }
  };
  function patriotOn() { return !CBZ.CONFIG || CBZ.CONFIG.PATRIOT_V1 !== false; }
  const flightAudit = () => (CBZ.cityPatriotMissileAudit ? CBZ.cityPatriotMissileAudit() : {});

  const id = input.subject.id;
  const on = patriotOn();
  if (CBZ.fullMap && CBZ.fullMap.active && id !== "fire-control") { try { CBZ.fullMap.close(false); } catch (_) {} }
  daylight();
  clean();
  S.hud.style.display = id === "fire-control" ? "none" : "block";

  let state = "";
  if (id === "rpg-facade" || id === "rpg-close") {
    const w = S.rpg;
    if (!S.rpgDone) {
      parkPlayer(w);
      CBZ.detonate(w.x + w.nx * 0.1, w.y, w.z + w.nz * 0.1, "rpg", { byPlayer: true, dirx: -w.nx, dirz: -w.nz });
      S.rpgDone = true; S.t = 0;
    }
    if (S.t < 5) { seconds(5 - S.t); S.t = 5; }
    dryOut(); daylight(); clean();
    shoot(id === "rpg-close" ? S.cams.rpgClose : S.cams.rpgWide);
    state = on ? "one rocket · the bay is gone · concrete in the street"
               : "one rocket · glass facade refuses to open · tower unmarked";
  } else if (id === "launcher") {
    // photographed WHERE IT LIVES — this plate runs before deployTruck(), so
    // the rack is seen in the motor pool it was minted in, alongside the tanks
    // and the plain trucks it has to read as a sibling of.
    dryOut();
    shoot(S.cams.launcher);
    state = on ? "MIM-104 Patriot · four live tubes on the army chassis"
               : "ordinary covered motor-pool truck · no weapon";
  } else if (id === "fire-control") {
    board(); designate();
    try { CBZ.fullMap.open(); CBZ.fullMap.draw(); } catch (_) {}
    const root = document.getElementById("fullMap");
    if (root) root.style.visibility = "";
    state = on ? "the shared waypoint, armed" : "navigation only";
  } else if (id === "launch") {
    fire();
    advanceTo(0.15);                    // the round climbs fast off a 45-degree rail
    dryOut(); daylight(); clean();
    shoot(S.cams.launch);
    state = on ? "off the rail · pooled round · smoke train building"
               : "no launcher, no round";
  } else if (id === "flight") {
    fire();
    /* AHEAD AND OFF THE SHOULDER, looking back down the track — the framing
       that survived three that did not. Square to the flight the train runs
       straight off the edge of the frame; from 42 m up and out the round is
       45 px of pale cream projected onto the street 60 m beneath it and reads
       as litter on a crossing. From ahead of it the train recedes INTO frame
       and converges, which is the whole read Meteor Shower gets for free from
       a falling rock. The tripod itself is fixed at setup (see EVERY CAMERA IS
       DECIDED NOW), so all this beat does is walk the round into it. */
    advanceTo(S.flightDur * 0.42);
    dryOut(); daylight(); clean();
    shoot(S.cams.flight);
    state = on ? "lofted route · body and train read against the block"
               : "same sky, same second · nothing was fired";
  } else if (id === "impact" || id === "aftermath") {
    fire();
    // 0.45 s past arrival is out of the flash and into the fire; 5 s is after
    // the cloud has cleared off the wound.
    advanceTo(S.flightDur + (id === "impact" ? 0.45 : 5.0));
    S.hit = (flightAudit().impacts || 0) > 0;
    dryOut(); daylight(); clean();
    shoot(id === "impact" ? S.cams.impact : S.cams.aftermath);
    state = on
      ? (id === "impact" ? "the RPG row blooms at contact, not a white-out" : "open bay · exposed structure · heap in the street")
      : "the designated facade · nothing reached it";
  }

  // read the live ledgers AFTER the world is where the shot wants it
  const fa = CBZ.cityFacadeBreachAudit ? CBZ.cityFacadeBreachAudit() : {};
  const da = CBZ.cityDebrisAudit ? CBZ.cityDebrisAudit() : {};
  const ra = CBZ.cityRuinAudit ? CBZ.cityRuinAudit() : {};
  const pa = CBZ.cityPatriotAudit ? CBZ.cityPatriotAudit() : {};
  const ma = flightAudit();

  if (id !== "fire-control") {
    const before = input.side === "before";
    const q = (n) => S.hud.querySelector("[data-" + n + "]");
    q("side").textContent = before ? input.beforeLabel : input.afterLabel;
    q("side").style.cssText = "position:absolute;top:20px;left:24px;padding:7px 12px;border-radius:7px;background:" +
      (before ? "#b0453e" : "#1f7d59") + ";font-size:12px;font-weight:900;letter-spacing:.13em";
    q("name").textContent = input.subject.label;
    q("name").style.cssText = "position:absolute;left:25px;bottom:74px;font-size:23px;font-weight:850";
    q("state").textContent = state;
    q("state").style.cssText = "position:absolute;left:26px;bottom:50px;color:#dfeaf1;font-size:12.5px;font-weight:650";
    q("detail").textContent =
      "facade " + (fa.openings || 0) + " openings / " + (fa.curtainOpenings || 0) + " curtain bays / " +
      (fa.openArea || 0) + " m² open · ruin " + (ra.jaggedPieces || 0) + " slabs / " + (ra.exposedBars || 0) + " bars" +
      " · debris " + (da.shedPieces || 0) + " shed / " + (da.inventedPieces || 0) + " invented / x" + (da.conservation || 0) +
      " · Patriot " + (pa.tubes || 0) + " tubes / " + (ma.launches || 0) + " away / " + (ma.impacts || 0) + " impacts";
    q("detail").style.cssText = "position:absolute;left:26px;bottom:27px;color:#a4bac8;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  }

  return { ok: true, state, debug: { fa: fa, ma: ma, pa: pa, target: S.target, rpg: S.rpg },
    metrics: {
      facadeOpenArea: Number(fa.openArea || 0),
      curtainBays: Number(fa.curtainOpenings || 0),
      panesLost: Number(fa.panesLost || 0),
      fakeInteriorCleared: Number(fa.glowPanelsCleared || 0),
      ruinSlabs: Number(ra.jaggedPieces || 0),
      exposedBars: Number(ra.exposedBars || 0),
      patriotTubes: Number(pa.tubes || 0),
      mapFireControl: (CBZ.fullMap && CBZ.fullMap.patriotContext && CBZ.fullMap.patriotContext()) ? 1 : 0,
      missileLaunches: Number(ma.launches || 0),
      missileImpacts: Number(ma.impacts || 0),
      debrisShed: Number(da.shedPieces || 0),
      debrisInvented: Number(da.inventedPieces || 0),
      debrisVolume: Number(da.shedVolume || 0),
      rimCellsKept: Number(da.keptRimCells || 0),
    } };
}

export default {
  id: "patriot-building",
  title: "Buildings That Actually Break + Patriot Fire Control",
  description: "One seeded city, three reversible flags, eight matched states. BEFORE restores the facade that no ordnance in the game could open, the box-rubble wound and the weaponless motor-pool truck. AFTER photographs a real multi-storey breach in a glass curtain wall, its reinforced-concrete anatomy, a four-tube Patriot on the army chassis, the shared map as fire control, a lofted flight and an impact that spends the RPG row the owner asked for by name.",
  beforeLabel: "BEFORE · UNBREAKABLE FACADE / NO BATTERY",
  afterLabel: "AFTER · REAL BREACH / PATRIOT",
  pairNote: "Same seed, same buildings, same cameras, same simulated second; only STRUCT_CURTAIN_BREACH_V1, STRUCT_RPG_RUIN_V2 and PATRIOT_V1 change",
  defaultBefore: "local",
  beforeParams: { cfg_STRUCT_CURTAIN_BREACH_V1: 0, cfg_STRUCT_RPG_RUIN_V2: 0, cfg_PATRIOT_V1: 0, cfg_DEBRIS_CONSERVED_V1: 0 },
  afterParams: { cfg_STRUCT_CURTAIN_BREACH_V1: 1, cfg_STRUCT_RPG_RUIN_V2: 1, cfg_PATRIOT_V1: 1, cfg_DEBRIS_CONSERVED_V1: 1 },
  urlParams: { seed: 90210 },
  viewport: { width: 1200, height: 740 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  stageTimeoutMs: 600000,
  metricsNote: "Every number is read from a live canonical ledger at the moment of the shot: cityFacadeBreachAudit walks buildings.js's own breach records, cityRuinAudit walks crashfx's persistent ruin frames, and the launch/impact counts come from the shared aircraft missile pool. The before column reporting zero open facade area is the defect this wave fixes, not a staging artifact.",
  metrics: {
    facadeOpenArea: { label: "Facade actually opened", unit: "m²", better: "higher" },
    curtainBays: { label: "Curtain-wall bays breached", better: "higher" },
    panesLost: { label: "Panes blown out", better: "higher" },
    fakeInteriorCleared: { label: "Fake-interior panels pulled from holes", better: "higher" },
    ruinSlabs: { label: "Persistent jagged slab pieces", better: "higher" },
    exposedBars: { label: "Exposed reinforcement bars", better: "higher" },
    patriotTubes: { label: "Real launcher tube transforms", better: "higher" },
    mapFireControl: { label: "Map in fire-control context", unit: "1=yes", better: "higher" },
    missileLaunches: { label: "Map-designated launches", better: "higher" },
    missileImpacts: { label: "Designated impacts", better: "higher" },
    debrisShed: { label: "Debris cut from removed material", better: "higher" },
    debrisInvented: { label: "Debris invented from nothing", better: "lower" },
    debrisVolume: { label: "Volume of shed material", unit: "m³", better: "higher" },
    rimCellsKept: { label: "Rim cells that survived (the ragged edge)", better: "higher" },
  },
  subjects,
  stage: stagePatriot,
};
