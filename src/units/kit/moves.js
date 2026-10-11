/* ============================================================
   units/kit/moves.js — WHAT AN ANIMAL DOES WHEN YOU PRESS ATTACK.

   NPC War lets you take over any unit on the field (src/battle/player.js).
   A possessed animal has two controls, MOVE and ATTACK, and the attack it
   throws is chosen by the moment, the way the animal would choose it:

     a cat sprinting at something a few metres off        POUNCE (the leap)
     a cat with something inside its paws                 SWIPE, then BITE
     a cat standing over a body on the floor              THE THROAT BITE
     a wolf / bear: closing at a run                      the leap, else MAUL
     a shark / orca                                       the LUNGE (the rush)
     a rhino / bison at a charge                          RAM, else GORE
     an elephant with a man-sized thing at its trunk      TRUNK GRAB (lift, throw)
     a hoofed animal                                      KICK, TRAMPLE the fallen
     a gorilla                                            its own repertoire
                                                          (systems/ape_combat.js)

   THE CONTRACT (one hook in a species file, optional):

     CBZ.unitKit.register("lion", {
       ...
       moves(unit, tgt, ctx) -> move | move id | null
     });

   ctx = { dist, reach, sprint, speed, chase, downed, crowd, n, water }
     dist    centre to centre, metres (99 with no target)
     reach   this body's strike reach (the battle's own number)
     sprint  the player is holding sprint (Shift / the stick at its rim)
     speed   m/s the body is moving now; chase = its charge speed
     downed  the target is on the floor (a knocked-down man, a pinned body)
     crowd   enemies inside 2x reach
     n       how many attacks in the current combination (1 = first)
   A move is { id, style, pow, dur, rng, leap, cd, grab }:
     style   creature_combat's animation + strike grammar (pounce maul bite
             lunge gore ram stomp peck strike, or an ape_* move)
     pow     damage multiplier on the body's own strike number
     dur     seconds for the whole windup/strike/recover (0 = the style's own)
     rng     reach multiplier for the damage gate
     leap    metres the body may travel INTO the strike (a pounce, a charge)
     cd      seconds before the next attack may start
     grab    "toss": the hit lifts the target and throws it (the trunk)
   Return null (or leave the hook out) and the shared picker below answers.
   A species file can also call CBZ.unitMoves.pick(unit, tgt, ctx) and
   change what it returns. Ids from MOVES may be returned as plain strings.

   A species with its own fight(unit, tgt, dt, opts) is still driven the same
   way: the possessed driver latches the move on the body (_atkAnim = 0,
   _apeStyle = style, _atkDur, _atkPow) before calling it, so a fight built on
   CBZ.creatureFight plays it, and opts.youMove carries the move for a fight
   that wants to read it directly.

   Pure: no THREE, no DOM. Node loads it (tools/npcwar-check.mjs).
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  const MOVES = {
    pounce:  { style: "pounce", pow: 1.4, dur: 0.6, rng: 1.1, leap: 1, cd: 0.9 },
    swipe:   { style: "maul", pow: 0.85, dur: 0.3, rng: 1.0, cd: 0.45 },
    bite:    { style: "bite", pow: 1.05, dur: 0.38, rng: 1.0, cd: 0.6 },
    throat:  { style: "maul", pow: 1.8, dur: 0.75, rng: 1.05, cd: 0.9 },
    maul:    { style: "maul", pow: 1.0, dur: 0.42, rng: 1.0, cd: 0.6 },
    leap:    { style: "pounce", pow: 1.2, dur: 0.55, rng: 1.05, leap: 0.8, cd: 0.9 },
    lunge:   { style: "lunge", pow: 1.3, dur: 0, rng: 1.1, leap: 1.2, cd: 1.0 },
    snap:    { style: "bite", pow: 0.9, dur: 0.3, rng: 1.0, cd: 0.5 },
    ram:     { style: "ram", pow: 1.7, dur: 0.6, rng: 1.15, leap: 1.4, cd: 1.3 },
    gore:    { style: "gore", pow: 1.1, dur: 0.45, rng: 1.0, cd: 0.8 },
    kick:    { style: "stomp", pow: 1.0, dur: 0.45, rng: 1.0, cd: 0.7 },
    trample: { style: "stomp", pow: 1.6, dur: 0.55, rng: 1.05, cd: 0.9 },
    trunk:   { style: "gore", pow: 0.55, dur: 0.6, rng: 1.15, cd: 1.6, grab: "toss" },
    peck:    { style: "peck", pow: 1.0, dur: 0.3, rng: 1.0, cd: 0.45 },
    strike:  { style: "strike", pow: 1.2, dur: 0.35, rng: 1.1, cd: 0.7 },
  };
  for (const k in MOVES) MOVES[k].id = k;

  /* THE FAMILY is creature_combat's own style for the species (one table in
     the game, not two). Before that file loads, the same regex order. */
  function family(sp) {
    if (!sp) return "bite";
    const id = String(sp.id || sp.name || "").toLowerCase();
    if (/elephant/.test(id)) return "elephant";
    if (/gorilla|ape|chimp/.test(id)) return "ape";
    if (CBZ.creatureStyleFor) { try { return CBZ.creatureStyleFor(sp); } catch (e) { /* the regex below */ } }
    if (/shark|megalodon|orca|barracuda/.test(id)) return "lunge";
    if (/cat|leopard|cheetah|lion|tiger|panther|jaguar|cougar|puma|lynx/.test(id)) return "pounce";
    if (/wolf|dog|coyote|fox|bear|hyena/.test(id)) return "maul";
    if (/rhino|bison|bull|buffalo/.test(id)) return "ram";
    if (/boar|moose/.test(id)) return "gore";
    if (/horse|deer|goat|elk|ram|bighorn|caribou|stag|zebra|giraffe/.test(id)) return "stomp";
    if (/chicken|bird/.test(id)) return "peck";
    return "bite";
  }

  function pick(unit, tgt, ctx) {
    ctx = ctx || {};
    const fam = family(unit && unit.species);
    const dist = ctx.dist == null ? 99 : ctx.dist, reach = ctx.reach || 2;
    const far = !tgt || dist > reach * 1.05;
    const running = !!ctx.sprint || (ctx.chase > 0 && ctx.speed > ctx.chase * 0.6);
    const inLeap = tgt && dist < reach * 2.8;
    const n = ctx.n || 1;
    switch (fam) {
      case "pounce":
        if (far && running && inLeap) return MOVES.pounce;
        if (ctx.downed) return MOVES.throat;
        return n % 3 === 0 ? MOVES.bite : MOVES.swipe;
      case "maul":
        if (far && running && inLeap) return MOVES.leap;
        if (ctx.downed) return MOVES.throat;
        return n % 2 === 0 ? MOVES.bite : MOVES.maul;
      case "lunge":
        if (far && inLeap) return MOVES.lunge;
        return n % 2 === 0 ? MOVES.snap : MOVES.lunge;
      case "ram":
        if (ctx.downed) return MOVES.trample;
        if (far && running && inLeap) return MOVES.ram;
        return MOVES.gore;
      case "gore":
        if (ctx.downed) return MOVES.trample;
        if (far && running && inLeap) return MOVES.ram;
        return MOVES.gore;
      case "elephant":
        if (ctx.downed) return MOVES.trample;
        if (far && running && inLeap) return MOVES.ram;
        // the trunk takes what it can lift; a rhino is not lifted
        if (tgt && !ctx.heavy && dist < reach * 1.25) return MOVES.trunk;
        return MOVES.gore;
      case "stomp":
        if (ctx.downed) return MOVES.trample;
        if (far && running && inLeap) return MOVES.ram;
        return MOVES.kick;
      case "ape":
        // ape_combat's own picker chooses inside the arms (the host asks it);
        // a charge from a run is the one thing the host decides
        if (far && running && inLeap) return { id: "ape_charge", style: "ape_charge", pow: 0, dur: 0, rng: 1.15, leap: 1.2, cd: 0.7 };
        return null;
      case "peck": return MOVES.peck;
      case "strike": return MOVES.strike;
      default:
        if (far && running && inLeap) return MOVES.leap;
        return MOVES.bite;
    }
  }

  // a species hook's answer, made a move: a string is an id in MOVES
  function resolve(v) {
    if (!v) return null;
    if (typeof v === "string") return MOVES[v] || null;
    return v.style ? v : null;
  }

  // the species file's hook first, the shared picker after it
  function choose(unit, tgt, ctx) {
    const kit = unit && unit.kit;
    if (kit && typeof kit.moves === "function") {
      let v = null;
      try { v = resolve(kit.moves(unit, tgt, ctx)); } catch (e) { v = null; }
      if (v) return v;
    }
    return pick(unit, tgt, ctx);
  }

  CBZ.unitMoves = { MOVES: MOVES, family: family, pick: pick, choose: choose, resolve: resolve };
})();
