/* prison-haul.mjs — THE CAPTURE IS A SCENE, photographed at fixed instants.

   OWNER (2026-09-05): "goes to this stupid screen way too fast, it should
   show the player getting handcuffed or at least getting tased, I want to
   see my death, not get cut to this stupid screen early."

   BEFORE: haulToCell → a 1.9 s escort whose screen is black from 0.95 s and
   whose strike/transfer lands AT the blackout, so the TRANSFERRED card is up
   about one second after you drop, and on the tower/beat-down paths nobody
   ever tased or visibly cuffed you.
   AFTER: systems/capture.js's haul scene — the screws run to the body, a
   drive-stun, a kneel and the ties, a lift, the perp walk toward your cell,
   THEN the fade, the strike and the card — on its own two-shot camera
   (CBZ.cineCam, the channel camera.js already yields to).

   Each subject = the same haul, sampled at one sim-time instant after
   CBZ.haulToCell fires. Strikes are OFF for the mid-scene subjects so one
   run can be hauled repeatedly (the wake beat returns you to your cell); the
   last subject turns them back ON so the card itself is photographed where
   it now lands.

   Staging facts: rAF stub after boot freezes core/loop.js (CBZ.stepSim is
   the only clock); the player is placed on OPEN FLOOR (beside a patrolling
   guard) before each haul; CBZ.haulToCell exists on both builds. */

const FRAMES = ["laptop:landscape"];

const SUBJECTS = [
  { id: "t2-down",  t: 2.0,  strikes: false, label: "2.0 s after you drop",
    focus: "BEFORE: the card is already up (blackout at 0.95 s). AFTER: you are on the floor, the screws are running in." },
  { id: "t6-cuff",  t: 6.3,  strikes: false, label: "6.3 s — the cuffs",
    focus: "AFTER: a screw kneeling on the body, ties on the wrists. BEFORE: the card." },
  { id: "t9-walk",  t: 9.2,  strikes: false, label: "9.2 s — the walk",
    focus: "AFTER: cuffed, on your feet, marched toward your cell with the screws on your heels. BEFORE: the card." },
  { id: "t11-fade", t: 10.8, strikes: false, label: "10.8 s — the blackout",
    focus: "AFTER: the fade begins only now, in the cuffs. BEFORE: the card." },
  { id: "t13-card", t: 12.5, strikes: true,  label: "12.5 s — the card",
    focus: "Both: the transfer card. AFTER it lands after the scene, not instead of it." },
];

export default {
  id: "prison-haul",
  title: "Prison — the capture is a scene",
  description: "One haul, five instants: what is on screen N seconds after the guards drop you.",
  subjects: SUBJECTS,
  frameList: FRAMES,
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same compound, same seed, same haul — sampled at the same sim-time after the drop",
  defaultFocus: "Can you see yourself being taken, or is it already the card?",
  metrics: {
    cardShown: { label: "The transfer/loss card is on screen", unit: "0/1", better: "lower" },
    cuffsOn: { label: "The player is visibly cuffed", unit: "0/1", better: "higher" },
    screwsNear: { label: "Guards within 3 m of the body", unit: "guards", better: "higher" },
    fade: { label: "Black overlay opacity", unit: "0..1", better: "lower" },
  },
  metricsNote: "cardShown on the last subject is the intended 1 on both sides; the AFTER side reaches it ~11 s later than BEFORE.",

  stage: async function stagePrisonHaul(input) {
    const CBZ = window.CBZ;
    if (!CBZ) return { ok: false, err: "no CBZ" };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { if (test()) return true; } catch (_) {}
        await wait(stepMs || 250);
      }
      return false;
    };
    let S = window.__prisonHaulSeq;
    if (!S) {
      const booted = await until(
        () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") && document.querySelector('[data-mode="escape"]'),
        300000);
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('[data-mode="escape"]').click();
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn"); if (b) b.click();
        return CBZ.game.state === "playing";
      }, 180000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      window.requestAnimationFrame = function () { return 0; };
      await wait(700);
      for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      for (const id of ["bootload", "loading"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
      const overlay = document.createElement("div");
      overlay.id = "__haulOverlay";
      overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      overlay.innerHTML = "<div data-side></div><div data-name></div><div data-nums></div>";
      document.body.appendChild(overlay);
      S = window.__prisonHaulSeq = { overlay };
      window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
    }
    const step = (secs) => {
      const n = Math.max(1, Math.round(secs * 60));
      for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    };
    const sub = input.subject;
    if (CBZ.game.state !== "playing") return { ok: false, err: "run not playing: " + CBZ.game.state };
    const P = CBZ.player, ch = CBZ.playerChar;
    // open floor: beside the third-farthest patrolling guard (the yard, not your wing)
    const gs = (CBZ.guards || []).filter((g) => !g.dead && g.group)
      .sort((a, b) => Math.hypot(b.group.position.x - P.pos.x, b.group.position.z - P.pos.z) - Math.hypot(a.group.position.x - P.pos.x, a.group.position.z - P.pos.z));
    const spot = gs[2] || gs[0];
    if (spot) { P.pos.set(spot.group.position.x + 1.5, spot.group.position.y, spot.group.position.z); P.vy = 0; if (ch) ch.group.position.copy(P.pos); }
    CBZ.game.invuln = 0; P.hp = 100; P.subdue = 0;
    step(0.5);
    CBZ.CONFIG.JAIL_STRIKES = !!sub.strikes;
    CBZ.haulToCell("CAUGHT");
    step(sub.t);

    const fadeEl = document.getElementById("fade");
    const fade = fadeEl ? Math.round(parseFloat(fadeEl.style.opacity || "0") * 100) / 100 : 0;
    const card = document.getElementById("survlose");
    const cardShown = !!(card && getComputedStyle(card).display !== "none" && parseFloat(getComputedStyle(card).opacity || "1") > 0.05) ? 1 : 0;
    let near = 0;
    for (const g of CBZ.guards || []) if (!g.dead && g.group && Math.hypot(g.group.position.x - P.pos.x, g.group.position.z - P.pos.z) < 3) near++;
    const phase = CBZ.jailEscortPhase ? CBZ.jailEscortPhase() : "(old escort)";

    const before = input.side === "before";
    const q = (n) => S.overlay.querySelector("[data-" + n + "]");
    q("side").textContent = before ? input.beforeLabel : input.afterLabel;
    q("side").style.cssText = "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:" + (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
    q("name").textContent = sub.label;
    q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:20px;font-weight:800;letter-spacing:-.02em;max-width:420px";
    q("nums").textContent = "phase " + phase + " · cuffed " + (ch && ch.cuffed ? "yes" : "no") + " · fade " + fade + " · card " + (cardShown ? "UP" : "no") + " · state " + CBZ.game.state;
    q("nums").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
    return {
      ok: true, phase, state: CBZ.game.state, caught: CBZ.game.caughtCount,
      metrics: { cardShown, cuffsOn: ch && ch.cuffed ? 1 : 0, screwsNear: near, fade },
    };
  },
};
