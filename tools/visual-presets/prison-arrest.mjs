/* prison-arrest.mjs — GETTING ARRESTED IN THE PRISON, as film strips.

   OWNER (2026-11-22): "Rn when arresting cops throw me over their shoulder
   all of a sudden instead of the great handcuffing they used to do. Build
   that and improve ... the whole getting arrested and resisting process."

   One plate is ONE arrest, run once from a fixed start and photographed by
   a side camera at fixed times after the event starts (the order, the run,
   the knockout) into a 3x2 strip. The line under each frame is read off the
   live game on that frame; the top-right block is every phase the capture
   and arrest state machines went through, so a strip that stalls says where.
   Staged ONLY through what exists on main (so BEFORE and AFTER run the same
   code): CBZ.prisonOffense, gd.hunt, placed bodies, CBZ.keys, a dispatched
   Space keydown, CBZ.melee.trigger, CBZ.vitals.ko.
   BEFORE = BA_BEFORE_REF (default HEAD) on its own port. */

const SCN = {
  comply:   { label: "On file, the order: you go to your knees",            act: "kneel",  gap: 3.0, times: [0.6, 2.2, 3.4, 4.6, 6.2, 8.5] },
  run:      { label: "On file, the order: you run",                          act: "run",    gap: 3.0, times: [0.4, 1.2, 2.0, 3.2, 5.0, 7.5] },
  floored:  { label: "On file, a screw on you: you are knocked out",         act: "ko",     gap: 5.0, times: [0.4, 1.6, 2.8, 4.2, 6.0, 8.5] },
  struggle: { label: "Hands on you: you wrench at the grip",                 act: "wrench", gap: 3.0, times: [0.3, 0.8, 1.4, 2.0, 3.0, 4.5] },
  cuffbutt: { label: "Cuffed and walked: the back of your head into his face", act: "butt", gap: 3.0, times: [0.1, 0.35, 0.6, 1.0, 2.0, 3.5] },
  two:      { label: "Two officers: the second is in reach when he takes you", act: "kneel", gap: 3.0, second: true, times: [0.6, 2.2, 3.4, 4.6, 6.2, 8.5] },
};

const subjects = Object.keys(SCN).map((id) => ({ id, label: SCN[id].label, scn: id, cfg: SCN[id], hud: false, focus: SCN[id].label }));

async function stageArrest(input) {
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
      if (child.id === "__arrestOverlay" || child.id === "__arrestStrip") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__arrestSeq;
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
    overlay.id = "__arrestOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__arrestSeq = { overlay, used: new Set(), gone: [] };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
    try { if (CBZ.dayPhase) CBZ.dayPhase((11 - 6) / 24); } catch (_) {}
    for (let i = 0; i < 600; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    CBZ.CONFIG.CAM_TIGHT_FP = false;
    if (CBZ.setFPS) CBZ.setFPS(false);
  }

  const P = CBZ.player, V = CBZ.verbs, G = CBZ.game;
  const pa = () => (V && V.playerActor ? V.playerActor() : null);
  const sub = input.subject, cfg = sub.cfg;
  const YARD = { x: 0, z: 30 };
  const keys = CBZ.keys || (CBZ.keys = {});
  const clearKeys = () => { keys.w = keys.shift = keys.a = keys.s = keys.d = keys.e = keys.c = keys.control = false; keys[" "] = false; };
  const step = () => { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); };
  const place = (x, z) => {
    P.pos.set(x, 0, z); P.vy = 0; P.grounded = true; P.speed = 0;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(x, 0, z);
  };
  const faceDir = (yaw) => {
    // the body faces `yaw`; the lens sits behind it (W walks that way)
    CBZ.cam.yaw = yaw + Math.PI; CBZ.cam.pitch = 0;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.rotation.y = yaw;
  };
  const press = (key) => {
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    } catch (_) {}
  };
  const playerDown = () => {
    const pc = CBZ.playerChar, f = pc && pc.fall, A = pa();
    return !!((P.ko || 0) > 0 || (f && f.on) || (A && A._phys && (A._phys.down > 0 || A._phys.air)));
  };
  const sessP = () => { try { return V && V.sessionOf ? V.sessionOf(pa()) : null; } catch (_) { return null; } };

  // ---- seeded dice for the strip (the taser roll, the lunge, the contest's noise)
  let seed = 0; for (const c of sub.scn) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const mathRandom = Math.random;

  // ---- a clean slate: whatever the last strip left (a walk, the hole, a
  // carry, cuffs, a hand on the arm) is torn down the way a NEW RUN tears it
  // down (capture.js, prisonlaw.js and the rest watch game.elapsed fall back)
  clearKeys();
  try { const S0 = sessP(); if (S0 && S0.cancel) S0.cancel(); } catch (_) {}
  try { if (CBZ.arrest && CBZ.arrest.release) CBZ.arrest.release(); } catch (_) {}
  try { if (V && V.setCuffs) V.setCuffs(pa(), false); } catch (_) {}
  if (CBZ.playerChar) { CBZ.playerChar.cuffed = false; CBZ.playerChar.handsUp = false; if (CBZ.playerChar.fall) { CBZ.playerChar.fall.on = false; CBZ.playerChar.fall.hold = false; CBZ.playerChar.fall.phase = ""; } }
  try { if (CBZ.vitals && CBZ.vitals.reset) CBZ.vitals.reset(P); } catch (_) {}
  try { if (CBZ.prisonOffenseClear) CBZ.prisonOffenseClear(); } catch (_) {}
  P.stun = 0; P.ko = 0; P.hp = 100; P.dead = false; P.captureState = "normal"; P.captureT = 0;
  G.elapsed = 0;
  for (let i = 0; i < 3; i++) step();
  try { if (CBZ.dayPhase) CBZ.dayPhase((11 - 6) / 24); } catch (_) {}
  const fade = document.getElementById("fade"); if (fade) fade.style.opacity = "0";
  for (const g of CBZ.guards || []) { g.hunt = 0; g.alert = 0; g.sus = 0; g._chase = null; g.investigate = null; g._escort = false; g.capCD = 0; }
  for (const n of CBZ.npcs || []) { if (n.huntPlayer > 0) { n.huntPlayer = 0; n._blow = null; if (n.char) n.char.fightStance = false; } n.playerGrudge = 0; }
  place(YARD.x - 14, YARD.z);
  for (let i = 0; i < 60; i++) { G.invuln = 0; step(); }      // past prisonlaw's new-run wipe (0.5 s)

  // ---- the cast: one officer (two for "two"), the rest out of the frame ----
  const alive = (n) => n && n.group && !n.dead && !(n.ko > 0) && !n.escaped && n.kind !== "warden";
  S.cast = S.cast || {};
  let cast = S.cast[sub.scn];
  if (!cast || !cast.every(alive)) {
    const pool = (CBZ.guards || []).filter((n) => alive(n) && !S.used.has(n));
    pool.sort((a, b) => Math.hypot(a.group.position.x - YARD.x, a.group.position.z - YARD.z) - Math.hypot(b.group.position.x - YARD.x, b.group.position.z - YARD.z));
    cast = pool.slice(0, cfg.second ? 2 : 1);
    if (cast.length < (cfg.second ? 2 : 1)) return { ok: false, err: "no officer to cast" };
    for (const c of cast) S.used.add(c);
    S.cast[sub.scn] = cast;
  }
  const gd = cast[0], gd2 = cast[1] || null;
  for (const n of (CBZ.npcs || []).concat(CBZ.guards || [])) {
    if (!n.group || cast.indexOf(n) >= 0) continue;
    const d = Math.hypot(n.group.position.x - YARD.x, n.group.position.z - YARD.z);
    if (d < 20 && !n._crowd) { n.group.position.x += (n.group.position.x < YARD.x ? -1 : 1) * 24; }
    if (CBZ.guards && CBZ.guards.indexOf(n) >= 0) { n.hunt = 0; n.pause = 30; }
  }

  // ---- the start: you at the yard mark facing +z, him `gap` behind you ----
  place(YARD.x, YARD.z);
  faceDir(0);
  const ready = (g) => { g.pause = 0; g.ko = 0; g.hunt = 12; g.alert = 1; g.sus = 1; g.capCD = 0; g.investigate = null; g._chase = null; g._escort = false; g.warnT = null; };
  gd.group.position.set(YARD.x, 0, YARD.z - cfg.gap); gd.group.rotation.y = 0; ready(gd);
  if (gd2) { gd2.group.position.set(YARD.x + 3.4, 0, YARD.z - 1.2); gd2.group.rotation.y = -Math.PI / 2; ready(gd2); }
  for (let i = 0; i < 2; i++) { G.invuln = 0; step(); }
  try { CBZ.prisonOffense("fight", { severity: 2, seenBy: gd }); } catch (_) {}
  gd.hunt = 12;

  // ---- the strip ----
  const W = input.width, H = input.height, COLS = 3, ROWS = 2, TOP = 132, CAP = 34;
  const cw = Math.floor(W / COLS), chh = Math.floor((H - TOP) / ROWS) - CAP;
  let strip = document.getElementById("__arrestStrip");
  if (!strip) {
    strip = document.createElement("canvas");
    strip.id = "__arrestStrip";
    strip.style.cssText = "position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none";
    document.body.appendChild(strip);
  }
  strip.width = W; strip.height = H; strip.style.width = W + "px"; strip.style.height = H + "px";
  const g2d = strip.getContext("2d");
  g2d.fillStyle = "#0e1114"; g2d.fillRect(0, 0, W, H);
  const camera = CBZ.camera;
  let shotN = 0;
  const lines = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const cuffedNow = () => !!(CBZ.playerChar && CBZ.playerChar.cuffed);
  const stateLine = () => {
    const s = sessP();
    const you = playerDown() ? "YOU DOWN" : "you up";
    const hands = s ? `${s.verb}/${s.phase}${s.ground ? " (floor)" : ""}` : "no hands on you";
    let two = "";
    if (gd2) {
      const as = V && V.assisting ? V.assisting(gd2) : null;
      two = ` · 2nd ${dist(gd2.group.position, P.pos).toFixed(1)} m${as ? " HANDS ON" : ""}`;
    }
    return `${you} · ${cuffedNow() ? "CUFFED" : "free"} · ${hands} · screw ${dist(gd.group.position, P.pos).toFixed(1)} m${two}`;
  };
  const shoot = (tt) => {
    if (shotN >= COLS * ROWS) return;
    // a side camera that keeps the man in frame (the walk goes somewhere)
    camera.position.set(P.pos.x + 5.2, 1.8, P.pos.z - 0.8);
    camera.lookAt(P.pos.x, 0.65, P.pos.z);
    camera.aspect = CBZ.renderer.domElement.width / CBZ.renderer.domElement.height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    CBZ.renderer.render(CBZ.scene, camera);
    const src = CBZ.renderer.domElement;
    const sa = src.width / src.height, ca = cw / chh;
    let sx = 0, sy = 0, sw = src.width, sh = src.height;
    if (sa > ca) { sw = sh * ca; sx = (src.width - sw) / 2; } else { sh = sw / ca; sy = (src.height - sh) / 2; }
    const x = (shotN % COLS) * cw, y = TOP + Math.floor(shotN / COLS) * (chh + CAP);
    g2d.drawImage(src, sx, sy, sw, sh, x + 2, y, cw - 4, chh);
    const line = stateLine();
    lines.push(`+${tt.toFixed(2)}s ${line}`);
    g2d.fillStyle = "#0e1114"; g2d.fillRect(x, y + chh, cw, CAP);
    g2d.font = "800 13px -apple-system,Helvetica,Arial"; g2d.fillStyle = "#ffd166"; g2d.fillText(`+${tt.toFixed(2)} s`, x + 8, y + chh + 21);
    g2d.font = "600 10px ui-monospace,Menlo,monospace"; g2d.fillStyle = /CUFFED|DOWN|carry/.test(line) ? "#9fe8c3" : "#c0cfda"; g2d.fillText(line, x + 66, y + chh + 21);
    shotN++;
  };

  // ---- the phase trail: every state the machines went through ----
  const trail = { arrest: [], scene: [], haul: [], hands: [] };
  const push = (k, v) => { const L = trail[k]; if (v && L[L.length - 1] !== v) L.push(v); };
  let everCuffed = false, everCarry = false, everFloorCuff = false, everEscort = false, everHelp = false, everDown = false;
  const watch = () => {
    try { push("arrest", CBZ.prisonArrestPhase ? CBZ.prisonArrestPhase() : null); } catch (_) {}
    try { push("scene", CBZ.jailEscortPhase ? CBZ.jailEscortPhase() : null); } catch (_) {}
    try { const h = CBZ.prisonHaul ? CBZ.prisonHaul() : null; push("haul", h ? h.phase : null); } catch (_) {}
    const s = sessP();
    if (s) {
      push("hands", `${s.verb}/${s.phase}`);
      if (s.verb === "carry") everCarry = true;
      if (s.verb === "cuff" && s.ground) everFloorCuff = true;
      if (s.verb === "escort") everEscort = true;
    }
    if (cuffedNow()) everCuffed = true;
    if (playerDown()) everDown = true;
    if (gd2 && V && V.assisting && V.assisting(gd2)) everHelp = true;
  };

  const times = cfg.times, lastT = times[times.length - 1];
  const due = (f) => { while (shotN < times.length && f / 60 >= times[shotN] - 1e-6) shoot(times[shotN]); };
  const notes = [];
  let t0F = 0;                     // the frame the photographed event starts at
  Math.random = rnd;
  try {
    // ---- the pre-roll some strips need before their clock starts ----
    if (cfg.act === "wrench" || cfg.act === "butt") {
      // the order, on your knees, until his hands are on you (wrench) or
      // you are cuffed and being walked (butt)
      let ok = false;
      for (let f = 0; f < 60 * 16 && !ok; f++) {
        keys.c = true; G.invuln = 0;
        step(); watch();
        const s = sessP();
        if (cfg.act === "wrench") ok = !!(s && s.verb === "cuff" && s.phase !== "approach");
        else ok = !!(s && s.verb === "escort" && s.phase === "hold" && s.pt > 0.6);
      }
      keys.c = false;
      if (!ok) notes.push(cfg.act === "wrench" ? "hands never landed in 16 s" : "never walked in cuffs in 16 s");
    }
    if (cfg.act === "ko") {
      for (let f = 0; f < 4; f++) { G.invuln = 0; step(); }
      let ko = false;
      try { ko = !!(CBZ.vitals && CBZ.vitals.ko && CBZ.vitals.ko(P, 8, { by: gd, cause: "beaten" })); } catch (e) { notes.push("ko threw: " + e.message); }
      if (!ko) notes.push("vitals.ko refused");
    }
    // ---- the photographed event ----
    const N = Math.round(lastT * 60);
    for (let f = 0; f <= N; f++) {
      due(f);
      const tt = f / 60;
      if (cfg.act === "kneel") keys.c = true;
      if (cfg.act === "run") {
        // you run from the order: straight away from him until you are on the floor
        const go = tt < 2.5 && !playerDown();
        keys.w = go; keys.shift = go;
        if (go) faceDir(0);
      }
      if (cfg.act === "wrench") {
        // pull straight away from him, and wrench on every 9th frame
        const s = sessP();
        const held = !!(s && s.phase !== "approach");
        keys.w = held && tt < 3.5;
        if (held) faceDir(0);
        if (held && tt < 3.5 && f % 9 === 0) press(" ");
      }
      if (cfg.act === "butt") {
        if (f === 1) { try { const r = CBZ.melee && CBZ.melee.trigger ? CBZ.melee.trigger(true) : null; notes.push("button " + (r ? "took" : "did nothing")); } catch (e) { notes.push("trigger threw: " + e.message); } }
        if (f === 3) { try { CBZ.melee.trigger(false); } catch (_) {} }
      }
      if (f < 30) G.invuln = 0;
      step(); watch();
    }
    due(1e9);
  } finally {
    Math.random = mathRandom;
    clearKeys();
  }

  // ---- the numbers ----
  const k = sub.id;
  const metrics = {};
  metrics[k + "Cuffed"] = everCuffed ? 1 : 0;
  metrics[k + "Carried"] = everCarry ? 1 : 0;
  metrics[k + "FloorCuff"] = everFloorCuff ? 1 : 0;
  metrics[k + "Walked"] = everEscort ? 1 : 0;
  metrics[k + "EverDown"] = everDown ? 1 : 0;
  if (gd2) metrics[k + "SecondHands"] = everHelp ? 1 : 0;
  const trailTxt = [
    "arrest: " + (trail.arrest.join(" > ") || "-"),
    "hands: " + (trail.hands.join(" > ") || "-"),
    "carry scene: " + (trail.scene.join(" > ") || "-"),
    "walk: " + (trail.haul.join(" > ") || "-"),
  ];
  const perf = trailTxt.join("<br>") + (notes.length ? "<br>" + notes.join("; ") : "");
  const caption = `cuffed: ${everCuffed ? "yes" : "no"} · on the floor: ${everFloorCuff ? "yes" : "no"} · carried: ${everCarry ? "yes" : "no"} · walked: ${everEscort ? "yes" : "no"}${gd2 ? ` · second officer's hands: ${everHelp ? "yes" : "no"}` : ""}`;
  setHud(false);

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = sub.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:520px";
  q("focus").textContent = caption;
  q("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:560px";
  q("perf").innerHTML = perf;
  q("perf").style.cssText = "position:absolute;right:24px;top:18px;text-align:right;line-height:1.55;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;max-width:520px";
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
  id: "prison-arrest",
  title: "Prison Escape: getting arrested, and resisting",
  description: "The order and going to your knees, running from it, being knocked out with an offense on file (BEFORE: the infirmary carry; AFTER: cuffed on the floor), wrenching at the grip, a headbutt while walked in cuffs, and a second officer in reach, each as a strip of frames from the start of the event. BEFORE = HEAD on its own port.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · WORKING TREE",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "Cuffed: the cuffs were on at any point. Carried: a carry verb ever had you (the over-the-shoulder). FloorCuff: you were cuffed where you lay (the ground cuff). Walked: an escort ever had you. EverDown: you were on the floor at any point. SecondHands: the second officer ever had his hands on you (AFTER only has the verb).",
  metrics: {},
  subjects,
  stage: stageArrest,
  launchSides,
};
