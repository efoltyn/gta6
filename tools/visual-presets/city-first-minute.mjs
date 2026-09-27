/* Gang City: THE FIRST MINUTE. What a stranger sees when they press PLAY.

   Five plates of the real seeded city, booted like a player boots it:
     spawn        the game's own third-person camera where the player lands,
                  HUD and all, on the clock the game starts on
     street-*     eye level on a Midtown sidewalk down the avenue, at the
                  start-of-game morning, golden hour and night
     block        a three-quarter view over a Midtown block (facades, roofs,
                  shadows, the skyline behind)

   Nothing is staged but the lens (and the clock is pinned per tick so a
   150 s day cannot roll during the settle).

   Run (before = a HEAD worktree served on its own port):
     ba --preset city-first-minute --before http://127.0.0.1:8671/ --after http://127.0.0.1:8672/

   HARNESS TRAP: stage() is serialized into the page by toString(); nothing in
   module scope is reachable inside it. Every knob rides on input.subject. */

const subjects = [
  { id: "spawn", label: "Spawn: the player's own camera", phase: null, view: "spawn", hud: true,
    focus: "Exactly what the game shows after PLAY: the third-person rig, the HUD, whatever street the story drops you on." },
  { id: "street-morning", label: "Morning: eye level down the avenue", phase: 0.19, view: "eye",
    focus: "The clock the game starts on. Asphalt, kerbs, facades, sky, shadows. Flat plastic is the complaint." },
  { id: "block", label: "Morning: three-quarter over a Midtown block", phase: 0.19, view: "block",
    focus: "Roofs, facades, cast shadows, the skyline and horizon haze behind." },
  { id: "street-golden", label: "Golden hour: the same avenue", phase: 0.465, view: "eye",
    focus: "Low warm sun, long shadows, the sky burning behind the towers." },
  { id: "street-night", label: "Night: the same avenue", phase: 0.72, view: "eye",
    focus: "Street lamps, lit windows, headlights. A night street that is just dark blue is a diorama." },
];

async function stageCityFirstMinute(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, error: "no CBZ/THREE" };
  const sub = input.subject || {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) { try { if (test()) return true; } catch (_) {} await wait(stepMs || 250); }
    return false;
  };
  const tick = (n, phase) => {
    for (let i = 0; i < n; i++) {
      if (CBZ.game && CBZ.game.state === "paused") { try { CBZ.setState("playing"); } catch (_) {} }
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      try { if (CBZ.dayPhase && phase != null) CBZ.dayPhase(phase); } catch (_) {}
      try { CBZ.stepSim(1 / 60); } catch (_) {}
      if (CBZ.player) { CBZ.player.dead = false; CBZ.player.hp = 100; }
    }
  };
  const nearest = (values, n) => values.reduce((b, v) => Math.abs(v - n) < Math.abs(b - n) ? v : b, values[0]);

  let S = window.__cityFirstMinute;
  if (!S) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
      document.querySelector('[data-mode="city"]'), 360000);
    if (!booted) return { ok: false, error: "never booted" };
    if (CBZ.CONFIG) { CBZ.CONFIG.GANG_PERSIST = false; }
    document.querySelector('[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, error: "never reached playing" };
    await until(() => { const c = document.getElementById("bootload"); return !c || getComputedStyle(c).display === "none"; }, 30000, 50);
    // NO quality override: a stranger plays on the game's default tier (2,
    // Lambert world, env on roads/cars), so that is what gets judged.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    const phase0 = CBZ.dayPhase ? CBZ.dayPhase() : 0.18;
    // three seconds of play from the spawn, on the game's own clock
    tick(180, phase0);
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.roads) return { ok: false, error: "city arena missing" };
    const aveX = A.xLines[2];
    const centerZ = A.center && Number.isFinite(A.center.z) ? A.center.z : A.zLines[(A.zLines.length / 2) | 0];
    const crossZ = nearest(A.zLines, centerZ);
    const P = CBZ.player;
    S = window.__cityFirstMinute = {
      A, aveX, crossZ, phase0,
      spawn: P && P.pos ? { x: P.pos.x, y: P.pos.y, z: P.pos.z, yaw: CBZ.cam ? CBZ.cam.yaw : 0, pitch: CBZ.cam ? CBZ.cam.pitch : 0 } : null,
      hidden: [],
    };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }
  const A = S.A, ROAD = A.ROAD || 18, camera = CBZ.camera, P = CBZ.player;
  // restore HUD hidden by a previous subject
  for (const el of S.hidden) el.style.visibility = "";
  S.hidden = [];
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.style.visibility !== "hidden") { child.style.visibility = "hidden"; S.hidden.push(child); }
    }
  };
  const result = { ok: true, subject: sub.id };

  if (sub.view === "spawn") {
    // back to where the game put us, on the game's own camera and clock
    if (P && S.spawn) {
      P.driving = false;
      P.pos.set(S.spawn.x, S.spawn.y, S.spawn.z);
      if (CBZ.cam) { CBZ.cam.yaw = S.spawn.yaw; CBZ.cam.pitch = S.spawn.pitch; }
    }
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;
    tick(90, S.phase0);
    camera.aspect = input.width / input.height; camera.updateProjectionMatrix();
    try { const s = document.getElementById("lockHint"); if (s) s.style.visibility = "hidden"; } catch (_) {}
    result.camera = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    result.metrics = { phase: S.phase0 };
    return result;
  }

  const roadY = A.vehicleSurfaceY ? A.vehicleSurfaceY(S.aveX, S.crossZ) : 0.065;
  const cams = {
    // a man's eye in the avenue's inner lane south of the junction, looking north up it
    eye: { x: S.aveX + 2.2, y: roadY + 1.7, z: S.crossZ - ROAD / 2 - 16,
           ax: S.aveX + 1.2, ay: roadY + 3.2, az: S.crossZ + 60, fov: 58 },
    // 34 m over the avenue, south of the junction, looking up it into Midtown
    block: { x: S.aveX - 60, y: roadY + 52, z: S.crossZ - 110,
             ax: S.aveX + 10, ay: roadY + 4, az: S.crossZ + 30, fov: 55 },
  };
  const cam = (input.referenceStage && input.referenceStage.camera) || cams[sub.view] || cams.eye;
  if (P && P.pos) { P.driving = false; P.pos.set(cam.x, roadY + 0.9, cam.z); }
  const hidePlayer = () => {
    try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
    try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); else if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    for (const child of (camera.children || [])) {
      let vm = false;
      if (child && child.traverse) child.traverse((o) => { if (o && o.isMesh && o.renderOrder >= 999) vm = true; });
      if (vm) child.visible = false;
    }
  };
  hidePlayer();
  const aim = () => {
    camera.aspect = input.width / input.height; camera.fov = cam.fov; camera.near = 0.05;
    camera.far = Math.max(1400, camera.far || 1400);
    camera.position.set(cam.x, cam.y, cam.z); camera.up.set(0, 1, 0);
    camera.lookAt(cam.ax, cam.ay, cam.az);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    try { if (CBZ.skySync) CBZ.skySync(); } catch (_) {}
  };
  aim();
  tick(240, sub.phase);
  hidePlayer();
  aim();
  // a passer-by against the lens covers the plate with a shoulder
  for (const pool of [CBZ.cityPeds, CBZ.cityCops]) {
    for (const p of pool || []) {
      if (!p || !p.pos) continue;
      const g2 = p.group || (p.char && p.char.group);
      if (g2 && Math.hypot(p.pos.x - cam.x, p.pos.z - cam.z) < 5) g2.visible = false;
    }
  }
  hideHud();
  try { if (CBZ.renderer.shadowMap) CBZ.renderer.shadowMap.needsUpdate = true; } catch (_) {}
  CBZ.renderer.render(CBZ.scene, camera);
  result.camera = cam;
  result.metrics = { phase: sub.phase };
  return result;
}

export default {
  id: "city-first-minute",
  title: "Gang City: the first minute",
  description: "What a stranger sees after PLAY: the spawn through the game's own camera, then one Midtown avenue at eye level at morning, golden hour and night, and a three-quarter over a block.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90326, cfg_BOOT_METER: 0 },
  stageTimeoutMs: 600000,
  pairNote: "Same seed, block, clock, quality and viewport on both sides; the AFTER reuses the BEFORE camera. Peds and traffic are live, so individuals differ.",
  method: "Boots Gang Life like a player (mode card, PLAY), plays three seconds from the spawn on the game's own camera, then parks a tripod on the Midtown avenue with the clock pinned and steps the real sim four seconds before the shot.",
  subjects,
  stage: stageCityFirstMinute,
};
