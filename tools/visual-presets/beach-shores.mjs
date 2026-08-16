/* BEACH SHORES — the before/after for BEACH_V2 + SURV_BEACH_V2 (2026-08-16).

   "Improve the beach without adding props, in natural disaster and in gang
   city — bigger and more real." This preset photographs exactly that claim,
   in both worlds, in one run:

   · GANG CITY: the south-shore span (100 → 160 m), the sand surface (flat
     one-colour quad → micro-relief + grain mottle + wrack line, all vertex
     colour, zero props), and the swash apron's alongshore resolution.
   · NATURAL DISASTER: the island's coast (8 m painted stripe → 26 m shore
     with a berm, a foreshore that walks into the water, and a LIVE wet
     waterline that the tsunami's drawdown strands).

   FLAG A/B, the honest kind: --before defaults to "local", so BOTH sides are
   THIS checkout and the only difference is ?cfg_BEACH_V2=0&cfg_SURV_BEACH_V2=0
   on the before side — the comparison is the change, not every commit since
   deploy. (Point --before at the deployed URL to compare against production.)

   Staged like tsunami-stages.mjs: boot the real game, kill the rAF loop so
   CBZ.stepSim is the only clock, and render each tripod manually. City
   subjects run first off the plain Play boot; island subjects then switch
   worlds with CBZ.setMode("survival") (synchronous — systems/state.js builds
   the arena inside the call). Both sides run the same seed, the same tripods,
   the same simulated seconds. */

const subjects = [
  {
    id: "city-panorama",
    label: "Gang City — the whole shore",
    focus: "The south seawall opening, end to end. BEFORE: a 100 m amenity strip of one flat colour. AFTER: a 160 m coastline — same palms, same umbrellas, not one prop added; the size and the sand surface are the change.",
    world: "city", settleSecs: 2.5,
    shot: { kind: "city", backZ: 118, alt: 46, aimZ: 18, aimY: 0 },
  },
  {
    id: "city-waterline",
    label: "Gang City — the waterline",
    focus: "Low over the swash, looking down the beach toward the pier. The wet-sand line should read as SURF — arcs and tongues advancing and dying — and the dry sand behind it should carry grain, a damp band, and the high-tide wrack line. Colour and geometry only.",
    world: "city", settleSecs: 2.0,
    shot: { kind: "city-low", atFrac: 0.22, alt: 2.8, backZ: 8 },
  },
  {
    id: "city-backshore",
    label: "Gang City — the dry sand",
    focus: "From the boardwalk line looking seaward. BEFORE: one flat quad in one hex. AFTER: low wind dunes, mottled grain, crests bleaching and hollows shading — a surface, not a paint fill. The activity band by the umbrellas stays flat so towels and loungers still sit true.",
    world: "city", settleSecs: 0.6,
    shot: { kind: "city-back", atFrac: 0.58, alt: 4.6 },
  },
  {
    id: "island-shore",
    label: "Natural Disaster — the island coast",
    focus: "The survival island's south shore. BEFORE: an 8 m sand stripe painted flat at the grass edge. AFTER: a 26 m shore — berm, foreshore, and a waterline that belongs to the sea. The band is walkable the whole way down; what you see is the ground the physics uses.",
    world: "survival", settleSecs: 3.0,
    shot: { kind: "island", alt: 42, back: 128, aimIn: 14 },
  },
  {
    id: "island-waterline",
    label: "Natural Disaster — the walk into the water",
    focus: "Low on the shore, looking along the coast's curve. The profile descends THROUGH the waterline — wadable foreshore, not a cliff with sand painted on it — and the wet band is live: the sea's breathing edge wets it instantly and it dries slowly behind.",
    world: "survival", settleSecs: 2.0,
    shot: { kind: "island-low", theta: 0.85, alt: 3.4, out: 30 },
  },
];

async function stageBeach(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return { ok: false, missing: "CBZ/THREE" };
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
      if (child.id === "__beachOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__beachSeq;
  if (!S) {
    // ---- one-time: boot the real game into city free play ----------------
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(600);
    const overlay = document.createElement("div");
    overlay.id = "__beachOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-facts></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__beachSeq = { overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, window.__beachCam || CBZ.camera); } catch (_) {} },
    };
    for (let i = 0; i < 60; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
  }

  const subject = input.subject;

  // ---- be in the right WORLD (city boots by default; survival is a call) --
  if (subject.world === "survival" && CBZ.game.mode !== "survival") {
    CBZ.setMode("survival");
    const up = await until(() => CBZ.game.mode === "survival" && CBZ.surv && CBZ.surv.arena, 120000, 200);
    if (!up) return { ok: false, err: "survival never built" };
  }
  if (subject.world === "city" && CBZ.game.mode !== "city") CBZ.setMode("city");

  // park the player out of frame-critical spots and keep him alive
  if (CBZ.player && CBZ.player.pos && subject.world === "survival" && CBZ.surv && CBZ.surv.arena) {
    const A0 = CBZ.surv.arena;
    CBZ.player.pos.set(A0.center.x, 26.5, A0.center.z);   // on the refuge mountain
  }
  const n = Math.max(0, Math.round((subject.settleSecs || 1) * 60));
  for (let i = 0; i < n; i++) {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    CBZ.stepSim(1 / 60);
    if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
  }

  // ---- tripod -------------------------------------------------------------
  const T = window.THREE;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.5; camera.far = 20000;
  const sh = subject.shot || {};
  let cx, cy, cz, ax, ay, az;
  let facts = null;
  if (subject.world === "city") {
    const A = CBZ.city && CBZ.city.arena;
    const SH = A && A.shore;
    if (!SH || !SH.beach) return { ok: false, err: "no city shore descriptor" };
    const x0 = SH.beach.x0, x1 = SH.beach.x1, ES = SH.ES;
    const span = x1 - x0, bxc = (x0 + x1) / 2;
    const innerZ = (A.minZ != null ? A.minZ : ES + 26) - 1;
    if (sh.kind === "city") {
      cx = bxc; cy = sh.alt; cz = ES - sh.backZ;
      ax = bxc; ay = sh.aimY || 0; az = ES + (sh.aimZ || 14);
    } else if (sh.kind === "city-low") {
      cx = x0 + span * (sh.atFrac || 0.2); cy = sh.alt; cz = ES - (sh.backZ || 8);
      ax = x1 - 22; ay = 0.4; az = ES + 2;
    } else {
      // over the boardwalk line, NOT inside the street grid — a camera at
      // innerZ+9 stands in the first block and can wake up inside a lobby
      cx = x0 + span * (sh.atFrac || 0.5); cy = sh.alt; cz = innerZ - 2.5;
      ax = cx - span * 0.22; ay = 0.0; az = ES - 6;
    }
    // the numbers: span from the descriptor; sand/swash verts from the scene
    let sandVerts = 0, swashVerts = 0;
    CBZ.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material && o.material.name === "beach-dry-sand" && o.geometry.attributes.position) sandVerts += o.geometry.attributes.position.count;
      if (o.userData && o.userData.beachSwash && o.geometry.attributes.position) swashVerts += o.geometry.attributes.position.count;
    });
    facts = { beachSpanM: span, sandVerts, swashVerts };
  } else {
    const A = CBZ.surv.arena;
    const icx = A.center.x, icz = A.center.z, R = A.radius;
    if (sh.kind === "island") {
      cx = icx; cy = sh.alt; cz = icz + R + sh.back;
      ax = icx; ay = -0.6; az = icz + R - (sh.aimIn || 12);
    } else {
      const th = sh.theta || 0.85;
      cx = icx + Math.cos(th) * (R + sh.out); cy = sh.alt; cz = icz + Math.sin(th) * (R + sh.out);
      const th2 = th - 0.62;                     // look along the coast's curve
      ax = icx + Math.cos(th2) * (R + 8); ay = -0.4; az = icz + Math.sin(th2) * (R + 8);
    }
    const audit = CBZ.survShoreAudit ? CBZ.survShoreAudit() : null;
    facts = audit ? { islandBeachM: audit.beachBandM, drySandM: audit.drySandM, wadeM: audit.wadeM, wetLineLive: audit.wetLive } : {};
  }
  camera.position.set(cx, cy, cz);
  camera.lookAt(ax, ay, az);
  camera.updateProjectionMatrix();
  window.__beachCam = camera;
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) { skyRig.position.set(cx, 0, cz); skyRig.updateMatrixWorld(); }
  }
  hideHud();
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  // ---- caption ------------------------------------------------------------
  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:60px;left:26px;font-size:25px;font-weight:800;letter-spacing:-.02em;max-width:680px";
  query("focus").textContent = subject.focus;
  query("focus").style.cssText = "position:absolute;top:96px;left:28px;color:#c0cfda;font-size:12.5px;font-weight:550;max-width:660px;line-height:1.45";
  query("facts").textContent = Object.entries(facts || {}).map(([k, v]) => `${k} ${v}`).join(" · ");
  query("facts").style.cssText = "position:absolute;right:24px;top:24px;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;text-align:right;max-width:420px";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:14px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {};
  for (const [k, v] of Object.entries(facts || {})) metrics[k] = Number(v) || 0;
  metrics.drawCalls = Number(render.calls || 0);

  return { ok: true, world: subject.world, cam: [cx, cy, cz].map((v) => +v.toFixed(1)), metrics };
}

export default {
  id: "beach-shores",
  title: "The Beaches: Gang City + Natural Disaster",
  description: "Both coasts, before and after BEACH_V2/SURV_BEACH_V2, with zero props added: Gang City's south shore grows 100 → 160 m and its sand becomes a vertex-coloured surface (micro-relief, grain, wrack line, damp band, higher-resolution swash); the survival island's 8 m painted stripe becomes a 26 m walkable shore with a berm, a foreshore that descends through the waterline, and a live wet line the tsunami's drawdown strands. Flag A/B by default: both sides are THIS checkout, the before side just boots with the flags off.",
  defaultBefore: "local",
  beforeParams: { cfg_BEACH_V2: 0, cfg_SURV_BEACH_V2: 0 },
  beforeLabel: "BEFORE · FLAGS OFF",
  afterLabel: "AFTER · BEACH V2",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "beachSpanM / islandBeachM / drySandM / wadeM are measured off the same descriptors and height functions the physics uses, not off pixels. sandVerts and swashVerts count the vertex-coloured surfaces (0 before = the flat quads). wetLineLive is the island's animated waterline rig. drawCalls keeps the honesty: the whole improvement rides in a handful of merged meshes.",
  metrics: {
    beachSpanM: { label: "City beach span", unit: "m", better: "higher" },
    sandVerts: { label: "Sand surface verts", better: "higher" },
    swashVerts: { label: "Swash apron verts", better: "higher" },
    islandBeachM: { label: "Island beach band", unit: "m", better: "higher" },
    drySandM: { label: "Island dry sand", unit: "m", better: "higher" },
    wadeM: { label: "Island wade band", unit: "m", better: "higher" },
    wetLineLive: { label: "Live wet line", better: "higher" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageBeach,
};
