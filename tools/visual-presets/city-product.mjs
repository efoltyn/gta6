/* Gang City — PRODUCT PHOTOGRAPHY, shot by the engine.

   Store covers for Gang City (index.html?mode=city). No generated art, no
   edits to gameplay: the real seeded city is booted like a player boots it,
   the clock is pinned, and three scenes are STAGED with the game's own verbs
   (cityPostNpc for the crews, cityMakeCar + cityMarkCruiser for the cruisers,
   cityAddStars for Air-1, cineCam for the lens) and then photographed with
   the title as the only overlay.

   Portal rules this obeys (docs.crazygames.com/requirements/game-covers):
     16:9 1920x1080 · 1:1 800x800 · 2:3 800x1200 — no borders, no text but the
     title, no icons. Every subject fits its own lens to the ratio ba asks for.

   Run (one ba at a time — the city build is ~30 s of CPU):
     ba city-product --before local --only after --width 1920 --height 1080 \
        --out ~/harness/out/gta6/portal/city --no-open --cdp-timeout 600000
     ... and again with --width 800 --height 800, --width 800 --height 1200.

   HARNESS TRAP: stage() is SERIALIZED into the page by toString(), so nothing
   in this module's scope is reachable inside it. Every knob rides on
   input.subject or is a literal in the function. */

const subjects = [
  {
    id: "cover-skyline", label: "Downtown at dusk",
    phase: 0.525,
    focus: "The Midtown core and the 52-storey tower from 100 m over an arterial avenue at the end of the day: lit windows, signals, headlights on the grid, the sunset fog behind the skyline.",
  },
  {
    id: "cover-street", label: "A standoff on the street",
    phase: 0.47,
    focus: "Two crews in their colours, guns up, seven metres apart in the road at golden hour. The lens is low behind one crew's shoulder, looking into the other.",
  },
  {
    id: "cover-chase", label: "The chase",
    phase: 0.56,
    focus: "The player's car flat out down the avenue after dark, a cruiser on its flank, a lit roadblock and its officers dead ahead, Air-1 overhead. The lens is low behind the hero car.",
  },
];

async function stageCityProduct(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, error: "no CBZ/THREE" };
  const sub = input.subject || {};
  const TITLE = "GANG CITY";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) { try { if (test()) return true; } catch (_) {} await wait(stepMs || 250); }
    return false;
  };
  const notes = [];
  const tick = (n, dt) => {
    const step = dt || 1 / 60;
    for (let i = 0; i < n; i++) {
      if (CBZ.game && CBZ.game.state === "paused") { try { CBZ.setState("playing"); } catch (_) {} }
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      // the day is 150 s long (daynight.js CYCLE): a clock pinned once rolls
      // into afternoon during a 100 s wait for Air-1, so it is pinned per tick
      try { if (CBZ.dayPhase && sub.phase != null) CBZ.dayPhase(sub.phase); } catch (_) {}
      try { CBZ.stepSim(step); } catch (_) {}
      if (CBZ.player) { CBZ.player.dead = false; CBZ.player.hp = 100; }
    }
  };

  // ---- boot once per page --------------------------------------------------
  let S = window.__cityProduct;
  if (!S) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
      document.querySelector('[data-mode="city"]'), 360000);
    if (!booted) return { ok: false, error: "never booted" };
    if (CBZ.CONFIG) { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; CBZ.CONFIG.GANG_PERSIST = false; CBZ.CONFIG.CONTROLS_AUTO = false; }
    document.querySelector('[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, error: "never reached playing" };
    await until(() => { const c = document.getElementById("bootload"); return !c || getComputedStyle(c).display === "none"; }, 30000, 50);
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
    try { if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    tick(60);
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.root || !A.roads) return { ok: false, error: "city arena missing" };
    // a clean frame: the game canvas and the title, nothing else (and the
    // "click to capture the mouse" pill state.js re-shows every frame)
    const st = document.createElement("style"); st.id = "cityProductNoHint";
    st.textContent = "#lockHint{display:none!important}"; document.head.appendChild(st);
    const title = document.createElement("div"); title.id = "cityProductTitle"; document.body.appendChild(title);
    S = window.__cityProduct = { A, title };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }
  // THE FRAME IS THE CANVAS AND THE TITLE. The HUD is not one element: the
  // player card and the speedo are appended to the body AFTER boot, so this
  // runs at the end of every subject, not once — everything on the canvas's
  // ancestor chain keeps its siblings hidden.
  const hideChrome = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    let el = canvas;
    while (el && el.parentElement) {
      for (const sib of Array.from(el.parentElement.children)) {
        if (sib === el || sib === S.title || sib.tagName === "SCRIPT" || sib.tagName === "STYLE") continue;
        sib.style.setProperty("display", "none", "important");
      }
      el = el.parentElement;
      if (el === document.body) break;
    }
  };
  hideChrome();
  const A = S.A, P = CBZ.player, camera = CBZ.camera, cc = CBZ.cineCam;
  const aspect = input.width / input.height, portrait = aspect < 1;
  const ROAD = A.ROAD || 18;
  const groundY = (x, z) => { try { return A.vehicleSurfaceY ? A.vehicleSurfaceY(x, z) : (A.groundHeightAt ? A.groundHeightAt(x, z) : 0); } catch (_) { return 0; } };
  const shot = { x: 0, y: 2, z: 0, lx: 0, ly: 1, lz: 1, fov: 50 };
  // half the HORIZONTAL field of view for this frame: every "at the edge of
  // the frame" placement derives from it, so a 1:1 or 2:3 crop keeps the
  // subject instead of losing it off the side (measured: a fixed 143 m aim
  // offset put the tower at 15% of a 16:9 frame and off the edge of a square)
  const halfH = () => Math.atan(Math.tan(shot.fov * Math.PI / 360) * aspect);
  const applyShot = (snap) => {
    if (cc) { cc.active = true; cc.x = shot.x; cc.y = shot.y; cc.z = shot.z; cc.lx = shot.lx; cc.ly = shot.ly; cc.lz = shot.lz; if (snap) cc.snap = true; }
  };
  const aimFinal = () => {
    camera.aspect = aspect; camera.fov = shot.fov; camera.near = 0.05;
    camera.far = Math.max(camera.far || 1400, 4500);
    camera.position.set(shot.x, shot.y, shot.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(shot.lx, shot.ly, shot.lz);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    try { if (CBZ.skySync) CBZ.skySync(); } catch (_) {}
  };
  const hidePlayer = () => { if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false; };
  const pin = (phase) => { try { if (CBZ.dayPhase) CBZ.dayPhase(phase); } catch (_) {} };
  const heading = (fromX, fromZ, toX, toZ) => Math.atan2(toX - fromX, toZ - fromZ);   // yaw: forward = (sin, cos)

  // undo the previous subject's mess: stars, cops, Air-1, the wheel
  try { if (P && P.driving && CBZ.cityExitVehicle) CBZ.cityExitVehicle(); } catch (_) {}
  try { if (CBZ.cityWantedReset) CBZ.cityWantedReset(); } catch (_) {}
  try { if (CBZ.cityClearChopper) CBZ.cityClearChopper(); } catch (_) {}
  if (cc) cc.active = false;
  pin(sub.phase);
  try { if (CBZ.cityGlassNight) CBZ.cityGlassNight(true); } catch (_) {}
  const result = { ok: true, subject: sub.id, staged: true, notes };

  if (sub.id === "cover-skyline") {
    // ---- the tower and the core from over an avenue -------------------------
    const pad = CBZ.cityHelipad ? CBZ.cityHelipad() : null;
    const tower = pad ? { x: pad.x, z: pad.z, h: pad.y } : { x: A.center.x, z: A.center.z, h: 120 };
    // the sun sets in -X (daynight.js: sun.x = cos(ang)*80): stand EAST of the
    // tower, over the city's eastern edge, 60 m up — above every ordinary
    // roof (12 storeys, 38 m) and under the tower's shoulders — looking west
    // across Midtown into the burn with the tower against the sky
    const dist = portrait ? 250 : (aspect > 1.4 ? 205 : 225);
    shot.fov = portrait ? 56 : 48;
    const zOff = portrait ? 40 : 55;
    shot.x = tower.x + dist; shot.z = tower.z + zOff;
    shot.y = Math.max(groundY(shot.x, shot.z) + 22, portrait ? 60 : 46);
    // looking west, screen-right is -z: the tower is wanted on the LEFT edge
    // of the frame, clear of the title (which spans the middle 46%), so the
    // view axis is swung south of it by the angle that puts it at that
    // screen x for THIS frame's horizontal fov
    const wantNdc = aspect > 1.4 ? -0.70 : -0.64;
    const theta = Math.atan(-wantNdc * Math.tan(halfH()));
    const beta = Math.atan2(zOff, dist);
    shot.lx = tower.x; shot.lz = shot.z - dist * Math.tan(beta + theta);
    shot.ly = portrait ? 50 : 16;   // tilted down: the horizon in the upper third, the city across the frame
    // the player's budget under the lens so the fleet and the peds live there
    if (P && P.pos) { P.driving = false; P.pos.set(A.center.x, groundY(A.center.x, A.center.z) + 0.9, A.center.z); }
    CBZ.cityFogFar = 4200;
    hidePlayer();
    applyShot(true);
    tick(300);
    hidePlayer();
    CBZ.cityFogFar = 4200;
    aimFinal();
    result.camera = [shot.x, shot.y, shot.z].map((v) => +v.toFixed(1));
    result.tower = tower;
    let lit = 0; try { const a = CBZ.carLampAudit && CBZ.carLampAudit(); lit = a ? a.lit : 0; } catch (_) {}
    result.metrics = { carsLit: lit, nightAmount: +(CBZ.nightAmount || 0).toFixed(2) };
  } else if (sub.id === "cover-street") {
    // ---- two crews across seven metres of a Midtown cross-street -----------
    const road = A.roads.filter((r) => !r.vertical).sort((a, b) => Math.abs(a.z - A.center.z) - Math.abs(b.z - A.center.z))[0];
    const xs = A.xLines.slice().sort((a, b) => Math.abs(a - A.center.x) - Math.abs(b - A.center.x));
    // mid-block east of the central junction, in the near-side lanes
    const bx = (xs[0] + (xs[0] < 0 ? -1 : 1) * (A.step || 52) * 0.5) || 26;
    const bz = road.z + 3.2;
    const y0 = groundY(bx, bz);
    if (P && P.pos) { P.driving = false; P.pos.set(bx, y0 + 0.9, bz + 7.5); }
    hidePlayer();
    // traffic through the standoff: every car inside 60 m is stopped and hidden
    const parkAway = () => {
      for (const c of CBZ.cityCars || []) {
        if (!c || !c.pos || c.player || c.owned) continue;
        if (Math.hypot(c.pos.x - bx, c.pos.z - bz) < 60) { c.v = 0; c.ai = false; c._stagedOff = true; if (c.group) c.group.visible = false; }
      }
    };
    parkAway();
    const gangs = CBZ.CITY && CBZ.CITY.gangs ? CBZ.CITY.gangs : [];
    const gA = gangs.find((g) => g.id === "saints") || gangs[0] || { id: "a", color: 0xc0392b };
    // NOT the Crips: a blue shirt under a blue cap photographs as a patrolman
    const gB = gangs.find((g) => g.id === "kings") || gangs[2] || { id: "b", color: 0xe0b020 };
    const crews = [];
    const weapons = ["AK-47", "Pistol", "SMG", "Pistol", "AK-47"];
    const post = (gang, x, z, faceX, faceZ, i) => {
      let p = null;
      try {
        p = CBZ.cityPostNpc(x, z, {
          src: "stage:standoff", rng: Math.random, parent: A.root,
          kind: "gang", gang: gang.id, faction: gang.id, outfit: gang.color,
          guard: { x, z }, homeGuard: { x, z }, wealth: 0.5, aggr: 0.9,
          archetype: "gangster", job: "gang soldier", armed: true, weapon: weapons[i % weapons.length],
          hp: 120, face: heading(x, z, faceX, faceZ), pin: true,
        });
      } catch (e) { notes.push("post " + (e && e.message)); }
      if (!p) return null;
      p.ammo = 40; p.armed = true; p.weapon = weapons[i % weapons.length];
      if (p.pos) p.pos.y = y0;
      crews.push(p);
      return p;
    };
    // crew A (west, facing east) and crew B (east, facing west), a loose line each
    // crew A stands either side of the lens (its two nearest men are the frame's
    // edges), crew B fills the middle nine metres out; in portrait the near
    // men are pulled in toward the axis so one shoulder survives the crop
    const gap = 6.5;
    shot.fov = portrait ? 58 : 55;
    const back = portrait ? 3.2 : (aspect > 1.4 ? 3.0 : 2.8);   // portrait: further back, or the two near shoulders fill the frame
    const camZ = bz + 0.6;
    // the two near men are the frame's edges: 72% of the half-fov off the
    // axis at the lens's own distance behind the line, whatever the ratio
    const edge = back * Math.tan(0.72 * halfH());
    const aZ = [camZ - edge - bz, camZ + edge - bz, camZ - edge - 2.4 - bz];
    const lineA = [[-gap / 2, aZ[0]], [-gap / 2 - 0.4, aZ[1]], [-gap / 2 + 1.0, aZ[2]]];
    const lineB = [[gap / 2, -0.8], [gap / 2 + 1.5, 1.4], [gap / 2 + 2.0, -2.6], [gap / 2 + 3.2, 2.8]];
    const a = lineA.map((o, i) => post(gA, bx + o[0], bz + o[1], bx + 20, bz + o[1], i));
    const b = lineB.map((o, i) => post(gB, bx + o[0], bz + o[1], bx - 20, bz + o[1], i + 1));
    tick(30);
    // guns up, at each other: the game's own aim seam, snapped (no dt)
    const aimAll = () => {
      const pairs = [[a[0], b[0]], [a[1], b[1]], [a[2], b[2]], [b[0], a[0]], [b[1], a[1]], [b[2], a[2]], [b[3], a[0]]];
      for (const [p, q] of pairs) {
        if (!p || !q) continue;
        try { if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p); } catch (_) {}
        try { if (CBZ.actorHolster) CBZ.actorHolster(p, false); } catch (_) {}
        try { if (CBZ.actorAimAt) CBZ.actorAimAt(p, q); } catch (_) {}
        if (p.staffPost && p.group) p.staffPost.face = p.group.rotation.y;
        p._faceT = 0; p.state = "idle"; p.speed = 0;
      }
    };
    aimAll(); tick(20); aimAll(); parkAway();
    for (const p of crews) { if (p && p.pos) { p.pos.y = y0; } }
    // the lens: low, over crew A's shoulder, looking into crew B
    shot.x = bx - gap / 2 - back; shot.z = camZ; shot.y = y0 + 1.55;
    shot.lx = bx + gap / 2 + 1.2; shot.lz = bz + 0.4; shot.ly = y0 + (portrait ? 1.15 : 1.2);
    applyShot(true);
    tick(4);
    aimAll();
    hidePlayer(); parkAway();
    aimFinal();
    // anyone else inside the frame's near field
    for (const p of CBZ.cityPeds || []) {
      if (!p || !p.pos || crews.indexOf(p) >= 0) continue;
      const g2 = p.group || (p.char && p.char.group);
      if (g2 && Math.hypot(p.pos.x - shot.x, p.pos.z - shot.z) < 6) g2.visible = false;
    }
    const diag = [];
    for (const p of crews) {
      if (!p) { diag.push(null); continue; }
      p.enterT = 0; p._spawnHidden = false; if (p.group) p.group.visible = true;
      diag.push({ x: +p.pos.x.toFixed(1), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(1), vis: !!(p.group && p.group.visible),
        inRoot: !!(p.group && p.group.parent === A.root), inPeds: (CBZ.cityPeds || []).indexOf(p) >= 0, dead: !!p.dead, culled: !!p.culled,
        state: p.state, d: +Math.hypot(p.pos.x - shot.x, p.pos.z - shot.z).toFixed(1), kids: p.group ? p.group.children.length : 0 });
    }
    result.crew = diag;
    result.metrics = { crewPosted: crews.filter(Boolean).length, armed: crews.filter((p) => p && p.armed).length,
      crewVisible: diag.filter((d) => d && d.vis && d.inRoot && !d.dead).length };
    result.camera = [shot.x, shot.y, shot.z].map((v) => +v.toFixed(1));
  } else if (sub.id === "cover-chase") {
    // ---- the player's car down the avenue, two cruisers, Air-1 ----------------
    const ave = A.roads.filter((r) => r.vertical).sort((a, b) => Math.abs(a.x - A.center.x) - Math.abs(b.x - A.center.x))[0];
    const zs = A.zLines.slice().sort((a, b) => a - b);
    // start at the south end so a long straight run lies ahead (north = +z)
    const startZ = zs[0] + 0.45 * (A.step || 52);
    const lane = (CBZ.roadLaneCenter ? CBZ.roadLaneCenter(ave, 1, 1) : 3.6 * 1.5);
    const hx = ave.x + lane, hz = startZ;
    let car = null;
    try { car = CBZ.citySpawnOwnedCar(hx, hz, "Falcone Tempesta"); } catch (e) { notes.push("spawn " + (e && e.message)); }
    if (!car) { try { car = CBZ.citySpawnOwnedCar(hx, hz); } catch (_) {} }
    if (!car) return { ok: false, error: "no hero car" };
    car.heading = 0; car.vertical = true; if (car.group) car.group.rotation.y = 0;
    try { if (CBZ.cityRecolorCar) CBZ.cityRecolorCar(car, 0xd8262e); } catch (_) {}
    if (P && P.pos) { P.driving = false; P.pos.set(car.pos.x + 1.6, P.pos.y, car.pos.z); }
    try { CBZ.cityEnterVehicle(car); } catch (e) { notes.push("enter " + (e && e.message)); }
    // HARNESS TRAP: the boarding walk is a sim-bounded loop; under memory
    // pressure a tick can take a second, so every chase loop is ALSO
    // wall-bounded (two portrait captures timed out at 600 s before this)
    const tChase = Date.now();
    for (let i = 0; i < 480 && Date.now() - tChase < 60000; i++) { tick(1); if (P && P.driving && P._vehicle === car && i > 20) break; }
    if (!(P && P.driving && P._vehicle === car)) notes.push("never boarded");
    try { if (CBZ.carFpSetView) CBZ.carFpSetView(false); } catch (_) {}
    try { if (CBZ.controls && CBZ.controls.hide) CBZ.controls.hide(); } catch (_) {}
    const actor = (CBZ.city && CBZ.city.playerActor) || P;
    const cruisers = [];
    const mkCruiser = (x, z, yaw) => {
      let c = null;
      try { c = CBZ.cityMakeCar(x, z, yaw, true, CBZ.cityCruiserModel ? CBZ.cityCruiserModel() : null, 0.3); } catch (e) { notes.push("cruiser " + (e && e.message)); }
      if (!c) return null;
      try { if (CBZ.cityMarkCruiser) CBZ.cityMarkCruiser(c); } catch (_) {}
      c.ai = false; c.reckless = true; c._pursuit = true; c.v = 0; c.heading = yaw;
      if (c.group) c.group.rotation.y = yaw;
      cruisers.push(c);
      return c;
    };
    const bars = (t) => {
      const on = ((t * 6) | 0) & 1;
      cruisers.forEach((c, i) => { const rb = c && c._rbBar; if (!rb) return; const o = on ^ (i & 1); if (rb.red) rb.red.visible = !!o; if (rb.blue) rb.blue.visible = !o; if (rb.mid) rb.mid.visible = true; });
    };
    // heat: Air-1 lifts at 3 stars; the slow-response hold and its altitude are URL cfg
    try { if (CBZ.cityAddStars) CBZ.cityAddStars(4, "staged chase"); } catch (_) {}
    if (CBZ.CONFIG) CBZ.CONFIG.POLICE_HELI_SLOW_RESPONSE = false;
    // "overhead" means IN THE AIR over the chase, not sitting on the tower's
    // pad 80 m away and 170 m up (which is where the first pass found it)
    // Air-1 sits on its precinct pad (30 m up, ~130 m from this avenue) before
    // it lifts, climbs over the tower (175 m) and comes down to its orbit
    // altitude: "arrived" is OFF THE PAD, LOW, and inside the orbit radius
    // (measured: the orbit runs ~100 m out at this altitude)
    const pad0 = (CBZ.cityChopperPos && CBZ.cityChopperPos()) || null;
    const near = () => {
      const h = CBZ.cityChopperPos && CBZ.cityChopperPos();
      if (!h) return null;
      const agl = h.y - (car.pos.y || 0);
      const offPad = !pad0 || Math.hypot(h.x - pad0.x, h.z - pad0.z) > 45 || Math.abs(h.y - pad0.y) > 30;
      return (offPad && Math.hypot(h.x - car.pos.x, h.z - car.pos.z) < 135 && agl > 10 && agl < 60) ? h : null;
    };
    const t0 = Date.now(); let simT = 0;
    while (!near() && simT < 45 && Date.now() - t0 < 100000) {   // measured: it lifts by ~36 s; a longer wait timed out the capture on a loaded box
      tick(10, 1 / 20); simT += 0.5;
      if ((CBZ.game.wanted | 0) < 3) { try { CBZ.cityAddStars(4, "staged chase"); } catch (_) {} }
      car.v = 0;
    }
    const h0 = near();
    result.heli = h0 ? { x: +h0.x.toFixed(1), y: +h0.y.toFixed(1), z: +h0.z.toFixed(1), waitedSimS: simT } : { waitedSimS: simT, arrived: false, last: CBZ.cityChopperPos && CBZ.cityChopperPos() };
    result.heli.pad = pad0;
    // Air-1 orbits the player: hold the car until the bird is in the sector
    // the lens will look into (ahead of the car, within 35 degrees of north)
    const ahead = () => {
      const h = CBZ.cityChopperPos && CBZ.cityChopperPos();
      if (!h) return false;
      const dx = h.x - car.pos.x, dz = h.z - car.pos.z, d = Math.hypot(dx, dz);
      return d > 12 && d < 140 && dz > 0 && Math.abs(Math.atan2(dx, dz)) < 0.55;
    };
    let waitAhead = 0;
    if (h0) { while (!ahead() && waitAhead < 15 && Date.now() - t0 < 130000) { tick(4, 1 / 20); waitAhead += 0.2; car.v = 0; } }
    result.heli.aheadAfterS = +waitAhead.toFixed(1); result.heli.ahead = ahead();
    // the run: a short sprint (~34 m), the roadblock 24 m past its end
    const SPD = 27, SPRINT = 75, rbZ = hz + SPD * SPRINT / 60 + 24;
    for (const c of CBZ.cityCars || []) {
      if (!c || !c.pos || c === car) continue;
      const dz = c.pos.z - car.pos.z, dx = c.pos.x - ave.x;
      if (dz > -30 && dz < 150 && Math.abs(dx) < ROAD / 2 + 1) { c.v = 0; c.ai = false; if (c.group) c.group.visible = false; c.pos.x += 400; c.group.position.x += 400; }
    }
    // the roadblock: two cruisers nosed in across the northbound lanes, bars
    // lit, three officers behind them with guns on the hero
    mkCruiser(ave.x + lane - 4.4, rbZ, 0.85);
    mkCruiser(ave.x + lane + 5.2, rbZ + 0.8, -0.85);
    const cops = [];
    for (const [ox, oz] of [[-4.8, 3.8], [0.6, 4.6], [5.6, 4.0]]) {
      let cop = null;
      try { cop = CBZ.citySpawnCop(ave.x + lane + ox, rbZ + oz, false); } catch (e) { notes.push("cop " + (e && e.message)); }
      if (cop) cops.push(cop);
    }
    const aimCops = () => {
      for (const cop of cops) {
        try { if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(cop); } catch (_) {}
        try { if (CBZ.actorHolster) CBZ.actorHolster(cop, false); } catch (_) {}
        try { if (CBZ.actorAimAt && actor) CBZ.actorAimAt(cop, actor); } catch (_) {}
      }
    };
    // the pursuit on the flank: one cruiser in the left lane, nose at the hero's rear axle
    const tail = mkCruiser(ave.x + lane + 3.1, hz - 2.0, 0);
    const frame = () => {
      const back = portrait ? 11.5 : (aspect > 1.4 ? 8.0 : 9.0);
      shot.x = car.pos.x - (portrait ? 1.2 : 1.6); shot.z = car.pos.z - back; shot.y = (car.pos.y || 0) + (portrait ? 2.0 : 1.05);
      // tilted up: the roadblock in the lower middle, sky and Air-1 above it
      shot.lx = car.pos.x + 0.6; shot.lz = car.pos.z + 24; shot.ly = (car.pos.y || 0) + (portrait ? 7.0 : 5.0);
      shot.fov = portrait ? 60 : 56;
    };
    for (let i = 0; i < SPRINT; i++) {
      car.heading = 0; if (car.group) car.group.rotation.y = 0;
      car.v = SPD; car.pos.x = hx;
      if (tail) {
        tail.heading = 0; tail.v = SPD;
        tail.pos.x = ave.x + lane + 3.1; tail.pos.z = car.pos.z - 2.0;
        if (tail.group) { tail.group.position.set(tail.pos.x, tail.group.position.y, tail.pos.z); tail.group.rotation.y = 0; }
      }
      for (const c of cruisers) { if (c && c !== tail) c.v = 0; }
      bars(i / 60);
      if (i % 10 === 0) aimCops();
      frame();
      applyShot(true);
      tick(1);
    }
    aimCops();
    bars(0.05);
    frame();
    aimFinal();
    const h1 = CBZ.cityChopperPos && CBZ.cityChopperPos();
    let heliInFrame = 0;
    if (h1) { const v = new T.Vector3(h1.x, h1.y, h1.z).project(camera); heliInFrame = (v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95) ? 1 : 0; result.heli.ndc = [+v.x.toFixed(2), +v.y.toFixed(2)]; }
    result.metrics = { stars: CBZ.game.wanted | 0, cruisers: cruisers.filter(Boolean).length, cops: cops.length, heliInFrame,
      heliOverhead: h1 && Math.hypot(h1.x - car.pos.x, h1.z - car.pos.z) < 90 && (h1.y - (car.pos.y || 0)) < 90 ? 1 : 0,
      heliAgl: h1 ? +(h1.y - (car.pos.y || 0)).toFixed(1) : -1, speed: +(car.v || 0).toFixed(1), roadblockGapM: +(rbZ - car.pos.z).toFixed(1) };
    result.camera = [shot.x, shot.y, shot.z].map((v) => +v.toFixed(1));
  }

  // ---- the title: the one word the portal allows on a cover ---------------
  hideChrome();
  const title = S.title;
  const px = Math.round(Math.min(innerWidth * 0.135, innerHeight * 0.17));
  title.style.cssText = "position:fixed;z-index:2147483647;top:" + (portrait ? 5 : 4.5) + "%;left:3%;right:3%;text-align:center;color:#fff;" +
    "font-family:Fredoka,'Arial Black',Arial,sans-serif;font-weight:900;font-size:" + px + "px;line-height:.9;letter-spacing:-.04em;" +
    "text-shadow:0 5px 0 #4a0a12,0 12px 30px rgba(0,0,0,.9);pointer-events:none;white-space:nowrap";
  title.textContent = TITLE;
  return result;
}

export default {
  id: "city-product",
  title: "Gang City — in-engine product photography",
  description: "Store covers for Gang City, staged in the shipped build: the skyline at dusk from over an avenue, a crew standoff at golden hour, and a four-star chase after dark with cruisers and Air-1. Every pixel is the game rendering its own city; the title is the only overlay.",
  beforeLabel: "SOURCE GAME", afterLabel: "PRODUCT CAPTURE",
  viewport: { width: 1920, height: 1080 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { mode: "city", seed: 90326, cfg_BOOT_METER: 0, cfg_POLICE_HELI_SLOW_RESPONSE: 0, cfg_POLICE_HELI_ALTITUDE: 24 },
  stageTimeoutMs: 600000,
  pairNote: "Every pixel is the game rendering its own seeded city · title is the only overlay",
  method: "The runner boots the registered Gang Life mode with requestAnimationFrame frozen and CBZ.stepSim as the only clock, pins the day clock per subject, and stages each cover with the game's own verbs: cityPostNpc + actorAimAt for the crews, citySpawnOwnedCar + cityEnterVehicle + cityMakeCar/cityMarkCruiser for the chase, cityAddStars for Air-1, cineCam for the lens.",
  metrics: {}, metricsNote: "Product captures, not a gameplay score.",
  subjects, stage: stageCityProduct,
};
