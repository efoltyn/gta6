#!/usr/bin/env node
/* Headless run of the war layer: mapkit + a map + sim + ai, no browser.
   Prints per-period summaries, battles, towns changing hands, ms/step, and
   ASCII owner maps so a front moving is something you can SEE in a terminal.

     node tools/warlord-war-sim.mjs --map mediterranean --days 720 --every 120 --ascii
     node tools/warlord-war-sim.mjs --map island --days 120 --every 30 --ascii --player warlord
*/
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? (A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : true) : d; };
const MAP = arg('map', 'mediterranean');
const DAYS = +arg('days', 720);
const EVERY = +arg('every', 120);
const SEED = +arg('seed', 7);
const ASCII = !!arg('ascii', false);
const PLAYER = arg('player', null);

require(join(ROOT, 'src/warlord/war/mapkit.js'));
for (const f of readdirSync(join(ROOT, 'src/warlord/war/maps'))) if (f.endsWith('.js')) require(join(ROOT, 'src/warlord/war/maps', f));
require(join(ROOT, 'src/warlord/war/sim.js'));
require(join(ROOT, 'src/warlord/war/ai.js'));
const WAR = globalThis.CBZ.warlord.war;
if (!WAR.mapData[MAP]) { console.error('no map', MAP, Object.keys(WAR.mapData)); process.exit(1); }
let t0 = performance.now();
const M = WAR.mapkit.load(WAR.mapData[MAP]);
console.log(`map ${M.id} ${M.w}x${M.h} tileKm ${M.tileKm.toFixed(2)} towns ${M.towns.length} factions ${M.factions.length} load ${(performance.now() - t0).toFixed(0)}ms`);
const pIdx = PLAYER ? M.factionIndex(PLAYER) : 0;
t0 = performance.now();
const G = WAR.sim.create(M, { seed: SEED, player: pIdx });
console.log(`create ${(performance.now() - t0).toFixed(0)}ms  land tiles in catchments ${G.landTiles}  sallyR ${G.sallyR} speed ${G.speed.toFixed(2)}`);

const LET = '.ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function ascii() {
  const cols = 110, sx = M.w / cols, sy = sx * 2, rows = Math.floor(M.h / sy);
  const armyAt = new Set(G.armies.map((a) => (Math.floor((a.y) / sy)) * 1000 + Math.floor(a.x / sx)));
  let s = '';
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x = Math.floor(c * sx + sx / 2), y = Math.floor(r * sy + sy / 2), i = x + y * M.w;
      let ch = !M.land[i] ? ' ' : (G.owner[i] ? LET[G.owner[i]] : '.');
      if (armyAt.has(r * 1000 + c)) ch = G.owner[i] ? LET[G.owner[i]].toLowerCase() : '*';
      if (M.townAt[i]) ch = '#';
      line += ch;
    }
    s += line + '\n';
  }
  return s;
}
function legend() { return G.factions.slice(1).map((F) => `${LET[F.i]}=${F.id}`).join(' '); }
function summary() {
  const d = G.date();
  const rows = G.factions.slice(1).map((F) => {
    const st = WAR.sim.stats(G, F.i);
    return `  ${LET[F.i]} ${F.id.padEnd(14)} ${F.alive ? 'alive' : 'DEAD '} towns ${String(st.towns).padStart(3)} tiles ${String(st.tiles).padStart(6)} share ${(st.share * 100).toFixed(1).padStart(5)}% people ${String(st.people).padStart(9)} field ${String(st.soldiers).padStart(7)} (${st.armies}) garrisons ${String(st.garrisons).padStart(7)}`;
  });
  return `day ${G.day} (${d.day}/${d.month}/${d.year}${d.era ? ' ' + d.era : ''})\n` + rows.join('\n');
}
const counts = {};
const times = [];
console.log(legend());
console.log(summary());
if (ASCII) console.log(ascii());
for (let d = 1; d <= DAYS; d++) {
  const s = performance.now();
  WAR.sim.step(G, 1);
  times.push(performance.now() - s);
  for (const e of G.events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (e.type === 'town' && A.includes('--towns')) console.log(`  day ${G.day} ${M.towns[e.town].name}: ${e.from ? G.factions[e.from].id : 'free'} -> ${G.factions[e.to] ? G.factions[e.to].id : 'free'}`);
    if (e.type === 'war' || e.type === 'peace' || e.type === 'dead' || e.type === 'win') console.log(`  day ${G.day} ${e.type} ${e.a ? G.factions[e.a].id : ''} ${e.b ? G.factions[e.b].id : ''} ${e.faction ? G.factions[e.faction].id : ''}`);
  }
  G.events.length = 0;
  WAR.sim.takeDirty(G);
  if (d % EVERY === 0 || G.over) {
    const ts = times.slice().sort((a, b) => a - b);
    console.log(summary());
    console.log(`  events ${JSON.stringify(counts)}  armies ${G.armies.length} battles live ${G.battles.length}  ms/step mean ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)} p95 ${ts[Math.floor(ts.length * 0.95)].toFixed(2)}`);
    if (ASCII) console.log(ascii());
    if (G.over) { console.log('OVER', G.over); break; }
  }
}
