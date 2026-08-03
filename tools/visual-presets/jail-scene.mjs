/* Prison Escape storyboard for tools/visual-compare.mjs.

   Boots the REAL escape mode (title screen → Prison Escape → Play), freezes
   the rAF loop, then walks a fixed shot list over the live compound with
   CBZ.stepSim(1/60) bursts. Both builds photograph the same seeded prison
   at the same simulated seconds.

   What the storyboard is FOR (owner complaints, 2026-08-02):
   - a city road runs through the jail (the compound shares the city's
     coordinate space near z≈0 and is registered nowhere) — the aerial and
     oblique establishing shots exist to catch it on both sides;
   - fake props (bunks/benches/tables that are pure boxes) and leftover
     loot chests — the interior shots;
   - vents at hard-coded arbitrary coordinates — the vent close-ups;
   - HUD narration ("summaries of events when the events should just
     happen") — the hud:true beats, which keep the HUD visible and measure
     hudTextChars: show-don't-tell is that number going DOWN while a real
     guard tackle / real punches carry the information instead;
   - only one gun showing in the inventory strip — the arsenal beat grants
     three weapons and photographs the strip.

   Staging facts: rAF stub after boot freezes core/loop.js (CBZ.stepSim
   becomes the only clock); the prison lives near the origin (CBZ.WORLD
   northYard x[-30,30] z[-8,52], southBlock x[-44,44] z[52,128], cell block
   just north of the yard around z≈-31); sky rig recenter before manual
   renders; the player is healed each tick so the storyboard cannot end on
   a death screen. */

const subjects = [
  { id: "compound-aerial", label: "The compound from above", hud: false,
    focus: "Top-down establishing shot. The owner's road-through-the-jail should be visible here on the before side and gone on the after side.",
    act: {},
    cam: { x: 0, y: 300, z: 61, ax: 0, ay: 0, az: 60 } },
  { id: "compound-oblique", label: "The compound and its surroundings", hud: false,
    focus: "Low oblique from outside the west wall: how the prison sits in the world — walls, towers, and whatever the city routed through it.",
    act: {},
    cam: { x: -170, y: 75, z: -70, ax: 0, ay: 6, az: 48 } },
  { id: "yard-life", label: "The north yard", hud: false,
    focus: "The exercise yard from a tower: guards on post, inmates, props. Every prop should be interactable or load-bearing — no garnish.",
    act: { secs: 4 },
    cam: { x: 27, y: 13, z: 47, ax: -6, ay: 1, az: 18 } },
  { id: "cellblock-aisle", label: "Cell block aisle", hud: false,
    focus: "Inside the block: cells, bunks, and the aisle vent. Bunks should read as usable furniture, not painted boxes; any leftover loot chest is a bug.",
    act: {},
    cam: { x: -6, y: 2.1, z: -31, ax: -16, ay: 0.9, az: -31 } },
  { id: "vent-mess", label: "The mess-hall vent (outside)", hud: false,
    focus: "The old cafeteria grate sat proud of an exterior wall at a hard-coded coordinate. After: nothing arbitrary on this wall.",
    act: {},
    cam: { x: -13.2, y: 1.7, z: 8.5, ax: -19, ay: 0.8, az: 8.5 } },
  { id: "vent-mess-inside", label: "The mess-hall vent (inside)", hud: false,
    focus: "From inside the mess: the rebuilt grate is flush in the masonry, correctly faced, a two-grate junction — a duct network that belongs to the building.",
    act: {},
    cam: { x: -24, y: 1.6, z: 12, ax: -24, ay: 0.9, az: 4 } },
  { id: "vent-armory", label: "The armory duct", hud: false,
    focus: "Three of the four old grates deposited you OUTSIDE the room they named — the armory exit landed at x=17.4 with the armory wall at 19. After: the crawl point is inside the room.",
    act: {},
    cam: { x: 21, y: 1.4, z: -3, ax: 17, ay: 0.9, az: -4.5 } },
  { id: "south-block", label: "South block", hud: false,
    focus: "The wider lower complex — workshops, chapel, infirmary, the freedom gate. Scene quality check.",
    act: {},
    cam: { x: 0, y: 32, z: 158, ax: 0, ay: 3, az: 92 } },
  { id: "hud-idle", label: "The screen, just playing", hud: true,
    focus: "Six sim-seconds of ordinary play with the HUD up. Before: hints/objective prose narrating the mode at you. After: game state only.",
    act: { secs: 6 },
    cam: { player: true, back: 8, up: 3 } },
  { id: "hud-arsenal", label: "Carrying three weapons", hud: true,
    focus: "Sidearm + shotgun + AK granted. Gang city shows a boxed icon inventory; jail used to show a single text chip. One shared strip should now show all three.",
    act: { arm: ["sidearm", "shotgun", "ak47"], secs: 1 },
    cam: { player: true, back: 8, up: 3 } },
  { id: "inmate-punch", label: "Getting jumped — the punch", hud: true,
    focus: "An inmate hunting the player. Before: a toast SAYS 'x is jumping you'. After: he squares up and a real punch lands — health drops, head snaps, no words. The frame is shot the moment hp first falls.",
    act: { jump: true, untilHpDrop: true, budget: 6 },
    cam: { player: true, back: 6, up: 2.2 } },
  { id: "inmate-grab", label: "Getting jumped — the grab", hud: true,
    focus: "Two seconds later: the third blow is a grab (predator seize, drag style). The beating is the message.",
    act: { secs: 2.1, holdJumper: true },
    cam: { player: true, back: 6, up: 2.2 } },
  { id: "guard-tackle", label: "Getting caught", hud: true,
    focus: "A hunting guard reaches the player. Before: a teleport, a red flash, and a toast SAYING you were caught. After: a physical pin with one timed BREAK FREE press. The frame is shot the moment capture state changes.",
    act: { deliver: true, untilCapture: true, budget: 9 },
    cam: { player: true, back: 7, up: 2.6 } },
];

async function stageJail(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__jailOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };
  const hudTextChars = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    let chars = 0;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__jailOverlay") continue;
      if (getComputedStyle(child).display === "none") continue;
      chars += (child.innerText || "").replace(/\s+/g, "").length;
    }
    return chars;
  };

  let S = window.__jailSeq;
  if (!S) {
    // ---- one-time: boot the real game into escape mode ------------------
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="escape"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // Freeze the rAF loop; CBZ.stepSim is the only clock from here.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__jailOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__jailSeq = { overlay };
    window.__cbzVisualCompare = {
      render() {
        try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
      },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms;
      if (ms > maxMs) maxMs = ms;
      if (ms > 33) over33++;
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
    }
  };

  if (act.arm && typeof CBZ.unlockWeapon === "function") {
    for (const id of act.arm) { try { CBZ.unlockWeapon(id, { select: true }); } catch (_) {} }
  }
  if (act.deliver) {
    // hand the player to the nearest living guard, hunting: capture commits
    // on contact (<=1.4m while gd.hunt > 0), the third contact is the seize
    const guards = (CBZ.guards || []).filter((g) => g && !g.dead && g.group && g.group.position);
    if (guards.length && CBZ.player && CBZ.player.pos) {
      const p = CBZ.player.pos;
      let best = guards[0], bestD = Infinity;
      for (const g of guards) {
        const d = Math.hypot(g.group.position.x - p.x, g.group.position.z - p.z);
        if (d < bestD) { bestD = d; best = g; }
      }
      const gp = best.group.position;
      p.set(gp.x + 1.0, gp.y, gp.z + 0.4);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(p);
      best.hunt = 12;
      window.__jailSeq.mark = best;
      if (CBZ.game) CBZ.game.detection = 1;
    }
  }
  if (act.jump) {
    // sic the nearest living inmate on the player ("x is jumping you")
    const pool = (CBZ.npcs || []).filter((n) => n && !n.dead && n.group && n.group.position);
    if (pool.length && CBZ.player && CBZ.player.pos) {
      const p = CBZ.player.pos;
      let best = pool[0], bestD = Infinity;
      for (const n of pool) {
        const d = Math.hypot(n.group.position.x - p.x, n.group.position.z - p.z);
        if (d < bestD) { bestD = d; best = n; }
      }
      const np = best.group.position;
      p.set(np.x + 1.5, np.y, np.z);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(p);
      best.huntPlayer = 12;
      window.__jailSeq.jumper = best;
    }
  } else if (window.__jailSeq && window.__jailSeq.jumper) {
    window.__jailSeq.jumper.huntPlayer = 12; // keep the assault alive across beats
  }
  // event-shot beats: hold the two actors in contact range and stop stepping
  // the instant the event lands, so the frame IS the event — a punch mid-hp
  // drop, a pin mid-capture — instead of a timer's guess at it.
  const holdNear = (actor) => {
    if (!actor || !actor.group || !CBZ.player) return;
    const p = CBZ.player.pos, ap = actor.group.position;
    const d = Math.hypot(ap.x - p.x, ap.z - p.z);
    if (d > 1.3) p.set(ap.x + (p.x - ap.x) / d * 1.1, ap.y, ap.z + (p.z - ap.z) / d * 1.1);
  };
  if (act.untilHpDrop || act.untilCapture) {
    const budget = Math.round((act.budget || 6) * 10);
    const hp0 = CBZ.player ? CBZ.player.hp : 100;
    for (let i = 0; i < budget; i++) {
      holdNear(act.untilCapture ? (window.__jailSeq.mark || null) : window.__jailSeq.jumper);
      step(0.1);
      if (act.untilHpDrop && CBZ.player && CBZ.player.hp < hp0 - 1) break;
      if (act.untilCapture && CBZ.player &&
        (CBZ.player.captureState !== "normal" || CBZ.playerChar && CBZ.playerChar.cuffed)) break;
    }
  }
  if (act.secs) step(act.secs);
  if (act.holdJumper && window.__jailSeq.jumper) holdNear(window.__jailSeq.jumper);

  // ---- measure HUD pressure with the HUD as the game left it ------------
  setHud(true);
  void document.documentElement.offsetHeight;
  const hudChars = hudTextChars();

  // ---- frame and render -------------------------------------------------
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55;
  camera.near = 0.3;
  camera.far = 20000;
  const cam = subject.cam || {};
  if (cam.player && CBZ.player && CBZ.player.pos) {
    const p = CBZ.player.pos;
    camera.position.set(p.x, p.y + (cam.up || 3), p.z + (cam.back || 8));
    camera.lookAt(p.x, p.y + 1.1, p.z - 5);
  } else {
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.ax, cam.ay, cam.az);
  }
  camera.updateProjectionMatrix();
  // core/sky.js's own seam (rig + palette + sun placement), with the historic
  // y=0 follow as the degrade path for a build that predates it.
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }
  if (!subject.hud) setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:340px";
  query("focus").textContent = `mode ${CBZ.game.mode} · weapons ${(CBZ.weaponInventory || []).length}`;
  query("focus").style.cssText = "position:absolute;top:244px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";
  query("perf").textContent = ticks
    ? `sim ${ticks} ticks · avg ${(totalMs / ticks).toFixed(1)}ms · HUD ${hudChars} chars`
    : `HUD ${hudChars} chars`;
  query("perf").style.cssText = `position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    hudTextChars: hudChars,
    weaponsHeld: (CBZ.weaponInventory || []).length,
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    drawCalls: Number(render.calls || 0),
  };
  try {
    if (typeof CBZ.jailShowAudit === "function") {
      const audit = CBZ.jailShowAudit();
      for (const key of Object.keys(audit || {})) {
        if (Number.isFinite(Number(audit[key]))) metrics[`audit_${key}`] = Number(audit[key]);
      }
    }
  } catch (_) {}

  return {
    ok: true,
    captureState: CBZ.player ? CBZ.player.captureState || null : null,
    metrics,
  };
}

export default {
  id: "jail-scene",
  title: "Prison Escape: Show, Don't Tell",
  description: "The same seeded prison photographed on both builds at the same simulated seconds. Establishing shots hunt the road-through-the-jail and fake props; vent close-ups check that grates belong to their rooms; HUD beats keep the interface visible and measure hudTextChars — the narration being deleted while real guard takedowns, real punches and a real inventory strip carry the information instead.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "hudTextChars = rendered HUD text at the beat (show-don't-tell is this falling while the scene still explains itself). weaponsHeld crosses the strip shot: the strip should show every weapon held.",
  metrics: {
    hudTextChars: { label: "HUD text", unit: "chars", better: "lower" },
    weaponsHeld: { label: "Weapons held" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageJail,
};
