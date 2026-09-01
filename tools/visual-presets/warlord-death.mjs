/* DESERT WARLORD — A MAN DYING, PHOTOGRAPHED AS A SEQUENCE.

   THE REPORT (owner): "death isn't shown — look how cinematic death is in
   gang city. Death in warlord is instant, completely violates show don't
   tell."

   THE CLAIM UNDER TEST: a death that lasts three quarters of a second, in four
   beats, is a different event from a state flip — and the difference is not a
   feeling, it is visible in consecutive stills of the SAME death.

   WHY A SEQUENCE AND NOT A STILL. Every other preset in this directory
   photographs a STATE: what the dune looks like, where the wing went, whether
   the buttons overlap. That is the wrong instrument for this ask. "Instant" is
   not a claim about any single frame — the old build's final frame and the new
   build's final frame are both a corpse on sand — it is a claim about what
   happens BETWEEN frames. So the subjects here are moments of ONE death,
   reached in 1/120 s slices of a frozen clock, and what the pair shows is that
   the before side HAS no 0.06 s and no 0.36 s: it has one frame of standing
   and then a plank.

   TWO DEATHS, DELIBERATELY, BECAUSE THE ANSWER SPLIT IN TWO. The first
   measurement of this change found something that changed the storyboard:
   near the camera, warlord ALREADY had gang city's body. city/ragdoll.js is
   on this page, RAGDOLL_RANGE is the whole field, and both builds hand a
   close kill to the verlet solver. What that death was missing was the BLOOD
   (systems/gore.js was never fetched) and the TIME (CBZ.doHitstop is declared
   in core/loop.js, the CITY's frame loop, which this page does not run). The
   PLANK was for everybody else — the men past the solver's 28 concurrent
   slots, which at 300 a side is almost everybody. So:
     · subjects 1-2 photograph a death the solver CAN afford. The variable is
       blood and time.
     · subjects 3-5 photograph a death it cannot, by setting RAGDOLL_RANGE to
       half a metre on BOTH builds — the engine's own refusal, its own comment
       ("far kills keep the cheap path"), applied identically to both sides so
       it is a constant. That is the 272nd man of a volley, and it is where
       the four beats live.
     · subject 6 puts the solver back and photographs the budget deciding.

   THE A/B IS ONE FLAG. Both sides are this checkout, same seed, same rosters
   on the same sand, same simulated seconds, same camera seat, same man dying.
   The before side boots ?deaths=old — warlord/deaths.js's own revert of
   everything in it: deathPose on frame zero, a coin-flip fall direction, a
   one-axis plank at 2.4/s, no blood, no hit-stop and no rim. That is
   byte-for-byte what battle.js did before this wave, and it lives inside
   deaths.js rather than behind in battle.js so the game carries one death path.

   HOW THE SAME MAN DIES TWICE. battle.js's studio seam grew two drive-only
   verbs for this; nothing in the game calls them:
     execute({dist, off, pitch})  names the enemy nearest the warlord, seats
       the command camera 3/4 off the shot line, and kills him with `by: YOU`.
       Same seed, same second → same man, same seat, same round.
     shotAudit()  what is happening to THAT man right now, read off his rig's
       actual world quaternion rather than off the bookkeeping that produced
       it — so a fall that is recorded but not DRAWN reads as zero.

   MEASURED ON THE CHEAP PATH BEFORE THE CAPTURE (seed 1337, 60 a side, the
   same man, tilt in degrees off vertical):

       t (s)     0.02   0.06   0.20   0.36   0.70   1.60
       BEFORE    51.5   66.4  106.1  127.7  129.3  129.3   posed from frame 1
       AFTER     14.6   14.6   14.6   55.9   79.5   81.7   posed at 0.20 s

   Two things fall out of that table. The before side is already half over on
   the frame the round lands and is FULLY DEAD-POSED throughout — there is no
   moment at which he has been shot rather than switched off. And it settles at
   129.3 degrees: 39 degrees PAST FLAT, head-and-shoulders down through the
   sand. The PI/2 - 0.07 cap was on rotation.x alone, and warlord/sand.js's
   plant() had already leaned him into the dune with a quaternion, so the
   composed tilt was the cap plus the lean. That is the "backwards body" bug
   systems/grapple.js:411 warns about, reached by a route grapple.js could not
   see, and it was on every corpse on a slope in this game.
*/


const subjects = [
  { id: "the-round-lands", label: "0.06 s — the round lands",
    focus: "THE FIRST BEAT. A tier-2 death: the man YOU shot, nine metres out, which deaths.js never culls. AFTER: the blood is already in the air along the shot line — a directional spray, an aerosol at the wound — and a hit-stop has taken the whole battle to 6% speed for a twentieth of a second. BEFORE: nothing. systems/gore.js is not on this page at all under ?deaths=old (it lives in the studio 'blood' pack, which games/warlord.html's need() list has never asked for), and CBZ.doHitstop is declared in core/loop.js, the CITY's frame loop, which this page does not run — so fpsmode has been calling it into `undefined` on every round since gunplay.js mounted it.",
    deny: false, kill: true, at: 0.06 },

  { id: "on-the-ground", label: "1.60 s — what is left on the sand",
    focus: "THE EVIDENCE. AFTER: the spray has landed and left splats, a pool is spreading and darkening under him, and the entry wound is stamped on the body itself through gore's own opts.actor seam — the same wound a city corpse carries. BEFORE: a clean corpse on clean sand, with nothing in the frame to say he was shot rather than switched off.",
    at: 1.60 },

  { id: "denied-a-body-0-06", label: "0.06 s — the man the solver could not afford",
    focus: "THE OTHER 272. city/ragdoll.js solves 28 bodies at once on this page; a 300 v 300 volley spends all 28 in its first second, and everyone after that takes the CHEAP path. This pair is that path, forced honestly: RAGDOLL_RANGE is set to half a metre for both builds, which is the engine's own way of refusing a body, so what is left is exactly what the 272nd man of a volley gets. AFTER: he is STANDING. He has been struck — the torso thrown along the round, the aim dropped — and CBZ.deathPose has not run. BEFORE: deathPose fired on frame zero, so he is bolt upright inside his own final sprawl, arms flung out, one knee drawn up, already tipping. `posedAtBeat` is 1 before and 0 after, and that single bit is the report.",
    deny: true, kill: true, at: 0.06 },

  { id: "denied-a-body-0-36", label: "0.36 s — the knees give, and which way",
    focus: "THE FOLD. The pose arrives HERE, the frame his legs stop holding him, and the body folds AWAY FROM THE ROUND: the shot line is resolved into his own forward and right axes, so a man shot in the back goes face down and a man shot from his left goes down to his right. `alongShot` is the cosine between the bearing his head travelled and the bearing the round did. BEFORE it comes from `lcg() < 0.5 ? -1 : 1` on a single axis — a coin flip, which is why half the corpses in this game used to fall towards the man who shot them.",
    at: 0.36 },

  { id: "denied-a-body-1-10", label: "1.10 s — down, along the line of the shot",
    focus: "THE END OF THE CHEAP PATH. AFTER: flat, rolled onto a shoulder (grapple.js's own +/-0.6 rad, spent on the share of the fall the bullet did not decide), folded on top of the stance he was planted in — so a man shot on a dune lies ALONG the dune instead of standing out of it, because the fold is a quaternion multiply in his own frame rather than an Euler write over the top of the slope lean. BEFORE: a plank at 90 degrees on one axis.",
    at: 1.10 },

  { id: "the-volley", label: "The budget, under a volley",
    focus: "WHO GETS THE CINEMATIC, with the solver back to its real 28 slots. deaths.js ranks every death in the frame: the man YOU shot and the man whose death decides the battle are never culled, then everything inside gore.js's own 70 m gate and in front of the lens, nearest first, spent against the solver's OWN free slots — a number this file asks for rather than invents. The old code spent those slots in men[] ARRAY ORDER, which is spawn index: the man you shot at four metres could lose his body to a levy at 160 m who merely sat earlier in the loop. `denied` counts the deaths that wanted a body and lost the rank; zero would mean the budget is not doing anything.",
    restore: true, wide: true },

  { id: "one-of-yours-is-down", label: "One of yours is down — where",
    focus: "SHOW DON'T TELL, IN THE ONE PLACE battle.js WAS TELLING. The kill feed printed \"HAKIM DOWN\" into a five-line text box on the right of the screen. Two things wrong with that sentence: you have not learned Hakim's name — the campaign gives him one for the AFTERMATH screen, which is where a name has time to be read — and it never carried the one fact you would actually act on mid-fight, which is WHICH SIDE OF YOU your line is coming apart. So the words are DELETED (the box, the CSS and the function, in both builds — deleting a redundant text panel is not a switchable behaviour) and a short red tick appears on the screen rim at the man's world bearing instead: amber and thinner when he only breaks, because a man running is not a man dead. Colours are battle.js's own HP-bar hexes; the cap is 12, which is city/killfeed.js's own CAP for the same quantity. The BEFORE side here is ?deaths=old, which turns the rim off, so this pair is the picture against nothing — which is exactly the choice: a picture, or a name you do not know.",
    kill: true, ownMan: true, wide: true, at: 0 },
];

async function stageWarlordDeath(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.warlord) return { ok: false, err: "no CBZ.warlord" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 200);
    }
    return false;
  };

  let S = window.__warlordDeathStudio;
  if (!S) {
    const B0 = await until(() => window.__warlordBattle && window.__warlordBattle.live &&
      window.__warlordBattle.live(), 300000);
    if (!B0) return { ok: false, err: "battle never started" };
    const B = window.__warlordBattle;
    if (!B.execute || !B.shotAudit) return { ok: false, err: "battle.js has no death studio (execute/shotAudit)" };
    /* FREEZE THE WALL CLOCK. Everything after this is advance() and nothing
       else, so both builds walk identical simulated seconds whatever the
       software rasteriser under them is doing — and, for this preset
       especially, so that "0.06 s after the round" is 0.06 s of WORLD rather
       than "one frame, whatever that frame took". */
    B.freeze();
    S = window.__warlordDeathStudio = { B, t: 0, last: null, shot: null, killT: 0,
                                        range0: CBZ.CONFIG.RAGDOLL_RANGE };
    window.__cbzVisualCompare = {
      render() { try { S.B.render(); } catch (_) {} },
      advance(sec) { try { S.B.advance(sec); S.t += sec; } catch (_) {} },
      metrics() { return S.last || {}; },
    };

    /* WAIT FOR THE FIGHT, DO NOT GUESS AT IT. A death staged at t = 0 is a man
       shot on a start line with two hundred metres of empty sand behind him;
       the subject is a death IN a battle. The first draft advanced a fixed
       26 s and photographed exactly that — the nearest enemy was 139 m from
       the warlord and the frame had nobody else in it. So it advances until
       rounds are genuinely landing (five real casualties, which is contact)
       with a hard ceiling, so a build where nobody closes cannot hang the
       capture. The clock is frozen and the seed is fixed, so both builds reach
       the same second by the same route and this stays controlled. */
    for (let i = 0; i < 24; i++) {
      B.advance(5); S.t += 5;
      let a = null; try { a = B.audit(); } catch (_) {}
      if (!a || !a.live) break;
      if ((a.mine.dead + a.them.dead) >= 5) break;
    }
  }
  const B = S.B;
  const subject = input.subject;

  /* THE SEAT IS RE-STATED BEFORE EVERY DRAW. battle.js's command camera eases
     its focus toward the midpoint of the two masses every frame, which is
     right for a battle and wrong for a close-up — MEASURED, the lens drifts
     from 8.7 m off the corpse to 48 m over the 1.6 s this death takes.
     Re-pointing before each render costs one frame of drift instead of ninety-
     six. B.camera("cmd") first and B.look() second, in that order, because
     look() writes only battle.js's camMode and warlord/gunplay.js re-places
     the lens from ITS own copy every frame. */
  const reseat = () => {
    if (!S.shot) return;
    B.camera("cmd");
    B.look({ x: S.shot.cam.x, z: S.shot.cam.z, dist: S.shot.cam.dist,
             yaw: S.shot.cam.yaw, pitch: 0.12 });
  };

  const snap = () => {
    let a = null, sa = null, ga = null;
    try { a = B.audit(); } catch (_) {}
    try { sa = B.shotAudit(); } catch (_) {}
    try { ga = CBZ.goreAudit ? CBZ.goreAudit() : null; } catch (_) {}
    const d = (a && a.deaths) || {};
    /* THE FOLD METRICS ARE ONLY REPORTED WHEN THE FOLD OWNS THE BODY, and
       leaving that out cost a false regression on the first run of this
       preset. tiltDeg and alongShot describe warlord/deaths.js's four beats.
       When city/ragdoll.js takes the man instead, those numbers are the VERLET
       SOLVER's answer — and the solver is byte-identical on both sides of this
       flag, so comparing them is comparing a build against itself. The first
       run duly reported "Fall direction vs the round 0.87 -> 0.85" as a
       REGRESSION: two ragdolls, two hundredths of a cosine apart, i.e. the
       preset's own noise floor. A metric a change does not claim must not be
       gated on. Omitted (not zeroed) so the row simply does not appear for
       those subjects rather than appearing as a fake zero. */
    const fold = !!sa && !sa.ragdoll && !subject.wide;
    const m = {
      /* THE SEQUENCE, read off the rig's own world quaternion */
      beatT: sa && !subject.wide ? sa.t : undefined,
      tiltDeg: fold ? sa.tiltDeg : undefined,
      alongShot: fold ? sa.alongShot : undefined,
      posedAtBeat: sa && !subject.wide ? (sa.posed ? 1 : 0) : undefined,
      hasBody: sa && !subject.wide ? (sa.ragdoll ? 1 : 0) : undefined,
      /* THE BLOOD. `bloodInAir` is droplets + aerosol still flying, `pools` is
         what has landed and is spreading. Both are structurally zero on the
         before side: systems/gore.js is never fetched under ?deaths=old. */
      bloodInAir: ga ? ((ga.drops | 0) + (ga.mist | 0)) : 0,
      pools: ga ? (ga.pools | 0) : 0,
      /* THE BUDGET */
      fellTotal: d.fell || 0,
      tier2: d.tier2 || 0, tier1: d.tier1 || 0, tier0: d.tier0 || 0,
      bodies: d.bodies || 0, denied: d.denied || 0,
      bloodEvents: d.bloodEvents || 0,
      rimMarks: d.marks || 0,
      solving: a ? a.solving : 0,
      /* THE TIME. Seconds of this battle spent under a hit-stop or slow-mo. */
      warpS: d.warpS || 0,
      menAlive: a && a.mine ? a.mine.alive : 0,
      enemyAlive: a && a.them ? a.them.alive : 0,
      fps: a ? a.fps : 0,
    };
    S.last = m;
    return m;
  };

  const step = (sec) => {
    /* 1/120 s slices. The first beat is 0.06 s out and the struck beat runs
       about 0.2 s; a 1/60 step straddles both, and the whole point of a frozen
       clock is that the moment is CHOSEN rather than sampled. */
    let left = sec;
    while (left > 1e-5) { const d = Math.min(1 / 120, left); B.advance(d); S.t += d; left -= d; }
  };

  /* ---- WIDE: the solver at its real ceiling, the whole line in frame ------ */
  if (subject.wide) {
    if (subject.restore) CBZ.CONFIG.RAGDOLL_RANGE = S.range0;
    S.shot = null;
    if (!subject.ownMan) { B.order("charge"); step(14); }
    B.camera("cmd");
    B.look({ pitch: 0.20, yaw: 1.55 });
    /* THE RIM MARK IS DRAWN THE FRAME THE MAN FALLS AND FADES OVER 1.45 s OF
       WALL TIME — it is UI, and UI runs on the clock a person's eyes run on,
       not on a frozen sim clock. That makes it invisible to a storyboard that
       advances a battle for ninety wall-seconds and only then draws: every
       mark from that battle has aged out. So this subject kills one of YOUR
       OWN men on the frame before the render, with `cam:false` so the lens
       stays wide — a mark that tells you WHERE is not a mark you photograph by
       pointing the camera at the man. */
    if (subject.ownMan) {
      const r = B.execute({ team: "mine", cam: false });
      if (!r) return { ok: false, err: "none of your men left to lose" };
      S.shot = r;
    }
    B.render();
    return { ok: true, metrics: snap(), simT: Math.round(S.t * 10) / 10 };
  }

  /* ---- A STAGED DEATH ---------------------------------------------------- */
  if (subject.kill) {
    /* DENY THE VERLET BODY BY THE ENGINE'S OWN GATE. city/ragdoll.js refuses a
       kill further than RAGDOLL_RANGE from the camera — "far kills keep the
       cheap path", its own comment. Half a metre refuses every one, which is
       the honest way to photograph what the 272nd man of a 300 v 300 volley
       gets once the 28 solver slots are spent: the same refusal, from the same
       function, without needing 600 rigs in frame to manufacture it. Set
       identically on BOTH builds, so it is a constant, not a variable. */
    CBZ.CONFIG.RAGDOLL_RANGE = subject.deny ? 0.5 : S.range0;
    /* 9 m and 1.15 rad off the shot line: near enough that gore.js draws (its
       gate is 70 m, and it halves the particle count past 40) and far enough
       that a 1.8 m man folding is a whole man in the frame. */
    const r = B.execute({ dist: 9, off: 1.15, pitch: 0.12 });
    if (!r) return { ok: false, err: "nobody left to execute" };
    S.shot = r;
    S.killT = S.t;
  }
  if (!S.shot) return { ok: false, err: "no staged death — a kill subject must run first" };

  const want = (S.killT + subject.at) - S.t;
  if (want > 0) step(want);
  reseat();
  B.render();
  return { ok: true, metrics: snap(), simT: Math.round(S.t * 10) / 10, beat: subject.at };
}

export default {
  id: "warlord-death",
  title: "Desert Warlord: A Man Dying, Frame by Frame",
  description:
    "One death, the same man, the same second, the same seat, photographed at 0.06 s, 0.36 s and 1.60 s after the round lands — plus the whole line under a volley, where the budget decides who gets the treatment. The before side boots ?deaths=old, warlord/deaths.js's own revert: pose on frame zero, a coin-flip plank, no blood, no hit-stop.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { deaths: "old" },
  beforeLabel: "BEFORE · ?deaths=old (pose on frame zero, one-axis plank, no blood)",
  afterLabel: "AFTER · the four beats, ranked, with blood and time",
  viewport: { width: 1180, height: 700 },
  /* 60 a side rather than 300: the volley subject needs enough men that the
     budget has something to refuse, and a software rasteriser running 600
     rigs turns a four-minute capture into an hour. The 300 v 300 frame cost
     is measured separately, headless, without a renderer in the way — a
     picture is the wrong instrument for a millisecond. */
  urlParams: { battle: 1, frozen: 1, mine: 60, them: 60, seed: 1337, gun: "ak47",
    faction: "militia", myfaction: "militia" },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  stageTimeoutMs: 600000,
  pairNote: "Same checkout · seed · rosters · ground · camera seat · simulated second · same man shot — ?deaths=old is the only variable",
  method:
    "games/warlord.html boots ?battle=1&frozen=1, so battle.js begins with requestAnimationFrame stopped and every second that passes is one the preset asked for through advance(), which runs the page's own frame through microboot's headless stepSim. After 26 s of the two lines closing, battle.js's execute() names the enemy nearest the warlord, seats the command camera 9 m out and 1.15 rad off the shot line, and kills him with by:YOU. The three beats are then reached in 1/120 s slices — the first beat is 0.06 s long and a 1/60 step would straddle it. Every number in the table is read back through battle.js's shotAudit(), which measures the corpse's actual world quaternion (his own up axis, transformed) rather than the bookkeeping that produced it, and through systems/gore.js's own goreAudit().",
  metricsNote:
    "posedAtBeat is the whole report in one bit: was the man already snapped into his final dead sprawl on the frame the round arrived? CBZ.deathPose writes an absolute crumple — arms flung, knees drawn, head aside — and the old path called it on frame zero while he was still standing, so the answer was YES every time and there was nothing left for the fall to show. tiltDeg is how far off vertical he is (0 standing, 90 flat), read off his rig's own up axis. alongShot is the cosine between the bearing his head travelled and the bearing the round did: +1 is a man knocked down by the bullet that killed him, -1 is a man who fell into it, and the old coin-flip direction averages zero over a run. bloodInAir and pools are structurally zero on the before side because systems/gore.js is not fetched at all under ?deaths=old — it lives in the studio 'blood' pack, which games/warlord.html's need() list has never asked for. warpS is seconds spent under a hit-stop or slow-mo: also structurally zero before, because CBZ.doHitstop is declared in core/loop.js, the CITY's frame loop, and this page runs core/microboot.js — so systems/fpsmode.js has been calling it into `undefined` on every landed round since gunplay.js mounted it. denied is how many deaths wanted a verlet body and lost the rank: zero would mean the budget is not doing anything.",
  metrics: {
    beatT: { label: "Time since the round landed", unit: "s" },
    tiltDeg: { label: "How far over he is", unit: "deg off vertical" },
    alongShot: { label: "Fall direction vs the round", unit: "cos", better: "higher" },
    posedAtBeat: { label: "Already in his final dead pose", unit: "0/1", better: "lower" },
    hasBody: { label: "Got a verlet body", unit: "0/1" },
    bloodInAir: { label: "Blood still in the air", unit: "droplets", better: "higher" },
    pools: { label: "Pools on the sand", unit: "decals", better: "higher" },
    fellTotal: { label: "Men who have fallen", unit: "men" },
    tier2: { label: "Deaths that were about YOU", unit: "men" },
    tier1: { label: "Deaths you could see", unit: "men" },
    tier0: { label: "Deaths on the far wing", unit: "men" },
    bodies: { label: "Verlet bodies spent", unit: "men", better: "higher" },
    denied: { label: "Wanted a body, lost the rank", unit: "men" },
    bloodEvents: { label: "Blood events fired", unit: "deaths", better: "higher" },
    rimMarks: { label: "Rim marks drawn (was the kill feed)", unit: "marks", better: "higher" },
    solving: { label: "Corpses on the ragdoll solver", unit: "bodies" },
    warpS: { label: "Battle time under hit-stop / slow-mo", unit: "s", better: "higher" },
    menAlive: { label: "Your men standing", unit: "men" },
    enemyAlive: { label: "Enemy standing", unit: "men" },
    fps: { label: "Frame rate", unit: "fps", better: "higher" },
  },
  subjects,
  stage: stageWarlordDeath,
};
