/* ============================================================
   systems/bootprogress.js — THE LOADING METER THAT KEEPS MOVING
   WHILE THE MAIN THREAD IS DEAD.

   The problem this solves (LOAD-NOTES.md #1): a CITY start is one
   synchronous 20-30 s main-thread task (buildCity + 39 landmass
   builders), followed by ~13 s of shader compile across the first
   frames. Nothing on the page can repaint during that. The old
   boot card was therefore a spinner and a paragraph of apology —
   it could not show a number, because a number would have been
   frozen at "0%" for half a minute.

   Two ideas make a REAL percentage possible without slicing the
   build (which is a boot-path refactor, still owed):

   1. WHO DRAWS IT. The meter is an OffscreenCanvas transferred to
      a Worker. The worker is its own thread: it keeps drawing at
      30fps while the main thread is inside biome_snow.js, and its
      canvas frames still reach the compositor. postMessage() from
      a blocked main thread is delivered to the worker immediately
      (the worker's event loop is not the one that is stuck), so
      the build can report checkpoints mid-freeze and the number on
      screen moves in real time. No SharedArrayBuffer, so no COOP/
      COEP headers — this works on GitHub Pages as-is.
      Fallback (no OffscreenCanvas/Worker): the same meter drawn in
      DOM, updated whenever the thread does yield.

   2. WHERE THE NUMBERS COME FROM. Progress is NOT "steps done /
      steps total" — the steps differ by 20x (biome_snow is 4.5 s,
      most builders are ~0.2 s) and that bar would be a liar. Every
      step is weighted by HOW LONG IT ACTUALLY TOOK LAST TIME on
      THIS machine (localStorage, EMA-blended), seeded on the very
      first run by the measured table in LOAD-NOTES.md. Checkpoints
      snap the bar to the truth; between them the worker eases
      across the segment on that step's expected duration, reaching
      85% of it exactly when the step was predicted to end and then
      crawling asymptotically — so it never overshoots, never goes
      backwards, and after one run it is accurate to a step.

   What it looks like: a LINE. One big percentage and one rule
   that fills left to right, on the flat boot background, under
   "BUILDING THE WORLD". No spinner and no gray paragraph.

   Public API (all no-ops when the meter is off or not running):
     CBZ.bootMeter.show(mode, worldOnly)  card up, plan armed
     CBZ.bootStep(key)          a checkpoint reached (hot path)
     CBZ.bootMeter.finish(cb)   ease to 100%, hide, then cb()
   `?cfg_BOOT_METER=0` → no card at all, buttons build like a tool.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CFG.BOOT_METER == null) CFG.BOOT_METER = true;

  const LS_KEY = "cbz.bootmeter.v1";
  const BG = "#0f1622", INK = "#fff7ec", HOT = "#ff7a1a";

  // ---- seed weights (ms) ------------------------------------------------
  // First run on a machine only. Numbers are the measured build from
  // LOAD-NOTES.md (2026-08-09 re-measure); everything unlisted gets the
  // generic builder cost. After one run these are replaced by what this
  // machine actually did, so a phone converges on phone timings.
  const SEED = {
    "boot:reset": 260,
    "city:core": 3200,
    "city:buildings": 2600,
    "city:expansion": 1200,
    "lm:biome_snow.js": 4560,
    "lm:continent.js": 4100,
    "lm:minicities.js": 2760,
    "lm:packages.js": 1450,
    "lm:biome_desert.js": 1230,
    "lm:biome_farmland.js": 1230,
    "lm:countries.js": 1050,
    "lm:wildlife.js": 665,
    "lm:roadrules.js": 435,
    "lm:govcomplex.js": 410,
    "lm:island_speedway.js": 380,
    "lm:island_airport.js": 380,
    "lm:biome_forest.js": 350,
    "city:props": 1500,
    "city:beach": 420,
    "city:finish": 1600,
    "city:batch": 1800,
    "city:pop": 1400,
    "city:traffic": 700,
    "city:run": 900,
    "boot:frames": 12000,
  };
  const GENERIC_BUILDER = 260, GENERIC_STEP = 400;

  let learned = {};
  try { learned = JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch (e) { learned = {}; }

  function weightOf(key) {
    const l = +learned[key];
    if (l > 0) return l;
    if (SEED[key] != null) return SEED[key];
    return key.indexOf("lm:") === 0 ? GENERIC_BUILDER : GENERIC_STEP;
  }
  function remember(key, ms) {
    if (!(ms >= 0) || !key) return;
    const prev = +learned[key];
    // EMA toward the fresh measurement — one slow run (a background tab, a
    // thermally throttled phone) shifts the model but does not define it.
    learned[key] = prev > 0 ? prev * 0.4 + ms * 0.6 : ms;
  }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(learned)); } catch (e) {}
  }

  // ---- the worker: 30fps on its own thread ------------------------------
  const WORKER_SRC = [
    '"use strict";',
    "var ctx=null,canv=null,W=0,H=0,DPR=1,f0=0,f1=0,t0=0,dur=0,shown=0,timer=null,tape=[];",
    "function seg(){var t=performance.now()-t0,span=f1-f0;",
    "  if(!(dur>0))return f1;",
    "  if(t<=dur)return f0+span*0.85*(t/dur);",
    "  return f1-span*0.15*Math.exp(-(t-dur)/(dur*0.8));}",
    "function bar(x,y,w,h,c){ctx.fillStyle=c;ctx.beginPath();",
    "  if(ctx.roundRect)ctx.roundRect(x,y,w,h,h/2);else ctx.rect(x,y,w,h);ctx.fill();}",
    "function draw(){if(!ctx)return;",
    "  var p=seg();if(p<shown)p=shown;if(p>1)p=1;shown=p;",
    "  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W*DPR,H*DPR);",
    "  ctx.setTransform(DPR,0,0,DPR,0,0);",
    "  var BH=10,by=H-BH;",
    "  ctx.fillStyle='#fff7ec';ctx.textBaseline='alphabetic';",
    // Fredoka is a document webfont and a worker cannot see it, so this
    // resolves to the system face unless the machine has it installed —
    // named first anyway, because when it does resolve the number matches
    // the heading under it.
    "  ctx.font='700 '+Math.round(H*0.62)+'px Fredoka,system-ui,-apple-system,Segoe UI,sans-serif';",
    "  ctx.textAlign='left';ctx.fillText(Math.floor(p*100)+'%',0,H-BH-16);",
    "  bar(0,by,W,BH,'rgba(255,122,26,0.16)');",
    "  if(p>0.0005)bar(0,by,Math.max(BH,W*p),BH,'#ff7a1a');",
    // the worker's own tape: proof (tools/boot-meter-check.mjs) that the
    // number kept moving while the page's main thread was gone
    "  if(tape.length<900&&(!tape.length||performance.now()-tape[tape.length-1][0]>200))",
    "    tape.push([Math.round(performance.now()),Math.round(p*1000)/10]);}",
    // The 30fps timer only runs while the card is up: a hidden meter must not
    // burn a thread for the rest of the session.
    "function ensure(){if(!timer)timer=setInterval(draw,33);}",
    "onmessage=function(e){var d=e.data;",
    "  if(d.t==='init'){W=d.w;H=d.h;DPR=d.dpr;canv=d.canvas;canv.width=Math.round(W*DPR);",
    "    canv.height=Math.round(H*DPR);ctx=canv.getContext('2d');ensure();draw();}",
    "  else if(d.t==='size'){W=d.w;DPR=d.dpr||DPR;canv.width=Math.round(W*DPR);",
    "    canv.height=Math.round(H*DPR);draw();}",
    "  else if(d.t==='seg'){f0=d.f0;f1=d.f1;dur=d.dur;t0=performance.now();ensure();}",
    "  else if(d.t==='done'){f0=shown;f1=1;dur=d.ms||200;t0=performance.now();ensure();}",
    "  else if(d.t==='reset'){shown=0;f0=0;f1=0;dur=0;t0=performance.now();tape=[];ensure();draw();}",
    "  else if(d.t==='tape'){postMessage({t:'tape',tape:tape,now:performance.now()});}",
    "  else if(d.t==='stop'){if(timer)clearInterval(timer);timer=null;}};",
  ].join("\n");

  // ---- the card ---------------------------------------------------------
  // A LINE. Big number on the left, one rule under it that fills left to
  // right. No spinner, no ring, no paragraph of apology — the number is the
  // status and the line is the picture of it.
  const BAR_H = 108;                    // meter box height, CSS px
  let card = null, canvas = null, worker = null, fbFill = null, fbText = null, fbTimer = 0;
  let workerTape = null;

  function meterWidth() {
    const w = (window.innerWidth || 800) - 56;
    return Math.max(200, Math.min(560, Math.round(w)));
  }

  function build() {
    if (card) return card;
    const style = document.createElement("style");
    style.textContent =
      "#bootload{position:fixed;inset:0;z-index:200;display:none;flex-direction:column;" +
      "align-items:center;justify-content:center;gap:18px;background:" + BG + ";color:" + INK + ";" +
      "font-family:Fredoka,system-ui,sans-serif;text-align:center;padding:24px}" +
      "#bootload .meter{position:relative;height:" + BAR_H + "px}" +
      "#bootload .meter canvas{position:absolute;inset:0;width:100%;height:100%}" +
      // Liveness insurance, and the ONE thing here that is not information: a
      // highlight sliding along the rule. It animates `transform` only, so the
      // compositor keeps it moving even when the main thread is gone — if a
      // browser ever fails to push the worker's canvas frames through a
      // blocked main thread, the page still visibly breathes instead of
      // looking hung. Costs nothing and never contradicts the number.
      "@keyframes cbzBootShine{from{transform:translateX(-110%)}to{transform:translateX(340%)}}" +
      "#bootload .shine{position:absolute;left:0;right:0;bottom:0;height:10px;border-radius:5px;" +
      "overflow:hidden;pointer-events:none}" +
      "#bootload .shine i{display:block;width:30%;height:100%;" +
      "background:linear-gradient(90deg,rgba(255,138,50,0),rgba(255,150,60,.55),rgba(255,138,50,0));" +
      "animation:cbzBootShine 1.9s linear infinite}" +
      "#bootload .num{position:absolute;left:0;bottom:26px;font-size:" + Math.round(BAR_H * 0.62) + "px;" +
      "font-weight:700;line-height:1}" +
      "#bootload .track{position:absolute;left:0;right:0;bottom:0;height:10px;border-radius:5px;" +
      "background:rgba(255,122,26,.16);overflow:hidden}" +
      "#bootload .fill{height:100%;width:0;border-radius:5px;background:" + HOT + "}" +
      "#bootload h2{margin:0;font-size:22px;font-weight:700;letter-spacing:.5px}";
    document.head.appendChild(style);

    card = document.createElement("div");
    card.id = "bootload";
    const meter = document.createElement("div");
    meter.className = "meter";
    meter.style.width = meterWidth() + "px";
    card.appendChild(meter);
    const shine = document.createElement("div");
    shine.className = "shine";
    shine.appendChild(document.createElement("i"));
    const h = document.createElement("h2");
    h.textContent = "BUILDING THE WORLD";
    card.appendChild(h);
    document.body.appendChild(card);

    // preferred path: worker-drawn canvas
    try {
      if (window.Worker && window.OffscreenCanvas && HTMLCanvasElement.prototype.transferControlToOffscreen) {
        canvas = document.createElement("canvas");
        meter.appendChild(canvas);
        const off = canvas.transferControlToOffscreen();
        const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
        worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = function (ev) {
          if (ev.data && ev.data.t === "tape") workerTape = { tape: ev.data.tape, workerNow: ev.data.now, pageNow: performance.now() };
        };
        worker.postMessage({
          t: "init", canvas: off, w: meterWidth(), h: BAR_H,
          dpr: Math.min(window.devicePixelRatio || 1, 2),
        }, [off]);
      }
    } catch (e) { worker = null; }

    if (!worker) {
      if (canvas) { canvas.remove(); canvas = null; }
      fbText = document.createElement("div");
      fbText.className = "num";
      fbText.textContent = "0%";
      const track = document.createElement("div");
      track.className = "track";
      fbFill = document.createElement("div");
      fbFill.className = "fill";
      track.appendChild(fbFill);
      meter.appendChild(fbText);
      meter.appendChild(track);
    }
    meter.appendChild(shine);
    return card;
  }

  // ---- DOM fallback: same easing, drawn whenever the thread is free ------
  let fbF0 = 0, fbF1 = 0, fbT0 = 0, fbDur = 0, fbShown = 0;
  function fbDraw() {
    if (!fbFill) return;
    const t = performance.now() - fbT0, span = fbF1 - fbF0;
    let p = fbDur > 0
      ? (t <= fbDur ? fbF0 + span * 0.85 * (t / fbDur)
        : fbF1 - span * 0.15 * Math.exp(-(t - fbDur) / (fbDur * 0.8)))
      : fbF1;
    if (p < fbShown) p = fbShown; if (p > 1) p = 1; fbShown = p;
    fbFill.style.width = (p * 100).toFixed(2) + "%";
    fbText.textContent = Math.floor(p * 100) + "%";
  }
  function fbLoop() {
    if (!fbFill || !running) return;
    fbDraw();
    fbTimer = requestAnimationFrame(fbLoop);
  }

  function post(msg) {
    if (worker) { worker.postMessage(msg); return; }
    if (!fbFill) return;
    if (msg.t === "seg") { fbF0 = msg.f0; fbF1 = msg.f1; fbDur = msg.dur; fbT0 = performance.now(); }
    else if (msg.t === "done") { fbF0 = fbShown; fbF1 = 1; fbDur = msg.ms || 200; fbT0 = performance.now(); }
    else if (msg.t === "reset") { fbShown = fbF0 = fbF1 = 0; fbDur = 0; fbT0 = performance.now(); }
    fbDraw();
  }

  // ---- the plan ---------------------------------------------------------
  // The landmass registry is complete at page load (every biome/island module
  // registers at parse time), so the exact step list for a world build —
  // names and all — is known BEFORE the freeze starts. That is what makes the
  // denominator real instead of a guess.
  // the 30 s part: buildCity + every registered landmass builder, in the exact
  // order city/worldmap.js will run them
  function cityWorldSteps() {
    const out = ["city:core", "city:buildings", "city:expansion"];
    const list = (CBZ._landmassBuilders || []).slice().sort(function (a, b) { return a.order - b.order; });
    for (let i = 0; i < list.length; i++) out.push(list[i].bootKey || ("lm:#" + i));
    out.push("city:props", "city:beach", "city:finish");
    return out;
  }
  // the per-life part: static batching, then the population
  const CITY_RUN_STEPS = ["city:batch", "city:pop", "city:traffic", "city:run"];

  // worldOnly === a mode switch that builds the world but does not start a
  // life (the CITY tile on the title screen). The city is built ONCE per page
  // (city/mode.js build() early-outs after that), so a later PLAY is a short
  // reset, not a 30 s world build — the plan has to know that or the meter
  // parks at 4% and then teleports to 100%.
  function planFor(mode, worldOnly) {
    const keys = [];
    if (!worldOnly) keys.push("boot:reset");
    if (mode === "city" && !(CBZ.city && CBZ.city.built)) {
      const w = cityWorldSteps();
      for (let i = 0; i < w.length; i++) keys.push(w[i]);
    }
    if (mode === "city" && !worldOnly) {
      for (let i = 0; i < CITY_RUN_STEPS.length; i++) keys.push(CITY_RUN_STEPS[i]);
    }
    keys.push("boot:frames");
    return keys;
  }

  // ---- the engine -------------------------------------------------------
  let plan = null, total = 0, idx = -1, stepT = 0, running = false, measured = null, floor = 0;
  let log = [];

  function prefix(i) {
    let s = 0;
    for (let k = 0; k < i && k < plan.length; k++) s += plan[k].w;
    return s;
  }
  function retotal() {
    total = 0;
    for (let i = 0; i < plan.length; i++) total += plan[i].w;
    if (!(total > 0)) total = 1;
  }
  function emit() {
    // A LOADING BAR MAY NEVER GO BACKWARDS. Splicing an unplanned step in
    // grows the denominator, which can put the new step's start below the
    // last one's — so the floor is remembered and the segment is clamped to
    // it. (The drawn value is monotonic on its own, but the TARGETS have to
    // be too or the bar stalls while the truth catches back up.)
    let f0 = prefix(idx) / total, f1 = prefix(idx + 1) / total;
    if (f0 < floor) f0 = floor;
    if (f1 < f0) f1 = f0;
    floor = f0;
    post({ t: "seg", f0: f0, f1: f1, dur: plan[idx].w });
    // the tape tools/boot-meter-check.mjs reads back: every checkpoint, where
    // the bar was put, and what the step was predicted to cost
    log.push({ key: plan[idx].key, at: +(f0 * 100).toFixed(2), to: +(f1 * 100).toFixed(2), predict: Math.round(plan[idx].w), t: Math.round(performance.now()) });
  }

  function begin(mode, worldOnly) {
    const keys = planFor(mode, worldOnly);
    plan = keys.map(function (k) { return { key: k, w: weightOf(k) }; });
    retotal();
    idx = -1; stepT = performance.now(); measured = {}; running = true; log = []; floor = 0;
    post({ t: "reset" });
    if (fbFill) { fbShown = 0; fbTimer = requestAnimationFrame(fbLoop); }
  }

  function step(key) {
    if (!running || !key) return;
    const t = performance.now();
    if (idx >= 0) {
      const k = plan[idx].key;
      measured[k] = (measured[k] || 0) + (t - stepT);
    }
    let found = -1;
    for (let i = idx + 1; i < plan.length; i++) if (plan[i].key === key) { found = i; break; }
    if (found < 0) {
      // A step nobody planned for (a campaign leg, a new module, a mode this
      // meter has never seen). Splice it in where it actually happened and
      // re-total: the bar slows down rather than lying about being nearly done.
      plan.splice(idx + 1, 0, { key: key, w: weightOf(key) });
      found = idx + 1;
      retotal();
    } else {
      // Steps we jumped over did not run this time (a disabled builder, a
      // guest client that skips spawning). Decay them so tomorrow's
      // denominator stops carrying weight for work that no longer happens.
      for (let i = idx + 1; i < found; i++) {
        const sk = plan[i].key;
        if (learned[sk] > 0) learned[sk] *= 0.4;
      }
    }
    idx = found; stepT = t;
    emit();
  }

  function finish(cb) {
    if (!running) { if (cb) cb(); return; }
    if (idx >= 0) {
      const k = plan[idx].key;
      measured[k] = (measured[k] || 0) + (performance.now() - stepT);
    }
    for (const k in measured) if (Object.prototype.hasOwnProperty.call(measured, k)) remember(k, measured[k]);
    persist();
    running = false;
    post({ t: "done", ms: 180 });
    if (fbTimer) { cancelAnimationFrame(fbTimer); fbTimer = 0; }
    if (fbFill) { const end = performance.now() + 260; (function settle() { fbDraw(); if (performance.now() < end) requestAnimationFrame(settle); })(); }
    // hold 100% just long enough to read, then get out of the way
    setTimeout(function () { hide(); if (cb) cb(); }, 260);
  }

  function show(mode, worldOnly) {
    build().style.display = "flex";
    const meter = card.querySelector(".meter"), w = meterWidth();
    if (meter) meter.style.width = w + "px";
    if (worker) worker.postMessage({ t: "size", w: w, dpr: Math.min(window.devicePixelRatio || 1, 2) });
    begin(mode, !!worldOnly);
  }
  function hide() {
    if (card) card.style.display = "none";
    post({ t: "stop" });   // park the worker's 30fps timer while nobody can see it
    if (fbTimer) { cancelAnimationFrame(fbTimer); fbTimer = 0; }
    running = false;
  }

  CBZ.bootMeter = {
    show: show,
    hide: hide,
    step: step,
    finish: finish,
    active: function () { return running; },
    // "worker" = the number keeps counting through the freeze; "dom" = the
    // fallback, which can only repaint when the main thread yields.
    mode: function () { return worker ? "worker" : (fbFill ? "dom" : "off"); },
    // the checkpoint tape of the last/current run
    log: function () { return log.slice(); },
    // ask the drawing thread for its tape (async; read it back with tape())
    askTape: function () { if (worker) worker.postMessage({ t: "tape" }); },
    tape: function () { return workerTape; },
    measured: function () { return measured ? JSON.parse(JSON.stringify(measured)) : {}; },
    // tools/debug: what this machine has learned, in ms
    weights: function () { return JSON.parse(JSON.stringify(learned)); },
  };
  // Hot path — called from inside the build loops, must be one cheap call.
  CBZ.bootStep = step;
})();
