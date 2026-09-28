#!/usr/bin/env node
/* tools/headwear-check.mjs — EVERY HAT SITS ON THE HEAD, in plain node.

   Loads the REAL entities/character.js + entities/headwear.js into a vm
   (three r128) and, for every kind x head form (m / f / child) x LOD:
     1. BUILDS: finite geometry, a sane triangle budget, the shell faces out.
     2. NO HEAD THROUGH THE HAT: no hat vertex is inside the skull, ears, neck
        or nose (the analytic head the hats are fitted to), and every REAL
        head-mesh vertex under a crown is inside the crown (a ray from the
        skull centre meets the hat after the scalp).
     3. SITS ON IT: round the band, every 1/16 of the way, the hat comes
        within 5 mm (world, HUMAN_SCALE 0.70) of the scalp — no floating gap.
        (Full-face moto / race helmets ride on cheek pads that are inside the
        shell and the hijab is a drape; they are exempt and say so.)
     4. HAIR UNDER IT: every hair style, built on a real rig, then the hat put
        on through CBZ.headwear.wear: no hair vertex the crown covers is
        outside the crown (no hair poking through), and taking the hat off
        restores the original hair.
     5. CHINSTRAPS hug the jaw: every strap vertex within 2 cm of the head.
     6. THE RIG: c.cap builds the role hat into skinSlots.cap with the hair
        kept, c.hat comes off while swimming and the hair springs back, the
        LOD swap changes hat + hair geometry, owners stack (armor beats
        outfit) and headwear meshes are poolable (no vertex colours; only the
        riot shield is transparent).

     node tools/headwear-check.mjs [--verbose]
*/
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const VERBOSE = process.argv.includes("--verbose");
const ctx = vm.createContext({ console, Math, Map, Set, WeakMap, Float32Array, Float64Array, Int32Array, Uint16Array, Uint32Array });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {} };
vm.runInContext(read("src/vendor/three.r128.min.js"), ctx, { filename: "three" });
vm.runInContext(`
  (function(){
    const gc = new Map(), mc = new Map();
    CBZ.mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    CBZ.cmat = (c, o) => { const k = c + "|" + JSON.stringify(o || {}); let m = mc.get(k); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); m._shared = true; mc.set(k, m); } return m; };
    CBZ.pbrMat = (c, o) => { const k = "p" + c + "|" + JSON.stringify(o || {}); let m = mc.get(k); if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: (o && o.roughness) || 0.8 }); m._shared = true; mc.set(k, m); } return m; };
    CBZ.boxGeom = (w, h, d) => { const k = w + "," + h + "," + d; let g = gc.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); g._shared = true; gc.set(k, g); } return g; };
  })();`, ctx);
for (const f of ["src/systems/fphands.js", "src/entities/character.js", "src/entities/heritage.js", "src/entities/headwear.js"]) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { if (!f.includes("fphands")) throw e; }
}
const { THREE: T, CBZ } = ctx;
const HW = CBZ.headwear, FIT = HW._fit;
let fails = 0, checks = 0;
const seen = new Map();
function check(ok, msg) {
  checks++;
  if (ok) return;
  fails++;
  const k = msg.replace(/[-\d.]+/g, "#");
  const n = (seen.get(k) || 0) + 1; seen.set(k, n);
  if (n === 1 || VERBOSE) console.log("  FAIL " + msg);
}
const MM = 0.7 * 1000;                     // unit (adult head frame) -> mm, HUMAN_SCALE 0.70
const FORMS = ["m", "f", "c"];
const KINDS = HW.kinds;
const VARIANTS = { ballcap: ["", "back"], peaked: ["police", "captain", "chauffeur"], shemagh: ["", "agal", "veil"], beret: ["", "plain"], campaign: ["", "sheriff"], ballistic: ["", "swat"] };
const NO_CONTACT = { moto: "rides on cheek pads inside the shell", race: "rides on cheek pads inside the shell", hijab: "a drape, not a band" };
const HAS_STRAP = { ballistic: 1, pasgt: 1 };

// ---- the analytic head (skull + ears + neck + nose) the hats must clear
function headAll(form) { return FIT.Head(form, { ears: true, neck: true, nose: true }); }
function verts(g) { const p = g.attributes.position, out = []; for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]); return out; }
function hatMeshes(entry) {
  const ms = [];
  for (const role in entry.geos) {
    if (role === "clear") continue;
    const m = new T.Mesh(entry.geos[role], new T.MeshBasicMaterial({ side: T.DoubleSide }));
    m.userData.role = role; m.updateMatrixWorld(true); ms.push(m);
  }
  return ms;
}
const ray = new T.Raycaster();
function hatDist(ms, dir) {
  ray.set(new T.Vector3(FIT.HC[0], FIT.HC[1], FIT.HC[2]), new T.Vector3(dir[0], dir[1], dir[2]));
  let best = Infinity;
  for (const m of ms) { if (m.userData.role === "strap") continue; const h = ray.intersectObject(m, false); for (const x of h) if (x.distance < best) best = x.distance; }
  return best;
}
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ---- 1-3, 5: geometry, fit, contact, straps
const report = [];
for (const kind of KINDS) {
  for (const variant of VARIANTS[kind] || [""]) {
    for (const form of FORMS) {
      for (const lod of [0, 1]) {
        const tag = kind + (variant ? ":" + variant : "") + "/" + form + (lod ? "/far" : "");
        let entry;
        try { entry = HW.geometry(kind, form, variant, lod); } catch (e) { check(false, tag + " threw " + e.message); continue; }
        check(!!entry && Object.keys(entry.geos).length > 0, tag + " builds");
        if (!entry) continue;
        let tris = 0, finite = true;
        for (const role in entry.geos) {
          const g = entry.geos[role];
          tris += g.index.count / 3;
          const a = g.attributes.position.array; for (let i = 0; i < a.length; i++) if (!isFinite(a[i])) { finite = false; break; }
          check(!g.attributes.color, tag + " " + role + " has no vertex colours (poolable)");
        }
        check(finite, tag + " finite");
        check(tris < (lod ? 2600 : 7000), tag + " triangle budget (" + tris + ")");
        if (!lod && form === "m") report.push([tag, tris]);
        // the main shell faces out: area-weighted normals point away from the head centre
        const gm = entry.geos.main;
        if (gm && kind !== "hijab" && kind !== "headband") {
          const p = gm.attributes.position, n = gm.attributes.normal; let out = 0, tot = 0;
          for (let i = 0; i < p.count; i++) { const d = [p.getX(i) - 0, p.getY(i) - 0.3, p.getZ(i)]; const s = d[0] * n.getX(i) + d[1] * n.getY(i) + d[2] * n.getZ(i); tot++; if (s > 0) out++; }
          check(out / tot > 0.6, tag + " main shell faces outward (" + (out / tot).toFixed(2) + ")");
        }
        const H = headAll(form);
        // 2a. no hat vertex inside the head
        let worst = 0, worstRole = "";
        for (const role in entry.geos) {
          for (const v of verts(entry.geos[role])) { const d = H.sdf(v[0], v[1], v[2]); if (d < worst) { worst = d; worstRole = role; } }
        }
        check(worst > -0.0015, tag + " no hat vertex inside the head (worst " + (worst * MM).toFixed(1) + " mm, " + worstRole + ")");
        if (lod) continue;
        const ms = hatMeshes(entry), cov = entry.cover;
        // 2b. real head-mesh vertices under the crown are inside the crown
        if (cov && cov.band) {
          const hg = CBZ.human.geometry.head(form, 1, false), hp = hg.attributes.position;
          let out = 0, n = 0;
          for (let i = 0; i < hp.count; i += 3) {
            const v = [hp.getX(i), hp.getY(i) + 0.3, hp.getZ(i)];
            const a = Math.atan2(v[0], v[2]);
            if (v[1] < (cov.rim || cov.band)(a) + 0.02) continue;
            const d = [v[0] - FIT.HC[0], v[1] - FIT.HC[1], v[2] - FIT.HC[2]], r = Math.hypot(d[0], d[1], d[2]);
            n++;
            if (hatDist(ms, norm(d)) < r - 0.0005) out++;
          }
          check(out === 0, tag + " real skull stays inside the crown (" + out + "/" + n + " vertices poke out)");
        }
        // 3. contact round the band
        if (cov && (cov.rim || cov.band) && !NO_CONTACT[kind]) {
          const cband = cov.rim || cov.band;
          const bins = new Array(16).fill(Infinity);
          for (const role in entry.geos) {
            if (role === "strap" || role === "clear") continue;
            for (const v of verts(entry.geos[role])) {
              const a = Math.atan2(v[0], v[2]), y = cband(a);
              if (Math.abs(v[1] - y) > 0.03) continue;
              const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 16) % 16;
              const d = H.sdf(v[0], v[1], v[2]);
              if (d < bins[b]) bins[b] = d;
            }
          }
          const gap = Math.max.apply(null, bins);
          check(gap * MM <= 5.0, tag + " sits within 5 mm of the scalp all round the band (widest gap " + (gap * MM).toFixed(1) + " mm)");
        }
        // 5. chinstraps
        if (HAS_STRAP[kind] && entry.geos.strap) {
          let far = 0;
          for (const v of verts(entry.geos.strap)) far = Math.max(far, H.sdf(v[0], v[1], v[2]));
          check(far * MM <= 20, tag + " chinstrap hugs the jaw (farthest " + (far * MM).toFixed(1) + " mm)");
        }
      }
    }
  }
}

// ---- 4 + 6: on real rigs
const styles = CBZ.human.hairStyles();
const CROWN = KINDS.filter((k) => k !== "headband" && k !== "hijab");
function rigOf(o) { const r = CBZ.makeCharacter(Object.assign({ skin: 0xc89070, hair: 0x2a1c12, torso: 0x334455, legs: 0x223344 }, o)); r.group.updateMatrixWorld(true); return r; }
let hairPairs = 0;
for (const build of ["m", "f"]) {
  for (const style of styles) {
    const rig = rigOf({ build, hairStyle: style });
    const hair = rig.skinSlots.hair[0];
    check(!!hair, build + "/" + style + " has hair");
    if (!hair) continue;
    const g0 = hair.geometry;
    const k = rig.profile.headSize / 0.6, form = rig.headForm;
    for (const kind of CROWN) {
      const grp = HW.wear(rig, kind, { owner: "outfit" });
      check(!!grp, build + "/" + style + " wears " + kind);
      const entry = HW.geometry(kind, form, "", 0), cov = entry.cover, ms = hatMeshes(entry);
      const hp = hair.geometry.attributes.position;
      let out = 0, n = 0, worst = 0, wv = null;
      for (let i = 0; i < hp.count; i += 2) {
        const v = [hp.getX(i) / k, hp.getY(i) / k, hp.getZ(i) / k];
        const a = Math.atan2(v[0], v[2]);
        if (v[1] < (cov.rim || cov.band)(a) + 0.02) continue;
        const d = [v[0] - FIT.HC[0], v[1] - FIT.HC[1], v[2] - FIT.HC[2]], r = Math.hypot(d[0], d[1], d[2]);
        const hd = hatDist(ms, norm(d));
        n++;
        if (hd < r - 0.001) { out++; if (r - hd > worst) { worst = r - hd; wv = v.map((x) => x.toFixed(3)).join(","); } }
      }
      hairPairs++;
      check(out === 0, build + "/" + style + " under " + kind + ": no hair through the crown (" + out + "/" + n + ", worst " + (worst * MM).toFixed(1) + " mm" + (VERBOSE && wv ? " at " + wv : "") + ")");
    }
    HW.wear(rig, null, { owner: "outfit" });
    check(hair.geometry === g0, build + "/" + style + " hat off restores the hair");
  }
}
{
  const cop = rigOf({ cap: 0x1b2233, capKind: "peaked:police", build: "f", longHair: true });
  check(cop.skinSlots.cap.length >= 3, "c.cap fills skinSlots.cap with the role hat (" + cop.skinSlots.cap.length + " meshes)");
  check(cop.skinSlots.hair.length === 1 && cop.skinSlots.hair[0].visible, "a capped rig keeps its hair");
  check(HW.worn(cop) === "peaked", "c.cap worn is the peaked cap");
  let tr = 0; cop.skinSlots.cap.forEach((m) => { if (m.material.transparent) tr++; if (m.geometry.attributes.color) tr++; });
  check(tr === 0, "role hat meshes are poolable (opaque, no vertex colours)");
  HW.wear(cop, "ballistic", { owner: "armor" });
  const outfitGrp = cop.neck.children.find((c) => c.name === "headwear-peaked");
  const armorGrp = cop.neck.children.find((c) => c.name === "headwear-ballistic");
  check(outfitGrp && !outfitGrp.visible && armorGrp && armorGrp.visible, "armor helmet beats the outfit cap (one hat drawn)");
  HW.wear(cop, null, { owner: "armor" });
  check(outfitGrp.visible, "helmet off, the cap is back");
  const hairG = cop.skinSlots.hair[0].geometry, hatG = cop.skinSlots.cap[0].geometry;
  cop.setHandLod(2);
  check(cop.skinSlots.hair[0].geometry !== hairG && cop.skinSlots.cap[0].geometry !== hatG, "far LOD swaps hat and compressed hair");
  cop.setHandLod(1);
  check(cop.skinSlots.hair[0].geometry === hairG && cop.skinSlots.cap[0].geometry === hatG, "near LOD swaps them back");

  const bather = rigOf({ hat: "sun", hatColor: 0xe6d3a3, build: "f", longHair: true });
  const bh = bather.skinSlots.hair[0], g1 = bh.geometry;
  const grp = bather.neck.children.find((c) => c.name === "headwear-sun");
  check(grp && grp.visible, "c.hat 'sun' builds the sun hat");
  bather.swimming = true;
  check(!grp.visible && bh.geometry !== g1, "swimming: the hat comes off and the hair springs back");
  bather.swimming = false;
  check(grp.visible && bh.geometry === g1, "out of the water: the hat is back on");
  const capper = rigOf({ hat: "cap", hatColor: 0xc02828 });
  check(!!capper.neck.children.find((c) => c.name === "headwear-ballcap"), "c.hat 'cap' builds the ball cap");
  const kid = rigOf({ cap: 0xe8c020, capKind: "hardhat", age: 8 });
  const kg = kid.neck.children.find((c) => c.name === "headwear-hardhat");
  check(kg && Math.abs(kg.scale.x - kid.profile.headSize / 0.6) < 1e-6, "a child's hat is scaled to the child's head");
  const hj = rigOf({ build: "f", longHair: true });
  HW.wear(hj, "hijab", { owner: "outfit" });
  check(!hj.skinSlots.hair[0].visible, "a hijab covers all the hair");
  HW.wear(hj, null, { owner: "outfit" });
  check(hj.skinSlots.hair[0].visible, "hijab off, the hair shows");
}

if (VERBOSE) for (const [t, n] of report) console.log("  " + t.padEnd(26) + n + " tris");
console.log("headwear-check: " + (checks - fails) + "/" + checks + " passed (" + KINDS.length + " kinds, " + hairPairs + " hair x hat fits)" + (fails ? "  FAIL" : "  PASS"));
for (const k in NO_CONTACT) if (VERBOSE) console.log("  exempt from band contact: " + k + " — " + NO_CONTACT[k]);
process.exit(fails ? 1 : 0);
