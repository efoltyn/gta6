/* ============================================================
   systems/childsafe.js — CHILDREN ARE NOT TARGETS.

   WHY THIS FILE EXISTS
   --------------------
   The character rewrite gives this city real children: babies, toddlers,
   pre-teens, teens — with their own growth curve, their own gait, their own
   bodies. The moment a child is a rig in the world, every gun, blast, car,
   knife, dog and shark in ~120k lines of existing code treats it exactly like
   an adult, because none of that code has ever had a reason to ask. That is
   not a content decision anybody made; it is a default nobody vetoed. This
   file is the veto.

   THE DOCTRINE (BLOCK LAW): "A block must REPLACE code the caller writes
   anyway." So this file adds NOTHING to any caller. It wraps the shared entry
   points that already exist — the damage bus, the kill bus, the gore/wound/
   ragdoll entries, the lock-on fire gate — the same way city/killfeed.js
   wraps cityKillPed/cityCrowdKill and the way five modules wrap cityExplosion.
   Not one damage site anywhere in the tree changes a character.

   THE TWO MECHANISMS
   ------------------
   1. WRAPS (the switchboard). Every shared bus that can hurt, kill, gib,
      ragdoll or lock onto an actor gets an outermost wrapper that asks
      CBZ.isProtectedActor(target) and, if the answer is yes, refuses and
      returns the caller's own "nothing happened" value. Marker-carrying and
      lazily retried, exactly like killfeed.js.

   2. THE HP SEAL (the thing a wrapper CANNOT do). CLAUDE.md's census counts
      "19-20 `.hp -=` damage sites" — today 32 by grep. Those sites reach into
      the victim record and subtract a number BY HAND; no wrapper on earth can
      intercept a property write. So for a protected actor — and ONLY for a
      protected actor — `hp` stops being a data field and becomes an accessor
      whose setter REFUSES DECREASES. `fpsmode.js:1817`'s `a.hp -= dmg`,
      `combat.js:362`'s `t.hp -= dmg`, `physics.js:406`'s fall damage,
      `predator.js:1822`'s bite tick and every future one still execute, still
      read back a sane number, and simply never move the needle. `if (hp <= 0)`
      is then never true, so the kill/KO branches those sites guard are dead
      code on a child WITHOUT this file having to know they exist.

      This is the whole reason the feature is expressible at all. Wrapping
      alone would have produced the worst possible state: a child at hp -40
      that the kill bus refuses to kill — visibly broken, permanently "about
      to die". The seal means a child's hp simply never falls.

      DEGRADE-SAFE + NEVER STALE: the setter re-asks isProtectedActor(self)
      on every refusal. Flip CHILD_INVULNERABLE off, or recycle the record
      into an adult (crowd pooling reuses ped objects), and the very next
      write goes straight through and the seal releases itself. Nothing is
      cached that can rot.

   WHAT A VETOED HIT FEELS LIKE
   ----------------------------
   Not a bullet sponge and not a no-op. Weapon damage to a child is refused
   and the child REACTS: alarmed, afraid, rage cleared (a child never fights
   back) and routed onto CBZ.cityFleeFrom — the same flee bus sizeup.js,
   police.js and scenedirector.js already use. No new panic system, no new
   state, no new HUD. The shot still cracks, the impact FX still land, the
   body still flinches through CBZ.body.hit (grapple.js) because none of that
   is damage — it is the world reacting, which is exactly what should happen.

   FLAG: CBZ.CONFIG.CHILD_INVULNERABLE (default true). One line reverts the
   entire file: every wrapper falls through to its original and every seal
   releases on its next write.

   NOTE FOR THE OWNER: the flag is declared HERE rather than in src/config.js
   because this agent was scoped to one file. The repo idiom
   (`if (CBZ.CONFIG.X == null) CBZ.CONFIG.X = default;`) tolerates a local
   declaration — killfeed.js, gore.js, ragdoll.js and damage.js all do it —
   but the canonical home for a shipping flag is src/config.js.

   RATCHET (BLOCK LAW rule 5): CBZ.childSafeAudit() returns the number of
   damage/target paths that can still reach a child and that this file cannot
   cover. It is a checked-in census (OPEN, below), it is a NUMBER so the math
   gate can pin it, and it may only ever go DOWN. Delete a line from OPEN in
   the same change that closes it — that is the whole ratchet.

   DETERMINISM: no RNG anywhere in this file (nothing here is generation-
   shaped). No per-frame allocation. The one always-updater is a queue drain
   that early-returns on an empty queue, which is its state ~100% of the time.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.isProtectedActor) return;                 // idempotent (house guard idiom)

  CBZ.CONFIG = CBZ.CONFIG || {};
  // THE one-line revert. false → every wrapper below calls straight through
  // and every hp seal releases itself on its next write, i.e. exactly the
  // pre-childsafe behaviour with no restart required.
  if (CBZ.CONFIG.CHILD_INVULNERABLE == null) CBZ.CONFIG.CHILD_INVULNERABLE = true;

  function on() { return CBZ.CONFIG.CHILD_INVULNERABLE !== false; }

  /* ===============================================================
     THE PREDICATE — CBZ.isProtectedActor(target) -> bool

     Answers "is this thing a child?" for a ped record, a crowd-agent record,
     a character rig, a raw THREE.Object3D, or a half-built object mid-spawn.
     It is called from inside a property setter on the damage path, so it has
     two absolute obligations:

       1. NEVER THROW. A weird target (a number, a frozen proxy, a detached
          mesh, null) must return false, not blow up a bullet.
       2. NEVER CACHE. A ped record gets recycled by crowd pooling; a rig gets
          re-skinned. A memoised "this is a child" would outlive the child.
          Every field read below is live.

     Checked in the order the character rewrite specified, because that is the
     order from cheapest+most authoritative to most speculative:
       t.child               the flat flag peds/rigs carry
       t.protected           an explicit opt-in any system can set
       t.ageYears < 18       the number (18 is character.js's CHILD_ADULT_AGE)
       t.char.child          a ped whose RIG knows but whose record does not
       t.userData.charBand   the Object3D stamp ("baby"|"toddler"|…)
       (walk up)             an Object3D that IS part of a character but is
                             not its root — a head mesh taking a raycast hit

     ...then the LEGACY markers. Children already exist in this game TODAY,
     before any of the above lands: city/family.js's yard kids and
     city/births.js's newborns are peds with `famRole`/`_role`/`job` set to
     "the kid" and a 0.62 scale. Protecting only the NEW representation would
     leave every child currently in the world unprotected, which is the exact
     failure mode this file exists to prevent.
     =============================================================== */
  const CHILD_ADULT_AGE = 18;                       // mirrors character.js
  const WALK_MAX = 6;                               // Object3D parent walk depth cap

  function bandIsChild(b) {
    // "adult" is the only non-child band; anything else that is a non-empty
    // STRING is a child band. The typeof guard matters: systems/gore.js
    // stores a NUMBER in `b.band` on blood puffs, and a blood puff must not
    // be mistaken for a toddler.
    return typeof b === "string" && b !== "" && b !== "adult";
  }

  function isProtectedActor(t) {
    if (!t || (typeof t !== "object" && typeof t !== "function")) return false;
    if (!on()) return false;
    try {
      if (t.child === true) return true;
      if (t.protected === true) return true;
      const ay = t.ageYears;
      if (typeof ay === "number" && isFinite(ay) && ay < CHILD_ADULT_AGE) return true;
      if (bandIsChild(t.band)) return true;
      const ch = t.char;
      if (ch && typeof ch === "object") {
        if (ch.child === true) return true;
        if (bandIsChild(ch.band)) return true;
        const pr = ch.profile;
        if (pr && typeof pr === "object" && (pr.child === true || bandIsChild(pr.band))) return true;
      }
      const pr2 = t.profile;
      if (pr2 && typeof pr2 === "object" && (pr2.child === true || bandIsChild(pr2.band))) return true;
      const ud = t.userData;
      if (ud && typeof ud === "object") {
        if (ud.child === true) return true;
        if (bandIsChild(ud.charBand)) return true;
        const ua = ud.charAge;
        if (typeof ua === "number" && isFinite(ua) && ua < CHILD_ADULT_AGE) return true;
      }
      // LEGACY (family.js / births.js): the children this game already has.
      if (t.famRole === "the kid" || t._role === "kid" || t.job === "the kid") return true;
      // A ped's rig root carries the stamp even when the ped record does not.
      const grp = t.group;
      if (grp && grp !== t && grp.userData && typeof grp.userData === "object") {
        if (bandIsChild(grp.userData.charBand)) return true;
        const ga = grp.userData.charAge;
        if (typeof ga === "number" && isFinite(ga) && ga < CHILD_ADULT_AGE) return true;
      }
      // OBJECT3D WALK-UP: a raycast hands you the mesh it struck, not the
      // character root. Climb to find the stamp. Depth-capped so a pathological
      // scene graph can never turn a bullet into a hang, and `isObject3D`-gated
      // so a plain record with a `.parent` field (very common in this tree —
      // households, companies, gangs all have parents) is never walked.
      if (t.isObject3D === true) {
        let p = t.parent, n = 0;
        while (p && n++ < WALK_MAX) {
          const pu = p.userData;
          if (pu && typeof pu === "object") {
            if (pu.child === true) return true;
            if (bandIsChild(pu.charBand)) return true;
            const pa = pu.charAge;
            if (typeof pa === "number" && isFinite(pa) && pa < CHILD_ADULT_AGE) return true;
          }
          p = p.parent;
        }
      }
    } catch (e) { return false; }                   // obligation 1: never throw
    return false;
  }
  CBZ.isProtectedActor = isProtectedActor;

  /* ===============================================================
     THE HP SEAL — the only answer to a raw `.hp -=`.

     Replaces the plain `hp` data property with an accessor whose setter
     refuses any DECREASE while the record is still a protected actor. Writes
     that RAISE hp (heals, `hp = maxHp` on spawn/reuse, difficulty rescaling)
     pass through untouched, so nothing that legitimately manages a child's
     health breaks.

     Cost: one property descriptor per child, installed once. Zero per-frame
     work. There is no shadow table, no mirrored health, no tick — the record
     remains the single source of truth for its own hp, which is precisely the
     "parallel bookkeeping" trap the BLOCK LAW says kills a block.
     =============================================================== */
  let sealed = 0, vetoedWrites = 0, vetoedCalls = 0;

  function seal(t) {
    if (!t || typeof t !== "object") return false;
    if (t._csSealed) return true;
    let v = t.hp;
    if (typeof v !== "number") return false;        // nothing to seal yet
    try {
      Object.defineProperty(t, "hp", {
        configurable: true,                         // releasable; never a one-way door
        enumerable: true,                           // `hp` was enumerable — savegames/Object.assign must still see it
        get: function () { return v; },
        set: function (nv) {
          // Not a decrease (heal, respawn, rescale) → always write through.
          if (typeof nv !== "number" || !isFinite(nv) || !(nv < v)) { v = nv; return; }
          // A decrease. Re-ask, live: flag off, or no longer a child (record
          // recycled by the crowd pool), and the seal gets out of the way for
          // good rather than quietly protecting an adult forever.
          if (!on() || !isProtectedActor(t)) {
            try { delete t.hp; } catch (e) {}
            t.hp = nv;
            try { Object.defineProperty(t, "_csSealed", { value: false, configurable: true, enumerable: false, writable: true }); } catch (e) {}
            sealed = Math.max(0, sealed - 1);
            return;
          }
          vetoedWrites++;                           // refused: a child's hp does not fall
        },
      });
      // non-enumerable so no savegame / Object.assign / for-in ever carries it
      Object.defineProperty(t, "_csSealed", { value: true, configurable: true, enumerable: false, writable: true });
      sealed++;
      return true;
    } catch (e) { return false; }                   // frozen/sealed/proxied record: give up quietly
  }

  // ONE-LINE ADOPTION (BLOCK LAW rule 1) for anything that mints a person
  // outside CBZ.cityMakePed — character.js, a future crowd promotion, a
  // mission spawner. Degrade-safe by construction: it is a no-op on an adult
  // and a no-op if this file never loaded (`CBZ.childSafeSeal && ...`).
  CBZ.childSafeSeal = function (t) { return isProtectedActor(t) ? seal(t) : false; };

  /* ===============================================================
     THE REACTION — a vetoed hit must not feel like a bug.

     Uses the flee bus that already exists (peds.js's CBZ.cityFleeFrom, the
     one sizeup.js/police.js/scenedirector.js all call) plus the plain
     alarmed/fear/rage fields every ped AI in this game already reads. NOTHING
     new: no panic system of our own, no HUD, no toast.

     Throttled per-actor because a full-auto burst would otherwise re-path the
     child 10x a second and it would visibly stutter instead of running.
     =============================================================== */
  const REACT_MS = 550;
  function react(t, fromX, fromZ) {
    if (!t || typeof t !== "object") return;
    try {
      const now = (CBZ.now || 0);
      if (now - (t._csReactT || -1e9) < REACT_MS) return;
      t._csReactT = now;
      t.alarmed = Math.max(t.alarmed || 0, 7);
      t.fear = Math.min(10, (t.fear || 0) + 5);
      t.rage = null;                                // a child never squares up
      t.poseCower = Math.max(t.poseCower || 0, 0.9);
      const p = t.pos;
      const fx = fromX != null ? fromX : (p ? p.x : 0);
      const fz = fromZ != null ? fromZ : (p ? p.z : 0);
      if (p && CBZ.cityFleeFrom) CBZ.cityFleeFrom(t, fx, fz);
      else if (p && CBZ.cityPanic) CBZ.cityPanic(p.x, p.z, 1.2, null);
    } catch (e) {}
  }

  // pull an attacker position out of whatever shape the caller passed
  function srcX(o) { if (!o || typeof o !== "object") return null; if (o.fromX != null) return o.fromX; if (o.x != null && o.z != null) return o.x; return null; }
  function srcZ(o) { if (!o || typeof o !== "object") return null; if (o.fromZ != null) return o.fromZ; if (o.x != null && o.z != null) return o.z; return null; }

  // the veto: refuse, seal (so the raw-hp sites are covered from here on),
  // make the child run, count it.
  function veto(t, src) {
    vetoedCalls++;
    seal(t);
    react(t, srcX(src), srcZ(src));
  }

  /* ===============================================================
     WRAPPING — killfeed.js's idiom, verbatim, plus CLAUDE.md's hard rule:
     "copy EVERY *Wrapped marker forward when wrapping".

     carry() is city/schedule.js's helper (`for (const k in prev) w[k] = prev[k]`)
     — it copies every sibling module's idempotence marker AND every attached
     namespace member (CBZ.damage.impact / .type / .resist / .pool / .audit)
     onto the new function, so nobody's guard and nobody's sub-API is lost by
     us standing in front of them. Dropping one marker re-opens a
     double-wrap, which is the bug class that produced the "explosion fires
     twice" family.
     =============================================================== */
  function carry(w, prev) {
    for (const k in prev) { try { w[k] = prev[k]; } catch (e) {} }
    return w;
  }
  function wrapOnce(name, mark, make) {
    const orig = CBZ[name];
    if (typeof orig !== "function") return false;   // not loaded yet → retry
    if (orig[mark]) return true;                    // already ours (idempotent)
    let w;
    try { w = make(orig); } catch (e) { return false; }
    carry(w, orig);
    w[mark] = true;
    w._csOrig = orig;
    CBZ[name] = w;
    return true;
  }
  // a wrap on a member of a namespace object (CBZ.body.hit style)
  function wrapMember(objName, key, mark, make) {
    const o = CBZ[objName];
    if (!o || typeof o[key] !== "function") return false;
    const orig = o[key];
    if (orig[mark]) return true;
    let w;
    try { w = make(orig); } catch (e) { return false; }
    carry(w, orig);
    w[mark] = true;
    o[key] = w;
    return true;
  }

  /* --------------------------------------------------------------
     1. THE DAMAGE BUS — systems/damage.js's CBZ.damage(t, amt, opts).
     THE highest-value wrap in the file: one veto here covers every caller
     that has migrated onto the bus (crashfx's blast damage, demolition,
     explosives, crashdeform, disasters, structdamage) and every future one,
     with no per-weapon knowledge. Returns 0 = "no damage applied", which is
     the bus's own documented contract, so callers that branch on the return
     value read a truthful zero rather than a lie.
     -------------------------------------------------------------- */
  function hookDamage() {
    return wrapOnce("damage", "_csWrapped", function (orig) {
      return function (target, amount, opts) {
        if (on() && isProtectedActor(target)) {
          veto(target, opts || (target && target.pos));
          return 0;
        }
        return orig.apply(this, arguments);
      };
    });
  }

  /* --------------------------------------------------------------
     2. THE KILL BUS — city/peds.js's cityKillPed, wrapped by ~15 modules
     already. We want to be OUTERMOST (load last), so our refusal happens
     before killfeed logs a line, before gore takes its kill-context tap,
     before social/loyalty/inheritance/approval score a death. Every one of
     those wrappers gates on "did the ped actually die?" (`!wasDead && ped.dead`),
     and a vetoed ped never flips `dead`, so they all correctly no-op even if
     one of them ends up outside us.

     cityKillPed returns undefined on its own no-op path, so returning
     undefined here is byte-identical to "this ped was already dead".
     -------------------------------------------------------------- */
  function hookKillPed() {
    return wrapOnce("cityKillPed", "_csWrapped", function (orig) {
      return function (ped, imp, cause) {
        if (on() && isProtectedActor(ped)) { veto(ped, imp); return undefined; }
        return orig.apply(this, arguments);
      };
    });
  }

  /* --------------------------------------------------------------
     3. NON-LETHAL TAKEDOWN — cityKOPed (taser, light melee, restraint).
     A stun weapon is still a weapon pointed at a child. Vetoed. Note that
     with the hp seal in place combat.js's `t.hp = 1; cityKOPed(...)` branch
     is already unreachable on a child (hp never hits 0), so this is
     belt-and-braces for the direct callers (fpsmode's taser branch).
     -------------------------------------------------------------- */
  function hookKO() {
    return wrapOnce("cityKOPed", "_csWrapped", function (orig) {
      return function (ped, fromX, fromZ) {
        if (on() && isProtectedActor(ped)) { veto(ped, { fromX: fromX, fromZ: fromZ }); return undefined; }
        return orig.apply(this, arguments);
      };
    });
  }

  /* --------------------------------------------------------------
     4. THE AMBIENT CROWD — crowd.js's cityCrowdKill(i, opts).

     HONEST LIMITATION, and it is the biggest one in this file: the instanced
     crowd is typed arrays addressed by INDEX. There is no per-agent record,
     no age, no band, and no public read that exposes one. If the character
     work puts children into the ambient crowd, THIS FILE CANNOT SEE THEM.

     So we wrap the entry and consult, in order, two optional seams that the
     crowd could grow in a one-line change:
        CBZ.cityCrowdChild(i)   -> bool          (the cheap, allocation-free one)
        CBZ.cityCrowdAgent(i)   -> record        (already exists; today it
                                                  returns no age field)
     Until one of them answers, this wrapper is a no-op and the path stays on
     the OPEN census below. That is the truthful state, not a covered one.

     cityCrowdKill returns false for "no kill happened" — its documented
     "already dead / not shootable" value — so the veto is indistinguishable
     from a miss to every caller (cityCrowdCircleKill counts it correctly).
     -------------------------------------------------------------- */
  function crowdIsChild(i) {
    try {
      if (typeof CBZ.cityCrowdChild === "function") return !!CBZ.cityCrowdChild(i);
      if (typeof CBZ.cityCrowdAgent === "function") return isProtectedActor(CBZ.cityCrowdAgent(i));
    } catch (e) {}
    return false;
  }
  function hookCrowdKill() {
    return wrapOnce("cityCrowdKill", "_csWrapped", function (orig) {
      return function (i, opts) {
        if (on() && crowdIsChild(i)) { vetoedCalls++; return false; }
        return orig.apply(this, arguments);
      };
    });
  }

  /* --------------------------------------------------------------
     5. GORE / WOUNDS / RAGDOLL — a child is never gibbed, never carries a
     bullet wound or a bite print, never becomes a corpse physics body.

     These are all actor-first signatures, so the veto is exact:
        CBZ.bodyWound(actor, wp, opts)      systems/wounds.js
        CBZ.bodyBite(actor, wp, opts)       systems/wounds.js
        CBZ.goreSever(actor, key, opts)     systems/gore.js  (dismemberment)
        CBZ.cityRagdoll(target, …)          city/ragdoll.js  (death physics)
        CBZ.cityCorpseHit(target, …)        city/ragdoll.js  (shooting a body)
        CBZ.ragdollPin(target, opts)        city/ragdoll.js  (held in jaws)

     CBZ.gore(x,y,z,opts) is POSITIONAL — it has no actor argument; it learns
     its victim from gore.js's own cityKillPed tap. Since a child never
     reaches cityKillPed, that tap can never hold one. We still wrap it to
     honour an explicit opts.actor/ped/victim/target if a caller passes one.
     -------------------------------------------------------------- */
  function firstArgVeto(name) {
    return wrapOnce(name, "_csWrapped", function (orig) {
      return function (a) {
        if (on() && isProtectedActor(a)) { vetoedCalls++; return false; }
        return orig.apply(this, arguments);
      };
    });
  }
  function hookGore() {
    let ok = true;
    ok = firstArgVeto("bodyWound") && ok;
    ok = firstArgVeto("bodyBite") && ok;
    ok = firstArgVeto("goreSever") && ok;
    ok = firstArgVeto("cityRagdoll") && ok;
    ok = firstArgVeto("cityCorpseHit") && ok;
    ok = firstArgVeto("ragdollPin") && ok;
    ok = wrapOnce("gore", "_csWrapped", function (orig) {
      return function (x, y, z, opts) {
        if (on() && opts && typeof opts === "object") {
          const a = opts.actor || opts.ped || opts.victim || opts.target;
          if (a && isProtectedActor(a)) { vetoedCalls++; return undefined; }
        }
        return orig.apply(this, arguments);
      };
    }) && ok;
    return ok;
  }

  /* --------------------------------------------------------------
     6. THE KILL FEED — a child never appears in a death line.

     Belt-and-braces: children never die, so nothing should ever reach here.
     But cityLogDeath/cityKillFeed take a NAME STRING, not an actor, so if
     some future path logs a child's death directly, the name alone tells us
     nothing. We can only veto when the caller passes the record along in
     opts (opts.ped / opts.victim / opts.actor). Called out as a residual on
     the census: a name-only death line for a child is not detectable.
     -------------------------------------------------------------- */
  function feedVictim(opts) {
    if (!opts || typeof opts !== "object") return null;
    return opts.ped || opts.victim || opts.actor || opts.target || null;
  }
  function hookFeed() {
    let ok = wrapOnce("cityLogDeath", "_csWrapped", function (orig) {
      return function (name, cause, opts) {
        if (on() && isProtectedActor(feedVictim(opts))) { vetoedCalls++; return null; }
        return orig.apply(this, arguments);
      };
    });
    ok = wrapOnce("cityKillFeed", "_csWrapped", function (orig) {
      return function (by, name, cause, opts) {
        if (on() && isProtectedActor(feedVictim(opts))) { vetoedCalls++; return null; }
        return orig.apply(this, arguments);
      };
    }) && ok;
    return ok;
  }

  /* --------------------------------------------------------------
     7. LOCK-ON — systems/lockon.js.

     FINDING FROM THE CENSUS: lockon.js's gatherCandidates() only ever
     enumerates VEHICLES and AIRCRAFT (cityCars, cityMilitaryVehicles, the
     *EnumTargets craft registries). It has never had a ped in its candidate
     pool, so a child cannot be acquired today and CBZ.lockonCandidateScreen
     (touch aim-assist) cannot magnetise onto one either.

     These two wraps are therefore defence-in-depth against a future change
     that adds infantry lock: if the red lock resolves to a protected actor,
     the fire gate reports "no lock" (null), which is lockon's own documented
     "system on, no red lock → straight flight" value. The weapon still
     fires; it just refuses to be guided onto a child.
     -------------------------------------------------------------- */
  function lockedIsChild() {
    try {
      if (typeof CBZ.lockonTarget !== "function") return false;
      const t = CBZ.lockonTarget();
      return !!(t && isProtectedActor(t.obj));
    } catch (e) { return false; }
  }
  function hookLockon() {
    let ok = wrapOnce("lockonFireTarget", "_csWrapped", function (orig) {
      return function () {
        if (on() && lockedIsChild()) { vetoedCalls++; return null; }
        return orig.apply(this, arguments);
      };
    });
    ok = wrapOnce("lockonMissileSeek", "_csWrapped", function (orig) {
      return function () {
        if (on() && lockedIsChild()) { vetoedCalls++; return null; }
        return orig.apply(this, arguments);
      };
    }) && ok;
    return ok;
  }

  /* --------------------------------------------------------------
     8. PREDATORS — systems/predator.js.

     predatorSeize(attacker, victim) is the grab that ends in `v.dead = true`
     when cityKillPed is unavailable (predator.js:1079), i.e. it is a death
     path that can bypass the kill bus. predatorHunt(hunter, target) is the
     stalking FSM that commits to that grab. Refusing BOTH means no shark, no
     big cat and no future human grappler ever selects a child as prey — the
     encounter simply never starts, which is the right read: a predator that
     circled a child and then gave up would be worse than one that never
     looked. Both return false = "not engaged", their own no-op value.
     -------------------------------------------------------------- */
  function hookPredator() {
    let ok = wrapOnce("predatorSeize", "_csWrapped", function (orig) {
      return function (attacker, victim) {
        if (on() && isProtectedActor(victim)) { vetoedCalls++; return false; }
        return orig.apply(this, arguments);
      };
    });
    ok = wrapOnce("predatorHunt", "_csWrapped", function (orig) {
      return function (hunter, target) {
        if (on() && isProtectedActor(target)) { vetoedCalls++; return false; }
        return orig.apply(this, arguments);
      };
    }) && ok;
    return ok;
  }

  /* --------------------------------------------------------------
     9. THE PED FACTORY — city/peds.js's CBZ.cityMakePed is the ONE place a
     person is minted (30+ modules call it; nobody hoists it to a load-time
     const, so wrapping the namespace slot catches all of them).

     Why we cannot simply seal inside the wrapper: births.js mints its baby
     and THEN stamps `kid.famRole = "the kid"` and `kid.hp = 40`; family.js
     does the same. At return time the record is not yet identifiably a
     child. So a fresh ped goes on a small pending queue and is examined once,
     on the next always-tick, by which time every post-factory stamp has
     landed. The queue drains to empty and stays empty — this is a one-shot
     deferred check per person, NOT a scan and NOT an AI loop.
     -------------------------------------------------------------- */
  const pending = [];
  const PEND_CAP = 4096;                            // a runaway spawner can never grow this unbounded
  function hookFactory() {
    return wrapOnce("cityMakePed", "_csWrapped", function (orig) {
      return function () {
        const ped = orig.apply(this, arguments);
        if (ped && typeof ped === "object") {
          if (isProtectedActor(ped)) seal(ped);     // already identifiable → seal now
          else if (pending.length < PEND_CAP) pending.push(ped);
        }
        return ped;
      };
    });
  }

  // Drain + the ONE-TIME sweep of anyone who predates this file (a hot reload,
  // or a future load-order change that puts a spawner above us). After that
  // the factory wrap owns every new person, so no repeat sweep is needed: a
  // world rebuild re-mints every ped through the factory.
  let swept = false;
  // guarded: config.js owns onAlways and loads first, but a load-order shuffle
  // must degrade to "the factory wrap still seals every new child", not a throw.
  if (typeof CBZ.onAlways === "function") CBZ.onAlways(46.4, function () {
    if (!swept && CBZ.cityPeds && CBZ.cityPeds.length) {
      swept = true;
      const L = CBZ.cityPeds;
      for (let i = 0; i < L.length; i++) { const p = L[i]; if (p && isProtectedActor(p)) seal(p); }
    }
    if (!pending.length) return;                    // the state this tick is in ~always
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      if (p && isProtectedActor(p)) seal(p);
    }
    pending.length = 0;
  });

  /* ===============================================================
     INSTALL — killfeed.js's lazy-retry pattern, verbatim.

     Most of these buses load before us (recommended tag position: last,
     immediately before core/loop.js) so every hook lands on the first try.
     But systems/damage.js currently has NO script tag in index.html at all,
     and load order is exactly the thing that gets reshuffled. Retrying for
     10s means a bus that appears late still gets wrapped, and a bus that
     never appears costs one failed lookup per attempt and nothing else — the
     silent-dead-hook bug class killfeed.js's header warns about.
     =============================================================== */
  const HOOKS = [hookDamage, hookKillPed, hookKO, hookCrowdKill, hookGore,
                 hookFeed, hookLockon, hookPredator, hookFactory];
  const landed = new Array(HOOKS.length).fill(false);
  function installAll() {
    let all = true;
    for (let i = 0; i < HOOKS.length; i++) {
      if (landed[i]) continue;
      let ok = false;
      try { ok = !!HOOKS[i](); } catch (e) { ok = false; }
      landed[i] = ok;
      if (!ok) all = false;
    }
    return all;
  }
  if (!installAll()) {
    let tries = 0;
    const iv = setInterval(function () { if (installAll() || ++tries > 40) clearInterval(iv); }, 250);
  }

  /* ===============================================================
     THE RATCHET (BLOCK LAW rule 5) — CBZ.childSafeAudit()

     Returns a NUMBER: how many damage/kill/target paths can still reach a
     child and CANNOT be covered from this file. Pin it in the math gate's
     PASS block. It may only ever go DOWN. Close one → delete its line from
     OPEN in the same commit. That is the entire mechanism.

     A path is on this list only if it is genuinely UNREACHABLE from here —
     not "we didn't get to it". Everything the wraps + the hp seal cover is
     deliberately absent: fpsmode.js:1817, combat.js:362, combat.js:1010,
     restrain.js:316, police.js:3006, peds.js:1862, interact.js:180,
     gangs.js:1167, physics.js:406, creature_combat.js:575, predator.js:947,
     predator.js:1822, predator.js:1972 and every future `.hp -=` on a ped
     are all closed BY THE SEAL, which is why the seal exists.

     Also deliberately absent: every `.hp -=` in jail/survival/boxing/arena
     (systems/combat.js:209, modes/survival.js:214/217, games/boxing.js:184/187,
     entities/ai.js:3191-3192, fpsmode.js:1854) and every one on a non-person
     (vehicles, aircraft, choppers, pieces, resource nodes, wildlife records).
     Those are not child paths — counting them would inflate the number with
     work that can never be done, and a ratchet you cannot move is a lie.
     =============================================================== */
  const OPEN = [
    // --- the ambient instanced crowd: index-addressed, no age signal ---
    "src/city/crowd.js:2083 cityCrowdKill(i) — agents are typed-array indices; " +
      "no per-agent age/band exists and no read exposes one. CLOSE BY: exporting " +
      "CBZ.cityCrowdChild(i) (or an age field on cityCrowdAgent(i)) — the wrapper " +
      "in this file already consults both.",
    "src/city/crowd.js:2070 cityCrowdRayHit — the bullet TARGET picker for the " +
      "ambient crowd. A crowd child is a hittable sphere. CLOSE BY: the same " +
      "cityCrowdChild(i) seam, consulted in shootable(i).",
    "src/city/crowd.js:2103 cityCrowdCircleKill — car-mowing / blast sweep over " +
      "the crowd. Routes through cityCrowdKill (so it inherits any fix) but is " +
      "its own public entry and is listed so the census is complete.",
    // --- multiplayer: the host is authoritative, a local veto is a desync ---
    "src/net/networld.js:308 a.hp -= m.dmg — remote damage applied to a net actor " +
      "record that may never have passed through CBZ.cityMakePed, so the hp seal " +
      "was never installed. CLOSE BY: calling CBZ.childSafeSeal(a) where " +
      "net/netactors.js mints a puppet.",
    "src/net/networld.js:489,540 P.dead = true — the host's snapshot flips death " +
      "directly, by design (\"the host's word is law\"). A client-side veto here " +
      "would desync. CLOSE BY: enforcing this on the HOST's damage path, not the " +
      "client's.",
    // --- targeting, not damage, but the owner asked for non-targetable ---
    "src/systems/fpsmode.js:1400 findActorHit — module-private (not on CBZ), so " +
      "it cannot be wrapped. A child stays an acquirable bullet target and still " +
      "receives head/body aim-assist radii; the DAMAGE is refused (the seal) but " +
      "the crosshair still snaps. CLOSE BY: one guarded line in its scan(): " +
      "`if (CBZ.isProtectedActor && CBZ.isProtectedActor(a)) continue;`",
    // --- the feed's name-only entry ---
    "src/city/killfeed.js:112 cityLogDeath(name, cause) — takes a NAME STRING. A " +
      "caller that logs a child's death without passing the record cannot be " +
      "detected. Unreachable in practice (children never die) but not provably " +
      "closed. CLOSE BY: threading the victim record through opts at the two " +
      "sites that log by name alone.",
  ];

  // Closed IN this change, kept as prose so the next agent can see what a
  // closure looks like without a git archaeology session (damage.js's idiom).
  const CLOSED = [
    "CBZ.damage — the whole migrated bus, one wrap",
    "CBZ.cityKillPed — every kill site in the tree (runover, blast, melee, fall, gunfire)",
    "CBZ.cityKOPed — taser / light-melee takedown",
    "32x raw `.hp -=` on ped records — the hp seal, no per-site change",
    "CBZ.bodyWound / bodyBite / goreSever — wounds + dismemberment",
    "CBZ.cityRagdoll / cityCorpseHit / ragdollPin — corpse physics",
    "CBZ.gore(opts.actor) — explicit-victim gore",
    "CBZ.lockonFireTarget / lockonMissileSeek — guided-weapon lock",
    "CBZ.predatorHunt / predatorSeize — the stalk and the grab",
  ];

  // THE NUMBER. A plain integer so the math gate can pin it in one line.
  CBZ.childSafeAudit = function () { return OPEN.length; };
  CBZ.childSafeAudit.sites = OPEN.slice();
  CBZ.childSafeAudit.closed = CLOSED.slice();

  // Live telemetry — separate from the ratchet on purpose: these move every
  // time somebody shoots at a kid and must never be confused with the census.
  CBZ.childSafeStats = function () {
    return {
      open: OPEN.length,          // === childSafeAudit()
      sealed: sealed,             // children whose hp is currently locked
      pending: pending.length,    // fresh peds awaiting their one deferred check
      vetoedCalls: vetoedCalls,   // bus calls refused
      vetoedWrites: vetoedWrites, // raw `.hp -=` writes refused by the seal
      hooks: landed.slice(),      // which installers landed (debugging load order)
      on: on(),
    };
  };
})();
