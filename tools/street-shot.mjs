#!/usr/bin/env node
/* tools/street-shot.mjs — boot, play, then film the live street in third
   person: override the camera each frame (render-wrap trick), aim at a road
   with traffic + peds, screenshot. Integration eyeball for rigs + cars. */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || path.join(ROOT, "tools/shots/street.png");
const BUILDING_FOCUS = process.argv.includes("--building");
const SPAWN_FOCUS = process.argv.includes("--spawn");
const AERIAL_FOCUS = process.argv.includes("--aerial");
const MOUNTAIN_FOCUS = process.argv.includes("--mountain");
const WEAPON_FOCUS = process.argv.includes("--weapon");
const MAP_FOCUS = process.argv.includes("--map");
const DEFAULT_START = process.argv.includes("--default-start");
const SWIM_FOCUS = process.argv.includes("--swim");
const AIRCRAFT_RISK = process.argv.includes("--aircraft-risk");
const WATERFRONT_FOCUS = process.argv.includes("--waterfront");
const WILDLIFE_FOCUS = process.argv.includes("--wildlife");
const AIRLINER_FOCUS = process.argv.includes("--airliner");
const DESERT_FOCUS = process.argv.includes("--desert");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8930 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9930 + Math.floor(Math.random() * 40);
await rm(`/tmp/cbz-street-${dbg}`, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(process.env.CBZ_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium"), ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio", "--window-size=1600,1000", `--remote-debugging-port=${dbg}`, `--user-data-dir=/tmp/cbz-street-${dbg}`, base], { stdio: "ignore" });
let page = null;
for (let i = 0; i < 80 && !page; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {} if (!page) await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");
for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
// Most visual modes explicitly request the sandbox.  --default-start leaves
// configuration untouched so it proves what a player gets from a clean load.
if (!DEFAULT_START) {
  await evl("(() => { if (window.CBZ && CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()");
}
let playing = false;
for (let i = 0; i < 120 && !playing; i++) { await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()"); await sleep(600); playing = await evl("!!(CBZ.game && CBZ.game.state === 'playing')"); }
await sleep(6000);   // let traffic/peds populate
// camera override: hover a busy sidewalk, looking down-street
const info = await evl(`(() => {
  if (!CBZ.renderer.__streetPatch) {
    const orig = CBZ.renderer.render.bind(CBZ.renderer);
    CBZ.renderer.render = function (s, cam) {
      const t = window.__cam;
      if (t && cam && cam.position) {
        cam.position.set(t[0], t[1], t[2]);
        cam.lookAt(t[3], t[4], t[5]);
        cam.updateMatrixWorld();
        // sky.js normally follows the camera earlier in the frame.  Because
        // this audit camera moves only at render time, keep the sky rig with
        // it here too or the proof camera can end up outside the dome.
        const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
        if (skyRig && skyRig.position) {
          skyRig.position.copy(cam.position);
          skyRig.updateMatrixWorld();
        }
      }
      return orig(s, cam);
    };
    CBZ.renderer.__streetPatch = true;
  }
  if (${DEFAULT_START ? "true" : "false"}) {
    const A = CBZ.city && CBZ.city.arena;
    const pt = (p) => p ? [+(p.x || 0).toFixed(2), +(p.y || 0).toFixed(2), +(p.z || 0).toFixed(2)] : null;
    return {
      view: "default-start",
      state: CBZ.game && CBZ.game.state,
      mode: CBZ.game && CBZ.game.mode,
      campaign: !!(CBZ.cityCampaignActive && CBZ.cityCampaignActive()),
      player: pt(CBZ.player && CBZ.player.pos),
      airportSpawn: pt(A && A.airportSpawn),
      respawn: CBZ.game && CBZ.game.citySpawnPoint,
    };
  }
  if (${AIRCRAFT_RISK ? "true" : "false"}) {
    const risk = CBZ.aircraftTouchdownRisk;
    return {
      view: "aircraft-risk",
      safe: risk && risk(3.5, 0.05),
      firm: risk && risk(10, -0.42),
      hard: risk && risk(17, -0.72),
      catastrophic: risk && risk(24, -1.05),
    };
  }
  if (${AIRLINER_FOCUS ? "true" : "false"}) {
    if (CBZ.setFPS) CBZ.setFPS(false);
    const cabins = CBZ.aircraftPassengerCabins || [];
    const cab = cabins.find((c) => c && c.active && c.group && c.rec && c.rec.group);
    if (!cab) return { view: "airliner", error: "no active passenger cabin" };
    const rec = cab.rec, g = rec.group;
    g.updateMatrixWorld(true);
    const local = new THREE.Vector3(6.5, (cab.floorTop || 2.5) + 1.25, 0);
    const target = local.clone().applyMatrix4(g.matrixWorld);
    // Look down the aisle from inside the pressure shell; an exterior camera
    // only proves that the fuselage is opaque, not that the seats hold actors.
    const side = new THREE.Vector3(-10.6, (cab.floorTop || 2.5) + 1.45, 0).applyMatrix4(g.matrixWorld);
    window.__cam = [side.x, side.y, side.z, target.x, target.y, target.z];
    if (CBZ.player && CBZ.player.pos) {
      CBZ.player.pos.set(target.x, Math.max(0, target.y - 1.2), target.z);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
    }
    const seats = cab.passengerSeats || cab.seats || [];
    const occupants = seats.map((s) => s && s.occupant).filter(Boolean);
    return {
      view: "airliner", cabin: cab.id, seats: seats.length,
      occupants: occupants.length,
      realActors: occupants.filter((a) => (CBZ.cityPeds || []).indexOf(a) >= 0 && a.group && a.char).length,
      attached: occupants.filter((a) => a._npcAttached && a.group.parent === g).length,
    };
  }
  if (${SWIM_FOCUS ? "true" : "false"}) {
    if (CBZ.setFPS) CBZ.setFPS(false);
    const A = CBZ.city && CBZ.city.arena, P = CBZ.player;
    const sea = CBZ.SEA_Y == null ? -0.48 : CBZ.SEA_Y;
    let x = A.maxX + 42, z = (A.minZ + A.maxZ) * 0.5;
    // The city has bridges and authored islands. Find actual open water using
    // the gameplay oracle instead of assuming an arbitrary screenshot point.
    for (let dz = -180; dz <= 180; dz += 20) {
      if (CBZ.cityWaterAt && CBZ.cityWaterAt(x, z + dz)) { z += dz; break; }
    }
    P.pos.set(x, sea - 0.3, z); P.vy = 0; P.driving = null;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    window.__cam = [x + 5.2, sea + 3.1, z - 6.4, x, sea + 0.15, z + 0.8];
    return { view: "swim", target: [x, sea, z], water: !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)) };
  }
  if (${WILDLIFE_FOCUS ? "true" : "false"}) {
    if (CBZ.setFPS) CBZ.setFPS(false);
    const list = (CBZ.cityWildlife || []).filter((a) => a && !a.dead && a.group && !a.species.aquatic &&
      (a.species.danger || 0) < 0.35);
    const a = list[0];
    if (!a) return { view: "wildlife", error: "no live land wildlife" };
    a.group.visible = true; a.state = "wander"; a.stateT = 3; a.turnT = 3;
    a.alarm = 0; a.heading = a.faceH == null ? a.heading : a.faceH;
    a.spd = Math.max(a.spd || 0, (a.species.spd || 1.4) * 0.7);
    const x = a.group.position.x, y = a.group.position.y, z = a.group.position.z;
    if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(x + 28, CBZ.floorAt ? CBZ.floorAt(x + 28, z + 6) : 0, z + 6);
    window.__wildlifeAudit = { actor: a, x, z };
    window.__cam = [x + 7.5, y + 3.1, z - 8.5, x, y + 1.0, z];
    return { view: "wildlife", species: a.species.id || a.species.name, start: [x, y, z], heading: a.heading };
  }
  if (${WATERFRONT_FOCUS ? "true" : "false"}) {
    if (CBZ.setFPS) CBZ.setFPS(false);
    const A = CBZ.city && CBZ.city.arena;
    const lots = (A && A.lots || []).filter((l) => l && l.building && l.building.group);
    let pick = null, water = null, best = Infinity;
    for (const lot of lots) {
      const radius = Math.max(lot.building.w || 10, lot.building.d || 10) * 0.55;
      for (let i = 0; i < 24; i++) {
        const ang = i * Math.PI * 2 / 24;
        for (let d = radius + 8; d <= radius + 56; d += 8) {
          const x = lot.cx + Math.cos(ang) * d, z = lot.cz + Math.sin(ang) * d;
          if (!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z))) continue;
          if (d < best) { best = d; pick = lot; water = { x, z }; }
          break;
        }
      }
    }
    if (!pick || !water) return { view: "waterfront", error: "no waterfront lot" };
    const b = pick.building, sea = CBZ.SEA_Y == null ? -0.48 : CBZ.SEA_Y;
    window.__cam = [water.x, Math.max(8, sea + (b.h || 10) * 0.48), water.z,
      pick.cx, Math.min((b.h || 10) * 0.45, 14), pick.cz];
    if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(pick.cx, CBZ.floorAt ? CBZ.floorAt(pick.cx, pick.cz) : 0, pick.cz);
    const hw = (b.w || 8) * 0.5, hd = (b.d || 8) * 0.5;
    const footprint = [[-hw,-hd],[hw,-hd],[-hw,hd],[hw,hd],[0,0]].map((q) => ({
      x: +(pick.cx + q[0]).toFixed(1), z: +(pick.cz + q[1]).toFixed(1),
      water: !!(CBZ.cityWaterAt && CBZ.cityWaterAt(pick.cx + q[0], pick.cz + q[1])),
    }));
    const wetActors = (CBZ.cityPeds || []).filter((p) => p && !p.dead && p.group && !p._parked &&
      CBZ.cityWaterAt && CBZ.cityWaterAt(p.pos.x, p.pos.z)).length;
    return { view: "waterfront", building: b.name || pick.kind, at: [pick.cx, pick.cz], waterAt: [water.x, water.z], footprint, wetActors };
  }
  if (${SPAWN_FOCUS ? "true" : "false"}) {
    const A = CBZ.city && CBZ.city.arena;
    const pt = (p) => p ? [+(p.x || 0).toFixed(2), +(p.y || 0).toFixed(2), +(p.z || 0).toFixed(2)] : null;
    return { mode: CBZ.game.mode, player: pt(CBZ.player && CBZ.player.pos),
      arenaSpawn: pt(A && A.spawn), airportSpawn: pt(A && A.airportSpawn),
      respawn: pt(CBZ.game && CBZ.game.citySpawnPoint) };
  }
  if (${MAP_FOCUS ? "true" : "false"}) {
    const fm = CBZ.fullMap;
    if (fm && fm.open) fm.open();
    if (fm && fm.boundsFor && fm.view) {
      const b = fm.boundsFor("city");
      fm.view.z = 1;
      fm.view.ox = (b.minX + b.maxX) * 0.5;
      fm.view.oz = (b.minZ + b.maxZ) * 0.5;
      fm.view.fitted = true;
      if (fm.draw) fm.draw();
    }
    return {
      view: "map",
      active: !!(fm && fm.active),
      terrain: !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.mapTerrain),
      zoom: fm && fm.view && fm.view.z,
      bounds: fm && fm.boundsFor ? fm.boundsFor("city") : null,
    };
  }
  if (${DESERT_FOCUS ? "true" : "false"}) {
    if (CBZ.setFPS) CBZ.setFPS(false);
    if (CBZ.dayPhase) CBZ.dayPhase(0.45); // late-day contrast, like the reported scene
    // Wide southeast overlook: mine + west mesa at left, Dry Gulch/highway in
    // the centre, motel/gas strip at right, distant mesas framing the basin.
    window.__cam = [1450, 58, 315, 1125, 4, 105];
    if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(1150, CBZ.floorAt ? CBZ.floorAt(1150, 110) : 0, 110);
    const surface = CBZ.scene.getObjectByName("saltlands-desert-surface");
    const anchors = (CBZ.cityWorkAnchors || []).filter((a) => a && a.biome === "desert");
    const H = (x, z) => CBZ.floorAt ? +(CBZ.floorAt(x, z) || 0).toFixed(2) : 0;
    return {
      view: "desert", surface: !!surface,
      anchors: anchors.map((a) => ({ kind: a.kind, role: a.role, x: a.x, z: a.z })),
      landmarks: {
        town: [1150, 110], gas: [948, 132], motel: [1328, 136], mine: [890, 210],
        mesaWest: [900, 0], mesaSouth: [1160, 550],
      },
      floors: { town: H(1150, 110), gas: H(948, 132), motel: H(1328, 136), mine: H(890, 210) },
    };
  }
  if (${AERIAL_FOCUS ? "true" : "false"} || ${MOUNTAIN_FOCUS ? "true" : "false"}) {
    const mountain = ${MOUNTAIN_FOCUS ? "true" : "false"};
    if (CBZ.setFPS) CBZ.setFPS(false);
    if (mountain && CBZ.dayPhase) CBZ.dayPhase(0.36);
    CBZ.camera.near = 0.5;
    CBZ.camera.updateProjectionMatrix();
    // Stay inside the camera-following 850u sky dome.  The previous proof
    // camera sat at y=560, outside the live flight envelope, and photographed
    // the back of the dome instead of the world it was meant to audit.
    window.__cam = mountain
      // Oblique southeast view shows the pad's near and side slopes together;
      // a head-on centre view collapsed its 315u depth into a thin silhouette.
      ? [350, 55, -1050, 350, 72, -1590]
      : [650, 205, -180, 0, 6, -760];
    const underlay = CBZ.scene.getObjectByName("continent-underlay");
    const massif = CBZ.scene.getObjectByName("mount-mercy-ground");
    const massifColour = massif && massif.geometry && massif.geometry.attributes && massif.geometry.attributes.color;
    let massifMin = 1, massifMax = 0;
    if (massifColour) for (let i = 0; i < massifColour.array.length; i++) {
      massifMin = Math.min(massifMin, massifColour.array[i]);
      massifMax = Math.max(massifMax, massifColour.array[i]);
    }
    const massifMaterial = massif && massif.material ? {
      type: massif.material.type, transparent: !!massif.material.transparent,
      opacity: +massif.material.opacity, depthWrite: !!massif.material.depthWrite,
      depthTest: !!massif.material.depthTest,
      colourMin: +massifMin.toFixed(3), colourMax: +massifMax.toFixed(3),
    } : null;
    const terrainMeshes = [], visiblePoints = [], wetInstances = [], groundlessLandInstances = [];
    const shoreAt = CBZ.city && CBZ.city.arena && CBZ.city.arena.mapTerrain &&
      CBZ.city.arena.mapTerrain.shoreAt;
    const instanceMatrix = new THREE.Matrix4();
    const instancePoint = new THREE.Vector3();
    CBZ.scene.traverse((o) => {
      if (o.isMesh && o.userData && o.userData.terrain) {
        terrainMeshes.push({ name: o.name || "(unnamed)", vertices: o.geometry && o.geometry.attributes && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0 });
      }
      if (o.isPoints && o.visible) {
        const m = o.material || {};
        visiblePoints.push({
          name: o.name || "(unnamed)",
          parent: o.parent && (o.parent.name || o.parent.type) || "(none)",
          count: o.geometry && o.geometry.attributes && o.geometry.attributes.position
            ? o.geometry.attributes.position.count : 0,
          size: m.size == null ? null : +m.size,
          opacity: m.opacity == null ? null : +m.opacity,
          color: m.color && m.color.getHexString ? m.color.getHexString() : null,
        });
      }
      // Audit every instanced prop against the same exact coast oracle used
      // by ground, water and the map. This catches vegetation that may look
      // harmless from street level but is unmistakably floating from a plane.
      if (shoreAt && o.isInstancedMesh && o.visible && o.count) {
        let wet = 0;
        const samples = [];
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, instanceMatrix);
          instancePoint.setFromMatrixPosition(instanceMatrix).applyMatrix4(o.matrixWorld);
          if (+shoreAt(instancePoint.x, instancePoint.z) < 0) {
            wet++;
            if (samples.length < 5) samples.push([
              +instancePoint.x.toFixed(1), +instancePoint.y.toFixed(1), +instancePoint.z.toFixed(1),
              +shoreAt(instancePoint.x, instancePoint.z).toFixed(1),
            ]);
          }
        }
        if (wet) wetInstances.push({
          name: o.name || "(unnamed)",
          parent: o.parent && (o.parent.name || o.parent.type) || "(none)",
          count: o.count,
          wet,
          color: o.material && o.material.color && o.material.color.getHexString
            ? o.material.color.getHexString() : null,
          geometry: o.geometry && o.geometry.type,
          samples,
        });
        if (o.name === "backcountry-tree-canopies" && underlay) {
          const groundPos = underlay.geometry.attributes.position;
          const groundIndex = underlay.geometry.index && underlay.geometry.index.array;
          const side = Math.round(Math.sqrt(groundPos.count));
          const seg = side - 1;
          const byVertex = new Array(groundPos.count);
          if (groundIndex) {
            for (let k = 0; k < groundIndex.length; k += 3) {
              for (let n = 0; n < 3; n++) {
                const vi = groundIndex[k + n];
                (byVertex[vi] || (byVertex[vi] = [])).push(k);
              }
            }
          }
          underlay.geometry.computeBoundingBox();
          const box = underlay.geometry.boundingBox;
          const localPoint = new THREE.Vector3();
          const heightXZ = (px, pz, ia, ib, ic) => {
            const ax = groundPos.getX(ia), az = groundPos.getZ(ia);
            const bx = groundPos.getX(ib), bz = groundPos.getZ(ib);
            const cx = groundPos.getX(ic), cz = groundPos.getZ(ic);
            const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
            if (Math.abs(den) < 1e-8) return null;
            const wa = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den;
            const wb = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den;
            const wc = 1 - wa - wb;
            if (wa < -1e-5 || wb < -1e-5 || wc < -1e-5) return null;
            return wa * groundPos.getY(ia) + wb * groundPos.getY(ib) + wc * groundPos.getY(ic);
          };
          let groundless = 0;
          let submerged = 0;
          const missing = [];
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, instanceMatrix);
            instancePoint.setFromMatrixPosition(instanceMatrix).applyMatrix4(o.matrixWorld);
            localPoint.set(instancePoint.x, 0, instancePoint.z);
            underlay.worldToLocal(localPoint);
            const gx = Math.max(0, Math.min(seg - 1,
              Math.floor((localPoint.x - box.min.x) / (box.max.x - box.min.x) * seg)));
            const gz = Math.max(0, Math.min(seg - 1,
              Math.floor((localPoint.z - box.min.z) / (box.max.z - box.min.z) * seg)));
            const nearby = new Set();
            for (const vi of [gz * side + gx, gz * side + gx + 1,
              (gz + 1) * side + gx, (gz + 1) * side + gx + 1]) {
              for (const k of (byVertex[vi] || [])) nearby.add(k);
            }
            let groundY = null;
            for (const k of nearby) {
              const y = heightXZ(localPoint.x, localPoint.z,
                groundIndex[k], groundIndex[k + 1], groundIndex[k + 2]);
              if (y != null) {
                groundY = y;
                break;
              }
            }
            if (groundY == null || groundY < -0.3) {
              if (groundY == null) groundless++;
              else submerged++;
              if (missing.length < 12) missing.push([
                +instancePoint.x.toFixed(1), +instancePoint.z.toFixed(1),
                +shoreAt(instancePoint.x, instancePoint.z).toFixed(1),
                groundY == null ? null : +groundY.toFixed(2),
              ]);
            }
          }
          groundlessLandInstances.push({ name: o.name, count: o.count, groundless, submerged, samples: missing });
        }
      }
    });
    const H = (x, z) => CBZ.floorAt ? +(CBZ.floorAt(x, z) || 0).toFixed(2) : 0;
    return {
      view: mountain ? "mountain" : "aerial",
      underlayCarved: underlay && underlay.userData.carvedTriangles,
      massif: !!massif, massifMaterial,
      heights: { summit: H(470, -1585), valley: H(470, -1300), shoulder: H(100, -1600) },
      terrainMeshes,
      visiblePoints,
      wetInstances,
      groundlessLandInstances,
      procTerrain: CBZ.PROC_TERRAIN,
      weather: CBZ.weather ? { raining: CBZ.weather.raining, intensity: CBZ.weather.intensity } : null,
    };
  }
  if (${WEAPON_FOCUS ? "true" : "false"}) {
    if (CBZ.setFPS) CBZ.setFPS(false);
    const P = CBZ.player;
    const ch = CBZ.playerChar;
    // Use the live rifle path and the live character rig: this proves the
    // semantic right-hand socket and support-hand long-gun pose together.
    const rifle = (CBZ.FPS_WEAPONS || []).find((w) => w &&
      /rifle|carbine|ak|m4/i.test((w.id || "") + " " + (w.name || ""))) ||
      (CBZ.FPS_WEAPONS || []).find((w) => w && w.slot === "long");
    if (rifle && P) {
      if (CBZ.unlockWeapon) CBZ.unlockWeapon(rifle.id, { select: true });
      if (CBZ.setCurrentWeapon) CBZ.setCurrentWeapon(rifle.id);
      CBZ.currentWeaponId = rifle.id;
      CBZ.game.cityHolstered = false;
      if (CBZ.fpsSetAim) CBZ.fpsSetAim(true);
    }
    if (P && P.pos) {
      const ap = CBZ.city && CBZ.city.arena && CBZ.city.arena.airportSpawn;
      // Open apron, not inside the terminal footprint: floorAt() in the old
      // proof quite correctly returned the terminal roof, making the player
      // tiny against a cluttered rooftop instead of proving the hand pose.
      const x = ap ? ap.x : -40, z = ap ? ap.z - 12 : -5;
      const y = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0);
      P.pos.set ? P.pos.set(x, y, z) : (P.pos.x = x, P.pos.y = y, P.pos.z = z);
      P.yaw = 0;
    }
    if (ch && ch.group) {
      ch.group.position.set(P.pos.x, P.pos.y, P.pos.z);
      ch.group.rotation.y = 0;
    }
    // Close rear-right three-quarter proof: the anatomical right flank is
    // plainly visible and the left support hand can be seen under the rifle.
    window.__cam = [P.pos.x + 2.25, P.pos.y + 1.75, P.pos.z - 3.0,
      P.pos.x, P.pos.y + 0.85, P.pos.z + 0.15];
    return {
      view: "weapon",
      weapon: rifle && (rifle.name || rifle.id),
      fps: !!(CBZ.fpsMode || CBZ.game.fps),
      sockets: ch ? {
        right: ch.sockets && ch.sockets.rightHand && ch.sockets.rightHand.getWorldPosition
          ? ch.sockets.rightHand.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)) : null,
        left: ch.sockets && ch.sockets.leftHand && ch.sockets.leftHand.getWorldPosition
          ? ch.sockets.leftHand.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)) : null,
      } : null,
    };
  }
  if (${BUILDING_FOCUS ? "true" : "false"}) {
    if (CBZ.setFPS) CBZ.setFPS(false);
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots || []).filter((l) =>
      l && l.building && l.building.group && l.building.facade === "office" &&
      l.building.storeys >= 4 && l.building.storeys <= 12);
    lots.sort((a, b) => (b.building.storeys - a.building.storeys) ||
      (Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz)));
    const lot = lots[0];
    if (lot) {
      const b = lot.building;
      // A high diagonal exterior view cannot be trapped inside a lobby or
      // neighbouring overhang and shows the whole facade grammar at once.
      const back = Math.max(b.w, b.d) * 1.6 + 22;
      window.__cam = [lot.cx + back, Math.max(16, b.h * 0.72), lot.cz + back,
        lot.cx, Math.min(b.h * 0.48, 18), lot.cz];
      CBZ.player.pos.x = lot.cx + back * 0.6;
      CBZ.player.pos.z = lot.cz + back * 0.6;
      CBZ.player.pos.y = 2;
      const facades = { office: 0, retail: 0, residential: 0, fortified: 0 };
      for (const l of (CBZ.city.arena.lots || [])) {
        const f = l && l.building && l.building.facade;
        if (Object.prototype.hasOwnProperty.call(facades, f)) facades[f]++;
      }
      return { building: b.name || lot.kind, storeys: b.storeys, facade: b.facade,
        at: [lot.cx | 0, lot.cz | 0], facades };
    }
  }
  // find the densest cluster of walking peds and film it from street level
  const peds = (CBZ.cityPeds || []).filter((p) => p && !p.dead && p.group && p.group.visible && !p._parked);
  const cars = (CBZ.cityCars || []).filter((c) => c && c.group && c.group.visible);
  // pick the densest ped cluster that ALSO has traffic nearby (a real street,
  // not a beach outpost on a far island)
  let best = null, bestN = -1;
  for (const p of peds) {
    let carNear = false;
    for (const c of cars) { const dx = c.group.position.x - p.pos.x, dz = c.group.position.z - p.pos.z; if (dx * dx + dz * dz < 45 * 45) { carNear = true; break; } }
    if (!carNear) continue;
    let n = 0;
    for (const q of peds) { const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z; if (dx * dx + dz * dz < 25 * 25) n++; }
    if (n > bestN) { bestN = n; best = p; }
  }
  let car = null, cd = 1e9;
  if (best) for (const c of cars) { const dx = c.group.position.x - best.pos.x, dz = c.group.position.z - best.pos.z; const d = dx * dx + dz * dz; if (d < cd) { cd = d; car = c; } }
  const fx = best ? best.pos.x : 0, fz = best ? best.pos.z : 0;
  const cx = car ? car.group.position.x : fx, cz = car ? car.group.position.z : fz;
  const mx = (fx + cx) / 2, mz = (fz + cz) / 2;
  // teleport the PLAYER to the cluster and face it (the camera rig follows
  // the player; overriding the camera transform directly gets overwritten
  // by whatever render path the game uses now)
  const dx = -7, dz = -7;
  CBZ.player.pos.x = mx + 7; CBZ.player.pos.z = mz + 7; CBZ.player.pos.y = 2;
  if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(dx, dz); if (typeof CBZ.cam.pitch === "number") CBZ.cam.pitch = 0.08; }
  return { peds: bestN, carDist: Math.sqrt(cd) | 0, at: [mx | 0, mz | 0] };
})()`);
console.log("scene:", JSON.stringify(info));
await sleep(2500);
if (MOUNTAIN_FOCUS) {
  const rayInfo = await evl("(() => { const r=new THREE.Raycaster();r.setFromCamera(new THREE.Vector2(0,0),CBZ.camera);return r.intersectObjects(CBZ.scene.children,true).slice(0,12).map(h=>({name:h.object.name||'(unnamed)',parent:h.object.parent&&(h.object.parent.name||h.object.parent.type),at:h.point.toArray().map(v=>+v.toFixed(2)),material:h.object.material&&h.object.material.type,color:h.object.material&&h.object.material.color&&h.object.material.color.getHexString()})); })()");
  console.log("mountain-ray:", JSON.stringify(rayInfo));
}
if (SWIM_FOCUS) {
  const swimInfo = await evl("(() => { const P=CBZ.player, ch=CBZ.playerChar; return {swimming:!!(CBZ.citySwimming&&CBZ.citySwimming()), flag:!!(P&&P._swim), y:P&&+P.pos.y.toFixed(3), sea:CBZ.SEA_Y, rigY:ch&&ch.group&&+ch.group.position.y.toFixed(3), gunVisible:!!(CBZ.fpsCarriedModels&&CBZ.fpsCarriedModels.some(m=>m&&m.parent&&m.parent.visible))}; })()");
  console.log("swim:", JSON.stringify(swimInfo));
}
if (WILDLIFE_FOCUS) {
  const wildlifeInfo = await evl("(() => { const q=window.__wildlifeAudit,a=q&&q.actor;if(!a||!a.group)return null;const dx=a.group.position.x-q.x,dz=a.group.position.z-q.z,d=Math.hypot(dx,dz),h=a.faceH==null?a.heading:a.faceH;return {moved:+d.toFixed(3),alignment:d>0.001?+(((dx/d)*Math.cos(h)+(dz/d)*Math.sin(h)).toFixed(3)):1,gaitMoved:+(a._motionMoved||0).toFixed(4),gaitAlignment:+(a._motionAlignment==null?1:a._motionAlignment).toFixed(3),state:a.state,visible:a.group.visible!==false}; })()");
  console.log("wildlife:", JSON.stringify(wildlifeInfo));
}
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log(OUT);
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(`/tmp/cbz-street-${dbg}`, { recursive: true, force: true }).catch(() => {});
