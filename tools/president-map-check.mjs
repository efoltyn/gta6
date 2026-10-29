#!/usr/bin/env node
/* tools/president-map-check.mjs — THE MAP SHOWS YOU GROWING. Plain node, no browser.

   OWNER (2026-10-28): "it is possible to conquer everyone and map shows your
   country growing".

   Paints src/president/mapdraw.js's map (the painter the briefing book, the
   phone's full-screen map and the lobby all use) into a recording canvas
   and checks, pixel by pixel:
     frames      every scenario paints its own frame, the right size
     growing     take a neighbour and your colour covers more of the map;
                 annex it and it is gone from the map, your colour where it was
     front       at war, a red line where the two countries meet
     gold        your realm is ringed in gold
     pick        a tap on your capital picks you; a tap at sea picks nobody
     the lobby   games/president.html's script (president/game.js) runs on a
                 stub page: the worlds, the map, the list, a scenario switch,
                 TAKE OFFICE's link carries the world
     the phone   city/president_dock.js's full-screen map opens on a stub
                 page, a tapped country gets its card and its orders, and an
                 order goes through the game's own submit

   node tools/president-map-check.mjs */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let fails = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log("  PASS " + name + (detail ? "  (" + detail + ")" : "")); }
  else { fails++; console.log("  FAIL " + name + (detail ? "  (" + detail + ")" : "")); }
}

// ---- a canvas that keeps its pixels (putImageData) and ignores the rest
function ctx2d(cv) {
  const c = {
    font: "10px serif", textAlign: "left", textBaseline: "alphabetic", fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, imageSmoothingEnabled: true, globalAlpha: 1,
    measureText(s) { return { width: String(s).length * 7 }; },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    putImageData(id) { cv._px = id; },
    createRadialGradient() { return { addColorStop() {} }; }, createLinearGradient() { return { addColorStop() {} }; },
  };
  for (const k of ["fillRect", "strokeRect", "beginPath", "moveTo", "lineTo", "stroke", "fill", "arc", "save", "restore", "drawImage", "closePath", "rect", "fillText", "strokeText", "clearRect", "translate", "rotate", "setLineDash", "ellipse"]) c[k] = function () {};
  return c;
}
function canvas() { const cv = { width: 0, height: 0, _px: null, style: {} }; cv.getContext = () => cv._ctx || (cv._ctx = ctx2d(cv)); cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }); cv.addEventListener = () => {}; return cv; }
globalThis.document = { createElement: () => canvas() };

const PW = require(path.join(ROOT, "src/president/world.js"));
require(path.join(ROOT, "src/president/ai.js"));
const SC = require(path.join(ROOT, "src/president/scenarios.js"));
const MAP = require(path.join(ROOT, "src/president/mapdraw.js"));

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function count(img, test) { const D = img.cv._px.data; let n = 0; for (let i = 0; i < D.length; i += 4) if (test(D[i], D[i + 1], D[i + 2])) n++; return n; }
// tiles painted for a controller: read straight off the map the painter used (its pixels are the tiles)
function tilesOf(S, img, cid) {
  const M = PW.geo(S), fr = img.frame; let n = 0;
  for (let py = 0; py < fr.h; py++) for (let px = 0; px < fr.w; px++) {
    const x = (((fr.x + px) % M.W) + M.W) % M.W, i = (fr.y + py) * M.W + x, pv = M.cell[i];
    if (pv >= 0 && S.p[pv].ctl === cid) n++;
  }
  return n;
}

console.log("FRAMES");
for (const sc of SC.list) {
  const S = PW.create(3, { scen: sc.id });
  const img = MAP.image(S, 0, { theme: "night" });
  const fr = MAP.frame(S);
  check(sc.name + " paints its frame", img && img.cv._px && img.w === fr.w && img.h === fr.h && img.cv._px.data.length === fr.w * fr.h * 4, img ? img.w + "x" + img.h + " tiles" : "nothing");
}

console.log("GROWING");
{
  const S = PW.create(3, { scen: "mideast" });
  const me = S.c.findIndex((c) => c.key === "sau"), yem = S.c.findIndex((c) => c.key === "yem");
  PW.apply(S, { type: "seat", c: me, who: "check" });
  const before = MAP.image(S, me, { theme: "paper" });
  const t0 = tilesOf(S, before, me);
  const gold0 = count(before, (r, g, b) => r === 242 && g === 201 && b === 76);
  check("your realm is ringed in gold", gold0 > 20, gold0 + " gold pixels");
  // at war: the front is red
  let w = null; for (let k = 0; k < 8 && !(w && w.ok); k++) w = PW.apply(S, { type: "war", c: me, t: yem });
  const atWar = MAP.image(S, me, { theme: "paper" });
  const red = count(atWar, (r, g, b) => r === 214 && g === 52 && b === 44);
  check("at war, a red front where the two meet", w && w.ok && red > 4, red + " red pixels");
  // take Yemen's cities but one, and the capital: the colour spreads
  const keep = S.p.filter((p) => p.owner === yem && p.id !== S.c[yem].cap).sort((a, b) => a.pop - b.pop)[0];
  for (const p of S.p) if (p.owner === yem && p !== keep) { p.ctl = me; S.tv++; }
  const mid = MAP.image(S, me, { theme: "paper" });
  const t1 = tilesOf(S, mid, me);
  check("taking cities spreads your colour", t1 > t0 * 1.15, t0 + " -> " + t1 + " tiles");
  const occ = count(mid, (r, g, b) => { const y = hex(S.c[yem].color); return Math.abs(r - y[0] * 1) < 2 && Math.abs(g - y[1]) < 2 && Math.abs(b - y[2]) < 2; });
  check("held land is flecked with its owner's colour", occ > 0, occ + " flecks");
  // they give up; annex: the country is gone from the map, your colour where it was
  const r = PW.apply(S, { type: "surrender", c: me, t: yem });
  const m = S.c[me].matters.find((x) => x.kind === "surrender");
  if (m) PW.apply(S, { type: "answer", c: me, m: m.id, o: 0 });
  const after = MAP.image(S, me, { theme: "paper" });
  const t2 = tilesOf(S, after, me);
  check("annexed, it is gone and the map is yours where it was", r.ok && !S.c[yem].alive && tilesOf(S, after, yem) === 0 && t2 > t1, t1 + " -> " + t2 + " tiles, " + S.c[yem].name + (S.c[yem].alive ? " still there" : " gone"));
  // a tap
  const M = PW.geo(S), fr = after.frame, cap = M.provs[S.c[me].cap];
  const fx = ((((cap.lx - fr.x) % M.W) + M.W) % M.W + 0.5) / fr.w, fy = (cap.ly - fr.y + 0.5) / fr.h;
  check("a tap on your capital picks you", MAP.pick(S, fx, fy, fr) === me, S.c[me].capital);
  // the Arabian Sea, south of Oman
  const sea = MAP.pick(S, (61 - 24) / 40, (43 - 15) / 32, fr);
  check("a tap at sea picks nobody", sea == null);
}

console.log("THE LOBBY");
{
  // a stub page: every id is an element; buttons are recorded so a test can press them
  const els = {};
  function elem(tag) {
    const e = { tag, children: [], style: {}, hidden: false, value: "", textContent: "", className: "", attrs: {},
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
      querySelector() { return elem("x"); }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 300 }) };
    Object.defineProperty(e, "innerHTML", { get() { return ""; }, set() { e.children = []; } });
    if (tag === "canvas") { e.width = 0; e.height = 0; e.getContext = () => e._ctx || (e._ctx = ctx2d(e)); }
    return e;
  }
  const doc = { getElementById: (id) => els[id] || (els[id] = elem(id === "preview" ? "canvas" : "div")), createElement: (t) => t === "canvas" ? canvas() : elem(t), head: elem("head"), body: elem("body") };
  let went = null;
  const win = { CBZ: { presGo: (u) => { went = u; } }, location: { search: "?scen=mideast&c=sau", href: "" }, document: doc, URLSearchParams, Date, Math, JSON, console };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const f of ["earth", "nations", "states", "scenarios", "world", "ai", "mapdraw", "game"]) vm.runInContext(fs.readFileSync(path.join(ROOT, "src/president/" + f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  const scens = els.scens.children, list = els.clist.children;
  check("the lobby offers every world", scens.length === SC.list.length, scens.length + " worlds");
  check("the chosen world's countries are listed", list.length === 17, list.length + " countries in the Middle East");
  els.solo.onclick();
  check("TAKE OFFICE carries the world and the country", /scen=mideast/.test(went || "") && /president=sau/.test(went || ""), went);
  const usa = scens.find((b) => b.children[0] && /USA/.test(b.children[0].textContent || "")) || scens[scens.length - 1];
  usa.onclick();
  check("switching to the USA lists the fifty states and DC", els.clist.children.length === 51, els.clist.children.length + " states");
  els.solo.onclick();
  check("and offers its own first pick", /scen=usa/.test(went) && /president=tx/.test(went), went);
}

console.log("THE PHONE");
{
  const els = [];
  function elem(tag) {
    const e = { tag, children: [], style: {}, hidden: false, textContent: "", className: "", attrs: {}, listeners: {},
      classList: { _s: new Set(), toggle(k, on) { if (on === undefined ? !this._s.has(k) : on) this._s.add(k); else this._s.delete(k); }, add(k) { this._s.add(k); }, remove(k) { this._s.delete(k); }, contains(k) { return this._s.has(k); } },
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
      addEventListener(k, f) { (this.listeners[k] = this.listeners[k] || []).push(f); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }) };
    const sub = {};
    e.querySelector = (q) => sub[q] || (sub[q] = q === "canvas" ? canvas() : elem(q));
    Object.defineProperty(e, "innerHTML", { get() { return ""; }, set() { e.children = []; } });
    els.push(e);
    return e;
  }
  const body = elem("body");
  const doc = { createElement: (t) => t === "canvas" ? canvas() : elem(t), head: elem("head"), body: body, documentElement: elem("html") };
  const S = PW.create(3, { scen: "mideast" });
  const me = S.c.findIndex((c) => c.key === "sau"), jor = S.c.findIndex((c) => c.key === "jor");
  PW.apply(S, { type: "seat", c: me, who: "you" });
  const sent = [];
  const win = { document: doc, devicePixelRatio: 2, requestAnimationFrame: (f) => f(), addEventListener() {}, setInterval() {}, setTimeout() {}, console, JSON, Math, Date, Map, Array, Object };
  win.window = win;
  win.CBZ = { game: { state: "playing", mode: "city" }, touchMode: true, presWorld: PW, presMap: MAP, presPapers: null,
    presGame: { on: true, state: () => S, me: () => me, ui: { sel: null }, submit: (a) => { a.c = me; sent.push(a); return PW.apply(S, a); } } };
  // the briefing book's orders, from the same file the book paints
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/president/holler.js"), "utf8"), ctx, { filename: "holler.js" });
  vm.runInContext("CBZ.presWorld = this.CBZ.presWorld;", ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/president/papers.js"), "utf8"), ctx, { filename: "papers.js" });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/city/president_dock.js"), "utf8"), ctx, { filename: "president_dock.js" });
  const D = win.CBZ.presDock;
  D.openMap();
  check("the map opens full screen", D.audit().map.open);
  D._select(jor);
  const cardA = D.audit().map.card;
  check("a tapped country gets its card and its orders", cardA.indexOf("Declare war") >= 0, cardA.join(", "));
  let ok = false;
  for (let k = 0; k < 8 && !ok; k++) { D._act(cardA.indexOf("Declare war")); ok = S.c[me].war.indexOf(jor) >= 0; }
  check("an order from the card goes through the game's own door", ok && sent.some((a) => a.type === "war" && a.t === jor), sent.length + " orders sent");
  D._select(jor);
  const cardB = D.audit().map.card;
  check("at war, the card's orders are the war's", cardB.indexOf("Demand surrender") >= 0 && cardB.indexOf("Offer peace") >= 0, cardB.join(", "));
  D.closeMap();
  check("and it closes", !D.audit().map.open);
}

console.log((fails ? "FAIL" : "PASS") + " president-map-check: " + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
