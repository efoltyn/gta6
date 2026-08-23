#!/usr/bin/env node
/* ============================================================
   tools/racer-story-check.mjs — THE RACER ORIGIN gate.

   Two faults, one boot.

   A. THE TWENTY GREY CARS (the leak)
      city/origins.js arms a deferred grid start for the racer origin and
      retries it every frame until the world can answer. Every attempt used
      to BUILD A LOANER CAR before discovering the answer was no, and then
      returned null with the car still standing on the grid — the seat handed
      back, the car abandoned. Six seconds of that welds one primer-grey car
      per frame onto the back row; the car-car collision pass spreads them
      across the racing surface, and the story opens on foot at the gate with
      twenty of them parked on the track.

      This does NOT try to reproduce it by racing a boot timer, because a
      machine fast enough to be ready on attempt one never sees it — which is
      exactly why it survived. It forces the failing condition directly:
      cityEnterVehicle is stubbed to refuse, cityRaceStart is called twenty
      times, and the world is asked how many loaners it is now holding.
        · RACE_START_V2 on  → 0 leaked, and CBZ.cityRaceReady() gates the
                              attempt so a retry costs nothing at all
        · RACE_START_V2 off → the fault comes BACK (a fix nobody can turn off
                              has not been measured)

   B. THE STORY (city/racing.js)
      The old five-stage career opened with "walk to the paddock" while you
      were already on the grid, and then spent three of its five beats on ONE
      record — records.races.apex — asked for as a podium, a win and a title,
      skipping every rung of the racing ladder in between. This asserts the
      arc that replaced it: five chapters with five different prices, each
      one the price of the ladder rung it buys, a named rival drawn from the
      live roster, and a waypoint on every chapter.

   Usage: node tools/racer-story-check.mjs [--port N] [--keep] [--wait S]
============================================================ */
import { spawn } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "tools/shots");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);
const PORT = Number(opt("--port", 9782));
const DBG = PORT + 1;
/* THE BUILD BUDGET IS THE WHOLE TOOL'S RUNTIME, and it is generous on
   purpose: building Gang City blocks the page's main thread, so every CDP
   call made during it legitimately does not answer. A budget too small
   reports a healthy engine as a hang — the one thing a checker must never
   do. See tools/boot-health.mjs's note on the same trap. */
const WAIT = Math.max(60, Number(opt("--wait", 600)) || 600);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stdout.write(s + "\n");
await mkdir(SHOTS, { recursive: true });

let fails = 0;
const check = (name, ok, detail) => {
  log((ok ? "PASS" : "FAIL") + ": " + name + (detail ? " — " + detail : ""));
  if (!ok) fails++;
};

/* ======================================================================
   LEG 0 — THE ARC, IN NODE, IN A SECOND.

   city/racing.js is one of the few city files that needs no THREE at load
   (its only THREE reach is inside a runtime branch), so the whole story
   layer can be run in a vm sandbox against a hand-written ledger: no
   browser, no world build, no swiftshader. That matters more than
   convenience: the fault this arc replaces was that three of its five beats
   read the SAME record (records.races.apex, written only by the APEX NIGHT
   package), and the only way to find that out was to play two chapters and
   notice the third asked for the finale. A shape fault like that has to be
   catchable in a second, on every commit, or it survives for months.

   It drives the ledger by hand through the exact five transitions a real
   career makes and asserts the chapters fall in order, once each.
   ====================================================================== */
async function nodeStoryLeg() {
  log("-- the arc (node sandbox, no browser) --");
  const src = await readFile(path.join(ROOT, "src/city/racing.js"), "utf8");
  const notes = [];
  const CBZ = {
    game: { mode: "city", cityOrigin: "racer", cityWorld: { records: { races: {} } } },
    CONFIG: {}, cityCars: [], cityPeds: [], updaters: [],
    onUpdate(o, fn) { CBZ.updaters.push({ o, fn }); },
    cityWorldEnsure() { return CBZ.game.cityWorld; },
    mission: {
      start(def) { return { def, alive: () => true, stageId: () => def.stages[0].id }; },
      byId: () => null,
    },
    city: { note: (t) => notes.push(t), big: (t) => notes.push(t), addRespect() {} },
  };
  const ctx = {
    window: { CBZ, THREE: null }, console,
    Math, Date, JSON, Set, Map, Object, Array, String, Number, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(src, ctx, { filename: "city/racing.js" }); }
  catch (e) { check("city/racing.js loads standalone", false, e.message); return; }
  check("city/racing.js loads standalone", true);

  const S = CBZ.cityRacerStory;
  if (!S) { check("CBZ.cityRacerStory is published", false); return; }
  check("CBZ.cityRacerStory is published", true);

  const CH = S.chapters();
  check("five chapters", CH.length === 5, CH.length + "");
  check("every chapter has a card and an objective line",
    CH.every((c) => c.card && c.text && c.text.length > 8));
  const rival = S.rivalName();
  check("the rival is a named roster driver", !!rival && rival !== "the champion", String(rival));
  check("the rival is named in the pink-slip chapter",
    CH.some((c) => c.id === "pinkslip" && c.text.indexOf(rival) >= 0));
  check("nothing is done on a fresh ledger", CH.every((c) => !c.done));
  check("the champion has no grudge yet", S.grudge() === false);

  /* THE WALK-THROUGH. Each row is one real thing a career does, written into
     the same durable record worldstate.js writes, and the expected mask is
     which chapters are closed after it. If a beat ever becomes unreachable
     again — a `done` that reads a record no Gang City race emits — its
     column stops flipping here and this fails on the commit that did it. */
  const rec = CBZ.game.cityWorld.records.races;
  const legs = [
    { what: "one Diamond start", set: () => (rec.legal = { starts: 1, wins: 0, podiums: 0 }), mask: "10000" },
    { what: "a podium", set: () => (rec.legal = { starts: 3, wins: 0, podiums: 1 }), mask: "11000" },
    { what: "a win + a second podium", set: () => (rec.legal = { starts: 6, wins: 1, podiums: 2 }), mask: "11100" },
    { what: "a pink-slip win", set: () => (rec.pinkslip = { starts: 1, wins: 1, podiums: 1 }), mask: "11110" },
    { what: "the APEX Night title", set: () => (rec.apex = { starts: 3, wins: 1, podiums: 2, titles: 1 }), mask: "11111" },
  ];
  for (const leg of legs) {
    leg.set();
    const got = S.chapters().map((c) => (c.done ? "1" : "0")).join("");
    check("after " + leg.what + " → " + leg.mask, got === leg.mask, "got " + got);
  }
  check("the story completes on the APEX title", CBZ.cityRacerCareer.complete() === true);
  const A = CBZ.racerCareerAudit();
  check("audit: 5 stages, 5 distinct prices, 2 ledger sources, 0 private state",
    A.stages === 5 && A.persistentSources === 2 && A.privateRaceState === 0 && A.distinctPrices === 5,
    JSON.stringify(A));
  log("");
}
await nodeStoryLeg();
if (has("--node-only")) {
  if (fails) bye0(1, `RACER STORY: FAIL — ${fails} check(s)`);
  bye0(0, "RACER STORY (arc only): ok");
}
function bye0(code, msg) { log(msg); process.exit(code); }

const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const CHROME = process.env.CBZ_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1024,640",
  `--remote-debugging-port=${DBG}`, `--user-data-dir=/tmp/cbz-racerstory-${DBG}-${Date.now()}`, "about:blank",
], { stdio: "ignore" });

const bye = (code, msg) => {
  if (msg) log(msg);
  if (!has("--keep")) { try { chrome.kill("SIGTERM"); } catch (_) {} }
  try { server.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
};

let wsUrl = null;
for (let i = 0; i < 80 && !wsUrl; i++) {
  await sleep(400);
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    const t = tabs.find((x) => x.webSocketDebuggerUrl);
    if (t) wsUrl = t.webSocketDebuggerUrl;
  } catch (_) {}
}
if (!wsUrl) bye(1, "FAIL: chromium never came up");

const sock = new WebSocket(wsUrl);
let msgId = 0; const pending = new Map(); let errors = [];
sock.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(String((d.exception && (d.exception.description || d.exception.value)) || d.text).split("\n")[0]);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push(m.params.args.map((a) => a.value || a.description || "").join(" ").split("\n")[0]);
  }
});
await new Promise((r) => sock.addEventListener("open", r));
const send = (method, params, ms = 45000) => new Promise((res) => {
  const id = ++msgId;
  pending.set(id, res);
  sock.send(JSON.stringify({ id, method, params: params || {} }));
  setTimeout(() => { if (pending.delete(id)) res({ __to: true }); }, ms);
});
const ev = async (expr, ms) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }, ms);
  if (r.__to) return "__TIMEOUT__";
  if (r.result && r.result.exceptionDetails) return "__THROW__ " + (r.result.exceptionDetails.text || "");
  return r.result && r.result.result && r.result.result.value;
};
// every probe is written as a body that returns a plain object; JSON keeps
// CDP's by-value serialisation honest about nested arrays.
const J = async (body, ms) => {
  const s = await ev("JSON.stringify((function(){try{" + body + "}catch(e){return {ERR:String(e&&e.stack||e)}}})())", ms);
  if (typeof s !== "string") return { ERR: String(s) };
  try { return JSON.parse(s); } catch (e) { return { ERR: "unparseable: " + s }; }
};
const shot = async (name) => {
  // the page is booted with drawing off — ask for exactly one frame first
  await ev("window.CBZ && CBZ.renderFrame ? CBZ.renderFrame() : false", 120000);
  const s = await send("Page.captureScreenshot", { format: "png" });
  if (s.result && s.result.data) {
    const p = path.join(SHOTS, name);
    await writeFile(p, Buffer.from(s.result.data, "base64"));
    log("shot: " + p);
  }
};
await send("Runtime.enable");
await send("Page.enable");

/* ---- boot the racer origin ---------------------------------------------- */
/* EVERY LEG BOOTS WITH DRAWING OFF. This gate asserts on world STATE — car
   counts, records, mission stages — and none of that needs a pixel. Gang
   City's CPU build is ~30 s and finishes fine; what used to make this tool
   un-runnable on a modest box is the FIRST FRAMES after it, where three.js
   compiles a program per material across a 25 km scene on a software
   rasterizer. ?cfg_RENDER_FRAMES=0 (core/loop.js) removes that entirely, and
   the one screenshot at the end asks for a single frame explicitly through
   CBZ.renderFrame(). Use tools/boot-trace.mjs if a boot ever hangs again: it
   beacons every checkpoint from inside the frozen thread and tells you
   whether you are looking at the build or at the renderer. */
/* WILDLIFE OFF TOO — as a controlled variable, not a rescue. An early
   beacon-based trace blamed the wildlife tick for the slow loop; the in-page
   profiler (tools/boot-trace.mjs --prof) later measured it at ~1.4 ms for the
   whole 985-animal menagerie — the real per-frame thief was cctv.js's hidden
   render-to-texture, which now honours RENDER_FRAMES=0. Animals stay off here
   anyway: nothing in the racer origin involves one, ~1000 fewer actors is
   ~1000 fewer ways for an unrelated regression to shake this gate, and the
   racing being measured is identical either way. */
const HEADLESS_PARAMS = "cfg_RENDER_FRAMES=0&cfg_WILDLIFE=0";
async function boot(query) {
  errors = [];
  const q = query ? query.replace(/^\?/, "") + "&" + HEADLESS_PARAMS : HEADLESS_PARAMS;
  /* EVERY LEG IS A NEW PLAYER, and forgetting this reads as a game bug.
     city/origins.js keeps a per-character ledger in localStorage and does NOT
     replay a story's opening for someone who has already lived it — so the
     second boot in one browser profile (and the first, if an earlier run of
     this tool left a ledger behind) resumes the racer instead of putting him
     on the grid, and the opening checks below fail for a reason that is
     entirely the harness's. Same trap tools/boot-origin-check.mjs documents.
     Cleared from a same-origin page with no engine on it, so nothing is
     mid-write when the key disappears. */
  const url = `http://127.0.0.1:${PORT}/index.html?${q}`;
  await send("Page.navigate", { url: url });
  // WAIT FOR THE REAL PAGE BEFORE CLEARING. An earlier version navigated to a
  // 404 and cleared 250 ms later — but the navigation had not committed, so
  // the clear ran against about:blank, whose storage is an OPAQUE origin: it
  // succeeds, clears nothing, and the next load resumes the ledger a previous
  // run of this tool left behind. The gate then reported "the story does not
  // open on the grid" for a character the engine was correctly RESUMING.
  // Load the page, clear from inside it, load it again.
  for (let i = 0; i < 200; i++) {
    if (await ev("!!(window.CBZ && CBZ.bootComplete)") === true) break;
    await sleep(400);
  }
  log("  storage before clear: " + await ev("(function(){try{return location.origin+' keys='+localStorage.length}catch(e){return 'ERR '+e}})()", 10000));
  await ev("try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} true", 10000);
  log("  storage after clear:  " + await ev("(function(){try{return 'keys='+localStorage.length}catch(e){return 'ERR '+e}})()", 10000));
  await send("Page.navigate", { url: url });
  // CBZ.bootComplete is main.js's LAST line, so it means "the script chain
  // parsed" — the title screen is live and setCityOrigin exists. It does NOT
  // mean the world is built; that only starts when PLAY is pressed.
  let title = false;
  for (let i = 0; i < 200 && !title; i++) {
    title = await ev("!!(window.CBZ && CBZ.bootComplete && CBZ.setCityOrigin && document.getElementById('playBtn'))") === true;
    if (!title) await sleep(400);
  }
  if (!title) return "title never came up";
  log("  ledger at title: " + await ev("(function(){try{var w=CBZ.cityWorldEnsure?CBZ.cityWorldEnsure():null;return 'keys='+localStorage.length+' played='+(w&&w.originPlayed)+' origin='+(w&&w.origin)}catch(e){return 'ERR '+e}})()", 20000));
  await ev(`(function(){
    CBZ.setCityOrigin("racer");
    var b = document.querySelector('.origin-btn[data-origin="racer"]'); if (b) b.click();
    return true;
  })()`);
  await ev(`(function(){ var b = document.getElementById("playBtn"); if (b) b.click(); return true; })()`);
  const deadline = Date.now() + WAIT * 1000;
  while (Date.now() < deadline) {
    const st = await ev("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing' && CBZ.city && CBZ.city.arena)", 30000);
    if (st === true) return null;
    await sleep(1500);
  }
  return `world build did not finish inside ${WAIT}s (this is what a contended box looks like too — check \`uptime\` and the chrome process count before blaming a commit)`;
}

const why = await boot("");
if (why) { await shot("racer-story-noboot.png"); bye(2, "FAIL: " + why); }
log("world built, racer origin applied");
await sleep(2500);

/* ---- A1. the opening actually happened ---------------------------------- */
const open = await J(`
  var R = CBZ.speedwayRaceState ? CBZ.speedwayRaceState() : null;
  var loaners = (CBZ.cityCars||[]).filter(function(c){ return c._loaner || c._loanerClaimed; });
  return {
    origin: CBZ.game.cityOrigin,
    ready: !!(CBZ.cityRaceReady && CBZ.cityRaceReady()),
    driving: !!(CBZ.player && CBZ.player.driving),
    loaners: loaners.length,
    active: !!(R && R.active),
    field: R ? (R.drivers.length || R.racers.length) : 0,
  };`);
log("opening: " + JSON.stringify(open));
check("the racer origin is the live character", open.origin === "racer", String(open.origin));
check("CBZ.cityRaceReady() is published and true in a built world", open.ready === true);
check("the story opens IN the car, not on the grass", open.driving === true);
check("exactly one loaner exists after the opening", open.loaners === 1, open.loaners + " loaner(s)");
check("the opening race is live with a field", open.active === true && open.field >= 3,
  "active=" + open.active + " field=" + open.field);

/* ---- A1b. WHEN THE OPENING DID NOT HAPPEN, SAY WHY --------------------
   The leak was only ever the SYMPTOM. Twenty grey cars appear because the
   deferred grid start is failing and being retried, so a gate that proves
   the litter is gone and stops there has proved the quiet half of the bug.
   This runs the same call the origin makes, in the open, and reports which
   gate refused it. */
if (!open.active) {
  const why = await J(`
    /* READ THE BOOT REFUSAL FIRST. cityRaceStart clears it on success, and
       this probe calls cityRaceStart — so asking afterwards reports the
       health of the probe's own call and throws away the reason the ORIGIN
       failed, which is the only thing worth knowing here. */
    var out = { atBoot: CBZ.cityRaceRefusal ? CBZ.cityRaceRefusal() : "(engine does not say)" };
    out.deferral = CBZ.cityOriginRaceDebug ? CBZ.cityOriginRaceDebug() : "(no debug)";
    out.originWhy = CBZ.cityOriginWhy ? CBZ.cityOriginWhy() : "(no log)";
    out.cash = CBZ.game.cash;                    // the racer origin grants $350
    out.introActive = CBZ.cityOriginIntroActive ? CBZ.cityOriginIntroActive() : null;
    out.ready = !!(CBZ.cityRaceReady && CBZ.cityRaceReady());
    out.arena   = !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root);
    out.makeCar = !!CBZ.cityMakeCar;
    out.enter   = !!CBZ.cityEnterVehicle;
    out.cars    = ((CBZ.cityEcon && CBZ.cityEcon.CARS) || []).length;
    out.drivers = !!(CBZ.raceDrivers && CBZ.raceDrivers.enabled && CBZ.raceDrivers.enabled());
    out.kit     = !!CBZ.raceKit;
    out.len     = CBZ.speedwayTrackLen ? Math.round(CBZ.speedwayTrackLen()) : -1;
    out.standings = (CBZ.cityRacing && CBZ.cityRacing.standings) ? CBZ.cityRacing.standings().length : -1;
    out.course  = !!(CBZ.raceKit && CBZ.raceKit.course && CBZ.raceKit.course("speedway"));
    out.pinkSlipHolding = !!(CBZ.raceLadder && CBZ.raceLadder.pinkSlip && CBZ.raceLadder.pinkSlip().active);
    // now actually try it, for real, and watch every field the dispatcher reads
    var n0 = CBZ.cityCars.length;
    var car = CBZ.cityRaceStart({ style: "muscle", number: 99 });
    var R = CBZ.speedwayRaceState();
    out.tryGot   = !!car;
    out.tryAdded = CBZ.cityCars.length - n0;
    out.driving  = !!(CBZ.player && CBZ.player.driving);
    out.refusal  = CBZ.cityRaceRefusal ? CBZ.cityRaceRefusal() : "(engine does not say)";
    out.race     = { active: R.active, rd: R.rd, phase: R.phase, drivers: R.drivers.length, legacy: R.racers.length, broken: !!R._rdBroken };
    /* AND THE ONE CALL WITH A SWALLOWING CATCH AROUND IT. island_speedway's
       loanerCar() wraps cityMakeCar in a try/catch that returns null — so if
       the car cannot be built, every caller upstream sees a polite
       null and the reason is thrown away. Reproduce the call here with the
       error kept, and scrap anything it manages to build so the probe cannot
       become the litter it is investigating. */
    var CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
    var base = null;
    for (var i = 0; i < CARS.length; i++) { if (CARS[i].detailStyle === "muscle") { base = CARS[i]; break; } }
    if (!base) base = CARS[0];
    out.base = base ? base.name : null;
    if (base) {
      var m = Object.assign({}, base, { color: 0x9aa4b2, value: 3500 });
      try {
        var probe = CBZ.cityMakeCar(0, 0, 0, false, m, 0.3);
        out.makeCarOk = !!probe;
        /* AND THE SEAT. cityRaceStart's own refusal says driving=false at the
           moment startRace() looks, which can only mean the enter call did not
           take — so exercise that call on its own and watch the flag. */
        if (probe) {
          probe.owned = true;
          out.drivingBefore = !!CBZ.player.driving;
          out.enterReturned = !!CBZ.cityEnterVehicle(probe);
          out.drivingAfter = !!CBZ.player.driving;
          out.vehicleIsProbe = CBZ.player._vehicle === probe;
          if (CBZ.player.driving && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
        }
        if (probe && CBZ.cityScrapCar) CBZ.cityScrapCar(probe);
      } catch (e) { out.makeCarOk = false; out.makeCarErr = String(e && (e.stack || e.message || e)).replace(/\s+/g, " ").slice(0, 300); }
    }
    return out;`);
  log("  why-not: " + JSON.stringify(why));
  check("cityRaceStart works on a finished world", why && why.tryGot === true,
    "the origin's own call still refuses — see why-not above");
}

/* ---- A2. THE LEAK, forced ------------------------------------------------
   Refuse the seat and ask for twenty starts. Every one of them builds a car
   and then cannot use it; the question is whether the car goes back. */
const leakProbe = `
  var P = CBZ.player;
  var st = CBZ.speedwayRaceState ? CBZ.speedwayRaceState() : null;
  // park whatever race is live so cityRaceStart is not short-circuited by
  // its own idempotence guard, and get out of the car for the same reason
  if (st && st.active && CBZ.cityRaceAbort) CBZ.cityRaceAbort("probe");
  if (P && P.driving && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
  var realEnter = CBZ.cityEnterVehicle;
  CBZ.cityEnterVehicle = function () { return false; };      // the refusal
  var before = (CBZ.cityCars||[]).length;
  var tries = 0;
  for (var i = 0; i < 20; i++) { if (CBZ.cityRaceStart({ style: "muscle", number: 99 })) tries++; }
  CBZ.cityEnterVehicle = realEnter;
  var after = (CBZ.cityCars||[]).length;
  var grey = (CBZ.cityCars||[]).filter(function(c){ return c._loaner && !c._loanerClaimed; }).length;
  return { before: before, after: after, added: after - before, grey: grey, started: tries };`;
const leak = await J(leakProbe);
log("forced-failure leak: " + JSON.stringify(leak));
check("20 refused starts leak 0 cars", leak.added === 0, "+" + leak.added + " cars in CBZ.cityCars");
check("no orphan primer-grey loaner is left standing", leak.grey === 0, leak.grey + " on the venue");
check("a refused start never reports success", leak.started === 0, leak.started + " claimed to start");

/* ---- B. the story -------------------------------------------------------- */
const story = await J(`
  var S = CBZ.cityRacerStory, A = CBZ.racerCareerAudit ? CBZ.racerCareerAudit() : null;
  var m = CBZ.mission && CBZ.mission.byId ? CBZ.mission.byId("origin_racer_career") : null;
  return {
    has: !!S,
    audit: A,
    chapters: S ? S.chapters() : null,
    rival: S ? S.rivalName() : null,
    grudge: S ? !!S.grudge() : null,
    live: !!(m && m.alive && m.alive()),
    stage: m && m.stageId ? m.stageId() : null,
  };`);
log("story: " + JSON.stringify(story));
check("CBZ.cityRacerStory is published", story.has === true);
check("five chapters", story.chapters && story.chapters.length === 5,
  story.chapters ? story.chapters.length + " chapters" : "none");
check("every chapter has an objective line", !!story.chapters &&
  story.chapters.every((c) => c.text && c.text.length > 8));
check("the rival is a real roster driver, named", !!story.rival && story.rival !== "the champion", String(story.rival));
check("the rival's name is in the pink-slip chapter's text",
  !!story.chapters && !!story.rival && story.chapters.some((c) => c.id === "pinkslip" && c.text.indexOf(story.rival) >= 0));
check("five beats, five different prices (not one record asked three times)",
  !!story.audit && story.audit.distinctPrices === 5,
  story.audit ? String(story.audit.distinctPrices) : "no audit");
check("the champion has no grudge before you have earned one", story.grudge === false);
check("the career card is live on chapter one",
  story.live === true && story.stage === "loaner", "stage=" + story.stage);

const boardErrors = errors.filter((e) => !/ProgressEvent|favicon|preload/i.test(e));
check("no console errors during the opening", boardErrors.length === 0, boardErrors.slice(0, 2).join(" | "));

await shot("racer-story-opening.png");

/* ---- C. the revert: with the flag down, the fault comes back ------------- */
if (!has("--no-revert")) {
  log("\n-- ?cfg_RACE_START_V2=0 (the fault must come BACK) --");
  const why2 = await boot("?cfg_RACE_START_V2=0");
  if (why2) {
    check("revert leg booted", false, why2);
  } else {
    await sleep(2500);
    const leak2 = await J(leakProbe);
    log("reverted leak: " + JSON.stringify(leak2));
    check("with RACE_START_V2 off the leak is measurable again", leak2.added > 0,
      "+" + leak2.added + " cars — if this is 0 the fix is not what is holding");
  }
}

log("");
if (fails) bye(1, `RACER STORY: FAIL — ${fails} check(s)`);
bye(0, "RACER STORY: ok — one loaner, five chapters, a named rival, and 20 refused starts leak nothing");
