#!/usr/bin/env node
/* tools/ballistics-check.mjs — the weapon table, and the physics held to
   published figures. Node only: loads src/weapons/weapon-data.js and
   src/weapons/ballistics.js as they ship.

     node tools/ballistics-check.mjs          the table + every check
     node tools/ballistics-check.mjs --table  the table only            */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sb = { console, Math, CBZ: { CONFIG: {} } };
sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);
for (const f of ["src/weapons/weapon-data.js", "src/weapons/ballistics.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
}
const B = sb.CBZ.ballistics;
const wrow = (id) => sb.CBZ.weaponById(id);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log("  PASS " + msg); } else { fails++; console.log("  FAIL " + msg); } };
const r2 = (x) => Math.round(x * 100) / 100;

/* ---- the table ---- */
const ids = ["sidearm", "revolver", "deagle", "uzi", "smg", "shotgun", "carbine", "ak47", "lmg", "sniper",
  "m240_coax", "pkm", "m2_50cal"];
console.log("\nWEAPON TABLE (v0 m/s | tof/drop at 100/300 m from the bore | v at 300 | E muzzle J | sigma mil elite stand/kneel/prone | eff m | gel cm)");
for (const id of ids) {
  const g = B.GUN[id], c = B.CART[g.cart], w = wrow(id);
  const v0 = B.muzzleV(id, w), k = B.dragOf(id, w);
  const s = (st, bip) => r2(B.sigma({ gun: g, tier: "elite", stance: st, bipod: bip, settle: 1 }));
  console.log(
    id.padEnd(10), String(v0).padStart(4),
    ("t100 " + r2(B.tof(v0, k, 100)) + "s drop " + r2(B.drop(v0, k, 100)) + "m").padEnd(22),
    ((300 < B.reach(v0, k) ? "t300 " + r2(B.tof(v0, k, 300)) + "s drop " + r2(B.drop(v0, k, 300)) + "m" : "never gets there")).padEnd(22),
    ("v300 " + Math.round(B.vAt(v0, k, 300))).padEnd(9),
    ("E " + Math.round(B.energy(c, v0) * (c.pellets || 1))).padEnd(8),
    ("sig " + s("stand") + "/" + s("crouch") + "/" + s("prone", true)).padEnd(20),
    ("eff " + g.eff).padEnd(8), "gel " + Math.round(c.pen.flesh * 100), "malf 1/" + Math.round(1 / g.malf),
    (g.tracer ? "tracer 1:" + g.tracer : g.tracerLast ? "tracer last " + g.tracerLast : ""));
}
if (process.argv.includes("--table")) process.exit(0);

console.log("\nFLIGHT");
const M4 = wrow("carbine");
check(Math.abs(B.tof(M4.v0, M4.dragK, 300) - 0.37) < 0.04, "M855 from an M4 reaches 300 m in ~0.37 s (" + r2(B.tof(M4.v0, M4.dragK, 300)) + ")");
check(Math.abs(B.vAt(M4.v0, M4.dragK, 300) - 735) < 40, "and arrives at ~735 m/s (" + Math.round(B.vAt(M4.v0, M4.dragK, 300)) + ")");
const poi100 = B.poi(M4.v0, M4.dragK, 100, 300, 0.066), poi300 = B.poi(M4.v0, M4.dragK, 300, 300, 0.066), poi500 = B.poi(M4.v0, M4.dragK, 500, 300, 0.066);
check(poi100 > 0.04 && poi100 < 0.25 && Math.abs(poi300) < 0.005, "a 300 m battle-sight zero prints high at 100 m (" + r2(poi100 * 100) + " cm) and dead on at 300");
check(poi500 < -0.8 && poi500 > -2.4, "and drops ~1.4 m by 500 m (" + r2(poi500) + " m)");
const SN = wrow("sniper");
check(Math.abs(B.drop(SN.v0, SN.dragK, 300) - 0.85) < 0.25, "the M118LR needs ~0.9 m of holdover at 300 m from the bore (" + r2(B.drop(SN.v0, SN.dragK, 300)) + ")");
const p9 = wrow("sidearm");
check(B.vAt(p9.v0, p9.dragK, 25) < 343 * 1.05, "9 mm is subsonic-ish downrange (" + Math.round(B.vAt(p9.v0, p9.dragK, 25)) + " m/s at 25 m): no crack");

console.log("\nPENETRATION");
const C556 = B.CART["556"], C762 = B.CART["762x51"], C9 = B.CART["9x19"], C50 = B.CART["50bmg"], CBK = B.CART["12ga00"];
check(B.pierce(C556, "cinder", 0.2, 905) > 0, "5.56 through one 20 cm cinder block at close range");
check(B.pierce(C556, "sand", 0.6, 905) === 0, "5.56 stops in a 60 cm sandbag wall");
check(B.pierce(C50, "sand", 0.6, 887) > 0, ".50 BMG goes through the same sandbags");
check(B.pierce(C9, "cinder", 0.2, 360) === 0, "9 mm does not go through a cinder block");
check(B.pierce(C556, "steel", 0.0015, 800) > 0 && B.pierce(C9, "steel", 0.0015, 340) > 0, "a car door (1.5 mm steel) stops nothing");
check(B.pierce(CBK, "wood", 0.15, 400) === 0, "buckshot stops in a timber crate");
check(B.penRHA(C556, 905) < 8 && B.penRHA(C50, 887) > 15, "armour: 5.56 ~" + Math.round(B.penRHA(C556, 905)) + " mm RHA, .50 ~" + Math.round(B.penRHA(C50, 887)) + " mm");

console.log("\nBODIES");
// a man, side-on to the shooter, centre mass at 100 m
function shoot(cart, v, v0, plan, an, of, or, oy, df, dr, dy, sf, sr, sy) {
  const tr = {}; B.traceZones(plan, of, or, oy, df, dr, dy, sf, sr, sy, tr);
  return B.wound(tr, an, cart, v, v0, null, {});
}
const man = B.anatomyOf("men", null);
const w1 = shoot(C556, 845, 905, B.MAN.stand, man, 3, 0.05, 1.30, -1, 0, 0, 1, 1, 1);
check(w1.hit && w1.organ === "vital" && w1.vOut > 0, "5.56 through a man's chest: heart/lungs, and it exits (dep " + Math.round(w1.dep) + " J, out " + Math.round(w1.vOut) + " m/s)");
const h1 = B.harm(w1, man, true);
check(h1.now >= 0.9, "a rifle round through the chest puts a man down (" + r2(h1.now) + " now)");
const w2 = shoot(C9, 330, 360, B.MAN.stand, man, -3, 0.25, 1.30, 1, 0, 0, 1, 1, 1);
check(w2.hit && w2.zone === "armR" && !w2.organ, "9 mm through the arm: no organ (" + w2.zone + ", " + Math.round(w2.dep) + " J)");
const head = shoot(C9, 330, 360, B.MAN.stand, man, -3, 0, 1.68, 1, 0, 0, 1, 1, 1);
check(head.organ === "brain" && B.harm(head, man, true).kill, "9 mm to the head kills");
// an elephant broadside, measured 6.5 m long x 3.2 high x 1.8 wide
const ele = B.anatomyOf("african_elephant", null);
const el556 = shoot(C556, 845, 905, B.QUAD, ele, 0.62 * 6.5, -5, 0.6 * 3.2, 0, 1, 0, 6.5, 1.8, 3.2);
check(el556.hit && el556.organ !== "vital", "5.56 broadside into an elephant does not reach the heart (" + el556.organ + ", stopped " + el556.stopped + ")");
const el50 = shoot(C50, 850, 887, B.QUAD, ele, 0.62 * 6.5, -5, 0.6 * 3.2, 0, 1, 0, 6.5, 1.8, 3.2);
check(el50.organ === "vital", ".50 BMG does");
const eleBrain = shoot(C762, 820, 853, B.QUAD, ele, 9, 0, 0.82 * 3.2, -1, 0, 0, 6.5, 1.8, 3.2);
const eleBrain50 = shoot(C50, 860, 887, B.QUAD, ele, 9, 0, 0.82 * 3.2, -1, 0, 0, 6.5, 1.8, 3.2);
check(eleBrain.organ !== "brain" && eleBrain50.organ === "brain", "the elephant's skull stops 7.62 from the front; .50 reaches the brain");
const lion = B.anatomyOf("lion", null);
const li = shoot(C556, 845, 905, B.QUAD, lion, 0.62 * 2.6, -3, 0.6 * 1.2, 0, 1, 0, 2.6, 0.6, 1.2);
const lh = B.harm(li, lion, false);
check(li.organ === "vital" && lh.now < 0.6 && lh.bleed > 0.08, "a lung-shot lion is mortally hit and keeps coming for seconds (" + r2(lh.now) + " now, bleeds out in " + r2((1 - lh.now) / lh.bleed) + " s)");
const lg = shoot(C556, 845, 905, B.QUAD, lion, 0.33 * 2.6, -3, 0.6 * 1.2, 0, 1, 0, 2.6, 0.6, 1.2);
const lgh = B.harm(lg, lion, false);
check(lg.organ === "gut" && lgh.bleed < lh.bleed / 4, "a gut-shot lion bleeds far slower (" + r2((1 - lgh.now) / Math.max(1e-6, lgh.bleed)) + " s)");

console.log("\nTHE SHOOTER");
const sStand = B.sigma({ gun: B.GUN.carbine, tier: "elite", stance: "stand", settle: 1 });
const sProne = B.sigma({ gun: B.GUN.lmg, tier: "elite", stance: "prone", bipod: true, settle: 1 });
const sRun = B.sigma({ gun: B.GUN.carbine, tier: "elite", stance: "stand", speed: 4, settle: 0.3 });
const sCiv = B.sigma({ gun: B.GUN.carbine, tier: "civ", stance: "stand", settle: 1 });
check(sProne < sStand / 2.5 && sRun > sStand * 4 && sCiv > sStand * 2, "prone on a bipod << standing << on the run; a civilian shoots 2x+ wider (" + [sProne, sStand, sRun, sCiv].map(r2).join(" / ") + " mil)");
// hit probability on a standing man's torso box (0.38 x 0.35 m) at 100 / 300 m
let rng = 12345; const rnd = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
function pHit(sig, d) {
  let h = 0; for (let i = 0; i < 4000; i++) { const x = B.gauss(rnd) * sig * d / 1000, y = B.gauss(rnd) * sig * d / 1000; if (Math.abs(x) < 0.19 && Math.abs(y) < 0.30) h++; } return h / 4000;
}
console.log("    torso hit odds, elite standing: 50 m " + r2(pHit(sStand, 50)) + "  100 m " + r2(pHit(sStand, 100)) + "  300 m " + r2(pHit(sStand, 300)) +
  " | prone LMG 300 m " + r2(pHit(sProne, 300)) + " | civilian 100 m " + r2(pHit(sCiv, 100)));
check(pHit(sStand, 100) > 0.4 && pHit(sStand, 300) < 0.25, "an aimed standing shot hits a chest at 100 m more often than not, and rarely at 300");
const g = B.lob(B.GRENADE.m67.throwV, 30, 0);
check(g && g.t > 1.2 && g.t < B.GRENADE.m67.fuse, "a 30 m grenade throw flies " + r2(g.t) + " s, inside the fuse");

console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
