/* ============================================================
   president/holler.js — WHAT PEOPLE SAY, READ OFF WHAT HAPPENED.

   Gang City's Holler (city/phone_apps.js) was the right idea in the wrong
   place: a feed that wrote posts about the city's bus and moved nothing.
   Here the feed is the voice of the one world model: every post is read
   off a real event in S.log or a real number in the state (the price at the
   pump, the yield, the war, the crackdown), and the HEAT that decides how
   loud each topic is lives in the model itself (world.js hollerDay), where
   it moves approval, the street and what other governments think of you.

   Posting is a decision: options() hands back the posts a president can make
   right now, and each one is a world action ({type:"post", v}) with real
   effects. Lines are a few words a real person would say, from the real
   situation. No narration, no tutorials, no mechanics explained.

   Pure: no THREE, no DOM. Deterministic (hashes, never Math.random), so
   every player in a room reads the same feed.

   PUBLIC  CBZ.presHoller = { feed(S, me, n), options(S, me), line(S, me, m),
     messages(S, me, n), said(S, me, ev), cname(S, id), leader(S, id), surname }
============================================================ */
(function (root) {
  "use strict";
  const G = (typeof window !== "undefined" && window) || root;
  const CBZ = G.CBZ = G.CBZ || {};

  function h(a, b) {
    let x = (a * 2654435761 ^ b * 40503) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0;
    return (x ^ (x >>> 13)) >>> 0;
  }
  function pick(arr, seed) { return arr[seed % arr.length]; }
  function cname(S, id) { const c = S.c[id]; return c ? c.name : "?"; }
  function surname(n) { const a = String(n || "").split(" "); return a[a.length - 1]; }
  function leader(S, id) { const c = S.c[id]; return c ? c.leader.name : "?"; }
  function pname(S, pid) { const p = S.p[pid]; return p ? p.name : "?"; }
  function goodName(id) { const W = CBZ.presWorld, g = W && W.GOODS[W.GI[id]]; return g ? g.name.toLowerCase() : id === "all" ? "goods" : id; }
  const FIRST = ["Dana", "Marco", "Keisha", "Tomas", "Priya", "Jakob", "Lucia", "Andre", "Mei", "Sami", "Rosa", "Ilya", "Noor", "Femi", "Ana", "Bo"];
  const LAST = ["Reyes", "Novak", "Grant", "Okafor", "Lind", "Haas", "Moreno", "Clarke", "Duarte", "Sato", "Kale", "Brooks", "Varga", "Osei"];
  function citizen(seed) {
    const f = FIRST[seed % FIRST.length], l = LAST[(seed >>> 5) % LAST.length];
    return { who: f + " " + l, handle: "@" + (f + l.slice(0, 3)).toLowerCase() + (seed % 97), kind: "citizen" };
  }
  function press(S, cid) { return { who: (cid != null ? cname(S, cid) : "World") + " News", handle: "@" + (cid != null ? cname(S, cid).toLowerCase() : "world") + "news", kind: "press" }; }
  function gov(S, cid) { return { who: leader(S, cid), handle: "@" + cname(S, cid).toLowerCase() + "gov", kind: "leader", cid: cid }; }

  /* ---- the feed: the newest real things, in the voices that would post them */
  function postsFor(S, me, e, i) {
    const out = [];
    const s = h(i + 1, e.d + 7);
    const mine = e.c === me, aboutMe = e.t === me;
    const P = function (author, text) { out.push({ who: author.who, handle: author.handle, kind: author.kind, cid: author.cid, text: text, d: e.d }); };
    switch (e.k) {
      case "war":
        P(press(S, null), cname(S, e.c) + " declares war on " + cname(S, e.t) + ".");
        if (mine) P(citizen(s), pick(["Not in my name.", "About time.", "My brother ships out Monday.", "Here we go."], s));
        if (aboutMe) P(citizen(s), pick(["They attacked us. Stay inside tonight.", "Sirens all night.", "Where is the army?"], s));
        break;
      case "strike":
        P(press(S, e.t), "Air strike on " + pname(S, e.p) + (e.lost ? ". " + e.lost + " of " + e.wing + " attackers shot down." : "."));
        if (e.t === me) P(citizen(s), pick(["Heard the jets over " + pname(S, e.p) + ". Windows shook.", "Smoke over " + pname(S, e.p) + ". Is everyone ok?", "No power in " + pname(S, e.p) + " since the planes."], s));
        if (mine && e.lost) P(citizen(s), pick(["We lost " + e.lost + " planes. For what?", "Pilots' families deserve answers."], s));
        break;
      case "nuke":
        P(press(S, null), e.stopped ? "A nuclear missile aimed at " + pname(S, e.p) + " did not detonate." : "Nuclear detonation over " + pname(S, e.p) + ".");
        P(citizen(s), e.stopped ? "We were seconds away." : pick(["I can see it from here.", "Pray for " + pname(S, e.p) + ".", "This is the end of something."], s));
        break;
      case "took":
        P(press(S, e.c), cname(S, e.c) + " forces take " + pname(S, e.p) + ".");
        if (e.from === me) P(citizen(s), pick(["They're in " + pname(S, e.p) + ".", "My family is in " + pname(S, e.p) + "."], s));
        break;
      case "peace": P(press(S, null), cname(S, e.c) + " and " + cname(S, e.t) + " stop fighting."); if (mine || aboutMe) P(citizen(s), "Thank God."); break;
      case "capitulated": P(press(S, null), cname(S, e.c) + " surrenders to " + cname(S, e.to) + "."); break;
      case "annexed":
        P(press(S, null), cname(S, e.c) + " annexes " + cname(S, e.t) + ".");
        if (mine) P(citizen(s), pick(["One flag over all of it now.", "How many more?", "My cousin lives there. He's one of us now, I guess."], s));
        break;
      case "puppet": P(press(S, null), cname(S, e.t) + " now takes its orders from " + cname(S, e.c) + "."); break;
      case "free": P(press(S, null), cname(S, e.c) + " is its own country again."); break;
      case "tariff":
        if (e.v > 0) P(press(S, e.c), cname(S, e.c) + " puts " + Math.round(e.v * 100) + "% on " + cname(S, e.t) + " " + goodName(e.good) + ".");
        else P(press(S, e.c), cname(S, e.c) + " lifts its " + goodName(e.good) + " tariff on " + cname(S, e.t) + ".");
        if (aboutMe && e.v > 0) P(citizen(s), pick(["There go the jobs at the plant.", "So we pay more. Great."], s));
        if (mine && e.v > 0) P(citizen(s), pick(["Good. Make them pay.", "Who do you think pays a tariff?"], s));
        break;
      case "sanction": P(press(S, e.c), cname(S, e.c) + " sanctions " + cname(S, e.t) + "."); break;
      case "unsanction": P(press(S, e.c), cname(S, e.c) + " lifts sanctions on " + cname(S, e.t) + "."); break;
      case "embargo": P(press(S, e.c), cname(S, e.c) + " stops " + goodName(e.good) + " shipments to " + cname(S, e.t) + "."); break;
      case "deal": P(press(S, e.c), cname(S, e.c) + " and " + cname(S, e.t) + " sign a trade deal."); break;
      case "allied": P(press(S, e.c), cname(S, e.c) + " and " + cname(S, e.t) + " sign a defense pact."); break;
      case "abandon": P(press(S, e.c), cname(S, e.c) + " walks out of its pact with " + cname(S, e.t) + "."); break;
      case "bailout": P(press(S, null), cname(S, e.c) + " lends " + cname(S, e.t) + " $" + e.amt + "bn" + (e.strings === "bases" ? ", in return for bases." : e.strings === "alliance" ? ", in return for a pact." : e.strings === "trade" ? ", in return for open markets." : ".")); break;
      case "betrayed": P(press(S, null), cname(S, e.c) + " walks away from $" + e.amt + "bn it owes " + cname(S, e.t) + "."); break;
      case "crisis": P(press(S, e.c), "Bond auction fails. " + cname(S, e.c) + " ten-year at " + e.y + "%."); if (mine) P(citizen(s), "My pension is in those bonds."); break;
      case "default": P(press(S, e.c), cname(S, e.c) + " defaults on its debt."); if (mine) P(citizen(s), pick(["The bank won't let me withdraw.", "Lines at every ATM."], s)); break;
      case "print": if (mine && e.v > 0) P(citizen(s), pick(["Bread went up again.", "My savings are worth less every week."], s)); break;
      case "bankFired": P(press(S, e.c), "Central bank governor fired in " + cname(S, e.c) + ". Markets fall."); break;
      case "fall": {
        const why = { election: "loses the election", coup: "is overthrown by the army", assassinated: "is assassinated", revolution: "is driven out by the street", capitulated: "falls with the surrender", resigned: "resigns", annexed: "loses the country" }[e.why] || "is out";
        P(press(S, null), e.name + " " + why + " in " + cname(S, e.c) + ".");
        if (mine && e.why === "election") P(citizen(s), "Finally.");
        break;
      }
      case "reelected": P(press(S, e.c), leader(S, e.c) + " wins another term in " + cname(S, e.c) + " with " + e.share + "%."); break;
      case "crackdown": P(press(S, e.c), "Police clear the streets in " + cname(S, e.c) + "."); if (mine) P(citizen(s), pick(["Gas on our street. Kids inside.", "They beat a man in front of the bakery.", "Good. Order."], s)); break;
      case "troops": if (mine) P(citizen(s), "Soldiers on the corner. Not police. Soldiers."); break;
      case "martial": P(press(S, e.c), e.on ? "Martial law in " + cname(S, e.c) + "." : "Martial law lifted in " + cname(S, e.c) + "."); if (mine && e.on) P(citizen(s), "Curfew at eight. Tanks on the bridge."); break;
      case "postponed": P(press(S, e.c), cname(S, e.c) + " postpones its election."); if (mine) P(citizen(s), pick(["They're afraid of us.", "So much for voting."], s)); break;
      case "cancelled": P(press(S, e.c), cname(S, e.c) + " cancels elections."); if (mine) P(citizen(s), "That's it then. That's the country now."); break;
      case "restored": P(press(S, e.c), cname(S, e.c) + " will hold elections again."); break;
      case "freePress": if (mine) P(press(S, e.c), "The press law is gone."); break;
      case "leak": if (mine) { P(press(S, me), "Leaked from inside the cabinet: the " + roleWord(e.role) + " says the President ignores him."); P(citizen(s), pick(["Even his own people.", "Who leaked it is the real story."], s)); } break;
      case "resigned": if (mine) P(press(S, me), "The " + roleWord(e.role) + ", " + e.name + ", resigns."); break;
      case "fired": if (mine) P(press(S, me), "The President fires the " + roleWord(e.role) + ", " + e.name + "."); break;
      case "refused": if (mine && (e.role === "general" || e.role === "security")) P(press(S, me), "Reports the " + roleWord(e.role) + " refused an order."); break;
      case "killed": P(press(S, null), leader(S, e.t) + " of " + cname(S, e.t) + " killed." + (e.caught ? " " + cname(S, e.c) + " is blamed." : "")); break;
      case "plotFailed": P(press(S, null), "Attempt on " + e.name + "'s life fails." + (e.caught ? " The trail leads to " + cname(S, e.c) + "." : "")); break;
      case "coalition": P(press(S, null), "Governments line up against " + cname(S, e.c) + "."); break;
      case "coupFailed": P(press(S, e.c), "Coup attempt fails in " + cname(S, e.c) + "."); break;
      case "plotFoiled": if (mine) P(press(S, me), "Security chief " + e.name + " arrested."); break;
      case "program": P(press(S, null), cname(S, e.c) + " restarts its nuclear program."); break;
      case "bomb": P(press(S, null), cname(S, e.c) + " has the bomb."); break;
      case "incident": {
        const what = ["a border shooting", "a spy ring", "a seized ship", "a shot-down drone"][e.kind | 0] || "an incident";
        P(press(S, null), cname(S, e.c) + " and " + cname(S, e.t) + " trade blame over " + what + ".");
        break;
      }
      case "broken": if (mine) P(citizen(s), "He said prices would come down. Look at this receipt."); break;
      case "kept": if (mine) P(citizen(s), "Gas is cheaper. Fine. He did it."); break;
      case "backedDown": P(press(S, e.c), cname(S, e.c) + " backs down to " + cname(S, e.t) + "."); break;
      case "post": {
        const L = gov(S, e.c);
        const t = e.t != null ? cname(S, e.t) : "";
        const text = { calm: "Stay calm. We have this.", blame: "Prices are " + t + "'s doing.", threaten: t + " will regret this.", promise: "Prices will be down by summer.", deny: "That story is false.", enemies: "The press lies to you.", victory: "We are winning." }[e.v];
        if (text) P(L, text);
        break;
      }
    }
    return out;
  }
  function roleWord(r) { return { general: "General", treasury: "Treasury Secretary", bank: "central bank governor", trade: "trade representative", security: "security chief" }[r] || r; }
  // relevance: what is about you, your enemies, the big powers; the rest is noise
  function relevant(S, me, e) {
    if (e.c === me || e.t === me || e.from === me || e.to === me) return true;
    const c = S.c[me];
    if (!c) return true;
    if (["war", "nuke", "fall", "capitulated", "bomb", "coalition", "default", "killed", "plotFailed"].indexOf(e.k) >= 0) return true;
    if (c.war.indexOf(e.c) >= 0 || c.war.indexOf(e.t) >= 0) return true;
    if (c.allies.indexOf(e.c) >= 0) return e.k !== "post";
    return e.k === "strike" || e.k === "took" || e.k === "sanction";
  }
  // what the street is saying about the numbers right now
  function moodPosts(S, me) {
    const c = S.c[me]; if (!c) return [];
    const out = [], W = CBZ.presWorld, H = c.heat, d = S.day, s = h(d >> 3, me + 3);
    const P = function (text) { const a = citizen(h(s, out.length + 11)); out.push({ who: a.who, handle: a.handle, kind: "citizen", text: text, d: d }); };
    if (H.prices > 4) P(pick(["$" + (c.pl[W.GI.fuel] / 42).toFixed(2) + " a litre. I'm walking.", "Groceries were " + Math.round(c.infl) + "% more than last year.", "Rent, food, gas. Pick two."], s));
    if (c.u > 9) P(pick(["Plant closed. 400 of us.", Math.round(c.u) + "% out of work and they talk about the stock market."], s));
    if (H.war > 4) P(pick(["How many more?", "Bring them home."], s));
    if (H.crackdown > 8) P(pick(["Said one word at the protest. Lost my job.", "We're not afraid of you."], s));
    if (H.scandal > 8) P(pick(["Every week a new leak.", "Resign."], s));
    if (H.pride > 6) P(pick(["Proud of this country today.", "Flags on every house on my street."], s));
    if (c.fx < 0.7) P(pick(["Our money buys half what it did.", "Shops want cash up front now."], s));
    if (!out.length && c.approval > 55) P(pick(["Quiet week. Good.", "Say what you want, the trains run."], s));
    return out;
  }
  function feed(S, me, n) {
    n = n || 14;
    const out = [];
    const log = S.log;
    for (let i = log.length - 1; i >= 0 && out.length < n * 2; i--) {
      const e = log[i];
      if (S.day - e.d > 200) break;
      if (!relevant(S, me, e)) continue;
      const ps = postsFor(S, me, e, i);
      for (let k = ps.length - 1; k >= 0; k--) out.push(ps[k]);
    }
    const mood = moodPosts(S, me);
    // the street's voice sits near the top: it is about today
    const res = out.slice(0, 2).concat(mood).concat(out.slice(2));
    return res.slice(0, n);
  }

  /* ---- posting: the decisions on offer now ---- */
  function enemyOf(S, me) {
    const c = S.c[me];
    if (c.war.length) return c.war[0];
    let worst = -1, wv = 1e9;
    for (const o of S.c) if (o.alive && o.id !== me && S.rel[me][o.id] < wv) { wv = S.rel[me][o.id]; worst = o.id; }
    return worst;
  }
  function blameOf(S, me) {
    const c = S.c[me];
    for (const o of S.c) if (o.alive && o.id !== me && o.tariffs[me]) return o.id;
    return enemyOf(S, me);
  }
  function options(S, me) {
    const c = S.c[me];
    if (!c) return [];
    const e = enemyOf(S, me), b = blameOf(S, me);
    const out = [
      { label: "Call for calm", act: { type: "post", v: "calm" } },
      { label: "Blame " + cname(S, b) + " for prices", act: { type: "post", v: "blame", t: b } },
      { label: "Threaten " + cname(S, e), act: { type: "post", v: "threaten", t: e } },
      { label: "Promise lower prices", act: { type: "post", v: "promise" } },
      { label: "Deny the story", act: { type: "post", v: "deny" } },
      { label: "Attack the press", act: { type: "post", v: "enemies" } },
      { label: "Claim victory", act: { type: "post", v: "victory" } },
    ];
    return out;
  }

  /* ---- the person who brings a matter: a few words, from the facts ---- */
  function line(S, me, m) {
    const d = m.data || {}, c = S.c[me], W = CBZ.presWorld;
    const t = d.t != null ? cname(S, d.t) : "";
    switch (m.kind) {
      case "yields": return d.crisis ? "Nobody bought our bonds today. Not one bank." : "The ten-year is at " + d.y + ". They want to see cuts.";
      case "rates": return d.up ? "Inflation is " + d.infl + ". I'm raising rates." : "The economy is stalling. I want to cut.";
      case "tariffed": return t + " just put " + Math.round(d.rate * 100) + "% on our " + goodName(d.good) + ".";
      case "opening": { const T = S.c[d.t]; return t + " has " + Math.round(T.div) + " divisions. We have " + Math.round(c.div) + ". We can take them."; }
      case "target": return pname(S, d.p) + (d.what === "oil" ? " pumps their oil." : " is their industry.") + " Give me the word.";
      case "unrest": return "There are crowds in " + d.city + ". They're not going home.";
      case "polls": return "We're at " + d.share + ". The vote is in " + d.days + " days.";
      case "warning": return d.name + " has been meeting colonels at night.";
      case "callToArms": return cname(S, d.enemy) + " attacked " + cname(S, d.friend) + ". We signed a treaty.";
      case "offer": return d.kind === "deal" ? "Let's take the tariffs off each other." : d.kind === "alliance" ? "We should stand together." : "Enough. Let's end this.";
      case "bailoutOffer": return "We can cover $" + d.amt + " billion." + (d.strings === "bases" ? " You host our bases." : d.strings === "alliance" ? " You stand with us." : d.strings === "trade" ? " Your markets open to us." : "");
      case "bailoutAsk": return "The markets have shut us out. We need $" + d.amt + " billion.";
      case "ultimatum": return "Lift what you put on us. You have two weeks.";
      case "surrender": return "We surrender. The country is yours.";
      case "demand": return "It is over. Surrender.";
      case "coup": return "It's over, sir. Sign it and you walk out of here.";
      case "traitor": return "Sign the resignation, sir. Now.";
      case "bill": return d.name + ". It passed " + d.yes + " to " + d.no + ".";
      default: return "";
    }
  }
  // what a cabinet member says if you just look at him: his own read of things
  function standing(S, me, role) {
    const c = S.c[me], m = c.cab[role], W = CBZ.presWorld;
    if (!m) return "";
    if (m.loyalty < 20) return pick(["Sir.", "Is there something you need?", "I have work to do."], h(S.day >> 4, role.length));
    switch (role) {
      case "general": return c.war.length ? (c.gained >= c.lost ? "We're moving. Keep the fuel coming." : "We're losing ground. I need more.") : c.armyPower > 60 ? "The men are restless, sir." : "The army is ready when you are.";
      case "treasury": return c.yld > 8 ? "The ten-year is " + c.yld.toFixed(1) + ". This can't go on." : -c.deficit / c.gdp * 100 > 5 ? "We're borrowing " + (-c.deficit / c.gdp * 100).toFixed(1) + "% of GDP." : "The books are fine. For now.";
      case "bank": return c.print > 0 ? "Stop printing. I mean it." : c.infl > 5 ? "Inflation is " + c.infl.toFixed(1) + ". I'll do what I have to." : "Prices are steady.";
      case "trade": { let worst = null; for (const o of S.c) if (o.alive && o.tariffs[me]) { worst = o; break; } return worst ? worst.name + " is squeezing our exports." : c.sanctions.length ? "Every sanction costs us too." : "Trade is moving."; }
      case "security": return c.unrest > 50 ? "The street is angry." : c.heat.plot > 10 ? "Everyone knows. We need to get ahead of it." : "Nothing I can't handle.";
    }
    return "";
  }
  // what is said back when an order runs into a person
  function said(S, me, ev) {
    if (ev.k === "refused") return { general: "No. Not this war.", security: "I won't do that.", bank: "The bank is independent, sir." }[ev.role] || "No.";
    if (ev.k === "strike" && ev.c === me) return ev.lost ? "We lost " + ev.lost + ". The rest got through." : "Target hit.";
    return "";
  }

  /* ---- texts: the people who write rather than walk in ---- */
  function messages(S, me, n) {
    n = n || 12;
    const out = [], c = S.c[me];
    for (let i = S.log.length - 1; i >= 0 && out.length < n; i--) {
      const e = S.log[i];
      if (S.day - e.d > 240) break;
      let from = null, text = null;
      if (e.k === "strike" && e.c === me) { from = c.cab.general.name; text = (e.hit > 0 ? "Hit " + pname(S, e.p) + "." : "Missed " + pname(S, e.p) + ".") + (e.lost ? " Lost " + e.lost + "." : ""); }
      else if (e.k === "strike" && e.t === me) { from = c.cab.general.name; text = pname(S, e.p) + " was hit. Damage is bad."; }
      else if (e.k === "took" && e.c === me) { from = c.cab.general.name; text = "We hold " + pname(S, e.p) + "."; }
      else if (e.k === "took" && e.from === me) { from = c.cab.general.name; text = "We lost " + pname(S, e.p) + "."; }
      else if (e.k === "crisis" && e.c === me) { from = c.cab.treasury.name; text = "Auction failed. " + e.y + "%."; }
      else if (e.k === "refusedOffer" && e.t === me) { from = leader(S, e.c); text = "No."; }
      else if (e.k === "refusedOffer" && e.c === me) { continue; }
      else if (e.k === "deal" && (e.c === me || e.t === me)) { from = c.cab.trade.name; text = "Deal signed with " + cname(S, e.c === me ? e.t : e.c) + "."; }
      else if (e.k === "allied" && (e.c === me || e.t === me)) { from = leader(S, e.c === me ? e.t : e.c); text = "We stand with you."; }
      else if (e.k === "incident" && (e.c === me || e.t === me)) { from = c.cab.security.name; text = "Trouble with " + cname(S, e.c === me ? e.t : e.c) + ". It's in the papers tomorrow."; }
      else if (e.k === "war" && e.t === me) { from = c.cab.general.name; text = cname(S, e.c) + " is coming across."; }
      else if (e.k === "plotFailed" && e.c === me) { from = c.cab.security.name; text = e.caught ? "It failed. They know it was us." : "It failed. They don't know."; }
      else if (e.k === "killed" && e.c === me) { from = c.cab.security.name; text = "Done." + (e.caught ? " They know it was us." : ""); }
      else if (e.k === "leak" && e.c === me) { from = c.cab.security.name; text = "The leak came from the " + roleWord(e.role) + "'s office."; }
      else if (e.k === "betrayed" && e.t === me) { from = c.cab.treasury.name; text = cname(S, e.c) + " stopped paying us."; }
      if (from && text) out.push({ from: from, text: text, d: e.d });
    }
    return out;
  }

  const API = { feed: feed, options: options, line: line, standing: standing, said: said, messages: messages, cname: cname, leader: leader, surname: surname, pname: pname, goodName: goodName, roleWord: roleWord };
  CBZ.presHoller = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
