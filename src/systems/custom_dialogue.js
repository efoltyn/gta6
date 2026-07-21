/* ============================================================
   systems/custom_dialogue.js — customizable street language.

   Dialogue templates use {{TOKEN}} placeholders. In-game text is ALWAYS
   readable without raw slurs: empty env slots fall back to FILL_* or ****.
   Locally, edit custom.env and flip CBZ.CONFIG.BADWORDS_UNCENSORED to
   substitute the real strings you typed there.

   Loads asynchronously from /custom.env (static file). Until it lands,
   every token resolves to a safe fill. Never throws.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.BADWORDS_UNCENSORED == null) CFG.BADWORDS_UNCENSORED = true;

  const map = Object.create(null);
  let ready = false;

  // Censored masks (used when BADWORDS_UNCENSORED is forced off).
  const SAFE = {
    F_WORD: "f***", S_WORD: "s***", B_WORD: "b****", A_WORD: "a**",
    D_WORD: "d***", C_WORD: "c***", P_WORD: "p***",
    SLUR_BLACK: "****", SLUR_WHITE: "****", SLUR_ASIAN: "****",
    SLUR_LATINO: "****", SLUR_GAY: "****", SLUR_JEW: "****",
    SLUR_ARAB: "****", SLUR_IRISH: "****", SLUR_ITALIAN: "****",
    SLUR_GENERIC: "****",
    FILL_F: "f***", FILL_S: "s***", FILL_B: "b****", FILL_A: "a**",
    FILL_D: "d***", FILL_C: "c***", FILL_P: "p***", FILL_SLUR: "****",
  };
  // Built-in uncensored defaults so the first frame is already raw even
  // before custom.env finishes fetching (env still wins when it lands).
  const RAW = {
    F_WORD: "fuck", S_WORD: "shit", B_WORD: "bitch", A_WORD: "asshole",
    D_WORD: "damn", C_WORD: "cunt", P_WORD: "piss",
    SLUR_BLACK: "nigger", SLUR_WHITE: "cracker", SLUR_ASIAN: "chink",
    SLUR_LATINO: "spic", SLUR_GAY: "faggot", SLUR_JEW: "kike",
    SLUR_ARAB: "towelhead", SLUR_IRISH: "mick", SLUR_ITALIAN: "wop",
    SLUR_GENERIC: "bastard",
    FILL_F: "f***", FILL_S: "s***", FILL_B: "b****", FILL_A: "a**",
    FILL_D: "d***", FILL_C: "c***", FILL_P: "p***", FILL_SLUR: "****",
  };

  function parseEnv(text) {
    const out = Object.create(null);
    String(text || "").split(/\r?\n/).forEach(function (line) {
      line = line.replace(/^\s+|\s+$/g, "");
      if (!line || line.charAt(0) === "#") return;
      const eq = line.indexOf("=");
      if (eq < 0) return;
      const k = line.slice(0, eq).replace(/^\s+|\s+$/g, "");
      let v = line.slice(eq + 1).replace(/^\s+|\s+$/g, "");
      if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
          (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) {
        v = v.slice(1, -1);
      }
      if (k) out[k] = v;
    });
    return out;
  }

  function applyParsed(parsed) {
    const base = uncensored() ? RAW : SAFE;
    for (const k in base) map[k] = base[k];
    // Always keep FILL_* masks available for forced-censor mode.
    for (const k in SAFE) if (k.indexOf("FILL_") === 0) map[k] = SAFE[k];
    for (const k in parsed) {
      if (!Object.prototype.hasOwnProperty.call(parsed, k)) continue;
      // Empty env value = leave the base (raw or safe) alone.
      if (parsed[k] == null || String(parsed[k]).length === 0) continue;
      map[k] = parsed[k];
    }
    ready = true;
  }

  function uncensored() { return CFG.BADWORDS_UNCENSORED !== false; }
  applyParsed({});

  function load() {
    if (typeof fetch !== "function") return;
    try {
      fetch("custom.env", { cache: "no-store" }).then(function (r) {
        if (!r || !r.ok) return null;
        return r.text();
      }).then(function (txt) {
        if (txt != null) applyParsed(parseEnv(txt));
      }).catch(function () {});
    } catch (e) {}
  }
  load();
  CBZ.badwordsReload = load;

  function resolve(key) {
    key = String(key || "").toUpperCase();
    if (uncensored()) {
      const raw = map[key];
      if (raw != null && String(raw).length > 0) return String(raw);
      if (RAW[key] != null) return RAW[key];
    }
    // Censored path: FILL_* masks.
    if (key === "F_WORD") return map.FILL_F || SAFE.FILL_F;
    if (key === "S_WORD") return map.FILL_S || SAFE.FILL_S;
    if (key === "B_WORD") return map.FILL_B || SAFE.FILL_B;
    if (key === "A_WORD") return map.FILL_A || SAFE.FILL_A;
    if (key === "D_WORD") return map.FILL_D || SAFE.FILL_D;
    if (key === "C_WORD") return map.FILL_C || SAFE.FILL_C;
    if (key === "P_WORD") return map.FILL_P || SAFE.FILL_P;
    if (key.indexOf("SLUR_") === 0) return map.FILL_SLUR || SAFE.FILL_SLUR;
    if (map["FILL_" + key] != null && String(map["FILL_" + key]).length) return String(map["FILL_" + key]);
    return SAFE[key] || "****";
  }

  // Replace {{TOKEN}} / {{ token }} in a string.
  function fill(str) {
    if (str == null) return "";
    return String(str).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, function (_, k) {
      return resolve(k);
    });
  }

  // Convenience: pick a line from an array, then fill tokens.
  function line(arr, rng) {
    if (!arr || !arr.length) return "";
    const r = typeof rng === "function" ? rng() : Math.random();
    return fill(arr[(r * arr.length) | 0]);
  }

  CBZ.badwords = {
    ready: function () { return ready; },
    get: resolve,
    fill: fill,
    line: line,
    uncensored: uncensored,
    map: map,
  };
  CBZ.bw = fill;   // short alias used in dialogue authors
})();
