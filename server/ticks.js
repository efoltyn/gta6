// server/ticks.js — the SERVER's offline world-clock (BUILD-PLAN.md Stage S,
// step S4). Zero dependencies.
//
// WHY: S1-S3 gave the server real tables, but the world's slow daily loops
// (worldDay, base upkeep/decay, econ drift, approval, elections, bonds)
// still only ever advance INSIDE a connected client's own onAlways/onUpdate
// ticks (city/polity.js's worldDay wrap, systems/baseclaim.js's decayTick,
// sim/econstate.js's hourTick, city/approval.js's convergence tick,
// city/elections.js's tickOffice, sim/bonds.js's dailyTick). The instant the
// last player disconnects, every one of those freezes mid-frame — a server
// left running alone for a week is a week frozen in amber, not a world that
// "kept living" the way MASTER-PLAN Part VII's mandate wants. This file is
// the COARSE, OFFLINE-ONLY approximation of those loops: it runs ONLY when
// zero clients are connected (server.js's own guard — this file never even
// SEES a live connection), advances a bounded number of whole in-game days
// against the S1-S4 tables, and is ALWAYS superseded the instant a real
// client connects and starts ticking its own full client-side sim again
// (see "MIRROR, NOT AUTHORITY" below).
//
// ============================================================
// SCOPE — the five clocks BUILD-PLAN.md S4 named, and what each one does
// here (ticked in full, or marked due for the next connecting client):
//
//   1. worldDay — TICKED. The one counter every onNewDay system keys off
//      (city/polity.js). Advanced by exactly one per simulated offline day.
//
//   2. base upkeep/decay — TICKED, against the S3 `structures`/`bases`
//      tables, using systems/baseclaim.js's OWN decayTick constants and
//      cascade rule (DECAY_PER_MIN, DECAY_RUIN_MULT, "founding cupboard
//      dies -> whole base becomes a ruin, ruin self-GCs once empty") — see
//      DECAY below for the one deliberate adaptation (playClock's meaning).
//
//   3. econ drift — TICKED, but SIMPLIFIED per the task brief's own
//      instruction ("mean-revert toward neutral", not a full replay of
//      sim/econstate.js's dailySettlement). See ECON below for exactly
//      which inputs are live vs. structurally unavailable server-side.
//
//   4. political clocks — approval TICKED (simplified target, see
//      APPROVAL below); elections MARKED DUE, not resolved — see
//      ELECTIONS below for why and how "due" is signaled.
//
//   5. bonds — NOT TICKED AT ALL this wave. See BONDS (not ticked) below
//      for why: every implementation lets the server either double-pay,
//      silently drop, or fabricate money it can't back with real state.
//
// ============================================================
// TIME BASE — one offline "day" = core/daynight.js's own CYCLE (150 real
// seconds = one full in-game day while a client plays). That is ALSO the
// constant every sim/*.js file's own `HOUR = 150/24` derives from (grep
// "150 / 24" across src/sim, src/city — market.js, econstate.js, npcecon.js,
// hunger.js, corporations.js, stocks.js, approval.js all match it exactly).
// Reusing it here means the offline tick's daily econ/approval/election
// cadence lines up with the SAME "one day" a connected client's own onNewDay
// wrap means — not a new, invented offline-time unit.
//
// This intentionally does NOT mean "one real 150 seconds of wall-clock
// server uptime = one game day, always" in the sense of a literal 1:1 empty-
// server clock (a server idle for a real weekend would rack up ~1150 days
// at that rate) — BUILD-PLAN.md's own brief explicitly wants the compressed
// "days pass, elections happen, economies drift" experience for a returning
// player, and explicitly asks for a CAP (below) precisely because empty-
// server wall time is expected to translate into many simulated days, not
// a handful. The cap is what keeps that honest instead of unbounded.
//
// OFFLINE_DAY_CAP = 30: a server that was off/idle for longer than 30
// simulated days' worth of wall time only ever advances 30 days per tick
// invocation (boot, or the periodic interval) — "a month away doesn't grind
// boot" (BUILD-PLAN.md's own phrasing). The REMAINDER is not discarded: the
// tick only advances `lastTickAt` by the days it actually applied (see
// runOfflineTick below), so a longer catch-up simply continues across the
// next boot/interval invocation(s) instead of losing time outright.
//
// ============================================================
// NO DOUBLE-ADVANCE: worldmeta's `lastTickAt` is the single fulcrum.
// server.js's extraction path (extractWorldMetaFromWorld) re-stamps it to
// Date.now() on EVERY real client wsave — a connected client is already
// advancing worldDay/approval/econ/etc. itself in real time, so the instant
// it saves, the "how much wall time is unaccounted for" clock resets to
// zero. The offline tick only ever sees wall time that elapsed while
// `players.size === 0` (server.js's own guard around calling this file at
// all) — by construction, the two clocks (live client ticks vs. this file's
// offline ticks) never both advance the same stretch of time.
//
// ============================================================
// MIRROR, NOT AUTHORITY: econ/polity ride city/polity.js's/sim/econstate.js's
// OWN full riders (blob.pol/blob.econ) inline in the stored world blob,
// exactly as before S2-S4 (never stripped the way people/structures/bases
// were) — the `econ`/`polity` SQL tables added here are a QUERYABLE MIRROR
// of that same data, kept in sync in both directions: server.js's
// extraction mirrors the blob INTO the tables on every real wsave, and this
// file's tick mutates BOTH the tables AND the still-inline blob fields
// directly (so a reconnecting client's existing applyWorld() needs zero new
// code — it already applies whatever blob.pol/blob.econ says). This is the
// documented "mirror, not strip-and-reassemble" choice BUILD-PLAN.md S4
// asks each implementer to justify: mirroring is simpler and safer THIS
// wave because blob.pol/blob.econ interleave fields this file doesn't touch
// (treasury, taxRate, currencyId, piYest, ...) that must round-trip
// byte-identical — stripping-and-reassembling those riders the way S2/S3
// did for people/structures/bases would mean re-deriving every untouched
// field here too, for no benefit (unlike people/structures/bases, nothing
// about econ/polity's shape is capped or slow to query as an inline blob at
// this wave's data size).
//
// ============================================================
// BASE DECAY — ONE deliberate spec adaptation, documented per the task's own
// "if not trivially reproducible, adapt and document" instruction:
// systems/baseclaim.js's own header is explicit that `playClock` (the
// decay clock's time base) is DELIBERATELY not wall-clock time — "a solo
// player who closes the tab for a week shouldn't come back to a demolished
// base just because real-world time passed while nobody was even looking
// at the screen." That principle is about a SINGLE-PLAYER session pausing;
// it predates this wave's persistent MULTIPLAYER world, where MASTER-PLAN
// Part VII's whole mandate is the opposite — an unattended base SHOULD be
// able to rot while its owner is away, the same way the rest of the world
// keeps moving. This file resolves the tension by advancing the SAME
// playClock accumulator (still the one global scalar riding in blob.base's
// un-extracted remainder, per S3's own comment) by one DAY_SEC per
// simulated offline day, then applies decayTick's EXACT math
// (DECAY_PER_MIN, DECAY_RUIN_MULT, the upkeepUntil comparison, the
// founding-cupboard-death-dissolves-the-base cascade) against it — nothing
// about the decay RATE or RULE changes, only the offline clock's own
// source. A single-player-only host who never touches the multiplayer
// server never encounters this at all (playClock there is a purely local,
// still-wall-clock-immune accumulator) — single-player is untouched.
//
// One further schema-driven adaptation: systems/baseclaim.js's own
// `piecesNear(cx,cz,radius)` re-derives a PER-BASE radius membership test
// live off CBZ.pieces; this file instead groups a LIVE base's pieces via
// the S3 `structures.baseId` column (the identity S3's own extraction
// already computed via `coveringBase` — the nearest base whose radius
// covers each piece's position at save time), and a RUIN's pieces via a
// literal (x,z,radius) distance filter over `structAll()` (ruins have no
// baseId column value to key off — see S3's own header: only LIVE bases
// ever populate a piece's baseId). Both are the same radius-membership
// test piecesNear performs, just sourced from the table identity S3 already
// established instead of re-walking geometry from scratch.
//
// ============================================================
// ECON — sim/econstate.js's own header says this wave ships exactly ONE
// real jurisdiction ("libertyville") — server.js's extraction mirror never
// sees any other id in blob.econ.reg, so this file only ever ticks that
// one row. Its FULL dailySettlement equation (wagesProxy from
// w.economy.confidence, safety from g.heat, employment from
// CBZ.cityPopulation()) is NOT reproduced — none of those three inputs
// exist in ANY worldBlob rider (netpersist.js's own worldBlob() never
// serializes w.economy/g.heat/population census; they either live in the
// PER-PLAYER charBlob's `ledger` copy or aren't persisted at all) — a hard
// data-availability wall, not a shortcut. Per the task brief's own
// instruction ("mean-revert toward neutral, simplified"), activity and
// employment instead lerp toward their day-one equilibrium values
// (ACTIVITY_NEUTRAL=1.0, EMPLOYMENT_NEUTRAL=0.92, econstate.js's own
// seed/EMPLOYMENT_BASE) by SETTLE_LERP per day — same lerp FACTOR
// econstate.js's own dailySettlement uses, aimed at the neutral point
// instead of a live-computed target. priceIndex compounds at the STORED,
// FROZEN π (mirrored in from sim/inflation.js's own per-country rider at
// extraction time — see the id-bridge below) via
// `priceIndex *= (1 + pi/365)` — sim/inflation.js's OWN "level" compounding
// formula, applied directly. This is not an approximation: econstate.js's
// hourTick computes `priceIndex = baseIdx(category CPI) * inflationLevel`;
// baseIdx is frozen (nothing recomputes market.js's category prices with
// no client connected), so priceIndex(t+1) = baseIdx * level(t+1) =
// baseIdx * level(t) * (1+pi/365) = priceIndex(t) * (1+pi/365) EXACTLY,
// under a frozen baseIdx — which offline necessarily is.
//
// ID-SPACE BRIDGE: sim/inflation.js keys its own state by COUNTRY id
// ("republic"), not econstate.js's jurisdiction id ("libertyville") — that
// file's own capIdFor("republic") hardcodes libertyville as the republic's
// capital/economy; ECON_COUNTRY_OF mirrors that one hardcoded pairing
// server-side (the only pairing that exists this wave, per econstate.js's
// own single-jurisdiction scope above).
//
// ============================================================
// APPROVAL — city/approval.js's real target is FIVE inputs (econ, crime,
// services, events, propaganda) plus an inflation term. Of those, only
// econ (via the econ mirror above) and inflation (via the same π mirror)
// have ANY server-side data to read: crime needs g.heat/gang warIntensity/
// a murder ring (none persisted anywhere), services needs
// systems/hunger.js's miseryIndex() (a LIVE computed number, not persisted),
// events needs the shock accumulator (city/approval.js's OWN header
// admits blob.apr — the rider that would carry it — was never actually
// wired into net/netpersist.js, multiplayer-only gap, not this file's to
// fix), propaganda needs w.politics.support (charBlob-only, per-player,
// per ECON's own note above). Per the task brief's own "inputs frozen"
// phrasing, those four terms are frozen at their NEUTRAL contribution
// (exactly 0 — which is also their literal day-one value before anything
// has happened) while econ+inflation keep moving. The convergence itself
// uses the EXACT closed-form solution of approval.js's own ODE
// (dA/dt = (target-A)/tau, tau=90s) over one simulated day (DAY_SEC=150s)
// instead of replaying ~150 per-second Euler steps — same equation, exact
// integral instead of a step-by-step replay, immune to Euler overshoot at
// this dt/tau ratio (150/90 > 1).
//
// ============================================================
// ELECTIONS — MARKED DUE, not resolved. city/elections.js's tally() needs
// voter blocs built from sim/npcecon.js's cohort table, turf.js's zone
// ownership, and gang data — none of it persisted in any worldBlob rider
// (elections.js's own in-progress-campaign state, blob.elc, is ALSO
// multiplayer-unwired — grep confirms it only rides the single-player
// g.cityWorld ledger, never net/netpersist.js — so the server has no
// visibility into an active campaign even in principle). Reproducing the
// scoring server-side would mean inventing voter data the client itself
// doesn't expose over the wire — not "simplified", fabricated. Instead:
// when a NON-monarchy office's `office.termDay` has already passed (the
// exact-equality trigger `day === termDay-CAMPAIGN_DAYS` elections.js's
// own tickOffice() relies on would otherwise be skipped forever once
// worldDay jumps past it in one offline batch — a real bug this avoids),
// this file re-arms `office.termDay = worldDay + 1 + CAMPAIGN_DAYS` — the
// EXISTING field, EXISTING semantics, no new wire shape. The very next
// in-game day boundary a reconnecting client's own CBZ.onNewDay fires
// (worldDay+1, the first tick after reconnect) lands EXACTLY on
// `termDay - CAMPAIGN_DAYS`, so tickOffice() calls a real election through
// its own normal (non-snap) cycle, with real candidates/blocs computed
// live, client-side, from live data — this file only ever re-arms the
// clock, it never fabricates a winner. Marked (and logged) at most ONCE
// per offline batch per office (a `markedElection` set, reset per
// runOfflineTick call) — re-arming the same office repeatedly within one
// long offline batch would read as a cascade of fake elections nobody
// witnessed; one mark, then hands off entirely to the next real client.
//
// ============================================================
// BONDS — NOT TICKED. sim/bonds.js's daily coupon/maturity/default/roll
// pass pays real holders: NPC sids (server DOES have a `people` table this
// could debit/credit), the player (whose cash lives in the PER-CONNECTION
// charBlob, invisible while offline), and corporations (sim/corporations.js
// has no server-side table at all this wave). A partial tick — servicing
// only the NPC-held slice — would silently skip the player's and every
// corp's coupon on the very days they're actually owed one, which is worse
// than not ticking at all (a missed payment is indistinguishable from a
// stolen one from the holder's side). Printing decisions additionally gate
// on sim/centralbank.js's independence state, also not mirrored server-
// side. Per the task brief's own "pick per implementability" allowance:
// blob.bond is left COMPLETELY untouched (no bondseries table this wave) —
// series/coupons/maturities stay frozen at their last real value until a
// client reconnects and its own sim/bonds.js dailyTick catches up for real,
// one day at a time, from wherever they were left. This is the "mark-due"
// choice taken to its safest extreme: defer entirely, touch nothing.
"use strict";

// core/daynight.js's own CYCLE (one full in-game day, in real seconds) —
// see TIME BASE above for why this file reuses it as the offline-day unit.
const DAY_SEC = 150;
const DAY_MS = DAY_SEC * 1000;
const OFFLINE_DAY_CAP = 30; // BUILD-PLAN.md S4's own cap ("a month away doesn't grind boot")

// ---- systems/baseclaim.js B8 mirrors (server/server.js's own
// PIECE_CELL/PIECE_WALL_H precedent for "mirror a small, effectively-frozen
// client constant rather than require() a DOM-coupled file") ----
const DECAY_PER_MIN = 0.01;   // baseclaim.js's own DECAY_PER_MIN
const DECAY_RUIN_MULT = 2;    // baseclaim.js's own DECAY_RUIN_MULT
const PIECE_MAXHP = 250;      // systems/building.js's own HP const — flat, wood-tier-only this wave

// ---- city/approval.js mirrors ----
const APPROVAL_TAU = 90;              // V.3's own convergence time constant (seconds)
const INFLATION_COEF = 120;           // approval.js's own M4 calibration
const INFLATION_THRESHOLD = 0.05;
const APPROVAL_NEUTRAL = 50;          // approval.js's own target-formula constant term

// ---- sim/econstate.js mirrors ----
const ACTIVITY_NEUTRAL = 1.0;
const EMPLOYMENT_NEUTRAL = 0.92;      // econstate.js's own EMPLOYMENT_BASE
const SETTLE_LERP = 0.15;             // econstate.js's own SETTLE_LERP

// ---- city/elections.js mirrors ----
const CAMPAIGN_DAYS = 2;              // elections.js's own CAMPAIGN_DAYS

// sim/inflation.js's own capIdFor("republic") hardcode, mirrored server-side
// (see ECON header above) — the only econ-id <-> country-id pairing that
// exists this wave.
const ECON_COUNTRY_OF = { libertyville: "republic" };

function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

// computeElapsedDays: pure, exported for the harness. Given the last time a
// tick actually ran and "now", how many whole offline days are available,
// and how many this invocation will actually apply (capped).
function computeElapsedDays(lastTickAt, now, cap) {
  if (!isFinite(lastTickAt)) return { daysAvail: 0, daysToApply: 0 };
  const elapsedMs = now - lastTickAt;
  if (elapsedMs <= 0) return { daysAvail: 0, daysToApply: 0 };
  const daysAvail = Math.floor(elapsedMs / DAY_MS);
  const daysToApply = Math.max(0, Math.min(daysAvail, cap == null ? OFFLINE_DAY_CAP : cap));
  return { daysAvail, daysToApply };
}

// approvalStepExp: the exact solution of dA/dt = (target-A)/tau over dtSec
// with target held fixed across the interval — city/approval.js's own
// per-second Euler update integrates to precisely this closed form (see
// APPROVAL above for why the closed form is used instead of replaying
// per-second steps).
function approvalStepExp(approval, target, dtSec, tau) {
  const decay = Math.exp(-dtSec / tau);
  return target + (approval - target) * decay;
}

// approvalTarget: the simplified target for one polity id — see APPROVAL
// above for exactly which of the real equation's inputs are live vs frozen
// at neutral. `econRow` is the econ table row for "libertyville" (or null).
function approvalTarget(polityId, econRow) {
  let econTerm = 0, inflationTerm = 0;
  if (polityId === "libertyville" && econRow) {
    const a = clampNum(-1, 1, (econRow.activity - 1) * 4);
    // the confidence sub-term (0.3*b in approval.js's own econInput) is
    // frozen at 0 — w.economy.confidence lives only in the per-player
    // charBlob, never the world blob (see APPROVAL above).
    econTerm = 0.5 * a - 0.2 * (1 - econRow.employment);
  }
  const country = ECON_COUNTRY_OF[polityId] || (polityId === "republic" ? "republic" : null);
  if (country && econRow && isFinite(econRow.pi)) {
    inflationTerm = -INFLATION_COEF * Math.max(0, econRow.pi - INFLATION_THRESHOLD);
  }
  return clampNum(2, 98, APPROVAL_NEUTRAL + 22 * econTerm + inflationTerm);
}

// pieceDrainedHp: the hp a piece has left after one offline day's decay at
// `mult`x the normal rate (1x for a live overdue base, DECAY_RUIN_MULT for
// a ruin) — systems/baseclaim.js's own decayTick fraction, applied once per
// simulated day instead of once per real dt-sized frame.
function pieceDrainedHp(hp, mult) {
  const frac = DECAY_PER_MIN * (DAY_SEC / 60) * mult;
  return hp - PIECE_MAXHP * frac;
}

function nowStamp() { return Date.now(); }

// decayLiveBase: one overdue (non-ruin) BaseRecord, one simulated day. Mirrors
// systems/baseclaim.js's decayTick's per-base branch: every piece under the
// base (S3's own `structures.baseId` grouping — see BASE DECAY above) loses
// one day's worth of maxHp; a piece at/under 0 hp is destroyed for real
// (structDelete, FK-cascades its container); if that piece IS the base's
// founding cupboard (data.cupboardId, baseclaim.js's own onRemove rule), the
// whole base dissolves into a ruin (reusing the SAME baseId, matching
// onRemove's `ruins.set(rec.id, ...)`).
function decayLiveBase(db, b, playClock, summary) {
  if (!(playClock > (b.upkeepUntil || 0))) return; // paid up / still in grace — decayTick's own guard, mirrored
  summary.basesDecayed++;
  const cupboardId = b.data && b.data.cupboardId;
  const pieces = db.structByBase(b.baseId);
  let ruined = false;
  for (const p of pieces) {
    const newHp = pieceDrainedHp(p.hp, 1);
    if (newHp <= 0) {
      db.structDelete(p.pieceId);
      summary.piecesDestroyed++;
      if (!ruined && cupboardId && p.pieceId === cupboardId) {
        db.baseDelete(b.baseId);
        db.basePut([{
          baseId: b.baseId, ownerId: null, x: b.x, z: b.z, radius: b.radius,
          upkeepUntil: 0, ruin: true, authorized: [],
          data: { ruin: true, cx: b.x, cz: b.z, radius: b.radius },
          updatedAt: nowStamp(),
        }]);
        summary.basesRuined++;
        ruined = true;
      }
    } else {
      db.structPut([{
        pieceId: p.pieceId, baseId: p.baseId, kind: p.kind, x: p.x, y: p.y, z: p.z,
        rot: p.rot, hp: newHp, material: p.material,
        data: Object.assign({}, p.data, { hp: newHp }), updatedAt: nowStamp(),
      }]);
    }
  }
}

// decayRuin: a cupboardless ruin, always overdue (matches decayTick's own
// `ruins.forEach`, always-2x rule) — pieces found by a literal (x,z,radius)
// distance filter (ruins carry no baseId link on any structures row — see
// BASE DECAY above). Self-GCs (baseDelete) once nothing is left, mirroring
// `ruins.delete(id)` on an empty piecesNear result.
function decayRuin(db, b, summary) {
  const r2 = b.radius * b.radius;
  const pieces = db.structAll().filter((p) => {
    const dx = p.x - b.x, dz = p.z - b.z;
    return dx * dx + dz * dz <= r2;
  });
  if (!pieces.length) { db.baseDelete(b.baseId); return; }
  for (const p of pieces) {
    const newHp = pieceDrainedHp(p.hp, DECAY_RUIN_MULT);
    if (newHp <= 0) {
      db.structDelete(p.pieceId);
      summary.piecesDestroyed++;
    } else {
      db.structPut([{
        pieceId: p.pieceId, baseId: p.baseId, kind: p.kind, x: p.x, y: p.y, z: p.z,
        rot: p.rot, hp: newHp, material: p.material,
        data: Object.assign({}, p.data, { hp: newHp }), updatedAt: nowStamp(),
      }]);
    }
  }
}

function tickBaseDecay(db, playClock, summary) {
  const bases = db.baseAll();
  for (const b of bases) {
    if (b.ruin) decayRuin(db, b, summary);
    else decayLiveBase(db, b, playClock, summary);
  }
}

// tickEcon: one simulated day, the one tracked jurisdiction ("libertyville",
// see ECON above). No-op if nothing has ever been saved into the econ table
// yet (a brand new world with no client having ever connected).
function tickEcon(db, w) {
  const row = db.econGet("libertyville");
  if (!row) return;
  const activity = row.activity + (ACTIVITY_NEUTRAL - row.activity) * SETTLE_LERP;
  const employment = row.employment + (EMPLOYMENT_NEUTRAL - row.employment) * SETTLE_LERP;
  const pi = isFinite(row.pi) ? row.pi : 0.02;
  const priceIndex = row.priceIndex * (1 + pi / 365);
  const data = Object.assign({}, row.data, { activity, employment, priceIndex });
  db.econPut([{ countryId: row.countryId, activity, employment, priceIndex, pi, treasury: row.treasury, data, updatedAt: nowStamp() }]);
  // mirror into the still-inline blob.econ rider — see MIRROR NOT AUTHORITY above.
  if (w.econ && w.econ.reg && w.econ.reg[row.countryId]) {
    Object.assign(w.econ.reg[row.countryId], { activity, employment, priceIndex });
  }
}

// tickPolityApproval: one simulated day, every mirrored polity row.
function tickPolityApproval(db, w, econRow) {
  const rows = db.polityAll();
  for (const row of rows) {
    const target = approvalTarget(row.id, econRow);
    const approval = approvalStepExp(row.approval, target, DAY_SEC, APPROVAL_TAU);
    const data = Object.assign({}, row.data, { approval });
    db.polityPut([{ id: row.id, kind: row.kind, govType: row.govType, approval, termDay: row.termDay, officeHolder: row.officeHolder, data, updatedAt: nowStamp() }]);
    if (w.pol && w.pol.rec && w.pol.rec[row.id]) w.pol.rec[row.id].approval = approval;
  }
}

// tickElections: mark-due pass — see ELECTIONS above. `markedElection` is a
// Set the CALLER owns across the whole offline batch (reset once per
// runOfflineTick call, not once per simulated day) so a long batch marks
// each overdue office at most once.
function tickElections(db, w, worldDay, markedElection, summary) {
  const rows = db.polityAll();
  for (const row of rows) {
    if (row.govType === "monarchy") continue;
    if (markedElection.has(row.id)) continue;
    if (row.termDay == null || !(row.termDay <= worldDay)) continue;
    const newTermDay = worldDay + 1 + CAMPAIGN_DAYS;
    markedElection.add(row.id);
    const prevOffice = (row.data && row.data.office) || {};
    const data = Object.assign({}, row.data, { office: Object.assign({}, prevOffice, { termDay: newTermDay }) });
    db.polityPut([{ id: row.id, kind: row.kind, govType: row.govType, approval: row.approval, termDay: newTermDay, officeHolder: row.officeHolder, data, updatedAt: nowStamp() }]);
    if (w.pol && w.pol.rec && w.pol.rec[row.id]) {
      const rec = w.pol.rec[row.id];
      rec.office = rec.office || {};
      rec.office.termDay = newTermDay;
    }
    summary.electionsDue.push(row.id);
  }
}

// runOfflineTick(db, worldContainer, opts) — the entry point server.js
// calls on boot and on its own periodic interval, ONLY when zero clients
// are connected (that guard lives in server.js, not here — this file has no
// idea a player roster even exists). `worldContainer` is server.js's own
// `world` object ({v,name,savedAt,world,chars}) — mutated in place (its
// `.world.pol`/`.world.econ`/`.world.base` sub-fields) so the caller's
// existing flush path picks up the advanced state with no extra plumbing.
// Returns null if there's nothing to do (no db, freshly-seeded meta, or not
// a full offline day has elapsed yet); otherwise a summary object.
function runOfflineTick(db, worldContainer, opts) {
  if (!db) return null;
  opts = opts || {};
  const now = isFinite(opts.now) ? opts.now : Date.now();
  const log = typeof opts.log === "function" ? opts.log : function () {};
  const cap = isFinite(opts.cap) ? opts.cap : OFFLINE_DAY_CAP;

  const w = (worldContainer && worldContainer.world) || {};

  let meta = db.metaGet("world");
  if (!meta) {
    // First v4 boot against this DB: seed the clock but DON'T tick — there
    // is no valid "before" reference yet, so any elapsed-time computation
    // here would be arbitrary (see NO DOUBLE-ADVANCE above).
    const day0 = (w.pol && isFinite(w.pol.day)) ? w.pol.day : 0;
    meta = { worldDay: day0, lastTickAt: now, tickLog: [] };
    db.metaSet("world", meta);
    return { ranDays: 0, seeded: true };
  }

  const { daysToApply } = computeElapsedDays(meta.lastTickAt, now, cap);
  if (daysToApply <= 0) return { ranDays: 0 };

  let worldDay = isFinite(meta.worldDay) ? meta.worldDay : 0;
  if (w.pol && isFinite(w.pol.day) && w.pol.day > worldDay) worldDay = w.pol.day; // defensive floor only
  let playClock = (w.base && isFinite(w.base.playClock)) ? w.base.playClock : 0;

  const summary = { basesDecayed: 0, piecesDestroyed: 0, basesRuined: 0, electionsDue: [] };
  const markedElection = new Set();

  for (let d = 0; d < daysToApply; d++) {
    worldDay++;
    playClock += DAY_SEC;

    tickBaseDecay(db, playClock, summary);
    tickEcon(db, w);
    const econRow = db.econGet("libertyville");
    tickPolityApproval(db, w, econRow);
    tickElections(db, w, worldDay, markedElection, summary);
  }

  // mirror worldDay/playClock into the still-inline blob riders (see MIRROR
  // NOT AUTHORITY above) — bases/structures need no such mirror, S3's own
  // assembleStructuresForWire/assembleBasesForWire already rebuild the wire
  // shape fresh from these same tables every wload.
  if (w.pol) w.pol.day = worldDay;
  if (w.base) w.base.playClock = playClock;

  meta.worldDay = worldDay;
  // bank exactly the consumed days, not "now" — a longer backlog than `cap`
  // continues on the NEXT boot/interval invocation instead of being
  // silently discarded (see OFFLINE_DAY_CAP above).
  meta.lastTickAt = meta.lastTickAt + daysToApply * DAY_MS;
  meta.tickLog = (meta.tickLog || []).concat([{ at: now, days: daysToApply, worldDay: worldDay, summary: summary }]).slice(-20);
  db.metaSet("world", meta);

  const line = `advanced ${daysToApply} day(s) (worldDay ${worldDay}): ${summary.basesDecayed} base(s) decayed, ` +
    `${summary.piecesDestroyed} piece(s) destroyed, ${summary.basesRuined} ruined, ${summary.electionsDue.length} election(s) due` +
    (summary.electionsDue.length ? ` (${summary.electionsDue.join(", ")})` : "");
  log(line);

  return Object.assign({ ranDays: daysToApply, worldDay: worldDay, line: line }, summary);
}

module.exports = {
  DAY_SEC,
  DAY_MS,
  OFFLINE_DAY_CAP,
  DECAY_PER_MIN,
  DECAY_RUIN_MULT,
  PIECE_MAXHP,
  APPROVAL_TAU,
  INFLATION_COEF,
  INFLATION_THRESHOLD,
  CAMPAIGN_DAYS,
  ECON_COUNTRY_OF,
  computeElapsedDays,
  approvalStepExp,
  approvalTarget,
  pieceDrainedHp,
  runOfflineTick,
};
