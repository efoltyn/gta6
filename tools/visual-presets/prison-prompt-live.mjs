/* prison-prompt-live.mjs — is the pinned prompt where the door is, LIVE?

   OWNER (2026-09-05): "the close that is supposed to show on the cell door is
   nowhere close to the cell door."

   prison-prompts.mjs photographs one frozen pose and measured 9 px. That is
   the sim stepped by hand with a still camera. This preset keeps the REAL
   loop running (no rAF stub), walks the player around his open cell door and
   turns the camera through a full circle, and on EVERY frame compares where
   systems/interactions.js put the label against a fresh projection of the
   door point (camera.matrixWorld recomputed here, not the one the renderer
   left behind last frame). It reports the distribution, the worst pose, how
   often the label was edge-clamped or hidden, and which door the verb was
   about — the player's own or a neighbour's. The final frame is re-posed to
   the worst sample so the picture shows the failure, not the average.

   Staging facts: escape mode via [data-mode="escape"] + #playBtn; the
   player's cell is CBZ.cellblock.cells[i].player; camera.js drives
   CBZ.camera from CBZ.cam.yaw/pitch at always-order 50; the label is
   #prisonPrompts .wprompt (left/top px, translate(-50%,-100%)).
*/

export default {
  id: "prison-prompt-live",
  title: "Prison — the door prompt under the live loop",
  description: "Walk and turn around an open cell door with the real render loop running; measure label-vs-door every frame.",
  subjects: [{ id: "cell-door-live", label: "Your cell door — Close, live", focus: "Worst pose of a 12 s live walk-and-turn. Is the label on the leaf?" }],
  frameList: ["laptop:landscape"],
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  beforeLabel: "BEFORE", afterLabel: "AFTER · LOCAL",
  defaultFocus: "Is the verb on the door it is about?",
  metrics: {
    samples: { label: "Frames sampled", unit: "frames", better: "higher" },
    shownFrac: { label: "Frames a Close prompt was up", unit: "%", better: "higher" },
    medianPx: { label: "Median label-to-door distance", unit: "px", better: "lower" },
    p90Px: { label: "90th percentile label-to-door distance", unit: "px", better: "lower" },
    worstPx: { label: "Worst label-to-door distance", unit: "px", better: "lower" },
    clampedFrac: { label: "Frames the label was edge-clamped", unit: "%", better: "lower" },
    otherDoorFrac: { label: "Frames the verb was about a NEIGHBOUR's door", unit: "%", better: "lower" },
    staleFrac: { label: "Frames a label was up with NO door qualifying (tail)", unit: "%", better: "lower" },
    hiddenOnScreenFrac: { label: "Frames a door qualified, was on screen, and no label showed", unit: "%", better: "lower" },
  },

  stage: async function stagePrisonPromptLive(input) {
    const CBZ = window.CBZ, T = window.THREE;
    if (!CBZ || !T) return { ok: false, err: "no CBZ/THREE" };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) { try { if (test()) return true; } catch (_) {} await wait(stepMs || 250); }
      return false;
    };
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") && document.querySelector('[data-mode="escape"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="escape"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    await wait(1500);
    for (const id of ["bootload", "fade", "loading"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }

    const P = CBZ.player;
    const cells = (CBZ.cellblock && CBZ.cellblock.cells) || [];
    let c = null;
    for (const cc of cells) if (cc.player && !cc.tier) { c = cc; break; }
    if (!c) for (const cc of cells) if (!cc.tier && cc.leafClosed) { c = cc; break; }
    if (!c) return { ok: false, err: "no cell" };
    const myId = "prison-cell-" + c.i;
    const leaf = { x: c.leafClosed.x, y: 1.4 + (c.fy || 0), z: c.leafClosed.z };
    // the cell interior is on the far side of the leaf from the aisle; try both
    // sides: whichever side has the bunk (c.x, c.z is the cell centre)
    const inward = { x: c.x - leaf.x, z: c.z - leaf.z };
    const il = Math.hypot(inward.x, inward.z) || 1; inward.x /= il; inward.z /= il;
    // open it and keep it open
    const specOf = (id) => { const L = CBZ.prisonDoorList ? CBZ.prisonDoorList() : []; for (const s of L) if (s.id === id) return s; return null; };
    const mine = specOf(myId);
    if (mine) { try { mine.set(true); } catch (_) {} }

    // ---- the live sampler: every frame, after the prompt is placed ----------
    const inv = new T.Matrix4(), v = new T.Vector3();
    const samples = [];
    let worst = null;
    const sampler = function () {
      const cam = CBZ.camera; if (!cam) return;
      const wrap = document.querySelector("#prisonPrompts .wprompt");
      const shown = !!(wrap && wrap.style.display !== "none" && wrap.style.visibility !== "hidden" && document.getElementById("prisonPrompts").classList.contains("on"));
      const text = wrap ? (wrap.innerText || "").replace(/\s+/g, " ").trim() : "";
      // FRESH projection: recompute the camera's world matrix and invert it
      // ourselves, so the comparison does not inherit the renderer's lag.
      cam.updateMatrixWorld(true);
      inv.copy(cam.matrixWorld).invert();
      // which door is the verb about? the same query the key path runs
      const s = CBZ.prisonDoorNearest ? null : null;
      let about = null;
      try {
        // replicate nearestDoor(true, 2.6, facing) through the public list
        const L = CBZ.prisonDoorList ? CBZ.prisonDoorList() : [];
        let bd = 2.6 * 2.6; const yaw = CBZ.cam ? CBZ.cam.yaw : 0; const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        for (const d of L) {
          let open = false, gone = true, can = false; try { open = !!d.isOpen(); gone = !!(d.permanent && d.permanent()); can = !!d.canUse(); } catch (_) {}
          if (!open || gone || !can) continue;
          const p = d.at(); const dx = p.x - P.pos.x, dz = p.z - P.pos.z; const d2 = dx * dx + dz * dz; if (d2 >= bd) continue;
          const len = Math.hypot(dx, dz) || 1; if ((dx / len) * fx + (dz / len) * fz < 0.35) continue;
          bd = d2; about = d;
        }
      } catch (_) {}
      const pt = about ? about.at() : leaf;
      v.set(pt.x, pt.y, pt.z).applyMatrix4(inv).applyMatrix4(cam.projectionMatrix);
      const behind = v.z > 1;
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const onScreen = !behind && v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1;
      let px = null, lx = null, ly = null;
      if (shown && wrap) { const r = wrap.getBoundingClientRect(); lx = r.left + r.width / 2; ly = r.bottom; px = Math.hypot(lx - sx, ly - sy); }
      const clamped = shown && (Math.abs(v.x) > 0.88 || Math.abs(v.y) > 0.82);
      const rec = { t: performance.now(), shown, text, px: px == null ? null : Math.round(px), lx: lx && Math.round(lx), ly: ly && Math.round(ly), sx: Math.round(sx), sy: Math.round(sy), behind, onScreen, clamped, about: about ? about.id : null,
        cam: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)], yaw: +((CBZ.cam && CBZ.cam.yaw) || 0).toFixed(2), pitch: +((CBZ.cam && CBZ.cam.pitch) || 0).toFixed(2),
        pos: [+P.pos.x.toFixed(2), +P.pos.z.toFixed(2)], camToPt: +Math.hypot(cam.position.x - pt.x, cam.position.y - pt.y, cam.position.z - pt.z).toFixed(2) };
      samples.push(rec);
      if (shown && px != null && (!worst || px > worst.px)) worst = rec;
    };
    CBZ.onAlways(97, sampler);

    // ---- the walk: 12 s of real loop. Positions around the doorway on both
    //      sides, camera yaw sweeping a full turn, pitch nodding. -------------
    const t0 = performance.now();
    const place = (x, z) => { P.pos.x = x; P.pos.z = z; P.vy = 0; if (CBZ.playerChar && CBZ.playerChar.group) { CBZ.playerChar.group.position.x = x; CBZ.playerChar.group.position.z = z; } };
    const DUR = 12000;
    while (performance.now() - t0 < DUR) {
      const u = (performance.now() - t0) / DUR;
      // side: first half inside the cell, second half in the aisle; distance 0.4–1.8 m from the leaf
      const side = u < 0.5 ? 1 : -1;
      const dist = 0.4 + 1.4 * Math.abs(Math.sin(u * Math.PI * 4));
      const lateral = 0.6 * Math.sin(u * Math.PI * 6);
      place(leaf.x + inward.x * side * dist - inward.z * lateral, leaf.z + inward.z * side * dist + inward.x * lateral);
      if (CBZ.cam) { CBZ.cam.yaw = u * Math.PI * 4; CBZ.cam.pitch = 0.35 * Math.sin(u * Math.PI * 5); }
      await wait(40);
    }
    CBZ.always.splice(CBZ.always.findIndex((a) => a.fn === sampler), 1);

    // ---- numbers ---------------------------------------------------------
    const shownS = samples.filter((s) => s.shown && s.px != null);
    const pxs = shownS.map((s) => s.px).sort((a, b) => a - b);
    const q = (f) => pxs.length ? pxs[Math.min(pxs.length - 1, Math.floor(f * pxs.length))] : 0;
    const pct = (n, d) => d ? Math.round(100 * n / d) : 0;
    const otherDoor = shownS.filter((s) => s.about && s.about !== myId).length;
    const clampedN = shownS.filter((s) => s.clamped).length;
    // frames where a Close SHOULD be up (a door qualifies) but nothing was shown
    const missing = samples.filter((s) => s.about && !s.shown).length;
    const stale = samples.filter((s) => s.shown && !s.about).length;
    const hiddenOn = samples.filter((s) => s.about && s.onScreen && !s.shown).length;

    // ---- re-pose to the worst sample for the picture -------------------------
    if (worst) {
      place(worst.pos[0], worst.pos[1]);
      if (CBZ.cam) { CBZ.cam.yaw = worst.yaw; CBZ.cam.pitch = worst.pitch; }
      await wait(400);
    }
    window.requestAnimationFrame = function () { return 0; };
    await wait(1200);
    for (let i = 0; i < 6; i++) CBZ.stepSim(1 / 60);
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };

    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;top:22px;left:26px;z-index:2147483647;color:#f4f8fb;text-shadow:0 2px 9px #000;font:12px ui-monospace,Menlo,monospace;pointer-events:none;white-space:pre";
    ov.textContent = "LIVE worst pose · label→door " + (worst ? worst.px : "-") + " px · median " + q(0.5) + " · p90 " + q(0.9) + " · clamped " + pct(clampedN, shownS.length) + "% · other door " + pct(otherDoor, shownS.length) + "%";
    document.body.appendChild(ov);

    return {
      ok: true, myCell: myId, leaf, near: CBZ.camera.near, fov: CBZ.camera.fov,
      worst, missingWhileQualified: missing,
      top5: shownS.slice().sort((a, b) => b.px - a.px).slice(0, 5),
      sample10: samples.filter((_, i) => i % Math.max(1, Math.floor(samples.length / 10)) === 0),
      metrics: {
        samples: samples.length,
        shownFrac: pct(shownS.length, samples.length),
        medianPx: q(0.5), p90Px: q(0.9), worstPx: worst ? worst.px : 0,
        clampedFrac: pct(clampedN, shownS.length),
        otherDoorFrac: pct(otherDoor, shownS.length),
        staleFrac: pct(stale, samples.length),
        hiddenOnScreenFrac: pct(hiddenOn, samples.length),
      },
    };
  },
};
