/* ============================================================
   warlord/army.js — THE ROSTER, THE ENCOUNTER, THE AFTERMATH.

   Two screens and one book-keeper.

   THE ENCOUNTER is the card that goes up when the campaign puts you nose to
   nose with a warband. It is the whole strategy game compressed into five
   buttons, and its ONE job is to tell the truth well enough that choosing
   between them is a decision rather than a coin toss. "40 men" is not
   information. "22 levies with pistols, 14 raiders with AKs, 4 veterans with
   LMGs" is, because it is the sentence that decides whether you fight.

   THE AFTERMATH is the payoff, and it is the reason core.js gives every man a
   NAME. A casualty list of "you lost 7" is a spreadsheet; a casualty list with
   Kaseem Ash on it is the reason you do not charge next time. It is also the
   only place the roster actually CHANGES hands: battle.js reports what
   happened, this file does every mutation — the dead leave W.state.army, the
   guns off the field land in W.stash(), the survivors get promoted, and the
   men who did not die become W.state.prisoners and then become a decision.

   WHY THE BOOK-KEEPING IS HERE AND NOT IN battle.js. The battle owns bodies on
   sand; the moment it starts owning the army array there are two writers for
   one list, and the class of bug that produces is a band of 40 that fields 37
   and captures 44. battle.js hands back a REPORT — plain objects, references to
   the same soldier objects it was given — and army.js applies it once.

   OWNED EVENTS (beyond core's): none. This file speaks through core's bus.

   FLAGS (repo doctrine: every behaviour switch reverts in one param)
     ?dread=old     executions stop discouraging future surrenders (see DREAD)
     ?conscript=old conscription is a flat roll again, tier-blind
     ?encounter=1   debug: put a generated band's card up at boot
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});

  let ctx = null, Q = null;
  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  const esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  /* ============================================================ DREAD
     THE EXECUTE TRADE-OFF, MADE REAL.

     The brief says executing prisoners must make future bands LESS willing to
     surrender — "a warlord who kills prisoners gets fought to the last man" —
     and core's surrenderChance cannot express that on its own. Its reputation
     term is `clamp(S.fame / 900, 0, 0.16)`: fame only ever ADDS, and the clamp
     floors a negative reputation at zero. So under the shipped formula an
     execution costs you the fame you would have gained by releasing him and
     nothing else, which is a smaller penalty than the mercy is a bonus — the
     opposite of the mechanic the brief describes.

     Rather than fork the formula (never fork; route the name), army.js WRAPS
     the core call. Dread is this file's mechanic, so this file owns the term,
     and campaign.js/warnet.js get the corrected number for free because they
     are calling the same W.surrenderChance they always were.

     The shape: every execution multiplies the odds down. Five executions is
     0.69x, fifteen is 0.43x — a reputation you can dig yourself out of by
     releasing men (which raises fame through core's own term), never a switch
     you flip once and live with forever. ?dread=old restores the shipped
     behaviour verbatim so the difference is measurable. */
  function dreadMul() {
    if (Q && Q.get("dread") === "old") return 1;
    const n = (W.state.stats && W.state.stats.executed) || 0;
    return 1 / (1 + n * 0.09);
  }
  let coreSurrender = null;
  function installDread() {
    if (coreSurrender) return;
    coreSurrender = W.surrenderChance;
    W.surrenderChance = function (band, myPower) {
      return clamp(coreSurrender(band, myPower) * dreadMul(), 0, 0.93);
    };
  }

  /* ============================================================ THE ROSTER
     ONE SHAPE, READ BY THREE SCREENS. The loadout screen wants "who is
     carrying what so I can change it", the encounter card wants "what does
     this army look like at a glance", and the aftermath wants "who died".
     All three are views of the same grouping, so it is derived once here
     instead of three times in three files that then disagree.

     A GROUP IS A TIER PLUS A GUN, and that pairing is deliberate: those are
     exactly the two facts that decide what a man does in a fight, so a group
     is the smallest unit that behaves identically on the sand. */
  function groupsOf(men) {
    const map = Object.create(null);
    const out = [];
    for (let i = 0; i < men.length; i++) {
      const s = men[i];
      const key = s.tier + "|" + s.wid + "|" + (s.armour || "none");
      let g = map[key];
      if (!g) {
        g = map[key] = {
          key: key, tier: s.tier, wid: s.wid, armour: s.armour || "none",
          tierIdx: W.tierIndex(s.tier), men: [], count: 0, power: 0,
          label: W.tier(s.tier).label, gun: W.gunLabel(s.wid),
        };
        out.push(g);
      }
      g.men.push(s);
      g.count++;
      g.power += W.soldierPower(s);
    }
    // strongest first: an army reads top-down, and the veterans are the answer
    // to "what am I actually facing"
    out.sort(function (a, b) {
      return (b.tierIdx - a.tierIdx) || (b.count - a.count) || (a.gun < b.gun ? -1 : 1);
    });
    return out;
  }

  /* THE ONE-LINE COMPOSITION. Grouped by TIER (not tier+gun) because at a
     glance the question is "how many of them can actually fight", and the gun
     named is the one MOST of that tier is carrying — with a "+N others" tail
     rather than a nine-clause sentence nobody reads. */
  function composition(men) {
    const byTier = {};
    for (let i = 0; i < men.length; i++) {
      const s = men[i];
      const t = byTier[s.tier] || (byTier[s.tier] = { n: 0, guns: {}, tier: s.tier });
      t.n++;
      t.guns[s.wid] = (t.guns[s.wid] || 0) + 1;
    }
    const rows = Object.keys(byTier).map(function (k) { return byTier[k]; });
    rows.sort(function (a, b) { return W.tierIndex(b.tier) - W.tierIndex(a.tier); });
    const parts = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const guns = Object.keys(r.guns).sort(function (a, b) { return r.guns[b] - r.guns[a]; });
      const top = guns[0];
      const others = guns.length - 1;
      const label = W.tier(r.tier).label.toLowerCase() + (r.n === 1 ? "" : "s");
      parts.push(r.n + " " + label + " with " + W.gunLabel(top).toLowerCase() +
        (others > 0 ? " (+" + others + " other gun" + (others === 1 ? "" : "s") + ")" : ""));
    }
    /* AND A SHORT FORM, for the verb rail's one header line. The long text
       is right for a screen you stopped to read and far too long for a strip
       docked over a live world — "22 levies with 9mm sidearms, 14 raiders
       with AK-47s, 4 veterans with M249 LMGs" wraps to three lines on a
       phone and buries the only thing a rider needs at a glance: what the
       BULK of that party is and whether anything in it outclasses him. So:
       the heaviest tier present, and the best gun anyone in the party is
       carrying, which together are the whole threat assessment. */
    let best = null;
    for (let i = 0; i < men.length; i++) {
      if (!best || W.gunPrice(men[i].wid) > W.gunPrice(best)) best = men[i].wid;
    }
    const topTier = rows.length ? W.tier(rows[0].tier).label.toLowerCase() : "men";
    const short = (rows.length > 1 ? "mostly " : "") +
      (rows.length ? rows[0].n + " " + topTier + (rows[0].n === 1 ? "" : "s") : "") +
      (best ? ", best gun " + W.gunLabel(best).toLowerCase() : "");
    return { rows: rows, text: parts.join(", "), short: short };
  }

  function armourLine(men) {
    let soaked = 0, best = "none";
    for (let i = 0; i < men.length; i++) {
      const a = men[i].armour || "none";
      if (a === "none") continue;
      soaked++;
      if (W.armour(a).soak > W.armour(best).soak) best = a;
    }
    if (!soaked) return "no armour on any of them";
    return soaked + " in armour, heaviest " + W.armour(best).label.toLowerCase();
  }

  /* ============================================================ MONEY TERMS
     WILL THEY TAKE GOLD? The faction decides, and it decides for a reason you
     can say out loud: a free company sells its rifles, that is what a free
     company IS; a bandit crew would take the money and then take the cart; a
     rival warlord is not for hire at any price because he wants what you want.

     The PRICE is derived from core's own hire table so a tier's worth is
     stated in exactly one place, times a premium off the faction's hostility —
     a militia that half-hates you costs more to buy than mercenaries who do
     not care. No typed scalars: `hostile` is already in core's FACTIONS. */
  const NEVER_HIRE = { bandit: 1, warlord: 1 };
  function hirePrice(band) {
    if (NEVER_HIRE[band.faction]) return null;
    const F = W.faction(band.faction);
    const premium = 1.15 + F.hostile * 1.5;
    let n = 0;
    for (let i = 0; i < band.men.length; i++) n += W.tier(band.men[i].tier).hire;
    return Math.max(10, Math.round(n * premium / 5) * 5);
  }
  function hireWhy(band) {
    if (band.faction === "bandit") return "bandits do not take contracts. they take carts.";
    if (band.faction === "warlord") return "he wants the same island you do.";
    return null;
  }

  /* ROBBERY. Available only when you outmatch them so badly that drawing is
     suicide for them — and the threshold is a POWER ratio, not a head count,
     because forty levies with pistols do not stop fifteen veterans and the
     card must not pretend they do. 2.6x is where core's own odds() crosses
     0.9, i.e. exactly where a fight stops being a fight. */
  const ROB_RATIO = 2.6;
  function canRob(band) {
    return W.yourPower() >= W.bandPower(band) * ROB_RATIO && band.men.length > 0;
  }

  /* ============================================================ THE CARD */
  let curBand = null;

  function bar(frac, colour) {
    const p = Math.round(clamp(frac, 0, 1) * 100);
    return '<span style="display:inline-block;width:120px;height:6px;border-radius:4px;' +
      'background:rgba(255,255,255,.14);overflow:hidden;vertical-align:middle">' +
      '<s style="display:block;height:100%;width:' + p + '%;background:' + colour + '"></s></span>';
  }

  function encounter(band, opts) {
    opts = opts || {};
    if (!band || !band.men || !band.men.length) {
      W.toast("nothing out there", "bad");
      if (W.campaign && W.campaign.enter) W.campaign.enter();
      return;
    }
    curBand = band;
    W.setPhase("encounter", { band: band });
    paintEncounter(opts);
  }

  const OLD_ENCOUNTER_UI = (function () {
    try { return new URLSearchParams(location.search).get("encounterui") === "old"; }
    catch (e) { return false; }
  })();

  /* the card this replaced, kept whole so ?encounterui=old is a real revert
     and the two can be photographed against each other rather than argued
     about. It is dead on every default boot. */
  function paintEncounterScreen(opts, D) {
    ctx.screen(
      '<h1 class="wl-h" style="color:' + D.colour + '">' + esc(D.band.name) + '</h1>' +
      '<p class="wl-sub">' + D.band.men.length + ' MEN &middot; ' + esc(D.F.label) + '</p>' +
      '<div class="wl-card"><div class="wl-small">' + esc(D.comp.text) + '</div></div>' +
      '<div class="wl-lbl">THE MEN OPPOSITE</div><div class="wl-card">' + D.gh + '</div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="eFight">ATTACK</button>' +
        '<button class="wl-btn" id="eSurr"' + (D.asked ? " disabled" : "") + '>DEMAND SURRENDER</button>' +
        (D.price != null ? '<button class="wl-btn" id="eHire">HIRE $' + D.price + '</button>' : '') +
        (D.rob ? '<button class="wl-btn" id="eRob">ROB THEM</button>' : '') +
        '<button class="wl-btn" id="eLeave">RIDE AWAY</button>' +
      '</div>');
    ctx.el("eFight").onclick = function () { startBattle({}); };
    const sb = ctx.el("eSurr"); if (sb) sb.onclick = demandSurrender;
    const hb = ctx.el("eHire"); if (hb) hb.onclick = function () { hireBand(D.price); };
    const rb = ctx.el("eRob"); if (rb) rb.onclick = robBand;
    ctx.el("eLeave").onclick = leaveBand;
  }

  function paintEncounter(opts) {
    opts = opts || {};
    const band = curBand;
    const mine = W.yourPower(), theirs = W.bandPower(band);
    const odds = W.odds(mine, theirs);
    const surr = W.surrenderChance(band, mine);
    const comp = composition(band.men);
    const price = hirePrice(band);
    const rob = canRob(band);
    const F = W.faction(band.faction);
    const colour = "#" + (band.colour || 0xc4593a).toString(16).padStart(6, "0");
    const asked = band._surrenderAsked;

    const groups = groupsOf(band.men);
    let gh = "";
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      gh += '<div class="wl-row"><span><b>' + g.count + '</b> ' + esc(g.label) +
        '</span><span class="wl-small wl-dim">' + esc(g.gun) +
        (g.armour !== "none" ? " &middot; " + esc(W.armour(g.armour).label) : "") + '</span></div>';
    }

    /* ============================================================ NO POP-UP
       This was a full-screen card and it should never have been one. The
       campaign clock does not stop — in a match six other warlords are still
       riding — so a modal here is a lie about what is happening behind it,
       and it is a way to be attacked while reading a stat block. The owner's
       words: you cannot be mid-popup and get attacked, and there are no
       popups in reality.

       So the meeting is a VERB RAIL docked at the bottom, the way
       systems/interact.js has always done a walk-up in this engine. The
       world keeps running behind it. What used to be four cards of tables is
       now the two facts a decision actually needs — how many of them, and
       what the odds are — spoken in the header, with the consequences as
       chips inside the buttons. The full breakdown has not been deleted; it
       is one tap away on INSPECT, which is a screen because reading a roster
       IS a thing you stop to do.

       ?encounterui=old restores the card. */
    if (OLD_ENCOUNTER_UI) return paintEncounterScreen(opts, {
      band: band, mine: mine, theirs: theirs, odds: odds, surr: surr, comp: comp,
      price: price, rob: rob, F: F, colour: colour, asked: asked, gh: gh });

    const oddsWord = odds > 0.75 ? "you should win" : odds > 0.55 ? "an even fight"
      : odds > 0.3 ? "you are outmatched" : "they will destroy you";

    /* THE READOUT IS A PICTURE NOW, NOT A SPREADSHEET. The pop-up died two
       revisions ago and the tables came with it into the rail, which fixed
       the blocking and kept the wrong shape: a sentence ("210 men, mostly 120
       soldiers, best gun rpg / rocket launcher, 1% — they will destroy you")
       on top of a twelve-row scrolling list of "1 RAIDER · RPG / ROCKET
       LAUNCHER · PLATE RIG". Nobody reads that with a band riding at them,
       and the campaign clock does not stop while they try.

       Three facts decide this and all three are now shapes:
         · THE ODDS   one split bar, your colour against theirs, with the
                      number and the verdict said once instead of three times.
         · WHAT THEY  one stacked bar segmented by TIER — the segment widths
           ARE MADE   are the composition, so forty levies and fifteen
           OF         veterans are different PICTURES, not different sentences.
         · WHAT THEY  chips, biggest first, capped at four with a "+N" — the
           CARRY      long tail of one-offs was most of the old table's rows
                      and none of its information.
       The full per-man roster is not gone: INSPECT opens it, which is what
       the code comment has claimed since the rail was written while
       paintRoster sat unreachable. */
    const TIER_COLOUR = { levy: "#8d8267", raider: "#c07f3a", soldier: "#c4593a", veteran: "#ffd166" };
    const total = Math.max(1, band.men.length);

    // composition by tier, strongest first — the same order groupsOf uses
    const byTier = {};
    for (let i = 0; i < band.men.length; i++) {
      const t = band.men[i].tier;
      byTier[t] = (byTier[t] || 0) + 1;
    }
    const tiers = Object.keys(byTier).sort(function (a, b) { return W.tierIndex(b) - W.tierIndex(a); });
    let stack = "", legend = "";
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i], n = byTier[t], pct = (n / total) * 100;
      const c = TIER_COLOUR[t] || "#8d8267";
      // the count goes INSIDE the segment, but only where it fits — a number
      // clipped to "1" in a 4% sliver is worse than no number
      stack += '<i style="width:' + pct.toFixed(2) + '%;background:' + c + '">' +
        (pct > 11 ? n : "") + '</i>';
      legend += '<span><em style="background:' + c + '"></em>' + n + " " +
        esc(W.tier(t).label) + '</span>';
    }

    // what they are carrying, biggest count first
    const byGun = {};
    for (let i = 0; i < band.men.length; i++) {
      const w = band.men[i].wid;
      byGun[w] = (byGun[w] || 0) + 1;
    }
    const guns = Object.keys(byGun).sort(function (a, b) { return byGun[b] - byGun[a]; });
    let chips = "";
    for (let i = 0; i < guns.length && i < 4; i++) {
      chips += '<span class="wl-chip"><b>' + byGun[guns[i]] + '</b> ' + esc(W.gunLabel(guns[i])) + '</span>';
    }
    if (guns.length > 4) chips += '<span class="wl-chip wl-dim">+' + (guns.length - 4) + '</span>';
    let armoured = 0, bestArm = "none";
    for (let i = 0; i < band.men.length; i++) {
      const a = band.men[i].armour || "none";
      if (a === "none") continue;
      armoured++;
      if (W.armour(a).soak > W.armour(bestArm).soak) bestArm = a;
    }
    if (armoured) chips += '<span class="wl-chip arm"><b>' + armoured + '</b> ' + esc(W.armour(bestArm).label) + '</span>';

    const myShare = mine / Math.max(1, mine + theirs);
    const body =
      '<div class="wl-split">' +
        '<i style="width:' + (myShare * 100).toFixed(2) + '%;background:var(--hot)"></i>' +
        '<i style="width:' + ((1 - myShare) * 100).toFixed(2) + '%;background:' + colour + '"></i>' +
      '</div>' +
      '<div class="wl-ends"><span>YOU ' + W.armySize() + '</span><span>' +
        band.men.length + ' THEM</span></div>' +
      '<div class="wl-verdict"><b>' + Math.round(odds * 100) + '%</b> &mdash; ' + oddsWord + '</div>' +
      '<div class="wl-lbl">THEIR MEN</div>' +
      '<div class="wl-stack">' + stack + '</div>' +
      '<div class="wl-legend">' + legend + '</div>' +
      '<div class="wl-lbl">CARRYING</div>' +
      '<div class="wl-chips">' + chips + '</div>' +
      (asked ? '<div class="wl-row wl-small" style="color:var(--blood)">they already told you no.</div>' : "") +
      (rob ? '<div class="wl-row wl-small wl-dim">you outnumber them badly enough to just take it.</div>' : "");

    ctx.verbs({
      title: band.name,
      // the header is IDENTITY only. The odds used to be said here, again in
      // the body and a third time on the ATTACK chip; a number repeated three
      // times is not emphasis, it is noise in the one line that has to fit on
      // a 390 px phone.
      /* The faction only earns its place when it is not already the name.
         "SAND BANDITS · 210 MEN · SAND BANDITS" was on screen — the band name
         IS the faction label for every bandit crew, so the header said the
         same thing twice in a line that has to fit on a 390 px phone. */
      sub: band.men.length + " MEN" +
           (String(F.label).toUpperCase() === String(band.name).toUpperCase()
             ? "" : " &middot; " + esc(F.label)) +
           (band.mood === "hunt" ? " &middot; HUNTING YOU" : ""),
      body: body,
      options: [
        { label: "ATTACK", kind: "hot", note: Math.round(odds * 100) + "%",
          on: function () { startBattle({}); } },
        { label: "DEMAND", note: asked ? "refused" : Math.round(surr * 100) + "%",
          disabled: !!asked, on: demandSurrender },
        (price != null
          ? { label: "HIRE", note: "$" + price, disabled: W.state.gold < price,
              on: function () { hireBand(price); } }
          : { label: "HIRE", note: hireWhy(band) ? "never" : "no", disabled: true, on: function () {} }),
        (rob ? { label: "ROB", note: "no fight", on: robBand } : null),
        { label: "INSPECT", note: "every man", on: paintRoster },
        { label: "RIDE AWAY", on: leaveBand },
      ],
    });
  }

  /* THE ROSTER, which IS worth a screen: reading forty men's kit is a thing
     you deliberately stop to do, and nothing is chasing you while you do it
     that was not already chasing you. Backs straight out to the rail. */
  function paintRoster() {
    const band = curBand;
    if (!band) return;
    const groups = groupsOf(band.men);
    let gh = "";
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      gh += '<div class="wl-row"><span><b>' + g.count + '</b> ' + esc(g.label) +
        '</span><span class="wl-small wl-dim">' + esc(g.gun) +
        (g.armour !== "none" ? " &middot; " + esc(W.armour(g.armour).label) : "") + '</span></div>';
    }
    const colour = "#" + (band.colour || 0xc4593a).toString(16).padStart(6, "0");
    ctx.screen(
      '<h1 class="wl-h" style="color:' + colour + '">' + esc(band.name) + '</h1>' +
      '<p class="wl-sub">' + band.men.length + ' MEN &middot; ' + esc(W.faction(band.faction).label) + '</p>' +
      '<div class="wl-card"><div class="wl-small" style="line-height:1.7">' +
        esc(composition(band.men).text) + '.<br><span class="wl-dim">' +
        esc(armourLine(band.men)) + '. they are carrying about $' + (band.gold | 0) +
        '.</span></div></div>' +
      '<div class="wl-lbl">THE MEN OPPOSITE</div><div class="wl-card">' + gh + '</div>' +
      '<div class="wl-btns"><button class="wl-btn hot" id="rBack">BACK</button></div>'
    );
    ctx.el("rBack").onclick = function () { ctx.closeScreen(); paintEncounter({}); };
  }

  function startBattle(opts) {
    const band = curBand;
    if (!W.battle || !W.battle.start) {
      W.toast("battle.js did not load", "bad");
      return;
    }
    W.battle.start(Object.assign({ band: band }, opts || {}));
  }

  /* DEMAND SURRENDER. Success hands you the whole roster as prisoners with no
     shot fired — which is the single best outcome in the game and is exactly
     why the roll is hard. Failure has to COST, or "always ask first" is a free
     action and the button is a lottery ticket:
       · they are now hunting (core's own mood), so the campaign will not let
         you simply walk away from them;
       · you cannot ask twice;
       · and the fight you have now starts with you SURPRISED — battle.js opens
         the range shorter and docks your side's morale for it. */
  function demandSurrender() {
    const band = curBand;
    const p = W.surrenderChance(band, W.yourPower());
    band._surrenderAsked = true;
    if (W.chance(p)) {
      for (let i = 0; i < band.men.length; i++) W.state.prisoners.push(band.men[i]);
      W.earn(band.gold);
      band.gold = 0;
      band.men.length = 0;
      W.state.fame += Math.round(2 + W.state.prisoners.length * 0.5);
      W.log(band.name + " laid down their guns without a shot.", "good");
      W.toast("THEY SURRENDER", "good");
      W.state.stats.battles++;
      W.state.stats.won++;
      aftermath({
        band: band, outcome: "surrender", duration: 0,
        yourDead: [], yourSurvivors: W.state.army.slice(), yourFled: [],
        theirDead: [], theirSurvivors: W.state.prisoners.slice(),
        loot: {}, armourLoot: {}, gold: 0, youKills: 0, alreadyBanked: true,
      });
    } else {
      band.mood = "hunt";
      band.cooldown = 0;
      W.log(band.name + " told you to come and take them.", "bad");
      W.toast("THEY REFUSE", "bad");
      startBattle({ surprised: true, defending: true });
    }
  }

  function hireBand(price) {
    const band = curBand;
    if (price == null || !W.pay(price)) { W.toast("not enough gold", "bad"); return; }
    let n = 0;
    for (let i = 0; i < band.men.length; i++) { W.addSoldier(band.men[i]); n++; }
    band.men.length = 0;
    W.state.stats.recruited += n;
    W.log("paid $" + price + ". " + n + " men ride with you now.", "good");
    W.toast(n + " MEN JOIN YOU", "good");
    finish();
  }

  /* ROBBERY takes the GUNS, and that is the point: the gold is a number and
     the guns are the band's power. A robbed band keeps its men and loses the
     thing that made it dangerous, so the next time you meet it the encounter
     card says something different — which is what makes robbing a decision
     with a future instead of a free purse. */
  function robBand() {
    const band = curBand;
    let guns = 0;
    for (let i = 0; i < band.men.length; i++) {
      const s = band.men[i];
      if (s.wid && s.wid !== "sidearm") { W.stash(s.wid, 1); guns++; s.wid = "sidearm"; }
      if (s.armour && s.armour !== "none") { W.stashArmour(s.armour, 1); s.armour = "none"; }
    }
    const gold = band.gold | 0;
    W.earn(gold);
    band.gold = 0;
    band.mood = "hunt";
    band.cooldown = 0;
    band.wealth = Math.max(0.12, band.wealth * 0.5);
    W.state.fame = Math.max(0, W.state.fame - 1);
    W.log("robbed " + band.name + " at gunpoint — $" + gold + " and " + guns + " guns.", "good");
    W.toast("TAKEN: $" + gold + " AND " + guns + " GUNS", "good");
    finish();
  }

  /* LEAVE. They pursue if they are hungry (hostile) and quick (small parties
     move faster on this island, which is the campaign's own rule) — so walking
     away from a big legion is safe and walking away from six bandits is not. */
  function leaveBand() {
    const band = curBand;
    const F = W.faction(band.faction);
    const speed = clamp(1.35 - band.men.length / 60, 0.4, 1.3);
    const hunger = clamp(W.bandPower(band) / Math.max(1, W.yourPower()), 0.2, 2.2);
    const chase = clamp((F.hostile * 0.42 + hunger * 0.2) * speed +
      (band.mood === "hunt" ? 0.25 : 0), 0, 0.92);
    if (W.chance(chase)) {
      W.log(band.name + " ran you down.", "bad");
      W.toast("THEY CHASE YOU", "bad");
      startBattle({ defending: true, chased: true });
      return;
    }
    band.cooldown = 60 + W.rnd() * 120;
    W.log("you rode away from " + band.name + ".");
    finish();
  }

  function finish() {
    curBand = null;
    if (W.campaign && W.campaign.enter) W.campaign.enter();
    else W.setPhase("campaign");
  }

  /* ============================================================ AFTERMATH
     Everything the battle did, applied ONCE, and then shown. The order matters:
     count the dead before you promote the living, take the loot before the
     prisoners are decided, and never touch W.state.army twice. */
  let R = null;                    // the live report, kept for the prisoner UI

  function aftermath(report) {
    R = report || {};
    R.loot = R.loot || {};
    R.armourLoot = R.armourLoot || {};
    R.yourDead = R.yourDead || [];
    R.yourSurvivors = R.yourSurvivors || [];
    R.yourFled = R.yourFled || [];
    R.theirDead = R.theirDead || [];
    R.theirSurvivors = R.theirSurvivors || [];
    R.ratio = R.ratio || 1;

    if (!R.alreadyBanked) bank(R);
    W.setPhase("aftermath", R);
    paintAftermath();
  }

  function bank(r) {
    // 1. THE DEAD LEAVE THE ARMY — and they take their kit with them, because
    //    the kit is already in the loot the battle reported off their bodies.
    //    keepKit:false is what stops a rifle being counted twice.
    for (let i = 0; i < r.yourDead.length; i++) W.removeSoldier(r.yourDead[i].id, false);
    W.state.stats.lost += r.yourDead.length;
    W.state.stats.killed += r.theirDead.length;
    W.state.stats.battles++;
    if (r.outcome === "won") W.state.stats.won++;

    // 2. THE LOOT. Guns and armour off every body on the field, and their purse.
    let guns = 0;
    Object.keys(r.loot).forEach(function (wid) { W.stash(wid, r.loot[wid]); guns += r.loot[wid]; });
    let armour = 0;
    Object.keys(r.armourLoot).forEach(function (id) { W.stashArmour(id, r.armourLoot[id]); armour += r.armourLoot[id]; });
    r.gunsTaken = guns; r.armourTaken = armour;
    if (r.gold > 0) W.earn(r.gold);

    // 3. PROMOTIONS — core's rule, core's call. Every man who survived,
    //    including the ones who broke and ran: he was there.
    const lived = r.yourSurvivors.concat(r.yourFled);
    r.promoted = W.promoteSurvivors(lived);

    // 4. PRISONERS. Only if you actually took the field: a warlord who fled
    //    does not get to keep the men he was standing over.
    if (r.outcome === "won") {
      for (let i = 0; i < r.theirSurvivors.length; i++) W.state.prisoners.push(r.theirSurvivors[i]);
      W.state.fame += Math.round(1 + r.theirDead.length * 0.4 + r.theirSurvivors.length * 0.2);
      if (r.band) r.band.gold = 0;
    }
    // 5. and the band on the map now reflects who is left standing on the sand
    if (r.band && r.band.men) {
      const gone = {};
      for (let i = 0; i < r.theirDead.length; i++) gone[r.theirDead[i].id] = 1;
      if (r.outcome === "won") for (let i = 0; i < r.theirSurvivors.length; i++) gone[r.theirSurvivors[i].id] = 1;
      r.band.men = r.band.men.filter(function (s) { return !gone[s.id]; });
      if (!r.band.men.length && W.state.bands) {
        const bi = W.state.bands.indexOf(r.band);
        if (bi >= 0) W.state.bands.splice(bi, 1);
      }
    }
    r.alreadyBanked = true;
  }

  /* CONSCRIPTION. Two knobs, and both of them are the same sentence from the
     brief: "cheaper the more you outnumbered them, and higher-tier prisoners
     resist". So the RATIO sets the price and the TIER sets the odds, and a
     veteran is genuinely hard — 0.30 at parity, and no amount of gold moves it,
     because a man who will not turn will not turn.

     `ratio` is the power ratio the battle was actually fought at, handed over
     by battle.js. Not head count: fifteen veterans standing over forty broken
     levies IS an overwhelming victory and the levies know it. */
  function conscriptOdds(s, ratio) {
    if (Q && Q.get("conscript") === "old") return 0.6;
    const ti = W.tierIndex(s.tier);
    const dread = (W.state.stats && W.state.stats.executed) || 0;
    return clamp(0.92 - ti * 0.21 + (clamp(ratio, 0.5, 4) - 1) * 0.09 +
      clamp(W.state.fame / 1500, 0, 0.1) - dread * 0.02, 0.04, 0.97);
  }
  function conscriptPrice(s, ratio) {
    const T = W.tier(s.tier);
    return Math.max(5, Math.round(T.hire * clamp(1.35 - clamp(ratio, 0.5, 4) * 0.22, 0.3, 1.35) / 5) * 5);
  }
  function ransomFor(s) {
    return Math.max(8, Math.round(W.tier(s.tier).hire * 0.8 / 5) * 5);
  }

  function takePrisoner(id) {
    for (let i = 0; i < W.state.prisoners.length; i++) {
      if (W.state.prisoners[i].id === id) return W.state.prisoners.splice(i, 1)[0];
    }
    return null;
  }

  function doConscript(id) {
    const list = W.state.prisoners;
    let s = null;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) s = list[i];
    if (!s || s._refused) return;
    const ratio = (R && R.ratio) || 1;
    const price = conscriptPrice(s, ratio);
    if (!W.pay(price)) { W.toast("not enough gold", "bad"); return; }
    if (W.chance(conscriptOdds(s, ratio))) {
      takePrisoner(id);
      s.wounded = s.hp < s.maxHp * 0.4;
      s.hp = s.maxHp;
      W.addSoldier(s);
      W.state.stats.conscripted++;
      W.log(s.name + " took the gold and the gun.", "good");
      W.toast(s.name.toUpperCase() + " JOINS YOU", "good");
    } else {
      /* A REFUSAL IS PERMANENT FOR THIS MAN, and that is the cost of trying.
         Without it the button is a slot machine you pull until it pays, which
         makes a veteran's resistance decorative. */
      s._refused = true;
      W.log(s.name + " spat the money back at you.", "bad");
      W.toast("HE REFUSES", "bad");
    }
    paintAftermath();
  }
  function doRansom(id) {
    const s = takePrisoner(id);
    if (!s) return;
    const g = ransomFor(s);
    W.earn(g);
    W.log("ransomed " + s.name + " for $" + g + ".");
    paintAftermath();
  }
  function doRelease(id) {
    const s = takePrisoner(id);
    if (!s) return;
    const f = (W.tierIndex(s.tier) + 1) * 2;
    W.state.fame += f;
    W.log("let " + s.name + " walk. +" + f + " fame.", "good");
    paintAftermath();
  }
  function doExecute(id) {
    const s = takePrisoner(id);
    if (!s) return;
    W.state.stats.executed++;
    W.state.fame = Math.max(0, W.state.fame - (W.tierIndex(s.tier) + 1) * 3);
    W.log("executed " + s.name + ".", "bad");
    paintAftermath();
  }
  function bulk(fn) {
    const ids = W.state.prisoners.map(function (s) { return s.id; });
    for (let i = 0; i < ids.length; i++) fn(ids[i]);
    paintAftermath();
  }

  function nameList(men, cls) {
    if (!men.length) return '<div class="wl-small wl-dim">nobody.</div>';
    let h = "";
    for (let i = 0; i < men.length; i++) {
      const s = men[i];
      h += '<div class="wl-row"><span' + (cls ? ' style="' + cls + '"' : "") + '>' + esc(s.name) +
        '</span><span class="wl-small wl-dim">' + esc(W.tier(s.tier).label) + ' &middot; ' +
        esc(W.gunLabel(s.wid)) + (s.kills ? ' &middot; ' + s.kills + ' KILLS' : '') + '</span></div>';
    }
    return h;
  }

  function paintAftermath() {
    const r = R;
    const won = r.outcome === "won" || r.outcome === "surrender";
    const title = r.outcome === "surrender" ? "THEY <em>SURRENDER</em>"
      : r.outcome === "won" ? "THE FIELD IS <em>YOURS</em>"
      : r.outcome === "retreat" ? "YOU <em>RAN</em>"
      : "YOU ARE <em>BROKEN</em>";

    let lootH = "";
    const lootKeys = Object.keys(r.loot || {});
    lootKeys.sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
    for (let i = 0; i < lootKeys.length; i++) {
      const wid = lootKeys[i];
      lootH += '<div class="wl-row"><span>' + esc(W.gunLabel(wid)) + ' &times;' + r.loot[wid] +
        '</span><span class="wl-small wl-gold">worth $' + (W.gunSell(wid) * r.loot[wid]) + '</span></div>';
    }
    const aKeys = Object.keys(r.armourLoot || {});
    for (let i = 0; i < aKeys.length; i++) {
      lootH += '<div class="wl-row"><span>' + esc(W.armour(aKeys[i]).label) + ' &times;' + r.armourLoot[aKeys[i]] +
        '</span><span class="wl-small wl-gold">worth $' + (W.armourSell(aKeys[i]) * r.armourLoot[aKeys[i]]) + '</span></div>';
    }
    if (r.gold > 0) lootH += '<div class="wl-row"><span>THEIR PURSE</span><span class="wl-gold">$' + r.gold + '</span></div>';
    if (!lootH) lootH = '<div class="wl-small wl-dim">nothing worth carrying.</div>';

    const wounded = r.yourSurvivors.filter(function (s) { return s.wounded; });
    const ratio = (r.ratio || 1);

    let prisH = "";
    if (W.state.prisoners.length) {
      for (let i = 0; i < W.state.prisoners.length; i++) {
        const s = W.state.prisoners[i];
        const price = conscriptPrice(s, ratio);
        const odds = Math.round(conscriptOdds(s, ratio) * 100);
        prisH +=
          '<div class="wl-card" style="padding:10px 12px">' +
          '<div class="wl-row" style="border:0;padding:0 0 6px">' +
            '<span><b>' + esc(s.name) + '</b> <span class="wl-small wl-dim">' +
              esc(W.tier(s.tier).label) + ' &middot; ' + esc(W.gunLabel(s.wid)) + '</span></span>' +
          '</div>' +
          '<div class="wl-btns" style="margin:0;gap:6px">' +
            (s._refused
              ? '<button class="wl-btn ghost wl-small" disabled>REFUSED YOU</button>'
              : '<button class="wl-btn wl-small" data-con="' + s.id + '"' +
                (W.state.gold < price ? " disabled" : "") + '>CONSCRIPT $' + price +
                ' <span class="wl-dim">' + odds + '%</span></button>') +
            '<button class="wl-btn wl-small" data-ran="' + s.id + '">RANSOM $' + ransomFor(s) + '</button>' +
            '<button class="wl-btn wl-small" data-rel="' + s.id + '">RELEASE</button>' +
            '<button class="wl-btn bad wl-small" data-exe="' + s.id + '">EXECUTE</button>' +
          '</div></div>';
      }
    }

    const dread = (W.state.stats && W.state.stats.executed) || 0;

    ctx.screen(
      '<h1 class="wl-h">' + title + '</h1>' +
      '<p class="wl-sub">' + (r.band ? esc(r.band.name) : "THE FIELD") +
        (r.duration ? ' &middot; ' + Math.round(r.duration) + 's' : '') +
        ' &middot; YOU KILLED ' + (r.youKills || 0) + '</p>' +

      '<div class="wl-grid">' +
        '<div class="wl-card"><div class="wl-small wl-dim">YOUR DEAD</div>' +
          '<div style="font-size:26px;color:var(--blood)">' + r.yourDead.length + '</div></div>' +
        '<div class="wl-card"><div class="wl-small wl-dim">THEIR DEAD</div>' +
          '<div style="font-size:26px">' + r.theirDead.length + '</div></div>' +
        '<div class="wl-card"><div class="wl-small wl-dim">STILL RIDING</div>' +
          '<div style="font-size:26px">' + (r.yourSurvivors.length + r.yourFled.length) + '</div></div>' +
        '<div class="wl-card"><div class="wl-small wl-dim">PRISONERS</div>' +
          '<div style="font-size:26px">' + W.state.prisoners.length + '</div></div>' +
      '</div>' +

      (r.yourDead.length
        ? '<div class="wl-lbl">THE DEAD — BY NAME</div><div class="wl-card">' +
          nameList(r.yourDead, "color:var(--blood)") + '</div>' : '') +

      (wounded.length
        ? '<div class="wl-lbl">WOUNDED — THEY FIGHT AT 60% UNTIL THEY REST</div><div class="wl-card">' +
          nameList(wounded) + '</div>' : '') +

      (r.yourFled.length
        ? '<div class="wl-lbl">BROKE AND RAN — THEY CAME BACK</div><div class="wl-card">' +
          nameList(r.yourFled) + '</div>' : '') +

      (r.promoted && r.promoted.length
        ? '<div class="wl-lbl">PROMOTED</div><div class="wl-card">' +
          r.promoted.map(function (s) {
            return '<div class="wl-row"><span style="color:var(--gold)">' + esc(s.name) +
              '</span><span class="wl-small">now a ' + esc(W.tier(s.tier).label) + '</span></div>';
          }).join("") + '</div>' : '') +

      '<div class="wl-lbl">TAKEN OFF THE FIELD</div>' +
      '<div class="wl-card">' + lootH + '</div>' +

      (prisH
        ? '<div class="wl-lbl">PRISONERS — ' + W.state.prisoners.length + '</div>' +
          '<div class="wl-btns" style="margin:0 0 10px">' +
            '<button class="wl-btn wl-small" id="pAllRel">RELEASE ALL</button>' +
            '<button class="wl-btn wl-small" id="pAllRan">RANSOM ALL</button>' +
          '</div>' + prisH +
          '<div class="wl-card wl-small wl-dim">releasing men buys a reputation: bands surrender to a ' +
          'warlord who lets men walk. executing them buys the opposite — ' +
          (dread ? 'you have executed ' + dread + ', and every band you meet now fights ' +
            Math.round((1 - dreadMul()) * 100) + '% harder to the last man.'
                 : 'the first band that hears about it will fight you to the last man.') +
          '</div>'
        : '') +

      '<div class="wl-btns" style="margin-top:18px">' +
        '<button class="wl-btn hot" id="aDone">RIDE ON</button>' +
      '</div>'
    );

    const stage = ctx.el("stage");
    stage.querySelectorAll("[data-con]").forEach(function (b) {
      b.onclick = function () { doConscript(+b.dataset.con); };
    });
    stage.querySelectorAll("[data-ran]").forEach(function (b) {
      b.onclick = function () { doRansom(+b.dataset.ran); };
    });
    stage.querySelectorAll("[data-rel]").forEach(function (b) {
      b.onclick = function () { doRelease(+b.dataset.rel); };
    });
    stage.querySelectorAll("[data-exe]").forEach(function (b) {
      b.onclick = function () { doExecute(+b.dataset.exe); };
    });
    const ar = ctx.el("pAllRel"); if (ar) ar.onclick = function () { bulk(doRelease); };
    const an = ctx.el("pAllRan"); if (an) an.onclick = function () { bulk(doRansom); };
    ctx.el("aDone").onclick = function () {
      /* PRISONERS YOU DID NOT DECIDE ON RIDE WITH YOU. They stay in
         W.state.prisoners and the HUD keeps counting them, so an outpost can
         sell them later — leaving the screen is not a decision that silently
         deletes men. */
      R = null;
      finish();
    };
  }

  /* ============================================================ REST
     "wounded ... until they rest". Nothing in core clears the flag, and a
     wounded flag that never clears is a permanent 38% tax on a man who lived —
     which turns every victory into a slow loss. Dawn is where the day's
     book-keeping already happens, so dawn is where a man stops limping. */
  function restAtDawn() {
    let healed = 0;
    for (let i = 0; i < W.state.army.length; i++) {
      const s = W.state.army[i];
      if (s.wounded) { s.wounded = false; healed++; }
      s.hp = s.maxHp;
    }
    if (healed) W.log(healed + " wounded men are back on their feet.");
  }

  /* ============================================================ */
  W.module("army", {
    needs: [],
    boot: function (c) {
      ctx = c;
      Q = c.Q;
      installDread();
      W.on("dawn", restAtDawn);

      /* ?encounter=1 — the debug door. campaign.js is written by another
         agent and may not be here yet; a screen that can only be reached
         through a file that does not exist cannot be tested at all. */
      if (Q && Q.get("encounter") === "1") {
        setTimeout(function () {
          const band = W.makeBand({ size: parseInt(Q.get("them") || "24", 10) || 24 });
          band.x = W.state.you.x + 30; band.z = W.state.you.z;
          W.state.bands.push(band);
          encounter(band);
        }, 30);
      }
    },

    // ---- the screens
    encounter: encounter,
    aftermath: aftermath,

    // ---- the shared roster shape (loadout.js and the encounter card read it)
    roster: function () { return W.state.army.slice(); },
    groups: function (men) { return groupsOf(men || W.state.army); },
    composition: composition,

    // ---- the numbers other modules ask for
    hirePrice: hirePrice,
    canRob: canRob,
    dreadMul: dreadMul,
    conscriptOdds: conscriptOdds,
    conscriptPrice: conscriptPrice,
  });
})();
