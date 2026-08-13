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
        beating bleeds out slow — and frozen / drowned / choked / irradiated /
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
    return CBZ.CONFIG.SURV_TRAUMA !== false && !!(CBZ.game && CBZ.game.mode === "survival");
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
  const CAUSES = [
    // ---- NOTHING BLEEDS ----
    // tissue destroyed rather than opened: nothing is left to pump
    [/vaporiz|nuclear blast|incinerat|\blava\b|burned alive|wildfire|lightning/, null],
    // systemic deaths: the skin is never broken
    [/fallout|radiation|frozen|blizzard|hypotherm|choked|\bash\b|asphyx|starv|dehydr/, null],
    // the water took them — and gore.js's own water medium would only bloom for
    // a WOUND, which a drowning isn't
    [/drown|swept|undertow|\bflood\b|tsunami/, null],
    // ---- THESE BLEED ----
    // `gib` prices the flying CHUNKS (gore.js LAYER 3, 1 = its stock count).
    // It is a separate axis from `amount` on purpose: a beating is bloody and
    // dismembers nothing, a tornado dismembers more than a bomb does. Before
    // this, every survival death threw the same five body chunks — which is
    // how a hillside ended up littered after people died of falls and beatings.
    //
    // the island's worst: a tornado does not kill you, it disassembles you
    [/torn apart|tornado/, { amount: 1.75, gib: 1.5, style: "tear", slowmo: 0.45 }],
    // crushed: burst and pooled, with the ground wearing most of it
    [/crush|rubble|collaps|lahar|flatten|meteor|volcanic bomb/, { amount: 1.5, gib: 1, style: "crush" }],
    // a long drop onto rock — radial, low, and very wide. A fall does not throw
    // pieces of you around; it flattens you where you land.
    [/sinkhole|crater|\bfell\b|\bfall\b|\bfalls\b/, { amount: 1.35, gib: 0, style: "splat" }],
    // struck by something thrown fast: directional, off the impact side
    [/debris|hurricane|impaled|struck|thrown|hit by/, { amount: 1.1, gib: 0.35, style: "burst" }],
    // beaten: bruise, split, then a slow bleed-out under the body. Fists take
    // nothing off a person, so this throws no chunks at all.
    [/beaten|punch|melee|fists/, { amount: 1.0, gib: 0, style: "blunt" }],
    // ordnance proper (never reached by the nuke rows above)
    [/explosion|ordnance|\bbomb\b|\bblast\b|shell/, { amount: 1.3, gib: 1.2, style: "boom" }],
  ];
  function profile(cause) {
    const c = ("" + (cause || "")).toLowerCase();
    if (!c) return null;
    for (let i = 0; i < CAUSES.length; i++) if (CAUSES[i][0].test(c)) return CAUSES[i][1];
    return null;                      // unrecognised → no blood. The inversion.
  }
  function bloodless(cause) { return !profile(cause); }

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
    return sev;
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
      if (!pr) { if (o) o._noBlood = true; return false; }   // and it stays sealed as it lands
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
        dir, amount, gib: pr.gib, cloth: a.outfit, skin: a.skin, player: !!a.isPlayer,
        slowmo: a.isPlayer ? (pr.slowmo || 0.4) : (pr.slowmo || 0),
      };
      switch (pr.style) {
        // TORN APART: omnidirectional by definition — gore()'s explosion path is
        // exactly the "no preferred direction, everything leaves at once" read.
        case "tear": opts.explosion = true; opts.dir = null; break;
        case "boom": opts.explosion = true; break;
        // BEATEN: gore()'s blunt beat — teeth and spit now, the bleed-out pool
        // spreading under the body a couple of seconds later.
        case "blunt": opts.melee = "blunt"; break;
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
    of(a) { const r = rec(a); return r ? r.v : 0; },
    reset(a) {
      const o = a && a.isPlayer ? CBZ.player : a;
      if (o) { o._trauma = null; o._noBlood = false; }
    },
  };
  CBZ.trauma = T;

  // the module clock the lazy decay reads. One updater, no per-actor sweep.
  if (CBZ.onAlways) CBZ.onAlways(7.5, function (dt) { if (dt > 0) clock += dt; });
})();
