/* THINGS HITTING WATER — tools/visual-compare preset.

   OWNER (2026-11-21): "like if player falls into water or meteor, the ripples
   etc ... make water real af and the way shit interacts with it".

   Three impacts, each a short strip of frames so the EVENT is on the page and
   not one lucky instant of it:

     the player   dropped from 14 m into deep water: the entry, the crown, the
                  rings spreading, the water settling round a floating body
     a small rock a ground-reaching meteor (class `small`) into the sea 45 m
                  from the camera
     a big one    an `impact` class meteor into the sea 260 m out, watched from
                  the air: the column, the foam field, and the ring wave
                  travelling out

   Boots ?mode=survival (the island, the player is a person), freezes the frame
   loop and drives CBZ.stepSim. The impacts are the game's own: the player is
   only teleported and let fall; the meteors are CBZ.meteor.strike. */

const subjects = [
  { id: "player-falls-in", ch: 0, strip: { frames: 4, stepSec: 0.7 },
    label: "The player falls 14 m into the sea",
    focus: "Frames 0.1 s, 0.8 s, 1.5 s and 2.2 s after the feet touch. A cavity and a crown of water thrown up and out, then a rebound, rings spreading across the surface, foam left where the body went in, and the body bobbing back up." },
  { id: "small-meteor", ch: 1, strip: { frames: 4, stepSec: 0.8 },
    label: "A small meteor into the sea, 45 m away",
    focus: "A rock the size of a fist at 3 km/s. A tall narrow column, spray, steam, a foam patch, and rings running out past the camera." },
  { id: "big-meteor", ch: 2, strip: { frames: 4, stepSec: 3.0 },
    label: "A big meteor into the sea, 260 m out",
    focus: "Frames 0.4 s, 3.4 s, 6.4 s and 9.4 s after impact, from 40 m up. A crater in the sea, a column of water and steam, a wide field of foam and spray, and a ring wave that travels outward as a real wave." },
];

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__waterImpacts;
  if (!D) {
    D = window.__waterImpacts = {
      chapter: -1, m: {}, follow: null,
      step(n) {
        for (let i = 0; i < n; i++) {
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          // headless has no pointer lock, so the match keeps pausing itself; a
          // paused match runs none of its updaters (CBZ.stepSim gates on state)
          if (CBZ.game.state !== "playing") { CBZ.game.state = "playing"; D.unpaused = (D.unpaused || 0) + 1; }
          if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
          if (D.follow) D.follow();
          CBZ.stepSim(1 / 60);
        }
      },
      sec(s) { D.step(Math.max(1, Math.round(s * 60))); },
      async boot() {
        for (let t = 0; t < 2000 && !(CBZ.game && document.getElementById("playBtn") && document.querySelector('[data-mode="survival"]')); t++) await sleep(150);
        const mb = document.querySelector('[data-mode="survival"]');
        if (!mb) { D.why = "no survival tile"; return false; }
        mb.click();
        /* Headless has no pointer lock, so the match pauses itself a frame
           after it starts. Catch "playing" in the same tick as the click and
           stop the frame loop there; CBZ.stepSim is the only clock from then. */
        let started = false;
        for (let t = 0; t < 600 && !started; t++) {
          const pb = document.getElementById("playBtn");
          if (CBZ.game.state !== "playing" && pb) pb.click();
          if (CBZ.game.state === "playing") { started = true; break; }
          await sleep(300);
        }
        if (!started) { D.why = "state " + CBZ.game.state; return false; }
        D._raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        // the island is built during the first ticks of the match
        for (let t = 0; t < 400 && !(CBZ.surv && CBZ.surv.arena); t++) { try { CBZ.stepSim(1 / 60); } catch (e) {} await sleep(50); }
        if (!CBZ.surv || !CBZ.surv.arena) { D.why = "no island (mode " + CBZ.game.mode + ")"; return false; }
        try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
        D.sec(1.5);
        return true;
      },
      A() { return CBZ.surv.arena; },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.48; },
      ring(a, r) { const A = D.A(); return { x: A.center.x + Math.cos(a) * r, z: A.center.z + Math.sin(a) * r }; },
      // a point of open sea on bearing a, `off` metres outside the island's radius
      sea(a, off) { return D.ring(a, D.A().radius + off); },
      sunAz() {
        const s = CBZ.sun, t = CBZ.sunTarget;
        if (!s) return 0;
        return Math.atan2(s.position.z - (t ? t.position.z : 0), s.position.x - (t ? t.position.x : 0));
      },
      tripod(px, py, pz, tx, ty, tz, fov) {
        const cam = CBZ.camera; if (!cam) return;
        if (fov && cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
        cam.position.set(px, py, pz); cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      /* The player held in the air 8 m behind the lens. The game decides
         detail by distance to the player, so a player left on the island
         would photograph a culled event; held aloft he makes no splash. */
      parkPlayer() {
        const P = CBZ.player, cam = CBZ.camera;
        if (!P || !cam) return;
        const d = new T.Vector3(); cam.getWorldDirection(d);
        P.pos.x = cam.position.x - d.x * 8; P.pos.z = cam.position.z - d.z * 8;
        P.pos.y = Math.max(cam.position.y, 4) + 25; P.vy = 0;
        if (P.vel) { P.vel.x = 0; P.vel.y = 0; P.vel.z = 0; }
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
        if (window.CBZ && CBZ.skySync) CBZ.skySync();
        if (!CBZ.renderer) return;
        if (D._raf) await new Promise((res) => D._raf.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
        else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 600));
      },
      advance(sec) { D.sec(sec); if (D.follow) D.follow(); },
    };
  }

  const CH = [
    async function playerFall() {
      if (!await D.boot()) throw new Error("survival never booted: " + D.why);
      D.base = D.sunAz() + Math.PI * 0.6;          // light from the side
      const p = D.sea(D.base, 150);
      const P = CBZ.player;
      const y0 = D.seaY(p.x, p.z);
      P.pos.x = p.x; P.pos.z = p.z; P.pos.y = y0 + 14; P.vy = 0;
      if (P.vel) { P.vel.x = 0; P.vel.y = 0; P.vel.z = 0; }
      D.follow = () => {
        const y = D.seaY(p.x, p.z);
        const e = D.sea(D.base + 0.045, 143);
        D.tripod(e.x, y + 1.7, e.z, p.x, y + 0.5, p.z, 52);
      };
      let t = 0, wet = false;
      for (; t < 240; t++) {
        D.step(1);
        // hold the column: only gravity acts on the drop
        P.pos.x = p.x; P.pos.z = p.z;
        if (P._swim || P.pos.y <= y0 + 0.05) { wet = true; break; }
      }
      D.sec(0.1);
      D.follow();
      D.m = { wet: wet ? 1 : 0, fallFrames: t };
    },
    async function smallMeteor() {
      D.hold = true;
      const p = D.sea(D.base + 0.5, 170);
      if (!CBZ.meteor || !CBZ.meteor.strike) throw new Error("no CBZ.meteor.strike");
      D.follow = () => {
        const y = D.seaY(p.x, p.z);
        const e = D.sea(D.base + 0.5 + 0.12, 140);
        D.tripod(e.x, y + 2.2, e.z, p.x, y + 2.5, p.z, 55);
        D.parkPlayer();
      };
      D.follow();
      // a strike needs a live meteor event: the game's own, forced like a match would run it,
      // and it is accepted only once the director has turned the event active
      D.forced = (CBZ.disasters && CBZ.disasters.force) ? CBZ.disasters.force("meteor") : false;
      D.struck = 0; D.seen = "";
      for (let t = 0; t < 7200 && !D.struck; t++) {
        D.step(1);
        const st = CBZ.disasters.state();
        if (D.seen.indexOf(st) < 0) D.seen += st + " ";
        if (st === "active" && CBZ.meteor.strike({ x: p.x, z: p.z, cls: "small", eta: 1.6 }) !== false) D.struck = 1;
      }
      D.sec(1.6 + 0.15);
      D.follow();
      D.m = { struck: D.struck, impulses: CBZ.waterImpulsesLive ? (CBZ.waterImpulsesLive() | 0) : -1 };
      try {
        const da = CBZ.disasterAudit ? CBZ.disasterAudit() : {}, ma = CBZ.meteorAudit ? CBZ.meteorAudit() : {};
        D.diag = { unpaused: D.unpaused || 0, forced: D.forced, seen: D.seen, dstate: CBZ.disasters.state(), cur: da.current || da.cur || da.id || null, mlive: ma.live, mon: ma.on,
                   busy: !!(CBZ.meteor.busy && CBZ.meteor.busy()), keys: Object.keys(da).slice(0, 12).join(",") };
      } catch (e) { D.diag = { err: String(e) }; }
    },
    async function bigMeteor() {
      const p = D.sea(D.base + 1.3, 380);
      D.follow = () => {
        const e = D.sea(D.base + 1.3, 120);
        D.tripod(e.x, 40, e.z, p.x, 6, p.z, 55);
        D.parkPlayer();
      };
      D.follow(); D.sec(1.0);
      D.struck = CBZ.meteor.strike({ x: p.x, z: p.z, cls: "impact", eta: 2.2 }) !== false ? 1 : 0;
      D.sec(2.2 + 0.4);
      D.follow();
      D.m = { struck: D.struck, impulses: CBZ.waterImpulsesLive ? (CBZ.waterImpulsesLive() | 0) : -1 };
    },
  ];
  const want = sub.ch | 0;
  while (D.chapter < want) { D.chapter++; await CH[D.chapter](); }
  return { ok: true, state: JSON.stringify(D.m) + (D.diag ? " " + JSON.stringify(D.diag) : ""), metrics: D.m };
}

export default {
  id: "water-impacts",
  title: "Water: things hitting it",
  description: "The player dropped into the sea, a small meteor and a big meteor into the sea, each as a strip of frames through the event.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same sim time · same camera",
  method: "Both sides boot ?mode=survival at seed 90210, freeze the frame loop and step the real sim. The player is teleported 14 m over deep water and let fall; the meteors are CBZ.meteor.strike aimed at open sea inside the game's own forced meteor event.",
  beforeParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 420000,
  metrics: {
    wet: { label: "Player entered the water", better: "higher" },
    struck: { label: "The meteor strike was accepted", better: "higher" },
    impulses: { label: "Live wave impulses in the sea after impact", better: "higher" },
  },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage,
};
