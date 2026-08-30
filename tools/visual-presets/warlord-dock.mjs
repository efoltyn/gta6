/* DESERT WARLORD — THE ENCOUNTER, ON A DESKTOP AND ON A PHONE.

   OWNER, 2026-08-30, screenshotting a live match on a 1500 px desktop:

       "the fucking layout you did is fucking horrible for itneraction on
        desktop, so so dumb fix that and imrpoe the iphone too foxucus on
        making ui and ux good for both less words more shotw dont tell"
       "a lot of buttons dont even show for interactions on desktop make sure
        everything shows and nothng overkaooung with edges of screen no matter
        what debice"

   THREE THINGS WERE WRONG AND THEY ARE THREE DIFFERENT KINDS OF WRONG.

   1. THE BUTTONS WERE UNDER THE MATCH STRIP. #verbs and #wl-match were both
      position:fixed, both pinned to the bottom, both z-index 55 — so which
      one won came down to DOM insertion order, and it was the strip. ATTACK,
      DEMAND and RIDE AWAY were drawn underneath it. The game could not be
      answered in the mode the game is built for. tools/warlord-fits.mjs now
      measures this class mechanically across seven device frames; it found
      159 unpressable controls on the before side of this pair.

   2. THE RAIL WAS ONE LAYOUT AT EVERY WIDTH. A 760 px strip centred at the
      bottom is right on a phone — it is thumb-height and it is the whole
      width there is. On a desktop it was a slab parked exactly where the
      mouse clicks to ride, covering the band the decision was about.

   3. IT WAS A SPREADSHEET. "210 MEN · mostly 120 soldiers, best gun rpg /
      rocket launcher · 1% — they will destroy you" over a twelve-row
      scrolling table of "1 RAIDER · RPG / ROCKET LAUNCHER · PLATE RIG".
      Nobody reads that with a band riding at them and a clock that does not
      stop.

   The before column is origin/main; the after is this tree. Same seed, same
   band (built from the same seeded stream at the same size and faction), same
   device frames.

   WHAT TO LOOK FOR
     · desktop — before: a slab across the middle-bottom. after: a column on
                 the right, the world uncovered, the ground clickable.
     · phone   — before: the verbs pushed under the strip. after: above it.
     · the readout — before: sentences and a scroll list. after: one split bar
                 for the odds, one stacked bar for what they are made of, and
                 chips for what they carry.
*/

const subjects = [
  { id: "meeting", them: 210, faction: "merc", match: false,
    label: "Meeting A Free Company — The Rail",
    focus: "The encounter with no match running. Before: a centred slab with a paragraph and a twelve-row roster. After: identity in the header, the odds as one bar, the composition as one stacked bar, the guns as chips — and on desktop the whole thing is a right-hand column instead of a lid over the world." },

  { id: "meeting-in-match", them: 210, faction: "merc", match: true,
    label: "The Same Meeting, In A Live Match — THE BUG",
    focus: "match.js's strip is on screen. Before: it is drawn over the verb row and ATTACK / DEMAND / RIDE AWAY cannot be clicked at all. After: the strip publishes its measured height as --wl-footer and the rail docks above it, so both are reachable and the clock stays visible — which it must, because it never pauses." },

  { id: "outpost", outpost: true, match: true,
    label: "An Outpost, In A Match",
    focus: "The same rail, the same collision, a different owner: outpost.js. Nothing in outpost.js changed — the fix is in the page's ladder, which is the point of fixing it there." },
];

async function stageDock(input) {
  const CBZ = window.CBZ, sub = input.subject;
  if (!CBZ || !CBZ.warlord) return { ok: false, missing: "warlord" };
  const W = CBZ.warlord;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (!window.__cbzVisualCompare) {
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.renderer && CBZ.camera) { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} }
        await new Promise((r) => setTimeout(r, 700));
      },
      /* THE MEASUREMENT IS THE SAME ONE tools/warlord-fits.mjs MAKES, cut down
         to this frame: how many controls are on screen, and how many of them
         a finger could actually land on. A control is unreachable if its own
         centre hit-tests to something else — which is the only test that can
         see one fixed layer drawn over another, and the exact bug the owner
         hit. `words` counts the characters of prose in the readout, because
         "less words" is a claim and a claim wants a number. */
      metrics() {
        const box = document.getElementById("verbs");
        const m = { controls: 0, unreachable: 0, offScreen: 0, words: 0, bodyRows: 0 };
        if (!box || !box.classList.contains("on")) return m;
        const vw = window.innerWidth, vh = window.innerHeight;
        const btns = box.querySelectorAll(".vbtn, .vtoggle");
        for (let i = 0; i < btns.length; i++) {
          const el = btns[i], r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          m.controls++;
          if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) m.offScreen++;
          const hit = document.elementFromPoint(
            Math.max(1, Math.min(vw - 1, r.left + r.width / 2)),
            Math.max(1, Math.min(vh - 1, r.top + r.height / 2)));
          if (hit && hit !== el && !el.contains(hit)) m.unreachable++;
        }
        const head = box.querySelector(".vhead");
        const body = box.querySelector(".vbody");
        // prose = the running text a player has to READ, not the numbers in
        // a bar or the label on a chip
        let prose = head ? (head.textContent || "") : "";
        if (body) {
          const rows = body.querySelectorAll(".wl-row, .wl-small");
          m.bodyRows = body.querySelectorAll(".wl-row").length;
          for (let i = 0; i < rows.length; i++) prose += " " + (rows[i].textContent || "");
        }
        m.words = prose.replace(/\s+/g, " ").trim().length;
        // how much of the viewport the dock covers — on a desktop this is the
        // difference between a HUD and a lid
        const vin = box.querySelector(".vin");
        if (vin) {
          const r = vin.getBoundingClientRect();
          m.coverPct = Math.round((r.width * r.height) / (vw * vh) * 1000) / 10;
        }
        return m;
      },
    };
  }

  /* THE SUBJECTS SHARE ONE PAGE, so the second one starts in whatever phase
     the first one left behind — the first draft demanded "campaign" here and
     every subject after the first failed with `missing: campaign phase
     (encounter)`. Boot is still waited for; after that the stage RESETS the
     phase rather than refusing it. The stale rail does not need tearing down
     separately: ctx.verbs() replaces the whole dock's innerHTML. */
  for (let t = 0; t < 400 && !W.phase(); t++) await sleep(120);
  for (let t = 0; t < 400 && W.phase() === "boot"; t++) await sleep(120);
  if (!W.phase() || W.phase() === "boot") return { ok: false, missing: "boot never finished" };
  if (W.phase() !== "campaign") { W.setPhase("campaign"); await sleep(200); }

  /* THE MATCH FIRST, THEN THE BAND. match.demo() calls W.newGame(), which
     wipes the roster and the band list — staging them the other way round
     photographs an empty rail and calls it an encounter. */
  if (sub.match && W.match && W.match.demo && !W.match.live()) {
    W.match.demo({ n: 6 });
    await sleep(300);
  }
  // an army, so the odds bar has two sides to it
  for (let i = W.state.army.length; i < 34; i++) {
    W.addSoldier(W.makeSoldier(i % 4 === 0 ? "veteran" : i % 3 === 0 ? "soldier" : i % 2 ? "raider" : "levy", "carbine"));
  }
  for (let i = 0; i < W.state.bands.length; i++) W.state.bands[i].cooldown = 1e9;

  if (sub.outpost) {
    const o = W.state.outposts && W.state.outposts[0];
    if (!o || !W.outpost || !W.outpost.open) return { ok: false, missing: "outpost" };
    W.outpost.open(o);
  } else {
    const b = W.makeBand({ size: sub.them, faction: sub.faction,
      x: W.state.you.x + 30, z: W.state.you.z + 30 });
    W.state.bands.push(b);
    W.army.encounter(b);
  }
  await sleep(420);
  /* THE SUBJECT HAS TO PROVE ITS OWN PREMISE. A pair captioned "in a live
     match" with no match strip on screen is a picture that argues for
     something it does not show, and the first run of this preset produced
     exactly that on both columns. Fail the subject instead. */
  if (sub.match && !document.querySelector("#wl-match.on")) {
    return { ok: false, missing: "the match strip never came up" };
  }
  if (!document.querySelector("#verbs.on")) {
    return { ok: false, missing: "the rail never opened" };
  }
  return { ok: true, open: true };
}

export default {
  id: "warlord-dock",
  title: "Desert Warlord: The Rail, On A Desktop And On A Phone",
  description:
    "BEFORE is origin/main served from its own worktree, AFTER is this tree, both on seed 1337 with weather off. Captured on a laptop frame and an iPhone frame because the complaint was that one layout was serving both.",
  page: "games/warlord.html",
  beforeLabel: "BEFORE · origin/main",
  afterLabel: "AFTER · a ladder, a column, and a picture",
  viewport: { width: 1280, height: 800 },
  readyExpression: "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.state)",
  urlParams: { go: 1, seed: 1337, weather: "off", sound: "off" },
  stageTimeoutMs: 420000,
  subjects,
  stage: stageDock,
  pairNote: "seed 1337 · the same band at the same size · the same device frame on both sides",
  method:
    "Two servers, two checkouts. The preset boots straight onto the island, starts a six-warlord demo match where the subject asks for one (before the band is built, because match.demo reseeds the game), gives the player a 34-man roster so the odds bar has two sides, and opens the encounter through army.js's own public entry point. Nothing about the layout is posed: the rail is drawn by the page's real CSS at that frame's real width.",
  metrics: {
    controls:    { label: "Controls in the rail", unit: "buttons" },
    unreachable: { label: "…that a tap cannot reach", unit: "buttons", better: "lower" },
    offScreen:   { label: "…that run past a screen edge", unit: "buttons", better: "lower" },
    coverPct:    { label: "Share of the screen the dock covers", unit: "%", better: "lower" },
    words:       { label: "Characters of prose to read", unit: "chars", better: "lower" },
    bodyRows:    { label: "Table rows in the readout", unit: "rows", better: "lower" },
  },
  metricsNote:
    "unreachable is the bug, and it is measured by hit test rather than by bounding box: a button drawn under another fixed layer is on screen, is the right size, and cannot be pressed — nothing else in this repo could see that. coverPct is the desktop complaint as a number (a rail should be furniture, not a lid). words counts the characters of running prose in the header and readout, and bodyRows the tables under it; both went down because the same facts are now a split bar, a stacked bar and a row of chips.",
};
