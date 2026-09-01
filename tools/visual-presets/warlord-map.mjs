/* WARLORD MAP — the strategic map, against the flat one it replaced.

   THE ASK, in the owner's words: "a multiplayer option like open front.io …
   ultra simple mechanics, made for multiplayer — it's almost like
   openfront.io met Bannerlord."

   OpenFront's whole appeal is one picture: a map where you can see who owns
   what and watch it change. src/warlord/territory.js is that picture, and
   this preset photographs whether the picture actually reads.

   THE A/B IS A FLAG, NOT A DEPLOY. Both sides are this checkout. The before
   side boots with ?terr=off — territory.js's own one-word revert — which
   leaves campaign.js's original world map on the MAP button: the real
   island, painted, with dots on it and no notion of ownership at all. The
   after side is the default. So every pixel of difference is this wave and
   nothing else; no deployed build, no forty other commits.

   WHAT THE SUBJECTS ARE. Three moments of one campaign, on the same seed and
   therefore the same island — day one (five faction homes, seventeen
   holdings free), mid campaign (a genuinely contested island), and late (you
   hold half of it) — plus one holding at zoom, where a border either reads
   as a wandering frontier or as the 52 m raster it is actually made of. That
   last subject is not decoration: the first two runs of this preset failed
   on it, once because Chaikin does not remove a staircase and once because
   the ownership wash was drawn under a border it did not line up with.

   The phone frame is in frameList rather than optional, because "ultra
   simple controls" is a hard requirement of this game and a strategic map is
   the screen most likely to break at 393 pt. It did: the header wrapped and
   shoved FIT/CLOSE onto a second row, and the island's east coast ran off
   the side.

   THE NUMBERS say whether the map is doing its job at all — how many
   holdings it can name, how many warlords are legible on it, how much of the
   screen the map surface actually uses, and how many names it managed to
   place without one landing on another. The pictures say whether it is any
   good. Both, always: a metric only checks what I already thought of when I
   wrote it, and "the frontier looks like a staircase" was not on that list. */

export default {
  id: "warlord-map",
  title: "The island, and who owns it",
  page: "games/warlord.html",
  description:
    "DESERT WARLORD's strategic map photographed against its own revert flag. BEFORE is ?terr=off — campaign.js's " +
    "original world map, the painted island with dots on it. AFTER is territory.js: the island cut into 22 holdings " +
    "derived from its own geography and from the seed alone, owned, bordered, garrisoned and named. Same checkout, " +
    "same seed, same island; the flag is the only difference.",

  defaultBefore: "local",
  beforeParams: { terr: "off" },
  beforeLabel: "BEFORE · ?terr=off (campaign's flat map)",
  afterLabel: "AFTER · TERRITORY",
  urlParams: { seed: 1337 },
  // the after side's first subject generates 22 regions off 102k raster cells
  // and both sides raise a 14 km island; 60 s is not enough for the first one
  stageTimeoutMs: 600000,

  readyExpression: "!!window.__warlordReady",

  // A laptop for the shape the map is designed at, and a real phone frame
  // because that is where a strategy UI dies.
  frameList: ["laptop", "iphone-16:portrait"],

  pairNote: "Same island, same seed, same build — ownership is the variable",
  method:
    "Both sides are this checkout. The before side adds ?terr=off, territory.js's own revert flag, which leaves " +
    "campaign.js's world map on the MAP button. Each subject drives the page from the title card: new game on seed " +
    "1337, raise the island, then open whichever map the build has. The three campaign moments are painted by " +
    "W.territory.demo(stage), which is hashed off the seed rather than rolled, so day one / mid / late are three " +
    "moments of ONE island rather than three different islands.",
  defaultFocus:
    "Can you tell who owns what in one look, and does a border read as a frontier or as a raster?",

  subjects: [
    { id: "day-one", label: "Day one — an empty island",
      stage: "day1", view: "fit",
      focus: "THE OPENING POSITION. Five factions on one holding each and seventeen unclaimed — the map has to show " +
             "you what there is to take, which means every frontier must read even where nobody owns anything. The " +
             "first run of this preset failed exactly here: the unclaimed hairlines vanished into the dune shading " +
             "and the island read as one blob with five patches on it." },
    { id: "mid-campaign", label: "Mid campaign — a contested island",
      stage: "mid", view: "fit",
      focus: "THE PICTURE THE WHOLE FILE EXISTS FOR. Six warlords, twenty-two holdings, borders drawn in both sides' " +
             "colours. Look for whether you can separate YOUR orange from SAND BANDITS — core's banner red is five " +
             "degrees of hue away from it and the map keeps its own palette because of it." },
    { id: "late-conquest", label: "Late — you hold half of it",
      stage: "late", view: "fit",
      focus: "THE PAYOFF, and the share bar under the header is the test: one strip, one block per warlord, width = " +
             "ground held. Who is winning has to be readable without reading a word." },
    { id: "one-holding", label: "One holding, at zoom",
      stage: "mid", view: "focus",
      focus: "THE BORDER ITSELF. The regions are a raster underneath — 52 m a cell — and at this zoom a naive render " +
             "shows ten-pixel stairs down every frontier, which is the 'grid on sand' look the whole scheme exists " +
             "to avoid. It should read as a wandering line, with the holding's coast drawn in its owner's colour " +
             "and its income printed under its name." },
  ],

  metrics: {
    regions: { label: "Holdings the map can name", unit: "regions", better: "higher" },
    ownersVisible: { label: "Warlords with ground on the island", unit: "warlords", better: "higher" },
    mapFillPct: { label: "Screen the map surface covers", unit: "%", better: "higher" },
    labelsDrawn: { label: "Place names placed without a collision", unit: "names", better: "higher" },
    tapTargets: { label: "Things on the map you can tap and act on", unit: "targets", better: "higher" },
    /* NO DIRECTION ON THIS ONE, AND THAT IS A CORRECTION. It was declared
       better:"lower" against a BEFORE side that structurally reports 0 —
       ?terr=off has no ownership state to send — so `--gate` read "the
       feature does not exist" as the winning column and failed the run for
       every subject. The note below already said this row "reads as a tie
       rather than a win"; the declaration did not say it. A metric whose
       before side cannot participate is a READING, not a race. */
    wireBytes: { label: "Bytes of map state a client has to be sent", unit: "B" },
  },
  metricsNote:
    "Measured live in the page at each frame. mapFillPct is the map surface's border box against the viewport — " +
    "campaign.js's map is a 512 px card in a modal, territory's is the screen. labelsDrawn is read off the renderer's " +
    "own anti-collision pass (it reports how many names it wanted and how many it could fit), so it measures the " +
    "shipped rule rather than a re-implementation of it. wireBytes is the whole ownership state as JSON — the only " +
    "thing multiplayer ever has to send, because the regions are derived from the seed on every client; the before " +
    "side has no such state and reports 0, which is why that row reads as a tie rather than a win.",

  stage: async function stageWarlordMap(input) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const W = window.CBZ && window.CBZ.warlord;
    if (!W) return { ok: false, error: "CBZ.warlord missing" };
    const T = W.territory;
    const live = !!(T && T.regions && typeof T.open === "function" && !/(\?|&)terr=off/.test(location.search));

    // ---- one island, one seed, both sides ----------------------------------
    if (W.phase() === "menu" || W.phase() === "boot") {
      W.newGame({ seed: 1337 });
    }

    if (live) {
      /* THE AFTER SIDE. The regions are a pure function of the seed, so the
         map can be raised without ever riding the island — which is also the
         reason ?map=1 exists in territory.js. demo() paints the moment. */
      T.close();
      T.demo(input.subject.stage);
      T.open();
      await sleep(260);
      if (input.subject.view === "focus") {
        // a holding somebody actually owns, so the picture has a border in it
        const owned = T.regions.filter((r) => T.owner(r.id)) ;
        const pick = owned.length ? owned[Math.floor(owned.length / 2)] : T.regions[0];
        T.focus(pick.id);
        await sleep(420);
      }
      await sleep(700);
    } else {
      /* THE BEFORE SIDE. campaign.js's map only exists once the campaign has
         been entered — it is built with the rest of the campaign HUD — so
         this has to raise the real island and wait for it. */
      if (W.phase() !== "campaign" && W.campaign && W.campaign.enter) W.campaign.enter();
      for (let i = 0; i < 200; i++) {
        if (document.getElementById("wlMapBtn")) break;
        await sleep(120);
      }
      await sleep(900);
      /* campaign.map() is a TOGGLE, and subjects run in declaration order in
         ONE page - so the first draft opened the map for subject one, CLOSED
         it for subject two and opened it again for three. Two of the four
         before frames were photographs of a man standing in a sandstorm. Ask
         the DOM whether it is already up instead of assuming. */
      const mw = document.getElementById("wlMap");
      if (mw && !mw.classList.contains("on") && W.campaign && W.campaign.map) W.campaign.map();
      await sleep(900);
    }

    // ---- the numbers -------------------------------------------------------
    const vw = window.innerWidth, vh = window.innerHeight;
    let surface = null;
    if (live) surface = document.getElementById("wlTerrCv");
    else {
      const box = document.getElementById("wlMapC");
      surface = box || null;
    }
    const rect = surface ? surface.getBoundingClientRect() : null;
    const mapFillPct = rect ? (rect.width * rect.height) / Math.max(1, vw * vh) * 100 : 0;

    let regions = 0, ownersVisible = 0, labelsDrawn = 0, tapTargets = 0, wireBytes = 0;
    if (live) {
      regions = T.regions.length;
      const ids = T.ownerList();
      for (let i = 0; i < ids.length; i++) if (T.held(ids[i]).length) ownersVisible++;
      labelsDrawn = (T.lastLabels && T.lastLabels.drawn) || 0;
      tapTargets = T.regions.length;
      try { wireBytes = JSON.stringify(T.snapshot()).length; } catch (e) { wireBytes = 0; }
    }

    return {
      ok: true,
      stageName: input.subject.stage,
      live,
      frame: input.frame ? input.frame.id : null,
      metrics: {
        regions,
        ownersVisible,
        mapFillPct,
        labelsDrawn,
        tapTargets,
        wireBytes,
      },
    };
  },
};
