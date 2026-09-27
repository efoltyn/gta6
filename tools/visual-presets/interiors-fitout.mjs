/*
  interiors-fitout.mjs — the walk-in fit-out wave (city/fitout*.js).

  OWNER: "building interiors and layouts ... really thinking about the LOGIC
  of Gang Life." Five rooms of one seeded city, the same camera on both sides:
  inside a flat, an office floor, a shop with its clerk, a gang's back room,
  and the view out of a flat's window.

  STAGING (both sides, no typed coordinates):
  - lots come from CBZ.city.arena, sorted by (i,j) + a predicate, so the two
    columns frame the same address.
  - the FLAT shots are aimed off the eager unit-door registry
    (CBZ.cityUnitDoors), which both builds have: the camera stands just inside
    a flat's front door and looks at its window; the window shot stands a
    metre off the facade and looks out.
  - the GANG shot is aimed off the hideout's eager stash duffel at local
    (0, b.d/2 - 2.6), which both builds draw.
  - the player is put on the storey and the sim stepped 2.5 s so the lazy
    fit-out (after side) and the vendor pass (both sides) have run.
  - rAF is frozen; CBZ.stepSim is the clock (the house pattern).
*/

const READY =
  "document.getElementById('playBtn') && document.querySelector('.mode-btn[data-mode=\"city\"]')";

export default {
  id: "interiors-fitout",
  title: "Gang City interiors: rooms that are planned, finished, lit and lived in",
  description:
    "Five interiors in one deterministic city (seed 90210), same camera on both sides. " +
    "Before: plates with a bed in a bay, desks on a dark floor, a shop counter on grey, a gang house that is an empty room with a glowing bag. " +
    "After: flats planned like flats (bath by the entry, kitchen run, living, bedroom at the window), office floors with finishes and fixtures, " +
    "a shop with a real till and stockroom, a gang count room, and light that comes from the lamps.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER · walk-in fit-out",
  pairNote: "Same seed, same building, same storey, same camera",
  defaultFocus: "Does it read as a real place somebody built, lives or works in?",
  viewport: { width: 1180, height: 720 },
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  readyExpression: READY,
  subjects: [
    { id: "flat-unit", label: "Inside a flat, from its front door", focus: "A plan: bath by the entry, a kitchen run, living, the bed at the window." },
    { id: "office-floor", label: "An office floor over a trade counter", focus: "Carpet, a ceiling grid of real fittings, desks with life on them." },
    { id: "shop-clerk", label: "A shop, the clerk behind the counter", focus: "A till on the counter, a stockroom door behind it, a finished floor." },
    { id: "gang-room", label: "A gang house, the back room", focus: "The count table, the bulb over it, the bag on the floor." },
    { id: "window-view", label: "A flat's window, looking out", focus: "Curtains, a sill, and the street through the glass." },
  ],
  metrics: {
    fitFloors: { label: "Fitted-out floors live around the camera", unit: "floors", better: "higher" },
    fitMs: { label: "Worst build time of one fitted floor", unit: "ms", better: "lower" },
  },

  stage: async function stageInteriorsFitout(input) {
    const CBZ = window.CBZ;
    const T = window.THREE;
    if (!CBZ || !T) return { ok: false, err: "no CBZ/THREE" };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { if (test()) return true; } catch (_) {}
        await wait(stepMs || 250);
      }
      return false;
    };
    let S = window.__fitoutSeq;
    if (!S) {
      const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('.mode-btn[data-mode="city"]'), 300000);
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('.mode-btn[data-mode="city"]').click();
      await wait(250);
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn");
        if (b) b.click();
        return CBZ.game.state === "playing";
      }, 240000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      try { if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts"; } catch (_) {}
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      await until(() => { const c = document.getElementById("bootload"); return !c || c.style.display === "none" || !c.isConnected; }, 60000, 200);
      window.requestAnimationFrame = function () { return 0; };
      try { const c = document.getElementById("bootload"); if (c) c.style.display = "none"; if (CBZ.bootMeter && CBZ.bootMeter.hide) CBZ.bootMeter.hide(); } catch (_) {}
      await wait(600);
      for (let i = 0; i < 60; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      S = window.__fitoutSeq = {};
      window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
    }
    const step = (secs) => {
      const n = Math.max(1, Math.round(secs * 60));
      for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } }
    };
    // midday, so the before side is not simply darker
    try { if (CBZ.setTimeOfDay) CBZ.setTimeOfDay(13); } catch (_) {}

    const A = (CBZ.city && CBZ.city.arena) || {};
    const byIJ = (a, b) => (a.i - b.i) || (a.j - b.j);
    const sortLots = (arr) => (arr || []).filter((l) => l && l.building && l.building.w > 8 && l.building.d > 8 && !l.demolished).slice().sort(byIJ);
    const shopLots = sortLots(A.shopLots), allLots = sortLots(A.lots);
    const first = (arr, pred) => { for (const l of arr) if (pred(l)) return l; return null; };
    const SUBJ = input.subject.id;
    const WORK = { bank: 1, security: 1, realtor: 1, hospital: 1, casino: 1, transit: 1, cityhall: 1, courthouse: 1, federal: 1, postoffice: 1, library: 1, dmv: 1 };
    const RETAIL = { food: 1, convenience: 1, liquor: 1, pharmacy: 1, drugs: 1, hardware: 1, electronics: 1, grocery: 1, diner: 1, deli: 1, market: 1 };

    let lot = null, floorK = 0;
    const doorsOn = (b, y) => (CBZ.cityUnitDoors && CBZ.cityUnitDoors.on) ? CBZ.cityUnitDoors.on(b, y, 0.8) : [];
    const topsOf = (b) => b.floorTops || [0.14].concat(Array.from({ length: b.storeys | 0 }, (_, i) => (i + 1) * (b.FH || 3.2)));
    if (SUBJ === "flat-unit" || SUBJ === "window-view") {
      lot = first(shopLots, (l) => (l.building.storeys | 0) >= 2 && doorsOn(l.building, topsOf(l.building)[1]).length >= 4);
      floorK = 1;
    } else if (SUBJ === "office-floor") {
      lot = first(shopLots, (l) => WORK[l.kind] && (l.building.storeys | 0) >= 2);
      floorK = 1;
    } else if (SUBJ === "shop-clerk") {
      lot = first(shopLots, (l) => RETAIL[l.kind]) || first(shopLots, (l) => !WORK[l.kind]);
      floorK = 0;
    } else if (SUBJ === "gang-room") {
      lot = first(allLots, (l) => l.kind === "abandoned");
      floorK = 0;
    }
    if (!lot) return { ok: false, err: "no lot for " + SUBJ };
    const b = lot.building;
    const tops = topsOf(b);
    const baseY = tops[floorK];
    const ox = b.ox || 0, oz = b.oz || 0;
    const wt = b.wt != null ? b.wt : 0.4;
    const xLo = -b.w / 2 + wt + 0.4, xHi = b.w / 2 - wt - 0.4, zLo = -b.d / 2 + wt + 0.4, zHi = b.d / 2 - wt - 0.4;
    let eye = { x: 0, z: 0 }, look = { x: 0, z: 0 }, eyeY = baseY + 1.6, lookY = baseY + 1.3;

    if (SUBJ === "flat-unit" || SUBJ === "window-view") {
      // the third flat door by position; into the flat = away from the plate centre on the cross axis
      const ds = doorsOn(b, baseY).slice().sort((a, c) => (a.x - c.x) || (a.z - c.z));
      const d = ds[Math.min(2, ds.length - 1)];
      const lx = d.x - ox, lz = d.z - oz;
      const alongX = (xHi - xLo) >= (zHi - zLo);
      const inX = alongX ? 0 : Math.sign(lx) || 1, inZ = alongX ? Math.sign(lz) || 1 : 0;
      const face = alongX ? (inZ < 0 ? -b.d / 2 + wt : b.d / 2 - wt) : (inX < 0 ? -b.w / 2 + wt : b.w / 2 - wt);
      const depth = alongX ? Math.abs(face - lz) : Math.abs(face - lx);
      if (SUBJ === "flat-unit") {
        eye = { x: lx + inX * 0.45, z: lz + inZ * 0.45 };
        look = { x: lx + inX * depth, z: lz + inZ * depth };
        lookY = baseY + 1.0;
      } else {
        eye = { x: lx + inX * (depth - 1.7) + (alongX ? 0.25 : 0), z: lz + inZ * (depth - 1.7) + (alongX ? 0 : 0.25) };
        look = { x: lx + inX * (depth + 6), z: lz + inZ * (depth + 6) };
        lookY = baseY + 1.2;
      }
    } else if (SUBJ === "gang-room") {
      // the duffel both builds draw, seen from 2.4 m toward the door side
      const dz = b.d / 2 - 2.6;
      eye = { x: 1.2, z: dz - 2.6 };
      look = { x: 0, z: dz + 0.3 };
      lookY = baseY + 0.6;
    } else {
      const din = b.localDoor || { x: xLo, z: zLo };
      eye.x = Math.abs(din.x - xLo) <= Math.abs(din.x - xHi) ? xLo + 1.3 : xHi - 1.3;
      eye.z = Math.abs(din.z - zLo) <= Math.abs(din.z - zHi) ? zLo + 1.3 : zHi - 1.3;
      look = { x: (xLo + xHi) / 2, z: (zLo + zHi) / 2 };
      if (SUBJ === "shop-clerk" && b.localDoor) {
        // stand at the door, look at the counter (the vendor stands behind it)
        const d = b.localDoor;
        eye = { x: d.x + d.nx * 1.4 + (-d.nz) * 1.2, z: d.z + d.nz * 1.4 + d.nx * 1.2 };
        look = { x: d.x + d.nx * (Math.abs(d.nx) > 0.5 ? b.w : b.d) * 0.8, z: d.z + d.nz * (Math.abs(d.nx) > 0.5 ? b.w : b.d) * 0.8 };
        lookY = baseY + 1.1;
      }
    }
    const P = CBZ.player;
    const put = () => {
      if (!P || !P.pos) return;
      P.pos.set(ox + eye.x, baseY + 0.1, oz + eye.z);
      if (P.vel) { P.vel.x = 0; P.vel.y = 0; P.vel.z = 0; }
      if (CBZ.playerChar && CBZ.playerChar.group) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.visible = false; }
    };
    put(); step(1.2); put(); step(1.3); put();
    const cam = CBZ.camera;
    cam.position.set(ox + eye.x, eyeY, oz + eye.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(ox + look.x, lookY, oz + look.z);
    if (cam.fov && cam.fov < 70) { cam.fov = 72; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);
    const au = CBZ.fitoutAudit ? CBZ.fitoutAudit() : null;
    let n = 0; if (au) for (const s of au.live) n += s.floors.length;
    return {
      ok: true,
      lot: { i: lot.i, j: lot.j, kind: lot.kind, storeys: b.storeys | 0 },
      floor: floorK,
      metrics: { fitFloors: n, fitMs: au ? Math.round(au.stats.maxMs) : 0 },
    };
  },
};
