/* The Bureau arc (city/agency.js + city/dossier.js), photographed in-engine.

   Four beats of the hitman game, each against what the same moment looked
   like before the arc existed (the before side has no CBZ.agency, so every
   subject has an honest "old" branch):

     contract-file  the contract as the player reads it: the old phone card vs
                    the classified file (photo, routine timeline, redactions)
     the-meet       where the story starts: the motel wall vs the handler
                    meeting under one sodium lamp, letterboxed
     confirm        the kill: a feed line vs the confirm card
     the-address    the finale: the Executive Mansion through the gate from
                    the approach road vs the dictator on the steps with a crowd

   Run (one at a time, the city build is heavy):
     ba hitman-arc --before https://efoltyn.github.io/gta6/ --no-open --cdp-timeout 600000

   HARNESS TRAP: stage() is serialized into the page by toString(); nothing in
   this module's scope is reachable inside it. Knobs ride on input.subject. */

const subjects = [
  { id: "contract-file", label: "The contract", phase: 0.3,
    focus: "What the player reads when a job comes in. Before: a phone card. After: a classified file with his photograph, what you have actually seen of his routine, and black bars over what you have not." },
  { id: "the-meet", label: "The handler", phase: 0.62,
    focus: "Where the plot starts. Before: a wall of marks in a motel annex. After: the Bureau's man under one sodium lamp beside a black car, letterboxed, talking." },
  { id: "confirm", label: "The confirm", phase: 0.3,
    focus: "The moment the mark goes down. Before: a line in the kill feed. After: the confirm card with the rating that reads what really happened." },
  { id: "the-address", label: "The dictator's address", phase: 0.36,
    focus: "The finale target through the Mansion gate from the approach road, the sniper's line. Before: an empty lawn. After: the President on the steps, his detail, a crowd." },
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
      CBZ.game.wanted = 0;
    }
  };
  const tickUntil = (test, max) => { for (let i = 0; i < (max || 600); i++) { let ok = false; try { ok = test(); } catch (_) {} if (ok) return true; tick(1); } return false; };
  const notes = [];
  const hasArc = !!CBZ.agency;

  // ---- boot once per page ----
  let S = window.__hitmanArc;
  if (!S) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") && document.querySelector('[data-mode="city"]'), 360000);
    if (!booted) return { ok: false, error: "never booted" };
    if (CBZ.CONFIG) { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; CBZ.CONFIG.GANG_PERSIST = false; CBZ.CONFIG.CONTROLS_AUTO = false; }
    document.querySelector('[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, error: "never reached playing" };
    await until(() => { const c = document.getElementById("bootload"); return !c || getComputedStyle(c).display === "none"; }, 30000, 50);
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
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
  const face = (x, z) => {
    const lx = x - P.pos.x, lz = z - P.pos.z;
    if (CBZ.cam && Math.hypot(lx, lz) > 0.5) CBZ.cam.yaw = Math.atan2(-lx, -lz);
  };
  const put = (x, z) => {
    const y = CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0;
    P.pos.set(x, y, z); P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
  };
  // the frame: the canvas plus whatever this beat is ABOUT
  const frame = (keep) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    const wanted = (el) => keep.some((sel) => { try { return el.matches(sel) || !!el.querySelector(sel); } catch (_) { return false; } });
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.tagName === "STYLE" || child.tagName === "SCRIPT") continue;
      child.style.visibility = wanted(child) ? "" : "hidden";
    }
  };
  const fin = (extra) => {
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
    return Object.assign({ ok: true, arc: hasArc, notes, audit: hasArc ? CBZ.agency.audit() : null }, extra || {});
  };

  // ------------------------------------------------------------------ beats
  if (sub.id === "contract-file" || sub.id === "confirm") {
    if (hasArc) {
      if (!S.ledger) {
        CBZ.agency.jump("ledger");
        tickUntil(() => CBZ.agency._rt.op && CBZ.agency._rt.op.staged && CBZ.agency._rt.op.ped, 900);
        S.ledger = true;
      }
      const op = CBZ.agency._rt.op;
      if (!op || !op.ped) return fin({ ok: false, error: "no op" });
      if (sub.id === "contract-file") {
        // stand across the street from him and watch a while
        const p = op.ped;
        put(p.pos.x + 13, p.pos.z + 13); face(p.pos.x, p.pos.z);
        for (let i = 0; i < 40; i++) { face(p.pos.x, p.pos.z); tick(6); }
        try { CBZ.dossier.close(); } catch (_) {}
        CBZ.agency.openFile();
        await wait(1200);                       // the typewriter reveal is on rAF; let it finish
        frame([".dz-backdrop"]);
        return fin({ identified: op.identified });
      }
      // confirm
      try { CBZ.dossier.close(); } catch (_) {}
      const p = op.ped;
      put(p.pos.x + 9, p.pos.z + 9); face(p.pos.x, p.pos.z); tick(10);
      CBZ.cityKillPed(p, { dir: { x: -1, z: -1 } }, "gunfire");
      tick(180);
      await wait(900);
      frame([".dz-cf"]);
      return fin({ rating: op.rating });
    }
    // BEFORE: the old contract pipe
    if (!S.oldCon) { try { S.oldCon = CBZ.hitmanStart ? CBZ.hitmanStart() : null; } catch (_) {} tick(30); }
    const m = S.oldCon;
    const ped = m && m.stages && m.stages[0] && m.stages[0].actor;
    if (sub.id === "contract-file") {
      if (ped) { put(ped.pos.x + 13, ped.pos.z + 13); face(ped.pos.x, ped.pos.z); tick(30); }
      try { if (CBZ.campaignUI && CBZ.campaignUI.open) CBZ.campaignUI.open("missions"); } catch (_) {}
      await wait(600);
      frame(["#campaignPhone"]);
      return fin();
    }
    if (ped) { put(ped.pos.x + 9, ped.pos.z + 9); face(ped.pos.x, ped.pos.z); tick(10); try { CBZ.cityKillPed(ped, {}, "gunfire"); } catch (_) {} }
    try { if (CBZ.campaignUI && CBZ.campaignUI.close) CBZ.campaignUI.close(); } catch (_) {}
    tick(60);
    frame(["#killfeed", "[id*='kill']", "[class*='kill']"]);
    return fin();
  }

  if (sub.id === "the-meet") {
    try { if (CBZ.dossier) CBZ.dossier.close(); } catch (_) {}
    if (hasArc) {
      CBZ.agency.jump("meet1");
      tickUntil(() => { const a = CBZ.game.cityWorld && CBZ.game.cityWorld.records && CBZ.game.cityWorld.records.hitman.arc; return a && a.meet; }, 400);
      const a = CBZ.game.cityWorld.records.hitman.arc;
      const m = a.meet;
      const fx = Math.sin(m.face), fz = Math.cos(m.face);
      put(m.x + fx * 16, m.z + fz * 16); face(m.x, m.z); tick(40);
      tickUntil(() => CBZ.agency._rt.meet && CBZ.agency._rt.meet.voss, 1200);
      put(m.x + fx * 6.5, m.z + fz * 6.5); face(m.x, m.z);
      tickUntil(() => CBZ.agency._rt.meet && CBZ.agency._rt.meet.started, 200);
      tick(70);
      await wait(700);
      frame(["#campaignDialogue", ".dz-lb", "[class*='dz-letter']", "[class*='dz-lb']"]);
      return fin({ meet: m });
    }
    const room = CBZ.hitmanRoom ? CBZ.hitmanRoom() : null;
    if (room) {
      put(room.spawn.x, room.spawn.z); face(room.board.x, room.board.z); tick(30);
      const cam = CBZ.camera;
      cam.position.set(room.spawn.x, (P.pos.y || 0) + 1.65, room.spawn.z);
      cam.lookAt(room.board.x, (P.pos.y || 0) + 1.5, room.board.z);
    }
    frame([]);
    return fin({ room: !!room });
  }

  if (sub.id === "the-address") {
    try { if (CBZ.dossier) CBZ.dossier.close(); } catch (_) {}
    const site = (CBZ.govComplexes || []).find((s) => s && s.rect && (s.id === "execmansion" || (s.def && s.def.id === "execmansion")));
    if (!site) return fin({ ok: false, error: "no mansion" });
    const gx = site.gate ? site.gate.x : site.cx, gz = site.gate ? site.gate.z : site.rect.maxZ;
    const standZ = gz + 110;
    put(gx + 1.5, standZ); tick(30);
    if (hasArc) {
      CBZ.agency.jump("finale");
      tickUntil(() => CBZ.agency._rt.fin && CBZ.agency._rt.fin.staged, 900);
      const F = CBZ.agency._rt.fin;
      if (F) {
        const p = F.ped;
        p.staffPost = null; p.controlled = true;
        p.pos.set(F.podium.x, p.pos.y, F.podium.z); if (p.group) p.group.position.copy(p.pos);
        F.phase = "address"; F.t = 5;
        tick(90);
      }
    }
    tick(20);
    const cam = CBZ.camera;
    cam.fov = 14; cam.updateProjectionMatrix();
    cam.position.set(gx + 1.5, (CBZ.floorAt ? CBZ.floorAt(gx, standZ) : 0) + 1.7, standZ);
    cam.lookAt(site.cx, 2.4, site.cz - 6);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    frame([]);
    return fin();
  }
  return { ok: false, error: "unknown subject " + sub.id };
}

export default {
  id: "hitman-arc",
  title: "The Bureau: the hitman game gets a plot",
  description: "Four in-engine beats of the Bureau arc (city/agency.js, city/dossier.js) against the same moments before it existed: the contract, the handler, the confirm, the dictator's address.",
  viewport: { width: 1280, height: 800 },
  urlParams: { seed: 260811 },
  stageTimeoutMs: 600000,
  readyExpression: "window.CBZ && window.THREE && window.CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage: stageHitmanArc,
  pairNote: "Same seed, same city boot, same beat of the loop",
  method: "Both sides boot Gang City through the real title card with the Contract campaign off. The after side drives the arc with CBZ.agency.jump and the engine clock; the before side has no arc and shows the old pipe at the same beat.",
};
