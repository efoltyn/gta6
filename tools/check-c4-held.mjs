#!/usr/bin/env node
/* tools/check-c4-held.mjs — THE CHARGE IS A THING YOU HOLD, NOT A BUTTON.

   Plain node, no browser. Checks systems/helditem_model.js (the rules) and
   that the dedicated C4 touch button and the tap/hold [B] grammar are gone:

     1. the hotbar: carrying 2 charges, none out -> a selectable charge cell
        and no detonator; charges out -> a Detonator cell (even with the bag
        empty); the jail bar model (hotbar_model.js) carries the same cells.
     2. placement: a look ray at a wall (+X normal), a car and the ground
        each stick; the brick centre sits half its thickness off the surface
        along the normal (within 1 cm) and its thin axis IS the normal; a
        surface beyond reach returns null.
     3. no #tbomb / #tvBoom / touchKeyHold("b") left in the touch layer.

   Usage: node tools/check-c4-held.mjs     Exit 0 = ok. */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HM = require(path.join(ROOT, "src/systems/helditem_model.js"));
const HB = require(path.join(ROOT, "src/systems/hotbar_model.js"));

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

// ---- 1. the bar ----
{
  const a = HM.cells({ c4: 2, planted: 0, grenades: 0, held: null });
  const c4 = a.find((e) => e.item === HM.C4_ITEM);
  ok(c4 && c4.kind === "throwable" && c4.selectable && c4.held === "c4" && c4.count === 2, "charge cell missing/unselectable with 2 carried");
  ok(!a.some((e) => e.kind === "detonator"), "detonator cell shown with nothing out");
  ok(!a.some((e) => /button|btn/i.test(JSON.stringify(e))), "a button state leaked into the cells");
  const b = HM.cells({ c4: 1, planted: 2, grenades: 0, held: "detonator" });
  const det = b.find((e) => e.kind === "detonator");
  ok(det && det.selectable && det.active && det.held === "detonator", "detonator cell missing once charges are out");
  const c = HM.cells({ c4: 0, planted: 1, grenades: 0, held: null });
  ok(c.length === 1 && c[0].kind === "detonator", "detonator must outlive the last brick in the bag");
  ok(HM.resolveHeld("c4", { c4: 0, planted: 1 }) === "detonator", "last brick placed must hand you the detonator");
  ok(HM.resolveHeld("detonator", { c4: 0, planted: 0 }) === null, "a detonator with nothing out must go away");
  // the jail bar carries them
  const bar = HB.build({ mode: "escape", guns: ["pistol"], held: "pistol", holstered: true, items: b });
  ok(HB.allowed(bar), "jail bar has a kind outside the allow-list");
  ok(bar.some((e) => e.kind === "throwable" && e.name === HM.C4_ITEM && e.selectable), "jail bar missing the charge cell");
  ok(bar.some((e) => e.kind === "detonator" && e.selectable), "jail bar missing the detonator cell");
  const g = HM.cells({ c4: 0, planted: 0, grenades: 3, held: "grenade" });
  ok(g.length === 1 && g[0].held === "grenade" && g[0].active, "frag cell must be a held item too");
  ok(HM.throwPower(0) < HM.throwPower(0.5) && HM.throwPower(0.5) < HM.throwPower(1) && HM.throwPower(5) === 1, "throw power must grow with the hold");
}

// ---- 2. placement ----
const T = HM.BRICK.thick;
function checkFlush(pl, surf, n, label) {
  if (!pl) { fails.push(label + ": no placement"); return; }
  // centre off the surface along the normal by half the thickness
  const d = (pl.pos.x - surf.x) * n.x + (pl.pos.y - surf.y) * n.y + (pl.pos.z - surf.z) * n.z;
  ok(Math.abs(d - T / 2) < 0.01, label + ": brick centre " + d.toFixed(4) + " m off the surface, want " + (T / 2).toFixed(4));
  // no sideways drift off the hit point
  const lat = Math.hypot(pl.pos.x - surf.x - n.x * d, pl.pos.y - surf.y - n.y * d, pl.pos.z - surf.z - n.z * d);
  ok(lat < 0.01, label + ": brick slid " + lat.toFixed(4) + " m along the surface");
  // thin axis (+Y of the brick) parallel to the normal
  const dot = pl.up.x * n.x + pl.up.y * n.y + pl.up.z * n.z;
  ok(dot > 0.999, label + ": brick not flush (thin axis . normal = " + dot.toFixed(4) + ")");
}
const flat = () => 0;
// a wall whose face is at x = 2, facing +X toward the eye at x = 3.5
{
  const world = { boxes: [{ minX: 0, maxX: 2, minZ: -3, maxZ: 3, y0: 0, y1: 3 }], cars: [], floorAt: flat };
  const hit = HM.pickSurface({ x: 3.5, y: 1.5, z: 0.2 }, { x: -1, y: -0.05, z: 0 }, world, HM.REACH);
  ok(hit && hit.kind === "wall" && Math.abs(hit.normal.x - 1) < 1e-6, "wall ray: expected a +X wall hit, got " + JSON.stringify(hit && { k: hit.kind, n: hit.normal }));
  const pl = HM.placement(hit);
  ok(pl && pl.stick === "wall", "wall placement must be a wall stick");
  checkFlush(pl, hit.point, { x: 1, y: 0, z: 0 }, "wall");
  // same wall, eye 4 m away: out of reach
  const far = HM.pickSurface({ x: 6, y: 1.5, z: 0 }, { x: -1, y: 0, z: 0 }, world, HM.REACH);
  ok(far === null || HM.placement(far) === null, "a wall 4 m away must not take a charge");
  ok(HM.placement({ kind: "wall", point: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, dist: HM.REACH + 0.5 }) === null, "placement beyond reach must be null");
  ok(HM.placement(null) === null, "a miss must be null");
}
// a car: heading 0.6 rad, 2 m wide, 4.4 m long, look at its flank
{
  const car = { x: 10, y: 0, z: 0, yaw: 0.6, hx: 1, hy: 0.72, hz: 2.2, ref: { id: "car" } };
  const world = { boxes: [], cars: [car], floorAt: flat };
  // the car's right flank normal in world: local +X rotated by yaw
  const nx = Math.cos(0.6), nz = -Math.sin(0.6);
  const eye = { x: 10 + nx * 2.2, y: 1.0, z: 0 + nz * 2.2 };
  const hit = HM.pickSurface(eye, { x: -nx, y: -0.05, z: -nz }, world, HM.REACH);
  ok(hit && hit.kind === "car" && hit.ref && hit.ref.id === "car", "car ray: expected a car hit");
  if (hit) {
    ok(Math.abs(hit.normal.x - nx) < 1e-6 && Math.abs(hit.normal.z - nz) < 1e-6, "car flank normal wrong " + JSON.stringify(hit.normal));
    const pl = HM.placement(hit);
    ok(pl && pl.stick === "car", "car placement must ride the car");
    checkFlush(pl, hit.point, hit.normal, "car");
  }
}
// the ground: look down at your feet, the floor at y = 0.3
{
  const world = { boxes: [], cars: [], floorAt: () => 0.3 };
  const hit = HM.pickSurface({ x: 0, y: 1.6, z: 0 }, { x: 0, y: -0.9, z: -0.44 }, world, HM.REACH);
  ok(hit && hit.kind === "ground", "ground ray: expected a ground hit");
  if (hit) {
    ok(Math.abs(hit.point.y - 0.3) < 0.01, "ground hit height " + hit.point.y.toFixed(3));
    const pl = HM.placement(hit);
    ok(pl && pl.stick === "ground", "ground placement kind");
    checkFlush(pl, { x: hit.point.x, y: 0.3, z: hit.point.z }, { x: 0, y: 1, z: 0 }, "ground");
  }
  // looking at the horizon hits nothing within reach
  ok(HM.pickSurface({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, world, HM.REACH) === null, "a level look at open ground must be a miss");
}
// nearest wins: a person standing in front of the wall
{
  const world = { boxes: [{ minX: 0, maxX: 2, minZ: -3, maxZ: 3 }, { minX: 2.6, maxX: 3.0, minZ: -0.2, maxZ: 0.2, y0: 0.2, y1: 1.75, person: true, ref: { id: "man" } }], cars: [], floorAt: flat };
  const hit = HM.pickSurface({ x: 4.2, y: 1.3, z: 0 }, { x: -1, y: 0, z: 0 }, world, HM.REACH);
  ok(hit && hit.kind === "person" && hit.ref.id === "man", "the man in front of the wall must take the charge");
  ok(HM.placement(hit) && HM.placement(hit).stick === "body", "a person is a body stick");
}

// ---- 3. the button is gone ----
for (const f of ["src/systems/touch.js", "src/systems/touch_vehicle.js", "css/mobile.css", "src/city/explosives.js"]) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  ok(!/id\s*=\s*["']?tbomb|["']tbomb["']|#tbomb/.test(src), f + " still has the #tbomb button");
  ok(!/tvBoom/.test(src), f + " still has the #tvBoom pill");
  ok(!/touchKeyHold\(\s*["']b["']/.test(src), f + " still synthesizes the [B] grammar");
}

if (fails.length) {
  console.error("c4-held check: FAIL\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("c4-held check: OK (charge/detonator/frag cells, wall/car/ground/person flush placement, reach, no C4 button)");
