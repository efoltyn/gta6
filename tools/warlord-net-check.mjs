#!/usr/bin/env node
/* ============================================================
   tools/warlord-net-check.mjs — CAN TWO PEOPLE PLAY IT.

   Everything in this repo's multiplayer had a test EXCEPT the only question
   a player asks. tools/test-net.js checks the node relay's protocol;
   tools/test-net-browser.mjs joins two Chromes to a node relay; neither
   exists for warlord, and neither could have caught what was actually
   broken, which is that the deployed build's MULTIPLAYER button opened a
   WebSocket to a static file host. The transport was fine. The address was
   imaginary.

   So this asks it end to end, in two real browsers, over the real transport:

     A opens games/warlord.html?net=host  and publishes its four-character
       room code on window.__room
     B opens games/warlord.html?room=<CODE>
     and then, within the budget:

       1. both reach phase `campaign`                (they are on an island)
       2. the seeds are equal                        (it is the SAME island)
       3. A isHost() === true, B === false           (one simulator, elected)
       4. each sees the other in W.warnet.peers      (the 4 Hz lane is alive)
       5. each sees the other as a BAND on the map   (peerBands, not a list)
       6. the seed-derived warlord roster is identical on both ends
       7. they are NOT standing in the same footprint (the seat spread)
       8. an alliance offer from A arrives at B       (the reliable lane)
       9. a second state frame arrives ~250 ms later  (it keeps running)

   TWO BROWSERS, TWO SERVERS. tools/lib/cdp.mjs's launch() spawns a devserver
   AND a Chrome per call, so calling it twice is two independent clients that
   share nothing but the wire — which is the point. It is also why this is
   slow (two cold boots of a 14 km island) and why the budget is generous.

   THE ROOMS PATH NEEDS THE INTERNET. PeerJS's public broker exchanges the
   two SDP blobs; nothing else in the game touches it. On a machine that
   cannot reach it, run the same nine assertions over a node relay instead:

       node tools/warlord-net-check.mjs                     # rooms (default)
       node tools/warlord-net-check.mjs --relay             # spawn server/server.js
       node tools/warlord-net-check.mjs --relay ws://host:8000/ws

   --relay proves the SEAM (net.js, warnet.js, match.js, the lobby) but not
   WebRTC reachability. tools/test-rooms.mjs is the third leg: it runs the
   room protocol itself in plain node with no browser at all.

   Exit 0 clean, 1 on any failing step, with the step named.
============================================================ */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, ROOT, sleep } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); const v = argv[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : d; };
const SEED = opt("--seed", "1337");
const BUDGET = parseInt(opt("--budget", "60000"), 10);
const WANT_RELAY = flag("--relay");
const RELAY_URL = WANT_RELAY ? opt("--relay", null) : null;

const fails = [];
const notes = [];
function check(name, cond, detail) {
  const line = `  ${cond ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`;
  console.log(line);
  if (!cond) fails.push(name + (detail ? "  — " + detail : ""));
  return cond;
}

/* The one expression both browsers are interrogated with. Keeping it in one
   place is what makes "identical on both ends" a comparison rather than two
   separately-written questions that could disagree by accident. */
const SNAPSHOT = `(() => {
  try {
    const W = CBZ.warlord, N = W.warnet, S = W.state;
    const peers = [];
    for (const k in S.peers) { const p = S.peers[k]; peers.push({ id: p.id, name: p.name, x: p.x, z: p.z, t: p.t }); }
    const wl = W.warlords ? W.warlords.list() : [];
    return {
      phase: W.phase(), seed: S.seed, mode: S.mode,
      me: N.me(), room: N.room ? N.room() : "",
      online: N.online(), connected: N.connected(), isHost: N.isHost(),
      players: N.players().map(p => ({ id: p.id, name: p.name })),
      peers: peers,
      bands: N.peerBands().map(b => ({ id: b.id, name: b.name, x: Math.round(b.x), z: Math.round(b.z) })),
      you: { x: Math.round(S.you.x), z: Math.round(S.you.z) },
      /* THE SEED-DERIVED ROSTER ONLY. Adopted peers are pushed onto the same
         list and they are not derived from anything — each client adopts the
         OTHER one, so including them would make two correct clients disagree
         by construction. The derived half is the half the seed promises. */
      warlords: wl.filter(w => !w.peer).map(w => w.id + ":" + w.name),
      waiting: wl.concat([{id:"you"}]).map(w => {
        const o = W.warlords ? W.warlords.waiting(w.id, "you") : null;
        return o ? (o.from + ">" + o.to) : null;
      }).filter(Boolean),
    };
  } catch (e) { return { threw: String(e) }; }
})()`;

async function boot(rig, query, label) {
  const url = await rig.open("games/warlord.html", query);
  console.log(`  ${label}: ${url.replace(rig.origin, "…/")}`);
  const ok = await rig.wait(`window.__warlordReady === true`, 120000);
  if (!ok) throw new Error(`${label} never finished booting`);
  return url;
}

let relayProc = null;
function startRelay() {
  return new Promise((res, rej) => {
    const port = 8000 + Math.floor(Math.random() * 900);
    relayProc = spawn(process.execPath, [path.join(ROOT, "server/server.js")], {
      cwd: ROOT, env: { ...process.env, PORT: String(port), CBZ_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    let out = "";
    const done = (u) => { relayProc.stdout.off("data", onData); res(u); };
    const onData = (b) => {
      out += String(b);
      const m = /https?:\/\/[^\s]*?:(\d+)/.exec(out);
      if (m) done(`ws://127.0.0.1:${m[1]}/ws`);
      else if (/listening|serving/i.test(out)) done(`ws://127.0.0.1:${port}/ws`);
    };
    relayProc.stdout.on("data", onData);
    relayProc.stderr.on("data", (b) => { out += String(b); });
    setTimeout(() => { if (out) done(`ws://127.0.0.1:${port}/ws`); else rej(new Error("server/server.js printed nothing: " + out)); }, 4000);
  });
}

const run = async () => {
  console.log(`warlord net check — ${WANT_RELAY ? "NODE RELAY" : "ROOMS (PeerJS broker)"} · seed ${SEED}\n`);
  let relayUrl = RELAY_URL;
  if (WANT_RELAY && !relayUrl) { relayUrl = await startRelay(); console.log(`  relay: ${relayUrl}`); }

  const common = `seed=${SEED}&sound=off&weather=off&ride=1`;
  const A = await launch({ rafBudget: 0 });
  let B = null;
  try {
    // ---------------------------------------------------------------- A
    const aq = relayUrl
      ? `${common}&relay=${encodeURIComponent(relayUrl)}&name=ATTAR`
      : `${common}&net=host&name=ATTAR`;
    await boot(A, aq, "A");

    let code = "";
    if (!relayUrl) {
      const got = await A.wait(`typeof window.__room === "string" && window.__room.length === 4`, 45000);
      code = got ? await A.evl(`window.__room`) : "";
      if (!check("A opened a room and published its code", !!code,
        code || "no code — is the PeerJS broker reachable from this machine? " +
          "(the game's own error text is on screen; try --relay)")) {
        const why = await A.evl(`(()=>{try{const n=document.querySelector('.wl-net-err');return n?n.textContent:document.querySelector('.wl-h')?document.querySelector('.wl-h').textContent:''}catch(e){return String(e)}})()`);
        if (why) console.log(`      the page says: ${why}`);
        throw new Error("no room code");
      }
      console.log(`  room ${code}`);
    }

    // A must be on the island before B is allowed to arrive, or "who was
    // first in" — which is the whole host election — is a race.
    const aUp = await A.wait(`CBZ.warlord.phase() === "campaign"`, 120000);
    check("A reached the campaign", aUp);

    // ---------------------------------------------------------------- B
    B = await launch({ rafBudget: 0 });
    const bq = relayUrl
      ? `${common}&relay=${encodeURIComponent(relayUrl)}&name=BURAQ`
      : `${common}&room=${code}&name=BURAQ`;
    await boot(B, bq, "B");
    const bUp = await B.wait(`CBZ.warlord.phase() === "campaign"`, 120000);
    check("B reached the campaign", bUp);

    // both ends see each other; give the 4 Hz pump a few beats
    const seen = await A.wait(`Object.keys(CBZ.warlord.state.peers).length > 0`, BUDGET);
    await B.wait(`Object.keys(CBZ.warlord.state.peers).length > 0`, 8000);
    await sleep(1200);

    const a = await A.evl(SNAPSHOT);
    const b = await B.evl(SNAPSHOT);
    if (a.threw || b.threw) throw new Error(`snapshot threw: A=${a.threw} B=${b.threw}`);
    console.log("");

    check("1. both are in phase campaign", a.phase === "campaign" && b.phase === "campaign", `A=${a.phase} B=${b.phase}`);
    check("2. one island — the seeds match", a.seed === b.seed, `A=${a.seed} B=${b.seed}`);
    check("   ...and it is the host's seed", String(a.seed) === String(SEED), `${a.seed} vs asked ${SEED}`);
    check("3. A is the sim host, B is not", a.isHost === true && b.isHost === false, `A=${a.isHost} B=${b.isHost}`);
    check("4. A sees B on the wire", a.peers.some((p) => p.id === b.me.id), JSON.stringify(a.peers.map((p) => p.name)));
    check("   B sees A on the wire", b.peers.some((p) => p.id === a.me.id), JSON.stringify(b.peers.map((p) => p.name)));
    check("5. A sees B as a band on the island", a.bands.length === 1, JSON.stringify(a.bands));
    check("   B sees A as a band on the island", b.bands.length === 1, JSON.stringify(b.bands));
    check("6. the seed-derived warlord roster is identical",
      a.warlords.length > 0 && JSON.stringify(a.warlords) === JSON.stringify(b.warlords),
      `${a.warlords.length} vs ${b.warlords.length}`);
    const dx = a.you.x - b.you.x, dz = a.you.z - b.you.z;
    const apart = Math.round(Math.hypot(dx, dz));
    check("7. they did not spawn in the same footprint", apart > 300,
      `${apart} m apart (A ${a.you.x},${a.you.z} · B ${b.you.x},${b.you.z})`);

    // ------------------------------------------------ 8. the reliable lane
    const offered = await A.evl(`(() => {
      try {
        const W = CBZ.warlord, N = W.warnet;
        const ids = Object.keys(W.state.peers);
        if (!ids.length) return "no peer";
        const him = "p" + (ids[0] | 0);
        if (!W.warlords.warlord(him)) return "peer was never adopted as a warlord: " + him;
        return W.warlords.offer("you", him) ? "" : "offer() refused";
      } catch (e) { return String(e); }
    })()`);
    check("8. A can offer B his hand", offered === "", offered);
    const arrived = await B.wait(`(() => {
      const W = CBZ.warlord, ids = Object.keys(W.state.peers);
      return ids.length && W.warlords.waiting("p" + (ids[0]|0), "you");
    })()`, 15000);
    check("   ...and the offer reaches B", arrived,
      arrived ? "" : "B never saw a wla — " + JSON.stringify((await B.evl(SNAPSHOT)).waiting));

    // ------------------------------------------------ 9. it keeps running
    const t0 = (await A.evl(`(()=>{const p=CBZ.warlord.state.peers;for(const k in p) return p[k].t;return 0})()`)) || 0;
    await sleep(1500);
    const t1 = (await A.evl(`(()=>{const p=CBZ.warlord.state.peers;for(const k in p) return p[k].t;return 0})()`)) || 0;
    check("9. the 4 Hz lane keeps delivering", t1 > t0, `${t1 - t0} ms of fresh frames in 1.5 s`);

    // ------------------------------------------------ 10. a human fight
    /* THE LOOP OF THIS GAME IS FIGHTING and until this pass the one thing
       you could not do to another human was fight him. Both sides are given
       a column (they start alone with a pistol, by design), then A rides at
       B and both ends must come away having lost THEIR OWN men and agreeing
       who won — which is the whole reason one machine computes and both
       apply, rather than both computing. */
    const ARM = `(() => {
      const W = CBZ.warlord;
      W.on("warnet:fight", function (d) {
        window.__fight = { outcome: d.outcome, band: d.band.name, myDead: d.myDead, hisDead: d.hisDead,
                           army: W.state.army.length };
      });
      for (let i = 0; i < 20; i++) W.addSoldier(W.makeSoldier("levy", "rifle"));
      return W.armySize();
    })()`;
    const aMen0 = await A.evl(ARM), bMen0 = await B.evl(ARM);
    const fired = await A.evl(`(() => {
      const W = CBZ.warlord, ids = Object.keys(W.state.peers);
      return ids.length ? !!W.warnet.fight(ids[0] | 0) : false;
    })()`);
    check("10. A can ride at B", fired === true, String(fired));
    const bSaw = await B.wait(`!!window.__fight`, 20000);
    const aSaw = await A.wait(`!!window.__fight`, 20000);
    const fa = await A.evl(`window.__fight`), fb = await B.evl(`window.__fight`);
    check("    both ends resolved the same fight", aSaw && bSaw, `A=${JSON.stringify(fa)} B=${JSON.stringify(fb)}`);
    /* The outcomes are stated from each side's own point of view, so they
       must be OPPOSITE — the failure this catches is two clients each
       believing they won, which is what a symmetric resolver produces. */
    const opposed = fa && fb && ((fa.outcome === "won" && fb.outcome === "lost") ||
      (fa.outcome === "lost" && fb.outcome === "won") || (fa.outcome === "retreat" && fb.outcome === "retreat"));
    check("    they do not both think they won", !!opposed, `A ${fa && fa.outcome} · B ${fb && fb.outcome}`);
    const aMen1 = await A.evl(`CBZ.warlord.armySize()`), bMen1 = await B.evl(`CBZ.warlord.armySize()`);
    /* THE CLAIM IS THAT ONE RESOLVER'S ANSWER LANDED ON BOTH ARMIES. A's
       report named N of A's men and M of B's; A's army must be exactly N
       shorter and B's exactly M. Anything else means the two machines are
       running different armies under the same names, which is the failure
       this whole design exists to prevent. */
    const wantA = fa ? fa.myDead : -1, wantB = fa ? fa.hisDead : -1;
    check("    each side lost exactly the men the one resolver named",
      (aMen0 - aMen1) === wantA && (bMen0 - bMen1) === wantB,
      `A ${aMen0}→${aMen1} (report said ${wantA}) · B ${bMen0}→${bMen1} (report said ${wantB})`);
    if (wantA === 0 && wantB === 0) {
      notes.push("THE FIGHT KILLED NOBODY, and that is battle.js, not the wire: " +
        "W.battle.resolve() ends on tick 2 with the whole line routed and zero dead. " +
        "It has never had a caller until now (CONTRACT.md promises it; army.js uses start()). " +
        "Repro: node tools/warlord-boot.mjs is fine, but resolve() 20-v-20 returns " +
        "{outcome:'lost',duration:2,yourDead:0,theirDead:0}; the SAME call under ?morale=old " +
        "returns {outcome:'won',duration:103,yourDead:3,theirDead:20}. " +
        "The headless morale path is battle.js:1275-1307.");
    }

    if (!seen) notes.push("the peer table took the full budget to fill");
    const errs = [...A.errors, ...B.errors].filter((e) => !/favicon/i.test(e));
    check("nothing threw in either browser", errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally {
    if (B) await B.close();
    await A.close();
    if (relayProc) { try { process.kill(-relayProc.pid); } catch (_) { try { relayProc.kill(); } catch (_) {} } }
  }

  console.log("");
  for (const n of notes) console.log("  note: " + n);
  if (fails.length) {
    console.log(`\nWARLORD NET: FAIL (${fails.length})\n`);
    for (const f of fails) console.log("  " + f);
    process.exit(1);
  }
  console.log("WARLORD NET OK — two browsers, one island, no server.");
};

run().catch((e) => {
  console.error("\nWARLORD NET: FAIL — " + (e && e.message ? e.message : e));
  if (relayProc) { try { process.kill(-relayProc.pid); } catch (_) {} }
  process.exit(1);
});
