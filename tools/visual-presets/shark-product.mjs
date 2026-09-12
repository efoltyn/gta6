/* Shark Sim — PRODUCT PHOTOGRAPHY, shot by the engine.

   Store covers and the preview video for the standalone Shark Sim release. No
   generated art, no replacement animals, no edits to gameplay: the same breach
   driver tools/visual-presets/shark-breach.mjs uses to MEASURE the jump is
   borrowed here to POSE it, then the lens is fitted to the body and the sun
   is pinned at golden hour. Everything in the frame is the shipped build.

   Portal rules this obeys (docs.crazygames.com/requirements/game-covers):
     16:9 1920x1080 · 2:3 800x1200 · 1:1 800x800 — no borders, no text but the
     title, no icons. Video 15-20 s, no sound, no cursor, no black frames, and
     the opening frame should BE the static cover, so the trailer holds the
     cover for its first half second before the sim starts stepping.

   Run against the DISTRIBUTION build, never the dev checkout:
     ba shark-product --before local --after http://127.0.0.1:8644/ --only after \
        --width 1920 --height 1080 --out ~/harness/out/gta6/shark-release/covers-16x9
     ba shark-trailer ... --width 1920 --height 1080     (and 1080x1620 for 2:3)

   HARNESS TRAP: stage() is SERIALIZED into the page, so the breach driver is
   embedded by toString() and nothing from this module's scope is reachable
   inside. Every knob a subject needs rides on input.subject. */
import breach from './shark-breach.mjs';

const SUN = 0.47;            // CBZ.dayPhase: 0 sunrise, .25 noon, .5 sunset. .47 = the burn, sun still up
const TITLE = 'SHARK SIM';

const subjects = [
  { id: 'cover-white', ch: 1, tier: 2, jaw: 0.9, label: 'Great white at the apex', low: true,
    focus: 'The breach chapter the measurement preset stages, photographed as a cover: sun pinned to golden hour, jaws open, lens low over the swell fitted to the posed body.' },
  { id: 'cover-meg', ch: 1, tier: 3, jaw: 0.9, label: 'Megalodon at the apex', low: true,
    focus: 'Same keys, three rungs up the ladder. The animal that sells the fantasy.' },
  { id: 'cover-jaws', ch: 1, tier: 2, jaw: 1, label: 'Down the throat', front: true,
    focus: 'The lens parked a body-length ahead of the great white at the waterline, looking straight into the gape.' },
];

const stageSource = `async function stage(input) {
  const stageSharkBreach = ${breach.stage.toString()};
  const sub = input.subject;
  // 1. the breach driver boots, climbs, parks, sprints and lifts the animal
  const result = await stageSharkBreach(input);
  if (!result || !result.ok) return result;
  const C = window.CBZ, T = window.THREE, D = window.__sharkBreach;
  if (!D) throw new Error('breach driver missing');
  const RUN = 1 / 30;
  const sun = ${SUN};

  // 2. the sun — daynight.js's own clock, then a few steps so the light rig follows
  if (typeof C.dayPhase === 'function') { C.dayPhase(sun); D.step(4); }

  // 3. optionally a bigger animal on the same arc: re-run the ride at tier 3
  if (sub.tier === 3 && C.sharkSim.tier < 3) {
    D.keys(false, false, false, false);
    D.climbTo(3); D.peace();
    const spot = D.deepSpot(34, 1.9); if (!spot) throw new Error('no deep water for a megalodon');
    const heading = spot.ang + Math.PI * 0.5;
    D.park(spot, heading);
    D.keys(true, true, false, false); D.sec(2.2);
    D.arc.length = 0; D._prev = null;
    D.keys(true, true, true, false);
    if (D.until((r) => r.air === 1, 300) < 0) throw new Error('the megalodon never left the water');
    D.until((r) => r.air === 1 && r.vy <= 0, 120);
  }

  const S = C.sharkSim.shark;
  if (!S || !S.group) throw new Error('no player shark to photograph');
  // THE POSE IS A PHOTOGRAPH, NOT A MEASUREMENT. The breach's flank roll and
  // pitch differ run to run (measured: 5 to 50 degrees of roll), and a rolled
  // animal fitted to its own bounding box came out with the head cut off. A
  // cover holds one pose: level, nose a little up, so the face is the frame.
  S.group.rotation.x = 0; S.group.rotation.z = sub.front ? 0.18 : 0.42;
  // 4. the gape. wildlife_rig.js's own jaw seam; the arc re-closes it only for wild strikes.
  if (C.swimJaw && sub.jaw) { try { C.swimJaw(S, sub.jaw); } catch (e) {} }
  S.group.updateMatrixWorld(true);

  // 5. clean frame: the game canvas and nothing else
  for (const el of document.body.children) {
    if (el.id !== 'game' && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && el.tagName !== 'CANVAS') el.style.setProperty('display', 'none', 'important');
  }
  if (C.bootMeter && C.bootMeter.hide) { try { C.bootMeter.hide(); } catch (e) {} }

  // 6. the lens, fitted to the POSED body for whatever ratio ba was asked for
  const cam = C.camera, aspect = innerWidth / innerHeight;
  const box = new T.Box3().setFromObject(S.group);
  const center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
  const radius = size.length() / 2;
  cam.fov = sub.front ? 50 : 40; cam.aspect = aspect; cam.updateProjectionMatrix();
  const vfov = cam.fov * Math.PI / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const fit = radius / Math.sin(Math.min(vfov, hfov) / 2);
  const h = S.heading || 0;
  const sea = D.seaY(center.x, center.z);
  let aim;
  if (sub.front) {
    // a body-length ahead of the nose, a hand over the water, looking back into the mouth
    const jaw = (C.creatureJawPoint ? C.creatureJawPoint(S) : { x: 2, y: 0.7, z: 0 });
    const jw = new T.Vector3(jaw.x, jaw.y, jaw.z).applyMatrix4(S.group.matrixWorld);
    // twenty degrees off the axis: dead ahead the eyes sit on the sides of a
    // wedge and perspective hides both; a hair off, one shows with the mouth
    const ahead = new T.Vector3(Math.cos(h + 0.35), 0, Math.sin(h + 0.35));
    const crown = new T.Vector3(jw.x, box.max.y, jw.z);
    aim = jw.clone().lerp(crown, 0.22);
    // a third of the body length ahead: the head fills the middle of the frame
    // measured: 0.34 of the body length put the lens on the nose, the old
    // 0.55 from the jaw point framed the whole head; 0.55 from the head's
    // centre, level with it, is the storyboard's frame
    const headR = size.y * 0.5;
    const dist = Math.max(2.5, size.x * 0.55);
    cam.position.copy(aim).addScaledVector(ahead, dist);
    cam.position.y = Math.max(sea + 0.6, aim.y - headR * 0.25);   // a little below, looking up into it
  } else {
    // three-quarter from the flank, LOW: the horizon in the lower third, sky behind the animal
    const dir = new T.Vector3(Math.cos(h + 1.05), sub.low ? 0.10 : 0.24, Math.sin(h + 1.05)).normalize();
    cam.position.copy(center).addScaledVector(dir, fit * (aspect < 1 ? 0.95 : 0.86));
    cam.position.y = Math.max(sea + 1.4, cam.position.y);
    aim = center.clone(); aim.y += radius * (aspect < 1 ? 0.40 : 0.16);
  }
  cam.up.set(0, 1, 0); cam.lookAt(aim); cam.updateMatrixWorld(true);

  // 7. the title — the one word the portal allows on a cover
  let title = document.getElementById('sharkProductTitle');
  if (!title) { title = document.createElement('div'); title.id = 'sharkProductTitle'; document.body.appendChild(title); }
  const px = Math.round(Math.min(innerWidth * 0.135, innerHeight * 0.17));
  title.style.cssText = 'position:fixed;z-index:2147483647;top:' + (aspect < 1 ? 6 : 5) + '%;left:4%;right:4%;text-align:center;color:#fff;font-family:Fredoka,\\'Arial Black\\',Arial,sans-serif;font-weight:900;font-size:' + px + 'px;line-height:.86;letter-spacing:-.05em;text-shadow:0 5px 0 #08344b,0 10px 28px rgba(2,24,40,.85);pointer-events:none';
  title.textContent = ${JSON.stringify(TITLE)};
  title.style.display = '';

  // 8. THE TRAILER HOOK. One fixed 1/24 s sim step per encoded frame, real
  //    keys, and the GAME'S OWN chase camera from the first cut on (what the
  //    player sees, underwater grade included). The first half second holds
  //    the cover through the product lens. Two traps this hook owns:
  //      · the day is 150 s long, so a sun pinned at .47 SETS during a 16 s
  //        clip (the first cut of this trailer faded to black) — pinned per frame;
  //      · state.js raises a "Click to capture the mouse" pill on a playing
  //        desktop page with no pointer lock — hidden per frame, it is re-shown.
  const H = window.__cbzVisualCompare;
  const yaw0 = C.cam ? C.cam.yaw : 0;
  const sunClip = 0.38;
  H.videoFrame = async function (dt, index) {
    if (index <= 12) { C.renderer.render(C.scene, cam); return; }
    title.style.display = 'none';
    // state.js re-shows the pill by writing style.display each frame, which
    // overwrites an inline !important; a stylesheet rule outranks it.
    if (!document.getElementById('sharkProductNoHint')) { const st = document.createElement('style'); st.id = 'sharkProductNoHint'; st.textContent = '#lockHint{display:none!important}'; document.head.appendChild(st); }
    if (typeof C.dayPhase === 'function') C.dayPhase(sunClip);
    const t = index * dt;
    // sprint the whole way; a short run-up, then the rise key HELD so the body
    // keeps the surface and leaps again instead of sinking out of the picture
    const cycle = t % 5;
    const rise = cycle > 1.4;
    D.keys(true, true, rise, false);
    // steer along the shore with an outward lean, so sixteen seconds of sprint
    // never runs the animal up the beach (the first cut ended on the sand)
    if (C.cam && C.surv && C.surv.arena) {
      const A = C.surv.arena, p = S.group.position;
      const rx = p.x - A.center.x, rz = p.z - A.center.z, rl = Math.hypot(rx, rz) || 1;
      const ox = rx / rl, oz = rz / rl;
      const hh = S.heading || 0;
      const tsign = (Math.cos(hh) * -oz + Math.sin(hh) * ox) >= 0 ? 1 : -1;   // keep the tangent we are already on
      const dx = -oz * tsign * 0.9 + ox * 0.35, dz = ox * tsign * 0.9 + oz * 0.35;
      const want = Math.atan2(dz, dx);
      C.cam.yaw = Math.atan2(-Math.cos(want), -Math.sin(want));
    }
    C.stepSim(dt);
    C.renderer.render(C.scene, C.camera);
  };

  await H.render();
  result.productCapture = { subject: sub.id, species: S.species && S.species.id, tier: C.sharkSim.tier, sun: sun,
    bounds: size.toArray().map((v) => +v.toFixed(2)), camera: cam.position.toArray().map((v) => +v.toFixed(2)),
    width: innerWidth, height: innerHeight, scripted: true };
  return result;
}`;
const stage = new Function('return ' + stageSource)();

export default {
  ...breach,
  id: 'shark-product',
  title: 'Shark Sim — in-engine product photography',
  description: 'Store covers for the standalone Shark Sim release, staged in the shipped build: the breach driver poses the animal, the sun is pinned at golden hour, the jaws are opened through the rig\'s own seam, and the lens is fitted to the posed body for whatever ratio the run asks for.',
  beforeLabel: 'SOURCE GAME', afterLabel: 'PRODUCT CAPTURE',
  pairNote: 'Every pixel is the distribution build rendering its own scene · title is the only overlay',
  metrics: {}, metricsNote: 'Product captures, not a gameplay score.',
  subjects, stage,
};
