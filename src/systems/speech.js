/* ============================================================
   systems/speech.js — SPEECH IS OVER THE SPEAKER'S HEAD. EVERYWHERE.

   The one mouth of every game on this page. A spoken line is a few words
   pinned above the head of the person saying it, in world space:

     CBZ.speech.say(speaker, text, opts) -> true if it reached the screen
     CBZ.speech.phone(text, opts)        -> a voice on the phone: the line
                                            sits by the player's hand
     CBZ.speech.clear()                  -> drop every live line
     CBZ.speech.audit()                  -> counters + the live lines
     CBZ.speech.speakers()               -> who is talking now (facial.js: heads
                                            turn to them; the speaker's rig gets
                                            rig._say so his lips move with the words)

   speaker is anything with a place: an actor (.group.position / .pos /
   .position), a THREE.Vector3, or a plain {x,y,z}. opts:
     secs       how long it hangs (clamped 1.6..4)
     force      the answer to something the player just did: longer earshot,
                always wins a slot
     important  if the speaker is just off screen, the line rides the
                screen edge instead of vanishing (force implies it)
     ear        earshot override in metres
     headY      head height override (default: actor height or 1.85)

   RULES (owner, 2026-09-27: "move it above the head... you don't need to
   see the dialogue in the HUD"):
     - one line per speaker; a new line replaces his old one
     - at most MAX lines on screen; the nearest speakers win
     - a few words: whole sentences that fit two short lines, else the first
       clause, else nothing. Never a wall of text.
     - scales down and fades out with distance; fades when a wall is between
       you and the speaker
     - the player does not narrate himself. Lines with no one in the world to
       say them (narration, inner monologue, system chatter) are not speech:
       there is no bottom-of-screen band to put them in any more, so callers
       delete them at the source.
     - third-person narration ("Marcus backs off.") is dropped: his body
       already did it.
     - the dead, the knocked-out and the escaped do not talk.

   Replaces: #citySpeech (city/social.js), #campaignDialogue's line
   (city/campaign_ui.js), #prisonSpeech (systems/interact.js), and the
   subtitle claim desk (systems/subtitlebus.js, deleted: with one surface
   there is nothing to arbitrate).
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});

  const EAR = 14, EAR_ENGAGED = 22, MAX = 3, CHARS = 56;
  const EDGE = 28;                     // px inset for an off-screen important line
  let root = null;
  const live = [];                     // {spk, el, t, life, d, imp, occ, occT, phone}
  let said = 0, refused = 0, narration = 0, lastMode = null;
  const V = typeof THREE !== "undefined" ? new THREE.Vector3() : null;
  const HEAD = { x: 0, y: 0, z: 0 };

  // ---- where a speaker is -------------------------------------------------
  function spot(s) {
    if (!s) return null;
    if (typeof s.x === "number" && typeof s.z === "number" && !s.group) return s;
    if (s.group && s.group.position) return s.group.position;
    if (s.pos && typeof s.pos.x === "number") return s.pos;
    if (s.position && typeof s.position.x === "number") return s.position;
    if (s.mesh && s.mesh.position) return s.mesh.position;
    return null;
  }
  function headOf(s, opts, out) {
    const p = spot(s);
    if (!p) return null;
    let hy = opts && opts.headY;
    if (hy == null) hy = (s && (s.headY || s.height)) || 1.85;
    // a Vector3 speaker is already the mouth; don't lift it twice
    if (s === p && !(opts && opts.headY != null)) hy = 0.25;
    out.x = p.x; out.y = (p.y || 0) + hy + 0.3; out.z = p.z;
    return out;
  }
  function isPlayer(s) { return !!(s && CBZ.player && (s === CBZ.player || s === CBZ.player.pos)); }
  function downed(s) {
    return !!(s && (s.dead || s.escaped || (s.ko || 0) > 0 || s.ragdoll === true || s.knockedOut));
  }
  function nameOf(s) {
    const n = s && ((s.data && s.data.name) || s.name);
    return n ? String(n).replace(/\s*\(.*\)\s*$/, "").replace(/^(the|a|an)\s+/i, "").trim() : "";
  }
  function playerDist(p) {
    const P = CBZ.player;
    if (!p) return 0;
    // no player (a spectator page like NPC War): the ear is the camera
    const from = (P && P.pos) ? P.pos : (CBZ.camera ? CBZ.camera.position : null);
    if (!from) return 0;
    return Math.hypot(from.x - p.x, from.z - p.z);
  }
  function engaged(s) {
    if (!s) return false;
    if (s.approach && (typeof s.approach !== "object" || s.approach.t == null || s.approach.t > 0)) return true;
    if (s.reportState) return true;
    const reg = CBZ.interactions;
    try { const cur = reg && reg.current ? reg.current() : null; if (cur && cur.target === s) return true; } catch (e) {}
    return false;
  }

  // ---- the words ----------------------------------------------------------
  const QO = "“‘\"'", QC = "”’\"'";
  function words(s, spk) {
    s = String(s == null ? "" : s).replace(/<[^>]*>/g, "").trim();
    if (!s) return "";
    // "Name: words" -> words
    const colon = s.indexOf(":");
    if (colon > 0 && colon <= 34 && !/[.!?]/.test(s.slice(0, colon))) {
      const head = s.slice(0, colon).trim().toLowerCase().replace(/^(the|a|an)\s+/, "");
      const me = nameOf(spk).toLowerCase();
      if ((me && head === me) || /^[A-Z][\w .'#-]{0,30}$/.test(s.slice(0, colon).trim()) && QO.indexOf(s.slice(colon + 1).trim().charAt(0)) >= 0) s = s.slice(colon + 1).trim();
    }
    for (let i = 0; i < 2 && s.length > 1; i++) {
      if (QO.indexOf(s.charAt(0)) < 0) break;
      const last = s.charAt(s.length - 1);
      s = s.slice(1);
      if (QC.indexOf(last) >= 0) s = s.slice(0, -1);
      s = s.trim();
    }
    return s;
  }
  function few(s) {
    s = String(s || "").replace(/\s*[—–·•]\s*/g, ". ").replace(/\s+-\s+/g, ". ").replace(/\s+/g, " ").trim();
    if (!s) return "";
    if (s.length <= CHARS) return s;
    const sents = s.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [];
    let out = "";
    for (let i = 0; i < sents.length; i++) {
      const next = (out ? out + " " : "") + sents[i].trim();
      if (next.length > CHARS) break;
      out = next;
    }
    if (out) return out;
    const clause = s.split(/[,;:]\s/)[0].trim();
    if (clause.length <= CHARS && clause.length >= 2) return clause;
    return "";
  }
  function isNarration(spk, s) {
    const n = nameOf(spk).toLowerCase();
    if (!n || n === "someone") return false;
    const low = s.toLowerCase();
    const first = n.split(/\s+/)[0];
    return low.indexOf(n + " ") === 0 || low.indexOf(n + "'s ") === 0 ||
      (first.length > 2 && (low.indexOf(first + " ") === 0 && /^\S+ (is|was|has|backs|nods|shrugs|looks|turns|walks|runs|counts|takes|hands|grins|laughs|smiles|spits|glances|stares|leans|steps|shakes|pockets|sizes)\b/.test(low)));
  }

  // ---- DOM ----------------------------------------------------------------
  function ensureRoot() {
    if (root && root.parentNode) return root;
    root = document.getElementById("speech") || document.createElement("div");
    root.id = "speech";
    root.setAttribute("aria-live", "polite");
    if (!root.parentNode) document.body.appendChild(root);
    return root;
  }
  function drop(i) {
    const s = live[i];
    if (s && s.el.parentNode) s.el.parentNode.removeChild(s.el);
    live.splice(i, 1);
  }
  function clear() { while (live.length) drop(live.length - 1); }

  function playing() {
    const g = CBZ.game;
    return !g || g.state === undefined || g.state === "playing";
  }

  // ---- say ----------------------------------------------------------------
  function say(spk, text, opts) {
    opts = opts || {};
    if (!spk || !text || !playing() || !V) { refused++; return false; }
    // no inner monologue; the player speaks only when he says it ALOUD to
    // someone (a speech at a podium)
    if (isPlayer(spk) && !opts.phone && !opts.aloud) { narration++; return false; }
    if (downed(spk)) { refused++; return false; }
    if (!headOf(spk, opts, HEAD)) { refused++; return false; }
    if (typeof CBZ.speechGate === "function" && CBZ.speechGate(spk, opts) === false) { refused++; return false; }
    const d = opts.phone ? 0 : playerDist(HEAD);
    const ear = opts.ear || ((opts.force || engaged(spk)) ? EAR_ENGAGED : EAR);
    if (d > ear) { refused++; return false; }
    const raw = words(text, spk);
    if (!raw || (!opts.phone && !opts.aloud && isNarration(spk, raw))) { narration++; return false; }
    const line = few(raw);
    if (!line) { refused++; return false; }
    const life = Math.min(4, Math.max(1.6, (+opts.secs || (1.2 + line.length * 0.045))));
    let s = null;
    for (let i = 0; i < live.length; i++) if (live[i].spk === spk) { s = live[i]; break; }
    if (!s) {
      if (live.length >= MAX) {
        let far = 0;
        for (let i = 1; i < live.length; i++) if (live[i].d > live[far].d) far = i;
        if (!opts.force && !opts.phone && d >= live[far].d) { refused++; return false; }
        drop(far);
      }
      const el = document.createElement("div");
      el.className = "say";
      ensureRoot().appendChild(el);
      s = { spk: spk, el: el, t: 0, life: life, d: d, imp: false, occ: 0, occT: 0, opts: opts };
      live.push(s);
    }
    s.el.textContent = line;
    s.el.classList.remove("out");
    s.el.classList.toggle("phone", !!opts.phone);
    s.t = 0; s.life = life; s.d = d; s.opts = opts; s.phone = !!opts.phone;
    s.imp = !!(opts.important || opts.force);
    s.occT = 0;
    place(s, 0);
    said++;
    // THE MOUTH SAYS IT: systems/facial.js opens the speaker's lips in time
    // with these words (rig._say), and the people around him look at him
    const rig = rigOf(spk);
    if (rig && rig.faceRest) rig._say = { t0: CBZ.now || 0, text: line, rate: 14, loud: line.indexOf("!") >= 0 };
    return true;
  }
  function rigOf(s) {
    if (!s) return null;
    if (isPlayer(s)) return CBZ.playerChar || null;
    return s.char || (s.group && s.group.userData && typeof s.group.userData.charRig === "object" ? s.group.userData.charRig : null) || (s.faceRest ? s : null);
  }
  // who is talking right now (live, non-phone lines): facial.js turns heads to them
  const _speakers = [];
  function speakers() {
    _speakers.length = 0;
    for (let i = 0; i < live.length; i++) if (!live[i].phone && live[i].spk) _speakers.push(live[i].spk);
    return _speakers;
  }

  // a voice on the phone: by the player's hand, not in a HUD box
  function phone(text, opts) {
    const P = CBZ.player;
    if (!P) { refused++; return false; }
    opts = Object.assign({}, opts || {}, { phone: true, important: true });
    return say(P, text, opts);
  }

  // ---- occlusion (throttled; a wall between you and him mutes the line) ----
  function occluded(s) {
    const cam = CBZ.camera;
    if (!cam || s.phone) return false;
    try {
      if (typeof CBZ.clearLineOfFire === "function") {
        return !CBZ.clearLineOfFire(cam.position.x, cam.position.y, cam.position.z, HEAD.x, HEAD.y - 0.2, HEAD.z);
      }
    } catch (e) {}
    return false;
  }

  function firstPerson() {
    const cam = CBZ.camera, P = CBZ.player;
    if (!cam || !P || !P.pos) return false;
    const dx = cam.position.x - P.pos.x, dz = cam.position.z - P.pos.z;
    return dx * dx + dz * dz < 0.5;
  }

  function place(s, dt) {
    const cam = CBZ.camera;
    if (!cam) { s.el.style.visibility = "hidden"; return; }
    const w = window.innerWidth || 800, h = window.innerHeight || 600;
    let x, y, scale = 1, alpha = 1, edge = false;
    if (s.phone) {
      // the phone is in his right hand: bottom-right in first person, beside
      // his shoulder in third
      if (firstPerson() || !headOf(CBZ.player, { headY: 1.3 }, HEAD)) {
        x = w * 0.74; y = h * 0.66;
      } else {
        V.set(HEAD.x, HEAD.y, HEAD.z).project(cam);
        x = (V.x * 0.5 + 0.5) * w + 70; y = (-V.y * 0.5 + 0.5) * h;
      }
    } else {
      if (!headOf(s.spk, s.opts, HEAD)) { s.el.style.visibility = "hidden"; return; }
      V.set(HEAD.x, HEAD.y, HEAD.z).project(cam);
      const behind = V.z > 1;
      let nx = V.x, ny = V.y;
      if (behind) { nx = -nx; ny = -ny; }
      const off = behind || Math.abs(nx) > 1.02 || Math.abs(ny) > 1.02;
      if (off) {
        if (!s.imp) { s.el.style.visibility = "hidden"; return; }
        // ride the nearest screen edge, pointing at him
        const m = Math.max(Math.abs(nx), Math.abs(ny), 1e-3);
        const k = behind ? 1 / m : Math.min(1, 1 / m);
        nx *= k; ny *= k;
        edge = true;
      }
      x = (nx * 0.5 + 0.5) * w; y = (-ny * 0.5 + 0.5) * h;
      if (edge) {
        x = Math.min(w - EDGE - 60, Math.max(EDGE + 60, x));
        y = Math.min(h - EDGE - 30, Math.max(EDGE + 40, y));
      }
      // distance: a man across the yard is smaller and fainter
      const ear = s.opts.ear || ((s.opts.force || engaged(s.spk)) ? EAR_ENGAGED : EAR);
      scale = Math.max(0.72, Math.min(1.12, 1.18 - s.d / 30));
      const far = s.d / ear;
      alpha = far < 0.6 ? 1 : Math.max(0, 1 - (far - 0.6) / 0.4);
      // a wall between: fade to a ghost
      s.occT -= dt;
      if (s.occT <= 0) { s.occT = 0.25; s.occ = occluded(s) ? 1 : 0; }
      if (s.occ) alpha *= 0.28;
      if (edge) alpha = Math.max(alpha, 0.8);
    }
    s.el.style.visibility = "";
    s.el.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px) translate(-50%,-100%) scale(" + scale.toFixed(2) + ")";
    s.el.style.setProperty("--a", alpha.toFixed(2));
    s.el.classList.toggle("edge", edge);
  }

  function tick(dt) {
    const g = CBZ.game;
    const mode = g ? g.mode : null;
    if (mode !== lastMode) { lastMode = mode; clear(); }
    if (!live.length) return;
    if (!playing()) { clear(); return; }
    if (CBZ.camera) CBZ.camera.updateMatrixWorld();
    for (let i = live.length - 1; i >= 0; i--) {
      const s = live[i];
      s.t += dt;
      if (s.t >= s.life || (!s.phone && downed(s.spk))) { drop(i); continue; }
      if (s.t > s.life - 0.3 && !s.el.classList.contains("out")) s.el.classList.add("out");
      if (!s.phone) { const p = spot(s.spk); if (p) s.d = playerDist(p); }
      place(s, dt);
    }
  }

  /* LONG AUTHORED LINES, SAID IN BREATHS. say() keeps a line to what fits in
     two short lines and drops the tail. A story beat (Voss's briefing, a
     cabinet pitch, a phone call) is cut into breath-sized pieces and played
     back to back by the same mouth:
       pieces(text)                          -> ["piece", ...]
       lines([{ by, line, aloud? }], onEnd)  -> handle {stop()}; by = speaker or "phone"
       then(by, text, fn)                    -> says all but the last piece,
                                                then fn(lastPiece) (a question
                                                that lands on its reply buttons) */
  function pieces(line) {
    const s = String(words(line) || "").replace(/\s*[—–·•]\s*/g, ". ").replace(/\s+/g, " ").trim();
    if (!s) return [];
    if (s.length <= CHARS) return [s];
    const out = [];
    let cur = "";
    const push = function (bit) {
      bit = bit.trim(); if (!bit) return;
      if (cur && (cur + " " + bit).length <= CHARS) { cur += " " + bit; return; }
      if (cur) out.push(cur);
      cur = bit;
    };
    (s.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [s]).forEach(function (sn) {
      sn = sn.trim();
      if (sn.length <= CHARS) { push(sn); return; }
      sn.replace(/([,;:])\s+/g, "$1\n").split("\n").forEach(function (cl) {
        if (cl.length <= CHARS) { push(cl); return; }
        let w = "";
        cl.split(" ").forEach(function (word) {
          if (w && (w + " " + word).length > CHARS) { push(w); w = word; } else w = w ? w + " " + word : word;
        });
        push(w);
      });
    });
    if (cur) out.push(cur);
    return out;
  }
  const running = [];
  function secsOf(t) { return Math.min(4, 1.6 + String(t).length * 0.045); }
  function voice(L, t, secs) {
    if (L.by === "phone") return phone(t, { secs: secs });
    return say(L.by, t, { secs: secs, force: true, important: true, aloud: !!L.aloud });
  }
  function lines(list, onEnd) {
    const q = [];
    (list || []).forEach(function (L) { if (L && L.by) pieces(L.line).forEach(function (t) { q.push({ L: L, t: t }); }); });
    const mouth = q.length ? q[0].L.by : null;
    for (let k = running.length - 1; k >= 0; k--) if (mouth && running[k].by === mouth) running[k].stop();
    let i = 0, timer = 0, stopped = false;
    const h = {
      by: mouth,
      stop: function () { stopped = true; clearTimeout(timer); const k = running.indexOf(h); if (k >= 0) running.splice(k, 1); },
    };
    running.push(h);
    const next = function () {
      if (stopped) return;
      if (i >= q.length) { h.stop(); if (onEnd) { try { onEnd(); } catch (e) {} } return; }
      const it = q[i++], secs = secsOf(it.t);
      try { voice(it.L, it.t, secs + 0.2); } catch (e) {}
      timer = setTimeout(next, secs * 1000);
    };
    next();
    return h;
  }
  function then(by, text, fn) {
    const bits = pieces(text);
    const last = bits.length ? bits.pop() : "";
    return lines(bits.map(function (t) { return { by: by, line: t }; }), function () { fn(last); });
  }
  function stopAll() { while (running.length) running.pop().stop(); }

  CBZ.speech = {
    pieces: pieces,
    lines: lines,
    then: then,
    stopAll: stopAll,
    say: say,
    speakers: speakers,
    phone: phone,
    clear: clear,
    words: words,
    few: few,
    tick: tick,
    audit: function () {
      return {
        said: said, refused: refused, narration: narration, live: live.length, max: MAX, ear: EAR,
        lines: live.map(function (s) { return { who: nameOf(s.spk) || (s.phone ? "phone" : "?"), text: s.el.textContent, d: +s.d.toFixed(1) }; }),
      };
    },
  };
  // order 97: after the camera moved (50) and after the prompt layer (96)
  if (typeof CBZ.onAlways === "function") CBZ.onAlways(97, tick);
})();
