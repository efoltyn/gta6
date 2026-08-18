/* Bomb Survivor's opening minute, photographed against its own broken self.

   THE REPORT WAS FOUR SENTENCES: "the plane is floating, there's no bombs,
   the other planes aren't real, it's nothing like Gang City." Three of the
   four turned out to be one cascade, and this preset is that cascade on
   camera — the same checkout on both sides, with the three one-line reverts
   flipped off on the before side so the ONLY variable is the repair:

     cfg_PLANE_SEATING_V1=0   studio.fly() stops reconciling the airframe's
                              origin with the model's, so the flown model
                              rides gearHeight high — the float itself.
     cfg_BOMB_TAKEOFF_V1=0    the page spawns with place(...,64), putting 64
                              RADIANS of pitch on a B-2 that meant 64 m/s,
                              and the takeoff roll goes back to ending only
                              if the player pulls the stick.
     cfg_AIRFRAME_ROTATE_V1=0 airframe.js goes back to dragging pitch to zero
                              whenever the gear is down at any speed, so
                              nothing can rotate on its mains.

   Why those three together are the honest before: they are the three commits
   under test and nothing else. A comparison against the deployed build would
   differ by every other change since deploy.

   THE PICTURES ARE THE ARGUMENT. Subject 1 is frame one at the holding point
   and it settles "floating" on its own — before, the wheels hang in the air
   over the tarmac; after, they are on it. Subjects 2-4 are the same
   simulated seconds on both sides, driven by CBZ.stepSim with the rAF clock
   stopped, so neither side gets more time than the other on a software
   rasterizer. Nobody touches the controls in 2 and 3: the question is whether
   the aeroplane flies itself off, because the old one could not and every
   verb in the game sits behind that. Subject 4 presses DROP.

   THE NUMBERS ARE SAMPLED, NOT ASSERTED. wheelGapM is the distance from the
   model's own lowest geometry down to the ground under it — the float in
   metres. rollingGate is 1 while stepBomber is still inside the `rolling`
   branch, which is the branch that returns above every verb in the game, so
   it doubles as "can this player do anything at all". storesAway counts real
   releases through systems/ordnance.js, which is the "there's no bombs"
   claim as a countable. */

const subjects = [
  {
    id: "brakes-off",
    label: "Frame one — the holding point",
    focus: "The B-2 as the match starts, from the game's own chase camera. Before: the aeroplane hangs in the air over its own runway at 67 degrees nose-up with the velocity zeroed. After: three wheels on the concrete, level, with takeoff speed already on the clock.",
    atSec: 0,
  },
  {
    id: "rotate",
    label: "Rotation — 5 simulated seconds, hands off",
    focus: "Nobody has touched the controls on either side. After: through Vr with the nose coming up and runway still ahead. Before: still pinned to the deck, because the attitude leveller runs at every speed and nothing but a player's stick could ever end the roll.",
    atSec: 5,
    strip: { frames: 4, stepSec: 1.2 },
  },
  {
    id: "airborne",
    label: "Climb-out — 10 simulated seconds, hands off",
    focus: "The roll gate should be open by now and the role line should read YOU BOMB. Before, it still says FULL POWER · ROTATE and will say it until the runway runs out from under the aeroplane and the terrain drops away.",
    atSec: 10,
  },
  {
    id: "stores-away",
    label: "DROP pressed, over Gang City's own downtown",
    focus: "The verb the game is named for. Every read of the DROP button lives BELOW the return in the rolling branch, so on the before side pressing it does nothing at all — that is what 'there's no bombs' was. The city underneath is city/towngen.js and the one shell mint, the same fabric the mainland is made of.",
    atSec: 26,
  },
];

async function stageBombSurvivor(input) {
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return { ok: false, missing: "CBZ/THREE" };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 200);
    }
    return false;
  };

  const S = (window.__bombStage = window.__bombStage || {});

  // ---- ONE BOOT PER SIDE. Subjects run in declaration order inside a single
  //      page, so the world, the cast and the clock are built once and each
  //      later subject advances the SAME live match.
  if (!S.booted) {
    const ok = await until(function () {
      const st = document.getElementById("st");
      return st && st.textContent === "READY";
    }, 540000, 500);
    if (!ok) return { ok: false, missing: "page never reached READY" };

    // count real releases through the shared integrator, by owner
    S.stores = 0;
    const stick = CBZ.ordnance.stick;
    CBZ.ordnance.stick = function (o) {
      if (o && o.owner === "talon0") S.stores += (o.count || 1);
      return stick.call(CBZ.ordnance, o);
    };

    document.getElementById("go").click();
    // let the match spawn its cast on the page's own rAF, then take the clock
    await until(function () {
      return (CBZ.ordnance.targets || []).some(function (t) { return t.unit && t.unit.human; });
    }, 60000, 100);
    await wait(400);

    // THE rAF CLOCK STOPS HERE and CBZ.stepSim is the only time either side
    // gets. On a software rasterizer the two builds would otherwise be
    // photographed at whatever framerate each happened to manage, which is
    // not a comparison.
    if (CBZ.micro && CBZ.micro.stop) CBZ.micro.stop();
    S.sim = 0;
    S.step = function (seconds) {
      const dt = 1 / 60;
      let n = Math.max(0, Math.round(seconds / dt));
      while (n-- > 0) { CBZ.stepSim(dt); S.sim += dt; }
    };

    // the half-time card is a full-screen scrim; it hides the thing being
    // photographed and says nothing this report needs
    const swap = document.getElementById("swap");
    if (swap) swap.style.display = "none";
    const gate = document.getElementById("gate");
    if (gate) gate.style.display = "none";

    S.me = function () {
      const t = (CBZ.ordnance.targets || []).find(function (t) { return t.unit && t.unit.human; });
      return t ? t.unit : null;
    };

    // studio.setWorld() publishes the page's own terrain function here, so
    // height is measured against the ground the GAME thinks it is over
    S.groundAt = function (x, z) {
      return (CBZ.world && typeof CBZ.world.groundAt === "function")
        ? CBZ.world.groundAt(x, z) : 0;
    };

    /* THE FLOAT AS A NUMBER THAT STAYS TRUE IN THE AIR.

       The obvious measure — lowest geometry above the ground — is the float
       only while the wheels are down; once the aeroplane climbs it is just
       altitude, and a metric that turns into a different quantity halfway
       through the report is worse than none.

       systems/airframe.js has a well-defined answer at any altitude: it
       treats af.pos as a point gearHeight ABOVE the wheels, so the model's
       lowest geometry is SUPPOSED to sit at (pos.y - gearHeight), on the
       runway and at 300 m alike. The distance between where the wheels are
       drawn and where the airframe believes they are is the defect itself,
       it is constant, and it does not care how high the aeroplane is. */
    S.seatError = function (u) {
      if (!u || !u.group || !u.af) return null;
      u.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(u.group);
      if (!isFinite(box.min.y)) return null;
      const wheelLine = u.af.pos.y - (u.af.spec.gearHeight || 0);
      return Math.round(Math.abs(box.min.y - wheelLine) * 100) / 100;
    };

    // nose attitude, degrees, +ve nose-up — 64 rad of pitch reads as 67 here
    S.pitchDeg = function (u) {
      if (!u || !u.af) return 0;
      const e = new THREE.Euler().setFromQuaternion(u.af.quat, "YXZ");
      return Math.round(e.x * 180 / Math.PI * 10) / 10;
    };

    S.metrics = function () {
      const u = S.me();
      if (!u) return {};
      const err = S.seatError(u);
      const gy = S.groundAt(u.af.pos.x, u.af.pos.z);
      return {
        seatErrorM: err == null ? 0 : err,
        pitchDeg: S.pitchDeg(u),
        speedMs: Math.round(u.af ? u.af.speed : 0),
        aglM: Math.round((u.af ? u.af.pos.y : 0) - gy),
        rollingGate: u.rolling ? 1 : 0,
        storesAway: S.stores,
      };
    };

    S.render = function () {
      if (CBZ.renderer && CBZ.scene && CBZ.camera) CBZ.renderer.render(CBZ.scene, CBZ.camera);
    };
    // the runner awaits this before the compositor barrier, so a frame that
    // was advanced after the last render cannot be photographed stale
    window.__cbzVisualCompare = window.__cbzVisualCompare || {};
    window.__cbzVisualCompare.render = S.render;
    // film strips advance the SAME frozen simulation on both sides
    window.__cbzVisualCompare.advance = function (sec) { S.step(sec); S.render(); };
    window.__cbzVisualCompare.metrics = function () { return S.metrics(); };

    S.booted = true;
  }

  const target = input.subject && input.subject.atSec != null ? input.subject.atSec : 0;
  if (target > S.sim) S.step(target - S.sim);

  // DROP is pressed exactly once, on the last subject, through the same key
  // the surface maps it to — not by calling the page's private function, so
  // the before side gets to fail the way a player experiences it.
  if (input.subject && input.subject.id === "stores-away" && !S.dropped) {
    S.dropped = true;
    const down = new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true });
    window.dispatchEvent(down); document.dispatchEvent(down);
    S.step(1 / 60);
    const up = new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true });
    window.dispatchEvent(up); document.dispatchEvent(up);
    S.step(1.6);                       // let the first stores clear the bay
  }

  S.render();

  const u = S.me();
  return {
    ok: true,
    simSeconds: Math.round(S.sim * 10) / 10,
    role: (document.getElementById("role") || {}).textContent || "",
    position: u && u.af ? { x: Math.round(u.af.pos.x), y: Math.round(u.af.pos.y), z: Math.round(u.af.pos.z) } : null,
    metrics: S.metrics(),
  };
}

export default {
  id: "bomb-survivor-takeoff",
  page: "games/bomb-survivor.html",
  title: "Bomb Survivor: The Floating Plane and the Bombs That Never Came",
  description:
    "The same checkout on both sides. The before build boots with the three one-line reverts off — cfg_PLANE_SEATING_V1=0, cfg_BOMB_TAKEOFF_V1=0, cfg_AIRFRAME_ROTATE_V1=0 — so the only variable is the takeoff repair. The rAF clock is stopped after the match spawns and CBZ.stepSim is the only time either side gets, which is the only way two software-rasterized builds are photographed at the same moment. Nobody touches the controls until the last subject.",
  defaultBefore: "local",
  beforeParams: { cfg_PLANE_SEATING_V1: 0, cfg_BOMB_TAKEOFF_V1: 0, cfg_AIRFRAME_ROTATE_V1: 0 },
  beforeLabel: "BEFORE · REVERTS OFF (the reported build)",
  afterLabel: "AFTER · TAKEOFF REPAIR",
  viewport: { width: 1180, height: 700 },
  // ?airport=0 drops Halloran Field from BOTH sides: it is a third island the
  // aeroplane never touches on this route and it costs a large share of a
  // boot that already runs under software WebGL.
  urlParams: { airport: 0, seed: "talloran" },
  readyExpression: "!!document.getElementById('go')",
  // the first subject pays the whole world build — the real military island,
  // the real downtown, and the settle pass over ~18k colliders
  stageTimeoutMs: 900000,
  pairNote: "Same checkout · same seed · same world · same simulated seconds — the three revert flags are the variable",
  method:
    "Both sides are THIS checkout served by the same local server, booted with ?airport=0&seed=talloran. The before side additionally carries cfg_PLANE_SEATING_V1=0, cfg_BOMB_TAKEOFF_V1=0 and cfg_AIRFRAME_ROTATE_V1=0, which are the three repairs' own one-line reverts. After the match spawns its cast the rAF loop is stopped and every later frame is CBZ.stepSim(1/60), so both builds are photographed at identical simulated seconds rather than at whatever framerate each managed. Subjects 1-3 receive no control input at all; subject 4 presses the DROP key through the same event a keyboard player sends. Every number is read off the live aeroplane at the instant of the photograph.",
  metricsNote:
    "seatErrorM is the float itself, stated so it stays the same quantity at 300 m as on the runway: airframe.js treats af.pos as a point gearHeight above the wheels, so the model's lowest geometry is supposed to sit at (pos.y - gearHeight), and this is how far off it actually is. pitchDeg is the nose attitude — the old spawn put 64 into place()'s PITCH argument meaning 64 m/s, and 64 radians is 67 degrees of nose-up; the figure photographed is lower than that because the ground contact's attitude leveller has already clawed some of it back in the frames between spawn and the first capture. Airspeed carries no better/worse direction on purpose: the repaired aeroplane is climbing and trading speed for height, so scoring it against a build still skimming the deck at full power would only cry wolf. rollingGate is 1 while stepBomber is still inside the `rolling` branch; that branch returns above the DROP read, the NUKE read and the bombsight, so while it is 1 the player has no game at all, only a taxiing aeroplane. storesAway counts stores actually released through systems/ordnance.js after the DROP key is pressed — the 'there's no bombs' report as a countable.",
  metrics: {
    seatErrorM: { label: "Wheels drawn off the airframe's own wheel line", unit: "m", better: "lower" },
    pitchDeg: { label: "Nose attitude", unit: "deg" },
    speedMs: { label: "Airspeed", unit: "m/s" },
    aglM: { label: "Height above ground", unit: "m", better: "higher" },
    rollingGate: { label: "Still stuck in the takeoff roll", unit: "1=yes", better: "lower" },
    storesAway: { label: "Stores released on DROP", unit: "bombs", better: "higher" },
  },
  subjects,
  stage: stageBombSurvivor,
};
