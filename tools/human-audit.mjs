#!/usr/bin/env node
/* tools/human-audit.mjs — EVERY PERSON HAS A WHOLE BODY, in plain node.

   Owner: "Some female characters (female security) have an INVISIBLE BODY:
   hands but no shirt or pants."

   No browser. This loads the REAL rig + wardrobe code into a vm context
   (three r128, world/materials.js, entities/character.js, entities/heritage.js,
   city/clothes.js, city/outfits.js, city/armor.js, systems/prisonoutfits.js,
   entities/pedinstance.js) with a small software 2D canvas
   (tools/lib/fake-canvas.mjs) so the painted garment atlases are REAL pixels,
   then builds

       sex (m/f) x heritage (entities/heritage.js) x age band
         x outfit (every city/outfits.js CAT row, every suit style, every
                   clothes.js composable, the prison fits, the protection
                   detail's police/suit, the plain civvie)

   through the real makeCharacter + the real dresser (CBZ.cityRecolorRig) —
   once on a FRESH rig and once CHAINED on a single rig per body (outfit
   transitions are where state goes stale) — plus the real spawn casting
   (peds.js's makeCharacter shape + CBZ.cityOutfitFor for a list of jobs).

   For every body region (head, chest, waist if present, yoke, pelvis, upper
   and lower arms, hands, upper and lower legs, shoes) it asserts the mesh is
   visible, attached to the rig, has non-degenerate finite geometry and a
   non-collapsed world matrix, holds a material that can draw, and — for
   alphaTest atlas materials — that EVERY face's UV rect samples OPAQUE texels
   of the atlas it is wearing (a face that samples a cut region is discarded
   by the GPU: that is a hole in a person). Then it runs the real
   pedinstance.js tick over a crowd of the same bodies and asserts every part
   it moved to the hide layer is carried by a live pool instance whose
   geometry samples the same UVs; re-dresses the crowd while it is instanced;
   and runs 24 live frames (animChar + the instancer + core/matrixskip.js's
   render-time skip) asserting every part is DRAWN where the rig says it is
   and that no body is SPLIT between pooled parts and self-drawn parts — the
   split is what produced the owner's "hands but no shirt or pants" (see
   entities/pedinstance.js placeRig). Before that fix: 509 of 540 crowd
   bodies split (every woman). After: 0.

   Not covered: src/warlord/outfits.js (it needs the warlord module runtime;
   it dresses through the same clothes.js atlas and character.js rig).

     node tools/human-audit.mjs            table of failures + PASS/FAIL total
     node tools/human-audit.mjs --verbose  every failing mesh, not just a summary
   Exit 0 = every body whole. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument, FakeCanvas } from "./lib/fake-canvas.mjs";

// HUMAN_AUDIT_SRC=/path/to/checkout/ audits another tree's sources (e.g. a `git archive` of HEAD)
const ROOT = process.env.HUMAN_AUDIT_SRC ? new URL("file://" + process.env.HUMAN_AUDIT_SRC.replace(/\/?$/, "/")) : new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const VERBOSE = process.argv.includes("--verbose");
const t0 = Date.now();

// ---------------------------------------------------------------- the world
const ctx = vm.createContext({ console, Math, setTimeout, clearTimeout, performance });
ctx.window = ctx; ctx.self = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
ctx.addEventListener = () => {}; ctx.requestAnimationFrame = () => 0;
const always = [];
ctx.CBZ = {
  CONFIG: {}, game: { mode: "city" }, npcs: [],
  onUpdate() {}, onAlways(p, f) { always.push([p, f]); }, onReset() {}, onModeEnter() {},
};
// INK (entities/tattoo.js): every heritage's ink family is worn, so the audit
// also proves inked skin (shared ink materials, charts paged by pedinstance)
// keeps every body whole. Charts "paint" into a no-op 2D context (the audit
// is about geometry and pools, not pixels), synchronously.
function inkCanvas(w, h) {
  const cv = { width: w, height: h, style: {} };
  const grad = { addColorStop() {} };
  const t = { canvas: cv, measureText: (s) => ({ width: String(s).length * 20 }), createRadialGradient: () => grad,
    createLinearGradient: () => grad, createPattern: () => ({}), getImageData: (x, y, W, H) => ({ data: new Uint8ClampedArray(Math.max(1, W * H) * 4).fill(255) }) };   // a skin chart reads back opaque (pedinstance pages refuse a blank source)
  const c2 = new Proxy(t, { get(o, k) { return k in o ? o[k] : function () {}; }, set(o, k, v) { o[k] = v; return true; } });
  cv.getContext = () => c2;
  return cv;
}
ctx.CBZ.tattoo = { lazy: false, _mkCanvas: inkCanvas };
for (const f of ["src/vendor/three.r128.min.js", "src/config.js", "src/core/matrixskip.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/tattoo.js", "src/entities/footwear.js", "src/entities/character.js", "src/entities/headwear.js",
  "src/entities/heritage.js", "src/city/clothes.js", "src/city/outfits.js", "src/entities/dutykit.js", "src/entities/pedinstance.js",
  "src/city/armor.js", "src/systems/prisonoutfits.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE, CBZ } = ctx;
for (const need of ["makeCharacter", "cityRecolorRig", "cityOutfitCatalog", "cityOutfitFor", "HERITAGE_IDS", "heritageRoll", "cityComposableSpec"]) {
  if (!CBZ[need]) { console.error("FAIL harness: CBZ." + need + " missing"); process.exit(2); }
}

// ---------------------------------------------------------------- the checks
const REGIONS = [
  ["head", (s) => s.head],
  ["chest", (s) => s.torso && [s.torso[0]]],
  ["waist", (s) => s.torso && s.torso.length > 1 ? [s.torso[1]] : []],
  ["yoke", (s) => s.collar],
  ["pelvis", (s) => s.pelvis],
  ["armUp", (s) => s.arms],
  ["armLo", (s) => s.armsLower],
  ["hands", (s) => s.hands],
  ["legUp", (s) => s.legs],
  ["legLo", (s) => s.legsLower],
  ["shoes", (s) => s.shoes],
];
const MUST = { head: 2 - 1, chest: 1, yoke: 1, pelvis: 1, armUp: 2, armLo: 2, hands: 2, legUp: 2, legLo: 2, shoes: 2 };
const _m = new THREE.Matrix4();

function attached(mesh, root) {
  for (let n = mesh; n; n = n.parent) {
    if (n.visible === false) return "hidden:" + (n === mesh ? "mesh" : (n.name || n.type));
    if (n === root) return null;
  }
  return "detached";
}
function geomProblem(g) {
  if (!g || !g.attributes || !g.attributes.position) return "no-geometry";
  const pos = g.attributes.position;
  if (!(pos.count > 0)) return "empty-geometry";
  const a = pos.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return "nan-geometry";
  g.computeBoundingBox();
  const b = g.boundingBox;
  const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z;
  if (!(dx > 1e-4 && dy > 1e-4 && dz > 1e-4)) return "degenerate-box(" + [dx, dy, dz].map((v) => v.toFixed(3)).join("x") + ")";
  // A BOX DRAWN INSIDE-OUT IS INVISIBLE from outside (FrontSide culls every
  // face). For a box geometry every triangle's winding normal must point away
  // from the box centre.
  if (g.type === "BoxGeometry") {
    const idx = g.index ? g.index.array : null, n = idx ? idx.length : pos.count;
    const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
    let inv = 0;
    for (let t = 0; t < n; t += 3) {
      const i0 = idx ? idx[t] : t, i1 = idx ? idx[t + 1] : t + 1, i2 = idx ? idx[t + 2] : t + 2;
      const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
      const ux = pos.getX(i1) - ax, uy = pos.getY(i1) - ay, uz = pos.getZ(i1) - az;
      const vx = pos.getX(i2) - ax, vy = pos.getY(i2) - ay, vz = pos.getZ(i2) - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (ax + pos.getX(i1) + pos.getX(i2)) / 3 - cx, my = (ay + pos.getY(i1) + pos.getY(i2)) / 3 - cy, mz = (az + pos.getZ(i1) + pos.getZ(i2)) / 3 - cz;
      if (nx * mx + ny * my + nz * mz < 0) inv++;
    }
    if (inv) return "inside-out(" + inv + " tris)";
  }
  return null;
}
function matProblem(m) {
  if (!m) return "no-material";
  if (Array.isArray(m)) return null;
  if (m.visible === false) return "material-invisible";
  if (m.colorWrite === false) return "colorWrite-off";
  if (m.transparent && !(m.opacity > 0.02)) return "opacity-zero";
  if (m.map) {
    if (m.map._cbzDead) return "dead-map";
    const img = m.map.image;
    if (!img || !(img.width > 0) || !(img.height > 0)) return "map-without-image";
  }
  return null;
}
// every face of the box must sample opaque texels under alphaTest
function alphaProblem(mesh) {
  const m = mesh.material, g = mesh.geometry;
  if (!m || Array.isArray(m) || !m.map || !(m.alphaTest > 0)) return null;
  const img = m.map.image;
  if (!(img instanceof FakeCanvas)) return null;
  const uv = g.attributes.uv;
  if (!uv) return "atlas-without-uv";
  const idx = g.index ? g.index.array : null;
  const tri = idx ? idx.length / 3 : uv.count / 3;
  const flip = m.map.flipY !== false;
  const W = img.width, H = img.height, op = m.opacity != null ? m.opacity : 1;
  let worst = 1, worstFace = -1;
  const faces = new Map();                                 // group (face) -> [cut, total]
  const groups = g.groups && g.groups.length ? g.groups : [{ start: 0, count: tri * 3 }];
  for (let gi = 0; gi < groups.length; gi++) {
    let cut = 0, tot = 0;
    for (let t = groups[gi].start / 3; t < (groups[gi].start + groups[gi].count) / 3; t++) {
      const v = [0, 1, 2].map((k) => (idx ? idx[t * 3 + k] : t * 3 + k));
      const U = v.map((i) => uv.getX(i)), V = v.map((i) => uv.getY(i));
      // barycentric grid over the triangle, inset off the edges
      const N = 6;
      for (let a = 0; a <= N; a++) for (let b = 0; b <= N - a; b++) {
        let wa = (a + 0.34) / (N + 1.02), wb = (b + 0.34) / (N + 1.02), wc = 1 - wa - wb;
        if (wc <= 0) continue;
        const u = wa * U[0] + wb * U[1] + wc * U[2], vv = wa * V[0] + wb * V[1] + wc * V[2];
        const px = Math.floor(u * W), py = Math.floor((flip ? 1 - vv : vv) * H);
        tot++;
        if (img.alphaAt(px, py) / 255 * op < m.alphaTest) cut++;
      }
    }
    const ok = tot ? 1 - cut / tot : 1;
    faces.set(gi, ok);
    if (ok < worst) { worst = ok; worstFace = gi; }
  }
  if (worst < 1) return "atlas-cut(face " + worstFace + " " + Math.round(worst * 100) + "% opaque)";
  return null;
}
function meshProblems(mesh, root) {
  const out = [];
  if (!mesh) return ["missing"];
  const at = attached(mesh, root); if (at) out.push(at);
  const gp = geomProblem(mesh.geometry); if (gp) out.push(gp);
  const mp = matProblem(mesh.material); if (mp) out.push(mp);
  if (!gp && !mp) { const ap = alphaProblem(mesh); if (ap) out.push(ap); }
  mesh.updateWorldMatrix(true, false);
  if (Math.abs(mesh.matrixWorld.determinant()) < 1e-9) out.push("collapsed-scale");
  if (!(mesh.layers.mask & 1)) {
    const d = CBZ.pedInstanceDraws ? CBZ.pedInstanceDraws(mesh) : null;
    if (d !== true) out.push("off-camera-layer(mask " + mesh.layers.mask + ", pool " + d + ")");
  }
  return out;
}

const failures = [];          // {case, region, problem}
let bodies = 0, meshesChecked = 0;
function auditRig(ch, label) {
  bodies++;
  const s = ch.skinSlots;
  ch.group.updateMatrixWorld(true);
  for (const [name, get] of REGIONS) {
    const list = (get(s) || []).filter(Boolean);
    if (MUST[name] && list.length < MUST[name]) failures.push({ label, region: name, problem: "slot has " + list.length + " mesh(es)" });
    for (const m of list) {
      meshesChecked++;
      for (const p of meshProblems(m, ch.group)) failures.push({ label, region: name, problem: p });
    }
  }
  // a visible jacket shell is a garment too: it may have cuts (open front) but must draw
  const jm = ch._jacketMesh;
  if (jm && jm.visible) {
    const gp = geomProblem(jm.geometry), mp = matProblem(jm.material);
    if (gp || mp) failures.push({ label, region: "jacket", problem: gp || mp });
  }
}

// ---------------------------------------------------------------- the people
const HERITAGES = CBZ.HERITAGE_IDS.slice();
const AGES = [null, 15, 11, 7, 3];                    // adult + every child band that dresses adult-ish
const SEXES = ["m", "f"];
function bodyLook(sex, her, age, i) {
  const look = CBZ.heritageRoll(her, "audit|" + sex + "|" + her + "|" + age + "|" + i);
  return {
    legs: 0x39414f, torso: 0x8a939c, collar: 0x8a939c, arms: 0x8a939c,
    skin: look.skin, hair: look.bald ? look.skin : look.hair, hairStyle: look.hairStyle,
    beard: sex === "m" ? look.beard : null, shoes: 0x2b2b2b,
    build: sex, longHair: sex === "f", age: age, shortSleeve: (i & 1) === 1,
    _look: look,
  };
}
function build(spec) {
  const ch = CBZ.makeCharacter(spec);
  if (CBZ.heritageApply) CBZ.heritageApply(ch, spec._look);
  return ch;
}

// outfits: the catalog, every suit style, every composable, the prison fits
const CAT = CBZ.cityOutfitCatalog();
const OUTFITS = [["plain", null]];
for (const id of Object.keys(CAT)) OUTFITS.push(["cat:" + id, CAT[id]]);
const nSuit = CBZ.citySuitStyles ? CBZ.citySuitStyles.length : 0;
for (let i = 0; i < nSuit; i++) OUTFITS.push(["suit|" + i, Object.assign({}, CAT.suit, { style: i })]);
{
  // composables: every id clothes.js answers for, found by asking it
  const src = read("src/city/clothes.js");
  const cand = new Set();
  for (const m of src.matchAll(/COMP(?:\.|\[")(\w+)/g)) cand.add(m[1]);
  for (const m of src.matchAll(/paintedLook\("(\w+)"/g)) cand.add(m[1]);
  const COLORS = ["navy", "charcoal", "burgundy", "forest", "white", "black", "red", "silver", "royal", "pink", "tan"];
  for (const c of COLORS) for (const p of ["blazer_", "tie_", "shirt_"]) { cand.add(p + c); cand.add(p + c + "_collar"); }
  for (let i = 0; i < nSuit; i++) cand.add("suit_" + i);
  for (const m of src.matchAll(/\["(\w+)", 0x[0-9a-f]+, "[^"]+"\]/g)) cand.add(m[1]);
  const ids = [...cand].filter((id) => CBZ.cityComposableSpec(id));
  for (const id of ids) OUTFITS.push(["comp:" + id, { id: "comp-" + id, colors: { torso: 0xf2f2f2, legs: 0x39414f }, composite: { shirt: 0xf2f2f2, legs: 0x39414f, items: [id] } }]);
  // the business stack the wardrobe actually casts: shirt + blazer + tie
  OUTFITS.push(["comp:biz", { id: "comp-biz", colors: { torso: 0xf2f2f2, legs: 0x2a2d34 }, composite: { shirt: 0xf2f2f2, legs: 0x2a2d34, items: ["shirt_white_collar", "blazer_navy", "tie_burgundy"] } }]);
}
// the SWAT the prison wears (its own unmarked painter)
if (CAT.swat) OUTFITS.push(["prison:swat_unmarked", Object.assign({}, CAT.swat, { id: "swat_unmarked" })]);

function dress(ch, rec) {
  if (!rec) {
    // the PLAIN path: strip, then flat-tint (exactly clothes.js's composite plain base)
    CBZ.cityRecolorRig(ch, { torso: 0x8a939c, arms: 0x8a939c, legs: 0x39414f, collar: 0x8a939c, shoes: 0x2b2b2b }, { id: "street", colors: {} });
    return;
  }
  CBZ.cityRecolorRig(ch, rec.colors || {}, rec);
}

// 1) every outfit on a fresh rig, every body
let combos = 0;
for (const sex of SEXES) for (const her of HERITAGES) for (const age of AGES) {
  const chain = build(bodyLook(sex, her, age, 0));
  for (let oi = 0; oi < OUTFITS.length; oi++) {
    const [oid, rec] = OUTFITS[oi];
    // fresh rigs for adults only (children get the chain) — keeps the run short
    if (age == null) {
      const ch = build(bodyLook(sex, her, age, oi));
      dress(ch, rec);
      auditRig(ch, "fresh " + sex + " " + her + " " + oid);
      combos++;
    }
    dress(chain, rec);
    auditRig(chain, "chain " + sex + " " + her + " " + (age == null ? "adult" : "age" + age) + " " + oid);
    combos++;
  }
}

// 2) the SPAWN path — peds.js's rig shape + the real caster, per job/archetype
const ROLES = [
  { job: "security guard", archetype: "security" }, { job: "secret service", archetype: "security" },
  { job: "uniformed division officer", archetype: "security" }, { job: "counter-sniper", archetype: "security" },
  { job: "bouncer" }, { job: "police officer", cop: true }, { kind: "cop", cop: true, swat: true },
  { job: "nurse" }, { job: "doctor" }, { job: "banker" }, { job: "lawyer" }, { job: "construction worker" },
  { job: "chef" }, { job: "waiter" }, { job: "pilot" }, { job: "janitor" }, { job: "firefighter" },
  { job: "soldier" }, { job: "vendor", vendor: true }, { archetype: "socialite" }, { archetype: "tycoon" },
  { archetype: "mobster" }, { archetype: "dealer" }, { archetype: "nightlife" }, { archetype: "vagrant" },
  { archetype: "resident" }, { archetype: "office" },
];
const crowd = [];
for (const sex of SEXES) for (const her of HERITAGES) for (let ri = 0; ri < ROLES.length; ri++) {
  const role = ROLES[ri];
  const spec = bodyLook(sex, her, null, ri);
  const ch = build(spec);
  const seed = (ri * 7919 + HERITAGES.indexOf(her) * 131 + (sex === "f" ? 1 : 0)) | 0;
  const fit = CBZ.cityOutfitFor(Object.assign({ seed, sex, band: "adult", rng: Math.random }, role));
  if (fit && fit.colors) CBZ.cityRecolorRig(ch, fit.colors, fit);
  // the protection detail's own re-dress on top (protection.js dressAs)
  if (/secret service/.test(role.job || "")) CBZ.cityRecolorRig(ch, CAT.suit.colors, CAT.suit);
  if (/uniformed division/.test(role.job || "")) CBZ.cityRecolorRig(ch, CAT.police.colors, CAT.police);
  ch._auditLabel = sex + " " + her + " " + (role.job || role.archetype || role.kind);
  auditRig(ch, "spawn " + ch._auditLabel + " -> " + (fit ? fit.id : "plain"));
  combos++;
  crowd.push(ch);
}

// 3) PEDINSTANCE — the real per-frame pass over that crowd, several frames
{
  // config.js installs the real registrar (CBZ.always = [{order, fn}]); the stub above is the fallback
  const reg = (CBZ.always || []).map((a) => [a.order, a.fn]).concat(always);
  const tick = reg.find((a) => a[0] === 96 && /PED_INSTANCED/.test(String(a[1])));
  if (!tick) failures.push({ label: "pedinstance", region: "-", problem: "tick not registered" });
  else {
    CBZ.scene = new THREE.Scene();
    const root = new THREE.Group(); CBZ.scene.add(root);
    CBZ.cityPeds = crowd.map((ch, i) => { ch.group.position.set((i % 20) * 2, 0, ((i / 20) | 0) * 2); root.add(ch.group); return { group: ch.group, char: ch }; });
    CBZ.cityCops = [];
    for (let f = 0; f < 4; f++) tick[1](1 / 60);
    const audit = CBZ.pedInstanceAudit ? CBZ.pedInstanceAudit() : null;
    let hidden = 0, pagedPixelsOk = 0;
    const pagedChecked = new Set();
    for (const p of CBZ.cityPeds) {
      const ch = p.char;
      ch.group.traverse((o) => {
        if (!o.isMesh || o.layers.mask !== (1 << 30)) return;
        hidden++;
        const d = CBZ.pedInstanceDraws(o);
        if (d !== true) { failures.push({ label: "pedinstance " + (o.name || o.userData._cbzPart || "part"), region: "pool", problem: "hidden without a live instance (" + d + ")" }); return; }
        const rec = o._pinst, pool = rec && rec.pool;
        if (!pool) return;
        // the pool must sample the SAME texels the mesh would have: its own
        // map, or (a PAGED pool, entities/pedinstance.js TEXTURE PAGES) a page
        // slot holding a pixel-exact copy of that map, which this instance's
        // pinUv points at
        if (pool.paged) {
          const ps = rec.ps;
          if (!ps || pool.mat.map !== ps.page.tex || ps.tex !== o.material.map) failures.push({ label: "pedinstance", region: "pool", problem: "paged pool slot does not hold the part's texture" });
          else {
            const u = pool.uv && pool.uv.array, k = rec.slot * 4;
            if (!u || Math.abs(u[k] - ps.uv[0]) > 1e-7 || Math.abs(u[k + 1] - ps.uv[1]) > 1e-7 || Math.abs(u[k + 2] - ps.uv[2]) > 1e-7 || Math.abs(u[k + 3] - ps.uv[3]) > 1e-7)
              failures.push({ label: "pedinstance", region: "pool", problem: "instance pinUv is not its page slot" });
            if (!pagedChecked.has(ps)) {
              pagedChecked.add(ps);
              const img = o.material.map.image, C = ps.page.cls, w = img.width, h = img.height;
              const a = img.getContext("2d").getImageData(0, 0, w, h).data;
              // the page is a GL-order array (entities/pedinstance.js): image row y is array row PH-1-y
              const pageRect = (x0, y0, rw, rh) => {
                const P = ps.page, out = new Uint8ClampedArray(rw * rh * 4);
                for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
                  const si = ((P.PH - 1 - (y0 + y)) * C.PW + x0 + x) * 4, di = (y * rw + x) * 4;
                  out[di] = P.data[si]; out[di + 1] = P.data[si + 1]; out[di + 2] = P.data[si + 2]; out[di + 3] = P.data[si + 3];
                }
                return out;
              };
              const b = pageRect(ps.x + C.g, ps.y + C.g, w, h);
              let bad = a.length !== b.length;
              // a browser canvas is premultiplied: a texel with alpha 0 has no
              // colour to copy (the source uploads as 0,0,0,0 too), so only
              // its alpha is compared
              for (let i = 0; !bad && i < a.length; i += 4) {
                if (a[i + 3] !== b[i + 3]) bad = true;
                else if (a[i + 3] > 0 && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])) bad = true;
              }
              // the gutter repeats the edge texel (the left gutter of the top row)
              const gut = pageRect(ps.x, ps.y + C.g, C.g, 1);
              for (let i = 0; !bad && i < gut.length; i += 4) for (let c = a[3] > 0 ? 0 : 3; c < 4; c++) if (gut[i + c] !== a[c]) bad = true;
              // the slot's uv rect lands on the slot's pixels in a flipY upload
              const PH = ps.page.PH, PW = C.PW;
              if (Math.abs(ps.uv[0] * PW - (ps.x + C.g)) > 1e-3 || Math.abs((1 - ps.uv[1] - ps.uv[3]) * PH - (ps.y + C.g)) > 1e-3) bad = true;
              if (bad) failures.push({ label: "pedinstance", region: "pool", problem: "page slot pixels differ from the part's texture" });
              else pagedPixelsOk++;
            }
          }
        } else if (pool.mat.map !== (o.material.map || null)) failures.push({ label: "pedinstance", region: "pool", problem: "pool map differs from the part's" });
        if ((pool.mat.alphaTest || 0) !== (o.material.alphaTest || 0)) failures.push({ label: "pedinstance", region: "pool", problem: "pool alphaTest differs" });
        const a = pool.geo.attributes.uv, b = o.geometry.attributes.uv;
        if (a && b && a.count === b.count) {
          for (let i = 0; i < a.count; i++) if (Math.abs(a.getX(i) - b.getX(i)) > 1e-6 || Math.abs(a.getY(i) - b.getY(i)) > 1e-6) {
            failures.push({ label: "pedinstance " + (o.userData._cbzPart || "part"), region: "pool", problem: "pool UVs differ from the part's (paints another atlas region)" }); break;
          }
        }
      });
    }
    if (audit) console.log(`pedinstance pages: ${audit.pages} pages, ${audit.pageSlots} slots, ${audit.pageMB} MB, ${audit.pagedPools} paged pools, ${pagedPixelsOk} slots pixel-checked`);
    // re-audit the crowd AFTER instancing (layer-30 parts must be carried)
    for (const p of CBZ.cityPeds) auditRig(p.char, "instanced " + p.char._auditLabel);
    // RE-DRESS WHILE INSTANCED — the live order of events: a body is spawned,
    // pooled and hidden, and only then re-dressed (protection.js dressAs, the
    // outfits.js sweep, crowd promotion). Every part re-keys into a new pool.
    const CYCLE = [CAT.security, CAT.suit, CAT.police, null, CAT.detail || CAT.suit, CAT.security, CAT.dress, CAT.security];
    for (let c = 0; c < CYCLE.length; c++) {
      CBZ.cityPeds.forEach((p, i) => { if ((i + c) % 3 !== 0) dress(p.char, CYCLE[(c + i) % CYCLE.length]); });
      for (let f = 0; f < 3; f++) tick[1](1 / 60);
      for (const p of CBZ.cityPeds) auditRig(p.char, "redress#" + c + " " + p.char._auditLabel + " -> " + (p.char._clothesKey || "flat"));
    }
    // LIVE FRAMES — walk, animate, instance and "render" the crowd the way the
    // game does (core/loop.js bumps the matrix-ownership stamp, animChar poses,
    // pedinstance composes + stamps, core/matrixskip.js skips owned rigs in the
    // render's updateMatrixWorld), with the player placed so half the crowd is
    // past the far-sync band. Then ask WHERE each body part is actually drawn —
    // the pool instance for a hidden part, the mesh's own matrixWorld for a real
    // one — against where the rig says it is. A part drawn anywhere but on the
    // body is, to the person looking at it, missing.
    CBZ.player = { pos: new THREE.Vector3(0, 0, -45) };
    const _truth = new THREE.Matrix4(), _loc = new THREE.Matrix4(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _im = new THREE.Matrix4();
    function truthWorld(o, out) {
      out.identity();
      const chain = [];
      for (let n = o; n; n = n.parent) chain.push(n);
      for (let i = chain.length - 1; i >= 0; i--) {
        const n = chain[i];
        _loc.compose(n.position, n.quaternion, n.scale);
        out.multiply(_loc);
      }
      return out;
    }
    let liveChecked = 0;
    for (let f = 0; f < 24; f++) {
      CBZ._matrixOwnStamp = (CBZ._matrixOwnStamp || 0) + 1;
      CBZ.cityPeds.forEach((p, i) => {
        p.group.position.x += 0.06 * ((i % 5) - 2);
        p.group.rotation.y += 0.02;
        if (CBZ.animChar) CBZ.animChar(p.char, (i % 4) * 2.5, 1 / 60);
      });
      if (f === 12) CBZ.cityPeds.forEach((p, i) => { if (i % 4 === 1) dress(p.char, CAT.suit); });
      tick[1](1 / 60);
      CBZ.scene.updateMatrixWorld();
      for (const p of CBZ.cityPeds) {
        const s = p.char.skinSlots;
        // ONE BODY, ONE MECHANISM: a person drawn part by the instancer's pools
        // (outside the rig's own subtree) and part by its own meshes is one
        // render-time disagreement away from floating hands and a head with no
        // clothes between them — the owner's "hands but no shirt or pants".
        let pooledR = [], realR = [];
        for (const [name, get] of REGIONS) for (const m of (get(s) || [])) {
          if (!m) continue;
          (m.layers.mask === (1 << 30) ? pooledR : realR).push(name);
        }
        if (f === 23 && pooledR.length && realR.length) {
          failures.push({ label: "live " + p.char._auditLabel + " -> " + (p.char._clothesKey || "flat"), region: "body",
            problem: "split body: pooled [" + [...new Set(pooledR)].join(",") + "] / self-drawn [" + [...new Set(realR)].join(",") + "]" });
        }
        for (const [name, get] of REGIONS) for (const m of (get(s) || [])) {
          if (!m) continue;
          liveChecked++;
          m.geometry.computeBoundingBox();
          m.geometry.boundingBox.getCenter(_c);
          const want = _d.copy(_c).applyMatrix4(truthWorld(m, _truth)).clone();
          let got;
          if (m.layers.mask === (1 << 30)) {
            const rec = m._pinst, pool = rec && rec.pool;
            if (!rec || !pool || !pool.mesh || rec.slot < 0) { failures.push({ label: "live " + p.char._auditLabel, region: name, problem: "hidden, no pool slot" }); continue; }
            pool.mesh.getMatrixAt(rec.slot, _im);
            if (Math.abs(_im.determinant()) < 1e-12) { failures.push({ label: "live " + p.char._auditLabel, region: name, problem: "hidden, pool slot parked while the body draws" }); continue; }
            // a box pool draws the unit cube (centre = origin); a loft pool draws the
            // canonical limb (its own bbox centre); anything else the mesh's geometry
            if (pool.box) got = new THREE.Vector3().applyMatrix4(_im);
            else if (pool.unit) { pool.geo.computeBoundingBox(); got = pool.geo.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(_im); }
            else got = _c.clone().applyMatrix4(_im);
          } else got = _c.clone().applyMatrix4(m.matrixWorld);
          const err = got.distanceTo(want);
          if (!(err < 1.0)) failures.push({ label: "live " + p.char._auditLabel + " -> " + (p.char._clothesKey || "flat"), region: name, problem: "drawn off the body (" + (Number.isFinite(err) ? err.toFixed(2) + " u" : "NaN") + (m.layers.mask === (1 << 30) ? ", pooled" : ", real mesh") + ")" });
        }
      }
    }
    if (audit) console.log(`live frames: ${liveChecked} part-draws checked`);
    const fin = CBZ.pedInstanceAudit ? CBZ.pedInstanceAudit() : null;
    if (fin && fin.splitRigs) failures.push({ label: "pedinstance", region: "body", problem: "pedInstanceAudit().splitRigs = " + fin.splitRigs });
    if (fin) console.log(`pedinstance after live frames: pools ${fin.poolsTotal}, split ${fin.splitRigs}, self-drawn ${fin.selfDrawnRigs}`);
    if (audit) console.log(`pedinstance: pools ${audit.pools} (box ${audit.boxPools}, loft ${audit.unitPools}) live ${audit.instancesLive} hidden ${hidden} fallback ${audit.fallbackMeshes}`);
  }
}

// ---------------------------------------------------------------- report
const byKey = new Map();
for (const f of failures) {
  const k = f.region + " | " + f.problem.replace(/\d+% opaque/, "N% opaque");
  const e = byKey.get(k) || { n: 0, ex: [] };
  e.n++; if (e.ex.length < (VERBOSE ? 1e9 : 3)) e.ex.push(f.label);
  byKey.set(k, e);
}
if (byKey.size) {
  console.log("\nFAILURES (region | problem  x count  e.g.)");
  for (const [k, e] of [...byKey].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k}  x${e.n}`);
    for (const ex of e.ex) console.log(`      ${ex}`);
  }
  // which cases fail, grouped by sex
  const cases = new Set(failures.map((f) => f.label));
  const bySex = { m: 0, f: 0 };
  for (const c of cases) { const m = c.match(/^\w+ (m|f) /); if (m) bySex[m[1]]++; }
  console.log(`\nfailing bodies: ${cases.size} (male ${bySex.m}, female ${bySex.f})`);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${failures.length ? "FAIL" : "PASS"}  ${combos} dressings, ${bodies} body audits, ${meshesChecked} meshes, ${OUTFITS.length} outfits x ${SEXES.length} sexes x ${HERITAGES.length} heritages x ${AGES.length} ages, ${failures.length} failures  (${secs}s)`);
process.exit(failures.length ? 1 : 0);
