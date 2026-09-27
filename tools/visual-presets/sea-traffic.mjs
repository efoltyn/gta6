/* Shark Sim — THE SEA TRAFFIC, before/after (tools/visual-compare preset).

   OWNER: "massively improve the shark game, especially the scene and like the
   number of boats, the size of boats, the animation".

   What this preset asks is not "is a hull pretty" (boat-fleet does that) nor
   "what does a shark do to one" (shark-boats does that). It asks: does the sea
   look like people are out on it? So nothing is fanned, moved or spawned for
   the photograph — every shot is the match's own fleet where the match put it,
   after the sim has run long enough for everyone to be doing their job.

   Beats
     0  from the sand, looking out along the player's own bearing (fixed shot,
        identical on both sides)
     1  shark's eye: 1 m over the swell, looking out along the BUSIEST bearing
        of this side's own fleet (each side at its best)
     2  the same bearing, higher and wider: the bands (paddlers in, fishers
        mid, big hulls out) and the far craft
     3  a strip: the shark surfaces beside the nearest crewed boat. Does
        anybody react?
   Metrics come from CBZ.seaCraft.audit() plus a scan of the live list, and
   the draw-call count is the renderer's own for the beat-1 frame. */

const subjects = [
  { id: "from-the-sand", ch: 0, label: "From The Sand",
    focus: "The same camera on both sides: the beach the player dropped on, looking out to sea. Count the boats and look at what they are doing." },
  { id: "shark-eye", ch: 1, label: "Shark's Eye, The Busiest Bearing",
    focus: "One metre over the swell, looking out along whichever bearing this side's own fleet is thickest on. Nothing was moved for the photograph." },
  { id: "the-bands", ch: 2, label: "The Bands, From Higher Up",
    focus: "Paddlers and jetskis in the swimming band, anchored fishermen and dive boats mid-water, trolling sportfishers and a sailboat under way further out, a yacht at anchor and traffic on the horizon." },
  { id: "fin-alongside", ch: 3, strip: { frames: 3, stepSec: 1.2 }, label: "A Fin Alongside",
    focus: "The shark surfaces beside the nearest crewed boat. BEFORE: nobody notices. AFTER: the helm throttles up and runs, anchored boats cut and go, the crew turn, point and throw their arms up." },
];

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__seaTraffic;
  if (!D) {
    D = window.__seaTraffic = {
      chapter: -1, m: {},
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 60 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        D._raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => D._raf.call(window, () => res()));
        return true;
      },
      A() { return CBZ.surv.arena; },
      wl() { return CBZ.sharkSim.waterline; },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.48; },
      ring(a, r) { const A = D.A(); return { x: A.center.x + Math.cos(a) * r, z: A.center.z + Math.sin(a) * r }; },
      playerAngle() { const A = D.A(), P = CBZ.player; return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0; },
      tripod(px, py, pz, tx, ty, tz, fov) {
        const cam = CBZ.camera; if (!cam) return;
        if (fov && cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
        cam.position.set(px, py, pz); cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      live() { return CBZ.seaCraft ? CBZ.seaCraft.list().filter((c) => c && !c.dead && !c._sinking) : []; },
      // the bearing (from the island centre) the fleet is thickest on, near craft weighted up
      busiest() {
        const A = D.A(), L = D.live();
        let best = D.playerAngle(), bs = -1;
        for (let k = 0; k < 72; k++) {
          const a0 = k / 72 * Math.PI * 2;
          let s = 0;
          for (const c of L) {
            const a = Math.atan2(c.pos.z - A.center.z, c.pos.x - A.center.x);
            let d = a - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
            if (Math.abs(d) < 0.42) s += 1;
          }
          if (s > bs) { bs = s; best = a0; }
        }
        return best;
      },
      calls() {
        const R = CBZ.renderer; if (!R) return 0;
        const ar = R.info.autoReset; R.info.autoReset = true;
        R.render(CBZ.scene, CBZ.camera);
        const n = R.info.render.calls; R.info.autoReset = ar;
        return n;
      },
      // a quiet sea for the establishing shots: wild biters parked far away
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species || (CBZ.sharkSim && a === CBZ.sharkSim.shark)) continue;
          if (a.species.aquatic && (+a.species.danger >= 0.5)) {
            a.pos.x += 1500; a.hunger = 0;
            if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          }
        }
        if (CBZ.sharkSim) CBZ.sharkSim.podT = 600;
      },
      // the player's shark, parked deep and far from every boat so the calm
      // shots are calm on both sides
      parkShark(x, z, depth) {
        const a = CBZ.sharkSim.shark; if (!a) return;
        a.pos.x = x; a.pos.z = z; a.pos.y = D.seaY(x, z) - depth;
        if (a._waterMove) { a._waterMove.x = x; a._waterMove.z = z; a._waterMove.v = 0; }
        if (a.group) { a.group.position.set(a.pos.x, a.pos.y, a.pos.z); a.group.updateMatrixWorld(true); }
      },
      census() {
        const L = D.live(), P = CBZ.camera.position;
        let moving = 0, anchored = 0, crew = 0, near = 0, alarmed = 0;
        for (const c of L) {
          if (Math.abs(c.v || 0) > 0.6) moving++;
          if (c.anchored) anchored++;
          crew += c.crew.length;
          if (Math.hypot(c.pos.x - P.x, c.pos.z - P.z) < 400) near++;
          if (c.mood === "flee") alarmed++;
        }
        return { craft: L.length, moving, anchored, crew, near, alarmed };
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        await new Promise((res) => D._raf.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
        await new Promise((r) => setTimeout(r, 900));
      },
      advance(sec) {
        D.sec(sec);
        if (D.follow) D.follow();
      },
    };
  }

  const CH = [
    async function sand() {
      if (!await D.boot()) throw new Error("shark sim never armed");
      D.peace();
      const pa = D.playerAngle();
      D.parkShark(D.ring(pa + Math.PI, D.wl() + 300).x, D.ring(pa + Math.PI, D.wl() + 300).z, 8);
      // let every boat get into its job: a minute of real sim
      D.sec(45);
      const from = D.ring(pa, D.wl() - 12), at = D.ring(pa, D.wl() + 160);
      D.tripod(from.x, D.seaY(from.x, from.z) + 5.5, from.z, at.x, D.seaY(at.x, at.z) + 1, at.z, 60);
      D.m = Object.assign(D.census(), { calls: D.calls() });
    },
    async function eye() {
      D.peace();
      const b = D.busiest(); D.bearing = b;
      D.parkShark(D.ring(b + Math.PI, D.wl() + 300).x, D.ring(b + Math.PI, D.wl() + 300).z, 8);
      D.sec(4);
      const from = D.ring(b, D.wl() + 6), at = D.ring(b, D.wl() + 200);
      D.tripod(from.x, D.seaY(from.x, from.z) + 1.0, from.z, at.x, D.seaY(at.x, at.z) + 1.5, at.z, 62);
      D.m = Object.assign(D.census(), { calls: D.calls() });
    },
    async function bands() {
      D.sec(3);
      const b = D.bearing;
      const from = D.ring(b, D.wl() - 25), at = D.ring(b, D.wl() + 170);
      D.tripod(from.x, D.seaY(from.x, from.z) + 22, from.z, at.x, D.seaY(at.x, at.z), at.z, 64);
      D.m = Object.assign(D.census(), { calls: D.calls() });
    },
    async function fin() {
      // the nearest crewed boat to the busiest-bearing camera, any kind
      const b = D.bearing, cam = D.ring(b, D.wl() + 6);
      let t = null, td = 1e9;
      for (const c of D.live()) {
        if (!c.crew.length || c._capsized) continue;
        const d = Math.hypot(c.pos.x - cam.x, c.pos.z - cam.z);
        if (d < td) { td = d; t = c; }
      }
      if (!t) throw new Error("no crewed boat");
      const h = t.heading, side = { x: Math.cos(h), z: -Math.sin(h) };   // beam
      D.parkShark(t.pos.x + side.x * 10, t.pos.z + side.z * 10, 0.5);
      const S = CBZ.sharkSim.shark; if (S && S.group) S.group.visible = true;
      D.sec(0.4);
      const fx = t.pos.x, fz = t.pos.z;
      D.follow = function () {
        const mx = (t.pos.x + fx) / 2, mz = (t.pos.z + fz) / 2;
        const ax = mx - side.x * 34, az = mz - side.z * 34;
        D.tripod(ax, D.seaY(ax, az) + 9, az, mx, D.seaY(mx, mz) + 0.5, mz, 60);
      };
      D.follow();
      D.m = Object.assign(D.census(), { target: t.key, calls: D.calls() });
    },
  ];
  const want = sub.ch | 0;
  while (D.chapter < want) { D.chapter++; await CH[D.chapter](); }
  return { ok: true, state: D.m.craft + " afloat", metrics: D.m };
}

export default {
  id: "sea-traffic",
  title: "Shark Sim — A Sea With People On It",
  description: "The shark sim's fleet as the player sees it: how many boats, where, doing what, and whether anyone on them notices a shark. Nothing is moved or spawned for the photograph.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · fleet wave",
  pairNote: "Same island · same seed · same sim time · the match's own boats where the match put them",
  method: "Both sides boot ?mode=sharksim at seed 90210 like a player, freeze the frame loop, park the player's shark far away and deep, run 45 s of real sim with CBZ.stepSim, then photograph. Beat 3 surfaces the player's shark 10 m off the beam of the nearest crewed boat and steps 1.2 s between frames.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 420000,
  metrics: {
    craft: { label: "Boats afloat", better: "higher" },
    moving: { label: "Under way (>0.6 m/s)", better: "higher" },
    anchored: { label: "At anchor", better: "higher" },
    crew: { label: "People aboard", better: "higher" },
    near: { label: "Within 400 m of the camera", better: "higher" },
    alarmed: { label: "Boats running from the shark", better: "higher" },
    calls: { label: "Draw calls, whole frame", better: "lower" },
  },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage,
};
