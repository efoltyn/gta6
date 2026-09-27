/* The Hitman story (city/agency.js + hitman_fallout.js + hitman_room.js),
   photographed in-engine, round two: in-world, no panels.

     room-board   the spawn room, the corkboard up close ("E Look" on the
                  board = hmInspect). Before: the room's default dressing.
                  After: the live file pinned up (his polaroid, the atlas page
                  with his places ringed, index cards, red string).
     the-phone    the burner on the bed. After: it rings, you answer, Nico's
                  first line is a film subtitle. Before: the arc is held back,
                  nobody calls.
     gun-case     the open gun case. After: the vial and the charge the arc
                  has put in your kit sit in the foam.
     binoculars   the President's address seen through binoculars from the
                  approach road: his detail round the podium, the rifles on
                  the roof edge. Before: the same lens on the Mansion with
                  no arc staging the address or the security.
     aftermath    a kill's aftermath on the motel TV (the local news running
                  the story hitman_fallout.js wrote from what happened).
                  Before: the TV's idle frame.

   The before side is the same build with ?agency_off=1: agency.js returns
   before defining CBZ.agency, so there is no phone call, no file, no paper,
   no staging at the Mansion, and the room shows hitman_room.js's defaults.

   Run (one at a time, the city build is heavy):
     ba --preset hitman-arc --no-open --keep-going --cdp-timeout 600000

   HARNESS TRAP: stage() is serialized into the page by toString(); nothing in
   this module's scope is reachable inside it. Knobs ride on input.subject. */

const subjects = [
  { id: "room-board", label: "The corkboard", phase: 0.3,
    focus: "Where the Hitman wakes. Before: a board of old clippings. After: the live file pinned up, his face, his places ringed on an atlas page, the string." },
  { id: "the-phone", label: "The burner rings", phase: 0.3,
    focus: "How the work arrives. Before: silence. After: the burner on the bed rings and the broker's first line plays as a subtitle." },
  { id: "gun-case", label: "The gun case", phase: 0.3,
    focus: "The case on the table, open. After: the vial and the wrapped charge from the story sit in the foam beside the guns." },
  { id: "binoculars", label: "The President, through binoculars", phase: 0.36,
    focus: "The address from the Mansion steps through the binoculars: the President, agents at the podium, rifles on the roof edge." },
  { id: "aftermath", label: "The news", phase: 0.3,
    focus: "The motel TV after a kill: the local news running the story the world decided (no witnesses, a shot from a distance)." },
];

async function stageHitmanArc(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, error: "no CBZ/THREE" };
  const sub = input.subject || {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) { try { if (test()) return true; } catch (_) {} await wait(stepMs || 250); }
    return false;
  };
  const tick = (n, dt) => {
    for (let i = 0; i < n; i++) {
      if (CBZ.game && CBZ.game.state === "paused") { try { CBZ.setState("playing"); } catch (_) {} }
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      try { if (CBZ.dayPhase && sub.phase != null) CBZ.dayPhase(sub.phase); } catch (_) {}
      try { CBZ.stepSim(dt || 1 / 60); } catch (_) {}
      if (CBZ.player) { CBZ.player.dead = false; CBZ.player.hp = 100; }
      if (!sub.keepWanted) CBZ.game.wanted = 0;
    }
  };
  const tickUntil = (test, max) => { for (let i = 0; i < (max || 600); i++) { let ok = false; try { ok = test(); } catch (_) {} if (ok) return true; tick(1); } return false; };
  const notes = [];
  const hasArc = !!CBZ.agency && !/agency_off=1/.test(String(location.search));

  // ---- boot once per page: the Hitman title card (it wakes in the room) ----
  let S = window.__hitmanArc;
  if (!S) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") && document.querySelector('[data-mode="city"]'), 360000);
    if (!booted) return { ok: false, error: "never booted" };
    if (CBZ.CONFIG) { CBZ.CONFIG.GANG_PERSIST = false; CBZ.CONFIG.CONTROLS_AUTO = false; }
    // pick the Hitman role if the title offers it; the lead's origins.js
    // spawns that card in the motel room
    const pickHitman = () => { try { const r = document.querySelector('[data-origin="contract"]'); if (r) r.click(); } catch (_) {} };
    pickHitman();
    document.querySelector('[data-mode="city"]').click();
    await wait(300);
    pickHitman();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, error: "never reached playing" };
    await until(() => { const c = document.getElementById("bootload"); return !c || getComputedStyle(c).display === "none"; }, 30000, 50);
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    tick(60);
    const st = document.createElement("style");
    st.textContent = "#lockHint{display:none!important}";
    document.head.appendChild(st);
    S = window.__hitmanArc = {};
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }
  const P = CBZ.player;
  const faceTo = (x, z) => {
    const lx = x - P.pos.x, lz = z - P.pos.z;
    if (CBZ.cam && Math.hypot(lx, lz) > 0.5) CBZ.cam.yaw = Math.atan2(-lx, -lz);
  };
  const put = (x, z, y) => {
    const yy = y != null ? y : (CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0);
    P.pos.set(x, yy, z); P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
  };
  const frame = (keep) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    const wanted = (el) => keep.some((sel) => { try { return el.matches(sel) || !!el.querySelector(sel); } catch (_) { return false; } });
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.tagName === "STYLE" || child.tagName === "SCRIPT") continue;
      child.style.visibility = wanted(child) ? "" : "hidden";
    }
  };
  const KEEP = [".hm-sub", ".hm-verb", ".hm-bino", ".hm-fade", ".dz-lb"];
  const fin = (extra) => {
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
    return Object.assign({ ok: true, arc: hasArc, notes, audit: hasArc ? CBZ.agency.audit() : null }, extra || {});
  };
  const reset = () => {
    try { if (CBZ.hmInspect && CBZ.hmInspect.active()) CBZ.hmInspect.exit(true); } catch (_) {}
    try { if (CBZ.hmHold && CBZ.hmHold.isOpen()) CBZ.hmHold.close(); } catch (_) {}
    try { if (CBZ.hmBinoculars && CBZ.hmBinoculars.active()) CBZ.hmBinoculars.toggle(false); } catch (_) {}
    try { if (CBZ.hmSayClear) CBZ.hmSayClear(); } catch (_) {}
    tick(20);
  };
  const R = CBZ.hmRoom;
  const room = R && R.ensure ? R.ensure() : (CBZ.hitmanRoom ? CBZ.hitmanRoom() : null);
  const inRoom = () => { if (room && room.spawn) { put(room.spawn.x, room.spawn.z, room.floorY); if (CBZ.cam) { CBZ.cam.yaw = room.spawn.heading || 0; if (CBZ.cam.pitch != null) CBZ.cam.pitch = 0.12; } tick(10); } };
  reset();

  // ------------------------------------------------------------------ beats
  if (sub.id === "room-board") {
    if (!room) return fin({ ok: false, error: "no room" });
    if (hasArc && !S.opened) {
      // the opening, played: the call, the envelope, his file on the board
      CBZ.agency.jump("opening"); inRoom();
      tickUntil(() => R.phone.ringing(), 900);
      try { R.phone.answer(); } catch (_) {}
      await wait(200);
      tickUntil(() => R.door.waiting("envelope"), 2400);
      await wait(3200);                          // the envelope delivery sits on a timer
      tickUntil(() => R.door.waiting("envelope"), 600);
      try { CBZ.agency._test.pickEnvelope("opening"); } catch (_) {}
      await wait(400);
      tick(30);
      S.opened = true;
      try { if (CBZ.hmHold && CBZ.hmHold.isOpen()) CBZ.hmHold.close(); } catch (_) {}
      tick(30);
    }
    inRoom();
    try { R.board.look(); } catch (e) { notes.push("board.look failed: " + e.message); }
    tick(120);
    await wait(500);
    frame(KEEP);
    return fin({ board: R.board.items().length });
  }

  if (sub.id === "the-phone") {
    if (!room) return fin({ ok: false, error: "no room" });
    if (hasArc) { CBZ.agency.jump("opening"); }
    inRoom();
    if (hasArc) tickUntil(() => R.phone.ringing(), 900);
    else tick(400);
    // find the burner: sweep the view until the only verb it has shows
    let found = false;
    for (let k = 0; k < 24 && !found; k++) {
      CBZ.cam.yaw = (room.spawn.heading || 0) + k * (Math.PI * 2 / 24);
      if (CBZ.cam.pitch != null) CBZ.cam.pitch = 0.45;   // positive pitch looks DOWN (origins uses 0.28)
      tick(8);
      const v = CBZ.hmVerbs && CBZ.hmVerbs.current();
      if (v && /Answer/.test(v.verb || "")) found = true;
    }
    notes.push(found ? "burner in view" : "burner verb not found; room center view");
    if (hasArc) {
      tick(20);
      await wait(300);
      try { R.phone.answer(); } catch (_) {}
      tick(20);
      await wait(400);
    }
    frame(KEEP);
    return fin({ ringing: hasArc ? "answered" : "silent" });
  }

  if (sub.id === "gun-case") {
    if (!room) return fin({ ok: false, error: "no room" });
    if (hasArc) { CBZ.agency.jump("cargo"); tick(30); reset(); }
    inRoom();
    try { R.gunCase.open(); } catch (e) { notes.push("gunCase.open failed: " + e.message); }
    tick(30);
    await wait(700);                                    // the case opens on a timer before the lean-in
    tick(40);
    try { if (CBZ.hmInspect && CBZ.hmInspect.active()) CBZ.hmInspect.stop(1); } catch (_) {}
    tick(90);
    await wait(300);
    frame(KEEP);
    return fin({ kit: hasArc ? CBZ.agency.kit() : null });
  }

  if (sub.id === "binoculars") {
    const site = (CBZ.govComplexes || []).find((s) => s && s.rect && (s.id === "execmansion" || (s.def && s.def.id === "execmansion")));
    if (!site) return fin({ ok: false, error: "no mansion" });
    const gx = site.gate ? site.gate.x : site.cx, gz = site.gate ? site.gate.z : site.rect.maxZ;
    if (hasArc) { CBZ.agency.jump("finale"); reset(); tickUntil(() => CBZ.agency._rt.fin && CBZ.agency._rt.fin.staged, 900); }
    // the published speech: president mode's own appearance (balcony + crowd + detail)
    let aim = { x: site.cx, y: 3, z: site.cz - 10 };
    const PB = CBZ.presidentPublic;
    if (hasArc && PB && PB._startNow) {
      try { PB._startNow("speech"); } catch (e) { notes.push("speech: " + e.message); }
      tick(360);
      try { const bl = PB.balcony(); if (bl) aim = { x: bl.x, y: bl.y + 1.4, z: bl.z }; } catch (_) {}
    } else if (hasArc) {
      const F = CBZ.agency._rt.fin;
      if (F && !F.seam && F.podium) {
        const p = F.ped; p.staffPost = null; p.controlled = true;
        p.pos.set(F.podium.x, p.pos.y, F.podium.z); if (p.group) p.group.position.copy(p.pos);
        F.phase = "address"; F.t = 5; aim = { x: F.podium.x, y: (p.pos.y || 0) + 1.5, z: F.podium.z };
      }
      tick(120);
    }
    // stand back on the approach, in line with the gate
    const sx = aim.x + 1.2, sz = aim.z + 85;   // on the lawn with the crowd, clear of the trees on the drive
    put(sx, sz); tick(20);
    const eyeY = (CBZ.floorAt ? (CBZ.floorAt(sx, sz) || 0) : 0) + 1.65;
    const dist = Math.hypot(aim.x - sx, aim.z - sz);
    const pitch = -Math.atan2(aim.y - eyeY, dist);        // positive pitch looks down
    const setAim = () => { faceTo(aim.x, aim.z); if (CBZ.cam && CBZ.cam.pitch != null) CBZ.cam.pitch = pitch; if (CBZ.fps && CBZ.fps.pitch != null) CBZ.fps.pitch = pitch; };
    setAim();
    try { if (CBZ.hmBinoculars) CBZ.hmBinoculars.toggle(true); } catch (_) {}
    for (let i = 0; i < 6; i++) { setAim(); tick(10); }
    if (typeof CBZ.skySync === "function") { try { CBZ.skySync(); } catch (_) {} }
    await wait(300);
    frame(KEEP);
    return fin({ aim: aim, dist: Math.round(dist) });
  }

  if (sub.id === "aftermath") {
    if (!room) return fin({ ok: false, error: "no room" });
    if (hasArc) {
      CBZ.agency.jump("ledger"); reset();
      tickUntil(() => CBZ.agency._rt.op && CBZ.agency._rt.op.staged && CBZ.agency._rt.op.ped, 900);
      const op = CBZ.agency._rt.op;
      if (op && op.ped) {
        const p = op.ped;
        put(p.pos.x + 70, p.pos.z + 70); faceTo(p.pos.x, p.pos.z); tick(10);
        CBZ.cityKillPed(p, { dir: { x: -1, z: -1 } }, "gunfire");
        tick(60);
        await wait(36000);                              // the news breaks 22 to 34 s after a kill
        tick(30);
      }
    }
    inRoom();
    try { R.tv.watch(); } catch (e) { notes.push("tv.watch failed: " + e.message); }
    tick(120);
    await wait(500);
    frame(KEEP);
    return fin({ story: hasArc && CBZ.hmFallout ? (CBZ.hmFallout.latest() || {}).story : null });
  }
  return { ok: false, error: "unknown subject " + sub.id };
}

export default {
  id: "hitman-arc",
  title: "The Hitman, in-world: the room, the burner, the case, the President, the news",
  description: "Five in-engine beats of the Hitman story round two (city/agency.js, hitman_fallout.js, hitman_room.js, hitman_hands.js) against the same room and lens with the arc held back.",
  viewport: { width: 1280, height: 800 },
  urlParams: { seed: 260811 },
  defaultBefore: "local",
  beforeParams: { agency_off: 1 },
  beforeLabel: "BEFORE: the room with no story (?agency_off=1)",
  afterLabel: "AFTER: the story, in the world",
  stageTimeoutMs: 600000,
  readyExpression: "window.CBZ && window.THREE && window.CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage: stageHitmanArc,
  pairNote: "Same seed, same city boot, same room and lens",
  method: "Both sides boot Gang City through the real title card. The after side drives the story with CBZ.agency.jump and the engine clock; the before side is the same build with ?agency_off=1, where agency.js never defines CBZ.agency.",
};
