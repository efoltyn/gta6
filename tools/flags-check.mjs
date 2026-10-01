#!/usr/bin/env node
/* tools/flags-check.mjs — ONE FLAG SYSTEM, checked in plain node (vendored
   three r128, a recording canvas, the real polity + country registry).

     RESOLVE   every country the polity knows (and every faction, regime,
               standard, city and gang id) resolves to exactly one design with
               a real layout, real proportions and real colours; the five
               authored nations are five DIFFERENT flags
     PAINT     every design paints without a throw, and every designer
               combination (layout x palette x emblem) does too
     CLOTH     every flag material shares ONE shader program key, the shader
               patch finds the r128 phong chunks it replaces, cloth carries
               aCloth, pole flags are instanced on flush()
     CUSTOM    the President's designer: begin / pattern / colours / emblem /
               adopt -> the nation's design changes in place (same material,
               same texture object), "flag-changed" carries text, the ledger
               stamp carries the design, a fresh ledger hydrates it back
     REGIME    setRegime swaps the nation's flag and back
     SITES     every file that hangs a nation's flag calls city/flags.js, and
               no file outside it builds a flag out of boxes and planes

   USAGE   node tools/flags-check.mjs [-v]      exit 1 on any failure */
import fs from "fs";
import vm from "vm";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const V = process.argv.includes("-v");
let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; if (V) console.log("  ok   " + m); } else { fails++; console.log("  FAIL " + m); } }

// ---- a recording 2D canvas ------------------------------------------------
const PAINT_LOG = { fills: 0, paths: 0 };
function ctx2d(cv) {
  const base = {
    canvas: cv, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalCompositeOperation: "source-over",
    fillRect() { PAINT_LOG.fills++; }, fill() { PAINT_LOG.fills++; }, beginPath() { PAINT_LOG.paths++; },
    measureText(t) { return { width: String(t).length * 8 }; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
  };
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; return function () {}; }, set(t, k, v) { t[k] = v; return true; } });
}
const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Set, Map, WeakMap, WeakRef, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Uint8ClampedArray, Float64Array, ArrayBuffer, Symbol, Error, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Proxy, Reflect, Promise, setTimeout, clearTimeout };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.document = {
  createElement() { return { width: 300, height: 150, style: {}, getContext() { return this._c || (this._c = ctx2d(this)); }, toDataURL() { return "data:image/png;base64,"; } }; },
};
vm.createContext(ctx);
function load(rel) { vm.runInContext(fs.readFileSync(ROOT + "/" + rel, "utf8"), ctx, { filename: rel }); }
load("src/vendor/three.r128.min.js");
const THREE = ctx.THREE;
const upd = [];
const events = [];
const matCache = new Map();
const CBZ = ctx.CBZ = {
  CONFIG: {}, game: { mode: "city", state: "playing" },
  cmat(c) { if (!matCache.has(c)) { const m = new THREE.MeshLambertMaterial({ color: c }); m._shared = true; matCache.set(c, m); } return matCache.get(c); },
  onUpdate(o, fn) { upd.push(fn); }, addLandmass() {},
  hash01(x, z, s) { const v = Math.sin(x * 12.9898 + z * 78.233 + (s || 0)) * 43758.5453; return v - Math.floor(v); },
  presidency: { emit(evt, p) { events.push({ evt, p }); }, seat() { return { kind: "country", id: "republic" }; }, status() { return { seat: true }; } },
  CITY: { gangs: [{ id: "reds", color: 0xc0392b }, { id: "kings", color: 0x7d3cc8 }] },
};
// the real registry: polity.js + countries.js (pure data there; their THREE
// builders are only registered, never run)
let polityOk = true;
for (const f of ["src/city/polity.js", "src/city/countries.js"]) { try { load(f); } catch (e) { polityOk = false; if (V) console.log("  (" + f + " did not load: " + e.message + ")"); } }
if (CBZ.polityReset) { try { CBZ.polityReset(); } catch (e) {} }
load("src/city/flags.js");
const FL = CBZ.flags;
ok(!!FL, "city/flags.js publishes CBZ.flags");

// ---- RESOLVE ------------------------------------------------------------------
console.log("RESOLVE");
const LAYS = new Set(FL.LAYOUTS.concat(["plain", "bicolour-h"]));
const HEX = /^#[0-9a-f]{6}$/i;
function validDesign(d) {
  return d && LAYS.has(d.layout) && Array.isArray(d.ratio) && d.ratio.length === 2 && d.ratio[0] > 0 && d.ratio[1] >= d.ratio[0] &&
    Array.isArray(d.colors) && d.colors.length >= 1 && d.colors.every((c) => HEX.test(c)) && d.emblem && typeof d.emblem.kind === "string";
}
const nations = FL.ids();
ok(nations.length >= 5, "the polity's countries are listed (" + nations.join(", ") + ")");
for (const n of ["republic", "veridia", "kesh", "solara", "mbeya"]) ok(nations.indexOf(n) >= 0, "nation " + n + " is in the registry");
if (polityOk && CBZ.polity && CBZ.polity.list) {
  const L = CBZ.polity.list("country") || [];
  ok(L.length >= 5, "the real polity registry has " + L.length + " countries");
  for (const r of L) ok(nations.indexOf(r.id) >= 0, "polity country " + r.id + " resolves through ids()");
}
const sigs = new Map();
for (const n of nations) {
  const d = FL.designFor(n), d2 = FL.designFor(n);
  ok(validDesign(d), n + ": one valid design (" + d.layout + " " + d.ratio.join(":") + ")");
  ok(JSON.stringify(d) === JSON.stringify(d2), n + ": resolves to the same design every time");
  sigs.set(n, JSON.stringify([d.layout, d.colors, d.emblem]));
}
const authored = ["republic", "veridia", "kesh", "solara", "mbeya"].map((n) => sigs.get(n));
ok(new Set(authored).size === 5, "the five nations fly five different flags");
const layoutsUsed = new Set(["republic", "veridia", "kesh", "solara", "mbeya"].map((n) => FL.designFor(n).layout));
ok(layoutsUsed.size === 5, "five different flag grammars (" + [...layoutsUsed].join(", ") + ")");
ok(FL.designFor("republic").ratio.join(":") === "10:19" && FL.designFor("veridia").ratio.join(":") === "8:11", "real proportions: the Republic 10:19, Veridia's Nordic cross 8:11");
const extra = ["standard:republic", "standard:kesh", "faction:rebels", "faction:junta", "faction:terror", "gang:reds", "gang:kings", "city:libertyville", "city:goldspire",
  "regime:dictatorship", "regime:fascism", "regime:communism", "regime:monarchy", "regime:junta", "someplace_new", "republic_rebels_1"];
for (const id of extra) ok(validDesign(FL.designFor(id)), id + ": resolves to a valid design");
ok(FL.designFor("gang:reds").colors[0].toLowerCase() === "#c0392b", "a gang flag is dyed in the gang's own colour");
ok(FL.designFor("city:goldspire").layout !== undefined && sigs.get("republic") !== JSON.stringify([FL.designFor("city:goldspire").layout]), "a city flag is its own flag");

// ---- PAINT ----------------------------------------------------------------------
console.log("PAINT");
function tryPaint(d, w, h, o) {
  const c = ctx.document.createElement("canvas"); c.width = w; c.height = h;
  const before = PAINT_LOG.fills;
  try { FL.paint(c.getContext("2d"), JSON.parse(JSON.stringify(d)), w, h, o); } catch (e) { return "throw " + e.message; }
  return PAINT_LOG.fills > before ? null : "painted nothing";
}
for (const id of nations.concat(extra)) {
  const d = FL.designFor(id);
  ok(tryPaint(d, 512, 270, { heading: true }) === null, id + " paints as a flag");
  ok(tryPaint(d, 192, 640, { vertical: true }) === null, id + " paints as a hanging banner");
}
let combos = 0, comboFails = [];
for (const lay of FL.LAYOUTS) for (const pal of FL.PALETTES) for (const em of FL.EMBLEMS) {
  const d = { layout: lay, colors: pal.concat(["#f4f1e8"]), emblem: { kind: em, color: "#e2b22f", color2: "#f4f1e8" } };
  const r = tryPaint(d, 128, 80, {});
  combos++;
  if (r) comboFails.push(lay + "/" + em + ": " + r);
}
ok(!comboFails.length, "every designer combination paints (" + combos + " combos)" + (comboFails.length ? " " + comboFails.slice(0, 3).join("; ") : ""));
ok(FL.dataURL("republic", 64) != null, "a design renders to a data URL for the UI");

// ---- CLOTH ------------------------------------------------------------------------
console.log("CLOTH");
const root = new THREE.Group();
const p1 = FL.pole(root, { x: 10, y: 0, z: 10, height: 12, id: "republic" });
FL.pole(root, { x: 30, y: 0, z: 10, height: 12, id: "republic" });
FL.pole(root, { x: 50, y: 0, z: 10, height: 12, id: "republic", finial: "eagle" });
FL.pole(root, { x: 50, y: 0, z: 30, height: 9, id: "veridia" });
ok(p1 && p1.group && p1.group.parent === root, "pole() stands a pole group in the root");
const made = FL.flush();
const pools = [], cloths = [], hws = [];
root.traverse((o) => {
  if (o.isInstancedMesh && o.userData.cbzFlag) pools.push(o);
  if (o.isInstancedMesh && o.userData.cbzFlagHw) hws.push(o);
  if (o.isMesh && o.userData.cbzFlag && o.geometry.attributes.aCloth) cloths.push(o);
});
ok(made >= 3 && pools.length === made, "flush() pools the pole flags (" + made + " pools for 4 poles)");
ok(pools.some((p) => p.count === 2), "two identical poles in one cell share ONE instanced cloth");
ok(hws.length === pools.length, "the poles themselves are instanced alongside their flags");
ok(pools.every((p) => p.geometry.boundingSphere && p.geometry.boundingSphere.radius > 3), "every pool is bounded for culling (its own sphere, swing included)");
const st = FL.staff(root, { x: 0, y: 0, z: 0, flyX: 1, flyZ: 0, id: "republic", tag: "oval" });
const ban = FL.banner(root, { x: 0, y: 6, z: 0, width: 1.2, length: 4, id: "kesh" });
const handParent = new THREE.Group(); FL.hand(handParent, { top: 0.6, yaw: Math.PI });
const carG = new THREE.Group(); FL.car(carG, { x: 0.8, y: 0.8, z: 2 });
ok(st && st.cloth && st.cloth.geometry.attributes.aCloth, "staff(): a draped cloth with aCloth");
ok(st && st.group.children.length === 3, "staff(): hardware, cloth and the gold fringe");
ok(st.cloth.geometry.attributes.aCloth.array[1] === 0, "an indoor staff flag hangs still (flex 0)");
ok(ban && ban.cloth.material !== FL.material("kesh"), "banner(): its own vertical painting of the nation's design");
ok(handParent.children.length === 1 && carG.children.length === 1, "hand() and car() flags attach to their parents");
const mats = new Set();
root.traverse((o) => { if (o.userData && o.userData.cbzFlag && o.material && o.material.name === "flag-cloth") mats.add(o.material); });
for (const m of [FL.material("republic"), FL.material("veridia"), FL.material("faction:rebels")]) mats.add(m);
const keys = new Set([...mats].map((m) => m.customProgramCacheKey()));
ok(keys.size === 1, "every flag material shares ONE shader program (" + [...keys].join(",") + ")");
ok(FL.material("republic") === FL.material("republic"), "one shared material per design");
// the shader patch: run it on the real r128 phong source
const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.phong.vertexShader, fragmentShader: THREE.ShaderLib.phong.fragmentShader };
FL.material("republic").onBeforeCompile(sh);
ok(sh.vertexShader.indexOf("vec3 transformed = cbzP;") > 0 && sh.vertexShader.indexOf("#include <begin_vertex>") < 0, "the vertex wave replaces <begin_vertex>");
ok(sh.vertexShader.indexOf("attribute vec4 aCloth") > 0 && sh.vertexShader.indexOf("#include <beginnormal_vertex>") < 0, "the wave writes its own normals (beginnormal replaced)");
ok(sh.fragmentShader.indexOf("fwidth") > 0, "the weave is in the fragment shader");
ok(sh.uniforms.uFlagT && sh.uniforms.uFlagWind, "time and wind uniforms are wired");
// the tick drives the clock and the wind
CBZ.weatherWind = () => ({ x: 0, z: 1, speed: 8 });
for (let i = 0; i < 40; i++) upd.forEach((f) => f(0.1));
const W = FL._uniforms.wind.value;
ok(FL._uniforms.t.value > 3.5 && W.y > 0.5 && W.z > 0.5, "the flags read the weather's wind (dir " + W.x.toFixed(2) + "," + W.y.toFixed(2) + " strength " + W.z.toFixed(2) + ")");
// the drape: cloth hangs below its corner, folds out of plane
const dp = FL._drape(1.6, 0.86, 1.6, 0.86, [0, 0, 0]);
ok(dp[1] < -1.2 && dp[0] > 0.3 && dp[0] < 1.0, "the drape's fly corner hangs low beside the pole (" + dp.map((v) => v.toFixed(2)).join(",") + ")");

// ---- CUSTOM ---------------------------------------------------------------------------
console.log("CUSTOM");
const matBefore = FL.material("republic"), texBefore = FL.texture("republic");
const D = FL.designer;
D.begin(st, "republic");
ok(D.active(), "the designer starts a draft at the Oval's standard");
ok(st.cloth.material !== matBefore, "the draft shows live on that cloth only");
const a = D.pattern(), b = D.colours(), c = D.emblem();
ok(a && b && c && FL.LAYOUTS.indexOf(c.layout) >= 0, "pattern / colours / emblem each change the draft");
const draft = D.draft();
CBZ.game.cityWorld = {};
FL.flags = null;
CBZ.cityWorldCommit = function () { return true; };
for (let i = 0; i < 12; i++) upd.forEach((f) => f(0.1));     // install the save wraps (and hydrate this ledger)
D.begin(st, "republic"); D.colours(); D.emblem();
const draft2 = D.draft();
const res = D.adopt();
ok(!D.active() && st.cloth.material === matBefore, "adopt puts the nation's own material back on the cloth");
ok(res && res.custom && JSON.stringify(res.colors) === JSON.stringify(draft2.colors), "the adopted design is the nation's design now");
ok(FL.material("republic") === matBefore && FL.texture("republic") === texBefore, "same material, same texture object: every flag already in the world changes");
const ev = events.filter((e) => e.evt === "flag-changed").pop();
ok(ev && typeof ev.p.text === "string" && /flag/i.test(ev.p.text) && ev.p.nation === "republic", "flag-changed is emitted with text (" + (ev ? ev.p.text : "none") + ")");
CBZ.cityWorldCommit();
const led = CBZ.game.cityWorld;
ok(led.flags && led.flags.custom && led.flags.custom.republic, "the save carries the custom flag");
// a reload: a fresh ledger object with that save in it
const saved = JSON.parse(JSON.stringify(led.flags));
FL.setCustom("republic", null, true);
ok(!FL.designFor("republic").custom, "clearing restores the authored flag");
CBZ.game.cityWorld = { flags: saved };
for (let i = 0; i < 12; i++) upd.forEach((f) => f(0.1));
ok(FL.designFor("republic").custom, "a loaded save brings the custom flag back");
CBZ.game.cityWorld = {};
for (let i = 0; i < 12; i++) upd.forEach((f) => f(0.1));
ok(!FL.designFor("republic").custom, "a fresh run flies the authored flag");
void draft;

// ---- REGIME ---------------------------------------------------------------------------
console.log("REGIME");
const before = JSON.stringify(FL.designFor("republic"));
FL.setRegime("republic", "communism");
ok(FL.designFor("republic").regime === "communism" && JSON.stringify(FL.designFor("republic")) !== before, "a regime brings its own flag");
ok(/flag/i.test(events[events.length - 1].p.text), "the regime's flag makes the news");
FL.setRegime("republic", "none");
ok(JSON.stringify(FL.designFor("republic")) === before, "the old flag comes back with the republic");

// ---- SITES --------------------------------------------------------------------------------
console.log("SITES");
const SITES = {
  "src/city/govcomplex.js": /CBZ\.flags\.pole\(/,
  "src/city/buildings.js": /CBZ\.flags\.pole\(/,
  "src/city/buildings_civic.js": /ctx\.flag\(/,
  "src/city/motorcade.js": /CBZ\.flags\.car\(/,
  "src/city/president_public.js": /CBZ\.flags\.(staff|hand)\(/,
  "src/city/island_military.js": /CBZ\.flags\.pole\(/,
  "src/city/towngen.js": /CBZ\.flags\.pole\(/,
  "src/city/interior_programs.js": /CBZ\.flags\.staff\(/,
  "src/city/president_regime.js": /CBZ\.flags\.(banner|staff|setRegime)\(/,
  "src/city/marina.js": /CBZ\.flags\.hand\(/,
};
for (const f in SITES) ok(SITES[f].test(fs.readFileSync(ROOT + "/" + f, "utf8")), f + " hangs its flags through city/flags.js");
// no second flag system: outside flags.js, no city file builds a flag from
// primitives or paints its own flag canvas. (The race, warlord, prison and
// beach warning flags are other games' / not a nation's.)
const ALLOW = new Set(["src/city/flags.js"]);
const bad = [];
for (const f of fs.readdirSync(ROOT + "/src/city")) {
  const rel = "src/city/" + f;
  if (!f.endsWith(".js") || ALLOW.has(rel)) continue;
  const lines = fs.readFileSync(ROOT + "/" + rel, "utf8").split("\n");
  lines.forEach((ln, i) => {
    if (/^\s*(\/\/|\*)/.test(ln) || /nukeMat\(/.test(ln)) return;   // a warhead's safing tag is not a flag
    if (/\b(flagTex|flagMat|flagGeo|smallFlagGeo|flagBlue|flagWhite)\b/.test(ln) ||
        (/\bflag\w*\s*=\s*new THREE\.Mesh\(/i.test(ln)) ||
        (/\b(cloth|flag)\b.*new THREE\.PlaneGeometry/i.test(ln) && !/sign|plate/i.test(ln))) bad.push(rel + ":" + (i + 1) + "  " + ln.trim().slice(0, 90));
  });
}
ok(!bad.length, "no city file builds its own flag" + (bad.length ? "\n       " + bad.slice(0, 8).join("\n       ") : ""));
const html = fs.readFileSync(ROOT + "/index.html", "utf8");
const iF = html.indexOf("src/city/flags.js"), iI = html.indexOf("src/city/interior_programs.js");
ok(iF > 0 && iF < iI, "index.html loads city/flags.js before the first file that hangs a flag");

console.log("FLAGS: " + (fails ? "FAIL" : "OK") + " " + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
