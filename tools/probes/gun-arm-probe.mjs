#!/usr/bin/env node
/* tools/probes/gun-arm-probe.mjs — where do the arms go on a long gun?
   Builds a body on the title page, puts each long gun in its hands through
   CBZ.gunHold and prints, in the BODY frame (x = his left... +x is the left
   arm's side as built, y up, z forward; rig units, x0.70 = metres): shoulder,
   elbow, wrist for both arms, the butt plate, the grip, the barrel, and the
   forearm line each hand asks for. A find-the-bug probe: numbers, no look.
     node tools/probes/gun-arm-probe.mjs [--url index.html] */
import { launch } from "../lib/cdp.mjs";
const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const rig = await launch({ rafBudget: 1600 });
try {
  await rig.open(arg("--url", "index.html"), "seed=90210");
  if (!await rig.wait("window.CBZ && CBZ.game && CBZ.makeCharacter && CBZ.gunHold && CBZ.fpHands", 150000)) throw new Error("engine never came up");
  const out = await rig.evl(`(() => {
    const T = THREE, GH = CBZ.gunHold, res = {};
    const f = (v) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
    for (const gun of ${JSON.stringify((arg("--guns", "Shotgun,Carbine,AK-47,Sniper,LMG")).split(","))}) for (const hold of ["aim", "low"]) {
      const ch = CBZ.makeCharacter({ build: "${arg("--build", "m")}", physique: "${arg("--physique", "average")}", stature: 1, skin: 0xd9a47a, hair: 0x222222 });
      CBZ.scene.add(ch.group); ch.group.position.set(0, 50, 0); ch.group.updateMatrixWorld(true);
      const actor = { char: ch, group: ch.group, armed: true, weapon: gun, isPlayer: true };
      const prop = CBZ.syncActorWeapon(actor);
      const ok = hold === "aim" ? GH.ready(ch, prop, true) : GH.lowReady(ch, prop);
      ch.group.updateMatrixWorld(true);
      const B = ch.body, inv = new T.Matrix4().copy(B.matrixWorld).invert();
      const toB = (o, p) => { const v = (p || new T.Vector3()).clone(); o.localToWorld(v); return v.applyMatrix4(inv); };
      const r = { ok };
      for (const s of ["r", "l"]) {
        const part = s === "r" ? ch.parts.ra : ch.parts.la, low = part.userData.low, cap = part.userData.cap;
        const S = toB(part), E = toB(low), W = toB(low, new T.Vector3(0, cap.userData.fit.wristY, 0));
        const hq = new T.Quaternion(); cap.getWorldQuaternion(hq);
        const bq = new T.Quaternion(); B.getWorldQuaternion(bq).invert();
        const z = new T.Vector3(0, 0, 1).applyQuaternion(hq).applyQuaternion(bq);
        const fore = E.clone().sub(W).normalize();
        r[s] = { S: f(S), E: f(E), W: f(W), handZ: f(z), fore: f(fore), elbowBend: +low.rotation.x.toFixed(2), wristBend: +(Math.acos(Math.max(-1, Math.min(1, z.dot(fore))))).toFixed(2) };
      }
      const C = hold === "aim" ? prop.userData._ready : prop.userData._low;
      const sp = GH.specOf(prop);
      const bq = new T.Quaternion(); B.getWorldQuaternion(bq).invert();
      const gq = new T.Quaternion(); prop.getWorldQuaternion(gq);
      r.gun = { pos: f(toB(prop)), barrel: f(new T.Vector3(0, 0, -1).applyQuaternion(gq).applyQuaternion(bq)), up: f(new T.Vector3(0, 1, 0).applyQuaternion(gq).applyQuaternion(bq)), scale: +prop.scale.x.toFixed(3), stockZ: +(GH.stockZ(prop) * prop.scale.x).toFixed(3) };
      if (sp && sp._z) {
        r.gun.grip = f(toB(prop, sp._z.fc)); if (sp.sup) r.gun.sup = f(toB(prop, sp._z.sc));
        r.leadF = f(sp._z.fL); r.leadS = sp._z.sL ? f(sp._z.sL) : null; r.grasp = !!sp._z.fQ;
        if (sp._z.fQ) { const hz = new T.Vector3(0, 0, 1).applyQuaternion(sp._z.fQ); r.graspZinGun = f(hz); const hx = new T.Vector3(1, 0, 0).applyQuaternion(sp._z.fQ); r.graspXinGun = f(hx); }
      }
      if (C) r.C = { fireBend: +C.fireBend.toFixed(2), supBend: +(C.supBend || 0).toFixed(2), supGap: C.supGap == null ? null : +C.supGap.toFixed(3), slide: C.slide, inb: C.inb, fwd: C.fwd, prot: C.prot, blade: C.blade };
      res[gun + "/" + hold] = r;
      CBZ.scene.remove(ch.group);
    }
    return JSON.stringify(res); })()`, true);
  const R = typeof out === "string" ? JSON.parse(out) : out;
  for (const k in R) console.log(k, JSON.stringify(R[k]));
  console.log("page errors:", JSON.stringify(rig.errors.slice(0, 4)));
} catch (e) { console.log("PROBE FAILED:", e.message); console.log(JSON.stringify(rig.errors.slice(0, 6))); }
await rig.close();
