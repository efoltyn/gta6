#!/usr/bin/env node
/* tools/cuff-model-check.mjs — THE CUFFS ARE REAL, AND THEY GO ON A MAN WHO
   IS DOWN WHERE HE LIES.

   Owner: "fix the appearance of handcuffs ... it's too easy to get
   handcuffed. I need to get knocked down or knocked out or tased and knocked
   unconscious to get handcuffed."

   Plain node, the real rigs and the real verbs (tools/lib/verbs-vm.mjs):
     1. THE MODEL (entities/handcuffs.js): a closed pair, a single cuff, the
        chain and the belt case at real size in metres
     2. THE FIT: every body's ring closes on its own wrist, 5.2 .. 9 cm inside
     3. STANDING (a man who gave up): cuffed, each cuff on its wrist, the two
        rings clear of each other, the chain never stretched
     4. ON THE FLOOR, for face-down and face-up men of every build: cuffed
        where he lies (the root never moves), rolled onto his face if he was
        on his back, the officer's knee on his shoulder blade, his hands on
        the wrists, no leg / torso of the officer inside the man; left lying
     5. A BLOW ON THE OFFICER mid-cuff ends it: "interrupted", no cuffs on
     6. OUT COLD: no fight in him; AWAKE on the floor he can fight it
     7. HAULED UP cuffed (V.getUp): the hands stay behind his back all the
        way up, then the escort takes him
     8. the player cuffed by a script's flag alone wears the pair; the cops'
        and officers' belts carry the case (not the warden's)

     node tools/cuff-model-check.mjs          exit 0 = ok */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const DT = 1 / 60;
let fails = 0, n = 0;
const t0 = Date.now();
function check(ok, name, detail) {
  n++;
  if (!ok) fails++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
}
const cm = (m) => (m * 100).toFixed(1) + " cm";

const v = loadVerbsVM({ mode: "escape" });
const { CBZ, THREE } = v, V = CBZ.verbs, H = CBZ.handcuffs;

// =============================================================== 1. THE MODEL
{
  check(!!H && typeof H.build === "function", "model: CBZ.handcuffs loaded", H ? "v" + H.version : "missing");
  const pair = H.build();
  pair.updateMatrixWorld(true);
  const hc = pair.userData.handcuffs;
  check(hc && hc.cuffs.length === 2 && hc.chain && hc.links.length === H.LINKS, "model: two cuffs and a chain, separate children", `${hc.links.length} links`);
  const size = new THREE.Box3().setFromObject(pair).getSize(new THREE.Vector3());
  check(size.x > 0.20 && size.x < 0.28, "model: a closed pair is 20..28 cm end to end", cm(size.x));
  const one = new THREE.Box3().setFromObject(hc.cuffs[0]).getSize(new THREE.Vector3());
  check(one.x > 0.085 && one.x < 0.125 && one.z > 0.06 && one.z < 0.085, "model: one cuff 8.5..12.5 x 6..8.5 cm", `${cm(one.x)} x ${cm(one.z)}`);
  check(one.y > 0.008 && one.y < 0.016, "model: steel, not a slab (1..1.6 cm thick through the lock box)", cm(one.y));
  const D = H.DIM, cg = H.cuffGeo(D.R_IN);
  check(Math.abs(2 * (cg.R - D.SWING) - 0.065) < 0.001, "model: 6.5 cm inside a closed cuff", cm(2 * (cg.R - D.SWING)));
  check(Math.abs(2 * D.SWING - 0.005) < 0.0008, "model: ~5 mm swing arm", (2 * D.SWING * 1000).toFixed(1) + " mm");
  check(H.CHAIN_LEN >= 0.05 && H.CHAIN_LEN <= 0.06 && H.LINKS >= 2 && H.LINKS <= 3, "model: a short chain, 2-3 links, 5-6 cm swivel to swivel", `${cm(H.CHAIN_LEN)}, ${H.LINKS} links`);
  // the chain keeps its length: slack hangs, pulled apart it is at most 1.2x
  const a = new THREE.Vector3(0, 0, 0), b = new THREE.Vector3(0.03, 0, 0), dn = new THREE.Vector3(0, -1, 0);
  H.seatChain(pair, a, b, dn, 1);
  const low = Math.min(...hc.links.map((l) => l.position.y));
  check(low < -0.005, "model: slack chain hangs", `lowest link ${cm(low)}`);
  let tris = 0; pair.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  check(tris < 2000, "model: cheap (shared low-poly geometry)", `${tris | 0} tris a pair`);
  let shadow = false, lights = 0; pair.traverse((o) => { if (o.castShadow) shadow = true; if (o.isLight) lights++; });
  check(!shadow && !lights, "model: no shadows, no lights");
  const mats = new Set(); pair.traverse((o) => { if (o.isMesh) mats.add(o.material); });
  check(mats.size === 1 && [...mats][0] === H.material(), "model: one shared nickel material");
  const open = H.buildOpen(); open.updateMatrixWorld(true);
  const os = new THREE.Box3().setFromObject(open).getSize(new THREE.Vector3());
  check(os.z > size.z * 1.5, "model: an open pair's swing arms stand open", `${cm(os.z)} across vs ${cm(size.z)} closed`);
  // the belt case is entities/dutykit.js's now (one merged duty kit)
  const CS = CBZ.dutyKit && CBZ.dutyKit.CASE;
  check(!!CS && CS.w > 0.06 && CS.w < 0.09 && CS.h > 0.08 && CS.h < 0.12 && CS.d > 0.03 && CS.d < 0.06, "model: the belt case is a real case (~8 x 10 x 4.5 cm)", CS ? `${cm(CS.w)} x ${cm(CS.h)} x ${cm(CS.d)}` : "no dutyKit");
}

// ================================================================= 2. THE FIT
{
  const bad = [];
  for (const [build, physique] of [["m", "average"], ["f", "average"], ["m", "heavy"], ["m", "slim"], ["m", "muscular"], ["f", "heavy"]]) {
    v.clearActors(); v.setPhysique(physique);
    const a = v.actor({ build });
    const f = V.cuffFit(a), hs = a.char.group.userData.humanScale || 0.7;
    const id = 2 * f.rIn * hs;
    if (!(id > 0.052 && id < 0.09)) bad.push(`${build}/${physique} ${cm(id)}`);
  }
  v.setPhysique("average");
  check(!bad.length, "fit: every wrist's cuff closes to 5.2..9 cm inside", bad.join(", ") || "6 bodies");
}

// ============================================================ helpers
function wristPts(ch) {
  const f = ch._cuffFit;
  const L = new THREE.Vector3(0, f.y, 0).applyMatrix4(ch.low.la.matrixWorld), R = new THREE.Vector3(0, f.y, 0).applyMatrix4(ch.low.ra.matrixWorld);
  return [L, R];
}
function cuffsOn(ch) { const out = []; ch.group.traverse((o) => { if (o.name === "handcuff-A" || o.name === "handcuff-B") out.push(o); }); return out; }
function pairState(t) {
  const ch = t.char, f = V.cuffFit(t), hs = ch.group.userData.humanScale || 0.7;
  const [L, R] = wristPts(ch), cs = cuffsOn(ch);
  const cc = cs.map((c) => c.getWorldPosition(new THREE.Vector3()));
  const off = cc.length === 2 ? Math.max(Math.min(cc[0].distanceTo(L), cc[0].distanceTo(R)), Math.min(cc[1].distanceTo(L), cc[1].distanceTo(R))) : 9;
  const sw = cs.map((c) => H.swivel(c, new THREE.Vector3()));
  const stretch = sw.length === 2 ? sw[0].distanceTo(sw[1]) / (H.CHAIN_LEN * f.k * hs) : 9;
  const clear = L.distanceTo(R) - 2 * f.rOut * hs;
  return { n: cs.length, off, stretch, clear };
}
// how deep a capsule (world a->b, radius r m) goes into his shaped torso (m; <0 = clear)
const _p = new THREE.Vector3();
function segPen(tch, a, b, r) {
  const TS = tch.torsoShape, s = tch.group.userData.humanScale || 0.7;
  let worst = -9;
  for (let i = 0; i <= 10; i++) {
    _p.copy(a).lerp(b, i / 10);
    tch.body.worldToLocal(_p);
    if (_p.y < TS.base || _p.y > TS.yN) continue;
    const Rr = TS.at(_p.y);
    const d = Math.max(Math.abs(_p.x) - Rr.a, tch.torsoBackZ(_p.x, _p.y) - _p.z, _p.z - tch.torsoFrontZ(_p.x, _p.y));
    worst = Math.max(worst, r - d * s);
  }
  return worst;
}
function officerInside(a, t) {
  const P = a.char.profile, s = a.char.group.userData.humanScale || 0.7;
  let worst = -9;
  for (const leg of [a.char.parts.rl, a.char.parts.ll]) {
    const low = leg.userData.low;
    const h = leg.getWorldPosition(new THREE.Vector3()), k = low.getWorldPosition(new THREE.Vector3());
    const f = new THREE.Vector3(0, -P.legLo, 0).applyMatrix4(low.matrixWorld);
    worst = Math.max(worst, segPen(t.char, h, k, P.legW * 0.42 * s), segPen(t.char, k, f, P.legW * 0.36 * s));
  }
  const b = a.char.body;
  const p0 = new THREE.Vector3(0, a.char.hipY, 0).applyMatrix4(b.matrixWorld), p1 = new THREE.Vector3(0, a.char.hipY + P.torsoH, 0).applyMatrix4(b.matrixWorld);
  return Math.max(worst, segPen(t.char, p0, p1, P.torsoD * 0.5 * s));
}

// ============================================================ 3. STANDING
{
  v.clearActors(); v.world({});
  const a = v.actor({ x: 0, z: 0, yaw: 0, name: "cop" }); a.kind = "cop";
  const t = v.actor({ x: 0, z: 0.9, yaw: Math.PI, name: "perp" });
  for (let i = 0; i < 6; i++) v.frame(DT);
  const refused = V.cuff(a, t, {});
  check(!CBZ.arrest || !CBZ.arrest.cuffable || !refused, "standing: a man on his feet who has not given up is not cuffed (arrest.js cuffable)", refused ? "a session started" : "refused");
  if (refused) refused.cancel();
  t.surrender = true;
  const S = V.cuff(a, t, {});
  let inHand = false;
  for (let i = 0; i < 400 && S && !S.done; i++) {
    v.frame(DT);
    const sock = a.char.sockets && a.char.sockets.rightHand;
    if (S.phase === "contact" && sock && sock.children.some((c) => c.name === "handcuffs-open")) inHand = true;
  }
  for (let i = 0; i < 30; i++) v.frame(DT);
  check(S && S.result && S.result.outcome === "cuffed" && !S.ground, "standing: a man with his hands up is cuffed on his feet", S && S.result ? S.result.outcome : "no session");
  check(inHand, "standing: the open cuffs are in the officer's right hand as his hands go on");
  const sockAfter = a.char.sockets.rightHand.children.some((c) => c.name === "handcuffs-open");
  check(!sockAfter, "standing: ... and gone from it once they are on him");
  const st = pairState(t);
  check(st.n === 2 && st.off < 0.01, "standing: each cuff closed on its own wrist", `${st.n} cuffs, ${cm(st.off)} off`);
  check(st.clear > -0.004, "standing: the two rings do not run through each other", cm(st.clear) + " clear");
  check(st.stretch <= 1.2 && st.stretch > 0.3, "standing: the chain is its own length (never stretched past 1.2x)", st.stretch.toFixed(2) + "x");
  V.setCuffs(t, false);
  check(cuffsOn(t.char).length === 0 && !t.char.cuffed, "standing: uncuffed, the pair is gone");
}

// ============================================================ 4. ON THE FLOOR
function groundRun(variant, pa, pt, build, o) {
  o = o || {};
  v.clearActors(); v.world({});
  v.setPhysique(pa);
  const a = v.actor({ x: 0, z: 0, yaw: 0, name: "cop" }); a.kind = "cop";
  v.setPhysique(pt);
  const t = v.actor({ x: 0.3, z: 1.4, yaw: variant === "face" ? Math.PI : 0, name: "perp", build });
  v.setPhysique("average");
  for (let i = 0; i < 6; i++) v.frame(DT);
  V.knockdown(t, { variant, dur: 8, ko: !!o.ko, dir: { x: 0, z: 1 } });
  for (let i = 0; i < 90; i++) v.frame(DT);
  const x0 = t.pos.clone();
  const S = V.cuff(a, t, o.opts || {});
  const r = { S, a, t, hand: 0, knee: 0, inside: -9, moved: 0, t0: -1, t1: -1, age: 0, fought: 0, phases: [] };
  const hp = new THREE.Vector3(), cp = new THREE.Vector3(), kn = new THREE.Vector3();
  for (let i = 0; i < 600 && S && !S.done; i++) {
    v.frame(DT);
    if (r.phases[r.phases.length - 1] !== S.phase) r.phases.push(S.phase);
    if (S.phase === "align" && r.t0 < 0) r.t0 = S.age;
    if (o.onFrame) o.onFrame(S, a, t);
    for (let h = 0; h < 2; h++) {
      if (!S.onA[h]) continue;
      V.handPoint(a.char, h ? "r" : "l", hp); V.contactPoint(t.char, S.handsA[h], cp);
      r.hand = Math.max(r.hand, hp.distanceTo(cp));
    }
    if (S.phase === "drive" && S.gs) {
      const leg = S.gs.side > 0 ? a.char.parts.rl : a.char.parts.ll;
      leg.userData.low.getWorldPosition(kn);
      r.knee = Math.max(r.knee, kn.distanceTo(new THREE.Vector3(S.gs.kx, S.gs.ky, S.gs.kz)));
      r.inside = Math.max(r.inside, officerInside(a, t));
    }
    if (S.cst) r.fought = Math.max(r.fought, S.cst.prog || 0);
    r.moved = Math.max(r.moved, Math.hypot(t.pos.x - x0.x, t.pos.z - x0.z));
    r.age = S.age;
  }
  r.t1 = r.age;
  return r;
}
{
  const rows = [];
  let bad = [];
  for (const [variant, pa, pt, build] of [["face", "average", "average"], ["back", "average", "average"], ["face", "heavy", "heavy"], ["back", "average", "heavy"], ["face", "slim", "muscular"], ["face", "average", "average", "f"], ["back", "muscular", "slim", "f"]]) {
    const r = groundRun(variant, pa, pt, build);
    const S = r.S, f = r.t.char.fall;
    const ok = S && S.ground && S.result && S.result.outcome === "cuffed";
    const lying = !!(f && f.on && f.variant === "face");
    rows.push({ variant, pa, pt, build, ok, lying, r });
    const tag = `${variant} ${pa}/${pt}${build ? " " + build : ""}`;
    if (!ok) bad.push(`${tag}: ${S ? (S.result && S.result.outcome) : "no session"}`);
    else if (!lying) bad.push(`${tag}: not left lying face down`);
  }
  check(!bad.length, "floor: a downed man is cuffed where he lies, face down (rolled over if on his back), every build", bad.join("; ") || `${rows.length} pairs`);
  const worst = (k) => Math.max(...rows.map((x) => x.r[k]));
  check(worst("moved") < 0.03, "floor: the man is not moved to the officer (the officer comes to him)", `root moved ${cm(worst("moved"))} at most`);
  check(worst("hand") < 0.05, "floor: the officer's hands are on the wrists (within 5 cm)", cm(worst("hand")));
  check(worst("knee") < 0.06, "floor: his knee is on the man's shoulder blade", `knee joint within ${cm(worst("knee"))} of its place`);
  check(worst("inside") < 0.03, "floor: no leg or torso of the officer inside the man", `deepest ${cm(worst("inside"))}`);
  const dur = rows[0].r.t1 - rows[0].r.t0;
  check(dur > 2.8 && dur < 4.2, "floor: a real ground cuff takes ~3.4 s (knee, first wrist, the other, up)", dur.toFixed(2) + " s");
  const st = pairState(rows[rows.length - 1].r.t);
  check(st.n === 2 && st.off < 0.01 && st.stretch <= 1.2, "floor: cuffs on both wrists behind his back, chain its own length", `${st.n} cuffs, ${cm(st.off)} off, chain ${st.stretch.toFixed(2)}x`);
}

// ================================================ 5. A BLOW ON THE OFFICER
{
  let hitAt = null;
  const r = groundRun("face", "average", "average", null, {
    onFrame(S, a) { if (S.phase === "drive" && S.k > 0.5 && !hitAt) { hitAt = S.phase; V.react(a, { zone: "head", power: 0.7, dir: { x: 1, z: 0 } }); } },
  });
  const S = r.S;
  check(S && S.result && S.result.outcome === "interrupted", "hit: a blow on the officer mid-cuff ends it (interrupted)", S && S.result ? S.result.outcome : "-");
  check(!r.t.char.cuffed && cuffsOn(r.t.char).length === 0, "hit: ... and no cuff is left on the man (not even the first)", `${cuffsOn(r.t.char).length} cuffs on him`);
  const sock = r.a.char.sockets.rightHand;
  check(!sock.children.some((c) => /^handcuff/.test(c.name)), "hit: ... nor in the officer's hand");
}

// ============================================================ 6. THE FIGHT
{
  const out = groundRun("face", "average", "average", null, { ko: true, opts: { struggle: 1 } });
  check(out.S.result && out.S.result.outcome === "cuffed" && out.fought === 0, "fight: a man knocked out cold does not fight the cuffs", `outcome ${out.S.result && out.S.result.outcome}, fight ${out.fought.toFixed(2)}`);
  const awake = groundRun("face", "average", "average", null, { ko: false, opts: { struggle: 1 } });
  check(awake.fought > 0 || (awake.S.result && awake.S.result.outcome === "escaped"), "fight: a man knocked down but awake can fight them", `outcome ${awake.S.result && awake.S.result.outcome}, fight ${awake.fought.toFixed(2)}`);
}

// ================================================ 7. HAULED UP, THEN WALKED
{
  const r = groundRun("face", "average", "average");
  const t = r.t, ch = t.char;
  check(!!(ch.fall && ch.fall.on) && ch.cuffed, "up: left lying cuffed until he is hauled up");
  V.getUp(t);
  const vp = CBZ.verbPoses;
  let worstBehind = -9, frames = 0;
  for (let i = 0; i < 240 && ch.fall && ch.fall.on; i++) {
    v.frame(DT); frames++;
    const [L, R] = wristPts(ch);
    for (const w of [L, R]) {
      const p = ch.body.worldToLocal(w.clone());
      worstBehind = Math.max(worstBehind, p.z + vp.backAt(ch, p.x, p.y) * 0.8);
    }
  }
  check(!(ch.fall && ch.fall.on), "up: V.getUp stands a cuffed man up", `${frames} frames`);
  check(worstBehind < 0, "up: his hands stay behind his back the whole way up", `worst wrist ${cm(worstBehind)} from behind`);
  const E = V.escort(r.a, t, {});
  let held = false;
  for (let i = 0; i < 200 && E && !E.done; i++) { v.frame(DT); if (E.phase === "hold") { held = true; break; } }
  check(!!E && held, "up: then the escort takes him");
  if (E && !E.done) E.cancel();
  V.setCuffs(t, false);
}

// ================================================ 8. FLAGS AND BELTS
{
  v.clearActors();
  CBZ.playerChar.cuffed = true;
  for (let i = 0; i < 30; i++) v.frame(DT);
  check(cuffsOn(CBZ.playerChar).length === 2, "flag: the player cuffed by a script's flag alone wears the pair");
  V.setCuffs(V.playerActor(), false);
  const cop = v.actor({ name: "cop" }); cop.kind = "cop";
  const warden = v.actor({ name: "warden" }); warden.kind = "warden";
  const guard = v.actor({ name: "guard" }); guard.kind = "guard";
  // the cuff case rides the uniform's duty kit (entities/dutykit.js), dressed
  // by the record: a patrol cop's and a CO's belt carry it, a suit does not
  const K = CBZ.dutyKit;
  if (K) { K.wear(cop.char, { duty: "police" }); K.wear(guard.char, { duty: "corrections" }); K.wear(warden.char, { id: "suit" }); }
  const has = (a) => { const k = a.char._dutyKit; return !!(k && k.parent && K.KINDS[k.userData.kind].cuffs != null); };
  check(!!K && has(cop) && has(guard) && !has(warden), "belt: city cops and prison officers carry the cuff case (the warden does not)", `cop ${has(cop)}, guard ${has(guard)}, warden ${has(warden)}`);
}

// ====================================================================== API
check(V.cuffDown === true && V.DEFS.cuff.allowDown && !V.DEFS.uncuff.allowDown, "api: V.cuffDown, cuff takes a downed man, uncuff does not");
const errs = v.errors.splice(0);
check(!errs.length, "no errors thrown by the loaded files", errs.length ? errs[0].split("\n")[0] : "0");
console.log(`CUFFS: ${fails ? "FAIL" : "PASS"}  ${n - fails}/${n}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);
