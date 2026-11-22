/* AN ANIMAL ATTACK ON LAND, AND THE BLOOD — tools/visual-compare preset.

   OWNER (2026-11-22): "improve the blood too ... jail game blood is great I
   mean attack in water and on land blood". This is the land half (the water
   half is shark-attack-swimmer). Boots ?mode=survival, stands the player on
   dry grass inland, and lets a hungry gray wolf (a brown bear when the wolf
   does not exist), spawned 6 m off, find them through the game's own hunt; nothing about the
   attack is staged. The player is healed every tick so no death screen ends
   the run; the wounds and the bleeding are the game's own.

   Every frame is two views of one instant: left, a lens 4.5 m off the line of
   attack at standing eye height; right, 3.5 m straight above, looking down at
   the ground the blood lands on. */

const subjects = [
  { id: "maul", ch: 0, strip: { frames: 6, stepSec: 0.4 }, label: "The attack",
    focus: "From the moment the animal commits; frames 0.4 s apart. Left: from the side. Right: from above." },
  { id: "after", ch: 1, strip: { frames: 3, stepSec: 2.0 }, label: "The ground afterwards",
    focus: "2, 4 and 6 s later: the pool, the spray, the trail." },
];

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__landAtk;
  if (!D) {
    D = window.__landAtk = {
      chapter: -1, m: {},
      step(n) {
        for (let i = 0; i < n; i++) {
          if (CBZ.game.state !== "playing") CBZ.game.state = "playing";
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          const P = CBZ.player; if (P) { P.hp = 100; P.dead = false; }
          if (D.follow) D.follow();
          CBZ.stepSim(1 / 60);
        }
      },
      sec(s) { D.step(Math.max(1, Math.round(s * 60))); },
      async boot() {
        for (let t = 0; t < 2000 && !(CBZ.game && document.getElementById("playBtn") && document.querySelector('[data-mode="survival"]')); t++) await sleep(150);
        const mb = document.querySelector('[data-mode="survival"]');
        if (!mb) return false;
        mb.click();
        let started = false;
        for (let t = 0; t < 600 && !started; t++) {
          const pb = document.getElementById("playBtn");
          if (CBZ.game.state !== "playing" && pb) pb.click();
          if (CBZ.game.state === "playing") { started = true; break; }
          await sleep(300);
        }
        if (!started) return false;
        D._raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        for (let t = 0; t < 400 && !(CBZ.surv && CBZ.surv.arena); t++) { try { CBZ.stepSim(1 / 60); } catch (e) {} await sleep(50); }
        if (!CBZ.surv || !CBZ.surv.arena) return false;
        try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
        D.sec(0.2);
        for (const u of CBZ.updaters || []) if (u && u.order === 28 && /tsuSeaCalmStep/.test(String(u.fn))) u.fn = function () {};
        D.sec(1);
        return true;
      },
      seaY(x, z) { return CBZ.survSeaHeightAt ? CBZ.survSeaHeightAt(x, z) : -0.5; },
      ground(x, z) { const A = CBZ.surv.arena; return A.groundHeightAt ? A.groundHeightAt(x, z) : 0; },
      lenses() {
        const P = CBZ.player; if (!P) return;
        const ax = D.ax || 1, az = D.az || 0;
        const nx = -az * (D.side || 1), nz = ax * (D.side || 1);
        const gy = D.ground(P.pos.x, P.pos.z);
        // high and oblique (3 m up, 3.5 m off): over hedges, walls and cars
        D.camA = { p: new T.Vector3(P.pos.x + nx * 3.5, gy + 3.0, P.pos.z + nz * 3.5), t: new T.Vector3(P.pos.x, gy + 0.4, P.pos.z) };
        D.camB = { p: new T.Vector3(P.pos.x + 0.01, gy + 3.5, P.pos.z), t: new T.Vector3(P.pos.x, gy, P.pos.z) };
        const cam = CBZ.camera; cam.position.copy(D.camA.p); cam.lookAt(D.camA.t); cam.updateMatrixWorld(true);
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        const canvas = CBZ.renderer && CBZ.renderer.domElement;
        for (const child of Array.from(document.body.children)) {
          if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
          child.style.visibility = "hidden";
        }
        if (D.follow) D.follow();
        if (CBZ.skySync) CBZ.skySync();
        const pg = CBZ.playerChar && CBZ.playerChar.group, vis = pg ? pg.visible : true;
        if (pg) pg.visible = true;
        await new Promise((res) => D._raf.call(window, () => {
          const R = CBZ.renderer, cam = CBZ.camera;
          const W = R.domElement.width, H = R.domElement.height, w = Math.floor((W - 2) / 2), ac = R.autoClear;
          try {
            R.autoClear = false; R.setScissorTest(true);
            R.setViewport(0, 0, W, H); R.setScissor(0, 0, W, H); R.setClearColor(0x101418, 1); R.clear();
            const lens = function (L, x) {
              cam.position.copy(L.p); cam.lookAt(L.t); cam.fov = 50; cam.aspect = w / H; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
              R.setViewport(x, 0, w, H); R.setScissor(x, 0, w, H); R.clear(); R.render(CBZ.scene, cam);
            };
            if (D.camA && D.camB) { lens(D.camA, 0); lens(D.camB, w + 2); } else R.render(CBZ.scene, cam);
          } finally {
            R.autoClear = ac; R.setScissorTest(false); R.setViewport(0, 0, W, H); R.setScissor(0, 0, W, H);
          }
          res();
        }));
        if (pg) pg.visible = vis;
        await new Promise((r) => setTimeout(r, 400));
      },
      advance(sec) { D.sec(sec); },
    };
  }
  const CH = [
    async function maul() {
      if (!await D.boot()) throw new Error("survival never started");
      const A = CBZ.surv.arena, P = CBZ.player;
      // dry, flat, OPEN ground: the upper beach (no building or tree within a
      // lens's reach), falling back to the island's interior
      let spot = null;
      for (let k = 0; k < 24 && !spot; k++) {
        const a = 0.5 + k * 0.26;
        for (let r = A.radius - 8; r > A.radius * 0.35 && !spot; r -= 4) {
          const x = A.center.x + Math.cos(a) * r, z = A.center.z + Math.sin(a) * r;
          const g = D.ground(x, z);
          if (g > D.seaY(x, z) + 1.5 && Math.abs(D.ground(x + 3, z) - g) < 0.3 && Math.abs(D.ground(x, z + 3) - g) < 0.3) spot = { a, x, z, g };
        }
      }
      if (!spot) throw new Error("no dry flat ground");
      P.pos.x = spot.x; P.pos.z = spot.z; P.pos.y = spot.g; if (P.vel) { P.vel.x = 0; P.vel.y = 0; P.vel.z = 0; }
      D.follow = function () { D.lenses(); };
      D.sec(1.0);
      // 6 m off, on the open side (the hunt still decides when it commits)
      let id = "gray_wolf", W = CBZ.cityWildlifeSpawnAt ? CBZ.cityWildlifeSpawnAt(id, spot.x + Math.cos(spot.a) * 6, spot.z + Math.sin(spot.a) * 6) : null;
      if (!W) { id = "brown_bear"; W = CBZ.cityWildlifeSpawnAt ? CBZ.cityWildlifeSpawnAt(id, spot.x + Math.cos(spot.a) * 6, spot.z + Math.sin(spot.a) * 6) : null; }
      if (!W) throw new Error("no predator spawned");
      W.hunger = 1;
      D.W = W;
      // the game's own hunt until it commits (its rush or seize) inside 6 m, or anything closing inside 2 m
      let t = 0, best = 1e9, prev = 1e9;
      const T_MAX = 150;
      // THE GAME DECIDES THE HOLD BY A ROLL (creature_combat.js trySeize: a maul on
      // the player seizes only on a random draw). Inside 4 m the roll is made to
      // come up "seize", so the strip shows the hold the game itself plays some
      // of the time; every other random draw is the real one.
      const rnd0 = Math.random;
      const rollSeize = function () { const st = (new Error()).stack || ""; return st.indexOf("trySeize") >= 0 ? 0.0001 : rnd0(); };
      for (; t < T_MAX * 60; t++) {
        const dd = Math.hypot(W.pos.x - P.pos.x, W.pos.z - P.pos.z);
        Math.random = dd < 4 ? rollSeize : rnd0;
        D.step(1);
        const d = Math.hypot(W.pos.x - P.pos.x, W.pos.z - P.pos.z);
        if (d < best) best = d;
        const h = W._hunt, committed = !!(h && (h.st === "rush" || h.st === "seize"));
        const held = !!(CBZ.predatorSeized && CBZ.predatorSeized(P));
        if (held || (d < 2 && d < prev - 0.02)) break;
        prev = d;
      }
      Math.random = rnd0;
      D.held = !!(CBZ.predatorSeized && CBZ.predatorSeized(P));
      const dx = P.pos.x - W.pos.x, dz = P.pos.z - W.pos.z, l = Math.hypot(dx, dz) || 1;
      D.ax = dx / l; D.az = dz / l;
      // the side lens on whichever side has a clear line to the player (a tree
      // or a wall between them is not a picture of the attack)
      const gy = D.ground(P.pos.x, P.pos.z);
      const clear = function (sd) {
        const o = new T.Vector3(P.pos.x, gy + 1.0, P.pos.z), d = new T.Vector3(-D.az * sd, 0.1, D.ax * sd).normalize();
        const rc = new T.Raycaster(o, d, 0.6, 4.6), bx = new T.Box3(), out = [];
        let blocked = false;
        CBZ.scene.traverseVisible(function (m) {
          if (blocked || !m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || !m.geometry || !m.matrixWorld) return;
          if (CBZ.playerChar && CBZ.playerChar.group && CBZ.playerChar.group.getObjectById(m.id)) return;
          if (W.group && W.group.getObjectById(m.id)) return;
          try {
            if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
            bx.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
            if (bx.distanceToPoint(o) > 5) return;
            out.length = 0; m.raycast(rc, out);
            if (out.length) blocked = true;
          } catch (e) {}
        });
        return !blocked;
      };
      D.side = clear(1) ? 1 : (clear(-1) ? -1 : 1);
      D.lenses();
      D.m = { predator: id, found: t < T_MAX * 60 ? 1 : 0, held: D.held ? 1 : 0, secs: +(t / 60).toFixed(1), closest: +best.toFixed(1) };
    },
    async function after() {
      D.sec(1.0);
      const audit = CBZ.woundDecalAudit ? CBZ.woundDecalAudit() : null;
      D.m = { biteMarks: audit ? audit.biteMarks : -1 };
    },
  ];
  const want = sub.ch | 0;
  while (D.chapter < want) { D.chapter++; await CH[D.chapter](); }
  return { ok: true, state: JSON.stringify(D.m), metrics: D.m };
}

export default {
  id: "land-attack-blood",
  title: "An animal attack on land, and the blood",
  description: "Survival island: the player on dry grass, a hungry gray wolf (or a brown bear) finds them through the game's own hunt; side view and top-down view per frame.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  pairNote: "Same island, same spot, same animal, the game's own hunt",
  method: "Boots ?mode=survival, freezes the frame loop, stands the player on dry flat grass inland and spawns a hungry gray wolf 6 m away with CBZ.cityWildlifeSpawnAt; steps the sim until it commits (its rush or seize inside 6 m, or the player seized), then shoots 6 frames 0.4 s apart and 3 more 2 s apart; the player is healed each tick.",
  beforeParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 600000,
  metrics: { found: { label: "The animal attacked", better: "higher" }, secs: { label: "Seconds until it committed" } },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage,
};
