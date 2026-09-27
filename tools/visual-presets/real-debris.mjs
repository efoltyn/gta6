/* REAL DEBRIS — everything that breaks, breaks into ITSELF.

   OWNER, 2026-09-27: "I hate big cubes of fake debris. Make debris realer, all
   from the prop itself."

   Five things a player blows up, each shot the same way on both sides:
     brick   an RPG into a brick building's street face (in flight, then settled)
     glass   an RPG into a glass office front
     lamp    an RPG dead on a street lamp
     wood    an RPG beside a wooden street prop (fence / bench / crate)
     collapse a concrete building brought down (structure.forceCollapse)

   BEFORE is the build before the debris wave (serve it from a detached HEAD
   worktree on its own port and pass --before). AFTER is this checkout. Both
   sides boot the same seed, pick the same targets with the same self-contained
   finders (nothing here calls CBZ.debris, so the before side can run it), fire
   the same ordnance and step the same simulated seconds.

   Usage:
     git worktree add --detach <scratch>/head <base-sha>
     (cd <scratch>/head && PORT=8611 python3 tools/devserver.py &)
     node tools/visual-compare.mjs --preset real-debris --before http://127.0.0.1:8611/ */

const subjects = [
  { id: "brick-flight", label: "RPG into brick, 0.5 s", focus: "BEFORE: grey boxes from a shared palette. AFTER: pieces cut out of that wall, brick on the outside, brick core on the break, thrown from the strike." },
  { id: "brick-settled", label: "Brick, 6 s later", focus: "What is on the ground. AFTER: the wall's own pieces piled where they fell, brick dust and chips, a ragged rim of surviving wall around the hole." },
  { id: "glass", label: "RPG into a glass office front", focus: "AFTER: the panes themselves break into radial shards around the strike and glitter on the pavement; the frame's own concrete courses come away as pieces." },
  { id: "lamp", label: "RPG dead on a street lamp", focus: "BEFORE: the lamp stands through a blast that throws boxes. AFTER: the pole snaps at the hit, the stump stays planted, the top falls with its head." },
  { id: "wood", label: "RPG beside a wooden street prop", focus: "AFTER: splinters and planks of the prop's own wood, not a cube." },
  { id: "collapse", label: "A concrete building comes down", focus: "AFTER: the building falls as its own material and leaves rubble of itself." },
];

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, err: "missing CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) { try { if (test()) return true; } catch (_) {} await wait(stepMs || 250); }
    return false;
  };
  const tick = () => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    CBZ.stepSim(1 / 60);
    if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
  };
  const seconds = (s) => { const n = Math.max(1, Math.round(s * 60)); for (let i = 0; i < n; i++) tick(); };
  const daylight = () => { try { if (CBZ.dayPhase) CBZ.dayPhase(0.40); } catch (_) {} };
  const clean = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__rdHud") continue;
      child.style.visibility = "hidden";
    }
    const cam = CBZ.camera;
    if (cam && cam.children) for (const c of cam.children) c.visible = false;
  };
  const groundAt = (x, z) => { try { return CBZ.floorAt ? +CBZ.floorAt(x, z) || 0 : 0; } catch (_) { return 0; } };

  let S = window.__rdSeq;
  if (!S) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
      document.querySelector('.mode-btn[data-mode="city"]'), 420000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; CBZ.CONFIG.GANG_PERSIST = false; }
    document.querySelector('.mode-btn[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 300000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(650);
    for (let i = 0; i < 260; i++) tick();
    daylight(); seconds(0.3);

    const A = CBZ.city && CBZ.city.arena;
    const shells = (A && A.root && A.root.userData && A.root.userData.shells) || [];
    const lots = (A && A.lots) || [];
    const insideShell = (x, y, z) => {
      for (const b of shells) {
        if (!b || !(b.h > 0) || y > b.h + 0.5) continue;
        if (Math.abs(x - b.ox) < b.w / 2 + 0.6 && Math.abs(z - b.oz) < b.d / 2 + 0.6) return true;
      }
      return false;
    };
    const solidAt = (x, y, z, pad) => {
      for (const c of CBZ.colliders || []) {
        if (!c) continue;
        const y0 = c.y0 == null ? -1e3 : c.y0, y1 = c.y1 == null ? 1e3 : c.y1;
        if (y < y0 - 0.6 || y > y1 + 0.6) continue;
        if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
      }
      return false;
    };
    const wet = (x, z) => { try { return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)); } catch (_) { return false; } };
    const _ray = new T.Raycaster(), _o = new T.Vector3(), _d = new T.Vector3();
    const losClear = (from, to) => {
      const L = CBZ.losBlockers; if (!L || !L.length) return true;
      _d.set(to.x - from.x, to.y - from.y, to.z - from.z);
      const d = _d.length(); if (d < 2) return true;
      _d.divideScalar(d); _ray.set(_o.set(from.x, from.y, from.z), _d);
      _ray.near = 0.5; _ray.far = d - 1.6;
      try { return _ray.intersectObjects(L, false).length === 0; } catch (_) { return true; }
    };
    // a tripod on the street side of a target, looking at it, with a clear view
    const tripod = (t, tries) => {
      for (const q of tries) {
        const eye = { x: t.x + t.nx * q[0] + t.tx * q[2], y: Math.max(1.8, groundAt(t.x, t.z) + q[1]), z: t.z + t.nz * q[0] + t.tz * q[2] };
        if (wet(eye.x, eye.z) || solidAt(eye.x, eye.y, eye.z, 1.0) || insideShell(eye.x, eye.y, eye.z)) continue;
        if (!losClear(eye, { x: t.x, y: t.y, z: t.z })) continue;
        return { eye, look: { x: t.x, y: t.lookY != null ? t.lookY : t.y, z: t.z }, fov: q[3] || 52 };
      }
      const q = tries[0];
      return { eye: { x: t.x + t.nx * q[0] + t.tx * q[2], y: Math.max(1.8, groundAt(t.x, t.z) + q[1]), z: t.z + t.nz * q[0] + t.tz * q[2] },
        look: { x: t.x, y: t.lookY != null ? t.lookY : t.y, z: t.z }, fov: q[3] || 52 };
    };
    const faceOf = (b, pick) => {
      const faces = [
        { nx: 1, nz: 0, x: b.ox + b.w / 2, z: b.oz, width: b.d },
        { nx: -1, nz: 0, x: b.ox - b.w / 2, z: b.oz, width: b.d },
        { nx: 0, nz: 1, x: b.ox, z: b.oz + b.d / 2, width: b.w },
        { nx: 0, nz: -1, x: b.ox, z: b.oz - b.d / 2, width: b.w },
      ];
      let best = null, bs = -1;
      for (const f of faces) {
        const tx = -f.nz, tz = f.nx;
        const eye = { x: f.x + f.nx * 16, y: 3, z: f.z + f.nz * 16 };
        if (wet(eye.x, eye.z) || insideShell(eye.x, eye.y, eye.z) || solidAt(eye.x, eye.y, eye.z, 1.0)) continue;
        const sc = (losClear(eye, { x: f.x, y: 2.5, z: f.z }) ? 10 : 0) + (pick ? pick(f) : 0);
        if (sc > bs) { bs = sc; best = { x: f.x, z: f.z, nx: f.nx, nz: f.nz, tx, tz, width: f.width }; }
      }
      return best;
    };
    const near0 = (b) => Math.hypot(b.ox, b.oz);
    const used = new Set();
    const pickShell = (test) => {
      const c = shells.filter((b) => b && !used.has(b) && !b.boarded && test(b) && near0(b) < 900)
        .sort((a, b) => near0(a) - near0(b));
      for (const b of c) { const f = faceOf(b); if (f) { used.add(b); return { b, f }; } }
      return null;
    };
    const brick = pickShell((b) => b.facade === "brick" && b.storeys >= 2 && b.w >= 9);
    const glass = pickShell((b) => (b.facade === "office" || b.facade === "retail") && b.storeys >= 3 && b.w >= 10);
    // collapse: a concrete (non-brick, non-glass-heavy) mid-rise with a lot record
    let collapse = null;
    for (const L of lots.slice().sort((a, b) => Math.hypot(a.cx || 0, a.cz || 0) - Math.hypot(b.cx || 0, b.cz || 0))) {
      const b = L.building; if (!b || used.has(b)) continue;
      if (!(b.storeys >= 4 && b.storeys <= 9)) continue;
      if (Math.hypot(b.ox, b.oz) > 900) continue;
      const f = faceOf(b); if (!f) continue;
      used.add(b); collapse = { L, b, f }; break;
    }
    // street props: tall thin band-less colliders = posts; small band-less
    // brown ones = wood
    const walls = [];
    for (const c of CBZ.colliders) if (c.y0 != null && c.y1 != null && c.ref && c.y1 - c.y0 > 1.6) walls.push(c);
    const lonely = (x, z, r) => {
      for (const w of walls) {
        const sx = Math.max(w.minX, Math.min(w.maxX, x)), sz = Math.max(w.minZ, Math.min(w.maxZ, z));
        if ((x - sx) * (x - sx) + (z - sz) * (z - sz) < r * r) return false;
      }
      return true;
    };
    const box = new T.Box3();
    let lamp = null, wood = null;
    const hsl = {};
    const woodish = (m) => {
      if (!m || !m.color) return false;
      m.color.getHSL(hsl);
      return /wood|plank|bench|fence|crate|pallet/i.test(m.name || "") || (hsl.s > 0.25 && hsl.h >= 0.04 && hsl.h < 0.13 && hsl.l > 0.15 && hsl.l < 0.6);
    };
    const props = [];
    for (const c of CBZ.colliders) {
      if (!c.ref || c.y0 != null) continue;
      const ex = c.maxX - c.minX, ez = c.maxZ - c.minZ;
      if (Math.max(ex, ez) > 4) continue;
      const x = (c.minX + c.maxX) / 2, z = (c.minZ + c.maxZ) / 2;
      if (Math.hypot(x, z) > 700) continue;
      try { box.setFromObject(c.ref); } catch (_) { continue; }
      if (box.isEmpty()) continue;
      props.push({ c, x, z, h: box.max.y - box.min.y, span: Math.max(ex, ez), mat: Array.isArray(c.ref.material) ? c.ref.material[0] : c.ref.material });
    }
    props.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    for (const p of props) if (!lamp && p.h > 4.2 && p.span < 1.2 && lonely(p.x, p.z, 9)) lamp = p;
    for (const p of props) if (!wood && p.h > 0.4 && p.h < 2.5 && woodish(p.mat) && lonely(p.x, p.z, 6) && (!lamp || Math.hypot(p.x - lamp.x, p.z - lamp.z) > 30)) wood = p;

    const hud = document.createElement("div");
    hud.id = "__rdHud";
    hud.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;color:#f6f9fb;text-shadow:0 2px 10px rgba(0,0,0,.85);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    hud.innerHTML = "<div data-side></div><div data-name></div><div data-state></div>";
    document.body.appendChild(hud);

    const wallT = (s, y) => s && { x: s.f.x, y, z: s.f.z, nx: s.f.nx, nz: s.f.nz, tx: s.f.tx, tz: s.f.tz, ox: s.b.ox, oz: s.b.oz };
    const brickT = brick && wallT(brick, Math.min(brick.b.h - 1.2, (brick.b.FH || 3.2) * 1.2));
    const glassT = glass && wallT(glass, Math.min(glass.b.h - 1.2, (glass.b.FH || 3.2) * 1.4));
    const propT = (p) => {
      if (!p) return null;
      // stand on the open side: away from the nearest wall
      let nx = 1, nz = 0, bd = 1e9;
      for (const w of walls) {
        const sx = Math.max(w.minX, Math.min(w.maxX, p.x)), sz = Math.max(w.minZ, Math.min(w.maxZ, p.z));
        const d = Math.hypot(p.x - sx, p.z - sz);
        if (d < bd && d > 0.01) { bd = d; nx = (p.x - sx) / d; nz = (p.z - sz) / d; }
      }
      return { x: p.x, y: groundAt(p.x, p.z) + Math.min(2.2, p.h * 0.45), lookY: groundAt(p.x, p.z) + Math.min(2.4, p.h * 0.4), z: p.z, nx, nz, tx: -nz, tz: nx, h: p.h };
    };
    const lampT = propT(lamp), woodT = propT(wood);
    const collT = collapse && { x: collapse.f.x, y: collapse.b.h * 0.35, lookY: collapse.b.h * 0.3, z: collapse.f.z, nx: collapse.f.nx, nz: collapse.f.nz, tx: collapse.f.tx, tz: collapse.f.tz };
    const cams = {
      brickFlight: brickT && tripod(brickT, [[14, 2.2, 6, 56], [17, 2.8, 9, 54], [12, 1.8, -6, 58]]),
      brickSettled: brickT && tripod({ ...brickT, lookY: groundAt(brickT.x, brickT.z) + 0.6 }, [[9, 1.9, 3.5, 56], [11, 2.3, 5, 54], [8, 1.6, -4, 58]]),
      glass: glassT && tripod(glassT, [[15, 2.4, 6, 56], [18, 3, 9, 54], [13, 2, -6, 58]]),
      lamp: lampT && tripod(lampT, [[8, 1.8, 3, 58], [10, 2.2, -4, 56], [7, 1.6, 5, 60]]),
      wood: woodT && tripod(woodT, [[6, 1.7, 2.5, 58], [7.5, 2.1, -3, 56], [5, 1.5, 3.5, 60]]),
      collapse: collT && tripod(collT, [[collapse.b.h * 1.5 + 10, 4, 10, 56], [collapse.b.h * 1.8 + 12, 6, -12, 54], [collapse.b.h * 1.3 + 8, 3, 14, 58]]),
    };
    S = window.__rdSeq = { hud, cams, brickT, glassT, lampT, woodT, collapse, t: {}, done: {},
      found: { brick: !!brick, glass: !!glass, lamp: !!lamp, wood: !!wood, collapse: !!collapse } };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }

  const pose = (c) => {
    const cam = CBZ.camera;
    cam.aspect = input.width / input.height; cam.fov = c.fov || 52; cam.near = 0.2; cam.far = 20000;
    cam.position.set(c.eye.x, c.eye.y, c.eye.z); cam.lookAt(c.look.x, c.look.y, c.look.z);
    cam.updateProjectionMatrix();
    if (CBZ.skySync) CBZ.skySync();
    CBZ.renderer.render(CBZ.scene, cam);
  };
  const park = (t) => {
    if (!CBZ.player || !CBZ.player.pos) return;
    // somewhere safe and out of frame: 40 m back along the target's normal
    const x = t.x + t.nx * 40, z = t.z + t.nz * 40;
    CBZ.player.pos.set(x, groundAt(x, z) + 1.0, z);
    if (CBZ.player.vel) CBZ.player.vel.set(0, 0, 0);
  };
  const rpgAt = (t, y) => {
    park(t);
    CBZ.detonate(t.x + t.nx * 0.1, y != null ? y : t.y, t.z + t.nz * 0.1, "rpg", { byPlayer: true, dirx: -t.nx, dirz: -t.nz });
  };

  const id = input.subject.id;
  daylight(); clean();
  let state = "", missing = false;
  if (id === "brick-flight" || id === "brick-settled") {
    if (!S.brickT) missing = true;
    else {
      if (!S.done.brick) { rpgAt(S.brickT); S.done.brick = true; S.t.brick = 0; }
      const want = id === "brick-flight" ? 0.5 : 6;
      if (want > S.t.brick) { seconds(want - S.t.brick); S.t.brick = want; }
      pose(id === "brick-flight" ? S.cams.brickFlight : S.cams.brickSettled);
    }
  } else if (id === "glass") {
    if (!S.glassT) missing = true;
    else { rpgAt(S.glassT); seconds(1.2); pose(S.cams.glass); }
  } else if (id === "lamp") {
    if (!S.lampT) missing = true;
    else { rpgAt(S.lampT, S.lampT.y); seconds(3); pose(S.cams.lamp); }
  } else if (id === "wood") {
    if (!S.woodT) missing = true;
    else { rpgAt({ ...S.woodT, x: S.woodT.x + S.woodT.nx * 1.2, z: S.woodT.z + S.woodT.nz * 1.2 }, groundAt(S.woodT.x, S.woodT.z) + 0.8); seconds(2.5); pose(S.cams.wood); }
  } else if (id === "collapse") {
    if (!S.collapse) missing = true;
    else {
      park({ x: S.collapse.f.x, z: S.collapse.f.z, nx: S.collapse.f.nx, nz: S.collapse.f.nz });
      try { CBZ.structure.forceCollapse(S.collapse.L, { byPlayer: true }); } catch (_) {}
      seconds(9); pose(S.cams.collapse);
    }
  }
  daylight(); clean();
  if (!missing) {
    // re-pose after the day/clean pass so the frame is current
    const c = { "brick-flight": S.cams.brickFlight, "brick-settled": S.cams.brickSettled, glass: S.cams.glass, lamp: S.cams.lamp, wood: S.cams.wood, collapse: S.cams.collapse }[id];
    if (c) pose(c);
  }
  const before = input.side === "before";
  const q = (n) => S.hud.querySelector("[data-" + n + "]");
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = "position:absolute;top:20px;left:24px;padding:7px 12px;border-radius:7px;background:" +
    (before ? "#b0453e" : "#1f7d59") + ";font-size:12px;font-weight:900;letter-spacing:.13em";
  q("name").textContent = input.subject.label + (missing ? " (no target found)" : "");
  q("name").style.cssText = "position:absolute;left:25px;bottom:52px;font-size:23px;font-weight:850";
  const st = CBZ.debris ? CBZ.debris.stats() : null;
  q("state").textContent = st ? ("pieces live " + st.live + ", settled " + st.static + ", chips " + st.grit) : "";
  q("state").style.cssText = "position:absolute;left:26px;bottom:30px;color:#a4bac8;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  return { ok: true, state, debug: { found: S.found },
    metrics: { debrisPieces: st ? st.live + st.static : 0 } };
}

export default {
  id: "real-debris",
  title: "Real Debris",
  description: "An RPG into brick, glass, a lamp post and a wooden prop, and a concrete building brought down. BEFORE: grey box debris from a shared pool. AFTER: every piece is cut from the thing that broke (its own geometry, material and texture), tumbles as a rigid body, piles, and freezes into merged rubble.",
  beforeLabel: "BEFORE · BOX DEBRIS",
  afterLabel: "AFTER · CUT FROM THE THING",
  pairNote: "Same seed, same targets, same ordnance, same simulated seconds; before = the build before the debris wave",
  urlParams: { seed: 90210 },
  viewport: { width: 1200, height: 740 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  stageTimeoutMs: 900000,
  metrics: { debrisPieces: { label: "Real debris pieces in the world", better: "higher" } },
  subjects,
  stage,
};
