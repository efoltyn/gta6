#!/usr/bin/env node
/* tools/president-start-arms-check.mjs — NOBODY AT THE TABLE POINTS A GUN.

   OWNER (iPad): "the president game starts with one of your ministers
   pointing a gun at you."

   Root cause: the President's own people were spawned ARMED. The Situation
   Room General was posted `armed: role === "general"`, and every staffer
   posted without `armed: false` rolled city/peds.js makePed's street default
   (~21% "packing" at wealth 0.7). An armed body is governed by the street's
   gun rules, so a levelled gun in the camera cone or any armed threat in the
   room squared him up at the President.

   Plain node, no browser, two parts:
     1. the REAL city/president_staff.js + politics.js + dissent.js in a stub
        world (tools/president-staff-check.mjs's) whose cityPostNpc arms any
        body that does not say `armed: false` (the street default, worst
        case). A new presidency is ticked at the desk; every body posted for
        the President must be unarmed, a _stateStaff, with no rage, no draw
        reason, no aim-back and no target. presidency.js's postOfficer and
        politics.js's senators are held to `armed: false` in their source.
     2. the REAL CBZ.gunDiscipline (systems/actorweapons.js): every trigger
        name thrown at a _stateStaff body (even one somehow armed) leaves him
        holstered; the same body with _coup stamped (a real coup) may draw.
   Exit 0 = ok. */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { fakeDocument } from "./lib/fake-canvas.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");
let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; if (process.env.V) console.log("  ok " + m); } else { fails++; console.log("  FAIL " + m); } }

// ------------------------------------------------------------ 1. the staff
{
  let day = 1;
  const upd = [], newDay = [], bus = {}, peds = [];
  const P = { pos: { x: 0, y: 10, z: 18 }, dead: false, isPlayer: true };
  const office = {
    key: "ovaloffice", floorY: 10,
    approach: { x: 0, z: 0, nx: 0, nz: 1, tx: 1, tz: 0, depth: 24, span: 12 },
    landmarks: { presidentialDesk: { x: 0, z: 20 }, arrivalPortal: { x: 0, z: 6 } },
  };
  const country = { id: "republic", kind: "country", name: "Republic of Libertas", approval: 52, treasury: 100000, govType: "democracy", office: { holder: "player", deputy: "vp1" } };
  const TITLES = { chief: ["Chief of Staff", ""], general: ["General", "General"], bureau: ["Bureau Director", "Director"], police: ["Police Commissioner", "Commissioner"], treasury: ["Treasury Secretary", "Secretary"] };
  const NAMES = { chief: "Ruth Adair", general: "Marcus Brandt", bureau: "Leon Varga", police: "Nadia Serrano", treasury: "Oscar Whitlock" };
  const cab = {};
  for (const k in NAMES) cab[k] = { name: NAMES[k], sid: "sid_" + k, role: TITLES[k][0], gender: "m", dead: false, refused: 0, loyalty: 60, trait: null };
  let mintN = 0;
  const minted = [];
  const CBZ = {
    game: { mode: "city", state: "playing" }, player: P, CONFIG: {},
    onUpdate: (o, fn) => upd.push({ o, fn }), onAlways: (o, fn) => upd.push({ o, fn }),
    onNewDay: (fn) => newDay.push(fn), worldDay: () => day,
    gov: { holds: () => ({ kind: "country", id: "republic", rec: country }) },
    polity: { get: (id) => (id === "republic" ? country : null), list: (k) => (k === "country" ? [country] : []) },
    polwar: { militaryOf: () => ({ readiness: 0.6, soldiers: 1000 }) },
    approvalShock: () => {}, cityWorldEnsure: () => ({ politics: { scandal: 0 } }),
    cityMintName: (rng) => ["Ada Okafor", "Ben Reyes", "Cy Novak", "Dee Moreau"][(rng() * 4) | 0],
    cityPedStash: (o) => { o._sid = "minted_" + (++mintN); minted.push(o); },
    citySay: () => true, sayLines: (l, end) => { if (end) end(); return {}; }, speech: { phone: () => true },
    // THE STREET DEFAULT, worst case: a body that does not say armed: false is armed
    cityPostNpc: (x, z, o) => {
      const armed = o.armed != null ? !!o.armed : true;
      const p = { pos: { x, y: o.floorY || 0, z }, group: { rotation: {} }, target: { set() {} }, job: o.job, gender: o.gender, opts: o, armed, weapon: armed ? "Pistol" : null };
      peds.push(p); return p;
    },
    cityUnpostNpc: (p) => { p._gone = true; },
    interactions: { registerFor: () => {} },
    presidentInteriorRooms: () => [office],
    civilwar: { coup: () => ({ outcome: "none" }) },
    warroom: { nation: () => "republic", enemy: () => null, warheads: () => 0, canWar: () => ({ ok: false }) },
    officials: { identityOf: () => null, titleFor: () => "President" },
  };
  CBZ.presidency = {
    seat: () => CBZ.gov.holds(),
    staff: () => CBZ._staff || (CBZ._staff = {}),
    cabinet: () => { const out = {}; for (const k in cab) out[k] = Object.assign({ display: (TITLES[k][1] ? TITLES[k][1] + " " : "") + cab[k].name }, cab[k]); return out; },
    cabinetRecord: (r) => cab[r] || null,
    vacateCabinet: () => true, fillCabinet: () => true, bureauStop: () => true, bureauIntel: () => true,
    on(evt, fn) { (bus[evt] = bus[evt] || []).push(fn); },
    emit(evt, p) { for (const fn of (bus[evt] || [])) fn(p, evt); },
    press: () => ({ ok: true }),
  };
  const THREE = { CanvasTexture: class {}, MeshBasicMaterial: class {}, PlaneGeometry: class {}, Mesh: class {}, Group: class {}, Vector3: class {}, Vector2: class {}, Matrix4: class {}, Quaternion: class {}, Euler: class {} };
  const sb = { window: null, CBZ, THREE, console: { log() {}, warn() {}, error() {} }, Math, Object, Array, Set, Map, JSON, isFinite, Number, String, Date, Infinity, parseInt, setTimeout: (f) => f(), clearTimeout() {} };
  sb.window = sb;
  vm.createContext(sb);
  for (const f of ["src/city/newsroom.js", "src/city/phone_apps.js", "src/city/politics.js", "src/city/president_staff.js", "src/city/dissent.js"]) {
    vm.runInContext(read(f), sb, { filename: f });
  }
  upd.sort((a, b) => a.o - b.o);
  for (let t = 0; t < 20; t += 0.25) for (const u of upd) u.fn(0.25);
  const live = peds.filter((p) => !p._gone);
  ok(live.length > 0, "a new presidency posts its people at the desk (" + live.length + ": " + live.map((p) => p.job).join(", ") + ")");
  for (const p of live) {
    const who = p.job || "?";
    ok(!p.armed && p.opts.armed === false, who + " is posted unarmed (armed: false, not the street roll)");
    ok(p._stateStaff === true || p.opts.src === "presstaff:driver", who + " is stamped _stateStaff");
    ok(!p.rage && !p._drawWhy && !p.poseAimBack && !p.npcTarget && !p.curTarget, who + " has no rage, draw reason, aim-back or target at start");
  }
  for (const o of minted) ok(o.armed === false, "minted identity " + (o.job || "?") + " carries armed: false");
  // the two posters this stub cannot run: their source is held to it
  const pres = read("src/city/presidency.js");
  const po = pres.slice(pres.indexOf("function postOfficer("), pres.indexOf("function answerLine("));
  ok(/armed:\s*false/.test(po) && !/armed:\s*role/.test(po), "presidency.js postOfficer posts every cabinet officer (the General too) armed: false");
  ok(/_stateStaff = true/.test(po), "presidency.js postOfficer stamps _stateStaff");
  const pol = read("src/city/politics.js");
  ok(/job: "senator"[^\n]*armed: false/.test(pol), "politics.js posts senators armed: false");
}

// ------------------------------------------------------------ 2. the discipline
{
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error: console.error }, Math, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, performance, Date });
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.document = fakeDocument();
  ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
  ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  ctx.addEventListener = () => {}; ctx.requestAnimationFrame = () => 0;
  const clocks = [];
  ctx.CBZ = { CONFIG: {}, game: { mode: "city" }, npcs: [], onUpdate(o, f) { if (o === 35.5) clocks.push(f); }, onAlways() {}, onReset() {}, onModeEnter() {}, on() {} };
  for (const f of ["src/vendor/three.r128.min.js", "src/config.js", "src/core/matrixskip.js", "src/world/materials.js", "src/systems/fphands.js",
    "src/entities/footwear.js", "src/entities/character.js", "src/weapons/weapon-data.js", "src/weapons/weapon-scale.js", "src/weapons/appearances/sidearm.js", "src/systems/actorweapons.js"]) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const GD = ctx.CBZ.gunDiscipline;
  ok(!!GD, "CBZ.gunDiscipline loads");
  if (GD) {
    const step = (a, s) => { for (let t = 0; t < s; t += 0.1) { for (const c of clocks) c(0.1); GD.sense(a); GD.tick(a, 0.1); } };
    const whys = Object.keys(GD.LV);
    // a minister who somehow has a gun, with every reason in the book
    const minister = { name: "General Brandt", armed: true, weapon: "Pistol", pos: { x: 0, z: 0 }, _stateStaff: true, _presOfficer: "general",
      _drawWhy: { why: "order", by: "president", target: { pos: { x: 0, z: 1 } } }, rage: { pos: { x: 0, z: 2 } }, state: "fight" };
    for (const w of whys) GD.trigger(minister, w, 3);
    step(minister, 2);
    ok(!GD.drawn(minister), "a _stateStaff body never draws (" + whys.join(", ") + ", a stale order, a rage)");
    const coup = { name: "General Brandt", armed: true, weapon: "Pistol", pos: { x: 0, z: 0 }, _stateStaff: true, _coup: true };
    GD.trigger(coup, "order", 2); step(coup, 0.5);
    ok(GD.drawn(coup), "the same man in a real coup (_coup) can draw");
    // the football aide: never on a threat; on an order the case goes down first
    let released = null;
    const aide = { name: "aide", armed: true, weapon: "Pistol", pos: { x: 0, z: 0 } };
    aide._carries = { what: "football", release: (why) => { released = why; aide._carries = null; } };
    for (const w of ["ward", "armed-threat", "aimed-at", "shot-at", "assault"]) GD.trigger(aide, w, 3);
    step(aide, 2);
    ok(!GD.drawn(aide) && released === null && !!aide._carries, "the football carrier does not draw on a threat and keeps the case");
    GD.trigger(aide, "order", 2); step(aide, 0.5);
    ok(released === "order" && !aide._carries && GD.drawn(aide), "ordered to attack, he sets the case down BEFORE the gun comes out");
  }
}

console.log((fails ? "FAIL" : "PASS") + " president start arms: " + passes + " ok, " + fails + " failing");
process.exit(fails ? 1 : 0);
