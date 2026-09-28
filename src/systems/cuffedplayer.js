/* ============================================================
   systems/cuffedplayer.js — WHAT A MAN IN CUFFS CAN DO, AND HOW THE ROOM
   TAKES HIM.

   OWNER: "fix the appearance of handcuffs and what I'm capable of doing with
   handcuffs and how people treat me when I have handcuffs on. And in first
   person, I still see my hands even when I'm in handcuffs, which is dumb."

   THE QUESTION is CBZ.arrest.playerCuffed() (systems/arrest.js) — the one
   read every gate in every game asks. This file holds the numbers and the
   predicates those gates share, so the prison, the city and every mode that
   cuffs you answer the same way:

     BODY     walk 0.65x, a sprint that tops out at 0.75x of a free sprint
              with a stagger in it, stamina spent 1.6x as fast, and getting up
              off the floor takes 1/0.6 as long (systems/physics.js,
              city/mode.js read these).
     HANDS    none. No gun, no swing of a fist, no grenade, no hotbar, no
              picking anything up, no keyed door, no car door. The HAND KEYS
              below are swallowed at the window's capture phase while you are
              cuffed, so every listener and every polled key in the game
              agrees without each learning about cuffs. Space (the struggle,
              systems/arrest.js), WASD, Shift, the camera and the menus are
              never touched. A kick replaces the punch (systems/combat.js,
              city/combat.js). The CITY's E is not swallowed: city/
              interactions.js is the one registry there and it passes only
              options marked cuffOk (the booking desk), and refuses the rest.
     THE BAR  dimmed, grey and dead to clicks (body.cuffed, css/inventory.css)
              — no words, it just goes grey.
     PEOPLE   a cuffed man is not a threat (systems/brain.js capability/
              assess). The yard jeers, a rival might take one cheap shot or
              lift a smoke when no screw is close (systems/brain_prison.js);
              the street stops and stares and steps back (city/brain_city.js).
              pickTreatment() below is the one decision both read.

   Pure pieces (moveScale, sway, handKey, verbAllowed, pickTreatment) are
   checked in plain node by tools/cuffed-player-check.mjs.
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ = root.CBZ || {};
  const C = CBZ.cuffedPlayer = CBZ.cuffedPlayer || {};

  // ---- the body ----
  C.WALK = 0.65;          // x the free walk
  C.SPRINT = 0.75;        // x the free sprint (hands behind you: no arm drive)
  C.STAMINA = 1.6;        // x sprint drain
  C.GETUP = 0.6;          // x the rate the floor lets you go
  C.PITCH_UP = 1.0;       // rad: a cuffed man can still look round, not straight up/down
  C.PITCH_DOWN = -0.95;

  C.on = function () {
    const A = CBZ.arrest;
    if (A && typeof A.playerCuffed === "function") { try { return !!A.playerCuffed(); } catch (e) { return false; } }
    const pc = CBZ.playerChar;
    return !!(pc && pc.cuffed);
  };
  C.moveScale = function (cuffed, sprinting) {
    if (!cuffed) return 1;
    return sprinting ? C.SPRINT : C.WALK;
  };
  // the unsteady gait: a sideways fraction of the stride, bigger at a run
  // (no arms to balance with). Deterministic in t.
  C.sway = function (cuffed, sprinting, t) {
    if (!cuffed) return 0;
    const a = sprinting ? 0.17 : 0.05, w = sprinting ? 6.3 : 3.1;
    return a * Math.sin(t * w) + (sprinting ? 0.05 * Math.sin(t * 2.3 + 1.1) : 0);
  };
  C.staminaMul = function (cuffed) { return cuffed ? C.STAMINA : 1; };
  C.getUpMul = function (cuffed) { return cuffed ? C.GETUP : 1; };
  C.clampPitch = function (cuffed, p) {
    if (!cuffed) return p;
    return p < C.PITCH_DOWN ? C.PITCH_DOWN : p > C.PITCH_UP ? C.PITCH_UP : p;
  };

  // ---- the hands ----
  // keys only a free pair of hands answers: use/take (e), fire (f), grenade
  // (g), swap (q), reload (r), charge (b), ammo type (x), mask (t), homing
  // (h), ride (y), bag (i), the hotbar digits
  const HAND = { e: 1, f: 1, g: 1, q: 1, r: 1, b: 1, x: 1, t: 1, h: 1, y: 1, i: 1,
    1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 0: 1 };
  C.handKey = function (key, mode) {
    const k = String(key || "").toLowerCase();
    if (!HAND[k]) return false;
    // the city's [E] is the interaction registry's to refuse (it keeps the
    // booking desk usable in cuffs); every other hand key is the body's
    if (k === "e" && mode === "city") return false;
    return true;
  };
  C.barDisabled = function (cuffed) { return !!cuffed; };
  // prison card verbs that need hands (hand over, take, search, tie, cuff)
  const HAND_VERBS = { trade: 1, steal: 1, bribe: 1, payoff: 1, pay: 1, rob: 1, restrain: 1, detain: 1,
    search: 1, settle: 1, whand: 1, squash: 1, paySilence: 1, befriend: 0 };
  C.verbAllowed = function (v) { return !HAND_VERBS[v]; };

  // ---- the room ----
  C.LINES = {
    jeer: ["Look at this guy.", "Not so tough now.", "Bracelets suit you.", "Walk it off, big man."],
    street: ["Look at this guy.", "Keep walking.", "Wow.", "What'd he do?"],
    cheap: ["Not so tough now.", "That's for before."],
  };
  C.LINE_GAP = 10;        // s between any two lines about you, per game
  C.MAN_GAP = 120;        // s before the same man says anything again
  C.NOVELTY = 40;         // s: the room loses interest in you over this long
  C.CHEAP_GAP = 30;       // s between cheap shots
  C.STEAL_GAP = 45;       // s between lifts
  C.GUARD_R = 6;          // m: a screw/cop this close and nobody tries anything
  /* ONE decision for a man near you while you are cuffed.
       o = { dist, rival, aggression 0..1, guardNear, sinceLine, sinceCheap,
             sinceSteal, roll 0..1, canSteal, fade 0..1 }
     -> "cheap" | "steal" | "jeer" | null. Rare by construction: `roll` is one
     die per man per poll (the caller polls at ~1 Hz), and `fade` (novelty())
     shrinks the chance of a line the longer you have been walking round in
     cuffs — the room notices, then it stops caring. */
  C.pickTreatment = function (o) {
    if (!o || !(o.dist >= 0)) return null;
    const r = o.roll == null ? 1 : o.roll;
    const quiet = !o.guardNear;
    if (quiet && o.rival && (o.aggression || 0) >= 0.6 && o.dist < 2.2 && (o.sinceCheap == null || o.sinceCheap >= C.CHEAP_GAP) && r < 0.06) return "cheap";
    if (quiet && o.rival && o.canSteal && o.dist < 1.8 && (o.sinceSteal == null || o.sinceSteal >= C.STEAL_GAP) && r >= 0.06 && r < 0.10) return "steal";
    const w = (o.rival ? 0.08 : 0.04) * (o.fade == null ? 1 : o.fade);
    if (o.dist < 7 && (o.sinceLine == null || o.sinceLine >= C.LINE_GAP) && r >= 0.80 && r < 0.80 + w) return "jeer";
    return null;
  };
  // 1 when the cuffs have just gone on, easing to 0.15 after NOVELTY seconds
  C.novelty = function (cuffedFor) { return Math.max(0.15, 1 - Math.max(0, cuffedFor || 0) / C.NOVELTY); };
  C.pick = function (list, roll) { return list[Math.min(list.length - 1, Math.floor((roll || 0) * list.length))]; };

  // ---- browser wiring ----
  if (typeof document === "undefined" || typeof addEventListener !== "function") {
    if (typeof module !== "undefined" && module.exports) module.exports = C;
    return;
  }
  function playing() { const g = CBZ.game; return !!(g && g.state === "playing"); }
  /* THE HANDS GATE. Window, capture phase, registered before input.js and
     every game module, so a swallowed key never reaches a listener or the
     polled CBZ.keys map. A key already down when the cuffs went on is let go. */
  addEventListener("keydown", function (e) {
    if (!playing() || !C.on()) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (CBZ.cityMenuOpen || (CBZ.fullMap && CBZ.fullMap.active)) return;   // a map / a panel owns its own keys
    if (!C.handKey(e.key, CBZ.game.mode)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  let was = false;
  function tick() {
    const on = playing() && C.on();
    if (on === was) return;
    was = on;
    if (document.body) document.body.classList.toggle("cuffed", on);
    const K = CBZ.keys;
    if (on && K) for (const k in HAND) { if (!(k === "e" && CBZ.game.mode === "city")) K[k] = false; }
  }
  if (typeof CBZ.onAlways === "function") CBZ.onAlways(10, tick);
  else setInterval(tick, 100);
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})();
