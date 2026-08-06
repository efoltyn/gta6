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

// ---- 0b. THE INTERACTION CARD: NO YELLOW LINE, NO BEFRIEND, BARKS SPEAK ----
// 2026-08-06. OWNER, on a phone screenshot of a guard's card: "Remove this
// little yellow text ... remove befriend that's not a thing remove that
// completely from the game ... there's messages that pop up like THEYRE ONTO
// YOU, that's where dialogue should pop up. REMOVE POPUPSLOP HUDWASTE."
// Three claims about live state, none about pixels. Runs BEFORE the armory
// section for the same reason section 0 does — that section makes real heat.
{
  // Stand on top of a guard so systems/interact.js raises the card on him.
  const r = await evl(`
    var g = CBZ.guards.filter(function(x){ return x.data && !x.dead && !(x.ko > 0); })[0];
    if (!g) return { noGuard: true };
    CBZ.player.pos.x = g.group.position.x + 1.2;
    CBZ.player.pos.z = g.group.position.z;
    for (var i=0;i<30;i++) CBZ.stepSim(1/60);
    var note = document.getElementById("interactNote");
    var card = document.getElementById("interact");
    var verbs = g._verbs || [];
    return {
      up: !!(card && card.classList.contains("show")),
      noteText: note ? note.textContent : null,
      noteShown: !!(note && getComputedStyle(note).display !== "none"),
      piwNotes: document.querySelectorAll(".piw-note").length,
      verbs: verbs,
      cardText: (card ? card.innerText : "") + " " + ((document.getElementById("pinteract") || {}).innerText || ""),
    };
  `);
  if (bad(r) || r.noGuard) check("card: a guard raises the card", false, why(r));
  else {
    check("card: it is up on the guard", r.up === true, JSON.stringify({ up: r.up, verbs: r.verbs }));
    // THE YELLOW LINE. #interactNote is SHARED with the city card, so the
    // prison must leave it both empty AND hidden; .piw-note (touch) is deleted
    // outright, so the element must not exist at all.
    check("card: no yellow read line on the desktop card",
      r.noteText === "" && r.noteShown === false,
      JSON.stringify({ text: r.noteText, shown: r.noteShown }));
    check("card: the touch rail has no note element at all", r.piwNotes === 0, "nodes=" + r.piwNotes);
    // BEFRIEND. Not renamed on the button — gone from the verb table, so no
    // context anywhere can produce the id, and `talk` is what took its slot.
    check("card: no befriend verb on a guard",
      Array.isArray(r.verbs) && r.verbs.indexOf("befriend") < 0 && r.verbs.indexOf("talk") >= 0,
      JSON.stringify(r.verbs));
    check("card: the word 'Befriend' is nowhere in the card",
      !/befriend/i.test(r.cardText || ""), JSON.stringify((r.cardText || "").slice(0, 120)));
  }
}
{
  // Every inmate context too — the base verb list, not just the guard branch.
  const r = await evl(`
    var n = CBZ.npcs.filter(function(x){ return x.data && !x.dead && !(x.ko > 0); })[0];
    if (!n) return { noNpc: true };
    CBZ.player.pos.x = n.group.position.x + 1.2;
    CBZ.player.pos.z = n.group.position.z;
    for (var i=0;i<30;i++) CBZ.stepSim(1/60);
    return { verbs: n._verbs || [], winReasons: typeof CBZ.winGame === "function" };
  `);
  if (bad(r) || r.noNpc) check("card: an inmate raises the card", false, why(r));
  else check("card: no befriend verb on an inmate",
    Array.isArray(r.verbs) && r.verbs.indexOf("befriend") < 0 && r.verbs.indexOf("talk") >= 0,
    JSON.stringify(r.verbs));
}
{
  // A BARK IS DIALOGUE. Put a guard on the hunt beside the player and count
  // both surfaces: the hint panel must stay at zero and the subtitle must
  // carry the line with the speaker's name on it.
  const r = await evl(`
    var hints = 0, real = CBZ.flashHint;
    CBZ.flashHint = function(){ hints++; return real && real.apply(null, arguments); };
    var g = CBZ.guards.filter(function(x){ return x.data && !x.dead && !(x.ko > 0) && !(x.bribed > 0); })[0];
    if (!g) { CBZ.flashHint = real; return { noGuard: true }; }
    CBZ.player.pos.x = g.group.position.x + 3.0;
    CBZ.player.pos.z = g.group.position.z;
    var said0 = CBZ.prisonSayAudit().said;
    g.state = "patrol"; g.hunt = 3;
    for (var i=0;i<45;i++) CBZ.stepSim(1/60);
    var sub = document.getElementById("pinteractSay");
    var out = {
      hints: hints,
      spokeMore: CBZ.prisonSayAudit().said > said0,
      shown: !!(sub && sub.classList.contains("show")),
      line: sub ? (sub.querySelector(".pi-subtitle-line") || {}).textContent : null,
      who: sub ? (sub.querySelector(".pi-subtitle-speaker") || {}).textContent : null,
    };
    CBZ.flashHint = real;
    return out;
  `);
  if (bad(r) || r.noGuard) check("bark: a guard can hunt", false, why(r));
  else {
    check("bark: nothing went to the hint popup", r.hints === 0, "flashHint calls=" + r.hints);
    check("bark: the guard SPOKE instead", r.spokeMore === true && r.shown === true,
      JSON.stringify({ line: r.line, who: r.who }));
    check("bark: the speaker is named", !!r.who, JSON.stringify(r.who));
  }
}

// ---- 0c. THE RELATIONSHIP PICKS THE LINE, NOT THE VERB (PRISON_REACT) ------
// 2026-08-06. OWNER: "what they say isn't just automatic based off what you
// do. It's based off the statistics of what it was before and what it is now
// after what you did, whether it was an interaction or running into them
// physically or pulling a gun out."
//
// TRUST THE RETURN VALUE, NEVER THE DOM. Two earlier versions of this probe
// read the subtitle element instead, so a REFUSED reaction handed back the
// previous line still on screen and every assertion passed on stale text.
// prisonReact returns true only when the actor actually spoke; the reported
// line is only read when it did.
{
  const r = await evl(`
    var P = CBZ.player;
    function line(){ var e=document.getElementById("pinteractSay"); return e?(e.querySelector(".pi-subtitle-line")||{}).textContent:null; }
    function fresh(l){ return l.filter(function(x){ return x&&x.data&&x.group&&!x.dead&&!x.escaped&&!(x.ko>0); }); }
    function fire(who, mutate, opts){
      if (!who) return { noActor: true };
      who._reactN = 0;
      P.pos.x = who.group.position.x + 1.0; P.pos.z = who.group.position.z;
      var before = CBZ.prisonReactSnap(who);
      mutate(who);
      var ok = CBZ.prisonReact(who, before, opts || {});
      return { spoke: !!ok, line: ok ? line() : null };
    }
    var npcs = fresh(CBZ.npcs), guards = fresh(CBZ.guards);
    var A = npcs[0], B = npcs[1], G = guards[0];
    if (!A || !B || !G) return { cast: { npcs: npcs.length, guards: guards.length } };
    function zero(w){ w.playerGrudge=0; w.playerFear=0; w.playerTrust=0; w.love=0; w.rep=0; w.bribed=0; }
    zero(A); zero(B); zero(G);
    var o = {};
    o.nothing   = fire(A, function(w){}, {});                                  // no delta -> silent
    o.grudgeLo  = fire(A, function(w){ w.playerGrudge = 3; }, {});
    o.grudgeHi  = fire(A, function(w){ w.playerGrudge = 12; }, {});
    zero(B);
    o.gunInmate = fire(B, function(w){ w.playerFear = 9; }, { cause: "gun" });
    zero(B);
    o.bumpInmate= fire(B, function(w){ w.playerGrudge = 2; }, { cause: "bump" });
    o.gunGuard  = fire(G, function(w){ w.playerFear = 9; }, { cause: "gun" });
    zero(A);
    o.trustHi   = fire(A, function(w){ w.playerTrust = 11; }, {});
    o.audit = CBZ.prisonReactAudit();
    return o;
  `);
  if (bad(r) || r.cast) check("react: a cast to react to", false, why(r));
  else {
    // 1. NOTHING MOVED -> NOTHING SAID. The rule that keeps the band quiet.
    check("react: no stat moved, nobody speaks", r.nothing.spoke === false, JSON.stringify(r.nothing));
    // 2. SAME AXIS, SAME DIRECTION, DIFFERENT BAND -> DIFFERENT LINE. This is
    //    the owner's sentence: the RESULT decides, not the act.
    check("react: grudge low vs grudge high are different lines",
      r.grudgeLo.spoke && r.grudgeHi.spoke && r.grudgeLo.line !== r.grudgeHi.line,
      JSON.stringify({ lo: r.grudgeLo.line, hi: r.grudgeHi.line }));
    // 3. SAME EVENT, DIFFERENT SPEAKER -> DIFFERENT REGISTER.
    check("react: a guard and an inmate answer a gun differently",
      r.gunInmate.spoke && r.gunGuard.spoke && r.gunInmate.line !== r.gunGuard.line,
      JSON.stringify({ inmate: r.gunInmate.line, guard: r.gunGuard.line }));
    // 4. THE PHYSICAL CAUSES SPEAK AT ALL — a gun and a shoulder, no menu.
    check("react: pulling a gun and walking into someone both speak",
      r.gunInmate.spoke && r.bumpInmate.spoke && r.gunInmate.line !== r.bumpInmate.line,
      JSON.stringify({ gun: r.gunInmate.line, bump: r.bumpInmate.line }));
    // 5. A LINE IS A LINE, NOT A STAT READOUT. No numbers, no percentages, no
    //    "rep 40" — the failure mode this whole wave exists to kill.
    const said = [r.grudgeLo.line, r.grudgeHi.line, r.gunInmate.line, r.gunGuard.line, r.bumpInmate.line, r.trustHi.line];
    const numeric = said.filter((s) => s && /\d|\(rep|%|\bcigs?\b/i.test(s));
    check("react: no line is a stat readout", numeric.length === 0, JSON.stringify(numeric));
    check("react: every pool reached was a distinct situation",
      Object.keys(r.audit.byAxis).length >= 5, JSON.stringify(r.audit.byAxis));
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
    CBZ.openDoor(); CBZ.door.t = 1; CBZ.door.mesh.position.y = CBZ.door.closedY + 7;
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
