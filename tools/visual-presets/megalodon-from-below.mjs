/* MEGALODON FROM BELOW — THE ATTACK YOU DO NOT SEE COMING.

   Owner's brief, in his own words: "you look around at surface and don't see
   any sharks but then dive and look down and a megladon is attacking from
   under you." With the reference photograph — the prey's-eye view, jaws open,
   coming up out of the blue.

   THIS IS A SAME-CHECKOUT FLAG A/B. Both columns boot the SAME build of the
   SAME seeded city, put the SAME diver in the SAME water column, and drop the
   SAME megalodon in the dark underneath. The only difference between them is
   one query parameter: the BEFORE column sets cfg_SHARK_ASCENT=0 and therefore
   runs the pre-wave code path byte for byte.

   WHAT THE BEFORE COLUMN IS
   -------------------------
   Not a strawman — the shipped behaviour, and it is worth stating precisely
   because it is easy to miss by reading the code:

     * city/wildlife_shark.js answered "how deep am I?" with a per-state
       constant times the animal's own draft, measured FROM THE WATERLINE.
       Nothing in the shark's brain had ever asked where its quarry was in the
       water column. (city/wildlife_orca.js has matched its quarry's depth for
       years — the capability existed, it was simply never wired to the shark.)
     * systems/predator.js closed its rush on Math.hypot(dx, dz). Horizontal.
       So a megalodon fifteen metres directly below a diver scored dist ~= 0
       and bit, without ever needing to rise.
     * The one place that DID read the quarry's depth was strikeWants(), the
       breach gate — and it read it only to REFUSE: `if (qs - qp.y > draft *
       0.55 + 1.4) return false`. The attack-from-below was not unimplemented,
       it was specifically excluded for exactly the case the owner described.

   Measured on this staging with the flag off: the megalodon never climbs
   (0.0 m/s), and it finishes the pass 4.6 m ABOVE the diver — between him and
   the surface light, which is precisely backwards.

   WHAT THE AFTER COLUMN IS
   ------------------------
   §THE ASCENT in city/wildlife_shark.js. The staging depth is measured from
   the QUARRY (for a quarry at the surface it collapses to the old constant, so
   nothing about the great-white-off-the-beach read changes), and the rush
   becomes a solved climb re-solved every frame to arrive with the charge.
   Measured: 22 m of climb, peaking at 14.6 m/s, nose up 28 degrees, arriving
   0.2 m from the diver's own depth and holding there.

   NOTHING IS POSED. There is no keyframe, no tween and no scripted camera move
   anywhere in this file. Every capture is the live game's own screen, advanced
   with CBZ.stepSim so a beat is a number of GAME seconds rather than a number
   of rasterised frames, with the megalodon driven by the production
   predatorHunt FSM. The body's pitch is read back out of its own velocity
   (atan2(vy, hv)) rather than authored, which is what `pitchDeg` in the table
   is there to keep honest.

     node tools/before-after.mjs megalodon-from-below
     node tools/megalodon-below-probe.mjs            (the same staging, no PDF)
*/

const subjects = [
  {
    id: "surface-scan",
    label: "1 · At The Surface, Looking Around · Nothing",
    focus: "The diver on the surface, turning to look at the sea around him. This frame is supposed to be EMPTY and it is empty on both sides — that is the point of including it. The megalodon is already there, already hunting him, forty metres down. What the two columns disagree about is not what you can see here; it is what is underneath you while you see nothing.",
  },
  {
    id: "look-down",
    label: "2 · Dive, And Look Down",
    focus: "The same diver, fifteen metres under, lens pointed at the seabed. BEFORE: the megalodon's depth is a constant off the WATERLINE and takes no notice of the diver at all, so it is level with him or above him — you are looking down at empty water while the animal is between you and the light. AFTER: its staging depth is measured from the quarry, so it is where an ambush predator belongs — underneath, in the dark, looking up at your silhouette.",
  },
  {
    id: "the-climb",
    strip: { frames: 6, stepSec: 0.32 },
    label: "3 · The Ascent · Six Frames Of A Solved Climb",
    focus: "1.3 s of the same rush on both sides, same inputs, same seconds. BEFORE: there is no climb to film — the rush is a torpedo run at a fixed depth off the waterline and the strip shows the animal holding its level. AFTER: an acceleration solved every frame from the climb remaining, the gap remaining and the speed it is actually making, so it arrives with its own charge. The nose angle is not animated: it is atan2(vertical speed, horizontal speed), the same expression the ballistic breach uses.",
  },
  {
    id: "prey-eye",
    label: "4 · The Reference Photograph · Jaws, From Underneath",
    focus: "The owner's picture: the prey's-eye view, mouth open, filling the frame from below. Both columns show a gape here and that is the honest result — the old code bites you perfectly well, it simply never comes UP to do it, so read the ATTITUDE rather than the mouth. BEFORE: level, the head square-on, arriving out of the horizontal. AFTER: nose-up through the whole approach, the upper jaw protruded and the underside of the head presented, because the body is climbing (climbMS 11.6 vs 0.0, pitchDeg 28.6 vs 0.0 in the table). The gape itself is written ON the climb — docs/SHARK-REFERENCE.md §1, the gape IS the photograph — so the teeth arrive with the animal rather than after it.",
  },
  {
    id: "arrival",
    label: "5 · Where The Attack Actually Ends Up",
    focus: "The last beat, and the numbers that decide whether any of this was real. Both columns are stepped the same fixed 2.2 s from the same commit, and the extrema are tracked across it. BEFORE: no climb at any point (peak 0.0 m/s), and the animal ends the pass ABOVE the diver — it drifted up past him because its depth was never about him in the first place. AFTER: a solved climb out of the dark, arriving at the diver's own depth and HOLDING there while the bite lands, instead of being pulled straight back down to its staging depth mid-strike.",
  },
];

async function stageMegFromBelow(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // One deterministic stream on both sides.
  Math.random = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20260830);

  let D = window.__megBelow;
  if (!D) {
    const until = async (fn, ms, every) => {
      const end = Date.now() + (ms || 60000);
      while (Date.now() < end) { try { if (fn()) return true; } catch (e) {} await sleep(every || 200); }
      return false;
    };
    if (!await until(() => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
      CBZ.stepSim && document.getElementById("playBtn"), 300000)) return { ok: false, error: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    if (!await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300)) return { ok: false, error: "never reached playing" };
    /* Headless SwiftShader settles on the LOW tier, which halves the water
       view distance; and a dusk capture on one side would be a colour
       difference we did not make. Pin both before anything is photographed. */
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
    try { if (CBZ.dayPhase) CBZ.dayPhase(0.25); } catch (e) {}
    /* HOLSTER, ON BOTH COLUMNS. The first-person weapon is a camera-child
       viewmodel, so it is in the scene rather than in the HUD and the
       stylesheet above cannot touch it — it sat across the bottom-right of
       every underwater frame, including the one shot this whole report exists
       for. Worse, it was ASYMMETRIC: the two sides run different numbers of
       simulated seconds and had ended up holding different things, so the
       columns differed by a rifle as well as by the flag. `cityHolstered` is
       the same seam city/cinematics.js uses to disarm the player for an
       authored scene. */
    if (CBZ.game) CBZ.game.cityHolstered = true;
    /* AND NOBODY DROWNS. city/swim.js's breath meter drives a darkening
       vignette, and this report holds a diver underwater for as long as each
       column's beat happens to take — which is not the same length on both
       sides, because several subjects step until an EVENT that only one column
       ever produces. The result was a film strip whose BEFORE row was navy and
       whose AFTER row was bright blue: pure elapsed-time leakage, dressed up as
       a rendering difference. Pinning the sun was not enough; this is the other
       half of the same problem. Off on BOTH columns. */
    if (CBZ.CONFIG) CBZ.CONFIG.WATER_BREATH = false;

    D = window.__megBelow = {
      step(n) {
        for (let i = 0; i < n; i++) {
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          if (CBZ.game) CBZ.game.cityHolstered = true;   // re-asserted: the game re-arms itself
          /* AND THE SUN IS PINNED, every tick, for the same reason.
             Several subjects step until an EVENT rather than for a fixed
             count, and the event happens on one column and never on the other
             — so the BEFORE side can spend ten more simulated seconds in the
             same beat. Ten seconds of day/night is a visibly different sea:
             the first strip that came out of this had a navy BEFORE row above
             a bright blue AFTER row, which reads as a rendering change and is
             nothing of the kind. Re-asserting noon makes elapsed time stop
             showing up in the pixels. */
          try { if (CBZ.dayPhase) CBZ.dayPhase(0.25); } catch (e) {}
          CBZ.stepSim(1 / 30);
        }
      },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      /* THE COAST IS FOUND, NEVER TYPED — the same bisection
         underwater-look.mjs uses, so the recipe survives a seed change. */
      findWater() {
        const Z = -300, wf = CBZ.waterField;
        if (!wf || !wf.shoreAt) return null;
        let inner = null, outer = null;
        for (let x = 0; x < 16000; x += 40) {
          const s = wf.shoreAt(x, Z);
          if (s > 0) inner = x; else if (inner != null) { outer = x; break; }
        }
        if (outer == null) return null;
        let a = inner, b = outer;
        for (let i = 0; i < 26; i++) { const m = (a + b) / 2; if (wf.shoreAt(m, Z) > 0) a = m; else b = m; }
        let best = null, bestD = -1;
        for (let off = 300; off < 4000; off += 60) {
          const x = b + off;
          const d = CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(x, Z) : 0;
          if (d > bestD) { bestD = d; best = x; }
          if (d >= 60) { best = x; bestD = d; break; }
        }
        return { x: best, z: Z, column: bestD };
      },
      /* Put the DIVER at a depth and leave him there. citySwimBegin is the
         same seam underwater-look.mjs uses. Deliberately NOT Shark Sim: the
         player there is mounted, a mounted shark must keep swimming, and the
         whole hunt gets photographed with the "diver" leaving at 22 m/s. */
      diveTo(depth) {
        const P = CBZ.player, W = D.water;
        const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(W.x, W.z) : 0;
        const y = surf - depth;
        P.pos.set(W.x, y, W.z);
        if (CBZ.citySwimBegin) CBZ.citySwimBegin({ y: y });
        P.hp = 100;
        D.holdX = W.x; D.holdZ = W.z; D.holdY = y;
        D.sec(0.6);
        return surf - P.pos.y;
      },
      /* HE IS TREADING WATER, NOT SINKING — and this is a fairness fix before
         it is a staging one. A swimmer left alone drifts down, so the two
         columns only stay comparable while they spend the SAME simulated
         seconds; and they do not, because several subjects step until an EVENT
         (the climb beginning) that happens on one side and never on the other.
         Measured on the first run: the BEFORE diver had sunk to 21.4 m by its
         capture while the AFTER diver was still at 15.5 m, so the two frames
         were taken at different depths in different light and the megalodon's
         own target depth differed with them. Holding the diver where he was
         put makes elapsed time stop mattering. It is also what a person
         looking down actually does. */
      hold() {
        if (D.holdY == null) return;
        const P = CBZ.player;
        /* PIN X AND Z TOO, not just depth. Holding only the depth still let
           the diver drift across the seabed, and the underwater grade is a
           function of the water COLUMN at the eye — so the column that spent
           ten extra seconds waiting for an event it never got had wandered
           into deeper, darker water, and its whole row of the film strip came
           back navy against the other's blue. Treading water means staying
           put. */
        P.pos.x = D.holdX; P.pos.z = D.holdZ; P.pos.y = D.holdY;
        if (P.vy != null) P.vy = 0;
      },
      stepHold(n) { for (let i = 0; i < n; i++) { D.hold(); D.step(1); } D.hold(); },
      secHold(sc) { D.stepHold(Math.max(1, Math.round(sc * 30))); },
      /* THE LENS. The subject says which way to LOOK (+1 up at the surface,
         -1 down at the bed) and the sign that produces it is CALIBRATED
         against the camera's own forward vector rather than trusted from a
         convention — this repo's camera notes record the vertical response
         inverting once already, and a preset that photographs the seabed while
         its caption says "looking up" is a lie that still passes. */
      aim(yaw, wantUp, mag) {
        const set = (p) => {
          if (CBZ.cam) { CBZ.cam.yaw = yaw; CBZ.cam.pitch = p; }
          if (CBZ.fps) CBZ.fps.fp = p;
        };
        if (CBZ.setFPS) CBZ.setFPS(true);
        const m = mag == null ? 1.15 : mag;
        set(m * wantUp);
        /* HELD steps, not raw ones. Aiming the lens costs a few frames, and a
           few frames is enough for a megalodon with the diver in its jaws to
           tow him several metres deeper — which is exactly what happened: the
           BEFORE column's strip came back photographed from 18.2 m while the
           AFTER column's was taken at 10.4 m, so one row of the film strip was
           visibly darker than the other for a reason that had nothing to do
           with the flag under test. */
        D.stepHold(3);
        if (Math.sign(D.fwd().y || 0) !== Math.sign(wantUp)) { set(-m * wantUp); D.stepHold(3); }
        D.hold();
        return +D.fwd().y.toFixed(3);
      },
      fwd() {
        const e = CBZ.camera.matrixWorld.elements;
        return { x: -e[8], y: -e[9], z: -e[10] };
      },
      /* THE MEGALODON, and nothing else with teeth. */
      meg() {
        for (const w of CBZ.cityWildlife || []) if (w && w.__mfb && !w.dead) return w;
        return null;
      },
      spawnMeg() {
        const P = CBZ.player;
        /* THIS BEAT IS ABOUT THE PLAYER BEING HUNTED, NOT ABOUT THE FOOD WEB.
           marine_predation.js gets first refusal on every aquatic actor and it
           wins: left on, it hands this megalodon a fish hundreds of metres
           away and drives it off across the map, and the hunt this report
           exists to photograph never runs at all (measured: gapM 435, with the
           quarry up at the surface). Off on BOTH columns identically. */
        if (CBZ.CONFIG) CBZ.CONFIG.MARINE_PREDATION = false;
        let m = D.meg();
        if (!m && CBZ.cityWildlifeSpawnAt) {
          m = CBZ.cityWildlifeSpawnAt("megalodon", P.pos.x + 40, P.pos.z + 10);
          if (m) m.__mfb = 1;
          // wildlife.js builds meshes on a per-tick budget; an unbuilt group is
          // an empty Object3D and every measurement off it is garbage.
          for (let t = 0; t < 60 && m && m.group && !m.group.children.length; t++) D.step(4);
        }
        return m;
      },
      /* Stage it in the dark underneath, pointed at the diver, and commit the
         REAL FSM. The heading is not a cheat: a rush is the last beat of
         scent -> circle -> commit, so a committing shark has been orbiting its
         quarry and is already bow-on. Dropped in cold at a spawn heading it
         starts ~150 degrees off, and a 20 m body turning at 0.69 rad/s while
         making 18 m/s has a ~27 m turn radius — it physically cannot come
         round onto something 45 m away before the rush times out, which
         photographs the turn circle instead of the ambush. */
      stage(underM, gapM) {
        const P = CBZ.player, m = D.meg();
        if (!m || !m.group) return null;
        const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : 0;
        const col = CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(P.pos.x, P.pos.z) : 60;
        const pd = surf - P.pos.y;
        const y = surf - Math.min(col - 6, pd + underM);
        const brg = Math.PI;                    // comes at him from +x
        m.pos.x = P.pos.x + Math.cos(brg + Math.PI) * gapM;
        m.pos.z = P.pos.z + Math.sin(brg + Math.PI) * gapM;
        m.pos.y = y;
        m.group.position.set(m.pos.x, y, m.pos.z);
        if (m._waterMove) { m._waterMove.x = m.pos.x; m._waterMove.z = m.pos.z; }
        if (m._shark) { m._shark.dive = surf - y; m._shark.bail = 0; }
        m.heading = Math.atan2(P.pos.z - m.pos.z, P.pos.x - m.pos.x);
        if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m.group, m.heading);
        m.hunger = 1;
        /* A CLEAN HUNT EVERY TIME. The subjects run in sequence inside ONE
           page, on ONE megalodon, so everything predatorHunt remembers between
           passes — the cooldown, the pass count, the menace gauge, an
           unfinished seize — is still there when the next subject stages. That
           is exactly right for gameplay (it is the anti-habituation mechanism)
           and exactly wrong for a report, where every beat has to start from
           the same place or the columns are comparing accumulated history
           instead of the flag. Caught it in a run where `the-climb` scored
           climbBegan=0 on BOTH sides: predatorCommit refuses outright while
           `h.st === "seize"`, so the third subject inherited the second one's
           grip and never rushed at all.
           Note this is a RESET, not a disengage — predatorDisengage
           deliberately preserves menace and commits, which is the opposite of
           what staging needs. */
        if (CBZ.player) { CBZ.player._seizedBy = null; CBZ.player.hp = 100; }
        m._seizing = null;
        m._atkAnim = -1;
        m._lungeAmt = 0; m._lungeCap = null; m._atkYOff = 0;
        const sh = m._shark;
        if (sh) { sh.asc = 0; sh.air = 0; sh.ascOut = 0; sh.ascHold = 0; sh.bail = 0; sh.hv = 0; }
        m.group.rotation.z = 0; m.group.rotation.x = 0;
        const h = m._hunt;
        if (h) { h.st = "cruise"; h.cool = 0; h.passes = 0; h.t = 0; h.menace = 1; h.struck = false; h.dropped = false; h.seizeWait = false; }
        const took = CBZ.predatorCommit ? CBZ.predatorCommit(m, CBZ.player) : false;
        D.committed = took ? 1 : 0;
        return m;
      },
      read() {
        const m = D.meg();
        if (!m) return { committed: D.committed == null ? null : D.committed };
        const R = CBZ.sharkAscentRead ? CBZ.sharkAscentRead(m) : null;
        const A = CBZ.sharkAscentAudit ? CBZ.sharkAscentAudit() : {};
        const P = CBZ.player;
        const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : 0;
        return {
          diverDepthM: +(surf - P.pos.y).toFixed(2),
          megDepthM: R ? R.depthM : null,
          belowQuarryM: R ? R.belowQuarryM : null,
          gapM: R ? R.gapM : null,
          climbing: R ? R.climbing : 0,
          climbMS: R ? R.vyMS : 0,
          pitchDeg: R && R.climbing ? R.pitchDeg : 0,
          huntState: R ? R.state : null,
          ascents: A.ascents || 0,
          lastClimbM: A.lastClimbM || 0,
          committed: D.committed == null ? null : D.committed,
          camDepthM: CBZ.cityCameraDepth ? +CBZ.cityCameraDepth().toFixed(2) : null,
          fogFarM: CBZ.scene && CBZ.scene.fog ? +CBZ.scene.fog.far.toFixed(1) : null,
          columnAtEyeM: CBZ.cityWaterDepthAt ? +CBZ.cityWaterDepthAt(P.pos.x, P.pos.z).toFixed(1) : null,
        };
      },
      // Keep the megalodon on screen for the strip without ever moving the
      // body: the diver simply keeps looking at it.
      faceMeg(wantUp) {
        const m = D.meg(), P = CBZ.player;
        if (!m || !m.group) return;
        const yaw = Math.atan2(-Math.cos(Math.atan2(m.group.position.z - P.pos.z, m.group.position.x - P.pos.x)),
          -Math.sin(Math.atan2(m.group.position.z - P.pos.z, m.group.position.x - P.pos.x)));
        D.aim(yaw, wantUp, 0.95);
      },
    };

    window.__cbzVisualCompare = {
      /* Awaited before every capture. Under SwiftShader the compositor takes
         over a second to PRESENT a rendered canvas; a shorter barrier
         photographs the PREVIOUS composite. */
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const raf = D._raf;
        if (raf) await new Promise((res) => raf.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
        else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 1200));
      },
      // Film strips step the REAL match, then re-aim, because the whole claim
      // of the climb strip is that a body moves.
      advance(sec) { D.secHold(sec); if (D.track) { try { D.track(); } catch (e) {} } },
    };

    // From here CBZ.stepSim is the only clock.
    D._raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function () { return 0; };
    await new Promise((res) => D._raf.call(window, () => res()));
    await sleep(400);
    D.step(60);

    D.water = D.findWater();
    if (!D.water) return { ok: false, error: "no navigable coast on this seed" };
    /* THE CHROME GOES, THE WATER STAYS.
       `#hud` alone is not enough and the first run proved it: the character
       card, the minimap, the heart row, the hotbar and the money counter are
       all siblings of #hud, so hiding it left two thirds of the frame dressed
       and the megalodon competing with a rifle model for attention. Hide every
       direct child of <body> EXCEPT the canvas mount (#game) and the elements
       world/water_underwater.js creates for the medium itself — the tint, the
       light rays, the meniscus and the breath warning ARE the underwater look
       and this preset would be lying without them.
       An inline style loses here: the HUD rewrites its own `display` every
       frame. A stylesheet !important rule is the one thing it cannot beat. */
    const KEEP = ["game", "cbzUnderwater", "cbzBreathWarn"];
    const st = document.createElement("style");
    st.textContent =
      "body > *{display:none !important}" +
      KEEP.map((k) => "body > #" + k + "{display:block !important}").join("") +
      "#hud,#crosshair,#ammo,#weaponStrip,#vignette{display:none !important}";
    document.head.appendChild(st);
    D.keepUI = KEEP;
  }

  if (!D.water) return { ok: false, error: "no water" };
  D.track = null;
  const out = {};

  if (sub.id === "surface-scan") {
    // AT the surface — the way you float before you dive.
    out.eyeDepthM = +D.diveTo(0.9).toFixed(2);
    D.spawnMeg();
    D.stage(30, 30);
    D.secHold(0.6);
    // looking OUT across the sea, level, the way you scan a horizon
    out.lookY = D.aim(0.0, -1, 0.05);
    D.secHold(0.4);
    const r = D.read();
    Object.assign(out, r);
    out.megDepthAtScanM = r.megDepthM;
    out.stagedBelowM = r.belowQuarryM;
  } else if (sub.id === "look-down") {
    /* THE LURK, NOT THE CLIMB. First run caught this beat 1.2 s in, by which
       time the AFTER column's ascent had already run and the animal was nearly
       level with the diver — so the headline metric read WORSE on the side
       that fixed it. This subject's job is the moment before anything happens:
       you look down and it is under you. The climb has its own subject. */
    out.eyeDepthM = +D.diveTo(10).toFixed(2);
    D.spawnMeg();
    D.stage(17, 26);
    D.secHold(0.35);
    /* READ THE BEAT, THEN AIM THE LENS — in that order, and the order matters.
       This subject's claim is about the STAGING law: where the animal sits
       while it is still just down there. Aiming costs a few frames, and a few
       frames is enough for the AFTER column's ascent to have begun, which
       lifts the animal ~0.24 m and makes the headline number read very
       slightly WORSE on the side that is doing the thing the number is for.
       The picture is still the picture; the measurement belongs to the moment
       the subject is about. */
    Object.assign(out, D.read());
    D.faceMeg(-1);
    out.lookY = +D.fwd().y.toFixed(3);
  } else if (sub.id === "the-climb") {
    out.eyeDepthM = +D.diveTo(10).toFixed(2);
    D.spawnMeg();
    /* FILMED FROM FURTHER OUT, so the strip covers the APPROACH rather than
       the contact. At a 46 m stand-off the run-in is over inside 2.5 s, and a
       6-frame strip then spends most of itself inside the animal's mouth —
       both columns arrive (the old code reaches you too; it simply never
       rises), so the rows ended up equally unreadable close-ups. From 56 m the
       window covers the part where the two behaviours actually differ: one
       comes in level, the other comes up. */
    D.stage(22, 56);
    /* A FIXED TIMELINE, IDENTICAL ON BOTH COLUMNS — and this is the one
       staging decision in the file that took real evidence to get right.

       The obvious design is to step until the climb BEGINS and film from
       there, so the strip always lands on the event. It is also structurally
       broken, because the event is precisely what the two columns disagree
       about: the AFTER side found it in about a second and the BEFORE side
       searched its entire budget and never found it, so one column lived ten
       simulated seconds longer than the other. Everything that then diverged
       diverged for that reason and not for the flag — the diver drifted into a
       deeper column, the sun moved, the breath vignette came on, and finally
       the CAMERA ended up 7.8 m deeper on one side than the other (measured:
       camDepthM 16.59 vs 8.77 with both divers at ~9.9 m). Each of those looked
       like a rendering difference and each was really a clock difference. Three
       separate patches chased three separate symptoms of it.

       So: no search. Both columns stage the same, wait the same, and film the
       same 1.3 s. The AFTER column climbs during that window and the BEFORE
       column does not, which is the entire finding — and now it is the ONLY
       difference between the two rows. */
    D.secHold(0.5);
    const pre = D.read();
    out.climbBegan = pre.climbing ? 1 : 0;
    out.stagedBelowM = pre.belowQuarryM;
    D.track = function () { D.faceMeg(-1); };
    D.track();
    Object.assign(out, D.read());
  } else if (sub.id === "prey-eye") {
    out.eyeDepthM = +D.diveTo(10).toFixed(2);
    D.spawnMeg();
    D.stage(20, 38);
    // Step until it is CLOSE — the money shot is the last few metres, and a
    // fixed clock finds a different distance on each side.
    let best = 1e9;
    for (let i = 0; i < 140; i++) {
      D.stepHold(2);
      const r = D.read();
      const d = (r.gapM == null) ? 1e9 : r.gapM;
      if (d < best) best = d;
      if (d < 13 || (r.belowQuarryM != null && r.belowQuarryM < 4 && d < 20)) break;
    }
    D.faceMeg(-1);
    Object.assign(out, D.read());
    out.closestGapM = +best.toFixed(2);
    out.gapeOpen = D.meg() ? 1 : 0;
  } else if (sub.id === "arrival") {
    out.eyeDepthM = +D.diveTo(10).toFixed(2);
    D.spawnMeg();
    D.stage(22, 40);
    /* A FIXED WINDOW, and the extrema across it — same lesson as the strip
       above. Running "until the pass ends" ended it at different moments on
       the two columns, and photographed the empty water AFTER the animal had
       gone: the money frame of the final subject was two rectangles of blue.
       2.2 s from the commit is the arrival, on both sides, by construction. */
    let closest = 1e9, deepest = -1e9, peakClimb = 0, peakPitch = 0;
    for (let i = 0; i < 33; i++) {
      D.stepHold(2);
      const r = D.read();
      if (r.belowQuarryM != null) {
        if (Math.abs(r.belowQuarryM) < Math.abs(closest)) closest = r.belowQuarryM;
        if (r.belowQuarryM > deepest) deepest = r.belowQuarryM;
      }
      if (r.climbMS > peakClimb) peakClimb = r.climbMS;
      if (r.climbing && r.pitchDeg > peakPitch) peakPitch = r.pitchDeg;
    }
    D.faceMeg(-1);
    const fin = D.read();
    Object.assign(out, fin);
    out.arrivalVerticalM = fin.belowQuarryM == null ? null : +Math.abs(fin.belowQuarryM).toFixed(2);
    out.closestVerticalM = closest === 1e9 ? null : +Math.abs(closest).toFixed(2);
    out.deepestBelowM = deepest === -1e9 ? null : +deepest.toFixed(2);
    out.peakClimbMS = +peakClimb.toFixed(2);
    out.peakClimbPitchDeg = +peakPitch.toFixed(1);
  } else {
    return { ok: false, error: "unknown subject " + sub.id };
  }

  await window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, subject: sub.id,
    debug: {
      mode: CBZ.game.mode, state: CBZ.game.state,
      ascentFlag: !(CBZ.CONFIG && CBZ.CONFIG.SHARK_ASCENT === false),
      columnM: +D.water.column.toFixed(1),
    },
    metrics: out,
  };
}

export default {
  id: "megalodon-from-below",
  title: "Megalodon From Below — The Attack You Do Not See Coming",
  description:
    "The owner's shot, staged in the live game: a diver on the surface who can see nothing, then dives, looks down, and finds a megalodon coming up at him out of the dark. One checkout, one seed, one water column; the BEFORE column sets cfg_SHARK_ASCENT=0 and runs the shipped code path, in which a shark's depth is a constant off the WATERLINE that never once asks where its quarry is — so the pass finishes with the animal ABOVE the diver. The AFTER column measures the staging depth from the quarry and turns the rush into a climb solved every frame to arrive with its own charge.",
  beforeLabel: "BEFORE · cfg_SHARK_ASCENT=0 (same build)",
  afterLabel: "AFTER · §THE ASCENT",
  pairNote: "Same checkout · same seed · same water column · same diver · same megalodon · same simulated seconds",
  method:
    "Both sides boot index.html on the same seed, click through to free play, freeze the frame loop and advance the world only through CBZ.stepSim, so a beat is a number of GAME seconds rather than rasterised frames. The coast is found by bisecting the live shore field (never a typed coordinate) and the diver is put in the water at an authored depth through CBZ.citySwimBegin. A megalodon is spawned in the dark beneath him, pointed at him — the bow-on attitude a shark already has by the time its circle becomes a rush — and handed to the production FSM with CBZ.predatorCommit; everything after that is predatorHunt driving the animal. marine_predation is off on BOTH columns, because with it on the megalodon is given a fish four hundred metres away and the hunt under test never runs. Every number is read from the engine's own seams (CBZ.sharkAscentRead, CBZ.sharkAscentAudit) at the instant of the capture, and the body's pitch is derived from its own velocity rather than authored.",
  defaultBefore: "local",
  urlParams: { seed: "90210", cfg_BOOT_METER: "0" },
  beforeParams: { cfg_SHARK_ASCENT: "0" },
  afterParams: {},
  stageTimeoutMs: 420000,
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')",
  metrics: {
    eyeDepthM: { label: "Diver's depth at capture", unit: "m" },
    diverDepthM: { label: "Diver's depth (engine read)", unit: "m" },
    megDepthM: { label: "Megalodon's depth", unit: "m" },
    megDepthAtScanM: { label: "How deep the megalodon is while you see nothing", unit: "m", better: "higher" },
    belowQuarryM: { label: "Megalodon BELOW the diver (>0 = underneath). Directionless on purpose — see note", unit: "m" },
    stagedBelowM: { label: "STALKING: how far under the diver it stages (deeper = the ambush)", unit: "m", better: "higher" },
    arrivalVerticalM: { label: "ARRIVING: vertical gap left when the teeth get there (0 = it came to your depth)", unit: "m", better: "lower" },
    deepestBelowM: { label: "Deepest it ever sat under the diver (staging readout — both columns stage the same start depth)", unit: "m" },
    closestVerticalM: { label: "Closest vertical approach over the pass (0 = it reached your depth)", unit: "m", better: "lower" },
    gapM: { label: "Horizontal gap to the diver", unit: "m" },
    closestGapM: { label: "Closest it came horizontally (capture-condition readout — this feature is about the VERTICAL)", unit: "m" },
    climbing: { label: "A solved ascent is running right now", better: "higher" },
    climbBegan: { label: "The climb started at all", better: "higher" },
    climbMS: { label: "Vertical speed at capture", unit: "m/s", better: "higher" },
    peakClimbMS: { label: "Peak climb rate over the whole pass", unit: "m/s", better: "higher" },
    pitchDeg: { label: "Nose-up angle while climbing (derived from velocity)", unit: "°", better: "higher" },
    peakClimbPitchDeg: { label: "Peak nose-up angle during the climb", unit: "°", better: "higher" },
    ascents: { label: "Solved ascents begun", better: "higher" },
    committed: { label: "predatorCommit took (a staging check, not a claim)", better: "higher" },
    lastClimbM: { label: "Height of the last climb", unit: "m", better: "higher" },
    huntState: { label: "predatorHunt state at capture" },
    lookY: { label: "Camera forward Y (−1 = straight down), calibrated not assumed" },
    camDepthM: { label: "Camera depth (what the underwater grade is a function of)", unit: "m" },
    fogFarM: { label: "Underwater fog far plane at capture", unit: "m" },
    columnAtEyeM: { label: "Water column under the eye (staging check — must match)", unit: "m" },
    gapeOpen: { label: "The animal has an authored mouth to open" },
  },
  metricsNote:
    "Read off the engine's own measurement seams at the instant of each capture, on both sides, with identical staging and identical simulated seconds.\n\n  WHY `belowQuarryM` CARRIES NO DIRECTION. It is the same measurement at two opposite moments and it wants opposite things at each. While the animal is STALKING, deeper under you is better — that is the ambush, and it is what `stagedBelowM` scores. At the moment it ARRIVES, the number should be near ZERO, because the whole point is that it came up to your depth instead of biting you from the dark; that is what `arrivalVerticalM` scores, and marking the raw number `higher is better` made a megalodon closing from 6.89 m under the diver to 3.96 m read as a REGRESSION. One ambiguous metric was a modelling mistake in this preset, not a finding.\n\n  What the pre-ascent code could never do is either of them on purpose: its depth is a constant off the WATERLINE that never once consults the quarry, so against a diver it drifts and ends the pass ABOVE him — between you and the light, which is exactly backwards.",
  subjects,
  stage: stageMegFromBelow,
};
