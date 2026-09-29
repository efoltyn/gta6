/* ============================================================
   systems/interactions.js — the door, breaker box, security cameras,
   ventilation (unscrew the grille, crawl the duct), and win check (the plan in systems/escapeplan.js signs
   off on crawls and wins; it also owns the keycard now). (Cigarette-pack
   pickups used to live here too — that block is now the "coin"
   prop type in systems/proptypes.js / entities/coins.js, the F3
   proof that a migrated object type sheds its dedicated block here.)
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // CBZ.door (world/door.js) is read at call time: the prison is built
  // lazily (core/prisonlazy.js), long after this file parses.
  const { player, el } = CBZ;
  const g = CBZ.game;

  const fadeEl = document.getElementById("fade");

  /* ============================================================
     THE PROMPT IS ON THE THING — CBZ.prisonPrompt

     OWNER (2026-09-05): "it should be like on the cell door it should say
     to press e to close, instead of a button in middle of screen saying
     press e to close cell. you always put the noun on the button but really
     the noun should be what the button is on and it shouldnt say what its
     on. sabotage power should just be sabotage."

     So a prompt is a VERB pinned to a WORLD POINT. The word never names the
     object — the object is under it. Desktop and touch render the SAME
     element: a key chip + the verb on a keyboard, a tappable pill on a
     touchscreen (the chip is hidden there by mobile.css's .ikey rule and the
     pill fires touch.js's own data-tfn / data-tkey routing).

       CBZ.prisonPrompt(id, act, verb, opts)
         id     slot key — the owner re-arms it every frame, TTL retires it
         act    "@cbzFnName" (a POLLED verb must name a function: touch.js's
                synthesized keydown/keyup is gone before the poll runs) or a
                key letter for an event-driven listener
         verb   the word. ONE verb, no noun: "Close", "Sabotage", "Crawl".
         opts   at    {x,y,z} the thing this is about. The label floats over
                      it. Absent = no thing (the nuke) → the bottom band.
                key   letter the desktop chip shows for an @fn act (dflt "E")
                hold  a hold-to-work beat (pick / saw) — the chip says HOLD
                prog  0..1 through a timed beat whose time IS the play (saw,
                      cut). A thin line under the verb, on the thing itself.
                      Never a percentage: nobody reads a number off a saw.
                sub   a small second line ("to Cell Block Aisle")
                d2    squared metres to the thing, for ONE PILL below
                bind  the desktop key (opts.key, dflt E) fires the @fn act
                      while the pill is shown; no polling in the owner
                group a panel id: pills sharing the shown pill's group
                      show together (a lift car's floor buttons)
                row   0.. the pill's line within its group, stacked down

     A prompt lives exactly as long as its owner keeps arming it: the sweep
     below retires any slot not re-armed within the last two frames. There is
     no time-based tail — MEASURED (tools/visual-presets/prison-prompt-live
     .mjs): a 0.25 s TTL let the door label outlive the door by fifteen
     frames of a mouse turn, sliding across the screen pinned to nothing.

     ONE PILL, THE NEAREST (owner's law 5: "fewer button popups"). Several
     owners may arm at once — a vent beside a crate beside the breaker — and
     exactly one is shown: the thing you are stood closest to. Losers are
     hidden, not removed, so their owners' re-arm loops are untouched.
  ============================================================ */
  let promptLayer = null;
  const pills = new Map();          // id -> {wrap, sig, frame, d2, seq, at, shown}
  const DEFAULT_D2 = 4;
  let pillSeq = 0;
  const _pv = new THREE.Vector3();

  function onTouch() {
    if (CBZ.touchMode) return true;
    try { return !!(document.body && document.body.classList.contains("touch")); } catch (e) { return false; }
  }

  function ensureLayer() {
    if (promptLayer) return promptLayer;
    promptLayer = document.createElement("div");
    promptLayer.id = "prisonPrompts";
    document.body.appendChild(promptLayer);
    return promptLayer;
  }

  // CUFFED (CBZ.arrest.playerCuffed): every verb pinned on a thing is a hand
  // verb (a door handle, a lift button, a grille, a car door), so none of
  // them is offered and none fires. The pills simply are not there.
  function cuffedNow() { return !!(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on()); }
  function fireAct(act) {
    if (cuffedNow()) return;
    if (String(act).charAt(0) === "@") {
      const fn = String(act).slice(1);
      if (typeof CBZ[fn] === "function") CBZ[fn]();
    } else if (CBZ.touchKeyTap) CBZ.touchKeyTap(String(act));
  }

  // One prompt = an anchor div (positioned) holding the pill. The pill is a
  // <button class="tpill"> to touch.js's contract, so the capture-phase click
  // router there fires it and the UI_SEL list keeps a tap on it from becoming
  // a joystick press or a world tap. The local listener is the degrade path.
  function makePill(act, verb, opts) {
    const wrap = document.createElement("div");
    wrap.className = "wprompt" + (opts.at ? "" : " band");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tpill";
    if (String(act).charAt(0) === "@") b.setAttribute("data-tfn", String(act).slice(1));
    else b.setAttribute("data-tkey", String(act));
    const key = document.createElement("span");
    key.className = "ikey wkey";
    const letter = (opts.key || (String(act).charAt(0) === "@" ? "e" : String(act))).toUpperCase();
    key.textContent = opts.hold ? "HOLD " + letter : letter;
    const word = document.createElement("span");
    word.className = "wverb";
    word.textContent = verb;
    b.appendChild(key); b.appendChild(word);
    if (opts.sub) {
      const sub = document.createElement("span");
      sub.className = "wsub";
      sub.textContent = opts.sub;
      b.appendChild(sub);
    }
    b.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      fireAct(act);
    });
    wrap.appendChild(b);
    return wrap;
  }

  /* ---- CBZ.prisonReach(at, o): CAN YOUR HANDS GET THERE? --------------------
     OWNER (2026-09-29): "the button works too far, like from the second floor
     I can close the cell below it looking down; the button shows through
     shit." Every prompt-on-the-thing only armed on a flat XZ radius, so the
     tier above a cell, the far side of a wall and a closed door between you
     and a lock all counted as "at it". A verb on a thing now needs:
       SAME FLOOR   o.fy (the floor the thing stands on) within 1.2 m of your
                    feet, or, with no fy, the point itself between 1.0 m below
                    your feet and 2.6 m above them (a grille, a lock, a box);
       CLEAR SIGHT  nothing solid on the line from your eyes to it: a wall, a
                    closed door, a floor slab (CBZ.platforms). `o.skip` lists
                    the thing's own colliders, and the last `o.pad` metres
                    (default 0.25) are the thing itself, not in the way.
     Reach and facing stay each owner's own (they differ: a lock is an arm's
     length, a console a step). prisonPrompt applies this to every escape-mode
     pill that has an `at`, so a site that polls its own key must act only
     when prisonPrompt returned true. */
  const _rh = { hit: false, c: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  function eyeY() {
    const P = CBZ.player;
    return ((P && P.pos && P.pos.y) || 0) + (P && P.crouch ? 1.0 : 1.55);
  }
  function segBlocked(ax, ay, az, bx, by, bz, skip) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const skipFn = skip && skip.length ? function (c) { return skip.indexOf(c) < 0; } : null;
    if (CBZ.rayColliders) {
      try {
        if (CBZ.rayColliders(ax, ay, az, dx, dy, dz, 1, _rh, { any: true, filter: skipFn })) return true;
      } catch (e) { /* no grid on this page: the plain scan below */ }
    } else {
      // no broadphase (a headless check): the same slab test over every box
      const cols = CBZ.colliders || [];
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c || (skipFn && !skipFn(c))) continue;
        let t0 = 0, t1 = 1, ok = true;
        const lo = [c.minX, c.y0 != null ? c.y0 : -1e9, c.minZ], hi = [c.maxX, c.y1 != null ? c.y1 : 1e9, c.maxZ];
        const o = [ax, ay, az], d = [dx, dy, dz];
        for (let k = 0; k < 3 && ok; k++) {
          if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo[k] || o[k] > hi[k]) ok = false; continue; }
          let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k];
          if (ta > tb) { const q = ta; ta = tb; tb = q; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) ok = false;
        }
        if (ok) return true;
      }
    }
    // a floor slab between the eyes and the thing (the tier over a cell)
    const pl = CBZ.platforms || [];
    if (Math.abs(dy) > 1e-6) {
      for (let i = 0; i < pl.length; i++) {
        const p = pl[i];
        if (!p || p.top == null) continue;
        const t = (p.top - 0.02 - ay) / dy;               // the slab's underside-ish plane
        if (t <= 0.02 || t >= 0.98) continue;
        const x = ax + dx * t, z = az + dz * t;
        if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) return true;
      }
    }
    return false;
  }
  function prisonReach(at, o) {
    const P = CBZ.player;
    if (!at || !P || !P.pos) return false;
    o = o || {};
    const feet = P.pos.y || 0;
    if (o.fy != null) { if (Math.abs(o.fy - feet) > 1.2) return false; }
    else { const h = (at.y || 0) - feet; if (h < -1.0 || h > 2.6) return false; }
    const ex = P.pos.x, ey = eyeY(), ez = P.pos.z;
    let bx = at.x, by = at.y, bz = at.z;
    const L = Math.hypot(bx - ex, by - ey, bz - ez);
    const pad = o.pad != null ? o.pad : 0.25;
    if (L <= pad) return true;
    // the thing's own body is not in the way of the thing: a box that holds
    // the point (the safe the dial is on, the leaf the lock is in) is skipped
    let skip = o.skip ? o.skip.slice() : [];
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || at.x <= c.minX || at.x >= c.maxX || at.z <= c.minZ || at.z >= c.maxZ) continue;
      if (c.y0 != null && (at.y < c.y0 || at.y > c.y1)) continue;
      skip.push(c);
    }
    const k = (L - pad) / L;
    bx = ex + (bx - ex) * k; by = ey + (by - ey) * k; bz = ez + (bz - ez) * k;
    return !segBlocked(ex, ey, ez, bx, by, bz, skip);
  }
  CBZ.prisonReach = prisonReach;

  function prisonPrompt(id, act, verb, opts) {
    if (!act || !verb) return false;
    if (cuffedNow()) return false;
    opts = opts || {};
    // the reach law above, for every prison pill pinned on a thing
    if (opts.at && !opts.city && !opts.noReach && CBZ.game && CBZ.game.mode === "escape" &&
        !prisonReach(opts.at, { fy: opts.fy, skip: opts.skip, pad: opts.pad })) {
      prisonPromptClear(id);
      return false;
    }
    const sig = act + "|" + verb + "|" + (opts.sub || "") + "|" + (opts.hold ? 1 : 0) + "|" + (opts.at ? 1 : 0) + "|" + (opts.key || "");
    let p = pills.get(id);
    if (!p || p.sig !== sig) {
      if (p && p.wrap.parentNode) p.wrap.parentNode.removeChild(p.wrap);
      p = { wrap: makePill(act, verb, opts), sig: sig, frame: 0, d2: 0, seq: 0, at: null, shown: null };
      pills.set(id, p);
      ensureLayer().appendChild(p.wrap);
    }
    p.at = opts.at || null;
    setProg(p, opts.prog);
    p.city = !!opts.city;          // a CITY verb on a thing (boarding.js car doors) survives the city gate below
    // PANEL GROUPS + BOUND KEYS (city/elevators.js, the island tower lifts).
    // `group`: a panel with several buttons (a lift car's floor buttons) is ONE
    // thing, so every pill sharing the nearest pill's group shows with it,
    // stacked `row` lines down. `bind`: the pill's own key fires its @fn act on
    // a keyboard while the pill is SHOWN (capture phase, below), so an owner
    // does not have to poll a key and every other [E] listener stands aside.
    p.group = opts.group || null;
    p.row = opts.row | 0;
    p.act = act;
    p.bind = opts.bind ? String(opts.key || "e").toLowerCase() : "";
    p.frame = frameNo;
    // Unranked callers sit at 2 m — the range nearly every prison prompt arms
    // itself at — so a site that never learns about d2 still competes fairly.
    p.d2 = (opts.d2 == null || !isFinite(opts.d2)) ? DEFAULT_D2 : opts.d2;
    p.seq = ++pillSeq;
    promptLayer.classList.add("on");
    return true;
  }

  // the work line: a hairline under the pill, anchored with it over the
  // thing. Updated in place (not part of the pill's signature), so a saw
  // stroke never rebuilds the button under the player's finger.
  function setProg(p, v) {
    const on = v != null && isFinite(v) && v > 0;
    if (!on) { if (p.bar) p.bar.style.display = "none"; return; }
    if (!p.bar) {
      const bar = document.createElement("div");
      bar.style.cssText = "position:absolute;left:10%;right:10%;bottom:11px;height:3px;border-radius:2px;z-index:1;" +
        "background:rgba(10,16,24,.55);overflow:hidden;pointer-events:none";
      const fill = document.createElement("div");
      fill.style.cssText = "height:100%;width:0;background:#ffd27a;border-radius:2px";
      bar.appendChild(fill);
      p.wrap.appendChild(bar);
      p.bar = bar; p.barFill = fill;
    }
    p.bar.style.display = "";
    const w = (Math.min(1, v) * 100).toFixed(1) + "%";
    if (p.barFill.style.width !== w) p.barFill.style.width = w;
  }

  function prisonPromptClear(id) {
    const p = pills.get(id);
    if (!p) return;
    if (p.wrap.parentNode) p.wrap.parentNode.removeChild(p.wrap);
    pills.delete(id);
    if (promptLayer && !pills.size) promptLayer.classList.remove("on");
  }

  // ONE PILL: the thing you are LOOKING at, then the nearest. A pin dead ahead
  // counts at 0.6x its distance, one beside you at 1.6x, so a ladder you face
  // beats a lift button at your shoulder (owner: priority is what you look at).
  function lookWeight(p) {
    const P = CBZ.player, cam = CBZ.cam;
    if (!p.at || !P || !P.pos || !cam || !CBZ.game || CBZ.game.mode !== "city") return 1;
    const dx = p.at.x - P.pos.x, dz = p.at.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.4) return 0.6;
    const face = Math.max(0, (dx / d) * -Math.sin(cam.yaw) + (dz / d) * -Math.cos(cam.yaw));
    return 1.6 - face;
  }
  function arbitrate() {
    let best = null, bestW = Infinity;
    pills.forEach(function (p) {
      const w = p.d2 * lookWeight(p);
      if (!best || w < bestW - 1e-6 || (w <= bestW + 1e-6 && p.seq > best.seq)) { best = p; bestW = w; }
    });
    pills.forEach(function (p) {
      const show = p === best || !!(best && best.group && p.group === best.group);
      if (p.shown !== show) { p.shown = show; p.wrap.style.display = show ? "" : "none"; }
    });
    return best;
  }

  // A BOUND pill's key, on a keyboard. Capture phase on window, so it runs
  // before the city's [E] ride router and survival's [E] grab: the verb pinned
  // over the thing you are standing at is what the key does, and nothing
  // else also fires on the same press.
  addEventListener("keydown", function (e) {
    if (!pills.size || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (CBZ.verbWheel && CBZ.verbWheel.isOpen()) return;   // the city verb wheel is modal
    const gm = CBZ.game;
    if (!gm || gm.state !== "playing") return;
    const k = String(e.key || "").toLowerCase();
    let hit = null;
    pills.forEach(function (p) { if (!hit && p.shown && p.bind && p.bind === k && frameNo - p.frame <= 2) hit = p; });
    if (!hit) return;
    // CITY: the card's target and this pin may both offer the key. The one the
    // player is LOOKING at owns it (city/interactions.js cityUseOwner); when
    // that is the card, the press is left for the card's own listener.
    if (gm.mode === "city" && CBZ.cityUseOwner && CBZ.cityUseOwner(k) === "card") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    fireAct(hit.act);
  }, true);

  // The shown BOUND pin for a key, if any: { at, d2, verb } (city/interactions.js
  // weighs it against the card's target to decide who owns the press).
  CBZ.prisonPromptShownFor = function (key) {
    key = String(key || "e").toLowerCase();
    let hit = null;
    pills.forEach(function (p) { if (!hit && p.shown && p.bind === key && frameNo - p.frame <= 2) hit = p; });
    return hit ? { at: hit.at, d2: hit.d2 } : null;
  };

  /* Pin the shown prompt over its thing: project the world point through the
     LIVE camera (camera.js updates it at always-order 50; this runs at 96).
     OFF THE FRAME = NO LABEL. A point behind the camera, or past the edge by
     more than a sliver, hides the label; only a point just off the edge is
     held at the margin. The first version clamped EVERY off-screen anchor to
     the edge, and that is what the owner saw as "nowhere close to the cell
     door" — a word parked on the border, pinned to nothing (18% of frames in
     a live walk-and-turn, worst 2,500 px from the leaf). The verb still
     works off-screen; it just does not pretend to be somewhere. */
  const EDGE = 0.03, SLIVER = 1.12;
  function placePrompt(p) {
    if (!p.at) return;
    const cam = CBZ.camera;
    if (!cam) return;
    // THIS frame's camera, not last frame's. camera.js moved it at order 50;
    // the renderer will not refresh matrixWorldInverse until the draw AFTER
    // this, so project() here would trail the camera by a frame — which on
    // a fast mouse turn reads as the label swimming off the door. r128's
    // Camera.updateMatrixWorld refreshes the inverse too.
    cam.updateMatrixWorld();
    _pv.set(p.at.x, p.at.y, p.at.z).project(cam);
    if (_pv.z > 1 || Math.abs(_pv.x) > SLIVER || Math.abs(_pv.y) > SLIVER) { p.wrap.style.visibility = "hidden"; return; }
    const w = window.innerWidth || 800, h = window.innerHeight || 600;
    const nx = Math.max(-1 + EDGE * 2, Math.min(1 - EDGE * 2, _pv.x));
    const ny = Math.max(-1 + EDGE * 4, Math.min(1 - EDGE * 2, _pv.y));
    const sx = Math.round((nx * 0.5 + 0.5) * w), sy = Math.round((-ny * 0.5 + 0.5) * h) + (p.row || 0) * 40;
    if (p._sx !== sx || p._sy !== sy) {
      p._sx = sx; p._sy = sy;
      p.wrap.style.left = sx + "px";
      p.wrap.style.top = sy + "px";
    }
    p.wrap.style.visibility = "";
  }

  // Sweep + placement. A prompt whose owner stopped re-arming it goes away
  // within two frames, and the whole layer stands down outside a live prison
  // run (a prison prompt must never survive into the city, a pause or a death
  // screen — a pause stops the updaters, so nothing re-arms and it clears).
  let frameNo = 0;
  CBZ.onAlways(96, function () {
    frameNo++;
    if (!pills.size) return;
    const gm = CBZ.game;
    const live = !!(gm && gm.state === "playing");
    const ids = [];
    pills.forEach(function (p, id) {
      if (!live || (gm.mode === "city" && !p.city) || frameNo - p.frame > 2) ids.push(id);
    });
    for (let i = 0; i < ids.length; i++) prisonPromptClear(ids[i]);
    if (!pills.size) return;
    const best = arbitrate();
    if (best) pills.forEach(function (p) { if (p.shown) placePrompt(p); });
  });

  CBZ.prisonPrompt = prisonPrompt;
  CBZ.prisonPromptClear = prisonPromptClear;

  /* ---- CBZ.workLine(id, at, frac) — THE ONE WORK READOUT, ON THE THING ------
     OWNER: "when I pick up a key card, if there's a loading 0 to 100% bar,
     that's really stupid." Pickups are instant now. What is left timed is
     only work whose time IS the play (a drill on a vault door, a tap being
     wired, a lock being pried under a guard's nose), and its readout is a
     short hairline hung on the thing being worked, projected from its world
     point every frame. Never a number, never a HUD bar. Any game may use it
     (not gated to the prison like the pills above). The caller re-arms it
     every frame it is working; two frames without a re-arm and it is gone. */
  let workLayer = null;
  const workLines = new Map();       // id -> {el, fill, at, frac, frame}
  function workLine(id, at, frac) {
    if (!id || !at) return false;
    if (!workLayer) {
      workLayer = document.createElement("div");
      workLayer.id = "workLines";
      workLayer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:24";
      document.body.appendChild(workLayer);
    }
    let w = workLines.get(id);
    if (!w) {
      const el = document.createElement("div");
      el.style.cssText = "position:absolute;left:0;top:0;width:54px;height:4px;margin:-2px 0 0 -27px;" +
        "border-radius:2px;background:rgba(10,16,24,.6);box-shadow:0 0 0 1px rgba(255,255,255,.18);overflow:hidden;visibility:hidden";
      const fill = document.createElement("div");
      fill.style.cssText = "height:100%;width:0;background:#ffd27a";
      el.appendChild(fill);
      workLayer.appendChild(el);
      w = { el: el, fill: fill, at: null, frac: 0, frame: 0 };
      workLines.set(id, w);
    }
    w.at = at; w.frac = Math.max(0, Math.min(1, +frac || 0)); w.frame = frameNo;
    return true;
  }
  function workLineClear(id) {
    const w = workLines.get(id);
    if (!w) return;
    if (w.el.parentNode) w.el.parentNode.removeChild(w.el);
    workLines.delete(id);
  }
  CBZ.onAlways(96.5, function () {
    if (!workLines.size) return;
    const cam = CBZ.camera;
    const ids = [];
    workLines.forEach(function (w, id) { if (frameNo - w.frame > 2) ids.push(id); });
    for (let i = 0; i < ids.length; i++) workLineClear(ids[i]);
    if (!cam || !workLines.size) return;
    cam.updateMatrixWorld();
    const W = window.innerWidth || 800, H = window.innerHeight || 600;
    workLines.forEach(function (w) {
      _pv.set(w.at.x, w.at.y || 0, w.at.z).project(cam);
      if (_pv.z > 1 || Math.abs(_pv.x) > 1 || Math.abs(_pv.y) > 1) { w.el.style.visibility = "hidden"; return; }
      w.el.style.left = Math.round((_pv.x * 0.5 + 0.5) * W) + "px";
      w.el.style.top = Math.round((-_pv.y * 0.5 + 0.5) * H) + "px";
      w.fill.style.width = (w.frac * 100).toFixed(1) + "%";
      w.el.style.visibility = "";
    });
  });
  CBZ.workLine = workLine;
  CBZ.workLineClear = workLineClear;
  CBZ.prisonPromptShown = function () {
    let out = null;
    pills.forEach(function (p, id) {
      if (p.shown) out = { id: id, verb: p.wrap.querySelector(".wverb").textContent, sub: (p.wrap.querySelector(".wsub") || {}).textContent || "",
        key: p.wrap.querySelector(".wkey").textContent, anchored: !!p.at, x: p._sx, y: p._sy };
    });
    return out;
  };

  /* ---- ratchet -------------------------------------------------------------
     Boot-stable by construction: every owning file DECLARES its site at load
     into a plain array (order-independent — killstreaks.js loads BEFORE this
     file), so the count never depends on the player having walked to a
     breaker. `legacy` is the number of prison prompts still naming a keyboard
     key on a touch screen and may only ever go DOWN. `nouned` is the number of
     LIVE prompts whose verb carries a noun ("Close cell", "Sabotage Power")
     and must stay 0. */
  const NOUN_RE = /\b(the|your|a|an|power|door|cell|lock|racks|crate|padlock|safe|vent|hatch)\b/i;
  CBZ.prisonPromptAudit = function () {
    const s = CBZ._prisonPromptSites || [];
    const pilled = [], textOnly = [];
    for (let i = 0; i < s.length; i++) (s[i].act ? pilled : textOnly).push(s[i].id);
    let shown = 0, nouned = 0, anchored = 0;
    pills.forEach(function (p) {
      if (p.shown) shown++;
      if (p.at) anchored++;
      if (NOUN_RE.test(p.wrap.querySelector(".wverb").textContent)) nouned++;
    });
    return {
      sites: s.length, pilled: pilled.length, textOnly: textOnly.length,
      legacy: 0, live: pills.size, shown: shown, anchored: anchored, nouned: nouned, touch: onTouch(),
      pilledIds: pilled, textOnlyIds: textOnly,
    };
  };

  /* ============================================================
     THE OTHER HALF OF THE VERB — CBZ.prisonDoors (close by tap, close by key)

     OWNER (verbatim): "all doors should open or close when pressed. I like
     auto open, don't remove, but I want ability to close. Of course still
     needing key. This is really mostly adding CLOSE BY TAP ON MOBILE, no
     button needed."

     THE MEASURED FAULT: every door in the compound was a one-way valve. Five
     files own a door primitive — world/door.js's unit sally port,
     world/prisonwings.js's nine pivot leaves, world/adminwing.js's two,
     world/gunroom.js's armoury gate plus its inner cage, world/cellblock.js's
     thirteen sliding cell fronts — and between them they exposed exactly ONE
     public close, CBZ.closeDoor, which only systems/lockdown.js and the run
     reset ever called. Twenty-seven doors, zero of them shuttable by hand.

     ONE SEAM, NOT FIVE COPIES. Each file DECLARES its doors into the plain
     array CBZ._prisonDoorSpecs at load — order-independent, the same trick
     CBZ._prisonPromptSites uses, and necessary because every world file above
     parses 130+ script tags before this one. This block is the only place
     that knows what the verb IS; the primitives themselves are untouched.

     A spec is:
       id / label   what the audit prints and what the desktop hint says
       at()         {x,y,z} of the leaf — the point reach is measured to
       pick()       meshes a tap ray may hit (the pivot / leaf / collider pane)
       col()        the leaf's own collider object, so the audit can state
                    whether a "closed" door is actually SOLID again — a shut
                    door with no collider in CBZ.colliders is a picture
       isOpen()     live state, read from the file's own flag
       permanent()  blown, or released by the control-room console. LAW 4: a
                    hole is a hole, and never becomes a door again.
       canUse()     THE CREDENTIAL, and it is the SAME test the file's open
                    path runs. You may only shut a door you would have been
                    allowed to open — a man with no keycard cannot shut a
                    sally gate in a guard's face, and a cell front, which asks
                    nothing to open, asks nothing to close either.
       set(v)       the file's own setOpen/closeDoor. The SOUND belongs there,
                    so each door keeps voicing itself from its own coordinates
                    with the door_close cue systems/audio.js already ships.
       keys         (array, or fn -> array) the items that open it AT THE
                    DOOR ("Keycard", "Corridor Key", "Cell Key" ...); empty or
                    absent = unlocked. The pill on a shut door you cannot open
                    says "Locked" with keys[0] under it (owner, 2026-09-29:
                    "all doors can be opened with a key, not just a button").
       beat()       optional: true while the file's own hold-to-work verb on
                    this lock is live (a pick, a saw), so its pill is shown
                    instead of "Locked".
       cols()       optional: every slab the door has (the unit's sally port
                    has two faces); otherwise col(). Reach, floor and sight are
                    measured to these.
       floor()      optional: the floor the door stands on (else the slab's y0)
       autoR        metres of that file's own approach-open radius, so the
                    latch below knows how far away "away" is.

     THE LATCH (LAW 3). Auto-open stays exactly as it was — which means the
     instant you shut a door you are still standing in the radius that opened
     it. A deliberate close is a LATCH, not a suggestion: each owning tick
     asks CBZ.prisonDoorLatched(id) before its PROXIMITY open and skips it.
     The latch clears when you walk out of autoR + 2 m, when you deliberately
     open the door again, when anything else opens it (a guard tailgating, the
     racks thrown, a breaching charge), or when the run stops. Staff
     tailgating is deliberately NOT latched out: a guard with a card opens his
     own door, and that window is what the whole wing is built on.
     world/prisonwings.js's 3 s auto-shut composes with this instead of
     duplicating it — that timer only runs while a door is OPEN, and a latched
     door is shut, so the two never argue.
  ============================================================ */
  const doorSpecs = (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = []));
  const LATCH_PAD = 2.0;              // metres past autoR that release the latch
  // ARM'S REACH, MEASURED TO THE LEAF (its shut slab), not to the middle of
  // the doorway: a 2.2 m pair is reachable from either jamb, a lock is not
  // reachable from across the room.
  const DOOR_REACH = 1.8;
  function dsafe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
  function doorPoint(s) { return dsafe(function () { return s.at(); }, null); }
  function doorIsOpen(s) { return dsafe(function () { return !!s.isOpen(); }, false); }
  function doorGone(s) { return dsafe(function () { return !!(s.permanent && s.permanent()); }, true); }
  function doorCred(s) { return dsafe(function () { return !!s.canUse(); }, false); }
  function doorD2(s) {
    const p = doorPoint(s);
    if (!p || !player || !player.pos) return Infinity;
    const dx = player.pos.x - p.x, dz = player.pos.z - p.z;
    return dx * dx + dz * dz;
  }
  function doorById(id) {
    if (id && typeof id === "object") return id;
    for (let i = 0; i < doorSpecs.length; i++) if (doorSpecs[i].id === id) return doorSpecs[i];
    return null;
  }
  /* THE ONE PLACE A DOOR MOVES ON THE PLAYER'S OWN SAY-SO. A tap
     (systems/touch.js tapWorld) and the polled [E] below both end here, so
     the two can never drift — the same reason the pill verbs above are named
     functions rather than inlined key branches. */
  function doorAct(s, want) {
    if (!s) return null;
    if (doorGone(s)) return "gone";                     // blown / released: LAW 4
    if (doorIsOpen(s) === want) return "already";
    if (!doorCred(s)) { doorDeny(s); return "denied"; } // the open path's own keys
    const spot = doorTouchSpot(s);                      // the leaf's face as it stood when the hand went to it
    dsafe(function () { return s.set(want); }, false);
    if (doorIsOpen(s) !== want) return "refused";
    s._latch = !want;                                   // shutting it LATCHES it shut
    handOnDoor(s, spot);
    // the block notices a door opened off the clock (systems/prisondoorwatch.js)
    if (CBZ.prisonDoorWatch && CBZ.prisonDoorWatch.acted) dsafe(function () { return CBZ.prisonDoorWatch.acted(s, want); }, null);
    return want ? "opened" : "closed";
  }
  /* A DOOR IS MOVED WITH A HAND. The leaf used to swing on the keypress with
     both arms at the sides, and then was "pushed" by a take's reach that
     stopped a hand short of it. Now the PALM goes flat on the leaf's own near
     face (CBZ.verbs.touchSurface: the leaf mesh's oriented box, the face the
     player stands in front of, at chest height, clamped inside its edges)
     through CBZ.verbs.touch — the plant solver every hand on the world uses;
     the body steps in and turns to it if it stood off, and a leaf further
     than a step away gets no hand at all. First person: the same palm down
     the lens. Guarded: no verbs, no hand, the door still moves. */
  function doorTouchSpot(s) {
    const V = CBZ.verbs;
    if (!V || !V.touchSurface || !player || !player.pos) return null;
    const meshes = dsafe(function () { return s.pick ? s.pick() : null; }, null);
    const leaf = meshes && meshes[0];
    if (!leaf || !leaf.isObject3D) return null;
    const y = (player.pos.y || 0) + 1.05;
    return dsafe(function () { return V.touchSurface(leaf, { x: player.pos.x, y: y, z: player.pos.z }, y, 0.12); }, null);
  }
  function handOnDoor(s, spot) {
    const V = CBZ.verbs;
    if (!V || !V.touch || !spot) return;
    dsafe(function () { return V.touch(player, { point: spot.point, normal: spot.normal, kind: "palm", key: "door:" + s.id }); }, null);
  }
  /* ---- WHICH DOOR IS "THIS" DOOR -------------------------------------------
     (owner, 2026-09-29: "the button works too far ... shows through shit".)
     A door is the one you are at when ALL of these hold, measured to its
     leaf (the shut slab: s.cols() / s.col()), not to a centre point:
       REACH   within DOOR_REACH metres of the slab, in plan;
       FLOOR   the door's floor (the slab's y0, or s.floor()) within 1.2 m
               of your feet: the tier over a cell is not at that cell;
       SIGHT   a clear line from your eyes to the leaf (CBZ.prisonReach:
               walls, other doors, floor slabs), the door's own slab excepted;
       FACING  it is in front of the camera.
     Every door that is not blown counts, LOCKED ONES TOO: a locked door
     says it is locked, on the leaf, and what opens it. */
  function doorBoxes(s) {
    const b = dsafe(function () { return s.cols ? s.cols() : [s.col()]; }, null);
    return (b || []).filter(Boolean);
  }
  function doorFloor(s, box) {
    if (s.floor) { const f = dsafe(function () { return s.floor(); }, null); if (f != null) return f; }
    if (box && box.y0 != null) return box.y0;
    const p = doorPoint(s);
    return p ? Math.max(0, (p.y || 1.4) - 1.4) : 0;
  }
  // the nearest point of a slab, pulled 0.25 m in from its ends (the jambs
  // and the wall either side are not the leaf)
  function slabPoint(c, x, z) {
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    const ix = Math.min(0.25, w / 2), iz = Math.min(0.25, d / 2);
    return {
      x: Math.max(c.minX + (w > d ? ix : 0), Math.min(c.maxX - (w > d ? ix : 0), x)),
      z: Math.max(c.minZ + (d >= w ? iz : 0), Math.min(c.maxZ - (d >= w ? iz : 0), z)),
    };
  }
  function slabDist(c, x, z) {
    const dx = Math.max(c.minX - x, 0, x - c.maxX), dz = Math.max(c.minZ - z, 0, z - c.maxZ);
    return Math.hypot(dx, dz);
  }
  // -> { s, d, at } when the player can put a hand on door s right now
  function doorReach(s, facing) {
    if (!player || !player.pos) return null;
    const P = player.pos;
    const boxes = doorBoxes(s);
    let best = null;
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i];
      const d = slabDist(c, P.x, P.z);
      if (d > DOOR_REACH || (best && d >= best.d)) continue;
      const fy = doorFloor(s, c);
      if (Math.abs(fy - (P.y || 0)) > 1.2) continue;
      const q = slabPoint(c, P.x, P.z);
      const at = { x: q.x, y: fy + 1.35, z: q.z };
      if (facing) {
        const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const dx = at.x - P.x, dz = at.z - P.z, len = Math.hypot(dx, dz);
        // standing IN the doorway the leaf is at your shoulder: that is at it
        if (len > 0.35 && (dx / len) * fx + (dz / len) * fz < 0.3) continue;
      }
      if (!prisonReach(at, { fy: fy, skip: boxes, pad: 0.12 })) continue;
      best = { s: s, d: d, at: at, fy: fy };
    }
    return best;
  }
  function doorTarget(facing) {
    let best = null;
    for (let i = 0; i < doorSpecs.length; i++) {
      const s = doorSpecs[i];
      if (doorGone(s)) continue;
      const r = doorReach(s, facing);
      if (r && (!best || r.d < best.d)) best = r;
    }
    return best;
  }
  function doorKeys(s) {
    const k = s.keys;
    const v = typeof k === "function" ? dsafe(function () { return k(); }, null) : k;
    return v && v.length ? v : null;
  }
  // a hold-to-work beat of the door's own file is live (a pick, a saw): its
  // pill ("Pick", "Saw") is the verb, this one stands aside
  function doorBeat(s) { return !!(s.beat && dsafe(function () { return s.beat(); }, false)); }
  // what the pill on the leaf says, or null for no pill
  function doorVerb(s) {
    const open = doorIsOpen(s), cred = doorCred(s);
    if (open) return cred ? { verb: "Close" } : null;
    if (cred) {
      const keys = doorKeys(s);
      const staff = !!(CBZ.prisonStaffKey && CBZ.prisonStaffKey());
      if (!keys || staff) return { verb: "Open" };
      if (keys.indexOf("Keycard") >= 0 && CBZ.game && CBZ.game.hasKey) return { verb: "Swipe" };
      return { verb: "Unlock" };
    }
    if (doorBeat(s)) return null;
    const keys = doorKeys(s);
    return { verb: "Locked", sub: keys ? keys[0] : "", locked: true };
  }
  // a refused hand on a locked door: the lock rattles / the reader clicks
  function doorDeny(s) {
    const p = doorPoint(s);
    if (p && CBZ.worldSfx) CBZ.worldSfx("switch", p.x, p.z, { y: p.y, ref: 6, volume: 0.45, gap: 0.5 });
  }
  CBZ.prisonDoorList = function () { return doorSpecs; };
  CBZ.prisonDoorLatched = function (id) { const s = doorById(id); return !!(s && s._latch); };
  CBZ.prisonDoorToggle = function (id) {
    const s = doorById(id);
    return s ? doorAct(s, !doorIsOpen(s)) : null;
  };
  CBZ.prisonDoorSet = function (id, v) { const s = doorById(id); return s ? doorAct(s, !!v) : null; };
  CBZ.prisonDoorNearest = function () { const t = doorTarget(false); return t && doorIsOpen(t.s) ? t.s : null; };
  // The @fn a pill would fire, and the function the [E] branch calls. Named on
  // CBZ so a tap, a key and a headless probe are provably the same code.
  CBZ.prisonDoorCloseNearest = function () {
    const t = doorTarget(true);
    return t && doorIsOpen(t.s) ? doorAct(t.s, false) : null;
  };
  // THE ONE DOOR VERB: the door in front of you, opened if it is shut and
  // shut if it is open — the pill pinned on the leaf fires this.
  CBZ.prisonDoorVerbNearest = function () {
    const t = doorTarget(true);
    if (!t) return null;
    const v = doorVerb(t.s);
    if (!v) return null;
    return doorAct(t.s, !doorIsOpen(t.s));
  };
  // what the leaf in front of you says right now (the census reads this)
  CBZ.prisonDoorTarget = function () {
    const t = doorTarget(true);
    if (!t) return null;
    const v = doorVerb(t.s);
    return { id: t.s.id, d: t.d, at: t.at, verb: v ? v.verb : null, sub: v ? v.sub || "" : "" };
  };
  /* THE RATCHET. `doors` is every declared leaf; `closeable` is the number
     that expose the verb RIGHT NOW (open, not blown, credential in hand) and
     is the number the owner asked to stop being zero. `latched` may only be
     non-zero while the player is stood at a door he shut himself. */
  CBZ.prisonDoorAudit = function () {
    const rows = [];
    let open = 0, gone = 0, cred = 0, latched = 0, closeable = 0;
    for (let i = 0; i < doorSpecs.length; i++) {
      const s = doorSpecs[i];
      const o = doorIsOpen(s), g2 = doorGone(s), c = doorCred(s), l = !!s._latch;
      if (o) open++;
      if (g2) gone++;
      if (c) cred++;
      if (l) latched++;
      if (o && !g2 && c) closeable++;
      // -1 = the spec declares no collider; otherwise 1 when the leaf is
      // solid right now. A closed door must read 1, an open one 0.
      let col = -1;
      if (s.col) {
        const cc = dsafe(function () { return s.col(); }, null);
        if (cc) col = CBZ.colliders.indexOf(cc) >= 0 ? 1 : 0;
      }
      rows.push({ id: s.id, open: o, gone: g2, cred: c, latch: l, col: col,
        keys: doorKeys(s), d: Math.round(Math.sqrt(doorD2(s)) * 10) / 10 });
    }
    return { doors: doorSpecs.length, open: open, blown: gone, credentialed: cred,
      latched: latched, closeable: closeable, rows: rows };
  };

  /* The [E] half. Runs from updateInteractions.
     OWNER (2026-09-28): "the cop should be able to open one on his own." The
     verb used to be CLOSE only — a door opened by approach or not at all —
     so the officer stood at a racked cell with the keys on his belt and no
     way to use them. Now the door in front of you says what it will do,
     "Open" or "Close", pinned on the leaf, and it is a BOUND pill: its key
     fires only while it is the prompt shown, so a bunk or a man beside the
     door never gets the same press. On touch the same pill is the button
     (a tap on the bars still works too: systems/touch.js ends in doorAct). */
  function doorVerbPrompt() {
    // updateInteractions runs in the CITY too (its mode gate is the win check
    // at the bottom), and the compound shares the city's coordinate space
    // near the origin — so without this a city walk past z=-8 would be
    // offered the yard checkpoint. The tap path carries the same guard.
    if (!CBZ.game || CBZ.game.mode !== "escape") return;
    const t = doorTarget(true);
    if (!t) return;
    const v = doorVerb(t.s);
    if (!v) return;
    // reach was proven by doorTarget against the door's own slab
    CBZ.prisonPrompt("door", "@prisonDoorVerbNearest", v.verb,
      { at: t.at, d2: t.d * t.d, bind: true, sub: v.sub || undefined, noReach: true });
  }

  /* LATCH UPKEEP. Order 41.46 sits AFTER every door tick (gunroom 41,
     adminwing 41.4, prisonwings 41.44) so a latch set at order 40 is read by
     all of them before it can be cleared in the same frame. */
  CBZ.onUpdate(41.46, function () {
    if (!doorSpecs.length) return;
    const gm = CBZ.game;
    const live = !!(gm && gm.mode === "escape" && gm.state === "playing");
    for (let i = 0; i < doorSpecs.length; i++) {
      const s = doorSpecs[i];
      if (!s._latch) continue;
      if (!live || doorIsOpen(s)) { s._latch = false; continue; }   // somebody opened it
      const r = (s.autoR || 2.5) + LATCH_PAD;
      if (doorD2(s) > r * r) s._latch = false;                      // you walked away
    }
  });

  /* ---- THE VERBS, EXTRACTED ------------------------------------------------
     Each of these was written inline inside the `if (CBZ.keys["e"])` branch it
     still serves. They are lifted out UNCHANGED so the key path and the pill
     tap run the one implementation — a polled key cannot reach a synthesized
     keydown (see the block comment above), so the pill needs a named function,
     and two copies of a verb is exactly how a tap drifts from a keypress.
     Each re-validates its own preconditions: a pill is a DOM object that can
     outlive the frame that armed it by one tick, and must never fire stale. */
  let armedVent = null, armedVentT = 0;

  function sabotagePower() {
    const breaker = CBZ.breaker;
    if (!breaker || breaker.sabotaged) return;
    const bdx = player.pos.x - breaker.x, bdz = player.pos.z - breaker.z;
    if (bdx * bdx + bdz * bdz >= 1.8) return;
    breaker.sabotaged = true;
    breaker.timer = 20;
    breaker.light.material.color.setHex(0xff3b3b);
    breaker.light.material.emissive.setHex(0xff0000);
    if (breaker.setOpen) breaker.setOpen(true);          // the cabinet door hangs open on its hinge
    if (CBZ.ceilingLamp) {
      CBZ.ceilingLamp.material.color.setHex(0x2b2b2b);
      CBZ.ceilingLamp.material.emissive.setHex(0x000000);
    }
    // NINETEEN LAMPS AND THREE CAMERAS GO OUT ON THIS FRAME. "POWER OUT!" was
    // a caption on the single most visible event in the prison, and the
    // explainer under it ("…deactivated for 20s") was the mechanic reading
    // itself out. What was missing is the only thing a hand on a breaker
    // actually makes: the THROW. Your own hand, so the global surface.
    if (CBZ.sfx) CBZ.sfx("switch");
  }

  /* ============================================================
     THE VENTS: A GRILLE YOU TAKE OFF, A DUCT YOU CRAWL.

     OWNER (2026-09-28): "vents, and the buttons to jump into vents are also
     dumb." What he was looking at: a pill reading "Enter / to Armory Duct"
     over a grille that was a picture on the wall, and a tap that blacked the
     screen and dropped him in another building. Now:

     1. THE GRILLE IS SCREWED ON (world/ventilation.js's louvre panel, world/
        escape_routes.js's hatch lid: vent.cover). At a closed grille the verb
        over it is "Unscrew" if you carry a flat blade (a shiv, a razor, a
        hacksaw blade, a pick, a hatchet: BLADES) or "Pry" with bare hands.
        The work is TIMED and it is the play: 2.6 s of quiet screw turns, or
        6.5 s of wrenching sheet steel that anyone standing within 7 m hears.
        Seen or heard with your hands on it = a report and heat, the same
        currency the culvert saw spends (systems/escapeplan.js). The panel
        is then set down against the wall, the lid slid aside, for the rest
        of the run.
     2. AN OPEN GRILLE OFFERS "Crawl" (or "Climb in" at a floor hatch), with
        where it goes as the small second line.
     3. THE CRAWL IS A BODY, NOT A FADE. This file takes the player's body
        (the `_doorArc` seam systems/physics.js and entities/moves_posture.js
        already share) and the lens (CBZ.cineCam, the one scripted-camera
        channel systems/camera.js reads): he goes down PRONE (character.js's
        own crawl pose, paddling), crawls to the grille and head first into
        the duct mouth with the camera low behind him; then crawls a stretch
        of real galvanised duct (CBZ.ventDuct, world/ventilation.js) with the
        camera behind his boots toward the light of the far grille; then
        comes out of the far grille head first, pushes its panel off, and
        gets up. A floor hatch is climbed down into and up out of. No black
        card, no teleport you can see.
     The tower ladders are not vents: they are climbed (systems/climb.js).
     ============================================================ */
  const BLADES = ["Shiv", "Shank", "Razor Blade", "Hacksaw Blade", "Lockpick", "Hatchet", "Pickaxe"];
  const VENT_REACH2 = 1.6;
  function ventTool() {
    const e = CBZ.econ;
    if (!e || !e.hasItem) return null;
    for (let i = 0; i < BLADES.length; i++) if (e.hasItem(BLADES[i])) return BLADES[i];
    return null;
  }
  function ventD2(v) { const dx = player.pos.x - v.x, dz = player.pos.z - v.z; return dx * dx + dz * dz; }
  function uprightGuard(gd) {
    return !!(gd && gd.group && !gd.dead && !(gd.ko > 0) && !gd.asleep && !gd.tied && !(gd.bribed > 0));
  }
  function guardOnYou(hearR) {
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (!uprightGuard(gd)) continue;
      if (hearR > 0) {
        const dx = gd.group.position.x - player.pos.x, dz = gd.group.position.z - player.pos.z;
        if (dx * dx + dz * dz < hearR * hearR) return gd;
      }
      if (CBZ.guardSees) { try { if (CBZ.guardSees(gd)) return gd; } catch (e) {} }
    }
    return null;
  }

  // ---- 1. taking the grille off -------------------------------------------
  const VW = { vent: null, t: 0, need: 0, tool: null, tick: 0 };
  function ventWorkStart(v) {
    if (!v || !v.cover || v.cover.open || VW.vent || CBZ.crawling) return;
    if (ventD2(v) >= VENT_REACH2) return;
    VW.vent = v; VW.t = 0; VW.tick = 0;
    VW.tool = ventTool();
    VW.need = VW.tool ? 2.6 : 6.5;
    player.crouch = true;                     // down on a knee at the grille
  }
  function ventWorkTick(dt) {
    const v = VW.vent;
    if (!v) return;
    if (!v.cover || v.cover.open || player.dead || CBZ.crawling || ventD2(v) >= VENT_REACH2) { VW.vent = null; return; }
    const at = ventPoint(v);
    // caught with your hands on it: seen, or (prying) heard
    if (guardOnYou(VW.tool ? 0 : 7)) {
      VW.vent = null;
      if (CBZ.reportCrime) { try { CBZ.reportCrime(25, { type: "steal" }); } catch (e) {} }
      if (CBZ.addHeat) CBZ.addHeat(18);
      return;
    }
    VW.t += dt;
    if ((VW.tick -= dt) <= 0) {
      VW.tick = VW.tool ? 0.55 : 0.7;
      if (CBZ.worldSfx) {
        if (VW.tool) CBZ.worldSfx("switch", at.x, at.z, { y: at.y, ref: 2.5, volume: 0.16, gap: 0.2 });
        else CBZ.worldSfx("shell", at.x, at.z, { y: at.y, ref: 7, volume: 0.5, gap: 0.2 });
      }
      if (!VW.tool && CBZ.shake) { try { CBZ.shake(0.04); } catch (e) {} }
    }
    if (VW.t < VW.need) return;
    VW.vent = null;
    v.cover.set(true);
    if (CBZ.worldSfx) CBZ.worldSfx("shell", at.x, at.z, { y: 0.2, ref: 6, volume: 0.6, gap: 0.2 });
  }
  // a new run puts every grille back on (g.elapsed restarts at resetGame)
  let ventRunE = 0;
  function ventRunWatch() {
    const e = g.elapsed || 0;
    if (e + 1e-6 < ventRunE) {
      const vs = CBZ.vents || [];
      for (let i = 0; i < vs.length; i++) if (vs[i].cover && vs[i].cover.open) vs[i].cover.set(false);
      VW.vent = null;
    }
    ventRunE = e;
  }

  // ---- 2. a HIDDEN hatch (world/escape_routes.js opts.hidden) has no mouth
  //      to crawl through: the dark of the shaft is the cut
  function ventFade(vent) {
    if (!vent || !vent.dest || CBZ.crawling) return;
    CBZ.crawling = true;
    if (fadeEl) fadeEl.style.opacity = "1";
    setTimeout(() => {
      player.pos.set(vent.dest.x, vent.dest.y, vent.dest.z);
      if (CBZ.playerChar) CBZ.playerChar.group.position.copy(player.pos);
      setTimeout(() => { if (fadeEl) fadeEl.style.opacity = "0"; CBZ.crawling = false; }, 300);
    }, 200);
  }

  // ---- 3. the crawl ----------------------------------------------------------
  const CR = { on: false, ph: "", t: 0, from: null, to: null, e0: 0, fp: false,
    sx: 0, sz: 0, yaw: 0, s: 0, ductT: 0, speed: 0 };
  const CRAWL_V = 0.85;                 // m/s on elbows and knees
  const HEAD = 0.8, FEET = 0.9;         // prone plank: head ahead of the rig origin, feet behind
  const _dp = {};
  function lens(x, y, z, lx, ly, lz, snap) {
    let c = CBZ.cineCam;
    if (!c) c = CBZ.cineCam = { active: false, x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, snap: false };
    c.active = true;
    c.x = x; c.y = y; c.z = z; c.lx = lx; c.ly = ly; c.lz = lz;
    if (snap) c.snap = true;
  }
  function smooth(a, b, u) { const t = Math.max(0, Math.min(1, (u - a) / (b - a))); return t * t * (3 - 2 * t); }
  function yawTo(dx, dz) { return Math.atan2(dx, dz); }
  function turn(a, b, k) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; }
  // put the body where the crawl says, in the pose it says, and animate it
  function pose(x, y, z, yaw, speed, prone, dt) {
    player.pos.set(x, y, z);
    player.vy = 0; player.speed = speed;
    player.prone = !!prone; player.crouch = !prone;
    const pc = CBZ.playerChar;
    if (!pc) return;
    pc.slidePose = false; pc.pronePose = !!prone; pc.crouch = !prone;
    pc.group.rotation.y = yaw;
    if (pc.group.rotation.x) pc.group.rotation.x = 0;
    if (CBZ.animChar) CBZ.animChar(pc, speed, dt);
    const sink = ((CBZ.charProneSink && CBZ.charProneSink(pc)) || 0.62) * (pc._proneB || 0);
    pc.group.position.set(x, y - sink, z);
  }

  function crawlVent(vent) {
    if (!vent || !vent.dest || CBZ.crawling || CR.on) return;
    if (vent.cover && !vent.cover.open) return;          // screwed on: take it off first
    // the culvert only goes when nobody is watching the ditch
    if (CBZ.escapePlan && !CBZ.escapePlan.mayCrawl(vent)) return;
    const a = vent.mouth, b = vent.dest.mouth;
    if (!a || !b) { ventFade(vent); return; }            // a hidden hatch has no mouth to crawl out of
    CR.on = true; CR.from = vent; CR.to = vent.dest;
    CR.ph = "down"; CR.t = 0; CR.e0 = g.elapsed || 0;
    CR.sx = player.pos.x; CR.sz = player.pos.z;
    CR.yaw = CBZ.playerChar ? CBZ.playerChar.group.rotation.y : 0;
    // the duct is as long as the run is far, within reason
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    CR.ductT = Math.max(2.4, Math.min(4.2, dist / 4));
    CBZ.crawling = true;
    VW.vent = null;
    player._doorArc = true; player._doorArcOwner = "vent";
    CR.fp = !!(CBZ.fpsActive && CBZ.fpsActive());
    if (CR.fp && CBZ.setFPS) CBZ.setFPS(false);
    if (CBZ.sfx) CBZ.sfx("cloth", { volume: 0.5 });
  }
  function crawlRelease() {
    CR.on = false; CR.ph = "";
    if (CBZ.ventDuct) CBZ.ventDuct.show(false);
    if (CBZ.cineCam) { CBZ.cineCam.active = false; CBZ.cineCam.snap = false; }
    if (player._doorArcOwner === "vent") { player._doorArc = false; player._doorArcOwner = null; }
    player.prone = false; player.crouch = true;
    if (CBZ.playerChar) CBZ.playerChar.pronePose = false;
    CBZ.crawling = false;
    if (CR.fp && CBZ.setFPS) CBZ.setFPS(true);
    CR.fp = false;
  }
  // where the far end leaves you standing: the far vent's own crawl point
  function landAt(v) {
    const m = v.mouth;
    if (m && m.kind === "floor") { const o = m.off || { x: -1, z: 0 }, r = (m.size || 1.4) * 0.5 + 0.45; return { x: m.x + o.x * r, z: m.z + o.z * r }; }
    if (m) return { x: m.x + m.nx * 1.35, z: m.z + m.nz * 1.35 };
    return { x: v.x, z: v.z };
  }

  function crawlTick(dt) {
    if (!CR.on) return;
    // a new run, a death or a knockout mid-crawl: hand the body straight back
    if ((g.elapsed || 0) + 1e-6 < CR.e0 || player.dead || g.mode !== "escape") {
      if (player.pos.y < -20) { const L = landAt(CR.to); player.pos.set(L.x, (CR.to.mouth && CR.to.mouth.y > 0.5 ? 0 : (CR.to.mouth ? CR.to.mouth.y || 0 : 0)), L.z); }
      crawlRelease();
      return;
    }
    CR.t += dt;
    const a = CR.from.mouth, b = CR.to.mouth;
    const fy = a.kind === "floor" ? (a.y || 0) : 0;
    if (CR.ph === "down" || CR.ph === "in") {
      if (a.kind === "floor") return floorIn(a, dt);
      return wallIn(a, dt, fy);
    }
    if (CR.ph === "duct") return ductRun(dt);
    if (CR.ph === "out") {
      if (b.kind === "floor") return floorOut(b, dt);
      return wallOut(b, dt);
    }
    if (CR.ph === "up") {
      const L = landAt(CR.to);
      pose(L.x, b.kind === "floor" ? (b.y || 0) : 0, L.z, CR.yaw, 0, false, dt);
      if (CR.t >= 0.45) crawlRelease();
    }
  }

  // HORIZONTAL MOUTH (a wall grille, the culvert bore): get down facing it,
  // crawl to it and in, head first, lifting onto the sill as the chest
  // reaches it. The camera starts low behind him and ends a hand's breadth
  // off the duct mouth, looking into the dark.
  function wallIn(m, dt, fy) {
    const ix = -m.nx, iz = -m.nz;                         // into the wall
    const wantYaw = yawTo(ix, iz);
    const ex = m.x + ix * 0.4, ez = m.z + iz * 0.4;       // end: head and shoulders deep in, boots on the sill (the wall is only 0.5 m thick)
    // two legs: square up in front of the mouth, then straight in, so the
    // body never cuts into the wall beside the opening
    const ax = m.x + m.nx * (HEAD + 0.35), az = m.z + m.nz * (HEAD + 0.35);
    const l1 = Math.hypot(ax - CR.sx, az - CR.sz), l2 = Math.hypot(ex - ax, ez - az);
    const total = Math.max(0.3, l1 + l2);
    if (CR.ph === "down") {
      CR.yaw = turn(CR.yaw, wantYaw, 1 - Math.pow(0.001, dt));
      pose(CR.sx, fy, CR.sz, CR.yaw, 0, true, dt);
      lensBehind(CR.sx, fy, CR.sz, m, 0);
      if (CR.t >= 0.5) { CR.ph = "in"; CR.t = 0; }
      return;
    }
    const d = Math.min(total, CR.t * CRAWL_V), u = d / total;
    const k1 = l1 > 1e-3 ? Math.min(1, d / l1) : 1, k2 = l2 > 1e-3 ? Math.max(0, Math.min(1, (d - l1) / l2)) : 1;
    const x = d < l1 ? CR.sx + (ax - CR.sx) * k1 : ax + (ex - ax) * k2;
    const z = d < l1 ? CR.sz + (az - CR.sz) * k1 : az + (ez - az) * k2;
    // distance from the head to the wall plane decides the lift onto the sill
    const headOut = (x - m.x) * m.nx + (z - m.z) * m.nz - HEAD;
    const y = fy + (m.sill - fy) * (1 - smooth(0.05, 0.5, headOut));
    CR.yaw = turn(CR.yaw, wantYaw, 1 - Math.pow(0.001, dt));
    pose(x, y, z, CR.yaw, CRAWL_V, true, dt);
    lensBehind(x, y, z, m, smooth(0.45, 1, u));
    if (CR.t % 0.6 < dt && CBZ.sfx) CBZ.sfx("cloth", { volume: 0.25 });
    if (u >= 1) { CR.ph = "duct"; CR.t = 0; CR.s = 1.8; if (CBZ.ventDuct) CBZ.ventDuct.show(true); }
  }
  function lensBehind(x, y, z, m, k) {
    // behind and above the crawling body, blended toward the duct mouth
    const bx = x + m.nx * 1.9, by = y + 1.05, bz = z + m.nz * 1.9;
    const mx = m.x + m.nx * 0.32, my = m.y + 0.02, mz = m.z + m.nz * 0.32;
    const lx0 = x - m.nx * 0.6, ly0 = y + 0.25, lz0 = z - m.nz * 0.6;
    const lx1 = m.x - m.nx * 2, ly1 = m.y - 0.05, lz1 = m.z - m.nz * 2;
    lens(bx + (mx - bx) * k, by + (my - by) * k, bz + (mz - bz) * k,
      lx0 + (lx1 - lx0) * k, ly0 + (ly1 - ly0) * k, lz0 + (lz1 - lz0) * k, false);
  }

  // FLOOR MOUTH: step onto the open hatch, crouch, lower yourself in. The
  // camera looks down over your shoulder and follows you into the shaft.
  function floorIn(m, dt) {
    const f = m.y || 0;
    const bx = CR.sx - m.x, bz = CR.sz - m.z, bl = Math.hypot(bx, bz) || 1;
    const cx = m.x + (bx / bl) * 1.3, cz = m.z + (bz / bl) * 1.3;   // camera side: where he came from
    if (CR.ph === "down") {
      const u = smooth(0, 0.6, CR.t);
      pose(CR.sx + (m.x - CR.sx) * u, f, CR.sz + (m.z - CR.sz) * u, CR.yaw, 1.2 * (1 - u), false, dt);
      lens(cx, f + 1.9, cz, m.x, f, m.z, false);
      if (CR.t >= 0.6) { CR.ph = "in"; CR.t = 0; }
      return;
    }
    const u = Math.min(1, CR.t / 1.2);
    pose(m.x, f - 1.6 * smooth(0.1, 1, u), m.z, CR.yaw, 0, false, dt);
    lens(cx + (m.x - cx) * u * 0.8, f + 1.9 - 1.3 * u, cz + (m.z - cz) * u * 0.8, m.x, f - 1.2 * u, m.z, false);
    if (u >= 1) { CR.ph = "duct"; CR.t = 0; CR.s = 1.8; if (CBZ.ventDuct) CBZ.ventDuct.show(true); }
  }

  // THE DUCT: prone, down the galvanised run toward the far grille's light,
  // the lens low behind his boots. The body is 70 m under the compound here,
  // out of every guard's sight and every camera's.
  function ductRun(dt) {
    const D = CBZ.ventDuct;
    if (!D) { CR.ph = "out"; CR.t = 0; return; }
    CR.s += 1.0 * dt;
    const p = D.at(CR.s, _dp);
    pose(p.x, p.y, p.z, D.yaw, 1.0, true, dt);
    const c = D.at(CR.s - 1.3, {}), l = D.at(CR.s + 2.5, {});
    lens(c.x, c.y + 0.5, c.z, l.x, l.y + 0.3, l.z, CR.t < dt * 1.5);
    if (CR.t % 0.6 < dt && CBZ.sfx) CBZ.sfx("cloth", { volume: 0.3 });
    if (CR.t >= CR.ductT) {
      D.show(false);
      CR.ph = "out"; CR.t = 0;
      if (CR.to.cover && !CR.to.cover.open) {
        CR.to.cover.set(true);                            // shoved out from inside
        const b = CR.to.mouth;
        if (CBZ.worldSfx) CBZ.worldSfx("shell", b.x, b.z, { y: 0.3, ref: 6, volume: 0.55, gap: 0.2 });
      }
    }
  }

  // HORIZONTAL EXIT: head first out of the far grille. The first frame is
  // his eyes at the mouth looking out into the room; the lens then backs
  // out ahead of him and turns to watch him come out of the wall.
  function wallOut(m, dt) {
    const ox = m.nx, oz = m.nz;
    const yaw = yawTo(ox, oz);
    const sx = m.x - ox * 0.6, sz = m.z - oz * 0.6;       // start: boots inside the wall, head at the mouth
    const L = landAt(CR.to);
    const total = Math.max(0.3, Math.hypot(L.x - sx, L.z - sz));
    const d = Math.min(total, CR.t * CRAWL_V), u = d / total;
    const x = sx + (L.x - sx) * u, z = sz + (L.z - sz) * u;
    const feetOut = (x - m.x) * ox + (z - m.z) * oz - FEET;      // how far the boots are past the wall plane
    const y = m.sill * (1 - smooth(0.0, 0.6, feetOut));
    CR.yaw = yaw;
    pose(x, y, z, yaw, CRAWL_V, true, dt);
    // side of the room to stand the lens: across the grille's face
    const sd = { x: -oz, z: ox };
    const hx = x + ox * HEAD, hz = z + oz * HEAD;
    const k = smooth(0.12, 0.7, u);
    const px0 = m.x + ox * 0.3, py0 = m.y + 0.05, pz0 = m.z + oz * 0.3;
    const px1 = m.x + ox * 2.6 + sd.x * 0.9, py1 = 1.3, pz1 = m.z + oz * 2.6 + sd.z * 0.9;
    const lx0 = m.x + ox * 3, ly0 = m.y - 0.1, lz0 = m.z + oz * 3;
    lens(px0 + (px1 - px0) * k, py0 + (py1 - py0) * k, pz0 + (pz1 - pz0) * k,
      lx0 + (hx - lx0) * k, ly0 + (y + 0.25 - ly0) * k, lz0 + (hz - lz0) * k, CR.t < dt * 1.5);
    if (CR.t % 0.6 < dt && CBZ.sfx) CBZ.sfx("cloth", { volume: 0.25 });
    if (u >= 1) { CR.ph = "up"; CR.t = 0; }
  }

  // FLOOR EXIT: up out of the shaft, then a step off the hatch.
  function floorOut(m, dt) {
    const f = m.y || 0;
    const L = landAt(CR.to);
    const o = m.off || { x: -1, z: 0 };
    const cx = m.x + o.x * 1.4 + o.z * 0.8, cz = m.z + o.z * 1.4 - o.x * 0.8;   // over the side he steps off to
    const u = Math.min(1, CR.t / 1.6);
    const rise = smooth(0, 0.7, u), step = smooth(0.7, 1, u);
    CR.yaw = yawTo(L.x - m.x, L.z - m.z);
    pose(m.x + (L.x - m.x) * step, f - 1.6 * (1 - rise), m.z + (L.z - m.z) * step, CR.yaw, step > 0 && step < 1 ? 1.2 : 0, false, dt);
    lens(cx, f + 1.8, cz, m.x, f + 0.3 * rise, m.z, CR.t < dt * 1.5);
    if (u >= 1) { CR.ph = "up"; CR.t = 0; }
  }

  // updateInteractions stops running outside a live prison, so a quit to
  // the menu or a mode switch mid-crawl would strand the body it owns.
  CBZ.onAlways(40.5, function () {
    if (!CR.on) return;
    if (g.mode !== "escape" || g.state === "idle") crawlRelease();
  });

  // The @fn targets a pill fires. Named on CBZ because touch.js's pill
  // router resolves data-tfn straight off the namespace.
  CBZ.prisonSabotagePower = sabotagePower;
  CBZ.prisonVentCrawl = function () { crawlVent(armedVent); };
  CBZ.prisonVentWork = function () { ventWorkStart(armedVent); };
  CBZ.prisonVentState = function () {
    return { crawling: CR.on, phase: CR.ph, from: CR.from && CR.from.name, to: CR.to && CR.to.name,
      work: VW.vent ? { vent: VW.vent.name, t: +VW.t.toFixed(2), need: VW.need, tool: VW.tool } : null };
  };

  /* ---- THE READER ANSWERS FOR THE DOOR -------------------------------------
     world/door.js already bolts a card reader with a status light beside the
     yard checkpoint — red locked, green open — the same lamp world/adminwing.js
     puts on its locks and entities/security.js now puts on a camera. So
     "Locked checkpoint - find a keycard or crawl through maintenance." was
     narrating a machine that was already speaking, at head height, on the
     slab you are stood against.

     What the panel genuinely LACKED was a refusal. A reader that never reacts
     is scenery; a reader that beats amber the moment you step onto it and
     clicks its solenoid once is a door telling you it saw you and said no.
     Red returns when you walk away. Cached on a key so a Lambert material is
     not rewritten every frame. ---- */
  let readerK = "", readerRung = false;
  function readerLamp(key, rate) {
    const d = CBZ.door, lamp = d && d.readerLight;
    if (!lamp) return;
    const lit = !rate || Math.sin((CBZ.now || 0) * rate) > 0;
    const k = key + (lit ? "1" : "0");
    if (readerK === k) return;
    readerK = k;
    if (key === "deny") {
      lamp.material.color.setHex(lit ? 0xffb347 : 0x7a4f18);
      lamp.material.emissive.setHex(lit ? 0xff7a1a : 0x2a1a06);
    } else {
      lamp.material.color.setHex(0xff3b3b);
      lamp.material.emissive.setHex(0xff0000);
    }
  }

  // Where a prompt HANGS: the face of the breaker cabinet (CBZ.breaker.x/z
  // is the stand spot in front of it, world/props.js), and on the grille or
  // the hatch itself. Cheap objects, built per frame only while a prompt is live.
  function breakerPoint() {
    const b = CBZ.breaker;
    if (b.face) return { x: b.face.x, y: b.face.y + 0.1, z: b.face.z };
    const box = b && b.box;
    if (box && box.position) return { x: box.position.x, y: box.position.y + 0.35, z: box.position.z };
    return { x: b.x, y: 2.0, z: b.z - 0.7 };
  }
  function ventPoint(v) {
    const m = v.mouth;
    if (m && m.kind === "wall") return { x: m.x + m.nx * 0.05, y: m.y, z: m.z + m.nz * 0.05 };
    if (m && m.kind === "floor") return { x: m.x, y: (m.y || 0) + 0.35, z: m.z };
    if (m) return { x: m.x, y: (m.y || 0) + 0.4, z: m.z };
    const g = v.grate;
    return { x: g ? g.x : v.x, y: (v.y || 0.1) + 0.55, z: g ? g.z : v.z };
  }

  function updateInteractions(dt) {
    /* THE ESCAPE IS A SCENARIO, NOT A MAP (2026-08-19).
       Everything below this line is the prison BREAKOUT: the keycard on the
       floor, the yard door's card reader, the breaker box you sabotage, the
       camera cones, the vents you crawl through. It had no mode gate at all —
       the gate was the WIN check at the bottom — so it ran in every mode, and
       modes/gungame.js plays a deathmatch on this exact geometry. Walk over a
       grate mid-match and the arena printed "Crouch [C] to enter vent / hatch"
       at you; stand on the breaker and it offered "Press [E] to Sabotage
       Power"; touch the keycard and setObjective rewrote your objective to
       "Cross the yard or scout tunnels for another way out." A vent that
       teleports you off the map is not a feature of a gun game.
       (The city was already living with the near-miss version of this — see
       doorVerbPrompt's guard, which exists because the compound shares the
       city's coordinate space near the origin. One gate at the top is what
       that comment wanted and could not have on its own.) */
    if (!CBZ.game || CBZ.game.mode !== "escape") return;

    // ---- keycard ----
    // THE FREE PICKUP IS GONE. Walking within 1.6 m of the desk used to hand
    // you the card, and the card was the whole main-gate route. The desk card
    // is now TAKEN, with your hands, while its officer is away and nobody is
    // looking (systems/escapeplan.js owns that beat, the bag->hasKey sync and
    // the other two ways to get a card). entities/keycard.js owns its idle.

    // ---- cigarette packs ---- migrated to systems/proptypes.js's "coin"
    // prop type (see entities/coins.js) — bob/spin + proximity pickup now
    // live in that def's onUpdate/onInteract, ticked by the registry's own
    // updater instead of here.

    // ---- door ----
    // the unit's sally port: 4 m of its inner door, or at its out door's
    // reader on the yard face (world/door.js publishes both faces)
    const door = CBZ.door;
    const ddx = player.pos.x, ddz = player.pos.z + 8;
    const oz = door.outer ? player.pos.z - door.outer.z : 99;
    const nearDoor = ddx * ddx + ddz * ddz < 16 || (door.outer && ddx * ddx + oz * oz < 2.6 * 2.6);
    if (!door.open) {
      // LAW 3: a door you shut yourself stays shut while you stand in the
      // radius that would otherwise re-open it. CBZ.prisonDoorLatched is the
      // shared registry above; the credential test below is untouched.
      if (nearDoor && g.hasKey && !cuffedNow() && !CBZ.prisonDoorLatched("prison-yard-door")) {
        CBZ.openDoor();
        // the card goes onto the reader's pad in a hand (the reader is what opens it)
        if (CBZ.verbs && CBZ.verbs.touch && door.padPos) {
          try { CBZ.verbs.touch(player, { point: door.padPos, normal: door.padN, kind: "card", key: "yard-reader" }); } catch (e) {}
        }
        readerK = ""; readerRung = false;
        CBZ.setObjective("");
      } else if (nearDoor && !cuffedNow()) {
        readerLamp("deny", 0.013);
        if (!readerRung) {
          readerRung = true;
          // The solenoid speaks from the reader's published hardware point: a
          // 50 dB click that is not even requested from across the yard.
          if (CBZ.worldSfx) {
            const rp = door.readerPos || { x: 2.6, y: 3.8, z: -7.5 };
            CBZ.worldSfx("switch", rp.x, rp.z, { y: rp.y, ref: 6, volume: 0.45, gap: 0.5 });
          }
        }
      } else {
        readerRung = false;
        readerLamp("lock", 0);
      }
    }
    // THE LEAF TRAVELS BOTH WAYS NOW. It used to only ever rise (the `t < 1`
    // ramp), because CBZ.closeDoor teleported it back to closedY — which is
    // right for a lockdown SLAM and for the run reset, and wrong for a hand
    // on the door. closeDoor(true) leaves t alone and this ramp lowers it at
    // the same 1.6 rate it raises. Same authored pocket, one direction added.
    {
      const want = door.open ? 1 : 0;
      if (door.t !== want) {
        const step = dt * 1.6;
        door.t = want > door.t ? Math.min(want, door.t + step) : Math.max(want, door.t - step);
        if (door.drive) door.drive(door.t);
        else door.mesh.position.y = door.closedY + door.t * (door.travel || 8);
      }
    }

    // ---- breaker box power sabotage ----
    const breaker = CBZ.breaker;
    if (breaker) {
      if (breaker.sabotaged) {
        breaker.timer -= dt;
        if (breaker.timer <= 0) {
          breaker.sabotaged = false;
          breaker.light.material.color.setHex(0x39ff88);
          breaker.light.material.emissive.setHex(0x14c258);
          if (breaker.setOpen) breaker.setOpen(false);     // the screw on rounds shuts it
          if (CBZ.ceilingLamp) {
            CBZ.ceilingLamp.material.color.setHex(0xffe9a8);
            CBZ.ceilingLamp.material.emissive.setHex(0xffcf66);
          }
          // The lights coming back on IS "POWER RESTORED". The old `key` cue
          // was a lock opening, played for a breaker closing, from nowhere in
          // particular; the breaker is a fixed object across the yard, so the
          // contactor slams from ITS position and fades with distance.
          if (CBZ.worldSfx) CBZ.worldSfx("switch", breaker.x, breaker.z, { y: 1.6, ref: 7, volume: 0.6, gap: 0.5 });
        }
      } else {
        if (breaker.isOpen && breaker.isOpen()) breaker.setOpen(false);   // a run reset restores power, not the door
        const bdx = player.pos.x - breaker.x, bdz = player.pos.z - breaker.z;
        if (bdx * bdx + bdz * bdz < 1.8) {
          // "Sabotage", over the box. The box is the noun.
          const reach = CBZ.prisonPrompt("breaker", "@prisonSabotagePower", "Sabotage",
            { at: breakerPoint(), d2: bdx * bdx + bdz * bdz });
          if (reach && CBZ.keys && CBZ.keys["e"]) sabotagePower();
        }
      }
    }

    // ---- security cameras (detection & destruction) ----
    if (CBZ.cameras && !g.invuln) {
      for (const cam of CBZ.cameras) {
        const cdx = player.pos.x - cam.pos.x, cdz = player.pos.z - cam.pos.z;
        const dist = Math.hypot(cdx, cdz);

        if (cam.destroyed) continue;

        // Player punching/attacking near the camera to smash it. YOUR fist,
        // so the impact is CBZ.sfx (global — you are where the listener is);
        // the lens cracking is the same player-direct exception the pane in
        // city/buildings.js takes, at a third of the level because a 4 cm
        // lens is not a shop window. The camera then HANGS off its mount
        // (entities/security.js) — that is the receipt, not a popup.
        if (dist < 2.0 && CBZ.playerChar && CBZ.playerChar.punchT > 0) {
          cam.destroyed = true;
          CBZ.sfx("punch");
          CBZ.sfx("glass", { volume: 0.3 });
          continue;
        }

        if (!cam.active || cam.offline) continue;

        // A LENS IS AN EYE. The 9 m reach is a lit-room figure; after
        // lights-out the cell-wing camera is staring into the same black the
        // guards are. Same hook the vision cone uses (systems/prisonnight.js),
        // so darkness is priced once for every sensor in the prison.
        // ...and the SECURITY LEVEL is the third term (systems/prisontiers.js):
        // a county farm runs tired analogue kit that has to be walked up to,
        // a segregation unit runs cameras that pick you up across the hall.
        const camTier = CBZ.prisonTier ? CBZ.prisonTier.knob("camReach") : 1;
        const camReach = 9.0 * camTier * (CBZ.sightScale ? CBZ.sightScale(cam, player.pos.x, player.pos.z) : 1);
        if (dist < camReach) {
          const yaw = cam.body.rotation.y;
          const targetAngle = Math.atan2(cdx, cdz);
          let diff = Math.abs(targetAngle - yaw);
          diff = (diff + Math.PI) % (Math.PI * 2) - Math.PI;
          diff = Math.abs(diff);

          /* THIS BLOCK OWNS THE GEOMETRY AND NOTHING ELSE. It used to also
             paint the lens — two files writing one material, which is how the
             dot ended up meaning "camera" instead of meaning "you". It now
             writes the two FACTS and entities/security.js paints them:

               diff < 0.32   dead centre of frame — it has you (red, heat)
               diff < 0.62   in frame, off centre — the sweep is closing (amber)

             The amber band is not a new sensor: it is the same cone, doubled,
             and it exists so the escalation has a rung you can act on. The
             deleted popup said "CAMERA DETECTING YOU!" at the instant heat
             started — by then the only useful information was already spent. */
          if (diff < 0.32) {
            // how fast a locked lens builds the case against you is also the
            // classification's business — same tier knob table, one lookup.
            CBZ.addHeat(dt * 38 * (CBZ.prisonTier ? CBZ.prisonTier.knob("camHeat") : 1));
            cam.seenT = 0.3;          // re-armed every frame; security.js decays it
          } else if (diff < 0.62) {
            cam.watchT = 0.3;
          }
        }
      }
    }

    // ---- vents: take the grille off, then crawl (see THE VENTS above) ----
    ventRunWatch();
    ventWorkTick(dt);
    crawlTick(dt);
    if (CBZ.vents && !CBZ.crawling) {
      for (const vent of CBZ.vents) {
        const vd2 = ventD2(vent);
        if (vd2 >= VENT_REACH2 || !vent.dest) continue;
        // a welded culvert grate is the plan's prompt ("Cut"), not a crawl
        if (CBZ.escapePlan && !CBZ.escapePlan.ventOpen(vent)) continue;
        armedVent = vent;                       // what a pill tap acts on
        armedVentT = 0.25;
        if (vent.cover && !vent.cover.open) {
          // screwed on. The verb is what your hands can do to it.
          const working = VW.vent === vent;
          const tool = working ? VW.tool : ventTool();
          const reach = CBZ.prisonPrompt("vent", "@prisonVentWork", tool ? "Unscrew" : "Pry",
            { at: ventPoint(vent), d2: vd2, prog: working ? VW.t / VW.need : 0 });
          if (reach && CBZ.keys && CBZ.keys["e"]) ventWorkStart(vent);
        } else {
          const floor = vent.mouth && vent.mouth.kind === "floor";
          const reach = CBZ.prisonPrompt("vent", "@prisonVentCrawl", floor ? "Climb in" : "Crawl",
            { at: ventPoint(vent), sub: "to " + vent.dest.name, d2: vd2 });
          if (reach && CBZ.keys && CBZ.keys["e"]) crawlVent(vent);
        }
      }
    }
    if (armedVentT > 0 && (armedVentT -= dt) <= 0) armedVent = null;

    // ---- open / shut the door in front of you (every registered door, one implementation) ----
    doorVerbPrompt();

    // ---- win ---- (escape-mode only, and role-gated: only the ESCAPING role
    // wins by crossing the wire. A cop reaching the gate is just on shift —
    // capture.js:tryCapture uses the same g.role === "cop" predicate for the
    // other direction. Previously a cop, or even a city/survival run whose
    // coordinates drifted over the jail EXIT, triggered the inmate escape.)
    if (g.mode !== "escape") return;
    // A COP DOES NOT WIN BY WALKING OUT, and this used to say so in words on a
    // 10-second throttle. world/exit.js now refuses him with the gate itself:
    // the pad and the light shaft go RED under a cop inside 6 m and clear when
    // he steps off, which is the same red/amber/green the checkpoint reader,
    // the admin door plates and every camera lens already speak. Nothing to
    // print here any more — just no win.
    if (g.role === "cop") return;
    if (CBZ.crawling) return;            // a crawl finishes before the bore mouth counts
    // THE PLAN SIGNS OFF ON EVERY WIN (systems/escapeplan.js): a gate is won
    // only if nobody has you in sight in the port, the culvert mouth only if
    // the grate was actually cut. Reaching the point is no longer the route.
    const ex = player.pos.x - CBZ.EXIT.x, ez = player.pos.z - CBZ.EXIT.z;
    let routeWin = null;
    if (CBZ.altExitZones) {
      for (const zone of CBZ.altExitZones) {
        // a zone is a circle, or (over the wall) a test of where you stand
        if (zone.test) { if (zone.test(player.pos.x, player.pos.z)) { routeWin = zone; break; } continue; }
        const ax = player.pos.x - zone.x, az = player.pos.z - zone.z;
        if (ax * ax + az * az < zone.r * zone.r) { routeWin = zone; break; }
      }
    }
    const plan = CBZ.escapePlan;
    if (ex * ex + ez * ez < 9) {
      if (!plan || plan.mayWin("gate", "prison-exit")) getOut("gate");
    } else if (routeWin) {
      const kind = routeWin.kind || (routeWin.name === "culvert" ? "culvert" : "gate");
      if (!plan || plan.mayWin(kind, routeWin.name)) getOut("route");
    }
  }
  // YOU ARE OUT, AND THE WORLD KEEPS GOING: the run out (systems/escapeend.js)
  // owns the ending and calls winGame itself after the fade.
  function getOut(reason) {
    if (CBZ.escapeEnd && CBZ.escapeEnd.outro(reason)) return;
    CBZ.winGame(reason === "gate" ? undefined : reason);
  }

  // ---- ratchet declarations (see CBZ.prisonPromptAudit) ----
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "breaker", act: "@prisonSabotagePower", was: "Press [E] to Sabotage Power", now: "Sabotage, over the box" },
    { id: "vent", act: "@prisonVentCrawl", was: "Press [E] to Crawl to … / Crouch [Shift] to enter vent", now: "Crawl / Climb in, over the open grille or hatch" },
    { id: "vent-work", act: "@prisonVentWork", was: "(none: the grille was a picture)", now: "Unscrew / Pry, over the screwed grille" },
    { id: "door", act: "@prisonDoorCloseNearest", was: "Press [E] to close your cell door", now: "Close, over the leaf" }
  );

  CBZ.updateInteractions = updateInteractions;
  CBZ.onUpdate(40, updateInteractions);
})();
