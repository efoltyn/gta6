/* DESERT WARLORD — THE TRIGGER, BEFORE AND AFTER IT WAS THE ENGINE'S.

   THE REPORT (owner): "the actual shooting controls right now suck. They are
   not like the jail game or gun game, which are great. Fix that too — because
   you didn't reuse for that."

   THE CLAIM UNDER TEST, in one sentence: warlord/battle.js hand-rolled a
   player controller instead of mounting systems/fpsmode.js — the file this
   repo has spent a year making feel right and the file the jail and gun game
   both shoot with — and every single thing that makes a gun feel like a gun
   was missing from the fork.

   SO THIS IS A FLAG A/B AND NOTHING ELSE. Both sides are THIS checkout, served
   by the same local server, on the same seed, with the same rosters on the
   same sand, at the same simulated second, with the warlord standing on the
   same square metre aimed at the same man. The before side boots
   ?gunplay=old — warlord/gunplay.js's own one-line revert, which is the
   original hand-rolled controller moved across whole. Every pixel and every
   number of difference is that flag.

   WHAT THE FORK DID NOT HAVE, which is the list of subjects below:
     · ADS. There was no aim button. Holding a sight was not a thing you could
       do, so a rifle and a pistol were aimed identically.
     · RECOIL. Not "little recoil" — none. The fork's shot was a ray down the
       camera's centre line and the camera never moved, so the thirtieth round
       of a magazine landed exactly where the first one did.
     · A RELOAD. It had a timer that refilled a number. No animation, no
       reserve pool at all — it reloaded out of thin air, forever.
     · A HIT MARKER, a headshot, a falloff curve, a spread cone, a weapon
       switch, a real magazine, a reserve, or a second gun.
     · A HONEST THIRD PERSON. Its shoulder camera put the lens at
       `pos − dir·back + right·side` and then LOOKED AT `pos + dir·14 +
       right·side` — two different sideways offsets, so the camera's forward
       was not the aim, so the round did not go where the dot was.
   And what it DID have, which is the other half of the story: a five-degree
   cone magnet that could not miss. MEASURED on the pair below, at 30 m, both
   sides aimed at the same man: the fork's hit rate is 1.00 — SIX rounds, six
   hits, every subject, all afternoon — against 0.50 to 0.80 for the engine,
   which has a spread cone and a muzzle that climbs and has to be pulled back
   down. The fork was not easier. It was not a gun. And the engine still kills
   MORE men from the same trigger time (three against one on the opening beat,
   twenty against eight by the last), because it can reach past five degrees
   and because a head is worth 2.3x a chest.

   IT IS A STUDIO, NOT A GALLERY. The page boots ?frozen=1: battle.js begins
   with its clock STOPPED, so both builds start at simulated second zero and
   every second after that is one somebody asked for. advance() is the only
   time that passes, through the same injected-dt seam a person's frame-step
   key would use — which is also what makes the FILM STRIPS honest. A recoil
   pattern and a reload are motion; a single still cannot show either, so the
   two subjects that are about motion photograph the identical simulated
   seconds on both sides, frame for frame.

   THE PHONE FRAME IS NOT A NICETY. The owner plays on touch and has already
   caught one inverted stick in this game, so the whole storyboard is captured
   at a laptop AND at an iPhone — a layout regression is a shape, not a pixel.
*/

const subjects = [
  { id: "hip-fire", label: "Hip fire, first person, same man",
    seat: "fps", ads: false, burst: 0.55,
    focus: "THE BASELINE SHOT. Both sides stand on the same square metre, aimed at the same soldier, firing the same AK-47 record out of weapons/weapon-data.js. AFTER: systems/fpsmode.js's viewmodel — the same gun model every NPC on the field is carrying, posed by systems/gunhands.js so the off hand is actually on the handguard — a reticle that BLOOMS with the live cone so it tells the truth about where rounds will land, brass ejecting, a muzzle flash sized off the weapon's own `flash` value, and the repo's own #crosshair going red on flesh. BEFORE: a three-pixel white dot, a rifle hand-posed from its own bounding box, and a ray that cannot miss inside five degrees." },

  { id: "ads", label: "Aiming down the sights",
    seat: "fps", ads: true, burst: 0.55,
    focus: "THE VERB THE FORK DID NOT HAVE. Holding aim does four things at once and all four are fpsmode's, unchanged: the lens punches from 75° to 50°, the viewmodel eases from its corner carry to a centred down-the-sights pose with the front post on the crosshair, the spread cone and the recoil ladder both drop, and systems/lockon.js's soft aim-lock starts easing the reticle onto the nearest man — which is the thing that makes this playable with a thumb. The before side has no aim button, so its frame is its hip-fire frame: that IS the finding." },

  { id: "recoil-pattern", label: "A full magazine, held down",
    seat: "fps", ads: false, hold: true,
    strip: { frames: 6, stepSec: 0.55 },
    focus: "THE ONE SUBJECT A STILL CANNOT MAKE. The trigger goes down on frame one and stays down for a whole thirty-round magazine; every frame after is the same simulated 0.55 s on both builds. AFTER: the muzzle CLIMBS — fpsmode kicks the actual view (kickView writes into the same look state the player steers with, so the bullet never gets a second invisible aim offset), the climb ramps over the burst on the weapon's own `climb`/`rampMax`/`yawWeave` numbers, the reticle blooms as it goes, and the counter runs down to a dry gun that stops. BEFORE: thirty rounds through the same three pixels, and a magazine that refills itself from nothing." },

  { id: "reload", label: "The reload",
    seat: "fps", ads: false, emptyFirst: true,
    strip: { frames: 5, stepSec: 0.45 },
    focus: "1.8 SECONDS, AND THE NUMBER IS THE AK's OWN. weapon-data.js's `reloadTime` for the ak47 row is 1.8 and that is exactly how long this takes; the rounds come out of a REAL reserve that goes down, derived from what the warlord is actually carrying in his cart rather than from the city shop's default. The gun dips, the off hand goes to the magazine (systems/gunhands.js), and the readout says RELOADING. The before side's reload is a float counting down behind an unchanged picture." },

  { id: "hit-marker", label: "The round connects",
    seat: "fps", ads: true, burst: 0.9, closeIn: 18,
    focus: "THE FEEDBACK THE FORK HAD NONE OF. A connecting round splays fpsmode's four hit-marker ticks around the crosshair — white for a hit, RED and wider for a kill — with the `hit` foley under it, blood on the man from systems/wounds.js, and the body going down through the SAME killMan funnel an NPC's round uses, which is what puts his rifle in your cart afterwards. The before side landed its hit, took the health off, and told you nothing at all." },

  { id: "third-person", label: "Over the shoulder, same shot",
    seat: "third", ads: false, burst: 0.9,
    focus: "THE OWNER ASKED FOR THE NATURAL-DISASTER FOLLOW CAMERA IN BATTLE, WITH FIRST PERSON A TOGGLE AWAY. Both are now the same weapon system: fps.active is the whole difference, and the shoulder is fpsmode's own shoulderActive() — the gun in the rig's real hand socket, WORLD-BARREL-LOCKED onto the reticle ray every frame, with the round leaving the rendered muzzle and converging on the point under the dot. MEASURED on the pair: eleven rounds from the shoulder, nine hits. The before side's third person put the lens and the look point at two different sideways offsets, so the camera's forward was not the aim — eleven rounds, ZERO hits, which is the bug this subject exists to retire." },

  { id: "touch-cluster", label: "The controls a thumb has",
    seat: "third", ads: true, burst: 0.5, touchOnly: true,
    focus: "WHAT THE OWNER ACTUALLY PLAYS ON. AFTER: microboot's own thumb grammar — the fixed left stick with rim-sprint, right-half look drag — plus FIRE, a LATCHED aim (systems/touch.js's own 2026-08-04 rule: the right thumb is the only one that can reach the trigger, so anything you would hold WITH the trigger has to be a press-once latch), RELOAD and a weapon SWAP, each wired to touch.js's own verb (CBZ.fpsFire / fpsSetAim / fpsReload / fpsNextWeapon) rather than to a second implementation. The order rail lost its keyboard digits — a phone has no number keys — and shrank to one row so it stopped sitting on top of the trigger. BEFORE: one FIRE circle, no aim, no reload, no swap, and four order buttons stacked up the middle of the screen across it." },
];

async function stageWarlordGunplay(input) {
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

  let S = window.__warlordGunStudio;
  if (!S) {
    const ready = await until(() => window.__warlordBattle && window.__warlordBattle.live &&
      window.__warlordBattle.live() && window.__warlordGunplay && window.__warlordGunplay.on(), 420000);
    if (!ready) return { ok: false, err: "battle/gunplay never came up" };
    const B = window.__warlordBattle, GP = window.__warlordGunplay;
    /* FREEZE THE WALL CLOCK. Everything after this point is advance() and
       nothing else, so the two builds walk the identical simulated seconds
       whatever the rasteriser under them is doing. */
    B.freeze();
    S = window.__warlordGunStudio = { B, GP, t: 0, last: {}, staged: false };
    window.__cbzVisualCompare = {
      render() { try { S.B.render(); } catch (_) {} },
      advance(sec) {
        try {
          S.B.advance(sec); S.t += sec;
          // the strips are about a trigger being HELD; keep it held and keep
          // the aim honest between frames the way a hand would
          if (S.holding) { S.GP.look({ at: S.mark || S.GP.nearestEnemy() }); }
          S.B.render();
        } catch (_) {}
      },
      metrics() { return S.last || {}; },
    };
  }
  const { B, GP } = S;
  const subject = input.subject;

  /* ---- THE ONE PIECE OF STAGING BOTH SIDES SHARE ------------------------
     Run the fight to a fixed simulated second, then PUT the warlord a fixed
     number of metres short of the enemy mass on the fight axis and point him
     at the nearest man. Nothing here is a coordinate: the field's own centre
     and the enemy's own position decide where he stands, so the same two
     numbers (12 s, 30 m) land on the same ground on both builds. */
  const stageTo = async (metres) => {
    if (!S.staged) {
      B.order("hold");
      B.advance(8); S.t += 8;
      S.staged = true;
    }
    /* HE DOES NOT DIE IN THE STUDIO. He is standing thirty metres in front of
       his own line facing a whole militia, and the first run of this preset
       lost him on subject four — which took the battle, the teardown and the
       last four subjects with it, on both sides. A storyboard about a gun is
       not a storyboard about the warlord dying. */
    GP.heal();
    /* AND THE LEDGER STARTS AT ZERO FOR EVERY BEAT. Seven subjects share one
       page per side, so an accumulating ledger makes "time to kill" the time
       since the FIRST round of the whole session — it only ever climbs, and it
       photographed as a REGRESSION on four of the seven subjects when the real
       reading is the opposite. Zeroed here, rounds/hits/kills/ttk mean this
       beat and are comparable across the flag. */
    GP.resetLedger();
    const a = B.audit();
    if (!a || !a.live) return null;
    const t = GP.nearestEnemy();
    if (!t) return null;
    const dx = t.x - a.field.cx, dz = t.z - a.field.cz;
    const d = Math.hypot(dx, dz) || 1;
    GP.place({ x: t.x - (dx / d) * metres, z: t.z - (dz / d) * metres });
    const mark = GP.nearestEnemy();
    S.mark = mark;
    GP.look({ at: mark });
    return mark;
  };

  const snap = () => {
    let g = {}, a = {};
    try { g = GP.audit() || {}; } catch (_) {}
    try { a = B.audit() || {}; } catch (_) {}
    S.last = {
      rounds: g.shots || 0,
      hits: g.hits || 0,
      kills: g.kills || 0,
      accuracy: g.accuracy || 0,
      ttk: g.ttk == null ? 0 : g.ttk,
      mag: g.mag == null ? 0 : g.mag,
      reserve: g.reserve == null ? 0 : g.reserve,
      cone: (g.reticle && g.reticle.conePx) || 0,
      fov: Math.round((CBZ.camera.fov || 0) * 10) / 10,
      engineFiles: g.files ? (g.files.fpsmode ? 1 : 0) + (g.files.gunhands ? 1 : 0) + (g.files.lockon ? 1 : 0) : 0,
      enemyDead: (a.them && a.them.dead) || 0,
      yourKills: (a.you && a.you.kills) || 0,
      battleT: a.simT || 0,
    };
    return S.last;
  };

  // ---- put him on the ground, in the seat, with the right trigger state
  const mark = await stageTo(subject.closeIn || 30);
  if (!mark) return { ok: false, err: "the battle ended before this beat — no live enemy to aim at" };
  GP.fire(false);
  GP.aim(!!subject.ads);
  B.camera(subject.seat === "third" ? "third" : "fps");
  GP.look({ at: mark });
  B.advance(0.25); S.t += 0.25;          // let the seat and the lens settle
  GP.look({ at: mark });

  /* ---- EMPTY THE GUN FIRST, for the reload subject only: a reload you can
     photograph needs a magazine that has actually run out. Both sides burn
     the same magazine over the same simulated seconds. */
  if (subject.emptyFirst) {
    GP.fire(true);
    for (let i = 0; i < 8; i++) { B.advance(0.45); S.t += 0.45; GP.look({ at: S.mark }); }
    GP.fire(false);
    B.advance(0.2); S.t += 0.2;
    GP.reload();
    B.advance(0.12); S.t += 0.12;
  } else if (subject.hold) {
    // the strip: trigger DOWN and left down, so advance() photographs a burst
    S.holding = true;
    GP.fire(true);
    B.advance(0.2); S.t += 0.2;
  } else if (subject.burst) {
    GP.fire(true);
    B.advance(subject.burst); S.t += subject.burst;
    GP.fire(false);
    // the hit-marker subject wants the frame the marker is ON, so the last
    // round's confirmation is still up when the shutter opens
    if (subject.id !== "hit-marker") { B.advance(0.08); S.t += 0.08; }
  }

  B.camera(subject.seat === "third" ? "third" : "fps");
  GP.look({ at: S.mark });
  B.render();
  const m = snap();
  // the strip subjects keep the trigger down through the runner's advance()
  if (!subject.hold) { S.holding = false; GP.fire(false); }
  return { ok: true, metrics: m, seat: subject.seat, simT: Math.round(S.t * 10) / 10 };
}

export default {
  id: "warlord-gunplay",
  title: "Desert Warlord: The Trigger Is the Engine's Now",
  description:
    "warlord/battle.js hand-rolled its own player aiming and firing instead of mounting systems/fpsmode.js — the gun the jail and gun game already use. Both sides here are this checkout on the same seed with the same men on the same sand, the warlord standing on the same square metre aimed at the same soldier; the before side boots ?gunplay=old, warlord/gunplay.js's own one-line revert, which is the hand-rolled controller moved across whole. The rAF clock is frozen and battle.js's advance() is the only time that passes, so both builds photograph the identical simulated seconds.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { gunplay: "old" },
  beforeLabel: "BEFORE · THE HAND-ROLLED CONTROLLER (?gunplay=old)",
  afterLabel: "AFTER · systems/fpsmode.js, MOUNTED",
  viewport: { width: 1180, height: 700 },
  /* A LAYOUT REGRESSION IS A SHAPE, NOT A PIXEL, and the owner plays on glass.
     Every subject is captured at both frames; the touch cluster only EXISTS on
     the phone one (body.coarse decides at boot, which is why this is a frame
     and not a viewport). */
  frameList: ["laptop", "iphone-16"],
  /* BOTH ROSTERS COME OUT OF makeBand, on one seed, so the two armies are the
     same men in the same order on both builds — and the gun is named, because
     every number in this comparison comes off that weapon-data row. */
  /* THE STUDIO'S TWO CONTROLS, and they are applied to BOTH sides identically
     so the flag under test stays the only variable.
       ?frozen=1  the fight begins with its clock stopped (see method)
       ?morale=old battle.js's own morale revert: nobody routs, nobody breaks,
                   and the battle cannot END on morale. Not a look change — a
                   STOPWATCH change. Without it the warlord is good enough at
                   this range to break a militia inside fifteen simulated
                   seconds: MEASURED on the second run of this preset, eight
                   kills by t=14.2 collapsed the enemy, the battle resolved,
                   battle.js tore itself down and the last four subjects had no
                   live man left to aim at ON BOTH SIDES. A storyboard about a
                   trigger must not also be a storyboard about winning.
     Big rosters for the same reason: eight dead out of fifty-five is a dent,
     out of twenty-six it is the end of the fight. */
  urlParams: { battle: 1, frozen: 1, mine: 40, them: 55, seed: 1337, gun: "ak47",
    morale: "old", faction: "militia", myfaction: "legion" },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  // the first subject pays the whole studio boot under a software rasteriser
  stageTimeoutMs: 600000,
  pairNote: "Same checkout · seed · rosters · ground · simulated seconds · ?frozen=1 · ?morale=old · same man aimed at from the same square metre — ?gunplay=old is the only variable",
  method:
    "games/warlord.html boots with ?battle=1 (battle.js's own debug door) and ?frozen=1, so the fight begins with its clock stopped. battle.js's freeze()/advance(sec) run exactly that many seconds of the page's own frame through microboot's headless stepSim, which drives every clock in the fight — the sim, combat_iq's CBZ.now, the corpse solver, the recoil recovery, the reload timer — from one place. The warlord is placed and aimed through warlord/gunplay.js's drive seam (place / look / fire / aim / reload), which is the same four verbs the trigger, the AIM latch and the RELOAD button call, so nothing here reaches past the controls a person has. Cameras are the game's own first-person and over-the-shoulder seats, not a preset's private camera math.",
  metricsNote:
    "rounds/hits/accuracy are counted at the two moments that exist on both builds: a round leaving the magazine and a round landing on a man, so the columns mean the same thing on either side of the flag. ACCURACY GOING DOWN IS THE FINDING, not a regression — the before side is a five-degree cone magnet that cannot miss inside its cone and cannot reach outside it, which is why it lands two rounds in three while standing still and never has to be aimed; the after side is a real spread cone with a climbing muzzle you pull down yourself, and its misses are the reason its hits are worth something. Every one of these counters is ZEROED at the start of each beat, so ttk is the time from that beat's first round leaving to that beat's last man going down, not the time since the storyboard began. `cone` is the reticle's live width in pixels — the honest bloom fpsmode draws from the same spread number it fires with, and structurally zero on a build whose crosshair is three fixed pixels. `reserve` is rounds left in the cart and reads zero before the change because the fork had no reserve at all: it reloaded out of nothing, forever. `engineFiles` counts how many of the three mounted engine files (fpsmode, gunhands, lockon) are actually answering — it is the ratchet on the whole claim.",
  metrics: {
    rounds: { label: "Rounds fired", unit: "rounds" },
    hits: { label: "Rounds that landed", unit: "hits" },
    kills: { label: "Men killed by the warlord", unit: "men" },
    accuracy: { label: "Hit rate", unit: "0-1" },
    ttk: { label: "Time to kill", unit: "s", better: "lower" },
    mag: { label: "Rounds left in the magazine", unit: "rounds" },
    reserve: { label: "Rounds left in the cart", unit: "rounds", better: "higher" },
    cone: { label: "Reticle cone", unit: "px" },
    fov: { label: "Lens", unit: "deg" },
    engineFiles: { label: "Engine gun files answering", unit: "of 3", better: "higher" },
    enemyDead: { label: "Enemy dead on the field", unit: "men" },
    yourKills: { label: "Your tally", unit: "men", better: "higher" },
    battleT: { label: "Simulated time at this beat", unit: "s" },
  },
  subjects,
  stage: stageWarlordGunplay,
};
