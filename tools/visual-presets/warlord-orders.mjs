/* DESERT WARLORD — FOLLOW ME, AND A POINT ON THE SAND.

   THE REPORT (owner, 2026-09-01): "make the fighting and group fighting
   mechanics more realistic and better ux."

   WHAT THE COMMAND LAYER COULD NOT SAY. battle.js had four orders — CHARGE,
   HOLD, FLANK, FALL BACK — and every one of them was measured off the enemy's
   centre of mass or off wherever the line happened to be when the button was
   pressed. There was no way to say WHERE. A warlord who is a man in his own
   firing line (the whole premise of this game) could not bring his line with
   him: he walked, the line held its anchor 60 m behind, and the fight he was
   in was not the fight his army was in. And in the command seat — a camera
   over your own army, built for exactly this — a tap on the sand did nothing.

   AFTER: FOLLOW ME forms the sections on the warlord and keeps them there as
   he moves (a rank behind him, fanned across his front; leash 14 m instead of
   HOLD's 26). MOVE is a tap on the ground in the command seat: the line goes
   to that point and holds it, a ring on the sand marks it, and the same 8 px /
   380 ms press-vs-drag gate campaign.js uses for the ride keeps panning the
   camera from moving the army. Neither is a new AI — out of contact the
   section marches to the point, in contact think() hands back to combat_iq
   exactly as HOLD does.

   THE A/B IS TWO CHECKOUTS (no flag: git is the undo). On the before checkout
   `B.order("follow")` is refused (not in ORDERS) and `B.moveTo` does not exist,
   so both subjects photograph the old army doing what it did: holding its
   anchor while the warlord walks off alone.

     node ~/harness/ba/before-after.mjs warlord-orders \
       --before http://127.0.0.1:8731/ --after http://127.0.0.1:8732/ --no-open

   IT IS A STUDIO. ?frozen=1, the same advance() seam warlord-battle.mjs uses:
   both builds walk the identical simulated seconds. The warlord is moved by
   writing his position through the same seat a tool has — 30 m off to the
   line's flank — so "did the line come with him" is a number (escort: his men
   inside 40 m) rather than an impression.
*/

const subjects = [
  { id: "walk-off", label: "The warlord walks 30 m off the line's flank",
    focus: "THE SETUP, identical on both sides. At t=6 the warlord is 30 m to the flank of his own line, which is holding its spawn anchor. escort — his men inside 40 m — is what the next two frames move.",
    at: 6, walk: true, cam: "you" },
  { id: "follow-me", label: "FOLLOW ME — the line forms on him",
    focus: "AFTER: order 5. Out of contact the sections march to a rank behind the warlord, fanned across his front, and stay there as he moves; in contact they fight from there with a 14 m leash on HIM. BEFORE: the order does not exist, the button is not on the rail, and the line keeps holding an anchor 30 m away from the man it is supposed to be with.",
    at: 22, order: "follow", cam: "you" },
  { id: "move-here", label: "MOVE — a tap on the sand in the command seat",
    focus: "AFTER: a point 45 m left of the line's centre, chosen the way a player chooses it (a press that does not move, in the command camera). The ring marks it, the order readout says MOVE, and the sections go there and hold. BEFORE: no moveTo, no ring, no order — the line is wherever the last order left it.",
    at: 40, move: true, cam: "mark" },
];

async function stageOrders(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.warlord) return { ok: false, err: "no CBZ.warlord" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 200);
    }
    return false;
  };
  let S = window.__warlordStudio;
  if (!S) {
    const ok = await until(() => window.__warlordBattle && window.__warlordBattle.live && window.__warlordBattle.live(), 300000);
    if (!ok) return { ok: false, err: "battle never started" };
    const B = window.__warlordBattle;
    B.freeze();
    S = window.__warlordStudio = { B: B, t: 0, last: null, mark: null };
    window.__cbzVisualCompare = {
      render() { try { S.B.render(); } catch (_) {} },
      advance(sec) { try { S.B.advance(sec); S.t += sec; } catch (_) {} },
      metrics() { return S.last || {}; },
    };
  }
  const B = S.B;
  const sub = input.subject;
  const a0 = B.audit();

  if (sub.walk) {
    /* THE WARLORD STEPS OFF THE LINE. Written through the same seat a tool
       has (audit().you is where he is; the men are around field centre), 30 m
       along the field's z axis — the line runs along z, so this is "off the
       flank", where a line that does not follow him is visibly not with him. */
    const a = B.audit();
    /* `you()` exists only on the after checkout. On the before checkout the
       same displacement is written through gunplay's own seat if it is
       there, else the subject records where he already is — the walk-off is
       staging, not the claim, and the metric line says so. */
    /* CBZ.player.pos IS the warlord's own Vector3 on both checkouts —
       gunplay.js routes fpsmode's player position straight at it (its own
       routing table, line 340) — so the same write moves him on both sides. */
    const pos = (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) ? CBZ.player.pos
              : (B.you && B.you() ? B.you().pos : null);
    if (pos) { pos.z = a.you.z + 30; pos.x = a.you.x - 6; }
  }
  if (sub.order) { try { B.order(sub.order); } catch (_) {} }
  if (sub.move) {
    const a = B.audit();
    // a point 75 m to the line's left of the warlord, back toward his own side
    try { if (B.moveTo) S.mark = B.moveTo(a.you.x - 10, a.you.z - 75); } catch (_) {}
  }
  const want = Math.max(0, (sub.at || 0) - S.t);
  if (want > 0) { B.advance(want); S.t += want; }

  const a = B.audit();
  B.camera("cmd");
  /* LOW AND CLOSE. 42 m at 0.40 rad photographed the warlord as a
     four-pixel man; 36 m at 0.30 keeps him legible and holds a rank of
     twelve on either side of him. The seat looks along the field's own axis
     (yaw -1.57 puts the camera behind his own side, looking over his shoulder at the enemy, so a line formed on him is a rank across the lower frame). */
  if (sub.cam === "mark" && S.mark) B.look({ x: S.mark.x, z: S.mark.z, dist: 44, pitch: 0.38, yaw: -1.57 });
  else B.look({ x: a.you.x, z: a.you.z, dist: 36, pitch: 0.30, yaw: -1.57 });
  B.render();
  S.last = {
    battleT: a.simT,
    order: a.order === "follow" ? 5 : a.order === "move" ? 6 : a.order === "hold" ? 2 : 0,
    escort: (a.you && a.you.escort) || 0,
    moveMark: a.moveMark ? 1 : 0,
    menAlive: a.mine.alive,
    enemyAlive: a.them.alive,
    formed: a.squads ? a.squads.formed : 0,
  };
  return { ok: true, metrics: S.last, note: "order " + a.order + (S.mark ? " · mark " + Math.round(S.mark.x) + "," + Math.round(S.mark.z) : "") };
}

export default {
  id: "warlord-orders",
  title: "Desert Warlord: Follow Me, and a Point on the Sand",
  description:
    "Two orders the command layer did not have: FOLLOW ME forms the line on the warlord and keeps it " +
    "there; MOVE is a tap on the ground in the command seat. Two checkouts, same battle, same seconds.",
  page: "games/warlord.html",
  viewport: { width: 1180, height: 700 },
  urlParams: { battle: 1, frozen: 1, mine: 30, them: 60, seed: 1337, gun: "ak47", faction: "militia", myfaction: "legion", sound: "off" },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  stageTimeoutMs: 600000,
  beforeLabel: "BEFORE · b0566c8 — four orders, none of them a place",
  afterLabel: "AFTER · FOLLOW ME and MOVE",
  pairNote: "Two checkouts · seed 1337 · 30 legion v 60 militia · same simulated seconds · same warlord position",
  defaultFocus: "When the warlord moves, does his line come with him? Can he point at the sand?",
  method:
    "?battle=1&frozen=1 is battle.js's own debug fight, begun with its clock stopped; advance() is the " +
    "only time that passes. The warlord is moved 30 m off his line's flank through the battle's own " +
    "you() seat, then FOLLOW ME is given through B.order (the same call the rail button makes) and MOVE " +
    "through B.moveTo (the same call the command-seat tap makes). The command camera is parked on him. " +
    "escort is read from audit(): his men inside 25 m.",
  metricsNote:
    "escort is the number: men within 40 m of the warlord (a thirty-man line on him is sixty metres wide). On the before checkout FOLLOW is refused by " +
    "setOrder (not in ORDERS) and moveTo does not exist, so the line holds its spawn anchor and the " +
    "number stays wherever the walk-off left it. order is the current order as an index (2 hold, 5 " +
    "follow, 6 move); moveMark is the ring on the sand.",
  metrics: {
    battleT: { label: "Simulated time at this beat", unit: "s" },
    order: { label: "Current order (2 hold · 5 follow · 6 move)", unit: "index" },
    escort: { label: "Your men within 40 m of you", unit: "men", better: "higher" },
    moveMark: { label: "A MOVE point marked on the sand", unit: "0/1", better: "higher" },
    formed: { label: "Men in formation", unit: "men" },
    menAlive: { label: "Your men standing", unit: "men" },
    enemyAlive: { label: "Enemy standing", unit: "men" },
  },
  subjects,
  stage: stageOrders,
};
