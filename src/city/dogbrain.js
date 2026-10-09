/* ============================================================
   city/dogbrain.js — WHAT A DOG DECIDES. Pure: no THREE, no scene.

   OWNER (2026-10-09): "If they like you, they act like security does in the
   game, except they just defend you and help you when you start attacking
   someone."

   So a loyal dog is a protector body, and this is its rulebook, the same
   order the security details and the crew follow (city/orders.js):

     1. an ORDER stands: "Attack" on a man is that man until he is down
     2. DEFEND the principal: whoever is fighting him (a ped raging at him, a
        cop shooting at him, a predator charging him), nearest first
     3. JOIN IN: whoever the principal just struck or shot (CBZ.now stamp
        p._pHitT, written by peds.js struck() and fpsmode's gun hit)
     4. GUARD a spot: anyone fighting there is bitten; anyone walking in on
        it is growled at
     5. WARN: cops while you are wanted, or a man squaring up to you (his
        wind-up, a confrontation), get barked at
   A dog told to STAY keeps its spot: it only breaks it for a man actually
   fighting its principal close by.

   The principal is whoever the dog belongs to: the player (your dog), a
   cop (a K9 with its handler), or nobody (a guard dog guards its yard).

   TRUST (strays, and any dog you feed): food over time. A dog eats at most
   once per FEED_GAP; each meal is a step of trust; a stray that trusts you
   fully can be adopted. Fear is the other half: a stray bolts from a man
   running at it or crowding it before it trusts him.

   PUBLIC: CBZ.dogBrain = { decide(dog, world), feed(dog, nowMs), canAdopt(dog),
           shouldFlee(dog, world), TUNE }
   Node: module.exports = CBZ.dogBrain.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  const TUNE = {
    DEFEND_R: 20,        // m from the principal a fight is his business
    JOIN_R: 24,          // m: the man you just hit
    JOIN_MS: 7000,       // how long "you just hit him" lasts
    STAY_DEFEND_R: 10,   // a staying dog breaks its stay only this close
    GUARD_R: 7,          // m around a guarded spot
    WARN_R: 32,          // m: cops / men squaring up
    FEED_GAP: 12000,     // ms between meals a dog will take
    FEED_STEP: 0.34,     // trust per meal (three meals)
    SKITTISH_R: 2.6,     // an untrusting stray will not let you closer
    RUN_AT_R: 7,         // a man running at it inside this sends it off
  };

  function P(a) { return a ? (a.pos || (a.group && a.group.position) || null) : null; }
  function d2(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; }
  function alive(a, w) { return !!(a && !a.dead && P(a) && !(a.ko > 0) && !a.restraint && !(w && w.down && w.down(a))); }
  function isPrincipal(t, w) {
    if (!t) return false;
    const ids = w.principalIds;
    if (ids) for (let i = 0; i < ids.length; i++) if (ids[i] && t === ids[i]) return true;
    return false;
  }
  // is `p` fighting the principal right now?
  function attacking(p, w) {
    if (!p || p === w.self) return false;
    if (isPrincipal(p.rage, w)) return true;
    if (isPrincipal(p.curTarget, w) && p.sees !== false && (p.kind !== "cop" || (w.wanted | 0) > 0)) return true;
    if (isPrincipal(p.npcTarget, w)) return true;
    if (p.state === "charge" && p.species && (p.species.danger || 0) >= 0.5 && !p.tamed) {
      // a charging predator near the principal
      return true;
    }
    return false;
  }
  function squaringUp(p, w) {
    if (!p) return false;
    if (p._windup && w.playerIsPrincipal) return true;          // peds.js: squaring up to beat YOU
    if (p.state === "confront" && (isPrincipal(p.rage, w) || isPrincipal(p.mem, w))) return true;
    return false;
  }

  /* decide(dog, world) -> { act, target, why }
       act: "attack" | "growl" | "warn" | "none"
     world: {
       principal      the body it protects (player actor / cop) or null
       principalIds   every object that IS the principal (player, playerActor)
       pos            the principal's position {x,z} (or null)
       lists          arrays of actors to consider (peds, cops, wildlife)
       now            ms clock (CBZ.now)
       wanted         player's stars (cops count as threats only when wanted)
       playerIsPrincipal  true for your own dog
     } */
  function decide(dog, w) {
    const out = { act: "none", target: null, why: "" };
    const me = P(dog);
    if (!me || dog.dead) return out;
    w.self = dog;
    const ord = dog._order || null;
    // 1. THE ORDER
    if (ord && ord.kind === "attack" && alive(ord.target, w)) {
      out.act = "attack"; out.target = ord.target; out.why = "order"; return out;
    }
    const pp = w.pos;
    const staying = !!(ord && ord.kind === "hold") || !!dog.sit;
    const guardSpot = ord && ord.kind === "guard" ? (ord.spot || null) : null;
    const lists = w.lists || [];
    let defend = null, dd = Infinity, join = null, jd = Infinity, warn = null, wd = Infinity, intr = null, idd = Infinity;
    const defR2 = (staying ? TUNE.STAY_DEFEND_R : TUNE.DEFEND_R);
    for (let li = 0; li < lists.length; li++) {
      const L = lists[li]; if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        if (!alive(p, w) || p === dog || isPrincipal(p, w) || p === w.principal) continue;
        if (p.kind === "dog" && p.owner && p.owner === dog.owner) continue;          // a packmate
        if (p._dogFriend && p._dogFriend === dog.owner) continue;
        const pq = P(p);
        // 2. DEFEND — measured from the principal (a staying dog: from itself)
        if (pp && attacking(p, w)) {
          const q = staying ? d2(pq, me) : d2(pq, pp);
          if (q < defR2 * defR2 && q < dd) { dd = q; defend = p; }
          continue;
        }
        // 3. JOIN IN — the man the principal just hit
        if (pp && w.playerIsPrincipal && !staying && p._pHitT != null && w.now != null && w.now - p._pHitT < TUNE.JOIN_MS) {
          const q = d2(pq, pp);
          if (q < TUNE.JOIN_R * TUNE.JOIN_R && q < jd) { jd = q; join = p; }
          continue;
        }
        // 3b. a K9 / guard principal's own fight is the dog's fight
        if (!w.playerIsPrincipal && w.principal && w.principal.rage === p) {
          const q = d2(pq, me);
          if (q < jd) { jd = q; join = p; }
          continue;
        }
        // 4. GUARDING A SPOT: who walks in on it
        if (guardSpot) {
          const q = d2(pq, guardSpot);
          if (p.rage && p.state === "fight" && q < (TUNE.GUARD_R + 5) * (TUNE.GUARD_R + 5) && q < dd) { dd = q; defend = p; continue; }
          if (q < TUNE.GUARD_R * TUNE.GUARD_R && q < idd && !p.animal) { idd = q; intr = p; }
          continue;
        }
        // 5. WARN — cops while wanted, a man squaring up
        if (pp) {
          const cop = p.kind === "cop" && (w.wanted | 0) > 0;
          if (cop || squaringUp(p, w) || (p.armed && p.rage && isPrincipal(p.rage, w))) {
            const q = d2(pq, pp);
            if (q < TUNE.WARN_R * TUNE.WARN_R && q < wd) { wd = q; warn = p; }
          }
        }
      }
    }
    if (defend) { out.act = "attack"; out.target = defend; out.why = "defend"; return out; }
    if (join) { out.act = "attack"; out.target = join; out.why = "join"; return out; }
    // a man walking onto a guarded spot is told, not bitten: the bite is for
    // a man who brings a fight there (above)
    if (intr) { out.act = "growl"; out.target = intr; out.why = "intruder"; return out; }
    if (warn) { out.act = "warn"; out.target = warn; out.why = warn.kind === "cop" ? "cops" : "threat"; return out; }
    return out;
  }

  // FOOD OVER TIME. Returns true when the dog ate (and trust moved).
  function feed(dog, now) {
    if (!dog || dog.dead) return false;
    if (dog._lastFedT != null && now - dog._lastFedT < TUNE.FEED_GAP) return false;
    dog._lastFedT = now;
    dog.trust = Math.min(1, (dog.trust || 0) + TUNE.FEED_STEP * (dog.hurtByYou ? 0.5 : 1));
    if (dog.trust > 0.98) dog.trust = 1;
    return true;
  }
  function canAdopt(dog) {
    return !!(dog && !dog.dead && !dog.tamed && dog.role === "stray" && (dog.trust || 0) >= 1 && !dog.aggro);
  }
  // A WARY STRAY. world: { pos (the man), speed (his speed), hasFood }
  function shouldFlee(dog, w) {
    const me = P(dog);
    if (!me || !w || !w.pos || dog.tamed) return false;
    const t = dog.trust || 0, q = Math.sqrt(d2(me, w.pos));
    if (t >= 0.66) return false;
    if (w.speed > 3.2 && q < TUNE.RUN_AT_R * (1 - t * 0.6)) return true;
    if (!w.hasFood && q < TUNE.SKITTISH_R * (1 - t)) return true;
    return false;
  }

  CBZ.dogBrain = { decide: decide, feed: feed, canAdopt: canAdopt, shouldFlee: shouldFlee, attacking: attacking, TUNE: TUNE };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.dogBrain;
})();
