/* SHARK SIM, AS THE PLAYER SEES IT — tools/visual-compare preset.

   OWNER (2026-11-22): "look how shark sim game you spawn stuck to a rock and
   also camera is super fucked yo water turns pink and camera is really Messed
   up when attacking things and moving".

   Boots ?mode=sharksim and plays it the way a player does: the game's own
   camera (nothing here moves the lens), W held to swim, the lens yaw swept
   the way a mouse turns it, and the attack fired through
   CBZ.cityMountedAnimalAttack(true), the exact call the mouse button makes.
   Four moments:
     spawn   the first frames of the match, then W held for 3 s: does it move?
     swim    W held through a left and a right turn (frames 0.5 s apart)
     attack  steering onto the nearest prey and biting (frames 0.25 s apart)
     after   the water and the lens a few seconds after the kill
   Measured, not judged: how far the shark got with W held at spawn, and how
   much the camera shakes (RMS distance of the lens from its own 0.3 s moving
   average, and the same for the yaw the rendered lens actually faces) while
   swimming and while attacking. */

const subjects = [
  { id: "spawn", ch: 0, label: "The match starts", focus: "Where you spawn, 1 s in; the shark should be in clear water, not on a rock." },
  { id: "swim", ch: 1, strip: { frames: 6, stepSec: 0.5 }, label: "Swimming and turning", focus: "W held 3 s straight from the spawn, then the lens swept left and right the way a mouse turns it; frames 0.5 s apart." },
  { id: "attack", ch: 2, strip: { frames: 8, stepSec: 0.25 }, label: "Attacking", focus: "Steering onto the nearest prey and biting with the attack button; frames 0.25 s apart." },
  { id: "after", ch: 3, strip: { frames: 3, stepSec: 1.0 }, label: "After the kill", focus: "The water and the lens a few seconds later." },
];

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__ride;
  if (!D) {
    D = window.__ride = {
      chapter: -1, m: {}, path: [], steer: null, keyW: false,
      step(n) {
        for (let i = 0; i < n; i++) {
          if (CBZ.game.state !== "playing") CBZ.game.state = "playing";
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          if (CBZ.keys) CBZ.keys.w = !!D.keyW;
          if (D.steer) D.steer(1 / 60);
          CBZ.stepSim(1 / 60);
          const c = CBZ.camera;
          // the RENDERED lens: where it is and which way it actually faces
          if (c && D.rec) {
            c.updateMatrixWorld(true);
            const e = c.matrixWorld.elements;          // -Z column = the facing
            D.path.push([c.position.x, c.position.y, c.position.z, Math.atan2(-e[8], -e[10])]);
          }
        }
      },
      sec(s) { D.step(Math.max(1, Math.round(s * 60))); },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.mode !== "sharksim") return false;
        D._raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => D._raf.call(window, () => res()));
        try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
        return true;
      },
      me() { return (CBZ.cityMountedAnimal && CBZ.cityMountedAnimal()) || null; },
      // how much the lens shakes over a recorded stretch: RMS distance (cm) of
      // the lens from its own 0.3 s moving average, and the same for yaw (deg)
      shake(from) {
        const p = D.path.slice(from).map((q) => q.slice()), n = p.length, h = 9;
        // unwrap the yaw so a turn through +-pi is not read as a 360 deg jump
        for (let i = 1; i < n; i++) { let d = p[i][3] - p[i - 1][3]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p[i][3] = p[i - 1][3] + d; }
        if (n < 2 * h + 2) return { cm: -1, deg: -1 };
        let s2 = 0, y2 = 0, k = 0;
        for (let i = h; i < n - h; i++) {
          let ax = 0, ay = 0, az = 0, aw = 0;
          for (let j = i - h; j <= i + h; j++) { ax += p[j][0]; ay += p[j][1]; az += p[j][2]; aw += p[j][3]; }
          const q = 2 * h + 1; ax /= q; ay /= q; az /= q; aw /= q;
          s2 += (p[i][0] - ax) ** 2 + (p[i][1] - ay) ** 2 + (p[i][2] - az) ** 2;
          y2 += (p[i][3] - aw) ** 2; k++;
        }
        return { cm: +(Math.sqrt(s2 / k) * 100).toFixed(1), deg: +(Math.sqrt(y2 / k) * 180 / Math.PI).toFixed(2) };
      },
      prey() {
        const S = D.me(); if (!S) return null;
        let best = null, bd = 1e9;
        const sx = S.pos.x, sz = S.pos.z;
        const consider = function (o, p) {
          if (!o || o === S || o.dead || !p) return;
          const d = Math.hypot(p.x - sx, p.z - sz);
          if (d > 4 && d < bd) { bd = d; best = o; }
        };
        for (const a of CBZ.cityWildlife || []) {
          if (!a || !a.species || a.species.id === "orca" || a.species.id === "megalodon") continue;
          if (!(a.species.aquatic || a.swim)) continue;
          if (a.species.id === S.species.id) continue;
          consider(a, a.pos || (a.group && a.group.position));
        }
        for (const b of CBZ.bots || []) if (b && b.swim) consider(b, b.pos);
        return best ? { o: best, d: bd } : null;
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        const canvas = CBZ.renderer && CBZ.renderer.domElement;
        for (const child of Array.from(document.body.children)) {
          if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
          child.style.visibility = "hidden";
        }
        if (CBZ.skySync) CBZ.skySync();
        await new Promise((res) => D._raf.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
        await new Promise((r) => setTimeout(r, 300));
      },
      advance(sec) { D.sec(sec); },
    };
  }

  const CH = [
    async function spawn() {
      if (!await D.boot()) throw new Error("shark sim never started");
      D.sec(1.0);
      const S = D.me();
      if (!S) throw new Error("no shark to ride");
      D.x0 = S.pos.x; D.z0 = S.pos.z;
      D.m = { depth: +((CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : 0) - S.pos.y).toFixed(2) };
    },
    async function swim() {
      const S = D.me();
      D.path.length = 0; D.rec = true;
      // W held straight for 3 s from the spawn: a shark on a rock gets nowhere
      D.keyW = true; D.sec(3.0);
      const moved = Math.hypot(S.pos.x - D.x0, S.pos.z - D.z0);
      // then a mouse sweep under the strip: 1.2 s left at 50 deg/s, 1.2 s right, straight
      let t = 0;
      D.steer = function (dt) {
        t += dt;
        if (!CBZ.cam) return;
        const r = 50 * Math.PI / 180;
        if (t < 1.2) CBZ.cam.yaw += r * dt;
        else if (t < 2.4) CBZ.cam.yaw -= r * dt;
      };
      D.sec(0.2);
      D.m = { moved3s: +moved.toFixed(1) };
      D.moved = moved;
      D.swimFrom = 0;
    },
    async function attack() {
      const sw = D.shake(D.swimFrom || 0);
      D.path.length = 0;
      const S = D.me();
      // A SHARK STILL WEDGED WHERE IT SPAWNED cannot show the attack camera at
      // all; it is carried 50 m straight out to open water first (on either
      // build) and the report says so (relocated: 1)
      let relocated = 0;
      if (!(D.moved > 2)) {
        const A = (CBZ.surv && CBZ.surv.arena) || null, c = A && A.center ? A.center : { x: 0, z: 0 };
        let dx = S.pos.x - c.x, dz = S.pos.z - c.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        // riding, the player's body is the authority the mount follows: move both
        const P = CBZ.player, x1 = S.pos.x + dx * 50, z1 = S.pos.z + dz * 50;
        S.pos.x = x1; S.pos.z = z1;
        if (P) { P.pos.x = x1; P.pos.z = z1; if (P.vel) { P.vel.x = 0; P.vel.z = 0; } }
        if (S.group) { S.group.position.x = x1; S.group.position.z = z1; }
        if (S._waterMove) { S._waterMove.x = x1; S._waterMove.z = z1; S._waterMove.blocked = false; }
        D.sec(1.0);
        relocated = Math.hypot(S.pos.x - x1, S.pos.z - z1) < 10 ? 1 : -1;     // -1: the game put it back
      }
      // steer onto the nearest prey and bite when it is in reach
      let bites = 0, best = 1e9, target = null;
      // a hand on a mouse: the lens turns toward the prey at no more than
      // 90 deg/s, and the button is clicked at most twice a second
      let clickT = 0;
      D.steer = function (dt) {
        clickT -= dt;
        const p = D.prey(); if (!p) return;
        target = p.o;
        const tp = p.o.pos || p.o.group.position;
        if (CBZ.cam) {
          const want = Math.atan2(-(tp.x - S.pos.x), -(tp.z - S.pos.z));
          let d = want - CBZ.cam.yaw;
          while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          const lim = (90 * Math.PI / 180) * dt;
          CBZ.cam.yaw += Math.max(-lim, Math.min(lim, d));
        }
        if (p.d < best) best = p.d;
        // click whenever it is close; the game decides whether a bite can start
        if (p.d < 12 && clickT <= 0 && CBZ.cityMountedAnimalAttack) { clickT = 0.5; if (CBZ.cityMountedAnimalAttack(true)) bites++; }
      };
      D.keyW = true;
      // close in: up to 30 s, until a bite has started
      for (let k = 0; k < 30 * 4; k++) { D.sec(0.25); if (bites > 0) break; }
      D.m = { swimShakeCm: sw.cm, swimYawJitterDeg: sw.deg, relocated, preyFound: target ? 1 : 0, closest: +best.toFixed(1), bitesStarted: bites };
      D.attackFrom = D.path.length;
    },
    async function after() {
      const at = D.shake(D.attackFrom || 0);
      D.steer = null; D.keyW = false;
      D.sec(1.5);
      D.m = { attackShakeCm: at.cm, attackYawJitterDeg: at.deg };
    },
  ];
  const want = sub.ch | 0;
  while (D.chapter < want) { D.chapter++; await CH[D.chapter](); }
  return { ok: true, state: JSON.stringify(D.m), metrics: D.m };
}

export default {
  id: "shark-sim-ride",
  title: "Shark Sim as the player sees it",
  description: "The game's own camera through the spawn, swimming and turning, and an attack; W held, the lens swept like a mouse, the bite fired through the mouse button's own call.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  pairNote: "Same seed, same input on both sides; the camera is the game's",
  method: "Boots ?mode=sharksim, freezes the frame loop and steps it at 1/60 s with W held (CBZ.keys.w), the lens yaw swept at 50 deg/s left then right, then turned onto the nearest prey at up to 90 deg/s like a mouse and CBZ.cityMountedAnimalAttack(true) clicked at most twice a second inside 12 m (the game decides whether a bite starts). Camera shake = RMS of the lens from its own 0.3 s moving average.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  metrics: {
    moved3s: { label: "Metres swum in 3 s from the spawn", better: "higher" },
    swimShakeCm: { label: "Camera shake while swimming, cm", better: "lower" },
    swimYawJitterDeg: { label: "Camera yaw jitter while swimming, deg", better: "lower" },
    attackShakeCm: { label: "Camera shake while attacking, cm", better: "lower" },
    attackYawJitterDeg: { label: "Camera yaw jitter while attacking, deg", better: "lower" },
  },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage,
};
