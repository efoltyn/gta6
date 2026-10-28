#!/usr/bin/env node
/* tools/president-pages-check.mjs — EVERY PAGE OF THE BRIEFING BOOK FITS
   ITS PAGE. Plain node, no browser.

   OWNER (2026-10-28): "There's documents on the desk that go down past the
   bottom of the page, and you can't scroll."

   Paints every page of src/president/papers.js on a recording canvas (text
   measured at a conservative em width, so a real font is narrower) for
   several countries at several moments of a game, in the Full World, the
   Middle East, Africa and the USA (day 0; a year on with the
   world's wars running; a country at war), and fails on:
     · any text whose box leaves the page's margins (right or bottom), or
       starts above the top of the page
     · any tappable box (a decision) outside the margins
     · two tappable boxes that overlap (one finger, two decisions)

   node tools/president-pages-check.mjs */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---- a canvas that records what is drawn on it
const REC = { text: [] };
function fontPx(f) { const m = /(\d+(?:\.\d+)?)px/.exec(f || ""); return m ? +m[1] : 10; }
function emW(f) { return /Courier|mono/i.test(f) ? 0.62 : /700|bold/.test(f) ? 0.56 : 0.52; }
function ctx2d() {
  const c = {
    font: "10px serif", textAlign: "left", textBaseline: "alphabetic", fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, lineCap: "butt", globalAlpha: 1, imageSmoothingEnabled: true,
    measureText(s) { return { width: String(s).length * fontPx(this.font) * emW(this.font) }; },
    fillText(s, x, y) {
      const w = this.measureText(s).width, fs = fontPx(this.font);
      const x0 = this.textAlign === "right" ? x - w : this.textAlign === "center" ? x - w / 2 : x;
      const y0 = this.textBaseline === "middle" ? y - fs / 2 : y - fs * 0.8, y1 = this.textBaseline === "middle" ? y + fs / 2 : y + fs * 0.22;
      if (this._rec) REC.text.push({ s: String(s), x0, x1: x0 + w, y0, y1 });
    },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    createRadialGradient() { return { addColorStop() {} }; }, createLinearGradient() { return { addColorStop() {} }; },
  };
  for (const k of ["fillRect", "strokeRect", "beginPath", "moveTo", "lineTo", "stroke", "fill", "arc", "save", "restore", "drawImage", "putImageData", "closePath", "rect", "ellipse", "quadraticCurveTo", "bezierCurveTo", "translate", "rotate", "setLineDash", "clearRect", "arcTo"]) c[k] = function () {};
  return c;
}
globalThis.document = { createElement() { return { width: 0, height: 0, getContext() { return ctx2d(); } }; } };

const PW = require(path.join(ROOT, "src/president/world.js"));
require(path.join(ROOT, "src/president/ai.js"));
require(path.join(ROOT, "src/president/holler.js"));
const PP = require(path.join(ROOT, "src/president/papers.js"));
const M = PP.MARGIN, PW_ = PP.PAGE_W, PH_ = PP.PAGE_H;

let fails = 0, pages = 0, texts = 0, boxes = 0;
const bad = [];
function inspect(label, id, hits) {
  pages++;
  for (const t of REC.text) {
    texts++;
    const footer = t.y1 > PH_ - M && t.y0 > PH_ - M - 4 && /^\d+ \/ \d+$/.test(t.s);   // the page number lives in the bottom margin
    if (footer) continue;
    if (t.x0 < M - 2 || t.x1 > PW_ - M + 2 || t.y0 < 0 || t.y1 > PH_ - M + 2) bad.push(label + " " + id + ": text off the page: \"" + t.s.slice(0, 40) + "\" x " + t.x0.toFixed(0) + ".." + t.x1.toFixed(0) + " y " + t.y0.toFixed(0) + ".." + t.y1.toFixed(0));
  }
  // two lines of text on top of each other (a label run under its value)
  const TX = REC.text;
  for (let i = 0; i < TX.length; i++) for (let j = i + 1; j < TX.length; j++) {
    const a = TX[i], b = TX[j];
    if (a.x0 < b.x1 - 2 && b.x0 < a.x1 - 2 && a.y0 < b.y1 - 3 && b.y0 < a.y1 - 3) bad.push(label + " " + id + ": text on text: '" + a.s.slice(0, 24) + "' / '" + b.s.slice(0, 24) + "'");
  }
  for (const h of hits) {
    boxes++;
    if (h.x < M - 1 || h.x + h.w > PW_ - M + 1 || h.y < 0 || h.y + h.h > PH_ - M + 1) bad.push(label + " " + id + ": box off the page: " + (h.label || h.fn) + " " + JSON.stringify([h.x, h.y, h.w, h.h].map(Math.round)));
  }
  for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
    const a = hits[i], b = hits[j];
    if (a.fn === "map" || b.fn === "map") continue;
    if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) bad.push(label + " " + id + ": boxes overlap: " + (a.label || a.fn) + " / " + (b.label || b.fn));
  }
}
function paintAll(label, S, me, ui) {
  for (const id of PP.order()) {
    REC.text.length = 0;
    const cx = ctx2d(); cx._rec = true;
    const hits = PP.paint(cx, id, S, me, ui);
    inspect(label, id, hits);
  }
}
// the census can see: a line painted past the bottom must be caught
{
  REC.text.length = 0; const cx = ctx2d(); cx._rec = true; cx.font = "30px serif";
  cx.fillText("a line that runs off the bottom of the page", M, PH_ + 40);
  const before = bad.length; inspect("self-test", "probe", []);
  if (bad.length === before) { console.log("  FAIL the census cannot see text off the page"); process.exit(1); }
  bad.length = before; pages--; texts--;
}
const KEYS = ["usa", "ukr", "chn", "isr", "rus", "deu", "bra"];
for (const seed of [7, 21]) {
  const S = PW.create(seed);
  for (const k of KEYS) {
    const me = S.c.findIndex((c) => c.key === k);
    PW.apply(S, { type: "seat", c: me, who: "check" });
    const other = S.c.findIndex((c) => c.key === (k === "rus" ? "ukr" : "rus"));
    paintAll("seed " + seed + " day 0 " + k, S, me, { me, sel: other });
  }
  for (let d = 0; d < 420; d++) PW.step(S, []);
  for (const k of KEYS) {
    const me = S.c.findIndex((c) => c.key === k);
    const enemy = S.c[me].war[0];
    paintAll("seed " + seed + " day 420 " + k, S, me, { me, sel: enemy != null ? enemy : (me + 3) % S.c.length });
  }
}
// the regions and the fifty states: their own maps, their own names, a conquest under way
for (const [scen, keys] of [["mideast", ["sau", "isr", "bhr"]], ["usa", ["tx", "ca", "dc"]], ["africa", ["nga", "zaf"]]]) {
  const S = PW.create(11, { scen });
  for (const k of keys) {
    const me = S.c.findIndex((c) => c.key === k);
    PW.apply(S, { type: "seat", c: me, who: "check" });
    paintAll(scen + " day 0 " + k, S, me, { me, sel: (me + 1) % S.c.length });
  }
  // the first of them takes a neighbour and keeps its government as a puppet
  const me = S.c.findIndex((c) => c.key === keys[0]);
  const t = S.c.findIndex((c) => c.alive && c.id !== me && PW.reach(S, me, c.id) === 2);
  let w = null; for (let k2 = 0; k2 < 8 && !(w && w.ok); k2++) w = PW.apply(S, { type: "war", c: me, t: t });
  for (let d = 0; d < 200; d++) PW.step(S, []);
  paintAll(scen + " at war " + keys[0], S, me, { me, sel: t });
  for (const p of S.p) if (p.owner === t && p.id !== S.c[t].cap) { p.ctl = me; S.tv++; }
  if (S.c[t].alive) { S.p[S.c[t].cap].ctl = me; S.tv++; PW.apply(S, { type: "surrender", c: me, t: t }); }
  paintAll(scen + " with a puppet " + keys[0], S, me, { me, sel: t });
}
const uniq = [...new Set(bad)];
for (const b of uniq.slice(0, 40)) console.log("  FAIL " + b);
console.log((uniq.length ? "FAIL" : "PASS") + " president-pages-check: " + pages + " pages, " + texts + " lines, " + boxes + " boxes, " + uniq.length + " problems");
process.exit(uniq.length ? 1 : 0);
