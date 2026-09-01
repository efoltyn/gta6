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

   2026-09-01 — THE SCREENS GOT SHORTER AND THE PARTIES STOPPED GOING DEAF.
   Three owner complaints landed on this file at once: too much scrolling, too
   much talking, and "after interacting with an army you can't again". The
   first two are answered screen by screen below (search NO POP-UP, THE
   VERDICT SENTENCE, THE ROSTER, THE FOUR STAT TILES); the third was
   leaveBand's one-to-three-MINUTE cooldown meeting a silent guard in
   campaign.js — see BREAKING OFF and NO DEAD TAPS.

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

  /* THE ONE-LINE COMPOSITION IS DELETED. It built the sentence "45 raiders
     with 12g pump (+9 other guns), 165 levys with ak-47 (+10 other guns)."
     and a short form for the rail header, and after this wave nothing calls
     either: the encounter rail and the INSPECT roster both draw the same
     stacked bar instead (tierStack / unitChips above), which is the same
     grouping as a picture. It is deleted rather than left exported because a
     live function that manufactures exactly the prose the owner asked to be
     rid of is an invitation to put it back, and git holds the original.

     groupsOf() — the grouping itself — stays. That is the shape; the sentence
     was one rendering of it. */

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
    const premium = 1.15 + W.bandHostile(band) * 1.5;
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
  const ASK_MEMORY = 3;      // days a band remembers being asked to surrender
  function canRob(band) {
    return W.yourPower() >= W.bandPower(band) * ROB_RATIO && band.men.length > 0;
  }

  /* ============================================================ THE CARD */
  let curBand = null;

  /* ONE PALETTE FOR "WHAT KIND OF MAN IS THIS", SHARED BY EVERY SCREEN IN
     THIS FILE. It was a local inside paintEncounter, so the roster screen and
     the aftermath spelled the tier out in words instead — which is how a
     picture that already exists gets narrated three files later. Levy is dust,
     raider is rust, soldier is the game's own blood-orange, veteran is gold.
     Ordered dark to bright on purpose: brighter IS more dangerous. */
  const TIER_COLOUR = { levy: "#8d8267", raider: "#c07f3a", soldier: "#c4593a", veteran: "#ffd166" };
  function tierColour(t) { return TIER_COLOUR[t] || "#8d8267"; }

  /* THE COMPOSITION, AS A PICTURE. One stacked bar segmented by tier plus a
     swatch legend — the two pieces the encounter rail already used, lifted out
     of it so the INSPECT roster stops describing the same army in prose. */
  function tierStack(men) {
    const byTier = {};
    for (let i = 0; i < men.length; i++) byTier[men[i].tier] = (byTier[men[i].tier] || 0) + 1;
    const tiers = Object.keys(byTier).sort(function (a, b) { return W.tierIndex(b) - W.tierIndex(a); });
    const total = Math.max(1, men.length);
    let stack = "", legend = "";
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i], n = byTier[t], pct = (n / total) * 100, c = tierColour(t);
      stack += '<i style="width:' + pct.toFixed(2) + '%;background:' + c + '">' +
        (pct > 11 ? n : "") + '</i>';
      legend += '<span><em style="background:' + c + '"></em>' + esc(W.tier(t).label) + '</span>';
    }
    return '<div class="wl-stack">' + stack + '</div><div class="wl-legend">' + legend + '</div>';
  }

  /* AND THE STACKS AS CHIPS. See .wl-unit in games/warlord.html for the
     measurement that killed the table this replaced. */
  /* 18, MEASURED. A 210-man company groups into ~34 stacks, most of them one
     or two men with an odd gun; at 30 chips the screen was 183 px past the
     fold on an iPhone SE. 18 covers every stack that is more than a rounding
     error on a band that size and lands the screen at ~545 px. */
  const UNIT_CAP = 18;
  function unitChips(men) {
    const gs = groupsOf(men);
    let h = '<div class="wl-units">';
    for (let i = 0; i < gs.length && i < UNIT_CAP; i++) {
      const g = gs[i];
      /* THE TIER IS THE COLOUR, NOT A WORD ON EVERY CHIP. The first draft
         printed it — "8 RAIDER M249 LMG" — and the screenshot showed the word
         RAIDER twenty times down a wrapped list whose every chip already wore
         the raider colour on its left edge, directly under a legend that maps
         that colour to that word. Twenty repetitions of a nine-letter word is
         180 characters spent saying what the paint says. */
      h += '<span class="wl-unit" style="--c:' + tierColour(g.tier) + '"><b>' + g.count + '</b> ' +
        '<i>' + esc(g.gun) + '</i>' +
        (g.armour !== "none" ? '<u title="' + esc(W.armour(g.armour).label) + '"></u>' : '') +
        '</span>';
    }
    if (gs.length > UNIT_CAP) h += '<span class="wl-unit wl-dim">+' + (gs.length - UNIT_CAP) + '</span>';
    return h + '</div>';
  }

  function encounter(band, opts) {
    opts = opts || {};
    if (!band || !band.men || !band.men.length) {
      W.toast("NOTHING OUT THERE", "bad");
      if (W.campaign && W.campaign.enter) W.campaign.enter();
      return;
    }
    curBand = band;
    W.setPhase("encounter", { band: band });
    paintEncounter(opts);
  }

  /* THE LEGACY FULL-SCREEN CARD (?encounterui=old) IS DELETED, not disabled.
     It was kept "so the two can be photographed against each other rather
     than argued about" — a fair reason on the day the rail replaced it, and a
     stale second opinion about what a meeting looks like ever since. It still
     printed composition().text, a nine-clause sentence this wave has just
     finished deleting from every screen that reads it, so leaving it in would
     have meant maintaining the exact prose the owner asked to be rid of.
     git is the undo; a2f0f92..HEAD has the card whole. */

  function paintEncounter(opts) {
    opts = opts || {};
    const band = curBand;
    const mine = W.yourPower(), theirs = W.bandPower(band);
    const odds = W.odds(mine, theirs);
    const surr = W.surrenderChance(band, mine);
    const price = hirePrice(band);
    const rob = canRob(band);
    const F = W.faction(band.faction);
    const colour = "#" + (band.colour || 0xc4593a).toString(16).padStart(6, "0");
    /* A REFUSAL EXPIRES. `_surrenderAsked` was a boolean set once and cleared
       nowhere in the repo — not on leaving, not at dawn, not on a new game —
       so a band you once shouted at wore a permanently greyed-out DEMAND with
       the chip "refused" for the rest of its life on the island, which is a
       dead control the player can never explain. It is a DAY now: three days
       is long enough that asking twice is not free and short enough that the
       button always comes back. */
    const asked = band._askedDay != null && (W.state.day - band._askedDay) < ASK_MEMORY;

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
       IS a thing you stop to do. */

    /* THE VERDICT SENTENCE IS GONE AND THE BUTTON WEARS IT INSTEAD.
       "62% — an even fight" was the odds said a THIRD time: once as a bar,
       once as a number, once as an English clause, on a strip that has to fit
       on a 375 px phone. What replaces it is not a shorter sentence, it is a
       COLOUR: ATTACK is the game's orange when you are likely to win and
       blood red when you are not, so the button you are about to press is
       itself the warning. The number rides on that button as its chip, where
       it is attached to the decision it prices instead of floating above it.

       Measured: the body lost 26 px of height and 44 characters, and the
       encounter rail stopped overflowing on every phone frame. */
    const attackKind = odds > 0.55 ? "hot" : odds > 0.3 ? "" : "bad";

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
      const c = tierColour(t);
      // the count goes INSIDE the segment, but only where it fits — a number
      // clipped to "1" in a 4% sliver is worse than no number
      stack += '<i style="width:' + pct.toFixed(2) + '%;background:' + c + '">' +
        (pct > 11 ? n : "") + '</i>';
      /* THE LEGEND CARRIES THE NAME, THE SEGMENT CARRIES THE COUNT. It used
         to print both, so "120" appeared inside the orange block and again
         two lines below it as "120 SOLDIER" — a number repeated is the same
         slop as a sentence repeated, and this one costs a whole extra line on
         a phone once there are four tiers. The swatch is the join. */
      legend += '<span><em style="background:' + c + '"></em>' +
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
    /* FOUR THINGS DELETED FROM THIS BODY, AND EVERY ONE OF THEM WAS A CAPTION
       ON A PICTURE THAT WAS ALREADY THERE.

         "THEIR MEN"   labelled a stacked bar that is obviously their men; it
                       sits directly under a bar labelled YOU / THEM.
         "CARRYING"    labelled a row of chips that each read "14 AK-47".
         the verdict   see attackKind above.
         two asides    "they already told you no." duplicated a DEMAND button
                       that is greyed out and chipped "refused"; "you
                       outnumber them badly enough to just take it." explained
                       a ROB button that only exists when that is true.

       That is 4 lines of layout and 118 characters of copy off a strip the
       player reads at every single meeting — which is the screen in this game
       that earns the fewest words, because it is the one seen most often. */
    const body =
      '<div class="wl-split">' +
        '<i style="width:' + (myShare * 100).toFixed(2) + '%;background:var(--hot)"></i>' +
        '<i style="width:' + ((1 - myShare) * 100).toFixed(2) + '%;background:' + colour + '"></i>' +
      '</div>' +
      '<div class="wl-ends"><span>YOU ' + W.armySize() + '</span><span>' +
        band.men.length + ' THEM</span></div>' +
      '<div class="wl-stack">' + stack + '</div>' +
      '<div class="wl-legend">' + legend + '</div>' +
      '<div class="wl-chips">' + chips + '</div>';

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
        { label: "ATTACK", kind: attackKind, note: Math.round(odds * 100) + "%",
          on: function () { startBattle({}); } },
        { label: "DEMAND", note: asked ? "refused" : Math.round(surr * 100) + "%",
          disabled: !!asked, on: demandSurrender },
        (price != null
          ? { label: "HIRE", note: "$" + price, disabled: W.state.gold < price,
              on: function () { hireBand(price); } }
          : { label: "HIRE", note: hireWhy(band) ? "never" : "no", disabled: true, on: function () {} }),
        (rob ? { label: "ROB", note: "no fight", on: robBand } : null),
        /* NO NOTE. Every other verb's chip is a PRICE — 4%, $540, refused —
           and INSPECT's said "every man", which is a gloss on the word
           INSPECT. A chip that is not a number is a caption. */
        { label: "INSPECT", on: paintRoster },
        { label: "RIDE AWAY", on: leaveBand },
      ],
    });
  }

  /* THE ROSTER, which IS worth a screen: reading forty men's kit is a thing
     you deliberately stop to do, and nothing is chasing you while you do it
     that was not already chasing you. Backs straight out to the rail.

     IT WAS THE WORST SCROLL IN THE GAME AND IT WAS SAYING EVERYTHING TWICE.
     Measured on an iPhone SE against a 210-man company: 2 053 px of content
     in a 667 px box — 1 386 px below the fold — and 1 420 rendered
     characters. What was in it:

       · a prose card: "120 soldiers with ak-47s (+6 other guns), 62 raiders
         with carbines (+4 other guns), …" — the same grouping the table under
         it drew, spelled out in a sentence, plus "no armour on any of them"
         and "they are carrying about $340." Three lines of English describing
         a table sitting six pixels below it.
       · a full-width row per stack, ~34 px each, with the tier's NAME written
         out on every one.

     Now: the same stacked bar the rail uses (so the two screens are one
     picture at two zooms), the stacks as wrapped chips tinted by tier, and
     the purse and the armour count as chips — because "they are carrying
     about $340" is a number wearing a sentence. 1 420 chars -> ~320. */
  function paintRoster() {
    const band = curBand;
    if (!band) return;
    let armoured = 0, bestArm = "none";
    for (let i = 0; i < band.men.length; i++) {
      const a = band.men[i].armour || "none";
      if (a === "none") continue;
      armoured++;
      if (W.armour(a).soak > W.armour(bestArm).soak) bestArm = a;
    }
    const colour = "#" + (band.colour || 0xc4593a).toString(16).padStart(6, "0");
    ctx.screen('<div class="wl-cols">' +
      '<h1 class="wl-h" style="color:' + colour + '">' + esc(band.name) + '</h1>' +
      '<p class="wl-sub">' + band.men.length + ' MEN &middot; ' + esc(W.faction(band.faction).label) + '</p>' +
      tierStack(band.men) +
      '<div class="wl-chips" style="margin:10px 0 12px">' +
        '<span class="wl-chip wl-gold">$' + (band.gold | 0) + '</span>' +
        (armoured ? '<span class="wl-chip arm"><b>' + armoured + '</b> ' +
          esc(W.armour(bestArm).label) + '</span>' : '') +
      '</div>' +
      unitChips(band.men) +
      '<div class="wl-btns"><button class="wl-btn hot" id="rBack">BACK</button></div>' +
      '</div>'
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
    band._askedDay = W.state.day;
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
    if (price == null || !W.pay(price)) { W.toast("NOT ENOUGH GOLD", "bad"); return; }
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

  /* ============================================================ BREAKING OFF
     LEAVE. They pursue if they are hungry (hostile) and quick (small parties
     move faster on this island, which is the campaign's own rule) — so walking
     away from a big legion is safe and walking away from six bandits is not.

     THIS FUNCTION HELD THE WHOLE OF THE OWNER'S BUG: "After interacting with
     an army you can't again for some reason."

     It set `band.cooldown = 60 + rnd() * 120`. campaign.js's engage() opens
     with `if (!b || b.cooldown > 0) return false;` and the tap site
     (campaign.js:1763) throws that boolean away, so for ONE TO THREE MINUTES
     after riding away, tapping that party did nothing at all: no rail, no
     toast, no log line, no change to its marker. Worse, campaign.js keeps
     `chase` pointing at it, so the player walks into the party and stands
     there pressing it. Nothing on the island was different to look at. The
     band was, in every sense the player has access to, broken.

     THE COOLDOWN WAS NEVER THE MECHANIC. What "ride away" is supposed to mean
     is that the two of you separate — and campaign.js's engage() already
     stamps its own 12 s on every meeting, so a second, twelve-times-longer
     timer was not buying the separation, it was buying the silence.

     MEASURED, both builds, standing on an 18-man party and pressing RIDE
     AWAY (tools/lib/cdp.mjs, 852x393 headless, seed 1337):

         before   cooldown 88.7 s, still 69.3 s eighteen seconds later,
                  and the party never answers again in that window
         after    cooldown 8 s, drained to 0 inside the same eighteen,
                  and the rail re-opens 8-12 s after the break-off

     So: eight seconds, which is a beat and not a lockout, AND the thing the
     timer was standing in for — THEY ACTUALLY LEAVE. While the cooldown runs,
     campaign.js's band AI is skipped and any hunt/flee mood is forced back to
     "roam", which walks the party towards `b.goal`; so the goal is set to the
     land point that points most directly away from you and the player watches
     them ride off. That is the same fact as the old number, drawn instead of
     enforced, and it is self-correcting: chase them down and you meet them
     again, which is exactly what should happen.

     If you STAND STILL, you meet them again in eight seconds. That is also
     correct — you are standing next to an armed company — and it is the
     behaviour unstickContacts() below guarantees can never fail silently. */
  const BREAK_OFF = 8;
  function ridesAway(band) {
    /* AWAY IS A DIRECTION, NOT A COORDINATE. Offsetting the party's position
       by a few hundred metres puts goals in the sea and on cliffs; desert.js's
       landPoint only ever returns walkable ground, so the pick is made from
       candidates it hands out and scored on the cosine between "band to
       candidate" and "player to band". Eight candidates, which in a live
       probe scored 0.92-0.98 against a perfect 1.00 — good enough that the
       party is visibly leaving, and honest about the fact that on a coast
       there may be no walkable ground straight behind them. */
    const D = W.desert;
    if (!D || !D.landPoint) return;
    const ax = band.x - W.state.you.x, az = band.z - W.state.you.z;
    const an = Math.hypot(ax, az) || 1;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 8; i++) {
      let p = null;
      try { p = D.landPoint(W.rnd, { maxSlope: 0.30 }); } catch (e) { return; }
      if (!p) return;
      const dx = p.x - band.x, dz = p.z - band.z;
      const n = Math.hypot(dx, dz) || 1;
      const score = (dx * ax + dz * az) / (n * an);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best) band.goal = { x: best.x, z: best.z, why: "" };
  }

  function leaveBand() {
    const band = curBand;
    const speed = clamp(1.35 - band.men.length / 60, 0.4, 1.3);
    const hunger = clamp(W.bandPower(band) / Math.max(1, W.yourPower()), 0.2, 2.2);
    /* THE ARCHETYPE'S APPETITE. A salt caravan does not run you down; a
       raiding crew of the same size does. W.bandHostile falls through to the
       faction row for every party that never overrode it. */
    const chase = clamp((W.bandHostile(band) * 0.42 + hunger * 0.2) * speed +
      (band.mood === "hunt" ? 0.25 : 0), 0, 0.92);
    if (W.chance(chase)) {
      W.log(band.name + " ran you down.", "bad");
      W.toast("THEY CHASE YOU", "bad");
      startBattle({ defending: true, chased: true });
      return;
    }
    band.cooldown = BREAK_OFF;
    band.mood = "roam";
    /* THE ONE COOLDOWN THE PLAYER ASKED FOR. unstickContacts() below clears
       any refusal that outlasts two and a half seconds of standing on a
       party, and without this mark it would clear THIS one too — turning
       RIDE AWAY into "you have 2.5 seconds to leave". A break-off the player
       chose is not a bug; it gets its full eight seconds and then this clears
       itself. */
    band._brokeOff = true;
    ridesAway(band);
    W.log("you rode away from " + band.name + ".");
    finish();
  }

  /* ============================================================ NO DEAD TAPS
     THE GUARANTEE: a party you are standing on top of always answers.

     campaign.js owns the door (engage()) and its guard is a bare
     `return false` with no toast and no log — a refusal the player cannot
     see, hear or read, on a target that looks completely normal. This file
     cannot make that refusal speak, because campaign.js belongs to somebody
     else and the tap site calls its own local closure rather than the export,
     so there is nothing to wrap. What this file CAN do is make sure the
     condition never survives long enough to be experienced as a broken game.

     So: if the player has been inside contact range of a party for two and a
     half continuous seconds and no rail and no screen has opened, the
     cooldown holding it shut is stale by definition — you are close enough to
     smell them — and it is cleared. campaign.js's own contact test then fires
     on the very next frame and opens the encounter exactly as it always did.
     One door, still; this only removes the thing wedged under it.

     IT ALSO CLOSES THE SECOND, WORSE HOLE. events.js's hideMe() re-stamps
     `cooldown = 2` every tick on every band within 340-480 m during a
     sandstorm or at night — which is a good mechanic at range and an infinite
     silent lockout at ten metres, because it re-arms faster than it drains.
     That one is fixed at source in events.js too (see NOT AT ARM'S LENGTH),
     and this is the belt to that pair of braces.

     WHY 2.5 s AND NOT 0. Zero would fight campaign.js over the 12 s debounce
     it stamps on every meeting, and re-open the rail the instant the player
     closed it. 2.5 s is longer than any hand-off between screens in this game
     and far shorter than the eight-second break-off above, so the only state
     it can ever catch is a genuinely stuck one. */
  const CONTACT_R = 30;      // campaign.js's CONTACT is 26 m; a little wider
  const STUCK_S = 2.5;
  let stuckFor = 0, stuckId = null;
  function unstickContacts(dt) {
    if (!ctx || W.phase() !== "campaign") { stuckFor = 0; return; }
    if (ctx.verbsOpen && ctx.verbsOpen()) { stuckFor = 0; return; }
    const st = ctx.el && ctx.el("stage");
    if (st && st.classList.contains("on")) { stuckFor = 0; return; }
    const S = W.state;
    if (!S.bands || !S.bands.length) { stuckFor = 0; return; }
    let near = null, nd = 1e9;
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      if (!b.men || !b.men.length) continue;
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d < CONTACT_R && d < nd) { nd = d; near = b; }
    }
    if (!near) { stuckFor = 0; stuckId = null; return; }
    if (near.id !== stuckId) { stuckId = near.id; stuckFor = 0; }
    if (near.cooldown <= 0) { stuckFor = 0; near._brokeOff = false; return; }
    // a break-off the player chose runs its course; see leaveBand
    if (near._brokeOff) { stuckFor = 0; return; }
    stuckFor += dt;
    if (stuckFor >= STUCK_S) { near.cooldown = 0; stuckFor = 0; }
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
    if (!W.pay(price)) { W.toast("NOT ENOUGH GOLD", "bad"); return; }
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
  /* TAKE ALL IS NOT `bulk(doConscript)`, AND THE DIFFERENCE IS FOURTEEN
     TOASTS. doConscript pays per man and toasts "not enough gold" when it
     cannot — run over a purse that covers nine of fourteen prisoners, the
     plain bulk would stack five identical failures on top of the screen. It
     stops at the first one it cannot afford instead, which is also the
     honest reading of the button: take as many as the money buys. */
  function bulkConscript() {
    const ratio = (R && R.ratio) || 1;
    const ids = [];
    for (let i = 0; i < W.state.prisoners.length; i++) {
      const s = W.state.prisoners[i];
      if (s._refused) continue;
      if (W.state.gold < conscriptPrice(s, ratio)) break;
      ids.push(s.id);
    }
    for (let i = 0; i < ids.length; i++) doConscript(ids[i]);
    paintAftermath();
  }

  /* NAMES, AND NOTHING BUT NAMES. This printed a full-width row per man
     carrying his tier, his gun and his kill count — a stat block on a corpse.
     The reason core.js gives every soldier a name is that "you lost 7" is a
     spreadsheet and "Kaseem Ash is dead" is a reason not to charge next time;
     his rifle is not part of that and it is already in the loot chips. Nine
     dead went from 306 px of table to two wrapped lines.

     CAPPED, because a rout can kill sixty and the point of the list is that
     you READ it. Past the cap the count is the honest summary. */
  /* 12: two wrapped lines of names on a 375 px phone. The cap exists so a
     rout does not push the prisoner decision off the screen; past it the
     count is the honest summary. */
  const NAME_CAP = 12;
  function nameChips(men, cls, tag) {
    if (!men.length) return "";
    let h = '<div class="wl-names">';
    for (let i = 0; i < men.length && i < NAME_CAP; i++) {
      h += '<span class="' + cls + '">' + esc(men[i].name) +
        (tag ? ' <em>' + esc(tag(men[i])) + '</em>' : '') + '</span>';
    }
    if (men.length > NAME_CAP) h += '<span class="wl-dim">+' + (men.length - NAME_CAP) + '</span>';
    return h + '</div>';
  }

  /* A CASUALTY BAR: one side of a battle, cut into what it cost. Same
     primitive as the encounter's composition stack, which is deliberate —
     the picture you read before the fight and the picture you read after it
     should be the same picture, so that the second one answers the first. */
  function tollBar(who, parts) {
    let total = 0;
    for (let i = 0; i < parts.length; i++) total += parts[i].n;
    total = Math.max(1, total);
    let bar = "", legend = '<span class="wl-dim">' + who + '</span>';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], pct = (p.n / total) * 100;
      if (!p.n) continue;
      bar += '<i style="width:' + pct.toFixed(2) + '%;background:' + p.c + '">' +
        (pct > 13 ? p.n : "") + '</i>';
      legend += '<span><em style="background:' + p.c + '"></em>' + p.n + " " + p.k + '</span>';
    }
    return '<div class="wl-stack">' + bar + '</div><div class="wl-legend">' + legend + '</div>';
  }

  /* ONE-BY-ONE IS OFF BY DEFAULT, and that is the whole prisoner fix. Every
     prisoner used to be a CARD with four buttons in it: fourteen prisoners —
     an ordinary haul off a 60-man band — was 1 960 px of cards and 56 controls
     on one screen. The decision is nearly always taken in bulk (take the lot,
     ransom the lot, let them all walk), so bulk is what the screen offers and
     the individual roll is behind the heading. */
  let PRIS_OPEN = false;

  function paintAftermath() {
    const r = R;
    const title = r.outcome === "surrender" ? "THEY <em>SURRENDER</em>"
      : r.outcome === "won" ? "THE FIELD IS <em>YOURS</em>"
      : r.outcome === "retreat" ? "YOU <em>RAN</em>"
      : "YOU ARE <em>BROKEN</em>";

    /* ---- THE TAKE, AS CHIPS ----
       This was a row per gun with "worth $84" beside each one, then a row for
       the purse. The per-row worth is a number nobody spends: you cannot sell
       one rifle out of a loot table, and the only figure that matters at this
       moment is what the whole field was worth. So: a chip per gun, gold-lit,
       and ONE total. */
    const chips = [];
    let worth = r.gold > 0 ? r.gold : 0;
    const lootKeys = Object.keys(r.loot || {});
    lootKeys.sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
    for (let i = 0; i < lootKeys.length && i < 6; i++) {
      const wid = lootKeys[i];
      worth += W.gunSell(wid) * r.loot[wid];
      chips.push('<span class="wl-chip"><b>' + r.loot[wid] + '</b> ' + esc(W.gunLabel(wid)) + '</span>');
    }
    if (lootKeys.length > 6) {
      for (let i = 6; i < lootKeys.length; i++) worth += W.gunSell(lootKeys[i]) * r.loot[lootKeys[i]];
      chips.push('<span class="wl-chip wl-dim">+' + (lootKeys.length - 6) + '</span>');
    }
    const aKeys = Object.keys(r.armourLoot || {});
    for (let i = 0; i < aKeys.length; i++) {
      worth += W.armourSell(aKeys[i]) * r.armourLoot[aKeys[i]];
      chips.push('<span class="wl-chip arm"><b>' + r.armourLoot[aKeys[i]] + '</b> ' +
        esc(W.armour(aKeys[i]).label) + '</span>');
    }
    if (worth > 0) chips.push('<span class="wl-chip wl-gold">$' + Math.round(worth) + '</span>');

    const wounded = r.yourSurvivors.filter(function (s) { return s.wounded; });
    const ratio = (r.ratio || 1);
    const held = Math.max(0, r.yourSurvivors.length - r.yourFled.length);
    const pris = W.state.prisoners;

    /* ---- THE PRISONER BLOCK ----
       A tier stack, four bulk verbs carrying their own price, and the roll
       behind the heading. The paragraph that used to sit under it —
       "releasing men buys a reputation: bands surrender to a warlord who lets
       men walk. executing them buys the opposite — you have executed 3, and
       every band you meet now fights 23% harder to the last man." — was 250
       characters of the interface explaining its own buttons. Both halves of
       it are now chips ON those buttons: RELEASE says what it buys in fame,
       EXECUTE says what it costs in surrenders. */
    let prisH = "";
    if (pris.length) {
      let conCost = 0, ranTake = 0, relFame = 0;
      for (let i = 0; i < pris.length; i++) {
        if (!pris[i]._refused) conCost += conscriptPrice(pris[i], ratio);
        ranTake += ransomFor(pris[i]);
        relFame += (W.tierIndex(pris[i].tier) + 1) * 2;
      }
      /* WHAT EXECUTING THEM COSTS, AS A NUMBER ON THE BUTTON THAT DOES IT.
         Derived from dreadMul's own curve rather than a second copy of it, and
         it reads 0 under ?dread=old because under that flag executions really
         do cost nothing later — a chip that lies about a reverted mechanic is
         worse than no chip. */
      const dreadAfter = (Q && Q.get("dread") === "old") ? dreadMul()
        : 1 / (1 + (((W.state.stats && W.state.stats.executed) || 0) + pris.length) * 0.09);
      prisH =
        '<div class="wl-lbl"><button class="lblbtn" id="pOpen"><span>PRISONERS ' + pris.length +
          '</span><span>' + (PRIS_OPEN ? "&#9662;" : "&#9656;") + '</span></button></div>' +
        tierStack(pris) +
        '<div class="wl-btns">' +
          '<button class="wl-btn hot" id="pAllCon"' + (W.state.gold < conCost ? " disabled" : "") +
            '>TAKE ALL <span class="wl-dim">$' + conCost + '</span></button>' +
          '<button class="wl-btn" id="pAllRan">RANSOM <span class="wl-gold">+$' + ranTake + '</span></button>' +
          '<button class="wl-btn" id="pAllRel">RELEASE <span class="wl-dim">+' + relFame + ' FAME</span></button>' +
          '<button class="wl-btn bad" id="pAllExe">EXECUTE <span class="wl-dim">&minus;' +
            Math.round((1 - dreadAfter / dreadMul()) * 100) + '%</span></button>' +
        '</div>';
      if (PRIS_OPEN) {
        prisH += '<div class="wl-card" style="margin-top:8px">';
        for (let i = 0; i < pris.length; i++) {
          const s = pris[i];
          const price = conscriptPrice(s, ratio);
          prisH +=
            '<div class="prow"><span class="who" style="color:' + tierColour(s.tier) + '">' +
              esc(s.name) + '</span><span class="acts">' +
              (s._refused
                ? '<button class="wl-btn ghost" disabled>NO</button>'
                : '<button class="wl-btn" data-con="' + s.id + '"' +
                  (W.state.gold < price ? " disabled" : "") + '>$' + price + ' &middot; ' +
                  Math.round(conscriptOdds(s, ratio) * 100) + '%</button>') +
              '<button class="wl-btn" data-ran="' + s.id + '">$' + ransomFor(s) + '</button>' +
              '<button class="wl-btn" data-rel="' + s.id + '">GO</button>' +
              '<button class="wl-btn bad" data-exe="' + s.id + '">KILL</button>' +
            '</span></div>';
        }
        prisH += '</div>';
      }
    }

    ctx.screen('<div class="wl-aft">' +
      '<h1 class="wl-h">' + title + '</h1>' +
      '<p class="wl-sub">' + (r.band ? esc(r.band.name) : "THE FIELD") + '</p>' +

      /* ---- THE FOUR STAT TILES ARE TWO BARS NOW ----
         "YOUR DEAD 9 / THEIR DEAD 31 / STILL RIDING 35 / PRISONERS 14" was
         four cards of a big number under a small caption — 110 px to say four
         numbers, and it could not say the fifth (who broke and ran) or the
         sixth (who is wounded) without two more cards, which is exactly why
         those got their own titled sections further down the page. Two
         stacked bars carry all six, in 94 px, and they carry the PROPORTION
         as well, which is the thing you actually feel: a win where a third of
         your column is on the sand does not look like a win. */
      tollBar("YOU", [
        { n: r.yourDead.length, c: "var(--blood)", k: "DEAD" },
        { n: r.yourFled.length, c: "#6b6252", k: "RAN" },
        { n: held, c: "var(--hot)", k: "RIDING" },
      ]) +
      (wounded.length ? '<div class="wl-legend" style="margin-top:-3px"><span>' +
        wounded.length + ' WOUNDED &middot; 62%</span></div>' : '') +
      tollBar(r.band ? esc(r.band.name) : "THEM", [
        { n: r.theirDead.length, c: "var(--blood)", k: "DEAD" },
        { n: r.outcome === "won" ? r.theirSurvivors.length : 0, c: "var(--steel)", k: "TAKEN" },
        { n: r.outcome === "won" ? 0 : r.theirSurvivors.length, c: "#6b6252", k: "STANDING" },
      ]) +

      (r.yourDead.length
        ? '<div class="wl-lbl">THE DEAD</div>' + nameChips(r.yourDead, "dead") : '') +

      (r.promoted && r.promoted.length
        ? '<div class="wl-lbl">PROMOTED</div>' +
          nameChips(r.promoted, "gold", function (s) { return W.tier(s.tier).label; }) : '') +

      (chips.length
        ? '<div class="wl-lbl">TAKEN</div><div class="wl-chips">' + chips.join("") + '</div>' : '') +

      prisH +

      '<div class="wl-btns out">' +
        '<button class="wl-btn hot" id="aDone">RIDE ON</button>' +
      '</div></div>'
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
    const po = ctx.el("pOpen");
    if (po) po.onclick = function () { PRIS_OPEN = !PRIS_OPEN; paintAftermath(); };
    const ac = ctx.el("pAllCon"); if (ac) ac.onclick = function () { bulkConscript(); };
    const ar = ctx.el("pAllRel"); if (ar) ar.onclick = function () { bulk(doRelease); };
    const an = ctx.el("pAllRan"); if (an) an.onclick = function () { bulk(doRansom); };
    const ax = ctx.el("pAllExe"); if (ax) ax.onclick = function () { bulk(doExecute); };
    ctx.el("aDone").onclick = function () {
      /* PRISONERS YOU DID NOT DECIDE ON RIDE WITH YOU. They stay in
         W.state.prisoners and the HUD keeps counting them, so an outpost can
         sell them later — leaving the screen is not a decision that silently
         deletes men. */
      R = null;
      PRIS_OPEN = false;
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
      /* order 98: after campaign.js's world tick (30) and events.js's (96),
         so it reads the cooldowns everything else has already written this
         frame rather than a stale copy of them. */
      if (CBZ.onAlways) CBZ.onAlways(98, function (dt) { unstickContacts(dt); });

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

    // ---- the numbers other modules ask for
    hirePrice: hirePrice,
    canRob: canRob,
    dreadMul: dreadMul,
    conscriptOdds: conscriptOdds,
    conscriptPrice: conscriptPrice,
  });
})();
