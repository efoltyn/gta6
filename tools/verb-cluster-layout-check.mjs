#!/usr/bin/env node
/* ============================================================
   tools/verb-cluster-layout-check.mjs — do the floating touch buttons fit?

   Plain node, no browser. Runs systems/touch_layout.js (the SAME file the
   page runs) over the screens the owner plays on and asserts:

   THE VERBS BESIDE A PERSON (city/verbwheel.js, owner 2026-09-29: "look how
   stupid the buttons look when you press someone"):
     - 3, 5 and 8 verbs, collapsed (four + More) and expanded (all of them)
     - iPad portrait/landscape, iPad Pro, phone portrait/landscape, small phone
     - the person anywhere on the glass, near (big) and far (small)
     zero pills overlapping each other, every pill on screen, never a pill
     on the person's face, never on his body on a tablet (a phone held
     upright with a man filling it may cross his legs), no pill on another
     control (stick, fire/jump column, pause, radar) on a tablet, nor on a
     current phone for the collapsed list on a normal-sized person (an
     expanded list on a phone, and a 375x667 phone, are counted and
     reported: there is not room for every control and the list), and a collapsed list never shows
     more than five pills.

   THE WAY OUT OF A SEAT (systems/seat_exit.js #tExit, owner: "the button to
   get out of chairs or to exit cars is really high on the screen and weirdly
   placed"): for a chair/bed/saddle (on-foot cluster), a car (pedals, utility
   column, dial, steer pads), a boat, a helicopter and an aeroplane, on every
   screen: on screen, on no other button, and in the right-thumb half.

   Pill sizes are modelled from css/city.css (.vpill 44 px high, 18 px side
   padding, Fredoka 15 px; .lead 50 px / 17 px; .more 38 px) and the control
   rects from css/mobile.css, so a CSS change there should be mirrored here.

       node tools/verb-cluster-layout-check.mjs
============================================================ */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const L = require(path.join(ROOT, "src/systems/touch_layout.js"));

let pass = 0, fail = 0;
const fails = [];
function ok(c, msg) { if (c) pass++; else { fail++; fails.push(msg); } }

// ---- screens ------------------------------------------------------------------
const SCREENS = [
  { name: "iPad portrait", W: 820, H: 1180 },
  { name: "iPad landscape", W: 1180, H: 820 },
  { name: "iPad Pro portrait", W: 1024, H: 1366 },
  { name: "phone portrait", W: 390, H: 844 },
  { name: "phone landscape", W: 844, H: 390 },
  { name: "small phone", W: 375, H: 667 },
];
const phoneish = (s) => s.W <= 560 || s.H <= 480;

// ---- the controls on the glass (css/mobile.css, css/title_hub.css) ----------------
function footControls(s, armed) {
  const out = [];
  out.push({ x: 10, y: 8, w: 48, h: 48 });                                  // #hudPauseBtn
  const rad = s.H <= 480 ? 108 : 128;
  out.push({ x: 10, y: 64, w: rad, h: rad });                                // #cRadar
  if (phoneish(s)) out.push({ x: 10, y: s.H - 44 - 140, w: 140, h: 140 });   // #tstick (phone)
  else out.push({ x: 88, y: s.H - 64 - 168, w: 168, h: 168 });               // #tstick (tablet)
  const short = s.H <= 560;
  const big = short ? 70 : 84, jump = short ? 58 : 72, sm = short ? 46 : 52, gap = short ? 9 : 12;
  const R = s.W - 16;
  let y = s.H - 22;
  const col = [big, jump, sm].concat(armed ? [sm, sm] : []);
  for (const d of col) { y -= d; out.push({ x: R - big / 2 - d / 2, y: y, w: d, h: d }); y -= gap; }
  if (armed) {                                                               // aim + scope beside FIRE
    out.push({ x: R - big - 12 - sm, y: s.H - 22 - 16 - sm, w: sm, h: sm });
    out.push({ x: R - big - 12 - sm, y: s.H - 22 - 80 - sm, w: sm, h: sm });
  }
  return out;
}

// ---- pills -----------------------------------------------------------------------
function pill(word, kind) {
  const cw = kind === "lead" ? 9.4 : kind === "more" ? 7.3 : 8.4;
  const pad = kind === "lead" ? 44 : kind === "more" ? 28 : 36;
  const minW = kind === "more" ? 72 : 88;
  const h = kind === "lead" ? 50 : kind === "more" ? 38 : 44;
  return { w: Math.min(240, Math.max(minW, Math.ceil(word.length * cw + pad + 3))), h: h };
}
const VERBS = ["Talk", "Ask for a smoke", "Compliment", "Hire", "Ask the way", "Flirt", "Insult", "Take $77", "Pickpocket", "Stand down"];
function sizesFor(n, collapsed) {
  const words = VERBS.slice(0, n);
  const shown = collapsed && n > 5 ? words.slice(0, 4).concat(["More"]) : words;
  return shown.map((w, i) => pill(w, w === "More" ? "more" : i === 0 ? "lead" : ""));
}

// ---- A. the verb column -------------------------------------------------------------
let cases = 0, touchedControl = 0, onBodyCases = 0, worst = null;
for (const s of SCREENS) {
  const m = { top: 12, right: 12, bottom: 24, left: 12 };
  for (const armed of [false, true]) {
    const avoid = footControls(s, armed);
    for (const n of [3, 5, 8]) {
      for (const collapsed of [true, false]) {
        const sizes = sizesFor(n, collapsed);
        if (collapsed) ok(sizes.length <= 5, `${s.name}: ${n} verbs collapsed shows ${sizes.length} pills (max 5)`);
        // the person: many places on the glass, near and far
        for (const tall of [90, 200, 420]) {
          for (let fx = 0.12; fx <= 0.88; fx += 0.095) {
            for (let fy = 0.2; fy <= 0.7; fy += 0.1) {
              const half = Math.max(22, tall * 0.36);
              const hx = s.W * fx, top = s.H * fy - tall / 2;
              const body = { x: hx - half, y: top, w: half * 2, h: tall };
              // a person standing under the stick or the fire column is not a place the list can fix
              if (avoid.some((r) => L.overlaps(body, r, 0))) continue;
              for (const prefer of ["right", "left"]) {
                cases++;
                const out = L.verbColumn({ W: s.W, H: s.H, sizes, gap: 8, body, anchor: { x: hx, y: top + tall * 0.45 }, avoid, prefer, margin: m });
                const tag = `${s.name} armed=${armed} n=${n}${collapsed ? "c" : "x"} person@${fx.toFixed(2)},${fy.toFixed(2)} h=${tall}`;
                ok(!!out && out.rects.length === sizes.length, tag + ": laid out every pill");
                if (!out) continue;
                const R = out.rects;
                let pillPill = 0, off = 0, onFace = 0, onBody = 0, onCtl = 0;
                const face = { x: body.x, y: body.y, w: body.w, h: Math.max(20, body.h * 0.34) };
                for (let i = 0; i < R.length; i++) {
                  if (!L.inside(R[i], s.W, s.H, m)) off++;
                  if (L.overlaps(R[i], face, 0)) onFace++;
                  if (L.overlaps(R[i], body, 0)) onBody++;
                  for (const c of avoid) if (L.overlaps(R[i], c, 0)) onCtl++;
                  for (let j = i + 1; j < R.length; j++) if (L.overlaps(R[i], R[j], 0)) pillPill++;
                }
                // the likely verb is the first and the biggest
                ok(R[0].h >= Math.max(...R.slice(1).map((r) => r.h), 0), tag + ": the lead pill is the biggest");
                ok(pillPill === 0, tag + ": " + pillPill + " pill overlaps");
                ok(off === 0, tag + ": " + off + " pills off screen");
                ok(onFace === 0, tag + ": " + onFace + " pills on his face");
                if (onBody) { onBodyCases++; if (!phoneish(s) && tall <= 200) ok(false, tag + ": pills on the person with room to spare"); }
                // strict: every tablet case, and a phone's collapsed list on a normal-sized person
                if (onCtl && (!phoneish(s) || (collapsed && tall <= 200 && s.name !== "small phone"))) ok(false, tag + ": pills on another control, side=" + out.side);
                if (onCtl) { touchedControl++; if (!worst) worst = tag + " side=" + out.side; if (process.env.VCL_DEBUG) console.log("CTL " + tag + " side=" + out.side + " score=" + out.score); }
              }
            }
          }
        }
      }
    }
  }
}
console.log(`A. verb column: ${cases} placements; 0 allowed on a face; phone-only fallbacks: ${onBodyCases} crossed a body below the face, ${touchedControl} touched a control (an expanded list, a 375x667 phone, or a man taller than the screen; first: ${worst})`);

// ---- A2. the verbs beside a THING ------------------------------------------------------------
// Since the one tap pipeline (city/interactions.js tapPick) every counter, rack,
// case, ATM, desk, chest, pump and dog opens the same column. city/verbwheel.js
// bodyRect draws a thing as a squat box (1.2 m tall from 0.2 m, half-width 0.8
// of its height): the column must stand beside it, never on it, on a tablet.
const THING_VERBS = [
  ["Buy $2,400", "Put on $350", "Modify"],
  ["Deposit $1,200", "Withdraw $500", "Withdraw $100", "Pay off"],
  ["Sell $300", "Sell all $1,200", "Pawn $450", "Redeem $520", "Redeem $610", "Redeem $90"],
];
let thingCases = 0, thingOnCtl = 0;
for (const s of SCREENS) {
  const m = { top: 12, right: 12, bottom: 24, left: 12 };
  const avoid = footControls(s, false);
  for (const words of THING_VERBS) {
    const shown = words.length > 5 ? words.slice(0, 4).concat(["More"]) : words;
    const sizes = shown.map((w, i) => pill(w, w === "More" ? "more" : i === 0 ? "lead" : ""));
    for (const tall of [36, 90, 180]) {
      for (let fx = 0.14; fx <= 0.86; fx += 0.12) {
        for (let fy = 0.25; fy <= 0.7; fy += 0.15) {
          const half = Math.max(22, tall * 0.8);
          const cx = s.W * fx, top = s.H * fy - tall / 2;
          const body = { x: cx - half, y: top, w: half * 2, h: tall };
          if (avoid.some((r) => L.overlaps(body, r, 0))) continue;
          thingCases++;
          const out = L.verbColumn({ W: s.W, H: s.H, sizes, gap: 8, body, anchor: { x: cx, y: top + tall * 0.45 }, avoid, prefer: "right", margin: m });
          const tag = `${s.name} thing n=${words.length} @${fx.toFixed(2)},${fy.toFixed(2)} h=${tall}`;
          ok(!!out && out.rects.length === sizes.length, tag + ": laid out every pill");
          if (!out) continue;
          const R = out.rects;
          let pp = 0, off = 0, on = 0, ctl = 0;
          for (let i = 0; i < R.length; i++) {
            if (!L.inside(R[i], s.W, s.H, m)) off++;
            if (L.overlaps(R[i], body, 0)) on++;
            for (const c of avoid) if (L.overlaps(R[i], c, 0)) ctl++;
            for (let j = i + 1; j < R.length; j++) if (L.overlaps(R[i], R[j], 0)) pp++;
          }
          ok(pp === 0, tag + ": " + pp + " pill overlaps");
          ok(off === 0, tag + ": " + off + " pills off screen");
          if (!phoneish(s) && tall <= 90) ok(on === 0, tag + ": pills on the thing with room to spare");
          if (!phoneish(s)) ok(ctl === 0, tag + ": pills on another control, side=" + out.side);
          if (ctl) thingOnCtl++;
        }
      }
    }
  }
}
console.log(`A2. verbs beside a thing: ${thingCases} placements (${thingOnCtl} phone fallbacks touched a control)`);

// ---- B. the way out ----------------------------------------------------------------------
function vehicleControls(s, kind) {
  const cl = [], av = [{ x: 10, y: 8, w: 48, h: 48 }, { x: 10, y: 64, w: s.H <= 480 ? 108 : 128, h: s.H <= 480 ? 108 : 128 }];
  const narrow = s.W <= 820;
  const Rr = s.W - 14, B = s.H - 18;
  if (kind === "foot") return { cluster: footControls(s, false).slice(3), avoid: footControls(s, false).slice(0, 3) };
  if (kind === "car") {
    // THE PEDALS (right 18, bottom 38): a tall GAS on the edge, a shorter BRAKE inboard
    const gw = narrow ? 88 : 104, gh = narrow ? 124 : 140, bw = narrow ? 80 : 92, bh = narrow ? 84 : 96;
    cl.push({ x: s.W - 18 - gw, y: s.H - 38 - gh, w: gw, h: gh });
    cl.push({ x: s.W - 18 - gw - 10 - bw, y: s.H - 38 - bh, w: bw, h: bh });
    // utility column over the gas (right 18, bottom 188 / 172): TILT, SEAT, VIEW
    let y = s.H - (narrow ? 172 : 188);
    for (let i = 0; i < 3; i++) { y -= 46; cl.push({ x: s.W - 18 - 92, y: y, w: 92, h: 46 }); y -= 9; }
    // dial
    const dr = narrow ? 204 : 246, dw = narrow ? 108 : 128;
    cl.push({ x: s.W - dr - dw, y: s.H - 168 - dw, w: dw, h: dw });
    // steer pads on the left (left 52 or 18, bottom 64)
    const sl = narrow ? 18 : 52, sw = narrow ? 88 : 104;
    av.push({ x: sl, y: s.H - 64 - 82, w: sw * 2 + 10, h: 82 });
    return { cluster: cl, avoid: av };
  }
  // column grammar (#tvBtns, column-reverse, right 14 bottom 18): big first
  const col = kind === "boat" ? [["big", 128, 72], ["sm", 92, 46]]
    : kind === "heli" ? [["big", 128, 72], ["big", 128, 72], ["fire", 64, 64], ["sm", 92, 46]]
    : [["big", 128, 72], ["big", 128, 72], ["sm", 92, 46]];                 // wing: throttle up/down + view
  let y = B;
  for (const [, w, h] of col) { y -= h; cl.push({ x: Rr - w, y: y, w: w, h: h }); y -= 10; }
  const dw = narrow ? 108 : 128;
  cl.push({ x: Rr - (narrow ? 118 : 140) - dw, y: B - 4 - dw, w: dw, h: dw });      // dial beside the column
  av.push(phoneish(s) ? { x: 10, y: s.H - 44 - 140, w: 140, h: 140 } : { x: 88, y: s.H - 64 - 168, w: 168, h: 168 });
  return { cluster: cl, avoid: av };
}
for (const s of SCREENS) {
  for (const kind of ["foot", "car", "boat", "heli", "wing"]) {
    for (const word of ["GET OUT", "STAND UP", "JUMP"]) {
      const size = { w: Math.max(108, Math.ceil(word.length * 11.5 + 40)), h: 54 };
      const { cluster, avoid } = vehicleControls(s, kind);
      const r = L.exitSlot({ W: s.W, H: s.H, size, gap: 12, cluster, avoid, margin: { top: 12, right: 12, bottom: 12, left: 12 } });
      const tag = `${s.name} ${kind} "${word}"`;
      ok(!!r, tag + ": placed");
      if (!r) continue;
      const rr = { x: r.x, y: r.y, w: r.w, h: r.h };
      ok(L.inside(rr, s.W, s.H, { top: 12, right: 12, bottom: 12, left: 12 }), tag + ": on screen " + JSON.stringify(rr));
      const hitsC = cluster.concat(avoid).filter((c) => L.overlaps(rr, c, 0)).length;
      ok(hitsC === 0, tag + ": on " + hitsC + " other controls " + JSON.stringify(rr) + " where=" + r.where);
      ok(rr.x + rr.w / 2 > s.W / 2, tag + ": in the right-thumb half (x " + (rr.x + rr.w / 2) + " of " + s.W + ")");
      ok(rr.y + rr.h / 2 > s.H * 0.25, tag + ": not up at the top of the screen (y " + (rr.y + rr.h / 2) + " of " + s.H + ")");
    }
  }
}

for (const f of fails) console.log("FAIL " + f);
console.log(`VERB-CLUSTER-LAYOUT: ${fail ? "FAIL" : "OK"} ${pass} passed, ${fail} failed (${cases} person placements, ${thingCases} thing placements)`);
process.exit(fail ? 1 : 0);
