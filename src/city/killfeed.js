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

  CBZ.cityRecentDeaths = CBZ.cityRecentDeaths || []; // [{name, cause, t, you?, gang?}]
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
    const a = CBZ.cityRecentDeaths;
    a.push(e);
    if (a.length > CAP) a.splice(0, a.length - CAP);
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
        log(ped.name || crowdName(), label, { gang: ped.gang || null });
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
        if (label === "gunfire" && !opts.noCrime && opts.byPlayer !== false && !opts.attacker) label = "murder";
        log(crowdName(), label);
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
        log("You", label, { you: true });
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
})();
