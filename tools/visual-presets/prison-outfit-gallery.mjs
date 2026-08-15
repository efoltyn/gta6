/* Prison Escape outfit census for tools/visual-compare.mjs.

   Both sources boot the real registered Escape mode. The real player, inmates,
   patrol officers and warden are moved to one locked inspection mark in the
   prison yard; no display-only rigs are created. The deployed camera is carried
   into local, and the final lineup proves the fits still read together in the
   venue rather than only as isolated swatches. */

const subjects = [
  { id: "player-inmate-front", label: "Playable inmate · front", actor: "player", role: "inmate", fit: "inmate", view: "front",
    focus: "The playable escapee: clean one-piece prison orange with zipper, pockets, cuffs and reinforced knees. No lettering and no floating geometric stripe hoops." },
  { id: "player-inmate-back", label: "Playable inmate · back", actor: "player", role: "inmate", fit: "inmate", view: "back",
    focus: "Gameplay-facing back read: clean coverall seams, seat pockets and leg reinforcement must survive at third-person distance without a wordmark." },
  { id: "general-population", label: "General population inmate", actor: "standard", fit: "inmate", view: "front",
    focus: "A real named inmate wearing the same institutional uniform on his own skin/hair rig, not a cloned player mannequin." },
  { id: "medical-orderly", label: "Inmate medical orderly", actor: "orderly", fit: "inmate_orderly", view: "front",
    focus: "Infirmary whites, medical cross and pockets remain unmistakably inmate-issued through orange trousers and trim—without uniform text." },
  { id: "chapel-trustee", label: "Chapel trustee", actor: "chapel", fit: "inmate_chapel", view: "front",
    focus: "The existing purposeful grey chapel identity gains a collar tab, structured pockets and institutional orange accents without labels." },
  { id: "playable-officer", label: "Playable correctional officer", actor: "player", role: "cop", fit: "corrections", view: "front",
    focus: "The prison game's officer role uses the same detailed correctional uniform as staff: layered jacket, badge, pockets, patches, cap and duty belt—no text." },
  { id: "patrol-officer-front", label: "Patrol officer · front", actor: "officer", fit: "corrections", view: "front",
    focus: "A real AI patrol guard. Gang City's police construction is the bar, while slate corrections colors keep the institution distinct without labels." },
  { id: "patrol-officer-back", label: "Patrol officer · back", actor: "officer", fit: "corrections", view: "back",
    focus: "The jacket back stays intentionally clean during chases while its yoke, seams, trousers, side stripe, cap and belt remain coherent." },
  { id: "riot-squad-front", label: "Riot squad · Gang City SWAT front", actor: "riot", fit: "swat", view: "front",
    focus: "A real high-heat Prison Escape reinforcement wearing Gang City's SWAT fatigues, plate carrier, pouches, helmet and armor—with wordmarks removed." },
  { id: "riot-squad-back", label: "Riot squad · Gang City SWAT back", actor: "riot", fit: "swat", view: "back",
    focus: "The same live riot responder from behind: carrier back plate, helmet, tactical legs and armor silhouette remain strong without back text." },
  { id: "warden-dress", label: "Warden dress uniform", actor: "warden", fit: "warden", view: "front",
    focus: "A command silhouette rather than a darker generic guard: dress jacket, burgundy tie, gold braid, epaulettes, badge and peaked cap—no name tape." },
  { id: "live-cast-lineup", label: "Live prison cast · combined", actor: "lineup", view: "lineup",
    focus: "Six real gameplay actors together in the yard: inmate, orderly, chapel trustee, officer, armored riot responder and warden must read as one institution." },
];

async function stagePrisonOutfits(input) {
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
  const nameOf = (a) => (a && a.data && a.data.name) || "";
  const groundAt = (x, z) => {
    try {
      const y = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
      return Number.isFinite(y) ? y : 0;
    } catch (_) { return 0; }
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__prisonOutfitOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__prisonOutfitGallery;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") && document.querySelector('[data-mode="escape"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="escape"]').click();
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
    }, 20000, 50);
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    // Drive the real high-heat response long enough for reinforcements.js to
    // create its own riot actor. This is not a gallery clone: both deployed
    // and local sides photograph the live _reinf guard the shipped system owns.
    for (let i = 0; i < 360; i++) {
      if (CBZ.game) CBZ.game.detection = 100;
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.dead = false; CBZ.player.hp = 100; }
    }
    if (CBZ.game) CBZ.game.detection = 0;

    const npcs = CBZ.npcs || [], guards = CBZ.guards || [];
    const byName = (needle) => npcs.find((n) => nameOf(n).toLowerCase().indexOf(needle) >= 0);
    const standard = byName("tiny") || npcs.find((n) => n && n.prisonOutfit === "inmate") || npcs[0];
    const orderly = npcs.find((n) => n && n.prisonOutfit === "orderly" && nameOf(n).toLowerCase().indexOf("orderly") >= 0) || byName("orderly pratt") || byName("doc mercer");
    const chapel = npcs.find((n) => n && n.prisonOutfit === "chapel") || byName("brother amos");
    const officer = guards.find((g) => g && g.kind === "guard" && g.char);
    const riot = guards.find((g) => g && g._reinf && g.char);
    const warden = guards.find((g) => g && g.kind === "warden" && g.char);
    if (!standard || !orderly || !chapel || !officer || !riot || !warden || !CBZ.playerChar) {
      return { ok: false, err: "missing one or more live prison outfit actors" };
    }

    const overlay = document.createElement("div");
    overlay.id = "__prisonOutfitOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-fit></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__prisonOutfitGallery = { standard, orderly, chapel, officer, riot, warden, overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const playerActor = { char: CBZ.playerChar, group: CBZ.playerChar.group, _player: true };
  if (CBZ.invOpen && CBZ.toggleInventory) CBZ.toggleInventory();
  try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
  try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
  if (CBZ.dayPhase) CBZ.dayPhase(0.25);
  if (CBZ.game) { CBZ.game.prisonHolstered = true; CBZ.game.cityHolstered = true; }
  if (CBZ.applyPlayerRole) CBZ.applyPlayerRole(subject.role === "cop" ? "cop" : "inmate");
  if (CBZ.prisonOutfitSyncNow) CBZ.prisonOutfitSyncNow();

  const all = [playerActor, ...(CBZ.guards || []), ...(CBZ.npcs || [])];
  for (const a of all) if (a && a.group) a.group.visible = false;

  function neutralize(a) {
    if (!a || !a.char) return;
    try { if (CBZ.animChar) CBZ.animChar(a.char, 0, 1 / 60); } catch (_) {}
    if (a.flashlight && a.flashlight.group) a.flashlight.group.visible = false;
    if (a._torchCone) a._torchCone.visible = false;
    if (a._torchPool) a._torchPool.visible = false;
    if (a.wedge) a.wedge.visible = false;
    if (a._weaponProp) a._weaponProp.visible = false;
    a.dead = false; a.ko = 0; a.pause = 999;
  }
  function place(a, x, z) {
    if (!a || !a.group || !a.char) return;
    const y = groundAt(x, z);
    a.group.visible = true;
    a.group.position.set(x, y, z);
    a.group.rotation.set(0, 0, 0);
    if (a._player && CBZ.player) {
      CBZ.player.pos.set(x, y, z); CBZ.player.vy = 0; CBZ.player.grounded = true; CBZ.player.dead = false; CBZ.player.hp = 100;
    }
    neutralize(a);
    a.group.updateMatrixWorld(true);
  }

  const actorMap = { standard: S.standard, orderly: S.orderly, chapel: S.chapel, officer: S.officer, riot: S.riot, warden: S.warden };
  let shown = [];
  if (subject.actor === "lineup") {
    shown = [playerActor, S.orderly, S.chapel, S.officer, S.riot, S.warden];
    const xs = [-5.0, -3.0, -1.0, 1.0, 3.0, 5.0];
    for (let i = 0; i < shown.length; i++) place(shown[i], xs[i], 30);
  } else {
    const a = subject.actor === "player" ? playerActor : actorMap[subject.actor];
    if (!a) return { ok: false, err: "missing actor for " + subject.id };
    shown = [a];
    place(a, 0, 30);
  }

  setHud(false);
  const cams = {
    // Prison rigs face +Z at zero rotation. Keep these semantic names honest:
    // the +Z camera sees faces/chest IDs, while -Z sees jacket back panels.
    front: { x: 0, y: 1.55, z: 35.25, ax: 0, ay: 1.18, az: 30, fov: 34 },
    back: { x: 0, y: 1.55, z: 24.75, ax: 0, ay: 1.18, az: 30, fov: 34 },
    lineup: { x: 0, y: 2.15, z: 39.6, ax: 0, ay: 1.22, az: 30, fov: 46 },
  };
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = locked || cams[subject.view || "front"];
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 40; camera.near = 0.15; camera.far = 20000;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:24px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;top:108px;left:27px;width:520px;color:#c0cfda;font-size:11px;line-height:1.35;font-weight:600";
  const keys = shown.map((a) => a && a.char && a.char._prisonOutfitKey).filter(Boolean);
  q("fit").textContent = keys.length ? "SHARED WARDROBE · " + Array.from(new Set(keys)).join(" / ") : "LEGACY FLAT CONSTRUCTOR COLORS";
  q("fit").style.cssText = "position:absolute;top:150px;left:27px;color:#f2c86d;font-size:10px;font-weight:800;letter-spacing:.08em";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  function slotVisible(ch, slot) {
    let n = 0;
    for (const m of (ch && ch.skinSlots && ch.skinSlots[slot]) || []) if (m && m.visible !== false) n++;
    return n;
  }
  function textured(ch) {
    const seen = new Set(), slots = ["torso", "collar", "arms", "armsLower", "legs", "legsLower"];
    let n = 0;
    for (const slot of slots) for (const m of (ch && ch.skinSlots && ch.skinSlots[slot]) || []) {
      if (!m || seen.has(m) || m.visible === false) continue;
      seen.add(m); if (m.material && m.material.map) n++;
    }
    const j = ch && ch._jacketMesh;
    if (j && j.visible && j.material && j.material.map && !seen.has(j)) n++;
    return n;
  }
  let texturedMeshes = 0, stripeMeshes = 0;
  for (const a of shown) {
    texturedMeshes += textured(a.char);
    stripeMeshes += slotVisible(a.char, "stripes");
  }
  const expectedApplied = subject.fit && shown.length === 1 && shown[0].char._prisonOutfitKey === subject.fit ? 1 : 0;
  const liveAudit = typeof CBZ.prisonOutfitAudit === "function"
    ? CBZ.prisonOutfitAudit()
    : null;
  const liveAuditPass = liveAudit && liveAudit.enabled === 1 && liveAudit.actors > 0 &&
    liveAudit.styled === liveAudit.actors && liveAudit.mismatched === 0 &&
    liveAudit.stripesVisible === 0 && liveAudit.records === liveAudit.requiredRecords &&
    liveAudit.riotActors > 0 && liveAudit.riotSwatFits === liveAudit.riotActors &&
    liveAudit.riotArmored === liveAudit.riotActors &&
    liveAudit.canonicalWardrobe === 1 ? 1 : 0;
  let totalArmorMeshes = 0;
  for (const g of CBZ.guards || []) totalArmorMeshes += (g && g._armorMeshes && g._armorMeshes.length) || 0;
  const expectedState = subject.actor === "lineup" ? (keys.length === shown.length ? 1 : 0) : expectedApplied;

  CBZ.renderer.render(CBZ.scene, camera);
  return {
    ok: true,
    camera: { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az, fov: cam.fov || 40 },
    audit: subject.actor === "lineup" ? liveAudit : null,
    metrics: {
      expectedFitApplied: expectedState,
      texturedGarmentMeshes: texturedMeshes,
      legacyStripeMeshes: stripeMeshes,
      physicalArmorMeshes: totalArmorMeshes,
      liveOutfitAuditPass: liveAuditPass,
    },
  };
}

export default {
  id: "prison-outfit-gallery",
  title: "Prison Escape Outfits — Complete Before / After Census",
  description: "The real direct Prison Escape cast photographed at a locked yard mark: playable inmate and officer roles, general population, medical/chapel assignments, patrol staff, live high-heat riot SWAT, warden, front/back gameplay reads, and one combined lineup.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 81526 },
  stageTimeoutMs: 420000,
  pairNote: "Same Escape mode · seed · live actor · camera · lighting · pose",
  method: "Both sides boot the registered direct Prison Escape game, freeze the simulation after the reveal, and photograph real gameplay actors. The deployed camera is carried into local; no gallery-only character rig or copied outfit builder is used.",
  metricsNote: "Runtime measurements support the pixels: canonical fit marker, textured garment coverage, retired constructor stripes, real badge/armor meshes, riot-SWAT adoption, and unique role fits in the combined cast.",
  metrics: {
    expectedFitApplied: { label: "Expected canonical prison fit applied", better: "higher" },
    texturedGarmentMeshes: { label: "Textured live garment meshes", better: "higher" },
    legacyStripeMeshes: { label: "Legacy geometric stripe meshes visible", better: "lower" },
    physicalArmorMeshes: { label: "Mounted physical armor meshes", better: "higher" },
    liveOutfitAuditPass: { label: "All live actors correctly dressed", better: "higher" },
  },
  subjects,
  stage: stagePrisonOutfits,
};
