/* ============================================================
   city/killfeed.js — central DEATH event bus + a Fortnite-style kill feed.

   Every death in the city (the player, a named ped, an ambient-crowd body)
   funnels through here with an ACCURATE cause ("airstrike", "car crash",
   "murder", "gunfire", "fall", "explosion", "police", ...) and the victim's
   real name, so the HUD can show "Dave Smith — airstrike". It works by
   WRAPPING the existing kill functions (cityKillPed / cityCrowdKill) + the
   player-death path rather than editing every kill site — the originals are
   saved and called through, so all current behaviour is preserved; we only
   read the outcome and push one feed entry on a confirmed kill.

   The HUD agent (turf.js) RENDERS CBZ.cityRecentDeaths — we own the DATA only:
   entries are {name, cause, t, you?, gang?}, newest at the END, capped ~12.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // OWNER DIRECTION: the ONLY thing that pops on the HUD is the Fortnite-style
  // kill line — WHO killed WHO, and how (airstrike / plane crash / car / …).
  // Everything else that used to toast is already routed to the phone/logic.
  // Flip CITY_KILLFEED_HUD=false to silence the on-screen feed (data + phone
  // news still flow).
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CITY_KILLFEED_HUD == null) CBZ.CONFIG.CITY_KILLFEED_HUD = true;

  CBZ.cityRecentDeaths = CBZ.cityRecentDeaths || []; // [{name, cause, t, you?, gang?, by?}]
  const CAP = 12;                                    // keep only the freshest dozen

  // generic names for the ambient instanced crowd (they carry no ped.name)
  const FIRST = ["Dave", "Sam", "Nina", "Cole", "Rosa", "Marco", "Lena", "Theo",
    "Priya", "Otis", "Gabe", "Suki", "Hank", "Mara", "Dion", "Bex", "Carl",
    "Yuki", "Rico", "Faye", "Glen", "Tova", "Ned", "Pia"];
  const LAST = ["Smith", "Cruz", "Vega", "Okoro", "Banks", "Doyle", "Tran",
    "Reyes", "Stone", "Marsh", "Webb", "Costa", "Boyd", "Quinn", "Diaz",
    "Sava", "Hollis", "Vance", "Petrov", "Abara"];
  function crowdName() { return FIRST[(Math.random() * FIRST.length) | 0] + " " + LAST[(Math.random() * LAST.length) | 0]; }

  // is a 5★ AIR ATTACK live? (aircraft.js fields jets + missiles at wanted>=5).
  // The module keeps its gunship/missile state private, so feature-detect off
  // the only public signal that drives it: the star level.
  function airstrikeLive() { return ((g && g.wanted) | 0) >= 5; }

  // NORMALISE any raw cause string/opts into one clean human kill-feed label.
  function normCause(raw, opts) {
    opts = opts || {};
    if (opts.byCar) return "car crash";
    const s = String(raw == null ? "" : raw).toLowerCase();

    // ORDER MATTERS: more-specific causes win. "gunfire" contains "fire" and
    // "car bomb" contains "car", so bombs/explosions are tested BEFORE both the
    // vehicle and the bare-fire checks, and gunfire is word-bounded.
    // terrorism (bombs) — most specific
    if (/terror|suicide bomb|car bomb|\bbomb\b|\bc4\b|detonat/.test(s)) return "terrorist attack";
    // an aircraft going DOWN (distinct from a called-in airstrike ON you) — the
    // owner wants "X killed Y in a plane crash" as its own line. Tested before the
    // airstrike/car branches so "aircraft crash" never reads as either.
    if (/plane crash|aircraft crash|air crash|heli(copter)? crash|crash[\s-]?land|went down/.test(s)) return "plane crash";
    // airstrikes / missiles
    if (/airstrike|air strike|missile|gunship|jet\b|rocket|drone|raked/.test(s)) return "airstrike";
    // generic explosions / blasts / being set on fire
    if (/explos|blast|grenade|incinerat|\bfire\b|on fire|burn/.test(s)) return airstrikeLive() ? "airstrike" : "explosion";
    // gunfire / shootings (before vehicle, so "gunned down"/"shot" never reads as a crash)
    if (/headshot|drive[\s-]?by|\bgun|shot|shoot|sniped|capped|gunned/.test(s)) return "gunfire";
    // police (after gunfire so a gun cause stays "gunfire"; here it's a cop-attributed death)
    if (/police|\bcop\b|swat|officer|chopper/.test(s)) return "police";
    // run-over / vehicle
    if (/run[\s-]?over|run down|vehicular|crash|hit by|ran over|\bcar\b|traffic|\bbike\b|truck/.test(s)) return "car crash";
    // melee
    if (/execut/.test(s)) return "murder";
    if (/beat|melee|stomp|punch|knock|\bko\b|brawl|fist|stab|knif|slash|bludgeon/.test(s)) return "beaten";
    // falls
    if (/fall|fell|plummet|\bheight\b/.test(s)) return "fall";
    if (s) return s.replace(/^(you were|killed by|killed in the|killed)\s*/, "").trim() || "killed";
    return "killed";
  }

  // push one entry; newest goes on the END (HUD reads slice(-5)). Capped front.
  function log(name, cause, opts) {
    opts = opts || {};
    const e = { name: name || "Someone", cause: cause || "killed", t: (CBZ.now || 0) };
    if (opts.you) e.you = true;
    if (opts.gang) e.gang = opts.gang;
    if (opts.by) e.by = opts.by;                 // the KILLER, for "X killed Y"
    const a = CBZ.cityRecentDeaths;
    a.push(e);
    if (a.length > CAP) a.splice(0, a.length - CAP);
    // Deaths stay available as diegetic city news. The population counter still
    // pulses immediately, while the old red/white kill prose never paints over
    // the world. Your own death is already communicated by the WASTED card.
    if (!e.you && typeof CBZ.cityPhoneNotify === "function") {
      CBZ.cityPhoneNotify({
        app: "news",
        from: "City Desk",
        text: e.name + " was reported dead. Cause: " + e.cause + ".",
      });
    }
    return e;
  }

  // EXPLICIT logger for any caller that already knows the victim + clean cause.
  // cause is normalised so callers can pass a raw reason string and still read clean.
  CBZ.cityLogDeath = function (name, cause, opts) {
    opts = opts || {};
    return log(name, normCause(cause, opts), opts);
  };

  CBZ.killFeedReset = function () { CBZ.cityRecentDeaths.length = 0; };

  // ---------- WRAP: named-ped kills (peds.js cityKillPed(ped, imp, cause)) ----------
  if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._kfWrapped) {
    const orig = CBZ.cityKillPed;
    CBZ.cityKillPed = function (ped, imp, cause) {
      const wasDead = !ped || ped.dead;          // already dead → orig no-ops, don't double-log
      const r = orig.apply(this, arguments);
      if (!wasDead && ped && ped.dead) {
        imp = imp || {};
        // a deliberate PLAYER kill with a gun reads as "murder"; other gunfire stays "gunfire"
        const byPlayer = imp.byPlayer !== false && !imp.attacker;
        let label = normCause(cause, imp);
        if (label === "gunfire" && byPlayer) label = "murder";
        const by = byPlayer ? "You"
          : (imp.attacker && (imp.attacker.name || (imp.attacker.kind === "cop" && "Police"))) ||
            (label === "police" ? "Police" : null);
        log(ped.name || crowdName(), label, { gang: ped.gang || null, by: by });
      }
      return r;
    };
    CBZ.cityKillPed._kfWrapped = true;
  }

  // ---------- WRAP: ambient crowd kills (crowd.js cityCrowdKill(i, opts)) ----------
  if (typeof CBZ.cityCrowdKill === "function" && !CBZ.cityCrowdKill._kfWrapped) {
    const orig = CBZ.cityCrowdKill;
    CBZ.cityCrowdKill = function (i, opts) {
      const killed = orig.apply(this, arguments);   // truthy only on a CONFIRMED fresh kill
      if (killed) {
        opts = opts || {};
        // ambient bodies carry no cause string; the crowd dies overwhelmingly to
        // gunfire (the few car/explosion cases are flagged via byCar/opts.cause).
        let label = opts.byCar ? "car crash"
          : normCause(opts.cause || "gunfire", opts);
        // a player shooting (not byCar, not an NPC/explosion you didn't cause) → "murder"
        const byPlayer = !opts.noCrime && opts.byPlayer !== false && !opts.attacker;
        if (label === "gunfire" && byPlayer) label = "murder";
        const by = (opts.attacker && (opts.attacker.name || (opts.attacker.kind === "cop" && "Police"))) ||
          (byPlayer ? "You" : (label === "police" ? "Police" : null));
        log(crowdName(), label, { by: by });
      }
      return killed;
    };
    CBZ.cityCrowdKill._kfWrapped = true;
  }

  // ---------- HOOK: the PLAYER death (death.js cityKillPlayer(reason, imp)) ----------
  // We don't edit death.js — we wrap its public entry and read the cause/killer it
  // records (reason string + g._cityKiller, set ~6s before death in cityHurtPlayer).
  function hookPlayerDeath() {
    if (typeof CBZ.cityKillPlayer !== "function" || CBZ.cityKillPlayer._kfWrapped) return true;
    const orig = CBZ.cityKillPlayer;
    CBZ.cityKillPlayer = function (reason, imp) {
      const wasDead = CBZ.player && CBZ.player.dead;
      // capture the killer name BEFORE orig runs (cityKillPlayer clears g._cityKiller)
      const killer = g && g._cityKiller;
      const r = orig.apply(this, arguments);
      if (!wasDead && CBZ.player && CBZ.player.dead) {
        // killer string biases the label (e.g. "the police" / "a SWAT officer")
        const hint = (typeof killer === "string") ? killer
          : (killer && killer.kind === "cop") ? "police"
          : (killer && killer.name) ? killer.name : "";
        let label = normCause((reason || "") + " " + hint, imp);
        // a death at the hands of the law reads as "police", even if it was gunfire
        if ((label === "gunfire" || label === "murder") && /police|\bcop\b|swat|officer/.test(((reason || "") + " " + hint).toLowerCase())) label = "police";
        // who killed YOU: a named actor, "Police", else the hint string if human.
        let by = (killer && killer.name) ? killer.name
          : (killer && killer.kind === "cop") ? "Police"
          : label === "police" ? "Police"
          : (typeof killer === "string" && killer && !/^(you were|killed)/i.test(killer)) ? killer : null;
        log("You", label, { you: true, by: by });
      }
      return r;
    };
    CBZ.cityKillPlayer._kfWrapped = true;
    return true;
  }
  // death.js loads before us in boot order, but hook defensively (and re-try if not).
  if (!hookPlayerDeath()) {
    let tries = 0;
    const iv = setInterval(function () { if (hookPlayerDeath() || ++tries > 40) clearInterval(iv); }, 250);
  }

  // ---------- light prune (cheap, no per-frame allocs): drop stale entries ----------
  const MAX_AGE = 22000;         // ms an entry can linger before it's pruned (CBZ.now is in ms)
  let pruneT = 0;
  CBZ.onAlways(47, function (dt) {
    if (!g || g.mode !== "city") return;
    pruneT -= dt; if (pruneT > 0) return;
    pruneT = 1.0;
    const a = CBZ.cityRecentDeaths, now = (CBZ.now || 0);
    if (!a.length) return;
    // entries are time-ordered (push appends newest) → drop from the front only
    let cut = 0;
    while (cut < a.length && (now - (a[cut].t || 0)) > MAX_AGE) cut++;
    if (cut > 0) a.splice(0, cut);
  });

  // ============================================================
  //  ON-SCREEN KILL FEED — the ONE popup the owner keeps: a Fortnite-style
  //  stack of "KILLER  killed  VICTIM  (method)" lines, newest on top, fading
  //  out. Top-right, tucked under the wanted/cash chrome so it never overlaps.
  // ============================================================
  const SHOW_MS = 5600;   // a line is visible this long after the kill
  const MAX_LINES = 4;    // never wallpaper the screen
  let feedEl = null, feedFP = "";
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function ensureFeed() {
    if (feedEl) return feedEl;
    if (typeof document === "undefined" || !document.body) return null;
    const style = document.createElement("style");
    style.textContent =
      "#cityKillFeed{position:fixed;right:14px;top:96px;z-index:70;pointer-events:none;display:flex;" +
      "flex-direction:column;align-items:flex-end;gap:5px;font:800 13px/1.15 Inter,system-ui,Arial,sans-serif}" +
      "#cityKillFeed .kf{background:rgba(10,14,19,.78);border:1px solid rgba(183,207,225,.26);border-radius:7px;" +
      "padding:5px 10px;color:#e8edf2;box-shadow:0 3px 10px rgba(0,0,0,.4);letter-spacing:.01em;" +
      "-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:kfIn .16s ease-out}" +
      "#cityKillFeed .kf.you{border-color:rgba(231,189,85,.6)}" +
      "#cityKillFeed .kf.dead{border-color:rgba(255,120,110,.55)}" +
      "#cityKillFeed .kf-by{color:#fff}#cityKillFeed .kf-v{color:#9fb0bf;font-weight:700;margin:0 5px}" +
      "#cityKillFeed .kf-t{color:#ff9a83}#cityKillFeed .kf.you .kf-t{color:#e7bd55}" +
      "#cityKillFeed .kf-m{color:#8fa0af;font-weight:700;margin-left:7px;font-size:11px;text-transform:uppercase;letter-spacing:.05em}" +
      "@keyframes kfIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}" +
      "@media(max-width:720px){#cityKillFeed{top:84px;font-size:12px}}";
    document.head.appendChild(style);
    feedEl = document.createElement("div");
    feedEl.id = "cityKillFeed";
    feedEl.setAttribute("aria-live", "polite");
    document.body.appendChild(feedEl);
    return feedEl;
  }
  // "You killed Dave Smith" / "You ran over Sam Cruz" / "Police killed You · airstrike"
  function lineHTML(e) {
    const vic = esc(e.you ? "You" : e.name);
    const cause = e.cause || "killed";
    if (e.by && e.by !== e.name) {
      const verb = cause === "car crash" ? "ran over"
        : cause === "beaten" ? "beat down"
        : (cause === "explosion" || cause === "terrorist attack") ? "blew up"
        : "killed";
      let chip = "";
      if (verb === "killed" && /airstrike|plane crash|police/.test(cause)) chip = ' <span class="kf-m">' + esc(cause) + '</span>';
      return '<span class="kf-by">' + esc(e.by) + '</span><span class="kf-v">' + verb + '</span><span class="kf-t">' + vic + '</span>' + chip;
    }
    // no attributed killer → environmental / unknown cause
    return '<span class="kf-t">' + vic + '</span><span class="kf-m">' + esc(cause) + '</span>';
  }
  CBZ.onAlways(47.5, function () {
    if (!g || g.mode !== "city" || CBZ.CONFIG.CITY_KILLFEED_HUD === false) {
      if (feedEl && feedEl.childElementCount) { feedEl.innerHTML = ""; feedFP = ""; }
      return;
    }
    const a = CBZ.cityRecentDeaths, now = (CBZ.now || 0);
    // newest first, only the fresh ones, capped
    const show = [];
    for (let i = a.length - 1; i >= 0 && show.length < MAX_LINES; i--) {
      if (now - (a[i].t || 0) <= SHOW_MS) show.push(a[i]);
    }
    const fp = show.map(function (e) { return (e.by || "") + ">" + e.name + ":" + e.cause + "@" + e.t; }).join("|");
    if (fp === feedFP) return;                    // no change → no DOM churn
    feedFP = fp;
    const el = ensureFeed(); if (!el) return;
    el.innerHTML = show.map(function (e) {
      return '<div class="kf' + (e.you ? " you" : "") + (e.by === "You" ? " dead" : "") + '">' + lineHTML(e) + "</div>";
    }).join("");
  });
})();
