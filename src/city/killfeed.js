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

   This file owns the DATA (CBZ.cityRecentDeaths: {name, cause, t, you?,
   gang?, by?}, newest at the END, capped ~12) AND the on-screen renderer
   (#cityKillFeed, bottom of file). The old turf.js/hud.js #cKillFeed
   renderers were gutted to stubs in the living-world overhaul (69e83cd) —
   from then until the fourth-wall pass (4d1c46d) deaths only reached the
   phone news app, which is exactly the era of "the feed never shows".
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

  // DIRECT "X killed Y" one-liner for modules that already know all three
  // parts. wildlife.js's hunting path has called this exact name since before
  // the bus existed — nothing ever defined it, so its guarded call was a
  // silent no-op and hunts never reached the feed. Defining it here plugs
  // that hole and gives future systems a one-call feed line.
  CBZ.cityKillFeed = function (by, name, cause, opts) {
    opts = opts || {};
    if (by) opts.by = by;
    // a null/absent name means an ANONYMOUS civilian victim (e.g. the occupants
    // of a downed ambient aircraft — airtraffic.js) — give them a generated
    // citizen name exactly like the instanced crowd gets, so the feed reads
    // "You killed Dave Smith (plane crash)", never a nameless "Someone".
    return log(name || crowdName(), normCause(cause, opts), opts);
  };

  // ---------- WRAP: named-ped kills (peds.js cityKillPed(ped, imp, cause)) ----------
  function hookPedKills() {
    if (typeof CBZ.cityKillPed !== "function") return false;
    if (CBZ.cityKillPed._kfWrapped) return true;
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
    return true;
  }

  // ---------- WRAP: ambient crowd kills (crowd.js cityCrowdKill(i, opts)) ----------
  function hookCrowdKills() {
    if (typeof CBZ.cityCrowdKill !== "function") return false;
    if (CBZ.cityCrowdKill._kfWrapped) return true;
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
    return true;
  }

  // ---------- HOOK: the PLAYER death (death.js cityKillPlayer(reason, imp)) ----------
  // We don't edit death.js — we wrap its public entry and read the cause/killer it
  // records (reason string + g._cityKiller, set ~6s before death in cityHurtPlayer).
  function hookPlayerDeath() {
    if (typeof CBZ.cityKillPlayer !== "function") return false;
    if (CBZ.cityKillPlayer._kfWrapped) return true;
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
  // peds.js/crowd.js/death.js all load before us in boot order (index.html), so
  // every hook lands on the first try today — but hook defensively and RE-TRY
  // any that miss, so a future script reshuffle degrades to a 250ms-late wrap
  // instead of a silently dead feed (the owner's exact bug class).
  function hookAllKillPaths() {
    const a = hookPedKills(), b = hookCrowdKills(), c = hookPlayerDeath();
    return a && b && c;
  }
  if (!hookAllKillPaths()) {
    let tries = 0;
    const iv = setInterval(function () { if (hookAllKillPaths() || ++tries > 40) clearInterval(iv); }, 250);
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
      // TINY, IN THE CORNER (owner's words) — one thin right-aligned strip per
      // death with a coloured right edge: the disaster-game/turf feed grammar,
      // not a chunky chat card. Red edge = a death, gold = you're involved.
      "#cityKillFeed{position:fixed;right:14px;top:150px;z-index:70;pointer-events:none;display:flex;" +
      "flex-direction:column;align-items:flex-end;gap:3px;font:700 11px/1.3 Inter,system-ui,Arial,sans-serif}" +
      "#cityKillFeed .kf{background:rgba(8,11,17,.62);border-right:3px solid rgba(255,90,80,.85);border-radius:4px;" +
      "padding:2px 8px;color:#dfe6f0;text-align:right;letter-spacing:.01em;text-shadow:0 1px 2px rgba(0,0,0,.55);" +
      "animation:kfLife " + SHOW_MS + "ms linear both}" +
      "#cityKillFeed .kf.you{border-right-color:#e7bd55;background:rgba(40,30,8,.7)}" +
      "#cityKillFeed .kf.dead{border-right-color:#ff3b3b}" +
      "#cityKillFeed .kf-by{color:#fff;font-weight:800}#cityKillFeed .kf-v{color:#9fb0bf;margin:0 4px}" +
      "#cityKillFeed .kf-t{color:#ff9a83}#cityKillFeed .kf.you .kf-t{color:#e7bd55}" +
      "#cityKillFeed .kf-m{color:#8fa0af;margin-left:5px;font-size:9px;text-transform:uppercase;letter-spacing:.05em}" +
      // one lifetime animation per row: pop in fast, hold, fade over the last
      // fifth of SHOW_MS. The renderer stamps each row's REAL age as a negative
      // animation-delay, so a row rebuilt mid-life (the list repaints whenever
      // the visible set changes) resumes at the right point instead of
      // restarting — the fade needs zero per-frame JS.
      "@keyframes kfLife{0%{opacity:0;transform:translateX(10px)}3%{opacity:1;transform:none}" +
      "80%{opacity:1}100%{opacity:0}}" +
      "@media(max-width:720px){#cityKillFeed{top:124px;font-size:10px}}" +
      // touch zone map (css/mobile.css): top-right is the money+wanted column —
      // the feed stacks BELOW it, clear of the tap targets.
      "body.touch #cityKillFeed{top:170px}";
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
      const age = Math.max(0, now - (e.t || 0)) | 0;   // resume kfLife mid-fade
      return '<div class="kf' + (e.you ? " you" : "") + (e.by === "You" ? " dead" : "") +
        '" style="animation-delay:-' + age + 'ms">' + lineHTML(e) + "</div>";
    }).join("");
  });
})();
