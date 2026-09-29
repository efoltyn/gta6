#!/usr/bin/env node
/* ============================================================
   tools/president-staff-check.mjs — THE PRESIDENT HIRES PEOPLE, NOT ROWS.

   OWNER (2026-09-29): "You can hire people as a president, but it's like
   talk, hire. It's such a dumb flow."

   Plain node. Loads src/city/president_staff.js into a stubbed page (the
   office frame, cityPostNpc, the detail record, the presidency's cabinet
   seam) and walks the flow the player lives:
     1. in the office the Chief of Staff stands at the head of a line, and
        the line fills one person at a time, never past three
     2. a candidate's E verb is Hire; his wheel has Send away; nothing else
        (no street Talk / Mug on a man waiting for a job)
     3. hiring an agent puts THAT man on the detail (memberCount + 1)
     4. hiring a driver / press secretary fills the post and opens no other
     5. "Fire" is an order to the Chief about someone else (pick: person):
        a staffer walks, an officer's chair empties (vacateCabinet)
     6. the press secretary briefs once a day and the scandal drops
     7. away from the office nobody stands around
   Exit 0 = ok.
============================================================ */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, passes = 0;
function ok(c, m) { if (c) passes++; else { fails++; console.log("  FAIL " + m); } }

const upd = [];
const peds = [];
const P = { pos: { x: 0, y: 10, z: 20 }, dead: false };
const office = {
  key: "ovaloffice", floorY: 10,
  approach: { x: 0, z: 0, nx: 0, nz: 1, tx: 1, tz: 0, depth: 24, span: 12 },
  landmarks: { presidentialDesk: { x: 0, z: 20 }, arrivalPortal: { x: 0, z: 6 } },
};
const detail = { id: "off_usa", memberCount: 0, memberPedRefs: [] };
const S = { scandal: 30 };
const staffState = {};
const cabinet = {
  chief: { name: "Ann Hale", display: "Ann Hale", dead: false },
  general: { name: "Tom Reyes", display: "General Reyes", dead: true },   // an empty chair
  bureau: { name: "B", display: "Director B", dead: false },
  police: { name: "C", display: "Commissioner C", dead: false },
  treasury: { name: "D", display: "Secretary D", dead: false },
};
const filled = [], vacated = [], news = [];
const CBZ = {
  game: { mode: "city", state: "playing" }, player: P, CONFIG: {},
  onUpdate: (o, fn) => upd.push(fn), onAlways: () => {},
  presidency: {
    seat: () => ({ id: "usa" }), staff: () => staffState, cabinet: () => cabinet,
    fillCabinet: (role, who) => { filled.push(role + ":" + who.name); cabinet[role] = { name: who.name, display: who.name, dead: false }; return true; },
    vacateCabinet: (role) => { vacated.push(role); cabinet[role].dead = true; return true; },
  },
  presidentInteriorRooms: () => [office],
  presidentOffice: { news: (h) => news.push(h) },
  protection: { get: (id) => (id === detail.id ? detail : null), HIRE_CAP: 8 },
  cityWorldEnsure: () => ({ politics: S }),
  worldDay: () => 3,
  cityMintName: (rng, g) => (g === "f" ? "Jo " : "Al ") + Math.floor(rng() * 1000),
  citySay: (p, line) => { p._said = line; },
  cityPostNpc: (x, z, o) => { const p = { pos: { x, y: o.floorY || 0, z }, group: { rotation: {} }, target: { set() {} }, job: o.job, gender: o.gender, opts: o }; peds.push(p); return p; },
  cityUnpostNpc: (p) => { p._gone = true; const i = peds.indexOf(p); if (i >= 0) peds.splice(i, 1); },
  interactions: { registerFor: (p, o) => { (p._iopts || (p._iopts = [])).push(o); } },
};
const sb = { window: null, CBZ, console, Math, Object, Array, Set, Map, JSON, isFinite, Number, String };
sb.window = sb; sb.window.CBZ = CBZ;
vm.createContext(sb);
vm.runInContext(readFileSync(path.join(ROOT, "src/city/president_staff.js"), "utf8"), sb, { filename: "president_staff.js" });
const PS = CBZ.presidentStaff;
const tick = (n, dt) => { for (let i = 0; i < n; i++) for (const f of upd) f(dt || 0.5); };
const live = () => peds.filter((p) => !p._gone);
const opt = (p, id) => (p._iopts || []).find((o) => o.id === id);

// 1. the line
tick(1);
const chief = live().find((p) => p._presStaff === "chief");
ok(!!chief && chief.name === "Ann Hale", "the Chief of Staff stands in the office");
tick(10);
let line = PS.line();
ok(line.length === 3, "the line fills to three and stops: " + line.length);
ok(line[0].role === "general", "an empty cabinet chair is first in line: " + line.map((c) => c.role).join(","));
ok(line.some((c) => c.role === "driver") && line.some((c) => c.role === "agent"), "the open jobs are in line: " + line.map((c) => c.role).join(","));
const cands = live().filter((p) => p._presCandidate);
ok(cands.every((p) => p._iOnly), "a candidate offers only his own verbs (no street Talk / Mug / Hire)");
ok(cands.every((p) => opt(p, "pres-hire") && opt(p, "pres-hire").slot === "e" && opt(p, "pres-send-away")), "E is Hire, the wheel adds Send away");
ok(new Set(cands.map((p) => p.job)).size === 3, "each is dressed as his job: " + cands.map((p) => p.job).join(", "));

// 2. hire the agent: that man joins the detail
const agent = cands.find((p) => p._presCandidate === "agent");
opt(agent, "pres-hire").onSelect(agent);
ok(detail.memberCount === 1 && detail.memberPedRefs[0] === agent && agent._protUnit === "off_usa", "an agent hire is memberCount+1 and THIS man on the detail");
ok(agent._iOnly === false && !agent._presCandidate, "the hired agent takes orders now");
ok(staffState.agents === 1, "the hire is saved on the presidency");

// 3. hire the driver and the general
const driver = cands.find((p) => p._presCandidate === "driver");
opt(driver, "pres-hire").onSelect(driver);
ok(staffState.driver && staffState.driver.name === driver.name && PS.has("driver"), "the driver's post is filled");
const gen = cands.find((p) => p._presCandidate === "general");
opt(gen, "pres-hire").onSelect(gen);
ok(filled.length === 1 && filled[0].indexOf("general:") === 0 && !cabinet.general.dead, "the new General IS the post: " + filled);
tick(20);
line = PS.line();
ok(!line.some((c) => c.role === "driver" || c.role === "general"), "a filled post sends nobody else: " + line.map((c) => c.role).join(","));

// 4. the press secretary
const press = live().find((p) => p._presCandidate === "press");
ok(!!press, "the press secretary comes through the door when a place opens in the line");
if (press) {
  opt(press, "pres-hire").onSelect(press);
  ok(staffState.press && staffState.press.name === press.name, "the press secretary is hired");
  tick(2);
  ok(S.scandal === 24 && news.length === 1, "at scandal 30 she goes to the cameras by herself: scandal " + S.scandal + ", TV " + news.length);
  tick(4);
  ok(S.scandal === 24, "...once a day");
}

// 5. Fire: an order to the Chief about someone else
const fireOpt = opt(chief, "pres-chief-fire");
ok(fireOpt && fireOpt.pick === "person" && !fireOpt.slot, "Fire is the Chief's order about a third person (a wheel verb, never a key)");
const officer = { name: "Director B", _presOfficer: "bureau", pos: { x: 0, z: 0 }, group: {} };
fireOpt.onSelect(chief, {}, officer);
ok(vacated.join() === "bureau", "firing an officer empties his chair: " + vacated);
const pressBody = live().find((p) => p._presStaff === "press");
fireOpt.onSelect(chief, {}, pressBody || press);
ok(!staffState.press, "firing the press secretary opens her post");
fireOpt.onSelect(chief, {}, agent);
ok(detail.memberCount === 0 && detail.memberPedRefs.length === 0 && staffState.agents === 0, "firing an agent takes him off the detail");
const stranger = { name: "Nobody", pos: { x: 0, z: 0 }, group: {} };
fireOpt.onSelect(chief, {}, stranger);
ok(chief._said === "He doesn't work for us.", "the Chief refuses to fire a stranger: " + chief._said);

// 6. away from the office nobody stands around
P.pos = { x: 500, y: 0, z: 500 };
tick(2);
ok(!live().some((p) => p._presCandidate || p._presStaff === "chief"), "away from the office, the line and the Chief are gone");

console.log((fails ? "PRES-STAFF: FAIL " : "PRES-STAFF: OK ") + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
