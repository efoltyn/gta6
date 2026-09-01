/* ============================================================
   warlord/campaign.js — RIDING IT.

   The campaign is one picture: a man crossing an enormous desert with a
   column of men behind him that gets LONGER. Everything in this file
   serves that picture or gets out of its way.

   CONTROLS ARE THE WHOLE PITCH, so they are three verbs and no more:

     TAP / CLICK THE GROUND  →  ride there. A marker drops where you
       pointed and he goes. The pick is an analytic march against
       W.desert.heightAt, NOT a mesh raycast: the clipmap under the
       cursor is 512 m-per-quad two kilometres out, so a raycast would
       put the marker up to a hundred metres from where you pointed
       while the function knows the real answer everywhere.
     HOLD WASD / DRAG THE STICK  →  steer him yourself, camera-relative.
       Touching the stick cancels the destination, because a game that
       argues with you about where you are going is a game with two
       drivers.

     TAP A PARTY  →  ride at it and engage it. The pick is screen-space,
       so a party two kilometres out is a 46 px target rather than a
       three-metre one, and the ride target TRACKS it — you are chasing a
       thing that is running, not a coordinate it used to be at.

   And the camera is not a fourth verb: it follows behind on its own,
   a drag swings it, the wheel or a pinch pulls it from over-the-shoulder
   out to a strategic view of the whole valley. There is NO mouse-look
   mode and nothing needs pointer lock.

   THAT IS THE ENTIRE CONTROL SURFACE and it is a hard line. Every key on
   this page (WASD, Q/E, M) is a CONVENIENCE for something already reachable
   with one tap, and if a player has to learn one, this file has failed.

   WHY studio.controls AND NOT A NEW CONTROL SCHEME. It already owns the
   WASD-or-stick branch, the touch furniture, the pause button a phone
   otherwise cannot press, and the look delta from either a mouse drag or
   a right-side thumb. Re-typing that is how every page in games/ got its
   own subtly different half-working version. What it has no concept of
   is CLICK-TO-GO, so that — and only that — is added here, on top: a
   press that moves less than a few pixels is a destination, a press that
   drags is the camera. One rule, both input methods.

   THE TRAIL IS THE GAME. Followers walk a breadcrumb of where you have
   actually been, with a per-man lateral offset, so the column bends
   through the wadi you rode down instead of sliding after you as a rigid
   blob. Only 60 of them are DRAWN — the roster can be a thousand and the
   difference between sixty men and four hundred on screen at this camera
   distance is nothing you can count.

   AND EVERY MAN WITHIN 150 m OF THE CAMERA IS A REAL BODY. Not a marker, not
   a billboard: a CBZ.studio.cast rig with arms and legs, dressed by
   W.outfits.cast in his own army's uniform, walking on CBZ.animChar and
   seated on the drawn sand by W.sand.plant — the same man battle.js fields,
   because it is the same call. Forty-eight of them, pooled and recycled,
   handed to whoever is nearest the eye. Past 150 m the men are instanced
   again — four draw calls for every man on the island, yours and theirs —
   but the instance is an eleven-box MAN cut to the rig's own proportions,
   not the six-sided cone with a head on it that this file shipped for
   months. See THE MEN below for the measurements, the budget and the
   revert flag.

   THE WORLD IS ON WALL TIME AND IT NEVER STOPS. This is a multiplayer
   island — openfront's shared board with Bannerlord's parties on it — and
   several warlords ride it at once, so the clock cannot be "time passes
   when I do something". `W.state.hour` advances on REAL seconds, the bands
   keep walking while you are inside a battle, an encounter card or a shop,
   and if the tab was in the background for ninety seconds the world catches
   up on the wall clock rather than pretending nothing happened.

   Mechanically that means the world tick is a `CBZ.onAlways` hook, not a
   `micro.onFrame` one: `always` runs in every phase AND while the engine is
   paused, which is the engine's own contract for exactly this. Only the
   DRAWING is gated on being the live phase. The first draft ticked the
   world from the render hook and the island froze solid the moment a battle
   took the screen — in single player you cannot tell, and in multiplayer it
   is the whole game being wrong.

   NOT EVERY CLIENT ROLLS THE DICE. In multiplayer one peer is the sim host
   and everyone else RENDERS what it is sent, so all the AI (moods, goals,
   band-vs-band, respawn) sits behind `C.simHost`. A guest still draws
   S.bands, still detects its own contacts, still runs its own clock — it
   just never invents a band or moves one. And nothing here assumes it is
   the only writer of `W.state.bands`: a band that arrives over the wire has
   none of this file's fields on it, so every band is normalised on the way
   into the loop instead of being trusted to have been made here.

   PEERS ARE PARTIES. Other warlords are drawn by THIS FILE, straight off
   `W.state.peers` ({id,name,x,z,size,colour}) — the contract's own home for
   them — through the same instanced bodies and the same banner the AI bands
   use, so a human party and a computer party are the same object on screen.
   warnet.js only has to keep that map up to date; it never draws.

   core/daynight.js was read and is NOT used: it is wired into CBZ.lightRig
   and core/sky.js which this page does not load, and it owns its own
   free-running cycle — this clock has to be the one the network agrees on.

   Flags:
     ?bands=N        population override (default scales with the island)
     ?men=old        the old cone impostors, no near-band rigs (the A/B)
     ?trail=off      draw no followers (the honest A/B for the trail)
     ?clock=off      freeze the day cycle at noon
     ?bandai=off     bands walk their goals and never react to you
     ?guest=1        boot as a sim GUEST: render bands, never roll them
     ?far=old        every party on the island is integrated every frame
                     again, however far away it is. The revert for the
                     distance-stepped world clock (see THE FAR CLOCK) and the
                     "before" column for tools/warlord-scale-check.mjs
                     --island.

   Events raised here: `campaign:ready` `campaign:dest` `campaign:band`
   `campaign:peer` — you tapped another warlord's column
   `campaign:zoom` — {dist, t, yaw, x, z}. territory.js reads this so its
   ownership map and this camera are the same view at two ranges.
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const THREE = G.THREE;
  const S = W.state;

  const QP = (function () {
    try { return new URLSearchParams(G.location ? G.location.search : ""); }
    catch (e) { return { get: function () { return null; } }; }
  })();
  const FLAG_NOTRAIL = QP.get("trail") === "off";
  const FLAG_NOCLOCK = QP.get("clock") === "off";
  const FLAG_NOBANDAI = QP.get("bandai") === "off";
  const FLAG_GUEST = QP.get("guest") === "1";
  /* THE CONE, ON PURPOSE. ?men=old restores the six-sided cylinder-and-box
     every man on this map used to be, with the old camera-driven size lie and
     no near-band rigs at all — so the thing the owner complained about can be
     photographed beside the thing that replaced it. Repo doctrine: every
     behaviour change ships with its own revert. */
  const FLAG_MEN_OLD = QP.get("men") === "old";
  /* ?folk=off — the outposts still stand, and nobody is in them. The honest
     A/B for the people, and the thing the owner was actually looking at:
     "a man with a crate popup with no man there". */
  const FLAG_NOFOLK = QP.get("folk") === "off";
  const FLAG_FAR_OLD = QP.get("far") === "old";

  const C = W.campaign = W.campaign || {};
  /* ONE PEER ROLLS THE DICE. Default true so single player is unchanged;
     warnet.js flips it false on a guest and this file becomes a renderer
     for whatever S.bands it is handed. Everything gated by it is an
     AUTHORING act — inventing a band, moving one, deciding a fight. A guest
     still runs its own clock, its own camera and its own contact test,
     because those are about the player in front of this screen. */
  C.simHost = !FLAG_GUEST;
  const TAU = Math.PI * 2;
  const clamp = W.clamp;
  const lerp = W.lerp;

  /* ============================================================ NUMBERS
     Every one of these is derived from something or was measured, per the
     house rule. None of them is a taste. */
  const RIDE_SPEED = 15.5;      // m/s. The island is 13 km; at 15.5 m/s a
                                // corner-to-corner ride is ~14 min of real
                                // time and ~16 in-game hours — one day's
                                // ride, which is the unit the game counts in.
  const BAND_SPEED = 6.2;       // they walk, you ride. The gap is what makes
                                // "outrun them" a real option.
  const HUNT_SPEED = 8.4;       // a band that wants you moves like it means it
  /* AN HOUR IS 45 REAL SECONDS, and that number is derived, not chosen: the
     island is 13 km across and a ride across it at RIDE_SPEED takes about
     14 real minutes, which used to be defined as one day's ride. Keeping
     that identity on a wall clock puts a 24 h day at 18 real minutes and an
     hour at 45 s. The shape of the pacing is unchanged; what changed is that
     it is now the same for everybody on the island whether they are riding,
     shopping or in a battle. */
  const HOUR_SECS = 45;
  const CATCHUP_MAX = 120;      // sim substeps a single wake-up may run — see worldTick
  const DRAWN_FOLLOWERS = 60;   // see the header. The roster is uncapped.
  const CONTACT = 26;           // metres. The encounter card comes up here.
  const OUTPOST_R = 46;
  const BAND_DRAW = 1500;       // past this a party is fewer than two pixels;
                                // the world map is where you see them instead
  const NAMEPLATE_R = 340;
  const TRAIL_STEP = 1.6;       // breadcrumb spacing, metres
  const TRAIL_MAX = 420;        // breadcrumbs kept = 670 m of column

  /* ============================================================ STATE */
  let ctx = null, micro = null, scene = null, camera = null;
  let live = false, built = false;
  let root = null;                 // everything this file draws
  let controls = null;
  let you = null, youRig = null;   // the real cast body
  let menBody = null, menLegs = null, menHead = null, menCap = null, banner = null, pole = null;
  let marker = null, markerT = 0;
  let dest = null;                 // {x,z} or null
  let camYaw = 0, camDist = 46, camDistWant = 46;
  /* THE TRAIL IS AN ARC-LENGTH PATH, NOT A LIST OF SLOTS. Every crumb carries
     `s`, the distance along the path from the first crumb kept, so a follower
     is placed by asking "where was he 37.4 m back" and getting an interpolated
     point on the polyline. See sampleTrail. The first version indexed the
     array — `breadcrumbs[len-1-floor(back/TRAIL_STEP)]` — and that is THE bug
     the owner was looking at: a follower stood perfectly still for every frame
     between two crumb pushes and then jumped a whole TRAIL_STEP forward in one
     frame. Measured on a mounted ride at 30 fps that is sixty men each
     teleporting 1.9 m about six times a second, with their legs walking
     smoothly the whole time. */
  let breadcrumbs = [];            // [{x,z,s}] newest last, s = metres along
  let crumbAcc = 0;
  let trailLen = 0;                // arc length of the last crumb
  let travelled = 0;
  let gapCur = 0;                  // damped column spacing, see drawMen
  let hudRoot = null, plateBox = null, compass = null, compassG = null, mapWrap = null;
  let fightTick = 0, spawnTick = 0;
  let lastWall = 0, clockH = null;
  let chase = null;                // the band you tapped, if any
  let lastZoomSent = -1;
  const peerDraw = [];             // {x,z,size,colour,name} rebuilt each frame
  let nearBand = null, nearOutpost = null;

  /* ============================================================ THE WORLD
     Outposts and bands are placed ONCE per campaign, off the seeded stream,
     so the same seed is the same island with the same people on it. */

  /* THE FALLBACK TABLE ONLY. outpost.js owns the real kinds (W.OUTPOST_KINDS:
     depot/camp/well/market, each with a label and a tag) and this list is the
     shape used ONLY when that file did not load. It was called OUTPOST_KINDS
     and that name shadowing the global is exactly how the nameplate shipped
     reading "MARA undefined undefined": makeOutpost's real path returned
     outpost.js's object, which has neither .label nor .note, and nothing
     noticed because this table — which does have them — was sitting right
     there under the same name. */
  const FALLBACK_KINDS = [
    { kind: "depot", label: "DEPOT", note: "guns and powder", colour: 0xb0763a },
    { kind: "camp",  label: "CAMP",  note: "men for hire",    colour: 0x7a8f4a },
    { kind: "town",  label: "TOWN",  note: "both, dearer",    colour: 0xc2a05a },
  ];

  function placeOutposts() {
    const D = W.desert;
    S.outposts.length = 0;
    /* ITS OWN STREAM, AND THAT IS A BUG FIX, NOT A STYLE CHOICE. This
       function used to draw from the campaign's single shared stream, so
       where every outpost on the island stood depended on how many times
       anything else had rolled a die before enter() ran. Booting the same
       seed twice put the first depot three kilometres from where it had
       been, because the world tick runs on the WALL CLOCK in every phase and
       how many times it has fired before the island comes up is a property
       of the machine and not of the seed. Measured by booting seed 1337
       twice and diffing W.state.outposts.

       That is a campaign that cannot be replayed, which is the exact thing
       core.js's DICE note says the seeded stream exists to prevent, and on a
       shared island it is worse than an inconvenience: two peers on one seed
       would have put their depots in different places.

       A stream of its own, seeded off S.seed, makes where the outposts are a
       property of the seed and of nothing else. (The BANDS are still drawn
       from the shared stream and still move with boot timing. Same bug one
       layer up, and not this pass's to fix — a band is not a landmark and
       nothing navigates by one.) */
    const R = W.rngFrom(((S.seed | 0) * 7919 + 13) >>> 0);
    /* SIX TO NINE, and they are placed AT LANDMARKS rather than at random:
       an outpost in the middle of an anonymous erg is a shop you can only
       find by accident. Every oasis gets one (that is what an oasis is FOR
       in a desert economy), and the rest go on the coast where a boat could
       reach them. */
    const named = ["MARA", "TIN OUZAL", "DUST GATE", "SABKHA", "REDWALL", "GHARIB",
                   "SALT CROSS", "LOW WELL", "BONE CAMP", "FARKH LANDING"];
    let n = 0;
    for (let i = 0; i < D.oases.length && n < 5; i++) {
      const o = D.oases[i];
      /* THE FLATTEST OF TEN DRAWS. landPoint answers "somewhere near this
         oasis that is not a cliff"; it has no idea a compound is 20 m wide.
         Ten candidates and keep the best pad — cheap (130 heightAt calls)
         and it is the difference between a camp on a slope and a camp on a
         floor. First acceptable wins, so a flat oasis costs one draw. */
      let p = null, bestR = 1e9;
      for (let t = 0; t < 10; t++) {
        const q = D.landPoint(R, { near: { x: o.x, z: o.z }, nearR: o.r * 2.4, maxSlope: 0.24 });
        if (!q) continue;
        const pad = padAt(q.x, q.z);
        if (pad.wet) continue;                  // landPoint knows the sea, not the pond
        if (pad.relief < bestR) { bestR = pad.relief; p = q; }
        if (pad.relief <= PAD_OK) break;
      }
      if (!p) continue;
      S.outposts.push(makeOutpost(named[n % named.length], n % 3 === 1 ? "camp" : "town", p, o.name));
      n++;
    }
    for (let guard = 0; guard < 400 && S.outposts.length < 8; guard++) {
      const a = R() * TAU;
      const p = coastPoint(a);
      if (!p) continue;
      let clash = false;
      for (let i = 0; i < S.outposts.length; i++) {
        if (Math.hypot(S.outposts[i].x - p.x, S.outposts[i].z - p.z) < 1800) { clash = true; break; }
      }
      if (clash) continue;
      S.outposts.push(makeOutpost(named[n % named.length], n % 2 ? "depot" : "camp", p, null));
      n++;
    }
    /* AND THE NIGHT MARKET, WHICH HAS NEVER ONCE EXISTED IN A GAME.

       outpost.js declares four kinds. This function makes three. The oasis
       loop draws from {camp, town} and the coast loop from {depot, camp}, so
       `market` has never been reachable in a campaign — outpost.js's whole
       paragraph about why the fourth kind earns its place (the only buyer
       who pays 0.55 on the dollar, so forty looted pistols have an exit, and
       the only seller who ignores rarity, so a launcher can be planned for)
       has been describing a place that does not exist. Its own PATTERN table
       has a market in it and nothing calls that function.

       WHERE IT GOES IS THE ARGUMENT FOR IT EXISTING. outpost.js says "deep
       in the interior where nobody official goes", which is also the only
       part of a 14 km island the other three kinds never send you to: the
       depots are on the water and the camps and wells are at the oases, all
       of which are coastal or mid-radius. So the market is placed inside the
       inner third, at least 2 km from anything already standing, and the
       island finally has a reason to ride through its own middle. */
    for (let guard = 0, made = 0; guard < 600 && made < 2; guard++) {
      const a = R() * TAU;
      const rr = D.RADIUS * (0.10 + R() * 0.24);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (!D.onLand(x, z) || D.slopeAt(x, z) > 0.20) continue;
      const pad = padAt(x, z);
      if (pad.wet || pad.relief > PAD_OK) continue;
      let clash = false;
      for (let i = 0; i < S.outposts.length; i++) {
        if (Math.hypot(S.outposts[i].x - x, S.outposts[i].z - z) < 2000) { clash = true; break; }
      }
      if (clash) continue;
      S.outposts.push(makeOutpost(named[n % named.length], "market", { x: x, z: z }, null));
      n++; made++;
    }
    return S.outposts;
  }
  /* THE FLATNESS TEST EVERY PLACER HAS TO PASS, and it is not the same test
     as `slopeAt`. A slope reading is one derivative at one point; a compound
     is 20 m across and 12 m of it is a rigid container row. 0.22 at the
     centre is 4.4 m of rise to the edge of the pad, which is a depot with
     one end in the air — measured on the first pass, where the depot's
     ground came back at 6.59 m peak to peak while the camps and wells sat
     under 0.8. levelPad() can nudge a compound 180 m to improve on what it
     was handed, and it cannot rescue a placer that only ever hands it hills.
     So the placers ask for a PAD now and the search is the polish. */
  const PAD_OK = 1.7;                // metres peak-to-peak a compound tolerates
  function coastPoint(a) {
    const D = W.desert;
    // walk in from beyond the coast until the ground is 4 m up: a landing,
    // not a beach you would drown a crate on
    for (let r = D.RADIUS + 1100; r > 800; r -= 40) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = D.heightAt(x, z);
      if (y <= 4 || D.slopeAt(x, z) >= 0.22) continue;
      const pad = padAt(x, z);
      if (!pad.wet && pad.relief <= PAD_OK) return { x: x, z: z, y: y };
    }
    return null;
  }
  /* WHO BUILDS AN OUTPOST — and for two days the answer was "both of us".

     This file placed outposts at landmarks and constructed them itself, with
     its own kinds ("town") and its own fields. outpost.js placed them too,
     with `stock`, `armourStock`, `pool`, `capital` and `markup`. Both pushed
     into W.state.outposts. Riding up to one of THESE and pressing BUY threw
     `Cannot convert undefined or null to object` out of Object.keys(o.stock),
     because this constructor had never heard of stock — the exact "two
     modules invent two versions of one thing" failure CONTRACT.md exists to
     stop, and neither agent could see it alone.

     The split is now the obvious one. This file knows WHERE an outpost
     belongs — at an oasis, on a landing a boat could reach — because it owns
     the island and the ride. outpost.js knows WHAT one is, because it owns
     the trading. So geography is chosen here and construction is delegated
     there, and the standalone constructor below survives only for a page
     where outpost.js failed to load, where a marker you cannot trade with
     still beats no landmark at all. */
  function makeOutpost(name, kind, p, at) {
    const y = p.y != null ? p.y : W.desert.heightAt(p.x, p.z);
    if (W.outpost && W.outpost.build) {
      /* outpost.js has no "town" — its kinds are depot/camp/well/market.
         A town at an oasis is a well; a town on the coast is a depot. */
      const k = kind === "town" ? (at ? "well" : "depot") : kind;
      const o = W.outpost.build(k, p.x, p.z);
      if (o) {
        o.name = name;               // this file owns the naming; it knows the place
        /* AND THE WORDS UNDER THE NAME. outpost.js keeps a kind's label and
           tag in its KINDS table and does not copy them onto the object it
           builds, so the campaign nameplate — which prints name + label with
           note underneath — read "MARA undefined undefined" over every oasis
           on the island. Stamped here rather than looked up at the plate,
           because the plate is not the only reader and the next one would
           have hit the same hole. */
        const OK = W.OUTPOST_KINDS && W.OUTPOST_KINDS[k];
        o.label = o.label || (OK && OK.label) || String(k).toUpperCase();
        o.note = o.note || (OK && OK.tag) || "";
        o.y = y;
        o.at = at || null;
        o.biome = W.desert.biomeAt(p.x, p.z);
        return o;
      }
    }
    const K = FALLBACK_KINDS.filter(function (k) { return k.kind === kind; })[0] || FALLBACK_KINDS[0];
    return {
      id: "op" + (S.outposts.length + 1),
      name: name, kind: kind, label: K.label, note: K.note,
      x: p.x, z: p.z, y: y,
      at: at || null,
      colour: K.colour,
      biome: W.desert.biomeAt(p.x, p.z),
      // positional, not drawn: this is the no-outpost.js fallback and a
      // roll here would shift every later draw on the shared stream
      wealth: clamp(0.3 + W.hash01(p.x, p.z, 91) * 0.6, 0.2, 0.95),
      restocked: 0,
      // never let a fallback outpost crash a trader that expects these
      stock: {}, armourStock: {}, pool: {},
    };
  }

  /* BAND POPULATION. Sized to the island, not typed: one party per ~2.6 km²
     of land gives ~55 on this island, which is dense enough that a ride of
     two minutes meets somebody and sparse enough that you are not being
     mobbed. Sizes follow a power law — three men is common, three hundred is
     a thing you tell stories about. */
  /* HOW MANY BIG PARTIES. The old answer was "one per 2.6 km² of land, clamped
     to 40..70", and the clamp did all the work: this island is 101 km², so the
     density gave 39 and the floor pinned it to FORTY, every time, on every
     seed. A density that never binds is not a density, it is a constant with a
     comment on it.

     THE OWNER'S ASK: "Multiplayer is way not dense enough add way way more
     total armies." So the density is now real and it is set from a MEASURED
     budget rather than from taste — see tools/warlord-scale-check.mjs
     --island, which sweeps ?bands=N against the campaign frame, the save
     payload and the party census.

     ONE PER 0.9 km². On 101 km² of land that is 113 big parties, and 0.9 km²
     is a square just under a kilometre on a side — which is the point: at
     BAND_DRAW (1.5 km) you can now see more than one army at once, which you
     essentially never could at one per 2.6 km². The clamp is still there and
     still exists to stop a tiny or enormous island from being absurd, but it
     is now wide enough that the density is what decides.

     WHY NOT MORE: the binding ceiling is not the frame. It is the SAVE — see
     smallTarget's note. */
  /* ONE PER 0.55 km2, NOT 0.9, AND THE CHANGE PAID FOR ITSELF. The scale wave
     bought its density from the SMALL tier (5 small per big) because smalls
     are cheap, and the headless economy measured what that cost: at 5:1 five
     of every six parties you meet is a crew you cannot lose to, the bold and
     the cautious warlord end up in the same place, and the run stops being a
     game (core.js's W.SMALL_PER_BIG carries the table). The mix went back to
     1.4 and the density moved HERE, where it costs save bytes instead of the
     risk gradient: 184 big + 258 small = 442 parties, ~14 500 men, about
     2.4 MB of the 5 MB quota — four and a half times the island this wave
     started on, with the gradient intact and headroom for a campaign to grow
     an army, prisoners and a baggage train into. */
  const BIG_PER_KM2 = 1 / 0.55;
  function bandTarget() {
    const q = parseInt(QP.get("bands") || "", 10);
    if (q > 0) return Math.min(1200, q);
    const D = W.desert;
    const landKm2 = Math.PI * (D.RADIUS / 1000) * (D.RADIUS / 1000) * 0.72;
    return Math.round(clamp(landKm2 * BIG_PER_KM2, 60, 260));
  }
  /* THE POWER LAW MOVED TO core.js (W.rollBigSize) AND DID NOT CHANGE. It was
     written here under a comment saying "median ~22, one in fifty over 120",
     and it was wrong by a factor of two in both directions: measured, the
     median is 38 and 26% of parties are over 120 men. That one number is why
     the island reads as nothing but massive armies — a dozen of the forty
     parties are a hundred-plus strong and there is almost nothing on it a man
     alone can take. The curve is LEFT EXACTLY AS IT WAS on the owner's
     instruction ("don't deduct any from current"); the small parties are a
     SECOND population added beside it (smallTarget below). It lives in core
     now so tools/warlord-check.mjs's headless campaigns can draw from the same
     pool the player rides through — they were measuring a different island. */

  /* HOW MANY SMALL PARTIES RIDE ALONGSIDE THE BIG ONES. A second target, not
     a share of the first: the forty parties bandTarget() asks for still spawn
     off the power law above and are still as big as they ever were. These are
     extra.

     W.SMALL_PER_BIG (1.4) rather than a round number because the ratio is what
     the map has to read as — Bannerlord's island is mostly small parties with a
     few armies moving through it, and at 1:1 it is still a parade ground.
     Fifty-six small parties on top of forty is ~96 in the world, which sits
     under campaign.js's own 160-banner instance cap with room for the peers
     and the event spawns, and costs almost nothing in bodies: a six-man party
     draws six men where a two-hundred-man one draws sixty (see bandShow).

     ?smalls=0 turns the whole population off (the island exactly as it was);
     ?smalls=N sets the count. */
  /* AND THE SMALL ONES ARE WHERE "WAY MORE ARMIES" ACTUALLY COMES FROM.

     W.SMALL_PER_BIG is 1.4 and lives in core.js, which this file may read and
     the headless campaign in tools/warlord-check.mjs also reads — so it is not
     a number to change from here. It is also not the number this decides any
     more, and that is deliberate rather than a fork: 1.4 was chosen when there
     were forty big parties, as a RATIO, and a ratio hung off the big-party
     count means every extra army on the island drags a fixed tail of crews
     behind it. The two populations answer different questions. How many armies
     are on this island is a question about the island. How many two-man looter
     crews are on it is a question about how alive the empty ground between
     them feels, and the answer to that is "far more than one and a half per
     army".

     THE CEILING IS THE SAVE, NOT THE FRAME, and it is worth writing down
     because nothing in this repo would have found it:

       W.save() is JSON.stringify(the whole of W.state) into localStorage, and
       every soldier in every party on the island is in there. localStorage is
       5 MB and W.save() catches the quota error and returns false, which
       nothing checks — so an island that is too populous does not run slowly,
       it stops saving and never says so.

     MEASURED with tools/warlord-scale-check.mjs --island (see the report in
     that file's header): a BIG party averages 67 men off core's power law and
     a small one averages 8, so the souls in the world — and therefore the
     save — are dominated by the big ones. That is what makes the small tier
     the cheap way to fill the map: five hundred extra small parties cost about
     what sixty extra big ones do, and they are the ones a lone warlord on day
     one can actually fight.

     FIVE SMALL PARTIES PER BIG ONE. MEASURED on seed 1337: 113 big and 563
     small, 676 parties in the world against the 96 that were there before —
     seven times the armies — 11 047 souls, a 1.87 MB save (37% of the quota,
     against ~0.6 MB before) and a 0.50 ms campaign frame, which is cheaper
     than the old ninety-six were (see THE FAR CLOCK). The sweep past it is
     what fixes the ceiling: 1 770 parties is a 5.02 MB save, i.e. exactly at
     the quota, so the island is full at about 300 big parties and 113 leaves
     the headroom a campaign needs to grow prisoners, baggage and an army
     into.

     ?smalls=0 turns the whole population off (the island exactly as it was
     before the small tier existed); ?smalls=N sets the count. */
  /* THE RATIO IS core.js's, NOT A SECOND COPY OF IT. The scale wave typed a
     local `const SMALL_PER_BIG = 5` here because it could not edit core.js,
     which re-forked the one number the previous wave had just unified — and a
     second copy is how the headless economy check goes back to measuring an
     island nobody rides. Read it, do not restate it. */
  function smallTarget() {
    const raw = QP.get("smalls");
    if (raw === "0" || raw === "off") return 0;
    const q = parseInt(raw || "", 10);
    if (q > 0) return Math.min(2000, q);
    return Math.round(bandTarget() * W.SMALL_PER_BIG);
  }
  function spawnBand(opts) {
    opts = opts || {};
    const D = W.desert;
    const p = opts.at || D.landPoint(W.rnd, { maxSlope: 0.30 });
    /* SMALL PARTIES ARE A DIFFERENT CONSTRUCTOR, not a different roll. core's
       W.makeSmallBand picks the archetype (LOOTERS, SALT CARAVAN, OASIS
       PATROL…), which carries the name, the size band, the faction its colour
       and its men's tiers come from, and how badly it wants a fight with you.
       Everything else — guns, armour, purse, horses — falls out of head count
       through makeBand's own wealth curve, unchanged. */
    const b = W.rollIslandBand({ x: p.x, z: p.z, small: !!opts.small, kind: opts.kind, size: opts.size });
    b.y = D.heightAt(b.x, b.z);
    b.yaw = W.rnd() * TAU;
    /* THESE THREE FIELDS ARE ADDED HERE, not in core, on purpose: they are
       CAMPAIGN facts (where is it walking, does it remember losing to me,
       when may it bother me again) and they mean nothing to the battle or
       the network. core.js declares the band; this file declares how a band
       behaves on a map. */
    b.scared = 0;                 // rounds lost to you — a beaten band avoids you
    b.think = W.rnd() * 1.6;      // stagger the AI so 60 bands never think together
    b.pause = 0;
    pickGoal(b);
    S.bands.push(b);
    return b;
  }
  function pickGoal(b) {
    const D = W.desert;
    const r = W.rnd();
    /* THEY GO SOMEWHERE, and where is the difference between a world and a
       screensaver. Half the time an outpost (that is where the money is),
       a quarter an oasis (that is where the water is), a quarter open sand. */
    if (r < 0.5 && S.outposts.length) {
      const o = W.pick(S.outposts);
      b.goal = { x: o.x + (W.rnd() - 0.5) * 160, z: o.z + (W.rnd() - 0.5) * 160, why: o.name };
    } else if (r < 0.75 && D.oases.length) {
      const o = W.pick(D.oases);
      b.goal = { x: o.x + (W.rnd() - 0.5) * 200, z: o.z + (W.rnd() - 0.5) * 200, why: o.name };
    } else {
      const p = D.landPoint(W.rnd, { maxSlope: 0.30 });
      b.goal = { x: p.x, z: p.z, why: "" };
    }
    b.mood = "roam";
  }

  /* ============================================================ ENTER */
  C.enter = function () {
    const D = W.desert;
    if (!D || !D.heightAt) { W.toast("the island did not load", "bad"); return; }
    if (!built) buildOnce();

    D.build({ seed: S.seed, at: { x: S.you.x, z: S.you.z } });
    D.show();

    if (!S.outposts.length) { placeOutposts(); outpostsRaised = false; }
    if (!outpostsRaised) { raiseOutposts(); outpostsRaised = true; }
    if (!S.bands.length) {
      const n = bandTarget(), sm = smallTarget();
      for (let i = 0; i < n; i++) spawnBand();
      /* AND THE SMALL ONES, INTERLEAVED RATHER THAN APPENDED. landPoint is
         driven by the seeded stream, so spawning all forty big parties and
         then all fifty-six small ones puts every small party in the second
         half of the point sequence — which on a 14 km island is a visible
         bias, not a statistical nicety. */
      for (let i = 0; i < sm; i++) spawnBand({ small: true });
      W.log(S.bands.length + " parties are somewhere out there.");
    }
    /* YOU START ON A BEACH. Not in the middle: the first thing the game has
       to teach is that this is an ISLAND, and the cheapest way to teach it
       is to put the sea behind you on frame one. */
    if (!S.you.placed) {
      const a = W.rnd() * TAU;
      const p = coastPoint(a) || D.landPoint(W.rnd, {});
      S.you.x = p.x; S.you.z = p.z; S.you.yaw = Math.atan2(-p.x, -p.z);
      S.you.placed = true;
      breadcrumbs.length = 0; trailLen = 0; crumbAcc = 0; gapCur = 0;
    }
    camYaw = S.you.yaw;
    dest = null;
    if (!lastWall) lastWall = W.clock.now();
    showAll(true);
    W.setPhase("campaign");
    live = true;
    if (ctx && ctx.paintHud) ctx.paintHud();
    W.emit("campaign:ready", S);
  };

  function buildOnce() {
    built = true;
    root = new THREE.Group();
    root.name = "warlordCampaign";
    scene.add(root);

    /* YOU. The one body a camera ever gets near, so it is the shipped rig.
       `officer` because the wardrobe reads as somebody in charge and that is
       free characterisation. */
    youRig = CBZ.studio && CBZ.studio.cast ? CBZ.studio.cast("officer", { color: 0xc46a33, variant: 3 }) : null;
    /* AND THEN YOU PUT YOUR OWN CLOTHES ON. wardrobe.js shipped a lazy wrap
       around studio.cast to dress the warlord until this line existed —
       which worked, and which is a monkeypatch on an engine entry point that
       every man in the game goes through. Calling it explicitly is two lines
       and removes a whole class of surprise. */
    if (youRig && W.wardrobe && W.wardrobe.dressYou) W.wardrobe.dressYou(youRig);
    if (youRig) root.add(youRig);
    else {
      // people pack absent: a placeholder that is honestly a placeholder
      youRig = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.8, 0.35),
        new THREE.MeshLambertMaterial({ color: 0xc46a33 }));
      root.add(youRig);
    }
    /* AND HE CASTS A SHADOW, WHICH HE DID NOT. `group.castShadow = true` is a
       no-op in three.js — the flag is read per MESH — so this line has been
       decoration since it was written, and it did not matter while the only
       other bodies on the map were instanced cones with the flag set on the
       InstancedMesh itself. It matters now: the pooled rigs beside him set it
       on their meshes, so the warlord would have been the one man on the
       island standing on clean sand. */
    youRig.traverse(function (o) { if (o.isMesh) o.castShadow = true; });

    buildMen();
    buildMarker();
    buildOutpostProps();
    buildHud();

    controls = CBZ.studio.controls("walk", { buttons: {}, pause: true });
    bindPointer();

    micro.onFrame(step, { order: 5, id: "warlord-campaign" });
    /* THE DAY TINT IS THE BASE COAT AND IT RUNS FIRST. events.js ships
       weather — a sandstorm has to be able to grey the sun out — and two
       modules writing CBZ.sun in the same frame is decided purely by hook
       order. So the clock's tint goes in at -20, before every gameplay hook,
       and anything that wants to modify the light runs after it and wins.
       (microboot's own restore is an `always` hook, which runs before all of
       these, so this still lands on a clean rig every frame.) */
    micro.onFrame(function () { if (built) tintDay(); }, { order: -20, id: "warlord-daytint" });
    /* THE WORLD, ON THE WALL CLOCK, IN EVERY PHASE. `always` is the engine's
       own name for "runs even while paused" and that is exactly the contract
       a shared island needs: the bands must keep walking while this player
       is reading an encounter card, fighting a battle, or has the tab in the
       background. Order 30 is after microboot's own light restore (9) and
       after nothing else on this page. */
    if (CBZ.onAlways) CBZ.onAlways(30, worldTick);
    else micro.onFrame(function () { worldTick(); }, { order: -5 });

    /* THE ISLAND IS HIDDEN, NOT DESTROYED, when the battle takes the screen.
       Rebuilding 14 km of terrain after every fight is ~30 k heightAt calls
       and a visible stall, for a world that did not change. */
    W.on("phase:leave:campaign", function () { live = false; showAll(false); });
    W.on("phase:campaign", function () {
      live = true; showAll(true);
      if (W.desert.show) W.desert.show();
    });
    W.on("newgame", function () {
      /* THE POOL SURVIVES A NEW GAME; ITS ASSIGNMENTS DO NOT. The forty-eight
         bodies are expensive (19 ms each) and generic until they are dressed,
         so rebuilding them would be a second of stall for nothing. The KEYS
         are soldier ids from a world that no longer exists, and a slot still
         claiming one would hand a dead man's uniform to whoever inherits his
         id. Release them all; they re-dress on demand. */
      for (let i = 0; i < rigSlots.length; i++) releaseSlot(rigSlots[i]);
      // and the outpost staff, for the same reason: those keys name outposts
      // on an island that no longer exists
      for (const k in folkMen) delete folkMen[k];
      S.you.placed = false;
      outpostsRaised = false;
      clockH = null;
      breadcrumbs.length = 0; trailLen = 0; crumbAcc = 0; gapCur = 0;
      dest = null;
    });
  }

  function showAll(on) {
    if (root) root.visible = !!on;
    if (hudRoot) hudRoot.style.display = on ? "block" : "none";
    if (!on && mapWrap) mapWrap.style.display = "none";
    if (controls && controls.show) controls.show(!!on);
    if (!on && W.desert.hide) W.desert.hide();
  }

  /* ============================================================ THE MEN
     TWO BANDS, AND THE NEAR ONE IS MADE OF REAL BODIES.

     WHAT THIS REPLACES AND WHY. Every man on this map used to be a six-sided
     tapered cylinder with a box on top — your whole column and all forty
     warbands. The owner's word for it: "the NPCs look like fucking cone
     glitchy people on the map instead of like the character", and he is
     right. The file's own comment defended it with a real measurement (60
     studio.cast rigs is ~1 100 draw calls and 22 fps; a cone is 2 calls), and
     that measurement is still true — the CONCLUSION was wrong. It solved the
     four-hundred-men-at-200-m case and then applied that answer to the six
     men walking three metres from the camera, where a cone is indefensible
     and where the whole fantasy of the game lives.

     So: two bands, with the boundary where the pixels say it should be.

       NEAR (< 150 m of the CAMERA)  a real CBZ.studio.cast rig, dressed by
         W.outfits.cast, walking on CBZ.animChar, seated by W.sand.plant.
         Arms, legs, a gait, the faction's own uniform. The same body
         battle.js fields, because it is literally the same call.
       FAR (beyond)  still instanced — four draw calls for every man on the
         island, yours and theirs — but the instance is an ELEVEN-BOX MAN, not
         a cone: two booted legs, a pelvis, a torso, a shoulder yoke, two arms,
         a face and a cap, cut to the rig's own proportions. Four meshes rather
         than one because a man is four COLOURS: his shirt, his trousers, his
         skin and his hat. The cone had one, which is most of why it was a
         cone.

     WHERE 150 m COMES FROM. Vertical fov here is 68°, so at 1080p the screen
     spans 1.35 rad over 1080 px ≈ 800 px/rad. A 1.75 m man at 150 m subtends
     0.0117 rad — 9 px tall, with limbs one pixel wide. That is the range at
     which a rig stops buying anything a box silhouette cannot buy. It is also
     comfortably inside desert.renderHeightAt's stated 400 m validity limit,
     which matters more than it looks: the rig is seated on the DRAWN ground
     by sand.plant and the impostor has to stand on that same surface or the
     swap is a vertical jump of up to 1.6 m on a dune face.

     THE POOL IS 48 AND IT IS RECYCLED, NEVER REBUILT. Measured on this box:
     one W.outfits.cast is 19.3 ms and one W.outfits.dress onto an existing
     rig is 0.52 ms — 37x cheaper. Building a rig per man per entry would be a
     stutter every time you turned the camera. So there are 48 bodies, they
     are built ONE PER FRAME as demand appears (two in a frame is a visible
     hitch at 19 ms each), they are handed to whichever men are nearest the
     camera, and they are re-dressed only when the man in the slot changes.

     WHY 48. battle.js measured 1 109 draw calls with 40 rigs in frame on this
     same page and ships at playable framerate. The campaign also draws the
     island — 105 calls of clipmap, banners, props and outposts. Holding the
     whole campaign under battle.js's demonstrated number leaves ~1 000 calls
     for men. Measured on this box: forty rigs in frame is 1 109 draw calls
     against a 105-call empty island, i.e. 25.1 calls a rig with everything
     visible and 19.4 with all six of the rig's detail meshes hidden — this
     file hides four of them (the face), which lands near 21. Say 21 and the
     budget is 47 bodies. Forty-eight, and it is not a coincidence.

     WHAT IT ACTUALLY COSTS, measured after the fact on the worst case this
     game can build — forty warbands crowded inside the drawn radius, the pool
     saturated, your forty-man column in frame: 679 draw calls and 170 k tris,
     against 110 calls and 136 k for the cone. Under the ceiling with room to
     spare, because frustum culling means the men BEHIND the camera cost
     nothing and half the pool usually is.

     THE SWAP DOES NOT POP, and that is four separate things:
       · the impostor is cut from CBZ.charProfile() — the same table the rig
         is built from — times CBZ.HUMAN_SCALE, so the proportions cannot
         drift apart when somebody edits the body.
       · both stand on renderHeightAt inside 400 m (see above).
       · both take their colours from W.outfits.marks / the same fit record.
       · 150 m in, 178 m out. A man walking the boundary would otherwise
         flicker between forms every time the camera breathed.

     ?men=old restores the cone, byte for byte, so the two can be photographed
     against each other. That is what the before/after pair is FOR. */
  const MEN_CAP = 980;
  const RIG_POOL = 48;          // see above: battle.js's own measured budget
  const NEAR_IN = 150;          // m from the camera — acquire a rig
  const NEAR_OUT = 178;         // m — release it. The gap is the hysteresis.
  const RIG_BUILD_PER_FRAME = 1;  // one cast() is 19 ms; two is a hitch
  const RIG_DRESS_PER_FRAME = 4;  // one dress() is 0.5 ms
  const FACE_LOD = 26;          // m: past this the four face meshes go. They
                                // are 4 of the rig's 25.1 draw calls and they
                                // are sub-pixel at 26 m.
  const ANIM_EVERY_1 = 45, ANIM_EVERY_2 = 95;   // gait update rate by range
  /* RENDER HEIGHT IS ONLY VALID TO 400 m — desert.js says so at the top of
     renderHeightAt, and past it the ground is drawn by a coarser ring with a
     bias this function does not model. Inside it, use it for everybody so the
     rigs and the impostors stand on one surface; outside it, the analytic
     height, where a man is four pixels and nobody can see the difference. */
  const DRAWN_GROUND_R2 = 400 * 400;

  /* THE SIZE LIE MOVED FROM THE CAMERA TO THE MAN, and that is a correctness
     fix, not a tweak. Men are drawn bigger than life as the view pulls back —
     Total War and Bannerlord both do it — because a life-sized man at 520 m
     is under two pixels and the strategic view is the whole game. The old
     rule scaled every man by the CAMERA's pull-back, which meant that at
     camDist 150 your column stood 58% taller than YOU did, one metre in front
     of you, at the exact range the new near band puts real bodies there. Same
     rig, two sizes, side by side. Scaling by each man's own distance from the
     camera instead makes the lie fade in where it is needed and stay out of
     the near band entirely, and — the reason it matters here — it gives the
     rig and the impostor the SAME number at the swap boundary. The player
     goes through it too, so he grows with his men rather than shrinking into
     them. */
  const LIE_NEAR = 60, LIE_FAR = 520, LIE_MAX = 3.2;
  function manScale(d) {
    if (FLAG_MEN_OLD) return 1 + clamp((camDist - 16) / (520 - 16), 0, 1) * 2.2;
    return 1 + (LIE_MAX - 1) * clamp((d - LIE_NEAR) / (LIE_FAR - LIE_NEAR), 0, 1);
  }

  /* r128 NEEDS BOTH HALVES OF THE COLOUR PATH, and finding that out cost a
     screenshot of an army rendered in solid black. `setColorAt` fills
     `instanceColor` and the vertex shader multiplies it into `vColor`, but
     in this revision the varying is only DECLARED (and the fragment stage
     only reads it) under USE_COLOR — which comes from
     `material.vertexColors`, not from the instance attribute. So an
     InstancedMesh with per-instance colours and vertexColors:false gets a
     broken colour path and paints black. Turning vertexColors on alone is
     the other half of the same trap: USE_COLOR with no `color` attribute on
     the geometry reads an unbound attribute, which is (0,0,0). Both, then:
     a constant white vertex colour on the geometry so USE_COLOR is real,
     and instanceColor multiplied over it. */
  /* AND THE BUFFER HAS TO BE ALLOCATED BY HAND. r128's setColorAt sizes the
     new instanceColor off `this.count`, not off the instance CAPACITY — and
     these meshes are constructed with count = 0 because nothing is drawn on
     frame one. So the very first setColorAt allocated a Float32Array of
     length ZERO, every write fell on the floor, and the army rendered black.
     Read back off the live page: instanceColor.array.length === 0. */
  function colourable(mesh, cap) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }

  function whiteColors(geo) {
    const n = geo.attributes.position.count;
    const a = new Float32Array(n * 3);
    a.fill(1);
    geo.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return geo;
  }

  /* MERGE THE IMPOSTOR INTO ONE BUFFER, because the draw-call argument the
     cone was built on is still the right argument at range — a nine-box man
     drawn as nine InstancedMeshes would be nine draw calls for the same
     picture. One geometry, one InstancedMesh, and the per-box shade rides in
     the geometry's own `color` attribute where it is MULTIPLIED by the
     instance colour: tint 0.30 on the boots makes them dark whatever uniform
     the man is wearing, 0.80 on the legs makes trousers a shade off the
     shirt. That is a free second tone per man on a path that only carries
     one. r128's BufferGeometryUtils is not loaded on this page and there is
     no reason to load it for twenty lines. */
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
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
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

  /* THE IMPOSTOR IS CUT FROM THE RIG'S OWN TABLE. CBZ.charProfile() is the
     one place a body's proportions live (entities/character.js), and
     CBZ.HUMAN_SCALE is what the rig is drawn at. Reading them here rather
     than typing eleven box sizes is the only version of this that cannot drift:
     change the body and the impostor follows it in the same commit. The
     fallback numbers are the shipped adult male, kept so a page without the
     people pack still fields a man-shaped speck instead of throwing.

     ORIGIN AT THE FEET, unlike the cone, whose body and head instances each
     carried their own hand-typed height offset. Feet-at-zero means the
     impostor takes the SAME matrix the rig gets from sand.plant, and the two
     forms cannot disagree about where the ground is. */
  const PROFILE_FALLBACK = {
    legUp: 0.48, legLo: 0.47, legW: 0.34, hipX: 0.23, shoeH: 0.20,
    armUp: 0.46, armLo: 0.46, armW: 0.30, armX: 0.62,
    pelvisW: 0.84, pelvisH: 0.20, pelvisD: 0.48,
    torsoW: 0.92, torsoH: 0.95, torsoD: 0.50,
    collarW: 0.94, collarH: 0.18, collarD: 0.52, headSize: 0.60,
  };
  function impostorGeometry() {
    let P = null;
    try { P = CBZ.charProfile ? CBZ.charProfile() : null; } catch (e) { P = null; }
    if (!P || !P.torsoH) P = PROFILE_FALLBACK;
    const HS = (CBZ.HUMAN_SCALE > 0) ? CBZ.HUMAN_SCALE : 0.70;
    const hipY = P.legUp + P.legLo;
    const neckY = hipY - 0.005 + P.torsoH - 0.015;
    const shoulderY = neckY - 0.04;
    const armL = P.armUp + P.armLo;
    const legH = hipY - P.shoeH;
    /* THE GAP BETWEEN THE LEGS IS THE WHOLE READ. hipX 0.23 with legW 0.34
       leaves 0.12 of daylight up the middle, and that slot is the single
       feature that separates "a man" from "a bollard" at 60 m — more than the
       arms, which foreshorten to nothing head-on. It is the rig's own number;
       do not close it up to save two triangles.

       THE TROUSERS ARE THEIR OWN MESH BECAUSE THEY ARE THEIR OWN COLOUR, and
       the swap strip is what proved it. A fit's `legs` hex is frequently
       nothing like its `torso` — khaki shirt over black trousers is half this
       catalogue — so shading the torso colour down for the legs gave every
       impostor tan trousers beside a rig wearing dark ones, on a part of the
       silhouette that is a third of the man. One more instanced mesh for every
       man on the island; still four draw calls where a single rig is
       twenty-five. */
    const legs = mergeBoxes([
      // boots: dark ALWAYS. outfits.js's own rule — the one tone that never
      // reads as sand — and here it doubles as the thing that stops the legs
      // dissolving into the ground they are standing on. A shade of the
      // trousers rather than the fit's own boot hex, because a fifth mesh to
      // carry one more colour across two boxes eleven centimetres tall is not
      // a trade worth making.
      { w: P.legW * 1.02, h: P.shoeH, d: P.legW * 1.45, x: -P.hipX, y: P.shoeH / 2, z: 0.05, tint: 0.34 },
      { w: P.legW * 1.02, h: P.shoeH, d: P.legW * 1.45, x: P.hipX, y: P.shoeH / 2, z: 0.05, tint: 0.34 },
      { w: P.legW, h: legH, d: P.legW, x: -P.hipX, y: P.shoeH + legH / 2, tint: 1 },
      { w: P.legW, h: legH, d: P.legW, x: P.hipX, y: P.shoeH + legH / 2, tint: 1 },
      { w: P.pelvisW, h: P.pelvisH, d: P.pelvisD, y: hipY + 0.03, tint: 1 },
    ], HS);
    const body = mergeBoxes([
      { w: P.torsoW, h: P.torsoH, d: P.torsoD, y: hipY - 0.005 + P.torsoH / 2, tint: 1 },
      { w: P.collarW, h: P.collarH, d: P.collarD, y: shoulderY, tint: 1 },
      /* THE ARMS ARE DARKER THAN THE SHIRT ON PURPOSE. Geometrically they are
         the rig's own boxes, but flat-shaded at the rig's exact tone the
         torso and both arms merge into one wide rectangle and the man reads
         a head wider than he is. On the rig the sleeves sit in their own
         fold shadow; 0.88 is that shadow, and it is what puts a waist back
         into the silhouette. */
      { w: P.armW, h: armL, d: P.armW, x: -P.armX, y: shoulderY - armL / 2, tint: 0.88 },
      { w: P.armW, h: armL, d: P.armW, x: P.armX, y: shoulderY - armL / 2, tint: 0.88 },
    ], HS);
    /* THE HEAD IS TWO MESHES BECAUSE IT IS TWO COLOURS, and getting that
       wrong was the first thing the swap-boundary pair showed. marks() answers
       ONE head hex and it is the HAT when the man has one, so painting the
       whole head with it gave every impostor a solid pale-blue block for a
       skull — a lego head — beside rigs whose heads read as a small dark cap
       over a tan face. Same silhouette, completely different creature.
       So: a FACE cube on a constant dusty skin (no per-instance colour at all;
       skin at 165 m is one colour for everybody) and a CAP slab carrying the
       hat hex. It costs one draw call for every man on the island and it is
       the difference between a man and a bollard with a light on it. For a
       bare-headed man marks() already answers skin, so the slab just becomes
       the top of his head and nothing special-cases it.

       THE CAP SLAB IS WHAT MAKES THE HEIGHTS AGREE. The rig measures 1.862 m
       to the top of its cap (read off a live Box3) and a bare head box tops
       out at 1.736; the slab spans exactly that gap, so a man is the same
       height in both forms and the swap has nothing vertical in it. */
    const face = mergeBoxes([
      { w: P.headSize, h: P.headSize, d: P.headSize, y: neckY + P.headSize / 2, tint: 1 },
    ], HS);
    const cap = mergeBoxes([
      { w: P.headSize * 1.08, h: 0.18, d: P.headSize * 1.08, y: neckY + P.headSize + 0.09, tint: 1 },
    ], HS);
    return { body: body, legs: legs, face: face, cap: cap };
  }

  /* THE MEAN OF studio.js's OWN SKIN TABLE. CASTING picks a rig's tone out of
     six (0xc9a07a 0x8d5a3b 0x6b4228 0xe0b894 0x4a2f1e 0xa87551) off the
     variant index, and the pool spreads its forty-eight bodies across all of
     them. At the range an impostor is drawn, one face is four pixels; the
     honest single answer is the average of what the rigs beside it actually
     are, not the lightest of the six, which is what outfits.js's bare-head
     branch happens to use. Channel means of that table, rounded. */
  /* AND THIS ONE IS DELIBERATELY *NOT* CONVERTED. Every cloth colour on an
     impostor goes through toLinear because outfits.js converts the same hexes
     before they reach a rig's material — but outfits.js states, and means, that
     it leaves SKIN AND HAIR alone: entities/character.js owns those and sets
     them raw. So the rig's face renders from an unconverted sRGB hex, and an
     impostor face that WAS converted came back a shade of dark brown standing
     next to rigs with tan faces. Match what is actually on the rig, not what
     the theory says should be. */
  const IMPOSTOR_SKIN = 0x996f50;

  function buildMen() {
    let bodyG, faceG, capG = null, legsG = null;
    if (FLAG_MEN_OLD) {
      // the cone, for the A/B. This is what the owner was looking at.
      bodyG = whiteColors(new THREE.CylinderGeometry(0.26, 0.38, 1.30, 6));
      faceG = whiteColors(new THREE.BoxGeometry(0.34, 0.34, 0.34));
    } else {
      const g = impostorGeometry();
      bodyG = g.body; legsG = g.legs; faceG = g.face; capG = g.cap;
    }
    const bodyM = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    menBody = new THREE.InstancedMesh(bodyG, bodyM, MEN_CAP);
    menBody.castShadow = true;
    menBody.frustumCulled = false;
    menBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    colourable(menBody, MEN_CAP);
    menBody.count = 0;
    root.add(menBody);

    if (legsG) {
      menLegs = new THREE.InstancedMesh(legsG,
        new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), MEN_CAP);
      menLegs.castShadow = true;
      menLegs.frustumCulled = false;
      menLegs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      colourable(menLegs, MEN_CAP);
      menLegs.count = 0;
      root.add(menLegs);
    }

    /* THE FACE NEEDS NO PER-INSTANCE COLOUR AT ALL, which is why it is worth
       having as its own mesh: one flat material, no instanceColor buffer, no
       vertexColors, no r128 USE_COLOR trap to fall into. In the cone revert
       this mesh IS the old head box and it keeps the old colour path. */
    menHead = new THREE.InstancedMesh(faceG,
      FLAG_MEN_OLD ? new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true })
                   : new THREE.MeshLambertMaterial({ color: IMPOSTOR_SKIN }), MEN_CAP);
    menHead.frustumCulled = false;
    menHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (FLAG_MEN_OLD) colourable(menHead, MEN_CAP);
    menHead.count = 0;
    root.add(menHead);

    if (capG) {
      menCap = new THREE.InstancedMesh(capG,
        new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), MEN_CAP);
      menCap.frustumCulled = false;
      menCap.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      colourable(menCap, MEN_CAP);
      menCap.count = 0;
      root.add(menCap);
    }

    /* THE BANNER IS THE MAP MARKER, and it is a real object in the world so
       it obeys the terrain and the fog like everything else. Its height and
       its flag scale with log2(party size): six men and two hundred men have
       to be TELLABLE APART at strategic zoom or the whole "should I go near
       that" decision has no information in it. Log, not linear, because a
       linear pole for 300 men is 120 m tall and looks like a bug. */
    const poleG = new THREE.CylinderGeometry(0.13, 0.13, 1, 5);
    const flagG = whiteColors(new THREE.BoxGeometry(1, 0.62, 0.12));
    flagG.translate(0.5, 0, 0);
    pole = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: 0x3b3128 }), 160);
    banner = new THREE.InstancedMesh(flagG, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), 160);
    pole.frustumCulled = banner.frustumCulled = false;
    pole.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    banner.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    colourable(banner, 160);
    pole.count = banner.count = 0;
    root.add(pole); root.add(banner);
  }

  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p3 = new THREE.Vector3();
  const _s3 = new THREE.Vector3();
  const _col = new THREE.Color();
  function inst(mesh, n, x, y, z, yaw, sx, sy, sz, colour) {
    if (n >= mesh.instanceMatrix.count) return n;
    _e.set(0, yaw, 0); _q.setFromEuler(_e);
    _p3.set(x, y, z); _s3.set(sx, sy, sz);
    _m4.compose(_p3, _q, _s3);
    mesh.setMatrixAt(n, _m4);
    if (colour != null && mesh.setColorAt) { _col.setHex(colour); mesh.setColorAt(n, _col); }
    return n + 1;
  }

  /* ============================================================ MARKER
     A SCUFF IN THE SAND, NOT A BEACON.

     This used to be a pulsing orange ring under a twenty-six metre beam with
     depthTest off, so it shone THROUGH dunes and mesas and sat on screen for
     the whole ride. The owner's word for it was "dumb" and he is right: it is
     a strategy-game cursor standing in the middle of a desert nobody else in
     the world can see. Nothing in this game should be a floating UI object in
     the world — a warlord pointing at a horizon does not plant a light there.

     So the tap leaves what a tap would actually leave: a scuff of disturbed
     sand where you pointed, which puffs once and is gone inside a second. It
     confirms the input landed — the only job the marker ever really had —
     and then it stops existing. depthTest is ON now, so a dune in front of it
     hides it, the way a dune does.

     Where you are actually going is answered by the man turning and riding,
     which is information the world already carries. ?marker=beacon restores
     the old ring and beam for anyone who wants to compare. */
  const MARKER_OLD = QP.get("marker") === "beacon";
  function buildMarker() {
    const g = new THREE.Group();
    if (MARKER_OLD) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.4, 3.4, 24),
        new THREE.MeshBasicMaterial({ color: 0xffb15a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 900;
      g.add(ring);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 26, 6, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffb15a, transparent: true, opacity: 0.30, depthTest: false, side: THREE.DoubleSide }));
      beam.position.y = 13;
      beam.renderOrder = 899;
      g.add(beam);
    } else {
      /* Two flat discs of kicked sand, offset and counter-rotating as they
         fade, so the puff has some life in it without being a particle
         system. Sand colour, not UI orange — it is dirt, not a waypoint. */
      for (let i = 0; i < 2; i++) {
        const d = new THREE.Mesh(
          new THREE.CircleGeometry(1.5 + i * 0.9, 14),
          new THREE.MeshBasicMaterial({ color: i ? 0xbfa274 : 0xd8c49a, transparent: true, opacity: 0.5 }));
        d.rotation.x = -Math.PI / 2;
        d.position.y = 0.02 + i * 0.01;
        g.add(d);
      }
    }
    g.visible = false;
    marker = g;
    root.add(g);
  }

  /* ============================================================ OUTPOSTS
     WHAT WAS HERE WAS FIVE BoxGeometry HUTS ON A HASHED RING, A CYLINDER
     MAST AND A FLAG, and a comment calling that deliberate: "an outpost's
     SCREEN is outpost.js's job and this is the thing you ride at, which
     needs to be recognisable from a kilometre and nothing more." The owner
     rode at one and photographed what that actually is — two featureless
     slabs half sunk in the sand, no person, no stall, no building, and in
     his light both of them black — and then the trading screen opened over
     the top of it. Both halves of that picture are bugs in this function.

       THE COLOUR. props.js's header does the arithmetic with a calculator
       and three photographs: this page runs outputEncoding = sRGBEncoding
       with ACES over it, so a hex typed into a material is STORED linear and
       encoded on the way out, and desert.js's sand lands at 0xE8-0xF1 on
       screen. The huts were painted 0xbaa07a as though a hex meant what a
       person means by it, which through that chain is blank white paper.
       Photographed both ways in the before/after pair and in the owner's own
       screenshot: a sunlit face comes out very slightly paler than the sand
       behind it and vanishes into it, and a face in its own shade drops to
       hemisphere ambient and comes out as the black slab he sent. Same bug;
       which half you get depends on where the sun is. Every colour at an
       outpost now comes out of props.js's own linear table instead.

       THE SINK. The huts were seated on `heightAt`, the ANALYTIC surface,
       and drawn against the clipmap, which draws `renderHeightAt`.
       desert.js states the gap in metres: 9.9 cm on gentle ground and
       17.3 cm on a flank. It is the same bug that used to bury the men.

     AND THE FIND THAT MADE THIS A DELETION RATHER THAN A REWRITE: props.js
     HAS SHIPPED A FINISHED DEPOT, CAMP, WELL AND MARKET THIS WHOLE TIME —
     near geometry, a far silhouette, colliders, LOD, batched to about a
     dozen draw calls apiece — AND NOTHING HAS EVER CALLED IT. `grep -rn
     "props.outpost" src/` returned exactly one hit and it was the doc
     comment at the top of props.js. desert.js's NO SCATTER note even says
     "outpost and camp props — props.js places those AT places, on purpose",
     which was true of the intention and false of the code. So this function
     builds no geometry at all now. It picks the ground, asks props.js for
     the place, and stands it up. */

  let outpostRoot = null, outpostsRaised = false;
  const outpostGroups = [];        // the props group per outpost, by index
  const raiseQ = [];               // outposts still waiting to be built

  function buildOutpostProps() {
    outpostRoot = new THREE.Group();
    root.add(outpostRoot);
  }

  /* ============================================================ THE PAD
     A COMPOUND IS A FLOOR, AND A FLOOR NEEDS SOMEWHERE LEVEL TO STAND ON.

     props.js refuses to lay a hardstand under an outpost and says why: "on
     desert.js's dunes a 36 m disc floats a metre on one side and buries
     itself on the other". That is the right call, and it hands this file the
     other half of the job — if props.js will not flatten the ground, the
     ground has to be flat before the props arrive.

     placeOutposts() already asks for slope under 0.22-0.24 AT THE POINT,
     which is not the same question: 0.22 sustained across a 20 m compound is
     4.4 m of rise, and the depot's container row is 12 m long. So the spot
     it chose becomes the CENTRE OF A SEARCH rather than the answer. Sixty
     candidates on a golden-angle spiral out to 180 m, each scored on the
     peak-to-peak relief of a 13-point pad around it, with a small bias
     against moving — the landmark reason this outpost is at this oasis or on
     this landing survives a 100 m nudge and does not survive being somewhere
     else entirely.

     Cost: 60 x 13 heightAt per outpost, nine outposts, about 7 000 calls at
     desert.js's own measured 0.36 us — 2.5 ms, once, at world build.

     AND THE SEAT IS THE DRAWN SURFACE, NOT THE ANALYTIC ONE. renderHeightAt
     reproduces exactly what the clipmap's finest ring draws and is
     camera-independent by construction (desert.js: "the snap cancels and
     this needs no camera state"), so it is the right answer here even for an
     outpost 6 km away — by the time its near geometry is visible at all you
     are inside the 420 m where that ring is what is under it. Averaged over
     the pad rather than sampled at the centre: a rigid compound sits on the
     mean of the ground it covers, and a centre sample buries the uphill
     half. */
  const PAD_R = 20;                 // the compound's own footprint
  const GOLD = 2.399963229728653;   // golden angle — a spiral with no axis bias

  /* THE FLATTEST GROUND AT AN OASIS IS THE BOTTOM OF THE POND, and that cost
     a whole before/after run to find out. The first version of this search
     scored candidates on relief alone and reported a triumph — the well's
     ground went from 4.50 m peak-to-peak to 0.00 — and the photograph was a
     compound standing in six feet of water with the camera submerged, palms
     coming out of a lake and the shade sail floating on it. A pond floor IS
     perfectly level. desert.js's own palm placer already knows this and
     skips anything below `o.waterY + 0.2`; landPoint does not, because
     onLand() answers about the SEA and an oasis is a bowl dug into the land.

     0.8 m of freeboard rather than 0.2: a palm only has to have its trunk
     out of the water, a compound has men standing in it and a wall of
     containers, and the waterline moves nowhere near enough to justify
     splitting hairs. */
  function wet(x, z, y) {
    const D = W.desert;
    const list = D.oases || [];
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const dx = x - o.x, dz = z - o.z;
      if (dx * dx + dz * dz > o.r * o.r) continue;
      if (y < o.waterY + 0.8) return true;
    }
    return false;
  }

  function padAt(x, z) {
    const D = W.desert;
    let lo = 1e9, hi = -1e9, sum = 0, soaked = false;
    const N = 13;
    for (let i = 0; i < N; i++) {
      const a = i * GOLD;
      const rr = Math.sqrt((i + 0.35) / N) * PAD_R;
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      const y = D.heightAt(px, pz);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
      // ANY of the thirteen, not the centre: a compound with one corner in
      // the water is still a compound in the water.
      if (!soaked && (!D.onLand(px, pz) || wet(px, pz, y))) soaked = true;
      sum += (D.renderHeightAt ? D.renderHeightAt(px, pz) : y);
    }
    return { relief: hi - lo, y: sum / N, wet: soaked };
  }
  /* AND THE SEARCH IS BOUNDED IN Z AS WELL AS IN X, WHICH THE FIRST PASS WAS
     NOT — it moved two outposts onto mesa tops. The mesa law quantises
     plateau heights, so a mesa roof is EXACTLY flat and scores zero relief;
     a 130 m candidate on one therefore beat a beach with 0.8 m of swell by
     the margin of the distance bias. The audit came back with a recruit camp
     and an ARMS DEPOT both sitting at y = 70.00, and a depot is where the
     boats land. Flat is not the only thing an outpost has to be. A compound
     levels the ground it stands on; it does not climb a cliff to find better
     ground, so a candidate more than 3 m off the height it was placed at is
     not a candidate. */
  const PAD_CLIMB = 3.0;
  function levelPad(o) {
    const D = W.desert;
    const y0 = D.heightAt(o.x, o.z);
    let best = null;
    for (let i = 0; i < 60; i++) {
      const a = i * GOLD;
      const rr = Math.sqrt(i / 60) * 180;      // i === 0 is the spot as placed
      const x = o.x + Math.cos(a) * rr, z = o.z + Math.sin(a) * rr;
      if (!D.onLand(x, z)) continue;
      const p = padAt(x, z);
      if (p.wet) continue;                      // see wet(): a pond floor is level
      if (Math.abs(p.y - y0) > PAD_CLIMB) continue;
      /* 4 mm of relief per metre moved. At that rate the full 180 m walk has
         to buy three quarters of a metre of levelling to be worth taking,
         which is about where the difference stops being visible under a
         compound this size anyway. */
      const score = p.relief + rr * 0.004;
      if (!best || score < best.score) best = { x: x, z: z, y: p.y, relief: p.relief, score: score };
    }
    return best;
  }

  function raiseOutposts() {
    // drop everything the last island left standing, colliders included
    for (let i = 0; i < outpostGroups.length; i++) {
      const g = outpostGroups[i];
      if (!g) continue;
      if (W.props) { W.props.unplace(g); W.props.forget(g); }
      if (g.parent) g.parent.remove(g);
      /* AND THE MERGED GEOMETRY GOES WITH IT. core/batch.js welds each
         outpost's inert meshes into a handful of NEW BufferGeometries that
         nothing else references, so leaving them behind leaks a compound's
         worth of vertex buffers per new game. The shared caches (boxGeom,
         props.js's cylinder table, its instanced pieces) tag themselves
         `_shared` precisely so a sweep like this can tell them apart. */
      g.traverse(function (o) {
        if (o.isMesh && o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
      });
    }
    outpostGroups.length = 0;
    raiseQ.length = 0;
    if (micro.rebuildColliderGrid) micro.rebuildColliderGrid();
    for (let i = 0; i < S.outposts.length; i++) raiseQ.push(i);
    /* NEAREST FIRST, AND ONE PER FRAME AFTER THE FIRST. A depot is a crane,
       six containers, twenty crates, a sandbag run, a stall and two houses;
       nine of those in one frame is a stall you can see. The rig pool next
       door already works to the same rule and says why. The nearest one is
       built immediately, because a game that opens beside an outpost must
       not open beside an empty patch of sand. */
    raiseQ.sort(function (a, b) { return dist2(S.outposts[a]) - dist2(S.outposts[b]); });
    pumpOutposts(1);
  }
  function dist2(o) {
    const dx = o.x - S.you.x, dz = o.z - S.you.z;
    return dx * dx + dz * dz;
  }

  function pumpOutposts(n) {
    if (!W.props || !W.props.outpost) return;
    for (let k = 0; k < (n || 1) && raiseQ.length; k++) raiseOne(raiseQ.shift());
  }

  function raiseOne(i) {
    const o = S.outposts[i];
    if (!o) return;
    /* LEVEL ONCE AND REMEMBER IT. A save reloads an outpost that has already
       been moved, and re-running the search from there would find the same
       pad — it is already the flattest thing within 130 m and the bias
       rewards standing still — but "would" is not "does", and a landmark
       that creeps a metre per load drifts off its own oasis over a long
       campaign. */
    if (!o.pad) {
      const p = levelPad(o);
      if (p) {
        o.x = p.x; o.z = p.z; o.y = p.y;
        o.relief = Math.round(p.relief * 100) / 100;
      } else {
        o.y = W.desert.renderHeightAt ? W.desert.renderHeightAt(o.x, o.z) : W.desert.heightAt(o.x, o.z);
      }
      o.pad = 1;
      o.yaw = W.hash01(o.x, o.z, 97) * TAU;
    }
    /* outpost.js's four kinds are props.js's four kinds by construction —
       the KINDS table and the four build functions were written against each
       other. A fallback outpost, from a page where outpost.js failed to
       load, carries this file's own "town", which is a well at an oasis and
       a depot on a landing: the same mapping makeOutpost() already uses. */
    const kind = o.kind === "town" ? (o.at ? "well" : "depot") : o.kind;
    /* AND THE COMPOUND IS TOLD WHERE ITS OWN GROUND IS. props.js seats every
       free-standing thing it builds — huts, tents, palms, the stall, the
       fires, the drums — on whatever this function answers, and leaves the
       genuinely rigid things (the container row, the gantry that straddles
       it, a 22 m sandbag wall, the oasis bowl) sunk into the sand where the
       terrain can cut them. It has to be a function handed in rather than a
       heightfield read out, because props.js must not know what desert.js
       is, and it has to be called at BUILD time because core/batch.js welds
       the inert meshes together before the group is handed back — a hut
       re-seated afterwards would be an empty group moving away from its own
       baked geometry.

       renderHeightAt, not heightAt: this is the surface that is DRAWN, the
       same one sand.plant stands the men on, so the trader's boots and the
       floor of the hut behind him agree. */
    const D = W.desert;
    const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
    const groundAt = function (lx, lz) {
      const wx = o.x + lx * cy + lz * sy;
      const wz = o.z - lx * sy + lz * cy;
      return (D.renderHeightAt ? D.renderHeightAt(wx, wz) : D.heightAt(wx, wz)) - o.y;
    };
    let g = null;
    try {
      g = W.props.outpost(kind, {
        seed: Math.floor(Math.abs(o.x) * 7 + Math.abs(o.z) * 13) + i * 101,
        colour: o.colour,
        groundAt: groundAt,
      });
    } catch (e) {
      console.error("[warlord] outpost props", e);
      return;
    }
    if (!g) return;
    outpostRoot.add(g);
    W.props.place(g, o.x, o.y, o.z, o.yaw);
    outpostGroups[i] = g;
  }

  /* ============================================================ THE PEOPLE
     "A MAN WITH A CRATE POPUP WITH NO MAN THERE."

     props.js publishes `userData.folk` on every outpost it builds: where the
     people stand, in the compound's own local metres, with a facing and a
     role. It deliberately does not draw one, and neither does this function
     — everything below hands them to `pushMan`, which is the same queue the
     player's column and every warband on the island go through. That means
     the trader gets a real CBZ.studio.cast rig dressed by W.outfits, seated
     on the drawn sand by W.sand.plant and breathing on CBZ.animChar the
     moment the 48-slot pool has room and the camera is inside 150 m, and an
     instanced impostor at every range past that, with the same hysteresis,
     the same size lie and the same colours as everybody else. A second way
     to put a body on this island is exactly the drift CONTRACT.md exists to
     stop, and it is what a hand-rolled "shopkeeper rig" here would have been.

     THEY STAND STILL, WHICH IS THE POINT. spd 0 means animChar's `moving`
     is false, so the rig breathes and settles instead of walking on the
     spot, and the old failure — a T-pose — cannot happen because an
     undressed slot is never shown at all.

     ROLE PICKS THE TIER, so the man behind the counter is not dressed as a
     levy. It is the only thing role does; outfits.js does the rest off the
     same record a soldier carries in a battle. */
  const FOLK_DRAW = 900;            // past this an outpost is a silhouette
  const FOLK_TIER = { trader: "veteran", guard: "soldier", hand: "levy", idler: "raider" };
  const FOLK_GUN = { trader: "revolver", guard: "ak47", hand: "sidearm", idler: "carbine" };
  const folkMen = Object.create(null);
  function folkMan(o, k, role) {
    const key = o.id + ":" + k;
    let s = folkMen[key];
    if (s) return s;
    /* A REAL W.makeSoldier RECORD, NOT A {id, tier} STUB, and the difference
       is whether the man gets a body at all. W.outfits.dress() reads wid,
       armour and hp off the record the way it does for a man in a battle;
       handed a stub it throws, assignRigs catches, `ok` stays false and the
       slot is claimed and never shown — so the trader would have burned a
       rig slot and still drawn as a four-box impostor at two metres. Found
       by asking why rigsAtPost was zero in a shot taken from six metres.

       THE ID IS HASHED, NOT DRAWN. W.nextId() is a counter, so minting these
       lazily at draw time would give the same man a different id depending on
       how far you had ridden before you first looked at him — which desyncs
       two peers watching one island and makes a before/after pair disagree
       about a variant. Display-only, and never entering W.state, is exactly
       the contract peerMan() next door already states. */
    let h = 0;
    for (let n = 0; n < key.length; n++) h = (h * 131 + key.charCodeAt(n)) | 0;
    const id = 700000 + (Math.abs(h) % 90000);
    const tier = FOLK_TIER[role] || "levy";
    s = W.makeSoldier ? W.makeSoldier(tier, FOLK_GUN[role] || "sidearm", { id: id })
                      : { id: id, tier: tier, wid: "sidearm", armour: "none", hp: 10, maxHp: 10 };
    folkMen[key] = s;
    return s;
  }

  function drawFolk() {
    if (FLAG_NOFOLK) return 0;
    let drawn = 0;
    const cam = camera.position;
    for (let i = 0; i < S.outposts.length && menDrawN < MEN_CAP - 16; i++) {
      const g = outpostGroups[i];
      if (!g) continue;
      const list = g.userData.folk;
      if (!list || !list.length) continue;
      const o = S.outposts[i];
      const dx0 = o.x - S.you.x, dz0 = o.z - S.you.z;
      if (dx0 * dx0 + dz0 * dz0 > FOLK_DRAW * FOLK_DRAW) continue;
      /* THE COMPOUND'S OWN ROTATION, and it has to be props.place's, not a
         second opinion about it. A child at local (lx, lz) under a group
         with rotation.y = yaw sits at (lx cos + lz sin, -lx sin + lz cos) —
         the same two lines place() uses to put that compound's colliders in
         the world, so a man at the counter anchor is at the counter and not
         beside it. */
      const yaw = g.rotation.y, cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let k = 0; k < list.length && menDrawN < MEN_CAP; k++) {
        const f = list[k];
        const x = o.x + f.x * cy + f.z * sy;
        const z = o.z - f.x * sy + f.z * cy;
        const dx = x - cam.x, dz = z - cam.z, d2 = dx * dx + dz * dz;
        const ms = manScale(Math.sqrt(d2));
        /* A MAN STANDING AT A STALL IS NOT MARCHING, so the only motion he
           carries is the breath the rig gives him and a slower sway than a
           man on the road. The hash keeps two men at the same fire off the
           same beat, which is what a rank of identical bobbing does look
           like when they share one. */
        const bob = Math.sin(micro.elapsed * 1.9 + W.hash01(k, i, 311) * TAU) * 0.03;
        const s = folkMan(o, k, f.role);
        pushMan("f" + o.id + ":" + k, x, z, manGroundY(x, z, d2), yaw + f.yaw, bob, ms,
                markOf(s, null), s, null, 0);
        drawn++;
      }
    }
    return drawn;
  }

  /* ============================================================ THE HUD
     Only the pieces this file owns: the compass, the nameplates, the map
     button and the world map. The top strip belongs to the shell. */
  function buildHud() {
    const d = document.createElement("div");
    d.id = "wlCampHud";
    d.style.cssText = "position:fixed;inset:0;z-index:45;pointer-events:none;";
    d.innerHTML =
      '<style>' +
      '#wlCampHud .plate{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;' +
        'font:700 11px/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:.12em;' +
        'padding:3px 8px;border-radius:8px;background:rgba(12,9,5,.72);border:1px solid rgba(255,255,255,.16);' +
        'color:#f4ecd8;text-shadow:0 1px 2px #000}' +
      '#wlCampHud .plate i{font-style:normal;opacity:.65;margin-left:7px}' +
      '#wlCampHud .plate.hunt{border-color:#c4453a;color:#ffc9c4}' +
      '#wlCampHud .plate.flee{border-color:#5aa86a;color:#c9ffd4}' +
      '#wlCampHud .plate.op{border-color:#ffb15a;color:#ffd7bd}' +
      '#wlCampHud .plate.peer{border-color:#7fa8c8;color:#d8ecff}' +
      '#wlCompass{position:absolute;left:50%;transform:translateX(-50%);' +
        'bottom:calc(var(--wl-safe-b, env(safe-area-inset-bottom,0px)) + 14px);opacity:.9}' +
      '#wlMapBtn{position:absolute;right:calc(var(--wl-safe-r, env(safe-area-inset-right,0px)) + 14px);' +
        'top:calc(var(--wl-safe-t, env(safe-area-inset-top,0px)) + 52px);pointer-events:auto;cursor:pointer;' +
        'appearance:none;border:1px solid rgba(255,255,255,.2);border-radius:12px;' +
        'background:rgba(12,9,5,.62);color:#f4ecd8;padding:10px 13px;font:700 12px/1 ui-sans-serif,system-ui,sans-serif;' +
        'letter-spacing:.16em}' +
      '#wlZoom{position:absolute;right:calc(var(--wl-safe-r, env(safe-area-inset-right,0px)) + 14px);' +
        'top:calc(var(--wl-safe-t, env(safe-area-inset-top,0px)) + 100px);display:flex;flex-direction:column;gap:8px}' +
      '#wlZoom button{pointer-events:auto;cursor:pointer;width:42px;height:42px;border-radius:12px;' +
        'border:1px solid rgba(255,255,255,.2);background:rgba(12,9,5,.62);color:#f4ecd8;' +
        'font:700 18px/1 ui-sans-serif,system-ui,sans-serif}' +
      '#wlMap{position:fixed;inset:0;z-index:60;display:none;background:rgba(8,6,4,.93);' +
        'pointer-events:auto;align-items:center;justify-content:center;flex-direction:column;gap:12px}' +
      '#wlMap.on{display:flex}' +
      '#wlMap canvas{border:1px solid rgba(255,255,255,.18);border-radius:10px;' +
        'max-width:min(86vw,86vh);max-height:min(86vw,86vh);image-rendering:auto}' +
      '#wlMap .cap{font:700 11px/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.22em;opacity:.6;color:#f4ecd8}' +
      '</style>' +
      '<div id="wlPlates"></div>' +
      '<canvas id="wlCompass" width="460" height="36"></canvas>' +
      '<button id="wlMapBtn">MAP</button>' +
      '<div id="wlZoom"><button id="wlIn">+</button><button id="wlOut">&minus;</button></div>';
    document.body.appendChild(d);
    hudRoot = d;
    plateBox = d.querySelector("#wlPlates");
    compass = d.querySelector("#wlCompass");
    compassG = compass.getContext("2d");

    const mw = document.createElement("div");
    mw.id = "wlMap";
    mw.innerHTML = '<div class="cap">THE ISLAND — TAP TO CLOSE</div><canvas id="wlMapC"></canvas>' +
                   '<div class="cap" id="wlMapLeg"></div>';
    document.body.appendChild(mw);
    mapWrap = mw;
    mw.addEventListener("pointerdown", function () { mw.classList.remove("on"); });

    d.querySelector("#wlMapBtn").addEventListener("click", function (e) { e.stopPropagation(); toggleMap(); });
    d.querySelector("#wlIn").addEventListener("click", function () { camDistWant = clamp(camDistWant * 0.62, 16, 520); });
    d.querySelector("#wlOut").addEventListener("click", function () { camDistWant = clamp(camDistWant * 1.6, 16, 520); });

    window.addEventListener("keydown", function (e) {
      if (!live) return;
      if (e.code === "KeyM") toggleMap();
    });
  }

  /* THE OWNERSHIP MAP IS NOT MINE. territory.js owns regions, factions and
     who holds what, and two world maps on one island is exactly the kind of
     duplication this repo's rules exist to stop — so if it is loaded, the
     MAP button is its button and this file's own screen never opens. What
     stays here is the FALLBACK: a page booted without territory.js still has
     to be able to see where it is. Both draw the same W.desert.mapTexture;
     only the layer on top differs. */
  function toggleMap() {
    if (W.territory && W.territory.open) {
      try { W.territory.open({ x: S.you.x, z: S.you.z, dist: camDist }); return; }
      catch (e) { console.error("[warlord] territory.open", e); }
    }
    if (!mapWrap) return;
    const on = !mapWrap.classList.contains("on");
    mapWrap.classList.toggle("on", on);
    if (on) paintMap();
  }

  /* THE WORLD MAP IS THE REAL ISLAND, painted from the same heightAt and
     biomeAt everything else reads — so it cannot lie about where the salt
     pan is. Markers are drawn over it every time it is opened. */
  function paintMap() {
    const D = W.desert;
    const SZ = 512;
    const src = D.mapTexture(SZ);
    const cv = document.getElementById("wlMapC");
    if (!cv || !src) return;
    cv.width = cv.height = SZ;
    const g = cv.getContext("2d");
    g.drawImage(src, 0, 0);
    function P(x, z) { return D.mapProject(x, z, SZ); }
    // oases
    g.font = "700 9px ui-sans-serif,system-ui,sans-serif";
    for (let i = 0; i < D.oases.length; i++) {
      const o = D.oases[i], p = P(o.x, o.z);
      g.fillStyle = "#39d0a8"; g.beginPath(); g.arc(p.x, p.y, 3.4, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,255,255,.72)"; g.fillText(o.name, p.x + 6, p.y + 3);
    }
    for (let i = 0; i < S.outposts.length; i++) {
      const o = S.outposts[i], p = P(o.x, o.z);
      g.fillStyle = "#ffb15a";
      g.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
      g.fillStyle = "rgba(255,255,255,.85)"; g.fillText(o.name, p.x + 6, p.y + 3);
    }
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i], p = P(b.x, b.z);
      // RADIUS CARRIES THE SIZE on the map exactly as the banner does in the
      // world: six men and two hundred must not be the same dot.
      const r = 1.4 + Math.sqrt(W.bandSize(b)) * 0.42;
      g.fillStyle = "#" + ("000000" + (b.colour || 0xcccccc).toString(16)).slice(-6);
      g.globalAlpha = b.mood === "hunt" ? 1 : 0.8;
      g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
      g.globalAlpha = 1;
    }
    for (let i = 0; i < peerDraw.length; i++) {
      const q = peerDraw[i], pp = P(q.x, q.z);
      g.strokeStyle = "#" + ("000000" + (q.colour >>> 0).toString(16)).slice(-6);
      g.lineWidth = 2;
      g.beginPath(); g.arc(pp.x, pp.y, 2 + Math.sqrt(q.size) * 0.42, 0, TAU); g.stroke();
      g.fillStyle = "rgba(255,255,255,.85)"; g.fillText(q.name, pp.x + 6, pp.y + 3);
    }
    const me = P(S.you.x, S.you.z);
    g.strokeStyle = "#fff"; g.lineWidth = 2;
    g.beginPath(); g.arc(me.x, me.y, 6, 0, TAU); g.stroke();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(me.x, me.y, 2.6, 0, TAU); g.fill();
    const leg = document.getElementById("wlMapLeg");
    if (leg) leg.textContent = S.bands.length + " PARTIES · " + S.outposts.length + " OUTPOSTS · " +
      D.oases.length + " OASES · DAY " + S.day;
  }

  /* ============================================================ THE COMPASS
     A ribbon, not a rose: a rose tells you which way north is, which in a
     desert with no roads is worth nothing. This tells you where the nearest
     WATER and the nearest MARKET are, which is the only navigation question
     the game actually asks. */
  function paintCompass() {
    if (!compassG) return;
    const g = compassG, w = compass.width;
    g.clearRect(0, 0, w, compass.height);
    g.fillStyle = "rgba(12,9,5,.42)";
    g.fillRect(0, 0, w, compass.height);
    const yaw = camYaw;
    const span = 2.4;                     // radians of heading shown across the ribbon
    function px(a) {
      let d = a - yaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      return w / 2 + (d / span) * w;
    }
    /* TWO ROWS, and it is not decoration: the first draft drew the cardinals
       and both waypoints on ONE baseline and the readout said "WADUST GATE"
       — two labels straight through each other. Cardinals get the top row,
       waypoints the bottom, and a waypoint that would overlap the one
       already drawn is dropped rather than smeared over it. */
    const used = [];
    function tick(a, label, colour, row) {
      const x = px(a);
      if (x < -40 || x > w + 40) return;
      const yTick = row ? 18 : 8, yText = row ? 30 : 15;
      g.strokeStyle = colour; g.lineWidth = row ? 1 : 2;
      g.beginPath(); g.moveTo(x, yTick); g.lineTo(x, yTick + (row ? 5 : 6)); g.stroke();
      g.textAlign = "center";
      g.font = row ? "700 9px ui-sans-serif,system-ui,sans-serif" : "700 11px ui-sans-serif,system-ui,sans-serif";
      if (row) {
        const half = g.measureText(label).width / 2 + 5;
        for (let i = 0; i < used.length; i++) if (Math.abs(used[i] - x) < half * 2) return;
        used.push(x);
      }
      g.fillStyle = colour;
      g.fillText(label, x, yText);
    }
    const CARD = [["N", 0], ["E", Math.PI / 2], ["S", Math.PI], ["W", -Math.PI / 2],
                  ["NE", Math.PI / 4], ["SE", 3 * Math.PI / 4], ["SW", -3 * Math.PI / 4], ["NW", -Math.PI / 4]];
    for (let i = 0; i < CARD.length; i++) tick(CARD[i][1], CARD[i][0], "rgba(244,236,216,.6)", 0);
    const D = W.desert;
    const o = nearest(D.oases);
    if (o) tick(Math.atan2(o.x - S.you.x, o.z - S.you.z), "WATER " + km(o.d), "#39d0a8", 1);
    const p = nearest(S.outposts);
    if (p) tick(Math.atan2(p.x - S.you.x, p.z - S.you.z), p.name + " " + km(p.d), "#ffb15a", 1);
    g.fillStyle = "#ffb15a";
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2 - 6, 7); g.lineTo(w / 2 + 6, 7); g.closePath(); g.fill();
    g.textAlign = "left";
  }
  function km(d) { return d < 950 ? Math.round(d) + "m" : (Math.round(d / 100) / 10) + "km"; }
  function nearest(list) {
    let best = null, bd = 1e18;
    for (let i = 0; i < list.length; i++) {
      const d = Math.hypot(list[i].x - S.you.x, list[i].z - S.you.z);
      if (d < bd) { bd = d; best = list[i]; }
    }
    if (!best) return null;
    return { x: best.x, z: best.z, d: bd, name: best.name || "" };
  }

  /* ============================================================ THE PICK
     A press that does not move is a destination; a press that moves is the
     camera. One rule, mouse and thumb. The 8 px / 380 ms gate is the
     standard one and it is the reason you can both drag-look and tap-to-go
     on a touchscreen without a mode button. */
  function bindPointer() {
    const cv = micro.canvas || document.body;
    let downX = 0, downY = 0, downT = 0, moved = 0, id = -1;
    cv.addEventListener("pointerdown", function (e) {
      if (!live) return;
      id = e.pointerId; downX = e.clientX; downY = e.clientY; downT = performance.now(); moved = 0;
    });
    cv.addEventListener("pointermove", function (e) {
      if (e.pointerId !== id) return;
      moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
    });
    cv.addEventListener("pointerup", function (e) {
      if (!live || e.pointerId !== id) return;
      id = -1;
      if (moved > 8 || performance.now() - downT > 380) return;   // that was a look drag
      rideTo(e.clientX, e.clientY);
    });
    /* THE TOUCH LAYER EATS THE CANVAS. microboot's furniture root is
       `inset:0; pointer-events:auto` and swallows every pointer on a phone,
       so the canvas listener above never fires there. Same gate, second
       surface — the alternative is a phone build where tap-to-ride silently
       does nothing, which is exactly how the first draft shipped. */
    const troot = micro.touch && micro.touch.root;
    if (troot) {
      let tX = 0, tY = 0, tT = 0, tMoved = 0, tId = -1;
      troot.addEventListener("pointerdown", function (e) {
        if (!live) return;
        tId = e.pointerId; tX = e.clientX; tY = e.clientY; tT = performance.now(); tMoved = 0;
      }, true);
      troot.addEventListener("pointermove", function (e) {
        if (e.pointerId !== tId) return;
        tMoved = Math.max(tMoved, Math.hypot(e.clientX - tX, e.clientY - tY));
      }, true);
      troot.addEventListener("pointerup", function (e) {
        if (!live || e.pointerId !== tId) return;
        tId = -1;
        if (tMoved > 10 || performance.now() - tT > 380) return;
        // never let a tap on the stick itself become a destination
        if (e.clientY > window.innerHeight - 200 && e.clientX < 260) return;
        rideTo(e.clientX, e.clientY);
      }, true);
    }
    // zoom: wheel on a mouse, pinch on a thumb
    window.addEventListener("wheel", function (e) {
      if (!live) return;
      camDistWant = clamp(camDistWant * (1 + (e.deltaY > 0 ? 0.16 : -0.16)), 16, 520);
    }, { passive: true });
    const pts = new Map();
    let pinch0 = 0, dist0 = 0;
    function pmove(e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2) return;
      const a = Array.from(pts.values());
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      if (!dist0) { dist0 = d; pinch0 = camDistWant; return; }
      camDistWant = clamp(pinch0 * (dist0 / Math.max(1, d)), 16, 520);
    }
    window.addEventListener("pointerdown", function (e) { if (live) pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); }, true);
    window.addEventListener("pointermove", pmove, true);
    function pend(e) { pts.delete(e.pointerId); if (pts.size < 2) dist0 = 0; }
    window.addEventListener("pointerup", pend, true);
    window.addEventListener("pointercancel", pend, true);
  }

  /* MARCH THE RAY AGAINST THE FUNCTION, not against the mesh. Out at two
     kilometres the clipmap is 512 m per quad and a mesh raycast would land
     the marker up to a hundred metres from where you pointed — on a
     different dune. heightAt knows the real ground everywhere, so this is
     both more accurate and independent of which LOD happens to be there. */
  const _ndc = new THREE.Vector3();
  const _pick = new THREE.Vector3();

  /* TAP A PARTY TO ENGAGE IT, and the pick is SCREEN-SPACE on purpose. A
     warband two kilometres out is three metres wide in the world and forty
     pixels wide on the glass; asking "did the ground ray land within 30 m of
     it" makes the far half of the island untappable, which is exactly the
     kind of thing that turns one verb into two. 46 px, nearest wins, and the
     ride target then TRACKS the party — you are chasing a thing that is
     running away, not the coordinate it was standing on when you tapped. */
  function pickParty(sx, sy) {
    const w = window.innerWidth, h = window.innerHeight;
    let best = null, bd = 46;
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      if (Math.hypot(b.x - S.you.x, b.z - S.you.z) > BAND_DRAW) continue;
      _pick.set(b.x, W.desert.heightAt(b.x, b.z) + 6, b.z).project(camera);
      if (_pick.z > 1) continue;
      const px = (_pick.x * 0.5 + 0.5) * w, py = (-_pick.y * 0.5 + 0.5) * h;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /* A PEER IS A PARTY AND TAPPING ONE IS THE SAME GESTURE. What happens next
     is NOT this file's decision — attacking another human is warnet's
     business (consent, latency, whose sim wins) — so the tap rides at him
     and hands the seam over. Guarded, because warnet may not be loaded. */
  function pickPeer(sx, sy) {
    const w = window.innerWidth, h = window.innerHeight;
    let best = null, bd = 46;
    for (let i = 0; i < peerDraw.length; i++) {
      const q = peerDraw[i];
      _pick.set(q.x, W.desert.heightAt(q.x, q.z) + 7, q.z).project(camera);
      if (_pick.z > 1) continue;
      const d = Math.hypot((_pick.x * 0.5 + 0.5) * w - sx, (-_pick.y * 0.5 + 0.5) * h - sy);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  function rideTo(sx, sy) {
    if (!camera) return;
    const peer = pickPeer(sx, sy);
    if (peer) {
      chase = null;
      dest = { x: peer.x, z: peer.z };
      W.emit("campaign:peer", peer);
      if (W.warnet && W.warnet.engage) { try { W.warnet.engage(peer); } catch (e) {} }
      else W.toast("riding at " + peer.name);
      return;
    }
    const tgt = pickParty(sx, sy);
    if (tgt) {
      chase = tgt;
      dest = { x: tgt.x, z: tgt.z };
      W.emit("campaign:dest", dest);
      const d = Math.hypot(tgt.x - S.you.x, tgt.z - S.you.z);
      /* A REFUSED TAP USED TO DO NOTHING AT ALL, AND THEN FOLLOW THEM FOREVER.
         engage() answers false when a band is still on its break-off clock,
         and this line threw that boolean away — so tapping a party you had
         just ridden away from was indistinguishable from tapping dead ground,
         for as long as the clock ran. Worse, `chase` was already set two lines
         above and NOTHING releases it while it is set, so the refusal also
         glued the player to a party that would not talk to him.

         Both halves are the same rule: if he cannot have the encounter, say
         so and let go of him. army.js's break-off is 8 s now (it was up to
         three minutes) and the party visibly walks away, so this is a rare
         case — but a rare silent no is exactly the kind a player reads as a
         broken game. */
      if (d < CONTACT * 1.6) {
        if (!engage(tgt)) {
          chase = null; dest = null;
          W.toast(tgt.name + " breaks off", "bad");
        }
      } else W.toast("riding at " + W.bandSize(tgt) + " " + tgt.name);
      return;
    }
    chase = null;
    const w = window.innerWidth, h = window.innerHeight;
    _ndc.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1, 0.5);
    _ndc.unproject(camera);
    const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
    let dx = _ndc.x - ox, dy = _ndc.y - oy, dz = _ndc.z - oz;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const D = W.desert;
    let t = 1, hit = -1;
    for (let i = 0; i < 900 && t < 7000; i++) {
      const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
      if (py <= D.heightAt(px, pz)) { hit = t; break; }
      t += Math.max(3, t * 0.022);
    }
    if (hit < 0) return;
    let lo = Math.max(0, hit - Math.max(3, hit * 0.022)), hi = hit;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) * 0.5;
      if (oy + dy * m <= D.heightAt(ox + dx * m, oz + dz * m)) hi = m; else lo = m;
    }
    const x = ox + dx * hi, z = oz + dz * hi;
    if (!D.onLand(x, z)) { W.toast("that is the sea", "bad"); return; }
    dest = { x: x, z: z };
    markAt(x, z);
    W.emit("campaign:dest", dest);
  }

  /* ============================================================ THE DAY
     Keyframes, interpolated on the travel clock. core/daynight.js was read
     and does not fit (see the header). The write order matters: microboot
     registers a CBZ.onAlways(9) hook that RESTORES the base sun/hemi/fog
     every frame — `always` hooks run before frame hooks, so a tint applied
     here lands after the restore and survives. Doing it the other way round
     is a light that flickers at 60 Hz. */
  const SKYKEY = [
    { h: 0,  sun: 0.10, sc: 0x7f9ad0, hemi: 0.24, hc: 0x33456b, gc: 0x241f2a, fog: 0x131b2c, top: 0x0a1226, bot: 0x1d2740 },
    { h: 5,  sun: 0.14, sc: 0x9aa8d8, hemi: 0.28, hc: 0x46557d, gc: 0x2b2630, fog: 0x2a2f42, top: 0x14203c, bot: 0x4a4258 },
    { h: 6.6, sun: 0.74, sc: 0xffa863, hemi: 0.36, hc: 0x8798bc, gc: 0x6b4a26, fog: 0xd39a6a, top: 0x2f5f96, bot: 0xf0b070 },
    { h: 9,  sun: 0.95, sc: 0xfff0cc, hemi: 0.40, hc: 0x9ebbd8, gc: 0xa87233, fog: 0xe6cda1, top: 0x4478ad, bot: 0xe6cda1 },
    { h: 14, sun: 1.02, sc: 0xfffaf0, hemi: 0.42, hc: 0xa7c2dc, gc: 0xb07a38, fog: 0xefdcb6, top: 0x3f74ad, bot: 0xefdcb6 },
    { h: 17.5, sun: 0.88, sc: 0xffd9a0, hemi: 0.38, hc: 0x9fb6d2, gc: 0x9c6a30, fog: 0xe8b986, top: 0x3c6ea8, bot: 0xe8b986 },
    { h: 19.4, sun: 0.56, sc: 0xff8f4a, hemi: 0.36, hc: 0x9fadd0, gc: 0x7a5c3c, fog: 0xc9743f, top: 0x2a4a80, bot: 0xd98a4a },
    { h: 21,  sun: 0.16, sc: 0x8f9ed0, hemi: 0.28, hc: 0x4d5c84, gc: 0x322b34, fog: 0x39364a, top: 0x18244a, bot: 0x54465e },
    { h: 24, sun: 0.10, sc: 0x7f9ad0, hemi: 0.24, hc: 0x33456b, gc: 0x241f2a, fog: 0x131b2c, top: 0x0a1226, bot: 0x1d2740 },
  ];
  const _cA = new THREE.Color(), _cB = new THREE.Color();
  function mixHex(a, b, t, out) { _cA.setHex(a); _cB.setHex(b); return out.copy(_cA).lerp(_cB, t); }

  function tintDay() {
    if (FLAG_NOCLOCK) return;
    const h = clamp(S.hour, 0, 24);
    let i = 0;
    while (i < SKYKEY.length - 2 && SKYKEY[i + 1].h <= h) i++;
    const a = SKYKEY[i], b = SKYKEY[i + 1];
    const t = clamp((h - a.h) / Math.max(0.001, b.h - a.h), 0, 1);
    const sun = micro.sun, hemi = micro.hemiLight;
    if (sun) {
      sun.intensity = lerp(a.sun, b.sun, t);
      mixHex(a.sc, b.sc, t, sun.color);
      /* THE SUN MOVES. A fixed light with a changing colour reads as a
         filter; a shadow that swings from west to east through the day is
         what makes an hour feel like an hour. micro.lights parks the rig
         relative to the camera at order -100 every frame, so this rewrite
         (a plain frame hook, order 5) is the one that lands. */
      const ang = (h / 24) * TAU - Math.PI / 2;
      const el = Math.max(0.12, Math.sin((h - 6) / 12 * Math.PI));
      const dd = 900;
      const cx = camera ? camera.position.x : 0, cz = camera ? camera.position.z : 0;
      sun.position.set(cx + Math.cos(ang) * dd * 0.8, dd * el, cz + Math.sin(ang) * dd * 0.8);
      if (sun.target) { sun.target.position.set(cx, 0, cz); sun.target.updateMatrixWorld(); }
    }
    if (hemi) {
      hemi.intensity = lerp(a.hemi, b.hemi, t);
      mixHex(a.hc, b.hc, t, hemi.color);
      mixHex(a.gc, b.gc, t, hemi.groundColor);
    }
    if (scene.fog) mixHex(a.fog, b.fog, t, scene.fog.color);
    if (scene.background && scene.background.isColor) mixHex(a.fog, b.fog, t, scene.background);
    const dome = micro.skyDome;
    if (dome && dome.material && dome.material.uniforms) {
      mixHex(a.top, b.top, t, dome.material.uniforms.topColor.value);
      mixHex(a.bot, b.bot, t, dome.material.uniforms.bottomColor.value);
    }
  }

  /* ============================================================ THE WORLD TICK
     Wall time, every phase, paused or not. Nothing here draws and nothing
     here reads input — this is the part of the campaign that is true for
     everybody on the island, including the parts of it nobody is looking at.

     THE CATCH-UP IS THE POINT. `dt` is measured off performance.now(), not
     off the frame delta, so a tab that was hidden for ninety seconds wakes
     up ninety seconds later in the world rather than exactly where it left.
     The CLOCK takes the whole elapsed time; the BAND MOTION is stepped in
     0.25 s substeps (a party at 8 m/s must not teleport 700 m through a
     mesa in one integration step) and capped at CATCHUP_MAX of them, so a
     wake-up after an hour costs 30 s of walking and one frame, not a
     minute of frozen page. */
  function worldTick() {
    if (!built) return;
    /* THE WORLD ASKS THE CLOCK, NOT THE WALL. This line said
       performance.now(), and that was correct for as long as game time and
       wall time were the same thing. W.clock.now() is the same monotonic
       millisecond count WARPED by the speed setting (core.js, THE CLOCK), so
       at 1x nothing here changes by a single float and at 8x the island —
       the day, the wages, every band on it — runs eight times over while the
       player stands still. Everything below already substeps its own
       catch-up, which is why the fast-forward needed no new integrator: a
       0.25 s band step is a 0.25 s band step whether it came from a hidden
       tab or from the slider. */
    const now = W.clock.now();
    if (!lastWall) { lastWall = now; return; }
    let dt = (now - lastWall) / 1000;
    lastWall = now;
    if (!(dt > 0)) return;
    if (dt > 3600) dt = 3600;

    /* ---- the day, on real seconds -------------------------------------
       THE CLOCK IS CONTINUOUS AND S.hour IS ITS SHADOW. The first version
       kept only the 0-24 hour and asked two questions — "did we wrap past
       24" and "did we cross 06:00" — which are the SAME crossing counted
       twice, so every in-game day paid its wages twice over. One monotonic
       counter, and the number of dawns is the difference between two floor
       divisions: correct for a normal frame, and correct for a wake-up that
       spans four days without a special case.

       It re-syncs from S.hour when the two disagree, because W.load()
       restores S.hour out from under this file and a save loaded at 03:00
       must not owe eleven days of wages. */
    if (!FLAG_NOCLOCK) {
      if (clockH === null || Math.abs(((clockH % 24) + 24) % 24 - S.hour) > 0.5) clockH = S.hour;
      const prev = clockH;
      clockH += dt / HOUR_SECS;
      S.hour = ((clockH % 24) + 24) % 24;
      const dawns = Math.floor((clockH - 6) / 24) - Math.floor((prev - 6) / 24);
      for (let i = 0; i < Math.min(dawns, 8); i++) W.dawn();
    }

    /* THE PARTIES. Normal frames take the real dt in one go — accumulating
       into fixed 0.25 s ticks was the first version and it made every band
       on the island advance in 1.5 m hops four times a second, which reads
       as lag, not as walking. Substepping is ONLY for the catch-up case,
       where the alternative is a party integrating 700 m in one step and
       walking through a mesa on the way.

       yourPower() is hoisted out of the loop: it sums the whole roster, and
       a thousand-man army times sixty bands times a hundred catch-up
       substeps is six million calls for a number that cannot change inside
       one wake-up. */
    const myPower = W.yourPower();
    if (dt <= 0.3) {
      stepBands(dt, myPower, 0);
    } else {
      /* THE CATCH-UP SUBSTEPS ARE FOR THE PARTIES YOU CAN SEE, AND THAT IS
         WHERE THE FAST-FORWARD WENT.

         At 16x this loop runs up to CATCHUP_MAX times per frame, and every one
         of those calls walked EVERY party on the island — 32 passes over 677
         parties is 21 664 iterations a frame to decide, 640 times out of 677,
         "this one is far away, not yet". The substeps exist for one reason,
         stated in the comment above: a party must not integrate 700 m in one
         step and walk through a mesa on the way. A party already on the far
         clock cannot do that — its whole design is that it moves in FAR_JUMP
         chunks — so it has no business being asked 32 times.

         So the pass is split. NEAR (drawn, inside BAND_DRAW) parties take the
         substeps, because they are the ones whose motion is on screen and
         whose collisions matter. FAR parties are visited ONCE per frame with
         the whole elapsed dt and their own accumulator does the rest. Same
         world, same routes, same arrival times.

         MEASURED before the split, with 677 parties on the island: 16x
         delivered about 5.9x on a machine at load 117 where 96 parties
         delivered 15.6x. This is the one real cost the bigger island had, and
         it was not in the frame — it was in the fast-forward.

         AND THE OFF-SCREEN WAR TICKS ONCE A FRAME, NOT ONCE A SUBSTEP. The
         band-vs-band resolver and the refill live at the end of stepBands, and
         under the old code they were reached 32 times a frame at 16x — each
         one an O(parties) scan. They are not integrators; they are events on a
         game-time clock. They belong in the once-per-frame pass, and their
         accumulators carry the whole dt so their rate in GAME time is
         untouched. (mode 2 = the far pass, which is also the events pass.) */
      let left = dt, steps = 0;
      while (left > 0.0001 && steps < CATCHUP_MAX) {
        const h = Math.min(0.25, left);
        stepBands(h, myPower, 1);       // 1 = near parties only
        left -= h; steps++;
      }
      stepBands(dt, myPower, 2);        // 2 = far parties, and the world events
    }
  }

  /* ============================================================ THE FRAME */
  function step(dt) {
    if (!live) return;
    if (dt > 0.1) dt = 0.1;
    const D = W.desert;
    const you0x = S.you.x, you0z = S.you.z;

    // ---- input ----------------------------------------------------------
    if (controls) controls.step(dt);
    let mx = 0, my = 0;
    if (controls) { mx = controls.move.x; my = controls.move.y; }
    const stickLive = Math.hypot(mx, my) > 0.12;
    if (stickLive) { dest = null; chase = null; }      // you took the reins

    // camera swing: drag/right-side thumb, or Q/E
    if (controls) camYaw += controls.look.x;
    const IN = micro.input;
    if (IN) camYaw += (IN.isDown("KeyQ") ? 1 : 0) * dt * 1.6 - (IN.isDown("KeyE") ? 1 : 0) * dt * 1.6;

    // ---- where is he going ----------------------------------------------
    let wantX = 0, wantZ = 0;
    if (stickLive) {
      /* CAMERA-RELATIVE, AND THE SIGNS ARE NOT A MATTER OF TASTE.

         This rotated by MINUS camYaw and shipped that way: push the stick
         forward after swinging the camera and the man rode backwards. At
         yaw 0 the wrong matrix and the right one are identical, which is
         exactly why it survived — every test that started the game and
         pushed forward passed.

         The camera is placed at (-sin, -cos) * back and looks toward
         (+sin, +cos), so in world space:
             camera forward = ( sin(camYaw),  cos(camYaw) )
             camera right   = ( cos(camYaw), -sin(camYaw) )
         and the stick is (x = right, y = forward) — studio.controls builds
         move.y from axis("KeyS","KeyW"), so +y is forward on the keyboard
         and the touch stick negates screen-y to match. Project the stick
         onto those two vectors and there is nothing left to get wrong. */
      const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
      wantX = my * sn + mx * cs;
      wantZ = my * cs - mx * sn;
    } else if (dest) {
      // a chased party moves; the destination is the party, not the spot
      if (chase) {
        if (S.bands.indexOf(chase) < 0) { chase = null; dest = null; }
        else { dest.x = chase.x; dest.z = chase.z; }
      }
      if (!dest) { wantX = 0; wantZ = 0; }
      const dx = dest ? dest.x - S.you.x : 0, dz = dest ? dest.z - S.you.z : 0;
      const d = Math.hypot(dx, dz);
      if (!dest || (d < 4 && !chase)) { dest = null; chase = null; }
      else if (d > 0.5) { wantX = dx / d; wantZ = dz / d; }
    }

    const wl = Math.hypot(wantX, wantZ);
    if (wl > 0.001) {
      wantX /= wl; wantZ /= wl;
      let sp = RIDE_SPEED * Math.min(1, wl > 1 ? 1 : Math.max(wl, stickLive ? Math.hypot(mx, my) : 1));
      /* HILLS COST. Not a wall — a wall in an open-world ride reads as a
         bug — but a mesa flank slows you to a crawl and the ridge line
         becomes a route decision instead of scenery. */
      const ahead = D.heightAt(S.you.x + wantX * 6, S.you.z + wantZ * 6);
      const grade = (ahead - D.heightAt(S.you.x, S.you.z)) / 6;
      sp *= clamp(1 - Math.max(0, grade) * 1.15, 0.22, 1);
      let nx = S.you.x + wantX * sp * dt, nz = S.you.z + wantZ * sp * dt;
      /* THE SEA IS THE EDGE OF THE MAP and it does not need a wall: he
         simply will not walk into it. Slide along the shore instead of
         stopping dead, or a coastal ride is a series of snags. */
      if (!D.onLand(nx, nz)) {
        if (D.onLand(S.you.x + wantX * sp * dt, S.you.z)) nz = S.you.z;
        else if (D.onLand(S.you.x, S.you.z + wantZ * sp * dt)) nx = S.you.x;
        else { nx = S.you.x; nz = S.you.z; dest = null; }
      }
      S.you.x = nx; S.you.z = nz;
      const want = Math.atan2(wantX, wantZ);
      let dy = want - S.you.yaw;
      while (dy > Math.PI) dy -= TAU;
      while (dy < -Math.PI) dy += TAU;
      S.you.yaw += dy * Math.min(1, dt * 7);
    }

    const moved = Math.hypot(S.you.x - you0x, S.you.z - you0z);
    travelled += moved;

    // ---- breadcrumbs: the shape of the column ---------------------------
    crumbAcc += moved;
    if (crumbAcc >= TRAIL_STEP || !breadcrumbs.length) {
      /* THE CRUMB CARRIES ITS OWN ARC LENGTH, and it is the TRUE distance
         ridden, not index × TRAIL_STEP. crumbAcc resets rather than
         subtracting because the crumb is stamped at where the man IS, so the
         spacing is whatever the frame delivered — 1.6 m on foot, 2.3 m on a
         camel at 30 fps, thirty metres after a backgrounded tab catches up.
         With s on the crumb none of that matters to the sampler. */
      breadcrumbs.push({ x: S.you.x, z: S.you.z, s: trailLen + crumbAcc });
      trailLen += crumbAcc;
      crumbAcc = 0;
      if (breadcrumbs.length > TRAIL_MAX) breadcrumbs.shift();
    }

    // ---- the world ------------------------------------------------------
    // NOT stepBands: the parties are on the wall clock in worldTick, so they
    // keep walking while this file is not the one drawing.
    /* THE CLIPMAP FOLLOWS THE MAN, NOT THE EYE. At strategic zoom the camera
       is 500 m behind him, and centring the fine ring on the camera puts the
       8 m ground behind the shot and the 32 m ground under the thing you are
       actually looking at. Split the difference toward him. */
    D.follow(lerp(S.you.x, camera.position.x, 0.28), lerp(S.you.z, camera.position.z, 0.28));

    /* ONE COMPOUND PER FRAME UNTIL THE QUEUE IS EMPTY (see raiseOutposts);
       after that this is a length check on an empty array. The near/far swap
       is NOT driven from here — props.js's own tickAll already calls
       lodTick(camera.position) off CBZ.onUpdate, and two callers of a
       toggle is how one of them ends up being the one that is wrong. */
    if (raiseQ.length) pumpOutposts(1);

    // ---- draw -----------------------------------------------------------
    youSpeed = moved / Math.max(dt, 0.0001);
    placeYou(dt, youSpeed);
    drawMen(dt);
    drawMarker(dt);
    updateCamera(dt);
    paintPlates();
    paintCompass();

    // ---- handoffs -------------------------------------------------------
    checkContacts();
  }

  function placeYou(dt, speed) {
    const D = W.desert;
    /* SAND OWNS WHERE A BODY MEETS THE GROUND. plant() seats him on the
       surface that is actually DRAWN (desert.renderHeightAt — the analytic
       height is up to 1.6 m off on a steep face), leans him into the slope,
       and stamps the print he leaves. Guarded: without sand.js he stands on
       the analytic height plumb, which is what he did before. */
    if (W.sand && W.sand.plant) {
      W.sand.plant(youRig, S.you.x, S.you.z, S.you.yaw,
                   { id: "you", dt: dt, speed: speed, r: 0.54 });
    } else {
      youRig.position.set(S.you.x, D.heightAt(S.you.x, S.you.z), S.you.z);
      youRig.rotation.y = S.you.yaw;
    }
    /* AND HE GROWS WITH HIS MEN. The size lie used to be the camera's, so
       every man on the island scaled with the pull-back and the one body that
       did NOT was the player's — at strategic zoom his own column stood three
       times his height around him. manScale is now per-body distance, so
       running him through it costs one call and makes him the same man as the
       men beside him at every range. Over the shoulder it returns exactly 1
       and nothing moves. */
    const lie = manScale(camera.position.distanceTo(youRig.position));
    if (youRig.scale.x !== lie) youRig.scale.setScalar(lie);
    if (CBZ.animChar && youRig.userData.charRig) {
      try { CBZ.animChar(youRig.userData.charRig, speed > 0.3 ? Math.min(speed, 6.2) : 0, dt); } catch (e) {}
    }
  }

  /* ============================================================ THE COLUMN
     Followers ride the breadcrumb, not the player: a man 40 m back is where
     YOU were 40 m ago, which is what makes the column bend through a wadi
     instead of cutting the corner like a rubber band. The lateral offset is
     hashed off the man's index so the column is a column and not a line,
     and so it does not shimmer as the roster changes.

     DRAWING IS NOW TWO PASSES, NOT ONE. The old function walked the column
     and the bands and wrote instance matrices as it went, which is why there
     was nowhere to put a "this man is close enough to be a real body"
     decision: by the time you knew his distance you had already drawn him.
     So: GATHER every man on the island into a reused record list, DECIDE
     which of them the 48 rigs go to, and only then draw — rigs for the near
     ones, instances for everybody else. Nothing here allocates per frame. */

  /* ============================================================ THE PATH
     WHERE WAS HE `back` METRES AGO — the one question the column asks, and
     the answer has to be CONTINUOUS in `back` or the men do not walk, they
     tick. Linear interpolation between the two crumbs that bracket the arc
     length, with the LIVE player position welded on as the head of the path
     so the answer keeps moving between crumb pushes.

     The cursor is not an optimisation for its own sake: drawMen asks for
     ascending `back`, so one backwards walk of the array serves all sixty
     followers instead of sixty binary searches. Reset it before the loop. */
  /* THE BASE-2 RADICAL INVERSE. Used by the column's lanes and by a warband's
     disc, for the same reason in both: consecutive indices land FAR APART, so
     any prefix of the sequence is evenly spread instead of clumped. Two men
     placed by two independent hashes know nothing about each other and end up
     standing inside one another about as often as chance allows — which is a
     real part of what makes a crowd read as slop rather than as men. */
  function radInv2(i) {
    let r = 0, d = 0.5;
    for (i = i | 0; i > 0; i >>= 1) { if (i & 1) r += d; d *= 0.5; }
    return r;
  }

  const _tp = { x: 0, z: 0, tx: 0, tz: 1 };
  let trailCur = 0;
  function trailHead() { return trailLen + crumbAcc; }
  /* POSITION IS PIECEWISE LINEAR; THE TANGENT MUST NOT BE. Taking the
     tangent straight off the segment a man happens to be standing on makes
     his HEADING a step function of `back`: the frame he crosses a crumb his
     facing flips to the next segment's bearing, and the crumbs are a
     hand-steered ride so consecutive bearings differ by a few degrees. It
     measured 165 deg/s of heading rate on a dead-straight ride against 119
     for the terrain lean alone. So the tangent is defined AT each crumb as
     the central difference of its neighbours and then interpolated across
     the segment — the standard Catmull-Rom tangent, and it is C0 in `back`
     where the raw segment direction is not. The point beyond the last crumb
     is the player himself, which is what keeps the head of the column
     pointing where he is actually going. */
  function ptX(i) { return i >= breadcrumbs.length ? S.you.x : breadcrumbs[i < 0 ? 0 : i].x; }
  function ptZ(i) { return i >= breadcrumbs.length ? S.you.z : breadcrumbs[i < 0 ? 0 : i].z; }
  const _ta = [0, 0], _tb = [0, 0];
  /* Math.sqrt(dx*dx+dz*dz) AND NOT Math.hypot, EVERYWHERE IN THIS PATH.
     hypot has to guard against overflow and underflow and V8 pays for it: it
     is several times the cost of the naive form on numbers that are always
     tens of metres, and drawMen is on this path three times per drawn man per
     frame. Measured on the column subject: 0.56 ms of drawMen became 0.48. */
  function tanAt(i, out) {
    const dx = ptX(i + 1) - ptX(i - 1), dz = ptZ(i + 1) - ptZ(i - 1);
    const L = Math.sqrt(dx * dx + dz * dz);
    if (L > 1e-4) { out[0] = dx / L; out[1] = dz / L; }
    else { out[0] = Math.sin(S.you.yaw); out[1] = Math.cos(S.you.yaw); }
  }
  function blendTan(i, t) {
    tanAt(i, _ta); tanAt(i + 1, _tb);
    const bx = _ta[0] + (_tb[0] - _ta[0]) * t, bz = _ta[1] + (_tb[1] - _ta[1]) * t;
    const L = Math.sqrt(bx * bx + bz * bz);
    if (L > 1e-4) { _tp.tx = bx / L; _tp.tz = bz / L; }
    else { _tp.tx = _ta[0]; _tp.tz = _ta[1]; }
  }
  function sampleTrail(back) {
    const n = breadcrumbs.length;
    if (!n) {
      _tp.x = S.you.x; _tp.z = S.you.z;
      _tp.tx = Math.sin(S.you.yaw); _tp.tz = Math.cos(S.you.yaw);
      return _tp;
    }
    const last = breadcrumbs[n - 1];
    const want = trailHead() - back;
    // the head segment: last crumb → where he is standing right now
    if (want >= last.s) {
      const dx = S.you.x - last.x, dz = S.you.z - last.z;
      const seg = Math.sqrt(dx * dx + dz * dz);
      const t = seg > 1e-4 ? clamp((want - last.s) / seg, 0, 1) : 0;
      _tp.x = last.x + dx * t; _tp.z = last.z + dz * t;
      blendTan(n - 1, t);
      return _tp;
    }
    if (trailCur > n - 2) trailCur = n - 2;
    if (trailCur < 0) trailCur = 0;
    while (trailCur > 0 && breadcrumbs[trailCur].s > want) trailCur--;
    while (trailCur < n - 2 && breadcrumbs[trailCur + 1].s <= want) trailCur++;
    const a = breadcrumbs[trailCur], b = breadcrumbs[trailCur + 1] || last;
    const seg = b.s - a.s;
    const t = seg > 1e-4 ? clamp((want - a.s) / seg, 0, 1) : 0;
    _tp.x = a.x + (b.x - a.x) * t; _tp.z = a.z + (b.z - a.z) * t;
    blendTan(trailCur, t);
    return _tp;
  }

  /* ---- one drawable man. Reused; menDrawN says how many are live ---- */
  const menDraw = [];
  let menDrawN = 0;
  const nearIdx = [];
  const bandOrder = [];            // band indices, nearest first (see drawMen)
  const bandDist = [];
  function byBandDist(a, b) { return bandDist[a] - bandDist[b]; }
  const wantKey = Object.create(null);
  let youSpeed = 0;
  function pushMan(key, x, z, y, yaw, bob, ms, mk, s, band, spd) {
    let m = menDraw[menDrawN];
    if (!m) m = menDraw[menDrawN] = {};
    m.key = key; m.x = x; m.z = z; m.y = y; m.yaw = yaw; m.bob = bob; m.ms = ms;
    m.body = mk.body; m.legs = mk.legs; m.head = mk.head; m.s = s; m.band = band; m.spd = spd;
    m.d2 = 0; m.rig = null;
    menDrawN++;
    return m;
  }

  /* THE GROUND A MAN STANDS ON, and it is two different questions at two
     ranges. Inside 400 m the DRAWN surface is what matters, because that is
     where the rigs are and sand.plant seats them on it — an impostor on the
     analytic height beside a rig on the drawn one is a swap that jumps up to
     1.6 m on a dune face. Past 400 m renderHeightAt is not merely expensive
     (measured 1.18 µs against heightAt's 0.36) but WRONG: desert.js says in
     so many words that level 0 of the clipmap only reaches that far. */
  function manGroundY(x, z, d2) {
    const D = W.desert;
    return (d2 < DRAWN_GROUND_R2 && D.renderHeightAt) ? D.renderHeightAt(x, z) : D.heightAt(x, z);
  }

  /* CACHED, AND THE MEASUREMENT IS WORTH WRITING DOWN BECAUSE IT IS LOPSIDED.
     W.outfits.marks() costs 19 ms the FIRST time it is asked about a given man
     — it indexes the catalogue, picks his fit, weathers it, pushes it off the
     sand's luminance and, for a camouflaged fit, builds the pattern texture to
     read its mean colour — and 2.35 µs every time after that, off outfits.js's
     own caches. The old code called it for every drawn man on every frame and
     paid the 2.35: 0.14 ms with sixty men in the column, and 2.3 ms in a field
     of forty warbands where nine hundred and eighty bodies are drawn. Not the
     biggest number in the frame, and not nothing either, for an answer that
     cannot change unless the man changes armies. Cache it on the soldier,
     keyed on the band he is being drawn for; the near band needs the same
     record every frame anyway to decide whether a pooled rig is still wearing
     the right uniform. */
  /* Bright enough to read AGAINST SAND, which is the only background this
     game has. The first pass used mid-tones picked in the abstract and every
     tier photographed as the same dark speck on a pale dune. Only reached on
     a page where outfits.js failed to load. */
  const TIER_FALLBACK = { levy: 0xc9b489, raider: 0xd2743c, soldier: 0x7fa05e, veteran: 0x5f88b4 };

  /* THE MEN ON THIS MAP HAVE BEEN RENDERING TWICE AS BRIGHT AS THE MEN IN THE
     GAME, and it is the same bug three other files in this module already have
     a paragraph about. `microboot.js:1234` sets
     `renderer.outputEncoding = THREE.sRGBEncoding`, so r128 takes every colour
     handed to the shader — material.color AND instanceColor — as LINEAR and
     applies the sRGB transfer once on the way out. outfits.js's tables are
     authored in sRGB (that is what a hex means to a person) and its apply()
     runs every one of them through toLinear() at the seam; desert.js states
     its sand as measured linear albedo for the same reason and says its first
     draft "photographed as white paper"; camo.js tags its own textures.

     marks() answers in the AUTHORED space — sample() is documented as
     converting back precisely so the two can be compared — and this file was
     pushing those hexes straight into setColorAt. So the rig beside the
     impostor was correct and the impostor was washed out, which is exactly
     what the swap-boundary strip photographed: dark navy men at 168 m turning
     pale blue-grey at 186 m with nothing but the LOD changing. It is also a
     fair part of why the cone looked like a plastic bollard rather than a man
     — that pale wash is what ?men=old still shows, deliberately, because the
     revert has to be the thing the owner actually complained about.

     Same transfer function as outfits.js's lin1, cached the same way, applied
     once per man when his mark is computed rather than per frame.
     (The BANNER is left alone: it is a map marker painted in the faction hex
     core publishes, it sits beside a pole and a nameplate that are equally
     unconverted, and making one of the three correct would make the set
     look wrong.) */
  const _linCache = new Map();
  function lin1(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toLinear(hex) {
    if (hex == null || FLAG_MEN_OLD) return hex;
    const k = hex | 0;
    let v = _linCache.get(k);
    if (v !== undefined) return v;
    v = (Math.round(lin1(((k >> 16) & 255) / 255) * 255) << 16) |
        (Math.round(lin1(((k >> 8) & 255) / 255) * 255) << 8) |
        Math.round(lin1((k & 255) / 255) * 255);
    _linCache.set(k, v);
    return v;
  }

  function shade(hex, k) {
    return (Math.round(((hex >> 16) & 255) * k) << 16) |
           (Math.round(((hex >> 8) & 255) * k) << 8) | Math.round((hex & 255) * k);
  }
  /* A WeakMap, NOT A FIELD ON THE SOLDIER, and that is not fussiness. W.save()
     is `JSON.stringify(W.state)` — every man in your army and every man in
     every one of forty band rosters — so a cache written onto the soldier ends
     up in localStorage, in the multiplayer snapshot, and back out of a load as
     stale colours from whatever the catalogue looked like at save time. The
     soldier record is core's, and this is a rendering answer. */
  const markCache = new WeakMap();
  function markOf(s, band) {
    const bk = band ? (band.id == null ? "?" : band.id) : "-";
    const hit = markCache.get(s);
    if (hit && hit.bk === bk) return hit.mk;
    const O = W.outfits;
    let mk = null;
    if (O && O.marks) { try { mk = O.marks(s, band || null); } catch (e) { mk = null; } }
    if (!mk) mk = { body: TIER_FALLBACK[s.tier] || 0x9c8f6d, head: 0xd9b48c };
    /* AND THE TROUSERS, WHICH marks() DOES NOT ANSWER. It was written for the
       cone, which had one colour, so it hands back a torso hex and a head hex
       and stops. The trousers are a third of a man's silhouette and in this
       catalogue they are routinely nothing like his shirt. Rather than invent
       a second colour model, this asks outfits.js's OWN public helpers in the
       exact order its own apply() asks them — forSoldier for the record,
       detail for the wear, then weathered and readable — so the impostor's
       legs are the same hex the rig's legs get painted, not a guess derived
       from the shirt. A camouflaged man wears one pattern over both, so his
       legs take marks()' camo mean. */
    let legs = null;
    if (O && O.forSoldier && O.detail && O.readable && O.weathered) {
      try {
        const rec = O.forSoldier(s, band || null);
        const det = O.detail(s, band || null, rec);
        const c = rec.colors || {};
        legs = (rec.camo || c.legs == null) ? mk.body
             : O.readable(O.weathered(c.legs, det.wear || 0), false);
      } catch (e) { legs = null; }
    }
    mk = { body: toLinear(mk.body), head: toLinear(mk.head),
           legs: toLinear(legs == null ? shade(mk.body, 0.78) : legs) };
    markCache.set(s, { bk: bk, mk: mk });
    return mk;
  }
  // a band that arrived over the wire with no roster, and the page with no
  // outfits.js at all: one colour, and the legs a shade of it
  function flatMark(bodyCol, headCol) {
    _flat.body = toLinear(bodyCol); _flat.legs = toLinear(shade(bodyCol, 0.78));
    _flat.head = toLinear(headCol);
    return _flat;
  }
  const _flat = { body: 0, legs: 0, head: 0 };

  /* PEERS ARE PARTIES AND THEIR MEN ARE MEN. W.state.peers carries
     {id,name,x,z,size,colour} and no roster — warnet.js never sends one,
     because the map is derivable and a roster is not. But this file's own
     rule is that a human column and a computer column are the SAME OBJECT on
     screen, and that rule breaks the moment AI bands get real bodies and
     peers get boxes. So a peer's men are minted here, deterministically off
     his id, as a rival warlord's soldiers — the faction core already has for
     exactly this. They are display-only and never enter W.state. */
  const peerMen = Object.create(null);
  function peerMan(pid, k) {
    const key = pid + ":" + k;
    let s = peerMen[key];
    if (!s) {
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 131 + key.charCodeAt(i)) | 0;
      s = peerMen[key] = { id: Math.abs(h) % 100000, tier: (k % 4 === 0) ? "veteran" : (k % 3 === 0) ? "soldier" : "raider" };
    }
    return s;
  }
  const peerBands = Object.create(null);
  function peerBand(pid) {
    return peerBands[pid] || (peerBands[pid] = { id: "peer:" + pid, faction: "warlord" });
  }

  /* ============================================================ FORMATIONS
     A PARTY'S MEN STAND IN THE SAME PLACES FROM ONE FRAME TO THE NEXT, and
     until now they did not. The old line was

         const a  = W.hash01(b.x + k, b.z, 41 + k) * TAU;
         const rr = 1.6 + W.hash01(b.x, b.z + k, 51 + k) * (...);

     — every man's angle and radius around his band hashed off the band's
     CURRENT WORLD POSITION. W.hash01 rounds its inputs to eighths of a metre,
     so a party walking at BAND_SPEED crosses a fresh hash bucket about
     eighteen times a second and on every one of those the whole party
     re-rolls: fourteen men, new angle, new radius, teleported up to six
     metres, ~18 Hz, with their legs walking smoothly through it. That is the
     shimmer the owner is looking at. There is no amount of animation polish
     that survives a random shuffle at eighteen hertz.

     The offsets are now hashed off the band's IDENTITY and the man's index,
     which never change, and cached. What was two hash calls, a cos and a sin
     per man per frame is now a table read.

     THEY ALSO MARCH IN A COLUMN. A blob is what a party at rest is; a party
     under way stretches along its heading and narrows across it, damped so
     the shape flows when the band starts and stops rather than snapping. And
     each man carries a slow two-axis sway of his own — that is a BREATHING
     term, not a simulation, and it is what stops fourteen men reading as one
     rigid constellation being dragged across the sand. */
  const bandView = new WeakMap();
  function strSeed(s) {
    let h = 2166136261;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) % 9973;
  }
  /* HOW MANY OF A PARTY YOU CAN SEE, AND IT IS A DISTANCE QUESTION. The old
     rule was `clamp(round(sqrt(size) * 1.5), 2, 14)` at every range, so a
     two-hundred-man warband standing forty metres in front of you was FOURTEEN
     men — which is most of "hordes look shit and unrealistic", and the banner
     saying 200 over the top of it made it worse rather than better. Inside
     140 m a party shows its roster up to sixty bodies (past sixty the cluster
     stops reading as a count and the near band only has forty-eight rigs to
     give anyway); by 700 m it is back on the old sqrt rule, where fourteen
     specks and a banner is genuinely all the information there is.
     The offsets are TABULATED for the full sixty regardless, so approaching a
     party does not rebuild its formation — it just draws more of the same one. */
  const FORM_CAP = 60;
  function bandShow(size, d) {
    const t = clamp((d - 140) / (700 - 140), 0, 1);
    const near = Math.min(size, FORM_CAP);
    const far = clamp(Math.round(Math.sqrt(size) * 1.5), 2, 14);
    return Math.max(2, Math.min(near, Math.round(near + (far - near) * t)));
  }
  function bandForm(b, size, spd, dt) {
    let v = bandView.get(b);
    if (!v) { v = { seed: strSeed(b.id), n: -1, size: -1, march: 0, lat: [], fwd: [], w: [], p: [] }; bandView.set(b, v); }
    const cap = Math.max(2, Math.min(size, FORM_CAP));
    if (v.n !== cap || v.size !== size) {
      v.n = cap; v.size = size;
      /* A GOLDEN-ANGLE / VAN-DER-CORPUT DISC, not a pile of independent
         random points. Two men are placed by two hashes that know nothing
         about each other, so a hashed cluster always has pairs standing
         inside each other and holes you could park a truck in — which is the
         other half of "hordes look shit". The golden angle spreads the
         bearings and the base-2 radical-inverse spreads the radii, and both
         are LOW DISCREPANCY IN EVERY PREFIX: that is the property that makes
         it safe to draw only the first `show` of the table and still get an
         evenly covered crowd rather than a dense core with a bare rim.
         A little hash jitter on top so it does not read as a spiral. */
      const R = 3.8 + Math.sqrt(size) * 0.75;
      for (let k = 0; k < cap; k++) {
        const a = k * 2.39996323 + W.hash01(v.seed, k, 41) * 0.55;
        const rr = 1.3 + R * Math.sqrt(radInv2(k + 1)) + (W.hash01(v.seed, k + 128, 51) - 0.5) * 0.8;
        v.lat[k] = Math.cos(a) * rr;
        v.fwd[k] = Math.sin(a) * rr;
        v.w[k] = 0.55 + W.hash01(v.seed, k + 256, 61) * 0.7;   // sway rate, rad/s
        v.p[k] = W.hash01(v.seed, k + 384, 71) * TAU;          // sway phase
      }
    }
    const want = clamp(spd / BAND_SPEED, 0, 1);
    v.march += (want - v.march) * Math.min(1, dt * 1.6);
    return v;
  }
  /* Place man k of a formation in the world. Writes _fp. */
  const _fp = { x: 0, z: 0, yaw: 0 };
  function formPos(v, k, bx, bz, yaw, size, spread, t) {
    const m = v.march;
    const st = 1 + 0.95 * m;                 // stretch along the march
    const sq = 1 - 0.40 * m;                 // narrow across it
    const drop = -(0.9 + Math.sqrt(size) * 0.25) * m;   // the file trails the banner
    const sway = 0.28 * (1 - 0.5 * m);
    const jl = Math.sin(t * v.w[k] + v.p[k]) * sway;
    const jf = Math.sin(t * v.w[k] * 0.83 + v.p[k] * 1.7) * sway;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const lo = (v.lat[k] * sq + jl) * spread;
    const fo = (v.fwd[k] * st + drop + jf) * spread;
    _fp.x = bx + fz * lo + fx * fo;
    _fp.z = bz - fx * lo + fz * fo;
    /* THE PER-MAN FACING OFFSET IS CONSTANT, not scaled by `march`. Scaling it
       means every man's heading moves whenever the party's speed changes, and
       a heading that drifts because somebody slowed down is a heading that is
       lying about what the body is doing. */
    _fp.yaw = yaw + (v.p[k] / TAU - 0.5) * 0.45;
    return _fp;
  }

  /* ---- the pool. 48 bodies, built one per frame, recycled forever ---- */
  const rigSlots = [];
  const rigByKey = Object.create(null);
  let rigsBuilt = 0, rigsShown = 0, rigsDressed = 0;

  function buildSlot() {
    if (!CBZ.studio || !CBZ.studio.cast) return null;
    /* CAST ONCE AS A GENERIC SOLDIER AND DRESS AFTERWARDS. W.outfits.cast
       builds AND paints; this pool only ever needs the building half, because
       every man who lands in the slot re-dresses it anyway. `variant` is what
       gives the pool its faces and hair, and it is fixed per SLOT rather than
       per man on purpose: it costs a rebuild to change, and forty-eight
       different heads is already more variety than a column at 40 m shows. */
    const g = CBZ.studio.cast("soldier", { variant: rigsBuilt * 2 + 1 });
    if (!g) return null;
    g.visible = false;
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    root.add(g);
    const ch = g.userData.charRig;
    const face = [];
    if (ch && ch.face) for (const k in ch.face) if (ch.face[k]) face.push(ch.face[k]);
    const slot = { rig: g, char: ch, face: face, faceOn: true, key: null, fit: null, animF: rigsBuilt & 3,
                   spdKey: null, px: 0, pz: 0, spd: 0 };
    rigSlots.push(slot);
    rigsBuilt++;
    return slot;
  }

  function releaseSlot(slot) {
    if (slot.key != null) delete rigByKey[slot.key];
    slot.key = null;
    slot.rig.visible = false;
  }

  function fitKeyOf(m) {
    return m.s ? ("s" + m.s.id + "/" + (m.band ? m.band.id : "-")) : ("c" + m.body);
  }

  /* WHO GETS A BODY. Nearest to the CAMERA wins — not nearest to the player,
     and not "your men first". A distance ring is the only allocation rule
     that cannot produce the thing it exists to prevent: two men standing
     shoulder to shoulder, one a rig and one a box. Your column usually wins
     it anyway, because the camera is behind you looking at it. */
  function assignRigs(dt) {
    rigsShown = 0; rigsDressed = 0;
    if (FLAG_MEN_OLD) return;
    const cam = camera.position;
    nearIdx.length = 0;
    for (let i = 0; i < menDrawN; i++) {
      const m = menDraw[i];
      const dx = m.x - cam.x, dy = m.y - cam.y, dz = m.z - cam.z;
      m.d2 = dx * dx + dy * dy + dz * dz;
      /* HYSTERESIS, AND IT IS NOT DECORATION. Without the 28 m gap a man
         parked on the boundary swaps form on every camera breath — the
         camera lerps, so his distance oscillates by metres with nothing
         moving — and a flickering man is worse than a permanently blocky
         one. In at 150, out at 178. */
      const lim = rigByKey[m.key] ? NEAR_OUT : NEAR_IN;
      if (m.d2 < lim * lim) nearIdx.push(i);
    }
    if (nearIdx.length > RIG_POOL) {
      nearIdx.sort(function (a, b) { return menDraw[a].d2 - menDraw[b].d2; });
      nearIdx.length = RIG_POOL;
    }
    for (const k in wantKey) delete wantKey[k];
    for (let i = 0; i < nearIdx.length; i++) wantKey[menDraw[nearIdx[i]].key] = 1;
    for (let i = 0; i < rigSlots.length; i++) {
      const s = rigSlots[i];
      if (s.key != null && !wantKey[s.key]) releaseSlot(s);
    }
    let builds = 0, dresses = 0;
    for (let i = 0; i < nearIdx.length; i++) {
      const m = menDraw[nearIdx[i]];
      let slot = rigByKey[m.key];
      if (!slot) {
        for (let j = 0; j < rigSlots.length && !slot; j++) if (rigSlots[j].key == null) slot = rigSlots[j];
        /* ONE BUILD PER FRAME. Measured: W.outfits.cast is 19.3 ms and
           studio.cast alone is most of it. Two in a frame is a visible
           hitch; the man rides as an impostor for the frame or two it takes
           his body to exist, which nobody has ever noticed and everybody
           would notice the stutter. */
        if (!slot && rigsBuilt < RIG_POOL && builds < RIG_BUILD_PER_FRAME) { slot = buildSlot(); builds++; }
        if (!slot) continue;
        slot.key = m.key; rigByKey[m.key] = slot; slot.fit = null;
      }
      const fk = fitKeyOf(m);
      if (slot.fit !== fk) {
        /* AND FOUR DRESSES. 0.52 ms each, so four is 2 ms — the budget for a
           camera swing that hands the whole pool to new men at once. Until a
           slot is dressed it stays hidden and its man draws as an impostor,
           because showing him would put the LAST man's uniform on him. */
        if (dresses >= RIG_DRESS_PER_FRAME) continue;
        let ok = false;
        if (m.s && W.outfits && W.outfits.dress) {
          try { W.outfits.dress(slot.rig, m.s, m.band || null); ok = true; } catch (e) { ok = false; }
        }
        if (!ok) continue;
        slot.fit = fk; dresses++; rigsDressed++;
      }
      m.rig = slot;
    }
    // ---- seat, scale, animate every man who got one ----
    for (let i = 0; i < nearIdx.length; i++) {
      const m = menDraw[nearIdx[i]];
      if (!m.rig) continue;
      placeRig(m, dt);
      rigsShown++;
    }
  }

  function placeRig(m, dt) {
    const slot = m.rig, g = slot.rig;
    g.visible = true;
    /* SEATED BY sand.js LIKE EVERY OTHER BODY IN THE GAME — on the surface
       that is actually DRAWN, leaning into the slope. NO `dt`, deliberately:
       passing it makes plant() stamp a footprint, and sand.js's own comment
       says why the column must not — "asking each of them to stamp prints
       would be sixty times the cost for a mark four pixels wide", so the
       column's ground record is laid off the PLAYER's path instead. The
       stance radius scales with the man because the size lie scales him. */
    if (W.sand && W.sand.plant) {
      W.sand.plant(g, m.x, m.z, m.yaw, { r: 0.5 * m.ms });
    } else {
      g.position.set(m.x, m.y, m.z);
      g.rotation.set(0, m.yaw, 0);
    }
    if (g.scale.x !== m.ms) g.scale.setScalar(m.ms);
    /* THE FACE IS FOUR DRAW CALLS AND IT IS SUB-PIXEL AT 26 m. Eyes, brow
       and mouth off entities/npc.js's own LOD pattern (n.char.detail); the
       hair and the cap are deliberately NOT touched, because the head is the
       colour that carries a man's tier at every range and a bald frame would
       be a real visual change rather than a saving. */
    const wantFace = m.d2 < FACE_LOD * FACE_LOD;
    if (slot.faceOn !== wantFace) {
      slot.faceOn = wantFace;
      for (let i = 0; i < slot.face.length; i++) slot.face[i].visible = wantFace;
    }
    /* THE LEGS RUN AT THE SPEED THE BODY IS ACTUALLY MOVING AT, and that is
       not the same number the caller hands down. animChar advances the gait by
       DISTANCE (speed × dt ÷ stride), so feeding it a speed the body does not
       have is foot slide by construction, and foot slide is the classic
       "glitchy horde" tell. The column used to be fed the PLAYER's speed —
       fine while he rides in a straight line, wrong the moment the spacing
       damps, the trail bends, or he is mounted at 14 m/s while his men are
       sampled off a path he rode at 6. Differentiating the rig's own position
       makes the answer true for the column, the bands, the peers and anything
       added later, for two subtractions.

       Keyed to the SLOT, and reset when the slot changes hands: a pooled rig
       recycled to a man forty metres away would otherwise read as a single
       frame at 1200 m/s and spin his legs into a blur. */
    if (slot.spdKey !== slot.key) { slot.spdKey = slot.key; slot.px = m.x; slot.pz = m.z; slot.spd = m.spd || 0; }
    if (dt > 0) {
      const rdx = m.x - slot.px, rdz = m.z - slot.pz;
      const raw = Math.sqrt(rdx * rdx + rdz * rdz) / dt;
      /* Damped, because the trail sampler is continuous but the ground under
         it is not perfectly so and a one-frame spike would show as a hitched
         step — but only just: at rate 9 the filter itself lagged real speed
         changes enough to be the largest remaining term in the measured foot
         slide. 16 settles inside four frames and still swallows a spike. */
      slot.spd += (raw - slot.spd) * Math.min(1, dt * 16);
    }
    slot.px = m.x; slot.pz = m.z;
    if (CBZ.animChar && slot.char) {
      // battle.js's rate ladder, same reason: a gait resolved every fourth
      // frame at 95 m is indistinguishable from one resolved every frame.
      const every = m.d2 < ANIM_EVERY_1 * ANIM_EVERY_1 ? 1 : m.d2 < ANIM_EVERY_2 * ANIM_EVERY_2 ? 2 : 4;
      slot.animF = (slot.animF + 1) & 1023;
      if ((slot.animF % every) === 0) {
        try { CBZ.animChar(slot.char, slot.spd, dt * every); } catch (e) {}
      }
    }
  }

  /* ============================================================ THE DRAW */
  /* WHAT THE MEN COST, PUBLISHED. This function is the most expensive
     per-frame loop on the game's main screen and the whole LOD is a trade
     against it, so the trade should not have to be re-measured by hand every
     time somebody touches it. An EMA of its own wall time, two performance.now
     calls a frame, readable from audit() and from the before/after preset. */
  let menMs = 0, folkShown = 0;
  function drawMen(dt) {
    const _t0 = performance.now();
    menDrawN = 0;
    const D = W.desert;
    const army = S.army;
    const cam = camera.position;
    const drawN = FLAG_NOTRAIL ? 0 : Math.min(DRAWN_FOLLOWERS, army.length);
    const t = micro.elapsed;
    /* THE COLUMN'S OWN SCALE, for the spacing rules only. Every man is drawn
       at manScale(his own distance) — see the note on the size lie — but the
       gap between men and the width of the cluster have to be decided ONCE
       for the whole column or it fans out with distance. The column sits
       about camDist from the eye by construction (the camera is behind him,
       along the same axis the trail runs down), so that is the number. */
    const colMs = manScale(camDist);
    const spread = 1 + (colMs - 1) * 0.5;
    /* THE COLUMN FITS THE PATH YOU HAVE ACTUALLY RIDDEN. Fixed spacing looks
       right after a long ride and piles the whole army on one breadcrumb in
       the first thirty seconds of a game — which is exactly when the player
       is looking hardest at their new men. Spacing is the ideal, capped by
       what the trail can actually carry. */
    /* THE ARC ACTUALLY KEPT, not the total ridden. TRAIL_MAX crumbs are held
       and the rest are shifted off the front, so after a long ride the path
       under the column is ~670 m however far he has come; measuring `avail`
       off the total would run the tail man off the end of the polyline and
       pile the back half of the column on the oldest crumb. */
    const avail = Math.max(8, trailHead() - (breadcrumbs.length ? breadcrumbs[0].s : 0) - 4);
    /* AND THE COLUMN MUST FIT IN FRONT OF THE CAMERA. The camera sits behind
       him along the same axis the trail runs down, so a column longer than
       the camera is far back has its tail level with — or behind — the eye,
       and the army pair came back twice with half the men off the bottom
       edge. Capped at 40% of the pull-back: at 150 m that is a 60 m column
       whose last man sits comfortably inside the lower third. Packing them
       tighter also reads as MORE men, which is the direction this shot
       wants to be wrong in. */
    /* AND THE FLOOR IS A BODY. That 40% cap was tuned when a man was a cone —
       a cone has no depth and no arms, so forty of them at 0.62 m spacing read
       as a dense column rather than as forty objects inside each other. A rig
       measures 0.67 m front to back and 1.08 m across; below about 1.15 m of
       spacing the near band photographs as a single writhing mass with heads
       on it, which is what the first column pair came back looking like.
       Floor it at a body's length and let the tail run past the bottom edge
       when the camera is very close — a man walking out of frame behind you is
       what actually happens when you are stood among your own men. */
    /* AND THE GAP ITSELF IS DAMPED. Every term above it steps: `avail` grows
       by a whole crumb the frame a crumb is pushed, and camDist lerps through
       a zoom. `back` is i × gap, so a 1.6 m step in `avail` moved the SIXTIETH
       man 1.6 m in one frame even after the sampler was made continuous — the
       column concertina'd every time the trail grew. Damped at rate 2.5 the
       whole column breathes into a new spacing over about a second, which is
       what men closing up actually looks like. */
    const gapWant = Math.max(1.15, Math.min(2.15 * spread, avail / Math.max(1, drawN),
                             (camDist * 0.40) / Math.max(1, drawN)));
    gapCur = gapCur > 0 ? gapCur + (gapWant - gapCur) * Math.min(1, dt * 2.5) : gapWant;
    const gap = gapCur;
    trailCur = breadcrumbs.length - 2;
    for (let i = 0; i < drawN; i++) {
      const back = 4 + i * gap;                        // metres behind you
      const c = sampleTrail(back);
      /* THE OFFSET RIDES THE PATH FRAME, not the world axes. It used to be a
         fixed ±3.5 m on world X and ±1.5 on world Z, which meant the column
         was seven metres wide riding north and three metres wide riding east,
         and a bend in the trail slid the whole formation sideways instead of
         bending it. Off the local tangent it is a column: 2.2 m of lane and a
         metre and a half of stagger down the line, whatever the heading. */
      const nx = c.tz, nz = -c.tx;                     // path normal (left)
      /* AND THE LANE IS LOW-DISCREPANCY IN i, not hashed. A hashed offset puts
         man 12 and man 13 in the same lane about a fifth of the time, and two
         men a metre apart down the trail in the same lane are one man with two
         heads. The radical inverse guarantees consecutive followers are on
         opposite sides of the track; the hash only jitters within the lane so
         it does not read as a marching band. */
      const lane = (radInv2(i + 1) - 0.5) + (W.hash01(i * 31 + 7, 3, 21) - 0.5) * 0.22;
      const lat = lane * 4.4 * (1 + (spread - 1) * 0.7);
      const lon = (W.hash01(i * 17 + 5, 9, 23) - 0.5) * 1.5;
      const x = c.x + nx * lat + c.tx * lon, z = c.z + nz * lat + c.tz * lon;
      const dx = x - cam.x, dz = z - cam.z;
      const ms = manScale(Math.sqrt(dx * dx + dz * dz));
      const y = manGroundY(x, z, dx * dx + dz * dz);
      const bob = Math.sin(t * 5.2 + i * 1.7) * 0.055;
      /* AND HE FACES THE WAY THE TRAIL GOES, not the way YOU are facing. The
         old line was `S.you.yaw + jitter` for all sixty: turn the head of the
         column ninety degrees and every man on the island snapped ninety
         degrees with him while still walking down the old path — a snake whose
         whole body rotates at once. The tangent is per-man and it is what
         makes the column read as bending through the wadi. */
      const yaw = Math.atan2(c.tx, c.tz) + (W.hash01(i, 1, 27) - 0.5) * 0.5;
      /* THE COLUMN WEARS WHAT THE BATTLE WILL DRESS IT IN. A man near the
         camera is a real rig wearing his real fit; a man past the near band
         is two instance colours off the SAME record — outfits.marks() answers
         off the same fit battle.js hands to studio.cast — so the green
         militiaman in your column is a green militiaman when the fight
         starts and is the same green at both LODs. */
      pushMan("a" + army[i].id, x, z, y, yaw, bob, ms, markOf(army[i], null), army[i], null, youSpeed);
      if (menDrawN >= MEN_CAP) break;
    }
    /* NEAREST PARTY FIRST, and it is not cosmetic: MEN_CAP is a real budget
       and it used to be spent in S.bands order, so a party a kilometre away
       could take the last slots and the one you are standing in front of got
       nothing. Sorting an array of at most a few dozen indices by camera
       distance costs microseconds and makes the cap spend itself on what is
       actually in the shot. */
    bandOrder.length = 0;
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      if (!b || b.x == null) continue;
      const bqx = b.x - S.you.x, bqz = b.z - S.you.z;
      const d = Math.sqrt(bqx * bqx + bqz * bqz);
      if (d > BAND_DRAW) continue;
      bandOrder.push(i);
      bandDist[i] = d;
    }
    bandOrder.sort(byBandDist);
    // ---- every band close enough to see -------------------------------
    let bn = 0;
    for (let oi = 0; oi < bandOrder.length && menDrawN < MEN_CAP - 20; oi++) {
      const i = bandOrder[oi];
      const b = S.bands[i];
      const d = bandDist[i];
      const size = W.bandSize(b);
      const bdx = b.x - cam.x, bdz = b.z - cam.z;
      const bcd = Math.sqrt(bdx * bdx + bdz * bdz);
      const show = bandShow(size, bcd);
      const bms = manScale(bcd);
      const bspread = 1 + (bms - 1) * 0.5;
      // a camped or paused party stands still; stepBands publishes the number
      const bspd = b.spd == null ? 0 : b.spd;
      const bv = bandForm(b, size, bspd, dt);
      for (let k = 0; k < show && menDrawN < MEN_CAP; k++) {
        const f = formPos(bv, k, b.x, b.z, b.yaw, size, bspread, t);
        const x = f.x, z = f.z;
        const dx = x - cam.x, dz = z - cam.z, d2 = dx * dx + dz * dz;
        const y = manGroundY(x, z, d2);
        const bob = Math.sin(micro.elapsed * 4.6 + k * 2.1 + i) * 0.05;
        /* THE BAND'S OWN ROSTER, not one flat hex for all fourteen. core
           builds `men` up front precisely because the battle puts THOSE men
           on the sand, so the party you are looking at can show its tiers —
           the veteran in the helmet next to the bare-headed levy — instead of
           fourteen identical specks in the faction colour. The banner already
           carries "which army is that" at any range. */
        const s = (b.men && b.men[k]) || null;
        pushMan("b" + b.id + ":" + k, x, z, y, f.yaw, bob, manScale(Math.sqrt(d2)),
                s ? markOf(s, b) : flatMark(b.colour, 0xc79a63), s, b, bspd);
      }
      if (bn < 160) bn = party(bn, b.x, b.z, size, b.colour, b.yaw);
    }
    /* OTHER WARLORDS ARE PARTIES, not a special case. They come off
       W.state.peers — the contract's own home for them — and go through the
       exact same LOD, the exact same banner and (see peerMan) the exact same
       uniform painter an AI band uses, so a human column and a computer
       column are the same object on screen and neither can drift into looking
       "more real" than the other. warnet.js keeps the map up to date and
       never draws anything. */
    peerDraw.length = 0;
    for (const pid in S.peers) {
      const q = S.peers[pid];
      if (!q || q.x == null) continue;
      const d = Math.hypot(q.x - S.you.x, q.z - S.you.z);
      peerDraw.push({ x: q.x, z: q.z, d: d, name: q.name || "WARLORD", size: q.size || 1, colour: q.colour == null ? 0xd8d0c0 : q.colour });
      if (d > BAND_DRAW || menDrawN >= MEN_CAP - 20) continue;
      const size = Math.max(1, q.size || 1);
      const pdx = q.x - cam.x, pdz = q.z - cam.z;
      const pcd = Math.sqrt(pdx * pdx + pdz * pdz);
      const show = bandShow(size, pcd);
      const yaw = q.yaw || 0;
      const pspread = 1 + (manScale(pcd) - 1) * 0.5;
      const pb = peerBand(pid);
      /* A PEER'S SPEED IS MEASURED, NOT DECLARED. The wire carries {x,z} and
         nothing else about how fast the other warlord is riding, and the old
         code just told the gait "1.6 m/s" forever — a warlord galloping past
         at eight metres a second walking at a stroll. Differentiate his own
         position on the render-side band record (never on S.peers, which is
         the wire's) and damp it, because snapshots arrive in lumps. */
      if (pb.px != null && dt > 0) {
        const raw = Math.hypot(q.x - pb.px, q.z - pb.pz) / dt;
        pb.spd = (pb.spd == null ? raw : pb.spd + (raw - pb.spd) * Math.min(1, dt * 4));
      }
      pb.px = q.x; pb.pz = q.z;
      const pspd = pb.spd || 0;
      const pv = bandForm(pb, size, pspd, dt);
      for (let k = 0; k < show && menDrawN < MEN_CAP; k++) {
        const f = formPos(pv, k, q.x, q.z, yaw, size, pspread, t);
        const x = f.x, z = f.z;
        const dx = x - cam.x, dz = z - cam.z, d2 = dx * dx + dz * dz;
        const s = peerMan(pid, k);
        pushMan("p" + pid + ":" + k, x, z, manGroundY(x, z, d2), f.yaw, 0, manScale(Math.sqrt(d2)),
                markOf(s, pb), s, pb, pspd);
      }
      if (bn < 160) bn = party(bn, q.x, q.z, size, q.colour, yaw);
    }

    /* ---- and the people standing at the outposts --------------------
       LAST INTO THE LIST AND THAT IS DELIBERATE. assignRigs allocates the
       48 bodies purely on distance to the CAMERA, so where a man is pushed
       from cannot change whether he gets one — a trader two metres away
       beats the whole column whatever order he arrived in. Being last only
       decides who is dropped at MEN_CAP, and losing the last men in a
       thousand-body field is the right thing to lose. */
    folkShown = drawFolk();

    // ---- hand out the bodies, then instance whoever did not get one ----
    assignRigs(dt);

    let n = 0;
    for (let i = 0; i < menDrawN; i++) {
      const m = menDraw[i];
      if (m.rig) continue;
      /* THE IMPOSTOR'S ORIGIN IS AT ITS FEET, so one matrix seats both the
         body and the head and neither can drift from the other or from the
         rig. The bob is the only motion a merged instance can carry — legs
         cannot swing inside a shared buffer — and at 150 m a stride is three
         pixels wide, so it buys nothing a vertical breath does not. */
      n = instMan(n, m.x, m.y + m.bob * m.ms, m.z, m.yaw, m.ms, m.body, m.legs, m.head);
    }
    menBody.count = menHead.count = n;
    menBody.instanceMatrix.needsUpdate = menHead.instanceMatrix.needsUpdate = true;
    if (menBody.instanceColor) menBody.instanceColor.needsUpdate = true;
    if (menHead.instanceColor) menHead.instanceColor.needsUpdate = true;
    if (menCap) {
      menCap.count = menLegs.count = n;
      menCap.instanceMatrix.needsUpdate = menLegs.instanceMatrix.needsUpdate = true;
      if (menCap.instanceColor) menCap.instanceColor.needsUpdate = true;
      if (menLegs.instanceColor) menLegs.instanceColor.needsUpdate = true;
    }
    pole.count = bn; banner.count = bn;
    pole.instanceMatrix.needsUpdate = banner.instanceMatrix.needsUpdate = true;
    if (banner.instanceColor) banner.instanceColor.needsUpdate = true;
    menMs = menMs * 0.9 + (performance.now() - _t0) * 0.1;
  }

  /* ONE MATRIX, TWO MESHES. The body and the head are separate InstancedMeshes
     only because they are separate COLOURS; they share a transform, so compose
     it once. (The cone's two halves each carried their own hand-typed vertical
     offset and a separate compose, which is how the head ended up 1.48 m up a
     body that had been scaled by 3.2.) */
  function instMan(n, x, y, z, yaw, ms, bodyCol, legCol, headCol) {
    if (n >= MEN_CAP) return n;
    if (FLAG_MEN_OLD) {
      // the cone's own offsets, byte for byte, so ?men=old is a real revert
      inst(menBody, n, x, y + 0.65 * ms, z, yaw, ms, ms, ms, bodyCol);
      inst(menHead, n, x, y + 1.48 * ms, z, yaw, ms, ms, ms, headCol);
      return n + 1;
    }
    _e.set(0, yaw, 0); _q.setFromEuler(_e);
    _p3.set(x, y, z); _s3.set(ms, ms, ms);
    _m4.compose(_p3, _q, _s3);
    menBody.setMatrixAt(n, _m4);
    menLegs.setMatrixAt(n, _m4);
    menHead.setMatrixAt(n, _m4);
    menCap.setMatrixAt(n, _m4);
    if (menBody.setColorAt) { _col.setHex(bodyCol); menBody.setColorAt(n, _col); }
    if (menLegs.setColorAt) { _col.setHex(legCol); menLegs.setColorAt(n, _col); }
    if (menCap.setColorAt) { _col.setHex(headCol); menCap.setColorAt(n, _col); }
    return n + 1;
  }

  /* ONE BANNER RULE for AI bands, peers and anything else that is a party:
     height and flag scale with log2(head count), so six men and two hundred
     are tellable apart at strategic zoom without a 120 m pole. */
  function party(bn, x, z, size, colour, yaw) {
    const ph = 5 + 2.6 * Math.log(size + 1) / Math.LN2;
    const fw = 1.6 + 0.9 * Math.log(size + 1) / Math.LN2;
    const by = W.desert.heightAt(x, z);
    bn = inst(pole, bn, x, by + ph / 2, z, 0, 1, ph, 1, null);
    inst(banner, bn - 1, x + 0.12, by + ph - fw * 0.42, z, (yaw || 0) * 0.3, fw, fw * 0.62, 1, colour);
    return bn;
  }

  /* THE SCUFF LIVES FOR ITS OWN SECOND, not for the length of the ride.
     The old marker's visibility was tied to `dest`, so it pulsed on screen
     for the entire journey — that is what made it furniture. Now the tap
     starts a clock and the puff spreads and fades on that clock alone; the
     destination can outlive it by four minutes and nothing is drawn. */
  const MARKER_LIFE = 0.95;
  function drawMarker(dt) {
    if (!marker) return;
    if (MARKER_OLD) {
      marker.visible = !!dest;
      if (!dest) return;
      markerT += dt;
      const y = W.desert.heightAt(dest.x, dest.z);
      marker.position.set(dest.x, y + 0.25, dest.z);
      const p = 1 + Math.sin(markerT * 3.4) * 0.16;
      marker.scale.set(p, 1, p);
      return;
    }
    markerT += dt;
    const t = markerT / MARKER_LIFE;
    if (t >= 1) { marker.visible = false; return; }
    marker.visible = true;
    // spreads as it settles, and thins out — sand does not pulse
    const spread = 0.75 + t * 0.9;
    marker.scale.set(spread, 1, spread);
    for (let i = 0; i < marker.children.length; i++) {
      const m = marker.children[i].material;
      if (m) m.opacity = (i ? 0.34 : 0.5) * (1 - t) * (1 - t);
    }
  }
  // the tap RESTARTS the clock and parks the puff — called where dest is set
  function markAt(x, z) {
    if (!marker) return;
    markerT = 0;
    marker.position.set(x, W.desert.heightAt(x, z) + 0.03, z);
    marker.visible = true;
  }

  /* ============================================================ THE CAMERA
     Behind and above, and the distance is the only thing the player tunes.
     PITCH IS DERIVED FROM DISTANCE rather than being a second control: at
     16 m you are over his shoulder with the horizon in shot, at 500 m you
     are looking down at a valley full of parties. Two sliders for one
     intention is how a simple game stops being simple. */
  function updateCamera(dt) {
    camDist = lerp(camDist, camDistWant, Math.min(1, dt * 5));
    const t = clamp((camDist - 16) / (520 - 16), 0, 1);
    /* THE FIRST DRAFT'S PITCH CURVE WAS TOO FLAT ALL THE WAY UP. At 95 m it
       gave 21° above horizontal, which points the camera ALONG a dune's
       windward face — the erg pair came back with the bottom two-thirds of
       the frame as one featureless slope while the ranks of dunes it was
       supposed to be showing sat squashed into a strip near the horizon.
       0.26→0.90 over pow(0.62) is 22° over the shoulder (still a rider's
       view, still shows the sky) and 38° by the time you have pulled back
       far enough to be reading the ground as a map. */
    const pitch = lerp(0.26, 0.90, Math.pow(t, 0.62));
    const D = W.desert;
    const gy = D.heightAt(S.you.x, S.you.z);
    const back = Math.cos(pitch) * camDist;
    const up = Math.sin(pitch) * camDist;
    const cx = S.you.x - Math.sin(camYaw) * back;
    const cz = S.you.z - Math.cos(camYaw) * back;
    let cy = gy + up + 2.2;
    /* NEVER INSIDE THE GROUND. A dune between you and the camera used to
       swallow it whole; keeping the eye a clear 3 m above whatever is
       under it costs one heightAt and fixes every case. */
    cy = Math.max(cy, D.heightAt(cx, cz) + 3.0);
    /* THE NEAR PLANE IS THE FAR WATER'S PROBLEM. micro.boot ships near=0.35,
       which is right for a page where you can walk into a wall. Here the
       nearest thing to the eye is a man 16 m away and the FURTHEST is a
       coastline 12 km away, and at near=0.35/far=16000 the depth buffer has
       ~11 m of resolution out there — the sea and the sea bed traded pixels
       in stripes across the whole horizon. near=2.2 is five times the
       precision for nothing the player can ever see. */
    if (camera.near !== 2.2) { camera.near = 2.2; camera.updateProjectionMatrix(); }
    camera.position.set(cx, cy, cz);
    /* LOOK AHEAD WHEN RIDING, LOOK AT HIM WHEN LOOKING AT HIM. Look-ahead
       used to GROW with the pull-back, which is exactly backwards: at
       strategic zoom the thing you pulled back to see is your own column,
       and it trails BEHIND him — the army pair came back with the far half
       of the column off the bottom of the frame. Close in it is a riding
       camera and leads him; pulled back it centres on him and the trail
       lies across the lower third where you can count it. */
    const la = 0.30 - t * 0.80;
    camera.lookAt(
      S.you.x + Math.sin(camYaw) * camDist * la,
      gy + 1.4 + camDist * 0.06,
      S.you.z + Math.cos(camYaw) * camDist * la);
    /* PUBLISH THE ZOOM. territory.js is building an openfront-style ownership
       map over this same island, and the pull-back and that map have to feel
       like one view at two ranges rather than two separate screens. So the
       camera's strategic-ness is a number anybody can read, and it is emitted
       on a real change rather than sixty times a second. */
    if (Math.abs(camDist - lastZoomSent) > camDist * 0.06) {
      lastZoomSent = camDist;
      W.emit("campaign:zoom", { dist: camDist, t: t, yaw: camYaw, x: S.you.x, z: S.you.z });
    }
    // the sky dome is centred on the origin and the island is 16 km wide;
    // ride far enough and you can reach its wall. Carry it with you.
    if (micro.skyDome) micro.skyDome.position.set(cx, 0, cz);
  }

  /* ============================================================ THE BANDS */
  /* A BAND OFF THE WIRE HAS NONE OF THIS FILE'S FIELDS ON IT. core.makeBand
     declares the party; the goal, the memory of losing to you, the heading
     and the AI stagger are CAMPAIGN facts this file adds. In multiplayer the
     host's bands arrive as plain state, so normalise on the way in rather
     than trusting that everything in S.bands was minted here. */
  function ensureBandFields(b) {
    if (b.yaw == null) b.yaw = W.hash01(b.x, b.z, 5) * TAU;
    if (b.scared == null) b.scared = 0;
    if (b.think == null) b.think = W.hash01(b.x, b.z, 6) * 1.6;
    if (b.pause == null) b.pause = 0;
    if (b.cooldown == null) b.cooldown = 0;
    if (!b.goal && C.simHost) pickGoal(b);
    return b;
  }

  /* ============================================================ THE FAR CLOCK
     A PARTY YOU CANNOT SEE DOES NOT NEED SIXTY POSITION UPDATES A SECOND, AND
     THAT IS WHY THE ISLAND COULD ONLY HOLD NINETY-SIX ARMIES.

     Every party on the map was integrated every frame, and the integration is
     not cheap: the movement step alone asks desert.js for a height at the
     party's feet, a height at the point it wants to step to, and D.onLand
     there (which is a coastAt plus another heightAt), then one more heightAt
     to seat it. desert.js's own comment calls heightAt "the hot path in the
     file" — roughly fifty hashes a call. So one party costs about five of
     those per frame, and the whole island's population multiplies it.

     THE STEP IS NOT MADE COARSER. A far party still walks the same route at
     the same speed and arrives at the same time; it is integrated in 0.6 s
     chunks instead of 0.016 s ones, and the accumulator hands the whole
     elapsed time over so no motion is lost. Everything the step reads —
     the slope gate, the land test, the goal arrival — scales with its own dt
     and was already written to be substepped, because the catch-up path in
     worldTick has been feeding this function 0.25 s steps since the speed
     slider landed. This is that same path, chosen by distance instead of by
     how long the tab was hidden.

     WHY 0.6 s AND WHY ONLY OUTSIDE BAND_DRAW. Inside BAND_DRAW the party is
     DRAWN, and a drawn party moving in hops reads as lag — that is exactly
     the mistake worldTick's own comment records ("1.5 m hops four times a
     second, which reads as lag, not as walking"), so nothing visible is ever
     stepped coarsely. Outside it the only requirement is that the party not
     JUMP a piece of terrain the slope gate was supposed to stop it at, so the
     interval is a distance budget: FAR_JUMP metres divided by the fastest a
     party can walk. Five metres on a thirteen-kilometre island is under half
     a party's own frontage, and the party is at least 1.5 km away.

     MEASURED with tools/warlord-scale-check.mjs --island, 676 parties on the
     island, same seed, same machine, back to back: the campaign frame is
     1.50 ms with ?far=old and 0.50 ms without it. Three times cheaper at seven
     times the population — which is the whole reason the population could
     move. At 3 580 parties (?bands=600) it is still 0.60 ms, so past this
     point the frame is simply not the ceiling any more; the SAVE is, and
     smallTarget() says so. */
  const FAR_JUMP = 5;                       // metres a hidden party may cover in one step
  const FAR_STRIDE = FAR_JUMP / HUNT_SPEED; // = 0.60 s
  /* `wdt` IS THE WALL STEP AND `dt` IS THIS PARTY'S STEP, and they are two
     different numbers now. Naming them apart rather than reassigning the
     parameter is not style: the parameter is read on every iteration of the
     loop, so a far party that overwrote it would hand its own 0.6 s to every
     party after it in the array — a bug that would look like the island
     randomly running at ten times speed depending on where you stood. */
  /* `pass` — 0 is every party (the normal frame, one call, nothing skipped),
     1 is the NEAR parties only and 2 is the FAR ones plus the world events.
     Only worldTick's catch-up path uses 1 and 2; see it for why. */
  function stepBands(wdt, myPower, pass) {
    const D = W.desert;
    if (myPower == null) myPower = W.yourPower();
    const yx = S.you.x, yz = S.you.z;
    for (let i = 0; i < S.bands.length; i++) {
      const b = ensureBandFields(S.bands[i]);
      const dxp = yx - b.x, dzp = yz - b.z;
      const dp = Math.hypot(dxp, dzp);
      const far = !FLAG_FAR_OLD && dp > BAND_DRAW;
      // the split pass: skip the half this call is not for, before any work
      if (pass === 1 && far) continue;
      if (pass === 2 && !far) continue;
      if (b.cooldown > 0) b.cooldown -= wdt;
      /* THE GATE, asked before the guest branch as well: a guest renders the
         host's parties and its only job here is to keep the DRAWN ones' heights
         honest, which is the same question. */
      let dt = wdt;
      if (far) {
        b.acc = (b.acc || 0) + wdt;
        if (b.acc < FAR_STRIDE) continue;
        dt = b.acc; b.acc = 0;
      } else if (b.acc) b.acc = 0;
      /* A GUEST NEVER MOVES A BAND. It renders the host's, keeps their
         cooldowns ticking (that is local courtesy, not authority) and stops.
         Every line below this one is an act of authorship. */
      if (!C.simHost) { b.y = D.heightAt(b.x, b.z); continue; }

      // ---- think, staggered so sixty parties never think on one frame ---
      b.think -= dt;
      if (b.think <= 0) {
        b.think = 1.1 + W.hash01(b.x, b.z, 3) * 0.9;
        if (!FLAG_NOBANDAI && dp < 1100 && b.cooldown <= 0) {
          const theirs = W.bandPower(b);
          /* THE ARCHETYPE'S APPETITE, NOT THE FACTION'S. A SALT CARAVAN and a
             RAIDING CREW can share a faction row (and therefore a colour and a
             tier table) and still want completely different things from you.
             W.bandHostile falls through to the faction for every party that
             never overrode it, which is all of the big ones. */
          const hostile = W.bandHostile(b);
          /* THE ONE DECISION A PARTY MAKES: can I take him. Power, not head
             count — core's soldierPower already knows that forty levies with
             pistols are weaker than fifteen veterans with rifles. `scared`
             is memory: a band you have already broken keeps its distance,
             which is what makes clearing an area MEAN something. */
          const edge = theirs / Math.max(0.001, myPower);
          if (edge > 1.15 + b.scared * 0.9 && W.rnd() < hostile) b.mood = "hunt";
          else if (edge < 0.55 || b.scared > 1) b.mood = "flee";
          else if (b.mood !== "camp") b.mood = "roam";
        } else if (b.mood === "hunt" || b.mood === "flee") {
          b.mood = "roam";
        }
      }

      // ---- where is it walking ------------------------------------------
      let tx, tz, sp = BAND_SPEED;
      if (b.mood === "hunt") { tx = S.you.x; tz = S.you.z; sp = HUNT_SPEED; }
      else if (b.mood === "flee") { tx = b.x - dxp; tz = b.z - dzp; sp = HUNT_SPEED * 0.92; }
      else {
        if (!b.goal) pickGoal(b);
        tx = b.goal.x; tz = b.goal.z;
        if (b.pause > 0) { b.pause -= dt; sp = 0; }
      }
      const dx = tx - b.x, dz = tz - b.z;
      const d = Math.hypot(dx, dz);
      /* WHAT SPEED IS THIS PARTY WALKING AT. The near band drives real gaits
         off it (CBZ.animChar takes m/s), and a camped party whose men are
         marching on the spot is the tell that the animation is decoration
         rather than the sim. One assignment; the AI above already solved it. */
      b.spd = (sp > 0 && d > 2) ? sp : 0;
      if (sp > 0 && d > 2) {
        let ux = dx / d, uz = dz / d;
        const nx = b.x + ux * sp * dt, nz = b.z + uz * sp * dt;
        /* THEY DO NOT WALK INTO THE SEA OR UP A MESA WALL. One probe, and
           on a refusal they turn rather than stop — a party frozen against
           a cliff for ten minutes is the most obvious "this is a simulation
           and it is broken" tell there is. */
        if (D.onLand(nx, nz) && Math.abs(D.heightAt(nx, nz) - D.heightAt(b.x, b.z)) < sp * dt * 1.6) {
          b.x = nx; b.z = nz;
        } else {
          const turn = (W.hash01(b.x, b.z, 9) < 0.5 ? 1 : -1) * 0.9;
          const a = Math.atan2(ux, uz) + turn;
          ux = Math.sin(a); uz = Math.cos(a);
          const ax = b.x + ux * sp * dt, az = b.z + uz * sp * dt;
          if (D.onLand(ax, az)) { b.x = ax; b.z = az; }
          else if (b.mood === "roam") pickGoal(b);
        }
        const wy = Math.atan2(ux, uz);
        let dy = wy - b.yaw;
        while (dy > Math.PI) dy -= TAU;
        while (dy < -Math.PI) dy += TAU;
        b.yaw += dy * Math.min(1, dt * 2.4);
      } else if (b.mood === "roam" && d <= 2) {
        // arrived: sit a while, then go somewhere else. A world where
        // everybody is always in transit has no places in it.
        b.pause = 6 + W.rnd() * 22;
        if (b.pause > 20) b.mood = "camp";
        pickGoal(b);
      }
      if (b.mood === "camp" && b.pause <= 0) b.mood = "roam";
      b.y = D.heightAt(b.x, b.z);
    }

    /* ---- THE WORLD EVENTS RUN ONCE PER FRAME, NEVER PER SUBSTEP ---------
       Both of the blocks below are O(parties) and neither is an integrator, so
       a catch-up frame that calls this function thirty-two times must not run
       them thirty-two times over. Pass 1 is the near-party integration pass
       and skips them; pass 0 (a normal frame) and pass 2 (the once-per-frame
       far pass) carry the whole elapsed dt, so their rate in GAME time is
       exactly what it was. */
    if (pass === 1) return;

    /* ---- they fight EACH OTHER, off screen, resolved abstractly ---------
       THE RATE IS PER PARTY, NOT PER SECOND, and a fixed interval was hiding
       that. resolveOneBandFight() picks ONE random party per tick, so the rate
       any GIVEN party gets into a fight is 2/n per tick — which means the
       moment the island went from 96 parties to 677 the same 4.5 s tick made
       every party's history run seven times slower. The island would have had
       more armies on it and less happening to them, which is the opposite of
       what the population is for.

       FIGHT_EVERY is that per-party interval, and it is the OLD BEHAVIOUR's
       own number read back out of it: 96 parties at one resolve per 4.5 s is a
       given party fighting about every 216 s. Holding that constant reproduces
       today's island exactly at 96 and keeps it alive at 677.

       wdt, not dt: `dt` is the per-party step and does not exist out here. */
    const FIGHT_EVERY = 216;
    fightTick += wdt;
    if (C.simHost && fightTick > FIGHT_EVERY * 2 / Math.max(2, S.bands.length)) {
      fightTick = 0;
      resolveOneBandFight();
    }
    // ---- the island never empties ---------------------------------------
    spawnTick += wdt;
    if (C.simHost && spawnTick > 9) {
      spawnTick = 0;
      /* TWO POPULATIONS, COUNTED SEPARATELY. One target for both would let the
         small parties — which die far faster, because a five-man crew standing
         near a legion is deleted by the first abstract fight it loses — be
         "replaced" by another two-hundred-man army, and the island would drift
         back to nothing but massive ones over an hour of play. The deficit is
         per tier and the small tier is refilled first for the same reason. */
      let nBig = 0, nSmall = 0;
      for (let i = 0; i < S.bands.length; i++) (S.bands[i].kind ? nSmall++ : nBig++);
      const wantBig = bandTarget(), wantSmall = smallTarget();
      /* THE REFILL RATE FOLLOWS THE DEFICIT, because a fixed one does not
         scale and this population is seven times what it was.

         It was one party per nine seconds, then two. Against forty parties
         that is a replacement every four and a half minutes for something that
         dies every few minutes — fine. Against six hundred and seventy-eight,
         with a bottom tier that churns fast (a five-man crew is deleted by the
         first abstract fight it loses), two a tick is a leak the player
         experiences as the island slowly emptying over an hour, which is the
         precise opposite of what this whole change is for.

         A TENTH OF THE DEFICIT PER TICK is a first-order lag: whatever the
         shortfall is, it closes with a time constant of about ninety seconds
         however big the world is, and it never spawns a crowd in one frame.
         The ceiling of 12 is there because spawnBand rejection-samples a land
         point and each attempt is real work — beyond a dozen the tick itself
         becomes a frame spike, and the deficit will still be there in nine
         seconds. */
      const deficit = Math.max(0, wantSmall - nSmall) + Math.max(0, wantBig - nBig);
      const batch = Math.max(1, Math.min(12, Math.ceil(deficit * 0.1)));
      for (let k = 0; k < batch; k++) {
        const small = nSmall < wantSmall;
        if (!small && nBig >= wantBig) break;
        for (let g = 0; g < 30; g++) {
          const p = W.desert.landPoint(W.rnd, { maxSlope: 0.30 });
          if (Math.hypot(p.x - S.you.x, p.z - S.you.z) < 2200) continue;
          spawnBand({ at: p, small: small });
          if (small) nSmall++; else nBig++;
          break;
        }
      }
    }
  }

  /* A HUNDRED SIMULATED BATTLES A MINUTE IS NOT A WORLD, IT IS A HEATER.
     Two parties that meet resolve in one function: power decides it, the
     loser is destroyed or halved, the winner takes losses proportional to
     how close it was, and one line goes in the log. You find out the island
     has a history by reading it, which is exactly how Bannerlord does it. */
  /* Two parties are on the same side when the same warlord owns both, or —
     for the ownerless bandits, militia and caravans — when they share a
     faction. bandOwner() is territory.js's, added when the rival warlords
     became real people rather than three slots on a scoreboard. */
  function sameSide(a, b) {
    const T = W.territory;
    if (T && T.bandOwner) {
      const oa = T.bandOwner(a), ob = T.bandOwner(b);
      if (oa || ob) return oa === ob;
    }
    return a.faction === b.faction;
  }

  function resolveOneBandFight() {
    const n = S.bands.length;
    if (n < 2) return;
    const i = Math.floor(W.rnd() * n);
    const a = S.bands[i];
    let b = null, bd = 1e18;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const o = S.bands[k];
      /* WHO IS THIS PARTY'S ENEMY IS AN OWNERSHIP QUESTION, NOT A FACTION ONE.
         Every rival warlord's column carries faction "warlord" deliberately —
         that is what titles the encounter card RIVAL WARLORD instead of SAND
         BANDITS and dresses them out of the right outfits.js record — so a
         faction test made fourteen different warlords one army, and their
         columns walked through each other instead of fighting. territory.js
         knows who actually owns a column; ask it, and fall back to faction for
         the neutral parties that have no owner. */
      if (sameSide(a, o)) continue;
      const d = Math.hypot(o.x - a.x, o.z - a.z);
      if (d < bd) { bd = d; b = o; }
    }
    if (!b || bd > 220) return;
    const pa = W.bandPower(a), pb = W.bandPower(b);
    /* A LOOTER GANG DOES NOT FIGHT A LEGION, IT RUNS. Without this the island's
       small parties evaporate: the resolver picks a random party every 4.5 s,
       finds the nearest party of another faction inside 220 m and makes them
       fight to a conclusion regardless of the odds, and a five-man crew loses
       every one of those. It ran for a wipe on a matchup nobody in the world
       would have taken. Six-to-one is the same "can I take him" question
       stepBands already asks about YOU, answered the same way and with the
       same memory (`scared`), so a beaten crew keeps its distance afterwards —
       and the pursuit is a real one, because the weak side is now walking
       away rather than standing in the same place waiting to be picked again. */
    const gap = Math.max(pa, pb) / Math.max(0.001, Math.min(pa, pb));
    if (gap > 6) {
      const weak = pa < pb ? a : b;
      weak.mood = "flee";
      weak.scared = Math.min(2, (weak.scared || 0) + 1);
      weak.goal = { x: weak.x + (weak.x - (weak === a ? b : a).x), z: weak.z + (weak.z - (weak === a ? b : a).z), why: "" };
      return;
    }
    const win = W.odds(pa, pb);
    const aWins = W.rnd() < win;
    const winner = aWins ? a : b, loser = aWins ? b : a;
    const margin = aWins ? win : 1 - win;
    const loseFrac = 0.55 + margin * 0.45;
    const winFrac = clamp(0.42 * (1 - margin), 0.03, 0.35);
    const lost = Math.max(1, Math.round(loser.men.length * loseFrac));
    const cost = Math.round(winner.men.length * winFrac);
    loser.men.splice(0, lost);
    if (cost > 0) winner.men.splice(0, Math.min(cost, winner.men.length - 1));
    winner.gold += Math.round(loser.gold * 0.6);
    loser.gold = Math.round(loser.gold * 0.4);
    const wiped = !loser.men.length;
    if (wiped) {
      const at = S.bands.indexOf(loser);
      if (at >= 0) S.bands.splice(at, 1);
    } else {
      loser.mood = "flee"; loser.scared = Math.min(2, loser.scared + 1);
    }
    /* WHAT MAKES THE LOG, and it is now a filter rather than everything.

       Every resolve wrote a line. At 96 parties that was one line every four
       and a half seconds and it read as a world with news in it; at 677, with
       the per-party rate held (see FIGHT_EVERY), it is a line and a half a
       SECOND and the feed becomes a wall nobody reads — which does not just
       look bad, it deletes the feature, because the one line that mattered is
       now buried under forty that did not.

       So the same test a person would apply: could I plausibly have heard
       about this. Either it happened near enough that a rider would carry it —
       NEWS_R is one in-game hour of riding — or it was big enough to be news
       anywhere, which is a party of NEWS_BIG or more being wiped off the map.
       Everything else still HAPPENS; it just is not announced, exactly like
       every skirmish in a real war that nobody wrote down. */
    const NEWS_R = 3000;      // ~one hour's ride at BAND_SPEED
    const NEWS_BIG = 20;
    const near = Math.hypot(winner.x - S.you.x, winner.z - S.you.z) < NEWS_R;
    if (near || (wiped && lost >= NEWS_BIG)) {
      W.log(wiped
        ? winner.name + " wiped out a party of " + loser.faction + "s near " + placeName(winner.x, winner.z) + "."
        : winner.name + " beat " + lost + " men off a " + loser.faction + " party near " + placeName(winner.x, winner.z) + ".");
    }
  }

  /* somewhere has to have a NAME or the log is "a fight happened at 3104,
     -882", which is a database row and not a story. */
  function placeName(x, z) {
    const D = W.desert;
    let best = null, bd = 1e18;
    const all = D.oases.concat(S.outposts);
    for (let i = 0; i < all.length; i++) {
      const d = Math.hypot(all[i].x - x, all[i].z - z);
      if (d < bd) { bd = d; best = all[i]; }
    }
    if (best && bd < 2400) return best.name;
    return "the " + D.biomeAt(x, z) + " country";
  }

  /* ONE DOOR TO THE ENCOUNTER, whether you rode into a party or tapped it. */
  function engage(b) {
    if (!b || b.cooldown > 0) return false;
    b.cooldown = 12;
    chase = null; dest = null;
    W.emit("campaign:band", b);
    /* THIS LINE USED TO BE `W.setPhase("encounter", {band})` AND IT TURNED THE
       ISLAND OFF. core fires phase:leave:campaign on the way out, which this
       file answers at enter()'s sibling with `live = false; showAll(false)` —
       so the party you were standing in front of, deciding whether to fight,
       was hidden the instant its card came up. The meeting rail was a strip of
       text over an empty sky dome. outpost.js had already hit and fixed the
       identical chain ("BARREN DESERT AND MAN WITH A CRATE POPUP WITH NO MAN
       THERE"); army.js now does the same, keeps the phase on `campaign` and
       announces the meeting with encounter:open / encounter:close instead.
       It sets the phase itself under ?show=old, so nothing here needs to. */
    // army.js owns the card. It may not exist yet — this file must not be
    // the reason the page dies when a sibling module is missing.
    if (W.army && W.army.encounter) { try { W.army.encounter(b); } catch (e) { console.error("[warlord] encounter", e); } }
    else W.toast(b.name + " — " + W.bandSize(b) + " men (army.js not loaded)", "bad");
    return true;
  }

  /* ============================================================ CONTACT */
  function checkContacts() {
    nearBand = null; nearOutpost = null;
    let bd = 1e18;
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d < bd) { bd = d; nearBand = b; }
      if (d < CONTACT && engage(b)) return;
    }
    for (let i = 0; i < S.outposts.length; i++) {
      const o = S.outposts[i];
      const d = Math.hypot(o.x - S.you.x, o.z - S.you.z);
      if (d < OUTPOST_R * 6) nearOutpost = o;
      if (d < OUTPOST_R && !o.cool) {
        o.cool = 1;
        W.setPhase("outpost", { outpost: o });
        if (W.outpost && W.outpost.open) { try { W.outpost.open(o); } catch (e) { console.error("[warlord] outpost", e); } }
        else W.toast(o.name + " " + o.label + " (outpost.js not loaded)", "bad");
        return;
      }
      if (d > OUTPOST_R * 1.6) o.cool = 0;
    }
  }

  /* ============================================================ NAMEPLATES
     Only what is close, and never more than six: a screen with forty labels
     on it has no information on it. */
  const _proj = new THREE.Vector3();
  const plates = [];
  function paintPlates() {
    if (!plateBox) return;
    const list = [];
    for (let i = 0; i < S.bands.length && list.length < 6; i++) {
      const b = S.bands[i];
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d > NAMEPLATE_R) continue;
      list.push({ x: b.x, y: W.desert.heightAt(b.x, b.z) + 9, z: b.z, d: d,
        text: W.bandSize(b) + " " + b.name, sub: b.mood === "hunt" ? "COMING FOR YOU" :
          b.mood === "flee" ? "RUNNING" : Math.round(d) + "m", cls: b.mood });
    }
    for (let i = 0; i < peerDraw.length && list.length < 8; i++) {
      const q = peerDraw[i];
      if (q.d > NAMEPLATE_R * 2.2) continue;
      list.push({ x: q.x, y: W.desert.heightAt(q.x, q.z) + 11, z: q.z, d: q.d,
        text: q.size + " " + q.name, sub: "WARLORD", cls: "peer" });
    }
    if (nearOutpost) {
      const d = Math.hypot(nearOutpost.x - S.you.x, nearOutpost.z - S.you.z);
      list.push({ x: nearOutpost.x, y: nearOutpost.y + 20, z: nearOutpost.z, d: d,
        text: nearOutpost.name + " " + nearOutpost.label, sub: nearOutpost.note, cls: "op" });
    }
    while (plates.length < list.length) {
      const p = document.createElement("div");
      p.className = "plate";
      plateBox.appendChild(p);
      plates.push(p);
    }
    for (let i = 0; i < plates.length; i++) {
      const p = plates[i], L = list[i];
      if (!L) { p.style.display = "none"; continue; }
      _proj.set(L.x, L.y, L.z).project(camera);
      if (_proj.z > 1) { p.style.display = "none"; continue; }
      p.style.display = "block";
      p.className = "plate " + (L.cls || "");
      p.innerHTML = L.text + '<i>' + L.sub + '</i>';
      p.style.left = ((_proj.x * 0.5 + 0.5) * window.innerWidth) + "px";
      p.style.top = ((-_proj.y * 0.5 + 0.5) * window.innerHeight) + "px";
    }
  }

  /* ============================================================ API */
  C.dest = function (x, z) { dest = { x: x, z: z }; chase = null; markAt(x, z); return dest; };
  C.engage = engage;
  /* the camera's strategic-ness, for territory.js and anything else that has
     to agree with this view. t is 0 over-the-shoulder .. 1 fully pulled back. */
  C.zoom = function () {
    return { dist: camDist, t: clamp((camDist - 16) / (520 - 16), 0, 1), yaw: camYaw, x: S.you.x, z: S.you.z };
  };
  C.setSimHost = function (on) { C.simHost = !!on; return C.simHost; };
  C.you = function () { return S.you; };
  C.camDist = function (d) { if (d != null) camDistWant = clamp(d, 16, 520); return camDistWant; };
  C.camYaw = function (a) { if (a != null) camYaw = a; return camYaw; };
  C.live = function () { return live; };
  /* WHERE THE PEOPLE AT AN OUTPOST ACTUALLY ARE, in world metres, and it is
     published for two reasons that are the same reason. A photograph of
     "the trader" has to be AIMED at the trader rather than at the middle of
     the compound and a hope; and "is there a man at the stall" is a question
     a test should be able to ASK, not infer from a pixel. Same two lines of
     rotation the draw uses, so what a tool is told is where the man is. */
  C.folkAt = function (o) {
    const i = S.outposts.indexOf(o);
    const g = i < 0 ? null : outpostGroups[i];
    const list = (g && g.userData.folk) || [];
    const cy = Math.cos(g ? g.rotation.y : 0), sy = Math.sin(g ? g.rotation.y : 0);
    const out = [];
    for (let k = 0; k < list.length; k++) {
      const f = list[k];
      out.push({ x: o.x + f.x * cy + f.z * sy, z: o.z - f.x * sy + f.z * cy,
                 yaw: (g ? g.rotation.y : 0) + f.yaw, role: f.role });
    }
    return out;
  };
  C.outpostGroup = function (o) {
    const i = S.outposts.indexOf(o);
    return i < 0 ? null : (outpostGroups[i] || null);
  };
  C.map = toggleMap;
  C.spawnBand = spawnBand;
  function outpostAudit() {
    let raised = 0, folkAnchors = 0, houses = 0, worst = 0, missing = 0;
    for (let i = 0; i < S.outposts.length; i++) {
      const o = S.outposts[i];
      if (o.relief != null && o.relief > worst) worst = o.relief;
      const g = outpostGroups[i];
      if (!g) continue;
      raised++;
      folkAnchors += (g.userData.folk || []).length;
      g.traverse(function (n) {
        if (n.userData && n.userData.kind) houses++;
        if (n.userData && n.userData.missing) missing++;
      });
    }
    return {
      raised: raised, queued: raiseQ.length, houses: houses, houseKitMissing: missing,
      folkAnchors: folkAnchors, folkDrawn: folkShown,
      padReliefM: Math.round(worst * 100) / 100,
    };
  }

  C.audit = function () {
    return {
      live: live, bands: S.bands.length, outposts: S.outposts.length,
      army: S.army.length, drawnMen: menBody ? menBody.count : 0,
      /* WHAT AN OUTPOST ACTUALLY IS ON SCREEN, because it was a lie for
         months and nothing here could have said so. `raised` counts the
         props.js compounds actually standing; `folk` the men drawn at them
         this frame; `padRelief` the worst peak-to-peak ground under any
         compound after levelPad, which is the number that says whether
         anything is floating. */
      posts: outpostAudit(),
      men: { impostors: menBody ? menBody.count : 0, rigs: rigsShown,
             pool: rigsBuilt, poolCap: RIG_POOL, dressedThisFrame: rigsDressed,
             near: NEAR_IN, out: NEAR_OUT, cone: FLAG_MEN_OLD,
             ms: Math.round(menMs * 1000) / 1000 },
      calls: (CBZ.renderer && CBZ.renderer.info) ? CBZ.renderer.info.render.calls : null,
      you: { x: Math.round(S.you.x), z: Math.round(S.you.z), y: Math.round(W.desert.heightAt(S.you.x, S.you.z)) },
      hour: Math.round(S.hour * 10) / 10, day: S.day, camDist: Math.round(camDist),
      // published so tools/warlord-speed.mjs can turn the day clock back into
      // seconds and check it against the speed slider without re-typing 45
      hourSecs: HOUR_SECS, timeScale: W.clock.scale(),
      ridden: Math.round(travelled),
      trail: breadcrumbs.length, dest: dest ? { x: Math.round(dest.x), z: Math.round(dest.z) } : null,
      simHost: C.simHost, peers: peerDraw.length, chasing: !!chase,
      /* THE POPULATION, COUNTABLE — the numbers bandTarget() is derived from
         and the ones tools/warlord-scale-check.mjs --island gates on. `far` is
         how many parties are outside BAND_DRAW and therefore on the far clock
         (see THE FAR CLOCK); `souls` is every soldier object in the world,
         which is the thing the save has to fit in localStorage and is the real
         ceiling on how many armies this island can hold. */
      world: worldCensus(),
    };
  };
  function worldCensus() {
    let far = 0, souls = 0, big = 0, small = 0, biggest = 0;
    const yx = S.you.x, yz = S.you.z;
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      const n = (b.men && b.men.length) || 0;
      souls += n;
      if (n > biggest) biggest = n;
      if (b.kind) small++; else big++;
      if (Math.hypot(b.x - yx, b.z - yz) > BAND_DRAW) far++;
    }
    return { parties: S.bands.length, big: big, small: small, far: far,
             souls: souls, biggest: biggest, farStride: FLAG_FAR_OLD ? 0 : FAR_STRIDE };
  }

  C.needs = ["desert"];
  C.boot = function (c) {
    ctx = c; micro = c.micro; scene = c.scene; camera = CBZ.camera;
    if (c.Q && c.Q.get("audit") === "1") W.on("campaign:ready", function () {
      try { console.log("[warlord/campaign]", C.audit()); } catch (e) {}
    });
  };
  W.module("campaign", C);
})();
