#!/usr/bin/env node
/* tools/racket-check.mjs — DOES THE RACKET LEDGER HOLD UP WHEN YOU COUNT IT?

   city/racket.js is a ledger with consequences, so every claim it makes is
   countable: money that moves must come OUT of a till balance (conservation),
   an extorted store must show up in zone control and on the map feeds, a
   robbery must be remembered BY DAY and answered by the protector, and a
   save/load roundtrip must reproduce the board. This check loads the real
   file against a minimal stub of exactly the CBZ surface it feature-detects,
   then drives the loop and counts.

     signs        an unprotected store accepts the player's protection
     conserve     collect + rob dollars == dollars drained from the till stub
     zone         cityRacketZoneTally counts the signed store for its side
     hunt         robbing an NPC-protected store retasks a gang body (rage set)
     memory       the owner is armed + raging on the robber's return NEXT DAY
     refuse       the vendor-refuses wrap answers true inside the grudge window
     conquest     extorting a rival-protected store flips it and provokes them
     reclaim      the wronged crew walks a collector back and re-flips it
     npc          the NPC director signs a store for a rival crew on its own
     persist      serialize → wipe → apply reproduces protector/fear/robs/owed

   Usage: node tools/racket-check.mjs        Exit 0 = every count holds.   */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log("  ok  " + name + (detail ? "  (" + detail + ")" : "")); return; }
  failures++;
  console.error("FAIL  " + name + (detail ? "  (" + detail + ")" : ""));
}

/* ---------- the stub world: exactly the surface racket.js reads ---------- */
function makeWorld() {
  const CBZ = {};
  const g = { mode: "city", cash: 500, respect: 40, cityWorld: {}, cityMembership: null, playerGang: null };
  CBZ.game = g;
  CBZ.CONFIG = {};
  CBZ.WORLD_SEED = 1234;
  CBZ.now = 0;
  let day = 10;
  CBZ.dayCount = () => day;
  CBZ.setDay = (d) => { day = d; };
  CBZ.player = { pos: { x: 0, y: 0, z: 0 }, dead: false };
  const playerActor = { isPlayerActor: true, pos: CBZ.player.pos };
  CBZ.cityPeds = [];
  const updaters = [];
  CBZ.onUpdate = (order, fn) => updaters.push({ order, fn });
  CBZ.step = (dt) => { for (const u of updaters) u.fn(dt); };

  // ---- lots: four stores + a protector-gang world ----
  function mkLot(cx, cz, kind, name) {
    return { cx, cz, w: 16, d: 16, i: (cx / 40) | 0, j: (cz / 40) | 0, kind,
             building: { shop: { kind }, name, door: { x: cx, z: cz + 8 }, vendorSpot: { x: cx, z: cz + 7, face: 0 }, vendor: null } };
  }
  const lots = [
    mkLot(10, 10, "food", "The Greasy Spoon"),
    mkLot(50, 10, "electronics", "CircuitTown"),
    mkLot(90, 10, "bar", "The Rusty Nail"),
    mkLot(130, 10, "jewelry", "Glint & Co"),
  ];
  CBZ.city = {
    arena: { lots: lots.slice(), shopLots: lots.slice() },
    playerActor,
    note: () => {}, big: () => {},
    addCash: (n) => { g.cash = Math.max(0, g.cash + n); return g.cash; },
    addRespect: () => {},
  };

  // ---- the till: real balances so conservation is countable ----
  const bal = new Map();   // lot -> {register, safe}
  for (const l of lots) bal.set(l, { register: 400, safe: 250 });
  const drained = { total: 0 };
  CBZ.cityTill = {
    flow: (lot) => (lot.kind === "jewelry" ? 120 : 40),
    holds: (lot, opts) => { const b = bal.get(lot) || { register: 0, safe: 0 }; const p = (opts && opts.point) || "register"; return { amount: b[p] | 0, point: p, of: b[p] | 0, kind: lot.kind, name: "", why: "" }; },
    take: (lot, opts) => {
      const b = bal.get(lot) || { register: 0, safe: 0 };
      const p = (opts && opts.point) || "register";
      let want = b[p] | 0;
      if (opts && opts.frac > 0) want = Math.floor(want * Math.min(1, opts.frac));
      if (opts && opts.max > 0) want = Math.min(want, opts.max);
      want = Math.max(0, Math.floor(want));
      b[p] -= want; drained.total += want;
      return { taken: want, of: b[p] + want, emptied: b[p] <= 0, point: p };
    },
  };
  CBZ._bal = bal; CBZ._drained = drained;

  // ---- gangs: one rival crew with members who can hunt ----
  function mkMember(gangId, x, z) {
    const m = { gang: gangId, pos: { x, z }, dead: false, ko: 0, rank: "soldier",
                target: { set(a, b, c) { this.x = a; this.z = c; } }, cash: 0 };
    CBZ.cityPeds.push(m);
    return m;
  }
  const vipers = { id: "vipers", name: "Vipers", color: 0x9750d0, absorbed: false, isPlayer: false,
                   turf: [{ cx: 60, cz: 60 }], center: { x: 60, z: 60 }, treasury: 500,
                   members: [mkMember("vipers", 55, 20), mkMember("vipers", 60, 30),
                             mkMember("vipers", 65, 25), mkMember("vipers", 58, 35)],
                   hostility: 0, provoke: 0, playerFriendly: false, extortsBiz: true };
  CBZ.cityGangs = [vipers];
  CBZ.cityGangById = (id) => CBZ.cityGangs.find((x) => x.id === id) || null;
  CBZ.cityGangProvoke = (id, amt) => { const gg = CBZ.cityGangById(id); if (gg && !gg.playerFriendly) gg.provoke = Math.min(1, gg.provoke + (amt || 0.3)); };
  CBZ.cityGangAddStanding = () => {};
  const wars = new Set();
  CBZ.cityAtWar = (a, b) => wars.has(a + "|" + b) || wars.has(b + "|" + a);
  CBZ.cityDeclareWar = (a, b) => wars.add(a + "|" + b);
  CBZ.citySetRelation = (a, b, s) => { if (s === "war") wars.add(a + "|" + b); };

  // ---- interactions registry stub: capture what racket registers ----
  const reg = { sources: [], options: {}, descs: {} };
  CBZ.interactions = {
    REACH: 5.2,
    registerSource: (s) => reg.sources.push(s),
    register: (layer, o) => { (reg.options[layer] = reg.options[layer] || []).push(o); },
    describe: (kind, fn) => { reg.descs[kind] = fn; },
  };
  CBZ._reg = reg;

  // ---- the odd helpers racket feature-detects (observable stubs) ----
  const log = { surrenders: 0, says: [], relShifts: [], news: [] };
  CBZ.citySurrender = (ped) => { if (ped) { ped.surrender = true; log.surrenders++; } return true; };
  CBZ.citySay = (ped, txt) => log.says.push(txt);
  CBZ.cityRelShift = (ped, kind) => log.relShifts.push(kind);
  CBZ.cityRel = (ped) => (ped._rel = ped._rel || { grudge: 0, fear: 0, seen: false });
  CBZ.cityPhoneNotify = (n) => log.news.push(n.text);
  CBZ.cityCrime = () => {};
  CBZ.cityAlarm = () => {};
  CBZ.cityPanic = () => {};
  CBZ.cityTagWitnesses = () => {};
  CBZ.syncActorWeapon = (ped) => { ped._weaponSynced = true; };
  CBZ.cityRefreshTurfHud = () => {};
  CBZ.cityHudDirty = () => {};
  CBZ._log = log;

  // vendor factory: post a keeper behind a counter (the lazy-vendor shape)
  CBZ.postVendor = (lot) => {
    const v = { vendor: lot, kind: "vendor", name: "Keeper", dead: false, armed: false, ammo: 0,
                pos: { x: lot.building.vendorSpot.x, z: lot.building.vendorSpot.z },
                cash: 100, fear: 0, target: { set() {} } };
    lot.building.vendor = v;
    CBZ.cityPeds.push(v);
    return v;
  };
  return CBZ;
}

function loadRacket(CBZ) {
  const src = fs.readFileSync(path.join(ROOT, "src/city/racket.js"), "utf8");
  const sandbox = { window: { CBZ, THREE: {} }, CBZ, console, Math, Date, JSON };
  sandbox.window.CBZ = CBZ;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "racket.js" });
}

/* ------------------------------- the drive ------------------------------- */
console.log("== racket-check ==");
const CBZ = makeWorld();
const g = CBZ.game;
loadRacket(CBZ);

check("api", !!CBZ.cityRacket && !!CBZ.cityRacketStores && !!CBZ.cityRacketZoneTally && !!CBZ.cityRacketOwnerFill);
check("verbs registered",
  CBZ._reg.sources.some((s) => s.id === "src-vendor-gunpoint") &&
  (CBZ._reg.options["ped:vendor:gp"] || []).length >= 3 &&
  (CBZ._reg.options["ped:vendor"] || []).length >= 2,
  "gunpoint source + " + ((CBZ._reg.options["ped:vendor:gp"] || []).length) + " demand rows");

const lots = CBZ.city.arena.lots;
const spoon = lots[0], circuit = lots[1], bar = lots[2], glint = lots[3];

// boot the tick once so arena adoption + wraps land
CBZ.step(0.1);

// ---- 1) SIGN an unprotected store (force the acceptance roll) ----
CBZ.postVendor(spoon);
const mr = Math.random; Math.random = () => 0.01;         // the owner folds
CBZ.cityRacket.extort(spoon);
Math.random = mr;
let rec = CBZ.cityRacket.of(spoon);
check("signs", !!rec && rec.gang === "player", "protector=" + (rec && rec.gang));
check("tribute derived from flow", CBZ.cityRacket.tribute(spoon) > 0 && CBZ.cityRacket.tribute(glint) > CBZ.cityRacket.tribute(spoon),
  "food=" + CBZ.cityRacket.tribute(spoon) + " jewelry=" + CBZ.cityRacket.tribute(glint));

// ---- 2) zone tally + map feeds see it ----
const tally = CBZ.cityRacketZoneTally({ lots: [spoon, circuit] });
check("zone", !!tally && tally.player === 1, JSON.stringify(tally));
const fill = new Map(); CBZ.cityRacketOwnerFill(fill);
check("map fill", fill.get(spoon) === 0xffd451, "gold wash on yours");
check("stores feed", CBZ.cityRacketStores().length === 1 && CBZ.cityRacketStores()[0].mine === true);

// ---- 3) daily books accrue OWED; collect pays through the till ----
CBZ.step(6);                                               // day watcher anchors at day 10 first
CBZ.setDay(11); CBZ.step(6); CBZ.step(6);                  // …then observes the flip to 11
rec = CBZ.cityRacket.of(spoon);
check("owed accrues", rec.owed > 0, "$" + rec.owed);
const cash0 = g.cash, drained0 = CBZ._drained.total, owed0 = rec.owed;
CBZ.cityRacket.collect(spoon);
check("conserve on collect", g.cash - cash0 === CBZ._drained.total - drained0 && g.cash - cash0 > 0,
  "+" + (g.cash - cash0) + " == till -" + (CBZ._drained.total - drained0));
check("owed settles", rec.owed === owed0 - (g.cash - cash0));

// ---- 4) rival-protected store: robbing it draws HUNTERS + memory ----
// Hand CircuitTown to the Vipers through the ledger (the director's own
// signing is proven separately in section 8); the rob→hunt path is what
// this section counts.
CBZ.postVendor(circuit);
check("npc unsigned yet", !CBZ.cityRacket.of(circuit) || !CBZ.cityRacket.of(circuit).gang);
Math.random = () => 0.99;                                  // owner refuses the player's pitch
CBZ.cityRacket.extort(circuit);                            // …but the attempt files the record
Math.random = mr;
let rc = CBZ.cityRacket.of(circuit);
check("circuit rec", !!rc, "extort attempt files a ledger record");
rc.gang = "vipers"; rc.by = "vipers"; rc.trust = 0.6;      // the world says the Vipers run it
const cash1 = g.cash, drained1 = CBZ._drained.total;
Math.random = () => 0.99;                                  // no resist branch (electronics isn't ARMED anyway)
CBZ.cityRacket.rob(circuit, { armed: true });
Math.random = mr;
rc = CBZ.cityRacket.of(circuit);
check("conserve on rob", g.cash - cash1 === CBZ._drained.total - drained1 && g.cash - cash1 > 0,
  "+" + (g.cash - cash1) + " == till -" + (CBZ._drained.total - drained1));
check("memory recorded", rc.robs.length >= 1 && rc.robs[rc.robs.length - 1].b === "player");
check("trust dropped", rc.trust < 0.6, "trust=" + rc.trust.toFixed(2));
const hunter = CBZ.cityGangs[0].members.find((m) => m.rage && m.hunting);
check("hunt", !!hunter, hunter ? "a viper is on you (raidT=" + hunter.raidT.toFixed(0) + ")" : "no pursuit");
check("pursued marked", rc.robs[rc.robs.length - 1].a === 1, "the crew answered — owner keeps faith");

// ---- 5) NEXT DAY: the keeper meets the robber armed (brave hash or meek) ----
CBZ.setDay(12);
const keeper = circuit.building.vendor;
CBZ.player.pos.x = circuit.cx; CBZ.player.pos.z = circuit.cz + 6;   // walk back in
CBZ.step(1); CBZ.step(1);                                  // memory tick applies
const drew = !!(keeper.armed && keeper.rage);
const cowered = !!keeper.surrender;
check("memory beat", drew || cowered, drew ? "owner DREW on you" : "owner cowers (meek hash)");
check("refuse wrap", (() => {
  // racket wraps cityVendorRefuses only if social.js defined it; stub one and re-tick
  if (!CBZ.cityVendorRefuses) { CBZ.cityVendorRefuses = () => false; CBZ.step(0.5); }
  return CBZ.cityVendorRefuses(keeper) === true;
})(), "no trade for the robber inside the grudge window");

// ---- 6) CONQUEST: take a Vipers store at gunpoint → they answer ----
CBZ.player.pos.x = bar.cx; CBZ.player.pos.z = bar.cz + 6;
CBZ.postVendor(bar);
Math.random = () => 0.99;                                  // first pitch bounces — the record exists either way
CBZ.cityRacket.extort(bar);
Math.random = mr;
let rb = CBZ.cityRacket.of(bar);
rb.gang = "vipers"; rb.by = "vipers"; rb.trust = 0.1; rb.fear = 0.9;  // squeezed + faithless — ripe
const prov0 = CBZ.cityGangs[0].provoke;
Math.random = () => 0.01;                                   // the owner flips to you
CBZ.cityRacket.extort(bar);
Math.random = mr;
rb = CBZ.cityRacket.of(bar);
check("conquest", rb.gang === "player" && rb.reclaim > 0, "flipped, reclaim=" + rb.reclaim);
check("provoked", CBZ.cityGangs[0].provoke > prov0, "vipers provoke " + prov0.toFixed(2) + " → " + CBZ.cityGangs[0].provoke.toFixed(2));
check("war declared", CBZ.cityAtWar("player", "vipers"));

// ---- 7) RECLAIM: their collector walks in and takes it back unopposed ----
// free a viper body (the hunter is busy) and stand near so beats stage
for (const m of CBZ.cityGangs[0].members) { m.rage = null; m.hunting = false; m.raidT = 0; }
let flippedBack = false;
for (let i = 0; i < 800 && !flippedBack; i++) {
  CBZ.step(0.5);
  // walk any op runner toward its goal like the ped brain would
  for (const m of CBZ.cityGangs[0].members) {
    if (m.guard) { m.pos.x += (m.guard.x - m.pos.x) * 0.3; m.pos.z += (m.guard.z - m.pos.z) * 0.3; }
  }
  const r2 = CBZ.cityRacket.of(bar);
  if (r2 && r2.gang === "vipers") flippedBack = true;
}
check("reclaim", flippedBack, flippedBack ? "the collector walked it back" : "no reclaim inside 200s of sim");

// ---- 8) NPC director signs a store on its own (Glint is near their reach) ----
CBZ.cityGangs[0].center = { x: glint.cx + 30, z: glint.cz + 30 };
let npcSigned = false;
for (let i = 0; i < 600 && !npcSigned; i++) {
  CBZ.step(0.7);
  const r3 = CBZ.cityRacket.of(glint);
  if (r3 && r3.gang === "vipers") npcSigned = true;
}
check("npc signs", npcSigned, npcSigned ? "vipers put Glint & Co under protection" : "director never signed");

// ---- 9) PERSISTENCE roundtrip ----
const blob = CBZ.cityRacket.serialize();
check("blob", !!blob && blob.v === 1 && blob.seed === (CBZ.WORLD_SEED >>> 0) && blob.stores.length >= 2, (blob ? blob.stores.length : 0) + " stores ride");
const spoonRec = CBZ.cityRacket.of(spoon);
const snap = { gang: spoonRec.gang, owed: spoonRec.owed, robsC: CBZ.cityRacket.of(circuit).robs.length };
g.cityWorld = { racket: blob };                            // a "reload": fresh ledger reference
CBZ.cityRacket.reset();
CBZ.step(0.1);                                             // hydrate + apply
const back = CBZ.cityRacket.of(spoon);
check("persist", !!back && back.gang === snap.gang && back.owed === snap.owed &&
  CBZ.cityRacket.of(circuit) && CBZ.cityRacket.of(circuit).robs.length === snap.robsC,
  "protector/owed/memory reproduced");

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nall counts hold");
process.exit(failures ? 1 : 0);
