#!/usr/bin/env node
/* tools/shark-mouth-parts.mjs — WHAT IS ACTUALLY IN THE MOUTH.

   Owner, looking at the prey's-eye shot: "find the black square in the mouth
   it's retarded and make it smaller it's sticking out."

   Reading geometry code to find a shape you can see is the slow way round, and
   it is how you end up "fixing" the wrong mesh. This builds a real megalodon,
   opens its jaws to a chosen gape, and prints EVERY mesh in the head with its
   name, its material colour, its local bounding box and — the number that
   actually settles it — how far the box reaches FORWARD of the tooth row. A
   part sticking out of the mouth is a part whose front face is in front of the
   teeth, and that is a measurement, not an opinion.

     node tools/shark-mouth-parts.mjs                 # megalodon, gape 1
     node tools/shark-mouth-parts.mjs --species great_white_shark --gape 0.6
     node tools/shark-mouth-parts.mjs --json
*/
import { launch, sleep } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SPECIES = arg("--species", "megalodon");
const GAPE = +arg("--gape", "1");
const JSON_OUT = has("--json");
// --maw-off: build the pre-trim buccal sack, so the same measurement can be
// taken on both shapes and the change stated as a number.
const MAW_OFF = has("--maw-off");
const say = (m) => { if (!JSON_OUT) console.log(m); };

const rig = await launch({ rafBudget: 0 });
await rig.open("index.html", "seed=90210&cfg_BOOT_METER=0" + (MAW_OFF ? "&sharkmaw=off" : ""));
if (!await rig.wait("window.CBZ && window.THREE && CBZ.game && CBZ.stepSim", 240000)) {
  console.error("page never published CBZ"); await rig.close(); process.exit(1);
}
if (!await rig.wait("CBZ.game && (CBZ.bootComplete || CBZ.game.state==='title') && document.getElementById('playBtn')", 300000)) {
  console.error("never booted"); await rig.close(); process.exit(1);
}
await rig.evl(`(()=>{ if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return 1 })()`);
await rig.wait(`(()=>{ if (CBZ.game.state==='playing') return true; const b=document.getElementById('playBtn'); if(b)b.click(); return CBZ.game.state==='playing'; })()`, 180000);
await sleep(600);
await rig.evl(`(() => { for (let i=0;i<60;i++) CBZ.stepSim(1/30); return 1 })()`);

const out = await rig.evl(`(() => {
  const T = window.THREE, CBZ = window.CBZ;
  const P = CBZ.player;
  let a = null;
  for (const w of CBZ.cityWildlife || []) {
    if (w && !w.dead && w.species && w.species.id === ${JSON.stringify(SPECIES)}) { a = w; break; }
  }
  if (!a && CBZ.cityWildlifeSpawnAt) a = CBZ.cityWildlifeSpawnAt(${JSON.stringify(SPECIES)}, P.pos.x + 30, P.pos.z + 30);
  if (!a) return { __err: "no " + ${JSON.stringify(SPECIES)} };
  for (let t = 0; t < 60 && a.group && !a.group.children.length; t++) { for (let i=0;i<4;i++) CBZ.stepSim(1/30); }
  const g = a.group;
  if (!g || !g.children.length) return { __err: "never built a body" };

  // OPEN THE JAWS through the production driver, not by posing a bone.
  if (CBZ.swimJaw) { try { CBZ.swimJaw(a, ${GAPE}); } catch (e) {} }
  for (let i=0;i<6;i++) CBZ.stepSim(1/30);
  g.updateMatrixWorld(true);

  const M = g._aquaticMouth || null;
  const C = (g.userData && g.userData.aquaticMouth) || null;

  /* THE TOOTH LINE IS THE RULER. "Sticking out of the mouth" means "in front
     of the teeth", so measure everything against the frontmost tooth. */
  let toothFront = -1e9, toothName = "";
  /* MEASURE IN THE BODY'S OWN FRAME, AND DO IT PROPERLY.
     The obvious version — take Box3.setFromObject (a WORLD axis-aligned box)
     and transform its eight corners back into body space — is wrong the moment
     the animal is not axis-aligned in the world, which it never is: you are
     re-bounding an already-inflated box through a rotation and inflating it
     again. It reported this megalodon's GILLS as sticking out in front of its
     teeth, which is how you end up confidently editing the wrong mesh.
     So: relative matrix from the mesh to the body, applied to the mesh's own
     geometry bounds. Tight, and in the frame where +x actually means "nose". */
  const invBody = new T.Matrix4().copy(g.matrixWorld).invert();
  const localBox = (obj) => {
    const geo = obj.geometry;
    if (!geo) return null;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const gb = geo.boundingBox;
    if (!gb || !isFinite(gb.max.x)) return null;
    const rel = new T.Matrix4().multiplyMatrices(invBody, obj.matrixWorld);
    const b = new T.Box3();
    const p = new T.Vector3();
    for (const xs of [gb.min.x, gb.max.x]) for (const ys of [gb.min.y, gb.max.y]) for (const zs of [gb.min.z, gb.max.z]) {
      p.set(xs, ys, zs).applyMatrix4(rel); b.expandByPoint(p);
    }
    return b;
  };
  const parts = [];
  g.traverse(function (o) {
    if (!o.isMesh || !o.geometry) return;
    const b = localBox(o);
    if (!b || !isFinite(b.max.x)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const cols = mats.map(function (m) {
      return m && m.color ? "#" + m.color.getHexString() : "?";
    });
    const lum = mats.reduce(function (v, m) {
      if (!m || !m.color) return v;
      return Math.min(v, 0.2126*m.color.r + 0.7152*m.color.g + 0.0722*m.color.b);
    }, 1);
    // count triangles, and whether the shape is BOX-like (8 corners' worth)
    const pos = o.geometry.attributes && o.geometry.attributes.position;
    const tris = pos ? (o.geometry.index ? o.geometry.index.count : pos.count) / 3 : 0;
    parts.push({
      name: o.name || "(unnamed)", tris: Math.round(tris),
      cols: cols.join(","), darkest: +lum.toFixed(3),
      x: [+b.min.x.toFixed(2), +b.max.x.toFixed(2)],
      y: [+b.min.y.toFixed(2), +b.max.y.toFixed(2)],
      z: [+b.min.z.toFixed(2), +b.max.z.toFixed(2)],
      w: +(b.max.z - b.min.z).toFixed(2),
      h: +(b.max.y - b.min.y).toFixed(2),
      d: +(b.max.x - b.min.x).toFixed(2),
    });
    if (/tooth|teeth|dental/i.test(o.name || "") && b.max.x > toothFront) { toothFront = b.max.x; toothName = o.name; }
  });
  for (const p of parts) p.aheadOfTeeth = +(p.x[1] - toothFront).toFixed(2);
  parts.sort(function (A, B) { return B.aheadOfTeeth - A.aheadOfTeeth; });
  return {
    species: a.species.id, scale: (a.group.scale && a.group.scale.x) || 1,
    toothFront: +toothFront.toFixed(2), toothName: toothName,
    gape: M ? (M.gape != null ? M.gape : null) : null,
    contract: C ? { version: C.version, shape: C.shape, lipProfile: C.lipProfile } : null,
    parts: parts,
  };
})()`);

if (!out || out.__err) { console.error("failed: " + (out && out.__err)); await rig.close(); process.exit(1); }
if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); await rig.close(); process.exit(0); }

say(`\n${out.species}  scale ${(+out.scale).toFixed(2)}  gape ${GAPE}`);
say(`tooth line (frontmost tooth, body-local +x): ${out.toothFront}  [${out.toothName}]`);
say(`contract: ${JSON.stringify(out.contract)}`);
say("\n  ahead    name                     tris   darkest  colours                     W     H     D   x-range");
say("  ─────────────────────────────────────────────────────────────────────────────────────────────────────");
for (const p of out.parts) {
  const flag = p.aheadOfTeeth > 0 ? "»" : " ";
  say(`  ${String(p.aheadOfTeeth).padStart(6)} ${flag} ${p.name.padEnd(22)} ${String(p.tris).padStart(6)}  ` +
      `${String(p.darkest).padStart(6)}  ${p.cols.slice(0, 26).padEnd(27)}` +
      `${String(p.w).padStart(5)} ${String(p.h).padStart(5)} ${String(p.d).padStart(5)}  ` +
      `${p.x[0]}..${p.x[1]}`);
}
say("\n  » = this part's front face is AHEAD of the frontmost tooth, i.e. sticking out of the mouth.");
await rig.close();
