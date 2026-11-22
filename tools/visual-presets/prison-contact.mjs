/* prison-contact.mjs — BODIES MEETING BODIES IN THE JAIL, as film strips.

   OWNER (2026-11-21): "Running into a player in jail game we both just fall
   fakely and grab doesn't work. Fix all these inter character interactions
   with great physics and show me storyboard when done."

   One plate is ONE event: the scenario is run once from a fixed start and
   the same side camera photographs it at fixed times after first contact
   into a strip, so a plate reads left to right, top to bottom. The line under
   each frame is read off the live game on that frame: who is on the floor,
   how far each body has travelled since contact, what the hands are doing.
   BEFORE = BA_BEFORE_REF (default HEAD) on its own port. */

const SCN = {
  walk:   { label: "Walk into his chest, and keep walking", sprint: false, npcYaw: Math.PI, gap: 3.0, hold: 9, times: [0.1, 0.5, 1.0, 1.6, 2.4, 3.2] },
  front:  { label: "Sprint into his chest",      sprint: true,  npcYaw: Math.PI, gap: 7.0, times: [0.04, 0.2, 0.45, 0.8, 1.4, 2.6] },
  back:   { label: "Sprint into his back",       sprint: true,  npcYaw: 0,       gap: 7.0, times: [0.04, 0.2, 0.45, 0.8, 1.4, 2.6] },
  side:   { label: "Sprint into his shoulder",   sprint: true,  npcYaw: Math.PI / 2, gap: 7.0, times: [0.04, 0.2, 0.45, 0.8, 1.4, 2.6] },
  headon: { label: "Both running, head on",      sprint: true,  npcYaw: Math.PI, gap: 9.0, npcRun: 4.5, times: [0.04, 0.2, 0.45, 0.8, 1.4, 2.6] },
  grab:   { label: "Grab a man two steps away, walk him",  grab: "stand", dist: 2.4, times: [0.15, 0.4, 0.8, 1.4, 2.4, 3.6] },
  grabgo: { label: "Grab a man who is walking off",        grab: "walk",  dist: 2.0, times: [0.15, 0.4, 0.8, 1.4, 2.4, 3.6] },
  shove:  { label: "Shove him out of the grab",  grab: "shove", dist: 1.3, times: [1.05, 1.2, 1.4, 1.7, 2.2, 3.0] },
  pickup: { label: "Pick a man up off the floor", grab: "down", dist: 2.2, times: [0.3, 0.8, 1.4, 2.0, 2.8, 3.8] },
  cuffkick: { label: "In cuffs: the red button, a man a step away",   grab: "cuff", dist: 1.5, times: [0.1, 0.25, 0.4, 0.6, 0.9, 1.4] },
  cuffbutt: { label: "In cuffs: the red button, a man chest to chest", grab: "cuff", dist: 0.8, times: [0.1, 0.25, 0.4, 0.6, 0.9, 1.4] },
  cuffheld: { label: "In cuffs, walked by an officer: the red button",  grab: "cuff", dist: 6, held: true, times: [0.1, 0.3, 0.45, 0.6, 0.9, 1.4] },
  cuffheldkick: { label: "In cuffs, walked, a man in front: the red button", grab: "cuff", dist: 1.5, held: true, times: [0.1, 0.25, 0.4, 0.6, 0.9, 1.4] },
  guard:  { label: "Sprint into an officer",     sprint: true,  npcYaw: Math.PI, gap: 7.0, guard: true, times: [0.04, 0.2, 0.45, 0.8, 1.4, 2.6] },
};

const subjects = Object.keys(SCN).map((id) => ({ id, label: SCN[id].label, scn: id, cfg: SCN[id], hud: false, focus: SCN[id].label }));

async function stageContact(input) {
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
      if (child.id === "__contactOverlay" || child.id === "__contactStrip") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__contactSeq;
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
    overlay.id = "__contactOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__contactSeq = { overlay, used: new Set() };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
    try { if (CBZ.dayPhase) CBZ.dayPhase((11 - 6) / 24); } catch (_) {}
    for (let i = 0; i < 600; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    CBZ.CONFIG.CAM_TIGHT_FP = false;
    if (CBZ.setFPS) CBZ.setFPS(false);
  }

  const P = CBZ.player, V = CBZ.verbs;
  const pa = () => (V && V.playerActor ? V.playerActor() : null);
  const sub = input.subject, cfg = sub.cfg;
  const YARD = { x: 0, z: 30 };
  const keys = CBZ.keys || (CBZ.keys = {});
  const clearKeys = () => { keys.w = keys.shift = keys.a = keys.s = keys.d = keys.e = false; };
  const step = () => { CBZ.hitstop = 0; CBZ.slowmo = 0; P.hp = 100; CBZ.stepSim(1 / 60); };
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
  const down = (a) => {
    if (!a) return false;
    if (a.dead || (a.ko || 0) > 0) return true;
    const ch = a.char || a.ch;
    return !!((ch && ch.fall && ch.fall.on) || (a._phys && (a._phys.down > 0 || a._phys.air)));
  };
  const playerDown = () => {
    const pc = CBZ.playerChar, f = pc && pc.fall, A = pa();
    return !!((P.ko || 0) > 0 || (f && f.on) || (A && A._phys && (A._phys.down > 0 || A._phys.air)));
  };

  // ---- settle the last strip's bodies ----
  clearKeys();
  try { const A = pa(), S0 = A && V && V.sessionOf ? V.sessionOf(A) : null; if (S0 && V.release) V.release(S0, "drop"); } catch (_) {}
  for (const n of CBZ.npcs || []) { if (n.huntPlayer > 0) { n.huntPlayer = 0; n._blow = null; if (n.char) n.char.fightStance = false; } n.playerGrudge = 0; }
  for (const g of CBZ.guards || []) { g.hunt = 0; g.alert = 0; g.sus = 0; g._pushN = 0; }
  try { if (CBZ.game) { CBZ.game.heat = 0; } } catch (_) {}
  P.stun = 0; P.hitT = 0; P.hitLock = 0; P.ko = 0; P.hp = 100; P.dead = false;
  try { P.captureState = "normal"; if (CBZ.playerChar) CBZ.playerChar.cuffed = false; try { const hs = V.sessionOf(pa()); if (hs && hs.cancel) hs.cancel(); } catch (_) {} if (S.holder) { S.holder.group.position.x -= 30; S.holder = null; } } catch (_) {}
  place(YARD.x - 14, YARD.z);
  for (let i = 0; i < 200; i++) step();

  for (const g of S.gone || []) { g.pause = 0; if (g.group && Math.abs(g.group.position.x - YARD.x) < 14) g.group.position.x = YARD.x - 34; }
  // ---- cast: a fresh man per scenario (the same one for every plate of it) ----
  const alive = (n) => n && n.group && !n.dead && !n.escaped && !n._crowd;
  const castKey = sub.scn;
  S.cast = S.cast || {};
  let m = S.cast[castKey];
  if (!m || !alive(m)) {
    const pool = (cfg.guard ? (CBZ.guards || []) : (CBZ.npcs || [])).filter((n) => alive(n) && !S.used.has(n) && !(n.kind === "warden"));
    pool.sort((a, b) => Math.hypot(a.group.position.x - YARD.x, a.group.position.z - YARD.z) - Math.hypot(b.group.position.x - YARD.x, b.group.position.z - YARD.z));
    m = pool[0];
    if (!m) return { ok: false, err: "no body to cast" };
    S.used.add(m); S.cast[castKey] = m;
  }
  // everybody else out of the frame
  for (const n of (CBZ.npcs || []).concat(CBZ.guards || [])) {
    if (n === m || !n.group) continue;
    const d = Math.hypot(n.group.position.x - YARD.x, n.group.position.z - YARD.z);
    if (d < 12 && !n._crowd) { n.group.position.x += (n.group.position.x < YARD.x ? -1 : 1) * 16; }
  }

  // seeded dice so both builds roll the same
  let seed = 0; for (const c of sub.scn) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  if (CBZ.bodyImpact) CBZ.bodyImpact.rng = rnd;

  stand(m);
  const mp = m.group.position;
  const stats0 = CBZ.humanContact && CBZ.humanContact.stats ? CBZ.humanContact.stats() : {};
  const gap = cfg.gap || 1.3;
  const C = { x: YARD.x, z: YARD.z + gap };            // where he stands
  place(YARD.x, YARD.z);
  mp.set(C.x, 0, C.z); m.group.rotation.y = cfg.npcYaw != null ? cfg.npcYaw : Math.PI;
  face(C.x, C.z);
  const p0 = { x: P.pos.x, z: P.pos.z };
  let t = -1, contactZ = C.z, notes = [], phases = [], sess = null, grabOk = null, everPD = false, everND = false;
  let maxSpeed = 0, lastPz = P.pos.z;
  const seePhase = () => { if (sess && sess.phase && phases[phases.length - 1] !== sess.phase) phases.push(sess.phase); };

  // ---- the strip: one canvas the frames are copied into as they happen ----
  const W = input.width, H = input.height, COLS = 3, ROWS = 2, TOP = 132, CAP = 34;
  const cw = Math.floor(W / COLS), chh = Math.floor((H - TOP) / ROWS) - CAP;
  let strip = document.getElementById("__contactStrip");
  if (!strip) {
    strip = document.createElement("canvas");
    strip.id = "__contactStrip";
    strip.style.cssText = "position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none";
    document.body.appendChild(strip);
  }
  strip.width = W; strip.height = H; strip.style.width = W + "px"; strip.style.height = H + "px";
  const g2 = strip.getContext("2d");
  g2.fillStyle = "#0e1114"; g2.fillRect(0, 0, W, H);
  const camera = CBZ.camera;
  let shotN = 0;
  const lines = [];
  const stateLine = () => {
    const A = pa();
    const live = A && V && V.sessionOf ? V.sessionOf(A) : null;
    const you = playerDown() ? "YOU DOWN" : "you up";
    const him = down(m) ? "HIM DOWN" : "him up";
    if (cfg.grab) return `${V && V.holding && A && V.holding(A) ? "IN YOUR HANDS" : "not held"} · ${live ? live.verb + "/" + live.phase : "no hold"} · ${him}`;
    return `${you} ${dist(P.pos, q0).toFixed(1)} m · ${him} ${dist(mp, n0).toFixed(1)} m`;
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  let q0 = { x: 0, z: 0 }, n0 = { x: 0, z: 0 }, camZ = 0;
  const shoot = (tt) => {
    if (shotN >= COLS * ROWS) return;
    camera.position.set(YARD.x + 4.3, 1.45, camZ - 0.4);
    camera.lookAt(YARD.x, 0.75, camZ);
    camera.aspect = CBZ.renderer.domElement.width / CBZ.renderer.domElement.height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    CBZ.renderer.render(CBZ.scene, camera);
    const src = CBZ.renderer.domElement;
    // crop the live canvas to the cell's shape (cover)
    const sa = src.width / src.height, ca = cw / chh;
    let sx = 0, sy = 0, sw = src.width, sh = src.height;
    if (sa > ca) { sw = sh * ca; sx = (src.width - sw) / 2; } else { sh = sw / ca; sy = (src.height - sh) / 2; }
    const x = (shotN % COLS) * cw, y = TOP + Math.floor(shotN / COLS) * (chh + CAP);
    g2.drawImage(src, sx, sy, sw, sh, x + 2, y, cw - 4, chh);
    const line = stateLine();
    lines.push(`+${tt.toFixed(2)}s ${line}`);
    g2.fillStyle = "#0e1114"; g2.fillRect(x, y + chh, cw, CAP);
    g2.font = "800 13px -apple-system,Helvetica,Arial"; g2.fillStyle = "#ffd166"; g2.fillText(`+${tt.toFixed(2)} s`, x + 8, y + chh + 21);
    g2.font = "600 11px ui-monospace,Menlo,monospace"; g2.fillStyle = /DOWN|HANDS/.test(line) ? "#9fe8c3" : "#c0cfda"; g2.fillText(line, x + 72, y + chh + 21);
    shotN++;
  };
  const due = (f) => { while (shotN < cfg.times.length && f / 60 >= cfg.times[shotN] - 1e-6) shoot(cfg.times[shotN]); };
  const lastT = cfg.times[cfg.times.length - 1];

  if (!cfg.grab) {
    // ---- a run-in ----
    let npcZ = C.z;
    const touchD = (P.radius || 0.38) + 0.36 + 0.012;
    for (let f = 0; f < 600 && t < 0; f++) {
      keys.w = true; keys.shift = !!cfg.sprint;
      face(C.x, P.pos.z + 5);
      // until they touch he is where the scenario put him
      if (cfg.npcRun) npcZ -= cfg.npcRun / 60;
      mp.x = C.x; mp.z = npcZ; m.group.rotation.y = cfg.npcYaw;
      if (cfg.npcRun) { m._bcVx = 0; m._bcVz = -cfg.npcRun; }
      step();
      maxSpeed = Math.max(maxSpeed, (P.pos.z - lastPz) * 60); lastPz = P.pos.z;
      if (dist(mp, P.pos) < touchD || down(m) || playerDown()) t = 0;
    }
    if (t < 0) return { ok: false, err: "never met" };
    n0 = { x: mp.x, z: mp.z }; q0 = { x: P.pos.x, z: P.pos.z };
    if (!cfg.npcRun) m.pause = 8;      // he was standing there, not on his way somewhere
    camZ = (mp.z + P.pos.z) / 2 + 1.0;
    const holdF = Math.round((cfg.hold || 0.33) * 60);
    for (let f = 0; f <= Math.round(lastT * 60); f++) {
      due(f);
      // you keep the stick forward for a third of a second, like a player who has not reacted yet
      keys.w = f < holdF; keys.shift = !!cfg.sprint && f < holdF;
      face(C.x, P.pos.z + 5);
      step();
      if (playerDown()) everPD = true;
      if (down(m)) everND = true;
    }
    clearKeys();
  } else {
    // ---- hands on him ----
    const D = cfg.dist || 1.3;
    mp.set(YARD.x, 0, YARD.z + D); m.group.rotation.y = Math.PI;
    if (cfg.grab === "down" && CBZ.humanContact) {
      CBZ.humanContact.knockdown(m, { nx: 0, nz: 1, severity: 1, mode: "escape" });
      for (let f = 0; f < 80; f++) step();
      m.ko = Math.max(m.ko || 0, 12);
      place(mp.x, mp.z - D);
    } else {
      for (let f = 0; f < 10; f++) { mp.set(YARD.x, 0, YARD.z + D); m.group.rotation.y = cfg.grab === "walk" ? 0 : Math.PI; step(); }
    }
    face(mp.x, mp.z);
    camZ = (mp.z + P.pos.z) / 2 + 0.8;
    q0 = { x: P.pos.x, z: P.pos.z }; n0 = { x: mp.x, z: mp.z };
    let hp0 = 0, kinds = [];
    if (cfg.grab === "cuff") {
      // hands behind the back, then the touch FIRE button's own route (touch.js fireAction)
      CBZ.playerChar.cuffed = true;
      if (cfg.held) {
        // an officer takes you by the arm from behind and walks you
        const g = (CBZ.guards || []).filter((x) => x && x.group && !x.dead && !(x.ko > 0))[0];
        if (g) {
          S.holder = g;
          g.group.position.set(P.pos.x, 0, P.pos.z - 0.9); g.group.rotation.y = 0;
          for (let f = 0; f < 5; f++) step();
          let hs = null;
          try { hs = V.escort(g, pa(), {}); } catch (e) { notes.push("escort threw: " + e.message); }
          for (let f = 0; f < 90; f++) { mp.set(YARD.x, 0, P.pos.z + D); m.group.rotation.y = Math.PI; m.pause = 5; step(); }
          notes.push("escort " + (hs ? hs.phase : "REFUSED"));
        }
      }
      for (let f = 0; f < 20; f++) { mp.set(YARD.x, 0, (cfg.held ? P.pos.z : YARD.z) + D); m.group.rotation.y = Math.PI; m.pause = 5; step(); }
      face(mp.x, mp.z);
      camZ = (mp.z + P.pos.z) / 2 + (cfg.held ? -0.6 : 0.8); if (cfg.dist > 3) camZ = P.pos.z;
      hp0 = m.hp == null ? 100 : m.hp;
      notes.push(`cuffed ${CBZ.cuffedPlayer && CBZ.cuffedPlayer.on() ? 1 : 0} fp ${CBZ.fps && CBZ.fps.active ? 1 : 0} tpGun ${CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive() ? 1 : 0} armed ${CBZ.playerArmed && CBZ.playerArmed() ? 1 : 0} held ${CBZ.verbs.playerHeld && CBZ.verbs.playerHeld() ? 1 : 0} stun ${(P.stun || 0).toFixed(1)}`);
      let r = null;
      try { r = CBZ.melee.trigger(true); } catch (e) { notes.push("trigger threw: " + e.message); }
      grabOk = !!r;
    } else {
      try { sess = CBZ.grapple && CBZ.grapple.grab ? CBZ.grapple.grab(m) : null; } catch (e) { notes.push("grab threw: " + e.message); }
      grabOk = !!sess;
    }
    t = 0;
    for (let f = 0; f <= Math.round(lastT * 60); f++) {
      due(f);
      const tt = f / 60;
      const held = !!(V && V.sessionOf && V.sessionOf(m));
      // a man walking off keeps walking until hands are on him
      if (cfg.grab === "walk" && !held && tt < 1.2) { mp.z += 1.6 / 60; m.group.rotation.y = 0; }
      // with him in your hands, walk him forward
      if ((cfg.grab === "stand" || cfg.grab === "down" || cfg.grab === "walk") && tt > 1.5) { keys.w = true; face(P.pos.x, P.pos.z + 5); }
      if (cfg.grab === "shove" && f === 60) { try { CBZ.grapple.push(); } catch (e) { notes.push("push threw: " + e.message); } }
      if (cfg.grab === "cuff") {
        if (f === 2) { try { CBZ.melee.trigger(false); } catch (_) {} }
        const pk = CBZ.playerChar.kickT > 0 ? "kick:" + (CBZ.playerChar.kickKind || "") : CBZ.playerChar.punchT > 0 ? "arm:" + (CBZ.playerChar.punchKind || "") : "";
        if (pk && kinds[kinds.length - 1] !== pk) kinds.push(pk);
        m.pause = 5;
      }
      step(); seePhase();
      if (cfg.grab === "cuff" && f === Math.round(lastT * 60)) { notes.push(`limbs: ${kinds.join(" > ") || "none moved"} · his hp ${hp0} -> ${m.hp == null ? 100 : Math.round(m.hp)}`); CBZ.playerChar.cuffed = false; try { const hs = V.sessionOf(pa()); if (hs && hs.cancel) hs.cancel(); } catch (_) {} if (S.holder) { S.holder.group.position.x -= 30; S.holder = null; } }
      if (cfg.grab !== "shove" && tt > 1.5) camZ = (mp.z + P.pos.z) / 2 + 0.3;
      if (playerDown()) everPD = true;
      if (down(m)) everND = true;
    }
    clearKeys();
  }
  due(1e9);

  // ---- the numbers ----
  const A = pa();
  const holding = !!(A && V && V.holding && V.holding(A));
  const stats1 = CBZ.humanContact && CBZ.humanContact.stats ? CBZ.humanContact.stats() : {};
  const metrics = {};
  const k = sub.id;
  let perf, caption;
  if (!cfg.grab) {
    metrics[k + "YouEverDown"] = everPD ? 1 : 0;
    metrics[k + "HimEverDown"] = everND ? 1 : 0;
    metrics[k + "HimMovedM"] = Math.round(dist(mp, n0) * 100) / 100;
    metrics[k + "YouMovedM"] = Math.round(dist(P.pos, q0) * 100) / 100;
    caption = `${cfg.guard ? "officer" : "inmate"} · you at ${maxSpeed.toFixed(1)} m/s${cfg.npcRun ? `, him at ${cfg.npcRun} m/s` : ""} · times are after first contact`;
    perf = `you went down: ${everPD ? "yes" : "no"} · he went down: ${everND ? "yes" : "no"}<br>after ${lastT} s: you ${metrics[k + "YouMovedM"].toFixed(2)} m, him ${metrics[k + "HimMovedM"].toFixed(2)} m from contact`;
  } else {
    const got = phases.indexOf("hold") >= 0 || phases.indexOf("drive") >= 0;
    metrics[k + "Accepted"] = grabOk ? 1 : 0;
    metrics[k + "HandsOn"] = got ? 1 : 0;
    caption = `button pressed ${(cfg.dist || 1.3).toFixed(1)} m from him · ${grabOk ? "accepted" : "REFUSED: nothing happens"}`;
    perf = (cfg.grab === "cuff" ? `button did something: ${grabOk ? "yes" : "NO"}` : `hands got on him: ${got ? "yes" : "NO"}<br>${phases.join(" > ") || "no session"}`) + (notes.length ? "<br>" + notes.join("; ") : "");
  }
  setHud(false);

  // this strip's man leaves the lane (the next strip runs down the same line)
  S.gone = S.gone || [];
  S.gone.push(m);
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = sub.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:520px";
  q("focus").textContent = caption;
  q("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:520px";
  q("perf").innerHTML = perf;
  q("perf").style.cssText = "position:absolute;right:24px;top:24px;text-align:right;line-height:1.7;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  q("source").textContent = "";
  return { ok: true, metrics, lines, perfText: perf.replace(/<br>/g, ' | ') };
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
  id: "prison-contact",
  title: "Prison Escape: bodies meeting bodies",
  description: "Walking and sprinting into a man from the front, the back and the side, two runners head on, an officer, and the grab, the pick-up and the shove, each as a strip of frames after first contact. BEFORE = HEAD on its own port.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · WORKING TREE",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "EverDown is 1 if that body was on the floor at any point. MovedM is how far that body is from where it stood at first contact when the strip ends. Accepted is 1 if pressing Grab started anything; HandsOn is 1 if the hands actually reached him.",
  metrics: {},
  subjects,
  stage: stageContact,
  launchSides,
};
