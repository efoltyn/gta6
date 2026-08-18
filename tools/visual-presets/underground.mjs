/* THE UNDERGROUND WORLD, PHOTOGRAPHED.

   Six milestones took the ground from a surface to a solid: a shader mask that
   needs no discovery, a span model that owns the floor, craters from ordnance, a
   room under an intact street, a tunnel under a yard, and ground you can dig.
   Every one of them was verified numerically. Numbers are not a picture, and the
   whole failure family this work exists to kill — the ring you fall through — is
   precisely the case where the numbers are right and the picture is wrong.

   So this storyboard photographs each one at the angle that would expose that
   fault if it were still there, and it is deliberately staged the way the GAME
   runs rather than the way a test does: every beat steps the simulation after it
   changes the world, because the ground mask is dealt on the update tick. A shot
   taken without stepping photographs a hole the physics knows about and the
   renderer has not been told about yet — which is exactly the artefact, arriving
   from the test harness instead of from the bug.
*/

const subjects = [
  { id: "sinkhole", label: "A sinkhole in Natural Disaster",
    focus: "The original fault: a torn ring on unbroken grass with the road running across it. The ground over the mouth must be gone, the walls must go dark with depth, and the buildings must still be standing at the lip.",
    act: { mode: "survival", kind: "sinkhole" }, cam: { frame: "oblique" } },
  { id: "crater", label: "A bomb crater in Gang City",
    focus: "An airstrike takes ground away and keeps it. The road shears square at the rim, the collar is asphalt-coloured rather than the white it sampled from a textured plate, and the dish is deepest at the CENTRE, not at the edge.",
    act: { mode: "city", kind: "crater" }, cam: { frame: "oblique" } },
  { id: "bunker-street", label: "The street over a bunker",
    focus: "The negative result, and the one that matters most: with a room directly beneath it the street must look like a street. Nothing to see is the feature.",
    act: { mode: "city", kind: "bunker" }, cam: { frame: "street" } },
  { id: "bunker-breached", label: "After the bunker buster",
    focus: "The lid becomes a hole. The crater above and the room below are one column — lit floor, walls and lamps visible through the roof the penetrator opened.",
    act: { mode: "city", kind: "bunker", breach: true }, cam: { frame: "intobreach" } },
  { id: "tunnel", label: "A tunnel under the prison yard",
    focus: "The middle keeps its lid, so the yard above is intact; the mouth is a real shaft you climb down. A route you walk, not a trigger you touch.",
    act: { mode: "prison", kind: "tunnel" }, cam: { frame: "mouth" } },
  { id: "digsite", label: "Ground taken away a bucket at a time",
    focus: "A dug pit with VERTICAL walls — a heightfield without side quads reads as a dent. The drawn surface and the walked surface are the same surface.",
    act: { mode: "survival", kind: "dig" }, cam: { frame: "oblique" } },
];

async function stageUnderground(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (t, b, s) => {
    const e = Date.now() + b;
    while (Date.now() < e) { try { if (t()) return true; } catch (_) {} await wait(s || 200); }
    return false;
  };
  const ok = await until(() => CBZ.game && CBZ.stepSim && CBZ.setMode, 300000);
  if (!ok) return { ok: false, err: "never booted" };

  /* THE SIM IS THE ONLY CLOCK from here, and every beat below steps it after it
     touches the world — the ground mask is dealt on the update bus, so a beat
     that changes the ground and shoots without stepping photographs the exact
     artefact this whole storyboard is meant to disprove. */
  if (!window.__ug) {
    window.__ug = { mode: null, frozen: false };
    /* The harness renders once more of its own accord just before it captures,
       and that render uses whatever pose the camera holds AT THAT MOMENT. Since
       the whole difficulty in this file was a camera being moved out from under
       a staged shot, the pose we chose is remembered and re-asserted here. Even
       if something did tick in between, the frame that reaches the PNG is the
       frame this preset composed. */
    window.__ug.pose = null;
    window.__cbzVisualCompare = {
      render() {
        try {
          const P = window.__ug.pose;
          if (P) {
            const c = CBZ.camera;
            c.position.set(P.px, P.py, P.pz);
            c.updateMatrixWorld(true);
            c.lookAt(new THREE.Vector3(P.tx, P.ty, P.tz));
            c.updateProjectionMatrix(); c.updateMatrixWorld(true);
          }
          CBZ.renderer.render(CBZ.scene, CBZ.camera);
        } catch (_) {}
      },
      advance(sec) { window.__ug.step(sec || 0.5); },
    };
    /* FREEZE, THEN LET THE LAST FRAME LAND. Stubbing requestAnimationFrame is
       how every preset here stops the world, and core/loop.js re-arms itself at
       the END of each frame, so the stub does stop it — but ONE callback is
       already queued when the stub goes in, and nothing in staging yields, so
       that frame fires AFTER stage() returns. It runs a full update tick — the
       camera-follow among them, which snaps the lens back onto the player — and
       renders. The compositor then presents THAT, and the PNG is the game's
       camera, not ours.

       It took a pixel readback to see it: the frame we drew had the shaft dead
       centre (103, 85, 57 — wall dirt) while the PNG at the same coordinates
       was pale green. Every "the hole did not render" symptom in this file was
       this, and it also explains the shots that DID look right — the crater and
       the dig pit were framed by the game's own follow camera because the
       player was standing next to them.

       So freeze, then yield twice: the queued frame runs, its re-arm hits the
       stub, and the loop is dead before anything is staged. Every other preset
       here already waits right after stubbing (disaster-sequence.mjs and
       sinkhole-city.mjs both `await wait(700)`), which is why none of them hit
       this — the wait was doing real work and looked like a formality. */
    window.__ug.freeze = async function () {
      if (window.__ug.frozen) return;
      window.requestAnimationFrame = function () { return 0; };
      window.__ug.frozen = true;
      await wait(80);
      await wait(80);
    };
    window.__ug.step = function (sec) {
      const n = Math.max(1, Math.round((sec || 0) * 60));
      for (let i = 0; i < n; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        try { CBZ.stepSim(1 / 60); } catch (_) {}
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
      }
    };
    /* BOOT THE MODE THE WAY THE GAME DOES — click the title card and the Play
       button, as tools/visual-presets/disaster-sequence.mjs does, because that
       is the path a player takes and it is the one the modes are written for.
       CBZ.setMode stays as the fallback for a build with no card.

       Honesty about why this is here: it was written to fix "the sinkhole
       reports active with two shafts and the screen shows nothing", and it did
       not fix that — the cause was the stale frame described above. It is kept
       because booting the real path is right on its own terms, not because it
       cured anything. */
    window.__ug.enter = async function (m) {
      if (window.__ug.mode === m) return;
      const card = document.querySelector('[data-mode="' + m + '"]');
      if (card && CBZ.game && CBZ.game.state !== "playing") {
        card.click();
        for (let i = 0; i < 200 && CBZ.game.state !== "playing"; i++) {
          const b = document.getElementById("playBtn"); if (b) b.click();
          await wait(120);
        }
      }
      if (CBZ.game.state !== "playing" || CBZ.game.mode !== m) {
        try { CBZ.setMode(m); CBZ.resetGame(); CBZ.setState("playing"); } catch (e) {}
      }
      window.__ug.mode = m;
      await window.__ug.freeze();
      window.__ug.step(2.5);
    };
    window.__ug.hideHud = function () {
      const cv = CBZ.renderer && CBZ.renderer.domElement;
      for (const c of Array.from(document.body.children)) {
        if (c === cv || (cv && c.contains && c.contains(cv))) continue;
        c.style.visibility = "hidden";
      }
    };
  }
  const S = window.__ug;
  const subject = input.subject, act = subject.act || {}, cam = subject.cam || {};
  await S.enter(act.mode);
  S.hideHud();

  // ---- stage the world for this beat, then let the game catch up ----
  let focusHole = null, room = null, site = null, note = {};
  /* CLEAR GROUND, INCLUDING OF THE PREVIOUS BEAT. The harness keeps one page
     across the subjects that share a mode, which is deliberate — reboots cost
     minutes — but it means the world a beat is staged into still holds the
     holes the last beat made. flat() picked the first legal junction and that
     is a stable answer, so the bunker was built under the crater from the shot
     before it and "the street over a bunker must look like a street" was
     photographed with someone else's crater in the middle of it.
     groundShaftCanOpen does not refuse this — nothing is wrong with putting a
     room under a crater, it just makes an unreadable picture — so the rule
     belongs here, in the staging, and it reads the carving registry rather than
     keeping its own list of what this file has already done. */
  const clearOfCarvings = function (x, z, r) {
    /* systems/solidground.js gives every carving a plan bbox at registration —
       _x0.._x1/_z0.._z1, correct for a cylinder, a box AND a tube's whole run —
       so this asks the registry rather than re-deriving a radius per kind and
       being wrong about tunnels. */
    const C = CBZ.carvings || [], m = r + 10;
    for (let i = 0; i < C.length; i++) {
      const k = C[i];
      if (!k || k._x0 == null) continue;
      if (x > k._x0 - m && x < k._x1 + m && z > k._z0 - m && z < k._z1 + m) return false;
    }
    return true;
  };
  const flat = function (r) {
    const A = (act.mode === "survival" && CBZ.surv) ? CBZ.surv.arena : (CBZ.city && CBZ.city.arena);
    const cx = A && A.center ? A.center.x : 0, cz = A && A.center ? A.center.z : 0;
    if (!act.mode || act.mode === "city") {
      const J = CBZ.roadJunctions ? (CBZ.roadJunctions() || []) : [];
      for (let i = 0; i < J.length; i++) {
        if (!clearOfCarvings(J[i].x, J[i].z, r)) continue;
        if (CBZ.groundShaftCanOpen(J[i].x, J[i].z, r).ok) return { x: J[i].x, z: J[i].z };
      }
    }
    for (let t = 0; t < 500; t++) {
      const a = t * 2.399, rad = 10 + (t % 44) * 2.2;
      const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
      if (!clearOfCarvings(x, z, r)) continue;
      if (CBZ.groundShaftCanOpen(x, z, r).ok) return { x: x, z: z };
    }
    return { x: cx, z: cz };
  };

  if (act.kind === "sinkhole") {
    const forced = CBZ.disasters && typeof CBZ.disasters.force === "function" ? CBZ.disasters.force("sinkhole") : null;
    let g = 900; while (g-- > 0 && CBZ.disasters.state() !== "active") S.step(0.1);
    S.step(18);
    const L = CBZ.groundShafts || [];
    for (let i = L.length - 1; i >= 0; i--) if (!L[i].crater) { focusHole = L[i]; break; }
    note.forced = forced === undefined ? "void" : !!forced;
    note.state = CBZ.disasters.state();
    note.shafts = L.length;
  } else if (act.kind === "crater") {
    const p = flat(10);
    const gy = CBZ.groundBaseAt(p.x, p.z);
    CBZ.cityAirstrikeExplosion(p.x, p.z, { power: 3.0, radius: 16, byPlayer: true, y: gy });
    S.step(13);                                   // let the fireball clear
    const L = CBZ.groundShafts || [];
    for (let i = L.length - 1; i >= 0; i--) if (L[i].crater) { focusHole = L[i]; break; }
  } else if (act.kind === "bunker") {
    const p = flat(11);
    room = CBZ.buildBunker(p.x, p.z, { hw: 9, hd: 9, height: 3.8, lid: 3.2 });
    S.step(1.5);
    if (room && act.breach) {
      const gy = room.surf;
      CBZ.cityAirstrikeExplosion(room.cx, room.cz, { power: 4.0, radius: 18, byPlayer: true, y: gy });
      S.step(13);
      focusHole = room.breachRim || null;
    }
    note.rooms = CBZ.bunkerSpaceAudit ? CBZ.bunkerSpaceAudit().rooms : 0;
  } else if (act.kind === "tunnel") {
    const t = CBZ.buildTunnel([{ x: -20, z: 2 }, { x: 4, z: 2 }, { x: 22, z: 18 }], { r: 1.8, depth: 4.4 });
    S.step(1.5);
    if (t && t.mouths && t.mouths.length) focusHole = t.mouths[0];
    note.tunnelMetres = CBZ.tunnelAudit ? CBZ.tunnelAudit().metres : 0;
  } else if (act.kind === "dig") {
    /* A dig site REFUSES a slope — the flat-cell grid quantises the terrain and
       a staircase on a hillside is a step you would feel. So try candidates
       until one takes, rather than typing a coordinate and photographing the
       fallback camera when it does not. */
    const A = CBZ.surv ? CBZ.surv.arena : null;
    const cx0 = A && A.center ? A.center.x : 0, cz0 = A && A.center ? A.center.z : 0;
    for (let t = 0; t < 260 && !site; t++) {
      const a = t * 2.399, rad = 8 + (t % 40) * 2.6;
      const x = cx0 + Math.cos(a) * rad, z = cz0 + Math.sin(a) * rad;
      site = CBZ.buildDigSite(x, z, { span: 34, cell: 1.0, maxDepth: 11 });
    }
    note.sited = !!site;
    if (site) {
      for (let i = 0; i < 26; i++) CBZ.digAt(site.x, site.z, 5.0, 0.75);
      for (let i = 0; i < 14; i++) CBZ.digAt(site.x + 6, site.z - 4, 3.0, 0.6);
    }
    S.step(1.5);                                  // <- the tick that deals the mask
    note.dug = CBZ.digAudit ? CBZ.digAudit().deepest : 0;
  }

  // ---- solve the camera off whatever the beat actually produced ----
  const c = CBZ.camera;
  c.aspect = input.width / input.height;
  c.near = 0.3; c.far = 20000; c.fov = 55;
  /* PICK A BEARING WITH NOTHING IN IT — TESTED FROM WHERE THE CAMERA ACTUALLY
     GOES, AND BLIND TO THE GROUND THAT IS NOT DRAWN.

     A hole opens where the placement law allows, which is often beside a tower,
     and a fixed offset put the lens inside one. Casting outward from the hole
     failed too, because the ray tested and the position chosen were different
     paths — so the candidate position is built first and the ray is cast FROM
     IT TO THE SUBJECT.

     That still photographed the inside of a building, and the reason is the
     whole point of this system: A HOLE IN THIS WORLD IS DISCARDED, NOT CUT. The
     ground plate still spans the mouth as geometry — the fragment shader throws
     its pixels away, and a raycast knows nothing about that. So every bearing
     reported the same blocker (the invisible lid, one mouth-radius short of the
     target), no bearing ever came back clear, and the search fell through to
     bearing zero every single time. The measured proof: bestA came back exactly
     0.000 on every run, and 0.000 is the fallback, not a choice.

     Exempting everything within a mouth-radius of the target then swung too
     far the other way and cost another run: a hole opens BESIDE towers, so a
     tower at the lip is within that radius too, and skipping it framed the
     inside of its wall — measured, not guessed, by reading the centre pixel
     back off the GL buffer and getting 238,217,209, a facade.

     So the exemption is the DISCARD CYLINDER, exactly: inside the mouth radius
     in plan AND within the mask's own band of that hole's grade. That is the
     ground whose pixels are thrown away and nothing else. A wall at the lip is
     ten metres out and fifteen metres up — outside the band, and a blocker. */
  let bearing = null;                       // null = no bearing search ran (fixed framing)
  let bearingFell = false;                  // true = every bearing was blocked, this is the fallback
  const pickBearing = (tx, ty, tz, posFor, lid) => {
    const rc = new T.Raycaster();
    if (CBZ.camera) rc.camera = CBZ.camera;
    const target = new T.Vector3(tx, ty, tz);
    // the invisible lid: {x, z, r, y}. Matches core/groundmask.js's own band.
    const lx = lid ? lid.x : tx, lz = lid ? lid.z : tz;
    const lr = lid ? lid.r + 1.0 : 0, ly = lid ? lid.y : ty;
    let bestA = 0.785, bestClear = -1;
    for (let i = 0; i < 24; i++) {
      const a = 0.785 + (i / 24) * Math.PI * 2;      // start on a 3/4 view
      const p = posFor(a);
      const dir = target.clone().sub(p);
      const dist = dir.length();
      if (!(dist > 0.5)) continue;
      dir.normalize();
      rc.set(p, dir); rc.far = dist;
      let blocked = 0;
      try {
        const hits = rc.intersectObject(CBZ.scene, true) || [];
        for (let k = 0; k < hits.length; k++) {
          const o = hits[k].object;
          if (!o.visible) continue;
          let mine = false;
          for (let q = o; q; q = q.parent) {
            if (q.userData && (q.userData.groundShaft || q.userData.bunkerSpace || q.userData.tunnel || q.userData.digSite)) { mine = true; break; }
          }
          if (mine) continue;
          const pt = hits[k].point;
          if (lr > 0 && pt.y < ly + 0.3 && pt.y > ly - 6.5 &&
              Math.hypot(pt.x - lx, pt.z - lz) < lr) continue;   // ground that is not drawn
          if (hits[k].distance < dist - 1.5) { blocked = dist - hits[k].distance; break; }
        }
      } catch (e) {}
      if (!blocked) { bearing = a; return a; }
      const clear = dist - blocked;
      if (clear > bestClear) { bestClear = clear; bestA = a; }
    }
    bearing = bestA; bearingFell = true;
    return bestA;
  };
  const put = (px, py, pz, tx, ty, tz) => {
    S.pose = { px: px, py: py, pz: pz, tx: tx, ty: ty, tz: tz };
    c.position.set(px, py, pz);
    c.updateMatrixWorld(true);
    c.lookAt(new T.Vector3(tx, ty, tz));
    c.updateProjectionMatrix(); c.updateMatrixWorld(true);
  };
  if (cam.frame === "oblique" && focusHole) {
    /* Steeper than it was. A 39-degree eye on a 47 m shaft sees mostly the near
       wall, and is the easiest angle in the world for a tower at the lip to
       stand in. This looks down INTO it. */
    const h = focusHole, d = Math.max(h.r * 2.4, 13);
    const hy = h.gy + Math.max(h.depth * 0.55, h.r * 2.0);
    const a = pickBearing(h.x, h.gy, h.z, (ang) => new T.Vector3(h.x + Math.cos(ang) * d, hy, h.z + Math.sin(ang) * d), { x: h.x, z: h.z, r: h.r, y: h.gy });
    put(h.x + Math.cos(a) * d, hy, h.z + Math.sin(a) * d, h.x, h.gy - Math.min(h.depth * 0.4, 8), h.z);
  } else if (cam.frame === "oblique" && site) {
    /* STEEP, AND CLOSE. A pit is invisible from anywhere near its own grade —
       its rim hides it, which is correct and useless in a photograph. At 20 m
       out and 13 m up an 11 m pit read as a scuff; the heightfield and the
       drawn geometry both said -11 and the picture said nothing. This looks
       down into it. */
    const ds2 = Math.max(14, site.span * 0.45), sy = site.surf + 19;
    const a2 = pickBearing(site.x, site.surf, site.z,
      (ang) => new T.Vector3(site.x + Math.cos(ang) * ds2, sy, site.z + Math.sin(ang) * ds2),
      { x: site.x, z: site.z, r: site.span * 0.5, y: site.surf });
    put(site.x + Math.cos(a2) * ds2, sy, site.z + Math.sin(a2) * ds2, site.x, site.surf - 7, site.z);
  } else if (cam.frame === "street" && room) {
    /* Nothing here is discarded — that is the whole claim of this beat — so
       there is no lid to exempt and every hit is a genuine occluder. */
    const ds = 32, ys = room.surf + 26;
    const as = pickBearing(room.cx, room.surf, room.cz,
      (ang) => new T.Vector3(room.cx + Math.cos(ang) * ds, ys, room.cz + Math.sin(ang) * ds), null);
    put(room.cx + Math.cos(as) * ds, ys, room.cz + Math.sin(as) * ds, room.cx, room.surf, room.cz);
  } else if (cam.frame === "intobreach" && (focusHole || room)) {
    const h = focusHole || { x: room.cx, z: room.cz, gy: room.surf, r: 8, depth: 6 };
    const db = h.r * 1.7, by = h.gy + h.r * 1.2;
    const ab = pickBearing(h.x, h.gy, h.z, (ang) => new T.Vector3(h.x + Math.cos(ang) * db, by, h.z + Math.sin(ang) * db), { x: h.x, z: h.z, r: h.r, y: h.gy });
    put(h.x + Math.cos(ab) * db, by, h.z + Math.sin(ab) * db, h.x, room ? room.y0 + 1.2 : h.gy - 6, h.z);
  } else if (cam.frame === "mouth" && focusHole) {
    /* A tunnel mouth is small (r under 3 m), so a purely proportional offset
       puts the lens 8 m out and 6 m up — inside a prison yard, that is against
       a wall, and the wall is beside the lens rather than in front of it so no
       bearing search can see the problem. Floors on both, so the shot carries
       enough yard to show the mouth is IN something. */
    const h = focusHole, dm = Math.max(h.r * 4.5, 13), my = h.gy + Math.max(h.r * 3.2, 9);
    const am = pickBearing(h.x, h.gy, h.z, (ang) => new T.Vector3(h.x + Math.cos(ang) * dm, my, h.z + Math.sin(ang) * dm), { x: h.x, z: h.z, r: h.r, y: h.gy });
    put(h.x + Math.cos(am) * dm, my, h.z + Math.sin(am) * dm, h.x, h.gy - h.depth * 0.55, h.z);
  } else {
    const p = CBZ.player && CBZ.player.pos ? CBZ.player.pos : { x: 0, y: 2, z: 0 };
    put(p.x + 14, p.y + 10, p.z + 14, p.x, p.y, p.z);
  }
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else { const rig = CBZ.skyDome && CBZ.skyDome.parent; if (rig) { rig.position.set(c.position.x, 0, c.position.z); rig.updateMatrixWorld(true); } }
  try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
  /* WHAT THE BUFFER ACTUALLY HELD. A shot of a hole that shows unbroken grass
     has exactly two causes and they need opposite fixes: the camera is not
     where the metadata says, or the frame reaching the PNG is not the frame we
     drew. Reading the centre pixel straight off the GL back buffer, in the same
     turn as the render, separates them without another run. */
  try {
    const gl = CBZ.renderer.getContext(), px = new Uint8Array(4);
    gl.readPixels((gl.drawingBufferWidth / 2) | 0, (gl.drawingBufferHeight / 2) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    note.centrePx = [px[0], px[1], px[2]];
  } catch (e) { note.centrePx = "unreadable"; }

  note.cam = [ +c.position.x.toFixed(1), +c.position.y.toFixed(1), +c.position.z.toFixed(1) ];
  note.bearing = bearing == null ? "fixed" : (+bearing.toFixed(3) + (bearingFell ? " (fallback)" : ""));
  note.aimed = focusHole ? [ +focusHole.x.toFixed(1), +focusHole.gy.toFixed(1), +focusHole.z.toFixed(1),
                             +focusHole.r.toFixed(1), +focusHole.depth.toFixed(1), !!(focusHole.grp && focusHole.grp.visible) ]
             : (site ? ["site", +site.x.toFixed(1), +site.surf.toFixed(1), +site.z.toFixed(1)] : "none");
  const ga = CBZ.groundMaskAudit ? CBZ.groundMaskAudit() : {};
  const sa = CBZ.solidAudit ? CBZ.solidAudit() : {};
  return {
    ok: true,
    mode: CBZ.game.mode,
    staged: act.kind,
    note: note,
    metrics: {
      carvings: sa.carvings || 0,
      lids: sa.lids || 0,
      maskFilled: ga.filled || 0,
      maskSlots: ga.slots || 0,
      drawCalls: (CBZ.renderer && CBZ.renderer.info && CBZ.renderer.info.render) ? CBZ.renderer.info.render.calls : 0,
    },
  };
}

export default {
  id: "underground",
  title: "The underground world",
  description: "Six milestones that took the ground from a surface to a solid, photographed at the angle that would expose the fault they exist to kill: a hole the physics knows about and the picture does not. A sinkhole, a bomb crater, the street over a bunker, the same bunker after a penetrator, a tunnel under the prison yard, and a pit dug by hand.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "carvings is how many volumes are currently subtracted from the ground; lids counts the ones that keep solid ground over them, which is the shape that did not exist before this work. maskFilled against maskSlots is the ground mask actually dealing — a hole with no slot is a hole with the ground still drawn across it.",
  metrics: {
    carvings: { label: "Carvings live", better: "higher" },
    lids: { label: "Lids (room under solid ground)", better: "higher" },
    maskFilled: { label: "Mask slots dealt", better: "higher" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageUnderground,
};
