/* DESERT WARLORD — THE DUEL IS A FIGHT, NOT A COIN.

   THE CLAIM. events.js's challenge card ("HE WANTS YOU, NOT YOUR ARMY") ended
   its WALK OUT in `if (W.chance(p))` and a sentence. In a game whose entire
   trigger is systems/fpsmode.js, the one fight that is explicitly YOU against
   ONE MAN was the one fight you did not get to shoot. AFTER, WALK OUT starts
   battle.js's `solo` fight: none of your men are fielded (they are the
   reserve, untouched), nobody routs (a one-man side at a third of his health
   would otherwise break and run on the first hit, ending it as THEY BREAK with
   nobody dead), and the aftermath is his name on the ground or yours.

   THE A/B IS TWO CHECKOUTS. Both boot battle.js's debug fight with ?duel=1;
   the before checkout does not know the flag and fields the ordinary 30 v 26,
   which IS the honest before — there was no such thing as a duel on that
   build. The first frame is the opening, first person; the second runs the
   fight out and photographs the payoff.

     node ~/harness/ba/before-after.mjs warlord-duel \
       --before http://127.0.0.1:8731/ --after http://127.0.0.1:8732/ --no-open
*/

async function stageDuel(input) {
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
    S = window.__warlordStudio = { B: B, t: 0, last: null, done: false };
    window.__cbzVisualCompare = {
      render() { try { S.B.render(); } catch (_) {} },
      advance(sec) { try { S.B.advance(sec); S.t += sec; } catch (_) {} },
      metrics() { return S.last || {}; },
    };
  }
  const B = S.B;
  const sub = input.subject;
  const snap = () => {
    let a = null;
    try { a = B.audit(); } catch (_) {}
    if (!a || !a.live) return S.last || {};
    S.last = {
      battleT: a.simT,
      solo: a.solo ? 1 : 0,
      myFielded: a.mine.started,
      enemyFielded: a.them.started,
      menAlive: a.mine.alive, enemyAlive: a.them.alive,
      routing: a.mine.routing + a.them.routing,
      yourHp: a.you.hp,
    };
    return S.last;
  };
  if (sub.finish) {
    for (let i = 0; i < 40 && !S.done; i++) {
      B.advance(5); S.t += 5;
      let a = null;
      try { a = B.audit(); } catch (_) {}
      if (!a || !a.live) { S.done = true; break; }
      snap();
      if (a.over) { S.done = true; break; }
    }
    await until(() => CBZ.warlord.phase() === "aftermath", 20000, 200);
    await wait(500);
    const st = document.getElementById("stage");
    if (st) st.scrollTop = 0;
    const S2 = CBZ.warlord.state;
    const m = Object.assign({}, S.last, { battleEndT: Math.round(S.t), armyAfter: S2.army.length, yourHpAfter: S2.you.hp });
    S.last = m;
    return { ok: true, metrics: m, phase: CBZ.warlord.phase() };
  }
  const want = Math.max(0, (sub.at || 0) - S.t);
  if (want > 0) { B.advance(want); S.t += want; }
  B.camera(sub.cam || "fps");
  if (sub.cam === "cmd") {
    /* from the side of the line between the two men: the fight runs along
       the field's x axis, so a seat at +z looking across it (yaw 0) holds
       both of them; the focus is the midpoint of you and the enemy mass */
    const a = B.audit();
    const midX = a.you.x + (a.field.cx - a.you.x) * 1.0;
    B.look({ x: midX, z: a.you.z, dist: 34, pitch: 0.22, yaw: 0 });
  }
  B.render();
  return { ok: true, metrics: snap(), simT: S.t };
}

export default {
  id: "warlord-duel",
  title: "Desert Warlord: The Duel Is a Fight",
  description:
    "WALK OUT used to be W.chance(p) and a sentence. Now it is battle.js's solo fight: you, him, no army, nobody routs. Two checkouts, same seed.",
  page: "games/warlord.html",
  viewport: { width: 1180, height: 700 },
  urlParams: { battle: 1, frozen: 1, duel: 1, mine: 30, seed: 1337, gun: "ak47", hisgun: "ak47", faction: "company", myfaction: "legion", sound: "off" },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  stageTimeoutMs: 600000,
  beforeLabel: "BEFORE · b0566c8 — no such thing as a duel (?duel=1 ignored: 30 v 26)",
  afterLabel: "AFTER · solo: you against their champion, your army held with the baggage",
  pairNote: "Two checkouts · seed 1337 · ?battle=1&duel=1 · same simulated seconds",
  defaultFocus: "Is it one man against one man, with a gun in your hands and nobody else fielded?",
  method:
    "battle.js's ?battle=1 debug fight begun frozen; ?duel=1 (after only) builds a one-veteran band " +
    "and starts it with {solo:true, duel:true}. advance() is the only time that passes. The first " +
    "subject is the opening from the warlord's own eyes; the second runs the fight out to the aftermath.",
  metricsNote:
    "solo and myFielded are the claim: after, none of your thirty men are on the field (they are the " +
    "reserve and come home untouched); before, all thirty are. routing is structurally zero after " +
    "because a duel has no rout on either side.",
  metrics: {
    battleT: { label: "Simulated time at this beat", unit: "s" },
    solo: { label: "A solo fight", unit: "0/1", better: "higher" },
    myFielded: { label: "Your men fielded", unit: "men", better: "lower" },
    enemyFielded: { label: "Their men fielded", unit: "men" },
    menAlive: { label: "Your men standing", unit: "men" },
    enemyAlive: { label: "Enemy standing", unit: "men" },
    routing: { label: "Men running", unit: "men", better: "lower" },
    yourHp: { label: "Your health", unit: "hp" },
    battleEndT: { label: "Length of the fight", unit: "s" },
    armyAfter: { label: "Your army after", unit: "men", better: "higher" },
    yourHpAfter: { label: "Your health after", unit: "hp" },
  },
  subjects: [
    { id: "walk-out", label: "Walking out, first person", at: 4, cam: "fps",
      focus: "AFTER: one man across the sand and your own rifle in frame; the counter reads 0+1 against 1. BEFORE: thirty men beside you and twenty-six across, because the build has no duel." },
    { id: "the-gap", label: "The gap, from the command seat", at: 9, cam: "cmd",
      focus: "The same second from outside: two men closing on open sand, nobody else on the field. On the before checkout this is the two lines." },
    { id: "the-end", label: "One of you on the ground", finish: true,
      focus: "The fight run out to its end and the payoff screen. armyAfter is the reserve coming home untouched; on the before checkout it is whatever thirty men against twenty-six cost." },
  ],
  stage: stageDuel,
};
