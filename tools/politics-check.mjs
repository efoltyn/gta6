#!/usr/bin/env node
/* ============================================================
   tools/politics-check.mjs — THE COUNTRY, AS ONE MODEL (city/politics.js).

   Plain node. Loads the real city/newsroom.js, city/phone_apps.js,
   city/politics.js, city/president_staff.js and city/dissent.js into a vm
   with a stub world (a presidency whose cabinet records behave like
   presidency.js's, a country, a gang, peds), then plays the presidency:

     1. approval IS the groups: the population-weighted loyalty of eight
        ideologies whose people sum to the country
     2. appoint a fascist: communists drop most, every group outside the far
        right drops, approval drops, NEWS ONE names him
     3. tell the Secret Service to kill one of its own: its loyalty falls,
        refusals rise, a refusal is a short line
     4. kill a congressman: the seat moves, his party is enraged, the news
     5. kill a minister: the title is right and the chair is empty
     6. every service at low loyalty does its real thing (Bureau
        investigates, Agency leaks, police drop the curfew, the Army climbs
        the coup ladder, the detail thins)
     7. bills: sign and veto move the right groups; a veto is overridden
     8. a pardon frees an arrested gang leader and the gang owes you
     9. pay and a deal with the General lift the Army; the deploy order works
        at high loyalty and is refused at low
    10. a bribe surfaces later as scandal
    11. GENERALITY: a sweep of every verb at every kind of target and every
        order: no crash, no NaN, non-zero sensible effects, clean news text
    12. ONE MODEL: no private approval or loyalty writes left outside it
   Exit 0 = ok.
============================================================ */
import { readFileSync, readdirSync, statSync } from "node:fs";
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
const said = [];
const pressed = [];
const standing = [];
const relEvents = [];
const P = { pos: { x: 0, y: 0, z: 0 }, dead: false };
const country = { id: "republic", kind: "country", name: "Republic of Libertas", approval: 55, treasury: 400000, taxRate: 0.1, govType: "democracy", office: { holder: "player", deputy: "vp1" } };
const kesh = { id: "kesh", kind: "country", name: "Kingdom of Kesh", approval: 60, treasury: 90000, govType: "monarchy", office: { holder: "k1" } };
const mil = { readiness: 0.6, soldiers: 1000 };
const pol = { scandal: 0 };
const presState = { staff: null, cabinet: {}, politics: {} };
const ROLES = [
  ["chief", "Chief of Staff", "", "Ruth Adair"], ["general", "General", "General", "Marcus Brandt"], ["bureau", "Bureau Director", "Director", "Leon Varga"],
  ["police", "Police Commissioner", "Commissioner", "Nadia Serrano"], ["treasury", "Treasury Secretary", "Secretary", "Oscar Whitlock"],
  ["cia", "CIA Director", "Director", "Irene Castell"], ["ss", "Secret Service Director", "Director", "Victor Novak"], ["interior", "Interior Minister", "Minister", "Clara Moreau"],
];
for (const [k, t, , n] of ROLES) presState.cabinet[k] = { name: n, sid: "sid_" + k, role: t, gender: "m", dead: false, refused: 0, loyalty: 60, trait: null };
const sur = (n) => String(n).split(" ").pop();
let mintN = 0;
const gang = { id: "g1", name: "Los Reyes", bossName: "Tomas Reyes", members: [], turf: [], warIntensity: 0, boss: null };
const CBZ = {
  game: { mode: "city", state: "playing", cash: 100000 }, player: P, CONFIG: {}, seed: 7,
  onUpdate: (o, fn) => upd.push({ o, fn }), onAlways: (o, fn) => upd.push({ o, fn }),
  onNewDay: (fn) => newDay.push(fn),
  worldDay: () => day,
  gov: { holds: () => (country.office.holder === "player" ? { kind: "country", id: "republic", rec: country, title: "President" } : null), curfewUntil: () => 0 },
  polity: { get: (id) => (id === "republic" ? country : id === "kesh" ? kesh : null), list: (k) => (k === "country" ? [country, kesh] : []) },
  polwar: { militaryOf: () => mil },
  cityWorldEnsure: () => ({ politics: pol }),
  cityMintName: (rng) => ["Ada Okafor", "Ben Reyes", "Cy Lindqvist", "Dee Moreau", "Eli Castell", "Fay Ashford", "Gus Maddox", "Hal Novak", "Ivy Kovac", "Jon Delacroix", "Kim Sato", "Lou Haas"][(rng() * 12) | 0],
  cityPedStash: (o) => { o._sid = "minted_" + (++mintN); },
  citySay: (p, line) => { said.push({ by: p.name || "?", line }); return true; },
  sayLines: (list, end) => { for (const L of list) said.push({ by: L.by === P ? "you" : (L.by && L.by.name) || "?", line: L.line }); if (end) end(); return {}; },
  speech: { phone: (t) => { said.push({ by: "phone", line: t }); return true; } },
  cityPostNpc: (x, z, o) => { const p = { pos: { x, y: 0, z }, group: { rotation: {} }, target: { set() {} }, job: o.job, opts: o }; peds.push(p); return p; },
  cityUnpostNpc: (p) => { p._gone = true; const i = peds.indexOf(p); if (i >= 0) peds.splice(i, 1); },
  cityPeds: peds,
  cityGangs: [gang],
  cityGangAddStanding: (id, n) => { standing.push({ id, n }); },
  relations: { event: (a, b, kind, n) => { relEvents.push({ a, b, kind, n }); return -20; }, get: () => -20 },
  cityZoneAt: () => ({ name: "EASTGATE" }),
  interactions: { registerFor: (p, o) => { (p._iopts || (p._iopts = [])).push(o); } },
  presidentInteriorRooms: () => [],
  civilwar: { coup: () => ({ outcome: "x" }) },
  warroom: { nation: () => "republic", enemy: () => null, warheads: () => 0, canWar: () => ({ ok: false }) },
  officials: { identityOf: (sid) => ({ player: { name: "Eli Foltyn" }, vp1: { name: "Leon Brandt" } }[sid] || null), titleFor: () => "President" },
};
CBZ.presidency = {
  seat: () => CBZ.gov.holds(),
  staff: () => presState.staff || (presState.staff = {}),
  politicsStore: () => presState.politics,
  CABINET_ROLES: ROLES.map(([key, title]) => ({ key, title })),
  cabinet: () => {
    const out = {};
    for (const [k, , pre] of ROLES) {
      const c = presState.cabinet[k];
      out[k] = { name: c.name, sid: c.sid, gender: c.gender, dead: !!c.dead, loyalty: c.loyalty, trait: c.trait, ideology: c.ideology || null, display: pre ? pre + " " + sur(c.name) : c.name };
    }
    out.vp = { name: "Leon Brandt", display: "Vice President Brandt", sid: "vp1" };
    return out;
  },
  cabinetRecord: (role) => presState.cabinet[role] || null,
  vacateCabinet: (role) => { const c = presState.cabinet[role]; if (!c) return false; c.dead = true; c.vacant = true; return true; },
  fillCabinet: (role, who) => { const t = ROLES.find((r) => r[0] === role); presState.cabinet[role] = { name: who.name, sid: who.sid, role: t[1], gender: who.gender || "m", dead: false, refused: 0, loyalty: who.loyalty, trait: who.trait, ideology: who.ideology || null }; return true; },
  bureauStop: () => true, bureauIntel: () => true,
  site: () => ({ gate: { x: 0, z: 100 } }),
  on(evt, fn) { (bus[evt] = bus[evt] || []).push(fn); },
  emit(evt, p) { for (const fn of (bus[evt] || []).concat(evt !== "*" ? (bus["*"] || []) : [])) fn(p, evt); },
  press: (k) => { pressed.push(k); return { ok: true }; },
};
// approval.js's own routing (the seat is politics'); a faithful two-liner
CBZ.approvalShock = (id, n) => { if (CBZ.politics && CBZ.politics.owns(id)) CBZ.politics.shock(n); };
CBZ.approvalSet = (rec, v) => { if (CBZ.politics && CBZ.politics.owns(rec.id)) CBZ.politics.setApproval(v); };
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
const THREE = { CanvasTexture: class {}, MeshBasicMaterial: class {}, PlaneGeometry: class {}, Mesh: class {}, Group: class {}, Vector3: V3, Vector2: class {}, Matrix4: class {}, Quaternion: class {}, Euler: class {} };
const sb = { window: null, CBZ, THREE, console, Math, Object, Array, Set, Map, JSON, isFinite, Number, String, Date, Infinity, parseInt, setTimeout: (f) => f(), clearTimeout() {} };
sb.window = sb;
vm.createContext(sb);
for (const f of ["src/city/newsroom.js", "src/city/phone_apps.js", "src/city/politics.js", "src/city/president_staff.js", "src/city/dissent.js"]) {
  vm.runInContext(readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
}
upd.sort((a, b) => a.o - b.o);
const Po = CBZ.politics, PS = CBZ.presidentStaff, N = CBZ.news, D = CBZ.dissent, A = CBZ.phoneApps;
const tick = (secs, dt = 0.25) => { for (let t = 0; t < secs; t += dt) for (const u of upd) u.fn(dt); };
const nextDay = () => { day++; for (const fn of newDay) fn(day); tick(1); };
const headlines = () => N.stories().map((s) => s.h);
const G = () => Object.fromEntries(Po.groups().map((g) => [g.id, g.loyalty]));
const ped = (o) => { const p = Object.assign({ pos: { x: 10 + peds.length, y: 0, z: 10 }, dead: false, gender: "m", group: { rotation: {} } }, o); peds.push(p); return p; };
const kill = (p, info) => { p.dead = true; return Po.onDeath(p, info || {}); };
const acts = [];
CBZ.presidency.on("act", (d) => acts.push(d));
tick(3);   // NEWS ONE wires itself to the bus on its first poll

// ---- 1. approval IS the groups ------------------------------------------------------
Po._ensure();
const groups = Po.groups();
ok(groups.length === 8 && ["com", "soc", "dem", "rep", "ana", "nazi", "nat", "fas"].every((k) => groups.some((g) => g.id === k)), "eight ideological groups: " + groups.map((g) => g.name).join(", "));
const pop = Po._state().pop, sumPeople = groups.reduce((a, g) => a + g.people, 0);
ok(Math.abs(sumPeople - pop) <= 8, "their people sum to the country: " + sumPeople + " of " + pop);
const wavg = groups.reduce((a, g) => a + g.share * g.loyalty, 0);
ok(Math.abs(country.approval - wavg) < 0.01 && Math.abs(country.approval - 55) < 0.5, "approval is the population-weighted loyalty: " + country.approval.toFixed(2) + " = " + wavg.toFixed(2));
CBZ.approvalShock("republic", -4);
ok(Math.abs(country.approval - (wavg - 4)) < 0.6, "a generic approvalShock on the seat lands on every group: " + country.approval.toFixed(1));
const ins = Po.institutions();
ok(ins.length === 5 && ins.every((i) => i.loyalty >= 80 && i.head && i.head.name), "five services, all loyal, each with a named head: " + ins.map((i) => i.name + " (" + i.head.name + ")").join(", "));
const cg = Po.congress();
ok(cg.seats.R + cg.seats.D === 100 && cg.members.length === 12 && cg.members.filter((m) => m.body).length === 4, "Congress: R " + cg.seats.R + " / D " + cg.seats.D + ", " + cg.members.length + " named members, 4 with bodies");

// ---- 2. appoint a fascist --------------------------------------------------------------
let g0 = G(), ap0 = country.approval;
const fasName = "Gerhard Kovac";
Po.act("appoint", { target: { kind: "person", _desc: 1, name: fasName, title: "Interior Minister", ideology: "fas", notable: 0.8 }, by: "self" });
let g1 = G();
const d = Object.fromEntries(Object.keys(g0).map((k) => [k, g1[k] - g0[k]]));
const drops = Object.entries(d).filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
ok(drops[0][0] === "com", "communists drop the most: " + JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, +v.toFixed(2)]))));
ok(["com", "soc", "dem", "rep", "ana"].every((k) => d[k] < 0) && d.fas > 0 && d.nazi > 0, "everyone outside the far right drops; fascists and neo-Nazis are pleased");
ok(country.approval < ap0, "approval drops: " + ap0.toFixed(1) + " -> " + country.approval.toFixed(1));
tick(3);
ok(headlines().includes("President appoints fascist " + fasName + " as Interior Minister"), "NEWS ONE: " + headlines().filter((h) => /appoints/.test(h)));
ok(A.feed().some((p) => p.kind === "citizen" && /workers|ruling class|bosses|Order|strength/i.test(p.text)), "the groups react on Holler in their own voices: " + A.feed().slice(0, 3).map((p) => p.handle + ": " + p.text).join(" | "));

// ---- 3. the Secret Service told to kill one of its own ------------------------------------
const agent = ped({ name: "Sam Ashford", job: "secret service", kind: "security", _sid: "ag1" });
const ss0 = Po.instLoyalty("ss"), p0 = Po.refusalChance("ss", "kill", agent);
let accepted = null, refusedLines = [];
for (let i = 0; i < 12 && !accepted; i++) {
  const r = Po.order("ss", "kill", agent);
  if (r.ok) accepted = r; else refusedLines.push(r.line);
}
ok(p0 > 0.45, "killing their own is likely refused: p=" + p0.toFixed(2));
ok(refusedLines.every((l) => l.length <= 30 && /sir/.test(l)), "a refusal is one short line: " + [...new Set(refusedLines)].join(" / "));
if (accepted) kill(agent, {});
const ss1 = Po.instLoyalty("ss"), p1 = Po.refusalChance("ss", "kill", ped({ name: "Ken Grant", job: "secret service", _sid: "ag2" }));
ok(ss1 < ss0 - 10, "the Secret Service's loyalty falls: " + ss0.toFixed(1) + " -> " + ss1.toFixed(1) + (accepted ? " (carried out)" : " (refused " + refusedLines.length + "x)"));
ok(p1 > p0, "refusals rise: " + p0.toFixed(2) + " -> " + p1.toFixed(2));
tick(2);
if (accepted) ok(headlines().some((h) => /^Secret Service agent Sam Ashford killed$/.test(h)), "NEWS ONE: " + headlines().filter((h) => /Ashford/.test(h)));

// ---- 4. kill a congressman --------------------------------------------------------------
const dm = Po.congress().members.find((m) => m.party === "D" && !m.leader && m.status === "sitting");
const seats0 = Po.congress().seats.D, mood0 = Po.congress().mood.D, dem0 = G().dem;
const cped = ped({ name: "Senator " + dm.name, job: "senator", _congress: dm.sid, _sid: dm.sid });
kill(cped, { byPlayer: true });
const cg1 = Po.congress();
ok(cg1.seats.D === seats0 - 1 && cg1.vacant >= 1 && cg1.members.find((m) => m.sid === dm.sid).status === "dead", "the seat moves: D " + seats0 + " -> " + cg1.seats.D + ", vacant " + cg1.vacant);
ok(cg1.mood.D < mood0 - 10 && G().dem < dem0 - 5 && cg1.impeach > 0, "his party is enraged (mood " + mood0 + " -> " + cg1.mood.D.toFixed(1) + ", democrats " + dem0.toFixed(1) + " -> " + G().dem.toFixed(1) + ", impeachment pressure " + cg1.impeach.toFixed(1) + ")");
tick(2);
ok(headlines().includes("Senator " + dm.name + " killed"), "NEWS ONE: " + headlines().filter((h) => new RegExp(sur(dm.name)).test(h)));
for (let i = 0; i < 4; i++) nextDay();
ok(Po.congress().seats.D + Po.congress().seats.R + Po.congress().vacant === 100 && Po.congress().members.length === 13, "a special election fills the seat");

// ---- 5. kill a minister ------------------------------------------------------------------
const mped = ped({ name: "Secretary Whitlock", _presOfficer: "treasury" });
kill(mped, { byPlayer: true });
tick(2);
ok(headlines().includes("Treasury Secretary Oscar Whitlock killed"), "NEWS ONE: " + headlines().filter((h) => /Whitlock/.test(h)));
ok(PS.vacant("treasury"), "the chair is empty");
const pss = A.feed().filter((p) => p.kind === "citizen").length;
ok(pss > 2, "Holler reacts (" + pss + " citizen posts)");

// ---- 6. low loyalty does its real thing -----------------------------------------------------
Po._setInst("fbi", 20); const sc0 = pol.scandal;
nextDay();
ok(pol.scandal > sc0 && headlines().includes("Bureau opens an investigation into the President"), "the Bureau investigates: scandal " + sc0.toFixed(1) + " -> " + pol.scandal.toFixed(1));
Po._setInst("cia", 20); nextDay(); nextDay();
ok(headlines().some((h) => /^Intelligence leak exposes/.test(h)), "the Agency leaks: " + headlines().filter((h) => /leak/i.test(h)));
Po._setInst("police", 20);
ok(Po.obeys("police") === false && /Pol\.obeys\("police"\)|!Pol\.obeys\("police"\)/.test(readFileSync(path.join(ROOT, "src/city/statecraft.js"), "utf8")), "the police stop enforcing the curfew (statecraft reads obeys)");
Po._setInst("ss", 20);
ok(Po.detailSize(6) < 6 && /CBZ\.politics\.detailSize\(PRES_BASE\)/.test(readFileSync(path.join(ROOT, "src/city/protection.js"), "utf8")), "the Secret Service detail thins: " + Po.detailSize(6) + " of 6");
// the Army climbs the coup ladder: a furious country, a cold Army
Po._setAll(12); Po._setInst("army", 25);
let armed = null;
for (let i = 0; i < 8 && !armed; i++) { nextDay(); Po._setAll(12); if (D._state().coupDay != null) armed = day; }
ok(armed != null && D.status().army >= 75, "the Army's loyalty is dissent's army line and it reaches the coup: army " + D.status().army + ", troops on day " + armed);
ok(D.status().leaderGroup && headlines().some((h) => / leads an? [a-zA-Z-]+ movement against the President$/.test(h)), "the movement's leader comes from the angriest group: " + headlines().filter((h) => /movement/.test(h)));
// reset the country for the rest
Po._setAll(55); for (const k of Po.INSTITUTIONS) Po._setInst(k, 85); D.reset(); pol.scandal = 0;
Po._state().fx.investigation = null;

// ---- 7. bills --------------------------------------------------------------------------------
const C = Po._state().congress;
Po._state().bills.list.forEach((x) => { if (x.state === "desk") x.state = "lapsed"; });   // the day's own bill has lapsed
C.seats.R = 80; C.seats.D = 20; C.vacant = 0; C.mood.R = 0; C.mood.D = 0;
Po._state().presParty = "D";
const b = Po.draftBill(true);
ok(b && b.sponsor === "R" && /Act|Authorization/.test(b.name), "Congress passes a bill out of real state: " + (b && b.name) + " (" + (b && b.sponsor) + ")");
const desk = Po.desk().find((x) => x.topic === "bill");
ok(desk && desk.m.noVerb === "Veto" && desk.m.yes.label === "Sign" && /^The .* bill, sir\.$/.test(desk.line), "it reaches the desk as a folder: \"" + (desk && desk.line) + "\" (E Sign, wheel Veto)");
// what each group wants: the sign of POS . vec
g0 = G();
const sres = Po.sign(b.id);
g1 = G();
const want = sres.result.dG;
ok(Object.keys(want).every((k) => Math.sign(g1[k] - g0[k]) === Math.sign(want[k]) || Math.abs(want[k]) < 0.05) && Object.values(want).some((v) => v > 0.5) && Object.values(want).some((v) => v < -0.5),
  "signing moves each group toward or away from it by where it stands: " + JSON.stringify(Object.fromEntries(Object.entries(want).map(([k, v]) => [k, +v.toFixed(1)]))));
tick(2);
ok(headlines().includes("President signs the " + b.name), "NEWS ONE: President signs the " + b.name);
const b2 = Po.draftBill(true);
g0 = G();
const vr = Po.veto(b2.id);
g1 = G();
ok(vr.ok && vr.overridden && vr.vote.yes >= 67, "a veto is overridden by two thirds: " + vr.vote.yes + " to " + vr.vote.no);
tick(2);
ok(headlines().includes("Congress overrides the veto on the " + b2.name), "NEWS ONE: " + headlines().filter((h) => /veto/.test(h)).join(" / "));
// a veto that holds (the President's party has the blocking third)
C.seats.R = 50; C.seats.D = 50;
const b3 = Po.draftBill(true) || (function () { Po._state().bills.last = -9; return Po.draftBill(true); })();
if (b3) {
  g0 = G();
  const v3 = Po.veto(b3.id);
  g1 = G();
  const dimPos = { rep: 0, dem: 0 };
  ok(!v3.overridden, "with the President's party holding a third the veto holds: " + v3.vote.yes + " to " + v3.vote.no);
  ok(Object.keys(g0).some((k) => Math.abs(g1[k] - g0[k]) > 0.3), "a veto moves the groups too (the opposite way, softer)");
} else ok(false, "a third bill was drafted");

// ---- 8. pardon a gang leader --------------------------------------------------------------
const boss = ped({ name: "Tomas Reyes", gangId: "g1", _sid: "boss1", isBoss: true });
gang.boss = boss;
standing.length = 0;
const rr = Po.order("police", "arrest", boss);
if (!rr.ok) Po.act("arrest", { target: boss, by: "police" });
ok(Po.held().some((h) => h.sid === "boss1" && h.gang === "g1") && boss._gone, "the gang leader is arrested and held (his body leaves the street)");
for (let i = 0; i < 2; i++) nextDay();
ok(Po.desk().some((x) => x.topic === "pardon" && /lawyer asks for a pardon for Reyes/.test(x.line)), "his lawyer asks for a pardon: " + (Po.desk().find((x) => x.topic === "pardon") || {}).line);
const nat0 = G().nat;
const pr = Po.pardon("boss1");
ok(pr.ok && !Po.held().some((h) => h.sid === "boss1") && peds.some((p) => p.name === "Tomas Reyes" && !p._gone && p.gangId === "g1"), "the pardon frees him: he walks out of the gate");
ok(Po.debts().g1 === 1 && standing.some((s) => s.id === "g1" && s.n > 0), "the gang owes you (debt " + Po.debts().g1 + ", standing +" + (standing.find((s) => s.n > 0) || {}).n + ")");
ok(G().nat < nat0, "law-and-order nationalists hate it: " + nat0.toFixed(1) + " -> " + G().nat.toFixed(1));
tick(2);
ok(headlines().includes("President pardons gang leader Tomas Reyes"), "NEWS ONE: " + headlines().filter((h) => /pardon/.test(h)));

// ---- 9. pay, a deal with the General, and the army against a party --------------------------------
Po._setInst("army", 55);
const a0 = Po.instLoyalty("army"), t0 = country.treasury;
const payR = Po.pay("army", 0.1);
const a1 = Po.instLoyalty("army");
const dl = Po.deal("army", { kind: "bribe", amount: 40000 });
const a2 = Po.instLoyalty("army");
ok(payR.ok && a1 > a0 && country.treasury < t0, "a pay rise lifts the Army (" + a0 + " -> " + a1.toFixed(1) + ") out of the treasury (" + t0 + " -> " + country.treasury + ")");
ok(dl.ok && a2 > a1 && presState.cabinet.general.loyalty > 60, "the General's deal lifts it again (" + a1.toFixed(1) + " -> " + a2.toFixed(1) + "), and him (" + presState.cabinet.general.loyalty + ")");
nextDay(); nextDay();
ok(Po.instLoyalty("army") >= Po.DEPLOY_MIN, "past the threshold for turning the army inward: " + Po.instLoyalty("army").toFixed(1));
pressed.length = 0;
const soc0 = G().soc, D0 = Po.congress().mood.D;
const dep = Po.executive("deploy", "soc");
ok(dep.ok && pressed.includes("martial"), "the deploy order works: the troops move (" + pressed.join(",") + "): \"" + dep.line + "\"");
ok(G().soc < soc0 - 5 && Po.congress().mood.D < D0 && Po.congress().members.some((m) => m.ideology === "soc" && m.status === "held"), "the socialists, their party and their people in Congress take it");
tick(2);
ok(headlines().includes("Army deployed against the Socialists"), "NEWS ONE: Army deployed against the Socialists");
Po._setInst("army", 40);
const a3 = Po.instLoyalty("army");
const ref = Po.executive("deploy", "com");
ok(!ref.ok && ref.refused && /won't turn the army/.test(ref.line) && Po.instLoyalty("army") < a3, "at low loyalty the General refuses (\"" + ref.line + "\") and the Army climbs the coup ladder");

// ---- 10. a bribe surfaces later -------------------------------------------------------------
Po._setInst("fbi", 35); Po._setInst("cia", 35);
const scB = pol.scandal;
let found = null;
for (let i = 0; i < 25 && !found; i++) { nextDay(); Po._setInst("fbi", 35); Po._setInst("cia", 35); if (Po._state().secrets.some((s) => s.found)) found = day; }
ok(found != null && pol.scandal > scB, "the General's money surfaces on day " + found + ": scandal " + scB.toFixed(1) + " -> " + pol.scandal.toFixed(1));
ok(headlines().some((h) => /^Secret payments to General .* uncovered$/.test(h)), "NEWS ONE: " + headlines().filter((h) => /payments/.test(h)));
Po._setAll(55); for (const k of Po.INSTITUTIONS) Po._setInst(k, 85);

// ---- 11. GENERALITY: every verb at every kind of target -------------------------------------
const targets = {
  citizen: () => ped({ name: "Dana Haas", _sid: "c" + Math.random() }),
  cop: () => ped({ name: "Ray Brooks", kind: "cop", job: "police officer", _sid: "cop" + peds.length }),
  soldier: () => ped({ name: "Jo Lind", organization: "military", job: "soldier", _sid: "sol" + peds.length }),
  agent: () => ped({ name: "Al Grant", job: "federal agent", _sid: "fbi" + peds.length }),
  spy: () => ped({ name: "Mia Sato", job: "cia officer", _sid: "cia" + peds.length }),
  gangster: () => ped({ name: "Nico Reyes", gangId: "g1", _sid: "gm" + peds.length }),
  diplomat: () => ped({ name: "Omar Kale", job: "ambassador", nation: "kesh", _sid: "dip" + peds.length }),
  minister: () => "interior",
  general: () => "general",
  senator: () => Po.congress().members.find((m) => m.status === "sitting").sid,
  group: () => ["com", "soc", "dem", "rep", "ana", "nazi", "nat", "fas"][(Math.random() * 8) | 0],
  party: () => (Math.random() < 0.5 ? "R" : "D"),
  institution: () => Po.INSTITUTIONS[(Math.random() * 5) | 0],
  gang: () => gang,
  nation: () => "kesh",
};
const VERBS = Po.VERBS;
let bad = [], n = 0;
const stories0 = N.audit().pushed;
for (let round = 0; round < 3; round++) {
  for (const v of VERBS) {
    for (const [tk, mk] of Object.entries(targets)) {
      // reset the people a kill or an arrest removes so the sweep keeps going
      for (const [k] of ROLES) { const c = presState.cabinet[k]; c.dead = false; c.vacant = false; }
      for (const m of Po._state().congress.members) if (m.status !== "sitting") m.status = "sitting";
      const t = mk();
      const by = ["self", "order", "army", "police", "ss"][(Math.random() * 5) | 0];
      let r;
      try { r = Po.act(v, { target: t, by }); } catch (e) { bad.push(v + "@" + tk + " threw " + e.message); continue; }
      n++;
      if (!r || !r.ok) { bad.push(v + "@" + tk + " not ok " + (r && r.why)); continue; }
      const vals = Object.values(r.dG || {});
      if (vals.some((x) => !isFinite(x))) bad.push(v + "@" + tk + " NaN");
      const mag = vals.reduce((a, x) => a + Math.abs(x), 0) + Object.values(r.dI || {}).reduce((a, x) => a + Math.abs(x), 0);
      if (!(mag > 0)) bad.push(v + "@" + tk + " no effect");
      if (Po.groups().some((g) => !isFinite(g.loyalty) || g.loyalty < 0 || g.loyalty > 100)) bad.push(v + "@" + tk + " loyalty out of range");
    }
  }
  Po._setAll(55); for (const k of Po.INSTITUTIONS) Po._setInst(k, 85);
}
for (const k of Po.ORDERS) {
  try { const r = Po.act(k, { by: "self" }); if (!r.ok) bad.push("order " + k + " not ok"); else if (Object.values(r.dG || {}).some((x) => !isFinite(x))) bad.push("order " + k + " NaN"); } catch (e) { bad.push("order " + k + " threw " + e.message); }
}
tick(3);
const newStories = N.stories().slice(-16).map((s) => s.h + " / " + s.sub);
ok(bad.length === 0, "sweep: " + n + " acts (" + VERBS.length + " verbs x " + Object.keys(targets).length + " target kinds x 3) + " + Po.ORDERS.length + " orders, no crash, no NaN, every one moves somebody" + (bad.length ? ": " + bad.slice(0, 6).join("; ") : ""));

ok(N.audit().pushed > stories0 + 20 && !newStories.some((s) => /undefined|null|NaN|\[object/.test(s)), "notable acts make clean news: " + N.stories().slice(-4).map((s) => s.h).join(" | "));
// sensible: killing anyone angers everyone some; harming the far right pleases the far left
Po._setAll(55);
let r1 = Po.act("kill", { target: targets.citizen(), by: "self" });
ok(Object.values(r1.dG).every((x) => x < 0), "killing a citizen angers every group");
r1 = Po.act("arrest", { target: { kind: "person", _desc: 1, name: "Karl Heinz", title: "Party organiser", ideology: "nazi", notable: 0.5 }, by: "police" });
ok(r1.dG.com > 0 && r1.dG.nazi < 0, "arresting a neo-Nazi organiser pleases communists, enrages neo-Nazis");
r1 = Po.act("war", { target: "kesh", by: "self" });
ok(r1.dG.nat > 0 && r1.dG.soc < 0, "war pleases nationalists and angers socialists");
r1 = Po.act("arrest", { target: targets.citizen(), by: "police", scale: 6 });
ok(r1.dG.ana < 0 && r1.dG.dem < 0, "mass arrests anger anarchists and democrats");
// small acts aggregate
Po._state().counts = {};   // the sweep killed a crowd in Eastgate; count a fresh week
for (let i = 0; i < 3; i++) Po.act("kill", { target: ped({ name: "X" + i, _sid: "agg" + i, nameKnown: false }), by: "self" });
tick(2);
ok(headlines().some((h) => /^(Second|Third) killing in Eastgate this week$/.test(h)), "small acts aggregate: " + headlines().filter((h) => /killing/.test(h)).join(" / "));

// ---- 12. ONE MODEL ------------------------------------------------------------------------
function walk(dir, out) { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.js$/.test(f)) out.push(p); } return out; }
const files = walk(path.join(ROOT, "src"), []);
const approvalWrites = [];
const ALLOW_APPROVAL = { "src/city/politics.js": 1, "src/city/approval.js": 1, "src/city/polity.js": 1 };
for (const f of files) {
  const rel = path.relative(ROOT, f);
  const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const m = src.match(/\b(rec|r|c|s|parentRec|country|seatRec\(\)|h\.rec|rec_)\.approval\s*(=[^=]|\+=|-=)/g);
  if (m && !ALLOW_APPROVAL[rel]) approvalWrites.push(rel + ": " + m.join(", "));
}
ok(approvalWrites.length === 0, "no private approval writes outside politics.js / approval.js / polity.js's save: " + approvalWrites.join(" | "));
const aprSrc = readFileSync(path.join(ROOT, "src/city/approval.js"), "utf8");
ok((aprSrc.match(/\.approval\s*=[^=]/g) || []).length === 1 && /if \(politicsOwns\(c\.id\)\) continue;/.test(aprSrc) && /if \(politicsOwns\(id\)\) \{ CBZ\.politics\.shock/.test(aprSrc),
  "approval.js writes through one line, skips the seat, routes its shocks");
const PRES_FILES = ["presidency.js", "president_staff.js", "president_office.js", "president_public.js", "dissent.js", "warroom.js", "phone_apps.js", "protection.js", "civilwar.js", "statecraft.js"];
const loyaltyWrites = [];
for (const f of PRES_FILES) {
  const src = readFileSync(path.join(ROOT, "src/city", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const m = src.match(/\.(loyalty|army|unrest|movement)\s*(=[^=]|\+=|-=)/g);
  if (m) loyaltyWrites.push(f + ": " + m.join(", "));
}
ok(loyaltyWrites.length === 0, "no private loyalty / unrest / movement / army counters in the president's files: " + loyaltyWrites.join(" | "));
const pub = readFileSync(path.join(ROOT, "src/city/president_public.js"), "utf8");
ok(!/UNPOPULAR/.test(pub) && /Pol\.streetAnger\(\)/.test(pub), "the street's anger is the groups' (president_public reads politics.streetAnger)");
const staffSrc = readFileSync(path.join(ROOT, "src/city/president_staff.js"), "utf8");
ok(/Po\.confirm\(role, cand\)/.test(staffSrc) && !/pFail/.test(staffSrc), "the Senate's confirmation is Congress's vote (no coin flip)");
const presSrc = readFileSync(path.join(ROOT, "src/city/presidency.js"), "utf8");
ok(/Pol\.act\(actKey/.test(presSrc) && /CBZ\.politics\.onDeath/.test(presSrc) && /Pol\.gate\(actKey\)/.test(presSrc), "every order and every death in presidency.js goes through politics (act, onDeath, Congress gate)");
const wr = readFileSync(path.join(ROOT, "src/city/warroom.js"), "utf8");
ok(/polAct\("war"/.test(wr) && /polAct\("strike-own"/.test(wr) && /Po\.gate\("war"\)/.test(wr), "the war room reports its acts and asks Congress");
const allText = said.map((s) => s.line).concat(headlines(), A.feed().map((p) => p.text)).join("\n");
ok(!/[—–·•]/.test(allText) && !/undefined|NaN/.test(allText), "text law: no em dashes, no undefined in anything said, aired or posted");

console.log((fails ? "POLITICS: FAIL " : "POLITICS: OK ") + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
