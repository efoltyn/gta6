/* People anatomy for ba / tools/visual-compare.mjs.

   OWNER (2026-11-21): "look at player in nat disaster and it should be same as
   other games and make shoulders and player overall look more realistic ...
   women should look more like women and more attractive and shoulders of all
   characters and overall character should just look more real."

   Boots the REAL game into Natural Disaster Survival (so the wardrobe, the
   face system and the live island all exist exactly as in play), freezes the
   rAF loop, then photographs two things:

     THE STUDIO — bodies built with CBZ.makeCharacter (the one rig every game
     uses) standing against a wall ruled every 20 cm: the four body types of
     each sex in gym kit (bare arms, bare legs, a bare midriff on the women, so
     the BODY is what is photographed), from the front, three-quarter, side
     and back; the shoulders close and with the arms moved; the same people
     dressed through the city wardrobe; faces; a family for scale.

     THE ISLAND — the live player in the disaster game, from the front, from
     the play camera's side and among the other survivors.

   Flat looks are the rig's own colour slots, so the gym pages stage the same
   on a build with or without the wardrobe; dressed pages go through
   CBZ.cityRecolorRig like every other dresser in the game. */

const MEN = [
  { physique: "average", skin: 0xd9a47a, hair: 0x2a2018, hairStyle: "short" },
  { physique: "slim", skin: 0xf0c39a, hair: 0x7a4a2e, hairStyle: "crop" },
  { physique: "heavy", skin: 0x8a5a3a, hair: 0x14100c, hairStyle: "buzz" },
  { physique: "muscular", skin: 0xc08a5a, hair: 0x1a1410, hairStyle: "short" },
];
const WOMEN = [
  { physique: "average", skin: 0xe6b48c, hair: 0x3a2416, hairStyle: "long" },
  { physique: "slim", skin: 0xf2cbb0, hair: 0xb98a4a, hairStyle: "pony" },
  { physique: "heavy", skin: 0x8a5a3a, hair: 0x14100c, hairStyle: "curly" },
  { physique: "muscular", skin: 0xc08a5a, hair: 0x241810, hairStyle: "bun" },
];
const man = (i, extra) => Object.assign({ build: "m" }, MEN[i], extra || {});
const woman = (i, extra) => Object.assign({ build: "f" }, WOMEN[i], extra || {});

const BUILDS = ["slim", "average", "athletic", "muscular", "big", "stocky", "heavy", "obese"];
const inmate = (heritage, wear, extra) => Object.assign({ build: "m", heritage, wear: wear || "inmate" }, extra || {});
const YARD = ["black", "latino", "white", "eastasian"];

const subjects = [
  { id: "prison-front", label: "Prison: four inmates, front", studio: true, view: "front",
    who: YARD.map((h) => inmate(h)),
    focus: "The prison game's own men (heritage tables, the DOC jumpsuit). Read the hips: the trousers should run from the waist into the legs, not sit on them like a padded brief." },
  { id: "prison-tank", label: "Prison: jumpsuit tied at the waist, tank", studio: true, view: "front",
    who: YARD.map((h) => inmate(h, "inmate_tank")),
    focus: "Bare arms and shoulders on the yard's men, and the tied waist over the hips." },
  { id: "prison-threeq", label: "Prison: three-quarter", studio: true, view: "threeq",
    who: YARD.map((h) => inmate(h)),
    focus: "Turned 40 degrees: the seat, the front of the hips, the shoulder." },
  { id: "prison-back", label: "Prison: back", studio: true, view: "back",
    who: YARD.map((h) => inmate(h)),
    focus: "The view the play camera has: back, seat and legs." },
  { id: "hips-close", label: "Hips, close: inmates and a woman", studio: true, view: "front", frame: "hips",
    who: [inmate("black"), inmate("white", "inmate_tank"), woman(0, { wear: "street" })],
    focus: "Waist to knee. Before: the hip block stands out round the thighs and its lower edge draws a leg hole. After: the thighs come out of the body." },
  { id: "hips-threeq", label: "Hips, close: three-quarter", studio: true, view: "threeq", frame: "hips",
    who: [inmate("black"), inmate("white", "inmate_tank"), woman(0, { wear: "street" })],
    focus: "The same from 40 degrees: the front of the hip and the seat." },
  { id: "hips-back", label: "Hips, close: back", studio: true, view: "back", frame: "hips",
    who: [inmate("black"), inmate("white", "inmate_tank"), woman(0, { wear: "street" })],
    focus: "The seat from behind: it should stand out over the back of the thigh with a fold under it." },
  { id: "women-swim-front", label: "Women in a two-piece: front", studio: true, view: "front", fit: "swim",
    who: [woman(0), woman(1), woman(2), woman(3)],
    focus: "The game's own beach two-piece (top, bare middle, brief, bare legs): the body with nothing hiding it. Waist into hips into thighs, the line of the brief along the groin." },
  { id: "women-swim-threeq", label: "Women in a two-piece: three-quarter", studio: true, view: "threeq", fit: "swim",
    who: [woman(0), woman(1), woman(2), woman(3)],
    focus: "Bust, the small of the back, the seat, the thigh." },
  { id: "women-swim-side", label: "Women in a two-piece: side", studio: true, view: "side", fit: "swim",
    who: [woman(0), woman(1), woman(2), woman(3)],
    focus: "In profile: chest, flat middle, a seat that stands out behind." },
  { id: "women-swim-back", label: "Women in a two-piece: back", studio: true, view: "back", fit: "swim",
    who: [woman(0), woman(1), woman(2), woman(3)],
    focus: "From behind: shoulders, waist, hips, seat." },
  { id: "men-swim-front", label: "Men in trunks: front", studio: true, view: "front", fit: "swim",
    who: [man(0), man(1), man(2), man(3)],
    focus: "Bare chest and legs with a brief: the groin line on a man." },
  { id: "women-seat-close", label: "Women, the seat: close, from behind", studio: true, view: "back", frame: "hips", fit: "swim",
    who: [woman(0), woman(1), woman(3)],
    focus: "Waist to knee from behind in a two-piece: two round cheeks with a cleft, a fold under them, hips wider than the waist." },
  { id: "women-seat-threeq", label: "Women, the seat: three-quarter from behind", studio: true, view: "threeqback", frame: "hips", fit: "swim",
    who: [woman(0), woman(1), woman(3)],
    focus: "The same turned 40 degrees: how far the seat stands out behind the small of the back." },
  { id: "types-men", label: "The spectrum: eight builds, men", studio: true, view: "front", frame: "wide", fit: "gym",
    who: BUILDS.map((b, i) => man(i % 4, { physique: b })),
    focus: "Slim, average, athletic, muscular, big, stocky, heavy, obese. Before this there were four; a build it does not know falls back to its own pick." },
  { id: "types-women", label: "The spectrum: eight builds, women", studio: true, view: "front", frame: "wide", fit: "gym",
    who: BUILDS.map((b, i) => woman(i % 4, { physique: b })),
    focus: "The same eight on women." },
  { id: "heights", label: "The spectrum: height", studio: true, view: "front", frame: "wide",
    who: [0.93, 0.98, 1.03, 1.08].map((h, i) => man(i, { stature: h, wear: "street" })).concat([0.93, 0.98, 1.03, 1.08].map((h, i) => woman(i, { stature: h, wear: "street" }))),
    focus: "Four men and four women from the shortest to the tallest the draw gives (a man 1.66 to 1.93 m). Before: everyone of a sex was one height." },
  { id: "yard-mix", label: "The jail yard: eight men as the game draws them", studio: true, view: "front", frame: "wide",
    who: ["black", "white", "latino", "eastasian", "mideast", "islander", "southasian", "native"].map((h) => inmate(h)),
    focus: "No build or height asked for: each man gets his own from his look, the way the yard is populated. Different heights, arms, bellies." },
  { id: "men-front", label: "Men, four body types: front", studio: true, view: "front", fit: "gym",
    who: [man(0), man(1), man(2), man(3)],
    focus: "Average, slim, heavy, muscular. Read the shoulder line from the neck to the arm, how far the arms hang from the ribs, the length of the forearm and the leg, and the size of the head on the body." },
  { id: "men-threeq", label: "Men: three-quarter", studio: true, view: "threeq", fit: "gym",
    who: [man(0), man(1), man(2), man(3)],
    focus: "The same four turned 40 degrees: chest depth, the deltoid over the shoulder, the arm against the body." },
  { id: "men-back", label: "Men: back", studio: true, view: "back", fit: "gym",
    who: [man(0), man(1), man(2), man(3)],
    focus: "The view the play camera has all day: the trapezius, the back narrowing to the waist, hips under the shoulders." },
  { id: "women-front", label: "Women, four body types: front", studio: true, view: "front", fit: "gym",
    who: [woman(0), woman(1), woman(2), woman(3)],
    focus: "Average, slim, heavy, muscular. Shoulders against hips, the waist and where it sits, the bust, the neck, the arms." },
  { id: "women-threeq", label: "Women: three-quarter", studio: true, view: "threeq", fit: "gym",
    who: [woman(0), woman(1), woman(2), woman(3)],
    focus: "Turned 40 degrees: the bust, the small of the back, the seat, the line of the leg." },
  { id: "women-side", label: "Women: side", studio: true, view: "side", fit: "gym",
    who: [woman(0), woman(1), woman(2), woman(3)],
    focus: "In profile: chest, waist, seat, the head on the neck." },
  { id: "women-back", label: "Women: back", studio: true, view: "back", fit: "gym",
    who: [woman(0), woman(1), woman(2), woman(3)],
    focus: "From behind: narrow shoulders over a waist over wider hips." },
  { id: "shoulders-men", label: "Shoulders, men: close", studio: true, view: "front", fit: "gym", frame: "chest",
    who: [man(0), man(3)],
    focus: "Average and muscular, chest up. The line from the neck over the trapezius to the shoulder point and down the deltoid." },
  { id: "shoulders-women", label: "Shoulders, women: close", studio: true, view: "front", fit: "gym", frame: "chest",
    who: [woman(0), woman(1)],
    focus: "Average and slim, chest up. Slim neck, sloping shoulder, the collar line." },
  { id: "shoulders-move", label: "Shoulders with the arms moved", studio: true, view: "front", fit: "gym", frame: "chest", pose: "arms",
    who: [man(0), woman(0)],
    focus: "One arm out to the side, one raised forward: the joint must stay closed and the shoulder must still read as a shoulder." },
  { id: "dressed-men", label: "Men dressed: tee, hoodie, suit, police", studio: true, view: "front",
    who: [man(0, { wear: "street" }), man(1, { wear: "hoodie" }), man(3, { wear: "suit" }), man(0, { wear: "police", skin: 0x8a5a3a, hair: 0x14100c, hairStyle: "buzz" })],
    focus: "The same bodies in the city's wardrobe: clothes hang on the new shoulders, jackets close at the collar, the duty belt clears the arms." },
  { id: "dressed-women", label: "Women dressed: tee, summer dress, evening dress, suit", studio: true, view: "front",
    who: [woman(0, { wear: "street" }), woman(1, { wear: "sundress" }), woman(0, { wear: "dress", skin: 0xc08a5a, hair: 0x14100c, hairStyle: "long" }), woman(3, { wear: "suit" })],
    focus: "A woman's shape under cloth: the waist and hips of a dress, a tee over the bust, a jacket on narrower shoulders." },
  { id: "dressed-threeq", label: "Dressed: three-quarter", studio: true, view: "threeq",
    who: [man(0, { wear: "street" }), woman(0, { wear: "street" }), man(3, { wear: "suit" }), woman(1, { wear: "sundress" })],
    focus: "Street clothes, a suit and a dress turned 40 degrees." },
  { id: "faces-women", label: "Faces, women", studio: true, view: "front", frame: "face", fit: "gym",
    who: [woman(0), woman(1), woman(3, { hairStyle: "bob", hair: 0x1a1410 })],
    focus: "The head is narrower than it is tall now. Jaw, eyes, lips, the neck under it." },
  { id: "faces-men", label: "Faces, men", studio: true, view: "front", frame: "face", fit: "gym",
    who: [man(0), man(1), man(2)],
    focus: "The same for the men: skull shape, jaw, neck width." },
  { id: "family", label: "A family for scale", studio: true, view: "front",
    who: [man(0, { wear: "street" }), woman(0, { wear: "street" }), { build: "f", age: 15, skin: 0xe6b48c, hair: 0x3a2416, hairStyle: "pony", wear: "street" }, { build: "m", age: 9, skin: 0xd9a47a, hair: 0x2a2018, wear: "street" }],
    focus: "A man, a woman, a girl of fifteen and a boy of nine against the 20 cm rule: stature and proportion change with age, not just scale." },
  { id: "island-front", label: "Natural Disaster: the player, front", studio: false, world: "front",
    focus: "The live player on the island. Before: the convict's flat orange jumpsuit, which no other game leaves on you. After: the street clothes you wear in the city, on the new body." },
  { id: "island-play", label: "Natural Disaster: the player, play camera", studio: false, world: "play",
    focus: "What you actually look at while you play: your own back and shoulders from the chase camera." },
  { id: "island-crowd", label: "Natural Disaster: among the survivors", studio: false, world: "crowd",
    focus: "The player with the other ninety-nine around: one population, one kind of body." },
];

export async function stagePeople(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      child.style.visibility = "hidden";
    }
  };
  const heal = () => { if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; if (CBZ.player.stamina != null) CBZ.player.stamina = 100; } };
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; try { CBZ.stepSim(1 / 60); } catch (_) {} heal(); }
  };

  let S = window.__peopleSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    step(1.5);                                   // the match stands up; whatever dresses the player has run

    // ---- the studio: a wall ruled every 20 cm, a floor, light that reads ----
    const studio = new T.Scene();
    studio.background = new T.Color(0x5c6065);
    const wall = new T.Mesh(new T.BoxGeometry(14, 4, 0.2), new T.MeshLambertMaterial({ color: 0x6e7176 })); wall.position.set(0, 2, -0.9); studio.add(wall);
    const floor = new T.Mesh(new T.BoxGeometry(14, 0.2, 8), new T.MeshLambertMaterial({ color: 0x5f6266 })); floor.position.set(0, -0.1, 2); studio.add(floor);
    const lineMat = new T.MeshLambertMaterial({ color: 0x3a3d41 }), metreMat = new T.MeshLambertMaterial({ color: 0x1f2124 });
    for (let i = 2; i <= 11; i++) {                // 0.4 .. 2.2 m; the metre lines darker
      const h = i * 0.2, whole = i % 5 === 0;
      const l = new T.Mesh(new T.BoxGeometry(14, whole ? 0.02 : 0.012, 0.02), whole ? metreMat : lineMat); l.position.set(0, h, -0.79); studio.add(l);
    }
    studio.add(new T.AmbientLight(0xffffff, 0.36));
    const key = new T.DirectionalLight(0xffffff, 0.50); key.position.set(1.8, 4, 5); studio.add(key);
    const rim = new T.DirectionalLight(0xbfd4ff, 0.20); rim.position.set(-2.5, 2.5, -2); studio.add(rim);
    const cam = new T.PerspectiveCamera(30, 16 / 10, 0.05, 80);
    const worldCam = new T.PerspectiveCamera(42, 16 / 10, 0.05, 4000);
    S = window.__peopleSeq = { studio, cam, worldCam, rigs: [], mode: "world", view: null };

    window.__cbzVisualCompare = {
      render() {
        try {
          const r = CBZ.renderer;
          r.setSize(r.domElement.clientWidth || r.domElement.width, r.domElement.clientHeight || r.domElement.height, false);
          const aspect = r.domElement.width / r.domElement.height;
          if (S.mode === "studio") { S.cam.aspect = aspect; S.cam.updateProjectionMatrix(); r.render(S.studio, S.cam); }
          else {
            const c = S.view || CBZ.camera;
            c.aspect = aspect; c.updateProjectionMatrix();
            try { if (CBZ.skyDome && CBZ.skyDome.parent) CBZ.skyDome.parent.position.copy(c.position); } catch (_) {}
            r.render(CBZ.scene, c);
          }
        } catch (_) {}
      },
    };
  }

  const subject = input.subject;
  hideHud();

  // ---- a person: the rig's own flat slots, or the city wardrobe ------------
  const JEAN = 0x39414f, TEE = 0xf2f2f2;
  const DOC = { legs: 0xff7a1a, torso: 0xff7a1a, collar: 0xff9747, arms: 0xff7a1a, stripes: 0xc85c00, shoes: 0x2b2b2b };
  function lookOf(w, fit, seed) {
    if (w.heritage) {                              // one of the yard's men, rolled from his heritage's own tables
      if (CBZ.heritageRoll) return Object.assign({}, DOC, CBZ.heritageRoll(w.heritage, "anatomy|" + w.heritage + "|" + seed, w.wear === "inmate_tank" ? { tank: true } : null));
      return Object.assign({}, DOC, { skin: 0xc08a5a, hair: 0x222222 });
    }
    const c = { build: w.build, skin: w.skin, hair: w.hair, shoes: 0x2b2b2b };
    if (w.physique) c.physique = w.physique;
    if (w.stature) c.stature = w.stature;
    if (w.age != null) c.age = w.age;
    if (w.hairStyle) c.hairStyle = w.hairStyle;
    if (fit === "swim") {
      // the beach's own two-piece / trunks (city/beach.js beachSwimwear): bare skin, a top, a brief
      const all = { torso: w.skin, collar: w.skin, arms: w.skin, waist: w.skin, pelvis: w.skin, legs: w.skin, shins: w.skin };
      if (w.build === "f") Object.assign(c, all, { torso: 0x2a3a8a, pelvis: 0x2a3a8a });
      else Object.assign(c, all, { pelvis: 0x1f3d4d, legs: 0x1f3d4d });      // board shorts: the thigh in cloth, as the beach dresses a man
    } else if (fit === "gym") {
      // bare arms and legs; the women a bare midriff: the body is the subject
      if (w.build === "f") Object.assign(c, { torso: 0x8a2f4a, collar: w.skin, arms: w.skin, waist: w.skin, pelvis: 0x20242c, legs: 0x20242c, shins: w.skin });
      else Object.assign(c, { torso: 0x34404c, collar: w.skin, arms: w.skin, pelvis: 0x1d2530, legs: 0x1d2530, shins: w.skin });
      // shorts end above the knee: the whole thigh in cloth would hide the leg
    } else Object.assign(c, { torso: TEE, collar: TEE, arms: TEE, legs: JEAN, shortSleeve: true });
    return c;
  }
  function dress(ch, w, look) {
    if (!w.wear) return "flat";
    try {
      if (w.heritage) {
        if (CBZ.heritageApply && look && look.heritage) CBZ.heritageApply(ch, look);
        const cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null, rec = cat && (cat[w.wear] || cat.inmate);
        if (rec && CBZ.cityRecolorRig) CBZ.cityRecolorRig(ch, rec.colors, rec);
        if (ch.skinSlots && ch.skinSlots.stripes) for (const st of ch.skinSlots.stripes) if (st) st.visible = false;
        return w.wear;
      }
      if (w.wear === "street") {
        const colors = { legs: JEAN, torso: TEE, collar: TEE, arms: TEE, shoes: 0x2b2b2b };
        if (CBZ.cityRecolorRig) { CBZ.cityRecolorRig(ch, colors, { id: "civvies", colors, composite: { shirt: TEE, legs: JEAN, items: [] } }); return "street"; }
        return "flat";
      }
      const cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null, rec = cat && cat[w.wear];
      if (rec && CBZ.cityRecolorRig) { CBZ.cityRecolorRig(ch, rec.colors, rec); return w.wear; }
    } catch (_) {}
    return "flat";
  }
  const _b = new T.Box3(), _v = new T.Vector3();
  function spanOf(list, axis) {                  // world extent of some meshes, metres
    let lo = Infinity, hi = -Infinity;
    for (const m of list) {
      if (!m || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) continue;
      m.updateWorldMatrix(true, false);
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 3) { _v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); const a = _v[axis]; if (a < lo) lo = a; if (a > hi) hi = a; }
    }
    return hi > lo ? hi - lo : 0;
  }

  for (const r of S.rigs) S.studio.remove(r.group);
  S.rigs = [];
  let metrics = {}, fits = [];

  if (subject.studio) {
    S.mode = "studio"; S.view = null;
    const who = subject.who, n = who.length;
    const frame = subject.frame || "body";
    const gap = frame === "face" ? 0.46 : frame === "chest" ? 0.86 : frame === "hips" ? 0.78 : frame === "wide" ? 0.74 : 1.06;
    const yaw = subject.view === "threeq" ? -0.70 : subject.view === "side" ? -Math.PI / 2 : subject.view === "back" ? Math.PI : subject.view === "threeqback" ? Math.PI - 0.75 : 0;
    for (let i = 0; i < n; i++) {
      const w = who[i];
      const look = lookOf(w, w.wear ? "street" : subject.fit, i);
      const ch = CBZ.makeCharacter(look);
      ch.group.userData.dynamic = true;
      ch.group.position.set((i - (n - 1) / 2) * gap, 0, 0.6);
      ch.group.rotation.y = yaw;                 // the rig faces +Z as built: the lens is on +Z
      S.studio.add(ch.group);
      ch.group.updateMatrixWorld(true);
      fits.push(dress(ch, w, look));
      S.rigs.push(ch);
    }
    if (subject.pose === "arms") for (const ch of S.rigs) {
      try { const p = ch.parts; p.la.rotation.z = 1.25; p.ra.rotation.x = -1.35; p.ra.rotation.z = -0.12; } catch (_) {}
    }
    for (const ch of S.rigs) ch.group.updateMatrixWorld(true);
    // faces line up on the lens whatever the stature
    if (frame === "face" || frame === "chest") for (const ch of S.rigs) {
      try {
        ch.head.getWorldPosition(_v);
        ch.group.position.y += (frame === "face" ? 1.60 : 1.62) - _v.y;
        ch.group.updateMatrixWorld(true);
      } catch (_) {}
    }
    const c = S.cam;
    if (frame === "face") { c.position.set(0, 1.60, 1.95); c.lookAt(0, 1.57, 0.6); }
    else if (frame === "chest") { c.position.set(0, 1.46, 2.85); c.lookAt(0, 1.40, 0.6); }
    else if (frame === "hips") { c.position.set(0, 0.98, 2.75); c.lookAt(0, 0.90, 0.6); }
    else if (frame === "wide") { c.position.set(0, 1.08, 9.6); c.lookAt(0, 1.0, 0.6); }
    else { c.position.set(0, 1.02, 7.1); c.lookAt(0, 0.96, 0.6); }
    // measurements of the FIRST figure on the page (front pages read true)
    try {
      const ch = S.rigs[0], s = ch.skinSlots, yaw0 = ch.group.rotation.y, y0 = ch.group.position.y;
      ch.group.rotation.y = 0; ch.group.updateMatrixWorld(true);
      const arms = [].concat(s.arms || []);
      for (const a of (s.arms || [])) if (a && a.userData && a.userData.bare) arms.push(a.userData.bare);
      const head = [ch.head];
      _b.setFromObject(ch.head);
      metrics = {
        shoulderCm: +(spanOf(arms, "x") * 100).toFixed(1),
        hipCm: +(spanOf(s.pelvis || [], "x") * 100).toFixed(1),
        headWidthCm: +(spanOf(head, "x") * 100).toFixed(1),
        statureCm: +((_b.max.y - y0) * 100).toFixed(1),
      };
      ch.group.rotation.y = yaw0; ch.group.updateMatrixWorld(true);
    } catch (_) {}
  } else {
    S.mode = "world";
    const P = CBZ.player, ch = CBZ.playerChar;
    if (!P || !ch) return { ok: false, err: "no player" };
    step(0.2); heal();
    // open ground: the direction with the longest clear run from the player's
    // chest, tried sun side first (the sun sits at +x / -z of the island)
    if (!S.face) {
      const origin = new T.Vector3(P.pos.x, P.pos.y + 1.2, P.pos.z), ray = new T.Raycaster();
      ray.far = 9;
      ray.camera = CBZ.camera;                     // (sprites in the scene ask for one)
      let best = Math.atan2(70, -50), bestD = -1;
      const skip = (o) => { for (let q = o; q; q = q.parent) if (q === ch.group) return true; return false; };
      for (let k = 0; k < 12; k++) {
        const a = Math.atan2(70, -50) + k * Math.PI / 6;
        let d = 9;
        try {
          ray.set(origin, new T.Vector3(Math.sin(a), 0, Math.cos(a)));
          const hits = ray.intersectObjects(CBZ.scene.children, true);
          for (const h of hits) { if (skip(h.object) || (h.object.material && h.object.material.transparent)) continue; d = h.distance; break; }
        } catch (_) {}
        if (d > bestD + 0.5) { bestD = d; best = a; }
        if (d >= 8.9) break;
      }
      S.face = best;
    }
    const a = S.face, fx = Math.sin(a), fz = Math.cos(a);
    ch.group.position.copy(P.pos);
    ch.group.rotation.set(0, a, 0);               // faces the lens
    ch.group.updateMatrixWorld(true);
    const c = S.worldCam, by = P.pos.y;
    if (subject.world === "front") { c.fov = 34; c.position.set(P.pos.x + fx * 4.3, by + 1.25, P.pos.z + fz * 4.3); c.lookAt(P.pos.x, by + 0.98, P.pos.z); }
    else if (subject.world === "play") { c.fov = 50; c.position.set(P.pos.x - fx * 3.1 + fz * 0.5, by + 1.95, P.pos.z - fz * 3.1 - fx * 0.5); c.lookAt(P.pos.x + fx * 2, by + 1.25, P.pos.z + fz * 2); }
    else { c.fov = 46; c.position.set(P.pos.x + fx * 6.2 + fz * 1.6, by + 1.7, P.pos.z + fz * 6.2 - fx * 1.6); c.lookAt(P.pos.x, by + 1.0, P.pos.z); }
    c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    S.view = c;
    try {
      const s = ch.skinSlots, t = s.torso && s.torso[0], hex = t && t.material && t.material.color ? t.material.color.getHex() : -1;
      fits.push(t && t.material && t.material.map ? "painted" : "flat #" + (hex >>> 0).toString(16));
      const arms = [].concat(s.arms || []);
      metrics = { shoulderCm: +(spanOf(arms, "x") * 100).toFixed(1) };
    } catch (_) {}
  }

  window.__cbzVisualCompare.metrics = () => metrics;
  window.__cbzVisualCompare.render();
  return { ok: true, fits, metrics };
}

export default {
  id: "people-anatomy",
  title: "People: real anatomy, and the same player in every game",
  description: "The one human rig every game uses, before and after the anatomy pass: shoulders at a real width with one line from neck to arm, a head narrower than it is tall, real forearm and leg lengths, a woman's shape, and the Natural Disaster player dressed like the player everywhere else.",
  viewport: { width: 1280, height: 800 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metrics: {
    shoulderCm: { label: "shoulder span, first figure", unit: "cm" },
    hipCm: { label: "hip width, first figure", unit: "cm" },
    headWidthCm: { label: "head width, first figure", unit: "cm" },
    statureCm: { label: "stature, first figure", unit: "cm" },
  },
  subjects,
  stage: stagePeople,
};
