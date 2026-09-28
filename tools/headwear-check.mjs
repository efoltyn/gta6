#!/usr/bin/env node
/* tools/headwear-check.mjs — EVERY HAT SITS ON THE HEAD, in plain node.

   Loads the REAL entities/character.js + entities/headwear.js into a vm
   (three r128) and, for every kind x head form (m / f / child) x LOD:
     1. BUILDS: finite geometry, a sane triangle budget, the shell faces out.
     2. NO HEAD THROUGH THE HAT: no hat vertex is inside the skull, ears, neck
        or nose (the analytic head the hats are built on).
     3. SITS ON IT: round the band, every 1/16 of the way, the hat's lower
        edge comes within 6 mm (world, HUMAN_SCALE 0.70) of the REAL head
        (character.js's own head mesh + brows) — no floating gap.
        (Full-face moto / race helmets ride on cheek pads that are inside the
        shell and the hijab is a drape; they are exempt and say so.)
     4. HAIR UNDER IT: every hair style, built on a real rig, then the hat put
        on through CBZ.headwear.wear: no hair vertex the crown covers is
        outside the crown (no hair poking through), and taking the hat off
        restores the original hair.
     5. CHINSTRAPS hug the jaw: every strap vertex within 2 cm of the head.
     7. PENETRATION, on real rigs, triangle-exact: for every kind x variant x
        body (bearded long-haired man, long-haired woman, child, afro, bun,
        ponytail) x hat LOD x face LOD, a ray from the skull centre to EVERY
        vertex of the head, ears, nose, neck, brows, lids, lips, beard and hair
        must not cross a hat surface first: zero vertices poking through, near
        and far. (Straps are skin-side by design; hair falling OVER a strap is
        allowed, a beard through a chin cup is not.)
     6. THE RIG: c.cap builds the role hat into skinSlots.cap with the hair
        kept, c.hat comes off while swimming and the hair springs back, the
        LOD swap changes hat + hair geometry, owners stack (armor beats
        outfit) and headwear meshes are poolable (no vertex colours; only the
        riot shield is transparent).

     node tools/headwear-check.mjs [--verbose] [--only=kind,kind]
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
for (const f of ["src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js", "src/entities/heritage.js", "src/entities/headwear.js"]) {
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
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const KINDS = ONLY.length ? HW.kinds.filter((k) => ONLY.includes(k)) : HW.kinds;   // --only=ballcap,riot for a quick loop
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

/* An exact ray-vs-triangle test from the skull centre, with the triangles
   binned by direction (azimuth x elevation from HC) so a ray only tests the
   handful in its bin. Independent of headwear.js's own maps on purpose. */
const HCx = FIT.HC[0], HCy = FIT.HC[1], HCz = FIT.HC[2];
const BA = 96, BE = 48;
function dirBin(x, y, z) {
  const dx = x - HCx, dy = y - HCy, dz = z - HCz, r = Math.hypot(dx, dy, dz) || 1e-9;
  return [(Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI) * BA, (Math.asin(Math.max(-1, Math.min(1, dy / r))) + Math.PI / 2) / Math.PI * BE];
}
function TriIndex() {
  const T = [], bins = new Map();
  function add(a, b, c) {
    const id = T.length; T.push([a, b, c]);
    const cs = [dirBin(a[0], a[1], a[2]), dirBin(b[0], b[1], b[2]), dirBin(c[0], c[1], c[2])];
    let a0 = Math.min(cs[0][0], cs[1][0], cs[2][0]), a1 = Math.max(cs[0][0], cs[1][0], cs[2][0]);
    if (a1 - a0 > BA / 2) { const u = cs.map((q) => (q[0] < BA / 2 ? q[0] + BA : q[0])); a0 = Math.min(...u); a1 = Math.max(...u); }
    let e0 = Math.min(cs[0][1], cs[1][1], cs[2][1]), e1 = Math.max(cs[0][1], cs[1][1], cs[2][1]);
    if (a1 - a0 > BA / 2 || e1 > BE - 2 || e0 < 2) { a0 = 0; a1 = BA - 1; if (e0 + e1 > BE) e1 = BE - 1; else e0 = 0; }
    for (let j = Math.max(0, Math.floor(e0) - 1); j <= Math.min(BE - 1, Math.floor(e1) + 1); j++)
      for (let ii = Math.floor(a0) - 1; ii <= Math.floor(a1) + 1; ii++) {
        const k = j * BA + ((ii % BA) + BA) % BA;
        let L = bins.get(k); if (!L) bins.set(k, L = []);
        if (L[L.length - 1] !== id) L.push(id);
      }
  }
  function addMesh(g, M) {
    const p = g.attributes.position, ix = g.index, v = new T3.Vector3(), P = [];
    for (let i = 0; i < p.count; i++) { v.set(p.getX(i), p.getY(i), p.getZ(i)); if (M) v.applyMatrix4(M); P.push([v.x, v.y, v.z]); }
    const n = ix ? ix.count : p.count;
    for (let i = 0; i < n; i += 3) add(P[ix ? ix.getX(i) : i], P[ix ? ix.getX(i + 1) : i + 1], P[ix ? ix.getX(i + 2) : i + 2]);
  }
  // every hit distance along the unit ray d from HC
  function hits(d) {
    const c = dirBin(HCx + d[0], HCy + d[1], HCz + d[2]);
    const L = bins.get(Math.min(BE - 1, c[1] | 0) * BA + (Math.min(BA - 1, c[0] | 0)));
    const out = [];
    if (!L) return out;
    for (const id of L) {
      const [a, b, q] = T[id];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
      const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
      if (Math.abs(det) < 1e-12) continue;
      const tv = [HCx - a[0], HCy - a[1], HCz - a[2]];
      const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
      if (u < 0 || u > 1) continue;
      const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const w = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
      if (w < 0 || u + w > 1) continue;
      const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
      if (t > 1e-6) out.push(t);
    }
    return out;
  }
  return { addMesh, hits, get size() { return T.length; } };
}
const T3 = T;
// the REAL head a hat must meet (character.js's own meshes, in the hat frame):
// near + far skull (every nose), ears and neck, brows at rest
const REAL = {};
function realHead(form) {
  if (REAL[form]) return REAL[form];
  const X = TriIndex(), off = new T.Matrix4().makeTranslation(0, 0.3, 0);
  for (const far of [false, true]) for (let n = 0; n < 3; n++) X.addMesh(CBZ.human.geometry.head(form, n, far), off);
  X.addMesh(CBZ.human.geometry.brow(form, "n"), new T.Matrix4().makeTranslation(0, 0.448, 0.303));
  return (REAL[form] = X);
}

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
        // 2a. no hat vertex inside the REAL head (skull, ears, nose, neck, brows):
        // nothing of the head lies further out along the ray from the skull centre
        let worst = 0, worstRole = "";
        const RH2 = realHead(form);
        for (const role in entry.geos) {
          for (const v of verts(entry.geos[role])) {
            const dv = [v[0] - HCx, v[1] - HCy, v[2] - HCz], r = Math.hypot(dv[0], dv[1], dv[2]);
            let far = 0;
            for (const t of RH2.hits(norm(dv))) if (t > far) far = t;
            if (r - far < worst) { worst = r - far; worstRole = role; }
          }
        }
        check(worst > -0.0005, tag + " no hat vertex inside the real head (worst " + (worst * MM).toFixed(1) + " mm, " + worstRole + ")");
        if (lod) continue;
        const cov = entry.cover;
        // 3. contact round the band, against the REAL head
        if (cov && (cov.rim || cov.band) && !NO_CONTACT[kind]) {
          const cband = cov.rim || cov.band, RH = realHead(form);
          const bins = new Array(16).fill(Infinity);
          for (const role in entry.geos) {
            if (role === "strap" || role === "clear" || role === "tail") continue;
            for (const v of verts(entry.geos[role])) {
              const a = Math.atan2(v[0], v[2]), y = cband(a);
              if (Math.abs(v[1] - y) > 0.03) continue;
              const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 16) % 16;
              const dv = [v[0] - HCx, v[1] - HCy, v[2] - HCz], r = Math.hypot(dv[0], dv[1], dv[2]);
              const hs = RH.hits(norm(dv));
              if (!hs.length) continue;
              const d = r - Math.max.apply(null, hs);
              if (d < bins[b]) bins[b] = d;
            }
          }
          let gap = -Infinity, gb = 0;
          bins.forEach((g, i) => { if (isFinite(g) && g > gap) { gap = g; gb = i; } });
          check(gap * MM <= 6.0, tag + " sits within 6 mm of the real head all round the band (widest gap " + (gap * MM).toFixed(1) + " mm at " + Math.round((gb + 0.5) * 22.5 - 180) + " deg)");
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

// ---- 7: PENETRATION on real rigs, both LODs, triangle-exact
const PEN_BODIES = [
  ["bearded man, long hair, broad nose, full lips", { build: "m", hairStyle: "long", beard: "full", nose: 2, lips: true }],
  ["woman, long hair, narrow nose", { build: "f", hairStyle: "long", nose: 0 }],
  ["child", { build: "m", age: 8, hairStyle: "short" }],
  ["man, afro", { build: "m", hairStyle: "afro", beard: "goatee" }],
  ["woman, bun", { build: "f", hairStyle: "bun" }],
  ["woman, ponytail", { build: "f", hairStyle: "pony" }],
];
const PEN_TOL = 0.25 / MM;                 // a quarter millimetre of float noise
function underHat(o) { let n = o; while (n) { if (n.userData && n.userData.headwear) return true; n = n.parent; } return false; }
let penCases = 0;
for (const kind of KINDS) for (const variant of VARIANTS[kind] || [""]) for (const [bname, bo] of PEN_BODIES) {
  const rig = CBZ.makeCharacter(Object.assign({ skin: 0xc89070, hair: 0x2a1c12, torso: 0x334455, legs: 0x223344 }, bo));
  const grp = HW.wear(rig, kind, { owner: "outfit", variant });
  if (!grp) { check(false, kind + " on " + bname + " wears"); continue; }
  for (const hatLod of [1, 2]) for (const headNear of [true, false]) {
    rig.setHandLod(hatLod);
    CBZ.human.faceLod(rig, headNear);
    rig.group.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(grp.matrixWorld).invert();
    const shell = TriIndex(), straps = TriIndex();
    for (const m of grp.children) {
      if (!m.isMesh || !m.visible) continue;
      const role = m.userData.hatRole;
      if (role === "clear") continue;
      (role === "strap" ? straps : shell).addMesh(m.geometry, m.matrix);
    }
    const worst = {};
    rig.neck.traverse((o) => {
      if (!o.isMesh || underHat(o)) return;
      for (let n = o; n && n !== rig.neck; n = n.parent) if (!n.visible) return;
      const name = o.name || (o.userData.hairStyle ? "hair" : "?");
      if (!headNear && !(name === "head")) return;     // the far face tier changes the skull only
      const M = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld), p = o.geometry.attributes.position, v = new T.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(M);
        const dv = [v.x - HCx, v.y - HCy, v.z - HCz], r = Math.hypot(dv[0], dv[1], dv[2]);
        if (r < 1e-5) continue;
        const d = norm(dv);
        let t = Infinity;
        for (const h of shell.hits(d)) if (h < t) t = h;
        if (name === "beard") for (const h of straps.hits(d)) if (h < t) t = h;
        if (t < r - PEN_TOL && (!worst[name] || r - t > worst[name][0])) worst[name] = [r - t, v.x.toFixed(3) + "," + v.y.toFixed(3) + "," + v.z.toFixed(3)];
      }
    });
    penCases++;
    const bad = Object.keys(worst).map((k) => k + " " + (worst[k][0] * MM).toFixed(1) + " mm" + (VERBOSE ? " at " + worst[k][1] : ""));
    check(!bad.length, kind + (variant ? ":" + variant : "") + " on " + bname + " (hat " + (hatLod === 2 ? "far" : "near") + ", face " + (headNear ? "near" : "far") + "): nothing through the hat" + (bad.length ? " (" + bad.join(", ") + ")" : ""));
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
      if (!hair.visible) { hairPairs++; continue; }     // a durag / hijab takes long hair away entirely
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
console.log("headwear-check: " + (checks - fails) + "/" + checks + " passed (" + KINDS.length + " kinds, " + hairPairs + " hair x hat fits, " + penCases + " penetration cases)" + (fails ? "  FAIL" : "  PASS"));
for (const k in NO_CONTACT) if (VERBOSE) console.log("  exempt from band contact: " + k + " — " + NO_CONTACT[k]);
process.exit(fails ? 1 : 0);
