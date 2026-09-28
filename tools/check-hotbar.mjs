#!/usr/bin/env node
// tools/check-hotbar.mjs — plain-node check of THE HOTBAR (no browser).
//   1. systems/hotbar_model.js only ever emits allowed kinds, whatever junk
//      the pockets hold, and N guns become exactly N gun cells, one lit.
//   2. systems/inventory.js, run against a stub DOM, draws exactly those
//      cells: N gun renders in one row, no text, no stash screen.
// Run: node tools/check-hotbar.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(path.join(root, "src/systems/hotbar_model.js"));

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log("FAIL " + msg); } }

const ALL_GUNS = ["sidearm", "revolver", "deagle", "smg", "uzi", "shotgun", "carbine", "ak47", "sniper", "lmg", "taser", "bazooka", "glauncher", "shank"];
const JUNK = ["Ramen", "Soap", "Pills", "Cigarette Carton", "Gold Tooth", "Lockpick", "Shiv", "Burner Phone", "Luxury Watch"];

// ---- 1. the model ----
for (const mode of ["escape", "gungame", "survival", "sharksim"]) {
  for (let n = 0; n <= ALL_GUNS.length; n++) {
    const guns = ALL_GUNS.slice(0, n);
    const held = n ? guns[n - 1] : null;
    const list = M.build({
      mode, guns: guns.concat(guns.slice(0, 2)),     // duplicates must collapse
      held, holstered: false, hasKeycard: true,
      keys: ["Gun-Room Key", "Gate Key", "Gun-Room Key"].concat(JUNK),
      flashlight: { owned: n % 2 === 0, on: n % 4 === 0 },
    });
    ok(M.allowed(list), `${mode} n=${n}: disallowed kind in ${JSON.stringify(list.map((e) => e.kind))}`);
    const g = list.filter((e) => e.kind === "gun");
    ok(g.length === n, `${mode} n=${n}: ${g.length} gun cells`);
    ok(g.filter((e) => e.active).length === (n ? 1 : 0), `${mode} n=${n}: lit gun count`);
    ok(list.every((e) => !JUNK.includes(e.name)), `${mode} n=${n}: junk item on the bar`);
    // selectable cells first, passive last, so digit N is always something usable
    const firstPassive = list.findIndex((e) => !e.selectable);
    ok(firstPassive < 0 || list.slice(firstPassive).every((e) => !e.selectable), `${mode} n=${n}: passive cell before a usable one`);
    if (mode === "escape") {
      ok(list.filter((e) => e.kind === "keycard").length === 1, `escape n=${n}: keycard missing`);
      ok(list.filter((e) => e.kind === "key").length === 2, `escape n=${n}: door keys wrong`);
    } else {
      ok(!list.some((e) => e.kind === "keycard" || e.kind === "key"), `${mode}: prison belt leaked into another game`);
    }
    if (n) ok(M.selectableAt(list, 0).id === guns[0], `${mode} n=${n}: digit 1 is not the first gun`);
  }
}
// holstered: nothing lit
const hol = M.build({ mode: "escape", guns: ["sidearm", "ak47"], held: "ak47", holstered: true });
ok(hol.every((e) => !e.active), "holstered escape still lights a gun");

// ---- 2. the renderer against a stub DOM ----
function el() {
  return {
    id: "", style: { display: "", setProperty(k, v) { this[k] = v; } },
    innerHTML: "", dataset: {}, children: [], listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { this.listeners[t] = f; },
  };
}
const body = el();
const ticks = [];
const CBZ = {
  game: { mode: "escape", state: "playing", inventory: { Keycard: 1, Ramen: 3, Soap: 1, "Gun-Room Key": 1 }, hasKey: true },
  weaponInventory: [], currentWeaponId: null,
  itemIconGun: (id) => "data:gun/" + id,
  flashlightThumbnail: () => "data:flashlight",
  itemIcon: (name) => "data:item/" + name,
  playerFlashlight: { owned: () => true, on: () => false, toggle() {} },
  onAlways(order, fn) { ticks.push(fn); },
  econ: { hasItem: () => false, takeItem: () => false },
  player: { hp: 100, hunger: 80 },
};
const win = { CBZ, addEventListener() {} };
win.window = win;
win.document = { createElement: el, body };
vm.createContext(win);
vm.runInContext(readFileSync(path.join(root, "src/systems/hotbar_model.js"), "utf8"), win);
vm.runInContext(readFileSync(path.join(root, "src/systems/inventory.js"), "utf8"), win);
const bar = body.children.find((c) => c.id === "hotbar");
ok(!!bar, "no #hotbar element");
ok(body.children.length === 1, "the renderer built more than the bar (a stash screen?)");

for (const n of [0, 1, 3, 9, 14]) {
  CBZ.weaponInventory = ALL_GUNS.slice(0, n);
  CBZ.currentWeaponId = n ? CBZ.weaponInventory[0] : null;
  for (const f of ticks) f(0.2);
  const html = bar.innerHTML;
  const cells = (html.match(/class='hb /g) || []).length;
  const gunCells = (html.match(/class='hb gun/g) || []).length;
  const lit = (html.match(/class='hb gun on/g) || []).length;
  ok(gunCells === n, `render n=${n}: ${gunCells} gun cells`);
  ok(lit === (n ? 1 : 0), `render n=${n}: ${lit} lit guns`);
  ok(cells === n + 3, `render n=${n}: ${cells} cells (want guns + flashlight + keycard + key)`);
  ok(bar.style["--hb-n"] === String(n + 3), `render n=${n}: --hb-n=${bar.style["--hb-n"]}`);
  // no words on the bar: strip tags and attributes, nothing may remain
  ok(html.replace(/<[^>]*>/g, "").trim() === "", `render n=${n}: text on the bar`);
  ok(!/Ramen|Soap/.test(html), `render n=${n}: junk drawn`);
  ok(bar.style.display === "flex", `render n=${n}: bar hidden`);
  const audit = CBZ.hotbarAudit();
  ok(audit.allowed && audit.guns === n && audit.screen === false, `audit n=${n}: ${JSON.stringify(audit)}`);
}

console.log(fails ? `hotbar check: ${fails} failure(s)` : "hotbar check: OK (model allow-list, 0..14 guns, renderer, audit)");
process.exit(fails ? 1 : 0);
