/* ============================================================
   race/race_audio.js — THE ENGINE YOU HEAR. No samples: a pushrod V8
   synthesised from its firing order.

   A V8 fires four times a revolution, so the note is rpm/15 Hz (600 Hz
   at 9,000). Two detuned saws on that note and its half give the
   lumpy cross-plane burble, a waveshaper adds the rasp, and a low-pass
   that opens with the throttle is the difference between on the gas
   and coasting. The pack is one more voice whose loudness is how close
   the nearest cars are, panned to where they are. Tyres and wind are
   filtered noise. Everything is created on the first tap (browsers
   refuse audio before a gesture).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  const R = CBZ.race = CBZ.race || {};
  let ctx = null, master, eng, pack, tyre, wind, muted = false;

  function voice(type, f, g) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const n = ctx.createGain(); n.gain.value = g; o.connect(n); o.start(); return { o, n }; }
  function noise() {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
    let s = 1; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823 - 1; }
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true; src.start(); return src;
  }
  function shaper(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    const w = ctx.createWaveShaper(); w.curve = c; return w;
  }
  function engine(gainOut) {
    const a = voice("sawtooth", 100, 0.5), b = voice("sawtooth", 50, 0.35), c = voice("square", 100, 0.12);
    const sh = shaper(6), lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 2.5;
    const g = ctx.createGain(); g.gain.value = 0;
    a.n.connect(sh); b.n.connect(sh); c.n.connect(sh); sh.connect(lp); lp.connect(g); g.connect(gainOut);
    return { a, b, c, lp, g };
  }

  const A = {
    start() {
      if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
      eng = engine(master);
      const pp = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      pack = engine(pp || master); if (pp) { pp.connect(master); pack.pan = pp; }
      const nz = noise();
      const tb = ctx.createBiquadFilter(); tb.type = "bandpass"; tb.frequency.value = 1400; tb.Q.value = 3;
      tyre = ctx.createGain(); tyre.gain.value = 0; nz.connect(tb); tb.connect(tyre); tyre.connect(master);
      const wl = ctx.createBiquadFilter(); wl.type = "lowpass"; wl.frequency.value = 500;
      wind = ctx.createGain(); wind.gain.value = 0; nz.connect(wl); wl.connect(wind); wind.connect(master);
    },
    mute(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.05); },
    beep(go) {
      if (!ctx) return;
      const v = voice("sine", go ? 1320 : 880, 0); v.n.connect(master);
      const t = ctx.currentTime; v.n.gain.setValueAtTime(0.0001, t); v.n.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      v.n.gain.exponentialRampToValueAtTime(0.0001, t + (go ? 0.6 : 0.25)); v.o.stop(t + 0.7);
    },
    update(car, entries, camera, dt) {
      if (!ctx || muted) return;
      const t = ctx.currentTime, k = 0.04;
      const rpm = Math.max(900, car.rpm || 900), f = rpm / 15;
      eng.a.o.frequency.setTargetAtTime(f, t, k); eng.b.o.frequency.setTargetAtTime(f * 0.5, t, k); eng.c.o.frequency.setTargetAtTime(f * 1.003, t, k);
      const thr = car.throttle || 0;
      eng.lp.frequency.setTargetAtTime(420 + thr * 2600 + rpm * 0.12, t, k);
      eng.g.gain.setTargetAtTime(0.16 + thr * 0.2, t, k);
      // the pack: loudest nearby car, panned
      let best = 1e9, bdx = 0, bdz = 0, brpm = 0;
      for (const e of entries) {
        const c = e.car; if (!c || c === car) continue;
        const dx = c.pos.x - camera.position.x, dz = c.pos.z - camera.position.z, d = Math.hypot(dx, dz);
        if (d < best) { best = d; brpm = c.rpm || 6000; bdx = dx; bdz = dz; }
      }
      const pf = Math.max(900, brpm) / 15;
      pack.a.o.frequency.setTargetAtTime(pf, t, 0.08); pack.b.o.frequency.setTargetAtTime(pf * 0.5, t, 0.08); pack.c.o.frequency.setTargetAtTime(pf * 1.01, t, 0.08);
      pack.lp.frequency.setTargetAtTime(1800, t, 0.1);
      pack.g.gain.setTargetAtTime(Math.min(0.28, 5 / Math.max(6, best)), t, 0.1);
      if (pack.pan) {
        // pan by the car's side relative to the camera's right vector
        const m = camera.matrixWorld.elements;
        const px = (bdx * m[0] + bdz * m[2]) / Math.max(1, best);
        pack.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, px)), t, 0.1);
      }
      let slip = 0; if (car.wheels) for (const w of car.wheels) slip = Math.max(slip, w.slip || 0);
      tyre.gain.setTargetAtTime(slip > 0.35 ? (slip - 0.35) * 0.35 : 0, t, 0.05);
      wind.gain.setTargetAtTime(Math.min(0.2, Math.abs(car.speed || 0) / 400), t, 0.2);
    },
  };
  R.audio = A;
})();
