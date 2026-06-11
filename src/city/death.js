/* ============================================================
   city/death.js — cinematic WASTED deaths + hospital respawn, and the
   BUSTED → jail fade.

   The city is third-person already, so a death plays out in full view:
   a spinning ragdoll fling (physics.js integrates player._death in any
   non-escape mode), a hard shake, slow-mo, a blood burst, and a big
   WASTED title. A few seconds later you respawn at the nearest hospital
   (lighter wallet, lower heat) — the run continues, GTA-style.

   The fling MATCHES the killing force (why: the body's flight should sell
   what hit it): cityHurtPlayer forwards the final damage of the killing
   blow, so a close shotgun blast hurls + spins you away from the shooter
   while bleeding out is a weak slump; headshots/run-overs carry their
   flags into CBZ.gore for the head-pop / road-smear treatments.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  let overlay = null, titleEl = null, subEl = null;
  let respawnT = 0, dying = false, wastedT = 0, pendingWasted = null;
  // ---- SPECTATE (Fortnite-style kill-cam): WASTED plays unchanged, THEN — if a
  //      real on-map actor killed you — the camera leaves your corpse and follows
  //      your KILLER, showing their live state, until you respawn. ----
  let spectating = false, specKiller = null, pendingSpecKiller = null;
  let specT = 0, specMax = 10, specKillerMax = 100;
  let specHUD = null, specName = null, specHpFill = null, specHpTxt = null, specStateEl = null, specFoot = null;

  // a killer can arrive as an ACTOR (NPC/cop — has .pos, spectatable) or a plain
  // NAME string (chopper, gang, "the police"). This always yields the display
  // string that the WASTED title + killfeed.js read.
  function killerName(a) {
    if (!a) return null;
    if (typeof a === "string") return a;
    if (a.swat) return "a SWAT officer";
    if (a.kind === "cop") return "the police";
    if (a.name) return a.name + (a.gang ? " of the " + a.gang : "");
    return "a stranger";
  }

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "cityWasted";
    overlay.style.cssText = "position:fixed;inset:0;z-index:55;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;pointer-events:none;font-family:Fredoka,system-ui,sans-serif;text-align:center;background:radial-gradient(ellipse at 50% 50%,rgba(40,0,0,0) 30%,rgba(20,0,0,.75) 100%)";
    titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:clamp(54px,12vw,140px);font-weight:700;letter-spacing:4px;color:#c9202a;text-shadow:0 6px 0 #5e070b,0 10px 26px rgba(0,0,0,.6);opacity:0;transition:opacity 1s ease,transform 1s ease;transform:scale(1.25)";
    subEl = document.createElement("div");
    subEl.style.cssText = "font-size:clamp(22px,3.4vw,34px);font-weight:600;letter-spacing:1px;text-shadow:0 3px 0 rgba(0,0,0,.45),0 4px 14px rgba(0,0,0,.55);opacity:0;transition:opacity 1.1s ease .4s";
    overlay.appendChild(titleEl); overlay.appendChild(subEl);
    document.body.appendChild(overlay);
  }
  function showOverlay(big, sub, color) {
    buildOverlay();
    titleEl.textContent = big; titleEl.style.color = color || "#c9202a";
    subEl.textContent = sub || ""; subEl.style.color = color || "#c9202a";
    overlay.style.display = "flex";
    void overlay.offsetWidth;
    titleEl.style.opacity = "1"; titleEl.style.transform = "scale(1)";
    subEl.style.opacity = "1";
  }
  function hideOverlay() {
    if (!overlay) return;
    overlay.style.display = "none";
    titleEl.style.opacity = "0"; titleEl.style.transform = "scale(1.25)"; subEl.style.opacity = "0";
  }

  CBZ.cityDeathReset = function () { dying = false; respawnT = 0; wastedT = 0; pendingWasted = null; spectating = false; specKiller = null; pendingSpecKiller = null; g._citySpecTarget = null; if (specHUD) specHUD.style.display = "none"; hideOverlay(); if (CBZ.cityCam) CBZ.cityCam.death = null; };

  // a red damage flash (the engine never defined CBZ.hitFlash) — drives the
  // existing #hitfx overlay so getting shot reads dramatically.
  let hitEl = null;
  if (!CBZ.hitFlash) CBZ.hitFlash = function () {
    if (!hitEl) { hitEl = document.getElementById("hitfx") || document.getElementById("vignette"); }
    if (!hitEl) return;
    hitEl.style.transition = "none"; hitEl.style.boxShadow = "inset 0 0 160px 40px rgba(200,20,20,.6)"; hitEl.style.opacity = "1";
    void hitEl.offsetWidth;
    hitEl.style.transition = "opacity .45s ease, box-shadow .45s ease";
    hitEl.style.opacity = "0";
  };

  // ---- central player damage: armoured, survivable, with out-of-combat
  //      regen so a gunfight is a back-and-forth, not an instant death.
  //      The CITY player is tougher than an NPC: incoming damage is scaled
  //      down, and a headshot is brutal but SURVIVABLE from full health
  //      (it one-shots NPCs, not you), so a firefight is winnable. ----
  const CITY_DR = 0.6;           // fraction of incoming damage the player actually takes
  const HEADSHOT_FRAC = 0.6;     // a headshot deals up to 60% of max HP (not an instakill)

  CBZ.cityHurtPlayer = function (dmg, fromX, fromZ, reason, headshot, attacker, nonlethal) {
    const P = CBZ.player;
    if (P.dead || (g.invuln || 0) > 0) return;
    if (attacker) {
      // an ACTOR (has .pos) can be SPECTATED after WASTED; a bare string just names
      // the killer. g._cityKiller STAYS a display string either way (killfeed.js +
      // the WASTED title read it as text); the actor rides on g._cityKillerActor.
      if (typeof attacker === "object" && attacker.pos) { g._cityKillerActor = attacker; g._cityKiller = killerName(attacker); }
      else { g._cityKiller = attacker; g._cityKillerActor = null; }
      g._cityKillerT = CBZ.now || 0;
    }
    if (headshot) dmg = Math.max(dmg, (P.maxHp || 200) * HEADSHOT_FRAC);
    dmg *= CITY_DR;
    // Bumps and medium-speed traffic impacts can hurt badly, but should not
    // turn a scrape into a WASTED screen. Truly catastrophic hits opt out.
    if (nonlethal) dmg = Math.min(dmg, Math.max(0, P.hp - 1));
    if (P._armor > 0) { const a = Math.min(P._armor, dmg * (headshot ? 0.45 : 0.7)); P._armor -= a; dmg -= a; }
    P.hp -= dmg;
    P._hurtT = 3.5;                     // pause regen briefly, then it ramps back
    if (CBZ.hitFlash) CBZ.hitFlash();
    if (CBZ.shake) CBZ.shake(Math.min(0.4, 0.12 + dmg * 0.01));
    // INJURY: a surviving flesh hit can leave a lasting wound (limp / bleeding /
    // shaky aim) so a firefight has consequences beyond a number ticking down.
    if (dmg > 0 && P.hp > 0) applyWound(dmg, reason, headshot, fromX, fromZ);
    // the FINAL damage of the killing blow rides the impact: cityKillPlayer
    // scales the ragdoll fling from it (a close shotgun blast hurls you, a
    // pistol tap just drops you) and the headshot flag drives the head-pop gore.
    if (P.hp <= 0) CBZ.cityKillPlayer(reason || "killed", { fromX, fromZ, dmg, headshot });
  };

  // ============================================================
  //  PLAYER INJURY MODEL — getting shot LEAVES A MARK.
  //  WHY: damage that's just an HP number has no texture; a leg shot that makes
  //  you limp (slower, can't sprint away), an arm shot that shakes your aim, and
  //  bleeding that ticks you down until you find cover/heal turns every wound
  //  into a tactical decision. Wounds are probabilistic per hit (the engine
  //  doesn't track which limb of YOU got hit), decay over time, and clear on a
  //  hospital respawn. Bullets/blades wound; explosions/falls/cars don't (those
  //  have their own brutal feedback). Read by physics (limp), fpsmode (sway),
  //  the minimap/phone (status), and the bleed-out tick below.
  // ============================================================
  function isFleshHit(reason) {
    if (isExplosionCause(reason) || isImpactCause(reason)) return false;
    const r = ("" + (reason || "")).toLowerCase();
    if (r.indexOf("car") >= 0 || r.indexOf("traffic") >= 0 || r.indexOf("crash") >= 0 ||
        r.indexOf("run over") >= 0 || r.indexOf("drown") >= 0 || r.indexOf("starv") >= 0) return false;
    return true;   // gunfire, stabs, beatings → a wound is plausible
  }
  function applyWound(dmg, reason, headshot, fromX, fromZ) {
    const P = CBZ.player;
    if (headshot || !isFleshHit(reason)) { bleedFrom(dmg * 0.5, fromX, fromZ); return; }
    const maxHp = P.maxHp || 200;
    const sev = Math.min(1, dmg / (maxHp * 0.5));        // 0..1 by how hard the hit was
    // roll a hit location: legs are a big target (limp), arms next (aim sway),
    // the rest is body (just bleeding + stagger).
    const roll = Math.random();
    if (roll < 0.34) {
      P._legSide = Math.random() < 0.5 ? 1 : -1;
      P._legWound = Math.min(1, (P._legWound || 0) + 0.35 + sev * 0.55);
      if (CBZ.flashHint && (P._legWound > 0.45)) CBZ.flashHint("🦵 LEG HIT — you're limping", 1.6);
    } else if (roll < 0.55) {
      P._armWound = Math.min(1, (P._armWound || 0) + 0.3 + sev * 0.5);
    } else {
      P.stun = Math.max(P.stun || 0, 0.08 + sev * 0.12);   // a body shot staggers you a beat
    }
    bleedFrom(dmg, fromX, fromZ);
    if (CBZ.gore && P.pos) CBZ.gore(P.pos.x, P.pos.y + 1.1, P.pos.z, { amount: 0.5 + sev * 0.6, player: true, dir: (fromX != null ? { x: P.pos.x - fromX, z: P.pos.z - fromZ } : null) });
  }
  function bleedFrom(dmg, fromX, fromZ) {
    const P = CBZ.player, maxHp = P.maxHp || 200;
    P._bleeding = Math.min(1, (P._bleeding || 0) + Math.min(0.6, dmg / maxHp));   // a bleed RATE that clots over time
    if (fromX != null) { P._bleedX = fromX; P._bleedZ = fromZ; }
  }
  CBZ.cityApplyWound = applyWound;
  // healing & reset hooks
  CBZ.cityHealWounds = function () { const P = CBZ.player; P._legWound = 0; P._armWound = 0; P._bleeding = 0; P._moveScale = 1; };
  const _injReset = CBZ.cityDeathReset;
  CBZ.cityDeathReset = function () { if (_injReset) _injReset(); CBZ.cityHealWounds(); };

  // ---- the injury TICK: clot bleeding (DOT), decay wounds, publish the limp
  //      move-scale, and drive a limp hitch on the model on top of the walk. ----
  let _bleedSpray = 0;
  CBZ.onUpdate(10.6, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player; if (!P) return;
    if (P.dead) { P._moveScale = 1; return; }
    const maxHp = P.maxHp || 200;
    // BLEEDING: drains HP while it lasts, then clots. Standing still clots faster
    // (you're applying pressure); sprinting keeps it open. A red vignette pulses.
    if ((P._bleeding || 0) > 0.01) {
      const rate = P._bleeding;
      P.hp -= rate * 3.4 * dt;                       // ~lethal only if you ignore it
      P._hurtT = Math.max(P._hurtT || 0, 0.5);       // bleeding suppresses regen
      const moving = (P.speed || 0) > 1;
      P._bleeding = Math.max(0, P._bleeding - dt * (moving ? 0.045 : 0.11));   // clot
      _bleedSpray -= dt;
      if (_bleedSpray <= 0 && CBZ.gore && P.pos) { _bleedSpray = 0.5 + Math.random() * 0.6; CBZ.gore(P.pos.x, P.pos.y + 0.4, P.pos.z, { amount: 0.3 * rate, player: true }); }
      if (CBZ.hitFlash && Math.random() < rate * dt * 4) CBZ.hitFlash();
      if (P.hp <= 0) { CBZ.cityKillPlayer("bled out", { fromX: P._bleedX, fromZ: P._bleedZ, dmg: 8 }); return; }   // tiny dmg → a weak slump, not a launch
    }
    // WOUNDS decay (the body recovers); faster while you're resting (not moving,
    // not in combat). Full leg wound ~ 22s to walk off, quicker if you hole up.
    const resting = (P.speed || 0) < 0.6 && (P._hurtT || 0) <= 0;
    const heal = dt * (resting ? 0.09 : 0.045);
    if (P._legWound > 0) P._legWound = Math.max(0, P._legWound - heal);
    if (P._armWound > 0) P._armWound = Math.max(0, P._armWound - heal);
    // publish the limp move-scale for physics (a bad leg = you can't run).
    const lw = P._legWound || 0;
    P._moveScale = 1 - lw * 0.5;
    if (lw > 0.4) P.sprint = false;                  // can't sprint on a blown leg
    // LIMP HITCH on the model, layered over the walk anim (which already ran at
    // order 10). Only when actually moving so the idle pose stays clean.
    const ch = CBZ.playerChar;
    if (lw > 0.06 && ch && ch.parts && (P.speed || 0) > 0.4 && ch.group) {
      const ph = ch.phase || 0, side = P._legSide || 1;
      const leg = side > 0 ? ch.parts.rl : ch.parts.ll;
      if (leg) leg.rotation.x = leg.rotation.x * (1 - lw * 0.55) - lw * 0.2;   // stiff, dragging leg
      if (ch.body) {
        // favour the good side + dip when the bad leg takes the weight
        ch.body.rotation.z = (ch.body.rotation.z || 0) + Math.sin(ph) * side * lw * 0.14;
        ch.body.position.y -= Math.max(0, Math.sin(ph) * side) * lw * 0.07;
      }
    }
  });

  // ---- did an EXPLOSION kill us? (car blast / airstrike / missile) ----
  // All player blast damage in crashfx.js routes through ONE path with the
  // reason "caught in an explosion"; airstrikes/missiles share it. Match that
  // plus any obvious blast wording so the cinematic fires on every boom.
  function isExplosionCause(reason) {
    if (!reason) return false;
    const r = ("" + reason).toLowerCase();
    return r.indexOf("explos") >= 0 || r.indexOf("blast") >= 0 ||
           r.indexOf("airstrike") >= 0 || r.indexOf("missile") >= 0 ||
           r.indexOf("blown up") >= 0;
  }

  // ---- did a HARD IMPACT kill us? (a lethal fall, or a worded splat/crash) ----
  // physics.js routes fatal fall damage through cityHurtPlayer with reason "fell".
  // We also catch any obvious splat/impact wording so the gory crumple fires on
  // every ground-impact death, not just falls.
  function isImpactCause(reason) {
    if (!reason) return false;
    const r = ("" + reason).toLowerCase();
    return r.indexOf("fell") >= 0 || r.indexOf("fall") >= 0 ||
           r.indexOf("splat") >= 0 || r.indexOf("impact") >= 0 ||
           r.indexOf("pavement") >= 0;
  }

  // ---- are we under a ROOF (inside a building)? ----
  // Building floor/roof slabs are registered as CBZ.platforms (with `top`) AND
  // as CBZ.losBlockers meshes. Cheap test first: any platform whose footprint
  // covers us and whose top sits above head height = a ceiling overhead. Then a
  // single short up-ray against the LOS meshes as a backstop (covers roofs that
  // only exist as meshes). No per-frame cost — only runs once, on death.
  const _upRay = new THREE.Raycaster();
  const _upOrigin = new THREE.Vector3(), _upDir = new THREE.Vector3(0, 1, 0);
  function isIndoors(px, py, pz) {
    // overhead platform (floor/roof slab above the player)
    const plats = CBZ.platforms;
    if (plats) {
      const headY = py + 1.6;
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
        if (p.top == null) continue;
        if (p.top > headY && p.top < py + 28 &&
            px >= p.minX && px <= p.maxX && pz >= p.minZ && pz <= p.maxZ) return true;
      }
    }
    // backstop: short up-ray hits a roof/ceiling LOS mesh
    const blk = CBZ.losBlockers;
    if (blk && blk.length) {
      _upOrigin.set(px, py + 1.5, pz);
      _upRay.set(_upOrigin, _upDir); _upRay.far = 26;
      const hit = _upRay.intersectObjects(blk, false);
      if (hit.length) return true;
    }
    return false;
  }

  // ---- WASTED ----
  const _ragP = { x: 0, y: 0, z: 0 }, _ragD = { x: 0, y: 0, z: 0 };   // ragdoll scratch
  CBZ.cityKillPlayer = function (reason, imp) {
    const P = CBZ.player;
    if (P.dead) return;
    P.dead = true; P.hp = 0; dying = true;
    // cinematic third-person replay: orbit the body (camera.js reads cityCam)
    if (CBZ.cityCam) CBZ.cityCam.death = { t: 0, ang0: Math.random() * 6.28 };

    // CINEMATIC EXTERIOR DEATH CAM: killed by an explosion while INSIDE a
    // building → first cut to a street-level shot looking back at the building +
    // the blast, hold a beat, THEN the normal orbit + fade-to-WASTED. Outdoor or
    // non-explosion deaths skip this and keep the stock behaviour.
    let extBeat = 0;
    if (isExplosionCause(reason) && imp && imp.fromX != null &&
        CBZ.cityCam && CBZ.cityCam.death && CBZ.cityCam.beginExteriorDeathCam &&
        isIndoors(P.pos.x, P.pos.y, P.pos.z)) {
      extBeat = 1.5;
      CBZ.cityCam.beginExteriorDeathCam({
        bx: imp.fromX, bz: imp.fromZ, by: P.pos.y + 0.6,
        px: P.pos.x, pz: P.pos.z, dur: extBeat,
      });
    }
    if (CBZ.playerChar) CBZ.playerChar.group.visible = true;
    if (P.driving && CBZ.cityExitVehicle) { CBZ.cityExitVehicle(); }
    // A LETHAL FALL / hard impact reads as a brutal SPLAT, not a high arcing
    // fling: you've already hit the ground at speed, so the body crumples at the
    // spot in a spreading blood pool instead of launching back into the air.
    const splatDeath = isImpactCause(reason);
    // THE FLING MATCHES THE KILLING FORCE: cityHurtPlayer forwards the final
    // damage of the killing blow on the impact (a close shotgun blast lands
    // ~3x a pistol tap; a car at speed more still), so a big hit HURLS the
    // body and spins it harder while bleeding out is just a weak slump.
    const fK = imp && imp.dmg != null ? Math.max(0.55, Math.min(2.2, imp.dmg / 55)) : 1;
    // and it flings AWAY from the shooter (jittered), not in a random direction —
    // the body's flight line tells you where the shot came from.
    const a = Math.random() * 6.28;
    let fx = Math.cos(a), fz = Math.sin(a);
    if (!splatDeath && imp && imp.fromX != null) {
      const ddx = P.pos.x - imp.fromX, ddz = P.pos.z - imp.fromZ, dl = Math.hypot(ddx, ddz);
      if (dl > 0.01) { fx = ddx / dl + (Math.random() - 0.5) * 0.5; fz = ddz / dl + (Math.random() - 0.5) * 0.5; }
    }
    // VERLET RAGDOLL (city/ragdoll.js): YOUR body flops for real too — the rig
    // takes the killing impulse point-blank, limbs drape down stairs/off ledges,
    // and the death cam orbits the PELVIS as it goes (ragdoll.js feeds player.pos
    // from the pelvis point each frame; camera.js already orbits player.pos).
    // When it engages, P._death collapses to a landed sentinel so physics.js's
    // spin-fling never fights the points. Falls back to the legacy fling cleanly.
    let ragged = false;
    if (CBZ.cityRagdoll && CBZ.playerChar && CBZ.city && CBZ.city.playerActor) {
      let mag = splatDeath ? 3.5 : Math.min(18, 5 + (imp && imp.dmg != null ? imp.dmg : 25) * 0.14);
      if (isExplosionCause(reason)) mag = 24;             // a blast LIFTS you
      _ragD.x = fx; _ragD.y = 0; _ragD.z = fz;
      _ragP.x = P.pos.x - fx * 0.25;
      _ragP.y = P.pos.y + (imp && imp.headshot ? 2.05 : 1.25);
      _ragP.z = P.pos.z - fz * 0.25;
      ragged = CBZ.cityRagdoll(CBZ.city.playerActor, _ragP, _ragD, mag);
    }
    // spinning ragdoll fling (physics.js handles player._death in non-escape modes)
    P._death = ragged ? {
      // verlet owns the body — physics.js just idles in its landed branch
      vx: 0, vz: 0, vy: 0, spin: 0, spin2: 0, t: 0, landed: true, seed: Math.random() * 6.28,
    } : splatDeath ? {
      // low, flat crumple — barely leaves the ground, lands almost immediately
      vx: Math.cos(a) * (1.2 + Math.random() * 1.5), vz: Math.sin(a) * (1.2 + Math.random() * 1.5),
      vy: 1.0 + Math.random() * 1.0, spin: (Math.random() * 2 - 1) * 9, spin2: (Math.random() * 2 - 1) * 7,
      t: 0, landed: false, seed: Math.random() * 6.28,
    } : {
      vx: fx * (3 + Math.random() * 3) * fK, vz: fz * (3 + Math.random() * 3) * fK,
      vy: Math.min(11.5, (6 + Math.random() * 3) * (0.7 + 0.4 * fK)),
      spin: (Math.random() * 2 - 1) * 7 * (0.7 + 0.5 * fK),
      spin2: (Math.random() * 2 - 1) * 5 * (0.7 + 0.5 * fK),
      t: 0, landed: false, seed: Math.random() * 6.28,
    };
    if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
    if (CBZ.shake) CBZ.shake(splatDeath ? 1.9 : Math.min(1.8, 0.85 + 0.35 * fK));
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.doSlowmo) CBZ.doSlowmo(splatDeath ? 0.55 : 0.5);
    if (CBZ.doHitstop && splatDeath) CBZ.doHitstop(0.2);
    let gdir = imp && imp.fromX != null ? { x: P.pos.x - imp.fromX, z: P.pos.z - imp.fromZ } : null;
    if (splatDeath && CBZ.cityImpactSplat) {
      // the gory landing splat (blood pool + crimson sheet + gibs + bone-crunch),
      // seated right where the body hits. cityImpactSplat itself calls CBZ.gore.
      CBZ.cityImpactSplat(P.pos.x, P.pos.y + 0.6, P.pos.z, { player: true, speed: P._fellSpeed || 24, dir: gdir });
    } else if (CBZ.gore) {
      // the burst scales with the killing force too; a fatal headshot pops
      // (skull frags + instant wall paint), a fatal run-over drags a smear.
      const ranOver = ("" + (reason || "")).toLowerCase().indexOf("run over") >= 0;
      CBZ.gore(P.pos.x, P.pos.y + 1.0, P.pos.z, {
        dir: gdir, amount: Math.min(2, 1.05 + fK * 0.35), player: true,
        head: !!(imp && imp.headshot),
        smear: ranOver, smearLen: ranOver ? 3 + fK * 2.5 : 0,
      });
    }
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    const where = g.citySpawnPoint ? "home" : "the hospital";
    const killer = (g._cityKiller && (CBZ.now || 0) - (g._cityKillerT || 0) < 6) ? g._cityKiller : null;
    // a live, on-map NPC actor we can SPECTATE after the WASTED beat (only set when
    // an actor — not a string — dealt the blow). Held for the post-WASTED kill-cam.
    pendingSpecKiller = (g._cityKillerActor && g._cityKillerActor.pos && !g._cityKillerActor.culled &&
                         (CBZ.now || 0) - (g._cityKillerT || 0) < 6) ? g._cityKillerActor : null;
    // tell crowd.js to NOT park this killer off-map during the death beat (its
    // park-on-death sweep would otherwise banish a crowd-pool killer to (-4000),
    // leaving the kill-cam orbiting empty space). Lives until respawn.
    g._citySpecTarget = pendingSpecKiller;
    const line = killer ? ("Killed by " + killer)
      : splatDeath ? "You hit the pavement"
      : (reason ? ("You were " + reason) : "You died");
    // hold the WASTED title back ~1.8s so the ragdoll fling plays out first, THEN
    // it fades in — no jarring instant pop on the exact frame you die. When the
    // exterior cinematic plays, hold the title until the street shot has done its
    // job (the full beat + a touch of the orbit hand-off) so the reveal lands.
    pendingWasted = line + "  ·  respawning at " + where + "…";
    const titleDelay = extBeat > 0 ? (extBeat + 0.6) : 1.8;
    wastedT = titleDelay;
    g._cityKiller = null; g._cityKillerActor = null;
    respawnT = 4.6 + titleDelay;   // keep the title on screen its full duration after the delay
  };

  // ============================================================
  //  SPECTATE — Fortnite-style kill-cam. The WASTED screen plays UNCHANGED; only
  //  AFTER its full beat, if a real on-map actor killed you, the camera leaves your
  //  corpse and follows your KILLER (camera.js orbits cc.death.spectate) while a
  //  live card shows who they are, their health, and what they're doing. Auto-
  //  respawn after a beat, or SPACE / click to go now. String / explosion / fall
  //  deaths have no one to watch, so they keep the stock instant respawn.
  // ============================================================
  function buildSpecHUD() {
    if (specHUD) return;
    specHUD = document.createElement("div");
    specHUD.id = "citySpectate";
    specHUD.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:54;display:none;flex-direction:column;align-items:center;padding:0 0 30px;pointer-events:none;font-family:Fredoka,system-ui,sans-serif";
    const card = document.createElement("div");
    card.style.cssText = "min-width:300px;max-width:78vw;background:linear-gradient(180deg,rgba(10,13,20,.82),rgba(10,13,20,.93));border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px 20px 14px;box-shadow:0 8px 30px rgba(0,0,0,.55);text-align:center";
    const top = document.createElement("div");
    top.style.cssText = "font-size:12px;letter-spacing:3px;color:#9fb0c6;font-weight:600";
    top.textContent = "▶ SPECTATING YOUR KILLER";
    specName = document.createElement("div");
    specName.style.cssText = "font-size:26px;font-weight:700;color:#fff;margin:3px 0 9px;text-shadow:0 2px 8px rgba(0,0,0,.6)";
    const hpWrap = document.createElement("div");
    hpWrap.style.cssText = "position:relative;height:16px;border-radius:8px;background:rgba(255,255,255,.12);overflow:hidden;margin:0 auto;width:260px";
    specHpFill = document.createElement("i");
    specHpFill.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg,#37d67a,#7ed957);transition:width .18s ease,background .3s";
    specHpTxt = document.createElement("span");
    specHpTxt.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#06121a;text-shadow:0 1px 0 rgba(255,255,255,.25)";
    hpWrap.appendChild(specHpFill); hpWrap.appendChild(specHpTxt);
    specStateEl = document.createElement("div");
    specStateEl.style.cssText = "font-size:14px;color:#cdd6e2;margin-top:9px;font-weight:600";
    specFoot = document.createElement("div");
    specFoot.style.cssText = "font-size:12px;color:#8a93a3;margin-top:11px";
    card.appendChild(top); card.appendChild(specName); card.appendChild(hpWrap); card.appendChild(specStateEl); card.appendChild(specFoot);
    specHUD.appendChild(card);
    document.body.appendChild(specHUD);
  }
  function killerStateText(k) {
    if (!k) return "";
    if (k.dead) return "💀 Down — dropped right after they got you";
    if (k.rampage) return "🔫 On a rampage";
    if (k.state === "fight" || k.rage) return "🔫 In a firefight";
    if (k.state === "flee") return "🏃 On the run";
    if (k.kind === "cop") return "🚔 Back on patrol";
    if (k.armed) return "🔫 Armed & roaming";
    return "🚶 Walking it off";
  }
  // a killer is watchable while it still exists on the map: not culled, not parked
  // off-map in the crowd pool (crowd.js banishes promoted peds to (-4000,-4000) the
  // instant you die — g._citySpecTarget keeps YOUR killer exempt, but guard anyway),
  // and its rig still parented.
  function specValid(k) { return !!(k && k.pos && !k.culled && !k._parked && (!k.group || k.group.parent)); }
  function beginSpectate(k) {
    spectating = true; specKiller = k; specT = 0; specMax = 10;
    // cops carry only .hp (no .maxHp) — use their known full HP as the bar baseline
    // so a wounded cop's bar doesn't read 100% at, say, 85 HP.
    specKillerMax = k.maxHp || (k.kind === "cop" ? (k.swat ? 160 : 110) : (k.hp || 100));
    hideOverlay();                                   // retire the big WASTED title
    buildSpecHUD(); specHUD.style.display = "flex";
    // keep the death-cam alive and tell camera.js to orbit THEM, not your corpse.
    if (CBZ.cityCam) { CBZ.cityCam.death = CBZ.cityCam.death || { t: 0, ang0: Math.random() * 6.28 }; CBZ.cityCam.death.spectate = k; }
  }
  function endSpectate() {
    spectating = false; specKiller = null;
    if (specHUD) specHUD.style.display = "none";
    if (CBZ.cityCam && CBZ.cityCam.death) CBZ.cityCam.death.spectate = null;
    respawn();
  }
  function tickSpectate(dt) {
    specT += dt;
    const k = specKiller;
    if (!specValid(k)) { endSpectate(); return; }     // killer left the world → just respawn
    if (k.dead && specMax > specT + 3) specMax = specT + 3;   // they dropped → hold a beat, then go
    const hp = Math.max(0, k.hp || 0), ratio = Math.max(0, Math.min(1, hp / (specKillerMax || 1)));
    if (specName) specName.textContent = killerName(k) || "your killer";
    if (specHpFill) { specHpFill.style.width = (ratio * 100).toFixed(0) + "%"; specHpFill.style.background = ratio > 0.5 ? "linear-gradient(90deg,#37d67a,#7ed957)" : ratio > 0.22 ? "linear-gradient(90deg,#e7a93a,#ffd451)" : "linear-gradient(90deg,#c9202a,#ff5a4a)"; }
    if (specHpTxt) specHpTxt.textContent = Math.ceil(hp) + " HP";
    if (specStateEl) specStateEl.textContent = killerStateText(k);
    if (specFoot) specFoot.textContent = "Press [SPACE] or click to respawn  ·  auto in " + Math.max(0, Math.ceil(specMax - specT)) + "s";
    if (specT >= specMax) { endSpectate(); return; }
  }
  // SPACE / Enter / click ends the kill-cam early (Fortnite "respawn now")
  function specSkip(e) {
    if (!spectating || g.mode !== "city") return;
    if (e.type === "keydown") {
      const k = (e.key || "").toLowerCase(), c = e.code || "";
      if (k !== " " && k !== "spacebar" && k !== "enter" && c !== "Space" && c !== "Enter") return;
      e.preventDefault();
    }
    endSpectate();
  }
  addEventListener("keydown", specSkip);
  addEventListener("mousedown", specSkip);

  function respawn() {
    const P = CBZ.player;
    dying = false; hideOverlay();
    spectating = false; specKiller = null; pendingSpecKiller = null; g._citySpecTarget = null;
    if (specHUD) specHUD.style.display = "none";
    if (CBZ.cityCam) CBZ.cityCam.death = null;          // end the cinematic, back to FP
    // own a home? respawn there for free. Otherwise the ER patches you up for a bill.
    const A = CBZ.city.arena;
    let spot = A.spawn, atHome = false;
    if (g.citySpawnPoint) { spot = g.citySpawnPoint; atHome = true; }
    else if (A.lots) { const h = A.lots.find((l) => l.kind === "hospital" && l.building); if (h) spot = h.building.door; }
    let bill = 0;
    if (!atHome) { bill = Math.min(g.cash || 0, 250 + (g.wanted | 0) * 150); if (bill > 0) g.cash -= bill; }
    g._lastBill = bill;
    if (CBZ.cityWantedReset) CBZ.cityWantedReset();
    if (CBZ.clearCityCops) CBZ.clearCityCops();
    P.pos.set(spot.x, 0, spot.z);
    P.vy = 0; P.grounded = true; P.dead = false; P.maxHp = P.maxHp || 200; P.hp = P.maxHp; P.ko = 0; P.stun = 0; P._hurtT = 0;
    P._death = null; P._armor = Math.max(0, (P._armor || 0)); P._fellSpeed = 0; P._fallPeak = 0;
    g.hunger = Math.max(40, g.hunger || 0);
    if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
    CBZ.playerChar.group.visible = true;
    CBZ.playerChar.group.rotation.set(0, Math.random() * 6.28, 0);
    CBZ.playerChar.group.scale.y = 1;
    CBZ.playerChar.group.position.copy(P.pos);
    g.invuln = 2.5;       // brief grace after the ER
    if (CBZ.cam) CBZ.cam.pitch = 0.4;
    if (CBZ.setFPS) CBZ.setFPS(true);     // back to first-person after the death orbit
    if (CBZ.requestLock) CBZ.requestLock();
    if (CBZ.city) CBZ.city.note(atHome ? "🏡 You wake up at home, patched up." : ("🏥 City Hospital. Bill: $" + (g._lastBill || 0)), 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  CBZ.onUpdate(13, function (dt) {
    if (g.mode !== "city") return;
    if (g.invuln > 0) g.invuln = Math.max(0, g.invuln - dt);
    if (dying) {
      if (pendingWasted && wastedT > 0) { wastedT -= dt; if (wastedT <= 0) { showOverlay("WASTED", pendingWasted, "#c9202a"); pendingWasted = null; } }
      if (spectating) { tickSpectate(dt); return; }
      respawnT -= dt;
      if (respawnT <= 0) {
        // the WASTED beat is done — if a real person did this, SPECTATE them now
        // instead of snapping straight to the hospital. Nothing to watch → respawn.
        if (pendingSpecKiller && specValid(pendingSpecKiller)) { beginSpectate(pendingSpecKiller); pendingSpecKiller = null; return; }
        respawn();
      }
      return;
    }
    // out-of-combat health regen (GTA-style) so a flesh wound isn't a death
    const P = CBZ.player;
    if (!P.dead) {
      if (P._hurtT > 0) P._hurtT -= dt;
      else if (P.hp < (P.maxHp || 200)) { P.hp = Math.min(P.maxHp || 200, P.hp + 16 * dt); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    }
  });

  // ---- BUSTED fade (called by city/wanted.js before the jail handoff) ----
  CBZ.cityBustOverlay = function (lost, done) {
    showOverlay("BUSTED", "Cuffed and processed" + (lost > 0 ? "  ·  lost $" + lost : "") + "  ·  off to the cells…", "#5b8bff");
    let t = 0;
    const tick = function () {
      t += 0.05;
      if (t >= 2.6) { hideOverlay(); if (done) done(); return; }
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  };

  // ---- CINEMATIC EXTERIOR DEATH CAM (self-contained fallback) ----
  // The primary home for this is city/camera.js, but if that module isn't loaded
  // we install the exact same exterior-shot plumbing here so the feature still
  // works. systems/camera.js positions the death ORBIT at onAlways(50); this
  // override runs at 51 and, ONLY during the authored exterior beat
  // (CBZ.cityCam.death.ext), takes the camera over — pulling it out to the street
  // and looking back at the building + blast — without clipping into walls, then
  // releases cleanly to the orbit. Guarded so it never double-installs.
  (function installExteriorDeathCam() {
    const cc = CBZ.cityCam = CBZ.cityCam || { fp: false, death: null };
    if (cc._extHookInstalled) return;            // camera.js already owns it
    cc._extHookInstalled = true;

    const camera = CBZ.camera;
    if (!camera) return;
    const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
    const _eye = new THREE.Vector3(), _look = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const lerp = (a, b, t) => a + (b - a) * t;

    function unclip(ox, oy, oz, px, py, pz) {
      _ro.set(ox, oy, oz);
      _rd.set(px - ox, py - oy, pz - oz);
      let d = _rd.length();
      if (d < 0.001) return null;
      _rd.multiplyScalar(1 / d);
      let best = d;
      ray.set(_ro, _rd); ray.far = d;
      const blk = CBZ.losBlockers;
      if (blk && blk.length) { const hit = ray.intersectObjects(blk, false); if (hit.length && hit[0].distance < best) best = hit[0].distance; }
      const rad = 0.34, cs = CBZ.colliders;
      if (cs) {
        for (let i = 0; i < cs.length; i++) {
          const c = cs[i]; if (c.noCam) continue;
          const minX = c.minX - rad, maxX = c.maxX + rad, minZ = c.minZ - rad, maxZ = c.maxZ + rad;
          const minY = (c.y0 != null ? c.y0 : -1e4) - rad, maxY = (c.y1 != null ? c.y1 : 1e4) + rad;
          let t0 = 0, t1 = best, ta, tb, tmp; const dx = _rd.x, dy = _rd.y, dz = _rd.z;
          if (dx > -1e-8 && dx < 1e-8) { if (ox < minX || ox > maxX) continue; }
          else { ta = (minX - ox) / dx; tb = (maxX - ox) / dx; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
          if (dy > -1e-8 && dy < 1e-8) { if (oy < minY || oy > maxY) continue; }
          else { ta = (minY - oy) / dy; tb = (maxY - oy) / dy; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
          if (dz > -1e-8 && dz < 1e-8) { if (oz < minZ || oz > maxZ) continue; }
          else { ta = (minZ - oz) / dz; tb = (maxZ - oz) / dz; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
          if (t0 > 0.001 && t0 < best) best = t0;
        }
      }
      if (best < d) { const dd = Math.max(2.0, best - 0.4); _eye.set(ox + _rd.x * dd, oy + _rd.y * dd, oz + _rd.z * dd); return _eye; }
      _eye.set(px, py, pz); return _eye;
    }

    function resolveLot(x, z) {
      const A = CBZ.city && CBZ.city.arena;
      if (!A || !A.lots) return null;
      let best = null, bestD = 1e9;
      for (let i = 0; i < A.lots.length; i++) {
        const l = A.lots[i]; if (!l || !l.building) continue;
        const hw = (l.w || 8) / 2 + 1.5, hd = (l.d || 8) / 2 + 1.5;
        if (Math.abs(x - l.cx) <= hw && Math.abs(z - l.cz) <= hd) return l;
        const dx = x - l.cx, dz = z - l.cz, dd = dx * dx + dz * dz;
        if (dd < bestD) { bestD = dd; best = l; }
      }
      return bestD < 36 * 36 ? best : null;
    }

    cc.beginExteriorDeathCam = function (opts) {
      if (!cc.death) return;
      opts = opts || {};
      const bx = opts.bx != null ? opts.bx : (opts.px || 0);
      const bz = opts.bz != null ? opts.bz : (opts.pz || 0);
      const px = opts.px != null ? opts.px : bx;
      const pz = opts.pz != null ? opts.pz : bz;
      const by = opts.by != null ? opts.by : 1.4;
      let nx = 0, nz = 0;
      const lot = resolveLot(px, pz);
      if (lot && lot.building && lot.building.door && lot.building.door.nx != null) { nx = lot.building.door.nx; nz = lot.building.door.nz; }
      if (nx === 0 && nz === 0) {
        const A = CBZ.city && CBZ.city.arena;
        const ccx = (A && A.cx != null) ? A.cx : 0, ccz = (A && A.cz != null) ? A.cz : 0;
        nx = px - ccx; nz = pz - ccz; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      }
      const out = 13.5, side = 5.5, height = 3.4;
      const sx = -nz, sz = nx;
      const camX = bx + nx * out + sx * side, camZ = bz + nz * out + sz * side;
      cc.death.ext = {
        px: camX, py: height, pz: camZ,
        lx: bx, ly: by + 1.2, lz: bz,
        ox: bx, oy: by + 1.0, oz: bz,
        t: 0, dur: opts.dur != null ? opts.dur : 1.4, fov: 44, _bx: null,
      };
      cc.death.ang0 = Math.atan2(camZ - bz, camX - bx);
    };

    CBZ.onAlways(51, function (dt) {
      if (g.mode !== "city") return;
      if (!cc.death || !cc.death.ext) return;
      const ex = cc.death.ext;
      ex.t = (ex.t || 0) + dt;
      if (ex.t >= ex.dur) { cc.death.ext = null; return; }
      const clamped = unclip(ex.ox, ex.oy, ex.oz, ex.px, ex.py, ex.pz);
      let cx = ex.px, cy = ex.py, cz = ex.pz;
      if (clamped) { cx = clamped.x; cy = clamped.y; cz = clamped.z; }
      cy = Math.max(cy, 0.9);
      const k = easeOut(Math.min(1, ex.t / 0.45));
      const creep = Math.min(1, ex.t / ex.dur) * 0.6;
      _eye.set(lerp(cx, ex.ox, creep * 0.06), cy, lerp(cz, ex.oz, creep * 0.06));
      if (ex._bx == null) { ex._bx = camera.position.x; ex._by = camera.position.y; ex._bz = camera.position.z; }
      camera.position.set(lerp(ex._bx, _eye.x, k), lerp(ex._by, _eye.y, k), lerp(ex._bz, _eye.z, k));
      _look.set(ex.lx, ex.ly, ex.lz);
      camera.lookAt(_look);
      const wantFov = ex.fov || 46;
      if (Math.abs(camera.fov - wantFov) > 0.02) { camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 4.5); camera.updateProjectionMatrix(); }
    });
  })();
})();
