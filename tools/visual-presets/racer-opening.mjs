/* THE RACER ORIGIN'S OPENING, before and after — for tools/visual-compare.mjs.

   THE FAULT, in the owner's words: "a gray car appears and then from it more
   auto generate until there's 20 at least taking up the track."

   WHERE IT COMES FROM. city/origins.js cannot start the racer's grid race on
   the frame a mode reset applies the origin — the field is built from live
   standings and the car catalog, neither guaranteed up yet — so it arms a
   PENDING start and retries every frame for six seconds. That deferral is
   right; what was wrong is that ASKING cost a car. Every retry called
   cityRaceStart, which built the primer-grey loaner FIRST and discovered it
   could not race SECOND, then returned null having handed back the seat and
   walked away from the car. One grey car per frame, welded to the arena root
   with nothing left holding a reference, shoved apart across the racing
   surface by the car-car collision pass.

   WHY THIS PRESET DOES NOT WAIT FOR A SLOW BOOT. A machine that is ready on
   attempt one never sees the fault at all, which is exactly how it survived —
   so reproducing it by racing a boot timer would photograph noise. The stage
   FORCES the condition instead: cityEnterVehicle is stubbed to refuse, the
   origin's own start call is made twenty times (the same call, the same
   arguments, through the same entry point), and then the stub is put back.
   That is what six seconds of a starved retry loop does, made deterministic.

   BOTH SIDES ARE THIS CHECKOUT. `cfg_RACE_START_V2=0` is the fix's own
   one-line revert, so the ONLY variable between the two columns is the guard:
   the before column still leaks, the after column asks CBZ.cityRaceReady()
   for free and scraps anything it built on the way out. A fix nobody can turn
   off has not been measured.

   The last subject is the opposite claim — that the START still works. A grid
   that is clean because nothing ever races on it is not a fix. */

const subjects = [
  {
    id: "grid-litter-air",
    label: "01 · The back of the grid after twenty deferred starts",
    focus: "Straight down the start/finish straight from above. Every primer-grey car in this frame is one retry of the racer origin's pending grid start. AFTER must show bare asphalt and painted boxes.",
    action: "leak",
    cam: { t: 0, s: -150, u: 8, h: 62 }, aim: { t: 0, s: -18, u: 0, h: 0 }, fov: 46,
  },
  {
    id: "grid-litter-eye",
    label: "02 · The same grid at driver height",
    focus: "What the rookie's first frame actually looks like from the back row. The story promises 'a loaner, a back-row start' — a scrapyard is not a back row.",
    action: "leak",
    cam: { t: 0, s: -78, u: 7.5, h: 2.2 }, aim: { t: 0, s: -14, u: 0, h: 1.1 }, fov: 58,
  },
  {
    id: "loaner-count",
    label: "03 · Track-level sweep of the racing surface",
    focus: "Low along the racing line toward turn one, where the collision pass pushes the surplus cars. Count silhouettes on the asphalt: this is the shot that shows the litter is ON the track and not tucked behind a wall.",
    action: "leak",
    cam: { t: 0.02, s: 10, u: { wall: 5 }, h: 3.0 }, aim: { t: 0.16, u: 0, h: 1.0 }, fov: 52,
  },
  {
    id: "opening-race",
    label: "04 · And the opening still happens",
    focus: "The racer origin's real start, run afterwards on the same world: one loaner on the back row and a full championship field ahead of it. The guard must refuse a race it cannot hold, not refuse every race.",
    action: "race",
    cam: { t: 0, s: -66, u: 9, h: 6.0 }, aim: { t: 0, s: 4, u: 0, h: 1.4 }, fov: 52,
  },
];

async function stageRacerOpening(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const subject = input.subject || {};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };

  let S = window.__racerOpening;
  if (!S) {
    // ---- one-time: boot the real world AS THE RACER ----------------------
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && CBZ.setCityOrigin && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    // The origin has to be chosen BEFORE play: city/mode.js's reset applies it.
    try {
      CBZ.setCityOrigin("racer");
      const b = document.querySelector('.origin-btn[data-origin="racer"]');
      if (b) b.click();
    } catch (_) {}
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { if (CBZ.dayPhase) CBZ.dayPhase(0.45); } catch (_) {}

    // Freeze the rAF loop: CBZ.stepSim is the only clock from here, so both
    // columns sample identical simulated seconds on any machine.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; try { CBZ.stepSim(1 / 60); } catch (_) {} }

    const overlay = document.createElement("div");
    overlay.id = "__racerOpeningOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-count></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__racerOpening = { overlay: overlay, leaked: null, raced: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  if (typeof CBZ.speedwayFrame !== "function") return { ok: false, err: "no CBZ.speedwayFrame on this build" };
  const LEN = (typeof CBZ.speedwayTrackLen === "function" && CBZ.speedwayTrackLen()) || 1000;
  const surfaceY = (x, z) => {
    let y = 0, f = 0;
    try { y = Number(CBZ.speedwaySurfaceY ? CBZ.speedwaySurfaceY(x, z) : 0) || 0; } catch (_) {}
    try { f = Number(CBZ.floorAt ? CBZ.floorAt(x, z) : 0) || 0; } catch (_) {}
    return Math.max(y, f);
  };
  if (!S.halfW) {
    const f0 = CBZ.speedwayFrame(0);
    S.halfW = Number(f0.halfW) || 11;
  }
  const resolveU = (u) => {
    if (u == null) return 0;
    if (typeof u === "number") return u;
    if (u.wall != null) return S.halfW + 1.6 + Number(u.wall);
    if (u.apron != null) return -(S.halfW + 9) + Number(u.apron);
    return 0;
  };
  const node = (n) => {
    n = n || {};
    let t = Number(n.t || 0) + Number(n.s || 0) / LEN;
    t -= Math.floor(t);
    const f = CBZ.speedwayFrame(t);
    const u = resolveU(n.u);
    const x = f.x + f.nx * u, z = f.z + f.nz * u;
    return { x: x, y: n.y != null ? Number(n.y) : surfaceY(x, z) + Number(n.h || 0), z: z };
  };
  const tick = (dt) => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    try { CBZ.stepSim(dt || 1 / 60); } catch (_) {}
    try { if (CBZ.player) CBZ.player.hp = 100; } catch (_) {}
  };
  const greyOnVenue = () => {
    let n = 0;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c && c._loaner && !c._loanerClaimed && !c.player) n++;
    }
    return n;
  };

  /* ---- ACTION "leak": twenty starved retries, exactly as the origin makes
     them. Refusing the SEAT is the cheapest honest way to make every attempt
     fail after the car has been built, which is the shape of the real fault
     (the world answers "not yet" somewhere past the point of no return). */
  if (subject.action === "leak" && !S.leaked) {
    try { if (CBZ.cityRaceAbort) CBZ.cityRaceAbort("staging"); } catch (_) {}
    try { if (CBZ.player && CBZ.player.driving && CBZ.cityExitVehicle) CBZ.cityExitVehicle(); } catch (_) {}
    const before = (CBZ.cityCars || []).length;
    const realEnter = CBZ.cityEnterVehicle;
    CBZ.cityEnterVehicle = function () { return false; };
    let started = 0;
    for (let i = 0; i < 20; i++) {
      try { if (CBZ.cityRaceStart({ style: "muscle", number: 99 })) started++; } catch (_) {}
    }
    CBZ.cityEnterVehicle = realEnter;
    // let the collision pass do what it does to twenty cars in one box
    for (let i = 0; i < 90; i++) tick();
    S.leaked = { added: (CBZ.cityCars || []).length - before, grey: greyOnVenue(), started: started };
  }

  /* ---- ACTION "race": and the real opening still runs on this same world. */
  if (subject.action === "race" && !S.raced) {
    // clear the staging litter first on builds that can (the after column);
    // the before column has no sweeper, which is itself part of the picture.
    try { if (CBZ.speedwaySweepLoaners) CBZ.speedwaySweepLoaners(); } catch (_) {}
    try { if (CBZ.cityRaceAbort) CBZ.cityRaceAbort("staging"); } catch (_) {}
    let car = null;
    try { car = CBZ.cityRaceStart({ style: "muscle", number: 99 }); } catch (_) {}
    for (let i = 0; i < 150; i++) tick();      // through the 3.9 s light gantry
    const R = CBZ.speedwayRaceState ? CBZ.speedwayRaceState() : null;
    S.raced = {
      ok: !!car,
      field: R ? ((R.drivers && R.drivers.length) || (R.racers && R.racers.length) || 0) : 0,
      active: !!(R && R.active),
    };
  }

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  const cp = node(subject.cam), ap = node(subject.aim);
  camera.position.set(cp.x, cp.y, cp.z);
  camera.lookAt(ap.x, ap.y, ap.z);
  if (subject.fov) camera.fov = subject.fov;
  camera.updateProjectionMatrix();
  // the sky rig follows the camera at y=0 on a live frame; the loop is frozen
  try {
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    else {
      const rig = CBZ.skyDome && CBZ.skyDome.parent;
      if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
    }
  } catch (_) {}

  // hide every DOM layer but the canvas
  const canvas = CBZ.renderer && CBZ.renderer.domElement;
  for (const child of Array.from(document.body.children)) {
    if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
    if (child.id === "__racerOpeningOverlay") continue;
    child.style.visibility = "hidden";
  }

  CBZ.renderer.render(CBZ.scene, camera);

  const stray = greyOnVenue();
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:26px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:760px";
  q("count").textContent = subject.action === "race"
    ? ("field " + (S.raced ? S.raced.field : 0) + " cars · race " + (S.raced && S.raced.active ? "LIVE" : "REFUSED") + " · stray loaners " + stray)
    : ("20 refused starts → " + stray + " stray loaner" + (stray === 1 ? "" : "s") + " on the venue");
  q("count").style.cssText = `position:absolute;bottom:56px;left:26px;padding:8px 12px;border-radius:8px;background:${stray > 1 ? "#7d2020" : "#17492f"};font-size:15px;font-weight:800;letter-spacing:.02em`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    leaked: S.leaked ? S.leaked.added : null,
    metrics: {
      strayLoaners: stray,
      leakedCars: S.leaked ? S.leaked.added : 0,
      fieldCars: S.raced ? S.raced.field : 0,
    },
  };
}

export default {
  id: "racer-opening",
  title: "The Racer Origin: One Loaner, Not Twenty",
  description:
    "The same checkout on both sides — the before column boots with cfg_RACE_START_V2=0, the fix's own one-line revert, so the only variable is the guard on the grid start. Each column makes the racer origin's pending-start call twenty times with the seat refused (what six seconds of a starved retry loop does) and then photographs the grid. Subject 04 runs the real opening afterwards, because a grid that is clean because nothing races on it is not a fix.",
  defaultBefore: "local",
  beforeParams: { cfg_RACE_START_V2: 0 },
  beforeLabel: "BEFORE · RACE_START_V2 OFF",
  afterLabel: "AFTER · GUARDED GRID START",
  viewport: { width: 1120, height: 690 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metrics: {
    strayLoaners: { label: "Stray grey cars on the venue", better: "lower" },
    leakedCars: { label: "Cars leaked by 20 refused starts", better: "lower" },
    fieldCars: { label: "Championship cars on the grid", better: "higher" },
  },
  subjects,
  stage: stageRacerOpening,
};
