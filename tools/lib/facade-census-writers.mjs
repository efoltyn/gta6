/* tools/lib/facade-census-writers.mjs — the census rows for the generators
   that do NOT build through city/buildings.js makeBuilding.

   METRO (Kingsport and the other planned cities, city/metro_fabric.js) is
   built for real: the plan, a near tile, one facade-kit cell, through the
   game's own job runner, and every building is read back off the vertex
   attributes the fabric's shader paints from (mode, flags, bays, storeys):
     windows  "shader" where the style's openings carry the parallax recess
              (MF_MAIN: reveal, frame and glass at depth), "painted" where
              they are only paint (dormers, glass roofs, clerestories)
     doors    "shader" (a recessed door: reveal, set-back panelled leaf) or
              "painted" (a mall's glazed bay, a barn door), and whether the
              row's stoop is real geometry
     zfight   the tile mesh's own quads (tools/lib/facade-geom.mjs)
   The remaining own-writer generators are listed from their code (the
   prison wings, the desert city, the marina, the airport, the huts), each
   row saying what it is and that it is a static audit, not a build.      */
import fs from "fs";
import vm from "vm";
import { meshQuads, zfight } from "./facade-geom.mjs";

const PARALLAX = new Set([4, 5, 6, 7, 8, 9, 10, 11, 20]);   // MF_MAIN styles whose openings have depth (9: a shed's clerestory)
const PAINTED = new Set([16, 17]);                         // dormers, glass roof

export async function otherWriters(o) {
  const rows = [];
  try { for (const r of metroRows(o)) rows.push(r); }
  catch (e) { rows.push({ name: "metro (Kingsport)", gen: "metro_fabric.js", error: String(e && e.stack || e).split("\n").slice(0, 3).join(" | ") }); }
  for (const r of staticRows(o)) rows.push(r);
  return rows;
}

function metroRows(o) {
  const ROOT = o.ROOT;
  const snap = JSON.parse(fs.readFileSync(ROOT + "/tools/metro-world-snapshot.json", "utf8"));
  const E = o.makeEnv();
  const CBZ = E.CBZ;
  Object.assign(CBZ, { highwayNetTable: () => snap.hw, HIGHWAY_NET_HALF: snap.H });
  E.load("src/core/seed.js");
  if (fs.existsSync(ROOT + "/src/city/facade_openings.js")) E.load("src/city/facade_openings.js");
  E.load("src/city/facade_kit.js");
  for (const f of o.indexScripts(/^src\/city\/facades\//)) E.load(f);
  E.load("src/city/metroplan.js");
  E.load("src/city/metro.js");
  E.load("src/city/metro_fabric.js");
  const L = CBZ.metroLib, F = CBZ.metroFabric;
  const src = fs.readFileSync(ROOT + "/src/city/metro_fabric.js", "utf8");
  const hasParallax = /oDep > 0\.0 && wm > 0\.001/.test(src);
  const hasDoorRecess = /THE DOOR IS SET BACK/.test(src);
  const hasNumber = /mfDigit\(/.test(src);
  const city = {
    regions: snap.regions.map((r) => Object.assign({ kind: "rect" }, r)),
    roads: snap.roads.map((r) => ({ x: r[0], z: r[1], vertical: !!r[2], len: r[3], w: r[4], district: r[5] })),
    minX: snap.city.minX, maxX: snap.city.maxX, minZ: snap.city.minZ, maxZ: snap.city.maxZ, annex: snap.annex,
  };
  if (F.setFreeFar) F.setFreeFar(false);
  const sites = L.siteTable(city);
  const byType = new Map();
  let zf = { pairs: 0, area: 0 }, zTiles = 0;
  const planned = [];
  for (const site of sites) {
  const P = L.planSite(city, site, planned);
  planned.push({ id: site.id, regions: L.planRegions(P), plan: P });
  const pr = F.prepare(P, { tile: L.TILE, name: site.id });
  // every tile of every city; the z-fight ledger on the three most built-up
  // tiles of the first (the quads of a whole city would take minutes)
  const dense = new Set(planned.length === 1 ? pr.tiles.slice().sort((a, b) => b.idx.length - a.idx.length).slice(0, 3) : []);
  for (const t of pr.tiles) {
    const J = F.job(P, t, false); J.marks = [];
    F.runJob(J, Infinity);
    const g = t.mesh.geometry;
    const A = g.attributes;
    const Pm = A.aMfP, Gm = A.aMfG, Um = A.aMfU;
    if (!Pm || !Gm || !Um) { g.dispose(); continue; }
    const rd = (att, i, c) => {
      const v = att.array[i * att.itemSize + c];
      return att.normalized && att.array instanceof Uint8Array ? v / 255 : v;
    };
    const M = J.marks;
    for (let k = 0; k < M.length; k += 3) {
      const bi = M[k], v0 = M[k + 1], v1 = M[k + 2];
      const b = P.bldgs[bi];
      const type = b.type + (b.style ? "/" + b.style : "");
      let rec = byType.get(type);
      if (!rec) { rec = { type, n: 0, open: { shader: 0, painted: 0 }, door: { shader: 0, painted: 0, none: 0 }, stoop: 0 }; byType.set(type, rec); }
      rec.n++;
      let door = null;
      for (let v = v0; v + 3 < v1; v += 4) {
        const mode = Math.round(rd(Pm, v, 0));
        const fl = Math.round(rd(Gm, v, 3) * (Gm.normalized ? 255 : 1));
        const fh = Math.max(rd(Pm, v, 1) * 0.1, 0.5);
        const top = rd(Um, v, 2) / 16, bays = Math.round(rd(Um, v, 3)) % 256;   // aMfU.z is top x 16 (the vertex shader divides)
        const blank = Math.floor(fl / 4) % 2, isDoor = Math.floor(fl / 2) % 2, gar = Math.floor(fl / 16) % 2;
        const storeys = Math.max(0, Math.floor(top / fh + 0.02));
        if (!blank && bays > 0 && storeys > 0 && (PARALLAX.has(mode) || PAINTED.has(mode))) {
          const cells = bays * storeys;
          if (PARALLAX.has(mode) && hasParallax) rec.open.shader += cells; else rec.open.painted += cells;
        }
        if (isDoor && !door) door = (!hasDoorRecess || (mode === 15 && !/vec2 bq = /.test(src)) || (mode === 12 && !/float eIn = /.test(src))) ? "painted" : "shader";
        if (gar && !door) door = /vec2 gq = /.test(src) ? "shader" : "painted";
      }
      rec.door[door || "none"]++;
      if (b.type === "row" && !b.shop) rec.stoop++;
    }
    if (dense.has(t)) {
      const Z = zfight(meshQuads(E.THREE, t.mesh).quads, o.TOL, { samples: 2 });
      zf.pairs += Z.pairs; zf.area += Z.area; zTiles++;
    }
    g.dispose();
  }
  }
  const site = { id: sites.map((x) => x.id).join("+") };
  const rows = [];
  for (const r of byType.values()) {
    const openings = r.open.shader + r.open.painted;
    const d = r.door.shader ? "shader" : r.door.painted ? "painted" : "none";
    rows.push({ name: "metro: " + r.type + " (x" + r.n + ")", gen: "metro_fabric.js (" + site.id + ")", kind: "metro",
      openings, wins: { real: 0, covered: 0, flat: 0, bare: 0, painted: r.open.painted, shader: r.open.shader },
      doors: [{ cls: d === "shader" ? "shader" : d, step: r.stoop > 0, light: d === "shader", number: d === "shader" && hasNumber && /row|house/.test(r.type) }],
      z: { pairs: 0, area: 0, samples: [] }, note: "doors " + JSON.stringify(r.door) });
  }
  rows.sort((a, b) => a.name < b.name ? -1 : 1);
  rows.push({ name: "metro: tile meshes (" + zTiles + " densest)", gen: "metro_fabric.js", kind: "metro", openings: 0,
    wins: { real: 0, covered: 0, flat: 0, bare: 0, painted: 0, shader: 0 }, doors: [{ cls: "-" }],
    z: { pairs: zf.pairs, area: +zf.area.toFixed(3), samples: [] } });
  return rows;
}

/* The own-writer generators that are not built here, from their code. Each
   row is what the code draws, with the line it is drawn by. */
function staticRows(o) {
  const ROOT = o.ROOT;
  const read = (f) => { try { return fs.readFileSync(ROOT + "/" + f, "utf8"); } catch (e) { return ""; } };
  const rows = [];
  const row = (name, gen, wins, door, z, note) => rows.push({ name, gen, kind: "static", openings: Object.values(wins).reduce((a, b) => a + b, 0),
    wins: Object.assign({ real: 0, covered: 0, flat: 0, bare: 0, painted: 0, shader: 0 }, wins), doors: [door], z: { pairs: z, area: 0, samples: [] }, note });
  const vk = read("src/city/villagekit.js");
  const vkReal = /function boxHutParts/.test(vk);
  row("village: huts (round/square/lean-to)", "villagekit.js (static audit)", vkReal ? { real: 3 } : { painted: 0 },
    { cls: vkReal ? "real" : "flat", step: vkReal, light: false, number: false }, vkReal ? 0 : 3,
    vkReal ? "walls built round a doorway and a window; plank door hooked open" : "solid wall, a dark box floating 17-34 cm in front of it as the door");
  const dc = read("src/world/desertcity.js");
  row("desert city: towers", "world/desertcity.js (static audit)", { painted: 1 }, { cls: "missing" }, 0,
    /windowTexture/.test(dc) ? "a canvas window grid on solid boxes, no doors (background skyline)" : "");
  const aw = read("src/world/adminwing.js");
  const awFixed = /the frame is a FRAME \(head, sill rail, jambs\)/.test(aw);
  row("prison: admin quarters window", "world/adminwing.js (static audit)", { flat: 1 }, { cls: "real" }, awFixed ? 0 : 1,
    awFixed ? "frame round the pane (was a slab 5 mm over it)" : "a frame SLAB 5 mm in front of the pane, same normal, covering it");
  const bd = read("src/world/building_dress.js");
  row("prison: exterior barred windows", "world/building_dress.js prisonFacade (static audit)", { painted: 1 }, { cls: "real" }, 0,
    /prisonFacade/.test(bd) ? "barred reveal boxes on the solid perimeter wall (by design: no route out)" : "");
  const cb = read("src/world/cellblock.js");
  row("prison: cell windows", "world/cellblock.js (static audit)", { flat: 1 }, { cls: "real" }, /Z \+ 0\.015\)/.test(cb) ? 0 : 1,
    /Z \+ 0\.015\)/.test(cb) ? "wired glass 15 mm off the wall face" : "wired glass plane 6 mm off the wall face, same normal");
  const ma = read("src/city/marina.js");
  const maFixed = /the door's frame is a FRAME round the glass/.test(ma);
  row("marina: harbourmaster", "city/marina.js (static audit)", { flat: 1 }, { cls: "flat" }, maFixed ? 0 : 1,
    maFixed ? "door frame round the glass (was a trim slab 5 mm behind the pane)" : "door pane and trim slab 5 mm apart, same normal");
  const fg = read("src/city/fitout_gang.js");
  row("hideout fit-out: leak streaks", "city/fitout_gang.js (static audit)", {}, { cls: "-" }, /0\.017, 0\.009, stain/.test(fg) ? 0 : 1,
    /0\.017, 0\.009, stain/.test(fg) ? "streak 9 mm proud of the liner" : "streak 1.5 mm in front of the plaster liner");
  const bk = read("src/city/bunkers.js");
  row("bunker: blast door portal", "city/bunkers.js (static audit)", {}, { cls: "real", light: /FY \+ 3\.16/.test(bk) }, 0,
    /FY \+ 3\.16/.test(bk) ? "floodlight under the brow" : "door floodlight buried inside the lintel brow");
  const im = read("src/city/island_military.js");
  row("island: checkpoint guard shack", "city/island_military.js (static audit)", /guard shack — a real one-room building/.test(im) ? { real: 3 } : { flat: 1 },
    { cls: /guard shack — a real one-room building/.test(im) ? "real" : "missing" }, 0,
    /guard shack — a real one-room building/.test(im) ? "the city shell (makeBuilding): a real door and windows" : "solid box, a pane pushed half into it, no door");
  const ak = read("src/city/airport_kit.js");
  row("airport: fire station crew block", "city/airport_kit.js (static audit)", { flat: 1 }, { cls: "flat" }, 0,
    /crew block: two storeys, punched windows/.test(ak) ? "glass boxes straddling a solid block's face, a painted door box" : "");
  const da = read("src/world/disaster_arena.js");
  row("disaster island: town + towers", "world/disaster_arena.js (static audit)", { real: 1 }, { cls: /THE DOORS THEMSELVES/.test(da) ? "real" : "missing" },
    /polygonOffsetUnits/.test(da) ? 1 : 0,
    (/FOP\.scan/.test(da) ? "openings by the shared scan + cut; " : "own scan; ") + (/polygonOffsetUnits/.test(da) ? "coplanar ties hidden by polygonOffset ranks" : "coplanar ties moved apart (resolveCoplanar)"));
  return rows;
}

/* THE ESTATES (city/govcomplex.js: the Executive Mansion and its lodges),
   built through the game's own registry row, measured like a shell. */
export function estateRows(o, measure) {
  const E = o.makeEnv();
  const CBZ = E.CBZ;
  Object.assign(CBZ, { onUpdate() {}, onAlways() {} });
  const fsx = (f) => fs.existsSync(o.ROOT + "/" + f);
  for (const f of ["src/systems/stairs.js", "src/city/buildings_civic.js", "src/city/facade_openings.js", "src/city/buildings.js", "src/city/interior_programs.js", "src/city/govcomplex.js"])
    if (fsx(f)) E.load(f);
  const defs = CBZ.govComplexDefs || [];
  const rows = [];
  for (const id of ["execmansion"]) {
    const def = defs.find((d) => d.id === id);
    if (!def) continue;
    const root = new E.THREE.Group();
    const cx = 3000, cz = -2000;
    const rect = { minX: cx - def.hx, maxX: cx + def.hx, minZ: cz - def.hz, maxZ: cz + def.hz };
    const site = { id, def, rect, cx, cz, roads: [] };
    let out = null, err = null;
    try { out = def.build({ root, rect, cx, cz, site, city: { roads: [] } }); } catch (e) { err = e; }
    if (err || !out || !out.seat || !out.seat.b) { rows.push({ name: "estate: " + id, gen: "govcomplex.js", error: String(err && err.stack || "no seat").split("\n").slice(0, 3).join(" | ") }); continue; }
    if (CBZ.cityFlushPools) CBZ.cityFlushPools();
    rows.push(measure(E, "estate: " + id + " (the house + its dressing)", "govcomplex.js estateKit", out.seat.b, root));
  }
  return rows;
}
