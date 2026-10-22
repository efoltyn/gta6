/* ============================================================
   systems/prisonvoice.js - THE BLOCK ANSWERS WHAT IT SEES.

   The prison's half of CBZ.voice (systems/voice.js). No pools of its own:
   every word comes out of the one picker, in the speaker's role (an inmate
   says "Put that away.", a CO "Drop it!").

     CBZ.prisonVoice.react(actor) -> a line or null. economy.js talk() and
                                     quests.js ask this first, so a man you
                                     walk up to answers the thing in front of
                                     him: the gun in your hand, the blood on
                                     you. Null means he has nothing to say.
     the tick                     -> events, never a timer: a man who sees a
                                     piece come out (seeGun), the people who
                                     watched you drop somebody (seeHit).

   Deleted (owner, 2026-10-22: "random dumb dialogue sucks"): the CO's
   procedure chatter, "Fresh fish", the yard code lectures, inmates to a
   player in uniform, "Saw what you did to him" on a die.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});

  function escape() { const g = CBZ.game; return !!(g && g.mode === "escape" && g.state === "playing"); }
  function guardish(a) { return !!(a && (a.kind === "guard" || a.kind === "warden")); }
  function up(a) { return !!(a && a.group && !a.dead && !(a.ko > 0) && !a.escaped && !a.asleep && !a.tied); }
  function held() {
    const w = CBZ.equippedWeapon ? CBZ.equippedWeapon() : null;
    if (!w) return null;
    if (w.melee) return (w.id === "fists" || w.key === "fists") ? null : "blade";
    return "gun";
  }
  function hurt() { const P = CBZ.player; return !!(P && P.hp != null && P.hp < 45 && !P.dead); }

  /* Face to face. The gun beats the blood. A CO says nothing to your face
     about either: he cuffs you for it, elsewhere. */
  function react(actor) {
    if (!actor || !escape() || !CBZ.voice) return null;
    if (guardish(actor) || (CBZ.game && CBZ.game.role === "cop")) return null;
    const h = held();
    if (h) return CBZ.voice.line(actor, "seeGun", { by: CBZ.player });
    if (hurt()) return CBZ.voice.line(actor, "seeBlood", { by: CBZ.player });
    return null;
  }

  // ---- events -------------------------------------------------------------
  let kos = 0, heldWas = null, tickT = 0;
  function tick(dt) {
    if (!escape()) { kos = (CBZ.game && CBZ.game.kos) || 0; heldWas = null; return; }
    const V = CBZ.voice;
    if (!V) return;
    const g = CBZ.game, P = CBZ.player;
    if (!P || !P.pos || P.dead) return;
    // a put-down happened: the people who saw it answer it
    const k = g.kos || 0;
    if (k > kos) V.witness(P.pos.x, P.pos.z, "seeHit", { by: P }, 11);
    kos = k;
    // a weapon came OUT: the men in sight of it read it (most say nothing)
    tickT -= dt;
    const h = held();
    if (h !== heldWas || (h && tickT <= 0)) {
      heldWas = h;
      tickT = 6;
      if (h) V.witness(P.pos.x, P.pos.z, "seeGun", { by: P, why: h === "gun" ? "gun" : null }, h === "gun" ? 16 : 7);
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(40.7, tick);

  // who is around a spot, for CBZ.voice's witnesses and its panic-by-sight
  function prisonNear(x, z, r, out) {
    const r2 = r * r, L = [CBZ.npcs || [], CBZ.guards || []];
    for (let k = 0; k < 2; k++) {
      const list = L[k];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!up(a)) continue;
        const p = a.group.position, dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < r2) out.push(a);
      }
    }
    return out;
  }
  if (CBZ.voice) CBZ.voice.setNear(prisonNear, "prison");

  CBZ.prisonVoice = { react: react, up: up };
})();
