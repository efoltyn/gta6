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

   Frames: the standard family, portrait and landscape, because landscape on a
   phone is 390 px TALL and that is where a bottom rail with a body panel runs
   out of screen. Screens: the campaign, the encounter rail, the same rail
   with a live match strip under it (the actual bug), an outpost, the map, the
   armoury and the battle HUD.

     node tools/warlord-fits.mjs              # the gate
     node tools/warlord-fits.mjs --verbose    # print every control measured
     node tools/warlord-fits.mjs --frames laptop,iphone-16:landscape

   Exit 0 clean, 1 on any control that is off-screen, covered or too small.
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

  /* SECOND, AND BEFORE ANY MATCH IS OPENED. `encounter-in-match` below starts
     a demo match, and a live match PINS the clock at 1x by design (match.js —
     seven warlords share one wall clock), so this screen has to reach 64x
     before that happens. It leaves the island fast-forwarding behind every
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

  { id: "encounter-in-match", why: "THE REPORTED BUG — the same rail with the match strip live",
    set: `(async () => {
      const W = CBZ.warlord;
      if (!W.match || !W.match.demo) return false;
      W.match.demo({ n: 6 });
      await new Promise(r => setTimeout(r, 200));
      const b = W.makeBand({ size: 210, faction: "merc", x: W.state.you.x + 30, z: W.state.you.z + 30 });
      W.state.bands.push(b);
      W.army.encounter(b);
      await new Promise(r => setTimeout(r, 120));
      return !!document.querySelector("#verbs.on .vbtn") && !!document.querySelector("#wl-match.on");
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

  { id: "match-board", why: "the openfront board: every warlord, every offer",
    set: `(async () => {
      const W = CBZ.warlord;
      if (!W.match || !W.match.board) return false;
      if (!W.match.live()) W.match.demo({ n: 6 });
      W.match.board();
      await new Promise(r => setTimeout(r, 200));
      return !!document.querySelector("#stage.on button");
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
  ["hud", "verbs", "stage", "wl-match", "wb"].forEach(function (id) {
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
  return { controls: out, panels: panels, vw: vw, vh: vh };
})()`;

const MIN_HIT = 28;

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
        const mark = bad.length || m.panels.length ? "FAIL" : "ok  ";
        console.log(`  ${mark} ${S.id.padEnd(20)} ${m.controls.length} controls` +
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

  console.log(`\n${measured} controls measured across ${frames.length} frames`);
  if (fails.length) {
    console.log(`\nWARLORD FITS: FAIL — ${fails.length} control${fails.length === 1 ? "" : "s"} a player cannot press\n`);
    for (const f of fails) console.log(`  ${f.frame.padEnd(22)} ${f.screen.padEnd(20)} ${f.what}`);
    process.exit(1);
  }
  console.log("\nWARLORD FITS OK — every control is on screen, uncovered and hittable.");
};

run().catch((e) => { console.error(e); process.exit(1); });
