/* DESERT WARLORD — THE FIRST SIXTY SECONDS, through the game's OWN camera.

   The product covers (warlord-product.mjs) place a lens by hand and paint a
   low sun over the page, so they cannot tell you what a stranger actually
   sees. This preset touches NOTHING about the picture: no hand lens, no sun
   override, no chrome hidden. It only moves the clock and the warlord, then
   lets campaign.js / battle.js place their own cameras and lights.

     ride-0      two seconds after RIDE OUT, the default ride camera, noon-ish
                 hour the new game starts on.
     ride-20     twenty seconds of riding at the nearest outpost.
     outpost     standing 70 m off the nearest outpost, facing it.
     valley      the wheel pulled all the way out: the strategic view.
     dusk        the same ride camera at hour 18.5 — the light the game spends
                 a quarter of its day in.
     battle      a real battle.js fight against a 30-man band, 12 s in, the
                 battle's own camera.

   The page's rAF is stopped (C.micro.stop) so every frame is a stepSim this
   preset asked for; the frame hooks inside stepSim are the ones that place
   the game's camera and sun, so the picture is still the game's picture. */

const subjects = [
  { id: 'ride-0', label: 'Two seconds after RIDE OUT', focus: 'The very first frame a player judges the game by.' },
  { id: 'ride-20', label: 'Riding at the nearest outpost', focus: 'The column, the sand, the sky, the horizon.' },
  { id: 'outpost', label: 'Arriving at an outpost', focus: 'Does the place read as a real compound on real ground?' },
  { id: 'valley', label: 'Strategic zoom', focus: 'The campaign map range: dunes, mesas, territory.' },
  { id: 'dusk', label: 'Golden hour, same camera', focus: 'Light, sky and shadow at hour 18.5.' },
  { id: 'battle', label: 'A battle, 12 s in', focus: 'The fight on the battle camera.' },
];

const stageSource = `async function stage(input) {
  const sub = input.subject;
  const C = window.CBZ;
  if (!C || !C.warlord || !C.warlord.desert) return { ok: false, missing: 'warlord' };
  const W = C.warlord, D = W.desert, CP = W.campaign;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let X = window.__wlFirst60;
  if (!X) {
    X = window.__wlFirst60 = { step(n) { for (let i = 0; i < n; i++) C.stepSim(1 / 30); }, battle: null };
    for (let t = 0; t < 2500 && W.phase() !== 'campaign'; t++) await sleep(120);
    if (C.micro && C.micro.stop) C.micro.stop();
    window.__cbzVisualCompare = { render() { const R = C.renderer; if (R && C.camera) R.render(C.scene, C.camera); }, metrics() { return {}; } };
  }
  const R = () => { const r = C.renderer; if (r && C.camera) r.render(C.scene, C.camera); };
  const S = W.state;
  const calm = () => { for (const b of S.bands) b.cooldown = 1e9; };
  const nearest = () => {
    let best = null, bd = 1e12;
    for (const o of S.outposts || []) { const d = Math.hypot(o.x - S.you.x, o.z - S.you.z); if (d < bd) { bd = d; best = o; } }
    return best;
  };
  let extra = {};
  if (sub.id === 'ride-0') { calm(); X.step(60); extra.hour = S.hour; }
  if (sub.id === 'ride-20') {
    const o = nearest();
    if (o) CP.dest(o.x, o.z);
    for (let i = 0; i < 20; i++) { calm(); X.step(30); }
    extra.hour = S.hour;
  }
  if (sub.id === 'outpost') {
    const o = nearest();
    if (!o) return { ok: false, err: 'no outpost' };
    const a = Math.atan2(S.you.x - o.x, S.you.z - o.z);
    S.you.x = o.x + Math.sin(a) * 70; S.you.z = o.z + Math.cos(a) * 70;
    const yaw = Math.atan2(o.x - S.you.x, o.z - S.you.z);
    S.you.yaw = yaw; CP.camYaw(yaw);
    for (let i = 0; i < 4; i++) { calm(); X.step(30); }
    extra.outpost = o.kind;
  }
  if (sub.id === 'valley') { CP.camDist(520); for (let i = 0; i < 3; i++) { calm(); X.step(30); } }
  if (sub.id === 'dusk') { CP.camDist(40); S.hour = 18.5; for (let i = 0; i < 3; i++) { calm(); X.step(30); } extra.hour = S.hour; }
  if (sub.id === 'battle') {
    CP.camDist(40);
    const band = W.makeBand({ size: 30, faction: 'legion', name: 'THE RIDERS' });
    band.x = S.you.x + 60; band.z = S.you.z; band.hostile = 1;
    W.battle.start({ band: band });
    let B = null;
    for (let t = 0; t < 1500; t++) { B = window.__warlordBattle; if (B && B.live && B.live()) break; await sleep(100); }
    if (!(B && B.live && B.live())) return { ok: false, err: 'battle never went live' };
    for (let i = 0; i < 12; i++) X.step(30);
  }
  R(); await sleep(150); R();
  return { ok: true, stage: Object.assign({ subject: sub.id, phase: W.phase(), w: innerWidth, h: innerHeight }, extra) };
}`;
const stage = new Function('return ' + stageSource)();

export default {
  id: 'warlord-first60',
  title: 'Desert Warlord: the first sixty seconds, game camera',
  description: 'What a stranger sees: ride out, ride, outpost, strategic zoom, golden hour, a battle. No hand lens, no sun override.',
  page: 'games/warlord.html',
  defaultBefore: 'local',
  urlParams: { go: 1, seed: 1337, weather: 'off', sound: 'off', events: 'off' },
  readyExpression: '!!(window.CBZ && window.CBZ.warlord && window.__warlordReady)',
  stageTimeoutMs: 900000,
  metrics: {}, metricsNote: 'Visual only.',
  subjects, stage,
};
