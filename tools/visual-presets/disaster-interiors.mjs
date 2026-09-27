/* Disaster Survival — INSIDE THE ISLAND'S BUILDINGS.

   The owner's three complaints from a tablet session, each one a shot:

     lift-top        ride a tower lift from the lobby and see where it lets
                     you out. It used to stop at the shell's roof, inside the
                     facade's crown; it should come out on the crown's top.
     window-view     stand on an upper floor of a house and look at the back
                     wall. Every window used to be an opaque painted card on a
                     solid wall; you should see the island through it.
     small-interior  the smallest house on the island, from the front corner
                     of its ground floor: a table that fits, clear of the
                     stairs and the door (it used to stand on the stairs).

   The same stage runs against the old and the new build, so it reads only
   what both publish: CBZ.surv.arena.{fragile,elevators}, a building's
   {x,z,w,d,gy,storeys,glass}, a lift's {b,mesh} and whichever of `stops`
   (new) or `hi` (old) it has for its top.

   Run:
     ba disaster-interiors --before http://127.0.0.1:PORT/ --no-open
   where PORT serves a clean export of the commit before the change (the
   lift record changed shape, so a flag A/B cannot show it).

   HARNESS TRAP: stage() is SERIALIZED into the page; every knob rides on
   input.subject. */

const subjects = [
  { id: "lift-top", label: "Ride the tower lift to the top",
    focus: "The player stands still on a crowned tower's lift car in the lobby and the sim runs until the car reaches its highest stop. Third-person lens from just off the top. Before: the car stops at the shell roof, inside the crown. After: it comes out on the crown's top deck with a rail." },
  { id: "window-view", label: "Look out of an upper-floor window",
    focus: "Lens inside a two-storey house, first floor, facing the back wall's windows. Before: opaque painted panes on a solid wall. After: real openings with clear glass; the island is visible through them." },
  { id: "small-interior", label: "The smallest house's ground floor",
    focus: "Lens in the front corner of the smallest house on the island looking at the back corner. Before: a four-seat table dropped on the stair strip. After: the largest table that fits the free floor, clear of the stairs, the door and the front walk." },
];

async function stageDisasterInteriors(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const sub = input.subject;
  const W = input.width || innerWidth, Hh = input.height || innerHeight;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  if (!window.__disasterInteriors) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
      document.querySelector('[data-mode="survival"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(500);
    window.__disasterInteriors = { ok: true };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }
  const A = CBZ.surv.arena, P = CBZ.player;
  const quiet = () => { try { if (CBZ.disasters && CBZ.disasters.start) CBZ.disasters.start(); } catch (_) {} };
  const step = (secs, each) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      P.hp = 100; P.dead = false;
      if (each) each();
    }
  };
  quiet();
  if (typeof CBZ.dayPhase === "function") CBZ.dayPhase(0.42);
  const houses = (A.fragile || []).filter((b) => !(A.elevators || []).some((e) => e.b === b) && b.w && b.d);
  const cam = CBZ.camera;
  cam.aspect = W / Hh; cam.near = 0.1; cam.far = 20000;
  let info = {};

  if (sub.id === "lift-top") {
    // the crowned tower with the biggest crown over its shell roof
    let best = null, bestH = -1;
    for (const e of A.elevators || []) {
      const box = new T.Box3().setFromObject(e.b.group);
      const crown = box.max.y - (e.b.gy + e.b.storeys * 3.4);
      if (crown > bestH) { bestH = crown; best = e; }
    }
    if (!best) return { ok: false, err: "no lifts" };
    const e = best, b = e.b;
    const topOf = (x) => (x.stops ? x.stops[x.stops.length - 1] : x.hi);
    // stand on the car wherever it is; wait for it to come back down if needed
    const board = () => { P.pos.set(b.ox, b.gy + e.mesh.position.y + 0.12, b.oz); P.vy = 0; if (P.vel) P.vel.set(0, 0, 0); };
    board();
    let t = 0, maxY = -1e9, reached = false;
    while (t < 90) {
      step(0.25);
      t += 0.25;
      if (t % 6 < 0.25) quiet();
      if (Math.abs(P.pos.x - b.ox) > 3 || Math.abs(P.pos.z - b.oz) > 3) board();
      maxY = Math.max(maxY, P.pos.y);
      if (e.mesh.position.y >= topOf(e) - 0.02 && P.pos.y > b.gy + topOf(e) - 0.5) { reached = true; step(0.6); break; }
    }
    const box = new T.Box3().setFromObject(b.group);
    info = { style: b.facadeStyle || null, shellRoof: +(b.storeys * 3.4).toFixed(1), liftTop: +topOf(e).toFixed(1),
      crownTop: +(box.max.y - b.gy).toFixed(1), riderHeight: +(P.pos.y - b.gy).toFixed(1), reached, secs: t };
    if (CBZ.playerChar && CBZ.playerChar.group) { CBZ.playerChar.group.visible = true; CBZ.playerChar.group.position.copy(P.pos); }
    cam.fov = 62;
    cam.position.set(P.pos.x + 5.5, P.pos.y + 3.6, P.pos.z - 7.5);
    cam.up.set(0, 1, 0); cam.lookAt(P.pos.x, P.pos.y + 0.6, P.pos.z);
  } else if (sub.id === "window-view") {
    // a two-storey-plus house: first-floor windows on the back (+z) wall
    let pick = null;
    const cands = houses.filter((b) => b.storeys >= 2 && b.d >= 8).sort((a, c) => (a.x + a.z * 0.37) - (c.x + c.z * 0.37));
    for (const b of cands) {
      const gl = (b.glass || []).filter((g) => g.z > b.z + b.d / 2 - 0.6 && g.y - b.gy > 3.4 && g.y - b.gy < 6.8);
      if (gl.length) { gl.sort((a, c) => Math.abs(a.x - b.x) - Math.abs(c.x - b.x)); pick = { b, g: gl[0] }; break; }
    }
    if (!pick) return { ok: false, err: "no house with first-floor back windows" };
    const b = pick.b, g = pick.g;
    P.pos.set(b.x + 30, b.gy + 60, b.z - 40);     // out of shot
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    cam.fov = 72;
    cam.position.set(g.x, g.y + 0.1, b.z + b.d / 2 - 3.3);
    cam.up.set(0, 1, 0); cam.lookAt(g.x, g.y - 0.2, b.z + b.d / 2 + 20);
    info = { house: [+b.x.toFixed(1), +b.z.toFixed(1)], size: [+b.w.toFixed(1), +b.d.toFixed(1)], storeys: b.storeys, style: b.facadeStyle || null };
  } else {
    const small = houses.slice().sort((a, c) => a.w * a.d - c.w * c.d)[0];
    if (!small) return { ok: false, err: "no house" };
    const b = small;
    P.pos.set(b.x + 30, b.gy + 60, b.z - 40);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    cam.fov = 84;
    const fy = b.gy + 1.75;
    cam.position.set(b.x + b.w / 2 - 0.55, fy, b.z - b.d / 2 + 0.55);
    cam.up.set(0, 1, 0); cam.lookAt(b.x - b.w / 2 + 1.4, b.gy + 0.5, b.z + b.d / 2 - 1.2);
    info = { house: [+b.x.toFixed(1), +b.z.toFixed(1)], size: [+b.w.toFixed(1), +b.d.toFixed(1)], storeys: b.storeys, style: b.facadeStyle || null };
  }
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  for (const el of document.body.children) {
    if (el.id === "game" || el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "CANVAS") continue;
    el.style.setProperty("display", "none", "important");
  }
  CBZ.renderer.render(CBZ.scene, cam);
  return Object.assign({ ok: true, subject: sub.id }, info);
}

export default {
  id: "disaster-interiors",
  title: "Disaster Survival: inside the island's buildings",
  description: "The lift to the top of a crowned tower, the view out of an upper-floor window, and the smallest house's ground floor, staged in the shipped build against the build before.",
  beforeLabel: "BEFORE", afterLabel: "AFTER",
  viewport: { width: 1280, height: 800 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metrics: {}, metricsNote: "Staged captures; the lift subject reports shellRoof / liftTop / crownTop / riderHeight.",
  subjects,
  stage: stageDisasterInteriors,
};
