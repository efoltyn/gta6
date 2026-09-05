/* prison-ai-movement.mjs — NOBODY VIBRATES, NOBODY RUNS ON THE SPOT.

   OWNER (2026-09-04, from his own cell door): "greatly improve ai movement …
   fix glitchiness, there's a lot of glitchiness, getting stuck in cell."

   What the probe found on main b950dc9, sixty seconds of 09:00 (tools:
   a per-actor stall/jitter census with the writer's stack on every jump):

     · FOUR RESIDENTS MOVED 1,800 m A MINUTE WITHOUT LEAVING THEIR CELLS.
       world/cellblock.js's bunk lounge unseated a seated man every frame
       (his distance to the entry point was 0.5 m by construction and the
       test was `> 0.5`), the post-pass pinned the standing body back into the
       frame without the sit pose, systems/actorcollide.js threw it out, and
       the next pre-pass sat it down again. At the 21:30 count three men did
       it at sixty metres a second: 19,400 m of back-and-forth in a minute.
     · A "BACK"-STYLE BUNK MAN WALKED INTO HIS OWN BED FOR AS LONG AS HE WAS
       CALM. His entry point was measured off the seat, which for that style
       is INSIDE the mattress, so it sat on the frame's collider edge — a point
       a 0.5 m body cannot reach. Kessler: 4.4 of 4.8 s stalled, legs going.
     · THE LEGS WERE FED THE ORDER, NOT THE GROUND: every body the wall
       resolver held ran on the spot, wherever it happened.
     · AT NIGHT, TWENTY-TWO MEN GROUND THE SHUT BLOCK GATE: a goal a step away
       through a wall came back as "no plan" and the wall-follow walked them
       along the leaf and back into it until dawn.

   Five plates. Each carries its own number, measured on both builds by the
   same code: metres of back-and-forth (a walker scores ~0), seconds of thigh
   swing with no gain (running in place), stalled share and grinders for the
   whole cast, men pressed to the gate. BEFORE is HEAD on its own port
   (launchSides); set BA_BEFORE_REF to photograph another commit. */

const subjects = [
  { id: "bunk-back", label: "A man and his bunk", act: "bunk", hud: false,
    focus: "A ground-floor resident whose trait is his bunk, 'back' style (sat INTO the bed). BEFORE: he walks at the frame for as long as he is calm — legs going, gaining nothing. AFTER: he walks to the frame's edge and sits." },
  { id: "tier-sit", label: "Upstairs, with a friend below", act: "tier", hud: false,
    focus: "A locked upper-tier resident given a pal he cannot reach. BEFORE: unseated, pinned, thrown out of the frame and sat down again — every frame, half a metre each way. AFTER: he sits, and stays sat." },
  { id: "wing-day", label: "The wing at mid-morning", act: "day", hud: false,
    focus: "Thirty seconds of 09:00 from the north landing, doors open. The numbers are the whole cast's: metres of back-and-forth, share of attempted movement spent pressed into something, bodies stalled more than 1.5 s." },
  { id: "wing-count", label: "The count", act: "count", hud: false,
    focus: "Thirty seconds of 21:30: everybody walking home through the throat, the galleries and their own doors. Same census." },
  { id: "gate-night", label: "Locked out at 23:00", act: "night", hud: false,
    focus: "The block gate from the yard side after it racks shut with men still outside. BEFORE: they slide along the leaf and walk back into it all night. AFTER: they come up to it, stop short, and wait." },
];

async function stageMove(input) {
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
      if (child.id === "__moveOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__moveSeq;
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
    overlay.id = "__moveOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__moveSeq = { overlay, hour: 9 };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const wing = CBZ.cellblock;
  if (!wing || !wing.cells || !wing.cells.length) return { ok: false, err: "no cellblock" };
  const pin = (h) => { try { if (CBZ.dayPhase) CBZ.dayPhase((h - 6) / 24); } catch (_) {} };
  const stepOne = () => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    CBZ.stepSim(1 / 60);
    if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
  };
  const place = (x, z) => {
    const P = CBZ.player;
    if (!P || !P.pos) return;
    P.pos.set(x, 0, z); P.vy = 0;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(x, 0, z);
  };
  const setHour = (h) => {
    S.hour = h;
    // THE PLAYER IS NOT THE SUBJECT, AND HE MUST NOT END THE RUN: a man standing
    // in the throat at lock-up is caught by the count, the game leaves
    // "playing", and stepSim stops stepping — which reads as every inmate
    // frozen mid-stride (that cost a diagnosis round). At lock-up he stands in
    // his own cell like everybody else.
    if (h >= 20 && wing.playerCell) place(wing.playerCell.x, wing.playerCell.z);
    // let the schedule and every route converge on the block before measuring
    for (let c = 0; c < 10; c++) { pin(h); for (let k = 0; k < 30; k++) stepOne(); }
    pin(h);
  };
  const alive = (n) => n && n !== "player" && n.group && !n.dead && !n.escaped && !n._crowd;
  const thigh = (n) => (n.char && n.char.parts && n.char.parts.ll) ? n.char.parts.ll.rotation.x : 0;

  /* THE CENSUS — one instrument, both builds. Steps `secs` of sim and scores
     every inmate on: metres of frame-to-frame REVERSAL (jitter), frames trying
     to move and achieving under 35% of the ordered step (stalled), and
     thigh swing with no gain (treadmill). `watch` gets the per-body detail. */
  const run = (secs, opts) => {
    const list = (CBZ.npcs || []).filter(alive);
    const rec = list.map((a) => ({ a, px: a.group.position.x, pz: a.group.position.z, ldx: 0, ldz: 0, jit: 0, tryF: 0, stallF: 0, tread: 0, th: thigh(a) }));
    const FR = Math.round(secs * 60);
    for (let f = 0; f < FR; f++) {
      if (f % 30 === 0) pin(S.hour);
      if (opts && opts.each) opts.each(f);
      stepOne();
      if (opts && opts.after) opts.after(f);
      for (const e of rec) {
        const a = e.a, p = a.group.position;
        const dx = p.x - e.px, dz = p.z - e.pz, moved = Math.hypot(dx, dz);
        e.px = p.x; e.pz = p.z;
        const lm = Math.hypot(e.ldx, e.ldz);
        if (dx * e.ldx + dz * e.ldz < 0 && moved > 0.004 && lm > 0.004) e.jit += Math.min(moved, lm);
        e.ldx = dx; e.ldz = dz;
        const t0 = e.th; e.th = thigh(a);
        const seated = !!(a.char && (a.char.sitting || a.char.lying)) || a._propLie || a._propSeat || a._propBed;
        if (!seated && Math.abs(e.th - t0) > 0.02 && moved < 0.005) e.tread++;
        if (a.dead || (a.ko | 0) > 0 || seated) continue;
        const t = a.target; if (!t) continue;
        if (Math.hypot(t.x - p.x, t.z - p.z) < 1.0) continue;
        if ((a.pause || 0) > 0) continue;
        e.tryF++;
        const want = (a._spd != null ? a._spd : a.speed) * (1 / 60) * 0.35;
        if (moved < want) e.stallF++;
      }
    }
    let jit = 0, tryF = 0, stallF = 0, grinders = 0, tread = 0;
    for (const e of rec) { jit += e.jit; tryF += e.tryF; stallF += e.stallF; tread += e.tread; if (e.stallF / 60 > 1.5) grinders++; }
    const of = (a) => rec.find((e) => e.a === a);
    return { jitterM: Math.round(jit * 10) / 10, stalledPct: tryF ? Math.round(100 * stallF / tryF) : 0, grinders, treadS: Math.round(tread / 60 * 10) / 10, of, actors: rec.length };
  };

  const cells = wing.cells;
  // the wing converges first: the grid builds, the cast is dealt onto its
  // posts, every route settles. A beat staged on a raw boot is a beat on a
  // wing that has not started yet (the bunk plate photographed a man who
  // never got his first lounge pass).
  if (!S.settled) { for (let i = 0; i < 180; i++) { if (i % 30 === 0) pin(S.hour); stepOne(); } S.settled = true; }
  const sub = input.subject;
  const metrics = {};
  let cam = null, caption = "", perf = "";
  const doorSide = (c, off, up) => (c.dx !== 0
    ? { x: c.faceX + c.dx * off, y: (c.fy || 0) + up, z: c.doorZ != null ? c.doorZ : c.z }
    : { x: c.doorX != null ? c.doorX : c.x, y: (c.fy || 0) + up, z: c.faceZ + c.dz * off });

  if (sub.act === "bunk") {
    if (S.hour !== 9) setHour(9);
    // a ground-floor bunk man of the "back" style — the one seated INTO the bed
    const pick = cells.find((c) => !c.tier && alive(c.owner) && c.owner._cellPose === "bunk" && c.bunk && wing.bunkStyle && wing.bunkStyle(c) === "back")
      || cells.find((c) => !c.tier && alive(c.owner) && c.owner._cellPose === "bunk" && c.bunk);
    if (!pick) return { ok: false, err: "no bunk resident" };
    const n = pick.owner;
    // calm him and put him at his own door, inside: the walk to the bunk is the beat
    n.aiState = "wander"; n.aiTimer = 30; n.social = null; n.huntPlayer = 0; n.pause = 0;
    n._bunkGiveUp = 0; n._lgStall = 0; n._lgD = null;   // the beat starts fresh: he wants his bunk now
    try { if (n.char && n.char.sitting && CBZ.setCharPose) CBZ.setCharPose(n.char, "stand"); } catch (_) {}
    const inside = doorSide(pick, -1.2, 0);
    n.group.position.x = inside.x; n.group.position.z = inside.z;
    place(pick.faceX + pick.dx * 6, pick.faceZ + pick.dz * 6);
    // a calm man on his way somewhere: the routine's stand/stretch beats
    // would otherwise park him for up to ten seconds of an eight-second plate
    const R = run(8, { each: () => { n.aiState = "wander"; n.aiTimer = 30; n.huntPlayer = 0; n._lifeActivity = "walk"; n._lifeT = 30; } });
    const e = R.of(n);
    const p = n.group.position;
    const seated = !!(n.char && n.char.sitting);
    const toFrame = Math.abs((pick.bunk.along === "z" ? p.x - pick.bunk.x : p.z - pick.bunk.z)) - (pick.bunk.along === "z" ? pick.bunk.latOut : pick.bunk.lonOut);
    metrics.bunkStallS = Math.round(e.stallF / 60 * 10) / 10;
    metrics.bunkTreadS = Math.round(e.tread / 60 * 10) / 10;
    metrics.bunkSeated = seated ? 1 : 0;
    metrics.bunkJitterM = Math.round(e.jit * 100) / 100;
    caption = `cell ${pick.tag || pick.i} · ${(n.data && n.data.name) || "inmate"} · ${wing.bunkStyle ? wing.bunkStyle(pick) : "?"} style · ${seated ? "SEATED" : "on his feet"}`;
    perf = `${metrics.bunkStallS.toFixed(1)} s of 8 pressed into the frame<br>${metrics.bunkTreadS.toFixed(1)} s legs going, body gaining nothing<br>${seated ? "sat on his bunk" : `${Math.max(0, toFrame).toFixed(2)} m from the frame, standing`}`;
    const look = { x: pick.bunk.x, y: (pick.fy || 0) + 0.8, z: pick.bunk.z };
    const from = doorSide(pick, -0.35, 1.55);
    cam = { x: from.x, y: from.y, z: from.z, ax: look.x, ay: look.y, az: look.z, fov: 60 };
  } else if (sub.act === "tier") {
    if (S.hour !== 9) setHour(9);
    const pick = cells.find((c) => c.tier && alive(c.owner) && c.owner._cellPose === "bunk" && c.bunk)
      || cells.find((c) => c.tier && alive(c.owner) && c.bunk);
    if (!pick) return { ok: false, err: "no upper resident" };
    const n = pick.owner;
    n._cellPose = "bunk";
    // a pal on the floor below, inside twelve metres, that he can never get to
    const gp = n.group.position;
    let pal = null, bd = 1e9;
    for (const a of CBZ.npcs) {
      if (!alive(a) || a === n || a._cellIdx === pick.i) continue;
      const d = Math.hypot(a.group.position.x - gp.x, a.group.position.z - gp.z);
      if (d > 2.6 && d < 11 && d < bd) { bd = d; pal = a; }
    }
    place(0, -9.4);
    const R = run(5, { each: () => { if (pal) { n.aiState = "socialize"; n.social = pal; pal.pause = Math.max(pal.pause || 0, 1); } } });
    const e = R.of(n);
    metrics.tierJitterM = Math.round(e.jit * 10) / 10;
    metrics.tierSeated = (n.char && n.char.sitting) ? 1 : 0;
    caption = `cell ${pick.tag || pick.i} · ${(n.data && n.data.name) || "inmate"} · leaf ${pick.locked ? "SHUT" : "open"} · pal ${pal ? `${bd.toFixed(1)} m away` : "none"}`;
    perf = `${metrics.tierJitterM.toFixed(1)} m of back-and-forth in 5 s<br>${metrics.tierSeated ? "sat on his bunk" : "on his feet"}`;
    const from = doorSide(pick, 1.1, 1.5);
    cam = { x: from.x, y: from.y, z: from.z, ax: pick.bunk.x, ay: (pick.fy || 0) + 0.7, az: pick.bunk.z, fov: 62 };
  } else if (sub.act === "day" || sub.act === "count") {
    const h = sub.act === "day" ? 9 : 21.5;
    if (S.hour !== h) setHour(h);
    if (h < 20) place(0, -9.4);
    const R = run(30);
    const key = sub.act === "day" ? "day" : "count";
    metrics[key + "JitterM"] = R.jitterM;
    metrics[key + "StalledPct"] = R.stalledPct;
    metrics[key + "Grinders"] = R.grinders;
    metrics[key + "TreadS"] = R.treadS;
    caption = `${R.actors} inmates · ${h === 9 ? "09:00" : "21:30"} · 30 s of sim`;
    perf = `${R.jitterM.toFixed(1)} m of back-and-forth, whole cast<br>${R.stalledPct}% of attempted movement pressed into something<br>${R.grinders} bodies stalled more than 1.5 s<br>${R.treadS.toFixed(1)} s of legs going with no gain`;
    cam = { x: 0, y: 5.7, z: -36.3, ax: 0, ay: 1.0, az: -8, fov: 62 };
  } else if (sub.act === "night") {
    if (S.hour !== 23) setHour(23);
    const gate = CBZ.door;
    const gz = gate && gate.readerPos ? gate.readerPos.z - 1.2 : -9.8;
    const R = run(20);
    let onGate = 0, waiting = 0;
    for (const a of CBZ.npcs) {
      if (!alive(a)) continue;
      const p = a.group.position;
      if (Math.abs(p.x) > 6 || p.z < gz - 1.5 || p.z > gz + 6) continue;
      if (p.z < gz + 2.4) onGate++; else waiting++;
    }
    metrics.nightOnGate = onGate;
    metrics.nightStalledPct = R.stalledPct;
    metrics.nightGrinders = R.grinders;
    metrics.nightJitterM = R.jitterM;
    caption = `23:00 · gate ${gate && gate.open ? "OPEN" : "shut"} · ${onGate} men within 2.4 m of it · ${waiting} standing off`;
    perf = `${onGate} men pressed to the gate<br>${R.stalledPct}% of attempted movement pressed into something<br>${R.grinders} bodies stalled more than 1.5 s`;
    cam = { x: 3.5, y: 2.1, z: gz + 9.5, ax: 0, ay: 1.0, az: gz, fov: 60 };
  }

  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 56;
  camera.near = 0.12;
  camera.far = 20000;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  setHud(false);
  CBZ.renderer.render(CBZ.scene, camera);

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = sub.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:400px";
  q("focus").textContent = caption;
  q("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:440px";
  q("perf").innerHTML = perf;
  q("perf").style.cssText = "position:absolute;right:24px;top:24px;text-align:right;line-height:1.7;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return { ok: true, metrics };
}

/* BEFORE = HEAD, served off a detached worktree on its own port. The
   worktree is made once per run under the system temp dir and removed in
   close(). An explicit --before URL still wins (web adapter contract).
   BA_BEFORE_REF (process env) names another commit. */
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
  id: "prison-ai-movement",
  title: "Prison Escape: nobody vibrates, nobody runs on the spot",
  description: "A bunk man walking into his own bed, an upper-tier man sitting down and standing up every frame, the whole wing at 09:00 and at the 21:30 count, and the men locked out at 23:00 — each plate carries its own measurement. BEFORE = HEAD on its own port.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · WORKING TREE",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "JitterM is metres of frame-to-frame direction REVERSAL summed over the cast (a man walking somewhere scores ~0; a man ping-ponging between two systems scores his whole travel). StalledPct is the share of attempted movement (a live target over a metre off, no pause, not seated) that achieved under 35% of the ordered step. Grinders are bodies stalled more than 1.5 s. TreadS is seconds of thigh swing with under 5 mm of gain — running on the spot, read off the rig.",
  metrics: {
    bunkStallS: { label: "Bunk man: pressed into the frame", unit: "s", better: "lower" },
    bunkTreadS: { label: "Bunk man: running on the spot", unit: "s", better: "lower" },
    bunkSeated: { label: "Bunk man: sat down", better: "higher" },
    bunkJitterM: { label: "Bunk man: back-and-forth", unit: "m", better: "lower" },
    tierJitterM: { label: "Upstairs man: back-and-forth in 5 s", unit: "m", better: "lower" },
    tierSeated: { label: "Upstairs man: sat down", better: "higher" },
    dayJitterM: { label: "09:00 cast: back-and-forth", unit: "m", better: "lower" },
    dayStalledPct: { label: "09:00 cast: movement stalled", unit: "%", better: "lower" },
    dayGrinders: { label: "09:00 cast: grinders", better: "lower" },
    dayTreadS: { label: "09:00 cast: running on the spot", unit: "s", better: "lower" },
    countJitterM: { label: "Count: back-and-forth", unit: "m", better: "lower" },
    countStalledPct: { label: "Count: movement stalled", unit: "%", better: "lower" },
    countGrinders: { label: "Count: grinders", better: "lower" },
    countTreadS: { label: "Count: running on the spot", unit: "s", better: "lower" },
    nightOnGate: { label: "23:00: men pressed to the gate", better: "lower" },
    nightStalledPct: { label: "23:00: movement stalled", unit: "%", better: "lower" },
    nightGrinders: { label: "23:00: grinders", better: "lower" },
    nightJitterM: { label: "23:00: back-and-forth", unit: "m", better: "lower" },
  },
  subjects,
  stage: stageMove,
  launchSides,
};
