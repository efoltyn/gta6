#!/usr/bin/env node
/* ============================================================
   tools/warlord-mp.mjs — CAN TWO PEOPLE PLAY THIS.

   warlord-boot.mjs asks whether the game starts. Nothing asked whether it
   starts for TWO people, and on 2026-08-30 the owner's entire report was
   "multiplayer is fing broke as fuck". Everything below is a thing that was
   MEASURED to be broken on cfad656 with two real clients on one real relay.

   !! NOT YET EXECUTED. The machine was at load average 146 when this was
   written and all browser work was stopped mid-session, so this file has
   never been run end to end. Every line of it is lifted from a scratch probe
   that DID run and did produce the evidence quoted below, but treat a first
   red run as "the tool is wrong" until you have checked it. Delete this
   paragraph the first time it goes green.

   ── WHAT IT STANDS UP ──────────────────────────────────────────────────
   A real `node server/server.js` relay on its own port, and TWO real pages
   in one headless Chrome (cdp.mjs's rig.newPage(), added for this). Not two
   fake clients, not one client talking to itself: the same handshake, the
   same election, the same relay the owner would run.

   ── WHAT IT ASSERTS, AND THE FAILURE EACH ONE IS THE GATE FOR ──────────

   1. TWO CLIENTS CAN BE IN THE ROOM AT ONCE.
      warnet.js handed the relay a pid out of localStorage, which every tab of
      a browser profile shares, so server.js's reconnect dedupe correctly
      concluded the second client was the first one coming back and killed the
      first session. Measured, verbatim:
          [server] join #1 ALFA (1 online)
          [server] reconnect: dropping stale session #1 ALFA (pid match)
          [server] leave #1 ALFA (reconnect) (0 online)
          [server] join #2 BRAVO (1 online)
      ALFA then started a one-warlord match on an island BRAVO could not see,
      and nothing on either screen said a word. Fixed (sessionStorage: one tab
      is one warlord, and it still survives a reload). This assertion is the
      thing that stops it coming back.

   2. THE HOST'S OWN ROSTER CONTAINS THE HOST, AND BOTH CLIENTS AGREE ON THE
      BOARD. Same seed, same region count, same ownership map, both warlords
      present on both machines, each on his own home. This passed once (1) was
      fixed and it is asserted so it stays passing.

   3. THE LOBBY SHOWS WHO IS ACTUALLY IN THE ROOM.
      drawLobby() is called exactly twice — when the screen opens, and 900 ms
      after you press JOIN A SERVER — and nothing subscribes to connect, join
      or leave. Measured: with BRAVO and CHARLIE both in the relay's player
      table, ALFA's lobby listed one row, itself, and its button read RIDE OUT
      (the SOLO caption) rather than START THE MATCH. A player who opens the
      lobby before his friend arrives never sees him arrive, presses the big
      button, and plays alone. NOT FIXED — see the report.

   4. AN ATTACK REACHES THE OTHER CLIENT AS AN ORDER, AND BOTH CLIENTS SETTLE
      IT THE SAME WAY. This is the big one and it is three defects stacked:

      (a) battle.js's resolve() APPLIES BY DEFAULT. Its own header says
          "leaving it off returns the report and changes nothing", and the
          code is `if (opts.apply !== false && W.army.aftermath)
          W.army.aftermath(r)`. match.js's decide() never passes apply:false,
          so the headless preview of a match battle takes the screen and fires
          phase:aftermath.
      (b) match.js's phase:aftermath listener then settles the battle
          IMMEDIATELY, off that report, six milliseconds after the attack was
          ordered — and broadcasts wlmres BEFORE the wlmatk that created the
          battle has been sent, because attack() applies locally and only then
          sends. Measured (performance.now, one client):
              88898  EV match:attack
              88904  EV phase campaign -> aftermath  (resolved:true)
              88907  SEND wlmres  {"id":1000001,"win":false,"al":0,"dl":0}
             122553  SEND wlmatk  {"id":1000001,...}
          33.6 seconds inverted. The other client's settle() finds no pending
          battle for that id, drops the result on the floor, and then waits out
          the full 150 s BATTLE_MAX deadline. Measured board disagreement:
          170 seconds on one attack.
      (c) resolve() ignores `mine`, `theirs` and `seed` entirely — it reads
          opts.army / opts.band / opts.salt — so the fight it resolves is your
          WHOLE army against a fresh W.makeBand({size:12}), seeded off the day.
          The report that settled the match battle above named a twelve-man
          SAND BANDITS band nobody had attacked. It also advances core's shared
          RNG, which match.js's header swears it never does.
      NOT FIXED — see the report. This assertion will be red until it is.

   5. THE ATTACKER IS NOT SOFT-LOCKED IN HIS OWN BATTLE. Because (4b) empties
      M.pending before battle.start() runs, tick()'s deadline has nothing left
      to retreat, and the 3D fight never ends. Measured: phase stayed "battle"
      with battle.live() true for 190 s, past a 150 s ceiling, on a match that
      had already given the region away. NOT FIXED.

   6. THE CLOCK CONVERGES. This one is GREEN and is asserted to keep it that
      way: three clients agreed to within 0.10 s over a five-minute match, and
      a client whose main thread stalled for 19.7 s (audit().stallMax) came
      back in step. The wall-time clock does what its header claims.

   ── HOW TO READ A FAILURE ──────────────────────────────────────────────
   Every assertion prints what it saw. A red 4 or 5 is the known state of the
   game and not a regression until they are fixed. A red 1, 2 or 6 is new.

     node tools/warlord-mp.mjs
     node tools/warlord-mp.mjs --keep      (leave the relay up to poke at)

   Exit 0 clean, 1 on anything above. No screenshots. Two clients, one relay.
============================================================ */
import { spawn } from "node:child_process";
import { launch, ROOT, sleep } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = opt("--seed", "1337");

const fails = [];
const bad = (s) => { fails.push(s); console.log("  FAIL  " + s); };
const ok = (s) => console.log("  ok    " + s);

/* A relay on a port nothing else has claimed. server/server.js serves the game
   too, but the pages are served by cdp.mjs's devserver and only the SOCKET is
   here — that is deliberate, because it is the arrangement a player actually
   has (a page from one place, a relay somebody else is running). */
async function relayOn() {
  for (let t = 0; t < 24; t++) {
    const p = 8200 + Math.floor(Math.random() * 600);
    try { await fetch(`http://127.0.0.1:${p}/api/info`); continue; } catch (_) {}
    const proc = spawn("node", [ROOT + "/server/server.js"], {
      env: { ...process.env, PORT: String(p), CBZ_NO_HEARTBEAT: "1" },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    const log = [];
    proc.stdout.on("data", (d) => log.push(String(d)));
    for (let i = 0; i < 80; i++) {
      try { await fetch(`http://127.0.0.1:${p}/api/info`); return { proc, port: p, log }; }
      catch (_) { await sleep(150); }
    }
    try { process.kill(-proc.pid); } catch (_) {}
  }
  throw new Error("could not start server/server.js on any port");
}

const P = async (pg, e) => {
  try { return await pg.evl(`(()=>{try{return (${e})}catch(x){return {threw:String(x)}}})()`); }
  catch (x) { return { evlthrew: String(x) }; }
};

/* One eval, one object. Two-client tests are slow enough without a round trip
   per field, and — measured — a busy page can take twenty seconds to answer,
   so reading A then B field by field reports a skew that is the TOOL's. */
const SNAP = `(()=>{const W=CBZ.warlord,M=W.matchState,a=W.match.audit();return {
  me:a.me, live:a.live, over:a.over, host:a.host, conn:a.connected,
  t:a.t, seed:a.seed, regions:a.regions, stall:a.stallMax,
  wl:Object.keys(M.wl), own:JSON.stringify(M.own),
  pending:Object.keys(M.pending), applied:Object.keys(M.applied),
  phase:W.phase(), battleLive:!!(W.battle&&W.battle.live&&W.battle.live()),
  netId:(CBZ.net&&CBZ.net.id)||0, netActive:!!(CBZ.net&&CBZ.net.active),
  players:[...((CBZ.net&&CBZ.net.players)?CBZ.net.players.keys():[])]};})()`;

const run = async () => {
  const R = await relayOn();
  const WS = `ws://127.0.0.1:${R.port}/ws`;
  console.log(`relay ${WS}`);
  const rig = await launch({ rafBudget: 0 });
  try {
    const A = rig, B = await rig.newPage({ rafBudget: 0 });
    const q = `go=1&seed=${SEED}&weather=off&sound=off&matchlen=20&matchai=0`;
    await A.open("games/warlord.html", q);
    await B.open("games/warlord.html", q);
    const ready = `window.__warlordReady===true && CBZ.warlord.phase && CBZ.warlord.phase()==="campaign"`;
    if (!await A.wait(ready, 180000)) return bad("client A never reached the campaign");
    if (!await B.wait(ready, 180000)) return bad("client B never reached the campaign");
    for (const e of A.errors) bad("A console error at boot: " + e);
    for (const e of B.errors) bad("B console error at boot: " + e);

    // ---- 1. TWO CLIENTS IN THE ROOM AT ONCE ----------------------------
    await A.evl(`CBZ.warlord.warnet.connect({url:${JSON.stringify(WS)},name:"ALFA"})`);
    if (!await A.wait(`CBZ.net&&CBZ.net.active`, 40000)) return bad("A never connected to the relay");
    await B.evl(`CBZ.warlord.warnet.connect({url:${JSON.stringify(WS)},name:"BRAVO"})`);
    if (!await B.wait(`CBZ.net&&CBZ.net.active`, 40000)) return bad("B never connected to the relay");
    await sleep(2000);

    const na = await P(A, SNAP), nb = await P(B, SNAP);
    const dropped = R.log.join("").includes("pid match");
    if (dropped) bad("the relay dropped one client as a stale pid — two tabs still share an identity");
    else ok("two clients, two sessions, neither deduped");
    if (!na.netActive) bad("A's socket died while B joined (netActive false)");
    if (!nb.netActive) bad("B's socket died (netActive false)");
    if (na.netId === nb.netId) bad(`both clients were given relay id ${na.netId}`);
    if (!na.players.includes(nb.netId)) bad(`A's player table does not contain B (${JSON.stringify(na.players)})`);
    if (!nb.players.includes(na.netId)) bad(`B's player table does not contain A (${JSON.stringify(nb.players)})`);
    if (na.netActive && nb.netActive && na.players.includes(nb.netId)) ok("each client can see the other in the room");

    // ---- 3. THE LOBBY SHOWS THE ROOM ------------------------------------
    // Opened AFTER both are connected: if this is empty the lobby is not
    // reading the room at all, and if it fills only later it is not live.
    await A.evl(`CBZ.warlord.match.lobby()`);
    await sleep(1200);
    const rows = await P(A, `[...document.querySelectorAll('.mt-wl b')].map(e=>e.textContent)`);
    const btn = await P(A, `(document.getElementById('mtGo')||{}).textContent||''`);
    if (!Array.isArray(rows) || rows.length < 2) bad(`A's lobby lists ${JSON.stringify(rows)} — B is in the room and not on the screen`);
    else ok(`A's lobby lists both warlords: ${JSON.stringify(rows)}`);
    if (!/START THE MATCH/.test(String(btn))) bad(`A's lobby button reads "${btn}" — the solo caption, on a connected client`);
    else ok('the lobby button reads START THE MATCH');

    // ---- 2. ONE BOARD, TWO MACHINES -------------------------------------
    await A.evl(`(()=>{const b=document.getElementById('mtGo'); if(b)b.click();})()`);
    if (!await B.wait(`CBZ.warlord.match.live()`, 40000)) return bad("B never joined the match A started (no wlmstart adopted)");
    await sleep(3000);
    const a2 = await P(A, SNAP), b2 = await P(B, SNAP);
    if (!a2.live) bad("A pressed START and is not in a match");
    if (a2.seed !== b2.seed) bad(`two islands: A seed ${a2.seed}, B seed ${b2.seed}`);
    else ok(`one island, seed ${a2.seed}`);
    if (a2.regions !== b2.regions) bad(`different boards: ${a2.regions} regions vs ${b2.regions}`);
    if (a2.wl.length !== 2 || b2.wl.length !== 2) bad(`roster is ${JSON.stringify(a2.wl)} / ${JSON.stringify(b2.wl)} — a two-player match must hold two warlords on both machines`);
    else ok(`both rosters are ${JSON.stringify(a2.wl)}`);
    if (a2.wl.indexOf(a2.me) < 0) bad("the host's own roster does not contain the host");
    if (a2.own !== b2.own) bad(`the two clients disagree about who owns what at t=0:\n        A ${a2.own}\n        B ${b2.own}`);
    else ok("both clients agree on the ownership map");

    // ---- 4/5. AN ATTACK IS AN ORDER, AND IT SETTLES THE SAME WAY --------
    const atk = await P(A, `(()=>{const M=CBZ.warlord.match,me=M.me();
      const f=M.regions().filter(r=>M.canAttack(me,r.id)).sort((x,y)=>M.defence(x.id)-M.defence(y.id));
      return f[0]?{rid:f[0].id,def:M.defence(f[0].id),ok:M.attack(f[0].id)}:null;})()`);
    if (!atk || !atk.ok) bad(`A could not attack anything on its own frontier (${JSON.stringify(atk)})`);
    else {
      ok(`A attacks ${atk.rid} (${atk.def} hold it)`);
      // The order must reach B. It is a reliable ev, so a few seconds is
      // generous even on a page that is building a battlefield.
      const sawOrder = await B.wait(`Object.keys(CBZ.warlord.matchState.pending).length>0
        || CBZ.warlord.match.owner(${JSON.stringify(atk.rid)})===${JSON.stringify(a2.me)}`, 30000);
      if (!sawOrder) bad("B never saw the attack — the wlmatk order did not arrive");
      else ok("B saw the attack order");

      /* THE DEADLINE IS THE DEFINITION OF THE ENDING (match.js, THE BATTLE
         RULE point 5), so both clients must have settled inside BATTLE_MAX
         plus slack. Anything longer is the two of them disagreeing about who
         owns a region, which is the failure this whole file is about. */
      const settled = `Object.keys(CBZ.warlord.matchState.pending).length===0
        && Object.keys(CBZ.warlord.matchState.applied).length>0`;
      const aDone = await A.wait(settled, 175000);
      const bDone = await B.wait(settled, 175000);
      if (!aDone) bad("A never settled its own battle inside BATTLE_MAX");
      if (!bDone) bad("B never settled the battle inside BATTLE_MAX");
      const a3 = await P(A, SNAP), b3 = await P(B, SNAP);
      if (a3.own !== b3.own) {
        bad(`the board disagrees after one battle:\n        A ${a3.own}\n        B ${b3.own}`);
      } else ok("both clients agree on the board after the battle");
      if (a3.battleLive || a3.phase === "battle") {
        bad(`A is still inside its own 3D battle (phase ${a3.phase}, live ${a3.battleLive}) after the deadline — the attacker is soft-locked`);
      } else ok("the attacker came out of his own battle");
    }

    // ---- 6. THE CLOCK ---------------------------------------------------
    const ca = await P(A, `CBZ.warlord.match.clock()`);
    const cb = await P(B, `CBZ.warlord.match.clock()`);
    const skew = Math.abs((+ca) - (+cb));
    /* Two seconds, not two hundred milliseconds, and the slack is the TOOL's
       not the game's: reading A and then B is two round trips and a busy page
       has taken twenty seconds to answer one. A real divergence is tens of
       seconds (an unadopted T0), which this still catches. */
    if (!(skew < 2)) bad(`the two clocks are ${skew.toFixed(2)} s apart (A ${ca}, B ${cb})`);
    else ok(`the clocks agree to ${skew.toFixed(2)} s`);
    const st = await P(B, `CBZ.warlord.matchState.stallMax`);
    if (!(+st < 60)) bad(`B saw a ${st}s gap between ticks — past the catch-up clamp, so time was lost`);

    for (const e of A.errors) bad("A console error: " + e);
    for (const e of B.errors) bad("B console error: " + e);
  } finally {
    await rig.close();
    if (!KEEP) { try { process.kill(-R.proc.pid); } catch (_) { try { R.proc.kill(); } catch (_) {} } }
    else console.log(`relay left up on ${R.port} (--keep)`);
  }
};

run().then(() => {
  if (fails.length) {
    console.log(`\nWARLORD MP: FAIL — ${fails.length} of the things two people need\n`);
    process.exit(1);
  }
  console.log("\nWARLORD MP OK — two clients, one relay, one island, one board.");
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
