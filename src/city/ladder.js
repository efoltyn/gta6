/* ============================================================
   city/ladder.js - CBZ.cityLadder: the city's body for the DEMAND LADDER.

   The decisions are CBZ.brain.demand's (systems/brain.js): demand -> warn
   -> show -> act, and what the player DID is the answer each frame. This
   file is only the city half: it reads the player off the game (how far,
   how fast, gun out, gun on THIS man, swinging, paid, still inside) and
   carries the answer out on a city ped (walk up, hold and face, draw,
   square up, fight, flee, walk off, grab and throw out).

     cityLadder.begin(ped, kind, opts) -> entry | null    (against the player)
       opts: everything demand.begin takes, plus
         inside()      true while the player is still where he must not be
         outDir()      {x,z} the way OUT (a throw sends him that way)
         take          $ a mugger wants (rob; default a pocketful)
         onAct(ped, r) the caller's own act (return true: handled)
         onEnd(ped, r) after it ends, any way
     cityLadder.of(ped) -> entry | null   cityLadder.cancel(ped)
     cityLadder.pay(ped)                  hand a mugger what he asked for
     cityLadder.hold(ped, dt) -> bool     peds.js think(): the ladder owns him

   A mugging is paid with a DECISION on the mugger ("Pay $40", E), never a
   line. Everything else is the player's body: walk out, put the gun away,
   run, swing, draw.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const LIVE = [];
  const BACK = [];          // posted staff walking back to the post they left
  let T = 0;

  function PA() { return CBZ.city && CBZ.city.playerActor; }
  function D() { return CBZ.brain && CBZ.brain.demand; }
  function hyp(x, z) { return Math.sqrt(x * x + z * z); }

  /* ---- the gun at his hip: "don't make me pull it" means it is in the
     leather until SHOW. Only a gun he really carries. */
  function holster(ped, on) {
    if (!ped) return;
    if (on) {
      if (ped.armed && !ped._holstered && CBZ.actorHolster) { CBZ.actorHolster(ped, true); ped._ladHolstered = true; }
      return;
    }
    if (ped._holster && !ped.dead) {                 // the street brain's own holster record
      const h = ped._holster; ped._holster = null;
      ped.armed = true; ped.weapon = h.weapon; ped.ammo = h.ammo;
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    }
    if (ped._holstered && CBZ.actorHolster) CBZ.actorHolster(ped, false);
    ped._ladHolstered = false;
  }

  function begin(ped, kind, opts) {
    const DM = D(), pa = PA();
    if (!DM || !ped || ped.dead || !pa || pa.dead) return null;
    if (ped._ladder) return ped._ladder;
    opts = opts || {};
    const e = {
      ped: ped, kind: kind, opts: opts, c: null, act: "hold", t: 0, paid: false,
      take: opts.take != null ? opts.take | 0 : 0, post: null, after: null, afterT: 0,
    };
    // a rooted post (city/occupy.js interior staff, a doorman) steps off it
    if (ped.staffPost) {
      e.post = ped.staffPost;
      ped._occupyPost = ped._occupyPost || { x: e.post.x, z: e.post.z, face: e.post.face };
      ped.staffPost = null;
    }
    ped.pause = 0; ped.path = null; ped.approach = null; ped._windup = null;
    try { e.c = DM.begin(ped, pa, kind, opts); } catch (err) { e.c = null; }
    if (!e.c) { if (e.post) ped.staffPost = e.post; return null; }
    if (kind === "rob" && !e.take) e.take = Math.max(10, Math.min(g.cash | 0, 20 + ((Math.random() * 70) | 0)));
    // he has a gun and the ladder starts below SHOW: it is still on his belt
    if (e.c.armed && e.c.step !== "show" && e.c.step !== "act") holster(ped, true);
    ped._ladder = e;
    LIVE.push(e);
    return e;
  }

  function finish(e, r) {
    const ped = e.ped;
    const i = LIVE.indexOf(e); if (i >= 0) LIVE.splice(i, 1);
    if (ped._ladder === e) ped._ladder = null;
    ped.poseAimBack = ped.state === "fight" && ped.armed ? ped.poseAimBack : false;
    // a man who never drew puts it back where it was
    if (ped._ladHolstered && ped.state !== "fight") holster(ped, false);
    if (e.post && !ped.dead) {
      if (ped.state === "fight" || ped.rage) { /* occupy.js re-roots him when it stands down */ }
      else BACK.push({ ped: ped, post: e.post, t: 0 });
    }
    if (e.opts.onEnd) { try { e.opts.onEnd(ped, r || null, e); } catch (err) {} }
  }
  function cancel(ped) {
    const e = ped && ped._ladder;
    if (!e) return;
    const DM = D(); if (DM) { try { DM.cancel(ped); } catch (err) {} }
    finish(e, null);
  }

  /* ---- the player, as the ladder reads him ---------------------------- */
  const S = { dist: 99, speed: 0, armed: false, aiming: false, attacking: false, paid: false, inside: undefined, fled: false, handsUp: false };
  function read(e) {
    const P = CBZ.player, ped = e.ped;
    const dx = P.pos.x - ped.pos.x, dz = P.pos.z - ped.pos.z;
    S.dist = hyp(dx, dz);
    S.speed = P.driving ? 12 : (+P.speed || 0);
    S.armed = !!(CBZ.cityHasGun && CBZ.cityHasGun());
    // the gun on HIM (peds.js's gunpoint sweep marks the man in the cone)
    S.aiming = S.armed && !!ped._covered && !!(CBZ.isAimingWeapon && CBZ.isAimingWeapon());
    // a swing at him in reach, or he was just hit by the player
    S.attacking = ((P._fighting || 0) > 0 && S.dist < 2.6) || !!(ped.rage && ped.rage.isPlayer);
    S.paid = e.paid;
    S.inside = e.opts.inside ? !!e.opts.inside() : undefined;
    S.fled = !!P.driving && S.dist > 12;
    S.handsUp = !!g._citySurrender;
    return S;
  }

  /* ---- the body ------------------------------------------------------- */
  function hold(ped, P) {
    ped.state = "confront"; ped.speed = 0; ped.path = null;
    ped.target.set(ped.pos.x, 0, ped.pos.z);
    if (CBZ.cityPedFaceTo) CBZ.cityPedFaceTo(ped, P.pos.x, P.pos.z, 0.5);
  }
  function walkAt(ped, P, stopAt) {
    const dx = P.pos.x - ped.pos.x, dz = P.pos.z - ped.pos.z, d = hyp(dx, dz) || 1;
    if (d <= stopAt) { hold(ped, P); return; }
    ped.state = "confront"; ped.path = null;
    ped.target.set(P.pos.x - dx / d * stopAt * 0.8, 0, P.pos.z - dz / d * stopAt * 0.8);
  }
  function walkOff(ped, P) {
    let dx = ped.pos.x - P.pos.x, dz = ped.pos.z - P.pos.z;
    const d = hyp(dx, dz) || 1; dx /= d; dz /= d;
    ped.state = "walk"; ped.path = null; ped.pause = 0;
    ped.target.set(ped.pos.x + dx * 22, 0, ped.pos.z + dz * 22);
    ped.reactCD = Math.max(ped.reactCD || 0, 12);
  }
  function fight(ped) {
    const pa = PA();
    ped.poseAimBack = false;
    ped.rage = pa; ped.state = "fight"; ped.alarmed = Math.max(ped.alarmed || 0, 4);
    if (ped.target && pa) ped.target.set(pa.pos.x, 0, pa.pos.z);
  }
  // GRABBED AND THROWN OUT: his hands in your collar (CBZ.verbs grab, held a
  // beat, then thrown the way out). No verbs on the page: the old origins.js
  // toss, a ballistic launch through the physics air channel.
  function throwOut(e, P) {
    const ped = e.ped, pa = PA();
    let dir = e.opts.outDir ? e.opts.outDir() : null;
    if (!dir) { const dx = P.pos.x - ped.pos.x, dz = P.pos.z - ped.pos.z, d = hyp(dx, dz) || 1; dir = { x: dx / d, z: dz / d }; }
    const V = CBZ.verbs;
    let S0 = null;
    if (V && V.start && !P.driving) { try { S0 = V.start("grab", ped, pa, { holdFor: 0.7, then: "throw", dir: dir }); } catch (err) { S0 = null; } }
    if (!S0) {
      const ph = P._phys = P._phys || {};
      ph.air = true; ph.down = 0;
      ph.vx = dir.x * 5.2; ph.vz = dir.z * 5.2; ph.vy = 3.4; ph.spin = 5;
      if (CBZ.shake) CBZ.shake(0.25);
    }
    hold(ped, P);
  }

  function apply(e, r, P) {
    const ped = e.ped;
    const a = r.act;
    if (a) e.act = a;
    if (r.step === "act" || r.step === "done") {
      if (r.step === "act" && e.opts.onAct) { let h = false; try { h = !!e.opts.onAct(ped, r, e); } catch (err) {} if (h) return; }
      switch (a) {
        case "shoot": holster(ped, false); fight(ped); break;
        case "beat": case "chase":
          fight(ped);
          if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 12, "assault");
          if (e.kind === "rob") e.after = "take";
          break;
        case "throw": throwOut(e, P); e.after = "thrown"; break;
        case "shove": {
          const V = CBZ.verbs;
          if (V && V.start) { try { V.start("shove", ped, PA(), {}); } catch (err) {} }
          hold(ped, P);
          break;
        }
        case "flee": ped.poseAimBack = false; ped.state = "flee"; if (CBZ.cityFleeFrom) CBZ.cityFleeFrom(ped, P.pos.x, P.pos.z); ped.reactCD = Math.max(ped.reactCD || 0, 10); break;
        // a mugger walks off with it; a man on a post (a door, a corner, a
        // detail) just stands back down where he is
        case "leave": default: ped.poseAimBack = false; if (e.kind === "rob") walkOff(ped, P); else { ped.state = "idle"; ped.speed = 0; } break;
      }
      return;
    }
    switch (a) {
      case "approach": walkAt(ped, P, e.c.talkR || 1.8); break;
      case "close": walkAt(ped, P, 1.1); ped.poseAimBack = false; break;
      case "draw": case "aim": holster(ped, false); hold(ped, P); if (ped.armed) ped.poseAimBack = true; break;
      default: hold(ped, P);
    }
  }

  // after the act: a mugger who beat you down goes through your pockets; a
  // man thrown out who walks straight back in gets it again, harder
  function after(e, dt, P) {
    e.afterT += dt;
    const ped = e.ped;
    if (e.after === "take") {
      const down = (P.ko || 0) > 0 || (P._phys && P._phys.down > 0);
      const d = hyp(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z);
      if (down && d < 2.4 && !ped.dead && ped.rage) {
        const take = Math.min(g.cash | 0, Math.max(e.take, 10) * 2);
        if (take > 0 && CBZ.city) { CBZ.city.addCash(-take); ped.cash = (ped.cash || 0) + take; if (CBZ.sfx) CBZ.sfx("coin"); }
        ped.rage = null; ped.state = "flee"; if (CBZ.cityFleeFrom) CBZ.cityFleeFrom(ped, P.pos.x, P.pos.z);
        ped._mugFleeT = 5; ped.snitch = Math.min(ped.snitch || 0, 0.1);
        return true;
      }
      return e.afterT > 25 || ped.dead || !ped.rage;
    }
    if (e.after === "thrown") {
      if (e.afterT < 4.5) return false;
      if (e.opts.inside && e.opts.inside() && !ped.dead) {
        // he came back in: no more asking
        const o = Object.assign({}, e.opts, { start: "show", act: "beat" });
        ped._ladder = null;
        const ne = begin(ped, e.kind, o);
        if (ne && !ne.post) ne.post = e.post;
      }
      return true;
    }
    return true;
  }

  const AFTER = [];
  function step(dt) {
    T += dt;
    const P = CBZ.player, DM = D();
    if (!P || !DM) return;
    for (let i = LIVE.length - 1; i >= 0; i--) {
      const e = LIVE[i], ped = e.ped;
      const gone = !ped || (CBZ.cityPeds && CBZ.cityPeds.indexOf(ped) < 0);     // the city was rebuilt under him
      if (gone || ped.dead || ped.ko > 0 || ped.culled || P.dead || ped.surrender || ped.companion || ped.recruited) {
        if (gone) { if (ped) ped._ladder = null; LIVE.splice(i, 1); continue; }
        if (ped && ped.surrender) { try { DM.cancel(ped); } catch (err) {} }
        finish(e, null); continue;
      }
      // something else already started the fight (he was hit, his set rallied)
      if (ped.rage && !ped.rage.isPlayer) { try { DM.cancel(ped); } catch (err) {} finish(e, null); continue; }
      e.t += dt;
      let r = null;
      try { r = DM.step(ped, dt, read(e)); } catch (err) { r = null; }
      if (!r) { finish(e, null); continue; }
      apply(e, r, P);
      if (r.step === "act" || r.step === "done") {
        const keep = e.after;
        finish(e, r);
        if (keep) AFTER.push(e);
      }
    }
    for (let i = AFTER.length - 1; i >= 0; i--) { if (after(AFTER[i], dt, P)) AFTER.splice(i, 1); }
    // posted staff back onto the post, walking (never a pop)
    for (let i = BACK.length - 1; i >= 0; i--) {
      const b = BACK[i], ped = b.ped;
      b.t += dt;
      if (!ped || ped.dead || ped._ladder || ped.rage || ped.staffPost) { BACK.splice(i, 1); continue; }
      const d = hyp(ped.pos.x - b.post.x, ped.pos.z - b.post.z);
      if (d < 0.45 || b.t > 14) {
        if (d < 0.45) { ped.staffPost = b.post; ped.state = "idle"; ped.speed = 0; }
        BACK.splice(i, 1); continue;
      }
      ped.state = "walk"; ped.path = null; ped.target.set(b.post.x, 0, b.post.z);
    }
  }

  // peds.js think(): while he is on the ladder the routine brain stays off
  // him (his last answer is re-held; the step above is the decision)
  function holdThink(ped) {
    const e = ped._ladder;
    if (!e || LIVE.indexOf(e) < 0) { ped._ladder = null; return false; }
    if (ped.rage) return false;
    return true;
  }

  /* ---- the mugging: paying is a decision ------------------------------ */
  function pay(ped) {
    const e = ped && ped._ladder;
    if (!e || e.kind !== "rob") return false;
    const amt = Math.min(g.cash | 0, e.take);
    if (amt <= 0) return false;
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(-amt);
    ped.cash = (ped.cash || 0) + amt;
    if (CBZ.sfx) CBZ.sfx("coin");
    e.paid = true;
    ped.snitch = Math.min(ped.snitch || 0, 0.1);    // a robber does not call the cops on you
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 10, "robbery");
    return true;
  }
  let registered = false;
  function registerPay() {
    const I = CBZ.interactions;
    if (registered || !I || !I.register) return;
    registered = true;
    I.register("ped", {
      id: "ladder-pay", slot: "e", prio: 95,
      canShow: function (p) { const e = p && p._ladder; return !!(e && e.kind === "rob" && !e.paid && (g.cash | 0) > 0); },
      label: function (p) { const e = p._ladder; return "Pay $" + Math.min(g.cash | 0, e ? e.take : 0); },
      onSelect: function (p) { pay(p); },
    });
  }

  CBZ.cityLadder = {
    begin: begin, cancel: cancel, pay: pay, hold: holdThink,
    of: function (ped) { return (ped && ped._ladder) || null; },
    live: LIVE,
  };

  if (CBZ.onUpdate) CBZ.onUpdate((CBZ.PRIO && CBZ.PRIO.after) ? CBZ.PRIO.after(CBZ.PRIO.PED_BRAIN, 3) : 34.3, function (dt) {
    if (!g || !(CBZ.economyMode && CBZ.economyMode())) return;   // Gang City and the islands
    registerPay();
    if (g.state && g.state !== "playing") return;
    step(Math.min(0.1, dt || 0));
  });
})();
