/* NPC WAR — WHAT A STRANGER SEES IN THE FIRST MINUTE.

   npcwar-product.mjs photographs covers: it relights the sun, hand-places the
   lens and prints a title. That is right for a store and wrong for judging the
   game, because none of it is what a player gets. This preset changes NOTHING
   on the page — no sun, no lens, no hidden chrome. It opens the war room, reads
   it, presses START like a person would, and then lets the page's own director
   camera choose every frame, with the HUD on.

   ONE PAGE, ONE WAR. battle.html builds one map per load and its clock only
   goes forward, so the subjects are beats of one session in order:
     menu      the setup card before anything is pressed
     opening   ~1.5 s after START: the banner, the two armies forming up
     contact   ~14 s: the auto director on the first real firefight
     follow    FOLLOW RED on the front man — the soldier at chest range
     field     a wide, low look across the battle (the page's own lookAt seam,
               arm-parked like every other lens it has) — the ground, the sky
               and the armies in one frame

   The ground comes from the URL (`map`, default dunes — the owner's pick). The
   same preset runs any venue: ba --after-params "map=water" etc. Everything
   else stays at the page's own defaults (30 v 30, AK-47, soldiers), because
   the defaults ARE the first minute.

     ba --preset npcwar-look --before http://127.0.0.1:8631/ --width 1280 --height 800
*/
const subjects = [
  { id: 'menu', label: 'The war room', focus: 'The setup screen a stranger lands on, before anything is pressed.' },
  { id: 'opening', at: 1.5, label: 'START pressed', focus: 'The first frame of the war under the auto director, banner up.' },
  { id: 'contact', at: 14, label: 'First contact', focus: 'The auto director on the first real firefight.' },
  { id: 'follow', at: 20, label: 'Follow the front', focus: 'FOLLOW RED on the man at the front of the red army: the soldier model at chest range.' },
  { id: 'field', at: 24, label: 'The field', focus: 'A wide, low look across the battle along its axis: ground, sky, fog and both armies.' },
  { id: 'result', cap: 240, label: 'The result', focus: 'The war run to its end: the result card, and the sim-seconds it took (warSeconds).' },
];

const readyExpression = "document.querySelectorAll('#maps button').length > 3 && /READY/.test((document.getElementById('bootst')||{}).textContent||'')";

async function stage(input) {
  const sub = input.subject;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (sub.id === 'menu') return { ok: true, stage: { subject: 'menu', map: new URLSearchParams(location.search).get('map') } };
  const B = window.__battle, C = window.CBZ;
  if (!B || !C) return { ok: false, missing: '__battle' };
  let S = window.__npcwarLook;
  if (!S) {
    S = window.__npcwarLook = { at: 0 };
    document.getElementById('start').click();
    // audit() reads the camera, which does not exist until begin() boots the
    // world — so it THROWS while the ground is still loading. Poll it guarded.
    const up = () => { try { return !!B.audit().started; } catch (e) { return false; } };
    for (let i = 0; i < 900 && !up(); i++) await wait(100);
    if (!up()) return { ok: false, err: 'START never began the war' };
    B.freeze(); B.speed(1);
    window.__cbzVisualCompare = window.__cbzVisualCompare || {};
    window.__cbzVisualCompare.render = function () { B.render(); };
  }
  const step = (sec) => { B.advance(sec, 1 / 60); S.at += sec; };
  if (sub.at > S.at) step(sub.at - S.at);
  const cams = document.getElementById('cCam');
  if (sub.id === 'follow') {
    // the page's own camera ring: AUTO -> FOLLOW RED. One press, then let the
    // arm settle onto him for a second of sim.
    if (cams) cams.click();
    step(1.2);
  }
  if (sub.id === 'field') {
    // wide and low across the fight axis, from behind the red army
    const all = B.swimmers();
    const avg = (t) => { let x = 0, z = 0, n = 0; for (const m of all) if (m.team === t) { x += m.x; z += m.z; n++; } return n ? { x: x / n, z: z / n } : null; };
    const r = avg('red'), b = avg('blue');
    if (r && b) {
      const mx = (r.x + b.x) / 2, mz = (r.z + b.z) / 2;
      const yaw = Math.atan2(r.x - b.x, r.z - b.z) + 0.55;
      B.lookAt({ x: mx, y: C.groundAt ? C.groundAt(mx, mz) : 0, z: mz, h: 0, yaw }, 70, 0.2);
      step(1 / 60);
    }
  }
  if (sub.id === 'result') {
    // THE END OF THE WAR, and how long it took. Runs the sim on until the
    // result card is up (or a ceiling), so the pair shows the verdict screen
    // and the metric says whether the war has an arc or is over in a volley.
    const card = document.getElementById('end');
    while (!(card && card.style.display === 'grid') && S.at < (sub.cap || 240)) step(2);
    S.warT = S.at;
  }
  B.render();
  await wait(120);
  const a = B.audit();
  const metrics = sub.id === 'result' ? { warSeconds: +(S.warT || 0).toFixed(0),
    ended: document.getElementById('end').style.display === 'grid' ? 1 : 0 } : undefined;
  return { ok: true, metrics, stage: { subject: sub.id, simT: a.simT, red: a.red, blue: a.blue, corpses: a.corpses,
    morale: a.morale, routing: a.routing, fled: a.fled, cover: a.cover,
    cam: a.cam && { mode: a.cam.mode, shot: a.cam.shot, y: a.cam.y }, calls: a.calls, map: new URLSearchParams(location.search).get('map') } };
}

export default {
  id: 'npcwar-look',
  title: 'NPC War — the first minute, as a stranger sees it',
  description: 'games/battle.html untouched: the war room, START, and the page\'s own director camera at four beats of one war, HUD on.',
  page: 'games/battle.html',
  beforeLabel: 'BEFORE', afterLabel: 'AFTER',
  urlParams: { map: 'dunes' },
  readyExpression,
  stageTimeoutMs: 600000,
  metrics: { warSeconds: { label: 'war length (sim s)', better: 'higher' }, ended: { label: 'war reached a result', better: 'higher' } },
  metricsNote: 'Pictures first. warSeconds: how long the default war lasts before the result card, a proxy for whether it has an arc.',
  subjects, stage,
};
