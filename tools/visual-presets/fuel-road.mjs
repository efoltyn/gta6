/* Disaster island — the GAS STATION and the STREETS, close up.

   Built for the 2026-09-27 "improve the gas station and road" wave. Boots
   survival (the Natural Disaster island), freezes rAF, parks the player high
   over the island so the chase camera never intrudes, pins the sun, and
   shoots the station by day and by night, a street junction close up and a
   long view down an avenue.

   Finding the subjects works on BOTH sides of a before/after:
   - the station: after = the group named "fuel-station" (world/fuel_station.js);
     before = the old canopy slab (a 14.5 x 0.9 BoxGeometry under the arena).
   - the junction / avenue: the first grid crossing (cx +/- 40, cz +/- 40, ...)
     whose four legs are all on flat ground inside the island, computed from
     the arena's own height field, so both sides pick the same place.

   Run:
     ba fuel-road --before http://127.0.0.1:PORT_BEFORE/index.html \
        --after http://127.0.0.1:PORT_AFTER/index.html --width 1280 --height 800 --no-open

   HARNESS TRAP: stage() is serialized into the page; everything it needs is a
   literal inside it or rides on input.subject. */

const subjects = [
  { id: "station-day", label: "Gas station, afternoon", sun: 0.32, what: "station", view: "day" },
  { id: "station-night", label: "Gas station, night", sun: 0.83, what: "station", view: "night" },
  { id: "junction", label: "Street junction close up", sun: 0.30, what: "junction" },
  { id: "avenue", label: "Down the avenue", sun: 0.36, what: "avenue" },
];

async function stageFuelRoad(input) {
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
  let S = window.__fuelRoad;
  if (!S) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
      document.querySelector('[data-mode="survival"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 60; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    S = window.__fuelRoad = {};
    { const st = document.createElement("style"); st.textContent = "#lockHint{display:none!important}"; document.head.appendChild(st); }
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }
  const A = CBZ.surv.arena, cx = A.center.x, cz = A.center.z, R = A.radius;
  const gh = (x, z) => { try { return A.groundHeightAt(x, z); } catch (_) { return 0; } };
  const heal = () => {
    const P = CBZ.player; if (!P) return;
    P.hp = 100; P.dead = false;
    if (P.pos) { P.pos.x = cx; P.pos.z = cz; P.pos.y = 160; }
    if (P.vel) { P.vel.x = 0; P.vel.y = 0; P.vel.z = 0; }
  };
  const step = (secs) => {
    for (let i = 0; i < Math.round(secs * 60); i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      if (CBZ.dayPhase) CBZ.dayPhase(sub.sun);
      CBZ.stepSim(1 / 60); heal();
    }
  };
  /* THE ISLAND HAS NO NIGHT: survival.js pins its clear-day light every
     frame (disasters.js resets survEnv to CBZ.SURV_CLEAR_SKY each tick), so
     the "night" frame darkens that clear sky to the city's night keyframe
     for the shot and restores it after. This is how the lamps look under
     any dark disaster light (storm, ash, the nuke's winter). */
  const CS = CBZ.SURV_CLEAR_SKY;
  if (!S.clear && CS) S.clear = Object.assign({}, CS);
  if (CS && S.clear) {
    Object.assign(CS, S.clear);
    if (sub.view === "night") Object.assign(CS, { sunInt: 0.12, sunColor: 0x6f86c0, hemiInt: 0.2, hemiColor: 0x3a4a78, fog: 0x16243f });
  }
  step(0.5);
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;

  // ---- find the station (both sides) -----------------------------------------
  let site = null;
  A.root.traverse((o) => {
    if (site) return;
    if (o.name === "fuel-station") {
      const f = new T.Vector3(0, 0, -1).applyAxisAngle(new T.Vector3(0, 1, 0), o.rotation.y);   // toward the road
      site = { x: o.position.x, y: o.position.y, z: o.position.z, fx: f.x, fz: f.z, kind: "new" };
    }
  });
  if (!site) {
    A.root.traverse((o) => {
      if (site || !o.isMesh || !o.geometry || !o.geometry.parameters) return;
      const p = o.geometry.parameters;
      if (Math.abs(p.width - 14.5) < 0.01 && Math.abs(p.height - 0.9) < 0.01) {
        const x = o.position.x, z = o.position.z;
        // old stations faced the nearer grid line
        const offX = ((x - cx) % 40 + 60) % 40 - 20, offZ = ((z - cz) % 40 + 60) % 40 - 20;
        const fx = Math.abs(offX) > Math.abs(offZ) ? Math.sign(offX) : 0, fz = fx ? 0 : Math.sign(offZ);
        site = { x, y: gh(x, z), z, fx, fz, kind: "old" };
      }
    });
  }
  // ---- find a clean junction (identical on both sides) -----------------------
  let J = null;
  for (const kx of [-1, 1, -2, 2, 0]) for (const kz of [1, -1, 2, -2, 0]) {
    if (J) break;
    const x = cx + kx * 40, z = cz + kz * 40;
    let ok = true;
    for (const [dx, dz] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20]]) {
      if (Math.hypot(x + dx - cx, z + dz - cz) > R - 12 || gh(x + dx, z + dz) > 0.3) { ok = false; break; }
    }
    if (ok) J = { x, z };
  }
  if (!J) J = { x: cx - 40, z: cz + 40 };

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
  let eye, aim, fov = 55;
  if (sub.what === "station" && site) {
    const px = -site.fz, pz = site.fx;                 // along the frontage
    const d = sub.view === "night" ? 30 : 34;
    eye = new T.Vector3(site.x + site.fx * d + px * 14, site.y + 5.5, site.z + site.fz * d + pz * 14);
    aim = new T.Vector3(site.x - site.fx * 1, site.y + 2.2, site.z - site.fz * 1);
    fov = 52;
  } else if (sub.what === "junction") {
    eye = new T.Vector3(J.x + 11, gh(J.x + 11, J.z + 9) + 3.2, J.z + 9);
    aim = new T.Vector3(J.x - 1, 0, J.z - 2);
    fov = 60;
  } else {
    // stand on the avenue through J, 1.7 m up in the right lane, look along it
    const dirz = (J.z > cz) ? -1 : 1;
    eye = new T.Vector3(J.x + 1.8, gh(J.x, J.z) + 1.7, J.z - dirz * 16);
    aim = new T.Vector3(J.x + 0.4, 1.2, J.z + dirz * 70);
    fov = 58;
  }
  if (!eye) return { ok: false, err: "no subject", site };
  const shoot = () => {
    cam.aspect = W / H; cam.fov = fov; cam.near = 0.05; cam.far = Math.max(cam.far || 1400, 2500);
    cam.position.copy(eye); cam.up.set(0, 1, 0); cam.lookAt(aim); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    if (CBZ.cineCam) { const c = CBZ.cineCam; c.active = true; c.x = eye.x; c.y = eye.y; c.z = eye.z; c.lx = aim.x; c.ly = aim.y; c.lz = aim.z; c.snap = true; }
    try { if (CBZ.skySync) CBZ.skySync(); } catch (_) {}
  };
  shoot(); step(0.2); shoot();
  if (CBZ.renderer && CBZ.renderer.shadowMap) CBZ.renderer.shadowMap.needsUpdate = true;
  CBZ.renderer.render(CBZ.scene, cam);
  return { ok: true, subject: sub.id, site, junction: J, night: +(CBZ.nightAmount || 0).toFixed(2),
    eye: [eye.x, eye.y, eye.z].map((v) => +v.toFixed(1)) };
}

export default {
  id: "fuel-road",
  title: "Disaster island gas station + streets",
  description: "The island's filling station by day and night, a junction close up and a long avenue view, on the real survival build.",
  defaultBefore: "local",
  beforeLabel: "BEFORE", afterLabel: "AFTER",
  viewport: { width: 1280, height: 800 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metrics: {}, metricsNote: "Visual pass, no gameplay score.",
  subjects,
  stage: stageFuelRoad,
};
