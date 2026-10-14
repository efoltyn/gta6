/* tools/lib/furniture-census.mjs — DRAWN FURNITURE vs SOLID FURNITURE, read
   off the SOURCE (no browser, no probe). `node tools/solid-census.mjs
   --furniture [--rev <git-rev>]`.

   WHY a source census: the live census (solid-census.mjs proper) derives
   barriers from near-horizontal wall faces at >= 1 m and >= 2 m runs, so a
   chair (0.9 m, 0.5 m wide) is below its threshold by construction and the
   owner's "you run over chairs, they have no colliders" was invisible to it.
   Furniture is placed through a handful of verbs; every call site says what
   kind it draws and how. This counts the SITES, by kind, in three columns:

     LOOSE   a body (systems/pushables.js piece): solid, shoved, knocked over
     STATIC  a solid collider that never moves (the kit's default)
     BARE    drawn with no collider at all: you walk through it

   A site is BARE when it says `solid: false`, or when it is a hand-rolled
   helper (taskChair, foldChair, highChair) whose body registers no solid. It
   is LOOSE when the kind is one of furniture.js's LOOSE kinds AND the verb's
   host hands `loose` (presidentialPiece / cvPiece in interior_programs.js,
   B.furn in fitout.js), or a hand-rolled helper builds through a loose path.
   Sites are counted, not instances (a loop of 49 press-room chairs is ONE
   site): a site is a decision somebody made, and a decision is what a fix
   changes. `--rev HEAD` reads the committed tree for the before.        */
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const DIRS = ["src/city", "src/world"];
const KINDS = ["chair", "taskChair", "stool", "bench", "sofa", "armchair", "desk", "bossDesk", "table", "coffee",
  "counter", "shelf", "credenza", "locker", "wardrobe", "bed", "lounger", "deckchair", "planter", "lamp"];
const HAND = { taskChair: "chair", foldChair: "chair", highChair: "chair" };

async function listFiles(ROOT, rev) {
  if (rev) {
    const out = execFileSync("git", ["-C", ROOT, "ls-tree", "--name-only", rev, ...DIRS.map((d) => d + "/")], { encoding: "utf8" });
    return out.split("\n").filter((f) => f.endsWith(".js"));
  }
  const all = [];
  for (const d of DIRS) for (const f of await readdir(path.join(ROOT, d))) if (f.endsWith(".js")) all.push(d + "/" + f);
  return all;
}
async function read(ROOT, rev, f) {
  if (rev) return execFileSync("git", ["-C", ROOT, "show", rev + ":" + f], { encoding: "utf8", maxBuffer: 64 << 20 });
  return readFile(path.join(ROOT, f), "utf8");
}
// the body of `function name(` in src (to its matching brace)
function body(src, name) {
  const i = src.search(new RegExp("function " + name + "\\s*\\("));
  if (i < 0) return null;
  let j = src.indexOf("{", i), depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return src.slice(j, k + 1);
  }
  return null;
}

export async function furnitureCensus(ROOT, opts = {}) {
  const rev = opts.rev || null;
  const files = await listFiles(ROOT, rev);
  const src = {};
  for (const f of files) src[f] = await read(ROOT, rev, f);
  const furn = src["src/city/furniture.js"] || "";
  const looseKinds = (() => {
    const m = furn.match(/const LOOSE = \{([^}]*)\}/);
    return m ? [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]) : [];
  })();
  const ip = src["src/city/interior_programs.js"] || "";
  const fo = src["src/city/fitout.js"] || "";
  // does each verb's host hand `loose`?
  const hostLoose = {
    statePiece: /loose: looseOf\(h\)/.test(body(ip, "presidentialPiece") || ""),
    presidentialPiece: /loose: looseOf\(h\)/.test(body(ip, "presidentialPiece") || ""),
    "F.piece": /loose: looseOf\(h\)/.test(body(ip, "cvPiece") || ""),
    cvPiece: /loose: looseOf\(h\)/.test(body(ip, "cvPiece") || ""),
    kitP: false,
    "B.furn": /oo\.loose\s*=/.test(body(fo, "furn") || ""),
    furnish: false,
  };
  const rows = {};
  const bump = (kind, col, where) => {
    const r = rows[kind] || (rows[kind] = { loose: 0, static: 0, bare: 0, bareAt: [] });
    r[col]++;
    if (col === "bare" && r.bareAt.length < 8) r.bareAt.push(where);
  };
  const kindAlt = KINDS.join("|");
  const VERB = new RegExp("(statePiece\\(F,\\s*|presidentialPiece\\(|F\\.piece\\(|cvPiece\\(|kitP\\(|B\\.furn\\()\"(" + kindAlt + ")\"|furnish\\.(" + kindAlt + ")\\(", "g");
  for (const f of files) {
    if (f === "src/city/furniture.js") continue;
    const s = src[f];
    const lines = s.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li];
      if (/^\s*\/\//.test(L)) continue;
      VERB.lastIndex = 0;
      let m;
      while ((m = VERB.exec(L))) {
        const verb = m[1] ? m[1].replace(/\($/, "").replace(/\(F,\s*$/, "") : "furnish";
        const kind = m[2] || m[3];
        if (/function /.test(L)) continue;
        const where = f.replace("src/", "") + ":" + (li + 1);
        const solidOff = /solid:\s*false/.test(L);
        let col;
        if (looseKinds.includes(kind) && !/loose:\s*false/.test(L) && (hostLoose[verb] || /loose:/.test(L))) col = "loose";
        else col = solidOff ? "bare" : "static";
        bump(kind, col, where);
      }
      // the hand-rolled chairs: what does the helper's own body do?
      for (const h in HAND) {
        const re = new RegExp("(^|[^\\w.])" + h + "\\(");
        if (!re.test(L) || new RegExp("function " + h + "\\b").test(L)) continue;
        const b = body(s, h);
        if (!b) continue;
        const where = f.replace("src/", "") + ":" + (li + 1);
        const col = /loose/.test(b) ? "loose" : (/solid/.test(b) ? "static" : "bare");
        bump(HAND[h] + "(" + h + ")", col, where);
      }
    }
  }
  const tot = { loose: 0, static: 0, bare: 0 };
  for (const k in rows) for (const c of ["loose", "static", "bare"]) tot[c] += rows[k][c];
  return { rev: rev || "worktree", looseKinds, hostLoose, rows, total: tot };
}

export function printFurnitureCensus(R) {
  const pad = (s, n) => String(s).padEnd(n);
  const lp = (s, n) => String(s).padStart(n);
  console.log(`FURNITURE CENSUS (source, ${R.rev}) - call sites by kind`);
  console.log(`loose kinds: ${R.looseKinds.join(", ") || "(none)"}`);
  console.log(pad("kind", 26) + lp("LOOSE", 7) + lp("STATIC", 8) + lp("BARE", 6));
  const ks = Object.keys(R.rows).sort();
  for (const k of ks) {
    const r = R.rows[k];
    console.log(pad(k, 26) + lp(r.loose, 7) + lp(r.static, 8) + lp(r.bare, 6) + (r.bare ? "   " + r.bareAt.join(" ") : ""));
  }
  console.log(pad("TOTAL", 26) + lp(R.total.loose, 7) + lp(R.total.static, 8) + lp(R.total.bare, 6));
}
