/* Bomb Survivor AS PLAYED — the game's own camera, the game's own HUD.

   bomb-product.mjs poses a store cover; this preset photographs what a
   player actually sees, so a gameplay/scene wave can be judged on the thing
   it changed. One page per side, subjects in order (a storyboard):

     1. bomb-run    PLAY, hands off through the takeoff, DROP pressed over
                    the city: the bomber half's first half-minute.
     2. runner      the half is ended through the match's own endHalf(), the
                    intermission runs out, and the camera is the runner's.
     3. under-fire  ten more seconds of the runner half: the enemy bombers'
                    sticks coming down around him.

   TIME: stepped by CBZ.stepSim with the rAF clock stopped, BUT in 0.1 s
   chunks that yield ~110 ms of wall clock each, because ordnance.stick
   spaces a stick's stores with setTimeout — a synchronous burst would
   photograph a bomber that pressed DROP and released nothing.

   Works against both the old page and the rewrite: it reaches the game only
   through #go, CBZ.teammatch.live[0], CBZ.ordnance.targets and key events.

   Run:
     ba bomb-play --before http://127.0.0.1:8687/ --no-open --cdp-timeout 600000

   HARNESS TRAP: stage() is serialized by toString(); nothing from module
   scope is reachable inside it. */

const subjects = [
  { id: 'overview', label: 'The city at kickoff, from a news helicopter',
    focus: 'Frame one of the match, lens parked 520 m south-east of downtown at 260 m, looking at the town, the strait and the military island. Is this a real harbour city?' },
  { id: 'bomb-run', label: 'The bomber half, 30 s in',
    focus: 'The player\'s own chase camera over the city after a hands-off takeoff and one DROP. What does the city, the sea and the threat read like from the cockpit seat?' },
  { id: 'runner', label: 'The runner half begins',
    focus: 'Sides swapped. The player is on foot in the city with the enemy bombers inbound. What is there to DO?' },
  { id: 'on-the-gun', label: 'Crewing a flak gun',
    focus: 'The runner half\'s verb: the player on a gun, holding FIRE on an inbound bomber. (The old game has no gun; its frame is the same seconds of the runner half.)' },
  { id: 'under-fire', label: 'Under fire',
    focus: 'Ten seconds later. Is the danger readable, is there anywhere to go, is there anything to fight back with?' },
];

async function stage(input) {
  const C = window.CBZ, T = window.THREE;
  if (!C || !T) return { ok: false, missing: 'CBZ/THREE' };
  const sub = input.subject;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 200);
    }
    return false;
  };
  const S = (window.__bombPlay = window.__bombPlay || {});
  if (!S.booted) {
    const ok = await until(() => { const st = document.getElementById('st'); return st && st.textContent === 'READY'; }, 540000, 500);
    if (!ok) return { ok: false, err: 'page never reached READY' };
    document.getElementById('go').click();
    await wait(600);
    if (C.micro && C.micro.stop) C.micro.stop();
    S.sim = 0;
    S.render = () => { if (C.renderer && C.scene && C.camera) C.renderer.render(C.scene, C.camera); };
    window.__cbzVisualCompare = window.__cbzVisualCompare || {};
    window.__cbzVisualCompare.render = S.render;
    S.run = async (seconds) => {
      let left = seconds;
      while (left > 1e-6) {
        const chunk = Math.min(0.1, left);
        let n = Math.max(1, Math.round(chunk * 60));
        while (n-- > 0) C.stepSim(1 / 60);
        S.sim += chunk; left -= chunk;
        await wait(110);
      }
    };
    S.key = (code, down) => {
      const e = new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'Space' ? ' ' : code, bubbles: true });
      window.dispatchEvent(e); document.dispatchEvent(e);
    };
    S.tap = async (code) => { S.key(code, true); C.stepSim(1 / 60); S.key(code, false); C.stepSim(1 / 60); };
    S.booted = true;
  }
  const match = C.teammatch && C.teammatch.live && C.teammatch.live[C.teammatch.live.length - 1];
  const units = () => (C.ordnance.targets || []).map((t) => t.unit).filter((u) => u && !u.civ);
  let note = {};

  if (sub.id === 'overview') {
    await S.run(0.2);
    const sw = document.getElementById('swap'); if (sw) sw.style.display = 'none';
    const cam = C.camera;
    cam.position.set(420, 240, -300);
    cam.lookAt(-120, 0, -760);
    cam.updateMatrixWorld(true);
    S.render();
    return { ok: true, subject: sub.id, simSeconds: +S.sim.toFixed(2), audit: window.__bomb && window.__bomb.audit ? window.__bomb.audit() : null };
  } else if (sub.id === 'bomb-run') {
    { const sw = document.getElementById('swap'); if (sw) sw.style.display = ''; }
    // hands off through the roll, then the player points the nose at the
    // city (u.hdg is the one field both the old page and the new one steer by)
    await S.run(11);
    const pilot = units().find((u) => u.human);
    if (pilot && pilot.af) pilot.hdg = Math.atan2(pilot.af.pos.x - 0, pilot.af.pos.z - (-700));
    await S.run(15);
    await S.tap('Space');
    await S.run(3);
    await S.tap('Space');
    await S.run(3);
  } else if (sub.id === 'runner') {
    if (match && match.phase === 'live' && match.half === 0) match.endHalf();
    await S.run(2);
    if (match && match.phase === 'intermission') match.intermissionLeft = 0.05;
    await S.run(0.5);
    // walk the runner a little so the camera settles behind him
    S.key('KeyW', true); await S.run(5); S.key('KeyW', false);
    await S.run(3);
  } else if (sub.id === 'on-the-gun') {
    const B = window.__bomb;
    if (B && B.guns && B.me) {
      const me = B.me(), gs = B.guns().filter((g) => g.down <= 0);
      if (me && me.alive && gs.length) {
        let g = gs.find((x) => !x.crew) || gs[0];
        if (g.crew && g.crew !== me) { g.crew.gun = null; g.crew = null; }
        me.pos.set(g.x, 0.03, g.z + 3.5);
        await S.run(0.2);
        S.key('KeyE', true); await S.run(0.1); S.key('KeyE', false);
      }
    }
    S.key('Space', true); await S.run(6); S.key('Space', false);
    await S.run(0.3);
  } else {
    S.key('KeyE', true); await S.run(0.1); S.key('KeyE', false);
    S.key('KeyW', true); await S.run(4); S.key('KeyW', false);
    await S.run(6);
  }
  const me = units().find((u) => u.human) || null;
  note = {
    half: match ? match.half : null, phase: match ? match.phase : null,
    role: me ? me.role : null, alive: me ? !!me.alive : null,
    mePos: me ? [Math.round(me.pos.x), Math.round(me.pos.z)] : null, onGun: !!(me && me.gun),
    stores: C.ordnanceAudit ? C.ordnanceAudit() : null,
    audit: window.__bomb && window.__bomb.audit ? window.__bomb.audit() : null,
  };
  S.render();
  return { ok: true, subject: sub.id, simSeconds: +S.sim.toFixed(2), note, width: innerWidth, height: innerHeight };
}

export default {
  id: 'bomb-play',
  page: 'games/bomb-survivor.html',
  title: 'Bomb Survivor, as played',
  description: 'The game\'s own chase camera and HUD through the bomber half, the swap and the runner half, stepped deterministically.',
  defaultBefore: 'local',
  beforeLabel: 'BEFORE', afterLabel: 'AFTER',
  viewport: { width: 1280, height: 800 },
  urlParams: { airport: 0, seed: 'talloran' },
  readyExpression: "!!document.getElementById('go')",
  stageTimeoutMs: 900000,
  pairNote: 'Game camera, game HUD, same simulated seconds on both sides',
  metrics: {}, metricsNote: 'Gameplay storyboard.',
  subjects, stage,
};
