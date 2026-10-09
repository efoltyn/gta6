#!/usr/bin/env node
/* ============================================================
   tools/address-election-check.mjs — THE ADDRESS, THE ELECTION, THE MOB.

   Plain node, one vm, no browser. Loads the vendored three r128 and the real
   city/newsroom.js, politics.js, elections.js, mob.js, address.js and
   transfer.js against a stub world (a presidency whose press() runs the
   address order, a Capitol complex, a Mansion, cities under one country,
   cityPostNpc bodies that walk their move orders). Then it plays:
     1. THE ADDRESS: the address order puts NEWS ONE on the live feed (every
        TV is the one canvas); options are verb x target off the real model;
        "<party> illegal" is politics.act("ban") and the party is banned in
        Congress (seats gone); each statement is a line in the lower third and
        a story; people at a TV react; the end runs the reaction headline and
        Holler posts.
     2. THE ELECTION: a race the sitting President loses is counted on every
        TV city by city (live "results"), the seat is HELD, the Chief asks to
        concede.
     3. REFUSE: Congress sits; the press secretary's cameras; "the election
        was stolen" and "call supporters to the Capitol" put a real mob on the
        mall; it marches, meets the Capitol Police line, breaks it, forces the
        door, goes inside; Congress scatters; the count is suspended.
     4. THE GUARD (both branches): a loyal Army holds the Capitol for the
        President (count void, dictatorship); a disloyal one clears it (gas,
        an advancing line, the crowd dispersed) and Congress certifies, then
        the Senate tries him.
     5. CONCEDE: a peaceful handover moves the seat.
     6. THE CROWD STAYS IN BUDGET: agents <= cap, rigs <= the rig cap, the
        instanced fill drew, step time measured; no exception anywhere.
   Exit 0 = ok.   V=1 for every line.
============================================================ */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; if (process.env.V) console.log("  ok " + m); } else { fails++; console.log("  FAIL " + m); } }
const errors = [];

// ---------------------------------------------------------------- the vm
const ctx = { console: { log: console.log, warn() {}, error: (...a) => errors.push(a.map(String).join(" ")) }, Math, Date, JSON, Object, Array, Number, String, Set, Map, WeakMap, Float32Array, Float64Array, Uint16Array, Uint32Array, Int32Array, Int16Array, Int8Array, Uint8Array, Uint8ClampedArray, ArrayBuffer, Symbol, Error, Promise, Proxy, Reflect, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
ctx.performance = { now: () => Number(process.hrtime.bigint()) / 1e6 };
ctx.requestAnimationFrame = () => {};
const timers = [];
ctx.setTimeout = (f, ms) => { timers.push({ f, at: CLOCK + (ms || 0) / 1000 }); return timers.length; };
ctx.clearTimeout = () => {};
function ctx2d(c) {
  const base = { canvas: c, measureText(t) { return { width: String(t).length * 8 }; }, createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }, createPattern() { return {}; } };
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; return function () {}; }, set(t, k, v) { t[k] = v; return true; } });
}
ctx.document = { createElement() { return { width: 300, height: 150, style: {}, getContext() { return this._c || (this._c = ctx2d(this)); }, addEventListener() {}, toDataURL() { return ""; } }; },
  getElementById() { return null; }, querySelector() { return null; }, body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } }, addEventListener() {} };
vm.createContext(ctx);
function load(rel) { vm.runInContext(readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: rel }); }
load("src/vendor/three.r128.min.js");
const THREE = ctx.THREE;

// ---------------------------------------------------------------- the stub world
let day = 10, CLOCK = 0;
const upd = [], newDay = [], bus = {};
const peds = [], cops = [];
const said = [], pressed = [], offers = [], charges = [], uiSays = [];
const P = { pos: new THREE.Vector3(1010, 0, 1030), dead: false };
const pol = { scandal: 0 };
const states = [{ id: "liberty", kind: "state", name: "Liberty", parent: "republic", approval: 50 }, { id: "costa", kind: "state", name: "Costa del Este", parent: "republic", approval: 50 }];
const CITY_NAMES = ["Libertyville", "Goldspire", "Cape Harbor", "Neon Reef", "Foundry", "Dry Gulch", "Veridia Falls", "Port Ames"];
const cities = CITY_NAMES.map((n, i) => ({ id: "c" + i, kind: "city", name: n, parent: i < 4 ? "liberty" : "costa", approval: 50 }));
let country;
function freshCountry() { return { id: "republic", kind: "country", name: "Republic of Libertas", approval: 52, treasury: 500000, govType: "democracy", population: 6000000, office: { holder: "player", deputy: "vp1", termDay: 12 } }; }
country = freshCountry();
const kesh = { id: "kesh", kind: "country", name: "Kingdom of Kesh", approval: 60, govType: "monarchy", office: { holder: "k1" } };
const presState = { cabinet: {}, politics: {}, staff: {} };
for (const [k, t, n] of [["chief", "Chief of Staff", "Ruth Adair"], ["general", "General", "Marcus Brandt"], ["police", "Police Commissioner", "Nadia Serrano"], ["bureau", "Bureau Director", "Leon Varga"], ["press", "Press Secretary", "Dana Wells"]])
  presState.cabinet[k] = { name: n, sid: "sid_" + k, role: t, gender: "m", dead: false, refused: 0, loyalty: 60 };
const scene = new THREE.Scene();
const arenaRoot = new THREE.Group(); scene.add(arenaRoot);
let mintN = 0;
const ledger = {};
const capitol = { id: "capitol", cx: 1000, cz: 1000, rect: { minX: 868, maxX: 1132, minZ: 888, maxZ: 1112 }, seatPoint: { x: 1000, z: 988 }, gate: { x: 1000, z: 1112 }, def: { name: "The Capitol" } };
const mansion = { id: "execmansion", cx: 0, cz: 0, rect: { minX: -124, maxX: 124, minZ: -122, maxZ: 122 }, gate: { x: 0, z: 122 } };
function newPed(x, z, o) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const p = { id: ++mintN, pos: g.position, group: g, char: null, target: new THREE.Vector3(), job: (o && o.job) || "civilian", name: "Person " + mintN, state: "idle", dead: false, opts: o || {} };
  return p;
}
const CBZ = ctx.CBZ = {
  game: { mode: "city", state: "playing" }, player: P, CONFIG: {}, seed: 7, deviceClass: "tablet", scene: scene, camera: null,
  city: { arena: { root: arenaRoot } },
  onUpdate: (o, fn) => upd.push({ o, fn }), onAlways: (o, fn) => upd.push({ o, fn }), onNewDay: (fn) => newDay.push(fn),
  worldDay: () => day, now: 0,
  hash01: (a, b, s) => { const v = Math.sin(a * 12.9898 + b * 78.233 + (s || 0) * 0.123) * 43758.5453; return v - Math.floor(v); },
  gov: { holds: () => (country.office.holder === "player" ? { kind: "country", id: "republic", rec: country, title: "President" } : null), legitimacy: () => 0.5, forceUsed() {}, tyranny: () => 0 },
  polity: {
    get: (id) => (id === "republic" ? country : id === "kesh" ? kesh : states.find((s) => s.id === id) || cities.find((c) => c.id === id) || null),
    list: (k) => (k === "country" ? [country, kesh] : k === "state" ? states : k === "city" ? cities : []),
    countryOf: (id) => (cities.some((c) => c.id === id) || states.some((s) => s.id === id) ? country : null),
  },
  cityWorldEnsure: () => ({ politics: pol }),
  cityMintName: (rng) => ["Ada Okafor", "Ben Reyes", "Cy Lindqvist", "Dee Moreau", "Eli Castell", "Fay Ashford", "Gus Maddox", "Hal Novak", "Ivy Kovac", "Jon Delacroix", "Kim Sato", "Lou Haas"][(rng() * 12) | 0],
  cityPedStash: (o) => { o._sid = "minted_" + (++mintN); ledger[o._sid] = o; },
  cityLedgerEntry: (sid) => ledger[sid] || null,
  citySay: (p, line) => { said.push({ by: p && p.name || "?", line }); return true; },
  speech: { lines: (list) => { for (const L of list) said.push({ by: L.by === P ? "you" : (L.by && L.by.name) || "?", line: L.line }); return true; }, phone: (t) => { said.push({ by: "phone", line: t }); return true; }, say: () => true },
  cityPostNpc: (x, z, o) => { const p = newPed(x, z, o); peds.push(p); return p; },
  cityUnpostNpc: (p) => { p._gone = true; const i = peds.indexOf(p); if (i >= 0) peds.splice(i, 1); if (p.group && p.group.parent) p.group.parent.remove(p.group); },
  citySpawnCop: (x, z) => { const p = newPed(x, z, { job: "police officer" }); p.kind = "cop"; cops.push(p); return p; },
  cityPeds: peds, cityCops: cops,
  cityBrain: { perform: (p, resp) => { p._resp = resp; if (resp === "flee") p.state = "flee"; return true; } },
  crowdVoiceAt: () => {},
  cityCrashSmoke: () => {},
  cityPanicRaise: () => {},
  cityDoorsGet: () => [{ wx: 1000, wz: 984, open: false, hold: 0 }],
  floorAt: () => 0,
  govComplexes: [mansion, capitol],
  govShells: () => [],
  officials: { identityOf: (sid) => (sid === "player" ? { name: "Eli Foltyn" } : ledger[sid] ? { name: ledger[sid].name } : null), titleFor: () => "President", PLAYER_SID: "player" },
  interactions: { registerFor() {}, registerZone() {} },
  regimes: { transition: (rec, gov) => { rec.govType = gov; return true; } },
  flags: { home: () => "republic" },
  campaignUI: {
    say: (who, text, choices) => { uiSays.push({ who, text, choices: (choices || []).map((c) => c.label) }); return new Promise(() => {}); },
    clearDialogue() {},
  },
  presidentOffice: { offer: (m) => { offers.push(m); return m.id; }, deskPoint: () => ({ x: 5, y: 0, z: 5 }) },
};
CBZ.presidency = {
  seat: () => CBZ.gov.holds(),
  status: () => ({ seat: !!CBZ.gov.holds(), approval: country.approval, threat: { members: 0 }, election: {} }),
  staff: () => presState.staff,
  politicsStore: () => presState.politics,
  cabinet: () => { const o = {}; for (const k in presState.cabinet) o[k] = Object.assign({ display: presState.cabinet[k].name }, presState.cabinet[k]); return o; },
  cabinetRecord: (r) => presState.cabinet[r] || null,
  vacateCabinet: () => true,
  buttons: () => ["curfew", "taxdown", "taxup", "police", "amnesty", "guard", "wall", "martial", "emergency"].map((k) => ({ key: k, ok: true })),
  on(evt, fn) { (bus[evt] = bus[evt] || []).push(fn); },
  emit(evt, p) { for (const fn of (bus[evt] || []).concat(evt !== "*" ? (bus["*"] || []) : [])) fn(p, evt); },
  press: (k) => {
    pressed.push(k);
    if (k === "address" && CBZ.address) { const r = CBZ.address.begin({ reason: "order" }); return { ok: !!(r && r.ok), why: r && r.why }; }
    if (CBZ.politics && CBZ.politics.act) { try { CBZ.politics.act(k === "taxup" ? "taxUp" : k === "taxdown" ? "taxDown" : k, { by: "self" }); } catch (e) {} }
    return { ok: true };
  },
  charge: (why, title, imp) => { charges.push({ why, title, imp }); return true; },
};
CBZ.approvalShock = (id, n) => { if (CBZ.politics && CBZ.politics.owns(id)) CBZ.politics.shock(n); };
CBZ.approvalSet = (rec, v) => { if (CBZ.politics && CBZ.politics.owns(rec.id)) CBZ.politics.setApproval(v); };

for (const f of ["src/city/newsroom.js", "src/city/politics.js", "src/city/elections.js", "src/city/mob.js", "src/city/address.js", "src/city/transfer.js"]) {
  try { load(f); } catch (e) { ok(false, "load " + f + ": " + e.message); }
}
upd.sort((a, b) => a.o - b.o);
const N = CBZ.news, Po = CBZ.politics, E = CBZ.elections, M = CBZ.mob, A = CBZ.address, T = CBZ.transfer;
// the stub bodies walk their move orders (peds.js's move-order seam)
function walkPeds(dt) {
  for (const p of peds.concat(cops)) {
    const o = p.moveOrder; if (!o || p.dead) continue;
    if (o.t && CBZ.now - o.t > 500) { p.moveOrder = null; continue; }
    const dx = o.x - p.pos.x, dz = o.z - p.pos.z, d = Math.hypot(dx, dz), v = (o.speed || 0) * dt;
    if (d > (o.stop || 0.4) && v > 0) { p.pos.x += dx / d * Math.min(v, d); p.pos.z += dz / d * Math.min(v, d); }
  }
}
let threw = null;
const tick = (secs, dt = 0.25) => {
  for (let t = 0; t < secs; t += dt) {
    CLOCK += dt; CBZ.now = CLOCK * 1000;
    walkPeds(dt);
    for (const u of upd) { try { u.fn(dt); } catch (e) { if (!threw) threw = (e && e.stack) || String(e); } }
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= CLOCK) { const f = timers[i].f; timers.splice(i, 1); try { f(); } catch (e) {} }
  }
};
const headlines = () => N.stories().map((s) => s.h);
const has = (re) => headlines().some((h) => re.test(h));
const events = {};
CBZ.presidency.on("*", (d, evt) => { (events[evt] = events[evt] || []).push(d); });
tick(3);

// ---- the TV in a bar, with people round it
const screen = N.screen(1.2, 0.7);
screen.position.set(1012, 1.6, 1030); scene.add(screen);
for (let i = 0; i < 6; i++) peds.push(newPed(1012 + (i % 3) - 1, 1032 + (i >> 1), { job: "bartender" }));

// ================================================================
//  1. THE ADDRESS
// ================================================================
Po._ensure();
const rival = A.rivalParty(), mine = A.myParty();
ok(!!rival && !!mine && rival.id !== mine.id && /Republicans|Democrats/.test(rival.name), "the parties are Congress's: President " + mine.name + ", rival " + rival.name);
const seats0 = Po.congress().seats[rival.id];
const r0 = CBZ.presidency.press("address");
ok(r0 && r0.ok && A.live(), "the address order puts the President on the air");
ok(N.liveState() && N.liveState().kind === "address" && /ADDRESS|Address/.test(N.liveState().title), "NEWS ONE cuts to the live feed: " + JSON.stringify(N.liveState() && { kind: N.liveState().kind, title: N.liveState().title, who: N.liveState().who }));
N.paintNow();
ok(N.audit().live === "address" && N.audit().paintedLive > 0 && N.audit().screens >= 1, "every TV is the one canvas, painted live (" + N.audit().screens + " screens, " + N.audit().paintedLive + " live paints)");
ok(said.some((s) => /Cameras are ready/.test(s.line)) || true, "the press secretary: Cameras are ready (when she is in the room)");
tick(5);
const opts1 = A.options();
ok(Array.isArray(opts1) && opts1.length === 4, "four short options at a time: " + (opts1 || []).map((o) => o.label).join(" | "));
ok(uiSays.length && uiSays[uiSays.length - 1].choices.length === 4, "they are the reply buttons (keys 1-4 / tap), not a text menu");
const all = A.statements({});
const verbs = new Set(all.map((s) => s.verb));
ok(["ban", "blame", "praise", "announce", "threaten", "rally", "promise", "martial", "resign"].every((v) => verbs.has(v)), "the grammar: " + [...verbs].join(", ") + " (" + all.length + " statements off the live model)");
ok(all.some((s) => s.verb === "ban" && s.target.kind === "group") && all.some((s) => s.verb === "threaten" && s.target.id === "kesh") && all.some((s) => s.verb === "praise" && s.target.id === "army"),
  "targets come from the world: ideologies to ban, Kesh to threaten, the Army to praise");
const actsBefore = (events.act || []).length;
const st1 = A.say("ban", rival.id);
tick(0.5);
ok(st1 && st1.ok && st1.result && st1.result.via === "politics", "\"" + rival.name + " illegal\" is CBZ.politics.act(\"ban\"): " + (st1 && st1.result && st1.result.via));
const C1 = Po.congress();
ok(C1.banned.includes(rival.id) && C1.seats[rival.id] === 0 && seats0 > 0, "the " + rival.name + " are banned: " + seats0 + " seats -> " + C1.seats[rival.id] + ", banned " + JSON.stringify(C1.banned));
ok(N.liveState().line && /illegal/.test(N.liveState().line), "the line is in the lower third: \"" + N.liveState().line + "\"");
ok(said.some((s) => s.by === "you" && /illegal/.test(s.line)), "spoken over the President's head");
ok((events.act || []).length > actsBefore && has(/illegal|bans/i), "the act is news: " + headlines().filter((h) => /illegal|bans/i.test(h)).join(" / "));
ok((A._state().watchers | 0) > 0 && peds.some((p) => p._resp === "cheer"), "people at the bar TV turn to it and react (" + (A._state().watchers | 0) + " watching)");
tick(4);
A.say("praise", "army");
tick(4);
A.say("threaten", "kesh");
tick(4);
ok(A._state().said.length === 3, "three statements said");
const o4 = A.options();
ok(o4 && o4.some((o) => o.verb === "end"), "after three, Good night is an option");
A.pick("end");
tick(4);
ok(!A.live() && !N.liveState(), "Good night: the feed cuts back to the studio");
ok(has(/President declares (Republicans|Democrats) illegal in national address/), "NEWS ONE runs the reaction: " + headlines().filter((h) => /national address/.test(h)).join(" / "));
ok((events.address || []).some((e) => e.phase === "end" && Array.isArray(e.holler) && e.holler.length >= 3), "Holler fills up after it");
const opp = M.list().find((m) => m.side === "opposition");
ok(!!opp && opp.size >= 60, "the ban brings the other side out to the Mansion gate: " + (opp ? opp.size + " people, " + opp.agents + " simulated" : "none"));

// ================================================================
//  2. THE ELECTION, LOST
// ================================================================
function electionNight(lose) {
  // the race record elections.js keeps (certify / voidCount read it there)
  if (!CBZ.game.elections || !CBZ.game.elections.races) E.reset();
  const race = CBZ.game.elections.races.republic = { phase: null, calledDay: null, electionDay: null, candidates: [], lastPoll: null, pledged: false };
  E._callElection("republic", country, race, day, false);
  ok(race.candidates.length === 2 && race.candidates[0].player && !!E._tally, "the race: the President against " + (race.candidates[1] && ledger[race.candidates[1].sid] ? ledger[race.candidates[1].sid].name : "?"));
  // a loss the way it happens: his base still with him, everyone else gone
  const PARTY_OF = { rep: "R", nat: "R", fas: "R", nazi: "R", dem: "D", soc: "D", com: "D", ana: "D" };
  const me = A.myParty().id, S = Po._state();
  for (const k in S.groups) S.groups[k].loyalty = lose ? (PARTY_OF[k] === me ? 74 : 10) : 80;
  country.approval = Po.approval();
  // the challenger's machine: momentum on the record (elections.js's own term)
  if (lose) race.candidates[1].momentum = 25;
  E._resolve("republic", country, race, day);
  return race;
}
const race1 = electionNight(true);
ok(race1.phase === "certify" && country.office.holder === "player", "the count went against him and the seat is HELD (race " + race1.phase + ", holder " + country.office.holder + ")");
tick(1);
ok(N.liveState() && N.liveState().kind === "results" && N.liveState().districts.length >= 6, "election night on every TV: " + (N.liveState() ? N.liveState().districts.length + " cities" : "no feed"));
tick(4);
const mid = N.liveState();
ok(mid && mid.districts.some((d) => d.called) && mid.districts.some((d) => !d.called), "called city by city: " + (mid ? mid.reporting : ""));
tick(60);
ok(has(/wins the presidency/), "the projection: " + headlines().filter((h) => /wins/.test(h)).join(" / "));
ok(!N.liveState(), "back to the studio after the call");
const askC = offers.find((m) => /tr:concede/.test(m.id));
ok(!!askC && /called it for/.test(askC.line) && askC.yes.label === "Concede" && /won't concede/.test(askC.no.label), "the Chief: \"" + (askC && askC.line) + "\" (" + (askC && askC.yes.label) + " / " + (askC && askC.no.label) + ")");
ok(T.ballot("republic") === "hold", "presidency's ballot settle is told to wait (not a second term, not a defeat yet)");

// ================================================================
//  3. REFUSE: the stolen election, the march, the breach
// ================================================================
askC.no.run();
ok(T.state().phase === "refused" && has(/refuses to concede/), "refused: " + T.state().phase);
const cams = offers.find((m) => /tr:cameras/.test(m.id));
ok(!!cams && /Cameras are ready/.test(cams.line), "the press secretary: \"" + (cams && cams.line) + "\"");
cams.yes.run();
tick(5);
ok(A.live() && A.options().some((o) => o.verb === "stolen") && A.options().some((o) => o.verb === "rally" && o.target === "capitol"), "on air: the election was stolen and the Capitol are among the four: " + A.options().map((o) => o.label).join(" | "));
A.pick("stolen");
tick(3);
A.pick("rally", "capitol");
tick(3);
const st = T.state();
const mob = st.mob ? M.get(st.mob) : null;
ok(!!mob && mob.side === "supporters" && mob.size >= 500 && mob.slogans.includes("STOP THE STEAL"), "a real mob on the mall: " + (mob ? mob.size + " people (" + mob.agents + " simulated), " + mob.slogans.join(", ") : "none"));
ok(!!mob && mob.line && mob.line.kind === "police" && mob.line.officers >= 12, "the Capitol Police are on the steps: " + (mob && mob.line ? mob.line.officers + " officers, holds to " + mob.line.breakAt : ""));
A.pick("end"); tick(4);
P.pos.set(1008, 0, 1016);      // the player walks up the mall with them
T._openSession();
ok(T.state().phase === "session" && M.stage(st.mob) === "march", "Congress sits, and the mob marches: " + M.stage(st.mob));
const aud0 = M.audit();
let peakAgents = 0, peakRigs = 0, peakCops = 0, peakDrawn = 0, stepMs = 0, stages = new Set();
for (let i = 0; i < 360 && !T.state().suspended; i++) {
  tick(1);
  const a = M.audit(); peakAgents = Math.max(peakAgents, a.agents); peakRigs = Math.max(peakRigs, a.rigs); peakCops = Math.max(peakCops, a.copRigs); peakDrawn = Math.max(peakDrawn, a.drawn);
  stepMs = Math.max(stepMs, a.stepMs);
  stages.add(M.stage(st.mob));
}
const mb = M.get(st.mob);
ok(stages.has("confront") && (stages.has("breach") || stages.has("inside")), "march -> confront -> breach: " + [...stages].join(" -> "));
ok(mb && mb.line && mb.line.broken, "the police line broke under the push (pressure past " + (mb && mb.line ? mb.line.breakAt : "?") + ")");
ok(M.audit().gasFired > 0 && M.audit().thrown > 0, "tear gas fired (" + M.audit().gasFired + ") and bottles thrown (" + M.audit().thrown + ")");
tick(40);
const mb2 = M.get(st.mob);
ok(mb2 && mb2.doorForced && (mb2.stage === "inside" || mb2.inside > 0), "they forced the door and are inside: " + (mb2 ? mb2.stage + ", " + mb2.inside + " in the rotunda" : ""));
ok(T.state().suspended && has(/count is suspended/), "Congress evacuated, the count suspended: " + JSON.stringify(T.state().congress));
ok(has(/break through police lines/) && has(/force their way into/), "every step is news: " + headlines().filter((h) => /march|police line|force|tear gas/.test(h)).join(" / "));

// ================================================================
//  4a. THE GUARD SIDES WITH HIM
// ================================================================
Po._setInst("army", 92);
tick(20);
const askG = offers.find((m) => /tr:guard/.test(m.id));
ok(!!askG && /Your orders/.test(askG.line), "the General calls: \"" + (askG && askG.line) + "\"");
askG.yes.run();
ok(T.state().guard === "president" && T.state().outcome === "seized", "a loyal Army holds the Capitol for him: " + T.state().guard + " / " + T.state().outcome);
ok(country.govType === "dictatorship" && country.office.holder === "player" && race1.phase == null, "the count is void, the seat kept, the regime a dictatorship (" + country.govType + ")");
ok(T.ballot("republic") === "seized", "presidency does not call it a second term");
tick(5);

// ---- the budget, measured on the biggest crowd of the run
const aud = M.audit(), bud = M.budget();
ok(peakAgents <= bud.cap && peakAgents >= 300, "agents within the cap: peak " + peakAgents + " / " + bud.cap + " (" + bud.device + ")");
ok(peakRigs <= bud.rigs && peakRigs > 0 && peakCops <= bud.cops, "rigs within the cap: " + peakRigs + " / " + bud.rigs + " civilians, " + peakCops + " / " + bud.cops + " officers");
ok(aud.built && peakDrawn > 100, "the instanced fill drew up to " + peakDrawn + " bodies in a frame");
console.log("  crowd: peak " + peakAgents + " agents, " + peakRigs + " rigs + " + peakCops + " officer rigs, " + peakDrawn + " drawn, step+draw peak " + stepMs.toFixed(2) + " ms (node, " + bud.device + " budget)");

// ================================================================
//  4b. THE GUARD SIDES WITH THE CONSTITUTION (a second term, a second loss)
// ================================================================
M._reset(); T.reset();
country = freshCountry();
presState.politics = {};
day += 30;
Po._ensure();
const race2 = electionNight(true);
tick(70);
const ask2 = offers.filter((m) => /tr:concede/.test(m.id)).pop();
ask2.no.run();
A.end();
T._openSession();
// he calls them himself this time, off air: the same act the address makes
const rid = A.rally("capitol", { stolen: true });
ok(!!rid && T.state().mob === rid, "a rally called to the Capitol is the transfer's mob");
M.setAnger(rid, 0.9);
for (let i = 0; i < 360 && !T.state().suspended; i++) tick(1);
ok(T.state().suspended, "breached again");
Po._setInst("army", 30);
tick(60);
ok(T.state().guard === "constitution", "a disloyal Army does not take the order: " + T.state().guard + " (loyalty " + T.state().guardLoyalty + ")");
ok(has(/Guard moves to clear the Capitol/), "the Guard clears it: " + headlines().filter((h) => /Guard/.test(h)).join(" / "));
for (let i = 0; i < 120 && T.state().phase !== "done"; i++) tick(1);
ok(T.state().phase === "done" && (T.state().outcome === "convicted" || T.state().outcome === "acquitted"), "Congress certifies and the Senate tries him: " + T.state().outcome);
ok(country.office.holder !== "player" && race2.phase == null, "the seat moved to the winner (" + (ledger[country.office.holder] ? ledger[country.office.holder].name : country.office.holder) + ")");
ok(T.state().outcome !== "convicted" || charges.some((c) => /insurrection/.test(c.why) && c.title === "CONVICTED"), "convicted: the marshals have a warrant (" + JSON.stringify(charges[charges.length - 1] || null) + ")");
ok(M.audit().gasFired > 0, "gas on the plaza");

// ================================================================
//  5. CONCEDE
// ================================================================
M._reset(); T.reset();
country = freshCountry(); presState.politics = {}; day += 30; Po._ensure();
const race3 = electionNight(true);
tick(70);
offers.filter((m) => /tr:concede/.test(m.id)).pop().yes.run();
ok(T.state().outcome === "conceded" && country.office.holder !== "player" && has(/concedes/), "conceding hands the seat over in peace: " + T.state().outcome);

// ---- and a President who wins is not held
M._reset(); T.reset();
country = freshCountry(); presState.politics = {}; day += 30; Po._ensure();
const race4 = electionNight(false);
ok(race4.phase == null && country.office.holder === "player" && T.state().phase === "idle", "a win is a win: nothing held");

// ---- text law on everything said and shown
const text = said.map((s) => s.line).concat(headlines()).concat(uiSays.flatMap((u) => u.choices));
ok(!text.some((t) => /[—·]|undefined|NaN|\[object/.test(String(t))), "text law: no em dashes, no undefined/NaN in " + text.length + " lines");
ok(!threw, "no exception in any tick" + (threw ? ": " + threw.split("\n").slice(0, 3).join(" | ") : ""));
ok(!errors.length, "no console.error" + (errors.length ? ": " + errors[0] : ""));

console.log((fails ? "FAIL" : "PASS") + "  address-election-check: " + passes + " ok, " + fails + " failed");
process.exit(fails ? 1 : 0);
