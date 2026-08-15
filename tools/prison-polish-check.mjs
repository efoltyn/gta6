#!/usr/bin/env node
/* tools/prison-polish-check.mjs — the PRISON (mode "escape") polish gate.

   Boots the game headless straight into the escape run and asserts, as numbers,
   the four things the 2026-08-04 phone-polish wave changed. Every one of them is
   a claim about live state, never about pixels:

     1. THE ARMORY IS THE ARMORY. Every id in CBZ.FPS_WEAPONS has a rack slot,
        the heavy tier is behind the cage, and TAKING a gun removes it from the
        wall (model.visible false, pad unlit) instead of tinting a pad green.
     2. AN OPEN DOOR IS OPEN. The owner's "invisible door left behind the armory
        door" was core/losgrid.js baking a MOVER's closed-position AABB into a
        grid nothing re-dirties. Cast through the doorway, slide the gate up,
        cast again: the second cast must miss. Runs the same test on the yard
        door (world/door.js), which had the identical fault.
     3. A CELL IS FIRST PERSON. The room probes must actually SEE a cell (span
        and ceiling), CAM_TIGHT_FP must take the view there, and the yard must
        give it straight back — plus a hand toggle must out-rank the rule.
     4. THE HUD SAYS ONLY WHAT IS TRUE. A quiet run shows no gang panel, no
        wanted meter and no TIPS control anywhere in the DOM.

   Numeric-only; never eyeball. Boot boilerplate copied from tools/jail-check.mjs
   (which is itself math-gate's), including the macOS Chrome fallback.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8890 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9890 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-prison-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1440,900",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

function done(code) { try { chrome.kill("SIGTERM"); } catch (_) {} try { server.kill("SIGTERM"); } catch (_) {} rm(profile, { recursive: true, force: true }).catch(() => {}); process.exit(code); }

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); }
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200)); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

// startRun() refuses before CBZ.bootComplete (main.js sets it last), which is
// exactly the window the PLAY button is already in the DOM for — waiting on the
// button alone starts a fraction of a world and bounces back to "title".
for (let i = 0; i < 90; i++) { if (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 40 && !playing; i++) {
  await evl("try{CBZ.setMode('escape'); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;");
  await sleep(500);
  playing = await evl("return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='escape');");
}
console.log("playing(escape):", playing);
if (!playing) { console.log("ERRORS:", [...new Set(errors)].slice(0, 10)); done(2); }

const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail }); console.log((cond ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }
function bad(r) { return !r || typeof r !== "object" || r.__err != null; }
function why(r) { return (r && r.__err) ? ("threw: " + String(r.__err).split("\n")[0]) : JSON.stringify(r); }

// MEASURED FIRST, ON THE PRISON AS BOOTED. This block ran last and read
// 227%: by then the suite had spawned test actors and switched into
// gungame, whose bots live in CBZ.npcs too. A population assertion has to
// be taken before the suite starts editing the world it is measuring.
{
  /* THE PRISON HOLDS WHO IT CAN SLEEP (2026-08-09).

     Owner: "There's too many fucking people" — the second time, MASS_CROWD
     having already been cut 900 -> 140 for the first. The headcount was five
     constants in four files and not one of them could see that the wing had
     thirteen cells; measured, the yard ran ~207 bodies against 26 bunks, about
     800% of the only housing in the world. These assertions exist so the
     number can never go back to being typed: what the building sleeps is a
     FACT it publishes, and the anonymous tiers are the remainder of a
     subtraction against it. (The wing has since grown to twenty-five cells
     and sixty-six racks; the thirteen above is the state that produced the
     fault, and the 26 is its arithmetic. That these assertions still pass
     unchanged across that growth is the point of writing them this way.)

     `occupancy` is reported rather than merely bounded, because it is the
     honest number: the NAMED cast alone runs this wing at ~185%, which is
     California's pre-Plata figure (Brown v. Plata, 563 U.S. 493) and about as
     overcrowded as a real prison has ever been made to answer for. The cap
     here is 2.0 — past that the world is describing something that is not a
     prison, and the fix is cells, not a smaller cast. */
  const r = await evl(`
    if (!CBZ.prisonPopulationAudit || !CBZ.prisonBeds) return { no: true };
    const a = CBZ.prisonPopulationAudit(), w = CBZ.prisonBeds();
    return { a: a, w: w };
  `);
  if (bad(r) || r.no) check("population: the wing publishes what it sleeps", false, why(r));
  else {
    check("population: the housing units state their own capacity",
      r.w.cells > 0 && r.w.beds === r.w.racks &&
        r.w.beds === r.w.cells * r.w.perCell + r.w.housingStacks * 2 && r.w.houses > 0,
      JSON.stringify(r.w));
    check("population: the headcount is derived, not typed",
      r.a.derived === true && r.a.explicit === false,
      JSON.stringify({ derived: r.a.derived, explicit: r.a.explicit, ambient: r.a.ambient }));
    // the load-bearing one: no ANONYMOUS body may be added to a prison that
    // already cannot sleep the men in it.
    check("population: the anonymous tier never exceeds the beds left over",
      r.a.ambient === Math.max(0, r.w.houses - (r.a.rigs + r.w.cells - r.a.ambient)) || r.a.ambient === 0,
      JSON.stringify({ ambient: r.a.ambient, houses: r.w.houses, rigs: r.a.rigs }));
    check("population: occupancy stays inside the worst real prison on record",
      r.a.occupancy > 0 && r.a.occupancy <= 2.0,
      `${(r.a.occupancy * 100).toFixed(0)}% of design capacity — ${r.a.live} men, ${r.w.beds} bunks, ${r.a.guards} staff`);
  }
}

const step = (n) => evl(`for(var i=0;i<${n | 0};i++) CBZ.stepSim(1/60); return true;`);

// ---- 0. THE HUD SAYS ONLY WHAT IS TRUE -----------------------------------
// FIRST, on the untouched opening state — every later section trespasses in the
// armory, opens doors and teleports about, all of which are real heat and would
// make a quiet-HUD assertion meaningless.
{
  await step(120);
  const r = await evl(`
    function vis(id){ var e = document.getElementById(id); return !!e && getComputedStyle(e).display !== "none"; }
    var d = document.getElementById("detectWrap");
    var tips = document.querySelectorAll(".po-tips, .pi-tips-choice, .pi-tips-action, .ihelp").length;
    return {
      gang: vis("gangHud"), gangHTML: (document.getElementById("gangHud") || {}).innerHTML,
      wantedQuiet: !!(d && d.classList.contains("quiet")), state: (document.getElementById("detectState") || {}).textContent,
      tipsNodes: tips, tipsText: /TIPS (ON|OFF)/i.test((document.body || {}).innerText || ""),
      det: +(CBZ.game.detection || 0).toFixed(1),
      cfgTips: CBZ.CONFIG.PRISON_TIPS, cfgGang: CBZ.CONFIG.JAIL_GANG_HUD_LIVE, cfgWanted: CBZ.CONFIG.JAIL_WANTED_HUD_LIVE,
    };
  `);
  if (bad(r)) check("hud: reads", false, why(r));
  else {
    check("hud: no gang panel on a quiet run", r.gang === false, JSON.stringify({ gang: r.gang, html: r.gangHTML, flag: r.cfgGang }));
    check("hud: the wanted meter is quiet while clear", r.wantedQuiet === true, JSON.stringify({ quiet: r.wantedQuiet, state: r.state, det: r.det, flag: r.cfgWanted }));
    check("hud: no TIPS control anywhere", r.tipsNodes === 0 && r.tipsText === false, JSON.stringify({ nodes: r.tipsNodes, text: r.tipsText, flag: r.cfgTips }));
  }
}

// ---- 1. THE ARMORY HAS EVERY GUN, AND A TAKEN GUN LEAVES THE WALL ---------
{
  const r = await evl(`
    var a = CBZ.armory, aud = CBZ.gunroomAudit();
    var have = {}; a.slots.forEach(function(s){ have[s.id] = s.gated ? "cage" : "rack"; });
    var missing = CBZ.FPS_WEAPONS.filter(function(w){ return !have[w.id]; }).map(function(w){ return w.id; });
    return { rackSlots: aud.rackSlots, gated: aud.gatedSlots, weapons: CBZ.FPS_WEAPONS.length,
             missing: missing, where: have, bespoke: aud.bespoke, seeThrough: aud.seeThrough };
  `);
  if (bad(r)) check("armory: audit reads", false, why(r));
  else {
    check("armory: every FPS weapon has a slot", r.missing.length === 0, "missing=" + JSON.stringify(r.missing) + " slots=" + r.rackSlots + "/" + r.weapons);
    check("armory: the heavy tier is behind the cage", r.gated === 4, "gated=" + r.gated + " " + JSON.stringify(["sniper", "lmg", "bazooka", "glauncher"].map((k) => k + ":" + r.where[k])));
    check("armory: ratchets hold (bespoke 0, seeThrough 1)", r.bespoke === 0 && r.seeThrough === 1, `bespoke=${r.bespoke} seeThrough=${r.seeThrough}`);
  }
}
{
  // TAKE one and read the wall. unlockWeapon is the same call the pickup makes.
  const r = await evl(`
    var a = CBZ.armory, s = null;
    for (var i=0;i<a.slots.length;i++) if (a.slots[i].id === "shotgun") s = a.slots[i];
    if (!s) return { no: true };
    var before = { vis: s.model.visible, pad: s.pad.material.emissive.getHex() };
    CBZ.unlockWeapon("shotgun", { select: true });
    a.resetSlots();
    var after = { vis: s.model.visible, pad: s.pad.material.emissive.getHex(), taken: s.taken };
    return { before: before, after: after, owned: !!CBZ.hasWeapon("shotgun") };
  `);
  if (bad(r) || r.no) check("armory: a taken gun leaves the wall", false, why(r));
  else {
    check("armory: the gun was on the wall before", r.before.vis === true, JSON.stringify(r.before));
    check("armory: taking it removes the MESH", r.owned && r.after.vis === false, JSON.stringify(r.after));
    check("armory: the empty bracket goes dark, not green", r.after.pad === 0, "emissive=0x" + Number(r.after.pad).toString(16));
  }
}

// ---- 2. AN OPEN DOOR IS OPEN (the losgrid mover bug) ----------------------
// The grid is BUILT by the first cast, so casting before the move is what makes
// this a real regression test: a stale grid answers from the baked AABB.
async function doorCast(label, setup, expr) {
  return await evl(`
    var T = window.THREE, R = new T.Raycaster();
    function cast(o, d, far){ R.set(o.clone(), d.clone().normalize()); R.near = 0; R.far = far;
      var h = CBZ.losRaycast ? CBZ.losRaycast(R, CBZ.losBlockers) : R.intersectObjects(CBZ.losBlockers, false);
      return h.length ? { d: +h[0].distance.toFixed(2), hit: h[0].object === ${expr} } : null; }
    ${setup}
    return { closed: closedHit, open: openHit };
  `);
}
{
  // ARMORY: stand inside at (24, 1.6, 1) and shoot west, out through the door.
  const r = await doorCast("armory", `
    var o = new T.Vector3(24, 1.6, 1), d = new T.Vector3(-1, 0, 0);
    var closedHit = cast(o, d, 9);
    var g = CBZ.armory.gate;
    CBZ.armory.open = true; CBZ.armory.t = 1;
    var ci = CBZ.colliders.indexOf(CBZ.armory.collider); if (ci >= 0) CBZ.colliders.splice(ci, 1);
    g.position.y = 9; g.updateMatrixWorld(true);
    var openHit = cast(o, d, 9);
  `, "CBZ.armory.gate");
  if (bad(r)) check("armory door: LOS follows the leaf", false, why(r));
  else {
    check("armory door: SHUT blocks the shot", !!(r.closed && r.closed.hit), JSON.stringify(r.closed));
    check("armory door: OPEN lets it through", !(r.open && r.open.hit), JSON.stringify(r.open));
  }
}
{
  // YARD DOOR (world/door.js): same slide, same fault. Stand south of it and
  // shoot north through the opening.
  const r = await doorCast("yard", `
    var o = new T.Vector3(0, 1.6, -5), d = new T.Vector3(0, 0, -1);
    var closedHit = cast(o, d, 9);
    CBZ.openDoor(); CBZ.door.t = 1; CBZ.door.mesh.position.y = CBZ.door.closedY + (CBZ.door.travel || 8);
    CBZ.door.mesh.updateMatrixWorld(true);
    var openHit = cast(o, d, 9);
  `, "CBZ.door.mesh");
  if (bad(r)) check("yard door: LOS follows the leaf", false, why(r));
  else {
    check("yard door: SHUT blocks the shot", !!(r.closed && r.closed.hit), JSON.stringify(r.closed));
    check("yard door: OPEN lets it through", !(r.open && r.open.hit), JSON.stringify(r.open));
  }
}

// ---- 3. A CELL IS FIRST PERSON (CAM_TIGHT_FP) ----------------------------
async function moveTo(expr, ticks) {
  await evl(`var p = ${expr}; CBZ.player.pos.set(p.x, p.y == null ? 0 : p.y, p.z); CBZ.player.vy = 0;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos); return true;`);
  await step(ticks || 150);
  return await evl("var a = CBZ.camRoomAudit(); a.pos = { x:+CBZ.player.pos.x.toFixed(1), z:+CBZ.player.pos.z.toFixed(1) }; return a;");
}
{
  // The prison ARMS first person after the intro (state.js), so a default run is
  // already FP and the rule has nothing to take. Choose third person OUT IN THE
  // YARD — that is both the state the owner is describing and the only place a
  // hand toggle is not read as "leave my cell camera alone" (see autoFPBlock).
  const yard0 = await moveTo("({ x: 0, z: 30 })", 60);
  await evl("CBZ.setFPS(false); return true;");
  await step(90);
  if (bad(yard0)) check("camera: the yard probes read", false, why(yard0));
  else check("camera: the yard measures as open", yard0.span >= 5.2, "span=" + (yard0.span && yard0.span.toFixed(2)));

  const cell = await moveTo("CBZ.cellblock.playerSpawn()", 220);
  if (bad(cell)) check("camera: the cell probes read", false, why(cell));
  else {
    check("camera: a cell measures as a cell", cell.span <= 3.6 && cell.ceil <= 2.9, `span=${cell.span && cell.span.toFixed(2)} ceil=${cell.ceil && cell.ceil.toFixed(2)}`);
    check("camera: the cell takes first person", cell.fp === true && cell.auto === true, JSON.stringify({ fp: cell.fp, auto: cell.auto, blocked: cell.blocked }));
  }
  const yard = await moveTo("({ x: 0, z: 30 })", 220);
  if (bad(yard)) check("camera: the yard probes read", false, why(yard));
  else check("camera: the yard gives third person back", yard.fp === false && yard.auto === false, JSON.stringify({ fp: yard.fp, auto: yard.auto }));

  // THE PLAYER OUTRANKS THE RULE: choose first person in the open, walk into a
  // cell and back out, and the rule must not "give back" a view it never took.
  await evl("CBZ.setFPS(true); return true;");
  await step(60);
  const held = await moveTo("CBZ.cellblock.playerSpawn()", 220);
  const back = bad(held) ? held : await moveTo("({ x: 0, z: 30 })", 220);
  if (bad(back)) check("camera: a hand-picked view survives", false, why(back));
  else check("camera: a hand-picked view survives the round trip", back.fp === true && back.auto === false, JSON.stringify({ fp: back.fp, auto: back.auto }));
  await evl("CBZ.setFPS(false); return true;");
}

// ---- 3b. THE WORLD SAYS IT (the gang HUD's logic, off the HUD) -----------
// The #gangHud strip is gone; these assert that what it used to print now
// HAPPENS instead — a working mouth, narrations routed into it, and a snitch
// you have to actually make.
{
  // put the player somewhere open and quiet first
  await evl("CBZ.player.pos.set(0,0,30); return true;");
  await step(60);
  const r = await evl(`
    var e = document.getElementById("gangHud");
    return { flag: CBZ.CONFIG.JAIL_GANG_HUD,
             shown: !!e && getComputedStyle(e).display !== "none",
             html: e ? e.innerHTML : null };
  `);
  if (bad(r)) check("world: gang panel reads", false, why(r));
  else check("world: the gang HUD strip is gone", r.flag === false && r.shown === false, JSON.stringify(r));
}
{
  // THE MOUTH. Before this wave every prison citySay threw (prison actors keep
  // position on .group, not .pos), so this asserts BOTH that prisonSay works
  // and that it is not the old broken path.
  const r = await evl(`
    var n = null;
    for (var i = 0; i < CBZ.npcs.length; i++) { var c = CBZ.npcs[i]; if (c && !c.dead && c.group) { n = c; break; } }
    if (!n) return { no: true };
    CBZ.player.pos.set(n.group.position.x + 1.5, 0, n.group.position.z);
    var far = null, near = null, threwCity = null;
    try { CBZ.citySay(n, "x", "#fff", 1); } catch (e) { threwCity = String(e).split("\\n")[0]; }
    near = CBZ.prisonSay(n, "TEST LINE NEAR", { secs: 4 });
    var el = document.getElementById("pinteractSay");
    var shown = el ? { cls: el.className, line: (el.querySelector(".pi-subtitle-line") || {}).textContent,
                       who: (el.querySelector(".pi-subtitle-speaker") || {}).textContent } : null;
    // …and out of range it must refuse rather than broadcast
    CBZ.player.pos.set(n.group.position.x + 60, 0, n.group.position.z + 60);
    far = CBZ.prisonSay(n, "TEST LINE FAR", { secs: 4 });
    return { near: near, far: far, shown: shown, threwCity: threwCity, audit: CBZ.prisonSayAudit() };
  `);
  if (bad(r) || r.no) check("world: the prison has a mouth", false, why(r));
  else {
    check("world: an inmate beside you can speak", r.near === true && !!r.shown && /TEST LINE NEAR/.test(r.shown.line || ""), JSON.stringify(r.shown));
    check("world: the speaker is named", !!r.shown && !!r.shown.who, JSON.stringify(r.shown && r.shown.who));
    check("world: a line is overheard, not broadcast", r.far === false, JSON.stringify({ far: r.far, audit: r.audit }));
    // the old path is still broken — that is WHY prisonSay exists, and if it
    // ever starts working this assertion is the thing that tells us.
    check("world: (context) citySay still cannot read a prison actor", !!r.threwCity, String(r.threwCity));
  }
}
{
  // A NARRATION NOW HAS A MOUTH. Drive a real debt-collector approach to
  // EXPIRY beside the player and assert ai.js spoke instead of going mute.
  const r = await evl(`
    var n = null;
    for (var i = 0; i < CBZ.npcs.length; i++) { var c = CBZ.npcs[i]; if (c && !c.dead && c.gang >= 0) { n = c; break; } }
    if (!n) return { no: true };
    CBZ.player.pos.set(n.group.position.x + 1.2, 0, n.group.position.z);
    var before = CBZ.aiNarrationAudit();
    n.aiState = "approachPlayer";
    n.approach = { kind: "debtCollect", t: 0.05, cost: 6, gang: n.gang };
    for (var k = 0; k < 40; k++) CBZ.stepSim(1/60);
    var el = document.getElementById("pinteractSay");
    return { before: before, after: CBZ.aiNarrationAudit(),
             line: el ? (el.querySelector(".pi-subtitle-line") || {}).textContent : null };
  `);
  if (bad(r) || r.no) check("world: a narration finds a mouth", false, why(r));
  else {
    check("world: the collector SAYS the debt", r.after.spoken > r.before.spoken, JSON.stringify({ spoken: r.after.spoken, mute: r.after.mute, line: r.line }));
    check("world: the spoken line is a person talking", !!r.line && !/^the (Reds|Blues|block)\b/.test(r.line), JSON.stringify(r.line));
  }
}
{
  // A SNITCH YOU HAVE NOT MADE IS JUST ANOTHER INMATE.
  const r = await evl(`
    var n = null;
    for (var i = CBZ.npcs.length - 1; i >= 0; i--) { var c = CBZ.npcs[i]; if (c && !c.dead && c.data) { n = c; break; } }
    if (!n) return { no: true };
    // report lodged with the player nowhere near: he cannot have seen it
    CBZ.player.pos.set(n.group.position.x + 80, 0, n.group.position.z + 80);
    n.snitchKnown = null;
    n.reportedPlayerT = 40; n.reportedPlayerCred = 0.7; n.reportedPlayerGuard = "a guard";
    var blindKnows = CBZ.playerKnowsSnitch(n);
    CBZ.learnSnitch(n, "paid");
    var paidKnows = CBZ.playerKnowsSnitch(n);
    return { blindKnows: blindKnows, paidKnows: paidKnows, how: n.snitchKnown,
             audit: CBZ.snitchKnowledgeAudit() };
  `);
  if (bad(r) || r.no) check("world: snitch knowledge gate", false, why(r));
  else {
    check("world: an unseen report names nobody", r.blindKnows === false, JSON.stringify({ knows: r.blindKnows }));
    check("world: the bought name is the knowledge", r.paidKnows === true && r.how === "paid", JSON.stringify({ knows: r.paidKnows, how: r.how }));
    check("world: the audit counts what you have made", r.audit.reported >= 1 && r.audit.known >= 1, JSON.stringify(r.audit));
  }
}
{
  // THE LEDGER HAS A PAGE. Open the Ranks board on WHERE YOU STAND.
  const r = await evl(`
    CBZ.ui.dashboard = true; CBZ.ui.dashTab = 3;
    if (CBZ.renderDashboard) CBZ.renderDashboard(); else for (var i=0;i<4;i++) CBZ.stepSim(1/60);
    var d = document.getElementById("dashboard");
    var txt = d ? d.textContent : "";
    var rows = d ? d.querySelectorAll(".dledger .drow").length : 0;
    CBZ.ui.dashboard = false;
    return { rows: rows, reds: /the Reds/.test(txt), blues: /the Blues/.test(txt),
             ledger: !!(d && d.querySelector(".dledger")), head: /Where You Stand/.test(txt) };
  `);
  if (bad(r)) check("world: the standing page", false, why(r));
  else check("world: WHERE YOU STAND lists both crews", r.ledger && r.head && r.reds && r.blues && r.rows >= 2, JSON.stringify(r));
}

// ---- 4. GUN GAME SHOWS ONE GUN BAR AND NO DEAD WORDS ---------------------
{
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) {
    await evl("try{CBZ.setMode('gungame'); CBZ.startRun && CBZ.startRun();}catch(e){} return true;");
    await sleep(400);
    ok = await evl("return !!(CBZ.game.state==='playing' && CBZ.game.mode==='gungame' && CBZ.gungame && CBZ.gungame.match);");
  }
  check("gungame: match runs", ok);
  if (ok) {
    await step(90);
    const r = await evl(`
      var s = document.getElementById("weaponStrip"), h = document.getElementById("hotbar");
      var gg = document.getElementById("gungameHud");
      function txt(c){ var e = gg && gg.querySelector(c); return e ? e.textContent : null; }
      var cells = 0, hidden = 0;
      h.querySelectorAll(".islot").forEach(function(c){ cells++; if (getComputedStyle(c).display === "none") hidden++; });
      return {
        docked: !!(s && s.parentNode === h), floating: !!(s && s.parentNode && s.parentNode.id === "hud"),
        stripShown: !!(s && getComputedStyle(s).display !== "none"),
        cells: cells, hiddenCells: hidden,
        bagHidden: getComputedStyle(document.getElementById("invBagBtn") || document.createElement("i")).display === "none",
        panel: !!gg,
        panelFlag: !!(window.CBZ.CONFIG && window.CBZ.CONFIG.GUNGAME_HUD_PANEL),
        now: txt(".gg-now"), next: txt(".gg-next"), lead: txt(".gg-lead"),
        hp: (document.getElementById("hpBar") || {}).style ? document.getElementById("hpBar").style.width : null,
      };
    `);
    if (bad(r)) check("gungame: hud reads", false, why(r));
    else {
      check("gungame: ONE gun bar (the strip is docked, not floating)", r.docked === true && r.floating === false, JSON.stringify({ docked: r.docked, floating: r.floating }));
      check("gungame: the empty contraband cells are off", r.cells > 0 && r.hiddenCells === r.cells && r.bagHidden, JSON.stringify({ cells: r.cells, hidden: r.hiddenCells, bag: r.bagHidden }));
      // 2026-08-05 — the ladder row is GONE, not merely terse (the 08-04 pass
      // shortened it and the owner still read it as clutter above his gun).
      // The node must not exist at all, and the shared arena bars must survive
      // it: gungamehud.js writes #survBars from the same tick the row used to
      // live in, so "row removed" and "bars still written" is ONE assertion.
      check("gungame: no ladder row above the hotbar", r.panel === false && r.panelFlag === false, JSON.stringify({ panel: r.panel, flag: r.panelFlag, now: r.now, next: r.next, lead: r.lead }));
      check("gungame: HP/stamina still write with the row gone", !!r.hp && r.hp !== "", JSON.stringify({ hp: r.hp }));
    }
  }
}

// ---- summary -------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
const noise = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e) && !/computeBoundingSphere/.test(e));
console.log("");
console.log(`PRISON-POLISH: ${results.length - failed.length}/${results.length} ok` + (noise.length ? ` | ${noise.length} console errors` : ""));
if (noise.length) console.log("ERRORS: " + noise.slice(0, 8).join(" | "));
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join(" | ")); done(1); }
console.log("PRISON-POLISH: ok");
done(0);
