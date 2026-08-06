/* ============================================================
   modes/teammatch.js — THE MATCH: two sides, a clock, and a SWAP.

   WHY. `modes/gungame.js` and `modes/survival.js` each grew their own
   roster array, their own respawn timer, their own scoreboard sort,
   their own kill feed adapter and their own "is it over yet" check.
   Those five things are the same five things in every competitive mode
   ever written, and none of them are the mode's IDEA — the idea is the
   ladder, or the rising water. This file takes the five so the next
   mode only has to bring its idea.

   THE ONE OPINION IT HOLDS: ASYMMETRY MUST BE PLAYED FROM BOTH SIDES.
   A match here is N HALVES, and at the swap every team's ROLE changes.
   That is not a feature bolted on for one game — it is the only fair
   way to score an asymmetric fight, and the reason it lives in the
   framework is that the alternative (each mode hand-rolling a swap) is
   exactly how a swap ends up half-implemented: scores reset, spawns
   wrong, the clock restarting from the wrong number.

   THE SCORE IS PER (TEAM, HALF), NEVER PER TEAM. `m.score[team]` is an
   array indexed by half, and `m.total(team)` sums it. This costs
   nothing and it buys the two things a swap game always ends up
   needing: an honest halftime card, and a result that can SAY why it
   was a result ("TALON won the bombing half 7–4, GHOST won the running
   half 340–210").

   ROLES ARE STRINGS AND THE FRAMEWORK NEVER READS THEM. It hands your
   role back to you (`m.roleOf(teamId)`), fires `onHalfStart` and gets
   out of the way. It does not know what a bomber is and must not.

   THE ROSTER is a flat list of {id, name, team, human, alive}. It is
   flat because every query a mode actually makes is a filter — alive on
   a team, humans on a team, everyone — and a flat list answers all of
   them without a class hierarchy. Respawn is a countdown on the record;
   the mode supplies `onRespawn` to put the body back in the world.

   THE FEED is the mode's narration surface, capped and timestamped. In
   the full engine `CBZ.cityKillFeed` owns the HUD popup and this file
   forwards to it when present (killfeed.js is the ONE death bus, per
   doctrine); standalone, the caller renders `m.feed` itself.

   USE:
     const m = CBZ.teammatch.create({
       teams: [{id:"talon", name:"TALON", color:0xff6a3d},
               {id:"ghost", name:"GHOST", color:0x49c6ff}],
       roles: ["bomber", "runner"], halves: 2, halfSeconds: 600,
       onHalfStart(half, m) { … place everyone … },
       onEnd(result, m) { … },
     });
     m.addPlayer({id:"p0", name:"YOU", team:"talon", human:true});
     m.start();  // then m.step(dt) each frame (auto if CBZ.micro is present)

   Flags: TEAMMATCH_V1 (master), TEAMMATCH_FEED_LEN.
   Audit: CBZ.teammatchAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});

  CBZ.CONFIG = CBZ.CONFIG || {};
  const C = CBZ.CONFIG;
  if (C.TEAMMATCH_V1 == null) C.TEAMMATCH_V1 = true;
  if (C.TEAMMATCH_FEED_LEN == null) C.TEAMMATCH_FEED_LEN = 40;
  if (C.TEAMMATCH_V1 === false) return;

  const tm = (CBZ.teammatch = CBZ.teammatch || {});
  tm.live = [];

  function fmtClock(s) {
    s = Math.max(0, Math.ceil(s));
    const m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
  }
  tm.formatClock = fmtClock;

  tm.create = function (opts) {
    opts = opts || {};
    const teams = (opts.teams || []).map(function (t, i) {
      return {
        id: t.id || ("team" + i), name: t.name || ("TEAM " + (i + 1)),
        color: t.color != null ? t.color : (i === 0 ? 0xff6a3d : 0x49c6ff),
        index: i,
      };
    });
    if (teams.length < 2) throw new Error("teammatch: two teams minimum");

    const roles = opts.roles && opts.roles.length ? opts.roles.slice() : ["attack", "defend"];
    const HALVES = Math.max(1, opts.halves || roles.length);
    const HALF_SECS = opts.halfSeconds != null ? opts.halfSeconds : 600;
    const INTERMISSION = opts.intermissionSeconds != null ? opts.intermissionSeconds : 8;

    const m = {
      teams: teams,
      roles: roles,
      halves: HALVES,
      halfSeconds: HALF_SECS,
      half: 0,
      phase: "pregame",          // pregame · live · intermission · over
      timeLeft: HALF_SECS,
      intermissionLeft: 0,
      elapsed: 0,
      players: [],
      feed: [],
      score: {},
      result: null,
      opts: opts,
    };
    teams.forEach(function (t) { m.score[t.id] = new Array(HALVES).fill(0); });

    // ---- roles: team i takes roles[(i + half) % roles.length]. That single
    //      expression is the whole swap, and it generalises past two teams.
    m.roleOf = function (teamId, half) {
      const t = m.team(teamId);
      if (!t) return null;
      const h = half != null ? half : m.half;
      return roles[(t.index + h) % roles.length];
    };
    m.teamsWithRole = function (role, half) {
      return teams.filter(function (t) { return m.roleOf(t.id, half) === role; });
    };
    m.team = function (id) {
      for (let i = 0; i < teams.length; i++) if (teams[i].id === id) return teams[i];
      return null;
    };
    m.enemyOf = function (teamId) {
      for (let i = 0; i < teams.length; i++) if (teams[i].id !== teamId) return teams[i];
      return null;
    };

    // ---- roster
    m.addPlayer = function (p) {
      const rec = {
        id: p.id || ("p" + m.players.length),
        name: p.name || ("UNIT " + (m.players.length + 1)),
        team: p.team,
        human: !!p.human,
        alive: p.alive !== false,
        hp: p.hp != null ? p.hp : 100,
        maxHp: p.hp != null ? p.hp : 100,
        kills: 0, deaths: 0, points: 0,
        respawnIn: 0,
        ref: p.ref || null,          // whatever body the mode owns
      };
      m.players.push(rec);
      return rec;
    };
    m.player = function (id) {
      for (let i = 0; i < m.players.length; i++) if (m.players[i].id === id) return m.players[i];
      return null;
    };
    m.roster = function (teamId) {
      return m.players.filter(function (p) { return p.team === teamId; });
    };
    m.alive = function (teamId) {
      return m.players.filter(function (p) { return p.alive && (!teamId || p.team === teamId); });
    };
    m.aliveCount = function (teamId) { return m.alive(teamId).length; };
    m.human = function () {
      for (let i = 0; i < m.players.length; i++) if (m.players[i].human) return m.players[i];
      return null;
    };

    // ---- score (per team, PER HALF — see header)
    m.addScore = function (teamId, n, reason) {
      if (!m.score[teamId] || m.phase !== "live") return 0;
      m.score[teamId][m.half] += n;
      if (reason && opts.onScore) { try { opts.onScore(teamId, n, reason, m); } catch (e) { console.error("[teammatch onScore]", e); } }
      return m.score[teamId][m.half];
    };
    m.halfScore = function (teamId, half) {
      const a = m.score[teamId];
      return a ? a[half != null ? half : m.half] : 0;
    };
    m.total = function (teamId) {
      const a = m.score[teamId];
      if (!a) return 0;
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i];
      return s;
    };
    m.standings = function () {
      return teams.map(function (t) {
        return {
          id: t.id, name: t.name, color: t.color,
          total: m.total(t.id), halves: m.score[t.id].slice(),
          role: m.roleOf(t.id), alive: m.aliveCount(t.id),
        };
      }).sort(function (a, b) { return b.total - a.total; });
    };

    // ---- the feed (see header: forwards to the ONE death bus when present)
    m.log = function (text, o) {
      o = o || {};
      m.feed.unshift({ text: text, t: m.elapsed, tone: o.tone || "info", team: o.team || null });
      if (m.feed.length > C.TEAMMATCH_FEED_LEN) m.feed.length = C.TEAMMATCH_FEED_LEN;
      if (opts.onLog) { try { opts.onLog(text, o, m); } catch (e) {} }
      return text;
    };

    // ---- kill: the one call a mode makes when a body stops
    m.kill = function (victim, killer, cause) {
      const v = typeof victim === "string" ? m.player(victim) : victim;
      if (!v || !v.alive) return null;
      v.alive = false;
      v.hp = 0;
      v.deaths++;
      v.respawnIn = opts.respawnSeconds != null ? opts.respawnSeconds : 0;
      const k = typeof killer === "string" ? m.player(killer) : killer;
      if (k && k !== v) k.kills++;
      const line = (k ? k.name : (cause || "THE WORLD")) + " → " + v.name;
      m.log(line, { tone: "kill", team: k ? k.team : null });
      if (CBZ.cityKillFeed && opts.useCityFeed !== false) {
        try { CBZ.cityKillFeed(k ? k.name : (cause || ""), v.name, cause || "ordnance"); } catch (e) {}
      }
      if (opts.onKill) { try { opts.onKill(v, k, cause, m); } catch (e) { console.error("[teammatch onKill]", e); } }
      return v;
    };
    m.revive = function (p, hp) {
      p.alive = true;
      p.hp = hp != null ? hp : p.maxHp;
      p.respawnIn = 0;
      if (opts.onRespawn) { try { opts.onRespawn(p, m); } catch (e) { console.error("[teammatch onRespawn]", e); } }
      return p;
    };

    // ---- the clock
    m.start = function () {
      if (m.phase !== "pregame") return m;
      m.half = 0;
      m.phase = "live";
      m.timeLeft = HALF_SECS;
      beginHalf();
      return m;
    };
    function beginHalf() {
      m.log("HALF " + (m.half + 1) + " · " + teams.map(function (t) {
        return t.name + " " + String(m.roleOf(t.id)).toUpperCase();
      }).join(" · "), { tone: "phase" });
      if (opts.onHalfStart) { try { opts.onHalfStart(m.half, m); } catch (e) { console.error("[teammatch onHalfStart]", e); } }
    }
    m.endHalf = function () {
      if (m.phase !== "live") return;
      if (opts.onHalfEnd) { try { opts.onHalfEnd(m.half, m); } catch (e) { console.error("[teammatch onHalfEnd]", e); } }
      if (m.half + 1 >= HALVES) return finish();
      m.phase = "intermission";
      m.intermissionLeft = INTERMISSION;
      m.log("HALF " + (m.half + 1) + " OVER · SIDES SWAP", { tone: "phase" });
    };
    function finish() {
      m.phase = "over";
      const s = m.standings();
      const draw = s.length > 1 && s[0].total === s[1].total;
      m.result = {
        winner: draw ? null : s[0],
        draw: draw,
        standings: s,
        // the "why" line the header promises
        summary: teams.map(function (t) {
          return t.name + " " + m.score[t.id].map(function (n, i) {
            return Math.round(n) + " (" + String(m.roleOf(t.id, i)).toUpperCase() + ")";
          }).join(" + ") + " = " + Math.round(m.total(t.id));
        }).join("   |   "),
      };
      m.log(draw ? "DRAW" : (s[0].name + " WINS"), { tone: "phase" });
      if (opts.onEnd) { try { opts.onEnd(m.result, m); } catch (e) { console.error("[teammatch onEnd]", e); } }
    }
    m.abort = function () { if (m.phase !== "over") { m.phase = "over"; m.result = { aborted: true, standings: m.standings() }; } };

    m.step = function (dt) {
      if (!(dt > 0)) return;
      m.elapsed += dt;
      if (m.phase === "live") {
        m.timeLeft -= dt;
        // respawn countdowns are the framework's, because every mode has them
        for (let i = 0; i < m.players.length; i++) {
          const p = m.players[i];
          if (p.alive || p.respawnIn <= 0) continue;
          p.respawnIn -= dt;
          if (p.respawnIn <= 0) m.revive(p);
        }
        if (opts.onTick) { try { opts.onTick(dt, m); } catch (e) { console.error("[teammatch onTick]", e); } }
        if (m.timeLeft <= 0) { m.timeLeft = 0; m.endHalf(); }
      } else if (m.phase === "intermission") {
        m.intermissionLeft -= dt;
        if (m.intermissionLeft <= 0) {
          m.half++;
          m.phase = "live";
          m.timeLeft = HALF_SECS;
          beginHalf();
        }
      }
    };

    m.clock = function () { return fmtClock(m.phase === "intermission" ? m.intermissionLeft : m.timeLeft); };
    m.progress = function () { return 1 - m.timeLeft / HALF_SECS; };

    tm.live.push(m);
    if (CBZ.micro && CBZ.micro.onFrame && opts.autoStep !== false) {
      CBZ.micro.onFrame(function (dt) { m.step(dt); }, { id: "teammatch", order: -50 });
    }
    return m;
  };

  CBZ.teammatchAudit = function () {
    return tm.live.map(function (m) {
      return {
        phase: m.phase, half: m.half + 1, of: m.halves, clock: m.clock(),
        players: m.players.length, alive: m.aliveCount(),
        standings: m.standings().map(function (s) { return s.name + " " + Math.round(s.total); }),
      };
    });
  };
})();
