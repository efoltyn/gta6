/* Walk-in vehicle holds — storyboard for tools/visual-compare.mjs.

   THE ASK (owner, verbatim): "i want you to make a cargo plane where you can
   open and close the back and even a tank can drive into the back — but like
   elevators it must actually have a back of plane that exists, so other players
   can be inside the plane like a room."

   Every plate is shot inside the REAL game — the real military island, the real
   airframe, the real ramp arc, the real tank driven by the real ground sim, and
   the real moving-platform floor. Nothing here is a studio mock-up; the camera
   is the only thing this file poses.

   HOW THE DEPLOYED SIDE DEGRADES. Honestly, and usefully: the shipped build has
   no cargo airframe at all, so instead of a blank plate it photographs THE EXACT
   PATCH OF APRON the freighter now stands on — framed off the heavy bomber,
   which both builds have, at the same offset the placement uses. The before
   plate is therefore a true statement ("this is what is parked here today:
   nothing") rather than an error card, and the state line says so.

   THE SUBJECTS ARE A SEQUENCE. They run in declaration order inside one page
   per side and share one live world: plate 1 photographs the ramp shut, plate 2
   opens it and waits out the real 3-second arc, plate 4 drives a tank up it,
   plate 5 drops bank duffels in the bay, plate 6 puts bodies aboard, plate 7
   takes off with all of it still inside.
   A later plate failing means an earlier beat did not happen. */

const subjects = [
  {
    id: "cargo-plane-exterior",
    label: "Cargo Lifter — ramp closed",
    focus: "Three-quarter view off the port quarter. The back is SHUT: the ramp is stood up across the aperture, and the aeroplane reads as a sealed freighter on its apron.",
  },
  {
    id: "ramp-open",
    label: "Ramp down",
    focus: "Dead astern at loadmaster height, after the real 3-second arc. Steel on the tarmac, a continuous slope from apron to deck, and a LIT ROOM through the opening — not a dark hole.",
  },
  {
    id: "hold-interior",
    label: "Inside the hold, looking aft",
    focus: "THE WHOLE ASK. Standing on the cargo deck at eye height, looking out through the open ramp. Roller rails, tie-downs, webbing benches, ribbed walls, overhead strips: a room that exists.",
  },
  {
    id: "tank-in-hold",
    label: "Tank aboard",
    focus: "A Main Battle Tank driven up that ramp by the ordinary ground sim and chained down. Look for daylight around it — the bay was sized off the tank's real 3.5 m width.",
  },
  {
    id: "loose-cargo",
    label: "Duffels chained to the deck",
    focus: "The owner's OTHER half: bank money, physically, in the back of the aeroplane. Duffels dropped in the bay fall through to the apron (inventory.js rests them on TERRAIN) and the hold catches them, lifts them onto the deck and straps them down.",
  },
  {
    id: "hold-occupants",
    label: "Crew aboard",
    focus: "Bodies standing in the hold beside the load, held by npclife anchors — the multiplayer read the owner asked for: other people, inside the plane, in a room.",
  },
  {
    id: "hold-airborne",
    label: "Airborne, load still aboard",
    focus: "The proof that the room MOVES. The same hold at altitude with the tank still chained where it stopped — the floor, the walls and the freight all carried by the airframe's own pose.",
  },
];

async function stageHolds(input) {
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
  const tick = (dt) => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    CBZ.stepSim(dt == null ? 1 / 60 : dt);
    if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
  };
  const steps = (n) => { for (let i = 0; i < n; i++) tick(); };
  const round = (v, n) => (Number.isFinite(v) ? Math.round(v * Math.pow(10, n == null ? 2 : n)) / Math.pow(10, n == null ? 2 : n) : null);
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__holdOverlay") continue;
      child.style.visibility = "hidden";
    }
  };
  // THE FIRST-PERSON VIEWMODEL IS PARENTED TO THE CAMERA, and this file poses
  // the camera by hand. Left alone it puts the player's own forearm (and the
  // muzzle-flash sprite, which is depthTest:false and therefore draws over
  // everything) across the corner of every interior plate. Photographing the
  // room means taking the photographer's hands out of the shot.
  const hideViewmodel = () => {
    const cam = CBZ.camera;
    if (!cam || !cam.children) return;
    for (const c of cam.children) c.visible = false;
  };
  const syncSky = () => {
    if (typeof CBZ.skySync === "function") { CBZ.skySync(); return; }
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(CBZ.camera.position.x, 0, CBZ.camera.position.z);
  };

  let S = window.__cargoHolds;
  if (!S) {
    // ---------------- one-time: boot the real world ----------------------
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") && CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);

    // the island registrars adopt their props on a deferred pass
    let recs = [];
    for (let i = 0; i < 900; i++) {
      tick();
      recs = CBZ.cityMilitaryVehicles || [];
      if (recs.length) break;
    }
    // strong midday sun so an interior reads as an interior and not as a cave
    try { if (CBZ.dayPhase) { CBZ.dayPhase(0.42); steps(20); } } catch (_) {}

    const plane = recs.filter((r) => r && r.cargoLifter)[0] || null;
    const bomber = recs.filter((r) => r && r.model && /bomber/i.test(String(r.model.name)))[0] || null;
    // The FALLBACK FRAME: island_military places the lifter at (MAXX-150,
    // jetZ-34) and the bomber at (MAXX-95, jetZ-12), so a build with no lifter
    // still knows exactly where to point — 55 m west and 22 m south of the
    // bomber, at its heading. Both builds share that bomber.
    const origin = plane
      ? { x: plane.pos.x, y: plane.pos.y, z: plane.pos.z, yaw: plane.heading || 0 }
      : bomber
        ? { x: bomber.pos.x - 55, y: 0, z: bomber.pos.z - 22, yaw: 0 }
        : { x: 0, y: 0, z: 0, yaw: 0 };

    const overlay = document.createElement("div");
    overlay.id = "__holdOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-detail></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__cargoHolds = {
      plane, bomber, origin, overlay,
      hold: plane ? plane.hold : null,
      tankIn: false, crewIn: false, bagsIn: false, airborne: false, tankRec: null, crew: [],
    };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }

  const hold = S.hold;
  const have = !!(S.plane && hold && !hold.inert);

  // Local -> world in the airframe's frame (or the empty apron's), so every
  // camera in this file is framed the same way on both sides of the report.
  const world = (lx, ly, lz) => {
    if (have) { const w = hold.worldOf(lx, ly, lz, {}); return new T.Vector3(w.x, w.y, w.z); }
    const c = Math.cos(S.origin.yaw), s = Math.sin(S.origin.yaw);
    return new T.Vector3(S.origin.x + lx * c + lz * s, S.origin.y + ly, S.origin.z - lx * s + lz * c);
  };

  const id = input.subject.id;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  const state = [];

  // ---------------- advance the storyboard --------------------------------
  if (have) {
    if (id === "cargo-plane-exterior") {
      hold.closeRamp(); steps(230);
    } else if (id === "ramp-open" || id === "hold-interior") {
      if (!hold.open) { hold.openRamp(); steps(230); }
    } else if (id === "tank-in-hold" && !S.tankIn) {
      if (!hold.open) { hold.openRamp(); steps(230); }
      const tank = (CBZ.cityMilitaryVehicles || []).filter((r) => r && r.kind === "tank" && !r.taken && !r._heldBy)[0];
      if (tank) {
        // Line it up 9 m aft of the toe and DRIVE. Everything from here is the
        // shipped ground sim reading the shipped ground query — no teleport
        // into the hold, no scripted path.
        const toe = world(0, 0, -15.6);
        const gy = CBZ.floorAt ? CBZ.floorAt(toe.x, toe.z - 9) : 0;
        const back = world(0, 0, -24.6);
        tank.pos.set(back.x, gy, back.z);
        tank.group.position.copy(tank.pos);
        tank.heading = S.origin.yaw; tank.group.rotation.set(0, tank.heading, 0);
        tank.taken = false;
        const P = CBZ.player;
        P.pos.set(tank.pos.x + 3, gy, tank.pos.z);
        P.driving = false; P._vehicle = null; P._aircraft = null;
        if (CBZ.cityDriveArmor && CBZ.cityDriveArmor(tank)) {
          CBZ.keys = CBZ.keys || {};
          CBZ.keys.w = true;
          for (let i = 0; i < 170 && !hold.contains(tank.pos.x, tank.pos.y + 0.5, tank.pos.z); i++) tick();
          for (let i = 0; i < 40; i++) tick();
          CBZ.keys.w = false; CBZ.keys.s = true; steps(70); CBZ.keys.s = false; steps(50);
          if (CBZ.cityExitArmor) CBZ.cityExitArmor();
          steps(40);
        }
        S.tankRec = tank;
        S.tankIn = !!tank._heldBy;
      }
    } else if (id === "loose-cargo" && !S.bagsIn) {
      // Feature-detected, never a hard dependency: the cash-duffel wave is a
      // sibling and this plate simply says so when it is not there.
      if (CBZ.cashBags && CBZ.cashBags.payout) {
        const drop = [[-1.25, -8.6], [1.15, -9.4]];
        for (const d of drop) {
          const w = world(d[0], hold.deckTop() + 0.2, d[1]);
          // NO onFloor override on purpose. Left alone, inventory.js rests a
          // dropped bag with CBZ.floorAt — terrain, which knows nothing about
          // a deck 1.35 m up — so the money lands on the apron UNDER the
          // aeroplane. The hold's own sweep is what puts it back on the steel.
          try { CBZ.cashBags.payout(w.x, w.y, w.z, 90000, { spread: 0.7, srcName: "bank haul" }); } catch (_) {}
        }
        steps(60);                        // two 0.3 s latch sweeps, then settle
      }
      S.bagsIn = !!(CBZ.holdAudit && CBZ.holdAudit().cargoLatched > 0);
    } else if (id === "hold-occupants" && !S.crewIn) {
      const peds = CBZ.cityPeds || [];
      // AFT of the load, in the three metres of deck between the tank's tail
      // and the aperture: a 3.5 m tank in a 4.4 m bay leaves no shoulder room
      // beside it, so a body standing at x ±1.5 amidships would be standing
      // INSIDE the tank. This is where a loadmaster actually stands.
      const anchors = [
        { x: -1.35, z: -10.2, yaw: 0.35 }, { x: 1.30, z: -9.1, yaw: -0.5 },
        { x: -0.20, z: -8.2, yaw: 2.6 },
      ];
      for (const a of anchors) {
        const actor = peds.filter((p) => p && p.group && !p.dead && !p._npcAttached && S.crew.indexOf(p) < 0)[0];
        if (!actor) break;
        if (hold.attachActor(actor, { x: a.x, y: hold.deckTop(), z: a.z, yaw: a.yaw, pose: "stand" })) S.crew.push(actor);
      }
      steps(12);
      S.crewIn = S.crew.length > 0;
    } else if (id === "hold-airborne" && !S.airborne) {
      if (CBZ.cityAirborneStart) {
        // Shut the back first, exactly as a real departure would.
        hold.closeRamp(); steps(230);
        const craft = CBZ.cityAirborneStart(S.plane, { alt: 900, speed: 95, heading: S.origin.yaw });
        if (craft) { steps(90); S.airborne = true; S.craft = craft; }
      }
    }
  }

  // ---------------- pose the camera ---------------------------------------
  // Every position is in the airframe's own frame, so the shots are repeatable
  // and the deployed side frames the identical volume of empty apron.
  const look = (from, at, fov) => {
    camera.position.copy(from);
    camera.fov = fov || 52;
    camera.near = 0.12;
    camera.lookAt(at);
    camera.updateProjectionMatrix();
    syncSky();
  };

  if (id === "cargo-plane-exterior") {
    look(world(-25, 11.5, -41), world(2.5, 3.4, -2), 46);
  } else if (id === "ramp-open") {
    // LOW and off the port quarter, at loadmaster height: the plate is about
    // the opening, and you cannot read an opening from above its own roofline.
    look(world(-1.6, 3.1, -26.0), world(0.0, 2.7, -9.5), 47);
  } else if (id === "hold-interior") {
    look(world(0.15, 1.35 + 1.62, 5.6), world(0, 2.0, -15), 62);
  } else if (id === "tank-in-hold") {
    // straight up the ramp from the apron, at a man's height: the one angle
    // from which "a tank drove in there" is a fact rather than a caption.
    look(world(0.5, 1.85, -18.0), world(0, 2.1, -5.0), 48);
  } else if (id === "loose-cargo") {
    look(world(0.9, 2.8, -5.2), world(-0.4, 1.5, -10.6), 62);
  } else if (id === "hold-occupants") {
    // shot from OUTSIDE the open back, looking in: the read the owner asked
    // for is "other people, inside the plane, in a room", and you only get it
    // if the room is framed by the doorway you are standing outside of.
    look(world(0.45, 3.05, -13.8), world(-0.2, 2.3, -4.5), 62);
  } else if (id === "hold-airborne") {
    // Up under the ceiling at the aft end, looking forward down the whole bay:
    // the one camera that holds the tank, the duffels and the crew in one
    // frame. NOT from the forward bulkhead — the tank drove in nose-first and
    // its gun overhangs three metres past the glacis, so that camera is
    // standing at the muzzle — and not at head height in the aft bay, which is
    // where the loadmasters are standing.
    if (have && S.airborne) look(world(0.0, 4.02, -11.2), world(0, 1.95, 2.5), 68);
    else look(world(-25, 11.5, -41), world(2.5, 3.4, -2), 46);
  }

  hideHud();
  hideViewmodel();
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const info = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  // ---------------- honest numbers ----------------------------------------
  const audit = (CBZ.holdAudit && CBZ.holdAudit()) || null;
  const metrics = { drawCalls: Number(info.calls || 0) };
  let detail;
  if (have) {
    metrics.holds = audit ? audit.holds : 0;
    metrics.vehiclesLatched = audit ? audit.vehiclesLatched : 0;
    metrics.actorsAboard = audit ? audit.actorsAboard : 0;
    metrics.cargoLatched = audit ? audit.cargoLatched : 0;
    metrics.deckHeight = round(hold.deckTop());
    // the ramp slope, measured off the live walk surface rather than declared
    if (CBZ.mpGroundAt) {
      const a = world(0, 0, -12.0), b = world(0, 0, -15.0);
      const ya = CBZ.mpGroundAt(a.x, a.z, 2.5, 0), yb = CBZ.mpGroundAt(b.x, b.z, 2.5, 0);
      if (isFinite(ya) && isFinite(yb)) metrics.rampSlopeDeg = round(Math.atan2(ya - yb, 3.0) * 180 / Math.PI, 1);
    }
    if (S.airborne && S.tankRec && S.tankRec._heldBy) {
      metrics.altitude = round(S.plane.pos.y, 0);
      metrics.loadDrift = round(Math.abs(S.tankRec.pos.y - (S.plane.pos.y + hold.deckTop())), 3);
    }
    const verb = !!(CBZ.interactions && CBZ.interactions.hasOption && CBZ.interactions.hasOption("vehhold-ramp"));
    metrics.rampVerb = verb ? 1 : 0;
    state.push("hold " + hold.phase, "ramp " + Math.round(hold.rampT * 100) + "%");
    state.push(verb ? "E / touch pill registered" : "NO RAMP VERB");
    if (audit) state.push(audit.vehiclesLatched + " veh · " + audit.cargoLatched + " cargo · " + audit.actorsAboard + " aboard");
    if (id === "loose-cargo" && !(CBZ.cashBags && CBZ.cashBags.payout)) state.push("no cashBags in this build");
    if (S.airborne) state.push("AIRBORNE " + Math.round(S.plane.pos.y) + " m");
    detail = "CBZ.vehicleHold ✓ · rigBacked " + (audit ? audit.rigBacked : "?") +
      " · orphaned " + (audit ? audit.orphaned : "?") +
      " · carriedFrames " + (audit ? audit.carriedFrames : "?") +
      " · deck " + metrics.deckHeight + " m" +
      (metrics.rampSlopeDeg != null ? " · ramp " + metrics.rampSlopeDeg + "°" : "");
  } else {
    state.push("NO CARGO AIRFRAME IN THIS BUILD");
    state.push("no walk-in hold, no ramp, no vehicle latch");
    detail = "CBZ.vehicleHold " + (typeof CBZ.vehicleHold) + " · CBZ.holdAudit " + (typeof CBZ.holdAudit) +
      " · framed off the heavy bomber at the placement offset (−55 x, −22 z)";
  }

  // ---------------- overlay ------------------------------------------------
  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector("[data-" + n + "]");
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:" +
    (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
  q("name").textContent = input.subject.label;
  q("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = input.subject.focus;
  q("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:700px";
  q("state").textContent = state.join(" · ");
  q("state").style.cssText = "position:absolute;right:24px;top:24px;color:" + (have ? "#80e4b4" : "#ff9c9c") +
    ";font-size:11px;font-weight:850;letter-spacing:.1em;text-align:right;max-width:420px";
  q("detail").textContent = detail;
  q("detail").style.cssText = "position:absolute;right:24px;bottom:18px;color:#a7b6c2;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;max-width:560px";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    subject: id,
    hasHold: have,
    audit: audit,
    tankAboard: !!S.tankIn,
    crewAboard: S.crew.length,
    airborne: !!S.airborne,
    metrics,
  };
}

export default {
  id: "cargo-holds",
  title: "The Walk-In Hold: a Room Inside a Vehicle",
  description: "A cargo aeroplane whose back OPENS and whose inside is a real room — a floor you stand on while it flies, walls that stay solid while it turns, a ramp a tank drives up, and freight and bodies that come along. Six plates from one live world per side: ramp shut, ramp down, standing inside, a Main Battle Tank driven aboard by the ordinary ground sim, crew in the bay, and the whole load still chained down at 900 m. The deployed build has no cargo airframe at all, so its plates photograph the same patch of apron — framed off the heavy bomber both builds share — and say so.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  // The deployed side boots over the network in a headless tab and the whole
  // one-time world warm-up lives inside the FIRST subject's evaluate, so this
  // is a first-plate budget, not a per-plate one. 480 s was not enough for
  // github.io on a cold cache.
  stageTimeoutMs: 900000,
  metricsNote: "Measured inside each build while its plate was staged: CBZ.holdAudit()'s live census, the walk surface's own slope sampled through CBZ.mpGroundAt, and — on the airborne plate — how far the strapped tank drifted off the deck it is chained to.",
  metrics: {
    holds: { label: "Holds declared", better: "higher" },
    vehiclesLatched: { label: "Vehicles chained down", better: "higher" },
    cargoLatched: { label: "Loose cargo chained", better: "higher" },
    actorsAboard: { label: "Bodies in the hold", better: "higher" },
    deckHeight: { label: "Cargo deck height", unit: "m" },
    rampSlopeDeg: { label: "Ramp slope (measured)", unit: "°", better: "lower" },
    rampVerb: { label: "Ramp verb on the shared interact layer", better: "higher" },
    altitude: { label: "Altitude with load", unit: "m" },
    loadDrift: { label: "Load drift off the deck", unit: "m", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageHolds,
};
