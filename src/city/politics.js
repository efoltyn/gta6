/* ============================================================
   city/politics.js — THE COUNTRY, AS ONE MODEL.

   OWNER (2026-10-08): "You can even tell agents to kill another agent, but
   they are more likely to turn it down." / "There are orgs: police, army,
   FBI, CIA, Secret Service. Each has different loyalty." / "Congress:
   Republicans and Democrats." / "Communists, socialists, democrats,
   republicans, anarchists, neo-Nazis, nationalists and fascists. Each has a
   number of people and a loyalty." / "Don't want a ton of parallel systems,
   I want things all connected." / "More general things, not specific shit,
   just like freedom in game: you can do a lot of shit and all shit has
   effect and is mentioned in news."

   WHAT THIS FILE REPLACED (one store each, nothing runs beside it):
     approval     the seat country's rec.approval is WRITTEN ONLY HERE: the
                  population-weighted loyalty of eight ideological groups.
                  approval.js's country blend skips the seat and hands its
                  conditions (econ, crime, services) to drift(); every
                  CBZ.approvalShock / CBZ.approvalSet aimed at the seat lands
                  in shock() / setApproval() below.
     loyalty      institutions (police, army, Bureau, CIA, Secret Service)
                  live here; a person's loyalty stays on that person's record
                  (presidency.js's cabinet record) but every write goes
                  through personLoyalty(). dissent.js's army line IS
                  100 - army loyalty; protection.js sizes the President's
                  detail off the Service's loyalty; statecraft's police stop
                  enforcing the curfew when the police stop obeying.
     unrest       dissent.js's unrest and movement are READ from the groups'
                  anger (unrest(), movement()), not counted beside them;
                  president_public.js's protest anger is streetAnger().
     Congress     president_staff.js's old coin-flip "Senate" is confirm()
                  here: one body, two parties, real seats, named members,
                  votes off party loyalty and policy fit.
     scandal      stays the one number in w.politics (approval.js reads it).

   THE GRAMMAR. Every political thing anyone does is ONE call:
       CBZ.politics.act(verb, { target, by, ideology, institution, ... })
     verb    kill arrest detain pardon fire appoint bribe deal raisepay
             cutpay ban deploy praise insult threaten (person grammar), or an
             ORDER key (curfew, martial, war, peace, strike, nuke, emergency,
             fascism, communism, crown, taxUp, taxDown, amnesty, police,
             surge, guard, wall, bureau, address, surveillance, nationalise,
             flag, post ...) which is a move along the POLICY dimensions.
     target  anything: a ped, a cabinet role ("general"), a congress sid, a
             group id ("com"), a party ("R"/"D"), an institution ("army"), a
             gang, a nation id. describe() turns it into affiliations:
             ideology, institution, party, gang, nation, notability, how
             justified harming it is, who saw it.
     by      "self" (your own hand), "order" or an institution key.
   One effect function prices every act off those affiliations with a verb
   weight table (VERBS) and an ideology affinity matrix (AFF); policy moves
   are priced off each group's position (POS) on the dimensions. Nothing is
   a special case: a fascist appointment, a senator's murder, a pardoned gang
   boss and a bribed General all run the same lines.

   NEWS. Every act above a notability or witness bar goes out as ONE rich
   "act" event on the presidency bus; newsroom.js phrases it (verb, title,
   name, agent, place, count) and phone_apps.js posts the groups' reactions
   on Holler in their own voices. Small acts aggregate ("Third killing in
   Eastgate this week").

   PEOPLE TALK TO YOU (gta6-pres-people-talk-to-you): there is no meter. The
   Chief says "The Army's restless, sir." (chiefLine), a pollster leaves a
   folder, bills and executive orders arrive as folders on the desk through
   president_office.js's own matters engine (E Sign, wheel Veto), heads of
   institutions come with their deals, lawyers come for pardons.

   PUBLIC: CBZ.politics = { act, order, refusalChance, describe, owns,
     approval, groups, institutions, inst, instLoyalty, instNudge, obeys,
     detailSize, person, personLoyalty, congress, vote, confirm, gate,
     unrest, movement, streetAnger, angriest, fear, chiefLine, bills, sign,
     veto, executive, pardon, held, deal, debts, shock, setApproval, drift,
     event, nudge, onDeath, policy, audit, reset, serialize, apply } + _tests.
   Bus (CBZ.presidency.emit): "act" {verb, target, agent, place, count,
     headline?, sub?, breaking, reactions:[{group, name, handle, text}]},
     "vote" {kind, name, pass, yes, no, headline}.
   LOAD: after presidency.js; everything else is read lazily.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.politics) return;
  const g = CBZ.game || (CBZ.game = {});

  // ================================================================
  //  DATA — the whole model is these tables.
  // ================================================================
  const GROUP_IDS = ["com", "soc", "dem", "rep", "ana", "nazi", "nat", "fas"];
  const GROUPS = {
    com: { name: "Communists", adj: "communist", share: 0.04 },
    soc: { name: "Socialists", adj: "socialist", share: 0.14 },
    dem: { name: "Democrats", adj: "democrat", share: 0.30 },
    rep: { name: "Republicans", adj: "republican", share: 0.30 },
    ana: { name: "Anarchists", adj: "anarchist", share: 0.03 },
    nazi: { name: "Neo-Nazis", adj: "neo-Nazi", share: 0.02 },
    nat: { name: "Nationalists", adj: "nationalist", share: 0.12 },
    fas: { name: "Fascists", adj: "fascist", share: 0.05 },
  };
  // the mainstream reads as nothing on a headline ("President appoints X as
  // General"); anything else is named ("President appoints fascist X ...")
  const MAINSTREAM = { dem: 1, rep: 1 };
  // AFF[g][h]: how much group g feels a harm or a favour done to someone of
  // ideology h as its own (1), an ally's (+), or an enemy's (-: harm pleases).
  const AFF = {
    com: { com: 1, soc: 0.5, dem: 0.1, rep: -0.4, ana: 0.3, nazi: -1, nat: -0.6, fas: -1 },
    soc: { com: 0.4, soc: 1, dem: 0.4, rep: -0.3, ana: 0.2, nazi: -0.8, nat: -0.4, fas: -0.8 },
    dem: { com: 0, soc: 0.4, dem: 1, rep: 0.05, ana: 0, nazi: -0.7, nat: -0.2, fas: -0.7 },
    rep: { com: -0.5, soc: -0.3, dem: 0.05, rep: 1, ana: -0.4, nazi: -0.3, nat: 0.4, fas: -0.2 },
    ana: { com: 0.3, soc: 0.2, dem: 0, rep: -0.3, ana: 1, nazi: -0.9, nat: -0.5, fas: -0.9 },
    nazi: { com: -1, soc: -0.8, dem: -0.5, rep: 0.1, ana: -0.8, nazi: 1, nat: 0.5, fas: 0.6 },
    nat: { com: -0.6, soc: -0.4, dem: -0.2, rep: 0.4, ana: -0.5, nazi: 0.3, nat: 1, fas: 0.5 },
    fas: { com: -0.9, soc: -0.7, dem: -0.4, rep: 0.1, ana: -0.7, nazi: 0.6, nat: 0.5, fas: 1 },
  };
  // THE POLICY DIMENSIONS. A group's position on each (-1..1) is what it
  // wants; every order, bill and executive order is a move along these.
  const DIMS = ["military", "police", "liberty", "surveillance", "taxes", "welfare", "nation", "press", "war"];
  const POS = {
    com: { military: -0.3, police: -0.5, liberty: 0.2, surveillance: -0.4, taxes: 0.8, welfare: 1, nation: -0.6, press: 0.1, war: -0.6 },
    soc: { military: -0.5, police: -0.3, liberty: 0.6, surveillance: -0.6, taxes: 0.5, welfare: 0.8, nation: -0.4, press: 0.6, war: -0.8 },
    dem: { military: -0.1, police: -0.1, liberty: 0.8, surveillance: -0.5, taxes: 0.1, welfare: 0.4, nation: -0.3, press: 0.9, war: -0.3 },
    rep: { military: 0.6, police: 0.5, liberty: 0.3, surveillance: 0.1, taxes: -0.8, welfare: -0.5, nation: 0.4, press: 0.3, war: 0.2 },
    ana: { military: -0.9, police: -1, liberty: 1, surveillance: -1, taxes: -0.5, welfare: 0.2, nation: -0.8, press: 0.8, war: -0.8 },
    nazi: { military: 0.9, police: 0.7, liberty: -0.8, surveillance: 0.4, taxes: -0.2, welfare: -0.2, nation: 1, press: -0.8, war: 0.8 },
    nat: { military: 0.9, police: 0.6, liberty: -0.1, surveillance: 0.3, taxes: -0.4, welfare: -0.1, nation: 0.9, press: -0.2, war: 0.6 },
    fas: { military: 0.9, police: 0.9, liberty: -0.9, surveillance: 0.7, taxes: -0.1, welfare: 0.1, nation: 0.8, press: -0.9, war: 0.7 },
  };
  const K_POLICY = 30;          // loyalty points per unit of policy move along a group's own position
  const FIT = 12;               // the lasting pull of where policy stands, at equilibrium
  // THE VERBS of the person grammar. hostile: harms its target. w: weight.
  // u: what EVERYONE feels when it is unjustified. inst: the hit (or lift)
  // to the target's institution. scandal: points of the one scandal.
  // vec: the policy the act implies (an arrest is a little police power).
  const VERBS = {
    kill: { hostile: 1, w: 9, u: 0.45, inst: 22, scandal: 7, past: "killed" },
    arrest: { hostile: 1, w: 4.5, u: 0.12, inst: 10, scandal: 2.5, vec: { police: 0.02, liberty: -0.02 }, past: "arrested" },
    detain: { hostile: 1, w: 3, u: 0.08, inst: 7, scandal: 1.5, vec: { police: 0.015, liberty: -0.015 }, past: "detained" },
    fire: { hostile: 1, w: 2.5, u: 0.08, inst: 9, scandal: 2, past: "fired" },
    insult: { hostile: 1, w: 1.2, u: 0.03, inst: 3, scandal: 0.5, past: "attacked" },
    threaten: { hostile: 1, w: 2, u: 0.06, inst: 4, scandal: 1, past: "threatened" },
    ban: { hostile: 1, w: 7, u: 0.25, inst: 6, scandal: 5, vec: { liberty: -0.12, press: -0.05 }, past: "banned" },
    deploy: { hostile: 1, w: 8, u: 0.3, inst: 8, scandal: 5, vec: { police: 0.1, liberty: -0.12, military: 0.05 }, past: "deployed against" },
    cutpay: { hostile: 1, w: 1.5, u: 0, inst: 14, scandal: 0, past: "pay cut" },
    appoint: { w: 6, inst: 6, past: "appointed" },
    pardon: { w: 3.5, inst: 2, scandal: 2, vec: { police: -0.03 }, past: "pardoned" },
    praise: { w: 1.2, inst: 3, past: "praised" },
    raisepay: { w: 1.5, inst: 14, past: "pay rise" },
    bribe: { w: 0.4, inst: 10, secret: 1, past: "paid" },
    deal: { w: 0.6, inst: 8, secret: 1, past: "deal" },
  };
  // THE ORDERS: moves along the dimensions. A target (a nation, the street)
  // and an institution term ride along where the order has one.
  const ORDERS = {
    address: { vec: {}, all: 3.5 },
    emergency: { vec: { liberty: -0.25, police: 0.15, press: -0.1 } },
    crackdown: { vec: { police: 0.2, liberty: -0.2 }, fear: 20 },
    wall: { vec: { nation: 0.3, military: 0.05 } },
    bureau: { vec: { police: 0.05, surveillance: 0.05 }, inst: { fbi: 3 } },
    pardon: { vec: { police: -0.05 }, scandal: 3 },
    fascism: { vec: { police: 0.6, liberty: -0.7, nation: 0.6, press: -0.6, surveillance: 0.5, military: 0.4 } },
    communism: { vec: { taxes: 0.7, welfare: 0.8, liberty: -0.4, press: -0.5, nation: -0.2, surveillance: 0.4 } },
    crown: { vec: { liberty: -0.4, press: -0.3, nation: 0.2 }, all: -4 },
    police: { vec: { police: 0.15 }, inst: { police: 4 } },
    taxUp: { vec: { taxes: 0.15 } },
    taxDown: { vec: { taxes: -0.15 } },
    curfew: { vec: { police: 0.15, liberty: -0.15 }, fear: 10 },
    amnesty: { vec: { police: -0.1, liberty: 0.1 }, inst: { police: -3 } },
    guard: { vec: { police: 0.04 } },
    surge: { vec: { police: 0.12, liberty: -0.05 } },
    martial: { vec: { military: 0.1, police: 0.3, liberty: -0.3 }, fear: 25, armyFeels: true },
    war: { vec: { war: 0.5, military: 0.15 }, inst: { army: 4 }, verb: "threaten" },
    peace: { vec: { war: -0.5 } },
    strike: { vec: { war: 0.15 }, verb: "threaten", scale: 2 },
    nuke: { vec: { war: 0.3 }, all: -10, scandal: 10, verb: "kill", scale: 3 },
    "strike-own": { vec: {}, all: -12, scandal: 15, inst: { army: -8 } },
    "nuke-own": { vec: {}, all: -40, scandal: 40, inst: { army: -20 } },
    surveillance: { vec: { surveillance: 0.35, liberty: -0.15 }, inst: { cia: 8, fbi: 6 } },
    nationalise: { vec: { welfare: 0.25, taxes: 0.15 }, treasury: 15000 },
    flag: { vec: { nation: -0.08 } },
    post: { vec: {} },
  };
  // the Congress votes the game has: what each needs, and which dimension it moves
  const NEEDS_VOTE = { war: { dim: "war", dir: 1, name: "the war authorisation" }, taxUp: { dim: "taxes", dir: 1, name: "the tax rise" }, taxDown: { dim: "taxes", dir: -1, name: "the tax cut" } };
  const INST_IDS = ["police", "army", "fbi", "cia", "ss"];
  const INST = {
    police: { name: "the police", Name: "The police", head: "police", lean: "police", ideo: { rep: 0.5, nat: 0.3, dem: 0.2 }, title: "Officer", staff: 9000 },
    army: { name: "the Army", Name: "The Army", head: "general", lean: "military", ideo: { nat: 0.45, rep: 0.35, dem: 0.2 }, title: "Soldier", staff: 14000 },
    fbi: { name: "the Bureau", Name: "The Bureau", head: "bureau", lean: "surveillance", ideo: { dem: 0.45, rep: 0.45, nat: 0.1 }, title: "Agent", staff: 5000 },
    cia: { name: "the Agency", Name: "The Agency", head: "cia", lean: "surveillance", ideo: { rep: 0.5, dem: 0.4, nat: 0.1 }, title: "Officer", staff: 5000 },
    ss: { name: "the Secret Service", Name: "The Secret Service", head: "ss", lean: null, ideo: { rep: 0.5, dem: 0.3, nat: 0.2 }, title: "Agent", staff: 3000 },
  };
  const ROLE_INST = { police: "police", general: "army", bureau: "fbi", cia: "cia", ss: "ss" };
  const PARTIES = {
    R: { name: "Republicans", adj: "Republican", w: { rep: 0.62, nat: 0.25, fas: 0.08, nazi: 0.05 } },
    D: { name: "Democrats", adj: "Democratic", w: { dem: 0.62, soc: 0.26, com: 0.08, ana: 0.04 } },
  };
  const PARTY_OF = { rep: "R", nat: "R", fas: "R", nazi: "R", dem: "D", soc: "D", com: "D", ana: "D" };
  const SEATS = 100;
  const DEPLOY_MIN = 70;        // the Army turns on its own people only above this
  const WITNESS_R = 25;
  // the bills Congress writes: a name per dimension and direction
  const BILL_NAMES = {
    military: ["Defense Appropriations Act", "Defense Cuts Act"], police: ["Police Powers Act", "Police Reform Act"],
    liberty: ["Civil Liberties Act", "Public Order Act"], surveillance: ["Intelligence Authorization Act", "Privacy Act"],
    taxes: ["Revenue Act", "Tax Relief Act"], welfare: ["Social Security Act", "Spending Cuts Act"],
    nation: ["Border Security Act", "Immigration Reform Act"], press: ["Press Freedom Act", "Media Standards Act"],
    war: ["War Powers Authorization", "Peace and Withdrawal Act"],
  };
  // what a group says, in its own voice (Holler)
  const VOICE = {
    com: { angry: ["The workers will remember this.", "Another crime of the ruling class.", "This is what the bosses wanted."], pleased: ["Finally, a step for the workers.", "The people's power grows."], handle: "red", slogan: ["WORKERS SAY NO", "POWER TO THE PEOPLE"] },
    soc: { angry: ["This is not who we are.", "Shame on this government.", "We will organise."], pleased: ["Good. Long overdue.", "A fairer country, today."], handle: "rose", slogan: ["PEOPLE OVER POWER", "NOT IN OUR NAME"] },
    dem: { angry: ["This is not democracy.", "Call your senator. Today.", "We deserve better than this."], pleased: ["Good call by the President.", "Credit where it's due."], handle: "blue", slogan: ["DEFEND DEMOCRACY", "RULE OF LAW"] },
    rep: { angry: ["Not what we voted for.", "This is government overreach.", "Disappointed doesn't cover it."], pleased: ["Strong move. Keep going.", "About time."], handle: "liberty", slogan: ["NOT OUR PRESIDENT", "SMALL GOVERNMENT"] },
    ana: { angry: ["No gods, no masters, no presidents.", "Burn it down.", "They show you who they are."], pleased: ["Even a broken clock.", "One less chain."], handle: "black", slogan: ["NO MASTERS", "ABOLISH THE STATE"] },
    nazi: { angry: ["Traitor to the nation.", "Our day is coming."], pleased: ["Finally.", "The nation wakes up."], handle: "iron", slogan: ["BLOOD AND SOIL", "TRAITOR"] },
    nat: { angry: ["He sold out the country.", "A weak man in a strong chair."], pleased: ["Country first. Good.", "That's a President."], handle: "flag", slogan: ["COUNTRY FIRST", "STRONG BORDERS"] },
    fas: { angry: ["Weakness. Pure weakness.", "Order will come, with or without him."], pleased: ["Order. At last.", "This is strength."], handle: "order", slogan: ["ORDER NOW", "ONE NATION ONE WILL"] },
  };
  const FIRST = ["Ada", "Ben", "Cora", "Dmitri", "Elena", "Frank", "Greta", "Hal", "Ines", "Jonah", "Kira", "Luis", "Mara", "Ned", "Olga", "Pete", "Rhea", "Sol", "Tess", "Vic"];
  const LAST = ["Okafor", "Reyes", "Lindqvist", "Moreau", "Castell", "Whitlock", "Serrano", "Adair", "Kovac", "Ashford", "Maddox", "Novak", "Brandt", "Duarte", "Haas", "Sato"];

  // ================================================================
  //  SMALL HELPERS
  // ================================================================
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hash(s) { s = String(s); let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function h01(s) { return (hash(s) % 100003) / 100003; }
  function day() { try { return CBZ.worldDay ? (CBZ.worldDay() | 0) : 0; } catch (e) { return 0; } }
  function surname(n) { const a = String(n || "").trim().split(/\s+/); return a[a.length - 1] || String(n || ""); }
  function cap(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function ordinal(n) { return ["", "First", "Second", "Third", "Fourth", "Fifth"][n] || (n + "th"); }
  function Pz() { return CBZ.presidency || null; }
  function seat() {
    const h = (CBZ.gov && CBZ.gov.holds) ? CBZ.gov.holds() : null;
    return (h && h.kind === "country" && h.rec) ? h : null;
  }
  function seatRec() { const h = seat(); return h ? h.rec : null; }
  function emit(evt, payload) { const p = Pz(); if (p && p.emit) { try { p.emit(evt, payload); } catch (e) {} } }
  function wpol() { const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; return (w && w.politics) || g.cityPolitics || null; }
  function addScandal(n) { const p = wpol(); if (p && n) p.scandal = clamp((+p.scandal || 0) + n, 0, 100); }
  function scandal() { const p = wpol(); return p ? (+p.scandal || 0) : 0; }
  function authoritarian(rec) { rec = rec || seatRec(); return !!(rec && /dictator|fascis|junta|monarch|communis|anarch/.test(String(rec.govType || ""))); }
  function mintName(key, gender) {
    let rng = null;
    if (CBZ.seedStream) { try { rng = CBZ.seedStream("politics:" + key); } catch (e) { rng = null; } }
    if (!rng) { let x = hash(key) || 7; rng = function () { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
    if (!gender) gender = rng() < 0.6 ? "m" : "f";
    let name = null;
    if (CBZ.cityMintName) { try { name = CBZ.cityMintName(rng, gender); } catch (e) { name = null; } }
    if (!name) name = FIRST[(rng() * FIRST.length) | 0] + " " + LAST[(rng() * LAST.length) | 0];
    return { name: name, gender: gender };
  }
  function stash(name, gender, job) {
    const obj = { _parked: true, nameKnown: true, kind: "civilian", archetype: "professional", name: name, gender: gender, job: job, wealth: 0.7, aggr: 0.2, cash: 300 };
    if (CBZ.cityPedStash) { try { CBZ.cityPedStash(obj); } catch (e) {} }
    return obj._sid || ("pol_" + hash(name + job));
  }
  function placeAt(pos) {
    if (!pos || !CBZ.cityZoneAt) return null;
    try { const z = CBZ.cityZoneAt(pos.x, pos.z); return z && z.name ? String(z.name).toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }) : null; } catch (e) { return null; }
  }

  // ================================================================
  //  STATE — saved inside the presidency's own save (presidency.js
  //  serialize() carries politicsStore()).
  // ================================================================
  function store() {
    const p = Pz();
    if (p && typeof p.politicsStore === "function") { try { const s = p.politicsStore(); if (s) return s; } catch (e) {} }
    return g._politicsStub || (g._politicsStub = {});
  }
  function S() { return store(); }
  function ready() { const s = S(); const h = seat(); return !!(h && s.seat === h.id && s.groups); }
  function owns(id) { const h = seat(); return !!(h && id && h.id === id && CBZ.CONFIG.POLITICS_V1 !== false); }
  if (CBZ.CONFIG && CBZ.CONFIG.POLITICS_V1 == null) CBZ.CONFIG.POLITICS_V1 = true;

  function lean(party) {
    return party === "R" ? { com: -14, soc: -10, dem: -6, rep: 12, ana: -14, nazi: -4, nat: 6, fas: -2 }
      : { com: -4, soc: 6, dem: 12, rep: -6, ana: -10, nazi: -16, nat: -10, fas: -14 };
  }
  function presetPolicy(gov) {
    const P = {}; DIMS.forEach(function (d) { P[d] = 0; });
    const V = ORDERS[gov] && ORDERS[gov].vec;
    if (V) for (const k in V) P[k] = clamp(V[k], -1, 1);
    return P;
  }
  function init(h) {
    const s = S();
    const rec = h.rec;
    for (const k in s) delete s[k];
    s.v = 1; s.seat = h.id; s.since = day();
    s.pop = isFinite(rec.population) && rec.population > 0 ? +rec.population : 5200000 + (hash(h.id) % 4000000);
    s.presParty = hash("party:" + h.id + ":" + (CBZ.seed || "")) % 2 ? "R" : "D";
    const L = lean(s.presParty);
    const ap = isFinite(rec.approval) ? +rec.approval : 55;
    let mean = 0; GROUP_IDS.forEach(function (k) { mean += GROUPS[k].share * L[k]; });
    s.base = ap;
    s.groups = {};
    GROUP_IDS.forEach(function (k) { s.groups[k] = { share: GROUPS[k].share, loyalty: clamp(ap + L[k] - mean, 0, 100), griev: 0 }; });
    s.policy = presetPolicy(rec.govType);
    s.inst = {};
    INST_IDS.forEach(function (k) { s.inst[k] = { loyalty: k === "ss" ? 90 : 85, pay: 1, griev: 0, refused: 0, ordered: 0 }; });
    s.fear = 0;
    // CONGRESS: seats off the electorate, the President's coattails, named members
    const right = s.groups.rep.share + 0.8 * s.groups.nat.share + 0.6 * s.groups.fas.share + 0.5 * s.groups.nazi.share;
    const left = s.groups.dem.share + 0.8 * s.groups.soc.share + 0.6 * s.groups.com.share + 0.4 * s.groups.ana.share;
    let R = Math.round(SEATS * right / (right + left));
    R += s.presParty === "R" ? 3 : -3;
    s.congress = { seats: { R: clamp(R, 0, SEATS), D: SEATS - clamp(R, 0, SEATS) }, vacant: 0, mood: { R: 0, D: 0 }, banned: {}, members: [], specials: [], impeach: 0 };
    ["R", "D"].forEach(function (p) {
      for (let i = 0; i < 6; i++) {
        const m = mintName("congress:" + h.id + ":" + p + ":" + i);
        const ideo = p === "R" ? (i === 4 ? "nat" : "rep") : (i === 4 ? "soc" : "dem");
        const sid = stash(m.name, m.gender, "senator");
        s.congress.members.push({ sid: sid, name: m.name, gender: m.gender, party: p, ideology: ideo, leader: i === 0, status: "sitting", body: i < 2 });
      }
    });
    s.held = []; s.debts = {}; s.secrets = []; s.log = []; s.counts = {}; s.desk = [];
    s.bills = { seq: 0, last: day(), list: [] };
    s.fx = { investigation: null, leakDay: -9, curfewNote: -9, detailNote: -9, eoDay: -9, dealDay: {}, pollDay: -1, riotDay: {} };
    s.orders = 0;
    // the cabinet's people carry an ideology (presidency.js minted them; they
    // were never asked). Stamp it once, off the President's party.
    stampCabinet();
    writeApproval();
    return s;
  }
  function ensure() {
    const h = seat();
    if (!h || CBZ.CONFIG.POLITICS_V1 === false) return null;
    const s = S();
    if (s.seat !== h.id || !s.groups) init(h);
    return s;
  }

  // ================================================================
  //  APPROVAL — the population-weighted loyalty. THE ONE WRITE.
  // ================================================================
  function aggregate() {
    const s = S();
    if (!s.groups) return null;
    let a = 0, w = 0;
    for (const k in s.groups) { a += s.groups[k].share * s.groups[k].loyalty; w += s.groups[k].share; }
    return w > 0 ? a / w : 50;
  }
  function writeApproval() {
    const rec = seatRec();
    if (!rec || !ready()) return;
    rec.approval = clamp(aggregate(), 0, 100);
  }
  function jolt(k, d) {
    const G = S().groups[k];
    if (!G || !isFinite(d) || !d) return;
    G.loyalty = clamp(G.loyalty + d, 0, 100);
    G.griev = clamp(G.griev + d * 0.5, -40, 40);
  }
  // a generic shock (approvalShock aimed at the seat): every group alike
  let ABSORB = 0;
  function shock(n) {
    if (!ensure() || !isFinite(n) || !n) return;
    if (ABSORB > 0) { S().absorbed = (S().absorbed | 0) + 1; return; }
    GROUP_IDS.forEach(function (k) { jolt(k, n); });
    writeApproval();
  }
  function setApproval(v) {
    if (!ensure() || !isFinite(v)) return;
    const d = v - aggregate();
    GROUP_IDS.forEach(function (k) { const G = S().groups[k]; G.loyalty = clamp(G.loyalty + d, 0, 100); });
    writeApproval();
  }
  // run fn with generic shocks absorbed: the act table is the one price
  function during(fn) { ABSORB++; try { return fn(); } finally { ABSORB--; } }

  // ================================================================
  //  WHO IS IT? — describe() turns anything into affiliations.
  // ================================================================
  function drawIdeology(key, mix) {
    const r = h01("ideo:" + key);
    let acc = 0;
    const m = mix || null;
    if (m) { for (const k in m) { acc += m[k]; if (r <= acc) return k; } return Object.keys(m)[0]; }
    const s = S();
    for (let i = 0; i < GROUP_IDS.length; i++) { const k = GROUP_IDS[i]; acc += s.groups ? s.groups[k].share : GROUPS[k].share; if (r <= acc) return k; }
    return "dem";
  }
  function cabinetRec(role) { const p = Pz(); try { return p && p.cabinetRecord ? p.cabinetRecord(role) : null; } catch (e) { return null; } }
  function cabinetTitle(role) {
    const p = Pz();
    const L = (p && p.CABINET_ROLES) || [];
    for (let i = 0; i < L.length; i++) if (L[i].key === role) return L[i].title;
    return { chief: "Chief of Staff", general: "General", bureau: "Bureau Director", police: "Police Commissioner", treasury: "Treasury Secretary", cia: "CIA Director", ss: "Secret Service Director", interior: "Interior Minister", press: "Press Secretary" }[role] || cap(role);
  }
  function member(sid) { const s = S(); const L = (s.congress && s.congress.members) || []; for (let i = 0; i < L.length; i++) if (L[i].sid === sid) return L[i]; return null; }
  function gangOf(id) { const L = CBZ.cityGangs || []; for (let i = 0; i < L.length; i++) if (L[i] && (L[i].id === id || L[i] === id)) return L[i]; return null; }
  function justifiedOf(p) {
    if (!p || typeof p !== "object") return 0;
    if (p._presAttacker || p.organization === "cell" || p._cell) return 0.9;
    const P = CBZ.player;
    if ((p.attacking || p.state === "attack" || p.state === "fight") && (p.target === P || p.armed)) return 0.8;
    if ((p.npcWanted | 0) > 0) return 0.5;
    return 0;
  }
  function witnessesOf(p) {
    if (!p || !p.pos) return 0;
    const L = CBZ.cityPeds || [];
    let n = 0;
    for (let i = 0; i < L.length && n < 9; i++) {
      const q = L[i];
      if (!q || q === p || q.dead || !q.pos) continue;
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z;
      if (dx * dx + dz * dz < WITNESS_R * WITNESS_R) n++;
    }
    return n;
  }
  function describe(t, opts) {
    opts = opts || {};
    const d = { kind: "person", name: null, title: "", ideology: null, inst: null, party: null, gang: null, nation: null, notable: 0.1, justified: 0, witnesses: 0, place: null, collective: false };
    if (t == null && opts.institution) t = opts.institution;
    if (typeof t === "string") {
      if (GROUPS[t]) { d.kind = "group"; d.ideology = t; d.name = GROUPS[t].name; d.notable = 1; d.collective = true; d.party = PARTY_OF[t]; }
      else if (PARTIES[t]) { d.kind = "party"; d.party = t; d.name = PARTIES[t].name; d.notable = 1; d.collective = true; d.ideology = t === "R" ? "rep" : "dem"; }
      else if (INST[t]) { d.kind = "institution"; d.inst = t; d.name = INST[t].Name; d.notable = 1; d.collective = true; d.ideology = topOf(INST[t].ideo); }
      else if (cabinetRec(t) || ROLE_INST[t] || t === "interior" || t === "treasury" || t === "chief") {
        const c = cabinetRec(t) || {};
        d.kind = "person"; d.role = t; d.name = c.name || null; d.sid = c.sid || null; d.title = cabinetTitle(t);
        d.ideology = c.ideology || "dem"; d.inst = ROLE_INST[t] || null; d.isHead = !!ROLE_INST[t]; d.notable = t === "general" ? 0.9 : 0.8; d.gender = c.gender;
      } else if (member(t)) return describe(member(t), opts);
      else if (CBZ.polity && CBZ.polity.get && CBZ.polity.get(t)) {
        const r = CBZ.polity.get(t); d.kind = "nation"; d.nation = t; d.name = r.name; d.notable = 1; d.collective = true; d.ideology = "nat";
      } else if (gangOf(t)) return describe(gangOf(t), opts);
      else { d.name = t; }
    } else if (t && typeof t === "object") {
      if (t.kind && (t.kind === "group" || t.kind === "party" || t.kind === "institution" || t.kind === "nation" || t.kind === "policy" || t.kind === "person" && t._desc)) {
        Object.assign(d, t);
      } else if (t.status && t.party && t.sid && member(t.sid)) {          // a member of Congress
        d.sid = t.sid; d.name = t.name; d.party = t.party; d.ideology = t.ideology; d.member = t.sid; d.gender = t.gender;
        d.title = t.leader ? PARTIES[t.party].adj + " Leader" : "Senator"; d.notable = t.leader ? 0.85 : 0.6;
      } else if (t.members && (t.bossName || t.turf || t.warIntensity != null)) {   // a gang
        d.kind = "gang"; d.gang = t.id; d.name = t.name; d.notable = 0.7; d.collective = true; d.ideology = drawIdeology("gang:" + t.id); d.lawless = true;
      } else {
        // A PED. Its role says who it is; a citizen draws from the mix.
        const p = t;
        d.ped = p; d.sid = p._sid || null; d.name = p.name && p.nameKnown !== false ? String(p.name) : null; d.gender = p.gender || "m";
        d.justified = justifiedOf(p); d.witnesses = witnessesOf(p); d.place = placeAt(p.pos);
        const key = p._sid || p.id || p.name || ((p.pos ? Math.round(p.pos.x) + ":" + Math.round(p.pos.z) : "x"));
        const job = String(p.job || "").toLowerCase();
        const role = p._presOfficer || (p._presStaff && p._presStaff !== "driver" ? p._presStaff : null);
        if (role) {
          const c = cabinetRec(role) || (role === "press" ? null : null);
          d.role = role; d.title = cabinetTitle(role); d.ideology = (c && c.ideology) || drawIdeology(key, { dem: 0.5, rep: 0.5 });
          d.name = (c && c.name) || d.name; d.inst = ROLE_INST[role] || null; d.isHead = !!ROLE_INST[role]; d.notable = role === "general" ? 0.9 : 0.8;
        } else if (p._congress && member(p._congress)) {
          const m = member(p._congress);
          Object.assign(d, describe(m, opts), { ped: p, witnesses: d.witnesses, place: d.place, justified: d.justified });
        } else if (/secret service/.test(job)) { d.inst = "ss"; d.title = "Secret Service agent"; d.notable = 0.3; d.ideology = drawIdeology(key, INST.ss.ideo); }
        else if (p.kind === "cop" || /police|officer|sheriff|trooper/.test(job)) { d.inst = "police"; d.title = "Police officer"; d.notable = 0.25; d.ideology = drawIdeology(key, INST.police.ideo); }
        else if (/federal agent|bureau/.test(job)) { d.inst = "fbi"; d.title = "Bureau agent"; d.notable = 0.3; d.ideology = drawIdeology(key, INST.fbi.ideo); }
        else if (/cia|intelligence|spy/.test(job)) { d.inst = "cia"; d.title = "Intelligence officer"; d.notable = 0.35; d.ideology = drawIdeology(key, INST.cia.ideo); }
        else if (p.organization === "military" || p.kind === "soldier" || /soldier|trooper|marine|private|sergeant/.test(job)) { d.inst = "army"; d.title = "Soldier"; d.notable = 0.25; d.ideology = drawIdeology(key, INST.army.ideo); }
        else if (p.gangId != null || p.gang != null) {
          const gid = p.gangId != null ? p.gangId : (p.gang && p.gang.id != null ? p.gang.id : p.gang);
          const gn = gangOf(gid);
          d.gang = gid; d.lawless = true;
          const boss = !!(gn && (gn.boss === p || p.isBoss || p.rank === "boss"));
          d.title = boss ? "Gang leader" : "Gang member"; d.notable = boss ? 0.6 : 0.15;
          d.gangName = gn ? gn.name : null;
          d.ideology = drawIdeology(key);
        } else if (p.nation || p._foreign || /diplomat|ambassador/.test(job)) {
          d.nation = p.nation || p._foreign || null; d.title = /ambassador/.test(job) ? "Ambassador" : "Diplomat"; d.notable = 0.6; d.ideology = "nat";
        } else {
          d.title = ""; d.notable = 0.1; d.ideology = p._ideology || drawIdeology(key + ":" + (d.place || ""));
          d.noun = d.gender === "f" ? "woman" : "man";
        }
      }
    }
    if (opts.ideology && GROUPS[opts.ideology]) d.ideology = opts.ideology;
    if (opts.institution && INST[opts.institution] && !d.inst) d.inst = opts.institution;
    if (opts.title) d.title = opts.title;
    if (opts.name) d.name = opts.name;
    if (opts.notable != null) d.notable = clamp(+opts.notable, 0, 1);
    if (opts.justified != null) d.justified = clamp(+opts.justified, 0, 1);
    if (opts.witnesses != null) d.witnesses = opts.witnesses | 0;
    if (opts.place) d.place = opts.place;
    if (!d.party && d.ideology && (d.kind === "person" && (d.member || d.leader))) d.party = PARTY_OF[d.ideology];
    if (!d.ideology) d.ideology = "dem";
    return d;
  }
  function topOf(mix) { let best = null, bv = -1; for (const k in mix) if (mix[k] > bv) { bv = mix[k]; best = k; } return best; }

  // ================================================================
  //  THE EFFECT FUNCTION — every act, priced off its target.
  // ================================================================
  function dot(vec, pos) { let s = 0; for (const k in vec) s += (vec[k] || 0) * (pos[k] || 0); return s; }
  function instDelta(k, d) {
    const I = S().inst && S().inst[k];
    if (!I || !isFinite(d) || !d) return;
    I.loyalty = clamp(I.loyalty + d, 0, 100);
    I.griev = clamp(I.griev + d * 0.5, -40, 40);
  }
  function movePolicy(vec, scale) {
    const s = S();
    const out = {};
    if (!vec) return out;
    GROUP_IDS.forEach(function (k) { out[k] = K_POLICY * dot(vec, POS[k]) * (scale || 1); });
    for (const d in vec) if (s.policy && d in s.policy) s.policy[d] = clamp(s.policy[d] + vec[d] * (scale || 1), -1, 1);
    return out;
  }
  function apply_(dG, dI) {
    for (const k in dG) jolt(k, dG[k]);
    for (const k in dI) instDelta(k, dI[k]);
    writeApproval();
  }
  function personEffect(verb, T, ctx) {
    const V = VERBS[verb];
    const s = S();
    const hostile = !!V.hostile, sign = hostile ? -1 : 1;
    const just = hostile ? clamp(T.justified || 0, 0, 1) : 0;
    let sev = V.w * (0.35 + 0.65 * clamp(T.notable, 0, 1)) * (ctx.scale || 1) * (T.collective ? 1.6 : 1);
    if (hostile) sev *= (1 - 0.75 * just);
    if (ctx.by === "self") sev *= 1.15;
    if (T.lawless && hostile) sev *= 0.6;
    const dG = {}, dI = {};
    GROUP_IDS.forEach(function (k) {
      // a gangster's politics matter less than his trade
      const aff = (T.ideology && AFF[k][T.ideology] != null ? AFF[k][T.ideology] : 0) * (T.lawless ? 0.3 : 1);
      let d = sign * sev * aff;
      // nobody cheers a private citizen's harm much, whoever he voted for
      if (hostile && d > 0 && !T.collective && !T.lawless && T.notable < 0.5) d *= 0.3;
      if (hostile) d -= sev * V.u * (1 - just);
      // harming the lawless pleases the law-and-order groups, helping them angers them
      if (T.lawless) d += -sign * sev * 0.6 * POS[k].police;
      dG[k] = d;
    });
    if (V.vec) { const pm = movePolicy(V.vec, (ctx.scale || 1) * (T.collective ? 3 : 1)); for (const k in pm) dG[k] += pm[k]; }
    // THE INSTITUTIONS: the target's own takes the hit (or the lift)
    const by = ctx.by && INST[ctx.by] ? ctx.by : null;
    if (T.inst) {
      let d = sign * V.inst * (0.4 + 0.6 * clamp(T.notable, 0, 1)) * (ctx.scale || 1) * (T.isHead ? 1.5 : 1) * (T.collective ? 1.4 : 1);
      if (hostile) d *= (1 - 0.6 * just);
      if (by && by === T.inst && hostile) d *= 1.6;           // made to do it to their own
      dI[T.inst] = (dI[T.inst] || 0) + d;
      INST_IDS.forEach(function (k) { if (k !== T.inst) dI[k] = (dI[k] || 0) + d * (hostile ? 0.12 : 0.05); });
    }
    if (by && hostile && T.inst !== by && just < 0.3 && !T.lawless) dI[by] = (dI[by] || 0) - 2.5 * (verb === "kill" ? 1.6 : 1);   // a dirty order sits badly
    // THE PARTIES: a member, a leader, a party, a group
    const C = s.congress;
    if (C && T.party && PARTIES[T.party]) {
      C.mood[T.party] = clamp(C.mood[T.party] + sign * sev * 2, -60, 40);
      const o = T.party === "R" ? "D" : "R";
      if (hostile) C.mood[o] = clamp(C.mood[o] - sev * (verb === "kill" ? 0.6 : 0.2), -60, 40);
      if (hostile && (verb === "kill" || verb === "arrest" || verb === "ban") && (T.member || T.kind === "party")) C.impeach = clamp(C.impeach + sev * (verb === "kill" ? 4 : 2), 0, 100);
    }
    // THE SCANDAL (the one number): a witnessed, unjustified act, or a favour that looks bought
    let sc = 0;
    if (V.scandal) {
      const seen = T.collective ? 1 : clamp(0.4 + 0.15 * (T.witnesses || 0), 0.4, 1);
      sc = V.scandal * (0.4 + 0.6 * clamp(T.notable, 0, 1)) * (hostile ? (1 - just) : 1) * seen * (ctx.scale || 1);
    }
    // a foreigner harmed is an insult to his country; a gang remembers both ways
    if (T.nation && hostile && CBZ.relations && CBZ.relations.event) { const us = seat(); if (us && T.nation !== us.id) { try { CBZ.relations.event(us.id, T.nation, "insult", Math.round(sev * 1.5)); } catch (e) {} } }
    if (T.gang != null && CBZ.cityGangAddStanding) { try { CBZ.cityGangAddStanding(T.gang, Math.round(sign * sev * (hostile ? 2 : 3))); } catch (e) {} }
    return { dG: dG, dI: dI, scandal: sc, sev: sev };
  }
  function orderEffect(key, T, ctx) {
    const O = ORDERS[key];
    const dG = movePolicy(O.vec, ctx.scale || 1), dI = {};
    if (O.all) GROUP_IDS.forEach(function (k) { dG[k] = (dG[k] || 0) + O.all; });
    if (O.inst) for (const k in O.inst) dI[k] = (dI[k] || 0) + O.inst[k];
    // an army told to police its own people at a low ebb resents it
    if (O.armyFeels) dI.army = (dI.army || 0) + ((aggregate() || 50) < 35 ? -12 : 3);
    if (O.fear) S().fear = clamp((S().fear || 0) + O.fear, 0, 100);
    if (O.treasury) { const r = seatRec(); if (r) r.treasury = (r.treasury || 0) + O.treasury; }
    let sev = 0, sc = O.scandal || 0;
    if (O.verb && T) {
      const pe = personEffect(O.verb, T, { by: ctx.by, scale: O.scale || 1 });
      for (const k in pe.dG) dG[k] = (dG[k] || 0) + pe.dG[k];
      for (const k in pe.dI) dI[k] = (dI[k] || 0) + pe.dI[k];
      sc += pe.scandal; sev = pe.sev;
    }
    return { dG: dG, dI: dI, scandal: sc, sev: sev };
  }

  // ================================================================
  //  act() — THE ONE ENTRY. Every political thing anybody does.
  // ================================================================
  function act(kind, opts) {
    opts = opts || {};
    kind = String(kind || "");
    if (!ensure()) return { ok: false, why: "no seat" };
    if (kind === "policy") {
      const dG = policyAct(opts);
      const Tp = opts.target ? describe(opts.target, opts) : null;
      const rp = record(opts.verbWord || "policy", Tp, opts.by || "self", { dG: dG }, opts);
      return { ok: true, kind: kind, dG: dG, record: rp, headline: rp.headline || null };
    }
    const verb = VERBS[kind] ? kind : null, order = ORDERS[kind] ? kind : null;
    if (!verb && !order) return { ok: false, why: "unknown act " + kind };
    const s = S();
    // a death counted once: whoever reports it first
    if (opts.target && typeof opts.target === "object" && opts.target._politicsCounted === kind) return { ok: true, dup: true };
    const T = (opts.target != null || opts.institution) ? describe(opts.target, opts) : null;
    if (opts.target && typeof opts.target === "object" && opts.target.pos) { try { opts.target._politicsCounted = kind; } catch (e) {} }
    const by = opts.by || "self";
    const ctx = { by: by, scale: opts.scale || 1 };
    const r = verb ? personEffect(verb, T || describe(null, { name: "someone" }), ctx) : orderEffect(order, T, ctx);
    if (opts.blame === false || by === "unknown") {
      // a death the President did not cause: the chair empties, the news runs,
      // nobody blames him (the groups feel nothing he did)
      r.dG = {}; r.dI = {}; r.scandal = 0;
    }
    apply_(r.dG, r.dI);
    if (r.scandal && !(verb && VERBS[verb].secret)) addScandal(r.scandal);
    // THE CONSEQUENCES THAT ARE STATE, not loyalty
    if (T) consequences(kind, T, opts);
    if (verb && VERBS[verb].secret) secret(kind, T, opts);
    // the record, the count, the news
    const rec = record(kind, T, by, r, opts);
    return { ok: true, kind: kind, dG: r.dG, dI: r.dI, scandal: r.scandal, headline: rec.headline || null, record: rec };
  }
  function consequences(kind, T, opts) {
    const s = S(), C = s.congress;
    const P = Pz();
    // a cabinet post: the chair empties when its holder is killed, arrested or fired
    if (T.role && (kind === "kill" || kind === "arrest" || kind === "detain")) {
      const c = cabinetRec(T.role);
      if (c && !c.dead && P && P.vacateCabinet) { try { P.vacateCabinet(T.role); } catch (e) {} }
      if (c && kind === "kill") c.dead = true;
    }
    // a member of Congress: the seat moves
    if (T.member && C && (kind === "kill" || kind === "arrest" || kind === "detain" || kind === "ban")) {
      const m = member(T.member);
      if (m && m.status === "sitting") {
        m.status = kind === "kill" ? "dead" : "held";
        C.seats[m.party] = Math.max(0, C.seats[m.party] - 1);
        C.vacant++;
        if (kind === "kill") C.specials.push({ sid: m.sid, party: m.party, day: day() + 3, name: m.name });
      }
    }
    // a whole party or group banned or hunted: its people in Congress go
    if ((kind === "ban" || kind === "deploy") && C && (T.kind === "party" || T.kind === "group")) {
      const party = T.party || PARTY_OF[T.ideology];
      if (kind === "ban" && T.kind === "party") C.banned[party] = day();
      C.members.forEach(function (m) {
        if (m.status !== "sitting") return;
        if (T.kind === "party" ? m.party === party : m.ideology === T.ideology || (kind === "ban" && m.party === party && m.leader)) {
          m.status = "held"; C.seats[m.party] = Math.max(0, C.seats[m.party] - 1); C.vacant++;
          bookHeld({ sid: m.sid, name: m.name, title: "Senator", party: m.party, ideology: m.ideology, kind: "member", member: m.sid }, kind, "order");
        }
      });
      if (kind === "ban" && T.kind === "party") { C.vacant += C.seats[party]; C.seats[party] = 0; }
      s.fear = clamp((s.fear || 0) + (kind === "deploy" ? 35 : 20), 0, 100);
      if (T.kind === "group") { const G = s.groups[T.ideology]; if (G) G.banned = kind === "ban" ? day() : G.banned; }
    }
    // THE ARRESTED ARE HELD, and nobody vanishes. A person with a body here
    // is taken in by city/custody.js (officers, cuffs, a car, out of draw
    // range: the one arrest pipeline), which books him itself. Never a
    // removal here: this line used to unpost him the instant the act fired,
    // which is why a Detain made a man disappear before anybody reached him.
    // A person with no body here (a minister in another city, a member of
    // Congress) is booked straight onto the custody list.
    if ((kind === "arrest" || kind === "detain") && T.kind === "person") {
      const p = T.ped;
      const CU = CBZ.custody;
      if (p && !p.dead && p.pos) {
        const gn = T.gang != null ? gangOf(T.gang) : null;
        if (gn && gn.boss === p) gn.bossJailed = day();
        // keepBody: the pipeline (or your own hands, restrain.js) already has him
        if (!opts.keepBody && CU && CU.take && !CU.jobOf(p) && !p.restraint) {
          try { CU.take(p, { by: opts.by || "police", verb: kind }); } catch (e) {}
        }
      } else bookHeld(T, kind, opts.by);
    }
    // a pardon lets the person go
    if (kind === "pardon") releaseHeld(T);
  }
  // THE HELD ARE city/custody.js's list (one store for everybody in custody);
  // the political model only reads it and prices what happens to them
  function bookHeld(T, verb, by) {
    const CU = CBZ.custody;
    if (!CU || !CU.book) return null;
    try {
      return CU.book({ sid: T.sid || ("held_" + hash((T.name || "x") + day())), name: T.name || "an unnamed prisoner", title: T.title || "", ideology: T.ideology,
        party: T.party || null, gang: T.gang != null ? T.gang : null, gangName: T.gangName || null, inst: T.inst || null, role: T.role || null,
        member: T.member || null, kind: T.role ? "minister" : T.member ? "member" : T.gang != null ? "gang" : (T.kind && T.kind !== "person" ? T.kind : "citizen") },
        { verb: verb || "arrest", by: by || "order", status: "held" });
    } catch (e) { return null; }
  }
  function heldList() {
    const s = S(), CU = CBZ.custody;
    if (!CU || !CU.held) return [];
    // a save from before custody.js kept its own list here: move it over once
    if (Array.isArray(s.held) && s.held.length) {
      const old = s.held.splice(0);
      for (let i = 0; i < old.length; i++) { try { CU.book(old[i], { verb: "arrest", by: "order", status: "held", day: old[i].day }); } catch (e) {} }
    }
    return CU.held();
  }
  function releaseHeld(T) {
    const s = S();
    const L = heldList();
    for (let i = L.length - 1; i >= 0; i--) {
      const H = L[i];
      if ((T.sid && H.sid === T.sid) || (!T.sid && T.name && H.name === T.name)) {
        if (H.gang != null) {
          s.debts[H.gang] = (s.debts[H.gang] | 0) + 1;              // the gang owes you
          const gn = gangOf(H.gang); if (gn) gn.bossJailed = null;
        }
        if (H.kind === "member") {
          const m = member(H.sid);
          if (m && m.status === "held") { m.status = "sitting"; s.congress.seats[m.party]++; s.congress.vacant = Math.max(0, s.congress.vacant - 1); }
        }
        // he walks out of the gate he is held behind (the body comes back into
        // the world); a facility with no gate of its own lets him out at the seat's
        const site = Pz() && Pz().site ? (function () { try { return Pz().site(); } catch (e) { return null; } })() : null;
        try { CBZ.custody.release(H.id, { how: "pardoned", at: site && site.gate ? site.gate : null }); } catch (e) {}
        return H;
      }
    }
    return null;
  }

  // ---- the record and the news ------------------------------------------------
  function agentOf(by) {
    if (by === "self") return "the President";
    if (by === "order") return "on the President's order";
    if (INST[by]) return INST[by].name;
    if (by === "unknown") return null;
    return String(by || "");
  }
  function record(kind, T, by, r, opts) {
    const s = S();
    const V = VERBS[kind];
    const notable = T ? T.notable : 1;
    const place = (T && T.place) || opts.place || null;
    // the week's count of this verb in this place (for "Third killing in X")
    const ck = kind + ":" + (place || "?") + ":" + (T && T.notable < 0.3 && !T.collective ? "small" : "big");
    const wk = Math.floor(day() / 7);
    const cnt = s.counts[ck] && s.counts[ck].wk === wk ? ++s.counts[ck].n : (s.counts[ck] = { wk: wk, n: 1 }).n;
    const rec = {
      verb: kind, day: day(), by: by, agent: agentOf(by), place: place, count: cnt,
      target: T ? { kind: T.kind, name: T.name, title: T.title || "", ideology: T.ideology, adj: T.ideology ? GROUPS[T.ideology].adj : null,
        plural: T.kind === "group" ? GROUPS[T.ideology].name : T.kind === "party" ? PARTIES[T.party].name : null,
        inst: T.inst || null, instName: T.inst ? INST[T.inst].name : null, party: T.party || null, gang: T.gang != null ? T.gang : null, gangName: T.gangName || null,
        nation: T.nation || null, noun: T.noun || null, role: T.role || null, notable: T.notable, mainstream: !!MAINSTREAM[T.ideology], policy: T.policy || null } : null,
      scale: opts.scale || 1, order: ORDERS[kind] ? kind : null, past: VERBS[kind] ? VERBS[kind].past : null, how: opts.how || null,
    };
    s.log.push({ verb: kind, day: rec.day, name: T && T.name, by: by });
    if (s.log.length > 40) s.log.shift();
    // NOTABLE ENOUGH TO BE NEWS: rank, witnesses, or a pattern in one place.
    // Secret verbs (a bribe, a deal) are not news, until they surface.
    const secret = !!(V && V.secret);
    const loud = !secret && opts.quiet !== true && (!ORDERS[kind] || opts.news) &&
      (notable >= 0.25 || (T && T.witnesses >= 2) || cnt >= 2 || opts.news);
    rec.reactions = reactions(r.dG, T, kind);
    rec.breaking = !!(T && (T.notable >= 0.8 || T.collective) && V && V.hostile);
    rec.news = loud;
    if (opts.headline) rec.headline = opts.headline;
    if (opts.sub) rec.sub = opts.sub;
    if (loud || opts.headline || (ORDERS[kind] && rec.reactions.length)) emit("act", rec);
    return rec;
  }
  // the two groups that moved most, in their own words
  function reactions(dG, T, kind) {
    const L = [];
    for (const k in dG) if (Math.abs(dG[k]) >= 1.2) L.push([k, dG[k]]);
    L.sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); });
    const out = [];
    for (let i = 0; i < L.length && out.length < 2; i++) {
      const k = L[i][0], v = VOICE[k];
      const lines = L[i][1] < 0 ? v.angry : v.pleased;
      const seq = (S().log.length | 0) + i;
      const nm = FIRST[(hash(k + seq) % FIRST.length)] + " " + LAST[(hash(seq + k) % LAST.length)];
      out.push({ group: k, groupName: GROUPS[k].name, mood: L[i][1] < 0 ? "angry" : "pleased", name: nm,
        handle: "@" + v.handle + nm.split(" ")[0].toLowerCase() + ((hash(nm) % 90) + 10), text: lines[hash(kind + seq + k) % lines.length] });
    }
    return out;
  }

  // ================================================================
  //  ORDERS TO PEOPLE — "tell agents to kill another agent". The chance
  //  they turn it down scales with the target being one of their own, how
  //  loyal the institution is, and how unjustified it is.
  // ================================================================
  const REFUSAL_BASE = { kill: 0.06, arrest: 0.03, detain: 0.02, deploy: 0.05, threaten: 0.01 };
  function refusalChance(inst, verb, target, opts) {
    if (!ensure()) return 0;
    const I = S().inst[inst];
    if (!I) return 0;
    const T = target && target.kind && !target.pos ? target : describe(target, opts);
    const just = clamp(T.justified || 0, 0, 1);
    let p = REFUSAL_BASE[verb] || 0;
    if (T.inst && T.inst === inst) p += verb === "kill" ? 0.45 : 0.2;
    p += clamp(T.notable, 0, 1) * (verb === "kill" ? 0.15 : 0.06);
    p += (1 - just) * (verb === "kill" ? 0.22 : 0.08);
    p += clamp((80 - I.loyalty) / 100, 0, 0.8) * 0.9;
    p -= just * 0.2;
    return clamp(p, 0, 0.97);
  }
  const REFUSE_LINES = { own: "Not one of our own, sir.", cold: "No, sir.", plain: "Sir, I can't." };
  function order(inst, verb, target, opts) {
    opts = opts || {};
    if (!ensure()) return { ok: false, line: "", why: "You do not hold the country." };
    const I = S().inst[inst];
    if (!I) return { ok: false, line: "", why: "Nobody answers." };
    const T = describe(target, opts);
    const p = refusalChance(inst, verb, T);
    const s = S();
    s.orders = (s.orders | 0) + 1;
    I.ordered++;
    const roll = h01("order:" + inst + ":" + verb + ":" + (T.sid || T.name || "") + ":" + s.orders + ":" + day());
    if (roll < p) {
      I.refused++;
      instDelta(inst, -3);                             // being asked is itself a wound
      writeApproval();
      const line = T.inst === inst ? REFUSE_LINES.own : I.loyalty < 40 ? REFUSE_LINES.cold : REFUSE_LINES.plain;
      emit("order-refused", { inst: inst, verb: verb, target: T.name || null, line: line, p: p });
      return { ok: false, refused: true, line: line, p: p };
    }
    // carried out. A kill is counted when the body falls (onDeath reads the
    // stamp), so a miss costs nothing. An arrest or a detention of somebody
    // standing in the world is the one arrest pipeline (city/custody.js):
    // officers, cuffs, a car; the act fires when the cuffs go on, with the
    // witnesses who saw it. Anything else (a role, a member, a group) now.
    const body = !!(target && typeof target === "object" && target.pos && !target.dead);
    if (body) target._politicsOrder = { inst: inst, verb: verb, day: day() };
    if ((verb === "arrest" || verb === "detain") && body && CBZ.custody && CBZ.custody.take) {
      let j = null;
      try { j = CBZ.custody.take(target, { by: inst, verb: verb, act: true, actBy: inst, actOpts: opts }); } catch (e) { j = null; }
      if (j) return { ok: true, line: "Yes, sir.", p: p };
    }
    if (verb !== "kill" || !body) act(verb, Object.assign({}, opts, { target: target, by: inst }));
    return { ok: true, line: "Yes, sir.", p: p };
  }

  // a body fell (presidency.js's kill-cause wrap reports every death)
  function onDeath(ped, info) {
    if (!ped || !ensure()) return null;
    info = info || {};
    const o = ped._politicsOrder;
    const killer = info.attacker && typeof info.attacker === "object" ? info.attacker : null;
    let by = null;
    if (info.byPlayer) by = "self";
    else if (o && o.verb === "kill") by = o.inst;
    else if (killer && killer._politicsOrder && killer._politicsOrder.verb === "attack") by = killer._politicsOrder.inst;
    const T = describe(ped);
    const notableDeath = T.notable >= 0.6 || T.role || T.member;
    if (!by && !notableDeath) return null;
    return act("kill", { target: ped, by: by || "unknown", blame: !!by });
  }

  // ================================================================
  //  INSTITUTIONS — their loyalty, their effects.
  // ================================================================
  function instLoyalty(k) { const s = ensure(); return s && s.inst[k] ? s.inst[k].loyalty : 85; }
  function instNudge(k, d) { if (!ensure()) return; instDelta(k, d); }
  function instFloor(k, v) { const s = ensure(); if (s && s.inst[k]) s.inst[k].loyalty = Math.max(s.inst[k].loyalty, v); }
  // does this institution still carry out the President's law?
  function obeys(k) { const s = ensure(); if (!s) return true; return instLoyalty(k) >= 40; }
  // the Secret Service's standing detail shrinks as it stops trusting him
  function detailSize(base) {
    const s = ensure();
    if (!s) return base;
    const L = instLoyalty("ss");
    if (L >= 50) return base;
    const n = Math.max(1, Math.round(base * (0.3 + 0.7 * L / 50)));
    if (day() - s.fx.detailNote > 3) { s.fx.detailNote = day(); emit("act", { verb: "walkout", headline: "Secret Service agents walk off the President's detail", sub: "The Service is said to have lost faith", breaking: true, reactions: [] }); }
    return n;
  }
  // a person's loyalty lives on his record; this is its only writer
  function person(role) { return cabinetRec(role); }
  function personLoyalty(role, d, floor) {
    const r = typeof role === "object" ? role : cabinetRec(role);
    if (!r || !isFinite(d)) return null;
    const v = isFinite(r.loyalty) ? +r.loyalty : 60;
    r.loyalty = clamp(v + d, floor != null ? floor : 0, 100);
    return r.loyalty;
  }

  // ================================================================
  //  CONGRESS
  // ================================================================
  function partyLoyalty(p) {
    const s = S();
    if (!s.groups) return 50;
    const W = PARTIES[p].w;
    let a = 0, w = 0;
    for (const k in W) { a += W[k] * s.groups[k].loyalty; w += W[k]; }
    return clamp(a / w + (s.congress ? s.congress.mood[p] : 0) + (p === s.presParty ? 10 : -5), 0, 100);
  }
  function partyPos(p) { const W = PARTIES[p].w, out = {}; DIMS.forEach(function (d) { let a = 0, w = 0; for (const k in W) { a += W[k] * POS[k][d]; w += W[k]; } out[d] = a / w; }); return out; }
  function sig(x) { return 1 / (1 + Math.exp(-x)); }
  function sitting() { const C = S().congress; return C ? C.seats.R + C.seats.D : 0; }
  // one vote: support per party = loyalty to the President (when he asks)
  // and the policy's fit with the party (always). yes = seats * support.
  function vote(kind, o) {
    o = o || {};
    const s = ensure();
    if (!s) return { pass: true, yes: 0, no: 0 };
    const C = s.congress;
    if (authoritarian()) return { pass: true, yes: sitting(), no: 0, stamp: true };
    const vec = o.vec || (NEEDS_VOTE[kind] ? (function () { const v = {}; v[NEEDS_VOTE[kind].dim] = NEEDS_VOTE[kind].dir; return v; })() : {});
    let yes = 0;
    const by = {};
    ["R", "D"].forEach(function (p) {
      const L = partyLoyalty(p), fit = dot(vec, partyPos(p));
      let x;
      if (kind === "impeach") x = (45 - L) / 7 + scandal() / 25 + (C.impeach || 0) / 30 - 1.2;
      else if (kind === "override") x = fit * 3 + (o.sponsor === p ? 2 : -0.5) - (p === s.presParty ? (L - 50) / 15 : 0);
      else if (kind === "bill") x = fit * 3 + (o.sponsor === p ? 1.5 : -0.5);
      else x = (L - 45) / 10 + fit * 2.2 + (o.lean || 0);
      const frac = sig(x);
      const n = Math.round(C.seats[p] * frac);
      by[p] = n; yes += n;
    });
    const tot = sitting();
    const need = kind === "impeach" || kind === "override" ? Math.ceil(tot * 2 / 3) : Math.floor(tot / 2) + 1;
    return { pass: yes >= need, yes: yes, no: tot - yes, need: need, by: by };
  }
  // the Senate confirms a cabinet pick (president_staff.js's pick())
  function confirm(role, cand) {
    if (!ensure() || authoritarian()) return true;
    const ideo = cand && cand.ideology || "dem";
    const fitR = AFF.rep[ideo] * 0.7 + AFF.nat[ideo] * 0.3, fitD = AFF.dem[ideo] * 0.7 + AFF.soc[ideo] * 0.3;
    const crony = cand && cand.trait === "loyal" ? -0.6 : 0;
    const C = S().congress;
    let yes = 0;
    ["R", "D"].forEach(function (p) { const x = (partyLoyalty(p) - 42) / 10 + (p === "R" ? fitR : fitD) * 2.4 + crony; yes += Math.round(C.seats[p] * sig(x)); });
    const pass = yes > sitting() / 2;
    emit("vote", { kind: "confirm", name: cand && cand.name, pass: pass, yes: yes, no: sitting() - yes, quiet: true });
    return pass;
  }
  // the orders Congress must authorise (presidency.js pressButton asks here)
  function gate(key) {
    if (!ensure() || !NEEDS_VOTE[key] || authoritarian()) return { ok: true };
    const s = S();
    if (key === "war" && s.warAuthorized != null && day() <= s.warAuthorized) return { ok: true };
    if (s.passed && s.passed[key] === day()) return { ok: true };       // voted today already
    const v = vote(key);
    if (v.pass) { s.passed = s.passed || {}; s.passed[key] = day(); }
    emit("vote", { kind: key, name: NEEDS_VOTE[key].name, pass: v.pass, yes: v.yes, no: v.no,
      headline: v.pass ? (key === "war" ? "Congress authorises the war, " + v.yes + " to " + v.no : null) : "Congress votes down " + NEEDS_VOTE[key].name, cat: "POLITICS" });
    return v.pass ? { ok: true } : { ok: false, why: "Congress voted it down, sir. " + v.yes + " to " + v.no + "." };
  }
  function congress() {
    const s = ensure();
    if (!s) return null;
    const C = s.congress;
    return { seats: { R: C.seats.R, D: C.seats.D }, vacant: C.vacant, banned: Object.keys(C.banned), presParty: s.presParty,
      loyalty: { R: Math.round(partyLoyalty("R")), D: Math.round(partyLoyalty("D")) }, mood: { R: C.mood.R, D: C.mood.D }, impeach: C.impeach,
      members: C.members.map(function (m) { return { sid: m.sid, name: m.name, party: m.party, ideology: m.ideology, leader: m.leader, status: m.status, body: m.body }; }) };
  }
  function wantsImpeachment() {
    const s = ensure();
    if (!s || authoritarian()) return false;
    return (s.congress.impeach || 0) >= 30 && vote("impeach").yes >= sitting() / 2;
  }

  // ================================================================
  //  BILLS AND EXECUTIVE ORDERS — data moves along the dimensions.
  // ================================================================
  function billName(dim, dir) { return BILL_NAMES[dim][dir > 0 ? 0 : 1]; }
  function makeBill(sponsor, dim, dir, size) {
    const s = S();
    const vec = {}; vec[dim] = dir * size;
    const id = "bill" + (++s.bills.seq);
    const lead = s.congress.members.filter(function (m) { return m.party === sponsor && m.leader && m.status === "sitting"; })[0];
    return { id: id, name: billName(dim, dir), dim: dim, dir: dir, size: size, vec: vec, sponsor: sponsor, sponsorName: lead ? lead.name : PARTIES[sponsor].name, day: day(), state: "desk" };
  }
  // Congress writes the next bill: the majority's biggest gap with where policy stands
  function draftBill(force) {
    const s = ensure();
    if (!s || authoritarian()) return null;
    if (!force && day() - s.bills.last < 2) return null;
    if (s.bills.list.some(function (b) { return b.state === "desk"; })) return null;
    const C = s.congress;
    const maj = C.seats.R >= C.seats.D ? "R" : "D";
    const pp = partyPos(maj);
    let best = null, bv = 0.15;
    DIMS.forEach(function (d, i) {
      const gap = pp[d] - (s.policy[d] || 0);
      const v = Math.abs(gap) + h01("bill:" + day() + ":" + d) * 0.2;
      if (v > bv) { bv = v; best = { d: d, dir: gap >= 0 ? 1 : -1 }; }
    });
    if (!best) return null;
    s.bills.last = day();
    const b = makeBill(maj, best.d, best.dir, 0.2);
    const v = vote("bill", { vec: b.vec, sponsor: maj });
    if (!v.pass) { emit("vote", { kind: "bill", name: b.name, pass: false, yes: v.yes, no: v.no, headline: b.name + " fails in Congress", cat: "POLITICS" }); return null; }
    b.yes = v.yes; b.no = v.no;
    s.bills.list.push(b);
    if (s.bills.list.length > 20) s.bills.list.shift();
    emit("vote", { kind: "bill", name: b.name, pass: true, yes: v.yes, no: v.no, headline: "Congress passes the " + b.name, cat: "POLITICS" });
    deliver({ id: "pol:" + b.id, via: "folder", topic: "bill", who: chiefWho(), line: "The " + b.name.replace(/ Act$/, "") + " bill, sir.",
      memo: { dept: "Office of Legislative Affairs", subject: b.name, body: ["Passed " + v.yes + " to " + v.no + ".", "Sponsor: " + b.sponsorName + ".", whatItDoes(b)], rec: "Sign or veto." },
      yes: { label: "Sign", run: function () { sign(b.id); } }, no: { label: "Veto", run: function () { veto(b.id); } }, noVerb: "Veto", expires: 1e9, bill: b.id });
    return b;
  }
  function whatItDoes(b) {
    const up = b.dir > 0;
    return ({ military: up ? "Raises defense spending and soldiers' pay." : "Cuts defense spending.", police: up ? "More powers and pay for the police." : "Reins in the police.",
      liberty: up ? "Protects speech and assembly." : "Restricts public gatherings.", surveillance: up ? "Wider powers for the intelligence services." : "Limits on surveillance.",
      taxes: up ? "Raises taxes." : "Cuts taxes.", welfare: up ? "More money for pensions and benefits." : "Cuts benefits.",
      nation: up ? "Tightens the border." : "Opens the border.", press: up ? "Protects reporters." : "Licenses the press.",
      war: up ? "Authorises the use of force." : "Brings the troops home." })[b.dim];
  }
  function lawEffects(b) {
    const s = S(), rec = seatRec();
    const sz = b.size / 0.2;
    if (b.dim === "military") { s.inst.army.pay = clamp(s.inst.army.pay + 0.06 * b.dir * sz, 0.6, 1.8); if (rec) rec.treasury = Math.max(0, (rec.treasury || 0) - (b.dir > 0 ? 12000 : -8000)); }
    if (b.dim === "police") { s.inst.police.pay = clamp(s.inst.police.pay + 0.06 * b.dir * sz, 0.6, 1.8); if (rec) rec.treasury = Math.max(0, (rec.treasury || 0) - (b.dir > 0 ? 8000 : -5000)); }
    if (b.dim === "surveillance" && b.dir > 0) { instDelta("cia", 5); instDelta("fbi", 4); }
    if (b.dim === "taxes" && rec) rec.taxRate = clamp((rec.taxRate != null ? rec.taxRate : 0.1) + 0.03 * b.dir * sz, 0, 0.4);
    if (b.dim === "welfare" && rec) rec.treasury = Math.max(0, (rec.treasury || 0) - 9000 * b.dir * sz);
    if (b.dim === "war" && b.dir > 0) s.warAuthorized = day() + 7;
  }
  function billById(id) { const s = ensure(); return s ? s.bills.list.filter(function (b) { return b.id === id; })[0] || null : null; }
  function sign(id) {
    const b = billById(id);
    if (!b || b.state !== "desk") return { ok: false, why: "That's settled, sir." };
    b.state = "law";
    lawEffects(b);
    S().congress.mood[b.sponsor] = clamp(S().congress.mood[b.sponsor] + 4, -60, 40);
    const r = act("policy", { target: { kind: "policy", name: b.name, policy: b.name, notable: 1 }, vec: b.vec, verbWord: "sign", news: true, sponsor: b.sponsor });
    return { ok: true, line: "Signed.", bill: b, result: r };
  }
  function veto(id) {
    const b = billById(id);
    if (!b || b.state !== "desk") return { ok: false, why: "That's settled, sir." };
    b.state = "vetoed";
    const s = S();
    s.congress.mood[b.sponsor] = clamp(s.congress.mood[b.sponsor] - 6, -60, 40);
    // vetoing a move along a dimension is its opposite, felt half as hard
    const vec = {}; vec[b.dim] = -b.vec[b.dim] * 0.5;
    const G = movePolicy(vec, 1);
    for (const k in s.policy) if (vec[k]) s.policy[k] = clamp(s.policy[k] - vec[k], -1, 1);    // a veto keeps policy where it was
    apply_(G, {});
    emit("act", { verb: "veto", target: { kind: "policy", name: b.name, policy: b.name }, by: "self", agent: "the President", count: 1, reactions: reactions(G, null, "veto"), news: true, breaking: false });
    const v = vote("override", { vec: b.vec, sponsor: b.sponsor });
    if (v.pass) {
      b.state = "law"; b.overridden = true;
      lawEffects(b);
      const G2 = movePolicy(b.vec, 1);
      apply_(G2, {});
      emit("act", { verb: "override", target: { kind: "policy", name: b.name, policy: b.name }, by: "congress", agent: "Congress", count: 1, yes: v.yes, no: v.no, reactions: reactions(G2, null, "override"), news: true, breaking: true });
      return { ok: true, line: "They'll override you, sir.", overridden: true, vote: v };
    }
    return { ok: true, line: "The veto holds.", overridden: false, vote: v };
  }
  // the generic policy act (bills, executive orders) rides here
  function policyAct(o) {
    const vec = o.vec || {};
    const dG = movePolicy(vec, 1);
    apply_(dG, {});
    return dG;
  }
  // EXECUTIVE ORDERS — generic: a policy vector, maybe a target, maybe an institution
  const EO = {
    surveillance: { order: "surveillance", name: "the surveillance order" },
    nationalise: { order: "nationalise", name: "nationalisation" },
    ban: { verb: "ban" },
    deploy: { verb: "deploy", inst: "army" },
    raisepay: { verb: "raisepay" },
    cutpay: { verb: "cutpay" },
    martial: { press: "martial" }, curfew: { press: "curfew" },
  };
  function executive(kind, target, o) {
    o = o || {};
    const s = ensure();
    if (!s) return { ok: false, why: "You do not hold the country." };
    const E = EO[kind];
    if (!E) return { ok: false, why: "No such order." };
    if (E.press) { const P = Pz(); return P && P.press ? P.press(E.press) : { ok: false, why: "" }; }
    if (E.order) { const r = act(E.order, { news: true, headline: "President signs " + E.name, target: target }); return { ok: true, line: "Done, sir.", result: r }; }
    if (kind === "deploy") return deployAgainst(target);
    if (kind === "raisepay" || kind === "cutpay") return pay(target, kind === "raisepay" ? (o.amount || 0.1) : -(o.amount || 0.1));
    const r = act(E.verb, { target: target, by: "self", news: true });
    return { ok: true, line: "Done, sir.", result: r };
  }
  // the Army against the President's own people: only if it is loyal enough
  function deployAgainst(target) {
    const s = S();
    const L = instLoyalty("army");
    const gen = cabinetRec("general");
    if (!gen || gen.dead) return { ok: false, why: "There is no General to give it to." };
    if (L < DEPLOY_MIN) {
      instDelta("army", -8);                                 // the refusal climbs the coup ladder (army = 100 - loyalty)
      personLoyalty(gen, -6);
      if (CBZ.dissent && CBZ.dissent.plot && L < 45) { try { CBZ.dissent.plot({ name: gen.name, sid: gen.sid, push: 0 }); } catch (e) {} }
      writeApproval();
      emit("order-refused", { inst: "army", verb: "deploy", target: describe(target).name, line: "I won't turn the army on our own people, sir." });
      return { ok: false, refused: true, line: "I won't turn the army on our own people, sir.", why: "I won't turn the army on our own people, sir." };
    }
    // THE ARMY MOVES: real troopers on the street (statecraft's martial
    // deployment through the presidency's own order), the protest broken
    let moved = null;
    const P = Pz();
    if (P && P.press) { try { moved = during(function () { return P.press("martial"); }); } catch (e) { moved = null; } }
    const r = act("deploy", { target: target, by: "army", news: true });
    return { ok: true, line: "The army moves tonight.", moved: !!(moved && moved.ok), result: r };
  }
  function pay(inst, d) {
    const s = S();
    const I = s.inst[inst];
    if (!I) return { ok: false, why: "No such service." };
    const rec = seatRec();
    const cost = Math.round(INST[inst].staff * Math.abs(d) * 30);
    if (d > 0 && rec && (rec.treasury || 0) < cost) return { ok: false, why: "The treasury can't carry it, sir." };
    if (rec) rec.treasury = Math.max(0, (rec.treasury || 0) - (d > 0 ? cost : -cost * 0.5));
    I.pay = clamp(I.pay + d, 0.6, 2);
    const r = act(d > 0 ? "raisepay" : "cutpay", { target: inst, by: "self", news: true, scale: Math.abs(d) / 0.1 });
    return { ok: true, line: d > 0 ? "They'll hear about it tonight." : "They won't like it.", cost: cost, result: r };
  }

  // ================================================================
  //  CORRUPTION — deals with heads; every one a hidden risk.
  // ================================================================
  function deal(inst, o) {
    o = o || {};
    const s = ensure();
    if (!s || !INST[inst]) return { ok: false, why: "Nobody to deal with." };
    const role = INST[inst].head, head = cabinetRec(role);
    if (!head || head.dead) return { ok: false, why: "That chair is empty." };
    const kind = o.kind || "bribe";
    const amount = o.amount != null ? o.amount : 40000;
    if (kind === "bribe") {
      const rec = seatRec();
      if (o.from === "cash") { if ((g.cash || 0) < amount) return { ok: false, why: "You don't have it." }; g.cash -= amount; }
      else if (rec) { if ((rec.treasury || 0) < amount) return { ok: false, why: "The treasury is short." }; rec.treasury -= amount; }
    }
    if (kind === "pardon" && o.who) releaseHeld(describe(o.who));
    personLoyalty(head, kind === "promotion" ? 10 : 15);
    act(kind === "bribe" ? "bribe" : "deal", { target: role, by: "self", institution: inst });
    return { ok: true, line: kind === "bribe" ? "We understand each other, sir." : "I won't forget it, sir." };
  }
  function secret(kind, T, opts) {
    const s = S();
    s.secrets.push({ day: day(), kind: kind, name: T ? T.name : null, title: T ? T.title : "", inst: T ? T.inst : null, found: false, id: s.secrets.length + 1 });
  }
  function discover(d) {
    const s = S();
    for (let i = 0; i < s.secrets.length; i++) {
      const X = s.secrets[i];
      if (X.found || d <= X.day) continue;
      let p = 0.05 + (instLoyalty("fbi") < 60 ? 0.12 : 0) + (instLoyalty("cia") < 50 ? 0.12 : 0) + (scandal() > 40 ? 0.05 : 0);
      if (h01("secret:" + X.id + ":" + d) < p) {
        X.found = d;
        const who = (X.title ? X.title + " " : "") + (X.name || "an official");
        const how = instLoyalty("cia") < 50 ? "leak" : instLoyalty("fbi") < 60 ? "Bureau" : "reporter";
        addScandal(12);
        GROUP_IDS.forEach(function (k) { jolt(k, -2); });
        writeApproval();
        emit("act", { verb: "exposed", target: { kind: "person", name: X.name, title: X.title }, by: how, count: 1, news: true, breaking: true,
          headline: "Secret payments to " + who + " uncovered", sub: how === "leak" ? "Leaked from inside the intelligence service" : how === "Bureau" ? "Bureau investigators follow the money" : "A reporter follows the money",
          reactions: reactions({ dem: -3, rep: -3 }, null, "exposed") });
      }
    }
  }

  // ================================================================
  //  PARDONS
  // ================================================================
  function held() { const s = ensure(); return s ? heldList() : []; }
  function pardon(who) {
    const s = ensure();
    if (!s) return { ok: false, why: "You do not hold the country." };
    const L = heldList();
    const H = typeof who === "object" && who && who.sid ? L.filter(function (h) { return h.sid === who.sid; })[0] : L.filter(function (h) { return h.sid === who || h.name === who || h.id === who; })[0];
    if (!H) return { ok: false, why: "Nobody by that name is held." };
    act("pardon", { target: { kind: "person", _desc: 1, sid: H.sid, name: H.name, title: H.title || (H.gang != null ? "Gang leader" : ""), ideology: H.ideology || "dem",
      gang: H.gang, gangName: H.gangName, party: H.party, notable: H.kind === "citizen" ? 0.2 : 0.6, lawless: H.gang != null, member: H.kind === "member" ? H.sid : null, inst: H.inst }, by: "self", news: true });
    return { ok: true, line: "He walks out today.", who: H };
  }
  function debts() { const s = ensure(); return s ? Object.assign({}, s.debts) : {}; }

  // ================================================================
  //  THE STREET — read off the groups, not counted beside them.
  // ================================================================
  function anger(k) { const G = S().groups[k]; return G ? 100 - G.loyalty : 0; }
  function angriest() {
    const s = ensure();
    if (!s) return null;
    let best = null, bv = -1;
    GROUP_IDS.forEach(function (k) { const v = anger(k) * Math.sqrt(s.groups[k].share / 0.1); if (v > bv) { bv = v; best = k; } });
    return best ? { id: best, name: GROUPS[best].name, adj: GROUPS[best].adj, anger: anger(best), share: s.groups[best].share, slogans: VOICE[best].slogan.slice() } : null;
  }
  function unrest() {
    const s = ensure();
    if (!s) return 0;
    return clamp((100 - aggregate() - 45) * 2.4 + scandal() * 0.25, 0, 100);
  }
  function movement() {
    const s = ensure();
    if (!s) return 0;
    let best = 0;
    GROUP_IDS.forEach(function (k) { const v = (anger(k) - 55) * 2.4 * Math.min(1, s.groups[k].share / 0.06); if (v > best) best = v; });
    return clamp(best - (s.fear || 0), 0, 100);
  }
  function streetAnger() { if (!ensure()) return 0; return clamp(Math.max(0, (65 - aggregate()) / 35) + movement() / 160, 0, 1.5); }
  function fear() { const s = ensure(); return s ? s.fear : 0; }

  // ================================================================
  //  THE DAY — drift, the institutions' effects, Congress, the desk.
  // ================================================================
  function conditionsBase(rec) {
    // approval.js's own equation, as its country blend would read it: the
    // average of this country's states. No states: where we started.
    const s = S();
    if (CBZ.polity && CBZ.polity.list) {
      try {
        const st = CBZ.polity.list("state").filter(function (x) { return x.parent === rec.id; });
        if (st.length) { let a = 0; st.forEach(function (x) { a += x.approval || 0; }); return a / st.length; }
      } catch (e) {}
    }
    return s.base != null ? s.base : 50;
  }
  function drift(dayN) {
    const s = ensure();
    if (!s) return;
    const rec = seatRec();
    const base = conditionsBase(rec);
    const L = lean(s.presParty);
    GROUP_IDS.forEach(function (k) {
      const G = s.groups[k];
      const fit = FIT * dot(s.policy, POS[k]);
      const eq = clamp(base + L[k] + fit + G.griev, 0, 100);
      G.loyalty = clamp(G.loyalty + (eq - G.loyalty) * 0.12, 0, 100);
      G.griev *= 0.85;
    });
    INST_IDS.forEach(function (k) {
      const I = s.inst[k];
      const head = cabinetRec(INST[k].head);
      const headTerm = head && !head.dead ? ((isFinite(head.loyalty) ? head.loyalty : 60) - 60) * 0.25 : -8;
      const fit = INST[k].lean ? 10 * (s.policy[INST[k].lean] || 0) : 0;
      const eq = clamp(80 + 40 * (I.pay - 1) + headTerm + fit + I.griev, 0, 100);
      I.loyalty = clamp(I.loyalty + (eq - I.loyalty) * 0.1, 0, 100);
      I.griev *= 0.9;
    });
    s.fear = Math.max(0, (s.fear || 0) - 5);
    const C = s.congress;
    C.mood.R *= 0.93; C.mood.D *= 0.93; C.impeach = Math.max(0, C.impeach - 4);
    writeApproval();
  }
  // the people the President keeps: officers' loyalty drifts by temperament
  function roles() {
    const p = Pz();
    if (p && p.CABINET_ROLES) return p.CABINET_ROLES;
    let c = {};
    try { c = p && p.cabinet ? p.cabinet() || {} : {}; } catch (e) { c = {}; }
    return Object.keys(c).filter(function (k) { return k !== "vp"; }).map(function (k) { return { key: k }; });
  }
  function personDrift() {
    const L = roles();
    L.forEach(function (R) {
      const r = cabinetRec(R.key);
      if (!r || r.dead) return;
      if (!isFinite(r.loyalty)) r.loyalty = 60;
      if (r.trait === "able") personLoyalty(r, -1.5);
      if (r.trait === "loyal") personLoyalty(r, 0, 50);
    });
  }
  function institutionsAct(d) {
    const s = S();
    // THE BUREAU turns: it investigates the President (the one scandal)
    if (instLoyalty("fbi") < 40) {
      if (!s.fx.investigation) { s.fx.investigation = d; emit("act", { verb: "investigate", headline: "Bureau opens an investigation into the President", sub: "Agents are said to be pulling records", breaking: true, news: true, reactions: [] }); }
      addScandal(3);
    } else if (s.fx.investigation && instLoyalty("fbi") > 55) s.fx.investigation = null;
    // THE AGENCY leaks
    if (instLoyalty("cia") < 40 && d - s.fx.leakDay >= 2) {
      s.fx.leakDay = d;
      addScandal(4);
      GROUP_IDS.forEach(function (k) { jolt(k, -1.5); });
      const T = ["the President's calls", "the war plans", "who the President meets", "the Mansion's guest list"][hash("leak" + d) % 4];
      emit("act", { verb: "leak", headline: "Intelligence leak exposes " + T, sub: "The Agency is not denying it", news: true, reactions: [] });
    }
    // THE POLICE stop enforcing his curfew (statecraft reads obeys("police"))
    const G = CBZ.gov;
    const curfew = G && G.curfewUntil ? (function () { try { return (G.curfewUntil() || 0) > d; } catch (e) { return false; } })() : false;
    if (curfew && !obeys("police") && d - s.fx.curfewNote > 2) { s.fx.curfewNote = d; emit("act", { verb: "defy", headline: "Police stop enforcing the curfew", sub: "Officers say the order isn't theirs", news: true, reactions: [] }); }
    // THE EXTREMES: riots, militias
    GROUP_IDS.forEach(function (k) {
      const Gr = s.groups[k];
      if (Gr.loyalty > 14 || Gr.share < 0.02 || (s.fx.riotDay[k] != null && d - s.fx.riotDay[k] < 3)) return;
      s.fx.riotDay[k] = d;
      const P = CBZ.player;
      const militia = k === "nazi" || k === "fas" || k === "nat";
      if (CBZ.cityPostEvent && P && P.pos) { try { CBZ.cityPostEvent({ type: "riot", pos: { x: P.pos.x + 60, y: 0, z: P.pos.z + 40 }, radius: 26, intensity: militia ? 0.95 : 0.75 }); } catch (e) {} }
      emit("act", { verb: militia ? "militia" : "riot", headline: militia ? "Armed " + GROUPS[k].adj + " militia marches in the capital" : GROUPS[k].name + " riot in the capital", breaking: true, news: true,
        reactions: [{ group: k, groupName: GROUPS[k].name, mood: "angry", name: FIRST[hash(k + d) % FIRST.length] + " " + LAST[hash(d + k) % LAST.length], handle: "@" + VOICE[k].handle + (d % 90 + 10), text: VOICE[k].angry[d % VOICE[k].angry.length] }] });
    });
  }
  function congressDay(d) {
    const s = S(), C = s.congress;
    for (let i = C.specials.length - 1; i >= 0; i--) {
      const sp = C.specials[i];
      if (d < sp.day) continue;
      C.specials.splice(i, 1);
      if (C.banned[sp.party]) continue;
      const party = h01("special:" + sp.sid) < 0.7 ? sp.party : (sp.party === "R" ? "D" : "R");
      C.seats[party]++; C.vacant = Math.max(0, C.vacant - 1);
      const m = mintName("special:" + sp.sid);
      C.members.push({ sid: stash(m.name, m.gender, "senator"), name: m.name, gender: m.gender, party: party, ideology: party === "R" ? "rep" : "dem", leader: false, status: "sitting", body: false });
      emit("vote", { kind: "special", name: m.name, pass: true, headline: "Special election: " + PARTIES[party].adj + " " + m.name + " takes " + surname(sp.name) + "'s seat", cat: "POLITICS" });
    }
    // a party that lost its leader names a new one
    ["R", "D"].forEach(function (p) {
      if (C.members.some(function (m) { return m.party === p && m.leader && m.status === "sitting"; })) return;
      const nx = C.members.filter(function (m) { return m.party === p && m.status === "sitting"; })[0];
      if (nx) nx.leader = true;
    });
    draftBill(false);
  }
  // the desk: things come to the President as folders (president_office.js)
  function chiefWho() {
    const c = cabinetRec("chief");
    return c && !c.dead ? { name: c.name, role: "chief" } : { name: "An aide", role: "aide" };
  }
  function deliver(m) {
    const s = S();
    s.desk.push({ id: m.id, topic: m.topic, line: m.line, day: day(), m: m });
    if (s.desk.length > 12) s.desk.shift();
    const O = CBZ.presidentOffice;
    if (O && O.offer) { try { O.offer(m); } catch (e) {} }
    return m;
  }
  function deskDay(d) {
    const s = S();
    // the poll, in words
    if (s.fx.pollDay !== d) {
      s.fx.pollDay = d;
      deliver({ id: "pol:poll:" + d, via: "folder", topic: "poll", kind: "people", who: { name: "The pollster", role: "aide" }, expires: 1e9,
        line: "The numbers, sir.", memo: { dept: "Office of Public Opinion", subject: "Where the country stands", body: pollLines(), rec: "For your eyes only." },
        yes: { label: "File it" }, no: { label: "Bin it" } });
    }
    // executive orders, when the state calls for them (one a day at most)
    if (d - s.fx.eoDay >= 1) {
      const A = angriest(), mv = movement();
      let m = null;
      const rec = seatRec();
      if (mv >= 40 && A) {
        const tgt = A.id;
        m = { id: "pol:eo:deploy:" + d, topic: "deploy", line: "The " + A.name.toLowerCase() + " are organising, sir. The General can put the army on them.",
          memo: { dept: "Office of the Chief of Staff", subject: "Executive order: the army against the " + A.name, body: ["The movement is " + A.adj + ".", "The Army would have to be loyal to do it."], rec: "Sign to deploy." },
          yes: { label: "Sign", run: function () { executive("deploy", tgt); } }, no: { label: "Send it back" } };
      } else if (instLoyalty("fbi") < 65 || instLoyalty("cia") < 65) {
        m = { id: "pol:eo:surv:" + d, topic: "surveillance", line: "The agencies want wider powers, sir.", memo: { dept: "Office of the Chief of Staff", subject: "Executive order: surveillance", body: ["Wider powers for the Bureau and the Agency.", "Civil liberties groups will howl."], rec: "Sign it." },
          yes: { label: "Sign", run: function () { executive("surveillance"); } }, no: { label: "Send it back" } };
      } else if (rec && (rec.treasury || 0) < 20000) {
        m = { id: "pol:eo:nat:" + d, topic: "nationalise", line: "We could take the big firms, sir.", memo: { dept: "Treasury", subject: "Executive order: nationalisation", body: ["The state takes the largest firms.", "The money comes in. Business will not forgive it."], rec: "Sign it." },
          yes: { label: "Sign", run: function () { executive("nationalise"); } }, no: { label: "Send it back" } };
      } else {
        let low = null, lv = 70;
        INST_IDS.forEach(function (k) { if (instLoyalty(k) < lv) { lv = instLoyalty(k); low = k; } });
        if (low) {
          m = { id: "pol:eo:pay:" + low + ":" + d, topic: "pay", line: INST[low].Name + " wants a raise, sir.", memo: { dept: "Office of the Chief of Staff", subject: "Pay for " + INST[low].name, body: ["A ten percent raise.", "It costs the treasury."], rec: "Sign it." },
            yes: { label: "Sign", run: function () { pay(low, 0.1); } }, no: { label: "Send it back" } };
        }
      }
      if (m) { s.fx.eoDay = d; m.via = "folder"; m.who = chiefWho(); m.expires = 1e9; deliver(m); }
    }
    // the heads come with their deals
    INST_IDS.forEach(function (k) {
      if (instLoyalty(k) >= 72 || (s.fx.dealDay[k] != null && d - s.fx.dealDay[k] < 3)) return;
      const role = INST[k].head, head = cabinetRec(role);
      if (!head || head.dead) return;
      s.fx.dealDay[k] = d;
      deliver({ id: "pol:deal:" + k + ":" + d, via: "any", topic: "deal", who: { name: head.name, role: role }, expires: 300,
        line: "Sir, my people are restless. Something quiet would settle them. Forty thousand.",
        yes: { label: "Arrange it", run: function () { deal(k, { kind: "bribe", amount: 40000 }); } }, no: { label: "No", run: function () { personLoyalty(head, -4); } } });
    });
    // the held ask for a pardon through someone
    const HL = heldList();
    for (let i = 0; i < HL.length; i++) {
      const H = HL[i];
      if (H.asked || d - H.day < 1) continue;
      H.asked = d;
      const via = H.gang != null ? "His lawyer" : H.kind === "member" ? (PARTIES[H.party] ? PARTIES[H.party].adj + " leadership" : "His party") : H.kind === "minister" ? "His family" : "A lawyer";
      deliver({ id: "pol:pardon:" + H.sid, via: "folder", topic: "pardon", who: { name: via, role: "aide" }, expires: 1e9,
        line: via + " asks for a pardon for " + surname(H.name) + ", sir.",
        memo: { dept: "Office of the Pardon Attorney", subject: "Pardon: " + H.name, body: [(H.title ? H.title + ". " : "") + "Held since day " + H.day + ".", via + " asks for clemency."], rec: "Sign the pardon." },
        yes: { label: "Pardon", run: function () { pardon(H.sid); } }, no: { label: "Send it back" } });
      break;
    }
  }
  function pollWord(l) { return l >= 70 ? "with you" : l >= 55 ? "warm" : l >= 42 ? "split" : l >= 28 ? "cold" : l >= 15 ? "angry" : "furious"; }
  function pollLines() {
    const s = S();
    const out = ["Overall, " + Math.round(aggregate()) + "% approve."];
    GROUP_IDS.slice().sort(function (a, b) { return s.groups[b].share - s.groups[a].share; }).forEach(function (k) { out.push(GROUPS[k].name + ": " + pollWord(s.groups[k].loyalty) + "."); });
    return out;
  }
  // what the Chief says when you ask (president_staff.js's Talk)
  function chiefLine() {
    const s = ensure();
    if (!s) return "";
    const words = { army: "The Army's restless, sir.", police: "The police are tired of us, sir.", fbi: "The Bureau is looking at you, sir.", cia: "The Agency is talking to reporters, sir.", ss: "Your own detail doesn't trust you, sir." };
    let low = null, lv = 50;
    INST_IDS.forEach(function (k) { if (instLoyalty(k) < lv) { lv = instLoyalty(k); low = k; } });
    if (low) return words[low];
    const A = angriest();
    if (A && A.anger >= 70) return "The " + A.name.toLowerCase() + " are in the street, sir.";
    const b = s.bills.list.filter(function (x) { return x.state === "desk"; })[0];
    if (b) return "The " + b.name.replace(/ Act$/, "") + " bill is on your desk, sir.";
    if (wantsImpeachment()) return "Congress is counting votes against you, sir.";
    return "";
  }

  // ================================================================
  //  WORLD EVENTS on the bus (not the President's acts, still felt)
  // ================================================================
  function onBus(evt, d) {
    d = d || {};
    const h = seat();
    if (!h || !ensure()) return;
    const me = h.id;
    // the country's verdict on a war's end arrives as polwar's own shock
    // (approvalShock -> shock() above); the Army feels it in its loyalty
    if (evt === "war-ended") {
      if (d.loser === me) instDelta("army", -12);
      else if (d.winner === me) instDelta("army", 8);
      writeApproval();
    } else if (evt === "war-declared" && d.defender === me && !d.byPlayer) {
      instDelta("army", 4); writeApproval();
    }
  }
  let hooked = false;
  function hook() {
    if (hooked) return;
    const p = Pz();
    if (!p || typeof p.on !== "function") return;
    hooked = true;
    try { p.on("*", function (payload, evt) { try { onBus(String(evt || ""), payload); } catch (e) {} }); } catch (e) {}
  }
  function daily(d) {
    hook();
    if (!ensure()) return;
    drift(d);
    personDrift();
    institutionsAct(d);
    discover(d);
    congressDay(d);
    deskDay(d);
    writeApproval();
  }
  if (CBZ.onNewDay) CBZ.onNewDay(function (d) { try { daily(d); } catch (e) {} });

  // ================================================================
  //  BODIES AT THE CAPITOL — a few members stand on the plaza while you
  //  are near; they are the same members the votes count.
  // ================================================================
  const BODIES = { peds: {}, t: 0 };
  function capitol() { const L = CBZ.govComplexes || []; for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "capitol" && L[i].seatPoint && L[i].gate) return L[i]; return null; }
  function tickBodies(dt) {
    BODIES.t -= dt;
    if (BODIES.t > 0) return;
    BODIES.t = 1;
    hook();
    const s = ready() ? S() : null;
    const c = capitol(), P = CBZ.player;
    const near = !!(s && c && P && P.pos && Math.hypot(P.pos.x - c.seatPoint.x, P.pos.z - c.seatPoint.z) < 140);
    for (const sid in BODIES.peds) {
      const p = BODIES.peds[sid], m = s ? member(sid) : null;
      if (p && p.dead) { delete BODIES.peds[sid]; continue; }        // the kill wrap reports it
      if (!near || !m || m.status !== "sitting") { if (p && CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(p); } catch (e) {} } delete BODIES.peds[sid]; }
    }
    if (!near || !CBZ.cityPostNpc) return;
    const sp = c.seatPoint, gt = c.gate;
    const dx = gt.x - sp.x, dz = gt.z - sp.z, L = Math.hypot(dx, dz) || 1, nx = dx / L, nz = dz / L;
    let i = 0;
    s.congress.members.forEach(function (m) {
      if (!m.body || m.status !== "sitting" || BODIES.peds[m.sid]) { i++; return; }
      const side = (i % 2 ? 1 : -1) * (3 + i * 1.6), along = 8 + (i % 3) * 2;
      let p = null;
      try { p = CBZ.cityPostNpc(sp.x + nx * along - nz * side, sp.z + nz * along + nx * side, { job: "senator", archetype: "professional", armed: false, gender: m.gender, pin: true, face: Math.atan2(nx, nz), aggr: 0.05, wealth: 0.8, src: "politics:congress" }); } catch (e) { p = null; }
      i++;
      if (!p) return;
      p.name = (m.leader ? PARTIES[m.party].adj + " Leader " : "Senator ") + m.name; p.nameKnown = true; p.organization = "state"; p._stateStaff = true; p._congress = m.sid; p._sid = m.sid; p._ideology = m.ideology;
      BODIES.peds[m.sid] = p;
      if (CBZ.interactions && CBZ.interactions.registerFor) {
        try {
          CBZ.interactions.registerFor(p, { id: "pol-senator-talk", speak: true, prio: 30, campaignSafe: true, label: "Talk",
            canShow: function () { return !!seat() && !p.dead; },
            onSelect: function () { const L2 = partyLoyalty(m.party); const line = L2 >= 65 ? "Mr. President. We're with you." : L2 >= 45 ? "Mr. President." : L2 >= 25 ? "We're watching you, sir." : "You'll get nothing from us."; if (CBZ.citySay) CBZ.citySay(p, line, "#dfe7ff", 2.6); } });
        } catch (e) {}
      }
    });
  }
  if (CBZ.onUpdate) CBZ.onUpdate(36.4, function (dt) { if (g.mode && g.mode !== "city") return; try { tickBodies(dt || 0.016); } catch (e) {} });

  // ================================================================
  //  THE CABINET'S IDEOLOGY — stamped once, the President's party mostly
  // ================================================================
  function stampCabinet() {
    const L = roles();
    const s = S();
    const main = s.presParty === "R" ? "rep" : "dem", flank = s.presParty === "R" ? "nat" : "soc";
    L.forEach(function (R) {
      const r = cabinetRec(R.key);
      if (!r || r.ideology) return;
      const x = h01("cabideo:" + R.key + ":" + r.name);
      r.ideology = R.key === "general" ? (x < 0.5 ? "nat" : main) : x < 0.75 ? main : x < 0.9 ? flank : (main === "rep" ? "dem" : "rep");
    });
  }
  // the two names the Chief brings differ by ideology where it matters
  function nomineeIdeologies(role) {
    const s = ensure();
    const rec = seatRec();
    const gov = String(rec && rec.govType || "");
    if (!s) return ["dem", "rep"];
    const main = s.presParty === "R" ? "rep" : "dem", other = main === "rep" ? "dem" : "rep";
    let loyal = s.presParty === "R" ? "nat" : "soc";
    if (/fascis/.test(gov)) loyal = "fas"; else if (/communis/.test(gov)) loyal = "com"; else if (/dictator|junta/.test(gov)) loyal = "nat";
    const x = h01("nomideo:" + role + ":" + day());
    if (!/fascis|communis|dictator|junta/.test(gov) && x < 0.45) loyal = main;
    if (/fascis/.test(gov) && x < 0.3) loyal = "nazi";
    return [loyal, x < 0.5 ? other : main];
  }

  // ================================================================
  //  SAVE + AUDIT + PUBLIC
  // ================================================================
  function serialize() { const s = S(); return s.groups ? JSON.parse(JSON.stringify(s)) : null; }
  function apply(obj) { const s = S(); for (const k in s) delete s[k]; if (obj && obj.v === 1) Object.assign(s, JSON.parse(JSON.stringify(obj))); }
  function reset() { const s = S(); for (const k in s) delete s[k]; }
  function groupsRead() {
    const s = ensure();
    if (!s) return [];
    return GROUP_IDS.map(function (k) { return { id: k, name: GROUPS[k].name, adj: GROUPS[k].adj, share: s.groups[k].share, people: Math.round(s.groups[k].share * s.pop), loyalty: s.groups[k].loyalty, banned: s.groups[k].banned || null }; });
  }
  function institutionsRead() {
    const s = ensure();
    if (!s) return [];
    return INST_IDS.map(function (k) { const h = cabinetRec(INST[k].head); return { id: k, name: INST[k].Name, loyalty: s.inst[k].loyalty, pay: s.inst[k].pay, refused: s.inst[k].refused, head: h && !h.dead ? { role: INST[k].head, name: h.name, loyalty: h.loyalty, ideology: h.ideology } : null }; });
  }
  function audit() {
    const s = S();
    return { seat: s.seat || null, approval: s.groups ? Math.round(aggregate() * 10) / 10 : null, absorbed: s.absorbed | 0, held: s.groups ? heldList().length : 0,
      secrets: s.secrets ? s.secrets.length : 0, bills: s.bills ? s.bills.list.length : 0, desk: s.desk ? s.desk.length : 0, bodies: Object.keys(BODIES.peds).length };
  }

  CBZ.politics = {
    act: act,
    order: order, refusalChance: refusalChance, describe: describe, owns: owns,
    approval: function () { return ensure() ? aggregate() : null; },
    groups: groupsRead, institutions: institutionsRead,
    inst: function (k) { const s = ensure(); return s && s.inst[k] ? Object.assign({ id: k }, s.inst[k]) : null; },
    instLoyalty: instLoyalty, instNudge: function (k, d) { instNudge(k, d); writeApproval(); }, instFloor: instFloor, obeys: obeys, detailSize: detailSize,
    person: person, personLoyalty: personLoyalty,
    congress: congress, vote: vote, confirm: confirm, gate: gate, wantsImpeachment: wantsImpeachment, partyLoyalty: partyLoyalty,
    unrest: unrest, movement: movement, streetAnger: streetAnger, angriest: angriest, fear: fear, chiefLine: chiefLine,
    bills: function () { const s = ensure(); return s ? s.bills.list.slice() : []; }, draftBill: draftBill, sign: sign, veto: veto, executive: executive,
    pardon: pardon, held: held, deal: deal, debts: debts, pay: pay,
    shock: shock, setApproval: setApproval, during: during, drift: drift, onDeath: onDeath,
    // a world event that is not an act of the President's: the same groups, the same scandal
    event: function (kind, o) { if (!ensure()) return; o = o || {}; if (o.all) GROUP_IDS.forEach(function (k) { jolt(k, o.all); }); if (o.groups) for (const k in o.groups) jolt(k, o.groups[k]); if (o.inst) for (const k in o.inst) instDelta(k, o.inst[k]); if (o.scandal) addScandal(o.scandal); if (o.fear) S().fear = clamp((S().fear || 0) + o.fear, 0, 100); writeApproval(); },
    policy: function () { const s = ensure(); return s ? Object.assign({}, s.policy) : null; },
    nomineeIdeologies: nomineeIdeologies, desk: function () { const s = ensure(); return s ? s.desk.slice() : []; },
    GROUPS: GROUP_IDS.map(function (k) { return { id: k, name: GROUPS[k].name, adj: GROUPS[k].adj }; }), INSTITUTIONS: INST_IDS.slice(), VERBS: Object.keys(VERBS), ORDERS: Object.keys(ORDERS), DIMS: DIMS.slice(), DEPLOY_MIN: DEPLOY_MIN,
    audit: audit, reset: reset, serialize: serialize, apply: apply,
    // tests
    _daily: daily, _state: S, _ensure: ensure, _hook: hook,
    _setAll: function (v) { const s = ensure(); if (!s) return; s.base = v; GROUP_IDS.forEach(function (k) { s.groups[k].loyalty = clamp(v, 0, 100); s.groups[k].griev = 0; }); writeApproval(); },
    _setInst: function (k, v) { const s = ensure(); if (s && s.inst[k]) { s.inst[k].loyalty = clamp(v, 0, 100); s.inst[k].griev = 0; } },
    _bodies: BODIES,
  };
})();
