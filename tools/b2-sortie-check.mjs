/* tools/b2-sortie-check.mjs — the B-2 flies a real sortie in node (the page's own sim):
   its own airframe is built (not the stand-in box), it bombs from 12 km with the bay
   opening only for the run, the penetrators go on armour and the Mk 84s on men, and
   it kills from there. node tools/b2-sortie-check.mjs */
import { boot, settle, run, G } from "./lib/npcwar-node.mjs";
let fails = 0, passes = 0;
function check(ok, msg) { if (ok) { passes++; console.log("  PASS " + msg); } else { fails++; console.log("  FAIL " + msg); } }
const W = boot("?a=b2_spirit*1&b=m1_abrams*2,men*30&n=1v32&arena=dunes&bw=ak47&auto=1&probe=0");
if (W.err) { console.log("boot threw", W.err); process.exit(1); }
// the node world's studio.boom is a stub: give it the real one's shape (as npcwar-headless realBoom)
W.CBZ.studio.boom = function (p, o) {
  const R0 = (o && o.radius) || 6, LR = R0 * 0.55;
  for (const a of W.sb.__battle.roster().slice()) {
    if (a.dead || a.fled || (a.group && a.group.visible === false)) continue;
    if (Math.hypot(a.pos.x - p.x, a.pos.z - p.z) > LR || Math.abs(a.pos.y - p.y) > LR + 3) continue;
    W.sb.hurtMan(a, 1e6, { fromX: p.x, fromZ: p.z, by: (o && o.by) || null, cause: "explosion" });
  }
};
await settle();
run(W, 1);
const B = W.sb.__battle, MAP = G(W, "MAP");
const b2 = B.roster().find((m) => m.unitId === "b2_spirit");
check(!!b2 && b2.air, "the B-2 is in the air");
const R = b2.rig && b2.rig.state;
check(!!R && !b2.group.userData.standIn, "its own airframe and rig (not the stand-in box)");
const agl0 = b2.pos.y - MAP.groundAt(b2.pos.x, b2.pos.z);
check(agl0 > 11000, "at 12 km (" + Math.round(agl0) + " m)");
check(R.gearK < 0.05, "gear up in flight (" + R.gearK.toFixed(2) + ")");
const rel = [], openFar = [];
const fire0 = b2.rig.fire;
b2.rig.fire = function (shot) {
  const t = shot.target;
  const B0 = R.bays[shot.wid === "gbu31_blu109" ? 0 : 1];
  rel.push({ wid: shot.wid, tv: !!(t && t.vehicle), open: +B0.open.toFixed(2), d: t ? Math.round(Math.hypot(t.pos.x - b2.pos.x, t.pos.z - b2.pos.z)) : -1 });
  return fire0.apply(this, arguments);
};
let maxFalls = 0, openSteps = 0, steps = 0;
const a = run(W, 600, () => {
  steps++;
  if (R.bays[0].open > 0.5 || R.bays[1].open > 0.5) openSteps++;
  maxFalls = Math.max(maxFalls, R.falls.length);
  return true;
});
console.log("    releases:", JSON.stringify(rel.slice(0, 8)), "... total", rel.length);
check(rel.length > 0, "it released bombs (" + rel.length + ")");
check(rel.every((r) => r.open > 0.9), "every bomb left an open bay");
check(rel.filter((r) => r.wid === "gbu31_blu109").every((r) => r.tv), "the penetrators went on armour");
check(rel.filter((r) => r.wid === "gbu31_mk84" && r.tv).length === 0 || rel.filter((r) => r.wid === "gbu31_blu109").length >= 8, "no Mk 84 spent on armour while a penetrator was left");
check(rel.every((r) => r.d > 3000), "released kilometres short (first " + (rel[0] && rel[0].d) + " m)");
check(maxFalls > 0, "the bombs fell visibly from their bay (" + maxFalls + " in the air at once)");
check(openSteps < steps * 0.35, "the bay was shut most of the sortie (" + Math.round(100 * openSteps / steps) + "% open)");
const tanksDead = B.roster().filter((m) => m.unitId === "m1_abrams" && m.dead).length;
console.log("    kills " + b2.kills + ", tanks dead " + tanksDead + ", war " + (a.over ? "over " + a.simT + " s " + a.winner : "on"));
check(b2.kills > 0, "and it killed (" + b2.kills + ")");
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
