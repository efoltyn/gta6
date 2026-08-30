#!/usr/bin/env node
/* ============================================================
   tools/warlord-check.mjs — IS DESERT WARLORD A GAME, OR A SPREADSHEET
   THAT LOSES?

   THE PROBLEM THIS SOLVES, and why it is not a screenshot tool. Every other
   check in this repo asks whether something LOOKS right, because everything
   else in this repo is a thing you look at. Desert Warlord's failure mode is
   invisible: the island renders beautifully, the men shoot each other
   beautifully, and the campaign is unplayable because wages outrun loot on
   day nine and every run ends the same way with an army of zero. You cannot
   photograph that. You can only play forty campaigns, and nobody is going to.

   So this plays them. src/warlord/core.js was deliberately written with no
   THREE object in it — that is the whole reason — so the entire economy, the
   whole roster model, the odds curve and the surrender roll load in plain
   node and run a three-hundred-day campaign in milliseconds.

   WHAT IT CHECKS, in the order that a broken one would ruin the game:

     1. THE ARMOURY IS ORDERED. Prices are derived from weapon-data.js rather
        than typed, which is the right call and also the one that can silently
        produce a launcher cheaper than a pistol the day somebody retunes a
        damage number. Monotonic against dps, and the extremes named.
     2. POWER SAYS WHAT THE PLAYER SEES. Forty levies with pistols must read
        as weaker than fifteen veterans with rifles, or the encounter card is
        lying and every decision made on it is a coin flip.
     3. THE ODDS CURVE IS HONEST. Symmetric, monotonic, and it never prints
        certainty — a 100% that loses is a bug the player catches exactly once
        and never trusts the number again.
     4. SURRENDER IS A STRATEGY, NOT A LOTTERY. It rises with advantage, it
        falls against veterans, a legion at full strength never folds, and
        executing prisoners has to actually cost you something later.
     5. THE ECONOMY DOES NOT DEATH-SPIRAL, AND DOES NOT RUN AWAY. This is the
        real test and the reason the file exists: a headless greedy warlord
        plays N campaigns and the army-size curve has to go UP, with a real
        failure rate. A game you cannot lose is as broken as one you cannot
        win, and both look identical from a screenshot.
     6. THE WAGE BRAKE SHEDS, IT DOES NOT EVAPORATE. Missing payroll must cost
        the cheap men first and leave a playable army, not wipe the roster.
     7. PROMOTION ARRIVES. A man who lives has to become something.

     node tools/warlord-check.mjs            # the gate
     node tools/warlord-check.mjs --runs 400 # more campaigns, tighter noise
     node tools/warlord-check.mjs --verbose  # print a campaign, day by day

   Exit 0 clean, 1 on any failure. No browser, no server, no port.
============================================================ */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const RUNS = Math.max(20, Number(opt("--runs", 200)) || 200);
const DAYS = Math.max(30, Number(opt("--days", 240)) || 240);
const VERBOSE = argv.includes("--verbose");

/* THE ONLY SHIM. core.js and weapon-data.js both open with
   `window.CBZ = window.CBZ || {}`, which is the browser idiom and is the
   correct one for files that ship to a browser. Three lines here is a much
   better trade than a build step or a module format neither file wants. */
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.CBZ = {};
require(path.join(ROOT, "src/weapons/weapon-data.js"));
require(path.join(ROOT, "src/warlord/core.js"));
const W = globalThis.CBZ.warlord;

const fails = [];
const notes = [];
const ok = (cond, label, detail) => {
  if (cond) { notes.push("  ok    " + label + (detail ? "   " + detail : "")); return true; }
  fails.push(label + (detail ? "   " + detail : ""));
  notes.push("  FAIL  " + label + (detail ? "   " + detail : ""));
  return false;
};
const n2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

/* ============================================================ 1. THE ARMOURY */
function checkArmoury() {
  notes.push("\nARMOURY — prices are derived, so they can drift");
  const guns = W.gunList();
  ok(guns.length >= 12, "every gun in weapon-data reached the campaign", guns.length + " guns");

  const rows = guns.map((g) => {
    const rate = 1 / Math.max(0.03, g.fireDelay || g.interval || 0.5);
    const dps = (g.damage || 20) * (g.pellets || 1) * Math.min(rate, 14);
    return { id: g.id, price: W.gunPrice(g.id), dps: dps, range: g.range || 60, exp: !!g.explosive };
  }).sort((a, b) => a.price - b.price);

  /* PRICE MUST FOLLOW COMBAT VALUE, and the term it has to follow is the one
     gunValue() actually computes — sustained output × reach × lethality —
     not the raw dps the first draft of THIS CHECK compared against. That
     mismatch is worth leaving a note about: for one commit the checker was
     asserting a claim the code had stopped making, and reported thirteen
     inversions in a price list that was correct. A gate that measures the
     wrong thing is worse than no gate.

     The taser is exempt because it is the one hand-typed price in core.js —
     it is priced for what it does in the CAMPAIGN (take a man alive), which
     no weapon record knows. Exempting it here is the honest way to say that. */
  const conventional = rows.filter((r) => !r.exp && r.id !== "taser");
  const pricedOrder = conventional.slice().sort((a, b) => a.price - b.price).map((r) => r.id);
  const valueOrder = conventional.slice().sort((a, b) => W.gunValue(a.id) - W.gunValue(b.id)).map((r) => r.id);
  let inversions = 0;
  for (let i = 0; i < valueOrder.length; i++) {
    for (let j = i + 1; j < valueOrder.length; j++) {
      if (pricedOrder.indexOf(valueOrder[i]) > pricedOrder.indexOf(valueOrder[j])) inversions++;
    }
  }
  ok(inversions === 0, "price order matches combat-value order for every conventional gun",
     inversions + " inversions");

  /* AND NO NON-LETHAL EVER REACHES A FIRING LINE. The rarity roll put a taser
     in one man in eight at every band size, because the taser is cheap and
     therefore common — the right answer for a depot crate and the wrong one
     for an army. */
  W.newGame({ seed: 31 });
  let tasers = 0, carried = 0;
  for (let i = 0; i < 30; i++) {
    const b = W.makeBand({ size: 60 });
    b.men.forEach((m) => { carried++; if (m.wid === "taser") tasers++; });
  }
  ok(tasers === 0, "no band carries a taser into a battle", tasers + "/" + carried);

  const cheapest = rows[0], dearest = rows[rows.length - 1];
  ok(cheapest.price <= 60, "the cheapest gun is pocket change", cheapest.id + " $" + cheapest.price);
  ok(dearest.price >= 400, "the dearest gun is a campaign goal", dearest.id + " $" + dearest.price);
  ok(dearest.price / cheapest.price >= 6, "the armoury spans a real ladder",
     "x" + n2(dearest.price / cheapest.price));

  /* AN EXPLOSIVE IS NOT A DPS NUMBER. One rocket changes a battle and no
     amount of damage-per-second says that, which is why gunPrice carries an
     explicit premium — assert the premium is still doing its job. */
  const exp = rows.filter((r) => r.exp);
  const conv = rows.filter((r) => !r.exp);
  const convMax = Math.max(...conv.map((r) => r.price));
  ok(exp.length === 0 || Math.min(...exp.map((r) => r.price)) > convMax,
     "every explosive costs more than every rifle",
     exp.map((r) => r.id + " $" + r.price).join(" "));

  /* RARITY DECIDES WHAT IS IN THE CRATE. If it saturates at either end the
     depots all carry the same stock and the map stops being worth crossing. */
  const rar = rows.map((r) => W.gunRarity(r.id));
  ok(Math.max(...rar) > 0.7 && Math.min(...rar) < 0.35,
     "rarity spreads: common guns everywhere, launchers rarely",
     "[" + n2(Math.min(...rar)) + " … " + n2(Math.max(...rar)) + "]");
  ok(rar[0] > rar[rar.length - 1], "the cheap gun is the common one");

  if (VERBOSE) {
    notes.push("        " + rows.map((r) => r.id + " $" + r.price).join("  "));
  }
}

/* ============================================================ 2. POWER */
function checkPower() {
  notes.push("\nPOWER — the one number the encounter card shows");
  const mob = [];
  for (let i = 0; i < 40; i++) mob.push(W.makeSoldier("levy", "sidearm"));
  const elite = [];
  for (let i = 0; i < 15; i++) elite.push(W.makeSoldier("veteran", "ak47"));
  const pMob = W.power(mob), pElite = W.power(elite);
  ok(pElite > pMob, "15 veterans with AKs beat 40 levies with pistols",
     n2(pElite) + " vs " + n2(pMob));

  /* AND THE MOB STILL HAS TO MATTER. If the elite squad is ten times the mob,
     numbers stop being a reason to recruit and the whole campaign loop — go
     get more men — has no payoff. The band is a judgement about what makes a
     decision interesting, and it is stated here rather than hidden in a
     constant. */
  ok(pElite / pMob < 2.6, "…but not so hard that numbers stop mattering",
     "x" + n2(pElite / pMob));

  const bare = W.makeSoldier("soldier", "sidearm");
  const armed = W.makeSoldier("soldier", "lmg");
  ok(W.soldierPower(armed) > W.soldierPower(bare) * 1.6,
     "the gun you hand a man visibly changes what he is worth",
     n2(W.soldierPower(bare)) + " → " + n2(W.soldierPower(armed)));

  const naked = W.makeSoldier("soldier", "ak47");
  const plated = W.makeSoldier("soldier", "ak47", { armour: "heavy" });
  ok(W.soldierPower(plated) > W.soldierPower(naked), "armour counts");

  const hurt = W.makeSoldier("veteran", "ak47", { wounded: true });
  const well = W.makeSoldier("veteran", "ak47");
  ok(W.soldierPower(hurt) < W.soldierPower(well) * 0.75,
     "a wounded man is a real loss until he rests");

  /* A BAND'S GUNS SCALE WITH ITS SIZE, deliberately: a six-man bandit crew
     with rocket launchers is not a difficulty curve, it is a joke. */
  W.newGame({ seed: 5150 });
  let smallMax = 0, bigMax = 0;
  for (let i = 0; i < 40; i++) {
    const s = W.makeBand({ size: 6 }), b = W.makeBand({ size: 180 });
    s.men.forEach((m) => { smallMax = Math.max(smallMax, W.gunPrice(m.wid)); });
    b.men.forEach((m) => { bigMax = Math.max(bigMax, W.gunPrice(m.wid)); });
  }
  ok(bigMax > smallMax * 1.5, "big bands carry better guns than small ones",
     "small tops out at $" + smallMax + ", big at $" + bigMax);
}

/* ============================================================ 3. ODDS */
function checkOdds() {
  notes.push("\nODDS — the number the player bets a hundred men on");
  ok(Math.abs(W.odds(50, 50) - 0.5) < 1e-9, "even is even");
  ok(Math.abs(W.odds(80, 20) + W.odds(20, 80) - 1) < 1e-6, "symmetric");
  let mono = true, last = -1;
  for (let m = 1; m <= 200; m += 1) { const o = W.odds(m, 100); if (o < last) mono = false; last = o; }
  ok(mono, "monotonic in your own strength");
  ok(W.odds(1000, 1) <= 0.99 && W.odds(1, 1000) >= 0.01,
     "never prints certainty — a 100% that loses is only believed once",
     n2(W.odds(1000, 1)));
  /* A 2:1 ADVANTAGE IS NOT A WALKOVER, and the curve has to say so or the
     player charges every time the bar is over half. */
  const two = W.odds(200, 100);
  ok(two > 0.6 && two < 0.85, "2:1 reads as a good fight, not a formality", n2(two));
}

/* ============================================================ 4. SURRENDER */
function checkSurrender() {
  notes.push("\nSURRENDER — the mechanic that makes an army out of one man");
  W.newGame({ seed: 909 });
  const weak = W.makeBand({ size: 10, faction: "bandit" });
  const legion = W.makeBand({ size: 60, faction: "legion" });
  legion.men.forEach((m) => { m.tier = "veteran"; m.maxHp = W.tier("veteran").hp; m.hp = m.maxHp; });

  const lo = W.surrenderChance(weak, W.bandPower(weak) * 0.8);
  const hi = W.surrenderChance(weak, W.bandPower(weak) * 4);
  ok(hi > lo, "the more you outnumber them the more they fold", n2(lo) + " → " + n2(hi));
  ok(lo < 0.12, "an even fight does not talk itself out", n2(lo));
  ok(W.surrenderChance(legion, W.bandPower(legion) * 1.2) < 0.25,
     "a legion of veterans at full strength does not fold to a bare advantage",
     n2(W.surrenderChance(legion, W.bandPower(legion) * 1.2)));
  ok(W.surrenderChance(weak, 1e9) <= 0.93, "there is always a chance they fight", n2(W.surrenderChance(weak, 1e9)));

  /* FAME IS THE LONG GAME. Releasing prisoners buys you surrenders later;
     executing them has to cost you the same thing, or "execute" is free and
     nobody ever picks anything else. army.js owns which way each choice moves
     it — this asserts the DIAL is connected at all, which is the part that
     silently stops being true. */
  const before = W.surrenderChance(weak, W.bandPower(weak) * 2);
  W.state.fame = 900;
  const after = W.surrenderChance(weak, W.bandPower(weak) * 2);
  W.state.fame = 0;
  ok(after > before, "a reputation does work for you", n2(before) + " → " + n2(after));
}

/* ============================================================ 5. THE CAMPAIGN
   A HEADLESS GREEDY WARLORD. He is not clever — he hires when he can afford
   it, fights anything he is favoured against, loots the dead and pays his men
   — and that is the point: if the DUMBEST reasonable play cannot build an
   army, the numbers are wrong, not the player. If it always can, there is no
   game. Both are failures and only one of them is obvious.

   The battle is resolved by the odds curve rather than by battle.js, and that
   is honest: this file is testing the CAMPAIGN's arithmetic, and battle.js's
   own outcome distribution is a different question that needs a browser. */
function campaign(seed) {
  W.newGame({ seed: seed });
  const S = W.state;
  const trail = [];
  let dead = false;

  for (let day = 1; day <= DAYS && !dead; day++) {
    W.dawn();
    if (S.army.length === 0 && S.gold < 25 && day > 25) { dead = true; break; }

    /* SELL THE CART. A warlord carrying forty looted rifles he will never
       hand out is carrying money, and any player works this out on day two.
       He keeps enough to arm the men he has — that is the OTHER half of the
       decision and the reason spoils arrive as objects. */
    const need = S.army.length;
    let held = 0;
    Object.keys(S.baggage).forEach(function (k) { held += S.baggage[k]; });
    if (held > need + 4) {
      const cheap = Object.keys(S.baggage).sort(function (a, b) { return W.gunPrice(a) - W.gunPrice(b); });
      let sell = held - need - 4;
      for (let i = 0; i < cheap.length && sell > 0; i++) {
        const n = Math.min(sell, S.baggage[cheap[i]]);
        if (W.unstash(cheap[i], n)) { W.earn(W.gunSell(cheap[i]) * n); sell -= n; }
      }
    }

    // whatever a day of riding turns up: a caravan, an abandoned camp
    W.earn(W.irange(2, 9));

    // HIRE — keep four days of wages in hand, never spend the last dollar
    let guard = 0;
    while (S.gold > W.payroll() * 4 + 60 && guard++ < 12) {
      const t = W.chance(0.55) ? "levy" : (W.chance(0.6) ? "raider" : "soldier");
      if (!W.pay(W.tier(t).hire)) break;
      // ARM HIM FROM THE CART IF THERE IS ANYTHING IN IT — the loop closes here
      const have = Object.keys(S.baggage).sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
      let wid = "sidearm";
      if (have.length && W.unstash(have[0], 1)) wid = have[0];
      W.addSoldier(W.makeSoldier(t, wid));
      S.stats.recruited++;
    }

    const band = W.makeBand({});
    const mine = W.yourPower(), theirs = W.bandPower(band);
    const p = W.odds(mine, theirs);

    /* DEMAND SURRENDER FIRST. It is free, it is the mechanic the whole game
       is built around, and a player who never tries it is not modelling the
       game — the first version of this sim didn't, and undersold the loop. */
    const sc = W.surrenderChance(band, mine);
    if (sc > 0.25 && W.rnd() < sc) {
      const took = Math.round(band.men.length * W.range(0.4, 0.75));
      for (let i = 0; i < took; i++) { band.men[i].hp = band.men[i].maxHp; W.addSoldier(band.men[i]); }
      S.stats.conscripted += took;
      W.earn(band.gold);
      S.fame += band.men.length;
      trail.push(S.army.length);
      continue;
    }

    if (p > 0.6) {
      S.stats.battles++;
      if (W.rnd() < p) {
        /* WON. Casualties scale with how close it was — a walkover costs a
           couple of men, a coin flip costs a third of the army. */
        const bite = W.clamp((1 - p) * 0.85, 0.02, 0.5);
        const lost = Math.min(S.army.length, Math.round(S.army.length * bite * (0.5 + W.rnd())));
        const myDead = S.army.slice(S.army.length - lost);
        for (let i = 0; i < lost; i++) W.removeSoldier(S.army[S.army.length - 1].id, false);
        S.stats.lost += lost;
        W.promoteSurvivors(S.army);
        /* THE GUNS OFF THE DEAD — BOTH SIDES'. Your own fallen leave their
           rifles on the same sand theirs do, and forgetting that was worth a
           third of the campaign's income. */
        const theirDead = band.men.slice(0, Math.round(band.men.length * W.range(0.45, 0.8)));
        W.takeSpoils(W.spoils(theirDead.concat(myDead)));
        W.earn(band.gold);
        S.fame += band.men.length;
        const alive = band.men.slice(theirDead.length);
        const took = Math.round(alive.length * W.range(0.25, 0.6));
        for (let i = 0; i < took; i++) { alive[i].hp = alive[i].maxHp; W.addSoldier(alive[i]); }
        S.stats.conscripted += took;
        S.stats.won++;
      } else {
        /* LOST — AND HE RETREATS. battle.js has a RETREAT button precisely so
           a bad fight is a setback rather than a run ending, and a sim that
           fights every loss to annihilation is testing a game nobody plays. */
        const lost = Math.min(S.army.length, Math.round(S.army.length * W.range(0.28, 0.6)));
        for (let i = 0; i < lost; i++) W.removeSoldier(S.army[S.army.length - 1].id, false);
        S.stats.lost += lost;
      }
    }
    trail.push(S.army.length);
    if (VERBOSE && day % 20 === 0) {
      notes.push("        day " + String(day).padStart(3) + "  " +
        String(S.army.length).padStart(4) + " men   $" + String(S.gold).padStart(5) +
        "   wages $" + W.payroll());
    }
  }
  return { peak: Math.max(0, ...trail), end: W.state.army.length, dead: dead,
           gold: W.state.gold, stats: W.state.stats, trail: trail };
}

function checkCampaign() {
  notes.push("\nTHE CAMPAIGN — " + RUNS + " headless warlords, " + DAYS + " days each");
  const res = [];
  for (let i = 0; i < RUNS; i++) res.push(campaign(1000 + i * 7));
  const peaks = res.map((r) => r.peak).sort((a, b) => a - b);
  const ends = res.map((r) => r.end);
  const med = peaks[Math.floor(peaks.length / 2)];
  const p10 = peaks[Math.floor(peaks.length * 0.1)];
  const p90 = peaks[Math.floor(peaks.length * 0.9)];
  const broke = res.filter((r) => r.dead).length;
  const avgEnd = ends.reduce((a, b) => a + b, 0) / ends.length;

  notes.push("        peak army  p10 " + p10 + "   median " + med + "   p90 " + p90);
  notes.push("        ended with " + Math.round(avgEnd) + " men on average, " +
             broke + "/" + RUNS + " campaigns collapsed");

  ok(med >= 25, "the loop pays: a median run builds a real army", "median peak " + med);
  ok(med <= 900, "…and does not run away into a number nobody can fight", "median peak " + med);
  /* A GAME YOU CANNOT LOSE IS AS BROKEN AS ONE YOU CANNOT WIN, and from a
     screenshot they are the same picture. The band is wide because this is
     the DUMBEST play — a real player should do much better, and a floor of
     zero collapses would mean the wage brake is not connected. */
  ok(broke > 0, "some campaigns genuinely collapse", broke + "/" + RUNS);
  ok(broke < RUNS * 0.6, "…but the dumbest reasonable play is not doomed",
     Math.round(broke / RUNS * 100) + "%");
  ok(p90 > p10 * 2.5, "runs diverge — the decisions matter",
     "p10 " + p10 + " vs p90 " + p90);

  /* THE CURVE HAS TO GO UP. An army that peaks on day four and grinds down
     for the rest of the run passes every threshold above and is still not a
     game about building an army. */
  const early = res.map((r) => r.trail[Math.min(19, r.trail.length - 1)] || 0);
  const late = res.map((r) => r.trail[r.trail.length - 1] || 0);
  const eAvg = early.reduce((a, b) => a + b, 0) / early.length;
  const lAvg = late.reduce((a, b) => a + b, 0) / late.length;
  ok(lAvg > eAvg * 1.4, "the army is bigger at the end than at day 20",
     Math.round(eAvg) + " → " + Math.round(lAvg));
}

/* ============================================================ 6. THE BRAKE */
function checkWages() {
  notes.push("\nWAGES — the brake that stops 'recruit everybody, always'");
  W.newGame({ seed: 4242 });
  const S = W.state;
  for (let i = 0; i < 30; i++) S.army.push(W.makeSoldier("levy", "sidearm"));
  for (let i = 0; i < 10; i++) S.army.push(W.makeSoldier("veteran", "ak47"));
  const before = S.army.length;
  const vetsBefore = S.army.filter((s) => s.tier === "veteran").length;
  S.gold = 0;
  W.dawn();
  const after = S.army.length;
  const vetsAfter = S.army.filter((s) => s.tier === "veteran").length;
  ok(after < before, "unpaid men leave", before + " → " + after);
  ok(after > 0, "…the army sheds, it does not evaporate", after + " left");
  ok(vetsAfter === vetsBefore, "the levies walk first — a veteran has somewhere to be",
     vetsAfter + "/" + vetsBefore + " veterans kept");
  ok(before - after <= Math.ceil(before * 0.4), "one bad morning costs at most 40% of the roster",
     (before - after) + " of " + before + " walked");

  /* A GUN A DESERTER TAKES WITH HIM IS A GUN THE PLAYER PAID FOR AND CANNOT
     SEE LEAVE. removeSoldier's default drops kit into the cart; dawn uses
     that default and this is the assertion that keeps it true. */
  const guns = Object.values(S.baggage).reduce((a, b) => a + b, 0);
  ok(guns >= before - after, "every deserter dropped his rifle in your cart",
     guns + " guns recovered from " + (before - after) + " men");

  W.newGame({ seed: 77 });
  const T = W.state;
  for (let i = 0; i < 5; i++) T.army.push(W.makeSoldier("levy", "sidearm"));
  T.gold = 500;
  const paid = T.gold - W.payroll();
  W.dawn();
  ok(T.gold === paid && T.army.length === 5, "a solvent warlord keeps his army", "$" + T.gold);
}

/* ============================================================ 7. PROMOTION */
function checkPromotion() {
  notes.push("\nPROMOTION — the only progression system there is");
  W.newGame({ seed: 31337 });
  const men = [];
  for (let i = 0; i < 60; i++) men.push(W.makeSoldier("levy", "sidearm"));
  let firstUp = 0;
  for (let b = 1; b <= 40; b++) {
    const up = W.promoteSurvivors(men);
    if (up.length && !firstUp) firstUp = b;
  }
  const top = men.filter((m) => m.tier === "veteran").length;
  ok(firstUp >= 2 && firstUp <= 6, "a levy becomes a raider within a few fights",
     "battle " + firstUp);
  ok(top === 60, "a man who survives long enough tops out", top + "/60 veterans");
  ok(men[0].hp === men[0].maxHp, "a promotion heals him — it is the reward");
}

/* ============================================================ RUN */
checkArmoury();
checkPower();
checkOdds();
checkSurrender();
checkCampaign();
checkWages();
checkPromotion();

process.stdout.write(notes.join("\n") + "\n\n");
if (fails.length) {
  process.stdout.write("WARLORD CHECK FAILED — " + fails.length + ":\n");
  fails.forEach((f) => process.stdout.write("  · " + f + "\n"));
  process.exit(1);
}
process.stdout.write("WARLORD CHECK OK — the campaign is a game.\n");
