/* THE POSSE — respect gates the army, cigs feed it.
   A flag A/B storyboard for tools/visual-compare.mjs.

   ONE checkout serves both sides; the only difference is cfg_PRISON_POSSE.
   BEFORE is the prison as systems/prisonfriends.js shipped it in August: every
   man who ever owed you could be collected, forever, for nothing. AFTER is the
   same file with the two facts that make a crew a thing you can lose — a
   ceiling made of your name, and a bill that comes at chow.

   Nothing here is a mannequin. The men are the roster the run spawned, sorted
   by name so both sides photograph the SAME four bodies; the offers are taken
   through the real CBZ.prisonFriendAccept(); the chow bill is driven by moving
   the world's own sun (CBZ.dayPhase) through systems/prisonschedule.js's real
   blocks, so the trays go out because the clock says so. Only positions and
   your public standing are pinned, because a storyboard needs a mark and a
   ceiling needs a number.

   RUN IT:
     PORT=8613 python3 tools/devserver.py &        # (or let the tool serve)
     node tools/visual-compare.mjs \
       --preset artifacts/prison-econ-wave/posse/prison-posse.mjs \
       --before local --before-params "cfg_PRISON_POSSE=0" \
       --out artifacts/prison-econ-wave/posse --no-open
*/

// The block these plates stand in, by NAME. The hour it starts is whatever
// the live regime says it is (see phaseIn in the stage) — never a literal.
const YARD = "yard";

const subjects = [
  {
    id: "the-army-you-earned",
    label: "Three men owe you · how many can walk with you",
    focus:
      "Three inmates you pulled off the floor, all three offering, and you press BEFRIEND on all three. " +
      "BEFORE: three men, free, forever — the crew had no ceiling, so the only limit on an NPC army was how " +
      "many fights you happened to turn up for. AFTER: your name is worth ONE man (nobody in this yard rates " +
      "you above 'stranger' and no gang has your number), so the second and third count the shoulder in front " +
      "of them and decline. Same deed, same three men, same button.",
    standing: 0,            // no gang has anything good to say about you
    phase: YARD,
    cigs: 20,
    cam: { x: 0.7, y: 4.6, z: 40.2, ax: 0.0, ay: 1.0, az: 32.6, fov: 46 },
  },
  {
    id: "flanked",
    label: "The same three men, with a name behind you",
    focus:
      "Identical staging, one number moved: the Reds' books say 70. That is 'solid' in economy.js's own words, " +
      "which is three slots — so all three stand with you and the yard has to look at four men instead of one. " +
      "The pictures match, because the pictures are not the claim here: the rows under them are. Flanked and " +
      "shelter are what the rest of the prison can now ASK about this group (ai.js before it opens a shakedown, " +
      "capture.js when the wing takes you), and on the BEFORE side there is nothing to ask.",
    standing: 70,
    phase: YARD,
    cigs: 20,
    cam: { x: 0.7, y: 4.6, z: 40.2, ax: 0.0, ay: 1.0, az: 32.6, fov: 46 },
  },
  {
    id: "not-standing-fourth",
    label: "The fourth man · the offer you have no room for",
    focus:
      "A fourth inmate you also saved walks up on a full crew. BEFORE his card carries BEFRIEND and he says the " +
      "line every offering man says. AFTER there is no button — because there is no slot — and he says why, " +
      "naming the three men already on you and the place in the line he is being offered. His offer is not " +
      "thrown away: it arms itself the moment one of them dies, quits or is thrown over.",
    standing: 70,
    phase: YARD,
    cigs: 20,
    hold: true,
    cam: { x: 5.0, y: 2.95, z: 39.1, ax: -1.3, ay: 1.25, az: 32.6, fov: 46 },
  },
  {
    id: "three-chows",
    label: "Three chows and nothing",
    focus:
      "The same three-man crew, and your pocket is empty. The world's clock is walked through three real " +
      "sittings — Chow, Evening Chow, Chow again — with nothing to put on anybody's tray. BEFORE: three men " +
      "still glued to your shoulder, because the old crew ate nothing and noticed nothing. AFTER: they count " +
      "the trays out loud and go and eat with somebody else, and the ledgers that earned them (a rescue each) " +
      "are wiped, so they are re-earned or they are gone.",
    standing: 70,
    phase: YARD,
    cigs: 0,
    starve: true,
    cam: { x: 0.7, y: 4.6, z: 40.2, ax: 0.0, ay: 1.0, az: 32.6, fov: 46 },
  },
];

async function stagePrisonPosse(input) {
  const CBZ = window.CBZ;
  if (!CBZ) return { ok: false, err: "no CBZ" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };

  // ---------------------------------------------------------------- boot once
  let S = window.__prisonPosse;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="escape"]').click();
    await wait(250);
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    // The boot card dismisses itself two rAFs after the synchronous build, and
    // the next line kills rAF forever — freeze early and every plate is a
    // photograph of "BUILDING THE WORLD".
    await until(() => {
      const card = document.getElementById("bootload");
      return !card || getComputedStyle(card).display === "none";
    }, 20000, 50);
    try { if (CBZ.bootMeter && CBZ.bootMeter.hide) CBZ.bootMeter.hide(); } catch (_) {}
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    // let the prison's reveal rail finish; a camera staged during it is stomped
    for (let i = 0; i < 360; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    /* ONE STREAM OF DICE FROM HERE ON. The two sides share a seed, but the
       flag genuinely changes the yard, so anything drawn from Math.random
       after this point would diverge. Replaced AFTER boot (never before —
       the world build wants the real one) so every staged beat rolls the
       same numbers on both sides. */
    let seed = 0x5eed1;
    Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    const overlay = document.createElement("div");
    overlay.id = "__possePlate";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-state></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__prisonPosse = { overlay, canvas };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const sub = input.subject;
  const P = CBZ.player, PC = CBZ.playerChar;
  if (!P || !PC) return { ok: false, err: "no live player rig" };
  const groundAt = (x, z) => {
    try { const y = CBZ.floorAt ? CBZ.floorAt(x, z) : 0; return Number.isFinite(y) ? y : 0; } catch (_) { return 0; }
  };

  // ------------------------------------------------------------- the yard mark
  const PX = 0, PZ = 34, py = groundAt(PX, PZ);
  // three candidates in front of you, and (for the fourth-man plate) one more
  /* MARKS THAT DO NOT STAND BEHIND EACH OTHER. Bodies at the same screen
     position are one body in a photograph: the first composition had two of
     the three crew projecting within half a metre of each other and a third
     directly behind the player's head, so a plate whose argument is HOW MANY
     men are with you showed two. Every mark is offset across the lens, never
     along it. */
  const SPOTS = [[-2.1, 32.4], [1.1, 31.8], [2.9, 32.8], [0.0, 32.0]];
  // where the crew get parked once the fourth man walks up: behind your left
  // shoulder, in frame but comfortably further from you than he is, because the
  // interaction card belongs to the NEAREST man and this plate is his
  const BACK = [[-3.6, 35.8], [-4.8, 34.6], [-3.4, 33.2]];
  /* WHICH WAY A MAN FACES, settled by photograph rather than by lore. The note
     carried from earlier waves ("character rigs face local -Z") is not true of
     THESE rigs: a player rig at rotation 0, shot from +Z, shows his FACE, so
     forward at θ=0 is +Z and facing a target is plain atan2(dx, dz). Smoke run
     two flipped it on the strength of the note and photographed four men
     talking to the back of each other's heads. */
  const faceFrom = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);

  /* WHAT TIME IS "CHOW"? Not a number this file is allowed to know. The block
     table in systems/prisonschedule.js is handed out BY REFERENCE and
     systems/prisontiers.js rewrites `from` in place per security regime — so
     the 11.5 printed in the source is not the hour the trays go out in the
     regime this run is actually in. Smoke run four hard-coded the printed
     hours, put the sun at 11.76 expecting Chow, and got Morning Yard: one
     sitting out of three, and a starvation plate with nobody starving. Ask the
     live table, land 0.4 h inside the block, and it is right in every regime. */
  const blockHour = (id, fallback) => {
    const B = (CBZ.prisonSchedule && CBZ.prisonSchedule.blocks) || [];
    for (let i = 0; i < B.length; i++) if (B[i].id === id) return B[i].from;
    return fallback;
  };
  const phaseIn = (id, fallback, into) => {
    const h = (blockHour(id, fallback) + (into == null ? 0.4 : into) + 24) % 24;
    return ((((h - 6) / 24) % 1) + 1) % 1;
  };
  CBZ.dayPhase(typeof sub.phase === "string" ? phaseIn(sub.phase, 7, 1.2) : sub.phase);
  try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
  try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
  if (CBZ.invOpen && CBZ.toggleInventory) CBZ.toggleInventory();
  if (CBZ.prisonFriendsReset) CBZ.prisonFriendsReset();
  /* CLEAR THE BAND. The subtitle is one shared element with a seconds timer
     that only runs while the simulation does, so a line from the PREVIOUS
     subject was still sitting over the next plate — the flanked pair was
     captioned with the fourth man's refusal from the plate before it. Every
     beat starts silent and only prints what it makes somebody say. */
  const bandEl = document.getElementById("pinteractSay");
  const bandLine = bandEl && bandEl.querySelector(".pi-subtitle-line");
  const bandWas = bandLine ? (bandLine.textContent || "") : "";
  if (bandEl) bandEl.classList.remove("show");
  // ...and BLANK it, not merely hide it. The band is arbitrated by
  // systems/subtitlebus.js, which holds a claim on the surface with its own
  // wall-clock timer while interact.js's own countdown runs on SIMULATED
  // seconds — two clocks that a frozen-rAF storyboard drives at wildly
  // different rates. Releasing the claim and emptying the text means whatever
  // survives that mismatch has nothing to print.
  if (bandLine) bandLine.textContent = "";
  try { if (CBZ.subtitles && CBZ.subtitles.release) CBZ.subtitles.release("pinteractSay"); } catch (_) {}
  const saidAtStart = (CBZ.prisonSayAudit && CBZ.prisonSayAudit().said) || 0;
  CBZ.game.cigs = sub.cigs;
  // ...and tell the HUD. Writing game.cigs straight leaves the corner chip
  // reading whatever it last painted (smoke run three: a plate captioned "20
  // cigs" over a HUD chip showing 0). addCigs(0) is economy.js's own repaint.
  try { if (CBZ.econ && CBZ.econ.addCigs) CBZ.econ.addCigs(0); } catch (_) {}

  /* YOUR NAME, PINNED. renown() reads the best standing you hold anywhere —
     a gang's books, or the highest opinion any man outside your crew holds.
     Both are live world state and neither is identical across a flag flip, so
     the yard's opinion is clamped to nothing and the number under test is set
     explicitly. The CAP is still computed by the real code from it. */
  const everyone = (CBZ.npcs || []).concat(CBZ.guards || []);
  for (const a of everyone) {
    if (!a) continue;
    a.rep = Math.min(a.rep || 0, 12);
    a.playerGrudge = 0;
    a.reportedPlayerT = 0;
  }
  CBZ.game.gangStanding = [sub.standing, 0];
  if (CBZ.player) CBZ.player.gang = null;

  /* THE CAST: alphabetical, so both sides photograph the same four bodies even
     if the spawn arrays drifted — and NAMED, because entities/npc.js fills the
     wing out with "a thief" and "an inmate" and a plate whose whole argument is
     a man naming the men already on you needs men with names. Thieves are
     skipped for a second reason the first smoke run taught: economy.js's
     thiefTick had lifted 6 cigs off the player by the time the shutter opened. */
  const named = (n) => n && n.data && n.data.name && !/^(a|an|the)\s/i.test(n.data.name);
  const live = (n) => n && n.group && n.char && !n.dead && !n.escaped &&
    n.kind !== "warden" && n.role !== "merchant" && n.role !== "thief" && n.data && n.data.name;
  const byName = (a, b) => String(a.data.name).localeCompare(String(b.data.name));
  const cast = (CBZ.npcs || []).filter((n) => live(n) && named(n)).sort(byName);
  const spare = (CBZ.npcs || []).filter((n) => live(n) && !named(n)).sort(byName);
  // ...and no two men with the same name. The wing's name pool repeats (smoke
  // run two refused "Ash" and "Ash"), and a line whose whole job is naming the
  // men on your shoulder cannot name the same man twice.
  const seen = {};
  const marks = cast.concat(spare).filter((n) => {
    const k = String(n.data.name).toLowerCase();
    if (seen[k]) return false;
    seen[k] = 1; return true;
  }).slice(0, 4);
  if (marks.length < 4) return { ok: false, err: "not enough live inmates (" + cast.length + ")" };
  const crewMen = marks.slice(0, 3);
  const fourth = marks[3];

  for (let i = 0; i < marks.length; i++) {
    const m = marks[i], s = SPOTS[i], gy = groundAt(s[0], s[1]);
    m.dead = false; m.ko = 0; m.hp = m.maxHp || 100; m.escaped = false; m.cuffed = false;
    m.aiState = "idle"; m.foe = null; m.huntPlayer = 0; m.hitCD = 0;
    m.approach = null; m.approachCD = 30; m.standingOffer = null; m.intimidMode = null;
    m.group.visible = true;
    m.group.position.set(s[0], gy, s[1]);
    m.group.rotation.y = faceFrom(s[0], s[1], PX, PZ);
  }

  /* EVERYBODY ELSE LEAVES. Hiding them is not enough and the first smoke run
     proved it twice: an invisible thief opened a real stick-up on the player,
     took the interaction card ("thief wants 8 cigs to leave your pockets
     alone"), took the subtitle band, and lifted 6 cigs out of the pocket this
     storyboard is counting. A body you cannot see is still a body in the
     simulation. So the extras have their business with you cancelled and are
     pushed out of every range that matters, every frame. */
  const banish = () => {
    const rest = (CBZ.npcs || []).concat(CBZ.guards || []);
    for (const n of rest) {
      if (!n || !n.group || marks.indexOf(n) >= 0) continue;
      n.group.visible = false;
      n.huntPlayer = 0; n.standingOffer = null; n.approachCD = 9999;
      if (n.approach) { try { if (CBZ.clearNpcApproach) CBZ.clearNpcApproach(n); else n.approach = null; } catch (_) { n.approach = null; } }
      if (n.hunt != null) n.hunt = 0;
      if (n.alert != null) n.alert = 0;
      // ...and the yard's opinion of you stays clamped. renown() reads the
      // highest respect any man outside your crew holds, and the live economy
      // moves those numbers while a plate is being staged.
      if (n.rep > 12) n.rep = 12;
      const dx = n.group.position.x - PX, dz = n.group.position.z - PZ;
      if (dx * dx + dz * dz < 1600) { n.group.position.x += 45; n.group.position.z += 45; }
    }
  };
  banish();

  P.pos.set(PX, py, PZ); P.vy = 0; P.grounded = true;
  P.dead = false; P.hp = 100; P.stun = 0; P.captureState = "normal"; P.captureT = 0;
  PC.group.visible = true; PC.cuffed = false;
  PC.group.position.set(PX, py, PZ);
  PC.group.rotation.y = faceFrom(PX, PZ, PX, PZ - 2);   // looking at the men
  if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0; }

  /* THE FOUR MEN KEEP THEIR OWN BUSINESS OUT OF IT. The gang/debt simulation
     is running the whole time these plates are staged, and on smoke run three
     it walked a debt onto one of the crew, ran his grudge past 6 and ended the
     friendship mid-storyboard — the plate about missed meals was captioned
     "We're done. Don't come near me." That is prisonfriends.js's break-up law
     working correctly on a beat this preset is not about, so the marks' grudge
     and their pending business with the player are held at zero. Everything
     the POSSE does is left alone. */
  const keepMarks = () => {
    /* YOUR NAME IS HELD AT THE NUMBER UNDER TEST. Pinning gang standing once,
       at the top of the subject, was not enough: the gang/debt simulation
       nudges those books while the plate is being staged, and on one run the
       ceiling drifted from three men to five mid-stage — the fourth man was
       no longer over any cap, so the line this plate exists to photograph did
       not get said until the standing wandered back down. */
    const gs = CBZ.game.gangStanding || (CBZ.game.gangStanding = [0, 0]);
    gs[0] = sub.standing; gs[1] = 0;
    for (const m of marks) {
      if (!m) continue;
      if (!m.pfFriend && m.rep > 12) m.rep = 12;
      m.playerGrudge = 0; m.huntPlayer = 0; m.standingOffer = null; m.approachCD = 9999;
      m.dead = false; m.ko = 0; m.escaped = false;
      if (m.hp < 40) m.hp = m.maxHp || 100;
      if (m.approach) { try { if (CBZ.clearNpcApproach) CBZ.clearNpcApproach(m); else m.approach = null; } catch (_) { m.approach = null; } }
    }
  };
  const pinPlayer = () => {
    P.pos.set(PX, py, PZ); P.vy = 0; P.grounded = true; P.dead = false; P.hp = 100; P.stun = 0;
    PC.group.position.set(PX, py, PZ);
    PC.group.rotation.y = faceFrom(PX, PZ, PX, PZ - 2);
    banish();
    keepMarks();
  };
  // `park` pins named men to fixed marks THROUGH the step, which is how the
  // fourth-man plate keeps the crew out of the interaction card's nearest-man
  // test while their own AI is still trying to walk them back to your shoulder.
  const step = (frames, park) => {
    for (let i = 0; i < frames; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      pinPlayer();
      CBZ.stepSim(1 / 60);
      pinPlayer();
      if (park) for (let k = 0; k < park.length; k++) {
        const m = park[k][0], s = park[k][1], away = park[k][2], gy = groundAt(s[0], s[1]);
        m.group.position.set(s[0], gy, s[1]);
        m.group.rotation.y = away
          ? faceFrom(s[0], s[1], 2 * s[0] - PX, 2 * s[1] - PZ)
          : faceFrom(s[0], s[1], PX, PZ);
      }
    }
  };

  // The map panel is the one piece of HUD that sits exactly where the plate's
  // caption goes, and it is not what any of these four plates are about.
  const mini = document.getElementById("minimap");
  if (mini) mini.style.visibility = "hidden";

  step(24);

  /* THE DEED, THEN THE BUTTON. The pitch clock is parked (pfPitchT high) so
     the three candidates do NOT spend the subtitle band saying they owe you
     before anybody presses anything — the first smoke run photographed exactly
     that, a leftover "I don't forget that" sitting over a plate about who is
     allowed to stand with you. The band is given to the line each subject is
     actually a claim about, and to nothing else. */
  for (const m of crewMen) { m.pfSaved = true; m.pfPitchT = 99; }
  step(30);                                   // one slow-tick slice: he decides

  const presses = [];
  for (const m of crewMen) {
    let r = null;
    try { r = CBZ.prisonFriendAccept ? CBZ.prisonFriendAccept(m) : null; } catch (e) { r = { ok: false, msg: String(e) }; }
    presses.push({ who: m.data.name, ok: !!(r && r.ok), msg: (r && r.msg) || "" });
  }
  /* A MAN WHO SAID YES WALKS TO YOUR SHOULDER; A MAN WHO WAS REFUSED STAYS
     WHERE HE WAS STANDING. Both are the real behaviour — shadowPlayer moves
     the first and nothing moves the second — but "nothing" in this game is a
     wander state, and smoke run three photographed one crew member and an
     empty yard because the two refused men had strolled out of the plate (and
     out of the 8 m the pitch needs) during the walk-in. They are pinned; the
     crew are not, because the crew closing on you IS the picture. */
  const stay = [];
  for (let i = 0; i < crewMen.length; i++) if (!presses[i].ok) stay.push([crewMen[i], SPOTS[i]]);
  step(110, stay.length ? stay : null);
  // ...and then everyone lands on a mark. A man at your shoulder is put there
  // by shadowPlayer (the 110 frames above are it doing the walk), but WHICH
  // shoulder is a live decision, and smoke run four photographed the one man
  // your name allows standing exactly behind the player's head — invisible in
  // a plate whose entire argument is how many men are standing with you.
  /* MARKS THAT DO NOT OVERLAP. entities/ai.js separates bodies that share a
     spot by shoving them 0.8 of a unit per frame (one line, no damping), so
     three men pinned shoulder-to-shoulder are a loaded spring: smoke run five
     pinned them at 1.2 u, released the pin for the last two thirds of a
     second, and two of the three were fired clean out of the plate — and out
     of the 8 u that posseShelterCut() calls "next to you". Marks are set wider
     than a body, and the pin is never released while the shutter is open. */
  const SHOULDER = [[-2.4, 33.6], [2.4, 33.6], [-1.0, 31.3]];
  const marksNow = [];
  for (let i = 0; i < crewMen.length; i++) marksNow.push([crewMen[i], presses[i].ok ? SHOULDER[i] : SPOTS[i]]);
  step(45, marksNow);

  // The refused man now gets the band: he is the whole subject of the first
  // plate, and on the before side he does not exist.
  if (!sub.hold && !sub.starve) {
    for (let i = 0; i < crewMen.length; i++) {
      if (!presses[i].ok) { crewMen[i].pfPitchT = 0; crewMen[i].pfHeldSaid = false; }
    }
    step(40, marksNow);
  }

  let chows = 0, quitLine = "";
  const trace = [];
  let missedPeak = 0;
  if (sub.hold) {
    /* THE FOURTH MAN. The crew are parked behind you so the card in front of
       you is HIS card, and he gets the same deed the other three had. */
    const park = [[crewMen[0], BACK[0]], [crewMen[1], BACK[1]], [crewMen[2], BACK[2]]];
    step(30, park);
    fourth.pfSaved = true; fourth.pfPitchT = 0; fourth.pfHeldSaid = false;
    const fy = groundAt(SPOTS[3][0], SPOTS[3][1]);
    fourth.group.position.set(SPOTS[3][0], fy, SPOTS[3][1]);
    fourth.group.rotation.y = faceFrom(SPOTS[3][0], SPOTS[3][1], PX, PZ);
    /* WAIT FOR HIM TO SPEAK, then stop the world. A fixed 90 frames put the
       line on screen and then kept simulating past it: interact.js counts a
       line's seconds in SIMULATED time and the storyboard runs the simulation
       far faster than the wall clock, so the plate was captured after the band
       had already timed out — CBZ.prisonSayAudit() said a line had been
       spoken and the picture had nothing in it. The shutter now opens on the
       frame after he says it. */
    const said4 = park.concat([[fourth, SPOTS[3]]]);
    let spoke = false;
    for (let i = 0; i < 24 && !spoke; i++) {
      step(6, said4);
      spoke = !!(bandEl && bandEl.classList.contains("show") && bandLine && bandLine.textContent);
    }
  } else if (sub.starve) {
    /* THREE SITTINGS, ON THE WORLD'S OWN CLOCK. dayPhase is the sun every
       schedule in this game reads (hour = phase*24 + 6), so walking it through
       these six values walks systems/prisonschedule.js through Chow → Work →
       Evening Chow → Return → Chow → Work. Nothing here tells prisonfriends.js
       that a tray went out; it reads the block like everything else does. */
    const walk = [
      phaseIn("mess", 11.5), phaseIn("work", 13.0),
      phaseIn("supper", 17.0), phaseIn("count", 18.5),
      phaseIn("mess", 11.5), phaseIn("work", 13.0),
    ];
    for (let w = 0; w < walk.length; w++) {
      const ph = walk[w];
      /* The band is cleared once more on the way into the LAST sitting's
         close, which is the beat this plate is about. Three real sittings take
         a while, and the wing talks the whole time — the before plate came
         back captioned with a piece of yard gossip ("Been waiting on somebody
         to get to Blue Ace") that had nothing to do with anybody's dinner. */
      if (w === walk.length - 1 && bandEl) {
        bandEl.classList.remove("show");
        if (bandLine) bandLine.textContent = "";
        try { if (CBZ.subtitles && CBZ.subtitles.release) CBZ.subtitles.release("pinteractSay"); } catch (_) {}
      }
      CBZ.dayPhase(ph);
      // 90 frames, not 40: systems/dayplan.js CACHES the live block (`cur`) and
      // only re-reads it in poll(), and prisonfriends' own chow edge only gets
      // looked at once per 0.4 s slice. Smoke run four moved the sun through
      // six blocks in 0.67 s each and the plan reported ONE sitting out of
      // three — the schedule was still catching up when the shutter opened.
      step(90, marksNow);
      const a = CBZ.prisonFriendAudit ? CBZ.prisonFriendAudit() : null;
      chows = a ? (a.chow || {}).sitting || 0 : 0;
      // The peak, not the leftover: a man who walks resets his own tally on the
      // way out, so a reading taken at the shutter says "0 trays missed" over a
      // plate of an empty yard.
      let m0 = 0; for (const m of marks) m0 += m.pfMissed || 0;
      if (m0 > missedPeak) missedPeak = m0;
      trace.push({ phase: ph, block: a ? (a.chow || {}).block : "?", sitting: chows, crew: a ? a.crew : -1 });
    }
    // Released — but only the men who WALKED. Anybody still crew is still at
    // your shoulder and stays on his mark; the ones who quit turn and go, which
    // is the difference the two sides of this plate are made of.
    /* NOBODY IS RELEASED HERE. Letting the quitters walk sounds better than it
       photographs: released for 1.2 s, two of the three were 49 and 62 metres
       away by the shutter — the yard's own schedule/nav snapped them off to
       where a man belongs during Work, which is not something a still can
       show. So the men who left take one step back out of your shoulder and
       turn away from you, and the men who are still yours stay on their marks;
       the count and the line carry the rest. */
    const after = [];
    for (let i = 0; i < crewMen.length; i++) {
      const m = crewMen[i], s = SHOULDER[i];
      after.push(m.pfFriend ? [m, s, false]
        : [m, [PX + (s[0] - PX) * 1.55, PZ + (s[1] - PZ) * 1.55], true]);
    }
    step(70, after);
  }

  // ---------------------------------------------------------------- camera
  const camera = CBZ.camera;
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = locked || sub.cam;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 45;
  camera.near = 0.05; camera.far = 20000;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();

  // ---------------------------------------------------------------- readings
  const audit = CBZ.prisonFriendAudit ? CBZ.prisonFriendAudit() : null;
  const capRaw = CBZ.posseCap ? CBZ.posseCap() : Infinity;
  const vis = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const cardRows = Array.from(document.querySelectorAll("#interact .iopt, #pinteract .pi-action, #pinteract [data-pi]"))
    .filter(vis).map((r) => (r.innerText || "").replace(/\s+/g, " ").trim());
  const sayEl = document.getElementById("pinteractSay");
  const said = sayEl && vis(sayEl) ? ((sayEl.querySelector(".pi-subtitle-line") || {}).textContent || "").trim() : "";
  let missed = 0;
  for (const m of marks) missed += m.pfMissed || 0;
  if (missedPeak > missed) missed = missedPeak;
  const shadowing = marks.filter((m) => m.aiState === "shadowPlayer").length;
  quitLine = said;

  const metrics = {
    crew: CBZ.posseSize ? CBZ.posseSize() : 0,
    cap: Number.isFinite(capRaw) ? capRaw : -1,
    offersTaken: presses.filter((p) => p.ok).length,
    offersRefused: presses.filter((p) => !p.ok).length,
    flanked: CBZ.posseFlanked && CBZ.posseFlanked() ? 1 : 0,
    shelterPct: Math.round((CBZ.posseShelterCut ? CBZ.posseShelterCut(0) : 0) * 100),
    befriendOffered: cardRows.filter((t) => /befriend/i.test(t)).length,
    cigs: CBZ.game.cigs || 0,
    missedMeals: missed,
    stillWithYou: shadowing,
  };

  // ---------------------------------------------------------------- the plate
  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector("[data-" + n + "]");
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = "position:absolute;top:20px;left:24px;padding:7px 11px;border-radius:7px;background:" +
    (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
  q("name").textContent = sub.label;
  q("name").style.cssText = "position:absolute;top:68px;left:24px;font-size:21px;font-weight:800;letter-spacing:-.02em";
  const bits = [];
  bits.push("crew " + metrics.crew + (metrics.cap < 0 ? " · no ceiling" : " of " + metrics.cap));
  bits.push("your name: " + (audit ? audit.renown + " (" + audit.standing + ")" : "?"));
  bits.push(metrics.cigs + " cigs");
  if (sub.starve) bits.push(chows + " sittings · " + metrics.missedMeals + " trays missed");
  if (presses.some((p) => !p.ok)) bits.push("refused: " + presses.filter((p) => !p.ok).map((p) => p.who).join(", "));
  q("state").textContent = bits.join("  ·  ");
  q("state").style.cssText = "position:absolute;top:99px;left:25px;color:#c0cfda;font-size:11px;font-weight:700;letter-spacing:.07em";
  const u = new URL(input.sourceUrl);
  q("source").textContent = u.host + u.pathname + u.search;
  q("source").style.cssText = "position:absolute;bottom:9px;left:25px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  camera.updateMatrixWorld(true);
  CBZ.renderer.render(CBZ.scene, camera);
  await wait(420);                 // the subtitle band fades in on a .14s transition
  /* AND ONLY THEN ASK WHAT IS ON SCREEN. The band fades in over 0.14 s of WALL
     time, so a line spoken on the last simulated frame before the shutter is
     still at opacity 0 when the metrics are taken — three runs reported "no
     line" over a plate with the line plainly printed across it. The picture
     was right and the row under it was wrong, which is worse than either. */
  const bandNow = document.getElementById("pinteractSay");
  if (bandNow && vis(bandNow)) {
    const t = ((bandNow.querySelector(".pi-subtitle-line") || {}).textContent || "").trim();
    if (t) quitLine = t;
  }

  return {
    ok: true,
    camera: { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az, fov: cam.fov || 45 },
    men: marks.map((m) => m.data.name),
    trace,
    band: {
      carriedIn: bandWas,
      spokenHere: ((CBZ.prisonSayAudit && CBZ.prisonSayAudit().said) || 0) - saidAtStart,
    },
    fourthMan: sub.hold ? {
      who: fourth.data.name,
      offered: !!(CBZ.prisonFriendOffered && CBZ.prisonFriendOffered(fourth)),
      pitchT: Math.round((fourth.pfPitchT || 0) * 100) / 100,
      heldSaid: !!fourth.pfHeldSaid, saved: !!fourth.pfSaved,
      state: fourth.aiState || "", approach: !!(fourth.approach && fourth.approach.t > 0),
      d: Math.round(Math.hypot(fourth.group.position.x - PX, fourth.group.position.z - PZ) * 10) / 10,
    } : null,
    where: marks.map((m) => ({
      who: m.data.name,
      d: Math.round(Math.hypot(m.group.position.x - PX, m.group.position.z - PZ) * 10) / 10,
      friend: !!m.pfFriend, state: m.aiState || "",
    })),
    blocks: ((CBZ.prisonSchedule && CBZ.prisonSchedule.blocks) || []).map((b) => b.id + "@" + b.from),
    presses,
    cardRows,
    said: quitLine,
    audit: audit ? { crew: audit.crew, cap: audit.cap, renown: audit.renown, standing: audit.standing, chow: audit.chow } : null,
    metrics,
  };
}

export default {
  id: "prison-posse",
  title: "Prison Escape: The Posse — a name that caps it, a bill that keeps it",
  description:
    "The NPC army had no ceiling and no bills. Four marks in one yard ask what your name is worth in men, " +
    "what a man does when your line is full, and what three missed trays cost you.",
  defaultBefore: "local",
  beforeParams: "cfg_PRISON_POSSE=0",
  beforeLabel: "BEFORE · FREE FOREVER",
  afterLabel: "AFTER · EARNED AND FED",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  stageTimeoutMs: 420000,
  pairNote:
    "Same build · seed · roster (alphabetical) · marks · camera · morning yard. The only difference is cfg_PRISON_POSSE.",
  method:
    "Escape mode boots on both sides, rAF freezes, Math.random is replaced with one seeded stream, and the four " +
    "alphabetically-first live inmates are staged on fixed marks. Every offer is taken through the real " +
    "CBZ.prisonFriendAccept(); the chow bill is driven by moving CBZ.dayPhase through prisonschedule.js's real " +
    "Chow blocks. The yard's opinion of you is clamped to nothing and your public standing is set explicitly, " +
    "because renown() reads live world state that a flag flip perturbs — the CAP is still computed by the real code.",
  metricsNote:
    "Live from CBZ.prisonFriendAudit(), CBZ.posseSize/posseCap/posseFlanked/posseShelterCut and the DOM at the " +
    "instant of capture. cap = -1 means NO CEILING (the flag is off). shelterPct and flanked are the questions " +
    "capture.js and ai.js get to ask about this group once the seams are wired; on the before side there is " +
    "nothing to ask, which is why they read 0.",
  metrics: {
    crew: { label: "Men walking with you", unit: "men" },
    cap: { label: "Men your name allows (-1 = no ceiling)", unit: "men" },
    offersTaken: { label: "BEFRIEND presses that took", unit: "of 3" },
    offersRefused: { label: "…refused for want of a slot", unit: "of 3" },
    befriendOffered: { label: "BEFRIEND on the card in front of you", unit: "rows" },
    flanked: { label: "Reads as flanked to the rest of the prison", unit: "1=yes", better: "higher" },
    shelterPct: { label: "Of a shakedown your crew can hold", unit: "%", better: "higher" },
    cigs: { label: "Cigs in your pocket", unit: "cigs" },
    missedMeals: { label: "Trays your men went without", unit: "trays" },
    stillWithYou: { label: "Men still at your shoulder", unit: "men" },
  },
  subjects,
  stage: stagePrisonPosse,
};
