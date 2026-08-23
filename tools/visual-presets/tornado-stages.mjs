/* THE TORNADO storyboard for tools/visual-compare.mjs.

   Skeleton lifted from quake-stages.mjs (same boot, same rAF freeze, same
   CBZ.stepSim clock), narrowed to the TORNADO and staged along its real
   timeline so every beat of the V2 behaviour gets its own frame:

     warn-sky     the pre-tornado sky: the yellow-green cast, heavy low fog,
                  the wind that rises and then dies to nothing. Shot with a
                  lot of sky in frame, because the sky IS the telegraph.
     touchdown    the full column seconds after it drops: does the funnel
                  hang from a dark rotating wall cloud, and does its foot end
                  in a dirt-coloured debris skirt on the ground — or is it a
                  grey cone floating in clear air?
     shelter      the crowd's decision. V2 safeDir points bodies near the
                  funnel at the nearest standing doorway OUT of the path
                  (real advice: inside beats running); before, they sprint.
     grind        the funnel over a building: glass out, the frame leaning,
                  roof pieces going UP off the top. Before: nothing — the
                  survival vortex could not scratch a building.
     thrown       a parked car mid-flight. The EF2 damage indicator is
                  literally "cars lifted off ground"; before, island cars
                  were bolted down.
     aftermath    the storm is gone and the camera looks down the TRACK:
                  torn-ground scars in a line, deposited wreckage, wrecked
                  cars, collapsed buildings. A tornado leaves a path, not a
                  circle of nothing.

   CAMERAS ARE SOLVED, NOT TYPED (quake-stages.mjs explains at length): every
   beat asks the LIVE world for its subject — the funnel's actual position via
   CBZ.tornado.active(), the most-damaged standing building, a car that is
   really flung, the audit's real track endpoints — and frames THAT. A beat
   whose subject does not exist says so in the frame instead of lying.

   THE BASELINE IS A FLAG A/B AGAINST THIS SAME CHECKOUT. The deployed build
   is unreachable from the harness, and a same-checkout flag flip is the
   stronger claim anyway: before = ?cfg_TORNADO_V2=0 (the pre-wave survival
   tornado, actors-only, no wall cloud, no path), after = the flag's default. */

const subjects = [
  { id: "warn-sky", label: "The warning — the sky goes green",
    focus: "Warn phase. Heavy low cloud with a hard yellow-green cast, fog closing in, the wind rising and then dying to the eerie calm right before the drop. Lots of sky in frame on purpose: the sky is the telegraph.",
    act: { force: "tornado", untilState: "warn", extraSecs: 4.55 },
    cam: { aim: "sky" } },

  { id: "touchdown", requireTornado: true, label: "Touchdown — the condensation funnel",
    focus: "The full column, seconds old. AFTER: it hangs from a dark rotating wall cloud, and its foot churns a dirt-coloured debris skirt where it eats the ground. BEFORE: a grey translucent cone standing in a clear sky.",
    act: { atSecs: 1.2 },
    cam: { aim: "funnel" } },

  { id: "shelter", requireTornado: true, label: "The shelter decision",
    focus: "Bodies near the funnel head for the nearest standing doorway that is NOT in the damage path — you do not outrun 14 m/s on foot, you get inside. Indoors, the walls take the wind (until the building itself fails). BEFORE: everyone just sprints, and walls mean nothing.",
    act: { atSecs: 5.5 },
    cam: { aim: "door" } },

  { id: "grind", requireTornado: true, label: "Full strength — taking a building",
    focus: "The funnel parked on a building, grinding it through the survival ledger: windows out, a permanent lean, debris leaving the ROOF upward — a tornado lifts. Long enough dwell collapses it into a real rubble field. BEFORE: the survival vortex could not scratch a building.",
    act: { atSecs: 9.5 },
    cam: { aim: "grind" } },

  { id: "thrown", requireTornado: true, label: "A car, lifted and thrown",
    focus: "A parked car picked up once the local gust passes the EF2 'cars lifted' bar and thrown along the wind with an upward kick, tumbling to rest as wreckage. BEFORE: island cars are bolted to the street.",
    act: { atSecs: 12.5 },
    cam: { aim: "flung" } },

  { id: "aftermath", requireTornado: true, label: "Aftermath — the damage path",
    focus: "The funnel is gone. What is left is a LINE: torn-ground scars along the track, deposited wreckage beside it, thrown cars, leaning and collapsed buildings. Walk the path and read the storm's whole story. BEFORE: the tornado leaves literally nothing.",
    act: { atSecs: 17.2, thenSecs: 5 },
    cam: { aim: "path" } },
];

async function stageTornado(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__tornadoOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__tornadoSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") return { ok: false, err: "no CBZ.disasters.force" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__tornadoOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__tornadoSeq = { overlay, t0: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.stamina != null) CBZ.player.stamina = 100;
  };
  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms;
      if (ms > maxMs) maxMs = ms;
      if (ms > 33) over33++;
      heal();
    }
  };
  const stepUntilState = (want, budget) => {
    let guard = Math.round((budget || 30) * 10);
    while (guard-- > 0 && CBZ.disasters.state() !== want) step(0.1);
  };

  /* ORDER-INDEPENDENCE (quake-stages' lesson verbatim): a --subjects subset
     must land on the same sim-second as the full storyboard, so any beat that
     needs the tornado re-forces it and seeks to its own ABSOLUTE second of
     the active phase off the director's own clock. */
  const armTornado = () => {
    CBZ.disasters.force("tornado"); step(0.1);
    stepUntilState("active", 40);
    S.t0 = CBZ.disasters.timeLeft();
  };
  if (subject.requireTornado && CBZ.disasters.current() !== "TORNADO" && !act.force) armTornado();
  if (act.force) {
    CBZ.disasters.force(act.force); step(0.1);
    if (act.force === "tornado") S.t0 = null;
  }
  if (act.untilState) stepUntilState(act.untilState, 40);
  if (act.atSecs != null) {
    if (CBZ.disasters.state() !== "active") stepUntilState("active", 40);
    if (S.t0 == null) S.t0 = CBZ.disasters.timeLeft();
    let guard = 900;
    while (guard-- > 0 && CBZ.disasters.state() === "active" &&
           CBZ.disasters.current() === "TORNADO" &&
           (S.t0 - CBZ.disasters.timeLeft()) < act.atSecs) step(0.1);
  }
  if (act.extraSecs) step(act.extraSecs);
  if (act.thenSecs) step(act.thenSecs);

  // ---- SOLVE THE CAMERA off live world state -----------------------------
  const A = (CBZ.SURV && CBZ.SURV.arena) || { cx: 0, cz: 600, radius: 120 };
  const AR = A.radius || A.r || 120;      // the field is `radius` (config.js)
  const arena = CBZ.surv && CBZ.surv.arena;
  const audit = (CBZ.tornado && CBZ.tornado.audit) ? CBZ.tornado.audit() : {};
  const fun = (CBZ.tornado && CBZ.tornado.active) ? CBZ.tornado.active()[0] : null;
  const funH = fun ? Math.max(55, Math.min(260, fun.r * 2.4)) : 90;
  const frag = (arena && arena.fragile) || [];
  const cam = subject.cam || {};
  let eye = null, look = null, note = "";

  // center-outward direction from the island centre through a point, swung a
  // little so we see corners, never flat walls (quake-stages' reasoning)
  const outDir = (x, z, swing) => {
    let ox = x - A.cx, oz = z - A.cz;
    const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
    const sw = swing == null ? 0.5 : swing;
    return { x: ox * Math.cos(sw) - oz * Math.sin(sw), z: ox * Math.sin(sw) + oz * Math.cos(sw) };
  };
  const groundClamp = (e) => {
    try { const g = CBZ.floorAt ? CBZ.floorAt(e.x, e.z) : 0; if (e.y < g + 2.2) e.y = g + 2.2; } catch (_) {}
    return e;
  };

  if (cam.aim === "sky") {
    // stand on the BEACH RING (the one strip guaranteed free of buildings —
    // an in-town eye kept ending up inside a tower and photographing a black
    // interior), look up over the skyline: the frame is mostly warn-phase sky
    const d = outDir(A.cx + 1, A.cz + 1, 0);
    eye = groundClamp({ x: A.cx + d.x * (AR * 0.98), y: 3.5, z: A.cz + d.z * (AR * 0.98) });
    look = { x: A.cx, y: 46, z: A.cz };
    note = "warn sky over the town";
  } else if (cam.aim === "funnel" && fun) {
    // frame ground contact to wall-cloud underside: look a third of the way
    // up the column, stand back far enough that ~0.5*back of vertical space
    // covers the funnel foot AND the flare at the top
    const d = outDir(fun.x, fun.z, 0.5);
    const back = Math.max(funH * 1.5, fun.r * 4.2);
    eye = groundClamp({ x: fun.x + d.x * back, y: funH * 0.5, z: fun.z + d.z * back });
    look = { x: fun.x, y: funH * 0.42, z: fun.z };
    note = `funnel EF${fun.ef} at (${fun.x.toFixed(0)},${fun.z.toFixed(0)})`;
  } else if (cam.aim === "door" && fun) {
    // the doorway the crowd is actually converging on: standing healthy
    // building, out of the damage path, most actors near its door
    let best = null, bestN = -1, bestD = 1e9;
    const actors = [];
    try { CBZ.surv.forEachActor((a) => { if (a && !a.dead && a.pos) actors.push(a); }); } catch (_) {}
    for (const b of frag) {
      if (b.fallen || (b._dmg || 0) > 0.6) continue;
      const doorX = b.x, doorZ = b.z - b.d * 0.5 - 1.2;
      const fd = Math.hypot(b.x - fun.x, b.z - fun.z);
      if (fd < fun.r * 1.3) continue;                        // it IS the path
      let n = 0;
      for (const a of actors) if (Math.hypot(a.pos.x - doorX, a.pos.z - doorZ) < 10) n++;
      if (n > bestN || (n === bestN && fd < bestD)) { bestN = n; bestD = fd; best = { x: doorX, z: doorZ, b }; }
    }
    if (best) {
      // shoot from OUTSIDE the door (doors face -z), funnel side of frame
      eye = groundClamp({ x: best.x + 3, y: 3.2, z: best.z - 11 });
      look = { x: best.x, y: 1.6, z: best.z + 2 };
      note = `door of a standing building · ${bestN} bodies near it`;
    }
  } else if (cam.aim === "grind" && fun) {
    // the building the funnel is actually working on: max damage, else nearest
    let best = null, bs = -1e9;
    for (const b of frag) {
      const fd = Math.hypot(b.x - fun.x, b.z - fun.z);
      const s = (b.fallen ? 0.5 : (b._dmg || 0)) * 10 - fd * 0.05;
      if (s > bs) { bs = s; best = b; }
    }
    if (best) {
      const midX = (best.x + fun.x) / 2, midZ = (best.z + fun.z) / 2;
      const d = outDir(midX, midZ, 0.6);
      const back = Math.max(46, fun.r * 2.4 + Math.max(best.w, best.d));
      eye = groundClamp({ x: midX + d.x * back, y: Math.max(16, best.h * 0.9), z: midZ + d.z * back });
      look = { x: midX, y: Math.min(12, best.h * 0.5), z: midZ };
      note = `building dmg ${((best._dmg || 0)).toFixed(2)}${best.fallen ? " (FALLEN)" : ""} · ${Math.hypot(best.x - fun.x, best.z - fun.z).toFixed(0)}m from axis`;
    }
  } else if (cam.aim === "flung") {
    // a car that is really flung — prefer one in the air NEAR the funnel, and
    // shoot along the car→funnel axis so the thing that threw it is in frame
    const cars = (arena && arena.cars) || [];
    let best = null, bs = -1e9;
    for (const c of cars) {
      if (!c.flung || !c.group) continue;
      const p = c.group.position;
      const s = p.y * 3 - (fun ? Math.hypot(p.x - fun.x, p.z - fun.z) * 0.15 : 0);
      if (s > bs) { bs = s; best = c; }
    }
    if (best) {
      const p = best.group.position;
      let dx = fun ? fun.x - p.x : 1, dz = fun ? fun.z - p.z : 0;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      eye = groundClamp({ x: p.x - dx * 26, y: Math.max(5, p.y + 4), z: p.z - dz * 26 });
      look = { x: p.x + dx * 16, y: p.y + 6, z: p.z + dz * 16 };
      note = `flung car at y=${p.y.toFixed(1)} · funnel behind`;
    } else if (fun) {
      const d = outDir(fun.x, fun.z, 0.5);
      eye = groundClamp({ x: fun.x + d.x * fun.r * 3, y: 12, z: fun.z + d.z * fun.r * 3 });
      look = { x: fun.x, y: 6, z: fun.z };
      note = "NO FLUNG CAR — funnel base instead";
    }
  } else if (cam.aim === "path") {
    const p = audit.path;
    if (p) {
      let dx = p.x1 - p.x0, dz = p.z1 - p.z0;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      // high behind the start, looking down the whole track
      eye = groundClamp({ x: p.x0 - dx * 35, y: 62, z: p.z0 - dz * 35 });
      look = { x: (p.x0 + p.x1) / 2, y: 0, z: (p.z0 + p.z1) / 2 };
      note = `track ${l.toFixed(0)}m · ${audit.scarMarks || 0} scars · ${audit.carsFlung || 0} cars · ${audit.buildingCollapses || 0} collapses`;
    }
  }
  if (!eye) {
    // subject missing: say so in the frame instead of lying
    const d = outDir(A.cx + 1, A.cz + 1, 0.4);
    eye = { x: A.cx + d.x * AR * 0.9, y: 46, z: A.cz + d.z * AR * 0.9 };
    look = { x: A.cx, y: 4, z: A.cz };
    note = note || "SUBJECT MISSING — island wide shot";
  }

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.4; camera.far = 20000;
  camera.position.set(eye.x, eye.y, eye.z);
  camera.lookAt(look.x, look.y, look.z);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  q("focus").textContent = `${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()} · ${note}` + (audit.v2 ? "" : " · V2 OFF");
  q("focus").style.cssText = "position:absolute;top:250px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:380px";
  q("perf").textContent =
    `bldg hits ${audit.buildingHits || 0} · collapses ${audit.buildingCollapses || 0}\n` +
    `cars flung ${audit.carsFlung || 0} · shelter saves ${audit.shelterSaves || 0}\n` +
    `scars ${audit.scarMarks || 0} · debris kept ${audit.debrisKept || 0} · path ${audit.pathMeters || 0}m\n` +
    `sim ${ticks} ticks · avg ${(ticks ? totalMs / ticks : 0).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms`;
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;white-space:pre;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    buildingHits: Number(audit.buildingHits || 0),
    buildingCollapses: Number(audit.buildingCollapses || 0),
    carsFlung: Number(audit.carsFlung || 0),
    shelterSaves: Number(audit.shelterSaves || 0),
    scarMarks: Number(audit.scarMarks || 0),
    debrisKept: Number(audit.debrisKept || 0),
    pathMeters: Number(audit.pathMeters || 0),
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
  };

  return { ok: true, disaster: CBZ.disasters.current(), state: CBZ.disasters.state(), note, metrics };
}

export default {
  id: "tornado-stages",
  title: "The Tornado",
  description: "One seeded survival match per build, the director forced to the tornado and stepped through the same simulated seconds. Before (?cfg_TORNADO_V2=0): a grey translucent cone in a clear sky that hurts actors and touches nothing else. After: a condensation funnel hanging from a rotating wall cloud with a dirt debris skirt, buildings ground through the shared structural ledger until they lean and collapse, parked cars lifted at the EF2 gust bar and thrown, a crowd that heads for doorways because interior rooms genuinely protect, and a permanent scarred, wreckage-strewn damage PATH across the island. Every camera is solved off the live world.",
  beforeLabel: "BEFORE · V2 OFF",
  afterLabel: "AFTER · V2 ON",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  defaultBefore: "local",
  beforeParams: { cfg_TORNADO_V2: 0 },
  stageTimeoutMs: 480000,
  metricsNote: "Counts come from CBZ.tornado.audit(), measured off live counters at the moment of the frame. All zeros on a build means the tornado only hurt the people standing in it: no building bite, no thrown car, no shelter rule, no path. shelterSaves counts bodies the interior-room rule spared from the kill core; pathMeters is ground the funnel actually covered.",
  metrics: {
    buildingHits: { label: "Structural bites (ledger)", better: "higher" },
    buildingCollapses: { label: "Buildings collapsed", better: "higher" },
    carsFlung: { label: "Cars lifted + thrown", better: "higher" },
    shelterSaves: { label: "Shelter saves", better: "higher" },
    scarMarks: { label: "Path scars laid", better: "higher" },
    debrisKept: { label: "Wreckage deposited", better: "higher" },
    pathMeters: { label: "Track length", unit: "m", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageTornado,
};
