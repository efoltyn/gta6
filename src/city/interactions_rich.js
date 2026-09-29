/* ============================================================
   city/interactions_rich.js — DEEPER STREET TALK.

   Owner's note: "make interacting with them more interesting." The base
   verb set (interact.js) is mostly rob / talk / recruit. This file adds
   the SOCIAL half — the conversation beats and small transactions that
   make walking up to a stranger worth doing even when you don't want
   their wallet.

   WHY-FIRST, every option earns its slot:
     • COMPLIMENT / INSULT — words have teeth. A compliment buys a sliver
       of warmth (affection, a smile); an insult plants a grudge and the
       person may snub you, walk off, or square up. Real reactions, via
       the relationship sim (cityRelShift) + speech bubbles (citySay).
     • SIZE THEM UP / INTIMIDATE — leaning on someone WEAKER than you (the
       street-read, cityLevel) makes them fear you; trying it on someone
       BIGGER just makes you look small. Fear has consequences elsewhere
       (they fold to a shakedown, snitch faster) — so this is leverage you
       BUILD, not a toast.
     • ASK FOR DIRECTIONS — a stranger points you at the nearest useful
       counter and DROPS A WAYPOINT. The city is big; a local's directions
       are a real service, and asking nicely warms them to you.
     • ASK WHAT'S GOOD / FOR A LEAD — gossip is currency. Someone who
       likes you will tip you to the armored truck on the move or a VIP
       worth a photo (or a robbery). Gated on the bond — strangers clam up.
     • BUM A SMOKE / ASK FOR A LIGHT — the smallest possible social
       transaction. Costs nothing, breaks the ice, and a friendly local
       obliges (tiny warmth) while a cold one tells you to get lost.
     • GIVE THEM A FEW BUCKS — charity to someone who looks broke buys
       genuine goodwill (the "gift" event: affection + loyalty + respect)
       and spreads your name as a soft touch. Reads your cash, real spend.
     • FAN MOMENT (VIP only) — a celebrity/VIP gets a PHOTO / AUTOGRAPH
       instead of "talk". A brush with fame is its own reward (a little
       street cred for being seen with them).
     • DEFERENCE BY LEVEL — the panel itself differs by WHO you are to
       them: a VIP or someone who plainly outranks you brushes off a
       low-level player; a nobody defers to a name. The street-read gates
       the verbs so the same key means different things to different people.

   Reuses the ONE registry (CBZ.interactions) exactly like interact.js —
   no new keys, no new panel. Slots: every option declares E/I/J/K/L and a
   prio; the registry's slot-exclusivity picks the contextual winner, so
   these never collide with interact.js's rob/recruit/talk chain. Every
   helper is feature-detected — if a system is absent the option no-ops or
   hides, never throws.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.interactions) return;     // registry must exist (load order)
  const g = CBZ.game;
  const I = CBZ.interactions;

  // ---- tiny guarded helpers (mirror interact.js's degrade-safe style) -----
  function say(p, text, color, secs) { if (CBZ.citySay) CBZ.citySay(p, text, color || "#dfe7ff", secs == null ? 2.2 : secs); }
  function relShift(p, kind, amt) { if (CBZ.cityRelShift) try { return CBZ.cityRelShift(p, kind, amt); } catch (e) {} return 0; }
  function rel(p) { return CBZ.cityRel ? CBZ.cityRel(p) : null; }
  function bond(p) { return CBZ.cityBond ? CBZ.cityBond(p) : 0; }
  function meet(p) { if (CBZ.cityMeet) CBZ.cityMeet(p); }       // learn their name
  function lvl(a) { return CBZ.cityLevel ? CBZ.cityLevel(a) : 10; }
  function myLvl() { const P = CBZ.player; return P ? lvl(P) : 10; }
  function sfx(name) { if (CBZ.sfx) CBZ.sfx(name); }
  // every line comes out of the ONE book (city/read.js): who they are, who you
  // are, what you did to them, the hour, the rain. `fb` is the degrade line.
  function sayT(p, topic, fb, opts) {
    const s = (CBZ.cityLine && CBZ.cityLine(p, topic, opts)) || fb;
    if (s) say(p, s, null, (opts && opts.secs) || 2.4);
    return s;
  }

  // money read for the give-money option
  function money(n) { n = Math.round(n || 0); return n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n; }
  function myCash() { return g && (g.cash | 0); }
  function spend(n) { if (CBZ.city && CBZ.city.spend) return CBZ.city.spend(n); if (CBZ.city && CBZ.city.canAfford && CBZ.city.canAfford(n)) { g.cash -= n; return true; } return false; }

  // is this ped a hands-off target for SOCIAL verbs? (we never want to clutter
  // the panel of a vendor/cop/your-own-soldier/your-crew with stranger chit-chat —
  // those branches already own the slots via higher prio in interact.js, but we
  // also self-gate so a compliment never shows on your patched-in soldier.)
  function isStrangerish(p) {
    if (!p || p.dead || p.vendor) return false;
    if (p.surrender || p.rage || p.state === "fight" || p.state === "flee") return false;
    return true;
  }
  // your own people / crew-mates — social fluff would be noise on them.
  function isYours(p) {
    if (p.companion || p.recruited) return true;
    if (CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p)) return true;
    const m = CBZ.cityMembership && CBZ.cityMembership();
    if (m && p.gang && p.gang === m.gangId) return true;
    if (p === g.cityPartner) return true;
    return false;
  }
  function hatesYou(p) { const r = rel(p); return !!(r && r.grudge > 45); }

  // VIP / celebrity read (vips.js stamps vipLvl + vipTitle on the whale).
  function isVip(p) { return !!(p && (p.vipTitle || (p.vipLvl | 0) >= 30)); }
  function vipTitle(p) { return (p && p.vipTitle) || "VIP"; }

  // how the ped reads the player by LEVEL: a much bigger name dismisses you; a
  // much smaller one defers. Used to flavor the WHY and gate intimidation.
  function readsMeAsBigger(p) { return lvl(p) >= myLvl() + 12; }   // they outrank me clearly
  function readsMeAsSmaller(p) { return myLvl() >= lvl(p) + 12; }  // I outrank them clearly

  // ============================================================
  //  THE BEATS
  // ============================================================

  // ---- COMPLIMENT (slot K, low prio so the relationship ladder in interact.js
  //      wins when it has something to say; this fills the slot for a plain
  //      stranger). Words buy a sliver of warmth — and they remember you said it.
  function compliment(p) {
    meet(p);
    // a small, genuine goodwill nudge — the "flirted" table is mostly affection
    // without the romance commitment; scale it down so a compliment < a date.
    relShift(p, "flirted", 0.4);
    if (p.mood != null) p.mood = Math.min(1, (p.mood || 0) + 0.35);
    sayT(p, "complimentBack", "Ha. Thanks.");
    sfx("blip");
  }

  // ---- INSULT (slot L, low prio — sits under pickpocket only when nothing
  //      meaner applies). A jab plants a grudge; the person snubs you, and a
  //      bold/armed one may square up. Free to throw, not free to eat.
  function insult(p) {
    meet(p);
    // AN INSULT SCALES WITH WHO IS THROWING IT (owner: "insults scaling to
    // bigger reactions"). intimidate() has always read the level gap and insult
    // never did, so the same words from a Kingpin and from a nobody landed
    // identically. One shared band now (city/read.js cityReadGap, ±1 at 12
    // levels and ±2 at 28): being talked down to by somebody far above you
    // stings, and mouthing off to somebody far above you emboldens them.
    const gap = CBZ.cityReadGap ? CBZ.cityReadGap(p) : 0;   // + = you outrank them
    relShift(p, "snubbed", gap >= 1 ? 1.45 : gap <= -1 ? 0.7 : 1);
    if (p.mood != null) p.mood = Math.max(-1, (p.mood || 0) - 0.5);
    // bold/armed/aggressive marks bristle and confront; the timid just sour and
    // peel off. We bend the existing brain inputs, never invent new state.
    // A man who plainly out-reads you squares up almost regardless of nerve;
    // one you tower over needs real aggression to try it.
    const aggr = p.aggr || 0.3, r = rel(p);
    const bold = gap <= -1 ? true
               : gap >= 2 ? (p.armed && aggr >= 0.75)
               : (p.armed || aggr >= 0.6 || (r && r.respect > r.fear + 15));
    if (bold && CBZ.city && CBZ.city.playerActor) {
      relShift(p, "threatened", 0.5);
      p.rage = CBZ.city.playerActor; p.state = "confront"; p.fear = 0;
      sayT(p, "insultBold", "Say that again.");
    } else {
      // they sour and walk off the other way
      p.pause = 0; p.path = null;
      if (p.target && p.pos) p.target.set(p.pos.x + (Math.random() - 0.5) * 6, 0, p.pos.z - 5);
      sayT(p, "insultMeek", "Whatever, man.");
    }
    sfx("blip");
  }

  // ---- SIZE UP / INTIMIDATE (slot J for a plain civilian — sits below the
  //      gang/crew J verbs by prio). You can only lean on someone you plainly
  //      OUT-read; trying it on a bigger name backfires (you look small). Fear
  //      is durable leverage: a feared mark folds to a shakedown later.
  // THREATEN has two honest endings, and the WORLD picks (sizeup + the brain),
  // never a toast: they back off (a real step away, a real flight if they
  // scare) or they square up and it is a fight.
  function intimidate(p) {
    meet(p);
    const pa = CBZ.city && CBZ.city.playerActor;
    const dares = readsMeAsBigger(p) || (pa && CBZ.citySizeUp && CBZ.citySizeUp(p, pa) && ((p.aggr || 0.3) >= 0.6 || p.armed));
    if (dares) {
      const r = rel(p); if (r) r.respect = Math.max(0, r.respect - 3);
      relShift(p, "snubbed", 0.6);
      if (pa && ((p.aggr || 0.3) >= 0.55 || p.armed || !readsMeAsBigger(p))) {
        // he steps INTO it: a fist fight through the city melee
        p.rage = pa; p.state = "confront"; p.fear = 0;
        sayT(p, "scoffFight", "You threatening me?");
      } else sayT(p, "scoff", "Cute. Run along.");
      return;
    }
    relShift(p, "intimidated", readsMeAsSmaller(p) ? 1.3 : 1);   // a big gap lands harder
    p.alarmed = Math.max(p.alarmed || 0, 4);
    p.fear = Math.min(10, (p.fear || 0) + 3);
    sayT(p, "cower", "Okay, okay.");
    // the body backs off: the brain decides whether a back-step becomes a run
    if (pa && CBZ.cityScare) { try { CBZ.cityScare(p, pa, { bias: 0.25 }); } catch (e) {} }
    else if (p.pos && pa && pa.pos && p.target) {
      const dx = p.pos.x - pa.pos.x, dz = p.pos.z - pa.pos.z, d = Math.hypot(dx, dz) || 1;
      p.target.set(p.pos.x + dx / d * 6, 0, p.pos.z + dz / d * 6); p.pause = 0; p.path = null;
    }
    sfx("blip");
  }

  function cap(s) { s = String(s || ""); return s ? s[0].toUpperCase() + s.slice(1) : s; }
  function compassFrom(px, pz, tx, tz) {
    const dx = tx - px, dz = tz - pz;
    const ns = dz < 0 ? "north" : "south", ew = dx < 0 ? "west" : "east";
    if (Math.abs(dx) > Math.abs(dz) * 1.6) return cap(ew);
    if (Math.abs(dz) > Math.abs(dx) * 1.6) return cap(ns);
    return cap(ns + ew);
  }

  // ---- ASK THE WAY. The old version dropped a map waypoint, which was the
  //      game holding your hand, so it was cut. What a real stranger does is
  //      POINT: he turns, raises his arm at the place and names it. No pin, no
  //      marker; you walk the way the arm said. WHICH place is read off you:
  //      bleeding asks for the hospital, hot asks for a change of clothes,
  //      late asks for a bar, empty-handed asks for a gun counter.
  function wantKinds() {
    const P = CBZ.player;
    const hp = P ? (P.hp == null ? 100 : P.hp) : 100, mx = (P && P.maxHp) || 100;
    if (hp < mx * 0.55) return ["hospital"];
    if ((g.wanted | 0) >= 1) return ["clothing", "barber"];
    let hour = 12;
    try { if (CBZ.cityHour) hour = CBZ.cityHour(); } catch (e) {}
    if (hour >= 21 || hour < 4) return ["bar", "food"];
    if (!(CBZ.cityOwnsGun && CBZ.cityOwnsGun())) return ["guns", "pawn"];
    return ["food", "bar", "clothing", "gym"];
  }
  function nearestLotOf(kinds, x, z, maxD) {
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    let best = null, bd = maxD * maxD;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.demolished || !l.building || kinds.indexOf(l.kind) < 0) continue;
      const dx = l.cx - x, dz = l.cz - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  // turn to a point and hold an arm out at it (the pose lives with the other
  // talk gestures in city/dialogue.js; peds.js's _faceAt turns the body)
  function pointAt(p, x, z, dur) {
    p._faceAt = { x: x, z: z };
    p._faceT = Math.max(p._faceT || 0, dur);
    if (CBZ.cityDialogue && CBZ.cityDialogue.beat) CBZ.cityDialogue.beat(p, "dlgPoint", dur);
  }
  function pointTheWay(p) {
    if (!p || p.dead || !p.pos) return false;
    meet(p);
    const lot = nearestLotOf(wantKinds(), p.pos.x, p.pos.z, 320);
    if (!lot) { sayT(p, "directionsNone", "Couldn't tell you."); return false; }
    const name = (lot.building && (lot.building.name || (lot.building.shop && lot.building.shop.name))) || cap(lot.kind);
    const dir = compassFrom(p.pos.x, p.pos.z, lot.cx, lot.cz).toLowerCase();
    pointAt(p, lot.cx, lot.cz, 2.4);
    sayT(p, "directions", name + "? That way.", { vars: { place: name, dir: dir }, secs: 3 });
    relShift(p, "greeted", 0.3);
    return true;
  }
  CBZ.cityPointTheWay = pointTheWay;
  CBZ.cityPointAt = pointAt;

  // ---- TIP THE BUSKER. Five dollars into the case: it is real money in his
  //      pocket, he says so, and he gives you a bow before he plays on.
  const TIP = 5;
  function isBusker(p) { return !!(p && p._role === "busker" && p._stage && !p.dead); }
  function tipBusker(p) {
    if (!spend(TIP)) return;
    meet(p);
    p.cash = (p.cash | 0) + TIP;
    relShift(p, "gift", 0.5);
    if (p.mood != null) p.mood = Math.min(1, (p.mood || 0) + 0.4);
    sayT(p, "busker", "Thank you!");
    p._faceT = Math.max(p._faceT || 0, 1.0);
    if (CBZ.cityDialogue && CBZ.cityDialogue.beat) CBZ.cityDialogue.beat(p, "dlgBow", 0.9);
    sfx("coin");
  }

  // ---- ASK WHAT'S GOOD / FOR A LEAD (slot K, prio above directions but gated on
  //      the BOND — a stranger clams up, someone who likes you tips you off).
  //      The tip is REAL: an armored truck on the move, or a VIP worth finding.
  function canTip(p) {
    if (hatesYou(p)) return false;
    const r = rel(p);
    // a warm enough read, OR they're a little scared of you (folds and talks).
    return bond(p) > 0.25 || (r && r.fear > 40) || (CBZ.cityRelLabel && /likes|loves|respect/.test(CBZ.cityRelLabel(p) || ""));
  }
  function nearestVipOther(p) {
    let best = null, bd = Infinity;
    for (const q of CBZ.cityPeds) {
      if (q === p || q.dead || q.vendor || !isVip(q)) continue;
      const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }
  function askLead(p) {
    meet(p);
    relShift(p, "greeted", 0.4);
    // 1) ARMORED TRUCK on the move = the headline score. If one's live, tip it.
    const truck = (CBZ.cityArmored && CBZ.cityArmored.active && CBZ.cityArmored.active() && CBZ.cityArmored.truck) ? CBZ.cityArmored.truck() : null;
    if (truck && truck.pos && Math.random() < 0.85) {
      // words, not a map pin: a heading, and it is only as good as the
      // moment he said it, because the truck keeps driving
      say(p, "Armored truck's out. Went " + compassFrom(p.pos.x, p.pos.z, truck.pos.x, truck.pos.z).toLowerCase() + ".", "#bfe0ff", 3.4);
      sfx("blip");
      return;
    }
    // 2) a VIP/celebrity nearby = a name to find (photo, or a fat mark).
    const vip = nearestVipOther(p);
    if (vip && vip.pos) {
      const vd = Math.hypot(vip.pos.x - p.pos.x, vip.pos.z - p.pos.z);
      const who = vip.name || "Somebody with real money";
      say(p, vd < 40 ? (vip.name ? "See that one? That's " + vip.name + "." : "See that one? Real money.")
                     : who + " was around. Up " + compassFrom(p.pos.x, p.pos.z, vip.pos.x, vip.pos.z).toLowerCase() + ".",
          "#bfe0ff", 3);
      sfx("blip");
      return;
    }
    // 3) nothing hot: they still gossip (and warm a touch).
    sayT(p, "gossip", "I don't know nothing.");
  }

  // ---- BUM A SMOKE / ASK FOR A LIGHT (free slot — the smallest icebreaker).
  //      Costs nothing; a friendly local obliges (a sliver of warmth), a cold or
  //      scared one waves you off. Pure flavor with a real, tiny relationship tick.
  function bumSmoke(p) {
    meet(p);
    const warm = bond(p) > -0.1 && !(rel(p) && rel(p).fear > 60);
    if (warm) {
      relShift(p, "greeted", 0.5);
      if (p.mood != null) p.mood = Math.min(1, (p.mood || 0) + 0.15);
      sayT(p, "smokeYes", "Here.");
    } else {
      sayT(p, "smokeNo", "Buy your own.");
    }
    sfx("blip");
  }

  // ---- GIVE THEM A FEW BUCKS (slot J, prio above intimidate, gated on the ped
  //      looking BROKE and on you having the cash). Charity buys genuine
  //      goodwill (the "gift" event) and spreads your name as a soft touch.
  const HANDOUT = 25;
  function looksBroke(p) { return (p.wealth || 0) < 0.25 && !p.robbed; }
  function giveMoney(p) {
    if (!spend(HANDOUT)) return;
    meet(p);
    p.cash = (p.cash | 0) + HANDOUT;       // it's real — into their pocket
    relShift(p, "gift", 1);                // affection + loyalty + respect, ripples to their circle
    if (p.mood != null) p.mood = 1;
    sayT(p, "thanks", "Thank you.");
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(1);   // a public soft touch reads on the street
    sfx("coin");
  }

  // ---- FAN MOMENT (VIP/celebrity only, slot K high prio — REPLACES "talk" for
  //      a name). A photo / autograph: a brush with fame is its own small reward.
  function fanMoment(p) {
    meet(p);
    const photo = Math.random() < 0.5;
    relShift(p, "greeted", 0.6);
    if (p.mood != null) p.mood = Math.min(1, (p.mood || 0) + 0.3);
    sayT(p, "fan", "Make it quick.");
    // a real beat: the VIP stops, turns to you and holds still for the picture
    p._faceT = Math.max(p._faceT || 0, photo ? 1.6 : 1.0);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(2);   // being SEEN with a name buys cred
    sfx("blip");
  }

  // ============================================================
  //  REGISTER — all on the civilian layer. The slot map is chosen against
  //  what interact.js already occupies for a PLAIN STRANGER (Mug=I·10,
  //  Swing=J·10, Talk=K·5, Pickpocket=L·10) and what it leaves free (slot E
  //  is unused by any ped:civ option). The doctrine: a stranger should read
  //  as a PERSON, not a wallet — so we put the headline social verb on the
  //  primary key (E) and keep a malicious option on I and L (the design rule).
  //
  //  Prio coexistence: interact.js's contextual relationship/gang ladder runs
  //  at prio 36..60 on slots I/J/K/L. Every social option here sits BELOW that
  //  band, so on your own crew / a romance / a prospect / a feared mark those
  //  branches win and this fluff steps aside — and on a true stranger (where
  //  that ladder is silent) these are exactly what fills the panel.
  //  Per-slot only the highest passing option shows, so the canShow gates form
  //  a contextual ladder (a VIP's E is a photo; a broke person's E is a hand;
  //  a normal stranger's E is a chat) — the key means the right thing for WHO
  //  you're looking at.
  // ============================================================

  // GRAMMAR LAW (owner): labels are bare verbs — the person's name is the
  // card TITLE, never repeated inside an option.
  // SLOT E (free for a stranger) — the HEADLINE social verb, contextual by who
  // they are: fan-a-VIP > tip-from-a-friend > give-to-the-broke > compliment.
  // Each gate is mutually narrowing so exactly one wins for any given person.
  I.register("ped:civ", {
    id: "rich-e-fan", slot: "e", prio: 24,
    canShow: (p) => isStrangerish(p) && !isYours(p) && isVip(p) && !hatesYou(p),
    label: "Photo",
    onSelect: (p) => fanMoment(p),
  });
  I.register("ped:civ", {
    id: "rich-e-give", slot: "e", prio: 22,
    canShow: (p) => isStrangerish(p) && !isYours(p) && looksBroke(p) && myCash() >= HANDOUT,
    label: () => "Give " + money(HANDOUT) + "",
    onSelect: (p) => giveMoney(p),
  });
  I.register("ped:civ", {
    id: "rich-e-compliment", slot: "e", prio: 20,
    canShow: (p) => isStrangerish(p) && !isYours(p) && !hatesYou(p),
    label: "Compliment",
    onSelect: (p) => compliment(p),
  });

  I.register("ped:civ", {
    id: "rich-e-tip", slot: "e", prio: 26,
    canShow: (p) => isBusker(p) && myCash() >= TIP,
    label: "Tip $" + TIP,
    onSelect: (p) => tipBusker(p),
  });
  // SLOT K, under "Ask around": ask the way. He points; you walk.
  I.register("ped:civ", {
    id: "rich-k-way", slot: "k", prio: 7,
    canShow: (p) => isStrangerish(p) && !isYours(p) && !hatesYou(p) && !isVip(p),
    label: "Ask",
    onSelect: (p) => pointTheWay(p),
  });

  // SLOT K: ask around (gated on the bond), above interact.js's bare "Talk"
  // (prio 5). What you get is a line in their own words, never a map pin.
  I.register("ped:civ", {
    id: "rich-k-lead", slot: "k", prio: 8,
    canShow: (p) => isStrangerish(p) && !isYours(p) && canTip(p),
    label: "Ask around",
    onSelect: (p) => askLead(p),
  });

  // SLOT J — bum a light (always, the cheap icebreaker) vs intimidate (only when
  // you plainly OUT-read them). interact.js's "Swing" is also prio 10 on J; we
  // sit just above it so the social verb leads, but Mug (I) and Pickpocket (L)
  // keep a malicious option on the panel per the doctrine.
  I.register("ped:civ", {
    id: "rich-j-intimidate", slot: "j", prio: 12, bad: true,
    canShow: (p) => isStrangerish(p) && !isYours(p) && readsMeAsSmaller(p) && !isVip(p),
    label: "Threaten",
    onSelect: (p) => intimidate(p),
  });
  I.register("ped:civ", {
    id: "rich-j-smoke", slot: "j", prio: 11,
    canShow: (p) => isStrangerish(p) && !isYours(p) && !readsMeAsSmaller(p),
    label: "Bum one",
    onSelect: (p) => bumSmoke(p),
  });

  // (Slot L stays interact.js's Pickpocket; insult would clobber it, so insult
  //  rides slot J as a HOLD verb on the same key as the tap-light — tap J to ask
  //  for a light, HOLD J to insult — keeping both reachable without a collision.)
  I.register("ped:civ", {
    id: "rich-j-insult", slot: "j", hold: true, prio: 11, bad: true,
    canShow: (p) => isStrangerish(p) && !isYours(p),
    label: "Insult",
    onSelect: (p) => insult(p),
  });
})();
