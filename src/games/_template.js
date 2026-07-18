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
  let C = null, S = null;
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
      ctx.idle && host.ped && host.ped.char && 0; // (idle bob comes free on peds)

      // the entry point: one zone, one panel
      ctx.zone({
        id: "play", label: "[E] Play MY GAME", pos: [0, -1.2], r: 1.6,
        onUse: () => openPanel(),
      });
    },

    update(ctx, dt) {
      // per-frame sim while mounted (keep it cheap; gate on proximity if heavy)
    },

    /* probe surface — your check tool asserts THROUGH this */
    api: {
      rules: { scoreFor },
      state: () => (S ? JSON.parse(JSON.stringify(S)) : null),
      open: () => C && openPanel(),
    },
  });

  function openPanel() {
    const s = bag();
    C.hud.panel(
      "<b style='letter-spacing:2px;color:#e8b64c'>MY GAME</b>" +
      "<div style='margin:6px 0'>Best: " + s.best + " · Cash $" + C.wallet.cash().toLocaleString() + "</div>" +
      "<span data-act='go' style='display:inline-block;padding:9px 16px;border-radius:11px;background:#1c6b40;font-weight:800;cursor:pointer'>PLAY $25</span>" +
      "<span data-act='close' style='display:inline-block;padding:9px 16px;border-radius:11px;background:#26343c;font-weight:800;cursor:pointer;margin-left:6px'>Leave</span>",
      {
        go: () => {
          if (!C.wallet.spend(25, "MY GAME buy-in")) return;
          const won = Math.random() < 0.5; // runtime RNG is fine
          if (won) { C.wallet.give(60, "MY GAME payout"); C.hud.toast("WINNER"); }
          const s2 = bag(); s2.plays++; if (won) s2.best++; C.saveState();
          openPanel();
        },
        close: () => C.hud.closePanel(),
      }
    );
  }
})();
