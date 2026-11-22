/* ============================================================
   games/_template.js — COPY THIS FILE to make a new game.
   (Not loaded by index.html — the underscore means template.)

   This is the whole point of the platform: you do NOT build NPCs,
   physics, money, HUD, interactions, or a world. They exist. You add
   a ROLE, a GOAL, an ARC, and the venue dressing that serves them.
   The second game on any sim should cost a few hundred lines.

   TO SHIP A GAME:
     1. cp src/games/_template.js src/games/<id>.js  (one file, that's it)
     2. Fill the register() call below.
     3. Add <script src="src/games/<id>.js?v=pkg1"></script> to
        index.html next to the other packages.
     4. Iterate live: PORT=8877 python3 tools/devserver.py
        → http://127.0.0.1:8877/games/dev.html?pkg=<id>
     5. Gates: node --check, node tools/smoke-play.mjs 10
        ("invariants: ok", baseline-only errors), plus a CDP probe
        asserting YOUR rules (copy tools/demolition-check.mjs's
        boilerplate; expose test hooks on `api`).

   LAWS (violating any = rejected in review):
     - WHY rule: every prop is interactable or load-bearing. No garnish.
     - NPCs are ctx.npc() — real city peds (brain, wardrobe, gunpoint
       hands-up, real death). Never hand-roll a rig.
     - Missing generic capability (a pose, an anim, a service)? Grow the
       ENGINE (packages.js facade / entities/poses.js), never fork it.
     - Determinism: build paths use ctx.rand/ctx.stream only.
       Runtime gameplay RNG may use Math.random.
     - One flag: CBZ.CONFIG.PKG_<ID> (default ON) — one-line revert.
     - Real money: ctx.wallet (city cash). Stakes make it a game.
     - Roles, not one-shots: if the sim supports an opposing role
       (jailor/inmate, shark/swimmer), ship both from day one.
     - SPEECH LAW: a person's words go over THEIR head: the npc handle's
       .say(line) (or CBZ.speech.say(actor, line); a phone/PA voice is
       CBZ.speech.phone(line)). Never put an NPC's line, "X says...",
       or reported speech in ctx.hud.feed or ctx.hud.toast.
       NO PANELS: what the player does is a verb on a person or a thing
       (ctx.zone({ verbs }), CBZ.interactions.registerFor on a cast ped),
       what he reads is a sheet he holds (CBZ.cityPaper).
       No popups that explain the game: people talk, the world shows.
       On-screen text: no em dashes, no middle dots.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_MYGAME == null) CBZ.CONFIG.PKG_MYGAME = true;

  /* ---- pure rules first: plain functions, unit-testable via api ---- */
  function scoreFor(thing) { return thing * 10; }

  /* ---- session state (persisted via ctx.state) ---- */
  let C = null, S = null, HOST = null;
  function bag() { return S || (S = C.state(() => ({ best: 0, plays: 0 }))); }

  CBZ.games.register({
    id: "mygame",
    title: "MY GAME",

    /* venue — pick ONE:
       { lotKind: "casino" }   claim the flagship city lot of a kind
       { site: "x", resolve(CBZ) { return {x, z} | null } }  open-world anchor
       (resolve is retried until the world can answer)               */
    venue: { lotKind: "bar" },

    build(ctx, venue) {
      C = ctx;
      const g = venue.group; // LOCAL coords; group sits at the venue origin

      // dressing: only load-bearing props (WHY rule)
      ctx.box(g, 0, 0.5, 0, 1.2, 1.0, 0.6, ctx.mat(0x4a2e1c)); // the counter the game runs on
      ctx.solid(-0.7, -0.4, 0.7, 0.4);
      ctx.light(0, 3.0, 0, 0xffca72, 0.8, 8);

      // cast: REAL peds — role, fit, post, pose, lines
      const host = ctx.npc({
        role: "vendor", at: [0, 0.9], face: Math.PI, post: "pinned", pose: "stand",
        dialogue: ["Step up. House rules are simple.", "Winners talk less."],
        name: "The Host",
      });
      HOST = host;
      ctx.idle && host.ped && host.ped.char && 0; // (idle bob comes free on peds)

      // the entry point: the host is a person, and what you do is asked of
      // HIM (a person in front of you is the card's target before any spot
      // on the floor). The same verb is on the spot too, for a venue whose
      // host is dead. There is no panel: ctx.zone({ verbs }) and
      // CBZ.interactions.registerFor are the whole surface.
      const play = { id: "play", slot: "e", label: () => keep("Play, $25"), canShow: () => true, onSelect: () => playOnce() };
      ctx.zone({ id: "table", name: "MY GAME", note: () => "Best " + bag().best, pos: [0, -1.2], r: 1.6, verbs: [play] });
      if (host.ped && CBZ.interactions && CBZ.interactions.registerFor) {
        CBZ.interactions.registerFor(host.ped, { id: "mygame-play", prio: 90, forceYes: true, label: play.label, onSelect: () => playOnce() });
      }

      // ---- the WORLD verbs: you do not build weather, sea or a clock ----
      // COORDINATE LAW: what you BUILD is venue-LOCAL (above); what you ASK
      // ABOUT THE WORLD is WORLD-space (below). ctx.toWorld/ctx.toLocal cross.
      ctx.time.set("dusk");            // moves the sky AND the ped schedule
      ctx.weather("storm", 90);        // named sky, held 90s, then released
      // ctx.weather("clear")          // hand the sky back to ambient
      // ctx.time.advance(0.5)         // roll the clock half a day forward
      // ctx.time.day() / .hour() / .isNight() / .phase()
      // ctx.water.at(wx,wz) .depth() .surfaceY() .bedY() .navigable()
      // ctx.water.nearest(wx,wz,min,max)   snap a prop to genuine water
      // ctx.water.flood(1.2, 40)           raise the REAL field — never a plane
    },

    update(ctx, dt) {
      // per-frame sim while mounted (keep it cheap; gate on proximity if heavy)
    },

    /* probe surface — your check tool asserts THROUGH this */
    api: {
      rules: { scoreFor },
      state: () => (S ? JSON.parse(JSON.stringify(S)) : null),
      play: () => C && playOnce(),
    },
  });

  // a label that prints as written (city/verbword.js would cut it to its verb)
  function keep(s) { const VW = CBZ.cityVerbWord; if (VW && VW.keep) VW.keep(s); return s; }
  // one play: money to the host, his line over his head, the result said by him
  function playOnce() {
    if (!C.wallet.spend(25)) { if (HOST && HOST.say) HOST.say("Twenty-five to play."); return; }
    const won = Math.random() < 0.5; // runtime RNG is fine
    if (won) C.wallet.give(60);
    if (HOST && HOST.say) HOST.say(won ? "Winner. Sixty to you. Don't get used to it." : "House takes it.");
    const s = bag(); s.plays++; if (won) s.best++; C.saveState();
  }
})();
