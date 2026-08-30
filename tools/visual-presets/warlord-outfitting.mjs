/*
  warlord-outfitting.mjs — OUTFITTING A WARBAND, photographed as a SHAPE.

  DESERT WARLORD's outfitting wave is two halves of one idea: an outpost is
  FINITE STOCK AT A PRICE, and AUTO-ARM deals the whole pile out best-to-best
  instead of first-come. Both halves revert behind one flag, `?outfit=old`,
  so the before side of this run is the same checkout with that one switch
  thrown — not a deployed build that differs by every commit since.

  What the before side actually was:
    · every depot carried every gun in the armoury, 99 deep, so "stock" was
      a word on a label and the map was not worth crossing twice
    · AUTO-ARM walked the roster in array order and handed out whatever the
      cart iterated next, so the AK went to whoever sat at index 0

  The numbers this run gates on:
    armyPower    what the same guns and the same men are worth after arming
    menArmed     how many of them are holding anything
    cartLeft     guns still lying in the baggage train afterwards
    crateDepth   units of gun sitting in ONE depot's crates
    crateLines   distinct guns that depot deals in at all

  And the pictures answer what no number can: whether a table of prices is
  readable at 393pt with the fixed MEN/$/DAY strip on top of it, and whether
  AUTO-ARM tells you what it did.
*/

export default {
  id: "warlord-outfitting",
  title: "Desert Warlord — the depot, the camp, the armoury, the lobby",
  description:
    "The outfitting half of DESERT WARLORD across a phone, a small phone and a laptop. Before is this same " +
    "checkout with ?outfit=old — infinite flat depot stock and a first-come AUTO-ARM. After is the wave: " +
    "finite crates priced off the weapon records, and a distribution that is the provable maximum.",
  page: "games/warlord.html",

  // FLAG A/B, one flag, both halves of the wave. The world is pinned to one
  // seed so both sides get the identical island, the identical crate list and
  // the identical 26 men — the only difference on the wire is `outfit`.
  defaultBefore: "local",
  urlParams: { seed: 1337 },
  beforeParams: { outfit: "old" },
  beforeLabel: "BEFORE · ?outfit=old (infinite stock, first-come arming)",
  afterLabel: "AFTER · the outfitting wave",
  pairNote: "Same checkout, same seed, same 26 men — one flag is the variable",

  // Two phone widths and a laptop. iphone-se is in the list because 320pt is
  // where a two-column price table and a labelled form actually break, and
  // neither of those breakages is visible at 393.
  frameList: ["iphone-se:portrait", "iphone-16:portrait", "laptop"],

  // The shell sets this only after every module has booted. Waiting on the
  // modules themselves rather than on a timer means a slow cold studio load
  // cannot photograph a half-built page.
  readyExpression:
    "window.__warlordReady === true && window.CBZ && CBZ.warlord && CBZ.warlord.outpost && CBZ.warlord.loadout && CBZ.warlord.warnet",
  stageTimeoutMs: 180000,

  method:
    "One page per side per device frame; the five subjects are a storyboard driven through the module API " +
    "(W.outpost.open, W.loadout.open, W.loadout.autoArm, W.warnet.lobby) rather than through URL params, " +
    "because subjects share a page and only the flag may differ between the sides. The warband and the " +
    "island are built once from seed 1337 and every stock number is hashed off position, never off the RNG " +
    "stream, so throwing the flag cannot change the men or the crates being photographed.",
  defaultFocus:
    "Is the crate list finite and readable under the fixed strip, and does AUTO-ARM move the strength number AND say why?",

  subjects: [
    { id: "arms-depot", label: "Arms depot", act: "depot",
      focus: "Finite crates, prices off the weapon records, and what each gun actually does." },
    { id: "recruit-camp", label: "Recruit camp", act: "camp",
      focus: "Men by tier, a finite pool, and the wage each one adds to every dawn." },
    { id: "armoury-before", label: "Armoury, before AUTO-ARM", act: "armouryBefore",
      focus: "The starting distribution: half the army holding nothing, rifles in the cart." },
    { id: "armoury-after", label: "Armoury, after AUTO-ARM", act: "armouryAfter",
      focus: "The strength number, the delta, and the report saying which gun went to which tier." },
    { id: "multiplayer-lobby", label: "Multiplayer lobby", act: "lobby",
      focus: "Name, server, seed — and the instructions for the one command that starts a server." },
  ],

  metrics: {
    armyPower: { label: "Army strength after arming", unit: "power", better: "higher" },
    menArmed: { label: "Men holding a weapon", unit: "men", better: "higher" },
    cartLeft: { label: "Guns left unassigned in the cart", unit: "guns", better: "lower" },
    crateDepth: { label: "Units of gun in one depot's crates", unit: "units", better: "lower" },
    crateLines: { label: "Distinct guns a depot deals in", unit: "lines", better: "lower" },
    contentOverflow: { label: "Screen content below the fold", unit: "px", better: "lower" },
    hudOverlap: { label: "Fixed strip overlapping the screen title", unit: "px", better: "lower" },
  },
  metricsNote:
    "Measured live in the page. armyPower is W.yourPower() (core's own number, army plus you); menArmed counts " +
    "men whose weapon id is not \"fists\". crateDepth and crateLines are read off the first ARMS DEPOT's own " +
    "stock table. hudOverlap is the pixel overlap between the fixed #hud strip and the screen's <h1>, which is " +
    "the layout bug the first run of this preset found at 393pt and is the reason the number is declared at all.",

  // A named function expression: the runner ships this through stage.toString(),
  // and a shorthand method does not survive being wrapped in parentheses.
  stage: async function stageWarlordOutfitting(input) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const W = window.CBZ && window.CBZ.warlord;
    if (!W) return { ok: false, error: "CBZ.warlord missing" };

    // ---- the world, built once and shared by every subject on this page.
    // newGame reseeds core's stream, THEN the island is placed, THEN the
    // fixture warband is built off positional hashes — an order both sides
    // walk identically because no flag in this wave consumes a random number.
    if (!W.state.outposts.length) {
      W.newGame({ seed: 1337 });
      W.outpost.place(9);
      W.loadout.demo();
      W.state.gold = 1200;
      W.emit("gold", W.state.gold);
    }
    const depot = W.outpost.list().filter((o) => o.kind === "depot")[0] || W.outpost.list()[0];
    const camp = W.outpost.list().filter((o) => o.kind === "camp")[0] || depot;

    const act = input.subject.act;
    if (act === "depot") W.outpost.open(depot);
    else if (act === "camp") W.outpost.open(camp);
    else if (act === "armouryBefore") W.loadout.open();
    else if (act === "armouryAfter") { W.loadout.autoArm(); W.loadout.open(); }
    else if (act === "lobby") { W.setPhase("menu"); W.warnet.lobby(); }

    // AUTO-ARM then open: loadout.js keeps its last report until the screen
    // is LEFT, so the "what it did" card is on the photographed frame.
    await sleep(320);

    const stage = document.getElementById("stage");
    if (stage) stage.scrollTop = 0;
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    await sleep(220);

    // ---- measurements
    let crateDepth = 0, crateLines = 0;
    for (const id in depot.stock) { crateLines++; crateDepth += depot.stock[id]; }

    let menArmed = W.state.you.wid && W.state.you.wid !== "fists" ? 1 : 0;
    for (let i = 0; i < W.state.army.length; i++) {
      const s = W.state.army[i];
      if (s.wid && s.wid !== "fists") menArmed++;
    }
    let cartLeft = 0;
    for (const k in W.state.baggage) cartLeft += W.state.baggage[k];

    /* HUD OVERLAP. #hud is position:fixed at the top of the page and #stage's
       own padding is 18px, so at phone width the persistent MEN/$/DAY strip
       sat directly on top of every screen's title. Measured as the vertical
       overlap of the two boxes; 0 means the title clears the strip. */
    const hud = document.getElementById("hud");
    const h1 = stage ? stage.querySelector("h1") : null;
    let hudOverlap = 0;
    if (hud && h1 && hud.classList.contains("on")) {
      const a = hud.getBoundingClientRect(), b = h1.getBoundingClientRect();
      hudOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    }
    const contentOverflow = stage ? Math.max(0, stage.scrollHeight - stage.clientHeight) : 0;

    return {
      ok: true,
      act: act,
      frame: input.frame ? input.frame.id : null,
      outpost: act === "depot" ? depot.name : act === "camp" ? camp.name : null,
      metrics: {
        armyPower: Math.round(W.yourPower()),
        menArmed: menArmed,
        cartLeft: cartLeft,
        crateDepth: crateDepth,
        crateLines: crateLines,
        contentOverflow: contentOverflow,
        hudOverlap: hudOverlap,
      },
    };
  },
};
