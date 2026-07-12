/* ============================================================
   systems/hud.js — DOM HUD references + small display helpers
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  const el = {
    objText: document.getElementById("objText"),
    cigText: document.getElementById("cigText"),
    timer: document.getElementById("timer"),
    keycard: document.getElementById("keycard"),
    detectLabel: document.querySelector("#detectWrap .lab span:first-child"),
    bar: document.getElementById("detectBar"),
    dstate: document.getElementById("detectState"),
    gangHud: document.getElementById("gangHud"),
    hint: document.getElementById("hint"),
    toast: document.getElementById("toast"),
    vignette: document.getElementById("vignette"),
    flash: document.getElementById("flash"),
    invList: document.getElementById("invList"),
    interact: document.getElementById("interact"),
    interactName: document.getElementById("interactName"),
    interactNote: document.getElementById("interactNote"),
    interactOpts: document.getElementById("interactOpts"),
  };

  function setObjective(t) {
    // a normal objective string also exits kill-feed mode (e.g. starting an
    // escape match after a survival one) so the panel reads correctly again
    if (objEl && objEl.classList.contains("killfeed")) { objEl.classList.remove("killfeed"); if (objTag) objTag.textContent = "Objective"; }
    el.objText.textContent = t;
  }
  function showHint(t) { el.hint.textContent = t; el.hint.classList.add("show"); }
  function hideHint() { el.hint.classList.remove("show"); }

  // ---- survival KILL FEED: the objective panel becomes a running list of
  //      who just died and how ("Nova47 — struck by lightning"). Lines age
  //      out; the panel is relabelled. Escape mode never calls these. ----
  const objEl = document.getElementById("objective");
  const objTag = objEl ? objEl.querySelector(".tag") : null;
  let feed = [];
  function killFeedReset() {
    feed = [];
    if (el.objText) el.objText.innerHTML = "";
    if (objTag) objTag.textContent = "Casualties";
    if (objEl) objEl.classList.add("killfeed");
  }
  function pushKill(text, color, big) {
    if (!el.objText) return;
    const line = document.createElement("div");
    line.className = "kfeed" + (big ? " kfeed-you" : "");
    line.textContent = text;
    if (color) line.style.color = color;
    el.objText.appendChild(line);
    void line.offsetWidth;            // reflow so the slide-in plays
    line.classList.add("in");
    feed.push({ el: line, t: 0 });
    while (feed.length > 6) { const old = feed.shift(); if (old.el.parentNode) old.el.parentNode.removeChild(old.el); }
  }
  CBZ.killFeedReset = killFeedReset;
  CBZ.pushKill = pushKill;
  // age the feed: fade each line after ~7s, drop it after ~9s
  CBZ.onAlways(94, function (dt) {
    if (!feed.length) return;
    for (let i = feed.length - 1; i >= 0; i--) {
      const f = feed[i]; f.t += dt;
      if (f.t > 7 && !f.fading) { f.fading = true; f.el.classList.add("out"); }
      if (f.t > 9) { if (f.el.parentNode) f.el.parentNode.removeChild(f.el); feed.splice(i, 1); }
    }
  });

  // auto-hiding hint: shows for `secs` seconds, ticked in the always loop
  let _hintT = 0;
  function flashHint(t, secs) { showHint(t); _hintT = secs || 1.6; }
  CBZ.onAlways(95, function (dt) {
    if (_hintT > 0) { _hintT -= dt; if (_hintT <= 0) hideHint(); }
  });

  function flashToast(t) {
    el.toast.textContent = t;
    el.toast.classList.remove("pop");
    void el.toast.offsetWidth; // reflow to restart the animation
    el.toast.classList.add("pop");
  }
  function fmtTime(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  // redraw the small inventory strip from game.inventory
  function refreshInventory() {
    const inv = CBZ.game.inventory;
    const parts = Object.keys(inv).filter((k) => inv[k] > 0)
      .map((k) => `${k}${inv[k] > 1 ? " ×" + inv[k] : ""}`);
    el.invList.textContent = parts.length ? parts.join("  ·  ") : "—";
  }

  function refreshGangHud() {
    if (!el.gangHud) return;
    const g = CBZ.game || {};
    // CITY: #gangHud is display:none!important (css/city.css) — this is the
    // prison-gang panel. Skip the whole innerHTML rebuild + npc scans there
    // (measured: a full string build + 3 .find()/.filter() passes EVERY frame
    // for an invisible element).
    if (g.mode === "city") return;
    if (g.role === "cop" || g.state !== "playing") {
      el.gangHud.style.display = "none";
      return;
    }
    const standing = g.gangStanding || [0, 0];
    const cover = g.gangProtection || [0, 0];
    const debt = g.gangDebt || [0, 0];
    const job = g.gangJob;
    const crew = CBZ.player && CBZ.player.gang != null && CBZ.GANG_NAMES ? CBZ.GANG_NAMES[CBZ.player.gang].replace(/^the /, "") : "None";
    const coverBits = [];
    const debtBits = [];
    const pressureBits = [];
    const buzz = CBZ.topBlockBuzz ? CBZ.topBlockBuzz() : null;
    const csum = CBZ.caseSummary && CBZ.caseSummary();
    const trace = CBZ.wantedBreakdown && CBZ.wantedBreakdown();
    const knownReporter = (CBZ.npcs || []).find((n) => n && n.data && (n.reportedPlayerT || 0) > 0 && !n.dead && !(n.ko > 0));
    const crewHunter = (CBZ.npcs || []).find((n) => n && n.gang >= 0 && (n.huntPlayer || 0) > 0 && !n.dead && !(n.ko > 0));
    const watcher = (CBZ.npcs || []).find((n) => n && n.data && n.aiState === "tailPlayer" && !n.dead && !(n.ko > 0));
    const crewPress = (CBZ.npcs || []).filter((n) => n && n.aiState === "pressurePlayer" && !n.dead && !(n.ko > 0));
    const jobText = job && job.t > 0
      ? `${job.label || "Job"} ${job.need ? Math.floor(job.progress || 0) + "/" + Math.ceil(job.need) : Math.ceil(job.t) + "s"}`
      : "";
    const nameOf = (a) => a && a.data ? a.data.name.replace(/^the |^a |^an /, "") : "";
    const shortSource = (s) => String(s || "lead").replace(/^the |^a |^an /, "").slice(0, 12);
    const credWord = (r) => r.weak ? "weak" : ((r.credibility || 0) > 0.76 ? "solid" : "lead");
    const chip = (cls, text) => `<span class="${cls}">${text}</span>`;
    if ((cover[0] || 0) > 0) coverBits.push(`R ${Math.ceil(cover[0])}s`);
    if ((cover[1] || 0) > 0) coverBits.push(`B ${Math.ceil(cover[1])}s`);
    if ((debt[0] || 0) > 0) debtBits.push(`R ${Math.ceil(debt[0])}`);
    if ((debt[1] || 0) > 0) debtBits.push(`B ${Math.ceil(debt[1])}`);
    for (let i = 0; i < 2; i++) {
      const tag = i === 0 ? "R" : "B";
      if ((debt[i] || 0) >= 18) pressureBits.push(chip("hot", `${tag} collecting`));
      else if ((standing[i] || 0) <= -42) pressureBits.push(chip("hot", `${tag} hostile`));
      else if ((standing[i] || 0) >= 48) pressureBits.push(chip("good", `${tag} loyal`));
    }
    if ((g.racketProtectionT || 0) > 0) pressureBits.push(chip("good", `Bent cover ${Math.ceil(g.racketProtectionT)}s`));
    else if ((g.racketDebt || 0) >= 26 || (g.racketStanding || 0) <= -34) pressureBits.push(chip("hot", `Bent leak ${Math.ceil(g.racketDebt || 0)}`));
    else if ((g.racketDebt || 0) >= 18 || (g.racketStanding || 0) <= -24) pressureBits.push(chip("hot", `Bent squeeze ${Math.ceil(g.racketDebt || 0)}`));
    else if ((g.racketDebt || 0) > 0) pressureBits.push(chip("hot", `Bent debt ${Math.ceil(g.racketDebt)}`));
    if (Math.abs(g.racketStanding || 0) >= 8) {
      pressureBits.push(chip((g.racketStanding || 0) > 0 ? "good" : "warn", `${(g.racketStanding || 0) > 0 ? "Bent trust" : "Bent heat"} ${Math.round(Math.abs(g.racketStanding || 0))}`));
    }
    if ((g.lowProfileT || 0) > 0) pressureBits.push(chip("good", `Cash quiet ${Math.ceil(g.lowProfileT)}s`));
    else if ((g.cigs || 0) >= 18) pressureBits.push(chip("hot", "Cash loud"));
    else if ((g.cigs || 0) >= 10) pressureBits.push(chip("warn", "Cash noticed"));
    let traceShown = false;
    if (trace && trace.mode && trace.mode !== "clear" && trace.mode !== "badge") {
      const cls = trace.mode === "corrupt" ? "hot" : ((trace.strength || 0) > 35 ? "hot" : "warn");
      pressureBits.push(chip(cls, trace.chip || trace.label));
      traceShown = true;
    }
    if (!traceShown && knownReporter) pressureBits.push(chip("hot", `Snitch ${nameOf(knownReporter)}`));
    else if (!traceShown && g.lastKnown && g.lastKnown.t > 0) pressureBits.push(chip("warn", `Search ${g.lastKnown.source || "lead"}`));
    if (crewHunter) {
      const crewName = CBZ.GANG_NAMES && CBZ.GANG_NAMES[crewHunter.gang] ? CBZ.GANG_NAMES[crewHunter.gang].replace(/^the /, "") : "Crew";
      pressureBits.push(chip("hot", `${crewName} angry`));
    }
    if (crewPress.length) {
      const tactics = Array.from(new Set(crewPress.map((n) => n.pressureTactic).filter(Boolean))).slice(0, 2).join("/");
      pressureBits.push(chip("warn", `Crew press ${crewPress.length}${tactics ? " " + tactics : ""}`));
    }
    if (watcher) pressureBits.push(chip(watcher.tailKind === "cover" ? "good" : "warn", `Watched ${nameOf(watcher)}`));
    if (csum && csum.heat > 10) {
      const sources = (csum.reports && csum.reports.length ? csum.reports : (CBZ.caseSources ? CBZ.caseSources(3) : [])).slice(0, 3);
      if (sources.length > 1) pressureBits.push(chip("warn", `Case ${sources.length} src`));
      if (sources[0] && !traceShown) {
        const r = sources[0];
        const age = r.ttl ? ` ${Math.ceil(r.ttl)}s` : "";
        pressureBits.push(chip((r.weak || csum.heat < 28) ? "warn" : "hot", `Lead ${shortSource(r.source)} ${credWord(r)}${age}`));
      } else if (!traceShown) {
        const strength = csum.weak ? "Weak tip" : "Case";
        const age = csum.ttl ? ` ${Math.ceil(csum.ttl)}s` : "";
        pressureBits.push(chip(csum.heat > 28 && !csum.weak ? "hot" : "warn", `${strength} ${csum.source || csum.type || "open"}${age}`));
      }
      if (sources[1]) pressureBits.push(chip(sources[1].weak ? "warn" : "hot", `Src ${shortSource(sources[1].source)} ${credWord(sources[1])}`));
    }
    if ((g.snitchIntelT || 0) > 0) pressureBits.push(chip("good", `Snitch named ${Math.ceil(g.snitchIntelT)}s`));
    if (buzz && buzz.score > 24) pressureBits.push(chip(buzz.score > 45 ? "hot" : "warn", `Buzz ${buzz.kind}`));
    pressureBits.length = Math.min(pressureBits.length, 6);
    el.gangHud.style.display = "flex";
    el.gangHud.innerHTML =
      '<span class="tag">Respect</span>' +
      `<span class="red">Reds ${Math.round(standing[0] || 0)}</span>` +
      `<span class="blue">Blues ${Math.round(standing[1] || 0)}</span>` +
      `<span class="crew">Crew ${crew}</span>` +
      (coverBits.length ? chip("good", `Cover ${coverBits.join(" ")}`) : "") +
      (debtBits.length ? chip("hot", `Debt ${debtBits.join(" ")}`) : "") +
      (pressureBits.length ? pressureBits.join("") : "") +
      (jobText ? chip("good", `Job ${jobText}`) : "");
  }

  CBZ.onAlways(91, refreshGangHud);

  CBZ.el = el;
  CBZ.setObjective = setObjective;
  CBZ.showHint = showHint;
  CBZ.hideHint = hideHint;
  CBZ.flashHint = flashHint;
  CBZ.flashToast = flashToast;
  CBZ.fmtTime = fmtTime;
  CBZ.refreshInventory = refreshInventory;
  CBZ.refreshGangHud = refreshGangHud;
})();
