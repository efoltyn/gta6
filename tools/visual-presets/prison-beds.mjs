/* Prison beds storyboard for tools/visual-compare.mjs — DID THE WING GROW,
   AND DID THE MEN GET INTO THE BEDS.

   OWNER, 2026-08-15 (verbatim): "Scale the number of cells so every single NPC
   has a bed."

   Boots the REAL escape mode on both builds (title -> Prison Escape -> Play),
   freezes the rAF loop so CBZ.stepSim(1/60) is the only clock, and walks one
   fixed shot list over the live cell house. Boot and staging are jail-scene.mjs's,
   deliberately: two prison storyboards that disagree about how to reach
   `playing` are two different measurements.

   WHAT THE SHOT LIST IS FOR. The change is architectural, so five of the eight
   plates are the same camera on both builds looking at floor that either is or
   is not a cell block:

     block-above     the whole footprint. Before: three rows against the walls
                     and a 23.4 m empty aisle. After: five rows — the aisle is
                     a centre hall with cell fronts down both sides and a
                     gallery in front of each outer row.
     hall-north      standing in that aisle looking up it. The single frame the
                     whole change lives in.
     gallery-west    the 3.5 m gallery between rows B and D, which did not
                     exist before and is where the outer cells' fronts now face
                     something.
     cell-outer-B2   ONE CELL, and it is the control: B-2 is identical on both
                     builds, same camera, same fittings. If it moved, the "not
                     one existing prison coordinate moves" claim in
                     world/cellblock.js's header is false.
     cell-inner-D3   one of the new cells, photographed from its own doorway.
                     Before, that camera is looking at nothing.

   ...and three are LIGHTS OUT, because a bed nobody is in has not been proven
   to be a bed. The clock is pinned to 23:00 (CBZ.dayPhase — the plan reads the
   world's sun, systems/dayplan.js) and held there through a long settle while
   systems/prisonrest.js walks the wing to bed four men at a time.

   THE NUMBERS ARE MEASURED BY THIS FILE, NOT READ OFF THE BUILD. `sleepGap` is
   reported as the build states it, but the headline — menWithoutABed — is
   counted here, identically on both sides: every prisoner rig
   (`kind === "inmate"` out of entities/npc.js's factory, or the older
   `role === "inmate"`, never `_crowd`) minus every registered mattress. That
   matters because the fault was partly IN the instrument: the deployed
   `sleepGap` asks `role === "inmate"` and cannot see the prison's dealer, its
   two merchants or its five crew runners, so it reads 0 while eight men have
   nowhere to lie down. One instrument, both builds, no argument. */

/* THE WING HAS A LID, so "the block from above" is not an aerial. Measured on
   the first run of this storyboard: a camera at y = 44 over (0,-26) photographs
   a white roof and nothing else — world/escape_routes.js:69 builds a ceiling
   structure over the cell block and world/roofs.js caps it, on purpose ("so the
   cell block reads like an enclosed facility"). The honest overview is from
   INSIDE, just under that ceiling: y = 6.3 at the south end, raking north up the
   whole 30 m of wing. It reads the row layout, which is what the shot is for. */
const subjects = [
  { id: "block-overview", label: "The whole wing, raking", hour: null,
    focus: "From just under the ceiling at the south end, looking the length of the wing. BEFORE: two thin rows against the side walls and 23.4 m of bare floor between them. AFTER: five rows — the same two outer rows, two new inner rows, and the north row at the head — with two galleries and a centre hall between them.",
    cam: { x: 0, y: 6.30, z: -9.60, ax: 0, ay: 0.40, az: -31.5 } },
  { id: "hall-north", label: "Up the centre hall", hour: null,
    focus: "Standing on the spine at z = -12.5 looking north up the wing. This is the whole change in one frame: an empty hangar aisle becomes a hall with barred fronts down both sides and the cross-aisle and officer post still open at the head of it.",
    cam: { x: 0, y: 1.78, z: -12.2, ax: 0, ay: 1.55, az: -37.5 } },
  { id: "gallery-west", label: "The west gallery", hour: null,
    focus: "The 3.5 m run between row B's fronts (left, on the shell wall) and row D's back (right). Row B's cells used to open onto 23 m of nothing; now they open onto a gallery, which is what the fronts of a cell row are supposed to face.",
    cam: { x: -9.95, y: 1.72, z: -13.0, ax: -9.95, ay: 1.45, az: -35.0 } },
  { id: "cell-outer-B2", label: "Cell B-2 — the control", hour: null,
    focus: "THE CONTROL PLATE. B-2 (x -15.50..-11.70, z -26.42..-22.62) is untouched by this change, photographed from the same point on both builds. Bunk, combo unit, shelf, mirror and door pocket must be pixel-for-pixel where they were, or the header's 'not one existing prison coordinate moves' is a lie.",
    // Stood back to 2.7 m, not 1.35: a sliding leaf pockets into ONE half of
    // its own face and which half alternates by cell index, so a lens on the
    // cell's centre-line is aimed at the boundary between the opening and the
    // fixed grille and may photograph bars on one build and the room on the
    // other. From 2.7 m the whole 3.8 m front is in frame and the comparison
    // cannot turn on which side the door happened to park.
    cam: { x: -9.00, y: 1.95, z: -24.52, ax: -15.30, ay: 1.00, az: -24.52 } },
  { id: "cell-inner-D3", label: "Cell D-3 — one of the new ones", hour: null,
    focus: "A new cell from across the hall: the same 3.8 x 3.8 room as a B or C cell, the same double bunk out of the same bunkRig, the same combo unit against the back wall, and a resident on the lower rack. BEFORE, this camera is aimed at open floor.",
    cam: { x: 0.40, y: 1.95, z: -24.32, ax: -8.10, ay: 1.00, az: -24.32 } },
  /* 21:00 SECURE, NOT 23:00, FOR THE TWO PLATES YOU HAVE TO BE ABLE TO READ.
     systems/prisonrest.js beds the wing down on `secure` and `night` alike
     (bedTime = either), but only `night` carries lightsOut, and a lights-out
     frame of a dark cell proves nothing you can see. So lock-up is where the
     wing is photographed full, and 23:00 gets the one atmosphere plate plus
     the close shot on a body, where the cell's own strip is the light. */
  { id: "lockup-overview", label: "Lock-up — the whole wing", hour: 21,
    focus: "21:00, cells locked, every man on his own bunk, lights still on. Same raking camera as plate 1. This is the wing at capacity: on the before side the middle of it is still empty floor with nowhere for the overflow to go.",
    cam: { x: 0, y: 6.30, z: -9.60, ax: 0, ay: 0.40, az: -31.5 } },
  { id: "lights-out-hall", label: "Lights out — up the centre hall", hour: 23,
    focus: "23:00. Same camera as plate 2 with the block dark: the cell strips are out, the men are down, and the count in the corner is the whole ask answered.",
    cam: { x: 0, y: 1.78, z: -12.2, ax: 0, ay: 1.55, az: -37.5 } },
  /* THE ONE PLATE WITH NO FIXED CAMERA, AND THE REASON IS THE POINT. Every
     other frame here is the same lens on both builds. This one is aimed at a
     rack that a body is ACTUALLY LYING ON, chosen at stage time from the live
     records, because "there are more beds" and "a man is in one" are two
     different claims and only the second one is the owner's. Which cell it
     finds differs between the builds — it has 42 to choose from on one side
     and 66 on the other — and the plate names the cell it picked. */
  { id: "lights-out-bunk", label: "Lights out — a man in a rack", hour: 23, pickOccupiedBunk: true,
    focus: "Inside a cell at 23:00, framed on a mattress with a body on it: head on the pillow, hips on the cushion, feet inside the frame. The number that makes this a proof and not a photograph is bunkStanders in the corner — bodies whose feet are inside a mattress while NOT lying on it — and systems/prisonrest.js pins it at 0.",
    cam: null },
];

async function stagePrisonBeds(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  if (!T || !CBZ || !CBZ.game || !CBZ.stepSim) return { ok: false, err: "no game" };

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
      if (child.id === "__bedsOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__bedsSeq;
  if (!S) {
    // ---- one-time: boot the real game into escape mode (jail-scene.mjs's) ----
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'),
      300000
    );
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
    overlay.id = "__bedsOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-count></div><div data-rows></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__bedsSeq = { overlay, night: false, settled: false };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }

  const subject = input.subject;
  let ticks = 0, totalMs = 0, maxMs = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms;
      if (ms > maxMs) maxMs = ms;
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
    }
  };

  /* ---- THE CLOCK. systems/dayplan.js reads the world's sun, so 23:00 is
     `dayPhase = (23 - 6) / 24` and nothing else — never a private accumulator
     and never a poke at prisonSchedule, which has no setter and should not
     grow one for a screenshot. Stepping turns the sun (a 150 s day: ten
     seconds of sim is an hour and a half), so the phase is RE-PINNED every
     two seconds of settle or the wing wakes up halfway through it. */
  const phaseFor = (hour) => ((hour - 6) / 24);
  const pin = (hour) => { try { if (CBZ.dayPhase) CBZ.dayPhase(phaseFor(hour)); } catch (_) {} };

  if (subject.hour != null) {
    pin(subject.hour);
    if (!S.settled) {
      // ONE long settle, shared by every bed plate. systems/prisonrest.js hands
      // over at most MAX_ACT = 4 bodies per half-second sweep, and the men walk
      // in from the yard, the workshop, the chapel and the south dorm, so this
      // is minutes of wing time and not a pause for effect. `secure` and
      // `night` are the same bedTime block to that system, so a wing settled at
      // 21:00 stays down when the clock is moved to 23:00.
      for (let s = 0; s < 150; s += 2) { pin(subject.hour); step(2); }
      S.settled = true;
    } else {
      for (let s = 0; s < 8; s += 2) { pin(subject.hour); step(2); }
    }
    pin(subject.hour);
  } else {
    step(2);
  }

  /* ---- the one aimed plate: find a rack with a body ON it ---------------- */
  let shotBed = null;
  if (subject.pickOccupiedBunk) {
    const cb = CBZ.cellblock;
    const racks = [];
    for (const c of (cb && cb.cells) || []) {
      if (c && c.bed) racks.push({ c: c, b: c.bed, lower: true });
      if (c && c.bedTop) racks.push({ c: c, b: c.bedTop, lower: false });
    }
    const lying = racks.filter((r) => r.b.occupant && r.b.occupant._propLie);
    shotBed = lying.find((r) => r.lower) || lying[0] || null;
  }

  // ---- MEASURE. One instrument, both builds. --------------------------------
  const audit = (() => { try { return CBZ.prisonRestAudit ? CBZ.prisonRestAudit() : null; } catch (_) { return null; } })();
  const wing = (() => { try { return CBZ.prisonBeds ? CBZ.prisonBeds() : null; } catch (_) { return null; } })();
  const cba = (() => { try { return CBZ.cellblockAudit ? CBZ.cellblockAudit() : null; } catch (_) { return null; } })();

  /* EVERY PRISONER RIG, counted here rather than asked of the build. The
     deployed audit asks `role === "inmate"` and misses the eight men whose
     `role` records a TRADE (npc.js 315/329/345/380) — so on that side its own
     sleepGap is 8 short of the truth. entities/npc.js:26 stamps
     `kind: "inmate"` on every body its factory makes, which is the question
     that means "is this man doing time"; `_crowd` still excludes the anonymous
     city tier, and the old `role` test stays as an OR so nothing drops out. */
  let rigs = 0, lying = 0, standers = 0;
  const list = CBZ.npcs || [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a || a._crowd || !a.group || a.dead || a.escaped) continue;
    if (a.kind !== "inmate" && a.role !== "inmate") continue;
    rigs++;
    if (a._propLie) lying++;
  }
  const beds = audit ? (audit.beds | 0) : 0;
  standers = audit ? (audit.bunkStanders | 0) : 0;

  // cells per row, off the cell records' own tags, so it reads the same on a
  // build that has never heard of `cellblockAudit().rows`
  const rowMap = {};
  const cells = (CBZ.cellblock && CBZ.cellblock.cells) || [];
  for (let i = 0; i < cells.length; i++) {
    const r = String(cells[i].tag || "?").split("-")[0];
    rowMap[r] = (rowMap[r] | 0) + 1;
  }
  const rowKeys = Object.keys(rowMap).sort();
  const rowText = rowKeys.map((k) => k + ":" + rowMap[k]).join("  ");

  // ---- frame and render -----------------------------------------------------
  setHud(false);
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55;
  camera.near = 0.25;
  camera.far = 20000;
  let cam = subject.cam;
  if (subject.pickOccupiedBunk) {
    /* Stand at the rack's OPEN LONG EDGE and look along the body toward the
       pillow. The foot end is the wrong angle twice over: the frame and the
       upper rack's posts are between the lens and the sleeper, and a body seen
       end-on is 40 cm of shoulder. `nx` is the lateral direction into the room
       — world/cellblock.js's own `bunkSpot` uses the identical expression to
       decide which side of the bunk a man stands on — and every bunk in this
       wing lies along z with its pillow at -z (bunkRig draws it at -lon), so
       the pillow is always the -z end and never a guess. */
    if (shotBed) {
      const c = shotBed.c, b = shotBed.b;
      const nx = (c.dz !== 0) ? 1 : c.dx;
      const top = b.top || 0.79;
      /* Eye height is 0.66 ABOVE the cushion and never more: on a lower rack
         the upper frame occupies y 1.56..1.84 (bunkRig's `bb(0, 1.70, …, 0.28,
         …)`), so a lens raised for a nicer downward angle is a lens looking at
         the underside of the rack above. 1.9 m out and 1.9 m back is the whole
         2.6 m body in frame from outside the stack's 1.25 m width. */
      cam = {
        x: b.x + nx * 1.90, y: top + 0.66, z: b.z + 1.90,
        ax: b.x, ay: top + 0.14, az: b.z - 0.45,
      };
    } else {
      cam = { x: 0, y: 1.78, z: -12.2, ax: 0, ay: 1.55, az: -37.5 };
    }
  }
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
  q("focus").style.cssText = "position:absolute;left:27px;bottom:44px;color:#cdd8e2;font-size:12px;font-weight:550;max-width:760px;line-height:1.45";
  const gap = rigs - beds;
  q("count").textContent = `${rigs} men · ${beds} beds · ${gap > 0 ? "+" + gap : gap} without one` +
    (subject.hour != null ? ` · ${lying} lying · ${standers} standing in a bunk` : "") +
    (shotBed ? `  [cell ${shotBed.c.tag}, ${shotBed.lower ? "lower" : "upper"} rack]` : "");
  q("count").style.cssText = `position:absolute;right:24px;top:24px;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;text-align:right;color:${gap > 0 ? "#ff9c9c" : "#9fe8c3"}`;
  q("rows").textContent = `${cells.length} cells  ${rowText}  ·  ${(CBZ.prisonSchedule && CBZ.prisonSchedule.id && CBZ.prisonSchedule.id()) || "?"}` +
    ` · sim ${ticks} ticks avg ${ticks ? (totalMs / ticks).toFixed(1) : "0"}ms · ${render.calls || 0} draws`;
  q("rows").style.cssText = "position:absolute;right:24px;top:48px;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#a9bcca;text-align:right";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:16px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    subject: subject.id,
    block: (CBZ.prisonSchedule && CBZ.prisonSchedule.id && CBZ.prisonSchedule.id()) || null,
    rows: rowMap,
    shotBed: shotBed ? { cell: shotBed.c.tag, rack: shotBed.lower ? "lower" : "upper",
      x: Number(shotBed.b.x.toFixed(2)), z: Number(shotBed.b.z.toFixed(2)),
      top: Number((shotBed.b.top || 0).toFixed(2)) } : null,
    wing: wing,
    cellblock: cba ? { cells: cba.cells, occupied: cba.occupied, empty: cba.empty,
      spawnBlocked: cba.spawnBlocked, doorGapBlocked: cba.doorGapBlocked,
      spineBlocked: cba.spineBlocked, spawnInPlayerCell: cba.spawnInPlayerCell,
      spawnMargin: cba.spawnMargin, colliders: cba.colliders } : null,
    restAudit: audit,
    metrics: {
      menWithoutABed: gap,
      inmates: rigs,
      beds: beds,
      reportedSleepGap: audit && audit.sleepGap != null ? Number(audit.sleepGap) : 0,
      bunkStanders: standers,
      lying: lying,
      cells: cells.length,
      cellRows: rowKeys.length,
      drawCalls: Number(render.calls || 0),
      tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    },
  };
}

export default {
  id: "prison-beds",
  title: "Prison: Scale the Cells Until Every Man Has a Bed",
  description: "The same seeded prison on the deployed and local builds. The cell house grows from three rows and thirteen cells to five rows and twenty-five, using the 23.4 m of empty aisle it already had, and the shell, CBZ.SPAWN, the ventilation crawl, the officer-post waypoint and the south throat do not move. Five plates are the same camera on floor that either is or is not a cell block — including one control plate on cell B-2, which must be identical. Three are lights-out, because a bed nobody is in has not been proven to be a bed. Every count under every frame is measured by the storyboard itself, the same way on both sides.",
  beforeLabel: "BEFORE · 13 CELLS",
  afterLabel: "AFTER · 25 CELLS",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  metricsNote: "Counted inside each build while its plate was staged, by the storyboard and not by the build: menWithoutABed is every prisoner rig in CBZ.npcs (kind or role 'inmate', never _crowd, never dead) minus every mattress registered as a propuse bed. reportedSleepGap is what the build's own CBZ.prisonRestAudit() says — on the deployed side it reads 8 lower than the truth because it counts only rigs whose role field happens to say 'inmate'. lying and bunkStanders are meaningful on the three lights-out plates.",
  metrics: {
    menWithoutABed: { label: "Men with nowhere to lie down", better: "lower" },
    inmates: { label: "Prisoner rigs" },
    beds: { label: "Registered mattresses" },
    reportedSleepGap: { label: "sleepGap as the build reports it", better: "lower" },
    bunkStanders: { label: "Bodies standing inside a mattress", better: "lower" },
    lying: { label: "Men in a bed" },
    cells: { label: "Cells in the wing" },
    cellRows: { label: "Rows in the wing" },
    drawCalls: { label: "Draw calls", better: "lower" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
  },
  subjects,
  stage: stagePrisonBeds,
};
