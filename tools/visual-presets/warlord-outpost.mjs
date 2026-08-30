/* DESERT WARLORD — AN OUTPOST IS A PLACE WITH A PERSON IN IT.

   THE OWNER, LOOKING AT THE LIVE GAME:

       "I GET A MAN WITH A CRATE POPUP IN GAME WITHOUT A FUCKING MAN IN FRONT
        OF ME AND IT COVERS THE SCREEN, RUINING THE FUCKING GAME. HAVE A GUY
        WITH A CRATE OR A SMALL STAND SELLING SHIT AND A LITTLE HOUSE — WE
        LEGIT HAVE HOUSES AND FACADES ALREADY CODED YOU JUST NEED TO LOOK.
        RN WE HAVE BARREN DESERT AND MAN WITH A CRATE POPUP WITH NO MAN
        THERE."

   He is describing three separate things and all three are in this pair.

   WHAT AN OUTPOST WAS. campaign.js's raiseOutposts() drew five BoxGeometry
   huts on a hashed ring, a cylinder mast and a flag, and a comment saying
   that was deliberate. Two bugs made even that worse than it sounds. The
   huts were painted 0xbaa07a as though a hex meant what a person means by
   it — this page renders through outputEncoding = sRGBEncoding with ACES,
   so a hex is STORED linear and encoded on the way out, sand arrives at
   0xE8-0xF1, and 0xbaa07a arrives as blank paper. Look at the before column
   below: the boxes are very slightly paler than the dune they stand on, and
   that is the SAME bug that sent him a black slab — a lit face washes out
   into the sand and a shaded one drops to hemisphere ambient and goes dark.
   They were also seated on `heightAt` while being drawn against
   `renderHeightAt`, which desert.js measures at 9.9-17.3 cm of error, so
   they were half sunk as well.

   WHAT WAS ALREADY IN THE REPO. props.js has shipped a finished depot, camp,
   well and market this entire time — crane, containers, sandbag runs, tent
   arcs, palms, a well head, lamp-lit stalls, a near half and a far
   silhouette, colliders, batching — and NOTHING HAS EVER CALLED IT.
   `grep -rn "props.outpost" src/` returned one hit and it was the doc
   comment at the top of props.js. So the after column is mostly a deletion.

   THE HOUSES ARE ALSO NOT NEW. city/villagekit.js registers hut_round,
   hut_square and shack_lean: mud-brick dwellings at 3-4 m with a slab roof,
   a doorway gap and a made bedroll on the floor. It needs city/assets.js and
   CBZ.cmat and nothing else, so two script tags put it on this page. Every
   other house in this repo was checked and cannot run here — the facades
   (desertmod, adobe, ranch, spanish) emit only through a ctx that
   city/buildings.js mints, and what they dress is a four-storey 22 m shell;
   world/desertcity.js adds itself to the scene and its smallest structure is
   a 22 m blast shelter; city/construction.js has been dead since line 81.

   AND THE FOURTH KIND HAS NEVER EXISTED. outpost.js declares depot, camp,
   well and market. placeOutposts() drew from {camp, town} at the oases and
   {depot, camp} on the coast, so no campaign has ever contained a night
   market — the one buyer who pays 0.55 on the dollar and the one seller who
   ignores rarity. It is placed inland now, which is also the only part of a
   14 km island the other three kinds never send you to.

   WHAT TO LOOK FOR, because the numbers cannot see it:
     · is there a MAN. Not a marker, not a plate — a dressed body standing at
       a counter, breathing, with his own tier's uniform on him.
     · is there a HOUSE, with a dark doorway in it.
     · are the four kinds four different PLACES, or one place four times.
     · does anything float or sink. The compound is rigid; the ground is not.
*/

/* THE NIGHT MARKET SUBJECT NEEDS A FALLBACK COORDINATE, and the reason it
   needs one is the whole point of the subject: THERE IS NO NIGHT MARKET ON
   THE BEFORE ISLAND. Not "somewhere else" — placeOutposts() drew from
   {camp, town} at the oases and {depot, camp} on the coast, so outpost.js's
   fourth kind has never once been built in a campaign. The lookup finds one
   on the after column and finds nothing on the before column, and rather
   than render an error page there this stands the before camera on a real
   inland patch of seed 1337's island — read off a live boot: land, walkable,
   deep enough in the interior to be where a market belongs — and
   photographs what is there, which is sand. */
const MARKET = { x: 485, z: 1890 };

const subjects = [
  {
    id: "arrival", kind: "depot", ahead: 46, dist: 26, yaw: 0.30, hour: 9.0,
    label: "The Moment The Screen Opens",
    focus:
      "Stood at OUTPOST_R — the exact 46 m where checkContacts fires and outpost.js takes the screen. BEFORE: this is what is in front of you when the trading card covers it. AFTER: a compound with a stall, houses and people in it, so the card is opening over somewhere you have arrived at.",
  },
  {
    id: "the-stall", kind: "depot", ahead: 8, dist: 20, yaw: 0.55, hour: 9.6,
    label: "The Stall, And The Man Behind It",
    focus:
      "Close enough that the 48-slot rig pool has certainly given the trader a real body: a CBZ.studio.cast rig dressed by W.outfits at his own tier, seated on the drawn sand by W.sand.plant, breathing on CBZ.animChar at speed 0. He is pushed through the SAME queue as the player's column and every warband on the island — there is no second way to put a man on this map.",
  },
  {
    id: "recruit-camp", kind: "camp", ahead: 6, dist: 25, yaw: -0.5, hour: 8.2,
    label: "The Recruit Camp — Men For Hire, With Men In It",
    focus:
      "outpost.js's blurb is 'men at the water, looking for a warlord', so this is the kind that carries the most bodies: at the fires, at the rifle stacks, at the bell tents. Sixteen ridge tents in two arcs, a cook pot, a rope corral, and three mud-brick houses in the horseshoe's mouth so you ride past somebody's front door to reach the recruiter.",
  },
  {
    id: "the-well", kind: "well", ahead: 6, dist: 25, yaw: 0.9, hour: 11.0,
    label: "The Well — Shade, Water, And Somebody Who Lives There",
    focus:
      "A ring of palms is an oasis; a ring of palms with a winch over a hole is a well somebody dug. The half-fallen mud wall was already here and says somebody DID live here — the two standing houses beside it say somebody still does, which is the difference between a landmark and a ruin.",
  },
  {
    id: "night-market", kind: "market", at: MARKET, ahead: 6, dist: 25, yaw: -0.3, hour: 19.9,
    label: "The Night Market — A Kind That Has Never Existed",
    focus:
      "outpost.js's fourth kind, at the coordinate seed 1337 now puts it. BEFORE: sand, because placeOutposts() could only ever make three kinds and this one was unreachable in every campaign ever played. AFTER: two rows of lamp-lit canopies with a lane between them, counters with keepers behind them, and three houses closing the far end. Photographed at 19:54 because the lamps are the whole point of it and any later there is nothing else to see.",
  },
  {
    /* THIS SUBJECT REPLACED A LONG SHOT AT 520 m THAT PHOTOGRAPHED NOTHING.
       The far LOD is a real claim — props.js builds a block silhouette for
       every compound and nothing had ever called lodTick to swap to it — but
       the campaign camera sits behind the player's shoulder, so framing a
       half-kilometre view means aiming over whatever dune happens to be in
       the way, and both columns came back as empty sand with a rider in it.
       Two pictures of sand prove nothing about either side. The LOD is
       reported in the numbers instead, and this slot went to the thing the
       owner actually asked about. */
    id: "the-men", kind: "camp", ahead: 3, dist: 17, yaw: -0.9, hour: 9.4,
    label: "\"With No Man There\" — Close Enough To Count Them",
    focus:
      "Seventeen metres, which is inside every LOD band there is: real rigs, faces on, gait resolved every frame. Each of these men is a W.makeSoldier record dressed by W.outfits at his own tier — the levy at the crates is not the recruiter at the counter — and he stands still because animChar at speed 0 breathes and settles rather than walking on the spot. BEFORE: boxes and a flag, at the same range, with nobody at them.",
  },
];

async function stageOutpost(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.warlord || !CBZ.warlord.campaign) return { ok: false, missing: "warlord" };
  const W = CBZ.warlord, D = W.desert, C = W.campaign;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let X = window.__wlBA;
  if (!X) {
    X = window.__wlBA = {
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      /* NOTHING ELSE MAY BE IN THE PICTURE, and this is what makes the
         headline metric mean anything. `?trail=off` is campaign.js's own
         shipped flag for "draw no followers" and it is set on BOTH columns;
         the bands are then emptied outright. After that every man drawn on
         this island is a man standing at an outpost, so the renderer's own
         count of drawn bodies IS the answer to "is there anybody there",
         with nothing to disentangle and no way for it to be flattered. */
      clear() {
        W.state.bands.length = 0;
        for (let i = 0; i < W.state.outposts.length; i++) W.state.outposts[i].cool = 1;
      },
      /* THE GROUND UNDER A COMPOUND, peak to peak, over the 20 m an outpost
         actually covers. Computed here rather than read off the after side's
         own bookkeeping so both columns answer the same question the same
         way — the before column has never heard of a pad. */
      relief(x, z) {
        let lo = 1e9, hi = -1e9, soaked = 0;
        for (let i = 0; i < 13; i++) {
          const a = i * 2.399963229728653;
          const rr = Math.sqrt((i + 0.35) / 13) * 20;
          const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
          const y = D.heightAt(px, pz);
          if (y < lo) lo = y;
          if (y > hi) hi = y;
          if (!D.onLand(px, pz)) { soaked++; continue; }
          const oa = D.oases || [];
          for (let k = 0; k < oa.length; k++) {
            const o = oa[k], dx = px - o.x, dz = pz - o.z;
            if (dx * dx + dz * dz <= o.r * o.r && y < o.waterY + 0.8) { soaked++; break; }
          }
        }
        return { relief: hi - lo, wet: soaked };
      },
      /* WHAT IS ACTUALLY STANDING AT THE PLACE. Walk the live scene, take
         every VISIBLE mesh whose own bounding sphere is small enough to be an
         object rather than a landscape, and keep the ones inside 60 m of the
         outpost. Counting what is drawn — not what was built — is the point:
         it is the same test that catches a far LOD stuck on, a batch that
         merged the near and far halves together, and a compound that never
         got raised. Character rigs are excluded by walking up their parents,
         because the men have their own metric. */
      structure(x, z) {
        const v = new T.Vector3();
        let objects = 0, tris = 0;
        CBZ.scene.traverse(function (n) {
          if (!n.isMesh || !n.visible || !n.geometry) return;
          for (let p = n; p; p = p.parent) {
            if (!p.visible) return;
            if (p.userData && (p.userData.charRig || p.userData.humanScale)) return;
          }
          if (!n.geometry.boundingSphere) { try { n.geometry.computeBoundingSphere(); } catch (e) { return; } }
          const bs = n.geometry.boundingSphere;
          if (!bs || !isFinite(bs.radius) || bs.radius > 60) return;   // terrain rings, sea, sky
          n.getWorldPosition(v);
          if (Math.hypot(v.x - x, v.z - z) > 60) return;
          objects++;
          const g = n.geometry;
          const cnt = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
          tris += (cnt / 3) * (n.isInstancedMesh ? Math.max(0, n.count) : 1);
        });
        return { objects: objects, tris: tris };
      },
      /* WHAT THE PLACE COSTS, ISOLATED — the only honest way to take a
         draw-call claim, and props.js's own measure() takes it the same way.
         Hide exactly the meshes structure() counts, render, read the
         renderer's counter; unhide, render, read it again. The men are NOT
         hidden: they are not the compound, they cost what a man on this map
         has always cost, and folding them in would let a cheap outpost hide
         behind an expensive rig. Works identically on both columns because
         it selects by POSITION and not by knowing what an outpost is. */
      postDraws(x, z) {
        const R = CBZ.renderer, cam = CBZ.camera, scene = CBZ.scene;
        if (!R || !cam || !scene) return null;
        const v = new T.Vector3();
        const hid = [];
        scene.traverse(function (n) {
          if (!n.isMesh || !n.visible || !n.geometry) return;
          for (let p = n; p; p = p.parent) {
            if (!p.visible) return;
            if (p.userData && (p.userData.charRig || p.userData.humanScale)) return;
          }
          if (!n.geometry.boundingSphere) { try { n.geometry.computeBoundingSphere(); } catch (e) { return; } }
          const bs = n.geometry.boundingSphere;
          if (!bs || !isFinite(bs.radius) || bs.radius > 60) return;
          n.getWorldPosition(v);
          if (Math.hypot(v.x - x, v.z - z) > 60) return;
          hid.push(n);
        });
        for (let i = 0; i < hid.length; i++) hid[i].visible = false;
        R.render(scene, cam);
        const without = R.info.render.calls;
        for (let i = 0; i < hid.length; i++) hid[i].visible = true;
        R.render(scene, cam);
        return R.info.render.calls - without;
      },
      metrics() {
        const m = {};
        const a = C.audit ? C.audit() : {};
        /* EVERY BODY ON THE ISLAND, and with the column off and the bands
           gone there is nowhere for one to come from except an outpost.
           Rigs and impostors are counted together on purpose: which of the
           two a man gets is a distance decision, and "there is a man there"
           must not depend on it. */
        m.menAtPost = (a.drawnMen || 0) + ((a.men && a.men.rigs) || 0);
        m.rigsAtPost = (a.men && a.men.rigs) || 0;
        const s = X.structure(X.lastX, X.lastZ);
        m.postObjects = s.objects;
        m.postTris = Math.round(s.tris / 100) / 10;
        /* AND THE WET COUNT SHIPS BESIDE THE RELIEF BECAUSE THE RELIEF
           ALONE IS GAMEABLE, and it was gamed — by this preset's own code,
           on its own author. An earlier pass scored outposts on flatness and
           the well's ground went 4.50 -> 0.00, a perfect result, because the
           search had walked the compound into the middle of the oasis: a
           pond floor is exactly level. The photograph was a submerged camera
           and palms coming out of a lake. padWet counts how many of the same
           thirteen samples sit below the local waterline — the sea by
           onLand, an oasis by its own waterY — and it has to be zero. A
           metric you cannot fail is not a metric, and a metric whose best
           possible score is a bug is worse than that. */
        const rel = X.relief(X.lastX, X.lastZ);
        m.padReliefM = Math.round(rel.relief * 100) / 100;
        m.padWet = rel.wet;
        m.postDraws = X.postDraws(X.lastX, X.lastZ);
        if (CBZ.renderer && CBZ.renderer.info) {
          m.drawCalls = CBZ.renderer.info.render.calls;
          m.triangles = Math.round(CBZ.renderer.info.render.triangles / 1000);
        }
        return m;
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.renderer && CBZ.camera) {
          try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
        }
        await new Promise((r) => setTimeout(r, 900));
      },
      metrics() { return X.metrics(); },
    };
  }

  for (let t = 0; t < 400 && W.phase() !== "campaign"; t++) await sleep(120);
  if (W.phase() !== "campaign") return { ok: false, missing: "campaign phase (" + W.phase() + ")" };
  X.clear();
  /* DRAIN THE RAISE QUEUE BEFORE READING A SINGLE COORDINATE. campaign.js
     stands one compound up per frame and LEVELS ITS PAD as it does, which
     moves the outpost — by up to 130 m — to find ground a 12 m container row
     can lie on. Stage the camera first and the ground shifts under it: the
     first subject came back captioned "stood at OUTPOST_R" with the compass
     reading 13 m, because the depot had walked 27 m toward the player after
     he was placed. Forty frames is comfortably more than the nine it takes. */
  X.step(40);

  /* WHICH OUTPOST. BY KIND, not by index and not by a typed coordinate — and
     the reason is a bug the after side fixes.

     Outpost placement on the before side draws from the campaign's single
     shared rng stream, so where every outpost stands depends on how many
     times anything else has rolled a die before enter() runs — and the world
     tick runs on the WALL CLOCK in every phase, so that count is a property
     of the machine. Booting origin/main twice on seed 1337 put the first
     depot three kilometres from where it had been. The before side does not
     agree with ITSELF between two runs, so no staging can make the two
     columns stand on the same patch of sand. (The after side gives placement
     its own stream, seeded off S.seed and nothing else, which is what makes
     the campaign replayable and what stops two peers on one seed putting
     their depots in different places.)

     So each column photographs ITS OWN first depot, first camp and first
     well, from the same bearing and the same range, at the same hour. The
     subject is the outpost. The dune behind it is not under test. */
  let px, pz, post = null;
  for (let i = 0; i < W.state.outposts.length && sub.kind; i++) {
    const o = W.state.outposts[i];
    const k = o.kind === "town" ? (o.at ? "well" : "depot") : o.kind;
    if (k === sub.kind) { post = o; break; }
  }
  if (post) { px = post.x; pz = post.z; }
  else if (sub.at) { px = sub.at.x; pz = sub.at.z; }
  else return { ok: false, missing: "no outpost of kind " + sub.kind };
  X.lastX = px; X.lastZ = pz;

  /* THE CAMERA SITS BEHIND HIM ALONG camYaw AND HE STANDS `ahead` SHORT OF
     THE MIDDLE, so the compound is in front of him and the eye is
     ahead + camDist out from its centre. Same arithmetic updateCamera does,
     run backwards.

     AND THE BEARING IS DERIVED, NOT TYPED. The first pass used a fixed world
     bearing per subject and put the depot's camera IN THE SEA — a depot is
     placed on a landing a boat could reach, so one of the four directions
     you can approach it from is water, and a hardcoded compass angle finds
     it about a quarter of the time. So the base bearing is the OUTWARD one,
     from the island's centre through the outpost: the eye then always stands
     on the inland side looking out, which for a depot puts the water behind
     the crates where it belongs, and for everything else is simply the side
     you would have ridden in from. `yaw` is an offset off that, so a subject
     can still choose its angle without being able to choose the sea. */
  const yaw = Math.atan2(px, pz) + sub.yaw;
  W.state.hour = sub.hour;
  W.state.you.x = px - Math.sin(yaw) * sub.ahead;
  W.state.you.z = pz - Math.cos(yaw) * sub.ahead;
  W.state.you.yaw = yaw;
  C.camYaw(yaw); C.camDist(sub.dist);
  X.clear();
  /* Seven clipmap levels rebuild one per frame, the outposts raise one per
     frame, and the rig pool builds one body and dresses four per frame — so
     a teleport next to a compound with nine men in it needs a good many
     frames before what is on screen is what the code says is there. 34 is
     the number the other warlord presets settle on for the ground; this one
     needs more for the people, and 90 is comfortably past the point where
     the counts stop moving. */
  for (let i = 0; i < 3; i++) { X.clear(); X.step(30); }
  C.camYaw(yaw); C.camDist(sub.dist);
  X.step(8);
  X.clear();
  await sleep(250);
  if (CBZ.renderer && CBZ.camera) CBZ.renderer.render(CBZ.scene, CBZ.camera);

  const cam = CBZ.camera;
  const folk = (post && C.folkAt) ? C.folkAt(post) : [];
  return {
    ok: true,
    place: { x: Math.round(px), z: Math.round(pz) },
    kind: post ? post.kind : "(coordinate)",
    name: post ? post.name : null,
    folkAnchors: folk.length,
    camera: { x: Math.round(cam.position.x), y: Math.round(cam.position.y), z: Math.round(cam.position.z) },
    metrics: X.metrics(),
  };
}

export default {
  id: "warlord-outpost",
  title: "Desert Warlord: An Outpost Is A Place With A Person In It",
  description:
    "The BEFORE column is origin/main served from its own worktree; the AFTER column is this one. Same seed, same in-game hour, same camera arithmetic, weather and sound held off on both, the player's column drawn on neither. Before: five untextured boxes and a flag, seated on the analytic ground while being drawn against the rendered one, with nobody at them — and the trading screen opening over that. After: props.js's own depot, camp, well and market (written months ago, never once called), each with a stall, mud-brick houses out of city/villagekit.js, and five to nine people standing in it who go through the same rig pool as every other man on the island.",
  page: "games/warlord.html",
  beforeLabel: "BEFORE · origin/main",
  afterLabel: "AFTER · a place, with people in it",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.desert && CBZ.warlord.desert.heightAt)",
  /* trail=off ON BOTH SIDES. It is campaign.js's own shipped revert for the
     follower column, and with the bands emptied by the stage it is what makes
     "men drawn on this island" a clean reading of "men standing at this
     outpost". sound=off because a headless Chrome does not need forty rifles. */
  urlParams: { go: 1, seed: 1337, weather: "off", sound: "off", trail: "off" },
  stageTimeoutMs: 480000,
  subjects,
  stage: stageOutpost,
  pairNote: "seed 1337 · same hour · same bearing and range from the same outpost · column off and bands cleared on both sides",
  method:
    "Two servers, two checkouts: origin/main on one port and this tree on the other, both booted with ?go=1&seed=1337&weather=off&sound=off&trail=off. The stage empties W.state.bands and pins every outpost's `cool` flag so no encounter and no trading screen can open over a photograph, finds the first outpost of the subject's kind (the first eight come off identical rnd draws on both columns, so it is the same outpost in both), stands the player a fixed distance short of its centre on a fixed world bearing, sets the hour and the camera through the campaign's own public API, and advances CBZ.stepSim for 98 frames — enough for seven clipmap levels, the one-compound-per-frame raise queue and the one-build-four-dresses-per-frame rig pool to all settle. The night market is staged at a hardcoded coordinate instead, because it is placed by a draw that only exists on the after side and asking each column to 'find the market' would photograph two different places.",
  metricsNote:
    "menAtPost is the complaint, as an integer. With the follower column turned off by flag on both sides and the bands emptied by the stage, every body drawn on this island is a body standing at an outpost — so this number is 0 on the before column by construction and cannot be flattered into being anything else. rigsAtPost is how many of them got a real CBZ.studio.cast body rather than an instanced impostor, which is a distance decision and is reported so a close shot claiming men can be checked for whether they are actual rigs. postObjects and postTris walk the live scene and count what is DRAWN within 60 m of the compound, excluding character rigs and anything with a bounding sphere over 60 m (the terrain rings, the sea, the sky) — they measure the place itself, and postTris is what the geometry costs. padReliefM is the peak-to-peak ground under the 20 m the compound covers, computed identically on both sides: it is the 'nothing floats' number, and it goes DOWN because the after side searches a 180 m golden-angle spiral for level ground before it stands anything up. padWet ships beside it because padReliefM ON ITS OWN IS GAMEABLE, and it was gamed — an earlier pass of this work scored outposts on flatness alone and took the well from 4.50 m to a perfect 0.00 by walking the compound into the middle of the oasis, because a pond floor is exactly level. The photograph was a submerged camera. It counts the same thirteen samples against the sea (onLand) and against each oasis's own waterY, and it has to be zero. postDraws is that cost isolated, the only honest way to take a draw-call claim: hide exactly the meshes counted at the place, render, read the counter, unhide, render, read it again — props.js's own measure() takes its number the same way, and the men are deliberately left visible because they are not the compound. drawCalls is the WHOLE frame and has no declared direction; on the close subjects most of its rise is the rigs, which cost about 24 calls each and are what a man on this map has always cost.",
  metrics: {
    menAtPost:  { label: "Men drawn at the outpost", unit: "men", better: "higher" },
    rigsAtPost: { label: "…of those, real dressed rigs", unit: "rigs", better: "higher" },
    postObjects: { label: "Objects drawn at the place", unit: "meshes", better: "higher" },
    postDraws:  { label: "Draw calls the place itself costs", unit: "calls" },
    postTris:   { label: "Triangles standing at the place", unit: "k tris" },
    padReliefM: { label: "Ground relief under the compound", unit: "m peak-to-peak", better: "lower" },
    padWet:     { label: "…of its 13 ground samples, underwater", unit: "samples", better: "lower" },
    drawCalls:  { label: "Draw calls", unit: "calls" },
    triangles:  { label: "Triangles submitted", unit: "k tris" },
  },
};
