/* ============================================================
   battle/core/series.js — THE MATCH FORMAT. Best of 1, 3, 5 or 7 rounds,
   a round score and a series winner. Page-independent: pure state, no DOM.

   A ROUND is one battle to its end (a side wiped out or broken). A round
   nobody wins (both sides gone in the same instant) is replayed, not
   scored. The series is decided when a side reaches ceil(bo / 2) rounds.

   The host decides how the field is reset between rounds. NPC War reloads
   the page with the series score in the URL (?bo=5&sa=2&sb=1), which is
   the only reset that is clean by construction: corpses, blood decals,
   bullet holes, ragdoll pools, ordnance and every per-war ledger start from
   nothing.

   PUBLIC  CBZ.battleSeries = { make(bo, sa, sb), record(S, winnerSlot),
                                score(S, names) -> text, BEST_OF }
     S = { bo, need, a, b, round, over, winner }    a / b: rounds won by the
     first ("red") and second ("blue") slot
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const BEST_OF = [1, 3, 5, 7];

  function make(bo, sa, sb) {
    bo = parseInt(bo, 10);
    if (BEST_OF.indexOf(bo) < 0) bo = 1;
    const need = Math.ceil(bo / 2);
    const a = Math.max(0, Math.min(need, parseInt(sa, 10) || 0));
    const b = Math.max(0, Math.min(need, parseInt(sb, 10) || 0));
    const over = a >= need || b >= need;
    return { bo: bo, need: need, a: a, b: b, round: a + b + 1, over: over,
      winner: !over ? null : a >= need ? "red" : "blue" };
  }
  // the series after this round: a draw replays the round
  function record(S, won) {
    if (S.over || (won !== "red" && won !== "blue")) return S;
    return make(S.bo, S.a + (won === "red" ? 1 : 0), S.b + (won === "blue" ? 1 : 0));
  }
  // "ROUND 3 OF 5     40 GORILLAS 2, 1 BENGAL TIGER 1" (no dots, no dashes)
  function score(S, names) {
    if (S.bo <= 1) return "";
    const nA = String(names.a).toUpperCase(), nB = String(names.b).toUpperCase();
    return "BEST OF " + S.bo + "     " + nA + " " + S.a + ", " + nB + " " + S.b;
  }
  CBZ.battleSeries = { make: make, record: record, score: score, BEST_OF: BEST_OF };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleSeries;
})();
