/* ============================================================
   systems/modecaps.js — THE MODE CAPABILITY BUS.

   OWNER DOCTRINE (2026-08-06): "in Gang City the RPGs blow up beautifully…
   the players and NPCs interact with walls and with assets in front of them
   like a chair or something to jump over… so prison mode, gun game and
   natural disaster can all use these elements from Gang City. Gang City
   becomes like this engine and this asset farm."

   THE FAULT THIS FILE EXISTS TO FIX. The engine's shared capabilities were
   authored inside city/ or wired to the CITY, and the way they were kept
   from crashing a half-built world was the same one line, 583 times:

       if (CBZ.game.mode === "city") …

   Most of those are honest: they guard access to city DATA (CBZ.cityCars,
   city.arena, the wanted ladder) and MUST stay. But a handful gate a shared
   ENGINE capability that has nothing to do with the city at all, and those
   are exactly the two the owner filmed:

     • systems/physics.js `characterTraversal` — jump/vault/mantle over a
       waist-high obstacle. Refused outside city at probeTraversal's first
       line. The prison's own mess tables and stools ALREADY register the
       y0/y1 + ref colliders the probe wants (world/cafeteria.js:320,342) —
       nothing was missing but permission.
     • systems/fpsmode.js's rocket `detonate()` — the ENTIRE fireball,
       damage, scorch and debris payload sat inside one `mode === "city"`
       block, so an RPG fired in the prison, in Gun Game or on the disaster
       island produced a camera shake and nothing else.

   THE MODE ENUM IS NOT A CAPABILITY CONTRACT (GPT handoff, 2026-07-31, said
   exactly this about the touch-driving enum). A mode is a SCENARIO — the
   Rome Test says the walking/fighting/vaulting body is the asset and the
   scenario is a costume. So a site that wants to ask "may I vault here?"
   should ask for the CAPABILITY, and a site that wants CBZ.cityCars should
   keep asking for the city. This file is where the first question is
   answered.

   ------------------------------------------------------------------
   THE FIVE-POINT BLOCK LAW COMPLIANCE (docs/claude/doctrine.md):
   1. ONE-LINE ADOPTION.  `CBZ.modeHas("traverse")` replaces the caller's
      existing `CBZ.game.mode === "city"`. Same shape, same length, no
      schema, no registration, no lifecycle.
   2. DEGRADE-SAFE.  Every consumer adopts as
        `CBZ.modeHas ? CBZ.modeHas("traverse") : CBZ.game.mode === "city"`
      and the master flag `MODE_CAPS_V1 = false` makes modeHas ITSELF answer
      `mode === "city"` for every capability the city already had — so the
      one-line revert restores today's behaviour at every migrated site at
      once, without touching them.
   3. >=3 REAL CONSUMERS MIGRATED IN THE SAME CHANGE — systems/physics.js
      (three gates: probeTraversal, npcStepLedge, the player's jump→vault),
      systems/fpsmode.js (the rocket detonation split), systems/
      actorcollide.js (prison guards + inmates now vault), and
      city/crashfx.js (blast damage reaches a non-city roster).
   4. NAMED IN CLAUDE.md — see the ENGINE, NOT A MODE section there.
   5. RATCHET COUNTER — `CBZ.modeCapsAudit().unrouted` counts the modes this
      block declares blast-capable whose PEOPLE a detonation cannot actually
      reach. It resolves the real route rather than reading the table, so a
      regression (a mode losing its damage funnel, a file dropping out of
      the load order) pushes it up. Pinned at 0 in tools/math-gate.mjs.
   ------------------------------------------------------------------

   WHAT THIS FILE DOES NOT DO: it owns no damage model, no FX, no roster and
   no kill rule. Every route below lands on the owner that already existed —
   CBZ.surv.hurt/hurtRadius, CBZ.gungame.hurt, CBZ.aiKill (the ONE prison
   kill choke point), CBZ.hurtPlayer (capture.js), CBZ.cityKillPed /
   cityHurtCop. It is a switchboard, not a second ledger. This is the line
   the GPT handoff drew: "do not call a city-only local damage helper from
   prison and declare parity" — so we do not; we call the PRISON's helper
   from the shared blast.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.modeHas) return;                       // idempotent (family guard idiom)

  CBZ.CONFIG = CBZ.CONFIG || {};
  // Master switch. false => modeHas() answers `mode === "city"` for every
  // capability the city already had and false for everything else, which is
  // byte-identical to the behaviour before this file existed. One-line revert.
  if (CBZ.CONFIG.MODE_CAPS_V1 == null) CBZ.CONFIG.MODE_CAPS_V1 = true;

  /* ---- THE TABLE -----------------------------------------------------------
     A capability is a shared ENGINE verb, never a world's data. Adding a mode
     is a row; granting a capability is a 1. The columns:

       traverse    systems/physics.js characterTraversal — jump becomes a
                   vault/mantle when registered solid geometry is in the run
                   line. Needs only CBZ.colliders (every mode has them) and a
                   character rig (every mode uses the same one).
       stepLedge   systems/physics.js npcStepLedge — a mover auto-climbs a
                   curb/sill-height ledge instead of grinding its face.
       blast       the shared explosive payload: fireball, smoke, shockwave,
                   ground scorch, shake and blast damage. Owned by
                   crashfx.js's cityExplosion, which draws with the pooled FX
                   system and reads no city record.
       blastActors whether CBZ.blastWorldActors must couple the blast to this
                   mode's own roster. CITY IS DELIBERATELY 0: city/crashfx's
                   applyBlastDamage already sweeps peds/cops/crowd/player, and
                   a second sweep would double-kill.

     A mode absent from this table has NO shared capabilities — which is the
     safe answer for a future mode nobody has thought about yet. -------- */
  const CAPS = {
    city: { traverse: 1, stepLedge: 1, blast: 1, blastActors: 0 },
    escape: { traverse: 1, stepLedge: 1, blast: 1, blastActors: 1 },
    gungame: { traverse: 1, stepLedge: 1, blast: 1, blastActors: 1 },
    survival: { traverse: 1, stepLedge: 1, blast: 1, blastActors: 1 },
  };
  CBZ.MODE_CAPS = CAPS;

  function curMode() { return (CBZ.game && CBZ.game.mode) || "escape"; }

  function modeHas(cap, mode) {
    const m = mode || curMode();
    // REVERT PATH: the city keeps exactly the capabilities it already had
    // (traverse/stepLedge/blast are 1 in its row, blastActors is 0), and every
    // other mode is refused — i.e. the `mode === "city"` line each consumer
    // used to write, restored from one place.
    if (CBZ.CONFIG.MODE_CAPS_V1 === false) return m === "city" && !!(CAPS.city[cap]);
    const row = CAPS[m];
    return !!(row && row[cap]);
  }
  CBZ.modeHas = modeHas;

  /* ---- THE ROSTER ----------------------------------------------------------
     "Who is alive in THIS mode." systems/fpsmode.js already writes this fan-out
     by hand for bullets (line ~1820: city -> cityPeds/cityCops, else ->
     guards/npcs) and city/crashfx.js's applyBlastDamage never wrote it at all,
     which is precisely why a bullet found a prison inmate and a rocket did not.
     Gun Game registers its bots into BOTH CBZ.npcs and CBZ.bots on purpose
     (modes/gungame.js:292-293), so the walk dedupes. ------------------------ */
  const rosterSeen = new Set();
  function pushLive(out, arr) {
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (!a || a.dead || a.escaped || rosterSeen.has(a)) continue;
      rosterSeen.add(a);
      out.push(a);
    }
  }
  // Position accessor shared with physics.js's traversal: city peds and survival
  // /gungame bots carry `.pos`; prison guards and inmates ARE their group.
  function actorPos(a) { return (a && (a.pos || (a.group && a.group.position))) || null; }
  CBZ.actorPos = CBZ.actorPos || actorPos;

  CBZ.worldActors = function (out) {
    out = out || [];
    out.length = 0;
    rosterSeen.clear();
    const m = curMode();
    if (m === "city") {
      pushLive(out, CBZ.cityPeds);
      pushLive(out, CBZ.cityCops);
      pushLive(out, CBZ.cityMedics);
    } else if (m === "survival") {
      pushLive(out, CBZ.bots);
    } else {
      // escape AND gungame: the prison cast plus any bot roster borrowing it.
      pushLive(out, CBZ.guards);
      pushLive(out, CBZ.npcs);
      pushLive(out, CBZ.bots);
    }
    rosterSeen.clear();                          // never hold references past the call
    return out;
  };

  /* ---- THE DAMAGE SWITCHBOARD ----------------------------------------------
     Route one hit to the funnel the MODE already owns. Nothing here decides
     what a hit costs or what a death looks like; it decides whose rules apply.
       survival  CBZ.surv.hurt      (modes/survival.js — bot hp, killBot, feed)
       gungame   CBZ.gungame.hurt   (modes/gungame.js — rung, respawn, feed)
       city      cityKillPed / cityHurtCop (city/peds.js, city/police.js)
       escape    the prison's own bus: hp down, then CBZ.aiKill — described in
                 entities/ai.js as "the ONE prison kill choice point", which is
                 what makes prison drops, gang standing and the case file fire.
     Returns true when a real owner took the hit. ---------------------------- */
  function hurtWorldActor(a, dmg, imp) {
    if (!a || a.dead || !(dmg > 0)) return false;
    imp = imp || {};
    const m = curMode();
    if (m === "survival") {
      if (!CBZ.surv || !CBZ.surv.hurt) return false;
      CBZ.surv.hurt(a, dmg, imp);
      return true;
    }
    if (m === "gungame") {
      if (!CBZ.gungame || !CBZ.gungame.hurt) return false;
      CBZ.gungame.hurt(a, dmg, imp);
      return true;
    }
    if (m === "city") {
      if (a.kind === "cop" && CBZ.cityHurtCop) { CBZ.cityHurtCop(a, dmg, imp); return true; }
      if (CBZ.cityKillPed) { CBZ.cityKillPed(a, imp, imp.cause || "explosion"); return true; }
      return false;
    }
    // ESCAPE (and any future scenario that reuses the prison cast).
    if (a.hp == null) a.hp = 100;
    a.hp -= dmg;
    if (a.hp > 0) {
      // a survivable blast still THROWS you — the prison's own knockback verb
      // (entities/ai.js), not a second physics implementation.
      if (CBZ.knockback && imp.fromX != null) {
        try { CBZ.knockback(a, imp.fromX, imp.fromZ, imp.force || 1.4); } catch (e) {}
      }
      return true;
    }
    a.hp = 0;
    if (CBZ.aiKill) { try { CBZ.aiKill(a, imp.by || null, { cause: imp.cause || "explosion" }); } catch (e) {} }
    else { a.dead = true; a.ko = 0; }
    return true;
  }
  CBZ.hurtWorldActor = hurtWorldActor;

  /* ---- THE PLAYER'S OWN FUNNEL --------------------------------------------
     Three modes, three different meanings for "the player ran out of health",
     and none of them is a shared one: the prison HAULS YOU TO YOUR CELL
     (systems/capture.js — you do not die in the yard), Gun Game respawns you
     on the rung ladder, survival eliminates you. City is handled inside
     applyBlastDamage and never reaches here. ------------------------------- */
  function hurtWorldPlayer(dmg, x, z, cause) {
    if (!(dmg > 0)) return false;
    const P = CBZ.player;
    if (!P || P.dead) return false;
    const m = curMode();
    if (m === "survival") {
      if (!CBZ.surv || !CBZ.surv.hurt) return false;
      CBZ.surv.hurt(CBZ.surv.playerActor || P, dmg, { fromX: x, fromZ: z, fling: 4, cause: cause });
      return true;
    }
    if (m === "gungame") {
      if (!CBZ.gungame || !CBZ.gungame.hurt) return false;
      CBZ.gungame.hurt(P, dmg, { fromX: x, fromZ: z, cause: cause });
      return true;
    }
    if (m === "escape") {
      if (!CBZ.hurtPlayer) return false;
      CBZ.hurtPlayer(dmg, x, z, { heat: 0, shake: 0.9, haulMsg: "CAUGHT IN A BLAST" });
      return true;
    }
    return false;
  }
  CBZ.hurtWorldPlayer = hurtWorldPlayer;

  /* ---- THE BLAST COUPLING --------------------------------------------------
     city/crashfx.js's applyBlastDamage owns the SHAPE of a blast — a lethal
     core at 0.55R, a linear 1->0 falloff on the player out to R — and it only
     ever swept the city's own lists. This is the same shape applied to whoever
     else is standing there, so an RPG in the mess hall kills the men in the
     mess hall. Deliberately a NO-OP in city so the two never double up.
     Returns the number of bodies the blast reached. ------------------------ */
  const blastScratch = [];
  function blastWorldActors(x, y, z, R, power, opts) {
    if (!modeHas("blastActors")) return 0;
    if (!(R > 0)) return 0;
    opts = opts || {};
    power = power > 0 ? power : 1;
    const cause = opts.cause || "explosion";
    const m = curMode();
    // SURVIVAL already owns a radius verb with knockback and the kill feed —
    // calling it is strictly better than re-deriving its falloff here.
    if (m === "survival") {
      if (!CBZ.surv || !CBZ.surv.hurtRadius) return 0;
      const before = CBZ.surv.liveBots ? CBZ.surv.liveBots() : 0;
      CBZ.surv.hurtRadius(x, z, R * 0.55, 1e6, {
        knockback: opts.force || 9, fling: opts.fling || 6, cause: cause,
      });
      const after = CBZ.surv.liveBots ? CBZ.surv.liveBots() : 0;
      return Math.max(0, before - after);
    }
    const LR = R * 0.55, LR2 = LR * LR;
    const list = CBZ.worldActors(blastScratch);
    let hitCount = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const p = actorPos(a);
      if (!p) continue;
      // a body already flat on the floor is not standing in the blast
      if (a.group && a.group.visible === false) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > LR2) continue;
      if (hurtWorldActor(a, 1e6, {
        fromX: x, fromZ: z, force: opts.force || 9, fling: opts.fling || 6,
        byPlayer: !!opts.byPlayer, by: opts.by || null, cause: cause,
      })) hitCount++;
    }
    blastScratch.length = 0;
    // the player takes the SAME linear falloff city/crashfx.js gives them
    const P = CBZ.player;
    if (P && !P.dead && P.pos) {
      const dx = P.pos.x - x, dz = P.pos.z - z, d2 = dx * dx + dz * dz;
      if (d2 < R * R) {
        const dmg = Math.round(85 * power * (1 - Math.sqrt(d2) / (R + 0.01)));
        if (dmg > 0 && hurtWorldPlayer(dmg, x, z, cause)) hitCount++;
      }
    }
    return hitCount;
  }
  CBZ.blastWorldActors = blastWorldActors;

  /* ---- RATCHET (Block Law rule 5) -----------------------------------------
     THE NUMBER THAT MAY ONLY GO DOWN: for every mode this block declares
     blast-capable, can a detonation actually reach that mode's PEOPLE? The
     answer RESOLVES the real route — the same functions blastWorldActors
     would call — instead of trusting the table above, because a table that
     describes itself measures nothing (doctrine.md: "an audit nobody has
     executed is not a measurement"). A file dropping out of index.html, a
     mode losing its damage funnel, or a new blast-capable row with no owner
     all push `unrouted` up. Pinned at 0 in tools/math-gate.mjs. --------- */
  function blastRouteFor(m) {
    if (!CAPS[m] || !CAPS[m].blast) return "n/a";
    if (m === "city") {
      return (CBZ.cityKillPed && CBZ.cityHurtCop && CBZ.cityHurtPlayer) ? "city/crashfx applyBlastDamage" : null;
    }
    if (m === "survival") {
      return (CBZ.surv && CBZ.surv.hurtRadius && CBZ.surv.hurt) ? "surv.hurtRadius" : null;
    }
    if (m === "gungame") {
      return (CBZ.gungame && CBZ.gungame.hurt) ? "gungame.hurt" : null;
    }
    if (m === "escape") {
      return (CBZ.aiKill && CBZ.hurtPlayer) ? "aiKill + capture.hurtPlayer" : null;
    }
    return null;
  }

  CBZ.modeCapsAudit = function () {
    const rows = {};
    let unrouted = 0, blastModes = 0;
    for (const m in CAPS) {
      if (!CAPS[m].blast) continue;
      blastModes++;
      const route = blastRouteFor(m);
      rows[m] = route || "UNROUTED";
      if (!route) unrouted++;
    }
    // second, cheaper number: capabilities declared shared whose OWNING system
    // is not loaded at all (traversal without physics.js is a promise nobody
    // can keep). Not the pinned ratchet, but it names the failure if one lands.
    let orphanCaps = 0;
    const traversalOwner = !!(CBZ.characterTraversal && CBZ.characterTraversal.start);
    const stepOwner = typeof CBZ.npcStepLedge === "function";
    const blastOwner = typeof CBZ.cityExplosion === "function";
    for (const m in CAPS) {
      const r = CAPS[m];
      if (r.traverse && !traversalOwner) orphanCaps++;
      if (r.stepLedge && !stepOwner) orphanCaps++;
      if (r.blast && !blastOwner) orphanCaps++;
    }
    return {
      unrouted: unrouted,          // <- THE RATCHET. Pin at 0. May only go down.
      orphanCaps: orphanCaps,
      blastModes: blastModes,
      routes: rows,
      flag: CBZ.CONFIG.MODE_CAPS_V1 !== false,
      mode: curMode(),
    };
  };
})();
