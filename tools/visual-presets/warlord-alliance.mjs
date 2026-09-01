/* WARLORD ALLIANCE — the board is gone, and the handshake is real.

   THE ASKS, in the owner's words, 2026-09-01:

     "Multiplayer is way not dense enough add way way more total armies"
     "THIS IS WARLORD MODE, board is dumb except ally shit is useful if it's
      a real accept deny"
     "SHOW DONT TELL for warlord ... just too much talking of the ui"

   Three complaints, one wave, and this sheet photographs all three because
   they are the same change seen from three sides.

   WHAT THE BEFORE SIDE IS. src/warlord/match.js used to be a 2 448-line MATCH
   LAYER: an eight-slot lobby, a twenty-minute wall clock, a bottom strip
   counting it down, and a full-screen SCOREBOARD — "THE BOARD" — which is
   where alliances lived. On that board an offer was a row and an AI answered
   in the same call frame the offer was made in, so a human's offer could not
   be refused and an AI's offer to a human was a line of text on a screen.
   The whole layer is deleted. See match.js's own tombstone for what went and
   why.

   WHAT THE AFTER SIDE IS. Fourteen NAMED rival warlords with their own
   colours, their own holdings on territory.js's map and their own columns
   riding the sand; an alliance offer that arrives as a verb rail with ACCEPT
   and REFUSE on it and an answer that takes a day to come back; and the
   standing on the map card, on the holding of the man you are dealing with.

   BOTH COLUMNS RUN THIS SAME FILE. BEFORE is HEAD plus every uncommitted edit
   this run does not own, served on its own port by tools/ba-lib/head-build.mjs
   — four other agents are writing to this checkout right now and their work
   belongs to the BASELINE, not to this change. AFTER is the working tree. The
   two columns therefore differ by exactly three source files.

   THE STAGE BRANCHES ON A CAPABILITY, NOT ON A FLAG, because there is no flag
   — the board was deleted rather than switched off. `CBZ.warlord.warlords`
   exists on the after side and `CBZ.warlord.match.board` exists on the
   before side, and each side is driven through its own real entry point: the
   before side opens the board the way the strip's BOARD button does, the
   after side lets a rival's rider arrive the way a dawn does.

   THE PHONE FRAME IS NOT OPTIONAL. "ultra simple controls" is a hard
   requirement of this game and the offer is the one decision it has; a rail
   with two verbs on an 852x393 landscape phone is the layout that broke last
   time (tools/warlord-fits.mjs exists because of it), so it is in frameList.

   uiChars IS THE SHOW-DONT-TELL METRIC and it is this repo's hudTextChars
   convention (tools/visual-presets/disaster-sequence.mjs, jail-scene.mjs,
   tools/warlord-fits.mjs): the rendered, whitespace-stripped text the player
   has to read on that screen at that instant. Lower is better and it is the
   only metric here where that is true — every other row is a count of things
   in the WORLD, where more is the ask. */

import { baselineBuild } from "../ba-lib/head-build.mjs";

const SUBJECTS = [
  { id: "the-island", label: "The island, and who is on it",
    focus:
      "THE DENSITY ASK. BEFORE: twenty-two holdings, five factions and you, and not one party on the sand that " +
      "belongs to a named rival — the 'warlords' were rows on a scoreboard. AFTER: forty holdings, fourteen NAMED " +
      "warlords each with a home, a colour and columns of his own riding the island. The share bar under the header " +
      "is the read: before it is six blocks, after it is twenty." },
  { id: "the-offer", label: "He offers his hand",
    focus:
      "THE ACCEPT/DENY ASK. BEFORE: a full-screen scoreboard, and the offer is a row on it under a paragraph " +
      "explaining that the dashed line is 60% and holding past it for 60 s ends the match. AFTER: the verb rail — " +
      "his name, his ground, his columns, his men, and two verbs. The world is still running behind it, which is " +
      "the whole reason this game docks decisions instead of opening dialogs." },
  { id: "the-standing", label: "Allied, on his ground",
    focus:
      "WHAT AN ALLIANCE LOOKS LIKE AFTERWARDS. BEFORE: an ALLY tag on the scoreboard row. AFTER: the map card on " +
      "HIS holding — ALLIED SINCE DAY n, what he holds, what he has out, and a BREAK verb next to RIDE HERE. " +
      "Diplomacy sits on the ground it is about." },
  { id: "the-betrayal", label: "Break it, and they come",
    focus:
      "WHAT IT COSTS. BEFORE: a betrayal was a toast, a +1 on a scoreboard column and twenty seconds of the victim " +
      "defending at 1.5x — a number on a screen. AFTER: every column he has on the island turns hostile and hunts " +
      "you, and the map draws a hunting party brighter than a roaming one. Look at his dots." },
];

/* THE MEASUREMENT LIVES INSIDE stage(), NOT BESIDE IT. ba stringifies the
   stage function and evaluates it in the page, so anything it names from this
   module's scope is a ReferenceError at capture time — which reads exactly
   like a page that failed to boot. The ruler is therefore a local function
   declared inside the stage, and it is the same code on both builds. */

export default {
  id: "warlord-alliance",
  title: "The board is gone, and the handshake is real",
  page: "games/warlord.html",
  description:
    "DESERT WARLORD's match layer — lobby, clock, countdown strip and full-screen scoreboard — deleted, and the one " +
    "part of it the owner wanted kept rebuilt as a real two-sided handshake. BEFORE is the board: alliances as rows " +
    "on a scoreboard, answered by an AI in the same call frame the offer was made in, on an island of twenty-two " +
    "holdings whose 'warlords' had no parties on it. AFTER is warlord mode: fourteen named rivals with ground and " +
    "columns of their own, an offer that arrives as ACCEPT / REFUSE on the verb rail while the world keeps running, " +
    "an answer that takes a day to ride back, and the standing shown on the map card of the man it is about.",

  beforeLabel: "BEFORE · THE BOARD",
  afterLabel: "AFTER · WARLORD MODE",
  pairNote: "Same island, same seed, same checkout — three source files apart",
  method:
    "Both columns serve this repo: BEFORE is HEAD with every uncommitted edit this run does not own replayed into " +
    "it (four agents share this checkout; their work is the baseline, not the change), AFTER is the working tree. " +
    "Each side boots games/warlord.html on seed 1337 and rides the real island. The stage branches on a capability " +
    "rather than a flag, because the board was deleted rather than switched off: the before side opens it through " +
    "W.match.board() exactly as the strip's BOARD button does, after starting a six-warlord demo match through " +
    "W.match.demo(); the after side puts the player on a rival's holding and turns a dawn, which is how a rider " +
    "actually arrives. Nothing is posed: every screen is drawn by the page's own CSS at that frame's real width, " +
    "and every number is read out of the live game at the instant of the photograph.",
  defaultFocus:
    "Is there anything on this island, and can you actually answer a man who offers you his hand?",

  urlParams: { go: "1", seed: "1337", weather: "off", sound: "off" },
  readyExpression: "!!window.__warlordReady",
  frameList: ["laptop", "iphone-16:portrait"],
  stageTimeoutMs: 600000,

  async launchSides(ctx) {
    return baselineBuild(ctx, {
      owned: [
        "src/warlord/match.js",
        "src/warlord/territory.js",
        "src/warlord/warnet.js",
        "tools/visual-presets/warlord-alliance.mjs",
        "tools/visual-presets/warlord-dock.mjs",
        "tools/warlord-boot.mjs",
        "tools/warlord-fits.mjs",
        "tools/warlord-speed.mjs",
      ],
    });
  },

  subjects: SUBJECTS,

  metrics: {
    namedWarlords: { label: "Named rival warlords on the island", unit: "warlords", better: "higher" },
    warlordColumns: { label: "Parties riding for a named warlord", unit: "columns", better: "higher" },
    parties: { label: "Parties on the island, all told", unit: "parties", better: "higher" },
    holdings: { label: "Holdings the island is cut into", unit: "regions", better: "higher" },
    owners: { label: "Owners with ground on the map", unit: "owners", better: "higher" },
    uiChars: { label: "UI copy the player has to read on this screen", unit: "chars", better: "lower" },
  },
  metricsNote:
    "Read live in the page at the instant of each photograph. uiChars is this repo's hudTextChars convention — the " +
    "rendered, whitespace-stripped text of every top-level body element except the renderer's canvas — and it is the " +
    "only row where lower wins; the rest count things in the WORLD, which is the density ask. warlordColumns is zero " +
    "on the before side by construction and that is the whole point: the old file's warlords were numbers, not " +
    "parties. The before side reports 22 holdings and 6 owners because that is what the island was.",

  stage: async function stageWarlordAlliance(input) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const W = window.CBZ && window.CBZ.warlord;
    if (!W) return { ok: false, error: "CBZ.warlord missing" };
    const T = W.territory;
    const A = W.warlords || null;          // AFTER only
    const OLD = !A && W.match && W.match.board ? W.match : null;   // BEFORE only
    const ctx = window.CBZ.warlordCtx;
    const id = input.subject.id;

    /* ONE PAGE, FOUR SUBJECTS, in declaration order. Every subject therefore
       starts in whatever the last one left behind, so each one tears the
       previous screen down rather than assuming it is not there — the trap
       warlord-map.mjs's own header records (two of four before-frames were
       photographs of a man standing in a sandstorm). */
    const clear = async () => {
      if (T && T.isOpen && T.isOpen()) T.close();
      if (ctx && ctx.closeVerbs) ctx.closeVerbs();
      if (OLD && OLD.closeBoard) OLD.closeBoard();
      if (ctx && ctx.closeScreen) ctx.closeScreen();
      await sleep(120);
    };

    /* THE BEFORE SIDE NEEDS A LIVE MATCH BEFORE ANY OF ITS SCREENS EXIST, and
       demo() calls newGame(), so it is done ONCE and before anything else is
       staged. On the after side there is nothing to start: the rivals are on
       the island because the island exists. */
    if (OLD && !window.__wlaMatch) {
      window.__wlaMatch = 1;
      try { OLD.demo({ n: 6 }); } catch (e) {}
      await sleep(900);
    }
    if (A && !window.__wlaSet) {
      window.__wlaSet = 1;
      /* AN ARMY, so a warlord has a reason to deal with you at all —
         wantsAlly() measures parity in POWER, and a man with nothing is not a
         man anybody allies with. This is the same 120 men the alliance probe
         uses; it is staging, not a rule. */
      for (let i = W.state.army.length; i < 120; i++) {
        W.addSoldier(W.makeSoldier(i % 3 ? "levy" : "raider", "carbine"));
      }
      /* Ride out and let the island move, so the map in subject one is a
         campaign rather than a start position. */
      for (let d = 0; d < 8; d++) { W.dawn(); await sleep(40); }
      /* EIGHT DAWNS IN A THIRD OF A SECOND IS EIGHT DAYS OF NEWS AT ONCE, and
         the shell's toasts live 2.6 s and stack up the right-hand side. In
         play a dawn is minutes apart; here they arrive together and land on
         the map. Let them clear before anything is photographed. */
      await sleep(3200);
    }

    await clear();
    let note = "";

    if (id === "the-island") {
      if (T && T.open) { T.open(); await sleep(900); }
      else if (W.campaign && W.campaign.map) { W.campaign.map(); await sleep(900); }
    }

    if (id === "the-offer") {
      if (OLD) {
        OLD.board();
        await sleep(500);
        note = "the board";
      } else {
        const w = A.list().find((x) => T.held(x.id).length) || A.list()[0];
        const r = T.byId(w.home);
        if (r) { W.state.you.x = r.x; W.state.you.z = r.z; }
        W.setPhase("campaign");
        /* HIS RIDER, PUT ON THE ROAD DIRECTLY. Waiting for wantsAlly() to roll
           a yes is the RULE and it is gated elsewhere (the alliance probe);
           this sheet is about what the offer LOOKS like when it lands, and a
           photograph that depends on a die is a photograph that is sometimes
           of an empty screen. */
        W.warlordState.wait[["you", w.id].sort().join("|")] =
          { from: w.id, to: "you", day: W.state.day };
        A.present();
        await sleep(400);
        window.__wlaHim = w.id;
        note = w.name;
      }
    }

    if (id === "the-standing") {
      if (OLD) {
        /* The board's own ally row: accept on its behalf through its own
           entry point, then photograph the board it repaints. */
        const st = window.CBZ.warlord.matchState;
        const other = st.order.find((x) => x !== st.me);
        if (other) { try { OLD.ally(other); } catch (e) {} }
        await sleep(300);
        OLD.board();
        await sleep(500);
      } else {
        const him = window.__wlaHim || A.list()[0].id;
        A.accept(him, "you");
        /* WAIT FOR THE TOAST TO DIE. The shell's toasts live 2.6 s and stack
           bottom-up over exactly where the map card is; the first run of this
           sheet photographed "…TAKES YOUR HAND" sitting on top of "ALLIED
           SINCE DAY 9", which is the one line the subject exists to show. */
        await sleep(3000);
        const w = A.warlord(him);
        if (T && T.open) { T.open(); await sleep(500); T.focus(w.home); await sleep(700); }
        note = w.name;
      }
    }

    if (id === "the-betrayal") {
      if (OLD) {
        const st = window.CBZ.warlord.matchState;
        const other = st.order.find((x) => x !== st.me);
        if (other) { try { OLD.breakAlly(other); } catch (e) {} }
        await sleep(300);
        OLD.board();
        await sleep(500);
      } else {
        const him = window.__wlaHim || A.list()[0].id;
        A.breakAlly("you", him);
        await sleep(3000);                       // same toast, same reason
        const w = A.warlord(him);
        const cols = A.columns(him);
        note = w.name + " · " + cols.length + " columns · moods " +
               cols.map((c) => c.mood).join("/");
        if (T && T.open) { T.open(); await sleep(500); T.focus(w.home); await sleep(700); }
      }
    }

    await sleep(300);

    /* ONE RULER, TWO GAMES. Rendered UI copy by this repo's hudTextChars rule
       (every top-level body element except the renderer's canvas, whitespace
       stripped), plus counts taken out of the live world rather than out of
       either build's own audit — the before side has no warlords audit to ask
       and the after side's would not be comparable if it did. */
    const m = (function measure() {
      const canvas = window.CBZ && window.CBZ.renderer && window.CBZ.renderer.domElement;
      let uiChars = 0;
      const kids = Array.prototype.slice.call(document.body.children);
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
        if (getComputedStyle(child).display === "none") continue;
        uiChars += (child.innerText || "").replace(/\s+/g, "").length;
      }
      const bands = (W.state && W.state.bands) || [];
      let holdings = 0, owners = 0, warlordColumns = 0, namedWarlords = 0;
      if (T && T.regions) {
        holdings = T.regions.length;
        const ids = T.ownerList ? T.ownerList() : [];
        for (let i = 0; i < ids.length; i++) if (T.held(ids[i]).length) owners++;
      }
      if (A) {
        namedWarlords = A.list().length;
        for (let i = 0; i < bands.length; i++) if (bands[i].warlordId) warlordColumns++;
      }
      return {
        uiChars: uiChars, holdings: holdings, owners: owners,
        namedWarlords: namedWarlords, warlordColumns: warlordColumns,
        parties: bands.length,
      };
    })();

    return {
      ok: true,
      side: OLD ? "before" : "after",
      note: note,
      frame: input.frame ? input.frame.id : null,
      metrics: m,
    };
  },
};
