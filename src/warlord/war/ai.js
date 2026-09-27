/* ============================================================
   warlord/war/ai.js — A FACTION'S HEAD. It plays the player's game.

   It may only do what the player can do, through the same calls:
   sim.order / levy / raise / merge / declareWar / makePeace. It reads the
   map (G) like the player reads the screen. No bonuses, no spawned men,
   no knowledge the map does not show.

   Its loop is the player's loop: stand up an army from a town's garrison,
   march on the weakest town you can reach that you are allowed to take,
   beat the garrison that comes out, take the town, raise men there, go on.
   Defend your own towns when somebody marches on them. Declare war on a
   weaker neighbour when you are strong; ask for peace when you are losing.
============================================================ */
(function () {
  "use strict";
  const G0 = typeof window !== "undefined" ? window : globalThis;
  const W = ((G0.CBZ = G0.CBZ || {}).warlord = G0.CBZ.warlord || {});
  const WAR = (W.war = W.war || {});
  const AI = (WAR.ai = WAR.ai || {});

  function sim() { return WAR.sim; }
  function dist(M, t, x, y) { const dx = t % M.w + 0.5 - x, dy = ((t / M.w) | 0) + 0.5 - y; return Math.sqrt(dx * dx + dy * dy); }

  AI.think = function (G, f) {
    const S = sim(), M = G.M, F = G.factions[f];
    if (!F.alive) return;
    const mine = [];
    for (const a of G.armies) if (a.owner === f && a.home < 0 && !a.free && !a.dead) mine.push(a);
    diplomacy(G, f, mine);

    // stand up an army when we have none, or one per six towns
    const want = Math.max(1, Math.round(F.towns / 6));
    if (mine.length < want && G.day - (F.lastLevy == null ? -99 : F.lastLevy) >= 12) {
      let best = -1, bm = 0;
      for (let t = 0; t < M.towns.length; t++) {
        if (G.townOwner[t] !== f) continue;
        const r = S.raisable(G, t);
        if (r > bm) { bm = r; best = t; }
      }
      const floor = Math.max(200, F.garrisons * 0.08);
      if (best >= 0 && bm > floor) { const a = S.levy(G, best); if (a) { mine.push(a); F.lastLevy = G.day; } }
    }

    for (const a of mine) {
      if (a.battle || a.dead) continue;
      // merge with a friend standing next to us
      for (const b of mine) if (b !== a && !b.dead && !b.battle && Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) <= 1.5) S.merge(G, [a.id, b.id]);
      if (a.dead) continue;
      // in our own town: take the men it can spare
      const here = M.townAt[a.tile] - 1;
      if (here >= 0 && G.townOwner[here] === f && S.raisable(G, here) > a.men * 0.15) S.order(G, a, { kind: "raise" });

      const my = S.strength(G, a);
      // cut off AND hurting: go home. A march through a day of bad ground is
      // not a reason to turn round; an army losing its order is.
      if (!a.supplied && a.org < 0.45) {
        const tt = S.nearestTownOf(G, f, a.tile);
        if (tt >= 0) { S.order(G, a, { kind: "move", to: M.towns[tt].tile }); continue; }
      }
      // somebody marching on one of our towns that we can beat: meet him
      let threat = null, td = 1e9;
      for (const b of G.armies) {
        if (b.dead || b.naval || b.home >= 0 || !S.hostile(G, f, b.owner) || b.free) continue;
        const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        if (d > 14 || d >= td) continue;
        const o = G.owner[b.tile];
        if (o !== f && !(b.order.kind === "move" && G.owner[b.order.to] === f)) continue;
        if (S.strength(G, b) * 1.2 < my) { threat = b; td = d; }
      }
      if (threat) { if (a.order.kind !== "chase" || a.order.target !== threat.id) S.order(G, a, { kind: "chase", target: threat.id }); continue; }

      // keep marching: a road already chosen is only dropped when the town
      // at its end is no longer worth taking
      if (a.order.kind === "move" && a.path && a.pi < a.path.length - 1) {
        const tt = a.aiTarget;
        if (tt == null || (G.townOwner[tt] !== f && takeable(G, f, tt))) continue;
      }
      if (a.order.kind === "chase") continue;

      // pick the next town
      let best = -1, bs = -1e9;
      for (let t = 0; t < M.towns.length; t++) {
        if (!takeable(G, f, t)) continue;
        const T = M.towns[t];
        const d = Math.hypot(T.x - a.x, T.y - a.y);
        if (d > 90) continue;
        const def = G.garrison[t] + (G.sallied[t] ? (S.army(G, G.sallied[t]) || { men: 0 }).men : 0);
        if (my < def * 1.45 + 40) continue;
        const value = Math.log10(10 + G.townPop[t] + G.townCatch[t]);
        const s = value * 10 - d * 0.35 - (G.townOwner[t] ? 0 : 4);
        if (s > bs) { bs = s; best = t; }
      }
      if (best >= 0) {
        const to = M.towns[best].tile;
        S.order(G, a, { kind: "move", to: to });
        if (a.order.kind === "move") { a.aiTarget = best; continue; }
        // no road: try from a port we hold
        const port = nearestOwnPort(G, f, a);
        if (port >= 0 && a.tile !== M.towns[port].tile) { S.order(G, a, { kind: "move", to: M.towns[port].tile }); a.aiTarget = null; continue; }
      }
      // nothing worth taking yet: walk to the town of ours with the most men
      // to spare and take them. That is how a weak army becomes a strong one.
      if (a.order.kind === "move" && a.path && a.pi < a.path.length - 1) continue;
      let rt = -1, rv = 0;
      for (let t = 0; t < M.towns.length; t++) {
        if (G.townOwner[t] !== f || t === here) continue;
        const T = M.towns[t];
        const v = S.raisable(G, t) - Math.hypot(T.x - a.x, T.y - a.y) * 40;
        if (v > rv) { rv = v; rt = t; }
      }
      if (rt >= 0 && S.raisable(G, rt) > a.men * 0.2) { S.order(G, a, { kind: "move", to: M.towns[rt].tile }); a.aiTarget = null; }
      else if (a.order.kind !== "hold") S.order(G, a, { kind: "hold" });
    }
  };

  function takeable(G, f, t) {
    const o = G.townOwner[t];
    if (o === f) return false;
    if (!o) return true;                               // a free town is anyone's for the taking
    return sim().relation(G, f, o) === "war";
  }
  function nearestOwnPort(G, f, a) {
    const M = G.M;
    let best = -1, bd = 1e9;
    for (let t = 0; t < M.towns.length; t++) {
      if (!M.towns[t].port || G.townOwner[t] !== f) continue;
      const d = Math.hypot(M.towns[t].x - a.x, M.towns[t].y - a.y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /* ---------------------------------------------------------------- diplomacy */
  function power(G, f) { const F = G.factions[f]; return F.soldiers + F.garrisons; }
  function neighbours(G, f) {
    // towns of other factions within reach of our towns
    const M = G.M, out = new Set();
    const mine = [];
    for (let t = 0; t < M.towns.length; t++) if (G.townOwner[t] === f) mine.push(M.towns[t]);
    for (let t = 0; t < M.towns.length; t++) {
      const o = G.townOwner[t];
      if (!o || o === f || out.has(o)) continue;
      const T = M.towns[t];
      for (const m of mine) if (Math.hypot(m.x - T.x, m.y - T.y) < 40) { out.add(o); break; }
    }
    return out;
  }
  function diplomacy(G, f, mine) {
    const S = sim(), F = G.factions[f], P = power(G, f);
    if ((G.day + f * 7) % 15) return;
    let wars = 0;
    for (let e = 1; e < G.ROGUE; e++) {
      if (e === f || !G.factions[e].alive || S.relation(G, f, e) !== "war") continue;
      wars++;
      const Pe = power(G, e);
      // losing: sue for peace. The other side (AI) accepts when it has had
      // the better of it; the player gets asked.
      if (P < Pe * 0.55 || F.towns <= 2) {
        if (e === G.player) G.events.push({ type: "offer", from: f, to: e });
        else if (S.peaceAcceptable(G, e, f) || S.peaceAcceptable(G, f, e)) S.makePeace(G, f, e);
      }
    }
    const aggr = (F.ai && F.ai.aggression != null) ? F.ai.aggression : 0.5;
    // a faction starts one war at a time and a treaty holds for a year:
    // without these the Mediterranean flipped between war and peace fifty
    // times a year and no front ever meant anything
    if (wars >= 2 || G.day < 60 || G.day - (F.lastWarDay == null ? -1e9 : F.lastWarDay) < 150) return;
    let best = 0, bw = 0;
    neighbours(G, f).forEach(function (e) {
      if (S.relation(G, f, e) !== "peace") return;
      if (S.sincePeace(G, f, e) < 365) return;
      const r = P / Math.max(1, power(G, e));
      const s = r * (0.6 + aggr);
      if (r > 1.6 - aggr * 0.4 && s > bw) { bw = s; best = e; }
    });
    if (best && G._rand() < 0.25 + aggr * 0.4 && S.declareWar(G, f, best)) F.lastWarDay = G.day;
  }
})();
