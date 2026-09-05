/* prison-prompts.mjs — THE PROMPT IS ON THE THING, photographed.

   OWNER (2026-09-05): "theres an issue with interact with like to close your
   cell, this should show up on the thing not in the middle of the screen —
   on the cell door it should say to press e to close, instead of a button in
   middle of screen saying press e to close cell. you always put the noun on
   the button but really the noun should be what the button is on and it
   shouldnt say what its on, like sabotage power should just be sabotage."

   BEFORE: every prison walk-up prompt is a sentence in a fixed HUD slot —
   "Press [E] to close your cell door" in #hint at bottom-centre on a keyboard,
   a "Sabotage Power" pill in the bottom band on touch. The word carries the
   noun because the box is nowhere near the thing.
   AFTER: one element, a verb, pinned over the world point it is about
   (systems/interactions.js prisonPrompt + css/hud.css .wprompt). Desktop shows
   a key chip, touch shows the same node as a tappable pill.

   MEASURED on both builds without trusting either's API: the visible prompt
   is whichever of #hint.show / #prisonPrompts .tpill / .wprompt is on screen;
   pxFromThing is the pixel distance from that label's foot to the thing's own
   projected point (the leaf, the box, the grate) through the live camera;
   wordsOnPrompt counts its words; nounOnPrompt is 1 when the text names the
   object it sits on.

   Staging facts: rAF stub after boot freezes core/loop.js (CBZ.stepSim is the
   only clock); the player's cell = CBZ.cellblock.cells[i].player, leaf at
   .leafClosed; breaker stand spot CBZ.breaker.x/z is 0.7 m in front of the
   box; a vent with .dest is a crawl point; escape-mode crouch is keys.c.
   The camera is the game's own third-person rig — the prompt is placed
   through CBZ.camera at always-order 96, so a hand-posed camera would put the
   label somewhere the render is not.
*/

const FRAMES = ["laptop:landscape", "ipad-mini:landscape"];

const SUBJECTS = [
  {
    id: "cell-door", label: "Your cell door — Close",
    focus: "Standing in your own open cell door. BEFORE: a sentence in the HUD slot naming the door. AFTER: [E] Close, on the leaf. (Touch has no pill for this by design — you tap the door.)",
  },
  {
    id: "breaker", label: "The breaker box — Sabotage",
    focus: "Stood at the breaker. BEFORE: \"Press [E] to Sabotage Power\" at bottom-centre / a \"Sabotage Power\" band pill. AFTER: Sabotage, over the box.",
  },
  {
    id: "vent", label: "A vent grate — Crawl",
    focus: "Crouched on a grate. BEFORE: \"Press [E] to Crawl to <room>\" in the HUD slot. AFTER: Crawl over the grate, the destination as a small second line.",
  },
];

export default {
  id: "prison-prompts",
  title: "Prison — the prompt is on the thing",
  description:
    "Three walk-up verbs in the escape compound on a laptop and an iPad: where the prompt sits and what it says.",
  subjects: SUBJECTS,
  frameList: FRAMES,
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same compound, same seed, same stance — where the words are, and which words",
  defaultFocus: "Is the prompt on the thing, and is it a verb without the noun?",
  metrics: {
    promptShown: { label: "A prompt is on screen", unit: "0/1", better: "higher" },
    pxFromThing: { label: "Pixels from the prompt to the thing it is about", unit: "px", better: "lower" },
    wordsOnPrompt: { label: "Words on the prompt", unit: "words", better: "lower" },
    nounOnPrompt: { label: "The prompt names the object it sits on", unit: "0/1", better: "lower" },
  },
  metricsNote:
    "pxFromThing is measured from the label's bottom-centre to the thing's projected point through the camera that rendered the frame. " +
    "On the touch frame of the cell door no prompt exists on either build (the door itself is the button), so that row reads 0 shown.",

  stage: async function stagePrisonPrompts(input) {
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

    let S = window.__prisonPromptSeq;
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

      // The boot card (#bootload, systems/bootprogress.js) fades on rAF, and
      // the rAF stub above froze it mid-fade over the whole frame. The world
      // is built — it is the rest of the HUD that is the subject here.
      for (const id of ["bootload", "fade", "loading"]) {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
      }
      const overlay = document.createElement("div");
      overlay.id = "__promptOverlay";
      overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      overlay.innerHTML = "<div data-side></div><div data-name></div><div data-nums></div>";
      document.body.appendChild(overlay);
      S = window.__prisonPromptSeq = { overlay };
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
    const P = CBZ.player;
    const place = (x, z, y) => {
      P.pos.set(x, y || 0, z); P.vy = 0;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(x, y || 0, z);
    };
    const aim = (x, z) => {
      const vx = x - P.pos.x, vz = z - P.pos.z;
      if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-vx, -vz); CBZ.cam.pitch = 0; }
    };
    // hold the body, the aim and the stance every tick — a standstill that is
    // sampled once drifts, and a drifted body reads as "no prompt"
    const hold = (x, z, y, tx, tz, crouch, secs) => {
      const n = Math.max(1, Math.round(secs * 60));
      for (let i = 0; i < n; i++) {
        place(x, z, y); aim(tx, tz);
        CBZ.keys["c"] = !!crouch; CBZ.keys["control"] = !!crouch;
        if (crouch) P.crouch = true;
        step(1 / 60);
      }
    };
    const spec = (id) => {
      if (!CBZ.prisonDoorList) return null;
      const L = CBZ.prisonDoorList();
      for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
      return null;
    };

    // ---- the thing, and where to stand for it -------------------------------
    const sub = input.subject;
    let thing = null, stand = null, crouch = false, y0 = 0;
    if (sub.id === "cell-door") {
      const cb = CBZ.cellblock;
      const cells = (cb && cb.cells) || [];
      let c = null;
      for (let i = 0; i < cells.length; i++) if (cells[i].player && !cells[i].tier) { c = cells[i]; break; }
      if (!c) for (let i = 0; i < cells.length; i++) if (!cells[i].tier && cells[i].leafClosed) { c = cells[i]; break; }
      if (!c) return { ok: false, err: "no ground-tier cell" };
      y0 = c.fy || 0;
      thing = { x: c.leafClosed.x, y: 1.4 + y0, z: c.leafClosed.z };
      stand = { x: c.leafClosed.x, z: c.leafClosed.z + 1.5 };
      // it must stand OPEN for a close verb to exist — the registry's own set
      const s = spec("prison-cell-" + c.i);
      if (s) { try { s.set(true); } catch (_) {} }
      else if (cb && cb.setDoor) { try { cb.setDoor(c, false); } catch (_) {} }
    } else if (sub.id === "breaker") {
      const b = CBZ.breaker;
      if (!b) return { ok: false, err: "no breaker" };
      const box = b.box && b.box.position;
      thing = box ? { x: box.x, y: box.y + 0.35, z: box.z } : { x: b.x, y: 2.0, z: b.z - 0.7 };
      stand = { x: b.x, z: b.z };
    } else {
      const vents = CBZ.vents || [];
      let v = null;
      for (let i = 0; i < vents.length; i++) if (vents[i].dest && vents[i].dest.name) { v = vents[i]; break; }
      if (!v) return { ok: false, err: "no vent with a destination" };
      const g = v.grate || v;
      thing = { x: g.x, y: (v.y || 0.1) + 0.55, z: g.z };
      stand = { x: v.x, z: v.z };
      crouch = true;
    }

    hold(stand.x, stand.z, y0, thing.x, thing.z, crouch, 1.2);

    // ---- measure ----------------------------------------------------------
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
    };
    let promptEl = null;
    const cands = Array.from(document.querySelectorAll("#prisonPrompts .tpill, #hint"));
    for (const el of cands) {
      if (el.id === "hint" && !el.classList.contains("show")) continue;
      if (!vis(el)) continue;
      // an anchored label's wrapper may be display:none while the pill is not
      const wrap = el.closest(".wprompt");
      if (wrap && !vis(wrap)) continue;
      promptEl = el; break;
    }
    const text = promptEl ? (promptEl.innerText || "").replace(/\s+/g, " ").trim() : "";
    const v = new T.Vector3(thing.x, thing.y, thing.z).project(CBZ.camera);
    const tx = (v.x * 0.5 + 0.5) * innerWidth, ty = (-v.y * 0.5 + 0.5) * innerHeight;
    let px = 0;
    if (promptEl) {
      const r = promptEl.getBoundingClientRect();
      const fx = r.left + r.width / 2, fy = r.bottom;
      px = Math.round(Math.hypot(fx - tx, fy - ty));
    }
    const words = text ? text.split(/\s+/).filter((w) => !/^\[?[A-Z]\]?$/.test(w) && w !== "HOLD" && w.toLowerCase() !== "press" && w.toLowerCase() !== "to").length : 0;
    const noun = /\b(cell|door|power|vent|hatch|crate|lock|padlock|safe|racks)\b/i.test(text) ? 1 : 0;

    const before = input.side === "before";
    const q = (n) => S.overlay.querySelector("[data-" + n + "]");
    q("side").textContent = before ? input.beforeLabel : input.afterLabel;
    q("side").style.cssText = "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:" + (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
    q("name").textContent = sub.label;
    q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:20px;font-weight:800;letter-spacing:-.02em;max-width:420px";
    q("nums").textContent = (text ? "prompt: “" + text + "”" : "no prompt") + " · " + px + " px from the thing";
    q("nums").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";

    return {
      ok: true,
      frame: input.frame ? input.frame.id : null,
      touch: document.body.classList.contains("touch"),
      text, thingPx: [Math.round(tx), Math.round(ty)],
      surface: promptEl ? (promptEl.id === "hint" ? "#hint" : (promptEl.closest(".wprompt") ? ".wprompt" : "#prisonPrompts band")) : "",
      audit: CBZ.prisonPromptAudit ? CBZ.prisonPromptAudit() : null,
      metrics: {
        promptShown: promptEl ? 1 : 0,
        pxFromThing: px,
        wordsOnPrompt: words,
        nounOnPrompt: noun,
      },
    };
  },
};
