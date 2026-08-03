/* Gang-city NPC gestures, photographed up close, for tools/visual-compare.mjs.

   Same live-game staging as outfit-gallery / store-dress (boot the real city
   once per side, freeze the rAF loop, CBZ.stepSim(1/60) is the only clock).
   Each subject grabs a LIVE ped out of CBZ.cityPeds, teleports it once onto a
   fixed studio mark near the player, writes the REAL internal state the ped
   brain reads (witness report machine, posePoint, surrender flags, fear,
   relPlayer.grudge, cash/wealth, aggr), steps the sim, and shoots a waist-up
   close-up. Nothing here pokes a rig transform to fake a pose: the picture is
   whatever the game's own drivers do with that state.

   WHY the shots are close: a gesture that cannot be read at conversational
   distance is not a gesture. The whole storyboard is "can you tell what this
   person is doing without a toast telling you".

   Studio geometry (fixed world axes, never derived from a posed quaternion —
   outfit-gallery.mjs:201-206 documents why; `cam.az` below is a WORLD bearing
   constant per beat, identical on both sides, so a ped who stands differently
   on the two builds is the delta and the lens never is):
     player  at (gx, gz)                      — the game's own player spawn
     subject at (gx, gz + dist)               — dist is per-beat, 6..9 m
     camera  at (subject + polar(cam.az, cam.dist)) looking at the sternum
   The player therefore sits BEHIND the camera on every beat and never enters
   frame, and the ped — which faces the player for most of these states — is
   caught in a three-quarter front view.

   TWO ART-DIRECTION FACTS the first contact sheet taught, both about the fact
   that EVERY tell in this wave lives in the ARMS (poses.js is rotation-only on
   la/ra, tells.js documents why):
   - the lens sits on the subject's RIGHT (cam.az defaults 45 deg off his
     forward, right shoulder to camera). The phone, the accusatory point and
     the wave are all RIGHT-hand gestures; shot from his left they hide behind
     his own torso, which is exactly what the first pass photographed.
   - the frame runs head-to-thigh, not head-to-navel. A 2.5 m lens cropped the
     hands off the bottom edge and the skull off the top, so the pictures were
     of a face when the subject of every one of them is a pair of arms. Caption
     furniture moved to a lower third for the same reason: it was printed
     across the subject's head.

   Two staging footguns this file obeys:
   - teleport ONCE, then settle WITHOUT re-teleporting (outfit-gallery.mjs:
     155-159): re-setting pos every tick holds the rig airborne and every shot
     catches the falling pose.
   - a HELD pose only applies while the rig is idle (character.js:2222 gates
     CBZ.charPoses[ch.pose] on !moving, speed > 0.2), so the hold loop pins
     state/speed every tick instead of once.

   Deployed-side absence: NONE of the coordinated names (CBZ.CONFIG
   .CITY_NPC_TELLS, CBZ.CONFIG.CITY_GESTURE_LEGIBILITY, CBZ.charPoses
   .tellWary/tellPockets/tellSwagger, CBZ.cityTellsAudit, ped._phoneProp)
   exist on the deployed build. Every one of them is reached through a guard
   and a missing one degrades to "the ped just stands there" — which IS the
   before-side evidence — never to a failed beat. */

const subjects = [
  { id: "idle-baseline", label: "Control — an untouched ped", gesture: "idle", dist: 8, secs: 0.6,
    focus: "The control shot. Nobody touched this person's state; whatever the idle rig does at conversational distance is the baseline both sides are measured against.",
    expect: { kind: "idle" } },

  { id: "phone-911", label: "Calling it in", gesture: "phone", dist: 9, secs: 0.8,
    focus: "The witness report machine, staged the way peds.js does it: witnessSev/witnessType + reportState='phone'. Before: a bare hand cupped to the ear. After: an actual phone in the hand and a shifty half-turn away from you.",
    // the snitch turn is a shoulder given to the PLAYER, and the player is
    // behind the lens — so the house tripod caught the back of his head and the
    // handset behind his own skull. Swing the camera round onto the side he
    // turns TOWARD: the phone is then against the ear in three-quarter profile
    // and the turned-away body still reads, because it is turned away from the
    // camera too. (On the deployed build there is no turn, the same tripod
    // catches him square-on with an empty fist at his ear — which is the point.)
    cam: { az: 2.94, dist: 3.7 },
    expect: { kind: "prop", field: "_phoneProp" } },

  { id: "point-out", label: "“That's the one”", gesture: "point", dist: 8, secs: 0.35,
    focus: "posePoint = 1.4 — the accusatory point a grudge witness throws when they reach an officer. The arm has to come up far enough to read as an accusation, not a stretch.",
    // the arm is thrown down the sight line to the player, i.e. into the lens,
    // where it foreshortens. Swinging round onto his side lengthened it and put
    // the tripod behind a parked windscreen on this mark — two plates came back
    // as a bonnet with a hand over it — so the beat keeps the house azimuth
    // (proven clear here on four other beats) and buys the arm back with
    // distance instead. It still crosses two-thirds of its true length.
    cam: { az: 3.85, dist: 4.0 },
    expect: { kind: "arm", axis: "x", below: -1.0 } },

  { id: "kinwave-greet", label: "Two people who know each other", gesture: "kinwave", dist: 9, secs: 0.9,
    focus: "kinWave on one of a linked pair. The pose exists on both builds — the delta is AIM: a wave thrown at nobody is not a greeting. Both peds are deliberately placed off-axis so a mis-aimed wave is visible, and waveAimDeg is the angle between the waver's facing and the bearing to their partner.",
    // broadside to the line between the two of them: an aimed wave reads as two
    // people squared up to each other, a mis-aimed one as a man waving out of
    // frame. That difference is invisible from anywhere on their own axis.
    cam: { az: 2.85, dist: 4.6, fov: 36, eye: 2.30, aim: 1.15 },
    expect: { kind: "pose", pose: "kinWave" }, direct: true },

  { id: "hands-up", label: "Surrender (existing, for contrast)", gesture: "handsup", dist: 8, secs: 0.7,
    focus: "The one gesture the city already reads clearly: real surrender through ped.surrender/poseHandsUp, with animChar owning the arms. Every new tell should be this legible.",
    // the only beat whose hands go ABOVE the head — the house frame tops out at
    // the crown and would guillotine them.
    cam: { dist: 4.15, eye: 2.32, aim: 1.26 },
    expect: { kind: "charFlag", field: "handsUp" } },

  { id: "fear-wary", label: "Wary — scared but not surrendering", gesture: "fear", dist: 8, secs: 1.0,
    focus: "fear parked in the wary band (below the flee/surrender thresholds) and left to the tells driver. Before: this pose does not exist on the deployed build and the ped is a statue — the statue IS the evidence. After: tellWary.",
    expect: { kind: "pose", pose: "tellWary" } },

  { id: "grudge-stare", label: "The street remembers you", gesture: "grudge", dist: 6, secs: 1.0,
    focus: "relPlayer.grudge = 80 with the player inside 8 m. Before: nothing — a person who hates you walks past like weather. After: a folded-arms mad-dog stare held on you.",
    expect: { kind: "pose", pose: "foldarms" } },

  { id: "broke-pockets", label: "Broke", gesture: "broke", dist: 8, secs: 1.0,
    focus: "cash = 0, wealth = 0. Before: identical to a millionaire. After: hands in empty pockets — wealth you can read off a silhouette instead of off a wallet you have to mug.",
    expect: { kind: "pose", pose: "tellPockets" } },

  { id: "swagger", label: "Somebody looking for it", gesture: "swagger", dist: 9, secs: 1.0,
    focus: "aggr = 0.95 — the violent band. Before: walks like everyone else right up until it mugs you. After: tellSwagger, so the threat is legible BEFORE it costs you anything.",
    expect: { kind: "pose", pose: "tellSwagger" } },
];

async function stageGestures(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__gestOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__npcGestures;
  if (!S) {
    // ---- one-time: boot the real city into free play ---------------------
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // Freeze the rAF loop; from here stepSim is the only clock.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 60; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      if (CBZ.player) CBZ.player.hp = 100;
    }

    // Studio mark: WHEREVER THE GAME ITSELF PUT THE PLAYER on this seed.
    //
    // The lot centroid was the obvious choice and it was wrong. `arena.lots`
    // fills in on deferred passes, so which lots existed at the instant we
    // averaged them changed from boot to boot: the mark wandered, three
    // consecutive runs photographed three different backdrops, and one of them
    // parked the mark where floorAt() disagreed with the rendered ground by
    // most of a body — the subject came out buried to the shoulders with the
    // camera 30 cm off the grass. A mark you cannot reproduce is not a studio.
    // The player's own spawn has already been resolved by the game's physics
    // before we look at it, it is on walkable city ground by construction, and
    // the same seed puts it in the same place on both sides.
    const gx = CBZ.player.pos.x, gz = CBZ.player.pos.z;
    const gy = CBZ.player.pos.y;

    const overlay = document.createElement("div");
    overlay.id = "__gestOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    // caption furniture lives in a LOWER THIRD. The first contact sheet printed
    // the title across the subject's face and the focus line across his
    // shoulders; the whole upper frame belongs to the body being photographed.
    // The scrim is what makes 12px type survive the city's white noon pavement.
    overlay.innerHTML = "<div data-scrim></div><div data-side></div><div data-name></div>" +
      "<div data-focus></div><div data-read></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__npcGestures = { gx, gz, gy, overlay, used: [], staged: [], hidden: [] };
    window.__cbzVisualCompare = {
      render() {
        try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
      },
    };
  }

  const sub = input.subject;
  const P = CBZ.player;
  if (!P || !P.pos) return { ok: false, err: "no player" };

  // Does this build carry the tells work at all? Used ONLY to decide whether a
  // direct setCharPose fallback is legitimate: on the deployed build neither
  // name exists, no fallback fires, and the ped honestly reads as a statue.
  const tellsBuild = !!(CBZ.CONFIG && CBZ.CONFIG.CITY_NPC_TELLS) ||
    typeof CBZ.cityTellsAudit === "function";

  // ---- park the player on the mark (once per beat, then never again) -----
  if (CBZ.game) CBZ.game.cityHolstered = true;
  if (P.pos.set) {
    P.pos.set(S.gx, S.gy + 0.08, S.gz);
    P.vy = 0; P.grounded = true; P.hp = 100; P.dead = false;
  }

  // ---- send the PREVIOUS beat's actors off the mark ----------------------
  // (they are teleported, not re-staged, so re-teleporting them is free —
  //  the airborne-pose footgun only bites the ped we are about to photograph)
  for (const old of S.staged) {
    if (!old || !old.pos || !old.pos.set) continue;
    const ox = S.gx + 55, oz = S.gz + 55;
    old.pos.set(ox, (CBZ.floorAt && CBZ.floorAt(ox, oz)) || S.gy, oz);
    old.state = "walk"; old.pause = 0; old.speed = 0;
    old.reportState = null; old.reportT = 0; old.witnessSev = 0; old.posePoint = 0;
    old.surrender = false; old.surrenderT = 0; old.poseHandsUp = false;
    if (old.char) { old.char.handsUp = false; old.char.surrender = false; old.char.pose = null; }
  }
  S.staged = [];

  // ---- give the driver a clean budget for THIS beat -----------------------
  // tells.js runs on caps (8 reactive, 14 ambient) and by the time a beat
  // stages its subject those slots are full of ordinary peds who happen to be
  // standing near the player — so the studio subject was losing a lottery it
  // had no business being in, and every plate read `driver no`. cityTellsReset()
  // is the driver's own published stand-down (mode.js calls it on a fresh run);
  // it hands every borrowed pose back and clears the counters, which also makes
  // every audit_* number on a plate mean "this beat" instead of "everything
  // since boot". Absent on the deployed build, where nothing needs standing
  // down in the first place.
  if (typeof CBZ.cityTellsReset === "function") { try { CBZ.cityTellsReset(); } catch (_) {} }

  // ---- find live peds ----------------------------------------------------
  // cityPeds populates on deferred passes; poll/step until it has bodies
  // (store-dress.mjs:94-106 pattern).
  const eligible = () => (CBZ.cityPeds || []).filter((p) =>
    p && !p.dead && !p.isPlayer && !(p.ko > 0) && !p.inCar && !p._npcAttached &&
    !p._spawnHidden && !p.armed && !p.vendor && !p.controlled && !p.companion &&
    p.kind !== "cop" && p.kind !== "security" &&        // casting: civilians only
    !p.reportState && !(p.posePoint > 0) && !p.surrender && !p.poseHandsUp &&
    !p.recruited && !p.rage && !p._bumHunt && !(p.enterT > 0) &&
    p.pos && p.pos.set && p.group && p.char && p.char.parts && p.char.parts.ra &&
    S.used.indexOf(p) < 0);
  let pool = eligible();
  for (let i = 0; i < 240 && pool.length < (sub.gesture === "kinwave" ? 2 : 1); i++) {
    CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
    if (CBZ.player) CBZ.player.hp = 100;
    pool = eligible();
  }
  if (!pool.length) return { ok: false, err: "no eligible cityPeds" };

  const need = sub.gesture === "kinwave" ? 2 : 1;
  const cast = pool.slice(0, need);
  if (cast.length < need) return { ok: false, err: "only " + cast.length + " peds for " + sub.id };
  for (const p of cast) { S.used.push(p); S.staged.push(p); }
  const ped = cast[0];
  const mate = cast[1] || null;

  // ---- teleport ONCE onto the mark, kill the walk ------------------------
  const sx = S.gx, sz = S.gz + (sub.dist || 8);
  const place = (p, x, z) => {
    // …and never further than a step off the mark's own floor. Six metres of
    // pavement does not change height by a metre; if floorAt says it does, it
    // has answered about something other than the ground we are standing on
    // and taking its word buries the subject.
    const fy = CBZ.floorAt ? CBZ.floorAt(x, z) : null;
    const y = (Number.isFinite(fy) && Math.abs(fy - S.gy) < 1.2) ? fy : S.gy;
    p.pos.set(x, y, z);
    if (p.target && p.target.set) p.target.set(x, 0, z);
    p.path = null; p.finalGoal = null; p.speed = 0; p.state = "idle";
    p.pause = 9; p.rage = null; p.attackCD = 40; p.alarmed = 0;
    return y;
  };
  place(ped, sx, sz);
  if (mate) place(mate, sx + 2.0, sz + 0.6);
  // face the player (world -Z from the mark) unless the beat re-aims below
  const facePlayer = () => Math.atan2(S.gx - ped.pos.x, S.gz - ped.pos.z);
  ped.group.rotation.y = facePlayer();
  if (mate) mate.group.rotation.y = Math.atan2(ped.pos.x - mate.pos.x, ped.pos.z - mate.pos.z);

  // ---- write the REAL internal state this beat is about ------------------
  const ch = ped.char;
  const g = sub.gesture;
  const playerActor = (CBZ.city && CBZ.city.playerActor) || P;
  let waveAimDeg = null;
  // beats whose subject is the tells DRIVER (as opposed to a pose this preset
  // sets by hand, or a gesture that rides char flags instead of a pose row)
  const poseBeat = (sub.expect || {}).kind === "pose" && !sub.direct;
  // …but once the fallback below has posed the body BY HAND, the studio owns
  // the slot and must stop clearing it out from under itself.
  let handPosed = false;

  // hold(): re-applied EVERY tick. A held pose only reaches the rig while the
  // body is idle, and the ped brain will happily re-goal a parked civilian, so
  // the state has to be pinned per-tick rather than once.
  const hold = () => {
    if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
    for (const p of cast) {
      if (!p || p.dead) continue;
      p.pause = 9; p.attackCD = 40; p.rage = null;
      p.path = null; p.finalGoal = null;
      // PIN THE TARGET TO HIS OWN FEET, every tick. `pause` is not actually a
      // leash — think()'s erratic/drug-user branch (peds.js:4691-4703) re-goals
      // straight through it, and a beat that catches the ped one frame into a
      // walk loses the pose outright, because animChar only runs a registry
      // pose while the body is still. A ped who has already arrived cannot
      // accelerate, whatever the brain decided this frame.
      if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z);
      p.drugUser = false; p.erratic = 0; p.tweakT = 99;
      // NOBODY ELSE'S GESTURE ON OUR SUBJECT. peds.js's post-anim witness block
      // is an if/else-if chain with the phone call at the top of it, so a ped
      // who walked onto the mark already dialling out-ranks whatever this beat
      // staged — the point-out plate came back as a man on the phone and scored
      // its own gesture as a miss. The cast filter above now refuses anyone
      // mid-gesture; this refuses one who starts one while we hold him.
      if (g !== "phone") { p.reportState = null; p.reportT = 0; p.witnessSev = 0; }
      if (g !== "point") p.posePoint = 0;
      if (g !== "phone") { p.state = "idle"; p.speed = 0; }
    }
    // HAND THE POSE SLOT BACK TO THE DRIVER WE ARE PHOTOGRAPHING. tells.js
    // yields the instant anybody else owns ch.pose, and a random idling
    // civilian is exactly who dialogue.js and kinship.js claim — so the beat
    // was measuring "did somebody else get there first". Clearing a foreign
    // pose every tick is the studio equivalent of asking the extras to step
    // out of shot. Only on the beats whose subject IS the tells driver:
    // kinwave sets its pose by hand and hands-up rides char flags, not a row.
    if (poseBeat && !handPosed) {
      const c = ped.char;
      if (c && c.pose && c.pose !== ped._tellPose) c.pose = null;
      ped._kinBeat = null; ped._kinGrief = null; ped._kinUnit = null; ped.chatT = 0;
    }
    if (g === "phone") {
      // tickReport() cancels the call the moment the witness forgets the crime,
      // so the witness tag has to stay live for the whole burst.
      ped.mem = playerActor;
      ped.witnessSev = Math.max(ped.witnessSev || 0, 12);
      ped.witnessType = ped.witnessType || "murder";
      ped.reportState = "phone";
      ped.reportTarget = null;
      ped.reportT = 30;            // long enough that the call cannot LAND mid-shot
      ped.speed = 0;
      // WHICH shoulder he gives you is a coin the ped's own spawn hash flips
      // (peds.js:3859), and half of that coin turns the handset behind his skull
      // from a fixed tripod. Pin the sign — the MAGNITUDE stays inside the
      // shipped 0.80..1.14 band, so this is casting, not a different gesture.
      // Absent on the deployed build, where the field does not exist at all.
      ped._snitchTurn = -0.92;
    } else if (g === "point") {
      ped.posePoint = Math.max(ped.posePoint || 0, 1.4);
    } else if (g === "handsup") {
      // char.handsUp is rewritten from the surrender state every tick in move()
      // (peds.js:5305) — setting the flag alone would be erased. Drive the real
      // state instead.
      ped.surrender = true;
      ped.surrenderT = Math.max(ped.surrenderT || 0, 8);
      ped.poseHandsUp = true;
    } else if (g === "fear") {
      // the WARY band: high enough to be scared, below the flee (>=4) and
      // surrender thresholds, and re-applied because think() decays it.
      ped.fear = 3;
      ped.surrender = false; ped.surrenderT = 0; ped.poseHandsUp = false;
    } else if (g === "grudge") {
      const rel = ped.relPlayer || (ped.relPlayer = {
        respect: 0, fear: 0, loyalty: 0, affection: 0, grudge: 0, seen: 1, t: 0,
      });
      rel.grudge = 80; rel.seen = 1;
      ped.mem = ped.mem || playerActor;
      ped.group.rotation.y = facePlayer();
    } else if (g === "broke") {
      ped.cash = 0; ped.wealth = 0;
    } else if (g === "swagger") {
      ped.aggr = 0.95;
    }
  };

  const burst = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      hold();
      CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
    }
  };

  hold();
  burst(0.5);   // settle onto the ground and into the idle rig

  let kinStarted = false;
  if (g === "kinwave") {
    // Link the pair the way the ped record already models it, then DRIVE THE
    // REAL GREETING. The first cut set kinWave by hand through the pose
    // registry, which photographed an arm nobody had aimed and measured
    // nothing: the turn this wave changed lives inside kinship.js's own beat
    // (tickBeat -> faceAt), and a pose set from outside never reaches it.
    ped.partner = mate; if (mate) mate.partner = ped;
    const bearing = mate ? Math.atan2(mate.pos.x - ped.pos.x, mate.pos.z - ped.pos.z) : 0;
    // kinship.js refuses a beat for anybody the world has already given a job
    // to (claimed(), kinship.js:200) — and a ped this preset has been holding
    // on a mark for a second carries a couple of those marks by accident.
    // Clear the ones staging itself put there; anything else is a real refusal
    // and the degrade below is the honest answer to it.
    for (const p of cast) {
      if (!p) continue;
      p.alarmed = 0; p.approach = null; p.reportState = null; p.rage = null;
      p.surrender = false; p.poseHandsUp = false; p.enterT = 0;
      p._kinBeat = null; p._kinGrief = null;
    }
    if (typeof CBZ.kinshipGreet === "function" && mate) {
      try { kinStarted = !!CBZ.kinshipGreet(ped, mate, { kind: "greet", secs: 3.2 }); } catch (_) {}
    }
    ped.group.rotation.y = bearing + 1.75;   // ~100 deg off: a wave at nobody
    if (kinStarted) {
      // SHOOT WHILE THE HAND IS STILL GOING UP. faceAt's rate is a per-FRAME
      // lerp, so both builds have their man square on his partner within a
      // fifth of a second — the only honest place to compare 0.35 against 0.6
      // is inside the window the change is about, which is the first, most
      // legible half of the wave. Four frames: the arm is ~two-thirds up and
      // the two builds are still tens of degrees apart.
      for (let i = 0; i < 4; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    } else if (CBZ.setCharPose && CBZ.charPoses && CBZ.charPoses.kinWave) {
      // degrade: a build (or a moment) where the beat refuses still gets a
      // picture of the pose, and waveAimDeg honestly reports the un-aimed 100.
      try { CBZ.setCharPose(ch, "kinWave"); } catch (_) {}
      if (mate && mate.char) { try { CBZ.setCharPose(mate.char, "kinListen"); } catch (_) {} }
    }
  }

  if (!kinStarted) {
    burst(sub.secs || 0.6);
    hold();  // one last pin so the plate's caption reports the staged state,
             // not whatever the brain scribbled on the way out of the step
  }

  // ---- did the expected read land? ---------------------------------------
  const expect = sub.expect || {};
  const poseName = expect.pose || null;
  let driverApplied = null;
  if (expect.kind === "pose" && !sub.direct) {
    const poseExists = !!(CBZ.charPoses && CBZ.charPoses[poseName]);
    driverApplied = (poseExists && ch && ch.pose === poseName) ? 1 : 0;
    // FALLBACK, only on a build that actually carries the tells work: the
    // driver's own conditions can be fiddly and a missed condition must not
    // cost the storyboard its picture. On the deployed build neither the flag
    // nor the audit exists, nothing fires, and the statue is the evidence.
    if (!driverApplied && poseExists && tellsBuild && CBZ.setCharPose) {
      // tellWary is GRADED through ch._tellK, and a tell the driver has already
      // let go of leaves that number at 0 — where the row damps every joint
      // back to a normal stand. So the naive fallback photographed a man
      // standing still and captioned it "wary". Restate the amplitude the
      // staged fear implies (tells.js waryK: (fear - WARY_LO) / (WARY_HI -
      // WARY_LO) = (3 - 1) / 3) so the plate can never be a silent no-op.
      if (poseName === "tellWary") ch._tellK = Math.max(ch._tellK || 0, 0.67);
      handPosed = true;
      try { CBZ.setCharPose(ch, poseName); } catch (_) {}
      burst(0.3);
    }
  }

  const armX = (ch && ch.parts && ch.parts.ra) ? ch.parts.ra.rotation.x : 0;
  let poseApplied = 0;
  if (expect.kind === "idle") {
    poseApplied = (!(ch && ch.pose) && ped.state === "idle") ? 1 : 0;
  } else if (expect.kind === "prop") {
    const prop = ped[expect.field];
    poseApplied = prop ? ((prop.visible === false) ? 0 : 1) : 0;
  } else if (expect.kind === "arm") {
    poseApplied = armX <= (expect.below != null ? expect.below : -1.0) ? 1 : 0;
  } else if (expect.kind === "charFlag") {
    poseApplied = (ch && ch[expect.field]) ? 1 : 0;
  } else if (expect.kind === "pose") {
    poseApplied = (CBZ.charPoses && CBZ.charPoses[poseName] && ch && ch.pose === poseName) ? 1 : 0;
  }

  if (g === "kinwave" && mate) {
    const bearing = Math.atan2(mate.pos.x - ped.pos.x, mate.pos.z - ped.pos.z);
    let d = ped.group.rotation.y - bearing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    waveAimDeg = Math.round(Math.abs(d) * 180 / Math.PI);
  }

  // ---- frame: fixed world-axis tripod, waist-up, player behind the lens ---
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.near = 0.05;
  camera.far = 4000;
  const eye = new T.Vector3();
  const aim = new T.Vector3();
  // THE HOUSE LENS + this beat's overrides. `az` is a WORLD bearing from the
  // subject to the camera; the default puts it ~40 deg off the forward of a ped
  // who is facing the player — his RIGHT shoulder to us, because every gesture
  // in this wave is a right-hand gesture. dist/fov frame head-to-thigh so the
  // ARMS are the picture. Polar around the subject, so a beat can move the
  // camera ROUND the body without also moving it nearer or lower, and every
  // override is a CONSTANT rather than a read of the posed body: both builds
  // get the same tripod and the ped's stance is the only thing that can differ.
  // (declared here, not at module scope: visual-compare serializes this one
  //  function into the page, so nothing outside it exists at runtime.)
  // The lens also sits ABOVE the subject's eyeline and tilts down ~15 deg. That
  // is not style: at eye level the city's horizon ran straight through every
  // subject's skull and a pale ped stood against a pale sky, so the arms — the
  // entire subject of this storyboard — had nothing to silhouette against. From
  // here the horizon leaves by the top edge and every gesture is read against
  // the ground plane instead.
  const L = Object.assign({ az: 3.85, dist: 3.7, fov: 30, eye: 2.12, aim: 1.12 }, sub.cam || {});
  // both bodies in frame: aim at the midpoint of the pair instead
  const cx = mate ? (ped.pos.x + mate.pos.x) / 2 : ped.pos.x;
  const cz = mate ? (ped.pos.z + mate.pos.z) / 2 : ped.pos.z;
  const cy = mate ? Math.min(ped.pos.y, mate.pos.y) : ped.pos.y;
  camera.fov = L.fov;
  eye.set(cx + Math.sin(L.az) * L.dist, cy + L.eye, cz + Math.cos(L.az) * L.dist);
  aim.set(cx, cy + L.aim, cz);
  camera.position.copy(eye);
  camera.lookAt(aim);
  camera.updateProjectionMatrix();
  // core/sky.js keeps the dome on a camera-following rig; the frozen loop will
  // not move it, so resync by hand (historic y=0 follow as the degrade path).
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }
  // CLEAR THE LENS. The mark is a real kerb in a real city and a parked car
  // sits between the tripod and the subject often enough to have swallowed a
  // whole beat — one plate came back as a windscreen with a pointing hand over
  // it. Anything with a body inside the first two metres of the lens is
  // furniture, not backdrop, so it steps out of shot; every vehicle further
  // away stays exactly where the city put it, because the backdrop being the
  // real street is half the point of shooting here at all. Restored on the
  // next beat by the same rule (the hidden ones are remembered, not lost).
  for (const car of S.hidden) if (car && car.group) car.group.visible = true;
  S.hidden = [];
  {
    // strictly what stands BETWEEN the lens and the subject: project each car
    // onto the sight line and keep only the ones inside the corridor. A radius
    // around the camera was the first try and it was both too blunt and too
    // small — it deleted street-parked backdrop and still left the bonnet that
    // was actually in the way, because a car's mass reaches the frame long
    // before its origin does.
    const vx = cx - eye.x, vz = cz - eye.z;
    const vlen2 = vx * vx + vz * vz || 1;
    for (const car of (CBZ.cityCars || [])) {
      const grp = car && car.group, cp = car && car.pos;
      if (!grp || grp.visible === false || !cp) continue;
      const px = cp.x - eye.x, pz = cp.z - eye.z;
      const t = (px * vx + pz * vz) / vlen2;
      if (t < -0.35 || t > 1.15) continue;               // behind the lens, or past the subject
      const ox = px - vx * t, oz = pz - vz * t;
      if (ox * ox + oz * oz > 3.4 * 3.4) continue;       // beside the corridor, not in it
      grp.visible = false; S.hidden.push(car);
    }
  }
  // the rig must be drawing: render LOD hides a ped past VIS_D2, and the
  // pose/tell drivers themselves are gated on visibility.
  ped.group.visible = true;
  if (mate) mate.group.visible = true;
  hideHud();
  CBZ.renderer.render(CBZ.scene, camera);

  // ---- metrics -----------------------------------------------------------
  const metrics = { poseApplied: poseApplied };
  if (driverApplied != null) metrics.driverApplied = driverApplied;
  if (waveAimDeg != null) metrics.waveAimDeg = waveAimDeg;
  // the tells audit is an AFTER-side export; a build without it reports nothing
  // rather than failing (jail-scene.mjs:269-276 degrade pattern).
  try {
    if (typeof CBZ.cityTellsAudit === "function") {
      const audit = CBZ.cityTellsAudit();
      for (const key of Object.keys(audit || {})) {
        const n = Number(audit[key]);
        if (Number.isFinite(n)) metrics["audit_" + key] = n;
      }
    }
  } catch (_) {}

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("scrim").style.cssText = "position:absolute;left:0;right:0;bottom:0;height:158px;background:linear-gradient(to top,rgba(9,13,17,.94) 0%,rgba(9,13,17,.84) 46%,rgba(9,13,17,0) 100%)";
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = sub.label;
  query("name").style.cssText = "position:absolute;bottom:64px;left:26px;font-size:25px;font-weight:800;letter-spacing:-.02em";
  query("focus").textContent = sub.focus;
  query("focus").style.cssText = "position:absolute;bottom:26px;left:28px;color:#c0cfda;font-size:12px;font-weight:550;line-height:1.42;max-width:930px";
  query("read").textContent = "pose " + (ch && ch.pose ? ch.pose : "—") +
    " · state " + (ped.state || "—") +
    (driverApplied != null ? " · driver " + (driverApplied ? "YES" : "no") : "") +
    // the wary tell is the one that claims to be CONTINUOUS rather than a
    // state, so the amplitude it is actually running at belongs on the plate.
    (g === "fear" && ch && ch._tellK != null ? " · k " + (Math.round(ch._tellK * 100) / 100) : "") +
    " · read " + (poseApplied ? "YES" : "no") +
    (g === "kinwave" ? " · beat " + (kinStarted ? "YES" : "no") : "") +
    (waveAimDeg != null ? " · aim " + waveAimDeg + "°" : "");
  query("read").style.cssText = `position:absolute;right:22px;top:22px;padding:6px 10px;border-radius:7px;background:rgba(9,13,17,.72);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${poseApplied ? "#9fe8c3" : "#ffb4b4"}`;
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:12px;right:24px;color:#8ea3b3;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    gesture: g,
    pose: (ch && ch.pose) || null,
    state: ped.state || null,
    tellsBuild: tellsBuild,
    metrics,
    camera: { position: eye.toArray(), target: aim.toArray() },
  };
}

export default {
  id: "npc-gestures",
  title: "Gang-City Gestures: What a Person Tells You Before They Say Anything",
  description: "The real city boots once per side and the rAF loop is frozen; each beat pulls a live ped out of CBZ.cityPeds, drops it on a fixed studio mark, writes the REAL internal state the ped brain reads — the witness report machine, posePoint, the surrender flags, fear, relPlayer.grudge, cash/wealth, aggr — steps the sim, and photographs the result waist-up at conversational distance. Nothing pokes a rig transform: the pose is whatever the game's own drivers do with that state. poseApplied is the per-shot verdict (did the expected read actually land on the rig), so the measurement page shows 0 → 1 per gesture; waveAimDeg asks whether a greeting is aimed at the person it greets.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "poseApplied: 1 when the expected read reached the rig (pose in CBZ.charPoses and held, phone prop mounted, arm actually raised, hands actually up). driverApplied: 1 when the ped's OWN tells driver produced the pose from the staged state, 0 when the preset had to set it directly (a build with no tells work reports 0 and no fallback fires at all). waveAimDeg: degrees between the waver's facing and the bearing to their partner — a wave at nobody is a big number. audit_* rows come from CBZ.cityTellsAudit() and are absent on the deployed side by construction.",
  metrics: {
    poseApplied: { label: "Gesture reached the rig", better: "higher" },
    driverApplied: { label: "Ped's own driver posed it", better: "higher" },
    waveAimDeg: { label: "Wave aim error", unit: "deg", better: "lower" },
  },
  subjects,
  stage: stageGestures,
};
