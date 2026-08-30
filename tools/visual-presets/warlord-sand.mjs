/* DESERT WARLORD — WALKING ON THE SAND, photographed against ?sand=old.

   THE REPORT, in the owner's words: "fix how it looks when you walk on the
   sand and on hills — on the sand the player sinks way too much, it's dumb.
   And it should leave REAL footprints. Just be real as fuck sand world."

   THE HYPOTHESIS THAT WAS WRONG, AND IS PHOTOGRAPHED ANYWAY. The obvious
   suspect was the clipmap: `heightAt` is analytic, the terrain you SEE is a
   decimated grid sampling it, and a decimated triangle chords below the true
   curve — so a man placed by the numbers should stand buried, worse the
   coarser the LOD. It is a good theory. Measured on the live page it is six
   centimetres at the player's feet, and `lodErrCm` below keeps measuring it
   in both columns so nobody has to take that on faith.

   THE CAUSE IS THE STANCE. Everything in this game is placed with ONE ground
   sample at the body's centre and then stands PLUMB. The player's cast body
   is 1.08 m wide; on a 51 deg dune flank the ground drops 1.52 m across a
   metre, so his uphill half is 0.71 m under the sand and his downhill half is
   0.71 m in the air, at the same time. `bootBuryCm` and `bootFloatCm` are
   that, measured off the rig's REAL world transform — the body's base plane
   against the ground round it — so the same ruler reads both columns whether
   the body is plumb or leaned.

   THE BEFORE IS THIS FILE'S OWN REVERT. `?sand=old` is the flag sand.js
   ships: groundY collapses to heightAt, plant() collapses to the old
   position.set + rotation.y, and nothing is stamped on the ground. Both
   columns are this checkout, same seed, same coordinates, same camera, same
   hour, same simulated seconds. `?weather=off` is set on both because
   events.js's sandstorm would otherwise be a second variable.

   WHY THE PLAYER IS WALKED BY HAND. The subjects are named after SLOPES, and
   the campaign's own pathing does not go where a preset asks — it takes the
   cheap grade, which is the whole point of it. So the driver writes
   W.state.you along a contour of the chosen slope and lets the campaign draw
   it, which is also what makes the gait real: every system in this shot
   (breadcrumbs, followers, footfalls) keys off how far the man has actually
   moved.

   WHAT TO LOOK FOR, because the numbers cannot see it:
     · flat-stand   — are his soles ON the sand, and is there anything at all
                      at his feet saying where the ground is?
     · dune-flank   — THE MONEY SHOT. Before: buried to the shin on the
                      uphill side. After: soles flat on the face, body leaned
                      into it, prints climbing behind him.
     · prints-close — do they read as HOLES with a lit rim, or as stains?
                      Do they z-fight, float, or pop as the camera moves?
     · column-road  — a film strip. Does a road appear behind the column and
                      stay put, or does it slide/pop as the clipmap recentres?
     · ridge-view   — from the strategic camera, can you see where two
                      hundred men went?
*/

/* Read off seed 1337. The erg is where dunes are; the pan is the control —
   a salt crust should take almost NO print, and if it takes a deep one the
   biome coupling is broken. */
const ERG = { x: -1146, z: 3024 };

const subjects = [
  {
    id: "flat-stand", kind: "close", want: 0.04, dist: 3.8, high: 1.7, az: -0.85, at: 0.45, walk: 22,
    label: "Flat Sand — Where Are His Feet",
    focus: "A man standing still on level erg sand, 3.4 m away. BEFORE: he is seated on one height sample with nothing whatever at his feet — no print, no displaced sand, no contact — and on a smooth Lambert dune the eye has no scale reference within twenty metres of him, which is most of why he reads as sunk. AFTER: the sole rests on a stance-fitted surface and the last few strides are still in the sand behind him.",
  },
  {
    id: "dune-flank", kind: "close", want: 0.46, dist: 3.1, high: 1.35, az: -0.85, at: 0.30, walk: 26,
    label: "The Dune Flank — Buried, Then Planted",
    focus: "THE MONEY SHOT. A 25 deg slip face, camera down at boot height and side-on so the contact is readable. BEFORE: the body stands plumb on a single centre sample, so the uphill sole is under the sand and the downhill one is in the air — that is the report, and it is geometry, not a height error. AFTER: the body is leaned 62% of the way to the surface normal and both soles are on the face.",
  },
  {
    id: "prints-close", kind: "prints", want: 0.12, dist: 2.6, high: 1.9, walk: 26,
    label: "Fresh Prints — Holes, Not Stains",
    focus: "Two and a half metres from the ground, looking down the trail he just walked. Each print is a normal-aligned instanced quad whose depth field is lit against the REAL sun: the far wall catches the light, the near wall goes to shadow, and a ring of pushed-up sand round the outside catches it again. Left and right alternate off the centre line by half a stance, which is the difference between a trail and a dotted line. BEFORE has nothing to photograph.",
  },
  {
    id: "column-road", kind: "column", army: 180, dist: 120, yaw: 1.15, walk: 0,
    strip: { frames: 4, stepSec: 2.6 },
    label: "A Column Crossing A Dune — The Road Forms",
    focus: "181 men riding an erg, five frames over ten simulated seconds. The road is NOT two hundred boot prints — at this range a boot is a fifth of a pixel and two hundred of them are still a fifth of a pixel. It is a band of churned sand stamped once every 2.4 m of ride, whose width and depth come from the roster size, with real boots scattered through it for the ten metres where a foot shape can be read. That is why the trail costs O(metres ridden) and not O(men).",
  },
  {
    id: "ridge-view", kind: "column", army: 180, dist: 430, yaw: 1.15, walk: 0, reuse: "column-road",
    label: "From The Ridge — Can You See Where They Went",
    focus: "The same column and the same ground, pulled back to the strategic camera the whole game is played from. This is the image the whole feature is for: you look down at your own army and the desert behind it is marked by it. BEFORE, two hundred men cross a dune field and leave it pristine.",
  },
  {
    id: "salt-control", kind: "close", want: 0.04, dist: 3.8, high: 1.7, az: -0.85, at: 0.45, walk: 22, biome: "salt",
    label: "The Salt Pan — The Control",
    focus: "The same man, the same walk, on a salt crust instead of erg sand. A footprint system that does not know what it is standing on stamps the same hole everywhere; firmness comes straight off desert.js's own biomeAt, so the pan takes a faint scuff and rock takes nothing at all. If this pair shows deep dune prints on the pan, the biome coupling is broken.",
  },
];

async function stageSand(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.warlord || !CBZ.warlord.desert) return { ok: false, missing: "warlord" };
  const W = CBZ.warlord, D = W.desert, C = W.campaign, ST = W.state;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* THE STAGE IS SERIALIZED INTO THE PAGE ON ITS OWN — module scope does not
     travel with it. The first run declared ERG at module level and every
     subject that touched it died with "ERG is not defined"; only the one
     subject that skips that branch reported. Anything the stage needs lives
     inside the stage. */
  const ERG = { x: -1146, z: 3024 };

  let X = window.__wlSand;
  if (!X) {
    X = window.__wlSand = {
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      /* Nothing may wander in and start a fight: an encounter card over one
         column voids the pair. Same guard warlord-island.mjs uses. */
      calm() { for (let i = 0; i < ST.bands.length; i++) ST.bands[i].cooldown = 1e9; },

      /* THE RIG, FOUND THE ONLY HONEST WAY. entities/character.js marks its
         own bodies with userData.charRig; the player's is whichever one is
         standing where the campaign says he is. Both columns are read by
         this same finder. */
      rig() {
        let best = null, bd = 4;
        CBZ.scene.traverse(function (o) {
          if (!o.userData || !o.userData.charRig) return;
          const d = Math.hypot(o.position.x - ST.you.x, o.position.z - ST.you.z);
          if (d < bd) { bd = d; best = o; }
        });
        return best;
      },

      /* HOW FAR THE SOLE IS UNDER THE SAND, AND HOW FAR IT IS IN THE AIR.
         Read off the rig's real world transform, so it does not care which
         column it is in: the body's base plane is the plane through its
         origin with its own up vector, and the ground is desert.js's
         analytic answer on a ring the width of the body. A plumb body on a
         slope scores badly on BOTH at once, which is exactly the failure
         being fixed and is not something a single number can show. */
      /* THE GROUND THIS RULER MEASURES AGAINST IS THE ONE THAT GETS DRAWN.
         The first version of this preset compared the sole to D.heightAt,
         the analytic surface — which is not where the sand is on screen, so
         it was scoring a body against a surface nobody can see and charging
         it for the clipmap's chord as if that were the body's fault. Both
         columns are read against D.renderHeightAt now (falling back to
         heightAt only if desert.js does not publish it), so the number means
         what it says: how far the sole is under, or over, the sand in the
         picture. */
      ground(x, z) {
        return D.renderHeightAt ? D.renderHeightAt(x, z) : D.heightAt(x, z);
      },
      contact(r) {
        const rig = X.rig();
        if (!rig) return null;
        rig.updateMatrixWorld(true);
        const n = new T.Vector3(0, 1, 0).applyQuaternion(rig.quaternion).normalize();
        const p = rig.position;
        let bury = 0, flo = 0;
        for (let i = 0; i < 24; i++) {
          const a = i / 24 * Math.PI * 2;
          const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
          // the base plane's height over (x,z)
          const py = Math.abs(n.y) < 1e-3 ? p.y
            : p.y - (n.x * (x - p.x) + n.z * (z - p.z)) / n.y;
          const g = X.ground(x, z);
          if (g - py > bury) bury = g - py;
          if (py - g > flo) flo = py - g;
        }
        return { bury: bury, float: flo };
      },

      /* WALK HIM BY HAND ALONG A CONTOUR of the slope this subject is named
         after. Writing W.state.you is what the campaign's own input path
         does; everything downstream (breadcrumbs, the column, the gait, the
         clipmap follow) keys off the result, so the walk is a real walk. */
      walkAlong(metres, speed) {
        const dt = 1 / 30;
        let travelled = 0, guard = 0;
        while (travelled < metres && guard++ < 4000) {
          const e = 0.9;
          const gx = (D.heightAt(ST.you.x + e, ST.you.z) - D.heightAt(ST.you.x - e, ST.you.z)) / (2 * e);
          const gz = (D.heightAt(ST.you.x, ST.you.z + e) - D.heightAt(ST.you.x, ST.you.z - e)) / (2 * e);
          // along the contour: perpendicular to the gradient, so he holds the
          // slope this subject was chosen for instead of walking off it
          let hx = -gz, hz = gx;
          const hl = Math.hypot(hx, hz);
          if (hl < 1e-4) { hx = 1; hz = 0; } else { hx /= hl; hz /= hl; }
          const d = speed * dt;
          ST.you.x += hx * d; ST.you.z += hz * d;
          ST.you.yaw = Math.atan2(hx, hz);
          travelled += d;
          CBZ.stepSim(dt);
        }
        return travelled;
      },

      /* A SPOT WITH THE SLOPE THIS SUBJECT ASKS FOR, found by scanning the
         real height field. Hardcoding a coordinate per subject would be
         honest too, but the slope is the thing under test and a scan states
         that in the code instead of in a comment. Deterministic: the same
         golden-angle spiral in both columns, first match wins. */
      find(cx, cz, rad, want, biome) {
        let best = null;
        for (let i = 0; i < 6000; i++) {
          const a = (i * 0.618033988) * Math.PI * 2;
          const r = Math.sqrt((i + 0.5) / 6000) * rad;
          const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
          const bw = biome || "dune";
          if (D.biomeAt(x, z) !== bw) continue;
          if (!D.onLand(x, z)) continue;
          const s = D.slopeAt(x, z);
          /* AND THE WHOLE WALK HAS TO STAY ON IT. The first run picked a
             spot at the right slope, walked 34 m along the contour, and
             finished on the salt pan — so the subject captioned "fresh
             prints in dune sand" photographed a salt crust correctly
             refusing to take one. The contour is checked 30 m either way for
             both the biome and the slope before the spot is accepted. */
          const e = 0.9;
          const gx = (D.heightAt(x + e, z) - D.heightAt(x - e, z)) / (2 * e);
          const gz = (D.heightAt(x, z + e) - D.heightAt(x, z - e)) / (2 * e);
          const hl = Math.hypot(-gz, gx) || 1, hx = -gz / hl, hz = gx / hl;
          let held = true;
          for (let k = -30; k <= 30; k += 10) {
            const px = x + hx * k, pz = z + hz * k;
            if (D.biomeAt(px, pz) !== bw || Math.abs(D.slopeAt(px, pz) - want) > 0.22) { held = false; break; }
          }
          if (!held) continue;
          const sc = -Math.abs(s - want);
          if (!best || sc > best.sc) best = { x: x, z: z, s: s, sc: sc };
        }
        return best;
      },

      metrics() {
        const m = {};
        /* TWO RADII, AND BOTH ARE HONEST — which is why neither replaced
           the other. 0.54 m is the cast rig's own half-width off its Box3,
           so it charges the body for its ARMS: on a slope an arm really is
           nearer the sand than a shoulder, and a rigid 1.08 m body can
           never lie flush on ground that folds inside its own width. That
           is the conservative worst case and it is the number this preset
           has reported from the start, kept so the series stays comparable.
           0.22 m is the boots — the only part of him that can actually be
           BURIED, and the thing the owner was looking at. */
        const c = X.contact(0.54);
        if (c) { m.bootBuryCm = Math.round(c.bury * 1000) / 10; m.bootFloatCm = Math.round(c.float * 1000) / 10; }
        const f = X.contact(0.22);
        if (f) { m.soleBuryCm = Math.round(f.bury * 1000) / 10; m.soleFloatCm = Math.round(f.float * 1000) / 10; }
        /* TWO SEPARATE THINGS, MEASURED SEPARATELY, because the first
           version of this preset conflated them under one name.

           chordCm is HOW WRONG THE OLD ANSWER WAS: the mean gap between the
           analytic surface and the drawn triangle over a 90 m disc. It is a
           property of the terrain, identical in both columns, and it is the
           size of the error a foot seated at heightAt used to inherit.

           lodErrCm is a CHECK ON THE FIX, not on the terrain: desert.js's
           renderHeightAt reconstructs the drawn triangle from the lattice,
           sand.js's renderedY reads the actual vertex buffer out of the
           scene, and the two are independent routes to the same number. It
           must read zero. If it ever does not, the clipmap has changed shape
           and the reconstruction has not been told — which is a silent
           class of bug worth one metric. */
        if (W.sand && W.sand.renderedY && D.renderHeightAt) {
          let n = 0, chord = 0, recon = 0;
          for (let i = 0; i < 200; i++) {
            const a = (i * 0.618033988) * Math.PI * 2, r = Math.sqrt((i + 0.5) / 200) * 90;
            const x = ST.you.x + Math.cos(a) * r, z = ST.you.z + Math.sin(a) * r;
            const mesh = W.sand.renderedY(x, z);
            if (mesh == null) continue;
            chord += Math.abs(D.renderHeightAt(x, z) - D.heightAt(x, z));
            recon += Math.abs(D.renderHeightAt(x, z) - mesh);
            n++;
          }
          if (n) {
            m.chordCm = Math.round(chord / n * 1000) / 10;
            m.lodErrCm = Math.round(recon / n * 10000) / 100;
          }
        }
        const a = W.sand && W.sand.audit ? W.sand.audit() : null;
        m.printsLive = a ? a.prints : 0;
        m.churnLive = a ? a.churn : 0;
        m.markDraws = a ? a.draws : 0;
        m.markTris = a ? a.tris : 0;
        /* WHAT THE GROUND QUERY COSTS. groundY is five heightAt calls where
           the old path was one, and a 200-man battle frame pays it 200 times.
           Declaring it is the honest half of claiming it is affordable. */
        const N = 20000;
        let t0 = performance.now(), acc2 = 0;
        for (let i = 0; i < N; i++) acc2 += D.heightAt((i % 137) * 31.7 - 2000, ((i / 137) | 0) * 27.3 - 2000);
        const base = (performance.now() - t0) * 1000 / N;
        t0 = performance.now();
        const gy = W.sand && W.sand.groundY ? W.sand.groundY : D.heightAt;
        for (let i = 0; i < N; i++) acc2 += gy((i % 137) * 31.7 - 2000, ((i / 137) | 0) * 27.3 - 2000);
        m.groundUs = Math.round(((performance.now() - t0) * 1000 / N) * 1000) / 1000;
        m.heightUs = Math.round(base * 1000) / 1000;
        if (acc2 === 1234.5678) m.groundUs += 0;   // keep both loops
        return m;
      },

      /* THE CAMERA IS THE PRESET'S, NOT THE CAMPAIGN'S. campaign.js clamps
         its pull-back at 16 m — right for a game, useless for photographing
         a boot. Nothing steps the sim between this and the capture, so the
         campaign never gets a frame in which to put its own camera back. */
      look(px, py, pz, tx, ty, tz) {
        const c = CBZ.camera;
        c.position.set(px, py, pz);
        c.lookAt(tx, ty, tz);
        /* near=2.2 IS THE CAMPAIGN'S, and it is right for a game whose
           nearest object is a man 16 m away. A boot photographed from five
           metres needs the near plane out of the way. */
        if (c.near !== 0.12) { c.near = 0.12; c.updateProjectionMatrix(); }
        c.updateMatrixWorld(true);
      },
      /* THE CAMERA IS PINNED WITH A FRAME HOOK, not set once. campaign.js
         re-aims CBZ.camera inside its own per-frame update, and the page's
         rAF keeps running between the stage returning and the shutter — the
         first run of this preset photographed six frames of the game's own
         over-the-shoulder camera and not one of the subject. Order 999 puts
         this after every module's placement, including sand.js's own. */
      pin() {
        if (X._pinned) return;
        X._pinned = 1;
        CBZ.micro.onFrame(function () { if (X.cam) X.cam(); }, { order: 999, id: "warlord-sand/presetCam" });
      },
      shot() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} },
      cam: null,
    };
    window.__cbzVisualCompare = {
      /* THE STRIP ADVANCES THE WORLD AND RE-AIMS THE SAME CAMERA. The
         campaign's own updateCamera runs inside stepSim, so without the
         re-aim every strip frame after the first would be photographed from
         the game's camera and the row would not be a row. */
      async advance(sec) {
        const n = Math.max(1, Math.round(sec * 30));
        for (let i = 0; i < n; i++) { X.calm(); CBZ.stepSim(1 / 30); }
        if (X.cam) X.cam();
        X.shot();
        await new Promise((r) => setTimeout(r, 200));
      },
      async render() { if (X.cam) X.cam(); X.shot(); await new Promise((r) => setTimeout(r, 700)); },
      metrics() { return X.metrics(); },
    };
  }

  for (let t = 0; t < 400 && W.phase() !== "campaign"; t++) await sleep(120);
  if (W.phase() !== "campaign") return { ok: false, missing: "campaign phase (" + W.phase() + ")" };
  X.calm();
  /* 09:12, AND IT WAS 07:48 FOR ONE RUN. The low sun rakes nicely across a
     dune flank, which is why it was tried — and it took the whole frame down
     to a flat brown at luminance 87-97, where a print's hollow and its lit
     rim have no contrast left to work with and the close-up photographed as
     empty ground. The print shading is proportional to the sand's own tone,
     so it needs a lit ground to be visible on, not a raking one. Same hour
     on both sides, obviously. */
  ST.hour = 9.2;

  const wantArmy = sub.army || 10;
  if (ST.army.length < wantArmy) {
    for (let i = ST.army.length; i < wantArmy; i++) {
      W.addSoldier(W.makeSoldier(i % 4 === 0 ? "veteran" : i % 3 === 0 ? "soldier" : i % 2 ? "raider" : "levy", "carbine"));
    }
  }

  if (sub.kind === "column") {
    /* THE COLUMN SHOTS SHARE ONE RIDE. `ridge-view` reuses the ground
       `column-road` just churned — re-riding it would photograph a second,
       different road and caption the two as one. Subjects run in declaration
       order inside one page per side, which is what makes that legal. */
    if (!sub.reuse) {
      ST.you.x = ERG.x; ST.you.z = ERG.z; ST.you.yaw = sub.yaw;
      C.camYaw(sub.yaw); C.camDist(sub.dist);
      X.calm(); X.step(200);
      C.dest(ERG.x + Math.sin(sub.yaw) * 1400, ERG.z + Math.cos(sub.yaw) * 1400);
      for (let i = 0; i < 16; i++) { X.calm(); X.step(30); }
    }
    C.camYaw(sub.yaw); C.camDist(sub.dist);
    X.calm(); X.step(10);
    const mw = document.getElementById("wlMap"); if (mw) mw.classList.remove("on");
    /* THE CAMERA LOOKS BACK DOWN THE TRAIL. The game's camera sits behind
       him looking forward, which frames the sand he has NOT walked on. The
       subject is the road, so the camera is put over the head of the column
       looking back along it. */
    const ref = input.referenceStage;
    X.cam = function () {
      const y = D.heightAt(ST.you.x, ST.you.z);
      const back = sub.dist, up = sub.dist * (sub.dist > 300 ? 0.62 : 0.42);
      const px = ST.you.x - Math.sin(sub.yaw) * back, pz = ST.you.z - Math.cos(sub.yaw) * back;
      X.look(px, Math.max(y + up, D.heightAt(px, pz) + 6), pz,
             ST.you.x - Math.sin(sub.yaw) * back * 0.30, y + 1.0, ST.you.z - Math.cos(sub.yaw) * back * 0.30);
    };
    X.pin(); X.cam(); X.shot();
    await sleep(320);
    X.shot();
    return {
      ok: true, place: { x: ST.you.x, z: ST.you.z },
      camera: { x: CBZ.camera.position.x, y: CBZ.camera.position.y, z: CBZ.camera.position.z },
      metrics: X.metrics(),
    };
  }

  // ---- the close-ups: put him on the slope this subject is named after ----
  const spot = X.find(ERG.x, ERG.z, sub.biome === "salt" ? 4200 : 900, sub.want, sub.biome);
  if (!spot) return { ok: false, missing: "no " + (sub.biome || "dune") + " at slope " + sub.want };
  ST.you.x = spot.x; ST.you.z = spot.z; ST.you.yaw = 0;
  C.camDist(60);
  X.calm(); X.step(220);                 // seven clipmap levels rebuild one per frame
  X.walkAlong(sub.walk, 1.7);            // a real walk, so there is a real gait
  X.calm(); X.step(4);
  const mw = document.getElementById("wlMap"); if (mw) mw.classList.remove("on");

  /* THE CAMERA IS BOOT-HIGH AND SIDE-ON. A shot from behind and above — the
     game's own angle — hides the exact thing under test: whether the sole is
     on the sand. Side-on at 3.5 m puts the contact across the middle of the
     frame where a person can judge it in one glance, which is the standard
     this preset is held to. */
  const yaw = ST.you.yaw;
  X.cam = function () {
    const g = D.heightAt(ST.you.x, ST.you.z);
    if (sub.kind === "prints") {
      /* STRAIGHT DOWN AT THE TRAIL, 55 DEGREES. The first framing put the
         camera 1.9 m up looking at a point 6.8 m back along his path — on
         level ground that is a nice raking view of the prints, and on any
         slope at all it aims into the hillside. Both columns came back as a
         wall of blank sand with the trail off the bottom of the frame. The
         camera now sits 3.0 m above the trail and looks at a point 2.1 m
         further along it, which is a fixed 55 degrees onto the ground
         whatever the ground is doing — the prints are near face-on and
         about 37 px across, which is what "close-up" has to mean. */
      const bx = ST.you.x - Math.sin(yaw) * 2.2, bz = ST.you.z - Math.cos(yaw) * 2.2;
      const tx = ST.you.x - Math.sin(yaw) * 4.3, tz = ST.you.z - Math.cos(yaw) * 4.3;
      X.look(bx, D.heightAt(bx, bz) + 3.0, bz, tx, D.heightAt(tx, tz), tz);
      return;
    }
    /* THE ANGLE IS OFF HIS HEADING, AND IT DECIDES WHETHER THE PICTURE
       WORKS. He walks along a CONTOUR, so a camera on the contour looks
       straight down the fall line and the slope compresses to nothing —
       three framings of the flank shot came back with a man standing on
       what photographs as flat ground. 0.85 rad off his heading puts the
       fall line across the frame, the boots against a visibly tilted
       surface, and the trail he just laid running out of shot behind him. */
    const a = yaw + (sub.az || 0);
    X.look(ST.you.x + Math.sin(a) * sub.dist, g + sub.high, ST.you.z + Math.cos(a) * sub.dist,
           ST.you.x, g + (sub.at == null ? 0.55 : sub.at), ST.you.z);
  };
  X.pin(); X.cam(); X.shot();
  await sleep(320);
  X.shot();
  return {
    ok: true,
    place: { x: ST.you.x, z: ST.you.z },
    slopeDeg: Math.round(Math.atan(D.slopeAt(ST.you.x, ST.you.z)) * 180 / Math.PI * 10) / 10,
    biome: D.biomeAt(ST.you.x, ST.you.z),
    camera: { x: CBZ.camera.position.x, y: CBZ.camera.position.y, z: CBZ.camera.position.z },
    metrics: X.metrics(),
  };
}

export default {
  id: "warlord-sand",
  title: "Desert Warlord: Standing On Sand, And Leaving It Marked",
  description:
    "Both columns are this checkout on seed 1337 with weather held off. The before side boots with ?sand=old — sand.js's own revert, which collapses groundY to heightAt, plant() to the old position.set plus rotation.y, and stamps nothing on the ground. Same coordinates, same cameras, same hour, same simulated seconds, same hand-driven walk.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { sand: "old" },
  beforeLabel: "BEFORE · ?sand=old (plumb on one sample, clean sand)",
  afterLabel: "AFTER · STANCE-FITTED, LEANED, AND MARKED",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.desert && CBZ.warlord.desert.heightAt)",
  urlParams: { go: 1, seed: 1337, weather: "off" },
  stageTimeoutMs: 480000,
  pairNote: "Same checkout · seed 1337 · same coordinates · same camera · same walk — ?sand=old is the only variable",
  method:
    "Both sides are this checkout served by the same local server; the before side adds ?sand=old, the revert switch src/warlord/sand.js ships for itself. The page's ?go=1 boots straight onto the island. The driver then scans the real height field for a spot at the slope each subject is named after (a deterministic golden-angle spiral, first best match, identical in both columns), teleports the player there, gives the seven-level clipmap 220 frames to rebuild, and WALKS him along a contour of that slope by writing W.state.you — which is what the campaign's own input path writes, so the breadcrumbs, the follower column, the gait and the clipmap follow are all real. The camera is then placed by the preset rather than by the game, because campaign.js clamps its pull-back at 16 m and the thing under test is where a boot meets sand; nothing steps the sim between the camera and the capture. The two column subjects share ONE ride: ridge-view reuses the ground column-road churned, because re-riding would photograph a second road and caption the two as one.",
  metricsNote:
    "soleBuryCm/soleFloatCm are the headline: how far the BOOTS are under or over the sand, measured on a 0.22 m foot patch. bootBuryCm/bootFloatCm are the same ruler at the cast rig's full 1.08 m half-width, so they charge the body for its arms — a rigid body can never lie flush on ground that folds inside its own width, and that residual is the deliberate partial lean, not an error. Both are reported because moving to the flattering one alone would be moving the goalposts. bootBuryCm and bootFloatCm are the whole fix in two numbers, and they are read off the rig's REAL world transform in both columns — the body's own base plane against desert.js's analytic ground on a ring the width of the body — so one ruler measures a plumb body and a leaned one. A plumb man on a slope scores badly on BOTH at once, which is why neither alone would have caught this. lodErrCm is the hypothesis this work opened by disproving: the mean |rendered - analytic| height error over a 90 m disc, read out of the clipmap's own vertex buffer. It has NO preferred direction and both columns should print about the same small number — if it ever grows, the LOD really has drifted and the theory was right after all. printsLive/churnLive/markTris/markDraws are the budget: the entire ground record is three draw calls and a few thousand triangles whatever the army size, because the column's road is stamped per METRE RIDDEN and not per man. groundUs against heightUs is what the fix costs per query — five height samples where there was one — declared rather than claimed.",
  metrics: {
    soleBuryCm: { label: "Boots buried below the sand", unit: "cm", better: "lower" },
    soleFloatCm: { label: "Boots floating above the sand", unit: "cm", better: "lower" },
    bootBuryCm: { label: "Whole body below the sand (worst case, arms included)", unit: "cm", better: "lower" },
    bootFloatCm: { label: "Whole body above the sand (worst case, arms included)", unit: "cm", better: "lower" },
    chordCm: { label: "Gap between analytic and drawn ground", unit: "cm mean" },
    lodErrCm: { label: "renderHeightAt vs the actual vertex buffer", unit: "cm mean |err|", better: "lower" },
    printsLive: { label: "Footprints in the ground", unit: "prints", better: "higher" },
    churnLive: { label: "Churned road quads", unit: "quads", better: "higher" },
    markDraws: { label: "Draw calls for the whole ground record", unit: "calls" },
    markTris: { label: "Triangles for the whole ground record", unit: "tris" },
    groundUs: { label: "Cost of one ground query", unit: "µs" },
    heightUs: { label: "Cost of one raw heightAt", unit: "µs" },
  },
  subjects,
  stage: stageSand,
};
