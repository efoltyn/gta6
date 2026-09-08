/* ============================================================
   modes/shark_title.js — the SHARK SIM front door.

   WHAT: builds #sharkTitle inside #title and, while the game sits in the
   title state in shark mode, parks the lens low over the island's own sea
   so the screen behind the wordmark is the game and not a gradient.

   WHY: the shared title card is a beige box that reads as a settings
   dialogue. A standalone product needs one decision on one screen: PLAY.

   HOW IT STAYS COMPATIBLE: nothing here is a new control surface. The big
   PLAY forwards to #playBtn (state.js's startRunPresented, gamepad.js's
   Start, every tool's `playBtn.click()`); the graphics segment forwards to
   the .quality-btn set; the MORE GAMES row forwards to the .mode-btn set
   and only appears when this page carries more than one mode. Attract
   camera writes at onAlways(60) — after camera.js (50) and fpsmode (52),
   which is the ordering the haul scene learned the hard way.
============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.sharkTitle) return;

  const LADDER = ["Bull shark", "Hammerhead", "Great white", "Megalodon"];
  const KEYS = [
    ["WASD", "swim"], ["Shift", "lunge"], ["Space", "rise"], ["C", "dive"],
  ];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function build() {
    const title = document.getElementById("title");
    if (!title || document.getElementById("sharkTitle")) return;
    const root = el("div"); root.id = "sharkTitle";

    // ---- head: the mark, the promise ----
    const head = el("div", "st-head");
    head.appendChild(el("div", "st-mark", "SHARK SIM"));
    head.appendChild(el("div", "st-tag", "You are the shark"));
    const ladder = el("div", "st-ladder");
    LADDER.forEach((name, i) => {
      if (i) ladder.appendChild(el("i", null, "›"));
      ladder.appendChild(el("span", i === LADDER.length - 1 ? "st-top" : null, name));
    });
    head.appendChild(ladder);
    root.appendChild(head);

    // ---- middle: PLAY, graphics ----
    const mid = el("div", "st-mid");
    const play = el("button", "st-play", "Play"); play.type = "button"; play.id = "sharkPlay";
    play.addEventListener("click", () => {
      const b = document.getElementById("playBtn");
      if (b) b.click();
    });
    mid.appendChild(play);
    const q = el("div", "st-quality");
    q.appendChild(el("span", null, "Graphics"));
    const seg = el("div", "st-seg");
    const originals = Array.from(document.querySelectorAll("#qualityPreset .quality-btn"));
    const proxies = originals.map((o) => {
      const b = el("button", null, (o.querySelector("span") || o).textContent.trim());
      b.type = "button"; b.dataset.qualityPreset = o.dataset.qualityPreset;
      b.addEventListener("click", () => { o.click(); syncQuality(); });
      seg.appendChild(b);
      return b;
    });
    function syncQuality() {
      originals.forEach((o, i) => proxies[i].classList.toggle("active", o.classList.contains("active")));
    }
    syncQuality();
    // quality.js may flip the active button itself (a saved preset, a
    // gamepad); mirror whatever it decides.
    if (window.MutationObserver && originals.length) {
      const mo = new MutationObserver(syncQuality);
      originals.forEach((o) => mo.observe(o, { attributes: true, attributeFilter: ["class", "aria-pressed"] }));
    }
    if (originals.length) { q.appendChild(seg); mid.appendChild(q); }
    root.appendChild(mid);

    // ---- foot: the keys, the other games ----
    const foot = el("div", "st-foot");
    const keys = el("div", "st-keys");
    KEYS.forEach(([k, lab]) => {
      const row = el("span", "st-k st-kbd");
      row.appendChild(el("kbd", null, k)); row.appendChild(el("span", null, lab));
      keys.appendChild(row);
    });
    const touch = el("span", "st-k st-touch");
    touch.appendChild(el("kbd", null, "Stick")); touch.appendChild(el("span", null, "swim, rim to lunge"));
    keys.appendChild(touch);
    const touch2 = el("span", "st-k st-touch");
    touch2.appendChild(el("kbd", null, "Rise / Dive")); touch2.appendChild(el("span", null, "the two buttons"));
    keys.appendChild(touch2);
    const bite = el("span", "st-k");
    bite.appendChild(el("kbd", null, "Bite")); bite.appendChild(el("span", null, "automatic. Point your mouth at food"));
    keys.appendChild(bite);
    foot.appendChild(keys);

    const modeBtns = Array.from(document.querySelectorAll("#modeSelect .mode-btn"));
    const others = modeBtns.filter((b) => b.dataset.mode !== "sharksim");
    const modeSelect = document.getElementById("modeSelect");
    if (others.length && modeSelect && !modeSelect.hidden) {
      const more = el("div", "st-more on");
      more.appendChild(el("span", null, "More games"));
      others.forEach((o) => {
        const b = el("button", null, (o.querySelector("span") || o).textContent.trim());
        b.type = "button";
        b.addEventListener("click", () => o.click());
        more.appendChild(b);
      });
      foot.appendChild(more);
    }
    root.appendChild(foot);
    title.appendChild(root);
  }

  /* ---- the world behind the words ------------------------------------
     Nothing builds the island before PLAY: main.js's boot-time setMode runs
     before modes/shark_sim.js has registered, so the descriptor's build()
     never fires and the title looks out on fog. In shark mode the island is
     built one painted frame after the title shows (survival.build() is
     idempotent, and reset() re-arms the same arena at PLAY), so the sea is
     the backdrop and PLAY has less to build. */
  let building = false;
  function ensureWorld() {
    if (building) return;
    const g = CBZ.game, surv = CBZ.surv, m = CBZ.modes && CBZ.modes.survival;
    if (!g || g.state !== "title" || g.mode !== "sharksim" || !CBZ.bootComplete) return;
    if (!m || !m.build || (surv && surv.built)) return;
    building = true;
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      try { m.build(); } catch (e) { console.error("[shark title build]", e); }
      const A = CBZ.surv && CBZ.surv.arena;
      if (A && A.root) A.root.visible = true;
      building = false;
    }); });
  }

  /* ---- the attract lens: a slow drift off the beach, over the sea -----
     The lens sits well outside the sand and looks along the coast, so the
     island is one edge of the frame and the water is the rest. The wildlife
     pass (city/wildlife.js at onUpdate 47.1) only runs in the playing state,
     so the sea would be a still life; that ONE updater is stepped here so the
     fish and the sharks keep swimming behind the words. Nothing else of the
     match is ticked — no bots, no disasters, no clock. */
  let t = 0, seeded = false, ang0 = 0, swimTick = null;
  function findSwimTick() {
    if (swimTick !== null) return swimTick;
    swimTick = false;
    for (const u of CBZ.updaters || []) {
      if (u && Math.abs(u.order - 47.1) < 1e-6 && /wildlife\.js/.test(String(u.source || ""))) { swimTick = u.fn; break; }
    }
    return swimTick;
  }
  /* ---- the cast: three sharks cruising the water in front of the lens.
     Spawned through the sea's own door (cityWildlifeSpawnAt) so they swim,
     school and breach like everything else out there, and struck from the
     list the moment the title leaves, so a match starts with the sea the
     mode's own stocking gave it and not three extra great whites. */
  const cast = [];
  function castIn(cx, cz, lx, lz) {
    if (cast.length || !CBZ.cityWildlifeSpawnAt) return;
    const ids = ["great_white_shark", "hammerhead_shark", "great_white_shark"];
    const dx = lx - cx, dz = lz - cz, len = Math.hypot(dx, dz) || 1;
    const px = -dz / len, pz = dx / len;                    // across the view
    ids.forEach((id, i) => {
      const f = 0.30 + i * 0.14, side = (i - 1) * 9;        // 20-40 m out, spread across the frame
      const a = CBZ.cityWildlifeSpawnAt(id, cx + dx * f + px * side, cz + dz * f + pz * side);
      if (a) { a._titleCast = true; a.heading = Math.atan2(pz, px) * (i % 2 ? -1 : 1); cast.push(a); }
    });
  }
  /* the sea's own depth law keeps a cruising shark's torso under; the cast
     rides at the surface so the fin is what the title shows. Written AFTER
     the swim tick, before the draw, every frame of the title only. */
  function castSurface() {
    for (const a of cast) {
      const g = a.group; if (!g) continue;
      const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(g.position.x, g.position.z) : -0.8;
      g.position.y = surf - (a.swimDepth || 1) * 0.45;   // torso under, dorsal fin through
      if (a.pos) a.pos.y = g.position.y;
    }
  }
  function castOut() {
    const wl = CBZ.cityWildlife || [];
    for (const a of cast) {
      a.dead = true; a._despawned = true;
      const ix = wl.indexOf(a); if (ix >= 0) wl.splice(ix, 1);
      if (a.group && a.group.parent) a.group.parent.remove(a.group);
    }
    cast.length = 0;
  }
  function attract(dt) {
    const g = CBZ.game;
    if (!g || g.state !== "title" || g.mode !== "sharksim") { if (seeded) castOut(); seeded = false; return; }
    const A = CBZ.surv && CBZ.surv.arena, cam = CBZ.camera, T = window.THREE;
    if (!A || !A.center) { ensureWorld(); return; }
    if (!cam || !T) return;
    if (!seeded) { seeded = true; t = 0; ang0 = (CBZ.hash01 ? CBZ.hash01(7, 3, 0x5aac01) : Math.random()) * Math.PI * 2; }
    const step = Math.min(0.1, dt || 0.016);
    t += step;
    const tick = findSwimTick();
    if (tick) { try { tick(step); } catch (e) {} }
    const R = A.radius || 300;
    const ang = ang0 + t * 0.010;                     // one lap in about ten minutes
    const r = R * 1.42;                               // well off the sand, over deep water
    const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
    const sea = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.8;
    const bob = Math.sin(t * 0.6) * 0.25;
    cam.position.set(x, sea + 4.2 + bob, z);
    // look along the drift: the shore and its surf on one side of the frame,
    // open sea across the rest, the horizon in the upper third
    const la = ang + 0.42, lr = R * 1.22;
    const lx = A.center.x + Math.cos(la) * lr, lz = A.center.z + Math.sin(la) * lr;
    if (t < 0.5) castIn(x, z, lx, lz);
    castSurface();
    cam.up.set(0, 1, 0);
    cam.lookAt(lx, sea + 0.4, lz);
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);
  }

  CBZ.sharkTitle = { build, attract };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  if (CBZ.onAlways) CBZ.onAlways(60, attract);
})();
