/* ============================================================
   systems/taserfx.js — one visual language for every taser hit.

   A conducted-energy weapon launches TWO probes on thin wires; it does not
   eject brass or paint a bullet tracer. This small pooled renderer owns those
   wires, their contact darts, the blue-white electrical arc around the struck
   body, and the short NPC/player taser-pose signal. Player FPS fire and prison
   guard capture both call the same API.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.scene) return;

  const SHOTS = 4;
  const WIRE_POINTS = 9;
  const ARC_POINTS = 7;
  const ARC_COUNT = 5;
  const DEFAULT_LIFE = 0.72;
  const UP = new THREE.Vector3(0, 1, 0);
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const tmpD = new THREE.Vector3();
  const side = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const dartQ = new THREE.Quaternion();
  let cursor = 0;

  function glowTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(170,235,255,.98)");
    g.addColorStop(0.52, "rgba(55,170,255,.48)");
    g.addColorStop(1, "rgba(20,90,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const glowTex = glowTexture();
  const dartGeo = new THREE.CylinderGeometry(0.012, 0.019, 0.12, 7);
  const dartMat = new THREE.MeshLambertMaterial({ color: 0x202a31, emissive: 0x071018, emissiveIntensity: 0.35 });
  const arcPairs = [
    [[-0.36, 1.72, 0.10], [0.40, 1.22, 0.12]],
    [[0.38, 1.65, 0.06], [-0.32, 0.96, 0.16]],
    [[-0.26, 1.34, 0.20], [0.28, 0.72, 0.10]],
    [[-0.44, 1.18, 0.04], [0.35, 1.48, 0.18]],
    [[-0.22, 0.82, 0.12], [0.22, 0.48, 0.08]],
  ];

  function line(points, color, opacity, additive) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(points * 3), 3));
    const material = new THREE.LineBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      // Electrical arcs wrap a visible body and must not disappear into its
      // own bright uniform; physical wires retain normal depth occlusion.
      depthTest: !additive,
    });
    const out = new THREE.Line(geo, material);
    out.frustumCulled = false;
    out.visible = false;
    CBZ.scene.add(out);
    return out;
  }

  function makeRecord() {
    const wires = [line(WIRE_POINTS, 0xdce7eb, 0.86, false), line(WIRE_POINTS, 0xc9d8de, 0.82, false)];
    const darts = [new THREE.Mesh(dartGeo, dartMat), new THREE.Mesh(dartGeo, dartMat)];
    for (const dart of darts) { dart.visible = false; dart.frustumCulled = false; CBZ.scene.add(dart); }
    const arcs = [];
    for (let i = 0; i < ARC_COUNT; i++) arcs.push(line(ARC_POINTS, i % 2 ? 0x73d7ff : 0xe4f8ff, 0.95, true));
    const glows = [0, 1].map(() => {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0x8ddfff, transparent: true, opacity: 0,
        depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.visible = false; glow.frustumCulled = false; CBZ.scene.add(glow);
      return glow;
    });
    const light = new THREE.PointLight(0x77d9ff, 0, 5.5, 2);
    light.visible = false; CBZ.scene.add(light);
    return {
      wires, darts, arcs, glows, light,
      source: new THREE.Vector3(), worldA: new THREE.Vector3(), worldB: new THREE.Vector3(),
      localA: new THREE.Vector3(), localB: new THREE.Vector3(), targetGroup: null,
      life: 0, max: DEFAULT_LIFE, age: 0, phase: 0,
    };
  }

  const pool = Array.from({ length: SHOTS }, makeRecord);

  function targetGroup(target) {
    if (!target) return null;
    if (target.isObject3D) return target;
    if (target.group && target.group.isObject3D) return target.group;
    if (target.char && target.char.group && target.char.group.isObject3D) return target.char.group;
    return null;
  }

  function targetChar(target) {
    if (!target) return null;
    if (target.parts && target.group) return target;
    if (target.char && target.char.parts) return target.char;
    if (target.isPlayer || target === CBZ.player) return CBZ.playerChar || null;
    return null;
  }

  function hit(target, duration) {
    const ch = targetChar(target);
    if (ch) {
      ch.taserT = Math.max(ch.taserT || 0, duration || DEFAULT_LIFE);
      ch.taserDur = Math.max(ch.taserDur || 0, duration || DEFAULT_LIFE);
    }
    if (target && !target.isObject3D) target.taserT = Math.max(target.taserT || 0, duration || DEFAULT_LIFE);
  }

  function pointOnTarget(rec, local, out) {
    if (!rec.targetGroup) return out.copy(local);
    rec.targetGroup.updateWorldMatrix(true, false);
    return rec.targetGroup.localToWorld(out.copy(local));
  }

  function writeWire(rec, wireIndex, end) {
    const attr = rec.wires[wireIndex].geometry.attributes.position;
    dir.copy(end).sub(rec.source);
    const distance = Math.max(0.001, dir.length());
    dir.multiplyScalar(1 / distance);
    side.crossVectors(dir, UP);
    if (side.lengthSq() < 0.0001) side.set(1, 0, 0); else side.normalize();
    const separation = wireIndex ? 0.020 : -0.020;
    const sag = Math.min(0.52, 0.07 + distance * 0.027);
    for (let i = 0; i < WIRE_POINTS; i++) {
      const t = i / (WIRE_POINTS - 1);
      tmpC.copy(rec.source).lerp(end, t)
        .addScaledVector(side, separation * Math.sin(Math.PI * t));
      tmpC.y -= Math.sin(Math.PI * t) * sag;
      attr.setXYZ(i, tmpC.x, tmpC.y, tmpC.z);
    }
    attr.needsUpdate = true;
  }

  function writeArc(rec, arc, index) {
    const pair = arcPairs[index];
    tmpA.set(pair[0][0], pair[0][1], pair[0][2]);
    tmpB.set(pair[1][0], pair[1][1], pair[1][2]);
    pointOnTarget(rec, tmpA, tmpC);
    pointOnTarget(rec, tmpB, tmpD);
    const attr = arc.geometry.attributes.position;
    for (let i = 0; i < ARC_POINTS; i++) {
      const t = i / (ARC_POINTS - 1);
      tmpA.copy(tmpC).lerp(tmpD, t);
      if (i > 0 && i < ARC_POINTS - 1) {
        const wave = rec.phase + rec.age * 92 + index * 13.7 + i * 7.1;
        const envelope = Math.sin(Math.PI * t);
        tmpA.x += Math.sin(wave * 1.11) * 0.105 * envelope;
        tmpA.y += Math.sin(wave * 1.73 + 1.2) * 0.075 * envelope;
        tmpA.z += Math.cos(wave * 1.37 - 0.7) * 0.105 * envelope;
      }
      attr.setXYZ(i, tmpA.x, tmpA.y, tmpA.z);
    }
    attr.needsUpdate = true;
  }

  function updateRecord(rec, dt) {
    if (rec.life <= 0) return;
    rec.age += dt;
    rec.life = Math.max(0, rec.life - dt);
    const fade = Math.min(1, rec.life / Math.min(0.20, rec.max));
    pointOnTarget(rec, rec.localA, rec.worldA);
    pointOnTarget(rec, rec.localB, rec.worldB);
    writeWire(rec, 0, rec.worldA);
    writeWire(rec, 1, rec.worldB);

    for (let i = 0; i < 2; i++) {
      const wire = rec.wires[i];
      wire.visible = rec.life > 0;
      wire.material.opacity = fade * (i ? 0.74 : 0.86);
      const end = i ? rec.worldB : rec.worldA;
      const dart = rec.darts[i];
      dart.visible = rec.life > 0;
      dart.position.copy(end);
      dir.copy(end).sub(rec.source).normalize();
      dart.quaternion.copy(dartQ.setFromUnitVectors(UP, dir));
    }

    const pulse = 0.76 + 0.24 * Math.sin(rec.age * 88 + rec.phase);
    tmpA.copy(rec.worldA).add(rec.worldB).multiplyScalar(0.5);
    for (let i = 0; i < rec.glows.length; i++) {
      const glow = rec.glows[i];
      glow.visible = rec.life > 0;
      glow.position.copy(i ? rec.worldB : rec.worldA);
      glow.scale.setScalar(0.18 + pulse * 0.13);
      glow.material.opacity = fade * (0.42 + pulse * 0.34);
    }
    rec.light.visible = rec.life > 0;
    rec.light.position.copy(tmpA);
    rec.light.intensity = fade * (0.45 + pulse * 0.75);

    for (let i = 0; i < rec.arcs.length; i++) {
      const arc = rec.arcs[i];
      arc.visible = !!rec.targetGroup && rec.life > 0;
      if (!arc.visible) continue;
      writeArc(rec, arc, i);
      arc.material.opacity = fade * (0.58 + 0.42 * Math.abs(Math.sin(rec.age * 76 + rec.phase + i * 1.9)));
    }

    if (rec.life <= 0) {
      for (const o of [...rec.wires, ...rec.darts, ...rec.arcs]) o.visible = false;
      for (const glow of rec.glows) glow.visible = false;
      rec.light.visible = false; rec.targetGroup = null;
    }
  }

  function fire(from, to, opts) {
    opts = opts || {};
    if (!from || !to) return null;
    const rec = pool[cursor++ % pool.length];
    rec.source.copy(from);
    rec.max = Math.max(0.18, opts.duration || DEFAULT_LIFE);
    rec.life = rec.max;
    rec.age = 0;
    rec.phase = (cursor * 2.399963229728653) % (Math.PI * 2);
    rec.targetGroup = targetGroup(opts.target);
    if (rec.targetGroup) {
      rec.targetGroup.updateWorldMatrix(true, false);
      rec.localA.copy(to); rec.targetGroup.worldToLocal(rec.localA);
      rec.localB.copy(rec.localA);
      rec.localA.x -= 0.115; rec.localA.y += 0.055; rec.localA.z += 0.025;
      rec.localB.x += 0.115; rec.localB.y -= 0.045; rec.localB.z += 0.025;
    } else {
      dir.copy(to).sub(from).normalize();
      side.crossVectors(dir, UP);
      if (side.lengthSq() < 0.0001) side.set(1, 0, 0); else side.normalize();
      rec.localA.copy(to).addScaledVector(side, -0.055);
      rec.localB.copy(to).addScaledVector(side, 0.055);
    }
    if (opts.target) hit(opts.target, rec.max);
    updateRecord(rec, 0);
    return rec;
  }

  // Guards in Prison Escape use a contact capture escalation rather than the
  // FPS gun path. Draw the SAME taser in the real actor hand for that beat,
  // launch the same probes, then restore the guard's prior loadout.
  const drawn = [];
  function restoreField(actor, key, value) {
    if (value === undefined) delete actor[key]; else actor[key] = value;
  }
  /* AIM, THEN POSE — and the POSE is the half that has to work for a screw.
     CBZ.actorAimAt reads `actor.pos`, which is the shape a city ped carries;
     a prison guard is `{ group, char, … }` with no `.pos` at all, so that call
     has been throwing into the swallow below since the day it was written and
     setReadyPose never ran on a guard. The taser still APPEARED in his fist
     (syncActorWeapon only needs a socket) and it still looked presented — but
     only because entities/guards.js was holding that same arm out in front of
     him for the flashlight. Take the torch away and the truth showed up in the
     storyboard: a guard tasing a man at arm's length with the weapon hanging
     at his hip. CBZ.actorReadyPose is the same setReadyPose with no `.pos`
     read in it, and the guard's yaw is already owned by his own hunt turn. */
  function presentTaser(actor, dt) {
    try { if (CBZ.actorAimAt) CBZ.actorAimAt(actor, { pos: CBZ.player.pos }, dt); } catch (_) {}
    try { if (CBZ.actorReadyPose) CBZ.actorReadyPose(actor); } catch (_) {}
  }
  function actorTasePlayer(actor) {
    if (!actor || !CBZ.player || !CBZ.playerChar || !CBZ.playerChar.group) return false;
    let draw = drawn.find((d) => d.actor === actor);
    if (!draw) {
      draw = {
        actor, t: 0.95,
        prev: {
          weapon: actor.weapon, armed: actor.armed, holstered: actor._holstered,
          lowered: actor._gunLowered, hidden: actor._gunHidden,
        },
      };
      drawn.push(draw);
    } else draw.t = Math.max(draw.t, 0.95);
    actor.weapon = "Taser";
    actor.armed = true;
    actor._holstered = false;
    actor._gunLowered = false;
    actor._gunHidden = false;
    presentTaser(actor, 1);
    const from = CBZ.actorMuzzle ? CBZ.actorMuzzle(actor, tmpA) : tmpA.set(actor.group.position.x, actor.group.position.y + 1.35, actor.group.position.z);
    CBZ.playerChar.group.updateWorldMatrix(true, false);
    const to = CBZ.playerChar.group.localToWorld(tmpB.set(0, 1.18, 0.08));
    fire(from, to, { target: CBZ.playerChar, duration: 0.82 });
    return true;
  }

  function updateDrawn(dt) {
    for (let i = drawn.length - 1; i >= 0; i--) {
      const d = drawn[i]; d.t -= dt;
      if (d.t > 0 && d.actor && !d.actor.dead) {
        presentTaser(d.actor, dt);
        continue;
      }
      const a = d.actor, p = d.prev;
      if (a) {
        restoreField(a, "weapon", p.weapon);
        restoreField(a, "armed", p.armed);
        restoreField(a, "_holstered", p.holstered);
        restoreField(a, "_gunLowered", p.lowered);
        restoreField(a, "_gunHidden", p.hidden);
        try { if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(a); } catch (_) {}
      }
      drawn.splice(i, 1);
    }
  }

  if (CBZ.onAlways) CBZ.onAlways(53, function (dt) {
    for (const rec of pool) updateRecord(rec, dt);
    updateDrawn(dt);
  });

  CBZ.taserFx = { fire, hit, actorTasePlayer };
  CBZ.taserFxAudit = function () {
    let active = 0, wires = 0, arcs = 0, darts = 0;
    for (const rec of pool) {
      if (rec.life <= 0) continue;
      active++;
      wires += rec.wires.filter((o) => o.visible).length;
      arcs += rec.arcs.filter((o) => o.visible).length;
      darts += rec.darts.filter((o) => o.visible).length;
    }
    return { active, wires, arcs, darts, drawnActors: drawn.length };
  };
})();
