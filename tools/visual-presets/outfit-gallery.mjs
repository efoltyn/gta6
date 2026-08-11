/* Outfit gallery for tools/visual-compare.mjs.

   Stages the REAL game (like nuke-sequence, unlike the studio presets): boots
   the full city (seed pinned), enters free play, freezes the rAF loop, then
   for each subject dresses the ACTUAL PLAYER through the same wardrobe calls
   the boutique uses (cityWearOutfit / cityGrantItem+cityWear / cityEcon.add
   for jewellery) and photographs the live rig from declared tripods — front,
   back, collar closeup, chest jewellery, wrist watch. Third person only ever
   shows the player's back in gameplay; this is the tool that shows the front.

   Owner bug under test (2026-08-02): the shirt collar renders as a solid
   navy-blue geometric box on suits. Root cause: the shoulder-yoke box is
   tinted from the static CAT.suit.colors.torso (0x1c2030) while the jacket
   texture paints from SUIT_STYLES[style].body — two color sources nothing
   syncs. The collarDelta metric measures exactly that gap (RGB distance
   yoke-box vs painted jacket body), so the fix is a number, not an opinion.

   Staging facts (inherited from nuke-sequence, verified 2026-08-02):
   - core/loop.js self-schedules via rAF; stubbing rAF after boot freezes the
     loop and CBZ.stepSim(1/60) becomes the only clock — identical simulated
     ticks on both sides.
   - core/sky.js keeps the sky on a rig following the camera at y=0; recenter
     CBZ.skyDome.parent to the camera before rendering by hand.
   - The player is healed every tick so the gallery cannot end in WASTED. */

const subjects = [
  { id: "spawn-front",   label: "Spawn fit — front",
    focus: "The default composite the player boots into. The neck/collar must read as painted cloth, not a separate geometric slab.",
    view: "front" },
  { id: "spawn-collar",  label: "Spawn fit — collar closeup",
    focus: "The reported 'weird neck': collar box color and shape against the shirt at conversational distance.",
    view: "collar" },
  { id: "suit-0-front",  label: "Suit style 0 (default) — front",
    focus: "Default two-piece. Collar/yoke must match the painted jacket body — today it stays static navy regardless of style.",
    view: "front", wear: { comp: "suit_0" }, suitStyle: 0 },
  { id: "suit-0-back",   label: "Suit style 0 — back",
    focus: "The view gameplay actually shows. Jacket back, vents, collar line from behind.",
    view: "back", wear: { comp: "suit_0" }, suitStyle: 0 },
  { id: "suit-tan-front", label: "Tan suit — front",
    focus: "Flagrant repro: a light tan jacket with the static navy collar box is the bug at its loudest.",
    view: "front", wear: { compByStyleName: "tan" } },
  { id: "suit-tan-collar", label: "Tan suit — collar closeup",
    focus: "Yoke vs lapels vs shirt at close range on the highest-contrast style.",
    view: "collar", wear: { compByStyleName: "tan" } },
  { id: "suit-powder-front", label: "Powder-blue suit — front",
    focus: "Second contrast repro; also judges lapel/shirt/tie readability on a pale jacket.",
    view: "front", wear: { compByStyleName: "powder" } },
  { id: "tuxedo-front",  label: "Midnight Tuxedo — front",
    focus: "Apex purchase. Satin lapels, shirt front, bow tie; the yoke should sit in the same near-black family as the painted body.",
    view: "front", wear: { outfit: "tuxedo" } },
  // Jewellery subjects run BEFORE the uniform fits: wearing the police
  // uniform as a civilian arms the disguise machinery, and the follow-up
  // outfit swap can blow it — cops aggro and a lethal hit mid-tick goes
  // through cityKillPlayer regardless of per-tick hp resets. The 2026-08-03
  // full run lost the player rig on every subject after police, on BOTH
  // sides. Uniforms come last so nothing depends on the world staying calm
  // afterwards.
  { id: "drip-front",    label: "Street fit + full jewellery — front",
    focus: "Gold chain, gold watch, diamond ring, shades all mounted at once — full-drip readability at body distance.",
    view: "front", wear: { outfit: "street" },
    jewelry: ["Gold Chain", "Gold Watch", "Diamond Ring", "Designer Shades"] },
  { id: "drip-chest",    label: "Jewellery — chest closeup",
    focus: "Chain strands, pendant seat, shades — do they read as jewellery or as boxes taped to the torso?",
    view: "chest", wear: { outfit: "street" },
    jewelry: ["Gold Chain", "Gold Watch", "Diamond Ring", "Designer Shades"] },
  { id: "drip-wrist",    label: "Jewellery — watch closeup",
    focus: "Band, case, face on the left wrist at the canonical charArmLandmarks seat.",
    view: "wrist", wear: { outfit: "street" },
    jewelry: ["Gold Watch"] },
  { id: "ice-head",      label: "Earrings, grill, tiara — head closeup",
    focus: "The uncovered slots: earrings rendered NOTHING on the player, the grill was authored inside the skull, the tiara had no look at all. All three must read here.",
    view: "head", wear: { outfit: "street" },
    jewelry: ["Earrings", "Diamond Grill", "Diamond Tiara"] },
  { id: "designer-front", label: "Designer Drip — front",
    focus: "Money fit that today is flat tint only — judge whether it earns its price tag next to the painted looks.",
    view: "front", wear: { outfit: "designer" } },
  { id: "police-front",  label: "Police uniform — front",
    focus: "The reference the owner calls great — painter and yoke read the same value by construction. The suits should reach this bar. LAST on purpose (see note above).",
    view: "front", wear: { outfit: "police" } },
];

export async function stageOutfit(input) {
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
      if (child.id === "__outfitOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__outfitSeq;
  if (!S) {
    // ---- one-time: boot the real world into free play -------------------
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

    // Freeze the rAF loop; from here stepSim is the only clock.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 60; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      if (CBZ.player) CBZ.player.hp = 100;
    }

    // Studio spot: the city's centroid, on the ground. Same seed → same spot
    // on both sides; the camera works close so the backdrop is context, not
    // subject.
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    let gx = 0, gz = 0, count = 0;
    for (const lot of lots) {
      const x = Number(lot.x != null ? lot.x : lot.cx);
      const z = Number(lot.z != null ? lot.z : lot.cz);
      if (Number.isFinite(x) && Number.isFinite(z)) { gx += x; gz += z; count++; }
    }
    gx = count ? gx / count : 0;
    gz = count ? gz / count : 0;
    const gy = (CBZ.floorAt && CBZ.floorAt(gx, gz)) || 0;

    const overlay = document.createElement("div");
    overlay.id = "__outfitOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-fit></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__outfitSeq = { gx, gz, gy, overlay };
    window.__cbzVisualCompare = {
      render() {
        try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
      },
    };
  }

  const sub = input.subject;

  // ---- park the player on the studio spot -------------------------------
  // Teleport ONCE, on the ground, velocity killed — re-setting pos every
  // settle tick held the rig 1.1 m airborne and every shot caught the
  // falling pose (splayed arms). Holster too: the spawn pistol blocked the
  // outfit's right side in frame.
  if (CBZ.game) CBZ.game.cityHolstered = true;
  if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
    CBZ.player.pos.set(S.gx, S.gy + 0.08, S.gz);
    CBZ.player.vy = 0;
    CBZ.player.grounded = true;
    CBZ.player.hp = 100;
  }

  // ---- dress the player through the real wardrobe calls -----------------
  let wornName = "spawn composite";
  if (sub.cast) {
    const spec = Object.assign({
      archetype: "resident",
      band: "adult",
      age: 32,
      sex: sub.sex || "m",
      seed: sub.seed == null ? 90210 : sub.seed,
    }, sub.cast);
    const catalog = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null;
    const rec = (CBZ.cityOutfitFor && CBZ.cityOutfitFor(spec)) || (catalog && catalog.street);
    if (!rec || !rec.colors) return { ok: false, err: "no cast outfit for " + (spec.job || spec.archetype || sub.id) };
    // Every frame is an isolated fitting. Deployed builds predate the direct
    // cityClearComposite hook, so reset through their public empty-composite
    // path before putting on the next role; otherwise an accountant's tie can
    // linger on the janitor photographed after it.
    if (CBZ.cityApplyComposite && CBZ.playerChar) {
      CBZ.cityApplyComposite(CBZ.playerChar, {
        shirt: 0xf2f2f2,
        legs: 0x39414f,
        items: [],
      });
    }
    CBZ.game.cityWornOutfit = rec;
    CBZ.game.cityOutfitId = rec.id;
    if (CBZ.cityOutfitApplyPlayer) CBZ.cityOutfitApplyPlayer();
    else if (CBZ.cityRecolorRig) CBZ.cityRecolorRig(CBZ.playerChar, rec.colors, rec);
    wornName = rec.name + " [" + rec.id + "]";
  } else if (sub.wear) {
    let compId = sub.wear.comp || null;
    if (sub.wear.compByStyleName && Array.isArray(CBZ.citySuitStyles)) {
      const idx = CBZ.citySuitStyles.findIndex((st) =>
        st && st.name && st.name.toLowerCase().indexOf(sub.wear.compByStyleName) >= 0);
      compId = idx >= 0 ? "suit_" + idx : "suit_0";
    }
    if (compId) {
      if (CBZ.cityGrantItem) CBZ.cityGrantItem(compId);
      if (!(CBZ.cityWear && CBZ.cityWear(compId))) return { ok: false, err: "cityWear failed: " + compId };
      wornName = compId;
    } else if (sub.wear.outfit) {
      if (!(CBZ.cityWearOutfit && CBZ.cityWearOutfit(sub.wear.outfit))) {
        return { ok: false, err: "cityWearOutfit failed: " + sub.wear.outfit };
      }
      wornName = sub.wear.outfit;
    }
  }
  if (sub.jewelry && CBZ.cityEcon && CBZ.cityEcon.add) {
    for (const name of sub.jewelry) {
      if (!CBZ.cityEcon.count || !CBZ.cityEcon.count(name)) CBZ.cityEcon.add(name, 1);
    }
    if (CBZ.cityBlingPlayerDirty) CBZ.cityBlingPlayerDirty();
  }

  // Park the GAME camera at a normal third-person distance before stepping:
  // the camera-follow updater runs inside stepSim, and if the previous
  // subject left CBZ.camera sub-meter from the player (the wrist/head
  // closeups), the game flips to first-person and hides playerChar.group —
  // the 2026-08-03 run photographed two empty fields that way.
  if (CBZ.camera && CBZ.player && CBZ.player.pos) {
    CBZ.camera.position.set(CBZ.player.pos.x, CBZ.player.pos.y + 2.2, CBZ.player.pos.z - 6);
  }
  // Settle: pose, bling re-seat, cloth swap — through the real updater chain.
  for (let i = 0; i < 14; i++) {
    CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
    if (CBZ.player) CBZ.player.hp = 100;
  }
  // belt to the suspenders above: whatever mode the follow logic settled in,
  // the subject of this photograph is the rig
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;

  // ---- tripod on a FIXED world axis -------------------------------------
  // Deriving forward from the rig quaternion went degenerate whenever the
  // pose pitched the group (fall/ragdoll frames): the horizontal projection
  // vanished and the closeups aimed at bare ground. The gallery instead
  // pins the rig's yaw after the settle ticks (nothing re-poses it before
  // the render) so world +Z IS the chest side (chain sits at local z=+0.268).
  const ch = CBZ.playerChar;
  if (!ch || !ch.group) return { ok: false, err: "no player rig" };
  ch.group.rotation.y = 0;
  ch.group.updateMatrixWorld(true);
  const base = new T.Vector3();
  ch.group.getWorldPosition(base);
  const fwd = new T.Vector3(0, 0, 1);
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.near = 0.05;
  camera.far = 4000;
  const eye = new T.Vector3();
  const aim = new T.Vector3();
  // Full-body tripods sit slightly HIGH (like the game's third-person cam)
  // so the top face of the collar yoke — where the bug reads loudest — is
  // in frame, not hidden behind the jacket shell.
  if (sub.view === "front") {
    camera.fov = 38;
    eye.copy(base).addScaledVector(fwd, 3.5); eye.y = base.y + 1.55;
    aim.set(base.x, base.y + 0.92, base.z);
  } else if (sub.view === "back") {
    camera.fov = 38;
    eye.copy(base).addScaledVector(fwd, -3.5); eye.y = base.y + 1.55;
    aim.set(base.x, base.y + 0.92, base.z);
  } else if (sub.view === "head") {
    camera.fov = 32;
    eye.copy(base).addScaledVector(fwd, 1.15); eye.y = base.y + 1.72;
    aim.set(base.x, base.y + 1.58, base.z);
  } else if (sub.view === "collar" || sub.view === "chest") {
    camera.fov = 34;
    // collar: HIGH three-quarter, looking down past the head at the yoke —
    // a straight-on tripod at neck height just photographs the face box.
    const d = sub.view === "collar" ? 1.5 : 1.5;
    const h = sub.view === "collar" ? 2.0 : 1.45;
    const a = sub.view === "collar" ? 1.38 : 1.32;
    eye.copy(base).addScaledVector(fwd, d); eye.y = base.y + h;
    aim.set(base.x, base.y + a, base.z);
  } else { // wrist — resolve the left elbow group's world seat
    camera.fov = 34;
    const wristAnchor = (ch.low && ch.low.la) || ch.group;
    const wpos = new T.Vector3();
    wristAnchor.getWorldPosition(wpos);
    wpos.y -= 0.10; // down the forearm toward the watch seat
    eye.copy(wpos).addScaledVector(fwd, 0.65); eye.y = wpos.y + 0.16;
    aim.copy(wpos);
  }
  camera.position.copy(eye);
  camera.lookAt(aim);
  camera.updateProjectionMatrix();
  // core/sky.js's own seam (rig + palette + sun placement), with the historic
  // y=0 follow as the degrade path for a build that predates it.
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }
  hideHud();
  CBZ.renderer.render(CBZ.scene, camera);

  // ---- the collar-mismatch number ---------------------------------------
  // yoke box color vs the color the jacket texture actually painted from.
  // Only style-driven fits (suit/tuxedo) have two color sources that can
  // drift; on flat/composite fits the yoke color is an authored accent and a
  // distance number would be noise.
  // Preferred source: CBZ.cityOutfitYokeAudit — it knows that a PAINTED yoke
  // wears its atlas (material.color stays white under a map, so reading the
  // material off the mesh reports a lie of ~358 the moment the fix works).
  // Fallback (deployed page, no audit export): raw material color vs the
  // style body — correct there because the old yoke is a flat tint.
  let collarDelta = null;
  const w = CBZ.cityOutfitGet && CBZ.cityOutfitGet();
  if (w && /suit|tux/i.test(String(w.id || ""))) {
    if (CBZ.cityOutfitYokeAudit) {
      if (!window.__yokeAudit) { try { window.__yokeAudit = CBZ.cityOutfitYokeAudit(); } catch (_) {} }
      const audit = window.__yokeAudit;
      const rowId = /suit/i.test(String(w.id || "")) && String(w.id) !== "tuxedo"
        ? "suit|" + (w.style || 0) : String(w.id);
      const row = audit && audit.rows && audit.rows.find((r) => r.id === rowId);
      if (row) collarDelta = row.delta;
    }
    if (collarDelta == null) {
      const slots = ch.skinSlots || {};
      const collarMesh = slots.collar && slots.collar[0];
      let paintedBody = null;
      if (/suit/i.test(String(w.id || "")) && Array.isArray(CBZ.citySuitStyles)) {
        const st = CBZ.citySuitStyles[w.style || 0];
        if (st && st.body != null) paintedBody = st.body;
      } else if (String(w.id || "") === "tuxedo") {
        paintedBody = 0x16171c; // PAINT.tuxedo hardcodes the body hex
      }
      if (paintedBody != null && collarMesh && collarMesh.material && collarMesh.material.color) {
        const got = collarMesh.material.color.getHex();
        const dr = ((got >> 16) & 255) - ((paintedBody >> 16) & 255);
        const dg = ((got >> 8) & 255) - ((paintedBody >> 8) & 255);
        const db = (got & 255) - (paintedBody & 255);
        collarDelta = Math.round(Math.sqrt(dr * dr + dg * dg + db * db));
      }
    }
  }
  const blingCount = (sub.jewelry && CBZ.cityPlayerBlingCount) ? CBZ.cityPlayerBlingCount() : null;

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = sub.label;
  query("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
  query("focus").textContent = sub.focus;
  query("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:720px";
  query("fit").textContent = "fit: " + wornName +
    (collarDelta != null ? ` · collarΔ ${collarDelta}` : "") +
    (blingCount != null ? ` · bling meshes ${blingCount}` : "");
  query("fit").style.cssText = "position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {};
  if (collarDelta != null) metrics.collarDelta = collarDelta;
  if (blingCount != null) metrics.blingMeshes = blingCount;
  return {
    ok: true,
    fit: wornName,
    view: sub.view,
    // a dead/arrested world photographs as an empty field — surface it as
    // data instead of a mystery frame
    gameState: CBZ.game && CBZ.game.state,
    rigInScene: (function () {
      let p = ch.group;
      while (p) { if (p === CBZ.scene) return true; p = p.parent; }
      return false;
    })(),
    metrics,
    camera: { position: eye.toArray(), target: aim.toArray() },
  };
}

export default {
  id: "outfit-gallery",
  title: "Outfits on the Live Player: Front, Back, Collar, and Jewellery",
  description: "The real game boots once per side, the rAF loop is frozen, and the actual player is dressed through the boutique's own wardrobe calls — suits by style, the tuxedo, the police reference, designer drip, and full jewellery. Declared tripods photograph the live rig from the front (which gameplay never shows), the back (which it always shows), and closeups of the collar seat and jewellery mounts. collarΔ is the RGB distance between the shoulder-yoke box and the color the jacket texture actually painted from — zero means the navy-collar bug is dead.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "collarΔ: RGB distance between the collar/yoke box tint and the painted jacket body color (0 = matched). Bling meshes: jewellery meshes mounted on the player rig.",
  metrics: {
    collarDelta: { label: "Collar/jacket color gap", better: "lower" },
    blingMeshes: { label: "Jewellery meshes mounted", better: "higher" },
  },
  subjects,
  stage: stageOutfit,
};
