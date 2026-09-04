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

   2026-09-01 — SHOW DON'T TELL. Four mechanics in this file were an array
   mutation and a string: executing prisoners, a band surrendering, a band
   joining you, and a prisoner refusing to turn. They happen on the sand now.
   See THE SAND IS THE SCREEN, which also names the reason none of them could
   have been shown before it: the meeting rail took the PHASE, and taking the
   phase switched the island off behind it.

   FLAGS (repo doctrine: every behaviour switch reverts in one param)
     ?conscript=old the willing/unwilling roll is a flat 0.6 again, tier-blind
     ?show=old      no tableaux: every act above is the mutation and the toast
                    again, and the meeting keeps the phase (see THE SAND)
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

  /* ============================================================ FEAR
     THE EXECUTE TRADE-OFF, AND IT NOW POINTS THE OTHER WAY.

     WHAT WAS HERE WAS DREAD: every prisoner you shot made future bands LESS
     likely to surrender — "a warlord who kills prisoners gets fought to the
     last man". It was built to an older brief and it is a coherent mechanic.
     It is also, on this island, a punishment with no upside anywhere, because
     executing men ALREADY costs you: core's fame term (the mercy you did not
     buy), and events.js's bondOf, where every execution poisons the whole
     roster and poisons the men you pressed worst. Three costs, no benefit, on
     a button the design wants people to press sometimes.

     So the term is inverted and the mechanic is FEAR. A warlord who shoots the
     men who will not march for him is a warlord parties fold to on sight, and
     the price he pays for that is his own army's opinion of him. That is a
     trade a player can weigh — surrenders against loyalty — where "everything
     gets worse" is not.

     It is still a WRAP rather than a fork (never fork; route the name), so
     campaign.js, warnet.js and army.js's own agar-scale absorption all read
     the corrected number through the same W.surrenderChance they always
     called. The curve is the old one with its sign turned over: five
     executions is 1.45x, fifteen is 2.35x, and core's own 0.93 ceiling still
     says there is always a chance they fight. */
  function fearMul() {
    const n = (W.state.stats && W.state.stats.executed) || 0;
    return 1 + n * 0.09;
  }
  let coreSurrender = null;
  function installFear() {
    if (coreSurrender) return;
    coreSurrender = W.surrenderChance;
    W.surrenderChance = function (band, myPower) {
      return clamp(coreSurrender(band, myPower) * fearMul(), 0, 0.93);
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
  /* THE MEN WHO WILL NOT MARCH ARE HATCHED, AND THAT IS THE PICTURE THE
     PRISONER SENTENCE IS ABOUT. It used to hatch `_refused` — a man who had
     said no to a specific offer of money, decided the moment you pressed a
     button. Nobody offers money any more (see THE PRISONERS): every captured
     man decides once, before you decide anything, so the hatched share of the
     bar is "how many of these will never ride with me" read straight off the
     roll, in each man's own tier colour. Diagonal, because a hatch reads as
     struck out and a tint reads as "far away". */
  const HATCH = "repeating-linear-gradient(-45deg,rgba(0,0,0,.62) 0 3px,transparent 3px 7px)";
  function tierStack(men) {
    const byTier = {};
    for (let i = 0; i < men.length; i++) {
      const k = men[i].tier + (!showOld && men[i]._willing === false ? "|no" : "");
      byTier[k] = (byTier[k] || 0) + 1;
    }
    /* Refusers sit immediately after their own tier, so the hatch is next to
       the block it is a share of rather than collected at one end. */
    const keys = Object.keys(byTier).sort(function (a, b) {
      const ta = a.split("|")[0], tb = b.split("|")[0];
      return (W.tierIndex(tb) - W.tierIndex(ta)) || (a.length - b.length);
    });
    const total = Math.max(1, men.length);
    let stack = "", legend = "", seen = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], t = k.split("|")[0], no = k.indexOf("|no") > 0;
      const n = byTier[k], pct = (n / total) * 100, c = tierColour(t);
      stack += '<i style="width:' + pct.toFixed(2) + '%;background:' + c +
        (no ? ';background-image:' + HATCH : '') + '">' + (pct > 11 ? n : "") + '</i>';
      if (!seen[t]) {
        seen[t] = 1;
        legend += '<span><em style="background:' + c + '"></em>' + esc(W.tier(t).label) + '</span>';
      }
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
    /* HELD WHILE THE RAIL IS UP. The world keeps turning behind the rail —
       that is the whole argument for the rail — and it turned on THIS band
       too: campaign.js's off-screen war could halve it or delete it off
       S.bands while its card still read "210 MEN", and its own AI could walk
       it away from you mid-decision. `held` is the one flag campaign.js reads
       for "leave this party alone" (events.js sets it on a cast party for the
       same reason); every verb below clears it before it does anything. */
    band.held = true;
    /* THE MEETING DOES NOT OWN THE SCREEN, SO IT MUST NOT OWN THE PHASE.
       This line used to be `W.setPhase("encounter", {band})`, and campaign.js
       sets the same phase one line before it calls in here. core fires
       phase:leave:campaign, campaign.js answers it with `live = false;
       showAll(false)`, and the island — you, your column, the band you are
       standing in front of, the terrain — is switched off. The whole argument
       for this rail is that the world keeps running behind it; it was running
       behind a blank sky.

       outpost.js hit this exact chain and fixed it exactly here (see its own
       "BARREN DESERT AND MAN WITH A CRATE POPUP WITH NO MAN THERE"). Hand the
       phase back, whatever it is. There is no frame between campaign.js's set
       and this unset — it is one call stack — so nothing flickers, and the
       redundant setPhase at campaign.js:3233 can now be deleted.

       feel.js keyed its "a card opened" cue and its encounter music bed off
       the phase; the cue is called explicitly here for the same reason
       outpost.js calls it ("the phase used to do this"), and the event below
       is the name feel.js can hang the bed on. */
    if (showOld) {
      W.setPhase("encounter", { band: band });      // ?show=old — the dark world
    } else if (W.phase() !== "campaign") {
      if ((W.phase() === "menu" || W.phase() === "boot") && W.campaign && W.campaign.enter) W.campaign.enter();
      else W.setPhase("campaign");
    }
    /* AND THE LENS TURNS TO THEM. The campaign camera keeps whatever yaw the
       player last dragged, so a party met from the flank or from behind put
       the rail up over an empty dune with the men off the edge of the frame —
       "there's a guy but he isn't on the map". Same two levers the tableaux
       use; a want, not a seizure. */
    if (!showOld) {
      const dd = Math.hypot(band.x - W.state.you.x, band.z - W.state.you.z);
      lensOn(band.x, band.z, clamp(dd * 0.9 + 5, 20, 40));
    }
    /* BIGGER EATS SMALLER, AND IT DOES NOT ASK. See THE SCALE RULE below —
       past the ratio at which core's own surrender roll has stopped being a
       roll, this meeting has no decision in it and the card is a formality. */
    if (!opts.noAuto && !showOld && scaleRule(band)) return;
    W.emit("encounter:open", { band: band });
    if (!showOld && W.feel && W.feel.ui) W.feel.ui("open", { volume: 0.8 });
    paintEncounter(opts);
  }

  /* ============================================================ THE SCALE RULE
     THE OWNER: "think about openfront.io mixed with agar.io".

     agar.io has exactly one rule and this is it: something enough smaller than
     you is absorbed on contact, and something enough bigger absorbs you. There
     is no menu in agar.io. Every meeting in this game used to open the same
     five-verb rail whether the party was two hundred men or two, which means a
     warlord with four hundred men riding down a three-man looter crew got a
     stat block, an odds bar and a DEMAND button reading 93%. That is not a
     decision, it is a formality with a UI on it.

     WHERE THE LINE IS, AND IT IS NOT TYPED. core's surrenderChance ramps
     (ratio - floor) * slope and CLAMPS at cap; above floor + cap/slope the
     ramp has stopped moving, so every ratio past it is the same number with a
     die in front of it. core publishes those three and W.surrenderSure()
     returns the ratio — 3.05x — which is exactly "the advantage at which
     asking has stopped being a question". One number, derived, and it moves if
     anybody ever retunes the curve.

     BOTH DIRECTIONS, and the asymmetry between them is the game:

       YOU ARE 3.05x THEM, and they want a fight   they put their guns down
                            where they stand. Absorbed: prisoners, aftermath,
                            the same screen a demanded surrender gives you.
                            HOSTILE ONLY - a salt caravan is not surrendering
                            to anybody, it is trying to sell you something, and
                            W.bandHostile is already the game's word for that.

       THEY ARE 3.05x YOU, and they caught you     your column comes apart.
                            You lose men, you keep the warlord, they ride on.
                            `mood === "hunt"` is the "if you let it catch you"
                            half: walk UP to a legion and you still get the
                            rail, because that was your idea.

     WHAT A SCATTER COSTS is core's own SHED_CAP - the most a column may lose
     in one night, the number the wage brake already sheds by - scaled by how
     badly you were beaten (1 - odds). At 3x that is a third of the roster; at
     ten times it is nearly the whole of the cap. They leave with their rifles.
     Levies first, veterans last, in the same order and for the same reason
     core's dawn sheds them: a veteran has somewhere to be and a levy has a
     farm. */
  function scaleRule(band) {
    /* NEVER A PERSON. A human's column is not absorbed on contact and does not
       scatter yours without him getting a say — the rule is about the island's
       AI, and a player who loses forty men to a function call is a player who
       stops playing. campaign.js hands peer bands to warnet.js before this,
       and this is the belt to that brace. */
    if (band.peer) return false;
    const sure = W.surrenderSure ? W.surrenderSure() : 3.05;
    const mine = W.yourPower(), theirs = W.bandPower(band);
    if (!(theirs > 0) || !(mine > 0)) return false;
    if (W.bandHostile(band) > 0 && mine >= theirs * sure) {
      unhold();
      surrenderTo(band, band.name + " put their guns in the sand at the sight of your column.");
      return true;
    }
    if (band.mood === "hunt" && theirs >= mine * sure) { scatter(band); return true; }
    return false;
  }

  function scatter(band) {
    unhold();
    const mine = W.yourPower(), theirs = W.bandPower(band);
    const frac = (W.SHED_CAP || 0.4) * (1 - W.odds(mine, theirs));
    const n = Math.min(W.state.army.length, Math.round(W.state.army.length * frac));
    /* levies first: core's dawn sheds in exactly this order, for exactly this
       reason, and two different orders would be two different games. */
    const order = W.state.army.slice().sort(function (a, b) {
      return W.tierIndex(a.tier) - W.tierIndex(b.tier);
    });
    for (let i = 0; i < n; i++) W.removeSoldier(order[i].id, false);
    W.state.you.hp = Math.max(1, Math.round(W.state.you.maxHp * 0.55));
    if (n) {
      W.log(band.name + " rode through your column. " + n +
        (n === 1 ? " man scattered into the dark." : " men scattered into the dark."), "bad");
      W.toast(n + " MEN SCATTER", "bad");
    } else {
      W.log("you got clear of " + band.name + " with what you had.", "bad");
      W.toast("YOU GOT CLEAR", "bad");
    }
    /* THEY TOOK WHAT THEY CAME FOR AND RIDE ON, through this file's own
       break-off so the party is visibly leaving rather than standing on you
       waiting to do it again. */
    band.cooldown = BREAK_OFF;
    band.mood = "roam";
    band._brokeOff = true;
    ridesAway(band);
    if (W.feel && W.feel.ui) W.feel.ui("bad");
    finish();
  }
  function unhold() { if (curBand) curBand.held = false; }
  /* the band can have been used up by the time a verb is pressed (a tableau
     ran, the player read the roster for a minute); say so instead of fielding
     a party that is no longer on the island */
  function gone() {
    const b = curBand;
    if (b && W.state.bands && W.state.bands.indexOf(b) >= 0 && b.men && b.men.length) return false;
    W.toast("THEY ARE GONE", "bad");
    finish();
    return true;
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
    if (gone()) return;
    unhold();
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
    if (gone()) return;
    unhold();
    const band = curBand;
    const p = W.surrenderChance(band, W.yourPower());
    band._askedDay = W.state.day;
    if (W.chance(p)) {
      surrenderTo(band, band.name + " laid down their guns without a shot.");
    } else {
      band.mood = "hunt";
      band.cooldown = 0;
      W.log(band.name + " told you to come and take them.", "bad");
      W.toast("THEY REFUSE", "bad");
      startBattle({ surprised: true, defending: true });
    }
  }

  /* ONE SURRENDER PATH, because there are two ways to get one now — you asked
     (DEMAND) or you were simply too big to fight (THE SCALE RULE) — and the
     consequences must not be able to drift apart. The mutation is HELD BACK
     UNTIL THE PICTURE IS OVER: `band.men.length = 0` is what campaign.js draws
     off, so doing it now is sixty men vanishing in one frame. They stay on the
     sand for three seconds, lay their arms down, and walk in; THEN they are
     prisoners. Under ?show=old apply() runs immediately and this is the shipped
     line-for-line behaviour. */
  function surrenderTo(band, line) {
    /* THE RATIO IS TAKEN BEFORE THE ROSTER IS EMPTIED, and it is the number the
       aftermath's willing/unwilling roll turns on: a man who was overrun three
       to one does not think he had a choice. The old call passed no ratio at
       all, so every surrendered band's prisoners were judged as if the fight
       had been even. */
    const ratio = W.yourPower() / Math.max(0.001, W.bandPower(band));
    const apply = function () {
      for (let i = 0; i < band.men.length; i++) W.state.prisoners.push(band.men[i]);
      W.earn(band.gold);
      band.gold = 0;
      band.men.length = 0;
      /* AND THE EMPTY BAND LEAVES THE MAP. bank() splices a wiped band out of
         W.state.bands after a battle; this path passes alreadyBanked and so
         never did, which left a nought-man party sitting on the island for the
         rest of the run with a banner over it. */
      if (W.state.bands) {
        const bi = W.state.bands.indexOf(band);
        if (bi >= 0) W.state.bands.splice(bi, 1);
      }
      W.state.fame += Math.round(2 + W.state.prisoners.length * 0.5);
      W.log(line, "good");
      W.toast("THEY SURRENDER", "good");
      W.state.stats.battles++;
      W.state.stats.won++;
      aftermath({
        band: band, outcome: "surrender", duration: 0, ratio: ratio,
        yourDead: [], yourSurvivors: W.state.army.slice(), yourFled: [],
        theirDead: [], theirSurvivors: W.state.prisoners.slice(),
        loot: {}, armourLoot: {}, gold: 0, youKills: 0, alreadyBanked: true,
      });
    };
    if (stageable()) showSurrender(band, apply);
    else { takeTheirArms(band); apply(); }
  }

  function hireBand(price) {
    if (gone()) return;
    unhold();
    const band = curBand;
    if (price == null || !W.pay(price)) { W.toast("NOT ENOUGH GOLD", "bad"); return; }
    /* MEN CHANGING SIDES, HELD BACK UNTIL THEY HAVE ACTUALLY CROSSED. The
       moment addSoldier runs they leave the band campaign.js is drawing and
       appear in the column it draws behind you — so applying it now is sixty
       men teleporting past you. showJoin walks the band onto you first, using
       campaign.js's own goal-walk, and this runs when they arrive. */
    const apply = function () {
      let n = 0;
      for (let i = 0; i < band.men.length; i++) { W.addSoldier(band.men[i]); n++; }
      band.men.length = 0;
      if (W.state.bands) {
        const bi = W.state.bands.indexOf(band);
        if (bi >= 0) W.state.bands.splice(bi, 1);
      }
      W.state.stats.recruited += n;
      W.log("paid $" + price + ". " + n + " men ride with you now.", "good");
      W.toast(n + " MEN JOIN YOU", "good");
      finish();
    };
    if (stageable()) showJoin(band, apply);
    else apply();
  }

  /* ROBBERY takes the GUNS, and that is the point: the gold is a number and
     the guns are the band's power. A robbed band keeps its men and loses the
     thing that made it dangerous, so the next time you meet it the encounter
     card says something different — which is what makes robbing a decision
     with a future instead of a free purse. */
  /* AND ROBBERY IS THE SAME PICTURE AS A SURRENDER, because mechanically it is
     the same act under a different threat: their arms end up on the sand and
     in your stash. It was not on the complaint list, but leaving it as a toast
     while DEMAND next to it puts real rifles on real ground would mean two
     spellings of one event in one rail — which is the drift this file's header
     warns about. The difference is what happens after: a robbed band KEEPS its
     men, so it rides off (ridesAway, this file's own break-off) instead of
     laying down and becoming prisoners. */
  function robBand() {
    if (gone()) return;
    unhold();
    const band = curBand;
    const apply = function () {
      const gold = band.gold | 0;
      W.earn(gold);
      band.gold = 0;
      band.mood = "hunt";
      band.cooldown = 0;
      band.wealth = Math.max(0.12, band.wealth * 0.5);
      W.state.fame = Math.max(0, W.state.fame - 1);
      W.log("robbed " + band.name + " at gunpoint — $" + gold + ".", "good");
      W.toast("TAKEN: $" + gold, "good");
      finish();
    };
    if (!stageable()) { takeTheirArms(band); apply(); return; }
    showStripped(band, { rob: true }, apply);
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
    if (gone()) return;
    unhold();
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
    // a tableau holds a band's cooldown open ON PURPOSE; see THE SAND
    if (tab) { stuckFor = 0; return; }
    if (ctx.verbsOpen && ctx.verbsOpen()) { stuckFor = 0; return; }
    const st = ctx.el && ctx.el("stage");
    if (st && st.classList.contains("on")) { stuckFor = 0; return; }
    const S = W.state;
    if (!S.bands || !S.bands.length) { stuckFor = 0; return; }
    let near = null, nd = 1e9;
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      if (!b.men || !b.men.length) continue;
      /* NOT A PARTY IN SOMEBODY ELSE'S MOMENT. Joiners walking in from 26 m
         and a party events.js has held on the road are inside CONTACT_R for
         longer than STUCK_S by design; clearing their cooldown here opened
         ATTACK / DEMAND / HIRE on your own men (events.js photographed it). */
      if (b.joining || b.held) continue;
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
    /* BOTH ENDS OF THE MEETING HAVE A NAME NOW. encounter() stopped claiming
       the "encounter" PHASE (see THE SAND IS THE SCREEN), and feel.js keys its
       music bed off exactly that phase — so the pair of events is what it
       needs to hang the bed on instead. Emitted whether or not anything is
       listening; core's bus costs one array read for a name with no rows. */
    if (curBand) { curBand.held = false; W.emit("encounter:close", { band: curBand }); }
    curBand = null;
    if (W.campaign && W.campaign.enter) W.campaign.enter();
    else W.setPhase("campaign");
  }

  /* ============================================================ THE SAND IS THE SCREEN
     SHOW DON'T TELL, FOR THE FOUR THINGS THIS FILE DOES THAT WERE NOT SHOWN.

     THE REPORT (owner): "SHOW DONT TELL for warlord ... death isn't shown ...
     completely violates show don't tell as does a ton of the app."

     deaths.js answered the first half: a man dying is a sequence on the sand
     now, in four beats, with blood and time. This is the rest of it, and the
     failure mode is identical every time — THE MOST DRAMATIC THING IN THE
     GAME WAS AN ARRAY MUTATION AND A STRING:

       executing prisoners   takePrisoner(id) in a loop and nothing else. The
                             whole dread mechanic hangs off this act — events.js's
                             loyMove says outright "they watched you do it" —
                             and there was no THEY and no DO. bulk() ran the
                             entire prisoner list through it in ONE FRAME.
       a band surrendering   `band.men.length = 0` + toast("THEY SURRENDER").
                             This file's own comment calls it "the single best
                             outcome in the game". Sixty men vanished.
       a band joining you    addSoldier() in a loop + toast("N MEN JOIN YOU").
       a prisoner refusing    a 2 600 ms toast about a fact that lasts forever,
                             and then no way to see it again.

     ------------------------------------------------- AND THE WORLD WAS OFF
     campaign.js's engage() calls W.setPhase("encounter"). core fires
     phase:leave:campaign. campaign.js:604 answers that with `live = false;
     showAll(false)` — its own root hidden, W.desert.hide(), the controls
     hidden. So the screen this game shows most often, the meeting rail, whose
     entire design argument is "the world keeps running behind it, you can
     watch the party coming over the dune", was a strip of text over an empty
     sky dome. THE BAND YOU WERE DECIDING WHETHER TO FIGHT WAS NOT ON SCREEN.

     outpost.js found exactly this bug from exactly this cause and fixed it in
     two lines (its own quote: "RN WE HAVE BARREN DESERT AND MAN WITH A CRATE
     POPUP WITH NO MAN THERE"). A PHASE IS A CLAIM THAT ONE MODULE OWNS THE
     SCREEN, and a docked rail does not own the screen — it owns a strip at the
     bottom of one that still belongs to the campaign. encounter() below hands
     the phase straight back, the same way, and every tableau here is only
     possible because of it.

     ------------------------------------------------------------ THE TABLEAU
     One engine, four scripts. A tableau is: hold the clock at 1x (core's own
     hold, so the speed pill says WHY it is disabled), take the screen down,
     make sure the island is up, point the lens, and run a list of beats on the
     always-chain's dt. It is not a cutscene — the world keeps running behind
     it exactly as it does behind the rail, because this game's one rule is
     that the clock never stops.

       EXECUTE      the prisoners stand in a rank on the sand in front of you,
                    and one volley puts all of them down. ONE volley for forty
                    men: bulk stays bulk, and the act costs the player 3.4 s
                    once rather than 3.4 s forty times.
       SURRENDER    their arms go on the sand in real stacks (props.js's own
                    armStack, built from their own gun id) and the party walks
                    in. feel.js's break shout — built, wired, and never once
                    fired in a real game — is what sixty men giving up sounds
                    like.
       HIRE         they ride over to you and fall in. Nothing is drawn for
                    this at all: campaign.js already draws that band and
                    already walks a band to a goal with a gait; it is given the
                    goal and it walks.
       TAKE ALL     the prisoners who took the money WALK ACROSS to your line
                    and the ones who refused stand where they are. That is
                    "men changing sides" and "he refuses" in the same picture,
                    which is what a toast can never be.

     WHY THIS FILE DRAWS THE RANK ITSELF, and it is the one duplication in
     here. campaign.js draws every man on the island, and I would rather have
     used it — the surrender and the hire above do exactly that. But its
     instances are composed as `compose(pos, Euler(0,yaw,0), scale)` inside a
     private draw loop: they are PLUMB, always, and there is no seam through
     which a man can be handed a fall. Prisoners are not on that loop at all
     (nothing draws a prisoner today), so nothing is drawn twice. The geometry
     is cut from CBZ.charProfile() and CBZ.HUMAN_SCALE — the same two sources
     campaign.js's impostor is cut from — so the two cannot drift in
     proportion, and the colours come from W.outfits.marks(), the same public
     painter, so a man executed on the sand wears what he wore standing.

     ------------------------------------------------------------ THE FLAG
       ?show=old   every tableau off. Executing, surrendering, hiring and
                   conscripting are the array mutation and the toast again,
                   byte for byte, and the meeting rail keeps the phase (which
                   is what switched the island off). That is the A/B.
  */

  let showOld = false;
  let THREE = null, scene = null;
  let tab = null;                    // the tableau running right now, or null

  function stageable() {
    return !showOld && !tab && !!(ctx && THREE && scene && W.campaign &&
      W.desert && W.desert.heightAt && W.sand && W.state && W.state.you);
  }
  /* THE LENS. The campaign camera orbits YOU, so "look at that" is a bearing
     plus a pull-back — the same two numbers campaign.js publishes for exactly
     this. It is a WANT, not a write: camDist lerps and the player can still
     drag the view. A tableau points the camera; it does not seize it. */
  function lensOn(x, z, dist) {
    const C = W.campaign, S = W.state;
    if (!C) return;
    if (C.camYaw) C.camYaw(Math.atan2(x - S.you.x, z - S.you.z));
    if (C.camDist) C.camDist(dist);
  }

  function begin(o) {
    tab = { id: o.id, t: 0, dur: o.dur, beats: o.beats || [], n: 0,
            step: o.step || null, done: o.done || null };
    /* 1x FOR THE DURATION. core.js's own hold, the one match.js used: it pins
       the scale, disables the slider and names the holder in the pill. A beat
       has no meaning at 64x — and the band walks below are driven by
       campaign.js's own sim, which would teleport them. */
    if (W.clock && W.clock.hold) W.clock.hold("SHOWING");
    if (ctx.closeScreen) ctx.closeScreen();
    if (ctx.closeVerbs) ctx.closeVerbs();
    if (W.phase() !== "campaign") {
      if (W.campaign.enter) W.campaign.enter(); else W.setPhase("campaign");
    }
    stepTab(0);                      // beat 0 is NOW, not one frame from now
  }

  /* THE DRIVE SEAM, and nothing in the game calls it. A tableau takes its time
     from the always-chain, which a capture cannot pin: the page's own rAF is
     still turning while a tool waits between polls, so "photograph the frame
     0.30 s after the volley" is otherwise "photograph whatever the load
     average left". freeze() cuts the chain and advance() becomes the only
     clock. Same shape as battle.js's execute()/shotAudit() seam, and for the
     same reason — a beat has to be CHOSEN, not sampled. */
  let frozen = false, driving = false;
  function tick(dt) { if (frozen && !driving) return; stepTab(dt); }

  function stepTab(dt) {
    if (!tab) return;
    tab.t += dt;
    while (tab.n < tab.beats.length && tab.t >= tab.beats[tab.n].at) {
      const b = tab.beats[tab.n++];
      try { b.on(); } catch (e) { console.warn("[warlord/army] beat " + tab.id, e); }
    }
    if (tab.step) { try { tab.step(tab.t, dt); } catch (e) { console.warn("[warlord/army] " + tab.id, e); } }
    if (tab.t < tab.dur) return;
    const d = tab.done;
    tab = null;
    dropRank();
    dropArms();
    if (W.clock && W.clock.release) W.clock.release("SHOWING");
    try { if (d) d(); } catch (e) { console.warn("[warlord/army] done", e); }
  }

  /* ============================================================ THE RANK
     This file's own men, for the one job campaign.js's cannot do: fall over.

     THE FALL IS deaths.js'S, to the constant, and that is deliberate — a man
     folding on the sand in front of your line and a man folding in a battle
     are the same event and must not be two different lengths of time:
       FLAT    PI/2 - 0.07, battle.js's topple ceiling. The rig pivots at its
               FEET; past vertical the torso swings down and behind and sinks
               under the sand (systems/grapple.js:411's own warning).
       FOLD_K  7 per second, grapple.js's damping rate for a DEAD body.
       ROLL    0.6 rad of shoulder roll, grapple.js's own amplitude. A man
               shot dead astern has no sideways component to his fall and is
               exactly the man who otherwise reads as a plank.
       DIP     the hips drop by thigh*(1-cos 40deg) as the knees give, off
               city/ragdoll.js's own mass-point table (hip 0.95, knee 0.475).
     RANK_CAP is campaign.js's FORM_CAP: past sixty bodies a cluster stops
     reading as a count, and the count is on the screen you just left. */
  const RANK_CAP = 60;
  const FLAT = Math.PI / 2 - 0.07;
  const FOLD_K = 7;
  const ROLL = 0.6;
  const DIP = (0.95 - 0.475) * (1 - Math.cos(40 * Math.PI / 180));
  /* The shipped adult male, kept byte for byte from campaign.js's own fallback
     so a page without the people pack fields the same man-shaped speck here as
     it does out on the island. CBZ.charProfile() wins whenever it exists. */
  const PROFILE = {
    legUp: 0.48, legLo: 0.47, legW: 0.34, hipX: 0.23, shoeH: 0.20,
    armUp: 0.46, armLo: 0.46, armW: 0.30, armX: 0.62,
    pelvisW: 0.84, pelvisH: 0.20, pelvisD: 0.48,
    torsoW: 0.92, torsoH: 0.95, torsoD: 0.50,
    collarW: 0.94, collarH: 0.18, collarD: 0.52, headSize: 0.60,
  };
  let rank = null;

  /* ONE BUFFER PER MESH, tinted per box. Same trick and same reason as
     campaign.js's impostor: a nine-box man drawn as nine InstancedMeshes is
     nine draw calls for one silhouette, and the tints (dark boots, shadowed
     sleeves) are what put a waist back into a merged shape. */
  function mergeBoxes(parts, scale) {
    let total = 0;
    const built = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const g = new THREE.BoxGeometry(p.w, p.h, p.d).toNonIndexed();
      g.translate(p.x || 0, p.y, p.z || 0);
      total += g.attributes.position.count;
      built.push({ g: g, t: p.tint == null ? 1 : p.tint });
    }
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3),
          col = new Float32Array(total * 3);
    let o = 0;
    for (let i = 0; i < built.length; i++) {
      const g = built[i].g, t = built[i].t, c = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      for (let k = 0; k < c; k++) { col[(o + k) * 3] = t; col[(o + k) * 3 + 1] = t; col[(o + k) * 3 + 2] = t; }
      o += c;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (scale !== 1) out.scale(scale, scale, scale);
    out.computeBoundingSphere();
    return out;
  }

  function buildRank() {
    if (rank) return rank;
    let P = null;
    try { P = CBZ.charProfile ? CBZ.charProfile() : null; } catch (e) { P = null; }
    if (!P || !P.torsoH) P = PROFILE;
    const HS = (CBZ.HUMAN_SCALE > 0) ? CBZ.HUMAN_SCALE : 0.70;
    const hipY = P.legUp + P.legLo;
    const neckY = hipY - 0.005 + P.torsoH - 0.015;
    const shoulderY = neckY - 0.04;
    const armL = P.armUp + P.armLo;
    const legH = hipY - P.shoeH;
    const bodyG = mergeBoxes([
      { w: P.legW * 1.02, h: P.shoeH, d: P.legW * 1.45, x: -P.hipX, y: P.shoeH / 2, z: 0.05, tint: 0.34 },
      { w: P.legW * 1.02, h: P.shoeH, d: P.legW * 1.45, x: P.hipX, y: P.shoeH / 2, z: 0.05, tint: 0.34 },
      { w: P.legW, h: legH, d: P.legW, x: -P.hipX, y: P.shoeH + legH / 2, tint: 0.66 },
      { w: P.legW, h: legH, d: P.legW, x: P.hipX, y: P.shoeH + legH / 2, tint: 0.66 },
      { w: P.pelvisW, h: P.pelvisH, d: P.pelvisD, y: hipY + 0.03, tint: 0.78 },
      { w: P.torsoW, h: P.torsoH, d: P.torsoD, y: hipY - 0.005 + P.torsoH / 2, tint: 1 },
      { w: P.collarW, h: P.collarH, d: P.collarD, y: shoulderY, tint: 1 },
      { w: P.armW, h: armL, d: P.armW, x: -P.armX, y: shoulderY - armL / 2, tint: 0.88 },
      { w: P.armW, h: armL, d: P.armW, x: P.armX, y: shoulderY - armL / 2, tint: 0.88 },
    ], HS);
    const headG = mergeBoxes([
      { w: P.headSize, h: P.headSize, d: P.headSize, y: neckY + P.headSize * 0.5, tint: 1 },
    ], HS);
    /* r128 NEEDS BOTH HALVES OF THE COLOUR PATH and the buffer has to be
       allocated by hand — campaign.js paid for both of these in a screenshot
       of an army rendered in solid black. vertexColors:true makes USE_COLOR
       real (the geometry carries its own white/tint attribute), instanceColor
       multiplies over it, and setColorAt sizes a NEW instanceColor off
       `count`, which is zero here on frame one. */
    const mk = function (g) {
      const m = new THREE.InstancedMesh(g,
        new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), RANK_CAP);
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RANK_CAP * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.renderOrder = 2;
      scene.add(m);
      return m;
    };
    rank = { body: mk(bodyG), head: mk(headG), men: [],
             d: new THREE.Object3D(), col: new THREE.Color(),
             qy: new THREE.Quaternion(), qx: new THREE.Quaternion(), qz: new THREE.Quaternion(),
             AX: new THREE.Vector3(1, 0, 0), AY: new THREE.Vector3(0, 1, 0), AZ: new THREE.Vector3(0, 0, 1) };
    return rank;
  }

  function groundY(x, z) {
    if (W.sand && W.sand.groundY) { const y = W.sand.groundY(x, z); if (isFinite(y)) return y; }
    return W.desert.heightAt(x, z);
  }

  /* STAND THEM UP. A RANK, not campaign.js's golden-angle disc: men lined up
     to be shot, or to be bought, stand in ranks, and the shape is the point of
     the picture. Rows recede AWAY from the player so the front rank is nearest
     the lens; everybody faces him, because that is who they are talking to. */
  function setRank(men, cx, cz, band) {
    const R2 = buildRank();
    const S = W.state;
    const n = Math.min(men.length, RANK_CAP);
    const per = Math.max(4, Math.min(13, Math.ceil(Math.sqrt(n * 2.2))));
    const ax = cx - S.you.x, az = cz - S.you.z;
    const al = Math.hypot(ax, az) || 1;
    const fx = ax / al, fz = az / al;             // you -> them, i.e. "back"
    const rx = fz, rz = -fx;                      // across the rank
    R2.men.length = 0;
    for (let i = 0; i < n; i++) {
      const s = men[i];
      const col = (i % per), row = (i / per) | 0;
      const jit = W.hash01(i * 13 + 3, 5, 29) - 0.5;
      const lat = (col - (per - 1) / 2) * 1.42 + jit * 0.28;
      const lon = row * 1.55 + (W.hash01(i * 7 + 11, 2, 31) - 0.5) * 0.3;
      const x = cx + rx * lat + fx * lon, z = cz + rz * lat + fz * lon;
      let mk = null;
      try { mk = W.outfits && W.outfits.marks ? W.outfits.marks(s, band || null) : null; } catch (e) { mk = null; }
      R2.men.push({
        s: s, x: x, z: z, y: groundY(x, z), yaw: Math.atan2(-fx, -fz),
        ph: W.hash01(i * 17 + 5, 9, 23) * 6.28, dy: 0,
        body: mk ? mk.body : tierColour(s.tier),
        head: mk ? mk.head : 0x9a7d5c,
        fall: null, walk: null, gone: false,
      });
    }
    return R2.men.length;
  }

  function dropRank() {
    if (!rank) return;
    rank.men.length = 0;
    rank.body.count = rank.head.count = 0;
  }

  /* THE FRAME. Every man is one compose() — position, (yaw then the fold, in
     HIS frame), scale. The fold is post-multiplied for the same reason
     deaths.js post-multiplies it: a fall written in world axes is a fall that
     ignores which way the man was facing. */
  function drawRank(t, dt) {
    if (!rank || !rank.men.length) return;
    const men = rank.men, d = rank.d;
    let n = 0;
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.gone) continue;
      stepMan(m, t, dt);
      d.position.set(m.x, m.y + m.dy, m.z);
      rank.qy.setFromAxisAngle(rank.AY, m.yaw);
      d.quaternion.copy(rank.qy);
      if (m.fall) {
        rank.qx.setFromAxisAngle(rank.AX, m.fall.rx);
        rank.qz.setFromAxisAngle(rank.AZ, m.fall.rz);
        d.quaternion.multiply(rank.qx).multiply(rank.qz);
      }
      d.scale.setScalar(1);
      d.updateMatrix();
      rank.body.setMatrixAt(n, d.matrix);
      rank.head.setMatrixAt(n, d.matrix);
      rank.col.setHex(m.body); rank.body.setColorAt(n, rank.col);
      rank.col.setHex(m.head); rank.head.setColorAt(n, rank.col);
      n++;
    }
    rank.body.count = rank.head.count = n;
    rank.body.instanceMatrix.needsUpdate = rank.head.instanceMatrix.needsUpdate = true;
    if (rank.body.instanceColor) rank.body.instanceColor.needsUpdate = true;
    if (rank.head.instanceColor) rank.head.instanceColor.needsUpdate = true;
  }

  function stepMan(m, t, dt) {
    if (m.fall) {
      const f = m.fall;
      f.t += dt;
      if (f.t < f.struck) {
        /* STRUCK. He is hit and still on his feet, and he takes the round
           backwards — city/ragdoll.js prices its own lurch at energy/6 m/s and
           this is that step, easing out. Without this beat a man is not shot,
           he is switched off, which is the whole of deaths.js's report. */
        const k = 1 - f.t / f.struck;
        m.x += f.dx * 1.1 * k * dt; m.z += f.dz * 1.1 * k * dt;
        m.y = groundY(m.x, m.z);
        m.dy = 0;
        return;
      }
      const a = 1 - Math.exp(-FOLD_K * dt);
      f.rx += (f.tx - f.rx) * a;
      f.rz += (f.tz - f.rz) * a;
      const prog = clamp(Math.abs(f.rx) / FLAT, 0, 1);
      m.dy = -DIP * Math.sin(prog * Math.PI);
      return;
    }
    if (m.walk) {
      const w = m.walk;
      w.t += dt;
      const k = clamp((w.t - w.delay) / w.dur, 0, 1);
      const e = k * k * (3 - 2 * k);
      m.x = w.x0 + (w.x1 - w.x0) * e;
      m.z = w.z0 + (w.z1 - w.z0) * e;
      m.y = groundY(m.x, m.z);
      if (k > 0 && k < 1) {
        m.yaw = Math.atan2(w.x1 - w.x0, w.z1 - w.z0);
        m.dy = Math.abs(Math.sin(w.t * 8 + m.ph)) * 0.045;
        if (W.sand && W.sand.puff && ((w.t * 8 + m.ph) % 6.28) < dt * 8)
          W.sand.puff(m.x, m.y, m.z, { amt: 0.22 });
      } else if (k >= 1) { m.dy = 0; if (w.hide) m.gone = true; }
      return;
    }
    // standing: he breathes, because forty statues is not forty men
    m.dy = Math.sin(t * 1.5 + m.ph) * 0.022;
  }

  /* ============================================================ THE VOLLEY
     ONE volley for any number of men, and that is the whole answer to "bulk
     actions must stay bulk". Forty prisoners is not forty executions; it is a
     firing party and a line, and it costs the player the same 3.4 seconds
     whether the line is four men or forty.

     THE LENS IS FOR WHAT IS DONE TO YOU — the law this repo has paid for
     twice (deaths.js's header, and the shark that shook the camera once per
     mouthful). So gore.js's own lens tail is OFF for every man (opts.lens is
     the parameter it ships for exactly this) and there is ONE shake, for the
     volley, not one per corpse. */
  function fireVolley() {
    if (!rank || !rank.men.length) return;
    const men = rank.men, S = W.state;
    const wid = modalGun(S.army) || "ak47";
    /* THE GUNS ARE YOUR OWN LINE'S, and the sound is feel.js's mixer rather
       than CBZ.sfx direct, because a volley is the exact case its near-budget
       exists to arbitrate. Ten rounds, 22 ms apart: a volley is ragged. */
    const shots = Math.min(10, Math.max(3, men.length));
    for (let i = 0; i < shots; i++) {
      const o = { dist: 7 + i * 0.5, delay: i * 0.022, volume: 0.92 };
      if (W.feel && W.feel.shot) W.feel.shot({ name: "shoot_" + wid, dist: o.dist, mine: true, opts: o });
      else if (CBZ.sfx) { try { CBZ.sfx("shoot_" + wid, o); } catch (e) {} }
    }
    if (W.feel && W.feel.ui) W.feel.ui("execute");
    if (CBZ.shake) CBZ.shake(0.40);
    W.emit("battle:volley", { n: men.length, why: "execution" });

    /* NEAREST FIRST FOR THE BLOOD, spent against gore.js's own 70 m gate —
       the same rank deaths.js uses, for the same reason: the budget must be
       spent on what is in the shot, never in array order. */
    const cam = CBZ.camera;
    const ord = [];
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      const dx = cam ? m.x - cam.position.x : 0, dz = cam ? m.z - cam.position.z : 0;
      ord.push({ i: i, d2: dx * dx + dz * dz });
    }
    ord.sort(function (a, b) { return a.d2 - b.d2; });
    let bled = 0;
    for (let k = 0; k < ord.length; k++) {
      const m = men[ord[k].i];
      /* AWAY FROM THE FIRING PARTY. The line is behind the lens and he is
         facing it, so the round travels from you to him and he goes down
         backwards — which is the single sign relationship deaths.js's whole
         fix is about (the old battle code rolled a coin). */
      const dx = Math.sin(m.yaw + Math.PI), dz = Math.cos(m.yaw + Math.PI);
      m.fall = {
        t: 0,
        struck: 0.09 + W.hash01(ord[k].i * 3 + 1, 4, 37) * 0.13,
        rx: 0, rz: 0, tx: -FLAT,
        tz: (W.hash01(ord[k].i * 5 + 2, 6, 41) - 0.5) * 2 * ROLL,
        dx: dx, dz: dz,
      };
      if (W.sand && W.sand.puff) W.sand.puff(m.x, m.y, m.z, { amt: 0.7, gx: dx, gz: dz });
      if (bled < 6 && CBZ.gore && ord[k].d2 < 70 * 70) {
        bled++;
        goreN++;
        try {
          CBZ.gore(m.x, m.y + 1.15, m.z, {
            medium: "air", dir: { x: dx, z: dz }, amount: 1,
            cloth: m.body, lens: false,
          });
        } catch (e) { /* the blood pack is optional; the fall is not */ }
      }
    }
  }

  /* WHAT YOUR OWN LINE IS CARRYING. Not a typed gun id: the firing party is
     your men, and audio.js's bank is keyed "shoot_" + the weapon id, which is
     weapon-data's own naming. */
  function modalGun(men) {
    const by = Object.create(null);
    let best = null, bn = 0;
    for (let i = 0; i < men.length; i++) {
      const w = men[i].wid;
      if (!w) continue;
      by[w] = (by[w] || 0) + 1;
      if (by[w] > bn) { bn = by[w]; best = w; }
    }
    return best;
  }

  /* ============================================================ THE ARMS
     A SURRENDER IS GUNS ON THE SAND. props.js already builds a stack of three
     rifles standing against each other, out of the real weapon model for the
     real id — P.armStack, which nothing in the game had ever called with a
     reason. One stack per nine men, capped at five, because the picture is
     "they are stacked", not an inventory.

     POOLED, NEVER DISPOSED. Every geometry and material inside a props.js
     group comes out of that file's own caches and is shared with the outposts;
     disposing one would take a well or a depot with it. So a stack is built
     once per gun id and handed back to a pool on teardown. */
  const armsPool = Object.create(null);
  let armsOut = [];
  function layDownArms(band) {
    if (!W.props || !W.props.armStack || !W.sand || !W.sand.plant) return 0;
    const S = W.state;
    const id = modalGun(band.men) || "ak47";
    const n = clamp(Math.round(band.men.length / 9), 1, 5);
    const ax = S.you.x - band.x, az = S.you.z - band.z;
    const al = Math.hypot(ax, az) || 1;
    const ux = ax / al, uz = az / al;                 // them -> you
    const px = uz, pz = -ux;                          // across
    let made = 0;
    for (let i = 0; i < n; i++) {
      const pool = armsPool[id] || (armsPool[id] = []);
      let g = pool.pop();
      if (!g) { try { g = W.props.armStack({ id: id, seed: 11 + i }); } catch (e) { g = null; } }
      if (!g) break;
      g.userData.armsId = id;
      const lat = (i - (n - 1) / 2) * 2.6;
      const fwd = 3.0 + (i % 2) * 0.8;
      const x = band.x + ux * fwd + px * lat, z = band.z + uz * fwd + pz * lat;
      W.sand.plant(g, x, z, Math.atan2(ux, uz) + i * 0.6);
      scene.add(g);
      armsOut.push(g);
      if (W.sand.puff) W.sand.puff(x, groundY(x, z), z, { amt: 0.55 });
      made++;
    }
    return made;
  }
  function dropArms() {
    for (let i = 0; i < armsOut.length; i++) {
      const g = armsOut[i];
      if (g.parent) g.parent.remove(g);
      const id = g.userData.armsId || "ak47";
      (armsPool[id] || (armsPool[id] = [])).push(g);
    }
    armsOut.length = 0;
  }

  /* THE BLOOD PACK, asked for by NAME through the loader the page already
     uses — deaths.js's own seam (systems/gore.js lives in the studio pack
     "blood", which games/warlord.html's need() list does not ask for). Asked
     when a prisoner decision goes up rather than at boot, for the page's own
     stated reason: a campaign that never takes a prisoner should not pay for
     the file. It resolves long before anybody presses EXECUTE. */
  let bloodAsked = false, goreN = 0;
  function askBlood() {
    if (bloodAsked || showOld || CBZ.gore) return;
    bloodAsked = true;
    if (!(CBZ.studio && CBZ.studio.need)) return;
    CBZ.studio.need("blood").then(function () {},
      function (e) { console.warn("[warlord/army] blood pack:", e && e.message); });
  }

  /* ============================================================ THE SCRIPTS */

  /* EXECUTION. The rank goes up in front of you, a beat passes — long enough
     that they are men standing on sand and not a number — and then one volley.
     `apply` is called at the volley, not at the end: the record dies when the
     round arrives, exactly as deaths.js's fell() does, or the sim disagrees
     with itself for three seconds. */
  function showExecution(men, apply, done) {
    const S = W.state;
    const yaw = (W.campaign && W.campaign.camYaw) ? W.campaign.camYaw() : S.you.yaw;
    /* HOW FAR IN FRONT, AND HOW FAR BACK, BOTH MEASURED OFF THE ONE THING
       THIS CAMERA CANNOT DO: it orbits YOU and it will not come closer than
       campaign.js's own 16 m floor. So the distance from the eye to the rank
       is (camDist + back), and the first cut of this put the rank 13 m out
       with the camera 28 back — 41 m, at which a 1.8 m man is 33 px on a
       700 px frame and the most morally weighted act in the game photographed
       as a smudge. Nine metres and the floor is 25, which is the closest this
       lens can legally get to anything, and it is where a man reads as a man. */
    const back = 9 + Math.min(3, men.length * 0.04);
    const cx = S.you.x + Math.sin(yaw) * back, cz = S.you.z + Math.cos(yaw) * back;
    setRank(men, cx, cz, R && R.band);
    lensOn(cx, cz, clamp(16 + men.length * 0.06, 16, 22));
    begin({
      id: "execute", dur: 3.4,
      beats: [
        { at: 1.05, on: function () { fireVolley(); apply(); } },
      ],
      step: drawRank,
      done: done,
    });
  }

  /* SURRENDER. Their arms go on the sand and the party walks in — campaign.js
     draws that band and campaign.js walks a band to a goal, with the gait and
     the formation stretching into a file, so nothing here draws a man. The
     shout is feel.js's breakSound, built for battle:break and never once
     fired by a real game: it is what a line deciding not to die sounds like. */
  function showSurrender(band, apply) { showStripped(band, {}, apply); }
  function showStripped(band, o, apply) {
    const S = W.state;
    band.cooldown = Math.max(band.cooldown, 8);   // engage() stays shut over it
    band.mood = "roam";
    /* AS CLOSE AS THE ORBIT ALLOWS. It was hypot + 15, which put the eye
       BEHIND the player by more than the party was in front of him — 63 m to
       the subject on a meeting that happens at 24. Half the gap, floored at
       campaign.js's own 16 m minimum: the player sits in the bottom of the
       frame and the party he is talking to fills the middle of it. */
    lensOn(band.x, band.z, clamp(Math.hypot(band.x - S.you.x, band.z - S.you.z) * 0.55, 16, 34));
    begin({
      id: o.rob ? "rob" : "surrender", dur: 3.0,
      beats: [
        { at: 0.0, on: function () {
            if (o.rob) { if (W.feel && W.feel.ui) W.feel.ui("demand"); }
            else W.emit("battle:break", { side: "them" });
          } },
        { at: 0.30, on: function () {
            takeTheirArms(band);
            layDownArms(band);
            /* A SURRENDERED PARTY COMES IN; A ROBBED ONE GETS OUT. Both are
               one written goal — campaign.js walks them, with the gait and the
               formation stretching into a file, and this file draws nothing. */
            if (o.rob) ridesAway(band);
            else band.goal = { x: S.you.x + (band.x - S.you.x) * 0.42,
                               z: S.you.z + (band.z - S.you.z) * 0.42, why: "" };
          } },
      ],
      done: apply,
    });
  }

  /* AND THE PICTURE IS THE MECHANIC, NOT A DECORATION. A stack of rifles on
     the sand in front of a party that keeps its rifles would be a tell that
     contradicts a show. So the guns and the armour go into YOUR stash, which
     is the same two lines robBand() already runs — one rule in this file for
     "a band gives up its arms", not two. It is a real change: DEMAND used to
     hand you the men with their kit still on them, and now the kit routes
     through your armoury and the prisoners are unarmed, which is what
     surrendering means and what makes DEMAND materially different from HIRE. */
  function takeTheirArms(band) {
    let guns = 0;
    for (let i = 0; i < band.men.length; i++) {
      const s = band.men[i];
      if (s.wid && s.wid !== "sidearm") { W.stash(s.wid, 1); guns++; s.wid = "sidearm"; }
      if (s.armour && s.armour !== "none") { W.stashArmour(s.armour, 1); s.armour = "none"; }
    }
    return guns;
  }

  /* HIRE. They ride over and fall in. The ONLY thing this writes is a goal —
     campaign.js's stepBands does the walk at its own speed, over its own
     terrain probe, and publishes b.spd so the men's gaits are real. The
     tableau ends when they ARRIVE (measured off the distance, not off a typed
     duration) or at the cap, whichever is first. */
  function showJoin(band, apply) {
    const S = W.state;
    band.cooldown = Math.max(band.cooldown, 8);
    band.mood = "roam";
    band.goal = { x: S.you.x, z: S.you.z, why: "" };
    lensOn(band.x, band.z, clamp(Math.hypot(band.x - S.you.x, band.z - S.you.z) * 0.55, 16, 34));
    begin({
      id: "join", dur: 4.4,
      beats: [{ at: 0.0, on: function () { if (W.feel && W.feel.ui) W.feel.ui("hire"); } }],
      step: function (t) {
        if (!tab) return;
        const d = Math.hypot(band.x - S.you.x, band.z - S.you.z);
        if (t > 0.6 && d < 9) tab.dur = Math.min(tab.dur, t + 0.45);
      },
      done: apply,
    });
  }

  /* TAKE ALL. The men who took the money walk across to your line; the men who
     refused stand exactly where they were. That is both halves of the
     mechanic in ONE picture — and the refusal, which used to be a 2 600 ms
     toast about a permanent fact, is now a man still standing on the other
     side when the walk is over, and a hatched block on the prisoner bar for
     the rest of the game. */
  function showTurn(takers, refusers, apply, done) {
    const S = W.state;
    const yaw = (W.campaign && W.campaign.camYaw) ? W.campaign.camYaw() : S.you.yaw;
    const all = takers.concat(refusers);
    const back = 10;      // see showExecution: the eye cannot come closer than 16
    const cx = S.you.x + Math.sin(yaw) * back, cz = S.you.z + Math.cos(yaw) * back;
    setRank(all, cx, cz, R && R.band);
    lensOn(cx, cz, clamp(16 + all.length * 0.06, 16, 22));
    const take = {};
    for (let i = 0; i < takers.length; i++) take[takers[i].id] = 1;
    begin({
      id: "turn", dur: 3.2,
      beats: [
        { at: 0.75, on: function () {
            if (W.feel && W.feel.ui) W.feel.ui("hire");
            const men = rank.men;
            let k = 0;
            for (let i = 0; i < men.length; i++) {
              const m = men[i];
              if (!take[m.s.id]) continue;
              /* WHERE YOUR LINE IS: behind you, which is where campaign.js
                 draws your column (it rides the breadcrumb trail). So they
                 walk past you and fall in, and the hand-over to the column at
                 the end of the walk is a metre, not a teleport. */
              const lat = ((k % 6) - 2.5) * 1.3;
              const lon = -4.5 - ((k / 6) | 0) * 1.6;
              m.walk = {
                t: 0, delay: (k % 6) * 0.06, dur: 1.7,
                x0: m.x, z0: m.z, hide: false,
                x1: S.you.x + Math.sin(yaw) * lon + Math.cos(yaw) * lat,
                z1: S.you.z + Math.cos(yaw) * lon - Math.sin(yaw) * lat,
              };
              k++;
            }
          } },
      ],
      step: drawRank,
      done: function () { apply(); if (done) done(); },
    });
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

  /* ============================================================ THE PRISONERS
     THEY DECIDE, THEN YOU DECIDE.

     THE OWNER, verbatim: "the whole conscript and rejecting conscription
     buttons are so dumb its conscript or execute I decide or they decide idk".

     He is describing a screen that could not say who was choosing, and he is
     right. What was here: four bulk verbs (TAKE ALL / RANSOM / RELEASE /
     EXECUTE), a disclosure triangle with four MORE buttons per man, a price on
     every one of them - and a per-man roll that could refuse you AFTER you had
     paid. So TAKE ALL was a purchase with a random outcome, "he refuses" was a
     thing that happened to your money rather than a thing a man decided, and
     fourteen prisoners was fifty-six controls on one screen.

     THE SHAPE NOW IS ONE SENTENCE AND THREE VERBS.

     FIRST THEY DECIDE. Every captured man rolls WILLING or UNWILLING ONCE, the
     moment the screen goes up, and the card says the result in one line: "31
     TAKEN - 19 WILL MARCH FOR YOU - 12 WILL NOT". That is a fact by the time
     you read it, which is the entire difference from the old screen: you are
     choosing what to do about an answer instead of gambling on getting one.

     THEN YOU DECIDE, and there are exactly three things a warlord does about
     twelve men who have just told him no:

       TAKE THE WILLING     the men who said yes ride with you and the rest
                            walk. Costs nothing, buys fame (core's own
                            reputation term - letting men go is what makes
                            bands fold to you later), and gives you the
                            smallest army.
       PRESS EVERY MAN      all of them march. The unwilling carry events.js's
                            pressed provenance, which is a per-dawn desertion
                            chance and a permanent drag on the loyalty CEILING
                            the whole column drifts toward. You get the men
                            tonight and pay for them every night after.
       SHOOT THE UNWILLING  the willing ride, the rest are shot, on the sand,
                            in one volley. Fear: every execution multiplies
                            what future bands will fold to (see FEAR at the top
                            of this file) and poisons your own army's opinion
                            of you through events.js's bondOf.

     NO PRICE ON ANY OF THEM. Gold was the old screen's answer to "why not just
     take everybody", and it was the wrong answer twice: it made the decision
     about your purse rather than about what kind of warlord you are, and it
     made the button fail at random. The costs are loyalty, desertion and fear
     - three things this game already models, none of them money.

     RANSOM AND RELEASE ARE DELETED. Ransom was a gold trickle weighed against
     nothing. Release was the same act as TAKE THE WILLING's "and the rest
     walk", carrying the fame chip that verb now carries. */

  /* WILLING OR NOT, off numbers that already exist and already mean this:

       the CENTRE    events.js's BASE_JOINED — 0.58, "a man who walked up and
                     asked is in between" — which is the same question this
                     roll asks and is therefore where it starts. THE FIRST
                     DRAFT STARTED AT 0.92 and it was wrong for a reason worth
                     recording: 0.92 was the old PAID conscription's success
                     rate, which is "will he take your money", not "would he
                     rather march than walk". The ba sheet caught it in one
                     frame — "27 WILL MARCH FOR YOU · 0 WILL NOT", a decision
                     screen with no decision on it.
       his TIER      a veteran of somebody else's army is a hard sell, and
                     core's tier index is the game's own word for it.
       his BATTLES   but only the fights beyond the promotion he has already
                     been given: core promotes at PROMOTE_AT*(tier+1), so
                     "seasoned" is what he survived past that. Without the
                     subtraction, tier and battles are the same argument
                     counted twice and a veteran becomes unrecruitable.
       the RATIO     the power ratio the battle was actually fought at, handed
                     over by battle.js. A man who was overrun does not believe
                     he had a choice.
       your FAME     core's reputation number, the same one that does work for
                     you in surrenderChance.
       your FEAR     men fold to a warlord who shoots men. The same term the
                     surrender roll reads, not a second copy of it.

     ?conscript=old is the old flat, tier-blind 0.6 for the A/B. */
  function willChance(s, ratio) {
    if (Q && Q.get("conscript") === "old") return 0.6;
    const base = (W.events && W.events.BASE && W.events.BASE.joined) || 0.58;
    const ti = W.tierIndex(s.tier);
    const owed = (W.PROMOTE_AT || 3) * (ti + 1);
    const seasoned = clamp(((s.battles || 0) - owed) / owed, 0, 1);
    /* THE TIER AND THE SEASONING SPAN THE BASE. A levy at parity is the base
       and a veteran of somebody else's wars is near nothing, so the two terms
       together are worth the whole of it rather than a scalar I liked: three
       tier steps and a full seasoning share it. */
    const p = base * (1 - ti * 0.25 - seasoned * 0.25) +
      (clamp(ratio, 0.5, 4) - 1) * 0.09 + clamp(W.state.fame / 1500, 0, 0.1);
    return clamp(p * fearMul(), 0.04, 0.97);
  }

  /* ROLLED ONCE AND STAMPED ON THE MAN. Re-rolling on every repaint would make
     the headline number flicker while the player reads it, and re-rolling per
     verb would turn the sentence into a forecast. `_willing` is cleared when he
     leaves the wire - see enlist. */
  function rollWilling(ratio) {
    const P = W.state.prisoners;
    for (let i = 0; i < P.length; i++) {
      if (P[i]._willing != null) continue;
      P[i]._willing = W.chance(willChance(P[i], ratio));
    }
  }
  function splitPrisoners() {
    const yes = [], no = [];
    const P = W.state.prisoners;
    for (let i = 0; i < P.length; i++) (P[i]._willing ? yes : no).push(P[i]);
    return { yes: yes, no: no };
  }

  function takePrisoner(id) {
    for (let i = 0; i < W.state.prisoners.length; i++) {
      if (W.state.prisoners[i].id === id) return W.state.prisoners.splice(i, 1)[0];
    }
    return null;
  }

  /* ONE DOOR OUT OF THE WIRE AND INTO THE COLUMN, so the stats, the wounds and
     the provenance can never be set by one path and missed by another.

     THE PROVENANCE IS STAMPED, NOT INFERRED, and that is a real fix. events.js
     works out where a man came from by diffing core's stat counters against the
     roster - fine when one kind of man arrives at a time, and wrong the instant
     one screen adds nineteen volunteers and twelve pressed men in the same
     frame: the counters say "12 conscripted, 19 recruited" and the array says
     nothing about which is which, so the first twelve strangers it finds get
     the pressed man's bond whoever they actually are. This screen is the only
     place in the game that adds two kinds of man at once, so it is the only
     place that has to say it out loud. */
  function enlist(s, kind) {
    if (!takePrisoner(s.id)) return false;
    s.wounded = s.hp < s.maxHp * 0.4;
    s.hp = s.maxHp;
    delete s._willing;
    if (W.events && W.events.provenance) W.events.provenance(s, kind === "pressed" ? "pressed" : "hired");
    W.addSoldier(s);
    if (kind === "pressed") W.state.stats.conscripted++;
    else W.state.stats.recruited++;
    return true;
  }
  function backToAftermath() { if (R) { W.setPhase("aftermath", R); paintAftermath(); } }

  /* THE RECORD DIES. Everything about the picture is elsewhere; this is the
     book-keeping, and it is called from inside the volley so that the man
     leaves the roster on the frame the round arrives (deaths.js's own rule -
     a death cannot wait, or the sim disagrees with itself). */
  function killRecord(s) {
    if (!takePrisoner(s.id)) return false;
    W.state.stats.executed++;
    W.state.fame = Math.max(0, W.state.fame - (W.tierIndex(s.tier) + 1) * 3);
    return true;
  }

  /* ---- VERB 1: TAKE THE WILLING -------------------------------------- */
  function takeWilling() {
    const sp = splitPrisoners();
    const walk = sp.no.slice();
    const apply = function () {
      let joined = 0;
      for (let i = 0; i < sp.yes.length; i++) if (enlist(sp.yes[i], "willing")) joined++;
      /* AND THE REST WALK, which is where the mercy is paid. core's
         surrenderChance reads fame, so letting men go is literally what makes
         the next band fold - the old RELEASE button's chip was telling the
         truth, it just had a button of its own to say it on. */
      let fame = 0;
      for (let i = 0; i < walk.length; i++) {
        if (takePrisoner(walk[i].id)) fame += (W.tierIndex(walk[i].tier) + 1) * 2;
      }
      W.state.fame += fame;
      W.log(joined + " took the gun. " + walk.length + " walked" +
        (fame ? ", and that is worth " + fame + " fame" : "") + ".", "good");
      if (W.events && W.events.settle) W.events.settle("");
    };
    if (!stageable() || !sp.yes.length) { apply(); paintAftermath(); return; }
    showTurn(sp.yes, walk, apply, backToAftermath);
  }

  /* ---- VERB 2: PRESS EVERY MAN --------------------------------------- */
  function pressEveryMan() {
    const sp = splitPrisoners();
    const apply = function () {
      for (let i = 0; i < sp.yes.length; i++) enlist(sp.yes[i], "willing");
      for (let i = 0; i < sp.no.length; i++) enlist(sp.no[i], "pressed");
      W.log((sp.yes.length + sp.no.length) + " men fell in - " + sp.no.length +
        " of them at gunpoint.", sp.no.length ? "bad" : "good");
      /* THE COST, PAID NOW RATHER THAN OVER A FORTNIGHT. events.js owns the
         magnitude and derives it: a pressed man's bond drags the CEILING the
         whole column drifts toward, and settle() moves loyalty to wherever that
         ceiling has just gone. Nothing is typed here. */
      if (sp.no.length && W.events && W.events.settle) {
        W.events.settle(sp.no.length + " men are marching who did not agree to");
      }
    };
    if (!stageable()) { apply(); paintAftermath(); return; }
    showTurn(sp.yes.concat(sp.no), [], apply, backToAftermath);
  }

  /* ---- VERB 3: SHOOT THE UNWILLING ----------------------------------- */
  /* ONE VOLLEY, NOT TWELVE EXECUTIONS. "Bulk actions must stay bulk", and the
     shape that satisfies both halves of it is a firing party: the men who said
     no stand in a rank, one volley puts all of them down, and it costs the
     player the same three and a half seconds whether the rank is four men or
     forty. */
  function shootUnwilling() {
    const sp = splitPrisoners();
    if (!sp.no.length) { takeWilling(); return; }
    const doomed = sp.no.slice();
    const apply = function () {
      for (let i = 0; i < sp.yes.length; i++) enlist(sp.yes[i], "willing");
      let n = 0;
      for (let i = 0; i < doomed.length; i++) if (killRecord(doomed[i])) n++;
      W.log("shot " + n + " prisoner" + (n === 1 ? "" : "s") + " who would not march.", "bad");
      if (W.events && W.events.settle) W.events.settle("they watched you shoot men who said no");
    };
    if (!stageable()) { apply(); paintAftermath(); return; }
    if (W.feel && W.feel.ui) W.feel.ui("demand");
    showExecution(doomed, apply, backToAftermath);
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
    /* FOUR, WHICH IS THE ENCOUNTER CARD'S OWN NUMBER FOR THIS EXACT PICTURE
       ("chips, biggest first, capped at four with a +N"). It was six here, and
       six wraps to three rows of chips on a 375 px phone — 101 px measured —
       which was a third of the overflow this screen was running below the
       fold. Nothing is lost from the only figure anybody spends: `worth` still
       counts every gun in the tail. */
    const LOOT_CAP = 4;
    const chips = [];
    let worth = r.gold > 0 ? r.gold : 0;
    const lootKeys = Object.keys(r.loot || {});
    lootKeys.sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
    for (let i = 0; i < lootKeys.length && i < LOOT_CAP; i++) {
      const wid = lootKeys[i];
      worth += W.gunSell(wid) * r.loot[wid];
      chips.push('<span class="wl-chip"><b>' + r.loot[wid] + '</b> ' + esc(W.gunLabel(wid)) + '</span>');
    }
    if (lootKeys.length > LOOT_CAP) {
      for (let i = LOOT_CAP; i < lootKeys.length; i++) worth += W.gunSell(lootKeys[i]) * r.loot[lootKeys[i]];
      chips.push('<span class="wl-chip wl-dim">+' + (lootKeys.length - LOOT_CAP) + '</span>');
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
       ONE SENTENCE AND AT MOST THREE VERBS. See THE PRISONERS above for what
       was here and why none of it survived. The paragraph that used to sit
       under the buttons explaining what release and execute buy is gone with
       the buttons it explained; what replaces it is the SENTENCE, which is not
       an explanation of a mechanic but the result of one. */
    let prisH = "";
    if (pris.length) {
      askBlood();   // see THE BLOOD PACK: asked when the decision goes up
      rollWilling(ratio);
      const sp = splitPrisoners();
      /* WHAT SHOOTING THEM BUYS, AS A NUMBER ON THE BUTTON THAT DOES IT.
         Derived from fearMul's own curve rather than a second copy of it: how
         much more likely the NEXT band is to fold once these men are in the
         sand. */
      const fearNow = fearMul();
      const fearAfter = 1 + (((W.state.stats && W.state.stats.executed) || 0) + sp.no.length) * 0.09;
      prisH =
        '<div class="wl-lbl">PRISONERS ' + pris.length + '</div>' +
        tierStack(pris) +
        '<div class="wl-small" style="margin:-4px 0 9px;letter-spacing:.05em">' +
          '<b>' + sp.yes.length + '</b> WILL MARCH FOR YOU · <b>' + sp.no.length + '</b> WILL NOT' +
        '</div>' +
        '<div class="wl-btns">' +
          '<button class="wl-btn hot" id="pWilling">TAKE THE WILLING <span class="wl-dim">' +
            sp.yes.length + '</span></button>' +
          (sp.no.length
            ? '<button class="wl-btn" id="pPress">PRESS EVERY MAN <span class="wl-dim">' +
                pris.length + '</span></button>' +
              '<button class="wl-btn bad" id="pShoot">SHOOT THE UNWILLING <span class="wl-dim">+' +
                Math.round((fearAfter / fearNow - 1) * 100) + '%</span></button>'
            : '') +
        '</div>';
    }

    ctx.screen('<div class="wl-aft">' +
      /* AND THE SUB-HEADING IS DELETED BECAUSE IT WAS THE NAME SAID TWICE.
         It printed the band's name in a 15 px line with a 9 px margin under
         it — and the second toll bar four lines below already opens with that
         same name as its legend, because a casualty bar has to say whose
         casualties it is. Two lines of the same six words on a screen that
         was running 62 px below the fold on an iPhone SE. */
      '<h1 class="wl-h" style="margin-bottom:10px">' + title + '</h1>' +

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

      /* "TAKEN" IS DELETED, and it is the fifth caption on this screen to go
         for the same reason the other four did: it labelled a row of chips
         that each read "5 M249 LMG" next to a gold chip that reads "$420".
         The encounter card lost "CARRYING" over exactly this argument. A
         heading costs 31 px on a 375 px phone (15 of type plus 16 of margin)
         and this screen was running below the fold. */
      (chips.length ? '<div class="wl-chips" style="margin-top:12px">' + chips.join("") + '</div>' : '') +

      prisH +

      '<div class="wl-btns out">' +
        '<button class="wl-btn hot" id="aDone">RIDE ON</button>' +
      '</div></div>'
    );

    const bw = ctx.el("pWilling"); if (bw) bw.onclick = takeWilling;
    const bp = ctx.el("pPress");   if (bp) bp.onclick = pressEveryMan;
    const bs = ctx.el("pShoot");   if (bs) bs.onclick = shootUnwilling;
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
      THREE = c.THREE || G.THREE || null;
      scene = c.scene || CBZ.scene || null;
      showOld = !!(Q && (Q.get("show") === "old" || Q.get("show") === "0"));
      installFear();
      W.on("dawn", restAtDawn);
      /* A TABLEAU MUST NOT SURVIVE THE THING IT IS ABOUT. A battle starting
         under a running one would leave a rank of instanced men standing in
         the middle of it and the clock held at 1x forever. */
      W.on("phase:battle", function () { if (tab) { tab.dur = 0; stepTab(0); } });
      /* order 98: after campaign.js's world tick (30) and events.js's (96),
         so it reads the cooldowns everything else has already written this
         frame rather than a stale copy of them. */
      if (CBZ.onAlways) CBZ.onAlways(98, function (dt) { tick(dt); unstickContacts(dt); });

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
    /* THE SCALE RULE, published so a probe can ask where the line is without
       reproducing core's surrender curve. */
    surrenderSure: function () { return W.surrenderSure ? W.surrenderSure() : 3.05; },
    aftermath: aftermath,

    // ---- the shared roster shape (loadout.js and the encounter card read it)
    roster: function () { return W.state.army.slice(); },
    groups: function (men) { return groupsOf(men || W.state.army); },

    // ---- drive-only, for the ba preset. See THE DRIVE SEAM.
    showFreeze: function (on) { frozen = on !== false; return frozen; },
    showAdvance: function (sec) {
      driving = true;
      let left = Math.max(0, +sec || 0);
      /* 1/60 s slices: the fold is damped at 7/s and the struck beat is a
         tenth of a second, so a single big step straddles both. */
      while (left > 1e-5 && tab) { const d = Math.min(1 / 60, left); stepTab(d); left -= d; }
      driving = false;
      return tab ? tab.t : -1;
    },

    /* ---- WHAT IS ON THE SAND RIGHT NOW, for tools/visual-presets/warlord-show.mjs.
       Every number is a COUNT OF BODIES, not a count of intentions: `standing`
       and `fallen` are read off the rank this file is actually drawing, so a
       tableau that is recorded and not rendered reads as zero — which is the
       exact failure this whole wave is about. */
    showAudit: function () {
      let standing = 0, fallen = 0, walking = 0;
      if (rank) {
        for (let i = 0; i < rank.men.length; i++) {
          const m = rank.men[i];
          if (m.gone) continue;
          if (m.fall) fallen++; else if (m.walk && m.walk.t > m.walk.delay) walking++; else standing++;
        }
      }
      return {
        on: !showOld, live: !!tab, id: tab ? tab.id : "",
        t: tab ? Math.round(tab.t * 100) / 100 : 0,
        drawn: rank ? rank.body.count : 0,
        standing: standing, fallen: fallen, walking: walking,
        arms: armsOut.length,
        prisoners: W.state.prisoners.length,
        unwilling: W.state.prisoners.filter(function (s) { return s._willing === false; }).length,
        willing: W.state.prisoners.filter(function (s) { return s._willing === true; }).length,
        executed: (W.state.stats && W.state.stats.executed) || 0,
        army: W.state.army.length,
        blood: !!CBZ.gore, bloodEvents: goreN,
        phase: W.phase(), held: W.clock ? W.clock.heldFor() : "",
        worldLit: !!(W.campaign && W.campaign.live && W.campaign.live()),
      };
    },

    // ---- the numbers other modules ask for
    hirePrice: hirePrice,
    canRob: canRob,
    fearMul: fearMul,
    willChance: willChance,
    /* THE THREE VERBS, PUBLISHED. tools/warlord-island-check.mjs asserts there
       are exactly three and drives them; a screen whose only door is a click
       handler cannot be checked by anything but a photograph. */
    prisonerVerbs: function () { return ["TAKE THE WILLING", "PRESS EVERY MAN", "SHOOT THE UNWILLING"]; },
    takeWilling: takeWilling,
    pressEveryMan: pressEveryMan,
    shootUnwilling: shootUnwilling,
    splitPrisoners: function () { const sp = splitPrisoners(); return { willing: sp.yes.length, unwilling: sp.no.length }; },
  });
})();
