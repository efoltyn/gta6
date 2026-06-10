/* ============================================================
   net/netactors.js — remote player avatars. Each connected player
   broadcasts their own state (~12Hz); this file turns everyone
   else's stream into a walking, driving, shooting character:
   full rig + name·role tag, 160ms interpolation buffer, a real
   car visual while they drive, weapon-in-hand, death pose.
   These actors are also REAL combat targets: they're scanned by
   the gun hitscan (PvP) and, on the sim host, offered to cop/ped
   AI as chase/shoot targets (damage routes back over the wire
   via actor.netHurt -> "nhurt" event -> victim's cityHurtPlayer).
============================================================ */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CBZ || !window.CBZ.net) return;
  const CBZ = window.CBZ;
  const net = CBZ.net;
  const g = CBZ.game;

  const remotes = new Map(); // id -> R
  const INTERP_MS = 160;

  const ROLE_STYLE = {
    civ: { color: "#9fd0ff", torso: null },
    police: { color: "#7fb4ff", torso: 0x1d2e55, legs: 0x16213d },
    cop: { color: "#7fb4ff", torso: 0x1d2e55, legs: 0x16213d },
    ems: { color: "#ff8a8a", torso: 0xf2f2f2, legs: 0xb03030 },
    taxi: { color: "#ffd866", torso: 0xc9a227, legs: 0x2b2b2b },
    crook: { color: "#c79bff", torso: 0x232323, legs: 0x2e2e2e },
  };
  const PALETTE = [0x8a3d3d, 0x3d6a8a, 0x3d8a55, 0x7a5fa8, 0xa8743c, 0x4f4f5e, 0x356d6d, 0x96527a];

  function styleFor(id, role) {
    const st = ROLE_STYLE[(role || "civ").toLowerCase()] || ROLE_STYLE.civ;
    const base = PALETTE[id % PALETTE.length];
    return {
      color: st.color,
      torso: st.torso != null ? st.torso : base,
      legs: st.legs != null ? st.legs : 0x23262e,
      skin: [0xe8b48c, 0xc68642, 0x8d5524, 0xf1c27d][id % 4],
      hair: [0x222222, 0x4a2f1d, 0x777777, 0x111111][(id * 3) % 4],
    };
  }

  function buildRig(R) {
    const s = styleFor(R.id, R.role);
    const ch = CBZ.makeCharacter({ legs: s.legs, torso: s.torso, collar: s.torso, arms: s.torso, skin: s.skin, hair: s.hair, shoes: 0x2b2b2b });
    R.ch = R.char = ch;
    R.group = ch.group;
    R.pos = ch.group.position;
    const roleName = (R.role || "").toLowerCase();
    const tagText = R.name + (roleName && roleName !== "civ" ? " · " + roleName.toUpperCase() : "");
    if (CBZ.makeLabelSprite) {
      R.tag = CBZ.makeLabelSprite(tagText, { color: s.color });
      R.tag.position.y = 3.05;
      R.tag.scale.set(3.4, 0.85, 1);
      ch.group.add(R.tag);
    }
    R._deadPosed = false;
    attach(R.group);
  }

  function attach(group) {
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    if (root && group.parent !== root) root.add(group);
  }

  function dropRig(R) {
    if (R.group && R.group.parent) R.group.parent.remove(R.group);
    R.ch = R.char = null; R.group = null;
  }

  function dropCar(R) {
    if (R.carVis && R.carVis.parent) R.carVis.parent.remove(R.carVis);
    R.carVis = null; R.carModel = undefined;
  }

  function getR(id) {
    let R = remotes.get(id);
    if (!R) {
      const info = net.players.get(id) || { name: "Player " + id, role: "civ" };
      R = {
        id, name: info.name || "Player " + id, role: info.role || "civ",
        netKind: "player", netId: id, isPlayer: true,
        hp: 200, dead: false, ko: 0, armed: false, weapon: null,
        buf: [], carBuf: [], driving: false,
        netHurt: function (dmg, fx, fz, reason) {
          net.sendEv({ e: "nhurt", to: id, dmg: Math.round(dmg), fx, fz, reason });
        },
      };
      remotes.set(id, R);
    }
    return R;
  }

  CBZ.netRemoteActor = function (id) { return remotes.get(id) || null; };
  CBZ.netRemoteTargets = function (out) {
    for (const R of remotes.values()) if (R.group && !R.dead && !R.driving) out.push(R);
    return out;
  };

  // ---- incoming state ------------------------------------------------------
  net.on("state", function (m) {
    if (g.mode !== "city") return;
    const R = getR(m.id);
    const now = performance.now();
    R.buf.push({ t: now, x: m.p[0], y: m.p[1], z: m.p[2], h: m.h || 0, s: m.s || 0 });
    if (R.buf.length > 14) R.buf.splice(0, R.buf.length - 14);
    R.hp = m.hp;
    if (R.dead && !m.dead) { // respawned: rebuild the rig (death pose mangled it)
      dropRig(R);
      R._deadPosed = false;
    }
    R.dead = !!m.dead;
    const wasDriving = R.driving;
    R.driving = !!m.car;
    if (R.driving) {
      R.carBuf.push({ t: now, x: m.car[1], z: m.car[2], h: m.car[3], v: m.car[4] || 0 });
      if (R.carBuf.length > 14) R.carBuf.splice(0, R.carBuf.length - 14);
      if (R.carModel !== m.car[0]) { dropCar(R); R.carModel = m.car[0]; }
    } else if (wasDriving) { dropCar(R); R.carBuf.length = 0; }
    const wkey = m.w || null;
    R.weapon = wkey && wkey !== "fists" ? wkey : null;
    R.armed = !!R.weapon;
  });

  net.on("leave", function (m) {
    const R = remotes.get(m.id);
    if (R) { dropRig(R); dropCar(R); remotes.delete(m.id); }
  });
  net.on("_offline", function () {
    for (const R of remotes.values()) { dropRig(R); dropCar(R); }
    remotes.clear();
  });

  // ---- interpolation + animation ------------------------------------------
  function sample(buf, t) {
    if (!buf.length) return null;
    if (buf.length === 1 || t <= buf[0].t) return buf[0];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= t) {
        const a = buf[i], b = buf[i + 1];
        if (!b) return a;
        const k = Math.min(1, (t - a.t) / Math.max(1, b.t - a.t));
        const out = { x: a.x + (b.x - a.x) * k, y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * k, z: a.z + (b.z - a.z) * k, s: a.s, v: a.v };
        let dh = (b.h - a.h) % (Math.PI * 2);
        if (dh > Math.PI) dh -= Math.PI * 2;
        if (dh < -Math.PI) dh += Math.PI * 2;
        out.h = a.h + dh * k;
        return out;
      }
    }
    return buf[buf.length - 1];
  }

  if (CBZ.onAlways) CBZ.onAlways(46.2, function (dt) {
    if (!net.active || g.mode !== "city" || remotes.size === 0) return;
    const t = performance.now() - INTERP_MS;
    for (const R of remotes.values()) {
      // --- on foot ---
      if (!R.driving) {
        const s = sample(R.buf, t);
        if (!s) continue;
        if (!R.group) buildRig(R);
        attach(R.group);
        R.group.visible = true;
        R.group.position.set(s.x, s.y || 0, s.z);
        R.group.rotation.y = s.h;
        if (R.dead) {
          if (!R._deadPosed && CBZ.deathPose) { CBZ.deathPose(R.ch, R.id + 7); R._deadPosed = true; }
        } else if (CBZ.animChar) {
          CBZ.animChar(R.ch, s.s || 0, dt);
        }
        if (CBZ.syncActorWeapon) try { CBZ.syncActorWeapon(R); } catch (e) {}
        continue;
      }
      // --- driving: hide rig, show their car ---
      if (R.group) R.group.visible = false;
      const c = sample(R.carBuf, t);
      if (!c) continue;
      if (!R.carVis) {
        try { R.carVis = CBZ.cityBuildAmbientCarVisual ? CBZ.cityBuildAmbientCarVisual(R.carModel || undefined) : null; } catch (e) { R.carVis = null; }
        if (R.carVis) {
          const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
          if (root) root.add(R.carVis);
        }
      }
      if (R.carVis) {
        attach(R.carVis);
        R.carVis.position.set(c.x, 0, c.z);
        R.carVis.rotation.y = c.h;
      }
    }
  });

  // ---- remote gunfire fx ----------------------------------------------------
  net.onEv("shot", function (m) {
    if (g.mode !== "city" || !m.o || !m.d) return;
    const from = { x: m.o[0], y: m.o[1], z: m.o[2] };
    if (CBZ.tracer) try { CBZ.tracer(from, { x: m.d[0], y: m.d[1], z: m.d[2] }, { muzzleScale: 1 }); } catch (e) {}
    if (CBZ.sfx) {
      const P = CBZ.player;
      const d = Math.hypot(from.x - P.pos.x, from.z - P.pos.z);
      const vol = Math.max(0.12, Math.min(1, 1.15 - d / 90));
      try { CBZ.sfx("report", { volume: vol }); } catch (e) { try { CBZ.sfx("report"); } catch (e2) {} }
    }
  });
})();
