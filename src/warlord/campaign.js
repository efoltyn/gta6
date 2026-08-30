/* ============================================================
   warlord/campaign.js — RIDING IT.

   The campaign is one picture: a man crossing an enormous desert with a
   column of men behind him that gets LONGER. Everything in this file
   serves that picture or gets out of its way.

   CONTROLS ARE THE WHOLE PITCH, so they are two verbs and no more:

     TAP / CLICK THE GROUND  →  ride there. A marker drops where you
       pointed and he goes. The pick is an analytic march against
       W.desert.heightAt, NOT a mesh raycast: the clipmap under the
       cursor is 512 m-per-quad two kilometres out, so a raycast would
       put the marker up to a hundred metres from where you pointed
       while the function knows the real answer everywhere.
     HOLD WASD / DRAG THE STICK  →  steer him yourself, camera-relative.
       Touching the stick cancels the destination, because a game that
       argues with you about where you are going is a game with two
       drivers.

     TAP A PARTY  →  ride at it and engage it. The pick is screen-space,
       so a party two kilometres out is a 46 px target rather than a
       three-metre one, and the ride target TRACKS it — you are chasing a
       thing that is running, not a coordinate it used to be at.

   And the camera is not a fourth verb: it follows behind on its own,
   a drag swings it, the wheel or a pinch pulls it from over-the-shoulder
   out to a strategic view of the whole valley. There is NO mouse-look
   mode and nothing needs pointer lock.

   THAT IS THE ENTIRE CONTROL SURFACE and it is a hard line. Every key on
   this page (WASD, Q/E, M) is a CONVENIENCE for something already reachable
   with one tap, and if a player has to learn one, this file has failed.

   WHY studio.controls AND NOT A NEW CONTROL SCHEME. It already owns the
   WASD-or-stick branch, the touch furniture, the pause button a phone
   otherwise cannot press, and the look delta from either a mouse drag or
   a right-side thumb. Re-typing that is how every page in games/ got its
   own subtly different half-working version. What it has no concept of
   is CLICK-TO-GO, so that — and only that — is added here, on top: a
   press that moves less than a few pixels is a destination, a press that
   drags is the camera. One rule, both input methods.

   THE TRAIL IS THE GAME. Followers walk a breadcrumb of where you have
   actually been, with a per-man lateral offset, so the column bends
   through the wadi you rode down instead of sliding after you as a rigid
   blob. Only 60 of them are DRAWN — the roster can be a thousand and the
   difference between sixty men and four hundred on screen at this camera
   distance is nothing you can count, while sixty voxel rigs would be a
   thousand draw calls. The drawn men are instanced (2 draw calls for
   every man on the island, yours and theirs); YOU are a real studio.cast
   rig, because the one body the camera is actually near has to be a real
   body.

   THE WORLD IS ON WALL TIME AND IT NEVER STOPS. This is a multiplayer
   island — openfront's shared board with Bannerlord's parties on it — and
   several warlords ride it at once, so the clock cannot be "time passes
   when I do something". `W.state.hour` advances on REAL seconds, the bands
   keep walking while you are inside a battle, an encounter card or a shop,
   and if the tab was in the background for ninety seconds the world catches
   up on the wall clock rather than pretending nothing happened.

   Mechanically that means the world tick is a `CBZ.onAlways` hook, not a
   `micro.onFrame` one: `always` runs in every phase AND while the engine is
   paused, which is the engine's own contract for exactly this. Only the
   DRAWING is gated on being the live phase. The first draft ticked the
   world from the render hook and the island froze solid the moment a battle
   took the screen — in single player you cannot tell, and in multiplayer it
   is the whole game being wrong.

   NOT EVERY CLIENT ROLLS THE DICE. In multiplayer one peer is the sim host
   and everyone else RENDERS what it is sent, so all the AI (moods, goals,
   band-vs-band, respawn) sits behind `C.simHost`. A guest still draws
   S.bands, still detects its own contacts, still runs its own clock — it
   just never invents a band or moves one. And nothing here assumes it is
   the only writer of `W.state.bands`: a band that arrives over the wire has
   none of this file's fields on it, so every band is normalised on the way
   into the loop instead of being trusted to have been made here.

   PEERS ARE PARTIES. Other warlords are drawn by THIS FILE, straight off
   `W.state.peers` ({id,name,x,z,size,colour}) — the contract's own home for
   them — through the same instanced bodies and the same banner the AI bands
   use, so a human party and a computer party are the same object on screen.
   warnet.js only has to keep that map up to date; it never draws.

   core/daynight.js was read and is NOT used: it is wired into CBZ.lightRig
   and core/sky.js which this page does not load, and it owns its own
   free-running cycle — this clock has to be the one the network agrees on.

   Flags:
     ?bands=N        population override (default scales with the island)
     ?trail=off      draw no followers (the honest A/B for the trail)
     ?clock=off      freeze the day cycle at noon
     ?bandai=off     bands walk their goals and never react to you
     ?guest=1        boot as a sim GUEST: render bands, never roll them

   Events raised here: `campaign:ready` `campaign:dest` `campaign:band`
   `campaign:zoom` — {dist, t, yaw, x, z}. territory.js reads this so its
   ownership map and this camera are the same view at two ranges.
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const THREE = G.THREE;
  const S = W.state;

  const QP = (function () {
    try { return new URLSearchParams(G.location ? G.location.search : ""); }
    catch (e) { return { get: function () { return null; } }; }
  })();
  const FLAG_NOTRAIL = QP.get("trail") === "off";
  const FLAG_NOCLOCK = QP.get("clock") === "off";
  const FLAG_NOBANDAI = QP.get("bandai") === "off";
  const FLAG_GUEST = QP.get("guest") === "1";

  const C = W.campaign = W.campaign || {};
  /* ONE PEER ROLLS THE DICE. Default true so single player is unchanged;
     warnet.js flips it false on a guest and this file becomes a renderer
     for whatever S.bands it is handed. Everything gated by it is an
     AUTHORING act — inventing a band, moving one, deciding a fight. A guest
     still runs its own clock, its own camera and its own contact test,
     because those are about the player in front of this screen. */
  C.simHost = !FLAG_GUEST;
  const TAU = Math.PI * 2;
  const clamp = W.clamp;
  const lerp = W.lerp;

  /* ============================================================ NUMBERS
     Every one of these is derived from something or was measured, per the
     house rule. None of them is a taste. */
  const RIDE_SPEED = 15.5;      // m/s. The island is 13 km; at 15.5 m/s a
                                // corner-to-corner ride is ~14 min of real
                                // time and ~16 in-game hours — one day's
                                // ride, which is the unit the game counts in.
  const BAND_SPEED = 6.2;       // they walk, you ride. The gap is what makes
                                // "outrun them" a real option.
  const HUNT_SPEED = 8.4;       // a band that wants you moves like it means it
  /* AN HOUR IS 45 REAL SECONDS, and that number is derived, not chosen: the
     island is 13 km across and a ride across it at RIDE_SPEED takes about
     14 real minutes, which used to be defined as one day's ride. Keeping
     that identity on a wall clock puts a 24 h day at 18 real minutes and an
     hour at 45 s. The shape of the pacing is unchanged; what changed is that
     it is now the same for everybody on the island whether they are riding,
     shopping or in a battle. */
  const HOUR_SECS = 45;
  const CATCHUP_MAX = 120;      // sim substeps a single wake-up may run — see worldTick
  const DRAWN_FOLLOWERS = 60;   // see the header. The roster is uncapped.
  const CONTACT = 26;           // metres. The encounter card comes up here.
  const OUTPOST_R = 46;
  const BAND_DRAW = 1500;       // past this a party is fewer than two pixels;
                                // the world map is where you see them instead
  const NAMEPLATE_R = 340;
  const TRAIL_STEP = 1.6;       // breadcrumb spacing, metres
  const TRAIL_MAX = 420;        // breadcrumbs kept = 670 m of column

  /* ============================================================ STATE */
  let ctx = null, micro = null, scene = null, camera = null;
  let live = false, built = false;
  let root = null;                 // everything this file draws
  let controls = null;
  let you = null, youRig = null;   // the real cast body
  let menBody = null, menHead = null, banner = null, pole = null;
  let marker = null, markerT = 0;
  let dest = null;                 // {x,z} or null
  let camYaw = 0, camDist = 46, camDistWant = 46, camHeight = 0;
  let breadcrumbs = [];            // [{x,z}] newest last
  let crumbAcc = 0;
  let travelled = 0;
  let hudRoot = null, plateBox = null, compass = null, compassG = null, mapWrap = null;
  let bandTick = 0, fightTick = 0, spawnTick = 0;
  let lastWall = 0;
  let chase = null;                // the band you tapped, if any
  let lastZoomSent = -1;
  const peerDraw = [];             // {x,z,size,colour,name} rebuilt each frame
  let nearBand = null, nearOutpost = null;
  const _v = { x: 0, z: 0 };

  /* ============================================================ THE WORLD
     Outposts and bands are placed ONCE per campaign, off the seeded stream,
     so the same seed is the same island with the same people on it. */

  const OUTPOST_KINDS = [
    { kind: "depot", label: "DEPOT", note: "guns and powder", colour: 0xb0763a },
    { kind: "camp",  label: "CAMP",  note: "men for hire",    colour: 0x7a8f4a },
    { kind: "town",  label: "TOWN",  note: "both, dearer",    colour: 0xc2a05a },
  ];

  function placeOutposts() {
    const D = W.desert;
    S.outposts.length = 0;
    /* SIX TO NINE, and they are placed AT LANDMARKS rather than at random:
       an outpost in the middle of an anonymous erg is a shop you can only
       find by accident. Every oasis gets one (that is what an oasis is FOR
       in a desert economy), and the rest go on the coast where a boat could
       reach them. */
    const named = ["MARA", "TIN OUZAL", "DUST GATE", "SABKHA", "REDWALL", "GHARIB",
                   "SALT CROSS", "LOW WELL", "BONE CAMP", "FARKH LANDING"];
    let n = 0;
    for (let i = 0; i < D.oases.length && n < 5; i++) {
      const o = D.oases[i];
      const p = D.landPoint(W.rnd, { near: { x: o.x, z: o.z }, nearR: o.r * 2.4, maxSlope: 0.24 });
      S.outposts.push(makeOutpost(named[n % named.length], n % 3 === 1 ? "camp" : "town", p, o.name));
      n++;
    }
    for (let guard = 0; guard < 400 && S.outposts.length < 8; guard++) {
      const a = W.rnd() * TAU;
      const p = coastPoint(a);
      if (!p) continue;
      let clash = false;
      for (let i = 0; i < S.outposts.length; i++) {
        if (Math.hypot(S.outposts[i].x - p.x, S.outposts[i].z - p.z) < 1800) { clash = true; break; }
      }
      if (clash) continue;
      S.outposts.push(makeOutpost(named[n % named.length], n % 2 ? "depot" : "camp", p, null));
      n++;
    }
    return S.outposts;
  }
  function coastPoint(a) {
    const D = W.desert;
    // walk in from beyond the coast until the ground is 4 m up: a landing,
    // not a beach you would drown a crate on
    for (let r = D.RADIUS + 1100; r > 800; r -= 40) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = D.heightAt(x, z);
      if (y > 4 && D.slopeAt(x, z) < 0.22) return { x: x, z: z, y: y };
    }
    return null;
  }
  function makeOutpost(name, kind, p, at) {
    const K = OUTPOST_KINDS.filter(function (k) { return k.kind === kind; })[0] || OUTPOST_KINDS[0];
    return {
      id: "op" + (S.outposts.length + 1),
      name: name, kind: kind, label: K.label, note: K.note,
      x: p.x, z: p.z, y: p.y != null ? p.y : W.desert.heightAt(p.x, p.z),
      at: at || null,
      colour: K.colour,
      biome: W.desert.biomeAt(p.x, p.z),
      wealth: clamp(0.3 + W.rnd() * 0.6, 0.2, 0.95),
      restocked: 0,
    };
  }

  /* BAND POPULATION. Sized to the island, not typed: one party per ~2.6 km²
     of land gives ~55 on this island, which is dense enough that a ride of
     two minutes meets somebody and sparse enough that you are not being
     mobbed. Sizes follow a power law — three men is common, three hundred is
     a thing you tell stories about. */
  function bandTarget() {
    const q = parseInt(QP.get("bands") || "", 10);
    if (q > 0) return Math.min(140, q);
    const D = W.desert;
    const landKm2 = Math.PI * (D.RADIUS / 1000) * (D.RADIUS / 1000) * 0.72;
    return Math.round(clamp(landKm2 / 2.6, 40, 70));
  }
  function rollSize() {
    // pow(u, 3.1) on 3..300: median ~22, one in fifty over 120
    const u = W.rnd();
    return Math.max(3, Math.round(3 + Math.pow(u, 3.1) * 297));
  }
  function spawnBand(opts) {
    opts = opts || {};
    const D = W.desert;
    const p = opts.at || D.landPoint(W.rnd, { maxSlope: 0.30 });
    const b = W.makeBand({ size: opts.size == null ? rollSize() : opts.size, x: p.x, z: p.z });
    b.y = D.heightAt(b.x, b.z);
    b.yaw = W.rnd() * TAU;
    /* THESE THREE FIELDS ARE ADDED HERE, not in core, on purpose: they are
       CAMPAIGN facts (where is it walking, does it remember losing to me,
       when may it bother me again) and they mean nothing to the battle or
       the network. core.js declares the band; this file declares how a band
       behaves on a map. */
    b.scared = 0;                 // rounds lost to you — a beaten band avoids you
    b.think = W.rnd() * 1.6;      // stagger the AI so 60 bands never think together
    b.pause = 0;
    pickGoal(b);
    S.bands.push(b);
    return b;
  }
  function pickGoal(b) {
    const D = W.desert;
    const r = W.rnd();
    /* THEY GO SOMEWHERE, and where is the difference between a world and a
       screensaver. Half the time an outpost (that is where the money is),
       a quarter an oasis (that is where the water is), a quarter open sand. */
    if (r < 0.5 && S.outposts.length) {
      const o = W.pick(S.outposts);
      b.goal = { x: o.x + (W.rnd() - 0.5) * 160, z: o.z + (W.rnd() - 0.5) * 160, why: o.name };
    } else if (r < 0.75 && D.oases.length) {
      const o = W.pick(D.oases);
      b.goal = { x: o.x + (W.rnd() - 0.5) * 200, z: o.z + (W.rnd() - 0.5) * 200, why: o.name };
    } else {
      const p = D.landPoint(W.rnd, { maxSlope: 0.30 });
      b.goal = { x: p.x, z: p.z, why: "" };
    }
    b.mood = "roam";
  }

  /* ============================================================ ENTER */
  C.enter = function () {
    const D = W.desert;
    if (!D || !D.heightAt) { W.toast("the island did not load", "bad"); return; }
    if (!built) buildOnce();

    D.build({ seed: S.seed, at: { x: S.you.x, z: S.you.z } });
    D.show();

    if (!S.outposts.length) { placeOutposts(); outpostsRaised = false; }
    if (!outpostsRaised) { raiseOutposts(); outpostsRaised = true; }
    if (!S.bands.length) {
      const n = bandTarget();
      for (let i = 0; i < n; i++) spawnBand();
      W.log(S.bands.length + " parties are somewhere out there.");
    }
    /* YOU START ON A BEACH. Not in the middle: the first thing the game has
       to teach is that this is an ISLAND, and the cheapest way to teach it
       is to put the sea behind you on frame one. */
    if (!S.you.placed) {
      const a = W.rnd() * TAU;
      const p = coastPoint(a) || D.landPoint(W.rnd, {});
      S.you.x = p.x; S.you.z = p.z; S.you.yaw = Math.atan2(-p.x, -p.z);
      S.you.placed = true;
      breadcrumbs.length = 0;
    }
    camYaw = S.you.yaw;
    dest = null;
    if (!lastWall) lastWall = performance.now();
    showAll(true);
    W.setPhase("campaign");
    live = true;
    if (ctx && ctx.paintHud) ctx.paintHud();
    W.emit("campaign:ready", S);
  };

  function buildOnce() {
    built = true;
    root = new THREE.Group();
    root.name = "warlordCampaign";
    scene.add(root);

    /* YOU. The one body a camera ever gets near, so it is the shipped rig.
       `officer` because the wardrobe reads as somebody in charge and that is
       free characterisation. */
    youRig = CBZ.studio && CBZ.studio.cast ? CBZ.studio.cast("officer", { color: 0xc46a33, variant: 3 }) : null;
    if (youRig) root.add(youRig);
    else {
      // people pack absent: a placeholder that is honestly a placeholder
      youRig = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.8, 0.35),
        new THREE.MeshLambertMaterial({ color: 0xc46a33 }));
      root.add(youRig);
    }
    youRig.castShadow = true;

    buildMen();
    buildMarker();
    buildOutpostProps();
    buildHud();

    controls = CBZ.studio.controls("walk", { buttons: {}, pause: true });
    bindPointer();

    micro.onFrame(step, { order: 5, id: "warlord-campaign" });
    /* THE DAY TINT IS THE BASE COAT AND IT RUNS FIRST. events.js ships
       weather — a sandstorm has to be able to grey the sun out — and two
       modules writing CBZ.sun in the same frame is decided purely by hook
       order. So the clock's tint goes in at -20, before every gameplay hook,
       and anything that wants to modify the light runs after it and wins.
       (microboot's own restore is an `always` hook, which runs before all of
       these, so this still lands on a clean rig every frame.) */
    micro.onFrame(function () { if (built) tintDay(); }, { order: -20, id: "warlord-daytint" });
    /* THE WORLD, ON THE WALL CLOCK, IN EVERY PHASE. `always` is the engine's
       own name for "runs even while paused" and that is exactly the contract
       a shared island needs: the bands must keep walking while this player
       is reading an encounter card, fighting a battle, or has the tab in the
       background. Order 30 is after microboot's own light restore (9) and
       after nothing else on this page. */
    if (CBZ.onAlways) CBZ.onAlways(30, worldTick);
    else micro.onFrame(function () { worldTick(); }, { order: -5 });

    /* THE ISLAND IS HIDDEN, NOT DESTROYED, when the battle takes the screen.
       Rebuilding 14 km of terrain after every fight is ~30 k heightAt calls
       and a visible stall, for a world that did not change. */
    W.on("phase:leave:campaign", function () { live = false; showAll(false); });
    W.on("phase:campaign", function () {
      live = true; showAll(true);
      if (W.desert.show) W.desert.show();
    });
    W.on("newgame", function () {
      S.you.placed = false;
      outpostsRaised = false;
      breadcrumbs.length = 0;
      dest = null;
    });
  }

  function showAll(on) {
    if (root) root.visible = !!on;
    if (hudRoot) hudRoot.style.display = on ? "block" : "none";
    if (!on && mapWrap) mapWrap.style.display = "none";
    if (controls && controls.show) controls.show(!!on);
    if (!on && W.desert.hide) W.desert.hide();
  }

  /* ============================================================ THE MEN
     ONE PAIR OF INSTANCED MESHES for every drawn man on the island — your
     column and every warband inside BAND_DRAW. Measured on this laptop:
     60 studio.cast rigs is ~1 100 draw calls and 22 fps; this is 2 draw
     calls and the frame does not notice. A voxel rig is the right answer
     for the man the camera is standing next to and the wrong answer for
     the four hundred read at 200 m. */
  const MEN_CAP = 980;
  function buildMen() {
    const bodyG = new THREE.CylinderGeometry(0.26, 0.38, 1.30, 6);
    const headG = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    const bodyM = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const headM = new THREE.MeshLambertMaterial({ color: 0xffffff });
    menBody = new THREE.InstancedMesh(bodyG, bodyM, MEN_CAP);
    menHead = new THREE.InstancedMesh(headG, headM, MEN_CAP);
    menBody.castShadow = true;
    menBody.frustumCulled = menHead.frustumCulled = false;
    menBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    menHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    menBody.count = menHead.count = 0;
    root.add(menBody); root.add(menHead);

    /* THE BANNER IS THE MAP MARKER, and it is a real object in the world so
       it obeys the terrain and the fog like everything else. Its height and
       its flag scale with log2(party size): six men and two hundred men have
       to be TELLABLE APART at strategic zoom or the whole "should I go near
       that" decision has no information in it. Log, not linear, because a
       linear pole for 300 men is 120 m tall and looks like a bug. */
    const poleG = new THREE.CylinderGeometry(0.13, 0.13, 1, 5);
    const flagG = new THREE.BoxGeometry(1, 0.62, 0.12);
    flagG.translate(0.5, 0, 0);
    pole = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: 0x3b3128 }), 160);
    banner = new THREE.InstancedMesh(flagG, new THREE.MeshLambertMaterial({ color: 0xffffff }), 160);
    pole.frustumCulled = banner.frustumCulled = false;
    pole.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    banner.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pole.count = banner.count = 0;
    root.add(pole); root.add(banner);
  }

  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p3 = new THREE.Vector3();
  const _s3 = new THREE.Vector3();
  const _col = new THREE.Color();
  function inst(mesh, n, x, y, z, yaw, sx, sy, sz, colour) {
    if (n >= mesh.instanceMatrix.count) return n;
    _e.set(0, yaw, 0); _q.setFromEuler(_e);
    _p3.set(x, y, z); _s3.set(sx, sy, sz);
    _m4.compose(_p3, _q, _s3);
    mesh.setMatrixAt(n, _m4);
    if (colour != null && mesh.setColorAt) { _col.setHex(colour); mesh.setColorAt(n, _col); }
    return n + 1;
  }

  /* Bright enough to read AGAINST SAND, which is the only background this
     game has. The first pass used mid-tones picked in the abstract and every
     tier photographed as the same dark speck on a pale dune. */
  const TIER_COLOUR = { levy: 0xc9b489, raider: 0xd2743c, soldier: 0x7fa05e, veteran: 0x5f88b4 };

  /* ============================================================ MARKER */
  function buildMarker() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 3.4, 24),
      new THREE.MeshBasicMaterial({ color: 0xffb15a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 900;
    g.add(ring);
    /* A BEAM, because a ring on the ground 900 m away behind a dune is not
       on screen at all and the whole point of the marker is that you can see
       where you told him to go. depthTest off so it reads through terrain. */
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 26, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb15a, transparent: true, opacity: 0.30, depthTest: false, side: THREE.DoubleSide }));
    beam.position.y = 13;
    beam.renderOrder = 899;
    g.add(beam);
    g.visible = false;
    marker = g;
    root.add(g);
  }

  /* ============================================================ OUTPOSTS
     Four boxes and a mast. That is not laziness — an outpost's SCREEN is
     outpost.js's job and this is the thing you ride at, which needs to be
     recognisable from a kilometre and nothing more. */
  let outpostRoot = null, outpostsRaised = false;
  function buildOutpostProps() {
    outpostRoot = new THREE.Group();
    root.add(outpostRoot);
  }
  function raiseOutposts() {
    while (outpostRoot.children.length) outpostRoot.remove(outpostRoot.children[0]);
    for (let i = 0; i < S.outposts.length; i++) {
      const o = S.outposts[i];
      const g = new THREE.Group();
      g.position.set(o.x, o.y, o.z);
      const wm = new THREE.MeshLambertMaterial({ color: 0xbaa07a });
      const rm = new THREE.MeshLambertMaterial({ color: 0x7d6244 });
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * TAU + W.hash01(o.x, o.z, 61 + j) * 0.9;
        const r = 10 + W.hash01(o.x + j, o.z, 71) * 12;
        const w = 4 + W.hash01(o.x, o.z + j, 81) * 4;
        const h = 3 + W.hash01(o.x + j, o.z + j, 91) * 2.6;
        const hut = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.85), j % 2 ? wm : rm);
        const hx = Math.cos(a) * r, hz = Math.sin(a) * r;
        hut.position.set(hx, W.desert.heightAt(o.x + hx, o.z + hz) - o.y + h / 2, hz);
        hut.rotation.y = a;
        hut.castShadow = hut.receiveShadow = true;
        g.add(hut);
        micro.addBoxCollider(o.x + hx, o.y + hut.position.y, o.z + hz, w, h, w * 0.85);
      }
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 16, 6),
        new THREE.MeshLambertMaterial({ color: 0x4a3d2c }));
      mast.position.y = 8;
      g.add(mast);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 0.16),
        new THREE.MeshLambertMaterial({ color: o.colour }));
      flag.position.set(2.4, 14.4, 0);
      g.add(flag);
      outpostRoot.add(g);
    }
  }

  /* ============================================================ THE HUD
     Only the pieces this file owns: the compass, the nameplates, the map
     button and the world map. The top strip belongs to the shell. */
  function buildHud() {
    const d = document.createElement("div");
    d.id = "wlCampHud";
    d.style.cssText = "position:fixed;inset:0;z-index:45;pointer-events:none;";
    d.innerHTML =
      '<style>' +
      '#wlCampHud .plate{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;' +
        'font:700 11px/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:.12em;' +
        'padding:3px 8px;border-radius:8px;background:rgba(12,9,5,.72);border:1px solid rgba(255,255,255,.16);' +
        'color:#f4ecd8;text-shadow:0 1px 2px #000}' +
      '#wlCampHud .plate i{font-style:normal;opacity:.65;margin-left:7px}' +
      '#wlCampHud .plate.hunt{border-color:#c4453a;color:#ffc9c4}' +
      '#wlCampHud .plate.flee{border-color:#5aa86a;color:#c9ffd4}' +
      '#wlCampHud .plate.op{border-color:#ffb15a;color:#ffd7bd}' +
      '#wlCampHud .plate.peer{border-color:#7fa8c8;color:#d8ecff}' +
      '#wlCompass{position:absolute;left:50%;transform:translateX(-50%);' +
        'bottom:calc(env(safe-area-inset-bottom,0px) + 14px);opacity:.9}' +
      '#wlMapBtn{position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);' +
        'top:calc(env(safe-area-inset-top,0px) + 52px);pointer-events:auto;cursor:pointer;' +
        'appearance:none;border:1px solid rgba(255,255,255,.2);border-radius:12px;' +
        'background:rgba(12,9,5,.62);color:#f4ecd8;padding:10px 13px;font:700 12px/1 ui-sans-serif,system-ui,sans-serif;' +
        'letter-spacing:.16em}' +
      '#wlZoom{position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);' +
        'top:calc(env(safe-area-inset-top,0px) + 100px);display:flex;flex-direction:column;gap:8px}' +
      '#wlZoom button{pointer-events:auto;cursor:pointer;width:42px;height:42px;border-radius:12px;' +
        'border:1px solid rgba(255,255,255,.2);background:rgba(12,9,5,.62);color:#f4ecd8;' +
        'font:700 18px/1 ui-sans-serif,system-ui,sans-serif}' +
      '#wlMap{position:fixed;inset:0;z-index:60;display:none;background:rgba(8,6,4,.93);' +
        'pointer-events:auto;align-items:center;justify-content:center;flex-direction:column;gap:12px}' +
      '#wlMap.on{display:flex}' +
      '#wlMap canvas{border:1px solid rgba(255,255,255,.18);border-radius:10px;' +
        'max-width:min(86vw,86vh);max-height:min(86vw,86vh);image-rendering:auto}' +
      '#wlMap .cap{font:700 11px/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.22em;opacity:.6;color:#f4ecd8}' +
      '</style>' +
      '<div id="wlPlates"></div>' +
      '<canvas id="wlCompass" width="460" height="36"></canvas>' +
      '<button id="wlMapBtn">MAP</button>' +
      '<div id="wlZoom"><button id="wlIn">+</button><button id="wlOut">&minus;</button></div>';
    document.body.appendChild(d);
    hudRoot = d;
    plateBox = d.querySelector("#wlPlates");
    compass = d.querySelector("#wlCompass");
    compassG = compass.getContext("2d");

    const mw = document.createElement("div");
    mw.id = "wlMap";
    mw.innerHTML = '<div class="cap">THE ISLAND — TAP TO CLOSE</div><canvas id="wlMapC"></canvas>' +
                   '<div class="cap" id="wlMapLeg"></div>';
    document.body.appendChild(mw);
    mapWrap = mw;
    mw.addEventListener("pointerdown", function () { mw.classList.remove("on"); });

    d.querySelector("#wlMapBtn").addEventListener("click", function (e) { e.stopPropagation(); toggleMap(); });
    d.querySelector("#wlIn").addEventListener("click", function () { camDistWant = clamp(camDistWant * 0.62, 16, 520); });
    d.querySelector("#wlOut").addEventListener("click", function () { camDistWant = clamp(camDistWant * 1.6, 16, 520); });

    window.addEventListener("keydown", function (e) {
      if (!live) return;
      if (e.code === "KeyM") toggleMap();
    });
  }

  /* THE OWNERSHIP MAP IS NOT MINE. territory.js owns regions, factions and
     who holds what, and two world maps on one island is exactly the kind of
     duplication this repo's rules exist to stop — so if it is loaded, the
     MAP button is its button and this file's own screen never opens. What
     stays here is the FALLBACK: a page booted without territory.js still has
     to be able to see where it is. Both draw the same W.desert.mapTexture;
     only the layer on top differs. */
  function toggleMap() {
    if (W.territory && W.territory.open) {
      try { W.territory.open({ x: S.you.x, z: S.you.z, dist: camDist }); return; }
      catch (e) { console.error("[warlord] territory.open", e); }
    }
    if (!mapWrap) return;
    const on = !mapWrap.classList.contains("on");
    mapWrap.classList.toggle("on", on);
    if (on) paintMap();
  }

  /* THE WORLD MAP IS THE REAL ISLAND, painted from the same heightAt and
     biomeAt everything else reads — so it cannot lie about where the salt
     pan is. Markers are drawn over it every time it is opened. */
  function paintMap() {
    const D = W.desert;
    const SZ = 512;
    const src = D.mapTexture(SZ);
    const cv = document.getElementById("wlMapC");
    if (!cv || !src) return;
    cv.width = cv.height = SZ;
    const g = cv.getContext("2d");
    g.drawImage(src, 0, 0);
    function P(x, z) { return D.mapProject(x, z, SZ); }
    // oases
    g.font = "700 9px ui-sans-serif,system-ui,sans-serif";
    for (let i = 0; i < D.oases.length; i++) {
      const o = D.oases[i], p = P(o.x, o.z);
      g.fillStyle = "#39d0a8"; g.beginPath(); g.arc(p.x, p.y, 3.4, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,255,255,.72)"; g.fillText(o.name, p.x + 6, p.y + 3);
    }
    for (let i = 0; i < S.outposts.length; i++) {
      const o = S.outposts[i], p = P(o.x, o.z);
      g.fillStyle = "#ffb15a";
      g.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
      g.fillStyle = "rgba(255,255,255,.85)"; g.fillText(o.name, p.x + 6, p.y + 3);
    }
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i], p = P(b.x, b.z);
      // RADIUS CARRIES THE SIZE on the map exactly as the banner does in the
      // world: six men and two hundred must not be the same dot.
      const r = 1.4 + Math.sqrt(W.bandSize(b)) * 0.42;
      g.fillStyle = "#" + ("000000" + (b.colour || 0xcccccc).toString(16)).slice(-6);
      g.globalAlpha = b.mood === "hunt" ? 1 : 0.8;
      g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
      g.globalAlpha = 1;
    }
    for (let i = 0; i < peerDraw.length; i++) {
      const q = peerDraw[i], pp = P(q.x, q.z);
      g.strokeStyle = "#" + ("000000" + (q.colour >>> 0).toString(16)).slice(-6);
      g.lineWidth = 2;
      g.beginPath(); g.arc(pp.x, pp.y, 2 + Math.sqrt(q.size) * 0.42, 0, TAU); g.stroke();
      g.fillStyle = "rgba(255,255,255,.85)"; g.fillText(q.name, pp.x + 6, pp.y + 3);
    }
    const me = P(S.you.x, S.you.z);
    g.strokeStyle = "#fff"; g.lineWidth = 2;
    g.beginPath(); g.arc(me.x, me.y, 6, 0, TAU); g.stroke();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(me.x, me.y, 2.6, 0, TAU); g.fill();
    const leg = document.getElementById("wlMapLeg");
    if (leg) leg.textContent = S.bands.length + " PARTIES · " + S.outposts.length + " OUTPOSTS · " +
      D.oases.length + " OASES · DAY " + S.day;
  }

  /* ============================================================ THE COMPASS
     A ribbon, not a rose: a rose tells you which way north is, which in a
     desert with no roads is worth nothing. This tells you where the nearest
     WATER and the nearest MARKET are, which is the only navigation question
     the game actually asks. */
  function paintCompass() {
    if (!compassG) return;
    const g = compassG, w = compass.width;
    g.clearRect(0, 0, w, compass.height);
    g.fillStyle = "rgba(12,9,5,.42)";
    g.fillRect(0, 0, w, compass.height);
    const yaw = camYaw;
    const span = 2.4;                     // radians of heading shown across the ribbon
    function px(a) {
      let d = a - yaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      return w / 2 + (d / span) * w;
    }
    /* TWO ROWS, and it is not decoration: the first draft drew the cardinals
       and both waypoints on ONE baseline and the readout said "WADUST GATE"
       — two labels straight through each other. Cardinals get the top row,
       waypoints the bottom, and a waypoint that would overlap the one
       already drawn is dropped rather than smeared over it. */
    const used = [];
    function tick(a, label, colour, row) {
      const x = px(a);
      if (x < -40 || x > w + 40) return;
      const yTick = row ? 18 : 8, yText = row ? 30 : 15;
      g.strokeStyle = colour; g.lineWidth = row ? 1 : 2;
      g.beginPath(); g.moveTo(x, yTick); g.lineTo(x, yTick + (row ? 5 : 6)); g.stroke();
      g.textAlign = "center";
      g.font = row ? "700 9px ui-sans-serif,system-ui,sans-serif" : "700 11px ui-sans-serif,system-ui,sans-serif";
      if (row) {
        const half = g.measureText(label).width / 2 + 5;
        for (let i = 0; i < used.length; i++) if (Math.abs(used[i] - x) < half * 2) return;
        used.push(x);
      }
      g.fillStyle = colour;
      g.fillText(label, x, yText);
    }
    const CARD = [["N", 0], ["E", Math.PI / 2], ["S", Math.PI], ["W", -Math.PI / 2],
                  ["NE", Math.PI / 4], ["SE", 3 * Math.PI / 4], ["SW", -3 * Math.PI / 4], ["NW", -Math.PI / 4]];
    for (let i = 0; i < CARD.length; i++) tick(CARD[i][1], CARD[i][0], "rgba(244,236,216,.6)", 0);
    const D = W.desert;
    const o = nearest(D.oases);
    if (o) tick(Math.atan2(o.x - S.you.x, o.z - S.you.z), "WATER " + km(o.d), "#39d0a8", 1);
    const p = nearest(S.outposts);
    if (p) tick(Math.atan2(p.x - S.you.x, p.z - S.you.z), p.name + " " + km(p.d), "#ffb15a", 1);
    g.fillStyle = "#ffb15a";
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2 - 6, 7); g.lineTo(w / 2 + 6, 7); g.closePath(); g.fill();
    g.textAlign = "left";
  }
  function km(d) { return d < 950 ? Math.round(d) + "m" : (Math.round(d / 100) / 10) + "km"; }
  function nearest(list) {
    let best = null, bd = 1e18;
    for (let i = 0; i < list.length; i++) {
      const d = Math.hypot(list[i].x - S.you.x, list[i].z - S.you.z);
      if (d < bd) { bd = d; best = list[i]; }
    }
    if (!best) return null;
    return { x: best.x, z: best.z, d: bd, name: best.name || "" };
  }

  /* ============================================================ THE PICK
     A press that does not move is a destination; a press that moves is the
     camera. One rule, mouse and thumb. The 8 px / 380 ms gate is the
     standard one and it is the reason you can both drag-look and tap-to-go
     on a touchscreen without a mode button. */
  function bindPointer() {
    const cv = micro.canvas || document.body;
    let downX = 0, downY = 0, downT = 0, moved = 0, id = -1;
    cv.addEventListener("pointerdown", function (e) {
      if (!live) return;
      id = e.pointerId; downX = e.clientX; downY = e.clientY; downT = performance.now(); moved = 0;
    });
    cv.addEventListener("pointermove", function (e) {
      if (e.pointerId !== id) return;
      moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
    });
    cv.addEventListener("pointerup", function (e) {
      if (!live || e.pointerId !== id) return;
      id = -1;
      if (moved > 8 || performance.now() - downT > 380) return;   // that was a look drag
      rideTo(e.clientX, e.clientY);
    });
    /* THE TOUCH LAYER EATS THE CANVAS. microboot's furniture root is
       `inset:0; pointer-events:auto` and swallows every pointer on a phone,
       so the canvas listener above never fires there. Same gate, second
       surface — the alternative is a phone build where tap-to-ride silently
       does nothing, which is exactly how the first draft shipped. */
    const troot = micro.touch && micro.touch.root;
    if (troot) {
      let tX = 0, tY = 0, tT = 0, tMoved = 0, tId = -1;
      troot.addEventListener("pointerdown", function (e) {
        if (!live) return;
        tId = e.pointerId; tX = e.clientX; tY = e.clientY; tT = performance.now(); tMoved = 0;
      }, true);
      troot.addEventListener("pointermove", function (e) {
        if (e.pointerId !== tId) return;
        tMoved = Math.max(tMoved, Math.hypot(e.clientX - tX, e.clientY - tY));
      }, true);
      troot.addEventListener("pointerup", function (e) {
        if (!live || e.pointerId !== tId) return;
        tId = -1;
        if (tMoved > 10 || performance.now() - tT > 380) return;
        // never let a tap on the stick itself become a destination
        if (e.clientY > window.innerHeight - 200 && e.clientX < 260) return;
        rideTo(e.clientX, e.clientY);
      }, true);
    }
    // zoom: wheel on a mouse, pinch on a thumb
    window.addEventListener("wheel", function (e) {
      if (!live) return;
      camDistWant = clamp(camDistWant * (1 + (e.deltaY > 0 ? 0.16 : -0.16)), 16, 520);
    }, { passive: true });
    const pts = new Map();
    let pinch0 = 0, dist0 = 0;
    function pmove(e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2) return;
      const a = Array.from(pts.values());
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      if (!dist0) { dist0 = d; pinch0 = camDistWant; return; }
      camDistWant = clamp(pinch0 * (dist0 / Math.max(1, d)), 16, 520);
    }
    window.addEventListener("pointerdown", function (e) { if (live) pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); }, true);
    window.addEventListener("pointermove", pmove, true);
    function pend(e) { pts.delete(e.pointerId); if (pts.size < 2) dist0 = 0; }
    window.addEventListener("pointerup", pend, true);
    window.addEventListener("pointercancel", pend, true);
  }

  /* MARCH THE RAY AGAINST THE FUNCTION, not against the mesh. Out at two
     kilometres the clipmap is 512 m per quad and a mesh raycast would land
     the marker up to a hundred metres from where you pointed — on a
     different dune. heightAt knows the real ground everywhere, so this is
     both more accurate and independent of which LOD happens to be there. */
  const _ndc = new THREE.Vector3();
  const _pick = new THREE.Vector3();

  /* TAP A PARTY TO ENGAGE IT, and the pick is SCREEN-SPACE on purpose. A
     warband two kilometres out is three metres wide in the world and forty
     pixels wide on the glass; asking "did the ground ray land within 30 m of
     it" makes the far half of the island untappable, which is exactly the
     kind of thing that turns one verb into two. 46 px, nearest wins, and the
     ride target then TRACKS the party — you are chasing a thing that is
     running away, not the coordinate it was standing on when you tapped. */
  function pickParty(sx, sy) {
    const w = window.innerWidth, h = window.innerHeight;
    let best = null, bd = 46;
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      if (Math.hypot(b.x - S.you.x, b.z - S.you.z) > BAND_DRAW) continue;
      _pick.set(b.x, W.desert.heightAt(b.x, b.z) + 6, b.z).project(camera);
      if (_pick.z > 1) continue;
      const px = (_pick.x * 0.5 + 0.5) * w, py = (-_pick.y * 0.5 + 0.5) * h;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  function rideTo(sx, sy) {
    if (!camera) return;
    const tgt = pickParty(sx, sy);
    if (tgt) {
      chase = tgt;
      dest = { x: tgt.x, z: tgt.z };
      W.emit("campaign:dest", dest);
      const d = Math.hypot(tgt.x - S.you.x, tgt.z - S.you.z);
      if (d < CONTACT * 1.6) engage(tgt);
      else W.toast("riding at " + W.bandSize(tgt) + " " + tgt.name);
      return;
    }
    chase = null;
    const w = window.innerWidth, h = window.innerHeight;
    _ndc.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1, 0.5);
    _ndc.unproject(camera);
    const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
    let dx = _ndc.x - ox, dy = _ndc.y - oy, dz = _ndc.z - oz;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const D = W.desert;
    let t = 1, hit = -1;
    for (let i = 0; i < 900 && t < 7000; i++) {
      const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
      if (py <= D.heightAt(px, pz)) { hit = t; break; }
      t += Math.max(3, t * 0.022);
    }
    if (hit < 0) return;
    let lo = Math.max(0, hit - Math.max(3, hit * 0.022)), hi = hit;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) * 0.5;
      if (oy + dy * m <= D.heightAt(ox + dx * m, oz + dz * m)) hi = m; else lo = m;
    }
    const x = ox + dx * hi, z = oz + dz * hi;
    if (!D.onLand(x, z)) { W.toast("that is the sea", "bad"); return; }
    dest = { x: x, z: z };
    W.emit("campaign:dest", dest);
  }

  /* ============================================================ THE DAY
     Keyframes, interpolated on the travel clock. core/daynight.js was read
     and does not fit (see the header). The write order matters: microboot
     registers a CBZ.onAlways(9) hook that RESTORES the base sun/hemi/fog
     every frame — `always` hooks run before frame hooks, so a tint applied
     here lands after the restore and survives. Doing it the other way round
     is a light that flickers at 60 Hz. */
  const SKYKEY = [
    { h: 0,  sun: 0.10, sc: 0x7f9ad0, hemi: 0.24, hc: 0x33456b, gc: 0x241f2a, fog: 0x131b2c, top: 0x0a1226, bot: 0x1d2740 },
    { h: 5,  sun: 0.14, sc: 0x9aa8d8, hemi: 0.28, hc: 0x46557d, gc: 0x2b2630, fog: 0x2a2f42, top: 0x14203c, bot: 0x4a4258 },
    { h: 6.6, sun: 0.74, sc: 0xffa863, hemi: 0.36, hc: 0x8798bc, gc: 0x6b4a26, fog: 0xd39a6a, top: 0x2f5f96, bot: 0xf0b070 },
    { h: 9,  sun: 0.95, sc: 0xfff0cc, hemi: 0.40, hc: 0x9ebbd8, gc: 0xa87233, fog: 0xe6cda1, top: 0x4478ad, bot: 0xe6cda1 },
    { h: 14, sun: 1.02, sc: 0xfffaf0, hemi: 0.42, hc: 0xa7c2dc, gc: 0xb07a38, fog: 0xefdcb6, top: 0x3f74ad, bot: 0xefdcb6 },
    { h: 17.5, sun: 0.88, sc: 0xffd9a0, hemi: 0.38, hc: 0x9fb6d2, gc: 0x9c6a30, fog: 0xe8b986, top: 0x3c6ea8, bot: 0xe8b986 },
    { h: 19.4, sun: 0.56, sc: 0xff8f4a, hemi: 0.36, hc: 0x9fadd0, gc: 0x7a5c3c, fog: 0xc9743f, top: 0x2a4a80, bot: 0xd98a4a },
    { h: 21,  sun: 0.16, sc: 0x8f9ed0, hemi: 0.28, hc: 0x4d5c84, gc: 0x322b34, fog: 0x39364a, top: 0x18244a, bot: 0x54465e },
    { h: 24, sun: 0.10, sc: 0x7f9ad0, hemi: 0.24, hc: 0x33456b, gc: 0x241f2a, fog: 0x131b2c, top: 0x0a1226, bot: 0x1d2740 },
  ];
  const _cA = new THREE.Color(), _cB = new THREE.Color();
  function mixHex(a, b, t, out) { _cA.setHex(a); _cB.setHex(b); return out.copy(_cA).lerp(_cB, t); }

  function tintDay() {
    if (FLAG_NOCLOCK) return;
    const h = clamp(S.hour, 0, 24);
    let i = 0;
    while (i < SKYKEY.length - 2 && SKYKEY[i + 1].h <= h) i++;
    const a = SKYKEY[i], b = SKYKEY[i + 1];
    const t = clamp((h - a.h) / Math.max(0.001, b.h - a.h), 0, 1);
    const sun = micro.sun, hemi = micro.hemiLight;
    if (sun) {
      sun.intensity = lerp(a.sun, b.sun, t);
      mixHex(a.sc, b.sc, t, sun.color);
      /* THE SUN MOVES. A fixed light with a changing colour reads as a
         filter; a shadow that swings from west to east through the day is
         what makes an hour feel like an hour. micro.lights parks the rig
         relative to the camera at order -100 every frame, so this rewrite
         (a plain frame hook, order 5) is the one that lands. */
      const ang = (h / 24) * TAU - Math.PI / 2;
      const el = Math.max(0.12, Math.sin((h - 6) / 12 * Math.PI));
      const dd = 900;
      const cx = camera ? camera.position.x : 0, cz = camera ? camera.position.z : 0;
      sun.position.set(cx + Math.cos(ang) * dd * 0.8, dd * el, cz + Math.sin(ang) * dd * 0.8);
      if (sun.target) { sun.target.position.set(cx, 0, cz); sun.target.updateMatrixWorld(); }
    }
    if (hemi) {
      hemi.intensity = lerp(a.hemi, b.hemi, t);
      mixHex(a.hc, b.hc, t, hemi.color);
      mixHex(a.gc, b.gc, t, hemi.groundColor);
    }
    if (scene.fog) mixHex(a.fog, b.fog, t, scene.fog.color);
    if (scene.background && scene.background.isColor) mixHex(a.fog, b.fog, t, scene.background);
    const dome = micro.skyDome;
    if (dome && dome.material && dome.material.uniforms) {
      mixHex(a.top, b.top, t, dome.material.uniforms.topColor.value);
      mixHex(a.bot, b.bot, t, dome.material.uniforms.bottomColor.value);
    }
  }

  /* ============================================================ THE WORLD TICK
     Wall time, every phase, paused or not. Nothing here draws and nothing
     here reads input — this is the part of the campaign that is true for
     everybody on the island, including the parts of it nobody is looking at.

     THE CATCH-UP IS THE POINT. `dt` is measured off performance.now(), not
     off the frame delta, so a tab that was hidden for ninety seconds wakes
     up ninety seconds later in the world rather than exactly where it left.
     The CLOCK takes the whole elapsed time; the BAND MOTION is stepped in
     0.25 s substeps (a party at 8 m/s must not teleport 700 m through a
     mesa in one integration step) and capped at CATCHUP_MAX of them, so a
     wake-up after an hour costs 30 s of walking and one frame, not a
     minute of frozen page. */
  function worldTick() {
    if (!built) return;
    const now = performance.now();
    if (!lastWall) { lastWall = now; return; }
    let dt = (now - lastWall) / 1000;
    lastWall = now;
    if (!(dt > 0)) return;
    if (dt > 3600) dt = 3600;

    // ---- the day, on real seconds -------------------------------------
    if (!FLAG_NOCLOCK) {
      const before = S.hour;
      S.hour += dt / HOUR_SECS;
      let rolled = 0;
      while (S.hour >= 24) { S.hour -= 24; rolled++; }
      // dawn is the day boundary and core owns everything it costs
      const crossed = rolled > 0 || (before < 6 && S.hour >= 6);
      if (crossed) {
        // a long sleep can span several dawns; pay every one of them
        const dawns = Math.max(1, rolled);
        for (let i = 0; i < Math.min(dawns, 8); i++) W.dawn();
      }
    }

    /* THE PARTIES. Normal frames take the real dt in one go — accumulating
       into fixed 0.25 s ticks was the first version and it made every band
       on the island advance in 1.5 m hops four times a second, which reads
       as lag, not as walking. Substepping is ONLY for the catch-up case,
       where the alternative is a party integrating 700 m in one step and
       walking through a mesa on the way.

       yourPower() is hoisted out of the loop: it sums the whole roster, and
       a thousand-man army times sixty bands times a hundred catch-up
       substeps is six million calls for a number that cannot change inside
       one wake-up. */
    const myPower = W.yourPower();
    if (dt <= 0.3) {
      stepBands(dt, myPower);
    } else {
      let left = dt, steps = 0;
      while (left > 0.0001 && steps < CATCHUP_MAX) {
        const h = Math.min(0.25, left);
        stepBands(h, myPower);
        left -= h; steps++;
      }
    }
  }

  /* ============================================================ THE FRAME */
  function step(dt) {
    if (!live) return;
    if (dt > 0.1) dt = 0.1;
    const D = W.desert;
    const you0x = S.you.x, you0z = S.you.z;

    // ---- input ----------------------------------------------------------
    if (controls) controls.step(dt);
    let mx = 0, my = 0;
    if (controls) { mx = controls.move.x; my = controls.move.y; }
    const stickLive = Math.hypot(mx, my) > 0.12;
    if (stickLive) { dest = null; chase = null; }      // you took the reins

    // camera swing: drag/right-side thumb, or Q/E
    if (controls) camYaw += controls.look.x;
    const IN = micro.input;
    if (IN) camYaw += (IN.isDown("KeyQ") ? 1 : 0) * dt * 1.6 - (IN.isDown("KeyE") ? 1 : 0) * dt * 1.6;

    // ---- where is he going ----------------------------------------------
    let wantX = 0, wantZ = 0;
    if (stickLive) {
      // camera-relative: forward is where you are looking, which is the only
      // mapping that survives a camera you can swing
      const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
      wantX = mx * cs - my * sn;
      wantZ = mx * sn + my * cs;
    } else if (dest) {
      // a chased party moves; the destination is the party, not the spot
      if (chase) {
        if (S.bands.indexOf(chase) < 0) { chase = null; dest = null; }
        else { dest.x = chase.x; dest.z = chase.z; }
      }
      if (!dest) { wantX = 0; wantZ = 0; }
      const dx = dest ? dest.x - S.you.x : 0, dz = dest ? dest.z - S.you.z : 0;
      const d = Math.hypot(dx, dz);
      if (!dest || (d < 4 && !chase)) { dest = null; chase = null; }
      else if (d > 0.5) { wantX = dx / d; wantZ = dz / d; }
    }

    const wl = Math.hypot(wantX, wantZ);
    if (wl > 0.001) {
      wantX /= wl; wantZ /= wl;
      let sp = RIDE_SPEED * Math.min(1, wl > 1 ? 1 : Math.max(wl, stickLive ? Math.hypot(mx, my) : 1));
      /* HILLS COST. Not a wall — a wall in an open-world ride reads as a
         bug — but a mesa flank slows you to a crawl and the ridge line
         becomes a route decision instead of scenery. */
      const ahead = D.heightAt(S.you.x + wantX * 6, S.you.z + wantZ * 6);
      const grade = (ahead - D.heightAt(S.you.x, S.you.z)) / 6;
      sp *= clamp(1 - Math.max(0, grade) * 1.15, 0.22, 1);
      let nx = S.you.x + wantX * sp * dt, nz = S.you.z + wantZ * sp * dt;
      /* THE SEA IS THE EDGE OF THE MAP and it does not need a wall: he
         simply will not walk into it. Slide along the shore instead of
         stopping dead, or a coastal ride is a series of snags. */
      if (!D.onLand(nx, nz)) {
        if (D.onLand(S.you.x + wantX * sp * dt, S.you.z)) nz = S.you.z;
        else if (D.onLand(S.you.x, S.you.z + wantZ * sp * dt)) nx = S.you.x;
        else { nx = S.you.x; nz = S.you.z; dest = null; }
      }
      S.you.x = nx; S.you.z = nz;
      const want = Math.atan2(wantX, wantZ);
      let dy = want - S.you.yaw;
      while (dy > Math.PI) dy -= TAU;
      while (dy < -Math.PI) dy += TAU;
      S.you.yaw += dy * Math.min(1, dt * 7);
    }

    const moved = Math.hypot(S.you.x - you0x, S.you.z - you0z);
    travelled += moved;

    // ---- breadcrumbs: the shape of the column ---------------------------
    crumbAcc += moved;
    if (crumbAcc >= TRAIL_STEP || !breadcrumbs.length) {
      crumbAcc = 0;
      breadcrumbs.push({ x: S.you.x, z: S.you.z });
      if (breadcrumbs.length > TRAIL_MAX) breadcrumbs.shift();
    }

    // ---- the world ------------------------------------------------------
    // NOT stepBands: the parties are on the wall clock in worldTick, so they
    // keep walking while this file is not the one drawing.
    /* THE CLIPMAP FOLLOWS THE MAN, NOT THE EYE. At strategic zoom the camera
       is 500 m behind him, and centring the fine ring on the camera puts the
       8 m ground behind the shot and the 32 m ground under the thing you are
       actually looking at. Split the difference toward him. */
    D.follow(lerp(S.you.x, camera.position.x, 0.28), lerp(S.you.z, camera.position.z, 0.28));

    // ---- draw -----------------------------------------------------------
    placeYou(dt, moved / Math.max(dt, 0.0001));
    drawMen();
    drawMarker(dt);
    updateCamera(dt);
    paintPlates();
    paintCompass();

    // ---- handoffs -------------------------------------------------------
    checkContacts();
  }

  function placeYou(dt, speed) {
    const D = W.desert;
    const y = D.heightAt(S.you.x, S.you.z);
    youRig.position.set(S.you.x, y, S.you.z);
    youRig.rotation.y = S.you.yaw;
    if (CBZ.animChar && youRig.userData.charRig) {
      try { CBZ.animChar(youRig.userData.charRig, speed > 0.3 ? Math.min(speed, 6.2) : 0, dt); } catch (e) {}
    }
  }

  /* ============================================================ THE TRAIL
     Followers ride the breadcrumb, not the player: a man 40 m back is where
     YOU were 40 m ago, which is what makes the column bend through a wadi
     instead of cutting the corner like a rubber band. The lateral offset is
     hashed off the man's index so the column is a column and not a line,
     and so it does not shimmer as the roster changes. */
  function drawMen() {
    let n = 0;
    const D = W.desert;
    const army = S.army;
    const drawN = FLAG_NOTRAIL ? 0 : Math.min(DRAWN_FOLLOWERS, army.length);
    const t = micro.elapsed;
    /* MEN GROW AS THE CAMERA PULLS BACK, and this is a deliberate lie. At
       520 m a life-sized man is under two pixels: the strategic view — the
       one the whole game is about, where you look down at your column and
       at what is coming for you — showed an empty desert with some dirt
       specks on it. Total War and Bannerlord both scale their unit markers
       for exactly this reason. 1x over the shoulder where he stands next to
       a real studio.cast body and must match it, up to 3.2x at full pull-
       back where nothing is next to him to compare against. */
    const zt = clamp((camDist - 16) / (520 - 16), 0, 1);
    const ms = 1 + zt * 2.2;
    const spread = 1 + zt * 1.1;
    for (let i = 0; i < drawN; i++) {
      const back = (4 + i * 2.15) * spread;            // metres behind you
      const idx = breadcrumbs.length - 1 - Math.floor(back / TRAIL_STEP);
      const c = breadcrumbs[idx < 0 ? 0 : idx];
      if (!c) break;
      const j1 = (W.hash01(i * 31 + 7, 3, 21) - 0.5) * 7.0 * (1 + zt * 0.35);
      const j2 = (W.hash01(i * 17 + 5, 9, 23) - 0.5) * 3.0;
      const x = c.x + j1, z = c.z + j2;
      const y = D.heightAt(x, z);
      const s = W.tier(army[i].tier);
      const bob = Math.sin(t * 5.2 + i * 1.7) * 0.055;
      const yaw = S.you.yaw + (W.hash01(i, 1, 27) - 0.5) * 0.5;
      const col = TIER_COLOUR[army[i].tier] || 0x9c8f6d;
      n = inst(menBody, n, x, y + (0.65 + bob) * ms, z, yaw, ms, ms, ms, col);
      inst(menHead, n - 1, x, y + (1.48 + bob) * ms, z, yaw, ms, ms, ms, 0xd9b48c);
    }
    // ---- every band close enough to see -------------------------------
    let bn = 0;
    for (let i = 0; i < S.bands.length && n < MEN_CAP - 20; i++) {
      const b = S.bands[i];
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d > BAND_DRAW) continue;
      const size = W.bandSize(b);
      /* HOW MANY BODIES A PARTY SHOWS scales with sqrt(size) and stops at
         14: past that the cluster stops reading as "more men" and starts
         reading as "a bigger blob", and the BANNER is what carries the
         count at any distance you would care about it from. */
      const show = clamp(Math.round(Math.sqrt(size) * 1.5), 2, 14);
      for (let k = 0; k < show && n < MEN_CAP; k++) {
        const a = W.hash01(b.x + k, b.z, 41 + k) * TAU;
        const rr = (1.6 + W.hash01(b.x, b.z + k, 51 + k) * (2.2 + Math.sqrt(size) * 0.75)) * spread;
        const x = b.x + Math.cos(a + b.yaw) * rr, z = b.z + Math.sin(a + b.yaw) * rr;
        const y = W.desert.heightAt(x, z);
        const bob = Math.sin(micro.elapsed * 4.6 + k * 2.1 + i) * 0.05;
        n = inst(menBody, n, x, y + (0.65 + bob) * ms, z, b.yaw, ms, ms, ms, b.colour);
        inst(menHead, n - 1, x, y + (1.48 + bob) * ms, z, b.yaw, ms, ms, ms, 0xc79a63);
      }
      if (bn < 160) bn = party(bn, b.x, b.z, size, b.colour, b.yaw);
    }
    /* OTHER WARLORDS ARE PARTIES, not a special case. They come off
       W.state.peers — the contract's own home for them — and go through the
       exact instanced bodies and the exact banner an AI band uses, so a
       human column and a computer column are the same object on screen and
       neither can drift into looking "more real" than the other. warnet.js
       keeps the map up to date and never draws anything. */
    peerDraw.length = 0;
    for (const pid in S.peers) {
      const q = S.peers[pid];
      if (!q || q.x == null) continue;
      const d = Math.hypot(q.x - S.you.x, q.z - S.you.z);
      peerDraw.push({ x: q.x, z: q.z, d: d, name: q.name || "WARLORD", size: q.size || 1, colour: q.colour == null ? 0xd8d0c0 : q.colour });
      if (d > BAND_DRAW || n >= MEN_CAP - 20) continue;
      const size = Math.max(1, q.size || 1);
      const show = clamp(Math.round(Math.sqrt(size) * 1.5), 1, 14);
      const yaw = q.yaw || 0;
      for (let k = 0; k < show && n < MEN_CAP; k++) {
        const a = W.hash01(q.x + k, q.z, 41 + k) * TAU;
        const rr = 1.6 + W.hash01(q.x, q.z + k, 51 + k) * (2.2 + Math.sqrt(size) * 0.75);
        const x = q.x + Math.cos(a + yaw) * rr, z = q.z + Math.sin(a + yaw) * rr;
        const y = W.desert.heightAt(x, z);
        n = inst(menBody, n, x, y + 0.65 * ms, z, yaw, ms, ms, ms, q.colour);
        inst(menHead, n - 1, x, y + 1.48 * ms, z, yaw, ms, ms, ms, 0xc79a63);
      }
      if (bn < 160) bn = party(bn, q.x, q.z, size, q.colour, yaw);
    }
    menBody.count = n; menHead.count = n;
    menBody.instanceMatrix.needsUpdate = menHead.instanceMatrix.needsUpdate = true;
    if (menBody.instanceColor) menBody.instanceColor.needsUpdate = true;
    if (menHead.instanceColor) menHead.instanceColor.needsUpdate = true;
    pole.count = bn; banner.count = bn;
    pole.instanceMatrix.needsUpdate = banner.instanceMatrix.needsUpdate = true;
    if (banner.instanceColor) banner.instanceColor.needsUpdate = true;
  }

  /* ONE BANNER RULE for AI bands, peers and anything else that is a party:
     height and flag scale with log2(head count), so six men and two hundred
     are tellable apart at strategic zoom without a 120 m pole. */
  function party(bn, x, z, size, colour, yaw) {
    const ph = 5 + 2.6 * Math.log(size + 1) / Math.LN2;
    const fw = 1.6 + 0.9 * Math.log(size + 1) / Math.LN2;
    const by = W.desert.heightAt(x, z);
    bn = inst(pole, bn, x, by + ph / 2, z, 0, 1, ph, 1, null);
    inst(banner, bn - 1, x + 0.12, by + ph - fw * 0.42, z, (yaw || 0) * 0.3, fw, fw * 0.62, 1, colour);
    return bn;
  }

  function drawMarker(dt) {
    if (!marker) return;
    marker.visible = !!dest;
    if (!dest) return;
    markerT += dt;
    const y = W.desert.heightAt(dest.x, dest.z);
    marker.position.set(dest.x, y + 0.25, dest.z);
    const p = 1 + Math.sin(markerT * 3.4) * 0.16;
    marker.scale.set(p, 1, p);
  }

  /* ============================================================ THE CAMERA
     Behind and above, and the distance is the only thing the player tunes.
     PITCH IS DERIVED FROM DISTANCE rather than being a second control: at
     16 m you are over his shoulder with the horizon in shot, at 500 m you
     are looking down at a valley full of parties. Two sliders for one
     intention is how a simple game stops being simple. */
  function updateCamera(dt) {
    camDist = lerp(camDist, camDistWant, Math.min(1, dt * 5));
    const t = clamp((camDist - 16) / (520 - 16), 0, 1);
    const pitch = lerp(0.20, 0.86, Math.pow(t, 0.72));
    const D = W.desert;
    const gy = D.heightAt(S.you.x, S.you.z);
    const back = Math.cos(pitch) * camDist;
    const up = Math.sin(pitch) * camDist;
    const cx = S.you.x - Math.sin(camYaw) * back;
    const cz = S.you.z - Math.cos(camYaw) * back;
    let cy = gy + up + 2.2;
    /* NEVER INSIDE THE GROUND. A dune between you and the camera used to
       swallow it whole; keeping the eye a clear 3 m above whatever is
       under it costs one heightAt and fixes every case. */
    cy = Math.max(cy, D.heightAt(cx, cz) + 3.0);
    /* THE NEAR PLANE IS THE FAR WATER'S PROBLEM. micro.boot ships near=0.35,
       which is right for a page where you can walk into a wall. Here the
       nearest thing to the eye is a man 16 m away and the FURTHEST is a
       coastline 12 km away, and at near=0.35/far=16000 the depth buffer has
       ~11 m of resolution out there — the sea and the sea bed traded pixels
       in stripes across the whole horizon. near=2.2 is five times the
       precision for nothing the player can ever see. */
    if (camera.near !== 2.2) { camera.near = 2.2; camera.updateProjectionMatrix(); }
    camera.position.set(cx, cy, cz);
    // look slightly AHEAD of him, not at him: the horizon and the ground he
    // is riding into are the shot, his back is not
    const la = 0.18 + t * 0.5;
    camera.lookAt(
      S.you.x + Math.sin(camYaw) * camDist * la,
      gy + 1.4 + camDist * 0.06,
      S.you.z + Math.cos(camYaw) * camDist * la);
    camHeight = cy;
    /* PUBLISH THE ZOOM. territory.js is building an openfront-style ownership
       map over this same island, and the pull-back and that map have to feel
       like one view at two ranges rather than two separate screens. So the
       camera's strategic-ness is a number anybody can read, and it is emitted
       on a real change rather than sixty times a second. */
    if (Math.abs(camDist - lastZoomSent) > camDist * 0.06) {
      lastZoomSent = camDist;
      W.emit("campaign:zoom", { dist: camDist, t: t, yaw: camYaw, x: S.you.x, z: S.you.z });
    }
    // the sky dome is centred on the origin and the island is 16 km wide;
    // ride far enough and you can reach its wall. Carry it with you.
    if (micro.skyDome) micro.skyDome.position.set(cx, 0, cz);
  }

  /* ============================================================ THE BANDS */
  /* A BAND OFF THE WIRE HAS NONE OF THIS FILE'S FIELDS ON IT. core.makeBand
     declares the party; the goal, the memory of losing to you, the heading
     and the AI stagger are CAMPAIGN facts this file adds. In multiplayer the
     host's bands arrive as plain state, so normalise on the way in rather
     than trusting that everything in S.bands was minted here. */
  function ensureBandFields(b) {
    if (b.yaw == null) b.yaw = W.hash01(b.x, b.z, 5) * TAU;
    if (b.scared == null) b.scared = 0;
    if (b.think == null) b.think = W.hash01(b.x, b.z, 6) * 1.6;
    if (b.pause == null) b.pause = 0;
    if (b.cooldown == null) b.cooldown = 0;
    if (!b.goal && C.simHost) pickGoal(b);
    return b;
  }

  function stepBands(dt, myPower) {
    const D = W.desert;
    if (myPower == null) myPower = W.yourPower();
    bandTick += dt;
    for (let i = 0; i < S.bands.length; i++) {
      const b = ensureBandFields(S.bands[i]);
      if (b.cooldown > 0) b.cooldown -= dt;
      /* A GUEST NEVER MOVES A BAND. It renders the host's, keeps their
         cooldowns ticking (that is local courtesy, not authority) and stops.
         Every line below this one is an act of authorship. */
      if (!C.simHost) { b.y = D.heightAt(b.x, b.z); continue; }
      const dxp = S.you.x - b.x, dzp = S.you.z - b.z;
      const dp = Math.hypot(dxp, dzp);

      // ---- think, staggered so sixty parties never think on one frame ---
      b.think -= dt;
      if (b.think <= 0) {
        b.think = 1.1 + W.hash01(b.x, b.z, 3) * 0.9;
        if (!FLAG_NOBANDAI && dp < 1100 && b.cooldown <= 0) {
          const theirs = W.bandPower(b);
          const hostile = W.faction(b.faction).hostile;
          /* THE ONE DECISION A PARTY MAKES: can I take him. Power, not head
             count — core's soldierPower already knows that forty levies with
             pistols are weaker than fifteen veterans with rifles. `scared`
             is memory: a band you have already broken keeps its distance,
             which is what makes clearing an area MEAN something. */
          const edge = theirs / Math.max(0.001, myPower);
          if (edge > 1.15 + b.scared * 0.9 && W.rnd() < hostile) b.mood = "hunt";
          else if (edge < 0.55 || b.scared > 1) b.mood = "flee";
          else if (b.mood !== "camp") b.mood = "roam";
        } else if (b.mood === "hunt" || b.mood === "flee") {
          b.mood = "roam";
        }
      }

      // ---- where is it walking ------------------------------------------
      let tx, tz, sp = BAND_SPEED;
      if (b.mood === "hunt") { tx = S.you.x; tz = S.you.z; sp = HUNT_SPEED; }
      else if (b.mood === "flee") { tx = b.x - dxp; tz = b.z - dzp; sp = HUNT_SPEED * 0.92; }
      else {
        if (!b.goal) pickGoal(b);
        tx = b.goal.x; tz = b.goal.z;
        if (b.pause > 0) { b.pause -= dt; sp = 0; }
      }
      const dx = tx - b.x, dz = tz - b.z;
      const d = Math.hypot(dx, dz);
      if (sp > 0 && d > 2) {
        let ux = dx / d, uz = dz / d;
        const nx = b.x + ux * sp * dt, nz = b.z + uz * sp * dt;
        /* THEY DO NOT WALK INTO THE SEA OR UP A MESA WALL. One probe, and
           on a refusal they turn rather than stop — a party frozen against
           a cliff for ten minutes is the most obvious "this is a simulation
           and it is broken" tell there is. */
        if (D.onLand(nx, nz) && Math.abs(D.heightAt(nx, nz) - D.heightAt(b.x, b.z)) < sp * dt * 1.6) {
          b.x = nx; b.z = nz;
        } else {
          const turn = (W.hash01(b.x, b.z, 9) < 0.5 ? 1 : -1) * 0.9;
          const a = Math.atan2(ux, uz) + turn;
          ux = Math.sin(a); uz = Math.cos(a);
          const ax = b.x + ux * sp * dt, az = b.z + uz * sp * dt;
          if (D.onLand(ax, az)) { b.x = ax; b.z = az; }
          else if (b.mood === "roam") pickGoal(b);
        }
        const wy = Math.atan2(ux, uz);
        let dy = wy - b.yaw;
        while (dy > Math.PI) dy -= TAU;
        while (dy < -Math.PI) dy += TAU;
        b.yaw += dy * Math.min(1, dt * 2.4);
      } else if (b.mood === "roam" && d <= 2) {
        // arrived: sit a while, then go somewhere else. A world where
        // everybody is always in transit has no places in it.
        b.pause = 6 + W.rnd() * 22;
        if (b.pause > 20) b.mood = "camp";
        pickGoal(b);
      }
      if (b.mood === "camp" && b.pause <= 0) b.mood = "roam";
      b.y = D.heightAt(b.x, b.z);
    }

    // ---- they fight EACH OTHER, off screen, resolved abstractly ---------
    fightTick += dt;
    if (C.simHost && fightTick > 4.5) {
      fightTick = 0;
      resolveOneBandFight();
    }
    // ---- the island never empties ---------------------------------------
    spawnTick += dt;
    if (C.simHost && spawnTick > 9) {
      spawnTick = 0;
      const want = bandTarget();
      if (S.bands.length < want) {
        for (let g = 0; g < 30; g++) {
          const p = W.desert.landPoint(W.rnd, { maxSlope: 0.30 });
          if (Math.hypot(p.x - S.you.x, p.z - S.you.z) < 2200) continue;
          spawnBand({ at: p });
          break;
        }
      }
    }
  }

  /* A HUNDRED SIMULATED BATTLES A MINUTE IS NOT A WORLD, IT IS A HEATER.
     Two parties that meet resolve in one function: power decides it, the
     loser is destroyed or halved, the winner takes losses proportional to
     how close it was, and one line goes in the log. You find out the island
     has a history by reading it, which is exactly how Bannerlord does it. */
  function resolveOneBandFight() {
    const n = S.bands.length;
    if (n < 2) return;
    const i = Math.floor(W.rnd() * n);
    const a = S.bands[i];
    let b = null, bd = 1e18;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const o = S.bands[k];
      if (o.faction === a.faction) continue;
      const d = Math.hypot(o.x - a.x, o.z - a.z);
      if (d < bd) { bd = d; b = o; }
    }
    if (!b || bd > 220) return;
    const pa = W.bandPower(a), pb = W.bandPower(b);
    const win = W.odds(pa, pb);
    const aWins = W.rnd() < win;
    const winner = aWins ? a : b, loser = aWins ? b : a;
    const margin = aWins ? win : 1 - win;
    const loseFrac = 0.55 + margin * 0.45;
    const winFrac = clamp(0.42 * (1 - margin), 0.03, 0.35);
    const lost = Math.max(1, Math.round(loser.men.length * loseFrac));
    const cost = Math.round(winner.men.length * winFrac);
    loser.men.splice(0, lost);
    if (cost > 0) winner.men.splice(0, Math.min(cost, winner.men.length - 1));
    winner.gold += Math.round(loser.gold * 0.6);
    loser.gold = Math.round(loser.gold * 0.4);
    if (!loser.men.length) {
      const at = S.bands.indexOf(loser);
      if (at >= 0) S.bands.splice(at, 1);
      W.log(winner.name + " wiped out a party of " + loser.faction + "s near " + placeName(winner.x, winner.z) + ".");
    } else {
      loser.mood = "flee"; loser.scared = Math.min(2, loser.scared + 1);
      W.log(winner.name + " beat " + lost + " men off a " + loser.faction + " party near " + placeName(winner.x, winner.z) + ".");
    }
  }

  /* somewhere has to have a NAME or the log is "a fight happened at 3104,
     -882", which is a database row and not a story. */
  function placeName(x, z) {
    const D = W.desert;
    let best = null, bd = 1e18;
    const all = D.oases.concat(S.outposts);
    for (let i = 0; i < all.length; i++) {
      const d = Math.hypot(all[i].x - x, all[i].z - z);
      if (d < bd) { bd = d; best = all[i]; }
    }
    if (best && bd < 2400) return best.name;
    return "the " + D.biomeAt(x, z) + " country";
  }

  /* ONE DOOR TO THE ENCOUNTER, whether you rode into a party or tapped it. */
  function engage(b) {
    if (!b || b.cooldown > 0) return false;
    b.cooldown = 12;
    chase = null; dest = null;
    W.emit("campaign:band", b);
    W.setPhase("encounter", { band: b });
    // army.js owns the card. It may not exist yet — this file must not be
    // the reason the page dies when a sibling module is missing.
    if (W.army && W.army.encounter) { try { W.army.encounter(b); } catch (e) { console.error("[warlord] encounter", e); } }
    else W.toast(b.name + " — " + W.bandSize(b) + " men (army.js not loaded)", "bad");
    return true;
  }

  /* ============================================================ CONTACT */
  function checkContacts() {
    nearBand = null; nearOutpost = null;
    let bd = 1e18;
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d < bd) { bd = d; nearBand = b; }
      if (d < CONTACT && engage(b)) return;
    }
    for (let i = 0; i < S.outposts.length; i++) {
      const o = S.outposts[i];
      const d = Math.hypot(o.x - S.you.x, o.z - S.you.z);
      if (d < OUTPOST_R * 6) nearOutpost = o;
      if (d < OUTPOST_R && !o.cool) {
        o.cool = 1;
        W.setPhase("outpost", { outpost: o });
        if (W.outpost && W.outpost.open) { try { W.outpost.open(o); } catch (e) { console.error("[warlord] outpost", e); } }
        else W.toast(o.name + " " + o.label + " (outpost.js not loaded)", "bad");
        return;
      }
      if (d > OUTPOST_R * 1.6) o.cool = 0;
    }
  }

  /* ============================================================ NAMEPLATES
     Only what is close, and never more than six: a screen with forty labels
     on it has no information on it. */
  const _proj = new THREE.Vector3();
  const plates = [];
  function paintPlates() {
    if (!plateBox) return;
    const list = [];
    for (let i = 0; i < S.bands.length && list.length < 6; i++) {
      const b = S.bands[i];
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d > NAMEPLATE_R) continue;
      list.push({ x: b.x, y: W.desert.heightAt(b.x, b.z) + 9, z: b.z, d: d,
        text: W.bandSize(b) + " " + b.name, sub: b.mood === "hunt" ? "COMING FOR YOU" :
          b.mood === "flee" ? "RUNNING" : Math.round(d) + "m", cls: b.mood });
    }
    for (let i = 0; i < peerDraw.length && list.length < 8; i++) {
      const q = peerDraw[i];
      if (q.d > NAMEPLATE_R * 2.2) continue;
      list.push({ x: q.x, y: W.desert.heightAt(q.x, q.z) + 11, z: q.z, d: q.d,
        text: q.size + " " + q.name, sub: "WARLORD", cls: "peer" });
    }
    if (nearOutpost) {
      const d = Math.hypot(nearOutpost.x - S.you.x, nearOutpost.z - S.you.z);
      list.push({ x: nearOutpost.x, y: nearOutpost.y + 20, z: nearOutpost.z, d: d,
        text: nearOutpost.name + " " + nearOutpost.label, sub: nearOutpost.note, cls: "op" });
    }
    while (plates.length < list.length) {
      const p = document.createElement("div");
      p.className = "plate";
      plateBox.appendChild(p);
      plates.push(p);
    }
    for (let i = 0; i < plates.length; i++) {
      const p = plates[i], L = list[i];
      if (!L) { p.style.display = "none"; continue; }
      _proj.set(L.x, L.y, L.z).project(camera);
      if (_proj.z > 1) { p.style.display = "none"; continue; }
      p.style.display = "block";
      p.className = "plate " + (L.cls || "");
      p.innerHTML = L.text + '<i>' + L.sub + '</i>';
      p.style.left = ((_proj.x * 0.5 + 0.5) * window.innerWidth) + "px";
      p.style.top = ((-_proj.y * 0.5 + 0.5) * window.innerHeight) + "px";
    }
  }

  /* ============================================================ API */
  C.dest = function (x, z) { dest = { x: x, z: z }; chase = null; return dest; };
  C.engage = engage;
  /* the camera's strategic-ness, for territory.js and anything else that has
     to agree with this view. t is 0 over-the-shoulder .. 1 fully pulled back. */
  C.zoom = function () {
    return { dist: camDist, t: clamp((camDist - 16) / (520 - 16), 0, 1), yaw: camYaw, x: S.you.x, z: S.you.z };
  };
  C.setSimHost = function (on) { C.simHost = !!on; return C.simHost; };
  C.you = function () { return S.you; };
  C.camDist = function (d) { if (d != null) camDistWant = clamp(d, 16, 520); return camDistWant; };
  C.camYaw = function (a) { if (a != null) camYaw = a; return camYaw; };
  C.live = function () { return live; };
  C.map = toggleMap;
  C.spawnBand = spawnBand;
  C.audit = function () {
    return {
      live: live, bands: S.bands.length, outposts: S.outposts.length,
      army: S.army.length, drawnMen: menBody ? menBody.count : 0,
      you: { x: Math.round(S.you.x), z: Math.round(S.you.z), y: Math.round(W.desert.heightAt(S.you.x, S.you.z)) },
      hour: Math.round(S.hour * 10) / 10, day: S.day, camDist: Math.round(camDist),
      trail: breadcrumbs.length, dest: dest ? { x: Math.round(dest.x), z: Math.round(dest.z) } : null,
      simHost: C.simHost, peers: peerDraw.length, chasing: !!chase,
    };
  };

  C.needs = ["desert"];
  C.boot = function (c) {
    ctx = c; micro = c.micro; scene = c.scene; camera = CBZ.camera;
    if (c.Q && c.Q.get("audit") === "1") W.on("campaign:ready", function () {
      try { console.log("[warlord/campaign]", C.audit()); } catch (e) {}
    });
  };
  W.module("campaign", C);
})();
