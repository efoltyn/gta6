/* A SWIMMER WHO LETS GO — tools/visual-compare preset.

   OWNER (2026-11-22): "sinking that's stupid". Boots ?mode=survival, drops
   the player into 10-30 m of open water off the beach (falling in, the way
   city/swim.js takes a swimmer on), then touches NO key for 12 s and watches
   where the body goes. Frames 3 s apart from a lens riding the water 6 m off
   the swimmer; the depth of the feet under the surface is logged every
   second. */

const subjects = [
  { id: "let-go-0s", ch: 0, label: "Just after letting go", focus: "Dropped into deep water, then no key held." },
  { id: "let-go-4s", ch: 1, label: "4 s with no key held", focus: "" },
  { id: "let-go-12s", ch: 2, label: "12 s with no key held", focus: "Where the body is after 12 s of not swimming." },
];

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__float;
  if (!D) {
    D = window.__float = {
      chapter: -1, m: {}, log: [], t: 0,
      seaY(x, z) { return CBZ.survSeaHeightAt ? CBZ.survSeaHeightAt(x, z) : (CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.48); },
      depth(x, z) { return CBZ.survFloodDepthMeanAt ? CBZ.survFloodDepthMeanAt(x, z) : 10; },
      step(n) {
        for (let i = 0; i < n; i++) {
          if (CBZ.game.state !== "playing") CBZ.game.state = "playing";
          const P = CBZ.player;
          if (P) { P.hp = 100; P.dead = false; }
          if (CBZ.keys) { CBZ.keys[" "] = false; CBZ.keys.control = false; CBZ.keys.c = false; }
          if (D.follow) D.follow();
          CBZ.stepSim(1 / 60);
          D.t += 1 / 60;
          if (P && D.logOn && Math.abs(D.t - Math.round(D.t)) < 1 / 120) D.log.push(+(D.seaY(P.pos.x, P.pos.z) - P.pos.y).toFixed(2));
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
        // no disaster during the shot (the island's director, order 28)
        for (const u of CBZ.updaters || []) if (u && u.order === 28 && /tsuSeaCalmStep/.test(String(u.fn))) u.fn = function () {};
        D.sec(1);
        return true;
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
        await new Promise((res) => D._raf.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
        if (pg) pg.visible = vis;
        await new Promise((r) => setTimeout(r, 300));
      },
      advance(sec) { D.sec(sec); },
    };
  }
  if (D.chapter < 0) {
    if (!await D.boot()) throw new Error("survival never started");
    D.chapter = 0;
    const A = CBZ.surv.arena, P = CBZ.player;
    let spot = null;
    for (let k = 0; k < 24 && !spot; k++) {
      const a = 0.6 + k * 0.27;
      for (let off = 20; off <= 160 && !spot; off += 10) {
        const x = A.center.x + Math.cos(a) * (A.radius + off), z = A.center.z + Math.sin(a) * (A.radius + off), d = D.depth(x, z);
        if (d > 10 && d < 30) spot = { a, x, z, d };
      }
    }
    if (!spot) throw new Error("no deep water");
    // the lens rides the water under itself, 6 m off the swimmer, looking at them
    D.follow = function () {
      const cam = CBZ.camera, px = P.pos.x, pz = P.pos.z;
      const cx = px + Math.cos(spot.a + 1.2) * 6, cz = pz + Math.sin(spot.a + 1.2) * 6;
      cam.position.set(cx, D.seaY(cx, cz) + 1.2, cz);
      cam.lookAt(px, D.seaY(px, pz) - 0.6, pz); cam.updateMatrixWorld(true);
    };
    for (let k = 0; k < 3 && !P._swim; k++) {
      P.pos.x = spot.x; P.pos.z = spot.z; P.pos.y = D.seaY(spot.x, spot.z) + 0.4; P.vy = -3; P.grounded = false;
      if (P.vel) { P.vel.x = 0; P.vel.y = 0; P.vel.z = 0; }
      D.sec(1.5);
    }
    D.t = 0; D.log.length = 0; D.logOn = true;
    D.m = { swimming: P._swim ? 1 : 0, bed: +spot.d.toFixed(1) };
  }
  const want = sub.ch | 0, P = CBZ.player;
  if (want === 1 && D.chapter < 1) { D.chapter = 1; D.sec(4); }
  if (want === 2 && D.chapter < 2) { D.chapter = 2; D.sec(D.t < 4 ? 12 - D.t : 8); }
  const feet = +(D.seaY(P.pos.x, P.pos.z) - P.pos.y).toFixed(2);
  D.m = Object.assign({}, D.m, { feetDepth: feet, swimming: P._swim ? 1 : 0, log: D.log.join(" ") });
  return { ok: true, state: JSON.stringify(D.m), metrics: D.m };
}

export default {
  id: "swim-float",
  title: "A swimmer who stops swimming",
  description: "Survival island: the player dropped into 10-30 m of water touches no key for 12 s; where does the body go?",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  pairNote: "Same spot, no key held on either side",
  method: "Boots ?mode=survival, freezes the frame loop, drops the player into 10-30 m of water falling (so city/swim.js takes them on), then steps 12 s with Space, Ctrl and C held up; frames at 0, 4 and 12 s from a lens 6 m off riding the water. The depth of the feet is logged each second (see the report's state).",
  beforeParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  metrics: { feetDepth: { label: "Feet under the surface, m" }, swimming: { label: "Swimming" } },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage,
};
