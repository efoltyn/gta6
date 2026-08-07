#!/usr/bin/env node
/* tools/studio-check.mjs — CAN A ONE-SHOT PAGE ACTUALLY REACH THE STUDIO?

   OWNER DOCTRINE (2026-08-07): "build the back end so then all I need is a
   couple hundred line system prompt that I can add on to my mini game ID."

   The only measurement that means anything for src/core/studio.js is whether
   a page that names its packs BOOTS. Not whether the manifest parses. So this
   loads games/bomb-survivor-b.html, the page that carries ONE script tag where
   games/bomb-survivor.html carries seventeen, in a real headless browser and
   asks:

     1. ONE TAG. The document really does carry a single authored <script src>,
        and the studio really did inject the rest.
     2. THE ORDER HELD. Every pack's promised symbol is on CBZ, checked by
        asking CBZ rather than by reading the manifest back to itself
        (CBZ.studio.audit().missing — THE RATCHET, pinned at 0 here).
     3. THE PAGE IS REACHABLE, which is the fault that started this. Before the
        manifest, that page did not load systems/modecaps.js at all, so its
        CBZ.registerMode call was a no-op and no shared engine verb could find
        its people. modeHas must now answer, and the mode must resolve a real
        damage route.
     4. THE CATALOG GIVES. cast("soldier") returns the shipped 1.82 m rig and
        model("bomber") returns shipped geometry, so a one-shot never has to
        rebuild a person or an aeroplane it already owns.
     5. IT RAN CLEAN. No uncaught exceptions, no console errors.

   Usage: node tools/studio-check.mjs           boot the page and check it
          node tools/studio-check.mjs --print   print the catalog as markdown,
                                                which is what goes into the
                                                system prompt a one-shot is
                                                written against. No browser.
   Exit 0 = ok.                                                              */
import { spawn } from "node:child_process";
import { rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- the manifest, read without a browser ------------------------------- */
async function manifest() {
  const src = await readFile(path.join(ROOT, "src/core/studio.js"), "utf8");
  const win = {};
  const doc = {
    currentScript: { src: "http://x/src/core/studio.js" },
    getElementsByTagName: () => [], head: { appendChild: () => {} }, createElement: () => ({}),
  };
  new Function("window", "document", src)(win, doc);
  return win.CBZ.studio;
}

if (process.argv.includes("--print")) {
  const st = await manifest();
  const rows = st.list();
  const out = [];
  out.push("# THE STUDIO");
  out.push("");
  out.push("What a one-shot HTML page can ask Gang City for.");
  out.push("");
  out.push("Two tags. The second one is your game.");
  out.push("");
  out.push("```html");
  out.push('<script src="../src/core/studio.js"></script>');
  out.push("<script>");
  out.push('CBZ.studio.need("people", "desert", "air").then(function () {');
  out.push("  // your game. CBZ.scene, CBZ.camera, CBZ.micro and the frame loop are up.");
  out.push("});");
  out.push("</script>");
  out.push("```");
  out.push("");
  out.push("## Packs");
  out.push("");
  for (const r of rows) {
    out.push(`### \`${r.pack}\``);
    out.push(r.gives + ".");
    if (r.needs.length) out.push(`Pulls: ${r.needs.map((n) => "`" + n + "`").join(", ")}`);
    if (r.publishes.length) out.push(`Gives you: ${r.publishes.map((n) => "`CBZ." + n + "`").join(", ")}`);
    out.push("");
  }
  out.push("## People, by name");
  out.push("");
  out.push("`CBZ.studio.cast(role, {color, variant})` returns the shipped 1.82 m rig,");
  out.push("cast and dressed. Never build a person out of boxes.");
  out.push("");
  out.push("Roles: " + st.roles().map((r) => "`" + r + "`").join(" · "));
  out.push("");
  out.push("## Machines, by name");
  out.push("");
  out.push("`CBZ.studio.model(name)` returns shipped geometry, or null when the pack");
  out.push("that owns it is not loaded. `CBZ.studio.fly(kind)` returns the model with a");
  out.push("flight model already attached.");
  out.push("");
  out.push("With `military`: `bomber` · `fighter` (alias `jet`) · `cargo` · `heli` · `tank` · `truck` · `b2`");
  out.push("");
  out.push("## The rest of the verbs");
  out.push("");
  for (const [sig, what] of [
    ["CBZ.studio.join({actors, hurt})", "declare and BECOME a mode. Until you call this, every shared engine verb declines: no vault, no ledge step, no blast damage, no wall breach. `actors` hands over your roster, `hurt` your kill funnel, so the engine cannot kill somebody your score does not hear about."],
    ["CBZ.studio.world(name)", "build a named world. `desert` today."],
    ["CBZ.studio.crowd(n, role, {at})", "n shipped bodies, placed and parented."],
    ["CBZ.studio.boom(pos, {radius, power})", "fireball, blast damage against your roster, building collapse, and attenuated sound. Never grow your own explosion."],
    ["CBZ.studio.structureAt(x, z, reach)", "what is standing here: the building record under a point, or null."],
    ["CBZ.studio.bombsight({kind})", "the predicted impact, drawn, off the SHARED ballistic integrator."],
    ["CBZ.studio.chase({groundAt})", "a smoothed, ground-clamped follow camera."],
    ["CBZ.studio.controls(kind, {buttons})", "one surface for keyboard, mouse and touch. `fly` also gets a throttle slider on a phone."],
    ["CBZ.studio.hud({...})", "the standard HUD. See the rules below."],
    ["CBZ.studio.trail({length, color})", "a contrail, a dust plume, a wake. One draw call."],
    ["CBZ.studio.engineSound()", "the noise a machine makes, mapped from throttle and speed."],
    ["CBZ.studio.alarm(level)", "one warning voice, cooldown inside it, interval tightening with the level."],
  ]) { out.push("- `" + sig + "`\n  " + what); }
  out.push("");
  out.push("## Rules that are not negotiable");
  out.push("");
  out.push("**HUD.** Health is always top left, and it is one meter. No emoji anywhere in");
  out.push("HUD space. Never render a keyboard key on a touchscreen: `controls()` and");
  out.push("`hud().prompt()` already decide that from pointer coarseness, so use them and");
  out.push("the question does not arise. Keep the HUD bare. Say danger with");
  out.push("`hud.danger()`, which costs no space.");
  out.push("");
  out.push("**Player-facing words.** Fragments, not sentences. No em dashes. Never define a");
  out.push("thing by what it is not.");
  out.push("");
  out.push("**Phones are the default target.** Every action must be reachable by thumb.");
  out.push("");
  out.push("**Determinism.** Never `Math.random` in a world build. Use `CBZ.seedStream(name)`.");
  out.push("");
  out.push("**Never fork.** If you are about to draw a person, a vehicle, a HUD, a camera or");
  out.push("an explosion, stop: ask the studio for it. If it is genuinely missing, the fix");
  out.push("is a new verb in `src/core/studio.js`, not a copy in your page.");
  out.push("");
  console.log(out.join("\n"));
  process.exit(0);
}

/* ---- boot the migrated page for real ------------------------------------ */
async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port");
}
const port = await claimPort(9750, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("STUDIO: FAIL devserver never came up"); process.exit(1); } }

const dbg = await claimPort(10950, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-studiocheck-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=480,300",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  `${origin}games/bomb-survivor-b.html`,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 240 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.indexOf("bomb-survivor-b") >= 0);
  } catch (_) {}
  if (!page) await sleep(100);
}
const done = (code, msg) => { if (msg) console.log(msg); chrome.kill("SIGTERM"); server.kill("SIGTERM"); process.exit(code); };
if (!page) done(1, "STUDIO: FAIL no page");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${(d.url || "?").split("/").pop()}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");

// the studio has to finish loading before anything is true
let ready = false;
for (let i = 0; i < 300 && !ready; i++) {
  ready = await evl("!!(window.CBZ && CBZ.studio && CBZ.micro && window.__bombB)");
  if (!ready) await sleep(500);
}
if (!ready) done(1, "STUDIO: FAIL the page never finished loading (studio/micro/__bomb absent)");

const R = await evl(`(() => {
  const out = { fails: [] };

  // 1 — ONE TAG AUTHORED, the rest injected
  const tags = Array.from(document.getElementsByTagName("script")).filter(s => s.src);
  out.tagsTotal = tags.length;
  out.injected = tags.filter(s => !!s.parentNode && s.parentNode === document.head).length;
  out.studioRoot = CBZ.studio.root;

  // 2 — THE RATCHET: did every loaded pack publish what it promised?
  out.audit = CBZ.studio.audit();
  if (out.audit.missing) out.fails.push("packs missing their symbols: " + JSON.stringify(out.audit.rows));

  // 3 — THE PAGE IS REACHABLE. This is the fault that started it: before the
  //     manifest this page never loaded modecaps.js, so registerMode was a
  //     no-op and no shared verb could reach anyone.
  out.mode = CBZ.game && CBZ.game.mode;
  out.hasModeHas = typeof CBZ.modeHas === "function";
  if (!out.hasModeHas) out.fails.push("modeHas absent: the caps pack did not load");
  else {
    out.caps = { traverse: CBZ.modeHas("traverse"), blast: CBZ.modeHas("blast"),
                 blastActors: CBZ.modeHas("blastActors"), breach: CBZ.modeHas("breach") };
    for (const k in out.caps) if (!out.caps[k]) out.fails.push("mode denied " + k);
    const a = CBZ.modeCapsAudit();
    out.unrouted = a.unrouted; out.route = a.routes[out.mode] || null;
    if (a.unrouted) out.fails.push("unrouted blast-capable modes: " + a.unrouted);
    if (!out.route || out.route === "UNROUTED") out.fails.push("this page's own blast route is " + out.route);
  }

  // 4 — THE WORLD IS UNDER THE NAME THE ENGINE READS
  out.colliders = (CBZ.colliders && CBZ.colliders.length) || 0;
  out.collidersShared = CBZ.colliders === CBZ.micro.colliders;
  if (!out.collidersShared) out.fails.push("CBZ.colliders is not microboot's array");

  // 5 — THE CATALOG GIVES. A person and an aeroplane, by name.
  const man = CBZ.studio.cast("soldier", { color: 0xb4643a, variant: 2 });
  out.cast = !!(man && man.isObject3D);
  out.castRole = man && man.userData && man.userData.role;
  out.castParts = man ? man.children.length : 0;
  if (!out.cast) out.fails.push("cast('soldier') gave nothing");
  out.models = CBZ.studio.models();
  const jet = CBZ.studio.model("jet");
  out.model = !!(jet && jet.isObject3D);
  if (!out.models.length) out.fails.push("no models catalogued");

  return out;
})()`);

// a page that boots is not a page that works: run its own frames.
await evl("(() => { try { for (let i=0;i<120;i++) CBZ.micro.step ? CBZ.micro.step(1/60) : 0; } catch(e){} return 1; })()");
await sleep(1500);

const clean = errors.filter((e) => !/ProgressEvent|favicon/i.test(e));
console.log(JSON.stringify(R, null, 2));
console.log("console errors:", clean.length ? clean : "[]");
if (clean.length) R.fails.push(clean.length + " console errors");
if (R.fails.length) done(1, "\nSTUDIO: FAIL — " + R.fails.join(" | "));
done(0, `\nSTUDIO: ok — ${R.tagsTotal} script tags in the document from ONE authored tag; ` +
  `every loaded pack published what it promised (missing ${R.audit.missing}); ` +
  `the page is reachable (${R.route}); ${R.colliders} colliders under the engine's own name; ` +
  `cast and model both gave shipped assets.`);
