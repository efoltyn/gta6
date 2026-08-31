/* DESERT WARLORD — THE ISLAND IS BARE.

   OWNER, 2026-08-30, three times, each time after a partial fix:

       "remove all the random debris from the desert the whole pint of these
        beatiful dunes is that theres no debris thats why they were made lol"
       "threre are still rocsk int he desert"
       "remove them"

   desert.js had an instanced, camera-following, hash-placed dressing system —
   rocks, dead brush, rib bones, burnt chassis, about two thousand objects out
   to a kilometre. Two passes tried to keep it and place it correctly: first
   gated on biomeAt, which still left 45.1% of every instance standing on sand
   because the provinces blend and the argmax label lies; then gated on the
   blend weight itself, which got that to zero and left stone on the mesa
   feet and the gravel plain. He looked at that and said remove them.

   He is right about the reference. Every photograph of a sand sea is bare
   ground to the horizon, and what carries it is the SURFACE — the dune law,
   the curvature shading, the ripple bands, the light. Objects strewn over it
   do not add detail, they add clutter, and they destroy the one property that
   makes the landform read as enormous: there is nothing on it to give scale.

   So the system is deleted, not flagged off, and props.js's scatterKit() went
   with it as its only caller. What did NOT go: the oasis palms (a landmark,
   the only thing you navigate by), battlefieldAt's cover boxes (built from
   COVER_BY_BIOME and a positional hash, and they never read the scatter — a
   battle still has rocks to hide behind), and props placed AT outposts.

   WHAT TO LOOK FOR
     · every subject — the after column has NOTHING lying on the ground. Not
       fewer objects: none. `total` is the whole claim and it is zero.
     · the mesa and the reg had the most of it after the last pass; they are
       the shots where the deletion is most visible.
     · the oasis palms must still be there. If they went too, the wrong thing
       was deleted.
*/

/* Read off seed 1337's biomeAt. dune/crest are erg; reg and mesa are where
   the stone is supposed to have gone. */
const PLACE = {
  erg:   { x: -1146, z: 3024 },
  mesa:  { x: 3644,  z: -134 },
};

const subjects = [
  { id: "the-erg", x: PLACE.erg.x, z: PLACE.erg.z, dist: 95, yaw: 0.9, hour: 8.4,
    label: "The Erg — Sand, And Nothing Else On It",
    focus: "The reference shot. BEFORE: rock and dead brush scattered across the dunes at the same density as everywhere else on the island. AFTER: the erg takes nothing at all, because a dune buries whatever lands on it." },

  { id: "the-crest", x: PLACE.erg.x + 240, z: PLACE.erg.z - 180, dist: 42, yaw: 2.1, hour: 7.2,
    label: "A Crest At Low Sun — The Photograph He Sent",
    focus: "Standing on a ridge at the hour his reference was taken. Any dark speck on the windward ramp or in the trough is the thing that was removed; the only texture that belongs at this range is the curvature shading." },

  { id: "the-reg", x: 0, z: 0, findBiome: "gravel", dist: 60, yaw: 0.4, hour: 10.2,
    label: "The Gravel Plain — The Last Place That Still Had Stone",
    focus: "After the blend gate this was where most of the surviving scatter lived, which is why it is the clearest shot of the deletion. The ground colour still says reg; nothing is lying on it." },

  { id: "the-mesa", x: PLACE.mesa.x, z: PLACE.mesa.z, dist: 55, yaw: -2.749, hour: 9.2,
    label: "Rock Country — The Mesa Carries Itself",
    focus: "The argument for keeping boulders anywhere was strongest here: a real mesa sheds its walls into its own spall. It is still the strongest argument and it still lost, because the mesa is a SHAPE and the shape is doing the work — the flat top and the steep side read at a kilometre with nothing at their foot." },
];

async function stageClean(input) {
  const CBZ = window.CBZ, sub = input.subject;
  if (!CBZ || !CBZ.warlord || !CBZ.warlord.desert) return { ok: false, missing: "warlord" };
  const W = CBZ.warlord, D = W.desert, C = W.campaign;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let X = window.__wlClean;
  if (!X) {
    X = window.__wlClean = {
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      // nothing may wander in and start a fight mid-shot
      calm() { for (let i = 0; i < W.state.bands.length; i++) W.state.bands[i].cooldown = 1e9; },

      /* THE MEASUREMENT IS A CENSUS OF WHAT IS LYING ON EACH KIND OF GROUND.
         A screenshot can show that the dunes are clean; only a count can show
         that the material MOVED rather than vanished, and that is the whole
         claim. Walks the live InstancedMeshes the scatter is actually drawing
         and asks biomeAt where each instance stands — so it measures the
         rendered world, not the rule that was supposed to build it. */
      census() {
        const m = { onDune: 0, onSalt: 0, onShore: 0, onRock: 0, onGravel: 0, onWadi: 0,
                    onSand: 0, total: 0 };
        /* THE NAMED GROUP, not the whole island root. The first version of
           this census walked D.root() and counted the oasis palm trunks and
           fronds as scatter — 780 of them, all standing on sand, all correct.
           A number that says the opposite of the truth is worse than none. */
        const rt = D.root && D.root();
        const sc = rt && rt.getObjectByName ? (rt.getObjectByName("wlScatter") || rt) : rt;
        const v = new window.THREE.Vector3(), mat = new window.THREE.Matrix4();
        const root = sc;
        if (root) {
          root.traverse(function (o) {
            if (!o.isInstancedMesh) return;
            for (let i = 0; i < o.count; i++) {
              o.getMatrixAt(i, mat);
              v.setFromMatrixPosition(mat);
              const b = D.biomeAt(v.x, v.z);
              m.total++;
              /* THE HONEST TEST. biomeAt is the argmax province and the
                 provinces blend, so a rock whose label says "gravel" can be
                 standing on ground that is nine-tenths dune and drawn as
                 dune. onSand counts by the BLEND WEIGHT instead, and it is
                 the metric that actually has to reach zero — the label-only
                 version of this rule left 45% of the scatter on sand. */
              if (D.sandiness && D.sandiness(v.x, v.z) > 0.25) m.onSand++;
              if (b === "dune") m.onDune++;
              else if (b === "salt") m.onSalt++;
              else if (b === "shore") m.onShore++;
              else if (b === "rock") m.onRock++;
              else if (b === "gravel") m.onGravel++;
              else if (b === "wadi") m.onWadi++;
            }
          });
        }
        m.dunePct = m.total ? Math.round((m.onDune / m.total) * 1000) / 10 : 0;
        /* THE GUARD ON THE OTHER SIDE. Every count above going to zero is
           also what deleting the oasis palms would look like, and the palms
           are the only thing on this island you navigate by. Counted from the
           whole root, separately, and it must NOT be zero. */
        m.palms = 0;
        if (rt && rt.traverse) {
          rt.traverse(function (o) {
            if (o.isInstancedMesh && o.parent !== sc) m.palms += o.count;
          });
        }
        if (CBZ.renderer && CBZ.renderer.info) {
          m.drawCalls = CBZ.renderer.info.render.calls;
          m.triangles = Math.round(CBZ.renderer.info.render.triangles / 1000);
        }
        return m;
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.renderer && CBZ.camera) { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} }
        await new Promise((r) => setTimeout(r, 900));
      },
      metrics() { return X.census(); },
    };
  }

  for (let t = 0; t < 400 && W.phase() !== "campaign"; t++) await sleep(120);
  if (W.phase() !== "campaign") return { ok: false, missing: "campaign phase (" + W.phase() + ")" };
  X.calm();

  /* THE GRAVEL SUBJECT FINDS ITS OWN GROUND, and it has to: a hardcoded
     coordinate for "somewhere stony" is a coordinate that stops being stony
     the day the province wavelengths are retuned, and then the pair is two
     pictures of sand captioned "a gravel plain". Same spiral on both columns,
     same seed, so both find the same point. */
  let px = sub.x, pz = sub.z;
  if (sub.findBiome) {
    for (let i = 0; i < 4000; i++) {
      const a = i * 2.399963;
      const r = Math.sqrt((i + 0.5) / 4000) * D.RADIUS * 0.9;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (D.biomeAt(x, z) !== sub.findBiome) continue;
      if (D.slopeAt(x, z) > 0.18) continue;
      px = Math.round(x); pz = Math.round(z);
      break;
    }
  }

  W.state.hour = sub.hour;
  W.state.you.x = px; W.state.you.z = pz; W.state.you.yaw = sub.yaw;
  C.camYaw(sub.yaw); C.camDist(sub.dist);
  X.calm();
  // seven clipmap levels rebuild one per frame, plus the scatter refill
  X.step(34);
  X.calm();
  return { ok: true, at: px + "," + pz, biome: D.biomeAt(px, pz) };
}

export default {
  id: "warlord-clean",
  title: "Desert Warlord: An Erg Has Nothing On It",
  description:
    "The BEFORE column is origin/main served from its own worktree; the AFTER is this one. Same seed, same coordinates, same camera, same hour, weather held off on both. The only difference is desert.js's scatter rule: it used to place rock, brush, bone and wreck on every biome but the salt pan, which put gravel on the dune slip faces. It now places nothing on sand, salt or beach, and puts that material where it occurs — the mesa foot, the gravel plain, the wadi.",
  page: "games/warlord.html",
  beforeLabel: "BEFORE · origin/main",
  afterLabel: "AFTER · scatter obeys the geology",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.desert && CBZ.warlord.desert.heightAt)",
  urlParams: { go: 1, seed: 1337, weather: "off" },
  stageTimeoutMs: 420000,
  subjects,
  stage: stageClean,
  pairNote: "seed 1337 · same coordinates · same camera · same hour — the scatter rule is the only variable",
  method:
    "Two servers, two checkouts: origin/main on one port and this tree on the other, both booted with ?go=1&seed=1337&weather=off. The preset teleports the player to fixed world coordinates, sets the hour and the camera through the campaign's own API, and advances CBZ.stepSim for 34 frames so the seven clipmap levels and the scatter refill settle identically on both sides. The gravel subject SEARCHES for its ground on a seeded spiral rather than using a typed coordinate, so it photographs a real gravel plain on both columns even if the province fields are ever retuned.",
  metrics: {
    total:    { label: "Objects lying on the ground, anywhere", unit: "instances", better: "lower" },
    onSand:   { label: "…of those, standing on sand (by blend, not label)", unit: "instances", better: "lower" },
    onDune:   { label: "…on ground labelled dune", unit: "instances", better: "lower" },
    onSalt:   { label: "Objects on the salt pan", unit: "instances", better: "lower" },
    onShore:  { label: "Objects on the beach", unit: "instances", better: "lower" },
    onRock:   { label: "Objects in rock country", unit: "instances" },
    onGravel: { label: "Objects on the gravel plain", unit: "instances" },
    onWadi:   { label: "Objects in the wadi", unit: "instances" },
    palms:    { label: "Oasis palms still standing", unit: "instances" },
    dunePct:  { label: "Share of all scatter that is on sand", unit: "%", better: "lower" },
    drawCalls: { label: "Draw calls", unit: "calls" },
    triangles: { label: "Triangles submitted", unit: "k tris" },
  },
  metricsNote:
    "total is the whole claim and it has to be zero — not lower, zero. onSand and the per-biome counts are kept so a future pass that re-adds a scatter cannot quietly re-add it to the sand: they were the numbers that caught the first two attempts. palms is the guard on the other side, because the oasis trees are instanced under the same root and deleting them would look, in every other metric, like success. OLD NOTE: onDune is the whole claim and it has to reach zero: an erg is mobile ground and buries what lands on it. onRock and onGravel are where that material went, and they are deliberately NOT declared better:lower — a gravel plain with nothing on it is not a gravel plain, and a gate that rewarded emptiness there would be gating the wrong thing. total may move either way: the per-cell candidate count went up to pay for three biomes now taking nothing at all.",
};
