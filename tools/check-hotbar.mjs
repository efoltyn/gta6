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

// GANG CITY runs the same model (2026-09-30): guns, the bat on the belt, a
// stack of frags, the light, the phone, then the cards and keys it carries
{
  const c = M.build({
    mode: "city", guns: ["sidearm", "ak47"], held: "ak47", holstered: true,
    melee: { name: "Bat", active: true },
    items: [{ kind: "throwable", item: "Grenade", held: "grenade", count: 3, active: false }],
    flashlight: { owned: true, on: false },
    phone: { active: false, unread: true },
    cards: ["Officer's Keycard"], keys: ["Vault Key - Meridian Trust"],
  });
  ok(M.allowed(c), "city: disallowed kind " + JSON.stringify(c.map((e) => e.kind)));
  ok(c.map((e) => e.kind).join(",") === "gun,gun,melee,throwable,flashlight,phone,keycard,key", "city: draw order " + c.map((e) => e.kind).join(","));
  ok(c.filter((e) => e.active).length === 1 && c.find((e) => e.active).kind === "melee", "city: the bat in hand is the one lit cell");
  ok(M.selectableAt(c, 5).kind === "phone" && M.selectableAt(c, 6) === null, "city: digit 6 is the phone, digit 7 nothing (cards and keys are passive)");
  ok(c.find((e) => e.kind === "phone").unread, "city: the phone carries its unread LED");
  ok(M.signature(c) !== M.signature(M.build({ mode: "city", guns: ["sidearm", "ak47"], held: "ak47", holstered: true, melee: { name: "Bat", active: true },
    items: [{ kind: "throwable", item: "Grenade", held: "grenade", count: 2 }], flashlight: { owned: true }, phone: { unread: true },
    cards: ["Officer's Keycard"], keys: ["Vault Key - Meridian Trust"] })), "city: throwing one frag must repaint the bar");
  const p = M.build({ mode: "escape", phone: null, melee: null, keys: ["Vault Key - Meridian Trust", "Gate Key"] });
  ok(p.length === 1 && p[0].name === "Gate Key", "prison: only the four real door keys exist there");
}

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

// ---- 3. the SAME renderer in Gang City ----
{
  let opened = 0, holsterCalls = 0, selected = null;
  CBZ.game = { mode: "city", state: "playing", cityInv: { "Officer's Keycard": 1, "Vault Key - Meridian Trust": 1, Ramen: 4, Weed: 9 }, cityMeleeStowed: "Bat" };
  CBZ.weaponInventory = ["sidearm", "ak47"];
  CBZ.currentWeaponId = "ak47";
  CBZ.cityOpenPhone = () => { opened++; };
  CBZ.cityHolster = () => { holsterCalls++; return true; };
  CBZ.fpsSelectWeaponId = (id) => { selected = id; return true; };
  CBZ.player = { hp: 100, hunger: 80, driving: false };
  for (const f of ticks) f(0.2);
  const html = bar.innerHTML;
  const kinds = (html.match(/class='hb (\w+)/g) || []).map((s) => s.slice(10));
  ok(kinds.join(",") === "gun,gun,melee,flashlight,phone,keycard,key", "city render: " + kinds.join(","));
  ok(!/Ramen|Weed/.test(html) && html.replace(/<[^>]*>/g, "").trim() === "", "city render: words or junk on the bar");
  ok(bar.style.display === "flex", "city render: bar hidden");
  const a = CBZ.hotbarAudit();
  ok(a.mode === "city" && a.allowed && a.guns === 2 && a.bars === 1, "city audit: " + JSON.stringify(a));
  // using things: the phone raises the phone, the bat comes out of the belt,
  // a gun comes out and stows the bat, the lit gun goes back in the holster
  ok(CBZ.inventory.selectKind("phone") && opened === 1, "city: the phone cell does not raise the phone");
  ok(CBZ.inventory.selectKind("melee") && CBZ.game.cityMeleeWeapon === "Bat" && !CBZ.game.cityMeleeStowed, "city: the bat cell does not draw the bat");
  ok(CBZ.inventory.select(0) && selected === "sidearm" && CBZ.game.cityMeleeStowed === "Bat" && !CBZ.game.cityMeleeWeapon, "city: drawing a gun must stow the bat");
  CBZ.game.cityHolstered = false;
  ok(CBZ.inventory.select(1) && holsterCalls === 1, "city: the gun in your hands, picked again, goes away");
  // the phone builder's hook wins over every built-in phone
  let hooked = 0;
  CBZ.inventory.onUse("phone", () => { hooked++; return true; });
  ok(CBZ.inventory.selectKind("phone") && hooked === 1 && opened === 1, "city: CBZ.inventory.onUse('phone') must own the phone cell");
  CBZ.inventory.onUse("phone", null);
  CBZ.phoneOpen = () => { opened += 10; };
  ok(CBZ.inventory.selectKind("phone") && opened === 11, "city: CBZ.phoneOpen must win over the old city phone");
  // behind the wheel on a keyboard the car owns the bottom of the glass
  CBZ.player.driving = true;
  for (const f of ticks) f(0.2);
  ok(bar.style.display === "none", "city: the bar must leave while you drive (keyboard)");
}

console.log(fails ? `hotbar check: ${fails} failure(s)` : "hotbar check: OK (model allow-list, 0..14 guns, renderer, audit, Gang City on the same bar)");
process.exit(fails ? 1 : 0);
