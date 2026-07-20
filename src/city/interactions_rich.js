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
  const nm = (p) => (p && p.name) || "them";
  function note(msg, secs) { if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, secs == null ? 2 : secs); }
  function say(p, text, color, secs) { if (CBZ.citySay) CBZ.citySay(p, text, color || "#dfe7ff", secs == null ? 2.2 : secs); }
  function relShift(p, kind, amt) { if (CBZ.cityRelShift) try { return CBZ.cityRelShift(p, kind, amt); } catch (e) {} return 0; }
  function rel(p) { return CBZ.cityRel ? CBZ.cityRel(p) : null; }
  function bond(p) { return CBZ.cityBond ? CBZ.cityBond(p) : 0; }
  function meet(p) { if (CBZ.cityMeet) CBZ.cityMeet(p); }       // learn their name
  function lvl(a) { return CBZ.cityLevel ? CBZ.cityLevel(a) : 10; }
  function myLvl() { const P = CBZ.player; return P ? lvl(P) : 10; }
  function sfx(name) { if (CBZ.sfx) CBZ.sfx(name); }

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
  const COMPLIMENTS = [
    "“Love the fit — you wear it well.”",
    "“You've got a good energy about you.”",
    "“Respect. You carry yourself right.”",
    "“That's a clean look, no lie.”",
  ];
  const COMP_BACK = ["“Ha — appreciate that.”", "“Aw, thanks. ”", "“You're alright, you know that?”", "“Means a lot, stranger.”"];
  function compliment(p) {
    meet(p);
    note(COMPLIMENTS[(Math.random() * COMPLIMENTS.length) | 0], 1.8);
    // a small, genuine goodwill nudge — the "flirted" table is mostly affection
    // without the romance commitment; scale it down so a compliment < a date.
    relShift(p, "flirted", 0.4);
    if (p.mood != null) p.mood = Math.min(1, (p.mood || 0) + 0.35);
    say(p, COMP_BACK[(Math.random() * COMP_BACK.length) | 0], "#cdeccd", 2.2);
    sfx("blip");
  }

  // ---- INSULT (slot L, low prio — sits under pickpocket only when nothing
  //      meaner applies). A jab plants a grudge; the person snubs you, and a
  //      bold/armed one may square up. Free to throw, not free to eat.
  const INSULTS = [
    "“Step aside, nobody.”",
    "“You look like bad luck.”",
    "“Who dressed you, the gutter?”",
    "“Get out of my way, clown.”",
  ];
  const INSULT_MEEK = ["“…whatever, man.”", "“Why you gotta be like that?”", "“Jerk.”"];
  const INSULT_BOLD = ["“The HELL you say to me?!”", "“Say that again. I dare you.”", "“You want a problem?!”"];
  function insult(p) {
    meet(p);
    note(INSULTS[(Math.random() * INSULTS.length) | 0], 1.8);
    relShift(p, "snubbed", 1);
    if (p.mood != null) p.mood = Math.max(-1, (p.mood || 0) - 0.5);
    // bold/armed/aggressive marks bristle and confront; the timid just sour and
    // peel off. We bend the existing brain inputs, never invent new state.
    const aggr = p.aggr || 0.3, r = rel(p);
    const bold = p.armed || aggr >= 0.6 || (r && r.respect > r.fear + 15);
    if (bold && CBZ.city && CBZ.city.playerActor) {
      relShift(p, "threatened", 0.5);
      p.rage = CBZ.city.playerActor; p.state = "confront"; p.fear = 0;
      say(p, INSULT_BOLD[(Math.random() * INSULT_BOLD.length) | 0], "#ff8a7a", 2.4);
    } else {
      // they sour and walk off the other way
      p.pause = 0; p.path = null;
      if (p.target && p.pos) p.target.set(p.pos.x + (Math.random() - 0.5) * 6, 0, p.pos.z - 5);
      say(p, INSULT_MEEK[(Math.random() * INSULT_MEEK.length) | 0], "#cfd6e6", 2.2);
    }
    sfx("blip");
  }

  // ---- SIZE UP / INTIMIDATE (slot J for a plain civilian — sits below the
  //      gang/crew J verbs by prio). You can only lean on someone you plainly
  //      OUT-read; trying it on a bigger name backfires (you look small). Fear
  //      is durable leverage: a feared mark folds to a shakedown later.
  const MENACE = ["“Don't make me ask twice.”", "“You're in my way. Fix that.”", "“I'd watch myself around me.”", "“Remember this face.”"];
  function intimidate(p) {
    meet(p);
    if (readsMeAsBigger(p)) {
      // they outrank you — the threat lands flat. A real reaction, not a toast:
      // they scoff, your respect with them takes a small ding for overreaching.
      note("“Cute.” " + nm(p) + " isn't impressed.", 2);
      say(p, "“…run along.”", "#dfe7ff", 2);
      const r = rel(p); if (r) r.respect = Math.max(0, r.respect - 3);
      return;
    }
    note(MENACE[(Math.random() * MENACE.length) | 0], 1.8);
    relShift(p, "intimidated", readsMeAsSmaller(p) ? 1.3 : 1);   // a big gap lands harder
    p.alarmed = Math.max(p.alarmed || 0, 4);
    p.fear = Math.min(10, (p.fear || 0) + 3);
    say(p, ["", "“O-okay, okay…”", "“I don't want trouble.”"][(Math.random() * 3) | 0], "#ffd1c4", 2.2);
    sfx("blip");
  }

  // ---- ASK FOR DIRECTIONS (slot K, prio just under talk so it shows for a
  //      stranger). A local points you at the nearest useful counter and drops
  //      a WAYPOINT — a genuine service. Asking politely warms them a touch.
  function shopLots() {
    const A = CBZ.city && CBZ.city.arena;
    return (A && (A.shopLots || A.lots)) || [];
  }
  // pick a nearby storefront the player might actually want, with its verb-name.
  function nearestUsefulLot(px, pz) {
    const lots = shopLots();
    let best = null, bd = Infinity;
    for (const l of lots) {
      const b = l && l.building; if (!b || !b.door) continue;
      const kind = l.kind || b.kind || "";
      if (!kind) continue;
      const cx = l.cx != null ? l.cx : b.door.x, cz = l.cz != null ? l.cz : b.door.z;
      const d = Math.hypot(px - cx, pz - cz);
      if (d < 8) continue;                 // don't point at the one you're standing on
      if (d < bd) { bd = d; best = { lot: l, kind, x: b.door.x, z: b.door.z, d }; }
    }
    return best;
  }
  function shopLabel(kind) {
    const v = CBZ.cityShopVerb ? CBZ.cityShopVerb(kind) : null;
    if (v && v.sub) return kind + " (" + v.sub.split("·")[0].trim() + ")";
    return kind;
  }
  function askDirections(p) {
    meet(p);
    const P = CBZ.player;
    const tgt = nearestUsefulLot(P.pos.x, P.pos.z);
    if (!tgt) { note("“Honestly? Couldn't tell you. New here too.”", 2.2); relShift(p, "greeted", 0.4); return; }
    const dir = compassFrom(P.pos.x, P.pos.z, tgt.x, tgt.z);
    const label = shopLabel(tgt.kind);
    note("“" + cap(label) + "? " + dir + ", not far. Marked it for you.”", 3);
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(tgt.x, tgt.z, cap(tgt.kind));
    relShift(p, "greeted", 0.6);          // a helpful exchange = a little warmth
    if (p.mood != null) p.mood = Math.min(1, (p.mood || 0) + 0.2);
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
      note("“Word is an armored truck's rolling. You didn't hear it from me.”", 3.2);
      say(p, "", "#bfe0ff", 1.8);
      if (CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(truck.pos.x, truck.pos.z, "ARMORED TRUCK");
      sfx("blip");
      return;
    }
    // 2) a VIP/celebrity nearby = a name to find (photo, or a fat mark).
    const vip = nearestVipOther(p);
    if (vip && vip.pos) {
      note("“See that one? That's " + (vip.name || vipTitle(vip)) + " — a real somebody. They're around.”", 3.2);
      if (CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(vip.pos.x, vip.pos.z, vipTitle(vip));
      if (CBZ.cityMarkTarget) try { CBZ.cityMarkTarget(vip); } catch (e) {}
      sfx("blip");
      return;
    }
    // 3) nothing hot — they still gossip about YOU (and warm a touch).
    const lines = [
      "“Quiet out here today. Stay sharp.”",
      "“Cops have been thick around the blocks lately.”",
      "“Money's out there if you know where to look.”",
      "“People talk about you, you know.”",
    ];
    note("“" + lines[(Math.random() * lines.length) | 0].replace(/^"|"$/g, "") + "”", 2.6);
    say(p, "", "#cdeccd", 1.6);
  }

  // ---- BUM A SMOKE / ASK FOR A LIGHT (free slot — the smallest icebreaker).
  //      Costs nothing; a friendly local obliges (a sliver of warmth), a cold or
  //      scared one waves you off. Pure flavor with a real, tiny relationship tick.
  function bumSmoke(p) {
    meet(p);
    const warm = bond(p) > -0.1 && !(rel(p) && rel(p).fear > 60);
    if (warm) {
      note("“Here.” " + nm(p) + " flicks you a light.", 2);
      relShift(p, "greeted", 0.5);
      if (p.mood != null) p.mood = Math.min(1, (p.mood || 0) + 0.15);
      say(p, "", "#dfe7ff", 1.8);
    } else {
      note("“Buy your own.” " + nm(p) + " waves you off.", 2);
      say(p, "", "#cfd6e6", 1.8);
    }
    sfx("blip");
  }

  // ---- GIVE THEM A FEW BUCKS (slot J, prio above intimidate, gated on the ped
  //      looking BROKE and on you having the cash). Charity buys genuine
  //      goodwill (the "gift" event) and spreads your name as a soft touch.
  const HANDOUT = 25;
  function looksBroke(p) { return (p.wealth || 0) < 0.25 && !p.robbed; }
  function giveMoney(p) {
    if (!spend(HANDOUT)) { note("You're tapped out — nothing to give.", 1.8); return; }
    meet(p);
    p.cash = (p.cash | 0) + HANDOUT;       // it's real — into their pocket
    note("You slip " + nm(p) + " " + money(HANDOUT) + ". They light up.", 2.4);
    relShift(p, "gift", 1);                // affection + loyalty + respect, ripples to their circle
    if (p.mood != null) p.mood = 1;
    say(p, ["“God bless you.”", "“You're a real one. ”", "“I won't forget this.”"][(Math.random() * 3) | 0], "#cdeccd", 2.4);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(1);   // a public soft touch reads on the street
    sfx("coin");
  }

  // ---- FAN MOMENT (VIP/celebrity only, slot K high prio — REPLACES "talk" for
  //      a name). A photo / autograph: a brush with fame is its own small reward.
  function fanMoment(p) {
    meet(p);
    const photo = Math.random() < 0.5;
    if (photo) note("You grab a photo with " + (p.name || vipTitle(p)) + " — that's one for the story.", 2.6);
    else note("" + (p.name || vipTitle(p)) + " signs an autograph for you.", 2.6);
    relShift(p, "greeted", 0.6);
    if (p.mood != null) p.mood = Math.min(1, (p.mood || 0) + 0.3);
    say(p, photo ? "" : "“Stay classy.”", "#ffe9a8", 2.2);
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
    label: "Take a photo",
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

  // SLOT K — ask for information: a lead (gated on the bond) outranks plain
  // directions, both above interact.js's bare "Talk" (prio 5) so a stranger's
  // K becomes useful instead of a dead line.
  I.register("ped:civ", {
    id: "rich-k-lead", slot: "k", prio: 8,
    canShow: (p) => isStrangerish(p) && !isYours(p) && canTip(p),
    label: "Ask around",
    onSelect: (p) => askLead(p),
  });
  I.register("ped:civ", {
    id: "rich-k-directions", slot: "k", prio: 7,
    canShow: (p) => isStrangerish(p) && !isYours(p) && !hatesYou(p),
    label: "Ask directions",
    onSelect: (p) => askDirections(p),
  });

  // SLOT J — bum a light (always, the cheap icebreaker) vs intimidate (only when
  // you plainly OUT-read them). interact.js's "Swing" is also prio 10 on J; we
  // sit just above it so the social verb leads, but Mug (I) and Pickpocket (L)
  // keep a malicious option on the panel per the doctrine.
  I.register("ped:civ", {
    id: "rich-j-intimidate", slot: "j", prio: 12, bad: true,
    canShow: (p) => isStrangerish(p) && !isYours(p) && readsMeAsSmaller(p) && !isVip(p),
    label: "Intimidate",
    onSelect: (p) => intimidate(p),
  });
  I.register("ped:civ", {
    id: "rich-j-smoke", slot: "j", prio: 11,
    canShow: (p) => isStrangerish(p) && !isYours(p) && !readsMeAsSmaller(p),
    label: "Ask a light",
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
