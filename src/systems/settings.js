/* ============================================================
   systems/settings.js — PAUSE / SETTINGS panel: performance + NPC
   population controls.

   WHY THIS FILE EXISTS: the pause screen (index.html #pause) was a single
   "Resume" button — no options UI anywhere in the codebase. This adds one,
   injected into the existing #pause card at runtime (same trick
   systems/state.js's ensureStreetsBtn uses for the win screen) so index.html
   never needs editing.

   THE ONE RULE THAT SHAPES EVERYTHING HERE — MP-SAFETY (see GO-LIVE.md):
   this client may be the elected multiplayer sim-host, in which case
   core/loop.js only runs the world sim (NPCs/traffic/physics/crowd) while
   `g.state === "playing"`. Flipping state away from "playing" FREEZES THE
   SHARED WORLD FOR EVERY CONNECTED GUEST, not just the local view. The panel
   must therefore NEVER call CBZ.setState. Opening it only does two things:
   exitPointerLock() (so the OS cursor is free to click sliders) and shows the
   DOM panel — g.state is untouched. To stop camera.js's existing
   pointerlockchange handler from auto-pausing on that exitPointerLock() call,
   we set CBZ.settingsOpen = true BEFORE calling it, and camera.js's
   exemption check (~line 119) was extended to skip setState("paused") while
   that flag is set — exactly the same escape hatch city/phone.js and
   systems/fullmap.js already use via CBZ.cityMenuOpen / CBZ.fullMap.active.
   A dedicated flag is used (not cityMenuOpen) since that flag may carry other
   city-only semantics elsewhere.

   THREE CONTROL TIERS, each honestly labelled per its real constraint
   (see core/quality.js + src/config.js / entities/ambientstate.js):
     1) QUALITY (0..N-1 tier slider + Auto/Manual toggle). Genuinely live:
        core/quality.js's qLevel/applyQuality() are already called every
        adaptive-sampler window, so a manual pick just calls the same
        applyQuality() once and (new) sets CBZ.qualityLocked so the sampler
        leaves it alone. The max selectable tier is capped at the LIVE
        host-aware ceiling (CBZ.qualityTopTier()) so a host can never pick a
        tier the sampler would silently revert.
     2) CROWD DENSITY (live). CBZ.crowdRenderBudget is the close-rig render
        cap already wired through applyQuality()/refreshCrowdBudget() — this
        slider writes it directly and calls refreshCrowdBudget(), no reload.
     3) TOTAL POPULATION (next-boot only, clearly labelled). CBZ.MASS_CROWD /
        CBZ.CROWD_RIG_CAP (src/config.js) are read ONCE at module load into
        fixed-size typed arrays (src/entities/ambientstate.js) with no
        resize/rebuild API — this is NOT a live knob. The slider writes a
        persisted override to localStorage that a future boot can pick up;
        it does not pretend to apply instantly.

   PERSISTENCE: a dedicated small localStorage key (CBZ_SETTINGS_V1), kept
   separate from the heavy per-world save blob (city/worldstate.js) and from
   the population override key (CBZ_POP_OVERRIDE_V1, read at next boot).

   KEY BINDING: [Escape] toggles the panel (only meaningful from the pause
   screen reachable today — see openFromPause()). The panel can also be
   opened directly via the new "Settings" button injected into #pause.

   Exposes: CBZ.settingsOpen (bool flag, see above), CBZ.openSettings(),
   CBZ.closeSettings().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return; // headless-safe (tools/harness.js)
  const g = CBZ.game;

  // ---- persistence ----------------------------------------------------------
  const PREF_KEY = "CBZ_SETTINGS_V1";       // quality/crowd-density/auto choices
  const POP_KEY = "CBZ_POP_OVERRIDE_V1";    // total-population override, read at next boot

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (!raw) return {};
      const o = JSON.parse(raw);
      return (o && typeof o === "object") ? o : {};
    } catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {}
  }
  let prefs = loadPrefs();

  function loadPopOverride() {
    try {
      const raw = localStorage.getItem(POP_KEY);
      if (!raw) return null;
      const n = parseInt(raw, 10);
      return (isFinite(n) && n > 0) ? n : null;
    } catch (e) { return null; }
  }
  function savePopOverride(n) {
    try {
      if (n == null) localStorage.removeItem(POP_KEY);
      else localStorage.setItem(POP_KEY, String(n | 0));
    } catch (e) {}
  }

  // ---- apply persisted prefs on THIS boot (the live-applicable ones only) --
  // Quality: only force a manual tier if the player previously chose Manual;
  // default (no saved prefs, or auto:true) leaves today's adaptive behaviour
  // completely untouched — byte-identical for anyone who never opens the panel.
  function applyStartupPrefs() {
    if (prefs.auto === false && typeof prefs.qLevel === "number" && CBZ.setQualityLevel) {
      CBZ.qualityLocked = true;
      CBZ.setQualityLevel(prefs.qLevel);
    }
    if (typeof prefs.crowdBudget === "number") {
      CBZ.crowdRenderBudget = Math.max(0, prefs.crowdBudget | 0);
      if (CBZ.refreshCrowdBudget) CBZ.refreshCrowdBudget();
    }
  }
  applyStartupPrefs();

  // ---- quality tier labels ----------------------------------------------
  // Match core/quality.js's QUALITY_LABELS — this panel is now the ONLY
  // performance surface (the old pause-card slider was removed), so the two
  // vocabularies must not diverge.
  const TIER_LABELS = ["Fastest", "Fast", "Balanced", "High", "Best"];
  function tierLabel(i) { return TIER_LABELS[i] || ("Tier " + i); }

  // ---- DOM --------------------------------------------------------------
  let panel = null, open_ = false;

  function rangeRow(id, label, min, max, step, value, disabled) {
    return "<div class='stg-row'>" +
      "<label for='" + id + "'>" + label + "</label>" +
      "<input type='range' id='" + id + "' min='" + min + "' max='" + max + "' step='" + step + "' value='" + value + "'" + (disabled ? " disabled" : "") + ">" +
      "<span class='stg-val' id='" + id + "Val'></span>" +
      "</div>";
  }

  function build() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "settingsPanel";

    panel.innerHTML =
      "<div class='stg-head'>" +
        "<div class='stg-title'>SETTINGS</div>" +
        "<div class='stg-hint'>Close <b>[Esc]</b></div>" +
      "</div>" +
      "<div class='stg-section'>" +
        "<h4>PERFORMANCE — QUALITY</h4>" +
        "<div class='stg-row'>" +
          "<label for='stgAuto'>Auto (adaptive)</label>" +
          "<input type='checkbox' id='stgAuto'>" +
        "</div>" +
        rangeRow("stgQuality", "Quality tier", 0, 4, 1, 4, false) +
        "<div class='stg-note' id='stgQualityNote'></div>" +
      "</div>" +
      "<div class='stg-section'>" +
        "<h4>NPC POPULATION</h4>" +
        rangeRow("stgCrowdDensity", "Crowd density (visible nearby)", 0, 1600, 20, 720, false) +
        "<div class='stg-note'>Live — applies immediately.</div>" +
        rangeRow("stgTotalPop", "Total population", 60, 900, 20, 140, false) +
        "<div class='stg-note warn'>Applies next time you load in — not instant (total population is fixed at boot).</div>" +
      "</div>" +
      "<button class='stg-close' id='stgCloseBtn'>Done</button>";

    document.body.appendChild(panel);

    // ---- wire controls ----
    const elAuto = panel.querySelector("#stgAuto");
    const elQ = panel.querySelector("#stgQuality");
    const elQVal = panel.querySelector("#stgQualityVal");
    const elQNote = panel.querySelector("#stgQualityNote");
    const elDensity = panel.querySelector("#stgCrowdDensity");
    const elDensityVal = panel.querySelector("#stgCrowdDensityVal");
    const elPop = panel.querySelector("#stgTotalPop");
    const elPopVal = panel.querySelector("#stgTotalPopVal");

    function refreshQualityUI() {
      const tierCount = CBZ.qualityTierCount || 5;
      const top = CBZ.qualityTopTier ? CBZ.qualityTopTier() : (tierCount - 1);
      elQ.max = String(tierCount - 1);
      const auto = !CBZ.qualityLocked;
      elAuto.checked = auto;
      elQ.disabled = auto;
      const lvl = Math.min((CBZ.getQualityLevel ? CBZ.getQualityLevel() : (tierCount - 1)), top);
      elQ.value = String(lvl);
      elQVal.textContent = tierLabel(lvl) + (lvl >= top && top < tierCount - 1 ? " (capped)" : "");
      elQNote.textContent = (top < tierCount - 1)
        ? "Hosting multiplayer caps the top tier at " + tierLabel(top) + " right now."
        : "";
    }
    function refreshDensityUI() {
      const v = (typeof CBZ.crowdRenderBudget === "number") ? CBZ.crowdRenderBudget : 720;
      elDensity.value = String(v);
      elDensityVal.textContent = String(v | 0);
    }
    function refreshPopUI() {
      const override = loadPopOverride();
      const current = (typeof CBZ.MASS_CROWD === "number") ? CBZ.MASS_CROWD : 140;
      const v = override != null ? override : current;
      elPop.value = String(Math.max(60, Math.min(900, v)));
      elPopVal.textContent = elPop.value + (override != null && override !== current ? " (pending reload)" : "");
    }

    elAuto.addEventListener("change", function () {
      const auto = elAuto.checked;
      CBZ.qualityLocked = !auto;
      // qualityAuto is the pause-slider's pin flag; both gate the sampler, so
      // flipping back to Auto must release BOTH and clear the persisted pin.
      if (auto) {
        CBZ.qualityAuto = true;
        try { localStorage.removeItem("cbz_qualityLevel"); } catch (e) {}
      }
      prefs.auto = auto;
      if (!auto) {
        // lock to whatever tier is currently active so flipping to Manual
        // doesn't silently jump the level
        const lvl = CBZ.getQualityLevel ? CBZ.getQualityLevel() : 4;
        if (CBZ.setQualityLevel) CBZ.setQualityLevel(lvl);
        prefs.qLevel = lvl;
      }
      savePrefs(prefs);
      refreshQualityUI();
    });
    elQ.addEventListener("input", function () {
      if (elQ.disabled) return;
      const lvl = parseInt(elQ.value, 10) || 0;
      if (CBZ.setQualityLevel) CBZ.setQualityLevel(lvl);
      prefs.qLevel = CBZ.getQualityLevel ? CBZ.getQualityLevel() : lvl;
      prefs.auto = false;
      savePrefs(prefs);
      refreshQualityUI();
    });
    elDensity.addEventListener("input", function () {
      const v = parseInt(elDensity.value, 10) || 0;
      CBZ.crowdRenderBudget = v;
      if (CBZ.refreshCrowdBudget) CBZ.refreshCrowdBudget();
      prefs.crowdBudget = v;
      savePrefs(prefs);
      elDensityVal.textContent = String(v);
    });
    elPop.addEventListener("input", function () {
      const v = parseInt(elPop.value, 10) || 140;
      savePopOverride(v);
      refreshPopUI();
    });

    panel.querySelector("#stgCloseBtn").addEventListener("click", close);

    panel._refresh = function () { refreshQualityUI(); refreshDensityUI(); refreshPopUI(); };
    return panel;
  }

  // ---- open / close -----------------------------------------------------
  // Mirrors city/phone.js's open()/close() shape, but uses the dedicated
  // CBZ.settingsOpen flag (see header) instead of cityMenuOpen, and NEVER
  // touches g.state — see the MP-safety note at the top of this file.
  function open() {
    if (open_ || CBZ.settingsOpen) return;
    open_ = true;
    CBZ.settingsOpen = true; // set BEFORE exitPointerLock — camera.js reads this
    build();
    panel.style.display = "block";
    panel._refresh();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function close() {
    if (!open_) return;
    open_ = false;
    if (panel) panel.style.display = "none";
    CBZ.settingsOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  CBZ.openSettings = open;
  CBZ.closeSettings = close;
  if (CBZ.settingsOpen === undefined) CBZ.settingsOpen = false;

  // ---- [Esc] toggles ------------------------------------------------------
  // Only meaningful while the panel itself is reachable (pause screen, or
  // already open) — doesn't compete with other modals' own Esc handling
  // since those guard on g.state==="playing" while we're on "paused", or on
  // CBZ.settingsOpen specifically.
  addEventListener("keydown", function (e) {
    const k = e.key;
    if (k !== "Escape") return;
    if (open_) { e.preventDefault(); close(); return; }
    if (g.state === "paused" && !CBZ.cityMenuOpen && !(CBZ.fullMap && CBZ.fullMap.active)) {
      e.preventDefault(); open();
    }
  });

  // ---- inject a "Settings" button into the existing #pause card -----------
  // Same lazy-create-once-then-show pattern as systems/state.js's
  // ensureStreetsBtn for the win screen — index.html is never edited.
  function ensurePauseButton() {
    if (document.getElementById("settingsOpenBtn")) return;
    const resumeBtn = document.getElementById("resumeBtn");
    if (!resumeBtn || !resumeBtn.parentNode) return;
    const btn = document.createElement("button");
    btn.id = "settingsOpenBtn";
    btn.className = resumeBtn.className || "btn";
    btn.textContent = "Settings";
    resumeBtn.parentNode.insertBefore(btn, resumeBtn.nextSibling);
    btn.addEventListener("click", function (e) {
      if (e && e.preventDefault) e.preventDefault();
      open();
    });
  }
  ensurePauseButton();
})();
