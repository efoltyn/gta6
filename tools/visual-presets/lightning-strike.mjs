/* LIGHTNING STRIKE storyboard for tools/visual-compare.mjs.

   THE COMPLAINT: "lightning currently looks like an RPG on impact." It did.
   systems/disasters.js fired its ground strike through the impact bus's
   `kinetic` row, `kinetic` names no FX composer, and the fallback composer is
   cityAirstrikeExplosion — so every bolt landed as an orange fireball with a
   smoke column and a debris ejecta cone. The bolt above it was a
   BoxGeometry(0.5, 40, 0.5): a white fence post, dead straight, one frame long.

   Photographing that is the whole problem: a strike is over in a sixth of a
   second and lands wherever the director felt like. So this preset does not
   guess. Both builds telegraph a strike with the SAME unchanged call —
   CBZ.fx.groundMarker(x, z, 4.5, 0x9fd0ff) — which puts a uniquely
   fingerprintable mesh in the scene ~0.95 s before the bolt: a CircleGeometry
   of radius exactly 4.5 in that exact colour. The stage function finds it,
   reads WHERE the bolt is going to land off its position, then steps the sim
   one 60 Hz frame at a time until that marker is disposed. That frame is the
   strike, on both builds, to the frame — and every subject below is pinned to
   an offset from it in frames, not in "however long the last subject ran".

   The camera is solved off the marker, so it is looking at the actual bolt
   rather than at a coordinate that used to work — and the stand-off angle is
   SEARCHED rather than typed, because a bolt is free to come down directly
   behind a tower block and the first pass of this preset duly photographed a
   wall.

   HONEST LIMIT: systems/disasters.js picks strike positions with Math.random,
   not the seeded stream, so the two sides cannot be made to photograph the
   same bolt in the same place — only the same MOMENT of an equivalent one.
   Every frame is therefore matched on timing and framing rule, not on
   coordinates, and each side's `note` prints the position it actually got.

     telegraph     the ring on the wet ground, ~0.3 s before the bolt.
     contact       THE shot. The strike frame itself, from street level.
                   Before: a fireball. After: a forked channel into a
                   white-hot contact point.
     wide          the same frame from 60 m back — the whole channel, its
                   forks dying in the air, and how much of the sky it lights.
     flashover     +90 ms. Surface arcs crawling out across the ground and
                   sparks still climbing. Before: smoke.
     restrike      +190 ms. A LATER RETURN STROKE. The old bolt does not have
                   one — it was a single frame — and this frame is where that
                   difference is most obvious: after is still flashing.
     aftermath     +1.2 s. Steam off wet ground and a cooling burn scar.
                   Before: a fireball's black smoke column and scattered rubble.
     scars         +6 s, wide. The burn stars the storm has cut into the ground.
                   Before: nothing stays at all.

   Nothing here is injected: the after-side reads whatever index.html loaded.
   A before-side without src/systems/lightningfx.js simply reports boltFxV2
   false and photographs the fireball, which is exactly the comparison wanted. */

const subjects = [
  { id: "telegraph", label: "The telegraph", atFrames: -18,
    focus: "The strike marker on wet ground about a third of a second before the bolt. Unchanged by this work and shot deliberately: it is the shared clock both builds are photographed against, and it proves the two frames below are the same moment of the same event.",
    cam: { back: 13, up: 5.5, look: 0.4 } },

  { id: "contact", label: "The strike frame", atFrames: 0,
    focus: "The frame the bolt arrives, from street level. BEFORE: cityAirstrikeExplosion — an orange chemical fireball with an ejecta cone, plus a straight white post 0.5 m square. AFTER: a forked channel with a blue sheath running into a white-hot contact point, a thin ring of light on the ground, and no fire anywhere, because there is nothing at a lightning strike to burn.",
    cam: { back: 26, up: 9, look: 6 } },

  { id: "wide", label: "The channel, whole", atFrames: 1,
    focus: "One frame later from sixty metres back. The bolt is the subject now rather than the impact: midpoint-displaced channel from the cloud base with forks that die in the air, fading into the cloud instead of ending on a hard cap. The old bolt is 40 m of straight box and stops dead at both ends.",
    cam: { back: 60, up: 26, look: 22 } },

  { id: "flashover", label: "Flashover, +90 ms", atFrames: 5,
    focus: "Surface arcs crawling radially out from the contact point, sparks still climbing. This is the cue that reads as ELECTRICITY in a single frame and that no explosion can borrow — the before-side is showing expanding smoke here.",
    cam: { back: 14, up: 4.2, look: 1.4 } },

  { id: "restrike", label: "A return stroke, +190 ms", atFrames: 11,
    focus: "The sharpest difference in the set. A real flash is three to five RETURN STROKES down the same channel over about 200 ms, which is why lightning strobes instead of fading — so the after-side is flashing again here, off a re-jittered channel, and the world's hemi/sun bump is pulsing with it. The before-side bolt stopped existing 130 ms ago; all that is left is fireball smoke.",
    cam: { back: 22, up: 8, look: 6 } },

  { id: "aftermath", label: "Aftermath, +1.2 s", atFrames: 72,
    focus: "What the strike LEAVES. After: pale steam boiling off ground that a storm has soaked, and a fulgurite burn scorched into the turf whose rim is still cooling orange. Before: a petrol-black smoke column and blast rubble, from a warhead that was never there.",
    cam: { back: 9, up: 3.4, look: 0.6 } },

  { id: "scars", label: "What the storm wrote", atFrames: 360,
    focus: "Six seconds and several strikes later, from above. The ground now carries the storm's history — a burn star at every place a bolt came down. The before-side keeps nothing: its fireballs cleaned up after themselves and the arena is exactly as it started.",
    cam: { top: true, back: 26, up: 55 } },
];

async function stageLightning(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
      if (child.id === "__boltOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__boltSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") return { ok: false, err: "no CBZ.disasters.force" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // freeze the page's own clock; from here the sim only advances when this
    // preset says so, which is what makes "+11 frames" mean the same thing on
    // a fast build and a slow one
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__boltOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__boltSeq = { overlay, frames: 0, strikeFrame: null, hit: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.stamina != null) CBZ.player.stamina = 100;
  };
  const step1 = () => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    const t0 = performance.now();
    CBZ.stepSim(1 / 60);
    const ms = performance.now() - t0;
    ticks++; totalMs += ms; if (ms > maxMs) maxMs = ms; if (ms > 33) over33++;
    S.frames++;
    heal();
  };
  const step = (n) => { for (let i = 0; i < n; i++) step1(); };

  /* THE SHARED FINGERPRINT. Both builds telegraph with the identical
     unchanged call CBZ.fx.groundMarker(x, z, 4.5, 0x9fd0ff) — the only
     CircleGeometry of radius 4.5 in that colour anywhere in the scene. Finding
     it is how this preset knows where a bolt is about to land WITHOUT either
     build having to export a test hook the other one lacks. Several are alive
     at once (the storm schedules faster than the 0.95 s telegraph runs), so
     what is tracked is the ONE object that was not there a frame ago. */
  const MARKER_FRAMES = 57;   // 0.95 s of telegraph at 60 Hz — see DEFS.storm
  const markerSet = () => {
    const out = [];
    CBZ.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.material) return;
      const p = o.geometry.parameters;
      if (!p || o.geometry.type !== "CircleGeometry") return;
      if (!(Math.abs((p.radius || 0) - 4.5) < 0.01)) return;
      if (!o.material.color || o.material.color.getHex() !== 0x9fd0ff) return;
      out.push(o);
    });
    return out;
  };

  /* IS THERE ANY ANGLE FROM WHICH YOU CAN SEE THIS BOLT? The strike point is
     chosen with Math.random and is free to land behind a tower block, which is
     what the first pass of this preset photographed — a wall. So the stand-off
     bearing is SEARCHED, and it is searched with a real raycast against the
     whole scene rather than against the arena's `fragile` list, because that
     list is only the collapsible buildings: the shopfront that actually blocked
     the shot was not in it. Additive FX and the crowd are ignored — a bolt seen
     past a pedestrian is not an obstructed bolt.

     Returns the winning bearing, or null if the bolt is boxed in from every
     side, which is the caller's cue to wait for a different strike. */
  const A = (CBZ.SURV && CBZ.SURV.arena) || { cx: 0, cz: 600, r: 120 };
  /* THREE.Sprite.raycast dereferences `raycaster.camera`, and a Raycaster
     built by hand has none — so intersectObjects THREW on the first sprite in
     the scene. The first version of this caught that and treated the throw as
     "nothing in the way", which quietly turned the whole search into a no-op
     and photographed a tower block twice. Handing it the camera is the fix;
     the fragile-footprint fallback below is what runs if it ever throws again,
     because silently reporting "clear" is the one answer that must not happen. */
  const ray = new T.Raycaster();
  ray.far = 400;
  ray.camera = CBZ.camera;
  const SWINGS = [0.7, -0.7, 1.5, -1.5, 2.4, -2.4, 3.14, 0.25, -0.25];
  const solveSwing = (hx, hz, back, up) => {
    const gy0 = CBZ.floorAt ? CBZ.floorAt(hx, hz) : 0;
    let ox = hx - A.cx, oz = hz - A.cz;
    const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
    // Test the WHOLE channel, not just its foot: the bolt is 60 m tall and
    // leans, so a line that clears the contact point can still have a
    // shopfront standing in front of everything above it.
    const AIMS = [gy0 + 1.2, gy0 + 5, gy0 + 20, gy0 + 44];
    const aim = new T.Vector3();
    const eye = new T.Vector3();
    const dir = new T.Vector3();
    for (let i = 0; i < SWINGS.length; i++) {
      const sw = SWINGS[i];
      const rx = ox * Math.cos(sw) - oz * Math.sin(sw);
      const rz = ox * Math.sin(sw) + oz * Math.cos(sw);
      const ex = hx + rx * back, ez = hz + rz * back;
      let ey = gy0 + up;
      try { const g = CBZ.floorAt ? CBZ.floorAt(ex, ez) : 0; if (ey < g + 1.8) ey = g + 1.8; } catch (_) {}
      eye.set(ex, ey, ez);
      let blocked = false;
      for (let a = 0; a < AIMS.length && !blocked; a++) {
        aim.set(hx, AIMS[a], hz);
        dir.copy(aim).sub(eye);
        const dist = dir.length();
        ray.set(eye, dir.normalize());
        let hits = null;
        try { hits = ray.intersectObjects(CBZ.scene.children, true); } catch (_) { hits = null; }
        if (hits) {
          for (let k = 0; k < hits.length; k++) {
            const h = hits[k];
            if (h.distance > dist - 1.5) break;
            const o = h.object, m = o.material;
            if (!o.visible || o.isPoints || o.isLine || o.isSprite) continue;
            if (m && (m.blending === T.AdditiveBlending || (m.transparent && m.opacity < 0.35))) continue;
            if (o.userData && o.userData.isChar) continue;
            blocked = true; break;
          }
        } else {
          // fallback: the collapsible buildings' footprints. Coarser than the
          // raycast (it does not know about terrain or the scenery meshes) but
          // it is an answer, and a wrong "blocked" only costs a swing.
          const arena = CBZ.surv && CBZ.surv.arena;
          const frag = ((arena && arena.fragile) || []).filter((b) => !b.fallen);
          for (let s2 = 1; s2 <= 14 && !blocked; s2++) {
            const t = s2 / 15;
            const px = eye.x + (aim.x - eye.x) * t, pz = eye.z + (aim.z - eye.z) * t;
            const py = eye.y + (aim.y - eye.y) * t;
            for (let i = 0; i < frag.length; i++) {
              const b = frag[i];
              if (py > (b.gy || 0) + b.h) continue;
              if (Math.abs(px - b.x) < b.w * 0.5 + 0.6 && Math.abs(pz - b.z) < b.d * 0.5 + 0.6) { blocked = true; break; }
            }
          }
        }
      }
      if (!blocked) return { sw, ex, ey, ez };
    }
    return null;
  };

  // ---- arm: force the storm and take hold of one PHOTOGENIC telegraph -----
  const armStrike = () => {
    if (CBZ.disasters.current() !== "LIGHTNING STORM" || CBZ.disasters.state() !== "active") {
      CBZ.disasters.force("storm"); step(6);
      let guard = 600;
      while (guard-- > 0 && CBZ.disasters.state() !== "active") step(6);
    }
    // A storm throws a bolt roughly every second, so there is no reason to
    // photograph one that cannot be seen: skip past boxed-in strikes and take
    // the first with a clear line. Tries are bounded, and the last candidate is
    // used regardless so a frame always comes back.
    let seen = new Set(markerSet());
    let fresh = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      fresh = null;
      let guard = 900;
      while (guard-- > 0 && !fresh) {
        step1();
        const now = markerSet();
        for (let i = 0; i < now.length; i++) if (!seen.has(now[i])) { fresh = now[i]; break; }
      }
      if (!fresh) break;
      if (solveSwing(fresh.position.x, fresh.position.z, 24, 8)) break;
      seen = new Set(markerSet());   // boxed in — wait for the next one
    }
    if (!fresh) return false;
    S.marker = fresh;
    S.markerFrame = S.frames;      // this telegraph is ~0 frames old
    S.strikeFrame = null;          // not measured yet; predicted at +57
    S.hit = { x: fresh.position.x, z: fresh.position.z };
    return true;
  };

  // Where we are relative to the bolt. Before it lands the position is
  // PREDICTED off the telegraph's fixed length; after it lands it is the
  // measured frame, because the marker's disposal IS the strike.
  const posNow = () => {
    if (S.strikeFrame != null) return S.frames - S.strikeFrame;
    if (S.markerFrame != null) return S.frames - (S.markerFrame + MARKER_FRAMES);
    return null;
  };

  const seekTo = (want) => {
    if (want < 0) {
      let guard = 200;
      while (guard-- > 0 && S.marker && S.marker.parent && posNow() < want) step1();
      return;
    }
    if (S.strikeFrame == null) {
      let guard = 250;
      while (guard-- > 0 && S.marker && S.marker.parent) step1();
      S.strikeFrame = S.frames;    // measured, to the frame, on both builds
    }
    const d = want - (S.frames - S.strikeFrame);
    if (d > 0) step(d);
  };

  const subject = input.subject;
  const want = subject.atFrames || 0;
  // ORDER-INDEPENDENCE: a `--subjects` subset must land on the same moment as
  // the full storyboard, so re-arm whenever the requested offset is behind us.
  const at = posNow();
  if (at == null || at > want || (want < 0 && !(S.marker && S.marker.parent))) {
    if (!armStrike()) return { ok: false, err: "no strike telegraph found" };
  }
  seekTo(want);

  // ---- camera, solved onto the bolt --------------------------------------
  const hit = S.hit || { x: A.cx, z: A.cz, y: 0 };
  const gy = CBZ.floorAt ? CBZ.floorAt(hit.x, hit.z) : 0;
  const cam = subject.cam || {};
  let camClear = false;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.4; camera.far = 20000;

  if (cam.top) {
    /* The "what the storm wrote" plate is shot STEEPLY down rather than from a
       standing-off angle, because the subject is the ground itself: from 55 m
       up, directly over the last strike, a neighbouring tower can be in frame
       but cannot get between the lens and the burns. (The first version used a
       34 m stand-off and photographed the side of one.) */
    camera.position.set(hit.x + cam.back * 0.22, gy + cam.up, hit.z + cam.back * 0.22);
    camera.lookAt(hit.x, gy, hit.z);
  } else {
    // STAND WHERE THE BOLT IS ACTUALLY VISIBLE — same solver the arming step
    // used to pick this strike in the first place, now run at this subject's
    // own stand-off. Falls back to the nominal bearing and says so in the note.
    const solved = solveSwing(hit.x, hit.z, cam.back, cam.up);
    camClear = !!solved;
    let eye = solved;
    if (!eye) {
      let ox = hit.x - A.cx, oz = hit.z - A.cz;
      const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      const sw = 0.7;
      const rx = ox * Math.cos(sw) - oz * Math.sin(sw);
      const rz = ox * Math.sin(sw) + oz * Math.cos(sw);
      eye = { ex: hit.x + rx * cam.back, ey: gy + cam.up, ez: hit.z + rz * cam.back };
    }
    camera.position.set(eye.ex, eye.ey, eye.ez);
    camera.lookAt(hit.x, gy + (cam.look != null ? cam.look : 1.5), hit.z);
  }
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const da = (typeof CBZ.disasterAudit === "function") ? CBZ.disasterAudit() : {};
  const strikes = Number(da.boltStrikes || 0);
  const strokes = Number(da.boltStrokes || 0);

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  q("focus").textContent =
    `${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()} · strike ${want >= 0 ? "+" : ""}${want} frames` +
    (da.boltFxV2 ? "" : " · NO BOLT RENDERER");
  q("focus").style.cssText = "position:absolute;top:250px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:380px";
  q("perf").textContent =
    `strikes ${strikes} · strokes ${strokes} · per flash ${strikes ? (strokes / strikes).toFixed(1) : "0.0"}\n` +
    `scars ${Number(da.boltScars || 0)} · live bolts ${Number(da.boltLive || 0)}\n` +
    `draws ${render.calls || 0} · tris ${render.triangles || 0}\n` +
    `sim ${ticks} ticks · avg ${(ticks ? totalMs / ticks : 0).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms`;
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;white-space:pre;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    boltFxV2: da.boltFxV2 ? 1 : 0,
    strikes: strikes,
    strokes: strokes,
    strokesPerFlash: strikes ? Number((strokes / strikes).toFixed(2)) : 0,
    scars: Number(da.boltScars || 0),
    drawCalls: Number(render.calls || 0),
    triangles: Number(render.triangles || 0),
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
  };

  return { ok: true, disaster: CBZ.disasters.current(), state: CBZ.disasters.state(),
    note: `hit ${hit.x.toFixed(1)}, ${hit.z.toFixed(1)} · +${want}f · eye ${camera.position.x.toFixed(0)},${camera.position.y.toFixed(0)},${camera.position.z.toFixed(0)}${cam.top || camClear ? "" : " · no clear angle"}`, metrics };
}

export default {
  id: "lightning-strike",
  title: "Lightning that looks like lightning",
  description: "One seeded survival match per build, the director forced to the lightning storm, and both builds stepped to the exact 60 Hz frame a bolt lands — found by fingerprinting the strike telegraph that neither build changed. BEFORE: the strike ran through the impact bus's `kinetic` row, which names no FX composer and therefore fell through to cityAirstrikeExplosion — an orange chemical fireball with a smoke column and a debris ejecta cone, under a 0.5 m square white box 40 m tall. An RPG. AFTER: a forked, midpoint-displaced channel with a blue sheath and three-to-five RETURN STROKES that make the flash strobe; ground flashover crawling out from the contact; a ring of light instead of a shock front; sparks and pale steam off soaked ground instead of fire; and a fulgurite burn star scorched into the turf that cools white to orange to black and stays there.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "Counts come from CBZ.disasterAudit(), which reads systems/lightningfx.js's own ratchet. strokesPerFlash is the one-number version of the whole change: the old strike drew ONE flat frame per bolt, so a build without the renderer reports 0 strokes and boltFxV2 0; a real cloud-to-ground flash is 3-5 return strokes. scars counts fulgurite burns cut into the ground — the before-side leaves nothing behind at all.",
  metrics: {
    boltFxV2: { label: "Bolt renderer present", better: "higher" },
    strikes: { label: "Ground strikes", better: "higher" },
    strokes: { label: "Return strokes drawn", better: "higher" },
    strokesPerFlash: { label: "Strokes per flash", better: "higher" },
    scars: { label: "Burn scars cut", better: "higher" },
    drawCalls: { label: "Draw calls", better: "lower" },
    triangles: { label: "Triangles", better: "lower" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
  },
  subjects,
  stage: stageLightning,
};
