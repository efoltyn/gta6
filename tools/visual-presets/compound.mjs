/* Gang City — BUY THE BLOCK, KNOCK IT DOWN, BUILD YOUR COMPOUND.

   The property + compounds wave, photographed against a pristine worktree of
   HEAD (tools/visual-presets/lib/pristine-head.mjs): the before column is the
   city exactly as it shipped, the after column is the same seed, the same
   two lots and the same lenses with the new property layer driven through
   the game's own verbs:

     street    the curb in front of lot A. Before: a building. After: a real
               estate sign with the live price and the listing card open (the
               buy prompt a player gets at E).
     teardown  lot A from across the street. After: the contractor's
               controlled demolition mid-fall (structural.js forceCollapse,
               controlled, pancaked into its own footprint).
     compound  both lots from 60 m up. After: both bought, both buildings
               gone, the "starter" blueprint standing on the bare pads (walls,
               a steel gate on the frontage, corner towers, floodlights,
               cameras, a stash, bunks) and the crew on their posts.
     gate      street level at lot A's gate: the gate, a tower, the guards.
     map       the full map on the two lots: owned land painted in your colour
               with what stands on it drawn to scale.

   Run (one capture at a time, the city build is ~30 s of CPU):
     ba compound --no-open --cdp-timeout 600000

   HARNESS TRAP: stage() is SERIALIZED into the page by toString(), so nothing
   in this module's scope is reachable inside it. */

import { pristineHead } from "./lib/pristine-head.mjs";

const subjects = [
  { id: "street", label: "The buy prompt at the curb", phase: 0.45,
    focus: "Before: the building as it stands, nothing tells you it can be yours. After: a FOR SALE sign at the curb with the live asking price, and the listing card E opens (buy outright or finance)." },
  { id: "teardown", label: "Knock it down", phase: 0.45,
    focus: "After: the contractor's controlled demolition of the building you just bought, pancaking into its own footprint (no one on the sidewalk is buried by a legal job)." },
  { id: "compound", label: "Your compound on the cleared lots", phase: 0.47,
    focus: "Two bought lots, both buildings gone, and a walled compound on each bare pad: concrete perimeter, a steel sliding gate on the frontage, a guard tower in every corner, floodlights and cameras on the wall, a stash and bunks, the crew on their posts." },
  { id: "gate", label: "The gate, from the street", phase: 0.47,
    focus: "Street level outside the gate: the steel gate shut, the tower over it, guards posted inside the wire." },
  { id: "map", label: "The deed map", phase: 0.47,
    focus: "The full map on the two lots. After: owned land filled in your colour, the walls and towers you built drawn at their true footprint." },
];

async function stageCompound(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, error: "no CBZ/THREE" };
  const sub = input.subject || {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) { try { if (test()) return true; } catch (_) {} await wait(stepMs || 250); }
    return false;
  };
  const notes = [];
  const tick = (n, dt) => {
    const step = dt || 1 / 60;
    for (let i = 0; i < n; i++) {
      if (CBZ.game && CBZ.game.state === "paused") { try { CBZ.setState("playing"); } catch (_) {} }
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      try { if (CBZ.dayPhase && sub.phase != null) CBZ.dayPhase(sub.phase); } catch (_) {}
      try { CBZ.stepSim(step); } catch (_) {}
      if (CBZ.player) { CBZ.player.dead = false; CBZ.player.hp = Math.max(CBZ.player.hp || 0, 100); }
    }
  };
  const AFTER = !!CBZ.cityPlots;          // the pristine HEAD side has no property layer

  // ---- boot once per page --------------------------------------------------
  let S = window.__compoundStage;
  if (!S) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
      document.querySelector('[data-mode="city"]'), 360000);
    if (!booted) return { ok: false, error: "never booted" };
    if (CBZ.CONFIG) { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; CBZ.CONFIG.GANG_PERSIST = false; CBZ.CONFIG.CONTROLS_AUTO = false; }
    try { localStorage.clear(); } catch (_) {}
    document.querySelector('[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, error: "never reached playing" };
    await until(() => { const c = document.getElementById("bootload"); return !c || getComputedStyle(c).display === "none"; }, 30000, 50);
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
    try { if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    tick(60);
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.root || !A.lots) return { ok: false, error: "city arena missing" };
    const st = document.createElement("style"); st.id = "compoundNoHint";
    st.textContent = "#lockHint{display:none!important}"; document.head.appendChild(st);

    // ---- THE TWO LOTS: identical on both sides (seeded world, pure filter) --
    const NO = { bank: 1, hospital: 1, guns: 1, realtor: 1, casino: 1, carlot: 1, security: 1, cityhall: 1, arena: 1, raceway: 1, police: 1, jewelry: 1, airfield: 1, transit: 1 };
    const ok = (l) => {
      const b = l.building;
      if (!b || b.park || !b.group || !b.colliders || !b.colliders.length) return false;
      if (l.kind === "park" || l.kind === "abandoned" || b.abandoned) return false;
      if (b.owner && b.owner.type === "city") return false;
      const k = (b.shop && b.shop.kind) || l.kind || "";
      if (NO[k]) return false;
      if (b.helipad || b.hangar || (b.home && (b.home.flagship || b.home.id === "penthouse"))) return false;
      return (b.storeys || 1) <= 8;
    };
    const cands = A.lots.filter(ok);
    let pair = null, best = 1e9;
    for (const a of cands) for (const b of cands) {
      if (a === b || a.j !== b.j || b.i !== a.i + 1) continue;
      const d = Math.hypot((a.cx + b.cx) / 2 - A.center.x, (a.cz + b.cz) / 2 - A.center.z);
      if (d < best) { best = d; pair = [a, b]; }
    }
    if (!pair) return { ok: false, error: "no adjacent buildable pair" };
    const front = (lot) => {
      const r = { minX: lot.cx - lot.w / 2, maxX: lot.cx + lot.w / 2, minZ: lot.cz - lot.d / 2, maxZ: lot.cz + lot.d / 2 };
      const d = lot.building && lot.building.door;
      let side = 2;
      if (d) { const dd = [Math.abs(d.z - r.minZ), Math.abs(r.maxX - d.x), Math.abs(r.maxZ - d.z), Math.abs(d.x - r.minX)]; side = dd.indexOf(Math.min.apply(null, dd)); }
      const cx = lot.cx, cz = lot.cz;
      return side === 0 ? { x: cx, z: r.minZ, nx: 0, nz: -1 } : side === 1 ? { x: r.maxX, z: cz, nx: 1, nz: 0 } : side === 2 ? { x: cx, z: r.maxZ, nx: 0, nz: 1 } : { x: r.minX, z: cz, nx: -1, nz: 0 };
    };
    S = window.__compoundStage = { A, pair, fA: front(pair[0]), fB: front(pair[1]), built: false, crew: [] };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }
  const A = S.A, P = CBZ.player, camera = CBZ.camera, cc = CBZ.cineCam;
  const [lotA, lotB] = S.pair;
  const aspect = input.width / input.height;
  const shot = { x: 0, y: 2, z: 0, lx: 0, ly: 1, lz: 1, fov: 50 };
  const applyShot = () => { if (cc) { cc.active = true; cc.x = shot.x; cc.y = shot.y; cc.z = shot.z; cc.lx = shot.lx; cc.ly = shot.ly; cc.lz = shot.lz; cc.snap = true; } };
  const aimFinal = () => {
    camera.aspect = aspect; camera.fov = shot.fov; camera.near = 0.05;
    camera.far = Math.max(camera.far || 1400, 3000);
    camera.position.set(shot.x, shot.y, shot.z); camera.up.set(0, 1, 0);
    camera.lookAt(shot.lx, shot.ly, shot.lz);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    try { if (CBZ.skySync) CBZ.skySync(); } catch (_) {}
  };
  const hidePlayer = () => { if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false; };
  const hideHud = (keep) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    let el = canvas;
    while (el && el.parentElement) {
      for (const sib of Array.from(el.parentElement.children)) {
        if (sib === el || sib.tagName === "SCRIPT" || sib.tagName === "STYLE") continue;
        if (keep && keep.indexOf(sib.id) >= 0) { sib.style.removeProperty("display"); continue; }
        sib.style.setProperty("display", "none", "important");
      }
      el = el.parentElement;
      if (el === document.body) break;
    }
  };
  // clear the lens of traffic near the lots
  const parkAway = (x, z, r) => {
    for (const c of CBZ.cityCars || []) {
      if (!c || !c.pos || c.player || c.owned) continue;
      if (Math.hypot(c.pos.x - x, c.pos.z - z) < r) { c.v = 0; c.ai = false; if (c.group) c.group.visible = false; }
    }
  };
  const standPlayer = (x, z) => { if (P && P.pos) { P.driving = false; P.pos.set(x, 0.9, z); } };
  if (cc) cc.active = false;
  try { if (CBZ.dayPhase) CBZ.dayPhase(sub.phase); } catch (_) {}
  const result = { ok: true, subject: sub.id, side: AFTER ? "after" : "before", lots: S.pair.map((l) => [Math.round(l.cx), Math.round(l.cz)]), notes };
  const money = () => { CBZ.game.cash = Math.max(CBZ.game.cash || 0, 3000000); };

  // ---- the after side's world: bought, demolished, built, staffed ----------
  const ensureBought = () => {
    if (!AFTER) return;
    money();
    for (const lot of S.pair) {
      if (!CBZ.cityOwnsLot(lot)) { try { CBZ.cityZillow.buyByLot(lot); } catch (e) { notes.push("buy " + e.message); } }
    }
    try { CBZ.cityPlots.sync(); } catch (_) {}
    try { if (CBZ.cityPlots) CBZ.cityPlots.list().forEach((p) => { p.lot.building && p.lot.building.home; }); } catch (_) {}
    const pan = document.getElementById("plotPanel"); if (pan) pan.style.display = "none";
    CBZ.cityMenuOpen = false;
  };
  const ensureBuilt = () => {
    if (!AFTER || S.built) return;
    ensureBought();
    const D = CBZ.cityDemolition;
    // lot A is still mid-fall from the teardown subject: let it land
    for (let i = 0; i < 60 && (!lotA.demolished || (CBZ.collapse && CBZ.collapse.active && CBZ.collapse.active() > 0)); i++) tick(30);
    for (const lot of S.pair) {
      if (!lot.demolished) { try { D.hold(lot, true); D.destroy(lot, { held: true, quiet: true, at: (CBZ.dayTime ? CBZ.dayTime() : 0) - 1 }); } catch (e) { notes.push("destroy " + e.message); } }
      try { D.hold(lot, true); if (D._forcePhase) D._forcePhase(lot, 4); } catch (_) {}
    }
    try { CBZ.cityPlots.sync(); } catch (_) {}
    tick(40);
    const plots = CBZ.cityPlots.list();
    const K = CBZ.compoundKit, C = CBZ.compoundCrew;
    result.blueprint = [];
    for (const plot of plots) {
      plot.cleared = true;
      if (K && K.blueprint) {
        let r = null;
        try { r = K.blueprint("starter", plot); } catch (e) { notes.push("blueprint " + e.message); }
        result.blueprint.push(r ? { ok: r.ok, placed: (r.placed || []).length, cost: r.cost, reason: r.reason || null } : null);
      }
    }
    standPlayer((lotA.cx + lotB.cx) / 2, lotA.cz + lotA.d / 2 + 6);
    tick(30);
    if (C && C.hire) {
      for (const plot of plots) {
        for (const role of ["guard", "guard", "guard", "guard", "worker"]) {
          let p = null; try { p = C.hire(plot, role); } catch (e) { notes.push("hire " + e.message); }
          if (p) S.crew.push(p);
        }
      }
    }
    // the hires walk in from the street; give them the time to reach their posts
    for (let i = 0; i < 60; i++) tick(30, 1 / 30);
    S.built = true;
    result.crew = S.crew.length;
  };

  if (sub.id === "street") {
    // ---- the curb in front of lot A, the sign (after) at the right of frame --
    const f = S.fA, tx = -f.nz, tz = f.nx;
    const sx = f.x + tx * 9, sz = f.z + tz * 9;       // where plots.js stands the sign
    standPlayer(f.x + f.nx * 30, f.z + f.nz * 30);
    tick(90);
    shot.fov = 52;
    shot.x = sx + f.nx * 9.5 - tx * 3.5; shot.z = sz + f.nz * 9.5 - tz * 3.5; shot.y = 1.7;
    shot.lx = sx - f.nx * 6 - tx * 5; shot.lz = sz - f.nz * 6 - tz * 5; shot.ly = 3.4;
    parkAway(shot.x, shot.z, 40);
    applyShot(); tick(6); hidePlayer(); aimFinal();
    if (AFTER) {
      money();
      tick(20);
      CBZ.cityMenuOpen = false;
      try { CBZ.cityPlots.openListingFor(lotA); } catch (e) { notes.push("listing " + e.message); }
      hidePlayer();
      applyShot(); tick(2); hidePlayer(); aimFinal();
      const pan = document.getElementById("plotPanel");
      if (pan) { pan.style.left = "auto"; pan.style.right = "3%"; pan.style.transform = "translate(0,-50%)"; }
      result.metrics = { signs: 1, panel: pan && pan.style.display === "block" ? 1 : 0 };
      hideHud(["plotPanel"]);
      if (pan) pan.style.setProperty("display", "block", "important");
    } else { hideHud(); result.metrics = { signs: 0, panel: 0 }; }
  } else if (sub.id === "teardown") {
    const b = lotA.building, f = S.fA;
    standPlayer(f.x + f.nx * 45, f.z + f.nz * 45);
    shot.fov = 50;
    shot.x = lotA.cx + f.nx * 27 - f.nz * 20; shot.z = lotA.cz + f.nz * 27 + f.nx * 20; shot.y = 16;
    shot.lx = b.ox; shot.lz = b.oz; shot.ly = (b.h || 12) * 0.45;
    parkAway(b.ox, b.oz, 70);
    applyShot(); tick(10);
    if (AFTER) {
      ensureBought();
      let ok = false;
      try { ok = !!CBZ.structure.forceCollapse(lotA, { by: "contractor", controlled: true }); } catch (e) { notes.push("collapse " + e.message); }
      try { CBZ.cityDemolition.hold(lotA, true); } catch (_) {}
      result.collapse = ok;
      // into the fall: the pre-shudder, then the frame drops
      for (let i = 0; i < 12; i++) tick(30);
    }
    hidePlayer(); applyShot(); tick(2); aimFinal(); hideHud();
  } else if (sub.id === "compound") {
    ensureBuilt();
    const cx = (lotA.cx + lotB.cx) / 2, cz = (lotA.cz + lotB.cz) / 2;
    const f = S.fA;
    standPlayer(cx, cz + (lotA.d / 2 + 12) * (f.nz || 1));
    shot.fov = 50;
    shot.x = cx + 18; shot.z = cz + (f.nz >= 0 ? 1 : -1) * 72; shot.y = 48;
    shot.lx = cx; shot.lz = cz; shot.ly = 0;
    parkAway(cx, cz, 90);
    applyShot(); tick(20); hidePlayer(); aimFinal(); hideHud();
    if (AFTER) {
      const K = CBZ.compoundKit;
      let pieces = 0; try { for (const p of CBZ.cityPlots.list()) pieces += (K && K.piecesOn ? K.piecesOn(p).length : 0); } catch (_) {}
      let crew = 0; try { for (const p of CBZ.cityPlots.list()) crew += (CBZ.compoundCrew && CBZ.compoundCrew.roster ? CBZ.compoundCrew.roster(p).length : 0); } catch (_) {}
      result.crewAt = S.crew.map((p) => p && p.pos ? { x: +p.pos.x.toFixed(1), y: +p.pos.y.toFixed(1), z: +p.pos.z.toFixed(1), dead: !!p.dead, inside: !!CBZ.cityPlots.at(p.pos.x, p.pos.z, 0), state: p.state, post: p._post ? p._post.kind : null } : null);
      try { result.gates = CBZ.cityPlots.list().map((pl) => (CBZ.compoundKit.gates(pl) || []).map((g) => ({ open: !!g.open, locked: !!g.locked, x: +g.pos.x.toFixed(1), z: +g.pos.z.toFixed(1) }))); } catch (_) {}
      result.metrics = { owned: CBZ.cityPlots.list().length, cleared: S.pair.filter((l) => l.demolished).length, pieces, crew };
    } else result.metrics = { owned: 0, cleared: 0, pieces: 0, crew: 0 };
  } else if (sub.id === "gate") {
    ensureBuilt();
    const f = S.fA;
    standPlayer(f.x + f.nx * 25, f.z + f.nz * 25);
    shot.fov = 55;
    shot.x = f.x + f.nx * 11 + f.nz * 7; shot.z = f.z + f.nz * 11 - f.nx * 7; shot.y = 2.2;
    shot.lx = f.x - f.nx * 8; shot.lz = f.z - f.nz * 8; shot.ly = 3.6;
    parkAway(f.x, f.z, 50);
    applyShot(); tick(20); hidePlayer(); aimFinal(); hideHud();
  } else if (sub.id === "map") {
    ensureBuilt();
    const M = CBZ.fullMap;
    const cx = (lotA.cx + lotB.cx) / 2, cz = (lotA.cz + lotB.cz) / 2;
    standPlayer(cx, cz + 40);
    tick(10);
    if (M && M.open) {
      try { if (M.clearWaypoint) M.clearWaypoint("city"); } catch (_) {}
      try { M.view.fitted = false; M.open(); } catch (e) { notes.push("map " + e.message); }
      try { M.view.ox = cx; M.view.oz = cz; M.view.z = Math.min(12, M.view.z * 1.6); if (M.draw) M.draw(); } catch (e) { notes.push("view " + e.message); }
    }
    const root = document.querySelector(".full-map, #fullMap, #fullmap");
    hideHud(root && root.id ? [root.id] : null);
    result.mapRoot = root ? (root.id || root.className) : null;
  }
  return result;
}

export default {
  id: "compound",
  title: "Gang City: buy the block, knock it down, build your compound",
  description: "The property wave in one strip: a FOR SALE sign and the listing card at the curb, the contractor's controlled demolition, both lots cleared to bare pads with a walled compound standing on each and the crew on post, and the deed map. Before is a pristine worktree of HEAD: the same seed, the same lots, the same lenses.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { mode: "city", seed: 90326, cfg_BOOT_METER: 0 },
  stageTimeoutMs: 600000,
  beforeLabel: "BEFORE · HEAD (a lot is a row on a phone app)",
  afterLabel: "AFTER · buy it at the curb, knock it down, build on it",
  pairNote: "Same seed · same two lots · same cameras · the uncommitted diff is the only variable",
  method: "The before side is a detached git worktree of HEAD served on its own port; the after side is the working tree. requestAnimationFrame is frozen and CBZ.stepSim is the only clock. The after side buys the two lots through cityZillow.buyByLot, fells lot A through structure.forceCollapse({controlled}), lays lot B straight to the held pad, places compoundKit.blueprint('starter') on both plots and hires the crew through compoundCrew.hire.",
  metrics: {
    owned: { label: "Lots owned", unit: "lots" },
    cleared: { label: "Lots knocked down", unit: "lots" },
    pieces: { label: "Pieces standing on your land", unit: "pieces" },
    crew: { label: "Crew on the compound", unit: "people" },
  },
  metricsNote: "Counts read off live state after staging.",
  launchSides: pristineHead,
  subjects, stage: stageCompound,
};
