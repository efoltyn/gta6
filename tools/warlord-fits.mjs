#!/usr/bin/env node
/* ============================================================
   tools/warlord-fits.mjs — CAN YOU PRESS IT, ON THAT PHONE, RIGHT NOW?

   OWNER, 2026-08-30, on a 1500 px desktop with an encounter open:

       "the fucking layout you did is fucking horrible for interaction on
        desktop… a lot of buttons dont even show for interactions on desktop
        make sure everything shows and nothng overlaping with edges of screen
        no matter what device for this game"

   He was right and the bug was not subtle: `#verbs` (the encounter/outpost
   rail) and `#wl-match` (the match strip) were BOTH `position:fixed`, BOTH
   pinned to the bottom, and BOTH at `z-index:55`. Same stacking level, so the
   winner is whichever the DOM happens to append last — and that was the match
   strip. ATTACK, DEMAND and RIDE AWAY were drawn underneath it. The game was
   unanswerable in the exact mode the game is built for, and every screenshot
   of it looked fine because the buttons were THERE, just covered.

   (`#wl-match` no longer exists: the match layer was deleted 2026-09-01. The
   history stays because this tool's REASON for existing is that story, and
   the same collision can be re-created by the next fixed bottom layer
   somebody adds. The screens that reproduced it are repointed below.)

   Nothing in this repo could have caught that. tools/button-gate.mjs reads
   the source and counts words in a label — it cannot know two fixed layers
   collide. A `ba` preset photographs a frame — a human has to notice. So this
   is the missing check, and it is deliberately not a screenshot tool:

     FOR EVERY DEVICE FRAME × EVERY SCREEN THIS GAME CAN BE ON,
     EVERY VISIBLE CONTROL MUST BE
       1. INSIDE THE VIEWPORT     — all four edges, inset by the safe area, so
                                    nothing hides under a notch or a home bar
       2. THE TOP THING AT ITS OWN CENTRE — elementFromPoint(centre) has to
                                    come back as that control or a child of
                                    it. This is the one that catches a cover,
                                    and no bounding box can.
       3. BIG ENOUGH TO HIT       — 28 px on the short side. A 6 px sliver is
                                    present, visible, and not a button.
       4. NOT ON TOP OF ANOTHER CONTROL — two controls overlapping means one
                                    of them is eating the other's taps.
     5. THE SCREEN FITS            — nothing the player has to read is below
                                    the fold. Added 2026-09-01.

   RULE 5, AND WHY IT IS NOT A CONTROL TEST. The owner, looking at the game:

       "And I have to do way too much scrolling, I should almost never have
        to scroll in reality a ton of the word slop needs to be removed."

   Every rule above this one asks about a BUTTON. All four passed on all
   seven frames while the aftermath screen was 2 700 px tall on an iPhone SE
   — because the buttons at the bottom of it were inside a live scroller, and
   the tool's own comment (below, still true) says a control inside a live
   scroller is reachable by scrolling to it, so its resting position proves
   nothing. That exemption is correct for a control and it is exactly the
   hole a screen full of prose falls through: the layout was measured, the
   CONTENT never was.

   So rule 5 measures the scrollers themselves. For each surface this game
   puts content into — #stage (a full screen) and #verbs .vbody (the rail's
   readout) — scrollHeight must not exceed clientHeight. A screen that
   overflows FAILS, and the number printed is the overflow in px, which is
   the amount of content that has to be cut. Shrinking the type to 9 px would
   pass it; that is what the CHARS column is for.

   THE CHARS COLUMN IS THE OTHER HALF, and it does not fail anything. It is
   this repo's hudTextChars convention (tools/visual-presets/jail-scene.mjs
   and disaster-sequence.mjs both measure it): the rendered, whitespace-
   stripped text the player has to read on that screen right now. It is
   printed on every run so that "cut the words" is a number somebody can
   watch fall, rather than an opinion two agents can disagree about.

   Frames: the standard family, portrait and landscape, because landscape on a
   phone is 390 px TALL and that is where a bottom rail with a body panel runs
   out of screen. Screens: the campaign, the encounter rail, the ALLIANCE rail
   (which is where the reported bug's successor lives — the match strip that
   caused it was deleted 2026-09-01), an outpost, the map, the map's diplomacy
   card, the armoury and the battle HUD.

     node tools/warlord-fits.mjs              # the gate
     node tools/warlord-fits.mjs --verbose    # print every control measured
     node tools/warlord-fits.mjs --frames laptop,iphone-16:landscape

   Exit 0 clean, 1 on any control that is off-screen, covered or too small,
   or any screen whose content runs below the fold.
============================================================ */
import { launch, sleep } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const VERBOSE = argv.includes("--verbose");

/* The frame family. Widths/heights are CSS px; the phones carry a real safe
   area because a control tucked under the home indicator passes a naive
   bounding-box test and still cannot be pressed. */
const FRAMES = {
  "iphone-se":      { w: 375, h: 667, dsf: 2, mobile: true, safe: { t: 20, b: 0 } },
  "iphone-16":      { w: 393, h: 852, dsf: 3, mobile: true, safe: { t: 59, b: 34 } },
  "iphone-16-max":  { w: 440, h: 956, dsf: 3, mobile: true, safe: { t: 59, b: 34 } },
  "pixel-8":        { w: 412, h: 915, dsf: 2.6, mobile: true, safe: { t: 24, b: 24 } },
  "ipad-mini":      { w: 744, h: 1133, dsf: 2, mobile: true, safe: { t: 24, b: 20 } },
  "laptop":         { w: 1280, h: 800, dsf: 2, mobile: false, safe: { t: 0, b: 0 } },
  "desktop":        { w: 1680, h: 1050, dsf: 1, mobile: false, safe: { t: 0, b: 0 } },
};
const DEFAULT_FRAMES = [
  "iphone-se:portrait", "iphone-16:portrait", "iphone-16:landscape",
  "pixel-8:portrait", "ipad-mini:portrait", "laptop:landscape", "desktop:landscape",
];

/* ---- THE SCREENS ---------------------------------------------------------
   Each one is an expression evaluated in the page that puts the game into
   that state and resolves when it is on screen. They run in order against ONE
   boot per frame, because booting this island costs ~8 s and there are seven
   frames. `match` is the one that reproduces the reported bug: an encounter
   rail with a live match strip under it. */
const SCREENS = [
  { id: "campaign", why: "riding — the HUD, the compass, the map button",
    set: `(async () => { return CBZ.warlord.phase() === "campaign"; })()` },

  /* SECOND, AND EARLY. Nothing pins the clock any more — the match layer that
     used to hold it at 1x is deleted — but this screen still runs before the
     rails because it leaves the island at 64x, and a screen measured while
     parties ride into you is a screen that changed under the ruler. It leaves
     the island fast-forwarding behind every
     screen after it, which is harmless for a layout measurement and is also
     free extra coverage of the pill at speed — the parties are calmed here so
     nothing rides in and takes the phase mid-measurement. */
  { id: "speed-max", why: "the game-speed pill at its widest — 64× with a lag tag",
    set: `(async () => {
      const W = CBZ.warlord;
      if (!W.clock) return false;
      W.setPhase("campaign");
      for (let i = 0; i < W.state.bands.length; i++) W.state.bands[i].cooldown = 1e9;
      W.clock.setScale(64);
      const b = document.getElementById("wlSpeed"), t = document.getElementById("wlSpeedT");
      /* THE TAG IS FORCED, not waited for: it appears only when the machine
         is failing to deliver the asked-for rate, which is a property of the
         machine and not something a layout gate may depend on. The layout
         question is "does the pill still fit when it is carrying one", and
         that is answerable without reproducing the condition. */
      if (b) b.classList.add("lag");
      if (t) { t.textContent = "19× REAL"; t.classList.add("on"); }
      await new Promise(r => setTimeout(r, 200));
      return !!(b && b.classList.contains("on"));
    })()` },

  { id: "encounter", why: "the meeting rail: ATTACK / DEMAND / HIRE / INSPECT / RIDE AWAY",
    set: `(async () => {
      const W = CBZ.warlord;
      const b = W.makeBand({ size: 210, faction: "merc", x: W.state.you.x + 30, z: W.state.you.z + 30 });
      W.state.bands.push(b);
      W.army.encounter(b);
      await new Promise(r => setTimeout(r, 120));
      return !!document.querySelector("#verbs.on .vbtn, #stage.on button");
    })()` },

  /* WAS `encounter-in-match`: the encounter rail with the match strip live
     under it, which is the bug this whole tool was written for. THE MATCH
     STRIP IS GONE — the match layer was deleted 2026-09-01 (see
     src/warlord/match.js's tombstone), so `#wl-match` no longer exists and
     that collision cannot recur. The screen is REPOINTED rather than dropped,
     because the thing it was really checking — a rail of verbs at the bottom
     of a phone, answerable — is now carrying the game's one real decision.

     ALLIANCE OFFER. A rival warlord's rider arrives and you answer ACCEPT or
     REFUSE on the verb rail, with his facts in the body panel above it. On a
     390 px-tall landscape phone that is a head, a body and two buttons in the
     bottom dock, which is exactly the shape that ran out of screen before. */
  { id: "alliance-offer", why: "a warlord's offer: ACCEPT / REFUSE on the rail",
    set: `(async () => {
      const W = CBZ.warlord, A = W.warlords;
      if (!A || !A.list().length) return false;
      W.setPhase("campaign");
      /* TEAR THE PREVIOUS RAIL DOWN FIRST. The screens share one boot and
         the encounter screen runs immediately before this one; present()
         refuses to
         stomp a rail that is already up (that is the rule — an offer is never
         more urgent than the fight you are in), so without this the frame
         measured was still the ENCOUNTER's rail wearing this subject's name.
         The tell was two subjects reporting byte-identical char counts. */
      if (CBZ.warlordCtx && CBZ.warlordCtx.closeVerbs) CBZ.warlordCtx.closeVerbs();
      const w = A.list()[0];
      /* Straight into the state rather than waiting for a dawn to roll one:
         this is a LAYOUT gate, and the diplomatic rules are gated elsewhere. */
      W.warlordState.wait[["you", w.id].sort().join("|")] = { from: w.id, to: "you", day: W.state.day };
      A.present();
      await new Promise(r => setTimeout(r, 200));
      return !!document.querySelector("#verbs.on .vbtn");
    })()` },

  { id: "outpost", why: "the trading rail: BUY / SELL / RECRUIT / ARM MEN / RIDE ON",
    set: `(async () => {
      const W = CBZ.warlord;
      const o = W.state.outposts && W.state.outposts[0];
      if (!o || !W.outpost || !W.outpost.open) return false;
      W.outpost.open(o);
      await new Promise(r => setTimeout(r, 150));
      return !!document.querySelector("#verbs.on .vbtn, #stage.on button");
    })()` },

  { id: "map", why: "the strategic board — FIT / CLOSE / RIDE HERE",
    set: `(async () => {
      const W = CBZ.warlord;
      if (!W.territory || !W.territory.toggle) return false;
      if (!W.territory.isOpen()) W.territory.toggle();
      await new Promise(r => setTimeout(r, 200));
      return !!document.querySelector("#stage.on button");
    })()` },

  { id: "armoury", why: "who carries what — the one screen that is a real stop",
    set: `(async () => {
      const W = CBZ.warlord;
      if (W.territory && W.territory.isOpen && W.territory.isOpen()) W.territory.toggle();
      for (let i = W.state.army.length; i < 24; i++) W.addSoldier(W.makeSoldier(i % 3 ? "levy" : "raider", "carbine"));
      if (!W.loadout || !W.loadout.open) return false;
      W.loadout.open();
      await new Promise(r => setTimeout(r, 200));
      return !!document.querySelector("#stage.on button");
    })()` },


  /* ---- THE THREE SCREENS THIS TOOL COULD NOT SEE ------------------------
     Added with rule 5, and they are the reason rule 5 exists. Every screen
     above is either a rail (bounded by construction) or a board whose
     content is a fixed number of rows. These three are the ones whose
     height is a function of WHAT HAPPENED — how many men died, how many
     prisoners you are standing over, how much prose a card felt like
     printing — and they are therefore the only ones that can be 2 700 px
     tall. They run last because two of them mutate the roster.

     They are also, not coincidentally, the three screens the owner was
     scrolling.

     THEY RUN BEFORE THE MAP SCREENS AND THAT ORDER IS LOAD-BEARING. The
     first run of this block sat them after the (now deleted) match board and
     all three reported the board's own 21 controls and 919 chars: the board
     repainted itself into #stage on its own clock, so it took the screen back
     from every ctx.screen() that followed it. The tell was three different
     screens reporting byte-identical numbers. A `set` expression that ends in
     `#stage.on button` cannot notice that, because any full screen satisfies
     it — which is a real limitation of the "did it open" test, still true of
     territory.js's map, and the reason this is a comment rather than a fix. */

  { id: "inspect", why: "the encounter's full roster — INSPECT, one tap off the rail",
    set: `(async () => {
      const W = CBZ.warlord;
      const b = W.makeBand({ size: 210, faction: "merc", x: W.state.you.x + 30, z: W.state.you.z + 30 });
      W.state.bands.push(b);
      W.army.encounter(b);
      await new Promise(r => setTimeout(r, 120));
      /* the rail's INSPECT verb, pressed the way a thumb presses it — by
         label, because the index moves with HIRE and ROB */
      const btn = Array.prototype.slice.call(document.querySelectorAll("#verbs .vbtn"))
        .filter(function (n) { return /INSPECT/.test(n.textContent); })[0];
      if (!btn) return false;
      btn.click();
      await new Promise(r => setTimeout(r, 180));
      return !!document.querySelector("#stage.on button");
    })()` },

  /* THE AFTERMATH, AT THE SIZE A REAL BATTLE MAKES IT. 40 of yours against
     60 of theirs, nine of yours dead by name, four broken and run, thirty-one
     of theirs dead and fourteen standing over as prisoners — every one of
     which used to be a card with four buttons on it. The report is the same
     plain object battle.js hands over, so this exercises the shipped path and
     not a mock of it. */
  { id: "aftermath", why: "the payoff screen — the dead, the loot and the prisoners",
    set: `(async () => {
      const W = CBZ.warlord;
      if (!W.army || !W.army.aftermath) return false;
      if (W.territory && W.territory.isOpen && W.territory.isOpen()) W.territory.toggle();
      for (let i = W.state.army.length; i < 40; i++) {
        W.addSoldier(W.makeSoldier(i % 7 === 0 ? "veteran" : i % 3 === 0 ? "soldier" : "levy", i % 2 ? "carbine" : "ak47"));
      }
      W.state.gold = 900;
      W.state.prisoners.length = 0;
      const band = W.makeBand({ size: 60, faction: "bandit", x: W.state.you.x + 40, z: W.state.you.z });
      const mine = W.state.army.slice();
      const dead = mine.slice(0, 9);
      const live = mine.slice(9);
      const fled = mine.slice(9, 13);
      const theirDead = band.men.slice(0, 31);
      const theirLive = band.men.slice(31, 45);
      const loot = {}, armourLoot = {};
      for (let i = 0; i < theirDead.length; i++) {
        const s = theirDead[i];
        if (s.wid) loot[s.wid] = (loot[s.wid] || 0) + 1;
        if (s.armour && s.armour !== "none") armourLoot[s.armour] = (armourLoot[s.armour] || 0) + 1;
      }
      W.army.aftermath({
        band: band, outcome: "won", duration: 84, ratio: 1.4, youKills: 6, gold: 420,
        yourDead: dead, yourSurvivors: live, yourFled: fled,
        theirDead: theirDead, theirSurvivors: theirLive,
        loot: loot, armourLoot: armourLoot,
      });
      await new Promise(r => setTimeout(r, 220));
      return !!document.querySelector("#stage.on button");
    })()` },

  /* AN EVENT CARD, and the wordiest one in the library on purpose. It is the
     screen the player answers most often that is made of nothing but prose. */
  { id: "event-card", why: "an events.js card — a headline, a body and the choices",
    set: `(async () => {
      const W = CBZ.warlord;
      if (!W.events || !W.events.fire) return false;
      if (W.phase() !== "campaign" && W.campaign && W.campaign.enter) W.campaign.enter();
      await new Promise(r => setTimeout(r, 200));
      if (W.events.cardOpen && W.events.cardOpen()) W.events.close();
      W.events.fire("rival");
      await new Promise(r => setTimeout(r, 220));
      return !!document.querySelector("#stage.on button");
    })()` },

  /* WAS `match-board`: the full-screen scoreboard, deleted with the rest of
     the match layer. Its successor is the map card — diplomacy moved onto the
     holding of the man you are dealing with — and the card is a harder layout
     case than the board ever was, because it is a FIXED bottom sheet that has
     to clear the home indicator while carrying up to four buttons. */
  { id: "map-diplomacy", why: "a rival's holding on the map: RIDE HERE / OFFER ALLIANCE",
    set: `(async () => {
      const W = CBZ.warlord, T = W.territory, A = W.warlords;
      if (!T || !A || !A.list().length) return false;
      const w = A.list().find(x => T.held(x.id).length) || A.list()[0];
      if (!T.isOpen()) T.toggle();
      await new Promise(r => setTimeout(r, 200));
      T.focus(w.home);
      await new Promise(r => setTimeout(r, 350));
      return !!document.querySelector("#wlTerrCardIn button");
    })()` },
];

/* ---- THE MEASUREMENT -----------------------------------------------------
   Runs inside the page. A "control" is anything a finger is meant to land on:
   a <button>, or something wearing one of this game's button classes. The
   hit test is the whole point — see rule 2 in the header. */
const MEASURE = (safeT, safeB, safeL, safeR, minHit) => `(() => {
  /* A SLIDER IS A CONTROL. This list was buttons only, so games/warlord.html's
     game-speed slider — a fixed layer at the top left, exactly where two
     other fixed layers already live — was invisible to all four rules. A
     range input is dragged by a thumb like everything else here and it is
     just as coverable. */
  const SEL = "button, .wl-btn, .vbtn, .vtoggle, [role=button], input[type=range]";
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = [];
  const nodes = Array.prototype.slice.call(document.querySelectorAll(SEL));
  const seen = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    /* SCROLLABLE CONTENT IS NOT A LAYOUT BUG. A control inside a panel that
       can still scroll is reachable by scrolling to it, so its position AT
       REST says nothing — flagging it would demand that every list in the
       game fit on an iPhone SE, which is not a thing a list can promise.
       What IS checkable, and is checked at the panel level below, is that the
       scroller RESERVES room at its end for the fixed furniture; without that
       the last row can never be scrolled clear of the match strip no matter
       how far you drag.

       So: inside a live scroller, skip the edge and cover tests and keep the
       ones that stay true at any scroll offset (hit size, control-on-control
       overlap). Outside one — or in a scroller with nothing left to scroll —
       every test applies. */
    let inLiveScroller = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowY === "auto" || ps.overflowY === "scroll") {
        if (p.scrollHeight > p.clientHeight + 2) inLiveScroller = true;
        const pr = p.getBoundingClientRect();
        if (r.bottom < pr.top - 1 || r.top > pr.bottom + 1) { inLiveScroller = true; break; }
      }
    }

    const name = (el.id ? "#" + el.id + " " : "") +
      (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 28);
    const rec = {
      name: name || el.className, cls: el.className,
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      off: "", covered: "", small: "", clash: "",
    };
    // 1. inside the viewport, inset by the safe area
    const edges = [];
    if (inLiveScroller) { rec.scrolls = true; }
    if (r.left < ${safeL} - 0.5) edges.push("left " + Math.round(r.left));
    if (r.top < ${safeT} - 0.5) edges.push("top " + Math.round(r.top));
    if (r.right > vw - ${safeR} + 0.5) edges.push("right +" + Math.round(r.right - (vw - ${safeR})));
    if (r.bottom > vh - ${safeB} + 0.5) edges.push("bottom +" + Math.round(r.bottom - (vh - ${safeB})));
    if (edges.length && !inLiveScroller) rec.off = edges.join(", ");
    // 3. big enough to hit
    if (Math.min(r.width, r.height) < ${minHit}) rec.small = Math.round(Math.min(r.width, r.height)) + "px";
    // 2. top thing at its own centre
    const cx = Math.max(1, Math.min(vw - 1, r.left + r.width / 2));
    const cy = Math.max(1, Math.min(vh - 1, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    if (!rec.off && !inLiveScroller && hit && hit !== el && !el.contains(hit)) {
      const h = hit;
      let owner = h;
      // name the layer that is covering it, not the leaf span
      for (let p = h; p && p !== document.body; p = p.parentElement) {
        if (p.id) { owner = p; break; }
      }
      rec.covered = (owner.id ? "#" + owner.id : owner.className || owner.tagName) +
        (h.className && !owner.id ? " ." + String(h.className).split(" ")[0] : "");
    }
    // 4. not sitting on another control
    for (let j = 0; j < seen.length; j++) {
      const s = seen[j];
      if (s.el.contains(el) || el.contains(s.el)) continue;
      const o = Math.max(0, Math.min(r.right, s.r.right) - Math.max(r.left, s.r.left)) *
                Math.max(0, Math.min(r.bottom, s.r.bottom) - Math.max(r.top, s.r.top));
      if (o > 0.30 * Math.min(r.width * r.height, s.r.width * s.r.height)) {
        if (inLiveScroller || s.scrolls) continue;   // scrolls apart, not a clash
        rec.clash = s.name;
        break;
      }
    }
    seen.push({ el: el, r: r, name: rec.name, scrolls: inLiveScroller });
    out.push(rec);
  }
  // and the fixed PANELS themselves must not run off the edge either
  const panels = [];
  ["hud", "verbs", "stage", "wb"].forEach(function (id) {
    const p = document.getElementById(id);
    if (!p) return;
    const cs = getComputedStyle(p);
    if (cs.display === "none") return;
    const r = p.getBoundingClientRect();
    if (r.width < 1) return;
    const bad = [];
    if (r.left < -0.5) bad.push("left " + Math.round(r.left));
    if (r.right > vw + 0.5) bad.push("right +" + Math.round(r.right - vw));
    if (r.bottom > vh + 0.5 && cs.overflowY !== "auto" && cs.overflowY !== "scroll") {
      bad.push("bottom +" + Math.round(r.bottom - vh));
    }
    if (bad.length) panels.push({ id: id, off: bad.join(", ") });
    /* THE RESERVE. A scroller has to end far enough above the fixed bottom
       furniture that its last row can be dragged clear of it — this is the
       assertion that makes skipping resting positions inside a scroller
       sound. Read off the live computed padding, not off the source. */
    if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
      const foot = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue("--wl-footer")) || 0;
      const safeB = ${safeB};
      const pad = parseFloat(cs.paddingBottom) || 0;
      if (r.bottom >= vh - 1 && pad < foot + safeB - 1) {
        panels.push({ id: id, off: "reserves " + Math.round(pad) + "px at its end, needs " +
          Math.round(foot + safeB) + "px to clear the bottom furniture" });
      }
    }
  });
  /* ---- RULE 5: THE SCREEN FITS -------------------------------------------
     The two surfaces this game puts CONTENT into, measured as content and
     not as a bounding box. #stage is a full screen (the aftermath, the
     armoury, an event card, the map); #vBody is the readout inside the verb
     rail. Both are declared overflow:auto, so both are perfectly happy to
     be four screens tall and neither reports a layout error when it is.

     scrollHeight - clientHeight IS the overflow, and it is the only number
     here that says how much has to be CUT. Reported per surface with the
     surface's own height beside it, so a fail reads "2 706 in a 590 px box"
     rather than an abstract px count.

     TOLERANCE 8 px, and it is rounding rather than mercy: sub-pixel line
     boxes and a border-box padding round up independently in Chrome, and a
     surface whose content ends exactly at its edge reports 1-3 px of
     overflow about half the time. 8 is under one line of 11 px type, so
     nothing a player could read hides inside it. */
  const scrolls = [];
  ["stage", "vBody"].forEach(function (id) {
    const n = document.getElementById(id);
    if (!n) return;
    const cs = getComputedStyle(n);
    if (cs.display === "none") return;
    const r = n.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    scrolls.push({
      id: id,
      over: Math.max(0, n.scrollHeight - n.clientHeight),
      box: n.clientHeight,
      content: n.scrollHeight,
    });
  });

  /* ---- THE CHARS COLUMN ---------------------------------------------------
     hudTextChars, the repo's own show-don't-tell metric, scoped to the
     surface that is actually asking to be read: the screen if one is up,
     the rail if not, plus the persistent strip either way because the player
     reads that on every screen. innerText, not textContent — it is the
     RENDERED text, so a display:none branch and a collapsed roster do not
     count against a screen that is not showing them. Whitespace stripped so
     that reformatting the markup cannot move the number. */
  let chars = 0;
  const surf = [];
  const st = document.getElementById("stage");
  if (st && getComputedStyle(st).display !== "none") surf.push(st);
  const vb = document.getElementById("verbs");
  if (vb && getComputedStyle(vb).display !== "none") surf.push(vb);
  const hd = document.getElementById("hud");
  if (hd && getComputedStyle(hd).display !== "none") surf.push(hd);
  for (let i = 0; i < surf.length; i++) {
    chars += (surf[i].innerText || "").replace(/\s+/g, "").length;
  }

  return { controls: out, panels: panels, scrolls: scrolls, chars: chars, vw: vw, vh: vh };
})()`;

const MIN_HIT = 28;
/* see RULE 5 in the header for why this is 8 and not 0 */
const SCROLL_TOL = 8;

function frameSpec(token) {
  const [name, orient] = token.split(":");
  const f = FRAMES[name];
  if (!f) throw new Error("unknown frame " + name);
  const land = orient === "landscape";
  return {
    id: token, name,
    w: land ? Math.max(f.w, f.h) : Math.min(f.w, f.h),
    h: land ? Math.min(f.w, f.h) : Math.max(f.w, f.h),
    dsf: f.dsf, mobile: f.mobile,
    /* In landscape the notch is on a SIDE, not the top, and the home
       indicator stays at the bottom but gets shorter. These are the real
       iOS/Android numbers, not guesses: a 59 px status inset becomes a 59 px
       left/right inset and the 34 px home bar becomes 21 px. */
    safeT: land ? 0 : f.safe.t,
    safeB: land ? Math.round(f.safe.b * 0.62) : f.safe.b,
    safeL: land ? f.safe.t : 0,
    safeR: land ? f.safe.t : 0,
  };
}

const run = async () => {
  const frames = (opt("--frames", "") || "").trim()
    ? opt("--frames").split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_FRAMES;

  const rig = await launch({ rafBudget: 0 });
  const fails = [];
  const charCensus = [];
  let measured = 0;

  try {
    for (const token of frames) {
      const F = frameSpec(token);
      await rig.send("Emulation.setDeviceMetricsOverride", {
        width: F.w, height: F.h, deviceScaleFactor: F.dsf, mobile: F.mobile,
      });
      await rig.open("games/warlord.html", "go=1&seed=1337&weather=off&sound=off");
      const up = await rig.wait(`window.CBZ && CBZ.warlord && CBZ.warlord.phase && CBZ.warlord.phase() === "campaign"`, 90000);
      if (!up) { fails.push({ frame: F.id, screen: "boot", what: "never reached the campaign" }); continue; }
      /* THE SAFE AREA, ASSERTED INTO THE PAGE. Chrome's device emulation has
         no notch and no home indicator, so env(safe-area-inset-*) is 0 in
         every frame here and a control tucked under either would measure as
         perfectly placed. games/warlord.html therefore reads its insets from
         --wl-safe-t/b/l/r, which fall through to env() on a real device — so
         setting them here makes every layer in the game lay itself out as if
         it were on that phone, and the measurement below is then honest. */
      await rig.evl(`(() => {
        const r = document.documentElement.style;
        r.setProperty("--wl-safe-t", "${F.safeT}px");
        r.setProperty("--wl-safe-b", "${F.safeB}px");
        r.setProperty("--wl-safe-l", "${F.safeL || 0}px");
        r.setProperty("--wl-safe-r", "${F.safeR || 0}px");
        return true;
      })()`);

      console.log(`\n${F.id}  ${F.w}x${F.h}`);
      for (const S of SCREENS) {
        let ok = false;
        try { ok = await rig.evl(S.set, true); } catch (e) { ok = false; }
        await sleep(260);
        if (!ok) { console.log(`  ${S.id.padEnd(20)} — not reachable, skipped`); continue; }
        const m = await rig.evl(MEASURE(F.safeT, F.safeB, F.safeL, F.safeR, MIN_HIT));
        measured += m.controls.length;
        const bad = m.controls.filter((c) => c.off || c.covered || c.small || c.clash);
        for (const p of m.panels) {
          fails.push({ frame: F.id, screen: S.id, what: `panel #${p.id} runs off ${p.off}` });
        }
        for (const c of bad) {
          const why = c.off ? "off-screen " + c.off
            : c.covered ? "covered by " + c.covered
            : c.small ? "too small to hit " + c.small
            : "overlaps " + c.clash;
          fails.push({ frame: F.id, screen: S.id, what: `"${c.name}" ${why}` });
        }
        /* RULE 5. A surface whose content is taller than the surface is a
           screen the player has to scroll, which is the thing being fixed. */
        const spill = (m.scrolls || []).filter((c) => c.over > SCROLL_TOL);
        for (const c of spill) {
          fails.push({ frame: F.id, screen: S.id,
            what: `#${c.id} does not fit — ${c.content}px of content in a ${c.box}px box, ${c.over}px below the fold` });
        }
        charCensus.push({ frame: F.id, screen: S.id, chars: m.chars,
          over: spill.reduce((n, c) => Math.max(n, c.over), 0) });
        const mark = bad.length || m.panels.length || spill.length ? "FAIL" : "ok  ";
        console.log(`  ${mark} ${S.id.padEnd(20)} ${String(m.controls.length).padStart(2)} controls  ` +
          `${String(m.chars).padStart(5)} chars` +
          (spill.length ? `  +${spill.map((c) => c.over).join("/")}px BELOW THE FOLD` : "") +
          (bad.length ? `  ${bad.length} bad` : ""));
        if (VERBOSE) {
          for (const c of m.controls) {
            console.log(`         ${c.name.padEnd(30)} ${c.x},${c.y} ${c.w}x${c.h}` +
              (c.off ? "  OFF " + c.off : "") + (c.covered ? "  COVERED " + c.covered : "") +
              (c.small ? "  SMALL " + c.small : "") + (c.clash ? "  CLASH " + c.clash : ""));
          }
        }
      }
    }
  } finally {
    await rig.close();
  }

  /* THE COPY CENSUS, ON THE SMALLEST FRAME ONLY. One column of numbers is
     the point; seven copies of it is a wall. The smallest frame is the one
     where a character costs the most, so it is the one worth a table. */
  const small = charCensus.filter((r) => r.frame === frames[0]);
  if (small.length) {
    console.log(`\nUI COPY on ${frames[0]} — rendered characters the player has to read`);
    for (const r of small) {
      console.log(`  ${r.screen.padEnd(20)} ${String(r.chars).padStart(5)} chars` +
        (r.over ? `   ${r.over}px below the fold` : "   fits"));
    }
    console.log(`  ${"TOTAL".padEnd(20)} ${String(small.reduce((n, r) => n + r.chars, 0)).padStart(5)} chars`);
  }

  console.log(`\n${measured} controls measured across ${frames.length} frames`);
  if (fails.length) {
    console.log(`\nWARLORD FITS: FAIL — ${fails.length} thing${fails.length === 1 ? "" : "s"} a player cannot press or cannot see\n`);
    for (const f of fails) console.log(`  ${f.frame.padEnd(22)} ${f.screen.padEnd(20)} ${f.what}`);
    process.exit(1);
  }
  console.log("\nWARLORD FITS OK — every control is on screen, uncovered and hittable, and every screen fits.");
};

run().catch((e) => { console.error(e); process.exit(1); });
