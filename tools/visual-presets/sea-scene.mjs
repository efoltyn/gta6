/* SEA SCENE — the shark sim's water with things in it.

   Photographs world/sea_scene.js (pier + pilings, swim-zone floats, lifeguard
   tower, mooring field, channel buoys, rock outcrops, sea stack beacon, gulls)
   against the same island without it.

   A/B: both sides are served from ONE checkout. The after side carries
   ?seascene=1; while sea_scene.js has no <script> tag in index.html yet, the
   stage injects it for that side only. Once the tag lands the injection is a
   no-op (CBZ.sharkSeaScene already exists) and the before side needs a HEAD
   worktree on its own port instead:
     ba --preset sea-scene --before http://127.0.0.1:<head-port>/
   HARNESS TRAP: with the tag in index.html and --before local, both sides
   have the scene; the stage then HIDES it on the before side so the pair
   still reads as without/with.

   The eye is pinned (onAlways 51.2, same as island-underwater) to poses
   computed from the island and a FIXED bearing (the pier's), never from
   anything this file builds, so both sides photograph the identical place.

   RUN: node tools/visual-compare.mjs --preset sea-scene --no-open */

const PIER_BEARING = 0.30;   // world/sea_scene.js PIER_BEARING — the only shared fact

// HARNESS TRAP: stage() is serialized into the page, so module constants are
// not reachable there; the bearing rides on each subject.
const subjects = [
  { id: "under-pier", label: "Under The Pier", eye: -1.3, r: 30, lat: -15, lookR: 26, lookLat: 1, lookY: -0.6,
    state: "1.3 m UNDER · LOOKING AT THE PILINGS",
    focus: "From the shark just under the surface: the pier's pilings stand in the blue with a barnacle crust at the tide line and weed below it, braced in X." },
  { id: "surface-pier", label: "At The Surface, Toward The Pier", eye: 0.9, r: 62, lat: -30, lookR: 6, lookLat: 2, lookY: 1.2,
    state: "0.9 m ABOVE · TOWARD THE BEACH",
    focus: "A dorsal fin's view: the swim-zone float line, the lifeguard tower with its flags, the pier running out from the beach." },
  { id: "toward-island", label: "Offshore, Toward The Island", eye: 3.5, r: 120, lat: 30, lookR: 0, lookLat: 0, lookY: 3,
    state: "3.5 m ABOVE · 120 m OUT",
    focus: "From the mooring field: moored balls, the channel buoys, the sea stack and its beacon, the pier and the beach behind." },
  { id: "wide", label: "Wide", eye: 55, r: 175, lat: -40, lookR: 10, lookLat: 30, lookY: -5,
    state: "55 m UP · WIDE",
    focus: "The whole east side of the island: pier, swim zone, outcrops, the stack, mooring field and channel." },
].map((s) => ({ ...s, bearing: PIER_BEARING }));

async function stageSeaScene(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  Math.random = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20260927);
  const wantScene = /[?&]seascene=1/.test(location.search);

  let D = window.__seaScene;
  if (!D) {
    D = window.__seaScene = {
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      async boot() {
        if (wantScene && !CBZ.sharkSeaScene) {
          await new Promise((res) => {
            const s = document.createElement("script");
            s.src = "src/world/sea_scene.js?v=" + Date.now();
            s.onload = res; s.onerror = res;
            document.head.appendChild(s);
          });
        }
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 80 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        try { if (CBZ.dayPhase) CBZ.dayPhase(0.3); } catch (e) {}
        try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
        D._raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => D._raf.call(window, () => res()));
        window.__ssPin = { on: false };
        CBZ.onAlways(51.2, function () {
          const p = window.__ssPin, cam = CBZ.camera;
          if (!p || !p.on || !cam) return;
          if (p.body) {
            const P = CBZ.player, S = CBZ.sharkSim && CBZ.sharkSim.shark;
            if (P && P.pos) { P.pos.x = p.body.x; P.pos.y = p.body.y; P.pos.z = p.body.z; }
            if (S && S.group) S.group.position.set(p.body.x, p.body.y, p.body.z);
            if (S && S.pos) { S.pos.x = p.body.x; S.pos.y = p.body.y; S.pos.z = p.body.z; }
          }
          cam.position.set(p.px, p.py, p.pz);
          cam.up.set(0, 1, 0);
          cam.lookAt(p.tx, p.ty, p.tz);
          cam.updateMatrixWorld(true);
        });
        CBZ.always.sort(function (a, b) { return a.order - b.order; });
        const st = document.createElement("style");
        st.textContent = "#hud,#crosshair,#sharkflash,#sharkhud,#tvAux,#touchpad,#tvRoot,#lockHint{display:none !important}";
        document.head.appendChild(st);
        const ov = document.createElement("div");
        ov.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f9fd;text-shadow:0 2px 10px #00121e;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
        ov.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div>";
        document.body.appendChild(ov);
        D.overlay = ov;
        return true;
      },
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || !a.species || (CBZ.sharkSim && a === CBZ.sharkSim.shark)) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.hunger = 0;
            if (CBZ.predatorDisengage) { try { CBZ.predatorDisengage(a, 120); } catch (e) {} }
          }
        }
        if (CBZ.sharkSim) { const S = CBZ.sharkSim.shark; if (S) S.hp = S.maxHp; CBZ.sharkSim.podT = 120; }
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        await new Promise((res) => D._raf.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
        await new Promise((r) => setTimeout(r, 1200));
      },
    };
  }
  if (!D.booted) {
    D.booted = await D.boot();
    if (!D.booted) return { ok: false, error: "sharksim never armed" };
  }
  D.peace();
  const SS = CBZ.sharkSeaScene;
  // a --before local run with the tag already in index.html: hide it on the before side
  if (SS && SS.group && !wantScene) SS.group.visible = false;

  const A = CBZ.surv.arena;
  const WL = (CBZ.sharkSim && CBZ.sharkSim.waterline) || (A.radius + 12);
  const th = Number(sub.bearing), ux = Math.cos(th), uz = Math.sin(th), vx = -uz, vz = ux;
  const at = (r, l) => ({ x: A.center.x + ux * (WL + r) + vx * l, z: A.center.z + uz * (WL + r) + vz * l });
  const sea = (x, z) => (CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.8);
  const e = at(sub.r, sub.lat), t = at(sub.lookR, sub.lookLat);
  const pin = window.__ssPin;
  pin.on = true;
  pin.px = e.x; pin.pz = e.z; pin.py = sea(e.x, e.z) + sub.eye;
  pin.tx = t.x; pin.tz = t.z; pin.ty = sea(t.x, t.z) + sub.lookY;
  // the ridden shark parked out of the lens's way (behind and below it)
  const bx = e.x + (e.x - t.x) * 0.2, bz = e.z + (e.z - t.z) * 0.2;
  pin.body = { x: bx, y: sea(bx, bz) - 3, z: bz };
  D.sec(1.5);
  if (SS && SS.group && !wantScene) SS.group.visible = false;

  const after = input.side === "after", ov = D.overlay, q = (s) => ov.querySelector(s);
  const side = q("[data-side]");
  side.textContent = after ? input.afterLabel : input.beforeLabel;
  side.style.cssText = `position:absolute;top:20px;left:24px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const name = q("[data-name]"); name.textContent = sub.label;
  name.style.cssText = "position:absolute;top:62px;left:25px;font-size:26px;font-weight:850;letter-spacing:-.025em";
  const foc = q("[data-focus]"); foc.textContent = sub.focus;
  foc.style.cssText = "position:absolute;top:99px;left:26px;color:#c3d7e2;font-size:12.5px;font-weight:550;max-width:760px;line-height:1.36";
  const stt = q("[data-state]"); stt.textContent = sub.state;
  stt.style.cssText = `position:absolute;right:24px;top:23px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;

  await window.__cbzVisualCompare.render();
  const audit = SS && SS.audit ? SS.audit() : null;
  const info = CBZ.renderer.info && CBZ.renderer.info.render;
  // collision seam check: is water AT a piling / the stack navigable for a
  // great-white-sized body? (1 = blocked, as it should be on the after side)
  let blockedPiling = null, blockedStack = null;
  const wf = CBZ.waterField;
  if (wf && wf.isNavigableWater && SS && SS.obstacles && wantScene) {
    const pile = SS.obstacles.find((o) => o.kind === "piling");
    const stack = SS.obstacles.find((o) => o.kind === "stack");
    if (pile) blockedPiling = wf.isNavigableWater(pile.x, pile.z, 1.2) ? 0 : 1;
    if (stack) blockedStack = wf.isNavigableWater(stack.x, stack.z, 1.2) ? 0 : 1;
  }
  return {
    ok: true, side: input.side, subject: sub.id,
    debug: { audit: audit, waterline: WL, cam: [pin.px, pin.py, pin.pz].map((v) => +v.toFixed(1)), pier: SS && SS.pier },
    metrics: {
      sceneDrawCalls: audit && wantScene ? audit.drawCalls : 0,
      frameDrawCalls: info ? info.calls : null,
      blockedPiling: blockedPiling,
      blockedStack: blockedStack,
      moorings: wantScene && CBZ.sharkSeaMoorings ? CBZ.sharkSeaMoorings.length : 0,
    },
  };
}

export default {
  id: "sea-scene",
  title: "Shark Sim — the sea as a place",
  description: "Four pinned frames of the live ?mode=sharksim island, with and without world/sea_scene.js: under the pier, at the surface toward the beach, offshore toward the island, and a wide shot.",
  beforeLabel: "BEFORE · EMPTY SEA",
  afterLabel: "AFTER · SEA SCENE",
  pairNote: "Same seed · same island · same pinned camera · quality tier 3",
  defaultBefore: "local",
  afterParams: { seascene: "1" },
  urlParams: { mode: "sharksim", seed: "90210", bots: "30", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  metrics: {
    sceneDrawCalls: { label: "Meshes the sea scene adds", unit: "" },
    frameDrawCalls: { label: "Draw calls in the frame", unit: "" },
    moorings: { label: "Mooring points published", unit: "" },
    blockedPiling: { label: "Water at a piling refused to a swimmer (1 = solid)", unit: "" },
    blockedStack: { label: "Water at the sea stack refused to a swimmer (1 = solid)", unit: "" },
  },
  subjects,
  stage: stageSeaScene,
};
