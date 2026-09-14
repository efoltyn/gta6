/* prison-product.mjs — PRISON ESCAPE, PRODUCT PHOTOGRAPHY SHOT BY THE ENGINE.

   Store covers for the standalone Prison Escape (Cell Block Z) release. No
   generated art, no mock-ups: the real escape mode is booted from its own
   title screen, the compound is staged the way a director would stage it
   (men moved, an hour pinned, a searchlight re-aimed) and the game's own
   renderer takes the picture. The title is the only text on the frame.

   Portal rules (docs.crazygames.com/requirements/game-covers): 16:9
   1920x1080, 2:3 800x1200, 1:1 800x800 — no borders, no text but the
   title, no icons. Every subject frames itself off input.width/height, so
   one run per ratio is the whole job:

     ba prison-product --before local --only after --width 1920 --height 1080 --out ~/harness/out/gta6/portal/prison
     ba prison-product --before local --only after --width 800 --height 800  --out ~/harness/out/gta6/portal/prison-1x1
     ba prison-product --before local --only after --width 800 --height 1200 --out ~/harness/out/gta6/portal/prison-2x3

   THREE COVERS.
     cover-yard    the north yard from the NW tower deck at 09:30, over the
                   rail and the wire: the population on the yard, the far
                   tower, the wall, the block behind it.
     cover-fight   the centre hall of the cell house, over your shoulder:
                   three men on you, the front one's fist at your face and
                   a shank in the next one's hand, the tier watching.
     cover-escape  23:30 at the recreation yard's wire: you with your hands
                   up in a yard searchlight re-aimed onto you from 73 m,
                   the pool at your feet, the razor coil over your head.

   HOW THE THREE WERE FOUND (each is a measured frame, not a guess): the
   staging ran in a live probe world (tools/probe.mjs --serve --mode escape,
   under a private CBZ_PROBE_LOCK) and every camera was looked at before it
   was baked here. What the looking taught, so it is not re-learned:
     · a guard on the tower deck with the lens: impossible — the deck is a
       ring around the cabin, so any second man on it is beside the lens
       or behind the glazing; the yard cover has no foreground figure;
     · the fight from the side was a tangle of overlapping heads; over
       the shoulder, with you at the frame's edge, it reads at a glance;
     · the searchlit man was BLACK from any lens that was not on the
       light's side of him — r128 Lambert is per vertex, a body lit from
       the south-east shows nothing to a lens in the north-west. The lens
       stands east of him, along the wire, where his lit flank faces it;
     · the sweep's cone is 6 m wide at the ground; at 73 m that is a
       sheet, not a beam — it is scaled to 0.55 for the frame.

   STAGING TRAPS this file carries (all measured on other presets):
     · stage() is SERIALIZED into the page — nothing from module scope is
       reachable inside it; every knob rides on input.subject or is a
       literal in the function.
     · the prison reveal (camera.js INTRO) is 3.55 s of sim and its
       completion disarms first person; step past it BEFORE posing.
     · FIRST-PERSON OVERRIDE: systems/fpsmode.js writes the camera at
       always-order 52, after camera.js at 50 — setFPS(false) for any
       scripted lens, and CAM_TIGHT_FP=false or a hall auto-drops into FP.
     · the camera is written AFTER the last stepSim and the frame rendered
       by hand, so no system gets a turn to move it; the first-person hands
       ride CBZ.camera as children and are hidden for the frame.
     · escape mode's day is 720 s long — pin the hour every half second of
       settle or the sun walks.
     · the sun's shadow box follows the live camera in play; a lens 60 m
       from the player photographs an unshadowed yard unless the sun is
       re-targeted at the aim point (prison-exterior's trick). */

const TITLE = "PRISON ESCAPE";

const subjects = [
  { id: "cover-yard", label: "The yard from the tower", act: "yard", hour: 9.5,
    focus: "09:30 from the NW tower deck. A screw at the rail, the population on the yard below, the far tower and the wall, the cell house behind. The frame should read as a place with rules and a lot of men under them." },
  { id: "cover-fight", label: "A fight in the block", act: "fight", hour: 10,
    focus: "The centre hall of the cell house, belt-height lens an arm's length from the exchange: you in the orange, two men on you, a fist in flight, the tier watching from the gallery." },
  { id: "cover-escape", label: "At the wire, in the beam", act: "escape", hour: 23.5,
    focus: "Lights out at the west wire. A man with his hands on the chain-link, the razor coil over him, and a tower searchlight re-aimed onto him — the pool on the ground, the beam across the dark." },
];

async function stageProduct(input) {
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
  const sub = input.subject;
  const W = input.width || innerWidth, H = input.height || innerHeight;
  const aspect = W / H;
  const portrait = aspect < 0.9, square = aspect >= 0.9 && aspect < 1.3;

  // ---- one-time boot: the real title screen, the real escape mode --------
  let S = window.__productSeq;
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
    for (const id of ["bootload", "loading"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
    CBZ.CONFIG.CAM_TIGHT_FP = false;     // a hall must not auto-drop the lens into first person
    CBZ.CONFIG.JAIL_GRAB_P = 0;          // the fight cover wants fists, not a grab
    // past the 3.55 s reveal, with the morning pinned so the compound wakes up lit
    for (let i = 0; i < 300; i++) {
      if (i % 30 === 0) { try { CBZ.dayPhase((9.5 - 6) / 24); } catch (_) {} }
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
    }
    if (CBZ.setFPS) CBZ.setFPS(false);
    S = window.__productSeq = { hour: 9.5 };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }
  if (CBZ.game.state !== "playing") return { ok: false, err: "run not playing: " + CBZ.game.state };

  // ---- the clock, the men, the lens -------------------------------------
  const P = CBZ.player, PC = CBZ.playerChar;
  const pin = (h) => { try { if (CBZ.dayPhase) CBZ.dayPhase(((h - 6) / 24 + 1) % 1); } catch (_) {} };
  const step = (n, h) => {
    for (let i = 0; i < n; i++) {
      if (h != null && i % 30 === 0) pin(h);
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      P.hp = 100; P.dead = false; P.stun = 0;
      CBZ.stepSim(1 / 60);
      if (CBZ.fps && CBZ.fps.active && CBZ.setFPS) CBZ.setFPS(false);
    }
    if (h != null) pin(h);
  };
  const alive = (n) => n && n.group && n.char && !n.dead && !n.escaped && !n._crowd && !(n.ko > 0) &&
    (n.kind === "inmate" || n.role === "inmate");
  const inmates = () => (CBZ.npcs || []).filter(alive);
  const guards = () => (CBZ.guards || []).filter((g) => g && g.group && g.char && !g.dead);
  const stand = (n) => {
    try { if (n.char && (n.char.sitting || n.char.lying) && CBZ.setCharPose) CBZ.setCharPose(n.char, "stand"); } catch (_) {}
    try { if (n._propLie && CBZ.propWake) CBZ.propWake(n, { instant: true }); } catch (_) {}
    try { if (n._propSeat && CBZ.propStand) CBZ.propStand(n, { instant: true }); } catch (_) {}
    n._propSeat = null; n._propBed = null; n._propLie = null; n.pause = 0; n.social = null;
    n.aiState = "wander"; n.aiTimer = 30; n.fleeT = 0; n.foe = null; n.jumpBlows = 0; n._jumpGrabbed = 0; n._blow = null;
    n.huntPlayer = 0; if (n.char) { n.char.fightStance = false; n.char.handsUp = false; }
  };
  const put = (n, x, z, y) => {
    n.group.position.set(x, y || 0, z);
    if (n.target && n.target.set) n.target.set(x, y || 0, z);
    if (n._phys) { n._phys.kx = 0; n._phys.kz = 0; }
  };
  const faceTo = (n, x, z) => { n.group.rotation.y = Math.atan2(x - n.group.position.x, z - n.group.position.z); };
  const placePlayer = (x, z, y) => {
    P.pos.set(x, y || 0, z); P.vy = 0; P.grounded = true;
    if (PC && PC.group) PC.group.position.set(x, y || 0, z);
  };
  const facePlayer = (x, z) => {
    CBZ.cam.yaw = Math.atan2(-(x - P.pos.x), -(z - P.pos.z)); CBZ.cam.pitch = 0;
    if (PC && PC.group) PC.group.rotation.y = Math.atan2(x - P.pos.x, z - P.pos.z);
  };
  const byDistance = (list, x, z) => list.slice().sort((a, b) =>
    Math.hypot(a.group.position.x - x, a.group.position.z - z) - Math.hypot(b.group.position.x - x, b.group.position.z - z));
  // a seeded scatter so the same run photographs the same crowd
  let seed = 90210;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  // the lens: written after the last step, rendered by hand
  const camera = CBZ.camera;
  const shoot = (pos, aim, fov, roll) => {
    camera.fov = fov; camera.aspect = aspect; camera.near = 0.12; camera.far = 1200;
    camera.position.set(pos.x, pos.y, pos.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(aim.x, aim.y, aim.z);
    if (roll) camera.rotateZ(roll * Math.PI / 180);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    for (const child of camera.children) child.visible = false;      // the first-person hands
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    else { const rig = CBZ.skyDome && CBZ.skyDome.parent; if (rig && rig.position) rig.position.set(pos.x, 0, pos.z); }
    try {
      const sun = CBZ.sun || (CBZ.lights && CBZ.lights.sun);
      if (sun && sun.target && sun.shadow) {
        const ox = sun.position.x - sun.target.position.x, oy = sun.position.y - sun.target.position.y, oz = sun.position.z - sun.target.position.z;
        sun.target.position.set(aim.x, 0, aim.z);
        sun.position.set(aim.x + ox, oy, aim.z + oz);
        sun.target.updateMatrixWorld(true);
        sun.shadow.camera.updateProjectionMatrix();
      }
    } catch (_) {}
  };

  let note = {};
  if (sub.act === "yard") {
    /* THE YARD FROM THE TOWER. The population is walked into the yard by
       hand (the schedule would take a sim-hour to do it), given three
       seconds to settle into their own idles. The lens stands on the south
       walkway of the NW yard tower at the rail and looks out over the
       yard: the wall's wire runs away under it on the left, the far tower
       closes the wall, the cell house is behind. (A screw at the rail was
       tried and cut: the deck is a ring — world/prisonkit.js deck R 3.25,
       cabin R 2.15 — so a lens on it only ever sees another man on it
       BESIDE the frame or through the cabin's glazing.) */
    const N = CBZ.WORLD.northYard;
    pin(sub.hour);
    const men = inmates();
    const groups = [
      { x: -14, z: 30, r: 3.2 }, { x: 6, z: 22, r: 3.6 }, { x: -3, z: 41, r: 2.8 },
      { x: 16, z: 36, r: 3.0 }, { x: 12, z: 12, r: 2.6 }, { x: -18, z: 16, r: 2.4 }, { x: 2, z: 31, r: 3.4 },
      { x: -8, z: 8, r: 2.2 }, { x: 22, z: 26, r: 2.4 }, { x: -20, z: 44, r: 2.0 }, { x: 8, z: 46, r: 2.6 },
    ];
    men.forEach((n, i) => {
      stand(n);
      const g = groups[i % groups.length];
      const a = rnd() * Math.PI * 2, r = g.r * Math.sqrt(rnd());
      put(n, g.x + Math.cos(a) * r, g.z + Math.sin(a) * r);
      faceTo(n, g.x, g.z);
      n.pause = 2 + rnd() * 4;
    });
    // you, in the middle of it, two men squaring up
    placePlayer(0, 26); facePlayer(0, 20);
    const close = byDistance(men, 0, 26).slice(0, 2);
    close.forEach((n, i) => { put(n, (i ? 1.3 : -1.1), 24.6); faceTo(n, 0, 26); n.huntPlayer = 30; n.hitCD = 2.5; });
    // guards on post in the yard
    const gs = guards();
    const yardGuards = byDistance(gs, 0, 30).slice(0, 3);
    const posts = [{ x: -22, z: 44, fx: 0, fz: 26 }, { x: 24, z: 10, fx: 0, fz: 26 }, { x: 0, z: 2, fx: 0, fz: 26 }];
    yardGuards.forEach((g, i) => { const p = posts[i]; put(g, p.x, p.z); faceTo(g, p.fx, p.fz); g.pause = 8; g.hunt = 0; });
    step(180, sub.hour);
    // the lens on the south walkway of the NW yard tower, at the rail, over the wire
    const deckY = (CBZ.TOWER_DECK != null ? CBZ.TOWER_DECK : 12.5) + 0.265;
    const tower = { x: N.x0, z: N.z1 };                                  // NW yard tower (world/towers.js)
    const ca = sub.camA != null ? sub.camA : -108, cr = sub.camR != null ? sub.camR : 2.4;
    const camPos = { x: tower.x + Math.cos(ca * Math.PI / 180) * cr, y: deckY + (sub.camUp != null ? sub.camUp : 2.0), z: tower.z + Math.sin(ca * Math.PI / 180) * cr };
    const aim = portrait ? { x: 1, y: -1.0, z: 24 } : square ? { x: 2, y: 0.5, z: 22 } : { x: 3, y: 1.5, z: 20 };
    if (sub.aim) Object.assign(aim, sub.aim);
    if (PC && PC.group) PC.group.visible = true;
    shoot(camPos, aim, sub.fov || (portrait ? 62 : square ? 56 : 50));
    note = { men: men.length, guards: gs.length, deckY, camera: camPos };
  } else if (sub.act === "fight") {
    /* THE FIGHT. The centre hall of the cell house (world/cellblock.js:
       x[-4.1,4.1], the spine at (0,-30)). Over your shoulder: you in the
       orange, back to the lens, three men squaring up in front of you with
       the block watching from behind them and the galleries over it all.
       The frame is taken on the front man's drive peak, your own fist in
       flight at him. */
    pin(sub.hour);
    const hx = 0, hz = -27;
    const men = inmates();
    men.forEach(stand);
    placePlayer(hx, hz); facePlayer(hx, hz - 4);
    if (CBZ.setFPS) CBZ.setFPS(false);
    const near = byDistance(men, hx, hz);
    const fighters = near.slice(0, 3);
    const slots = [{ x: hx - 0.25, z: hz - 1.45 }, { x: hx - 1.45, z: hz - 1.9 }, { x: hx + 1.15, z: hz - 2.1 }];
    fighters.forEach((n, i) => {
      put(n, slots[i].x, slots[i].z);
      faceTo(n, hx, hz); n.huntPlayer = 40; n.hitCD = i === 0 ? 0.3 : 1.3 + i * 0.5; n.char.fightStance = true;
    });
    const ring = near.slice(3, 15);
    ring.forEach((n, i) => {
      const a = (-80 + (i / Math.max(1, ring.length - 1)) * 160) * Math.PI / 180;   // an arc on the north side
      const r = 4.6 + (i % 3) * 0.7;
      put(n, hx + Math.sin(a) * r, hz - 1.2 - Math.cos(a) * r);
      faceTo(n, hx, hz); n.pause = 9; n.aiState = "wander"; n.aiTimer = 12;
      if (n.char) n.char.fightStance = i % 3 === 0;
    });
    // the beat: step until the front man's fist is at its drive peak, with yours in flight at him
    let framed = false, frames = 0, swinger = null;
    for (let f = 0; f < 480 && !framed; f++) {
      step(1);
      frames++;
      placePlayer(hx, hz, P.pos.y); facePlayer(hx, hz - 4);
      fighters.forEach((n, i) => {
        const d = Math.hypot(n.group.position.x - slots[i].x, n.group.position.z - slots[i].z);
        if (d > 0.35) put(n, slots[i].x, slots[i].z, n.group.position.y);
        faceTo(n, hx, hz);
        n.huntPlayer = 40;
      });
      const c = fighters[0].char;
      if (c.punchT > 0 && c.punchDur > 0) {
        const prog = 1 - c.punchT / c.punchDur;
        if (prog < 0.08 && !swinger) {
          swinger = fighters[0];
          try { P.hitLock = 0; P.stun = 0; fighters[0].hitCD = 9; CBZ.punch(fighters[0]); } catch (_) {}
        }
        if (swinger && prog >= (sub.peak || 0.42)) framed = true;
      }
    }
    if (PC && PC.group) PC.group.visible = true;
    for (const n of fighters) n.group.visible = true;
    // over your right shoulder, a little above your eye, looking down the hall at the men
    const camPos = { x: hx + (sub.camX != null ? sub.camX : 1.3), y: sub.camY != null ? sub.camY : (portrait ? 1.7 : 1.6), z: hz + (sub.back || (portrait ? 1.8 : 1.45)) };
    const aim = { x: hx + 0.25, y: portrait ? 1.1 : 1.15, z: hz - 2.9 };
    if (sub.aim) Object.assign(aim, sub.aim);
    shoot(camPos, aim, sub.fov || (portrait ? 66 : square ? 60 : 56), sub.roll != null ? sub.roll : -3);
    note = { frames, framed, swinger: !!swinger, yourPunch: PC ? PC.punchKind : null, yourPunchT: PC ? PC.punchT : null,
      men: fighters.map((n) => n.group.position.toArray().map((v) => +v.toFixed(2))) };
  } else if (sub.act === "escape") {
    /* THE WIRE. 23:30 on the recreation yard's south fence
       (world/prisongrounds.js: ring x[-112,-46] z[-100,-12], 4.2 m
       chain-link with a razor coil on top), at its east end where the line
       of sight to the NW yard tower clears the industries shop. You, hands
       on the mesh, and that tower's searchlight (entities/searchlight.js —
       its own head, spot, cone and pool) re-aimed onto you from 78 m, so
       the beam comes in over the wire from the upper right and the pool is
       at your feet. The lens is inside the yard, east of you along the wire, low. */
    const spot = { x: sub.x != null ? sub.x : -58, z: sub.z != null ? sub.z : -12.72 };
    pin(sub.hour);
    for (const n of inmates()) { if (Math.hypot(n.group.position.x - spot.x, n.group.position.z - spot.z) < 16) { stand(n); put(n, n.group.position.x - 10, n.group.position.z - 22); } }
    for (const g of guards()) { if (Math.hypot(g.group.position.x - spot.x, g.group.position.z - spot.z) < 20) { put(g, g.group.position.x - 10, g.group.position.z - 26); g.pause = 12; g.hunt = 0; } }
    // the beam: the light nearest the wire, aimed at the man
    const lights = (CBZ.searchlights || []).filter((s) => s && s.spot && s.cone && s.pool);
    let sl = null, best = 1e9;
    for (const s of lights) { const d = Math.hypot(s.gx - spot.x, s.gz - spot.z); if (d < best) { best = d; sl = s; } }
    // caught: he turns toward the light, hands up — a quarter turn short of it, toward the lens, so the
    // face Lambert lights (his front) is the face the lens sees (measured: square to the light he was a sliver)
    const faceX = spot.x + (sub.faceDx != null ? sub.faceDx : 14), faceZ = spot.z + (sub.faceDz != null ? sub.faceDz : 12);
    placePlayer(spot.x, spot.z); facePlayer(faceX, faceZ);
    if (CBZ.game) CBZ.game.detection = 0;
    step(sub.settle || 150, sub.hour);              // the night lighting settles, the masts come up
    placePlayer(spot.x, spot.z, P.pos.y); facePlayer(faceX, faceZ);
    if (PC) { PC.handsUp = true; }
    try { if (CBZ.animChar && PC) for (let i = 0; i < 40; i++) CBZ.animChar(PC, 0, 1 / 60); } catch (_) {}
    if (sl) {
      const HY = sl.head.position.y;
      const tx = spot.x, tz = spot.z - 0.6;
      sl.target.set(tx, 0, tz); sl.tgt.position.copy(sl.target);
      sl.pool.position.x = tx; sl.pool.position.z = tz;
      const dir = sl.target.clone().sub(new T.Vector3(sl.gx, HY, sl.gz));
      const len = dir.length();
      sl.cone.scale.y = len / 14;
      sl.cone.scale.x = sl.cone.scale.z = sub.coneWidth || 0.55;      // a tighter beam than the sweep's 6 m base
      sl.cone.position.set((sl.gx + tx) / 2, HY / 2, (sl.gz + tz) / 2);
      sl.cone.lookAt(sl.target); sl.cone.rotateX(Math.PI / 2);
      sl.spot.distance = len + 30; sl.spot.intensity = sub.beam || 9; sl.spot.angle = sub.beamAngle || 0.065; sl.spot.penumbra = 0.5;
      sl.cone.material.opacity = sub.coneAlpha || 0.4; sl.pool.material.opacity = 0.34;
      sl.cone.material.color.setHex(0xfff3c0); sl.pool.material.color.setHex(0xfff3c0);
      sl.disabled = 0;
      // core/matrixskip.js gates updateMatrixWorld; updateWorldMatrix is the ungated path (the batch.js trap)
      for (const o of [sl.tgt, sl.cone, sl.pool, sl.spot]) { try { o.updateWorldMatrix(true, true); } catch (_) { o.updateMatrixWorld(true); } }
      note.beamFrom = { x: sl.gx, z: sl.gz, y: HY, len: Math.round(len) };
    }
    if (PC && PC.group) PC.group.visible = true;
    // east of him along the wire, low, looking west: the side of him the beam lights, the coil over him, the beam
    // coming in past the lens. (Measured: Lambert is per vertex — a lens west or north of him saw only unlit faces.)
    const camPos = { x: spot.x - (sub.camDx != null ? sub.camDx : (portrait ? -4.2 : -5.0)), y: sub.camY != null ? sub.camY : (portrait ? 1.2 : 1.1), z: spot.z - (sub.camDz != null ? sub.camDz : (portrait ? 1.5 : 1.6)) };
    const aim = { x: spot.x - 0.4, y: portrait ? 2.2 : 2.1, z: spot.z + 0.2 };
    if (sub.aim) Object.assign(aim, sub.aim);
    shoot(camPos, aim, sub.fov || (portrait ? 58 : square ? 52 : 48));
    note.spot = spot; note.night = { phase: CBZ.dayPhase(), sunH: CBZ.sunHeight };
  }

  // ---- clean frame: the canvas and the title, nothing else ---------------
  const canvas = CBZ.renderer && CBZ.renderer.domElement;
  for (const el of Array.from(document.body.children)) {
    if (el === canvas || (canvas && el.contains && el.contains(canvas))) continue;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    if (el.id === "prisonProductTitle" || el.id === "prisonProductBand") continue;
    el.style.setProperty("display", "none", "important");
  }
  if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (_) {} }
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);

  // ---- the title: the one thing the portal allows on a cover --------------
  let band = document.getElementById("prisonProductBand");
  if (!band) { band = document.createElement("div"); band.id = "prisonProductBand"; document.body.appendChild(band); }
  band.style.cssText = "position:fixed;z-index:2147483646;left:0;right:0;top:0;height:" + (portrait ? 34 : square ? 32 : 36) + "%;pointer-events:none;background:linear-gradient(180deg,rgba(4,8,14,.62) 0%,rgba(4,8,14,.38) 55%,rgba(4,8,14,0) 100%)";
  let title = document.getElementById("prisonProductTitle");
  if (!title) { title = document.createElement("div"); title.id = "prisonProductTitle"; document.body.appendChild(title); }
  const px = Math.round(portrait ? W * 0.20 : square ? W * 0.155 : Math.min(W * 0.105, H * 0.19));
  title.style.cssText = "position:fixed;z-index:2147483647;left:0;right:0;top:" + (portrait ? 5.5 : square ? 5 : 5) + "%;" +
    "text-align:center;color:#fff;font-family:Impact,'Arial Narrow Bold','Helvetica Neue Condensed Black','Arial Black',sans-serif;" +
    "font-weight:900;font-size:" + px + "px;line-height:0.9;letter-spacing:0.02em;text-transform:uppercase;" +
    "text-shadow:0 0 2px #000,0 4px 0 #101317,0 8px 0 #101317,0 14px 34px rgba(0,0,0,.85);pointer-events:none;white-space:nowrap";
  title.innerHTML = "";
  const w1 = document.createElement("span"), w2 = document.createElement("span");
  w1.textContent = "PRISON"; w2.textContent = "ESCAPE";
  w2.style.color = "#ff8a1f";
  title.appendChild(w1);
  if (portrait || square) { title.appendChild(document.createElement("br")); } else { title.appendChild(document.createTextNode(" ")); }
  title.appendChild(w2);
  title.style.display = "";

  return { ok: true, subject: sub.id, width: W, height: H, ...note, scripted: true };
}

export default {
  id: "prison-product",
  title: "Prison Escape — in-engine product photography",
  description: "Store covers for the standalone Prison Escape release, staged in the shipped build: the yard from a tower, a fight in the cell house, and a man at the wire in a searchlight at lights-out. The lens is fitted for whatever ratio the run asks for; the title is the only overlay.",
  beforeLabel: "SOURCE GAME", afterLabel: "PRODUCT CAPTURE",
  pairNote: "Every pixel is the game rendering its own compound · title is the only overlay",
  viewport: { width: 1920, height: 1080 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  metrics: {}, metricsNote: "Product captures, not a gameplay score.",
  subjects,
  stage: stageProduct,
};
