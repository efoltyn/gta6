#!/usr/bin/env node
/* tools/speedway-check.mjs — THE BULLRING ON FOOT, in plain node.

   The real three r128, the real rig, physics.js, solidground.js, worldmap.js,
   the race modules and city/island_speedway.js in one vm (tools/lib/verbs-vm):

     · the banking is the floor: CBZ.floorAt on banked track points (straights,
       spirals, turns, apron to wall, asked in a scrambled order, the way many
       bodies ask) equals race_core.surfaceY within 5 cm, and still does after
       a world build (cityWorldGeo used to drop the Bullring's provider)
     · the stands are floors: front row, cross-aisle, upper rows, concourse
     · nobody the street deals is put down on the racing surface: every point
       of it is a keep-out, and 4000 region scatter draws, gated the way the
       spawners gate them, never land on it; the dealer's pitch is shut there
     · a race car at 50 m/s reaching a standing body is a carstrike contact
       (city/carstrike.js CS.hit, the car's shape swept over the frame)
     · out of the car you stand: a rig the door beat left folded in a car seat
       (the Bullring's own driver is a helmeted figure, so nothing held it)
       is stood up by the exit, hands off the wheel, feet on the banking

     node tools/speedway-check.mjs        exit 0 = ok */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const v = loadVerbsVM({ mode: "city" });
const { CBZ, THREE, ctx } = v;
CBZ.scene = new THREE.Scene();
const run = (f) => vm.runInContext(read(f), ctx, { filename: f });
for (const f of ["src/systems/solidground.js", "src/city/worldmap.js",
  "src/race/race_core.js", "src/race/race_track.js", "src/race/race_venue.js",
  "src/city/island_speedway.js", "src/city/ragdoll.js", "src/city/carstrike.js"]) run(f);

// the city's ground, as world.js declares it: the registered landmass oracles
CBZ.registerGroundBase("city", (x, z) => Math.max(0, CBZ.cityGroundHeightAt(x, z)));
const A = { noSpawn: [], roads: [], regions: [] };
CBZ.city = { arena: A };

const RC = CBZ.race.core, D = RC.DIMS, SW = CBZ.speedway, K = CBZ.race.track.kit;
ok(!!(SW && RC && CBZ.floorAt), "the Bullring loaded (speedway, race core, floorAt)");

function trackSamples() {
  const pts = [];
  // straights, spirals, the turns, the dogleg; apron to the wall
  for (const s of [0, 40, 75, 100, 140, 190, 260, 330, 386, 430, 480, 560, 640, 700, 760])
    for (const u of [D.APRON_IN + 0.5, -8, -4, 0, 3, 6, 9.5]) pts.push([s, u]);
  // scrambled, so consecutive questions are far apart round the lap
  for (let i = pts.length - 1; i > 0; i--) { const j = (i * 7919 + 13) % (i + 1); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  return pts;
}
function floorErr() {
  let worst = 0, at = null;
  for (const [s, u] of trackSamples()) {
    const f = RC.frame(s), c = SW.toCity(f.x + f.nx * u, f.z + f.nz * u);
    const e = Math.abs(CBZ.floorAt(c.x, c.z) - RC.surfaceY(s, u));
    if (e > worst) { worst = e; at = [s, u]; }
  }
  return { worst, at };
}
let r = floorErr();
ok(r.worst < 0.05, `floorAt on the banking = the surface (worst ${(r.worst * 100).toFixed(1)} cm${r.at ? " at s " + r.at[0] + " u " + r.at[1] : ""})`);
// a world build: providers registered by a builder go; a page's own stay
CBZ._landmassBuilders.length = 0;
try { CBZ.cityWorldGeo({ root: null, regions: [] }); } catch (e) { /* the fog sweep wants a scene root: the provider pass ran first */ }
r = floorErr();
ok(r.worst < 0.05, `...and after a world build (worst ${(r.worst * 100).toFixed(1)} cm)`);

// the stands
{
  const s = 200, sec = K.standSection(RC, s, {}), S = K.STAND, f = RC.frame(s);
  const y = (u) => { const c = SW.toCity(f.x + f.nx * u, f.z + f.nz * u); return CBZ.floorAt(c.x, c.z); };
  ok(Math.abs(y(S.U0 + 0.4) - sec.y0) < 0.05, `front row is a floor (${y(S.U0 + 0.4).toFixed(2)} vs ${sec.y0.toFixed(2)})`);
  ok(Math.abs(y(S.U0 + 5 * S.TREAD + 0.4) - (sec.y0 + 5 * S.RISER)) < 0.05, "sixth row is a floor");
  ok(Math.abs(y((S.uC0 + S.uC1) / 2) - sec.yX) < 0.05, "the cross-aisle is a floor");
  ok(Math.abs(y(S.uTop + 1) - sec.yConc) < 0.05, "the concourse is a floor");
  ok(Math.abs(y(D.WALL_U + D.WALL_T + 0.5) - sec.wallTop) < 0.05, "the walkway behind the fence is a floor");
}

// nobody the street deals on the racing surface
{
  CBZ.registerNoSpawnZone(A, SW.noSpawnZone());
  let open = 0, n = 0;
  for (let s = 0; s < D.L; s += 3) for (let u = D.APRON_IN; u <= D.WALL_U; u += 1.5) {
    const f = RC.frame(s), c = SW.toCity(f.x + f.nx * u, f.z + f.nz * u); n++;
    if (!CBZ.citySpawnBlocked(c.x, c.z, 0.6, true)) open++;
  }
  ok(open === 0, `every point of the racing surface is closed to spawns (${n - open}/${n})`);
  const reg = { kind: "circle", cx: SW.CX, cz: SW.CZ, r: 210 };
  let rs = 0x2545f491;
  const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return ((rs >>> 0) % 1e6) / 1e6; };
  let landed = 0, onTrack = 0;
  for (let i = 0; i < 4000; i++) {
    const p = CBZ.cityScatterInRegion(reg, 1, rnd, 4)[0];
    if (CBZ.citySpawnBlocked(p.x, p.z, 1, true)) continue;      // every spawner refuses a blocked draw
    landed++;
    const fr = CBZ.speedwayFrame(p.x, p.z, {});
    if (fr && fr.u > D.APRON_IN && fr.u < D.WALL_U) onTrack++;
  }
  ok(landed > 50 && onTrack === 0, `no ambient spawn on the racing surface (${onTrack} of ${landed} placed)`);
  const f = RC.frame(60), c = SW.toCity(f.x, f.z);
  ok(!!CBZ.cityKeepOutAt(c.x, c.z, 0), "the street's pitch is shut on the track (cityKeepOutAt)");
}

// a race car at 50 m/s against a standing body
{
  const CS = CBZ.carStrike, RD = CBZ.race.car ? CBZ.race.car.DIMS : { width: 1.95, bodyLength: 5.1, height: 1.3, wheelbase: 2.74 };
  const gp = SW.gridPose(5), h = gp.heading;
  const car = { pos: { x: gp.x, y: gp.y, z: gp.z }, heading: h, v: 50, vx: Math.sin(h) * 50, vz: Math.cos(h) * 50,
    dims: { width: RD.width, length: RD.bodyLength || 5.1, height: RD.height, wheelbase: RD.wheelbase }, model: { body: "coupe" }, _raceCar: true };
  const nose = (car.dims.length || 5) / 2;
  // the car has just moved this frame (50 m/s x 1/30 s = 1.7 m): its nose went
  // from 1.3 m short of him to 0.4 m past where he stands
  const body = { pos: { x: gp.x + Math.sin(h) * (nose - 0.4), y: gp.y, z: gp.z + Math.cos(h) * (nose - 0.4) }, radius: 0.3 };
  CBZ.feelDt = 1 / 30;
  const hit = CS && CS.hit(car, body, 50);
  ok(!!hit, `a race car at 50 m/s reaching a standing body is a carstrike contact${hit ? " (" + hit.end + ", y " + hit.y.toFixed(2) + ")" : ""}`);
  const clear = { pos: { x: body.pos.x + Math.cos(h) * 3, y: gp.y, z: body.pos.z - Math.sin(h) * 3 }, radius: 0.3 };
  ok(!(CS && CS.hit(car, clear, 50)), "...and a body 3 m clear of its flank is not");
}

// out of the car you stand, on the banking
{
  let loaded = true;
  try { run("src/city/vehicles.js"); } catch (e) { loaded = false; console.log("  (vehicles.js would not load in the vm: " + (e && e.message) + ")"); }
  const P = CBZ.player, ch = CBZ.playerChar;
  if (loaded && CBZ.cityExitVehicle) {
    const gp = SW.gridPose(5);
    const grp = new THREE.Group(); grp.position.set(gp.x + 2.3, gp.y, gp.z);
    const car = { group: grp, pos: grp.position, heading: gp.heading, v: 0, vx: 0, vz: 0, _raceCar: true, player: true, dims: { width: 1.95, length: 5.1, height: 1.3, wheelbase: 2.74 } };
    P.driving = true; P._vehicle = car;
    // the door beat's end state: folded into the seat, hands on the wheel, shrunk to the fit
    ch.sitting = true; ch.seatRef = { cushion: 0.3, floorBelow: 0, kind: "car" }; ch.driveSteer = 0.4; ch.group.scale.setScalar(0.8);
    try { CBZ.cityExitVehicle(); } catch (e) { console.log("  exit threw: " + (e && e.message)); }
    ok(!P.driving && !ch.sitting && !ch.seatRef && !ch.driveSteer && Math.abs(ch.group.scale.x - 1) < 1e-6,
      `out of the race car the rig stands (sitting ${ch.sitting}, seat ${!!ch.seatRef}, wheel ${ch.driveSteer}, scale ${ch.group.scale.x})`);
    const fl = CBZ.floorAt(P.pos.x, P.pos.z);
    ok(Math.abs(P.pos.y - fl) < 0.05, `...feet on the banking (y ${P.pos.y.toFixed(2)}, floor ${fl.toFixed(2)})`);
  } else ok(false, "vehicles.js exit path reachable in the vm");
}

console.log(fails ? `\n${fails} FAILED` : "\nall ok");
process.exit(fails ? 1 : 0);
