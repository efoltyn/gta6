/* DESERT WARLORD — THE WAR MAP (HOI4 meets OpenFront, on real places).

   The owner, 2026-09-27: "like HOI4 meets OpenFront... Not have production.
   Just have cities. You go up to a city with your army... they surrender,
   you get the city." And maps of real places.

   AFTER is games/warlord.html?war=mediterranean&faction=rome: the war layer
   (src/warlord/war/*). BEFORE is the same URL on a checkout that has no war
   layer, which ignores ?war and shows what the game used to open on (the
   title card, then the ride). So each pair is "what a stranger sees".

   Subjects, one page, in order (the sim clock only moves forward):
     rome-day0     Rome on 1 March 218 BC, the default camera on the capital
     wide          the whole Mediterranean, owners painted
     day150        150 days of the war later (the AI plays every side but
                   Rome, Rome's armies hold): borders moved, towns changed hands
     close         tilted down on Italy: relief, towns, armies with banners
     island        the desert island as map #1, same engine
     menu          the war menu: map and side selection

   The page's own rAF is stopped (micro.stop) and every frame is a
   CBZ.stepSim this preset asks for, so the camera easing settles
   deterministically. */

const subjects = [
  { id: 'rome-day0', label: 'Rome, 1 March 218 BC', focus: 'Relief, sea, rivers, painted realms, towns, armies, HUD.' },
  { id: 'close', label: 'Close and tilted over Italy', focus: 'Mountains stand up, towns are little cities, armies are men under banners.' },
  { id: 'wide', label: 'The whole Mediterranean', focus: 'Who holds what, at a glance.' },
  { id: 'day150', label: '150 days of war later', focus: 'Borders and towns moved because armies took towns.' },
  { id: 'island', label: 'The desert island, same engine', focus: 'Map #1 in the same data format.' },
  { id: 'menu', label: 'The war menu', focus: 'Pick a map, pick a side.' },
];

const stageSource = `async function stage(input) {
  const sub = input.subject;
  const C = window.CBZ;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const R = () => { const r = C && C.renderer; if (r && C.camera) r.render(C.scene, C.camera); };
  const W = C && C.warlord;
  if (!W || !W.war || !W.war.ui) {
    // the old game: photograph whatever it opens on
    await sleep(1500);
    return { ok: true, stage: { subject: sub.id, side: 'no war layer', phase: W && W.phase ? W.phase() : null } };
  }
  for (let t = 0; t < 600 && !window.__warReady; t++) await sleep(100);
  if (!window.__warReady) return { ok: false, err: 'war map never drew' };
  let X = window.__wlWar;
  if (!X) {
    X = window.__wlWar = { step(n) { for (let i = 0; i < n; i++) C.stepSim(1 / 30); } };
    if (C.micro && C.micro.stop) C.micro.stop();
    window.__cbzVisualCompare = { render: R, metrics() { return {}; } };
  }
  const WAR = W.war;
  let w = window.__war, V = w.view;
  let extra = {};
  if (sub.id === 'rome-day0') { X.step(45); }
  if (sub.id === 'wide') {
    const c = V.cameraState();
    V.setCamera({ dist: c.dmax * 0.9, gdist: c.dmax * 0.9, tx: 0, tz: 0, gtx: 0, gtz: 0 });
    X.step(60);
    extra.cam = V.cameraState();
  }
  if (sub.id === 'day150') {
    const G = w.G;
    // run the war through the UI clock (fastest speed), so the HUD, feed and
    // paint are driven exactly as in play
    WAR.ui.setSpeed(4); WAR.ui.pause(false);
    for (let k = 0; k < 900 && G.day < 150; k++) X.step(1);
    WAR.ui.pause(true);
    X.step(40);
    const st = WAR.sim.stats(G, w.player);
    extra.day = G.day; extra.rome = st;
  }
  if (sub.id === 'close') {
    const M = w.M, cap = M.towns[M.factions[w.player - 1].capital];
    V.focus(cap.tile);
    const c = V.cameraState();
    V.setCamera({ dist: c.dmin * 6, gdist: c.dmin * 6, pitch: 0.62, gpitch: 0.62, yaw: 0.35, gyaw: 0.35 });
    X.step(70);
    extra.cam = V.cameraState();
  }
  if (sub.id === 'island') {
    WAR.ui.stop();
    WAR.ui.start({ map: 'island', faction: 'warlord' });
    for (let t = 0; t < 100 && !(window.__war && window.__war.M && window.__war.M.id === 'island' && V.firstFrameDone && V.firstFrameDone()); t++) { X.step(1); await sleep(50); }
    X.step(60);
    w = window.__war;
    extra.map = w.M.id;
  }
  if (sub.id === 'menu') {
    WAR.ui.stop();
    WAR.ui.menu();
    X.step(10);
    await sleep(800);
  }
  R(); await sleep(250); R();
  return { ok: true, stage: Object.assign({ subject: sub.id, phase: W.phase(), w: innerWidth, h: innerHeight }, extra) };
}`;
const stage = new Function('return ' + stageSource)();

export default {
  id: 'warlord-war',
  title: 'Desert Warlord: the war map',
  description: 'HOI4 meets OpenFront on real maps: the Mediterranean in 218 BC and the desert island, cities as the atom.',
  page: 'games/warlord.html',
  defaultBefore: 'local',
  beforeLabel: 'BEFORE: WHAT THE GAME OPENED ON', afterLabel: 'AFTER: THE WAR MAP',
  urlParams: { war: 'mediterranean', faction: 'rome', warpause: 1, seed: 7, sound: 'off' },
  readyExpression: '!!(window.CBZ && window.CBZ.warlord && window.__warlordReady)',
  stageTimeoutMs: 900000,
  metrics: {}, metricsNote: 'Visual only.',
  subjects, stage,
};
