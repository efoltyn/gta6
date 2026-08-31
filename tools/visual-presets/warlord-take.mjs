/* DESERT WARLORD — THE RIFLE ON THE SAND, AND WHETHER YOU CAN HAVE IT.

   OWNER, verbatim: "when u kill in battle guns already drops nicely add e to
   pickup or to switch guns each guy carries one and for touch a button to
   switch guns mid battle to whatever is on the ground in front of you."

   THE HARD PART OF PHOTOGRAPHING THIS is that the BEFORE side already looks
   right. battle.js has dropped a dead man's actual rifle into the world since
   the day it shipped — CBZ.weaponPhysics bounces it, settles it on its own
   lowest vertex, and it lies there on the dune looking exactly like a thing
   you could pick up. It was pushed onto a list called `dropGuns` that nothing
   ever read. So the before frames are not "no guns"; they are the same guns,
   inert, with a warlord standing on top of one holding his pistol.

   WHICH IS WHY THE FLAG IS ?take=off AND NOT A DEPLOY. Both sides are this
   checkout, same seed, same rosters, same sand, same frozen clock and the same
   simulated seconds — the only difference is battle.js's one-line revert of
   the reach. Every pixel of difference is the prompt, the phone button, and
   the gun that changed hands.

   THE STORYBOARD IS THE MECHANIC, in order:
     the-floor    rifles on the ground after the first exchange. Identical on
                  both sides BY CONSTRUCTION — if these two frames differ, the
                  A/B is not controlled and nothing after it means anything.
     in-reach     the warlord standing over one. AFTER has the prompt under
                  the reticle naming the gun; BEFORE has nothing to say.
     took-it      one press later. The readout in the corner is fpsmode's own,
                  so it is the game saying what he is holding, not the preset.
     THE SEATS ARE CHOSEN, NOT DEFAULTED. `in-reach` is the OVER-SHOULDER seat
   because the subject of that frame is a man and the thing at his feet, and
   first person at 2 m from a rifle on the ground is a picture of sand with a
   reticle on it — the lens is inside the answer. `took-it` is first person
   because the subject there is what he is HOLDING, and the viewmodel is the
   only thing in this game that can show that.

   the-thumb    the same moment on a phone, where the whole feature is a
                  contextual button that is not there until there is something
                  to take — and the prompt spells the VERB rather than a key,
                  which is this repo's own touch doctrine.

   THE NUMBERS say whether it is a mechanic; the pictures say whether it is
   legible. `held` is the id fpsmode reports the warlord carrying, which is the
   only honest answer to "did the swap happen" — W.state saying so is half a
   swap. `strippedDead` is the double-count guard: the aftermath cart is built
   off every dead man's own wid, so a rifle taken mid-fight has to be struck
   off the body it came from. */

const subjects = [
  { id: "the-floor", label: "Rifles on the ground",
    at: 30, cam: { mode: "cmd", pitch: 0.30, yaw: 1.55 },
    focus: "THE CONTROL FRAME. Both builds have dropped the dead men's actual rifles into the world here — same physics, same settle, same sand. If these two frames are not the same picture the comparison is broken. What the before side does not have is any way to touch one." },
  { id: "in-reach", label: "Standing over one",
    stand: true, cam: { mode: "third" },
    focus: "THE REACH. AFTER: a pill under the reticle naming the gun at his feet — TAKE .50 DESERT EAGLE, off the mesh's own userData.weaponId, so it cannot name a gun that is not there. BEFORE: the same rifle, the same boot standing on it, and no prompt, because nothing in the game ever read that list." },
  { id: "took-it", label: "One press later",
    stand: true, take: true, cam: { mode: "fps" },
    focus: "THE SWAP. He rode in with a pistol (?gun=sidearm) and the corner readout is fpsmode's own — the game saying what is in his hands, not this preset. His old sidearm is in the cart, not on the sand: core's W.equip is a swap, so you cannot lose a better gun to a corpse pile you will never find again. On the before side the counter never moves." },
  { id: "the-thumb", label: "The phone button",
    stand: true, cam: { mode: "fps" }, phone: true,
    focus: "THE SAME FEATURE WITH A THUMB. The reach button sits under SWAP in the right column because they are the same verb from the player's side, and it is the only CONTEXTUAL control in the cluster — hidden until there is something at your feet, so the thumb column does not carry a button that does nothing for most of a fight. It carries no handler of its own: it synthesises KeyE into microboot's input, the exact map the keyboard writes into, so the phone and the desk are one code path." },
];

async function stage(input) {
  const CBZ = window.CBZ;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budget, step) => {
    const end = Date.now() + budget;
    while (Date.now() < end) { try { if (test()) return true; } catch (e) {} await wait(step || 200); }
    return false;
  };
  let S = window.__warlordTakeStudio;
  if (!S) {
    const up = await until(() => window.__warlordBattle && window.__warlordBattle.live &&
      window.__warlordBattle.live(), 300000);
    if (!up) return { ok: false, err: "battle never started" };
    const B = window.__warlordBattle;
    B.freeze();
    S = window.__warlordTakeStudio = { B: B, t: 0, last: null, took: false };
    window.__cbzVisualCompare = {
      render() { try { S.B.render(); } catch (e) {} },
      advance(sec) { try { S.B.advance(sec); S.t += sec; } catch (e) {} },
      metrics() { return S.last || {}; },
    };
  }
  const B = S.B, W = CBZ.warlord, sub = input.subject;

  /* SOW THE FLOOR ONCE. Subjects run in declaration order in one page, so the
     rifles are the same rifles across the whole storyboard. */
  if (sub.at && S.t < sub.at) { B.advance(sub.at - S.t); S.t = sub.at; }

  /* AND STAND HIM ON ONE. gunplay's place() is the seam every warlord preset
     drives him through; the reach test is battle.js's own. The gun is picked
     by lowest index rather than nearest so both builds choose the SAME rifle
     — "nearest" would be a different one on each side the moment a body falls
     a metre differently. */
  /* THE SEAT IS TAKEN BEFORE THE STEP, NOT AFTER. stepPickup() refuses to
     reach from the command seat — you are sixty metres up and the warlord's
     body is standing still wherever you left it — so a stage that placed him,
     stepped the sim and THEN sat down photographed a man in reach of nothing.
     Two of the four before/after pairs failed exactly that way. */
  const cam0 = sub.cam || { mode: "cmd" };
  B.camera(cam0.mode);

  let target = null;
  if (sub.stand) {
    const floor = B.floorGuns().filter(function (g) { return g.settled; });
    target = floor[0] || null;
    if (target && W.gunplay && W.gunplay.place) {
      /* STAND A PACE OFF IT, NOT ON IT. Placed exactly on the gun, the camera
         is directly above a 1.1 m rifle and the frame is empty sand with a
         reticle on it — a picture of the prompt and nothing the prompt is
         about. 2.1 m is inside the 2.6 m reach and far enough that the rifle
         is in the shot he is being asked about. */
      W.gunplay.place({ x: target.x + 1.5, z: target.z + 1.5 });
      B.advance(0.02); S.t += 0.02;
    }
  }
  if (sub.take && !S.took) {
    B.press("KeyE", true); B.advance(0.05);
    B.press("KeyE", false); B.advance(0.05);
    S.t += 0.1; S.took = true;
  }

  const cam = cam0;
  if (cam.mode === "cmd") B.look({ pitch: cam.pitch, yaw: cam.yaw });
  else if (target && W.gunplay && W.gunplay.look) {
    // look DOWN at the rifle itself — the prompt is about a thing on the sand
    // and a frame of horizon does not show it
    W.gunplay.look({ at: { x: target.x, y: target.y + 0.15, z: target.z } });
  }
  B.render();

  const a = B.audit() || {};
  const sp = B.spoilPeek ? B.spoilPeek() : {};
  const gp = (W.gunplay && W.gunplay.audit) ? W.gunplay.audit() : {};
  S.last = {
    floorGuns: (a.floor && a.floor.guns) || 0,
    inReach: (a.floor && a.floor.reach) ? 1 : 0,
    promptChars: ((a.floor && a.floor.label) || "").length,
    /* THE BUTTON'S OWN ELEMENT, by id — microboot only ever put the id on the
       returned handle, so this metric read `null` on every frame of the first
       run and reported a feature that was on screen as absent. */
    thumbButton: (function () {
      const e = document.getElementById("wgpPick");
      return e && e.style.display !== "none" ? 1 : 0;
    })(),
    taken: (a.floor && a.floor.taken) || 0,
    strippedDead: sp.strippedDead || 0,
    reserve: gp.reserve == null ? 0 : gp.reserve,
    yourDead: a.mine ? a.mine.dead : 0,
    enemyDead: a.them ? a.them.dead : 0,
  };
  return { ok: true, held: gp.gun || null, wid: W.state.you.wid,
           label: (a.floor && a.floor.label) || "", metrics: S.last };
}

export default {
  id: "warlord-take",
  title: "Desert Warlord: The Rifle on the Sand",
  description:
    "battle.js has dropped every dead man's ACTUAL rifle into the world since it shipped — physics, settle and all — onto a " +
    "list nothing ever read. This is the reach. Both sides are this checkout on the same seed with the same men on the same " +
    "sand and the same frozen clock; the before side boots ?take=off, the one-line revert. The warlord rides in with a pistol " +
    "on purpose: the gun he ends up holding is one he could only have got off the ground.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { take: "off" },
  beforeLabel: "BEFORE · ?take=off (the guns lie there)",
  afterLabel: "AFTER · TAKE IT",
  viewport: { width: 1180, height: 700 },
  urlParams: { battle: 1, frozen: 1, mine: 14, them: 30, seed: 1337, gun: "sidearm",
    faction: "militia", myfaction: "legion", weather: "off", sound: "off" },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  stageTimeoutMs: 600000,
  frameList: ["laptop", "iphone-16:portrait"],
  pairNote: "Same checkout · seed · rosters · ground · simulated seconds — ?take=off is the only variable",
  method:
    "games/warlord.html boots ?battle=1&frozen=1, battle.js's own debug entry with its clock stopped from birth, so both " +
    "builds walk the identical simulated seconds through advance(). The floor is sown by running the fight 30 s; the warlord " +
    "is stood on a rifle through W.gunplay.place (the same seam every warlord preset drives him with); and the press goes " +
    "through micro.touch.synth('KeyE') — the input map the PHONE BUTTON writes into, so the capture exercises the touch path " +
    "and the keyboard path with one call.",
  metricsNote:
    "held/`wid` are read from two different systems on purpose: W.state.you.wid is the campaign's answer and gunplay's audit " +
    "reports what fpsmode is actually holding, and a swap that only half happens shows up as those two disagreeing. " +
    "strippedDead counts dead men whose wid is now 'fists' — the aftermath cart is built off those rows, so a rifle taken " +
    "mid-fight has to be struck off the body or the same AK is handed to you twice.",
  metrics: {
    floorGuns: { label: "Rifles lying on the sand", unit: "guns" },
    inReach: { label: "A rifle within arm's reach", unit: "0/1", better: "higher" },
    promptChars: { label: "Reach prompt on screen", unit: "chars", better: "higher" },
    thumbButton: { label: "Contextual touch button shown", unit: "0/1", better: "higher" },
    taken: { label: "Rifles taken off the sand", unit: "guns", better: "higher" },
    strippedDead: { label: "Bodies the aftermath will not double-count", unit: "men", better: "higher" },
    /* NO `better` ON THIS ONE, and that is the point of it. A Desert Eagle
       carries fewer rounds than a 9mm and the first run flagged 43 → 25 as a
       regression in four frames — it is not a regression, it is a different
       gun, which is the whole mechanic. It stays because a reserve of ZERO
       would mean the pickup handed him something he cannot fire. */
    reserve: { label: "Reserve rounds for the gun in hand", unit: "rounds" },
    yourDead: { label: "Your dead", unit: "men" },
    enemyDead: { label: "Enemy dead", unit: "men" },
  },
  subjects,
  stage: stage,
};
