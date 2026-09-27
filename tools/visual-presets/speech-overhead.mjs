/*
  speech-overhead.mjs — speech over the speaker's head (systems/speech.js),
  and the prison keycard as an instant grab.

  Subjects boot different modes, and visual-compare shares one page per side,
  so run ONE subject per invocation:
    node tools/visual-compare.mjs --preset speech-overhead --only after --subjects city-talk --no-open
    node tools/visual-compare.mjs --preset speech-overhead --only after --subjects prison-keycard --no-open

  city-talk: two street people a few metres off each say a line to you; the
  words float over their heads, nothing in a bottom band.
  prison-keycard: the player at the unattended desk with the card; the Take
  verb is pinned over the card, and one press takes it (hasKey flips in the
  same frame; there is no 0-100% fill).
*/
export default {
  id: "speech-overhead",
  title: "Speech over heads, keycard grab",
  description: "City conversation over the speakers' heads; the prison desk keycard taken in one press.",
  defaultBefore: "local",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  readyExpression: "document.getElementById('playBtn') && document.querySelector('.mode-btn[data-mode=\"city\"]')",
  subjects: [
    { id: "city-talk", label: "Gang City: two people talk, over their heads", boot: "city" },
    { id: "prison-keycard", label: "Prison: Take over the desk keycard, instant", boot: "escape" },
  ],
  metrics: {
    liveLines: { label: "Lines over heads", unit: "lines", better: "higher" },
    hudSpeech: { label: "Spoken lines in a HUD band", unit: "els", better: "lower" },
    tookInstantly: { label: "Keycard taken in one press", unit: "1=yes", better: "higher" },
  },
  stage: async function stageSpeech(input) {
    const CBZ = window.CBZ;
    if (!CBZ) return { ok: false, err: "no CBZ" };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) { try { if (test()) return true; } catch (_) {} await wait(stepMs || 250); }
      return false;
    };
    const mode = input.subject.boot;
    if (!window.__speechSeq) {
      const booted = await until(() => CBZ.game && CBZ.stepSim && document.querySelector('.mode-btn[data-mode="' + mode + '"]'), 300000);
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('.mode-btn[data-mode="' + mode + '"]').click();
      await wait(250);
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn"); if (b) b.click();
        return CBZ.game.state === "playing";
      }, 300000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      try { if (CBZ.bootMeter && CBZ.bootMeter.hide) CBZ.bootMeter.hide(); } catch (_) {}
      try { if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts"; } catch (_) {}
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      window.requestAnimationFrame = function () { return 0; };
      await wait(600);
      for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      window.__speechSeq = { mode: mode };
      window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
    }
    if (window.__speechSeq.mode !== mode) return { ok: false, err: "page booted " + window.__speechSeq.mode + "; run one subject per invocation" };
    const step = (secs) => {
      const n = Math.max(1, Math.round(secs * 60));
      for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } }
    };
    const P = CBZ.player;
    if (!P || !P.pos) return { ok: false, err: "no player" };
    const face = (x, z) => { if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-(x - P.pos.x), -(z - P.pos.z)); };
    const hudSpeech = () => ["citySpeech", "prisonSpeech", "pinteractSay"].filter((id) => document.getElementById(id)).length +
      document.querySelectorAll(".world-subtitle-line, .hm-sub").length;

    if (input.subject.id === "city-talk") {
      const civs = (CBZ.cityPeds || []).filter((p) => p && !p.dead && !p.vendor && !p.cop && !p.gang && p.pos && p.group);
      if (civs.length < 2) return { ok: false, err: "not enough civilians" };
      let a = civs[0], best = null, bd = 1e9;
      for (let i = 0; i < civs.length; i++) for (let j = i + 1; j < Math.min(civs.length, i + 40); j++) {
        const d = Math.hypot(civs[i].pos.x - civs[j].pos.x, civs[i].pos.z - civs[j].pos.z);
        if (d > 1.6 && d < 4 && d < bd) { bd = d; a = civs[i]; best = civs[j]; }
      }
      const b = best || civs[1];
      const place = () => {
        const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, L = Math.hypot(dx, dz) || 1;
        P.pos.set(mx - dz / L * 5.5, a.pos.y, mz + dx / L * 5.5);
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
        face(mx, mz);
        a.speed = b.speed = 0; a.pause = b.pause = 5;
      };
      place(); step(0.4); place();
      CBZ.speech.clear();
      CBZ.citySay(a, "You lost? This block is not for tourists.", null, { secs: 4, force: true });
      CBZ.citySay(b, "Leave him. He looks like trouble.", null, { secs: 4, force: true });
      step(0.25); place();
      if (CBZ.speech.tick) CBZ.speech.tick(0);
      return { ok: true, lines: CBZ.speech.audit().lines, metrics: { liveLines: CBZ.speech.audit().live, hudSpeech: hudSpeech(), tookInstantly: 0 } };
    }

    // prison-keycard
    const kc = CBZ.keycard;
    if (!kc || !kc.group) return { ok: false, err: "no desk keycard" };
    const kp = kc.group.position;
    // clear the desk of officers so the Take verb is offered
    for (const gd of (CBZ.guards || [])) {
      const gp = gd && (gd.pos || (gd.group && gd.group.position));
      if (gp && Math.hypot(gp.x - kp.x, gp.z - kp.z) < 14) { try { gp.x += 40; } catch (_) {} }
    }
    const place = () => {
      P.pos.set(kp.x + 1.1, P.pos.y, kp.z + 0.6);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      face(kp.x, kp.z);
      if (CBZ.cam) CBZ.cam.pitch = -0.35;
    };
    place(); step(0.4); place(); step(0.2);
    const before = !!CBZ.game.hasKey;
    const prompt = Array.from(document.querySelectorAll("#prisonPrompts *")).map((e) => e.textContent).join(" ").slice(0, 80);
    if (CBZ.escapePlanDesk) CBZ.escapePlanDesk();
    const after = !!CBZ.game.hasKey || !!kc.collected;
    // shoot the moment BEFORE the press would hide the card; re-show the
    // prompt frame by stepping once (the card is now in the bag)
    step(0.1);
    return { ok: true, prompt, before, after,
      metrics: { liveLines: CBZ.speech ? CBZ.speech.audit().live : 0, hudSpeech: hudSpeech(), tookInstantly: (!before && after) ? 1 : 0 } };
  },
};
