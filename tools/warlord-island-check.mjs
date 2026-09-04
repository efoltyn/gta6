#!/usr/bin/env node
/* ============================================================
   tools/warlord-island-check.mjs — IS THE ISLAND A GAME.

   tools/warlord-check.mjs plays three hundred campaigns in plain node and
   proves the ECONOMY works. It cannot see any of the following, because none
   of it is in core.js:

     · whether the rival warlords exist on the map at all
     · whether one won skirmish ends the run
     · whether holding ground gives you men
     · whether holding most of the island wins
     · what the prisoner screen actually offers

   Every one of those was broken on 2026-09-04 and every one of them was
   invisible to every check in this repo. The worst of them, and the reason
   this file exists:

     match.js raised fourteen warlords with fourteen holdings and ZERO
     COLUMNS — its `COLUMN_CEILING = 150` was compared against S.bands.length
     on an island that spawns 444 parties, so raiseColumn() returned null every
     time and no rival warlord had ever ridden. events.js then baselined each
     of them at size0 = max(1, 0) = 1 and marked one BROKEN at
     `men <= max(4, size0 * 0.15)` — true at zero men — so the first checkFour
     after the first aftermath broke all four and printed THE ISLAND IS YOURS
     on day one after one fight with two dead. That is the owner's screenshot.

   So this boots the real page and asks the five questions, printing the
   numbers rather than asserting a mood:

     a. every living warlord has at least one column with real men in it
     b. one won battle plus its aftermath does NOT end the run, and does not
        mark anybody broken
     c. ten dawns: your provinces raise levies into their garrisons and the
        rivals' columns are topped up from theirs
     d. hold 80% of the provinces (T.winTarget, derived — never a typed 32)
        and the run is won
     e. the aftermath offers exactly three prisoner verbs, and they are the
        three the design says

     node tools/warlord-island-check.mjs
     node tools/warlord-island-check.mjs --seed 90210

   Exit 0 clean, 1 on any failure.
============================================================ */
import { launch } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = opt("--seed", "1337");

const fails = [];
const notes = [];
const ok = (cond, label, detail) => {
  if (cond) { notes.push("  ok    " + label + (detail ? "   " + detail : "")); return true; }
  fails.push(label + (detail ? "   " + detail : ""));
  notes.push("  FAIL  " + label + (detail ? "   " + detail : ""));
  return false;
};

const run = async () => {
  const rig = await launch({ rafBudget: 0 });
  try {
    const url = await rig.open("games/warlord.html", `go=1&seed=${SEED}&weather=off&sound=off`);
    console.log("booting " + url);
    const up = await rig.wait(
      `window.__warlordReady === true && CBZ.warlord.phase && CBZ.warlord.phase() === "campaign"`, 180000);
    if (!up) { fails.push("never reached the campaign phase"); throw new Error("no boot"); }
    /* the island raises its bands and its warlords over the first frames;
       territory:ready fires before match.js has filled a single column. */
    await rig.wait(`CBZ.warlord.warlords.audit().columns > 0`, 60000);

    /* ---- a. THE RIVALS RIDE ------------------------------------------- */
    const a = await rig.evl(`(() => {
      const W = CBZ.warlord, M = W.warlords;
      const rows = M.list().map(function (w) {
        const cols = M.columns(w.id);
        let men = 0;
        for (let i = 0; i < cols.length; i++) men += cols[i].men.length;
        return { id: w.id, alive: w.alive, held: W.territory.held(w.id).length,
                 cols: cols.length, men: men,
                 sizes: cols.map(function (c) { return c.men.length; }) };
      });
      const live = rows.filter(function (r) { return r.alive; });
      let lo = 1e9, hi = 0;
      live.forEach(function (r) { r.sizes.forEach(function (n) { lo = Math.min(lo, n); hi = Math.max(hi, n); }); });
      return { audit: M.audit(), rows: rows,
               noColumn: live.filter(function (r) { return !r.cols; }).length,
               noMen: live.filter(function (r) { return !r.men; }).length,
               lo: lo === 1e9 ? 0 : lo, hi: hi, live: live.length };
    })()`);
    console.log("  warlords: " + JSON.stringify(a.audit));
    ok(a.live > 0, "the island raised rival warlords", a.live + " alive");
    ok(a.noColumn === 0, "every living warlord has at least one column",
       a.noColumn + " of " + a.live + " ride nothing");
    ok(a.noMen === 0, "…and there are real men in it", a.noMen + " columns of nobody");
    ok(a.lo >= 30 && a.hi <= 220, "a column is a company, not a crew or a horde",
       a.lo + "–" + a.hi + " men");
    ok(a.audit.columnless === 0, "match.js's own audit agrees", "columnless " + a.audit.columnless);

    /* ---- b. ONE BATTLE DOES NOT END THE RUN --------------------------- */
    const b = await rig.evl(`(() => {
      const W = CBZ.warlord, S = W.state;
      /* a real column of your own, so the fight is a fight and the survivors
         are worth taking — the day-one warlord alone with a pistol wins by
         killing everybody, which leaves no prisoner screen to look at. */
      for (let i = 0; i < 60; i++) W.addSoldier(W.makeSoldier(i % 3 ? "soldier" : "veteran", "ak47"));
      const band = S.bands.filter(function (x) {
        return !x.warlordId && x.men.length > 14 && x.men.length < 40;
      })[0];
      if (!band) return { err: "no band of a fightable size on the island" };
      const before = { day: S.day, over: W.events.audit().over };
      const r = W.battle.resolve({ band: band });
      return { outcome: r.outcome, day: S.day, before: before,
               prisoners: S.prisoners.length, phase: W.phase(),
               over: W.events.audit().over,
               board: W.events.audit().board, land: W.events.land(),
               out: W.warlords.leaderboard().filter(function (x) { return x.kind === "warlord" && x.out; }).length };
    })()`);
    if (b.err) fails.push(b.err);
    console.log("  battle: " + JSON.stringify({ outcome: b.outcome, prisoners: b.prisoners, over: b.over, land: b.land }));
    ok(b.outcome === "won", "the staged battle was a win", String(b.outcome));
    // the run-ending check is deferred by a tick inside events.js; let it land
    await new Promise((r) => setTimeout(r, 1200));
    const b2 = await rig.evl(`(() => {
      const W = CBZ.warlord;
      return { over: W.events.audit().over, phase: W.phase(),
               out: W.warlords.leaderboard().filter(function (x) { return x.kind === "warlord" && x.out; }).length,
               fell: W.events.audit().fell };
    })()`);
    ok(b2.over === null, "one won battle does not end the run", "over = " + b2.over);
    ok(b2.phase !== "over", "…and the game did not take the end screen", "phase " + b2.phase);
    ok(b2.out === 0 && b2.fell === 0, "…and marked nobody broken",
       b2.out + " out, " + b2.fell + " recorded fallen");

    /* ---- e. THE PRISONER SCREEN --------------------------------------- */
    const e = await rig.evl(`(() => {
      const W = CBZ.warlord;
      if (!W.state.prisoners.length) {
        /* the battle can end in a rout with nobody left standing; the screen
           is the subject here, so give it prisoners and repaint it. */
        for (let i = 0; i < 9; i++) W.state.prisoners.push(W.makeSoldier(i % 4 ? "levy" : "veteran", "sidearm"));
        W.army.aftermath({ band: null, outcome: "won", ratio: 2.4,
          yourDead: [], yourSurvivors: W.state.army.slice(), yourFled: [],
          theirDead: [], theirSurvivors: W.state.prisoners.slice(),
          loot: { ak47: 6 }, armourLoot: {}, gold: 40, alreadyBanked: true });
      }
      const stage = document.getElementById("stage");
      const btns = Array.prototype.slice.call(stage.querySelectorAll(".wl-btn"))
        .map(function (n) { return (n.innerText || "").replace(/\\s+/g, " ").trim().toUpperCase(); });
      const verbs = btns.filter(function (t) { return t.indexOf("RIDE ON") !== 0; });
      return { on: stage.classList.contains("on"), btns: btns, verbs: verbs,
               split: W.army.splitPrisoners(), prisoners: W.state.prisoners.length,
               text: (stage.innerText || "").replace(/\\s+/g, " ") };
    })()`);
    console.log("  aftermath verbs: " + JSON.stringify(e.verbs));
    console.log("  aftermath split: " + JSON.stringify(e.split));
    ok(e.on, "the aftermath screen is up");
    ok(e.verbs.length === 3, "exactly three prisoner verbs", e.verbs.length + ": " + e.verbs.join(" | "));
    ok(/TAKE THE WILLING/.test(e.verbs.join("|")) && /PRESS EVERY MAN/.test(e.verbs.join("|")) &&
       /SHOOT THE UNWILLING/.test(e.verbs.join("|")), "…and they are the three", e.verbs.join(" | "));
    ok(!/RANSOM|RELEASE|CONSCRIPT|REJECT/.test(e.text.toUpperCase()),
       "no ransom, no release, no 'reject conscription'");
    ok(e.split.willing + e.split.unwilling === e.prisoners,
       "every captured man has decided", e.split.willing + " willing / " + e.split.unwilling + " not");
    ok(/WILL MARCH FOR YOU/.test(e.text.toUpperCase()), "the card says it in one line");

    /* the willing verb has to actually move men */
    const e2 = await rig.evl(`(() => {
      const W = CBZ.warlord;
      const was = { army: W.state.army.length, pris: W.state.prisoners.length,
                    rec: W.state.stats.recruited, con: W.state.stats.conscripted };
      const sp = W.army.splitPrisoners();
      W.army.takeWilling();
      return { was: was, sp: sp, army: W.state.army.length, pris: W.state.prisoners.length,
               rec: W.state.stats.recruited, con: W.state.stats.conscripted };
    })()`);
    /* the willing WALK ACROSS — showTurn is a three-and-a-half-second tableau
       on the sand, and the men do not leave W.state.prisoners until they have
       arrived, which is the whole point of it. */
    await new Promise((r) => setTimeout(r, 6000));
    const e3 = await rig.evl(`(() => { const W = CBZ.warlord;
      return { army: W.state.army.length, pris: W.state.prisoners.length,
               rec: W.state.stats.recruited }; })()`);
    ok(e3.pris === 0, "the wire is empty once you have decided", e3.pris + " left");
    ok(e3.army === e2.was.army + e2.sp.willing, "the willing joined and only the willing",
       e2.was.army + " + " + e2.sp.willing + " = " + e3.army);

    /* ---- c. TEN DAWNS: GROWTH IS LAND --------------------------------- */
    const c = await rig.evl(`(() => {
      const W = CBZ.warlord, T = W.territory, M = W.warlords;
      try { if (CBZ.warlordCtx && CBZ.warlordCtx.closeScreen) CBZ.warlordCtx.closeScreen(); } catch (e) {}
      if (W.phase() !== "campaign") W.setPhase("campaign");
      /* SIX PROVINCES THAT ACTUALLY FEED SOMEBODY, AND THAT TOUCH EACH OTHER.
         Two things a naive grab gets wrong. supportOf is the men the ground
         feeds and it is legitimately ZERO on erg and salt pan — territory.js's
         whole reason for the map being worth fighting over unevenly — so six
         random free holdings can be six deserts and measure nothing. And six
         SCATTERED holdings is not a realm: every one of them is a lone
         frontier against somebody, pressureOn brings the neighbour's whole
         ground strength against each in turn, and the war eats them one a dawn
         however many levies they raise. That is the map working (an
         unsupported island province is exactly what a rival takes first), but
         it is not what this subject is measuring. Richest seed, then flood out
         through free ground, which is how a realm actually grows. */
      const free = T.regions.filter(function (r) { return !T.owner(r.id); });
      free.sort(function (a, b) { return T.supportOf(b) - T.supportOf(a); });
      const blockFrom = function (seed) {
        const out = [], seen = {}, queue = [seed];
        while (queue.length && out.length < 6) {
          const r = queue.shift();
          if (!r || seen[r.id] || T.owner(r.id)) continue;
          seen[r.id] = 1;
          out.push(r);
          r.neighbours.forEach(function (id) { const n = T.byId(id); if (n && !T.owner(n.id)) queue.push(n); });
        }
        return out;
      };
      /* the richest seed that has neighbours to grow into — a lone rich
         holding surrounded by owned ground is a salient, not a realm */
      let want = [];
      for (let i = 0; i < free.length; i++) {
        const b = blockFrom(free[i]);
        if (b.length > want.length) want = b;
        if (want.length >= 5) break;
      }
      want.forEach(function (r) { T.claim(r.id, "you", { quiet: true }); });
      const gar = function () {
        const mine = T.held("you");
        let n = 0;
        for (let i = 0; i < mine.length; i++) n += T.garrisonSize(mine[i].id);
        return n;
      };
      const colMen = function () {
        let n = 0;
        M.list().forEach(function (w) { n += M.menOut(w.id); });
        return n;
      };
      const before = { gar: gar(), col: colMen(), gold: W.state.gold, held: T.held("you").length };
      const trail = [];
      let peak = 0, over = 0;
      for (let i = 0; i < 10; i++) {
        W.dawn();
        peak = Math.max(peak, gar());
        /* THE CAP IS PER PROVINCE, not per realm: supportOf is what THIS
           ground feeds, so summing it over a realm that is changing size while
           you measure it compares two different islands. */
        T.held("you").forEach(function (r) {
          over = Math.max(over, T.garrisonSize(r.id) - Math.round(T.supportOf(r)));
        });
        trail.push(T.held("you").length + "/" + gar());
      }
      return { before: before, gar: gar(), peak: peak, over: over, col: colMen(), gold: W.state.gold, trail: trail,
               held: T.held("you").length, income: T.income("you"),
               support: Math.round(T.held("you").reduce(function (a, r) { return a + T.supportOf(r); }, 0)),
               support0: Math.round(want.reduce(function (a, r) { return a + T.supportOf(r); }, 0)) };
    })()`);
    console.log("  ten dawns: " + JSON.stringify(c));
    /* THE PEAK, NOT THE LAST FRAME. The war is running through all ten of
       these dawns and a province you take can be taken back — that is the
       game — so what is being asserted here is that HOLDING GROUND RAISED MEN,
       not that the AI never wins anything. */
    ok(c.peak > c.before.gar, "your provinces raised levies into their garrisons",
       c.before.gar + " → " + c.peak + " men at peak (ground feeds " + c.support0 + ")");
    ok(c.over <= 1, "…and no province holds more than its ground feeds",
       "worst province was " + c.over + " over its own support");
    ok(c.held > 0, "…and a realm that touches itself holds together",
       c.before.held + " → " + c.held + " provinces: " + c.trail.join(" "));
    ok(c.col > 0, "the rivals' columns still have men in them", c.col + " men out");
    ok(c.gold > c.before.gold, "the island paid its income at dawn",
       "$" + c.before.gold + " → $" + c.gold + " over ten dawns, wages paid");

    /* the levy is REAL SOLDIERS, not a number, and it can be marched */
    const c2 = await rig.evl(`(() => {
      const W = CBZ.warlord, T = W.territory;
      const mine = T.held("you");
      let best = null, bn = 0;
      for (let i = 0; i < mine.length; i++) {
        const g = T.garrison(mine[i].id);
        if (g && g.length > bn) { bn = g.length; best = mine[i]; }
      }
      if (!best) return { err: "no real garrison anywhere" };
      const was = W.state.army.length;
      const got = T.raiseLevy(best);
      return { region: best.name, got: got, was: was, army: W.state.army.length,
               left: T.garrisonSize(best.id) };
    })()`);
    if (c2.err) fails.push(c2.err);
    else {
      ok(c2.got > 0 && c2.army === c2.was + c2.got, "RAISE THE LEVY marches the garrison into the column",
         c2.got + " men off " + c2.region + ", army " + c2.was + " → " + c2.army);
      ok(c2.left === 0, "…and the province is empty afterwards", c2.left + " left behind");
    }

    /* ---- d. VICTORY IS LAND ------------------------------------------- */
    const d = await rig.evl(`(() => {
      const W = CBZ.warlord, T = W.territory;
      const need = T.winTarget();
      const all = T.regions.slice();
      for (let i = 0; i < need && i < all.length; i++) T.claim(all[i].id, "you", { quiet: true });
      return { need: need, of: T.regions.length, held: T.held("you").length,
               share: T.share("you"), over: W.events.audit().over };
    })()`);
    console.log("  land: " + JSON.stringify(d));
    ok(d.need === Math.ceil(d.of * 0.8), "the target is 80% of the island, derived",
       d.need + " of " + d.of);
    await new Promise((r) => setTimeout(r, 800));
    const d2 = await rig.evl(`(() => {
      const W = CBZ.warlord;
      if (!W.events.audit().over) W.dawn();
      return { over: W.events.audit().over, phase: W.phase(),
               why: (W.state.flags.ev.over || {}).why || "",
               head: ((document.querySelector("#stage .wl-h") || {}).innerText || "").trim(),
               text: ((document.getElementById("stage") || {}).innerText || "").replace(/\\s+/g, " ") };
    })()`);
    ok(d2.over === "won", "holding 80% of the island wins the run", "over = " + d2.over);
    ok(/THE ISLAND IS YOURS/i.test(d2.head), "…and the end screen says so", d2.head);
    ok(/THE ISLAND/.test(d2.text) && !/THE FOUR/.test(d2.text),
       "the end screen's standings are THE ISLAND, not THE FOUR");
    ok(/PROVINCES HELD/.test(d2.text.toUpperCase()), "…and the run reads as a run",
       (d2.text.match(/DAYS|PROVINCES HELD|BIGGEST COLUMN|BATTLES|PRESSED|EXECUTED|FAME/g) || []).join(" "));

    const errs = (rig.errors || []).slice();
    for (const x of errs) fails.push("console error: " + (typeof x === "string" ? x : JSON.stringify(x)));
  } catch (err) {
    fails.push("threw: " + (err && err.message ? err.message : String(err)));
  } finally {
    await rig.close();
  }

  console.log("");
  for (const n of notes) console.log(n);
  if (fails.length) {
    console.log("\nWARLORD ISLAND: FAIL\n");
    for (const f of fails) console.log("  " + f);
    process.exit(1);
  }
  console.log("\nWARLORD ISLAND OK — the rivals ride, one battle is one battle, land makes men, and land wins.");
};

run().catch((e) => { console.error(e); process.exit(1); });
