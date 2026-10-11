"use strict";
/* src/battle/begin.js — NPC War: BEGIN: raise the field, spawn the armies.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ BEGIN */
function begin(asBench) {
  el("menu").style.display = "none";
  // a restart must not inherit a body from the last war: apeReset drops every
  // live hold and puts anything still in the air back on its feet, unowned
  if (CBZ.apeReset) { try { CBZ.apeReset(); } catch (e) {} }
  // packsFor() sets this on every route that loads ground packs; the bench
  // button reaches begin() without one, so state it here too.
  HAS_BEASTS = rosterHasBeasts();
  // who is on each side, in words, with the flags now that city/flags.js is in
  refreshSides();
  /* THE AIR BELONGS TO THE PLACE. One desert haze over all five grounds put
     an orange dust horizon behind a glass downtown and washed the streets
     out to paper. Three skies: a hard flat light for the kill box, a clean
     maritime one for the city and the two islands, and the original basin
     haze for the dunes, which is the only map it was ever describing. */
  const SKY = {
    arena: {
      fov: 72, far: 3200, exposure: 0.92,
      sky: { top: 0x46586c, bottom: 0xb4ac96, fogNear: 260, fogFar: 1500, radius: 2600 },
      lights: { sun: 0.9, hemi: 0.5, shadowSpan: 320, groundColor: 0x6b6657 },
    },
    city: {
      fov: 70, far: 9000, exposure: 0.8,
      sky: { top: 0x27528c, bottom: 0x9fb6cc, fogNear: 420, fogFar: 3400, radius: 7000 },
      lights: { sun: 0.86, hemi: 0.52, shadowSpan: 420, groundColor: 0x6a6f76 },
    },
    dunes: {
      /* The sun came down from 0.98: at that level the sand's own vertex
         colours clipped to white and the whole erg rendered as a sheet of
         paper — the exact wash the city map already fixed for its stone.
         Sand is TAN, and the men and the dead have to read against it. */
      /* LATE AFTERNOON, NOT NOON. A sun 55° up over sand lights every face
         the same and the erg reads flat whatever its shape; at ~20° the
         slip faces fall into shade, the crests catch the light, and every
         man throws a long shadow down the slope — which is the picture of a
         desert war. The fill drops so the shade is shade (warm sand bounce,
         cool sky), and the haze goes gold toward the horizon. */
      fov: 64, far: 16000, exposure: 0.8,
      sky: { top: 0x2f63a3, bottom: 0xe6b57c, fogNear: 700, fogFar: 7200, radius: 12000, exponent: 0.55 },
      lights: { sun: 1.1, hemi: 0.36, shadowSpan: 160, shadowMap: 2048, sunColor: 0xffcf98,
        skyColor: 0x9db4d0, groundColor: 0xb48a58 },
      sunDir: [0.78, 0.36, 0.5],
    },
    /* OPEN WATER. A maritime sun high enough to put caustic-bright tops on
       the swell, a short fog so the horizon is haze and not a hard rim on a
       26 km plate, and a GROUND colour for the hemisphere light that is the
       sea itself — bounce off water is blue-green, and lighting a shark with
       a tan desert bounce is what made the first draft read as a toy. */
    water: {
      fov: 70, far: 9000, exposure: 0.88,
      sky: { top: 0x1b4c80, bottom: 0x9dc0d4, fogNear: 240, fogFar: 2400, radius: 7000 },
      lights: { sun: 1.2, hemi: 0.5, shadowSpan: 240, sunColor: 0xfff0d8, skyColor: 0xc4dced, groundColor: 0x1d4258 },
      sunDir: [0.72, 0.5, 0.48],
    },
  };
  /* SNOW: an overcast-bright northern day, short haze, a cold bounce off the
     snow itself. FIELDS: a temperate afternoon over green ground. */
  SKY.snow = {
    fov: 64, far: 16000, exposure: 0.84,
    sky: { top: 0x7d95b2, bottom: 0xdfe6ec, fogNear: 320, fogFar: 4200, radius: 12000, exponent: 0.7 },
    lights: { sun: 0.88, hemi: 0.62, shadowSpan: 160, shadowMap: 2048, sunColor: 0xfff4e6,
      skyColor: 0xc8d6e6, groundColor: 0xd5dbe0 },
    sunDir: [0.6, 0.42, 0.55],
  };
  SKY.grass = {
    fov: 64, far: 16000, exposure: 0.82,
    sky: { top: 0x2f63a3, bottom: 0xbcd0dc, fogNear: 600, fogFar: 6000, radius: 12000, exponent: 0.6 },
    lights: { sun: 1.0, hemi: 0.45, shadowSpan: 160, shadowMap: 2048, sunColor: 0xffe6c4,
      skyColor: 0xa9c2dc, groundColor: 0x5f6e3e },
    sunDir: [0.7, 0.42, 0.52],
  };
  /* THE WOOD: a high summer sun for the flecks to come through, a short
     green-grey haze (you cannot see far in a wood, and the belt of trees at
     the window's edge is where the fog should close), a dark bounce off the
     litter. */
  SKY.forest = {
    fov: 64, far: 9000, exposure: 0.86,
    sky: { top: 0x3d6a9c, bottom: 0xb9c6c2, fogNear: 140, fogFar: 1300, radius: 9000, exponent: 0.7 },
    lights: { sun: 1.05, hemi: 0.42, shadowSpan: 160, shadowMap: 2048, sunColor: 0xfff1d6,
      skyColor: 0xb4c8dc, groundColor: 0x3a3524 },
    sunDir: [0.55, 0.68, 0.48],
  };
  // every raised venue is coastal or downtown light: the desert haze was
  // only ever the dunes' (harbor, marina, the seat of state and the speedway
  // all used to fall through to it and stood under an orange sky)
  SKY.island = SKY.field = SKY.harbor = SKY.marina = SKY.gov = SKY.speedway = SKY.city;
  CBZ.micro.boot(SKY[SET.map] || SKY.dunes);
  CBZ.micro.pauseKey = null;                       // the clock is ours (Space)
  sunRig((SKY[SET.map] || SKY.dunes).sunDir);
  if (!CBZ.groundAt) CBZ.groundAt = function (x, z) { return MAP ? MAP.groundAt(x, z) : 0; };

  MAP = buildMap(SET.map);
  HOST = CBZ.battleHost.fromArena(MAP, CBZ.micro, CBZ.scene);
  STORE = CBZ.battleStore.create(Math.max(1024, SET.redN + SET.blueN));
  // THE GROUND IS FINISHED — settle it before a single man walks on. The
  // real fabric costs 17 000 draw calls raw and a fraction of that merged,
  // and the pass must run while the scene is still nothing but scenery:
  // anything added afterwards keeps its own live matrix, which is how the
  // men and the aircraft stay animated through it.
  if (Q.get("settle") !== "0") CBZ.studio.settle(CBZ.scene);
  // the walkable map, once, off the colliders the ground just registered
  navBuild(MAP.cx, MAP.cz, { city: 330, island: 340, field: 540, arena: 150, dunes: 220, snow: 220, grass: 220, forest: 220, water: 200 }[SET.map] || 260);
  AIR.on = SET.redS !== "none" || SET.blueS !== "none" ||
    !!(FRONT && ((FRONT.red.strikes | 0) > 0 || (FRONT.red.queued | 0) > 0 || (FRONT.blue.queued | 0) > 0));
  AIRSTRIKE.left = FRONT ? Math.max(0, FRONT.red.strikes | 0) : 0; AIRSTRIKE.used = 0;
  // WHO HOLDS (ORDERS): the front says; on the war room the outnumbered men
  ORDER.red = ORDER.blue = "advance";
  if (FRONT) ORDER[FRONT.hold === "blue" ? "blue" : "red"] = "hold";
  else if (!asBench && Q.get("hold") !== "0") {      // ?hold=0: the old meeting engagement, always
    const menRed = CBZ.battleRoster.has(SET.redU, "men"), menBlue = CBZ.battleRoster.has(SET.blueU, "men");
    if (menBlue && SET.redN >= SET.blueN * 1.5) ORDER.blue = "hold";
    else if (menRed && SET.blueN >= SET.redN * 1.5) ORDER.red = "hold";
  }
  // a small war is short: the warhead arms early enough to matter
  AIR.nukeAt = 20 + Math.min(22, (SET.redN + SET.blueN) / 36);
  if (AIR.on && CBZ.ordnance && CBZ.ordnance.init) {
    CBZ.ordnance.init({ scene: CBZ.scene, groundAt: MAP.groundAt });
  }
  if (asBench) {
    const step = benchStepFor();
    bench = { t: 0, nextAt: 3.2, step: step, lastGood: 0, dips: 0, grown: 0, fpsAcc: 0, fpsN: 0,
      unit: benchUnit(), scale: Math.round(benchScale() * 100) / 100 };
    // the opening size is one step plus a little, so the first measurement is
    // taken on a field that is already doing something. Men: 40, as always.
    SET.redN = SET.blueN = Math.max(4, Math.min(400, step + 10));
    SET.redW = SET.blueW = (SET.redW === "everything" || SET.redW === "mixed") ? "ak47" : SET.redW;
  }

  // SHADOWS PAY TWICE (a shadow pass draws every caster again). Big armies
  // buy frames with the sun instead.
  const total = SET.redN + SET.blueN;
  const R = CBZ.renderer || (CBZ.micro && CBZ.micro.renderer);
  if (R && R.shadowMap && (total > 170 || asBench)) R.shadowMap.enabled = false;

  // the studio HUD carries one line, and only for the bench: its running
  // census IS the measurement. A war you watch gets no ticker.
  hud = CBZ.studio.hud({ health: false, clock: false, score: false, feed: false, note: !!asBench, prompt: false, danger: false, pause: false });

  spawnQueue.length = 0;
  // interleave the queues so uneven armies still stream in fairly
  for (let i = 0; i < Math.max(SET.redN, SET.blueN); i++) {
    if (i < SET.redN) spawnQueue.push(["red", i]);
    if (i < SET.blueN) spawnQueue.push(["blue", i]);
  }
  spawnCount.red = SET.redN; spawnCount.blue = SET.blueN;
  spawnTotal = SET.redN + SET.blueN;
  /* A BATTLE BIGGER THAN THE FULL RIGS THIS DEVICE CARRIES is fought in
     tiers (src/battle/mass.js): the rows are spawned now, the nearest
     squads get rigs as the lens reaches them. A smaller one never enters. */
  MASS.begin(asBench);
  SETTINGS.apply();                     // shadows, the pixel ceiling, the crowd's bands (src/battle/settingspanel.js)

  cam.focus.set(MAP.cx, MAP.groundAt(MAP.cx, MAP.cz) + 2, MAP.cz);
  cam.wFocus.copy(cam.focus);
  cam.wDist = Math.min(300, 40 + Math.sqrt(spawnTotal) * 3.2);
  cam.dist = cam.wDist + 60;
  /* THE OPENING IS A CRANE DOWN BEHIND THE RED LINE, not a satellite view:
     it starts high and settles low across the field so the first thing a
     stranger sees is two armies facing each other over the ground. */
  cam.yaw = cam.wYaw = Math.atan2(-0.8, 0.6);
  cam.pitch = 0.62; cam.wPitch = MAP.water ? 0.3 : 0.2;
  cam.cutAt = 5;

  el("ctl").style.display = "flex";
  wakeCtl();
  setSpeed(1);
  setCamMode(asBench ? "free" : "auto");
  if (asBench) { cam.wPitch = 0.9; cam.wDist = 170; }
  initRes(spawnTotal);
  started = true;
  if (AIR.on) spawnPlanes();
  paintFrontCtl();
  // AT THE FRONT the two flags and the place, once, over the opening crane
  if (FRONT) banner(flagImg("red") + " " + TEAMS.red.name + " <em style=\"font-style:normal;color:#ffb35c\">v</em> " + TEAMS.blue.name + " " + flagImg("blue"),
    FRONT.where ? String(FRONT.where).toUpperCase() : "");
  CBZ.micro.onFrame(frame);
  if (SET.cam || SET.freeze) CBZ.micro.onFrame(urlLens);
}

/* ?cam= and ?freeze=1: A MATCHUP YOU CAN PHOTOGRAPH BY URL. Once the field
   is up (every body spawned), the lens goes to the named subject and holds
   on it (the STUDY desk: it never cuts), and freeze stops the clock there.
     cam=a | b            ride that side's front (FOLLOW)
     cam=<unit id>        the first living body of that kind (STUDY)
     cam=a:3 | b:0        that side's body by spawn index (STUDY)
   Runs once and stands down. */
let urlLensDone = false;
function urlLens() {
  if (urlLensDone || !started || spawnQueue.length) return;
  urlLensDone = true;
  const c = SET.cam;
  if (c === "a" || c === "b") setCamMode("follow", c === "a" ? "red" : "blue");
  else if (c) {
    // the study desk follows it, and finds the next of its kind if it falls
    const pick = studyFind(c);
    if (pick) { STUDY.m = pick; STUDY.want = c; setCamMode("study"); }
  }
  if (SET.freeze) setSpeed(0);
}

/* THE SUN IS AIMED, AND ITS SHADOW FOLLOWS THE LENS'S SUBJECT.
   microboot parks the sun at a fixed noon bearing over the CAMERA and spans
   its shadow map 600 m — at 2048 texels that is 0.6 m a texel, so a man
   (0.5 m across) cast no readable shadow at all and the armies floated on
   the sand. Here the map owns the bearing (`sunDir`, low and warm on the
   dunes), the shadow box is centred on what the lens is LOOKING AT, and it
   is sized to the arm: tight and crisp on a follow shot, wide on a crane.
   The sky dome gets the sun too — a glow and a disc where the light comes
   from, so the key light has a source in frame. */
function sunRig(dir) {
  const sun = CBZ.micro.sun;
  if (!sun) return;
  const v = new THREE.Vector3(0.55, 1, 0.35);
  if (dir) v.fromArray(dir);
  v.normalize();
  const D = 700;
  let lastSpan = 0;
  /* THE BUG THAT HID EVERY SHADOW ON THIS PAGE. studio.settle() freezes the
     scene's static matrices, and the sun's TARGET is a plain Object3D in the
     scene — so it was frozen where boot put it, at the world origin, while
     the sun itself (a light, skipped by the freeze) followed the camera. The
     key light aimed from over the battle toward a point two kilometres away:
     wrong direction, and a shadow frustum that never contained a single man.
     The target is marked dynamic before the settle, and its matrix is
     rebuilt by hand every frame regardless. */
  sun.target.userData.dynamic = true;
  sun.target.matrixAutoUpdate = true;
  CBZ.micro.onFrame(function () {
    const f = cam.focus;
    sun.position.set(f.x + v.x * D, f.y + v.y * D, f.z + v.z * D);
    sun.target.position.set(f.x, f.y, f.z);
    sun.target.updateMatrix();
    sun.target.updateMatrixWorld(true);
    if (!sun.castShadow) return;
    const span = Math.max(38, Math.min(460, cam.dist * camOccl * 1.2 + 26));
    if (Math.abs(span - lastSpan) > lastSpan * 0.12) {
      lastSpan = span;
      const sc = sun.shadow.camera;
      sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
      sc.near = 20; sc.far = D * 2;
      sc.updateProjectionMatrix();
      const texel = span * 2 / (sun.shadow.mapSize.width || 2048);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = texel * 1.6;
    }
  }, { order: 50 });
  const dome = CBZ.micro.skyDome;
  if (dir && dome && dome.material && dome.material.uniforms) {
    dome.material.uniforms.sunDir = { value: v.clone() };
    dome.material.fragmentShader =
      "uniform vec3 topColor;uniform vec3 bottomColor;uniform float offset;uniform float exponent;uniform vec3 sunDir;" +
      "varying vec3 vW;void main(){float h=normalize(vW+vec3(0.0,offset,0.0)).y;" +
      "vec3 col=mix(bottomColor,topColor,pow(max(h,0.0),exponent));" +
      "vec3 dir=normalize(vW-cameraPosition);float s=max(dot(dir,sunDir),0.0);" +
      "col+=vec3(1.0,0.66,0.36)*(pow(s,6.0)*0.32+pow(s,48.0)*0.5)*(1.0-max(h,0.0)*0.6);" +
      "col=mix(col,vec3(1.0,0.95,0.84)*2.2,smoothstep(0.9993,0.9997,s));" +
      "gl_FragColor=vec4(col,1.0);}";
    dome.material.needsUpdate = true;
  }
}
