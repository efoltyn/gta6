#!/usr/bin/env node
/* tools/test-furniture-walk.mjs — WALK A BODY INTO FURNITURE, IN NODE.
   Owner: "when player walks up to a couch the game starts glitching like up
   and down". Loads the REAL src/systems/physics.js into a vm (same stub as
   tools/test-collide.mjs) and runs the player's grounded step exactly as
   physics.js does it — move, support = walkGroundAt, snap inside
   [-STEP_DOWN, +STEP_UP], then collide(pos, r, y + STEP_SOLID, y + 1.7) —
   for N frames against:

     sofa        city/furniture.js's sofa colliders (seat/back/arms, noStep)
     sofaLegacy  the same boxes WITHOUT noStep (any low banded box: a stage
                 riser, a kerb box) — must step up and STAY up
     along       walking parallel to the sofa front, brushing the seat
     jumpOn      landing on the sofa from a jump, then standing on it
     kerb        a 0.30 m step box (architecture): still stepped onto
     stair       a CBZ.platforms ramp flight: still climbed smoothly

   Prints the Y range / frame-to-frame reversals for each.
     node tools/test-furniture-walk.mjs [physics.js path]   exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const SRC = process.argv[2] || new URL("src/systems/physics.js", ROOT);
const noop = () => {};
const CBZ = {
  colliders: [], platforms: [], TUNE: {}, CONFIG: {}, keys: {},
  player: { pos: { x: 0, y: 0, z: 0 }, radius: 0.38 }, playerChar: {},
  lerpAngle: (a) => a, animChar: noop, onUpdate: noop,
  game: { mode: "city" },
};
const ctx = vm.createContext({ window: { CBZ }, console, Math, performance: { now: () => Date.now() } });
ctx.window.window = ctx.window;
vm.runInContext(readFileSync(SRC, "utf8"), ctx, { filename: "physics.js" });

const STEP_UP = 0.45, STEP_DOWN = 0.9, STEP_SOLID = 0.42, R = 0.38, G = 22;
const DT = 1 / 60;

function world(cols, plats) {
  CBZ.colliders.length = 0; for (const c of cols) CBZ.colliders.push(c);
  CBZ.platforms.length = 0; for (const p of plats || []) CBZ.platforms.push(p);
  CBZ.markCollidersDirty();
}
// the sofa as city/furniture.js draws it (L 2.0 m, D 0.85, at x 0, front at z = -0.425)
function sofa(noStep) {
  const b = (minX, maxX, minZ, maxZ, y1) => {
    const c = { minX, maxX, minZ, maxZ, y0: 0, y1, noBreach: true };
    if (noStep) c.noStep = true;
    return c;
  };
  return [
    b(-1.0, 1.0, -0.425, 0.425, 0.37),   // body: the seat's solid (cushion 0.40 less give)
    b(-1.0, 1.0, 0.325, 0.425, 0.85),    // back frame
    b(-1.0, -0.82, -0.38, 0.42, 0.58),   // arm
    b(0.82, 1.0, -0.38, 0.42, 0.58),     // arm
  ];
}

// one frame of the grounded player, as physics.js runs it
function frame(P, dx, dz) {
  P.pos.x += dx * DT; P.pos.z += dz * DT;
  const support = CBZ.walkGroundAt(P.pos.x, P.pos.z, P.pos.y);
  if (P.grounded) {
    if (support <= P.pos.y + STEP_UP && support >= P.pos.y - STEP_DOWN) { P.pos.y = support; P.vy = 0; }
    else { P.grounded = false; P.vy -= G * DT; P.pos.y += P.vy * DT; if (P.pos.y <= support) { P.pos.y = support; P.vy = 0; P.grounded = true; } }
  } else {
    P.vy -= G * DT; P.pos.y += P.vy * DT;
    if (P.pos.y <= support && P.vy <= 0) { P.pos.y = support; P.vy = 0; P.grounded = true; }
  }
  CBZ.collide(P.pos, R, P.pos.y + STEP_SOLID, P.pos.y + 1.7);
}
function run(name, start, vel, frames, opts) {
  opts = opts || {};
  const P = { pos: { ...start }, vy: opts.vy || 0, grounded: !opts.vy };
  const ys = [];
  for (let i = 0; i < frames; i++) { frame(P, vel[0], vel[1]); ys.push(P.pos.y); }
  // judge the settled tail (the last half): an oscillation never settles
  const tail = ys.slice(frames >> 1);
  let flips = 0, lastD = 0;
  for (let i = 1; i < tail.length; i++) {
    const d = tail[i] - tail[i - 1];
    if (Math.abs(d) > 1e-6) { if (lastD && Math.sign(d) !== Math.sign(lastD)) flips++; lastD = d; }
  }
  const mn = Math.min(...tail), mx = Math.max(...tail);
  const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
  const vari = tail.reduce((a, b) => a + (b - mean) * (b - mean), 0) / tail.length;
  console.log(`${name.padEnd(12)} y ${mn.toFixed(3)}..${mx.toFixed(3)}  var ${vari.toExponential(2)}  reversals ${flips}  end (${P.pos.x.toFixed(2)}, ${P.pos.y.toFixed(3)}, ${P.pos.z.toFixed(2)})`);
  return { mn, mx, vari, flips, P };
}

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log("  FAIL " + what); } };

// 1. walk straight into the sofa front (from z = -3, +z at 3 m/s)
world(sofa(true));
let r = run("sofa", { x: 0.1, y: 0, z: -3 }, [0, 3], 240);
check(r.flips === 0 && r.mx - r.mn < 1e-6, "sofa: no vertical motion");
check(r.mx < 1e-6, "sofa: feet stay on the floor (blocker, not a stair)");
check(r.P.pos.z <= -0.425 - R + 0.01, "sofa: stopped at the seat front");

// 2. the same low boxes without noStep: stepped onto and STAYED on (was the oscillation)
world(sofa(false));
r = run("sofaLegacy", { x: 0.1, y: 0, z: -3 }, [0, 3], 240);
check(r.flips === 0 && r.mx - r.mn < 1e-6, "low banded box: stands still on it, no up/down");

// 3. walk along the front, brushing the seat, past both arms
world(sofa(true));
r = run("along", { x: -3, y: 0, z: -0.425 - R + 0.05 }, [3, 0.4], 240);
check(r.flips === 0 && r.mx < 1e-6, "along: no vertical motion");

// 4. jump onto it: lands on the seat and stays there
world(sofa(true));
r = run("jumpOn", { x: 0.1, y: 0.5, z: -0.1 }, [0, 0], 120, { vy: 1 });
check(r.flips === 0 && Math.abs(r.mn - 0.37) < 1e-6 && Math.abs(r.mx - 0.37) < 1e-6, "jumpOn: stands on the seat");

// 5. architecture still steps: a 0.30 m step box
world([{ minX: -2, maxX: 2, minZ: 0, maxZ: 20, y0: 0, y1: 0.3 }]);
r = run("kerb", { x: 0, y: 0, z: -2 }, [0, 3], 240);
check(Math.abs(r.mn - 0.3) < 1e-6 && r.flips === 0, "kerb: stepped up and stays");

// 6. a stair flight (platform ramp) 0 -> 3 m over 5 m, then a landing
world([], [
  { minX: -1, maxX: 1, minZ: 0, maxZ: 5, top: 3, ramp: { z0: 0, z1: 5, y0: 0, y1: 3 } },
  { minX: -1, maxX: 1, minZ: 5, maxZ: 20, top: 3 },
]);
r = run("stair", { x: 0, y: 0, z: -1 }, [0, 3], 240);
check(Math.abs(r.mn - 3) < 1e-6, "stair: climbed to the landing");

// 7. a body falling past a GUARD RAIL (the grand stair's balustrade collider:
//    18 cm, 1.0 m tall) with its centre over it: falls to the floor, never
//    stands in the air on the rail's top (the owner's "standing on air")
world([{ minX: -0.12, maxX: 0.06, minZ: -3, maxZ: 3, y0: 0.1, y1: 1.05 }]);
r = run("railDrop", { x: 0, y: 3, z: 0 }, [0, 0], 120, { vy: -0.1 });
check(Math.abs(r.mx) < 1e-6, "railDrop: fell to the floor past the rail top");

// 8. ...while a crate as tall as that rail is still a floor you land on
world([{ minX: -0.6, maxX: 0.6, minZ: -0.6, maxZ: 0.6, y0: 0, y1: 1.05 }]);
r = run("crateLand", { x: 0, y: 3, z: 0 }, [0, 0], 120, { vy: -0.1 });
check(Math.abs(r.mn - 1.05) < 1e-6 && Math.abs(r.mx - 1.05) < 1e-6, "crateLand: stands on the crate");

console.log(fails ? `${fails} FAIL` : "ALL OK");
process.exit(fails ? 1 : 0);
