/* ============================================================
   warlord/match.js — THE RULES OF THE MATCH.

   The brief, verbatim: "Ultra simple mechanics right? Made for multiplayer,
   it's almost like openfront.io met Bannerlord once it's multiplayer."

   So this is not a singleplayer game with multiplayer bolted on. It is a
   real-time shared-map conquest match — eight warlords, one island, one
   clock — whose battles happen to be the repo's real 3D fights with real men
   and real guns. This file owns everything that makes that a MATCH and not a
   sandbox: the lobby, who is in it, where they start, the clock, the two
   diplomacy buttons, who wins, and the screen you screenshot afterwards.

   WHAT IT DOES NOT OWN, and must never grow a second copy of:
     · warnet.js is TRANSPORT — sockets, host election, send/recv.
     · territory.js is THE BOARD — regions from the seed, ownership, the map.
     · battle.js is THE FIGHT — start() renders it, resolve() decides it.
   Every call into those three is guarded, because ten agents are writing
   this game at once and a match that cannot boot without all of them is a
   match nobody can test.

   ── THE ONE RULE ───────────────────────────────────────────────────────
   THE CLOCK NEVER PAUSES. Not for a battle, not for an open menu, not for a
   disconnected player. Everything else in this file falls out of that, so it
   is worth saying exactly how it is implemented and why the obvious version
   is wrong.

   The obvious version is an accumulator: `t += dt` every frame. It is wrong
   here in three separate ways, all measurable in this browser:

     · rAF is throttled to roughly 1 Hz in a hidden tab and stops outright on
       a backgrounded phone. A player who checks a message loses the war and
       does not know it.
     · a 90-second 3D battle is 90 seconds the campaign frame is not running.
       The accumulator would be 90 seconds behind on ONE machine.
     · a late joiner would have to be handed a number and then keep it in
       step forever, which is a second clock pretending to be the first.

   So the clock is WALL TIME: `matchT = (Date.now() - T0) / 1000`, where T0 is
   this machine's local-epoch estimate of the instant the match started. There
   is no accumulator to fall behind, nothing to catch up, and no history to
   replay: a client that has been asleep for four minutes wakes up knowing it
   is four minutes later. T0 arrives once from the sim host and is then eased
   toward the host's opinion (EMA, `SKEW_EASE`) so two machines converge
   instead of stepping. One-way relay latency is tens of milliseconds against
   a twenty-minute match — below the resolution of anything this file decides.

   The consequence for every tick-driven rule (income, AI, victory) is that
   NOTHING may be written as "per tick". Everything integrates over
   `matchT() - lastT`, so a tick that arrives late does the work of the ticks
   that did not arrive. That is the whole reason a throttled tab is survivable.

   ── BATTLES INSIDE A LIVE WORLD ────────────────────────────────────────
   The hard problem, and the reasoning is long enough to have its own section
   at THE BATTLE RULE below. The short form: one battle has exactly one owner,
   nothing about a battle's outcome ever travels on the wire, and every battle
   has a hard deadline after which every client independently computes the
   same ending. See that section for the alternative that was rejected.

   ── ULTRA SIMPLE MECHANICS ─────────────────────────────────────────────
   The entire player action set is two taps:
       tap a region  → ATTACK  (send half your men)
       tap a warlord → ALLY / BREAK
   There is no gold in a match, no slider, no supply line, no treaty screen.
   MEN are the only currency: regions make them, attacks spend them. That is
   openfront's troop bar and Bannerlord's army in the same number.

   ── DETERMINISM ────────────────────────────────────────────────────────
   THIS FILE NEVER CALLS W.rnd(). Core's RNG is one shared stream and every
   client must stay on the same step of it; a match that consumed it would
   silently change every band campaign.js spawns afterwards. Everything random
   here goes through W.hash01(a,b,salt), which is pure and positional, so two
   clients that have never exchanged a packet still agree.

   ── EVENTS ─────────────────────────────────────────────────────────────
   match:start match:tick match:claim match:attack match:battle match:ally
   match:break match:eliminated match:over

   ── WIRE (ordinary warnet/net `ev` verbs, all prefixed wlm) ─────────────
   wlmhello {wl}                 who I am
   wlmstart {seed,len,slots,t}   the host opens the match
   wlmsync  {t,own,men,ally}     the host's 3 s authoritative snapshot
   wlmatk   {id,wid,rid,men,at}  an attack ORDER (never a result)
   wlmres   {id,win,al,dl}       the battle owner's result, once
   wlmally  {to} wlmallyok {to} wlmbreak {to}
   wlmend   {win,why}

   ── FLAGS ──────────────────────────────────────────────────────────────
   ?match=1        open the lobby at boot
   ?match=demo     a running match with AI warlords and a plausible board
   ?match=old      REVERT: this whole file is inert, MULTIPLAYER falls back
                   to warnet's own peer list. Single player is unaffected
                   either way — nothing below runs until a match starts.
   ?matchlen=N     match length in minutes (default 20)
   ?matchclock=tick  REVERT: the naive accumulator clock, for A/B measuring
   ?matchai=N      AI warlords to fill empty slots with (default 3)
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  if (!W.state) { console.error("[warlord] match.js loaded without core.js"); return; }

  const Q = new URLSearchParams(G.location ? G.location.search : "");
  const MODE = Q.get("match") || "";
  const OFF = MODE === "old";
  const TICKCLOCK = Q.get("matchclock") === "tick";
  const clamp = W.clamp;

  /* ============================================================ NUMBERS
     Every one of these is derived from something in core.js or measured in
     this repo, and each says which. No magic scalars.

     MATCH_MIN — twenty minutes. A DESERT WARLORD battle in battle.js reports
     durations of 60–120 s (report.duration), so twenty minutes is ten to
     twenty real fights end to end: long enough that an alliance made at
     minute four is a thing you regret at minute fourteen, short enough that
     the match is a sitting and not a hobby.

     SLOTS — eight, because warnet's colour palette is eight and two warlords
     the same colour on one map is the failure this game cannot survive.

     GROW / CAP — the troop curve, and it is the only economy in a match.
     core.js says a BAND is 10–40 men, a COMPANY 40–120 and an ARMY 120–320.
     Holding four regions must feel like a company and holding half the island
     must feel like an army, so cap = 20 + regions*18: four regions is 92 (a
     company), and all twenty-two of territory.js's real regions is 416 — an
     ARMY, and the biggest force in the game, which is what winning the island
     ought to feel like. Growth is logistic against
     that cap at GROW per region per second — 0.055 is one man every 18 s on
     your single home region, which is the pace that makes the first ten
     minutes growth rather than a coin-flip rush.

     COMMIT — half your men, always, and it is fixed rather than a slider on
     purpose: a slider is precisely the mechanic the brief says to remove. Half
     is also the only ratio that is a real decision, because it is the one that
     can never empty you in a single tap.

     BATTLE_MAX — the deadline. battle.js's own fights end at 60–120 s and its
     hard cap is longer; 150 s is that ceiling plus the slack a phone needs to
     finish a teardown. Past it the match stops waiting for anybody.

     HOW LONG A BATTLE TAKES, and this is the number that turned out to decide
     the whole pacing of the match. The first version settled every unwatched
     battle in the same tick it was ordered, and the result was measurable and
     absurd: on the demo board an AI warlord went from one region to FIFTY-NINE
     PERCENT OF THE ISLAND in sixty seconds of real time, and three of the six
     warlords were eliminated before a human could have opened the board once.
     A conquest with no duration is not a conquest, it is an assignment.

     So a battle takes as long as what it has to break: FIGHT_BASE + defenders
     × FIGHT_PER, capped at BATTLE_MAX. The slope is not invented — battle.js
     reports 60–120 s for its 3D fights and those field 20–60 men a side, so
     20 + 40×1.2 = 68 s and 20 + 60×1.2 = 92 s land inside its own measured
     range. Small grabs are quick, an assault on a real army takes two minutes
     and everybody watching the board can see it coming.

     Note what this deliberately is NOT: a march. Distance was the obvious
     model and it does not work here — campaign.js rides at 15.5 m/s and its
     own comment measures a crossing of this island at fourteen minutes, so a
     literal march between two adjacent region centres is three minutes and a
     twenty-minute match would fit six conquests in it. openfront's answer is
     the right one and it is also the honest one: your men are already on the
     border. What costs time is breaking the people standing on it.

     DOM_PCT / DOM_HOLD — sixty percent of the island held for sixty seconds.
     An even eight-way split is 12.5%, so 60% means you have beaten everyone
     rather than edged ahead; the sixty-second hold is there because a single
     lucky tick spiking you over the line should not end a twenty-minute match.

     GUARD_SEC — what a betrayal costs. Breaking an alliance is announced to
     every warlord and the betrayed side's regions defend at +50% for twenty
     seconds: long enough to look at your phone and react, short enough that
     the betrayal is still a betrayal. */
  const MATCH_MIN = Math.max(2, +(Q.get("matchlen") || 20) || 20);
  const MATCH_SEC = MATCH_MIN * 60;
  const SLOTS = 8;
  const GROW = 0.055;
  const CAP_BASE = 20, CAP_PER = 18;
  const COMMIT = 0.5;
  const BATTLE_MAX = 150;
  const FIGHT_BASE = 20, FIGHT_PER = 1.2;
  const DOM_PCT = 0.6, DOM_HOLD = 60;
  const GUARD_SEC = 20, GUARD_MUL = 1.5;
  const SYNC_SEC = 3;
  const SKEW_EASE = 0.12;
  const SAMPLE_SEC = 10;          // territory-over-time resolution for the scoreboard
  const AI_THINK = 6;             // an AI warlord decides something every 6 s

  /* warnet paints peers from this exact list, indexed by the relay's player
     id. Copied rather than imported so a match can run before warnet has
     connected anything — but it MUST stay identical or a warlord is one
     colour on the map and another on the scoreboard. */
  const COLS = [0xff8a3d, 0x4fc7ff, 0x8fe06a, 0xff5fa8, 0xffd166, 0xb987ff, 0x5ae0c8, 0xff6b5a];
  function hex(c) { return "#" + ("000000" + (c >>> 0).toString(16)).slice(-6); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  let ctx = null;
  let strip = null;               // the persistent match bar (my DOM, torn down at the end)
  let boardOpen = false;
  let timer = 0;

  /* ============================================================ THE MATCH
     One object, the same shape on every machine. Only `own`, `men` and the
     alliance set are ever sent; everything else is derived from `seed`. */
  const M = {
    live: false, over: false,
    seed: 1,
    T0: 0,                        // local-epoch ms of match start — THE CLOCK
    len: MATCH_SEC,
    me: "",                       // my warlord id
    host: true,                   // do I run the AI and the authoritative sync?
    wl: {},                       // wid -> warlord
    order: [],                    // wid, in slot order — a stable list to iterate
    own: {},                      // regionId -> wid ("" = neutral)
    ally: {},                     // "a|b" (sorted) -> t of the handshake
    offers: {},                   // wid -> t, alliance offers waiting on me
    pending: {},                  // attackId -> {…} battles in flight
    applied: {},                  // attackId -> 1, so a result lands exactly once
    seq: 0,
    fallen: [],                   // {wid,name,t} — the men lost, by name
    events: [],                   // {t,kind,text} — the ledger the endgame prints
    samples: [],                  // [{t, share:{wid:n}}] every SAMPLE_SEC
    lastT: 0, lastSample: -1, lastSync: -1, lastThink: {},
    domSince: {},                 // wid -> t they crossed DOM_PCT
    stallMax: 0,                  // biggest gap between ticks — proof the clock did not pause
    tickAcc: 0,                   // only used by ?matchclock=tick, for the A/B
    winner: null, why: "",
  };
  W.matchState = M;

  /* ============================================================ THE CLOCK */
  function nowMs() { return Date.now(); }
  function matchT() {
    if (!M.live && !M.over) return 0;
    /* ?matchclock=tick is the revert, and it exists to be MEASURED against:
       it is the accumulator described in the header, so an A/B run can show
       the two clocks diverging the moment a battle or a hidden tab happens. */
    if (TICKCLOCK) return M.tickAcc;
    return (nowMs() - M.T0) / 1000;
  }
  function timeLeft() { return Math.max(0, M.len - matchT()); }
  /* The host's opinion of the time, eased in rather than snapped. A snap makes
     the countdown jump backwards on screen, which reads as a bug even when the
     correction is 40 ms. */
  function easeClock(hostT) {
    const want = nowMs() - hostT * 1000;
    if (!M.T0) { M.T0 = want; return; }
    M.T0 += (want - M.T0) * SKEW_EASE;
  }

  /* ============================================================ THE BOARD
     territory.js owns regions. This is an ADAPTER, not a second map: if that
     module is here, its regions are the regions. If it is not — and while ten
     agents are working in parallel it very often is not — a match still has to
     be playable, so the fallback derives the same kind of thing from the same
     seed: a golden-angle spiral of points on the island, filtered to land by
     desert.js's own coastAt, with nearest-neighbour adjacency.

     THE FALLBACK IS NOT A FEATURE. The moment territory.js publishes
     regions()/adjacent()/claim(), the three functions below are the only
     places that need to change. */
  let REG = null;                 // [{id,x,z,name}]
  let ADJ = null;                 // id -> [id]
  const FALLBACK_N = 48;          // 48 regions / 8 warlords = six each at an even split

  function territory() { return (W.territory && W.territory.regions) ? W.territory : null; }

  /* territory.js publishes `T.regions` as an ARRAY (the same object, always —
     it says so). The first draft of this called it, got "not a function",
     swallowed the throw and quietly ran on the fallback board for a whole
     session while territory.js sat there fully built. Accept both shapes and
     never let a guard hide a working sibling again. */
  function terrRegions(T) {
    if (!T) return null;
    /* AND IT BUILDS LAZILY. `T.regions` is the same array object forever, but
       it is EMPTY until territory.js's own ensure() has rasterised the island
       — which nothing had done yet at match start, so the first fixed version
       of this read a length of zero and quietly ran the 48-region fallback
       next to territory's real 22-region board. Two boards, one island: the
       precise failure CLAUDE.md names. Any query forces the build; held(null)
       is the cheapest one that takes no arguments it could get wrong. */
    if (T.held) { try { T.held(null); } catch (e) {} }
    else if (T.at) { try { T.at(0, 0); } catch (e) {} }
    const r = T.regions;
    if (Array.isArray(r)) return r.length ? r : null;
    if (typeof r === "function") { try { const l = r(); return (l && l.length) ? l : null; } catch (e) { return null; } }
    return null;
  }

  function buildRegions() {
    const T = territory();
    const list = terrRegions(T);
    if (list && list.length) {
      REG = list.map(function (r, i) {
        return { id: r.id == null ? "r" + i : r.id, x: r.x || 0, z: r.z || 0,
                 name: r.name || ("REGION " + (i + 1)), nb: r.neighbours || null };
      });
      buildAdj();
      return;
    }
    /* THE FALLBACK. Golden-angle spiral so the points are evenly spread with
       no lattice artefacts, jittered off hash01 so two seeds look different,
       and clipped to land: desert.js's coastAt(x,z) is metres inland, and 380
       is far enough that a region centre is never a beach that half-floods. */
    const D = W.desert;
    const R = (D && D.RADIUS) || 6700;
    const GA = Math.PI * (3 - Math.sqrt(5));
    REG = [];
    for (let i = 0; REG.length < FALLBACK_N && i < FALLBACK_N * 6; i++) {
      const f = (i + 0.5) / (FALLBACK_N * 1.35);
      const rad = Math.sqrt(f) * R * 0.88;
      const a = i * GA + W.hash01(M.seed, i, 17) * 0.5;
      const jx = (W.hash01(i, 3, M.seed) - 0.5) * 260;
      const jz = (W.hash01(i, 9, M.seed) - 0.5) * 260;
      const x = Math.cos(a) * rad + jx, z = Math.sin(a) * rad + jz;
      if (D && D.coastAt && D.coastAt(x, z) < 380) continue;
      REG.push({ id: "r" + REG.length, x: x, z: z, name: regionName(REG.length) });
    }
    buildAdj();
  }
  const RN_A = ["RED", "BLACK", "DRY", "HIGH", "LOW", "OLD", "BROKEN", "GLASS", "SALT", "IRON",
                "WHITE", "LONG", "BURNT", "COLD", "BITTER", "FLAT"];
  const RN_B = ["WELLS", "PAN", "RIDGE", "CROSSING", "REACH", "BASIN", "SPUR", "GATE",
                "HOLLOW", "SHELF", "MOUTH", "STEP"];
  function regionName(i) {
    const a = RN_A[Math.floor(W.hash01(i, 21, 5) * RN_A.length) % RN_A.length];
    const b = RN_B[Math.floor(W.hash01(i, 37, 11) * RN_B.length) % RN_B.length];
    return a + " " + b;
  }
  function buildAdj() {
    ADJ = {};
    /* territory.js already computed the real borders — it rasterises the
       island and links regions that share cells, and it publishes the shared
       frontier LENGTH alongside. Nearest-neighbour below is a guess at that
       graph; if the real one is here, the guess must never run. */
    let ok = REG.length > 0;
    for (let i = 0; i < REG.length; i++) {
      const nb = REG[i].nb;
      if (!nb || !nb.length) { ok = false; break; }
      ADJ[REG[i].id] = nb.slice();
    }
    if (ok) return;
    ADJ = {};
    /* K NEAREST, MADE SYMMETRIC. A one-way border is the bug that lets a
       warlord be attacked from a region he cannot attack back into, and it is
       invisible until somebody complains about it in a match. */
    const K = 4;
    for (let i = 0; i < REG.length; i++) {
      const a = REG[i];
      const d = [];
      for (let j = 0; j < REG.length; j++) {
        if (j === i) continue;
        const b = REG[j];
        d.push({ id: b.id, d: (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z) });
      }
      d.sort(function (p, q) { return p.d - q.d; });
      ADJ[a.id] = d.slice(0, K).map(function (r) { return r.id; });
    }
    for (let i = 0; i < REG.length; i++) {
      const a = REG[i].id;
      for (let k = 0; k < ADJ[a].length; k++) {
        const b = ADJ[a][k];
        if (ADJ[b].indexOf(a) < 0) ADJ[b].push(a);
      }
    }
  }
  function regions() { if (!REG) buildRegions(); return REG; }
  function region(id) {
    const L = regions();
    for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    return null;
  }
  function adjacent(id) { if (!ADJ) buildRegions(); return ADJ[id] || []; }

  /* OWNERSHIP. M.own is the match's read model and the thing victory is
     computed from, because the rules must work whether or not territory.js
     loaded. Every write also MIRRORS into territory.claim() so its map paints
     the right colours. If territory.js later wants to be authoritative, this
     one function is the only place that changes. */
  /* territory.js calls the local player "you" everywhere — its log lines, its
     one-warning-before-you-lose-ground rule, its map legend. So the match's
     own id for me is TRANSLATED on the way in rather than registering a
     second identity for the same man; every other warlord keeps his match id,
     which is what territory.registerOwner exists for. */
  function terrOwner(wid) { return wid === M.me ? "you" : (wid || null); }
  function registerOwners() {
    const T = W.territory;
    if (!T || !T.registerOwner) return;
    for (let i = 0; i < M.order.length; i++) {
      const w = M.wl[M.order[i]];
      try { T.registerOwner({ id: terrOwner(w.id), label: w.name, colour: w.colour }); } catch (e) {}
    }
  }

  function ownerOf(rid) { return M.own[rid] || ""; }
  function setOwner(rid, wid, quiet) {
    const was = M.own[rid] || "";
    if (was === wid) return;
    M.own[rid] = wid;
    const T = W.territory;
    if (T && T.claim) { try { T.claim(rid, terrOwner(wid), { quiet: !!quiet }); } catch (e) {} }
    W.emit("match:claim", { rid: rid, from: was, to: wid });
  }
  function regionsOf(wid) {
    let n = 0;
    const L = regions();
    for (let i = 0; i < L.length; i++) if (M.own[L[i].id] === wid) n++;
    return n;
  }
  function share(wid) { return regionsOf(wid) / Math.max(1, regions().length); }

  /* NEUTRAL GARRISONS are what the first ten minutes are FOR. Hashed off the
     region index so every client agrees without a byte on the wire, and
     scaled with distance from the coast: the middle of the island is worth
     more and costs more, which is the only map-shape decision in the game. */
  function neutralMen(rid) {
    const r = region(rid);
    if (!r) return 10;
    const i = regions().indexOf(r);
    const R = (W.desert && W.desert.RADIUS) || 6700;
    const inland = 1 - Math.min(1, Math.sqrt(r.x * r.x + r.z * r.z) / R);
    return Math.round(6 + W.hash01(i, 3, M.seed) * 10 + inland * 14);
  }

  /* ============================================================ WARLORDS */
  function makeWarlord(o) {
    return {
      id: o.id, name: o.name || "WARLORD", slot: o.slot | 0,
      colour: o.colour == null ? COLS[(o.slot | 0) % COLS.length] : o.colour,
      ai: !!o.ai, peerId: o.peerId == null ? null : o.peerId,
      men: 0, home: null, alive: true,
      raised: 0, battles: 0, won: 0, lost: 0, betrayals: 0, killed: 0,
      guard: 0,                   // matchT until which this warlord defends at GUARD_MUL
      leftAt: 0,
    };
  }
  function wl(id) { return M.wl[id] || null; }
  function meWL() { return M.wl[M.me] || null; }
  function living() { return M.order.filter(function (id) { return M.wl[id] && M.wl[id].alive; }); }

  function capOf(wid) { return CAP_BASE + regionsOf(wid) * CAP_PER; }

  /* ============================================================ SPAWN
     EVERY WARLORD STARTS ALONE WITH A PISTOL. core.newGame() already does the
     alone-with-a-pistol part; this decides WHERE, and it has to hold on eight
     machines that have exchanged nothing but a seed.

     FARTHEST-POINT SAMPLING over the region centres. Start from the region
     the seed picks, then repeatedly take the region furthest from everything
     already taken. That is the standard max-min placement.

     WHAT IT ACTUALLY MEASURES, on territory.js's real 22-region island, as
     the minimum distance between any two homes (W.match.audit().spawnSepKm):

         2 warlords  7.5 km      6 warlords  4.4 km
         4 warlords  5.4 km      8 warlords  2.8 – 3.7 km over five seeds

     campaign.js rides at RIDE_SPEED = 15.5 m/s, so even the worst full lobby
     puts your nearest rival THREE MINUTES of hard riding away, and you have to
     cross whatever is between you to get there. That is the number the "first
     ten minutes is growth, not a coin-flip rush" claim rests on, and it is
     written here rather than asserted because an earlier draft of this comment
     claimed 4.6–6.1 km — a figure from the fallback board that the real one
     never produced. Measure, then claim.

     A ring of eight would be simpler and is worse: it puts everybody the same
     distance from the middle, so the centre of the island becomes an eight-way
     race decided by who rode straight, on a starting pistol. */
  function spawnPoints(n) {
    const L = regions();
    if (!L.length) return [];
    const taken = [L[Math.floor(W.hash01(M.seed, 101, 7) * L.length) % L.length]];
    while (taken.length < n && taken.length < L.length) {
      let best = null, bestD = -1;
      for (let i = 0; i < L.length; i++) {
        const c = L[i];
        if (taken.indexOf(c) >= 0) continue;
        let d = Infinity;
        for (let j = 0; j < taken.length; j++) {
          const t = taken[j];
          d = Math.min(d, (c.x - t.x) * (c.x - t.x) + (c.z - t.z) * (c.z - t.z));
        }
        if (d > bestD) { bestD = d; best = c; }
      }
      if (!best) break;
      taken.push(best);
    }
    return taken;
  }

  /* ============================================================ TRANSPORT
     warnet.js owns the socket. This asks it first, falls through to net.js
     directly, and finally to a local loopback so a solo-with-AI match is the
     same code path as an eight-player one — the single most useful property
     in this file, because it means solo is not a special case that rots. */
  /* AM I ON A WIRE. Deliberately warnet.online() (the socket is up) and NOT
     warnet.connected() (the socket is up AND the world handshake landed):
     between those two moments every client answered "not connected", every
     client therefore answered isHost() = true, and eight hosts each ran the
     AI and each broadcast an authoritative sync. The window is short and it is
     exactly the window a lobby lives in. */
  function connected() {
    const N = W.warnet;
    if (N && N.online) { try { if (N.online()) return true; } catch (e) {} }
    if (N && N.connected) { try { if (N.connected()) return true; } catch (e) {} }
    return !!(CBZ.net && CBZ.net.active);
  }
  function isHost() {
    if (!connected()) return true;
    if (W.warnet && W.warnet.simHost) { try { return !!W.warnet.simHost(); } catch (e) {} }
    return !!(CBZ.net && CBZ.net.isHost && CBZ.net.isHost());
  }
  function send(verb, obj) {
    obj = obj || {};
    obj.e = verb;
    if (W.warnet && W.warnet.send) { try { W.warnet.send(verb, obj); return true; } catch (e) {} }
    if (CBZ.net && CBZ.net.active && CBZ.net.sendEv) { try { CBZ.net.sendEv(obj); return true; } catch (e) {} }
    return false;              // solo: nobody to tell, and nothing is lost
  }
  const VERBS = ["wlmstart", "wlmsync", "wlmatk", "wlmres",
                 "wlmally", "wlmallyok", "wlmbreak", "wlmend"];
  let wired = false;
  /* A WARLORD WHO ARRIVES AFTER THE START. warnet publishes the join
     lifecycle, so this needs no handshake verb of its own: the host gives the
     newcomer the next free slot and re-broadcasts the roster. He is placed on
     a home derived from that slot, at the CURRENT match time — he does not
     replay the eight minutes he missed, which is the whole reason the clock is
     wall time and not a counter. */
  function wireLifecycle() {
    if (!W.warnet || !W.warnet.onJoin) return;
    try {
      W.warnet.onJoin(function (id, name) {
        if (!M.live || !isHost()) return;
        const w = joinWarlord({ peerId: id, name: name });
        if (!w) return;
        assignHomes();
        if (w.home && !ownerOf(w.home)) { setOwner(w.home, w.id, true); w.men = CAP_BASE * 0.5; }
        registerOwners();
        note("join", (name || "a warlord") + " rides in");
        sendStart();
        sendSync();
      });
    } catch (e) {}
  }

  function wire() {
    if (wired) return;
    /* Bound lazily and once. warnet may install net.js long after this file
       booted, so wiring at boot would attach to nothing — and attaching twice
       is how one attack gets applied two times. */
    if (W.warnet && W.warnet.on) {
      try {
        for (let i = 0; i < VERBS.length; i++) {
          (function (v) { W.warnet.on(v, function (m) { recv(v, m); }); })(VERBS[i]);
        }
        wired = true;
        return;
      } catch (e) {}
    }
    if (CBZ.net && CBZ.net.onEv) {
      for (let i = 0; i < VERBS.length; i++) {
        (function (v) { CBZ.net.onEv(v, function (m) { recv(v, m); }); })(VERBS[i]);
      }
      wired = true;
    }
  }
  function myPeerId() { return (CBZ.net && CBZ.net.active) ? CBZ.net.id : 0; }
  function widForPeer(pid) { return "p" + pid; }

  /* ============================================================ THE BATTLE RULE
     ── THE PROBLEM ────────────────────────────────────────────────────────
     A Bannerlord battle takes a minute or two. Seven other warlords cannot
     wait for it, the clock is forbidden from pausing, and the transport is a
     JSON relay with a backpressure gate that is EXPLICITLY ALLOWED to drop
     high-frequency snapshots (see net.js, BP_LIMIT). So the rule has to
     survive: a player who fights in 3D, a player who does not, a player who
     rage-quits halfway through one, and two players attacking each other in
     the same second.

     ── THE RULE ───────────────────────────────────────────────────────────
     A battle is a PROMISE WITH A DEADLINE, owned by exactly one client, and
     its outcome never travels on the wire as an argument — only as news.

     1. AN ATTACK IS AN ORDER, NOT A FIGHT. `wlmatk {id, wid, rid, men, at}`
        is the only thing sent. Every client applies it identically: it knows
        who attacked, where, and with how many men, because it already knows
        the board.

     2. THE BATTLE IS DECIDED BY A PURE FUNCTION ON A SHARED SEED. The seed is
        hash01(attackSeq, regionIndex, matchSeed) — no packet carries it,
        because both ends already have all three numbers. Every client runs
        `W.battle.resolve()` (battle.js's headless half of the SAME model the
        3D fight uses) and lands on the identical casualties. Nothing about
        the outcome is on the wire, so nothing about the outcome can be LOST.
        That is the property that makes this survive a lossy relay: you cannot
        drop a message that was never sent.

     3. WHO GETS TO FIGHT IT IN 3D. The ATTACKER, and only if the attacker is
        a human who is present. One battle, one owner — single writer per
        object, which is the reason there is never a disagreement to
        reconcile rather than a mitigation for one. The defender is not asked
        to render two hundred men on a phone because somebody else clicked.

     4. WHAT EVERYONE ELSE SEES. The region goes CONTESTED — the attacker's
        colour bleeding into the defender's, with a countdown. That is all.
        openfront's entire presentation of a battle is a bar and a colour and
        it is enough; the 3D fight is the ATTACKER'S CAMERA on an event the
        whole island can already see the shape of.

     5. THE DEADLINE IS THE DEFINITION OF THE ENDING, not a fallback for one.
        The instant an attack is declared, EVERY client starts the same
        BATTLE_MAX timer. When it expires, every client — including the
        owner's — takes the resolve() result, full stop. The owner's own 3D
        fight is bound by the same deadline: if it is still live it is
        abandoned and the resolve() numbers stand. So the deadline cannot
        disagree with the owner, because the owner obeys it too.

     6. A RAGE-QUIT MID-BATTLE IS THEREFORE A NON-EVENT. The quitter's client
        never sends `wlmres`; the deadline arrives; eight machines finish the
        battle identically without them. This is the case that broke every
        other design I tried, and it is the reason the deadline is a rule
        rather than a timeout.

     7. TWO PLAYERS ATTACKING EACH OTHER SIMULTANEOUSLY. They are two
        different battles in two different regions — you may only attack a
        region you do not own — so there is nothing to collide. The genuinely
        simultaneous case is two attackers hitting the SAME third region, and
        that is settled by a TOTAL ORDER every client computes without
        arbitration: sort by (at, attackerId). The second attack resolves
        against whatever the first one left standing. No referee, no message.

     ── WHAT WAS REJECTED, AND WHY ─────────────────────────────────────────
     (a) BOTH PLAYERS FIGHT THE SAME 3D BATTLE, lockstep or rollback. This is
         the version everybody wants and it is not available here. combat_iq
         drives 200 actors at 60 Hz; keeping two of those bit-identical needs
         a deterministic fixed-point sim and a rollback buffer, over a
         transport that is a JSON relay which SHEDS snapshots by design. The
         failure mode is not a stutter — it is one player watching men die who
         are still standing on the other screen, and then the two of them
         arguing about the loot. warnet.js reached the same conclusion from
         the transport side before this file existed, which is worth saying:
         two people looked at it separately and got the same answer.
     (b) THE SERVER RESOLVES BATTLES. Rejected because server/server.js is a
         zero-dependency relay and MULTIPLAYER.md's whole promise is that
         anyone can run one with `node server/server.js`. Rules in the server
         means every host runs a VERSION of the rules, and a host one commit
         behind desyncs a match in a way nobody can diagnose.
     (c) THE DEFENDER IS AUTHORITATIVE (the usual "the victim decides" answer).
         Rejected because a defender who is asleep, in a menu, or on a train
         is the common case, and it makes the most frequent situation the one
         that needs a fallback. */

  /* A WATCHED BATTLE ALWAYS GETS THE FULL CEILING, because it is the one on
     somebody's screen and battle.js's fights run to 120 s — cutting a player's
     fight short at the twenty-two seconds a two-man garrison is worth would be
     the deadline eating the only battle anybody is looking at. */
  function fightSec(def, watched) {
    if (watched) return BATTLE_MAX;
    return clamp(FIGHT_BASE + def * FIGHT_PER, FIGHT_BASE, BATTLE_MAX);
  }

  function battleSeed(id, rid) {
    const i = Math.max(0, regions().indexOf(region(rid)));
    return W.hash01(id, i, M.seed);
  }

  /* SYNTHESISING A ROSTER for the 3D presentation. Note W.makeSoldier is used
     directly rather than W.makeBand: makeBand pulls from core's shared RNG
     stream and this file is not allowed to move that. bandGunFor takes an
     explicit roll, so every gun here comes off hash01 and the two sides of a
     fight see the same men. (The soldier ids come from core's UID counter,
     which is local-only — it names men on this screen and nothing else.) */
  function synthRoster(n, wealth, salt) {
    const men = [];
    const tiers = ["levy", "levy", "raider", "soldier", "veteran"];
    for (let i = 0; i < n; i++) {
      const t = tiers[Math.floor(W.hash01(i, salt, M.seed) * tiers.length) % tiers.length];
      const s = W.makeSoldier(t, W.bandGunFor(wealth, W.hash01(i, salt + 7, M.seed)));
      if (W.hash01(i, salt + 13, M.seed) < clamp(wealth - 0.3, 0, 0.5)) s.armour = "vest";
      men.push(s);
    }
    return men;
  }

  /* THE MODEL. battle.js owes `resolve()` — the same rosters, the same morale
     model, the same result shape, with nothing rendered. When it is there it
     IS the model. When it is not (and while this game is being written by ten
     agents at once, it often is not), this falls back to core's own odds
     curve, which is the same function the encounter card already prints to
     the player — so the fallback is at least the number the game promised. */
  function decide(atk, def, seed, atkWL, defWL) {
    if (W.battle && W.battle.resolve) {
      try {
        const r = W.battle.resolve({
          mine: synthRoster(atk, 0.35 + share(atkWL) * 0.5, 3),
          theirs: synthRoster(def, 0.35 + (defWL ? share(defWL) : 0.2) * 0.5, 11),
          seed: seed, headless: true,
        });
        if (r && r.outcome) {
          const win = r.outcome === "won";
          return {
            win: win,
            al: Math.min(atk, (r.yourDead || []).length || Math.round(atk * (win ? 0.4 : 0.9))),
            dl: Math.min(def, (r.theirDead || []).length || Math.round(def * (win ? 0.9 : 0.4))),
            src: "battle.resolve",
          };
        }
      } catch (e) { /* fall through — a broken sibling must not end the match */ }
    }
    /* SECOND CHOICE: warnet publishes `resolve(seed, a, b)` as "the pure
       function both clients must agree on, exported so match.js can own the
       rules". Power here is MEN, because men are the only currency a match
       has and every man in one is worth about the same — the tier spread that
       makes core's power model necessary belongs to the campaign, not to a
       region changing hands. */
    if (W.warnet && W.warnet.resolve) {
      try {
        const r = W.warnet.resolve(Math.round(seed * 0x7fffffff), { pw: atk }, { pw: def });
        if (r && typeof r.aWins === "boolean") {
          return { win: r.aWins, al: Math.round(atk * r.aLoss), dl: Math.round(def * r.bLoss),
                   src: "warnet.resolve" };
        }
      } catch (e) {}
    }

    /* LAST RESORT, when neither sibling is on the page. core.odds() bends a
       power ratio through a soft curve
       because a 2:1 advantage is not a 100% win — the encounter screen has
       printed that number to players since day one and this must not contradict
       it. Losses: the loser is broken (70–100% gone), the winner pays in
       proportion to how close it was, which is what makes a 1.1:1 win worse
       than not attacking. */
    const p = W.odds(atk, def);
    const win = seed < p;
    const close = 1 - Math.abs(p - 0.5) * 2;          // 1 at a coin flip, 0 at a walkover
    const roll = W.hash01(Math.round(seed * 1e6), 5, M.seed);
    const loserGone = 0.7 + roll * 0.3;
    return {
      win: win,
      al: Math.round(atk * (win ? 0.18 + close * 0.42 : loserGone)),
      dl: Math.round(def * (win ? loserGone : 0.18 + close * 0.42)),
      src: "odds",
    };
  }

  function defenceOf(rid) {
    const o = ownerOf(rid);
    if (!o) return neutralMen(rid);
    const w = wl(o);
    if (!w) return neutralMen(rid);
    const n = regionsOf(o);
    /* MEN ARE SPREAD EVENLY OVER WHAT YOU HOLD, and the game does the
       spreading for you. That is the simplification that deletes garrison
       management, supply lines and a stack-move UI in one line: a warlord
       who holds twelve regions defends each of them with a twelfth of his
       army, so wide is weak and that is a real decision with no screen. */
    let d = w.men / Math.max(1, n);
    if (w.guard > matchT()) d *= GUARD_MUL;           // the cost of betraying him
    return Math.max(1, Math.round(d));
  }

  function canAttack(wid, rid) {
    if (!M.live || M.over) return false;
    const o = ownerOf(rid);
    if (o === wid) return false;
    if (o && allied(wid, o)) return false;            // an alliance IS the no-attack rule
    const A = adjacent(rid);
    for (let i = 0; i < A.length; i++) if (ownerOf(A[i]) === wid) return true;
    return false;
  }

  /* ONE ATTACK IN FLIGHT PER WARLORD. Without this rule the first run of the
     demo had FORTY-FOUR concurrent battles on a 48-region island — five AI
     warlords each dribbling half their men at a new region every six seconds,
     nothing ever settling, and a board where every tile said FIGHTING. One at
     a time is also the honest reading of "send half your men": you sent them,
     they are gone, you wait. It costs nothing to explain and it is the whole
     pacing of the match. */
  function busy(wid) {
    for (const id in M.pending) if (M.pending[id].wid === wid) return true;
    return false;
  }

  function attack(wid, rid) {
    const w = wl(wid);
    if (!w || !canAttack(wid, rid) || busy(wid)) return false;
    const men = Math.floor(w.men * COMMIT);
    if (men < 1) return false;
    const id = (w.slot + 1) * 1e6 + (++M.seq);        // unique without a coordinator
    /* WHETHER THIS BATTLE WILL BE WATCHED IS ONE BIT, AND IT GOES ON THE WIRE.
       The first draft gave EVERY battle the BATTLE_MAX deadline, which meant
       an AI fighting an AI on the far side of the island took a hundred and
       fifty seconds to change a region nobody was looking at — a live world
       moving at the speed of a fight nobody is in. Only a battle somebody is
       actually watching in 3D needs the deadline; everything else is
       resolve() and it lands this second. */
    const show = wid === M.me && !w.ai && !!(W.battle && W.battle.start) && !liveBattle();
    /* THE DEFENCE IS SENT, NOT RECOMPUTED. Every client runs the same pure
       decide() on the same seed, but only if it is fed the same two numbers —
       and the DEFENDER's number is men ÷ regions, which each client simulates
       for itself and therefore drifts on by a man or two between syncs. Two
       clients an integer apart at the boundary of odds() decide the battle
       differently, and then they disagree about who owns a region forever.
       The attacker states the defence he attacked into; everybody applies it. */
    const msg = { id: id, wid: wid, rid: rid, men: men, def: defenceOf(rid),
                  p: show ? 1 : 0, at: Math.round(matchT() * 1000) };
    applyAttack(msg);
    send("wlmatk", msg);
    return true;
  }

  function applyAttack(m) {
    if (M.pending[m.id] || M.applied[m.id]) return;
    const w = wl(m.wid);
    if (!w) return;
    const def = m.def == null ? defenceOf(m.rid) : m.def;
    w.men = Math.max(0, w.men - m.men);
    const P = {
      id: m.id, wid: m.wid, rid: m.rid, men: m.men, def: def, show: !!m.p,
      defWid: ownerOf(m.rid), at: m.at / 1000,
      due: matchT() + fightSec(def, !!m.p),
    };
    M.pending[m.id] = P;
    W.emit("match:attack", P);
    const r = region(m.rid);
    if (m.wid === M.me) W.toast("YOUR MEN GO IN AT " + (r ? r.name : m.rid), "");
    else if (P.defWid === M.me) {
      W.toast(wlName(m.wid) + " IS ATTACKING " + (r ? r.name : m.rid), "bad");
      note("attack", wlName(m.wid) + " attacks " + (r ? r.name : m.rid));
    }

    /* THE ATTACKER'S CAMERA. Only the attacker, only if he is a human, only
       if he is here, and only one at a time — a second 3D battle while one is
       live would be two modules owning the screen, which the contract bans. */
    if (P.show && m.wid === M.me) {
      LIVE_ID = m.id;
      present(P);
    }
    paintStrip();
    if (boardOpen) drawBoard();
  }
  let LIVE_ID = 0;                                     // the 3D battle I am watching

  function liveBattle() {
    try { return !!(W.battle && W.battle.live && W.battle.live()); } catch (e) { return false; }
  }

  function present(P) {
    const seed = battleSeed(P.id, P.rid);
    const out = decide(P.men, P.def, seed, P.wid, P.defWid);
    P.decided = out;                                  // decided BEFORE a frame is drawn
    /* THE OUTCOME IS ALREADY TRUE. The 3D fight is a presentation of a
       decision, not the decision — which is the only way a battle can be
       both watchable and safe over this transport. It is seeded from the same
       number, so what you watch is the fight you were told about. */
    try {
      const band = {
        id: "m" + P.id, faction: "warlord",
        name: P.defWid ? wlName(P.defWid) : "GARRISON",
        colour: P.defWid && wl(P.defWid) ? wl(P.defWid).colour : 0x9a8f72,
        x: (W.state.you.x || 0) + 40, z: (W.state.you.z || 0),
        men: synthRoster(P.def, 0.35 + (P.defWid ? share(P.defWid) : 0.2) * 0.5, 11),
        gold: 0, goal: null, mood: "hunt", cooldown: 0, wealth: 0.5,
      };
      W.battle.start({ band: band, match: true, seed: seed });
    } catch (e) { console.warn("[match] battle.start refused", e); }
  }

  /* One place a battle can END, called by the deadline, by the owner's own
     3D fight finishing, or by a `wlmres` off the wire. Idempotent by id,
     because those three genuinely can race and the first one is the truth. */
  function settle(id, out) {
    const P = M.pending[id];
    if (!P || M.applied[id]) return null;
    M.applied[id] = 1;
    delete M.pending[id];
    if (LIVE_ID === id) LIVE_ID = 0;
    if (!out) out = P.decided || decide(P.men, P.def, battleSeed(P.id, P.rid), P.wid, P.defWid);

    const A = wl(P.wid), D = P.defWid ? wl(P.defWid) : null;
    const survivors = Math.max(0, P.men - out.al);
    if (A) {
      A.battles++;
      A.killed += out.dl;
      if (out.win) A.won++; else A.lost++;
    }
    if (D) {
      D.battles++;
      D.killed += out.al;
      if (out.win) D.lost++; else D.won++;
      D.men = Math.max(0, D.men - out.dl);
    }
    rollTheDead(P.wid, out.al);
    if (P.defWid) rollTheDead(P.defWid, out.dl);

    if (out.win) {
      setOwner(P.rid, P.wid);
      if (A) A.men += survivors;                      // the men who took it, hold it
      const r = region(P.rid);
      if (P.wid === M.me) W.toast((r ? r.name : "THE REGION") + " IS YOURS", "good");
      else if (P.defWid === M.me) W.toast("YOU LOST " + (r ? r.name : P.rid), "bad");
      note("take", wlName(P.wid) + " takes " + (r ? r.name : P.rid) +
        (P.defWid ? " from " + wlName(P.defWid) : ""));
    } else {
      if (A) A.men += survivors;                      // what is left of them walks home
      if (P.wid === M.me) W.toast("THE ATTACK BROKE", "bad");
      note("hold", (P.defWid ? wlName(P.defWid) : "the garrison") + " holds off " + wlName(P.wid));
    }
    W.emit("match:battle", { id: id, out: out, P: P });
    checkElimination();
    paintStrip();
    if (boardOpen) drawBoard();
    return out;
  }

  /* THE ONE EXIT FOR A BATTLE I OWNED. Both ways a watched fight can end — an
     aftermath screen with a real casualty list, or a plain return to the sand
     — come through here, because the first version had them as two listeners
     and only ONE of them broadcast the result. Measured in the three-browser
     run: the attacker's own board flipped the region and both other warlords
     sat on FIGHTING for the full hundred and fifty seconds until the deadline
     agreed with him. A battle owner that settles silently is not an owner. */
  function finishWatched(id, report) {
    const P = M.pending[id];
    if (!P) return false;
    let out = null;
    if (report && report.outcome) {
      out = {
        win: report.outcome === "won",
        al: Math.min(P.men, (report.yourDead || []).length),
        dl: Math.min(P.def, (report.theirDead || []).length),
        src: "3d",
      };
    }
    out = settle(id, out);
    if (out) send("wlmres", { id: id, win: out.win, al: out.al, dl: out.dl });
    return !!out;
  }

  /* MEN LOST BY NAME. The endgame screen is the thing people screenshot and a
     casualty list of numbers is a spreadsheet — core.js says exactly this
     about its own name tables and it is right. Names are hashed off the
     warlord slot and a running index so two clients print the same dead. */
  function rollTheDead(wid, n) {
    if (!n) return;
    const w = wl(wid);
    if (!w) return;
    const base = w.roll || 0;
    w.roll = base + n;
    const room = Math.min(n, 260 - M.fallen.length);
    for (let i = 0; i < room; i++) {
      M.fallen.push({ wid: wid, name: W.nameFor((w.slot + 1) * 100003 + base + i), t: matchT() });
    }
  }

  function note(kind, text) {
    M.events.push({ t: matchT(), kind: kind, text: text });
    if (M.events.length > 240) M.events.shift();
    W.log("[match] " + text, kind === "betray" ? "bad" : "");
  }
  function wlName(id) { const w = wl(id); return w ? w.name : "SOMEBODY"; }

  /* ============================================================ DIPLOMACY
     Two buttons. openfront gets enormous mileage out of exactly this and no
     more, so there is no treaty screen, no trade, no vassalage in here and
     there must never be. An alliance means two things and they are the two
     things that matter: you cannot attack each other, and you can see each
     other's territory. Breaking one is instant, unilateral, announced to
     every warlord on the island, permanently on the scoreboard, and costs you
     GUARD_SEC of the victim defending at GUARD_MUL. */
  function key(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
  function allied(a, b) { return !!M.ally[key(a, b)]; }
  function alliesOf(wid) {
    const out = [];
    for (let i = 0; i < M.order.length; i++) {
      const o = M.order[i];
      if (o !== wid && allied(wid, o)) out.push(o);
    }
    return out;
  }
  function offerAlly(from, to) {
    if (from === to || allied(from, to)) return;
    if (to === M.me) {
      M.offers[from] = matchT();
      W.toast(wlName(from) + " OFFERS AN ALLIANCE", "good");
      if (boardOpen) drawBoard();
      paintStrip();
      return;
    }
    /* AN AI ANSWERS IMMEDIATELY, and only the sim host may answer for it —
       otherwise eight clients each accept on its behalf and the handshake
       lands eight times. */
    const t = wl(to);
    if (t && t.ai && isHost()) {
      if (aiWantsAlly(to, from)) acceptAlly(to, from);
    }
  }
  function acceptAlly(a, b) {
    if (allied(a, b)) return;
    M.ally[key(a, b)] = matchT();
    delete M.offers[b]; delete M.offers[a];
    note("ally", wlName(a) + " and " + wlName(b) + " are allied");
    if (a === M.me || b === M.me) W.toast("ALLIANCE SEALED", "good");
    W.emit("match:ally", { a: a, b: b });
    if (boardOpen) drawBoard();
    paintStrip();
  }
  function breakAlly(a, b) {
    if (!allied(a, b)) return;
    delete M.ally[key(a, b)];
    const A = wl(a), B = wl(b);
    if (A) A.betrayals++;
    if (B) B.guard = matchT() + GUARD_SEC;
    note("betray", wlName(a) + " BREAKS WITH " + wlName(b));
    /* LOUD, TO EVERYONE. The social consequence is the mechanic; a betrayal
       nobody saw is just a state change. */
    W.toast(wlName(a) + " BREAKS WITH " + wlName(b), "bad");
    W.emit("match:break", { a: a, b: b });
    if (boardOpen) drawBoard();
    paintStrip();
  }

  /* ============================================================ AI WARLORDS
     They fill empty slots and they play the SAME game by the SAME rules —
     they issue `wlmatk` orders exactly as a human does, so every client
     applies an AI's attack through the identical path. Only the sim host
     thinks for them; everyone else just receives the orders. Without these,
     solo is an empty island and a half-full lobby is boring, which is the
     whole reason they exist. Four rules, in priority order, and that is all:
     take the cheapest thing next to you, ally when you are being beaten,
     betray when the leader is somebody you are allied to, and never attack
     out of a stack you cannot afford to lose. */
  function aiWantsAlly(me, them) {
    const a = wl(me), b = wl(them);
    if (!a || !b) return false;
    // you ally with somebody who is doing about as well as you, or better
    return share(them) >= share(me) * 0.7;
  }
  function think(wid) {
    const w = wl(wid);
    if (!w || !w.alive) return;
    const mine = regionsOf(wid);
    if (!mine) return;

    // 1. BETRAY THE LEADER IF HE IS YOUR ALLY AND HE IS WINNING
    const al = alliesOf(wid);
    for (let i = 0; i < al.length; i++) {
      if (share(al[i]) > DOM_PCT * 0.7 && share(al[i]) > share(wid) * 1.6) {
        breakAlly(wid, al[i]);
        send("wlmbreak", { wid: wid, to: al[i] });
        return;
      }
    }
    // 2. ALLY IF YOU ARE LOSING AND SOMEBODY UNALLIED IS NOT
    if (share(wid) < 0.5 / Math.max(1, living().length) && al.length < 2) {
      for (let i = 0; i < M.order.length; i++) {
        const o = M.order[i];
        if (o === wid || allied(wid, o) || !M.wl[o].alive) continue;
        if (share(o) > share(wid)) {
          offerAlly(wid, o);
          send("wlmally", { wid: wid, to: o });
          return;
        }
      }
    }
    // 3. TAKE THE CHEAPEST THING ON YOUR BORDER
    let best = null, bestScore = -1;
    const L = regions();
    for (let i = 0; i < L.length; i++) {
      const rid = L[i].id;
      if (!canAttack(wid, rid)) continue;
      const d = defenceOf(rid);
      const send_ = w.men * COMMIT;
      if (send_ < d * 1.15) continue;                 // rule 4: never a fight you lose
      const score = (send_ - d) / Math.max(1, d) + (ownerOf(rid) ? 0.4 : 0);
      if (score > bestScore) { bestScore = score; best = rid; }
    }
    /* AN AI GOES THROUGH THE SAME attack() A PLAYER'S TAP GOES THROUGH. The
       first draft built the message itself, which meant the one-attack-per-
       warlord rule and the presentation bit both had to be remembered twice —
       and the AI copy is the one that would silently drift. */
    if (best) attack(wid, best);
  }

  /* ============================================================ THE TICK
     Cheap, 1 Hz, and — the thing that matters — INTEGRATING rather than
     incrementing. Every rule below is written against `dt = matchT() - lastT`,
     so a tick that the browser delivered four seconds late does four seconds
     of work and the match is not behind. A backgrounded tab, a long battle
     and a stalled main thread are all the same event to this function. */
  function tick() {
    if (!M.live || M.over) return;
    if (TICKCLOCK) M.tickAcc += 1;                    // the revert clock, for measuring
    const t = matchT();
    const raw = Math.max(0, t - M.lastT);
    if (raw > M.stallMax) M.stallMax = raw;
    M.lastT = t;
    /* CATCH UP, BUT ONLY FROM TIME THAT WAS ACTUALLY PLAYED. A tab that was
       hidden for four seconds must do four seconds of work — that is the whole
       point of integrating. A jump of two hundred seconds is not four seconds
       of play, it is the clock being ADOPTED (a late joiner taking the host's
       time, or ?match=demo winding T0 back to photograph a mid-match board),
       and paying a warlord two hundred seconds of recruitment for it hands him
       a free army. Sixty seconds is past any plausible stall and short of any
       adoption. */
    const dt = Math.min(raw, 60);

    // ---- MEN. Logistic against a cap set by how much island you hold.
    for (let i = 0; i < M.order.length; i++) {
      const w = M.wl[M.order[i]];
      if (!w || !w.alive) continue;
      const n = regionsOf(w.id);
      if (!n) continue;
      const cap = CAP_BASE + n * CAP_PER;
      const grew = n * GROW * dt * Math.max(0, 1 - w.men / Math.max(1, cap));
      w.men += grew;
      w.raised += grew;
    }
    // YOUR men are core's army, not a number in here — the two must never be
    // two different armies. The match pool is the truth and core is told.
    syncMyArmy();

    // ---- BATTLES PAST THE DEADLINE. See THE BATTLE RULE, point 5.
    for (const id in M.pending) {
      const P = M.pending[id];
      if (t < P.due) continue;
      if (P.wid === M.me && liveBattle() && W.battle.retreat) {
        /* THE OWNER OBEYS THE DEADLINE TOO. Without this the owner is the one
           machine that can disagree with everybody else, and the deadline
           stops being a definition and becomes a race. */
        try { W.battle.retreat(); } catch (e) {}
      }
      settle(+id, null);
    }

    // ---- AI, host only
    if (isHost()) {
      for (let i = 0; i < M.order.length; i++) {
        const w = M.wl[M.order[i]];
        if (!w || !w.ai || !w.alive) continue;
        if (t - (M.lastThink[w.id] || -99) < AI_THINK) continue;
        M.lastThink[w.id] = t;
        think(w.id);
      }
      if (t - M.lastSync >= SYNC_SEC) { M.lastSync = t; sendSync(); }
    }

    // ---- the scoreboard's history, sampled rather than logged
    const slot = Math.floor(t / SAMPLE_SEC);
    if (slot !== M.lastSample) {
      M.lastSample = slot;
      const s = { t: t, share: {} };
      for (let i = 0; i < M.order.length; i++) s.share[M.order[i]] = regionsOf(M.order[i]);
      M.samples.push(s);
      if (M.samples.length > 400) M.samples.shift();
    }

    checkVictory(t);
    W.emit("match:tick", t);
    paintStrip();
    if (boardOpen) drawBoard();
  }

  /* YOUR ARMY IS core.js's ARMY. A match pool of "men" that is a different
     number from W.state.army is two armies with one name, and the moment a
     3D battle runs, the roster it puts on the sand comes from core. So the
     pool is authoritative and core is topped up or trimmed to match it. */
  function syncMyArmy() {
    const w = meWL();
    if (!w) return;
    const want = Math.max(0, Math.round(w.men));
    const have = W.state.army.length;
    if (want > have) {
      const add = Math.min(want - have, 40);          // 40/tick, so a big claim is not a hitch
      for (let i = 0; i < add; i++) {
        const k = have + i;
        const t = W.hash01(k, 71, M.seed) < 0.62 ? "levy" : "raider";
        W.addSoldier(W.makeSoldier(t, W.bandGunFor(0.3 + share(M.me) * 0.5, W.hash01(k, 83, M.seed))));
      }
    } else if (want < have) {
      const cut = Math.min(have - want, 200);
      for (let i = 0; i < cut; i++) {
        const s = W.state.army[W.state.army.length - 1];
        if (!s) break;
        W.removeSoldier(s.id, false);
      }
    }
  }

  /* ============================================================ VICTORY
     A MATCH MUST END OR IT IS A SANDBOX. Three ways, in the order they are
     checked, and progress toward every one of them is on the strip the whole
     way — a victory condition you cannot see is a rule, not a goal.

       LAST WARLORD STANDING   everyone else is out
       DOMINATION              DOM_PCT of the island held for DOM_HOLD seconds
       THE CLOCK               most regions at zero, ties broken on men

     Domination is the one the match is DESIGNED around: it is the only
     condition that can end the game early, so it is the one that makes the
     back half tense instead of an arithmetic exercise. The clock exists so
     that a stalemate still ends, and last-man exists because it would be
     absurd if it did not. */
  function checkElimination() {
    for (let i = 0; i < M.order.length; i++) {
      const w = M.wl[M.order[i]];
      if (!w || !w.alive) continue;
      if (regionsOf(w.id) > 0) continue;
      /* A WARLORD WHOSE WHOLE ARMY IS STILL WALKING HAS NOT LOST. Without
         this, committing half your men and losing your last region in the
         same twenty seconds ends your match while the men who would have
         retaken it are mid-fight — an elimination the player could not have
         prevented and would not understand. */
      if (busy(w.id)) continue;
      w.alive = false;
      w.men = 0;
      note("out", wlName(w.id) + " holds nothing and is finished");
      W.emit("match:eliminated", w.id);
      if (w.id === M.me) W.toast("YOU HOLD NOTHING", "bad");
    }
  }
  function checkVictory(t) {
    if (M.over) return;
    const alive = living();
    if (alive.length === 1 && M.order.length > 1) return end(alive[0], "LAST WARLORD STANDING");
    if (!alive.length) return end(null, "THE ISLAND IS EMPTY");
    for (let i = 0; i < alive.length; i++) {
      const id = alive[i];
      if (share(id) >= DOM_PCT) {
        if (!M.domSince[id]) M.domSince[id] = t;
        if (t - M.domSince[id] >= DOM_HOLD) return end(id, "DOMINATION");
      } else {
        delete M.domSince[id];
      }
    }
    if (t >= M.len) {
      let best = alive[0];
      for (let i = 1; i < alive.length; i++) {
        const a = alive[i];
        if (regionsOf(a) > regionsOf(best) ||
            (regionsOf(a) === regionsOf(best) && M.wl[a].men > M.wl[best].men)) best = a;
      }
      return end(best, "TIME");
    }
  }
  function end(winner, why) {
    if (M.over) return;
    M.over = true; M.live = false;
    M.winner = winner; M.why = why;
    if (timer) { clearInterval(timer); timer = 0; }
    if (W.territory && W.territory.autoWar) { try { W.territory.autoWar(true); } catch (e) {} }
    if (isHost()) send("wlmend", { win: winner, why: why });
    note("end", (winner ? wlName(winner) : "NOBODY") + " wins — " + why);
    W.emit("match:over", { winner: winner, why: why });
    removeStrip();
    endgame();
  }

  /* ============================================================ THE WIRE */
  function sendSync() {
    const men = {};
    for (let i = 0; i < M.order.length; i++) men[M.order[i]] = Math.round(M.wl[M.order[i]].men);
    send("wlmsync", { t: matchT(), own: M.own, men: men, ally: Object.keys(M.ally) });
  }
  function recv(verb, m) {
    if (!m) return;
    if (verb === "wlmstart") { adoptStart(m); return; }
    if (!M.live) return;
    switch (verb) {
      case "wlmsync": {
        if (isHost()) return;                          // I am the one who sends these
        easeClock(m.t || 0);
        if (m.own) { for (const k in m.own) setOwner(k, m.own[k], true); }
        if (m.men) {
          for (const k in m.men) {
            if (!M.wl[k]) continue;
            if (k !== M.me) { M.wl[k].men = m.men[k]; continue; }
            /* MY OWN ARMY IS MINE — until it is plainly wrong. Both machines
               run the identical logistic on the identical region count, so
               they track each other to within a man; snapping every three
               seconds would make my own troop count flicker for no reason.
               A gap past 15% is not drift, it is a battle one side applied
               and the other did not, and then the host is right. */
            const gap = Math.abs(M.wl[k].men - m.men[k]);
            if (gap > Math.max(4, m.men[k] * 0.15)) M.wl[k].men = m.men[k];
          }
        }
        if (m.ally) {
          /* THE SYNC IS AUTHORITATIVE BUT IT IS NOT INSTANTANEOUS. A snapshot
             the host sent at t=44 arrives at t=45, by which time this client
             has already been told directly about an alliance sealed at 44.6 —
             and a straight overwrite DELETES it, for the up-to-three seconds
             until the next snapshot. Measured in the three-browser run: a
             bystander saw an alliance blink out and back in. So an alliance
             newer than the snapshot survives it; everything older obeys it. */
          const want = {};
          for (let i = 0; i < m.ally.length; i++) want[m.ally[i]] = M.ally[m.ally[i]] || matchT();
          for (const k in M.ally) if (M.ally[k] > (m.t || 0) - 1) want[k] = M.ally[k];
          M.ally = want;
        }
        checkElimination();
        paintStrip();
        if (boardOpen) drawBoard();
        break;
      }
      case "wlmatk": applyAttack(m); break;
      /* A RESULT IS NEWS, NOT AN ARGUMENT. It arrives from the battle's one
         owner and lands only if the deadline has not already settled it. */
      case "wlmres": settle(m.id, { win: !!m.win, al: m.al | 0, dl: m.dl | 0, src: "owner" }); break;
      case "wlmally": offerAlly(m.wid, m.to); break;
      case "wlmallyok": acceptAlly(m.wid, m.to); break;
      case "wlmbreak": breakAlly(m.wid, m.to); break;
      case "wlmend": end(m.win, m.why || "THE MATCH IS OVER"); break;
    }
  }

  function sendStart() {
    const slots = M.order.map(function (id) {
      const w = M.wl[id];
      return { id: w.id, name: w.name, slot: w.slot, ai: w.ai, peerId: w.peerId, colour: w.colour };
    });
    send("wlmstart", { seed: M.seed, len: M.len, slots: slots, t: matchT() });
  }
  function adoptStart(m) {
    if (M.live && M.seed === m.seed) {
      // a re-broadcast because somebody new joined: take the roster, keep the clock
      easeClock(m.t || 0);
      adoptSlots(m.slots);
      return;
    }
    begin({
      seed: m.seed, len: m.len, slots: m.slots, hostT: m.t,
      me: widForPeer(myPeerId()), host: false,
    });
  }
  function adoptSlots(slots) {
    if (!slots) return 0;
    let added = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (M.wl[s.id]) { M.wl[s.id].name = s.name; continue; }
      const w = makeWarlord(s);
      M.wl[s.id] = w;
      M.order.push(s.id);
      added++;
    }
    M.order.sort(function (a, b) { return M.wl[a].slot - M.wl[b].slot; });
    /* A WARLORD WHO ARRIVED MID-MATCH IS PLACED HERE, ON EVERY CLIENT, from
       the seed and his slot. The first version only placed people inside
       begin(), so a late joiner existed on the guests' scoreboards with no
       ground, no home and no colour on the map — visible, and not actually in
       the match. Nothing about the placement is sent; it never needs to be. */
    if (added && M.live) {
      assignHomes();
      for (let i = 0; i < M.order.length; i++) {
        const w = M.wl[M.order[i]];
        if (w.home && !ownerOf(w.home)) { setOwner(w.home, w.id, true); w.men = CAP_BASE * 0.5; }
      }
      registerOwners();
    }
    return added;
  }

  /* ============================================================ START
     One entry point for solo-with-AI, for hosting, and for joining, because
     three different start paths is three different first minutes and only one
     of them ever gets tested. */
  function begin(o) {
    o = o || {};
    M.live = true; M.over = false;
    M.seed = o.seed | 0 || (W.state.seed | 0) || 1337;
    M.len = o.len || MATCH_SEC;
    M.host = o.host !== false;
    M.me = o.me || "p0";
    M.own = {}; M.ally = {}; M.offers = {}; M.pending = {}; M.applied = {};
    M.wl = {}; M.order = []; M.fallen = []; M.events = []; M.samples = [];
    M.seq = 0; M.lastT = 0; M.lastSample = -1; M.lastSync = -1; M.lastThink = {};
    M.domSince = {}; M.stallMax = 0; M.tickAcc = 0; M.winner = null; M.why = "";
    REG = null; ADJ = null;

    /* THE WORLD IS THE SEED. newGame reseeds core's stream and puts you alone
       with a pistol — the game's opening, unchanged, in a match. Then the
       regions are DERIVED, not sent: the entire shared board costs four
       bytes on the wire, once. */
    W.newGame({ seed: M.seed, mode: "net", name: o.name || (meWL() && meWL().name) || "WARLORD" });
    /* AND THE ORDER OF THESE THREE LINES IS THE BUG THIS FILE ALREADY HAD.
       territory.js rasterises its regions from W.state.seed, so a board read
       before newGame() is the PREVIOUS seed's board — different ids, different
       neighbours, different names. The first version picked spawn points on
       that stale board and then handed them to a match running on the real
       one, and the only symptom was a spawn separation that changed every time
       you looked at it. Reseed, THEN build, THEN place. */
    REG = null; ADJ = null;
    buildRegions();

    M.T0 = nowMs() - (o.hostT || 0) * 1000;

    adoptSlots(o.slots);
    if (!M.order.length) console.warn("[match] started with no warlords");
    /* Homes are computed here, on every client, from the seed and the slot —
       so they are never on the wire and can never disagree. */
    assignHomes();
    for (let i = 0; i < M.order.length; i++) {
      const w = M.wl[M.order[i]];
      if (w.home && !ownerOf(w.home)) { setOwner(w.home, w.id, true); w.men = CAP_BASE * 0.5; }
    }

    // put every warlord on his home region, and you on the ground at yours
    const mine = M.wl[M.me];
    if (mine && mine.home) {
      const r = region(mine.home);
      if (r) { W.state.you.x = r.x; W.state.you.z = r.z; }
    }
    syncMyArmy();

    registerOwners();
    wireLifecycle();
    /* TWO CONQUEST ENGINES ON ONE MAP IS THE BUG THIS WHOLE FILE EXISTS TO
       AVOID. territory.js runs its own faction war on the day clock
       (warDawn), which is exactly right for the singleplayer campaign and
       exactly wrong in a match, where the front moves because a warlord
       ordered it to. Off for the duration, back on at the end — it is a
       shared module and this file borrowed it. */
    if (W.territory && W.territory.autoWar) { try { W.territory.autoWar(false); } catch (e) {} }

    wire();
    if (timer) clearInterval(timer);
    /* setInterval, not rAF: rAF is the thing that stops when the tab hides,
       and this is the one loop in the game that is not allowed to. It is 1 Hz
       and every rule inside integrates over real elapsed time, so even the
       throttled 1-per-second a hidden tab gets is enough. */
    timer = setInterval(tick, 1000);
    makeStrip();
    note("start", "the match begins — " + M.order.length + " warlords, " +
      regions().length + " regions, " + Math.round(M.len / 60) + " minutes");
    W.emit("match:start", M);
    if (W.campaign && W.campaign.enter) { try { W.campaign.enter(); } catch (e) {} }
    tick();
  }

  function joinWarlord(o) {
    const used = {};
    for (let i = 0; i < M.order.length; i++) used[M.wl[M.order[i]].slot] = 1;
    let slot = 0;
    while (used[slot] && slot < SLOTS) slot++;
    if (slot >= SLOTS) return null;
    const id = o.peerId != null ? widForPeer(o.peerId) : (o.ai ? "ai" + slot : "p" + slot);
    if (M.wl[id]) return M.wl[id];
    const w = makeWarlord({ id: id, name: o.name, slot: slot, ai: !!o.ai, peerId: o.peerId });
    M.wl[id] = w;
    M.order.push(id);
    M.order.sort(function (a, b) { return M.wl[a].slot - M.wl[b].slot; });
    assignHomes();
    return w;
  }
  /* HOMES ARE DERIVED, NOT SENT — and they are indexed by SLOT off a full
     eight-point set rather than by how many warlords happen to be here.

     The first version sampled exactly as many points as there were players
     and handed them out in join order, which has two faults that only show up
     in a real lobby: a warlord's home MOVED when somebody else joined, and
     the eight-player board was a different board from the three-player one on
     the same seed. Slot is the one identity that is stable from the lobby to
     the last minute, so it is what indexes the placement. */
  function assignHomes() {
    const pts = spawnPoints(SLOTS);
    for (let i = 0; i < M.order.length; i++) {
      const w = M.wl[M.order[i]];
      const p = pts[w.slot % pts.length] || pts[i % pts.length];
      if (!p) continue;
      w.home = p.id;
    }
  }

  /* ============================================================ CSS */
  let styled = false;
  function styleOnce() {
    if (styled || !G.document) return;
    styled = true;
    const s = G.document.createElement("style");
    s.textContent = `
    #wl-match{position:fixed;left:0;right:0;bottom:0;z-index:var(--z-match,64);
      padding:8px calc(var(--wl-safe-r, env(safe-area-inset-right,0px)) + 12px)
              calc(var(--wl-safe-b, env(safe-area-inset-bottom,0px)) + 8px)
              calc(var(--wl-safe-l, env(safe-area-inset-left,0px)) + 12px);
      background:linear-gradient(#0000,#0b0906 42%);display:none;
      font:600 12px/1.25 ui-sans-serif,system-ui,-apple-system,sans-serif}
    #wl-match.on{display:block}
    .mt-top{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:6px}
    .mt-t{font-size:19px;letter-spacing:.06em;font-variant-numeric:tabular-nums}
    .mt-t.hot{color:#ff8a3d}
    .mt-goal{font-size:10px;letter-spacing:.18em;opacity:.6}
    .mt-bar{display:flex;height:9px;border-radius:5px;overflow:hidden;background:rgba(255,255,255,.09)}
    .mt-bar i{display:block;height:100%}
    .mt-bar .neu{background:rgba(255,255,255,.13)}
    .mt-line{border-left:2px solid #fff6;margin-left:-1px}
    .mt-act{display:flex;gap:8px;align-items:center;margin-top:7px}
    .mt-act .wl-btn{padding:8px 13px;font-size:12px;pointer-events:auto}
    .mt-you{display:flex;gap:8px;align-items:center;font-size:11px;letter-spacing:.14em;opacity:.85}
    .mt-dot{width:11px;height:11px;border-radius:3px;display:inline-block;flex:0 0 auto}
    .mt-warn{color:#ffc9c4}
    .mt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:7px}
    .mt-reg{border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 9px;
      background:rgba(255,255,255,.03);cursor:pointer;text-align:left;width:100%;
      display:flex;flex-direction:column;gap:3px}
    .mt-reg:disabled{opacity:.4;cursor:default}
    .mt-reg b{font-size:11px;letter-spacing:.1em;display:flex;gap:6px;align-items:center}
    .mt-reg span{font-size:10px;letter-spacing:.1em;opacity:.6}
    .mt-reg.hit{border-color:#ff8a3d;background:rgba(255,138,61,.13)}
    .mt-reg.fight{border-color:#c4453a;background:rgba(196,69,58,.16);animation:mtP 1s infinite}
    @keyframes mtP{50%{background:rgba(196,69,58,.32)}}
    .mt-wl{display:flex;gap:9px;align-items:center;padding:7px 0;
      border-bottom:1px solid rgba(255,255,255,.07)}
    .mt-wl:last-child{border-bottom:0}
    .mt-wl b{flex:1;font-size:12px;letter-spacing:.08em;min-width:0;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .mt-tag{font-size:9px;letter-spacing:.16em;border:1px solid rgba(255,255,255,.2);
      border-radius:5px;padding:2px 5px;opacity:.75}
    .mt-tag.ally{border-color:#5aa86a;color:#c9ffd4;opacity:1}
    .mt-tag.you{border-color:#ff8a3d;color:#ffd7bd;opacity:1}
    .mt-tag.out{opacity:.4}
    .mt-num{font-variant-numeric:tabular-nums;font-size:12px;opacity:.8;min-width:52px;text-align:right}
    .mt-spark{width:100%;height:64px;display:block}
    .mt-roll{columns:2;column-gap:16px;font-size:11px;letter-spacing:.05em;opacity:.72;
      max-height:190px;overflow:auto}
    .mt-roll div{break-inside:avoid;padding:1px 0}
    .mt-led div{padding:3px 0;font-size:11px;letter-spacing:.06em;
      border-bottom:1px solid rgba(255,255,255,.05)}
    .mt-led .betray{color:#ffc9c4}
    .mt-led .ally{color:#c9ffd4}
    .mt-swatch{display:flex;gap:7px;flex-wrap:wrap;margin-top:6px}
    .mt-sw{width:30px;height:30px;border-radius:8px;border:2px solid transparent;cursor:pointer}
    .mt-sw.on{border-color:#fff}
    .mt-in{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);
      border-radius:10px;padding:10px 12px;color:inherit;font:inherit;letter-spacing:.06em}
    body.coarse .mt-act .wl-btn{padding:11px 15px}
    @media (max-width:420px){ .mt-t{font-size:17px} .mt-grid{grid-template-columns:repeat(auto-fill,minmax(108px,1fr))} }
    `;
    G.document.head.appendChild(s);
  }

  /* ============================================================ THE STRIP
     What is on screen the whole match, and it is deliberately three facts and
     one button: how long is left, who owns the island, and how far the leader
     is from winning. The territory bar IS the progress toward victory — it is
     the same picture as the win condition, so nobody has to be told the rule. */
  function makeStrip() {
    styleOnce();
    if (!G.document) return;
    removeStrip();
    strip = G.document.createElement("div");
    strip.id = "wl-match";
    strip.className = "on";
    G.document.body.appendChild(strip);
    paintStrip();
    publishHeight();
  }
  /* THE STRIP TELLS THE PAGE HOW TALL IT IS, and this is not decoration: the
     match bar and the verb rail are both fixed to the bottom at z-index 55,
     so on a live match the bar sat ON TOP of the encounter's buttons and
     ATTACK / DEMAND / RIDE AWAY were unclickable — cut off by a strip that
     was drawn after them. A typed offset in the page's CSS would be wrong
     the moment this bar gains or loses a row, so it publishes its measured
     height as --wl-footer and the rail docks above whatever that is. Zero
     when there is no match, which is the singleplayer layout unchanged. */
  function publishHeight() {
    if (!G.document || !G.document.documentElement) return;
    /* getBoundingClientRect, NOT offsetParent: a position:fixed element has
       no offsetParent — it is null even when the strip is on screen — so the
       first version of this published 0 every time and the rail went right on
       sitting under the bar it was supposed to clear. */
    const vis = strip && G.getComputedStyle(strip).display !== "none";
    const h = vis ? Math.ceil(strip.getBoundingClientRect().height) : 0;
    G.document.documentElement.style.setProperty("--wl-footer", (h || 0) + "px");
  }
  function removeStrip() {
    if (strip && strip.parentNode) strip.parentNode.removeChild(strip);
    strip = null;
    if (G.document && G.document.documentElement) {
      G.document.documentElement.style.setProperty("--wl-footer", "0px");
    }
  }
  function territoryBar(markLeader) {
    const total = Math.max(1, regions().length);
    let html = '<div class="mt-bar">';
    let neutral = total;
    for (let i = 0; i < M.order.length; i++) {
      const id = M.order[i], n = regionsOf(id);
      if (!n) continue;
      neutral -= n;
      html += '<i style="width:' + (n / total * 100).toFixed(2) + '%;background:' + hex(M.wl[id].colour) + '"></i>';
    }
    if (neutral > 0) html += '<i class="neu" style="width:' + (neutral / total * 100).toFixed(2) + '%"></i>';
    html += "</div>";
    if (markLeader) {
      html = '<div style="position:relative">' + html +
        '<div style="position:absolute;top:-3px;bottom:-3px;left:' + (DOM_PCT * 100) +
        '%;width:0;border-left:2px dashed rgba(255,255,255,.55)"></div></div>';
    }
    return html;
  }
  function paintStrip() {
    if (!strip) return;
    const t = matchT(), left = timeLeft();
    const me = meWL();
    const lead = leader();
    const hot = left < 120;
    const dom = lead ? share(lead) : 0;
    let goal = "MOST GROUND AT 0:00";
    if (lead && M.domSince[lead]) {
      goal = wlName(lead) + " HOLDS IN " + Math.ceil(DOM_HOLD - (t - M.domSince[lead])) + "s";
    } else if (lead) {
      goal = wlName(lead) + " " + Math.round(dom * 100) + "% · " + Math.round(DOM_PCT * 100) + "% WINS";
    }
    const offers = Object.keys(M.offers).length;
    const fights = Object.keys(M.pending).length;
    strip.innerHTML =
      '<div class="mt-top">' +
        '<div class="mt-t' + (hot ? " hot" : "") + '">' + clock(left) + '</div>' +
        '<div class="mt-goal">' + esc(goal) + '</div>' +
      '</div>' +
      territoryBar(true) +
      '<div class="mt-act">' +
        '<div class="mt-you">' +
          (me ? '<i class="mt-dot" style="background:' + hex(me.colour) + '"></i>' + esc(me.name) : "") +
          '<span>' + regionsOf(M.me) + ' REGIONS</span>' +
          '<span>' + Math.round(me ? me.men : 0) + ' MEN</span>' +
          (fights ? '<span class="mt-warn">' + fights + ' FIGHTING</span>' : "") +
        '</div>' +
        '<button class="wl-btn hot" id="mtBoard">BOARD' + (offers ? " ·" + offers : "") + '</button>' +
      '</div>';
    const b = strip.querySelector("#mtBoard");
    if (b) b.onclick = function () { boardOpen ? closeBoard() : board(); };
    // the bar grows a row when somebody is fighting — republish, or the verb
    // rail is docked above a height this strip stopped being two paints ago
    publishHeight();
  }
  function leader() {
    const a = living();
    if (!a.length) return null;
    let best = a[0];
    for (let i = 1; i < a.length; i++) if (regionsOf(a[i]) > regionsOf(best)) best = a[i];
    return best;
  }

  /* ============================================================ THE LOBBY
     openfront's lobby is the model: you watch a match fill up, you pick your
     colour and your name, you see who else is in, and it starts. The one
     addition this game needs is SOLO WITH AI on the same screen, because a
     lobby that needs friends before you can try it is a lobby nobody tries. */
  /* `+(Q.get("matchai") || 3)` — the version this replaces — read ?matchai=0
     as three AI warlords, because "0" is a truthy string. The one place a
     falsy-looking query value is meaningful is the one place it broke. */
  const AI_Q = Q.get("matchai");
  let LOBBY = { name: "", slot: 0, url: "",
                ai: AI_Q == null || AI_Q === "" ? 3 : Math.max(0, Math.min(SLOTS - 1, +AI_Q || 0)) };
  let SEED_HINT = 0;             // the island somebody else already declared
  function lobby() {
    if (OFF) {                                        // ?match=old — the revert
      if (W.warnet && W.warnet.lobby) return W.warnet.lobby();
      return;
    }
    styleOnce();
    if (!ctx) { console.warn("[match] lobby before boot"); return; }
    W.setPhase("menu");
    if (!LOBBY.name) {
      try { LOBBY.name = localStorage.getItem("cbz-wl-name") || ""; } catch (e) {}
      if (!LOBBY.name) LOBBY.name = "WARLORD " + (1 + Math.floor(Math.random() * 89));
    }
    drawLobby();
  }
  /* EVERYONE IN THE ROOM, ME INCLUDED — and that "me included" is not
     defensive padding, it is a fix. net.js's player table is everyone ELSE;
     the first version built the lobby straight off it, so the host started a
     match whose roster did not contain the host. He watched three other
     warlords ride out on an island he owned nothing on.

     Sorted by relay id, which is the one ordering every client already agrees
     on without sending anything, and it is therefore what slots are cut from. */
  function lobbyPlayers() {
    const out = [];
    const online = !!(CBZ.net && CBZ.net.active);
    if (online && CBZ.net.players) {
      CBZ.net.players.forEach(function (p) {
        if (p.id === CBZ.net.id) return;
        out.push({ id: p.id, name: p.name, me: false });
      });
    }
    out.push({ id: online ? CBZ.net.id : 0, name: LOBBY.name, me: true });
    out.sort(function (a, b) { return a.id - b.id; });
    return out;
  }
  function drawLobby() {
    const inRoom = lobbyPlayers();
    const online = !!(CBZ.net && CBZ.net.active);
    let rows = "";
    for (let i = 0; i < inRoom.length; i++) {
      const p = inRoom[i];
      const c = COLS[(p.me ? LOBBY.slot : p.id) % COLS.length];
      rows += '<div class="mt-wl">' +
        '<i class="mt-dot" style="background:' + hex(c) + '"></i>' +
        '<b>' + esc(p.me ? LOBBY.name : p.name) + '</b>' +
        (p.me ? '<span class="mt-tag you">YOU</span>' : '<span class="mt-tag">READY</span>') +
      '</div>';
    }
    for (let i = 0; i < LOBBY.ai; i++) {
      const c = COLS[(inRoom.length + i) % COLS.length];
      rows += '<div class="mt-wl">' +
        '<i class="mt-dot" style="background:' + hex(c) + '"></i>' +
        '<b>' + esc(aiName(inRoom.length + i)) + '</b>' +
        '<span class="mt-tag">AI WARLORD</span>' +
      '</div>';
    }
    const total = inRoom.length + LOBBY.ai;
    let sw = '<div class="mt-swatch">';
    for (let i = 0; i < COLS.length; i++) {
      sw += '<div class="mt-sw' + (i === LOBBY.slot ? " on" : "") +
        '" data-sw="' + i + '" style="background:' + hex(COLS[i]) + '"></div>';
    }
    sw += "</div>";

    ctx.screen(
      '<h1 class="wl-h">THE <em>MATCH</em></h1>' +
      '<p class="wl-sub">ONE ISLAND · ' + total + ' WARLORDS · ' + MATCH_MIN + ' MINUTES</p>' +

      '<div class="wl-card">' +
        '<div class="wl-small wl-dim">Everybody starts alone with a pistol, somewhere on fourteen ' +
        'kilometres of sand. Take ground, it makes men. Hold ' + Math.round(DOM_PCT * 100) +
        '% for ' + DOM_HOLD + ' seconds and the island is yours. <b>The clock never stops</b> — ' +
        'not for a battle, not for a menu, not for anybody.</div>' +
      '</div>' +

      '<div class="wl-lbl">YOU</div>' +
      '<div class="wl-card">' +
        '<input class="mt-in" id="mtName" maxlength="18" value="' + esc(LOBBY.name) + '" placeholder="your name">' +
        sw +
      '</div>' +

      '<div class="wl-lbl">IN THE MATCH — ' + total + '/' + SLOTS + '</div>' +
      '<div class="wl-card">' + rows + '</div>' +

      '<div class="wl-btns">' +
        '<button class="wl-btn" id="mtAiLess">AI −</button>' +
        '<button class="wl-btn" id="mtAiMore">AI +</button>' +
      '</div>' +

      '<div class="wl-lbl">SERVER</div>' +
      '<div class="wl-card">' +
        (online
          ? '<div class="wl-row"><span>CONNECTED</span><span class="wl-gold">' +
              esc((CBZ.net.server && CBZ.net.server.name) || "relay") + '</span></div>'
          : '<input class="mt-in" id="mtUrl" placeholder="ws://localhost:8000/ws — leave blank to play the AI">') +
        '<div class="wl-small wl-dim" style="margin-top:8px">Run one yourself: ' +
          '<b>node server/server.js</b>, then share the address. Nobody needs an account.</div>' +
      '</div>' +

      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="mtGo" data-boot-entry>' +
          (online ? "START THE MATCH" : (LOBBY.ai ? "RIDE OUT AGAINST THE AI" : "RIDE OUT")) + '</button>' +
        (online ? "" : '<button class="wl-btn" id="mtJoin">JOIN A SERVER</button>') +
        '<button class="wl-btn ghost" id="mtBack">BACK</button>' +
      '</div>'
    );

    const nm = ctx.el("mtName");
    if (nm) nm.oninput = function () {
      LOBBY.name = nm.value.slice(0, 18) || "WARLORD";
      try { localStorage.setItem("cbz-wl-name", LOBBY.name); } catch (e) {}
    };
    const stage = ctx.el("stage");
    const sws = stage ? stage.querySelectorAll("[data-sw]") : [];
    for (let i = 0; i < sws.length; i++) {
      sws[i].onclick = function () { LOBBY.slot = +this.getAttribute("data-sw"); drawLobby(); };
    }
    ctx.el("mtAiLess").onclick = function () { LOBBY.ai = Math.max(0, LOBBY.ai - 1); drawLobby(); };
    ctx.el("mtAiMore").onclick = function () {
      LOBBY.ai = Math.min(SLOTS - inRoom.length, LOBBY.ai + 1); drawLobby();
    };
    const j = ctx.el("mtJoin");
    if (j) j.onclick = function () {
      const u = ctx.el("mtUrl");
      LOBBY.url = (u && u.value) || "";
      joinServer(LOBBY.url);
    };
    ctx.el("mtBack").onclick = function () { ctx.closeScreen(); W.emit("mainmenu"); };
    ctx.el("mtGo").onclick = function () { startFromLobby(); };
  }
  function aiName(i) {
    const A = ["TARIQ", "VOSK", "MBEKI", "SERRA", "HALLORAN", "OYELARAN", "KOVIC", "AMARI"];
    return A[i % A.length] + " THE " +
      ["RED", "PATIENT", "CROOKED", "QUIET", "GREEDY", "LAME", "BLIND", "YOUNGER"][(i * 3) % 8];
  }
  function joinServer(url) {
    /* warnet owns the socket. This asks it to connect and then waits for its
       own `wlmstart` — a lobby that opened its own WebSocket would be a second
       transport, which is exactly the duplication CLAUDE.md warns about. */
    if (W.warnet && W.warnet.connect) {
      try {
        W.warnet.connect({ url: url, name: LOBBY.name });
        W.toast("connecting…", "");
        setTimeout(function () { wire(); drawLobby(); }, 900);
        return;
      } catch (e) {}
    }
    W.toast("multiplayer transport did not load", "bad");
  }
  /* THE ROSTER. SLOT IS POSITION IN THE ID-SORTED ROOM, full stop — it is
     identity (which spawn you get, which colour you are) and it must be the
     same integer on every machine, so it is derived from the one ordering the
     relay already imposes rather than negotiated.

     The previous version tried to let a player's COLOUR choice set his slot,
     and the arithmetic for skipping a taken slot (`slot === LOBBY.slot ? ++slot
     : slot` inside a loop that also incremented slot) produced duplicate and
     skipped slots the moment three people were in the room. Colour is a
     preference; slot is an identity; conflating them was the mistake. */
  function startFromLobby() {
    const inRoom = lobbyPlayers();
    M.me = widForPeer(myPeerId());
    M.wl = {}; M.order = [];
    const slots = [];
    for (let i = 0; i < inRoom.length && i < SLOTS; i++) {
      const p = inRoom[i];
      slots.push({
        id: widForPeer(p.id), name: p.me ? LOBBY.name : p.name,
        slot: i, ai: false, peerId: p.id,
        /* YOUR COLOUR IS YOURS; EVERYBODY ELSE'S IS DERIVED. The host builds
           this roster and only knows its OWN pick, so a guest is painted the
           colour warnet already paints him — COLS[peerId % 8], the identical
           rule, so the lobby, the board and the map cannot disagree. Letting a
           guest carry his own choice needs one line of lobby identity on the
           wire and warnet is the right place for it; see the report. */
        colour: p.me ? COLS[LOBBY.slot % COLS.length] : COLS[p.id % COLS.length],
      });
    }
    // no two warlords the same colour, resolved by slot order without a message
    for (let i = 0; i < slots.length; i++) {
      for (let k = 0; k < i; k++) {
        if (slots[k].colour !== slots[i].colour) continue;
        let c = 0;
        while (slots.some(function (x) { return x.colour === COLS[c % COLS.length]; }) && c < COLS.length) c++;
        slots[i].colour = COLS[c % COLS.length];
        break;
      }
    }
    for (let i = 0; slots.length < SLOTS && i < LOBBY.ai; i++) {
      const sl = slots.length;
      slots.push({ id: "ai" + sl, name: aiName(sl), slot: sl, ai: true, peerId: null,
                   colour: COLS[sl % COLS.length] });
    }
    const seed = SEED_HINT || (parseInt(Q.get("seed") || "", 10) || (W.state.seed | 0) || 1337);
    /* THE ISLAND IS ANNOUNCED THROUGH warnet's OWN HANDSHAKE, not just inside
       wlmstart. warnet gates its peer layer (the other warlords as parties on
       your map) on having a world, so a match that only told its own protocol
       would leave everybody invisible to everybody on the sand. Four bytes,
       one call, and both layers know the same island. */
    if (!SEED_HINT && W.warnet && W.warnet.setWorld) {
      try { W.warnet.setWorld({ seed: seed, day: 1, hour: 7 }); } catch (e) {}
    }
    ctx.closeScreen();
    begin({ seed: seed, len: MATCH_SEC, slots: slots, me: M.me, host: true, name: LOBBY.name, hostT: 0 });
    sendStart();
  }

  /* ============================================================ THE BOARD
     NOT A MAP — territory.js owns the map and this must never become a second
     one. This is the RULES panel: who is in, how much they hold, who you are
     allied to, and the regions on your own frontier that you may attack. Two
     taps and nothing else: tap a region to send half your men, tap a warlord
     to ally or to break. The MAP button hands off to territory.js when it is
     there. */
  function board() {
    if (OFF || !ctx) return;
    styleOnce();
    boardOpen = true;
    drawBoard();
  }
  function closeBoard() { boardOpen = false; if (ctx) ctx.closeScreen(); paintStrip(); }

  function frontier(wid) {
    const out = [];
    const L = regions();
    for (let i = 0; i < L.length; i++) if (canAttack(wid, L[i].id)) out.push(L[i]);
    out.sort(function (a, b) { return defenceOf(a.id) - defenceOf(b.id); });
    return out;
  }
  function drawBoard() {
    if (!boardOpen || !ctx) return;
    const me = meWL();
    const t = matchT();
    const mine = me ? Math.floor(me.men * COMMIT) : 0;

    // ---- the warlords
    let wls = "";
    for (let i = 0; i < M.order.length; i++) {
      const id = M.order[i], w = M.wl[id];
      const isMe = id === M.me;
      const al = allied(M.me, id);
      const pct = Math.round(share(id) * 100);
      wls += '<div class="mt-wl">' +
        '<i class="mt-dot" style="background:' + hex(w.colour) + '"></i>' +
        '<b>' + esc(w.name) + '</b>' +
        (isMe ? '<span class="mt-tag you">YOU</span>' : "") +
        (al ? '<span class="mt-tag ally">ALLY</span>' : "") +
        (w.ai ? '<span class="mt-tag">AI</span>' : "") +
        (!w.alive ? '<span class="mt-tag out">OUT</span>' : "") +
        (w.betrayals ? '<span class="mt-tag">' + w.betrayals + '×BETRAYED</span>' : "") +
        '<span class="mt-num">' + pct + '% · ' + Math.round(w.men) + '</span>' +
        (isMe || !w.alive ? "" :
          '<button class="wl-btn' + (al ? " bad" : "") + '" data-dip="' + id + '" ' +
            'style="padding:6px 10px;font-size:11px">' + (al ? "BREAK" : "ALLY") + '</button>') +
      '</div>';
    }

    // ---- an alliance offer waiting on me is the loudest thing on the screen
    let offers = "";
    for (const from in M.offers) {
      if (!M.wl[from]) continue;
      offers += '<div class="wl-card" style="border-color:#5aa86a">' +
        '<div class="wl-row"><span>' + esc(wlName(from)) + ' OFFERS AN ALLIANCE</span></div>' +
        '<div class="wl-btns">' +
          '<button class="wl-btn hot" data-yes="' + from + '">ACCEPT</button>' +
          '<button class="wl-btn ghost" data-no="' + from + '">NO</button>' +
        '</div></div>';
    }

    // ---- the frontier
    const F = frontier(M.me);
    let regs = "";
    for (let i = 0; i < F.length && i < 24; i++) {
      const r = F[i];
      const o = ownerOf(r.id);
      const d = defenceOf(r.id);
      const fighting = fightingAt(r.id);
      const win = mine > d;
      regs += '<button class="mt-reg' + (fighting ? " fight" : win ? " hit" : "") + '" data-r="' + r.id + '"' +
        (fighting ? " disabled" : "") + '>' +
        '<b><i class="mt-dot" style="background:' + (o ? hex(M.wl[o].colour) : "rgba(255,255,255,.2)") + '"></i>' +
          esc(r.name) + '</b>' +
        '<span>' + (fighting ? "FIGHTING · " + Math.ceil(fighting) + "s" :
          d + " HOLD IT" + (o ? " · " + esc(wlName(o)) : " · NOBODY")) + '</span>' +
      '</button>';
    }
    if (!F.length) {
      regs = '<div class="wl-small wl-dim">Nothing on your border you may attack. Allies are not ' +
        'targets — break with one if you want his ground.</div>';
    }

    const lead = leader();
    ctx.screen(
      '<h1 class="wl-h">THE <em>BOARD</em></h1>' +
      '<p class="wl-sub">' + clock(timeLeft()) + ' LEFT · ' + regionsOf(M.me) + ' REGIONS · ' +
        Math.round(me ? me.men : 0) + ' MEN</p>' +
      '<div class="wl-card">' + territoryBar(true) +
        '<div class="wl-small wl-dim" style="margin-top:8px">' +
          (lead ? esc(wlName(lead)) + ' leads with ' + Math.round(share(lead) * 100) + '%. ' : "") +
          'The dashed line is ' + Math.round(DOM_PCT * 100) + '% — hold past it for ' + DOM_HOLD +
          's and the match ends.</div>' +
      '</div>' +
      offers +
      '<div class="wl-lbl">SEND ' + mine + ' MEN</div>' +
      '<div class="mt-grid">' + regs + '</div>' +
      '<div class="wl-lbl">WARLORDS</div>' +
      '<div class="wl-card">' + wls + '</div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="mtClose">BACK TO THE SAND</button>' +
        (terrMap() ? '<button class="wl-btn" id="mtMap">THE MAP</button>' : "") +
      '</div>'
    );

    const stage = ctx.el("stage");
    const rs = stage.querySelectorAll("[data-r]");
    for (let i = 0; i < rs.length; i++) {
      rs[i].onclick = function () {
        const rid = this.getAttribute("data-r");
        if (attack(M.me, rid)) { drawBoard(); }
        else W.toast("not enough men", "bad");
      };
    }
    const ds = stage.querySelectorAll("[data-dip]");
    for (let i = 0; i < ds.length; i++) {
      ds[i].onclick = function () {
        const id = this.getAttribute("data-dip");
        if (allied(M.me, id)) {
          breakAlly(M.me, id);
          send("wlmbreak", { wid: M.me, to: id });
        } else {
          offerAlly(M.me, id);
          send("wlmally", { wid: M.me, to: id });
          W.toast("offer sent to " + wlName(id), "");
        }
        drawBoard();
      };
    }
    const ys = stage.querySelectorAll("[data-yes]");
    for (let i = 0; i < ys.length; i++) {
      ys[i].onclick = function () {
        const id = this.getAttribute("data-yes");
        acceptAlly(M.me, id);
        send("wlmallyok", { wid: M.me, to: id });
        drawBoard();
      };
    }
    const ns = stage.querySelectorAll("[data-no]");
    for (let i = 0; i < ns.length; i++) {
      ns[i].onclick = function () { delete M.offers[this.getAttribute("data-no")]; drawBoard(); };
    }
    ctx.el("mtClose").onclick = closeBoard;
    const mp = ctx.el("mtMap");
    if (mp) mp.onclick = function () { closeBoard(); const f = terrMap(); if (f) try { f(); } catch (e) {} };
  }
  /* territory.js owns the strategic map and opens it itself. Which name it
     opens under has changed twice while this game was being written, so ask
     for any of them rather than pinning one and losing the button. */
  function terrMap() {
    const T = W.territory;
    if (!T) return null;
    return T.toggle || T.open || T.map || null;
  }
  function fightingAt(rid) {
    const t = matchT();
    for (const id in M.pending) if (M.pending[id].rid === rid) return Math.max(0, M.pending[id].due - t);
    return 0;
  }

  /* ============================================================ THE END
     The last screen is the one people screenshot, so it is the one screen in
     this file allowed to be long. Five things, in the order they are argued
     about afterwards: who won, the shape of the whole match, what each warlord
     did, who betrayed whom and when, and the dead by name. */
  function endgame() {
    if (!ctx) return;
    styleOnce();
    boardOpen = false;
    W.setPhase("over");
    const win = M.winner ? M.wl[M.winner] : null;
    const iWon = M.winner === M.me;

    // ---- territory over time
    const spark = sparkline();

    // ---- the table
    const rank = M.order.slice().sort(function (a, b) {
      const d = regionsOf(b) - regionsOf(a);
      return d || (M.wl[b].men - M.wl[a].men);
    });
    let rows = "";
    for (let i = 0; i < rank.length; i++) {
      const w = M.wl[rank[i]];
      rows += '<div class="mt-wl">' +
        '<i class="mt-dot" style="background:' + hex(w.colour) + '"></i>' +
        '<b>' + esc(w.name) + '</b>' +
        (rank[i] === M.me ? '<span class="mt-tag you">YOU</span>' : "") +
        (w.ai ? '<span class="mt-tag">AI</span>' : "") +
        (!w.alive ? '<span class="mt-tag out">OUT</span>' : "") +
        (w.betrayals ? '<span class="mt-tag">' + w.betrayals + '× BETRAYAL</span>' : "") +
        '<span class="mt-num">' + Math.round(share(rank[i]) * 100) + '%</span>' +
        '<span class="mt-num">' + Math.round(w.raised) + ' RAISED</span>' +
        '<span class="mt-num">' + w.won + '/' + w.battles + ' WON</span>' +
        '<span class="mt-num">' + w.killed + ' KILLED</span>' +
      '</div>';
    }

    // ---- the ledger: alliances and betrayals, in order
    let led = "";
    for (let i = 0; i < M.events.length; i++) {
      const e = M.events[i];
      if (e.kind !== "ally" && e.kind !== "betray" && e.kind !== "out" && e.kind !== "end") continue;
      led += '<div class="' + e.kind + '"><span class="wl-dim">' + clock(e.t) + '</span> ' + esc(e.text) + '</div>';
    }
    if (!led) led = '<div class="wl-dim">Nobody trusted anybody.</div>';

    // ---- the dead, by name
    let roll = "";
    const mineDead = M.fallen.filter(function (f) { return f.wid === M.me; });
    for (let i = 0; i < mineDead.length && i < 120; i++) {
      roll += "<div>" + esc(mineDead[i].name) + "</div>";
    }
    if (!roll) roll = '<div class="wl-dim">You lost nobody. Nobody will remember you either.</div>';

    ctx.screen(
      '<h1 class="wl-h">' + (win ? esc(win.name) + ' <em>WINS</em>' : 'NOBODY <em>WINS</em>') + '</h1>' +
      '<p class="wl-sub">' + esc(M.why) + ' · ' + clock(Math.min(matchT(), M.len)) + ' · ' +
        M.order.length + ' WARLORDS</p>' +

      '<div class="wl-card">' +
        '<div class="wl-small ' + (iWon ? "wl-gold" : "wl-dim") + '">' +
          (iWon ? "The island is yours." :
           win ? "You did not win. " + esc(win.name) + " did." : "The clock ran out on all of you.") +
        '</div>' +
      '</div>' +

      '<div class="wl-lbl">THE ISLAND, MINUTE BY MINUTE</div>' +
      '<div class="wl-card">' + spark + '</div>' +

      '<div class="wl-lbl">THE WARLORDS</div>' +
      '<div class="wl-card">' + rows + '</div>' +

      '<div class="wl-lbl">WHO BETRAYED WHOM</div>' +
      '<div class="wl-card mt-led">' + led + '</div>' +

      '<div class="wl-lbl">YOUR DEAD — ' + mineDead.length + ' MEN</div>' +
      '<div class="wl-card mt-roll">' + roll + '</div>' +

      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="mtAgain">ANOTHER MATCH</button>' +
        '<button class="wl-btn ghost" id="mtMenu">MAIN MENU</button>' +
      '</div>'
    );
    ctx.el("mtAgain").onclick = function () { lobby(); };
    ctx.el("mtMenu").onclick = function () { ctx.closeScreen(); W.emit("mainmenu"); };
  }

  /* TERRITORY OVER TIME, as inline SVG. A stacked area would be prettier and
     is unreadable at 393pt with eight bands in it; eight separate lines with
     the warlord's own colour is the picture people actually read — you can see
     the moment somebody's line breaks, which is the moment somebody betrayed
     somebody, and those are the same instant on the ledger below. */
  function sparkline() {
    const S = M.samples;
    const total = Math.max(1, regions().length);
    const w = 600, h = 120, pad = 4;
    if (S.length < 2) return '<div class="wl-small wl-dim">The match was too short to draw.</div>';
    let paths = "";
    for (let i = 0; i < M.order.length; i++) {
      const id = M.order[i];
      let d = "";
      for (let j = 0; j < S.length; j++) {
        const x = pad + (j / (S.length - 1)) * (w - pad * 2);
        const y = h - pad - ((S[j].share[id] || 0) / total) * (h - pad * 2);
        d += (j ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }
      paths += '<path d="' + d + '" fill="none" stroke="' + hex(M.wl[id].colour) +
        '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" opacity="' +
        (id === M.me ? "1" : ".72") + '"/>';
    }
    // the domination line, so the picture and the win condition are one image
    const dy = h - pad - DOM_PCT * (h - pad * 2);
    paths += '<line x1="' + pad + '" x2="' + (w - pad) + '" y1="' + dy + '" y2="' + dy +
      '" stroke="rgba(255,255,255,.4)" stroke-width="1.5" stroke-dasharray="5 5"/>';
    return '<svg class="mt-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      paths + '</svg>' +
      '<div class="wl-small wl-dim" style="margin-top:6px">Each line is one warlord\'s share of the ' +
      'island. The dashed line is ' + Math.round(DOM_PCT * 100) + '%.</div>';
  }

  /* ============================================================ DEMO
     ?match=demo — a running match with AI warlords and a plausible board,
     fast-forwarded so the picture is a mid-match one rather than eight men on
     eight empty regions. It exists because ten agents are writing this game at
     once and a screen that can only be reached through a working relay, a
     working territory.js and two friends is a screen nobody can look at. */
  function demo(o) {
    o = o || {};
    const n = o.n || 6;
    const slots = [];
    for (let i = 0; i < n; i++) {
      slots.push({ id: i === 0 ? "p0" : "ai" + i, name: i === 0 ? (LOBBY.name || "YOU") : aiName(i),
                   slot: i, ai: i !== 0, peerId: i === 0 ? 0 : null });
    }
    const seed = o.seed || parseInt(Q.get("seed") || "", 10) || 1337;
    begin({ seed: seed, len: MATCH_SEC, slots: slots, me: "p0", host: true, hostT: 0 });
    /* FAST-FORWARD BY MOVING T0, not by running a loop — the clock is wall
       time, so "six minutes in" is literally "T0 was six minutes ago". Then
       hand the board out along the seed so the picture is a contested middle
       rather than a blank start. */
    const fwd = o.at == null ? 380 : o.at;
    M.T0 -= fwd * 1000;
    M.lastT = matchT();          // the rewind is not elapsed play — see tick()'s dt clamp
    /* HOMES ARE UNTOUCHABLE HERE, and the first draft got this backwards: it
       spread the random ownership first and repaired homes afterwards, so a
       later warlord's home repair overwrote an earlier warlord's ONLY region
       and the demo booted with two of six already eliminated. Everybody keeps
       his home; the rest of the island is dealt out around it. */
    const homes = {};
    for (let i = 0; i < M.order.length; i++) homes[M.wl[M.order[i]].home] = 1;
    const L = regions();
    for (let i = 0; i < L.length; i++) {
      if (homes[L[i].id]) continue;
      const r = W.hash01(i, 47, seed);
      if (r < 0.28) continue;                          // some of the island still neutral
      const who = M.order[Math.floor(W.hash01(i, 53, seed) * M.order.length) % M.order.length];
      setOwner(L[i].id, who, true);
    }
    for (let i = 0; i < M.order.length; i++) {
      const wme = M.wl[M.order[i]];
      wme.men = Math.round(capOf(wme.id) * (0.42 + W.hash01(wme.slot, 61, seed) * 0.5));
      wme.raised = wme.men * 1.9;
      wme.battles = 2 + Math.floor(W.hash01(wme.slot, 67, seed) * 7);
      wme.won = Math.round(wme.battles * (0.35 + W.hash01(wme.slot, 71, seed) * 0.5));
      wme.lost = wme.battles - wme.won;
      wme.killed = Math.round(wme.men * (0.6 + W.hash01(wme.slot, 73, seed)));
      rollTheDead(wme.id, Math.round(12 + W.hash01(wme.slot, 79, seed) * 40));
    }
    // a plausible diplomatic history, so the ledger and the two buttons have
    // something to show without waiting six real minutes for one
    if (M.order.length > 2) {
      acceptAlly(M.order[0], M.order[1]);
      if (M.order.length > 3) acceptAlly(M.order[2], M.order[3]);
      if (o.betray !== false && M.order.length > 3) breakAlly(M.order[2], M.order[3]);
      /* THE LEDGER IS A TIMELINE, and a demo that makes three alliances in the
         same millisecond prints "19:58, 19:58, 19:58" — which is the one thing
         the endgame screen must not look like, because WHEN somebody betrayed
         you is the whole content of that panel. Spread the fixture's events
         across the match that supposedly happened. */
      const spread = [0.18, 0.36, 0.61];
      for (let i = 0, k = 0; i < M.events.length; i++) {
        if (M.events[i].kind !== "ally" && M.events[i].kind !== "betray") continue;
        M.events[i].t = matchT() * (spread[k] || 0.8);
        k++;
      }
    }
    // backfill the history graph so the endgame has a shape to draw
    for (let s = 0; s <= Math.floor(fwd / SAMPLE_SEC); s++) {
      const sh = {};
      const k = s / Math.max(1, Math.floor(fwd / SAMPLE_SEC));
      for (let i = 0; i < M.order.length; i++) {
        const id = M.order[i];
        const end2 = regionsOf(id);
        const wob = (W.hash01(s, i * 13 + 3, seed) - 0.5) * 2.4;
        sh[id] = Math.max(0, Math.round(1 + (end2 - 1) * Math.pow(k, 1.35) + wob * k));
      }
      M.samples.push({ t: s * SAMPLE_SEC, share: sh });
    }
    M.lastSample = Math.floor(matchT() / SAMPLE_SEC);
    /* ONE BATTLE LEFT RUNNING. A mid-match board with nothing contested on it
       is a picture of a lull, and the thing worth photographing about this
       game is a region changing hands while seven other people carry on. So
       the demo leaves exactly one attack in flight, against ground the player
       holds, marked as watched so it carries the countdown. */
    if (o.fight !== false) {
      const held = regions().filter(function (r) { return ownerOf(r.id) === M.me; });
      for (let i = 0; i < held.length; i++) {
        const A = adjacent(held[i].id);
        for (let k = 0; k < A.length; k++) {
          const foe = ownerOf(A[k]);
          if (!foe || foe === M.me || allied(M.me, foe)) continue;
          applyAttack({ id: 999001, wid: foe, rid: held[i].id, p: 1,
                        men: Math.floor(M.wl[foe].men * COMMIT),
                        at: Math.round(matchT() * 1000) });
          i = held.length; break;
        }
      }
    }
    syncMyArmy();
    paintStrip();
    return M;
  }

  /* ============================================================ MODULE */
  W.module("match", {
    needs: [],
    boot: function (c) {
      ctx = c;
      styleOnce();
      if (OFF) return;                                 // ?match=old: completely inert

      /* THE SEAM THAT MAKES PLAYING THE BATTLE WORTH ANYTHING, and it needed
         no edit to anybody else's file. army.js ends every fight with
         `W.setPhase("aftermath", report)`, and core fires `phase:aftermath`
         with that exact report as its payload — so the battle owner's REAL
         casualty list is already on the bus. Take it, settle the match battle
         with it, and broadcast it once. If it never comes (the player quit,
         the page died, the fight overran) the deadline in tick() has already
         settled the same battle from resolve(), and settle() is idempotent by
         id, so whichever of the two got there first is the one truth.

         battle.js may also call W.match.battleDone(id, report) directly when
         it grows a match-aware exit; this listener is what makes today work. */
      W.on("phase:aftermath", function (report) {
        if (!LIVE_ID) return;
        const id = LIVE_ID;
        LIVE_ID = 0;
        finishWatched(id, report);
      });
      /* A BATTLE THAT ENDED WITHOUT AN AFTERMATH (a retreat straight back to
         the campaign) must not leave the match waiting on a screen that is
         already gone. */
      W.on("phase:campaign", function () {
        if (!LIVE_ID) return;
        const id = LIVE_ID;
        LIVE_ID = 0;
        if (M.pending[id]) finishWatched(id, null);
      });

      /* THE MULTIPLAYER BUTTON NEEDS NOTHING FROM ME. An earlier draft of this
         file monkey-patched W.warnet.lobby so the shell's button would reach
         this screen. It does not need to: warnet.js's own lobby() already
         tests for W.match.lobby and hands straight over. Two files arranging
         the same handoff is the drift CLAUDE.md is about, so the patch is
         gone and the one arrangement that exists lives in warnet.

         The guest side of the seed handshake, though, is mine: warnet fires
         `world` when somebody sets the island, and a guest sitting in the
         lobby should be looking at that seed rather than its own guess. */
      /* SUBSCRIBE AT BOOT, NOT AT begin(). This is the bug that made the
         three-browser test produce one live match and two blank ones: wire()
         was called from begin(), so a GUEST — who by definition has not begun
         anything yet — had no listener for the wlmstart that was supposed to
         start him. He sat in the lobby watching a match he was already in.

         It is inert in single player: warnet.on() only appends to a table that
         nothing ever fires unless a socket is open. */
      wire();

      if (W.warnet && W.warnet.onWorld) {
        try { W.warnet.onWorld(function (w) { if (w && w.seed) SEED_HINT = w.seed | 0; }); } catch (e) {}
      }

      /* Nothing below this line runs in single player. No timer, no DOM, no
         listener — src/net/net.js's own doctrine, and the reason a solo
         campaign cannot be slowed down by a multiplayer file being present. */
      if (MODE === "1") setTimeout(function () { lobby(); }, 0);
      else if (MODE === "demo") setTimeout(function () { demo({}); }, 60);
    },

    // ---- the screens
    lobby: lobby,
    board: board,
    closeBoard: closeBoard,
    endgame: endgame,

    // ---- the match
    begin: begin,
    demo: demo,
    live: function () { return M.live; },
    over: function () { return M.over; },
    state: function () { return M; },

    // ---- THE CLOCK. Anything that wants to know what time it is asks here
    //      and nothing anywhere else is allowed to keep a second one.
    clock: matchT,
    left: timeLeft,

    // ---- the board, for territory.js's map to paint from
    regions: regions,
    adjacent: adjacent,
    owner: ownerOf,
    setOwner: setOwner,
    warlords: function () { return M.wl; },
    warlord: wl,
    me: function () { return M.me; },
    colourOf: function (wid) { const w = wl(wid); return w ? w.colour : 0x9a8f72; },
    defence: defenceOf,

    // ---- the rules other modules ask about
    canAttack: canAttack,
    attack: function (rid) { return attack(M.me, rid); },
    allied: allied,
    allies: alliesOf,
    ally: function (id) { offerAlly(M.me, id); send("wlmally", { wid: M.me, to: id }); },
    breakAlly: function (id) { breakAlly(M.me, id); send("wlmbreak", { wid: M.me, to: id }); },

    // ---- the seam warnet.js may call instead of this file wiring net.js itself
    recv: recv,

    /* THE BATTLE OWNER'S ONE REPORT. battle.js calls this when a 3D fight that
       started from a match attack ends, so the owner's real result is the one
       eight machines take — as long as it beats the deadline. If it does not,
       the deadline already decided and this is ignored, which is the whole
       point of THE BATTLE RULE point 5. */
    battleDone: finishWatched,

    /* Every number a test or a preset might want to gate on, in one call.
       `stallMax` is the proof the clock never paused: it is the largest gap
       ever seen between two ticks, and a match that ran through a battle, a
       menu and a hidden tab should still show a small one. */
    audit: function () {
      return {
        live: M.live, over: M.over, t: Math.round(matchT() * 10) / 10,
        left: Math.round(timeLeft()), len: M.len, seed: M.seed, me: M.me,
        warlords: M.order.length, regions: regions().length,
        mine: regionsOf(M.me), share: Math.round(share(M.me) * 100),
        men: Math.round(meWL() ? meWL().men : 0),
        allies: alliesOf(M.me).length, offers: Object.keys(M.offers).length,
        fighting: Object.keys(M.pending).length, fallen: M.fallen.length,
        betrayals: M.order.reduce(function (n, id) { return n + M.wl[id].betrayals; }, 0),
        stallMax: Math.round(M.stallMax * 100) / 100,
        winner: M.winner, why: M.why,
        clock: TICKCLOCK ? "tick" : "wall",
        spawnSepKm: spawnSeparation(),
        connected: connected(), host: isHost(),
      };
    },
  });

  /* The measured spawn separation, published because the header claims a
     number and a claim in a comment that nothing can check is a claim that
     rots. Returns the minimum pairwise distance between homes, in km. */
  function spawnSeparation() {
    let min = Infinity;
    for (let i = 0; i < M.order.length; i++) {
      const a = region(M.wl[M.order[i]].home);
      if (!a) continue;
      for (let j = i + 1; j < M.order.length; j++) {
        const b = region(M.wl[M.order[j]].home);
        if (!b) continue;
        const d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
        if (d < min) min = d;
      }
    }
    return min === Infinity ? 0 : Math.round(min / 100) / 10;
  }
})();
