/* A SHARK ATTACKS YOU WHILE YOU SWIM — tools/visual-compare preset.

   OWNER (2026-11-22): "better animation for example of shark attacks so you
   can be swimming and show that as well".

   Boots ?mode=survival (the island; the player is a person), drops the
   player into open water 10-30 m deep off the beach, treading water (holding
   Space, as a player does: a still body sinks here), and lets a hungry great
   white find them:
   CBZ.cityWildlifeSpawnAt drops the shark 18 m away and the game's own hunt
   (CBZ.sharkBrain on the shared predator driver) does the rest. Nothing about
   the attack is staged: the sim is stepped until the shark commits (its own
   rush, inside 14 m), and the strip runs from there.

   Every frame is two views of the same instant: on the left a lens at the
   surface 8 m off the line of attack, on the right a lens 10 m up looking
   down into the water. The player is healed every tick so a death screen
   never ends the run; nothing else is touched. */

const subjects = [
  { id: "attack", ch: 0, strip: { frames: 10, stepSec: 0.35 },
    label: "A great white takes a swimming player",
    focus: "Frames 0.35 s apart from the moment the shark commits (its rush, inside 14 m). Left: from the surface. Right: from 10 m up, looking into the water." },
  { id: "after-attack", ch: 1, strip: { frames: 3, stepSec: 1.2 },
    label: "Seconds later",
    focus: "The hold and the drag, 0.6 to 3 s after the strip." },
];

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__sharkAtk;
  if (!D) {
    D = window.__sharkAtk = {
      chapter: -1, m: {}, follow: null,
      step(n) {
        for (let i = 0; i < n; i++) {
          if (CBZ.game.state !== "playing") CBZ.game.state = "playing";
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          const P = CBZ.player;
          if (P) { P.hp = 100; P.dead = false; }
          // TREADING WATER IS AN INPUT. city/swim.js sinks a still body (the
          // owner's rule: you sink unless you hold Space, like GTA), so the
          // swimmer holds Space the way a player at the surface does, and lets
          // go once the jaws have them (break-free is one timed press, and
          // pressing outside its window feeds the attack).
          if (CBZ.keys) CBZ.keys[" "] = !!(D.tread && P && !(CBZ.predatorSeized && CBZ.predatorSeized(P)));
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
        // No disaster during the shot: the island's director brings its first
        // card 10 s into a match. Its updater (order 28, the one that steps
        // tsuSeaCalmStep) is held for this capture only.
        D.sec(0.2);
        D.held = 0;
        for (const u of CBZ.updaters || []) {
          if (u && u.order === 28 && /tsuSeaCalmStep/.test(String(u.fn))) { u.fn = function () {}; D.held++; }
        }
        D.sec(1);
        return true;
      },
      A() { return CBZ.surv.arena; },
      seaY(x, z) { return CBZ.survSeaHeightAt ? CBZ.survSeaHeightAt(x, z) : (CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.48); },
      // where the swimmer is, every few seconds: depth under the surface, the swim flag, vertical speed
      trace: [],
      mark(t) {
        const P = CBZ.player, S = D.shark;
        let w = Math.round(t) + "s:" + (D.seaY(P.pos.x, P.pos.z) - P.pos.y).toFixed(1) + (P._swim ? "S" : "-") + (P.grounded ? "G" : "") + ((CBZ.predatorSeized && CBZ.predatorSeized(P)) ? "X" : "");
        // the shark's side of it: its hunt state, menace gauge, cooldown, encounter clock, gap
        if (S) {
          const h = S._hunt;
          w += "|" + (h ? h.st + ",m" + (h.menace || 0).toFixed(2) + ",c" + (h.cool || 0).toFixed(1) + ",e" + (h.encT || 0).toFixed(0) + ",p" + (h.passes | 0) : "nohunt")
            + ",d" + Math.hypot(S.pos.x - P.pos.x, S.pos.z - P.pos.z).toFixed(0) + (S._shark ? "," + S._shark.state : "") + (S.dead ? ",DEAD" : "") + (S.tamed ? ",TAME" : "");
        }
        D.trace.push(w);
      },
      // the island's own water column (disaster_arena.js), mean sea over its seabed
      depth(x, z) {
        if (CBZ.survFloodDepthMeanAt) return CBZ.survFloodDepthMeanAt(x, z);
        if (CBZ.waterSurfaceAt) { const o = CBZ.waterSurfaceAt(x, z, {}); if (o && Number.isFinite(o.depth)) return o.depth; }
        return CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(x, z) : 10;
      },
      ring(a, r) { const A = D.A(); return { x: A.center.x + Math.cos(a) * r, z: A.center.z + Math.sin(a) * r }; },
      // two lenses on one canvas: the surface (left) and from above (right)
      lenses() {
        const P = CBZ.player, S = D.shark;
        if (!P || !S) return;
        const px = P.pos.x, pz = P.pos.z;
        // the line of attack, fixed at the moment the strip starts
        const ax = D.ax, az = D.az;
        const nx = -az, nz = ax;                               // perpendicular to it
        const sy = D.seaY(px, pz);
        // the surface lens rides the water UNDER THE LENS: a swell crest under a
        // lens set off the swimmer's water level puts it under the surface and
        // the game's underwater grade comes on for both views
        const cax = px + nx * 8 - ax * 1.5, caz = pz + nz * 8 - az * 1.5;
        D.camA = { p: new T.Vector3(cax, D.seaY(cax, caz) + 1.3, caz), t: new T.Vector3(px - ax * 1.5, sy - 0.2, pz - az * 1.5) };
        D.camB = { p: new T.Vector3(px + nx * 4 - ax * 3, sy + 10, pz + nz * 4 - az * 3), t: new T.Vector3(px - ax * 1.0, sy - 1.0, pz - az * 1.0) };
        const cam = CBZ.camera;
        cam.position.copy(D.camA.p); cam.lookAt(D.camA.t); cam.updateMatrixWorld(true);
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
        // the outside lenses see the swimmer's whole body, as a third-person camera would
        const pg = CBZ.playerChar && CBZ.playerChar.group, pgVis = pg ? pg.visible : true;
        if (pg) pg.visible = true;
        await new Promise((res) => D._raf.call(window, () => {
          const R = CBZ.renderer, cam = CBZ.camera;
          const W = R.domElement.width, H = R.domElement.height, w = Math.floor((W - 2) / 2);
          const ac = R.autoClear;
          try {
            R.autoClear = false;
            R.setScissorTest(true);
            R.setViewport(0, 0, W, H); R.setScissor(0, 0, W, H); R.setClearColor(0x101418, 1); R.clear();
            const lens = function (L, x) {
              cam.position.copy(L.p); cam.lookAt(L.t);
              cam.fov = 52; cam.aspect = w / H; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
              R.setViewport(x, 0, w, H); R.setScissor(x, 0, w, H); R.clear();
              R.render(CBZ.scene, cam);
            };
            if (D.camA && D.camB) { lens(D.camA, 0); lens(D.camB, w + 2); }
            else R.render(CBZ.scene, cam);
          } finally {
            R.autoClear = ac; R.setScissorTest(false);
            R.setViewport(0, 0, W, H); R.setScissor(0, 0, W, H);
            if (D.camA) { cam.position.copy(D.camA.p); cam.lookAt(D.camA.t); cam.aspect = W / H; cam.updateProjectionMatrix(); }
          }
          res();
        }));
        if (pg) pg.visible = pgVis;
        await new Promise((r) => setTimeout(r, 500));
      },
      advance(sec) { D.sec(sec); },
    };
  }

  const CH = [
    async function attack() {
      if (!await D.boot()) throw new Error("survival never started");
      const A = D.A(), P = CBZ.player;
      // open water off the beach, 10-30 m deep: where a great white hunts a swimmer
      let spot = null;
      for (let k = 0; k < 24 && !spot; k++) {
        const a = 0.6 + k * 0.27;
        for (let off = 20; off <= 160 && !spot; off += 10) {
          const p = D.ring(a, A.radius + off), d = D.depth(p.x, p.z);
          if (d > 10 && d < 30) spot = { a, x: p.x, z: p.z, d };
        }
      }
      if (!spot) throw new Error("no deep water");
      D.follow = function () {
        const cam = CBZ.camera;
        cam.position.set(P.pos.x + 6, D.seaY(P.pos.x, P.pos.z) + 3, P.pos.z + 6);
        cam.lookAt(P.pos.x, P.pos.y, P.pos.z); cam.updateMatrixWorld(true);
      };
      // INTO THE WATER THE WAY A BODY GETS THERE: dropped from just above the
      // surface, falling. city/swim.js takes a swimmer on only on the way down
      // (not grounded, vy < 0, at the surface over deep enough water); a body
      // set down standing still under the surface is never taken on and sinks.
      D.tread = true;
      for (let k = 0; k < 3 && !P._swim; k++) {
        P.pos.x = spot.x; P.pos.z = spot.z; P.pos.y = D.seaY(spot.x, spot.z) + 0.4; P.vy = -3; P.grounded = false;
        if (P.vel) { P.vel.x = 0; P.vel.y = 0; P.vel.z = 0; }
        D.sec(2);
      }
      D.mark(0);
      // the shark: seaward of the player, 18 m out, hungry
      const sx = P.pos.x + Math.cos(spot.a) * 18, sz = P.pos.z + Math.sin(spot.a) * 18;
      const S = CBZ.cityWildlifeSpawnAt ? CBZ.cityWildlifeSpawnAt("great_white_shark", sx, sz) : null;
      if (!S) throw new Error("no shark spawn");
      D.shark = S;
      S.hunger = 1;
      S.pos.y = D.seaY(sx, sz) - 2.5;
      if (S._waterMove) { S._waterMove.x = sx; S._waterMove.z = sz; }
      // the game's own hunt, until the shark commits
      let prev = 1e9, t = 0, best = 1e9;
      const T_MAX = 150;
      for (; t < T_MAX * 60; t++) {
        D.step(1);
        const d = Math.hypot(S.pos.x - P.pos.x, S.pos.z - P.pos.z, (S.pos.y - P.pos.y) * 0.5);
        if (d < best) best = d;
        // THE STRIKE, not the first close pass: the hunt's own commit (rush or
        // seize) inside 14 m once the swimmer has settled, or anything that
        // closes inside 5 m
        const h = S._hunt, committed = !!(h && (h.st === "rush" || h.st === "seize"));
        if (t > 240 && ((committed && d < 14) || (d < 5 && d < prev - 0.04))) break;
        prev = d;
        if (t % 300 === 0) D.mark(t / 60);
      }
      const dx = P.pos.x - S.pos.x, dz = P.pos.z - S.pos.z, l = Math.hypot(dx, dz) || 1;
      D.ax = dx / l; D.az = dz / l;
      D.follow = function () { D.lenses(); };
      D.lenses();
      const pg = CBZ.playerChar && CBZ.playerChar.group;
      D.m = { found: t < T_MAX * 60 ? 1 : 0, secs: +(t / 60).toFixed(1), closest: +best.toFixed(1), held: D.held,
              playerDepth: +(D.seaY(P.pos.x, P.pos.z) - P.pos.y).toFixed(2), swimming: P._swim ? 1 : 0, bodyShown: pg ? (pg.visible ? 1 : 0) : -1,
              bed: +spot.d.toFixed(1), trace: D.trace.join(" "),
              disaster: CBZ.disasters && CBZ.disasters.state ? CBZ.disasters.state() : "?" };
    },
    async function after() {
      D.sec(0.6);
      D.lenses();
      const P = CBZ.player, S = D.shark;
      D.m = { gap: S ? +Math.hypot(S.pos.x - P.pos.x, S.pos.z - P.pos.z).toFixed(1) : -1 };
    },
  ];
  const want = sub.ch | 0;
  while (D.chapter < want) { D.chapter++; await CH[D.chapter](); }
  return { ok: true, state: JSON.stringify(D.m), metrics: D.m };
}

export default {
  id: "shark-attack-swimmer",
  title: "A shark attacks a swimming player",
  description: "Survival island, the player treading water over 10-30 m of sea, a hungry great white 18 m away, the game's own hunt run until it strikes; two views per frame.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  pairNote: "Same island, same spot, same shark, the game's own hunt",
  method: "Boots ?mode=survival, freezes the frame loop, drops the player into 10-30 m of water treading (Space held until the jaws close) and spawns a great white 18 m seaward with CBZ.cityWildlifeSpawnAt; steps the sim until the shark commits (its rush inside 14 m), then shoots 10 frames 0.35 s apart (left: surface lens 8 m off the line of attack; right: 10 m up).",
  beforeParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 600000,
  metrics: {
    found: { label: "The shark committed to an attack", better: "higher" },
    secs: { label: "Seconds until it struck" },
    closest: { label: "Closest approach, m" },
  },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage,
};
