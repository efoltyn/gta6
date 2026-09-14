/* Bomb Survivor — PRODUCT PHOTOGRAPHY, shot by the engine.

   Store covers for BOMB SURVIVOR (games/bomb-survivor.html): 6 v 6 on the
   real military island and the real downtown, three minutes each way,
   bombers one half and runners the other. No generated art: the page boots
   the way it ships (bomb-survivor-takeoff.mjs's own staging — READY, PLAY,
   the cast spawns, then the rAF clock is stopped and CBZ.stepSim is the only
   time), the aeroplanes on camera are the match's own B-2s flown by the
   match's own airframe, and the stick under the lead bomber left the bay
   through the same Space key a player presses. The formation is posed with
   af.launch — the verb spawnUnit itself uses — and nothing else is touched.
   The lens is fitted to the lead aeroplane for whatever ratio ba was asked
   for and the light is graded to golden hour through CBZ.sun / the sky dome.

   Portal rules this obeys (docs.crazygames.com/requirements/game-covers):
     16:9 1920x1080 · 2:3 800x1200 · 1:1 800x800 — no borders, no text but the
     title, no icons.

   Run (one ratio per run):
     ba bomb-product --before local --only after --width 1920 --height 1080 \
        --out ~/harness/out/gta6/portal/bomb --no-open --cdp-timeout 600000
     ba bomb-product ... --width 800 --height 800
     ba bomb-product ... --width 800 --height 1200

   HARNESS TRAP: stage() is SERIALIZED into the page by toString(); nothing
   from this module's scope is reachable inside it. `page:` below is what
   points ba at a non-index page (the web adapter resolves it against
   whichever build root each side was given). */

const subjects = [
  { id: 'cover-takeoff', kind: 'takeoff',
    label: 'Bombers leaving the island runway',
    focus: 'Three B-2s in a staggered departure off the military island\'s own strip: the lead just airborne and close, the second rotating behind it, the third still on its wheels. Low lens at the runway\'s edge looking back down the strip, the hangars and the strait behind. Golden hour.' },
  { id: 'cover-run', kind: 'run',
    label: 'The bombing run over downtown',
    focus: 'The player\'s B-2 from behind and above, a stick of iron bombs just released and falling toward the glass towers of Talloran, the previous stick already blooming between the blocks. The wingmen ride outboard. The city fills the frame below.' },
];

async function stage(input) {
  const C = window.CBZ, T = window.THREE;
  if (!C || !T) return { ok: false, missing: 'CBZ/THREE' };
  const sub = input.subject;
  const TITLE = 'BOMB SURVIVOR';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 200);
    }
    return false;
  };

  // ---- ONE BOOT. The page's own READY → PLAY → cast, then the clock is ours.
  const S = (window.__bombProduct = window.__bombProduct || {});
  if (!S.booted) {
    const ok = await until(() => { const st = document.getElementById('st'); return st && st.textContent === 'READY'; }, 540000, 500);
    if (!ok) return { ok: false, err: 'page never reached READY' };
    document.getElementById('go').click();
    await until(() => (C.ordnance.targets || []).some((t) => t.unit && t.unit.human), 60000, 100);
    await wait(400);
    if (C.micro && C.micro.stop) C.micro.stop();
    S.sim = 0;
    S.step = (seconds) => { const dt = 1 / 60; let n = Math.max(0, Math.round(seconds / dt)); while (n-- > 0) { C.stepSim(dt); S.sim += dt; } };
    S.units = () => (C.ordnance.targets || []).map((t) => t.unit).filter((u) => u && !u.civ);
    S.me = () => S.units().find((u) => u.human) || null;
    S.groundAt = (x, z) => (C.world && typeof C.world.groundAt === 'function') ? C.world.groundAt(x, z) : 0;
    S.render = () => { if (C.renderer && C.scene && C.camera) C.renderer.render(C.scene, C.camera); };
    window.__cbzVisualCompare = window.__cbzVisualCompare || {};
    window.__cbzVisualCompare.render = S.render;
    S.booted = true;
  }
  const me = S.me();
  if (!me || !me.af) return { ok: false, err: 'no human bomber (role ' + (me && me.role) + ')' };
  const friends = S.units().filter((u) => u !== me && u.role === 'bomber' && u.team === me.team && u.af);
  if (friends.length < 2) return { ok: false, err: 'need two wingmen, have ' + friends.length };
  // THE STICK IS ON THE WALL CLOCK. ordnance.stick spaces its seven stores
  // with setTimeout (130 ms apart), and a stage that steps the sim in one
  // synchronous burst never yields to those timers — round 1 pressed DROP,
  // stepped a second, and photographed zero bombs. So the drop yields to the
  // wall clock between stores and steps the sim the same 130 ms each time,
  // which is what the game does at 60 fps: the stores walk the ground track.
  const dropKey = async () => {
    me.cool = 0;
    const down = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true });
    window.dispatchEvent(down); document.dispatchEvent(down);
    S.step(1 / 60);
    const up = new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true });
    window.dispatchEvent(up); document.dispatchEvent(up);
    for (let i = 0; i < 7; i++) { await wait(150); S.step(0.13); }
  };

  // the island's strip (bomb-survivor.html's own numbers): z = -520, along +X
  // from the threshold at x = -820; forward for heading -PI/2 is (+1, 0)
  const RW_Z = -520, RW_X0 = -820, RW_HDG = -Math.PI / 2;
  const gear = (me.af.spec && me.af.spec.gearHeight) || 3.4;
  const onStrip = (u, x, speed) => {
    u.alive = true; u.hp = 100; u.respawnIn = 0;
    if (u.group) u.group.visible = true;
    u.af.launch(x, S.groundAt(x, RW_Z) + gear, RW_Z, RW_HDG, speed);
    u.af.throttle = 1; u.rolling = true; u.hdg = RW_HDG;
    u.pos.copy(u.af.pos); if (u.group) u.af.applyTo(u.group);
  };
  const inAir = (u, x, y, z, hdg, speed) => {
    u.alive = true; u.hp = 100; u.respawnIn = 0;
    if (u.group) u.group.visible = true;
    u.af.launch(x, y, z, hdg, speed);
    u.rolling = false; u.hdg = hdg; u.alt = y;
    u.pos.copy(u.af.pos); if (u.group) u.af.applyTo(u.group);
  };

  let lead, aim, eye, fov, bombsInAir = 0, shotNote = {};
  const cam = C.camera, aspect = innerWidth / innerHeight;
  const k = Math.max(0, Math.min(1, (aspect - 0.667) / (1.778 - 0.667)));   // 0 = portrait 2:3 … 1 = 16:9

  if (sub.kind === 'takeoff') {
    // a staggered departure: the lead at rotation speed near the far third,
    // the second a hundred and thirty metres back, the third at the threshold.
    onStrip(me, RW_X0 + 200, 88);
    onStrip(friends[0], RW_X0 + 120, 80);
    onStrip(friends[1], RW_X0 + 40, 70);
    S.step(1.9);
    lead = me;
    const p = me.af.pos;
    // the lens: on the strip's south edge, ahead-right of the lead, two
    // metres over the concrete, looking back west along the runway and up
    // at the wheels. Measured: 62 m off, the aeroplane was a third of the
    // frame's width and the strip a line; 30 m fills it.
    // (a tall frame stands nearer the centreline — at the landscape offset
    // the nose left the frame on the right at 2:3)
    const ahead = 22 + 8 * k, side = 14 - 3 * (1 - k), h = 2.4 + 2.0 * (1 - k);
    eye = new T.Vector3(p.x + ahead, S.groundAt(p.x + ahead, RW_Z + side) + h, RW_Z + side);
    aim = new T.Vector3(p.x - 8 - 14 * (1 - k), p.y - 1 + 3 * (1 - k), RW_Z - 3 + 4 * (1 - k));
    fov = 50 + 16 * (1 - k);
    shotNote = { leadAgl: +(p.y - gear - S.groundAt(p.x, p.z)).toFixed(1), leadSpeed: Math.round(me.af.speed), leadRolling: !!me.rolling,
      second: { agl: +(friends[0].af.pos.y - gear - S.groundAt(friends[0].af.pos.x, friends[0].af.pos.z)).toFixed(1), speed: Math.round(friends[0].af.speed) },
      third: { agl: +(friends[1].af.pos.y - gear - S.groundAt(friends[1].af.pos.x, friends[1].af.pos.z)).toFixed(1), speed: Math.round(friends[1].af.speed) } };
  } else {
    // THE RUN. Downtown is at (0, -700); the run crosses it west → east at 250 m.
    const TOWN = { x: 0, z: -700 }, ALT = 200, HDG = -Math.PI / 2;      // forward (+1, 0)
    const RUN_Z = TOWN.z - 10;
    // WHERE A STORE LANDS is the shared integrator's answer, not a guess: a
    // bomb leaves at the aeroplane's 207 m/s and carries most of a mile
    // before drag and gravity put it down. Ask ord.predict from a probe pass
    // and release stick one exactly that far west of the town centre, so the
    // first stick is blooming among the towers when the second is released.
    inAir(me, -2600, ALT, RUN_Z, HDG, 207); S.step(0.25);
    const probe = C.ordnance.predict(me.af.pos, me.af.vel, 'iron', 40);
    const carry = probe.x - me.af.pos.x, fall = probe.t;
    inAir(me, (TOWN.x - 30) - carry, ALT, RUN_Z, HDG, 207); S.step(0.1);
    await dropKey();
    // THE CLOCK IS THE STORES' OWN. Two rounds timed off the probe's `fall`
    // photographed craters and no fire: the stores strike roofs before the
    // ground and the pooled fireball is 1.3 s long. ord.activeThreats() is
    // the integrator's live time-to-impact for every store in the air — the
    // same number the runners' danger HUD reads — so the sim is stepped until
    // the FIRST store of the stick is SHOT_BEFORE from the ground, less the
    // second stick's own release time, and the shot lands with the first
    // bursts at peak and the tail of the stick still coming down.
    const SHOT_BEFORE = -0.25, STICK2 = 7 * 0.13 + 0.45;
    let ttl = null;
    for (let guard = 0; guard < 900; guard++) {
      const th = C.ordnance.activeThreats ? C.ordnance.activeThreats() : [];
      let mn = Infinity; for (const t of th) if (t.t < mn) mn = t.t;
      if (!isFinite(mn)) break;
      ttl = mn;
      if (mn <= STICK2 - SHOT_BEFORE) break;
      S.step(1 / 60);
    }
    // the aeroplane is past the city by now: the formation goes back to the
    // west edge so the shot looks east across every block, and stick two —
    // the one under the aeroplane in the frame — is released from there
    const xs = TOWN.x - 170;                       // where the lead is at the shot
    const xr = xs - 207 * STICK2;
    inAir(me, xr, ALT, RUN_Z, HDG, 207);
    // both wingmen on the far side of the lens (round 4 put one 40 m off
    // the lens's own flank and its wing filled the right of the frame)
    inAir(friends[0], xr - 40, ALT + 10, RUN_Z - 105, HDG, 207);
    inAir(friends[1], xr - 85, ALT + 22, RUN_Z - 190, HDG, 207);
    await dropKey();
    S.step(0.45);
    bombsInAir = C.ordnance.liveCount ? C.ordnance.liveCount() : 0;
    lead = me;
    const p = me.af.pos;
    // behind, above and to the right of the lead, looking down its track at
    // the city: portrait pulls further back and higher so the towers fill
    // the lower two thirds under the aeroplane
    // Measured at back 58 / up 24 / aim 150 ahead and 150 down: a top-down
    // map of white roofs with the seven stores hidden behind the lens (a
    // store drifts back 27 m per release, so the stick is a 190 m string
    // BEHIND the aeroplane). Further back and higher puts the string in the
    // frame under the aeroplane, and a shallower aim shows the towers' faces
    // and the strait beyond instead of their roofs.
    // Round 3 (back 118, up 40, aim 135 down) was still a map of roofs; the
    // lens now rides nearly level with the aeroplane and looks 20 degrees
    // down, so the towers show their faces under it and the strait and the
    // sky sit behind — the aeroplane big against the horizon, not a mark on
    // a plan. Portrait tips further down so the blocks fill the lower half.
    // Round 4 at back 96: the aeroplane was a mark on the horizon and the
    // stick a row of dots. Closer, a shade lower, and the nearest stores sit
    // right under the tail in the frame.
    // (the flank offset is a landscape luxury — at 2:3 it cut the aeroplane
    // off at the left edge, so a tall frame sits nearly astern)
    const back = 54 + 8 * k, side = 24 - 16 * (1 - k), up = 9 + 22 * (1 - k);
    eye = new T.Vector3(p.x - back, p.y + up, p.z + side);
    aim = new T.Vector3(p.x + 260 + 40 * k, p.y - 88 - 70 * (1 - k), p.z - 8 + 6 * (1 - k));
    fov = 54 + 14 * (1 - k);
    shotNote = { alt: Math.round(p.y), speed: Math.round(me.af.speed), pos: [Math.round(p.x), Math.round(p.z)],
      carry: Math.round(carry), probeFall: +fall.toFixed(1), ttlAtStick2: ttl == null ? null : +ttl.toFixed(2), ordnance: C.ordnanceAudit ? C.ordnanceAudit() : null };
  }

  // ---- golden hour: the page's own sun and sky dome, graded ------------------
  const sun = C.sun || (C.micro && C.micro.sun);
  if (sun) {
    sun.color.setHex(0xffc98a);
    // low and BEHIND THE LENS, whichever way it looks (the takeoff looks
    // west down the strip, the run looks east over the city), so the
    // aeroplanes are front-lit and the concrete and glass go warm
    const behind = sub.kind === 'takeoff' ? 900 : -900;
    sun.position.set(eye.x + behind, eye.y + 260, eye.z + 120);
    if (sun.target) sun.target.position.set(eye.x, 0, eye.z);
    sun.intensity = 1.35;
    if (sun.shadow && sun.shadow.camera && sun.shadow.camera.updateProjectionMatrix) sun.shadow.camera.updateProjectionMatrix();
  }
  const hemi = C.hemi || (C.micro && C.micro.hemiLight);
  if (hemi) { hemi.color.setHex(0xa9c3e6); hemi.groundColor.setHex(0x9a7a52); hemi.intensity = 0.5; }
  const dome = C.micro && C.micro.skyDome;
  if (dome && dome.material && dome.material.uniforms) {
    dome.material.uniforms.topColor.value.setHex(0x3f7fc4);
    dome.material.uniforms.bottomColor.value.setHex(0xf6cf9a);
    const haze = new T.Color(0xf6cf9a).lerp(new T.Color(0x3f7fc4), 0.18);
    if (C.scene.fog) C.scene.fog.color.copy(haze);
    if (C.scene.background && C.scene.background.copy) C.scene.background.copy(haze);
  }

  // ---- clean frame: the game canvas and nothing else ---------------------------
  const canvas = C.renderer && C.renderer.domElement;
  for (const el of Array.from(document.body.children)) {
    if (el === canvas || (canvas && el.contains && el.contains(canvas))) continue;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    el.style.setProperty('display', 'none', 'important');
  }

  // ---- the lens ---------------------------------------------------------------
  eye.y = Math.max(eye.y, S.groundAt(eye.x, eye.z) + 1.2);
  cam.fov = fov; cam.aspect = aspect; cam.updateProjectionMatrix();
  cam.position.copy(eye); cam.up.set(0, 1, 0); cam.lookAt(aim); cam.updateMatrixWorld(true);

  // ---- the title ---------------------------------------------------------------
  let title = document.getElementById('bombProductTitle');
  if (!title) { title = document.createElement('div'); title.id = 'bombProductTitle'; document.body.appendChild(title); }
  const px = Math.round(Math.min(innerWidth * 0.105, innerHeight * 0.15));
  title.style.cssText = 'position:fixed;z-index:2147483647;top:' + (aspect < 1 ? 6 : 5) + '%;left:3%;right:3%;text-align:center;color:#fff;font-family:Fredoka,\'Arial Black\',Impact,Arial,sans-serif;font-weight:900;font-size:' + px + 'px;line-height:.9;letter-spacing:-.03em;text-shadow:0 5px 0 #3a1c08,0 10px 28px rgba(20,8,2,.9);pointer-events:none;display:block';
  title.textContent = TITLE;

  S.render();
  const box = new T.Box3().setFromObject(lead.group);
  return {
    ok: true, subject: sub.id, simSeconds: +S.sim.toFixed(2), role: me.role,
    lead: { pos: lead.af.pos.toArray().map((v) => Math.round(v)), heading: +lead.af.heading().toFixed(2), span: +(box.max.x - box.min.x).toFixed(1) },
    bombsInAir, shotNote,
    camera: { eye: eye.toArray().map((v) => Math.round(v)), aim: aim.toArray().map((v) => Math.round(v)), fov, aspect: +aspect.toFixed(3) },
    width: innerWidth, height: innerHeight,
  };
}

export default {
  id: 'bomb-product',
  page: 'games/bomb-survivor.html',
  title: 'Bomb Survivor — in-engine product photography',
  description: 'Store covers for BOMB SURVIVOR, staged in the shipped page: READY → PLAY → the match\'s own cast, the rAF clock stopped and CBZ.stepSim the only time; the B-2s on camera are the match\'s own aircraft posed with the airframe\'s own launch verb, the stick under the lead left through the Space key, the light is graded to golden hour and the lens is fitted for whatever ratio the run asks for.',
  defaultBefore: 'local',
  beforeLabel: 'SOURCE GAME', afterLabel: 'PRODUCT CAPTURE',
  viewport: { width: 1920, height: 1080 },
  // ?airport=0 drops Halloran Field: a third island the covers never see and a
  // large share of a boot that already runs under software WebGL
  urlParams: { airport: 0, seed: 'talloran' },
  readyExpression: "!!document.getElementById('go')",
  stageTimeoutMs: 900000,
  pairNote: 'Every pixel is the page rendering its own match · title is the only overlay',
  metrics: {}, metricsNote: 'Product captures, not a gameplay score.',
  subjects, stage,
};
