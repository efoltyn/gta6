// tools/warroom-check.cjs — HEADLESS PROOF of the war room (node only, no
// browser): the real three.js r128, the real arsenal_data / polity /
// countries / relations / polwar / militaryvehicles / munitions / bunkers /
// strategic / playerair / warroom / newsroom, stubbed only at the engine
// edges (render, peds, the impact bus's FX). Proves, end to end:
//   1. a small country (Kesh) saves up, buys a warhead and a B-52, the B-52
//      is delivered and parked at Kesh's air station, the nuke is ordered,
//      the bomber takes off from ITS pad, flies there and the bomb lands
//   2. a head of state in his bunker survives an ordinary airstrike
//   3. a B-2 + two GBU-57s breach that bunker and kill him (succession runs)
//   4. every event reads right on NEWS ONE
// Run: node tools/warroom-check.cjs
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = process.argv[2] || path.resolve(__dirname, "..");
const updates = [], landmass = [];
const events = [];
const detonations = [];
let killed = [];
const win = {};
const fake2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === "canvas" ? fakeCanvas() : function () { return { addColorStop() {}, data: new Uint8ClampedArray(4), width: 1 }; })), set: (t, k, v) => { t[k] = v; return true; } });
function fakeCanvas() { return { width: 64, height: 64, style: {}, getContext: () => fake2d, toDataURL: () => "" }; }
const ctx = vm.createContext({ addEventListener: () => {}, removeEventListener: () => {}, window: win, console, Math, Object, Array, JSON, isFinite, Map, Set, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Int8Array, Int16Array, Uint8ClampedArray, Float64Array, ArrayBuffer, DataView, WeakMap, Symbol, Promise, setTimeout, clearTimeout, performance: { now: () => Date.now() }, navigator: { userAgent: "node" }, document: { createElement: () => fakeCanvas(), createElementNS: () => ({ style: {} }) }, self: win });
win.window = win; win.self = win; win.document = ctx.document; win.navigator = ctx.navigator;
function load(f) { vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f }); }
load("src/vendor/three.r128.min.js");
const THREE = win.THREE || ctx.THREE;
win.THREE = THREE;
const scene = new THREE.Group();
const arenaRoot = new THREE.Group(); scene.add(arenaRoot);
const CBZ = {
  game: { mode: "city", state: "playing", elapsed: 0 },
  CONFIG: { GOV_OFFICE: true },
  onUpdate: (o, fn) => updates.push({ o, fn }),
  onAlways: () => {},
  addLandmass: (fn, o) => landmass.push({ o: o || 0, fn }),
  hash01: (a, b, s) => { const x = Math.sin(a * 12.9898 + b * 78.233 + (s || 0) * 3.1) * 43758.5453; return x - Math.floor(x); },
  cityFeed: (t) => {},
  presidency: {
    _L: {}, emit(e, p) { events.push([e, p]); console.log("  [EVENT]", e, "|", p && p.text ? p.text : ""); (this._L[e] || []).forEach(f => f(p, e)); },
    on(e, f) { (this._L[e] = this._L[e] || []).push(f); },
    status: () => ({ threat: { intel: true } }),
    current: () => ({ kind: "npc", ped: null }),
    cellHome: () => ({ x: 1400, z: 300, name: "Dry Gulch" }),
    cellRegion: () => ({ minX: 1100, maxX: 1700, minZ: 0, maxZ: 700 }),
    cellLeader: () => (CBZ._emirDead ? null : { sid: "cell_emir", name: "Rashid Kaan", rank: "emir" }),
    cellKill: (sid) => { CBZ._emirDead = true; killed.push(sid); return true; },
  },
  // officials.js's contract: a minted ledger name per sid ("Someone" when the
  // ledger cannot read it), titles off the country's govType
  officials: { PLAYER_SID: "player",
    identityOf: (sid) => ({ name: ({ veridia_pres: "Aldo Marren", veridia_vp: "Celia Voss", mbeya_pres: "Joseph Okonjo", solara_pres: "Ines Arda" })[sid] || "Someone" }),
    titleFor: (rec) => (rec && rec.govType === "monarchy" ? "King" : "President"),
    killOfficial: (sid) => { killed.push(sid); for (const c of CBZ.polity.list("country")) if (c.office && c.office.holder === sid) c.office.holder = c.office.deputy || null; return true; } },
  colliders: [], platforms: [], scene: scene,
  city: { arena: { root: arenaRoot, regions: [] } },
  floorAt: () => 0, groundAt: () => 0,
  cmat: (hex) => new THREE.MeshLambertMaterial({ color: hex }),
  taperBox: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  mat: (hex) => new THREE.MeshLambertMaterial({ color: hex }),
  boxGeom: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  impact: { define() {}, row: () => null, kinetic: (m, v) => ({ E: 0.5 * m * v * v }) },
  detonate: function (x, y, z, kind, o) { detonations.push({ x: Math.round(x), z: Math.round(z), kind }); return null; },
  player: { pos: new THREE.Vector3(0, 0, -700), dead: false },
  cityMilitaryPersonnel: [],
  // aircraft.js's release law (BOMBS_DROP_STRAIGHT), verbatim numbers
  ordnanceDropVel: (id, c, out, o) => { out = out || {}; const k = (o && o.residual != null) ? o.residual : 0.08; const ej = (o && o.eject != null) ? o.eject : 1.5; out.vx = (c.vx || 0) * k; out.vz = (c.vz || 0) * k; const ay = c.vy || 0; out.vy = (ay < 0 ? ay : ay * k) - ej; return out; },
  milModels: {
    jet: () => ({ group: new THREE.Group(), footW: 12, footL: 16, height: 4, aircraftDims: { span: 12, length: 16, height: 4 } }),
    bomber: () => ({ group: new THREE.Group(), footW: 56, footL: 48, height: 12, aircraftDims: { span: 56, length: 48, height: 12 } }),
  },
};
win.CBZ = CBZ;
load("src/city/arsenal_data.js");
load("src/city/countries.js");
load("src/city/polity.js");
CBZ.polityReset && CBZ.polityReset();
load("src/city/relations.js");
load("src/city/polwar.js");
load("src/city/militaryvehicles.js");
try { load("src/weapons/munitions.js"); } catch (e) { console.log("munitions load:", e.message); }
load("src/city/bunkers.js");
load("src/city/strategic.js");
load("src/city/playerair.js");
load("src/city/warroom.js");
// build the world the landmass builders own (bunkers, the parked B-2)
landmass.sort((a, b) => a.o - b.o);
for (const L of landmass) { try { L.fn({ root: arenaRoot }); } catch (e) { /* towns etc need the full engine */ } }
updates.sort((a, b) => a.o - b.o);
function tick(secs, dt) { dt = dt || 0.1; const n = Math.round(secs / dt); for (let i = 0; i < n; i++) { CBZ.game.elapsed += dt; for (const u of updates) { try { u.fn(dt); } catch (e) { if (!tick._e) { tick._e = 1; console.log("tick err", e.stack.split("\n").slice(0, 3).join(" | ")); } } } } }
function setDay(d) { CBZ.worldDay(d); }

const P = CBZ.polity, PW = CBZ.polwar, W = CBZ.warroom;
console.log("ARSENAL start:", JSON.stringify(PW.militaryOf("kesh")), "\n");
// leaders for every country
for (const c of P.list("country")) c.office = c.office || {};
P.get("veridia").office.holder = "veridia_pres"; P.get("veridia").office.deputy = "veridia_vp";
P.get("mbeya").office.holder = "mbeya_pres";
P.get("solara").office.holder = "solara_pres";

// ===== THE SMALL COUNTRY: the player is President of KESH
const kesh = P.get("kesh");
kesh.office.holder = "player";
CBZ.gov = { holds: () => ({ id: "kesh", rec: kesh, kind: "country", title: "King" }) };
CBZ.player.pos.set(1900, 0, -1600);
tick(1.2);
console.log("kesh fleet:", JSON.stringify(W.fleet()), "treasury", Math.round(kesh.treasury), "station", JSON.stringify(W.station("kesh")));
console.log("bunkers:", JSON.stringify(W.audit().bunkers));
console.log("\n--- 1. try to nuke with nothing");
console.log("nuke ->", JSON.stringify(W.nuke({ target: { x: -2200, z: -1200, label: "Mbeya City", nation: "mbeya" } })));
console.log("General's line:", W.missingLine("nuke") || "(none)");
console.log("buy warhead (broke) ->", JSON.stringify(W.buy("warhead")));
// save up: run national days (taxes in, upkeep out)
let d = 0;
while (kesh.treasury < 150000 + 90000 && d < 400) { d++; setDay(d); PW._tick(d); }
console.log("saved up for", d, "days, treasury", Math.round(kesh.treasury));
console.log("buy warhead ->", JSON.stringify(W.buy("warhead")));
console.log("General's line:", W.missingLine("nuke") || "(none)");
console.log("buy B-52 ->", JSON.stringify(W.buy("heavy")));
console.log("nuke before delivery ->", JSON.stringify(W.nuke({ target: { x: -2200, z: -1200, label: "Mbeya City", nation: "mbeya" } })));
setDay(d + 7); tick(1.2);
console.log("delivered fleet:", JSON.stringify(W.fleet()), "parked B-52s at kesh station:", W.bombersOf("kesh", "heavy").map(r => r.model.name + "@" + Math.round(r.pos.x) + "," + Math.round(r.pos.z)).join(" "));
console.log("nuke prompt shows:", W.hasMeans("nuke"));
const bomber = W.bombersOf("kesh", "heavy")[0];
const pad = { x: bomber.pos.x, z: bomber.pos.z };
console.log("\n--- 2. ORDER THE NUKE on Mbeya City");
const nr = W.nuke({ target: { x: -2200, z: -1200, label: "Mbeya City", nation: "mbeya" } });
console.log("nuke ->", JSON.stringify(nr), "warheads now", W.fleet().warhead);
const st0 = CBZ.strategicSortieState();
try { const m = CBZ.strategicModels.b2(); console.log("b2 model ok", !!m.group); } catch (e) { console.log("B2 MODEL THROWS", e.stack.split("\n").slice(0, 4).join(" | ")); }
console.log("sortie: from pad", JSON.stringify(pad), "bomber now at", Math.round(st0.x), Math.round(st0.y), Math.round(st0.z));
let maxY = 0, rolled = false;
for (let i = 0; i < 400 && !detonations.some(x => x.kind === "nuke"); i++) {
  if (i % 20 === 0) { const s = CBZ.strategicSortieState(); if (s.active) console.log("  t=" + (i * 0.25).toFixed(0) + "s bomber at", Math.round(s.x), Math.round(s.y), Math.round(s.z), s.phase); }
  tick(0.25);
  const s = CBZ.strategicSortieState();
  if (s.active) { maxY = Math.max(maxY, s.y); if (!rolled && Math.hypot(s.x - pad.x, s.z - pad.z) > 50) { rolled = true; console.log("  rolled off its pad, alt", Math.round(s.y)); } }
}
const nd = detonations.find(x => x.kind === "nuke");
console.log("NUKE DETONATED at", JSON.stringify(nd), "aim (-2200,-1200), miss", nd ? Math.round(Math.hypot(nd.x + 2200, nd.z + 1200)) : "-", "m; bomber climbed to", Math.round(maxY), "m");
tick(30);
console.log("bomber back on pad:", Math.round(bomber.pos.x), Math.round(bomber.pos.z), "taken:", bomber.taken);
console.log("mbeya leader (went underground when the order was given) killed? ->", killed.indexOf("mbeya_pres") >= 0);

// ===== 3. B-2 + MOPs kill a leader in his bunker; a normal airstrike does not
console.log("\n--- 3. Veridia's leader in his bunker");
killed = [];
const vb = W.bunkerOf("veridia");
console.log("veridia bunker:", vb && vb.id, "roofCE", vb && vb.roofCE, "at", vb && Math.round(vb.interior.cx), vb && Math.round(vb.interior.cz));
kesh.treasury += 600000;      // (the test skips more saving)
console.log("war on veridia ->", JSON.stringify(W.war ? (function () { const r = PW.declareWar("kesh", "veridia", { byPlayer: true }); return !!r; })() : null), "veridia sheltered:", W.sheltered("veridia"));
console.log("strike bunker w/o B-2 ->", JSON.stringify(W.bunkerStrike()));
// a normal airstrike right on his residence
const vcap = PW.capitalOf("veridia");
const sr = W.strike({ target: { x: vcap.cx, z: vcap.cz, label: "Veridia City", nation: "veridia" } });
console.log("airstrike on Veridia City ->", JSON.stringify(sr));
const flights = CBZ.cityStrikeFlights();
console.log("jets in the air:", flights.length ? flights[0].jets.length : 0);
tick(20);
console.log("after the bombs: veridia leader killed?", killed.indexOf("veridia_pres") >= 0, "bomb detonations:", detonations.filter(x => x.kind === "bomb").length);
console.log("buy B-2 ->", JSON.stringify(W.buy("b2")));
console.log("buy MOP ->", JSON.stringify(W.buy("mop")), JSON.stringify(W.buy("mop")));
setDay(d + 20); tick(6);
console.log("fleet:", JSON.stringify(W.fleet()), "B-2 parked:", W.bombersOf("kesh", "b2").length);
const b2 = W.bombersOf("kesh", "b2")[0];
const b2pad = { x: Math.round(b2.pos.x), z: Math.round(b2.pos.z) };
const br = W.bunkerStrike();
console.log("strike bunker ->", JSON.stringify(br), "mops left", W.fleet().mop, "from pad", JSON.stringify(b2pad));
for (let i = 0; i < 400 && !(vb.breached) && CBZ.strategicSortieState().active; i++) {
  if (i % 12 === 0) { const s = CBZ.strategicSortieState(); console.log("  t=" + (i * 0.25).toFixed(0) + "s B-2 at", Math.round(s.x), Math.round(s.y), Math.round(s.z), s.phase, JSON.stringify(s.aimed)); }
  tick(0.25);
}
tick(3);
console.log("buster detonations:", JSON.stringify(detonations.filter(x => x.kind === "buster")), "bunker shell", JSON.stringify(vb.shell));
console.log("bunker breached:", vb.breached, "wornCE", vb.wornCE && vb.wornCE.toFixed(2), "veridia leader killed:", killed.indexOf("veridia_pres") >= 0, "successor:", P.get("veridia").office.holder);
console.log("\nEVENTS:", events.map(e => e[0]).join(", "));
// NO RAW KEYS IN ANY HEADLINE: a sid, a polity id or "Someone" never reaches text
const ids = ["veridia_pres", "veridia_vp", "mbeya_pres", "solara_pres", "cell_emir", "lead_", "cell_dugout", "Someone", "undefined", "null"];
const leaks = events.filter(([e, p]) => p && p.text && ids.some(k => p.text.indexOf(k) >= 0)).map(([e, p]) => e + ": " + p.text);
console.log("ID LEAKS IN EVENT TEXT:", leaks.length ? leaks : "none");
// who is credited for each strike that landed, and where it hit
for (const [e, p] of events) if (e === "airstrike") console.log("  airstrike on", p.label, "(" + p.nationName + ") credited to", p.attackerName);

// ===== THE NEWS: every event above through the real newsroom.js
try {
  load("src/city/newsroom.js");
  for (const [e, p] of events) { try { CBZ.news.event(e, p); } catch (err) { console.log("news err", e, err.message); } tick(13, 1); }
  console.log("\nNEWS ONE HEADLINES:");
  for (const s of CBZ.news.stories()) console.log("  [" + (s.kind || "story") + "] " + (s.h || s.headline) + (s.sub ? "  / " + s.sub : ""));
} catch (e) { console.log("newsroom load failed:", e.message); }
