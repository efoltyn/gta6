/* ============================================================
   systems/trauma.js — BLOOD IS EARNED. (natural-disaster mode)

   THE REPORT (owner, filmed on the disaster island): "The blood is dumb. On
   the mountain it shows FLATS that FLOAT. And it shows for NOTHING — it shows
   too easily. It should show, and be gory and dramatic, if you get pushed hard
   into something, if you fall from far, if you get punched a bunch of times."

   THE BUG, NAMED. modes/survival.js reportDeath() fired CBZ.gore() on EVERY
   death, unconditionally, at a flat amount. That is one line, and it is wrong
   in both directions at once:

     • IT BLED FOR NOTHING. Nine of the island's twenty-odd causes of death do
       not break skin at all. A man who FROZE SOLID in the blizzard sprayed
       arterial red. So did the one who DROWNED in the floodwater, the one who
       CHOKED on volcanic ash, the one who died of NUCLEAR FALLOUT, the one who
       was INCINERATED BY LAVA (there is nothing left to bleed), the one who
       was VAPORIZED by the nuke, and the one who simply STARVED. Blood was the
       engine's way of saying "someone died", so it meant nothing.

     • IT NEVER BLED FOR THE THINGS THAT ACTUALLY MAUL YOU. Punch a survivor
       five times and there was no blood until the sixth killed them. Shove
       someone off the refuge mountain, watch them fall twenty-six metres onto
       rock — nothing, not a mark, they just got up. Throw a body into a
       building at fourteen metres a second — nothing. Every violent, physical,
       PLAYER-CAUSED thing in the mode was bloodless, and the ambient weather
       was a bloodbath. Exactly backwards.

   THE MODEL. Blood is not a death notification, it is MECHANICAL TRAUMA to
   flesh: kinetic energy delivered fast enough, in a small enough area, to open
   someone up. Cold, water, smoke, radiation and starvation kill without ever
   doing that; fire and a nuclear flash destroy the tissue instead of opening
   it. So this file owns two things and nothing else:

     1. THE LEDGER. A per-actor accumulator, fed by the three events the owner
        named — a landing, a slam into a surface, a strike — decaying over ~30 s
        so a beating counts and a bruise from last disaster does not. Blood
        appears when the ledger crosses FIRST_BLOOD, and every hit past that
        opens it further. One savage impact (a long fall) clears the bar on its
        own; a hail of light ones has to earn it. Nothing shows below the bar —
        that restraint IS the feature.

     2. THE CAUSE TABLE. What a given death does to a body, so the kill's gore
        follows its physics: torn apart by a tornado is the goriest thing on the
        island, crushed under rubble bursts and pools, a long fall SPLATS, a
        beating bleeds out slow, a MAULING tears a limb off and floods the
        water — and frozen / drowned / choked / irradiated /
        incinerated / vaporized draw NO BLOOD AT ALL. An unrecognised cause
        draws no blood either: the default is now silence, which is the whole
        inversion.

   WHERE THE EVENTS COME FROM (one line each, nothing restructured):
     systems/grapple.js  punch/push land, a flung body's landing, and a body
                         driven into a wall mid-flight
     systems/physics.js  the player's own landing speed in survival
     modes/survival.js   reportDeath() → deathGore()

   CBZ.CONFIG.SURV_TRAUMA = false restores the old unconditional-gore path in
   modes/survival.js and makes every hook here a no-op.

   Public API:
     CBZ.trauma.strike(actor, force, opts)   — a blunt blow landed
     CBZ.trauma.slam(actor, speed, opts)     — a body met a surface at speed
     CBZ.trauma.deathGore(actor, cause, imp) — fire the right gore for a death
     CBZ.trauma.bloodless(cause)             — does this cause break skin?
     CBZ.trauma.of(actor) / CBZ.trauma.reset(actor)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.SURV_TRAUMA == null) CBZ.CONFIG.SURV_TRAUMA = true;
  // SCOPED TO THE DISASTER MODE ON PURPOSE. Two of the three feed sites live in
  // systems/grapple.js, whose body physics the CITY also runs — so without this
  // check, adopting the ledger would have quietly started bleeding city peds on
  // every blast landing. City blood is city/death.js's and peds.js's business
  // and it was not what was reported. One test, in one place, rather than a
  // mode check copied to each hook.
  function on() {
    return CBZ.CONFIG.SURV_TRAUMA !== false && !!(CBZ.game && CBZ.islandModeOn(CBZ.game.mode));
  }

  // ---- the ledger's units ---------------------------------------------------
  // 1.0 trauma unit ≈ "enough to open a person up on its own". A solid punch is
  // a fifth of that, so the third or fourth one draws blood — the owner's "punch
  // someone a bunch of times". A landing is measured in the speed it happened
  // at, because that is the number physics already has.
  const FIRST_BLOOD = 0.6;     // ledger value at which skin actually opens
  const DECAY = 0.033;         // units/sec — a beating lands inside ~30s, older hits don't count
  const MAX = 2.6;             // ledger ceiling: past this it's all the same catastrophe
  const BLEED_CD = 0.22;       // s between emissions on one body (an impact is one event)

  // A LANDING. Gravity here is 22 m/s^2 (CBZ.TUNE.gravity), so these read as
  // heights: a normal jump lands at ~8 m/s, a 3 m drop at 11, a 6 m drop at 16,
  // an 11 m drop at 22, and the refuge mountain's 26 m peak at ~34 — which is
  // the top of the scale and should look like it.
  const GROUND_SAFE = 10.5, GROUND_SPAN = 12;
  // A WALL. You meet a wall with your head and shoulders, not your legs, and
  // nothing absorbs it — so it costs less speed and it costs you more.
  const WALL_SAFE = 6.5, WALL_SPAN = 10, WALL_MULT = 1.35;
  // one impact this severe opens you up on its own, no history required —
  // this is the clause that makes "fall from far" bleed the first time.
  const LONE_HIT = 0.42;

  // ---- THE CAUSE TABLE ------------------------------------------------------
  // First match wins, so the bloodless rows come FIRST: "crushed by a volcanic
  // bomb" must not fall through to the generic explosion row, and "struck by
  // lightning" must not be read as a strike. Anything unmatched → null → no
  // blood, which is the deliberate default.
  //
  // NOTE the ordering hazards that are load-bearing here:
  //   "nuclear blast" / "vaporized by the nuclear blast" must be caught by the
  //   destroyed-tissue row before the /blast/ in the ordnance row sees it, and
  //   "killed by nuclear fallout" must be caught before /\bfall\b/ reads it as
  //   a fall. Both are live cause strings in systems/disasters.js.
  //
  // EVERY ROW CARRIES A `mark` (gore.js's CBZ.corpseTreat). Cutting the blood
  // off the bloodless causes was only half the answer: it left the man who
  // FROZE SOLID looking exactly like the man who STARVED, who CHOKED, who
  // DROWNED and who was INCINERATED — five different deaths, one
  // factory-fresh body, told apart only by a line of text in the corner. The
  // blood was wrong because it was the only evidence the engine had. Deleting
  // it without replacing it just moves the problem, so each cause now leaves
  // its OWN mark on the body and the bloodless ones are the point of it.
  const CAUSES = [
    // ---- NOTHING BLEEDS: THE BODY IS MARKED INSTEAD ----
    // tissue destroyed rather than opened — nothing left to pump, and what is
    // left is burned through. (Must precede the ordnance row: "nuclear blast".)
    [/vaporiz|nuclear blast/, { mark: "char" }],
    [/incinerat|\blava\b|burned alive|wildfire|\bfire\b/, { mark: "char" }],
    [/lightning/, { mark: "char" }],                  // before /struck/ in the debris row
    [/fallout|radiation/, { mark: "pallor" }],        // before /\bfall\b/ in the splat row
    [/frozen|blizzard|hypotherm|\bcold\b/, { mark: "frost" }],
    [/choked|\bash\b|asphyx|smoke/, { mark: "ash" }],
    [/starv|dehydr|thirst/, { mark: "pallor" }],
    // the water took them — gore.js's water medium would only bloom for a
    // WOUND, which a drowning isn't. The body comes out dark and sodden.
    [/drown|swept|undertow|\bflood\b|tsunami/, { mark: "soak" }],
    // ---- THESE BLEED ----
    // `limbs` IS A LIMB COUNT, NOT A PARTICLE BUDGET (owner: "I hate the blood
    // blocks"). It used to price gore.js's generic flying CUBES; the island
    // does not throw cubes any more, it takes real body parts off the real rig
    // (severBody), so the honest question is how many a given death actually
    // detaches. Most detach none — that restraint is the point, and it is why
    // a beating and a long fall now leave a whole body on the ground.
    //
    /* MAULED / EATEN — TEETH, NOT A WEAPON, and until now not a row at all.
       modes/shark_sim.js and city/wildlife_tame.js kill survivors with
       "eaten by a bull shark" / "mauled by a bear", profile() matched nothing,
       and deathGore's `!pr` branch marked the body _noBlood and drew LITERALLY
       NOTHING. A shark could take a swimmer off the beach and the only
       evidence in the world was a line of text. That is most of the owner's
       "it doesn't look like I'm biting them".

       A jaw TEARS rather than penetrates, so it bleeds harder and faster than
       anything on this island short of the wind — and it is the one death here
       that takes a piece of you with it, which is the entire point of a shark.
       `style:"bite"` puts gore.js on its bite path (two opposing rows of torn
       punctures stamped on the real rig via CBZ.bodyBite) and deliberately NOT
       on the blade path: the arterial knife-arcs read completely wrong on a
       mauling. limbs:1 is CBZ.goreSever taking a real arm or leg off the real
       body, thrown along the jaw line the kill site hands us in imp.dir.

       THE VOCABULARY IS gore.js's OWN, character for character, so the wound
       stamp and the cause table can never disagree about what a bite is. THE
       WORD BOUNDARIES ARE LOAD-BEARING: "beaten" and "beaten to death" are
       live BLUNT causes in this game and both contain the substring "eaten" —
       \beaten\b refuses them (there is no word boundary inside "beaten"), and
       they fall through to the blunt row below exactly as they always did.
       Ordered FIRST among the bleeding rows so "torn apart by a great white"
       reads as the shark that did it rather than as the tornado. */
    [/maul|bitten|\bbit\b|savag|devour|\beaten\b|shark|jaws/, { amount: 1.5, limbs: 1, style: "bite" }],
    // the island's worst: a tornado does not kill you, it disassembles you
    [/torn apart|tornado/, { amount: 1.75, limbs: 2, style: "tear", slowmo: 0.45 }],
    // crushed: burst and pooled, with the ground wearing most of it. Rubble
    // breaks a body, it rarely takes pieces OFF one.
    [/crush|rubble|collaps|lahar|flatten|meteor|volcanic bomb/, { amount: 1.5, limbs: 0, style: "crush" }],
    // a long drop onto rock — radial, low, and very wide. A fall does not throw
    // pieces of you around; it flattens you where you land.
    [/sinkhole|crater|\bfell\b|\bfall\b|\bfalls\b/, { amount: 1.35, limbs: 0, style: "splat" }],
    // struck by something thrown fast: directional, off the impact side
    [/debris|hurricane|impaled|struck|thrown|hit by/, { amount: 1.1, limbs: 0, style: "burst" }],
    // beaten: bruise, split, then a slow bleed-out under the body. Fists take
    // nothing off a person.
    [/beaten|punch|melee|fists/, { amount: 1.0, limbs: 0, style: "blunt" }],
    // ordnance proper (never reached by the nuke rows above)
    [/explosion|ordnance|\bbomb\b|\bblast\b|shell/, { amount: 1.3, limbs: 1, style: "boom" }],
  ];
  function profile(cause) {
    const c = ("" + (cause || "")).toLowerCase();
    if (!c) return null;
    for (let i = 0; i < CAUSES.length; i++) if (CAUSES[i][0].test(c)) return CAUSES[i][1];
    return null;                      // unrecognised → no blood. The inversion.
  }
  // a cause draws blood only if it has a gore STYLE — a row with only a `mark`
  // is one of the deaths that never breaks skin.
  function bloodless(cause) { const p = profile(cause); return !p || !p.style; }

  // ---- the ledger ------------------------------------------------------------
  // Lives on the actor (the player adapter proxies onto CBZ.player), decays
  // lazily against a module clock so there is no per-actor per-frame sweep — a
  // hundred survivors cost nothing until one of them is actually hit.
  let clock = 0;
  function rec(a) {
    const o = a && a.isPlayer ? CBZ.player : a;
    if (!o) return null;
    let r = o._trauma;
    if (!r) { r = o._trauma = { v: 0, t: clock, cd: 0, open: false, hits: 0 }; return r; }
    const dt = clock - r.t;
    if (dt > 0) { r.v = Math.max(0, r.v - DECAY * dt); r.t = clock; if (r.v <= 0.02) r.open = false; }
    return r;
  }
  function alive(a) { return !!(a && a.pos && !a.culled); }
  // a body whose death destroyed rather than opened the tissue never bleeds
  // afterwards either — a frozen corpse hitting the ground at 20 m/s does not
  // spray, and a charred one certainly doesn't.
  function sealed(a) { const o = a && a.isPlayer ? CBZ.player : a; return !!(o && o._noBlood); }

  // ---- emission --------------------------------------------------------------
  // sev is in ledger units past the bar; everything visual scales off it.
  function bleed(a, sev, o) {
    o = o || {};
    const p = a.pos; if (!p) return;
    const y = p.y + (o.y != null ? o.y : 1.0);
    const amt = Math.max(0.3, Math.min(1.9, 0.4 + sev * 0.9));
    if (CBZ.goreImpact) {
      CBZ.goreImpact(p.x, y, p.z, {
        dir: o.dir, amount: amt,
        mist: sev > 0.8,                  // only a real crunch atomises anything
        pool: sev > 0.55,                 // only an open wound stains the ground
        wall: !!o.wall,
        player: !!a.isPlayer,
        sfx: sev > 0.7 ? "hit" : false,
      });
    }
    // THE BODY CARRIES IT (systems/wounds.js). Under the bar this never runs;
    // at the bar a blunt impact stops being a bruise and becomes a split.
    if (CBZ.bodyWound) {
      try {
        CBZ.bodyWound(a, { x: p.x, y: y, z: p.z }, {
          melee: sev > 0.5 ? "blade" : "blunt",
          cal: 0.7 + Math.min(0.7, sev * 0.4),
          dir: o.dir, fromX: o.fromX, fromZ: o.fromZ,
        });
      } catch (e) {}
    }
    if (a.isPlayer && CBZ.shake) CBZ.shake(Math.min(0.9, 0.2 + sev * 0.4));
  }

  // add `add` units to the ledger and emit if that crosses the bar. `lone` is
  // the severity of THIS single impact, so one savage event bleeds on its own
  // without needing a history behind it.
  function accrue(a, add, lone, o) {
    if (!on() || !alive(a) || sealed(a)) return 0;
    const r = rec(a); if (!r) return 0;
    r.v = Math.min(MAX, r.v + add);
    r.hits++;
    const crossed = r.v >= FIRST_BLOOD || lone >= LONE_HIT;
    if (!crossed) {
      // UNDER THE BAR: a bruise, and nothing else. No spray, no pool, no stain
      // on the world. This branch is the entire complaint being answered.
      if (CBZ.bodyWound && a.pos && lone > 0.12) {
        try { CBZ.bodyWound(a, { x: a.pos.x, y: a.pos.y + (o && o.y != null ? o.y : 1.0), z: a.pos.z }, { melee: "blunt", fromX: o && o.fromX, fromZ: o && o.fromZ }); } catch (e) {}
      }
      return 0;
    }
    if (r.cd > clock) return 0;                 // one emission per impact, not per frame
    r.cd = clock + BLEED_CD;
    r.open = true;
    // how gory: how far past the bar the body is, plus the violence of this one
    // hit. A sixth punch trickles; a twenty-six-metre fall does not.
    const sev = Math.min(2, (r.v - FIRST_BLOOD) * 0.9 + lone * 1.15);
    bleed(a, sev, o);
    openWound(a, r, sev);
    return sev;
  }

  /* ---- AN OPEN WOUND FOLLOWS YOU -------------------------------------------
     A survivor who has just been opened up should not walk away spotless. The
     wound bleeds for a while and marks the ground it crosses, so you can read
     where a beaten man ran to, and the player can look back at their own trail
     after taking a fall. It stops on its own — the wound closes — which is
     what keeps it from becoming a permanent paint-roller behind every bot.

     Cost is bounded three ways and none of them is a per-frame sweep of the
     roster: only actors that have actually BLED are ever in the list, the list
     is hard-capped, and a drip is spent on DISTANCE MOVED rather than on time,
     so someone standing still costs one vector subtraction a tick. */
  const TRAIL_CAP = 8;             // simultaneous bleeders
  const DRIP_EVERY = 0.85;         // metres of travel per mark
  const bleeders = [];
  function openWound(a, r, sev) {
    if (sev < 0.45) return;                       // a graze does not trail
    r.bleedFor = Math.max(r.bleedFor || 0, 4 + Math.min(9, sev * 5.5));
    r.drop = 0;
    if (r.trailing) return;
    if (bleeders.length >= TRAIL_CAP) {
      // evict the driest — never the man who was just opened up
      let worst = 0;
      for (let i = 1; i < bleeders.length; i++) if ((rec(bleeders[i]) || { bleedFor: 0 }).bleedFor < (rec(bleeders[worst]) || { bleedFor: 0 }).bleedFor) worst = i;
      const drop = rec(bleeders[worst]); if (drop) drop.trailing = false;
      bleeders.splice(worst, 1);
    }
    r.trailing = true;
    r.lx = a.pos.x; r.lz = a.pos.z;
    bleeders.push(a);
  }
  function updateTrails(dt) {
    for (let i = bleeders.length - 1; i >= 0; i--) {
      const a = bleeders[i];
      const r = a && (a.isPlayer ? CBZ.player : a)._trauma;
      const p = a && a.pos;
      if (!r || !p || (!a.isPlayer && a.culled)) { if (r) r.trailing = false; bleeders.splice(i, 1); continue; }
      r.bleedFor -= dt;
      if (r.bleedFor <= 0) { r.trailing = false; bleeders.splice(i, 1); continue; }
      const dx = p.x - r.lx, dz = p.z - r.lz;
      const moved = Math.sqrt(dx * dx + dz * dz);
      if (moved < 0.05) continue;                 // standing still: no trail, no cost
      r.lx = p.x; r.lz = p.z;
      r.drop += moved;
      if (r.drop < DRIP_EVERY) continue;
      r.drop = 0;
      // a fresh wound runs; a closing one only spots. Jittered off the exact
      // footfall line so the trail wanders the way a real one does.
      const heavy = Math.min(1, r.bleedFor / 6);
      if (CBZ.goreDrip) {
        CBZ.goreDrip(p.x + (Math.random() - 0.5) * 0.5, p.z + (Math.random() - 0.5) * 0.5,
          0.12 + heavy * 0.24 + Math.random() * 0.08);
      }
    }
  }

  const T = {
    /* A BLUNT BLOW LANDED. `force` is the same number grapple.js already hands
       CBZ.body.hit (punch 6, push 12, throw 13), so no call site invents a
       scale. A shove is a big number that barely breaks skin, so the flesh
       weight is separate from the knockback weight: opts.flesh scales it. */
    strike(a, force, opts) {
      if (!on()) return 0;
      opts = opts || {};
      const f = Math.max(0, +force || 0);
      const add = f * 0.036 * (opts.flesh == null ? 1 : opts.flesh);
      return accrue(a, add, add, opts);
    },

    /* A BODY MET A SURFACE AT `speed` m/s. opts.wall → it was a wall, which is
       unforgiving; otherwise it was the ground under a fall. This is the one
       entry point for both of the owner's physical cases. */
    slam(a, speed, opts) {
      if (!on()) return 0;
      opts = opts || {};
      const v = Math.max(0, +speed || 0);
      const safe = opts.wall ? WALL_SAFE : GROUND_SAFE;
      const span = opts.wall ? WALL_SPAN : GROUND_SPAN;
      if (v <= safe) return 0;
      const sev = ((v - safe) / span) * (opts.wall ? WALL_MULT : 1);
      // a landing lands on the LEGS and the head snaps down onto the ground, so
      // the blood belongs low; a wall takes you across the chest and face.
      if (opts.y == null) opts.y = opts.wall ? 1.15 : 0.45;
      return accrue(a, sev, sev, opts);
    },

    /* THE DEATH ITSELF. Returns true if it drew blood. modes/survival.js calls
       this instead of firing CBZ.gore blind; a null profile means the body
       simply drops, which for nine of this island's causes is the truth. */
    deathGore(a, cause, imp) {
      if (!on() || !a || !a.pos || !CBZ.gore) return false;
      const pr = profile(cause);
      const o = a.isPlayer ? CBZ.player : a;
      // THE MARK IS THE POINT FOR THE BLOODLESS ROWS — frost, char, ash, soak,
      // pallor. It runs before the blood branch so a death that draws no blood
      // still leaves a body you can read from across the slope.
      if (pr && pr.mark && CBZ.corpseTreat) { try { CBZ.corpseTreat(a, pr.mark); } catch (e) {} }
      if (!pr || !pr.style) { if (o) o._noBlood = true; return false; }   // and it stays sealed as it lands
      const p = a.pos;
      let dir = null;
      if (imp && (imp.fromX != null || imp.dir)) {
        dir = imp.dir ? { x: imp.dir.x, z: imp.dir.z } : { x: p.x - imp.fromX, z: p.z - imp.fromZ };
      }
      // A BEATING'S TOLL IS CUMULATIVE. The body you worked on for six punches
      // is already open, so its death is gorier than a clean one — the ledger
      // it carried is the memory of every hit that got it here.
      const r = rec(a);
      const carried = r ? Math.min(0.55, r.v * 0.3) : 0;
      const amount = pr.amount + carried + (a.isPlayer ? 0.25 : 0);
      const opts = {
        dir, amount, cloth: a.outfit, skin: a.skin, player: !!a.isPlayer,
        // WHO died, so gore.js can stamp the wound on the real body and take a
        // real limb off it instead of throwing anonymous boxes. The player's
        // own corpse is never dismembered (gore.js refuses isPlayer).
        actor: a, imp: imp || null, limbs: a.isPlayer ? 0 : (pr.limbs || 0),
        slowmo: a.isPlayer ? (pr.slowmo || 0.4) : (pr.slowmo || 0),
      };
      /* WHAT THE KILL SITE ALREADY KNEW. A death that arrives with a real
         contact point, a real mouth width or a stated medium has no reason to
         make gore.js re-derive any of them:
           imp.point  → gore() seats the wound THERE on the part actually bitten
                        instead of at the generic body-centre this call passes
           imp.jaw    → a great white's jaw print, not wounds.js's 0.22 default
           imp.medium → the caller was IN the water and says so, so the wet
                        branch cannot be missed by a metre of clear air over a
                        swell. Every one is optional; nothing else changes. */
      if (imp) {
        if (imp.jaw != null) opts.jaw = imp.jaw;
        if (imp.medium) opts.medium = imp.medium;
        // imp.by → the animal whose mouth this was: gore.js puts the limb the
        // death tears off INTO that mouth instead of throwing it.
        if (imp.by) opts.by = imp.by;
        // imp.lens === false: the kill site already shook the camera for this
        // event and gore.js must not shake it again (see gore.js's `lens`).
        if (imp.lens != null) opts.lens = imp.lens;
      }
      switch (pr.style) {
        // TORN APART: omnidirectional by definition — gore()'s explosion path is
        // exactly the "no preferred direction, everything leaves at once" read.
        case "tear": opts.explosion = true; opts.dir = null; break;
        case "boom": opts.explosion = true; break;
        // BEATEN: gore()'s blunt beat — teeth and spit now, the bleed-out pool
        // spreading under the body a couple of seconds later.
        case "blunt": opts.melee = "blunt"; break;
        /* BITTEN: gore.js's own bite path. It stamps the tooth-row wound on the
           real body (CBZ.bodyBite) and fires NEITHER the arterial arcs nor the
           slow bleed-out pool — a maul is not a knife and it is not a beating.
           Said with opts.melee rather than left to gore()'s cause regex,
           because the opts.actor route below hands it an EMPTY cause string:
           gore() only ever sees the cause on the city's kill tap, so an island
           bite would have arrived anonymous and been drawn as a bullet. */
        case "bite": opts.melee = "bite"; break;
        // A LONG FALL: radial and LOW. Killing the direction gives the ring
        // spray; the wide extra pool below is the part that reads as a splat.
        case "splat": opts.dir = null; break;
        default: break;                      // "burst" / "crush" keep the impact line
      }
      CBZ.gore(p.x, p.y + (pr.style === "splat" ? 0.45 : 1.0), p.z, opts);
      // CRUSH and SPLAT put most of the volume on the GROUND, not in the air —
      // a second, wider, later-spreading pool is what sells both.
      if ((pr.style === "crush" || pr.style === "splat") && CBZ.goreImpact) {
        CBZ.goreImpact(p.x, p.y + 0.25, p.z, { amount: amount * 0.8, pool: true, mist: true });
      }
      if (r) { r.v = MAX; r.open = true; }
      return true;
    },

    bloodless,
    /* WHAT A DEATH DOES TO A BODY, without firing it — so anything else that
       needs to know (a corpse the disasters recycle, a test) can ask. */
    mark(cause) { const p = profile(cause); return (p && p.mark) || null; },
    of(a) { const r = rec(a); return r ? r.v : 0; },
    bleeding(a) { const r = a && (a.isPlayer ? CBZ.player : a)._trauma; return !!(r && r.trailing); },
    reset(a) {
      const o = a && a.isPlayer ? CBZ.player : a;
      if (o) { o._trauma = null; o._noBlood = false; }
      const i = bleeders.indexOf(a);
      if (i >= 0) bleeders.splice(i, 1);
      // the player's rig SURVIVES a match reset (the bots are rebuilt), so a
      // charred or frost-white body would carry its death into the next round.
      if (CBZ.corpseUntreat) { try { CBZ.corpseUntreat(a); } catch (e) {} }
    },
    audit() {
      return { on: on(), bleeders: bleeders.length, mark: CBZ.corpseMark ? CBZ.corpseMark(CBZ.surv && CBZ.surv.playerActor) : null };
    },
  };
  CBZ.trauma = T;

  // the module clock the lazy decay reads, plus the bleed trails. One updater,
  // no per-actor sweep — only bodies that have actually bled are in the list.
  if (CBZ.onAlways) CBZ.onAlways(7.5, function (dt) {
    if (dt <= 0) return;
    clock += dt;
    if (bleeders.length && on()) updateTrails(dt);
    else if (bleeders.length) bleeders.length = 0;      // left survival → drop the list
  });
})();
