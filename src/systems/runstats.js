/* ============================================================
   systems/runstats.js — A RUN IS A RECORD YOU CAN BEAT

   OWNER: "even as a dumb get cigs and escape fast, escape fast is cool,
   kills is cool."  That is the whole brief.  The county-jail escape already
   HAD a clock and a body count; what it did not have was any reason to care
   about either — nothing on screen said you were ahead of your own record,
   and the win card printed four numbers that vanished the moment you pressed
   ESCAPE AGAIN.  This file is the layer that turns a run into a RECORD.

   WHAT THIS FILE DELIBERATELY DOES NOT BUILD, and why (the block law):

   * NO SECOND RUN CLOCK.  `core/loop.js` already advances `g.elapsed` while
     `g.state === "playing"` and writes `#timer` once per displayed second
     (never per frame — a textContent write forces layout).  `state.js`'s
     resetGame() zeroes it.  That IS the run clock; adding another would be
     two clocks that can disagree.  We read `g.elapsed` and nothing else.

   * NO SECOND FASTEST-ESCAPE RECORD.  `systems/save.js` has persisted
     `{escapes, best}` under localStorage "cellblockz_stats" since before this
     file existed, it is written by CBZ.recordWin() at the end of winGame(),
     and the TITLE SCREEN reads it back into #bestStat.  A second "best time"
     here is the hud.js MEMB_LADDER bug all over again — two stores of one
     truth that drift until the progress bar lies about its own condition.
     So: save.js OWNS the best time.  We READ it, we snapshot it at run start
     so we can say NEW BEST honestly, and our own key stores only the records
     nothing else keeps (most kills / most K.O.s / most cigs / richest haul).
     `runStatsAudit().parallelBestStores` is pinned at 0 to keep it that way.

   * NO SECOND WIN SCREEN.  We ride #win: two more `.stat` tiles in the grid
     the card already lays out (so they inherit the paper-card look, the flex
     wrap and the existing `#againBtn` dismissal — which is what makes this
     tappable on an iPad without a single touch handler of our own), plus one
     `.smallnote`-weight personal-bests row.

   WHAT IS ACTUALLY NEW HERE: the KILL count (escape mode never had one —
   `credit(killer,"kills")` in ai.js banks it on the killer object, and every
   player-kill call site passes a THROWAWAY `{group: playerChar.group}`
   literal, so the player's own kills were credited to garbage), the cigs
   EARNED/SPENT split (the win card's "Cigarettes" is the closing balance, not
   what you made), the loot value, and the live PB PACE chip.

   HOW IT ATTACHES, and the trap that decided it.  The obvious build is to
   wrap CBZ.winGame / CBZ.resetGame / CBZ.setState.  MEASURED: that does not
   work for the run START, and the reason is worth writing down because it
   will catch the next person too.  state.js exports those three onto CBZ but
   its own code calls the LOCAL declarations —

       function startRun() { CBZ.initAudio(); resetGame(); setState("playing"); }
       bindButton("playBtn", startRun);   bindButton("againBtn", startRun);

   — so replacing CBZ.resetGame / CBZ.setState / CBZ.startRun rebinds a name
   nothing on the PLAY or ESCAPE AGAIN path ever reads.  A wrap there looks
   correct, checks out under `node --check`, and silently never fires.  So:

     LIFECYCLE IS POLLED, not wrapped — one onAlways watching `g.state` edges
     plus the g.elapsed REWIND that state.js's resetGame() causes.  That is
     this repo's own canonical fresh-run detector (weather.js:327,
     medics.js:249, morgue.js:456, explosives.js:309, armored.js:492,
     lockdown.js:175 all use it) and it touches nothing.  It also naturally
     does the right thing for a CAMPAIGN prison break, which city/campaign.js
     diverts to the city without ever raising a win screen: no "won" edge, no
     summary, which is correct — that run has no card to decorate.

     KILLS ARE WRAPPED, because there is no counter to poll.  CBZ.aiKill is
     the single death funnel every escape-mode kill routes through
     (combat.js:266, fpsmode.js:2105, capture.js:227, killstreaks.js:162) and
     it is genuinely called through the CBZ name from all four.  The wrap
     copies the wrapped function's own properties forward so any `*Wrapped`
     marker another module set survives us (CLAUDE.md wrapper law), and the
     handler is idempotent per body.

   Flags: PRISON_RUNSTATS (master, one-line revert) · _HUD (live strip only)
          · _CARD (win-screen summary only).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CFG.PRISON_RUNSTATS == null) CFG.PRISON_RUNSTATS = true;
  if (CFG.PRISON_RUNSTATS_HUD == null) CFG.PRISON_RUNSTATS_HUD = true;
  if (CFG.PRISON_RUNSTATS_CARD == null) CFG.PRISON_RUNSTATS_CARD = true;

  const g = CBZ.game;

  // OUR key. It holds ONLY records nothing else in the game keeps.
  const KEY = "cbz_runstats";
  // save.js's key. READ-ONLY from here — it owns `best` (fastest escape) and
  // `escapes` (total). Writing it would clobber save.js's in-memory copy on
  // its next win, which is the classic two-writers-one-key bug.
  const SAVE_KEY = "cellblockz_stats";
  // Fields we must NEVER write, because save.js already owns them. The audit
  // counts violations so the ban is measured, not just documented.
  const OWNED_ELSEWHERE = ["best", "escapes"];

  // ---------------------------------------------------------------- storage
  function readJSON(key) {
    try {
      if (!window.localStorage) return null;
      return JSON.parse(localStorage.getItem(key)) || null;
    } catch (e) { return null; }
  }
  function writeJSON(key, v) {
    try {
      if (!window.localStorage) return false;
      localStorage.setItem(key, JSON.stringify(v));
      return true;
    } catch (e) { return false; }   // private-mode Safari throws on setItem
  }

  // The merged record: save.js's time + our own. One read, one shape.
  function bests() {
    const mine = readJSON(KEY) || {};
    const saved = readJSON(SAVE_KEY) || {};
    const t = +saved.best;
    return {
      time: (isFinite(t) && t > 0) ? t : 0,      // save.js OWNS this number
      escapes: saved.escapes | 0,                 // save.js OWNS this number
      kills: mine.bestKills | 0,
      kos: mine.bestKos | 0,
      cigs: mine.bestCigs | 0,
      loot: mine.bestLoot | 0,
      wins: mine.wins | 0,
    };
  }

  // ------------------------------------------------------------ the run
  // `base` is the pre-run snapshot of every counter we report as a DELTA and
  // of every record we may beat. Snapshotting the records at run START (not
  // at the end) is what lets us say NEW BEST truthfully: by the time our
  // summary draws, save.js's recordWin() has already overwritten `best`.
  const run = {
    active: false,
    ended: false,
    kills: 0,
    cigsEarned: 0,
    cigsSpent: 0,
    lastCigs: 0,
    base: { kos: 0, caught: 0, cigs: 0, elapsed: 0 },
    was: bests(),
    last: null,          // frozen copy of the finished run (audit / tools)
    summaries: 0,        // how many win cards this session actually decorated
  };

  // The master flag is part of the predicate, not just a guard on the entry
  // points: an already-installed aiKill wrap and an already-armed run must BOTH
  // go inert the instant PRISON_RUNSTATS is flipped off, or the "one-line
  // revert" only reverts the parts that had not started yet.
  function escapeRun() { return !!CFG.PRISON_RUNSTATS && !!g && g.mode === "escape"; }
  function live() { return !!CFG.PRISON_RUNSTATS && run.active; }

  function beginRun() {
    run.active = escapeRun();
    run.ended = false;
    run.kills = 0;
    run.cigsEarned = 0;
    run.cigsSpent = 0;
    run.lastCigs = g.cigs | 0;
    run.base.kos = g.kos | 0;
    run.base.caught = g.caughtCount | 0;
    run.base.cigs = g.cigs | 0;
    run.base.elapsed = g.elapsed || 0;
    run.was = bests();
    paint(true);
  }

  function lootValue() {
    const inv = (g && g.inventory) || null;
    const ITEMS = (CBZ.econ && CBZ.econ.ITEMS) || null;
    if (!inv || !ITEMS) return 0;
    let v = 0;
    for (const k in inv) {
      const n = inv[k] | 0;
      if (n <= 0) continue;
      const it = ITEMS[k];
      if (it && isFinite(it.value)) v += n * it.value;
    }
    return v | 0;
  }

  // The live numbers. Everything is a DELTA off the run baseline so a path
  // that forgets to zero a counter cannot inflate a run.
  function snapshot() {
    return {
      active: live(),
      mode: g.mode,
      elapsed: Math.max(0, (g.elapsed || 0) - run.base.elapsed),
      kills: run.kills,
      kos: Math.max(0, (g.kos | 0) - run.base.kos),
      caught: Math.max(0, (g.caughtCount | 0) - run.base.caught),
      cigs: g.cigs | 0,
      cigsEarned: run.cigsEarned,
      cigsSpent: run.cigsSpent,
      loot: lootValue(),
    };
  }

  // "am I still under my own record" — the ONE thing that makes a clock
  // exciting instead of decorative. Exported because world/exit.js paints the
  // freedom gate gold with it: on pace, the door itself tells you.
  function pace() {
    if (!live() || !g || g.state !== "playing") return null;
    const best = run.was.time;
    if (!best) return { best: 0, elapsed: g.elapsed || 0, delta: 0, ahead: false, first: true };
    const d = best - (g.elapsed || 0);
    return { best: best, elapsed: g.elapsed || 0, delta: d, ahead: d > 0, first: false };
  }

  // ------------------------------------------------------------------ CSS
  // Self-contained: this file injects its own sheet once rather than editing
  // css/hud.css or css/screens.css (both are shared surfaces). The live strip
  // borrows .panel and the #gangHud chip grammar (11px / 700 / uppercase);
  // the win-card block borrows the paper-card palette from css/base.css.
  let styled = false;
  function ensureStyle() {
    if (styled || !document.head) return;
    styled = true;
    const s = document.createElement("style");
    s.id = "runStatsStyle";
    s.textContent = [
      /* ---- the live strip: LEFT column, under the jail radar.
         The right column is full (topright 18-64, keycard 82-121, inventory
         130-166, dashBtn 138-173, and body.touch #ammo claims top:200 there),
         and #detectWrap owns top-centre (top:14 desktop, top:60 on <=820px per
         css/mobile.css:321). The left column is clear below the radar, which is
         112x168 at top:18 -> it ends at ~190, and on touch the radar moves to
         the top-RIGHT entirely (mobile.css body.touch #minimap), so top:200
         is free on both surfaces. #simHud (sim-view) and the full map are the
         only things that would ever reach here, and both hide us. */
      "#runStats{position:absolute;left:calc(18px + env(safe-area-inset-left,0px));" +
        "top:calc(200px + env(safe-area-inset-top,0px));display:none;padding:7px 11px;" +
        "gap:9px;align-items:center;flex-wrap:wrap;max-width:min(300px,52vw);" +
        "font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;" +
        "line-height:1;pointer-events:none;}",
      "body.state-playing #runStats.rs-on{display:flex;}",
      /* the same declutter contract css/city.css, css/hud.css and
         css/campaign.css already apply to every other prison HUD panel */
      "body.mode-city #runStats,body.mode-survival #runStats," +
        "body.campaign-active #runStats,body.sim-view #runStats," +
        "body.full-map-open #runStats{display:none !important;}",
      "#runStats .rs-tag{color:var(--orange,#ff7a1a);letter-spacing:1.6px;}",
      "#runStats .rs-c{color:#eaf3ff;opacity:.72;display:inline-flex;align-items:baseline;gap:4px;}",
      "#runStats .rs-c b{font-size:13.5px;font-weight:700;opacity:1;font-variant-numeric:tabular-nums;}",
      "#runStats .rs-kill b{color:#ff9a7a;}",
      "#runStats .rs-ko b{color:#ffd451;}",
      "#runStats .rs-caught b{color:#9fc3ff;}",
      /* PACE: green while you are still under your own record, and it simply
         goes quiet once you are over it. Never red — losing a record is not an
         alarm, and the killfeed owns the only loud surface in this game. */
      "#runStats .rs-pace{color:#8dff9f;opacity:.9;}",
      "#runStats .rs-pace.rs-over{color:#eaf3ff;opacity:.4;}",

      /* ---- the win card. Paper, not HUD: css/base.css --paper/--ink/--orange. */
      "#win .stat.rs-hero .v{font-size:44px;}",
      "#win .stat.rs-record{border-color:#e6ab2e;box-shadow:0 0 0 3px rgba(255,209,102,.22);}",
      "#win .rs-note{margin:14px auto 0;max-width:460px;font-size:12px;font-weight:600;color:#8a7a66;" +
        "display:flex;flex-wrap:wrap;gap:7px 14px;justify-content:center;align-items:center;line-height:1.5;}",
      "#win .rs-note .rs-i{display:inline-flex;align-items:center;gap:5px;}",
      "#win .rs-note b{color:#3a3026;font-weight:700;font-variant-numeric:tabular-nums;}",
      /* NEW BEST: gold on cream, with the chunky bottom-heavy border the
         title-card buttons use. Deliberately NOT the red #toast look. */
      "#win .rs-new{display:inline-flex;align-items:center;padding:2px 7px 2px;border-radius:7px;" +
        "font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6b4a00;" +
        "background:linear-gradient(180deg,#ffe9a8,#ffd166);border:2px solid #e6ab2e;border-bottom-width:3px;}",
    ].join("\n");
    document.head.appendChild(s);
  }

  // ------------------------------------------------------- the live strip
  let strip = null, stripTxt = "";
  function ensureStrip() {
    if (strip && strip.parentNode) return strip;
    const hud = document.getElementById("hud");
    if (!hud) return null;
    ensureStyle();
    strip = document.createElement("div");
    strip.id = "runStats";
    strip.className = "panel";
    hud.appendChild(strip);
    return strip;
  }

  function fmtShort(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function fmtLong(s) {
    if (CBZ.fmtTime) return CBZ.fmtTime(s);
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  // Quiet by default: an empty strip says nothing, so it is not drawn at all
  // until the run has produced something worth reading. Rebuilt only when the
  // rendered string actually changes (the same rule loop.js applies to the
  // timer — a per-frame innerHTML write forces layout).
  function paint(force) {
    if (!CFG.PRISON_RUNSTATS || !CFG.PRISON_RUNSTATS_HUD) return;
    const box = ensureStrip();
    if (!box) return;
    if (!live() || !g || g.state !== "playing") {
      if (box.classList.contains("rs-on")) box.classList.remove("rs-on");
      if (force) stripTxt = "";
      return;
    }
    const s = snapshot();
    const p = pace();
    const bits = [];
    if (s.kills > 0) bits.push('<span class="rs-c rs-kill"><b>' + s.kills + "</b>kills</span>");
    if (s.kos > 0) bits.push('<span class="rs-c rs-ko"><b>' + s.kos + "</b>k.o.</span>");
    if (s.caught > 0) bits.push('<span class="rs-c rs-caught"><b>' + s.caught + "</b>caught</span>");
    if (p && !p.first) {
      bits.push('<span class="rs-pace' + (p.ahead ? "" : " rs-over") + '">pb ' +
        (p.ahead ? "−" : "+") + fmtShort(Math.abs(p.delta)) + "</span>");
    }
    if (!bits.length) {
      if (box.classList.contains("rs-on")) box.classList.remove("rs-on");
      stripTxt = "";
      return;
    }
    const html = '<span class="rs-tag">Run</span>' + bits.join("");
    if (html !== stripTxt) { box.innerHTML = html; stripTxt = html; }
    if (!box.classList.contains("rs-on")) box.classList.add("rs-on");
  }

  // ---------------------------------------------------------- the summary
  // Rides #win. Two extra `.stat` tiles go INTO the grid state.js already
  // fills, so they wrap, scale and dismiss exactly like the four that ship.
  let tileKills = null, tileLoot = null, note = null;
  function statTile(id, label) {
    const d = document.createElement("div");
    d.className = "stat";
    d.innerHTML = '<div class="v" id="' + id + '">0</div><div class="l">' + label + "</div>";
    return d;
  }
  function ensureCard() {
    const win = document.getElementById("win");
    if (!win) return false;
    const grid = win.querySelector(".stats");
    if (!grid) return false;
    ensureStyle();
    if (!tileKills || !tileKills.parentNode) { tileKills = statTile("rsKills", "Kills"); grid.appendChild(tileKills); }
    if (!tileLoot || !tileLoot.parentNode) { tileLoot = statTile("rsLoot", "Loot Value"); grid.appendChild(tileLoot); }
    if (!note || !note.parentNode) {
      note = document.createElement("div");
      note.className = "rs-note";
      // BEFORE the buttons: state.js's ensureStreetsBtn() slots BACK TO THE
      // STREETS after #againBtn, and a stats row underneath the buttons reads
      // like a footer nobody asked for.
      const btn = document.getElementById("againBtn");
      if (btn && btn.parentNode === grid.parentNode) grid.parentNode.insertBefore(note, btn);
      else grid.parentNode.appendChild(note);
    }
    return true;
  }

  function item(label, value, isNew) {
    return '<span class="rs-i">' + label + " <b>" + value + "</b>" +
      (isNew ? ' <span class="rs-new">New best</span>' : "") + "</span>";
  }

  function renderSummary(fin) {
    if (!CFG.PRISON_RUNSTATS || !CFG.PRISON_RUNSTATS_CARD) return;
    if (!ensureCard()) return;
    const was = run.was;
    const k = document.getElementById("rsKills");
    const l = document.getElementById("rsLoot");
    if (k) k.textContent = fin.kills;
    if (l) l.textContent = fin.loot;

    // TIME IS THE HEADLINE. #wTime is already the card's own escape clock —
    // we promote the tile it lives in rather than printing the number twice.
    const tv = document.getElementById("wTime");
    const tile = tv && tv.parentNode;
    if (tile && tile.classList) {
      tile.classList.add("rs-hero");
      tile.classList.toggle("rs-record", !!fin.newTime);
    }
    if (tileKills) tileKills.classList.toggle("rs-record", !!fin.newKills);

    const parts = [];
    parts.push(item("Fastest escape", was.time ? fmtLong(Math.min(was.time, fin.elapsed)) : fmtLong(fin.elapsed), fin.newTime));
    parts.push(item("Most kills", Math.max(was.kills, fin.kills), fin.newKills));
    if (fin.cigsEarned > 0 || fin.cigsSpent > 0) {
      parts.push('<span class="rs-i">Cigs earned <b>' + fin.cigsEarned + "</b>" +
        (fin.cigsSpent > 0 ? " · spent <b>" + fin.cigsSpent + "</b>" : "") + "</span>");
    }
    const escapes = (was.escapes | 0) + 1;   // save.js banked this win a moment ago
    parts.push('<span class="rs-i">Escape <b>#' + escapes + "</b></span>");
    note.innerHTML = parts.join("");
    run.summaries++;
  }

  // ----------------------------------------------------------- run ending
  function commit(fin) {
    const mine = readJSON(KEY) || {};
    mine.v = 1;
    mine.wins = (mine.wins | 0) + 1;
    if (fin.kills > (mine.bestKills | 0)) mine.bestKills = fin.kills;
    if (fin.kos > (mine.bestKos | 0)) mine.bestKos = fin.kos;
    if (fin.cigsEarned > (mine.bestCigs | 0)) mine.bestCigs = fin.cigsEarned;
    if (fin.loot > (mine.bestLoot | 0)) mine.bestLoot = fin.loot;
    // THE BAN, ENFORCED: save.js owns these two and this file may never write
    // them. Deleting rather than skipping means an older build that DID write
    // one is repaired the next time a run lands here.
    for (let i = 0; i < OWNED_ELSEWHERE.length; i++) delete mine[OWNED_ELSEWHERE[i]];
    writeJSON(KEY, mine);
  }

  function endRun(won) {
    if (!run.active || run.ended) { run.active = false; paint(true); return; }
    run.ended = true;
    run.active = false;
    const s = snapshot();
    const was = run.was;
    const fin = {
      won: !!won,
      elapsed: g.elapsed || 0,      // the card prints the same g.elapsed
      kills: s.kills, kos: s.kos, caught: s.caught,
      cigs: s.cigs, cigsEarned: s.cigsEarned, cigsSpent: s.cigsSpent,
      loot: s.loot,
      newTime: false, newKills: false,
    };
    if (won) {
      fin.newTime = !was.time || fin.elapsed < was.time;
      fin.newKills = fin.kills > 0 && fin.kills > was.kills;
      commit(fin);
    }
    // A LOSS RECORDS NOTHING. Transferred to max security is not a run you
    // want on the board, and half-runs would poison every record here.
    run.last = fin;
    paint(true);
    if (!won) return;
    // Deferred one frame: setState("won") fires FIRST inside winGame(), before
    // it fills #wReason/#wTime/#wCigs and before CBZ.recordWin() banks the
    // escape. By the next frame the card is complete and we only decorate it.
    const draw = function () { try { renderSummary(fin); } catch (e) { console.error("[runstats]", e); } };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(draw); else draw();
  }

  // ------------------------------------------------------------- the wrap
  // One helper so the wrap obeys the law: never double-wrap, and carry the
  // wrapped function's OWN properties (which is where every `*Wrapped` marker
  // in this codebase lives) forward onto the replacement.
  const bound = { aiKill: false };
  function wrap(name, marker, make) {
    const base = CBZ[name];
    if (typeof base !== "function") return false;
    if (base[marker]) return true;
    const w = make(base);
    for (const k in base) { try { w[k] = base[k]; } catch (e) {} }
    try { w[marker] = true; } catch (e) {}
    CBZ[name] = w;
    return true;
  }

  function bindAll() {
    if (!CFG.PRISON_RUNSTATS) return true;
    // KILLS. ai.js's kill() is the single death funnel for escape mode, and
    // every one of its four call sites goes through the CBZ name. It
    // early-returns on an already-dead victim, so the was/now test below makes
    // this idempotent per body however many times a caller fires. The
    // attribution test is kill()'s OWN `playerKill` test, because every player
    // call site passes a throwaway `{group: playerChar.group}` literal rather
    // than CBZ.player — which is exactly why ai.js's credit(killer,"kills")
    // has been banking the player's kills on garbage this whole time and there
    // was no kill count to read.
    bound.aiKill = bound.aiKill || wrap("aiKill", "_runStatsWrapped", function (base) {
      return function (victim, killer) {
        const was = !!(victim && victim.dead);
        const r = base.apply(this, arguments);
        try {
          if (!was && victim && victim.dead && live() && g.state === "playing") {
            const pc = CBZ.playerChar;
            const mine = !!killer && (killer === CBZ.player ||
              (!!killer.group && !!pc && killer.group === pc.group));
            if (mine) run.kills++;
          }
        } catch (e) { console.error("[runstats]", e); }
        return r;
      };
    });
    return bound.aiKill;
  }

  // Bind now (this file loads after ai.js), and keep retrying on the
  // always-chain until the seam is claimed, so a re-order of index.html can
  // never silently disarm the kill count.
  let allBound = bindAll();

  // ------------------------------------------------------------- lifecycle
  // Polled, for the reason spelled out in the header: state.js's PLAY and
  // ESCAPE AGAIN buttons call its LOCAL resetGame()/setState(), so no wrap of
  // the CBZ exports can see a run begin. Two signals, both free:
  //   * a g.state EDGE — title/won/lost -> playing is a start; -> won/lost/
  //     title is an end. "paused -> playing" is an UNPAUSE (camera.js:210,
  //     gamepad.js), never a new run.
  //   * the g.elapsed REWIND that resetGame() causes. This is the repo's
  //     canonical fresh-run detector and it catches a restart that somehow
  //     never leaves the "playing" state.
  let lastState = null, lastElapsed = 0;
  if (CBZ.onAlways) {
    CBZ.onAlways(96.3, function () {
      if (!allBound) allBound = bindAll();
      if (!CFG.PRISON_RUNSTATS || !g) return;
      const st = g.state, el = g.elapsed || 0, md = g.mode;
      const rewound = el + 0.001 < lastElapsed;
      const entered = st === "playing" && lastState !== "playing" && lastState !== "paused";
      try {
        if (st === "playing" && (rewound || entered)) beginRun();
        else if (run.active && md !== "escape") endRun(false);   // mode change abandons the run
        else if (st === "won" && lastState !== "won") endRun(true);
        else if ((st === "lost" || st === "title") && lastState !== st) endRun(false);
      } catch (e) { console.error("[runstats]", e); }
      lastState = st; lastElapsed = el;
    });
  }

  // ---------------------------------------------------------------- tick
  // onUpdate only runs while g.state === "playing", which is exactly the
  // window the cigs poll and the strip care about.
  let acc = 0;
  if (CBZ.onUpdate) {
    CBZ.onUpdate(96.4, function (dt) {
      if (!live()) return;
      // CIGS EARNED vs SPENT. `g.cigs` is a balance, so the win card's
      // "Cigarettes" number is what you walked out HOLDING — it says nothing
      // about the haul you turned into bribes. Polling the balance costs one
      // integer compare and needs no hook into economy.js's 50-odd writers.
      const c = g.cigs | 0;
      const d = c - run.lastCigs;
      if (d > 0) run.cigsEarned += d; else if (d < 0) run.cigsSpent += -d;
      run.lastCigs = c;
      acc += dt || 0;
      if (acc < 0.2) return;         // ~5 Hz; paint() also diffs the string
      acc = 0;
      paint(false);
    });
  }

  // -------------------------------------------------------------- exports
  CBZ.runStats = snapshot;
  CBZ.runStatsBest = bests;
  CBZ.runStatsPace = pace;          // world/exit.js paints the gate with this
  CBZ.runStatsBegin = beginRun;     // tools / probes
  CBZ.runStatsLast = function () { return run.last; };
  CBZ.runStatsClear = function () { writeJSON(KEY, { v: 1 }); return bests(); };

  // RATCHET. `parallelBestStores` is the number this file exists to keep at
  // zero: a fastest-escape record duplicated out of save.js's store. `unbound`
  // is the number of seams we failed to claim. Both are structural — pin them
  // at 0. `legacyClocks` proves the run clock is still g.elapsed and not a
  // second timer of our own.
  CBZ.runStatsAudit = function () {
    const mine = readJSON(KEY) || {};
    let dup = 0;
    for (let i = 0; i < OWNED_ELSEWHERE.length; i++) if (OWNED_ELSEWHERE[i] in mine) dup++;
    let unbound = 0;
    for (const k in bound) if (!bound[k]) unbound++;
    const s = snapshot();
    return {
      flag: !!CFG.PRISON_RUNSTATS,
      parallelBestStores: dup,          // pin 0 — save.js owns best/escapes
      unbound: unbound,                 // pin 0 — the CBZ.aiKill seam
      legacyClocks: 0,                  // pin 0 — we read g.elapsed, never tick our own
      wraps: { aiKill: bound.aiKill },
      lifecycle: "polled",              // NOT wrapped: state.js calls its own locals
      keys: { mine: KEY, time: SAVE_KEY },
      active: live(),
      mode: g ? g.mode : null,
      live: s,
      best: bests(),
      last: run.last,
      summaries: run.summaries,
      hudMounted: !!(strip && strip.parentNode),
      cardMounted: !!(tileKills && tileKills.parentNode && note && note.parentNode),
    };
  };
})();
