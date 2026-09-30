#!/usr/bin/env node
/* tools/president-walkout.mjs — THE PRESIDENT WALKS OUT OF THE OVAL OFFICE,
   IN THE REAL GAME, ON A PHONE AND ON A DESKTOP.

   OWNER (2026-09-29, on the live build): "I literally can't get out of the
   fucking Oval Office, dude." tools/estate-door-census.mjs had passed 100% in
   plain node the same day: its vm world is the govcomplex pass on a stub city,
   so it could never see anything the real page adds on top (the President's
   own spawn code, the streamed city, the batch, the fit-out, the interaction
   registry, the seat, the camera). This boots the page.

   For each profile (phone: iPhone UA + touch + 390x844, the city STREAMS;
   desktop: the whole city at once):
     1. boot, pick The President, press Play, wait until he is in the chair
        behind the desk (president_office.js's spawn);
     2. stand up the way a player does (desktop: F; phone: the #tExit pill);
     3. route (in page, on the game's own colliders + walkGroundAt, a 0.25 m
        grid with the 0.38 m body) from the chair out of the West Wing, and on
        to outside the estate's walls: the street;
     4. WALK it with the game's own movement (CBZ.keys.w + the camera yaw,
        CBZ.stepSim ticks; never a teleport). Every shut door on the route is
        opened the way a player opens it: the Oval Office's door by [E]
        (desktop) or a TAP on the door (phone, CBZ.cityTapWorld, the one tap
        pipeline), every other door by [E] / a tap likewise;
     5. assert he got out; on anything that stops him, log exactly what: the
        collider(s) in his body band (bounds, band, owner mesh, whether that
        mesh is still in the scene, which door record owns it), the door
        states round him, peds in the way, any teleport (and who did it).
        So the one run surfaces EVERY blocker, a blocked leg is forced past
        (flagged as a failure) and the walk continues.

   USAGE  node tools/president-walkout.mjs [--profile phone|desktop|both]
                                           [--seed talloran] [--json out.json]
          exit 0 = he walked out on every profile. ~4-8 min per profile on a
          loaded Mac (a Gang City boot on SwiftShader dominates). */
import { launch, sleep } from "./lib/cdp.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const PROFILES = (() => { const p = arg("--profile", "both"); return p === "both" ? ["phone", "desktop"] : [p]; })();
const SEED = arg("--seed", "talloran");
const JSON_OUT = arg("--json", null);
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

/* ======================================================================
   THE IN-PAGE WALKER. Serialised with toString() and run in the page.
   ====================================================================== */
function pageLib() {
  const CBZ = window.CBZ, THREE = window.THREE;
  const P = CBZ.player;
  const UD = CBZ.cityUnitDoors;
  const R_BODY = (CBZ.TUNE && CBZ.TUNE.playerRadius) || 0.38;
  const BODY_H = 1.7, STEP_SOLID = 0.42, STEP_UP = 0.45, STEP_DOWN = 0.9;
  const W = { virt: [], replans: 0, hist: [], log: [], events: [], path: null, leg: null, pi: 0, best: 0, bestT: 0, t: 0, lastPos: null, forced: [] };
  const r2 = (v) => Math.round(v * 100) / 100;
  const pos = () => ({ x: r2(P.pos.x), y: r2(P.pos.y), z: r2(P.pos.z) });

  function oval() {
    const rs = CBZ.presidentInteriorRooms ? CBZ.presidentInteriorRooms() : [];
    return rs.find((r) => r.key === "ovaloffice" && r.landmarks && r.landmarks.presidentialDesk) || null;
  }
  function inRect(b, x, z, pad) { return Math.abs(x - b.ox) <= b.w / 2 + (pad || 0) && Math.abs(z - b.oz) <= b.d / 2 + (pad || 0); }
  function wwShell() {
    const o = oval(); if (!o) return null;
    const d = o.landmarks.presidentialDesk;
    const sh = (CBZ.govShells ? CBZ.govShells() : []).filter((s) => s.b && Array.isArray(s.b.floorTops) && inRect(s.b, d.x, d.z, 0));
    sh.sort((a, b) => a.b.w * a.b.d - b.b.w * b.b.d);
    return sh[0] || null;
  }
  function estate() {
    const L = CBZ.govComplexes || [];
    for (const s of L) if (s && s.id === "execmansion" && s.rect) return s;
    return null;
  }
  function inScene(o) { let n = o; for (let i = 0; i < 64 && n; i++) { if (n === CBZ.scene) return true; n = n.parent; } return false; }
  function chain(o) { const out = []; let n = o; for (let i = 0; i < 5 && n; i++) { out.push((n.name || n.type || "?") + (n.visible === false ? "(hidden)" : "")); n = n.parent; } return out.join(" < "); }
  function doorOfCol(c) {
    if (!c) return null;
    const all = UD ? UD.all() : [];
    for (const d of all) if (d.col === c) return { kind: "unit", d };
    const st = CBZ.cityDoorsGet ? CBZ.cityDoorsGet() : [];
    for (const d of st) if (d.col === c) return { kind: "street", d };
    return null;
  }
  function colInfo(c) {
    if (c.virt) return { box: [r2(c.minX), r2(c.maxX), r2(c.minZ), r2(c.maxZ)], virt: true };
    const m = c.ref;
    const own = doorOfCol(c);
    let hex = null; try { hex = m && m.material && m.material.color ? "#" + m.material.color.getHexString() : null; } catch (e) {}
    return {
      box: [r2(c.minX), r2(c.maxX), r2(c.minZ), r2(c.maxZ)], band: c.y0 != null ? [r2(c.y0), r2(c.y1)] : "full",
      yaw: c.yaw || 0, door: !!c.door, city: !!c._city, glass: !!(c.glass || c.pane || c._glass),
      keys: Object.keys(c).filter((k) => !/^(min|max)[XZ]$|^y[01]$|^ref$|^_qSeen$/.test(k)).slice(0, 14),
      ref: m ? { name: m.name || m.type, chain: chain(m), visible: m.visible !== false, inScene: inScene(m), hex,
        geo: m.geometry ? m.geometry.type : null, ud: Object.keys(m.userData || {}).slice(0, 8) } : null,
      owner: own ? (own.kind + ":" + (own.d.label || own.d.id || "?") + (own.kind === "unit" ? (own.d.open ? " OPEN" : " shut") : "")) : null,
      inWorld: CBZ.colliders.indexOf(c) >= 0,
    };
  }
  const _q = [];
  function hitsAt(x, z, feet, r) {
    const out = [];
    for (const v of W.virt) if (Math.abs(v.y - feet) < 1.2 && Math.hypot(v.x - x, v.z - z) < v.r + r) out.push({ virt: true, minX: v.x, maxX: v.x, minZ: v.z, maxZ: v.z });
    const cityOn = CBZ.game.mode === "city";
    const L = CBZ.queryCollidersNear(x, z, r + 0.2, _q);
    for (const c of L) {
      if (c._city && !cityOn) continue;
      if (c.y0 != null && (feet + BODY_H <= c.y0 || feet + STEP_SOLID >= c.y1)) continue;
      let lx, lz, hw, hd;
      if (c.yaw) { const co = Math.cos(c.yaw), si = Math.sin(c.yaw), rx = x - c.cx, rz = z - c.cz; lx = rx * co - rz * si; lz = rx * si + rz * co; hw = c.hw; hd = c.hd; }
      else { hw = (c.maxX - c.minX) / 2; hd = (c.maxZ - c.minZ) / 2; lx = x - (c.minX + hw); lz = z - (c.minZ + hd); }
      const qx = Math.max(-hw, Math.min(hw, lx)), qz = Math.max(-hd, Math.min(hd, lz));
      if ((lx - qx) * (lx - qx) + (lz - qz) * (lz - qz) < r * r) out.push(c);
    }
    return out;
  }
  function ground(x, z, y) { return CBZ.walkGroundAt ? CBZ.walkGroundAt(x, z, y) : CBZ.groundAt(x, z, y); }
  function passableDoor(c) {
    const o = doorOfCol(c);
    if (!o) return null;
    if (o.kind === "street") return o;
    if (o.d.free || (UD.mayOpen && UD.mayOpen(o.d))) return o;
    return null;
  }

  /* ---- ROUTE: BFS over (i, j, height) on the game's colliders ----------- */
  function route(opts) {
    const cell = opts.cell, pad = R_BODY - 0.02;
    const x0 = opts.box.minX, z0 = opts.box.minZ;
    const nx = Math.ceil((opts.box.maxX - x0) / cell), nz = Math.ceil((opts.box.maxZ - z0) / cell);
    const seen = new Map(), prev = new Map(), q = [];
    const key = (i, j, y) => (i * nz + j) * 4096 + Math.round((y + 50) * 20);
    const si = Math.round((P.pos.x - x0) / cell), sj = Math.round((P.pos.z - z0) / cell);
    const sy = P.pos.y;
    const k0 = key(si, sj, sy);
    seen.set(k0, [si, sj, sy, null]); q.push(k0);
    let head = 0, goal = null, n = 0;
    while (head < q.length && n++ < 2.5e6) {
      const k = q[head++]; const [i, j, y] = seen.get(k);
      const x = x0 + i * cell, z = z0 + j * cell;
      if (opts.goal(x, z, y)) { goal = k; break; }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const xx = x0 + ii * cell, zz = z0 + jj * cell;
        const yy = ground(xx, zz, y);
        if (yy - y > STEP_UP + 1e-3 || y - yy > STEP_DOWN) continue;
        const kk = key(ii, jj, yy);
        if (seen.has(kk)) continue;
        const hs = hitsAt(xx, zz, yy, pad);
        let door = null, bad = false;
        for (const c of hs) { const o = passableDoor(c); if (o) door = door || o; else { bad = true; break; } }
        if (bad) continue;
        seen.set(kk, [ii, jj, yy, door]); prev.set(kk, k); q.push(kk);
      }
    }
    if (goal == null) {
      // how far did the flood get: the reached cell nearest the goal hint
      let bestD = Infinity, bestC = null;
      for (const v of seen.values()) { const x = x0 + v[0] * cell, z = z0 + v[1] * cell; const d = opts.hint ? Math.hypot(x - opts.hint.x, z - opts.hint.z) : 0; if (d < bestD) { bestD = d; bestC = { x: r2(x), z: r2(z), y: r2(v[2]) }; } }
      return { ok: false, cells: seen.size, nearest: bestC, nearestD: r2(bestD) };
    }
    const pts = [];
    for (let k = goal; k != null; k = prev.get(k)) { const v = seen.get(k); pts.push({ x: x0 + v[0] * cell, z: z0 + v[1] * cell, y: v[2], door: v[3] ? v[3].d : null, dk: v[3] ? v[3].kind : null }); }
    pts.reverse();
    return { ok: true, cells: seen.size, pts };
  }
  function doorsAlong(pts) {
    const out = [];
    for (const p of pts) if (p.door && out.indexOf(p.door) < 0) out.push(p.door);
    return out.map((d) => (d.label || d.id || "street door") + (d.floorY != null ? " y" + r2(d.floorY) : ""));
  }

  function plan(leg) {
    const sh = wwShell(), b = sh && sh.b;
    const est = estate();
    if (!b) return { ok: false, why: "no West Wing shell" };
    let r;
    if (leg === "ww") {
      const pad = 12;
      r = route({ cell: 0.125, box: { minX: b.ox - b.w / 2 - pad, maxX: b.ox + b.w / 2 + pad, minZ: b.oz - b.d / 2 - pad, maxZ: b.oz + b.d / 2 + pad },
        goal: (x, z, y) => !inRect(b, x, z, 3.0) && y < b.floorTops[0] + 0.8, hint: { x: b.ox + b.w / 2 + 4, z: b.oz } });
    } else {
      const R = est.rect, pad = 30;
      r = route({ cell: 0.5, box: { minX: R.minX - pad, maxX: R.maxX + pad, minZ: R.minZ - pad, maxZ: R.maxZ + pad },
        goal: (x, z) => x < R.minX - 4 || x > R.maxX + 4 || z < R.minZ - 4 || z > R.maxZ + 4, hint: { x: est.cx, z: R.maxZ + 10 } });
    }
    W.leg = leg;
    if (!r.ok) return { ok: false, leg, why: "no route", cells: r.cells, nearest: r.nearest, nearestD: r.nearestD };
    W.path = r.pts; W.pi = 0; W.best = 0; W.bestT = W.t;
    let len = 0; for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].z - r.pts[i - 1].z);
    return { ok: true, leg, cells: r.cells, nodes: r.pts.length, len: r2(len), doors: doorsAlong(r.pts), from: pos(), to: { x: r2(r.pts[r.pts.length - 1].x), z: r2(r.pts[r.pts.length - 1].z) } };
  }

  /* ---- DIAGNOSIS at a stop --------------------------------------------- */
  function diag(why) {
    const x = P.pos.x, z = P.pos.z, y = P.pos.y;
    const near = [];
    for (let r = 0.45; r <= 0.9 && !near.length; r += 0.15) for (const c of hitsAt(x, z, y, r)) near.push(colInfo(c));
    // what is in the next metre of the path
    const ahead = [];
    if (W.path) {
      for (let i = W.pi; i < Math.min(W.path.length, W.pi + 8); i++) {
        const p = W.path[i];
        for (const c of hitsAt(p.x, p.z, ground(p.x, p.z, y), R_BODY)) { const ci = colInfo(c); if (!ahead.some((a) => a.box.join() === ci.box.join())) ahead.push(ci); }
      }
    }
    const doors = (UD ? UD.all() : []).filter((d) => Math.hypot(d.x - x, d.z - z) < 3.5 && Math.abs(d.floorY - y) < 2)
      .map((d) => ({ label: d.label, open: !!d.open, colInWorld: CBZ.colliders.indexOf(d.col) >= 0, pendingShut: !!d.pendingShut, x: r2(d.x), z: r2(d.z), floorY: r2(d.floorY), free: !!d.free }));
    const peds = (CBZ.cityPeds || []).filter((p) => p && p.pos && !p.dead && Math.hypot(p.pos.x - x, p.pos.z - z) < 1.6 && Math.abs(p.pos.y - y) < 1.5)
      .map((p) => ({ name: p.name || p.kind || "?", d: r2(Math.hypot(p.pos.x - x, p.pos.z - z)), state: p.state }));
    const I = CBZ.interactions && CBZ.interactions.current ? CBZ.interactions.current() : null;
    // the grid answer vs a brute-force scan of CBZ.colliders (a stale grid
    // would disagree with the list the door kit edits)
    const brute = [];
    for (const c of CBZ.colliders) {
      if (c.y0 != null && (y + BODY_H <= c.y0 || y + STEP_SOLID >= c.y1)) continue;
      const qx = Math.max(c.minX, Math.min(x, c.maxX)), qz = Math.max(c.minZ, Math.min(z, c.maxZ));
      if (Math.hypot(qx - x, qz - z) < R_BODY + 0.1) brute.push(colInfo(c));
    }
    // who has hands on him (systems/verbs.js sessions)
    const holds = [];
    const VS = CBZ.verbs && CBZ.verbs.sessions;
    if (VS) for (const S of VS) if (S && !S.done && S.T && S.T.isPlayer) holds.push({ verb: S.def && S.def.name || S.verb || S.kind || "?", phase: S.phase, by: S.a && (S.a.name || S.a.kind) || "?", tFree: !!S.tFree });
    const R = P._pz;
    const hist = W.hist.slice(-60);
    let moved = 0; for (let i = 1; i < hist.length; i++) moved += Math.hypot(hist[i].x - hist[i - 1].x, hist[i].z - hist[i - 1].z);
    const others = [];
    for (const L of [CBZ.npcs, CBZ.guards, CBZ.cityCops]) if (Array.isArray(L)) for (const p of L) if (p && p.pos && !p.dead && Math.hypot(p.pos.x - x, p.pos.z - z) < 1.6) others.push(p.name || p.kind || "?");
    return {
      motion: { last60moved: r2(moved), speed: r2(P.speed || 0), moveX: r2(P.moveX || 0), moveZ: r2(P.moveZ || 0),
        yawSet: hist.length ? r2(hist[hist.length - 1].ys) : null, yawNow: r2(CBZ.cam.yaw), stun: r2(P.stun || 0), ko: P.ko || 0,
        seq: R && R.seq ? (R.seq.kind + ":" + (R.seq.names || []).join(",") + "@" + R.seq.i) : null, posture: R ? R.state : null,
        phys: P._phys ? { air: !!P._phys.air, down: r2(P._phys.down || 0) } : null, traversal: !!P._traversal, doorArc: !!P._doorArc,
        crouch: !!P.crouch, prone: !!P.prone, moveScale: P._moveScale != null ? r2(P._moveScale) : 1,
        vitals: CBZ.vitals && CBZ.vitals.speedMul ? r2(CBZ.vitals.speedMul(P)) : null, climbing: !!(CBZ.climb && CBZ.climb.active && CBZ.climb.active()) },
      brute: brute.slice(0, 6), holds, otherBodies: others,
      why, at: pos(), leg: W.leg, pathIndex: W.pi + "/" + (W.path ? W.path.length : 0),
      next: W.path && W.path[W.pi] ? { x: r2(W.path[W.pi].x), z: r2(W.path[W.pi].z), y: r2(W.path[W.pi].y) } : null,
      ground: r2(ground(x, z, y)), grounded: !!P.grounded, seat: !!P._propSeat, driving: !!P.driving,
      locks: { cine: !!(CBZ.cineActive && CBZ.cineActive()), menu: !!CBZ.cityMenuOpen, held: !!(CBZ.verbs && CBZ.verbs.playerHeld && CBZ.verbs.playerHeld()),
        stun: P.stun || 0, arrested: !!P._cityArrested, map: !!(CBZ.fullMap && CBZ.fullMap.active), overview: !!(CBZ.simView && CBZ.simView.active), state: CBZ.game.state },
      touching: near, ahead: ahead.slice(0, 6), doors, peds, card: I ? { kind: I.kind, proposal: I.proposal } : null,
      spawn: CBZ.presidentOffice && CBZ.presidentOffice.audit ? CBZ.presidentOffice.audit().spawnPending : null,
    };
  }

  /* ---- WHO MOVES THE BODY: every updater wrapped for n ticks, the XZ it
     moved the player by summed per updater (the one that undoes the walk is
     the blocker when no collider is touching) ----------------------------- */
  function attrib(n) {
    const U = CBZ.updaters, keep = [], acc = new Map();
    for (const u of U) {
      const f = u.fn; keep.push([u, f]);
      u.fn = function (dt) {
        const x = P.pos.x, z = P.pos.z;
        const r = f.apply(this, arguments);
        const dx = P.pos.x - x, dz = P.pos.z - z;
        if (dx || dz) { const k = (u.order + " " + (u.source || "?")).slice(0, 90); const a = acc.get(k) || { along: 0, abs: 0, n: 0 }; const fx = -Math.sin(CBZ.cam.yaw), fz = -Math.cos(CBZ.cam.yaw); a.along += dx * fx + dz * fz; a.abs += Math.hypot(dx, dz); a.n++; acc.set(k, a); }
        return r;
      };
    }
    try { CBZ.keys.w = true; steps(n); } finally { for (const [u, f] of keep) u.fn = f; CBZ.keys.w = false; }
    return [...acc.entries()].map(([k, v]) => ({ who: k, along: r2(v.along), abs: r2(v.abs), n: v.n })).sort((a, b) => b.abs - a.abs).slice(0, 8);
  }

  /* ---- OPEN A DOOR THE WAY A PLAYER DOES ------------------------------- */
  function faceTo(x, z) { const dx = x - P.pos.x, dz = z - P.pos.z; CBZ.cam.yaw = Math.atan2(-dx, -dz); }
  function key(k, up) { const e = new KeyboardEvent(up ? "keyup" : "keydown", { key: k, code: "Key" + k.toUpperCase(), bubbles: true, cancelable: true }); document.body.dispatchEvent(e); }
  function steps(n) {
    for (let i = 0; i < n; i++) {
      const ys = CBZ.cam.yaw;
      W.t += 1 / 60; CBZ.stepSim(1 / 60); watchJump();
      W.hist.push({ x: P.pos.x, z: P.pos.z, ys }); if (W.hist.length > 120) W.hist.shift();
    }
  }
  function watchJump() {
    const p = P.pos;
    if (W.lastPos && Math.hypot(p.x - W.lastPos.x, p.z - W.lastPos.z) + Math.abs(p.y - W.lastPos.y) > 1.5)
      W.events.push({ t: r2(W.t), ev: "JUMP", from: W.lastPos, to: pos(), spawnPending: CBZ.presidentOffice ? CBZ.presidentOffice.audit().spawnPending : null, seat: !!P._propSeat });
    W.lastPos = pos();
  }
  function screenOf(x, y, z) {
    const v = new THREE.Vector3(x, y, z); CBZ.camera.updateMatrixWorld(); v.project(CBZ.camera);
    return { sx: (v.x * 0.5 + 0.5) * innerWidth, sy: (-v.y * 0.5 + 0.5) * innerHeight, front: v.z < 1 };
  }
  // how: "e" | "tap"
  function openDoor(d, how) {
    const rec = { door: d.label, how, before: !!d.open };
    CBZ.keys.w = false;
    if (d.open) { rec.already = true; return rec; }
    faceTo(d.x, d.z);
    steps(12);                                   // the prompt pass runs at 12 Hz
    const I = CBZ.interactions;
    const cur = I.current();
    rec.card = cur ? { kind: cur.kind, isThis: cur.target === d, proposal: cur.proposal } : null;
    rec.rows = I.rowsFor ? I.rowsFor() : null;
    if (how === "tap") {
      if (!CBZ.cityTapWorld) { rec.err = "no touch layer (CBZ.cityTapWorld)"; }
      else {
        const s = screenOf(d.x, d.floorY + 1.2, d.z);
        rec.screen = { x: Math.round(s.sx), y: Math.round(s.sy), front: s.front };
        let pk = null; try { pk = I.tapPick(s.sx, s.sy, {}); } catch (e) { rec.pickErr = String(e); }
        rec.tapPick = pk ? { kind: pk.cand.kind, isThis: pk.cand.t === d, live: pk.live, dist: r2(pk.dist) } : null;
        try { rec.tapped = CBZ.cityTapWorld(s.sx, s.sy); } catch (e) { rec.tapErr = String(e); }
        steps(90);                                // a tap out of reach walks there first
        if (CBZ.verbWheel && CBZ.verbWheel.isOpen && CBZ.verbWheel.isOpen()) { rec.wheelOpen = true; }
      }
    } else {
      key("e"); steps(2); key("e", true); steps(4);
    }
    rec.after = !!d.open;
    rec.colGone = CBZ.colliders.indexOf(d.col) < 0;
    if (!d.open) {
      rec.FAIL = true;
      rec.diag = diag("door did not open by " + how);
      UD.setOpen(d, true);                        // forced, flagged: find the next blocker too
      W.forced.push("door " + d.label + " (" + how + ")");
    }
    W.events.push(Object.assign({ t: r2(W.t), ev: "door" }, rec));
    return rec;
  }

  /* ---- WALK the planned path with the game's own movement --------------- */
  function walk(maxSteps, doorHow) {
    const out = { steps: 0 };
    const path = W.path;
    for (let s = 0; s < maxSteps; s++) {
      // nearest path index ahead (never back)
      let bi = W.pi, bd = Infinity;
      for (let i = W.pi; i < Math.min(path.length, W.pi + 24); i++) {
        const d = Math.hypot(path[i].x - P.pos.x, path[i].z - P.pos.z) + Math.abs(path[i].y - P.pos.y) * 2;
        if (d < bd) { bd = d; bi = i; }
      }
      W.pi = bi;
      if (bi >= path.length - 2) { CBZ.keys.w = false; out.done = true; break; }
      if (bi > W.best) { W.best = bi; W.bestT = W.t; }
      // a shut door within ~1.4 m ahead: stop and open it like a player
      for (let i = bi; i < Math.min(path.length, bi + 6); i++) {
        const d = path[i].door;
        if (d && d.col && d.floorY != null && CBZ.colliders.indexOf(d.col) >= 0 && !d.open) {
          out.door = openDoor(d, typeof doorHow === "function" ? doorHow(d) : doorHow);
          break;
        }
      }
      // steer at a point ~1 m down the path
      let li = bi; while (li < path.length - 1 && Math.hypot(path[li].x - P.pos.x, path[li].z - P.pos.z) < 0.6) li++;
      faceTo(path[li].x, path[li].z);
      CBZ.keys.w = true;
      steps(1);
      out.steps++;
      // (progress along the path can stall while the body is really moving
      // round a bend: only a body that has not moved counts as stopped)
      const recent = W.hist.slice(-60);
      let movedRecent = 0; for (let i = 1; i < recent.length; i++) movedRecent += Math.hypot(recent[i].x - recent[i - 1].x, recent[i].z - recent[i - 1].z);
      if (W.t - W.bestT > 1.5 && movedRecent > 0.5) { W.bestT = W.t; }
      if (W.t - W.bestT > 1.5 && W.replans < 8) {
        // STOPPED BY SOMETHING THE ROUTE DID NOT SEE (no collider there: a
        // body, a piece the physics treats as solid some other way). A player
        // steps round it: mark the spot ahead as blocked and route again.
        // Logged, with who moved the body, so the cause is on the record.
        const x0 = P.pos.x, z0 = P.pos.z;
        const blockDiag = diag("stopped with nothing in CBZ.colliders ahead");
        blockDiag.movers = attrib(12);
        CBZ.keys.w = false;
        // he walks fine when asked (a bend the index did not follow): not a block
        if (Math.hypot(P.pos.x - x0, P.pos.z - z0) > 0.2) { W.bestT = W.t; continue; }
        const fx = -Math.sin(CBZ.cam.yaw), fz = -Math.cos(CBZ.cam.yaw);
        W.virt.push({ x: P.pos.x + fx * 0.55, z: P.pos.z + fz * 0.55, y: P.pos.y, r: 0.3 });
        W.replans++;
        W.events.push({ t: r2(W.t), ev: "DETOUR", diag: blockDiag });
        const again = plan(W.leg);
        out.detour = { at: blockDiag.at, movers: blockDiag.movers, touching: blockDiag.touching.length, peds: blockDiag.peds, replanned: again.ok };
        if (!again.ok) { W.replans = 99; W.path = path; W.bestT = W.t - 2.4; }   // no way round: the stuck rule below reports it
        break;
      }
      if (W.t - W.bestT > 2.5) {                  // out of detours: stuck
        out.stuck = diag("no progress for 2.5 s");
        out.stuck.movers = attrib(20);
        CBZ.keys.w = false;
        W.events.push({ t: r2(W.t), ev: "STUCK", diag: out.stuck });
        // force past: the next path node 1.5 m on, flagged
        let fi = bi; while (fi < path.length - 1 && Math.hypot(path[fi].x - P.pos.x, path[fi].z - P.pos.z) < 1.5) fi++;
        const p = path[fi];
        P.pos.set(p.x, p.y + 0.02, p.z); W.lastPos = pos(); W.bestT = W.t; W.best = fi; W.pi = fi;
        W.forced.push("stuck at " + JSON.stringify(out.stuck.at));
        break;
      }
      if (out.door) break;
    }
    CBZ.keys.w = false;
    out.at = pos(); out.pi = W.pi + "/" + path.length;
    return out;
  }

  function standUp(how) {
    // (the phone's pill was pressed by the harness before this call: a
    // seat already left shows up as seatedBefore false + wasSeated)
    const rec = { how, seatedBefore: !!P._propSeat, wasSeated: W.seatedAtSpawn, state: CBZ.seatState ? (CBZ.seatState() || {}).verb : null };
    if (!P._propSeat) { steps(30); rec.at = pos(); W.events.push(Object.assign({ t: r2(W.t), ev: "stand" }, rec)); return rec; }
    if (how === "f") { key("f"); steps(2); key("f", true); }
    steps(60);
    rec.seatedAfter = !!P._propSeat;
    if (P._propSeat) { rec.FAIL = true; if (CBZ.seatExit) CBZ.seatExit(); steps(60); W.forced.push("seat exit (" + how + ")"); }
    rec.at = pos();
    W.events.push(Object.assign({ t: r2(W.t), ev: "stand" }, rec));
    return rec;
  }

  function status() {
    const o = oval(), sh = wwShell(), est = estate();
    const dp = CBZ.presidentOffice && CBZ.presidentOffice.deskPoint ? CBZ.presidentOffice.deskPoint() : null;
    const b = sh && sh.b;
    return {
      mode: CBZ.game.mode, state: CBZ.game.state, pos: pos(), seat: !!P._propSeat,
      desk: dp ? { x: r2(dp.x), y: r2(dp.y), z: r2(dp.z) } : null, atDesk: dp ? Math.hypot(P.pos.x - dp.x, P.pos.z - dp.z) < 1.7 && Math.abs(P.pos.y - dp.y) < 1.2 : false,
      oval: !!o, ww: b ? { ox: r2(b.ox), oz: r2(b.oz), w: b.w, d: b.d, floorTops: b.floorTops.map(r2) } : null,
      estate: est ? { cx: r2(est.cx), cz: r2(est.cz), rect: est.rect } : null,
      stream: !!(CBZ.CONFIG && CBZ.CONFIG.CITY_STREAM), device: CBZ.deviceClass || null, touch: !!CBZ.touchMode,
      unitDoors: UD ? UD.count() : 0, colliders: CBZ.colliders.length,
      audit: CBZ.presidentOffice && CBZ.presidentOffice.audit ? (function (a) { return { built: a.built, inOffice: a.inOffice, spawnPending: a.spawnPending }; })(CBZ.presidentOffice.audit()) : null,
    };
  }
  function outside(leg) {
    const sh = wwShell(), b = sh && sh.b, est = estate();
    if (leg === "ww") return !!b && !inRect(b, P.pos.x, P.pos.z, 2.0) && P.pos.y < b.floorTops[0] + 0.8;
    const R = est.rect; return P.pos.x < R.minX - 2 || P.pos.x > R.maxX + 2 || P.pos.z < R.minZ - 2 || P.pos.z > R.maxZ + 2;
  }
  window.__PW = { W, status, plan, walk, standUp, diag, outside, steps, pos, openDoor };
  return true;
}

/* ======================================================================
   ONE PROFILE
   ====================================================================== */
async function runProfile(profile) {
  const T0 = Date.now();
  const el = () => ((Date.now() - T0) / 1000).toFixed(0) + "s";
  const res = { profile, fails: [], legs: {}, events: [], detours: [] };
  const rig = await launch({ rafBudget: 1e9, quiet: true });
  const say = (s) => console.log(`  [${profile} ${el()}] ${s}`);
  // every page call is bounded: a browser that dies mid-run (SwiftShader OOM,
  // another session's pkill) must end the run with a reason, not leave node
  // waiting on a socket that will never answer
  const evl = (e, ms = 300000) => { let t; return Promise.race([rig.evl(e), new Promise((_, rej) => { t = setTimeout(() => rej(new Error("page did not answer in " + ms / 1000 + " s (browser gone?)")), ms); })]).finally(() => clearTimeout(t)); };
  const wait = async (expr, ms, every) => { const until = Date.now() + ms; while (Date.now() < until) { try { if (await evl(`(()=>{try{return !!(${expr})}catch(e){return false}})()`, 120000)) return true; } catch (e) { if (/did not answer/.test(e.message)) throw e; } await sleep(every || 500); } return false; };
  try {
    if (profile === "phone") {
      await rig.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
      await rig.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await rig.send("Emulation.setUserAgentOverride", { userAgent: PHONE_UA, platform: "iPhone", acceptLanguage: "en-US" });
      await rig.send("Page.addScriptToEvaluateOnNewDocument", { source: fs.readFileSync(path.join(ROOT, "tools/preload/ipad.js"), "utf8") });
    } else {
      await rig.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    }
    await rig.open("index.html", `seed=${SEED}`);
    if (!(await wait("window.CBZ && CBZ.bootComplete && CBZ.setCityOrigin", 300000, 500))) throw new Error("never booted");
    say("booted; picking The President");
    const go = await evl(`(function(){
      var b = document.querySelector('.origin-btn[data-origin="president"]'); if (!b) return "no president button";
      b.click();
      var p = document.getElementById("playBtn"); if (!p) return "no play button";
      p.click(); return "ok";
    })()`);
    if (go !== "ok") throw new Error("could not start: " + go);
    if (!(await wait("CBZ.city && CBZ.city.arena && CBZ.game.state === 'playing' && CBZ.game.mode === 'city'", 900000, 1000))) throw new Error("the city never started");
    say("city up; waiting for the chair");
    await evl(`(${pageLib.toString()})()`);
    let st = null;
    for (let i = 0; i < 300; i++) {
      st = await evl("__PW.status()");
      if (st && st.atDesk && st.seat) break;
      await sleep(1000);
    }
    res.spawn = st;
    say("spawn: " + JSON.stringify({ pos: st.pos, seat: st.seat, atDesk: st.atDesk, stream: st.stream, device: st.device, touch: st.touch, spawnPending: st.audit && st.audit.spawnPending }));
    if (!st.atDesk) res.fails.push("the President never sat down at the desk (" + JSON.stringify(st.pos) + ")");
    // from here the sim is ours: rAF off, CBZ.stepSim ticks
    await evl("window.__stopRaf && __stopRaf(); __PW.W.seatedAtSpawn = !!CBZ.player._propSeat; true");
    await sleep(300);
    // the phone's way up is the #tExit pill: a real touch on it
    let pill = null;
    if (profile === "phone") {
      pill = await evl(`(function(){ var e = document.getElementById("tExit"); if (!e) return null;
        var r = e.getBoundingClientRect(); var cs = getComputedStyle(e);
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, shown: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 }; })()`);
      if (pill && pill.shown) {
        const tp = [{ x: pill.x, y: pill.y, id: 1 }];
        await rig.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp });
        await evl("__PW.steps(3); true");
        await rig.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
    }
    const stand = await evl(`__PW.standUp(${JSON.stringify(profile === "phone" ? "pill" : "f")})`);
    stand.pill = pill;
    say("stand: " + JSON.stringify(stand));
    if (stand.FAIL) res.fails.push("could not stand up from the chair by " + stand.how);

    for (const leg of ["ww", "street"]) {
      const pl = await evl(`(__PW.W.replans = 0, __PW.plan(${JSON.stringify(leg)}))`);
      res.legs[leg] = { plan: pl };
      say(`route ${leg}: ` + JSON.stringify(pl));
      if (!pl.ok) { res.fails.push(`no route for leg ${leg} (${pl.why}; flood ${pl.cells} cells, nearest ${JSON.stringify(pl.nearest)} ${pl.nearestD} m from the goal)`); break; }
      let first = true, guard = 0, done = false;
      while (guard++ < 400) {
        const how = profile === "phone" ? "tap" : "e";
        const r = await evl(`__PW.walk(240, ${JSON.stringify(how)})`);
        if (r.door) say(`door ${r.door.door}: ${r.door.how} -> ${r.door.after ? "open" : "SHUT"}` + (r.door.FAIL ? " " + JSON.stringify(r.door) : ""));
        if (r.door && r.door.FAIL) res.fails.push(`${leg}: ${r.door.door} did not open by ${r.door.how}: ` + JSON.stringify({ card: r.door.card, tapPick: r.door.tapPick, rows: r.door.rows }));
        if (r.detour) { say("detour (blocked with no collider ahead) " + JSON.stringify(r.detour)); res.detours.push(Object.assign({ leg }, r.detour)); }
        if (r.stuck) { say("STUCK " + JSON.stringify(r.stuck)); res.fails.push(`${leg}: stuck at ${JSON.stringify(r.stuck.at)}: ` + JSON.stringify({ touching: r.stuck.touching.concat(r.stuck.ahead).slice(0, 4), movers: r.stuck.movers, brute: r.stuck.brute, motion: r.stuck.motion, holds: r.stuck.holds, peds: r.stuck.peds, others: r.stuck.otherBodies })); }
        if (r.done) { done = true; break; }
        if (first) first = false;
      }
      const out = await evl(`__PW.outside(${JSON.stringify(leg)})`);
      res.legs[leg].out = out; res.legs[leg].done = done;
      say(`leg ${leg}: ${out ? "OUT" : "NOT OUT"} at ` + JSON.stringify(await evl("__PW.pos()")));
      if (!out) res.fails.push(`leg ${leg}: the President is not out (${JSON.stringify(await evl("__PW.diag('end of leg')"))})`);
    }
    const W = await evl("({ events: __PW.W.events, forced: __PW.W.forced, t: __PW.W.t })");
    res.events = W.events; res.forced = W.forced;
    for (const e of W.events) if (e.ev === "JUMP") { say("JUMP " + JSON.stringify(e)); res.fails.push("teleported mid-walk: " + JSON.stringify(e)); }
    res.errors = rig.errors.slice(0, 12);
  } catch (e) {
    res.fails.push("harness: " + e.message);
    try { res.diag = await evl("window.__PW ? __PW.diag('harness error') : null"); } catch (_) {}
  } finally {
    await rig.close();
  }
  return res;
}

const all = [];
for (const p of PROFILES) {
  console.log(`PRESIDENT WALKOUT — ${p}`);
  all.push(await runProfile(p));
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(all, null, 1));
let bad = 0;
for (const r of all) {
  if (r.fails.length) { bad++; console.log(`WALKOUT ${r.profile}: FAIL`); for (const f of r.fails) console.log("  - " + String(f).slice(0, 1600)); }
  else console.log(`WALKOUT ${r.profile}: ok (out of the West Wing and past the estate wall on foot)`);
  if (r.detours && r.detours.length) console.log(`  (${r.detours.length} detours round things the colliders do not hold: ` + r.detours.map((d) => d.leg + "@" + d.at.x + "," + d.at.z + " moved-by " + (d.movers[0] ? d.movers[0].who : "?")).join("; ") + ")");
}
process.exit(bad ? 1 : 0);
