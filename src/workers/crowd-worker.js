/* ============================================================
   workers/crowd-worker.js - compact off-screen prison society.

   This worker owns the memories and relationships of the coarse crowd tier.
   It receives occasional position snapshots, indexes them into local cells,
   and runs a fixed encounter budget. Total population may grow dramatically
   without increasing main-thread frame work.
============================================================ */
"use strict";

const MEM_SLOTS = 3;
const REL_SLOTS = 3;
const CELL = 9;
const INV_CELL = 1 / CELL;
const OFF = 32768;
const SPAN = 65536;

// numeric roles shared with entities/crowd.js
const DRIFTER = 0, RUNNER = 1, LOOKOUT = 2, ENFORCER = 3, TRADER = 4, MEDIATOR = 5;
// compact memory kinds
const GOSSIP = 1, DEAL = 2, THREAT = 3, CALM = 4, PLAYER_SEEN = 5;
// meaningful event kinds stored in the priority queue
const EV_RUMOR = 1, EV_DEAL = 2, EV_FIGHT = 3, EV_INJURY = 4, EV_SCHEDULE = 5, EV_FACTION = 6;
const FACT_INJURED = 1, FACT_DEALER = 2, FACT_WITNESS = 4, FACT_FACTION_ACTION = 8;

let count = 0, visible = 0, cursor = 0, timeScale = 1, running = false, simTicks = 0;
let overview = false, lastTickAt = 0;
let positions = null, roles = null, factions = null, nerve = null, empathy = null, greed = null;
let mood = null, memoryKind = null, memoryStrength = null, memoryTTL = null, memorySource = null;
let memoryX = null, memoryZ = null, relationId = null, relationScore = null, next = null, facts = null;
let playerX = 0, playerZ = 0, playerArmed = false, playerHeat = 0;
let sharedPositionBuffers = null, sharedPositionMeta = null;
let timer = null;
const cells = new Map();
const changed = [];
let changedFlag = null;
const totals = { interactions: 0, rumors: 0, deals: 0, conflicts: 0, calms: 0, witnesses: 0, injuries: 0, factionActions: 0, eventsProcessed: 0 };
const zoneHunger = new Float32Array([0.24, 0.30, 0.27]);
const zoneUnrest = new Float32Array([0.16, 0.22, 0.18]);
const zonePressure = new Float32Array([0.18, 0.25, 0.20]);
const zonePopulation = new Int32Array(3);
let simClock = 0, heapSize = 0;
let heapAt = new Float64Array(512), heapId = new Int32Array(512), heapKind = new Uint8Array(512);

let seed = 0x51f15e;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function keyOf(x, z) { return (Math.floor(x * INV_CELL) + OFF) * SPAN + (Math.floor(z * INV_CELL) + OFF); }
function xOf(id) { return positions[id * 2]; }
function zOf(id) { return positions[id * 2 + 1]; }
function zoneOf(id) { const z = zOf(id); return z < 52 ? 0 : (z < 80 ? 1 : 2); }

function growHeap() {
  const cap = heapAt.length * 2;
  const at = new Float64Array(cap), id = new Int32Array(cap), kind = new Uint8Array(cap);
  at.set(heapAt); id.set(heapId); kind.set(heapKind);
  heapAt = at; heapId = id; heapKind = kind;
}
function heapSwap(a, b) {
  let n = heapAt[a]; heapAt[a] = heapAt[b]; heapAt[b] = n;
  n = heapId[a]; heapId[a] = heapId[b]; heapId[b] = n;
  n = heapKind[a]; heapKind[a] = heapKind[b]; heapKind[b] = n;
}
function queueEvent(at, id, kind) {
  if (heapSize >= heapAt.length) growHeap();
  let i = heapSize++;
  heapAt[i] = at; heapId[i] = id; heapKind[i] = kind;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapAt[p] <= heapAt[i]) break;
    heapSwap(p, i); i = p;
  }
}
function popEvent() {
  const out = { at: heapAt[0], id: heapId[0], kind: heapKind[0] };
  heapSize--;
  if (heapSize > 0) {
    heapAt[0] = heapAt[heapSize]; heapId[0] = heapId[heapSize]; heapKind[0] = heapKind[heapSize];
    let i = 0;
    for (;;) {
      const a = i * 2 + 1; if (a >= heapSize) break;
      const b = a + 1, m = b < heapSize && heapAt[b] < heapAt[a] ? b : a;
      if (heapAt[i] <= heapAt[m]) break;
      heapSwap(i, m); i = m;
    }
  }
  return out;
}

function markChanged(id) {
  if (changedFlag[id]) return;
  changedFlag[id] = 1;
  changed.push(id);
}

function rebuildGrid() {
  cells.clear();
  next.fill(-1);
  zonePopulation.fill(0);
  for (let id = visible; id < count; id++) {
    const key = keyOf(xOf(id), zOf(id));
    const head = cells.get(key);
    next[id] = head == null ? -1 : head;
    cells.set(key, id);
    zonePopulation[zoneOf(id)]++;
  }
}

function nearbyPartner(id, radius) {
  const x = xOf(id), z = zOf(id);
  const gx = Math.floor(x * INV_CELL), gz = Math.floor(z * INV_CELL);
  const r2 = radius * radius;
  let best = -1, seen = 0;
  for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
    let other = cells.get((cx + OFF) * SPAN + (cz + OFF));
    while (other != null && other >= 0 && seen < 18) {
      if (other !== id) {
        const dx = xOf(other) - x, dz = zOf(other) - z;
        if (dx * dx + dz * dz <= r2 && (best < 0 || rnd() < 0.38)) best = other;
      }
      other = next[other];
      seen++;
    }
  }
  return best;
}

function memorySlot(id, kind) {
  const base = id * MEM_SLOTS;
  let weakest = base;
  for (let i = 0; i < MEM_SLOTS; i++) {
    const slot = base + i;
    if (memoryKind[slot] === kind) return slot;
    if (memoryTTL[slot] < memoryTTL[weakest] || memoryStrength[slot] < memoryStrength[weakest]) weakest = slot;
  }
  return weakest;
}

function remember(id, kind, strength, source, x, z) {
  const slot = memorySlot(id, kind);
  memoryKind[slot] = kind;
  memoryStrength[slot] = clamp(Math.max(memoryStrength[slot] || 0, strength), 0, 100);
  memoryTTL[slot] = clamp(22 + strength * 0.7, 8, 120);
  memorySource[slot] = source < 0 ? 0xffffffff : source;
  memoryX[slot] = clamp(Math.round(x * 4), -32768, 32767);
  memoryZ[slot] = clamp(Math.round(z * 4), -32768, 32767);
  markChanged(id);
}

function strongestMemory(id) {
  const base = id * MEM_SLOTS;
  let best = -1;
  for (let i = 0; i < MEM_SLOTS; i++) {
    const slot = base + i;
    if (memoryTTL[slot] > 0 && (best < 0 || memoryStrength[slot] > memoryStrength[best])) best = slot;
  }
  return best;
}

function relate(a, b, delta) {
  const base = a * REL_SLOTS;
  let slot = base, weakest = base;
  for (let i = 0; i < REL_SLOTS; i++) {
    const at = base + i;
    if (relationId[at] === b) { slot = at; weakest = at; break; }
    if (relationId[at] < 0) { slot = at; weakest = at; break; }
    if (Math.abs(relationScore[at]) < Math.abs(relationScore[weakest])) weakest = at;
    slot = weakest;
  }
  relationId[slot] = b;
  relationScore[slot] = clamp(relationScore[slot] + delta, -100, 100);
  markChanged(a);
}

function decay(id, weight) {
  const drift = Math.min(8, Math.max(1, Math.round(weight)));
  mood[id] = clamp(mood[id] + (mood[id] < 50 ? drift : (mood[id] > 50 ? -drift : 0)), 0, 100);
  const base = id * MEM_SLOTS;
  for (let i = 0; i < MEM_SLOTS; i++) {
    const slot = base + i;
    if (memoryTTL[slot] > 0) memoryTTL[slot] = Math.max(0, memoryTTL[slot] - drift);
    if (memoryTTL[slot] === 0) { memoryKind[slot] = 0; memoryStrength[slot] = 0; }
  }
}

function encounter(a, b, weight) {
  if (b < 0 || a === b) return;
  const w = Math.max(1, weight || 1);
  const effect = Math.min(8, 1 + Math.log2(w));
  totals.interactions += w;
  const ar = roles[a], br = roles[b];
  const sameFaction = factions[a] >= 0 && factions[a] === factions[b];
  const x = (xOf(a) + xOf(b)) * 0.5, z = (zOf(a) + zOf(b)) * 0.5;
  const aMem = strongestMemory(a), bMem = strongestMemory(b);

  // Lookouts and runners make rumors travel through the block.
  if (aMem >= 0 && (ar === LOOKOUT || ar === RUNNER || rnd() < 0.20)) {
    remember(b, memoryKind[aMem] || GOSSIP, memoryStrength[aMem] * 0.82, a, memoryX[aMem] / 4, memoryZ[aMem] / 4);
    totals.rumors += w;
  } else if (bMem >= 0 && (br === LOOKOUT || br === RUNNER || rnd() < 0.20)) {
    remember(a, memoryKind[bMem] || GOSSIP, memoryStrength[bMem] * 0.82, b, memoryX[bMem] / 4, memoryZ[bMem] / 4);
    totals.rumors += w;
  }

  if (ar === TRADER || br === TRADER) {
    const delta = sameFaction ? 7 : 4;
    relate(a, b, delta * effect); relate(b, a, delta * effect);
    mood[a] = clamp(mood[a] + 3 * effect, 0, 100); mood[b] = clamp(mood[b] + 3 * effect, 0, 100);
    remember(a, DEAL, 20 + greed[a] * 0.18, b, x, z);
    remember(b, DEAL, 20 + greed[b] * 0.18, a, x, z);
    totals.deals += w;
    return;
  }

  if ((ar === ENFORCER || br === ENFORCER) && rnd() < 0.28 + (sameFaction ? -0.14 : 0.12)) {
    const hard = ar === ENFORCER ? a : b, target = hard === a ? b : a;
    const edge = (nerve[hard] - nerve[target]) * 0.12 + (sameFaction ? -5 : 5);
    relate(hard, target, (edge >= 0 ? -5 : -2) * effect); relate(target, hard, (edge >= 0 ? -8 : -3) * effect);
    mood[target] = clamp(mood[target] - 7 * effect, 0, 100);
    remember(target, THREAT, 28 + Math.max(0, edge), hard, x, z);
    totals.conflicts += w;
    return;
  }

  if (ar === MEDIATOR || br === MEDIATOR) {
    mood[a] = clamp(mood[a] + 4 * effect, 0, 100); mood[b] = clamp(mood[b] + 4 * effect, 0, 100);
    remember(a, CALM, 18 + empathy[a] * 0.12, b, x, z);
    remember(b, CALM, 18 + empathy[b] * 0.12, a, x, z);
    relate(a, b, 3 * effect); relate(b, a, 3 * effect);
    totals.calms += w;
    return;
  }

  // Ordinary inmates still form lightweight social history.
  const delta = sameFaction ? 3 : (rnd() < 0.22 ? -2 : 1);
  relate(a, b, delta * effect); relate(b, a, delta * effect);
  if (rnd() < 0.18) {
    remember(b, GOSSIP, 12 + nerve[a] * 0.12, a, x, z);
    totals.rumors += w;
  }
}

function playerWitness(id, weight) {
  const dx = xOf(id) - playerX, dz = zOf(id) - playerZ;
  if (dx * dx + dz * dz > 13 * 13) return;
  if (!playerArmed && playerHeat < 8) return;
  const strength = clamp(18 + playerHeat * 0.45 + (playerArmed ? 18 : 0), 12, 92);
  remember(id, PLAYER_SEEN, strength, -1, playerX, playerZ);
  facts[id] |= FACT_WITNESS;
  mood[id] = clamp(mood[id] - (playerArmed ? 7 : 3), 0, 100);
  totals.witnesses += Math.max(1, weight || 1);
}

function stats() {
  return Object.assign({
    total: count, hidden: count - visible, timeScale, simTicks, simClock,
    queuedEvents: heapSize,
    zones: {
      hunger: Array.from(zoneHunger),
      unrest: Array.from(zoneUnrest),
      pressure: Array.from(zonePressure),
      population: Array.from(zonePopulation),
    },
  }, totals);
}

function flushPatch() {
  if (!changed.length) return;
  const ids = new Int32Array(changed.length);
  const summary = new Uint8Array(changed.length * 4);
  const factPatch = new Uint32Array(changed.length);
  for (let i = 0; i < changed.length; i++) {
    const id = changed[i], mem = strongestMemory(id);
    ids[i] = id;
    summary[i * 4] = mood[id];
    summary[i * 4 + 1] = mem >= 0 ? memoryKind[mem] : 0;
    summary[i * 4 + 2] = mem >= 0 ? memoryStrength[mem] : 0;
    summary[i * 4 + 3] = roles[id];
    factPatch[i] = facts[id];
    changedFlag[id] = 0;
  }
  changed.length = 0;
  postMessage({ type: "patch", ids, summary, facts: factPatch, stats: stats() }, [ids.buffer, summary.buffer, factPatch.buffer]);
}

function ctmc01(value, rise, fall, dt) {
  const rate = rise + fall;
  if (rate <= 0) return value;
  const equilibrium = rise / rate;
  return clamp(equilibrium + (value - equilibrium) * Math.exp(-rate * dt), 0, 1);
}
function advanceZones(dt) {
  for (let z = 0; z < 3; z++) {
    zoneHunger[z] = ctmc01(zoneHunger[z], 0.006, 0.003, dt);
    zonePressure[z] = ctmc01(zonePressure[z], 0.0018 + zoneUnrest[z] * 0.006, 0.004, dt);
    zoneUnrest[z] = ctmc01(zoneUnrest[z], 0.0014 + zoneHunger[z] * 0.004 + zonePressure[z] * 0.006, 0.006, dt);
  }
}
function eventKind(id) {
  const roll = rnd(), role = roles[id];
  if (roll < 0.28 || role === LOOKOUT || role === RUNNER) return EV_RUMOR;
  if (roll < 0.46 || role === TRADER) return EV_DEAL;
  if (roll < 0.66 || role === ENFORCER) return EV_FIGHT;
  if (roll < 0.76) return EV_INJURY;
  if (roll < 0.90) return EV_SCHEDULE;
  return EV_FACTION;
}
function scheduleAgent(id, now) {
  if (id < visible || id >= count) return;
  const z = zoneOf(id);
  const rate = 0.010 + zoneUnrest[z] * 0.030 + (roles[id] === RUNNER || roles[id] === LOOKOUT ? 0.012 : 0);
  const delay = -Math.log(Math.max(0.000001, 1 - rnd())) / rate;
  queueEvent(now + delay, id, eventKind(id));
}
function processEvent(event) {
  const a = event.id;
  if (a < visible || a >= count) return;
  const b = nearbyPartner(a, 11);
  const z = zoneOf(a), x = xOf(a), zz = zOf(a);
  decay(a, 1); playerWitness(a, 1);
  totals.interactions++;
  if (event.kind === EV_RUMOR) {
    const mem = strongestMemory(a);
    if (b >= 0) remember(b, mem >= 0 ? memoryKind[mem] : GOSSIP, mem >= 0 ? memoryStrength[mem] * 0.82 : 18, a, x, zz);
    totals.rumors++;
  } else if (event.kind === EV_DEAL) {
    if (b >= 0) {
      relate(a, b, 5); relate(b, a, 4); remember(a, DEAL, 18 + greed[a] * 0.2, b, x, zz); remember(b, DEAL, 16 + greed[b] * 0.18, a, x, zz);
      facts[a] |= FACT_DEALER;
    }
    totals.deals++;
  } else if (event.kind === EV_FIGHT) {
    if (b >= 0) {
      relate(a, b, -7); relate(b, a, -9); remember(a, THREAT, 24 + nerve[b] * 0.22, b, x, zz); remember(b, THREAT, 24 + nerve[a] * 0.22, a, x, zz);
      mood[a] = clamp(mood[a] - 8, 0, 100); mood[b] = clamp(mood[b] - 9, 0, 100);
    }
    zoneUnrest[z] = clamp(zoneUnrest[z] + 0.035, 0, 1); totals.conflicts++;
  } else if (event.kind === EV_INJURY) {
    facts[a] |= FACT_INJURED; remember(a, THREAT, 36, b, x, zz); mood[a] = clamp(mood[a] - 14, 0, 100); totals.injuries++;
  } else if (event.kind === EV_SCHEDULE) {
    // A schedule transition changes where this inmate spends time without
    // fabricating frame-by-frame footsteps. The main thread lazily refines it.
    roles[a] = rnd() < 0.18 ? RUNNER : roles[a];
    markChanged(a);
  } else if (event.kind === EV_FACTION) {
    facts[a] |= FACT_FACTION_ACTION; zonePressure[z] = clamp(zonePressure[z] + 0.05, 0, 1); totals.factionActions++;
  }
  scheduleAgent(a, event.at);
}
function seedQueue(now) {
  if (!positions || count <= visible) return;
  const hidden = count - visible, budget = Math.min(hidden, 384);
  for (let i = 0; i < budget; i++) scheduleAgent(visible + ((cursor++) % hidden), now);
}
function advanceSociety(dt) {
  if (!positions || count <= visible || dt <= 0) return;
  simClock += dt; simTicks += dt; advanceZones(dt);
  if (!heapSize) seedQueue(simClock);
  let budget = overview ? 320 : 96;
  while (heapSize && heapAt[0] <= simClock && budget-- > 0) {
    processEvent(popEvent()); totals.eventsProcessed++;
  }
}

function tick() {
  if (!running) return;
  const now = Date.now();
  const elapsed = lastTickAt ? (now - lastTickAt) / 1000 : 1;
  lastTickAt = now;
  // Close play wakes rarely. The priority queue jumps directly to meaningful
  // consequences; invisible footsteps are analytical route segments elsewhere.
  advanceSociety(Math.max(0.01, Math.min(240, timeScale * elapsed)));
  flushPatch();
}

function schedule() {
  if (timer) clearInterval(timer);
  // Ordinary close play yields almost all CPU time to rendering. Overview
  // requests a fast heartbeat, while weighted ticks preserve elapsed time.
  lastTickAt = Date.now();
  timer = setInterval(tick, overview ? 300 : 4000);
}

function resetSociety() {
  cursor = 0; simTicks = 0; simClock = 0; heapSize = 0;
  mood.fill(50); memoryKind.fill(0); memoryStrength.fill(0); memoryTTL.fill(0);
  relationId.fill(-1); relationScore.fill(0); changedFlag.fill(0); facts.fill(0);
  changed.length = 0;
  for (const key in totals) totals[key] = 0;
  zoneHunger.set([0.24, 0.30, 0.27]); zoneUnrest.set([0.16, 0.22, 0.18]); zonePressure.set([0.18, 0.25, 0.20]);
  seedQueue(0);
}

function seedEvent(m) {
  if (!positions) return;
  const x = +m.x || 0, z = +m.z || 0, radius = +m.radius || 14;
  const strength = clamp(+m.strength || 36, 4, 100);
  const kind = m.kind | 0 || THREAT;
  const gx = Math.floor(x * INV_CELL), gz = Math.floor(z * INV_CELL), span = Math.ceil(radius * INV_CELL);
  const r2 = radius * radius;
  for (let cx = gx - span; cx <= gx + span; cx++) for (let cz = gz - span; cz <= gz + span; cz++) {
    let id = cells.get((cx + OFF) * SPAN + (cz + OFF));
    while (id != null && id >= 0) {
      const dx = xOf(id) - x, dz = zOf(id) - z;
      if (dx * dx + dz * dz <= r2) {
        remember(id, kind, strength, -1, x, z);
        mood[id] = clamp(mood[id] - Math.ceil(strength * 0.12), 0, 100);
      }
      id = next[id];
    }
  }
  flushPatch();
}

onmessage = function (e) {
  const m = e.data || {};
  if (m.type === "init") {
    count = m.count | 0;
    visible = m.visible | 0;
    sharedPositionBuffers = m.sharedPositionBuffers || null;
    sharedPositionMeta = m.sharedPositionMeta || null;
    positions = m.positions || (sharedPositionBuffers && sharedPositionBuffers[m.sharedIndex | 0]);
    roles = m.roles; factions = m.factions; nerve = m.nerve; empathy = m.empathy; greed = m.greed;
    mood = new Uint8Array(count); mood.fill(50);
    memoryKind = new Uint8Array(count * MEM_SLOTS);
    memoryStrength = new Uint8Array(count * MEM_SLOTS);
    memoryTTL = new Uint8Array(count * MEM_SLOTS);
    memorySource = new Uint32Array(count * MEM_SLOTS);
    memoryX = new Int16Array(count * MEM_SLOTS); memoryZ = new Int16Array(count * MEM_SLOTS);
    relationId = new Int32Array(count * REL_SLOTS); relationId.fill(-1);
    relationScore = new Int8Array(count * REL_SLOTS);
    facts = m.facts || new Uint32Array(count);
    changedFlag = new Uint8Array(count);
    next = new Int32Array(count); next.fill(-1);
    rebuildGrid();
    seedQueue(0);
    schedule();
    postMessage({ type: "ready", stats: stats() });
  } else if (m.type === "positions") {
    positions = m.positions || (sharedPositionBuffers && sharedPositionBuffers[m.sharedIndex | 0]);
    visible = m.visible | 0;
    playerX = +m.playerX || 0; playerZ = +m.playerZ || 0;
    playerArmed = !!m.playerArmed; playerHeat = +m.playerHeat || 0;
    if (cursor >= Math.max(1, count - visible)) cursor = 0;
    rebuildGrid();
  } else if (m.type === "running") {
    running = !!m.value;
    // Do not fold time spent paused or in another mode into the next society
    // tick. Society time advances only while jail play is actually running.
    lastTickAt = Date.now();
  } else if (m.type === "speed") {
    timeScale = Math.max(1, Math.min(64, m.value | 0));
    schedule();
    postMessage({ type: "stats", stats: stats() });
  } else if (m.type === "overview") {
    overview = !!m.value;
    schedule();
    postMessage({ type: "stats", stats: stats() });
  } else if (m.type === "event") {
    seedEvent(m);
  } else if (m.type === "reset") {
    resetSociety();
    postMessage({ type: "stats", stats: stats() });
  }
};
