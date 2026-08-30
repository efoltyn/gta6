/* DESERT WARLORD — AN ERG HAS NOTHING ON IT.

   OWNER, 2026-08-30, with two photographs of the Rub al Khali and one of a
   man standing on a dune crest:

       "remove all the random debris from the desert the whole pint of these
        beatiful dunes is that theres no debris thats why they were made lol"

   He is describing a real property of sand seas, not a preference. An erg is
   MOBILE: a dune migrates metres a year, so anything that falls on one is
   buried within a season or left behind on the interdune floor. There is no
   gravel on a slip face anywhere on Earth. Every one of his references — the
   Sentinel-2 overhead, the crest at sunrise, the ripple field — is unbroken
   sand to the horizon, and the only texture in any of them is wind ripple.

   desert.js's scatter did not know that. It placed rocks, dead brush, bones
   and wrecks on every biome except the salt pan, at one density, which put a
   field of pebbles and twigs across the dunes AND left the gravel plain — a
   reg, a stone pavement, the one landform that IS scattered rock — looking
   exactly the same as the sand.

   So the material was not deleted, it was MOVED to where it occurs: the mesa
   country where boulders spall off the walls, the gravel plain, and the wadi
   floor where the water is and therefore where the brush is. Dune, pan, beach
   and oasis take nothing.

   THE BEFORE IS THE DEPLOYED BUILD, not a flag: this is a placement rule, and
   a flag for it would be a second placement rule to keep alive. Both columns
   are seed 1337, the same six coordinates, the same camera, the same hour,
   `?weather=off` on both so a sandstorm cannot roll into one of them.

   WHAT TO LOOK FOR
     · the erg    — before: specks all over the sand, including on the slip
                    faces. after: nothing but the dune and its own shadow.
     · the crest  — the shot closest to his photograph. Any dark speck on the
                    windward ramp is the bug.
     · the reg    — the gravel plain should now be VISIBLY the stony one; if
                    the two columns look the same here the material did not
                    move, it just went away.
     · rock       — the mesa foot should have MORE on it than before, not less.
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
    label: "The Gravel Plain — Where The Stone Actually Went",
    focus: "A reg is a stone pavement; that is what the landform is. It used to carry the same thin scatter as the dunes. It now carries the density the dunes were wasting, which is the half of this change that is not a deletion." },

  { id: "the-mesa", x: PLACE.mesa.x, z: PLACE.mesa.z, dist: 55, yaw: -2.749, hour: 9.2,
    label: "Rock Country — Boulders Belong At A Mesa Foot",
    focus: "Real mesas shed their walls into their own spall. This is the biome that should have gained, not lost: if the after side is emptier here the rule is inverted." },
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
        const m = { onDune: 0, onSalt: 0, onShore: 0, onRock: 0, onGravel: 0, onWadi: 0, total: 0 };
        const sc = D.root && D.root();
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
    onDune:   { label: "Objects lying on the dunes", unit: "instances", better: "lower" },
    onSalt:   { label: "Objects on the salt pan", unit: "instances", better: "lower" },
    onShore:  { label: "Objects on the beach", unit: "instances", better: "lower" },
    onRock:   { label: "Objects in rock country", unit: "instances" },
    onGravel: { label: "Objects on the gravel plain", unit: "instances" },
    onWadi:   { label: "Objects in the wadi", unit: "instances" },
    dunePct:  { label: "Share of all scatter that is on sand", unit: "%", better: "lower" },
    total:    { label: "Scatter instances drawn", unit: "instances" },
    drawCalls: { label: "Draw calls", unit: "calls" },
    triangles: { label: "Triangles submitted", unit: "k tris" },
  },
  metricsNote:
    "onDune is the whole claim and it has to reach zero: an erg is mobile ground and buries what lands on it. onRock and onGravel are where that material went, and they are deliberately NOT declared better:lower — a gravel plain with nothing on it is not a gravel plain, and a gate that rewarded emptiness there would be gating the wrong thing. total may move either way: the per-cell candidate count went up to pay for three biomes now taking nothing at all.",
};
