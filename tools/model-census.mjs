#!/usr/bin/env node
/* tools/model-census.mjs — WHICH MODEL WROTE THE LINES YOU PLAY TODAY.

   The owner's read: what Claude Opus 5.5 built (2026-09-27 on) is far better
   than the older work, and he is having the rest remade. This tool shows the
   split, system by system, so the remake list is measured, not guessed.

   HOW. Every tracked src/**\/*.js (minus src/vendor, which is third-party),
   games/*.html and index.html is run through `git blame --porcelain HEAD`
   (same data as --line-porcelain, without repeating each commit header on
   every line) in a pool of 6. Each blamed line belongs to one commit; each
   commit's model comes from its Co-Authored-By trailer, read once for the
   whole history with a single `git log`:
       opus55   "Claude Opus 5.5"
       fable5x  "Claude Fable 5" / "Claude Fable 5.1"
       opus5    "Claude Opus 5" (incl. 1M context)
       opus48   "Claude Opus 4.8"
       none     no trailer (older work, or a bare "Claude" trailer)
   Plain blame (no -M/-C): a line moved in a refactor counts for whoever moved
   it, which is what "who last shaped this code" means here.

   Files are grouped twice: by directory, and by SYSTEM (the SYSTEMS table
   below: a game + a player-facing name + a path regex, first match wins).
   Remake candidates = player-visible systems ranked by lowest Opus 5.5 share.

   Output: data/model-census.json, a text report on stdout, and the phone PDF
   ~/harness/out/gta6/census/model-census.pdf (with model-census.html beside it).

   Options: --no-pdf   --jobs N (default 6)   --out DIR   --min-lines N (candidate
            floor, default 400)                                                  */
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printHtmlToPdf } from "./printpdf.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
if (has("--help") || has("-h")) { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\* ?/, "")); process.exit(0); }
const JOBS = Math.max(1, +val("--jobs", 6));
const OUT = path.resolve(val("--out", path.join(os.homedir(), "harness/out/gta6/census")));
const MIN_LINES = +val("--min-lines", 400);
const T0 = Date.now();
const log = (...a) => console.error(`[census ${((Date.now() - T0) / 1000).toFixed(1)} s]`, ...a);
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 256 << 20 });

export const MODELS = ["opus55", "fable5x", "opus5", "opus48", "none"];
export const MODEL_NAME = { opus55: "Opus 5.5", fable5x: "Fable 5/5.1", opus5: "Opus 5", opus48: "Opus 4.8", none: "No trailer (older)" };
export function modelOf(trailers) {
  if (/Opus 5\.5/.test(trailers)) return "opus55";
  if (/Fable 5/.test(trailers)) return "fable5x";
  if (/Opus 5\b/.test(trailers)) return "opus5";
  if (/Opus 4\.8/.test(trailers)) return "opus48";
  return "none";
}

/* ----------------------------------------------------------- the systems
   [game, system, visible, regex]. visible = something the player sees or
   plays (a remake candidate); false = plumbing (engine, sims, net, tools). */
const C = "src/city/", W = "src/world/", S = "src/systems/", E = "src/entities/";
const any = (pre, names) => new RegExp("^" + pre.replace(/\//g, "\\/") + "(?:" + names + ")\\.js$");
export const SYSTEMS = [
  // ---- title
  ["Title", "Title screen / hub (index.html)", true, /^index\.html$|^src\/systems\/title_hub\.js$/],
  // ---- Gang City
  ["Gang City", "County jail (arrest -> cell)", true, /^src\/games\/jail\.js$|^src\/city\/custody\.js$|^src\/systems\/(arrest|cuffedplayer)\.js$/],
  ["Gang City", "Police, wanted, precinct", true, any(C, "police|wanted|law|checkpoints|cctv|ticketing|roadrules|restrain|mugshot")],
  ["Gang City", "Hospital, medics, death, morgue", true, any(C, "medics|morgue|death|insurance|bailout")],
  ["Gang City", "President, politics, government", true, new RegExp(any(C, "presidency|president_\\w+|politics|polity|polwar|elections|candidacy|regimes|statecraft|officials|officialdom|official_assets|govcomplex|exec_office|warroom|dissent|civilwar|approval|countries|crown|motorcade|orders|captives|strategic|newsroom|civic|buildings_civic|vips|address|promotion|roles|roleverbs|agency").source + "|^src\\/games\\/government\\.js$")],
  ["Gang City", "Fort Brandt / military base", true, /^src\/world\/(basekit|airbase)\.js$|^src\/city\/(island_military|militaryvehicles|mil_armor|mil_air|garrison|fortresponse|militia|frontline|armored|bunkers|perimeter)\.js$|^src\/games\/military\.js$/],
  ["Gang City", "Building interiors & fit-out", true, any(C, "interior_programs|fitout\\w*|furniture|interiorlight|interiormap|elevators|escalators|propuse|storage|propertyvault|exec_office_x|housing|hitman_room|president_office_x")],
  ["Gang City", "Buildings, facades, city blocks", true, /^src\/city\/facades\/|^src\/city\/(buildings|facade_\w+|citytemplates|towngen|metro|metro_fabric|metro_structs|metroplan|minicities|settlements|construction|compoundkit|villagekit|streetkit|placement|plots|zoning|realestate|zillow|adboard|flags|spawnplaces)\.js$|^src\/world\/(building_dress|roofs|world_grime)\.js$/],
  ["Gang City", "Roads, ground, terrain, countryside", true, /^src\/city\/(cityground|highways|highwaynet|interchange|street_hardware|citynav|metro_ground|river|continent|countryside|biome_\w+|beach|world|worldmap|island_\w+|power|utility|props)\.js$|^src\/world\/(ground|terrain\w*|island_roads|island_dressing|street_furniture|utility_lines|alpine_skin|mountain_detail|rockscliffs|grassfield|vegetation|wildnature|forestlook|treeaudit|treefoot|desertcity|fuel_station|clutter|detail_kit)\.js$/],
  ["Gang City", "Cars & traffic", true, /^src\/city\/(vehicles|car\w+|crashdeform|crashfx|playercars|modshop|fuel|traffic|vehicle_hold|passengerseat|pullout|stuntjumps|carstrike|skidmarks)\.js$|^src\/world\/carfx\.js$|^src\/systems\/(touch_vehicle|seat_exit|skidmarks|prisoncars_x)\.js$/],
  ["Gang City", "Aircraft & airports", true, /^src\/city\/(aircraft\w*|airframe\w*|airport\w*|airside|airtraffic|approach|boarding|cockpit\w*|playerair\w*)\.js$|^src\/systems\/(airframe|airline|airports)\.js$|^src\/games\/airport\.js$/],
  ["Gang City", "Boats, marina, yachts", true, /^src\/city\/(marina|boatyard|boatwalk|yachts|seacrew|piracy|swim|waterfield)\.js$|^src\/world\/(water_\w+|sea_craft|hull_loft)\.js$/],
  ["Gang City", "Peds, crowds, street life", true, /^src\/city\/(peds|pednav|streetlife|demographics|social|tells|sizeup|citystaff|cityevents|scenedirector|regionlife|interactions|interact|verbwheel|verbword|dialogue|companions|relations|reactions)\.js$|^src\/entities\/(crowd\w*|pedinstance|npc|npclife|ambientstate)\.js$|^src\/workers\/crowd-worker\.js$/],
  ["Gang City", "Characters, clothes, faces", true, /^src\/city\/(clothes|outfits|clothingstore|jewelry|bling|charpanel|identity|origins)\.js$|^src\/entities\/(character|heritage|headwear|footwear|eyewear|jewelry_kit|tattoo|watch|poses|moves\w*|verbposes|meleeposes|gait)\.js$|^src\/systems\/(facial|eyes)\.js$/],
  ["Gang City", "Hitman / bureau missions", true, any(C, "hitman\\w*|contracts|dossier|aim_dossier")],
  ["Gang City", "Gangs, heists, crime", true, any(C, "factions|level|gangs|gangops|playergang|turf|racket|heists|take|mob|protection|occupy|expansion|empire|brain_protection|compoundcrew|captain|squadai|security|explosives|roofloot|demolition_x")],
  ["Gang City", "Shops, jobs, money, casino", true, /^src\/city\/(shops|storegoods|gunstore|cashstore|pawnshop|bank|casino|economy|wallet|companies|careers|gigs|giglife|gigfleet|officejobs|millionaires|wealth|leaderboard|club|drinking|activities|arena_\w+|betslip|campaign|campaign_ui|story|keys|itemassets|itemicons|weapon_thumbnails|arsenal_data|gunmods|inventory|hud|phone|phone_apps|killfeed|mission_x)\.js$|^src\/games\/(casino|boxing|police)\.js$/],
  ["Gang City", "Family, life sim", true, any(C, "family\\w*|kinship|inheritance|births|childhood|schedule|hunger|migration|loyalty|aigoals|brain_city|transfer")],
  ["Gang City", "Wildlife, dogs, hunting", true, /^src\/city\/wildlife\/|^src\/city\/(wildlife|wildlife_rig|wildlife_species|wildlife_tame|wildlife_traits|dogs|dogbrain|dogmodel|fishing|pelts|creature_combat|snowboard)\.js$/],
  ["Gang City", "Combat, guns, gore (shared)", true, /^src\/weapons\/|^src\/city\/(combat|armor|ragdoll|fracture|structural|collapse|demolition|nukefx|los|view|camera)\.js$|^src\/systems\/(combat|combat_iq|melee|gore|wounds|trauma|gunfx|gunhands|fphands|fpsmode|sights|lockon|grapple|bodyfall|bodymass|bodydoors|ordnance|debris|craters|surfacedecal|taserfx|actorweapons|actorcollide|humancontact|handverbs|verbs\w*|helditem\w*|holsterprops|hotbar_model|killstreaks|intimidate|reinforcements|aitactics|armour|structdamage|impactbus|playerflashlight)\.js$|^src\/entities\/(combatkit|soldier|dutykit)\.js$/],
  ["Shared", "Map, HUD, touch controls", true, /^src\/systems\/(fullmap|touch|touch_layout|hud|controls|gamepad|compass|radarscope|markers|dashboard|settings|bootprogress)\.js$|^src\/city\/(hud|cinematics)\.js$/],
  ["Shared", "Sky, light, day/night", true, /^src\/core\/(sky|daynight|lights|lightpin)\.js$/],
  ["Shared", "Sound", true, /^src\/systems\/(audio|music|ambient)\.js$/],
  ["Shared", "Camera & hit reactions", true, /^src\/systems\/(camera|reactions)\.js$/],
  ["Gang City", "Race speedway (in city)", true, any(C, "speedway_race|island_speedway_x")],
  // ---- Jail game (the prison escape)
  ["Jail game", "Prison buildings & yard", true, /^src\/world\/(cellblock|prisonkit|prisonwings|prisonlook|prisongrounds|southblock|yard|yardfurniture|cafeteria|lounge|adminwing|gunroom|towers|razorwire|corridors|corridorkit|layout|door|exit|escape_routes|ventilation|ladderkit|roombuild|groundshaft)\.js$/],
  ["Jail game", "Inmates, guards, prison life", true, /^src\/systems\/(prison\w*|brain_prison|escapeend|escapeplan|lockdown|dayplan|rest|newlife|quests|custom_dialogue|speech|casttraits|detection|climb|tunnels|digsite|breach|stairs|buildmode|pushables|fixtures|pieces|capture|childsafe|resources|survival_interact|hunger|vitals)\.js$|^src\/entities\/(guards|searchlight|towerwatch|handcuffs|keycard|security|coins|survivorbot|ai)\.js$|^src\/core\/prisonlazy\.js$/],
  // ---- other games
  ["NPC War", "NPC War animals (units/species)", true, /^src\/units\/(species\/|kit\/(canid|felid|gait|quadrig|moves|loft))/],
  ["NPC War", "NPC War vehicles (units/vehicles)", true, /^src\/units\/(vehicles\/|kit\/(vehicle|hull))/],
  ["NPC War", "NPC War battle sim, AI, HUD", true, /^src\/battle\/(?!arenas\/)|^src\/units\/(unitkit|manifest)\.js$|^games\/battle\.html$|^src\/systems\/(quadruped_ragdoll|predator\w*|ape_combat|bite_angles)\.js$/],
  ["NPC War", "NPC War arenas / maps", true, /^src\/battle\/arenas\//],
  ["Shark sim", "Shark sim (sharks, ocean, marine life)", true, /^src\/modes\/shark_\w+\.js$|^src\/city\/(wildlife_shark|wildlife_orca|marine_frenzy|marine_predation)\.js$|^games\/ocean\.html$|^src\/games\/ocean\.js$|^src\/world\/sea_scene\.js$/],
  ["Disaster", "Disaster survival (quakes, tsunami, fire...)", true, /^src\/modes\/survival\.js$|^src\/systems\/(disasters|quake|tornado|hurricane|meteor|wildfire|blizzard|flashflood|lightningfx|dustfx|weather)\.js$|^src\/world\/(volcanofx|tsunami_\w+|disaster_arena)\.js$|^src\/city\/tsunami\.js$|^games\/bomb-survivor\.html$|^src\/net\/survnet\.js$/],
  ["Warlord", "Warlord (field battles)", true, /^src\/warlord\/(?!war\/)|^games\/warlord\.html$/],
  ["Warlord", "Warlord war map (grand strategy)", true, /^src\/warlord\/war\//],
  ["Race", "Race game", true, /^src\/race\/|^games\/race\.html$/],
  ["Modes", "Gun game / team match", true, /^src\/modes\/(gungame|teammatch)\.js$|^src\/systems\/gungamehud\.js$/],
  // ---- plumbing (not remake candidates)
  ["Engine", "Economy sim (markets, stocks)", false, /^src\/sim\//],
  ["Engine", "Multiplayer / net", false, /^src\/net\/|^src\/workers\//],
  ["Engine", "Renderer, loop, streaming", false, /^src\/core\//],
  ["Engine", "Shared systems (input, physics, save, UI)", false, /^src\/systems\//],
  ["Engine", "Shared entities", false, /^src\/entities\//],
  ["Engine", "Game packages & boot", false, /^src\/games\/|^src\/(main|bootstrap|config)\.js$|^src\/modes\/|^src\/integrations\/|^games\/dev\.html$/],
  ["Engine", "World kit (shared)", false, /^src\/world\//],
  ["Gang City", "Gang City mode core (other)", false, /^src\/city\//],
];
export const systemOf = (file) => { for (const [game, name, visible, re] of SYSTEMS) if (re.test(file)) return { game, name, visible }; return { game: "Other", name: "Other", visible: false }; };

/* ------------------------------------------------------------- the blame */
function commitModels() {
  const m = new Map();
  const out = git(["log", "--all", "--format=%H%x01%(trailers:key=Co-Authored-By,valueonly,separator=%x02)%x03"]);
  for (const rec of out.split("\x03")) {
    const [h, t = ""] = rec.trim().split("\x01");
    if (h) m.set(h, modelOf(t));
  }
  return m;
}
const blameOne = (file) => new Promise((res, rej) => execFile("git", ["blame", "--porcelain", "HEAD", "--", file],
  { cwd: REPO, encoding: "utf8", maxBuffer: 512 << 20 }, (err, out) => {
    if (err) return rej(err);
    const per = new Map();
    // a porcelain line header is "<sha> <orig> <final>[ <group>]"; the content follows on a TAB line
    for (const ln of out.split("\n")) if (ln.length > 41 && ln.charCodeAt(40) === 32 && /^[0-9a-f]{40} \d/.test(ln)) {
      const sha = ln.slice(0, 40); per.set(sha, (per.get(sha) || 0) + 1);
    }
    res(per);
  }));
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const zero = () => Object.fromEntries(MODELS.map((m) => [m, 0]));
const addInto = (a, b) => { for (const m of MODELS) a[m] += b[m]; return a; };
const total = (c) => MODELS.reduce((s, m) => s + c[m], 0);
const pct = (c, m = "opus55") => { const t = total(c); return t ? (100 * c[m]) / t : 0; };

async function census() {
  const head = git(["rev-parse", "HEAD"]).trim();
  const files = git(["ls-files", "-z", "src", "games", "index.html"]).split("\0")
    .filter((f) => (/^src\/.*\.js$/.test(f) && !f.startsWith("src/vendor/")) || /^games\/[^/]+\.html$/.test(f) || f === "index.html");
  log(`${files.length} files at ${head.slice(0, 8)}`);
  const models = commitModels();
  log(`${models.size} commits mapped to a model`);
  let done = 0;
  const per = await pool(files, JOBS, async (f) => {
    const b = await blameOne(f);
    const c = zero();
    for (const [sha, n] of b) c[models.get(sha) || "none"] += n;
    if (++done % 100 === 0) log(`blamed ${done}/${files.length}`);
    return { file: f, ...systemOf(f), lines: c };
  });
  log(`blame done`);
  const group = (keyFn) => {
    const m = new Map();
    for (const r of per) { const k = keyFn(r); if (!m.has(k)) m.set(k, { key: k, files: 0, lines: zero() }); const g = m.get(k); g.files++; addInto(g.lines, r.lines); }
    return [...m.values()].map((g) => ({ ...g, total: total(g.lines), opus55Pct: +pct(g.lines).toFixed(1) })).sort((a, b) => b.total - a.total);
  };
  const byDir = group((r) => path.dirname(r.file));
  const byGame = group((r) => r.game);
  const bySystem = group((r) => r.game + " | " + r.name).map((g) => {
    const [game, name] = g.key.split(" | ");
    const sys = SYSTEMS.find((s) => s[0] === game && s[1] === name);
    const files = per.filter((r) => r.game === game && r.name === name).sort((a, b) => total(b.lines) - total(a.lines));
    return { game, name, visible: sys ? sys[2] : false, ...g, biggestFiles: files.slice(0, 5).map((r) => ({ file: r.file, total: total(r.lines), opus55Pct: +pct(r.lines).toFixed(1) })) };
  });
  const all = addInto(zero(), per.reduce((a, r) => addInto(a, r.lines), zero()));
  const candidates = bySystem.filter((s) => s.visible && s.total >= MIN_LINES).sort((a, b) => a.opus55Pct - b.opus55Pct || b.total - a.total);
  return { generated: new Date().toISOString(), head, files: per.length, totals: { lines: all, total: total(all), opus55Pct: +pct(all).toFixed(1) },
    byGame, bySystem, byDir, candidates, perFile: per.map((r) => ({ file: r.file, game: r.game, system: r.name, lines: r.lines, total: total(r.lines) })) };
}

/* ------------------------------------------------------------ the report */
const fmt = (n) => n.toLocaleString("en-US");
function textReport(R) {
  const L = [];
  L.push(`MODEL CENSUS @ ${R.head.slice(0, 8)}: ${fmt(R.totals.total)} lines in ${R.files} files, ${R.totals.opus55Pct}% Opus 5.5`);
  L.push(`  ` + MODELS.map((m) => `${MODEL_NAME[m]} ${(100 * R.totals.lines[m] / R.totals.total).toFixed(1)}%`).join("  "));
  L.push("", "BY GAME (lines, % Opus 5.5)");
  for (const g of R.byGame) L.push(`  ${g.key.padEnd(12)} ${fmt(g.total).padStart(9)}  ${String(g.opus55Pct).padStart(5)}%`);
  L.push("", `REMAKE CANDIDATES (player-visible systems >= ${MIN_LINES} lines, lowest Opus 5.5 first)`);
  R.candidates.forEach((s, i) => L.push(`  ${String(i + 1).padStart(2)}. ${String(s.opus55Pct).padStart(5)}%  ${fmt(s.total).padStart(8)}  ${s.game}: ${s.name}   [${s.biggestFiles.slice(0, 3).map((f) => path.basename(f.file)).join(", ")}]`));
  L.push("", "BY DIRECTORY (top 25 by size)");
  for (const d of R.byDir.slice(0, 25)) L.push(`  ${d.key.padEnd(24)} ${fmt(d.total).padStart(9)}  ${String(d.opus55Pct).padStart(5)}%`);
  return L.join("\n");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const COLORS = { opus55: "#1f7a4d", fable5x: "#c98a1b", opus5: "#4b6fb5", opus48: "#8a5bb0", none: "#9aa0a6" };
function bar(c) {
  const t = total(c) || 1;
  return `<div class="bar">${MODELS.map((m) => c[m] ? `<span style="width:${(100 * c[m] / t).toFixed(2)}%;background:${COLORS[m]}"></span>` : "").join("")}</div>`;
}
function htmlReport(R) {
  const games = R.byGame.filter((g) => g.key !== "Other");
  const top = R.candidates;
  const BIG = 20000;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Model census</title><style>
@page { size: 4.2in 9in; margin: 0.25in; }
:root { --ink:#1b1d21; --mute:#5f6670; --line:#e3e5e8; }
body { font: 13px/1.4 -apple-system, "Helvetica Neue", Arial, sans-serif; color: var(--ink); background: #fff; margin: 0; }
h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 15px; margin: 18px 0 6px; page-break-after: avoid; }
.sub { color: var(--mute); font-size: 11.5px; margin-bottom: 10px; }
.key { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--mute); margin: 6px 0 10px; }
.key i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.bar { display: flex; height: 12px; border-radius: 3px; overflow: hidden; background: #eee; }
.bar span { display: block; height: 100%; }
.game { margin: 0 0 10px; page-break-inside: avoid; }
.game .h { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 3px; }
.game .h b { color: ${COLORS.opus55}; }
.game .n { color: var(--mute); font-size: 11px; font-weight: 400; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
td, th { padding: 5px 3px; border-bottom: 1px solid var(--line); vertical-align: top; text-align: left; }
th { font-size: 11px; color: var(--mute); font-weight: 600; }
td.r, th.r { text-align: right; white-space: nowrap; }
td.p { font-weight: 700; } tr { page-break-inside: avoid; }
.g { color: var(--mute); font-size: 10.5px; display: block; }
.big { font-size: 10px; background: #fde9d9; color: #9a3b0c; border-radius: 3px; padding: 0 4px; margin-left: 4px; white-space: nowrap; }
.note { color: var(--mute); font-size: 11.5px; } .note p { margin: 0 0 6px; }
</style></head><body>
<h1>Who wrote the game you play</h1>
<div class="sub">${fmt(R.totals.total)} current lines in ${R.files} files at ${R.head.slice(0, 8)} &middot; ${R.generated.slice(0, 10)} &middot; <b style="color:${COLORS.opus55}">${R.totals.opus55Pct}% Opus 5.5</b> overall</div>
<div class="key">${MODELS.map((m) => `<span><i style="background:${COLORS[m]}"></i>${MODEL_NAME[m]}</span>`).join("")}</div>
<h2>By game</h2>
${games.map((g) => `<div class="game"><div class="h"><span>${esc(g.key)} <span class="n">${fmt(g.total)} lines</span></span><b>${g.opus55Pct}%</b></div>${bar(g.lines)}</div>`).join("\n")}
<h2>Remake candidates</h2>
<div class="sub">Player-visible systems (&ge; ${MIN_LINES} lines), lowest Opus 5.5 share first. <span class="big">big</span> = 20,000+ lines, what you see most.</div>
<table><tr><th>#</th><th>System</th><th class="r">Opus 5.5</th><th class="r">Lines</th></tr>
${top.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}${s.total >= BIG ? '<span class="big">big</span>' : ""}<span class="g">${esc(s.game)} &middot; ${s.biggestFiles.slice(0, 3).map((f) => esc(path.basename(f.file))).join(", ")}</span>${bar(s.lines)}</td><td class="r p">${s.opus55Pct}%</td><td class="r">${fmt(s.total)}</td></tr>`).join("\n")}
</table>
<h2>How this was measured</h2>
<div class="note">
<p>Every tracked <code>src/**/*.js</code> (not <code>src/vendor</code>), <code>games/*.html</code> and <code>index.html</code> was run through <code>git blame</code> at the commit above. Each surviving line belongs to the commit that last changed it; that commit's <i>Co-Authored-By</i> trailer names the model. No trailer = older work (before trailers were used).</p>
<p>So the numbers are <b>current lines</b>, not lines ever written: code that was later rewritten counts for the rewriter. A line moved to a new file counts for whoever moved it. Comments count as lines.</p>
<p>Files are grouped into systems by path (table in <code>tools/model-census.mjs</code>). Full per-file data: <code>data/model-census.json</code>. Re-run: <code>node tools/model-census.mjs</code>.</p>
</div></body></html>`;
}

/* ------------------------------------------------------------------- main */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const R = await census();
  mkdirSync(path.join(REPO, "data"), { recursive: true });
  writeFileSync(path.join(REPO, "data/model-census.json"), JSON.stringify(R, null, 1));
  console.log(textReport(R));
  mkdirSync(OUT, { recursive: true });
  const html = path.join(OUT, "model-census.html");
  writeFileSync(html, htmlReport(R));
  if (!has("--no-pdf")) {
    try { const pdf = await printHtmlToPdf(html, path.join(OUT, "model-census.pdf")); log(`pdf ${pdf}`); }
    catch (e) { log("pdf failed: " + e.message); process.exitCode = 1; }
  }
  log("done");
}
