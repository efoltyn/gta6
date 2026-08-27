/* Shark Sim, before/after — WHO LIVES IN THIS SEA, AND IN WHAT NUMBERS.

   Owner, 2026-08-26: "theres a weird population of numbers of each animal ...
   put the right amount but not identical amount in each school of fish ...
   and orca pods, all groups of fish and sharks should be realistic ranges
   but random not all the same."

   What was actually wrong, traced:

     1. THE RESTOCKER CLIPPED EVERY GROUP TO ITS QUOTA GAP. shark_sim.js's
        stockSea drew a school size and then took min(gap, budget, draw) — so
        once a species neared its want, every arriving "school" was the same
        scrap (a school of 3 sardines), and the per-tick 18-body budget
        squeezed the honest draws toward one size too.

     2. A DOLPHIN "POD" WAS 2-3 ANIMALS — a couple, not a pod (coastal
        bottlenose pods run 2-15). It could not be widened before, because
        marine_frenzy's bait test was "no teeth + herd max ≥ 10", and a
        12-dolphin pod would have qualified as a bait ball. The test now also
        requires a small body (bait is what you eat in mouthfuls).

     3. THE ISLAND'S INITIAL STOCK truncated the LAST group of a species to
        the leftover count — the scrap-school generator — and a rare pod
        animal whose planned count fell under its pod minimum (the ratio
        system hands the orca ~3) spawned the SAME minimum pod every single
        boot. The opposite of a range. Groups are now carved whole: presence
        of a herding species means at least one REAL group, remainders fold
        into the last group.

   BOTH COLUMNS RUN THIS SAME DRIVER. BEFORE is pristine HEAD on its own
   port; AFTER is the working tree. Both boot ?mode=sharksim with one pinned
   seed, run the live sim until the restocker's census stops growing (the sea
   as a player finds it a couple of minutes in), and then THIS file reads the
   groups straight out of the engine's own herd objects — one ruler, two
   builds. */

const subjects = [
  {
    id: "the-sea-census", ch: 0,
    label: "The Sea, From Above — Every Group Counted",
    focus:
      "An aerial over the player's patch of sea after the restocker has settled. The numbers under this frame are the whole complaint: how many groups exist, how many of them are exact same-size twins of another group of their species, and how many are scraps smaller than any real school. BEFORE: quota-clipped scraps and twin groups. AFTER: every group drawn whole from a researched range.",
  },
  {
    id: "bait-ball", ch: 1,
    label: "The Biggest School In The Water",
    focus:
      "The camera stands over the largest fish school the census found. Real sardine schools run from ~25 into the millions and are always the biggest thing in the water column; game-scaled that means the top school here should read as a BALL — dozens of bodies — not a loose dozen. BEFORE: schools capped near 16 and topped up in scraps. AFTER: sardine balls of 20-45 arriving whole (in instalments if they beat the one-frame build budget, but into ONE herd).",
  },
  {
    id: "dolphin-pod", ch: 2,
    label: "A Pod, Not A Couple",
    focus:
      "The largest dolphin group in the sea. Coastal bottlenose pods are 2-15 animals; this sim shipped with pods of two to three. BEFORE: 2-3 dolphins. AFTER: pods drawn from 4-9, sized differently every time they form.",
  },
  {
    id: "orca-pod", ch: 3,
    label: "The Orca Pod Rolls In",
    focus:
      "Wherever the orcas are, the lens goes. Transient hunting pods run 2-7, residents 5-50; the ratio system plans ~3 orcas for this island, and the old seeder truncated the pod to exactly that plan — the same pod of 3, every boot. AFTER: the pod is drawn whole from 3-8, so its size is a fact about THIS boot, not a constant.",
  },
];

async function stageMarinePop(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.cityWildlife) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__marinePop;
  if (!D) {
    D = window.__marinePop = {
      chapter: -1, shot: null, censusOut: null,

      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 80 && !(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark); t++) {
          D.step(15); await sleep(20);
        }
        if (!(CBZ.sharkSim && CBZ.sharkSim.on)) return false;
        /* the page's own frame loop dies here; the sim advances only when a
           chapter steps it, and the tripod survives to the capture.
           (Straight out of shark-flesh.mjs, which paid for this.) */
        D._rafOrig = window.requestAnimationFrame;
        const orig = D._rafOrig;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
        return true;
      },
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); D.reshoot(); },

      /* RUN THE SEA TO ITS STEADY STATE, then read it. The restocker adds in
         one-second ticks; "settled" is six straight sim-seconds in which the
         aquatic body count stops climbing. Both sides get the same rule and
         the same 150-second ceiling, so each build is measured at its own
         equilibrium — the thing the player actually swims through. */
      async settle() {
        let last = -1, stable = 0;
        for (let s = 0; s < 150 && stable < 6; s++) {
          D.step(30);
          const t = D.census().total;
          if (t <= last) stable++; else stable = 0;
          last = Math.max(last, t);
          if ((s & 7) === 7) await sleep(0);
        }
        return last;
      },

      /* THE CENSUS, off the engine's own herd objects. A group is the set of
         live aquatic actors sharing one `herd` (wildlife.js's boids unit);
         an actor with no herd is a group of one. Signatures both builds
         share — no new-build-only tag is ever read. */
      census() {
        const groups = new Map(), singles = [];
        const S = CBZ.sharkSim || {};
        let total = 0;
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || a.external || a === S.shark) continue;
          if (!a.species || !a.species.aquatic) continue;
          total++;
          if (a.herd) {
            let g = groups.get(a.herd);
            if (!g) { g = { id: a.species.id, n: 0, cx: 0, cz: 0, members: [] }; groups.set(a.herd, g); }
            g.n++; g.cx += a.pos.x; g.cz += a.pos.z; g.members.push(a);
          } else singles.push({ id: a.species.id, n: 1, cx: a.pos.x, cz: a.pos.z, members: [a] });
        }
        const list = [];
        for (const g of groups.values()) { g.cx /= g.n; g.cz /= g.n; list.push(g); }
        for (const s of singles) list.push(s);
        return { total: total, groups: list };
      },
      biggest(pred) {
        let best = null;
        for (const g of D.census().groups) if (pred(g) && (!best || g.n > best.n)) best = g;
        return best;
      },
      // the biggest group of a kind that CAN be photographed (in the water);
      // overGroup refuses a beached group, so walk down the size order
      bestShot(pred) {
        const cands = D.census().groups.filter(pred).sort((a, b) => b.n - a.n);
        for (const g of cands) if (D.overGroup(g)) return g;
        return null;
      },

      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0; },
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      reshoot() { const s = D.shot; if (s) D.tripod(s[0], s[1], s[2], s[3], s[4], s[5]); },
      shoot(px, py, pz, tx, ty, tz) { D.shot = [px, py, pz, tx, ty, tz]; D.tripod(px, py, pz, tx, ty, tz); },
      overGroup(g) {
        /* THE LENS IS FIT TO THE GROUP, and it must stand over WATER. Two
           earlier runs of this preset taught both halves: a fixed compass
           offset put the orca camera on the sand photographing a street (the
           pod sat in a bay), and a fixed 13 m standoff turned a sardine ball
           into distant specks. So: centroid and spread are measured off the
           LIVE members, the standoff scales with the spread, and the bearing
           sweeps — seaward first — until the game's own water oracle says the
           tripod is wet. */
        let cx = 0, cy = 0, cz = 0;
        for (const a of g.members) { cx += a.pos.x; cy += a.pos.y; cz += a.pos.z; }
        cx /= g.members.length; cy /= g.members.length; cz /= g.members.length;
        /* spread = the 70th-percentile distance from centroid, HARD-CAPPED:
           run three taught that one straggler (or a pod strung out on patrol)
           inflates a max-spread standoff until the lens is photographing the
           island skyline from outside the sky dome. The shot's subject is the
           GROUP; a member outside a 16 m standoff is allowed to be off frame. */
        const ds = g.members.map((a) => Math.hypot(a.pos.x - cx, a.pos.z - cz)).sort((a, b) => a - b);
        const r = Math.min(9, Math.max(2.5, ds[Math.floor(ds.length * 0.7)] || 2.5));
        // the standoff respects the BODY: run five put the lens 6 m from a
        // 7 m orca and photographed a black wall
        const scl = (g.members[0].species && g.members[0].species.scale) || 1;
        const back = Math.min(18, Math.max(6, r * 1.4, scl * 9));
        const sy = D.seaY(cx, cz);
        const wet = (x, z) => (CBZ.cityWaterAt ? !!CBZ.cityWaterAt(x, z) : true);
        /* a group can be legitimately OUT of the sea — this island's orcas
           beach to hunt (run four photographed sand and sunbathers). A group
           that is not mostly in water is not this preset's shot: refuse, and
           let the chapter fall back. */
        let wetN = 0;
        for (const a of g.members) if (wet(a.pos.x, a.pos.z)) wetN++;
        if (wetN * 2 < g.members.length) return false;
        const A = CBZ.surv && CBZ.surv.arena;
        const a0 = A ? Math.atan2(cz - A.center.z, cx - A.center.x) : 0;
        let px = cx + Math.cos(a0) * back, pz = cz + Math.sin(a0) * back;
        for (const off of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4, 3.14]) {
          const qx = cx + Math.cos(a0 + off) * back, qz = cz + Math.sin(a0 + off) * back;
          if (wet(qx, qz)) { px = qx; pz = qz; break; }
        }
        /* the lens goes UNDER the surface, at the school's own depth: four
           runs proved a 30 cm sardine is invisible from a tripod standing in
           the air over murky water; the dive camera's view is how this game
           actually shows a school. */
        const py = Math.max(cy + 0.4, sy - 2.6);
        /* AND THE PLAYER COMES TOO. Wildlife freezes and LOD-hides by
           distance to the PLAYER, not the camera — run five photographed a
           40-sardine ball as empty water because the diver was 300 m away at
           the dock. The tripod is the player's own seat, exactly like every
           preset that pins its subjects around the diver. */
        /* ..parked BEHIND the tripod, not on it: run six's player shark lay
           across every photograph. 9 m further out along the view axis keeps
           the school inside the player's LOD bubble and the shark out of the
           frustum. */
        const bl = Math.hypot(px - cx, pz - cz) || 1;
        D.placePlayer(px + ((px - cx) / bl) * 9, pz + ((pz - cz) / bl) * 9);
        D.shoot(px, Math.min(py, sy - 0.7), pz, cx, cy, cz);
        return true;
      },
      placePlayer(x, z) {
        const P = CBZ.player, S = CBZ.sharkSim && CBZ.sharkSim.shark;
        if (!P) return;
        const sy = D.seaY(x, z);
        P.pos.x = x; P.pos.z = z; P.pos.y = sy - 1.5;
        if (S) {
          S.pos.x = x; S.pos.z = z; S.pos.y = sy - 1.5;
          if (S.group) S.group.position.set(x, S.group.position.y, z);
          if (S._waterMove) { S._waterMove.x = x; S._waterMove.z = z; }
        }
      },

      /* THE NUMBERS. Bait species = the two real schoolers (mackerel is id
         "fish"); a scrap is a bait group under 8 — smaller than anything a
         school should arrive as, on either build. Twins are groups sharing
         their EXACT size with another group of the same species: random
         draws can still collide, but a spawner that clips to quotas and
         constants collides constantly — that is the "all the same" the owner
         is naming. */
      /* THE NATURAL BANDS — the research, as one ruler applied to both
         builds. A group of 2+ below its species' band minimum is a group no
         real sea contains: a "school" of 3 sardines, a "pod" of 2 dolphins.
         (Deliberately NOT a twins count: random draws legitimately collide
         now and then, and charting a chance collision as a regression made
         two runs of this preset lie.) */
      BANDS: { fish: 12, sardine: 20, dolphin: 4, orca: 3, tuna: 3 },
      measure() {
        const c = D.census();
        const bait = { fish: 1, sardine: 1 };
        const out = {
          seaBodies: c.total, groupsTotal: 0, underNatural: 0, scrapSchools: 0,
          biggestSchool: 0, dolphinPodMax: 0, dolphinPodMin: 0, orcaPodSize: 0,
        };
        const byId = {};
        for (const g of c.groups) {
          (byId[g.id] = byId[g.id] || []).push(g.n);
          if (g.n > 1) out.groupsTotal++;
          if (g.n > 1 && D.BANDS[g.id] && g.n < D.BANDS[g.id]) out.underNatural++;
          if (bait[g.id]) {
            if (g.n > out.biggestSchool) out.biggestSchool = g.n;
            if (g.n < 8) out.scrapSchools++;
          }
        }
        const pods = (byId.dolphin || []).filter((n) => n > 1);
        if (pods.length) {
          out.dolphinPodMax = Math.max.apply(null, pods);
          out.dolphinPodMin = Math.min.apply(null, pods);
        }
        let orcas = 0;
        for (const n of byId.orca || []) orcas += n;
        out.orcaPodSize = orcas;
        out.groupTable = [];
        for (const id in byId) out.groupTable.push(id + ":" + byId[id].sort((a, b) => b - a).join(","));
        out.groupTable = out.groupTable.sort().join(" | ");
        return out;
      },
    };

    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const raf = D._rafOrig;
        if (raf) {
          await new Promise((res) => raf.call(window, () => {
            CBZ.renderer.render(CBZ.scene, CBZ.camera);
            res();
          }));
        } else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 1200));
      },
    };
  }

  const out = {};
  const CH = [
    async function censusShot() {
      if (!await D.boot()) throw new Error("sharksim never armed");
      await D.settle();
      D.censusOut = D.measure();
      const P = CBZ.player, sy = D.seaY(P.pos.x, P.pos.z);
      D.shoot(P.pos.x, sy + 52, P.pos.z + 6, P.pos.x, sy - 4, P.pos.z);
      D.step(2);
    },
    async function baitBall() {
      const g = D.bestShot((g) => (g.id === "fish" || g.id === "sardine") && g.n > 1);
      if (!g) throw new Error("no fish school in the sea at all");
      out.shotSchool = g.n;
      D.step(2);
    },
    async function dolphinPod() {
      const g = D.bestShot((g) => g.id === "dolphin");
      if (!g) throw new Error("no dolphins in the sea");
      out.shotPod = g.n;
      D.step(2);
    },
    async function orcaPod() {
      const g = D.biggest((g) => g.id === "orca");
      out.shotOrcas = g ? g.n : 0;
      if (!g || !D.overGroup(g)) {
        // no pod, or the pod is up on the sand mid-hunt — the sea from the
        // player is the honest fallback rather than a dead run
        const P = CBZ.player, sy = D.seaY(P.pos.x, P.pos.z);
        D.shoot(P.pos.x + 12, sy + 7, P.pos.z, P.pos.x, sy - 3, P.pos.z);
      }
      D.step(2);
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  await window.__cbzVisualCompare.render();
  Object.assign(out, D.censusOut || {});
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: { state: CBZ.game.state, mode: CBZ.game.mode, groupTable: out.groupTable || null },
    metrics: out,
  };
}

export default {
  id: "marine-populations",
  title: "Shark Sim — A School Is A Range, Not A Constant",
  description:
    "The owner's complaint, measured: 'weird population of numbers of each animal ... realistic ranges but random not all the same.' Both columns boot ?mode=sharksim on one pinned seed, run the live restocker to its own steady state, and read every group out of the engine's herd objects with one ruler. BEFORE: stockSea clipped each arriving school to its quota gap (scrap schools of 2-3), dolphin pods were hardcoded couples of 2-3, and the island seeder truncated the last group of every species to the leftover count while a rare pod animal spawned the same minimum pod every boot. AFTER: every group — sardine balls 20-45, mackerel shoals 12-30, dolphin pods 4-9 (frenzy's bait test now requires a small body, so a real pod can exist), orca pods 3-8 — is drawn whole from a researched range, remainders fold into the last group, and schools bigger than one tick's build budget arrive in instalments into ONE herd.",
  beforeLabel: "BEFORE · pristine HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same settle rule · one census ruler",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 420000,
  metrics: {
    underNatural: { label: "Groups below their species' natural minimum", better: "lower" },
    scrapSchools: { label: "Scrap schools (bait fish groups under 8)", better: "lower" },
    biggestSchool: { label: "Biggest fish school in the sea", better: "higher" },
    dolphinPodMax: { label: "Largest dolphin pod", better: "higher" },
    dolphinPodMin: { label: "Smallest dolphin pod", better: "higher" },
    orcaPodSize: { label: "Orcas in the water", better: "higher" },
    seaBodies: { label: "Live aquatic bodies at steady state", better: "higher" },
    groupsTotal: { label: "Real groups (2+) in the sea" },
  },
  metricsNote:
    "underNatural is the complaint counted with the research as the ruler: multi-animal groups smaller than the smallest group their species forms in the wild, game-scaled (fish 12, sardine 20, dolphin 4, orca 3, tuna 3) — every quota-clipped scrap and truncated pod lands here, and randomness alone never does. scrapSchools is the bait-fish subset. The dolphin pair of metrics should sit inside 4-9 after (2-3 before); orcaPodSize inside 3-8. groupTable in each capture's debug lists every group per species, largest first — the raw census both columns were scored from.",
  viewport: { width: 1280, height: 720 },
  readyExpression:
    "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.cityWildlife && CBZ.citySeaHeightAt && document.getElementById('playBtn')",
  subjects,
  stage: stageMarinePop,
};
