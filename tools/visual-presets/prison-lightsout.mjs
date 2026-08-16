/* Prison lights-out storyboard for tools/visual-compare.mjs — ARE THE MEN
   ACTUALLY IN THE BEDS.

   OWNER, 2026-08-15 (verbatim): "Scale the number of cells so every single NPC
   has a bed." tools/visual-presets/prison-beds.mjs answered the CAPACITY half
   of that on 25 cells / 66 racks and `sleepGap` went to -4. This storyboard is
   the other half, and it is a different claim: a rack with nobody on it has
   not been proven to be a bed.

   THE MEASURED FAULT this exists to photograph, taken live at the night block
   on 38a1e5c with every man in CBZ.npcs counted:

     23 of 61 lying          38% of the wing, against 66 registered mattresses
     0 of 66 racks reserved  `_claim` set on none of them while 31 men held a
                             `_restBed`, so three racks had two names on them
     6 men                   no muster, no claim, no walk — the dealer, the
                             merchants and the thieves, whose `role` records a
                             TRADE and who were therefore not "inmates" to
                             prisonschedule's housing predicate
     13 men                  in a heap at z -6.2..-7.3, all of them aimed at
                             the single point (0, -9.8)
     50 racks                behind world/door.js's keycard leaf — a 5.72 x
                             0.34 m slab at (0, -8) that is the cell house's
                             only entrance and was shut for the whole run. A
                             0.5 m body cannot pass z[-8.5,-7.5] at any x.

   WHAT THE SHOT LIST IS FOR. Five plates, and four of them are the same camera
   on both builds pointed at floor that either has men on it or does not:

     gate-count    the wing gate at the evening return. THE PLATE THE WHOLE
                   CHANGE LIVES IN: before, a crowd standing in the yard
                   against a shut slab; after, the leaf racked for the count
                   and the last men filing through it.
     hall-out      up the centre hall at 23:00 with the block dark.
     row-d         one inner cell row from the hall, close enough to read
                   bodies on the racks rather than count silhouettes.
     dorm-out      the south dorm at 23:00 — the OTHER housing unit, sixteen
                   racks behind no locked door at all, so it is the control
                   for "is this about the gate or about the routing".
     wing-raking   the whole wing from just under the ceiling, the same camera
                   prison-beds.mjs uses for its overview, so the two
                   storyboards can be read side by side.

   THE NUMBERS ARE MEASURED BY THIS FILE. `pctInBed` is the headline and it is
   counted here, identically on both sides: every prisoner rig in CBZ.npcs
   (`kind === "inmate"` out of entities/npc.js's factory, or the older
   `role === "inmate"`, never `_crowd`, never dead, never over the wire)
   against how many of them carry `_propLie`. The denominator excludes ESCAPED
   men on purpose — a man outside the perimeter is not a man the wing failed to
   put to bed, and counting him would let a build score better by losing
   prisoners.

   THE CLOCK IS WALKED, NOT JUMPED. `count` (18:30) is when the wing musters
   and the men start moving; `secure` (21:00) is when the leaves rack shut;
   `night` (23:00) is lights out. A storyboard that pins straight to 23:00
   photographs a wing that was never given the evening to fill, which is a
   different measurement from the one the game makes. Both builds are walked
   through the same three hours for the same number of ticks. */

const subjects = [
  { id: "gate-count", label: "The wing gate at the evening return", hour: 19,
    focus: "18:30-21:00, Evening Return. The cell house's only entrance is world/door.js's 5.72 m leaf at (0, -8). BEFORE: it is shut, as it is every hour of every run, and the men the muster ordered inside are standing against it in the yard — thirteen of them aimed at one point on the far side. AFTER: the schedule racks it for the count, the men cross in their own lanes, and it shuts again behind the last of them.",
    cam: { x: 0, y: 2.30, z: 3.20, ax: 0, ay: 1.30, az: -12.0 } },
  { id: "hall-out", label: "Lights out — up the centre hall", hour: 23,
    focus: "23:00, block dark, cell fronts locked. Standing on the spine at z = -12.2 looking the length of the wing. The count in the corner is the whole ask: how many of the men who are alive and still inside the wire are lying on a mattress.",
    cam: { x: 0, y: 1.78, z: -12.2, ax: 0, ay: 1.55, az: -37.5 } },
  { id: "row-d", label: "Lights out — an inner cell row", hour: 23,
    focus: "Row D from the hall at 23:00, three cells deep. Close enough that a body on a rack reads as a body: head on the pillow, hips on the cushion. bunkStanders in the corner is the counter-claim — a man whose feet are inside a mattress while he is NOT lying on it — and systems/prisonrest.js pins it at 0.",
    cam: { x: 1.60, y: 1.70, z: -18.6, ax: -6.60, ay: 0.95, az: -26.5 } },
  { id: "dorm-out", label: "Lights out — the south dorm", hour: 23,
    focus: "The other housing unit at 23:00: sixteen racks in eight stacks, one controlled opening, and no locked door anywhere on the route. It is the control plate. If the dorm fills on both builds and the cell house only fills on one, the difference is the gate and not the pose.",
    cam: { x: -33.0, y: 1.80, z: 106.4, ax: -33.0, ay: 1.10, az: 122.0 } },
  { id: "wing-raking", label: "Lights out — the whole wing", hour: 23,
    focus: "From just under the ceiling at the south end, raking the length of the wing — prison-beds.mjs's own overview camera, so the capacity storyboard and this one can be read together. Twenty-five cells' worth of fronts, and the question is how many of them have somebody behind them.",
    cam: { x: 0, y: 6.30, z: -9.60, ax: 0, ay: 0.40, az: -31.5 } },
];

async function stageLightsOut(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.game || !CBZ.stepSim) return { ok: false, err: "no game" };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, every) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 60000)) {
      try { if (fn()) return true; } catch (_) {}
      await wait(every || 250);
    }
    return false;
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__loOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__loSeq;
  if (!S) {
    /* Boot is jail-scene.mjs's / prison-beds.mjs's, deliberately: two prison
       storyboards that disagree about how to reach `playing` are two different
       measurements of two different games. */
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="escape"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 180; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__loOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-count></div><div data-rows></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__loSeq = { overlay, at: null, evening: false };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }

  const subject = input.subject;
  let ticks = 0, totalMs = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      totalMs += performance.now() - t0; ticks++;
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
    }
  };
  /* systems/dayplan.js reads the WORLD'S SUN, so an hour is
     `dayPhase = (h - 6) / 24` and nothing else — never a poke at
     prisonSchedule, which has no setter and should not grow one for a
     screenshot. escape mode runs a 720 s day (core/daynight.js MODE_CYCLE), so
     stepping turns it and the phase is re-pinned every half second of settle
     or the wing walks out of the block being photographed. */
  const pin = (h) => { try { if (CBZ.dayPhase) CBZ.dayPhase((h - 6) / 24); } catch (_) {} };
  const hold = (h, secs) => { for (let s = 0; s < secs; s += 0.5) { pin(h); step(0.5); } pin(h); };

  if (subject.hour != null) {
    /* WALK THE EVENING, ONCE, AND SHARE IT. The muster fires on the klaxon at
       18:30; the leaves rack at 21:00; lights out is 23:00. Every plate after
       the first re-pins its own hour and settles briefly, so the run is only
       ever walked forward. */
    if (!S.evening) {
      S.evening = true;
      hold(19, 70);                    // count: the wing musters and the men move
      S.at = 19;
    }
    if (subject.hour >= 21 && S.at < 21) { hold(21.5, 40); S.at = 21.5; }   // secure
    if (subject.hour >= 23 && S.at < 23) { hold(23, 60); S.at = 23; }       // lights out
    hold(subject.hour, 6);
    S.at = subject.hour;
  } else step(2);

  // ---- MEASURE. One instrument, both builds. --------------------------------
  const audit = (() => { try { return CBZ.prisonRestAudit ? CBZ.prisonRestAudit() : null; } catch (_) { return null; } })();
  const sched = (() => { try { return CBZ.prisonScheduleAudit ? CBZ.prisonScheduleAudit() : null; } catch (_) { return null; } })();
  const wing = (() => { try { return CBZ.prisonBeds ? CBZ.prisonBeds() : null; } catch (_) { return null; } })();

  /* EVERY PRISONER RIG, COUNTED HERE. `kind` is what entities/npc.js:26 stamps
     on every body its factory makes and is the question that means "is this
     man doing time"; `role` is a TRADE and reading it is the bug that let a
     capacity audit report 0 with eight men on their feet. `_crowd` still
     excludes the anonymous city tier. Escaped men leave the denominator. */
  let rigs = 0, live = 0, lying = 0, homeless = 0, escaped = 0, dead = 0;
  const held = [], twice = [];
  const list = CBZ.npcs || [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a || a._crowd || !a.group) continue;
    if (a.kind !== "inmate" && a.role !== "inmate") continue;
    if (a.dead) { dead++; continue; }
    rigs++;
    if (a.escaped) { escaped++; continue; }
    live++;
    if (a._propLie) { lying++; }
    const b = a._restBed;
    if (!b) { homeless++; continue; }
    if (held.indexOf(b) < 0) held.push(b); else if (twice.indexOf(b) < 0) twice.push(b);
  }
  const beds = audit ? (audit.beds | 0) : 0;
  const standers = audit ? (audit.bunkStanders | 0) : 0;
  const claimed = audit ? (audit.claimed | 0) : 0;      // racks with a body ON them
  const pct = live ? Math.round((lying / live) * 100) : 0;

  // ---- frame and render -----------------------------------------------------
  setHud(false);
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 58;
  camera.near = 0.25;
  camera.far = 20000;
  const cam = subject.cam;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  // ---- overlay --------------------------------------------------------------
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:70px;left:26px;font-size:24px;font-weight:800;letter-spacing:-.02em;max-width:520px";
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;left:27px;bottom:44px;color:#cdd8e2;font-size:12px;font-weight:550;max-width:780px;line-height:1.45";
  q("count").textContent = `${pct}% IN BED   ${lying}/${live} lying · ${beds} racks · ${claimed} with a body on them`;
  q("count").style.cssText = `position:absolute;right:24px;top:24px;font:14px ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;text-align:right;color:${pct >= 80 ? "#9fe8c3" : "#ff9c9c"}`;
  q("rows").textContent =
    `${standers} standing in a mattress · ${homeless} with no rack · ${twice.length} racks double-claimed` +
    `\n${escaped} over the wire · ${dead} dead · block ${(sched && sched.block) || "?"}` +
    ` gate ${sched && sched.gateOpen ? "OPEN" : "shut"}` +
    `\nsim ${ticks} ticks avg ${ticks ? (totalMs / ticks).toFixed(1) : "0"}ms · ${render.calls || 0} draws`;
  q("rows").style.cssText = "position:absolute;right:24px;top:50px;white-space:pre;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#a9bcca;text-align:right;line-height:1.6";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:16px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    subject: subject.id,
    block: (sched && sched.block) || null,
    gateOpen: !!(sched && sched.gateOpen),
    wing: wing,
    restAudit: audit,
    metrics: {
      pctInBed: pct,
      lying: lying,
      inmates: rigs,
      liveInmates: live,
      beds: beds,
      claimed: claimed,
      bunkStanders: standers,
      homeless: homeless,
      doubleClaimed: twice.length,
      escaped: escaped,
      drawCalls: Number(render.calls || 0),
      tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    },
  };
}

export default {
  id: "prison-lightsout",
  title: "Prison: Get the Men Into the Beds",
  description: "The same seeded prison on the deployed and local builds, walked through the same evening — muster at 18:30, secure at 21:00, lights out at 23:00 — and photographed at the same five cameras. The capacity work put 66 mattresses in the wing; this asks how many men are on one. The headline is pctInBed: of every prisoner rig that is alive and still inside the wire, the share carrying propuse's lie pose. The gate plate is where the fault lives — the cell house's only entrance is world/door.js's keycard leaf, and until this wave nothing but the player's card had ever moved it, so fifty of the sixty-six racks were behind a door no inmate could open.",
  beforeLabel: "BEFORE · 38% IN BED",
  afterLabel: "AFTER",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  metricsNote: "Counted inside each build while its plate was staged, by the storyboard and not by the build. inmates is every prisoner rig in CBZ.npcs (kind or role 'inmate', never _crowd, never dead); liveInmates drops the ones over the wire, because a man outside the perimeter is not a man the wing failed to bed; pctInBed is lying/liveInmates. claimed is racks with a body actually on them, as CBZ.prisonRestAudit() reports it. bunkStanders (bodies whose feet are inside a mattress while not lying on it), homeless (live men holding no rack) and doubleClaimed (racks with two names) are the three ways this can be gamed and all three are pinned at 0.",
  metrics: {
    pctInBed: { label: "Live inmates in a bed", unit: "%", better: "higher" },
    lying: { label: "Men lying on a rack", better: "higher" },
    inmates: { label: "Prisoner rigs" },
    liveInmates: { label: "…alive and inside the wire" },
    beds: { label: "Registered mattresses" },
    claimed: { label: "Racks with a body on them", better: "higher" },
    bunkStanders: { label: "Bodies standing inside a mattress", better: "lower" },
    homeless: { label: "Live men holding no rack", better: "lower" },
    doubleClaimed: { label: "Racks with two names on them", better: "lower" },
    escaped: { label: "Over the wire" },
    drawCalls: { label: "Draw calls", better: "lower" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
  },
  subjects,
  stage: stageLightsOut,
};
