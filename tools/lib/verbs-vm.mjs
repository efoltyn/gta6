/* tools/lib/verbs-vm.mjs — THE REAL RIG AND THE REAL VERBS, IN PLAIN NODE.

   Loads three r128 + world/materials.js + systems/fphands.js +
   entities/character.js + entities/poses.js + systems/physics.js (the real
   groundAt / collide / queryCollidersNear) + systems/grapple.js + the four
   verb files (verbs.js, verbposes.js and STRIKE's meleeposes.js /
   verbs_strike.js when they exist) into one vm context with the thinnest
   window/document stubs that let them boot. No browser, no canvas, seconds.

     import { loadVerbsVM } from "./lib/verbs-vm.mjs";
     const vmx = loadVerbsVM({ mode: "survival" });
     const a = vmx.actor({ build: "m" }), t = vmx.actor({ build: "f" });
     vmx.frame(1 / 60);                 // animChar for each actor + the late passes

   The fake world is plain data the loaded files read through their own
   seams: CBZ.colliders / CBZ.platforms (physics.js indexes them),
   CBZ.floorAt (terrain), CBZ.waterSubmergence, CBZ.propNearestBed. Set it
   with vmx.world({ colliders, platforms, floor(x,z), water(x,y,z), beds }). */
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const has = (f) => existsSync(new URL(f, ROOT));

export function loadVerbsVM(opts = {}) {
  const ctx = vm.createContext({ console, Math, performance, setTimeout, clearTimeout, Float32Array, Uint8Array });
  ctx.window = ctx; ctx.self = ctx;
  const noop = () => {};
  const el = () => ({
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, removeChild: noop, addEventListener: noop, setAttribute: noop,
    getContext: () => null, querySelector: () => null, querySelectorAll: () => [],
  });
  ctx.document = {
    addEventListener: noop, removeEventListener: noop, getElementById: () => null,
    createElement: el, body: el(), head: el(), pointerLockElement: null,
    querySelector: () => null, querySelectorAll: () => [],
  };
  ctx.addEventListener = noop; ctx.removeEventListener = noop;
  ctx.requestAnimationFrame = () => 0;
  ctx.innerWidth = 1280; ctx.innerHeight = 720;
  ctx.navigator = { userAgent: "node" };
  ctx.location = { search: "", href: "" };

  const updaters = [];
  let loading = "";
  const W = { floor: () => 0, water: () => 0, beds: [] };
  const slams = [];
  ctx.CBZ = {
    CONFIG: {}, HUMAN_SCALE: 0.70,
    TUNE: { walkSpeed: 6.4, crouchSpeed: 2.4, jumpVel: 8.2, gravity: 22 },
    game: { mode: opts.mode || "survival", state: "playing", level: 1 },
    onUpdate(order, fn) { updaters.push({ order, fn, file: loading }); },
    onAlways: noop, on: noop, onModeExit: noop,
    keys: {}, cam: { yaw: 0, pitch: 0 }, colliders: [], platforms: [], bots: [],
    now: 0, feelDt: 1 / 60,
    floorAt: (x, z) => W.floor(x, z),
    waterSubmergence: (x, y, z) => Math.max(0, W.water(x, y, z)),
    propNearestBed(px, pz, r, py) {
      let best = null, bd = (r || 3.8) * (r || 3.8);
      for (const b of W.beds) { const d = (b.x - px) ** 2 + (b.z - pz) ** 2; if (d < bd) { bd = d; best = b; } }
      return best;
    },
    trauma: {
      slam(a, speed, o) { slams.push({ a, speed, wall: !!(o && o.wall) }); return 0; },
      strike() { return 0; },
    },
    sfx: noop, shake: noop, doHitstop: noop, doSlowmo: noop,
  };
  const CBZ = ctx.CBZ;
  const run = (f) => { loading = f; vm.runInContext(read(f), ctx, { filename: f }); loading = ""; };
  run("src/vendor/three.r128.min.js");
  const THREE = ctx.THREE;
  CBZ.player = { pos: new THREE.Vector3(0, 0, -30), radius: 0.38, dead: false, hp: 100, speed: 0, vy: 0, grounded: true };
  CBZ.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  CBZ.camera.position.set(0, 3, -8);
  for (const f of ["src/world/materials.js", "src/systems/fphands.js", "src/entities/character.js", "src/entities/poses.js", "src/systems/bodymass.js", "src/entities/moves.js"]) run(f);
  if (has("src/entities/moves_posture.js")) { try { run("src/entities/moves_posture.js"); } catch (e) { /* posture needs the city; the verbs do not */ } }
  // the player rig exists before physics.js destructures it
  CBZ.playerChar = CBZ.makeCharacter({ skin: 0xd6a57e, torso: 0x335577, legs: 0x222222, arms: 0x335577, shoes: 0x111111, hair: 0x221100 });
  CBZ.playerChar.group.position.copy(CBZ.player.pos);
  run("src/systems/physics.js");
  const loaded = { physics: !!CBZ.groundAt, moves: !!(CBZ.moves && CBZ.moves.step), grapple: false, strike: false, meleePoses: false };
  if (opts.grapple !== false) { run("src/systems/grapple.js"); loaded.grapple = !!CBZ.body; }
  run("src/systems/verbs.js");
  if (has("src/systems/arrest.js")) run("src/systems/arrest.js");
  run("src/entities/verbposes.js");
  const errors = [];
  for (const f of ["src/entities/meleeposes.js", "src/systems/verbs_strike.js", "src/systems/bodyfall.js"]) {
    if (!has(f)) continue;
    try { run(f); if (f.includes("strike")) loaded.strike = true; else loaded.meleePoses = true; }
    catch (e) { errors.push(f + ": " + (e && e.message)); }
  }
  updaters.sort((a, b) => a.order - b.order);

  const actors = [];
  function actor(o = {}) {
    const ch = CBZ.makeCharacter(Object.assign({
      skin: 0xc68e62, torso: 0x884422, collar: 0x884422, arms: 0x884422, legs: 0x223344,
      shoes: 0x111111, hair: 0x221100,
    }, o));
    const a = { char: ch, group: ch.group, pos: ch.group.position, hp: 100, maxHp: 100, name: o.name || "actor", dead: false, speed: 0 };
    if (o.x != null) ch.group.position.set(o.x, o.y || 0, o.z || 0);
    if (o.yaw != null) ch.group.rotation.y = o.yaw;
    actors.push(a);
    if (o.bot) CBZ.bots.push(a);
    return a;
  }
  function clearActors() {
    actors.length = 0;
    CBZ.bots.length = 0;
    for (let i = CBZ.verbs.sessions.length - 1; i >= 0; i--) CBZ.verbs.sessions[i].cancel();
    CBZ.verbs.flights.length = 0;
  }
  function world(w = {}) {
    W.floor = w.floor || (() => 0);
    W.water = w.water || (() => 0);
    W.beds = w.beds || [];
    CBZ.colliders.length = 0;
    for (const c of w.colliders || []) CBZ.colliders.push(c);
    CBZ.platforms.length = 0;
    for (const p of w.platforms || []) CBZ.platforms.push(p);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
  }
  // one frame of the game loop as it touches people: each body's own animChar
  // (skipped while a physics owner has it, exactly as survivorbot/peds do),
  // then the grapple integration (24), and the late passes (89..91).
  const speeds = new Map();
  function frame(dt) {
    CBZ.now += dt * 1000;
    for (const a of actors) {
      if (a.dead) continue;
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(a)) continue;
      if (CBZ.verbs && CBZ.verbs.held && CBZ.verbs.held(a) && (CBZ.npcs || []).concat(CBZ.guards || []).indexOf(a) >= 0) continue;   // npc.js / guards.js skip a held body
      CBZ.animChar(a.char, speeds.get(a) || 0, dt);
    }
    for (const u of updaters) {
      if (u.file.includes("physics.js")) continue;          // no player controller here
      try { u.fn(dt); } catch (e) { errors.push(u.file + "@" + u.order + ": " + (e && e.stack || e)); }
    }
  }
  function setSpeed(a, v) { speeds.set(a, v); }
  return { ctx, CBZ, THREE, updaters, actor, actors, clearActors, world, frame, setSpeed, slams, errors, loaded };
}
