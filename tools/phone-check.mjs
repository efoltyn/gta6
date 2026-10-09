#!/usr/bin/env node
// tools/phone-check.mjs — plain-node check of THE PHONE (no browser).
//   Loads the real city/newsroom.js, city/phone_apps.js, city/dissent.js and
//   city/phone.js into a vm with a stub world (presidency bus, warroom,
//   polity, relations, civilwar) and a stub canvas/THREE, then plays it:
//     1. take the phone out, tap the Calls tile, call the General, order war
//     2. at war: the General's airstrike goes through presidency.press
//     3. Holler: "Declare war on Kesh" declares it on Kesh and NEWS ONE runs
//        "President declares war on Kesh in a post"
//     4. approval collapses: unrest, a movement with a leader, generals
//        meeting and troops moving are all on NEWS ONE (and the Chief of
//        Staff rings) BEFORE the coup fires; the coup then succeeds
//     5. the answers: relieving the General makes the next coup fail, a
//        bunker makes it split the country, an address lowers the street
// Run: node tools/phone-check.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0, passes = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log("FAIL " + msg); } else passes++; }

// ---------------------------------------------------------------- stub THREE
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } setScalar(s) { return this.set(s, s, s); } copy(v) { return this.set(v.x, v.y, v.z); } applyMatrix4() { return this; } }
class O3 {
  constructor() { this.children = []; this.parent = null; this.position = new V3(); this.rotation = new V3(); this.scale = new V3(1, 1, 1); this.userData = {}; this.visible = true; this.matrix = new M4(); }
  add(o) { for (const c of arguments) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = this; this.children.push(c); } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  updateMatrixWorld() {} updateMatrix() {}
}
class M4 { copy() { return this; } invert() { return this; } }
class Mat { constructor(o) { Object.assign(this, o || {}); } clone() { return new Mat(this); } }
const THREE = {
  Group: O3, Object3D: O3, Mesh: class extends O3 { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
  BoxGeometry: class {}, PlaneGeometry: class {}, CanvasTexture: class { constructor(c) { this.image = c; } },
  MeshBasicMaterial: Mat, MeshLambertMaterial: Mat, Vector3: V3, Vector2: class { set() { return this; } }, Matrix4: M4,
  Quaternion: class {}, Euler: class {}, Raycaster: class { setFromCamera() {} intersectObject() { return []; } },
  LinearFilter: 1006, sRGBEncoding: 3001,
};
// ---------------------------------------------------------------- stub DOM
function ctx2d() {
  const c = { font: "10px sans-serif" };
  return new Proxy(c, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "measureText") return (s) => ({ width: String(s).length * (parseInt(/(\d+)px/.exec(t.font) ? /(\d+)px/.exec(t.font)[1] : 10, 10) * 0.55) });
      if (k === "createLinearGradient") return () => ({ addColorStop() {} });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const listeners = {};
const doc = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d(), style: {} }),
  exitPointerLock() {}, addEventListener() {}, body: {}, documentElement: {},
};

// ---------------------------------------------------------------- stub world
const bus = {};
const spoken = [];
const pressed = [];
const warCalls = [];
const coups = [];
let day = 0;
const newDay = [];
const countries = {
  republic: { id: "republic", kind: "country", name: "Republic of Libertas", approval: 52, treasury: 500000, govType: "democracy", office: { holder: "player", deputy: "vp1" } },
  kesh: { id: "kesh", kind: "country", name: "Kingdom of Kesh", approval: 60, treasury: 90000, govType: "monarchy", office: { holder: "k1" } },
  veridia: { id: "veridia", kind: "country", name: "Republic of Veridia", approval: 60, treasury: 90000, govType: "democracy", office: { holder: "v1" } },
};
const rels = { "kesh|republic": -50, "republic|veridia": 10 };
const rk = (a, b) => [a, b].sort().join("|");
let enemy = null, shelter = false;
const cab = { general: { name: "Marcus Hale", display: "General Hale", dead: false, loyalty: 60 }, chief: { name: "Ruth Adair", dead: false, loyalty: 60 },
  bureau: { name: "Leon Varga", display: "Director Varga", dead: false, loyalty: 60 }, police: { name: "Nadia Serrano", display: "Commissioner Serrano", dead: false, loyalty: 60 },
  treasury: { name: "Oscar Whitlock", display: "Secretary Whitlock", dead: false, loyalty: 60 } };
const staffState = {};
const always = [];
const CBZ = {
  game: { mode: "city", state: "playing" },
  CONFIG: {},
  onAlways: (o, fn) => always.push({ o, fn }), onUpdate: (o, fn) => always.push({ o, fn }),
  onNewDay: (fn) => newDay.push(fn),
  worldDay: () => day,
  player: { pos: { x: 0, y: 0, z: 0 }, dead: false },
  camera: new O3(),
  keys: {},
  speech: { phone: (t) => { spoken.push(t); return true; } },
  gov: { holds: () => ({ kind: "country", id: "republic", rec: countries.republic }) },
  polity: { get: (id) => countries[id] || null, list: (k) => Object.values(countries).filter((c) => c.kind === k) },
  relations: {
    get: (a, b) => rels[rk(a, b)] || 0,
    event: (a, b, kind, mag) => { const s = { trade: 1, aid: 1, insult: -1, border: -1, war: -1 }[kind]; rels[rk(a, b)] = Math.max(-100, Math.min(100, (rels[rk(a, b)] || 0) + s * mag)); return rels[rk(a, b)]; },
  },
  officials: {
    identityOf: (sid) => ({ player: { name: "Eli Foltyn" }, k1: { name: "Adar Nasser" }, v1: { name: "Clara Moreau" }, vp1: { name: "Leon Brandt" } }[sid] || { name: "Someone" }),
    titleFor: (rec) => (rec.govType === "monarchy" ? "King" : "President"),
  },
  presidency: {
    on(evt, fn) { (bus[evt] = bus[evt] || []).push(fn); },
    emit(evt, p) { for (const fn of (bus[evt] || []).concat(evt !== "*" ? (bus["*"] || []) : [])) fn(p, evt); },
    press(key) {
      pressed.push(key);
      const r = key === "strike" ? { ok: true, line: "Two jets wheel up for Keshtown." } : key === "nuke" ? { ok: false, why: "We have no warheads." } : { ok: true, why: "" };
      // presidency.js pressButton: every order that runs is an act (city/politics.js)
      if (r.ok && CBZ.politics && !/^(strike|nuke|war|peace)$/.test(key)) CBZ.politics.act(key, { by: "self" });
      CBZ.presidency.emit("order", { key, ok: !!r.ok, why: r.why || "" });
      return r;
    },
    cabinet: () => cab,
    cabinetRecord: (role) => cab[role] || null,
    staff: () => staffState,
    vacateCabinet: (role) => { cab[role].dead = true; return true; },
    fillCabinet: (role, who) => { cab[role] = { name: who.name, display: "General " + who.name.split(" ").pop(), dead: false, loyalty: who.loyalty, trait: who.trait }; return true; },
    seat: () => CBZ.gov.holds(),
    site: () => ({ cx: 5000, cz: 5000 }),
  },
  warroom: {
    nation: () => "republic",
    enemy: () => enemy,
    warheads: () => 0,
    nationAt: () => "republic",
    canWar: (opts) => enemy ? { ok: false, why: "We are already at war." } : { ok: true, foe: (opts && opts.foe) || "kesh", name: countries[(opts && opts.foe) || "kesh"].name },
    war(opts) {
      warCalls.push(opts && opts.foe);
      const gt = this.canWar(opts); if (!gt.ok) return gt;
      enemy = gt.foe;
      CBZ.presidency.emit("war-declared", { attacker: "republic", attackerName: countries.republic.name, defender: gt.foe, defenderName: countries[gt.foe].name, byPlayer: true });
      return { ok: true, line: "Then it's war with " + gt.name + "." };
    },
    peace() { if (!enemy) return { ok: false, why: "We are not at war." }; enemy = null; return { ok: true, line: "It's over." }; },
  },
  civilwar: { coup: (id, kind) => { coups.push(kind); if (kind === "success") countries[id].office.holder = "junta1"; return { outcome: kind }; } },
  strategicBunkerShelterAt: () => (shelter ? { id: "b1" } : null),
  cityGangs: [{ id: "reds", name: "Red Kings", bossName: "Tito Reyes", boss: { dead: false }, turf: [{ cx: 10, cz: 10 }] }],
  cityGangStanding: () => 0, cityGangAddStanding: () => 0, cityGangProvoke: () => {},
  sfx: () => {},
};
const win = {
  CBZ, THREE, document: doc, console, Math, Date, JSON, Object, Array, String, Number, Proxy, isFinite, parseInt, Infinity,
  performance: { now: () => 0 }, innerWidth: 1280, innerHeight: 800,
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
};
win.window = win;
vm.createContext(win);
for (const f of ["src/city/newsroom.js", "src/city/phone_apps.js", "src/city/politics.js", "src/city/president_staff.js", "src/city/dissent.js", "src/city/phone.js"]) {
  vm.runInContext(readFileSync(path.join(root, f), "utf8"), win, { filename: f });
}
always.sort((a, b) => a.o - b.o);
function step(secs) { for (let t = 0; t < secs; t += 0.1) for (const a of always) a.fn(0.1); }
function nextDay() { day++; for (const fn of newDay) fn(day); step(10); }   // a real day is 150 s
const A = CBZ.phoneApps;
const N = CBZ.news;
const headlines = () => N.stories().map((s) => s.h);
step(3);   // hooks wire up on the slow tick

// ---- 1. open the phone, open the Calls app by tapping its tile, call the General
ok(typeof CBZ.phoneOpen === "function" && typeof CBZ.phoneClose === "function", "CBZ.phoneOpen/phoneClose exposed");
ok(CBZ.cityPhoneChip().available === true, "the hotbar phone cell is available in Gang City");
ok(CBZ.phoneOpen() === true && CBZ.phoneIsOpen(), "the phone comes out");
ok(CBZ.cityMenuOpen === true, "taking it out claims cityMenuOpen (camera.js pause exemption)");
step(0.3);
const hits = CBZ._phoneHits();
ok(hits.length >= 5, "the home screen draws its app tiles (" + hits.length + " hit regions)");
// the Calls tile is the second tile: top-right of the 2x2 grid
const callsTile = hits.filter((h) => h.w > 150 && h.h > 150)[1];
ok(!!callsTile && CBZ._phoneTap(callsTile.x + callsTile.w / 2, callsTile.y + callsTile.h / 2), "tap the Calls tile");
ok(CBZ.phoneAudit().app === "calls", "the Calls app is open (" + CBZ.phoneAudit().app + ")");
const cs = A.contacts();
ok(cs.some((c) => c.id === "general" && c.name === "General Hale"), "the General is a contact");
ok(cs.some((c) => c.id === "chief"), "the Chief of Staff is a contact");
ok(cs.some((c) => c.id === "leader:kesh" && /King/.test(c.name)), "Kesh's king is a contact by name (" + (cs.find((c) => c.id === "leader:kesh") || {}).name + ")");
ok(cs.some((c) => c.id === "gang:reds" && c.name === "Tito Reyes"), "a gang boss is a contact");
let conv = A.call("general");
ok(conv && conv.line && conv.choices.some((c) => c.id === "war"), "the General answers and offers war (" + (conv && conv.choices.map((c) => c.label).join("/")) + ")");
ok(spoken.includes(conv.line), "his line is spoken on the line (speech.phone)");
let r = A.choose("war");
ok(r && r.ok && warCalls[0] === "kesh" && enemy === "kesh", "ordering war through the General declares it on Kesh");
step(3);
ok(headlines().some((h) => /Libertas declares war on Kingdom of Kesh/.test(h)), "NEWS ONE runs the declaration off the bus (war-declared names attacker and defender)");
// ---- 2. at war: airstrike through the presidency's own order
conv = A.call("general");
ok(conv && conv.choices.some((c) => c.id === "strike"), "at war the General offers an airstrike");
r = A.choose("strike");
ok(r && r.ok && pressed.includes("strike"), "the airstrike runs presidency.press('strike')");
step(3);
A.call("leader:kesh");
r = A.choose("peace");
ok(r && r.ok && enemy === null, "calling the King of Kesh and making peace ends the war");
step(3);

// ---- 3. Holler: post a war declaration
CBZ.phoneOpen("social");
const opts = A.postOptions();
const warOpt = opts.find((o) => /^war:/.test(o.id));
ok(warOpt && warOpt.label === "Declare war on Kesh", "Holler offers 'Declare war on Kesh' (" + opts.map((o) => o.label).join(" / ") + ")");
const before = warCalls.length;
r = A.post(warOpt.id);
ok(r && r.ok && warCalls.length === before + 1 && warCalls[warCalls.length - 1] === "kesh" && enemy === "kesh", "the post declares war on Kesh through the warroom");
step(1);
ok(headlines().includes("President declares war on Kesh in a post"), "NEWS ONE runs 'President declares war on Kesh in a post'");
ok(A.feed().some((p) => p.kind === "you" && /at war with Kesh/.test(p.text)), "the post is on the feed");
step(6);
ok(A.feed().some((p) => p.kind === "leader" && /regret/.test(p.text)), "Kesh's king posts back");
const thr = A.postOptions().find((o) => /^threat:/.test(o.id));
const relBefore = CBZ.relations.get("republic", "kesh");
ok(thr && A.post(thr.id).ok && CBZ.relations.get("republic", "kesh") < relBefore, "'Threaten' drops relations");
A.call("leader:kesh"); A.choose("peace");
step(3);

// ---- 3b. the call log: a missed call, its line, the callback
CBZ.presidency.emit("war-declared", { attacker: "kesh", attackerName: countries.kesh.name, defender: "republic", defenderName: countries.republic.name, byPlayer: false, warId: "w-log" });
for (let i = 0; i < 40 && !A.ringing(); i++) step(1);
ok(A.ringing() && A.ringing().name === "General Hale", "the General rings when Kesh attacks (" + (A.ringing() && A.ringing().name) + ")");
step(26);                                   // it rings out
const miss = A.log().find((e) => e.dir === "missed" && e.name === "General Hale");
ok(!!miss && miss.missed && miss.text === "Call me. It's Kesh." && miss.callable, "the missed call is in the log with his line (" + (miss && miss.text) + ")");
ok(A.missedCount() >= 1 && A.unread().calls >= 1 && CBZ.cityPhoneChip().unread, "missed count, the Calls badge and the hotbar light are up");
conv = A.callBack(miss.n);
ok(conv && conv.line === "They hit first. I need orders." && conv.choices.map((c) => c.id).join() === "strike,hold", "calling back: he says what he wanted, his answers on the line (" + (conv && conv.line) + ")");
ok(!A.log().find((e) => e.n === miss.n).missed, "the missed call is returned");
// the call screen: every answer clear of the hang-up, which sits alone at the bottom
CBZ.phoneOpen("calls"); step(0.3);
const ch = CBZ._phoneHits();
const hang = ch.find((h) => h.y > 820 && h.y < 900 && h.w <= 160);
ok(!!hang && ch.every((h) => h === hang || h.y >= 960 || h.y + h.h < hang.y), "the hang-up's tap box overlaps no answer (" + ch.length + " hits)");
r = A.choose("hold");
ok(r && r.ok && !A.pending("general"), "answering settles his matter");
step(4);
conv = A.callBack(miss.n);
ok(conv && conv.line === "Never mind, sir. It's handled." && conv.choices.length > 0, "calling back after it's settled: 'Never mind, sir. It's handled.' and his usual verbs");
A.hangup();
step(3);

// ---- 4. the country turns: the movement and the coup show up BEFORE the coup
CBZ.politics._setAll(12);
const seen = {};
let coupDay = null, coupFiredDay = null;
const rang = [];
for (let i = 0; i < 14 && !coups.length; i++) {
  nextDay();
  const h = headlines().join(" | ");
  if (/Protests grow/.test(h) && seen.unrest == null) seen.unrest = day;
  if (/leads an? ([a-zA-Z-]+ )?movement against the President/.test(h) && seen.movement == null) seen.movement = day;
  if (/Generals meet without the President/.test(h) && seen.army == null) seen.army = day;
  if (/Troops seen moving/.test(h) && seen.troops == null) seen.troops = day;
  const rg = A.ringing();
  if (rg) { rang.push(rg.name); A.decline(); }
  if (CBZ.dissent.status().coupDay != null && coupDay == null) coupDay = CBZ.dissent.status().coupDay;
  if (coups.length) coupFiredDay = day;
}
ok(seen.unrest != null, "NEWS ONE: protests grow (day " + seen.unrest + ")");
ok(seen.movement != null && CBZ.dissent.status().leader, "NEWS ONE: a named movement against the President (day " + seen.movement + ", leader " + CBZ.dissent.status().leader + ")");
ok(seen.army != null, "NEWS ONE: generals meet without the President (day " + seen.army + ")");
ok(seen.troops != null, "NEWS ONE: troops seen moving (day " + seen.troops + ")");
ok(coupFiredDay != null && seen.troops < coupFiredDay && seen.army <= seen.troops && seen.movement <= seen.army, "every warning came before the coup (troops day " + seen.troops + ", coup day " + coupFiredDay + ")");
ok(coups[0] === "success", "an unanswered coup succeeds (" + coups[0] + ")");
ok(countries.republic.office.holder === "junta1", "the junta holds the seat");
ok(headlines().some((h) => /The army seizes/.test(h)), "NEWS ONE: the army seizes the capital");
ok(rang.length >= 2, "the Chief of Staff rang while it built (" + rang.join(", ") + ")");
ok(A.feed().some((p) => /march tomorrow/.test(p.text)), "the movement's leader posts on Holler");
ok(A.feed().some((p) => /Tanks on the ring road/.test(p.text)), "citizens post the troops before the coup");

// ---- 5. the answers
function rebuild() {
  countries.republic.office.holder = "player";
  CBZ.dissent.reset();
  coups.length = 0;
  for (let i = 0; i < 12 && !(CBZ.dissent.status().coupDay != null); i++) nextDay();
}
CBZ.politics._setAll(12);
rebuild();
ok(CBZ.dissent.status().coupDay != null, "the troops move again");
// call the General: he is cold, and can be relieved
conv = A.call("general");
ok(conv && conv.line === "Yes?" && conv.choices[0].id === "resign" && conv.choices[0].label === "I need your resignation", "a disloyal General answers 'Yes?' and his resignation is the first thing on the line");
r = A.choose("resign");
ok(r && r.ok && cab.general.dead && CBZ.presidentStaff.vacant("general"), "relieving him empties the chair (president_staff.js dismiss)");
step(3);
ok(CBZ.presidentStaff.nominee() && CBZ.presidentStaff.nominee().role === "general", "and the Chief has two names for it");
// force the troops back up inside the purge window: the coup fails
CBZ.politics._setInst("army", 5); CBZ.dissent._state().coupDay = day;
nextDay();
ok(coups[0] === "failure", "a coup inside the purge window fails (" + coups[0] + ")");
ok(headlines().some((h) => /Coup attempt crushed/.test(h)), "NEWS ONE: coup attempt crushed");
// the bunker: the coup takes the capital, not the President
coups.length = 0;
CBZ.dissent._state().purgedDay = -99; CBZ.politics._setInst("army", 5); CBZ.dissent._state().coupDay = day + 1;
shelter = true;
nextDay();
ok(coups[0] === "partial", "sheltered in a bunker, the coup splits the country instead (" + coups[0] + ")");
shelter = false;
// the address: the street calms
CBZ.dissent.reset(); nextDay();
CBZ.politics._setAll(30); CBZ.politics._state().fear = 0;
const st0 = CBZ.dissent.status();
r = A.post ? CBZ.dissent.concede() : null;
const st1 = CBZ.dissent.status();
ok(r && r.ok && pressed.includes("address") && st1.unrest < st0.unrest && st1.movement < st0.movement, "addressing the protests lowers unrest and the movement (" + st0.unrest + "/" + st0.movement + " -> " + st1.unrest + "/" + st1.movement + ")");

// ---- 6. any player: a gang player has the same phone without the state
CBZ.warroom.nation = () => null;
const gcs = A.contacts();
ok(!gcs.some((c) => c.kind === "staff" || c.kind === "leader"), "a non-President sees no General, staff or leaders");
ok(gcs.some((c) => c.kind === "gang"), "a non-President still calls gang bosses");
const gopts = A.postOptions();
ok(gopts.length === 1 && /^callout:/.test(gopts[0].id), "a non-President can call out a gang on Holler");
ok(CBZ.phoneClose() === true && !CBZ.phoneIsOpen() && CBZ.cityMenuOpen === false, "the phone goes away and gives the menu lock back");

// ---- text law: no em dashes or middle dots anywhere the player reads
const allText = headlines().concat(A.feed().map((p) => p.text), spoken).join("\n");
ok(!/[—–·•]/.test(allText), "no em dashes or middle dots in news, posts or lines");

console.log((fails ? "FAIL" : "PASS") + " phone-check: " + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
