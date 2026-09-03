/* tools/lib/timeofday-stage.mjs — ONE staging function for the time-of-day
   presets (tools/visual-presets/time-of-day-*.mjs).

   The presets differ only in WHICH MODE boots and WHICH PLACES are framed;
   everything else — the clock, the camera lock, the HUD strip, the pixel
   census — is the same job, so it lives here once. The function below is
   serialized into the page by tools/visual-compare.mjs (`stage.toString()`),
   which is why it closes over NOTHING: every helper is declared inside it and
   every parameter arrives through `input.subject`.

   A subject is { id, label, focus, hour, place, night }:
     hour   — wall-clock hour (0..24) → daynight phase t = (hour-6)/24, because
              city/schedule.js defines sunrise 6, noon 12, sunset 18, midnight 0
     place  — a key into the mode's PLACES table built once at boot
     night  — true when the clock is past astronomical dusk; the shot's ground
              brightness is then published as `darkLeak` (better: lower), the
              one metric the verdict line is allowed to gate on. Day plates
              carry no `better` because "brighter" is not a direction there.

   MEASUREMENTS come off the real framebuffer after the real render:
     meanLum    — whole-frame mean luminance, 0..255
     skyLum     — mean over the top 12% of rows (the dome, usually)
     groundLum  — mean over the bottom 30% of rows (the surface at your feet)
     darkFrac   — % of pixels under 20/255 (black, by eye)
     litFrac    — % of pixels over 96/255 (a lit thing: sky, lamp, window)
   plus the rig as it stood: sun/hemi/bounce intensity, exposure, nightDepth. */

export async function stageTimeOfDay(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const subject = input.subject;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const tick = (frames) => {
    for (let i = 0; i < frames; i++) {
      CBZ.hitstop = 0;
      CBZ.slowmo = 0;
      try { CBZ.stepSim(1 / 60); } catch (_) {}
      if (CBZ.player) { CBZ.player.dead = false; CBZ.player.hp = 100; }
    }
  };
  const hideHud = (overlay) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child === overlay) continue;
      child.style.visibility = "hidden";
    }
    // the subtitle strip and its siblings live INSIDE the canvas's container
    if (canvas && canvas.parentElement) {
      for (const child of Array.from(canvas.parentElement.children)) {
        if (child === canvas || child === overlay) continue;
        child.style.visibility = "hidden";
      }
    }
  };
  const hidePlayerPresentation = () => {
    try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
    try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
    try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); else if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    if (CBZ.camera && CBZ.camera.children) {
      for (const child of CBZ.camera.children) {
        let isViewModel = false;
        if (child && child.traverse) child.traverse((o) => { if (o && o.isMesh && o.renderOrder >= 999) isViewModel = true; });
        if (isViewModel) child.visible = false;
      }
    }
  };
  const nearest = (values, n) => values.reduce((best, v) =>
    Math.abs(v - n) < Math.abs(best - n) ? v : best, values[0]);
  const floorAt = (x, z) => {
    try {
      if (CBZ.cityGroundY) { const y = CBZ.cityGroundY(x, z); if (Number.isFinite(y)) return y; }
      if (CBZ.floorAt) { const y = CBZ.floorAt(x, z); if (Number.isFinite(y)) return y; }
    } catch (_) {}
    return 0;
  };

  let S = window.__timeOfDay;
  if (!S) {
    const mode = subject.mode || "city";
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector(`[data-mode="${mode}"]`),
      360000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) {
      CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
      CBZ.CONFIG.GANG_PERSIST = false;
      // a lighting plate, not a stealth run: a searchlight catching the
      // parked player floods the whole frame red and photographs the alarm
      CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT = false;
    }
    document.querySelector(`[data-mode="${mode}"]`).click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    await until(() => {
      const card = document.getElementById("bootload");
      return !card || getComputedStyle(card).display === "none";
    }, 30000, 50);
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    tick(mode === "escape" ? 360 : 120);   // the prison has a reveal rail to let finish

    // ---- PLACES: real coordinates read off the built world, never typed in.
    const places = {};
    if (mode === "city") {
      const A = CBZ.city && CBZ.city.arena;
      if (!A || !A.roads || !A.streetProps) return { ok: false, err: "city arena missing" };
      const centerZ = A.center && Number.isFinite(A.center.z) ? A.center.z : A.zLines[(A.zLines.length / 2) | 0];
      const roadZ = nearest(A.zLines, centerZ);
      const road = A.roads.find((r) => !r.vertical && Math.abs(r.z - roadZ) < 0.01 && r.len > A.step * 2);
      if (!road) return { ok: false, err: "mainland cross-street missing" };
      const lamps = A.streetProps.filter((p) => p && p.type === "lamp" &&
        Math.abs(Math.abs(p.z - road.z) - (A.ROAD / 2 + 1)) < 0.8 &&
        p.x > A.minX + A.step && p.x < A.maxX - A.step);
      lamps.sort((a, b) => Math.abs(a.x - A.center.x) - Math.abs(b.x - A.center.x));
      const lamp = lamps[0];
      if (!lamp) return { ok: false, err: "no real lamp on comparison street" };
      const side = Math.sign(lamp.z - road.z) || 1;
      const top = A.vehicleSurfaceY ? A.vehicleSurfaceY(lamp.x, road.z) : 0.065;
      // the lit street: a lamp-side three-quarter down the cross-street
      places.street = {
        cam: { x: lamp.x + 17.0, y: top + 2.15, z: road.z - side * 1.4,
               ax: lamp.x - 22.0, ay: top + 1.05, az: road.z + side * 1.0, fov: 48 },
        stand: { x: lamp.x + 6, z: road.z },
      };
      // the drive: the player at the wheel of a real car on the same cross-
      // street, photographed from behind — after dark the only light on the
      // road ahead should be the car's own (city/headlights.js) and the lamps
      const dx = lamp.x - 26, dz = road.z + side * Math.min(3.0, A.ROAD * 0.18);
      const dtop = A.vehicleSurfaceY ? A.vehicleSurfaceY(dx, dz) : top;
      let drive = null;
      try {
        drive = CBZ.cityAddParkedCar ? CBZ.cityAddParkedCar(dx, dz, -Math.PI / 2, { modelName: "Bison Vista", color: 0x285aa8 }) : null;
        if (drive) {
          try { if (CBZ.cityEnterVehicle) CBZ.cityEnterVehicle(drive); } catch (_) {}
          if (CBZ.player) { CBZ.player.driving = true; CBZ.player._vehicle = drive; }
          drive.ai = false; drive.player = true;
        }
      } catch (_) { drive = null; }
      places.drive = {
        car: drive,
        cam: { x: dx + 9.5, y: dtop + 3.1, z: dz - side * 1.2, ax: dx - 30, ay: dtop + 0.4, az: dz, fov: 50 },
        stand: { x: dx, z: dz },
      };
      // the outskirts: past the last avenue, looking AWAY from the city —
      // no fixture within reach, so this is what "no light source" means
      const ox = A.maxX + 34, oz = centerZ;
      const oy = floorAt(ox, oz);
      places.outskirts = {
        cam: { x: ox, y: oy + 1.75, z: oz, ax: ox + 40, ay: oy + 1.2, az: oz + 6, fov: 60 },
        stand: { x: ox - 2, z: oz },
      };
      // the skyline: high and wide from beyond the south edge, the whole grid
      // in frame — by day a city, by night windows and neon against black
      const sx = A.center.x, sz = A.maxZ + 150;
      places.skyline = {
        cam: { x: sx, y: 70, z: sz, ax: sx, ay: 12, az: A.center.z, fov: 55 },
        stand: { x: sx, z: A.maxZ + 20 },
      };
    } else if (mode === "escape") {
      const W = CBZ.WORLD || { cellBlock: { x0: -16, x1: 16, z0: -44, z1: -8 } };
      const CB = W.cellBlock;
      const yardY = floorAt(0, 40);
      // the yard from the wire: the flood masts, the searchlight sweeps, the
      // black between them
      places.yard = {
        cam: { x: 22, y: yardY + 5.5, z: 62, ax: 0, ay: yardY + 1.5, az: 28, fov: 56 },
        stand: { x: 6, z: 44 },
      };
      // the yard at eye level on a bare patch (prisonnight's own audit probe
      // sits at 0,55) — what a man standing in it actually sees
      places.probe = {
        cam: { x: 0, y: yardY + 1.7, z: 56, ax: -12, ay: yardY + 1.2, az: 20, fov: 62 },
        stand: { x: 0, z: 55 },
      };
      // the cell wing's yard-side face, from inside the yard — barred windows
      // lit through the evening, dead at lights-out except the night strips
      const wx = (CB.x0 + CB.x1) * 0.5 + 14, wz = CB.z1 + 20;
      places.wing = {
        cam: { x: wx, y: floorAt(wx, wz) + 3.5, z: wz, ax: (CB.x0 + CB.x1) * 0.5, ay: 5, az: CB.z1 - 12, fov: 55 },
        stand: { x: wx - 4, z: wz },
      };
    }

    const overlay = document.createElement("div");
    overlay.id = "__timeOfDayOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 10px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-stat></div><div data-source></div>";
    document.body.appendChild(overlay);
    hideHud(overlay);

    S = window.__timeOfDay = { mode, places, overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const place = S.places[subject.place];
  if (!place) return { ok: false, err: "unknown place " + subject.place };

  // ---- the clock. 6 → sunrise, 12 → noon, 18 → sunset, 0 → midnight.
  const phase = (((subject.hour - 6) / 24) % 1 + 1) % 1;
  try { CBZ.dayPhase(phase); } catch (_) {}
  if (CBZ.player && CBZ.player.pos) {
    if (place.car) {
      // at the wheel: the vehicle code owns the transform, the player only
      // has to be registered as its driver so the headlight finds the car
      CBZ.player.driving = true;
      CBZ.player._vehicle = place.car;
      place.car.speed = 0; place.car.vel && place.car.vel.set && place.car.vel.set(0, 0, 0);
    } else {
      CBZ.player.driving = false;
      CBZ.player._vehicle = null;
      CBZ.player.pos.set(place.stand.x, floorAt(place.stand.x, place.stand.z) + 0.9, place.stand.z);
    }
  }
  // let the light drivers (lamp pool, fixtures, ad boards, exposure lerp, sky
  // repaint throttle) all settle on the new hour before the tripod goes down.
  // THE CLOCK KEEPS RUNNING WHILE THEY DO: the city day is 150 s, so 70
  // ticks at 1/60 is 11 game-minutes — enough to walk an 18:30 plate well
  // into dusk. The phase is pinned again after every settle. (70 + 24 + 2
  // ticks: a city tick is heavy, and the drivers converge in under 40.)
  tick(70);
  try { CBZ.dayPhase(phase); } catch (_) {}
  hidePlayerPresentation();

  const cam = (input.referenceStage && input.referenceStage.camera) || place.cam;
  const camera = CBZ.camera;
  const aim = () => {
    camera.aspect = input.width / input.height;
    camera.fov = cam.fov;
    camera.near = 0.05;
    camera.far = Math.max(1400, camera.far || 1400);
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.ax, cam.ay, cam.az);
    camera.updateProjectionMatrix();
  };
  aim();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  // the pooled lights bind by CAMERA distance on a throttled updater: give it
  // an interval with the tripod in place, then put the tripod back
  tick(24);
  try { CBZ.dayPhase(phase); } catch (_) {}
  hidePlayerPresentation();
  aim();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  tick(2);
  aim();

  // dialogue subtitles and toasts are created AFTER boot, so the strip is
  // re-hidden on every plate, not once
  hideHud(S.overlay);
  // an actor who has wandered onto the tripod is a face, not a lighting
  // plate: anyone within 7 m of the camera sits this frame out (both sides
  // apply the same rule, so a stochastic walk cannot fill one side only)
  for (const grp of S.hidden || []) grp.visible = true;
  S.hidden = [];
  for (const pool of [CBZ.cityPeds, CBZ.cityCops, CBZ.npcs, CBZ.guards]) {
    for (const actor of pool || []) {
      const grp = actor && (actor.group || (actor.char && actor.char.group));
      if (!grp || !grp.position || !grp.visible) continue;
      const ddx = grp.position.x - cam.x, ddz = grp.position.z - cam.z;
      if (ddx * ddx + ddz * ddz < 49) { grp.visible = false; S.hidden.push(grp); }
    }
  }

  // ---- the census -----------------------------------------------------
  CBZ.renderer.render(CBZ.scene, camera);
  let meanLum = 0, skyLum = 0, groundLum = 0, darkFrac = 0, litFrac = 0;
  try {
    const gl = CBZ.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // readPixels rows run bottom → top
    const skyRow0 = Math.floor(H * 0.88), gndRow1 = Math.floor(H * 0.30);
    let sum = 0, sSum = 0, sN = 0, gSum = 0, gN = 0, dark = 0, lit = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const l = px[i] * 0.30 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
        sum += l;
        if (l < 20) dark++;
        if (l > 96) lit++;
        if (y >= skyRow0) { sSum += l; sN++; }
        if (y < gndRow1) { gSum += l; gN++; }
      }
    }
    const N = W * H;
    meanLum = sum / N; skyLum = sSum / sN; groundLum = gSum / gN;
    darkFrac = dark / N * 100; litFrac = lit / N * 100;
  } catch (_) {}

  const round = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const metrics = {
    hour: subject.hour,
    clockHour: round(((CBZ.dayPhase() * 24 + 6) % 24), 2),
    sunHeight: round(CBZ.sunHeight != null ? CBZ.sunHeight : 0, 3),
    nightDepth: round(CBZ.nightDepth || 0, 3),
    sunIntensity: round(CBZ.sun ? CBZ.sun.intensity : 0, 3),
    ambientIntensity: round(CBZ.hemi ? CBZ.hemi.intensity : 0, 3),
    bounceIntensity: round(CBZ.bounce ? CBZ.bounce.intensity : 0, 3),
    exposure: round(CBZ.renderer ? CBZ.renderer.toneMappingExposure : 0, 3),
    headlight: round(CBZ.cityHeadlights ? CBZ.cityHeadlights().intensity : 0, 2),
    meanLuminance: round(meanLum, 1),
    skyLuminance: round(skyLum, 1),
    groundLuminance: round(groundLum, 1),
    darkFraction: round(darkFrac, 1),
    litFraction: round(litFrac, 1),
    darkLeak: subject.night ? round(groundLum, 1) : 0,
  };

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  const hh = String(Math.floor(subject.hour)).padStart(2, "0") + ":" + String(Math.round((subject.hour % 1) * 60)).padStart(2, "0");
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#bb4040" : "#17825a"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = hh + " · " + subject.label;
  q("name").style.cssText = "position:absolute;top:66px;left:26px;font-size:25px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;top:102px;left:27px;color:#d0dbe3;font-size:12px;font-weight:600;max-width:790px;line-height:1.4";
  q("stat").textContent = `night ${metrics.nightDepth.toFixed(2)} · sun ${metrics.sunIntensity.toFixed(3)} · ambient ${metrics.ambientIntensity.toFixed(3)} · exposure ${metrics.exposure.toFixed(2)} · frame ${metrics.meanLuminance.toFixed(1)} · sky ${metrics.skyLuminance.toFixed(1)} · ground ${metrics.groundLuminance.toFixed(1)} · black ${metrics.darkFraction.toFixed(0)}%`;
  q("stat").style.cssText = "position:absolute;bottom:37px;left:26px;padding:4px 8px;border-radius:4px;background:rgba(0,0,0,.55);color:#eef4f8;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  q("source").style.cssText = "position:absolute;bottom:13px;left:26px;padding:2px 8px;border-radius:4px;background:rgba(0,0,0,.45);color:#a9bac7;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return { ok: true, camera: cam, metrics };
}

/* THE CLOCK STRIP — the same eight beats for every place, so a page of the
   report reads as one day. night:true marks the beats past astronomical
   dusk, where the ground is expected to be black. */
export const HOURS = [
  { hour: 12,   tag: "noon",     night: false, why: "the control plate: the day keyframe must not move" },
  { hour: 17.5, tag: "golden",   night: false, why: "low warm sun, long shadows" },
  { hour: 18.5, tag: "civil",    night: false, why: "sun just under — the sky still lights the ground" },
  { hour: 19.5, tag: "dusk-end", night: true,  why: "astronomical dusk: the sky has stopped lighting anything" },
  { hour: 21,   tag: "evening",  night: true,  why: "full night, the fixtures carry everything" },
  { hour: 0,    tag: "midnight", night: true,  why: "the deepest beat" },
  { hour: 3,    tag: "small",    night: true,  why: "3 a.m. — should be indistinguishable from midnight" },
  { hour: 5.5,  tag: "predawn",  night: false, why: "the sky returns before the sun does" },
];

export function subjectsFor(mode, places) {
  const out = [];
  for (const p of places) {
    for (const h of HOURS) {
      out.push({
        id: `${p.place}-${h.tag}`,
        label: p.label,
        focus: `${p.focus} ${h.why}.`,
        mode, place: p.place, hour: h.hour, night: h.night,
      });
    }
  }
  return out;
}

export const METRICS = {
  hour: { label: "Clock asked", unit: "h" },
  clockHour: { label: "Clock at the shutter", unit: "h" },
  sunHeight: { label: "Sun height (sin, signed)" },
  nightDepth: { label: "Night depth (0 sunset → 1 astronomical dark)" },
  sunIntensity: { label: "Key light intensity" },
  ambientIntensity: { label: "Hemisphere intensity" },
  bounceIntensity: { label: "Bounce fill intensity" },
  exposure: { label: "Tone-map exposure" },
  headlight: { label: "Player headlight intensity" },
  meanLuminance: { label: "Frame mean", unit: "0-255" },
  skyLuminance: { label: "Sky band mean (top 12%)", unit: "0-255" },
  groundLuminance: { label: "Ground band mean (bottom 30%)", unit: "0-255" },
  darkFraction: { label: "Pixels under 20/255", unit: "%" },
  litFraction: { label: "Pixels over 96/255", unit: "%" },
  darkLeak: { label: "Night-plate ground brightness", unit: "0-255", better: "lower" },
};

export const METRICS_NOTE = "Every number is read off the real framebuffer after the real render at the locked tripod. Sky band = top 12% of rows, ground band = bottom 30%. darkLeak is groundLuminance on the plates marked night (19:30 → 03:00) and 0 elsewhere — the one direction the verdict gates on, because a brighter noon is not a regression and a brighter midnight is.";
