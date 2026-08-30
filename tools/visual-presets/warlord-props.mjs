/* warlord-props — the DESERT WARLORD object library, photographed against its
   own revert.

   WHAT IS UNDER TEST. src/warlord/props.js is the game's asset library: the
   four outposts as places you can name from a kilometre away, the faction
   banners, the wreckage that gives an empty desert a history, the cover a
   man actually hides behind, and your own camp. It carries `?propkit=old`,
   which returns from every factory the flat primitive the rest of the game
   drew before the file existed — desert.js's icosahedron rock, battle.js's
   one rotated grey box per piece of cover, a bare pole where a banner goes,
   and a single box where an outpost goes. So the BEFORE side is not "props
   off"; it is this game one commit ago, from the same checkout, differing by
   one query parameter. That is why defaultBefore is "local".

   HOW IT IS STAGED. props.js publishes its own gallery under `?props=1`: a
   flat pad with every prop laid out in a row and a list of named tripods
   (W.props.SHOTS). It exists so the library can be looked at without
   desert.js, campaign.js or battle.js being finished, and this preset does
   nothing but drive it — no camera arithmetic here, because the camera
   positions belong beside the props they frame, not in a tools file that
   goes stale the moment a depot moves.

   THE TWO NUMBERS, and why these two.
     coverBoxes  how many of the library's registered colliders combat_iq
                 would actually ACCEPT as cover — its own thresholds
                 (systems/combat_iq.js: 0.85 m tall, foot at or below 1.2 m,
                 0.7 m across) applied to CBZ.micro.colliders. This is the
                 whole difference between cover and decoration: a sandbag
                 wall the fighters cannot see is a photograph, not a game
                 object. Higher is better.
     fieldDraws  the sixty-banner field and the hundred-and-twenty-rock
                 cover field together, rendered alone, in draw calls. The
                 brief's own words were "sixty banners and four hundred
                 rocks cannot be four hundred and sixty draw calls", so the
                 revert builds them the way a page without a batching layer
                 would — one group per flag, one mesh per rock — and this
                 measures both sides of that. Lower is better.

   BUT LOOK AT THE PICTURES. Neither number can tell you that the ridge
   tents are lying flat on the sand, that the smoke column is a white
   light-shaft across the sky, that every rock is rendering black, or that a
   depot reads as a swing set — all four were real, all four were found by
   opening the pair image, and none of them was a number anybody had
   declared. The staging is built so a single glance at each stitched pair
   answers "is this thing right". */

const subjects = [
  { id: "depot", shot: "depot", label: "ARMS DEPOT",
    focus: "Container yard under a straddling gantry, sandbag arc, gabions, mast. Must be nameable as a DEPOT from the shape alone." },
  { id: "camp", shot: "camp", label: "RECRUIT CAMP",
    focus: "Two arcs of ridge tents, bell tents at the head, three cook fires with smoke. The tents must stand UP, not lie flat." },
  { id: "well", shot: "well", label: "WELL / OASIS",
    focus: "Palms with drooping fronds, a stone well head with a winch, a shade sail, and water you can actually see." },
  { id: "market", shot: "market", label: "NIGHT MARKET",
    focus: "Four low tarpaulin canopies in two rows with a lane between, lamps, no mast. The only outpost with no vertical." },
  { id: "banners", shot: "banners", label: "FIVE FACTIONS",
    focus: "One hero banner per faction from core.js. Cloth must read as a rippling chain, not a signboard on a hinge." },
  { id: "field", shot: "field", label: "SIXTY BANNERS",
    focus: "The whole map's bands flying at once. Colour must be per-banner (they rendered BLACK until instanceColor was sized up front)." },
  { id: "wrecks", shot: "wrecks", label: "WRECKAGE",
    focus: "Burnt truck, downed cargo plane, half-buried tank, dead caravan, bones. These must look WRECKED, not parked." },
  { id: "cover", shot: "cover", label: "BATTLE COVER",
    focus: "One of each cover kind at combat_iq's own dimensions: sandbag, gabion, barricade, ruin, crate, boulder, slab, bank, palm." },
  { id: "rockfield", shot: "rockfield", label: "120 ROCKS, BATCHED",
    focus: "A battlefield's worth of cover through coverField(). Scraped facets, not smooth potatoes, and a handful of draw calls." },
  { id: "camp2", shot: "camp2", label: "YOUR BIVOUAC",
    focus: "Your own army at rest: fires, bedrolls, picket line, baggage cart and stacked arms built from the repo's REAL rifles." },
  { id: "range", shot: "range", label: "SILHOUETTES AT 900 m",
    focus: "The whole reason for the far LOD: four outposts at navigation range. Each must be a DIFFERENT shape — tall+box, spiky, round+flat, flat." },
];

export async function stageProps(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 200);
    }
    return false;
  };

  let S = window.__propSeq;
  if (!S) {
    /* THE GALLERY BUILDS ITSELF, ON ITS OWN SCHEDULE. props.js's ?props=1
       entry waits on its LAZY dependency (the studio's military pack, which
       is what the wrecks are actually made of) rather than on a number of
       milliseconds, so this waits on the flag it raises when it is done. A
       fixed sleep here would photograph a plane-shaped hole on a slow box
       and the real plane on a fast one — two sides, two different scenes,
       captioned as if they were the same one. */
    const built = await until(() => window.__warlordPropsReady === true, 180000);
    if (!built) return { ok: false, err: "?props=1 gallery never came up" };

    /* FREEZE THE CLOCK. microboot self-schedules through rAF; stubbing it
       after boot stops the banner cloth and the fire flicker mid-motion, so
       both sides photograph the same frame of the same wave rather than
       whatever phase the wall clock happened to be in. */
    window.requestAnimationFrame = function () { return 0; };
    await wait(250);

    const overlay = document.createElement("div");
    overlay.id = "__propOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f6f1e6;" +
      "text-shadow:0 2px 10px #000,0 0 3px #000;z-index:2147483647;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div>" +
      "<div data-nums></div><div data-source></div>";
    document.body.appendChild(overlay);

    // every DOM layer except the canvas goes away: the menu card, the HUD,
    // the toast rail. The picture is the scene.
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__propOverlay") continue;
      child.style.visibility = "hidden";
    }

    S = window.__propSeq = { overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const sub = input.subject;
  const P = window.__warlordProps;
  if (!P) return { ok: false, err: "W.props never published" };

  // aim through the library's OWN tripod list, so a moved depot moves its
  // own camera and this file never goes stale
  const shot = P.look(sub.shot);
  if (!shot) return { ok: false, err: "no such shot: " + sub.shot };
  const cam = CBZ.camera;
  cam.aspect = input.width / input.height;
  cam.updateProjectionMatrix();
  // core/sky.js parks the sky on a rig that follows the camera; re-seat it by
  // hand now that nothing is running the frame loop.
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else if (CBZ.skyDome && CBZ.skyDome.parent && CBZ.skyDome.parent.position) {
    CBZ.skyDome.parent.position.set(cam.position.x, 0, cam.position.z);
  }

  const measured = P.measure(P.fields || []);
  const audit = P.audit();
  CBZ.renderer.render(CBZ.scene, cam);

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = "position:absolute;top:20px;left:24px;padding:7px 12px;border-radius:7px;" +
    "font-size:12px;font-weight:900;letter-spacing:.14em;background:" + (before ? "#a8442f" : "#1f7d55");
  q("name").textContent = sub.label;
  q("name").style.cssText = "position:absolute;top:60px;left:24px;font-size:28px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = sub.focus;
  q("focus").style.cssText = "position:absolute;top:98px;left:26px;max-width:760px;font-size:13px;font-weight:550;color:#d8cdb6";
  q("nums").textContent = "cover boxes " + measured.coverBoxes +
    " · field draws " + (measured.fieldDraws == null ? "-" : measured.fieldDraws) +
    " · scene draws " + measured.totalDraws +
    " · materials " + audit.materials;
  q("nums").style.cssText = "position:absolute;right:22px;top:22px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname +
    "  ·  rocks: " + audit.rockSource + "  ·  wrecks: " + audit.wreckSource;
  q("source").style.cssText = "position:absolute;bottom:16px;left:26px;color:#b3a68d;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    shot: sub.shot,
    metrics: {
      coverBoxes: measured.coverBoxes,
      fieldDraws: measured.fieldDraws == null ? 0 : measured.fieldDraws,
      sceneDraws: measured.totalDraws,
      materials: audit.materials,
    },
    rockSource: audit.rockSource,
    wreckSource: audit.wreckSource,
    lodGroups: audit.lod,
    camera: { position: shot.eye, target: shot.aim },
  };
}

export default {
  id: "warlord-props",
  page: "games/warlord.html",
  title: "Desert Warlord: the Object Library, Against Its Own Revert",
  description:
    "src/warlord/props.js photographed through its own ?props=1 gallery — the four outposts as recognisable places, five faction banners plus sixty of them, the island's wreckage built from the repo's shipped military models, every cover kind at combat_iq's own dimensions, a 120-rock battlefield, your bivouac, and one wide shot of all four outpost silhouettes at 900 m. The BEFORE side is the same checkout with ?propkit=old, which returns from every factory the flat primitive this game drew before the file existed: an icosahedron rock, one grey box per piece of cover, a bare pole for a banner, a single box for an outpost, and one draw call per flag. coverBoxes counts the colliders combat_iq would actually accept as cover; fieldDraws is the sixty-banner field plus the 120-rock field rendered alone.",
  beforeLabel: "BEFORE · ?propkit=old",
  afterLabel: "AFTER · props.js",
  defaultBefore: "local",
  beforeParams: { propkit: "old" },
  viewport: { width: 1200, height: 760 },
  readyExpression: "window.THREE && window.CBZ && CBZ.warlord && CBZ.warlord.props",
  urlParams: { props: 1, seed: 1337 },
  stageTimeoutMs: 300000,
  metricsNote:
    "coverBoxes: registered colliders passing combat_iq's own cover test (height >= 0.85 m, foot <= 1.2 m, >= 0.7 m across) — cover the fighters can actually use, not scenery. " +
    "fieldDraws: the 60-banner field plus the 120-rock cover field, rendered with everything else hidden. " +
    "sceneDraws is the whole gallery in one frame and RISES on the after side by design — the before side has almost nothing in it to draw.",
  metrics: {
    coverBoxes: { label: "Usable cover boxes", better: "higher" },
    fieldDraws: { label: "Draw calls: 60 banners + 120 rocks", better: "lower" },
    materials: { label: "Shared materials", better: "lower" },
  },
  subjects,
  stage: stageProps,
};
