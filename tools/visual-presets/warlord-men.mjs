/* DESERT WARLORD — THE MEN ON THE MAP, cone against man.

   OWNER, verbatim: "Right now when walking around the NPCs look like fucking
   cone glitchy people on the map instead of like the character, and like the
   already easy and built fucking NPC war. Whatever you did for putting NPCs
   on the map failed massively." And, in the same breath: "But when you get
   close NPCs look great."

   He is describing exactly what the code did. `campaign.js` drew every man on
   the island — your whole column and all forty warbands — as
   `CylinderGeometry(0.26, 0.38, 1.30, 6)` with a `BoxGeometry(0.34)` on top.
   A six-sided cone with a head. The one real body on the entire island was
   the player's. The file defended it with a real measurement (60 studio.cast
   rigs is ~1 100 draw calls and 22 fps; a cone is 2 draw calls) and the
   measurement was true — the conclusion was not. It solved the four-hundred-
   men-at-200-m case and applied that answer to the six men three metres from
   the camera.

   WHAT IS UNDER TEST. A two-band LOD: real pooled `studio.cast` rigs inside
   150 m of the camera, dressed by `W.outfits.cast`, walking on `CBZ.animChar`,
   seated by `W.sand.plant`; a nine-box instanced MAN past it, cut from
   `CBZ.charProfile()` — the rig's own proportion table — so the two forms
   are the same body at two costs.

   THE BEFORE IS THAT FILE'S OWN REVERT. `?men=old` restores the cone, the old
   camera-driven size lie and no near band at all, byte for byte. Both columns
   are THIS checkout, same seed, same coordinates, same cameras, same in-game
   hour, same simulated seconds — so every pixel of difference is this wave.
   `?weather=off` is set on both sides because a sandstorm on one column and
   not the other would be a second variable.

   HOW THE PICTURES ARE MADE. The campaign boots for real on ?go=1, the rAF
   loop is then STOPPED (`CBZ.micro.stop()`) and `CBZ.stepSim` becomes the only
   clock, so both machines photograph the same simulated instant however fast
   they are. Framing uses the game's own camera — its position comes from
   `campaign.camDist`/`camYaw` and the follow rig, exactly where a player's
   camera would be — and only the AIM and the focal length are chosen for the
   photograph, identically on both sides. A live-loop window is re-opened
   around each subject purely to sample fps and draw calls with the renderer
   actually running.

   WHAT TO LOOK FOR, because no number can see it:
     · the column   — men with arms, legs and a stride, or traffic cones?
     · the warband  — can you tell a helmeted veteran from a bare-headed levy?
     · the boundary — the strip walks ONE band from 130 m to 190 m across the
                      swap with the focal length compensating, so every frame
                      shows the same men at the same size on screen and the
                      ONLY thing changing is which form is drawing them. If
                      the after row does not jump between frames 2 and 3, the
                      swap does not pop. (The before row is cones throughout,
                      which is the other half of the story.)
     · the gait     — the walk strip is the column over half a second. Legs
                      swing or they do not.                                  */

/* THE SWAP STRIP'S RANGES live INSIDE the stage, not here: `stage` is
   serialized into the browser and cannot close over a module-scope const (the
   first run of this preset failed on exactly that, twice, with
   "SWAP_RANGE is not defined"). This copy is documentation only. NEAR_IN is
   150 m and NEAR_OUT is 178 m, so a band walked outward from 130 m keeps its
   rigs until 178 and is instanced after — the crossing lands between the
   third and fourth frame of the strip. */

const subjects = [
  {
    id: "column-ride",
    label: "The Column — 40 Men Behind You, At Riding Distance",
    focus: "THE SIGNATURE IMAGE OF THE GAME and the shot the complaint is about. Forty men following the breadcrumb of ground you have actually ridden, at the pull-back a player rides at. BEFORE: forty six-sided cones with boxes on top. AFTER: forty bodies with arms, legs, boots and their own army's uniform, every one of them a real studio.cast rig because every one of them is inside 150 m of the camera.",
    camDist: 62, hour: 9.0, army: 40, ride: 1, aim: "column", fov: 30, swing: 1.25,
  },
  {
    id: "column-gait",
    label: "The Column Walking — Half A Second Of Stride",
    focus: "A still cannot show a walk. Five frames of the same simulated seconds on both sides. AFTER: the near band runs CBZ.animChar, so hips and shoulders counter-rotate and the legs pass each other — the same gait battle.js puts on the sand. BEFORE: a cone has no legs, so the only motion available to it is the vertical bob, and the row is five copies of one picture.",
    camDist: 40, hour: 9.0, army: 40, ride: 1, aim: "column", fov: 30, swing: 1.5,
    strip: { frames: 5, stepSec: 0.14 },
  },
  {
    id: "warband-30m",
    label: "A Warband Met Head-On, 30 m Out",
    focus: "The encounter range — where the owner's 'when you get close NPCs look great' is supposed to be true and, for everybody who is not the player, was not. AFTER: real rigs wearing outfits.js's painted fits, so the party's tiers are readable — a helmeted veteran beside a bare-headed levy, webbing on the men who have earned it. BEFORE: fourteen identical cones in one flat faction hex.",
    camDist: 22, hour: 9.6, army: 12, band: 30, fov: 26, aim: "band",
  },
  {
    id: "swap-boundary",
    label: "The Swap — One Band Walked From 130 m To 205 m",
    focus: "THE POP TEST, and it is built so it cannot be fudged. One band is moved outward through the LOD boundary while the focal length is compensated so the men hold the SAME size on screen in every frame — the only thing changing across the row is which form is drawing them. The crossing is between frames 3 and 4. Height, ground line, stance width, uniform colour and cap colour all come off the same body table and the same fit record, so there is nothing left to jump.",
    camDist: 18, hour: 9.4, army: 0, band: 130, aim: "band", swap: 1,
    strip: { frames: 5, stepSec: 0.5 },
  },
  {
    id: "mixed-field",
    label: "A Mixed Field — Five Parties At Strategic Zoom",
    focus: "The far band doing its job, which is the job the cone was actually built for. Five warbands and your own column at the pull-back you make decisions from. Nothing here is a rig — everything is instanced, two colours a man, a handful of draw calls for the whole island. The question is only whether a speck reads as a PERSON: head over shoulders over a gap between two legs, or a traffic cone.",
    camDist: 190, hour: 10.2, army: 40, ride: 1, field: 5, aim: "field", fov: 26, swing: 0.55,
  },
];

async function stageWarlordMen(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.warlord || !CBZ.warlord.campaign) return { ok: false, missing: "warlord" };
  const W = CBZ.warlord, D = W.desert, C = W.campaign, S = W.state;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let X = window.__wlMen;
  if (!X) {
    X = window.__wlMen = {
      /* NOTHING MAY WANDER INTO THE SHOT AND START A FIGHT. The contact test
         is the same code on both sides, so an encounter card over one column
         would void the pair outright. */
      calm() { for (let i = 0; i < S.bands.length; i++) S.bands[i].cooldown = 1e9; },
      step(n) { for (let i = 0; i < n; i++) { X.calm(); CBZ.stepSim(1 / 60); } },
      shot: null,
      /* THE AIM AND THE FOCAL LENGTH ARE THE ONLY THINGS THE PRESET CHOOSES.
         The camera's POSITION is the game's — campaign.js's own follow rig at
         the requested pull-back — so these are photographs of the real camera,
         not of a flying rig that no player ever gets. Both sides get the same
         two numbers. matrixWorld is forced because core/matrixskip.js skips
         the recompute for anything the frame did not touch. */
      applyCam() {
        const s = X.shot;
        if (!s) return;
        const cam = CBZ.camera;
        cam.fov = s.fov; cam.updateProjectionMatrix();
        cam.lookAt(s.tx, s.ty, s.tz);
        cam.updateMatrixWorld(true);
      },
      metrics() {
        const a = C.audit();
        const m = {
          nearRigs: a.men ? a.men.rigs : 0,
          farMen: a.men ? a.men.impostors : 0,
          menMs: a.men && a.men.ms != null ? a.men.ms : null,
        };
        /* DRAW THE PHOTOGRAPHED FRAME BEFORE READING ITS COST. r128 resets
           renderer.info.render at the top of every render(), so whatever call
           happened to be last — an fps sample frame, a strip frame from the
           previous range — is what the number would otherwise describe. The
           first run reported 23 draw calls for a shot containing forty rigs. */
        if (CBZ.renderer && CBZ.camera) { X.applyCam(); try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} }
        if (CBZ.renderer && CBZ.renderer.info) {
          m.drawCalls = CBZ.renderer.info.render.calls;
          m.triangles = Math.round(CBZ.renderer.info.render.triangles / 1000);
        }
        if (X.lastFps != null) m.fps = X.lastFps;
        return m;
      },
      /* FPS NEEDS THE RENDERER ACTUALLY RUNNING, and the rest of this stage
         deliberately has it stopped so both machines photograph the same
         simulated instant. So the loop is restarted for a fixed wall-clock
         window per subject, sampled, and stopped again. The world is calm and
         the camera is settled, so the sampled frames are the photographed
         state. Under headless SwiftShader this number is fill-rate bound and
         barely moves — see metricsNote; drawCalls and menMs are the numbers
         that discriminate here. */
      async sampleFps(ms) {
        if (!CBZ.micro || !CBZ.micro.start) return null;
        CBZ.micro.start();
        const t0 = performance.now();
        let f = 0;
        await new Promise((res) => {
          const tick = () => { f++; if (performance.now() - t0 > ms) return res(); requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        });
        const dt = (performance.now() - t0) / 1000;
        CBZ.micro.stop();
        X.lastFps = Math.round((f / dt) * 10) / 10;
        return X.lastFps;
      },
    };
    /* THE RUNNER'S HOOKS. render() re-applies the chosen aim and draws — but
       inside a requestAnimationFrame, because with the loop stopped nothing
       else commits a frame to the compositor and Page.captureScreenshot would
       hand back whatever was on screen before the stage ran. */
    window.__cbzVisualCompare = {
      async render() {
        try {
          await new Promise((r) => requestAnimationFrame(() => {
            X.applyCam();
            try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
            requestAnimationFrame(() => r(1));
          }));
        } catch (e) {}
        await sleep(120);
      },
      advance(sec) {
        if (X.advanceHook) { X.advanceHook(sec); return; }
        X.step(Math.max(1, Math.round(sec * 60)));
      },
      metrics() { return X.metrics(); },
    };
  }

  // ---- boot: the shell's ?go=1 already put us on the island -------------
  for (let t = 0; t < 400 && W.phase() !== "campaign"; t++) await sleep(120);
  if (W.phase() !== "campaign") return { ok: false, missing: "campaign phase (" + W.phase() + ")" };
  /* CBZ.stepSim IS THE ONLY CLOCK from here. Stopping microboot's rAF loop is
     what makes that true: with it running, the camera lerp and the world tick
     keep moving between the stage's last statement and the screenshot, and a
     chosen aim is overwritten by the follow rig before the pixel is read. */
  if (CBZ.micro && CBZ.micro.stop) CBZ.micro.stop();
  X.calm();
  X.advanceHook = null;

  // ---- the roster -------------------------------------------------------
  const want = sub.army | 0;
  for (let i = S.army.length; i < want; i++) {
    W.addSoldier(W.makeSoldier(i % 4 === 0 ? "veteran" : i % 3 === 0 ? "soldier" : i % 2 ? "raider" : "levy", "carbine"));
  }
  while (S.army.length > want) W.removeSoldier(S.army[S.army.length - 1].id);

  S.hour = sub.hour;
  C.camYaw(S.you.yaw);
  C.camDist(sub.camDist);
  /* STOP HIM BETWEEN SUBJECTS. The runner drives every subject through ONE
     page per side in declaration order, so a destination set by the column
     shot is still being ridden toward when the warband shot stages — which is
     how the two sides ended up photographing a band 9 m away on one and 7 m
     on the other. Re-issuing his own position as the destination parks him. */
  C.dest(S.you.x, S.you.z);
  X.step(40);

  /* ---- the trail. The column follows breadcrumbs of ground the player HAS
     ACTUALLY BEEN OVER, so a column shot cannot be posed — he has to ride,
     the same destination for the same simulated seconds on both sides. */
  if (sub.ride) {
    C.dest(S.you.x + Math.sin(S.you.yaw) * 900, S.you.z + Math.cos(S.you.yaw) * 900);
    X.step(560);
    C.camYaw(S.you.yaw); C.camDist(sub.camDist);
    X.step(30);
  }

  /* ---- the parties. Bands are parked at chosen ranges ALONG THE VIEW AXIS
     and camped so they hold still; everything else is pushed off the island's
     drawn radius so only the subject is in shot. Deterministic on both sides:
     the coordinates are computed from the player's own settled position. */
  const yaw = S.you.yaw;
  const parkAll = () => {
    for (let i = 0; i < S.bands.length; i++) {
      S.bands[i].x = S.you.x + 9000 + i * 40;
      S.bands[i].z = S.you.z + 9000;
      S.bands[i].mood = "camp"; S.bands[i].pause = 1e9; S.bands[i].spd = 0;
    }
  };
  const place = (b, ahead, side) => {
    b.x = S.you.x + Math.sin(yaw) * ahead + Math.cos(yaw) * (side || 0);
    b.z = S.you.z + Math.cos(yaw) * ahead - Math.sin(yaw) * (side || 0);
    b.yaw = yaw + Math.PI;             // facing you: met head-on
    b.mood = "camp"; b.pause = 1e9; b.spd = 0;
  };
  let subjectBand = null;
  if (sub.band != null) {
    parkAll();
    subjectBand = S.bands[0];
    // `band` is metres from the CAMERA, which sits camDist behind the player
    place(subjectBand, sub.band - sub.camDist, 0);
  } else if (sub.field) {
    parkAll();
    for (let i = 0; i < sub.field && i < S.bands.length; i++) {
      place(S.bands[i], 140 + i * 95, ((i % 2) ? 1 : -1) * (60 + i * 34));
    }
  }
  X.step(24);

  /* ---- framing. `aim` names what the shot is OF; the lens is chosen per
     subject and is identical on both sides. */
  const camPos = CBZ.camera.position;
  const aimAt = () => {
    if (sub.aim === "band" && subjectBand) {
      return { x: subjectBand.x, y: D.heightAt(subjectBand.x, subjectBand.z) + 1.0, z: subjectBand.z };
    }
    if (sub.aim === "field") {
      // the middle of the parked field, so the near party and the far one are
      // both in frame at a size a reader can actually judge
      const b = S.bands[1] || S.bands[0];
      return { x: b.x, y: D.heightAt(b.x, b.z) + 2, z: b.z };
    }
    /* THE COLUMN: aim at its MIDDLE. The men are strung back along the trail
       from the player, so aiming at him puts the column in the bottom corner
       (which is what the first pair did) and aiming at the tail puts him out
       of frame. Half the drawn column's length behind him is the centre of
       the thing being photographed. */
    const drawn = Math.min(60, S.army.length);
    const back = Math.max(6, drawn * 0.55);
    /* AIMED ABOVE THE MEN, NOT AT THEM. The follow camera looks down, so a
       target at head height puts the column in the top third with half the
       frame empty sand in front of it, which is what the first pair did.
       Lifting the target tilts the camera up and drops the column into the
       middle; a tenth of the pull-back is the amount that does it at every
       distance this preset shoots from. */
    return { x: S.you.x - Math.sin(yaw) * back, y: D.heightAt(S.you.x, S.you.z) + sub.camDist * 0.10, z: S.you.z - Math.cos(yaw) * back };
  };
  /* THE CAMERA SWINGS ROUND TO THE FLANK for the column shots, and that is
     not a cheat — it is the drag every player does, through campaign.js's own
     camYaw. Photographed from directly behind, a column is one man's back
     occluding thirty-nine others and a walk cycle is invisible; from the side
     the column has LENGTH and the legs pass each other on camera. */
  if (sub.swing) { C.camYaw(S.you.yaw + sub.swing); X.step(50); }
  const a0 = aimAt();
  X.shot = { fov: sub.fov || 55, tx: a0.x, ty: a0.y, tz: a0.z };

  /* ---- the swap strip. Each frame walks the band 18-19 m further out AND
     shortens the lens by exactly the amount that holds the men at the size
     they were, so the row is one set of men at one size crossing a boundary.
     manScale is campaign.js's own size lie and is reproduced here rather than
     guessed: the compensation has to use the number the game is using or the
     strip would prove nothing. */
  if (sub.swap && subjectBand) {
    const SWAP_RANGE = [130, 150, 168, 186, 205];
    const manScale = (d) => 1 + 2.2 * Math.max(0, Math.min(1, (d - 60) / 460));
    const fovFor = (d) => {
      const k = (manScale(d) / d) / (manScale(SWAP_RANGE[0]) / SWAP_RANGE[0]);
      return 2 * Math.atan(Math.tan((sub.fov || 15) * Math.PI / 360) * k) * 180 / Math.PI;
    };
    let stripI = 0;
    const put = (d) => {
      place(subjectBand, d - sub.camDist, 0);
      X.step(14);
      const p = { x: subjectBand.x, y: D.heightAt(subjectBand.x, subjectBand.z) + 1.0, z: subjectBand.z };
      X.shot = { fov: fovFor(d), tx: p.x, ty: p.y, tz: p.z };
    };
    put(SWAP_RANGE[0]);
    X.advanceHook = function () {
      stripI = Math.min(SWAP_RANGE.length - 1, stripI + 1);
      put(SWAP_RANGE[stripI]);
    };
  }

  await X.sampleFps(1400);
  X.applyCam();
  try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
  await sleep(200);

  return {
    ok: true,
    camera: { x: camPos.x, y: camPos.y, z: camPos.z },
    you: { x: Math.round(S.you.x), z: Math.round(S.you.z) },
    metrics: X.metrics(),
  };
}

export default {
  id: "warlord-men",
  title: "Desert Warlord: Men On The Map, Not Cones",
  description:
    "Both columns are THIS checkout on seed 4242 with weather held off. The before side boots with ?men=old — campaign.js's own one-line revert, which restores the six-sided cone-with-a-box every man on the island used to be, the camera-driven size lie and no near band at all. The after side is the two-band LOD: pooled studio.cast rigs inside 150 m of the camera, a nine-box instanced man past it. Same seed, same ground, same cameras, same in-game hour, same simulated seconds.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { men: "old" },
  beforeLabel: "BEFORE · ?men=old (the cone)",
  afterLabel: "AFTER · POOLED RIGS + BOX-MAN IMPOSTOR",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.campaign && CBZ.warlord.campaign.audit)",
  urlParams: { go: 1, seed: 4242, weather: "off" },
  // the first stage pays the studio + armoury + module boot and then raises
  // 14 km of terrain; under software WebGL that is minutes.
  stageTimeoutMs: 480000,
  pairNote: "Same checkout · seed 4242 · same ground · same camera · same hour · same simulated seconds — ?men=old is the only variable",
  method:
    "Both sides are this checkout served by the same local server; the before side adds ?men=old, the revert campaign.js ships for its own men-drawing path. The page's ?go=1 boots straight onto the island, then microboot's rAF loop is STOPPED and CBZ.stepSim is the only clock, so both machines photograph the same simulated instant. The roster is built with W.makeSoldier and the column RIDES rather than posing, because followers walk breadcrumbs of ground the player has actually crossed. Warbands are parked at stated ranges along the view axis and camped; every other party is pushed off the drawn radius. The camera's POSITION is the game's own follow rig at the requested pull-back — only the aim and the focal length are chosen, identically on both sides. fps is sampled by restarting the real loop for 1.4 s per subject with the world calm and the camera settled, then stopping it again.",
  metricsNote:
    "nearRigs is the whole claim as an integer: how many men in frame are real studio.cast bodies. It is 0 on the before side by construction. drawCalls DELIBERATELY HAS NO PREFERRED DIRECTION — it must go up, because a rig measures 25.1 draw calls with everything visible and about 21 with its four face meshes culled, where a cone was a share of two; the budget the after side is held to is battle.js's own measured 1 109 calls with 40 rigs in frame on this same page, and the near band is capped at 48 bodies to stay under it. fps has no direction either, and for an honest reason: headless SwiftShader is fill-rate bound here and reads about 5 fps whatever the draw calls do, so it cannot discriminate and must not be allowed to pretend it can — draw calls and menMs are the numbers with signal. menMs is the wall time of campaign.js's own men loop and it has NO preferred direction either, because the after side is honestly doing more inside it: gathering every man into a record list, sorting the near ones by camera distance, planting up to forty-eight rigs on the drawn sand and stepping their gaits. It is published so the trade is visible rather than guessed at. The one thing inside it that got cheaper is W.outfits.marks(), now cached per soldier — 2.35 microseconds a call warm, which is 0.14 ms a frame for a sixty-man column and 2.3 ms in a field of forty warbands where nine hundred bodies are drawn.",
  metrics: {
    nearRigs: { label: "Men in frame that are real rigs", unit: "bodies", better: "higher" },
    farMen: { label: "Men drawn as instanced impostors", unit: "bodies" },
    menMs: { label: "Cost of the whole men loop", unit: "ms/frame" },
    drawCalls: { label: "Draw calls", unit: "calls" },
    triangles: { label: "Triangles submitted", unit: "k tris" },
    fps: { label: "Frames per second (SwiftShader, fill-bound)", unit: "fps" },
  },
  subjects,
  stage: stageWarlordMen,
};
