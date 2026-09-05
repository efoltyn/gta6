/* President-mode LOOP storyboard — the scenes the president wave adds on top
   of the compound: the podium on the stylobate, the state car in the court,
   the attack that comes to the gate, and the banners a dictatorship hangs.

   Built on president-compound.mjs's stage (same boot, same site-local
   tripods). Each subject may carry `pre`: a STRING of page-side JS run after
   the world is booted and before the tripod is set — a string because
   subjects travel to the page as JSON. `pre` gets `CBZ`, `site`, `tick(n)`,
   `newDay()`.

     node tools/visual-compare.mjs --preset president-loop --before local \
          --only after --no-open --keep-going */
import base from "./president-compound.mjs";

const subjects = [
  {
    id: "motorcade-court",
    label: "The Motorcade Waits",
    focus: "A real black state car on the motor-court ring, a chauffeur beside it, the perron behind. The car is stealable, drivable, and the E on the chauffeur is the fast way across a 4.7 km country.",
    cam: { x: -6, y: 2.2, z: -4, ax: 14, ay: 1.0, az: 26 },
    player: { x: 0, y: 0.08, z: 6 },
  },
  {
    id: "podium-address",
    label: "Address From the Perron",
    focus: "The podium stands on the stylobate on the door axis; press and crowd gather in front of it while the task is live. E here is the SAME order as the Situation Room's ADDRESS pad.",
    pre: "newDay(); tick(240); CBZ.player.pos.set(site.cx, 0.31, site.cz - 11);",
    cam: { x: 9, y: 2.4, z: 4, ax: 0, ay: 1.4, az: -13 },
    player: { x: 0, y: 0.31, z: -11 },
  },
  {
    id: "gate-attack",
    label: "The Threat Comes to the Gate",
    focus: "An armed cell attack targets the Executive Mansion's own gate and arrives as bodies in a car, not as a headline. The Mansion detail answers.",
    pre: "CBZ.player.pos.set(site.cx, 0.1, site.cz + 18); var gate = site.gate; for (var d = 0; d < 4; d++) { CBZ.presidency._armAttack(); var s = CBZ.presidency.status(); if (/mansion|gate/i.test(String(s.threat.target||''))) break; newDay(); } tick(1500);",
    cam: { x: -10, y: 3.2, z: 96, ax: 0, ay: 1.2, az: 130 },
    player: { x: 0, y: 0.08, z: 90 },
  },
  {
    id: "regime-banners",
    label: "The One State Hangs Its Banners",
    focus: "Declared a dictatorship, the compound changes from the motor court: banners on the gatehouse and facade, a leader plate over the door, barriers across the court entrance.",
    pre: "var h = CBZ.presidency.seat(); if (h) h.rec.govType = 'dictatorship'; tick(300);",
    cam: { x: 0, y: 5.8, z: 78, ax: 0, ay: 6.8, az: -34 },
    player: { x: 0, y: 0.08, z: 20 },
  },
  {
    id: "regime-gatehouse",
    label: "The Gatehouse Under the Regime",
    focus: "Close on the gate: banners, searchlights, sandbags. The republic's gatehouse was a stone box with a barrier.",
    pre: "var h = CBZ.presidency.seat(); if (h) h.rec.govType = 'dictatorship'; tick(300);",
    cam: { x: -18, y: 3.0, z: 100, ax: 0, ay: 2.5, az: 116 },
    player: { x: 0, y: 0.08, z: 92 },
  },
];

// The page receives `(stage.toString())(input)`, so the stage must be one
// self-contained function: the base stage's source is inlined into it.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const stage = new AsyncFunction("input", `
  const baseStage = (${base.stage.toString()});
  const first = await baseStage(input);          // boots the world on first call, frames the tripod
  if (!first || !first.ok || !input.subject.pre) return first;
  const CBZ = window.CBZ;
  const site = CBZ.presidency && CBZ.presidency.site ? CBZ.presidency.site() : null;
  if (!site) return first;
  const tick = (n) => { for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 90); CBZ.player.dead = false; } } };
  const newDay = () => { CBZ.polity._checkDayWrap(0.95); CBZ.polity._checkDayWrap(0.05); tick(120); return CBZ.worldDay(); };
  try { (new Function("CBZ", "site", "tick", "newDay", input.subject.pre))(CBZ, site, tick, newDay); }
  catch (e) { return { ok: false, err: "pre failed: " + (e && e.message) }; }
  return baseStage(input);                       // re-frame and render after the scene was staged
`);

export default {
  ...base,
  id: "president-loop",
  title: "President Mode — The Loop",
  description: "The scenes the president wave adds: motorcade, podium address, an attack at the gate, and the compound under a dictatorship.",
  subjects,
  stage,
  transformReferenceStage: undefined,
};
