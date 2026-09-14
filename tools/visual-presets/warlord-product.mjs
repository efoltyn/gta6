/* DESERT WARLORD — PRODUCT PHOTOGRAPHY, shot by the engine.

   Store covers for games/warlord.html: the same men as NPC War, dunes,
   columns, sieges. No generated art and no posed dolls: the campaign boots its
   own island (seed 1337, weather and road events held off), a 150-man column
   is RIDDEN across the erg so the trail under it is one he actually made, and
   the siege is a real battle.js fight started at an arms depot with the
   compound parked exactly where the defenders deploy.

   Portal rules (docs.crazygames.com/requirements/game-covers): 16:9 1920x1080 ·
   2:3 800x1200 · 1:1 800x800 — no borders, no text but the title, no icons.

   TWO SHOTS, ONE PAGE, IN ORDER. The column first, because it is a campaign
   shot and the battle takes the page over for good; then the siege.

     cover-dunes  the warlord at the head of his column, hour 18.2, the lens
                  a few metres AHEAD of him at knee height looking back along
                  the column into the low sun. (The campaign's own camera
                  rides behind him, which puts the column behind the lens.)
     cover-siege  a depot under attack. battle.js deploys `them` at
                  +x (gap/2 + 8 = 88 m from the centre) and `mine` at -x, and
                  the centre is wherever the warlord stands — so standing him
                  92 m west of the depot puts the garrison IN the compound.
                  Enemy pinned on HOLD, mine on CHARGE, twenty seconds in,
                  shot from behind the charging line at chest height.

   MEASURED ON THE FIRST RUN:
     · campaign.js's showAll(false) hides the whole campaign root the moment
       a battle starts — island, outposts and all — and battle.js raises its
       own 430 m ground patch over the same heightAt. The depot was there and
       invisible. The compound group (props.js's shell: userData.near/far)
       is lifted out of the hidden root onto the scene for the fight, where
       it stands on the battle's patch to within the 10-17 cm the two height
       reads disagree by.
     · the column lens stood on a crest 7 m above him and looked down at
       sand. It is now seated on the ground under its own feet.

   Run:
     ba warlord-product --before local --only after --width 1920 --height 1080 \
        --out ~/harness/out/gta6/portal/warlord --no-open --cdp-timeout 600000
     ... and 800x800, 800x1200.

   HARNESS TRAP: `?trail=off` (which warlord-outpost.mjs uses to keep the
   breadcrumb ribbon out of ITS frames) sets DRAWN_FOLLOWERS to zero — it
   removes the column, not the line under it. Never on a column shot.
   HARNESS TRAP: stage() is SERIALIZED into the page; the cover kit rides in
   by toString() and nothing from this module's scope is reachable inside. */
import { coverKit } from './lib/cover-kit.mjs';

const TITLE = 'DESERT WARLORD';
const FONT = 'Alfa Slab One';

// seed 1337's erg, read off warlord-island.mjs — a place you can see a long way
const ERG = { x: -1146, z: 3024 };

const subjects = [
  { id: 'cover-dunes', hour: 18.2, army: 150, label: 'The column crossing the erg at golden hour',
    focus: 'The warlord at the head of 150 men riding ranks of dunes into a low sun, shot from a few metres ahead of him at knee height so the column runs away behind him into the haze.' },
  { id: 'cover-siege', hour: 17.3, mine: 48, them: 40, at: 26, label: 'The depot under attack',
    focus: 'A real battle.js fight at an arms depot: the garrison holding the sandbag run and the container yard, the warlord\'s line charging it, photographed from behind the charge.' },
];

const readyExpression = '!!(window.CBZ && window.CBZ.warlord)';

const stageSource = `async function stage(input) {
  const K = (${coverKit.toString()})();
  const sub = input.subject;
  const C = window.CBZ, T = window.THREE;
  if (!C || !T || !C.warlord || !C.warlord.desert) return { ok: false, missing: 'warlord' };
  const W = C.warlord, D = W.desert, CP = W.campaign;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const aspect = innerWidth / innerHeight;

  let X = window.__warlordCover;
  if (!X) {
    X = window.__warlordCover = {
      step(n) { for (let i = 0; i < n; i++) C.stepSim(1 / 30); },
      calm() { for (let i = 0; i < W.state.bands.length; i++) W.state.bands[i].cooldown = 1e9; },
      font: false, battle: null, t: 0,
    };
    X.font = await K.font(${JSON.stringify(FONT)}, 400);
    window.__cbzVisualCompare = { render() { K.render(C); }, metrics() { return {}; } };
    /* STOP THE PAGE'S OWN CLOCK. The campaign keeps its rAF running and
       re-places its ride camera every frame, so a lens set by hand was
       overwritten between render() and the screenshot: two runs with the lens
       60 m apart produced the same picture. From here every simulated frame
       is a CBZ.stepSim this preset asked for, and the canvas holds the last
       frame it drew (battle.js's freeze() is the same call). */
    if (C.micro && C.micro.stop) C.micro.stop();
  }
  for (let t = 0; t < 2500 && W.phase() !== 'campaign' && W.phase() !== 'battle'; t++) await sleep(120);
  if (W.phase() !== 'campaign' && W.phase() !== 'battle') return { ok: false, missing: 'campaign phase (' + W.phase() + ')' };
  X.calm();
  const S = W.state;
  const enlist = (n) => {
    for (let i = S.army.length; i < n; i++) {
      W.addSoldier(W.makeSoldier(i % 4 === 0 ? 'veteran' : i % 3 === 0 ? 'soldier' : i % 2 ? 'raider' : 'levy', i % 5 === 0 ? 'ak47' : 'carbine'));
    }
  };
  let lens = null, extra = {};

  if (sub.id === 'cover-dunes') {
    if (W.phase() !== 'campaign') return { ok: false, err: 'the column shot needs the campaign, phase is ' + W.phase() };
    enlist(sub.army || 150);
    S.hour = sub.hour;
    // ride toward +x: forward = (sin yaw, cos yaw)
    const yaw = Math.PI / 2;
    S.you.x = ${ERG.x}; S.you.z = ${ERG.z}; S.you.yaw = yaw;
    CP.camYaw(yaw); CP.camDist(40);
    X.step(30);
    // LAY A REAL TRAIL: the followers walk the breadcrumbs of where he has been
    CP.dest(S.you.x + Math.sin(yaw) * 900, S.you.z + Math.cos(yaw) * 900);
    for (let i = 0; i < 13; i++) { X.calm(); X.step(30); }
    CP.camYaw(yaw); CP.camDist(40);
    X.step(4);
    // THE LENS AT THE TAIL OF THE COLUMN, a few metres up, looking forward
    // along the ride past the men to the warlord at the head and the dunes
    // beyond him. Measured: a lens ahead of him on the crest looked back DOWN
    // the slope and photographed sand; from the tail the horizon is in shot.
    const fx = Math.sin(yaw), fz = Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw);
    const back = aspect < 1 ? 46 : 58, side = aspect < 1 ? 7 : 12;
    const px = S.you.x - fx * back + sx * side, pz = S.you.z - fz * back + sz * side;
    const py = D.heightAt(px, pz) + (aspect < 1 ? 5.5 : 4.5);
    const ax = S.you.x - fx * (aspect < 1 ? 14 : 18), az = S.you.z - fz * (aspect < 1 ? 14 : 18);
    lens = K.lens(C, T, { x: px, y: py, z: pz }, { x: ax, y: D.heightAt(ax, az) + (aspect < 1 ? 2.6 : 2.0), z: az }, aspect < 1 ? 60 : 52);
    // the low sun ahead of the column, so the men are rim-lit shapes against the lit sand
    K.lowSun(C, T, { az: Math.atan2(fx, fz) + 0.55, el: 0.12, color: 0xffb060, sun: 1.2, hemi: 0.45, sky: 0xc8a888, ground: 0x7a5a34 });
    extra = { army: S.army.length, you: [S.you.x, S.you.z].map((v) => +v.toFixed(0)), hour: S.hour,
      eyeAboveGround: +(py - D.heightAt(px, pz)).toFixed(2) };
  }

  if (sub.id === 'cover-siege') {
    if (!X.battle) {
      if (W.phase() !== 'campaign') return { ok: false, err: 'phase ' + W.phase() };
      const depots = (S.outposts || []).filter((o) => o.kind === 'depot');
      const camps = (S.outposts || []).filter((o) => o.kind === 'camp');
      const fort = depots[0] || camps[0];
      if (!fort) return { ok: false, err: 'no depot or camp on this island' };
      enlist(sub.mine || 48);
      S.hour = sub.hour;
      // stand near it first so the raise queue and levelPad have settled its
      // FINAL position (levelPad can move a compound up to 180 m), then read it
      S.you.x = fort.x - 92; S.you.z = fort.z; S.you.yaw = Math.PI / 2;
      CP.camYaw(Math.PI / 2); CP.camDist(60);
      for (let i = 0; i < 4; i++) { X.calm(); X.step(30); }
      // THE COMPOUND ON THE DEFENDERS' LINE: them deploy at cx + 88 m, and cx is him
      S.you.x = fort.x - 92; S.you.z = fort.z;
      X.calm(); X.step(8);
      // find the raised compound group before the campaign hides its root
      let compound = null, best = 1e9;
      C.scene.traverse((o) => {
        if (o.userData && o.userData.near && o.userData.far && o.userData.colliders) {
          const d = Math.hypot(o.position.x - fort.x, o.position.z - fort.z);
          if (d < best) { best = d; compound = o; }
        }
      });
      const band = W.makeBand({ size: sub.them || 40, faction: 'legion', name: (fort.name || 'THE DEPOT') + ' GARRISON' });
      band.x = fort.x; band.z = fort.z; band.held = true; band.hostile = 1;
      W.battle.start({ band: band, storm: true });
      let B = null;
      for (let t = 0; t < 1500; t++) {
        B = window.__warlordBattle;
        if (B && B.live && B.live()) break;
        await sleep(100);
      }
      if (!(B && B.live && B.live())) return { ok: false, err: 'the battle never went live' };
      B.freeze();
      /* LIFT THE COMPOUND OUT OF THE HIDDEN ROOT. campaign.js's showAll(false)
         has just hidden the island; the battle's own ground patch is drawn at
         the same heightAt. The group keeps its world placement (props.place
         wrote it on the group itself) and stands on the patch. */
      if (compound && best < 60) { C.scene.add(compound); compound.visible = true; compound.updateMatrixWorld(true); }
      X.battle = { B: B, fort: fort, t: 0, compound: !!compound, compoundOff: +best.toFixed(1) };
      // one settled second, then the orders: they hold the compound, we go at it
      B.advance(1); X.battle.t += 1;
      B.order('hold', 'them', { lock: true });
      B.order('charge');
    }
    const BT = X.battle, B = BT.B, fort = BT.fort;
    const want = Math.max(0, (sub.at || 20) - BT.t);
    if (want > 0) { B.advance(want); BT.t += want; }
    // THE FRONT: the living attackers nearest the compound, and the knot behind them
    const men = B.men();
    const mine = men.filter((m) => m.team === 'mine' && !m.dead && !m.fled);
    const them = men.filter((m) => m.team === 'them' && !m.dead && !m.fled);
    if (!mine.length) return { ok: false, err: 'nobody left to charge' };
    mine.sort((p, q) => Math.hypot(p.x - fort.x, p.z - fort.z) - Math.hypot(q.x - fort.x, q.z - fort.z));
    const knot = mine.slice(0, Math.min(14, mine.length));
    let kx = 0, kz = 0; for (const m of knot) { kx += m.x; kz += m.z; } kx /= knot.length; kz /= knot.length;
    const dx = fort.x - kx, dz = fort.z - kz, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
    // the director poses everyone in this cone (posePass force), then the hand lens
    B.camera('cmd');
    B.look({ x: kx, z: kz, dist: 22, pitch: 0.18, yaw: Math.atan2(-ux, -uz) });
    const back = aspect < 1 ? 11 : 10, side = aspect < 1 ? 2.5 : 5;
    const px = kx - ux * back + (-uz) * side, pz = kz - uz * back + ux * side;
    // and never inside the warlord himself: he charges with the knot, and a
    // lens in his chest photographs his own rifle across the bottom of the frame
    let px2 = px, pz2 = pz;
    // the men are not colliders: walk the lens sideways until nobody living
    // (the warlord included — men() lists him) stands within two metres of it
    for (let k = 0; k < 10; k++) {
      let hit = false;
      for (const m of men) if (!m.dead && Math.hypot(m.x - px2, m.z - pz2) < 3.4) { hit = true; break; }
      if (!hit) break;
      px2 += (-uz) * 2.0; pz2 += ux * 2.0;
    }
    const py = B.groundAt(px2, pz2) + 1.9;
    lens = K.lens(C, T, { x: px2, y: py, z: pz2 }, { x: fort.x, y: B.groundAt(fort.x, fort.z) + (aspect < 1 ? 3.0 : 2.0), z: fort.z }, aspect < 1 ? 62 : 56);
    // low sun from behind the lens: the attackers' backs and the compound's face both lit
    K.lowSun(C, T, { az: Math.atan2(-ux, -uz) + 0.5, el: 0.17, color: 0xffb870, sun: 1.05, hemi: 0.42, sky: 0xcfb08a, ground: 0x7a5a34, fog: 0xdcae7a, top: 0x35609a, bot: 0xe6b27a });
    let a = null; try { a = B.audit(); } catch (e) {}
    extra = { fort: { kind: fort.kind, x: +fort.x.toFixed(0), z: +fort.z.toFixed(0) }, compound: BT.compound, compoundOff: BT.compoundOff,
      battleT: BT.t, range: +dl.toFixed(1), mine: mine.length, them: them.length, dead: a ? (a.mine.dead + a.them.dead) : null };
  }

  K.hideChrome(C);
  K.vignette({ top: 0.36, stop: 32 });
  const title = K.title(${JSON.stringify(TITLE)}, { family: ${JSON.stringify(FONT)}, weight: 400, tracking: '.005em',
    scaleW: aspect < 1 ? 0.16 : 0.125, scaleH: 0.15, color: '#fbe9c8', lineHeight: 0.92,
    shadow: '0 4px 0 #3a1f0c,0 0 2px #000,0 12px 34px rgba(20,8,0,.9)' });
  K.render(C);
  await sleep(200);
  K.render(C);
  return { ok: true, stage: Object.assign({ subject: sub.id, lens: lens, title: title, font: X.font, width: innerWidth, height: innerHeight, phase: W.phase() }, extra) };
}`;
const stage = new Function('return ' + stageSource)();

export default {
  id: 'warlord-product',
  title: 'Desert Warlord — in-engine product photography',
  description: 'Store covers for the standalone Desert Warlord release, staged in the shipped page: seed 1337\'s island, a 150-man column ridden across the erg at hour 18.2, and a battle.js siege of an arms depot with the garrison deployed inside the compound.',
  page: 'games/warlord.html',
  defaultBefore: 'local',
  beforeLabel: 'SOURCE GAME', afterLabel: 'PRODUCT CAPTURE',
  pairNote: 'Every pixel is games/warlord.html rendering its own island · title is the only overlay',
  urlParams: { go: 1, seed: 1337, weather: 'off', sound: 'off', events: 'off' },
  readyExpression,
  stageTimeoutMs: 900000,
  metrics: {}, metricsNote: 'Product captures, not a gameplay score.',
  subjects, stage,
};
