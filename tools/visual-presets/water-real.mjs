/* WATER, AS A THING YOU LOOK AT — tools/visual-compare preset.

   OWNER (2026-11-21): "look at water aggressively and different types of boats
   and swimmers in water and make them realer, real wake, real waves ... water
   overall looks fake glisteny ... how different boats and players interact
   with it, water physics, wave sizes".

   Every other water preset asks a narrow question (is the hull a surface, does
   the shark tip the kayak, is the fin under the swell). This one asks the wide
   one: does this read as SEA? So the shots are the ones a person judges water
   by, and nothing else is in them:

     the open sea     toward the sun (the glitter path), away from it (body
                      colour and sky reflection), from a height (the wave
                      field as a pattern), straight down (what the surface is
                      made of)
     hulls under way  a jetski, a speedboat, a cruiser and a kayak, each run on
                      a straight leg at its own cruise speed, photographed from
                      the stern quarter and from above — the wake is the subject
     a hull at rest   the waterline of a skiff lying to the swell
     a swimmer        one of the island's own people in deep water, at eye
                      level and from above
     weather          the same sea under a full gale, with a small hull in it

   Staging: boot ?mode=sharksim at a fixed seed like a player (it is the island
   sea with the real fleet code and the real swimmers), freeze the frame loop,
   park the player's shark far away and deep, and drive everything with
   CBZ.stepSim. Hulls are CBZ.seaCraft.spawn() on a route, i.e. production
   code; no mesh is posed. Positions come from the island and fixed bearings,
   so two builds photograph the same place at the same sim time.

   RUN (before = HEAD worktree on its own port, after = this checkout):
     ba --preset water-real --before http://127.0.0.1:<port>/ */

const subjects = [
  { id: "sea-toward-sun", ch: 0, label: "Open sea, toward the sun",
    focus: "Eye 1.7 m over the water looking into the light. Real water here is a narrow path of small hard sparkles broken by the waves, on a surface that brightens to the sky's colour at the horizon. Broad white blobs or a flat painted colour are the fakes." },
  { id: "sea-off-sun", ch: 1, label: "Open sea, away from the sun",
    focus: "Same height, light behind the camera. This is the body colour: dark near the eye where you look into the water, paling to reflected sky toward the horizon, with the wave shapes readable as light and dark faces." },
  { id: "sea-from-height", ch: 2, label: "The wave field from 45 m",
    focus: "From a rooftop or a low aircraft: swell lines with wind chop across them, in more than one size. A repeating tile or an even stipple gives the game away from here." },
  { id: "sea-straight-down", ch: 3, label: "Straight down from 14 m",
    focus: "What the surface is made of at arm's length: small ripples riding larger waves, and the water's depth colour under it." },
  { id: "jetski-chase", ch: 4, label: "Jetski at speed, from astern",
    focus: "A planing PWC: a rooster tail and a narrow, bright, aerated wake straight behind, two diverging lines off the stern, and the hull riding high and slapping over the chop." },
  { id: "jetski-above", ch: 5, label: "Jetski at speed, from above",
    focus: "The wake as a shape on the water: a V of diverging waves with a white churned core that fades to a smooth track behind." },
  { id: "jetski-side", ch: 0, strip: { frames: 4, stepSec: 0.22 }, label: "Jetski at speed, side on, four frames",
    focus: "Four frames 0.22 s apart, camera level with the water. A light hull at 15 m/s over chop does not glide: it skips, the bow lifts and slaps down, daylight shows under the hull between waves, spray flies at each landing." },
  { id: "speedboat-side", ch: 6, label: "Speedboat under way, from abeam",
    focus: "A 6 m runabout on the plane: bow up, spray thrown out and down from the chine a third of the way back, white water along the side and a trough behind the transom." },
  { id: "speedboat-above", ch: 7, label: "Speedboat under way, from above",
    focus: "The Kelvin wake: bow waves spreading at about 19 degrees a side, transverse waves between them, and a long fading foam track." },
  { id: "cruiser-quarter", ch: 8, label: "Cruiser under way, stern quarter",
    focus: "A heavy displacement hull: a real bow wave it pushes ahead and to the sides, a hollow along the midships, a rolling stern wave, and a broad wake. It should ignore the small chop that throws the jetski about." },
  { id: "kayak-close", ch: 9, label: "Kayak, close",
    focus: "Paddle speed: almost no wake, small rings where the blade went in, the hull rising and falling with every wave." },
  { id: "skiff-at-rest", ch: 10, label: "A skiff lying to the swell",
    focus: "The waterline of a boat that is not moving: the water meets the hull in a clean line that rises and falls, the hull rolls and pitches with the waves passing under it." },
  { id: "swimmer-eye", ch: 11, label: "A swimmer, at eye level",
    focus: "A person swimming in deep water seen from another swimmer's height: head and shoulders out, the rest under, a small bow ripple and disturbed water around the arms, lifted and dropped by the swell." },
  { id: "swimmer-above", ch: 12, label: "A swimmer, from above",
    focus: "The body visible through the water, rings and a short trail of disturbed water behind." },
  { id: "gale-sea", ch: 13, label: "The same sea in a gale",
    focus: "Full wind and rain. Bigger, steeper waves, whitecaps where crests break, streaks of foam down the wind, a grey sea under a grey sky." },
  { id: "gale-skiff", ch: 14, label: "A small boat in the gale",
    focus: "The skiff in those waves: it climbs faces, drops into troughs, rolls hard, takes spray. Wave size against hull size is the whole picture." },
  { id: "gale-jetski", ch: 0, strip: { frames: 5, stepSec: 0.3 }, label: "A jetski flat out in the gale, five frames",
    focus: "Five frames 0.3 s apart. In waves this size at this speed the hull launches off crests, flies, and lands hard in the trough: pitch swings through tens of degrees, the rider is thrown about, white water explodes at each landing." },
  { id: "gale-cruiser", ch: 0, strip: { frames: 3, stepSec: 0.8 }, label: "The cruiser in the same gale, three frames",
    focus: "The 12 m hull in the same sea at 7 m/s: slow heavy pitching, the bow burying and throwing spray, a steady roll. It answers the big waves and ignores the small ones." },
];
// chapters run in list order
subjects.forEach((s, i) => { s.ch = i; });

async function stage(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__waterReal;
  if (!D) {
    D = window.__waterReal = {
      chapter: -1, m: {}, craft: {}, follow: null,
      step(n) {
        for (let i = 0; i < n; i++) {
          // a paused match runs none of its updaters (CBZ.stepSim gates on state)
          if (CBZ.game.state !== "playing") CBZ.game.state = "playing";
          // the wake field is simulated in a box round the CAMERA: keep the lens
          // on the subject while time runs, not only when the shutter opens
          if (D.follow) D.follow();
          CBZ.stepSim(1 / 30);
        }
      },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        let seed = 0x9e3779b9 >>> 0;
        Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        for (let t = 0; t < 80 && !D.armed(); t++) { D.step(10); await sleep(20); }
        if (!D.armed()) return false;
        D._raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => D._raf.call(window, () => res()));
        return true;
      },
      A() { return CBZ.surv.arena; },
      wl() { return CBZ.sharkSim.waterline; },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.48; },
      ring(a, r) { const A = D.A(); return { x: A.center.x + Math.cos(a) * r, z: A.center.z + Math.sin(a) * r }; },
      // the bearing (from the island) the sun stands on
      sunAz() {
        const s = CBZ.sun, t = CBZ.sunTarget;
        if (!s) return 0;
        const dx = s.position.x - (t ? t.position.x : 0), dz = s.position.z - (t ? t.position.z : 0);
        return Math.atan2(dz, dx);
      },
      tripod(px, py, pz, tx, ty, tz, fov) {
        const cam = CBZ.camera; if (!cam) return;
        if (fov && cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
        cam.position.set(px, py, pz); cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      // every biter and the pod parked far away: these are pictures of water
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species || (CBZ.sharkSim && a === CBZ.sharkSim.shark)) continue;
          if (a.species.aquatic && (+a.species.danger >= 0.5)) {
            a.pos.x += 1500; a.hunger = 0;
            if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          }
        }
        if (CBZ.sharkSim) CBZ.sharkSim.podT = 6000;
      },
      parkShark() {
        const a = CBZ.sharkSim.shark; if (!a) return;
        const p = D.ring(D.base + Math.PI, D.wl() + 420);
        a.pos.x = p.x; a.pos.z = p.z; a.pos.y = D.seaY(p.x, p.z) - 9;
        if (a._waterMove) { a._waterMove.x = p.x; a._waterMove.z = p.z; a._waterMove.v = 0; }
        if (a.group) { a.group.position.set(a.pos.x, a.pos.y, a.pos.z); a.group.updateMatrixWorld(true); }
      },
      // the match's own fleet moved out of frame so each shot has one subject
      clearFleet() {
        if (!CBZ.seaCraft) return;
        const keep = Object.keys(D.craft).map((k) => D.craft[k]);
        for (const c of CBZ.seaCraft.list().slice()) {
          if (keep.indexOf(c) >= 0) continue;
          try { CBZ.seaCraft.despawn(c); } catch (e) {}
        }
      },
      /* One hull on a straight leg: spawned `off` metres out from the waterline
         on bearing `a`, heading along the shore, routed to a mark 900 m ahead
         so it never turns during the shot. */
      run(key, a, off, speed, crew) {
        if (!CBZ.seaCraft) return null;
        const p = D.ring(a, D.wl() + off);
        // +Z is the bow; heading h points the bow along (sin h, cos h)
        const tx = -Math.sin(a), tz = Math.cos(a);
        const h = Math.atan2(tx, tz);
        const rec = CBZ.seaCraft.spawn(key, p.x, p.z, h, {
          crew: crew == null ? 1 : crew, speed: speed,
          route: [{ x: p.x + tx * 900, z: p.z + tz * 900 }, { x: p.x + tx * 1800, z: p.z + tz * 1800 }],
        });
        return rec;
      },
      // camera in the hull's own frame: aft (+ = behind), side (+ = starboard), up
      chase(rec, aft, side, up, lookAhead, lookUp, fov) {
        const h = rec.heading, fx = Math.sin(h), fz = Math.cos(h), sx = fz, sz = -fx;
        const px = rec.pos.x - fx * aft + sx * side, pz = rec.pos.z - fz * aft + sz * side;
        const tx = rec.pos.x + fx * lookAhead, tz = rec.pos.z + fz * lookAhead;
        const y0 = D.seaY(rec.pos.x, rec.pos.z);
        // the lens stays in the air: in a big sea the water at the tripod can
        // stand metres above the water at the hull
        const yc = Math.max(y0 + up, D.seaY(px, pz) + Math.min(up, 0.9));
        D.tripod(px, yc, pz, tx, y0 + lookUp, tz, fov || 55);
      },
      /* People are drawn at full detail by distance to the PLAYER, and the
         player is the shark. Park it 30 m behind the camera and 9 m down: out
         of frame, deep enough that nobody aboard reacts to it. */
      nearPlayer(sx, sz) {
        const cam = CBZ.camera.position;
        let dx = cam.x - sx, dz = cam.z - sz; const l = Math.hypot(dx, dz) || 1;
        const px = cam.x + dx / l * 30, pz = cam.z + dz / l * 30, y = D.seaY(px, pz) - 9;
        const P = CBZ.player, a = CBZ.sharkSim.shark;
        if (P && P.pos) { P.pos.x = px; P.pos.z = pz; P.pos.y = y; }
        if (a) {
          a.pos.x = px; a.pos.z = pz; a.pos.y = y;
          if (a._waterMove) { a._waterMove.x = px; a._waterMove.z = pz; a._waterMove.v = 0; }
          if (a.group) { a.group.position.set(px, y, pz); a.group.updateMatrixWorld(true); }
        }
        D.sec(0.3);
      },
      num(rec) {
        return { key: rec.key, speed: +Math.abs(rec.v || 0).toFixed(1),
                 pitch: +((rec._pitchNow || 0) * 57.3).toFixed(1), roll: +((rec._rollNow || 0) * 57.3).toFixed(1),
                 y: +(rec.group.position.y - D.seaY(rec.pos.x, rec.pos.z)).toFixed(2) };
      },
      bedY(x, z) { return CBZ.surv.arena.heightAt ? CBZ.surv.arena.heightAt(x, z) : -3; },
      swimmer(a, off) {
        const bots = (CBZ.bots || []).filter((b) => b && !b.dead && !b._aboard);
        const b = bots[0]; if (!b) return null;
        const p = D.ring(a, D.wl() + off), q = D.ring(a + 0.18, D.wl() + off);
        b.pos.x = p.x; b.pos.z = p.z; b.pos.y = D.seaY(p.x, p.z) - 1.2;
        b.hp = 100; b.state = "wander"; b.pause = 0; b.panicT = 0; b._drive = null;
        if (b.target && b.target.set) b.target.set(q.x, 0, q.z);
        return b;
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        // pictures of water: every DOM overlay (title card, hints, toasts) off
        const canvas = CBZ.renderer && CBZ.renderer.domElement;
        for (const child of Array.from(document.body.children)) {
          if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
          child.style.visibility = "hidden";
        }
        if (window.CBZ && CBZ.skySync) CBZ.skySync();
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        await new Promise((res) => D._raf.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
        await new Promise((r) => setTimeout(r, 700));
      },
      advance(sec) { D.sec(sec); if (D.follow) D.follow(); },
    };
  }

  const CH = [
    async function towardSun() {
      if (!await D.boot()) throw new Error("shark sim never armed");
      D.base = D.sunAz();
      D.peace(); D.parkShark(); D.clearFleet();
      D.sec(6);
      const e = D.ring(D.base, D.wl() + 140), t = D.ring(D.base, D.wl() + 500);
      D.tripod(e.x, D.seaY(e.x, e.z) + 1.7, e.z, t.x, D.seaY(e.x, e.z) + 6, t.z, 58);
      D.m = { amp: +(CBZ.waterAmpAt ? CBZ.waterAmpAt(e.x, e.z) : 0).toFixed(2) };
    },
    async function offSun() {
      const a = D.base + Math.PI;
      const e = D.ring(a, D.wl() + 140), t = D.ring(a, D.wl() + 500);
      // the shark was parked on this side; move it round the island
      const s = CBZ.sharkSim.shark, p = D.ring(D.base + Math.PI / 2, D.wl() + 420);
      if (s) { s.pos.x = p.x; s.pos.z = p.z; if (s._waterMove) { s._waterMove.x = p.x; s._waterMove.z = p.z; } }
      D.sec(1);
      D.tripod(e.x, D.seaY(e.x, e.z) + 1.7, e.z, t.x, D.seaY(e.x, e.z) + 6, t.z, 58);
    },
    async function height() {
      const a = D.base + 0.9;
      const e = D.ring(a, D.wl() + 40), t = D.ring(a, D.wl() + 260);
      D.tripod(e.x, 45, e.z, t.x, 0, t.z, 55);
    },
    async function down() {
      const a = D.base + 0.9;
      const e = D.ring(a, D.wl() + 160);
      D.tripod(e.x, D.seaY(e.x, e.z) + 14, e.z, e.x + 0.6, D.seaY(e.x, e.z), e.z + 3.5, 55);
    },
    async function jetskiChase() {
      const rec = D.craft.jetski = D.run("jetski", D.base + 0.5, 150, 15, 1);
      if (!rec) throw new Error("no jetski");
      D.follow = () => D.chase(rec, 11, 3.2, 2.6, 6, 0.4, 58);
      D.sec(9);
      D.follow(); D.nearPlayer(rec.pos.x, rec.pos.z); D.follow();
      D.m = D.num(rec);
    },
    async function jetskiAbove() {
      const rec = D.craft.jetski;
      D.follow = () => D.chase(rec, 22, 4, 26, -14, 0, 55);
      D.sec(1.5);
      D.follow(); D.nearPlayer(rec.pos.x, rec.pos.z); D.follow();
      D.m = D.num(rec);
    },
    async function jetskiSide() {
      const rec = D.craft.jetski;
      D.follow = () => D.chase(rec, 0, 8.5, 0.9, 0, 0.5, 46);
      D.sec(1.0);
      D.follow();
      D.m = D.num(rec);
    },
    async function boatSide() {
      if (D.craft.jetski) { try { CBZ.seaCraft.despawn(D.craft.jetski); } catch (e) {} }
      const rec = D.craft.boat = D.run("boat", D.base + 0.5, 170, 13, 2);
      if (!rec) throw new Error("no speedboat");
      D.follow = () => D.chase(rec, -1.5, 13, 1.5, -1.5, 0.5, 52);
      D.sec(11);
      D.follow(); D.nearPlayer(rec.pos.x, rec.pos.z); D.follow();
      D.m = D.num(rec);
    },
    async function boatAbove() {
      const rec = D.craft.boat;
      D.follow = () => D.chase(rec, 38, 6, 44, -26, 0, 55);
      D.sec(1.5);
      D.follow(); D.nearPlayer(rec.pos.x, rec.pos.z); D.follow();
      D.m = D.num(rec);
    },
    async function cruiser() {
      if (D.craft.boat) { try { CBZ.seaCraft.despawn(D.craft.boat); } catch (e) {} }
      const rec = D.craft.cruiser = D.run("cruiser", D.base + 0.5, 210, 7.5, 2);
      if (!rec) throw new Error("no cruiser");
      D.follow = () => D.chase(rec, 30, 17, 9, -6, 0.5, 55);
      D.sec(16);
      D.follow(); D.nearPlayer(rec.pos.x, rec.pos.z); D.follow();
      D.m = D.num(rec);
    },
    async function kayak() {
      if (D.craft.cruiser) { try { CBZ.seaCraft.despawn(D.craft.cruiser); } catch (e) {} }
      const rec = D.craft.kayak = D.run("kayak", D.base + 0.5, 120, 1.8, 1);
      if (!rec) throw new Error("no kayak");
      D.follow = () => D.chase(rec, 3.5, 5.5, 1.3, 0.5, 0.2, 52);
      D.sec(8);
      D.follow(); D.nearPlayer(rec.pos.x, rec.pos.z); D.follow();
      D.m = D.num(rec);
    },
    async function skiffRest() {
      if (D.craft.kayak) { try { CBZ.seaCraft.despawn(D.craft.kayak); } catch (e) {} }
      const p = D.ring(D.base + 0.5, D.wl() + 150);
      const rec = D.craft.skiff = CBZ.seaCraft.spawn("skiff", p.x, p.z, D.base, { crew: 1, anchored: true });
      if (!rec) throw new Error("no skiff");
      D.follow = () => D.chase(rec, 1, 7.5, 1.2, 0, 0.3, 50);
      D.sec(5);
      D.follow(); D.nearPlayer(rec.pos.x, rec.pos.z); D.follow();
      D.m = D.num(rec);
    },
    async function swimmerEye() {
      const b = D.swim = D.swimmer(D.base + 1.6, 120);
      if (!b) throw new Error("no survivor to swim");
      D.sec(5);
      D.follow = () => {
        const y = D.seaY(b.pos.x, b.pos.z);
        D.tripod(b.pos.x + 3.6, y + 0.55, b.pos.z + 2.4, b.pos.x, y + 0.1, b.pos.z, 50);
      };
      D.follow(); D.nearPlayer(b.pos.x, b.pos.z); D.follow();
      D.m = { swimming: !!(b.swim || (b.char && b.char.swimming)), depth: +(D.seaY(b.pos.x, b.pos.z) - D.bedY(b.pos.x, b.pos.z)).toFixed(1) };
    },
    async function swimmerAbove() {
      const b = D.swim;
      D.sec(1.5);
      D.follow = () => {
        const y = D.seaY(b.pos.x, b.pos.z);
        D.tripod(b.pos.x + 1.5, y + 9, b.pos.z + 3.5, b.pos.x, y, b.pos.z, 50);
      };
      D.follow();
    },
    async function gale() {
      D.follow = null;
      if (CBZ.weatherDrive) CBZ.weatherDrive({ rain: 1, wind: 24 }, 900);
      D.sec(40);
      const a = D.base + 0.9;
      const e = D.ring(a, D.wl() + 140), t = D.ring(a, D.wl() + 500);
      D.tripod(e.x, D.seaY(e.x, e.z) + 2.4, e.z, t.x, D.seaY(e.x, e.z) + 5, t.z, 58);
      D.m = { amp: +(CBZ.waterAmpAt ? CBZ.waterAmpAt(e.x, e.z) : 0).toFixed(2),
              wet: +((CBZ.weather && CBZ.weather.intensity) || 0).toFixed(2) };
    },
    async function galeSkiff() {
      const rec = D.craft.skiff;
      if (!rec) throw new Error("no skiff");
      D.follow = () => D.chase(rec, 2, 10, 1.6, 0, 0.4, 52);
      D.sec(2);
      D.follow(); D.nearPlayer(rec.pos.x, rec.pos.z); D.follow();
      D.m = D.num(rec);
    },
    async function galeJetski() {
      const rec = D.craft.galeJetski = D.run("jetski", D.base + 2.4, 170, 15, 1);
      if (!rec) throw new Error("no jetski");
      D.follow = () => D.chase(rec, 1, 10, 1.3, 1, 0.8, 50);
      D.sec(8);
      D.follow(); D.nearPlayer(rec.pos.x, rec.pos.z); D.follow();
      D.m = D.num(rec);
    },
    async function galeCruiser() {
      if (D.craft.galeJetski) { try { CBZ.seaCraft.despawn(D.craft.galeJetski); } catch (e) {} }
      const rec = D.craft.galeCruiser = D.run("cruiser", D.base + 2.4, 220, 7.5, 2);
      if (!rec) throw new Error("no cruiser");
      D.follow = () => D.chase(rec, -4, 26, 3.0, 0, 1.5, 50);
      D.sec(14);
      D.follow(); D.nearPlayer(rec.pos.x, rec.pos.z); D.follow();
      D.m = D.num(rec);
    },
  ];
  const want = sub.ch | 0;
  while (D.chapter < want) { D.chapter++; await CH[D.chapter](); if (D.clearFleet) D.clearFleet(); }
  return { ok: true, state: JSON.stringify(D.m), metrics: D.m };
}

export default {
  id: "water-real",
  title: "Water: the sea, hulls under way, a swimmer, a gale",
  description: "The pictures a person judges water by: the open sea into and out of the light, the wave field from above, four hulls on a straight leg with their wakes, a boat at rest, a swimmer, and the same sea in a gale.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same sim time · same camera",
  method: "Both sides boot ?mode=sharksim at seed 90210, freeze the frame loop, park the player's shark and the biters far away, clear the match fleet, then spawn one hull at a time with CBZ.seaCraft.spawn on a straight route and step the real sim before each frame.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 420000,
  metrics: {
    speed: { label: "Hull speed, m/s" },
    pitch: { label: "Hull pitch, degrees" },
    roll: { label: "Hull roll, degrees" },
    y: { label: "Hull origin above the local sea, m" },
    amp: { label: "Wave amplitude scale at the camera" },
  },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage,
};
