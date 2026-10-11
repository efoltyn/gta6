#!/usr/bin/env node
/* tools/npcwar-physics-check.mjs — DOES A BODY ON THE NPC WAR FIELD WEIGH
   WHAT IT WEIGHS? No browser: the page's own sim in node (tools/lib/npcwar-node.mjs)
   plus systems/bodymass.js, which the page gets from the `people` pack.

     1  fists against a hide: bodymass.js's numbers. Man on man is 1.0, a man
        on a gorilla still hurts it, a man on a bull elephant does almost
        nothing (it used to be floored at 0.28).
     2  100 unarmed men against one bull elephant for 60 s: the bull is still
        standing with nearly all of its hp, and the crowd cannot shove it
        (separation split by mass; it used to be pushed at up to 13 m/s).
     3  a charge is a collision: the bull running into a man throws him and
        knocks him down; the bull does not slow.
     4  a hull runs men down by momentum (vehCrush): a tank in a crowd of
        fists throws the men it meets and keeps its speed.
     5  a blast is pressure and impulse by distance: a man at the core dies,
        a man at 0.8 R is thrown and lives, a bull elephant at the core
        lives and is barely moved.
     6  a thrown body is ballistic at 9.81 and the landing is the injury.

     node tools/npcwar-physics-check.mjs          exit 0 = pass             */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { boot, settle, ROOT } from "./lib/npcwar-node.mjs";

let fails = 0, passes = 0;
function check(ok, msg) { if (ok) { passes++; console.log("  PASS " + msg); } else { fails++; console.log("  FAIL " + msg); } }
const r2 = (x) => Math.round(x * 100) / 100;

// the page's bestiary rows the node world lacks: a stand-in body (the species
// file's own build is used where it has one), the real numbers otherwise
function world(url) {
  const W = boot(url, { seed: 3 });
  if (W.err) throw W.err;
  const T = W.THREE, C = W.CBZ;
  C.cmat = (c) => new T.MeshLambertMaterial({ color: c });
  C.boxGeom = (x, y, z) => new T.BoxGeometry(x, y, z);
  C.faceAnimalHeading = (m, h) => { m.group.rotation.y = -h; };
  const rows = { african_elephant: { hp: 2400, spd: 4, danger: 0.85, bite: 60, scale: 2.6, len: 6, h: 3.2, w: 2.2 },
    gorilla: { hp: 300, spd: 3, danger: 0.85, bite: 30, scale: 1.15, len: 1.6, h: 1.6, w: 0.9 } };
  for (const id in rows) {
    const r = rows[id];
    C.WILDLIFE_SPECIES[id] = Object.assign({ id, name: id }, r, {
      build: () => { const g = new T.Group(); const b = new T.Mesh(new T.BoxGeometry(r.len, r.h, r.w), new T.MeshLambertMaterial()); b.position.y = r.h / 2; g.add(b); return g; },
    });
  }
  for (const f of ["src/systems/bodymass.js", "src/city/creature_combat.js"]) {
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), W.sb, { filename: f }); }
    catch (e) { console.log("  (" + f + " threw: " + e.message + ")"); }
  }
  return W;
}
const G = (W, e) => vm.runInContext(e, W.sb);

// ---------------------------------------------------------------- 1
console.log("1  fists against a hide");
{
  const W = world("?map=dunes&red=2&blue=1&ru=men&bu=african_elephant&rw=fists&rt=elite&auto=1&probe=0");
  await settle();
  W.B().advance(0.5, 1 / 20);
  const C = W.CBZ, R = W.B().roster();
  const man = R.find((m) => !m.beast), man2 = R.filter((m) => !m.beast)[1], el = R.find((m) => m.beast);
  const ape = { species: C.WILDLIFE_SPECIES.gorilla };
  const mm = C.meleeScale(man, man2), me = C.meleeScale(man, el), ma = C.meleeScale(man, ape);
  console.log("    man>man " + r2(mm) + "  man>gorilla " + r2(ma) + "  man>bull " + Math.round(me * 1000) / 1000 +
    "  (bull " + Math.round(C.bodyMass(el)) + " kg, hide " + C.bodyHide(el) + " mm)");
  check(mm === 1, "man on man is exactly 1");
  check(ma > 0.25 && ma < 0.5, "a fist still hurts a gorilla (" + r2(ma) + ")");
  check(me < 0.02, "a fist barely marks a bull elephant (" + me.toFixed(4) + ", was floored at 0.28)");
  check(C.meleeAbsorb(el) > C.meleeScale(man, el) * 3, "teeth get through a hide a fist cannot (" + r2(C.meleeAbsorb(el)) + ")");
}

// ---------------------------------------------------------------- 2
console.log("2  100 unarmed men v one bull elephant");
{
  const W = world("?map=dunes&red=100&blue=1&ru=men&bu=african_elephant&rw=fists&rt=elite&auto=1&probe=0");
  await settle();
  const sb = W.sb, B = W.B();
  let sepD = 0, sepMax = 0;
  const o2 = sb.push2;
  sb.push2 = function (m, o, k) {
    const b = m.beast ? m : (o.beast ? o : null);
    if (!b) return o2(m, o, k);
    const x = b.pos.x, z = b.pos.z;
    const r = o2(m, o, k);
    sepD += Math.hypot(b.pos.x - x, b.pos.z - z);
    return r;
  };
  let el = null;
  for (let t = 0; t < 60; t += 0.5) {
    B.advance(0.5, 1 / 20);
    sepMax = Math.max(sepMax, sepD / 0.5); sepD = 0;
    el = B.roster().find((m) => m.beast);
    if (!el || el.dead || B.audit().over) break;
  }
  const men = B.roster().filter((m) => !m.beast && !m.dead).length;
  console.log("    after 60 s: bull hp " + Math.round(el.hp) + "/" + el.maxHp + ", men standing " + men + ", crowd shove on the bull peak " + r2(sepMax) + " m/s");
  check(!el.dead && el.hp > el.maxHp * 0.9, "the bull stands with > 90% hp (it died in 47.5 s before)");
  check(sepMax < 3, "the crowd cannot shove it (peak " + r2(sepMax) + " m/s; it was 13.5)");
  console.log("    physics " + JSON.stringify(G(W, "PHYS.audit")));
}

// ---------------------------------------------------------------- 3
console.log("3  a charge is a collision");
{
  const W = world("?map=dunes&red=1&blue=1&ru=men&bu=african_elephant&rw=fists&rt=elite&auto=1&probe=0");
  await settle();
  W.B().advance(0.5, 1 / 20);
  const B = W.B(), R = B.roster();
  const man = R.find((m) => !m.beast), el = R.find((m) => m.beast);
  // a bull at 6 m/s, a man standing in its line
  el._vx = 6; el._vz = 0; man._vx = 0; man._vz = 0;
  const kb = G(W, "bodyKg"), ci = G(W, "contactImpulse");
  ci(el, man, 1, 0, kb(el), kb(man));
  const T = man._tossed;
  const v = T ? Math.hypot(T.vx, T.vz) : Math.hypot(man.kvx || 0, man.kvz || 0);
  console.log("    man leaves at " + r2(v) + " m/s" + (T ? " (airborne, vy " + r2(T.vy) + ")" : "") + ", bull loses " + r2(Math.hypot(el.kvx || 0, el.kvz || 0)) + " m/s, man hp " + Math.round(man.hp) + "/" + man.maxHp);
  check(v > 6.5 && v < 7.5, "the man takes ~(1+e) x 6 m/s (" + r2(v) + ")");
  check(Math.hypot(el.kvx || 0, el.kvz || 0) < 0.2, "the bull hardly notices");
  check(!!T || (man.ko > 0), "and he goes down / flies");
}

// ---------------------------------------------------------------- 4
console.log("4  a hull runs men down");
{
  const W = world("?a=m1_abrams*1&b=men&n=1v40&bw=fists&bt=thug&arena=dunes&auto=1&probe=0");
  await settle();
  const B = W.B();
  for (let t = 0; t < 40; t += 0.5) { B.advance(0.5, 1 / 20); if (B.audit().over) break; }
  const A = G(W, "PHYS.audit");
  const tank = B.roster().find((m) => m.vehicle);
  console.log("    " + JSON.stringify(A) + " tank alive " + !tank.dead);
  check(A.impacts > 0, "the tank met men with its hull (" + A.impacts + " impacts)");
  check(A.maxDv > 5, "and threw them (max delta-v " + r2(A.maxDv) + " m/s)");
}

// ---------------------------------------------------------------- 5
console.log("5  a blast");
{
  const W = world("?map=dunes&red=3&blue=1&ru=men&bu=african_elephant&rw=fists&rt=elite&auto=1&probe=0&freeze=1");
  await settle();
  W.B().advance(0.5, 1 / 20);
  const B = W.B(), R = B.roster();
  const men = R.filter((m) => !m.beast), el = R.find((m) => m.beast);
  const x = 0, z = 0, Rr = 10;
  const put = (m, d) => { m.pos.x = x + d; m.pos.z = z; m.pos.y = 0; };
  put(men[0], 2); put(men[1], 8); men[2].pos.x = 500; el.pos.x = x; el.pos.z = z + 5;
  const blast = G(W, "blastBodies");
  const elHp = el.hp;
  blast(x, 0.3, z, Rr, 1, {});
  const near = men[0], far = men[1];
  const fT = far._tossed, fv = fT ? Math.hypot(fT.vx, fT.vz) : Math.hypot(far.kvx || 0, far.kvz || 0);
  const ev = Math.hypot(el.kvx || 0, el.kvz || 0);
  console.log("    man at 0.2R dead " + near.dead + "; man at 0.8R hp " + Math.round(far.hp) + "/" + far.maxHp + ", thrown " + r2(fv) + " m/s; bull at 0.5R lost " + Math.round(elHp - el.hp) + " hp, moved " + r2(ev) + " m/s");
  check(near.dead, "a man at the core dies");
  check(!far.dead && fv > 1, "a man at 0.8 R lives and is pushed");
  check(!el.dead && ev < 3, "a bull elephant at the core lives and only rocks");
}

// ---------------------------------------------------------------- 6
console.log("6  a thrown body");
{
  const W = world("?map=dunes&red=1&blue=1&ru=men&bu=men&rw=fists&bw=fists&auto=1&probe=0");
  await settle();
  W.B().advance(0.5, 1 / 20);
  const B = W.B(), R = B.roster();
  const man = R[0];
  man.pos.x = 0; man.pos.z = 0; man.pos.y = G(W, "MAP.bodyY")(man, 0, 0);
  const y0 = man.pos.y;
  G(W, "flingBody")(man, 3, 7, 0, {});
  let apex = 0, t = 0, step = G(W, "stepTossed");
  while (man._tossed && man._tossed.down <= 0 && t < 5) { step(man, 1 / 60); t += 1 / 60; apex = Math.max(apex, man.pos.y - y0); }
  console.log("    apex " + r2(apex) + " m (7 m/s up: 2.50 at 9.81), flight " + r2(t) + " s, hp " + Math.round(man.hp) + "/" + man.maxHp);
  check(Math.abs(apex - 2.5) < 0.25, "the arc is real gravity");
  check(man.hp < man.maxHp, "the landing hurts");
}

console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
