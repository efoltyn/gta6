/* DESERT WARLORD — THE HORDE STOPS TICKING.

   OWNER, 2026-08-30, twice:

       "HORDES LOOK SHIT AND UNREALISTIC AND HORDE MOVEMENT IS SHIT, IMPROVE
        THESE MASSIVELY"

       "WOULD IT BE COOL TO HAVE A TINY TINY AI LIKE MILLIONS OF PARAMS SET THE
        MOVEMENT FOR THE MEN TO MAKE IT MORE REAL OR IS THERE A WAY TO MAKE
        HORDES MOVE BETTER RN THEY LOOK GLITCHY AS FUCK WHILE MOVING IN THIS
        GAME BUT IN NPC WAR SIM THEY LOOK NORMAL"

   The second complaint is the whole diagnosis and he handed it over for free:
   the SAME rigs, the SAME animChar, the SAME sand.plant look normal in
   games/battle.html and glitchy in the campaign. So it was never the animation
   and never a missing brain — it was two callers, and one of them was not
   moving its men.

   battle.html integrates: `m.pos.x += nx * spd * sdt` every sub-step, and
   `m.pos` IS `group.position`, so a man's world position is a continuous
   function of time. campaign.js RECOMPUTED every man from scratch every frame
   out of two quantised lookups:

     · the column: `breadcrumbs[len-1 - floor(back/TRAIL_STEP)]` — a follower
       is pinned to a discrete crumb, so he stands perfectly still for every
       frame between two crumb pushes and then jumps a whole TRAIL_STEP in one
       frame. And his facing was `S.you.yaw` — the PLAYER's current heading —
       for all sixty men at once.
     · every band and every peer: `W.hash01(b.x + k, b.z, 41 + k)` for the
       angle and radius of each man around his party. hash01 rounds to eighths
       of a metre, so a party walking at 6.2 m/s re-rolls its ENTIRE formation
       about eighteen times a second: fourteen men, new angle, new radius,
       teleported metres, at 18 Hz, with their legs walking smoothly through it.

   WHAT TO LOOK FOR
     · `stutter` is the headline. It is the share of frames in which a drawn
       man barely moved compared to his own average step — a man walking
       smoothly scores near zero, a man who freezes and hops scores 60-80%.
     · `jumpRatio` is how far the worst man moved in one frame as a multiple
       of the PLAYER's own step in that frame. Nothing in a marching column
       should ever be much above 1.
     · `slide` is foot slide, measured the honest way: animChar advances the
       gait by DISTANCE (speed x dt / stride), so read the rig's own
       `charRig.phase` back over a twelve-frame bucket, convert it to metres of
       intended stride, and compare it with the metres the body covered.
     · `yawRate` catches the whole-column snap: the old code turned all sixty
       men the instant the player turned.
     · the warband subject is paced in REAL TIME, not stepped as fast as the
       machine will go, because campaign.js walks its parties on the wall clock
       (see stepWall). `bandWalked` in the stage record is how far the party
       moved during the measured window; if it is small the subject measured a
       party standing still and its jump numbers mean nothing.
     · in the pictures — the dogleg subject is the clearest. BEFORE: the men
       sit stacked on discrete points with every head pointing the same way.
       AFTER: lanes that bend around the corner, each man facing down the path
       he is actually on.
*/

/* Seed 1337. A long flat run in the erg with room to turn 90 degrees inside
   it, found by search rather than typed, so the pair still photographs a
   marching column the day the province fields are retuned.

   HARNESS TRAP: ba injects the STAGE FUNCTION ALONE into the page — the
   module's own top-level bindings are NOT in scope inside it, and a reference
   to one fails at run time as `ReferenceError: START is not defined` on every
   subject, on both columns. Constants a stage needs either ride on the SUBJECT
   (which is serialised as data and does arrive) or are declared inside the
   function. This one rides on the subject. */
const START = { x: -1146, z: 3024 };

const subjects = [
  { id: "the-dogleg", start: START, legs: [[1, 0], [0, 1]], run: 280, turn: 130, hold: 90,
    dist: 80, hour: 9.2, roster: 46,
    label: "The Column Rounds A Corner",
    focus: "Forty-six men behind a rider who has just turned ninety degrees. BEFORE: every man in the column has already snapped to the new heading — his facing was literally S.you.yaw — while his body is still parked on a breadcrumb back down the old leg, and the bodies sit in clumps because a follower can only ever stand exactly on a crumb. AFTER: he faces down the tangent of the path he is standing on, and he stands anywhere on it." },

  { id: "the-march", start: START, legs: [[1, 0]], run: 420, turn: 0, hold: 90,
    dist: 90, hour: 8.1, roster: 46,
    label: "A Straight Ride, Full Speed",
    focus: "The plain case, and the one the numbers are cleanest on. He rides at 15.5 m/s, which at 30 fps is a crumb every four frames: BEFORE, each of the forty-six men is frozen for three frames and then jumps about 1.8 m on the fourth, while his legs walk the whole time. That is the glitch, and stutter and slide are what it costs." },

  { id: "the-column-from-above", start: START, legs: [[1, 0], [0.4, 1]], run: 300, turn: 150, hold: 60,
    dist: 150, hour: 10.4, roster: 46,
    label: "The Whole Column, Pulled Back",
    focus: "Far enough back to see the shape of the thing. The lateral offset used to be a fixed jitter on WORLD X and Z, so the column was seven metres wide riding north and three riding east and a bend slid the formation sideways instead of bending it. It now rides the path's own frame: a lane across the tangent, a stagger along it." },

  { id: "a-warband-walking", start: START, band: true, hold: 150, dist: 34, hour: 8.4, roster: 4,
    label: "A Warband Walks Past You",
    focus: "You are standing still; a party of forty raiders is crossing in front of you inside rig range, so these are real bodies. BEFORE it draws NINE of them — round(sqrt(40)*1.5) — at every range; AFTER it draws all forty, because a warband you are standing in front of showing nine men is most of what reads as unrealistic. BEFORE: their formation is hashed off the band's CURRENT world position, which is quantised to 1/8 m, so the whole party re-rolls its layout about eighteen times a second and the men shimmer around the banner. AFTER: the offsets are hashed off the band's identity, which never changes, and the shape stretches into a file when the band is under way." },
];

async function stageHorde(input) {
  const CBZ = window.CBZ, sub = input.subject;
  if (!CBZ || !CBZ.warlord || !CBZ.warlord.desert) return { ok: false, missing: "warlord" };
  const W = CBZ.warlord, D = W.desert, C = W.campaign;
  const THREE = window.THREE;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DT = 1 / 30;

  let X = window.__wlHorde;
  if (!X) {
    X = window.__wlHorde = {
      last: null,

      /* THE MEASURED SET IS THE POOL, found from the outside so the identical
         code runs on both columns. campaign.js keeps its forty-eight rigs
         module-private; every one of them is a studio.cast group carrying
         `userData.charRig`, and they are the only such groups on this page
         besides the player's own. Gathered once — the pool objects persist for
         the life of the page, they are only ever re-DRESSED. */
      rigs() {
        const out = [];
        if (!CBZ.scene) return out;
        CBZ.scene.traverse(function (o) {
          if (o.userData && o.userData.charRig && o.userData.charRig.phase !== undefined) out.push(o);
        });
        return out;
      },

      reset() {
        X.acc = {
          n: 0, still: 0, sumD: 0, maxD: 0, maxRatio: 0, maxYaw: 0,
          slideN: 0, slideSum: 0, recycles: 0, frames: 0, ms: 0, msN: 0,
        };
        X.prev = new Map();
        X.perMan = new Map();
      },

      /* ONE SAMPLE = ONE MAN, ONE FRAME. Everything here is read off the
         rendered rig, never off campaign.js's internals, because the BEFORE
         column is deployed code that has none of this pass's fields on it.

         WALKREF/STRIDE are copied out of entities/character.js gaitPhaseDelta,
         which is the function whose output we are checking: phase advances by
         (speed * dt / stepLen) * PI, so PI radians of phase is exactly one
         stepLen of ground. Reading the phase back and multiplying gives the
         distance the LEGS think they covered; the rig's own position gives the
         distance the BODY covered. The gap between the two is foot slide. */
      sample(playerStep) {
        const A = X.acc, cam = CBZ.camera.position;
        const you = C.you();
        const rigs = X.rigList || (X.rigList = X.rigs());
        A.frames++;
        for (let i = 0; i < rigs.length; i++) {
          const g = rigs[i];
          if (!g.visible) { X.prev.delete(g); continue; }
          // the player's own rig is driven by placeYou and is not the horde
          if (Math.hypot(g.position.x - you.x, g.position.z - you.z) < 1.6) { X.prev.delete(g); continue; }
          const ph = g.userData.charRig.phase || 0;
          const p = X.prev.get(g);
          X.prev.set(g, { x: g.position.x, z: g.position.z, yaw: g.rotation.y, ph: ph });
          if (!p) continue;
          const d = Math.hypot(g.position.x - p.x, g.position.z - p.z);
          /* HEADING IS SAMPLED BEFORE THE LOD FILTER BELOW, and that matters:
             the frame a man teleports is also the frame he spins, so filtering
             first would have thrown away exactly the samples the BEFORE column
             is worst on and flattered it. */
          let dy = g.rotation.y - p.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          if (Math.abs(dy) > A.maxYaw) A.maxYaw = Math.abs(dy);
          /* A POOLED RIG HANDED TO A NEW MAN IS NOT A GLITCH, it is the LOD,
             and at 30 fps it reads as several hundred metres a second. Counted
             separately and dropped from every other number, on both columns.
             Every subject is sized so the pool covers every drawn man and this
             count comes back zero — a run where it does not is a run whose
             jump numbers are measuring the LOD instead of the movement. */
          if (d > 8) { A.recycles++; continue; }
          A.n++; A.sumD += d;
          if (d > A.maxD) A.maxD = d;
          if (playerStep > 0.02) {
            const r = d / playerStep;
            if (r > A.maxRatio) A.maxRatio = r;
          }

          let pm = X.perMan.get(g);
          if (!pm) { pm = { d: [], bd: 0, bp: 0, bn: 0 }; X.perMan.set(g, pm); }
          pm.d.push(d);

          /* SLIDE IS ACCUMULATED OVER FOUR FRAMES, NOT READ OFF ONE, and that
             is the difference between a metric and noise. Both campaign.js and
             battle.js resolve the gait every 1st/2nd/4th frame by range and
             hand animChar `dt * every`, so the phase INTEGRAL is exact but any
             single frame can legitimately show zero phase against real
             movement. A four-frame bucket spans the widest LOD stride, so the
             comparison is apples to apples at every range and on both columns
             — and it needs no distance cut, which is what the first version
             used and what quietly threw away most of the samples.

             TWELVE, not four. Four is the widest LOD stride exactly, so a
             bucket that starts out of phase with a man's own animF catches
             one update or three and the ratio swings; twelve is three whole
             strides and the misalignment is a third of a stride. Measured on
             the pulled-back subject, where every man is past 95 m and on the
             every-4th ladder: it moved BOTH columns, which is what makes it
             an instrument fix rather than a thumb on the scale. */
          let dph = ph - p.ph;
          if (dph < 0) dph += Math.PI * 2 * Math.ceil(-dph / (Math.PI * 2));
          if (dph > Math.PI) dph = 0;            // a pose reset, not a step
          pm.bd += d; pm.bp += dph; pm.bn++;
          if (pm.bn < 12) continue;
          const bd = pm.bd, bp = pm.bp;
          pm.bd = 0; pm.bp = 0; pm.bn = 0;
          const spd = bd / (DT * 12);
          const walkRef = (CBZ.TUNE && CBZ.TUNE.walkSpeed) || 6.4;
          const norm = Math.min(spd / walkRef, 1);
          const run = Math.max(0, Math.min(1, (spd - walkRef) / (walkRef * 0.7)));
          const stepLen = 1.15 + 0.10 * norm + 0.55 * run;
          const gaitD = (bp / Math.PI) * stepLen;
          const big = Math.max(bd, gaitD);
          if (big < 0.12) continue;              // both standing still
          A.slideN++; A.slideSum += Math.abs(bd - gaitD) / big;
        }
        const au = C.audit();
        if (au && au.men && au.men.ms) { A.ms += au.men.ms; A.msN++; }
      },

      metrics() {
        const A = X.acc || { n: 0 };
        const m = {};
        /* STUTTER IS SCALE-FREE ON PURPOSE. "He froze" has to mean something
           whether he is walking or galloping and whether the camera is close
           or far, so it is measured against each man's OWN mean step over the
           window: the share of frames in which he covered less than 15% of it.
           A body integrated every frame scores near zero. A body pinned to a
           discrete point scores whatever fraction of frames fall between two
           pushes, which at 15.5 m/s and 30 fps is three frames in four. */
        let still = 0, tot = 0;
        X.perMan.forEach(function (pm) {
          const a = pm.d;
          if (a.length < 8) return;
          let s = 0;
          for (let i = 0; i < a.length; i++) s += a[i];
          const mean = s / a.length;
          if (mean < 0.04) return;               // this man is standing still
          for (let i = 0; i < a.length; i++) { tot++; if (a[i] < mean * 0.15) still++; }
        });
        m.stutter = tot ? Math.round((still / tot) * 1000) / 10 : 0;
        m.jumpMax = Math.round((A.maxD / DT) * 10) / 10;
        m.jumpRatio = Math.round(A.maxRatio * 100) / 100;
        m.slide = A.slideN ? Math.round((A.slideSum / A.slideN) * 1000) / 10 : 0;
        m.yawRate = Math.round((A.maxYaw / DT) * (180 / Math.PI));
        m.samples = A.n;
        m.recycles = A.recycles;
        m.menMs = A.msN ? Math.round((A.ms / A.msN) * 1000) / 1000 : 0;
        const au = C.audit();
        m.drawnMen = au ? au.drawnMen + (au.men ? au.men.rigs : 0) : 0;
        m.rigs = au && au.men ? au.men.rigs : 0;
        /* THE PER-MAN COST, because the total moves for two reasons and only
           one of them is a regression. A party inside 140 m now shows its
           roster instead of fourteen specks, so drawMen has three times the
           bodies to place in the warband subject — the total ms is SUPPOSED to
           go up there and the number that has to hold is what each man costs. */
        m.usPerMan = m.drawnMen ? Math.round((m.menMs * 1000 / m.drawnMen) * 100) / 100 : 0;
        if (CBZ.renderer && CBZ.renderer.info) m.drawCalls = CBZ.renderer.info.render.calls;
        return m;
      },

      /* Step the sim and, when asked, take a sample. The player's own step in
         the same frame is the denominator for jumpRatio, so it is measured
         here rather than assumed from RIDE_SPEED. */
      step(n, measure) {
        for (let i = 0; i < n; i++) {
          const y = C.you();
          const px = y.x, pz = y.z;
          CBZ.stepSim(DT);
          if (measure) X.sample(Math.hypot(C.you().x - px, C.you().z - pz));
        }
      },

      /* HARNESS TRAP — THE PARTIES ARE ON THE WALL CLOCK, NOT ON stepSim's dt.
         campaign.js's worldTick is a CBZ.onAlways hook that takes its own
         `(performance.now() - lastWall) / 1000`, on purpose: seven warlords
         ride one island and the world may not stop for whoever has a menu
         open. The consequence for a tool is brutal and silent — a burst of
         CBZ.stepSim(1/30) advances the PLAYER thirty times a second and the
         BANDS by however many milliseconds the burst actually took, so the
         same 210-frame window walked a warband 43 m on one run of this preset
         and 2 m on the next, purely because the machine was less loaded. The
         warband subject measures a party that has to be MOVING, so it paces
         real time instead. The column subjects do not: the player is driven
         from the frame hook and is exact under a burst. */
      async stepWall(n, measure) {
        for (let i = 0; i < n; i++) {
          const y = C.you();
          const px = y.x, pz = y.z;
          CBZ.stepSim(DT);
          if (measure) X.sample(Math.hypot(C.you().x - px, C.you().z - pz));
          await new Promise((r) => setTimeout(r, 33));
        }
      },

      calm() {
        const B = W.state.bands;
        for (let i = 0; i < B.length; i++) { B[i].cooldown = 1e9; B[i].mood = "roam"; }
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.renderer && CBZ.camera) { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} }
        await new Promise((r) => setTimeout(r, 900));
      },
      metrics() { return X.metrics(); },
    };
  }

  for (let t = 0; t < 400 && W.phase() !== "campaign"; t++) await sleep(120);
  if (W.phase() !== "campaign") return { ok: false, missing: "campaign phase (" + W.phase() + ")" };

  /* A FLAT ENOUGH RUN, FOUND NOT TYPED. The column has to be photographed on
     ground that does not hide it behind a dune, and the search is seeded and
     identical on both columns. */
  /* THE FLATTEST PAN IN THE NEIGHBOURHOOD, not the first point that passes.
     The first version took the first candidate whose slope was under 0.10 and
     the warband subject came back with the party standing in a trough BEHIND A
     DUNE CREST: forty men drawn, the banner poking over the ridge, and two of
     them visible. A single-point slope test says nothing about what is between
     the eye and the subject. So score every candidate by the height SPREAD
     over three rings out to 70 m and keep the best — the erg has flat pans in
     it, they just have to be looked for. Seeded spiral, same on both columns. */
  const ST = sub.start;
  let sx = ST.x, sz = ST.z, bestSpread = 1e9;
  for (let i = 0; i < 900; i++) {
    const a = i * 2.399963;
    const r = Math.sqrt((i + 0.5) / 900) * 900;
    const x = ST.x + Math.cos(a) * r, z = ST.z + Math.sin(a) * r;
    if (!D.onLand(x, z)) continue;
    if (D.slopeAt(x, z) > 0.10) continue;
    const h0 = D.heightAt(x, z);
    let lo = 0, hi = 0, bad = false;
    for (let k = 0; k < 24 && !bad; k++) {
      const rr = 25 + (k % 3) * 22, aa = (k / 24) * Math.PI * 2;
      const px = x + Math.cos(aa) * rr, pz = z + Math.sin(aa) * rr;
      if (!D.onLand(px, pz)) { bad = true; break; }
      const dh = D.heightAt(px, pz) - h0;
      if (dh < lo) lo = dh;
      if (dh > hi) hi = dh;
    }
    if (bad) continue;
    const spread = hi - lo;
    if (spread < bestSpread) { bestSpread = spread; sx = Math.round(x); sz = Math.round(z); }
    if (bestSpread < 1.2) break;
  }

  // ---- a fresh roster, a fresh trail, every subject ---------------------
  const S = W.state;
  S.hour = sub.hour;
  S.army.length = 0;
  const TIER = ["levy", "raider", "soldier", "veteran"];
  const guns = W.gunList().map(function (g) { return g.id; });
  for (let i = 0; i < sub.roster; i++) {
    W.addSoldier(W.makeSoldier(TIER[i % 4], guns[(i * 3) % guns.length]));
  }
  /* THE TRAIL CANNOT BE POSED — it is the thing under test — so it is WIPED
     and then RIDDEN. `you.placed = false` plus C.enter() is the game's own
     new-arrival path and the only public way to clear the breadcrumbs; it
     drops him on a random beach, which is then overwritten with the search
     result and the clipmap rebuilt under him. */
  S.you.placed = false;
  C.enter();
  S.you.x = sx; S.you.z = sz; S.you.yaw = 0; S.you.placed = true;
  D.build({ seed: S.seed, at: { x: sx, z: sz } });
  /* AND NOTHING MAY INTERRUPT THE RIDE. checkContacts opens the outpost
     screen inside 46 m and the encounter card inside 26 m, and a 400 m
     straight-line ride across a populated island will find one. The parties
     are stood down by calm(); the depots are taken out of the contact list
     for the length of the measurement. Both columns, same code. */
  S.outposts.length = 0;
  C.camDist(sub.dist);
  C.camYaw(0);
  X.calm();

  // the pool builds one rig a frame and dresses four; give it the frames.
  X.step(70, false);
  X.calm();
  X.rigList = null;

  let out = { ok: true, at: sx + "," + sz, flat: Math.round(bestSpread * 10) / 10 };

  if (sub.band) {
    /* STAND STILL AND LET A PARTY WALK PAST. Inside NEAR_IN (150 m) its men
       are real bodies, which is what makes the shimmer measurable off the
       rigs rather than off an instance buffer whose slot order is not stable
       between frames. */
    S.bands.length = 0;
    /* PUT THE PARTY WHERE THE LENS IS. The camera sits behind him along camYaw
       and looks down that axis, so the party goes 30 m IN FRONT of him on that
       same axis and walks ACROSS it — start it forty-four metres off to one side
       and its goal four hundred the other way, so it crosses the frame during
       the window and is centred in it when the shutter falls (210 frames of
       walking at BAND_SPEED is 43 m). Forty men, not ninety, so that
       every drawn body has one of the forty-eight pooled rigs and `recycles`
       comes back zero on both columns. */
    const camY = 0.9;
    const fx = Math.sin(camY), fz = Math.cos(camY);
    S.you.yaw = camY; C.camYaw(camY);
    const cx = sx + fx * 27, cz = sz + fz * 27;
    const b = W.makeBand({ size: 40, faction: "raider", x: cx - fz * 44, z: cz + fx * 44 });
    b.mood = "roam";
    b.goal = { x: cx + fz * 400, z: cz - fx * 400 };
    b.cooldown = 1e9;
    S.bands.push(b);
    const b0x = b.x, b0z = b.z;
    await X.stepWall(60, false);
    X.rigList = null;
    X.reset();
    const b1x = b.x, b1z = b.z;
    await X.stepWall(sub.hold, true);
    out.bandAt = Math.round(b.x) + "," + Math.round(b.z);
    /* PUBLISHED, because this subject's jump numbers only mean anything if the
       party actually walked during the window. A run that reports a couple of
       metres here measured a party standing still and proves nothing. */
    out.bandWalked = Math.round(Math.hypot(b.x - b1x, b.z - b1z));
    out.bandApproach = Math.round(Math.hypot(b.x - b0x, b.z - b0z));
  } else {
    /* NOBODY MAY WANDER IN. A roaming party inside contact range turns the
       march into an encounter card halfway through the measurement, and the
       two columns would not even be photographing the same event. */
    S.bands.length = 0;
    const far = 1e6;
    const L0 = sub.legs[0];
    C.dest(sx + L0[0] * far, sz + L0[1] * far);
    X.step(sub.run, false);
    if (sub.legs.length > 1) {
      /* THE TURN IS INSIDE THE MEASUREMENT WINDOW, and it has to be: the
         whole-column heading snap only happens WHILE the rider is turning,
         so a window that opens after he has finished photographs the one
         moment the old code looked fine. The camera is aimed BEFORE the
         window opens, halfway between the two legs, so the corner is in
         frame and the rig pool is not re-allocating during the numbers. */
      C.camYaw(S.you.yaw + (sub.camTurn == null ? 0.7 : sub.camTurn));
      X.step(12, false);
      X.rigList = null;
      X.reset();
      const L1 = sub.legs[1];
      C.dest(S.you.x + L1[0] * far, S.you.z + L1[1] * far);
      X.step(sub.turn, true);
      X.step(sub.hold, true);
    } else {
      // the camera looks down the column: it sits behind him along camYaw
      C.camYaw(S.you.yaw);
      X.step(20, false);
      X.rigList = null;
      X.reset();
      X.step(sub.hold, true);
    }
    out.rode = Math.round(C.audit().ridden);
    out.trail = C.audit().trail;
  }
  X.calm();
  return out;
}

export default {
  id: "warlord-horde",
  title: "Desert Warlord: The Column Stops Ticking",
  description:
    "The BEFORE column is origin/main served from its own worktree; the AFTER is this one. Same seed, same start, same ride, same camera, same hour. The only difference is how campaign.js decides where a man is standing. It used to pin every follower to a discrete breadcrumb and re-hash every band's formation off the band's live world position; it now samples the trail as a continuous arc-length path and hashes a formation off the band's identity. animChar, sand.plant, outfits and the rigs themselves are untouched — the complaint was never about them, which is exactly why the same bodies look right in games/battle.html.",
  page: "games/warlord.html",
  beforeLabel: "BEFORE · origin/main",
  afterLabel: "AFTER · the men are integrated, not looked up",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.campaign && CBZ.warlord.desert && CBZ.warlord.desert.heightAt)",
  urlParams: { go: 1, seed: 1337, weather: "off", sound: "off", events: "off" },
  stageTimeoutMs: 900000,
  subjects,
  stage: stageHorde,
  pairNote: "seed 1337 · same start point · the same ride, driven by C.dest and CBZ.stepSim(1/30) — the trail is ridden, never posed",
  method:
    "Two servers, two checkouts, both booted ?go=1&seed=1337&weather=off&sound=off&events=off (a road event card took the whole AFTER frame on the first run — events.js has its own revert flag and both columns carry it). THE ROSTER IS FORTY-SIX ON PURPOSE: campaign.js pools forty-eight real rigs, and a pool handed to a new man moves a metre in a frame, which is the very defect under test — at forty-six followers every drawn man keeps one rig for the whole measurement and nothing in the numbers is a LOD hand-over. Each subject wipes the roster and the trail, enlists those men, and RIDES: C.dest sends the player away and CBZ.stepSim(1/30) advances 280-420 frames, then a second dest turns him ninety degrees and 130 more frames run, so the breadcrumb trail under the column is a trail he actually made. Only then does measurement start, over a further 60-150 frames. Every number is read off the RENDERED bodies — the world position and the rotation of each pooled studio.cast group and its own charRig.phase — never off campaign.js internals, because the BEFORE column is deployed code that has none of this pass's fields on it. A pooled rig handed to a new man moves several hundred metres in a frame; those samples are counted as `recycles` and dropped from everything else, on both columns.",
  metrics: {
    stutter:   { label: "Frames in which a drawn man barely moved (vs his own mean step)", unit: "%", better: "lower" },
    jumpRatio: { label: "Worst one-frame move by any man, as a multiple of the player's own step", unit: "x", better: "lower" },
    jumpMax:   { label: "Worst one-frame move by any man", unit: "m/s", better: "lower" },
    slide:     { label: "Foot slide — gap between metres the legs walked and metres the body covered", unit: "%", better: "lower" },
    yawRate:   { label: "Fastest heading change of any man", unit: "deg/s", better: "lower" },
    menMs:     { label: "drawMen() wall time (EMA, campaign's own counter)", unit: "ms", better: "lower" },
    usPerMan:  { label: "…per man drawn", unit: "us", better: "lower" },
    drawCalls: { label: "Draw calls", unit: "calls", better: "lower" },
    rigs:      { label: "Real bodies drawn", unit: "rigs" },
    drawnMen:  { label: "Men drawn (rigs + impostors)", unit: "men" },
    samples:   { label: "Man-frames measured", unit: "samples" },
    recycles:  { label: "LOD hand-overs excluded from the numbers", unit: "samples" },
  },
  metricsNote:
    "stutter is the headline and it is scale-free: it asks, of each man, what share of frames he covered less than 15% of his OWN mean step. A body whose position is integrated every frame scores near zero however fast it is going; a body pinned to a discrete breadcrumb scores whatever share of frames falls between two pushes, which at 15.5 m/s and 30 fps is three in four. jumpRatio is the same defect from the other end — the biggest single-frame move any man made, divided by how far the player moved in that same frame; a column marching with its leader cannot honestly be far above 1. slide is measured off the rig's own charRig.phase, because animChar advances the gait by distance (speed*dt/stride) and therefore PI radians of phase is exactly one stride on the ground: read the phase back, convert to metres, subtract the metres the body actually covered. It is bucketed over TWELVE frames because both files resolve the gait every 1st/2nd/4th frame by range and hand animChar dt*every — the integral is exact, a single frame is not, and twelve frames is three whole strides at the widest LOD so a bucket that starts out of phase with a man's own animF cannot swing the ratio. yawRate catches the whole-column snap: the old code set every follower's facing to S.you.yaw, so a ninety-degree turn by the rider spun sixty men on the spot. samples and recycles are bookkeeping, not claims. rigs and drawnMen must not move: this pass changes where a man stands, not how many of him there are.",
};
