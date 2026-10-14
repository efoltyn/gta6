/* ============================================================
   lab/closure.js — THE SCRIPT CLOSURE: which files a set of entries needs,
   in the order index.html loads them.

   One function, two homes. tools/lab/deps.mjs runs it under node (the CLI,
   the shot preset, the checks) and lab.html runs it in the page against the
   committed manifest (src/lab/deps.json), so a composition nobody wrote down
   (`lab.html?kit=person-chair&need=gore`) still resolves without a build step.

   THE MANIFEST (written by tools/lab/deps.mjs, read here):
     files[i] = { f: "src/x.js", o: order, d: [defs], s: [soft defs],
                  m: {sym: [members it defines]},
                  h: {sym: [members read]} hard reads,
                  l: [syms] the subset of h read at LOAD time (would throw) }
   Symbols that are only feature-detected (`if (CBZ.x)`, `CBZ.x &&`,
   `typeof CBZ.x`) are not edges at all: the reader runs without them.

   resolve(manifest, { files, symbols, provided, depth, skip }) ->
     { files: [ordered paths], why: {file: "sym <- reader"}, missing: [syms] }
     files     entry files (always in); "src/dir/*.js" globs the manifest
     symbols   entry CBZ symbols (their definers are entries)
     provided  symbols the page already has (the lab world): never followed
     depth     how far RUNTIME edges are followed (load-time edges always are).
               Infinity = everything a reachable function might call.
     skip      files never pulled (the lab's cut list)
============================================================ */
(function (root) {
  "use strict";

  function index(man) {
    if (man._ix) return man._ix;
    const byFile = new Map(), def = new Map(), soft = new Map();
    man.files.forEach(function (r) {
      byFile.set(r.f, r);
      (r.d || []).forEach(function (s) { (def.get(s) || def.set(s, []).get(s)).push(r); });
      (r.s || []).forEach(function (s) { (soft.get(s) || soft.set(s, []).get(s)).push(r); });
    });
    const ix = { byFile: byFile, def: def, soft: soft };
    Object.defineProperty(man, "_ix", { value: ix, enumerable: false });
    return ix;
  }

  /* WHO DEFINES `sym`, for a reader that touches `members` of it.
     One definer: that one. Several (a namespace every file extends, like
     CBZ.verbs or CBZ.moves): the ones that define a member the reader uses,
     plus the PRIMARY definer (the first hard definer in load order, else the
     first soft one) that the namespace's other files extend. */
  function definers(ix, sym, members) {
    const hard = ix.def.get(sym) || [], soft = ix.soft.get(sym) || [];
    // a symbol somebody really defines is theirs: the `if (!CBZ.x) CBZ.x = {...}`
    // fallbacks elsewhere are not needed for it (they only count when every
    // definition is soft: a namespace each file extends, like CBZ.verbs)
    const all = hard.length ? hard : soft;
    if (!all.length) return [];
    if (all.length === 1) return all;
    const out = new Set();
    const primary = (hard.length ? hard : soft).slice().sort(function (a, b) { return a.o - b.o; })[0];
    out.add(primary);
    if (members && members.length) {
      members.forEach(function (m) {
        let hit = null;
        all.forEach(function (r) {
          const ms = r.m && r.m[sym];
          if (ms && ms.indexOf(m) >= 0 && (!hit || r.o < hit.o)) hit = r;
        });
        if (hit) out.add(hit);
      });
    }
    return Array.from(out);
  }

  function resolve(man, opts) {
    opts = opts || {};
    const ix = index(man);
    const provided = new Set(opts.provided || []);
    const skip = new Set(opts.skip || []);
    const maxDepth = opts.depth == null ? Infinity : opts.depth;
    const want = new Map();             // file -> depth it was reached at
    const why = {};
    const missing = new Set();
    const queue = [];
    function add(r, d, reason) {
      // the lab's own files are never a game dependency (an ingredient that
      // stubs CBZ.city must not be pulled as the city's definer)
      if (!r || skip.has(r.f) || r.f.indexOf("src/lab/") === 0) return;
      const cur = want.get(r.f);
      if (cur != null && cur <= d) return;
      want.set(r.f, d);
      if (reason && !why[r.f]) why[r.f] = reason;
      queue.push(r);
    }
    // a glob entry ("src/city/facades/*.js") is every manifest file it
    // matches, so a folder of styles is named once and never drifts
    const entryFiles = [];
    (opts.files || []).forEach(function (f) {
      if (f.indexOf("*") < 0) { entryFiles.push(f); return; }
      const re = new RegExp("^" + f.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
      const hit = man.files.filter(function (r) { return re.test(r.f); });
      if (!hit.length) missing.add("file:" + f);
      hit.forEach(function (r) { entryFiles.push(r.f); });
    });
    entryFiles.forEach(function (f) {
      const r = ix.byFile.get(f);
      if (r) add(r, 0, "entry");
      else missing.add("file:" + f);
    });
    (opts.symbols || []).forEach(function (s) {
      const parts = String(s).split(".");
      const ds = definers(ix, parts[0], parts.slice(1));
      if (!ds.length) missing.add(s);
      ds.forEach(function (r) { add(r, 0, "entry CBZ." + s); });
    });
    while (queue.length) {
      const r = queue.shift();
      const d = want.get(r.f);
      const load = new Set(r.l || []);
      const h = r.h || {};
      Object.keys(h).forEach(function (sym) {
        if (provided.has(sym)) return;
        const isLoad = load.has(sym);
        if (!isLoad && d + 1 > maxDepth) return;
        // a file that defines the symbol itself needs nobody else for it
        if ((r.d && r.d.indexOf(sym) >= 0) || (r.s && r.s.indexOf(sym) >= 0)) return;
        const ds = definers(ix, sym, h[sym]);
        if (!ds.length) { missing.add(sym); return; }
        ds.forEach(function (q) { add(q, isLoad ? d : d + 1, "CBZ." + sym + (isLoad ? " (load)" : "") + " <- " + r.f); });
      });
      (r.n || []).forEach(function (f) { add(ix.byFile.get(f), d, "override <- " + r.f); });
    }
    const files = Array.from(want.keys()).sort(function (a, b) { return ix.byFile.get(a).o - ix.byFile.get(b).o; });
    return { files: files, why: why, missing: Array.from(missing).sort() };
  }

  const api = { resolve: resolve, definers: function (man, sym, members) { return definers(index(man), sym, members); } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { const CBZ = (root.CBZ = root.CBZ || {}); CBZ.labClosure = api; }
})(typeof window !== "undefined" ? window : globalThis);
