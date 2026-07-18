/* ============================================================
   core/packages.js — GAME PACKAGES: the city as a game engine.

   WHY THIS EXISTS
   Every big venue (casino, raceway, arena, precinct, airport, base,
   city hall, open water) kept getting built one of two bad ways:
   as a from-scratch standalone that reinvents renderer/input/NPCs/
   audio, or as a thin "feature" (a dressed room + a menu) that
   answers no WHY. This file is the third way: a package registers a
   real game and the ENGINE supplies everything generic — rendering,
   the interaction system, colliders, money, HUD, NPC rigs, seeded
   randomness, the update loop. A package contains ONLY its domain:
   its venue dressing, its rules, its arc.

   CONTRACT (what a package gets and must respect)
     CBZ.games.register({
       id, title,
       venue: { lotKind: "casino" }        // claim city lots of a kind
              | { site: "custom" },        // no lot: package resolves its own anchor in build()
       build(ctx, venue),                  // dress venue.group (LOCAL coords; group sits at lot center)
       update(ctx, dt),                    // ticked while mounted (CBZ.PRIO.GAMEPLAY band)
       api,                                // optional: exposed at CBZ.games.api[id] for tools/probes
     })
     ctx services — the ONLY surface a package should touch:
       ctx.THREE ctx.mat/pmat/emat ctx.box/cyl ctx.canvasTex     geometry/materials
       ctx.solid(x1,z1,x2,z2[,y0,y1])                            colliders (#3: auto markCollidersDirty)
       ctx.light(x,y,z,color,i,dist)                             budgeted PointLights (≤8/venue)
       ctx.npc(spec) -> handle                                   REAL city ped: brain+outfit+gunpoint+cityKillPed. USE THIS.
       ctx.rig(opts) ctx.idle(rig)                               DEPRECATED bare voxel dummy — fallback only (no brain/death)
       ctx.zone({id,label,pos:[x,z],r,onUse,canShow})            interactions (#14 registerZone, slot "e")
       ctx.wallet.cash()/spend(n)/give(n)/canAfford(n)           REAL city money (#6b via CBZ.city)
       ctx.hud.feed/toast/panel(html,handlers)/closePanel        player-facing surface
       ctx.rand(a,b,salt) ctx.stream(name)                       DETERMINISM LAW (#12): never Math.random
       ctx.anim(fn(dt,t))                                        per-frame animator; return false to end
       ctx.state(init)                                           package save-bag (localStorage-mirrored)
   RULES
     - build() must be deterministic per seed (position-hash streams only).
     - Venue groups carry userData.gamePkg so core/batch.js SPARES them.
     - Claimed lots get lot._gamePkg = id at order 88 — interior dressers
       (e.g. city/casino.js at order 90) skip those lots.
     - Every prop a package builds must be interactable or load-bearing
       (owner's WHY rule). Decoration with no job gets cut in review.
   Revert: CBZ.CONFIG.GAME_PACKAGES = false (nothing mounts, zero cost).
   Dev loop: games/dev.html?pkg=<id> boots the engine and mounts one
   package on a flat pad at the spawn — iterate there, not in a fork.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GAME_PACKAGES == null) CBZ.CONFIG.GAME_PACKAGES = true;

  const defs = [];        // registered package defs
  const live = [];        // mounted instances {def, ctx, venue}
  const api = {};         // def.api exposure for probes/tools

  /* ---------------- shared materials (one cache for every package) -------- */
  const mats = {};
  function mat(c) { return mats["l" + c] || (mats["l" + c] = new THREE.MeshLambertMaterial({ color: c })); }
  function pmat(c, s) { const k = "p" + c + "_" + (s || 6); return mats[k] || (mats[k] = new THREE.MeshPhongMaterial({ color: c, shininess: s || 6, specular: 0x1c1c1c })); }
  function emat(c, i) { const k = "e" + c + "_" + (i == null ? 0.9 : i); return mats[k] || (mats[k] = new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: i == null ? 0.9 : i })); }
  function box(parent, x, y, z, w, h, d, m, ry) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z); if (ry) mesh.rotation.y = ry;
    parent.add(mesh); return mesh;
  }
  function cyl(parent, x, y, z, rt, rb, h, m, seg) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), m);
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function canvasTex(w, h, draw, rx, ry) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    if (rx || ry) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx || 1, ry || 1); }
    return t;
  }

  /* ---------------- DEPRECATED bare voxel dummy ---------------------------
     DEPRECATED: use ctx.npc(spec) instead — it requisitions a REAL city ped
     (real brain, cityOutfitFor wardrobe, gunpoint hands-up, cityKillPed death,
     collision), which is the whole point of a shared engine: less duplication,
     one NPC that every minigame improves. This bare rig is kept ONLY as the
     ctx.npc fallback for when the ped system is absent (a bare dev harness) and
     for the handful of pure-visual props a package animates itself via ctx.anim
     (a boxing package driving .armL/.armR). It has no brain, no death funnel,
     no interaction — never reach for it directly in new package code. */
  function rig(o) {
    o = o || {};
    const g = new THREE.Group();
    const skin = o.skin || 0xd9a066, shirt = o.shirt || 0x3a4a52, pants = o.pants || 0x22262c, hair = o.hair || 0x241a10;
    const legL = new THREE.Group(); legL.position.set(-0.12, 0.74, 0); g.add(legL);
    const legR = new THREE.Group(); legR.position.set(0.12, 0.74, 0); g.add(legR);
    box(legL, 0, -0.37, 0, 0.17, 0.74, 0.2, mat(pants)); box(legR, 0, -0.37, 0, 0.17, 0.74, 0.2, mat(pants));
    box(legL, 0, -0.71, 0.045, 0.18, 0.1, 0.3, mat(0x14100c)); box(legR, 0, -0.71, 0.045, 0.18, 0.1, 0.3, mat(0x14100c));
    const torso = box(g, 0, 1.05, 0, 0.48, 0.64, 0.27, mat(shirt));
    if (o.vest) box(g, 0, 1.0, 0, 0.5, 0.5, 0.29, mat(o.vest));
    const armL = new THREE.Group(); armL.position.set(-0.305, 1.3, 0); g.add(armL);
    const armR = new THREE.Group(); armR.position.set(0.305, 1.3, 0); g.add(armR);
    box(armL, 0, -0.3, 0, 0.13, 0.6, 0.16, mat(o.sleeves || shirt));
    box(armR, 0, -0.3, 0, 0.13, 0.6, 0.16, mat(o.sleeves || shirt));
    box(armL, 0, -0.56, 0, 0.11, 0.12, 0.13, mat(skin)); box(armR, 0, -0.56, 0, 0.11, 0.12, 0.13, mat(skin));
    const head = new THREE.Group(); head.position.set(0, 1.55, 0); g.add(head);
    box(head, 0, 0, 0, 0.3, 0.3, 0.3, mat(skin));
    box(head, 0, 0.13, -0.02, 0.32, 0.1, 0.32, mat(hair));
    if (o.cap) { box(head, 0, 0.17, 0, 0.33, 0.09, 0.33, mat(o.cap)); box(head, 0, 0.13, 0.19, 0.32, 0.05, 0.1, mat(o.cap)); }
    if (o.shades) box(head, 0, 0.02, 0.16, 0.26, 0.06, 0.03, mat(0x0a0a0a));
    const R = { g, armL, armR, legL, legR, head, torso };
    R.at = function (x, z, ry) { g.position.x = x; g.position.z = z; g.rotation.y = ry || 0; return R; };
    R.stand = function () { armL.rotation.set(0.06, 0, 0.14); armR.rotation.set(0.06, 0, -0.14); legL.rotation.x = legR.rotation.x = 0; return R; };
    R.fold = function () { armL.rotation.set(-1.15, 0, -0.5); armR.rotation.set(-1.2, 0, 0.55); return R; };
    R.deal = function () { armL.rotation.set(-0.75, 0, -0.38); armR.rotation.set(-0.75, 0, 0.38); return R; };
    R.sit = function () { legL.rotation.x = legR.rotation.x = -1.32; g.position.y += 0.18; armL.rotation.set(-0.6, 0, -0.1); armR.rotation.set(-0.6, 0, 0.1); return R; };
    R.stand();
    return R;
  }

  /* ---------------- ctx.npc: REAL city peds for packages ------------------
     A package requisitions the NPC the city already ships instead of hand-
     coding one: makePed gives it the aggr brain, the cityOutfitFor wardrobe,
     the gunpoint hands-up, the cityKillPed death funnel (#7) and normal
     collision (#1). The role map below only picks the CASTING opts (job +
     archetype) that dress + behave the part — every appearance/behaviour roll
     still happens inside makePed off the SEEDED stream we hand it, so builds
     stay byte-identical per seed (determinism law #12; no Math.random here). */
  const NPC_ROLES = {
    dealer:   { job: "croupier",       archetype: "merchant" },      // → waiter blacks (dealer read)
    croupier: { job: "croupier",       archetype: "merchant" },
    cashier:  { job: "cage cashier",   archetype: "merchant" },      // → vendor apron
    guard:    { job: "security guard", archetype: "professional" },  // → guard blacks
    bouncer:  { job: "bouncer",        archetype: "professional" },
    pitboss:  { job: "pit boss",       archetype: "exec" },          // → charcoal suit (archetype path)
    shark:    { job: "high roller",    archetype: "exec", wealth: 0.9 },
    patron:   { job: "patron",         archetype: "nightlife" },     // → club dress/suit mix
  };
  function npcOptsFor(role, spec, pinned) {
    const R = NPC_ROLES[role] || { job: role, archetype: "merchant" };
    const opts = {
      // "staff" (pinned) fails the hourly recast's `kind !== "civilian"` test, so
      // posted staff never get re-cast into a random dealer/tweaker at dusk.
      kind: pinned ? "staff" : "civilian",
      name: spec.name || null,
      job: R.job, archetype: R.archetype,
      // meek + unarmed → markGunpoint reliably throws the hands up (poise, not a draw-back).
      aggr: R.aggr != null ? R.aggr : 0.22,
      armed: false, snitch: 0.08,
      wealth: R.wealth != null ? R.wealth : 0.55,
    };
    // outfit override (cityOutfitFor-compatible): number = plain torso color;
    // string = a job hint the shared wardrobe (jobFit) dresses; object = raw
    // makePed opts (advanced — {gang, cop, outfit, ...}).
    const of = spec.outfit;
    if (typeof of === "number") opts.outfit = of;
    else if (typeof of === "string") opts.job = of;
    else if (of && typeof of === "object") { for (const k in of) opts[k] = of[k]; }
    return opts;
  }
  function npcSetPose(ped, verb) {
    if (!ped || !ped.char) return;
    if (CBZ.setCharPose) CBZ.setCharPose(ped.char, verb);
    else { ped.char.sitting = (verb === "sit"); ped.char.pose = (verb && verb !== "sit" && verb !== "stand") ? verb : null; }
  }
  function npcDispose(ped) {
    if (!ped) return;
    const arr = CBZ.cityPeds;
    if (arr) { const i = arr.indexOf(ped); if (i >= 0) arr.splice(i, 1); }
    ped._iopts = null;                       // drop the [E] Talk options with the ped
    ped.staffPost = null;
    if (ped.group && ped.group.parent) ped.group.parent.remove(ped.group);
    if (ped.group) ped.group.traverse(function (obj) {
      if (obj.isSprite) return;              // shared r128 sprite geometry — never dispose
      if (obj.geometry && !obj.geometry._shared && obj.geometry.dispose) { try { obj.geometry.dispose(); } catch (e) {} }
      if (obj.material) { const m = obj.material; if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose()); else if (!m._shared && m.dispose) m.dispose(); }
    });
  }

  /* ---------------- the package panel (one DOM overlay, engine-owned) ----- */
  let panelEl = null, panelHandlers = null;
  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement("div");
    panelEl.id = "pkgPanel";
    panelEl.style.cssText = "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);width:min(860px,96vw);" +
      "padding:13px 16px 14px;z-index:40;display:none;background:rgba(10,22,17,.85);backdrop-filter:blur(6px);" +
      "border:2px solid rgba(232,182,76,.4);border-radius:14px;color:#fff6e2;" +
      "font-family:'Trebuchet MS','Segoe UI',Verdana,system-ui,sans-serif;pointer-events:auto;";
    panelEl.addEventListener("click", (e) => {
      const act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
      if (act && panelHandlers && panelHandlers[act]) panelHandlers[act]();
    });
    document.body.appendChild(panelEl);
    window.addEventListener("keydown", (e) => { if (e.code === "Escape" && panelEl.style.display !== "none") closePanel(); });
    return panelEl;
  }
  function openPanel(html, handlers) { ensurePanel(); panelHandlers = handlers || null; panelEl.innerHTML = html; panelEl.style.display = "block"; }
  function closePanel() { if (!panelEl) return; panelEl.style.display = "none"; panelEl.innerHTML = ""; panelHandlers = null; }

  /* ---------------- ctx factory ------------------------------------------ */
  const animators = [];   // {fn} global across packages; driven from one updater
  let animT = 0;
  function makeCtx(def, venue) {
    let lights = 0;
    const stateKey = "cbzPkg:" + def.id;
    let bag = null;
    const ctx = {
      THREE, mat, pmat, emat, box, cyl, canvasTex, rig,
      venue,
      solid(x1, z1, x2, z2, y0, y1) {
        const o = venue.origin;
        const c = { minX: o.x + Math.min(x1, x2), maxX: o.x + Math.max(x1, x2), minZ: o.z + Math.min(z1, z2), maxZ: o.z + Math.max(z1, z2), ref: venue.group };
        if (y0 != null) { c.y0 = y0; c.y1 = y1; }
        (CBZ.colliders = CBZ.colliders || []).push(c);
        venue._dirtyColliders = true;
        return c;
      },
      light(x, y, z, color, intensity, dist) {
        if (lights >= 8) return null; // light budget per venue — the forward renderer is not infinite
        lights++;
        const L = new THREE.PointLight(color, intensity, dist, 1.6);
        L.position.set(x, y, z); venue.group.add(L); return L;
      },
      idle(R, phase) {
        ctx.anim(function (dt, t) {
          R.torso.position.y = 1.05 + Math.sin(t * 2.1 + (phase || 0)) * 0.012;
          R.head.position.y = 1.55 + Math.sin(t * 2.1 + (phase || 0)) * 0.012;
        });
      },
      // requisition a REAL city ped (brain + outfit + gunpoint + death funnel).
      // spec: { role, outfit, at:[x,z](venue-LOCAL), face, post:"pinned"|"ambient",
      //         pose, dialogue:[...], name }. Returns a handle:
      //   { ped, pose(verb), say(line[,secs]), at(x,z[,face]), remove() }
      npc(spec) {
        spec = spec || {};
        const o = venue.origin;
        const atv = spec.at || [0, 0];
        const wx = o.x + (atv[0] || 0), wz = o.z + (atv[1] || 0);
        const face = spec.face || 0;
        const role = spec.role || "patron";
        const pinned = spec.post !== "ambient";      // default: pinned staff
        // DETERMINISM (#12): every roll keys off a stream seeded by role + POST
        // POSITION (never Math.random) so build() is byte-identical per client.
        // ctx.stream already namespaces "pkg:<id>:".
        const rstream = ctx.stream("npc:" + role + ":" + Math.round(wx) + ":" + Math.round(wz));

        // ---- ENGINE PED PATH: the real thing (the point of the shared engine) ----
        // root: packages mount at order 88, DURING buildCity — CBZ.city.arena.root
        // isn't published yet. The venue group's parent IS that build root (set at
        // claim time), so build-time npc() calls parent there and never fall back.
        const pedRoot = (venue.group && venue.group.parent) || (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
        if (CBZ.cityMakePed && pedRoot) {
          // outfit directive: a STRING that names an exact catalog fit ("valet",
          // "waiter", "hoodie", "security"…) is PAINTED on after makePed via the
          // shared wardrobe (cityRecolorRig honors its painter/composite); any
          // other string is left as a job hint (npcOptsFor). number/object handled
          // in npcOptsFor. Deterministic — a named fit is a fixed color set.
          let fitRec = null, specForOpts = spec;
          if (typeof spec.outfit === "string" && CBZ.cityOutfitCatalog) {
            const cat = CBZ.cityOutfitCatalog();
            if (cat && cat[spec.outfit] && cat[spec.outfit].colors) {
              fitRec = cat[spec.outfit];
              specForOpts = Object.assign({}, spec, { outfit: null });   // paint below, don't job-hint it
            }
          }
          const ped = CBZ.cityMakePed(wx, wz, rstream, npcOptsFor(role, specForOpts, pinned));
          ped.group.rotation.y = face;
          pedRoot.add(ped.group);
          (CBZ.cityPeds || (CBZ.cityPeds = [])).push(ped);
          if (fitRec && CBZ.cityRecolorRig) { try { CBZ.cityRecolorRig(ped.char, fitRec.colors, fitRec); ped._castFit = fitRec.id; } catch (e) {} }
          // PIN posted staff to their station: peds.js's brain respects
          // ped.staffPost (rooted, no crowd churn, but still gunpoint-aware).
          // Ambient NPCs keep the normal ped brain (they wander like a resident).
          if (pinned) { ped.staffPost = { x: wx, z: wz, face: face }; ped.state = "idle"; ped.speed = 0; }
          // initial pose through the ENGINE pose layer (character.js + poses.js)
          npcSetPose(ped, spec.pose || (pinned ? "stand" : null));
          // [E] Talk — cycle the dialogue via the interaction registry (#14). It
          // rides the ped's own _iopts, so it dies with the ped, zero per-frame cost.
          if (spec.dialogue && spec.dialogue.length && CBZ.interactions && CBZ.interactions.registerFor) {
            let di = 0;
            CBZ.interactions.registerFor(ped, {
              id: def.id + ":npc-talk:" + Math.round(wx) + ":" + Math.round(wz),
              slot: "e", prio: 20,
              label: spec.talkLabel || ("Talk to " + (spec.name || role)),
              canShow(t) { return t && !t.dead && !t.surrender; },
              onSelect(t) {
                const line = spec.dialogue[di % spec.dialogue.length]; di++;
                if (CBZ.citySay) CBZ.citySay(t, "“" + line + "”", spec.sayColor || "#dfe7ff", 2.8);
              },
            });
          }
          return {
            ped: ped,
            pose(verb) { npcSetPose(ped, verb); return this; },
            say(line, secs) { if (ped && !ped.dead && CBZ.citySay && line) CBZ.citySay(ped, "“" + line + "”", spec.sayColor || "#dfe7ff", secs || 2.6); return this; },
            at(x, z, f) {
              if (ped && ped.group) {
                const nx = o.x + x, nz = o.z + z;
                ped.pos.set(nx, 0, nz); ped.group.position.set(nx, 0, nz);
                if (f != null) ped.group.rotation.y = f;
                if (ped.staffPost) { ped.staffPost.x = nx; ped.staffPost.z = nz; if (f != null) ped.staffPost.face = f; }
              }
              return this;
            },
            remove() { npcDispose(ped); },
          };
        }

        // ---- FALLBACK: ped system absent (bare dev harness) → a ctx.rig dummy
        //      with the SAME handle shape so callers never branch. No brain,
        //      gunpoint, dialogue or death funnel — only crash-avoidance. ----
        const Rg = rig((spec.outfit && typeof spec.outfit === "object") ? spec.outfit : {});
        Rg.at(atv[0] || 0, atv[1] || 0, face);
        venue.group.add(Rg.g);
        const applyRigPose = (verb) => {
          if (verb === "sit" && Rg.sit) Rg.sit();
          else if (verb === "foldarms" && Rg.fold) Rg.fold();
          else if ((verb === "deal" || verb === "croupier" || verb === "dealer") && Rg.deal) Rg.deal();
          else if (Rg.stand) Rg.stand();
        };
        applyRigPose(spec.pose);
        return {
          ped: null, rig: Rg,
          pose(verb) { applyRigPose(verb); return this; },
          say(line) { if (line) ctx.hud.feed((spec.name ? spec.name + ": " : "") + line); return this; },
          at(x, z, f) { Rg.at(x, z, f); return this; },
          remove() { if (Rg.g && Rg.g.parent) Rg.g.parent.remove(Rg.g); },
        };
      },
      zone(z) {
        if (!CBZ.interactions || !CBZ.interactions.registerZone) return null;
        const o = venue.origin;
        const wx = o.x + z.pos[0], wz = o.z + z.pos[1], r = z.r || 1.6;
        return CBZ.interactions.registerZone({
          id: def.id + ":" + z.id, kind: "gamepkg",
          find(px, pz) {
            const dx = px - wx, dz = pz - wz;
            return (dx * dx + dz * dz <= r * r) ? { x: wx, z: wz, pkg: def.id, zid: z.id } : null;
          },
          options: [{
            id: def.id + ":" + z.id + ":use", slot: "e", prio: 30,
            label: z.label,
            canShow: z.canShow || null,
            onSelect() { z.onUse(ctx); },
          }],
        });
      },
      wallet: {
        cash() { return (CBZ.game && CBZ.game.cash) || 0; },
        canAfford(n) { return !!(CBZ.city && CBZ.city.canAfford && CBZ.city.canAfford(n)); },
        spend(n, why) {
          const ok = !!(CBZ.city && CBZ.city.spend && CBZ.city.spend(n));
          if (ok && why) ctx.hud.feed(why + " (−$" + n.toLocaleString() + ")");
          return ok;
        },
        give(n, why) {
          if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(n);
          if (why) ctx.hud.feed(why + " (+$" + n.toLocaleString() + ")", "#ffd166");
        },
      },
      hud: {
        feed(msg, color) { if (CBZ.cityFeed) CBZ.cityFeed(msg, color || "#e8dcc0"); },
        toast(msg) { if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, 2.4); else ctx.hud.feed(msg, "#ffd166"); },
        panel: openPanel, closePanel,
      },
      rand(a, b, salt) { return CBZ.hash01 ? CBZ.hash01(a, b, "pkg:" + def.id + ":" + (salt || "")) : 0.5; },
      stream(name) { return CBZ.seedStream ? CBZ.seedStream("pkg:" + def.id + ":" + name) : function () { return 0.5; }; },
      anim(fn) { animators.push(fn); },
      state(init) {
        if (bag) return bag;
        try { bag = JSON.parse(localStorage.getItem(stateKey) || "null"); } catch (_) { bag = null; }
        if (!bag) bag = (typeof init === "function" ? init() : (init || {}));
        return bag;
      },
      saveState() { try { if (bag) localStorage.setItem(stateKey, JSON.stringify(bag)); } catch (_) {} },
    };
    return ctx;
  }

  /* ---------------- mounting --------------------------------------------- */
  function mount(def, venue) {
    const ctx = makeCtx(def, venue);
    venue.group.userData.gamePkg = def.id;      // batch.js spares userData'd groups
    try { def.build(ctx, venue); } catch (err) { console.error("[gamepkg:" + def.id + "] build failed", err); return; }
    if (venue._dirtyColliders && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    live.push({ def, ctx, venue });
    if (def.api) api[def.id] = def.api;
  }
  function claimAndMount(city) {
    if (!CBZ.CONFIG.GAME_PACKAGES) return;
    // arena resolution: the PASSED city wins (we're inside its build pass);
    // otherwise the canonical arena — _settlementArena is a per-settlement
    // build scratchpad and must not shadow the real world on late retries.
    const A = city || (CBZ.city && CBZ.city.arena) || CBZ._settlementArena || null;
    const root = (city && city.root) || (A && A.root) || CBZ.scene;
    if (!A || !root) return;
    // worlds REBUILD: drop live instances whose group lost its parent
    for (let i = live.length - 1; i >= 0; i--) if (!live[i].venue.group.parent) live.splice(i, 1);
    for (const def of defs) {
      if (CBZ.CONFIG["PKG_" + def.id.toUpperCase()] === false) continue;
      if (live.some((L) => L.def === def)) continue;      // already mounted this build
      if (def.venue && def.venue.lotKind) {
        // claim the LARGEST built lot of the kind (the flagship);
        // dressers skip claimed lots (lot._gamePkg, fresh per build)
        let best = null;
        const scan = (arr) => { if (arr) for (const lot of arr) {
          if (!lot || lot.kind !== def.venue.lotKind || !lot.building || lot._gamePkg) continue;
          if (!best || ((lot.w || 0) * (lot.d || 0)) > ((best.w || 0) * (best.d || 0))) best = lot;
        } };
        scan(A.shopLots); scan(A.lots);
        if (!best) continue;
        best._gamePkg = def.id;
        const group = new THREE.Group();
        group.position.set(best.cx, 0, best.cz);
        root.add(group);
        mount(def, { group, origin: { x: best.cx, z: best.cz }, lot: best, kind: "lot" });
      } else if (def.venue && def.venue.site) {
        trySiteMount(def, root);
      }
    }
  }

  /* site venues (open water, wilderness…): the package supplies
     venue.resolve(CBZ) -> { x, z, [waterY], [bounds] } | null. Tried at the
     order-88 pass and retried lazily from the update tick (some anchors — water
     level, map edges — only exist after the world finishes building). */
  function trySiteMount(def, root) {
    if (live.some((L) => L.def === def)) return;
    let anchor = null;
    try { anchor = def.venue.resolve ? def.venue.resolve(CBZ) : null; } catch (_) { anchor = null; }
    if (!anchor) return;
    const parent = root || (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    if (!parent) return;
    const group = new THREE.Group();
    group.position.set(anchor.x || 0, 0, anchor.z || 0);
    parent.add(group);
    mount(def, { group, origin: { x: anchor.x || 0, z: anchor.z || 0 }, lot: null, kind: "site", anchor });
  }

  /* dev harness: mount ONE package on a flat pad at the origin (games/dev.html) */
  function devMount(id) {
    const def = defs.find((d) => d.id === id);
    if (!def) return false;
    const group = new THREE.Group();
    group.position.set(0, 0, 0);
    CBZ.scene.add(group);
    def._mounted = true;
    mount(def, { group, origin: { x: 0, z: 0 }, lot: null, kind: "dev" });
    return true;
  }

  /* ---------------- loop + landmass wiring ------------------------------- */
  let hooked = false;
  function hook() {
    if (hooked) return; hooked = true;
    // package venues claim lots at order 88 — BEFORE interior dressers (casino.js runs at 90)
    if (CBZ.addLandmass) CBZ.addLandmass(function (city) { claimAndMount(city); }, 88);
    if (CBZ.onUpdate && CBZ.PRIO) {
      // GAMEPLAY band: package sims tick with the rest of the activity layer
      let mountRetryT = 0;
      CBZ.games._ticks = 0;
      CBZ.onUpdate(CBZ.PRIO.after(CBZ.PRIO.GAMEPLAY, 50), function (dt) {
        CBZ.games._ticks++;
        animT += dt;
        for (let i = animators.length - 1; i >= 0; i--) { try { if (animators[i](dt, animT) === false) animators.splice(i, 1); } catch (err) { animators.splice(i, 1); console.error("[gamepkg anim]", err); } }
        for (const L of live) { if (L.def.update) { try { L.def.update(L.ctx, dt); } catch (err) { console.error("[gamepkg:" + L.def.id + "] update", err); } } }
        // SELF-HEALING MOUNT: the order-88 landmass pass is the fast path, but
        // build pipelines evolve and site anchors appear late — any def still
        // unmounted retries here, lots and sites alike. FRAME-counted, not
        // sim-dt (headless sim time crawls ~60x; a dt-accumulated gate could
        // starve forever). Cheap: per-def early-outs; stops mattering once
        // everything is live. Idempotent via live[] + lot._gamePkg claims.
        if (++mountRetryT >= 3) {
          mountRetryT = 0;
          if (CBZ.CONFIG.GAME_PACKAGES && defs.some((d) => !live.some((L) => L.def === d))) {
            try { claimAndMount(null); } catch (err) { console.error("[gamepkg mount-retry]", err); }
          }
        }
      });
    }
  }

  /* a venue-less ctx: panels/money/state work, world-building is a no-op.
     Lets a package's UI run at ANY venue (e.g. every town casino's tables)
     even when its flagship 3D floor isn't the one the player is standing in. */
  function hubCtx(id) {
    const def = defs.find((d) => d.id === id) || { id };
    const ctx = makeCtx(def, { group: new THREE.Group(), origin: { x: 0, z: 0 }, kind: "hub" });
    ctx.solid = function () { return null; };
    ctx.zone = function () { return null; };
    ctx.light = function () { return null; };
    return ctx;
  }

  CBZ.games = {
    register(def) { defs.push(def); hook(); return def.id; },
    list() { return defs.map((d) => d.id); },
    live() { return live.map((L) => ({ id: L.def.id, kind: L.venue.kind })); },
    devMount,
    hubCtx,
    api,
    _claimAndMount: claimAndMount, // exposed for late/manual mounting from probes
    _defs: function () { return defs; }, // probe access: inspect venue.resolve etc.
  };
})();
