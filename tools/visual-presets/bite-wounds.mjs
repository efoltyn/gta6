/* BITE WOUNDS BY ATTACKER — what a body looks like after a bite, per animal.

   OWNER (2026-11-22): "improving the way humans look after different bites
   from different animals and the way animals look after different bites from
   different animals ... code then show".

   One controlled bite per frame through the game's own wound doors:
     people    CBZ.bodyBite(bot, point, { jaw, sev, by, dir, part, fromX, fromZ })
     animals   CBZ.creatureBiteChunk(actor, point, { jaw, sev, by, dir })
   with the attacker's species in `by` and a real jaw radius for that animal.
   A build that does not read `by` draws every bite the same, which is the
   honest before. The point is taken off the victim's own body (the part
   mesh for a person, the built body's box for an animal), so both builds
   bite the same place.

   Boots ?mode=survival, holds the disaster director, freezes the frame loop.
   People stand on the beach and are shot in the world; animals are bitten
   where they spawn and photographed in a neutral studio (lifted out of the
   water so the sea's veil does not hide the wound). Each frame: left the
   whole body, right the wound up close.                                      */

const H = (id, by, jaw, part, side, label, focus) => ({ id, kind: "human", by, jaw, part, side, label, focus });
const A = (id, sp, by, jaw, along, up, label, focus) => ({ id, kind: "animal", species: sp, by, jaw, along, up, label, focus });
const subjects = [
  H("h-dog", "dog:shepherd", 0.045, "armsLower", 0, "A person bitten on the forearm by a dog", "A K9-sized bite: canine punctures in an arc, torn sleeve, bruising."),
  H("h-wolf", "gray_wolf", 0.055, "legsLower", 0, "A person bitten on the calf by a wolf", ""),
  H("h-great-white", "great_white_shark", 0.22, "legs", 0, "A person bitten on the thigh by a great white", "A crescent of serrated tooth cuts, tissue gone."),
  H("h-bull-shark", "bull_shark", 0.12, "legsLower", 1, "A person bitten on the calf by a bull shark", ""),
  H("h-bear", "brown_bear", 0.08, "arms", 1, "A person bitten on the upper arm by a brown bear", ""),
  H("h-tiger", "bengal_tiger", 0.075, "collar", 0, "A person bitten at the neck by a tiger", ""),
  A("a-tuna", "tuna", "great_white_shark", 0.22, 0.05, 0.15, "A bluefin tuna bitten by a great white", ""),
  A("a-dolphin", "dolphin", "bull_shark", 0.12, -0.3, 0.1, "A dolphin bitten by a bull shark", ""),
  A("a-megalodon", "megalodon", "orca", 0.2, 0.0, 0.2, "A megalodon bitten by an orca", ""),
  A("a-deer", "elk", "gray_wolf", 0.055, -0.35, 0.25, "An elk bitten on the haunch by a wolf", ""),
  A("a-coyote", "coyote", "gray_wolf", 0.055, 0.38, 0.3, "A coyote bitten at the neck by a wolf", ""),
];
// stage() is shipped into the page by toString(): it sees the subject it is
// handed, never this module, so each subject carries its own index
subjects.forEach((s, i) => { s.idx = i; });

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__bites;
  if (!D) {
    D = window.__bites = {
      booted: false, used: [], m: {}, view: null,
      step(n) {
        for (let i = 0; i < n; i++) {
          if (CBZ.game.state !== "playing") CBZ.game.state = "playing";
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          const P = CBZ.player; if (P) { P.hp = 100; P.dead = false; }
          if (D.hold) D.hold();
          CBZ.stepSim(1 / 60);
        }
      },
      sec(s) { D.step(Math.max(1, Math.round(s * 60))); },
      async boot() {
        for (let t = 0; t < 2000 && !(CBZ.game && document.getElementById("playBtn") && document.querySelector('[data-mode="survival"]')); t++) await sleep(150);
        const mb = document.querySelector('[data-mode="survival"]');
        if (!mb) return false;
        mb.click();
        let started = false;
        for (let t = 0; t < 600 && !started; t++) {
          const pb = document.getElementById("playBtn");
          if (CBZ.game.state !== "playing" && pb) pb.click();
          if (CBZ.game.state === "playing") { started = true; break; }
          await sleep(300);
        }
        if (!started) return false;
        D._raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        for (let t = 0; t < 400 && !(CBZ.surv && CBZ.surv.arena); t++) { try { CBZ.stepSim(1 / 60); } catch (e) {} await sleep(50); }
        if (!CBZ.surv || !CBZ.surv.arena) return false;
        try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
        D.sec(0.2);
        for (const u of CBZ.updaters || []) if (u && u.order === 28 && /tsuSeaCalmStep/.test(String(u.fn))) u.fn = function () {};
        D.sec(1);
        return true;
      },
      Ar() { return CBZ.surv.arena; },
      ground(x, z) { const A0 = D.Ar(); return A0.groundHeightAt ? A0.groundHeightAt(x, z) : 0; },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.48; },
      // dry, fairly flat ground just inside the beach on bearing a
      land(a) {
        const A0 = D.Ar();
        for (let r = A0.radius - 18; r > A0.radius * 0.4; r -= 4) {
          const x = A0.center.x + Math.cos(a) * r, z = A0.center.z + Math.sin(a) * r;
          const g = D.ground(x, z), g2 = D.ground(x + 2, z + 2);
          if (g > D.seaY(x, z) + 0.6 && Math.abs(g2 - g) < 0.6) return { x, z, y: g };
        }
        return { x: A0.center.x, z: A0.center.z, y: D.ground(A0.center.x, A0.center.z) };
      },
      bot() {
        const bots = (CBZ.bots || []).filter((b) => b && !b.dead && b.char && D.used.indexOf(b) < 0);
        const b = bots[0]; if (!b) return null;
        D.used.push(b);
        return b;
      },
      // keep the staged victims where they were put
      holds: [],
      hold() { for (const h of D.holds) { const o = h.o; o.pos.x = h.x; o.pos.z = h.z; if (h.y != null) o.pos.y = h.y; if (o.pause != null) o.pause = 9999; o.speed = 0; } },
      worldBox(obj) { return new T.Box3().setFromObject(obj, true); },
      // two lenses on one canvas: the whole body (left) and the wound (right)
      twoViews(wholeT, wholeP, woundT, woundP, studio) {
        const R = CBZ.renderer, cam = CBZ.camera;
        const W = R.domElement.width, Hh = R.domElement.height, w = Math.floor((W - 2) / 2);
        const sc = studio ? studio.scene : CBZ.scene;
        R.setScissorTest(true);
        R.setViewport(0, 0, W, Hh); R.setScissor(0, 0, W, Hh); R.setClearColor(0x101418, 1); R.clear();
        const lens = function (P, Tg, x) {
          cam.position.copy(P); cam.lookAt(Tg); cam.fov = 40; cam.aspect = w / Hh; cam.near = 0.02; cam.far = 3000;
          cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
          R.setViewport(x, 0, w, Hh); R.setScissor(x, 0, w, Hh); R.clear();
          R.render(sc, cam);
        };
        lens(wholeP, wholeT, 0);
        lens(woundP, woundT, w + 2);
      },
      studio() {
        if (D.st) return D.st;
        const s = new T.Scene(); s.background = new T.Color(0xb9bec2);
        const hemi = new T.HemisphereLight(0xe4eefa, 0x8d8272, 0.95);
        const sun = new T.DirectionalLight(0xfff2de, 1.15); sun.position.set(6, 10, 7);
        const rim = new T.DirectionalLight(0xdfe8ff, 0.35); rim.position.set(-6, 5, -8);
        s.add(hemi, sun, rim);
        D.st = { scene: s, Y: 400 };
        const floor = new T.Mesh(new T.CircleGeometry(80, 64), new T.MeshLambertMaterial({ color: 0xa9aeb2 }));
        floor.rotation.x = -Math.PI / 2; floor.position.y = D.st.Y; s.add(floor);
        return D.st;
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        const canvas = CBZ.renderer && CBZ.renderer.domElement;
        for (const child of Array.from(document.body.children)) {
          if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
          child.style.visibility = "hidden";
        }
        if (CBZ.skySync) CBZ.skySync();
        await new Promise((res) => D._raf.call(window, () => {
          const R = CBZ.renderer, ac = R.autoClear;
          try { R.autoClear = false; if (D.view) D.view(); else R.render(CBZ.scene, CBZ.camera); }
          finally {
            R.autoClear = ac; R.setScissorTest(false);
            const W = R.domElement.width, Hh = R.domElement.height;
            R.setViewport(0, 0, W, Hh); R.setScissor(0, 0, W, Hh);
          }
          res();
        }));
        await new Promise((r) => setTimeout(r, 400));
      },
    };
  }
  if (!D.booted) { if (!await D.boot()) throw new Error("survival never started"); D.booted = true; }
  D.view = null;
  const idx = sub.idx | 0;
  const lensAt = (p, o) => { const c = CBZ.camera; c.position.set(p.x + o.x * 2.5, p.y + 0.6, p.z + o.z * 2.5); c.lookAt(p.x, p.y, p.z); c.updateMatrixWorld(true); };
  const audit = () => { const r = CBZ.woundDecalAudit ? CBZ.woundDecalAudit() : null; return { n: r ? (r.biteMarks | 0) : 0, why: r ? String(r.lastRefusal || "") : "" }; };
  // marks laid on a body = wound meshes under its group (every mark wounds.js lays is tagged)
  const marks = (g) => { let n = 0; if (g) g.traverse((o) => { if (o.userData && (o.userData.cbzSkinMark || o.userData.cbzWound)) n++; }); return n; };
  // the wound as it was actually laid: the world centre of the mark meshes this
  // bite added (posed, for a skinned one), so the close lens looks at the wound
  // and not at the point the jaw was aimed at
  const markSet = (g) => { const set = new Set(); if (g) g.traverse((o) => { if (o.userData && (o.userData.cbzSkinMark || o.userData.cbzWound)) set.add(o); }); return set; };
  const woundAt = (g, pre, near) => {
    const box = new T.Box3();
    g.updateMatrixWorld(true);
    g.traverse((o) => { if (o.isMesh && !pre.has(o) && o.userData && (o.userData.cbzSkinMark || o.userData.cbzWound)) box.expandByObject(o, true); });
    if (box.isEmpty()) return near;
    const c = box.getCenter(new T.Vector3());
    return c.distanceTo(near) < 1.2 ? c : near;
  };

  // shown = this object and every parent visible (a parked far model is not the body)
  const shown = (o) => { for (let q = o; q; q = q.parent) if (q.visible === false) return false; return true; };
  // the first VISIBLE surface a ray meets under root (marks and lines skipped)
  const hitOn = (root, origin, dir, far) => {
    const rc = new T.Raycaster(origin, dir.clone().normalize(), 0, far);
    const hits = rc.intersectObject(root, true).filter((h) => h.object.isMesh && shown(h.object) && !(h.object.userData && h.object.userData.cbzSkinMark));
    if (!hits.length) return null;
    const h = hits[0], p = h.point.clone();
    // the surface's own outward normal there: the close lens looks straight at the wound along it
    p.n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate().normalize();
    if (p.n.dot(dir) > 0) p.n.negate();
    return p;
  };
  // the flank at one point along the body: rays from the side at 32 heights;
  // hits that stand well out from the midplane are flank (a fin, an antler or a
  // leg seen edge-on is thin), the longest run of them is the body, and the
  // bite goes at its fraction up that run
  const flank = (g, aimW, side, wb, halfW, up) => {
    const N = 32, hits = [];
    let maxLat = 0;
    for (let i = 0; i < N; i++) {
      const o = aimW.clone(); o.y = wb.min.y + (wb.max.y - wb.min.y) * (i + 0.5) / N; o.addScaledVector(side, halfW + 1.5);
      const h = hitOn(g, o, side.clone().negate(), halfW * 2 + 3);
      if (h) { h.lat = new T.Vector3().subVectors(h, aimW).dot(side); if (h.lat > maxLat) maxLat = h.lat; }
      hits.push(h);
    }
    let best = [], cur = [];
    for (let i = 0; i <= N; i++) {
      const h = i < N ? hits[i] : null;
      if (h && h.lat > maxLat * 0.4) cur.push(h);
      else { if (cur.length > best.length) best = cur; cur = []; }
    }
    if (!best.length) return null;
    return best[Math.min(best.length - 1, Math.max(0, Math.round((best.length - 1) * (0.5 + up * 0.5))))];
  };
  // the body in its own frame, from its visible meshes only (posed, for a skinned one):
  // extent, and its highest point (a land animal's head end: ears, antlers)
  const visLocal = (g) => {
    g.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(g.matrixWorld).invert(), M = new T.Matrix4(), v = new T.Vector3();
    const box = new T.Box3(), top = new T.Vector3(0, -1e9, 0);
    g.traverseVisible((m) => {
      if (!m.isMesh || m.isInstancedMesh || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) return;
      if (m.userData && m.userData.cbzSkinMark) return;
      const pos = m.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 800));
      M.multiplyMatrices(inv, m.matrixWorld);
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        if (m.isSkinnedMesh && m.applyBoneTransform) m.applyBoneTransform(i, v);
        v.applyMatrix4(M); box.expandByPoint(v); if (v.y > top.y) top.copy(v);
      }
    });
    return { box, top };
  };

  if (sub.kind === "human") {
    const b = D.bot();
    if (!b) throw new Error("no survivor to bite");
    const spot = D.land(0.4 + idx * 0.5);
    b.pos.x = spot.x; b.pos.z = spot.z; b.pos.y = spot.y;
    if (b.target && b.target.set) b.target.set(spot.x, 0, spot.z);
    b.state = "wander"; b.pause = 9999; b.speed = 0; b.panicT = 0;
    D.holds.push({ o: b, x: spot.x, z: spot.z });
    D.sec(0.8);
    const ch = b.char, S = ch && ch.skinSlots;
    const list = S && S[sub.part];
    const part = list && (list[sub.side] || list[0]);
    if (!part) throw new Error("no body part " + sub.part);
    b.group.updateMatrixWorld(true);
    const box = D.worldBox(part), c = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
    // where the animal comes from: a thigh or the throat from the front, a calf
    // from behind (the person turning away), an arm from its own side
    const fwd = new T.Vector3(0, 0, 1).applyQuaternion(b.group.quaternion); fwd.y = 0; fwd.normalize();
    const left = new T.Vector3(0, 1, 0).cross(fwd).normalize();
    const sideOut = sub.side === 1 ? left.clone().negate() : left.clone();
    const out = sub.part === "legsLower" ? fwd.clone().negate() : (sub.part === "legs" || sub.part === "collar") ? fwd.clone() : sideOut;
    const perp = new T.Vector3(0, 1, 0).cross(out).normalize();
    const reach = Math.max(size.x, size.y, size.z) + 0.5;
    const pt = hitOn(part, c.clone().addScaledVector(out, reach), out.clone().negate(), reach * 2) || c.clone().addScaledVector(out, Math.max(size.x, size.z) * 0.5);
    const from = pt.clone().addScaledVector(out, 0.6);
    const dir = out.clone().negate();
    // wounds.js lays marks only within 45 m of the lens: the lens is beside the victim when the jaw closes
    lensAt(pt, out);
    const a0 = audit();
    let ok = false; const m0 = marks(b.group), pre = markSet(b.group);
    try { ok = CBZ.bodyBite(b, { x: pt.x, y: pt.y, z: pt.z }, { jaw: sub.jaw, sev: 0.85, by: sub.by, dir: { x: dir.x, y: dir.y, z: dir.z }, part: sub.part, fromX: from.x, fromZ: from.z }) !== false; } catch (e) { ok = "threw: " + e.message; }
    D.sec(1.2);
    b.group.updateMatrixWorld(true);
    const bb = D.worldBox(b.group), bc = bb.getCenter(new T.Vector3()), bh = bb.getSize(new T.Vector3()).y || 1.7;
    const wc = woundAt(b.group, pre, pt);
    const a1 = audit();
    // the studio: the person lifted out of the world (no wall or tree in the lens)
    const st = D.studio();
    D.view = function () {
      const g = b.group, parent = g.parent, p0 = g.position.clone();
      const lift = new T.Vector3(0, st.Y + 0.02 - bb.min.y, 0);
      st.scene.add(g); g.position.copy(p0).add(lift); g.updateMatrixWorld(true);
      const cc = bc.clone().add(lift), pp = wc.clone().add(lift);
      const wholeP = cc.clone().addScaledVector(out, 2.7).addScaledVector(perp, 1.3); wholeP.y = cc.y + 0.35;
      const woundP = pp.clone().addScaledVector(out, 0.55 + sub.jaw * 2.2).addScaledVector(perp, 0.18); woundP.y += 0.12;
      try { D.twoViews(cc, wholeP, pp, woundP, st); }
      finally { if (parent) parent.add(g); g.position.copy(p0); g.updateMatrixWorld(true); }
    };
    D.m = { bitten: ok === true ? 1 : 0, marks: marks(b.group) - m0, laid: a1.n - a0.n, refusal: a1.why, height: +bh.toFixed(2) };
  } else {
    const spot = /tuna|dolphin|megalodon/.test(sub.species) ? null : D.land(2.2 + idx * 0.45);
    let x, z;
    if (spot) { x = spot.x; z = spot.z; }
    else {
      const A0 = D.Ar(), a = 3.4 + idx * 0.4;
      x = A0.center.x + Math.cos(a) * (A0.radius + 60); z = A0.center.z + Math.sin(a) * (A0.radius + 60);
    }
    const a = CBZ.cityWildlifeSpawnAt ? CBZ.cityWildlifeSpawnAt(sub.species, x, z) : null;
    if (!a) throw new Error("no spawn " + sub.species);
    // the camera near it so its body is built and not culled
    const cam = CBZ.camera; cam.position.set(x + 6, (spot ? spot.y : D.seaY(x, z)) + 3, z + 6); cam.lookAt(x, spot ? spot.y : D.seaY(x, z), z);
    if (CBZ.player) { CBZ.player.pos.x = x + 5; CBZ.player.pos.z = z + 5; }
    D.holds.push({ o: a, x, z, y: spot ? null : D.seaY(x, z) - 1.5 });
    D.sec(1.0);
    // the body's own axes: long axis from its visible extent; on land the head
    // is the end with the highest point (ears, antlers)
    const L = visLocal(a.group), lb = L.box, ls = lb.getSize(new T.Vector3()), lc = lb.getCenter(new T.Vector3());
    const alongX = ls.x >= ls.z;
    const headSign = spot ? (((alongX ? L.top.x : L.top.z) >= (alongX ? lc.x : lc.z)) ? 1 : -1) : 1;
    const fL = alongX ? new T.Vector3(headSign, 0, 0) : new T.Vector3(0, 0, headSign);
    const sL = new T.Vector3(0, 1, 0).cross(fL).normalize();
    const Mw = a.group.matrixWorld, sc = new T.Vector3().setFromMatrixScale(Mw).x || 1;
    const lenL = alongX ? ls.x : ls.z, widL = alongX ? ls.z : ls.x;
    const len = lenL * sc, halfW = widL * sc * 0.5, hgt = ls.y * sc;
    const fwd = fL.clone().transformDirection(Mw), side = sL.clone().transformDirection(Mw);
    const c = lc.clone().applyMatrix4(Mw), wb = lb.clone().applyMatrix4(Mw);
    const aimL = lc.clone().addScaledVector(fL, sub.along * lenL); aimL.y = lb.min.y + ls.y * (0.5 + sub.up * 0.5);
    const aimW = aimL.applyMatrix4(Mw);
    const pt = flank(a.group, aimW, side, wb, halfW, sub.up)
      || hitOn(a.group, aimW.clone().addScaledVector(side, halfW + 1.5), side.clone().negate(), halfW * 2 + 3)
      || aimW.clone().addScaledVector(side, halfW * 0.85);
    const dir = side.clone().negate();
    lensAt(pt, side);
    let ok = false; const m0 = marks(a.group), pre = markSet(a.group);
    try { ok = !!CBZ.creatureBiteChunk(a, { x: pt.x, y: pt.y, z: pt.z }, { jaw: sub.jaw, sev: 0.9, by: sub.by, dir: { x: dir.x, y: dir.y, z: dir.z }, bleedS: 12 }); } catch (e) { ok = "threw: " + e.message; }
    D.sec(0.6);
    const wc = woundAt(a.group, pre, pt);
    // the studio: lift the body out of the world into a neutral stage
    const st = D.studio();
    D.view = function () {
      const g = a.group, parent = g.parent, p0 = g.position.clone();
      const dy = st.Y + 0.02 - wb.min.y + (spot ? 0 : hgt * 0.15);
      const lift = new T.Vector3(0, dy, 0);
      st.scene.add(g); g.position.copy(p0).add(lift); g.updateMatrixWorld(true);
      const cc = c.clone().add(lift), pp = wc.clone().add(lift);
      const span = Math.max(len, hgt * 1.4);
      const wholeP = cc.clone().addScaledVector(side, span * 1.5 + 0.6).addScaledVector(fwd, span * 0.35); wholeP.y += span * 0.28;
      const nrm = pt.n ? pt.n.clone().lerp(side, 0.35).normalize() : side;
      const woundP = pp.clone().addScaledVector(nrm, 0.45 + sub.jaw * 3.2).addScaledVector(fwd, 0.1); woundP.y += 0.1 + sub.jaw;
      try { D.twoViews(cc, wholeP, pp, woundP, st); }
      finally { if (parent) parent.add(g); g.position.copy(p0); g.updateMatrixWorld(true); }
    };
    D.m = { bitten: ok === true ? 1 : 0, marks: marks(a.group) - m0, length: +len.toFixed(2) };
  }
  return { ok: true, state: JSON.stringify(D.m), metrics: D.m };
}

export default {
  id: "bite-wounds",
  title: "Bite wounds by attacker, on people and animals",
  description: "Six people bitten by six different animals and five animals bitten by other animals, each through the game's own wound doors with the attacker named and a real jaw size; whole body and the wound up close.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  pairNote: "Same victim, same point, same jaw size, same attacker named on both sides",
  method: "Boots ?mode=survival, holds the disaster director, freezes the frame loop; people are survivors standing on the beach bitten with CBZ.bodyBite, animals are spawned with CBZ.cityWildlifeSpawnAt and bitten with CBZ.creatureBiteChunk, then lifted into a neutral studio for the picture.",
  beforeParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  metrics: { bitten: { label: "The bite landed", better: "higher" }, marks: { label: "Wound meshes laid on the body", better: "higher" } },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage,
};
