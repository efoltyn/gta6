/* President-mode LIFE storyboard (2026-09-27 rework).

   The owner's ask: "much more realistic, much less gimmicky button-pressing,
   look at the room they spawn in and make the assets in that room more
   meaningful". So the frames are the President's day, not the building:
   where you wake up, the desk you wake up at, a call on the desk phone, the
   Situation Room (people, not buttons), the balcony speech and its crowd,
   the motorcade and its detail, and the gate checkpoint.

   Built on president-compound.mjs's boot (same title-card President run,
   seed, frozen rAF, fixed-step ticks). Each subject carries `pre`: a STRING
   of page-side JS run after the base stage (subjects travel as JSON) with
   `CBZ, site, tick(n), newDay(), office()` in scope. It stages the moment
   through the systems' own harness hooks when they exist (the after build)
   and falls back to the same tripod on the before build, and it RETURNS the
   camera in world coords: { cam:{x,y,z,tx,ty,tz}, keepHud?, showPlayer? }.

   Before = a HEAD worktree on its own port (flagless wave):
     git worktree add --detach /tmp/pres-head HEAD
     (cd /tmp/pres-head && ln -s <repo>/node_modules node_modules && PORT=8611 python3 tools/devserver.py &)
     node tools/visual-compare.mjs --preset president-life --before http://127.0.0.1:8611/ --no-open */
import base from "./president-compound.mjs";

// the player's own third-person view, computed (rAF is frozen, so the game's
// camera rig never runs): 3.6 m behind the shoulders, 2 m up, looking past him.
const BEHIND = `
  function behind(back, up, look) {
    var P = CBZ.player, g = CBZ.playerChar && CBZ.playerChar.group;
    var h = g ? g.rotation.y : 0;
    var fx = Math.sin(h), fz = Math.cos(h);
    return { x: P.pos.x - fx * back, y: P.pos.y + up, z: P.pos.z - fz * back,
             tx: P.pos.x + fx * look, ty: P.pos.y + 1.2, tz: P.pos.z + fz * look };
  }`;

const subjects = [
  {
    id: "wake",
    label: "Where the President Wakes Up",
    focus: "The first frame of the mode. It used to be a lawn in the motor court with a waypoint on a steel door. Now you are standing behind your own desk in the President's Office.",
    player: { x: 0, y: 0.1, z: 10 },
    showPlayer: true,
    pre: BEHIND + `
      if (CBZ.presidentOffice && CBZ.presidentOffice._placeAtDesk) { try { CBZ.presidentOffice._placeAtDesk(); } catch (e) {} }
      else { var sp = { x: site.cx, z: site.cz + 10 }; CBZ.player.pos.set(sp.x, 0.14, sp.z); if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(CBZ.player.pos); CBZ.playerChar.group.rotation.y = Math.PI; } }
      tick(90);
      return { cam: behind(3.4, 2.0, 6) };`,
  },
  {
    id: "desk",
    label: "The Desk Is the Agenda",
    focus: "Every object on it does something: the phone rings with real calls, today's briefing folders are the day's decisions, the TV carries the news your decisions make. No console, no menu.",
    player: { x: 0, y: 0.1, z: 10 },
    pre: `
      var o = office(); if (!o) return null;
      tick(60);
      var d = o.landmarks.presidentialDesk, A = o.approach, y = o.floorY;
      // from the arrival portal side, looking at the desk and the seal wall
      var back = 5.6;
      return { cam: { x: d.x - A.nx * back + A.tx * 2.4, y: y + 2.25, z: d.z - A.nz * back + A.tz * 2.4,
                      tx: d.x, ty: y + 0.95, tz: d.z } };`,
  },
  {
    id: "call",
    label: "A Call on the Desk Phone",
    focus: "The line lights, the phone rings, you pick it up and a real person is on it: the General, the Bureau Director, a minister, reading what actually happened today and asking for a real order. Two answers.",
    player: { x: 0, y: 0.1, z: 10 },
    keepHud: true,
    showPlayer: true,
    pre: BEHIND + `
      var O = CBZ.presidentOffice;
      if (O && O._placeAtDesk) { try { O._placeAtDesk(); } catch (e) {} }
      tick(30);
      if (O && O._ringNow) { try { O._ringNow("general"); } catch (e) {} }
      tick(120);
      if (O && O._answer) { try { O._answer(); } catch (e) {} }
      tick(40);
      var o = office();
      if (!o) return { cam: behind(3.0, 1.9, 6), keepHud: true };
      var d = o.landmarks.presidentialDesk, A = o.approach, y = o.floorY;
      return { cam: { x: d.x - A.nx * 2.6 - A.tx * 2.2, y: y + 1.75, z: d.z - A.nz * 2.6 - A.tz * 2.2,
                      tx: d.x + A.nx * 0.9, ty: y + 1.1, tz: d.z + A.nz * 0.9 }, keepHud: true };`,
  },
  {
    id: "sitroom",
    label: "The Situation Room Is People",
    focus: "The seventeen labelled buttons are gone. The General, the Bureau Director and the Police Commissioner stand at the table and propose what they want to do. You answer them.",
    player: { x: 16, y: 0.08, z: -43.8 },
    pre: `
      tick(150);
      var R = CBZ.presidency._room && CBZ.presidency._room.rect;
      if (!R) return null;
      var cx = (R.minX + R.maxX) / 2, cz = (R.minZ + R.maxZ) / 2;
      return { cam: { x: R.minX + 1.2, y: 2.25, z: cz - 4.2, tx: cx + 1.5, ty: 1.0, tz: cz + 0.5 } };`,
  },
  {
    id: "balcony",
    label: "The Balcony Speech",
    focus: "A real balcony over the front door and a real crowd on the lawn. Its size is your approval; the signs in it are what you did this week.",
    player: { x: 0, y: 0.1, z: 12 },
    pre: `
      var PB = CBZ.presidentPublic;
      if (PB && PB._startNow) { try { PB._startNow("speech"); } catch (e) {} }
      tick(360);
      return { cam: { x: site.cx + 9, y: 2.2, z: site.cz + 16, tx: site.cx, ty: 3.6, tz: site.cz - 17 } };`,
  },
  {
    id: "motorcade",
    label: "The Motorcade",
    focus: "Police at the front, a lead car, the armoured state car with its flags, the follow car with the detail. It drives the real road in real time; the route is lined with police and the Hitman can read it off the schedule.",
    player: { x: 0, y: 0.1, z: 30 },
    pre: `
      var M = CBZ.motorcade, cars = null;
      if (M && M.run) {
        var dest = null, L = CBZ.govComplexes || [];
        for (var i = 0; i < L.length; i++) if (L[i] && (L[i].id === "capitol" || L[i].id === "cityhall") && L[i].gate) { dest = L[i].gate; break; }
        try { if (M._boardPlayer) M._boardPlayer(); } catch (e) {}
        try { M.run({ principal: "player", to: dest || { x: site.gate.x, z: site.gate.z + 400 } }); } catch (e) {}
        tick(420);
        try { cars = M._convoy ? M._convoy() : null; } catch (e) { cars = null; }
      }
      var c = null;
      if (cars && cars.length) { for (var k = 0; k < cars.length; k++) if (cars[k].role === "state") c = cars[k].car; if (!c) c = cars[0].car; }
      if (c && c.pos) {
        var h = c.heading != null ? c.heading : (c.group ? c.group.rotation.y : 0);
        var fx = Math.sin(h), fz = Math.cos(h);
        return { cam: { x: c.pos.x - fx * 14 + fz * 9, y: 8.5, z: c.pos.z - fz * 14 - fx * 9, tx: c.pos.x + fx * 6, ty: 0.8, tz: c.pos.z + fz * 6 } };
      }
      return { cam: { x: site.cx + 14, y: 7, z: site.cz + 4, tx: site.cx, ty: 0.8, tz: site.cz + 30 } };`,
  },
  {
    id: "gate",
    label: "The Gate Checkpoint",
    focus: "A walk-through magnetometer, an X-ray belt, a drop-arm barrier behind anti-ram bollards, officers who stop a man with a gun. Getting to the President means getting past this, or around it.",
    player: { x: 0, y: 0.1, z: 60 },
    pre: `
      tick(240);
      var gx = site.gate.x, gz = site.gate.z;
      return { cam: { x: gx + 7.5, y: 3.1, z: gz + 12, tx: gx - 1, ty: 1.2, tz: gz - 4 } };`,
  },
];

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const stage = new AsyncFunction("input", `
  const baseStage = (${base.stage.toString()});
  const first = await baseStage(input);           // boots the world on first call and writes the overlay
  if (!first || !first.ok) return first;
  const CBZ = window.CBZ;
  const site = CBZ.presidency && CBZ.presidency.site ? CBZ.presidency.site() : null;
  if (!site || !input.subject.pre) return first;
  const tick = (n) => { for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 90); CBZ.player.dead = false; } } };
  const newDay = () => { try { CBZ.polity._checkDayWrap(0.95); CBZ.polity._checkDayWrap(0.05); } catch (e) {} tick(120); return CBZ.worldDay(); };
  const office = () => {
    const L = CBZ.presidentInteriorRooms ? CBZ.presidentInteriorRooms() : [];
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].key === "ovaloffice" && L[i].landmarks && L[i].approach) return L[i];
    return null;
  };
  let res = null;
  try { res = (new Function("CBZ", "site", "tick", "newDay", "office", input.subject.pre))(CBZ, site, tick, newDay, office); }
  catch (e) { return { ok: false, err: "pre failed: " + (e && e.message) }; }
  const cam = res && res.cam;
  const camera = CBZ.camera;
  if (cam) {
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    camera.updateProjectionMatrix();
    try { if (typeof CBZ.skySync === "function") CBZ.skySync(); } catch (e) {}
  }
  if (CBZ.playerChar && CBZ.playerChar.group) {
    CBZ.playerChar.group.visible = !!input.subject.showPlayer;
    if (CBZ.player && CBZ.player.pos) CBZ.playerChar.group.position.copy(CBZ.player.pos);
  }
  if (input.subject.keepHud || (res && res.keepHud)) {
    for (const child of Array.from(document.body.children)) child.style.visibility = "";
  }
  try { CBZ.renderer.render(CBZ.scene, camera); } catch (e) {}
  first.camera = cam ? { position: { x: cam.x, y: cam.y, z: cam.z }, target: { x: cam.tx, y: cam.ty, z: cam.tz } } : first.camera;
  first.debug = Object.assign({}, first.debug || {}, {
    seam: CBZ.presidency && CBZ.presidency.current ? (function () { const c = CBZ.presidency.current(); return { kind: c.kind, name: c.name }; })() : null,
    schedule: CBZ.presidency && CBZ.presidency.schedule ? CBZ.presidency.schedule() : null,
  });
  return first;
`);

export default {
  ...base,
  id: "president-life",
  title: "President Mode, the President's Day",
  description: "Where you wake, the desk, a phone call, the Situation Room, the balcony speech, the motorcade and the gate checkpoint: the President rework photographed against HEAD.",
  // the base stage frames subject.cam before pre runs; every subject re-aims after
  subjects: subjects.map(function (s) { return Object.assign({ cam: { x: 0, y: 5.8, z: 78, ax: 0, ay: 6.8, az: -34 } }, s); }),
  stage,
  transformReferenceStage: undefined,
  beforeLabel: "BEFORE (HEAD)",
  afterLabel: "AFTER",
};
