#!/usr/bin/env node
/* ============================================================
   tools/president-staff-check.mjs — THE PRESIDENT'S PEOPLE.

   OWNER (2026-10-01): "interaction is dumb. This whole hire and fire thing."

   Plain node. Loads the real city/newsroom.js, city/phone_apps.js,
   city/president_staff.js and city/dissent.js into a vm with a stub world: a
   presidency whose cabinet records behave like presidency.js's (vacate /
   fill / cabinetRecord / bus), polwar's military, the Oval Office frame,
   cityPostNpc, the interactions registry. Then it plays the presidency:
     1. a fresh presidency is STAFFED: press secretary, driver, a full
        cabinet; no job line, no Hire verb anywhere, nothing open
     2. Dismiss is on the person: the Situation Room General's wheel has it;
        two lines over heads; NEWS ONE runs "General <name> resigns/fired";
        readiness drops (and keeps dropping for days); approval and scandal
        move; the man persists as a former, and comes back on Holler
     3. the Chief brings TWO names: "Two names for General. A is loyal. B is
        good." E is the first name, the wheel the second
     4. the trade-off: the loyal pick has obedience, a capped army line and
        weaker results; the good pick has better results and a grudge that
        grows every day
     5. the Treasury Secretary (no body anywhere) is dismissed by phone
     6. refusals feed loyalty, loyalty feeds the army ladder and the coup
        risk; a disloyal General dismissed PLOTS and is the coup's plotter
     7. the Bureau Director's dismissal stops the investigation
     8. the press secretary is not a button: she briefs by herself, repeated
        scandals spend her; dismissing her makes news and a leak
     9. the Chief himself is replaced the same way; his style changes what
        reaches the desk
    10. text law: no em dashes, no "Hire", no "Candidate N", no old lines
   Exit 0 = ok.
============================================================ */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; if (process.env.V) console.log("  ok " + m); } else { fails++; console.log("  FAIL " + m); } }

// ---------------------------------------------------------------- stub world
let day = 1;
const upd = [], newDay = [], bus = {};
const peds = [];
const said = [];          // every over-head / phone line
const shocks = [];
const coups = [];
const P = { pos: { x: 0, y: 10, z: 18 }, dead: false };
const office = {
  key: "ovaloffice", floorY: 10,
  approach: { x: 0, z: 0, nx: 0, nz: 1, tx: 1, tz: 0, depth: 24, span: 12 },
  landmarks: { presidentialDesk: { x: 0, z: 20 }, arrivalPortal: { x: 0, z: 6 } },
};
const country = { id: "republic", kind: "country", name: "Republic of Libertas", approval: 52, treasury: 100000, govType: "democracy", office: { holder: "player", deputy: "vp1" } };
const mil = { readiness: 0.6, soldiers: 1000 };
const pol = { scandal: 0 };
const presState = { staff: null, cabinet: null, intelKnown: true, raid: null };
const TITLES = { chief: ["Chief of Staff", ""], general: ["General", "General"], bureau: ["Bureau Director", "Director"], police: ["Police Commissioner", "Commissioner"], treasury: ["Treasury Secretary", "Secretary"] };
const NAMES = { chief: "Ruth Adair", general: "Marcus Brandt", bureau: "Leon Varga", police: "Nadia Serrano", treasury: "Oscar Whitlock" };
presState.cabinet = {};
for (const k in NAMES) presState.cabinet[k] = { name: NAMES[k], sid: "sid_" + k, role: TITLES[k][0], gender: "m", dead: false, refused: 0, loyalty: 60, trait: null };
const officerPeds = {};
const sur = (n) => String(n).split(" ").pop();
let mintN = 0;
const CBZ = {
  game: { mode: "city", state: "playing" }, player: P, CONFIG: {},
  onUpdate: (o, fn) => upd.push({ o, fn }), onAlways: (o, fn) => upd.push({ o, fn }),
  onNewDay: (fn) => newDay.push(fn),
  worldDay: () => day,
  gov: { holds: () => (country.office.holder === "player" ? { kind: "country", id: "republic", rec: country } : null) },
  polity: { get: (id) => (id === "republic" ? country : null), list: (k) => (k === "country" ? [country] : []) },
  polwar: { militaryOf: () => mil },
  approvalShock: (id, n) => { shocks.push(n); country.approval += n; },
  cityWorldEnsure: () => ({ politics: pol }),
  cityMintName: (rng) => ["Okafor", "Reyes", "Lindqvist", "Moreau", "Castell", "Ashford", "Maddox", "Novak", "Kovac", "Delacroix"].map((s, i) => ["Ada", "Ben", "Cy", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jon"][i] + " " + s)[(rng() * 10) | 0],
  cityPedStash: (o) => { o._sid = "minted_" + (++mintN); },
  citySay: (p, line) => { said.push({ by: p.name || "?", line }); p._said = line; return true; },
  sayLines: (list, end) => { for (const L of list) said.push({ by: L.by === P ? "you" : (L.by && L.by.name) || "?", line: L.line, aloud: !!L.aloud }); if (end) end(); return {}; },
  speech: { phone: (t) => { said.push({ by: "phone", line: t }); return true; } },
  cityPostNpc: (x, z, o) => { const p = { pos: { x, y: o.floorY || 0, z }, group: { rotation: {} }, target: { set() {} }, job: o.job, gender: o.gender, opts: o }; peds.push(p); return p; },
  cityUnpostNpc: (p) => { p._gone = true; const i = peds.indexOf(p); if (i >= 0) peds.splice(i, 1); },
  interactions: { registerFor: (p, o) => { (p._iopts || (p._iopts = [])).push(o); } },
  presidentInteriorRooms: () => [office],
  civilwar: { coup: (id, kind, plotterSid) => { coups.push({ kind, plotterSid }); return { outcome: kind }; } },
  warroom: { nation: () => "republic", enemy: () => null, warheads: () => 0, canWar: () => ({ ok: false }) },
  officials: { identityOf: (sid) => ({ player: { name: "Eli Foltyn" }, vp1: { name: "Leon Brandt" } }[sid] || null), titleFor: () => "President" },
};
CBZ.presidency = {
  seat: () => CBZ.gov.holds(),
  staff: () => presState.staff || (presState.staff = {}),
  cabinet: () => {
    const out = {};
    for (const k in presState.cabinet) {
      const c = presState.cabinet[k];
      out[k] = { name: c.name, sid: c.sid, gender: c.gender, dead: !!c.dead, loyalty: c.loyalty, trait: c.trait, display: TITLES[k][1] ? TITLES[k][1] + " " + sur(c.name) : c.name };
    }
    out.vp = { name: "Leon Brandt", display: "Vice President Brandt", sid: "vp1" };
    return out;
  },
  cabinetRecord: (role) => presState.cabinet[role] || null,
  vacateCabinet: (role, opts) => {
    const c = presState.cabinet[role]; if (!c) return false;
    c.dead = true; c.vacant = true;
    const p = officerPeds[role]; officerPeds[role] = null;
    if (opts && opts.keep && p) return p;
    if (p) CBZ.cityUnpostNpc(p);
    return true;
  },
  fillCabinet: (role, who) => { presState.cabinet[role] = { name: who.name, sid: who.sid, role: TITLES[role][0], gender: who.gender || "m", dead: false, refused: 0, loyalty: who.loyalty, trait: who.trait }; return true; },
  bureauStop: () => { presState.intelKnown = false; return true; },
  bureauIntel: (v) => { presState.intelKnown = !!v; return true; },
  on(evt, fn) { (bus[evt] = bus[evt] || []).push(fn); },
  emit(evt, p) { for (const fn of (bus[evt] || []).concat(evt !== "*" ? (bus["*"] || []) : [])) fn(p, evt); },
  press: () => ({ ok: true }),
};
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { return this.set(v.x, v.y, v.z); } }
const THREE = { CanvasTexture: class {}, MeshBasicMaterial: class {}, PlaneGeometry: class {}, Mesh: class {}, Group: class {}, Vector3: V3, Vector2: class {}, Matrix4: class {}, Quaternion: class {}, Euler: class {} };
const sb = { window: null, CBZ, THREE, console, Math, Object, Array, Set, Map, JSON, isFinite, Number, String, Date, Infinity, parseInt, setTimeout: (f) => f(), clearTimeout() {} };
sb.window = sb;
vm.createContext(sb);
for (const f of ["src/city/newsroom.js", "src/city/phone_apps.js", "src/city/president_staff.js", "src/city/dissent.js"]) {
  vm.runInContext(readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
}
upd.sort((a, b) => a.o - b.o);
const PS = CBZ.presidentStaff, A = CBZ.phoneApps, N = CBZ.news, D = CBZ.dissent;
const tick = (secs, dt = 0.25) => { for (let t = 0; t < secs; t += dt) for (const u of upd) u.fn(dt); };
const nextDay = () => { day++; for (const fn of newDay) fn(day); tick(2); };
const live = () => peds.filter((p) => !p._gone);
const opt = (p, id) => (p && p._iopts || []).find((o) => o.id === id);
const label = (o) => (typeof o.label === "function" ? o.label() : o.label);
const headlines = () => (N ? N.stories().map((s) => s.h) : []);
const cabRec = (r) => presState.cabinet[r];
// the Situation Room's officer at his table (presidency.js postOfficer wires Dismiss the same way)
function postOfficer(role) {
  const c = CBZ.presidency.cabinet()[role];
  const p = CBZ.cityPostNpc(40, 40, { job: role });
  p.name = c.display; p._presOfficer = role;
  officerPeds[role] = p;
  PS.wire(p, role);
  return p;
}
// pick a name through the Chief in the office, until one is confirmed
function fillWith(role, which) {
  for (let i = 0; i < 6; i++) {
    tick(2);
    const nm = PS.nominee();
    if (!nm) { nextDay(); continue; }
    if (nm.role !== role) return null;
    const chief = live().find((p) => p._presStaff === "chief" && !p._gone);
    const o = chief && opt(chief, which === 0 ? "pres-chief-name-a" : "pres-chief-name-b");
    const r = o && o.canShow() ? (o.onSelect(chief), null) : PS.pick(which);
    if (!PS.vacant(role)) return cabRec(role) || presState.staff.press;
    nextDay();
  }
  return null;
}

// ---- 1. staffed on day one ------------------------------------------------------
tick(2);
const st = PS.audit();
ok(!!st.press && !!st.driver, "a fresh presidency has a press secretary and a driver: " + st.press + " / " + st.driver);
ok(st.vacant.length === 0 && !st.nominee, "no chair is open and nobody is waiting with names: " + st.vacant);
ok(typeof PS.line === "undefined" && typeof PS._hire === "undefined", "the job line and its Hire hook are gone");
const chief = live().find((p) => p._presStaff === "chief");
const pressBody = live().find((p) => p._presStaff === "press");
ok(!!chief && chief.name === "Ruth Adair", "the Chief of Staff stands in the office");
ok(!!pressBody && pressBody.name === st.press, "the press secretary is at her desk");
ok(!live().some((p) => (p._iopts || []).some((o) => /hire|send-away|brief|chief-fire/.test(o.id))), "no Hire, Send away, Brief or Fire verb on anybody");
ok(opt(chief, "pres-chief-talk") && opt(chief, "pres-chief-talk").slot === "e" && opt(chief, "pres-dismiss-chief") && !opt(chief, "pres-dismiss-chief").slot, "the Chief: E is Talk, the wheel has Dismiss");
ok(opt(pressBody, "pres-dismiss-press") && !(pressBody._iopts || []).some((o) => o.slot === "e"), "the press secretary has no button, only Dismiss on the wheel");
ok(/PRES_BASE = 6;/.test(readFileSync(path.join(ROOT, "src/city/protection.js"), "utf8")), "the office grants the full detail (protection.js PRES_BASE 6)");
ok(!/hasDriver/.test(readFileSync(path.join(ROOT, "src/city/motorcade.js"), "utf8")), "the column has its driver from day one (no hire gate in motorcade.js)");

// ---- 2. dismiss the General face to face ---------------------------------------------
let gen = postOfficer("general");
ok(opt(gen, "pres-dismiss-general") && label(opt(gen, "pres-dismiss-general")) === "Dismiss", "the General's wheel has Dismiss");
const r0 = mil.readiness, ap0 = country.approval, sc0 = pol.scandal;
said.length = 0;
opt(gen, "pres-dismiss-general").onSelect(gen);
ok(said.length === 2 && said[0].by === "you" && said[0].aloud && /Brandt\.$/.test(said[0].line) && said[1].by === "General Brandt", "two lines over heads: " + said.map((s) => s.by + ": " + s.line).join(" / "));
ok(PS.vacant("general"), "his chair is empty");
tick(1);
ok(headlines().some((h) => /^General Marcus Brandt (resigns|fired)$/.test(h)), "NEWS ONE: " + headlines().filter((h) => /Brandt/.test(h)));
ok(mil.readiness < r0 - 0.1, "readiness drops: " + r0 + " -> " + mil.readiness.toFixed(3));
ok(country.approval < ap0 && pol.scandal > sc0, "approval and scandal move: " + ap0 + "->" + country.approval + ", scandal " + sc0 + "->" + pol.scandal);
const formers = PS.former();
ok(formers.length === 1 && formers[0].name === "Marcus Brandt" && formers[0].sid === "sid_general", "he persists as a real character (ledger sid " + (formers[0] && formers[0].sid) + ")");
ok(D._state().purgedDay === day, "a loyal-enough General leaving calls dissent.relieved (the plot has no head)");
tick(6);
ok(!live().includes(gen), "after his line he is gone from the table");

// ---- 3. the Chief brings two names ------------------------------------------------
tick(2);
let nm = PS.nominee();
ok(nm && nm.role === "general" && nm.names.length === 2 && nm.names[0].trait === "loyal" && nm.names[1].trait === "able", "the Chief has two names for General: " + JSON.stringify(nm && nm.names));
P.pos = { x: chief.pos.x + 1, y: 10, z: chief.pos.z };
said.length = 0;
tick(1);
const line = said.find((s) => /^Two names for General\./.test(s.line));
ok(line && line.by === "Ruth Adair" && new RegExp("^Two names for General\\. " + sur(nm.names[0].name) + " is loyal\\. " + sur(nm.names[1].name) + " is good\\.$").test(line.line), "over his head: " + (line && line.line));
const ea = opt(chief, "pres-chief-name-a"), eb = opt(chief, "pres-chief-name-b");
ok(ea.slot === "e" && ea.canShow() && label(ea) === sur(nm.names[0].name) && !eb.slot && eb.canShow() && label(eb) === sur(nm.names[1].name), "E is " + label(ea) + ", the wheel is " + label(eb));
ok(!opt(chief, "pres-chief-talk").canShow(), "Talk steps aside while he holds the names");

// ---- 4. the trade-off ------------------------------------------------------------------
const loyalGen = fillWith("general", 0);
ok(loyalGen && loyalGen.trait === "loyal" && loyalGen.loyalty === 85, "the loyal pick is the General: " + JSON.stringify(loyalGen));
ok(PS.obedience("general") > 0 && PS.armyLean().cap === 79 && PS.edge("general") < 0, "loyal: fewer refusals (obedience " + PS.obedience("general") + "), no coup (army capped " + PS.armyLean().cap + "), weaker results (edge " + PS.edge("general") + ")");
D._state().army = 95; nextDay();
ok(D._state().army <= 79 && D._state().coupDay == null, "under a loyal General the army never reaches the coup mark: " + D._state().army);
// a loyal man's no costs little and never sinks him under 50
for (let i = 0; i < 12; i++) CBZ.presidency.emit("decision", { source: "officer", who: CBZ.presidency.cabinet().general.display, choice: "no" });
ok(cabRec("general").refused === 12 && cabRec("general").loyalty === 50, "a loyal General's loyalty floors at 50: " + cabRec("general").loyalty);
// the good pick
PS.dismiss("general", { via: "phone" });
tick(1);
const ableGen = fillWith("general", 1);
ok(ableGen && ableGen.trait === "able" && ableGen.loyalty === 55, "the good pick is the General: " + JSON.stringify(ableGen));
const rd = mil.readiness, l0 = cabRec("general").loyalty;
nextDay(); nextDay();
ok(cabRec("general").loyalty < l0, "the good man's grudge grows by itself: " + l0 + " -> " + cabRec("general").loyalty);
ok(PS.edge("general") > 0 && PS.armyLean().cap == null, "good: better results (edge " + PS.edge("general") + "), no cap on the army line");

// ---- 6. refusals feed loyalty, loyalty feeds coup risk --------------------------------
const disp = CBZ.presidency.cabinet().general.display;
const l1 = cabRec("general").loyalty;
CBZ.presidency.emit("decision", { source: "officer", who: disp, choice: "no" });
ok(cabRec("general").refused === 1 && l1 - cabRec("general").loyalty === 9, "turning down the good General costs 9 loyalty: " + l1 + " -> " + cabRec("general").loyalty);
CBZ.presidency.emit("decision", { source: "phone", who: cabRec("general").name, choice: "yes" });
ok(cabRec("general").refused === 1, "a yes costs nothing");
for (let i = 0; i < 4; i++) CBZ.presidency.emit("decision", { source: "folder", who: cabRec("general").name, choice: "no" });
ok(cabRec("general").loyalty < 35 && PS.obedience("general") < 0, "five refusals and he is sour: loyalty " + cabRec("general").loyalty + ", obedience " + PS.obedience("general"));
ok(PS.armyLean().add > 0, "a sour General pushes the army toward a coup: +" + PS.armyLean().add.toFixed(1) + "/day");
const armyBefore = D._state().army;
nextDay();
ok(D._state().army > armyBefore - 8, "...and dissent.js reads it on the army line: " + armyBefore + " -> " + D._state().army.toFixed(1));
// dismissing a sour General: he plots
const sour = cabRec("general").name, sourSid = cabRec("general").sid;
const army0 = D._state().army;
PS.dismiss("general", { via: "phone" });
ok(PS.former().some((f) => f.name === sour && f.plotting), "a disloyal General dismissed plots");
ok(D._state().plotter && D._state().plotter.sid === sourSid && D._state().army >= army0 + 20, "dissent's army climbs and he is the plotter (army " + army0.toFixed(0) + " -> " + D._state().army.toFixed(0) + ")");
D._state().army = 95; D._state().stage = 3; D._state().unrest = 90; D._state().movement = 90; D._state().coupDay = day;
nextDay();
ok(coups.length === 1 && coups[0].plotterSid === sourSid, "the coup's plotter is the man you fired: " + JSON.stringify(coups[0]));
country.office.holder = "player"; D.reset();
tick(1);

// ---- 5. the Treasury Secretary, by phone ---------------------------------------------
const cs = A.contacts();
ok(cs.some((c) => c.id === "treasury" && c.name === "Oscar Whitlock") && cs.some((c) => c.id === "press") && cs.some((c) => c.id === "bureau") && cs.some((c) => c.id === "police"), "every post is a Calls contact: " + cs.filter((c) => c.kind === "staff").map((c) => c.id).join(","));
let conv = A.call("treasury");
ok(conv && conv.choices.length === 1 && conv.choices[0].label === "I need your resignation", "the Treasury Secretary takes the call: " + (conv && conv.line) + " / " + (conv && conv.choices.map((c) => c.label)));
said.length = 0;
let rr = A.choose("resign");
ok(rr && rr.ok && rr.line && PS.vacant("treasury"), "by phone he is out, and says one line back: " + (rr && rr.line));
ok(said.some((s) => s.by === "phone" && s.line === rr.line), "his line is spoken on the line");
tick(1);
ok(headlines().some((h) => /^Treasury Secretary Oscar Whitlock (resigns|fired)$/.test(h)), "NEWS ONE runs the Treasury story");
const t0 = country.treasury;
nextDay();
ok(country.treasury < t0 + 1, "an empty Treasury chair leaks money (" + t0 + " -> " + country.treasury + ")");
A.hangup();
// the general call keeps its orders and adds the one verb
conv = A.call("chief");
ok(conv && conv.choices.some((c) => c.id === "resign") && conv.choices.some((c) => c.id === "ride"), "the Chief on the phone: " + conv.choices.map((c) => c.label).join(" / "));
A.hangup();

// ---- 7. the Bureau Director -------------------------------------------------------------
presState.intelKnown = true;
PS.dismiss("bureau", { via: "phone" });
ok(presState.intelKnown === false, "dismissing the Director stops the investigation");

// ---- 8. the press secretary -----------------------------------------------------------
const press = presState.staff.press;
const c0 = press.cred;
pol.scandal = 45;
tick(1);
ok(pol.scandal < 45 && press.briefs === 1 && headlines().some((h) => /briefing/i.test(h)), "at a bad scandal she goes to the cameras by herself: scandal 45 -> " + pol.scandal);
const cut1 = 45 - pol.scandal;
for (let i = 0; i < 4; i++) { pol.scandal = 45; nextDay(); }
pol.scandal = 45; nextDay();
const cut2 = 45 - pol.scandal;
ok(press.cred < c0 && cut2 < cut1 * 0.6, "repeated scandals spend her: the cut went " + cut1.toFixed(1) + " -> " + cut2.toFixed(1) + " (cred " + press.cred.toFixed(2) + ")");
const pressName = press.name;
PS.dismiss("press", { via: "phone" });
tick(1);
ok(headlines().some((h) => h.indexOf("Press Secretary " + pressName) === 0), "firing her makes the news");
const sc1 = pol.scandal;
nextDay();
ok(headlines().some((h) => h === "Former Press Secretary " + sur(pressName) + " leaks to the press") && pol.scandal > sc1 - 6.5, "a spent press secretary leaks the next day");

// ---- the formers come back -------------------------------------------------------------
for (let i = 0; i < 8; i++) nextDay();
const posts = A.feed().filter((p) => PS.former().some((f) => f.name === p.name));
ok(posts.length >= 2, "the people you let go post on Holler: " + posts.slice(0, 3).map((p) => p.name + ": " + p.text).join(" | "));
ok(headlines().some((h) => /^Former General .* seen with officers$/.test(h)), "the plotting General is seen with officers on NEWS ONE");

// ---- 9. the Chief himself, and his style ---------------------------------------------
P.pos = { x: 0, y: 10, z: 18 };
tick(2);
const chief2 = live().find((p) => p._presStaff === "chief");
said.length = 0;
// fill whatever is still empty first so the Chief's chair is the one in play
for (let i = 0; i < 8 && PS.nominee(); i++) { PS.pick(1); nextDay(); }
tick(2);
opt(chief2, "pres-dismiss-chief").onSelect(chief2);
ok(PS.vacant("chief") && said[0] && /Adair\.$/.test(said[0].line), "the Chief is dismissed to his face: " + said.map((s) => s.line).join(" / "));
ok(PS.chiefStyle() === "none", "no Chief: nobody screens");
tick(30);
ok(!live().some((p) => p._presStaff === "chief"), "he walks out and nobody stands in his place");
nm = PS.nominee();
ok(nm && nm.role === "chief", "his own chair gets two names (by phone from the Vice President)");
PS._ring(); tick(1);
let rg = A.ringing();
for (let i = 0; i < 6 && rg && rg.name !== "Vice President Brandt"; i++) { A.decline(); PS._ring(); tick(9); rg = A.ringing(); }
ok(rg && rg.name === "Vice President Brandt", "the phone rings: " + JSON.stringify(rg));
let cv = A.answer();
ok(cv && /^Two names for Chief of Staff\./.test(cv.line) && cv.choices.length === 2, "the call: " + (cv && cv.line) + " [" + (cv && cv.choices.map((c) => c.label)) + "]");
A.choose("a");
ok(!PS.vacant("chief") && PS.chiefStyle() === "screen", "a loyal Chief screens your desk: " + PS.chiefStyle());
PS.dismiss("chief", { via: "phone" });
for (let i = 0; i < 6 && PS.vacant("chief"); i++) { tick(2); if (PS.nominee() && PS.nominee().role === "chief") PS.pick(1); else nextDay(); }
ok(PS.chiefStyle() === "open", "a good Chief keeps the door open: " + PS.chiefStyle());
const off = readFileSync(path.join(ROOT, "src/city/president_office.js"), "utf8");
ok(/function staffSays\(m\)/.test(off) && /PS\.chiefStyle/.test(off) && /presoffice-dial/.test(off), "president_office.js routes matters through the staff (empty chairs, the Chief's style) and the desk phone dials");

// ---- 10. text law ------------------------------------------------------------------------
const src = readFileSync(path.join(ROOT, "src/city/president_staff.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const strings = (src.match(/"[^"\n]*"/g) || []).join("\n");
ok(!/Candidate|He doesn't work for us|"Next\."|"Hire"|Send away/.test(src), "no Candidate N, Hire, Send away or the old Chief lines in the source");
const allText = said.map((s) => s.line).concat(headlines(), A.feed().map((p) => p.text)).join("\n");
ok(!/[—–·•]/.test(allText) && !/[—–]/.test(strings), "no em dashes or middle dots in anything said, run or posted");
ok(said.every((s) => s.line.length <= 80), "every spoken line is short");

console.log((fails ? "PRES-STAFF: FAIL " : "PRES-STAFF: OK ") + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
