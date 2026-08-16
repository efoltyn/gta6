/* prison-doors.mjs — CAN YOU SHUT IT? the close verb, photographed.

   OWNER (verbatim, 2026-08-15): "all doors should open or close when pressed.
   I like auto open, don't remove, but I want ability to close. Of course still
   needing key. This is really mostly adding CLOSE BY TAP ON MOBILE, no button
   needed."

   WHAT THE TWO SIDES ARE. The deployed build's prison doors are one-way
   valves: five files own a door primitive and between them they publish one
   public close (CBZ.closeDoor), which only a lockdown and the run reset call.
   Walk up with the card and it opens; there is no input in the game that shuts
   it again. The local build declares every leaf into one registry
   (CBZ.prisonDoorList, systems/interactions.js) that a tap and the polled [E]
   both drive.

   BOTH SIDES RUN THE SAME STAGE CODE, and it is the REAL mechanism on each:
     · shut        — park the player out of range and let the compound settle
                     (the wing and admin leaves shut themselves 3 s after you
                     leave; the yard gate and the armoury are put back with
                     their own public fields)
     · auto-opened — hand him the Keycard and walk him into the file's own
                     approach radius. Nothing is forced; this is the feature
                     the owner asked NOT to lose, so it is photographed.
     · tapped-shut — fire CBZ.cityTapWorld(x, y) at the leaf's own projected
                     pixel. That hook is old and present on both builds; the
                     deployed one simply has no door in its raycast list, so
                     the identical input lands on nothing and the frame shows
                     the door still standing open. That is the whole diff.

   EVERY NUMBER IS MEASURED, and the two that matter are build-agnostic on
   purpose — `openingSolid` counts live CBZ.colliders across the doorway
   rather than trusting a flag, and `latchHeldS` counts seconds the leaf stays
   shut while the player STANDS IN the radius that would auto-open it. A close
   that is undone by the auto-open in the next frame would score 0 there and
   look identical in the pixels.

   Staging facts (read 2026-08-15): rAF stub after boot freezes core/loop.js
   (CBZ.stepSim is the only clock); yard checkpoint at (0,-8) with a 4 m
   approach; the west sally gate at (-30, 22) with a 2.49 m approach
   (world/prisonwings.js `near2 < 6.2`); the tool crib at (-108.9, 28) behind a
   3.2 s pick; the armoury gate at (19, 1) with a 3.74 m approach; the cell
   fronts read off CBZ.cellblock.cells[0].leafClosed on both builds.
*/

const DOORS = [
  {
    key: "yard", label: "Yard checkpoint", id: "prison-yard-door",
    at: { x: 0, z: -8 }, stand: { x: 0, z: -10.6 }, park: { x: 0, z: 26 },
    route: "key", autoR: 4.0,
    cam: { x: 0.0, y: 2.85, z: -17.0, ax: 0, ay: 1.75, az: -8 },
    focus: "The 5.7 m detention leaf. It rises into its wall pocket for the card and, after this wave, comes back down for a finger.",
  },
  {
    key: "sally", label: "West sally gate", id: "prison-sally-w1",
    at: { x: -30, z: 22 }, stand: { x: -28.2, z: 22 }, park: { x: -12, z: 22 },
    route: "key", autoR: 2.5,
    cam: { x: -22.5, y: 2.9, z: 14.0, ax: -30, ay: 1.4, az: 22 },
    focus: "A barred pivot leaf in the internal division wall. Watch the leaf swing and the lamp: red locked, green open.",
  },
  {
    key: "crib", label: "Tool crib cage", id: "prison-tool-crib",
    at: { x: -108.9, z: 28 }, stand: { x: -108.9, z: 26.4 }, park: { x: -108.9, z: 12 },
    route: "pick", autoR: 2.5,
    cam: { x: -108.9, y: 2.6, z: 21.5, ax: -108.9, ay: 1.4, az: 28 },
    focus: "The 3.2 s hold-to-pick cage. Its OPEN route must stay a hold — a tap may shut it and must never shortcut the pick.",
  },
  {
    key: "armoury", label: "Armoury gate", id: "prison-armory",
    at: { x: 19, z: 1 }, stand: { x: 16.4, z: 1 }, park: { x: 4, z: 1 },
    route: "key", autoR: 3.75,
    cam: { x: 12.6, y: 3.0, z: 1.0, ax: 19, ay: 2.2, az: 1 },
    focus: "The door the whole keycard story is built on. Vertical slide, welded barred leaf on a transparent collider pane.",
  },
  {
    key: "cell", label: "Cell front", id: "prison-cell-0",
    at: null, stand: { x: 0, z: 1.6 }, park: { x: 0, z: 5.5 },  // resolved off cells[0]
    route: "open", autoR: 6.0,
    cam: { x: 0.4, y: 1.95, z: 3.4, ax: 0, ay: 1.4, az: 0 },   // relative to the leaf
    relative: true,
    focus: "Thirteen sliding grilles that stood permanently open. The day schedule re-opens them every 0.35 s — the latch is what makes a hand-shut cell stay shut.",
  },
];

const STATES = [
  { key: "shut", label: "1 · shut", note: "Resting state. The opening is solid: a collider is across it and the lamp is red." },
  { key: "open", label: "2 · auto-opened", note: "Approach with the credential. NOTHING is pressed — this is the auto-open the owner asked to keep." },
  { key: "tapped", label: "3 · tapped shut", note: "One CBZ.cityTapWorld at the leaf, from a standstill INSIDE the auto-open radius. Deployed: nothing happens." },
];

const subjects = [];
for (const d of DOORS) {
  for (const s of STATES) {
    subjects.push({
      id: d.key + "-" + s.key,
      label: d.label + " — " + s.label,
      door: d,
      state: s.key,
      focus: d.focus + "  " + s.note,
    });
  }
}

export default {
  id: "prison-doors",
  title: "Prison — a door you can shut again",
  description:
    "Every door type in the escape compound photographed shut, auto-opened, and tapped shut again. " +
    "The deployed build has no close verb at all, so the third frame of each row is the diff.",
  subjects,
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same compound, same seed, same synthesized tap — the close verb is the variable",
  defaultFocus:
    "Is the leaf across its opening, and did the SAME input produce it on both sides?",
  metrics: {
    doorsWithCloseVerb: { label: "Doors in the compound exposing a close verb", unit: "doors", better: "higher" },
    doorsAnsweringTap: { label: "Door types that answer a synthesized world tap", unit: "of 5", better: "higher" },
    doorOpen: { label: "This door is open", unit: "1=open", better: "lower" },
    openingSolid: { label: "Live colliders across this doorway", unit: "colliders", better: "higher" },
    latchHeldS: { label: "Seconds it stayed shut while stood in the auto-open radius", unit: "s", better: "higher" },
  },
  metricsNote:
    "openingSolid counts CBZ.colliders whose AABB covers the door point — measured, not read off a flag, so it means the same on both builds. " +
    "latchHeldS is only sampled on the tapped-shut frames; on the shut/auto-open frames it reports 0. " +
    "doorsAnsweringTap probes all five door types once per page and caches the result.",

  stage: async function stagePrisonDoors(input) {
    const CBZ = window.CBZ;
    const T = window.THREE;
    if (!CBZ || !T) return { ok: false, err: "no CBZ/THREE" };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { if (test()) return true; } catch (_) {}
        await wait(stepMs || 250);
      }
      return false;
    };

    let S = window.__prisonDoorSeq;
    if (!S) {
      const booted = await until(
        () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
          document.querySelector('[data-mode="escape"]'),
        300000
      );
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('[data-mode="escape"]').click();
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn");
        if (b) b.click();
        return CBZ.game.state === "playing";
      }, 180000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      window.requestAnimationFrame = function () { return 0; };
      await wait(700);
      for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

      const overlay = document.createElement("div");
      overlay.id = "__doorOverlay";
      overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      overlay.innerHTML = "<div data-side></div><div data-name></div><div data-nums></div><div data-source></div>";
      document.body.appendChild(overlay);

      S = window.__prisonDoorSeq = { overlay, probed: null };
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };
    }

    const step = (secs) => {
      const n = Math.max(1, Math.round(secs * 60));
      for (let i = 0; i < n; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.stepSim(1 / 60);
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
      }
    };
    // Stand still and MEAN it: re-assert the position every tick. Sampling
    // once a second let a body slide three metres off a closing leaf, which
    // reads in the numbers as "the latch failed" when what failed was the
    // staging — the latch had correctly released a man who walked away.
    const holdAt = (x, z, secs) => {
      const n = Math.max(1, Math.round(secs * 60));
      for (let i = 0; i < n; i++) { place(x, z); step(1 / 60); }
    };
    const place = (x, z) => {
      const P = CBZ.player;
      if (!P || !P.pos) return;
      P.pos.set(x, 0, z); P.vy = 0;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(x, 0, z);
    };
    const setHud = (visible) => {
      const canvas = CBZ.renderer && CBZ.renderer.domElement;
      for (const child of Array.from(document.body.children)) {
        if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
        if (child.id === "__doorOverlay") continue;
        child.style.visibility = visible ? "" : "hidden";
      }
    };

    // ---- the shared vocabulary, written so it works on a build that has no
    //      door registry at all (every lookup is feature-detected) ----------
    const spec = (id) => {
      if (!CBZ.prisonDoorList) return null;
      const L = CBZ.prisonDoorList();
      for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
      return null;
    };
    const cellOf = () => {
      const cb = CBZ.cellblock;
      return (cb && cb.cells && cb.cells.length) ? cb.cells[0] : null;
    };
    // Where this subject's door IS. The cell front resolves off the live cell
    // so both builds photograph the same leaf without a magic number.
    const doorPoint = (d) => {
      if (d.at) return { x: d.at.x, z: d.at.z };
      const c = cellOf();
      return c && c.leafClosed ? { x: c.leafClosed.x, z: c.leafClosed.z } : { x: 0, z: 0 };
    };
    // MEASURED, NOT READ OFF A FLAG, and identical on both builds: how many
    // live colliders actually cover the doorway point. A shut door is 1; an
    // open one is 0. This is the metric that cannot be faked by a leaf drawn
    // in the wrong place.
    const openingSolid = (p) => {
      const list = CBZ.colliders || [];
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c || c.minX == null) continue;
        if (p.x >= c.minX - 0.25 && p.x <= c.maxX + 0.25 && p.z >= c.minZ - 0.25 && p.z <= c.maxZ + 0.25) n++;
      }
      return n;
    };
    // Is it open? Prefer the registry; otherwise ask the build's own public
    // handles, and fall back to the collider measurement above.
    const isOpen = (d) => {
      const s = spec(d.id);
      if (s) { try { return !!s.isOpen(); } catch (_) {} }
      if (d.key === "yard") return !!(CBZ.door && CBZ.door.open);
      if (d.key === "armoury") return !!(CBZ.armory && CBZ.armory.open);
      if (d.key === "cell") { const c = cellOf(); return !!(c && !c.locked); }
      return openingSolid(doorPoint(d)) === 0;
    };
    const tapLeaf = (d) => {
      const p = doorPoint(d);
      let centre = new T.Vector3(p.x, 1.4, p.z);
      const s = spec(d.id);
      let meshes = null;
      if (s && s.pick) { try { meshes = s.pick(); } catch (_) { meshes = null; } }
      if (!meshes && d.key === "yard" && CBZ.door) meshes = [CBZ.door.mesh];
      if (!meshes && d.key === "armoury" && CBZ.armory) meshes = [CBZ.armory.gate];
      if (!meshes && d.key === "cell") { const c = cellOf(); if (c && c.bars) meshes = [c.bars]; }
      if (meshes && meshes.length) {
        const box = new T.Box3();
        box.makeEmpty();
        for (let i = 0; i < meshes.length; i++) if (meshes[i]) { meshes[i].updateWorldMatrix(true, true); box.expandByObject(meshes[i]); }
        if (!box.isEmpty()) box.getCenter(centre);
      }
      // the player's own eye, aimed at the leaf — exactly the ray a thumb casts
      const cam = CBZ.camera;
      cam.position.set(CBZ.player.pos.x, CBZ.player.pos.y + 1.6, CBZ.player.pos.z);
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);
      const v = centre.clone().project(cam);
      const r = CBZ.renderer.domElement.getBoundingClientRect();
      if (!CBZ.cityTapWorld) return false;
      try {
        return !!CBZ.cityTapWorld(r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height);
      } catch (_) { return false; }
    };
    const giveCard = () => {
      CBZ.game.hasKey = true;
      try { if (CBZ.econ && CBZ.econ.addItem) CBZ.econ.addItem("Keycard", 1); } catch (_) {}
    };
    const givePick = () => {
      try { if (CBZ.econ && CBZ.econ.addItem && CBZ.econ.hasItem && !CBZ.econ.hasItem("Lockpick")) CBZ.econ.addItem("Lockpick", 1); } catch (_) {}
    };

    const sub = input.subject;
    const D = sub.door;
    const P0 = doorPoint(D);
    // subject coordinates: the cell front's stand/park/cam are relative to its
    // own leaf, everything else is authored in world space
    const rel = !!D.relative;
    const stand = rel ? { x: P0.x + D.stand.x, z: P0.z + D.stand.z } : D.stand;
    const park = rel ? { x: P0.x + D.park.x, z: P0.z + D.park.z } : D.park;
    const cam = rel
      ? { x: P0.x + D.cam.x, y: D.cam.y, z: P0.z + D.cam.z, ax: P0.x + D.cam.ax, ay: D.cam.ay, az: P0.z + D.cam.az }
      : D.cam;

    giveCard();
    if (D.route === "pick") givePick();

    /* ---- 1. BACK TO SHUT. Walk out of range and let the compound settle:
       the wing and admin leaves shut themselves 3 s after you leave, which is
       the mechanism both builds share. The two vertical slides have no such
       timer, so they are put back through their own public state — on the
       deployed build that means writing the same three fields systems/state.js
       writes at a reset, because that build has no close to call. */
    /* Every beat samples the door and the player's REAL position afterwards.
       A staging bug and a feature failure look identical in a photograph; the
       trace is what tells them apart when the numbers surprise you. */
    const trace = [];
    const mark = (what) => trace.push([what, isOpen(D) ? 1 : 0,
      Math.round(Math.hypot(CBZ.player.pos.x - P0.x, CBZ.player.pos.z - P0.z) * 10) / 10]);

    place(park.x, park.z);
    step(4.2);
    mark("parked");
    if (isOpen(D)) {
      // Prefer the real verb when the build has one: CBZ.prisonDoorSet goes
      // through the shared act, so the close LATCHES and the cell schedule
      // (which re-opens every leaf every 0.35 s) cannot undo the staging.
      if (CBZ.prisonDoorSet) { try { CBZ.prisonDoorSet(D.id, false); } catch (_) {} }
      else if (D.key === "yard" && CBZ.closeDoor) { try { CBZ.closeDoor(); } catch (_) {} }
      else if (D.key === "armoury" && CBZ.armory) {
        const a = CBZ.armory;
        a.open = false; a.t = 0; a.gate.position.y = 3;
        a.lamp.material.color.setHex(0xff3b3b); a.lamp.material.emissive.setHex(0xff0000);
        if (CBZ.colliders.indexOf(a.collider) === -1) CBZ.colliders.push(a.collider);
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      } else if (D.key === "cell" && CBZ.cellblock && CBZ.cellblock.setDoor) {
        try { CBZ.cellblock.setDoor(cellOf(), true); } catch (_) {}
      }
      step(1.0);
      mark("forced-shut");
    }

    let latchHeldS = 0, tapTook = 0;
    if (sub.state !== "shut") {
      /* ---- 2. AUTO-OPEN. Walk in with the credential and press nothing.
         The pick cage is the exception BY DESIGN: its open route is a 3.2 s
         hold, so the beat holds [E] for it — a tap must never shortcut that,
         which is why the local build refuses openByTap on this door. */
      place(stand.x, stand.z);
      if (D.route === "pick") {
        CBZ.keys["e"] = true;
        for (let i = 0; i < 60; i++) { place(stand.x, stand.z); step(0.1); if (isOpen(D)) break; }
        CBZ.keys["e"] = false;
      } else if (D.route === "open") {
        // a cell front has no lock and no auto-open: it simply stands open
        const s = spec(D.id);
        if (s) { try { s.set(true); } catch (_) {} }
        else if (CBZ.cellblock && CBZ.cellblock.setDoor) { try { CBZ.cellblock.setDoor(cellOf(), false); } catch (_) {} }
      }
      for (let i = 0; i < 30 && !isOpen(D); i++) { place(stand.x, stand.z); step(0.1); }
      step(1.2);                       // let the leaf finish travelling
      mark("auto-opened");
    }

    if (sub.state === "tapped") {
      /* ---- 3. THE TAP, then FIVE SECONDS OF STANDING STILL. The player does
         not step back: he is inside the radius that auto-opened this door, so
         a close that is merely a suggestion scores 0 here. */
      place(stand.x, stand.z);
      tapTook = tapLeaf(D) ? 1 : 0;
      step(0.6);
      mark("tapped");
      for (let t = 0; t < 5; t++) {
        holdAt(stand.x, stand.z, 1.0);
        mark("hold+" + (t + 1) + "s");
        if (isOpen(D)) break;
        latchHeldS = t + 1;
      }
    }

    /* ---- the compound-wide numbers, probed ONCE per page ------------------
       doorsAnsweringTap walks all five types, opens each and fires the same
       synthesized tap at it. On the deployed build the raycast list contains
       no doors at all, so this is 0 and every third frame below is a photo of
       a door that would not shut. */
    if (S.probed == null) {
      // The probe asks "does this door answer a tap FROM A MAN WHO COULD HAVE
      // OPENED IT" — so it holds both credentials. Without the Lockpick the
      // cages correctly refuse, and the number would be measuring the refusal
      // instead of the verb.
      giveCard(); givePick();
      let answered = 0; const answeredIds = []; const detail = [];
      for (const dd of [
        { key: "yard", id: "prison-yard-door", at: { x: 0, z: -8 }, stand: { x: 0, z: -10.6 } },
        { key: "sally", id: "prison-sally-w1", at: { x: -30, z: 22 }, stand: { x: -28.2, z: 22 } },
        { key: "crib", id: "prison-tool-crib", at: { x: -108.9, z: 28 }, stand: { x: -108.9, z: 26.4 } },
        { key: "armoury", id: "prison-armory", at: { x: 19, z: 1 }, stand: { x: 16.4, z: 1 } },
        { key: "cell", id: "prison-cell-0", at: null, stand: { x: 0, z: 1.6 } },
      ]) {
        const pp = doorPoint(dd);
        const st = dd.at ? dd.stand : { x: pp.x + dd.stand.x, z: pp.z + dd.stand.z };
        // hold the body still while it lands: a 100 m teleport can be ejected
        // by whatever it arrived inside, and a probe that measures a door from
        // four metres away is measuring the walk-to path, not the tap
        holdAt(st.x, st.z, 0.8);
        const s2 = spec(dd.id);
        if (s2) { try { s2.set(true); } catch (_) {} }
        else if (dd.key === "yard" && CBZ.openDoor) { try { CBZ.openDoor(); } catch (_) {} }
        else if (dd.key === "cell" && CBZ.cellblock) { try { CBZ.cellblock.setDoor(cellOf(), false); } catch (_) {} }
        holdAt(st.x, st.z, 0.6);
        const couldOpen = isOpen(dd);
        const took = couldOpen ? (tapLeaf(dd) ? 1 : 0) : 0;
        if (couldOpen) holdAt(st.x, st.z, 0.4);
        const shut = couldOpen && !isOpen(dd);
        detail.push({ key: dd.key, opened: !!couldOpen, tapTook: took, shut: !!shut,
          d: Math.round(Math.hypot(CBZ.player.pos.x - pp.x, CBZ.player.pos.z - pp.z) * 10) / 10 });
        if (shut) { answered++; answeredIds.push(dd.key); }
      }
      S.probed = answered; S.probedIds = answeredIds; S.probeDetail = detail;
      // put the staged door back the way this subject wants it
      place(park.x, park.z);
      step(4.2);
      if (sub.state === "shut") {
        if (isOpen(D)) { const s3 = spec(D.id); if (s3) { try { s3.set(false); } catch (_) {} } }
      } else {
        place(stand.x, stand.z);
        for (let i = 0; i < 40 && !isOpen(D); i++) step(0.1);
        if (sub.state === "tapped") { tapLeaf(D); step(0.6); }
      }
      step(0.6);
    }

    // ---- measure -----------------------------------------------------------
    const audit = CBZ.prisonDoorAudit ? CBZ.prisonDoorAudit() : null;
    const openNow = isOpen(D) ? 1 : 0;
    const solid = openingSolid(P0);

    // ---- frame and render --------------------------------------------------
    setHud(false);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    const camera = CBZ.camera;
    camera.aspect = input.width / input.height;
    camera.fov = 55;
    camera.near = 0.3;
    camera.far = 20000;
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.ax, cam.ay, cam.az);
    camera.updateProjectionMatrix();
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    else {
      const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
      if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
    }
    CBZ.renderer.render(CBZ.scene, camera);

    const before = input.side === "before";
    const q = (n) => S.overlay.querySelector("[data-" + n + "]");
    q("side").textContent = before ? input.beforeLabel : input.afterLabel;
    q("side").style.cssText = "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:" + (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
    q("name").textContent = sub.label;
    q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:420px";
    q("nums").textContent = "door " + (openNow ? "OPEN" : "SHUT") +
      " · colliders across the opening " + solid +
      " · close verbs in the compound " + (audit ? audit.doors : 0) +
      (sub.state === "tapped" ? (" · tap took " + tapTook + " · latch held " + latchHeldS + "s") : "");
    q("nums").style.cssText = "position:absolute;top:106px;left:27px;color:#c0cfda;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
    q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
    q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

    return {
      ok: true,
      door: D.key,
      state: sub.state,
      hasRegistry: !!CBZ.prisonDoorList,
      tapTook,
      tapProbe: S.probedIds || [],
      tapProbeDetail: S.probeDetail || [],
      trace,                     // [what, open, metres from the door] per beat
      auditRow: audit ? (audit.rows.filter((r) => r.id === D.id)[0] || null) : null,
      metrics: {
        doorsWithCloseVerb: audit ? audit.doors : 0,
        doorsAnsweringTap: S.probed || 0,
        doorOpen: openNow,
        openingSolid: solid,
        latchHeldS,
      },
    };
  },
};
