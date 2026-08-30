#!/usr/bin/env node
/* ============================================================
   tools/facade-catalog.mjs — THE PICKING SHEET.

   OWNER: "Make a pdf with all the facades with numbers I'm going to then pick
   10 of those and then you are going to make each of those 10 facades into a
   whole cultural city of facades."

   WHAT THIS IS FOR, AND WHY IT IS NOT facade-gallery.mjs
   -----------------------------------------------------
   tools/visual-presets/facade-gallery.mjs answers "did the kit do anything?"
   — it is a BEFORE/AFTER, so every plate is spent twice and only ten styles
   fit. This tool answers a different question, the only one that matters
   right now: WHICH OF THE THIRTY-ONE IS WORTH BUILDING A CITY OUT OF. So:

     * every registered facade, not a curated ten — read from CBZ.facadeList()
       at run time, so a facade added tomorrow is in tomorrow's sheet;
     * no before side. The bare box is not the question; the sheet would be
       half blank boxes and the owner would be picking from half a page;
     * a stable PRINTED NUMBER on every plate, because the deliverable is a
       reply that says "4, 9, 17, 22" and that reply has to be unambiguous
       three days from now. The number comes from ORDER (below), which is a
       literal list in this file — NOT registry order, which is index.html's
       script-tag order and would renumber every plate the day someone moves
       a <script> line.

   THREE SHOTS PER FACADE, and each one is trying to catch a different lie:

     HERO    front-right three-quarter. The honest single frame: entrance face
             and one flank at once, so front-only ornament cannot hide.
     STREET  standing on the pavement looking up at the door. Where a player
             actually meets a building; judges the entrance and nothing else.
     BACK    rear-left three-quarter. THE CHEAT DETECTOR. A facade that is a
             stage set — all its money spent on the door elevation — is
             invisible in the other two frames and obvious in this one. Since
             the plan is to grow ten of these into whole cities, a grammar
             that only works from one angle is disqualifying, and this is the
             frame that says so.

   EACH FACADE IS PHOTOGRAPHED AT ITS OWN SCALE. A bundled tube on a corner
   shop is nonsense and a ranch house at 40 storeys is nonsense; the registry
   already knows which is which (minStoreys / maxStoreys), so towers get the
   40-storey subject, houses get a two-storey house and everything else gets
   the standard 22x16 four-storey office. Comparability is preserved WITHIN a
   family, which is the only place it means anything.

   Usage:
     node tools/facade-catalog.mjs                 # → artifacts/facade-catalog/
     node tools/facade-catalog.mjs --only intl,pencil --no-pdf
     node tools/facade-catalog.mjs --url http://127.0.0.1:8000/
   Zero npm deps: raw CDP over the pre-installed Chromium, same as studio.mjs.
============================================================ */

import { spawn, execFile } from "node:child_process";
import { rm, mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = process.env.CBZ_CHROME
  || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- CLI ----------
const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  const k = a.slice(2);
  const flag = ["no-pdf", "help", "html-only", "sameness"].includes(k);
  opt[k] = flag ? true : (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true);
}
if (opt.help) { console.log("usage: node tools/facade-catalog.mjs [--only a,b] [--out dir] [--url URL] [--no-pdf] [--html-only]"); process.exit(0); }
const OUTDIR = path.resolve(ROOT, opt.out || "artifacts/facade-catalog");
const ONLY = opt.only ? String(opt.only).split(",").map((s) => s.trim()) : null;

/* ============================================================
   THE CATALOGUE ORDER — and the numbers the owner will reply with.

   Grouped by what the grammar IS, because that is how the pick will actually
   be made ("I want three towers and a street of houses"), and because the
   families do not compete: a supertall and a ranch house photographed side by
   side compare their subjects, not their facades.

   `note` is what the style is, in one breath. `city` is the honest answer to
   "what would a whole city of this even be" — the question the next step
   asks, put in front of the owner NOW so the pick is made knowing where each
   one leads instead of only on which plate is prettiest.
============================================================ */
const ORDER = [
  // ---- TOWERS (the registry's minStoreys set) --------------------------
  { id: "intl", era: "early20", fam: "tower", note: "Seagram, 1958. Bronze mullions on an absolutely regular grid, a plaza, a lobby set back behind free-standing columns. No ornament anywhere — it survives on proportion alone.", city: "A corporate downtown. The three siblings are the variations Mies's imitators made: travertine spandrels, a black-steel version, a white-marble civic slab." },
  { id: "ziggurat", era: "early20", fam: "tower", note: "The 1916 New York zoning envelope: mandatory setbacks stepping the tower back from the street as it rises, so the shape is a law made visible.", city: "Pre-war Manhattan. Siblings: the wedding-cake hotel, the setback courthouse, the stepped power-company HQ." },
  { id: "pyramid", era: "late20", fam: "tower", note: "Transamerica. A tapered spire with the whole elevation converging on a point, wing buttresses at the shoulders.", city: "A skyline of tapers — obelisk, needle, stepped cone. Rare and expensive to over-use; one per district." },
  { id: "sunburst", era: "early20", fam: "tower", note: "Chrysler's radiator crown: stacked arcs of decreasing radius, dormer eyes, a spire. The crown is the entire building's argument.", city: "The crown competition of 1930 — every tower in the district trying to out-terminate the last one. The richest sibling set in the kit." },
  { id: "bundled", era: "late20", fam: "tower", note: "Sears/Willis. Nine square tubes in a 3x3 bundle that stop at different heights. Almost no surface treatment; pure massing.", city: "A structural-expression downtown: tube, bundle, diagonal, hat truss. Cold, enormous, recognisable at 20 km." },
  { id: "megabrace", era: "late20", fam: "tower", note: "The braced tube — giant X-bracing crossing many storeys on the outside of the glass, structure as the only ornament.", city: "Siblings: the diagrid, the outrigger belt truss, the exposed mega-column. An engineer's city." },
  { id: "faceted", era: "late20", fam: "tower", note: "Bank of China, 1990. The prism is CUT: quadrants rise to four different heights with long diagonals running across dozens of storeys.", city: "A crystal district. Siblings are the other cuts — the sheared top, the twisted shaft, the folded plate." },
  { id: "neogothic", era: "early20", fam: "tower", note: "Woolworth, the Cathedral of Commerce: a Gothic cathedral stretched to 60 storeys, buttresses and pinnacles all the way up.", city: "The 1913 skyline where every tower borrowed a cathedral. Siblings: Tribune Tower's flying buttresses, a spired campanile, a Gothic crown on a stone shaft." },
  { id: "postmodern", era: "late20", fam: "tower", note: "AT&T, 1984. A classical broken pediment on top of a skyscraper — deliberately absurd, deliberately memorable.", city: "The 1980s. Siblings: the Chippendale sibling, the pink granite arch, the temple-front bank. A city with a sense of humour." },
  { id: "pencil", era: "late20", fam: "tower", note: "The supertall slim: a 1:12 shaft, open mechanical floors punched through it for wind, a razor top.", city: "Billionaires' Row. Siblings: the setback needle, the concrete-core stack, the paired-tower slot. A city of impossibly thin things." },

  // ---- BLOCKS (the mid-rise grammars, on the standard office shell) ------
  { id: "brick", era: "industrial", fam: "block", note: "Chicago loft, c.1905. Load-bearing brick read as STRUCTURE: piers between the bays, segmental arches, a corbelled cornice, cast-iron storefront, fire escape down the flank.", city: "A warehouse district that became lofts. Siblings: the mill building, the printing house, the brick-and-timber garment block." },
  { id: "stone", era: "industrial", fam: "block", note: "Ashlar bank in three parts — rusticated base, plain shaft, attic over a heavy cornice — with a giant order solved backwards from the roofline.", city: "A financial quarter of stone institutions: the exchange, the courthouse, the trust company, the library." },
  { id: "artdeco", era: "early20", fam: "block", note: "1930 setback commercial block. Fluted piers run base to crown with the spandrels pushed back behind them; nothing horizontal is allowed to cross a pier.", city: "A whole deco main street: theatre, department store, telephone exchange, hotel." },
  { id: "brutalist", era: "late20", fam: "block", note: "Beton brut. Every opening a hole punched through a thick wall, hooded so it throws a hard shadow all day; board-formed plank lines; lifted on pilotis.", city: "A concrete civic campus — city hall, the library, the parking structure, the housing slab. Grim and coherent." },
  { id: "hightech", era: "late20", fam: "block", note: "Inside-out, Lloyd's / Pompidou: the frame stands proud of the glass, the risers and stair are outside, and the roof plant is architecture.", city: "A services-on-the-outside quarter. Siblings: the exposed-truss shed, the tension-rod atrium, the gantry-served lab." },
  { id: "gothic", era: "medieval", fam: "block", note: "Gothic Revival civic front: buttresses stepping back as they rise, pinnacles breaking the roofline, tracery, a rose window over a deep portal. Everything ends in a point.", city: "An old-world cathedral town — the hall, the guild, the college quad, the parish church." },
  { id: "mosque", era: "islamic", fam: "block", note: "Dome on a buttressed drum, a minaret off one corner, horseshoe arcade, monumental pishtaq portal.", city: "An Islamic old city: the great mosque, the madrasa, the caravanserai, the covered bazaar. Big cultural payoff." },
  { id: "pagoda", era: "eastasia", fam: "block", note: "Timber frame under deep tiered eaves with upturned corners on visible dougong brackets. The lowest eave projects the furthest.", city: "An East Asian temple quarter: gate, hall, drum tower, pagoda proper." },
  { id: "adobe", era: "americas", fam: "block", note: "Earthen mass: battered walls thickening to the base, projecting vigas, stepped massing, small deep-set windows, a latilla porch. Irregularity IS the style.", city: "A pueblo/Saltlands town — mission church, trading post, stacked terraced dwellings." },
  { id: "victorian", era: "industrial", fam: "block", note: "Second Empire. Mansard roof with dormers punching through, projecting oriel bays, a deep bracketed cornice over a cast-iron storefront.", city: "A 19th-century downtown: the opera house, the hotel, the department store, the rooming block." },

  // ---- HOUSES (the maxStoreys set, on a two-storey house shell) ---------
  { id: "queenanne", era: "industrial", fam: "house", note: "The painted lady: asymmetric mass, a corner turret, a wraparound porch, three colours of shingle and spindlework everywhere.", city: "An 1890s residential hill. Siblings: Stick, Shingle, Eastlake. The most ornament per square metre in the kit." },
  { id: "greekrev", era: "colonial", fam: "house", note: "A temple bolted to a house: gable turned to the road, full-height colonnade in front of it, a real pediment with a shadowed tympanum, painted dead white.", city: "A courthouse-square town of white temple fronts — bank, academy, two churches, the big house on the hill." },
  { id: "plantation", era: "colonial", fam: "house", note: "Antebellum: a two-storey gallery running the full width on both floors, columns from ground to roof, hipped roof with dormers.", city: "A river road of galleried houses, an overseer's cottage, a raised creole townhouse." },
  { id: "manor", era: "medieval", fam: "house", note: "English manor: steep gables, half-timbering, tall grouped chimney stacks, leaded casements, a stone porch bay.", city: "A Tudor village — inn, church, market hall, timbered terrace." },
  { id: "brickhouse", era: "colonial", fam: "house", note: "Georgian/Colonial: solid brick laid symmetrically about a centre door, side-gabled roof, a chimney at each end. Its argument is DECORUM.", city: "A colonial town of manners — meeting house, tavern, the row houses, the governor's house." },
  { id: "spanish", era: "colonial", fam: "house", note: "Spanish Colonial: white stucco, a low-pitch clay barrel-tile roof, arcaded loggia, wrought iron, a bell-gable.", city: "A mission town: the mission itself, the hacienda, the plaza arcade, the courtyard house." },
  { id: "machiya", era: "eastasia", fam: "house", note: "Japanese townhouse/minka: a low timber frame with pale plaster infill, a veranda deck along the street face, one enormous tiled roof with deep eaves.", city: "A machiya street — shop-house, teahouse, gate house, storehouse (kura)." },
  { id: "romanvilla", era: "classical", fam: "house", note: "Roman villa: a low tile roof, a colonnaded peristyle, stuccoed masonry, a courtyard the building wraps.", city: "A Mediterranean antique quarter — villa, baths, forum stoa, insula." },
  { id: "desertmod", era: "contemporary", fam: "house", note: "Palm Springs, 1962. A single thin roof blade with 2-6 m of overhang, steel posts, plate glass, a breeze-block screen. Architecture as the management of sun.", city: "A mid-century desert suburb: butterfly roof, folded plate, the post-and-beam, the screen-wall bungalow." },
  { id: "techhouse", era: "contemporary", fam: "house", note: "Contemporary glass house: stacked cantilevered volumes, floor-to-ceiling glazing, a wood-slat screen, a flat roof with a parapet.", city: "A hillside of modern spec houses. The least characterful pick, and the most likely to read as generic." },
  { id: "ranch", era: "contemporary", fam: "house", note: "Plain house. A long low box, shallow gable, picture window, an attached carport. Deliberately the boring one — it is what a street NEEDS between the loud ones.", city: "Post-war tract suburbia: ranch, split-level, cape, minimal traditional. Background architecture, and a city is mostly background." },

  // ---- THE ERA LADDER: grammars written for the historical sheet ---------
  // These are the eight eras the kit had no answer for. They are the reason
  // `wall` exists: almost none of them have glazing, and until the shell could
  // be told to hand over the wall plane none of them could be written at all.
  { id: "drystone", era: "neolithic", fam: "house", note: "Skara Brae / broch. Coursed unmortared rubble battering inward, a corbelled roof closing to a smoke hole, a creep entrance under one massive lintel. No windows.", city: "A Neolithic settlement — huts, a passage tomb, a stone circle, a souterrain. The oldest thing a city can be." },
  { id: "longhouse", era: "neolithic", fam: "house", note: "The roof IS the building: enormous thatch sweeping nearly to the ground, crossed ridge poles, heavy gable posts, one door, no windows.", city: "A forest-clearing village of longhouses, a palisade, a granary on posts." },
  { id: "wattle", era: "neolithic", fam: "house", note: "Conical thatch over daub walls showing the stake-and-weave beneath, a ring of posts, a two-post porch. Made to read round on a rectangular plan.", city: "An Iron Age roundhouse cluster inside a ditch and bank." },
  { id: "urziggurat", era: "bronze", fam: "block", note: "Ur. Three receding battered terraces, a monumental triple stair, reeded pilaster-and-buttress rhythm on every face, a shrine on the summit. Not to be confused with the 1916 zoning tower that shares the word.", city: "A Mesopotamian temple-city: ziggurat, mudbrick courtyard houses, a walled precinct, a gate of glazed brick." },
  { id: "mastaba", era: "bronze", fam: "block", note: "Egyptian. Walls battering inward, a torus roll up every corner, a cavetto cornice flaring at the top, a pylon gate with flagstaff niches.", city: "A Nile temple precinct — pylon, hypostyle hall, mastaba tombs, an avenue of sphinxes." },
  { id: "minoan", era: "bronze", fam: "block", note: "Knossos. The downward-tapering column — wider at the top, the opposite of every other column in the kit — red and black banding, a colonnaded light-well, horns of consecration on the parapet.", city: "An Aegean palace town: the palace, storerooms, a theatral area, terraced houses down to a harbour." },
  { id: "mayatemple", era: "americas", fam: "block", note: "Tikal. A far steeper stepped pyramid than a ziggurat, a small cella on the summit, and a roof comb standing above it taller than the cella itself. The comb is the silhouette.", city: "A Maya city — temple pyramids, a palace range, a ballcourt, stelae in a plaza." },
  { id: "puuc", era: "americas", fam: "block", note: "Uxmal. A plain lower wall and, above a medial moulding, an encrusted upper frieze of stone mosaic: colonnettes, stepped fret, stacked long-nosed masks at the corners.", city: "A Puuc hill town: palace, nunnery quadrangle, arch gateway, chultun cisterns." },
  { id: "talud", era: "americas", fam: "block", note: "Teotihuacan. A repeating unit stacked up the elevation — sloping talud, then a framed vertical tablero that oversails it. The projecting frame throws the shadow that makes the profile.", city: "The Avenue of the Dead: platforms, apartment compounds, a painted precinct." },
  { id: "stave", era: "medieval", fam: "house", note: "Borgund. Steeply pitched shingled roofs stacked in diminishing tiers climbing to a point, dragon-head finials at the gables, an external gallery on posts, vertical stave planking.", city: "A Norse valley: stave church, longhouse farmstead, a stabbur on staddle stones, a boathouse." },
  { id: "izba", era: "medieval", fam: "house", note: "Horizontal log courses with interlocked corners whose ends project past the wall at every course, a raised podklet, a carved bargeboard, nalichniki window surrounds.", city: "A Russian village — izby along one street, a wooden church, a bathhouse, a well crane." },
  { id: "caravanserai", era: "islamic", fam: "block", note: "A fortified block with corner towers, a crenellated parapet and almost no openings, spending everything on one monumental iwan portal projecting above the parapet.", city: "A Silk Road halt: caravanserai, covered bazaar, madrasa, a domed cistern." },
  { id: "shikhara", era: "southasia", fam: "block", note: "Khajuraho. A curvilinear tower of stacked receding courses that rises vertically then curves in, an amalaka disc and pot finial at the apex, a mandapa porch under its own stepped roof, a star-pointed plan.", city: "A Nagara temple town: shikhara, tank with ghats, a pillared hall, subsidiary shrines." },
  { id: "prasat", era: "southasia", fam: "block", note: "Angkor. A quincunx — one central tower and four at the corners — each a stack of diminishing storeys with antefix horns at every tier, false doors on three sides, naga balustrades.", city: "A Khmer temple-city: prasat, gopura gates, a baray reservoir, a laterite causeway." },
  { id: "stupa", era: "southasia", fam: "block", note: "Bagan. A bell on a stepped terrace under an hti — a spire of diminishing rings — with a pyatthat, the multi-tiered spired roof, over the entrance hall.", city: "A plain of pagodas: stupa, ordination hall, monastery, a pyatthat gate." },
  { id: "sahelian", era: "africa", fam: "block", note: "Djenne. Engaged buttress piers running the full height and ending in cone finials, toron palm beams studding the whole elevation in a grid, battered mud walls, a parapet of pinnacles. No windows.", city: "A Sahelian city of earth: the great mosque, a merchant quarter, mud granaries, a Friday market square." },
  { id: "zimbabwe", era: "africa", fam: "block", note: "The Great Enclosure. Coursed granite laid without mortar, battering and thickening enormously at the base, almost no openings, a chevron course near the top and a solid conical tower.", city: "A dry-stone capital: the enclosure, the hill complex, narrow parallel passages, a valley of daga huts." },
  { id: "swahili", era: "africa", fam: "house", note: "Lamu. Coral rag under lime plaster, a flat terrace roof behind a low parapet, a deeply carved timber door in a frame far larger than it needs, zidaka niches, a baraza bench at the street.", city: "A Swahili stone town: merchant houses, a mosque, a customs house, alleys too narrow for carts." },
  { id: "palazzo", era: "renaissance", fam: "block", note: "Strozzi. Three storeys getting smoother as they rise — rock-faced, then channelled, then near-ashlar — bifora windows, corner quoin chains, and an enormous cornice throwing a hard band of shade.", city: "A Florentine quarter: palazzi, a loggia, a baptistery, a bridge lined with shops." },
  { id: "baroque", era: "renaissance", fam: "block", note: "Il Gesu. A two-storey front stitched by great volute scrolls, giant-order pilasters layered so the centre steps forward, statue niches, a broken segmental pediment. A wall that swells.", city: "A baroque capital: church fronts, a fountain square, a palace, an obelisk on an axis." },
  { id: "palladian", era: "renaissance", fam: "house", note: "Villa Rotonda. A piano nobile over a rusticated basement, a full temple-front portico, flanking wings, a serliana window, a shallow dome. Raised and arched where Greek Revival is grounded and gabled.", city: "A Veneto landscape of villas, barchesse, a walled garden, a canal." },
  { id: "arcology", era: "future", fam: "tower", note: "Planted terraces stepping back on every face, sky-bridges between masses, and a wind-scoop void punched clean through the upper mass — a hole in the building.", city: "A vertical district: linked arcologies, sky-farms, a ground plane given back to water." },
  { id: "printed", era: "future", fam: "tower", note: "Printed in place. Continuous horizontal bead courses running unbroken around the building, each offset from the last so the wall swells and waists. No straight vertical edge anywhere.", city: "A printed settlement — lobed towers, extruded low blocks, a landscape with no right angles." },
  { id: "masstimber", era: "future", fam: "tower", note: "CLT and glulam. A heavy timber grid standing outside the glass, warm against cool grey, and planted setback terraces where the structure steps in. Warm and orthogonal where high-tech is metal and industrial.", city: "A timber downtown: CLT towers, a market hall on glulam arches, planted decks." },
];

const FAMLABEL = { tower: "tower", block: "mid-rise block", house: "house" };
/* THE LADDER. The sheet used to group by SUBJECT SIZE, which was right when
   the question was "which ten of these do I like": you cannot compare a
   supertall and a bungalow, so they were kept apart. The question is now a
   different one — "does this cover human building history" — and the only
   order that answers it is chronological. `fam` still decides the subject a
   grammar is photographed on; `era` decides where it lands in the book. */
const ERAS = [
  ["neolithic", "STONE AGE", "Before metal, before the wheel. Mass, thatch and stacked stone; the roof is usually the whole building and there are no windows at all."],
  ["bronze", "BRONZE AGE", "The first monumental states. Mud brick and dressed stone piled into terraces, battered walls and gods on the summit."],
  ["classical", "CLASSICAL ANTIQUITY", "The orders, the courtyard, the tile roof. The grammar the West would keep re-borrowing for two thousand years."],
  ["americas", "INDIGENOUS AMERICAS", "Pyramid, platform and frieze — and earth architecture in the north. No arch, no glass, no iron, and none of it needed."],
  ["medieval", "MEDIEVAL EUROPE", "Stone that gathers load into buttresses, and timber that stacks, laps and carves. Everything points."],
  ["islamic", "ISLAMIC WORLD & SILK ROAD", "The portal is the building. Blank defensive walls spend all their ornament on one deep pointed recess."],
  ["southasia", "SOUTH & SOUTHEAST ASIA", "Towers that curve, cluster and taper to a needle, built of stacked courses rather than framed bays."],
  ["eastasia", "EAST ASIA", "Timber frames under enormous eaves. The wall carries nothing and the bracket set is the ornament."],
  ["africa", "AFRICA", "Earth, unmortared granite and coral rag — three constructions with nothing in common but a continent."],
  ["renaissance", "RENAISSANCE & BAROQUE", "The orders come back as a system, then start to bend. Rustication, giant orders, and finally a wall that swells."],
  ["colonial", "COLONIAL & EARLY AMERICAN", "Old-world manners in new-world timber and brick. Symmetry, a centre door, and a temple front on a farmhouse."],
  ["industrial", "INDUSTRIAL 19TH CENTURY", "Iron, plate glass and the load-bearing brick pier. Buildings that show you how they stand up."],
  ["early20", "EARLY 20TH CENTURY", "The zoning envelope and the vertical pier. Towers learn to have crowns, then learn to stop."],
  ["late20", "LATE 20TH CENTURY", "Structure as the only ornament, then structure as a joke. Concrete, exoskeletons, tubes and a broken pediment."],
  ["contemporary", "CONTEMPORARY", "Glass, cantilever and the deep shading roof. Also the plain house, which is what a street is actually made of."],
  ["future", "NEAR FUTURE", "Terraces you can farm, walls printed in one pass, and towers that grew rather than being smelted."],
];
const ERALABEL = {}, ERANOTE = {}, ERAIDX = {};
ERAS.forEach(([k, label, note], i) => { ERALABEL[k] = label; ERANOTE[k] = note; ERAIDX[k] = i; });
/* The three subjects. Within a family every plate is the same box, so the
   sheet compares grammars; across families it deliberately is not. */
const SUBJ = {
  tower: { w: 34, d: 28, storeys: 40, color: 0x8d97a6, doorSide: 1 },
  block: { w: 22, d: 16, storeys: 4, color: 0xb9b3a6, doorSide: 1 },
  house: { w: 15, d: 11, storeys: 2, color: 0xc8bfae, doorSide: 1 },
};
/* One exception, and it is the grammar's own point: a "supertall slim" on a
   34x28 plan is a fat tower, so pencil is photographed on the 1:12 plan it
   exists to draw. Noted on its plate so the difference is not a secret. */
const SUBJ_OVERRIDE = { pencil: { w: 20, d: 18, storeys: 48, color: 0x8d97a6, doorSide: 1 } };

// ---------- static server ----------
let serverProc = null;
let baseUrl = typeof opt.url === "string" ? opt.url : null;
async function ensureServer() {
  if (baseUrl) return;
  const port = 8700 + Math.floor(Math.random() * 300);
  serverProc = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
    env: { ...process.env, PORT: String(port) }, stdio: "ignore",
  });
  baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(baseUrl + "index.html", { method: "HEAD" }); if (r.ok) return; } catch (_) {}
    await sleep(150);
  }
  throw new Error("dev server did not come up");
}

// ---------- CDP ----------
let ws, nextId = 1;
const pending = new Map();
function send(method, params = {}, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (!pending.has(id)) return; pending.delete(id); reject(new Error(method + " timed out")); }, timeout);
  });
}
async function evaluate(expression, timeout = 120000) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeout);
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("page: " + ((d.exception && d.exception.description) || d.text));
  }
  return r.result && r.result.value;
}
let chromeProc = null, profileDir = null;
async function launchChrome() {
  const port = 9600 + Math.floor(Math.random() * 400);
  profileDir = `/tmp/cbz-facade-catalog-${port}`;
  await rm(profileDir, { recursive: true, force: true });
  chromeProc = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--enable-webgl", "--ignore-gpu-blocklist",
    "--disable-background-networking", "--disable-component-update",
    "--disable-extensions", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--no-default-browser-check", "--window-size=1400,1000",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
    baseUrl + "?seed=64321&cfg_FACADE_KIT=1",
  ], { stdio: "ignore" });
  const deadline = Date.now() + 40000;
  let page = null;
  while (Date.now() < deadline && !page) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      page = (await res.json()).find((p) => p.type === "page" && p.url.startsWith(baseUrl));
    } catch (_) {}
    if (!page) await sleep(200);
  }
  if (!page) { chromeProc.kill("SIGKILL"); throw new Error("chrome page did not appear"); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown") return;
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");
}

/* ============================================================
   THE IN-PAGE STUDIO. Same hijack tools/studio.mjs and the facade-gallery
   preset use: no-op the public render so the game's rAF cannot starve our
   stills under SwiftShader, keep the original for our own shot, and point
   CBZ.scene/CBZ.camera at a scene we own. One hard key light plus a fill,
   shadows ON — relief is the entire subject, and a window hood that casts
   nothing has not been proved.
============================================================ */
const HARNESS = String.raw`(() => {
  if (window.__fc) return "ready";
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T || !CBZ.renderer || !CBZ.facadeStudio || !CBZ.cityMakeBuilding) return null;
  const S = {};
  S.W = 1280; S.H = 900;
  try { if (CBZ.game) CBZ.game.state = "studio"; } catch (e) {}
  S._render = CBZ.renderer.render.bind(CBZ.renderer);
  CBZ.renderer.render = function () {};

  const scene = new T.Scene();
  scene.background = new T.Color(0xbcd2e8);
  scene.fog = null;
  scene.add(new T.HemisphereLight(0xdfeaf7, 0x565d63, 0.44));
  /* ONE HARD KEY, FROM THE FRONT-LEFT OF THE HERO CAMERA. The hero stands at
     azimuth +x+z; a light sharing that azimuth would flatten both visible
     faces to the same value and the relief — which is the entire subject —
     would vanish. Coming across from -x+z instead, the +z face is lit and the
     +x face falls into shade, so every pier, hood and setback declares itself
     at the face edge. */
  const key = new T.DirectionalLight(0xfff3e2, 1.02);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.target.position.set(0, 0, 0);
  scene.add(key.target);
  scene.add(key);
  const fill = new T.DirectionalLight(0xd8e6ff, 0.24);
  fill.position.set(140, 60, -120);
  scene.add(fill);
  const ground = new T.Mesh(new T.CircleGeometry(900, 72),
    new T.MeshLambertMaterial({ color: 0x53574f }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const holder = new T.Group();
  scene.add(holder);

  /* THE SHADOW FRUSTUM IS SIZED TO THE SUBJECT, not left at one constant.
     A single frustum wide enough for a 48-storey tower spreads 2048 texels
     over 300 m and a bungalow gets 7 cm of shadow resolution — which is
     exactly the stripe-acne the first pass photographed. Re-fit per raise. */
  S.light = (s, h) => {
    const reach = Math.max(s.w, s.d);
    const span = Math.max(reach * 1.15, h * 0.62) + 6;
    const dist = Math.max(h * 1.9, reach * 3.2);
    key.position.set(-dist * 0.60, dist * 0.62, dist * 0.72);
    key.target.position.set(0, h * 0.35, 0);
    key.target.updateMatrixWorld();
    const cs = key.shadow.camera;
    cs.left = -span; cs.right = span; cs.top = span; cs.bottom = -span;
    cs.near = 1; cs.far = dist * 3 + 200;
    cs.updateProjectionMatrix();
    // Sized bias: acne scales with world-units-per-texel, so a constant bias
    // that is right for a house peters out on a tower and vice versa.
    key.shadow.bias = -0.00035 - (span / 2048) * 0.0008;
    key.shadow.normalBias = Math.max(0.02, span / 2048 * 1.6);
  };

  const cam = new T.PerspectiveCamera(38, 1.4, 0.15, 9000);
  CBZ.scene = scene; CBZ.camera = cam;
  const r = CBZ.renderer;
  r.shadowMap.enabled = true;
  r.setPixelRatio(1);
  r.setSize(S.W, S.H, false);
  document.body.style.margin = "0";
  const cv = r.domElement;
  cv.style.position = "fixed"; cv.style.left = "0"; cv.style.top = "0"; cv.style.zIndex = "99999";
  document.body.appendChild(cv);
  for (const child of Array.from(document.body.children)) {
    if (child !== cv) child.style.visibility = "hidden";
  }

  // The elevation sheet wants the building and nothing else: with a ground
  // plane in shot the horizon lands across the middle of every cell and gets
  // confused with the floor rules drawn over them.
  S.ground = (on) => {
    ground.visible = !!on;
    holder.traverse((o) => { if (o.name === "facadePad") o.visible = !!on; });
  };

  S.clear = () => {
    while (holder.children.length) {
      const c = holder.children[0];
      holder.remove(c);
      c.traverse && c.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    }
  };

  // Raise one dressed building and measure it: what the grammar adds to the
  // SILHOUETTE (crownM / aboveShell — see below) and what it costs (merged
  // deco boxes are free at flushDeco; individually minted meshes are not).
  S.raise = (style, subject) => {
    S.clear();
    const g = CBZ.facadeStudio(style, { subject: subject });
    holder.add(g);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // The pad ships bright enough to read as a lit plinth, which puts a white
    // square under a white building. It is a stage, not a subject: sink it.
    let pad = null;
    g.traverse((o) => { if (o.name === "facadePad") pad = o; });
    if (pad && pad.material) { pad.material.color.setHex(0x4e5249); pad.castShadow = false; }
    let decoBoxes = 0, realMeshes = 0, tris = 0;
    const heights = [];
    g.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.name === "facadePad") return;
      const pos = o.geometry.attributes && o.geometry.attributes.position;
      if (!pos) return;
      const boxes = pos.count / 24;
      if (Number.isInteger(boxes) && boxes >= 1) decoBoxes += boxes; else realMeshes += 1;
      tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      if (bb && isFinite(bb.max.y)) heights.push(Math.round((bb.max.y + o.position.y) * 4) / 4);
    });
    /* WHAT THE SILHOUETTE ACTUALLY GAINED. The gallery preset counts
       "distinct roofline levels" across every mesh, which works there and
       does not work here: a studio raise leaves the deco in many buckets, so
       every grammar scores 150+ and the number stops separating anything.
       The honest question is how far above the BARE SHELL the facade reaches
       and how many separate things it puts up there — a repainted box adds
       zero metres and nothing above the parapet, and no amount of counting
       meshes will hide that. */
    const shellTop = subject.storeys * 3.2;
    const aboveShell = heights.filter((y) => y > shellTop + 0.6).length;
    const uniq = Array.from(new Set(heights.filter((h) => h > 1))).sort((a, b) => a - b);
    // The light is fitted to what was ACTUALLY built, not to storeys x 3.2:
    // a minaret, a spire or a dome puts the real top far above the shell.
    const top = uniq.length ? uniq[uniq.length - 1] : subject.storeys * 3.2;
    S.light(subject, Math.max(top, subject.storeys * 3.2));
    /* FRAME OFF WHAT IS THERE, NOT OFF THE SHELL. A facade is allowed to
       project past its own footprint and most of them do — the mosque's
       portal steps, a portico, a porch, a buttress, a fire escape. The first
       pass framed on the nominal w x d box and cut the mosque's plinth off
       the bottom of the plate. Measure the group instead. The pad is the
       stage and is excluded: it is 13 m wider than the building on every
       side and would push every subject into the far distance. */
    holder.updateMatrixWorld(true);
    if (pad) pad.visible = false;
    const box = new T.Box3();
    g.traverse((o) => {
      if (!o.isMesh || !o.visible || o.name === "facadePad" || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      box.union(b);
    });
    if (pad) pad.visible = true;
    const c = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
    return {
      crownM: Math.round(Math.max(0, top - shellTop) * 10) / 10,
      aboveShell: aboveShell,
      roofTopM: uniq.length ? Math.round(uniq[uniq.length - 1] * 10) / 10 : 0,
      decoBoxes: Math.round(decoBoxes),
      realMeshes: realMeshes,
      triangles: Math.round(tris),
      box: { cx: c.x, cy: c.y, cz: c.z, sx: sz.x, sy: sz.y, sz: sz.z,
        minY: box.min.y, maxY: box.max.y, maxZ: box.max.z },
    };
  };

  // Render + read back in ONE synchronous call: the drawing buffer is not
  // preserved across a frame, so a toDataURL in a later evaluate is black.
  S.shoot = (c) => {
    // The build ships ACES tone mapping with an AUTO-EXPOSURE system on
    // toneMappingExposure (core/gfx.js). Left alone it drifts, and a
    // catalogue whose plates are exposed differently is comparing exposure.
    // Pin it on every shot; a facade is mostly pale stone and 1.0 clips it.
    try { r.toneMappingExposure = 0.86; } catch (e) {}
    const w = c.w || S.W, h = c.h || S.H;
    cam.aspect = w / h;
    cam.fov = c.fov || 38;
    cam.position.set(c.x, c.y, c.z);
    cam.lookAt(c.ax, c.ay, c.az);
    cam.updateProjectionMatrix();
    r.setSize(w, h, false);
    S._render(scene, cam);
    return r.domElement.toDataURL("image/jpeg", 0.92);
  };
  window.__fc = S;
  return "ready";
})()`;

/* ============================================================
   THE THREE TRIPODS. Every number here is solved from the SUBJECT and the
   LENS, not hand-tuned — the first pass used a fitted-by-eye distance formula
   and it cropped the head off every tower, which is the exact failure a
   catalogue cannot have. A frame is now derived:

     the subject's bounding sphere is R = half the diagonal of its MEASURED
     world box (so a minaret, a spire or a projecting portico is inside), and
     a camera at D = R / sin(fov/2) is guaranteed to contain it. The vertical
     half-angle is the binding one on a landscape frame, so that is the one
     solved; `pad` is kept just above 1: a value below it crops the plinth,
     because the box's bottom corners are exactly where the sphere is tight.

   ASPECT IS PART OF THE FRAMING. A 150 m tower in a landscape frame is a
   column of sky with a building in the middle of it; the same tower in a
   portrait frame fills it. So tower plates are shot portrait and the sheet
   letterboxes against the same sky colour, which is invisible in print.
============================================================ */
const FH = 3.2;
const D2R = Math.PI / 180;
/* `b` is the MEASURED world box of what was actually raised (see S.raise).
   Everything below is solved from it and from the lens — nothing is tuned.

   WHY NOT A BOUNDING SPHERE. Because a sphere is the worst-case orientation
   of the box, and almost no building is worst case: a 20 x 16 m house 12 m
   tall has a 28 m diagonal, so a sphere fit backs the camera off far enough
   to contain a 28 m ball and the house lands at 40% of the frame height with
   dead pavement all round it. Thirty-one plates of that is a catalogue you
   cannot judge anything from. So the eight corners are projected through the
   ACTUAL camera basis and the distance is bisected for the closest one that
   still holds every corner inside the frame. It fills the plate, and it can
   never crop, which the first two passes both managed to do. */
function fitDistance(b, dir, fovV, aspect, margin) {
  const corners = [];
  for (const i of [-0.5, 0.5]) for (const j of [-0.5, 0.5]) for (const k of [-0.5, 0.5]) {
    corners.push([b.cx + i * b.sx, b.cy + j * b.sy, b.cz + k * b.sz]);
  }
  const tv = Math.tan(fovV / 2) * margin;
  const th = Math.tan(fovV / 2) * aspect * margin;
  const fits = (D) => {
    const C = [b.cx + dir[0] * D, b.cy + dir[1] * D, b.cz + dir[2] * D];
    const f = [-dir[0], -dir[1], -dir[2]];
    // camera basis, exactly as THREE's lookAt builds it from up = +y
    let r = [f[2] * 0 - f[1] * 0 + (f[2] * 1 - 0), 0, 0];
    r = [f[2], 0, -f[0]];                       // cross(f, (0,1,0)) simplified
    const rl = Math.hypot(r[0], r[2]) || 1;
    r = [r[0] / rl, 0, r[2] / rl];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    for (const p of corners) {
      const v = [p[0] - C[0], p[1] - C[1], p[2] - C[2]];
      const z = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
      if (z < 0.25) return false;
      const x = v[0] * r[0] + v[1] * r[1] + v[2] * r[2];
      const y = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
      if (Math.abs(x) > th * z || Math.abs(y) > tv * z) return false;
    }
    return true;
  };
  const R = 0.5 * Math.hypot(b.sx, b.sy, b.sz);
  let lo = R * 0.4, hi = R * 30;
  if (!fits(hi)) return hi;                     // degenerate; take the wide shot
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }
  return hi;
}
function frame(b, o) {
  const fovV = (o.fov || 38) * Math.PI / 180;
  const aspect = o.w / o.hpx;
  const p = (o.pitch || 13) * Math.PI / 180, a = (o.az || 45) * Math.PI / 180;
  const dir = [Math.cos(p) * Math.sin(a), Math.sin(p), Math.cos(p) * Math.cos(a)];
  const D = fitDistance(b, dir, fovV, aspect, o.margin || 0.945);
  return {
    x: b.cx + dir[0] * D, y: b.cy + dir[1] * D, z: b.cz + dir[2] * D,
    ax: b.cx, ay: b.cy, az: b.cz, fov: o.fov || 38, w: o.w, h: o.hpx,
  };
}
/* Street level. Not a fit of the whole building — that is the hero's job, and
   on a tower it would put the eye 200 m back, which is not a pavement. This
   frames the BOTTOM of the building: enough width for the whole face plus a
   margin, and about 30 m of height, which is where the door, the podium and
   the base of the order live. Under 30 m it degenerates to the whole
   building, which is the right answer for a house. */
function streetCam(b, w, hpx) {
  const fovV = 55 * D2R;
  const aspect = w / hpx;
  const seeH = Math.min(b.sy * 1.06, 30);
  const halfW = b.sx * 0.62 + 2.5;
  const dW = halfW / Math.tan(2 * Math.atan(Math.tan(fovV / 2) * aspect) / 2);
  const dH = (seeH * 0.55) / Math.tan(fovV / 2);
  const dist = Math.max(dW, dH, 13);
  return { x: b.cx + b.sx * 0.22, y: 1.7, z: b.maxZ + dist,
    ax: b.cx, ay: Math.min(b.cy, seeH * 0.46), az: b.cz, fov: 55, w: w, h: hpx };
}
/* THE THIRD SHOT IS NOT THE SAME QUESTION ON A TOWER.

   On a block or a house the third plate is the REAR three-quarter, because
   that is where a stage-set facade is caught: everything spent on the door
   elevation, nothing round the back.

   A tower does not fail that way. Its grammar wraps all four faces by
   construction — you can already see two of them in the hero and they are the
   same — and a whole 130 m tower squeezed into a wide letterbox is a stamp.
   What a tower lives or dies on instead is its CROWN: at skyline distance the
   bottom 90% of a supertall is a shaft and the top is the entire identity.
   So towers spend the third plate looking up at the termination.
*/
function crownCam(b, w, hpx) {
  const ch = Math.min(b.sy * 0.30, Math.max(b.sx, b.sz) * 1.5);
  const top = { cx: b.cx, cy: b.maxY - ch * 0.42, cz: b.cz, sx: b.sx, sy: ch, sz: b.sz };
  return frame(top, { az: 45, pitch: -9, fov: 34, w: w, hpx: hpx, margin: 0.93 });
}

/* PLATE SIZES ARE THE LAYOUT'S SIZES, measured off the sheet below rather
   than picked. A shot rendered at one aspect and printed into a box of
   another either letterboxes (white bands that read as a rendering fault) or
   crops (the plinth again). So: the big box on a plate is 566x600 CSS px on
   a landscape-letter page — 462x600 on a tower plate, whose image column is
   narrower because a portrait shot in a wide column is limited by height and
   prints small — and each of the two stacked small boxes is 399x202. These
   are those, at print resolution. Change the CSS and change these together. */
const PX = {
  tower: { hero: [900, 1170], small: [1100, 556] },
  block: { hero: [1000, 1060], small: [1100, 556] },
  house: { hero: [1000, 1060], small: [1100, 556] },
};

/* ============================================================
   THE SAMENESS SHEET (--sameness).

   The catalogue answers "which of these do I want". This answers the question
   the catalogue provokes: WHY DO THIRTY-ONE CULTURES READ AS ONE CITY.

   The answer is not lighting and it is not the studio. It is that the facade
   kit is, by design, ADDITIVE ORNAMENT ON ONE SHELL — and the shell is built
   before dressFacade() ever runs (buildings.js:4652). So this sheet does the
   only honest thing: photographs the bare shell and six supposedly unrelated
   cultures dead-on from the same tripod at the same scale, and rules the
   shell's own constants across all seven.

     FH = 3.2 m                     buildings.js:100 — a MODULE constant, not
                                    a per-building value and not something a
                                    spec can set
     sill 0.55, header 0.45         buildings.js:4164, the office glazing band,
     bay pitch 1.5 m                on every storey of every face
     modern = storeys >= 3          buildings.js:3461 — the only thing that
                                    varies, and it varies on HEIGHT, not on
                                    what the building is
     one rectangular prism, w x d   there is no other plan form

   Every floor line lands on the same rule in every cell. That is the finding,
   and no amount of ornament above it can move it.

   The lens is 22 degrees from 46 m, which is near-orthographic: the rules are
   EXACT on the front wall plane and a shade generous for ornament standing in
   front of it. The ground is hidden so the horizon cannot be mistaken for a
   rule.
============================================================ */
const ELEV = { fov: 22, halfH: 9.2, aimY: 8.6, w: 820, hpx: 520 };
const SAME = [
  { id: null, label: "THE SHELL", note: "What all six of the others actually are. Everything past this point is applied to this." },
  { id: "mosque", label: "Grand Mosque", note: "Ottoman / Mughal" },
  { id: "pagoda", label: "Tiered Eaves", note: "East Asian" },
  { id: "adobe", label: "Pueblo Adobe", note: "Puebloan / Saharan" },
  { id: "gothic", label: "Gothic Revival", note: "Northern European medieval" },
  { id: "brick", label: "Chicago Loft", note: "American industrial" },
  { id: "victorian", label: "Second Empire", note: "French 19th century" },
];
function elevationCam(subject) {
  const dz = ELEV.halfH / Math.tan((ELEV.fov / 2) * Math.PI / 180);
  return { x: 0, y: ELEV.aimY, z: subject.d / 2 + dz,
    ax: 0, ay: ELEV.aimY, az: 0, fov: ELEV.fov, w: ELEV.w, h: ELEV.hpx };
}
// world height -> fraction down the plate. Exact on the front wall plane.
const yFrac = (y) => 0.5 - 0.5 * (y - ELEV.aimY) / ELEV.halfH;

async function sameness() {
  const dir = path.resolve(ROOT, "artifacts/facade-sameness");
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, "shots"), { recursive: true });
  await ensureServer();
  await launchChrome();
  const deadline = Date.now() + 180000;
  let ready = null;
  while (Date.now() < deadline && ready !== "ready") {
    ready = await evaluate(HARNESS).catch(() => null);
    if (ready !== "ready") await sleep(500);
  }
  if (ready !== "ready") throw new Error("page never exposed CBZ.facadeStudio");

  const subject = SUBJ.block;
  const cam = elevationCam(subject);
  const cells = [];
  for (const c of SAME) {
    /* THE BARE SHELL IS NOT WHAT AN UNDRESSED CALL GIVES YOU. FACADE_KIT_CITY
       defaults ON (facade_kit.js:109) and hands every undressed building a
       grammar by position hash — so the first pass photographed a mosque and
       captioned it "THE SHELL". The flag has to come off for that one raise,
       and go straight back on: an explicit dress always wins, so leaving it
       off would change nothing for the other six and it would still be a lie
       waiting for whoever reads this next. */
    if (!c.id) await evaluate(`CBZ.CONFIG.FACADE_KIT_CITY = false`);
    await evaluate(`window.__fc.raise(${JSON.stringify(c.id)}, ${JSON.stringify(subject)})`);
    if (!c.id) await evaluate(`CBZ.CONFIG.FACADE_KIT_CITY = true`);
    await evaluate(`window.__fc.ground(false)`);
    const dataUrl = await evaluate(`window.__fc.shoot(${JSON.stringify(cam)})`);
    const file = `shots/${c.id || "shell"}.jpg`;
    await writeFile(path.join(dir, file), Buffer.from(dataUrl.split(",")[1], "base64"));
    cells.push({ ...c, file });
    console.log("  " + (c.id || "shell"));
  }
  const htmlPath = path.join(dir, "index.html");
  await writeFile(htmlPath, sameHtml(cells));
  const pdfPath = path.join(dir, "one-city.pdf");
  await new Promise((resolve, reject) => {
    execFile(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu",
      "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
    ], { cwd: ROOT, timeout: 180000, maxBuffer: 1024 * 1024 }, (err) => err ? reject(err) : resolve());
  });
  console.log("wrote " + pdfPath);
}

function sameHtml(cells) {
  // buildings.js:4164 with modern = storeys >= 3 (buildings.js:3461)
  const FHc = 3.2, SILL = 0.55, HDR = 0.45, ST = 4;
  const rules = [];
  for (let k = 0; k <= ST; k++) {
    rules.push(`<i class="fl" style="top:${(yFrac(k * FHc) * 100).toFixed(3)}%">${k === 0 ? "0 m" : (k === ST ? "roof 12.8" : (k * FHc).toFixed(1))}</i>`);
  }
  for (let k = 0; k < ST; k++) {
    const t = yFrac(k * FHc + FHc - HDR), b = yFrac(k * FHc + SILL);
    rules.push(`<i class="wz" style="top:${(t * 100).toFixed(3)}%;height:${((b - t) * 100).toFixed(3)}%"></i>`);
  }
  const ruleHtml = rules.join("");
  const grid = cells.map((c) => `<figure class="cell${c.id ? "" : " shell"}">
      <div class="im"><img src="${c.file}">${ruleHtml}</div>
      <figcaption><strong>${esc(c.label)}</strong><span>${esc(c.note)}</span></figcaption>
    </figure>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>One City</title>
<style>
  @page { size: letter landscape; margin: 0.4in; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #17181a; background: #fff; }
  h1 { margin: 0; font-size: 30px; letter-spacing: -0.025em; }
  .lede { color: #55585e; margin: 7px 0 14px; max-width: 9.4in; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 9px; }
  .cell { margin: 0; }
  .im { position: relative; aspect-ratio: ${ELEV.w} / ${ELEV.hpx}; border: 1px solid #d6d9dd; overflow: hidden; background: #bcd2e8; }
  .im img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cell.shell .im { border: 2px solid #17181a; }
  /* the shell's own constants, ruled across every culture */
  .fl { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed #d92b2b;
    font-style: normal; font-size: 7px; color: #d92b2b; padding-left: 2px; line-height: 1; }
  .wz { position: absolute; left: 0; right: 0; background: rgba(217,43,43,0.11); }
  figcaption { font-size: 10px; line-height: 1.3; margin-top: 4px; display: flex; flex-direction: column; }
  figcaption span { color: #8a8d93; font-size: 9px; }
  .note { grid-column: span 1; align-self: stretch; font-size: 11px; color: #45484e;
    border-left: 3px solid #d92b2b; padding: 2px 0 2px 9px; }
  .note h4 { margin: 0 0 5px; font-size: 10px; letter-spacing: 0.11em; text-transform: uppercase; color: #17181a; }
  .note p { margin: 0 0 7px; }
  .note code { font-family: ui-monospace, Menlo, monospace; font-size: 10px; }
  .foot { margin-top: 12px; padding-top: 7px; border-top: 1px solid #d8dade; font-size: 10px; color: #8a8d93; }
</style>
<h1>Why thirty-one cultures read as one city</h1>
<p class="lede">Seven dead-on elevations, same tripod, same scale, ground hidden. The red rules are not drawn per building — they are the <b>shell's</b> constants, ruled at the same heights across all seven. Every culture's floors land on them, because the shell is built before the facade runs and the facade is only allowed to decorate it.</p>
<div class="grid">${grid}
  <div class="note">
    <h4>What is shared, in the source</h4>
    <p><code>FH = 3.2 m</code> — floor-to-floor, a module constant in <code>buildings.js:100</code>. Not a per-building value, not something a facade can set. A machiya has 2.4 m floors, a temple has bays instead of storeys, and a prayer hall has neither.</p>
    <p><code>sill 0.55 · header 0.45 · bay 1.5 m</code> — <code>buildings.js:4164</code>. The same glazing band on every storey of all four faces (the pink band above). The only thing that varies is <code>modern = storeys &gt;= 3</code> — it varies on <em>height</em>, not on what the building is.</p>
    <p>One rectangular prism, <code>w &times; d</code>. There is no courtyard, no compound, no wall, no gate — and a villa, a riad and a siheyuan are all <em>the void in the middle</em>, not the wall around it.</p>
    <p>One palette per district. Culture reads as colour at 100 m before it reads as ornament at 10 m.</p>
  </div>
</div>
<p class="foot">Rules are exact on the front wall plane (22&deg; lens at 46 m, near-orthographic); ornament standing proud of that plane projects a shade large. Generated by <code>tools/facade-catalog.mjs --sameness</code>.</p>`;
}

// ---------- run ----------
/* --html-only re-lays the sheet out of the catalog.json a previous run left
   behind, without booting a browser or re-photographing anything. Typography
   takes ten passes and re-rendering 93 plates for each of them is how you end
   up shipping the first layout you tried. */
async function relayout() {
  const { readFile } = await import("node:fs/promises");
  const entries = JSON.parse(await readFile(path.join(OUTDIR, "catalog.json"), "utf8"));
  const htmlPath = path.join(OUTDIR, "index.html");
  await writeFile(htmlPath, renderHtml(entries, entries.length));
  console.log("re-laid " + htmlPath);
  if (!opt["no-pdf"]) {
    const pdfPath = path.join(OUTDIR, "facade-catalog.pdf");
    await new Promise((resolve, reject) => {
      execFile(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu",
        "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
      ], { cwd: ROOT, timeout: 180000, maxBuffer: 1024 * 1024 }, (err) => err ? reject(err) : resolve());
    });
    console.log("wrote " + pdfPath);
  }
}

async function main() {
  if (opt.sameness) return sameness();
  if (opt["html-only"]) return relayout();
  await rm(OUTDIR, { recursive: true, force: true });
  await mkdir(path.join(OUTDIR, "shots"), { recursive: true });
  await ensureServer();
  console.log("serving " + baseUrl);
  await launchChrome();
  console.log("booting the page…");

  const deadline = Date.now() + 180000;
  let ready = null;
  while (Date.now() < deadline && ready !== "ready") {
    ready = await evaluate(HARNESS).catch(() => null);
    if (ready !== "ready") await sleep(500);
  }
  if (ready !== "ready") throw new Error("page never exposed CBZ.facadeStudio");

  const registered = await evaluate("JSON.stringify(CBZ.facadeList())");
  const REG = JSON.parse(registered);
  const byId = new Map(REG.map((f) => [f.id, f]));
  console.log("registry: " + REG.length + " facades");

  // The literal ORDER above is what numbers the plates, so it must not drift
  // from the registry. Say so loudly rather than quietly shipping a sheet
  // that is missing a facade the owner could have picked.
  const missing = REG.filter((f) => !ORDER.some((o) => o.id === f.id)).map((f) => f.id);
  const stale = ORDER.filter((o) => !byId.has(o.id)).map((o) => o.id);
  if (missing.length) console.error("!! registered but NOT in the sheet: " + missing.join(", "));
  if (stale.length) console.error("!! in the sheet but not registered: " + stale.join(", "));

  /* NUMBER IN LADDER ORDER, not in the order the literal happens to be
     written. A stable sort inside each era keeps a grammar's neighbours
     stable when one is added to a different era later. */
  const LADDER = ORDER.filter((x) => byId.has(x.id))
    .map((o, i) => ({ o: o, i: i }))
    .sort((a, b) => (ERAIDX[a.o.era] - ERAIDX[b.o.era]) || (a.i - b.i))
    .map((x) => x.o);
  const missingEra = LADDER.filter((o) => ERAIDX[o.era] == null).map((o) => o.id);
  if (missingEra.length) console.error("!! no era for: " + missingEra.join(", "));
  const plan = LADDER.filter((o) => !ONLY || ONLY.includes(o.id));
  const entries = [];
  let n = 0;
  for (const o of LADDER) {
    n++;                                   // the number counts the WHOLE sheet
    if (!plan.includes(o)) continue;
    const subject = SUBJ_OVERRIDE[o.id] || SUBJ[o.fam];
    const t0 = Date.now();
    const metrics = JSON.parse(await evaluate(`JSON.stringify(window.__fc.raise(${JSON.stringify(o.id)}, ${JSON.stringify(subject)}))`));
    // Frame off what was BUILT. roofTopM includes the spire, the minaret and
    // the dome; storeys x FH does not, and framing on the shell alone is how
    // a catalogue ends up with thirty-one buildings and ten decapitations.
    const B = metrics.box;
    const px = PX[o.fam];
    const cams = [
      ["hero", frame(B, { az: 45, pitch: o.fam === "tower" ? 8 : 13, fov: 38, w: px.hero[0], hpx: px.hero[1] })],
      ["street", streetCam(B, px.small[0], px.small[1])],
      ["back", o.fam === "tower"
        ? crownCam(B, px.small[0], px.small[1])
        : frame(B, { az: 225, pitch: 12, fov: 38, w: px.small[0], hpx: px.small[1] })],
    ];
    const shots = {};
    for (const [name, cam] of cams) {
      const dataUrl = await evaluate(`window.__fc.shoot(${JSON.stringify(cam)})`);
      const file = `shots/${String(n).padStart(2, "0")}-${o.id}-${name}.jpg`;
      await writeFile(path.join(OUTDIR, file), Buffer.from(dataUrl.split(",")[1], "base64"));
      shots[name] = file;
    }
    entries.push({ n, ...o, label: byId.get(o.id).label, subject, shots, metrics, portrait: o.fam === "tower" });
    console.log(`  ${String(n).padStart(2, "0")}  ${byId.get(o.id).label.padEnd(28)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const html = renderHtml(entries, REG.length);
  const htmlPath = path.join(OUTDIR, "index.html");
  await writeFile(htmlPath, html);
  await writeFile(path.join(OUTDIR, "catalog.json"), JSON.stringify(entries, null, 2));
  console.log("wrote " + htmlPath);

  if (!opt["no-pdf"]) {
    const pdfPath = path.join(OUTDIR, "facade-catalog.pdf");
    await new Promise((resolve, reject) => {
      execFile(CHROME, [
        "--headless=new", "--no-sandbox", "--disable-gpu",
        "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`,
        pathToFileURL(htmlPath).href,
      ], { cwd: ROOT, timeout: 180000, maxBuffer: 1024 * 1024 }, (err) => err ? reject(err) : resolve());
    });
    console.log("wrote " + pdfPath);
  }
}

/* ============================================================
   THE SHEET. Landscape letter, one page per facade, printed page numbers.
   Deliberately typographic and quiet: the plates are the content and a
   decorated report would compete with them.
============================================================ */
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function renderHtml(entries, regCount) {
  const index = ERAS.map(([key, label]) => {
    const set = entries.filter((e) => e.era === key);
    if (!set.length) return "";
    return `<section class="idxgroup"><h3>${label}<span>${set.length}</span></h3><div class="grid">` +
      set.map((e) => `<figure class="thumb"><div class="imgwrap"><img src="${e.shots.hero}"><b>${e.n}</b></div>
        <figcaption><strong>${esc(e.label)}</strong><span>${esc(e.id)}</span></figcaption></figure>`).join("") +
      `</div></section>`;
  }).join("");

  /* A cover with a hole in the middle of it is a cover nobody trusts. One
     row of the sheet's own plates, sampled evenly across the three families,
     says what the document is before a word of it is read. */
  const strip = (() => {
    const want = 9;
    const step = entries.length / want;
    const picks = [];
    for (let i = 0; i < want && entries.length; i++) picks.push(entries[Math.min(entries.length - 1, Math.round(i * step))]);
    return picks.map((e) => `<div><img src="${e.shots.hero}"><b>${e.n}</b></div>`).join("");
  })();

  const plates = entries.map((e) => {
    const s = e.subject;
    return `<article class="plate${e.portrait ? " portrait" : ""}">
      <header>
        <div class="num">${e.n}</div>
        <div class="ttl"><h2>${esc(e.label)}</h2>
          <p class="kick">${esc(ERALABEL[e.era] || "—")} &middot; ${FAMLABEL[e.fam]} &middot; <code>${esc(e.id)}</code> &middot; ${s.w}&times;${s.d} m, ${s.storeys} storeys${SUBJ_OVERRIDE[e.id] ? " (slim plan — this grammar's own)" : ""}</p></div>
      </header>
      <div class="body">
        <div class="big"><img src="${e.shots.hero}"><span class="cap">Three-quarter — the honest single frame</span></div>
        <div class="side">
          <p class="note">${esc(e.note)}</p>
          <p class="city"><em>As a city:</em> ${esc(e.city)}</p>
          <div class="smalls">
            <div><img src="${e.shots.street}"><span class="cap">From the pavement — the entrance</span></div>
            <div><img src="${e.shots.back}"><span class="cap">${e.fam === "tower" ? "The crown — the whole identity at skyline distance" : "Rear three-quarter — is it a stage set?"}</span></div>
          </div>
          <table class="met">
            <tr><td>Crown above the bare shell</td><td>+${e.metrics.crownM} m</td><td>Tallest point</td><td>${e.metrics.roofTopM} m</td></tr>
            <tr><td>Things breaking the roofline</td><td>${e.metrics.aboveShell}</td><td>Triangles</td><td>${e.metrics.triangles.toLocaleString("en-US")}</td></tr>
            <tr><td>Merged deco boxes <i>(free)</i></td><td>${e.metrics.decoBoxes}</td><td>Minted meshes <i>(not)</i></td><td>${e.metrics.realMeshes}</td></tr>
          </table>
        </div>
      </div>
      <footer><span>${esc(e.label)}</span><span>PICK BY NUMBER — <b>${e.n}</b></span></footer>
    </article>`;
  }).join("");

  return `<!doctype html><meta charset="utf-8"><title>Facade Catalogue</title>
<style>
  @page { size: letter landscape; margin: 0.4in; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #17181a; background: #fff; }
  h1, h2, h3 { margin: 0; font-weight: 700; letter-spacing: -0.01em; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  /* ---- cover ---- */
  .cover { display: flex; flex-direction: column; justify-content: center; min-height: 7.4in; padding: 0 0.3in; }
  .cover h1 { font-size: 54px; line-height: 1.02; letter-spacing: -0.03em; }
  .cover .sub { font-size: 19px; color: #55585e; margin-top: 14px; max-width: 7.6in; }
  .cover .how { margin-top: 30px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; border-top: 2px solid #17181a; padding-top: 18px; }
  .cover .how h4 { margin: 0 0 5px; font-size: 12px; letter-spacing: 0.10em; text-transform: uppercase; }
  .cover .how p { margin: 0; font-size: 12.5px; color: #45484e; }
  .cover .strip { margin-top: auto; padding-top: 26px; display: grid; grid-template-columns: repeat(9, 1fr); gap: 7px; }
  .cover .strip div { position: relative; aspect-ratio: 0.86; background: #fff; border: 1px solid #d6d9dd; overflow: hidden; }
  .cover .strip img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .cover .strip b { position: absolute; left: 0; top: 0; background: #17181a; color: #fff; font-size: 10px; padding: 1px 4px; min-width: 17px; text-align: center; }
  .cover .foot { margin-top: 16px; padding-top: 22px; font-size: 11.5px; color: #7a7d84; border-top: 1px solid #d8dade; }

  /* ---- index ---- */
  .idx h1 { font-size: 23px; }
  .idx > p { color: #55585e; margin: 5px 0 11px; max-width: 10in; font-size: 12px; }
  .idxgroup { margin-bottom: 8px; }
  .idxgroup h3 { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #17181a;
    border-bottom: 1.5px solid #17181a; padding-bottom: 3px; margin-bottom: 7px; display: flex; justify-content: space-between; }
  .idxgroup h3 span { color: #8a8d93; font-weight: 500; }
  .grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
  .thumb { margin: 0; }
  .imgwrap { position: relative; aspect-ratio: 1.72; overflow: hidden; background: #fff; border: 1px solid #d6d9dd; }
  .imgwrap img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .imgwrap b { position: absolute; left: 0; top: 0; background: #17181a; color: #fff; font-size: 11px;
    min-width: 19px; text-align: center; padding: 1px 4px; }
  .thumb figcaption { font-size: 8px; line-height: 1.2; margin-top: 2px; display: flex; flex-direction: column; }
  .thumb figcaption span { color: #8a8d93; font-family: ui-monospace, Menlo, monospace; font-size: 7.5px; }

  /* ---- plate ---- */
  .plate { page-break-after: always; height: 7.5in; display: flex; flex-direction: column; }
  .plate header { display: flex; align-items: flex-start; gap: 14px; border-bottom: 2px solid #17181a; padding-bottom: 7px; }
  .plate .num { font-size: 46px; font-weight: 800; line-height: 0.85; letter-spacing: -0.04em; }
  .plate h2 { font-size: 25px; }
  .plate .kick { margin: 3px 0 0; font-size: 11px; color: #6c6f75; letter-spacing: 0.03em; text-transform: uppercase; }
  .plate .kick code { font-family: ui-monospace, Menlo, monospace; text-transform: none; }
  .plate .body { display: grid; grid-template-columns: 1.42fr 1fr; gap: 14px; flex: 1; min-height: 0; padding-top: 10px; }
  /* A portrait hero contained in a wide column is limited by height and shows
     small; give the tower plates a squarer column so the tall shot is big. */
  .plate.portrait .body { grid-template-columns: 0.92fr 1fr; }
  .big { display: flex; flex-direction: column; min-height: 0; }
  .big img { width: 100%; flex: 1; min-height: 0; object-fit: cover; background: #fff; border: 1px solid #d6d9dd; }
  .side { display: flex; flex-direction: column; min-height: 0; }
  .note { margin: 0 0 7px; font-size: 12.5px; }
  .city { margin: 0 0 9px; font-size: 12px; color: #45484e; background: #f2f3f5; border-left: 3px solid #17181a; padding: 6px 8px; }
  .city em { font-style: normal; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 10px; }
  /* STACKED, not side by side. Two 195 px columns made every street shot
     a stamp; the side column's full width is where they can be read. */
  .smalls { display: grid; grid-template-rows: 1fr 1fr; gap: 8px; flex: 1; min-height: 0; }
  .smalls div { display: flex; flex-direction: column; min-height: 0; }
  .smalls img { width: 100%; flex: 1; min-height: 0; object-fit: cover; background: #fff; border: 1px solid #d6d9dd; }
  .cap { font-size: 9px; color: #8a8d93; margin-top: 3px; letter-spacing: 0.02em; }
  .met { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 9px; font-size: 10px; }
  .met td { border-top: 1px solid #dfe1e5; padding: 3px 2px; color: #45484e; }
  .met td:nth-child(1), .met td:nth-child(3) { width: 33%; }
  .met td:nth-child(2) { padding-right: 12px; }
  .met td:nth-child(2), .met td:nth-child(4) { text-align: right; font-weight: 700; color: #17181a; }
  .met i { color: #9a9da3; font-style: normal; }
  .plate footer { display: flex; justify-content: space-between; border-top: 1px solid #d8dade; margin-top: 8px;
    padding-top: 5px; font-size: 10px; color: #8a8d93; letter-spacing: 0.05em; text-transform: uppercase; }
</style>
<div class="page cover">
  <h1>Every facade,<br>Stone Age to near future.</h1>
  <p class="sub">Every grammar the kit has, in chronological order, photographed from three angles on the same shell within its size class. The eight eras the kit had no answer for were written for this sheet — and most of them were unbuildable until a facade could tell the shell to hand over the wall plane, because almost none of them have glazing.</p>
  <div class="how">
    <div><h4>Three-quarter</h4><p>The honest single frame: entrance face and one flank at once, so ornament applied only to the front cannot hide.</p></div>
    <div><h4>Who owns the wall</h4><p>A grammar now declares it. <b>keep</b> — the shell glazes as always, and its real furnished rooms show through. <b>frame</b> — punched masonry openings to set piers and arches around. <b>own</b> — solid wall, no glazing, and the culture&rsquo;s own openings, or none at all.</p></div>
    <div><h4>From the pavement</h4><p>Where a player actually meets the building. Judges the door, the reach, and whether it still reads from underneath.</p></div>
    <div><h4>Rear three-quarter</h4><p>The cheat detector: a facade that spent everything on the door elevation looks fine in the other two frames and empty here. On tower plates this frame is the crown instead — a tower wraps all four faces by construction, and what it lives on is how it ends.</p></div>
  </div>
  <div class="strip">${strip}</div>
  <p class="foot">${regCount} registered, ${entries.length} plated &middot; one hard key light, shadows on, neutral pad, no city &middot; towers 34&times;28 m at 40 storeys, blocks 22&times;16 m at 4, houses 15&times;11 m at 2 &middot; generated by <code>tools/facade-catalog.mjs</code></p>
</div>
<div class="page idx">
  <h1>The ladder</h1>
  <p>Ordered by era, oldest first; numbers run straight through the ladder, so <b>“I want 4, 9, 17 and 22”</b> means the same four buildings next week. Each grammar is photographed on the subject its size class uses — houses at 15&times;11 m, blocks at 22&times;16 m, towers at 34&times;28 m over 40 storeys — so a bungalow is never compared against a supertall. Full plate for each on the pages that follow.</p>
  ${index}
</div>
${plates}`;
}

main().then(async () => {
  if (chromeProc) chromeProc.kill("SIGKILL");
  if (serverProc) serverProc.kill("SIGKILL");
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}).catch(async (e) => {
  console.error(e.message);
  if (chromeProc) chromeProc.kill("SIGKILL");
  if (serverProc) serverProc.kill("SIGKILL");
  process.exit(1);
});
