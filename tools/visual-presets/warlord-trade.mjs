/* DESERT WARLORD — TRADING IS WALKING UP TO A MAN, NOT OPENING A SPREADSHEET.

   OWNER, mid-match, and this is the thing that made him stop playing:

       "I GET A MAN WITHA CRATE POPU PU IN GAME WHITUOT A FUCKING MAN IN FRONT
        OF ME AND IT COVERS THE SCREEN, RUNING THEFUCKING GAME ... RN WE AHVE
        BARREN DESERT AND MAN WITHA CRATE POPUP WITH NO MAN THERE"

   TWO FAILURES IN ONE SENTENCE AND THEY ARE DIFFERENT FAILURES.

   1. IT COVERED THE SCREEN. Measured on origin/main at seed 1337 with a depot
      open: 823 px of markup crammed into a strip capped at 464, 789 characters
      to read, 23.5% of a 1280×800 laptop and 52.8% of an iPhone 16 — and TWO
      of the nine crate rows visible, because the top two thirds of the panel
      were furniture. It printed the outpost's name again at 32 px under a
      header that already said it, then its kind line again, then a paragraph,
      then BUY / SELL tabs duplicating the BUY / SELL verbs six centimetres
      below, and it ended with RIDE ON and ARMOURY buttons duplicating the
      other two. CONTRACT.md's first law is that the campaign clock NEVER
      PAUSES, so half a phone of panel is half a phone of a world that is
      still happening — in a match, a way to be attacked while reading.

   2. IT ANNOUNCED A MAN WHO WAS NOT THERE, AND HE WAS RIGHT TWICE OVER.

      The words first. Every kind opened with a sentence about the world:
      "crates off a boat", "men at the water, looking for a warlord", "lamps,
      tarpaulin, and a man who does not ask where you got it." The world at an
      outpost is five boxes and a flag on a mast. outpost.js owns no meshes;
      every sentence it wrote about the world was a claim it had no way to
      check, and the player was looking straight at it.

      Then the literal reading, which is the real bug and was found by trying
      to photograph this pair and getting a blank gradient behind the panel on
      every frame. RIDING UP TO AN OUTPOST DELETED THE WORLD. open() claimed
      the "outpost" phase (campaign.js sets it too, one line earlier); core.js
      fires phase:leave:campaign; campaign.js answers that with
      `live = false; showAll(false)`, which hides its own root — you, your
      column, every band, the outpost's own huts and mast — hides the campaign
      HUD, hides the controls, and calls W.desert.hide(). The island is
      switched off. What is left behind the panel is the sky dome: a smooth,
      empty, sand-coloured gradient. THAT is "barren desert", and there was
      never a man there because there was never anything there.

      A phase is a claim that one module owns the screen and the rail does not
      own the screen, so it stops claiming one — CONTRACT.md already names the
      pattern for things that happen OVER the campaign. `worldLit` counts it:
      the island group and the campaign group, lit or not. 0 before, 2 after,
      on every subject and every frame.

   WHAT THE AFTER COLUMN IS. One row is one BUTTON and the button IS the
   readout: its background fills from the left by how much of the shelf is
   left (finite stock, the whole design of that file, as a thing you watch
   drain under your thumb instead of the words "6 LEFT"); a 2 px hairline
   along the bottom is what that gun is worth IN A FIGHT, W.gunCombat scaled
   across the entire armoury, replacing "×0.84 IN A FIGHT · DMG 21 · 72M" on
   every row of every list; and the price is a chip inside the button you
   press to buy it. Each kind is tinted its own colour, so a depot, a camp, a
   well and the night market are four different places with the words covered.

   THE BEFORE SIDE IS THE DEPLOYED CODE — a second checkout of origin/main
   served on :9731 — not a flag.

   ONE REPAIR IS ON BOTH SIDES OF THE PAIR AND IT IS NOT COSMETIC. origin/main
   at e8f2040 DOES NOT BOOT: deleting the desert scatter took `let scCX, scCZ`
   with it and left `scCX = scCZ = NaN;` in desert.js's build(), which under
   "use strict" is a ReferenceError thrown before CBZ.scene.add(root) — the
   island is never added to the scene and W.phase() sits on "boot" forever.
   Nothing at all runs. It is fixed in the after tree and the identical
   one-line deletion is applied to the before checkout, because a before side
   that cannot boot cannot be photographed. Every other difference in this
   pair is outpost.js.

   WHAT TO LOOK FOR
     · the phone — before: the rail is half the screen and you can see two
       crate rows. after: six rows, a shorter rail, and island above it.
     · every row — before: two lines of stats per row. after: a bar that is
       the stock and a hairline that is the gun.
     · the well — before: a paragraph, a per-tier table of the wounded and a
       REST button inside the panel. after: one bar and a verb with the bill
       on it. 45.4% of a phone became 18.3%.
     · the market — the fourth kind, which campaign.js never actually places
       (see the report): built here through outpost.js's own build().
     · BEHIND THE PANEL, on every single pair. Before: nothing. After: the
       island, the sea, the depot's five huts and the flag on its mast, the
       player standing on the sand, and a day that is still turning.
*/

const subjects = [
  { id: "depot", kind: "depot", tab: "buy",
    label: "An Arms Depot — What Is In The Crate",
    focus: "Nine lines of stock. Before: a name printed twice, a paragraph about a boat, a duplicate tab row, and two visible rows out of nine. After: the crate, six rows deep, each row a button whose fill is how much of that shelf is left and whose hairline is what the gun is worth in a fight." },

  { id: "cart", kind: "depot", tab: "sell", cart: true,
    label: "Selling The Loot — The Same Rail, The Other Way",
    focus: "What a depot pays for a cart of looted guns. The rate that used to be a heading sentence is a chip on the label; the rows are the same component, filled by how big each stack in your cart is." },

  { id: "camp", kind: "camp",
    label: "A Recruit Camp — Men, Finite",
    focus: "Before: four rows of HP / ACC / WAGE / what he arrives carrying, under a paragraph about payroll that the top strip already shows. After: four men, four prices, and a hairline that is soldierPower's own man term — how good he is with nothing in his hands." },

  { id: "well", kind: "well", hurt: true,
    label: "A Well — One Bar, One Verb",
    focus: "A well has exactly one thing to say and it used to take a paragraph, a per-tier table of the wounded and a REST button buried in the panel. After: fit against hurt as one stacked bar, and REST is a verb with the bill as its chip." },

  { id: "market", kind: "market",
    label: "The Night Market — The Fourth Kind",
    focus: "Triple list price, the top of the armoury on demand, and 55c on the dollar for your surplus. Its own colour, so it is not a depot with different numbers. NOTE: campaign.js never places one of these in a real campaign — this is built through outpost.js's own build()." },
];

async function stageTrade(input) {
  const CBZ = window.CBZ, sub = input.subject;
  if (!CBZ || !CBZ.warlord) return { ok: false, missing: "warlord" };
  // read by the metrics hook, which is sampled after this function has returned
  window.__wlTradeKind = sub.kind;
  const W = CBZ.warlord;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (!window.__cbzVisualCompare) {
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.renderer && CBZ.camera) { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} }
        await new Promise((r) => setTimeout(r, 700));
      },
      /* THE MEASUREMENTS.

         `coverPct` is the owner's first complaint as a number: a rail is
         furniture, a lid is a bug, and the difference is what fraction of the
         viewport it eats.

         `chars` and `prose` are "less words, more show" as two numbers. chars
         is everything a player's eye lands on in the rail, digits included;
         prose is only the running sentences — a text node of 25 characters or
         more with real lowercase words in it — because a price is not prose
         and should not be able to launder a paragraph.

         `rowsSeen` is the one that has to go UP, and it is why the other
         three going down is not just deletion: how many rows of the crate (or
         the pool) you can actually READ without scrolling. Two out of nine
         was the before.

         `unreachable` is measured by hit test, not by bounding box: a button
         drawn under another fixed layer is on screen, is the right size, and
         cannot be pressed. Controls scrolled out of their own panel are not
         counted at all — they are not on screen to be reached. Same test
         tools/warlord-fits.mjs makes, cut down to this frame. */
      metrics() {
        const box = document.getElementById("verbs");
        const m = { controls: 0, unreachable: 0, offScreen: 0, coverPct: 0,
                    chars: 0, prose: 0, rowsSeen: 0 };
        if (!box || !box.classList.contains("on")) return m;
        const vw = window.innerWidth, vh = window.innerHeight;

        // a rect is "on screen" only if no ancestor scroller has clipped it away
        const clipped = (el, r) => {
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
              const pr = p.getBoundingClientRect();
              if (r.bottom > pr.bottom + 0.5 || r.top < pr.top - 0.5) return true;
            }
          }
          return false;
        };

        const btns = box.querySelectorAll("button");
        for (let i = 0; i < btns.length; i++) {
          const el = btns[i], r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          if (clipped(el, r)) continue;
          m.controls++;
          if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) m.offScreen++;
          const hit = document.elementFromPoint(
            Math.max(1, Math.min(vw - 1, r.left + r.width / 2)),
            Math.max(1, Math.min(vh - 1, r.top + r.height / 2)));
          if (hit && hit !== el && !el.contains(hit)) m.unreachable++;
        }

        const vin = box.querySelector(".vin");
        if (vin) {
          const r = vin.getBoundingClientRect();
          m.coverPct = Math.round((r.width * r.height) / (vw * vh) * 1000) / 10;
        }

        m.chars = (box.textContent || "").replace(/\s+/g, " ").trim().length;
        const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, null);
        let prose = 0;
        while (walk.nextNode()) {
          const t = (walk.currentNode.nodeValue || "").replace(/\s+/g, " ").trim();
          if (t.length >= 25 && /[a-z]{3}/.test(t)) prose += t.length;
        }
        m.prose = prose;

        // ".wl-op-row" is the before side's row, ".wl-op-r" the after's; the
        // "×5" siblings are not rows of stock and are excluded by class.
        const rows = box.querySelectorAll(".wl-op-row, .wl-op-r:not(.wl-op-x)");
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (r.height < 1 || clipped(rows[i], r)) continue;
          if (r.top < -0.5 || r.bottom > vh + 0.5) continue;
          m.rowsSeen++;
        }
        /* EXCEPT AT A WELL, WHERE HAVING NO ROWS IS THE ANSWER. The before
           column drew a paragraph and a three-row table of the wounded; the
           after draws one stacked bar, which is zero rows — and a metric
           declared "higher is better" printed that as a regression against a
           design doing exactly what it was asked to. Dropped on BOTH sides for
           that one subject rather than left in to argue the opposite of the
           truth; the well's story is the coverage number, 18.3% of a laptop
           down to 5.9%. It has to be dropped HERE and not on the way out of
           the stage, because ba re-samples this hook after the shot and
           assigns it over the stage's return. */
        if (window.__wlTradeKind === "well") delete m.rowsSeen;

        /* AND THE SECOND COMPLAINT AS A NUMBER. "BARREN DESERT ... WITH NO MAN
           THERE" was not figurative: claiming the "outpost" phase fired
           phase:leave:campaign, campaign.js answered it with showAll(false),
           and that hid its own root — you, your column, every band, the
           outpost's own huts — and called W.desert.hide(). What was left
           behind the panel was the sky dome, which is a smooth sand-coloured
           gradient. Two groups, lit or not; the before column scores 0 on
           every subject and every frame. */
        const isl = CBZ.scene && CBZ.scene.getObjectByName("warlordIsland");
        const camp = CBZ.scene && CBZ.scene.getObjectByName("warlordCampaign");
        m.worldLit = (isl && isl.visible ? 1 : 0) + (camp && camp.visible ? 1 : 0);
        return m;
      },
    };
  }

  for (let t = 0; t < 400 && !W.phase(); t++) await sleep(120);
  for (let t = 0; t < 400 && W.phase() === "boot"; t++) await sleep(120);
  if (!W.phase() || W.phase() === "boot") return { ok: false, missing: "boot never finished" };
  if (W.phase() !== "campaign") { W.setPhase("campaign"); await sleep(250); }

  /* A WARLORD WITH SOMETHING TO SPEND. Enough to afford most of a crate list
     but not the top of it, so the panel has to show BOTH an affordable row and
     an unaffordable one — that is the state the disabled styling exists for. */
  if (W.state.gold < 1200) { W.state.gold = 1200; W.emit("gold", W.state.gold); }
  for (let i = W.state.army.length; i < 22; i++) {
    W.addSoldier(W.makeSoldier(i % 5 === 0 ? "soldier" : i % 3 === 0 ? "raider" : "levy",
      i % 4 ? "carbine" : "fists"));
  }
  if (sub.cart) {
    // a cart of loot, which is what the SELL side is for
    W.stash("sidearm", 11); W.stash("carbine", 4); W.stash("smg", 2);
    W.stashArmour("vest", 3);
  }
  if (sub.hurt) {
    // a well with nobody wounded is a well with nothing to say
    for (let i = 0; i < W.state.army.length; i += 2) {
      W.state.army[i].wounded = true;
      W.state.army[i].hp = Math.round(W.state.army[i].maxHp * 0.5);
    }
  }

  /* THE FOURTH KIND IS NOT ON THE ISLAND. campaign.js places outposts itself
     and its table only knows depot and camp (and a "town" it maps to a depot),
     so a NIGHT MARKET never exists in a real campaign — outpost.js's own
     PATTERN, which does place one, is dead code the moment campaign.js loads.
     Reported, not fixed here: campaign.js belongs to another agent. Built
     through outpost.js's public build() so the kind can still be photographed
     on both sides of the pair. */
  let o = null;
  for (let i = 0; i < W.state.outposts.length; i++) {
    if (W.state.outposts[i].kind === sub.kind) { o = W.state.outposts[i]; break; }
  }
  if (!o) {
    if (!W.outpost || !W.outpost.build) return { ok: false, missing: "outpost.build" };
    const seed = W.state.outposts[0];
    o = W.outpost.build(sub.kind, seed ? seed.x : 0, seed ? seed.z : 0);
    o.y = seed ? seed.y : 0;
    W.state.outposts.push(o);
  }
  if (o.kind !== sub.kind) return { ok: false, missing: "no " + sub.kind + " to open" };

  /* STAND THE PLAYER AT IT AND WAIT FOR THE CAMERA TO ACTUALLY ARRIVE. The
     point of this pair is as much the world BEHIND the panel as the panel —
     "RN WE HAVE BARREN DESERT AND MAN WITH A CRATE POPUP WITH NO MAN THERE" is
     half the complaint, and a column of empty gradient would be a picture
     arguing for something it does not show.

     Three things had to be right and each one cost a run. camYaw(π) puts the
     orbit BEHIND the player so the outpost is between him and the horizon;
     camYaw(0) parks the camera in front of him looking out to sea, which is
     what produced the first empty column. camDist(40) is what makes five 4 m
     huts read at all. And the wait is a POLL, not a sleep: campaign.js eases
     the camera and desert.js refills one clipmap level per frame, so a fixed
     2.6 s is enough on an idle Mac and not enough on a loaded one — the
     difference is a photograph of nothing. */
  W.state.you.x = o.x; W.state.you.z = o.z + 58;
  if (W.campaign && W.campaign.camYaw) W.campaign.camYaw(Math.PI);
  if (W.campaign && W.campaign.camDist) W.campaign.camDist(40);
  const near = () => {
    const c = CBZ.camera;
    return !!c && Math.hypot(c.position.x - o.x, c.position.z - o.z) < 140;
  };
  for (let t = 0; t < 120 && !near(); t++) await sleep(100);
  /* AND THEN PULL THE ISLAND OVER BY HAND. campaign.js sets the camera
     absolutely, so it teleports with the player in one frame — but desert.js's
     clipmap refills ONE of its seven levels per frame, and after an 8.8 km jump
     all seven are dirty. On an idle Mac at 1× that is over in 200 ms. In this
     tool it is not: an iPhone frame is 393×852 at DEVICE SCALE 3 rendered
     through swiftshader on a machine already running four agents, which is a
     few frames per second — so seven frames is seconds away, and the first two
     runs of this preset photographed a correctly-positioned camera looking at
     an island that had not arrived. It is a beautiful, flat, empty gradient
     and it would have been published as proof of the opposite of the point.
     desert.follow() is public and fills a level per CALL, so driving it from
     here makes the staging frame-rate independent, which is what a photography
     tool needs. HARNESS TRAP: any ba stage on this game that waits N
     milliseconds for something that actually wants N FRAMES is a coin flip
     decided by what else is running on the machine. */
  for (let k = 0; k < 30; k++) W.desert.follow(W.state.you.x, W.state.you.z);
  await sleep(900);

  if (W.outpost && W.outpost.open) W.outpost.open(o);
  else return { ok: false, missing: "outpost.open" };
  if (sub.tab === "sell") {
    /* the SELL side through the rail's own verb, not by poking a variable —
       the before side and the after side spell it differently and the button
       is the thing both of them agree on */
    const btns = document.querySelectorAll("#verbs .vbtn");
    for (let i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || "").indexOf("SELL") === 0) { btns[i].click(); break; }
    }
  }
  await sleep(500);

  if (!document.querySelector("#verbs.on")) return { ok: false, missing: "the rail never opened" };
  /* THE HOOK IS THE AUTHORITY, NOT THIS RETURN. ba samples
     window.__cbzVisualCompare.metrics() for every subject after the shot and
     Object.assigns it OVER whatever the stage returned, so anything this
     function does to the numbers on the way out is silently undone. (Worth
     knowing because it changed under this very wave: the sample used to live
     inside the film-strip branch, so a preset that published the hook and did
     not ask for a strip reported nothing at all — which is exactly what the
     first run of this preset printed, an empty table and "0 better · 0 worse".
     It is returned here as well, so the preset is correct either way.) */
  return { ok: true, open: true, place: o.name,
           metrics: window.__cbzVisualCompare.metrics() };
}

export default {
  id: "warlord-trade",
  title: "Desert Warlord: Trading Without A Lid On The World",
  description:
    "BEFORE is origin/main served from its own worktree, AFTER is this tree, both on seed 1337 with weather and sound off. Captured on a laptop frame and an iPhone frame, because the panel that covers a quarter of a desktop covers half a phone.",
  page: "games/warlord.html",
  beforeLabel: "BEFORE · origin/main",
  afterLabel: "AFTER · a shelf you can see through",
  viewport: { width: 1280, height: 800 },
  readyExpression: "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.state)",
  urlParams: { go: 1, seed: 1337, weather: "off", sound: "off" },
  stageTimeoutMs: 480000,
  subjects,
  stage: stageTrade,
  pairNote: "seed 1337 · the same outpost at the same spot · the same device frame on both sides",
  method:
    "Two servers, two checkouts. The preset boots straight onto the island, gives the warlord $1200 and 22 men so a crate list has both affordable and unaffordable rows, stands him at the outpost and waits for campaign.js's camera to arrive before anything is opened, then opens the place through outpost.js's own public open(). The SELL column is reached by clicking the rail's own SELL verb rather than by setting a variable, because the two sides name that state differently. Nothing about the layout is posed: the rail is drawn by the page's real CSS at that frame's real width. Both checkouts carry one identical one-line deletion in desert.js — origin/main throws a ReferenceError in build() and never boots at all, so without it there is no before side to photograph.",
  metrics: {
    worldLit:    { label: "The world behind the panel (island + campaign)", unit: "of 2", better: "higher" },
    coverPct:    { label: "Share of the screen the rail covers", unit: "%", better: "lower" },
    rowsSeen:    { label: "Rows of stock you can read without scrolling", unit: "rows", better: "higher" },
    chars:       { label: "Characters in the rail", unit: "chars", better: "lower" },
    prose:       { label: "…of that, running sentences", unit: "chars", better: "lower" },
    controls:    { label: "Controls on screen in the rail", unit: "buttons" },
    unreachable: { label: "…that a tap cannot reach", unit: "buttons", better: "lower" },
    offScreen:   { label: "…that run past a screen edge", unit: "buttons", better: "lower" },
  },
  metricsNote:
    "worldLit is the second complaint as a number and it is the one that is " +
    "not a matter of taste: 0 means the island and everything campaign.js " +
    "draws were switched off behind the trading panel, which is what claiming " +
    "a phase did. coverPct is the first complaint as a number, and it is the " +
    "only one the WELL " +
    "reports: a well's readout after this wave is a single stacked bar, so it " +
    "has no rows to count and rowsSeen is dropped there on both sides rather " +
    "than printed as a regression against a design that is doing what it was " +
    "asked to. rowsSeen is the one that must go UP and it is what stops the other numbers from being a story about deletion: the before column had 789 characters in the rail and let you read two of nine crate rows. prose counts only text nodes of 25+ characters containing real words, so a price cannot launder a paragraph. unreachable is a hit test at each control's own centre — the only test that can see one fixed layer drawn over another — and controls scrolled out of their own panel are not counted, because they are not on screen to be reached.",
};
