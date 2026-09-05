/* prison-fight.mjs — THE FIGHT, FROM INSIDE IT.

   OWNER (2026-09-05): "when the cam gets too close to another player it makes
   their head partially see-through … the issue is more with the enemy I'm
   fighting: when they get close, their head at the top, I see through it —
   my head goes through theirs. Just make the camera respect colliders … make
   punching in first person look better, right now it looks shit … when you
   fight a group of people they freeze you. So many dumb fighting things."

   What the code said before this wave:
     · humancontact.js resolved you-vs-him 88/12 and then clamped you out of
       the wall — so with your back to a wall he ended every frame inside
       you, and the fight stance put his skull inside the 0.1 m near plane;
     · camera.js swept the boom against walls only: a man was air to it, and
       the prison's 0.28 m arm floor parked the lens in your own head;
     · the first-person "punch" was one Minecraft hand sliding forward,
       fully extended at 0.08 s and halfway home when the hit was billed;
     · every landed inmate punch wrote a 0.42-0.72 s FULL input lock, billed
       on the wind-up frame, on each man's own 1.0 s clock — three men kept
       it armed forever. That is the freeze.

   Five plates, each with its own number, measured on both builds by the same
   code. BEFORE is HEAD on its own port (launchSides); BA_BEFORE_REF picks
   another commit. The first-person plates are the live lens — no staged
   camera — because the lens IS the subject. */

const subjects = [
  { id: "guard-up", label: "He squares up", act: "guard", hud: false,
    focus: "First person, the moment three men close on you in the yard. BEFORE: one relaxed hand bottom-right, whatever is happening. AFTER: both fists come up into a guard and weave; the man in front holds fist range instead of walking into the lens." },
  { id: "jab", label: "The jab, on its frame", act: "jab", hud: false,
    focus: "The frame systems/combat.js bills the hit (0.15 s in). BEFORE: the single hand is already on its way back. AFTER: the lead fist is at full reach on the crosshair, pronated, the other hand still guarding the chin." },
  { id: "hook", label: "The hook", act: "hook", hud: false,
    focus: "Third punch of a chain — the heavy. BEFORE: the same forward slide as every other swing. AFTER: the fist swings wide and comes in across the frame on an arc, the lens rolling a few degrees with the torso." },
  { id: "swarm", label: "Six seconds of three men", act: "swarm", hud: false,
    focus: "You stand still and three inmates beat you for six seconds. The numbers are what the controls were doing: the share of frames with movement input ZEROED, the share where you could not start a swing, how close the nearest skull came to the lens, and frames a body ended inside yours." },
  { id: "corner", label: "Cornered, third person", act: "corner", hud: false,
    focus: "Back to the rear wall of your own cell, a man on you, third person. BEFORE: the boom collapses to its 0.28 m floor and the lens sits inside your own head; the man walks through you. AFTER: the arm is measured against him too, and an arm short enough to be inside your skull hides the rig for the frame." },
];

async function stageFight(input) {
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
      if (child.id === "__fightOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__fightSeq;
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
    overlay.id = "__fightOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__fightSeq = { overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
    try { if (CBZ.dayPhase) CBZ.dayPhase((10 - 6) / 24); } catch (_) {}
    // the prison reveal (camera.js INTRO, 3.55 s of sim) hands the lens back at
    // its end and disarms first person as it does — stage only after that
    for (let i = 0; i < 600; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    CBZ.CONFIG.JAIL_GRAB_P = 0;   // the grab is its own beat (and a coin); these plates measure the fists
  }

  const P = CBZ.player;
  const YARD = { x: 0, z: 34 };
  const alive = (n) => n && n.group && !n.dead && !n.escaped && !n._crowd && !(n.ko > 0);
  let holdFP = false;
  const step = (exact) => {
    if (exact) { CBZ.hitstop = 0; CBZ.slowmo = 0; }
    P.hp = 100; P.dead = false;
    CBZ.stepSim(1 / 60);
    // the reveal's completion callback disarms first person; the plate keeps it
    if (holdFP && CBZ.fps && !CBZ.fps.active && CBZ.setFPS) CBZ.setFPS(true);
  };
  const place = (x, z, y) => {
    P.pos.set(x, y || 0, z); P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(x, y || 0, z);
  };
  const face = (x, z) => {
    // first-person forward is (-sin yaw, 0, -cos yaw) — same basis fpsmode uses
    CBZ.cam.yaw = Math.atan2(-(x - P.pos.x), -(z - P.pos.z));
    CBZ.cam.pitch = 0;
    if (CBZ.fps) CBZ.fps.fp = 0.02;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.rotation.y = Math.atan2(x - P.pos.x, z - P.pos.z);
  };
  const calm = () => {
    for (const n of CBZ.npcs || []) { if (n.huntPlayer > 0) { n.huntPlayer = 0; n._blow = null; if (n.char) n.char.fightStance = false; } }
    P.stun = 0; P.hitT = 0; P.hitLock = 0; P.poiseT = 0; P.hp = 100; P.dead = false;
  };
  const stand = (n) => {
    try { if (n.char && (n.char.sitting || n.char.lying) && CBZ.setCharPose) CBZ.setCharPose(n.char, "stand"); } catch (_) {}
    n._propSeat = null; n._propBed = null; n._propLie = null; n.pause = 0; n.social = null;
    n.aiState = "wander"; n.aiTimer = 30; n.fleeT = 0; n.foe = null; n.jumpBlows = 0; n._jumpGrabbed = 0; n._blow = null;
  };
  // k men placed around you at `r` metres, all set to jump you
  const hunters = (k, r, firstAngle) => {
    const pool = (CBZ.npcs || []).filter(alive)
      .sort((a, b) => Math.hypot(a.group.position.x - P.pos.x, a.group.position.z - P.pos.z) - Math.hypot(b.group.position.x - P.pos.x, b.group.position.z - P.pos.z))
      .slice(0, k);
    pool.forEach((n, i) => {
      stand(n);
      const ang = (firstAngle || 0) + (i - (k - 1) / 2) * 0.9;
      n.group.position.set(P.pos.x + Math.sin(ang) * r, P.pos.y, P.pos.z + Math.cos(ang) * r);
      n.huntPlayer = 30; n.hitCD = 1.2 + i * 0.35;
    });
    return pool;
  };
  const headOf = (n) => {
    const v = new T.Vector3();
    const neck = n.char && n.char.neck;
    if (neck && neck.children[0]) { n.group.updateWorldMatrix(true, true); neck.children[0].getWorldPosition(v); return v; }
    v.set(n.group.position.x, n.group.position.y + 1.6, n.group.position.z); return v;
  };
  const eye = () => new T.Vector3(P.pos.x, P.pos.y + 1.65, P.pos.z);

  const sub = input.subject;
  const metrics = {};
  let caption = "", perf = "";
  let liveCam = true;
  calm();
  for (let i = 0; i < 6; i++) step(true);

  if (sub.act === "guard" || sub.act === "jab" || sub.act === "hook" || sub.act === "swarm") {
    place(YARD.x, YARD.z);
    for (let i = 0; i < 4; i++) step(true);
    holdFP = true;
    if (CBZ.setFPS) CBZ.setFPS(true);
    const k = sub.act === "swarm" || sub.act === "guard" ? 3 : 1;
    const men = hunters(k, sub.act === "guard" ? 2.7 : (sub.act === "swarm" ? 2.2 : 1.35), 0);
    if (!men.length) return { ok: false, err: "no inmates near the yard" };
    face(men[Math.floor(men.length / 2)].group.position.x, men[Math.floor(men.length / 2)].group.position.z);
    if (sub.act === "guard") {
      for (let i = 0; i < 48; i++) { step(true); face(men[1].group.position.x, men[1].group.position.z); }
      let nearest = 1e9;
      for (const n of men) nearest = Math.min(nearest, eye().distanceTo(headOf(n)));
      metrics.guardUp = CBZ.fpsGuardK ? Math.round(CBZ.fpsGuardK() * 100) / 100 : 0;
      metrics.guardHeadM = Math.round(nearest * 100) / 100;
      caption = `${men.length} men jumping you · 0.8 s in · first person ${CBZ.fps && CBZ.fps.active ? "on" : "OFF"}`;
      perf = `nearest skull ${metrics.guardHeadM.toFixed(2)} m from the lens<br>guard raised ${Math.round(metrics.guardUp * 100)}%`;
    } else if (sub.act === "jab" || sub.act === "hook") {
      const m = men[0];
      m.hitCD = 9; m._blow = null;                 // he takes it, the shot is your fist
      // throw until combat.js accepts (a swing in flight or a BLOCKED beat refuses)
      const throwOne = () => {
        let r = null;
        for (let i = 0; i < 90 && !(r && r.ok); i++) {
          P.hitLock = 0; P.stun = 0; m.hitCD = 9; m._blow = null;
          // he stays in the arc (a landed fist knocks him back out of reach)
          m.group.position.set(P.pos.x, P.pos.y, P.pos.z + 1.35); if (m._phys) { m._phys.kx = 0; m._phys.kz = 0; }
          r = CBZ.punch(m);
          // the click path (fpsmode shoot) swings the hand after combat.js
          // accepts; a direct CBZ.punch has to ask for the swing itself
          if (r && r.ok && CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();
          if (!(r && r.ok)) step(true);
        }
        return r;
      };
      const ch = CBZ.playerChar;
      let r = throwOne();
      if (sub.act === "hook") {
        // keep chaining until the third beat of a chain comes up (a BLOCKED
        // roll or a whiff resets the combo, so it can take more than three)
        for (let n = 0; n < 9 && !(ch && ch.punchKind === "hook"); n++) {
          for (let i = 0; i < 21; i++) { step(true); m.hitCD = 9; m.group.position.set(P.pos.x, P.pos.y, P.pos.z + 1.35); }
          r = throwOne();
        }
      }
      const dur = (ch && ch.punchDur) || 0.34;
      const frames = Math.round(dur * 0.43 * 60);
      for (let i = 0; i < frames; i++) { step(true); m.hitCD = 9; m.group.position.set(P.pos.x + Math.sin(0) * 1.35, P.pos.y, P.pos.z + Math.cos(0) * 1.35); face(m.group.position.x, m.group.position.z); }
      // where is the striking fist, in lens space? (z is depth: more negative = further out)
      let reach = 0;
      try {
        const h = CBZ.camera.children.find((c) => c.visible && c.children && c.children.length);
        const fists = h && h.children.find((c) => c.userData && c.userData.hand);
        const hand = fists && fists.userData.hand;
        if (hand) { const v = new T.Vector3(); hand.getWorldPosition(v); CBZ.camera.worldToLocal(v); reach = -v.z; }
      } catch (_) {}
      const kind = ch && ch.punchKind;
      metrics[sub.act + "Kind"] = kind === "hook" ? 1 : (kind === "jab" || kind === "cross") ? 0 : -1;
      metrics[sub.act + "ReachM"] = Math.round(reach * 100) / 100;
      caption = `${kind || "swing"} · frame ${frames} of a ${dur.toFixed(2)} s swing · ${r && r.ok ? "thrown" : "refused"}`;
      perf = `striking fist ${reach.toFixed(2)} m out from the lens on the hit frame`;
    } else {
      // six seconds, standing still, three men
      let frozen = 0, locked = 0, hits = 0, through = 0, minHead = 1e9, minD = 9;
      const why = {};
      const FR = 360;
      for (let f = 0; f < FR; f++) {
        P.hp = 100;
        step(true);
        face(men[1].group.position.x, men[1].group.position.z);
        if (P.hp < 100) hits++;
        if ((P.stun || 0) > 0) frozen++;
        if ((P.stun || 0) > 0 || (P.hitLock || 0) > 0) locked++;
        for (const n of men) {
          if (!alive(n)) continue;
          const d = Math.hypot(n.group.position.x - P.pos.x, n.group.position.z - P.pos.z);
          if (d < 0.62) {
            through++;
            // attribution: is a wall behind you, and what is he doing?
            let wall = 0;
            try {
              const dx = (P.pos.x - n.group.position.x) / (d || 1), dz = (P.pos.z - n.group.position.z) / (d || 1);
              const q = { x: P.pos.x + dx * 0.30, y: P.pos.y, z: P.pos.z + dz * 0.30 };
              const qx = q.x, qz = q.z;
              CBZ.collide(q, 0.38, q.y + 0.25, q.y + 1.7);
              wall = Math.hypot(q.x - qx, q.z - qz) > 0.005 ? 1 : 0;
            } catch (_) {}
            const key = `${wall ? "wall" : "open"}|ko${n.ko > 0 ? 1 : 0}|sz${n._seizing ? 1 : 0}|tr${n._traversal ? 1 : 0}|sw${n.char && n.char.punchT > 0 ? 1 : 0}|bl${n._blow ? 1 : 0}|st${(P.stun || 0) > 0 ? 1 : 0}`;
            why[key] = (why[key] || 0) + 1;
            if (d < minD) minD = d;
            break;
          }
        }
        for (const n of men) { if (alive(n)) minHead = Math.min(minHead, eye().distanceTo(headOf(n))); }
      }
      metrics.swarmFrozenPct = Math.round(100 * frozen / FR);
      metrics.swarmLockedPct = Math.round(100 * locked / FR);
      metrics.swarmHits = hits;
      metrics.swarmHeadM = Math.round(minHead * 100) / 100;
      metrics.swarmThroughFrames = through;
      const whyS = Object.keys(why).map((k) => `${k}:${why[k]}`).join(" ");
      caption = `${men.length} men · 6 s · ${hits} blows landed on you${through ? ` · inside: ${whyS} min ${minD.toFixed(2)}` : ""}`;
      perf = `${metrics.swarmFrozenPct}% of frames: movement input ZEROED<br>${metrics.swarmLockedPct}% of frames: could not start a swing<br>nearest skull ${minHead.toFixed(2)} m from the lens<br>${through} frames with a body inside yours`;
    }
  } else if (sub.act === "corner") {
    const wing = CBZ.cellblock;
    const cells = (wing && wing.cells) || [];
    const c = cells.find((x) => !x.tier && x.dx != null) || cells[0];
    if (!c) return { ok: false, err: "no cell" };
    const inside = (off) => (c.dx !== 0
      ? { x: c.faceX + c.dx * off, z: c.doorZ != null ? c.doorZ : c.z }
      : { x: c.doorX != null ? c.doorX : c.x, z: c.faceZ + c.dz * off });
    const back = inside(-2.0), mouth = inside(-0.8), door = inside(0.6);
    place(back.x, back.z, c.fy || 0);
    CBZ.CONFIG.CAM_TIGHT_FP = false;          // the plate IS the third-person boom; the corridor auto-FP would hide it
    holdFP = false;
    if (CBZ.setFPS) CBZ.setFPS(false);
    const men = hunters(1, 1.0, 0);
    if (!men.length) return { ok: false, err: "no inmate" };
    const m = men[0];
    m.group.position.set(mouth.x, c.fy || 0, mouth.z);
    face(door.x, door.z);
    let armMin = 1e9, rigInLens = 0, camInMan = 0, through = 0;
    const FR = 120;
    for (let f = 0; f < FR; f++) {
      step(true);
      place(back.x, back.z, P.pos.y);        // you hold your ground; he comes to you
      face(door.x, door.z);
      const cam = CBZ.camera.position;
      const arm = Math.hypot(cam.x - P.pos.x, cam.y - (P.pos.y + 1.5), cam.z - P.pos.z);
      armMin = Math.min(armMin, arm);
      const rig = CBZ.playerChar && CBZ.playerChar.group;
      if (arm < 0.72 && rig && rig.visible) rigInLens++;
      const mp = m.group.position;
      if (Math.abs(cam.x - mp.x) < 0.3 && Math.abs(cam.z - mp.z) < 0.3 && cam.y > mp.y && cam.y < mp.y + 1.82) camInMan++;
      if (Math.hypot(mp.x - P.pos.x, mp.z - P.pos.z) < 0.62) through++;
    }
    metrics.cornerArmM = Math.round(armMin * 100) / 100;
    metrics.cornerRigInLens = rigInLens;
    metrics.cornerCamInMan = camInMan;
    metrics.cornerThroughFrames = through;
    caption = `cell ${c.tag || c.i} · back wall · third person · ${FR / 60} s`;
    perf = `shortest arm ${armMin.toFixed(2)} m<br>${rigInLens} frames with your own rig inside the lens<br>${camInMan} frames with the lens inside him<br>${through} frames with him inside you`;
  }

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
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

/* BEFORE = HEAD, served off a detached worktree on its own port. */
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
  id: "prison-fight",
  title: "Prison Escape: the fight, from inside it",
  description: "Three men closing in, the jab and the hook on their hit frames, six seconds of a beating measured on the controls, and the cornered third-person lens. BEFORE = HEAD on its own port.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · WORKING TREE",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "FrozenPct is the share of frames in a 6 s three-man beating where movement input was zeroed (player.stun). LockedPct adds the frames you could not start a swing. HeadM is the closest any attacker's skull came to the first-person lens (the near plane is 0.10 m; a box head is ~0.12 m wide, so anything under ~0.25 m is a head opening on screen). ThroughFrames are frames a standing attacker's centre ended inside 0.62 m of yours — bodies through bodies. ArmM is the shortest third-person arm; RigInLens counts frames that arm was inside your skull while the rig was still drawn.",
  metrics: {
    guardUp: { label: "Guard raised (0..1)", better: "higher" },
    guardHeadM: { label: "Nearest skull, guard plate", unit: "m", better: "higher" },
    jabReachM: { label: "Jab: wrist distance from the lens on the hit frame", unit: "m" },
    hookReachM: { label: "Hook: wrist distance from the lens on the hit frame", unit: "m" },
    hookKind: { label: "Hook plate threw a hook (1)", better: "higher" },
    swarmFrozenPct: { label: "Swarm: movement input zeroed", unit: "%", better: "lower" },
    swarmLockedPct: { label: "Swarm: could not swing", unit: "%", better: "lower" },
    swarmHits: { label: "Swarm: blows landed on you in 6 s", better: "lower" },
    swarmHeadM: { label: "Swarm: nearest skull to the lens", unit: "m", better: "higher" },
    swarmThroughFrames: { label: "Swarm: frames a body was inside yours", better: "lower" },
    cornerArmM: { label: "Corner: shortest camera arm", unit: "m", better: "higher" },
    cornerRigInLens: { label: "Corner: frames your rig sat in the lens", better: "lower" },
    cornerCamInMan: { label: "Corner: frames the lens was inside him", better: "lower" },
    cornerThroughFrames: { label: "Corner: frames he was inside you", better: "lower" },
  },
  subjects,
  stage: stageFight,
  launchSides,
};
