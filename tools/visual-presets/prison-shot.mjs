/* prison-shot.mjs — WHAT A BODY DOES WHEN A ROUND HITS IT, IN THE JAIL, as film strips.

   OWNER (2026-11-22): "improve movement and the way people ragdoll when shot
   to be much more real movement getting shot"

   One plate is ONE event: the scenario is run once from a fixed start and
   the same side camera photographs it at fixed times after the (first)
   round into a 3x2 strip. The line under each frame is read off the live
   game on that frame: the rig's fall (variant / phase / style), whether the
   body is asleep, whether he is hurt-posed, how far he has travelled.

   The rounds go in through the functions the player's gun calls on an
   inmate in the jail today (systems/fpsmode.js gunHit, which is private):
     survivor: CBZ.verbs.shot (shotLiving) -> CBZ.vitals.wound (vitalsRound)
               -> CBZ.knockback, with the blood (CBZ.gore.spray, CBZ.bodyWound)
     the kill: CBZ.vitals.wound -> CBZ.aiKill(a, {group: you}, {noKnock, exit,
               shot}) -- `shot` is the record the new gunHit hands aiKill (the
               round's line, zone, calibre, weapon, range, point); HEAD's
               aiKill ignores the key, exactly as HEAD's gunHit never passed it.
   In the jail CBZ.vitals decides whether a round kills (the head 90%, the
   heart ~10-15%, a riddled chest); the killed strips stage the lethal roll.
   The player strip uses CBZ.shootPlayer, a screw's round.
   BEFORE = BA_BEFORE_REF (default HEAD) on its own port. */

const CAL = { sidearm: 0.8, ak47: 1.6, shotgun: 1.5 };

const SCN = {
  torso:  { label: "Pistol into the chest, standing: he lives", gun: "sidearm", gap: 6, rounds: [{ t: 0, at: "chest" }], times: [0.05, 0.2, 0.45, 0.9, 1.8, 3.2] },
  leg:    { label: "Pistol into the right thigh, standing", gun: "sidearm", gap: 6, rounds: [{ t: 0, at: "legR" }], times: [0.04, 0.15, 0.35, 0.7, 1.3, 2.6] },
  head:   { label: "Head shot, standing: dead on the spot", gun: "sidearm", gap: 6, kill: true, rounds: [{ t: 0, at: "head" }], times: [0.03, 0.12, 0.25, 0.45, 0.8, 1.8] },
  rifle:  { label: "Rifle into the chest, standing: killed", gun: "ak47", gap: 9, kill: true, rounds: [{ t: 0, at: "chest" }], times: [0.05, 0.2, 0.4, 0.65, 1.0, 2.2] },
  runner: { label: "Shot in the back at a run: killed", gun: "ak47", gap: 8, kill: true, run: 4.6, rounds: [{ t: 0, at: "back" }], camAhead: 1.6, times: [0.05, 0.2, 0.4, 0.7, 1.1, 2.2] },
  shotgun:{ label: "Shotgun from two metres: killed", gun: "shotgun", gap: 2, kill: true, rounds: [{ t: 0, at: "chest" }], camAhead: 0.6, times: [0.04, 0.15, 0.3, 0.55, 0.9, 2.0] },
  three:  { label: "Three pistol rounds inside a second", gun: "sidearm", gap: 6, rounds: [{ t: 0, at: "chest", dx: 0.06 }, { t: 0.33, at: "chest", dx: -0.08 }, { t: 0.66, at: "chest", dx: 0.0 }], times: [0.1, 0.4, 0.75, 1.1, 1.8, 3.2] },
  wall:   { label: "Killed standing, his back a step from a wall", gun: "sidearm", gap: 6, kill: true, wall: 0.55, rounds: [{ t: 0, at: "chest" }], times: [0.05, 0.2, 0.4, 0.65, 1.0, 2.2] },
  player: { label: "You, shot by a screw: a round, then one that floors you", player: true, gap: 8, rounds: [{ t: 0, dmg: 28 }, { t: 1.2, dmg: 90 }], times: [0.05, 0.3, 0.9, 1.3, 1.7, 2.8] },
};

const subjects = Object.keys(SCN).map((id) => ({ id, label: SCN[id].label, scn: id, cfg: SCN[id], hud: false, focus: SCN[id].label }));

async function stageShot(input) {
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
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__shotOverlay" || child.id === "__shotStrip") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__shotSeq;
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
    const overlay = document.createElement("div");
    overlay.id = "__shotOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__shotSeq = { overlay, used: new Set() };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
    try { if (CBZ.dayPhase) CBZ.dayPhase((11 - 6) / 24); } catch (_) {}
    for (let i = 0; i < 600; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    CBZ.CONFIG.CAM_TIGHT_FP = false;
    if (CBZ.setFPS) CBZ.setFPS(false);
  }

  const P = CBZ.player, V = CBZ.verbs;
  const sub = input.subject, cfg = sub.cfg;
  let YARD = { x: 0, z: 30 };
  if (cfg.wall) {
    // a wall that faces down the lane (+z), with ten clear metres in front of it
    if (!S.wallLane) {
      const open = (x, z) => { try { return V.context({ x, y: 0, z }, { x: 0, z: 1 }, 0.6).kind; } catch (_) { return "?"; } };
      outer: for (const x of [0, 6, -6, 12, -12, 18, -18, 24, -24, 30, -30]) {
        let run = 0;
        for (let z = 14; z < 90; z += 0.25) {
          const c = V.context({ x, y: 0, z }, { x: 0, z: 1 }, 0.6);
          if (c.kind === "open") { run += 0.25; continue; }
          if (c.kind === "wall" && run >= 11 && open(x - 1, z) === "wall" && open(x + 1, z) === "wall" && open(x - 2.5, z) === "wall" && open(x + 2.5, z) === "wall") { S.wallLane = { x, wallZ: z + c.dist }; break outer; }
          run = 0;
        }
      }
    }
    if (!S.wallLane) return { ok: false, err: "no wall with a clear lane" };
    YARD = { x: S.wallLane.x, z: S.wallLane.wallZ - cfg.wall - cfg.gap };
  }
  const keys = CBZ.keys || (CBZ.keys = {});
  const clearKeys = () => { keys.w = keys.shift = keys.a = keys.s = keys.d = keys.e = false; };
  // the player strip keeps its hp (it is the subject); every other strip heals you
  const step = () => { CBZ.hitstop = 0; CBZ.slowmo = 0; if (!cfg.player) P.hp = 100; CBZ.stepSim(1 / 60); };
  const place = (x, z) => {
    P.pos.set(x, 0, z); P.vy = 0; P.grounded = true; P.speed = 0;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(x, 0, z);
  };
  const face = (x, z) => {
    CBZ.cam.yaw = Math.atan2(-(x - P.pos.x), -(z - P.pos.z));
    CBZ.cam.pitch = 0;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.rotation.y = Math.atan2(x - P.pos.x, z - P.pos.z);
  };
  const stand = (n) => {
    try { if (n.char && (n.char.sitting || n.char.lying) && CBZ.setCharPose) CBZ.setCharPose(n.char, "stand"); } catch (_) {}
    n._propSeat = null; n._propBed = null; n._propLie = null; n.social = null;
    n.aiState = "wander"; n.aiTimer = 30; n.fleeT = 0; n.foe = null; n.huntPlayer = 0; n.playerGrudge = 0; n._blow = null;
    n.ko = 0; n.hp = n.maxHp || 100;
    if (n.char) n.char.fightStance = false;
  };

  // ---- settle the last strip ----
  clearKeys();
  for (const n of CBZ.npcs || []) { if (n.huntPlayer > 0) { n.huntPlayer = 0; n._blow = null; if (n.char) n.char.fightStance = false; } n.playerGrudge = 0; }
  for (const g of CBZ.guards || []) { g.hunt = 0; g.alert = 0; g.sus = 0; }
  try { if (CBZ.game) { CBZ.game.heat = 0; } } catch (_) {}
  P.stun = 0; P.hitT = 0; P.hitLock = 0; P.ko = 0; P.hp = 100; P.dead = false;
  try { P.captureState = "normal"; P.captureT = 0; } catch (_) {}
  try { if (CBZ.vitals && CBZ.vitals.reset) CBZ.vitals.reset(P); } catch (_) {}
  try { const pc = CBZ.playerChar; if (pc && pc.fall && pc.fall.on && CBZ.bodyFall) CBZ.bodyFall.clear({ isPlayer: true, char: pc, group: pc.group }); } catch (_) {}
  place(YARD.x - 14, YARD.z);
  for (let i = 0; i < 200; i++) step();
  for (const g of S.gone || []) { if (g.group && Math.abs(g.group.position.x - YARD.x) < 14) g.group.position.x = YARD.x - 34; }

  // seeded dice so both builds roll the same (vitals' rolls, the body's seed)
  let seed = 0; for (const c of sub.scn) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  if (CBZ.vitals) CBZ.vitals.rng = rnd;

  // ---- cast: a fresh inmate per strip (none for the player strip) ----
  const alive = (n) => n && n.group && !n.dead && !n.escaped && !n._crowd;
  let m = null;
  if (!cfg.player) {
    S.cast = S.cast || {};
    m = S.cast[sub.scn];
    if (!m || !alive(m)) {
      const pool = (CBZ.npcs || []).filter((n) => alive(n) && !S.used.has(n));
      pool.sort((a, b) => Math.hypot(a.group.position.x - YARD.x, a.group.position.z - YARD.z) - Math.hypot(b.group.position.x - YARD.x, b.group.position.z - YARD.z));
      m = pool[0];
      if (!m) return { ok: false, err: "no body to cast" };
      S.used.add(m); S.cast[sub.scn] = m;
    }
    m._deathSeed = 1.7 + (Math.abs(seed) % 1000) / 1000;
  }
  // everybody else out of the frame
  for (const n of (CBZ.npcs || []).concat(CBZ.guards || [])) {
    if (n === m || !n.group) continue;
    const d = Math.hypot(n.group.position.x - YARD.x, n.group.position.z - YARD.z);
    if (d < 14 && !n._crowd) n.group.position.x += (n.group.position.x < YARD.x ? -1 : 1) * 18;
  }

  // ---- the strip canvas ----
  const W = input.width, H = input.height, COLS = 3, ROWS = 2, TOP = 132, CAP = 34;
  const cw = Math.floor(W / COLS), chh = Math.floor((H - TOP) / ROWS) - CAP;
  let strip = document.getElementById("__shotStrip");
  if (!strip) {
    strip = document.createElement("canvas");
    strip.id = "__shotStrip";
    strip.style.cssText = "position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none";
    document.body.appendChild(strip);
  }
  strip.width = W; strip.height = H; strip.style.width = W + "px"; strip.style.height = H + "px";
  const g2 = strip.getContext("2d");
  g2.fillStyle = "#0e1114"; g2.fillRect(0, 0, W, H);
  const camera = CBZ.camera;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  const C = { x: YARD.x, z: YARD.z + cfg.gap };       // where the man (or you) stands
  const rigOf = () => (cfg.player ? CBZ.playerChar : m.char);
  const posOf = () => (cfg.player ? P.pos : m.group.position);
  let p0 = { x: C.x, z: C.z }, camZ = C.z, everDown = false, everAsleep = false, slept = -1;
  const lines = [];
  const stateLine = () => {
    const ch = rigOf(), f = ch && ch.fall;
    let fall = "standing";
    if (f && f.on) fall = `${f.variant}/${f.phase}${f.style ? "/" + f.style : ""}${f.rate && Math.abs(f.rate - 1) > 0.01 ? " x" + f.rate.toFixed(2) : ""}`;
    const who = cfg.player ? (P.dead ? "YOU DEAD" : "you") : (m.dead ? "DEAD" : "alive");
    const asleep = !cfg.player && CBZ.bodyFall && CBZ.bodyFall.asleep && CBZ.bodyFall.asleep(m) ? " · ASLEEP" : "";
    const hurt = ch && ch._hurt && ch._hurt.on ? " · hurt" : "";
    return `${who} · ${fall}${asleep}${hurt} · ${dist(posOf(), p0).toFixed(2)} m`;
  };
  let shotN = 0;
  const shoot = (tt) => {
    if (shotN >= COLS * ROWS) return;
    camera.position.set(C.x + 3.6, 1.25, camZ);
    camera.lookAt(C.x, 0.7, camZ);
    camera.aspect = CBZ.renderer.domElement.width / CBZ.renderer.domElement.height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;
    if (m && m.group) m.group.visible = true;
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    CBZ.renderer.render(CBZ.scene, camera);
    const src = CBZ.renderer.domElement;
    const sa = src.width / src.height, ca = cw / chh;
    let sx = 0, sy = 0, sw = src.width, sh = src.height;
    if (sa > ca) { sw = sh * ca; sx = (src.width - sw) / 2; } else { sh = sw / ca; sy = (src.height - sh) / 2; }
    const x = (shotN % COLS) * cw, y = TOP + Math.floor(shotN / COLS) * (chh + CAP);
    g2.drawImage(src, sx, sy, sw, sh, x + 2, y, cw - 4, chh);
    const line = stateLine();
    lines.push(`+${tt.toFixed(2)}s ${line}`);
    g2.fillStyle = "#0e1114"; g2.fillRect(x, y + chh, cw, CAP);
    g2.font = "800 13px -apple-system,Helvetica,Arial"; g2.fillStyle = "#ffd166"; g2.fillText(`+${tt.toFixed(2)} s`, x + 8, y + chh + 21);
    g2.font = "600 10px ui-monospace,Menlo,monospace"; g2.fillStyle = /DEAD|ASLEEP|\/down/.test(line) ? "#9fe8c3" : "#c0cfda"; g2.fillText(line, x + 66, y + chh + 21);
    shotN++;
  };
  const due = (f) => { while (shotN < cfg.times.length && f / 60 >= cfg.times[shotN] - 1e-6) shoot(cfg.times[shotN]); };
  const lastT = cfg.times[cfg.times.length - 1];

  // ---- a point on the live rig the round goes into, and its line ----
  const MPs = CBZ.meleePoses;
  const Z = MPs && MPs.newZones ? MPs.newZones() : null;
  const _a = new T.Vector3();
  const aimPoint = (rd, from) => {
    const ch = rigOf();
    MPs.zones(ch, Z);
    const toward = (p, r) => {                     // onto the surface facing the gun
      const dx = from.x - p.x, dz = from.z - p.z, l = Math.hypot(dx, dz) || 1;
      return { x: p.x + dx / l * r, y: p.y, z: p.z + dz / l * r };
    };
    if (rd.at === "head") return toward(Z.head.c, Z.head.r * 0.85);
    if (rd.at === "legR") { _a.copy(Z.rA).lerp(Z.rB, 0.45); return toward(_a, Z.legR * 0.9); }
    // the chest (or the back: the same height, the gun is behind him)
    _a.copy(Z.cA).add(Z.cB).add(Z.dA).add(Z.dB).multiplyScalar(0.25);
    _a.y += 0.12;
    const yaw = ch.group.rotation.y || 0;
    if (rd.dx) { _a.x += Math.cos(yaw) * rd.dx; _a.z -= Math.sin(yaw) * rd.dx; }
    return toward(_a, Z.chestR * 0.9);
  };
  const W8 = (id) => (CBZ.weaponById ? CBZ.weaponById(id) : null) || { damage: 30, headMult: 3, knock: 1, pellets: 0, key: id };
  const notes = [];
  // ---- the round, through the gun's own functions ----
  const fire = (rd) => {
    const w = W8(cfg.gun), cal = CAL[cfg.gun] || 1;
    const from = { x: P.pos.x, z: P.pos.z };
    const pt = aimPoint(rd, from);
    let dx = pt.x - from.x, dz = pt.z - from.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const dir = { x: dx, y: 0, z: dz };
    const range = Math.hypot(pt.x - from.x, pt.z - from.z);
    const head = rd.at === "head";
    const zone = head ? "head" : (V.shotZone ? V.shotZone(m, pt) : null);
    const exit = V.roundExits ? V.roundExits({ cal, wkey: w.key, pellets: w.pellets, head, zone, dist: range }) : false;
    // the blood the round lets out (landRound: one spray per round, the hole on a survivor)
    try { if (CBZ.gore && CBZ.gore.spray) CBZ.gore.spray(pt, head ? 0.95 : 0.58 * Math.max(0.7, cal), dir, { exit, cal, head }); } catch (_) {}
    const vr = CBZ.vitals && CBZ.vitals.wound ? CBZ.vitals.wound(m, { kind: "bullet", point: pt, head, zone, cal, by: P,
      fromX: from.x, fromZ: from.z, dirX: dx, dirZ: dz, critical: false, noKill: true }) : null;
    if (cfg.kill) {
      CBZ.aiKill(m, { group: CBZ.playerChar.group }, { noKnock: true, exit,
        shot: { dirX: dx, dirZ: dz, zone, cal, wkey: w.key || cfg.gun, dist: range, point: pt, head } });
      notes.push(`killed: ${zone || "?"}, ${cfg.gun}, ${range.toFixed(1)} m`);
      return;
    }
    m.hp = (m.hp == null ? 100 : m.hp) - Math.max(1, Math.round(w.damage * (head ? w.headMult : 1)));
    const took = V.shot ? V.shot(m, { point: pt, dir, cal, wkey: w.key || cfg.gun, dist: range, share: 1, head }) : false;
    if (CBZ.knockback) CBZ.knockback(m, from.x, from.z, w.knock || 1);
    try { if (CBZ.bodyWound) CBZ.bodyWound(m, pt, { head, cal, dir }); } catch (_) {}
    notes.push(`${zone || "?"} ${took ? "on the rig" : "NOT TAKEN"} · vitals ${vr ? vr.outcome : "-"}`);
  };
  const firePlayer = (rd) => {
    const fx = P.pos.x, fz = P.pos.z + cfg.gap;   // a screw in front of you
    let r = null;
    try { r = CBZ.shootPlayer(rd.dmg, fx, fz, { cal: 0.8, wkey: "sidearm", dist: cfg.gap, stun: 0.25 }); } catch (e) { notes.push("shootPlayer threw: " + e.message); }
    notes.push(`round ${rd.dmg}: ${r ? "floored" : "on your feet"} · hp ${Math.round(P.hp)}`);
  };

  // ---- stage ----
  if (cfg.player) {
    place(C.x, C.z);
    face(C.x, C.z + 5);
    for (let f = 0; f < 30; f++) { place(C.x, C.z); face(C.x, C.z + 5); P.hp = 100; step(); }
    P.hp = 100;
    p0 = { x: P.pos.x, z: P.pos.z }; camZ = P.pos.z;
  } else {
    stand(m);
    const mp = m.group.position;
    place(YARD.x, YARD.z);
    const runYaw = 0, standYaw = Math.PI;               // facing you (-z), or running away from you (+z)
    mp.set(C.x, 0, C.z); m.group.rotation.y = cfg.run ? runYaw : standYaw;
    face(C.x, C.z);
    for (let f = 0; f < 20; f++) { mp.set(C.x, 0, C.z); m.group.rotation.y = cfg.run ? runYaw : standYaw; m.pause = 8; step(); }
    if (cfg.run) {
      // half a second of running away from you down the lane
      for (let f = 0; f < 30; f++) {
        mp.z += cfg.run / 60; mp.x = C.x; m.group.rotation.y = runYaw; m.pause = 0;
        if (m._mv) { m._mv.vx = 0; m._mv.vz = cfg.run; }
        step();
      }
      if (!m._mv) m._mv = { vx: 0, vz: cfg.run };
      m._mv.vx = 0; m._mv.vz = cfg.run;
      m.vel = { x: 0, y: 0, z: cfg.run };
    } else m.pause = 8;
    p0 = { x: mp.x, z: mp.z }; camZ = mp.z + (cfg.camAhead || 0);
  }

  // ---- the event: the rounds on their beats, the frames on theirs ----
  const rounds = cfg.rounds.slice();
  for (let f = 0; f <= Math.round(lastT * 60); f++) {
    while (rounds.length && f / 60 >= rounds[0].t - 1e-6) {
      const rd = rounds.shift();
      if (cfg.player) firePlayer(rd); else if (!m.dead) fire(rd);
    }
    due(f);
    if (m && !m.dead) m.pause = Math.max(m.pause || 0, 2);
    step();
    const ch = rigOf(), fl = ch && ch.fall;
    if (fl && fl.on && fl.phase === "down") everDown = true;
    if (m && CBZ.bodyFall && CBZ.bodyFall.asleep && CBZ.bodyFall.asleep(m)) { everAsleep = true; if (slept < 0) slept = f / 60; }
  }
  due(1e9);
  if (CBZ.vitals) CBZ.vitals.rng = null;
  clearKeys();

  // ---- the numbers ----
  const metrics = {};
  const k = sub.id;
  metrics[k + "Down"] = everDown ? 1 : 0;
  metrics[k + "MovedM"] = Math.round(dist(posOf(), p0) * 100) / 100;
  metrics[k + "AsleepS"] = slept >= 0 ? Math.round(slept * 100) / 100 : -1;
  const ch = rigOf(), f = ch && ch.fall;
  const caption = cfg.player ? "your rig, third person · a screw's rounds (CBZ.shootPlayer) · times are after the first round"
    : `inmate · ${cfg.gun} from ${cfg.gap} m${cfg.run ? `, him running at ${cfg.run} m/s` : ""}${cfg.wall ? `, wall ${cfg.wall} m behind him` : ""} · times are after the first round`;
  const perf = `on the floor: ${everDown ? "yes" : "no"} · moved ${metrics[k + "MovedM"].toFixed(2)} m · asleep at ${slept >= 0 ? slept.toFixed(2) + " s" : "never"}` +
    `<br>last: ${f && f.on ? `${f.variant}/${f.phase}${f.style ? "/" + f.style : ""}` : "standing"}` + (notes.length ? "<br>" + notes.join("; ") : "");
  setHud(false);

  S.gone = S.gone || [];
  if (m) S.gone.push(m);
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = sub.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:560px";
  q("focus").textContent = caption;
  q("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:620px";
  q("perf").innerHTML = perf;
  q("perf").style.cssText = "position:absolute;right:24px;top:24px;text-align:right;line-height:1.7;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;max-width:520px";
  q("source").textContent = "";
  return { ok: true, metrics, lines, perfText: perf.replace(/<br>/g, " | ") };
}

/* BEFORE = BA_BEFORE_REF (default HEAD), served off a detached worktree on its own port. */
async function launchSides(ctx) {
  const { spawn, execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const net = await import("node:net");
  const repo = ctx.repoRoot;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ba-head-"));
  fs.rmdirSync(dir);
  const ref = process.env.BA_BEFORE_REF || (ctx.env && ctx.env.BA_BEFORE_REF) || "HEAD";
  execFileSync("git", ["worktree", "add", "--detach", dir, ref], { cwd: repo, stdio: "ignore" });
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
  const proc = spawn("python3", ["tools/devserver.py"], {
    cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: "ignore",
  });
  const origin = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 20000;
  let up = false;
  while (Date.now() < deadline && !up) {
    try { up = (await fetch(origin, { method: "HEAD" })).ok; } catch (_) {}
    if (!up) await new Promise((r) => setTimeout(r, 150));
  }
  if (!up) { try { proc.kill(); } catch (_) {} throw new Error("HEAD worktree server never came up"); }
  return {
    before: origin,
    label: `${ref} worktree ${dir} :${port} vs working tree`,
    async close() {
      try { proc.kill(); } catch (_) {}
      try { execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: repo, stdio: "ignore" }); } catch (_) {}
    },
  };
}

export default {
  id: "prison-shot",
  title: "Prison Escape: a body taking rounds",
  description: "A pistol round a man lives through, a leg shot, a head shot, a rifle into the chest, a runner shot in the back, a shotgun at two metres, three rounds in a second, a man shot in front of a wall, and you taking a screw's rounds, each as a strip of frames after the first round. BEFORE = HEAD on its own port.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · WORKING TREE",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "Down is 1 if the body reached the floor (the fall's down phase). MovedM is how far the body is from where it stood when the first round landed, at the end of the strip. AsleepS is when the body stopped moving for good (-1 = never in the strip).",
  metrics: {},
  subjects,
  stage: stageShot,
  launchSides,
};
