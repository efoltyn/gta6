/* ============================================================
   systems/gungamehud.js — the GUN GAME ladder HUD.

   THE GRADIENT IS THE HUD. Gun game's whole why is "one kill from the next
   gun", so the panel shows exactly that, always: the rung you are ON, the
   kill pips left on it, and the weapon you are ONE KILL FROM — plus the
   leader's rung, because a race you can't see isn't a race. While you are
   dead it counts the respawn down. HP/stamina reuse the shared #survBars
   (css/screens.css shows them under body.mode-gungame), same as survival.

   DOM discipline copied from survivalhud.js: writes go to prebuilt nodes,
   gated on the mode, no per-frame innerHTML, no new popup class — kills
   already narrate through city/killfeed.js's corner feed.

   ---- 2026-08-04: THE LABELS WERE THE PANEL (GUNGAME_HUD_TERSE) ------------
   OWNER, verbatim: "gun game has MASSIVE HUD SPACE WASTED ON FUCKING WORDS
   THAT DONT EVER CHANGE — COMPLETELY BREAKS FOURTH WALL."

   Measured on the shipped panel, mid-match, five stacked lines:
       RUNG 3/9 — COMPACT SMG
       NEXT: 12G PUMP
       LEADER: You
   Fifty-one characters, of which "RUNG", "/9", "—", "NEXT:", "LEADER:" and
   "You" — thirty-one — say the same thing in every frame of every match ever
   played. Worse, the two that DID carry news were the ones being pushed down
   the screen by them, and "LEADER: You" is a whole line spent announcing that
   nothing is wrong.

   Every number survives; the sentences around them do not. The panel is one
   short row: the rung as a bare fraction, the gun you are one kill from behind
   a climb arrow, and — only while somebody is actually ahead of you — that
   person's name and rung. Nobody ahead prints nothing at all, because the
   absence of a threat is not a readout. GUNGAME_HUD_TERSE=false restores the
   five labelled lines exactly.

   ---- 2026-08-05: THE ROW IS GONE (GUNGAME_HUD_PANEL=false) ----------------
   OWNER, on the row sitting just above the hotbar: "it has this pop up right
   above the gun that says, like, what gun you're on. Remove that. You know
   what gun you're on because you're holding it in your hand."

   Told that the ▲ gun is the NEXT rung and not the one in his hands, the
   verdict did not move: kill the whole row. That is the honest read of the
   2026-08-04 terse pass too — that wave cut the row from fifty-one characters
   to about fourteen and the row STILL read as clutter, which is the shape of a
   readout nobody was looking at rather than one that was merely too wordy. The
   gradient survives where it always actually lived: the gun in your hands
   changes category the instant you climb a rung, killfeed narrates the kill,
   and the timer is already top-right. A panel that restates all three is the
   fourth wall.

   The BARS still write. #survBars (HP/stamina) is shared arena furniture that
   survival draws too — it was never part of the row and returning early out of
   this tick would have blanked it. So the panel is what is gated; the bar
   writes below run in every gungame frame exactly as before.

   GUNGAME_HUD_PANEL=true rebuilds the row (and GUNGAME_HUD_TERSE still picks
   which of the two layouts it rebuilds), so both of the owner's past calls on
   this panel stay one line apart.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const hud = document.getElementById("hud");
  if (!hud) return;
  // declared HERE, in the owning file (CLAUDE.md: config.js is an Edit-race file)
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GUNGAME_HUD_TERSE == null) CBZ.CONFIG.GUNGAME_HUD_TERSE = true;
  // OFF by default as of 2026-08-05 — see the block comment above. The node is
  // never even created, so there is nothing for the DOM (or a screenshot) to
  // find; flipping this true is the whole revert.
  if (CBZ.CONFIG.GUNGAME_HUD_PANEL == null) CBZ.CONFIG.GUNGAME_HUD_PANEL = false;
  const PANEL = CBZ.CONFIG.GUNGAME_HUD_PANEL === true;

  // built once, hidden by CSS outside body.mode-gungame.state-playing
  let root = null, nowEl = null, pipsEl = null, nextEl = null, leadEl = null, spawnEl = null;
  if (PANEL) {
    root = document.createElement("div");
    root.id = "gungameHud";
    // one ROW of cells (terse) vs the legacy stack of five lines. The class is
    // what css/screens.css hangs the row layout off, so the flag flips both
    // halves of the change together.
    if (CBZ.CONFIG.GUNGAME_HUD_TERSE !== false) root.className = "gg-terse";
    nowEl = document.createElement("div"); nowEl.className = "gg-now";
    pipsEl = document.createElement("div"); pipsEl.className = "gg-pips";
    nextEl = document.createElement("div"); nextEl.className = "gg-next";
    leadEl = document.createElement("div"); leadEl.className = "gg-lead";
    spawnEl = document.createElement("div"); spawnEl.className = "gg-spawn";
    root.appendChild(nowEl); root.appendChild(pipsEl); root.appendChild(nextEl);
    root.appendChild(leadEl); root.appendChild(spawnEl);
    hud.appendChild(root);
  }

  const el = {
    hp: document.getElementById("hpBar"),
    stam: document.getElementById("stamBar"),
  };

  // cache the last written strings — a HUD that re-writes identical
  // textContent every frame is layout work for nothing (survivalhud's rule).
  const last = { now: "", pips: "", next: "", lead: "", spawn: "" };
  function put(node, key, v) { if (last[key] !== v) { last[key] = v; node.textContent = v; } }

  function rungLabelAt(i) {
    const L = (CBZ.CONFIG && CBZ.CONFIG.GUNGAME_LADDER) || [];
    const r = L[i];
    if (!r) return null;
    if (r.melee) return "BARE FISTS";
    const w = CBZ.weaponById && CBZ.weaponById(r.id);
    return (w && w.label) || r.name || r.id;
  }

  CBZ.onUpdate(49.2, function () {
    const g = CBZ.game;
    if (!g || g.mode !== "gungame") return;
    const gg = CBZ.gungame;
    if (!gg || !gg.match) return;
    if (PANEL) panel(gg);

    // shared arena bars (survivalhud's exact write). NOT part of the row —
    // these are #survBars, drawn for survival too, so they write either way.
    if (el.hp) {
      const h = Math.max(0, CBZ.player.hp);
      el.hp.style.width = h + "%";
      el.hp.style.background = h > 50 ? "#3ad17a" : (h > 22 ? "#ffd451" : "#ff4d4d");
    }
    if (el.stam) {
      el.stam.style.width = Math.max(0, CBZ.player.stamina || 0) + "%";
      el.stam.style.background = "#5bc8ff";
    }
  });

  function panel(gg) {
    const L = (CBZ.CONFIG && CBZ.CONFIG.GUNGAME_LADDER) || [];
    const total = L.length || 1;
    const r = gg.playerRung;
    const isFinal = r >= total - 1;
    const need = isFinal ? 1 : Math.max(1, (CBZ.CONFIG.GUNGAME_KILLS_PER_RUNG | 0) || 1);

    const terse = CBZ.CONFIG.GUNGAME_HUD_TERSE !== false;

    put(nowEl, "now", terse
      ? (r + 1) + "/" + total
      : "RUNG " + (r + 1) + "/" + total + " — " + (rungLabelAt(r) || "?"));
    // kill pips on this rung (● done ○ to go) — omitted when one kill a rung
    let pips = "";
    if (need > 1) for (let i = 0; i < need; i++) pips += (i < gg.playerRungKills ? "●" : "○") + (i < need - 1 ? " " : "");
    put(pipsEl, "pips", pips);
    // THE GRADIENT. The next gun is the only thing on this panel a player
    // actually plays toward, so it is the only thing that gets to be big — and
    // the arrow does the work "NEXT:" was doing.
    put(nextEl, "next", isFinal
      ? (terse ? "FINAL" : "FINAL RUNG, one kill wins")
      : (terse ? "▲ " : "NEXT: ") + (rungLabelAt(r + 1) || "?"));

    // the race: whoever holds the highest rung. Ties go to you (you can see
    // your own screen; the line is for the threat).
    let lead = null;
    for (const b of gg.bots) if (!lead || b.rung > lead.rung || (b.rung === lead.rung && b.kills > lead.kills)) lead = b;
    const ahead = lead && lead.rung > r;
    put(leadEl, "lead", terse
      // nobody ahead → no cell. `.gg-lead:empty` is display:none.
      ? (ahead ? lead.name + " " + (lead.rung + 1) : "")
      : (ahead ? "LEADER: " + lead.name + " · rung " + (lead.rung + 1) + "/" + total : "LEADER: You"));

    put(spawnEl, "spawn", CBZ.player.dead && gg.respawnT > 0
      ? (terse ? String(Math.ceil(gg.respawnT)) : "RESPAWN IN " + Math.ceil(gg.respawnT))
      : "");
  }
})();
