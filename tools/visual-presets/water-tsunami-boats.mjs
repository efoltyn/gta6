/* BOATS IN A TSUNAMI — tools/visual-compare preset.

   OWNER (2026-11-21): "during tsunami boats should react to water ... this is
   a big part of it".

   Three real hulls (a jetski, a 6 m speedboat, a 12 m cruiser, each with one
   person aboard) lie at anchor 35 m off the beach, square in the path of the
   island's own tsunami. Nothing about them is scripted: they are
   CBZ.seaCraft.spawn() records, the same hulls the game sails. The beats are
   polled on the event's physical state, not on seconds:

     drawdown    the sea has left; are they aground on the bared bed?
     the bore    the front reaches them (a strip of four frames)
     the flood   the town is under; where has the water carried them?
     afterwards  the water has gone; where were they left?

   The camera rides the centroid of the three hulls, so wherever the water
   takes them is what gets photographed. Boots ?mode=survival, freezes the
   frame loop, drives CBZ.stepSim, forces the director onto the tsunami. */

const subjects = [
  { id: "drawdown", ch: 0, label: "The drawdown: boats on the bared seabed",
    focus: "The sea has pulled off the shelf. A boat with no water under it sits on the bed, heeled over on its bilge; it does not hover at the old sea level." },
  { id: "the-bore", ch: 1, strip: { frames: 4, stepSec: 0.6 }, label: "The bore reaches them",
    focus: "Four frames, 0.6 s apart, from the moment the front arrives. The face lifts each hull; the jetski is thrown and rolled, the speedboat broaches, the cruiser climbs and is carried. White water over the decks." },
  { id: "the-flood", ch: 2, label: "Carried into the town",
    focus: "A third of the way through the standing flood, from above. The hulls have gone where the current went: inland, among the buildings, turned whichever way the water left them." },
  { id: "afterwards", ch: 3, label: "Where the water left them",
    focus: "The flood has drained. Each hull lies where it grounded, on a street or a lawn or back in the shallows, heeled on its side, capsized or upright as the water left it." },
];

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__tsuBoats;
  if (!D) {
    D = window.__tsuBoats = {
      chapter: -1, m: {}, boats: [], follow: null,
      step(n) {
        for (let i = 0; i < n; i++) {
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          // headless has no pointer lock, so the match keeps pausing itself; a
          // paused match runs none of its updaters (CBZ.stepSim gates on state)
          if (CBZ.game.state !== "playing") { CBZ.game.state = "playing"; D.unpaused = (D.unpaused || 0) + 1; }
          const P = CBZ.player;
          if (P) {
            P.hp = 100; P.dead = false;
            // the player held in the air near the hulls: the game sets detail by
            // distance to him, and a submerged player swaps the fog to the dive tint
            const c = D.centroid();
            if (c) { P.pos.x = c.x + 6; P.pos.z = c.z + 6; P.pos.y = 60; P.vy = 0; if (P.vel) { P.vel.x = 0; P.vel.y = 0; P.vel.z = 0; } }
          }
          if (D.follow) D.follow();
          CBZ.stepSim(1 / 60);
        }
      },
      sec(s) { D.step(Math.max(1, Math.round(s * 60))); },
      audit() { try { return CBZ.disasters.tsunamiAudit() || {}; } catch (e) { return {}; } },
      async boot() {
        for (let t = 0; t < 2000 && !(CBZ.game && document.getElementById("playBtn") && document.querySelector('[data-mode="survival"]')); t++) await sleep(150);
        const mb = document.querySelector('[data-mode="survival"]');
        if (!mb) { D.why = "no survival tile"; return false; }
        mb.click();
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
        for (let t = 0; t < 400 && !(CBZ.surv && CBZ.surv.arena); t++) { try { CBZ.stepSim(1 / 60); } catch (e) {} await sleep(50); }
        if (!CBZ.surv || !CBZ.surv.arena) { D.why = "no island"; return false; }
        if (!CBZ.disasters || !CBZ.disasters.force) { D.why = "no director"; return false; }
        try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
        D.sec(1.5);
        CBZ.disasters.force("flood");
        return true;
      },
      A() { return CBZ.surv.arena; },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.48; },
      dir() {
        const ev = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
        if (ev && Number.isFinite(ev.dx)) D.lastDir = { x: ev.dx, z: ev.dz };
        return D.lastDir || null;
      },
      centroid() {
        const L = D.boats.filter((b) => b && b.pos);
        if (!L.length) return null;
        let x = 0, z = 0, y = 0;
        for (const b of L) { x += b.pos.x; z += b.pos.z; y += b.group ? b.group.position.y : 0; }
        return { x: x / L.length, z: z / L.length, y: y / L.length };
      },
      // the three hulls, 35 m outside the beach on the side the wave comes from
      spawn() {
        const A = D.A(), d = D.dir();
        if (!d || !CBZ.seaCraft) return false;
        const lx = -d.z, lz = d.x;
        const keys = ["jetski", "boat", "cruiser"], off = [-20, 0, 24];
        for (let i = 0; i < keys.length; i++) {
          const x = A.center.x - d.x * (A.radius + 35) + lx * off[i];
          const z = A.center.z - d.z * (A.radius + 35) + lz * off[i];
          const rec = CBZ.seaCraft.spawn(keys[i], x, z, Math.atan2(lx, lz), { crew: 1, anchored: true });
          if (rec) D.boats.push(rec);
        }
        D.start = D.centroid();
        return D.boats.length > 0;
      },
      tripod(px, py, pz, tx, ty, tz, fov) {
        const cam = CBZ.camera; if (!cam) return;
        cam.fov = fov || 55; cam.near = 0.5; cam.far = 20000; cam.updateProjectionMatrix();
        cam.position.set(px, py, pz); cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      // side-on to the wave's travel, `side` metres along the front, `up` above the hulls
      beside(side, back, up) {
        const c = D.centroid(), d = D.dir() || { x: 1, z: 0 };
        if (!c) return;
        const lx = -d.z, lz = d.x;
        D.tripod(c.x + lx * side - d.x * back, Math.max(c.y, D.seaY(c.x, c.z)) + up, c.z + lz * side - d.z * back,
                 c.x, Math.max(c.y, -1) + 1.0, c.z, 55);
      },
      num() {
        const out = { afloat: 0, moved: 0, heeled: 0 };
        const s = D.start;
        for (const b of D.boats) {
          if (!b || b.dead) continue;
          out.afloat++;
          const roll = Math.abs((b._rollNow || 0) * 57.3) + Math.abs((b._heel || 0) * 57.3);
          if (roll > 12 || b._capsized) out.heeled++;
        }
        const c = D.centroid();
        if (c && s) out.moved = +Math.hypot(c.x - s.x, c.z - s.z).toFixed(1);
        return out;
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
        await new Promise((res) => D._raf.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
        await new Promise((r) => setTimeout(r, 600));
      },
      advance(sec) { D.sec(sec); if (D.follow) D.follow(); },
    };
  }

  const CH = [
    async function drawdown() {
      if (!await D.boot()) throw new Error("survival never booted: " + D.why);
      let g = 0;
      while (g++ < 4000 && CBZ.disasters.state() !== "warn") D.sec(0.1);
      g = 0;
      while (g++ < 600 && !D.dir()) D.sec(0.1);
      if (!D.spawn()) throw new Error("no hulls spawned (no event direction or no CBZ.seaCraft)");
      D.follow = () => D.beside(34, 10, 4);
      g = 0;
      while (g++ < 4000) {
        const a = D.audit();
        if (CBZ.disasters.state() !== "warn") break;
        if (a.warnBudget && a.eventT != null && a.eventT / a.warnBudget >= 0.9) break;
        D.sec(1 / 30);
      }
      D.follow = () => D.beside(34, 10, 4);
      D.follow();
      D.m = D.num();
    },
    async function bore() {
      const A = D.A();
      D.follow = () => D.beside(40, 16, 8);
      let g = 0;
      while (g++ < 6000 && CBZ.disasters.state() !== "active") D.sec(0.05);
      g = 0;
      while (g++ < 6000 && D.audit().phase !== "sweep") D.sec(0.05);
      g = 0;
      while (g++ < 6000) {
        const a = D.audit();
        if (a.phase !== "sweep") break;
        // frontS runs from the island centre along the travel; the hulls sit at -(R + 35)
        if (a.frontS != null && a.frontS > -(A.radius + 35) - 6) break;
        D.sec(1 / 60);
      }
      D.follow = () => D.beside(40, 16, 8);
      D.follow();
      D.m = D.num();
    },
    async function flood() {
      let g = 0;
      while (g++ < 9000) {
        const a = D.audit();
        if (CBZ.disasters.state() !== "active") break;
        if (a.phase === "flooded" && a.floodBudget && a.floodT / a.floodBudget >= 0.33) break;
        if (a.phase === "drain") break;
        D.sec(1 / 30);
      }
      D.follow = () => {
        const c = D.centroid(), d = D.dir() || D.lastDir || { x: 1, z: 0 };
        if (c) D.tripod(c.x - d.x * 46, 38, c.z - d.z * 46, c.x, 0, c.z, 55);
      };
      D.follow();
      D.m = D.num();
    },
    async function after() {
      let g = 0;
      while (g++ < 9000 && CBZ.disasters.state() === "active") D.sec(0.1);
      D.sec(4);
      D.follow = () => {
        const c = D.centroid(), d = D.dir() || D.lastDir || { x: 1, z: 0 };
        if (c) D.tripod(c.x - d.x * 34, 24, c.z - d.z * 34, c.x, 0, c.z, 55);
      };
      D.follow();
      D.m = D.num();
    },
  ];
  const want = sub.ch | 0;
  while (D.chapter < want) { D.chapter++; await CH[D.chapter](); }
  const au = D.audit();
  return { ok: true, state: JSON.stringify(D.m) + " " + CBZ.disasters.state() + "/" + (au.phase || "-") + " front " + (au.frontS != null ? Math.round(au.frontS) : "-") + " R " + Math.round(D.A().radius) + " unpaused " + (D.unpaused || 0), metrics: D.m };
}

export default {
  id: "water-tsunami-boats",
  title: "Water: boats in the tsunami",
  description: "A jetski, a speedboat and a cruiser at anchor in the path of the island's tsunami: aground in the drawdown, hit by the bore, carried by the flood, left where the water left them.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same physical beat of the event · camera on the hulls' centroid",
  method: "Both sides boot ?mode=survival at seed 90210, freeze the frame loop, force the director onto the tsunami, and spawn three crewed hulls with CBZ.seaCraft.spawn 35 m off the beach on the wave's own bearing. Beats are polled on the event's state.",
  beforeParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 600000,
  metrics: {
    afloat: { label: "Hulls still in the world" },
    moved: { label: "How far the water carried them, m", better: "higher" },
    heeled: { label: "Hulls heeled over 12 degrees or capsized" },
  },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage,
};
