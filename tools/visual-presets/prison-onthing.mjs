/* prison-onthing.mjs — THE VERBS ARE ON THE PERSON, photographed.

   OWNER (2026-09-30): "Put the interaction options ONTO the thing being
   interacted with ... for doors and people in the jail game ... On touch,
   interaction options should only show when you touch the character or
   thing." Plus: Grab (the disaster game's grab, its hold set swapped in),
   Trade (two pockets on one table), and a warden with more than Snitch.

   SECOND PASS (owner, on d777ac85): touch verbs back in a fixed dock by the
   thumb, compact, on no other control; desktop verbs beside the man, never
   on his body; door verbs beside the leaf. BEFORE = d777ac85 (verbs pinned
   at his shoulder on both inputs), AFTER = this branch.

   Subjects run in one booted page per side (window.__onthingSeq). Every
   subject re-stages its own man and camera.

   Metrics: verbsShown = verb buttons on screen; overlapPx = px^2 the verbs
   cover of his body / the door (desktop) or of any touch control (touch,
   the trade card included); hudAreaPx = the screen the verbs take.
*/

const FRAMES = ["laptop", "iphone-16:landscape"];

const SUBJECTS = [
  { id: "inmate", label: "An inmate, walked up to",
    focus: "Desktop: his verbs BESIDE him, never on his body. Touch: nothing on anybody until you tap him." },
  { id: "inmate-tap", label: "The same inmate, tapped (touch)",
    focus: "Touch: the tap puts his verbs in the dock left of the thumb cluster, compact, on no other control." },
  { id: "warden-office", label: "The warden in his office",
    focus: "Snitch, Transfer (or Beg), Work (or Protect), Threaten, beside him." },
  { id: "door", label: "An open cell door",
    focus: "Desktop: [E] Close beside the leaf and its frame, not on it. Touch: no pill, the door is the button." },
  { id: "trade", label: "Trade: two pockets on one table",
    focus: "Touch: Offer / Request / Leave in the dock, the table in the free glass, no control covered." },
];

export default {
  id: "prison-onthing",
  title: "Prison: the verbs are on the person",
  description: "Inmate, warden, door, grab and trade, on a laptop and an iPhone, before and after the verbs moved onto the person.",
  subjects: SUBJECTS,
  frameList: FRAMES,
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same seed, same man, same stance: where the verbs are, and which",
  defaultFocus: "Are the verbs on the thing, and on touch only after a tap?",
  metrics: {
    verbsShown: { label: "Verb pills on screen", unit: "pills", better: "higher" },
    overlapPx: { label: "Overlap: desktop verbs on the body/door, touch verbs on a touch control", unit: "px2", better: "lower" },
    hudAreaPx: { label: "HUD area the verbs take", unit: "px2", better: "lower" },
  },

  stage: async function stageOnThing(input) {
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
    let S = window.__onthingSeq;
    if (!S) {
      const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'), 300000);
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('[data-mode="escape"]').click();
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn");
        if (b) b.click();
        return CBZ.game.state === "playing";
      }, 180000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      try { if (CBZ.bootMeter && CBZ.bootMeter.hide) CBZ.bootMeter.hide(); } catch (_) {}
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      window.requestAnimationFrame = function () { return 0; };
      await wait(700);
      // HARNESS TRAP: the run's opening beats (the arrival walk, the first
      // count) still own the player's feet for several seconds after PLAY;
      // the first subject staged inside them was moved back off its man.
      for (let i = 0; i < 720; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      for (const id of ["bootload", "fade", "loading"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
      S = window.__onthingSeq = {};
      window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
    }
    const P = CBZ.player;
    const step = (n) => {
      for (let i = 0; i < (n || 1); i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.stepSim(1 / 60);
        P.hp = 100; P.dead = false;
      }
    };
    const touch = !!CBZ.touchMode;
    const sub = input.subject.id;

    // clean slate between subjects
    try { if (CBZ.prisonTrade && CBZ.prisonTrade.isOpen()) CBZ.prisonTrade.close(); } catch (_) {}
    // a hold from the last subject is let go and allowed to finish (set-down is a beat, not a frame)
    try {
      if (CBZ.grapple && CBZ.grapple.holding()) {
        CBZ.grapple.release(false);
        for (let i = 0; i < 240 && CBZ.grapple.holding(); i++) step(1);
        step(60);
      }
    } catch (_) {}
    try { if (CBZ.prisonPeople) CBZ.prisonPeople.select(null); } catch (_) {}
    try { if (CBZ.prisonSnitch && CBZ.prisonSnitch.close) CBZ.prisonSnitch.close(); } catch (_) {}
    step(20);

    // the man: the same plain inmate every subject (cached), the warden for his two
    const all = (CBZ.npcs || []).concat(CBZ.guards || []);
    let a = null;
    if (sub === "warden" || sub === "warden-office") a = all.filter((x) => x.kind === "warden" && !x.dead)[0];
    else {
      if (!S.inmate || S.inmate.dead) {
        let best = null, bd = 1e9;
        for (const n of CBZ.npcs || []) {
          if (n.dead || n.escaped || !n.group || n.kind !== "inmate" || n._crowd || !n.data) continue;
          if (n.role === "dealer" || n.role === "merchant") continue;
          const d = Math.hypot(n.group.position.x - P.pos.x, n.group.position.z - P.pos.z);
          if (d < bd) { bd = d; best = n; }
        }
        S.inmate = best;
      }
      a = S.inmate;
    }
    if (sub !== "door" && !a) return { ok: false, err: "no actor for " + sub };

    // stand in front of him, facing him; hold it a beat (the brain owns his feet)
    // HARNESS TRAP: a level lens over a seated warden photographed the office
    // ceiling with his head at the bottom edge; the lens now looks at the
    // chest of whoever it faces.
    const face = (x, z, d, ang, y) => {
      P.pos.set(x + Math.sin(ang) * d, P.pos.y, z + Math.cos(ang) * d); P.vy = 0;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      if (CBZ.cam) {
        CBZ.cam.yaw = Math.atan2(-(x - P.pos.x), -(z - P.pos.z));
        // camera.js: POSITIVE pitch looks DOWN
        CBZ.cam.pitch = y == null ? 0.05 : Math.max(-0.2, Math.min(0.5, Math.atan2(((P.pos.y || 0) + 1.6) - (y + 1.15), d)));
      }
    };
    // HARNESS TRAP: the nearest inmate at spawn is usually the cellmate, lying
    // in a bunk or behind the cell's own steel, so "in front of him" put the
    // lens on a mattress. People are staged on open yard ground instead (the
    // warden's office scene sets its own spot first).
    const pin = (actor, d, n, spot) => {
      if (spot) {
        actor.group.position.set(spot.x, 0, spot.z); actor.group.rotation.y = 0; P.pos.y = 0;
        // HARNESS TRAP: ai.js actor separation is undamped; a bystander on the
        // spot shoves the subject out of frame. Clear a 4 m ring first.
        for (const o of all) {
          if (o === actor || !o.group || o.dead) continue;
          const op = o.group.position, dx = op.x - spot.x, dz = op.z - spot.z;
          if (dx * dx + dz * dz < 16) op.set(spot.x + 8 + Math.random() * 4, op.y, spot.z - 6 - Math.random() * 4);
        }
      }
      const q = actor.group.position, ang = actor.group.rotation.y || 0;
      const qx = q.x, qz = q.z, qy = q.y;
      for (let i = 0; i < (n || 30); i++) {
        actor.group.position.set(qx, qy, qz);
        actor.aiState = actor.aiState === "fight" ? "wander" : actor.aiState;
        face(qx, qz, d, ang, (actor.group.position.y || 0));
        step(1);
      }
    };

    if (sub === "door") {
      const cb = CBZ.cellblock, cells = (cb && cb.cells) || [];
      let c = null;
      for (const k of cells) if (k.player && !k.tier) { c = k; break; }
      if (!c) for (const k of cells) if (!k.tier && k.leafClosed) { c = k; break; }
      if (!c) return { ok: false, err: "no ground cell" };
      const L = CBZ.prisonDoorList ? CBZ.prisonDoorList() : [];
      const s = L.filter((x) => x.id === "prison-cell-" + c.i)[0];
      if (s) { try { s.set(true); } catch (_) {} }
      for (let i = 0; i < 70; i++) {
        P.pos.set(c.leafClosed.x, c.fy || 0, c.leafClosed.z + 1.5); P.vy = 0;
        if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P.pos);
        if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(0, 1.5); CBZ.cam.pitch = 0; }
        step(1);
      }
    } else if (sub === "warden-office") {
      // stand him at his desk and you in front of it; he has sent for you
      const W = CBZ.warden;
      a.group.position.set(13.0, 0, -54.5);
      P.pos.set(13.0, 0, -52.6);
      if (W && W.meetNow) W.meetNow("tell");
      pin(a, 2.0, 40);
      if (W && W.meetNow) W.meetNow("tell");
      step(2);
    } else {
      pin(a, sub === "grab" ? 1.0 : 1.6, 90, sub === "warden" ? { x: -2, z: 22 } : { x: 4, z: 24 });
    }

    // touch: the tap, through the real raycast (falls back to select)
    const tapHim = () => {
      if (!a || !CBZ.camera) return;
      CBZ.camera.updateMatrixWorld();
      const v = new T.Vector3(a.group.position.x, a.group.position.y + 1.2, a.group.position.z).project(CBZ.camera);
      const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
      let ok = false;
      try { ok = !!(CBZ.cityTapWorld && CBZ.cityTapWorld(x, y)); } catch (_) {}
      if (CBZ.prisonPeople && !(CBZ.prisonPeople.selected && CBZ.prisonPeople.selected() === a)) CBZ.prisonPeople.select(a);
      return ok;
    };
    if (touch && sub !== "inmate" && sub !== "door") { tapHim(); pin(a, sub === "grab" ? 1.0 : 1.6, 6); }

    const verbIdx = (id) => (CBZ.prisonVerbsFor ? CBZ.prisonVerbsFor(a) : []).indexOf(id);
    if (sub === "grab") {
      const i = verbIdx("grab");
      // the grab is a reach, a grip and a pull: step until the hold is real
      if (i >= 0) {
        for (let tries = 0; tries < 3 && !(CBZ.grapple && CBZ.grapple.holding()); tries++) {
          pin(a, 1.0, 20);
          const j = verbIdx("grab");
          if (j >= 0) CBZ.doInteract(j);
          for (let k = 0; k < 200 && !(CBZ.grapple && CBZ.grapple.holding()); k++) step(1);
        }
        step(20);
      }
    }
    if (sub === "trade") {
      // HARNESS TRAP: officers across the yard shouted "Still open." over the
      // table in the last capture. Every guard goes 25 m off and their lines go.
      for (const o of CBZ.guards || []) {
        if (!o.group || o.kind === "warden") continue;
        o.group.position.set(a.group.position.x + 25, o.group.position.y, a.group.position.z + 25);
      }
      if (CBZ.prisonPeople && touch) CBZ.prisonPeople.select(a);
      step(2);
      document.querySelectorAll("#speech .say").forEach((el) => el.remove());
      if (CBZ.econ) { CBZ.econ.addItem("Soap", 1); CBZ.econ.addItem("Lighter", 1); CBZ.econ.addCigs(20); }
      const i = verbIdx("trade");
      if (i >= 0 && CBZ.prisonTrade) {
        CBZ.doInteract(i); step(2);
        try { CBZ.prisonTrade.put("mine", "Soap", 1); } catch (_) {}
      }
      step(2);
    }

    // ---- measure -----------------------------------------------------------
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
    };
    const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const area = (p, q) => (!p || !q) ? 0 : Math.max(0, Math.min(p.r, q.r) - Math.max(p.l, q.l)) * Math.max(0, Math.min(p.b, q.b) - Math.max(p.t, q.t));
    const union = (rs) => rs.length ? rs.reduce((u, r) => ({ l: Math.min(u.l, r.l), t: Math.min(u.t, r.t), r: Math.max(u.r, r.r), b: Math.max(u.b, r.b) })) : null;
    // the verbs on screen: prompt pills (BEFORE and AFTER), the old card/rail, the trade's buttons
    const wraps = Array.from(document.querySelectorAll("#prisonPrompts .wprompt")).filter(vis);
    const pills = wraps.map((w) => w.querySelector(".tpill")).filter((el) => el && vis(el));
    const oldEls = Array.from(document.querySelectorAll("#interact.show .iopt, #pinteract.show button")).filter(vis);
    const tradeEls = Array.from(document.querySelectorAll("#prisonTrade.show .ptr-act")).filter(vis);
    const tradeCard = tradeEls.length ? document.querySelector("#prisonTrade .ptr-card") : null;
    const verbEls = tradeEls.length ? tradeEls : pills.concat(oldEls);
    const cluster = union((tradeEls.length ? tradeEls : wraps.concat(oldEls)).map(rect));
    // what it must not cover: desktop, his body (capsule) or the door + frame; touch, every control
    const proj = (boxes) => {
      CBZ.camera.updateMatrixWorld();
      const v = new T.Vector3(); let l = 1e9, t = 1e9, r = -1e9, b = -1e9, n = 0;
      for (const B of boxes) for (let k = 0; k < 8; k++) {
        v.set(k & 1 ? B[3] : B[0], k & 2 ? B[4] : B[1], k & 4 ? B[5] : B[2]).project(CBZ.camera);
        if (v.z > 1) continue;
        const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
        l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); n++;
      }
      return n ? { l, t, r, b } : null;
    };
    let overlap = 0;
    if (touch) {
      const ctl = Array.from(document.querySelectorAll("#touch button, #tstick, #hudPauseBtn, #planBtn, #hotbar, #weaponStrip")).filter(vis).map(rect);
      for (const c of ctl) {
        overlap = Math.max(overlap, area(cluster, c));
        if (tradeCard) overlap = Math.max(overlap, area(rect(tradeCard), c));
      }
    } else if (cluster) {
      let target = null;
      if (sub === "door") {
        const tid = (CBZ.prisonDoorTarget && CBZ.prisonDoorTarget() || {}).id;
        const sp = (CBZ.prisonDoorList ? CBZ.prisonDoorList() : []).filter((x) => x.id === tid)[0];
        if (sp) {
          const boxes = [];
          for (const c of (sp.cols ? sp.cols() : [sp.col()]) || []) if (c) { const fy = sp.floor ? sp.floor() : 0; boxes.push([c.minX, fy, c.minZ, c.maxX, fy + 2.3, c.maxZ]); }
          for (const m of sp.pick ? sp.pick() : []) { const bx = new T.Box3().setFromObject(m); if (!bx.isEmpty()) boxes.push([bx.min.x, bx.min.y, bx.min.z, bx.max.x, bx.max.y, bx.max.z]); }
          target = proj(boxes);
        }
      } else if (a && !tradeEls.length) {
        const q = a.group.position, y = q.y || 0;
        target = proj([[q.x - 0.3, y, q.z - 0.3, q.x + 0.3, y + 1.9, q.z + 0.3]]);
      }
      overlap = area(cluster, target);
    }
    const words = verbEls.map((el) => (el.innerText || "").replace(/\s+/g, " ").trim());
    return {
      ok: true, frame: input.frame ? input.frame.id : null, touch,
      who: a && a.data ? a.data.name : null,
      verbs: CBZ.prisonVerbsFor && a ? CBZ.prisonVerbsFor(a) : null,
      pills: words,
      trade: CBZ.prisonTrade ? CBZ.prisonTrade.audit() : null,
      metrics: {
        verbsShown: verbEls.length,
        overlapPx: Math.round(overlap),
        hudAreaPx: cluster ? Math.round((cluster.r - cluster.l) * (cluster.b - cluster.t)) : 0,
      },
    };
  },
};
