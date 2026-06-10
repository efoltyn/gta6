/* ============================================================
   net/netvoice.js — PROXIMITY VOICE. The single most important
   RP feature (every FiveM guide agrees): talk and the people
   near you in the CITY hear you — from their direction, fading
   with distance, gone past ~50m.

   How: WebRTC peer-to-peer mesh (fine at <=16 players), signaled
   over the game server's existing targeted-event relay (ev
   {e:"rtc"} — zero new server endpoints). Each remote voice is
   piped into the game's own AudioContext through a PannerNode
   that tracks that player's avatar (or their car) every frame;
   the listener tracks YOUR camera. Speaking players get a 🔊
   pip over their head (level-gated, piggybacked on the 12Hz
   state stream — no extra messages).

   [Y] toggles your mic. Mic permission is requested on join;
   denied = listen-only. Voice requires HTTPS (or localhost) —
   the cloudflared join link qualifies.
============================================================ */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CBZ || !window.CBZ.net) return;
  if (typeof RTCPeerConnection === "undefined") return;
  const CBZ = window.CBZ;
  const net = CBZ.net;
  const g = CBZ.game;

  const HEAR_DIST = 52;      // hard silence beyond this
  const REF_DIST = 3.5;      // full volume inside this
  const DEFAULT_ICE = [{ urls: "stun:stun.l.google.com:19302" }];

  const voice = {
    enabled: false,          // mic granted + sending
    muted: false,
    peers: new Map(),        // id -> {pc, panner, gain, el, srcHooked, speaking}
    micStream: null,
    micTrack: null,
    analyser: null,
    level: 0,
    speaking: false,
  };
  CBZ.netVoice = voice;

  let ctx = null;
  function audioCtx() {
    if (ctx) return ctx;
    ctx = CBZ.getAudioCtx && CBZ.getAudioCtx();
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    return ctx;
  }

  function iceServers() {
    const s = net.server && net.server.iceServers;
    return Array.isArray(s) && s.length ? s : DEFAULT_ICE;
  }

  // ---- mic ------------------------------------------------------------------
  async function startMic() {
    if (voice.micStream || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      voice.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      voice.micTrack = voice.micStream.getAudioTracks()[0];
      voice.enabled = true;
      // local level meter -> "speaking" flag (state stream picks it up)
      const c = audioCtx();
      if (c) {
        const src = c.createMediaStreamSource(voice.micStream);
        voice.analyser = c.createAnalyser();
        voice.analyser.fftSize = 256;
        src.connect(voice.analyser);
      }
      // late mic grant: add the track to any already-open peer connections
      for (const [id, p] of voice.peers) addMicTo(p.pc);
      hud("🎙 voice on — [Y] to mute");
    } catch (e) {
      voice.enabled = false;
      hud("🔇 mic blocked — you can hear others (listen-only)");
    }
  }

  function addMicTo(pc) {
    if (!voice.micTrack) return;
    const has = pc.getSenders().some((s) => s.track && s.track.kind === "audio");
    if (!has) {
      try { pc.addTrack(voice.micTrack, voice.micStream); } catch (e) {}
    }
  }

  function setMuted(m) {
    voice.muted = m;
    if (voice.micTrack) voice.micTrack.enabled = !m;
    hud(m ? "🔇 mic muted — [Y] to unmute" : "🎙 mic live");
    if (CBZ.city && CBZ.city.note) CBZ.city.note(m ? "🔇 Mic muted" : "🎙 Mic live", 1.4);
  }

  addEventListener("keydown", function (e) {
    if (!net.active || g.state !== "playing") return;
    if (e.key.toLowerCase() === "y" && !e.repeat && document.activeElement && document.activeElement.tagName !== "INPUT") {
      if (!voice.micStream) startMic();
      else setMuted(!voice.muted);
    }
  });

  // mic level -> speaking flag, sampled cheaply
  const lvlBuf = new Uint8Array(128);
  if (CBZ.onAlways) CBZ.onAlways(60.2, function () {
    if (!voice.analyser || voice.muted || !voice.enabled) { voice.speaking = false; return; }
    voice.analyser.getByteTimeDomainData(lvlBuf);
    let peak = 0;
    for (let i = 0; i < lvlBuf.length; i++) { const d = Math.abs(lvlBuf[i] - 128); if (d > peak) peak = d; }
    voice.level = peak / 128;
    voice.speaking = voice.level > 0.045;
  });

  // ---- mesh management --------------------------------------------------------
  // Deterministic initiator rule (no glare): the HIGHER id makes the offer.
  function shouldInitiate(otherId) { return net.id > otherId; }

  function peer(id) {
    let p = voice.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    p = { pc, panner: null, gain: null, el: null, speaking: false, dead: false };
    voice.peers.set(id, p);

    pc.onicecandidate = function (e) {
      if (e.candidate) net.sendEv({ e: "rtc", to: id, sub: "ice", cand: e.candidate });
    };
    pc.ontrack = function (e) {
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      // Chrome quirk: WebRTC audio must be attached to a media element or the
      // WebAudio graph receives silence. Keep it muted; WebAudio does the output.
      const el = new Audio();
      el.srcObject = stream;
      el.muted = true;
      el.play().catch(function () {});
      p.el = el;
      const c = audioCtx();
      if (!c) return;
      try {
        const src = c.createMediaStreamSource(stream);
        const gain = c.createGain();
        gain.gain.value = 0; // silent until positioned
        const panner = c.createPanner();
        panner.panningModel = "equalpower";
        panner.distanceModel = "linear";
        panner.refDistance = REF_DIST;
        panner.maxDistance = HEAR_DIST;
        panner.rolloffFactor = 1;
        src.connect(gain).connect(panner).connect(c.destination);
        p.gain = gain;
        p.panner = panner;
      } catch (err) { console.error("[voice] graph", err); }
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") dropPeer(id);
    };
    // renegotiate when our mic shows up late
    pc.onnegotiationneeded = async function () {
      if (!shouldInitiate(id)) return; // keep one deterministic offerer
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        net.sendEv({ e: "rtc", to: id, sub: "offer", sdp: pc.localDescription });
      } catch (e) {}
    };
    addMicTo(pc);
    // even with no mic we want to RECEIVE
    try { pc.addTransceiver("audio", { direction: voice.micTrack ? "sendrecv" : "recvonly" }); } catch (e) {}
    return p;
  }

  function dropPeer(id) {
    const p = voice.peers.get(id);
    if (!p) return;
    p.dead = true;
    try { p.pc.close(); } catch (e) {}
    if (p.el) { try { p.el.srcObject = null; } catch (e) {} }
    if (p.gain) try { p.gain.disconnect(); } catch (e) {}
    if (p.panner) try { p.panner.disconnect(); } catch (e) {}
    voice.peers.delete(id);
  }

  async function connectTo(id) {
    const p = peer(id);
    if (!shouldInitiate(id)) return; // they will offer to us
    try {
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      net.sendEv({ e: "rtc", to: id, sub: "offer", sdp: p.pc.localDescription });
    } catch (e) { console.error("[voice] offer", e); }
  }

  net.onEv("rtc", async function (m) {
    const id = m.id;
    const p = peer(id);
    try {
      if (m.sub === "offer") {
        await p.pc.setRemoteDescription(m.sdp);
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        net.sendEv({ e: "rtc", to: id, sub: "answer", sdp: p.pc.localDescription });
      } else if (m.sub === "answer") {
        await p.pc.setRemoteDescription(m.sdp);
      } else if (m.sub === "ice" && m.cand) {
        await p.pc.addIceCandidate(m.cand).catch(function () {});
      }
    } catch (e) { console.error("[voice] rtc " + m.sub, e); }
  });

  net.on("welcome", function (m) {
    // I'm the newest player (highest id): I offer to everyone already here.
    startMic();
    for (const q of m.players || []) connectTo(q.id);
  });
  net.on("join", function (m) {
    // the newcomer (higher id) will offer to us; pre-create so ICE can land
    peer(m.id);
  });
  net.on("leave", function (m) { dropPeer(m.id); });
  net.on("_offline", function () { for (const id of [...voice.peers.keys()]) dropPeer(id); });

  // ---- spatialization: voices live where the avatars are ----------------------
  if (CBZ.onAlways) CBZ.onAlways(46.4, function () {
    if (!net.active || g.mode !== "city") return;
    const c = ctx;
    if (!c || c.state !== "running") return;
    // listener = the player (camera orientation)
    const P = CBZ.player;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const L = c.listener;
    try {
      if (L.positionX) {
        L.positionX.value = P.pos.x; L.positionY.value = P.pos.y + 1.7; L.positionZ.value = P.pos.z;
        L.forwardX.value = -Math.sin(yaw); L.forwardY.value = 0; L.forwardZ.value = -Math.cos(yaw);
        L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
      } else {
        L.setPosition(P.pos.x, P.pos.y + 1.7, P.pos.z);
        L.setOrientation(-Math.sin(yaw), 0, -Math.cos(yaw), 0, 1, 0);
      }
    } catch (e) {}
    for (const [id, p] of voice.peers) {
      if (!p.panner || !p.gain) continue;
      const R = CBZ.netRemoteActor ? CBZ.netRemoteActor(id) : null;
      let x = null, y = 1.7, z = 0;
      if (R && R.driving && R.carVis) { x = R.carVis.position.x; z = R.carVis.position.z; y = 1.2; }
      else if (R && R.group) { x = R.group.position.x; y = R.group.position.y + 1.7; z = R.group.position.z; }
      if (x == null) { p.gain.gain.value = 0; continue; }
      try {
        if (p.panner.positionX) { p.panner.positionX.value = x; p.panner.positionY.value = y; p.panner.positionZ.value = z; }
        else p.panner.setPosition(x, y, z);
      } catch (e) {}
      const d = Math.hypot(x - P.pos.x, z - P.pos.z);
      // hard gate beyond earshot + a slight in-car muffle on the sender
      let v = d > HEAR_DIST ? 0 : 1;
      if (R && R.driving) v *= 0.8;
      p.gain.gain.value = v;
    }
  });

  // ---- speaking indicator over heads ------------------------------------------
  // our own flag rides the state stream (net.js asks via this hook)
  net.voiceSpeaking = function () { return voice.speaking && !voice.muted ? 1 : 0; };
  // remote flags arrive on their state messages
  net.on("state", function (m) {
    const p = voice.peers.get(m.id);
    const R = CBZ.netRemoteActor ? CBZ.netRemoteActor(m.id) : null;
    const speaking = !!m.v;
    if (p) p.speaking = speaking;
    if (R && CBZ.netSetSpeaking) CBZ.netSetSpeaking(R, speaking);
  });

  function hud(text) {
    if (CBZ.city && CBZ.city.note) CBZ.city.note(text, 2.2);
    else if (CBZ.flashHint) CBZ.flashHint(text, 2.2);
  }
})();
