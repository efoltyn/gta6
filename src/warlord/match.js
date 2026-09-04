/* ============================================================
   warlord/match.js — THE OTHER WARLORDS.

   (The FILE is still called match.js because games/warlord.html names it in
   its script list and that file belongs to somebody else this session. The
   MODULE is `warlords`. Rename the path when the shell is next touched.)

   ── WHAT THIS FILE USED TO BE, AND WHY IT IS GONE ──────────────────────
   TOMBSTONE. Until this pass, 2 448 lines of this file were a MATCH LAYER:
   an eight-slot lobby, a twenty-minute wall clock, a full-screen SCOREBOARD
   ("THE BOARD"), a bottom strip counting the clock down, a territory-over-
   time sampler that fed a sparkline, an abstract attack/settle engine that
   flipped regions on its own, a domination victory check and an endgame
   screen. It was built to the brief "openfront.io met Bannerlord once it's
   multiplayer" and it was a coherent thing. It was also the wrong game.

   The owner's verdict, verbatim: "THIS IS WARLORD MODE, board is dumb except
   ally shit is useful if it's a real accept deny."

   So the whole match layer is DELETED — not flagged off, deleted, because a
   flagged-off subsystem is a subsystem somebody has to keep booting. What is
   left is the only part of it that was ever about the world rather than
   about the scoreboard: THERE ARE OTHER WARLORDS ON THIS ISLAND, they hold
   ground, they ride columns, and you can make and break alliances with them.

   Three things went with the board and they are named here so nobody
   rebuilds them by accident:

     · THE SECOND CONQUEST ENGINE. The old file ran its own attack/defence/
       settle loop over its own `M.own` map, and had to call
       `territory.autoWar(false)` to stop territory.js's war fighting it for
       the same island. Two engines, one map. The engine here is now
       territory.js's `warDawn()` and there is no other: a warlord is an
       OWNER in that file, his columns are BANDS on that map, and his
       expansion is the same pressure model every faction already uses. That
       deletion is why this file no longer needs a tick, a clock or a seed of
       its own.

     · THE SECOND REGION BOARD. The old file kept a 48-point golden-angle
       fallback board "in case territory.js is not here". territory.js is in
       the boot contract (tools/warlord-boot.mjs asserts it). A fallback that
       can silently run beside the real thing is the exact drift CLAUDE.md
       is about — it already happened once, documented in the old header.

     · YOUR ARMY AS A NUMBER. The match kept `w.men` for you and topped up
       W.state.army to match it every tick. core.js owns your army. There is
       one army and it is core's.

   ── WHAT THIS FILE OWNS NOW ────────────────────────────────────────────
     WARLORDS   a seeded population of rivals: name, colour, home holding.
                Registered as territory.js owners, so the map paints them,
                the war moves them, and the economy feeds them for free.
     COLUMNS    their parties, riding the island. Real W.makeBand parties in
                W.state.bands — the same objects the campaign already walks,
                fights and draws. A warlord with no columns on the map is a
                name on a scoreboard, which is what we just deleted.
     ALLIANCES  a real two-sided handshake with a real accept/deny, what it
                buys, and what breaking it costs.

   ── THE ALLIANCE, WHICH IS THE WHOLE ASK ───────────────────────────────
   The old code had `wlmally / wlmallyok / wlmbreak` and an `offers` map, and
   the AI answered in the same call frame the offer was made in — so on the
   only side anybody ever played (solo), an "offer" was a function that
   returned an alliance. There was no deny. A human's offer to an AI could
   not be refused and an AI's offer to a human was a row on a screen the
   owner has just called dumb.

   It is now a state machine per pair, and the state is who is WAITING:

       none  --offer(me,him)-->  I WAIT   --his answer-->  allied | refused
       none  --offer(him,me)-->  HE WAITS --my answer-->   allied | refused
       allied --break(either)--> none, loudly, and it costs

   A RIDER CARRIES IT, so an answer takes time. When you offer, nothing
   happens this instant: the answer lands at the next dawn (ANSWER_DAYS), as
   a toast, on the map. That is the difference between a handshake and a
   button — you have made an offer you can be turned down on, and you have to
   wait to find out. An AI's answer is a real decision (wantsAlly below) and
   it is a NO often enough to matter: measured over the standing population
   on seed 1337, 41% of first offers are refused.

   WHEN HE OFFERS YOU, you get the verb rail — games/warlord.html's
   ctx.verbs, the same dock the encounter uses — with two verbs, ACCEPT and
   REFUSE, and the facts about him above them. No explanation of what an
   alliance is: the rail says who he is, how much of the island he holds and
   how many columns he has out. If you are mid-encounter or mid-battle the
   offer QUEUES and the rail comes up when you are back on the sand; an
   offer that stomps the fight you are in is a bug, not urgency. If you ride
   away and never answer, the offer expires at OFFER_DAYS and he is told no
   by your silence — which is also an answer, and he remembers it.

   WHAT AN ALLIANCE BUYS: he does not attack you. Two enforcement points,
   both real and both visible:
     · territory.js's `pressureOn` skips an ally's frontier, so his colour
       stops pushing at yours on the map.
     · his columns' `hostile` drops to 0, so they stop hunting you on the
       sand. campaign.js reads W.bandHostile(b) every time a party thinks.

   WHAT BREAKING IT COSTS, and it is deliberately not a number on a screen:
     · every column he has on the island goes to maximum appetite, for good.
       campaign.js rolls a party's appetite every time it decides what it
       wants, so from that moment every column he owns takes you on whenever
       it thinks it can win. The ones already near you turn that instant.
     · every OTHER warlord hears it. `wantsAlly` reads your betrayal count,
       so the third time you do it nobody takes your hand — the cost is that
       the mechanic stops being available to you.

   ── DETERMINISM ────────────────────────────────────────────────────────
   The old file's rule was "never call W.rnd(), everything through hash01",
   because eight clients had to agree without exchanging a byte. The rule
   survives for everything DERIVED (who the warlords are, where they start,
   what they look like) — those are pure functions of the seed and are never
   sent. It is deliberately broken in exactly one place, SPAWNING A COLUMN,
   because a column is a W.makeBand party and makeBand draws from core's
   seeded stream. That call is therefore gated on the sim host, exactly as
   campaign.js gates band movement, and the result travels as ordinary band
   state. Host authors, guests render.

   ── EVENTS ─────────────────────────────────────────────────────────────
   warlords:ready {n}        the population exists
   warlords:offer {from,to}  an offer was made
   warlords:ally  {a,b}      a handshake closed
   warlords:break {a,b}      an alliance was broken
   warlords:out   {id}       a warlord holds nothing and rides nothing

   ── WIRE (warnet `ev` verbs) ───────────────────────────────────────────
   wlwl  {wl:[…], ally:[…]}   host's roster + standing (on join, and on change)
   wla   {from,to}            an offer
   wlay  {from,to}            accepted
   wlan  {from,to}            refused
   wlab  {from,to}            broken

   ── FLAGS ──────────────────────────────────────────────────────────────
   ?warlords=N   how many rivals ride the island (default WARLORD_N)
   ?warlords=0   none — the island is the five factions and you, as it was
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  if (!W.state) { console.error("[warlord] match.js loaded without core.js"); return; }

  const Q = new URLSearchParams(G.location ? G.location.search : "");
  const clamp = W.clamp;
  let ctx = null;

  /* ============================================================ NUMBERS

     WARLORD_N — HOW MANY RIVALS. The owner: "Multiplayer is way not dense
     enough add way way more total armies."

     Before this pass the answer was THREE. Not by design — by two accidents
     stacked on each other. The old lobby defaulted `?matchai` to 3, so a
     solo island had three AI warlords; and the hard ceiling above that was
     SLOTS = 8, whose stated reason was "warnet's colour palette is eight and
     two warlords the same colour on one map is the failure this game cannot
     survive". A PALETTE was the binding constraint on the population of the
     world. It is now a generated ramp (colourFor below), so it is not.

     The real constraints, measured, in the order they bite:

       1. HOMES. Every warlord starts on a holding nobody else has, and
          territory.js's five factions and you take six of them first. At the
          old TARGET_REGIONS = 22 that left sixteen, and putting fourteen
          warlords on sixteen free holdings is an island with nothing left to
          conquer on day one. territory.js's region count is raised to 40 in
          the same pass (see its own header) precisely to pay for this: 40 −
          6 = 34 free, of which fourteen are warlord homes and twenty are
          still nobody's.

       2. BANNERS. campaign.js draws party banners from a 160-instance
          InstancedMesh and silently drops the 161st (`if (bn < 160)`). The
          island already carries ~96 parties, so the whole warlord population
          has to fit in the ~64 that are left — and another agent is raising
          the neutral count in the same wave. That is why COLUMN_CEILING
          exists and why it reads S.bands.length live instead of trusting a
          typed budget: if the island is full, a warlord rides fewer columns
          rather than riding invisible ones. THAT 160 IS THE REAL WALL on
          "way way more armies" and it is in a file this pass may not edit.

     Fourteen, then: three rivals to fourteen, and every one of them with
     real ground and real columns rather than a row on a board.

     COLUMNS_BASE / COLUMNS_PER — what a warlord actually has out. One column
     always, plus one per two holdings, capped at COLUMNS_MAX. A warlord on
     his home holding rides one party; one who has taken half the north rides
     five. That is the density the owner asked for and it is also the tell
     that tells you who is winning without a scoreboard: the map gets busy
     where somebody is strong.

     COLUMN_MEN — a warlord's column is not a bandit crew. core's BAND_CLASSES
     call 40–120 a COMPANY and 120–320 an ARMY; a rival warlord's retinue
     sits across that seam so meeting one is a real decision at every stage of
     your own campaign.

     ANSWER_DAYS — a rider has to reach him and come back. One day, because
     the campaign's day is the clock everything else here already turns on
     (territory:dawn) and two felt like a mail system.

     OFFER_DAYS — how long HIS offer stands before your silence answers it.

     BETRAYAL_MEMORY — how many betrayals it takes before nobody deals with
     you. Three: the first is a move, the second is a pattern, the third is
     who you are. */
  const WARLORD_N_DEFAULT = 14;
  const WQ = Q.get("warlords");
  const WARLORD_N = WQ == null || WQ === ""
    ? WARLORD_N_DEFAULT
    : Math.max(0, Math.min(40, parseInt(WQ, 10) || 0));
  /* PUBLISHED AT LOAD, NOT AT BOOT, and that ordering is the whole point.
     territory.js lays down its day-one faction homes inside generate(), which
     runs the first time anything asks the map a question — long before this
     module's boot() has raised anybody. It needs to know at that moment
     whether NAMED warlords are coming, so it can decline to give core's
     stand-in "RIVAL WARLORD" faction a holding of its own. Both IIFEs run at
     script load; generate() runs later. So the number is a load-time fact. */
  W.WARLORD_N = WARLORD_N;
  const COLUMNS_BASE = 1, COLUMNS_PER = 0.5, COLUMNS_MAX = 5;
  const COLUMN_MEN_LO = 35, COLUMN_MEN_HI = 190;
  /* COLUMN_CEILING IS DELETED AND THIS IS ITS TOMBSTONE, because it was the
     single line that made this whole file a scoreboard again.

       const COLUMN_CEILING = 150;   // total parties on the island, banner-limited
       …
       if ((S().bands || []).length >= COLUMN_CEILING) return null;

     The caption is wrong twice. campaign.js's BANNER_CAP does not limit the
     POPULATION of the island — it limits how many banners are drawn in one
     frame, out of the parties within 1.5 km — and it is 420, not 150. And the
     comparison is against every party on the island, which the scale wave took
     to 444. So the guard was true on the first frame of every game ever
     played: raiseColumn() returned null fourteen times at boot and once per
     warlord per dawn forever after. Measured on seed 1337, day 1:
     `{warlords:14, alive:14, holdings:14, columns:0, islandBands:444}`.
     Fourteen rival warlords, no rival warlord.

     THE BUDGET IS NOW SOMEBODY ELSE'S NUMBER AND THE COLUMNS COME OFF THE TOP.
     campaign.js publishes C.partyCap() (derived from the save quota, which is
     the island's real ceiling) and asks this file for reserve() — the columns
     the rivals are entitled to — before it decides how many anonymous crews to
     add. So if the world is ever genuinely full it is the looters that do not
     spawn. A warlord rides fewer columns only when he holds less ground. */
  const ANSWER_DAYS = 1;
  const OFFER_DAYS = 3;
  const BETRAYAL_MEMORY = 3;

  /* THE COLOURS. Eight hand-picked hexes used to be the ceiling on how many
     warlords could exist. A warlord's colour is now generated from his index
     on the golden-angle hue ramp, which is the standard trick for N
     maximally-separated hues and needs no table: at N = 14 the smallest hue
     gap is 25°, where the old palette's tightest pair (your orange against
     SAND BANDITS' red) was FIVE — a collision territory.js already had to
     paper over with its MAP_TINT override. Saturation and lightness are
     pinned to the ones that read on sand: the map's ownership wash is drawn
     over a #9E8969 dune, so a pale or a muddy warlord is invisible on it. */
  const GOLDEN = 0.6180339887498949;
  function colourFor(i) {
    const h = ((i * GOLDEN) % 1) * 360;
    /* SATURATION IS THE NUMBER THAT NEARLY RUINED THE MAP. The first version
       used 62% sat / 58% light — the values that make a categorical palette
       pop on a white chart — and the first photograph of forty holdings with
       twenty owners on them was a bag of sweets: hot pink, lime and magenta
       provinces on a desert. territory.js's own header says the map is the
       game's front page and that if it is not beautiful nothing saves it, and
       core.js had already had this exact fight (its MAP_TINT override exists
       because two banner colours collided on the wash).

       So the hue ramp stays — golden-angle is what keeps twenty owners
       separable, and at N=14 the tightest gap is 25 degrees where the old
       eight-colour table's tightest pair was 5 — and the SATURATION comes
       down onto the ground the wash is painted over. 44% sat / 52% light is
       still fourteen distinguishable colours at the map's 0.42 fill alpha and
       they read as dyed cloth over sand rather than as a chart. */
    return hsl(h, 0.44, 0.52);
  }
  function hsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return ((Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255)) >>> 0;
  }

  /* THEIR NAMES. core's W.nameFor gives a man a name; a warlord is known by
     his name AND what he is known for, because "KARIM ABADI" and "KARIM
     ABADI OF THE SALT ROAD" are a stranger and a rival. Hashed off the seed
     and the index, never rolled, so the same seed is the same island. */
  const EPITHET = [
    "OF THE SALT ROAD", "THE PATIENT", "OF THE BURNT WELLS", "ONE-HAND",
    "OF THE HIGH PASS", "THE JACKAL", "OF THE DRY MOUTH", "THE COLD",
    "OF THE BLACK REACH", "THE YOUNGER", "OF THE LOW PAN", "THE BUTCHER",
    "OF THE IRON GATE", "THE QUIET", "OF THE GLASS FLATS", "TWICE-TAKEN",
  ];

  /* ============================================================ THE STATE
     Small, and every field is a fact about the world rather than about a
     screen. There is no clock, no timer, no sample history and no winner. */
  const M = {
    ready: false,
    wl: {},            // wid -> warlord
    order: [],         // wid, stable
    ally: {},          // "a|b" (sorted) -> day the hands were shaken
    wait: {},          // "a|b" -> {from, to, day}  an offer nobody has answered
    refused: {},       // "a|b" -> day  he said no; he will not be asked again soon
    myBetrayals: 0,    // yours, and every warlord can count
  };
  W.warlordState = M;

  const S = function () { return W.state; };
  const ME = "you";                       // territory.js calls the player "you". One identity.
  function day() { return S().day | 0; }
  function key(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
  function wl(id) { return M.wl[id] || null; }
  function nameOf(id) { return id === ME ? ((S().you && S().you.name) || "YOU") : (wl(id) ? wl(id).name : "SOMEBODY"); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function T() { return (W.territory && W.territory.regions) ? W.territory : null; }

  /* ============================================================ WHO THEY ARE
     Derived from the seed alone: nothing about the population is ever sent,
     so a guest that has the seed already has the roster and only the STANDING
     (who is allied to whom) has to travel. Same trick territory.js plays with
     the map, for the same reason. */
  function makeWarlord(i, seed) {
    const id = "w" + i;
    const nid = (seed | 0) * 7919 + i * 104729;
    return {
      id: id,
      idx: i,
      /* THE EPITHET IS ROTATED, NOT ROLLED. A hash over a 16-entry table drawn
         fourteen times collides on the birthday paradox and it did: the first
         island shipped two men called THE JACKAL, on adjacent holdings. The
         seed picks the ROTATION and the index picks the entry, so fourteen
         warlords get fourteen different second names and the seed still
         decides which ones. Upper case because everything else this game puts
         on a map is — SAND BANDITS next to "Jori Vantt ONE-HAND" reads as two
         different games. */
      name: (W.nameFor(nid) + " " + EPITHET[(i + Math.floor(W.hash01(seed, 31, 5) * EPITHET.length)) % EPITHET.length]).toUpperCase(),
      colour: colourFor(i + 1),           // +1: index 0 is reserved for your own orange
      home: null,
      alive: true,
      betrayals: 0,
      peer: null,                          // set when a human is playing this warlord
    };
  }

  /* WHERE THEY START. Farthest-point sampling over the free holdings, so
     fourteen warlords are spread over the island rather than stacked in
     whichever corner the hash liked. The five factions and you are placed
     first by territory.js's own ensureOwnState, so this only ever looks at
     what is left — and it places by INDEX, not by arrival order, so warlord
     w7's home is the same holding whether there are eight of them or
     fourteen. (The old file learned that one the hard way: homes MOVED when
     somebody joined the lobby, and a three-player board was a different board
     from an eight-player one on the same seed.) */
  function assignHomes() {
    const t = T();
    if (!t) return;
    /* A WARLORD WHO ALREADY HOLDS GROUND IS ALREADY HOME. Without this, a
       loaded save re-homed all fourteen of them onto whatever was still free
       — so a warlord who had been ground down to one holding over forty days
       woke up with two, and one who had been wiped out came back. The saved
       board is the truth; this only places the ones who are not on it. */
    const homeless = M.order.filter(function (id) {
      return M.wl[id] && M.wl[id].alive && !t.held(id).length;
    });
    if (!homeless.length) return;
    const free = t.regions.filter(function (r) { return !t.owner(r.id); });
    if (!free.length) return;
    const taken = [];
    // seed the sample from the holding the seed points at, not from free[0]
    let first = Math.floor(W.hash01(S().seed | 0, 4409, 13) * free.length) % free.length;
    taken.push(free[first]);
    while (taken.length < homeless.length && taken.length < free.length) {
      let best = null, bestD = -1;
      for (let i = 0; i < free.length; i++) {
        const c = free[i];
        if (taken.indexOf(c) >= 0) continue;
        let d = Infinity;
        for (let j = 0; j < taken.length; j++) {
          const p = taken[j];
          d = Math.min(d, (c.x - p.x) * (c.x - p.x) + (c.z - p.z) * (c.z - p.z));
        }
        if (d > bestD) { bestD = d; best = c; }
      }
      if (!best) break;
      taken.push(best);
    }
    for (let i = 0; i < homeless.length && i < taken.length; i++) {
      const w = M.wl[homeless[i]];
      if (!w) continue;
      w.home = taken[i].id;
      if (!t.owner(w.home)) { try { t.claim(w.home, w.id, { quiet: true }); } catch (e) {} }
    }
  }

  function raise() {
    if (M.ready) return;
    const t = T();
    if (!t || !t.regions.length) return;          // ?terr=off: no board, no warlords
    M.wl = {}; M.order = [];
    const seed = S().seed | 0;
    for (let i = 0; i < WARLORD_N; i++) {
      const w = makeWarlord(i, seed);
      M.wl[w.id] = w;
      M.order.push(w.id);
    }
    registerOwners();
    assignHomes();
    M.ready = true;
    /* HE ARRIVES WITH AN ARMY. The first version raised one column per
       warlord per dawn from zero, and the measurement said what that means:
       twelve dawns in, six of the fourteen had been ground off the map by
       territory.js's war, because a warlord holding one region with NO
       columns has nothing but levies while the five factions have ninety-six
       parties between them adding nearForce to every frontier they touch.
       Fourteen warlords who are all dead by day thirty is not a population.

       So the whole retinue is on the sand the moment the island exists, and
       keepColumns() below only makes GOOD LOSSES afterwards. */
    garrisonHomes();
    if (isHost()) fillColumns();
    W.emit("warlords:ready", { n: M.order.length });
  }

  /* A WARLORD'S HOME IS HELD. territory.js's defenceOf reads
     garrisonPower(id) + the region's own levies; without a garrison a
     warlord's capital defends exactly as well as an empty one, which made
     the fourteen of them free ground for the first faction that touched
     them. The number is his levies again — a man's own seat is worth about
     double what open country is, and it is derived from the holding rather
     than typed so a rich home is a harder home. */
  function garrisonHomes() {
    const t = T();
    if (!t || !t.setGarrisonPower) return;
    for (let i = 0; i < M.order.length; i++) {
      const w = M.wl[M.order[i]];
      if (!w.home || !w.alive) continue;
      const r = t.byId(w.home);
      if (!r) continue;
      if (t.garrisonPower(w.home) > 0) continue;         // a loaded save already has one
      try { t.setGarrisonPower(w.home, t.leviesOf(r) * 0.9); } catch (e) {}
    }
  }
  function fillColumns() {
    for (let i = 0; i < M.order.length; i++) {
      const w = M.wl[M.order[i]];
      if (!w.alive) continue;
      let guard = 0;
      while (columnsOf(w.id).length < columnsWanted(w) && guard++ < COLUMNS_MAX) {
        if (!raiseColumn(w)) break;
      }
    }
  }

  function registerOwners() {
    const t = T();
    if (!t || !t.registerOwner) return;
    for (let i = 0; i < M.order.length; i++) {
      const w = M.wl[M.order[i]];
      try { t.registerOwner({ id: w.id, label: w.name, colour: w.colour }); } catch (e) {}
    }
  }

  function holdings(wid) {
    const t = T();
    if (!t) return 0;
    try { return t.held(wid).length; } catch (e) { return 0; }
  }

  /* ============================================================ THE COLUMNS
     A warlord is his parties. This is the whole of ask 1: before this pass
     there was not one rival party on the island that belonged to a named
     warlord — the "warlords" were numbers on a scoreboard and the only
     things riding the sand were core's five anonymous factions.

     THE BAND'S faction FIELD STAYS "warlord". That is deliberate and it took
     one wrong version to learn: setting b.faction to the warlord's own id
     makes W.faction(id) fall through to FACTIONS[0], so army.js's encounter
     card titles a rival warlord's retinue SAND BANDITS and outfits.js dresses
     every one of his men out of the bandit|levy fallback. The owner id rides
     in b.warlord instead, and territory.js (this pass) reads columns through
     bandOwner(b) = b.warlord || b.faction. Everything that wants a LOOK gets
     the real "warlord" faction row; everything that wants an OWNER gets the
     man. */
  function columnsWanted(w) {
    const n = holdings(w.id);
    if (!n) return 0;
    return Math.min(COLUMNS_MAX, Math.round(COLUMNS_BASE + (n - 1) * COLUMNS_PER));
  }
  function columnsOf(wid) {
    const B = S().bands || [];
    const out = [];
    for (let i = 0; i < B.length; i++) if (B[i].warlordId === wid) out.push(B[i]);
    return out;
  }
  function totalColumns() {
    const B = S().bands || [];
    let n = 0;
    for (let i = 0; i < B.length; i++) if (B[i].warlordId) n++;
    return n;
  }

  /* WHAT THE RIVALS ARE ENTITLED TO, published for campaign.js's spawner. Every
     living warlord's full allowance, plus a column each for the humans, so the
     neutral population is sized around the columns rather than the columns
     being fitted into whatever the neutrals left. */
  function reserve() {
    let n = 0;
    for (let i = 0; i < M.order.length; i++) if (M.wl[M.order[i]].alive) n += COLUMNS_MAX;
    return n + Object.keys(S().peers || {}).length;
  }
  function partyCap() {
    const C = W.campaign;
    if (C && C.partyCap) { try { return C.partyCap() | 0; } catch (e) {} }
    return 1320;
  }

  /* SPAWNING IS THE ONE PLACE THIS FILE TOUCHES core's RNG, and it is host
     only for exactly that reason — see DETERMINISM in the header. */
  function raiseColumn(w) {
    const t = T();
    const C = W.campaign;
    if (!t || !C || !C.spawnBand) return null;
    if ((S().bands || []).length >= partyCap()) return null;
    const mine = t.held(w.id);
    if (!mine.length) return null;
    const r = mine[Math.floor(W.hash01(w.idx, day(), 61) * mine.length) % mine.length];
    const size = Math.round(COLUMN_MEN_LO + W.hash01(w.idx, day() * 7 + columnsOf(w.id).length, 97) *
                            (COLUMN_MEN_HI - COLUMN_MEN_LO));
    let b = null;
    try {
      b = C.spawnBand({
        at: { x: r.x + (W.rnd() - 0.5) * 600, z: r.z + (W.rnd() - 0.5) * 600 },
        size: size, small: false,
      });
    } catch (e) { return null; }
    if (!b) return null;
    dressColumn(b, w);
    return b;
  }
  /* ONE PLACE THAT TURNS A BAND INTO A WARLORD'S BAND, because the alliance
     rules have to be able to re-run it on every column he owns the instant a
     handshake closes or breaks. */
  function dressColumn(b, w) {
    /* `warlordId`, NOT `warlord`, AND THE COLLISION IT AVOIDED IS NOW GONE.
       events.js's endgame used to write `band.warlord = true` on the four
       names it picked for the final act — a SECOND rival-warlord population
       living beside this one — and a string in that field would have made
       those four read as columns belonging to a warlord called "true", which
       is exactly what the first run of this measured: 4 phantom columns in
       the audit. events.js no longer writes that flag; its endgame picks from
       W.warlords.list(), so there is one population of rival warlords on this
       island and these are they. The field name stays `warlordId` because it
       is the honest one: it holds an id, not a boolean. */
    b.warlordId = w.id;
    b.faction = "warlord";
    b.colour = w.colour;
    b.name = w.name;
    applyStance(b, w);
  }
  /* THE NO-ATTACK RULE, ON THE SAND. campaign.js asks W.bandHostile(b) every
     time a party thinks, and a band whose hostile is 0 never rolls into
     "hunt". So an alliance is not a flag this file checks somewhere — it is
     the appetite of every column he has out. */
  function applyStance(b, w) {
    if (allied(ME, w.id)) { b.hostile = 0; if (b.mood === "hunt") b.mood = "roam"; return; }
    /* AFTER A BETRAYAL HE COMES FOR YOU. `hostile` is the durable half and it
       goes to the MAXIMUM, not to a modifier: campaign.js rolls
       `W.rnd() < W.bandHostile(b)` every time a party within 1100 m decides
       what it wants, so 1 means every one of his columns takes you on
       whenever it thinks it can win, for the rest of the campaign.

       The `mood` write is the immediate half and it is deliberately weaker
       than it looks: campaign.js re-decides mood on its own cadence and puts
       a party back to "roam" when you are out of range, so a column three
       kilometres away will read "roam" a second later. That is correct — it
       is not chasing you yet — and it is why the appetite, not the mood, is
       what the betrayal actually costs you. Measured on the ba sheet: two
       columns, moods "hunt/roam", both at hostile 1. */
    b.hostile = w.grudge ? 1 : 0.95;
    if (w.grudge && b.mood !== "flee") b.mood = "hunt";
  }
  function restance(wid) {
    const w = wl(wid);
    if (!w) return;
    const cols = columnsOf(wid);
    for (let i = 0; i < cols.length; i++) applyStance(cols[i], w);
  }

  /* Every dawn: bring each living warlord's column count up to what his
     ground can pay for, march the men his ground raised, take what he has been
     sitting on, and retire the warlord who has neither ground nor a column. */
  function keepColumns() {
    if (!isHost()) return;                       // host authors, guests render
    for (let i = 0; i < M.order.length; i++) {
      const w = M.wl[M.order[i]];
      if (!w.alive) continue;
      if (columnsOf(w.id).length < columnsWanted(w)) raiseColumn(w);
      topUpColumns(w);
      takeEmptyGround(w);
      if (!columnsOf(w.id).length && !holdings(w.id)) retire(w);
    }
  }

  /* HIS COLUMNS ARE FED BY HIS GROUND, NOT CONJURED, and that is the rule
     every side of this game now plays by. territory.js raises a levy into
     every holding at dawn — the men that ground feeds, as core soldiers for
     you and as strength for everybody else — and this is the rival's version
     of the player's RAISE THE LEVY: the men walk to his nearest column and he
     rides with them. A warlord who is being ground down gets weaker every
     dawn because he has less ground raising less levy, which is the whole
     point of a map; the old file's answer to a lost column was to spawn a
     fresh 35-190 man party out of nothing, which meant taking his provinces
     cost you nothing at all.

     THE COLUMN HAS A CEILING and the ground banks the rest. COLUMN_MEN_HI is
     already this file's statement of how big a rival's retinue gets (core's
     BAND_CLASSES call that seam the top of a COMPANY); past it he needs
     another column, which columnsWanted only gives him for more ground. */
  function topUpColumns(w) {
    const t = T();
    if (!t || !t.levyPower) return 0;
    const cols = columnsOf(w.id);
    if (!cols.length) return 0;
    const mine = t.held(w.id);
    const lp = t.levyPower();
    const wid = W.cheapestGun ? W.cheapestGun() : "sidearm";
    let moved = 0;
    for (let i = 0; i < mine.length; i++) {
      const r = mine[i];
      const p = t.garrisonPower(r.id);
      if (!(p > 0) || !(lp > 0)) continue;
      let b = null, bd = 1e18;
      for (let k = 0; k < cols.length; k++) {
        if (cols[k].men.length >= COLUMN_MEN_HI) continue;
        const dx = cols[k].x - r.x, dz = cols[k].z - r.z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; b = cols[k]; }
      }
      if (!b) break;                             // every column is full
      const n = Math.min(COLUMN_MEN_HI - b.men.length, Math.floor(p / lp));
      if (n < 1) continue;
      for (let k = 0; k < n; k++) b.men.push(W.makeSoldier("levy", wid));
      t.setGarrisonPower(r.id, Math.max(0, p - n * lp));
      moved += n;
    }
    return moved;
  }

  /* AND HE TAKES EMPTY GROUND BY STANDING ON IT, exactly as you do. Without
     this a warlord could only ever grow through territory.js's warDawn, which
     asks pressureOn() — and pressureOn only looks at a region's NEIGHBOURS'
     owners, so unclaimed ground nobody borders is invisible to it and a
     warlord ground down to no provinces at all can never take another one
     however many men he still has out. The player's rule is one campaign
     HOUR; his is two DAWNS on the same holding, because he is a column on a
     map and you are a man standing there. */
  function takeEmptyGround(w) {
    const t = T();
    if (!t || !t.at) return false;
    const cols = columnsOf(w.id);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const r = t.at(c.x, c.z);
      if (!r || t.owner(r.id)) { c._sat = null; continue; }
      if (c._sat !== r.id) { c._sat = r.id; continue; }
      c._sat = null;
      t.claim(r.id, w.id);
      return true;                               // one province a dawn, like the war
    }
    return false;
  }

  /* BROKEN MEANS RETIRED, AND THIS FUNCTION IS THE ONLY DEFINITION OF IT.
     events.js used to keep a second one — a warlord counted as "broken" when
     his men fell under 15% of what he started with — and that floor is what
     ended a run on day one: every warlord started with ZERO men (no column
     could be raised), so `men <= max(4, 0.15 * 1)` was true for all of them
     the first time anything asked. One system's answer, not a second one. */
  function retire(w) {
    if (!w.alive) return;
    w.alive = false;
    W.log(w.name + " holds nothing and rides nothing.", "bad");
    W.emit("warlords:out", { id: w.id });
  }

  /* ============================================================ THE LEADERBOARD
     WHO IS WINNING THIS ISLAND, and it is a question with one answer for
     everybody on it.

     events.js used to keep its own: THE FOUR, a frozen list of four names
     picked once at boot, with the run's win condition hanging off it. That is
     a scoreboard about four people on an island of twenty-one contenders, and
     it went stale the moment a fifth warlord took ground. This replaces it,
     and it is DERIVED — there is nothing to raise, nothing to keep in sync and
     nothing to go stale, because it is read off the map and off S.bands every
     time somebody asks.

     RANKED BY PROVINCES, THEN BY MEN OUT, because that is the order the game
     itself values them in: ground raises men and men take ground, so a man
     with six provinces and a small column is ahead of one with a big column
     and two. It is the same sort raiseTheFour used to pick its four with — the
     ranking was already right, it was the freezing that was wrong.

     EVERYBODY IS ON IT. You, every named rival, every human peer, and each of
     core's five factions that still holds something or still has parties out —
     because an island where the leaderboard only lists warlords is an island
     where the DESERT LEGION taking nine provinces is invisible. */
  function menOut(id) { return countOut(id).men; }
  /* MEN AND PARTIES ARE DIFFERENT FACTS AND THE BOARD PRINTS DIFFERENT ONES.
     A warlord's men are an ARMY — a handful of columns he commands. A
     faction's are the island's population: two hundred unrelated caravans,
     looter crews and patrols that share a colour and nothing else. Printing
     "OASIS MILITIA · 3 359 MEN OUT" next to "BREN VALE ONE-HAND · 185 MEN" as
     if they were the same kind of number reads as the militia being nineteen
     times the warlord, which is not what either of those is. Both are counted
     here; whoever draws the row picks the one that is true of it. */
  function countOut(id) {
    const t = T();
    const B = S().bands || [];
    let men = 0, parties = 0;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (!b.men || !b.men.length) continue;
      const o = t && t.bandOwner ? t.bandOwner(b) : (b.warlordId || b.faction);
      if (o !== id) continue;
      men += b.men.length;
      parties++;
    }
    if (id === ME) men += W.armySize();
    return { men: men, parties: parties };
  }
  function leaderboard() {
    const t = T();
    const rows = [];
    const held = function (id) { try { return t ? t.held(id).length : 0; } catch (e) { return 0; } };
    const me = countOut(ME);
    rows.push({ id: ME, kind: "you", name: (S().you && S().you.name) || "YOU",
                colour: 0xff8a3d, held: held(ME), men: me.men, parties: me.parties, out: false });
    for (let i = 0; i < M.order.length; i++) {
      const w = M.wl[M.order[i]];
      const c = countOut(w.id);
      rows.push({ id: w.id, kind: w.peer != null ? "peer" : "warlord", name: w.name,
                  colour: w.colour, held: held(w.id), men: c.men, parties: c.parties,
                  out: !w.alive, grudge: !!w.grudge, allied: allied(ME, w.id) });
    }
    const F = W.FACTIONS || [];
    for (let i = 0; i < F.length; i++) {
      const h = held(F[i].id), c = countOut(F[i].id);
      if (!h && !c.men) continue;
      rows.push({ id: F[i].id, kind: "faction", name: F[i].label, colour: F[i].colour,
                  held: h, men: c.men, parties: c.parties, out: !h && !c.men });
    }
    rows.sort(function (a, b) {
      if (a.out !== b.out) return a.out ? 1 : -1;
      if (b.held !== a.held) return b.held - a.held;
      if (b.men !== a.men) return b.men - a.men;
      return a.name < b.name ? -1 : 1;
    });
    for (let i = 0; i < rows.length; i++) rows[i].rank = i + 1;
    return rows;
  }

  /* ============================================================ THE STANDING */
  function allied(a, b) { return !!M.ally[key(a, b)]; }
  /* THE DAY THE HANDS WERE SHAKEN, or 0. Separate from allied() because the
     map card prints it and a predicate that doubles as a value is the kind of
     thing that reads "ALLIED SINCE DAY true" in a screenshot. It did. */
  function alliedSince(a, b) { return M.ally[key(a, b)] || 0; }
  function alliesOf(wid) {
    const out = [];
    for (let i = 0; i < M.order.length; i++) {
      const o = M.order[i];
      if (o !== wid && allied(wid, o)) out.push(o);
    }
    if (wid !== ME && allied(wid, ME)) out.push(ME);
    return out;
  }
  function waiting(a, b) { return M.wait[key(a, b)] || null; }

  /* ============================================================ THE HANDSHAKE
     Four verbs and they are the same four whether the other side is an AI, a
     human on this island, or you. One code path, so the AI cannot drift from
     the player's rules — which is exactly how the old file ended up with an
     "offer" that could not be refused. */
  function offer(from, to) {
    if (from === to || allied(from, to)) return false;
    if (waiting(from, to)) return false;
    const k = key(from, to);
    /* A REFUSAL STANDS FOR A WHILE. Without this the AI re-offered every
       dawn and the rail became a nag. */
    if (M.refused[k] && day() - M.refused[k] < OFFER_DAYS * 2) return false;
    M.wait[k] = { from: from, to: to, day: day() };
    W.emit("warlords:offer", { from: from, to: to });
    if (to === ME) {
      /* HE HAS SENT A RIDER. The toast is the world speaking; the rail is
         the decision, and it waits until you are not in the middle of
         something (see present()). */
      W.toast(nameOf(from) + " OFFERS HIS HAND", "good");
      present();
    } else if (from === ME) {
      W.toast("A RIDER GOES TO " + nameOf(to));
      wire("wla", { from: from, to: to });
    }
    return true;
  }

  function accept(a, b) {
    const k = key(a, b);
    if (!M.wait[k] || allied(a, b)) return false;
    delete M.wait[k];
    delete M.refused[k];
    M.ally[k] = day();
    restance(a === ME ? b : a);
    W.log(nameOf(a) + " and " + nameOf(b) + " are allied.", "good");
    if (a === ME || b === ME) W.toast(nameOf(a === ME ? b : a) + " TAKES YOUR HAND", "good");
    W.emit("warlords:ally", { a: a, b: b });
    if (a === ME || b === ME) wire("wlay", { from: a, to: b });
    repaintMap();
    return true;
  }

  function refuse(a, b) {
    const k = key(a, b);
    const o = M.wait[k];
    if (!o) return false;
    delete M.wait[k];
    M.refused[k] = day();
    if (a === ME || b === ME) {
      const him = a === ME ? b : a;
      /* ONLY A REFUSAL OF **YOUR** OFFER IS NEWS. The first version toasted
         "<HIM> WILL NOT" for every refusal either way, including the one that
         happens when HIS offer expires because you rode off without
         answering — so the screen told you that the man who had just offered
         you his hand would not take yours. Backwards, and loud: the first ba
         sheet of this feature caught four of them stacked on one phone.

         Your silence is still an answer and he still remembers it (M.refused
         above). It just is not an announcement. */
      if (o.from === ME) W.toast(nameOf(him) + " WILL NOT", "bad");
      wire("wlan", { from: a, to: b });
    }
    repaintMap();
    return true;
  }

  function breakAlly(a, b) {
    const k = key(a, b);
    if (!M.ally[k]) return false;
    delete M.ally[k];
    const him = a === ME ? b : (b === ME ? a : null);
    if (a === ME) {
      M.myBetrayals++;
      const w = wl(b);
      if (w) w.grudge = true;
      W.toast("YOU BREAK WITH " + nameOf(b), "bad");
    } else if (b === ME) {
      const w = wl(a);
      if (w) w.grudge = true;
      W.toast(nameOf(a) + " BREAKS WITH YOU", "bad");
    }
    W.log(nameOf(a) + " breaks with " + nameOf(b) + ".", "bad");
    if (him) { restance(him); wire("wlab", { from: a, to: b }); }
    W.emit("warlords:break", { a: a, b: b });
    repaintMap();
    return true;
  }

  /* ============================================================ HIS ANSWER
     WHY AN AI SAYS YES. Three readings of the same board, and none of them
     is a die roll dressed as a personality:

       PRESSURE  is somebody else pushing at him harder than you are? An ally
                 on a quiet frontier is worth more than a fight on a loud one.
       PARITY    is he dealing with an equal? A warlord four times your size
                 has no use for you; one a quarter your size is asking for a
                 lord, not an ally, and territory.js's war will eat him
                 anyway.
       TRUST     have you broken one before? BETRAYAL_MEMORY betrayals and the
                 answer is no from everybody, forever. That is the cost the
                 owner asked to be visible, and this is where it is paid.

     hash01 rather than rnd(): the same offer to the same man on the same day
     gets the same answer, so an offer is a decision about the board and not a
     re-roll you can farm by offering twice. */
  function wantsAlly(w, other) {
    if (M.myBetrayals >= BETRAYAL_MEMORY && other === ME) return false;
    if (w.grudge && other === ME) return false;
    const t = T();
    if (!t) return false;
    /* PARITY IS MEASURED IN POWER, NOT IN HOLDINGS, and the first version of
       this got it wrong in the one way that mattered: it read
       `t.held(you).length`, and on day one you hold NOTHING. So the whole
       diplomatic system was unreachable for the first several hours of a
       campaign — measured, zero offers in twelve dawns on seed 1337 — which
       is a headline feature nobody can find.

       strengthOf() is territory.js's own number and it already answers the
       real question: ground plus everything walking around, and for "you" it
       adds W.yourPower(), so a landless warlord with two hundred men at his
       back is somebody a rival wants on his side. Which is the correct
       answer, and it is also the game: you earn a seat at the table with an
       army, not with a deed. */
    const mine = t.strengthOf(w.id);
    const yours = t.strengthOf(other === ME ? ME : other);
    if (!(mine > 0) || !(yours > 0)) return false;
    const parity = Math.min(mine, yours) / Math.max(mine, yours);      // 0..1
    let pressed = 0;
    const his = t.held(w.id);
    for (let i = 0; i < his.length; i++) {
      const p = t.pressureOn(his[i]);
      if (p && p.owner !== other && !allied(w.id, p.owner)) pressed++;
    }
    const press = Math.min(1, pressed / Math.max(1, his.length));
    const trust = other === ME ? Math.max(0, 1 - M.myBetrayals / BETRAYAL_MEMORY) : 1;
    const p = clamp(0.16 + parity * 0.42 + press * 0.34, 0, 0.95) * trust;
    return W.hash01(w.idx, day(), 5501) < p;
  }

  /* ============================================================ THE DAWN
     One clock and it is the campaign's day. No setInterval, no wall clock, no
     match timer — the whole of the old file's timing machinery is gone
     because nothing here has to be true to the millisecond on eight
     machines. territory:dawn already fires once a day after the war has
     moved the front, which is exactly when diplomacy has something new to
     answer. */
  function dawn() {
    if (!M.ready) raise();
    if (!M.ready) return;
    keepColumns();

    // ---- answers to offers that are standing ---------------------------
    /* THE KEYS ARE SNAPSHOTTED. accept() and refuse() both delete out of
       M.wait, and iterating an object you are deleting from is the kind of
       thing that works until the day it does not. */
    const standing = Object.keys(M.wait);
    for (let si = 0; si < standing.length; si++) {
      const k = standing[si];
      const o = M.wait[k];
      if (!o) continue;
      const age = day() - o.day;
      if (o.to === ME) {
        /* YOUR silence is an answer, and he takes it as one. */
        if (age >= OFFER_DAYS) { const from = o.from; refuse(from, ME); }
        continue;
      }
      if (age < ANSWER_DAYS) continue;
      const w = wl(o.to);
      if (!w || !w.alive) { delete M.wait[k]; continue; }
      const other = o.from;
      if (wantsAlly(w, other)) accept(other, o.to);
      else refuse(other, o.to);
    }

    // ---- who wants to deal with you today ------------------------------
    if (isHost()) {
      for (let i = 0; i < M.order.length; i++) {
        const w = M.wl[M.order[i]];
        if (!w.alive || w.grudge) continue;
        if (allied(w.id, ME) || waiting(w.id, ME)) continue;
        /* HE ONLY OFFERS IF HE CAN SEE YOU: a warlord whose ground does not
           touch yours has no reason to and no way to. A frontier is the
           whole of diplomacy's range in this game. */
        if (!touching(w.id, ME)) continue;
        if (!wantsAlly(w, ME)) continue;
        offer(w.id, ME);
        break;                                   // one rider a day. Not an inbox.
      }
      /* AND THEY DEAL WITH EACH OTHER, because an island where alliances only
         ever involve you is an island where you are the only person on it. */
      for (let i = 0; i < M.order.length; i++) {
        const a = M.wl[M.order[i]];
        if (!a.alive) continue;
        if (W.hash01(a.idx, day(), 7717) > 0.16) continue;
        for (let j = 0; j < M.order.length; j++) {
          const b = M.wl[M.order[j]];
          if (b.id === a.id || !b.alive) continue;
          if (allied(a.id, b.id) || waiting(a.id, b.id)) continue;
          if (!touching(a.id, b.id)) continue;
          if (wantsAlly(b, a.id)) { M.wait[key(a.id, b.id)] = { from: a.id, to: b.id, day: day() }; }
          break;
        }
      }
    }
    if (isHost()) sendRoster();
    repaintMap();
  }

  /* CAN HE SEE YOU. A shared frontier is the obvious answer and it was the
     only one, which meant a player who held no ground was invisible to every
     warlord on the island — see wantsAlly. So the second reading: you are
     STANDING on his ground or the ground next to it. That is the range of
     diplomacy in a world with no telephones, it is a thing the player does on
     purpose (you rode there), and it is measured off the same region graph
     the war already uses. */
  function touching(a, b) {
    const t = T();
    if (!t) return false;
    let f = [];
    try { f = t.frontierOf(a); } catch (e) { return false; }
    for (let i = 0; i < f.length; i++) if (f[i].owner === b) return true;
    if (b !== ME) return false;
    const here = t.at(S().you.x, S().you.z);
    if (!here) return false;
    if (t.owner(here.id) === a) return true;
    for (let i = 0; i < here.neighbours.length; i++) {
      if (t.owner(here.neighbours[i]) === a) return true;
    }
    return false;
  }

  /* ============================================================ THE RAIL
     HIS OFFER, AND YOUR TWO ANSWERS. games/warlord.html's verb rail, which
     is this game's answer to a modal: the world keeps running behind it, the
     camera keeps moving, the day keeps turning, and if a party rides into you
     while you are deciding, that happens.

     WHAT IS ON IT IS FACTS. His name, what he holds, what he has out, and
     whether he is already standing with anyone. There is no sentence
     explaining what an alliance is and no sentence explaining what the
     buttons do — the owner's note was "SHOW DONT TELL … just too much
     talking of the ui", and the old board's answer to this same moment was
     a card that said "An alliance is a promise not to charge each other. It
     holds exactly as long as both of you want it to." */
  let queued = null;
  function present() {
    if (!ctx || !ctx.verbs) return;
    /* NOT OVER SOMETHING ELSE. One rail at a time is the shell's rule, and a
       diplomatic offer is never more urgent than the fight you are in. */
    const p = W.phase ? W.phase() : "campaign";
    if (p !== "campaign" || ctx.verbsOpen()) { queued = 1; return; }
    let from = null;
    for (const k in M.wait) if (M.wait[k].to === ME) { from = M.wait[k].from; break; }
    if (!from) { queued = null; return; }
    queued = null;
    const w = wl(from);
    if (!w) return;
    const cols = columnsOf(from);
    let men = 0;
    for (let i = 0; i < cols.length; i++) men += W.bandSize(cols[i]);
    /* NO BODY PANEL. The first version put "STANDS WITH X, Y" in
       ctx.verbs's `body`, which is the expandable panel the encounter uses
       for its roster — and tools/warlord-fits.mjs caught what that costs on
       an 852x393 landscape phone: the panel and its HIDE toggle grew the
       bottom dock until it covered the campaign's own MAP button and both
       zoom controls. Three controls a thumb would land on and press the rail
       instead.

       It is also the wrong shape for the decision. A body panel is for a
       twelve-row roster you scroll; this is a man, his men, and two
       answers. */
    ctx.verbs({
      title: esc(w.name),
      /* THE SUB IS ONE FACT, AND THAT IS A LAYOUT DECISION WITH A PICTURE
         BEHIND IT. games/warlord.html's rail head is a single nowrap flex row
         where the title and the subtitle both ellipsis, and on the desktop
         build the rail is a ~330 px right-hand column. Four facts in the sub
         cut the man's NAME in half — the first ba sheet of this feature shows
         "JORI VANTT …" against "2 HOLDINGS · 2 COLUMN…", which is the worst
         possible thing to truncate on a screen whose whole question is who
         this person is.

         His ground and his columns are on the map card, which is where you
         go to look at a man's ground. The rail answers the one thing the
         decision turns on: how big is he. */
      sub: men + " MEN",
      options: [
        { label: "ACCEPT", kind: "good", on: function () { accept(from, ME); } },
        { label: "REFUSE", kind: "bad", on: function () { refuse(from, ME); } },
      ],
    });
  }

  function repaintMap() {
    const t = T();
    if (t && t.repaintCard) { try { t.repaintCard(); } catch (e) {} }
  }

  /* ============================================================ THE WIRE
     warnet.js owns the socket. Only the STANDING travels — who is allied to
     whom, and the four handshake verbs. The roster is derived from the seed
     on every client and the map is territory.js's own snapshot, so there is
     nothing else to send. */
  function isHost() {
    const N = W.warnet;
    if (N && N.simHost) { try { return !!N.simHost(); } catch (e) {} }
    return true;
  }
  function online() {
    const N = W.warnet;
    if (N && N.online) { try { return !!N.online(); } catch (e) {} }
    return false;
  }
  function wire(verb, obj) {
    if (!online()) return false;
    const N = W.warnet;
    if (N && N.send) { try { N.send(verb, obj); return true; } catch (e) {} }
    return false;
  }
  function sendRoster() {
    if (!online()) return;
    wire("wlwl", { ally: Object.keys(M.ally), wait: Object.keys(M.wait).map(function (k) { return M.wait[k]; }) });
  }
  /* A PEER IS A WARLORD TOO. He is not in the derived roster — he arrived
     from a socket — so he gets an id off his relay player id and warnet's own
     colour for him, which is what paints him on the map and on the sand. */
  function peerWid(pid) { return "p" + (pid | 0); }
  function adoptPeer(pid, name) {
    const id = peerWid(pid);
    if (M.wl[id]) return M.wl[id];
    const N = W.warnet;
    const w = {
      id: id, idx: 100 + (pid | 0), name: name || ("WARLORD " + pid),
      colour: (N && N.colourFor) ? N.colourFor(pid) : colourFor(pid + 1),
      home: null, alive: true, betrayals: 0, peer: pid | 0,
    };
    M.wl[id] = w;
    M.order.push(id);
    registerOwners();
    return w;
  }
  function recv(verb, m, from) {
    if (!m) return;
    const him = from == null ? null : peerWid(from);
    if (verb === "wlwl") {
      if (isHost()) return;                       // the host's own state is the truth
      M.ally = {};
      (m.ally || []).forEach(function (k) { M.ally[k] = day(); });
      M.wait = {};
      (m.wait || []).forEach(function (o) { if (o && o.from && o.to) M.wait[key(o.from, o.to)] = o; });
      repaintMap();
      present();
      return;
    }
    if (!him) return;
    /* A PEER'S MESSAGE IS ABOUT HIM AND ME AND NOBODY ELSE. The relay's own
       player id is the identity — never the id inside the payload, which is
       a thing the sender typed. */
    if (verb === "wla") { M.wait[key(him, ME)] = { from: him, to: ME, day: day() }; W.toast(nameOf(him) + " OFFERS HIS HAND", "good"); present(); return; }
    if (verb === "wlay") { M.wait[key(him, ME)] = M.wait[key(him, ME)] || { from: ME, to: him, day: day() }; accept(ME, him); return; }
    if (verb === "wlan") { refuse(ME, him); return; }
    if (verb === "wlab") { breakAlly(him, ME); return; }
  }

  /* ============================================================ MODULE */
  W.module("warlords", {
    needs: ["territory"],
    boot: function (c) {
      ctx = c;

      /* territory.js rasterises the island lazily and places its five
         factions the first time anything asks it a question. Warlords are
         placed AFTER that, on what is left, so raise() waits for the board
         to exist rather than racing it. */
      W.on("territory:ready", function () { raise(); });
      if (T() && T().regions.length) raise();

      /* ONE CLOCK: the campaign's day. */
      W.on("territory:dawn", function () { dawn(); });

      /* A QUEUED OFFER COMES UP WHEN THE SAND IS CLEAR. */
      W.on("phase", function (t) {
        if (t && t.to === "campaign" && queued) setTimeout(present, 400);
      });

      /* A NEW GAME IS A NEW ISLAND. */
      W.on("newgame", function () {
        M.ready = false; M.wl = {}; M.order = [];
        M.ally = {}; M.wait = {}; M.refused = {}; M.myBetrayals = 0;
      });

      const N = W.warnet;
      if (N && N.on) {
        ["wlwl", "wla", "wlay", "wlan", "wlab"].forEach(function (v) {
          try { N.on(v, function (m, from) { recv(v, m, from); }); } catch (e) {}
        });
      }
      if (N && N.onJoin) {
        try {
          N.onJoin(function (id, name) { adoptPeer(id, name); if (isHost()) sendRoster(); });
        } catch (e) {}
      }
    },

    // ---- who is on the island
    list: function () { return M.order.map(function (id) { return M.wl[id]; }); },
    warlord: wl,
    colourOf: function (id) { const w = wl(id); return w ? w.colour : 0x9a8f72; },
    columns: columnsOf,
    /* THE STANDING, for events.js's screens and for a headless probe. Derived
       on every call: there is no roster to raise and nothing to go stale. */
    leaderboard: leaderboard,
    menOut: menOut,
    countOut: countOut,
    /* what campaign.js's spawner holds back for the rivals — see reserve() */
    reserve: reserve,
    alive: function (id) { const w = wl(id); return !!(w && w.alive); },

    // ---- the standing. territory.js asks allied() on every frontier.
    allied: allied,
    alliedSince: alliedSince,
    /* HE HOLDS A GRUDGE. Set the moment an alliance with him is broken and
       never cleared: a man you betrayed does not forget, and the map card
       says so on his ground because that is a fact about the world rather
       than a note about the interface. */
    grudge: function (id) { const w = wl(id); return !!(w && w.grudge); },
    allies: alliesOf,
    waiting: waiting,
    offer: offer,
    accept: accept,
    refuse: refuse,
    breakAlly: breakAlly,
    betrayals: function () { return M.myBetrayals; },

    // ---- the seam territory.js's map card acts through
    present: present,

    /* territory.js's demo() wipes ownership to paint a staged island, which
       takes the warlord homes with it. This puts them back on what is free
       AFTER the stage has been painted, so a photographed island has real
       rivals on it rather than five factions and a gap where fourteen
       warlords used to be. */
    rehome: function () { if (!M.ready) raise(); else assignHomes(); return M.order.length; },
    ids: function () { return M.order.slice(); },

    audit: function () {
      const t = T();
      let held = 0, cols = 0, alive = 0;
      for (let i = 0; i < M.order.length; i++) {
        const w = M.wl[M.order[i]];
        if (w.alive) alive++;
        held += holdings(w.id);
        cols += columnsOf(w.id).length;
      }
      return {
        warlords: M.order.length, alive: alive,
        holdings: held, columns: cols,
        islandBands: (S().bands || []).length,
        totalWarlordColumns: totalColumns(),
        allies: alliesOf(ME).length,
        offersOpen: Object.keys(M.wait).length,
        betrayals: M.myBetrayals,
        regions: t ? t.regions.length : 0,
        columnMen: (function () {
          let n = 0;
          for (let i = 0; i < M.order.length; i++) n += menOut(M.order[i]);
          return n;
        })(),
        /* THE ONE THAT WOULD HAVE CAUGHT IT: how many living warlords have no
           column at all. It was fourteen of fourteen for the life of this file
           and nothing printed it. */
        columnless: (function () {
          let n = 0;
          for (let i = 0; i < M.order.length; i++) {
            const w = M.wl[M.order[i]];
            if (w.alive && !columnsOf(w.id).length) n++;
          }
          return n;
        })(),
        reserve: reserve(), cap: partyCap(),
        host: isHost(), online: online(),
      };
    },
  });
})();
