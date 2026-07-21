/* ============================================================
   city/street_talk.js — offer engine for the YES / NO grammar.

   city/interactions.js already resolves every approach into:
       [E] YES     accept the current proposal
       [I] NO      refuse / walk it off

   This file only owns WHAT the proposal is for a stranger: one offer derived
   from live variables (your level, their level, max cash they can spare,
   job, wealth). Funny equal-opportunity look jokes + custom.env tokens ride
   on the lines. No extra keys, no second panel.

   Feature flag: CBZ.CONFIG.STREET_TALK_V2 (default ON).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.interactions) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.STREET_TALK_V2 == null) CFG.STREET_TALK_V2 = true;
  const I = CBZ.interactions;

  function on() { return CFG.STREET_TALK_V2 !== false; }
  function bw(s) { return (CBZ.bw ? CBZ.bw(s) : String(s || "")).replace(/\{\{[^}]+\}\}/g, "****"); }
  function note(msg, secs) { if (CBZ.city && CBZ.city.note) CBZ.city.note(bw(msg), secs == null ? 2.4 : secs); }
  function say(p, text, color, secs) { if (CBZ.citySay) CBZ.citySay(p, bw(text), color || "#dfe7ff", secs == null ? 2.2 : secs); }
  function sfx(n) { if (CBZ.sfx) CBZ.sfx(n); }
  function meet(p) { if (CBZ.cityMeet) CBZ.cityMeet(p); }
  function relShift(p, kind, amt) { if (CBZ.cityRelShift) try { return CBZ.cityRelShift(p, kind, amt); } catch (e) {} return 0; }
  function nm(p) { return (p && p.name) || "them"; }
  function money(n) { n = Math.round(n || 0); return n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n; }
  function myCash() { return (g && (g.cash | 0)) || 0; }
  function spend(n) {
    if (CBZ.city && CBZ.city.spend) return CBZ.city.spend(n);
    if (g && g.cash >= n) { g.cash -= n; return true; }
    return false;
  }
  function addCash(n) {
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(n);
    else if (g) g.cash = (g.cash | 0) + (n | 0);
  }
  function lvl(a) { return CBZ.cityLevel ? CBZ.cityLevel(a) : 10; }
  function myLvl() { return CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : (CBZ.player ? lvl(CBZ.player) : 10); }
  function nowSec() {
    try { return (performance.now ? performance.now() : Date.now()) / 1000; }
    catch (e) { return Date.now() / 1000; }
  }

  // ---- look buckets (equal roast table — cosmetic only) -------------------
  const SKIN_BUCKET = [
    { hex: 0xfae0c8, tag: "pale" }, { hex: 0xf0c39a, tag: "light" },
    { hex: 0xe8b58c, tag: "light" }, { hex: 0xd8a177, tag: "mid" },
    { hex: 0xc08a5a, tag: "mid" }, { hex: 0x8a5a3a, tag: "brown" },
    { hex: 0x6b4a32, tag: "dark" }, { hex: 0x5a3c28, tag: "dark" },
  ];
  function skinOf(a) {
    if (!a) return 0xf0c39a;
    if (a.skin != null) return a.skin | 0;
    if (a.char && a.char.skinTone != null) return a.char.skinTone | 0;
    if (a === CBZ.player || (a && a.isPlayer)) {
      const ch = CBZ.playerChar;
      if (ch && ch.skinTone != null) return ch.skinTone | 0;
      if (g && g.cityPlayerSkin != null) return g.cityPlayerSkin | 0;
    }
    return 0xf0c39a;
  }
  function lookTag(a) {
    const sk = skinOf(a);
    let best = SKIN_BUCKET[0], bd = 1e9;
    for (let i = 0; i < SKIN_BUCKET.length; i++) {
      const d = Math.abs((SKIN_BUCKET[i].hex | 0) - sk);
      if (d < bd) { bd = d; best = SKIN_BUCKET[i]; }
    }
    return best.tag;
  }
  function playerLook() {
    if (g && g.cityPlayerRace) return String(g.cityPlayerRace);
    return lookTag(CBZ.player);
  }

  // Equal-opportunity roast lines — every look bucket gets it, including you.
  // Tokens resolve live from custom.env (uncensored by default).
  const RACE_LINES = {
    pale: [
      "You {{F_WORD}}ing {{SLUR_WHITE}} glow like a flashlight in a dark alley.",
      "Pale {{A_WORD}} energy. The sun is your final boss.",
      "Bro your SPF is a personality trait, you pasty {{S_WORD}}.",
    ],
    light: [
      "Light-skinned and already arguing with the sun, you {{B_WORD}}.",
      "You look like you burn at the idea of summer, {{A_WORD}}.",
      "Soft-serve complexion. Respectfully, {{S_WORD}}head.",
    ],
    mid: [
      "Perfect beige. The human default skin pack, you boring {{A_WORD}}.",
      "Mid-tone menace. Neither pasty nor mysterious, just {{S_WORD}}.",
      "You look like every driver's license photo ever, {{B_WORD}}.",
    ],
    brown: [
      "Brown and unbothered, you seasoned {{A_WORD}}.",
      "Warm tone, cold stare. Dangerous combo, {{S_WORD}}head.",
      "You look like you season food correctly. Don't make me {{F_WORD}} it up.",
    ],
    dark: [
      "Dark and cinematic, you {{SLUR_BLACK}} lighting-department dream.",
      "You absorb sunlight like a solar panel of swagger, {{A_WORD}}.",
      "Night-mode skin. Phone cameras can't handle that {{S_WORD}}.",
    ],
  };
  const SELF_LINES = {
    pale: ["I'm out here looking like a raw {{SLUR_WHITE}} chicken and still asking for trouble."],
    light: ["I'm light-skinned, broke, and already mid-{{S_WORD}}show. Classic."],
    mid: ["I'm mid-tone mid-life mid-wallet. Peak {{S_WORD}} comedy."],
    brown: ["I'm brown, broke, and somehow still the main {{A_WORD}}."],
    dark: ["I'm a dark-skinned {{SLUR_BLACK}} with lighter pockets. The duality of man."],
  };
  const YES_YES = [
    "Bet. Let's run it.", "Say less.", "I'm down. Don't make me regret it.",
    "Alright, you {{F_WORD}} — deal.", "Yes. But if this is a setup I will {{F_WORD}} you up.",
  ];
  const NO_NO = [
    "Hard pass.", "Nah. Walk.", "Not today, chief.",
    "I said no, {{A_WORD}}.", "Keep that energy somewhere else.",
  ];
  const PUNCH_LINES = [
    "Conversation over.", "Talk with your hands then.",
    "Alright. Square up.", "You wanted physical? Here.",
  ];

  // ---- offer engine -------------------------------------------------------
  function maxOfferCash(p) {
    const w = Math.max(0, Math.min(1, p.wealth || 0.2));
    const base = 5 + Math.floor(w * w * 420);
    if (p.vipLvl) return Math.max(base, 200 + (p.vipLvl | 0) * 8);
    if (p.cash != null && p.cash > 0) return Math.min(base * 2, p.cash | 0);
    return base;
  }
  function levelGap(p) { return myLvl() - lvl(p); }

  function buildOffer(p) {
    const gap = levelGap(p);
    const max = maxOfferCash(p);
    const broke = myCash() < 40;
    const richMe = myCash() >= 5000 || myLvl() >= 40;
    const pedBroke = (p.wealth || 0) < 0.28;
    let kind, amount = 0, label, yesLine, noLine;

    if (gap >= 12 && max >= 15) {
      kind = "tribute";
      amount = Math.max(5, Math.floor(max * (0.35 + Math.min(0.45, gap * 0.02))));
      label = "Take " + money(amount);
      yesLine = "They peel off " + money(amount) + ". Eyes on the ground.";
      noLine = "You wave them off. They look grateful and confused.";
    } else if (gap <= -12) {
      kind = "tax";
      amount = Math.max(10, Math.min(myCash() || 10, 20 + Math.floor((-gap) * 3)));
      label = "Pay " + money(amount);
      yesLine = "You hand over " + money(amount) + ". They smirk.";
      noLine = "You refuse the tax. They clock the disrespect.";
    } else if (pedBroke && !broke && myCash() >= 25) {
      kind = "charity";
      amount = Math.min(40, Math.max(10, Math.floor(myCash() * 0.05)));
      label = "Slip " + money(amount);
      yesLine = "You help them out. They won't forget it.";
      noLine = "You keep your wallet shut. They clock it.";
    } else if (broke && max >= 20) {
      kind = "handout";
      amount = Math.max(8, Math.floor(max * 0.4));
      label = "Take " + money(amount);
      yesLine = "Charity from a stranger. You pocket it.";
      noLine = "Pride over rent money. You walk.";
    } else if (p.job && /dealer|trap|runner/i.test(p.job)) {
      kind = "deal";
      amount = Math.min(80, Math.max(20, Math.floor(max * 0.5)));
      label = "Deal " + money(amount);
      yesLine = "A little product changes hands. Quiet.";
      noLine = "You pass on the bag. Not tonight.";
    } else if (richMe && (p.wealth || 0) > 0.55) {
      kind = "flex";
      amount = 0;
      label = "Flex";
      yesLine = "You talk money. They clock the suit that used to mean something.";
      noLine = "You ghost the networking. Cold.";
    } else {
      kind = "chat";
      amount = 0;
      label = "Talk";
      yesLine = "You trade a few lines. City noise fills the gaps.";
      noLine = "You shut it down. They shrug.";
    }

    const pl = playerLook();
    const them = lookTag(p);
    const jokePool = SELF_LINES[pl] || [];
    const roastPool = RACE_LINES[them] || [];
    return {
      kind, amount, max, gap, label, yesLine, noLine,
      joke: jokePool.length ? jokePool[(Math.random() * jokePool.length) | 0] : null,
      roast: roastPool.length ? roastPool[(Math.random() * roastPool.length) | 0] : null,
      pl, them,
    };
  }

  function offerOf(p) {
    if (!p) return null;
    const t = nowSec();
    if (!p._streetOffer || (p._streetOffer.ttl || 0) < t) {
      p._streetOffer = buildOffer(p);
      p._streetOffer.ttl = t + 8;
    }
    return p._streetOffer;
  }

  function isStrangerish(p) {
    if (!p || p.dead || p.vendor) return false;
    if (p.surrender || p.rage || p.state === "fight" || p.state === "flee") return false;
    if (p.companion || p.recruited) return false;
    if (p.kind === "cop" || p.kind === "security") return false;
    if (p._streetDone && p._streetDone > nowSec()) return false;
    return true;
  }
  function canShow(p) { return on() && isStrangerish(p); }

  // ---- resolutions --------------------------------------------------------
  function doYes(p) {
    if (!p) return;
    meet(p);
    const o = offerOf(p) || buildOffer(p);
    if (o.joke && Math.random() < 0.45) note(o.joke, 2.0);
    else if (o.roast && Math.random() < 0.35) note(o.roast, 2.0);
    else note(YES_YES[(Math.random() * YES_YES.length) | 0], 1.6);

    if (o.kind === "tribute" || o.kind === "handout") {
      const got = Math.min(o.amount, maxOfferCash(p));
      addCash(got);
      if (p.cash != null) p.cash = Math.max(0, (p.cash | 0) - got);
      p.wealth = Math.max(0, (p.wealth || 0.2) - 0.05);
      relShift(p, "intimidated", o.kind === "tribute" ? 1 : 0.4);
      say(p, o.kind === "tribute" ? "“Take it — just go.”" : "“Here. Get back on your feet.”", "#cdeccd", 2.2);
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(o.kind === "tribute" ? 2 : 1);
      sfx("coin");
    } else if (o.kind === "tax") {
      if (spend(o.amount)) {
        if (p.cash != null) p.cash = (p.cash | 0) + o.amount;
        relShift(p, "gift", 0.3);
        say(p, "“Smart. Stay breathing.”", "#ffd1c4", 2.2);
        sfx("coin");
      } else {
        note("You're too broke to pay. They laugh.", 2);
        relShift(p, "snubbed", 0.6);
        say(p, "“Pathetic.”", "#ff8a7a", 2);
      }
    } else if (o.kind === "charity") {
      if (spend(o.amount)) {
        if (p.cash != null) p.cash = (p.cash | 0) + o.amount;
        relShift(p, "gift", 1);
        say(p, "“God bless. For real.”", "#cdeccd", 2.2);
        if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(1);
        sfx("coin");
      }
    } else if (o.kind === "deal") {
      if (myCash() >= 15 && Math.random() < 0.55) {
        if (spend(15)) { addCash(15 + Math.floor(o.amount * 0.5)); sfx("coin"); }
      } else {
        addCash(Math.floor(o.amount * 0.35)); sfx("coin");
      }
      relShift(p, "greeted", 0.5);
      say(p, "“We never met.”", "#bfe0ff", 2);
      if (CBZ.cityAddStars && Math.random() < 0.08) try { CBZ.cityAddStars(1, "street deal"); } catch (e) {}
    } else if (o.kind === "flex") {
      relShift(p, "greeted", 0.7);
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(1);
      say(p, "“Call me if the markets ever love you again.”", "#ffe9a8", 2.4);
    } else {
      relShift(p, "greeted", 0.5);
      say(p, ["“Crazy city, huh.”", "“Stay dangerous.”", "“You look familiar.”"][(Math.random() * 3) | 0], "#dfe7ff", 2);
    }
    note(o.yesLine, 2.4);
    p._streetOffer = null;
    p._streetDone = nowSec() + 2.5;
  }

  // ORPHANED (owner "NO is not an option"): street-offer's decline row is gone,
  // so nothing wires onDecline anymore — doNo no longer runs. Kept to avoid a
  // literal-heavy delete mid emoji-sweep; safe to remove once that merge lands.
  function doNo(p) {
    if (!p) return;
    meet(p);
    const o = offerOf(p) || buildOffer(p);
    note(NO_NO[(Math.random() * NO_NO.length) | 0], 1.6);
    note(o.noLine, 2.2);
    if (o.kind === "tax") {
      relShift(p, "snubbed", 1);
      say(p, "“Remember that.”", "#ff8a7a", 2);
      if (Math.random() < 0.28) doPunch(p, true);
    } else if (o.kind === "tribute") {
      relShift(p, "greeted", 0.3);
      say(p, "“…thanks?”", "#cfd6e6", 1.8);
    } else {
      relShift(p, "snubbed", 0.35);
      say(p, "“Whatever.”", "#cfd6e6", 1.6);
    }
    p._streetOffer = null;
    p._streetDone = nowSec() + 1.8;
  }

  function doPunch(p, fromRefuse) {
    if (!p) return;
    meet(p);
    note(PUNCH_LINES[(Math.random() * PUNCH_LINES.length) | 0], 1.6);
    relShift(p, "threatened", 1);
    p.rage = CBZ.city && CBZ.city.playerActor ? CBZ.city.playerActor : CBZ.player;
    p.state = "fight";
    p.fear = 0;
    p.alarmed = Math.max(p.alarmed || 0, 6);
    try {
      const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
      if (CBZ.player) CBZ.player._fighting = 1.5;
      if (p.kind === "cop") {
        if (CBZ.cityHurtCop) CBZ.cityHurtCop(p, 35, { fromX: fx, fromZ: fz });
      } else {
        p.hp = (p.hp == null ? 100 : p.hp) - 35;
        if (p.hp <= 0 && CBZ.cityKillPed) CBZ.cityKillPed(p, { fromX: fx, fromZ: fz }, "beaten");
        else if (CBZ.cityKOPed) CBZ.cityKOPed(p, fx, fz);
      }
    } catch (e) {}
    say(p, fromRefuse
      ? "“You refuse AND swing? {{F_WORD}} you!”"
      : ["“OH it's like that?!”", "“Let's GO!”", "“{{F_WORD}} you!”"][(Math.random() * 3) | 0],
      "#ff8a7a", 2.2);
    sfx("punch");
    if (CBZ.shake) CBZ.shake(0.25);
    p._streetOffer = null;
    p._streetDone = nowSec() + 6;
  }

  // ---- register ONE proposal option (the grammar owns YES/NO keys) --------
  // High prio so this beats mug/talk fluff for plain strangers. forceYes so
  // a broke Lv.1 can still collect tribute when they somehow out-read someone,
  // and so economic offers aren't blocked by "they ignore you" standing gates.
  I.register("ped:civ", {
    id: "street-offer", slot: "e", prio: 72, forceYes: true, campaignSafe: true,
    canShow: (p) => canShow(p),
    label: (p) => {
      const o = offerOf(p);
      return o ? o.label : "Talk";
    },
    onSelect: (p) => doYes(p),
  });

  // Describe ped approaches with the level/offer read (panel note uses this).
  I.describe("ped", function (p) {
    if (!on() || !p) return { label: (p && p.name) || "—", note: "" };
    const o = offerOf(p);
    // The level now reads over their head (aim_dossier overhead label), so the
    // card is just their name — and the note is an in-world cue, NOT a stat line
    // ("You Lv.23 · gap +7 · max offer $180"). The action itself is the YES verb.
    if (!o) return { label: (p.name || "Someone"), note: "" };
    const CUE = {
      tribute: "They're sizing you up — and folding.", tax: "They expect their cut.",
      charity: "They could use a hand.", handout: "They're pressing cash on you.",
      deal: "There's product to move here.", flex: "Old money, measuring you.",
      chat: "Just street talk.",
    };
    return { label: (p.name || "Someone"), note: CUE[o.kind] || "" };
  });

  CBZ.streetTalkOffer = offerOf;
  CBZ.streetTalkEnabled = on;
})();
