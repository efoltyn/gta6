/* NPC TACTICS STUDIO — the gunfight, before and after the position wave.

   OWNER, 2026-08-15: "NPCs with guns kind of run around stupidly and glitchy…
   make them act a lot more tactical… when they're shooting at you, they should
   be picking position. In general, you would stop to shoot."

   This preset photographs exactly that claim, with the tool's new flag-A/B
   rig: BOTH sides are THIS checkout — the before side boots with
   ?cfg_NPC_IQ_POSITIONS=0 (the wave's one-line revert, i.e. the old brains,
   byte for byte), the after side boots the default. Nothing else differs, so
   every pixel and number of difference is the tactics wave and only the
   tactics wave. No deployed build in the loop, no "well, forty other commits
   also changed" escape hatch.

   IT IS A STUDIO, NOT A GALLERY (gunpoint-studio.mjs's doctrine). The real
   city boots, the rAF clock freezes, and CBZ.stepSim is the only time that
   passes. A cast of real cityPeds is armed with real guns and pointed at the
   real player on a cleared mark; where a subject needs geometry (a cover box,
   a wall) the studio BUILDS it — a visible mesh, a real collider, a real LOS
   blocker — so the same wall exists to the eyes, to the bullets and to the
   movement solver, on both sides, at the same coordinates. Every reaction on
   camera came out of systems/combat_iq.js + peds.js deciding; nothing poses.

   MOTION IS THE WHOLE CLAIM, so the key subjects use the runner's new FILM
   STRIP: the same simulated seconds photographed every ~0.7s on both sides.
   The before row should melt (a body somewhere new every frame, firing on the
   run); the after row should hold (a planted body, squared on the mark, same
   pixels frame after frame). Metrics are sampled over the exact frames the
   strip photographs — the shipped-code numbers:

     shotsFired         real trigger pulls (ammo actually decremented)
     avgTriggerSpeed    the shooter's speed at the instant each round left —
                        THE stop-to-shoot number ("you would stop to shoot")
     firingOnMovePct    % of rounds fired while the body was moving (>1.1 m/s)
     goalChurnMps       how far the steering goal wanders per second — the old
                        per-frame goal rewrite made this metres/second of
                        never-arriving jog; a committed position holds still
     plantedEnd         shooters standing planted on a picked position at the
                        end of the window (the before build has no such state)
     meanSpeed          mean cast speed across the window (a firefight of
                        sprinters vs a firefight of positions)

   plus per-subject numbers named on their pages (wallHugPct, distGainM,
   laneClearEnd, tuckedM).                                                  */

const CAST_DIR = -1;               // cast is placed down -Z of the mark

const subjects = [
  /* ---- THE LAW: officers under the same doctrine -------------------------
     FIRST on purpose: a giving-up officer is removed to the reserve, so two
     simulated minutes of wanted-0 staging (the gang subjects) degrade the
     cop pool — the instrumented probe fired 13 planted rounds as subject
     one and zero as subject five. The department shoots on a fresh shift. */
  { id: "cops-standoff", label: "Four officers, weapons free",
    focus: "THE OTHER HALF OF 'SHOOTING AT YOU'. Four real officers at four stars, lethal force authorized (NPC_IQ_COP_POSITIONS). Before: the department's final approach was a flank-offset march to a four-to-nine-metre stop — officers jogging while firing, spines twisted between run-heading and aim, exactly the gang glitch with a badge on it. After: they close in silence, take POSITIONS — planted in band, wall-projected spots, posture()'s own tucks and corner peeks — and every round leaves a STANDING body (the set-feet trigger rule). The arrest, challenge and tackle choreography is untouched by construction.",
    act: { cops: 4, dist: 24, pre: 6.0, sample: 1.5, wanted: 4 },
    strip: { frames: 4, stepSec: 0.8 },
    cam: { dx: 0, dy: 11, dz: 15, adx: 0, ady: 1.2, adz: -14, fov: 55 } },

  /* ---- THE HEADLINE: a four-gun ambush, over time ---------------------- */
  { id: "firefight", label: "Four guns open up — the whole fight",
    focus: "THE COMPLAINT, PHOTOGRAPHED. Four armed gangers engage the player. Before: everyone jogs and strafes while firing — read the strip row: every man is somewhere new each frame, spines twisted between run-heading and aim. After: they spread, PICK POSITIONS, and PLANT — the row barely changes because the men are standing their ground to shoot. avgTriggerSpeed is the owner's sentence as a number: before ≈ a jog, after ≈ zero.",
    act: { n: 4, dist: 24, weapons: ["Pistol", "AK-47", "Pistol", "AK-47"], pre: 2.5, sample: 1.5 },
    strip: { frames: 5, stepSec: 0.8 },
    cam: { dx: 0, dy: 11, dz: 15, adx: 0, ady: 1.2, adz: -14, fov: 55 } },

  /* ---- TWO RIFLES, PROFILE: the stop itself ----------------------------- */
  { id: "stop-profile", label: "Two riflemen, from the side",
    focus: "SIDE-ON, so the stop is unmissable. Before: they close and trade on the move — legs mid-stride in every frame, body facing the goal while the gun-arm drags toward the player. After: each walks to the spot his rifle wants, PLANTS, squares his spine on the mark, and delivers standing still. The after strip should look like four copies of one photograph; that photograph is the fix.",
    act: { n: 2, dist: 19, weapons: ["AK-47", "AK-47"], pre: 3.5, sample: 1.5 },
    strip: { frames: 4, stepSec: 0.7 },
    cam: { dx: 8.5, dy: 2.2, dz: -12, adx: 0, ady: 1.3, adz: -12, fov: 46 } },

  /* ---- COVER: the box between him and the gun --------------------------- */
  { id: "cover-peek", label: "A hurt man and a wall",
    focus: "THE STUDIO BUILT A REAL BOX (mesh + collider + LOS blocker) twelve metres out and OFF the firing line, and hurt one of the two shooters below his nerve. Before: the hurt man drifts in the open, strafing on a band with the box beside him doing nothing — the dead cover scan this wave's predecessor fixed never sent anyone THERE. After: he gets the BOX between himself and the gun — tucked on its far side, stepping out past its EDGE to shoot (the corner-peek) while his healthy partner trades from open ground. tuckedM is his distance from the box's hide point: small = the wall is doing its job.",
    act: { n: 2, dist: 16, weapons: ["Pistol", "Pistol"], pre: 3.5, sample: 1.5,
      hurtIdx: 0, hurtHp: 0.36, coverBox: { off: -3.5, dist: 12, w: 3.2, h: 2.2, d: 0.9 } },
    strip: { frames: 4, stepSec: 0.8 },
    cam: { dx: -8, dy: 3.4, dz: 2.5, adx: -1.5, ady: 1.1, adz: -12, fov: 52 } },

  /* ---- HIDE: breaking contact when it goes wrong ------------------------ */
  { id: "hide-break", label: "Too hurt to trade — breaking contact",
    focus: "Three guns, and the one cut to a third of his health — with a kiosk the studio built OFF his lane, a real hidden pocket in his away hemisphere. His two partners keep the fire tokens, so he owes the fight nothing. Before: a hurt man's only move was nine metres STRAIGHT BACK — still in the open, still in the same firing lane the rounds are coming up, re-derived every frame so he backpedals forever. After: he breaks for somewhere the player CANNOT DRAW A LINE TO and holds it while his partners trade. exposedPct is the payoff: the fraction of the photographed window the player could draw a chest-height lane to him at all.",
    act: { n: 3, dist: 13, weapons: ["Pistol", "Pistol", "Pistol"], pre: 1.2, sample: 1.2, hurtIdx: 2, hurtHp: 0.38,
      wall: { off: 8, dist: 20, w: 2.6, h: 2.4, d: 2.6 } },
    strip: { frames: 4, stepSec: 1.0 },
    cam: { dx: 9, dy: 7.5, dz: 4, adx: 0, ady: 1.1, adz: -16, fov: 60 } },


  /* ---- THE WALL RULE: the goal that used to be inside the masonry -------
     NOT in the default sweep (npm run visual:npc-tactics runs the stable
     four): the 30 m cast spot at the scanned mark lands in genuinely walled
     pockets often enough to flake run-to-run, and the wall-projection claim
     is already pinned deterministically by tools/tactics-check.mjs scenario
     3. Kept for a future dense-downtown mark; run it explicitly with
     --subjects wall-goal. */
  { id: "wall-goal", label: "A planter across the firing line",
    focus: "THE GLITCH ITSELF, STAGED WHERE IT LIVES. A waist-high planter run sits exactly where the old bearing math drops this rifleman's goal — he can SEE the player over it the whole time, but the spot he is steered at is INSIDE the masonry. Before: he walks into the planter and grinds his face on it while the stuck-timer twitches him sideways (wallHugPct is that loop as a number). After: the goal is PROJECTED onto reachable space before he is steered at it — he plants short of the planter with a clear lane OVER it (a low wall stops legs, not chest-height rounds) and shoots standing still.",
    act: { n: 1, dist: 30, weapons: ["AK-47"], pre: 5.0, sample: 1.5,
      wall: { off: 0, dist: 16, w: 10, h: 0.95, d: 1.4 } },
    strip: { frames: 4, stepSec: 0.9 },
    cam: { dx: -11, dy: 6.5, dz: -5, adx: 0, ady: 1.1, adz: -17, fov: 56 } },
];

async function stageNpcTactics(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, err: "no CBZ/THREE" };
  // the runner serializes THIS function into the page, so module scope is out
  // of reach — the cast direction has to be restated here (gunpoint-studio's
  // own MARK/EYE lesson). Subjects' cam offsets are plain data and travel fine.
  const CAST_DIR = -1;
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
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  /* ---- boot city once, freeze the clock ------------------------------- */
  let S = window.__npcTacticsStudio;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('.mode-btn[data-mode="city"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('.mode-btn[data-mode="city"]').click();
    await wait(250);
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts"; } catch (_) {}
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(600);
    // SHORT warmup on purpose: the two sides' worlds only stay bite-for-bite
    // comparable while ambient life hasn't diverged them; 2 s settles boot
    // without giving the war director time to start anything.
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    S = window.__npcTacticsStudio = { walls: [], cast: [], watch: null, cam: null, extra: null };

    /* THE MARK: a clear stretch of OUTDOOR street near spawn — scanned, not
       assumed. "No colliders in a circle" alone is a trap: a car showroom's
       open floor passes it while its four walls surround the stage (the first
       run photographed exactly that). So a candidate must also (a) not be
       inside any indoor lot, (b) have its CAST CORRIDOR outdoors, and (c)
       hold real chest-height firing lanes from the corridor back to the mark
       — verified with the game's own clearLineOfFire, the same ray the guns
       use. Deterministic per seed. */
    const P = CBZ.player;
    const indoor = (x, z) => {
      try { return !!(CBZ.cityNav && CBZ.cityNav.indoorLotAt && CBZ.cityNav.indoorLotAt(x, z)); }
      catch (_) { return false; }
    };
    const laneClear = (fx, fz, tx, tz) => {
      try { return !CBZ.clearLineOfFire || CBZ.clearLineOfFire(fx, 1.4, fz, tx, 1.5, tz); }
      catch (_) { return true; }
    };
    // OPEN SKY is part of "outdoor": a covered walkway or fuel-canopy passes
    // the ground tests while its roof swallows every elevated camera (the
    // canopy run photographed one shooter and a ceiling). A candidate circle
    // may hold nothing overhead between head height and crane height.
    const openSky = (x, z) => {
      try {
        const near = CBZ.queryCollidersNear ? CBZ.queryCollidersNear(x, z, 9, []) : [];
        for (const c of near) {
          if (c.minX == null || c.y0 == null) continue;
          if (c.y0 > 2.2 && c.y0 < 15) return false;   // an overhang, not a tower
        }
        return true;
      } catch (_) { return true; }
    };
    const markOk = (x, z) => {
      try {
        if (CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)) return false;
        if (indoor(x, z)) return false;
        const near = CBZ.queryCollidersNear ? CBZ.queryCollidersNear(x, z, 11, []) : [];
        if (near.length) return false;
        if (!openSky(x, z)) return false;
        for (const off of [-3.4, 0, 3.4]) {
          const cx = x + off, cz = z - 24;          // the cast corridor (CAST_DIR)
          if (indoor(cx, cz)) return false;
          if (!laneClear(cx, cz, x, z)) return false;
          if (!openSky(cx, cz)) return false;
        }
        return true;
      } catch (_) { return false; }
    };
    // VISUAL sky probe — the canopy that ate the elevated cameras has no
    // collider at all (a roof you never collide with from the street), so
    // collider tests cannot see it. One vertical ray against the real scene
    // per FINALIST candidate (cheap because finalists are few) settles it.
    let skyRC = null;
    const skyOpenVisual = (x, z) => {
      try {
        if (!T || !CBZ.scene) return true;
        skyRC = skyRC || new T.Raycaster();
        skyRC.set(new T.Vector3(x, 1.9, z), new T.Vector3(0, 1, 0));
        skyRC.near = 0.4; skyRC.far = 26;
        const hits = skyRC.intersectObjects(CBZ.scene.children, true);
        return !hits || !hits.length;
      } catch (_) { return true; }
    };
    let mark = { x: P.pos.x, z: P.pos.z };
    outer:
    for (let r = 0; r <= 150; r += 6) {
      for (let k = 0; k < Math.max(1, r); k += 3) {
        const a = (k / Math.max(1, r)) * Math.PI * 2;
        const x = P.pos.x + Math.cos(a) * r, z = P.pos.z + Math.sin(a) * r;
        if (markOk(x, z) && skyOpenVisual(x, z) && skyOpenVisual(x, z - 24)) { mark = { x, z }; break outer; }
      }
    }
    S.mark = mark;

    /* the studio's shared clock step: pins the player, holds the peace with
       the law, keeps the cast committed, and samples the watch counters. */
    /* DIAGNOSTIC: any sim tick we did not issue ourselves breaks the studio's
       determinism claim — count them. (The rAF stub should make this zero.) */
    S.extSteps = 0; S.inStep = false;
    const realStepSim = CBZ.stepSim;
    CBZ.stepSim = function () {
      if (!S.inStep) S.extSteps++;
      return realStepSim.apply(this, arguments);
    };

    S.castSet = new Set();
    S.baseStep = S.step = function (frames) {
      const PA = CBZ.city && CBZ.city.playerActor;
      S.inStep = true;
      for (let i = 0; i < frames; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.player.hp = 100;
        CBZ.game.wanted = S.wantedHold || 0;   // a COP subject fights at real stars
        CBZ.player.pos.x = S.mark.x; CBZ.player.pos.z = S.mark.z; CBZ.player.pos.y = 0;
        // KEEP THE EXTRAS OFF THE SET. Bodies parked shoulder-to-shoulder in
        // the holding block pick fights with each other, and every one of
        // those fights runs the same combat brain we are photographing —
        // polluting the audit numbers with a brawl nobody frames. Sweep them
        // calm on a slow cadence (they are 160 m away; nobody sees it).
        if (i % 30 === 0) {
          for (const p of CBZ.cityPeds || []) {
            if (!p || p.dead || S.castSet.has(p)) continue;
            if (p.rage || p.state === "fight") { p.rage = null; if (p.state === "fight") p.state = "walk"; p.alarmed = 0; }
          }
          // AND THE LAW STAYS OFF THE SET. Armed cast members are legitimate
          // police targets at ANY star level, and a wanted-4 cop subject
          // leaves waves of dispatched units converging for minutes — v4
          // measured them shooting the gang cast mid-take (one hurt man died
          // and his recycled rig read as 753 m of "ground gained"). Any
          // officer not in this subject's cast who closes on the arena is
          // walked back to the holding line, targets cleared.
          for (const cop of CBZ.cityCops || []) {
            if (!cop || cop.dead || S.castSet.has(cop) || !cop.pos) continue;
            const cd = Math.hypot(cop.pos.x - S.mark.x, cop.pos.z - S.mark.z);
            if (cd < 80) {
              cop.pos.x = S.mark.x + 200; cop.pos.z = S.mark.z + 200;
              if (cop.group) cop.group.position.set(cop.pos.x, 0, cop.pos.z);
              cop.curTarget = null; cop.npcTarget = null; cop.searchT = 0; cop.chaseCar = null;
            }
          }
        }
        for (const m of S.cast) {
          if (!m || m.dead) continue;
          if (m.kind === "cop") {
            // an officer's brain owns his fight; the studio only keeps him ON
            // it — no giving up, no wandering off to a search sweep offstage.
            if (PA && !m.curTarget) { m.curTarget = PA; m.retarget = 1.5; }
            m.giveUp = false;
            continue;
          }
          if (PA && (!m.rage || m.rage.dead)) { m.rage = PA; m.state = "fight"; }
          // a scare path (cityScare, panic contagion, sizeup fold) can flip a
          // timid archetype to flee mid-take; the cast is CAST — committed
          // fighters — so the studio re-pins the role every frame.
          if (m.state === "flee" || m.state === "confront") { m.state = "fight"; if (PA) m.rage = PA; }
          m.fear = 0; m.surrender = false; m.surrenderT = 0;
          if (m.ammo < 40) m.ammo = 400;
          // and CAST HEALTH IS WARDROBE: partners' crossfire kept killing the
          // staged 32%-hp man mid-take, and a dead pooled rig recycles to a
          // far spawn (the deterministic "753 m gained" of v4/v5). Health
          // holds at its staged level for the length of the take.
          if (m._stageHp != null && m.hp < m._stageHp) m.hp = m._stageHp;
        }
        CBZ.stepSim(1 / 60);
        const W = S.watch;
        if (W) {
          W.secs += 1 / 60;
          if (S.frameSample) { try { S.frameSample(); } catch (_) {} }
          // per-frame goal trace of cast[0] for the first ~14 sampled frames —
          // the churn's shape (two alternating points vs a wandering point)
          // names its author.
          const c0 = S.cast[0];
          if (c0 && !c0.dead && c0.target && W.trace && W.trace.length < 14) {
            W.trace.push(Math.round(c0.target.x * 10) / 10 + "," + Math.round(c0.target.z * 10) / 10);
          }
          for (let c = 0; c < S.cast.length; c++) {
            const m = S.cast[c]; if (!m || m.dead) continue;
            // a trigger pull is an ammo decrement (peds) or a shootCD jump
            // (police fireAt sets the next cooldown at the shot)
            const fired = (W.prevAmmo[c] != null && m.ammo != null && m.ammo < W.prevAmmo[c]) ||
                          (W.prevCD[c] != null && m.shootCD != null && m.shootCD > W.prevCD[c] + 0.05);
            if (fired) {
              W.shots++;
              W.trigSpeed += m.speed || 0;
              if ((m.speed || 0) > 1.1) W.trigMoving++;
            }
            W.prevAmmo[c] = m.ammo;
            W.prevCD[c] = m.shootCD;
            W.speedSum += m.speed || 0; W.speedN++;
            if (m.target) {
              if (W.prevTx[c] != null) W.churn += Math.hypot(m.target.x - W.prevTx[c], m.target.z - W.prevTz[c]);
              W.prevTx[c] = m.target.x; W.prevTz[c] = m.target.z;
            }
          }
        }
      }
      S.inStep = false;
    };
    S.beginWatch = function () {
      S.watch = { secs: 0, shots: 0, trigSpeed: 0, trigMoving: 0, speedSum: 0, speedN: 0, churn: 0, prevAmmo: [], prevCD: [], prevTx: [], prevTz: [], trace: [] };
    };
    S.metrics = function () {
      const W = S.watch || { secs: 0, shots: 0, trigSpeed: 0, trigMoving: 0, speedSum: 0, speedN: 0, churn: 0 };
      const out = {
        shotsFired: W.shots,
        avgTriggerSpeed: W.shots ? Number((W.trigSpeed / W.shots).toFixed(2)) : null,
        firingOnMovePct: W.shots ? Math.round((W.trigMoving / W.shots) * 100) : null,
        goalChurnMps: W.secs > 0.2 && S.cast.length
          ? Number((W.churn / W.secs / S.cast.length).toFixed(2)) : null,
        meanSpeed: W.speedN ? Number((W.speedSum / W.speedN).toFixed(2)) : null,
      };
      if (S.extra) { try { Object.assign(out, S.extra() || {}); } catch (_) {} }
      // (position-layer bookkeeping — plant/pick/dry audit counts, the c0
      // goal trace, the external-tick counter — lives on CBZ.combatIQAudit()
      // and window.__npcTacticsStudio for debugging sessions; the report
      // table carries only movement truths a reader can weigh at a glance.)
      return out;
    };

    window.__cbzVisualCompare = {
      render() {
        try {
          if (S.applyCam) S.applyCam();
          CBZ.renderer.render(CBZ.scene, CBZ.camera);
        } catch (_) {}
      },
      // the runner's film strip advances the frozen world through here; the
      // watch keeps sampling so the strip's metrics ARE the strip's frames.
      advance(sec) { S.step(Math.max(1, Math.round(sec * 60))); },
      metrics() { return S.metrics(); },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  const M = S.mark;
  const PA = CBZ.city && CBZ.city.playerActor;
  const P = CBZ.player;
  if (!PA || !P) return { ok: false, err: "no city player actor" };

  /* ---- strike the previous set ----------------------------------------- */
  for (const w of S.walls) {
    try {
      const ci = CBZ.colliders.indexOf(w.col); if (ci >= 0) CBZ.colliders.splice(ci, 1);
      const li = CBZ.losBlockers ? CBZ.losBlockers.indexOf(w.mesh) : -1;
      if (li >= 0) CBZ.losBlockers.splice(li, 1);
      if (w.mesh && w.mesh.parent) w.mesh.parent.remove(w.mesh);
    } catch (_) {}
  }
  S.walls.length = 0;
  for (const m of S.cast) {
    if (!m) continue;
    m._iqPos = null; m._iqPlant = false; m._iqTgt = null; m._iqCov = null;
    m._iqBear = null; m._combatFace = null;
    if (m.kind === "cop") {
      // an officer goes back to the reserve line intact — stripping his gun
      // or his state machine would break the department, not the shot.
      m.curTarget = null; m.npcTarget = null; m.searchT = 0; m.giveUp = false;
      m.speed = 0; m.arrestT = 0;
      m.pos.x = M.x + 200; m.pos.z = M.z + 200;
      m.group.position.set(m.pos.x, 0, m.pos.z);
      continue;
    }
    m.rage = null; m.state = "walk";
    m.armed = false; m.weapon = null; m._stageHp = null;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(m); } catch (_) {} }
  }
  S.cast.length = 0;
  S.extra = null;
  S.frameSample = null;
  S.wantedHold = 0;
  if (S.baseStep) S.step = S.baseStep;   // undo any per-subject clock wrap

  /* ---- clear the arena: park every bystander out of the fight ----------- */
  let parked = 0;
  for (const p of CBZ.cityPeds || []) {
    if (!p || p.dead || !p.pos) continue;
    const d = Math.hypot(p.pos.x - M.x, p.pos.z - M.z);
    if (d < 70) {
      const x = M.x + 160 + (parked % 20) * 2.4, z = M.z + 160 + Math.floor(parked / 20) * 2.4;
      p.pos.x = x; p.pos.z = z;
      if (p.target && p.target.set) p.target.set(x, 0, z);
      p.rage = null; if (p.state === "fight") p.state = "walk";
      parked++;
    }
  }
  for (const c of CBZ.cityCops || []) {
    if (!c || c.dead || !c.pos) continue;
    const d = Math.hypot(c.pos.x - M.x, c.pos.z - M.z);
    if (d < 90) { c.pos.x = M.x + 200; c.pos.z = M.z + 200; c.curTarget = null; c.npcTarget = null; }
  }

  /* ---- build this subject's geometry ------------------------------------
     A wall here is REAL three ways at once: a mesh (the camera sees it), a
     collider (bodies and the position solver respect it), an LOS blocker
     (bullets and c.sees respect it). Same object on both sides, same spot. */
  const addWall = (spec) => {
    const cx = M.x + (spec.off || 0), cz = M.z + CAST_DIR * spec.dist;
    const mesh = new T.Mesh(
      new T.BoxGeometry(spec.w, spec.h, spec.d),
      new T.MeshLambertMaterial({ color: 0x8d8578 })
    );
    mesh.position.set(cx, spec.h / 2, cz);
    mesh.updateMatrixWorld(true);
    CBZ.scene.add(mesh);
    const col = { minX: cx - spec.w / 2, maxX: cx + spec.w / 2, minZ: cz - spec.d / 2, maxZ: cz + spec.d / 2, y0: 0, y1: spec.h, _city: true };
    CBZ.colliders.push(col);
    if (CBZ.losBlockers) CBZ.losBlockers.push(mesh);
    S.walls.push({ mesh, col });
    return { cx, cz, col };
  };
  let wallRef = null;
  if (act.wall) wallRef = addWall(act.wall);
  if (act.coverBox) wallRef = addWall(act.coverBox);

  /* ---- cast the shooters ------------------------------------------------ */
  // LIVE bodies only: a pooled/parked/culled rig sits in cityPeds but the ped
  // pass `continue`s straight past it — cast one and it stands frozen at its
  // mark doing nothing for the whole shoot (the do-nothing rifleman of run 3).
  const pool = (CBZ.cityPeds || []).filter((p) => p && !p.dead && !p.vendor && !p.child &&
    !p.companion && !p.recruited && !p.controlled && p.char && p.group &&
    !p._parked && !p.culled && !p._spawnHidden &&
    !p.inCar && !p.driving);   // a rider is the vehicle system's puppet — cast one and it stands inert
  if (pool.length < act.n) return { ok: false, err: "cast pool too small: " + pool.length };
  // a cast mark outside the scanned-clear arena circle can land inside real
  // downtown geometry — walk it back toward the mark until it stands free.
  const freeSpot = (x, z) => {
    for (let k = 0; k < 30; k++) {
      let blocked = false;
      try {
        const near = CBZ.queryCollidersNear ? CBZ.queryCollidersNear(x, z, 1.4, []) : [];
        for (const c of near) {
          if (c.minX == null) continue;
          if (c.y0 != null && c.y0 > 1.2) continue;                 // overhead
          if (x > c.minX - 0.6 && x < c.maxX + 0.6 && z > c.minZ - 0.6 && z < c.maxZ + 0.6) { blocked = true; break; }
        }
      } catch (_) {}
      if (!blocked) return { x, z };
      const dx = M.x - x, dz = M.z - z, l = Math.hypot(dx, dz) || 1;
      x += (dx / l); z += (dz / l);                                  // 1 m toward the mark
    }
    return { x, z };
  };
  const spread = 3.4;
  /* ---- CAST THE LAW instead (act.cops): real officers, their own brains.
     The studio only places them, points the hunt at the player, and holds
     the stars (S.wantedHold) so lethal force stays authorized. ---- */
  if (act.cops) {
    const cpool = (CBZ.cityCops || []).filter((c2) => c2 && !c2.dead && !c2._airPilot &&
      !c2._swatPassenger && !c2.inCar && !c2._seizing && c2.char && c2.group);
    if (cpool.length < act.cops) return { ok: false, err: "cop pool too small: " + cpool.length };
    for (let i = 0; i < act.cops; i++) {
      const c2 = cpool[i];
      const off = (i - (act.cops - 1) / 2) * spread;
      const spot = freeSpot(M.x + off, M.z + CAST_DIR * (act.dist + (i % 2) * 2));
      c2.pos.x = spot.x; c2.pos.z = spot.z; c2.pos.y = 0;
      c2.group.position.set(spot.x, 0, spot.z);
      c2.curTarget = PA; c2.sees = true; c2.retarget = 1.5; c2.lostT = 0;
      c2.searchT = 0; c2.giveUp = false; c2.gunstop = false; c2.arrestT = 0;
      c2.shootCD = 0.3 + i * 0.12; c2._coverT = 0; c2._challenged = false;
      // a POSTED or DUTIED officer keeps his assignment brain — a roadblock
      // stance or a move-along beat at the cast mark reads as a mute cop
      c2._post = null; c2._duty = null; c2.chaseCar = null; c2.npcTarget = null;
      c2._iqPos = null; c2._iqPlant = false; c2._iqBear = null; c2._iqCov = null; c2._iqAimOn = null;
      if (c2.target) { c2.target.x = spot.x; c2.target.z = spot.z; }
      S.cast.push(c2);
    }
  } else
  for (let i = 0; i < act.n; i++) {
    const m = pool[i];
    const off = (i - (act.n - 1) / 2) * spread + (act.coverBox && i === act.hurtIdx ? (act.coverBox.off || 0) : 0);
    const spot = freeSpot(M.x + off, M.z + CAST_DIR * (act.dist + (i % 2) * 2));
    const x = spot.x, z = spot.z;
    m.pos.x = x; m.pos.z = z; m.pos.y = 0;
    m.group.position.set(x, 0, z);
    if (m.target && m.target.set) m.target.set(x, 0, z);
    m.armed = true; m.weapon = (act.weapons && act.weapons[i]) || "Pistol"; m.ammo = 400;
    m.aggr = 0.95;                       // committed: no _hurtBail flee, thug tier
    m.maxHp = m.maxHp || 100;
    m.hp = act.hurtIdx === i ? Math.round(m.maxHp * (act.hurtHp || 0.3)) : m.maxHp;
    m.fear = 0; m.surrender = false; m.ko = 0; m.path = null;
    m.attackCD = 0; m.pause = 0; m.stun = 0; m._windup = 0;   // no stale combat locks from a past life
    m._stageHp = m.hp;                                        // health is wardrobe (see S.step)
    m.rage = PA; m.state = "fight"; m.alarmed = 8;
    // fresh tactical memory so the previous subject can't leak into this one
    m._iqPos = null; m._iqPlant = false; m._iqBear = null; m._iqCov = null;
    m._iqAimOn = null; m._roleSeedX = x; m._roleSeedZ = z;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(m); } catch (_) {} }
    S.cast.push(m);
  }
  S.castSet = new Set(S.cast);

  /* ---- the player on his mark, facing the cast ------------------------- */
  P.pos.x = M.x; P.pos.z = M.z; P.pos.y = 0;
  if (CBZ.cam) { CBZ.cam.yaw = CAST_DIR < 0 ? 0 : Math.PI; CBZ.cam.pitch = 0; }

  /* ---- per-subject extra numbers ---------------------------------------- */
  const hurt = act.hurtIdx != null ? S.cast[act.hurtIdx] : null;
  const startDist = hurt ? Math.hypot(hurt.pos.x - M.x, hurt.pos.z - M.z) : 0;
  if (subject.id === "hide-break" && hurt) {
    // EXPOSURE, integrated over the photographed window — not a single frame.
    // A single end-frame bit lied both ways (a peek beat reads exposed, a
    // lucky backpedal frame reads hidden); the fraction of sampled frames the
    // player could draw a chest-height lane to him is the honest number.
    // RELOCATION GUARD. The city's crowd system can reclaim a pooled rig and
    // respawn it across the map mid-take (five runs measured the same ~750 m
    // "ground gained" — a corpse-walk or pool-recycle, not a retreat). A
    // frame-to-frame jump no legs can make freezes the instrument at its
    // last honest reading and raises castRelocated instead of lying.
    let sampN = 0, expN = 0, lastX = null, lastZ = null, saneX = null, saneZ = null, relocated = 0;
    S.frameSample = () => {
      if (!hurt || hurt.dead || relocated) return;
      if (lastX != null && Math.hypot(hurt.pos.x - lastX, hurt.pos.z - lastZ) > 20) { relocated = 1; return; }
      lastX = saneX = hurt.pos.x; lastZ = saneZ = hurt.pos.z;
      sampN++;
      const geom = CBZ.combatIQ && CBZ.combatIQ.geom;
      if (!geom || !geom.fireBlocked(M.x, M.z, hurt.pos.x, hurt.pos.z)) expN++;
    };
    S.extra = () => ({
      distGainM: saneX != null
        ? Number((Math.hypot(saneX - M.x, saneZ - M.z) - startDist).toFixed(1))
        : Number((Math.hypot(hurt.pos.x - M.x, hurt.pos.z - M.z) - startDist).toFixed(1)),
      exposedPct: sampN ? Math.round((expN / sampN) * 100) : null,
      castRelocated: relocated,
    });
  }
  if (subject.id === "cover-peek" && hurt && wallRef) {
    S.extra = () => {
      // the honest hide point: the far side of the box from the player
      const hx = wallRef.cx, hz = wallRef.cz + (act.coverBox.d / 2 + 0.8) * CAST_DIR;
      return { tuckedM: Number(Math.hypot(hurt.pos.x - hx, hurt.pos.z - hz).toFixed(1)) };
    };
  }
  if (subject.id === "wall-goal" && wallRef) {
    const shooter = S.cast[0];
    let hugFrames = 0, sampFrames = 0;
    const baseStep = S.step;
    // wrap the studio clock for this subject only: count wall-hugging frames
    S.step = function (frames) {
      for (let i = 0; i < frames; i++) {
        baseStep(1);
        if (shooter && !shooter.dead) {
          sampFrames++;
          const nx = Math.max(wallRef.col.minX, Math.min(shooter.pos.x, wallRef.col.maxX));
          const nz = Math.max(wallRef.col.minZ, Math.min(shooter.pos.z, wallRef.col.maxZ));
          if (Math.hypot(nx - shooter.pos.x, nz - shooter.pos.z) < 1.0) hugFrames++;
        }
      }
    };
    S.extra = () => {
      const clear = shooter && !shooter.dead && CBZ.clearLineOfFire
        ? (CBZ.clearLineOfFire(shooter.pos.x, 1.4, shooter.pos.z, M.x, 1.55, M.z) ? 1 : 0) : null;
      return {
        wallHugPct: sampFrames ? Math.round((hugFrames / sampFrames) * 100) : null,
        laneClearEnd: clear,
      };
    };
  }

  /* ---- roll the fight, then open the sampled window --------------------- */
  S.wantedHold = act.wanted || 0;
  const pre = Math.max(0, (act.pre || 2) - (act.sample || 0));
  S.watch = null;
  S.step(Math.round(pre * 60));
  S.beginWatch();
  S.step(Math.round((act.sample || 1.5) * 60));

  /* ---- camera ----------------------------------------------------------- */
  setHud(false);
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = subject.cam;
  /* SELF-CORRECTING TRIPOD. The mark scan proves the STREET is clear at body
     height — it says nothing about a balcony or an upper floor overhanging
     it, and run 3 photographed a couch because the elevated camera sat
     inside somebody's apartment. A tripod spot must (a) not be inside any
     collider at its own height and (b) hold a clear line to what it is
     shooting; otherwise pull it in, lower it, until it does. */
  const camInside = (x, y, z) => {
    try {
      const near = CBZ.queryCollidersNear ? CBZ.queryCollidersNear(x, z, 1.0, []) : [];
      for (const c of near) {
        if (c.minX == null) continue;
        if (x > c.minX - 0.4 && x < c.maxX + 0.4 && z > c.minZ - 0.4 && z < c.maxZ + 0.4) {
          if (c.y0 == null || c.y1 == null) return true;
          if (y > c.y0 - 0.2 && y < c.y1 + 0.4) return true;
        }
      }
      return false;
    } catch (_) { return false; }
  };
  const camSees = (x, y, z, ax2, ay2, az2) => {
    try { return !CBZ.clearLineOfFire || CBZ.clearLineOfFire(x, y, z, ax2, ay2, az2); }
    catch (_) { return true; }
  };
  const solveCam = () => {
    const look = { x: M.x + cam.adx, y: cam.ady, z: M.z + cam.adz };
    for (const t of [{ s: 1, y: cam.dy }, { s: 0.75, y: cam.dy }, { s: 1, y: Math.min(cam.dy, 4.2) },
                     { s: 0.55, y: Math.min(cam.dy, 3.4) }, { s: 0.4, y: 2.4 }]) {
      const x = M.x + cam.dx * t.s, z = M.z + cam.dz * t.s, y = t.y;
      if (camInside(x, y, z)) continue;
      if (!camSees(x, y, z, look.x, look.y, look.z)) continue;
      return { x, y, z, ax: look.x, ay: look.y, az: look.z, fov: cam.fov || 50 };
    }
    return { x: M.x + cam.dx * 0.3, y: 2.2, z: M.z + cam.dz * 0.3, ax: look.x, ay: look.y, az: look.z, fov: cam.fov || 50 };
  };
  const camAbs = locked || solveCam();
  S.applyCam = function () {
    const camera = CBZ.camera;
    camera.aspect = input.width / input.height;
    camera.fov = camAbs.fov || 50;
    camera.near = 0.15; camera.far = 20000;
    camera.position.set(camAbs.x, camAbs.y, camAbs.z);
    camera.lookAt(camAbs.ax, camAbs.ay, camAbs.az);
    camera.updateProjectionMatrix();
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    else {
      const rig = CBZ.skyDome && CBZ.skyDome.parent;
      if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
    }
  };
  S.applyCam();
  CBZ.renderer.render(CBZ.scene, CBZ.camera);

  return { ok: true, camera: camAbs, metrics: S.metrics() };
}

export default {
  id: "npc-tactics",
  title: "Gang City Gunfights: Picking Positions and Stopping to Shoot",
  description: "The same checkout on both sides — the before build boots with cfg_NPC_IQ_POSITIONS=0, the wave's own one-line revert, so the ONLY variable is the tactics layer. Real city, real peds, real guns; the studio builds its own walls where a subject needs one. Film strips photograph the motion claim; every number is sampled over the exact frames on camera.",
  defaultBefore: "local",
  beforeParams: { cfg_NPC_IQ_POSITIONS: 0 },
  beforeLabel: "BEFORE · POSITIONS OFF (old brains)",
  afterLabel: "AFTER · TACTICS WAVE",
  viewport: { width: 1180, height: 700 },
  readyExpression: "document.getElementById('playBtn') && document.querySelector('.mode-btn[data-mode=\"city\"]')",
  urlParams: { seed: 90210 },
  // the first subject pays the whole city boot (up to ~300s booted + ~180s to
  // "playing" under software WebGL) — the stage budget must exceed their sum.
  stageTimeoutMs: 600000,
  pairNote: "Same checkout · seed · mark · cast · cameras · simulated seconds — cfg_NPC_IQ_POSITIONS is the variable",
  method: "Both sides are THIS checkout served by the same local server; the before side boots with cfg_NPC_IQ_POSITIONS=0 (the tactics wave's one-line revert). The city boots, the rAF clock freezes, and CBZ.stepSim is the only time. A cast of real cityPeds is armed and raged at the real player on a scanned-clear mark; cover boxes and walls are built as mesh + collider + LOS blocker so they are equally real to eyes, bullets and feet on both sides. Film strips advance the same frozen simulation on both builds and the metrics are sampled over exactly the photographed frames.",
  metricsNote: "avgTriggerSpeed is the owner's sentence as a number — the shooter's movement speed at the instant each real round left the gun (ammo decrement, not an animation guess). firingOnMovePct is how many of those rounds were fired on the move. goalChurnMps is the steering goal's wander per man — the per-frame goal rewrite the position layer removed. All of them are sampled over exactly the simulated frames the pictures photograph.",
  metrics: {
    shotsFired: { label: "Rounds actually fired", unit: "rounds" },
    avgTriggerSpeed: { label: "Speed at the trigger pull", unit: "m/s", better: "lower" },
    firingOnMovePct: { label: "Rounds fired while moving", unit: "%", better: "lower" },
    goalChurnMps: { label: "Steering-goal wander", unit: "m/s per man", better: "lower" },
    meanSpeed: { label: "Mean cast speed", unit: "m/s", better: "lower" },
    distGainM: { label: "Ground gained away from the gun", unit: "m" },
    exposedPct: { label: "Time in the player's firing lanes", unit: "%", better: "lower" },
    castRelocated: { label: "Take voided by a crowd-rig recycle", unit: "1=yes", better: "lower" },
    tuckedM: { label: "Hurt man's distance from the hide point", unit: "m", better: "lower" },
    wallHugPct: { label: "Time spent pressed against the wall", unit: "%", better: "lower" },
    laneClearEnd: { label: "Ended with a real firing lane", unit: "1=yes", better: "higher" },
  },
  subjects,
  stage: stageNpcTactics,
};
