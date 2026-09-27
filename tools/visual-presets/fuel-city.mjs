/* Gang City annex — the filling station (world/fuel_station.js), by day.
   Companion to fuel-road.mjs (the disaster island). Before = the old annex
   station (its 14.5 x 0.9 canopy slab), after = the group named
   "fuel-station". HARNESS TRAP: stage() is serialized; keep it self-contained. */

const subjects = [{ id: "city-station", label: "City annex gas station", phase: 0.31 }];

async function stageFuelCity(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, err: "no CBZ/THREE" };
  const sub = input.subject;
  const W = input.width || innerWidth, H = input.height || innerHeight;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const end = Date.now() + budgetMs;
    while (Date.now() < end) { try { if (test()) return true; } catch (_) {} await wait(stepMs || 250); }
    return false;
  };
  const tick = (n) => { for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; if (CBZ.dayPhase) CBZ.dayPhase(sub.phase); try { CBZ.stepSim(1 / 60); } catch (_) {} if (CBZ.player) { CBZ.player.dead = false; CBZ.player.hp = 100; } } };
  if (!window.__fuelCity) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") && document.querySelector('[data-mode="city"]'), 360000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; CBZ.CONFIG.GANG_PERSIST = false; CBZ.CONFIG.CONTROLS_AUTO = false; }
    document.querySelector('[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 240000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
    try { if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    tick(60);
    window.__fuelCity = true;
    { const st = document.createElement("style"); st.textContent = "#lockHint{display:none!important}"; document.head.appendChild(st); }
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }
  let site = null;
  CBZ.scene.traverse((o) => {
    if (site) return;
    if (o.name === "fuel-station") {
      const f = new T.Vector3(0, 0, -1).applyAxisAngle(new T.Vector3(0, 1, 0), o.rotation.y);
      site = { x: o.position.x, z: o.position.z, fx: f.x, fz: f.z };
    } else if (o.isMesh && o.geometry && o.geometry.parameters && Math.abs((o.geometry.parameters.width || 0) - 14.5) < 0.01 &&
      Math.abs((o.geometry.parameters.height || 0) - 0.9) < 0.01 && Math.abs((o.geometry.parameters.depth || 0) - 9.5) < 0.01 && o.position.x > 300) {
      site = { x: o.position.x, z: o.position.z, fx: 0, fz: 1 };
    }
  });
  if (!site) return { ok: false, err: "no station" };
  const P = CBZ.player;
  if (P && P.pos) { P.driving = false; P.pos.set(site.x, 0.9, site.z - 40); }
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
  tick(30);
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
  const px = -site.fz, pz = site.fx;
  const eye = new T.Vector3(site.x + site.fx * 34 + px * 14, 5.5, site.z + site.fz * 34 + pz * 14);
  const aim = new T.Vector3(site.x - site.fx, 2.2, site.z - site.fz);
  // the frame is the canvas: hide every sibling up the canvas's ancestor
  // chain, per subject (HUD pieces are appended after boot)
  { let el = CBZ.renderer && CBZ.renderer.domElement;
    while (el && el.parentElement) {
      for (const sib of Array.from(el.parentElement.children)) {
        if (sib === el || sib.tagName === "SCRIPT" || sib.tagName === "STYLE") continue;
        sib.style.setProperty("display", "none", "important");
      }
      el = el.parentElement; if (el === document.body) break;
    } }
  const cam = CBZ.camera;
  const shoot = () => {
    cam.aspect = W / H; cam.fov = 52; cam.near = 0.05; cam.updateProjectionMatrix();
    cam.position.copy(eye); cam.lookAt(aim); cam.updateMatrixWorld(true);
    if (CBZ.cineCam) { const c = CBZ.cineCam; c.active = true; c.x = eye.x; c.y = eye.y; c.z = eye.z; c.lx = aim.x; c.ly = aim.y; c.lz = aim.z; c.snap = true; }
  };
  shoot(); tick(10); shoot();
  CBZ.renderer.render(CBZ.scene, cam);
  return { ok: true, site };
}

export default {
  id: "fuel-city",
  title: "City annex gas station",
  description: "The Gang City annex filling station on the shared world/fuel_station.js builder.",
  defaultBefore: "local",
  viewport: { width: 1280, height: 800 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metrics: {}, metricsNote: "Visual pass.",
  subjects,
  stage: stageFuelCity,
};
