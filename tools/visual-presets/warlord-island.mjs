/* DESERT WARLORD — THE ISLAND, photographed against its own one-flag revert.

   THE CLAIM UNDER TEST. `src/warlord/desert.js` says a desert island read
   from 60 m up needs SIX terrain laws and not one noise octave with a name
   on it: an erg of asymmetric transverse dunes whose amplitude and spacing
   are their own fields, flat-topped mesas with steep sides, a cracked salt
   pan, a wadi system cut below whatever it crosses, a gravel plain, and a
   shoreline that ramps into water instead of falling off a cliff into it.
   Plus oases, because a desert with no landmarks cannot be navigated.

   THE BEFORE IS THAT FILE'S OWN REVERT PARAM. `?terrain=plain` is a real
   shipped flag: it collapses the whole province system to a single value-
   noise octave and skips the mesas, the wadis and the pan. Both columns are
   THIS checkout, same seed, same coordinates, same camera, same hour — so
   every pixel of difference is the terrain wave and nothing else. There is
   no deployed build in the loop because this game did not exist before this
   branch, and "before" would otherwise mean "a different game".

   `?weather=off` is set on BOTH sides. events.js ships sandstorms and heat
   haze, and a storm rolling in on one column and not the other would be a
   second variable in a comparison that is supposed to have one. It is that
   module's own flag, used here to hold it still.

   THE COORDINATES ARE HARDCODED, and that is not laziness — it is the only
   honest option. The subjects are named after BIOMES, and on the before side
   `biomeAt` answers "dune" everywhere by construction, so a preset that
   searched for "somewhere rocky" would photograph two different places and
   caption them as one. These six points were read off seed 1337's real
   biome map and they are the same six world coordinates in both columns.

   WHAT TO LOOK FOR IN EACH PAIR, because the numbers cannot see it:
     · the erg      — do the crests run in ranks, with a long windward ramp
                      and a short steep lee, or is it lumpy noise?
     · the mesas    — is the top FLAT and the side STEEP, or is it a hill?
     · the pan      — is it dead level and pale, with cracks?
     · the oasis    — is there water in the bottom of a real bowl?
     · the shore    — is there a beach, or a cliff into a blue plane?
     · the column   — can you tell sixty men from six at strategic range?
*/

/* Read off seed 1337's biomeAt/heightAt. The seventh (`army`) deliberately
   reuses the erg: the trail shot has to be somewhere you can see a long way. */
const PLACE = {
  erg:    { x: -1146, z: 3024 },
  // a rock-province stand with 59 m of height range inside 400 m, found by
  // scanning seed 1337 for somewhere a mesa is actually IN SHOT rather than
  // somewhere the biome field merely says "rock"
  // stands on FLAT LOW ground with a 68 m mesa 440 m away whose top is flat
  // to within 0.0 m across 80 m — found by scanning seed 1337 for a place the
  // mesa law can be SEEN rather than stood on. The two earlier passes both
  // put the camera on top of the mesa and photographed its roof.
  mesa:   { x: 3644,  z: -134 },
  salt:   { x: -2915, z: 3824 },
  // 210 m out from AIN ZAHRA on a +X+Z bearing, so yaw -2.36 looks straight
  // down into the bowl. The first pass stood here and faced the other way,
  // and the pair was two pictures of empty sand captioned "an oasis".
  oasis:  { x: -5611, z: 1191 },
  shore:  { x: 4797,  z: -3581 },
  wadi:   { x: 901,   z: 4518 },
};

const subjects = [
  {
    id: "dune-erg", x: PLACE.erg.x, z: PLACE.erg.z, dist: 95, yaw: 0.9, hour: 8.4,
    label: "The Erg — Ranks Of Dunes, Not Lumps",
    focus: "Same spot, same camera. BEFORE: one value-noise octave, so the ground is bumpy and directionless. AFTER: transverse dunes in ranks with a long windward ramp and a short steep lee, spacing and height varying across the field, and curvature shading putting the troughs in shadow.",
  },
  {
    id: "mesa-field", x: PLACE.mesa.x, z: PLACE.mesa.z, dist: 55, yaw: -2.749, hour: 9.2,
    label: "Rock Country — Flat Tops, Steep Sides",
    focus: "The mesa law: a narrow smoothstep band makes the walls, and the plateau height is a QUANTISED field so tops are tables at 30/50/70 m rather than the undulation of the ground underneath. BEFORE has no rock law at all.",
  },
  {
    id: "salt-pan", x: PLACE.salt.x, z: PLACE.salt.z, dist: 70, yaw: 0.3, hour: 12.0,
    label: "The Salt Pan — The One Place With No Cover",
    focus: "Two centimetres of relief on purpose: the pan is the surface with nowhere to hide, and battlefieldAt returns two cover boxes here against twenty-six in rock country. The polygon cracks are painted, not modelled.",
  },
  {
    id: "oasis", x: PLACE.oasis.x, z: PLACE.oasis.z, dist: 120, yaw: -2.36, hour: 10.0,
    label: "An Oasis — The Landmark You Navigate By",
    focus: "A genuine bowl dug 11 m into the terrain with water in the bottom and palms round it, placed by rejection sampling so its water surface can never fall below the sea plane. BEFORE has no bowl, no water and no palms — just sand where the oasis is supposed to be.",
  },
  {
    id: "shoreline", x: PLACE.shore.x, z: PLACE.shore.z, dist: 60, yaw: 2.6, hour: 16.5,
    label: "The Shore — A Beach, Not A Cliff Into Blue",
    focus: "The land walks down to the waterline over 150 m at about 1:20 and the bottom drops away fast beyond it (a shallow shelf at six kilometres cannot be separated from the sea surface by the depth buffer, and the horizon rendered as a comb of stripes until it did).",
  },
  {
    id: "army-trail", x: PLACE.erg.x, z: PLACE.erg.z, dist: 150, yaw: 1.15, hour: 9.0, army: 180, ride: 1,
    label: "The Column — The Whole Fantasy, At Strategic Range",
    focus: "181 men riding an erg. The followers walk the breadcrumb of where the player HAS ACTUALLY BEEN, so the column bends through the terrain instead of sliding after him; 60 are drawn out of a roster of 181, instanced into two draw calls. Party bodies scale with the pull-back because a life-sized man at 150 m is two pixels.",
  },
  {
    id: "world-map", x: PLACE.erg.x, z: PLACE.erg.z, dist: 150, yaw: 1.15, hour: 9.0, map: 1,
    label: "The Map — territory.js's Ownership Layer Over This Island",
    focus: "The MAP button belongs to territory.js when it is loaded, and it paints its openfront-style regions straight over W.desert.mapTexture — which samples the SAME heightAt and biomeAt the 3D reads. Look at the REGION NAMES: after, the island has a salt pan, a dry river, a hardpan and stony ground because the province system gave it that geography; before, everything the one-octave terrain can offer is another stretch of dunes.",
  },
];

async function stageIsland(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.warlord || !CBZ.warlord.desert) return { ok: false, missing: "warlord" };
  const W = CBZ.warlord, D = W.desert, C = W.campaign;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let X = window.__wlBA;
  if (!X) {
    X = window.__wlBA = {
      /* CBZ.stepSim is the only clock. The page's own rAF keeps rendering —
         which is what actually presents a frame under SwiftShader — but every
         SIMULATED second here is one this preset asked for, so both columns
         photograph the same moment however fast the machine is. */
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      /* Nothing may wander into the shot and start a fight. The campaign's
         contact test is the same code in both columns, so an encounter card
         over one of them would void the pair. */
      calm() { for (let i = 0; i < W.state.bands.length; i++) W.state.bands[i].cooldown = 1e9; },
      metrics(px, pz) {
        const m = {};
        // how much of the island is actually different ground
        const seen = {};
        let n = 0, lo = 1e9, hi = -1e9, steep = 0, land = 0;
        for (let i = 0; i < 3000; i++) {
          const a = (i * 0.618033988) * Math.PI * 2;
          const r = Math.sqrt((i + 0.5) / 3000) * D.RADIUS * 0.95;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          const b = D.biomeAt(x, z);
          if (b === "sea") continue;
          land++;
          seen[b] = 1;
          const y = D.heightAt(x, z);
          if (y < lo) lo = y;
          if (y > hi) hi = y;
          if (D.slopeAt(x, z) > 0.34) steep++;
          n++;
        }
        m.biomeKinds = Object.keys(seen).length;
        m.heightSpanM = Math.round(hi - lo);
        m.brokenGroundPct = Math.round((steep / Math.max(1, land)) * 1000) / 10;
        m.oases = D.oases.length;
        // the relief of the ground actually in frame, at battle scale
        const bf = D.battlefieldAt(px, pz, 170);
        m.frameReliefM = Math.round(bf.relief * 100) / 100;
        m.frameCover = bf.cover.length;
        if (CBZ.renderer && CBZ.renderer.info) {
          m.drawCalls = CBZ.renderer.info.render.calls;
          m.triangles = Math.round(CBZ.renderer.info.render.triangles / 1000);
        }
        // what heightAt costs, because "analytic and cheap" is a claim
        const t0 = performance.now();
        let acc = 0;
        for (let i = 0; i < 20000; i++) acc += D.heightAt((i % 137) * 31.7 - 2000, ((i / 137) | 0) * 27.3 - 2000);
        m.heightAtUs = Math.round(((performance.now() - t0) * 1000 / 20000) * 1000) / 1000;
        if (acc === 12345.6789) m.heightAtUs += 0;   // keep the loop
        return m;
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.renderer && CBZ.camera) {
          try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
        }
        await new Promise((r) => setTimeout(r, 900));
      },
      metrics() { return X.metrics(X.lastX || 0, X.lastZ || 0); },
    };
  }

  // ---- boot: the shell's ?go=1 already put us on the island -------------
  for (let t = 0; t < 400 && W.phase() !== "campaign"; t++) await sleep(120);
  if (W.phase() !== "campaign") return { ok: false, missing: "campaign phase (" + W.phase() + ")" };
  X.calm();

  // ---- the roster, for the subject that is about the roster -------------
  if (sub.army && W.state.army.length < sub.army) {
    for (let i = W.state.army.length; i < sub.army; i++) {
      W.addSoldier(W.makeSoldier(i % 4 === 0 ? "veteran" : i % 3 === 0 ? "soldier" : i % 2 ? "raider" : "levy", "carbine"));
    }
  }

  const p = { x: sub.x, z: sub.z };
  X.lastX = p.x; X.lastZ = p.z;
  W.state.hour = sub.hour;
  W.state.you.x = p.x; W.state.you.z = p.z; W.state.you.yaw = sub.yaw;
  C.camYaw(sub.yaw); C.camDist(sub.dist);
  X.calm();
  /* Seven clipmap levels rebuild one per frame by design, so a teleport
     needs at least seven frames before the ground under the camera is the
     ground it is standing on. Thirty, to also settle the camera lerp and the
     scatter refill. */
  X.step(30);

  if (sub.ride) {
    /* LAY A REAL TRAIL. The column follows breadcrumbs of where the player
       has been, so the shot has to have BEEN somewhere — it cannot be posed.
       He rides on the same destination on both sides for the same simulated
       seconds, which is the only way the two columns are comparable. */
    C.dest(p.x + Math.sin(sub.yaw) * 900, p.z + Math.cos(sub.yaw) * 900);
    for (let i = 0; i < 12; i++) { X.calm(); X.step(30); }
    C.camYaw(sub.yaw); C.camDist(sub.dist);
    X.step(6);
  }

  if (sub.map) {
    // the fallback world map is this file's own; territory.js takes the
    // button when it is loaded, so open the canvas directly rather than
    // photographing whatever module happens to own the key today
    const cv = document.getElementById("wlMapC");
    if (W.campaign.map) W.campaign.map();
    X.step(2);
    await sleep(300);
  } else {
    const mw = document.getElementById("wlMap");
    if (mw) mw.classList.remove("on");
  }

  X.step(3);
  await sleep(250);
  if (CBZ.renderer && CBZ.camera) CBZ.renderer.render(CBZ.scene, CBZ.camera);

  const cam = CBZ.camera;
  return {
    ok: true,
    camera: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
    place: p,
    metrics: X.metrics(p.x, p.z),
  };
}

export default {
  id: "warlord-island",
  title: "Desert Warlord: Fourteen Kilometres Of Analytic Sand",
  description:
    "Both columns are THIS checkout on seed 1337 with weather held off. The before side boots with ?terrain=plain — desert.js's own one-line revert, which collapses the province system to a single value-noise octave and drops the mesas, the wadis, the salt pan and the oasis bowls. The after side is the shipping island. Same six world coordinates, same cameras, same in-game hour, same simulated seconds.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { terrain: "plain" },
  beforeLabel: "BEFORE · ?terrain=plain (one noise octave)",
  afterLabel: "AFTER · SIX TERRAIN LAWS",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.desert && CBZ.warlord.desert.heightAt)",
  urlParams: { go: 1, seed: 1337, weather: "off" },
  // the first stage pays the whole studio + armoury + eight module boot and
  // then raises 14 km of terrain; under software WebGL that is minutes.
  stageTimeoutMs: 420000,
  pairNote: "Same checkout · seed 1337 · same coordinates · same camera · same hour — ?terrain=plain is the only variable",
  method:
    "Both sides are this checkout served by the same local server. The before side adds ?terrain=plain, the revert switch desert.js ships for its own province system. The page's ?go=1 boots straight onto the island; the preset then teleports the player to six hardcoded world coordinates (read off seed 1337's real biome map, so both columns photograph the same ground), sets the in-game hour, sets the camera's yaw and pull-back through the campaign's own public API, and advances the world with CBZ.stepSim so the clipmap and the camera settle over the same simulated seconds on both machines. The column shot RIDES rather than posing, because the followers walk breadcrumbs of where the player has actually been.",
  metricsNote:
    "biomeKinds is the whole argument in one integer: how many genuinely different kinds of ground a 3 000-point scan of the island finds. brokenGroundPct is the share of land too steep for a man to walk — mesa walls and dune slip faces — which is what turns terrain into routes. frameReliefM and frameCover come from battlefieldAt at the photographed spot — the peak-to-peak relief of a battle-sized patch and how many cover boxes battle.js would get there. Neither declares a preferred direction ON PURPOSE: they are supposed to go UP in rock country and DOWN on the salt pan, because a pan with cover on it is not a pan, and a gate that called that a regression would be gating the wrong thing. drawCalls has no direction either — the after side pays about ten more for the oasis water, the palms and the scatter, on a page that draws the whole island in under a hundred. heightAtUs is the cost of the claim (the function is called thousands of times a frame) and the after side does more work on purpose.",
  metrics: {
    biomeKinds: { label: "Distinct kinds of ground on the island", unit: "biomes", better: "higher" },
    heightSpanM: { label: "Height range across the island", unit: "m", better: "higher" },
    brokenGroundPct: { label: "Land too steep to walk", unit: "%", better: "higher" },
    oases: { label: "Oases with water and palms", unit: "count", better: "higher" },
    frameReliefM: { label: "Relief of the ground in frame", unit: "m peak-to-peak" },
    frameCover: { label: "Cover battle.js gets at this spot", unit: "boxes" },
    drawCalls: { label: "Draw calls", unit: "calls" },
    triangles: { label: "Triangles submitted", unit: "k tris" },
    heightAtUs: { label: "Cost of one heightAt", unit: "µs" },
  },
  subjects,
  stage: stageIsland,
};
