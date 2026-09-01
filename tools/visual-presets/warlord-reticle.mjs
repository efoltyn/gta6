/* THE WARLORD'S CROSSHAIR, AND THE NODE IT WAS BEING PAINTED ONTO.

   THE REPORT (owner, 2026-09-01): "warlord during a battle should have a
   crosshair ... failing at the req lol."

   IT IS NOT A PREDICATE, IT IS A STALE POINTER. Every condition the reticle
   asks about is true in a warlord battle: warlord/battle.js awaits gunplay,
   mounts systems/fpsmode.js, sets the fps seat, and warlord/gunplay.js shims
   CBZ.hasWeapon off the warlord's own carried gun, so `armed()`,
   `shoulderActive()` and `fps.active` all answer yes. The reticle still does
   not appear, because fpsmode resolved the element ONCE:

       const cross = document.getElementById("crosshair");   // at module load

   which is true exactly as long as nobody replaces the element. warlord builds
   its own #wgpHud wrapper (games/warlord.html has no #crosshair of its own and
   does not link css/hud.css), and its unmount() REMOVES that wrapper at the end
   of every battle. The next battle's mount() builds a brand-new one. fpsmode
   goes on styling the detached node: display:"block" lands on an orphan,
   `_crossShown` is updated to say it worked, and the player fights the rest of
   the campaign with no reticle. #ammo goes the same way, and so does
   #hitMarker, which is inserted relative to #crosshair.

   A DETACHED NODE ANSWERS EVERY PROPERTY YOU ASK IT, which is why this failed
   silently for a whole battle instead of throwing once. `isConnected` is the
   cheap question that catches it — one property read per frame in the common
   case and a re-query only after somebody swapped the DOM out.

   WHAT THIS PRESET STAGES. The bug does not show on the FIRST battle of a
   session — that is the control below, and it must look identical on both
   sides. The second battle is the one that breaks, so this beat performs the
   two DOM operations gunplay itself performs between battles (remove #wgpHud;
   rebuild it with gunplay's own innerHTML, byte for byte from
   gunplay.js:254-260) rather than running a whole second campaign fight, and
   then asks the page for a frame. Everything else — the battle, the seat, the
   gun, the men — is the game's own.

     ba warlord-reticle
*/

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const subjects = [
  {
    id: "battle-first", ch: 0,
    label: "The First Battle — The Control",
    focus: "The reticle as the first fight of a session has it, and it works: gunplay builds #wgpHud BEFORE fpsmode.js is fetched, so the element fpsmode caches at module load is the live one. BEFORE and AFTER must be the SAME picture here. If this pair moves, the fix has changed something it had no business touching.",
  },
  {
    id: "battle-again", ch: 1,
    label: "The Next Battle — The One You Actually Play",
    focus: "The same fight, after the two DOM operations gunplay performs between battles: unmount() removes the #wgpHud wrapper containing #crosshair and #ammo, and the next mount() builds a fresh one. BEFORE: fpsmode is still holding the node that was thrown away, so it sets display:block on an orphan and the screen has no reticle and no ammo readout for the rest of the campaign — with the internal cache now believing it succeeded, so nothing ever retries. AFTER: the lookup notices its node left the document and re-resolves, and the sight is back where the player is aiming.",
  },
];

async function stageWarlordReticle(input) {
  const CBZ = window.CBZ, sub = input.subject;
  if (!CBZ || !CBZ.warlord) return { ok: false, err: "no CBZ.warlord" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (e) {}
      await wait(stepMs || 200);
    }
    return false;
  };

  let S = window.__warlordReticle;
  if (!S) {
    const ready = await until(() => window.__warlordBattle && window.__warlordBattle.live &&
      window.__warlordBattle.live() && window.__warlordGunplay && window.__warlordGunplay.on(), 420000);
    if (!ready) return { ok: false, err: "battle/gunplay never came up" };
    const B = window.__warlordBattle, GP = window.__warlordGunplay;
    B.freeze();
    S = window.__warlordReticle = { B, GP, chapter: -1, staged: false };
    window.__cbzVisualCompare = {
      render() { try { S.B.render(); } catch (e) {} },
      advance(sec) { try { S.B.advance(sec); S.B.render(); } catch (e) {} },
    };
  }
  const { B, GP } = S;

  /* Put him on the ground in the fps seat, thirty metres short of the nearest
     man, aimed at him — the same staging warlord-gunplay.mjs uses, so the two
     storyboards photograph the same fight from the same square metre. */
  const stage = () => {
    if (!S.staged) { B.order("hold"); B.advance(8); S.staged = true; }
    GP.heal();
    const a = B.audit();
    if (!a || !a.live) return null;
    const t = GP.nearestEnemy();
    if (!t) return null;
    const dx = t.x - a.field.cx, dz = t.z - a.field.cz;
    const d = Math.hypot(dx, dz) || 1;
    GP.place({ x: t.x - (dx / d) * 30, z: t.z - (dz / d) * 30 });
    const mark = GP.nearestEnemy();
    if (!mark) return null;
    B.camera("fps");
    /* HIP FIRE, NOT ADS. Aiming down the sights parks the front post of the
       rifle over the middle of the screen, which is exactly where the reticle
       is — so the first run of this preset photographed the fix as a returning
       AMMO readout and hid its own headline behind a gun. The subject is the
       crosshair; frame it where a crosshair is visible. */
    GP.aim(false);
    GP.look({ at: mark });
    B.advance(0.3);
    GP.look({ at: mark });
    return mark;
  };

  const liveCross = () => document.getElementById("crosshair");
  const liveAmmo = () => document.getElementById("ammo");
  const onScreen = (el) => {
    if (!el || !el.isConnected) return 0;
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity <= 0.02) return 0;
    const r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) ? 1 : 0;
  };

  /* THE TWO OPERATIONS GUNPLAY PERFORMS BETWEEN BATTLES, and nothing else.
     unmount() at gunplay.js:996-1002 removes the wrapper; the next mount()'s
     ensureHudDom() at gunplay.js:254-260 rebuilds it with this exact markup.
     Doing them here rather than running a second campaign fight keeps the beat
     about the reticle instead of about who won. */
  const swapHud = () => {
    const old = document.getElementById("wgpHud");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const root = document.createElement("div");
    root.id = "wgpHud";
    root.style.cssText = "position:fixed;inset:0;z-index:46;pointer-events:none";
    root.innerHTML = '<div id="crosshair"></div><div id="ammo"></div>';
    document.body.appendChild(root);
    return !!document.getElementById("crosshair");
  };

  const CH = [
    function first() {
      const mark = stage();
      if (!mark) throw new Error("the battle ended before this beat");
      B.advance(0.4);
      GP.look({ at: mark });
    },
    function again() {
      if (!swapHud()) throw new Error("the HUD wrapper never rebuilt");
      const mark = stage();
      if (!mark) throw new Error("the battle ended before this beat");
      // let fpsmode's own onAlways(52) run against the new DOM
      B.advance(0.6);
      GP.look({ at: mark });
      B.advance(0.2);
    },
  ];

  while (S.chapter < sub.ch) {
    S.chapter++;
    CH[S.chapter]();
  }
  B.render();
  await wait(400);

  const cross = liveCross(), ammo = liveAmmo();
  let g = {};
  try { g = GP.audit() || {}; } catch (e) {}
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: { cam: g.cam, fpsActive: !!(CBZ.fpsActive && CBZ.fpsActive()), armed: !!(CBZ.playerArmed && CBZ.playerArmed()) },
    metrics: {
      crosshair: onScreen(cross),
      ammoReadout: onScreen(ammo),
      // the ratchet: is the element fpsmode is styling still IN the document
      styledNodeAttached: cross && cross.isConnected ? 1 : 0,
    },
  };
}

export default {
  id: "warlord-reticle",
  title: "The Warlord's Crosshair — And The Node It Was Being Painted Onto",
  description:
    "A FLAGLESS before/after on the desert warlord's battle page. BEFORE is the shipped commit, checked out into a throwaway git worktree and served from it; AFTER is this working tree. systems/fpsmode.js resolved #crosshair once at module load, and warlord/gunplay.js destroys and rebuilds that element around every battle — so from the second fight of a campaign onward the reticle and the ammo readout were being drawn onto a node that had already left the document. The element is now looked up through a guard that notices when its node has been detached.",
  beforeLabel: "BEFORE · HEAD (the shipped build)",
  afterLabel: "AFTER · this working tree",
  pairNote: "Same checkout topology · same seed · same rosters · same ground · same simulated seconds · ?frozen=1",
  page: "games/warlord.html",
  urlParams: { battle: 1, frozen: 1, mine: 40, them: 55, seed: 1337, gun: "ak47", morale: "old", faction: "militia", myfaction: "legion" },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  stageTimeoutMs: 600000,
  viewport: { width: 1280, height: 720 },
  metrics: {
    crosshair: { label: "Reticle on screen", better: "higher" },
    ammoReadout: { label: "Ammo readout on screen", better: "higher" },
    styledNodeAttached: { label: "The element being styled is in the document", better: "higher" },
  },
  metricsNote:
    "All three are 1 or 0 and all three are read through getComputedStyle plus getBoundingClientRect on the element the DOCUMENT currently has — not through fpsmode's own inline write, which is the thing under test and which reports success either way because a detached node accepts style writes happily. The first subject is the control: the bug does not show on the first battle of a session, so both columns must read 1 there, and a difference on that row would mean the fix changed something it had no business touching. ammoReadout rides along because it is the same cached-node bug on the line below the reticle; #hitMarker is the third casualty and is not photographed here because it needs a round to land.",
  subjects,
  stage: stageWarlordReticle,

  /* The before column is a COMMIT, not a flag. Same hook and same discipline as
     megalodon-sight.mjs and shark-eyes.mjs: remove and re-add the worktree every
     run, because a reused one is a previous run's leftovers and a "before"
     quietly serving a dirty tree looks exactly like a clean pair. */
  async launchSides(ctx) {
    const root = (ctx && ctx.repoRoot) || ROOT;
    const wt = path.join(os.tmpdir(), "ba-warlord-reticle-head");
    const git = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    try { git(["worktree", "remove", "--force", wt]); } catch (e) {}
    try { git(["worktree", "prune"]); } catch (e) {}
    git(["worktree", "add", "--detach", "--force", wt, "HEAD"]);

    const serverPath = path.join(wt, "tools", "devserver.py");
    if (!existsSync(serverPath)) throw new Error("HEAD worktree has no tools/devserver.py at " + serverPath);
    const port = 8935;
    const srv = spawn("python3", [serverPath], {
      cwd: wt, env: Object.assign({}, process.env, { PORT: String(port) }),
      stdio: "ignore", detached: true,
    });
    const origin = `http://127.0.0.1:${port}/`;
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { up = (await fetch(origin, { method: "HEAD" })).ok; } catch (e) { /* not yet */ }
      if (!up) await sleepMs(150);
    }
    if (!up) throw new Error("HEAD worktree server never answered at " + origin);
    if (ctx && ctx.log) ctx.log(`[warlord-reticle] BEFORE = HEAD worktree at ${wt} on ${origin}`);

    return {
      before: origin,
      label: "HEAD vs working tree",
      async close() {
        try { process.kill(-srv.pid, "SIGTERM"); } catch (e) { try { srv.kill(); } catch (e2) {} }
        try { git(["worktree", "remove", "--force", wt]); } catch (e) {}
      },
    };
  },
};
