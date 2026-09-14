/* NPC WAR — PRODUCT PHOTOGRAPHY, shot by the engine.

   Store covers for games/battle.html: two armies of any size on the real city,
   bombers, nukes, and you holding the camera and the clock. No generated art,
   no replacement scenery: the page boots its own downtown, its own 360 men and
   its own B-2, the war is stepped through battle.html's studio seam
   (freeze/advance/render — the same one soldier-deaths.mjs measures with), and
   the lens is placed by hand once the director has posed the frame.

   Portal rules this obeys (docs.crazygames.com/requirements/game-covers):
     16:9 1920x1080 · 2:3 800x1200 · 1:1 800x800 — no borders, no text but the
     title, no icons.

   ONE PAGE, ONE WAR, THREE SHOTS. battle.html builds ONE map per load and its
   clock only goes forward, so the three subjects are three beats of the same
   war in clock order: the red army filling its street from sixty metres up
   with the blue mass at the far end, the red front rank coming AT the lens at
   rifle range, and the mushroom cloud standing over the far end of the field
   while its cap is still low enough to share a frame with the men under it.

   MEASURED ON THE FIRST TWO RUNS, and why the shots are built the way they are:
     · on the city map the two centres of mass never close past ~54 m — the men
       fight at rifle range down streets, in cover — so a "collision" is not a
       beat this war has. The charge is the red front rank advancing, shot from
       IN FRONT of it: a wall of men and rifles coming down the street.
     · from 250 m up, 180 men in a 200 m grid are specks. The overhead is
       the red column in ITS street from 60 m, the blue mass at the far end.
     · a hand-placed lens 15 m off the street axis stood inside a shop and
       photographed the war through its window. battle.html's own camera arm
       (lookAt → camApply) tests the segment against the colliders and shortens
       until it is clear; every lens here is parked by that arm first and only
       re-AIMED by hand.
     · red's B-2 released 1.5 km off the field (its own aim, not this
       preset's business) and the real-scale cap tops out at 2.5 km. The cover
       fires the bus's own warhead — CBZ.detonate(x, y, z, "nuke"), the exact
       call the falling bomb makes — 450 m beyond the blue line, and shoots it
       while capYNow is ~400 m from behind the survivors furthest from it.
       nukeFxDebug().live now reports x/z so the lens aims at the stem.

   Run (the preset serves this checkout; --only after because there is no
   "before" for a photograph):
     ba npcwar-product --before local --only after --width 1920 --height 1080 \
        --out ~/harness/out/gta6/portal/npcwar --no-open --cdp-timeout 600000
     ... and 800x800, 800x1200.

   HARNESS TRAP: stage() is SERIALIZED into the page, so the cover kit is
   embedded by toString() and nothing from this module's scope is reachable
   inside. Every knob a subject needs rides on input.subject. */
import { coverKit } from './lib/cover-kit.mjs';

const TITLE = 'NPC WAR';
const FONT = 'Black Ops One';

const subjects = [
  { id: 'cover-overhead', at: 12, label: 'The two armies, from above',
    focus: 'The red army filling its street from sixty metres up behind it, the blue mass at the far end of the same street, towers either side.' },
  { id: 'cover-charge', at: 10, front: 30, by: 30, label: 'The charge',
    focus: 'The red front rank coming down the street at the lens, rifles up, shot from a few metres in front of the leading men at chest height.' },
  { id: 'cover-nuke', at: 20, capY: 520, beyond: 950, label: 'The mushroom cloud',
    focus: 'The bus\'s own warhead fired 450 m beyond the blue line, photographed while the cap is ~400 m up and still glowing, from behind the survivors furthest from it, tilted up so the cap sits under the title.' },
];

const readyExpression = 'window.__battle && window.__battle.audit && window.__battle.audit().started';

const stageSource = `async function stage(input) {
  const K = (${coverKit.toString()})();
  const sub = input.subject;
  const B = window.__battle, C = window.CBZ, T = window.THREE;
  if (!B || !C || !C.camera || !T) return { ok: false, missing: '__battle probe' };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- one studio per page: freeze the wall clock, load the type, hide the chrome
  let S = window.__npcwarCover;
  if (!S) {
    B.freeze(); B.speed(1);
    S = window.__npcwarCover = { at: 0, bangAt: null, font: false };
    S.font = await K.font(${JSON.stringify(FONT)}, 400);
    K.hideChrome(C);
    window.__cbzVisualCompare = window.__cbzVisualCompare || {};
    window.__cbzVisualCompare.render = function () { K.render(C); };
  }
  const step = (sec) => { B.advance(sec, 1 / 60); S.at += sec; };
  const audit = () => B.audit();

  // living men by team, off the page's own roster read (studyList lists men when there are no beasts)
  const teams = () => {
    const all = B.swimmers(), out = { red: [], blue: [] };
    for (const m of all) if (out[m.team]) out[m.team].push(m);
    return out;
  };
  const com = (list) => {
    if (!list.length) return null;
    let x = 0, z = 0; for (const m of list) { x += m.x; z += m.z; }
    return { x: x / list.length, z: z / list.length };
  };
  const ground = (x, z) => (C.groundAt ? C.groundAt(x, z) : 0);
  const aspect = innerWidth / innerHeight;
  /* PARK THE LENS ON THE GAME'S ARM, then aim it by hand. lookAt() hands the
     director a focus, a range, a pitch and a yaw; one frame of camApply walks
     the arm in until the segment is clear of the colliders. The position that
     comes back is one no building is standing in. */
  const park = (focus, h, yaw, dist, pitch) => {
    B.lookAt({ x: focus.x, y: ground(focus.x, focus.z), z: focus.z, h: h, yaw: yaw }, dist, pitch);
    step(1 / 60);
    const p = C.camera.position;
    return { x: p.x, y: p.y, z: p.z, arm: +Math.hypot(p.x - focus.x, p.z - focus.z).toFixed(1) };
  };
  // the red men nearest the blue mass — the front of the red army — and their centre
  const redFront = (n) => {
    const tm = teams(), cr = com(tm.red), cb = com(tm.blue);
    if (!cr || !cb) return null;
    const ax = cb.x - cr.x, az = cb.z - cr.z, al = Math.hypot(ax, az) || 1;
    const sorted = tm.red.slice().sort((p, q) => Math.hypot(p.x - cb.x, p.z - cb.z) - Math.hypot(q.x - cb.x, q.z - cb.z));
    const knot = sorted.slice(0, Math.min(n, sorted.length));
    return { tm, cr, cb, ux: ax / al, uz: az / al, al, knot, kc: com(knot) };
  };

  // spawn streams 10 men a frame; let every man arrive before a single beat is photographed
  if (S.at === 0) { for (let i = 0; i < 40 && audit().queued > 0; i++) step(0.25); }

  let lens = null;
  if (sub.id === 'cover-overhead') {
    if (sub.at > S.at) step(sub.at - S.at);
    const f = redFront(40);
    if (!f) return { ok: false, err: 'an army is missing' };
    // sixty metres up behind the red mass, looking down its street at the blue one
    // parked NEAR-VERTICALLY over the ground behind the red mass (an arm that
    // leans back through a hangar collapses to nothing), then aimed down the
    // axis by hand so the blue mass sits in the top of the frame
    const focus = { x: f.cr.x - f.ux * 4, z: f.cr.z - f.uz * 4 };
    const yaw = Math.atan2(-f.ux, -f.uz);
    // a quarter turn off the axis, lower: the two masses run diagonally
    // across the frame and the base (strip, aircraft, towers) is the backdrop
    const yaw2 = Math.atan2(-f.ux * 0.82 + f.uz * 0.57, -f.uz * 0.82 - f.ux * 0.57);
    const pos = park(focus, 0, yaw2, aspect < 1 ? 44 : 50, aspect < 1 ? 0.92 : 0.72);
    const midX = (f.cr.x + f.cb.x) / 2, midZ = (f.cr.z + f.cb.z) / 2;
    lens = K.lens(C, T, pos, { x: midX - f.ux * (aspect < 1 ? 4 : 10), y: ground(midX, midZ) + 2, z: midZ - f.uz * (aspect < 1 ? 4 : 10) }, aspect < 1 ? 64 : 58);
    lens.gap = +f.al.toFixed(1); lens.arm = pos.arm;
    K.lowSun(C, T, { az: Math.atan2(f.ux, f.uz) + 2.0, el: 0.26, color: 0xffd0a0, sun: 1.05, hemi: 0.5, fog: 0xc9c3b6, bot: 0xd9c9b0 });
  }

  if (sub.id === 'cover-charge') {
    if (sub.at > S.at) step(sub.at - S.at);
    // on open ground the lines walk to contact: advance until the red front
    // is within sub.front metres of the blue mass, and never past sub.by
    let f = redFront(24);
    const frontD = () => { const tm = teams(), cb = com(tm.blue); if (!cb) return 0; let d = 1e9; for (const m of tm.red) d = Math.min(d, Math.hypot(m.x - cb.x, m.z - cb.z)); return d; };
    while (f && frontD() > (sub.front || 30) && S.at < (sub.by || 30)) { step(1); f = redFront(24); }
    if (!f) return { ok: false, err: 'an army is missing' };
    // BEHIND AND BESIDE the red front rank, low, looking over their shoulders
    // at the blue line: rifles up and firing away from the lens, the far men
    // in the muzzle light. The knot's own men are not colliders, so the lens
    // walks sideways until no living man is standing in it.
    const tm2 = teams();
    const bf = tm2.blue.slice().sort((p, q) => Math.hypot(p.x - f.kc.x, p.z - f.kc.z) - Math.hypot(q.x - f.kc.x, q.z - f.kc.z)).slice(0, 12);
    const bc = com(bf) || f.cb;
    const tx = bc.x - f.kc.x, tz = bc.z - f.kc.z, tl = Math.hypot(tx, tz) || 1, vx = tx / tl, vz = tz / tl;
    const bx = -vx * 0.72 + vz * 0.69, bz = -vz * 0.72 - vx * 0.69;   // rear three-quarter of the knot
    const dist = aspect < 1 ? 12 : 11;
    const pos = park(f.kc, 0.9, Math.atan2(bx, bz), dist, 0.13);
    for (let k = 0; k < 6; k++) {
      let hit = false;
      for (const m of tm2.red.concat(tm2.blue)) if (Math.hypot(m.x - pos.x, m.z - pos.z) < 1.7) { hit = true; break; }
      if (!hit) break;
      pos.x += vz * 1.6; pos.z -= vx * 1.6;
    }
    pos.y = Math.max(ground(pos.x, pos.z) + 1.7, ground(f.kc.x, f.kc.z) + 1.6);
    // aim past the knot's near edge toward the blue line, so the red wall
    // fills the right two thirds and the blue muzzle flashes sit left of centre
    lens = K.lens(C, T, pos, { x: f.kc.x + vx * Math.min(14, tl * 0.45) - vz * 2, y: ground(bc.x, bc.z) + 1.25, z: f.kc.z + vz * Math.min(14, tl * 0.45) + vx * 2 }, aspect < 1 ? 66 : 58);
    lens.toBlue = +tl.toFixed(1);
    lens.closed = +f.al.toFixed(1); lens.arm = pos.arm; lens.knot = f.knot.length;
    // evening light from behind the lens and a little to the side: faces and rifles lit, the street behind them in haze
    K.lowSun(C, T, { az: Math.atan2(vx, vz) + 2.4, el: 0.18, color: 0xffc890, sun: 1.15, hemi: 0.5, fog: 0xd8c0a4, bot: 0xe6c9a4 });
  }

  if (sub.id === 'cover-nuke') {
    if (sub.at > S.at) step(sub.at - S.at);
    const f = redFront(30);
    if (!f) return { ok: false, err: 'an army is missing' };
    let dbg = C.nukeFxDebug ? C.nukeFxDebug() : null;
    if (!(dbg && dbg.live)) {
      // THE BOMBER'S OWN WARHEAD, released by hand beyond the blue line on the
      // field's axis: CBZ.ordnance.release is the call releaseNuke() makes,
      // with the same kind, so the fall, the bang and the cloud are the game's
      const gx = f.cb.x + f.ux * (sub.beyond || 450), gzz = f.cb.z + f.uz * (sub.beyond || 450);
      const O = C.ordnance;
      if (O && O.release) {
        O.release({ pos: new T.Vector3(gx, ground(gx, gzz) + 420, gzz), vel: new T.Vector3(0, 0, 0),
          kind: (O.kinds && O.kinds.nuke) ? 'nuke' : 'heavy', team: 'red', owner: 'air-red' });
      } else {
        let a = audit();
        for (let i = 0; i < 120 && !(a.nukes >= 1); i++) { step(1); a = audit(); }
      }
      for (let i = 0; i < 120 && !((dbg = C.nukeFxDebug ? C.nukeFxDebug() : null) && dbg.live); i++) step(0.25);
      if (!(dbg && dbg.live)) return { ok: false, err: 'the bomb never went off' };
      S.bangAt = S.at - dbg.live.t;
    }
    // let the head climb to a few hundred metres — young, glowing, and small
    // enough to share a frame with the men under it
    const wantY = sub.capY || 420;
    for (let i = 0; i < 60 && dbg.live && ((dbg.live.capYNow || 0) < wantY || dbg.live.t < 4.5) && dbg.live.t < 14; i++) { step(0.5); dbg = C.nukeFxDebug(); }
    const L = dbg.live || {};
    const gz = { x: L.x != null ? L.x : 0, z: L.z != null ? L.z : 0 };
    const capY = L.capYNow || 300, capW = L.capWNow || 200;
    const top = ground(gz.x, gz.z) + capY + capW * 0.33;
    // THE SURVIVORS. Men still standing, furthest from ground zero: the lens
    // stands behind the biggest such knot and shoots past them at the stem
    const tm = teams(), all = tm.red.concat(tm.blue);
    const far = all.slice().sort((p, q) => Math.hypot(q.x - gz.x, q.z - gz.z) - Math.hypot(p.x - gz.x, p.z - gz.z));
    let knot = far.slice(0, Math.max(6, Math.min(24, (far.length / 4) | 0)));
    let kc = com(knot);
    if (!kc) {
      const cs = B.corpsesOf(false).sort((p, q) => Math.hypot(q.x - gz.x, q.z - gz.z) - Math.hypot(p.x - gz.x, p.z - gz.z));
      kc = com(cs.slice(0, 20)) || { x: gz.x + 150, z: gz.z };
    }
    const dx = gz.x - kc.x, dz = gz.z - kc.z, dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;
    const back = aspect < 1 ? 15 : 13;
    const pos = park(kc, 1.0, Math.atan2(-ux * 0.96 - uz * 0.28, -uz * 0.96 + ux * 0.28), back, 0.13);
    pos.y = ground(pos.x, pos.z) + 1.6;
    // the aim: tilt so the cloud top sits a third down from the frame's top
    const range = Math.hypot(gz.x - pos.x, gz.z - pos.z);
    const fov = aspect < 1 ? 74 : 68;
    const topAng = Math.atan2(top - pos.y, range);
    const pitch = Math.max(0.04, topAng - (fov * Math.PI / 180) * 0.36);
    const aimY = pos.y + Math.tan(pitch) * range;
    lens = K.lens(C, T, pos, { x: gz.x, y: aimY, z: gz.z }, fov);
    lens.gz = [gz.x, gz.z].map((v) => +v.toFixed(0)); lens.capY = +capY.toFixed(0); lens.capW = +capW.toFixed(0);
    lens.range = +range.toFixed(0); lens.knotRange = +dl.toFixed(0); lens.pitchDeg = +(pitch * 57.3).toFixed(1);
    lens.survivors = all.length; lens.sinceBang = +(S.at - S.bangAt).toFixed(1); lens.arm = pos.arm;
    // the bomb is the light; keep the sun low and behind the lens so the men read as shapes
    K.lowSun(C, T, { az: Math.atan2(ux, uz) + Math.PI, el: 0.14, color: 0xffc080, sun: 0.6, hemi: 0.35 });
  }

  // ---- the title, and the frame
  K.hideChrome(C);
  K.vignette({ top: sub.id === 'cover-nuke' ? 0.16 : 0.40, stop: 34 });
  const title = K.title(${JSON.stringify(TITLE)}, { family: ${JSON.stringify(FONT)}, weight: 400, tracking: '.01em',
    scaleW: aspect < 1 ? 0.19 : 0.15, scaleH: 0.16, color: '#f4f1ea',
    shadow: '0 3px 0 #2a2a2a,0 0 2px #000,0 12px 34px rgba(0,0,0,.9)' });
  K.render(C);
  await wait(200);
  K.render(C);
  const a2 = audit();
  return { ok: true, stage: { subject: sub.id, simT: a2.simT, red: a2.red, blue: a2.blue, corpses: a2.corpses, nukes: a2.nukes, lens: lens, title: title, font: S.font, width: innerWidth, height: innerHeight } };
}`;
const stage = new Function('return ' + stageSource)();

export default {
  id: 'npcwar-product',
  title: 'NPC War — in-engine product photography',
  description: 'Store covers for the standalone NPC War release, staged in the shipped page: the military island, 160 v 160 with mixed rifles, red air carrying the nuke. One war, frozen and stepped through battle.html\'s own studio seam, photographed at three beats in clock order.',
  page: 'games/battle.html',
  defaultBefore: 'local',
  beforeLabel: 'SOURCE GAME', afterLabel: 'PRODUCT CAPTURE',
  pairNote: 'Every pixel is games/battle.html rendering its own war · title is the only overlay',
  urlParams: {
    auto: 1, probe: 1, settle: 0,
    map: 'island', red: 160, blue: 160, rw: 'mixed', bw: 'mixed', rt: 'elite', bt: 'pro',
    rs: 'nuke', bs: 'none', killcam: 0,
  },
  readyExpression,
  stageTimeoutMs: 600000,
  metrics: {}, metricsNote: 'Product captures, not a gameplay score.',
  subjects, stage,
};
