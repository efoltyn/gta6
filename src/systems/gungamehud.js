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
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const hud = document.getElementById("hud");
  if (!hud) return;

  // built once, hidden by CSS outside body.mode-gungame.state-playing
  const root = document.createElement("div");
  root.id = "gungameHud";
  const nowEl = document.createElement("div"); nowEl.className = "gg-now";
  const pipsEl = document.createElement("div"); pipsEl.className = "gg-pips";
  const nextEl = document.createElement("div"); nextEl.className = "gg-next";
  const leadEl = document.createElement("div"); leadEl.className = "gg-lead";
  const spawnEl = document.createElement("div"); spawnEl.className = "gg-spawn";
  root.appendChild(nowEl); root.appendChild(pipsEl); root.appendChild(nextEl);
  root.appendChild(leadEl); root.appendChild(spawnEl);
  hud.appendChild(root);

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
    const L = (CBZ.CONFIG && CBZ.CONFIG.GUNGAME_LADDER) || [];
    const total = L.length || 1;
    const r = gg.playerRung;
    const isFinal = r >= total - 1;
    const need = isFinal ? 1 : Math.max(1, (CBZ.CONFIG.GUNGAME_KILLS_PER_RUNG | 0) || 1);

    put(nowEl, "now", "RUNG " + (r + 1) + "/" + total + " — " + (rungLabelAt(r) || "?"));
    // kill pips on this rung (● done ○ to go) — omitted when one kill a rung
    let pips = "";
    if (need > 1) for (let i = 0; i < need; i++) pips += (i < gg.playerRungKills ? "●" : "○") + (i < need - 1 ? " " : "");
    put(pipsEl, "pips", pips);
    put(nextEl, "next", isFinal
      ? "FINAL RUNG — one kill wins"
      : "NEXT: " + (rungLabelAt(r + 1) || "?"));

    // the race: whoever holds the highest rung. Ties go to you (you can see
    // your own screen; the line is for the threat).
    let lead = null;
    for (const b of gg.bots) if (!lead || b.rung > lead.rung || (b.rung === lead.rung && b.kills > lead.kills)) lead = b;
    put(leadEl, "lead", lead && lead.rung > r
      ? "LEADER: " + lead.name + " — rung " + (lead.rung + 1) + "/" + total
      : "LEADER: You");

    put(spawnEl, "spawn", CBZ.player.dead && gg.respawnT > 0
      ? "RESPAWN IN " + Math.ceil(gg.respawnT)
      : "");

    // shared arena bars (survivalhud's exact write)
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
})();
