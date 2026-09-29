#!/usr/bin/env node
/* tools/uniform-body-check.mjs — EVERY UNIFORM HAS A BODY IN IT, in plain node.

   Owner (2026-09-29, the President game on the iPad): "the Secret Service now
   have no torso and no arms and no legs. It's basically like the outfit is nil."

   The garment atlases wear alphaTest 0.5, so a garment whose texels reach the
   GPU as alpha 0 is not drawn at all: the torso, sleeves and trousers vanish
   and the flat skin head and hands stand in the air. Two ways that happened,
   neither of which tools/human-audit.mjs could see, because it never has a
   renderer and never runs out of canvas:
     1. entities/pedinstance.js TEXTURE PAGES sent an outfit first worn LATE in
        a session (the detail's black suit arrives when you take office, long
        after the street went up at boot) to the GPU as a sub-image upload from
        a 2048-wide page canvas — the one path no headless check ever ran;
     2. iOS WebKit caps the memory every canvas together may hold, and a canvas
        made past the cap draws nothing and reads back transparent. The pages
        were ~170 MB of canvas on their own.
   So this check runs the real rig + wardrobe + instancer code (same vm load as
   human-audit) with a small EMULATED GPU (every texture upload and every
   copyTextureToTexture lands in a per-texture RGBA store, with WebGL's flipY
   and row order), and plays the order of events the game does:

     boot     a street crowd is built, instanced and "rendered" (pages go up);
     office   every uniformed role is spawned AFTER that (so every new outfit
              reaches the GPU through the incremental path), instanced, rendered;
     ios-cap  the same, in a fresh world whose canvas budget runs out after
              boot: every canvas made from then on is dead (draws nothing,
              reads back zero), exactly what WebKit hands out past its cap.

   Roles are cast the way the game casts them (city/outfits.js cityOutfitFor
   with the job strings protection.js, president_staff.js, motorcade.js,
   occupy.js, police, military and the prison post), both sexes, three
   heritages. For every role body it asserts that the torso, both arms (upper +
   lower) and both legs (upper + lower):
     - exist and are attached, and every ancestor is visible;
     - have a non-zero world scale — and, when an instanced pool draws them, a
       live, non-parked instance with a non-zero matrix;
     - hold a material, and the texels that material samples ON THE GPU (the
       page slot through this instance's pinUv, or the mesh's own atlas) pass
       its alphaTest — i.e. the part actually puts fragments on the screen.

     node tools/uniform-body-check.mjs            summary + PASS/FAIL
     node tools/uniform-body-check.mjs --verbose  every failing part
   UNIFORM_CHECK_SRC=/path/to/tree/ checks another tree (e.g. a git archive).
   Exit 0 = every uniform has a body in it. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument, FakeCanvas } from "./lib/fake-canvas.mjs";

const ROOT = process.env.UNIFORM_CHECK_SRC ? new URL("file://" + process.env.UNIFORM_CHECK_SRC.replace(/\/?$/, "/")) : new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const VERBOSE = process.argv.includes("--verbose");
const t0 = Date.now();

const FILES = ["src/vendor/three.r128.min.js", "src/config.js", "src/core/matrixskip.js", "src/world/materials.js", "src/systems/fphands.js",
  "src/entities/tattoo.js", "src/entities/footwear.js", "src/entities/character.js", "src/entities/headwear.js", "src/entities/heritage.js",
  "src/city/clothes.js", "src/city/outfits.js", "src/entities/dutykit.js", "src/entities/pedinstance.js", "src/city/armor.js", "src/systems/prisonoutfits.js"];

// The roles, as the game posts them (job strings are the load-bearing part:
// city/outfits.js jobFit reads them).
const ROLES = [
  { tag: "secret service (detail)", job: "secret service", archetype: "security" },         // protection.js, president_staff.js agent, motorcade.js
  { tag: "hired security", job: "hired security", archetype: "security" },                    // protection.js private detail
  { tag: "bodyguard", job: "bodyguard", archetype: "security" },
  { tag: "uniformed division", job: "uniformed division officer", archetype: "security" },    // protection.js gate
  { tag: "counter-sniper", job: "counter-sniper", archetype: "security" },
  { tag: "police officer", job: "police officer", cop: true },                                // police.js / motorcade.js escorts
  { tag: "SWAT", kind: "cop", cop: true, swat: true },
  { tag: "detective", job: "detective" },
  { tag: "sheriff", job: "sheriff" },
  { tag: "soldier", job: "soldier", archetype: "military" },
  { tag: "military general", job: "military general", archetype: "military" },               // president_staff.js cabinet
  { tag: "security guard", job: "security guard", archetype: "security" },
  { tag: "corrections officer", job: "corrections officer", archetype: "security" },
  { tag: "prison warden", job: "prison warden" },
  { tag: "chauffeur", job: "chauffeur", archetype: "professional" },                          // president_staff.js driver
  { tag: "press secretary", job: "press secretary", archetype: "professional" },
  { tag: "chief of staff", job: "chief of staff", archetype: "professional" },
  { tag: "federal agent", job: "federal agent", archetype: "professional" },
  { tag: "police commissioner", job: "police commissioner", archetype: "professional" },
  { tag: "treasury secretary", job: "treasury secretary", archetype: "professional" },
  { tag: "firefighter", job: "firefighter" },
  { tag: "paramedic", job: "paramedic" },
  { tag: "pilot", job: "pilot" },
  { tag: "bus driver", job: "bus driver" },
  { tag: "park ranger", job: "park ranger" },
];
// the street at boot: the outfits the city puts up before anyone takes office
const STREET = [{ archetype: "resident" }, { archetype: "office" }, { archetype: "tycoon" }, { archetype: "dealer" }, { archetype: "nightlife" },
  { job: "waiter" }, { job: "construction worker" }, { job: "nurse" }, { archetype: "mobster" }, { archetype: "vagrant" }];

function world(scenario) {
  const ctx = vm.createContext({ console, Math, setTimeout, clearTimeout, performance });
  ctx.window = ctx; ctx.self = ctx;
  // THE CANVAS CAP: past it every new canvas is dead — a context that draws
  // nothing and reads back zero (WebKit's behaviour past its canvas budget).
  const doc = fakeDocument();
  const mk = doc.createElement;
  let capped = false;
  const DRAWS = { fillRect: 1, strokeRect: 1, clearRect: 1, fill: 1, stroke: 1, drawImage: 1, putImageData: 1, fillText: 1, strokeText: 1 };
  function deadCanvas() {
    const cv = new FakeCanvas();
    const real = cv.getContext.bind(cv);
    cv.getContext = function (k) {
      const c2 = real(k);
      if (!c2) return c2;
      // nothing it draws lands, so its (zero) buffer is all anyone can read,
      // upload or drawImage from it
      return new Proxy(c2, {
        get(o, key) {
          if (DRAWS[key]) return function () {};
          const v = o[key];
          return typeof v === "function" ? v.bind(o) : v;
        },
        set(o, key, v) { o[key] = v; return true; },
      });
    };
    cv._dead = true;
    return cv;
  }
  doc.createElement = function (tag) { return tag === "canvas" && capped ? deadCanvas() : mk.call(doc, tag); };
  ctx.document = doc;
  ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
  ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  ctx.addEventListener = () => {}; ctx.requestAnimationFrame = () => 0;
  const always = [];
  ctx.CBZ = { CONFIG: {}, game: { mode: "city" }, npcs: [], onUpdate() {}, onAlways(p, f) { always.push([p, f]); }, onReset() {}, onModeEnter() {} };
  ctx.CBZ.tattoo = { lazy: false };
  for (const f of FILES) vm.runInContext(read(f), ctx, { filename: f });
  const { THREE, CBZ } = ctx;
  for (const need of ["makeCharacter", "cityRecolorRig", "cityOutfitFor", "HERITAGE_IDS", "heritageRoll"]) {
    if (!CBZ[need]) { console.error("FAIL harness: CBZ." + need + " missing"); process.exit(2); }
  }
  const reg = (CBZ.always || []).map((a) => [a.order, a.fn]).concat(always);
  const tick = reg.find((a) => a[0] === 96 && /PED_INSTANCED/.test(String(a[1])));
  if (!tick) { console.error("FAIL harness: pedinstance tick not registered"); process.exit(2); }

  // ---- THE EMULATED GPU --------------------------------------------------
  // store: texture -> { w, h, px: Uint8Array in GL row order (row 0 = v 0) }
  const gpu = new Map();
  const props = new Map();
  function prOf(t) { let p = props.get(t); if (!p) props.set(t, (p = {})); return p; }
  // an image's rows in GL order, as texImage2D/texSubImage2D would store them
  function glRows(img, flipY) {
    let w, h, src;
    if (img && img.data && !img.getContext) { w = img.width; h = img.height; src = img.data; }
    else if (img && img.getContext) {
      w = img.width; h = img.height;
      const c2 = img.getContext("2d");
      src = c2 ? c2.getImageData(0, 0, w, h).data : new Uint8ClampedArray(w * h * 4);
    } else return null;
    const out = new Uint8Array(w * h * 4);
    for (let r = 0; r < h; r++) {
      const sr = flipY ? h - 1 - r : r;       // flipY: the image's TOP row lands at the texture's top (v 1)
      out.set(src.subarray(sr * w * 4, (sr + 1) * w * 4), r * w * 4);
    }
    return { w, h, px: out };
  }
  function upload(t) {
    const pr = prOf(t);
    if (pr.__webglInit && pr.__version === t.version) return;
    const g = glRows(t.image, t.flipY);
    if (g) gpu.set(t, g);
    pr.__webglInit = true; pr.__version = t.version;
  }
  CBZ.renderer = {
    properties: { get: prOf },
    copyTextureToTexture(pos, src, dst) {
      upload(dst);                               // r128: setTexture2D(dst) uploads a stale dst first
      const G = gpu.get(dst), s = glRows(src.image, dst.flipY);
      if (!G || !s) return;
      for (let r = 0; r < s.h; r++) {
        const y = pos.y + r;
        if (y < 0 || y >= G.h) continue;
        for (let x = 0; x < s.w; x++) {
          const X = pos.x + x;
          if (X < 0 || X >= G.w) continue;
          const si = (r * s.w + x) * 4, di = (y * G.w + X) * 4;
          G.px[di] = s.px[si]; G.px[di + 1] = s.px[si + 1]; G.px[di + 2] = s.px[si + 2]; G.px[di + 3] = s.px[si + 3];
        }
      }
    },
  };
  CBZ.scene = new THREE.Scene();
  const root = new THREE.Group(); CBZ.scene.add(root);
  CBZ.cityPeds = []; CBZ.cityCops = [];
  // "render": what the renderer would upload this frame — every map a drawn
  // mesh or pool samples
  function render() {
    CBZ.scene.updateMatrixWorld();
    CBZ.scene.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material) || !o.material.map) return;
      upload(o.material.map);
    });
  }
  function frames(n) { for (let i = 0; i < n; i++) { CBZ._matrixOwnStamp = (CBZ._matrixOwnStamp || 0) + 1; tick[1](1 / 60); render(); } }
  function spawn(role, sex, her, i) {
    const look = CBZ.heritageRoll(her, "uniform|" + sex + "|" + her + "|" + i);
    const ch = CBZ.makeCharacter({ legs: 0x39414f, torso: 0x8a939c, collar: 0x8a939c, arms: 0x8a939c, skin: look.skin,
      hair: look.bald ? look.skin : look.hair, hairStyle: look.hairStyle, beard: sex === "m" ? look.beard : null,
      shoes: 0x2b2b2b, build: sex, longHair: sex === "f", job: role.job, archetype: role.archetype, cop: !!role.cop });
    if (CBZ.heritageApply) CBZ.heritageApply(ch, look);
    const fit = CBZ.cityOutfitFor(Object.assign({ seed: (i * 7919) | 0, sex, band: "adult", rng: () => 0.37 }, role));
    if (fit && fit.colors) CBZ.cityRecolorRig(ch, fit.colors, fit);
    const n = CBZ.cityPeds.length;
    ch.group.position.set((n % 16) * 2.2, 0, ((n / 16) | 0) * 2.2);
    root.add(ch.group);
    const p = { group: ch.group, char: ch, pos: ch.group.position, _role: role.tag, _fit: fit ? fit.id + (fit.uniform ? "/" + fit.uniform : "") : "plain", _sex: sex, _her: her };
    CBZ.cityPeds.push(p);
    return p;
  }
  return { THREE, CBZ, gpu, frames, spawn, cap() { capped = true; } };
}

// ---- the checks -----------------------------------------------------------
const PARTS = [["torso", (s) => s.torso && s.torso.slice(0, 1), 1], ["armUp", (s) => s.arms, 2], ["armLo", (s) => s.armsLower, 2],
  ["legUp", (s) => s.legs, 2], ["legLo", (s) => s.legsLower, 2]];
const HIDE = 1 << 30;

// bilinear alpha at (u, v) in GL texture space (v 0 = row 0), texel centres
// at (i + 0.5) / size, edges clamped: what a LINEAR-filtered lookup returns
function alphaAt(G, u, v) {
  const x = u * G.w - 0.5, y = v * G.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const A = (i, j) => G.px[((Math.min(G.h - 1, Math.max(0, j))) * G.w + Math.min(G.w - 1, Math.max(0, i))) * 4 + 3] / 255;
  return (A(x0, y0) * (1 - fx) + A(x0 + 1, y0) * fx) * (1 - fy) + (A(x0, y0 + 1) * (1 - fx) + A(x0 + 1, y0 + 1) * fx) * fy;
}
function sampleProblem(W, mesh, pool, rec) {
  const { THREE, gpu } = W;
  const m = pool ? pool.mat : mesh.material;
  const at = m.alphaTest || 0;
  if (!m.map || !(at > 0)) return null;          // a flat or opaque material always puts fragments down
  const G = gpu.get(m.map);
  if (!G) return "texture never reached the GPU";
  const uv = mesh.geometry.attributes.uv;
  if (!uv) return "atlas material without uv";
  let ox = 0, oy = 0, sx = 1, sy = 1;
  if (pool && pool.paged) {
    const u = pool.uv && pool.uv.array, k = rec.slot * 4;
    if (!u) return "paged pool without pinUv";
    ox = u[k]; oy = u[k + 1]; sx = u[k + 2]; sy = u[k + 3];
  }
  const idx = mesh.geometry.index ? mesh.geometry.index.array : null;
  const tri = idx ? idx.length / 3 : uv.count / 3;
  let tot = 0, cut = 0;
  for (let t = 0; t < tri; t++) {
    const v = [0, 1, 2].map((q) => (idx ? idx[t * 3 + q] : t * 3 + q));
    for (const [wa, wb] of [[0.34, 0.33], [0.6, 0.2], [0.2, 0.6], [0.2, 0.2]]) {
      const wc = 1 - wa - wb;
      const u0 = wa * uv.getX(v[0]) + wb * uv.getX(v[1]) + wc * uv.getX(v[2]);
      const v0 = wa * uv.getY(v[0]) + wb * uv.getY(v[1]) + wc * uv.getY(v[2]);
      const U = u0 * sx + ox, V = v0 * sy + oy;
      tot++;
      if (alphaAt(G, U, V) * (m.opacity != null ? m.opacity : 1) < at) cut++;
    }
  }
  if (!tot) return "no faces";
  if (cut / tot > 0.02) return "alphaTest discards " + Math.round(cut / tot * 100) + "% of it on the GPU (texels alpha 0)";
  return null;
}
function partProblems(W, mesh, groupRoot) {
  const { THREE, CBZ } = W;
  const out = [];
  if (!mesh) return ["missing"];
  for (let n = mesh; n; n = n.parent) {
    if (n.visible === false) { out.push("hidden (" + (n === mesh ? "mesh" : n.name || n.type) + ".visible=false)"); break; }
    if (n === groupRoot) break;
    if (!n.parent) { out.push("detached from the body"); break; }
  }
  if (!mesh.material || Array.isArray(mesh.material) && !mesh.material.length) out.push("no material");
  else if (!Array.isArray(mesh.material) && mesh.material.visible === false) out.push("material.visible=false");
  mesh.updateWorldMatrix(true, false);
  if (!(Math.abs(mesh.matrixWorld.determinant()) > 1e-9)) out.push("zero world scale");
  if (!mesh.geometry || !mesh.geometry.attributes.position || !(mesh.geometry.attributes.position.count > 0)) out.push("no geometry");
  if (out.length) return out;
  let pool = null, rec = null;
  if (mesh.layers.mask === HIDE) {
    // drawn by an instanced pool: a live instance must carry it
    rec = mesh._pinst; pool = rec && rec.pool;
    if (CBZ.pedInstanceDraws(mesh) !== true || !pool || !pool.mesh) return ["on the instancer's hide layer with no live instance"];
    const e = pool.mesh.instanceMatrix.array, k = rec.slot * 16;
    const M = new THREE.Matrix4().fromArray(e, k);
    if (!(Math.abs(M.determinant()) > 1e-12)) return ["pooled instance matrix is zero (parked)"];
  } else if (!(mesh.layers.mask & 1)) return ["off the camera layer (mask " + mesh.layers.mask + ")"];
  const sp = sampleProblem(W, mesh, pool, rec);
  if (sp) out.push(sp + (pool ? (pool.paged ? " [page slot]" : " [pool map]") : " [own atlas]"));
  return out;
}

const failures = [];
let bodies = 0, partsChecked = 0;
function audit(W, list, scenario) {
  for (const p of list) {
    bodies++;
    const s = p.char.skinSlots;
    for (const [name, get, need] of PARTS) {
      const meshes = (get(s) || []).filter(Boolean);
      if (meshes.length < need) failures.push({ scenario, who: p._role, fit: p._fit, body: p._sex + " " + p._her, part: name, problem: "has " + meshes.length + " mesh(es), needs " + need });
      for (const m of meshes) {
        partsChecked++;
        for (const pr of partProblems(W, m, p.group)) failures.push({ scenario, who: p._role, fit: p._fit, body: p._sex + " " + p._her, part: name, problem: pr });
      }
    }
  }
}

const SEXES = ["m", "f"];
for (const scenario of ["office", "ios-cap"]) {
  const W = world(scenario);
  const HER = W.CBZ.HERITAGE_IDS.slice(0, 3);
  let i = 0;
  // boot: the street goes up and is drawn (pages reach the GPU)
  for (const sex of SEXES) for (const her of HER) for (const r of STREET) W.spawn(Object.assign({ tag: "street " + (r.job || r.archetype) }, r), sex, her, i++);
  W.frames(3);
  if (scenario === "ios-cap") W.cap();
  // then the office: every uniformed role, first worn now
  const roles = [];
  for (const sex of SEXES) for (const her of HER) for (const r of ROLES) roles.push(W.spawn(r, sex, her, i++));
  W.frames(3);
  audit(W, roles, scenario);
  const a = W.CBZ.pedInstanceAudit ? W.CBZ.pedInstanceAudit() : {};
  const dead = W.CBZ.cityClothesDeadCanvases ? W.CBZ.cityClothesDeadCanvases() : "n/a";
  console.log(`${scenario.padEnd(8)} roles ${roles.length}  pools ${a.pools}  pagedPools ${a.pagedPools}  pageCopies ${a.pageCopies}  pageRefused ${a.pageRefused != null ? a.pageRefused : "n/a"}  selfDrawn ${a.selfDrawnRigs}  deadAtlases ${dead}`);
}

// ---- report ------------------------------------------------------------
const byRole = new Map();
for (const f of failures) {
  const k = f.scenario + " | " + f.who + " (" + f.fit + ")";
  if (!byRole.has(k)) byRole.set(k, new Map());
  const m = byRole.get(k), pk = f.part + ": " + f.problem;
  m.set(pk, (m.get(pk) || 0) + 1);
}
for (const [k, m] of byRole) {
  console.log("FAIL " + k);
  for (const [pk, n] of m) console.log("       " + pk + (n > 1 ? "  x" + n : ""));
}
if (VERBOSE) for (const f of failures) console.log("  ", f.scenario, f.who, f.body, f.part, f.problem);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (failures.length) { console.log(`FAIL  ${failures.length} part failures over ${bodies} role bodies, ${partsChecked} parts (${secs}s)`); process.exit(1); }
console.log(`PASS  ${bodies} role bodies (${ROLES.length} roles x 2 sexes x 3 heritages x 2 scenarios), ${partsChecked} torso/arm/leg parts drawn with a body in them (${secs}s)`);
