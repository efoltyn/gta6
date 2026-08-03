/* Store dressing gallery for tools/visual-compare.mjs.

   Same live-game staging as outfit-gallery (boot once, freeze rAF, stepSim is
   the clock): the player is teleported INSIDE each store so the interior
   visibility gates open, then declared tripods photograph the sales floor.
   Subjects cover the clothing store (Threads and Drip: mannequins, hanging
   runs, gondola, fitting corner) and the jewelry store (Carat and Karat:
   case interiors, mounts, spot bars, vault).

   The stores build lazily on their own updaters (gunstore pattern), so a few
   settle ticks after teleport are enough on both sides. Store orientation
   varies by seed but is identical across sides (same seed), so a fixed
   diagonal tripod produces matched, comparable frames even when the framing
   is not gallery-perfect. */

const subjects = [
  { id: "clothing-a", label: "Clothing store — floor from the door side",
    focus: "Mannequin forms, hanging runs, hero cluster: do garments own their space or intersect?",
    store: "clothing", ox: 3.4, oz: 3.4, h: 1.75, aimH: 1.1 },
  { id: "clothing-b", label: "Clothing store — floor from the far corner",
    focus: "Gondola, fitting corner, folded stacks, section cards — does the room read intentional?",
    store: "clothing", ox: -3.4, oz: -3.4, h: 1.75, aimH: 1.1 },
  { id: "jewelry-a", label: "Jewelry store — front cases",
    focus: "Velvet risers, mounts (roll/neck form/finger cone), warm spot bars, price cards under the glass.",
    store: "jewelry", ox: 2.8, oz: 2.8, h: 1.6, aimH: 1.15 },
  { id: "jewelry-b", label: "Jewelry store — vault side",
    focus: "The jackpot case: dark velvet, one hard beam per piece, pieces readable through the pane.",
    store: "jewelry", ox: -2.8, oz: -2.8, h: 1.6, aimH: 1.15 },
];

async function stageStore(input) {
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
      if (child.id === "__storeOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__storeSeq;
  if (!S) {
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
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 60; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      if (CBZ.player) CBZ.player.hp = 100;
    }
    const overlay = document.createElement("div");
    overlay.id = "__storeOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-fit></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__storeSeq = { overlay };
    window.__cbzVisualCompare = {
      render() {
        try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
      },
    };
  }

  const sub = input.subject;
  const lot = sub.store === "clothing"
    ? (CBZ.cityClothingLot && CBZ.cityClothingLot())
    : (CBZ.cityJewelryLot && CBZ.cityJewelryLot());
  // the stores build lazily on their updaters — park the player at the city
  // centroid fallback and tick until the lot resolves
  let cx = lot && Number(lot.x != null ? lot.x : lot.cx);
  let cz = lot && Number(lot.z != null ? lot.z : lot.cz);
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) {
    for (let i = 0; i < 120 && (!Number.isFinite(cx) || !Number.isFinite(cz)); i++) {
      CBZ.stepSim(1 / 60);
      const l2 = sub.store === "clothing"
        ? (CBZ.cityClothingLot && CBZ.cityClothingLot())
        : (CBZ.cityJewelryLot && CBZ.cityJewelryLot());
      if (l2) { cx = Number(l2.x != null ? l2.x : l2.cx); cz = Number(l2.z != null ? l2.z : l2.cz); }
    }
  }
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) return { ok: false, err: "no " + sub.store + " lot" };
  const gy = (CBZ.floorAt && CBZ.floorAt(cx, cz)) || 0;

  // player INSIDE the store so the interior visibility gates open
  if (CBZ.game) CBZ.game.cityHolstered = true;
  if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
    CBZ.player.pos.set(cx, gy + 0.08, cz);
    CBZ.player.vy = 0; CBZ.player.grounded = true; CBZ.player.hp = 100;
  }
  for (let i = 0; i < 20; i++) {
    CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
    if (CBZ.player) CBZ.player.hp = 100;
  }
  // hide the player rig itself — the subject is the room
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 62;
  camera.near = 0.05;
  camera.far = 4000;
  camera.position.set(cx + sub.ox, gy + sub.h, cz + sub.oz);
  camera.lookAt(cx, gy + sub.aimH, cz);
  camera.updateProjectionMatrix();
  const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
  if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  hideHud();
  CBZ.renderer.render(CBZ.scene, camera);
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;

  const audit = sub.store === "clothing"
    ? (CBZ.cityClothingDressAudit && CBZ.cityClothingDressAudit())
    : (CBZ.cityJewelryDressAudit && CBZ.cityJewelryDressAudit());
  const metrics = {};
  if (audit) {
    if (sub.store === "clothing") {
      metrics.mannequins = Number(audit.mannequins || 0);
      metrics.hangRuns = Number(audit.runs || 0);
      metrics.storeMeshes = Number(audit.meshes || 0);
    } else {
      metrics.caseProps = (audit.cases || []).reduce((n, c) => n + Number(c.props || 0), 0);
      metrics.jewelMeshes = Number(audit.meshes || 0);
    }
  }

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = sub.label;
  query("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
  query("focus").textContent = sub.focus;
  query("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:720px";
  query("fit").textContent = Object.keys(metrics).map((k) => k + " " + metrics[k]).join(" · ");
  query("fit").style.cssText = "position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return { ok: true, store: sub.store, lot: [Number(cx.toFixed(1)), Number(cz.toFixed(1))], metrics };
}

export default {
  id: "store-dress",
  title: "The Stores That Sell the Drip: Clothing Floor and Jewelry Cases",
  description: "The real game boots once per side and the player steps inside Threads and Drip and Carat and Karat. Tripods photograph the sales floors: mannequin forms, hanging runs, the gondola and fitting corner on the clothing side; velvet risers, mounts, spot bars and the vault on the jewelry side. Audit counts (mannequins, runs, case props) land as before/after metrics.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "Counts from the stores' own dress audits; deployed side reports 0 where the audit export does not exist yet.",
  metrics: {
    mannequins: { label: "Display forms", better: "higher" },
    hangRuns: { label: "Hanging runs", better: "higher" },
    storeMeshes: { label: "Clothing store meshes", better: "lower" },
    caseProps: { label: "Jewelry case props", better: "higher" },
    jewelMeshes: { label: "Jewelry store meshes", better: "lower" },
  },
  subjects,
  stage: stageStore,
};
