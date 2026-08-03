/* B-2 pilot spawn storyboard for tools/visual-compare.mjs.

   The pilot origin is the game's headline opening — "you literally start the
   game in air in a B2 bomber" — and it is also the fastest honest probe of
   the whole sky system: at 1,750 m the camera is ABOVE the r=850 sky dome
   (core/sky.js pins its rig to y=0), so the deployed build shows a black
   void above the horizon, a painted-band horizon on the water, and a sun
   disc that sits far below the aircraft. Each subject frames one of those
   symptoms from the real spawned aircraft.

   Staging: boots the full city world (seed pinned), clicks through the title
   screen, freezes the rAF loop, then drives everything with CBZ.stepSim so
   both sides sample identical simulated seconds. The B-2 is spawned through
   the SAME call the pilot origin uses (CBZ.cityAirborneStart on the parked
   military prop, alt 1750 / speed 150 / heading at the city), so what the
   report shows is what a new pilot character sees on frame one.

   Camera notes:
   - "spawn" renders whatever CBZ.camera the game's own chase camera wrote
     during the settle ticks — the true frame-one view, no posing.
   - Posed subjects only move/aim the camera; fov/near/far stay whatever the
     game set for aircraft so the shot has the real draw distance.
   - After posing, the sky rig must be re-synced by hand because the loop
     that normally does it is frozen. Prefer the explicit seam if a build
     exposes one (CBZ.skySync), else reproduce the historical y=0 follow —
     this is exactly what the deployed build's own frame sync does, so the
     before side shows the shipped behaviour, not a staging artifact. */

const subjects = [
  {
    id: "spawn",
    label: "Pilot origin — frame one",
    focus: "The game's own chase camera at the 1,750 m spawn. Sky above the horizon must be sky, not void; the world below must read as a coastline, not a map screenshot.",
  },
  {
    id: "sky-up",
    label: "Looking up from 1,750 m",
    focus: "Camera pitched 25° above the horizon along the flight path. The upper sky must have real gradient depth at altitude — the deployed build goes black here.",
  },
  {
    id: "horizon-sea",
    label: "The sea horizon from altitude",
    focus: "Level view over open water away from the city. The sea must melt into fog and sky with no painted band, hard seam, or ring — the horizon is the real sea + fog, nothing else.",
  },
  {
    id: "sunrise",
    label: "Sunrise from the cockpit altitude",
    focus: "Day clock set to a just-risen sun, camera aimed at its azimuth. The disc must sit ON the horizon and rise out of it — not glow up from the ground far below the aircraft.",
  },
];

async function stageB2(input) {
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
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__b2Overlay") continue;
      child.style.visibility = "hidden";
    }
  };
  const tick = (dt) => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    CBZ.stepSim(dt == null ? 1 / 60 : dt);
    if (CBZ.player) CBZ.player.hp = 100;
  };
  // The loop that normally syncs the sky rig to the camera is frozen; use the
  // build's explicit seam when it has one, else do what the shipped frame
  // sync does (rig follows the camera at y=0).
  const syncSky = () => {
    if (typeof CBZ.skySync === "function") { CBZ.skySync(); return; }
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(CBZ.camera.position.x, 0, CBZ.camera.position.z);
  };

  let S = window.__b2Spawn;
  if (!S) {
    // ---- one-time: boot the real world and spawn the pilot's B-2 --------
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    // Headless settles into the LOW tier; the owner plays high. Pin it.
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // Freeze the rAF loop — stepSim is the only clock from here on.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);

    // The flyable registry adopts parked props from a deferred pass; step the
    // sim until the plane list is live (origins.js has the same wait).
    let planes = [];
    for (let i = 0; i < 1800; i++) {
      tick();
      planes = CBZ.cityOriginPlanes ? CBZ.cityOriginPlanes() : [];
      if (planes.length) break;
    }
    if (!planes.length) return { ok: false, err: "no flyable aircraft registered" };

    // The B-2 by name, else any fixed-wing — same fallback order as origins.js.
    let choice = null;
    for (const p of planes) {
      if (/b.?2|spirit/i.test(String(p.id) + " " + String(p.name))) { choice = p; break; }
    }
    if (!choice) for (const p of planes) if (p.kind === "plane") { choice = p; break; }
    if (!choice) choice = planes[0];
    const rec = choice.rec;
    if (!rec || !rec.pos) return { ok: false, err: "chosen aircraft has no prop record" };

    const A = (CBZ.city && CBZ.city.arena) || null;
    const tx = (A && A.spawn) ? A.spawn.x : 0, tz = (A && A.spawn) ? A.spawn.z : 0;
    const hdg = Math.atan2(tx - rec.pos.x, tz - rec.pos.z);
    const craft = CBZ.cityAirborneStart(rec, { alt: 1750, speed: 150, heading: hdg });
    if (!craft) return { ok: false, err: "cityAirborneStart returned null" };

    // Let the chase camera, LOD and streaming settle around the airborne
    // craft — this is also what writes the true frame-one CBZ.camera pose.
    for (let i = 0; i < 30; i++) tick();

    const overlay = document.createElement("div");
    overlay.id = "__b2Overlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__b2Spawn = { craft, choice, overlay, cityX: tx, cityZ: tz };
    window.__cbzVisualCompare = {
      render() {
        try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
      },
    };
  }

  const craft = S.craft;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;

  const id = input.subject.id;
  if (id === "spawn") {
    // Two more ticks so the game camera is exactly settled, then render the
    // pose the game itself wrote. Nothing is staged in this frame.
    tick(); tick();
    syncSky();
  } else {
    const p = craft.pos;
    const fwd = { x: Math.sin(craft.heading), z: Math.cos(craft.heading) };
    if (id === "sky-up") {
      camera.position.set(p.x - fwd.x * 30, p.y + 6, p.z - fwd.z * 30);
      const upDist = 900, rise = Math.tan(25 * Math.PI / 180) * upDist;
      camera.lookAt(p.x + fwd.x * upDist, p.y + rise, p.z + fwd.z * upDist);
    } else if (id === "horizon-sea") {
      // FIND THE SEA, don't assume it. "Away from the city" put the camera
      // over farmland and mountains, so the subject photographed a land
      // horizon while its own focus line claimed open water. Sweep azimuths
      // and pick the one carrying the most water between 1.5 and 6 km — the
      // honest way to frame a sea horizon. This only chooses WHERE to look;
      // the horizon it then photographs is untouched.
      let sx, sz;
      if (!S.seaDir) {
        const ax = p.x - S.cityX, az = p.z - S.cityZ;
        const al = Math.max(1e-6, Math.hypot(ax, az));
        let best = { x: ax / al, z: az / al, score: -1 };
        if (typeof CBZ.cityWaterAt === "function") {
          for (let k = 0; k < 48; k++) {
            const th = (k / 48) * Math.PI * 2;
            const dx = Math.sin(th), dz = Math.cos(th);
            let wet = 0, n = 0;
            for (let d = 1500; d <= 6000; d += 250) {
              n++;
              try { if (CBZ.cityWaterAt(p.x + dx * d, p.z + dz * d)) wet++; } catch (_) {}
            }
            const score = n ? wet / n : 0;
            if (score > best.score) best = { x: dx, z: dz, score };
          }
        }
        S.seaDir = best;
      }
      sx = S.seaDir.x; sz = S.seaDir.z;
      camera.position.set(p.x + sx * 90, p.y + 12, p.z + sz * 90);
      camera.lookAt(p.x + sx * 4000, p.y - 300, p.z + sz * 4000);
    } else if (id === "sunrise") {
      // Walk the day clock until the sun sits just above the horizon, letting
      // daynight/sky react through real sim ticks.
      let found = false;
      for (let t = 0; t < 1 && !found; t += 0.004) {
        CBZ.dayPhase(t);
        tick();
        const up = CBZ.sunHeight == null ? 0 : CBZ.sunHeight;
        if (up > 0.03 && up < 0.09) found = true;
      }
      // A few settle ticks so fog lerps and the throttled dome repaint land.
      for (let i = 0; i < 24; i++) tick();
      const a = CBZ.sunAngle == null ? 0.1 : CBZ.sunAngle;
      const sd = { x: Math.cos(a) * 80, y: Math.sin(a) * 95, z: -10 };
      const sl = Math.max(1e-6, Math.hypot(sd.x, sd.y, sd.z));
      // Camera 90 m toward the sun's azimuth, clear of the airframe, aimed
      // just above the horizontal so the disc and the horizon share a frame.
      const hx = sd.x / Math.max(1e-6, Math.hypot(sd.x, sd.z)),
            hz = sd.z / Math.max(1e-6, Math.hypot(sd.x, sd.z));
      camera.position.set(p.x + hx * 90, p.y + 12, p.z + hz * 90);
      camera.lookAt(p.x + (sd.x / sl) * 2000, p.y + Math.max(60, (sd.y / sl) * 2000), p.z + (sd.z / sl) * 2000);
    }
    camera.updateProjectionMatrix();
    syncSky();
  }

  hideHud();
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const info = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = input.subject.label;
  query("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
  query("focus").textContent = input.subject.focus;
  query("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:720px";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    aircraft: String(S.choice.name || S.choice.id),
    alt: Number(craft.pos.y.toFixed(0)),
    sunHeight: CBZ.sunHeight == null ? null : Number(CBZ.sunHeight.toFixed(3)),
    metrics: { drawCalls: Number(info.calls || 0) },
  };
}

export default {
  id: "b2-spawn",
  title: "The B-2 Spawn: Sky, Horizon, Sun",
  description: "The pilot origin's frame-one view, restaged through the real spawn path at 1,750 m on both builds. Four subjects frame the sky above the aircraft, the sea horizon, and a staged sunrise — the three places the current sky system breaks down at altitude.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metrics: {
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageB2,
};
